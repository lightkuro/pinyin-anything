// Offscreen document: hosts the Japanese worker, which has to outlive the
// service worker so the dictionary is not reloaded every 30 seconds, and
// downloads that dictionary when the user asks for it.
import { DICT, DICT_BYTES, DICT_CACHE, dictUrl } from '../shared/dictionary';
import type {
  DictionaryProgress,
  DictionaryStatus,
  JapaneseRequest,
  JapaneseResponse,
  OffscreenDictionaryRequest,
} from '../shared/types';
import type { WorkerRequest, WorkerResponse } from './worker';

// ---------------------------------------------------------------- tokenizing

const worker = new Worker('ja-worker.js');
const waiting = new Map<number, (response: JapaneseResponse) => void>();
let nextId = 1;

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const { id, segments, error } = event.data;
  waiting.get(id)?.({ segments, error });
  waiting.delete(id);
};
worker.onerror = (event) => {
  for (const respond of waiting.values()) respond({ error: event.message || 'worker failed' });
  waiting.clear();
};

// ---------------------------------------------------------------- downloading

let status: DictionaryStatus = { state: 'missing' };
let lastBroadcast = 0;

function setStatus(next: DictionaryStatus): void {
  status = next;
  const now = Date.now();
  if (next.state === 'downloading' && now - lastBroadcast < 100) return;
  lastBroadcast = now;
  const message: DictionaryProgress = { type: 'dictionary-progress', status };
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function download(): Promise<void> {
  const cache = await caches.open(DICT_CACHE);
  const wanted = new Set(DICT.files.map((file) => dictUrl(file.name)));
  // Drop files left over from an older dictionary version.
  for (const request of await cache.keys()) {
    if (!wanted.has(request.url)) await cache.delete(request);
  }

  let received = 0;
  setStatus({ state: 'downloading', received, total: DICT_BYTES });
  for (const file of DICT.files) {
    const url = dictUrl(file.name);
    if (await cache.match(url)) {
      received += file.size; // kept from an earlier, interrupted download
      continue;
    }
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`);

    const bytes = new Uint8Array(file.size);
    let offset = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > file.size) throw new Error(`${file.name} is larger than expected`);
      bytes.set(value, offset);
      offset += value.length;
      setStatus({ state: 'downloading', received: received + offset, total: DICT_BYTES });
    }
    // Only keep files that are exactly the ones this version was built against.
    if (offset !== file.size || (await sha256(bytes)) !== file.sha256) {
      throw new Error(`${file.name} did not match its checksum`);
    }
    await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/gzip' } }));
    received += file.size;
  }
  void navigator.storage?.persist?.();
}

function startDownload(): void {
  if (status.state === 'downloading') return;
  download().then(
    () => setStatus({ state: 'ready' }),
    (error) => setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener(
  (message: JapaneseRequest | OffscreenDictionaryRequest, _sender, sendResponse) => {
    if (message?.target !== 'offscreen') return;
    switch (message.type) {
      case 'japanese': {
        const id = nextId++;
        waiting.set(id, sendResponse);
        worker.postMessage({ id, texts: message.texts, style: message.style } satisfies WorkerRequest);
        return true; // respond asynchronously
      }
      case 'dictionary-download':
        startDownload();
        sendResponse(status);
        return;
      case 'dictionary-status':
        sendResponse(status);
        return;
    }
  },
);
