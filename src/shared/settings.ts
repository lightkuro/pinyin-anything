import type { Settings } from './types';

export const DEFAULTS: Settings = {
  position: 'over',
  language: 'auto',
  pinyinTone: 'symbol',
  japanese: 'romaji',
  size: 55,
};

/** storage.local key bumped whenever the Japanese dictionary is installed or removed. */
export const DICT_CHANGED_KEY = 'japaneseDictionaryChanged';

export interface State {
  settings: Settings;
  /** Sites the user has switched annotation on for, keyed by siteKey(). */
  sites: Record<string, true>;
  /** Sites where code and preformatted blocks are annotated too. */
  codeSites: Record<string, true>;
}

/** The per-site switches kept in storage. */
export type SiteList = 'sites' | 'codeSites';

export async function loadState(): Promise<State> {
  const stored = await chrome.storage.sync.get(['settings', 'sites', 'codeSites']);
  return {
    settings: { ...DEFAULTS, ...(stored.settings as Partial<Settings> | undefined) },
    sites: (stored.sites as Record<string, true> | undefined) ?? {},
    codeSites: (stored.codeSites as Record<string, true> | undefined) ?? {},
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const { settings } = await loadState();
  await chrome.storage.sync.set({ settings: { ...settings, ...patch } });
}

export async function setSite(list: SiteList, key: string, on: boolean): Promise<void> {
  const sites = (await loadState())[list];
  if (on) sites[key] = true;
  else delete sites[key];
  await chrome.storage.sync.set({ [list]: sites });
}

/**
 * The key a page is remembered under: its hostname, or "file:" for local
 * files. Returns null for pages extensions can't run on (chrome://, the Web
 * Store, etc.).
 */
export function siteKey(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.hostname;
  if (parsed.protocol === 'file:') return 'file:';
  return null;
}
