import { DICT_BYTES } from '../shared/dictionary';
import { loadState, saveSettings, setSite, siteKey } from '../shared/settings';
import type { DictionaryProgress, DictionaryRequest, DictionaryStatus, Settings } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const enabled = $<HTMLInputElement>('enabled');
const code = $<HTMLInputElement>('code');
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

// ---------------------------------------------------------------- Japanese dictionary

const dictHint = $('dictHint');
const dictButton = $<HTMLButtonElement>('dictButton');
const dictProgress = $<HTMLProgressElement>('dictProgress');
const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
let dictAction: DictionaryRequest['action'] = 'download';

function showDictionary(status: DictionaryStatus): void {
  dictButton.hidden = false;
  dictButton.disabled = false;
  dictButton.classList.toggle('primary', status.state === 'missing' || status.state === 'error');
  dictProgress.hidden = status.state !== 'downloading';
  switch (status.state) {
    case 'missing':
      dictHint.textContent = `Needs a ${megabytes(DICT_BYTES)} dictionary`;
      dictButton.textContent = 'Download';
      dictAction = 'download';
      break;
    case 'downloading':
      dictHint.textContent = `Downloading… ${megabytes(status.received)} of ${megabytes(status.total)}`;
      dictProgress.value = status.total ? status.received / status.total : 0;
      dictButton.textContent = 'Cancel';
      dictAction = 'remove';
      break;
    case 'ready':
      dictHint.textContent = `Downloaded · ${megabytes(DICT_BYTES)}`;
      dictButton.textContent = 'Remove';
      dictAction = 'remove';
      break;
    case 'error':
      dictHint.textContent = `Download failed: ${status.message}`;
      dictButton.textContent = 'Retry';
      dictAction = 'download';
      break;
  }
}

async function askDictionary(action: DictionaryRequest['action']): Promise<void> {
  const request: DictionaryRequest = { type: 'dictionary', action };
  try {
    showDictionary(await chrome.runtime.sendMessage(request));
  } catch (error) {
    showDictionary({ state: 'error', message: String(error) });
  }
}

dictButton.addEventListener('click', () => {
  dictButton.disabled = true;
  void askDictionary(dictAction);
});

chrome.runtime.onMessage.addListener((message: DictionaryProgress) => {
  if (message?.type === 'dictionary-progress') showDictionary(message.status);
});

void askDictionary('status');

// ---------------------------------------------------------------- settings

async function init(): Promise<void> {
  const [{ settings, sites, codeSites }, [tab]] = await Promise.all([
    loadState(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const key = siteKey(tab?.url);

  if (key === null) {
    enabled.disabled = true;
    code.disabled = true;
    site.textContent = 'Not available on this page';
  } else {
    site.textContent = key === 'file:' ? 'Local files' : key;
    enabled.checked = sites[key] === true;
    code.checked = codeSites[key] === true;
    code.disabled = !enabled.checked;
    if (enabled.checked && tab?.id !== undefined) void checkTab(tab.id);
    enabled.addEventListener('change', async () => {
      code.disabled = !enabled.checked;
      await setSite('sites', key, enabled.checked);
      if (enabled.checked && tab?.id !== undefined) await checkTab(tab.id);
      else showNotice(null);
    });
    code.addEventListener('change', () => void setSite('codeSites', key, code.checked));
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

// ---------------------------------------------------------------- shortcut

// Chrome only lets shortcuts be changed on its own settings page, so show the
// current one and link there.
async function showShortcut(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === 'toggle-site')?.shortcut ?? '';
  const key = $('shortcut');
  key.hidden = shortcut === '';
  key.textContent = shortcut;
  $('shortcutText').textContent = shortcut ? 'Shortcut to toggle this site:' : 'No shortcut to toggle this site.';
  $('shortcutChange').textContent = shortcut ? 'Change' : 'Set one';
}

$('shortcutChange').addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

void showShortcut();
void init();
