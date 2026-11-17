import { annotateChinese } from '../engines/chinese';
import { addKorean } from '../engines/korean';
import { loadState, setSiteEnabled, siteKey } from '../shared/settings';
import type {
  AnnotateRequest,
  AnnotateResponse,
  JapaneseRequest,
  JapaneseResponse,
  Segment,
  StateMessage,
} from '../shared/types';

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the Japanese dictionary in a worker shared by all tabs.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function japanese(texts: string[], style: AnnotateRequest['japanese']): Promise<Segment[][]> {
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
    } catch (error) {
      // Leave Japanese text un-annotated rather than failing the whole batch.
      console.warn('Pinyin Anything: Japanese annotation failed', error);
    }
  }

  items.forEach((item, i) => {
    if (item.han === 'zh') segments[i] = annotateChinese(item.text, request.pinyinTone);
    if (item.ko) segments[i] = addKorean(segments[i]);
  });
  return { segments };
}

chrome.runtime.onMessage.addListener(
  (message: AnnotateRequest | StateMessage | JapaneseRequest, sender, sendResponse) => {
    if (message?.type === 'annotate') {
      annotate(message).then(sendResponse, (error) => {
        console.error('Pinyin Anything: annotate failed', error);
        sendResponse({ segments: message.items.map((item) => [{ t: item.text }]) });
      });
      return true; // respond asynchronously
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
  await setSiteEnabled(key, !sites[key]);
});
