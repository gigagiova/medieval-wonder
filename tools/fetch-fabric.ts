// Downloads the CC0 photo-scanned cloth and leather sets the townsfolk wear
// (Poly Haven) and packs them for src/npc/fabric.ts:
//
//   npx tsx tools/fetch-fabric.ts
//
// For each kind it writes, into public/textures/fabric/:
//   <kind>_d.webp  greyscale detail: the scan's linear luminance x AO, divided
//                  by a wide blur of itself (so no blotch repeats tile to
//                  tile) and normalised to mean 0.5 (value / 0.5 = albedo
//                  gain). The dye colour is multiplied in by the shader, so one
//                  scan serves every colour. Loaded as a one-channel texture.
//   <kind>_n.webp  normal map, OpenGL convention (+Y up). Only R and G are
//                  uploaded (Z is rebuilt in the shader).
// and records every source URL in public/textures/fabric/CREDITS.md.
//
// Downloads go through curl (it honours the environment's proxy) into
// tools/.cache/, so re-running only re-packs.

import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/textures/fabric/', import.meta.url).pathname;
const CACHE = new URL('./.cache/', import.meta.url).pathname;

/** kind (what fabric.ts calls it) → Poly Haven asset, source and output size, and why. */
export const SETS: { kind: string; asset: string; src: '1k' | '2k'; size: number; use: string }[] = [
  { kind: 'tabby', asset: 'hessian_380', src: '2k', size: 1024, use: 'coarse homespun tabby wool: peasants\' tunics and hoods, monks\' habits, hose' },
  { kind: 'twill', asset: 'poly_wool_herringbone', src: '2k', size: 1024, use: 'wool twill: women\'s gowns and shawls, soldiers\' tunics, sashes' },
  { kind: 'felt', asset: 'caban', src: '1k', size: 512, use: 'fulled (felted) wool: cloaks, felt caps' },
  { kind: 'linen', asset: 'rough_linen', src: '2k', size: 1024, use: 'linen: veils, pads' },
  { kind: 'leather', asset: 'brown_leather', src: '1k', size: 512, use: 'vegetable-tanned leather: belts, shoes, scabbards, straps' },
];

function curl(url: string, dest: string) {
  if (existsSync(dest)) return;
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', dest, url], { stdio: 'inherit' });
}
const files = (asset: string) => JSON.parse(execFileSync('curl', ['-sSf', `https://api.polyhaven.com/files/${asset}`]).toString());

/** Separable box blur with wrap-around (the scans tile), run three times ≈ gaussian. */
function blurWrap(src: Float32Array, S: number, r: number) {
  let a = Float32Array.from(src), b = new Float32Array(S * S);
  const w = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < S; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * S + ((k + S) % S)];
      for (let x = 0; x < S; x++) {
        b[y * S + x] = s / w;
        s += a[y * S + ((x + r + 1) % S)] - a[y * S + ((x - r + S) % S)];
      }
    }
    for (let x = 0; x < S; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[((k + S) % S) * S + x];
      for (let y = 0; y < S; y++) {
        a[y * S + x] = s / w;
        s += b[((y + r + 1) % S) * S + x] - b[((y - r + S) % S) * S + x];
      }
    }
  }
  return a;
}

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });
const credits: string[] = [
  '# Fabric texture credits',
  '',
  'Photo-scanned cloth and leather from [Poly Haven](https://polyhaven.com), released under',
  '[CC0](https://creativecommons.org/publicdomain/zero/1.0/) (no attribution required; credited here anyway).',
  'Packed by `tools/fetch-fabric.ts`; used by `src/npc/fabric.ts`.',
  '',
  '| in game | Poly Haven asset | used for | maps |',
  '|---|---|---|---|',
];

for (const s of SETS) {
  const f = files(s.asset);
  const pick = (k: string) => f[k][s.src].jpg.url as string;
  const src = { diff: pick('Diffuse'), nor: pick('nor_gl'), ao: pick('AO') };
  const local: Record<string, string> = {};
  for (const [k, url] of Object.entries(src)) {
    local[k] = `${CACHE}${s.asset}_${k}_${s.src}.jpg`;
    curl(url, local[k]);
  }
  const S = s.size;
  const diff = await sharp(local.diff).resize(S, S, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  const ao = await sharp(local.ao).resize(S, S).greyscale().raw().toBuffer();
  const L = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const l = 0.2126 * lin(diff[i * 3]) + 0.7152 * lin(diff[i * 3 + 1]) + 0.0722 * lin(diff[i * 3 + 2]);
    L[i] = l * (0.35 + 0.65 * (ao[i] / 255));
  }
  // Keep the threads and fibres; drop most of the low-frequency blotching.
  const B = blurWrap(L, S, Math.round(S / 40));
  const D = new Float32Array(S * S);
  let mean = 0;
  for (let i = 0; i < S * S; i++) { D[i] = L[i] / Math.pow(Math.max(B[i], 1e-4), 0.85); mean += D[i]; }
  mean /= S * S;
  const out = Buffer.alloc(S * S);
  for (let i = 0; i < S * S; i++) out[i] = Math.max(0, Math.min(255, Math.round((D[i] / mean) * 0.5 * 255)));
  await sharp(out, { raw: { width: S, height: S, channels: 1 } }).webp({ quality: 88, effort: 6 }).toFile(`${OUT}${s.kind}_d.webp`);
  await sharp(local.nor).resize(S, S, { kernel: 'lanczos3' }).removeAlpha().webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(`${OUT}${s.kind}_n.webp`);
  credits.push(`| \`${s.kind}\` | [${s.asset}](https://polyhaven.com/a/${s.asset}) (${s.src} → ${S}px) | ${s.use} | ${Object.values(src).map((u) => `[${u.split('/').pop()}](${u})`).join(', ')} |`);
  console.log(s.kind, '←', s.asset, s.src, '→', S);
}
writeFileSync(`${OUT}CREDITS.md`, credits.join('\n') + '\n');
