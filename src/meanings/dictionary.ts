// An in-memory dictionary built from one of the files in dictionaries/. The
// text is kept as it was downloaded (one entry per line) and only an index
// from each headword to its lines is built, which keeps loading fast.

export const SENSE_SEPARATOR = '\x1f';

export class Dictionary {
  private readonly lines: string[];
  private readonly index = new Map<string, number | number[]>();
  /** Length of the longest headword, which bounds how far a match can reach. */
  readonly longest: number;

  /**
   * @param text the dictionary file, one tab-separated entry per line
   * @param keys picks the headwords an entry can be found under
   */
  constructor(text: string, keys: (fields: string[]) => string[]) {
    this.lines = text.split('\n');
    let longest = 1;
    this.lines.forEach((line, n) => {
      if (!line) return;
      for (const key of keys(line.split('\t'))) {
        if (!key) continue;
        if (key.length > longest) longest = key.length;
        const existing = this.index.get(key);
        if (existing === undefined) this.index.set(key, n);
        else if (typeof existing === 'number') this.index.set(key, [existing, n]);
        else existing.push(n);
      }
    });
    this.longest = longest;
  }

  has(key: string): boolean {
    return this.index.has(key);
  }

  /** The entries listed under `key`, each as its tab-separated fields. */
  get(key: string): string[][] {
    const found = this.index.get(key);
    if (found === undefined) return [];
    return (typeof found === 'number' ? [found] : found).map((n) => this.lines[n].split('\t'));
  }
}

export const chineseDictionary = (text: string) => new Dictionary(text, ([trad, simp]) => [trad, simp]);
export const japaneseDictionary = (text: string) =>
  new Dictionary(text, ([kanji, kana]) => [...kanji.split(';'), ...kana.split(';')]);
export const koreanDictionary = (text: string) => new Dictionary(text, ([word]) => [word]);
