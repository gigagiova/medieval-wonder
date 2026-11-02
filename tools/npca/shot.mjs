// Screenshot a test page headless (SwiftShader).
//   node tools/npca/shot.mjs <url> <out.png> [width=1400] [height=700] [waitMs=4000]
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [url, out, w = '1400', h = '700', wait = '4000'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
await page.goto(url, { timeout: 600000 });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
