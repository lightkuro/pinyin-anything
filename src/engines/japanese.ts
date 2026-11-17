import { toRomaji } from 'wanakana';
import { compact, hasHan, hasKana, toHiragana } from '../shared/script';
import type { JapaneseStyle, Segment } from '../shared/types';

/** The fields of a kuromoji token this engine relies on. */
export interface Token {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  basic_form?: string;
  reading?: string;
}

const PARTICLE_READINGS: Record<string, string> = { は: 'ワ', へ: 'エ', を: 'オ' };

/** Katakana reading of a token, or null when it has none (Latin, digits, punctuation). */
function readingOf(token: Token): string | null {
  const surface = token.surface_form;
  if (!hasHan(surface) && !hasKana(surface)) return null;
  if (token.pos === '助詞' && PARTICLE_READINGS[surface]) return PARTICLE_READINGS[surface];
  if (token.reading && token.reading !== '*') return token.reading;
  // Words missing from the dictionary still read as written if they are pure kana.
  return hasHan(surface) ? null : surface;
}

const INFLECTING = new Set(['動詞', '形容詞', '助動詞']);
const JOINING_PARTICLES = new Set(['て', 'で', 'ば']);

/** Whether a token is an ending that belongs to the verb/adjective before it (食べ + まし + た). */
function attaches(token: Token): boolean {
  if (token.pos === '助動詞') return true;
  if (token.pos === '動詞' && token.pos_detail_1 === '接尾') return true;
  return (
    token.pos === '助詞' &&
    token.pos_detail_1 === '接続助詞' &&
    JOINING_PARTICLES.has(token.surface_form)
  );
}

function romajiSegments(tokens: Token[]): Segment[] {
  const out: (Segment & { kana?: string; open?: boolean })[] = [];
  for (const token of tokens) {
    const kana = readingOf(token);
    if (kana === null) {
      out.push({ t: token.surface_form });
      continue;
    }
    const prev = out[out.length - 1];
    if (prev?.open && attaches(token)) {
      prev.t += token.surface_form;
      prev.kana += kana;
    } else {
      out.push({ t: token.surface_form, kana, open: INFLECTING.has(token.pos) });
    }
  }
  return out.map(({ t, kana }) => {
    const r = kana === undefined ? undefined : toRomaji(kana);
    return r ? { t, r } : { t };
  });
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits a word into kanji parts (with their reading) and kana parts (plain),
 * so okurigana is not annotated: 食べる + たべる → 食(た) べる.
 */
export function furigana(surface: string, reading: string): Segment[] {
  const hira = toHiragana(reading);
  const parts = surface.match(/[ぁ-ゖゝ-ゟァ-ヺー-ヿ]+|[^ぁ-ゖゝ-ゟァ-ヺー-ヿ]+/g) ?? [];
  const isKanaPart = parts.map((p) => hasKana(p));
  const pattern = parts
    .map((p, i) => (isKanaPart[i] ? escapeRegExp(toHiragana(p)) : '(.+?)'))
    .join('');
  const match = new RegExp(`^${pattern}$`, 'u').exec(hira);
  if (!match) return [{ t: surface, r: hira }];
  let group = 1;
  return parts.map((p, i) => (isKanaPart[i] ? { t: p } : { t: p, r: match[group++] }));
}

function hiraganaSegments(tokens: Token[]): Segment[] {
  return tokens.flatMap((token) => {
    const surface = token.surface_form;
    if (!hasHan(surface) || !token.reading || token.reading === '*') return [{ t: surface }];
    return furigana(surface, token.reading);
  });
}

/** Turns kuromoji tokens for one piece of text into annotated segments. */
export function annotateJapanese(tokens: Token[], style: JapaneseStyle): Segment[] {
  return compact(style === 'romaji' ? romajiSegments(tokens) : hiraganaSegments(tokens));
}
