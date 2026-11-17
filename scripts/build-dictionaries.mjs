// Rebuilds the word-meaning dictionaries in dictionaries/ from their upstream
// sources. These files are what the extension downloads when the user asks for
// word meanings, so they are kept small: one line per entry, gzipped.
//
//   node scripts/build-dictionaries.mjs
//
// Set PYA_SOURCES to a folder to keep the downloaded sources between runs.
// After rebuilding, commit dictionaries/ and put that commit's hash into
// dictionaries/published.json (see dictionaries/README.md).
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gunzipSync, gzipSync } from 'node:zlib';

const SOURCES = {
  'cedict.txt.gz': 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
  'JMdict_e.gz': 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz',
  'ko-wiktionary.jsonl': 'https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl',
  'kengdic.tsv': 'https://cdn.jsdelivr.net/gh/garfieldnate/kengdic@master/kengdic.tsv',
};

const cache = process.env.PYA_SOURCES ?? (await mkdtemp(join(tmpdir(), 'pya-sources-')));
await mkdir(cache, { recursive: true });

async function source(name) {
  const path = join(cache, name);
  if (!existsSync(path)) {
    console.log(`downloading ${name}…`);
    const response = await fetch(SOURCES[name]);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  return path;
}

/** Fields are tab-separated and senses unit-separator-separated, so neither may appear in the data. */
const clean = (s) => s.replace(/[\t\n\r\x1f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const SENSE = '\x1f';

async function write(name, lines) {
  const text = lines.join('\n') + '\n';
  const gz = gzipSync(text, { level: 9 });
  await writeFile(`dictionaries/${name}.txt.gz`, gz);
  console.log(`${name}: ${lines.length} entries, ${(gz.length / 1e6).toFixed(1)} MB (${(text.length / 1e6).toFixed(1)} MB unpacked)`);
  return lines.length;
}

// ---------------------------------------------------------------- Chinese
// CC-CEDICT line:  傳統 传统 [chuan2 tong3] /tradition/traditional/
// Ours:            traditional \t simplified (blank if same) \t pinyin \t definitions

async function chinese() {
  const text = gunzipSync(await readFile(await source('cedict.txt.gz'))).toString('utf8');
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/$/.exec(line);
    if (!match) continue;
    const [, trad, simp, pinyin, defs] = match;
    const senses = defs.split('/').map(clean).filter(Boolean);
    if (senses.length === 0) continue;
    lines.push([trad, simp === trad ? '' : simp, clean(pinyin), senses.join(SENSE)].join('\t'));
  }
  return write('zh', lines);
}

// ---------------------------------------------------------------- Japanese
// JMdict XML. Ours:
//   kanji forms (;) \t kana forms (;) \t flags \t senses
// flags: c = common word, k = usually written in kana.

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name]);
const all = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1]);
const COMMON = /<(?:ke|re)_pri>(?:news1|ichi1|spec1|spec2|gai1)<\/(?:ke|re)_pri>/;

async function japanese() {
  const xml = gunzipSync(await readFile(await source('JMdict_e.gz'))).toString('utf8');
  const lines = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const kanji = all(entry, /<keb>(.*?)<\/keb>/g);
    const kana = all(entry, /<reb>(.*?)<\/reb>/g);
    const senses = [];
    let usuallyKana = false;
    let lastPos = '';
    for (const sense of entry.split('<sense>').slice(1)) {
      const glosses = all(sense, /<gloss[^>]*>(.*?)<\/gloss>/g).map((g) => clean(unescapeXml(g)));
      if (glosses.length === 0) continue;
      // A sense without its own part of speech inherits the previous one.
      const pos = all(sense, /<pos>&(.*?);<\/pos>/g).join(',') || lastPos;
      if (senses.length === 0 && /<misc>&uk;<\/misc>/.test(sense)) usuallyKana = true;
      senses.push((pos && pos !== lastPos ? `(${pos}) ` : '') + glosses.join('; '));
      lastPos = pos;
    }
    if (kana.length === 0 || senses.length === 0) continue;
    const flags = (COMMON.test(entry) ? 'c' : '') + (usuallyKana ? 'k' : '');
    lines.push([kanji.join(';'), kana.join(';'), flags, senses.slice(0, 8).join(SENSE)].map((f) => f.replace(/\t/g, ' ')).join('\t'));
  }
  return write('ja', lines);
}

// ---------------------------------------------------------------- Korean
// Wiktionary (via kaikki.org) for quality, topped up with KENGDIC for words
// Wiktionary lacks. Ours:
//   word \t hanja \t part of speech \t senses

const HANGUL_WORD = /^[가-힣]+$/;
const SKIP_POS = new Set(['character', 'syllable', 'romanization', 'symbol', 'punct']);

async function korean() {
  const lines = [];
  const seen = new Set();

  const reader = createInterface({ input: createReadStream(await source('ko-wiktionary.jsonl')) });
  for await (const line of reader) {
    const entry = JSON.parse(line);
    if (!HANGUL_WORD.test(entry.word) || SKIP_POS.has(entry.pos)) continue;
    const senses = (entry.senses ?? [])
      .map((sense) => clean((sense.glosses ?? []).at(-1) ?? ''))
      .filter(Boolean);
    if (senses.length === 0) continue;
    const hanja = (entry.forms ?? []).find((form) => form.tags?.includes('hanja'))?.form ?? '';
    lines.push([entry.word, clean(hanja), entry.pos, senses.slice(0, 6).join(SENSE)].join('\t'));
    seen.add(entry.word);
  }
  const fromWiktionary = lines.length;

  // KENGDIC has several rows per word; gather their glosses into one entry.
  const extra = new Map();
  const rows = (await readFile(await source('kengdic.tsv'), 'utf8')).split('\n').slice(1);
  for (const row of rows) {
    const [, surface = '', hanja = '', gloss = ''] = row.split('\t');
    const word = surface.trim();
    const meaning = clean(gloss);
    if (!HANGUL_WORD.test(word) || seen.has(word) || !meaning || meaning === 'NULL') continue;
    const entry = extra.get(word) ?? { hanja: '', glosses: [] };
    if (!entry.hanja && hanja.trim() && hanja.trim() !== 'NULL') entry.hanja = clean(hanja);
    if (!entry.glosses.some((g) => g.toLowerCase() === meaning.toLowerCase())) entry.glosses.push(meaning);
    extra.set(word, entry);
  }
  for (const [word, { hanja, glosses }] of extra) {
    lines.push([word, hanja, '', glosses.slice(0, 6).join(SENSE)].join('\t'));
  }
  console.log(`ko: ${fromWiktionary} from Wiktionary, ${extra.size} from KENGDIC`);
  return write('ko', lines);
}

await mkdir('dictionaries', { recursive: true });
const counts = { zh: await chinese(), ja: await japanese(), ko: await korean() };
await writeFile(
  'dictionaries/sources.json',
  JSON.stringify({ built: new Date().toISOString().slice(0, 10), entries: counts, sources: SOURCES }, null, 2) + '\n',
);
