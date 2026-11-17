// Bundles the extension into dist/, which is the folder to load in Chrome.
//
//   PYA_OUT       output folder (default: dist)
//   PYA_DICT_URL  where the Japanese dictionary is downloaded from (default:
//                 the kuromoji package on jsDelivr); the tests point this at a
//                 local server
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';

const out = process.env.PYA_OUT ?? 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// The Japanese dictionary is downloaded by the user on demand rather than
// shipped. Record exactly which files this build expects, so a download is
// only accepted if it matches the dictionary the code was tested against.
const kuromoji = JSON.parse(await readFile('node_modules/kuromoji/package.json', 'utf8'));
const dictDir = 'node_modules/kuromoji/dict';
const files = [];
for (const name of (await readdir(dictDir)).filter((n) => n.endsWith('.dat.gz')).sort()) {
  const bytes = await readFile(`${dictDir}/${name}`);
  files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const dictionary = {
  baseUrl: process.env.PYA_DICT_URL ?? `https://cdn.jsdelivr.net/npm/kuromoji@${kuromoji.version}/dict/`,
  files,
};

const common = {
  bundle: true,
  minify: true,
  target: 'chrome116',
  logLevel: 'info',
  define: { __DICT__: JSON.stringify(dictionary) },
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
      'ja-worker': 'src/offscreen/worker.ts',
    },
  }),
  cp('manifest.json', `${out}/manifest.json`),
  cp('icons', `${out}/icons`, { recursive: true }),
  cp('src/content/content.css', `${out}/content.css`),
  cp('src/popup/popup.html', `${out}/popup.html`),
  cp('src/popup/popup.css', `${out}/popup.css`),
  cp('src/offscreen/offscreen.html', `${out}/offscreen.html`),
]);
