// The Japanese dictionary is not shipped with the extension. It is downloaded
// on request and kept in Cache Storage, where the popup, the service worker and
// the Japanese worker can all see it.

/** Filled in by build.mjs from the installed kuromoji package. */
declare const __DICT__: {
  baseUrl: string;
  files: { name: string; size: number; sha256: string }[];
};

export const DICT = __DICT__;
export const DICT_CACHE = 'japanese-dictionary';
export const DICT_BYTES = DICT.files.reduce((sum, file) => sum + file.size, 0);
export const dictUrl = (name: string) => DICT.baseUrl + name;

/** True once every dictionary file has been downloaded and verified. */
export async function dictionaryReady(): Promise<boolean> {
  if (!(await caches.has(DICT_CACHE))) return false;
  const cache = await caches.open(DICT_CACHE);
  const stored = new Set((await cache.keys()).map((request) => request.url));
  return DICT.files.every((file) => stored.has(dictUrl(file.name)));
}
