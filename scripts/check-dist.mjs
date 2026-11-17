// dist/ is committed so the extension can be loaded without building it.
// This fails if dist/ no longer matches what the source builds to.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(dir, path)));
    else out.push(path);
  }
  return out.sort();
}

const fresh = await mkdtemp(join(tmpdir(), 'pya-dist-'));
try {
  const env = { ...process.env, PYA_OUT: fresh };
  delete env.PYA_DICT_URL;
  execFileSync(process.execPath, ['build.mjs'], { env, stdio: 'ignore' });

  const [expected, actual] = await Promise.all([listFiles(fresh), listFiles('dist').catch(() => [])]);
  const stale = [];
  for (const file of new Set([...expected, ...actual])) {
    const [a, b] = await Promise.all([
      readFile(join(fresh, file)).catch(() => null),
      readFile(join('dist', file)).catch(() => null),
    ]);
    if (!a || !b || !a.equals(b)) stale.push(file);
  }
  if (stale.length > 0) {
    console.error(`dist/ is out of date (${stale.join(', ')}).\nRun "npm run build" and commit the result.`);
    process.exit(1);
  }
  console.log(`dist/ matches the source (${expected.length} files).`);
} finally {
  await rm(fresh, { recursive: true, force: true });
}
