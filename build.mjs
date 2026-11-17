// Bundles the extension into dist/, which is the folder to load in Chrome.
//
//   PYA_OUT       output folder (default: dist)
//   PYA_PACK_URL  base URL the downloadable packs are fetched from, instead of
//                 the public CDN; the tests point this at a local server that
//                 serves kuromoji/<file> and dictionaries/<file>
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';

const out = process.env.PYA_OUT ?? 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Nothing large ships with the extension: dictionaries are downloaded by the
// user on demand. Record exactly which files each download consists of, so a
// download is only accepted if it matches what this build was tested against.
async function files(dir, names, baseUrl) {
  const list = [];
  for (const name of names) {
    const bytes = await readFile(`${dir}/${name}`);
    list.push({
      url: baseUrl + name,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return list;
}

const local = process.env.PYA_PACK_URL;
const kuromoji = JSON.parse(await readFile('node_modules/kuromoji/package.json', 'utf8'));
const kuromojiDir = 'node_modules/kuromoji/dict';
const kuromojiUrl = local ? `${local}kuromoji/` : `https://cdn.jsdelivr.net/npm/kuromoji@${kuromoji.version}/dict/`;
// The meaning dictionaries live in this repository and are fetched from the
// commit named in dictionaries/published.json.
const { commit } = JSON.parse(await readFile('dictionaries/published.json', 'utf8'));
const meaningsUrl = local
  ? `${local}dictionaries/`
  : `https://cdn.jsdelivr.net/gh/lightkuro/pinyin-anything@${commit}/dictionaries/`;

const packs = {
  'ja-readings': {
    files: await files(kuromojiDir, (await readdir(kuromojiDir)).filter((n) => n.endsWith('.dat.gz')).sort(), kuromojiUrl),
  },
  'zh-meanings': { files: await files('dictionaries', ['zh.txt.gz'], meaningsUrl) },
  'ja-meanings': { files: await files('dictionaries', ['ja.txt.gz'], meaningsUrl) },
  'ko-meanings': { files: await files('dictionaries', ['ko.txt.gz'], meaningsUrl) },
};

const common = {
  bundle: true,
  minify: true,
  target: 'chrome116',
  // The bundles are full of CJK text; escaping it would nearly double them.
  charset: 'utf8',
  logLevel: 'info',
  define: { __PACKS__: JSON.stringify(packs) },
};

await Promise.all([
  build({ ...common, entryPoints: ['src/background/background.ts'], outfile: `${out}/background.js`, format: 'esm' }),
  build({
    ...common,
    format: 'iife',
    outdir: out,
    entryPoints: {
      content: 'src/content/content.ts',
      popup: 'src/popup/popup.ts',
      offscreen: 'src/offscreen/offscreen.ts',
      worker: 'src/offscreen/worker.ts',
      jyutping: 'src/offscreen/jyutping.ts',
    },
  }),
  cp('manifest.json', `${out}/manifest.json`),
  cp('icons', `${out}/icons`, { recursive: true }),
  cp('src/content/content.css', `${out}/content.css`),
  cp('src/popup/popup.html', `${out}/popup.html`),
  cp('src/popup/popup.css', `${out}/popup.css`),
  cp('src/offscreen/offscreen.html', `${out}/offscreen.html`),
]);
