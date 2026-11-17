// Finds CJK text on the page and wraps it in <ruby> annotations. All language
// work happens in the extension's background; this script only touches the DOM,
// and does nothing at all until the user enables the site.
import { guessHanLanguage, hasCjk, hasHan, hasHangul, hasKana } from '../shared/script';
import { PACKS_CHANGED_KEY, loadState, siteKey } from '../shared/settings';
import type {
  AnnotateItem,
  AnnotateRequest,
  AnnotateResponse,
  HanLanguage,
  Language,
  Segment,
  Settings,
  StateMessage,
} from '../shared/types';
import { createMeanings } from './meanings';

const WRAPPER = 'pya-text';
/** Never annotated: not visible text, form controls, or already annotated. */
const ALWAYS_SKIP = [
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'RUBY', 'RT', 'RP', 'SVG', 'MATH', 'IFRAME', 'CANVAS', WRAPPER.toUpperCase(), 'PYA-TIP',
];
/**
 * Skipped by default because annotations get in the way of real code, but
 * some sites (lyrics, guitar tabs) put ordinary text in these; the user can
 * include them per site.
 */
const CODE_TAGS = ['CODE', 'PRE', 'KBD', 'SAMP'];
const EDITABLE = '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';

let includeCode = false;
let skipTags = new Set<string>();
let skipSelector = '';

function setIncludeCode(include: boolean): void {
  includeCode = include;
  skipTags = new Set(include ? ALWAYS_SKIP : [...ALWAYS_SKIP, ...CODE_TAGS]);
  skipSelector = `${[...skipTags].join(',').toLowerCase()},${EDITABLE}`;
}
setIncludeCode(false);

const BATCH_CHARS = 4000;
const BATCH_NODES = 250;

const isTop = window.top === window;

/** The site this frame belongs to: iframes follow the page they are embedded in. */
function topSiteKey(): string | null {
  if (isTop) return siteKey(location.href);
  const ancestors = location.ancestorOrigins;
  return siteKey(ancestors?.[ancestors.length - 1]) ?? siteKey(location.href);
}

let settings: Settings | null = null;
let active = false;
/** Bumped whenever in-flight results must be thrown away (disable, settings change). */
let generation = 0;
let pumping = false;
let scheduled = false;
let pageLanguage: HanLanguage | undefined;

const pending = new Set<Text>();
/** Text nodes that were checked and need no annotation, so they are not re-sent. */
let settled = new WeakSet<Text>();
const originals = new WeakMap<Element, string>();
/** How the Han characters in each annotated piece of text were read. */
const wrapperLanguages = new WeakMap<Element, HanLanguage | null>();
/** Whether this page has had Japanese text to annotate (the popup asks). */
let sawJapanese = false;
let nearbyCache = new WeakMap<Element, HanLanguage | null>();

// ---------------------------------------------------------------- language

function wants(text: string): boolean {
  switch (settings!.language) {
    case 'zh': return hasHan(text);
    case 'ja': return hasHan(text) || hasKana(text);
    case 'ko': return hasHangul(text);
    default: return hasCjk(text);
  }
}

/** What the text around `el` says about its language, looking a few levels up. */
function nearbyLanguage(el: Element): HanLanguage | null {
  let current: Element | null = el;
  for (let depth = 0; depth < 3 && current && current !== document.body; depth++) {
    let known = nearbyCache.get(current);
    if (known === undefined) {
      known = guessHanLanguage(current.textContent ?? '');
      nearbyCache.set(current, known);
    }
    if (known) return known;
    current = current.parentElement;
  }
  return null;
}

/**
 * Chinese and Japanese share their characters, so each piece of text is judged
 * by the strongest evidence available: its own characters, then a lang
 * attribute, then the surrounding passage, then the page as a whole.
 */
function hanLanguage(node: Text): HanLanguage | null {
  const language = settings!.language;
  if (language === 'zh' || language === 'ja') return language;
  if (language === 'ko') return null;

  const text = node.data;
  if (!hasHan(text) && !hasKana(text)) return null;
  const own = guessHanLanguage(text);
  if (own) return own;
  const parent = node.parentElement;
  if (!parent) return null;
  const declared = parent.closest('[lang]')?.getAttribute('lang')?.toLowerCase() ?? '';
  if (declared.startsWith('ja')) return 'ja';
  if (declared.startsWith('zh')) return 'zh';
  if (declared.startsWith('ko')) return null; // hanja in Korean text: leave alone
  const nearby = nearbyLanguage(parent);
  if (nearby) return nearby;
  if (pageLanguage === undefined) {
    pageLanguage = guessHanLanguage((document.body?.textContent ?? '').slice(0, 100_000)) ?? 'zh';
  }
  return pageLanguage;
}

// ---------------------------------------------------------------- collecting

function skipped(el: Element | null): boolean {
  return !el || el.closest(skipSelector) !== null;
}

function consider(node: Text): void {
  if (settled.has(node) || !wants(node.data)) return;
  pending.add(node);
}

function scan(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!skipped(root.parentElement)) consider(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || skipped(root as Element)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as HTMLElement;
      if (skipTags.has(el.tagName.toUpperCase()) || el.isContentEditable) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  while (walker.nextNode()) consider(walker.currentNode as Text);
}

const observer = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === 'characterData') {
      settled.delete(record.target as Text);
      scan(record.target);
    } else {
      record.addedNodes.forEach((node) => {
        if ((node as Element).localName !== WRAPPER) scan(node);
      });
    }
  }
  schedule();
});

// ---------------------------------------------------------------- annotating

function schedule(): void {
  if (scheduled || pumping || pending.size === 0 || !active) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    void pump();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 300 });
  else setTimeout(run, 50);
}

function nextBatch(): Text[] {
  const batch: Text[] = [];
  let chars = 0;
  for (const node of pending) {
    pending.delete(node);
    if (!node.isConnected || skipped(node.parentElement)) continue;
    batch.push(node);
    chars += node.data.length;
    if (chars >= BATCH_CHARS || batch.length >= BATCH_NODES) break;
  }
  return batch;
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (active && pending.size > 0) {
      const mine = generation;
      const nodes = nextBatch();
      if (nodes.length === 0) continue;
      const items: AnnotateItem[] = nodes.map((node) => ({
        text: node.data,
        han: hanLanguage(node),
        ko: settings!.language === 'auto' || settings!.language === 'ko' ? hasHangul(node.data) : false,
      }));
      if (items.some((item) => item.han === 'ja')) sawJapanese = true;
      const request: AnnotateRequest = {
        type: 'annotate',
        items,
        chinese: settings!.chinese,
        pinyinTone: settings!.pinyinTone,
        japanese: settings!.japanese,
      };
      const response: AnnotateResponse | undefined = await chrome.runtime.sendMessage(request);
      if (mine !== generation || !active) continue;
      nodes.forEach((node, i) => render(node, items[i], response?.segments[i]));
      // Let the page breathe between batches.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    // Typically "Extension context invalidated" after the extension is reloaded.
    console.debug('Pinyin Anything stopped:', error);
    pending.clear();
  } finally {
    pumping = false;
    schedule();
  }
}

function render(node: Text, item: AnnotateItem, segments: Segment[] | undefined): void {
  const sent = item.text;
  if (!node.isConnected) return;
  if (node.data !== sent) {
    pending.add(node); // the page changed it while we were waiting
    return;
  }
  if (!segments || !segments.some((seg) => seg.r !== undefined)) {
    settled.add(node);
    return;
  }
  const wrapper = document.createElement(WRAPPER);
  for (const seg of segments) {
    if (seg.r === undefined) {
      wrapper.append(seg.t);
      continue;
    }
    const ruby = document.createElement('ruby');
    const rt = document.createElement('rt');
    rt.textContent = seg.r;
    ruby.append(seg.t, rt);
    wrapper.append(ruby);
  }
  originals.set(wrapper, sent);
  wrapperLanguages.set(wrapper, item.han);
  node.replaceWith(wrapper);
}

/** Puts every annotated text node back exactly as it was. */
function restoreAll(): void {
  document.querySelectorAll(WRAPPER).forEach((wrapper) => {
    let text = originals.get(wrapper);
    if (text === undefined) {
      const copy = wrapper.cloneNode(true) as Element;
      copy.querySelectorAll('rt').forEach((rt) => rt.remove());
      text = copy.textContent ?? '';
    }
    wrapper.replaceWith(document.createTextNode(text));
  });
}

// ---------------------------------------------------------------- lifecycle

function reset(): void {
  generation++;
  pending.clear();
  settled = new WeakSet();
  nearbyCache = new WeakMap();
  pageLanguage = undefined;
}

const LOOK_ATTRIBUTES = ['pya-position', 'pya-visibility', 'pya-color'];

function applyLook(next: Settings): void {
  const root = document.documentElement;
  root.setAttribute('pya-position', next.position);
  root.setAttribute('pya-visibility', next.visibility);
  root.setAttribute('pya-color', next.color);
  root.style.setProperty('--pya-size', `${next.size}%`);
}

function start(): void {
  active = true;
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (document.body) scan(document.body);
  schedule();
}

function stop(): void {
  active = false;
  observer.disconnect();
  meanings.hide();
  reset();
  restoreAll();
  const root = document.documentElement;
  for (const attribute of LOOK_ATTRIBUTES) root.removeAttribute(attribute);
  root.style.removeProperty('--pya-size');
  if (root.getAttribute('style') === '') root.removeAttribute('style');
}

function rescan(): void {
  observer.disconnect();
  meanings.hide();
  reset();
  restoreAll();
  start();
}

async function sync(): Promise<void> {
  const state = await loadState();
  const key = topSiteKey();
  const enabled = key !== null && state.sites[key] === true;
  const previous = settings;
  settings = state.settings;
  const wantCode = key !== null && state.codeSites[key] === true;
  const codeChanged = wantCode !== includeCode;
  setIncludeCode(wantCode);

  if (enabled) {
    applyLook(settings);
    if (!active) start();
    else if (
      codeChanged ||
      (previous &&
        (previous.language !== settings.language ||
          previous.chinese !== settings.chinese ||
          previous.pinyinTone !== settings.pinyinTone ||
          previous.japanese !== settings.japanese))
    ) {
      rescan();
    }
    if (!settings.meanings) meanings.hide();
  } else if (active) {
    stop();
  }

  if (isTop) {
    const message: StateMessage = { type: 'state', enabled };
    chrome.runtime.sendMessage(message).catch(() => {});
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.settings || changes.sites || changes.codeSites)) void sync();
  // A download was installed or removed: text that was skipped can now be
  // annotated, or the other way round.
  if (area === 'local' && changes[PACKS_CHANGED_KEY] && active) rescan();
});

// Lets the popup find out whether this tab has a live content script.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') sendResponse({ ok: true, japanese: sawJapanese });
});

// ---------------------------------------------------------------- word meanings

const meanings = createMeanings({
  enabled: () => active && settings?.meanings === true,
  cantonese: () => settings?.chinese === 'jyutping',
  wrapperTag: WRAPPER,
  originalText: (wrapper) => originals.get(wrapper),
  languageOf(char, node, wrapper): Language | null {
    const language = settings!.language;
    if (hasHangul(char)) return language === 'auto' || language === 'ko' ? 'ko' : null;
    if (language === 'ko') return null;
    if (hasKana(char)) return language === 'zh' ? null : 'ja';
    return wrapper ? (wrapperLanguages.get(wrapper) ?? null) : hanLanguage(node);
  },
});

void sync();
