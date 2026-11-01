// Rendering budget at street level (the ?debug HUD's numbers): triangles and
// draw calls of a settled frame at 390x844, in the normal game, at named
// teleports and fixed standing points.
//   npx vite build && node tools/holes/budget.mjs [--out file.json] [--port 5495] [--dist dist]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', 5495)), OUT = arg('--out', 'budget.json');
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch {} });
const BASE = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 60; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const VIEWS = [
  '?debug&shot&at=Curtis%20Ducis', '?debug&shot&at=Episcopium', '?debug&shot&at=Forum', '?debug&shot&at=Porta%20Aurea',
  '?debug&shot&at=Theatrum', '?debug&shot=-60,-,-290,0,0.15', '?debug&shot=40,-,-200,1.5,0.15', '?debug&shot=200,-,-180,3,0.15',
];
const rows = [];
for (const q of VIEWS) {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await p.goto(BASE + q, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await p.waitForFunction('window.__done === true', null, { timeout: 900000, polling: 1000 });
    // A few more frames once everything round the eye has streamed in.
    await p.evaluate(() => window.__resume(20));
    await p.waitForFunction('window.__done === true', null, { timeout: 300000, polling: 200 });
    const r = await p.evaluate(() => ({ ...window.__renderer.info.render, cam: window.__camera.position.toArray().map((v) => +v.toFixed(1)) }));
    rows.push({ view: q, triangles: r.triangles, calls: r.calls, cam: r.cam });
    console.log(JSON.stringify(rows[rows.length - 1]));
  } catch (e) { console.error(q, e); } finally { await b.close(); }
}
writeFileSync(OUT, JSON.stringify(rows, null, 1));
process.exit(0);
