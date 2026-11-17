# Pinyin Anything

A Chrome extension that shows how to read Chinese, Japanese and Korean text on any web page,
above or below the original text — and, if you want, what each word means.

| Text | Annotation |
|---|---|
| Chinese — 银行行长 | pinyin — yín háng háng zhǎng, or Cantonese jyutping — ngan4 hong4 … |
| Japanese — 東京へ行きました | romaji — toukyou e ikimashita (or hiragana over the kanji) |
| Korean — 안녕하세요 | romanization — annyeonghaseyo |

Point at a word to see its meaning: 银行 → *bank*, 食べました → 食べる *to eat*, 갔어요 → 가다
*to go*.

## Install

No build step is needed — the ready-to-use extension is the `dist` folder in this repository.

1. [Download this repository as a ZIP](https://github.com/lightkuro/pinyin-anything/archive/refs/heads/main.zip)
   and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Switch on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `dist` folder inside the unzipped folder.

Keep the unzipped folder where it is: Chrome loads the extension from there each time it starts.
To update, download the ZIP again, replace the folder, and click the reload button on the
extension's card.

## Use

Annotation is off everywhere until you ask for it. Open a page, click the extension icon and
switch on **Annotate this site** — the choice is remembered per site.

**Lyrics, tabs and other text shown as code.** Text inside code blocks is skipped by default,
because annotations get in the way of real code. Some sites — Ultimate Guitar, for one — put
ordinary lyrics in code blocks. On those, also switch on **Include code blocks**; it is
remembered per site too.

**Keyboard shortcut.** A shortcut toggles the current site without opening the popup. The
default is `Alt+Shift+P`, but Chrome leaves it unassigned if something else already uses it.
Settings shows the shortcut actually in effect, and **Change** opens Chrome's shortcut page
(`chrome://extensions/shortcuts`), the only place Chrome allows it to be set.

Pages that were already open when you installed the extension need one reload.

### The popup

Everyday controls are on the main view: the two site switches, **Position** (above or below),
**Language**, **Word meanings**, and **Size**. The **Settings** row underneath opens everything
you set once:

| Setting | Choices |
|---|---|
| Chinese → Reading | Mandarin (pinyin) or Cantonese (jyutping) |
| Chinese → Tones | Marks (nǐ hǎo), numbers (ni3 hao3) or none; jyutping has numbers or none |
| Japanese → Style | Romaji, or hiragana over kanji only |
| Display → Show readings | Always, or only when you point at the text (handy for testing yourself) |
| Display → Reading colour | Same as the text, or lighter |
| Downloads | See below |
| Keyboard shortcut | Shows the shortcut and opens Chrome's page for changing it |

Changes apply to open pages immediately. Switching a site off puts the page back exactly as it
was, and copying text from an annotated page copies only the original text.

### Word meanings

Switch on **Word meanings** and download a dictionary for the languages you want (Settings →
Downloads). Then rest the pointer on a word: it is highlighted and a small box shows the word,
its reading and its meanings. It works on any text on an enabled site, annotated or not.

- **Chinese**: pointing at any character of a word finds the whole word.
- **Japanese**: inflected words are looked up by their dictionary form (食べました → 食べる).
  This uses the Japanese readings download; without it only uninflected words are found.
- **Korean**: particles and common endings are stripped (한국어를 → 한국어, 갔어요 → 가다).
  This is done by rule rather than by a full grammar, so unusual forms are missed.

### Downloads and storage

The extension itself is about 0.8 MB, and Chinese (Mandarin and Cantonese) and Korean readings
work straight away. Everything large is a separate download that you choose in Settings →
Downloads, and can remove again there.

| Download | Size | Needed for |
|---|---|---|
| Japanese readings | 18 MB | Annotating Japanese at all |
| Chinese meanings | 3.9 MB | Word meanings |
| Japanese meanings | 7.1 MB | Word meanings |
| Korean meanings | 1.7 MB | Word meanings |

### Chinese or Japanese?

The two languages share their characters, so in **Auto-detect** each piece of text is judged by
the best evidence available, in this order:

1. Its own characters — kana, or a character only one of the languages uses (这 / 気).
2. A `lang` attribute on the page.
3. The surrounding passage.
4. The page as a whole.

A short word such as 日本 on its own, on a page with no other clues, is read as Chinese. If a
page is guessed wrong, pick the language explicitly.

## How it works

```
content script  ──▶  service worker  ──▶  offscreen document + worker
finds text,          Mandarin, Korean      Japanese, Cantonese, word meanings
draws <ruby>,
shows meanings
```

- The **content script** is small and does nothing on sites you have not enabled. It never loads
  a dictionary into a page; it sends text to the extension and draws the result as `<ruby>`.
  Meanings are shown in a box of its own, and the word is marked with the CSS highlight API, so
  the page's elements are not touched.
- The **service worker** converts Mandarin ([pinyin-pro](https://github.com/zh-lx/pinyin-pro))
  and Korean ([es-hangul](https://github.com/toss/es-hangul)).
- Everything that needs a large dictionary in memory runs in one **worker shared by all tabs**,
  and each dictionary is loaded only when first used: Japanese
  ([kuromoji](https://github.com/takuyaa/kuromoji.js) and
  [WanaKana](https://github.com/WaniKani/WanaKana)), Cantonese
  ([to-jyutping](https://github.com/CanCLID/to-jyutping)) and word meanings.
- **Downloads** come from the jsDelivr CDN — Japanese readings from the kuromoji package, word
  meanings from [`dictionaries/`](dictionaries/README.md) in this repository — and are checked
  file by file against checksums fixed when the extension is built, then kept in the browser's
  Cache Storage. An interrupted download picks up where it stopped.

Everything runs locally. No text leaves your browser; the only network requests the extension
ever makes are the downloads you start yourself.

## Development

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
```

```bash
npm run build
```

`npm run build` rewrites `dist/`. That folder is committed so the extension can be installed
without building, so commit it together with any source change; `npm test` fails if the two have
drifted apart.

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run test:e2e
```

`npm run test:e2e` builds the extension into `dist-test/`, loads it into Chromium with Playwright
and checks it against `test/e2e/fixture.html`. It serves the downloads from a local server, so it
needs no network. Screenshots are written to `test/e2e/output/`.

| Path | What it is |
|---|---|
| `src/content/` | Finds text, draws and removes annotations, shows meanings |
| `src/background/` | Message routing, keyboard shortcut, offscreen document lifecycle |
| `src/engines/` | Text → readings, one file per language |
| `src/meanings/` | Finding the dictionary word at a position, per language |
| `src/offscreen/` | Downloads dictionaries and runs them in a worker |
| `src/popup/` | Settings popup |
| `src/shared/` | Script detection, settings storage, download definitions, message types |
| `dictionaries/` | The word-meaning dictionaries the extension downloads, and their sources |

## Limitations

- Text inside form fields, editable areas and existing `<ruby>` is always left alone. Code blocks
  are left alone unless you switch on **Include code blocks** for the site.
- Annotations make lines wider, so on guitar tabs the chords above a lyric line can drift out
  of position. A smaller annotation size, or placing annotations below, reduces this.
- Text inside shadow DOM (some web components) is not annotated.
- A few web apps keep their own references to text on the page and can show stale text after an
  update while annotated. Switch the site off if a page misbehaves.
- Readings come from dictionaries, so rare names and ambiguous words are occasionally wrong.
  Cantonese readings are best on traditional characters.
- The Korean dictionary is the weakest of the three: part of it comes from a community word list
  with uneven quality.
- Cantonese is a setting, not something that is detected: written Cantonese and written Mandarin
  mostly use the same characters.

## License

GPL-3.0 — see [LICENSE](LICENSE). Bundled libraries: pinyin-pro (MIT), es-hangul (MIT), WanaKana
(MIT), to-jyutping (BSD-2-Clause), kuromoji (Apache-2.0). The dictionaries in `dictionaries/`
come from CC-CEDICT, JMdict, Wiktionary and KENGDIC and keep their own licences; see
[dictionaries/README.md](dictionaries/README.md).
