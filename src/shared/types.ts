/** A piece of the original text, with an optional reading to show above/below it. */
export interface Segment {
  t: string;
  r?: string;
}

export type HanLanguage = 'zh' | 'ja';
export type PinyinTone = 'symbol' | 'num' | 'none';
export type JapaneseStyle = 'romaji' | 'hiragana';

export interface Settings {
  position: 'over' | 'under';
  language: 'auto' | 'zh' | 'ja' | 'ko';
  pinyinTone: PinyinTone;
  japanese: JapaneseStyle;
  /** Annotation font size, as a percentage of the annotated text. */
  size: number;
}

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

export interface JapaneseRequest {
  target: 'offscreen';
  type: 'japanese';
  texts: string[];
  style: JapaneseStyle;
}

export interface JapaneseResponse {
  segments?: Segment[][];
  error?: string;
}

/** Where the downloadable Japanese dictionary stands. */
export type DictionaryStatus =
  | { state: 'missing' }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

/** Popup → service worker. */
export interface DictionaryRequest {
  type: 'dictionary';
  action: 'status' | 'download' | 'remove';
}

/** Service worker → offscreen document. */
export interface OffscreenDictionaryRequest {
  target: 'offscreen';
  type: 'dictionary-status' | 'dictionary-download';
}

/** Offscreen document → everyone, while a download runs. */
export interface DictionaryProgress {
  type: 'dictionary-progress';
  status: DictionaryStatus;
}
