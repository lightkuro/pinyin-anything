import { loadState, saveSettings, setSiteEnabled, siteKey } from '../shared/settings';
import type { Settings } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const enabled = $<HTMLInputElement>('enabled');
const site = $('site');
const notice = $('notice');
const size = $<HTMLInputElement>('size');
const sizeValue = $('sizeValue');
const selects = ['language', 'pinyinTone', 'japanese'] as const;

function showNotice(text: string | null): void {
  notice.hidden = text === null;
  notice.textContent = text ?? '';
}

/** Pages opened before the extension was installed have no content script yet. */
async function checkTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    showNotice(null);
  } catch {
    showNotice('Reload this tab to start annotating it.');
  }
}

async function init(): Promise<void> {
  const [{ settings, sites }, [tab]] = await Promise.all([
    loadState(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const key = siteKey(tab?.url);

  if (key === null) {
    enabled.disabled = true;
    site.textContent = 'Not available on this page';
  } else {
    site.textContent = key === 'file:' ? 'Local files' : key;
    enabled.checked = sites[key] === true;
    if (enabled.checked && tab?.id !== undefined) void checkTab(tab.id);
    enabled.addEventListener('change', async () => {
      await setSiteEnabled(key, enabled.checked);
      if (enabled.checked && tab?.id !== undefined) await checkTab(tab.id);
      else showNotice(null);
    });
  }

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="position"]')) {
    radio.checked = radio.value === settings.position;
    radio.addEventListener('change', () => {
      if (radio.checked) void saveSettings({ position: radio.value as Settings['position'] });
    });
  }

  for (const id of selects) {
    const select = $<HTMLSelectElement>(id);
    select.value = settings[id];
    select.addEventListener('change', () => void saveSettings({ [id]: select.value }));
  }

  size.value = String(settings.size);
  sizeValue.textContent = `${settings.size}%`;
  size.addEventListener('input', () => (sizeValue.textContent = `${size.value}%`));
  size.addEventListener('change', () => void saveSettings({ size: Number(size.value) }));
}

void init();
