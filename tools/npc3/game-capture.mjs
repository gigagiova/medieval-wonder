// Close-ups of real townsfolk in the built game (not a test rig).
//
//   npx vite build && npx vite preview --port 4181 &
//   [QS=&npc=c] node tools/npc3/game-capture.mjs http://127.0.0.1:4181 <outdir> [places=Templum,Porta,Atrium] [count=15] [warm=10]
//
// Loads index.html?at=<place> (title overlay hidden), lets the population
// fill in and run for `warm` frames, then at each place (a teleport name;
// the first is the start) for its share of `count` people (walking and
// talking ones first, then the nearest) puts the player's camera 1.9 m in front of each and 1.9 m
// to the side, at eye height, looking at the chest, runs three frames (so
// the person is in mid-stride or mid-gesture of their own clip, as in play)
// and saves <outdir>/<k>-<group>-<view>.png and people.json (who, outfit,
// what they were doing). The same seed and place give the same people in
// two builds, so two runs make matched pairs.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, out, at = 'Templum,Porta,Atrium', count = '15', warm = '10'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 540, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
// (Not ?shot: in shot mode the frame loop stops 12 frames after any teleport. The
// title overlay and controls are hidden by CSS below instead.)
// NPC=b (or v1) for another set of townsfolk.
await page.goto(`${base}/index.html?at=${at.split(',')[0]}${process.env.NPC ? '&npc=' + process.env.NPC : ''}${process.env.QS ?? ''}`, { timeout: 600000 });
await page.waitForFunction(() => window.__ready && window.__npcDebug, null, { timeout: 900000 });
// Only the 3D view (no title, map button, joystick).
await page.addStyleTag({ content: '* { visibility: hidden !important } canvas { visibility: visible !important }' });
// A frame counter, to wait for whole frames (SwiftShader draws the town at a few seconds a frame).
await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
const frames = async (n) => {
  const f0 = await page.evaluate(() => window.__frames);
  await page.waitForFunction((f) => window.__frames >= f, f0 + n, { timeout: 900000, polling: 500 });
};
await page.waitForFunction(() => window.__npcDebug.people.length >= 8, null, { timeout: 600000, polling: 2000 }).catch(() => console.log('fewer people than asked'));
await frames(+warm);
const meta = [];
const places = at.split(',');
let k = 0;
for (const [pi, place] of places.entries()) {
  // Every place, the first too (?at= alone can leave the player at the spawn when
  // the teleport finds no floor): through the teleport, else set directly; then
  // the population fills in round the player.
  const went = await page.evaluate((place) => {
    const ts = window.__teleports();
    const t = ts.find((q) => q.name.toLowerCase() === place.toLowerCase()) ?? ts.find((q) => q.name.toLowerCase().includes(place.toLowerCase()));
    if (!t) return null;
    const pl = window.__player;
    window.__teleport(t);
    if (Math.hypot(pl.pos.x - t.x, pl.pos.z - t.z) > 3) { pl.pos.set(t.x, (t.y ?? window.__groundY(t.x, t.z)) + 1.65, t.z); pl.vel?.set(0, 0, 0); }
    return [t.name, Math.round(pl.pos.x), Math.round(pl.pos.z)];
  }, place);
  console.log('place', place, JSON.stringify(went));
  await frames(+warm);
  // Moving people first (mid-walk, mid-talk), then the rest; nearest first.
  // WHO=monachus,presbyter,...: only people whose title contains one of these.
  const list = await page.evaluate(({ n, taken, who }) => {
    const d = window.__npcDebug, pl = window.__player;
    // Walking people first (the captures had too few), then talking, then the nearest.
    const busy = (p) => ((p.w?.walk ?? 0) > 0.4 ? 2 : 0) + ((p.w?.talk ?? 0) > 0.5 ? 1 : 0);
    return d.people.filter((p) => p.pos.distanceTo(pl.pos) < 110 && !taken.includes(p.name + p.title) && (!who.length || who.some((w) => ((p.name ?? '') + ' ' + (p.title ?? '')).toLowerCase().includes(w))))
      .sort((a, b) => busy(b) - busy(a) || a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos)).slice(0, n)
      .map((p) => p.name + p.title);
  }, { n: Math.ceil(+count / places.length), taken: meta.map((m) => m.key), who: (process.env.WHO ?? '').toLowerCase().split(',').filter(Boolean) });
  for (const idx of list) {
    // VIEWS=front,side,back (default front,side).
    for (const view of (process.env.VIEWS ?? 'front,side').split(',')) {
      const info = await page.evaluate(({ idx, view, force, hide, hideAll }) => {
        // By name: the list of people changes as the camera moves (the far ones are put away).
        const p = window.__npcDebug.people.find((q) => q.name + q.title === idx), pl = window.__player;
        if (!p) return null;
        // HIDE=body,longrobe,...: those meshes of the person left out (to tell a hole from a crossing).
        // HIDEALL=1: the same meshes left out of everyone within 4 m (a bystander between camera and person).
        if (hide && hideAll) for (const q of window.__npcDebug.people) if (q !== p && q.pos.distanceTo(p.pos) < 4) q.body.traverse((o) => { if (o.isMesh) { const n = o.userData.npc2 === 'body' ? 'body' : o.userData.garment; if (hide.split(',').includes(n)) o.visible = false; } });
        if (hide) p.body.traverse((o) => { if (o.isMesh) { const n = o.userData.npc2 === 'body' ? 'body' : o.userData.garment; if (hide.split(',').includes(n)) o.visible = false; } });
        // FORCEWALK=1: the person's clip held on the walk (in place), to see the cloth in the stride.
        if (force && !p.__forced) {
          const W = { idle: 0, walk: 0, talk: 0, bless: 0, kneel: 0, pickup: 0, interact: 0 };
          W[force] = 1;
          Object.defineProperty(p, 'want', { get: () => ({ ...W }), set: () => {}, configurable: true });
          p.__forced = true;
        }
        const f = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
        const dir = view === 'front' ? f : view === 'back' ? { x: -f.x, z: -f.z } : { x: f.z, z: -f.x };
        const cam = { x: p.pos.x + dir.x * 1.9, y: p.pos.y + 1.35 * (p.scale ?? 1), z: p.pos.z + dir.z * 1.9 };
        const dx = p.pos.x - cam.x, dz = p.pos.z - cam.z;
        // Through the game's own teleport (it lands on the floor and becomes the player's safe spot).
        window.__teleport({ name: 'npc', x: cam.x, y: p.pos.y + 0.5, z: cam.z, yaw: Math.atan2(-dx, -dz) });
        // (No floor found there, e.g. under an arch: put the camera there directly.)
        if (Math.hypot(pl.pos.x - cam.x, pl.pos.z - cam.z) > 1.5) { pl.pos.set(cam.x, cam.y, cam.z); pl.vel?.set(0, 0, 0); pl.yaw = Math.atan2(-dx, -dz); }
        pl.pitch = Math.atan2(p.pos.y + 0.95 * (p.scale ?? 1) - pl.pos.y, Math.hypot(dx, dz));
        const near = window.__npcDebug.people.filter((q) => q !== p && Math.hypot(q.pos.x - cam.x, q.pos.z - cam.z) < 1.2).map((q) => q.name + ' ' + q.title + ' ' + q.outfit?.id + ' ' + q.outfit?.body);
        return { near, key: p.name + p.title, name: p.name, title: p.title, outfit: p.outfit?.id, body: p.outfit?.body, w: Object.fromEntries(Object.entries(p.w ?? {}).map(([a, v]) => [a, +(+v).toFixed(2)])) };
      }, { idx, view, force: process.env.FORCE ?? (process.env.FORCEWALK ? 'walk' : ''), hide: process.env.HIDE ?? '', hideAll: !!process.env.HIDEALL });
      if (!info) continue;
      // (Walkers come from out of sight: a few frames for them to be drawn.)
    await frames(process.env.FORCEWALK || process.env.FORCE ? 10 : 4);
      // FRAMES=n: n shots of this view, STEP frames apart (default 3), through the person's clip.
      const nf = +(process.env.FRAMES ?? 1);
      for (let fi = 0; fi < nf; fi++) {
        if (fi) await frames(+(process.env.STEP ?? 3));
        const name = `${String(k).padStart(2, '0')}-${(info.title ?? 'x').replace(/\W+/g, '_')}-${view}${nf > 1 ? '-f' + fi : ''}.png`;
        await page.screenshot({ path: `${out}/${name}`, timeout: 600000 });
        meta.push({ k, view: nf > 1 ? view + '-f' + fi : view, place, file: name, ...info });
        console.log(name, JSON.stringify(info));
      }
    }
    k++;
  }
}
writeFileSync(`${out}/people.json`, JSON.stringify(meta, null, 1));
await browser.close();
