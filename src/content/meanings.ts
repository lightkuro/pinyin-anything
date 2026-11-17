// Word meanings: when the pointer rests on a Chinese, Japanese or Korean word,
// look it up and show its meaning in a small box next to it. Nothing here
// changes the page's own elements; the box lives in a shadow root and the word
// is marked with the CSS highlight API.
import { hasHan, hasHangul, hasKana } from '../shared/script';
import type { Language, LookupRequest, LookupResult } from '../shared/types';

export interface MeaningsHost {
  /** Whether meanings should currently be shown at all. */
  enabled(): boolean;
  cantonese(): boolean;
  /** The annotation wrapper's tag name, and the text it replaced. */
  wrapperTag: string;
  originalText(wrapper: Element): string | undefined;
  /** Which dictionary applies to `char` in this place, or null for none. */
  languageOf(char: string, node: Text, wrapper: Element | null): Language | null;
}

const DWELL_MS = 90;
/** Longer texts are sent as a window around the pointer rather than whole. */
const WHOLE_TEXT_LIMIT = 400;
const WINDOW = 80;
const MAX_SENSES = 6;
const HIGHLIGHT = 'pya-word';

const TIP_STYLE = `
  :host { all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; pointer-events: none; }
  .tip {
    box-sizing: border-box; max-width: 340px; padding: 10px 12px; border-radius: 8px;
    background: #fffdf8; color: #1f1d1a; border: 1px solid #d9d4cb;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif;
    text-align: left; overflow-wrap: anywhere;
  }
  @media (prefers-color-scheme: dark) {
    .tip { background: #252320; color: #f1eee9; border-color: #45413a; box-shadow: 0 6px 24px rgb(0 0 0 / 0.5); }
    .reading { color: #fb923c; }
    li::marker { color: #a39d93; }
  }
  .entry + .entry { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgb(128 128 128 / 0.25); }
  .word { font-size: 17px; font-weight: 600; margin-right: 8px; }
  .reading { color: #c2410c; }
  ol { margin: 4px 0 0; padding-left: 20px; }
  ol.single { list-style: none; padding-left: 0; }
  li::marker { color: #6f6a62; font-size: 11px; }
`;

interface Hit {
  node: Text;
  /** Index of the character under the pointer within `node`. */
  index: number;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The character of a text node that is actually under the point, if any. */
function characterAt(x: number, y: number): Hit | null {
  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const node = caret.node as Text;
  const range = document.createRange();
  // The caret sits between two characters; the pointer is over one of them.
  for (const index of [caret.offset, caret.offset - 1]) {
    if (index < 0 || index >= node.data.length) continue;
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    for (const rect of range.getClientRects()) {
      if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) {
        return { node, index };
      }
    }
  }
  return null;
}

export function createMeanings(host: MeaningsHost) {
  let tip: HTMLElement | null = null;
  let box: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointer = { x: 0, y: 0 };
  let sequence = 0;
  /** What is showing now: which text it belongs to and which part of it. */
  let shown: { container: Node; start: number; end: number } | null = null;

  const wrapperOf = (node: Node) => node.parentElement?.closest(host.wrapperTag) ?? null;

  /** The pieces of original text inside a wrapper, in order, skipping the readings. */
  function* baseTexts(wrapper: Element): Generator<Text> {
    for (const child of wrapper.childNodes) {
      const text = child.nodeType === Node.TEXT_NODE ? child : child.firstChild;
      if (text?.nodeType === Node.TEXT_NODE) yield text as Text;
    }
  }

  /** Where a character of a wrapper's original text now lives in the page. */
  function locate(wrapper: Element, index: number): { node: Text; offset: number } | null {
    let passed = 0;
    for (const text of baseTexts(wrapper)) {
      if (index < passed + text.data.length) return { node: text, offset: index - passed };
      passed += text.data.length;
    }
    return null;
  }

  function hide(): void {
    clearTimeout(timer);
    sequence++;
    shown = null;
    tip?.remove();
    tip = box = null;
    CSS.highlights?.delete(HIGHLIGHT);
  }

  function rangeFor(container: Node, start: number, end: number): Range | null {
    const range = document.createRange();
    if (container.nodeType === Node.TEXT_NODE) {
      range.setStart(container, start);
      range.setEnd(container, end);
      return range;
    }
    const first = locate(container as Element, start);
    const last = locate(container as Element, end - 1);
    if (!first || !last) return null;
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset + 1);
    // Take in the reading that belongs to the last character as well.
    const ruby = last.node.parentElement;
    if (ruby?.localName === 'ruby' && last.offset + 1 === last.node.data.length) range.setEndAfter(ruby);
    return range;
  }

  function show(result: LookupResult, range: Range): void {
    if (!tip) {
      tip = document.createElement('pya-tip');
      const root = tip.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = TIP_STYLE;
      box = document.createElement('div');
      box.className = 'tip';
      root.append(style, box);
      document.documentElement.append(tip);
    }
    box!.replaceChildren(
      ...result.meanings.map((meaning) => {
        const entry = document.createElement('div');
        entry.className = 'entry';
        const word = document.createElement('span');
        word.className = 'word';
        word.textContent = meaning.word;
        const reading = document.createElement('span');
        reading.className = 'reading';
        reading.textContent = meaning.reading;
        const list = document.createElement('ol');
        if (meaning.senses.length === 1) list.className = 'single';
        for (const sense of meaning.senses.slice(0, MAX_SENSES)) {
          const item = document.createElement('li');
          item.textContent = sense;
          list.append(item);
        }
        entry.append(word, reading, list);
        return entry;
      }),
    );

    CSS.highlights?.set(HIGHLIGHT, new Highlight(range));

    // Below the word if there is room, otherwise above it.
    const word = range.getBoundingClientRect();
    const size = box!.getBoundingClientRect();
    const gap = 6;
    const below = word.bottom + gap;
    const top = below + size.height <= innerHeight - 4 ? below : Math.max(4, word.top - gap - size.height);
    const left = Math.max(4, Math.min(word.left, innerWidth - size.width - 4));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  async function probe(): Promise<void> {
    if (!host.enabled()) return hide();
    const hit = characterAt(pointer.x, pointer.y);
    if (!hit) return hide();

    let { node, index } = hit;
    const wrapper = wrapperOf(node);
    let container: Node = node;
    let text = node.data;
    if (wrapper) {
      // Pointing at a reading counts as pointing at the text it belongs to.
      const ruby = node.parentElement?.closest('ruby');
      if (node.parentElement?.localName === 'rt' && ruby?.firstChild?.nodeType === Node.TEXT_NODE) {
        node = ruby.firstChild as Text;
        index = 0;
      }
      const original = host.originalText(wrapper);
      if (original === undefined) return hide();
      for (const base of baseTexts(wrapper)) {
        if (base === node) break;
        index += base.data.length;
      }
      container = wrapper;
      text = original;
    }
    if (shown && shown.container === container && index >= shown.start && index < shown.end) return;

    const char = text[index] ?? '';
    if (!hasHan(char) && !hasKana(char) && !hasHangul(char)) return hide();
    const language = host.languageOf(char, node, wrapper);
    if (!language) return hide();

    const from = text.length <= WHOLE_TEXT_LIMIT ? 0 : Math.max(0, index - WINDOW);
    const to = text.length <= WHOLE_TEXT_LIMIT ? text.length : Math.min(text.length, index + WINDOW);
    const request: LookupRequest = {
      type: 'lookup',
      text: text.slice(from, to),
      offset: index - from,
      language,
      cantonese: host.cantonese(),
    };
    const mine = ++sequence;
    let result: LookupResult | null = null;
    try {
      result = await chrome.runtime.sendMessage(request);
    } catch {
      // extension reloaded; nothing to show
    }
    if (mine !== sequence) return; // the pointer has moved on
    if (!result || result.meanings.length === 0 || !container.isConnected) return hide();
    const start = result.start + from;
    const end = result.end + from;
    const range = rangeFor(container, start, end);
    if (!range) return hide();
    shown = { container, start, end };
    show(result, range);
  }

  document.addEventListener(
    'mousemove',
    (event) => {
      if (!host.enabled()) return;
      pointer = { x: event.clientX, y: event.clientY };
      clearTimeout(timer);
      timer = setTimeout(() => void probe(), DWELL_MS);
    },
    { passive: true },
  );
  for (const type of ['scroll', 'keydown', 'mousedown', 'blur'] as const) {
    window.addEventListener(type, () => (tip || timer !== undefined) && hide(), { passive: true, capture: true });
  }
  document.documentElement.addEventListener('mouseleave', hide);

  return { hide };
}
