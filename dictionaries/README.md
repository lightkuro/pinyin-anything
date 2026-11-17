# Word-meaning dictionaries

These files are what the extension downloads when you ask for word meanings. They are not part
of the installed extension. Each is a gzipped text file with one entry per line.

| File | Language | Entries | Source | Licence |
|---|---|---|---|---|
| `zh.txt.gz` | Chinese → English | 125,000 | [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `ja.txt.gz` | Japanese → English | 219,000 | [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html), © Electronic Dictionary Research and Development Group | [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html) |
| `ko.txt.gz` | Korean → English | 89,000 | [Wiktionary](https://en.wiktionary.org) via [kaikki.org](https://kaikki.org/dictionary/Korean/), plus [KENGDIC](https://github.com/garfieldnate/kengdic) for words Wiktionary lacks | CC BY-SA 4.0 (Wiktionary); MPL 2.0 or LGPL 2.0+ (KENGDIC) |

The files are reformatted copies of those sources and are distributed under the same licences,
not under this repository's GPL.

## Format

Fields are separated by tabs; senses within the last field by the unit separator (`0x1F`).

- `zh`: traditional, simplified (blank if the same), pinyin with tone numbers, definitions
- `ja`: kanji spellings (`;`-separated), kana readings (`;`-separated), flags (`c` common word,
  `k` usually written in kana), senses
- `ko`: word, hanja, part of speech, senses

## Rebuilding

```bash
node scripts/build-dictionaries.mjs
```

The extension downloads these files from a fixed commit of this repository and checks them
against checksums recorded when the extension is built. After rebuilding:

1. Commit the new files in `dictionaries/` and push.
2. Put that commit's full hash in `dictionaries/published.json`.
3. Run `npm run build` and commit the result.
