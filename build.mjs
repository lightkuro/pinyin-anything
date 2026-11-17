// Bundles the extension into dist/, which is the folder to load in Chrome.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const out = 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = { bundle: true, minify: true, target: 'chrome116', logLevel: 'info' };

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
  // kuromoji ships a ready-made browser bundle plus its dictionary files.
  cp('node_modules/kuromoji/build/kuromoji.js', `${out}/kuromoji.js`),
  cp('node_modules/kuromoji/dict', `${out}/dict`, { recursive: true }),
]);
