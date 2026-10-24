// Convert a Poly Haven .hdr into an RGBE-encoded PNG (served by any static
// host, including the claude.ai artifact, which does not serve .hdr).
//   npx tsx tools/bake-env.ts <in.hdr> public/textures/env.png
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as THREE from 'three';

const [inp, out] = process.argv.slice(2);
const buf = readFileSync(inp);
const loader = new HDRLoader();
loader.setDataType(THREE.FloatType);
const tex = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as { width: number; height: number; data: Float32Array };
const { width: w, height: h, data } = tex;
const px = new Uint8Array(w * h * 4);
for (let i = 0; i < w * h; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const m = Math.max(r, g, b);
  if (m < 1e-32) continue;
  const e = Math.ceil(Math.log2(m)) + 1;
  const s = 256 / 2 ** e;
  px[i * 4] = Math.min(255, r * s); px[i * 4 + 1] = Math.min(255, g * s); px[i * 4 + 2] = Math.min(255, b * s); px[i * 4 + 3] = e + 128;
}
await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
console.log(out, w, h);
