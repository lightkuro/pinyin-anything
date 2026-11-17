// Finds the dictionary word at a position in a piece of text. One function per
// language, because "what is a word here" differs for each: Chinese has no
// spaces, Japanese inflects, Korean glues endings onto stems.
import { romanize } from 'es-hangul';
import type { Token } from '../engines/japanese';
import { hasHan, hasKana, toHiragana } from '../shared/script';
import type { LookupResult, Meaning } from '../shared/types';
import { type Dictionary, SENSE_SEPARATOR } from './dictionary';
import { numberedToMarks } from './pinyin';

const MAX_MEANINGS = 4;
const senses = (field: string | undefined) => (field ?? '').split(SENSE_SEPARATOR).filter(Boolean);

// ---------------------------------------------------------------- Chinese

function chineseMeanings(dict: Dictionary, word: string): Meaning[] {
  return dict
    .get(word)
    .map(([, , pinyin, defs]) => ({ pinyin, defs }))
    // Capitalised readings are names (surnames, places); everyday readings first.
    .sort((a, b) => Number(/^[A-Z]/.test(a.pinyin)) - Number(/^[A-Z]/.test(b.pinyin)))
    .slice(0, MAX_MEANINGS)
    .map(({ pinyin, defs }) => ({
      word,
      reading: numberedToMarks(pinyin),
      // "CL:個|个[ge4]" lists measure words in CC-CEDICT's own notation, which
      // reads as noise next to the meanings.
      senses: senses(defs).filter((sense, _, list) => !sense.startsWith('CL:') || list.length === 1),
    }));
}

/** How far back to look for the start of the run of Chinese the pointer is in. */
const CHINESE_LOOKBACK = 24;

/**
 * The dictionary word that contains `offset`. Chinese has no spaces, so the
 * text leading up to the pointer is split into words by always taking the
 * longest dictionary word available; pointing at any character of 学习 then
 * finds 学习 rather than just that character.
 */
export function lookupChinese(dict: Dictionary, text: string, offset: number): LookupResult | null {
  if (!hasHan(text[offset] ?? '')) return null;
  let position = offset;
  while (position > 0 && offset - position < CHINESE_LOOKBACK && hasHan(text[position - 1])) position--;

  while (position <= offset) {
    let length = Math.min(dict.longest, text.length - position);
    while (length > 1 && !dict.has(text.slice(position, position + length))) length--;
    if (position + length > offset) {
      const word = text.slice(position, position + length);
      return dict.has(word) ? { start: position, end: position + length, meanings: chineseMeanings(dict, word) } : null;
    }
    position += length;
  }
  return null;
}

// ---------------------------------------------------------------- Japanese

function japaneseMeanings(dict: Dictionary, key: string): Meaning[] {
  const keyIsKana = !hasHan(key);
  return dict
    .get(key)
    .map(([kanji, kana, flags, defs]) => {
      const kanjiForms = kanji ? kanji.split(';') : [];
      const kanaForms = kana.split(';');
      const kanaWord = kanjiForms.length === 0 || flags.includes('k');
      // A kana spelling most likely means a word normally written in kana
      // (はし is rarely 橋 when someone actually wrote はし… but は is always は).
      const score = (flags.includes('c') ? 2 : 0) + (keyIsKana && kanaWord ? 3 : 0);
      const word = keyIsKana ? (kanaWord ? key : kanjiForms[0]) : key;
      const reading = word === kanaForms[0] || (keyIsKana && word === key) ? '' : kanaForms[0];
      return { score, meaning: { word, reading, senses: senses(defs) } };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MEANINGS)
    .map(({ meaning }) => meaning);
}

const GRAMMAR = new Set(['助詞', '助動詞', '記号']);
const isJapanese = (s: string) => hasHan(s) || hasKana(s);

/**
 * The word at `offset`, using the tokenizer's word boundaries and dictionary
 * forms (食べました → 食べる). Neighbouring tokens are joined when together
 * they form a dictionary word (日本 + 語 → 日本語).
 */
export function lookupJapanese(dict: Dictionary, tokens: Token[], offset: number): LookupResult | null {
  const starts: number[] = [];
  let position = 0;
  for (const token of tokens) {
    starts.push(position);
    position += token.surface_form.length;
  }
  const at = tokens.findIndex((token, i) => offset >= starts[i] && offset < starts[i] + token.surface_form.length);
  if (at < 0 || !isJapanese(tokens[at].surface_form)) return null;
  const end = (i: number) => starts[i] + tokens[i].surface_form.length;

  // Compounds: every run of 2–4 content tokens that covers the pointer, longest first.
  const spans: [number, number][] = [];
  for (let a = Math.max(0, at - 3); a <= at; a++) {
    for (let b = Math.max(at, a + 1); b <= Math.min(tokens.length - 1, a + 3); b++) spans.push([a, b]);
  }
  spans.sort(([a1, b1], [a2, b2]) => end(b2) - starts[a2] - (end(b1) - starts[a1]) || a1 - a2);
  for (const [a, b] of spans) {
    const run = tokens.slice(a, b + 1);
    if (run.some((token) => GRAMMAR.has(token.pos) || !isJapanese(token.surface_form))) continue;
    const head = run.slice(0, -1).map((token) => token.surface_form).join('');
    const last = run[run.length - 1];
    for (const key of new Set([head + last.surface_form, head + (last.basic_form ?? '')])) {
      if (dict.has(key)) return { start: starts[a], end: end(b), meanings: japaneseMeanings(dict, key) };
    }
  }

  const token = tokens[at];
  const candidates = [token.basic_form, token.surface_form, token.reading && toHiragana(token.reading)];
  for (const key of candidates) {
    if (key && key !== '*' && dict.has(key)) {
      return { start: starts[at], end: end(at), meanings: japaneseMeanings(dict, key) };
    }
  }
  return null;
}

/** Without the tokenizer: the longest dictionary word starting at `offset`, uninflected only. */
export function lookupJapanesePlain(dict: Dictionary, text: string, offset: number): LookupResult | null {
  const longest = Math.min(dict.longest, text.length - offset);
  for (let length = longest; length >= 1; length--) {
    const word = text.slice(offset, offset + length);
    if (dict.has(word)) return { start: offset, end: offset + length, meanings: japaneseMeanings(dict, word) };
  }
  return null;
}

// ---------------------------------------------------------------- Korean

const SYLLABLE_BASE = 0xac00;
const isSyllable = (ch: string | undefined) => ch !== undefined && ch >= '가' && ch <= '힣';

/** [initial, vowel, final] indexes of a hangul syllable. */
function split(syllable: string): [number, number, number] {
  const code = syllable.charCodeAt(0) - SYLLABLE_BASE;
  return [Math.floor(code / 588), Math.floor((code % 588) / 28), code % 28];
}
const join = (initial: number, vowel: number, final: number) =>
  String.fromCharCode(SYLLABLE_BASE + (initial * 21 + vowel) * 28 + final);

const V = { a: 0, ae: 1, eo: 4, yeo: 6, o: 8, wa: 9, wae: 10, oe: 11, u: 13, wo: 14, eu: 18, i: 20 };
const F = { none: 0, n: 4, l: 8, m: 16, b: 17, ss: 20 };
const I = { r: 5, ieung: 11, h: 18 };
/** Finals that are often part of an ending rather than the stem: 갔-, 간, 갈, 갑니다, 감. */
const ENDING_FINALS = new Set([F.ss, F.n, F.l, F.b, F.m]);
/** Vowels created by merging a stem vowel with 아/어, and the stem vowel they came from. */
const CONTRACTIONS: [number, number][] = [
  [V.wa, V.o], // 봐 → 보다
  [V.wo, V.u], // 배워 → 배우다
  [V.yeo, V.i], // 마셔 → 마시다
  [V.eo, V.eu], // 써 → 쓰다
  [V.a, V.eu], // 바빠 → 바쁘다
  [V.wae, V.oe], // 돼 → 되다
];

/**
 * Verb and adjective stems that the conjugated form `form` could come from.
 * Endings that begin a new syllable (먹-어요) need no work here: the caller
 * tries every shorter prefix anyway. This undoes the changes that happen
 * inside the stem's last syllable.
 */
export function koreanStems(form: string): string[] {
  const stems = new Set<string>([form]);
  const head = form.slice(0, -1);
  const [initial, vowel, final] = split(form[form.length - 1]);

  const lastSyllables: [number, number][] = [[vowel, final]];
  if (ENDING_FINALS.has(final)) lastSyllables.push([vowel, F.none]);
  for (const [v, f] of lastSyllables) {
    stems.add(head + join(initial, v, f));
    if (f !== F.none) continue;
    if (initial === I.h && v === V.ae) stems.add(head + join(I.h, V.a, F.none)); // 해 → 하다
    for (const [merged, original] of CONTRACTIONS) {
      if (v === merged) stems.add(head + join(initial, original, F.none));
    }
    const before = head[head.length - 1];
    if (!isSyllable(before)) continue;
    const [bi, bv, bf] = split(before);
    // ㅂ-irregular: 추워, 추운 → 춥다
    if (initial === I.ieung && (v === V.wo || v === V.u) && bf === F.none) {
      stems.add(head.slice(0, -1) + join(bi, bv, F.b));
    }
    // 르-irregular: 몰라 → 모르다
    if (initial === I.r && (v === V.a || v === V.eo) && bf === F.l) {
      stems.add(head.slice(0, -1) + join(bi, bv, F.none) + join(I.r, V.eu, F.none));
    }
  }
  stems.delete(form);
  return [form, ...stems];
}

function koreanMeanings(dict: Dictionary, word: string): Meaning[] {
  return dict.get(word).map(([, hanja, pos, defs]) => {
    const list = senses(defs);
    if (pos && list.length > 0) list[0] = `(${pos}) ${list[0]}`;
    return { word: hanja ? `${word} ${hanja}` : word, reading: romanize(word), senses: list };
  });
}

function koreanFrom(dict: Dictionary, text: string, start: number, end: number): LookupResult | null {
  const run = text.slice(start, end);
  for (let length = run.length; length >= 1; length--) {
    const prefix = run.slice(0, length);
    const meanings: Meaning[] = [];
    // A one-syllable noun at the front of a long word is usually a coincidence.
    if (!(length === 1 && run.length >= 3)) meanings.push(...koreanMeanings(dict, prefix));
    for (const stem of koreanStems(prefix)) meanings.push(...koreanMeanings(dict, `${stem}다`));
    if (meanings.length > 0) {
      return { start, end: start + length, meanings: meanings.slice(0, MAX_MEANINGS) };
    }
  }
  return null;
}

/**
 * The word at `offset`: the longest dictionary word, or verb stem, that begins
 * the space-separated word the pointer is on (한국어를 → 한국어, 갔어요 → 가다).
 */
export function lookupKorean(dict: Dictionary, text: string, offset: number): LookupResult | null {
  if (!isSyllable(text[offset])) return null;
  let start = offset;
  while (isSyllable(text[start - 1])) start--;
  let end = offset;
  while (isSyllable(text[end])) end++;
  const whole = koreanFrom(dict, text, start, end);
  if (whole && whole.end > offset) return whole;
  // The pointer is past the word found at the front (a compound written
  // without spaces): look for a word starting where the pointer is.
  return koreanFrom(dict, text, offset, end) ?? whole;
}
