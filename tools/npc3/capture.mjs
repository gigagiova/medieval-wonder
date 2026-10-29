// Matched close-ups of the townsfolk for before/after comparison.
//
//   npx vite --port 5191 &
//   node tools/npc3/capture.mjs <outdir> [groups] [anims] [views] [frame]
//
// One person per entry of `groups` (src/population-test.ts syntax, e.g.
// arimannus:0), each alone in the frame (the others are hidden), for each
// clip (idle, walk, talk; `frame` seconds into the loop after a 1.5 s
// warm-up) and each view: front, side, back (full figure), and the close-ups
// neck (collar from above the shoulder), waist (belt) and hands.
// Writes <outdir>/<group>-<outfit>_<anim>_<view>.png and a contact sheet per
// person (<outdir>/<group>-<outfit>.png: rows = clips, columns = views).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const [outdir, groups = 'arimannus:0', anims = 'idle,walk,talk', views = 'front,side,back,neck,waist,hands', frame = '0.4'] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const port = process.env.PORT ?? '5191';
const W = 420, H = 560;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const list = groups.split(',');
await page.goto(`http://127.0.0.1:${port}/population-test.html?groups=${list.join(',')}&t=0.1&gap=3`, { timeout: 300000 });
await page.waitForFunction(() => window.__done === true, null, { timeout: 600000 });
await page.waitForTimeout(2000);
const V = views.split(','), A = anims.split(',');
for (const [i, g] of list.entries()) {
  const tiles = [];
  for (const anim of A) {
    await page.evaluate(({ anim, frame }) => {
      const api = window.__api;
      api.setAnim(anim);
      for (const p of api.people) p.acts[anim].time = 0;
      for (let k = 0; k < 45 + Math.round(frame * 30); k++) api.step(1 / 30);
    }, { anim, frame: +frame });
    for (const view of V) {
      await page.evaluate(({ i, view, anim }) => {
        const api = window.__api, THREE = api.THREE, cam = api.camera;
        api.people.forEach((p, j) => p.group.visible = j === i);
        const p = api.people[i];
        const b = (n) => p.bone(n).getWorldPosition(new THREE.Vector3());
        const c = p.pos.clone();
        const hips = b('Hips'), neck = b('Neck'), head = b('Head');
        // Walking, the person moves on; keep him centred.
        const walkOff = anim === 'walk' ? new THREE.Vector3(hips.x - c.x, 0, hips.z - c.z) : new THREE.Vector3();
        c.add(walkOff);
        const at = (x, y, z, tx, ty, tz, fov) => { cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(c.x + x, y, c.z + z); cam.lookAt(c.x + tx, ty, c.z + tz); };
        const h = head.y;
        if (view === 'front') at(0, h * 0.62, 3.2, 0, h * 0.55, 0, 35);
        else if (view === 'side') at(3.2, h * 0.62, 0.4, 0, h * 0.55, 0, 35);
        else if (view === 'back') at(0.2, h * 0.62, -3.2, 0, h * 0.55, 0, 35);
        // The neckline from above and in front, looking down into the collar.
        else if (view === 'neck') at(0.25, neck.y + 0.38, 0.55, neck.x - c.x, neck.y - 0.08, neck.z - c.z + 0.03, 30);
        else if (view === 'waist') at(0.55, hips.y + 0.15, 1.05, hips.x - c.x, hips.y + 0.05, hips.z - c.z, 30);
        else if (view === 'feet') { const l = b('LeftFoot'); at(0.7, 0.45, 1.1, l.x - c.x - 0.1, 0.15, l.z - c.z, 34); }
        else if (view === 'legs') at(1.6, 0.75, 1.6, 0, 0.5, 0, 34);
        else if (view === 'hands') { const l = b('LeftHand'), r = b('RightHand'); const m = l.clone().add(r).multiplyScalar(0.5); at(0.9, m.y + 0.35, 1.6, m.x - c.x, m.y, m.z - c.z, 34); }
        p.carry(0);
        api.render();
      }, { i, view, anim });
      const file = `${outdir}/${g.replace(':', '-')}_${anim}_${view}.png`;
      await page.screenshot({ path: file });
      tiles.push(file);
    }
  }
  const sheet = sharp({ create: { width: W * V.length, height: H * A.length, channels: 3, background: '#000' } })
    .composite(tiles.map((f, k) => ({ input: f, left: (k % V.length) * W, top: Math.floor(k / V.length) * H })));
  await sheet.png().toFile(`${outdir}/${g.replace(':', '-')}.png`);
  console.log('sheet', `${outdir}/${g.replace(':', '-')}.png`);
}
console.log(JSON.stringify(await page.evaluate(() => ({ gripErr: window.__api.npcDebug?.gripErr }))));
await browser.close();
