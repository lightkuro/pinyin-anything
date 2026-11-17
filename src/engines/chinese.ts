import { pinyin } from 'pinyin-pro';
import { compact } from '../shared/script';
import type { PinyinTone, Segment } from '../shared/types';

/** One annotated segment per Han character; everything else passes through. */
export function annotateChinese(text: string, tone: PinyinTone): Segment[] {
  const chars = pinyin(text, { type: 'all', toneType: tone });
  // pinyin-pro works per code point; if it ever disagrees with the input we
  // must not risk rewriting the page's text.
  if (chars.map((c) => c.origin).join('') !== text) return [{ t: text }];
  return compact(
    chars.map((c) => (c.isZh && c.pinyin ? { t: c.origin, r: c.pinyin } : { t: c.origin })),
  );
}
