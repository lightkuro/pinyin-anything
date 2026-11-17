// Runs kuromoji off the main thread, once for the whole browser rather than
// once per tab. The dictionary (about 100 MB once unpacked) is read from Cache
// Storage the first time Japanese text needs it.
import DynamicDictionaries from 'kuromoji/src/dict/DynamicDictionaries';
import Tokenizer from 'kuromoji/src/Tokenizer';
import { annotateJapanese } from '../engines/japanese';
import { DICT_CACHE, dictUrl } from '../shared/dictionary';
import type { JapaneseStyle, Segment } from '../shared/types';

export interface WorkerRequest {
  id: number;
  texts: string[];
  style: JapaneseStyle;
}
export interface WorkerResponse {
  id: number;
  segments?: Segment[][];
  error?: string;
}

async function loadTokenizer(): Promise<Tokenizer> {
  const cache = await caches.open(DICT_CACHE);
  const read = async (name: string): Promise<ArrayBuffer> => {
    const stored = await cache.match(dictUrl(`${name}.dat.gz`));
    if (!stored?.body) throw new Error('Japanese dictionary is not downloaded');
    return new Response(stored.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  };
  const [base, check, tid, tidPos, tidMap, cc, unk, unkPos, unkMap, unkChar, unkCompat, unkInvoke] =
    await Promise.all(
      ['base', 'check', 'tid', 'tid_pos', 'tid_map', 'cc', 'unk', 'unk_pos', 'unk_map', 'unk_char', 'unk_compat', 'unk_invoke'].map(read),
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
}

let tokenizer: Promise<Tokenizer> | null = null;

function getTokenizer(): Promise<Tokenizer> {
  tokenizer ??= loadTokenizer().catch((error) => {
    tokenizer = null; // try again next time, e.g. once the download has finished
    throw error;
  });
  return tokenizer;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, texts, style } = event.data;
  let response: WorkerResponse;
  try {
    const t = await getTokenizer();
    response = { id, segments: texts.map((text) => annotateJapanese(t.tokenize(text), style)) };
  } catch (error) {
    response = { id, error: String(error) };
  }
  (self as unknown as { postMessage(message: WorkerResponse): void }).postMessage(response);
};
