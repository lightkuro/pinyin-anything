# Pinyin Anything

A Chrome extension that shows how to read Chinese, Japanese and Korean text on any web page,
above or below the original text.

| Text | Annotation |
|---|---|
| Chinese — 银行行长 | pinyin — yín háng háng zhǎng |
| Japanese — 東京へ行きました | romaji — toukyou e ikimashita (or hiragana over the kanji) |
| Korean — 안녕하세요 | romanization — annyeonghaseyo |

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
switch on **Annotate this site** — the choice is remembered per site. `Alt+Shift+P` toggles the
current site without opening the popup.

Pages that were already open when you installed the extension need one reload.

### Languages and storage

The extension itself is about 0.6 MB. Chinese and Korean are built in. Japanese needs an 18 MB
dictionary, so it is a separate download: click **Download** next to Japanese in the popup. Until
then Japanese text is simply left alone. **Remove** deletes the dictionary again.

| Language | Storage | |
|---|---|---|
| Chinese | 0.4 MB | Built in |
| Korean | under 0.1 MB | Built in |
| Japanese | 18 MB | Downloaded on request |

Chinese and Korean are not separate downloads because they are program code rather than data
(Chrome does not let an extension download code after it is installed) and together they are
smaller than one photo.

| Option | Choices |
|---|---|
| Position | Above or below the text |
| Language | Auto-detect, or Chinese / Japanese / Korean only |
| Pinyin tones | Marks (nǐ hǎo), numbers (ni3 hao3) or none (ni hao) |
| Japanese style | Romaji, or hiragana over kanji only |
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
- Japanese needs a word-by-word analysis and a large dictionary
  ([kuromoji](https://github.com/takuyaa/kuromoji.js), kana conversion by
  [WanaKana](https://github.com/WaniKani/WanaKana)). That runs in a worker shared by all tabs and
  is only started the first time Japanese text is seen. While in use it holds about 100 MB of
  memory.
- The dictionary is downloaded from the kuromoji package on the jsDelivr CDN, checked file by
  file against checksums fixed at build time, and kept in the browser's Cache Storage. An
  interrupted download picks up where it stopped.

Everything runs locally. No text leaves your browser; the only network request the extension
ever makes is the dictionary download you start yourself.

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
and checks it against `test/e2e/fixture.html`. It serves the Japanese dictionary from a local
server, so it needs no network. Screenshots are written to `test/e2e/output/`.

| Path | What it is |
|---|---|
| `src/content/` | Finds text, draws and removes annotations |
| `src/background/` | Message routing, keyboard shortcut, offscreen document lifecycle |
| `src/engines/` | Text → readings, one file per language |
| `src/offscreen/` | Downloads the Japanese dictionary and runs it in a worker |
| `src/popup/` | Settings popup |
| `src/shared/` | Script detection, settings storage, dictionary location, message types |

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
