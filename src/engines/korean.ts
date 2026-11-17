import { romanize } from 'es-hangul';
import { compact, hangulRuns } from '../shared/script';
import type { Segment } from '../shared/types';

/** Romanizes each run of hangul (Revised Romanization, with sound-change rules). */
export function annotateKorean(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(hangulRuns())) {
    const start = match.index ?? 0;
    if (start > last) out.push({ t: text.slice(last, start) });
    out.push({ t: match[0], r: romanize(match[0]) });
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return compact(out);
}

/** Applies Korean romanization to the parts of `segments` not already annotated. */
export function addKorean(segments: Segment[]): Segment[] {
  return compact(segments.flatMap((seg) => (seg.r === undefined ? annotateKorean(seg.t) : [seg])));
}
