// Offscreen document: hosts the engine worker, which has to outlive the
// service worker so dictionaries are not reloaded every 30 seconds, and
// downloads those dictionaries when the user asks for them.
import { PACKS, packBytes, packCache } from '../shared/packs';
import type { EngineRequest, EngineResponse, OffscreenRequest, PackId, PackProgress, PackStatus } from '../shared/types';

// ---------------------------------------------------------------- engine

const worker = new Worker('worker.js');
const waiting = new Map<number, (response: EngineResponse) => void>();
let nextId = 1;

function ask(request: EngineRequest): Promise<EngineResponse> {
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    worker.postMessage({ id, request });
  });
}

worker.onmessage = (event: MessageEvent<{ id: number; response: EngineResponse }>) => {
  waiting.get(event.data.id)?.(event.data.response);
  waiting.delete(event.data.id);
};
worker.onerror = (event) => {
  for (const respond of waiting.values()) respond({ error: event.message || 'worker failed' });
  waiting.clear();
};

// ---------------------------------------------------------------- downloads

const statuses = new Map<PackId, PackStatus>();
const downloads = new Map<PackId, AbortController>();
const lastBroadcast = new Map<PackId, number>();

const statusOf = (pack: PackId): PackStatus => statuses.get(pack) ?? { state: 'missing' };

function setStatus(pack: PackId, status: PackStatus): void {
  statuses.set(pack, status);
  const now = Date.now();
  if (status.state === 'downloading' && now - (lastBroadcast.get(pack) ?? 0) < 100) return;
  lastBroadcast.set(pack, now);
  const message: PackProgress = { type: 'pack-progress', pack, status };
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function download(pack: PackId, signal: AbortSignal): Promise<void> {
  const { files } = PACKS[pack];
  const total = packBytes(pack);
  const cache = await caches.open(packCache(pack));
  const wanted = new Set(files.map((file) => file.url));
  // Drop files left over from an older version of this pack.
  for (const request of await cache.keys()) {
    if (!wanted.has(request.url)) await cache.delete(request);
  }

  let received = 0;
  setStatus(pack, { state: 'downloading', received, total });
  for (const file of files) {
    const name = file.url.slice(file.url.lastIndexOf('/') + 1);
    if (await cache.match(file.url)) {
      received += file.size; // kept from an earlier, interrupted download
      continue;
    }
    const response = await fetch(file.url, { cache: 'no-store', signal });
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`);

    const bytes = new Uint8Array(file.size);
    let offset = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > file.size) throw new Error(`${name} is larger than expected`);
      bytes.set(value, offset);
      offset += value.length;
      setStatus(pack, { state: 'downloading', received: received + offset, total });
    }
    // Only keep files that are exactly the ones this version was built against.
    if (offset !== file.size || (await sha256(bytes)) !== file.sha256) {
      throw new Error(`${name} did not match its checksum`);
    }
    if (signal.aborted) return;
    await cache.put(file.url, new Response(bytes, { headers: { 'content-type': 'application/gzip' } }));
    received += file.size;
  }
  void navigator.storage?.persist?.();
}

function startDownload(pack: PackId): void {
  if (downloads.has(pack)) return;
  const controller = new AbortController();
  downloads.set(pack, controller);
  download(pack, controller.signal)
    .then(
      () => ({ state: 'ready' }) as PackStatus,
      (error) => ({ state: 'error', message: error instanceof Error ? error.message : String(error) }) as PackStatus,
    )
    .then((status) => {
      if (downloads.get(pack) !== controller) return; // cancelled or removed meanwhile
      downloads.delete(pack);
      setStatus(pack, status);
    });
}

async function remove(pack: PackId): Promise<PackStatus> {
  downloads.get(pack)?.abort();
  downloads.delete(pack);
  await caches.delete(packCache(pack));
  await ask({ kind: 'unload', pack });
  setStatus(pack, { state: 'missing' });
  return statusOf(pack);
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message: OffscreenRequest, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return;
  switch (message.type) {
    case 'engine':
      void ask(message.request).then(sendResponse);
      return true; // respond asynchronously
    case 'pack-download':
      startDownload(message.pack);
      sendResponse(statusOf(message.pack));
      return;
    case 'pack-status':
      sendResponse(statusOf(message.pack));
      return;
    case 'pack-remove':
      void remove(message.pack).then(sendResponse);
      return true;
  }
});
