// End-to-end check: loads the built extension into Chromium and exercises it
// on a real page. Run `npm run build` first.
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../dist');
const output = join(here, 'output');
await mkdir(output, { recursive: true });

const fixture = await readFile(join(here, 'fixture.html'));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fixture);
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const profile = await mkdtemp(join(tmpdir(), 'pya-e2e-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 760, height: 900 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

let failed = false;
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const setStorage = (values) => worker.evaluate((v) => chrome.storage.sync.set(v), values);
  const setSettings = async (patch) => {
    const { settings } = await worker.evaluate(() => chrome.storage.sync.get('settings'));
    await setStorage({ settings: { ...settings, ...patch } });
  };

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url);

  /** Readings shown inside `selector`, in order. */
  const readings = (selector) =>
    page.$$eval(`${selector} pya-text rt`, (nodes) => nodes.map((n) => n.textContent).join(' '));
  const waitForReadings = (selector, expected) =>
    page.waitForFunction(
      ([sel, want]) =>
        [...document.querySelectorAll(`${sel} pya-text rt`)].map((n) => n.textContent).join(' ') === want,
      [selector, expected],
      { timeout: 20_000 },
    ).catch(async (error) => {
      throw new Error(`${selector}: expected "${expected}", got "${await readings(selector)}"`, { cause: error });
    });
  const step = async (name, fn) => {
    await fn();
    console.log(`ok  ${name}`);
  };

  // Screenshots use caret: 'initial' because Playwright's default caret hiding
  // leaves style="" on editable elements, which would spoil the exact-restore check.
  const originalHtml = await page.evaluate(() => document.body.innerHTML);

  await step('does nothing until the site is enabled', async () => {
    await page.waitForTimeout(500);
    assert.equal(await page.locator('pya-text').count(), 0);
  });

  await setStorage({ sites: { localhost: true } });

  await step('annotates Chinese with pinyin', () => waitForReadings('#zh', 'yín háng háng zhǎng shuō nǐ hǎo shì jiè'));
  await step('annotates Japanese with romaji', async () => {
    await waitForReadings('#ja', 'watashi wa toukyou e itte koohii o nomimashita');
    await waitForReadings('#ja-kanji', 'nihongo');
  });
  await step('reads the same word by its context on a mixed-language page', async () => {
    await waitForReadings('#zh-word', 'rì běn');
    await waitForReadings('#ja-word', 'nippon');
  });
  await step('annotates Korean with romanization', () =>
    waitForReadings('#ko', 'annyeonghaseyo hangugeoreul gongbuhamnida'));

  await step('leaves code, form fields, editable text and existing ruby alone', async () => {
    assert.equal(await page.locator('#pre pya-text, #textarea pya-text, #editable pya-text, #ruby pya-text, #latin pya-text').count(), 0);
  });

  await step('keeps the visible text unchanged and annotations out of selections', async () => {
    const text = await page.$eval('#zh', (el) => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll('rt').forEach((rt) => rt.remove());
      return copy.textContent;
    });
    assert.equal(text, '银行行长说：你好，世界！Hello 2024.');
    assert.equal(await page.$eval('#zh rt', (rt) => getComputedStyle(rt).userSelect), 'none');
  });

  await step('shows annotations above by default', async () => {
    assert.equal(await page.$eval('#zh ruby', (r) => getComputedStyle(r).rubyPosition), 'over');
    const above = await page.$eval('#zh ruby', (ruby) => {
      const rt = ruby.querySelector('rt').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(ruby.firstChild);
      return rt.bottom <= range.getBoundingClientRect().top + 4;
    });
    assert.ok(above, 'reading should sit above the character');
    await page.screenshot({ path: join(output, 'above.png'), caret: 'initial' });
  });

  await step('moves annotations below', async () => {
    await setSettings({ position: 'under' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#zh ruby')).rubyPosition === 'under');
    const below = await page.$eval('#zh ruby', (ruby) => {
      const rt = ruby.querySelector('rt').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(ruby.firstChild);
      return rt.top >= range.getBoundingClientRect().bottom - 4;
    });
    assert.ok(below, 'reading should sit below the character');
    await page.screenshot({ path: join(output, 'below.png'), caret: 'initial' });
    await setSettings({ position: 'over' });
  });

  await step('annotates text added later', async () => {
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = '这是后来添加的文字';
      document.querySelector('#dynamic').append(p);
    });
    await waitForReadings('#dynamic', 'zhè shì hòu lái tiān jiā de wén zì');
  });

  await step('follows text changed in place', async () => {
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'changing';
      p.textContent = 'not yet';
      document.querySelector('#dynamic').append(p);
      setTimeout(() => (p.firstChild.data = '中文'), 200);
    });
    await waitForReadings('#changing', 'zhōng wén');
    await page.evaluate(() => document.querySelector('#dynamic').replaceChildren());
  });

  await step('switches pinyin tone style and Japanese reading style live', async () => {
    await setSettings({ pinyinTone: 'num', japanese: 'hiragana' });
    await waitForReadings('#zh', 'yin2 hang2 hang2 zhang3 shuo1 ni3 hao3 shi4 jie4');
    await waitForReadings('#ja', 'わたし とうきょう い の');
    await setSettings({ pinyinTone: 'symbol', japanese: 'romaji' });
    await waitForReadings('#ja', 'watashi wa toukyou e itte koohii o nomimashita');
  });

  await step('honours a single-language setting', async () => {
    await setSettings({ language: 'ko' });
    await waitForReadings('#zh', '');
    await waitForReadings('#ko', 'annyeonghaseyo hangugeoreul gongbuhamnida');
    assert.equal(await page.locator('#ja pya-text').count(), 0);
    await setSettings({ language: 'zh' });
    await waitForReadings('#ja-kanji', 'rì běn yǔ');
    assert.equal(await page.locator('#ko pya-text').count(), 0);
    await setSettings({ language: 'auto' });
    await waitForReadings('#ja-kanji', 'nihongo');
  });

  await step('popup renders and reflects settings', async () => {
    const popup = await context.newPage();
    const popupErrors = [];
    popup.on('pageerror', (error) => popupErrors.push(String(error)));
    await popup.setViewportSize({ width: 320, height: 420 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => document.querySelector('#sizeValue').textContent !== '');
    assert.equal(await popup.inputValue('#language'), 'auto');
    assert.equal(await popup.isChecked('input[name="position"][value="over"]'), true);
    await popup.locator('label:has(input[value="under"])').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('pya-position') === 'under');
    await popup.locator('label:has(input[value="over"])').click();
    await popup.screenshot({ path: join(output, 'popup.png') });
    assert.deepEqual(popupErrors, []);
    await popup.close();
  });

  await step('restores the page exactly when switched off', async () => {
    await setStorage({ sites: {} });
    await page.waitForFunction(() => document.querySelectorAll('pya-text').length === 0);
    assert.equal(await page.evaluate(() => document.body.innerHTML), originalHtml);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('pya-position')), false);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('style')), null);
  });

  assert.deepEqual(errors, [], 'page errors');
  console.log('\nAll end-to-end checks passed.');
} catch (error) {
  failed = true;
  console.error('\nFAILED:', error);
} finally {
  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
