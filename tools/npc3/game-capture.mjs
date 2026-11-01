// Close-ups of real townsfolk in the built game (not a test rig).
//
//   npx vite build && npx vite preview --port 4181 &
//   node tools/npc3/game-capture.mjs http://127.0.0.1:4181 <outdir> [at=Templum] [count=14] [warm=120]
//
// Loads index.html?at=<place> (title overlay hidden), lets the population
// fill in and run for `warm` frames, then for the `count` people nearest
// the spawn point puts the player's camera 1.9 m in front of each and 1.9 m
// to the side, at eye height, looking at the chest, runs three frames (so
// the person is in mid-stride or mid-gesture of their own clip, as in play)
// and saves <outdir>/<k>-<group>-<view>.png and people.json (who, outfit,
// what they were doing). The same seed and place give the same people in
// two builds, so two runs make matched pairs.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, out, at = 'Templum', count = '14', warm = '10'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 540, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
// (?shot with &hold keeps the title overlay hidden and the frame loop running.)
await page.goto(`${base}/index.html?at=${at}&shot=0,0,0,0,0&hold`, { timeout: 600000 });
await page.waitForFunction(() => window.__ready && window.__npcDebug, null, { timeout: 900000 });
// Only the 3D view (no title, map button, joystick).
await page.addStyleTag({ content: '* { visibility: hidden !important } canvas { visibility: visible !important }' });
// A frame counter, to wait for whole frames (SwiftShader draws the town at a few seconds a frame).
await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
const frames = async (n) => {
  const f0 = await page.evaluate(() => window.__frames);
  await page.waitForFunction((f) => window.__frames >= f, f0 + n, { timeout: 900000, polling: 500 });
};
await page.waitForFunction((c) => window.__npcDebug.people.length >= c, Math.min(+count + 2, 18), { timeout: 1200000, polling: 2000 }).catch(() => console.log('fewer people than asked'));
await frames(+warm);
const list = await page.evaluate((count) => {
  const d = window.__npcDebug, pl = window.__player;
  return d.people.filter((p) => p.group.visible && p.pos.distanceTo(pl.pos) < 40)
    .sort((a, b) => a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos)).slice(0, count)
    .map((p) => d.people.indexOf(p));
}, +count);
const meta = [];
for (const [k, idx] of list.entries()) {
  for (const view of ['front', 'side']) {
    const info = await page.evaluate(({ idx, view }) => {
      const p = window.__npcDebug.people[idx], pl = window.__player;
      const f = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
      const dir = view === 'front' ? f : { x: f.z, z: -f.x };
      const cam = { x: p.pos.x + dir.x * 1.9, y: p.pos.y + 1.35 * (p.scale ?? 1), z: p.pos.z + dir.z * 1.9 };
      pl.pos.set(cam.x, cam.y, cam.z);
      pl.vel?.set(0, 0, 0);
      const dx = p.pos.x - cam.x, dz = p.pos.z - cam.z;
      pl.yaw = Math.atan2(-dx, -dz);
      pl.pitch = Math.atan2(p.pos.y + 0.95 * (p.scale ?? 1) - cam.y, Math.hypot(dx, dz));
      return { title: p.title, outfit: p.outfit?.id, body: p.outfit?.body, w: Object.fromEntries(Object.entries(p.w ?? {}).map(([a, v]) => [a, +(+v).toFixed(2)])) };
    }, { idx, view });
    await frames(3);
    const name = `${String(k).padStart(2, '0')}-${(info.title ?? 'x').replace(/\W+/g, '_')}-${view}.png`;
    await page.screenshot({ path: `${out}/${name}`, timeout: 600000 });
    meta.push({ k, view, file: name, ...info });
    console.log(name, JSON.stringify(info));
  }
}
writeFileSync(`${out}/people.json`, JSON.stringify(meta, null, 1));
await browser.close();
