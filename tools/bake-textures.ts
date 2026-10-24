// Bakes the tileable PBR texture sets the world's materials sample.
//
//   npx tsx tools/bake-textures.ts [name ...]
//
// For each material it builds a height field (metres) the way a Substance
// graph would: scattered or coursed shapes with irregular outlines, per-shape
// surface noise and wear, a bed of mortar or earth between them. Albedo,
// roughness, cavity/AO and the normal map are all derived from that height
// plus per-shape colour. Every operation wraps around, so the output tiles.
// Deterministic: same seeds, same images.
//
// Output, per set, in public/textures/: <name>_a.webp (albedo, sRGB),
// <name>_n.webp (tangent-space normal, +x right, +y up), <name>_m.webp
// (R ambient occlusion, G roughness, B height).

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const N = 1024;
const OUT = new URL('../public/textures/', import.meta.url).pathname;

// ------------------------------------------------------------------ basics

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const wrap = (i: number) => ((i % N) + N) % N;

type F = Float32Array;
const field = () => new Float32Array(N * N);

/** Periodic gradient noise: `f` lattice cells across the tile. Range ~[-1, 1]. */
function makeNoise(seed: number) {
  const r = rng(seed);
  const G = 512;
  const gx = new Float32Array(G), gy = new Float32Array(G), perm = new Uint16Array(G * 2);
  for (let i = 0; i < G; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); perm[i] = i; }
  for (let i = G - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < G; i++) perm[G + i] = perm[i];
  const h = (i: number, j: number) => perm[(perm[i & 511] + (j & 511)) & 511];
  return (u: number, v: number, f: number) => {
    const x = u * f, y = v * f;
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const i0 = ((i % f) + f) % f, j0 = ((j % f) + f) % f, i1 = (i0 + 1) % f, j1 = (j0 + 1) % f;
    const d = (ii: number, jj: number, dx: number, dy: number) => { const k = h(ii, jj); return gx[k] * dx + gy[k] * dy; };
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = d(i0, j0, fx, fy), b = d(i1, j0, fx - 1, fy), c = d(i0, j1, fx, fy - 1), e = d(i1, j1, fx - 1, fy - 1);
    return 1.6 * lerp(lerp(a, b, sx), lerp(c, e, sx), sy);
  };
}
type Noise = ReturnType<typeof makeNoise>;
function fbm(n: Noise, u: number, v: number, f: number, oct: number, gain = 0.5) {
  let s = 0, a = 1, t = 0;
  for (let o = 0; o < oct; o++) { s += a * n(u, v, f); t += a; a *= gain; f *= 2; }
  return s / t;
}
/** Fill a field from a function of tile coordinates u, v in [0,1). */
function fill(fn: (u: number, v: number) => number) {
  const o = field();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) o[y * N + x] = fn(x / N, y / N);
  return o;
}

/** Wrapping box blur of radius r (pixels), separable, via running sums. */
function blur(src: F, r: number, passes = 2) {
  let a = Float32Array.from(src), b = field();
  const w = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * N + wrap(k)];
      for (let x = 0; x < N; x++) {
        b[y * N + x] = s / w;
        s += a[y * N + wrap(x + r + 1)] - a[y * N + wrap(x - r)];
      }
    }
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[wrap(k) * N + x];
      for (let y = 0; y < N; y++) {
        a[y * N + x] = s / w;
        s += b[wrap(y + r + 1) * N + x] - b[wrap(y - r) * N + x];
      }
    }
  }
  return a;
}

// ------------------------------------------------------------------ stamping

interface Shape {
  cx: number; cy: number;        // centre, pixels
  a: number; b: number;          // semi-axes, pixels
  rot: number;
  h: number;                     // height of the top, metres
  base: number;                  // height at the outline, metres
  power: number;                 // profile: <1 flat-topped, 1 dome
  irr: number;                   // outline irregularity
  rect?: number;                 // 0 ellipse .. 1 rounded rectangle (superellipse exponent blend)
  col: [number, number, number]; // linear albedo
  rough: number;
  seed: number;
  tilt?: [number, number];       // face tilt, metres across the shape
  rough2?: number;               // surface noise amplitude, metres
}

/**
 * Stamp shapes into height / id fields (max-blend), wrapping at the edges.
 * Each pixel remembers which shape wins, so colour can follow later.
 */
function stamp(H: F, ID: Int32Array, shapes: Shape[], noise: Noise, texelM: number) {
  shapes.forEach((s, idx) => {
    const R = Math.max(s.a, s.b) * (1 + s.irr) + 2;
    const cs = Math.cos(s.rot), sn = Math.sin(s.rot);
    const ph = s.seed * 13.7;
    const ex = s.rect ? lerp(2, 7, s.rect) : 2;
    for (let dy = -Math.ceil(R); dy <= Math.ceil(R); dy++) for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
      const px = Math.round(s.cx) + dx, py = Math.round(s.cy) + dy;
      const rx = px - s.cx, ry = py - s.cy;
      const lx = (rx * cs + ry * sn) / s.a, ly = (-rx * sn + ry * cs) / s.b;
      const ang = Math.atan2(ly, lx);
      // Irregular outline: a few angular harmonics + noise.
      const wob = 1 + s.irr * (0.22 * Math.sin(ang * 2 + ph) + 0.35 * Math.sin(ang * 3 + ph * 1.7) + 0.2 * Math.sin(ang * 5 + ph * 2.3)
        + 0.35 * noise(Math.cos(ang) * 0.12 + s.seed, Math.sin(ang) * 0.12 + s.seed * 0.7, 16)
        + 0.06 * noise(Math.cos(ang) * 0.12 + s.seed, Math.sin(ang) * 0.12, 64));
      const d = Math.pow(Math.pow(Math.abs(lx), ex) + Math.pow(Math.abs(ly), ex), 1 / ex) / wob;
      if (d >= 1) continue;
      const prof = Math.pow(1 - Math.pow(d, 2.2), s.power);
      const u = wrap(px) / N, v = wrap(py) / N;
      let h = s.base + (s.h - s.base) * prof;
      if (s.tilt) h += (lx * s.tilt[0] + ly * s.tilt[1]) * 0.5 * prof;
      const amp = s.rough2 ?? 0.002;
      h += amp * (0.7 * fbm(noise, u + s.seed * 0.37, v + s.seed * 0.61, 40, 5) + 0.35 * noise(u, v, 320)) * Math.min(1, prof * 3);
      h -= amp * 0.8 * smooth(0.45, 0.8, noise(u + s.seed, v, 520)) * Math.min(1, prof * 4); // pits
      const k = wrap(py) * N + wrap(px);
      if (h > H[k]) { H[k] = h; ID[k] = idx; }
    }
  });
  void texelM;
}

/** Dart-throwing placement of roughly round stones, biggest first, wrapping. */
function scatter(r: () => number, count: number, rMin: number, rMax: number, minGap: number) {
  const out: { x: number; y: number; r: number }[] = [];
  const cell = 32, G = N / cell;
  const grid: number[][] = Array.from({ length: G * G }, () => []);
  for (let tries = 0; tries < count * 120 && out.length < count; tries++) {
    const t = out.length / count;
    const rad = lerp(rMax, rMin, Math.pow(t, 0.6)) * lerp(0.8, 1.15, r());
    const x = r() * N, y = r() * N;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    const reach = Math.ceil((rad + rMax + minGap) / cell);
    let ok = true;
    for (let j = -reach; j <= reach && ok; j++) for (let i = -reach; i <= reach && ok; i++) {
      for (const k of grid[((gy + j + G) % G) * G + ((gx + i + G) % G)]) {
        const o = out[k];
        let dx = Math.abs(o.x - x), dy = Math.abs(o.y - y);
        dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy);
        if (Math.hypot(dx, dy) < o.r + rad + minGap) { ok = false; break; }
      }
    }
    if (!ok) continue;
    grid[gy * G + gx].push(out.length);
    out.push({ x, y, r: rad });
  }
  return out;
}

/** Widths along a course that close exactly on the tile (N pixels), starting at x0. */
function course(r: () => number, gen: () => number): { x0: number; w: number[] } {
  const w: number[] = [];
  let tot = 0;
  for (;;) { const g = gen(); if (tot + g > N) break; w.push(g); tot += g; }
  const k = N / tot; // stretch everything a touch so the row closes
  return { x0: r() * N, w: w.map((g) => g * k) };
}

// ------------------------------------------------------------------ colour

const srgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const lin = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255)];
};
function pick<T>(r: () => number, arr: T[]) { return arr[Math.floor(r() * arr.length)]; }
function jitter(c: [number, number, number], r: () => number, amt: number, hue = 0.04): [number, number, number] {
  const k = 1 + (r() - 0.5) * 2 * amt;
  return [c[0] * k * (1 + (r() - 0.5) * hue), c[1] * k * (1 + (r() - 0.5) * hue * 0.6), c[2] * k * (1 + (r() - 0.5) * hue)];
}
const mixc = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ------------------------------------------------------------------ output

interface Baked { name: string; H: F; A: [F, F, F]; Rg: F; tileM: number; normalStrength?: number; aoStrength?: number }

async function write(b: Baked) {
  const { H, A, Rg } = b;
  const texel = b.tileM / N;
  // Cavity / ambient occlusion from height at three scales.
  const ao = new Float32Array(N * N).fill(1);
  const k = b.aoStrength ?? 1;
  for (const [r, w] of [[3, 0.6], [12, 0.45], [40, 0.3]] as const) {
    const bl = blur(H, r);
    for (let i = 0; i < N * N; i++) {
      const occ = Math.max(0, bl[i] - H[i]) / (r * texel * 0.35);
      ao[i] *= 1 - k * w * clamp(occ);
    }
  }
  let hmin = Infinity, hmax = -Infinity;
  for (let i = 0; i < N * N; i++) { hmin = Math.min(hmin, H[i]); hmax = Math.max(hmax, H[i]); }
  const alb = Buffer.alloc(N * N * 3), nor = Buffer.alloc(N * N * 3), mm = Buffer.alloc(N * N * 3);
  const ns = b.normalStrength ?? 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const dhx = (H[y * N + wrap(x + 1)] - H[y * N + wrap(x - 1)]) / (2 * texel);
    const dhy = (H[wrap(y - 1) * N + x] - H[wrap(y + 1) * N + x]) / (2 * texel); // image y grows down; +v is up
    let nx = -dhx * ns, ny = -dhy * ns, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = i * 3;
    // Bake a little of the occlusion into albedo too (cavity darkening reads at any distance).
    const cav = lerp(1, ao[i], 0.55);
    alb[o] = Math.round(clamp(srgb(A[0][i] * cav)) * 255);
    alb[o + 1] = Math.round(clamp(srgb(A[1][i] * cav)) * 255);
    alb[o + 2] = Math.round(clamp(srgb(A[2][i] * cav)) * 255);
    nor[o] = Math.round((nx * 0.5 + 0.5) * 255);
    nor[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    nor[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    mm[o] = Math.round(clamp(ao[i]) * 255);
    mm[o + 1] = Math.round(clamp(Rg[i]) * 255);
    mm[o + 2] = Math.round(clamp((H[i] - hmin) / (hmax - hmin + 1e-9)) * 255);
  }
  const opt = { raw: { width: N, height: N, channels: 3 as const } };
  await sharp(alb, opt).webp({ quality: 84, effort: 5 }).toFile(`${OUT}${b.name}_a.webp`);
  await sharp(nor, opt).webp({ quality: 88, effort: 5 }).toFile(`${OUT}${b.name}_n.webp`);
  await sharp(mm, opt).resize(512, 512).webp({ quality: 88, effort: 5 }).toFile(`${OUT}${b.name}_m.webp`);
  // A small preview sheet for eyeballing.
  await sharp(alb, opt).resize(256, 256).png().toFile(`${OUT}../../tools/preview/${b.name}.png`);
  console.log(b.name, `h ${(hmin * 100).toFixed(1)}..${(hmax * 100).toFixed(1)} cm`);
}

/** Colour every pixel from the winning shape, with a bed colour elsewhere. */
function paint(H: F, ID: Int32Array, shapes: Shape[], bed: (i: number, u: number, v: number) => [number, number, number], bedRough: (i: number) => number, shade: (i: number, s: Shape, c: [number, number, number], u: number, v: number) => [number, number, number]) {
  const A: [F, F, F] = [field(), field(), field()], Rg = field();
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const id = ID[i];
    let c: [number, number, number], ro: number;
    if (id >= 0) { const s = shapes[id]; c = shade(i, s, s.col, u, v); ro = s.rough; }
    else { c = bed(i, u, v); ro = bedRough(i); }
    A[0][i] = c[0]; A[1][i] = c[1]; A[2][i] = c[2]; Rg[i] = ro;
  }
  return { A, Rg };
}

/** Darken colour in crevices and near the bed: grime collects where water stands. */
function grime(A: [F, F, F], H: F, amount: number, tint: [number, number, number]) {
  const bl = blur(H, 6);
  for (let i = 0; i < N * N; i++) {
    const c = clamp((bl[i] - H[i]) * 90) * amount;
    for (let ch = 0; ch < 3; ch++) A[ch][i] = lerp(A[ch][i], A[ch][i] * tint[ch], c);
  }
}

/** Lichen / moss patches from low-frequency noise, sitting on raised surfaces. */
function lichen(A: [F, F, F], H: F, n: Noise, cover: number, col: [number, number, number], f = 6, seed = 0) {
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const m = smooth(1 - cover, 1 - cover + 0.08, fbm(n, u + seed, v + seed * 0.7, f, 5) * 0.5 + 0.5) * smooth(0.3, 0.7, fbm(n, u * 3 + seed, v * 3, 40, 3) * 0.5 + 0.5);
    for (let ch = 0; ch < 3; ch++) A[ch][i] = lerp(A[ch][i], col[ch], m * 0.8);
  }
  void H;
}

// ------------------------------------------------------------------ materials

/** River cobbles set on edge, packed tight in earth (the alleys): acciottolato. */
function cobble(): Baked {
  const tileM = 1.6, texel = tileM / N, r = rng(11), n = makeNoise(11);
  const pts = scatter(r, 2200, 0.022 / texel, 0.068 / texel, 0.0015 / texel);
  // Muted river-stone palette: limestone greys, sandstone, a few dark and rusty ones.
  const pal = ['#7f7a72', '#8a847a', '#6f6b66', '#958c7d', '#7a7064', '#5f5c58', '#8c8170', '#6b655d', '#9a9282'].map(lin);
  const shapes: Shape[] = pts.map((p, i) => {
    const el = lerp(1.0, 1.6, r());
    return {
      cx: p.x, cy: p.y, a: p.r * el * 0.98, b: p.r * 0.98, rot: r() * Math.PI,
      h: 0.022 + 0.012 * r(), base: -0.006, power: lerp(0.2, 0.38, r()), irr: lerp(0.12, 0.3, r()),
      col: jitter(pick(r, pal), r, 0.13, 0.05), rough: lerp(0.66, 0.82, r()), seed: i * 0.173,
      tilt: [(r() - 0.5) * 0.012, (r() - 0.5) * 0.012], rough2: 0.0035,
    };
  });
  // The bed of earth sits high, so stones look sunk in, not laid on top.
  const H = fill((u, v) => 0.006 + 0.008 * fbm(n, u, v, 10, 5) + 0.002 * n(u, v, 200));
  const ID = new Int32Array(N * N).fill(-1);
  stamp(H, ID, shapes, n, texel);
  const earth = lin('#463c31'), earth2 = lin('#2f2a24'), moss = lin('#3f4528');
  const { A, Rg } = paint(H, ID, shapes,
    (_i, u, v) => {
      let c = mixc(earth, earth2, smooth(0.2, 0.8, fbm(n, u + 3, v, 24, 4) * 0.5 + 0.5));
      c = mixc(c, moss, smooth(0.45, 0.75, fbm(n, u + 9, v, 14, 4) * 0.5 + 0.5) * 0.7);
      return c;
    },
    () => 0.96,
    (i, s, c, u, v) => {
      const top = clamp((H[i] - s.base) / (s.h - s.base));
      const mott = 0.82 + 0.3 * fbm(n, u * 1.7 + s.seed, v * 1.7, 60, 4);
      const speck = 1 - 0.18 * smooth(0.55, 0.75, n(u + s.seed, v, 700));
      const dirt = smooth(0.55, 0.0, top); // earth film towards the edges
      const k = lerp(0.72, 1.04, Math.pow(top, 0.5)) * mott * speck;
      return mixc([c[0] * k, c[1] * k, c[2] * k], earth, dirt * 0.55);
    });
  for (let i = 0; i < N * N; i++) if (ID[i] >= 0) { const s = shapes[ID[i]]; Rg[i] = lerp(s.rough + 0.14, s.rough - 0.06, clamp((H[i] - s.base) / (s.h - s.base))); }
  grime(A, H, 0.55, [0.6, 0.56, 0.5]);
  lichen(A, H, n, 0.07, lin('#4c5233'), 5, 2);
  return { name: 'cobble', H, A, Rg, tileM, normalStrength: 1.0 };
}

/** Big polygonal basalt slabs of the Roman street, worn smooth, dirt in the joints. */
function basoli(): Baked {
  const tileM = 3.0, texel = tileM / N, r = rng(21), n = makeNoise(21);
  const pts = scatter(r, 40, 0.3 / texel, 0.42 / texel, 0.02 / texel);
  const H = field(), ID = new Int32Array(N * N).fill(-1);
  // Voronoi slabs with rounded, chipped edges.
  const cols = pts.map(() => jitter(lin(pick(r, ['#3c3b3a', '#454341', '#353534', '#4b4844'])), r, 0.12, 0.03));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let f1 = 1e9, f2 = 1e9, id = -1;
    const wx = x + 14 * n(x / N, y / N, 6), wy = y + 14 * n(x / N + 0.5, y / N, 6);
    for (let k = 0; k < pts.length; k++) {
      let dx = Math.abs(pts[k].x - wx), dy = Math.abs(pts[k].y - wy);
      dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy);
      const d = Math.hypot(dx, dy);
      if (d < f1) { f2 = f1; f1 = d; id = k; } else if (d < f2) f2 = d;
    }
    const edge = (f2 - f1) * texel; // metres from the joint (x2)
    const gap = 0.012 + 0.01 * (n(x / N, y / N, 40) * 0.5 + 0.5);
    const i = y * N + x;
    if (edge < gap) { H[i] = -0.03 + 0.008 * fbm(n, x / N, y / N, 64, 3); ID[i] = -1; continue; }
    const round = smooth(gap, gap + 0.07, edge);
    H[i] = -0.012 + 0.02 * Math.sqrt(round) + 0.004 * fbm(n, x / N + id, y / N, 12, 4) + 0.0015 * fbm(n, x / N, y / N, 120, 3);
    ID[i] = id;
  }
  const A: [F, F, F] = [field(), field(), field()], Rg = field();
  const dirt = lin('#4b3f31');
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    let c: [number, number, number];
    if (ID[i] < 0) { c = mixc(dirt, lin('#3a352c'), fbm(n, u, v, 30, 3) * 0.5 + 0.5); Rg[i] = 0.95; }
    else {
      const base = cols[ID[i]];
      const pits = smooth(0.55, 0.75, n(u, v, 200) * 0.5 + 0.5);
      const k = (0.85 + 0.25 * fbm(n, u + 7, v, 20, 4)) * (1 - pits * 0.3);
      c = [base[0] * k, base[1] * k, base[2] * k];
      Rg[i] = lerp(0.58, 0.8, fbm(n, u + 2, v, 10, 3) * 0.5 + 0.5) + pits * 0.15;
    }
    A[0][i] = c[0]; A[1][i] = c[1]; A[2][i] = c[2];
  }
  grime(A, H, 0.8, [0.6, 0.55, 0.45]);
  lichen(A, H, n, 0.06, lin('#55583c'), 4, 5);
  return { name: 'basoli', H, A, Rg, tileM };
}

/** Packed earth and mud with pebbles and bits of straw. */
function mud(): Baked {
  const tileM = 2.5, texel = tileM / N, r = rng(31), n = makeNoise(31);
  const H = fill((u, v) => 0.02 * fbm(n, u, v, 4, 6) + 0.004 * fbm(n, u + 3, v, 60, 3));
  const pts = scatter(r, 260, 0.006 / texel, 0.03 / texel, 0.01 / texel);
  const pal = ['#857b6c', '#6f6a63', '#9b8e79', '#5d5650'].map(lin);
  const shapes: Shape[] = pts.map((p, i) => ({
    cx: p.x, cy: p.y, a: p.r * lerp(1, 1.5, r()), b: p.r, rot: r() * Math.PI,
    h: 0.0, base: -0.01, power: 0.5, irr: 0.2, col: jitter(pick(r, pal), r, 0.2), rough: 0.75, seed: i * 0.31,
  }));
  // Pebbles sit just proud of the local mud surface.
  for (const s of shapes) { const k = Math.floor(s.cy) * N + Math.floor(s.cx); s.h = H[k] + 0.004 + 0.01 * r(); s.base = H[k] - 0.004; }
  const ID = new Int32Array(N * N).fill(-1);
  stamp(H, ID, shapes, n, texel);
  const e1 = lin('#53473a'), e2 = lin('#3f362d'), e3 = lin('#6a5c49');
  const { A, Rg } = paint(H, ID, shapes,
    (i, u, v) => {
      const t = fbm(n, u + 1, v, 6, 5) * 0.5 + 0.5;
      const c = mixc(mixc(e2, e1, t), e3, smooth(0.6, 0.85, fbm(n, u, v + 2, 20, 3) * 0.5 + 0.5) * 0.5);
      return c;
    }, () => 0.96, (_i, _s, c) => c);
  // Straw: short pale strokes.
  const straw = lin('#9c8a5e');
  for (let k = 0; k < 500; k++) {
    const x0 = r() * N, y0 = r() * N, a = r() * Math.PI, L = (0.03 + 0.06 * r()) / texel;
    for (let t = 0; t < L; t++) {
      const x = wrap(Math.round(x0 + Math.cos(a) * t)), y = wrap(Math.round(y0 + Math.sin(a) * t));
      const i = y * N + x;
      for (let ch = 0; ch < 3; ch++) A[ch][i] = lerp(A[ch][i], straw[ch] * lerp(0.6, 1, r()), 0.7);
      H[i] += 0.0015;
    }
  }
  // Damp low spots: darker, smoother.
  for (let i = 0; i < N * N; i++) {
    const wet = smooth(0.004, -0.008, H[i]);
    for (let ch = 0; ch < 3; ch++) A[ch][i] *= 1 - 0.35 * wet;
    Rg[i] = lerp(Rg[i], 0.55, wet);
  }
  grime(A, H, 0.4, [0.7, 0.65, 0.6]);
  return { name: 'mud', H, A, Rg, tileM, normalStrength: 0.8 };
}

/** River stones and broken brick laid in courses in lime mortar; every 4th course herringbone. */
function rubble(): Baked {
  const tileM = 2.0, texel = tileM / N, r = rng(41), n = makeNoise(41);
  const shapes: Shape[] = [];
  const pal = ['#9c9384', '#8b8478', '#a39a88', '#7d786f', '#b0a48e', '#8e8068', '#776d62'].map(lin);
  const brick = ['#8a5a44', '#7a4d3b', '#946450'].map(lin);
  let y = 0, row = 0;
  const rowH: number[] = [];
  while (y < N - 8) { const h = (0.09 + 0.07 * r()) / texel; rowH.push(h); y += h; }
  const scale = N / y; // make the courses fit the tile exactly
  y = 0;
  for (const h0 of rowH) {
    const h = h0 * scale;
    const herring = row % 4 === 3;
    let x = r() * N;
    const xEnd = x + N;
    let flip = 1;
    const cw = herring ? null : course(r, () => (0.1 + 0.18 * r()) / texel);
    if (cw) x = cw.x0;
    let wi = 0;
    while (herring ? x < xEnd - 4 : wi < cw!.w.length) {
      if (herring) {
        const L = (0.13 + 0.05 * r()) / texel, W = (0.035 + 0.012 * r()) / texel;
        shapes.push({ cx: x, cy: y + h / 2, a: L / 2, b: W / 2, rot: flip * (0.75 + 0.15 * r()), h: 0.03 + 0.02 * r(), base: 0.0, power: 0.45, irr: 0.12,
          col: jitter(r() < 0.25 ? pick(r, brick) : pick(r, pal), r, 0.15), rough: 0.85, seed: shapes.length * 0.11, rough2: 0.002 });
        x += W * 1.55; flip = -flip;
      } else {
        const w = cw!.w[wi++];
        const isBrick = r() < 0.12;
        shapes.push({ cx: x + w / 2, cy: y + h / 2 + (r() - 0.5) * 0.12 * h, a: w / 2 * lerp(0.82, 0.95, r()), b: h / 2 * lerp(0.72, 0.9, r()), rot: (r() - 0.5) * 0.25,
          h: 0.035 + 0.03 * r(), base: 0.0, power: isBrick ? 0.25 : lerp(0.35, 0.6, r()), irr: isBrick ? 0.05 : 0.14, rect: isBrick ? 0.8 : 0,
          col: jitter(isBrick ? pick(r, brick) : pick(r, pal), r, 0.16), rough: isBrick ? 0.92 : 0.82, seed: shapes.length * 0.11,
          tilt: [(r() - 0.5) * 0.015, (r() - 0.5) * 0.015], rough2: 0.0025 });
        x += w;
      }
    }
    y += h; row++;
  }
  // Wrap shapes that cross the right edge.
  const H = fill((u, v) => 0.006 + 0.006 * fbm(n, u, v, 30, 4) - 0.012 * smooth(0.55, 0.8, fbm(n, u + 5, v, 5, 4) * 0.5 + 0.5));
  const ID = new Int32Array(N * N).fill(-1);
  stamp(H, ID, shapes, n, texel);
  const mortar = lin('#b7ad98'), mortar2 = lin('#8f8574');
  const { A, Rg } = paint(H, ID, shapes,
    (_i, u, v) => mixc(mortar, mortar2, smooth(0.3, 0.8, fbm(n, u + 2, v, 12, 5) * 0.5 + 0.5)),
    () => 0.97,
    (i, s, c, u, v) => {
      const top = clamp((H[i] - s.base) / (s.h - s.base));
      const k = lerp(0.7, 1.05, Math.sqrt(top)) * (0.9 + 0.2 * fbm(n, u + s.seed, v, 48, 3));
      return [c[0] * k, c[1] * k, c[2] * k];
    });
  grime(A, H, 0.85, [0.5, 0.47, 0.42]);
  // Rain streaks: soft vertical darkening.
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const st = smooth(0.2, 0.9, n(u * 3, v * 0.25, 24) * 0.5 + 0.5) * 0.25;
    for (let ch = 0; ch < 3; ch++) A[ch][i] *= 1 - st;
  }
  lichen(A, H, n, 0.08, lin('#8a8a6a'), 7, 1);
  return { name: 'rubble', H, A, Rg, tileM };
}

/** Roman bricks in thick mortar beds, two courses of squared tuff per tile. */
function brickSet(): Baked {
  const tileM = 1.6, texel = tileM / N, r = rng(51), n = makeNoise(51);
  const shapes: Shape[] = [];
  const reds = ['#8f5a42', '#7f4c37', '#9b6650', '#a07258', '#6e4433', '#8a604a'].map(lin);
  const tuff = ['#9a8a68', '#8d7f62', '#a39572'].map(lin);
  const courses: ('b' | 't')[] = ['b', 'b', 'b', 'b', 'b', 'b', 'b', 't', 't', 'b', 'b', 'b', 'b', 'b', 'b', 'b'];
  const heights = courses.map((c) => (c === 'b' ? 0.045 + 0.025 : 0.13 + 0.022));
  const total = heights.reduce((a, b) => a + b, 0);
  const s = tileM / total;
  let y = 0;
  courses.forEach((c, ci) => {
    const ch = heights[ci] * s / texel, joint = (c === 'b' ? 0.025 : 0.022) * s / texel;
    const row = course(r, () => { const L = (c === 'b' ? 0.28 + 0.16 * r() : 0.2 + 0.12 * r()) / texel; return r() < 0.15 && c === 'b' ? L * lerp(0.4, 0.7, r()) : L; });
    let x = row.x0;
    for (const w of row.w) {
      shapes.push({
        cx: x + w / 2, cy: y + ch / 2, a: w / 2 - joint / 2, b: (ch - joint) / 2, rot: (r() - 0.5) * 0.02,
        h: 0.02 + 0.008 * r(), base: 0.004, power: 0.18, irr: c === 'b' ? 0.04 : 0.07, rect: 0.85,
        col: jitter(c === 'b' ? pick(r, reds) : pick(r, tuff), r, 0.12, 0.05), rough: 0.9, seed: shapes.length * 0.07,
        tilt: [(r() - 0.5) * 0.004, (r() - 0.5) * 0.004], rough2: 0.002,
      });
      x += w;
    }
    y += ch;
  });
  const H = fill((u, v) => 0.0 + 0.004 * fbm(n, u, v, 40, 4));
  const ID = new Int32Array(N * N).fill(-1);
  stamp(H, ID, shapes, n, texel);
  // Edge wear: erode the brick tops where noise says so (chipped arrises).
  for (let i = 0; i < N * N; i++) {
    if (ID[i] < 0) continue;
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const sh = shapes[ID[i]];
    const top = clamp((H[i] - sh.base) / (sh.h - sh.base));
    const chip = smooth(0.62, 0.7, fbm(n, u + 4, v, 70, 3) * 0.5 + 0.5) * (1 - top * 0.6);
    H[i] -= chip * 0.012;
  }
  const mortar = lin('#a99f8b'), mortar2 = lin('#7d7466');
  const { A, Rg } = paint(H, ID, shapes,
    (_i, u, v) => mixc(mortar, mortar2, smooth(0.2, 0.8, fbm(n, u + 2, v, 16, 5) * 0.5 + 0.5)),
    () => 0.97,
    (i, sh, c, u, v) => {
      const k = (0.86 + 0.22 * fbm(n, u + sh.seed, v, 30, 4)) * (1 - 0.25 * smooth(0.6, 0.8, n(u, v, 260) * 0.5 + 0.5));
      void i;
      return [c[0] * k, c[1] * k, c[2] * k];
    });
  grime(A, H, 0.8, [0.5, 0.45, 0.42]);
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const st = smooth(0.3, 0.9, n(u * 4, v * 0.3, 20) * 0.5 + 0.5) * 0.22;
    for (let ch = 0; ch < 3; ch++) A[ch][i] *= 1 - st;
  }
  return { name: 'brick', H, A, Rg, tileM };
}

/** Squared limestone blocks, pillowed faces, tool marks, chipped arrises. */
function ashlar(): Baked {
  const tileM = 3.0, texel = tileM / N, r = rng(61), n = makeNoise(61);
  const shapes: Shape[] = [];
  const pal = ['#a59b88', '#988f7d', '#ada28c', '#8e8676', '#b3a78f', '#9b8e77'].map(lin);
  const rows = [0.38, 0.32, 0.44, 0.3, 0.4, 0.36, 0.42, 0.34];
  const tot = rows.reduce((a, b) => a + b, 0), sc = tileM / tot;
  let y = 0;
  rows.forEach((h0) => {
    const h = h0 * sc / texel, joint = 0.008 / texel;
    const row = course(r, () => (0.45 + 0.5 * r()) / texel);
    let x = row.x0;
    for (const w of row.w) {
      shapes.push({ cx: x + w / 2, cy: y + h / 2, a: w / 2 - joint, b: h / 2 - joint, rot: (r() - 0.5) * 0.01, h: 0.03 + 0.01 * r(), base: 0.006, power: 0.12, irr: 0.02, rect: 0.95,
        col: jitter(pick(r, pal), r, 0.1), rough: 0.88, seed: shapes.length * 0.13, tilt: [(r() - 0.5) * 0.01, (r() - 0.5) * 0.01], rough2: 0.003 });
      x += w;
    }
    y += h;
  });
  const H = fill(() => 0);
  const ID = new Int32Array(N * N).fill(-1);
  stamp(H, ID, shapes, n, texel);
  for (let i = 0; i < N * N; i++) {
    if (ID[i] < 0) continue;
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const s = shapes[ID[i]];
    // Diagonal tooling (gradina), varying direction per block.
    const ang = (s.seed * 7.1) % 1 * 0.8 - 0.4 + 0.8;
    const t = Math.sin((u * Math.cos(ang) + v * Math.sin(ang)) * N * 0.9 + 3 * n(u, v, 50));
    H[i] += 0.0007 * t;
    const chip = smooth(0.66, 0.72, fbm(n, u + 4, v, 60, 3) * 0.5 + 0.5);
    H[i] -= chip * 0.015 * (1 - clamp((H[i] - s.base) / (s.h - s.base)) * 0.5);
  }
  const mortar = lin('#9b927f');
  const { A, Rg } = paint(H, ID, shapes, () => mortar, () => 0.96, (_i, s, c, u, v) => {
    const k = 0.88 + 0.22 * fbm(n, u + s.seed, v, 14, 5);
    return [c[0] * k, c[1] * k, c[2] * k];
  });
  grime(A, H, 0.7, [0.55, 0.5, 0.45]);
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const st = smooth(0.25, 0.9, n(u * 5, v * 0.3, 16) * 0.5 + 0.5) * 0.3;
    for (let ch = 0; ch < 3; ch++) A[ch][i] *= 1 - st;
  }
  lichen(A, H, n, 0.12, lin('#7f8262'), 5, 3);
  lichen(A, H, n, 0.05, lin('#b8a874'), 9, 8);
  return { name: 'ashlar', H, A, Rg, tileM };
}

/** Catacomb tuff: soft porous yellow-brown rock, pick marks, strata, niter bloom. */
function tuffSet(): Baked {
  const tileM = 2.5, texel = tileM / N, r = rng(71), n = makeNoise(71);
  const H = fill((u, v) => 0.03 * fbm(n, u, v, 3, 6) + 0.006 * fbm(n, u + 1, v, 24, 4));
  // Pick marks: short scooped gouges, roughly aligned per region.
  for (let k = 0; k < 2600; k++) {
    const x0 = r() * N, y0 = r() * N;
    const base = n(x0 / N, y0 / N, 3) * 1.2 + 0.7;
    const a = base + (r() - 0.5) * 0.5;
    const L = (0.04 + 0.05 * r()) / texel, W = (0.008 + 0.006 * r()) / texel, D = 0.004 + 0.004 * r();
    for (let t = -W * 2; t <= L + W * 2; t++) for (let s2 = -W * 2; s2 <= W * 2; s2++) {
      const x = wrap(Math.round(x0 + Math.cos(a) * t - Math.sin(a) * s2)), y = wrap(Math.round(y0 + Math.sin(a) * t + Math.cos(a) * s2));
      const along = clamp(t / L), across = s2 / W;
      const prof = Math.exp(-across * across) * Math.sin(Math.PI * along) * (t >= 0 && t <= L ? 1 : 0);
      H[y * N + x] -= D * prof;
    }
  }
  // Pores.
  for (let k = 0; k < 9000; k++) {
    const x0 = Math.floor(r() * N), y0 = Math.floor(r() * N), rad = 1 + r() * 3;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy) / rad;
      if (d < 1) H[wrap(y0 + dy) * N + wrap(x0 + dx)] -= 0.0015 * (1 - d * d);
    }
  }
  const A: [F, F, F] = [field(), field(), field()], Rg = field();
  const c1 = lin('#8a7451'), c2 = lin('#6e5a3d'), c3 = lin('#a08b63'), nit = lin('#b9b3a2');
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const strata = Math.sin(v * Math.PI * 2 * 7 + 2.5 * fbm(n, u, v, 4, 3)) * 0.5 + 0.5;
    let c = mixc(c2, c1, fbm(n, u + 3, v, 6, 5) * 0.5 + 0.5);
    c = mixc(c, c3, strata * 0.35);
    const ni = smooth(0.58, 0.72, fbm(n, u + 8, v, 5, 5) * 0.5 + 0.5);
    c = mixc(c, nit, ni * 0.5);
    A[0][i] = c[0]; A[1][i] = c[1]; A[2][i] = c[2];
    Rg[i] = 0.95;
  }
  grime(A, H, 0.9, [0.55, 0.5, 0.45]);
  return { name: 'tuff', H, A, Rg, tileM, aoStrength: 1.2 };
}

/** Lime-washed plaster over rubble: trowel waves, cracks, flaked patches, stains. */
function plaster(): Baked {
  const tileM = 2.5, texel = tileM / N, r = rng(81), n = makeNoise(81);
  const under = rubble(); // what shows where the plaster has fallen
  const H = fill((u, v) => 0.025 + 0.004 * fbm(n, u, v, 6, 5) + 0.0015 * fbm(n, u + 2, v, 40, 3));
  const A: [F, F, F] = [field(), field(), field()], Rg = field();
  const lime = lin('#c9c1ae'), lime2 = lin('#a99e86'), ochre = lin('#b49a72');
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const loss = fbm(n, u + 5, v, 4, 6) * 0.5 + 0.5;
    const lost = smooth(0.66, 0.68, loss);
    const ux = (Math.floor(u * N * 0.8) % N + N) % N, vy = (Math.floor(v * N * 0.8) % N + N) % N; // rubble at a different scale
    const j = vy * N + ux;
    const ridge = smooth(0.64, 0.66, loss) - lost; // thin raised lip at the break
    if (lost > 0.5) {
      H[i] = under.H[j] - 0.01;
      for (let ch = 0; ch < 3; ch++) A[ch][i] = under.A[ch][j];
      Rg[i] = under.Rg[j];
    } else {
      H[i] += ridge * 0.004;
      let c = mixc(lime, lime2, smooth(0.2, 0.9, fbm(n, u, v + 4, 8, 5) * 0.5 + 0.5));
      c = mixc(c, ochre, smooth(0.5, 0.9, fbm(n, u + 9, v, 3, 4) * 0.5 + 0.5) * 0.5);
      for (let ch = 0; ch < 3; ch++) A[ch][i] = c[ch];
      Rg[i] = 0.93;
    }
  }
  // Hairline cracks: thin channels along a warped cell network.
  const cr = rng(83);
  const cpts = Array.from({ length: 45 }, () => [cr() * N, cr() * N]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const wx = x + 25 * n(x / N, y / N, 8), wy = y + 25 * n(x / N + 0.3, y / N, 8);
    let f1 = 1e9, f2 = 1e9;
    for (const [px, py] of cpts) {
      let dx = Math.abs(px - wx), dy = Math.abs(py - wy);
      dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy);
      const d = Math.hypot(dx, dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const i = y * N + x;
    const crack = smooth(2.2, 0.4, f2 - f1) * smooth(0.45, 0.6, n(x / N, y / N, 12) * 0.5 + 0.5);
    H[i] -= crack * 0.003;
    for (let ch = 0; ch < 3; ch++) A[ch][i] *= 1 - crack * 0.5;
  }
  // Damp rising from below and rain streaks.
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const st = smooth(0.25, 0.9, n(u * 4, v * 0.25, 20) * 0.5 + 0.5) * 0.3;
    for (let ch = 0; ch < 3; ch++) A[ch][i] *= 1 - st;
  }
  grime(A, H, 0.7, [0.5, 0.46, 0.42]);
  void texel; void r;
  return { name: 'plaster', H, A, Rg, tileM, normalStrength: 1.2 };
}

/** Weathered oak planks: open grain, checks and cracks, a few knots, silvered by rain. */
function wood(): Baked {
  const tileM = 2.0, texel = tileM / N, r = rng(91), n = makeNoise(91);
  const H = field(), A: [F, F, F] = [field(), field(), field()], Rg = field();
  // Planks across u; grain along v (texture v = up along the plank).
  const edges: number[] = [0];
  while (edges[edges.length - 1] < N) edges.push(edges[edges.length - 1] + (0.16 + 0.12 * r()) / texel);
  const sc = N / edges[edges.length - 1];
  for (let k = 0; k < edges.length; k++) edges[k] *= sc;
  const tones = edges.map(() => jitter(lin(pick(r, ['#6e604f', '#5d5144', '#7a6a55', '#665a4c'])), r, 0.12));
  const knots = Array.from({ length: 10 }, () => [r() * N, r() * N, (0.012 + 0.02 * r()) / texel]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, u = x / N, v = y / N;
    let p = 0;
    while (p < edges.length - 2 && x >= edges[p + 1]) p++;
    const fx = (x - edges[p]) / (edges[p + 1] - edges[p]);
    const gap = smooth(0, 0.025, fx) * smooth(1, 0.975, fx);
    // Knot distortion of the grain.
    let warp = 0, knotM = 0;
    for (const [kx, ky, kr] of knots) {
      let dx = Math.abs(x - kx), dy = Math.abs(y - ky);
      dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy);
      const d = Math.hypot(dx * 1.8, dy) / kr;
      warp += Math.exp(-d * d * 0.25) * 6 * Math.sign(x - kx);
      knotM = Math.max(knotM, smooth(1.1, 0.6, d));
    }
    const g = u * N * 0.55 + 6 * fbm(n, u * 0.3 + p, v * 0.05, 8, 4) + warp;
    const grain = Math.pow(Math.abs(Math.sin(g * Math.PI * 0.5)), 0.6);
    const fine = fbm(n, u * 6 + p, v * 0.3, 30, 4);
    const check = smooth(0.92, 0.97, Math.abs(n(u * 2 + p * 0.3, v * 0.15, 60))) * smooth(0.4, 0.6, n(u, v, 10) * 0.5 + 0.5);
    H[i] = (gap * (0.012 + 0.003 * grain + 0.0015 * fine) - check * 0.004 - knotM * 0.002) * 1.0;
    const c = tones[p];
    const silver = smooth(0.2, 0.8, fbm(n, u + 4, v, 6, 4) * 0.5 + 0.5) * 0.45;
    const k = (0.78 + 0.28 * grain) * (0.9 + 0.15 * fine) * (1 - knotM * 0.4) * (1 - check * 0.5) * lerp(0.35, 1, gap);
    const cc = mixc(c, lin('#8a8478'), silver);
    A[0][i] = cc[0] * k; A[1][i] = cc[1] * k; A[2][i] = cc[2] * k;
    Rg[i] = 0.9 + 0.06 * grain;
  }
  grime(A, H, 0.6, [0.55, 0.5, 0.45]);
  return { name: 'wood', H, A, Rg, tileM };
}

/** Coppi: half-round terracotta tiles, canals and covers down the slope (v), lips at each course. */
function coppi(): Baked {
  const tileM = 2.0, texel = tileM / N, r = rng(101), n = makeNoise(101);
  const H = field(), A: [F, F, F] = [field(), field(), field()], Rg = field();
  const colW = 0.17 / texel;
  const cols = Math.round(N / colW), cw = N / cols;
  const rows = Math.round(N / (0.42 / texel)), rh = N / rows;
  const tone = Array.from({ length: cols * rows }, () => jitter(lin(pick(r, ['#8d5338', '#9a6043', '#7c4a35', '#a46d4e', '#86553f', '#6f4636'])), r, 0.12, 0.06));
  const shift = Array.from({ length: cols }, () => r() * rh);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, u = x / N, v = y / N;
    const ci = Math.floor(x / cw), fx = (x - ci * cw) / cw;
    const cover = ci % 2 === 1;
    const yy = (y + shift[ci]) % N;
    const ri = Math.floor(yy / rh), fy = (yy - ri * rh) / rh;
    // Each tile narrows towards its upper end; the lower end (lip) overlaps the next.
    const taper = lerp(1.0, 0.86, fy);
    const t = (fx - 0.5) / (0.5 * (cover ? 1.25 : 1.0) * taper);
    const prof = Math.sqrt(clamp(1 - t * t));
    let h: number;
    if (cover) h = Math.abs(t) < 1 ? 0.035 + 0.05 * prof : 0.0;
    else h = 0.022 - 0.02 * prof;
    const lip = smooth(0.9, 1.0, fy) * 0.006;
    h += lip - fy * 0.006;
    h += 0.0012 * fbm(n, u + ci, v, 60, 3);
    H[i] = h;
    const c = tone[(ri % rows) * cols + ci];
    const k = (0.85 + 0.2 * fbm(n, u + ci * 0.1, v, 30, 4)) * lerp(0.7, 1.05, cover ? prof : 1 - prof * 0.3);
    A[0][i] = c[0] * k; A[1][i] = c[1] * k; A[2][i] = c[2] * k;
    Rg[i] = 0.9;
  }
  grime(A, H, 0.9, [0.4, 0.38, 0.35]);
  lichen(A, H, n, 0.16, lin('#9a9573'), 7, 4);
  lichen(A, H, n, 0.08, lin('#b59a5c'), 13, 9);
  lichen(A, H, n, 0.1, lin('#3c3f2a'), 5, 12);
  return { name: 'coppi', H, A, Rg, tileM };
}

/** Roman travertine / marble spolia: horizontal pore channels, weathered, rain-blackened. */
function travertine(): Baked {
  const tileM = 2.0, texel = tileM / N, r = rng(111), n = makeNoise(111);
  const H = fill((u, v) => 0.004 * fbm(n, u, v, 6, 5));
  for (let k = 0; k < 2200; k++) {
    const x0 = r() * N, y0 = r() * N, L = (0.01 + 0.06 * r()) / texel, W = (0.002 + 0.005 * r()) / texel, D = 0.002 + 0.004 * r();
    for (let t = 0; t < L; t++) for (let s2 = -W; s2 <= W; s2++) {
      const x = wrap(Math.round(x0 + t)), y = wrap(Math.round(y0 + s2 + 1.5 * Math.sin(t * 0.05)));
      const pr = Math.sin(Math.PI * t / L) * (1 - (s2 / W) ** 2);
      H[y * N + x] -= D * pr;
    }
  }
  const A: [F, F, F] = [field(), field(), field()], Rg = field();
  const c1 = lin('#c3b597'), c2 = lin('#a7987a');
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N, v = Math.floor(i / N) / N;
    const band = Math.sin(v * Math.PI * 2 * 9 + 1.5 * fbm(n, u, v, 3, 3)) * 0.5 + 0.5;
    const c = mixc(c2, c1, band * 0.5 + 0.5 * (fbm(n, u + 2, v, 8, 4) * 0.5 + 0.5));
    const st = smooth(0.3, 0.9, n(u * 4, v * 0.25, 20) * 0.5 + 0.5) * 0.45;
    A[0][i] = c[0] * (1 - st); A[1][i] = c[1] * (1 - st); A[2][i] = c[2] * (1 - st);
    Rg[i] = 0.82;
  }
  grime(A, H, 1.0, [0.45, 0.42, 0.38]);
  lichen(A, H, n, 0.1, lin('#8e8f6e'), 6, 6);
  void texel;
  return { name: 'travertine', H, A, Rg, tileM };
}

/** Low-frequency 256² noise for the shaders' macro variation (R,G,B independent octaves). */
async function macroNoise() {
  const S = 256, buf = Buffer.alloc(S * S * 4);
  const ns = [makeNoise(201), makeNoise(202), makeNoise(203), makeNoise(204)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, o = (y * S + x) * 4;
    buf[o] = Math.round(clamp(fbm(ns[0], u, v, 4, 5) * 0.5 + 0.5) * 255);
    buf[o + 1] = Math.round(clamp(fbm(ns[1], u, v, 8, 4) * 0.5 + 0.5) * 255);
    buf[o + 2] = Math.round(clamp(fbm(ns[2], u, v, 16, 3) * 0.5 + 0.5) * 255);
    buf[o + 3] = Math.round(clamp(fbm(ns[3], u, v, 6, 5) * 0.5 + 0.5) * 255);
  }
  await sharp(buf, { raw: { width: S, height: S, channels: 4 } }).png().toFile(`${OUT}noise.png`);
  console.log('noise');
}

const ALL: Record<string, () => Baked> = { cobble, basoli, mud, rubble, brick: brickSet, ashlar, tuff: tuffSet, plaster, wood, coppi, travertine };

mkdirSync(OUT, { recursive: true });
mkdirSync(new URL('../tools/preview/', import.meta.url).pathname, { recursive: true });
const want = process.argv.slice(2);
const t0 = Date.now();
if (!want.length || want.includes('noise')) await macroNoise();
for (const [name, fn] of Object.entries(ALL)) {
  if (want.length && !want.includes(name)) continue;
  const t = Date.now();
  await write(fn());
  console.log(`  ${name} ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
