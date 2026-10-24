// Lit previews of baked sets: albedo × (raking light on the normal map) × AO,
// 2×2 tiled to show seams. npx tsx tools/preview-textures.ts name...
import sharp from 'sharp';
const dir = new URL('../public/textures/', import.meta.url).pathname;
const out = new URL('./preview/', import.meta.url).pathname;
for (const name of process.argv.slice(2)) {
  const S = 512;
  const load = async (f: string) => (await sharp(dir + f).resize(S, S).raw().toBuffer({ resolveWithObject: true })).data;
  const a = await load(`${name}_a.webp`), n = await load(`${name}_n.webp`), m = await load(`${name}_m.webp`);
  const ch = a.length / (S * S), cn = n.length / (S * S), cm = m.length / (S * S);
  const L = [-0.55, 0.45, 0.7]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  const T = S * 2, o = Buffer.alloc(T * T * 3);
  const lin = (c: number) => Math.pow(c / 255, 2.2), enc = (c: number) => Math.round(255 * Math.pow(Math.min(1, c), 1 / 2.2));
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const i = (y % S) * S + (x % S);
    const nx = n[i * cn] / 127.5 - 1, ny = n[i * cn + 1] / 127.5 - 1, nz = n[i * cn + 2] / 127.5 - 1;
    const d = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const ao = m[i * cm] / 255;
    const lit = (0.25 * ao + 1.4 * d) * 1.6;
    for (let c = 0; c < 3; c++) o[(y * T + x) * 3 + c] = enc(lin(a[i * ch + c]) * lit);
  }
  await sharp(o, { raw: { width: T, height: T, channels: 3 } }).jpeg({ quality: 85 }).toFile(`${out}${name}_lit.jpg`);
  console.log('wrote', `${out}${name}_lit.jpg`);
}
