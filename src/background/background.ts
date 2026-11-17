import { annotateChinese } from '../engines/chinese';
import { addKorean } from '../engines/korean';
import { packCache, packReady } from '../shared/packs';
import { PACKS_CHANGED_KEY, loadState, setSite, siteKey } from '../shared/settings';
import type {
  AnnotateRequest,
  AnnotateResponse,
  EngineRequest,
  EngineResponse,
  LookupRequest,
  LookupResult,
  OffscreenRequest,
  PackId,
  PackProgress,
  PackRequest,
  PackStatus,
  Segment,
  StateMessage,
} from '../shared/types';

// ---------------------------------------------------------------- offscreen document

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
      justification: 'Downloads dictionaries and runs them in a worker shared by all tabs.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

const toOffscreen = <T>(message: OffscreenRequest): Promise<T> => chrome.runtime.sendMessage(message);

async function engine(request: EngineRequest): Promise<EngineResponse> {
  await ensureOffscreen();
  const response = await toOffscreen<EngineResponse | undefined>({ target: 'offscreen', type: 'engine', request });
  if (!response) throw new Error('engine unavailable');
  if ('error' in response) throw new Error(response.error);
  return response;
}

async function engineSegments(request: EngineRequest): Promise<Segment[][]> {
  const response = await engine(request);
  if (!('segments' in response)) throw new Error('unexpected engine response');
  return response.segments;
}

// ---------------------------------------------------------------- downloads

/** Tells open pages to look again, now that a download has appeared or gone. */
const announcePackChange = () => chrome.storage.local.set({ [PACKS_CHANGED_KEY]: Date.now() });

async function pack(id: PackId, action: PackRequest['action']): Promise<PackStatus> {
  if (action === 'remove') {
    // The offscreen document, if it is running, also has to stop any download
    // in progress and let go of what it loaded from the pack.
    if (await hasOffscreen()) await toOffscreen({ target: 'offscreen', type: 'pack-remove', pack: id });
    else await caches.delete(packCache(id));
    await announcePackChange();
    return { state: 'missing' };
  }
  if (await packReady(id)) return { state: 'ready' };
  if (action === 'download') await ensureOffscreen();
  else if (!(await hasOffscreen())) return { state: 'missing' };
  return toOffscreen({
    target: 'offscreen',
    type: action === 'download' ? 'pack-download' : 'pack-status',
    pack: id,
  });
}

// ---------------------------------------------------------------- annotating

async function annotate(request: AnnotateRequest): Promise<AnnotateResponse> {
  const { items } = request;
  const segments: Segment[][] = items.map((item) => [{ t: item.text }]);

  /** Sends the items read as `han` to the engine worker and stores what comes back. */
  const viaEngine = async (han: 'zh' | 'ja', build: (texts: string[]) => EngineRequest) => {
    const indexes = items.flatMap((item, i) => (item.han === han ? [i] : []));
    if (indexes.length === 0) return;
    try {
      const results = await engineSegments(build(indexes.map((i) => items[i].text)));
      indexes.forEach((index, n) => (segments[index] = results[n]));
    } catch {
      // Not downloaded, or the engine failed: leave this text un-annotated
      // rather than failing the whole batch.
    }
  };

  if (await packReady('ja-readings')) {
    await viaEngine('ja', (texts) => ({ kind: 'japanese', texts, style: request.japanese }));
  }
  if (request.chinese === 'jyutping') {
    await viaEngine('zh', (texts) => ({ kind: 'cantonese', texts, tone: request.pinyinTone }));
  }

  items.forEach((item, i) => {
    if (item.han === 'zh' && request.chinese === 'pinyin') {
      segments[i] = annotateChinese(item.text, request.pinyinTone);
    }
    if (item.ko) segments[i] = addKorean(segments[i]);
  });
  return { segments };
}

async function lookup(request: LookupRequest): Promise<LookupResult | null> {
  if (!(await packReady(`${request.language}-meanings`))) return null;
  const response = await engine({
    kind: 'lookup',
    text: request.text,
    offset: request.offset,
    language: request.language,
    cantonese: request.cantonese,
  });
  return 'result' in response ? response.result : null;
}

// ---------------------------------------------------------------- messages

type Incoming = AnnotateRequest | LookupRequest | StateMessage | PackRequest | PackProgress;

chrome.runtime.onMessage.addListener((message: Incoming, sender, sendResponse) => {
  switch (message?.type) {
    case 'annotate':
      annotate(message).then(sendResponse, (error) => {
        console.error('Pinyin Anything: annotate failed', error);
        sendResponse({ segments: message.items.map((item) => [{ t: item.text }]) });
      });
      return true; // respond asynchronously
    case 'lookup':
      lookup(message).then(sendResponse, () => sendResponse(null));
      return true;
    case 'pack':
      pack(message.pack, message.action).then(sendResponse, (error) =>
        sendResponse({ state: 'error', message: String(error) } satisfies PackStatus),
      );
      return true;
    case 'pack-progress':
      if (message.status.state === 'ready') void announcePackChange();
      return undefined;
    case 'state':
      if (sender.tab?.id !== undefined) {
        void chrome.action.setBadgeText({ tabId: sender.tab.id, text: message.enabled ? 'on' : '' });
      }
      return undefined;
  }
  return undefined;
});

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
