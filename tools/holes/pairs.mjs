// Side-by-side before|after frames of the render audit (same view, same name).
//   node tools/holes/pairs.mjs before/render after/render out-dir name.png ...
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [A, B, OUT, ...names] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
for (const n of names) {
  const a = await sharp(join(A, n)).png().toBuffer(), b = await sharp(join(B, n)).png().toBuffer();
  const { width: w, height: h } = await sharp(a).metadata();
  await sharp({ create: { width: w * 2 + 8, height: h, channels: 3, background: '#000' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: w + 8, top: 0 }]).png().toFile(join(OUT, n));
}
