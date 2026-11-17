import { compact } from '../shared/script';
import type { PinyinTone, Segment } from '../shared/types';

/**
 * Turns to-jyutping's per-character output into annotated segments. Jyutping
 * has no tone-mark spelling, so anything but "none" keeps the tone numbers.
 */
export function annotateCantonese(list: [string, string | null][], tone: PinyinTone): Segment[] {
  return compact(
    list.map(([t, jyutping]) => {
      if (!jyutping) return { t };
      return { t, r: tone === 'none' ? jyutping.replace(/\d/g, '') : jyutping };
    }),
  );
}
