// Runs kuromoji (and its ~17 MB dictionary) off the main thread, once for the
// whole browser rather than once per tab.
import { annotateJapanese, type Token } from '../engines/japanese';
import type { JapaneseStyle, Segment } from '../shared/types';

interface Tokenizer {
  tokenize(text: string): Token[];
}
declare function importScripts(...urls: string[]): void;
declare const kuromoji: {
  builder(options: { dicPath: string }): {
    build(callback: (error: unknown, tokenizer: Tokenizer) => void): void;
  };
};

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

importScripts('kuromoji.js');

// The dictionary path must stay relative: kuromoji normalises it with a path
// library that would collapse the "//" in an absolute chrome-extension:// URL.
const tokenizer = new Promise<Tokenizer>((resolve, reject) => {
  kuromoji.builder({ dicPath: 'dict/' }).build((error, built) => {
    if (error) reject(error);
    else resolve(built);
  });
});

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, texts, style } = event.data;
  let response: WorkerResponse;
  try {
    const t = await tokenizer;
    response = { id, segments: texts.map((text) => annotateJapanese(t.tokenize(text), style)) };
  } catch (error) {
    response = { id, error: String(error) };
  }
  (self as unknown as { postMessage(message: WorkerResponse): void }).postMessage(response);
};
