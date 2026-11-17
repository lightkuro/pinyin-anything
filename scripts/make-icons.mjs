// Regenerates icons/icon{16,48,128}.png. Needs Playwright with Chromium.
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const html = (size) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;border-radius:${size * 0.22}px;background:#c2410c;color:#fff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  font-family:'Noto Sans CJK SC','Noto Sans SC',sans-serif;line-height:1">
  ${size >= 48 ? `<div style="font:600 ${size * 0.2}px system-ui,sans-serif;opacity:.9;margin-bottom:${size * 0.03}px">pīn</div>` : ''}
  <div style="font-size:${size * (size >= 48 ? 0.52 : 0.72)}px;font-weight:700">拼</div>
</div></body></html>`;

const browser = await chromium.launch();
for (const size of [16, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html(size));
  await page.screenshot({ path: `icons/icon${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
