/** A piece of the original text, with an optional reading to show above/below it. */
export interface Segment {
  t: string;
  r?: string;
}

export type HanLanguage = 'zh' | 'ja';
export type Language = HanLanguage | 'ko';
export type PinyinTone = 'symbol' | 'num' | 'none';
export type JapaneseStyle = 'romaji' | 'hiragana';
export type ChineseReading = 'pinyin' | 'jyutping';

export interface Settings {
  position: 'over' | 'under';
  language: 'auto' | 'zh' | 'ja' | 'ko';
  /** Annotation font size, as a percentage of the annotated text. */
  size: number;
  /** Show a word's meaning when the pointer rests on it. */
  meanings: boolean;
  /** How Chinese is read: Mandarin (pinyin) or Cantonese (jyutping). */
  chinese: ChineseReading;
  pinyinTone: PinyinTone;
  japanese: JapaneseStyle;
  /** Whether readings are always visible or only appear under the pointer. */
  visibility: 'always' | 'hover';
  /** Reading colour: the text's own colour, or a quieter grey. */
  color: 'inherit' | 'muted';
}

// ---------------------------------------------------------------- annotating

export interface AnnotateItem {
  text: string;
  /** How Han characters (and kana) in this text should be read; null leaves them alone. */
  han: HanLanguage | null;
  /** Whether hangul in this text should be romanized. */
  ko: boolean;
}

export interface AnnotateRequest {
  type: 'annotate';
  items: AnnotateItem[];
  chinese: ChineseReading;
  pinyinTone: PinyinTone;
  japanese: JapaneseStyle;
}

export interface AnnotateResponse {
  segments: Segment[][];
}

export interface StateMessage {
  type: 'state';
  enabled: boolean;
}

// ---------------------------------------------------------------- meanings

/** One dictionary entry, ready to show. */
export interface Meaning {
  word: string;
  reading: string;
  senses: string[];
}

export interface LookupRequest {
  type: 'lookup';
  text: string;
  /** Index in `text` of the character under the pointer. */
  offset: number;
  language: Language;
  /** Show Cantonese rather than Mandarin readings for Chinese words. */
  cantonese: boolean;
}

/** The word found at the requested position, as a range of the request's text. */
export interface LookupResult {
  start: number;
  end: number;
  meanings: Meaning[];
}

// ---------------------------------------------------------------- engine worker

/** Work done by the worker inside the offscreen document. */
export type EngineRequest =
  | { kind: 'japanese'; texts: string[]; style: JapaneseStyle }
  | { kind: 'cantonese'; texts: string[]; tone: PinyinTone }
  | { kind: 'lookup'; text: string; offset: number; language: Language; cantonese: boolean }
  | { kind: 'unload'; pack: PackId };

export type EngineResponse =
  | { segments: Segment[][] }
  | { result: LookupResult | null }
  | { ok: true }
  | { error: string };

/** Service worker → offscreen document. */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'engine'; request: EngineRequest }
  | { target: 'offscreen'; type: 'pack-status' | 'pack-download' | 'pack-remove'; pack: PackId };

// ---------------------------------------------------------------- downloads

/** Things the user can download: Japanese readings, and word meanings per language. */
export type PackId = 'ja-readings' | 'zh-meanings' | 'ja-meanings' | 'ko-meanings';

export type PackStatus =
  | { state: 'missing' }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

/** Popup → service worker. */
export interface PackRequest {
  type: 'pack';
  pack: PackId;
  action: 'status' | 'download' | 'remove';
}

/** Offscreen document → everyone, while a download runs. */
export interface PackProgress {
  type: 'pack-progress';
  pack: PackId;
  status: PackStatus;
}
