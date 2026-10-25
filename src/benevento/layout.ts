import * as THREE from 'three';
import { rng } from '../builder';
import { GEO_STREETS, GEO_PARCELS, GEO_STREET_AREAS, DECUMANUS, WALL700, BOUNDS, insideness, inPoly, distPolyline, type P2 } from './geo';
import { SITES, GATES, ROADS, EXPLORE_TARGETS, siteToWorld, type ExploreKind } from './sites';
import { fastTerrain } from '../displace';
import type { Lot, BridgeSpec } from '../town';

// The town of AD 700 laid out on the user's plan: its blocks exactly as drawn
// (houses stand only inside them, fronts on the block edge) and its street
// spaces left open, with the lanes' centre lines for walkers; blocks are filled with houses where the
// early-medieval town was dense, and with vegetable plots, ruins, meadows and
// pens where it was not: the countryside had come inside the walls.

export const FREE = 0, STREET = 1, RESERVED = 2, HOUSE = 3, OUTSIDE = 4, PLOT = 5;
type V2 = THREE.Vector2;
const V = (x: number, z: number) => new THREE.Vector2(x, z);

/** 0.5 m occupancy raster over the walled town. */
export class Raster {
  readonly res = 0.5;
  readonly x0: number; readonly z0: number; readonly nx: number; readonly nz: number;
  grid: Uint8Array; parcel: Uint16Array; main: Uint8Array;
  /** Street cells worn bare by feet and carts (near the house fronts and along the lanes); the rest of a wide street space is grass. */
  trod: Uint8Array;
  constructor(x0: number, z0: number, x1: number, z1: number) {
    this.x0 = x0; this.z0 = z0;
    this.nx = Math.ceil((x1 - x0) / this.res); this.nz = Math.ceil((z1 - z0) / this.res);
    this.grid = new Uint8Array(this.nx * this.nz).fill(OUTSIDE);
    this.parcel = new Uint16Array(this.nx * this.nz);
    this.main = new Uint8Array(this.nx * this.nz);
    this.trod = new Uint8Array(this.nx * this.nz);
  }
  idx(x: number, z: number) {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((z - this.z0) / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  at(x: number, z: number) { const k = this.idx(x, z); return k < 0 ? OUTSIDE : this.grid[k]; }
  set(x: number, z: number, v: number) { const k = this.idx(x, z); if (k >= 0) this.grid[k] = v; }
  pid(x: number, z: number) { const k = this.idx(x, z); return k < 0 ? 0 : this.parcel[k]; }
  /** Scan-fill a polygon; cb gets each cell index inside. */
  fill(pts: P2[], cb: (k: number) => void) {
    let zMin = Infinity, zMax = -Infinity;
    for (const p of pts) { zMin = Math.min(zMin, p[1]); zMax = Math.max(zMax, p[1]); }
    const j0 = Math.max(0, Math.floor((zMin - this.z0) / this.res)), j1 = Math.min(this.nz - 1, Math.ceil((zMax - this.z0) / this.res));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.res;
      xs.length = 0;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        const p = pts[a], q = pts[b];
        if ((p[1] > z) !== (q[1] > z)) xs.push(p[0] + ((z - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      xs.sort((u, v) => u - v);
      for (let t = 0; t + 1 < xs.length; t += 2) {
        const i0 = Math.max(0, Math.ceil((xs[t] - this.x0) / this.res - 0.5)), i1 = Math.min(this.nx - 1, Math.floor((xs[t + 1] - this.x0) / this.res - 0.5));
        for (let i = i0; i <= i1; i++) cb(j * this.nx + i);
      }
    }
  }
}

export interface Street { pts: V2[]; w: number; main: boolean; kind: 'lane' | 'road' }
export type PlotKind = 'orto' | 'vinea' | 'pratum' | 'ruina' | 'stabulum';
export interface Plot { pts: P2[]; kind: PlotKind; seed: number; cx: number; cz: number }
export interface TownLot extends Lot { id: number; explore?: { id: string; kind: ExploreKind }; parcel: number }
export interface Well { x: number; z: number }
export interface Layout {
  r: Raster;
  streets: Street[];
  lots: TownLot[];
  bridges: BridgeSpec[];
  plots: Plot[];
  wells: Well[];
  squares: { x: number; z: number; r: number }[];
}

// ---------------------------------------------------------------- density of settlement
// High along the decumanus, round the dukes' curtis and the bishop's church,
// inside Porta Aurea; low on the steep slopes to the Calore and in patches
// where the ruins of Roman houses had become gardens.
const DS = 8;
let DEN: Float32Array | null = null, DNX = 0, DNZ = 0, DX0 = 0, DZ0 = 0;
function hashNoise(x: number, z: number) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function smoothNoise(x: number, z: number, cell: number) {
  const fx = x / cell, fz = z / cell, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = hashNoise(i, j), b = hashNoise(i + 1, j), c = hashNoise(i, j + 1), d = hashNoise(i + 1, j + 1);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
}
export function density(x: number, z: number) {
  if (!DEN) buildDensity();
  const i = Math.floor((x - DX0) / DS), j = Math.floor((z - DZ0) / DS);
  if (i < 0 || j < 0 || i >= DNX || j >= DNZ) return 0;
  return DEN![j * DNX + i];
}
function buildDensity() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of WALL700) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  DX0 = x0 - 16; DZ0 = z0 - 16; DNX = Math.ceil((x1 - x0 + 32) / DS); DNZ = Math.ceil((z1 - z0 + 32) / DS);
  DEN = new Float32Array(DNX * DNZ);
  const mains = [DECUMANUS];
  const focus: [number, number, number, number][] = [
    [SITES.curtis.x, SITES.curtis.z, 0.5, 140], [SITES.episcopium.x, SITES.episcopium.z, 0.45, 130],
    [389, -224, 0.3, 90], [SITES.forum.x, SITES.forum.z, 0.25, 90],
  ];
  for (let j = 0; j < DNZ; j++) for (let i = 0; i < DNX; i++) {
    const x = DX0 + (i + 0.5) * DS, z = DZ0 + (j + 0.5) * DS;
    let dDec = Infinity;
    for (const m of mains) dDec = Math.min(dDec, distPolyline(x, z, m));
    let d = 0.16 + 0.5 * Math.exp(-((dDec / 70) ** 2));
    for (const [fx, fz, a, r] of focus) d += a * Math.exp(-(((x - fx) ** 2 + (z - fz) ** 2) / (r * r)));
    d += 0.42 * (smoothNoise(x + 900, z + 900, 55) - 0.5);
    // Steep ground (the bluffs over the Calore): gardens and scrub.
    const sl = Math.hypot(fastTerrain(x + 4, z) - fastTerrain(x - 4, z), fastTerrain(x, z + 4) - fastTerrain(x, z - 4)) / 8;
    d -= Math.max(0, sl - 0.08) * 2.2;
    DEN[j * DNX + i] = Math.max(0, Math.min(1, d));
  }
}

// ---------------------------------------------------------------- helpers
function distSeg(p: V2, a: V2, b: V2) {
  const abx = b.x - a.x, abz = b.y - a.y;
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + abz * t));
}
function along(pts: V2[], s: number): { p: V2; d: V2 } | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = pts[i].distanceTo(pts[i + 1]);
    if (s <= seg) {
      const d = pts[i + 1].clone().sub(pts[i]).normalize();
      return { p: pts[i].clone().addScaledVector(d, s), d };
    }
    s -= seg;
  }
  return null;
}
export const lengthOf = (pts: V2[]) => pts.reduce((a, p, i) => (i ? a + p.distanceTo(pts[i - 1]) : 0), 0);

// ---------------------------------------------------------------- the layout
export function layoutTown(seed = 700): Layout {
  const rand = rng(seed);
  const R = (a: number, b: number) => a + (b - a) * rand();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of WALL700) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const r = new Raster(Math.floor(x0 - 8), Math.floor(z0 - 8), Math.ceil(x1 + 8), Math.ceil(z1 + 8));
  const lay: Layout = { r, streets: [], lots: [], bridges: [], plots: [], wells: [], squares: [] };

  // 1. Inside the walls is free land, less a band along the curtain.
  for (let j = 0; j < r.nz; j++) for (let i = 0; i < r.nx; i++) {
    const x = r.x0 + (i + 0.5) * r.res, z = r.z0 + (j + 0.5) * r.res;
    const ins = insideness(x, z);
    if (ins > 0.5) r.grid[j * r.nx + i] = ins < 0.5 + 3.4 / 16 ? RESERVED : FREE;
  }
  // 2. The plan's blocks: each a parcel id.
  const parcels = GEO_PARCELS.filter((p) => p.in);
  parcels.forEach((p, n) => r.fill(p.pts, (k) => { if (r.grid[k] === FREE) r.parcel[k] = n + 1; }));
  // The plan's street spaces; the ink between them and the blocks is shared out
  // (half to each), and a line between two blocks is their party wall.
  {
    const SA = 0xffff;
    for (const a of GEO_STREET_AREAS) if (!a.hole) r.fill(a.pts, (k) => { if (!r.parcel[k]) r.parcel[k] = SA; });
    for (const a of GEO_STREET_AREAS) if (a.hole) r.fill(a.pts, (k) => { if (r.parcel[k] === SA) r.parcel[k] = 0; });
    const nx = r.nx, nb = [1, -1, nx, -nx];
    let front: number[] = [];
    for (let k = 0; k < r.grid.length; k++) if (r.grid[k] !== OUTSIDE && r.parcel[k]) front.push(k);
    for (let pass = 0; pass < 6 && front.length; pass++) {
      const next: number[] = [], set: [number, number][] = [];
      for (const k of front) for (const o of nb) {
        const q = k + o;
        if (q < 0 || q >= r.grid.length || r.grid[q] === OUTSIDE || r.parcel[q]) continue;
        set.push([q, r.parcel[k]]);
      }
      for (const [q, v] of set) if (!r.parcel[q]) { r.parcel[q] = v; next.push(q); }
      front = next;
    }
    // Whatever is not a block is street space.
    for (let k = 0; k < r.grid.length; k++) {
      if (r.parcel[k] === SA) { r.parcel[k] = 0; if (r.grid[k] === FREE) r.grid[k] = STREET; }
      else if (!r.parcel[k] && r.grid[k] === FREE) r.grid[k] = STREET;
    }
  }
  // 3. Landmark precincts are kept clear (their modules build them); the forum is an open square.
  for (const s of Object.values(SITES)) {
    if (!s.clear && !s.reserve) continue;
    const square = s.id === 'forum';
    const poly: P2[] = s.reserve ? s.reserve.map(([lx, lz]) => siteToWorld(s, lx, lz))
      : Array.from({ length: 20 }, (_, i) => [s.x + Math.cos((i / 20) * Math.PI * 2) * s.clear!, s.z + Math.sin((i / 20) * Math.PI * 2) * s.clear!] as P2);
    r.fill(poly, (k) => { if (r.grid[k] !== OUTSIDE) r.grid[k] = square ? STREET : RESERVED; });
    if (square) lay.squares.push({ x: s.x, z: s.z, r: s.clear! });
  }

  // 4. Lanes of the plan, narrowed: houses crept forward into the old street
  //    spaces; only the decumanus and the open places keep their breadth.
  const paint = (s: Street, cut = false) => {
    for (let k = 0; k < s.pts.length - 1; k++) {
      const a = s.pts[k], b = s.pts[k + 1];
      const rad = s.w / 2 + 0.6;
      for (let z = Math.min(a.y, b.y) - rad; z <= Math.max(a.y, b.y) + rad; z += r.res) {
        for (let x = Math.min(a.x, b.x) - rad; x <= Math.max(a.x, b.x) + rad; x += r.res) {
          const kk = r.idx(x, z);
          if (kk < 0) continue;
          const d = distSeg(V(x, z), a, b);
          const wob = 0.22 * Math.sin(x * 1.7 + z * 0.9) * Math.cos(z * 1.3 - x * 0.4);
          if (d < s.w / 2 + wob && r.grid[kk] !== OUTSIDE && (r.grid[kk] !== RESERVED || s.main) && (cut || !r.parcel[kk])) {
            if (cut) r.parcel[kk] = 0;
            r.grid[kk] = STREET;
            if (s.main) r.main[kk] = Math.max(r.main[kk], Math.round(255 * (1 - d / (s.w / 2 + 0.01))));
          }
        }
      }
    }
  };
  {
    const s: Street = { pts: DECUMANUS.map(([x, z]) => V(x, z)), w: 3.3, main: true, kind: 'lane' };
    lay.streets.push(s);
    paint(s, true);
  }
  for (const g of GEO_STREETS) {
    if (!g.in) continue;
    const pts = g.pts.map(([x, z]) => V(x, z));
    if (lengthOf(pts) < 3) continue;
    const w = Math.max(1.2, g.w);
    const s: Street = { pts, w, main: g.main, kind: 'lane' };
    lay.streets.push(s);
    paint(s);
    if (g.w >= 7.5 && lengthOf(pts) > 6) { const m = along(pts, lengthOf(pts) / 2)!; lay.squares.push({ x: m.p.x, z: m.p.y, r: g.w / 2 }); }
  }
  // The arch gates: a paved way straight through, 30 m into the town.
  for (const [id, dx, dz] of [['aurea', 0.88, -0.48], ['sacramenti', 0.62, -0.79]] as const) {
    const g = GATES.find((q) => q.id === id)!;
    // Inward is the side that is inside the walls.
    const sgn = insideness(g.at[0] - dx * 12, g.at[1] - dz * 12) > insideness(g.at[0] + dx * 12, g.at[1] + dz * 12) ? -1 : 1;
    const s: Street = { pts: [V(g.at[0] - sgn * dx * 6, g.at[1] - sgn * dz * 6), V(g.at[0] + sgn * dx * 30, g.at[1] + sgn * dz * 30)], w: 5, main: false, kind: 'lane' };
    lay.streets.push(s);
    paint(s, true);
  }
  // Gates: a short paved approach inside each.
  for (const gt of GATES) {
    const [gx, gz] = gt.at;
    let best: { p: V2; d: number } | null = null;
    for (const s of lay.streets) for (let k = 0; k < s.pts.length - 1; k++) {
      const a = s.pts[k], b = s.pts[k + 1], ab = b.clone().sub(a);
      const t = THREE.MathUtils.clamp(V(gx, gz).sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      const p = a.clone().addScaledVector(ab, t), d = p.distanceTo(V(gx, gz));
      if (!best || d < best.d) best = { p, d };
    }
    if (best && best.d < 60) {
      const s: Street = { pts: [V(gx, gz), best.p], w: gt.main ? 3.2 : 2.2, main: false, kind: 'lane' };
      lay.streets.push(s); paint(s, true);
    }
  }

  // 5. What each block was in 700: built up, built along its lanes with a
  //    garden behind, or gardens, vines, pens and ruins.
  type Use = 'built' | 'mixed' | PlotKind;
  const use: Use[] = [];
  parcels.forEach((p, n) => {
    let cx = 0, cz = 0;
    for (const [x, z] of p.pts) { cx += x / p.pts.length; cz += z / p.pts.length; }
    const D = density(cx, cz);
    let pb = D * (p.a > 1600 ? 0.55 : p.a > 700 ? 0.85 : 1.05);
    if (p.k === 'open') pb = 0;
    const u = rand();
    let k: Use;
    if (u < pb) k = 'built';
    else if (u < pb + 0.2 && p.a > 160) k = 'mixed';
    else {
      const v = rand();
      k = v < 0.42 ? 'orto' : v < 0.56 ? 'vinea' : v < 0.74 ? 'pratum' : v < 0.88 ? 'ruina' : 'stabulum';
      if (p.a > 2500 && k === 'stabulum') k = 'pratum';
    }
    use[n + 1] = k;
    if (k !== 'built' && k !== 'mixed') {
      lay.plots.push({ pts: p.pts, kind: k, seed: Math.floor(rand() * 1e9), cx, cz });
      r.fill(p.pts, (kk) => { if (r.grid[kk] === FREE) r.grid[kk] = PLOT; });
    }
  });

  // 6. Houses along the lanes, wall to wall, each within one block.
  const quadClear = (c: V2[], allowHouse: number, needPid: (pid: number) => boolean, inBlock = false) => {
    let total = 0, house = 0, pid0 = -1;
    const p = V(0, 0);
    for (let u = 0.08; u < 1; u += 0.14) for (let w = 0.08; w < 1; w += 0.14) {
      p.copy(c[0]).lerp(c[1], u);
      p.lerp(c[3].clone().lerp(c[2], u), w);
      const k = r.idx(p.x, p.y);
      if (k < 0) return false;
      const v = r.grid[k];
      if (v === STREET || v === RESERVED || v === OUTSIDE || v === PLOT) return false;
      const pid = r.parcel[k];
      if (!pid && inBlock) return false;
      if (pid) { if (pid0 < 0) pid0 = pid; else if (pid !== pid0) return false; }
      total++;
      if (v === HOUSE) house++;
    }
    if (pid0 > 0 && !needPid(pid0)) return false;
    return house / total <= allowHouse;
  };
  const markQuad = (c: V2[]) => {
    const p = V(0, 0);
    for (let u = 0; u <= 1; u += 0.04) for (let w = 0; w <= 1; w += 0.04) {
      p.copy(c[0]).lerp(c[1], u);
      p.lerp(c[3].clone().lerp(c[2], u), w);
      const k = r.idx(p.x, p.y);
      if (k >= 0 && r.grid[k] === FREE) r.grid[k] = HOUSE;
    }
  };
  const pidOf = (c: V2[]) => { const m = c[0].clone().add(c[1]).add(c[2]).add(c[3]).multiplyScalar(0.25); return r.pid(m.x, m.y); };
  let lotId = 0;
  const frontOk = (pid: number) => use[pid] === 'built' || use[pid] === 'mixed';
  // Street width in front of a point, looking out along n.
  const widthAt = (p: V2, n: V2) => {
    let w = 0;
    while (w < 16) { const k = r.idx(p.x + n.x * (w + 0.25), p.y + n.y * (w + 0.25)); if (k < 0 || r.grid[k] !== STREET) break; w += 0.5; }
    return w;
  };
  const strict = (pid: number) => (q: number) => q === pid;
  parcels.forEach((p, n) => {
    const pid = n + 1;
    if (!frontOk(pid)) return;
    const ring = p.pts.map(([x, z]) => V(x, z));
    ring.push(ring[0].clone());
    const L = lengthOf(ring);
    let u = R(0, 2);
    while (u < L - 2.5) {
      const f = Math.min(R(3.2, 6.5), L - u);
      const a = along(ring, u), b = along(ring, u + f);
      u += f + (rand() < 0.06 ? R(0.5, 1.5) : 0);
      if (!a || !b) break;
      const d = b.p.clone().sub(a.p);
      if (d.length() < 2.4) continue;
      d.normalize();
      const perp = V(-d.y, d.x);
      const mid = a.p.clone().add(b.p).multiplyScalar(0.5);
      const pin = r.pid(mid.x + perp.x * 1.5, mid.y + perp.y * 1.5) === pid, pout = r.pid(mid.x - perp.x * 1.5, mid.y - perp.y * 1.5) === pid;
      if (pin === pout) continue;
      const nIn = pin ? perp : perp.clone().negate(), out = nIn.clone().negate();
      // A front only where the block meets the street (not a party wall).
      const ahead = r.at(mid.x + out.x * 1.2, mid.y + out.y * 1.2);
      if (ahead !== STREET) continue;
      if (density(mid.x, mid.y) < 0.1 && rand() < 0.6) continue;
      const F0 = a.p.clone().addScaledVector(nIn, 0.1), F1 = b.p.clone().addScaledVector(nIn, 0.1);
      const main = r.main[r.idx(mid.x + out.x * 1.5, mid.y + out.y * 1.5)] > 0;
      let d0 = R(5, main ? 11 : 9), d1 = d0 + R(-1.4, 1.4);
      let ok = false, c: V2[] = [];
      while (d0 > 2.6 && d1 > 2.6) {
        c = [F0, F1, F1.clone().addScaledVector(nIn, d1), F0.clone().addScaledVector(nIn, d0)];
        if (quadClear(c, 0.35, strict(pid), true)) { ok = true; break; }
        d0 -= 0.8; d1 -= 0.8;
      }
      if (!ok) continue;
      markQuad(c);
      lay.lots.push({ id: lotId++, c, front: { a: F0, b: F1, out }, h: R(5, 10.5) * (0.75 + 0.35 * density(F0.x, F0.y)), street: Math.max(1.5, widthAt(mid, out)), parcel: pid });
    }
  });
  // Back buildings inside built blocks; mixed blocks keep a garden behind.
  const free: number[] = [];
  for (let k = 0; k < r.grid.length; k++) if (r.grid[k] === FREE && use[r.parcel[k]] === 'built') free.push(k);
  const tries = Math.min(9000, free.length / 30);
  for (let t = 0; t < tries && free.length; t++) {
    const k = free[Math.floor(rand() * free.length)];
    if (r.grid[k] !== FREE) continue;
    const x = r.x0 + ((k % r.nx) + 0.5) * r.res, z = r.z0 + (Math.floor(k / r.nx) + 0.5) * r.res;
    const ang = R(-0.3, 0.3) + (rand() < 0.5 ? 0 : Math.PI / 2);
    const ex = V(Math.cos(ang), -Math.sin(ang)), ez = V(Math.sin(ang), Math.cos(ang));
    for (let s = 0; s < 4; s++) {
      const w = R(2.6, 7) * (1 - s * 0.2), d = R(2.6, 7) * (1 - s * 0.2);
      const o = V(x, z).addScaledVector(ex, -w * R(0.2, 0.8)).addScaledVector(ez, -d * R(0.2, 0.8));
      const c = [o, o.clone().addScaledVector(ex, w), o.clone().addScaledVector(ex, w).addScaledVector(ez, d), o.clone().addScaledVector(ez, d)];
      if (!quadClear(c, 0.6, (pid) => use[pid] === 'built', true)) continue;
      markQuad(c);
      lay.lots.push({ id: lotId++, c, h: R(3.5, 8), parcel: pidOf(c) });
      break;
    }
  }
  // What is left inside mixed blocks is their garden.
  parcels.forEach((p, n) => {
    if (use[n + 1] !== 'mixed') return;
    let cx = 0, cz = 0;
    for (const [x, z] of p.pts) { cx += x / p.pts.length; cz += z / p.pts.length; }
    lay.plots.push({ pts: p.pts, kind: rand() < 0.7 ? 'orto' : 'vinea', seed: Math.floor(rand() * 1e9), cx, cz });
  });

  // 7. Houses you can enter.
  const taken = new Set<number>();
  for (const t of EXPLORE_TARGETS) {
    let best: TownLot | null = null, bd = Infinity;
    for (const l of lay.lots) {
      if (!l.front || taken.has(l.id)) continue;
      const w = l.c[0].distanceTo(l.c[1]), d = l.c[1].distanceTo(l.c[2]);
      if (w < 3.6 || d < 4.2 || w > 8.5) continue;
      const m = l.c[0].clone().add(l.c[2]).multiplyScalar(0.5);
      const dd = Math.hypot(m.x - t.near[0], m.y - t.near[1]);
      if (dd < bd) { bd = dd; best = l; }
    }
    if (best) { best.explore = { id: t.id, kind: t.kind }; best.h = Math.max(best.h, 5.2); taken.add(best.id); }
  }

  // 8. Pontili and flying arches where both sides of a lane are built.
  for (const s of lay.streets) {
    if (s.w > 4.6 || s.kind !== 'lane') continue;
    const L = lengthOf(s.pts);
    let u = R(6, 16);
    while (u < L - 4) {
      const a = along(s.pts, u);
      u += R(9, 24);
      if (!a) break;
      const n = V(-a.d.y, a.d.x);
      const wl = widthAt(a.p, n), wr = widthAt(a.p, n.clone().negate());
      const W = wl + wr;
      if (W < 1.2 || W > 4.6) continue;
      const beyond = (side: number, w: number) => {
        let ok = 0;
        for (const k of [-1.2, 0, 1.2]) {
          const q = a.p.clone().addScaledVector(n, side * (w + 1.0)).addScaledVector(a.d, k);
          if (r.at(q.x, q.y) === HOUSE) ok++;
        }
        return ok >= 2;
      };
      if (!beyond(1, wl) || !beyond(-1, wr)) continue;
      const c = a.p.clone().addScaledVector(n, (wl - wr) / 2);
      if (density(a.p.x, a.p.y) < 0.35) continue;
      lay.bridges.push({ x: c.x, z: c.y, dx: a.d.x, dz: a.d.y, w: W, pontile: rand() < 0.55 && !s.main, main: s.main });
    }
  }

  // 9. Wells in the open places and at some crossings of the busier quarters.
  for (const q of lay.squares) {
    if (q.r < 4 || density(q.x, q.z) < 0.3 || lay.wells.some((w) => Math.hypot(w.x - q.x, w.z - q.z) < 55)) continue;
    lay.wells.push({ x: q.x + R(-1.5, 1.5), z: q.z + R(-1.5, 1.5) });
  }

  // Worn ground: a band along every built front and every lane; the middle of
  // the wider street spaces of the plan is grass, trodden only where people go.
  {
    const nx = r.nx, N = r.grid.length;
    const dist = new Uint8Array(N).fill(255);
    for (let k = 0; k < N; k++) if (r.grid[k] !== STREET) dist[k] = 0;
    for (let k = 0; k < N; k++) { const i = k % nx; let d = dist[k]; if (i > 0) d = Math.min(d, dist[k - 1] + 1); if (k >= nx) d = Math.min(d, dist[k - nx] + 1); dist[k] = d; }
    for (let k = N - 1; k >= 0; k--) { const i = k % nx; let d = dist[k]; if (i < nx - 1) d = Math.min(d, dist[k + 1] + 1); if (k + nx < N) d = Math.min(d, dist[k + nx] + 1); dist[k] = d; }
    for (let k = 0; k < N; k++) if (r.grid[k] === STREET && (dist[k] <= 5 || r.main[k])) r.trod[k] = 255;
    for (const s of lay.streets) {
      const rad = Math.min(s.w / 2, 1.6);
      for (let q = 0; q < s.pts.length - 1; q++) {
        const a = s.pts[q], b = s.pts[q + 1], L = a.distanceTo(b);
        for (let t = 0; t <= L; t += 0.5) {
          const px = a.x + ((b.x - a.x) * t) / L, pz = a.y + ((b.y - a.y) * t) / L;
          for (let dz = -rad; dz <= rad; dz += 0.5) for (let dx = -rad; dx <= rad; dx += 0.5) {
            if (dx * dx + dz * dz > rad * rad) continue;
            const k = r.idx(px + dx, pz + dz);
            if (k >= 0 && r.grid[k] === STREET) r.trod[k] = 255;
          }
        }
      }
    }
  }

  // 10. Roads outside the walls.
  for (const rd of ROADS) lay.streets.push({ pts: rd.pts.map(([x, z]) => V(x, z)), w: rd.w, main: false, kind: 'road' });
  void BOUNDS; void inPoly;
  return lay;
}
