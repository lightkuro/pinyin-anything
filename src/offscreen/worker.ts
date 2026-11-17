// The engine worker: everything that needs a large dictionary in memory.
// It lives inside the offscreen document, so it is shared by all tabs and
// outlives the service worker. Each dictionary is loaded on first use.
import DynamicDictionaries from 'kuromoji/src/dict/DynamicDictionaries';
import Tokenizer from 'kuromoji/src/Tokenizer';
import { annotateCantonese } from '../engines/cantonese';
import { annotateJapanese, type Token } from '../engines/japanese';
import { chineseDictionary, type Dictionary, japaneseDictionary, koreanDictionary } from '../meanings/dictionary';
import { lookupChinese, lookupJapanese, lookupJapanesePlain, lookupKorean } from '../meanings/lookup';
import { packReady, readPackFile } from '../shared/packs';
import type { EngineRequest, EngineResponse, Language, LookupResult, PackId } from '../shared/types';

declare function importScripts(...urls: string[]): void;

/** Remembers a load in progress, but forgets a failed one so it is retried later. */
function lazy<T>(load: () => Promise<T>): { get(): Promise<T>; reset(): void } {
  let pending: Promise<T> | null = null;
  return {
    get() {
      pending ??= load().catch((error) => {
        pending = null;
        throw error;
      });
      return pending;
    },
    reset() {
      pending = null;
    },
  };
}

// ---------------------------------------------------------------- Japanese readings

const tokenizer = lazy(async () => {
  const names = ['base', 'check', 'tid', 'tid_pos', 'tid_map', 'cc', 'unk', 'unk_pos', 'unk_map', 'unk_char', 'unk_compat', 'unk_invoke'];
  const [base, check, tid, tidPos, tidMap, cc, unk, unkPos, unkMap, unkChar, unkCompat, unkInvoke] = await Promise.all(
    names.map((name) => readPackFile('ja-readings', `${name}.dat.gz`)),
  );
  const dictionaries = new DynamicDictionaries();
  dictionaries.loadTrie(new Int32Array(base), new Int32Array(check));
  dictionaries.loadTokenInfoDictionaries(new Uint8Array(tid), new Uint8Array(tidPos), new Uint8Array(tidMap));
  dictionaries.loadConnectionCosts(new Int16Array(cc));
  dictionaries.loadUnknownDictionaries(
    new Uint8Array(unk),
    new Uint8Array(unkPos),
    new Uint8Array(unkMap),
    new Uint8Array(unkChar),
    new Uint32Array(unkCompat),
    new Uint8Array(unkInvoke),
  );
  return new Tokenizer(dictionaries);
});

// ---------------------------------------------------------------- Cantonese

type Jyutping = { getJyutpingList(text: string): [string, string | null][] };
let jyutping: Jyutping | null = null;

function cantonese(): Jyutping {
  if (!jyutping) {
    importScripts('jyutping.js');
    jyutping = (self as unknown as { ToJyutping: Jyutping }).ToJyutping;
  }
  return jyutping;
}

// ---------------------------------------------------------------- meanings

const meaningPack = (language: Language) => `${language}-meanings` as PackId;

function meaningDictionary(language: Language, build: (text: string) => Dictionary) {
  return lazy(async () => {
    const bytes = await readPackFile(meaningPack(language), `${language}.txt.gz`);
    return build(new TextDecoder().decode(bytes));
  });
}

const meanings = {
  zh: meaningDictionary('zh', chineseDictionary),
  ja: meaningDictionary('ja', japaneseDictionary),
  ko: meaningDictionary('ko', koreanDictionary),
};

/** Hovering moves along one piece of text, so its tokens are worth keeping. */
let lastTokens: { text: string; tokens: Token[] } | null = null;

async function lookup(text: string, offset: number, language: Language, useCantonese: boolean): Promise<LookupResult | null> {
  const dict = await meanings[language].get();
  if (language === 'ko') return lookupKorean(dict, text, offset);
  if (language === 'ja') {
    if (!(await packReady('ja-readings'))) return lookupJapanesePlain(dict, text, offset);
    if (lastTokens?.text !== text) lastTokens = { text, tokens: (await tokenizer.get()).tokenize(text) };
    return lookupJapanese(dict, lastTokens.tokens, offset);
  }
  const result = lookupChinese(dict, text, offset);
  if (result && useCantonese) {
    for (const meaning of result.meanings) {
      meaning.reading = cantonese()
        .getJyutpingList(meaning.word)
        .map(([, reading]) => reading ?? '')
        .join(' ')
        .trim();
    }
  }
  return result;
}

// ---------------------------------------------------------------- messages

async function handle(request: EngineRequest): Promise<EngineResponse> {
  switch (request.kind) {
    case 'japanese': {
      const t = await tokenizer.get();
      return { segments: request.texts.map((text) => annotateJapanese(t.tokenize(text), request.style)) };
    }
    case 'cantonese':
      return {
        segments: request.texts.map((text) => annotateCantonese(cantonese().getJyutpingList(text), request.tone)),
      };
    case 'lookup':
      return { result: await lookup(request.text, request.offset, request.language, request.cantonese) };
    case 'unload':
      // The pack was removed: drop what was loaded from it.
      if (request.pack === 'ja-readings') tokenizer.reset();
      else meanings[request.pack.slice(0, 2) as Language].reset();
      lastTokens = null;
      return { ok: true };
  }
}

self.onmessage = async (event: MessageEvent<{ id: number; request: EngineRequest }>) => {
  const { id, request } = event.data;
  let response: EngineResponse;
  try {
    response = await handle(request);
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) };
  }
  (self as unknown as { postMessage(message: unknown): void }).postMessage({ id, response });
};
