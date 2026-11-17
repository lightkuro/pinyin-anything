# Pinyin Anything

A Chrome extension that shows how to read Chinese, Japanese and Korean text on any web page,
above or below the original text.

| Text | Annotation |
|---|---|
| Chinese — 银行行长 | pinyin — yín háng háng zhǎng |
| Japanese — 東京へ行きました | romaji — toukyou e ikimashita (or hiragana over the kanji) |
| Korean — 안녕하세요 | romanization — annyeonghaseyo |

## Install

The extension is built from source (the Japanese dictionary is too large to keep in the repo).
You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist` folder.

## Use

Annotation is off everywhere until you ask for it. Open a page, click the extension icon and
switch on **Annotate this site** — the choice is remembered per site. `Alt+Shift+P` toggles the
current site without opening the popup.

Pages that were already open when you installed the extension need one reload.

| Option | Choices |
|---|---|
| Position | Above or below the text |
| Language | Auto-detect, or Chinese / Japanese / Korean only |
| Pinyin tones | Marks (nǐ hǎo), numbers (ni3 hao3) or none (ni hao) |
| Japanese | Romaji, or hiragana over kanji only |
| Size | Annotation size relative to the text |

Changes apply to open pages immediately. Switching a site off puts the page back exactly as it
was, and copying text from an annotated page copies only the original text.

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
finds text,          Chinese, Korean       Japanese (kuromoji + dictionary)
draws <ruby>
```

- The **content script** is small and does nothing on sites you have not enabled. It never loads
  a dictionary into a page; it sends text to the extension and draws the result as `<ruby>`.
- The **service worker** converts Chinese ([pinyin-pro](https://github.com/zh-lx/pinyin-pro)) and
  Korean ([es-hangul](https://github.com/toss/es-hangul)).
- Japanese needs a word-by-word analysis and a 17 MB dictionary
  ([kuromoji](https://github.com/takuyaa/kuromoji.js), kana conversion by
  [WanaKana](https://github.com/WaniKani/WanaKana)). That runs in a worker shared by all tabs and
  is only started the first time Japanese text is seen.

Everything runs locally. No text leaves your browser.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run test:e2e
```

`npm run test:e2e` loads the built extension into Chromium with Playwright and checks it against
`test/e2e/fixture.html`; run `npm run build` first. Screenshots are written to
`test/e2e/output/`.

| Path | What it is |
|---|---|
| `src/content/` | Finds text, draws and removes annotations |
| `src/background/` | Message routing, keyboard shortcut, offscreen document lifecycle |
| `src/engines/` | Text → readings, one file per language |
| `src/offscreen/` | The page and worker that host the Japanese dictionary |
| `src/popup/` | Settings popup |
| `src/shared/` | Script detection, settings storage, message types |

## Limitations

- Text inside code blocks, form fields, editable areas and existing `<ruby>` is left alone on
  purpose.
- Text inside shadow DOM (some web components) is not annotated.
- A few web apps keep their own references to text on the page and can show stale text after an
  update while annotated. Switch the site off if a page misbehaves.
- Readings come from dictionaries, so rare names and ambiguous words are occasionally wrong.

## License

GPL-3.0 — see [LICENSE](LICENSE). Bundled libraries: pinyin-pro (MIT), es-hangul (MIT), WanaKana
(MIT), kuromoji (Apache-2.0).
