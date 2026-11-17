import { annotateChinese } from '../engines/chinese';
import { addKorean } from '../engines/korean';
import { DICT_CACHE, dictionaryReady } from '../shared/dictionary';
import { DICT_CHANGED_KEY, loadState, setSite, siteKey } from '../shared/settings';
import type {
  AnnotateRequest,
  AnnotateResponse,
  DictionaryProgress,
  DictionaryRequest,
  DictionaryStatus,
  JapaneseRequest,
  JapaneseResponse,
  OffscreenDictionaryRequest,
  Segment,
  StateMessage,
} from '../shared/types';

let creatingOffscreen: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return existing.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Downloads the Japanese dictionary and runs it in a worker shared by all tabs.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

/** Tells open pages to look again, now that Japanese has become (un)available. */
const announceDictionaryChange = () => chrome.storage.local.set({ [DICT_CHANGED_KEY]: Date.now() });

async function dictionary(action: DictionaryRequest['action']): Promise<DictionaryStatus> {
  if (action === 'remove') {
    // Closing the document also stops a running download and frees the worker's memory.
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
    await caches.delete(DICT_CACHE);
    await announceDictionaryChange();
    return { state: 'missing' };
  }
  if (await dictionaryReady()) return { state: 'ready' };
  if (action === 'download') await ensureOffscreen();
  else if (!(await hasOffscreen())) return { state: 'missing' };
  const request: OffscreenDictionaryRequest = {
    target: 'offscreen',
    type: action === 'download' ? 'dictionary-download' : 'dictionary-status',
  };
  return chrome.runtime.sendMessage(request);
}

async function japanese(texts: string[], style: AnnotateRequest['japanese']): Promise<Segment[][]> {
  if (!(await dictionaryReady())) throw new Error('Japanese dictionary is not downloaded');
  await ensureOffscreen();
  const request: JapaneseRequest = { target: 'offscreen', type: 'japanese', texts, style };
  const response: JapaneseResponse = await chrome.runtime.sendMessage(request);
  if (!response?.segments) throw new Error(response?.error ?? 'Japanese engine unavailable');
  return response.segments;
}

async function annotate(request: AnnotateRequest): Promise<AnnotateResponse> {
  const { items } = request;
  const segments: Segment[][] = items.map((item) => [{ t: item.text }]);

  const jaIndexes = items.flatMap((item, i) => (item.han === 'ja' ? [i] : []));
  if (jaIndexes.length > 0) {
    try {
      const results = await japanese(
        jaIndexes.map((i) => items[i].text),
        request.japanese,
      );
      jaIndexes.forEach((index, n) => (segments[index] = results[n]));
    } catch {
      // Dictionary not downloaded, or the engine failed: leave Japanese text
      // un-annotated rather than failing the whole batch.
    }
  }

  items.forEach((item, i) => {
    if (item.han === 'zh') segments[i] = annotateChinese(item.text, request.pinyinTone);
    if (item.ko) segments[i] = addKorean(segments[i]);
  });
  return { segments };
}

type Incoming = AnnotateRequest | StateMessage | DictionaryRequest | DictionaryProgress;

chrome.runtime.onMessage.addListener(
  (message: Incoming, sender, sendResponse) => {
    if (message?.type === 'annotate') {
      annotate(message).then(sendResponse, (error) => {
        console.error('Pinyin Anything: annotate failed', error);
        sendResponse({ segments: message.items.map((item) => [{ t: item.text }]) });
      });
      return true; // respond asynchronously
    }
    if (message?.type === 'dictionary') {
      dictionary(message.action).then(sendResponse, (error) =>
        sendResponse({ state: 'error', message: String(error) } satisfies DictionaryStatus),
      );
      return true;
    }
    if (message?.type === 'dictionary-progress' && message.status.state === 'ready') {
      void announceDictionaryChange();
    }
    if (message?.type === 'state' && sender.tab?.id !== undefined) {
      void chrome.action.setBadgeText({ tabId: sender.tab.id, text: message.enabled ? 'on' : '' });
    }
    return undefined;
  },
);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
  void chrome.action.setBadgeTextColor({ color: '#ffffff' });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-site') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = siteKey(tab?.url);
  if (!key) return;
  const { sites } = await loadState();
  await setSite('sites', key, !sites[key]);
});
