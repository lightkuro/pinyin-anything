// Offscreen document: exists only to host the Japanese worker, which has to
// outlive the service worker so the dictionary is not reloaded every 30 seconds.
import type { JapaneseRequest, JapaneseResponse } from '../shared/types';
import type { WorkerRequest, WorkerResponse } from './worker';

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

chrome.runtime.onMessage.addListener((message: JapaneseRequest, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.type !== 'japanese') return;
  const id = nextId++;
  waiting.set(id, sendResponse);
  worker.postMessage({ id, texts: message.texts, style: message.style } satisfies WorkerRequest);
  return true; // respond asynchronously
});
