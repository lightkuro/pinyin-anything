// End-to-end check: builds the extension, loads it into Chromium and exercises
// it on a real page. Downloads are served from a local server instead of the
// public CDN, so the test needs no network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dist = join(root, 'dist-test');
const output = join(here, 'output');
await mkdir(output, { recursive: true });

const fixture = await readFile(join(here, 'fixture.html'));
const PACK_DIRS = { kuromoji: 'node_modules/kuromoji/dict', dictionaries: 'dictionaries' };
/** Set to a file name to serve that file damaged, once. */
let damageOnce = null;
const packRequests = [];
const server = createServer(async (req, res) => {
  const match = /^\/(kuromoji|dictionaries)\/([\w.]+)$/.exec(req.url);
  if (!match) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixture);
    return;
  }
  const [, kind, file] = match;
  packRequests.push(file);
  const bytes = await readFile(join(root, PACK_DIRS[kind], file));
  if (damageOnce === file) {
    damageOnce = null;
    bytes[bytes.length >> 1] ^= 0xff;
  }
  res.writeHead(200, { 'content-type': 'application/gzip', 'access-control-allow-origin': '*' });
  res.end(bytes);
}).listen(0);
const origin = `http://localhost:${server.address().port}`;
const url = `${origin}/`;

execFileSync(process.execPath, ['build.mjs'], {
  cwd: root,
  env: { ...process.env, PYA_OUT: dist, PYA_PACK_URL: `${origin}/` },
  stdio: 'ignore',
});

const profile = await mkdtemp(join(tmpdir(), 'pya-e2e-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 760, height: 1100 },
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
  const ZH = 'yín háng háng zhǎng shuō nǐ hǎo shì jiè';
  const JA = 'watashi wa toukyou e itte koohii o nomimashita';
  const KO = 'annyeonghaseyo hangugeoreul gongbuhamnida';

  // Screenshots use caret: 'initial' because Playwright's default caret hiding
  // leaves style="" on editable elements, which would spoil the exact-restore check.
  const originalHtml = await page.evaluate(() => document.body.innerHTML);

  await step('does nothing until the site is enabled', async () => {
    await page.waitForTimeout(500);
    assert.equal(await page.locator('pya-text').count(), 0);
  });

  await setStorage({ sites: { localhost: true } });

  await step('annotates Chinese with pinyin', () => waitForReadings('#zh', ZH));

  // ---- the popup: everyday controls, and a settings panel behind one row
  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('pageerror', (error) => popupErrors.push(String(error)));
  await popup.setViewportSize({ width: 320, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForFunction(() => document.querySelector('#sizeValue').textContent !== '');

  /** Controls for one row of the Downloads list. */
  const pack = (id) => {
    const row = popup.locator(`#pack-${id}`);
    return {
      button: row.locator('button'),
      progress: row.locator('progress'),
      waitForHint: (pattern) =>
        popup.waitForFunction(
          ([rowId, source]) => new RegExp(source).test(document.querySelector(`#pack-${rowId} .hint`).textContent),
          [id, pattern.source],
          { timeout: 30_000 },
        ),
    };
  };
  const cachedFiles = (name) =>
    worker.evaluate(async (n) => ((await caches.has(n)) ? (await (await caches.open(n)).keys()).length : 0), name);

  await step('keeps everyday controls on the main view, with Settings in a row below Size', async () => {
    const visible = (selector) => popup.locator(selector).isVisible();
    for (const id of ['#enabled + .switch', '.segmented', '#language', '#meanings + .switch', '#size', '#openSettings']) {
      assert.equal(await visible(id), true, `${id} should be on the main view`);
    }
    for (const id of ['#chinese', '#pinyinTone', '#japanese', '#visibility', '#color', '#packs']) {
      assert.equal(await visible(id), false, `${id} should be tucked away in settings`);
    }
    const order = await popup.$$eval('#mainView .options > *', (rows) => rows.map((r) => r.querySelector('.label').textContent));
    assert.deepEqual(order, ['Position', 'Language', 'Word meanings', 'Size', 'Settings']);
    const height = await popup.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(height <= 600, `main view is ${height}px tall`);
    await popup.setViewportSize({ width: 320, height });
    await popup.screenshot({ path: join(output, 'popup.png') });
    await popup.setViewportSize({ width: 320, height: 600 });
  });

  await step('opens the settings panel and comes back', async () => {
    await popup.click('#openSettings');
    for (const id of ['#chinese', '#pinyinTone', '#japanese', '#visibility', '#color', '#packs']) {
      assert.equal(await popup.locator(id).isVisible(), true, `${id} should be in settings`);
    }
    assert.equal(await popup.locator('#size').isVisible(), false);
    assert.equal(await popup.locator('#packs .pack').count(), 4);
    await popup.click('#closeSettings');
    assert.equal(await popup.locator('#size').isVisible(), true);
    await popup.click('#openSettings');
  });

  // ---- Japanese readings are a separate download
  const jaReadings = pack('ja-readings');

  await step('ships without the Japanese dictionary and leaves Japanese text alone', async () => {
    await jaReadings.waitForHint(/^Needed to annotate Japanese · 18 MB$/);
    assert.equal(await jaReadings.button.textContent(), 'Download');
    assert.equal(await jaReadings.progress.isVisible(), false);
    assert.equal(await page.locator('#ja pya-text, #ja-kanji pya-text, #ja-context pya-text').count(), 0);
    assert.deepEqual(packRequests, [], 'nothing is downloaded until asked');
  });

  await step('rejects a damaged download and keeps nothing from the bad file', async () => {
    damageOnce = 'cc.dat.gz';
    await jaReadings.button.click();
    await jaReadings.waitForHint(/^Download failed: cc\.dat\.gz did not match its checksum$/);
    assert.equal(await jaReadings.button.textContent(), 'Retry');
    assert.equal(await page.locator('#ja pya-text').count(), 0);
  });

  await step('downloads on request, resuming with the files it already has', async () => {
    const before = packRequests.length;
    await jaReadings.button.click();
    await jaReadings.waitForHint(/^Downloaded · 18 MB$/);
    assert.equal(await jaReadings.button.textContent(), 'Remove');
    assert.equal(await jaReadings.progress.isVisible(), false);
    assert.equal(await cachedFiles('japanese-dictionary'), 12);
    const again = packRequests.slice(before);
    assert.ok(again.includes('cc.dat.gz') && !again.includes('base.dat.gz'), `re-fetched: ${again}`);
  });

  await step('annotates Japanese with romaji as soon as the download finishes', async () => {
    await waitForReadings('#ja', JA);
    await waitForReadings('#ja-kanji', 'nihongo');
  });

  await step('removes the dictionary and its annotations on request', async () => {
    await jaReadings.button.click();
    await jaReadings.waitForHint(/^Needed to annotate Japanese · 18 MB$/);
    assert.equal(await cachedFiles('japanese-dictionary'), 0);
    await waitForReadings('#ja', '');
    await waitForReadings('#zh', ZH);
    await jaReadings.button.click();
    await jaReadings.waitForHint(/^Downloaded · 18 MB$/);
    await waitForReadings('#ja', JA);
  });

  await step('reads the same word by its context on a mixed-language page', async () => {
    await waitForReadings('#zh-word', 'rì běn');
    await waitForReadings('#ja-word', 'nippon');
  });
  await step('annotates Korean with romanization', () => waitForReadings('#ko', KO));

  await step('leaves code, form fields, editable text and existing ruby alone', async () => {
    assert.equal(await page.locator('#pre pya-text, #code pya-text, #textarea pya-text, #editable pya-text, #ruby pya-text, #latin pya-text').count(), 0);
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
    await waitForReadings('#ja', JA);
  });

  await step('reads Chinese as Cantonese when that is chosen in settings', async () => {
    await popup.selectOption('#chinese', 'jyutping');
    await waitForReadings('#zh', 'ngan4 hong4 haang4 coeng4 syut3 nei5 hou2 sai3 gaai3');
    assert.deepEqual(await popup.$$eval('#pinyinTone option', (o) => o.map((x) => x.textContent)), [
      'Numbers (nei5 hou2)',
      'None (nei hou)',
    ]);
    await popup.selectOption('#pinyinTone', 'none');
    await waitForReadings('#zh', 'ngan hong haang coeng syut nei hou sai gaai');
    await waitForReadings('#ja', JA); // other languages are unaffected
    await popup.selectOption('#pinyinTone', 'symbol');
    await popup.selectOption('#chinese', 'pinyin');
    await waitForReadings('#zh', ZH);
  });

  await step('can hide readings until pointed at, and soften their colour', async () => {
    const rt = () => page.$eval('#zh rt', (el) => ({ visibility: getComputedStyle(el).visibility, color: getComputedStyle(el).color }));
    const normal = await rt();
    assert.equal(normal.visibility, 'visible');
    await popup.selectOption('#visibility', 'hover');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#zh rt')).visibility === 'hidden');
    await page.hover('#zh pya-text');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#zh rt')).visibility === 'visible');
    await page.mouse.move(700, 1000);
    await popup.selectOption('#visibility', 'always');
    await popup.selectOption('#color', 'muted');
    await page.waitForFunction((before) => getComputedStyle(document.querySelector('#zh rt')).color !== before, normal.color);
    await popup.selectOption('#color', 'inherit');
    await page.waitForFunction((before) => getComputedStyle(document.querySelector('#zh rt')).color === before, normal.color);
  });

  // ---- word meanings
  /** Rests the pointer on the first occurrence of `text` inside `selector`. */
  const pointAt = async (selector, text) => {
    const point = await page.evaluate(
      ([sel, needle]) => {
        const walker = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.parentElement.closest('rt')) continue;
          const index = node.data.indexOf(needle[0]);
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        return null;
      },
      [selector, text],
    );
    assert.ok(point, `"${text}" not found in ${selector}`);
    await page.mouse.move(point.x - 2, point.y);
    await page.mouse.move(point.x, point.y);
  };
  const tip = page.locator('pya-tip .tip');
  const waitForTip = (pattern) =>
    page.waitForFunction(
      (source) => new RegExp(source, 's').test(document.querySelector('pya-tip')?.shadowRoot.querySelector('.tip').innerText ?? ''),
      pattern.source,
      { timeout: 15_000 },
    ).catch(async (error) => {
      const shown = (await tip.count()) ? await tip.innerText() : '(no box)';
      throw new Error(`expected a meaning matching ${pattern}, got: ${shown}`, { cause: error });
    });
  const waitForNoTip = () => page.waitForFunction(() => !document.querySelector('pya-tip'), null, { timeout: 5_000 });
  const highlighted = () => page.evaluate(() => [...(CSS.highlights.get('pya-word') ?? [])].map((r) => r.toString()).join(''));

  await step('shows no meanings until a dictionary is downloaded', async () => {
    assert.equal(await popup.locator('#meaningsHint').textContent(), 'Download a dictionary in Settings');
    await pointAt('#zh', '银');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('pya-tip').count(), 0);
    assert.equal(packRequests.filter((f) => f.endsWith('.txt.gz')).length, 0);
    await page.mouse.move(700, 1000);
  });

  await step('downloads a meaning dictionary per language', async () => {
    for (const [id, size, files] of [['zh-meanings', '3.9', 'zh.txt.gz'], ['ja-meanings', '7.1', 'ja.txt.gz'], ['ko-meanings', '1.7', 'ko.txt.gz']]) {
      const row = pack(id);
      await row.waitForHint(new RegExp(`^Word meanings · ${size.replace('.', '\\.')} MB$`));
      await row.button.click();
      await row.waitForHint(new RegExp(`^Downloaded · ${size.replace('.', '\\.')} MB$`));
      assert.ok(packRequests.includes(files));
    }
    assert.equal(await popup.locator('#meaningsHint').textContent(), 'Point at a word to see it');
    await popup.screenshot({ path: join(output, 'popup-settings.png'), fullPage: true });
  });

  await step('shows the meaning of the Chinese word under the pointer', async () => {
    await pointAt('#zh', '银');
    await waitForTip(/银行.*yín háng.*bank/);
    assert.equal(await highlighted(), '银yín行háng');
    await page.screenshot({ path: join(output, 'meaning.png'), caret: 'initial', clip: { x: 0, y: 0, width: 760, height: 420 } });
    await pointAt('#zh', '好'); // the second character of 你好 finds the whole word
    await waitForTip(/^你好\s*nǐ hǎo.*hello/i);
    assert.equal(await highlighted(), '你nǐ好hǎo');
  });

  await step('hides the meaning when the pointer leaves the word', async () => {
    await pointAt('#latin', 'P');
    await waitForNoTip();
    assert.equal(await highlighted(), '');
  });

  await step('shows Japanese meanings by dictionary form', async () => {
    await pointAt('#ja', '飲');
    await waitForTip(/飲む.*のむ.*to drink/);
    await pointAt('#ja', '東');
    await waitForTip(/東京.*とうきょう.*Tokyo/);
  });

  await step('shows Korean meanings from conjugated forms', async () => {
    await pointAt('#ko', '공');
    await waitForTip(/공부하다.*gongbuhada.*to study/);
    await pointAt('#ko', '한');
    await waitForTip(/한국어.*hangugeo.*Korean/);
  });

  await step('shows meanings for text that is not annotated, such as code blocks', async () => {
    await pointAt('#pre', '唱');
    await waitForTip(/唱.*chàng.*to sing/);
  });

  await step('shows Cantonese readings in meanings when reading Chinese as Cantonese', async () => {
    await popup.selectOption('#chinese', 'jyutping');
    await waitForReadings('#zh', 'ngan4 hong4 haang4 coeng4 syut3 nei5 hou2 sai3 gaai3');
    await pointAt('#zh', '银');
    await waitForTip(/银行.*ngan4 hong4.*bank/);
    await popup.selectOption('#chinese', 'pinyin');
    await waitForReadings('#zh', ZH);
  });

  await step('stops showing meanings when they are switched off', async () => {
    await popup.click('#closeSettings');
    await popup.click('label[for="meanings"]');
    await page.mouse.move(700, 1000);
    await pointAt('#zh', '银');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('pya-tip').count(), 0);
    await popup.click('label[for="meanings"]');
    await pointAt('#zh', '行');
    await waitForTip(/行/);
    await popup.click('#openSettings');
  });

  await step('removes a meaning dictionary on request', async () => {
    const row = pack('zh-meanings');
    await row.button.click();
    await row.waitForHint(/^Word meanings · 3\.9 MB$/);
    assert.equal(await cachedFiles('pack-zh-meanings'), 0);
    await page.mouse.move(700, 1000);
    await pointAt('#zh', '银');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('pya-tip').count(), 0);
    await waitForReadings('#zh', ZH); // readings do not depend on it
    await pointAt('#ko', '공');
    await waitForTip(/공부하다/); // other dictionaries stay
    await page.mouse.move(700, 1000);
  });

  await step('honours a single-language setting', async () => {
    await setSettings({ language: 'ko' });
    await waitForReadings('#zh', '');
    await waitForReadings('#ko', KO);
    assert.equal(await page.locator('#ja pya-text').count(), 0);
    await setSettings({ language: 'zh' });
    await waitForReadings('#ja-kanji', 'rì běn yǔ');
    assert.equal(await page.locator('#ko pya-text').count(), 0);
    await setSettings({ language: 'auto' });
    await waitForReadings('#ja-kanji', 'nihongo');
  });

  await step('annotates code blocks only on sites where that is switched on', async () => {
    await setStorage({ codeSites: { localhost: true } });
    await waitForReadings('#pre', 'wǒ men yì qǐ chàng zhè shǒu gē');
    await waitForReadings('#code', 'biàn liàng');
    assert.equal(await page.locator('#pre .chord').count(), 2, 'other markup in the block is untouched');
    assert.equal(await page.locator('#textarea pya-text, #editable pya-text, #ruby pya-text').count(), 0);
    await page.screenshot({ path: join(output, 'code.png'), caret: 'initial' });
    await setStorage({ codeSites: { 'example.com': true } });
    await waitForReadings('#pre', '');
    await waitForReadings('#code', '');
    await waitForReadings('#zh', ZH);
    await setStorage({ codeSites: {} });
  });

  await step('popup shows the shortcut and links to where Chrome lets you change it', async () => {
    const expected = await popup.evaluate(async () =>
      (await chrome.commands.getAll()).find((command) => command.name === 'toggle-site').shortcut,
    );
    assert.equal(await popup.textContent('#shortcutHint'), expected || 'Not set');
    assert.equal(await popup.textContent('#shortcutChange'), expected ? 'Change' : 'Set');
    console.log(`    (shortcut in this browser: ${expected || 'none'})`);
    const [opened] = await Promise.all([context.waitForEvent('page'), popup.click('#shortcutChange')]);
    assert.equal(opened.url(), 'chrome://extensions/shortcuts');
    await opened.close();
  });

  await step('popup reflects and changes everyday settings', async () => {
    await popup.click('#closeSettings');
    assert.equal(await popup.inputValue('#language'), 'auto');
    assert.equal(await popup.isChecked('input[name="position"][value="over"]'), true);
    await popup.locator('label:has(input[value="under"])').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('pya-position') === 'under');
    await popup.locator('label:has(input[value="over"])').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('pya-position') === 'over');
    assert.deepEqual(popupErrors, []);
    await popup.close();
  });

  await step('restores the page exactly when switched off', async () => {
    await pointAt('#ko', '공');
    await waitForTip(/공부하다/);
    await setStorage({ sites: {} });
    await page.waitForFunction(() => document.querySelectorAll('pya-text').length === 0);
    assert.equal(await page.evaluate(() => document.body.innerHTML), originalHtml);
    assert.equal(await page.locator('pya-tip').count(), 0);
    assert.equal(await highlighted(), '');
    assert.deepEqual(await page.evaluate(() => document.documentElement.getAttributeNames()), []);
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
