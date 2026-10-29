// Per-frame cloth audit of the v2 townsfolk over full animation loops.
//
//   npx vite --port 5191 &            (dev server: the page imports src/ directly)
//   npm i --no-save playwright && npx playwright install chromium
//   node tools/npc3/audit.mjs [out.json] [groups] [anims] [fps]
//
// For each person of src/population-test.ts (one per group and outfit), each
// clip (idle, walk, talk) is warmed up for 1.5 s, then stepped through one
// whole loop of the clip at `fps`. Every frame:
//  - crossings: src/npc2/audit.ts pokeAudit — visible vertices of an inner
//    layer (body or lower garment) that have come out through an outer
//    garment, per layer pair (bind-pose offenders, where the cloth simply
//    ends, excluded);
//  - wrist bend: the angle between the forearm (elbow -> wrist) and the hand
//    (wrist -> middle knuckle), left and right, in degrees.
// The JSON report lists per-frame counts, so a failing frame can be replayed.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const DEFAULT = [
  'arimannus:0', 'gasindus:0', 'sculdahis:0', 'aldius:0', 'aldius:1', 'servus:0', 'negotiator:0', 'negotiator:1',
  'presbyter:1', 'presbyter:0', 'monachus:0', 'monachus:1', 'langobarda:0', 'mulier:1', 'sanctimonialis:0',
];
const [out = 'audit.json', groupsArg, anims = 'idle,walk,talk', fps = '30'] = process.argv.slice(2);
const groups = groupsArg || DEFAULT.join(',');
const port = process.env.PORT ?? '5191';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/population-test.html?groups=${groups}&t=0.1&gap=1.6`, { timeout: 300000 });
await page.waitForFunction(() => window.__done === true, null, { timeout: 600000 });
const report = await page.evaluate(async ({ anims, fps }) => {
  const { pokeAudit } = await import('/src/npc2/audit.ts');
  const api = window.__api, THREE = api.THREE;
  const res = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const wrist = (p, s) => {
    p.bone(s + 'ForeArm').getWorldPosition(a); p.bone(s + 'Hand').getWorldPosition(b); p.bone(s + 'HandMiddle1').getWorldPosition(c);
    const f = b.clone().sub(a).normalize(), h = c.clone().sub(b).normalize();
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(f.dot(h), -1, 1)));
  };
  for (const anim of anims.split(',')) {
    api.setAnim(anim);
    for (let i = 0; i < 45; i++) api.step(1 / 30);
    const people = api.people;
    const loops = people.map((p) => p.acts[anim]?.getClip().duration ?? 2);
    const n = Math.ceil(Math.max(...loops) * fps);
    const rows = people.map((p, i) => ({ who: `${p.title} (${p.outfit.id}:${p.outfit.body})`, anim, loop: +loops[i].toFixed(2), frames: [], wrist: [], where: {} }));
    for (let f = 0; f < n; f++) {
      api.step(1 / fps);
      people.forEach((p, i) => {
        if (f >= Math.ceil(loops[i] * fps)) return;
        p.body.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.update(); });
        const depth = new Map(p.outfit.garments.map((g) => [g.id, g.depth ?? 50]));
        rows[i].frames.push(pokeAudit(p.body, (g) => depth.get(g) ?? 50, 0.03, rows[i].where));
        rows[i].wrist.push([+wrist(p, 'Left').toFixed(1), +wrist(p, 'Right').toFixed(1)]);
      });
    }
    res.push(...rows);
  }
  return res;
}, { anims, fps: +fps });
for (const r of report) {
  const tot = {}; let bad = 0;
  for (const f of r.frames) { if (Object.keys(f).length) bad++; for (const [k, v] of Object.entries(f)) tot[k] = Math.max(tot[k] ?? 0, v); }
  const wl = Math.max(...r.wrist.map((w) => w[0])), wr = Math.max(...r.wrist.map((w) => w[1]));
  r.summary = { frames: r.frames.length, framesWithCrossings: bad, maxPerPair: tot, wristMaxDeg: [wl, wr] };
  if (process.env.WHERE) console.log('   where', JSON.stringify(Object.fromEntries(Object.entries(r.where).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 4))]))));
  console.log(`${r.anim.padEnd(5)} ${r.who.padEnd(44)} frames ${String(r.frames.length).padStart(4)}  crossing frames ${String(bad).padStart(4)}  wrist max L ${wl.toFixed(1)} R ${wr.toFixed(1)}  ${JSON.stringify(tot)}`);
}
writeFileSync(out, JSON.stringify(report));
await browser.close();
