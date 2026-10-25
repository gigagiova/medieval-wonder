// Encodes the world texture sets (public/textures/<set>_{a,n,m}.webp) into
// GPU-compressed KTX2 next to them, as <set>_<map>.ktx2.wasm (the published
// game's host refuses .ktx2 but serves .wasm byte for byte; see src/ktx2.ts).
//
//   albedo (_a): ETC1S, sRGB, quality 255     → small download, colour maps hold up well
//   normal (_n): UASTC + RDO + zstd, normal-map mode
//   packed (_m: R ao, G roughness, B height): UASTC + RDO + zstd (independent channels)
//
// All with mipmaps, flipped vertically like the WebP is on upload.
// Needs the Basis encoder (WASM) and sharp:
//   npm i --no-save ktx2-encoder@0.6.0
//   node tools/encode-ktx2.mjs [set ...]
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'textures');
const only = process.argv.slice(2);
const decode = async (buf) => {
  const { data, info } = await sharp(Buffer.from(buf)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
};
for (const f of fs.readdirSync(dir).filter((f) => /_(a|n|m)\.webp$/.test(f)).sort()) {
  const set = f.replace(/_(a|n|m)\.webp$/, ''), kind = f.match(/_(a|n|m)\.webp$/)[1];
  if (only.length && !only.includes(set)) continue;
  const png = await sharp(path.join(dir, f)).png().toBuffer();
  const uastc = kind !== 'a';
  const t0 = Date.now();
  const data = await encodeToKTX2(new Uint8Array(png), {
    isUASTC: uastc,
    isYFlip: true,
    generateMipmap: true,
    isKTX2File: true,
    isSetKTX2SRGBTransferFunc: kind === 'a',
    isPerceptual: kind === 'a',
    isNormalMap: kind === 'n',
    needSupercompression: uastc,
    qualityLevel: 255,
    compressionLevel: 4,
    uastcLDRQualityLevel: 2,
    enableRDO: uastc,
    rdoQualityLevel: kind === 'n' ? 1.0 : 1.5,
    imageDecoder: decode,
  });
  const out = path.join(dir, f.replace('.webp', '.ktx2.wasm'));
  fs.writeFileSync(out, data);
  console.log(path.basename(out), uastc ? 'UASTC' : 'ETC1S', (data.length / 1024).toFixed(0) + ' KB', ((Date.now() - t0) / 1000).toFixed(0) + ' s');
}
