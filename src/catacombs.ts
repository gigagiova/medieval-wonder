import * as THREE from 'three';
import { field } from './displace';
import { Builder, rng } from './builder';
import type { MatName } from './materials';

// Catacombs carved out of tuff, as one continuous rock surface: a signed
// distance field of the carved void (galleries, cubicula, loculi, arcosolia,
// lamp niches, a crypt, the stair) sampled on a grid and meshed with surface
// nets. There are no seams between floor, walls and vault.
//
// Layout follows Roman / early-Christian catacombs: narrow, tall galleries
// wandering with the softness of the rock; walls stacked with loculi (some
// sealed with tiles or marble, most broken open); small family chambers with
// arched tomb niches; little niches for clay lamps.

const STAIR_X = -36, STAIR_W = 3, STAIR_TOP = -52, STAIR_RUN = 0.35, STAIR_RISE = 0.25, DEPTH = -7;
const STEPS = Math.round(-DEPTH / STAIR_RISE);
const STAIR_END = STAIR_TOP - STEPS * STAIR_RUN;
const HOLE_END = -56;
const CELL = 0.2;
// The field is rock outside the carved void; surface nets emit no faces in the
// outermost cell layer, so the domain keeps >= 2 coarse (0.6 m) collision cells
// of rock below the deepest floor (-7.7 in the crypt). With y0 = -8.2 the crypt
// floor fell inside that unmeshed layer and had no collision: players fell out.
const DOM = { x0: -65, x1: -9, y0: -9.4, y1: 0.02, z0: -105, z1: -50.5 };

/**
 * The martyr's stair: from inside the cella memoriae outside the north postern
 * down to the crypt. Descends towards +z. Its opening in the ground (x, z) is
 * aligned to the 0.6 m town ground grid; world.ts cuts the same hole.
 */
export const CELLA_STAIR = {
  x: -20.1, w: 1.5, top: -96.0, holeEnd: -91.2, rise: 0.25, run: 0.35, bottomF: -7.35,
  hole: { x0: -21.0, x1: -19.2, z0: -96.0, z1: -91.2 },
  /** Tread height of the top step: the ground there (set by world.ts before building). */
  topF: 1.4,
};

const rand = rng(7331);
const R = (a: number, b: number) => a + (b - a) * rand();
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---- noise ---------------------------------------------------------------
const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
{
  let s = 4711;
  const r = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) VAL[i] = r() * 2 - 1;
}
function noise(x: number, y: number, z: number) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const xi = fx & 255, yi = fy & 255, zi = fz & 255;
  let u = x - fx, w2 = y - fy, w = z - fz;
  u = u * u * (3 - 2 * u); w2 = w2 * w2 * (3 - 2 * w2); w = w * w * (3 - 2 * w);
  const a = PERM[xi] + yi, b = PERM[xi + 1] + yi;
  const aa = PERM[a] + zi, ab = PERM[a + 1] + zi, ba = PERM[b] + zi, bb = PERM[b + 1] + zi;
  const x1 = VAL[PERM[aa]] + (VAL[PERM[ba]] - VAL[PERM[aa]]) * u;
  const x2 = VAL[PERM[ab]] + (VAL[PERM[bb]] - VAL[PERM[ab]]) * u;
  const x3 = VAL[PERM[aa + 1]] + (VAL[PERM[ba + 1]] - VAL[PERM[aa + 1]]) * u;
  const x4 = VAL[PERM[ab + 1]] + (VAL[PERM[bb + 1]] - VAL[PERM[ab + 1]]) * u;
  const y1 = x1 + (x2 - x1) * w2, y2 = x3 + (x4 - x3) * w2;
  return y1 + (y2 - y1) * w;
}

// ---- primitives of the carved void (negative = air) -----------------------
const enum K { Tunnel, Box, Arch, Stair, Rubble }
interface Prim {
  k: K;
  // Tunnel: a(x,z) b(x,z), floors, widths, heights. Box/Arch: centre, axes, half sizes.
  ax: number; az: number; bx: number; bz: number;
  fa: number; fb: number; wa: number; wb: number; ha: number; hb: number;
  cx: number; cy: number; cz: number; ux: number; uz: number; hu: number; hv: number; hw: number; r: number;
  smooth: number;
  xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number;
}
const prims: Prim[] = [];
const blank = (): Prim => ({
  k: K.Box, ax: 0, az: 0, bx: 0, bz: 0, fa: 0, fb: 0, wa: 0, wb: 0, ha: 0, hb: 0,
  cx: 0, cy: 0, cz: 0, ux: 1, uz: 0, hu: 0, hv: 0, hw: 0, r: 0, smooth: 0.1,
  xmin: 0, xmax: 0, ymin: 0, ymax: 0, zmin: 0, zmax: 0,
});

function tunnel(ax: number, az: number, fa: number, bx: number, bz: number, fb: number, wa: number, wb: number, ha: number, hb: number, smooth = 0.22) {
  const p = blank();
  Object.assign(p, { k: K.Tunnel, ax, az, bx, bz, fa, fb, wa, wb, ha, hb, smooth });
  const m = Math.max(wa, wb) / 2 + 0.6;
  p.xmin = Math.min(ax, bx) - m; p.xmax = Math.max(ax, bx) + m;
  p.zmin = Math.min(az, bz) - m; p.zmax = Math.max(az, bz) + m;
  p.ymin = Math.min(fa, fb) - 0.6; p.ymax = Math.max(fa + ha, fb + hb) + 0.6;
  prims.push(p);
  return p;
}
/** Oriented rounded box: `u` is the horizontal axis (unit), w = perpendicular. */
function box(k: K.Box | K.Arch | K.Rubble, cx: number, cy: number, cz: number, ux: number, uz: number, hu: number, hv: number, hw: number, r: number, smooth = 0.08) {
  const p = blank();
  Object.assign(p, { k, cx, cy, cz, ux, uz, hu, hv, hw, r, smooth });
  const m = Math.hypot(hu, hw) + 0.5;
  p.xmin = cx - m; p.xmax = cx + m; p.zmin = cz - m; p.zmax = cz + m;
  p.ymin = cy - hv - 0.5; p.ymax = cy + hv + 0.5;
  prims.push(p);
  return p;
}

function section(l: number, v: number, w: number, h: number, rt: number) {
  // Rounded floor corners, vaulted top.
  const rb = 0.3;
  const r = v > h * 0.5 ? rt : rb;
  const qx = l - (w * 0.5 - r), qy = Math.abs(v - h * 0.5) - (h * 0.5 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

function stairFloor(z: number) {
  const t = (STAIR_TOP - z) / STAIR_RUN;
  if (t <= 0) return 0;
  if (t >= STEPS) return DEPTH;
  const f = t - Math.floor(t);
  const e = f < 0.72 ? 0 : (f - 0.72) / 0.28;
  return -STAIR_RISE * (Math.floor(t) + e * e * (3 - 2 * e));
}
// The vault meets the ground exactly where the opening ends.
const stairCeil = (z: number) => 2.86 + (z - STAIR_TOP) * (STAIR_RISE / STAIR_RUN);

function evalPrim(p: Prim, x: number, y: number, z: number): number {
  switch (p.k) {
    case K.Tunnel: {
      const dx = p.bx - p.ax, dz = p.bz - p.az;
      const t = Math.min(1, Math.max(0, ((x - p.ax) * dx + (z - p.az) * dz) / (dx * dx + dz * dz)));
      const l = Math.hypot(x - p.ax - dx * t, z - p.az - dz * t);
      const w = p.wa + (p.wb - p.wa) * t, h = p.ha + (p.hb - p.ha) * t;
      return section(l, y - (p.fa + (p.fb - p.fa) * t), w, h, w * 0.47);
    }
    case K.Stair: {
      // ux = +1: the ossuary stair (descends towards -z, global profile).
      // ux = -1: a generic stair descending towards +z from az (top) to bz,
      // top tread fa, ceiling ha above the line of the nosings.
      if (p.ux > 0) {
        const zc = Math.min(p.az, Math.max(p.bz, z));
        const l = Math.hypot(x - p.ax, z - zc);
        const fl = stairFloor(zc), ce = stairCeil(zc);
        // Square-shouldered near the opening (so the walls meet the ground), vaulted below.
        const rt = ce > 0.2 ? 0.25 : 1.35;
        // Nothing is carved behind the top step: the opening ends there.
        return Math.max(section(l, y - fl, p.wa, ce - fl, rt), z - STAIR_TOP);
      }
      const zc = Math.max(p.az, Math.min(p.bz, z));
      const l = Math.abs(x - p.ax);
      const t = (zc - p.az) / p.hu, n = p.hv;
      const k = Math.min(n, Math.floor(t)), f = t - Math.floor(t);
      const e = k >= n ? 0 : f < 0.72 ? 0 : (f - 0.72) / 0.28;
      const fl = p.fa - p.hw * (Math.min(n, k + e * e * (3 - 2 * e)));
      const ce = p.fa + p.ha - p.hw * Math.min(n, t);
      const rt = ce > 0.2 ? 0.2 : 1.1;
      return Math.max(section(l, y - fl, p.wa, ce - fl, rt), p.az - z);
    }
    default: {
      const rx = x - p.cx, rz = z - p.cz;
      const u = rx * p.ux + rz * p.uz, w = -rx * p.uz + rz * p.ux;
      const vv = y - p.cy;
      if (p.k === K.Arch) {
        // Arched niche: rectangle below the springing, half-disc above, extruded along w.
        let d2: number;
        if (vv < 0) {
          const qx = Math.abs(u) - p.hu, qy = Math.abs(vv + p.hv * 0.5) - p.hv * 0.5;
          d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
        } else d2 = Math.hypot(u, vv) - p.hu;
        return Math.max(d2, Math.abs(w) - p.hw) - 0.02;
      }
      const qx = Math.abs(u) - p.hu + p.r, qy = Math.abs(vv) - p.hv + p.r, qz = Math.abs(w) - p.hw + p.r;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - p.r;
    }
  }
}

// ---- layout --------------------------------------------------------------
interface Gallery { pts: { x: number; z: number; f: number }[]; w: number[]; h: number[] }
const galleries: Gallery[] = [];

function layGallery(x0: number, z0: number, f0: number, x1: number, z1: number, f1: number, wid = R(1.15, 1.5), hgt = R(2.6, 3.1), meander = 1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.ceil(len / 2.2));
  const px = -(z1 - z0) / len, pz = (x1 - x0) / len;
  const amp = Math.min(2.2, len * 0.13) * meander;
  const seed = rand() * 100;
  const g: Gallery = { pts: [], w: [], h: [] };
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = amp * Math.sin(Math.PI * t) * (noise(seed, t * len * 0.18, 0.5) * 1.4);
    g.pts.push({ x: x0 + (x1 - x0) * t + px * off, z: z0 + (z1 - z0) * t + pz * off, f: f0 + (f1 - f0) * t + 0.12 * noise(seed + 9, t * len * 0.3, 1.5) * Math.sin(Math.PI * t) });
    g.w.push(wid * (1 + 0.14 * noise(seed + 3, t * len * 0.4, 2.5)));
    g.h.push(hgt * (1 + 0.06 * noise(seed + 5, t * len * 0.3, 3.5)));
  }
  for (let i = 0; i < n; i++) {
    const a = g.pts[i], c = g.pts[i + 1];
    tunnel(a.x, a.z, a.f, c.x, c.z, c.f, g.w[i], g.w[i + 1], g.h[i], g.h[i + 1]);
  }
  galleries.push(g);
  return g;
}

function distToGalleries(x: number, z: number, skip?: Gallery) {
  let best = 1e9;
  for (const g of galleries) {
    if (g === skip) continue;
    for (let i = 0; i < g.pts.length - 1; i++) {
      const a = g.pts[i], c = g.pts[i + 1];
      const dx = c.x - a.x, dz = c.z - a.z;
      const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
    }
  }
  return best;
}

// ---- small raw (undisplaced) objects: they must sit exactly on carved rock --
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
function raw(b: Builder, m: MatName, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  tmpE.set(rx, ry, rz, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(v(x, y, z), tmpQ, v(1, 1, 1));
  b.add(g, m, tmpM, false, true, true);
}
function lucernaRaw(b: Builder, x: number, y: number, z: number, ry: number, light = true) {
  const g = new THREE.SphereGeometry(0.055, 10, 6);
  g.scale(1, 0.38, 1);
  raw(b, 'clay', g, x, y + 0.02, z, ry);
  const nx = Math.sin(ry) * 0.07, nz = Math.cos(ry) * 0.07;
  raw(b, 'clay', new THREE.CylinderGeometry(0.017, 0.022, 0.06, 6), x + nx * 0.7, y + 0.022, z + nz * 0.7, ry, Math.PI / 2);
  const fp = v(x + nx, y + 0.035, z + nz);
  if (light) b.lamp('oil', fp, true); else b.flame('oil', fp);
}
function torchRaw(b: Builder, x: number, y: number, z: number, ry: number) {
  const ox = Math.sin(ry), oz = Math.cos(ry);
  raw(b, 'iron', new THREE.BoxGeometry(0.05, 0.05, 0.42), x + ox * 0.1, y - 0.32, z + oz * 0.1, ry);
  raw(b, 'iron', new THREE.TorusGeometry(0.07, 0.015, 5, 10), x + ox * 0.27, y - 0.3, z + oz * 0.27, ry, Math.PI / 2);
  raw(b, 'wood', new THREE.CylinderGeometry(0.03, 0.025, 0.6, 6), x + ox * 0.29, y - 0.2, z + oz * 0.29, ry, 0.25);
  raw(b, 'iron', new THREE.CylinderGeometry(0.06, 0.045, 0.16, 8), x + ox * 0.35, y + 0.06, z + oz * 0.35, ry, 0.25);
  b.lamp('torch', v(x + ox * 0.37, y + 0.13, z + oz * 0.37), true);
}
function candleRaw(b: Builder, x: number, y: number, z: number, h: number) {
  raw(b, 'bone', new THREE.CylinderGeometry(0.03, 0.036, h, 8), x, y + h / 2, z, 0, R(-0.06, 0.06), R(-0.06, 0.06));
  raw(b, 'bone', new THREE.CylinderGeometry(0.06, 0.08, 0.04, 8), x, y + 0.02, z);
  b.lamp('candle', v(x, y + h + 0.01, z), true);
}

// ---- grid sampling and surface nets --------------------------------------
function sampleField() {
  const nx = Math.ceil((DOM.x1 - DOM.x0) / CELL) + 1;
  const ny = Math.ceil((DOM.y1 - DOM.y0) / CELL) + 1;
  const nz = Math.ceil((DOM.z1 - DOM.z0) / CELL) + 1;
  // Stored as "rock" field: negative inside rock, positive in air.
  const val = new Float32Array(nx * ny * nz).fill(-1);
  // 2D hash of primitives.
  const HC = 2;
  const hx = Math.ceil((DOM.x1 - DOM.x0) / HC), hz = Math.ceil((DOM.z1 - DOM.z0) / HC);
  const buckets: number[][] = Array.from({ length: hx * hz }, () => []);
  prims.forEach((p, pi) => {
    const i0 = Math.max(0, Math.floor((p.xmin - DOM.x0) / HC)), i1 = Math.min(hx - 1, Math.floor((p.xmax - DOM.x0) / HC));
    const k0 = Math.max(0, Math.floor((p.zmin - DOM.z0) / HC)), k1 = Math.min(hz - 1, Math.floor((p.zmax - DOM.z0) / HC));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) buckets[k * hx + i].push(pi);
  });
  const list: Prim[] = [];
  for (let k = 0; k < nz; k++) {
    const z = DOM.z0 + k * CELL;
    for (let i = 0; i < nx; i++) {
      const x = DOM.x0 + i * CELL;
      const bk = buckets[Math.min(hz - 1, Math.floor((z - DOM.z0) / HC)) * hx + Math.min(hx - 1, Math.floor((x - DOM.x0) / HC))];
      list.length = 0;
      let ylo = 1e9, yhi = -1e9;
      for (const pi of bk) {
        const p = prims[pi];
        if (x < p.xmin || x > p.xmax || z < p.zmin || z > p.zmax) continue;
        list.push(p);
        ylo = Math.min(ylo, p.ymin); yhi = Math.max(yhi, p.ymax);
      }
      if (!list.length) continue;
      const j0 = Math.max(0, Math.floor((ylo - DOM.y0) / CELL)), j1 = Math.min(ny - 1, Math.ceil((yhi - DOM.y0) / CELL));
      for (let j = j0; j <= j1; j++) {
        const y = DOM.y0 + j * CELL;
        let air = 1.5, rubble = -1.5;
        for (const p of list) {
          if (y < p.ymin || y > p.ymax) continue;
          const d = evalPrim(p, x, y, z);
          if (p.k === K.Rubble) rubble = Math.max(rubble, -d);
          else air = smin(air, d, p.smooth);
        }
        // Collapsed rubble pushes rock back into the void.
        if (rubble > -1.4) air = smax(air, rubble, 0.25);
        if (air < 0.6) {
          // Tool marks and the softness of hand-cut tuff. Quieter near the opening.
          const q = y > -1.2 ? 0.3 : 1;
          air += q * (0.1 * noise(x * 0.8, y * 0.8, z * 0.8) + 0.045 * noise(x * 2.1 + 7, y * 2.1, z * 2.1) + 0.016 * noise(x * 5.3, y * 5.3 + 3, z * 5.3));
        }
        val[i + nx * (j + ny * k)] = -air;
      }
    }
  }
  return { val, nx, ny, nz };
}

/** Surface nets on the sampled grid. The solid is where val < 0 (rock); normals point into the air. */
function mesh(val: Float32Array, nx: number, ny: number, nz: number, cell = CELL) {
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const cid = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const vmap = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos: number[] = [], nor: number[] = [];
  const C: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) {
      cv[c] = val[id(i + C[c][0], j + C[c][1], k + C[c][2])];
      if (cv[c] < 0) inside++;
    }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += C[a][0] + (C[b][0] - C[a][0]) * t;
      sy += C[a][1] + (C[b][1] - C[a][1]) * t;
      sz += C[a][2] + (C[b][2] - C[a][2]) * t;
      n++;
    }
    vmap[cid(i, j, k)] = pos.length / 3;
    pos.push(DOM.x0 + (i + sx / n) * cell, DOM.y0 + (j + sy / n) * cell, DOM.z0 + (k + sz / n) * cell);
    // Gradient over the cell (rock -> air).
    const gx = (cv[1] - cv[0]) + (cv[3] - cv[2]) + (cv[5] - cv[4]) + (cv[7] - cv[6]);
    const gy = (cv[2] - cv[0]) + (cv[3] - cv[1]) + (cv[6] - cv[4]) + (cv[7] - cv[5]);
    const gz = (cv[4] - cv[0]) + (cv[5] - cv[1]) + (cv[6] - cv[2]) + (cv[7] - cv[3]);
    const gl = Math.hypot(gx, gy, gz) || 1;
    nor.push(gx / gl, gy / gl, gz / gl);
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[id(i, j, k)] < 0;
    if ((val[id(i + 1, j, k)] < 0) !== v0) quad(vmap[cid(i, j - 1, k - 1)], vmap[cid(i, j, k - 1)], vmap[cid(i, j, k)], vmap[cid(i, j - 1, k)]);
    if ((val[id(i, j + 1, k)] < 0) !== v0) quad(vmap[cid(i - 1, j, k - 1)], vmap[cid(i - 1, j, k)], vmap[cid(i, j, k)], vmap[cid(i, j, k - 1)]);
    if ((val[id(i, j, k + 1)] < 0) !== v0) quad(vmap[cid(i - 1, j - 1, k)], vmap[cid(i, j - 1, k)], vmap[cid(i, j, k)], vmap[cid(i - 1, j, k)]);
  }
  // Wind every triangle to face the air (agree with the field gradient).
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const s = fx * (nor[a] + nor[b] + nor[c]) + fy * (nor[a + 1] + nor[b + 1] + nor[c + 1]) + fz * (nor[a + 2] + nor[b + 2] + nor[c + 2]);
    if (s < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  // Smooth the cell-gradient normals with the mesh's own.
  const fn = g.clone();
  fn.computeVertexNormals();
  const a1 = g.attributes.normal.array as Float32Array, a2 = fn.attributes.normal.array as Float32Array;
  for (let i = 0; i < a1.length; i += 3) {
    let x = a1[i] + a2[i], y = a1[i + 1] + a2[i + 1], z = a1[i + 2] + a2[i + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    a1[i] = x; a1[i + 1] = y; a1[i + 2] = z;
  }
  return g;
}

// ---- the catacomb ---------------------------------------------------------
export function buildCatacombs(b: Builder): void {
  prims.length = 0;
  galleries.length = 0;

  // Stair: carved steps from the chapel floor down to the first gallery.
  const st = blank();
  Object.assign(st, { k: K.Stair, ax: STAIR_X, az: STAIR_TOP, bx: STAIR_X, bz: STAIR_END - 0.6, wa: STAIR_W + 0.18, smooth: 0.2 });
  st.xmin = STAIR_X - 2.6; st.xmax = STAIR_X + 2.6; st.zmin = st.bz - 2.6; st.zmax = st.az + 2.6;
  st.ymin = DEPTH - 0.8; st.ymax = 3.5;
  prims.push(st);
  // Smooth ramp for walking.
  const runLen = STAIR_TOP - STAIR_END;
  const ra = Math.atan2(-DEPTH, runLen);
  const ramp = new THREE.BoxGeometry(STAIR_W, 0.1, Math.hypot(runLen, DEPTH));
  ramp.rotateX(-ra);
  ramp.translate(STAIR_X, DEPTH / 2 - 0.05, (STAIR_TOP + STAIR_END) / 2);
  b.collide(ramp.toNonIndexed());
  // Rock collar just under the ground around the opening hides the seam.
  const hx0 = STAIR_X - STAIR_W / 2, hx1 = STAIR_X + STAIR_W / 2;
  raw(b, 'rock', new THREE.BoxGeometry(0.2, 0.6, STAIR_TOP - HOLE_END + 0.4), hx0 - 0.1, -0.28, (STAIR_TOP + HOLE_END) / 2);
  raw(b, 'rock', new THREE.BoxGeometry(0.2, 0.6, STAIR_TOP - HOLE_END + 0.4), hx1 + 0.1, -0.28, (STAIR_TOP + HOLE_END) / 2);
  raw(b, 'rock', new THREE.BoxGeometry(STAIR_W + 0.4, 0.6, 0.2), STAIR_X, -0.28, STAIR_TOP + 0.1);

  // Nodes: the stair foot, the crypt, and loose points in between.
  const S = { x: STAIR_X, z: STAIR_END - 1.6, f: DEPTH };
  const Cr = { x: -23.5, z: -95.5, f: DEPTH - 0.35 };
  const nodes = [S, Cr];
  for (let t = 0; t < 600 && nodes.length < 15; t++) {
    const x = R(-58, -16), z = R(-97, -66);
    if (nodes.every((n) => Math.hypot(n.x - x, n.z - z) > 8.5)) nodes.push({ x, z, f: DEPTH + R(-0.35, 0.3) });
  }
  // Minimum spanning tree, plus a few loops.
  const inTree = [0];
  const edges: [number, number][] = [];
  while (inTree.length < nodes.length) {
    let best: [number, number] = [-1, -1], bd = 1e9;
    for (const a of inTree) nodes.forEach((n, j) => {
      if (inTree.includes(j)) return;
      const d = Math.hypot(n.x - nodes[a].x, n.z - nodes[a].z);
      if (d < bd) { bd = d; best = [a, j]; }
    });
    edges.push(best);
    inTree.push(best[1]);
  }
  const extra: { a: number; c: number; d: number }[] = [];
  nodes.forEach((n, a) => nodes.forEach((m, c) => {
    if (c <= a || edges.some(([p, q]) => (p === a && q === c) || (p === c && q === a))) return;
    const d = Math.hypot(n.x - m.x, n.z - m.z);
    if (d > 9 && d < 17) extra.push({ a, c, d });
  }));
  extra.sort((p, q) => p.d - q.d);
  let loops = 0;
  for (const e of extra) {
    if (loops >= 5) break;
    edges.push([e.a, e.c]);
    loops++;
  }
  for (const [a, c] of edges) {
    const n = nodes[a], m = nodes[c];
    layGallery(n.x, n.z, n.f, m.x, m.z, m.f);
  }

  // The martyr's stair from the cella memoriae, and a gallery from its foot to the crypt.
  {
    const C = CELLA_STAIR;
    // Its top tread sits on the (displaced) ground at the head of the stair.
    const gv = v(0, 0, 0);
    field(C.x, 0, C.top, 'ground', gv);
    C.topF = gv.y;
    const n = Math.round((C.topF - C.bottomF) / C.rise);
    const bot = C.top + n * C.run;
    const sp = blank();
    Object.assign(sp, { k: K.Stair, ux: -1, ax: C.x, az: C.top, bz: bot + 0.8, wa: C.w + 0.12, fa: C.topF, ha: 2.3, hu: C.run, hv: n, hw: C.rise, smooth: 0.2 });
    sp.xmin = C.x - 2.4; sp.xmax = C.x + 2.4; sp.zmin = C.top - 2.4; sp.zmax = bot + 3.2;
    sp.ymin = C.bottomF - 0.8; sp.ymax = C.topF + 3;
    prims.push(sp);
    // Smooth ramp for walking, on the line of the nosings.
    const run = bot - C.top, drop = C.topF - C.bottomF;
    const ramp = new THREE.BoxGeometry(C.w, 0.1, Math.hypot(run, drop));
    ramp.rotateX(Math.atan2(drop, run));
    ramp.translate(C.x, (C.topF + C.bottomF) / 2 - 0.05, (C.top + bot) / 2);
    b.collide(ramp.toNonIndexed());
    // The steps above y = 0 (the rock field stops there) are laid stone.
    for (let i = 0; i < n; i++) {
      const top = C.topF - i * C.rise;
      if (top <= 0.04) break;
      const h = top + 0.45;
      raw(b, 'block', new THREE.BoxGeometry(C.w + 0.3, h, C.run + 0.04), C.x + R(-0.02, 0.02), top - h / 2, C.top + (i + 0.5) * C.run, R(-0.02, 0.02));
    }
    // Lining walls round the opening: they close the gap between the rock
    // (which stops at y = 0) and the ground, and rise above it as a parapet.
    const H = C.topF, pH = H + 0.85, hx = C.hole;
    const wallBox = (w: number, h: number, d: number, x: number, y0: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      raw(b, 'block', g.clone(), x, y0 + h / 2, z, R(-0.01, 0.01));
      b.collide(g.translate(x, y0 + h / 2, z).toNonIndexed());
    };
    const inner = C.w / 2 + 0.03;
    for (const s of [-1, 1]) {
      const x = s < 0 ? Math.min(C.x - inner - 0.2, hx.x0 + 0.05) : Math.max(C.x + inner + 0.2, hx.x1 - 0.05);
      wallBox(0.45, pH + 0.6, hx.z1 - hx.z0 + 0.45, x, -0.6, (hx.z0 + hx.z1) / 2 + 0.2);
    }
    // The far end wall spans the stair as a lintel: it starts above head height
    // and reaches back far enough for the rock vault to take over below it.
    wallBox(hx.x1 - hx.x0 + 0.5, pH - 0.1, 0.7, (hx.x0 + hx.x1) / 2, 0.1, hx.z1 + 0.26);
    // Riser behind the top step: closes the gap under the ground at the head of the stair.
    raw(b, 'block', new THREE.BoxGeometry(hx.x1 - hx.x0 + 0.5, H + 0.6, 0.3), C.x, (H - 0.6) / 2 - 0.02, C.top - 0.15);
    // A lucerna on the parapet, and the iron grille that closed the stair, leant open.
    lucernaRaw(b, hx.x1 + 0.05, pH + 0.02, hx.z1 - 0.6, Math.PI / 2, true);
    for (let i = 0; i < 6; i++) raw(b, 'iron', new THREE.BoxGeometry(0.03, 1.5, 0.03), hx.x0 - 0.5 + i * 0.27, H + 0.72, C.top - 0.55, 0, -0.32, 0);
    for (const yy of [0.25, 0.75, 1.25]) raw(b, 'iron', new THREE.BoxGeometry(1.45, 0.035, 0.03), hx.x0 + 0.17, H + yy * 0.95 + 0.03, C.top - 0.62 + yy * 0.3, 0, -0.32, 0);
    // From the foot of the stair, a gallery into the crypt's north side.
    layGallery(C.x, bot + 0.6, C.bottomF, Cr.x - 0.85, Cr.z + 2.35, Cr.f, 1.35, 2.7, 0.5);
    CATACOMB_SPOTS.cellaTop.set(C.x, C.topF + 1.65, C.top - 0.7);
  }

  // Crypt: a wide low chamber with two rock pillars left standing.
  box(K.Box, Cr.x, Cr.f + 1.55, Cr.z, 0.94, 0.34, 4.2, 1.9, 3.2, 1.5, 0.5);
  const pillars = [[-1.6, 0.6], [1.9, -0.9]];
  for (const [u, w] of pillars) {
    const px = Cr.x + u * 0.94 - w * 0.34, pz = Cr.z + u * 0.34 + w * 0.94;
    box(K.Rubble, px, Cr.f + 1.6, pz, 1, 0, 0.32, 2.2, 0.38, 0.25);
  }

  // Dead-end spurs, one of them choked with a collapse.
  const spurs: Gallery[] = [];
  for (let t = 0; t < 80 && spurs.length < 8; t++) {
    const g = galleries[Math.floor(rand() * galleries.length)];
    if (g.pts.length < 4) continue;
    const i = 1 + Math.floor(rand() * (g.pts.length - 2));
    const a = g.pts[i], c = g.pts[i + 1] ?? g.pts[i - 1];
    const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz);
    const side = rand() < 0.5 ? 1 : -1;
    const len = R(4.5, 9);
    const ang = Math.atan2(dz, dx) + side * R(1.0, 1.9);
    const ex = a.x + Math.cos(ang) * len, ez = a.z + Math.sin(ang) * len;
    if (ex < -60 || ex > -14 || ez < -100 || ez > -62 || distToGalleries(ex, ez) < 3.5 || l === 0) continue;
    spurs.push(layGallery(a.x, a.z, a.f, ex, ez, a.f + R(-0.2, 0.15), R(1.0, 1.3), R(2.3, 2.7), 0.6));
  }
  if (spurs[0]) {
    const e = spurs[0].pts[spurs[0].pts.length - 1];
    box(K.Rubble, e.x, e.f + 0.4, e.z, 1, 0, 1.6, 1.4, 1.6, 0.9);
  }
  // A partial collapse in a through-gallery: you have to stoop past the scree.
  {
    const g = galleries[Math.min(galleries.length - 1, 3)];
    const a = g.pts[Math.floor(g.pts.length / 2)];
    box(K.Rubble, a.x + 0.2, a.f - 0.1, a.z, 1, 0, 1.1, 0.75, 1.0, 0.7);
    for (let i = 0; i < 4; i++) b.prop((['femur', 'tibia', 'humerus'] as const)[i % 3], a.x + R(-0.8, 0.8), a.f + R(0.02, 0.2), a.z + R(-0.8, 0.8), R(0, 6), R(-0.3, 0.3), R(-0.3, 0.3));
    b.prop('skull', a.x + 0.7, a.f + 0.05, a.z - 0.5, R(0, 6), 0.4, 0.3);
  }

  // Cubicula with arcosolia.
  const rooms: { x: number; z: number; f: number; ux: number; uz: number; door: { x: number; z: number } }[] = [];
  const mainGs = galleries.slice(0, edges.length);
  for (let t = 0; t < 80 && rooms.length < 4; t++) {
    const g = mainGs[Math.floor(rand() * mainGs.length)];
    if (g.pts.length < 5) continue;
    const i = 2 + Math.floor(rand() * (g.pts.length - 4));
    const a = g.pts[i], c = g.pts[i + 1];
    const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz);
    const side = rand() < 0.5 ? 1 : -1;
    const px = (-dz / l) * side, pz = (dx / l) * side;
    const dist = 4.3;
    const rx = a.x + px * dist, rz = a.z + pz * dist;
    if (rx < -60 || rx > -14 || rz < -100 || rz > -63) continue;
    if (distToGalleries(rx, rz) < 3.6) continue;
    if (rooms.some((r) => Math.hypot(r.x - rx, r.z - rz) < 7)) continue;
    rooms.push({ x: rx, z: rz, f: a.f, ux: px, uz: pz, door: { x: a.x, z: a.z } });
  }
  for (const r of rooms) {
    const ang = R(-0.25, 0.25);
    const ux = r.ux * Math.cos(ang) - r.uz * Math.sin(ang), uz = r.ux * Math.sin(ang) + r.uz * Math.cos(ang);
    const hs = R(1.55, 1.95), hd = R(1.5, 1.9);
    // Door passage, low and narrow.
    tunnel(r.door.x, r.door.z, r.f, r.x - ux * (hd - 0.3), r.z - uz * (hd - 0.3), r.f + 0.05, 0.95, 0.9, 2.15, 2.1, 0.18);
    box(K.Box, r.x, r.f + 1.35, r.z, -uz, ux, hs, 1.45, hd, 0.9, 0.35);
    // Arcosolia on the back and side walls: an arched recess over a rock chest.
    const walls = [
      { nx: ux, nz: uz, half: hs, off: hd },
      { nx: -uz, nz: ux, half: hd, off: hs },
      { nx: uz, nz: -ux, half: hd, off: hs },
    ];
    for (const w of walls) {
      if (rand() < 0.2) continue;
      const cx = r.x + w.nx * (w.off + 0.25), cz = r.z + w.nz * (w.off + 0.25);
      const halfW = Math.min(w.half - 0.35, R(0.85, 1.05));
      // `u` axis runs along the wall (perpendicular to its normal).
      box(K.Arch, cx, r.f + 1.25, cz, -w.nz, w.nx, halfW, 0.42, 0.42, 0, 0.06);
      // Bones laid out on the tomb chest, face up to the arch.
      const sx = cx - w.nx * 0.1, sz = cz - w.nz * 0.1;
      const ry = Math.atan2(-w.nx, -w.nz);
      if (rand() < 0.75) b.prop('skull', sx + w.nz * (halfW - 0.3), r.f + 0.86, sz - w.nx * (halfW - 0.3), ry + R(-0.6, 0.6), R(-0.2, 0.2), R(-0.3, 0.3));
      b.prop('femur', sx, r.f + 0.84, sz, Math.atan2(w.nx, -w.nz) + R(-0.3, 0.3));
      if (rand() < 0.6) b.prop('tibia', sx - w.nz * 0.3, r.f + 0.86, sz + w.nx * 0.3, Math.atan2(w.nx, -w.nz) + R(-0.4, 0.4));
      if (rand() < 0.5) lucernaRaw(b, sx - w.nz * (halfW - 0.35), r.f + 0.84, sz + w.nx * (halfW - 0.35), ry, rand() < 0.5);
    }
  }

  // Walk every gallery: lamp niches, then columns of loculi on both walls.
  let lampCount = 0, torchCount = 0;
  for (const g of galleries) {
    const isSpur = spurs.includes(g);
    let walked = 0;
    let nextLamp = R(3, 8);
    // Cumulative length along the polyline, to place loculi continuously.
    const cum = [0];
    for (let i = 0; i < g.pts.length - 1; i++) cum.push(cum[i] + Math.hypot(g.pts[i + 1].x - g.pts[i].x, g.pts[i + 1].z - g.pts[i].z));
    const total = cum[cum.length - 1];
    const at = (sv: number) => {
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < sv) i++;
      const a = g.pts[i], c = g.pts[i + 1];
      const l = cum[i + 1] - cum[i], t = l > 0 ? (sv - cum[i]) / l : 0;
      return { x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, f: a.f + (c.f - a.f) * t, w: g.w[i] + (g.w[i + 1] - g.w[i]) * t, tx: (c.x - a.x) / l, tz: (c.z - a.z) / l };
    };
    for (const side of [-1, 1]) {
      let sv = R(0.3, 1.0);
      while (sv < total - 1.0) {
        const len = R(1.5, 1.9);
        if (sv + len > total - 0.4) break;
        const m = at(sv + len / 2);
        const { tx, tz } = m, mx = m.x, mz = m.z, mf = m.f, w = m.w;
        {
          const nx = -tz * side, nz = tx * side;
          // Not into a junction, a room door, the stair foot or the crypt.
          const backX = mx + nx * (w / 2 + 0.55), backZ = mz + nz * (w / 2 + 0.55);
          const clear = distToGalleries(backX, backZ, g) > 1.05 && rooms.every((r) => Math.hypot(r.door.x - mx, r.door.z - mz) > 2.0)
            && Math.hypot(mx - S.x, mz - S.z) > 2.2 && Math.hypot(mx - Cr.x, mz - Cr.z) > 5;
          if (clear && rand() < 0.92) {
            const tiers = isSpur ? 2 + Math.floor(rand() * 2) : 3 + Math.floor(rand() * 2);
            for (let k = 0; k < tiers; k++) {
              const hh = R(0.2, 0.25);
              const bottom = mf + 0.3 + k * R(0.56, 0.64) + R(-0.04, 0.04);
              if (bottom + hh * 2 > mf + 2.3) break;
              const ll = len * R(0.88, 0.98) / 2;
              const dep = 0.3;
              const cx = mx + nx * (w / 2 + dep - 0.12), cz = mz + nz * (w / 2 + dep - 0.12);
              box(K.Box, cx, bottom + hh, cz, tx, tz, ll, hh, dep, 0.08, 0.05);
              const fate = rand();
              const ry = Math.atan2(-nx, -nz);
              const along = Math.atan2(-tz, tx);
              const fx = mx + nx * (w / 2 - 0.02), fz = mz + nz * (w / 2 - 0.02);
              if (fate < 0.2) {
                // Sealed with a marble slab or roof tiles.
                raw(b, rand() < 0.5 ? 'marble' : 'brick', new THREE.BoxGeometry(ll * 2 + 0.06, hh * 2 + 0.06, 0.05), fx + nx * 0.04, bottom + hh, fz + nz * 0.04, along);
              } else if (fate < 0.32) {
                // Broken seal: a shard still in place.
                const sh = R(0.35, 0.6);
                raw(b, 'marble', new THREE.BoxGeometry(ll * 2 * sh, hh * 2 + 0.04, 0.05), fx + nx * 0.04 + tx * ll * (1 - sh), bottom + hh, fz + nz * 0.04 + tz * ll * (1 - sh), along, 0, R(-0.08, 0.08));
                b.prop('skull', cx - tx * ll * 0.55, bottom, cz - tz * ll * 0.55, ry + R(-0.5, 0.5), 0, R(-0.4, 0.4));
              } else if (fate < 0.85) {
                // Opened by time and robbers: bones lie as they were left.
                const bx = cx - nx * 0.05, bz = cz - nz * 0.05;
                const e = rand() < 0.5 ? 1 : -1;
                if (rand() < 0.8) b.prop('skull', bx + tx * (ll - 0.18) * e, bottom, bz + tz * (ll - 0.18) * e, ry + R(-0.9, 0.9), R(-0.2, 0.15), R(-0.5, 0.5), R(0.9, 1.05));
                const nb = 1 + Math.floor(rand() * 3);
                for (let q = 0; q < nb; q++) {
                  b.prop((['femur', 'tibia', 'humerus'] as const)[Math.floor(rand() * 3)], bx + tx * R(-0.3, 0.3) + nx * R(-0.08, 0.08), bottom + q * 0.025, bz + tz * R(-0.3, 0.3) + nz * R(-0.08, 0.08), along + R(-0.35, 0.35));
                }
              }
            }
          }
        }
        sv += len + R(0.28, 0.5);
      }
    }
    for (let i = 0; i < g.pts.length - 1; i++) {
      const a = g.pts[i], c = g.pts[i + 1];
      const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz);
      const tx = dx / l, tz = dz / l;
      // Lamp niches every 8–12 m, alternating walls.
      walked += l;
      while (walked > nextLamp) {
        const t = Math.min(1, Math.max(0, 1 - (walked - nextLamp) / l));
        const mx = a.x + dx * t, mz = a.z + dz * t, mf = a.f + (c.f - a.f) * t;
        const w = g.w[i];
        const side = lampCount % 2 ? 1 : -1;
        const nx = -tz * side, nz = tx * side;
        const y = mf + 1.42;
        const cx = mx + nx * (w / 2 + 0.12), cz = mz + nz * (w / 2 + 0.12);
        box(K.Box, cx, y + 0.15, cz, tx, tz, 0.17, 0.16, 0.2, 0.07, 0.04);
        if ((lampCount + 3) % 5 === 0 && torchCount < 6) {
          torchRaw(b, mx + nx * (w / 2 + 0.02), y + 0.4, mz + nz * (w / 2 + 0.02), Math.atan2(-nx, -nz));
          torchCount++;
        } else {
          lucernaRaw(b, cx - nx * 0.03, y - 0.01, cz - nz * 0.03, Math.atan2(-nx, -nz), rand() < 0.85);
        }
        lampCount++;
        nextLamp += R(8, 12);
      }
    }
  }

  // Crypt furnishings: a ring of candles round a carved bench tomb, and an open codex.
  box(K.Rubble, Cr.x - 1.2, Cr.f + 0.25, Cr.z + 0.3, 0.94, 0.34, 1.1, 0.5, 0.55, 0.12);
  b.prop('skull', Cr.x - 1.6, Cr.f + 0.78, Cr.z + 0.15, 1.2, -0.3, 0.2);
  b.prop('femur', Cr.x - 0.8, Cr.f + 0.77, Cr.z + 0.45, 0.4);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + R(-0.15, 0.15);
    const rr = R(2.0, 2.5);
    candleRaw(b, Cr.x - 1.2 + Math.cos(a) * rr, Cr.f + 0.0, Cr.z + 0.3 + Math.sin(a) * rr * 0.7, R(0.25, 0.6));
  }
  const lx = Cr.x + 2.2, lz = Cr.z + 1.2;
  raw(b, 'wood', new THREE.BoxGeometry(0.22, 1.05, 0.22), lx, Cr.f + 0.52, lz, 0.3);
  raw(b, 'wood', new THREE.BoxGeometry(0.7, 0.05, 0.5), lx, Cr.f + 1.1, lz, 0.3, 0, 0.32);
  raw(b, 'bone', new THREE.BoxGeometry(0.3, 0.035, 0.42), lx - 0.15, Cr.f + 1.15, lz + 0.05, 0.3, 0, 0.28);
  raw(b, 'bone', new THREE.BoxGeometry(0.3, 0.035, 0.42), lx + 0.15, Cr.f + 1.15, lz - 0.05, 0.3, 0, 0.36);
  b.lamps.push({ pos: v(lx, Cr.f + 1.55, lz), color: new THREE.Color(0.35, 0.6, 1.0), intensity: 0.3, under: true, seed: 3 });
  torchRaw(b, Cr.x - 3.9 * 0.94, Cr.f + 2.1, Cr.z - 3.9 * 0.34, Math.atan2(0.94, 0.34));

  // A spot inside a long gallery, looking along it.
  const lg = galleries.slice(0, edges.length).reduce((m, g) => (g.pts.length > m.pts.length ? g : m));
  const mi = Math.floor(lg.pts.length / 2);
  const p0 = lg.pts[mi], p1 = lg.pts[mi + 1];
  CATACOMB_SPOTS.gallery.set(p0.x, p0.f + 1.65, p0.z);
  CATACOMB_SPOTS.galleryYaw = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));

  // Carve and mesh.
  const { val, nx, ny, nz } = sampleField();
  const geo = mesh(val, nx, ny, nz);
  b.add(geo, 'rock', undefined, false, true, true);
  // Collision proxy: the same field 3x coarser, max-pooled so no passage closes.
  const f = 3;
  const cx = Math.floor((nx - 1) / f) + 1, cy = Math.floor((ny - 1) / f) + 1, cz = Math.floor((nz - 1) / f) + 1;
  const cv = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let m = -Infinity;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = Math.min(nx - 1, Math.max(0, i * f + di)), jj = Math.min(ny - 1, Math.max(0, j * f + dj)), kk = Math.min(nz - 1, Math.max(0, k * f + dk));
      m = Math.max(m, val[ii + nx * (jj + ny * kk)]);
    }
    cv[i + cx * (j + cy * k)] = m;
  }
  b.collide(mesh(cv, cx, cy, cz, CELL * f).toNonIndexed());
}

/** Handy test positions (eye height). */
export const CATACOMB_SPOTS = {
  stairBottom: v(STAIR_X, DEPTH + 1.65, STAIR_END - 0.8),
  crypt: v(-23.5 + 3.2, DEPTH - 0.35 + 1.65, -95.5 + 2.4),
  gallery: v(0, 0, 0),
  galleryYaw: 0,
  /** Eye position just behind the head of the martyr's stair, in the cella. */
  cellaTop: v(0, 0, 0),
};
