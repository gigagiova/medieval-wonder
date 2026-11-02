// Render audit for holes (see docs/HOLES-AUDIT.md).
//
//   npx vite build && node tools/audit-holes-render.mjs [--out docs/holes-audit/after/render] [--views tools/holes/views.json] [--batch 3] [--budget]
//
// Serves dist/, opens the built game in headless Chromium (SwiftShader) with
// ?holes (src/holesview.ts): back faces of one-sided surfaces flat magenta,
// holes in the ground pure green. For every standing point of the views file
// it renders four yaws, pitch a little up (roofs) and a little down (ground),
// counts magenta and green pixels per view, and saves each frame and a
// contact sheet per point. Stability: SwiftShader has crashed on long
// teleporting sessions, so the page is reloaded every --batch points, the
// viewport is the phone's 390x844 at pixel ratio 1, and each move waits for
// the town around the point to finish streaming before anything is drawn.
// --budget: also opens the normal game (?debug) at the budget views and
// records triangles and draw calls (renderer.info after a settled frame).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', 'docs/holes-audit/current/render');
const VIEWS = arg('--views', 'tools/holes/views.json');
const BATCH = Number(arg('--batch', 3));
const PORT = Number(arg('--port', 5493));
const ONLY = arg('--only', '');
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/`;
const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const PITCHES = [0.22, -0.3];

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);
for (let i = 0; i < 60; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const launch = () => chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function openAt(browser, query) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 900000, polling: 1000 });
  // Only the canvas in the frames (the title card, map button and stick are DOM).
  await page.addStyleTag({ content: 'body > *:not(canvas) { display: none !important; }' });
  await page.waitForFunction('window.__done === true', null, { timeout: 300000, polling: 500 });
  return { page, errors };
}
/** Stand at (x, z) (on the floor there), wait for the town round it, settle a few frames. */
async function moveTo(page, v, yaw, pitch) {
  await page.evaluate(async ({ v, yaw, pitch }) => {
    const t = { name: 'audit', x: v.x, y: (v.y ?? window.__groundY(v.x, v.z) + 1.65) + 0.4, z: v.z, yaw };
    window.__teleport(t);
    window.__setPitch(pitch);
    const p = new window.__THREE.Vector3(v.x, 0, v.z);
    window.__stream.update(p);
    const pump = setInterval(() => window.__stream.update(p), 100);
    await window.__stream.ready(v.x, v.z, 36);
    clearInterval(pump);
    window.__resume(8);
  }, { v, yaw, pitch });
  await page.waitForFunction('window.__done === true', null, { timeout: 300000, polling: 200 });
}

const views = JSON.parse(readFileSync(VIEWS, 'utf8')).filter((v) => !ONLY || ONLY.split(',').includes(v.id));
const rows = [];
const sheet = async (id, files) => {
  const tiles = await Promise.all(files.map((f) => sharp(f).resize(195, 422).png().toBuffer()));
  const W = 195 * 4, H = 422 * Math.ceil(tiles.length / 4);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % 4) * 195, top: Math.floor(i / 4) * 422 }))).png().toFile(join(OUT, `sheet-${id}.png`));
};
for (let b0 = 0; b0 < views.length; b0 += BATCH) {
  const browser = await launch();
  try {
    const batch = views.slice(b0, b0 + BATCH);
    const first = batch[0];
    const { page, errors } = await openAt(browser, `?holes&shot=${first.x},-,${first.z},0,0`);
    for (const v of batch) {
      const files = [];
      await moveTo(page, v, YAWS[0], PITCHES[0]);
      for (const pitch of PITCHES) for (const yaw of YAWS) {
        await page.evaluate(({ v, yaw, pitch }) => {
          window.__teleport({ name: 'audit', x: v.x, y: (v.y ?? window.__groundY(v.x, v.z) + 1.65) + 0.4, z: v.z, yaw });
          window.__setPitch(pitch); window.__resume(3);
        }, { v, yaw, pitch });
        await page.waitForFunction('window.__done === true', null, { timeout: 120000, polling: 100 });
        const c = await page.evaluate(() => window.__holes());
        const name = `${v.id}_y${Math.round(yaw * 180 / Math.PI)}_p${Math.round(pitch * 100)}.png`;
        await page.screenshot({ path: join(OUT, name) });
        files.push(join(OUT, name));
        const cam = await page.evaluate(() => window.__camera.position.toArray().map((q) => +q.toFixed(2)));
        rows.push({ id: v.id, x: v.x, z: v.z, yaw: +yaw.toFixed(3), pitch, cam, ...c, file: name });
        console.log(JSON.stringify(rows[rows.length - 1]));
      }
      await sheet(v.id, files);
      writeFileSync(join(OUT, 'render.json'), JSON.stringify({ rows, errors }, null, 1));
    }
  } catch (e) {
    console.error('batch failed', b0, e);
  } finally {
    await browser.close();
  }
}
const tot = rows.reduce((a, r) => ({ magenta: a.magenta + r.magenta, greenBelow: a.greenBelow + r.greenBelow, pixels: a.pixels + r.w * r.h }), { magenta: 0, greenBelow: 0, pixels: 0 });
const worst = [...rows].sort((a, b) => (b.magenta + b.greenBelow) - (a.magenta + a.greenBelow)).slice(0, 20);
writeFileSync(join(OUT, 'render.json'), JSON.stringify({ totals: { views: rows.length, ...tot, viewsWithMagenta: rows.filter((r) => r.magenta > 0).length, viewsWithGreen: rows.filter((r) => r.greenBelow > 0).length }, worst, rows }, null, 1));
console.log(JSON.stringify({ views: rows.length, ...tot }));
stop();
process.exit(0);
