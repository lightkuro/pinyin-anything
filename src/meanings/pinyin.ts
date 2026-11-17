// CC-CEDICT writes pinyin with tone numbers ("ni3 hao3", "nu:3"). People read
// tone marks more easily, so entries are converted for display.

const MARKS: Record<string, string> = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
  A: 'ĀÁǍÀ',
  E: 'ĒÉĚÈ',
  O: 'ŌÓǑÒ',
};

function markSyllable(syllable: string): string {
  const match = /^([A-Za-zü:]+)([1-5])$/.exec(syllable);
  if (!match) return syllable; // digits, Latin letters, punctuation
  const letters = match[1].replace(/u:/g, 'ü').replace(/U:/g, 'Ü');
  const tone = Number(match[2]);
  if (tone === 5) return letters;
  // The mark goes on a or e if present, on the o of "ou", else on the last vowel.
  let index = letters.search(/[aeAE]/);
  if (index < 0) index = letters.indexOf('ou');
  if (index < 0) {
    for (let i = letters.length - 1; i >= 0; i--) {
      if (MARKS[letters[i]]) {
        index = i;
        break;
      }
    }
  }
  if (index < 0 || !MARKS[letters[index]]) return letters;
  return letters.slice(0, index) + MARKS[letters[index]][tone - 1] + letters.slice(index + 1);
}

/** "Zhong1 guo2" → "Zhōng guó" */
export function numberedToMarks(pinyin: string): string {
  return pinyin.split(' ').map(markSyllable).join(' ');
}
