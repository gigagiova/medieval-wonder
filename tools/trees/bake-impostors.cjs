// Bake the tree impostors: needs the dev server running (npx vite) and the pack
// built (tools/trees/build-trees.mjs).
//   node tools/trees/bake-impostors.cjs http://localhost:5173
// Writes public/models/trees/impostor.webp (albedo + alpha, 1024²),
// impostorn.webp (view-space normals, 512²) and impostors.json.
const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
(async () => {
  const base = process.argv[2] || 'http://localhost:5173';
  const out = path.resolve('public/models/trees');
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 900, height: 1600 } });
  p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 400)); });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  await p.goto(base + '/tools/trees/bake.html', { timeout: 600000 });
  await p.waitForFunction(() => window.__bake, null, { timeout: 600000, polling: 1000 });
  const r = await p.evaluate(() => window.__bake);
  await b.close();
  const png = (u) => Buffer.from(u.split(',')[1], 'base64');
  const a = await sharp(png(r.albedo)).webp({ quality: 88, alphaQuality: 100 }).toFile(path.join(out, 'impostor.webp'));
  const n = await sharp(png(r.normal)).resize(512, 832).webp({ quality: 90 }).toFile(path.join(out, 'impostorn.webp'));
  fs.writeFileSync(path.join(out, 'impostors.json'), JSON.stringify(r.json));
  console.log('impostor.webp', (a.size / 1024).toFixed(0), 'KB; impostorn.webp', (n.size / 1024).toFixed(0), 'KB;', JSON.stringify(r.json.trees));
})();
