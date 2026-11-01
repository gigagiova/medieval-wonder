// Triangles per person (all visible meshes: body, garments, props), for every
// population group and its outfits, from src/population-test.ts.
//   node tools/npc3/tris.mjs [port]
import { chromium } from 'playwright';
const port = process.argv[2] ?? '5191';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const groups = 'gasindus:0,gasindus:1,gastaldius:0,sculdahis:0,arimannus:0,arimannus:1,langobarda:0,langobarda:1,senexLangobardus:0,bulgarus:0,aldius:0,aldius:1,rustica:0,servus:0,mulier:0,anus:0,puer:0,puella:0,mendicus:0,faber:0,aurifex:0,figulus:0,pistor:0,molendinarius:0,calcarius:0,lavandaria:0,textrix:0,negotiator:0,negotiator:1,notarius:0,medicus:0,presbyter:0,presbyter:1,diaconus:0,monachus:0,monachus:1,sanctimonialis:0,peregrinus:0,peregrinus:1,graecus:0,graeca:0,iudaeus:0,afer:0';
await page.goto(`http://127.0.0.1:${port}/population-test.html?groups=${groups}&t=0.1&gap=2`, { timeout: 300000 });
await page.waitForFunction(() => window.__done === true, null, { timeout: 600000 });
const r = await page.evaluate(() => window.__api.people.map((p) => {
  let tris = 0, garments = 0;
  p.group.traverse((o) => { if (o.isMesh && o.visible) { const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; tris += t; if (o.userData.npc2 === 'garment') garments += t; } });
  for (const h of p.held) h.obj.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return [p.title, p.outfit.id, p.outfit.body, Math.round(tris), Math.round(garments)];
}));
for (const x of r) console.log(x.join('\t'));
const t = r.map((x) => x[3]);
console.log('mean', Math.round(t.reduce((a, b) => a + b) / t.length), 'max', Math.max(...t), 'min', Math.min(...t));
await browser.close();
