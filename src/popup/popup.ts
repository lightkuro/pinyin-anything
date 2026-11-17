import { PACK_IDS, packBytes } from '../shared/packs';
import { loadState, saveSettings, setSite, siteKey } from '../shared/settings';
import type { PackId, PackProgress, PackRequest, PackStatus, Settings } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- views

const mainView = $('mainView');
const settingsView = $('settingsView');

function showSettings(open: boolean): void {
  mainView.hidden = open;
  settingsView.hidden = !open;
  (open ? $('closeSettings') : $('openSettings')).focus();
}
$('openSettings').addEventListener('click', () => showSettings(true));
$('closeSettings').addEventListener('click', () => showSettings(false));

// ---------------------------------------------------------------- downloads

const PACK_LABELS: Record<PackId, { name: string; purpose: string }> = {
  'ja-readings': { name: 'Japanese readings', purpose: 'Needed to annotate Japanese' },
  'zh-meanings': { name: 'Chinese meanings', purpose: 'Word meanings' },
  'ja-meanings': { name: 'Japanese meanings', purpose: 'Word meanings' },
  'ko-meanings': { name: 'Korean meanings', purpose: 'Word meanings' },
};

const megabytes = (bytes: number) => `${bytes < 9.95e6 ? (bytes / 1e6).toFixed(1) : Math.round(bytes / 1e6)} MB`;
const packStates = new Map<PackId, PackStatus['state']>();
const packViews = new Map<PackId, (status: PackStatus) => void>();

function addPackRow(pack: PackId): void {
  const row = ($<HTMLTemplateElement>('packRow').content.cloneNode(true) as DocumentFragment).firstElementChild!;
  row.id = `pack-${pack}`;
  const hint = row.querySelector<HTMLElement>('.hint')!;
  const button = row.querySelector('button')!;
  const progress = row.querySelector('progress')!;
  const size = megabytes(packBytes(pack));
  let action: PackRequest['action'] = 'download';
  row.querySelector('.label')!.textContent = PACK_LABELS[pack].name;

  const show = (status: PackStatus) => {
    packStates.set(pack, status.state);
    button.hidden = false;
    button.disabled = false;
    button.classList.toggle('primary', status.state === 'missing' || status.state === 'error');
    progress.hidden = status.state !== 'downloading';
    switch (status.state) {
      case 'missing':
        hint.textContent = `${PACK_LABELS[pack].purpose} · ${size}`;
        button.textContent = 'Download';
        action = 'download';
        break;
      case 'downloading':
        hint.textContent = `Downloading… ${megabytes(status.received)} of ${megabytes(status.total)}`;
        progress.value = status.total ? status.received / status.total : 0;
        button.textContent = 'Cancel';
        action = 'remove';
        break;
      case 'ready':
        hint.textContent = `Downloaded · ${size}`;
        button.textContent = 'Remove';
        action = 'remove';
        break;
      case 'error':
        hint.textContent = `Download failed: ${status.message}`;
        button.textContent = 'Retry';
        action = 'download';
        break;
    }
    showPackHints();
  };
  packViews.set(pack, show);

  const ask = async (what: PackRequest['action']) => {
    const request: PackRequest = { type: 'pack', pack, action: what };
    try {
      show(await chrome.runtime.sendMessage(request));
    } catch (error) {
      show({ state: 'error', message: String(error) });
    }
  };
  button.addEventListener('click', () => {
    button.disabled = true;
    void ask(action);
  });
  $('packs').append(row);
  void ask('status');
}

chrome.runtime.onMessage.addListener((message: PackProgress) => {
  if (message?.type === 'pack-progress') packViews.get(message.pack)?.(message.status);
});

// ---------------------------------------------------------------- hints that depend on downloads

const notice = $('notice');
let needsReload = false;
let pageHasJapanese = false;

function showPackHints(): void {
  const anyMeanings = PACK_IDS.some((pack) => pack.endsWith('-meanings') && packStates.get(pack) === 'ready');
  $('meaningsHint').textContent = anyMeanings ? 'Point at a word to see it' : 'Download a dictionary in Settings';

  let text: string | null = null;
  if (needsReload) text = 'Reload this tab to start annotating it.';
  else if (pageHasJapanese && packStates.has('ja-readings') && packStates.get('ja-readings') !== 'ready') {
    text = 'This page has Japanese text. Japanese readings are a separate download — see Settings.';
  }
  notice.hidden = text === null;
  notice.textContent = text ?? '';
}

/** Pages opened before the extension was installed have no content script yet. */
async function checkTab(tabId: number): Promise<void> {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    needsReload = false;
    pageHasJapanese = reply?.japanese === true;
  } catch {
    needsReload = true;
  }
  showPackHints();
}

// ---------------------------------------------------------------- settings

const enabled = $<HTMLInputElement>('enabled');
const code = $<HTMLInputElement>('code');
const size = $<HTMLInputElement>('size');
const sizeValue = $('sizeValue');
const selects = ['language', 'chinese', 'pinyinTone', 'japanese', 'visibility', 'color'] as const;

/** Jyutping has no tone-mark spelling, so the choices follow the reading. */
function showToneChoices(chinese: Settings['chinese'], current: Settings['pinyinTone']): void {
  const choices: [Settings['pinyinTone'], string][] =
    chinese === 'jyutping'
      ? [['symbol', 'Numbers (nei5 hou2)'], ['none', 'None (nei hou)']]
      : [['symbol', 'Marks (nǐ hǎo)'], ['num', 'Numbers (ni3 hao3)'], ['none', 'None (ni hao)']];
  const select = $<HTMLSelectElement>('pinyinTone');
  select.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
  select.value = chinese === 'jyutping' && current === 'num' ? 'symbol' : current;
}

async function init(): Promise<void> {
  const [{ settings, sites, codeSites }, [tab]] = await Promise.all([
    loadState(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const key = siteKey(tab?.url);

  if (key === null) {
    enabled.disabled = true;
    code.disabled = true;
    $('site').textContent = 'Not available on this page';
  } else {
    $('site').textContent = key === 'file:' ? 'Local files' : key;
    enabled.checked = sites[key] === true;
    code.checked = codeSites[key] === true;
    code.disabled = !enabled.checked;
    if (enabled.checked && tab?.id !== undefined) void checkTab(tab.id);
    enabled.addEventListener('change', async () => {
      code.disabled = !enabled.checked;
      await setSite('sites', key, enabled.checked);
      if (enabled.checked && tab?.id !== undefined) await checkTab(tab.id);
      else {
        needsReload = false;
        showPackHints();
      }
    });
    code.addEventListener('change', () => void setSite('codeSites', key, code.checked));
  }

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="position"]')) {
    radio.checked = radio.value === settings.position;
    radio.addEventListener('change', () => {
      if (radio.checked) void saveSettings({ position: radio.value as Settings['position'] });
    });
  }

  showToneChoices(settings.chinese, settings.pinyinTone);
  for (const id of selects) {
    const select = $<HTMLSelectElement>(id);
    if (id !== 'pinyinTone') select.value = settings[id];
    select.addEventListener('change', () => {
      void saveSettings({ [id]: select.value });
      if (id === 'chinese') {
        showToneChoices(select.value as Settings['chinese'], $<HTMLSelectElement>('pinyinTone').value as Settings['pinyinTone']);
      }
    });
  }

  const meanings = $<HTMLInputElement>('meanings');
  meanings.checked = settings.meanings;
  meanings.addEventListener('change', () => void saveSettings({ meanings: meanings.checked }));

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
  $('shortcutHint').textContent = shortcut || 'Not set';
  $('shortcutChange').textContent = shortcut ? 'Change' : 'Set';
}

$('shortcutChange').addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

for (const pack of PACK_IDS) addPackRow(pack);
showPackHints();
void showShortcut();
void init();
