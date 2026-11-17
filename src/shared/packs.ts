// Downloadable data. None of it ships with the extension: each pack is fetched
// when the user asks for it and kept in Cache Storage, where the popup, the
// service worker and the engine worker can all see it.
import type { PackId } from './types';

export interface PackFile {
  url: string;
  size: number;
  sha256: string;
}

/** Filled in by build.mjs, which records the exact files each pack consists of. */
declare const __PACKS__: Record<PackId, { files: PackFile[] }>;

export const PACKS = __PACKS__;
export const PACK_IDS = Object.keys(PACKS) as PackId[];

export const packBytes = (id: PackId) => PACKS[id].files.reduce((sum, file) => sum + file.size, 0);

/** Japanese readings keep the cache name they had before other packs existed. */
export const packCache = (id: PackId) => (id === 'ja-readings' ? 'japanese-dictionary' : `pack-${id}`);

/** True once every file of the pack has been downloaded and verified. */
export async function packReady(id: PackId): Promise<boolean> {
  const name = packCache(id);
  if (!(await caches.has(name))) return false;
  const cache = await caches.open(name);
  const stored = new Set((await cache.keys()).map((request) => request.url));
  return PACKS[id].files.every((file) => stored.has(file.url));
}

/** The pack file whose URL ends with `name`. */
export function packFile(id: PackId, name: string): PackFile {
  const file = PACKS[id].files.find((f) => f.url.endsWith(`/${name}`));
  if (!file) throw new Error(`${id} has no file ${name}`);
  return file;
}

/** Reads a stored, gzipped pack file back into memory. */
export async function readPackFile(id: PackId, name: string): Promise<ArrayBuffer> {
  const cache = await caches.open(packCache(id));
  const stored = await cache.match(packFile(id, name).url);
  if (!stored?.body) throw new Error(`${id} is not downloaded`);
  return new Response(stored.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
