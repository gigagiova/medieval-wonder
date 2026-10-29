// Phone-budget numbers for the townsfolk at street level, from the ?debug HUD.
//
//   node tools/npc3/perf.mjs <url-base> <out.png> [at] [seconds]
//   e.g. node tools/npc3/perf.mjs http://127.0.0.1:5191 forum.png Templum 25
//
// Loads index.html?debug&at=<at> at 390x844, lets the population fill in for
// `seconds`, then reports the HUD text, the people near the camera, the
// spring time per frame and the triangles of each person's visible meshes.
// (Headless software rendering: the ms are CPU-side and relative only; they
// are not phone frame times.)
import { chromium } from 'playwright';
const [base, out, at = 'Templum', secs = '25'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/index.html?debug&at=${at}`, { timeout: 300000 });
await page.waitForFunction(() => window.__npcDebug && window.__pop, null, { timeout: 600000 });
await page.evaluate(() => { const d = window.__npcDebug.prof; d.springs = 0; d.springPeople = 0; d.frames = 0; d.anim = 0; });
await page.waitForTimeout(+secs * 1000);
const r = await page.evaluate(() => {
  const d = window.__npcDebug, f = Math.max(1, d.prof.frames);
  const hud = [...document.querySelectorAll('div')].map((e) => e.innerText).filter((t) => /tri|draw|fps/i.test(t)).sort((a, b) => a.length - b.length)[0] ?? '';
  const people = d.people.filter((p) => p.visible && p.dist < 40).map((p) => {
    let tris = 0;
    p.group.traverse((o) => { if (o.isMesh && o.visible) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return { who: p.title, outfit: p.outfit.id, dist: +p.dist.toFixed(1), tris: Math.round(tris) };
  });
  return { hud, frames: d.prof.frames, springsMsPerFrame: +(d.prof.springs / f).toFixed(3), animMsPerFrame: +(d.prof.anim / f).toFixed(3), springPeoplePerFrame: +(d.prof.springPeople / f).toFixed(2), people };
});
console.log(JSON.stringify(r, null, 1));
await page.screenshot({ path: out, timeout: 300000 });
await browser.close();
