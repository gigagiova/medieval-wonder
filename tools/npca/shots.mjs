// Several screenshots of test pages in one headless browser (SwiftShader).
//   node tools/npca/shots.mjs <outdir> <waitMs> <name>=<url> ...
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out, wait, ...jobs] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const j of jobs) {
  const i = j.indexOf('=');
  const name = j.slice(0, i), url = j.slice(i + 1);
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { timeout: 600000 });
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  console.log(name);
}
await browser.close();
