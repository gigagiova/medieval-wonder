import * as THREE from 'three';
import { rng } from '../builder';
import { GEO_STREETS, GEO_PARCELS, GEO_STREET_AREAS, DECUMANUS, WALL700, BOUNDS, insideness, inPoly, distPolyline, type P2 } from './geo';
import { SITES, GATES, ROADS, EXPLORE_TARGETS, siteToWorld, type ExploreKind } from './sites';
import { fastTerrain } from '../displace';
import type { Lot, BridgeSpec } from '../town';

// The town of AD 700 laid out on the user's plan, which is the authority for
// what was built and what was open (docs/benevento/HISTORY.md §6): every
// block of the plan is built up, houses wall to wall along all its edges and
// back buildings filling it behind, with only small courtyards; the plan's
// open (green) spaces are the only gardens, vineyards, pens, meadows and
// ruins; its street spaces stay open, with the lanes' centre lines for
// walkers and arches and pontili over the narrow alleys.

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

export interface Street { pts: V2[]; w: number; main: boolean; kind: 'lane' | 'road'; /** One of the plan's lanes. */ plan?: boolean }
export type PlotKind = 'orto' | 'vinea' | 'pratum' | 'ruina' | 'stabulum' | 'cortis' | 'hortulus';
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

/**
 * Open places the street-narrowing pass leaves alone (beyond the lanes, wells, gates and squares it
 * keeps by itself): the little square of the equestrian statue by the curtis (S. Petrus ad Caballum).
 */
/** Tools (tools/benevento) may ask for the keep-open mask of the street-narrowing pass. */
export let DEBUG_KEEP = false;
let GREEDY = 0.1;
export const setGreedy = (v: number) => { GREEDY = v; };
/** Tools: switch parts of the street-narrowing pass off to measure their cost. */
// (islands of row houses in the wide spaces are off since the phone-budget pass: they cost ~6% of the
// near chunks' triangles; the walled gardens fill those spaces for a tenth of that.)
export const ENCROACH = { forward: true, shops: true, islands: false };
export const setDebugKeep = (v: boolean) => { DEBUG_KEEP = v; };
export const KEEP_OPEN: { x: number; z: number; r: number }[] = [];

// ---------------------------------------------------------------- intensity of settlement
// High along the decumanus, round the dukes' curtis and the bishop's church,
// inside Porta Aurea; low on the steep slopes to the Calore. It no longer
// decides what is built (the plan does): only how tall the houses are, and
// where the wells and the arches over the lanes go.
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
  // Largest first, so a cell drawn inside another (a courtyard in a ring of
  // buildings, a house standing in a yard) owns its own ground.
  [...parcels.keys()].sort((a, b) => parcels[b].a - parcels[a].a).forEach((n) => r.fill(parcels[n].pts, (k) => { if (r.grid[k] === FREE) r.parcel[k] = n + 1; }));
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
    const square = s.id === 'forum' || !!s.square;
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
    const s: Street = { pts, w, main: g.main, kind: 'lane', plan: true };
    lay.streets.push(s);
    paint(s);
    if (g.w >= 7.5 && lengthOf(pts) > 6) { const m = along(pts, lengthOf(pts) / 2)!; lay.squares.push({ x: m.p.x, z: m.p.y, r: g.w / 2 }); }
  }
  // The arch gates: a paved way straight through, 30 m into the town.
  for (const [id, dx, dz] of [['aurea', -Math.sin(SITES.arcusTraiani.rot), -Math.cos(SITES.arcusTraiani.rot)], ['sacramenti', 0.62, -0.79]] as const) {
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

  // 5. What each block was in 700: as the plan says, a block is built up and
  //    an open space is a garden, a vineyard, a pen, a meadow or a ruin.
  type Use = 'built' | 'site' | 'house' | 'court' | PlotKind;
  const use: Use[] = [];
  // Blocks a landmark precinct cuts into belong to the landmark.
  const tot = new Uint32Array(parcels.length + 1), res = new Uint32Array(parcels.length + 1);
  for (let k = 0; k < r.grid.length; k++) { const q = r.parcel[k]; if (q && q <= parcels.length) { tot[q]++; if (r.grid[k] === RESERVED) res[q]++; } }
  parcels.forEach((p, n) => {
    // Only blocks mostly inside a landmark's precinct (or the band along the
    // curtain) are left to it; elsewhere the reserved cells just stay unbuilt.
    if (res[n + 1] > tot[n + 1] * 0.5) { use[n + 1] = 'site'; return; }
    // A block a gate road was cut through keeps no fenced plot across the road.
    const cut = tot[n + 1] * r.res * r.res < p.a * 0.9;
    let cx = 0, cz = 0;
    for (const [x, z] of p.pts) { cx += x / p.pts.length; cz += z / p.pts.length; }
    let k: Use;
    if (p.k !== 'open') k = 'built';
    else {
      const v = rand();
      k = v < 0.42 ? 'orto' : v < 0.56 ? 'vinea' : v < 0.74 ? 'pratum' : v < 0.88 ? 'ruina' : 'stabulum';
      // A road cut through it (a gate's way): no fences or rows of stakes across the road.
      let lane = 0;
      r.fill(p.pts, (kk) => { if (r.grid[kk] === STREET) lane++; });
      if ((p.a > 2500 && k === 'stabulum') || cut || lane * r.res * r.res > 12) k = 'pratum';
    }
    use[n + 1] = k;
    if (k !== 'built') {
      lay.plots.push({ pts: p.pts, kind: k, seed: Math.floor(rand() * 1e9), cx, cz });
      r.fill(p.pts, (kk) => { if (r.grid[kk] === FREE) r.grid[kk] = PLOT; });
    }
  });

  // 6. Houses along the lanes, wall to wall, each within one block.
  const quadClear = (c: V2[], allowHouse: number, needPid: (pid: number) => boolean, inBlock = false) => {
    let total = 0, house = 0, pid0 = -1;
    const [c0, c1, c2, c3] = c;
    // A house may lean over part of another (allowHouse), never over a lane: fail fast.
    let budget = Math.floor(49 * allowHouse);
    for (let u = 0.08; u < 1; u += 0.14) for (let w = 0.08; w < 1; w += 0.14) {
      const ax = c0.x + (c1.x - c0.x) * u, az = c0.y + (c1.y - c0.y) * u, bx = c3.x + (c2.x - c3.x) * u, bz = c3.y + (c2.y - c3.y) * u;
      const k = r.idx(ax + (bx - ax) * w, az + (bz - az) * w);
      if (k < 0) return false;
      const v = r.grid[k];
      if (v === STREET || v === RESERVED || v === OUTSIDE || v === PLOT) return false;
      const pid = r.parcel[k];
      if (!pid && inBlock) return false;
      if (pid) { if (pid0 < 0) pid0 = pid; else if (pid !== pid0) return false; }
      total++;
      if (v === HOUSE) { house++; if (--budget < 0) return false; }
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
  const frontOk = (pid: number) => use[pid] === 'built';
  // Street width in front of a point, looking out along n: from a house front, across the strip of
  // the plan's ink line that belongs to the block, to the far side of the street (capped: a square
  // is not a lane). An earlier version started counting at the wall and found the ink strip, so
  // every front thought it stood on a lane 1.5 m wide: no stairs, woodpiles or carts anywhere.
  const widthAt = (p: V2, n: V2) => {
    let s0 = 0;
    while (s0 < 2.5) { const k = r.idx(p.x + n.x * (s0 + 0.25), p.y + n.y * (s0 + 0.25)); if (k >= 0 && r.grid[k] === STREET) break; s0 += 0.25; }
    if (s0 >= 2.5) return 0;
    let w = 0;
    while (w < 16) { const k = r.idx(p.x + n.x * (s0 + w + 0.25), p.y + n.y * (s0 + w + 0.25)); if (k < 0 || r.grid[k] !== STREET) break; w += 0.5; }
    return Math.min(12, s0 + w);
  };
  const strict = (pid: number) => (q: number) => q === pid;
  // The plan draws the houses themselves: every cell of a block between its
  // lines is one building, as drawn (irregular footprints kept, simplified
  // to at most ~10 corners); courtyards only where the plan draws a cell in
  // a ring of others. Only cells too big for one house (blocks drawn without
  // inner lines) are filled by the passes below.
  const simplify = (pts: V2[], tol: number): V2[] => {
    const ring = [...pts, pts[0]];
    const dp = (a: number, b: number, out: number[]) => {
      let best = -1, bd = tol;
      for (let i = a + 1; i < b; i++) { const d = distSeg(ring[i], ring[a], ring[b]); if (d > bd) { bd = d; best = i; } }
      if (best < 0) return;
      dp(a, best, out); out.push(best); dp(best, b, out);
    };
    // Split the ring at its two farthest points so the recursion has ends.
    let far = 0, fd = 0;
    for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[0]); if (d > fd) { fd = d; far = i; } }
    const idx: number[] = [0];
    dp(0, far, idx); idx.push(far); dp(far, ring.length - 1, idx);
    return idx.map((i) => ring[i]);
  };
  const CELL_MAX = 420;
  // Cells drawn inside other cells. A container whose leftover is a thin band
  // round its children is a ring of buildings round a courtyard (a cloister, a
  // courtyard house); a container with room to spare is a yard with buildings
  // standing in it.
  const centroid = (pts: P2[]) => { let x = 0, z = 0; for (const [a, b] of pts) { x += a / pts.length; z += b / pts.length; } return [x, z] as P2; };
  const bbox = parcels.map((p) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; });
  const children: number[][] = parcels.map(() => []);
  const parentOf: number[] = parcels.map(() => -1);
  parcels.forEach((q, j) => {
    const [cx, cz] = centroid(q.pts);
    let best = -1;
    parcels.forEach((p, i) => {
      if (i === j || p.a <= q.a * 1.3) return;
      const b2 = bbox[i];
      if (cx < b2[0] || cx > b2[2] || cz < b2[1] || cz > b2[3] || !inPoly(cx, cz, p.pts)) return;
      if (best < 0 || p.a < parcels[best].a) best = i;
    });
    if (best >= 0) { children[best].push(j); parentOf[j] = best; }
  });
  parcels.forEach((p, i) => {
    if (!children[i].length || use[i + 1] !== 'built') return;
    let per = 0, ca = 0;
    for (let k = 0; k < p.pts.length; k++) { const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    for (const j of children[i]) ca += parcels[j].a;
    const band = (p.a - ca) / Math.max(1, per);
    if (band < 9) { for (const j of children[i]) if (use[j + 1] === 'built') use[j + 1] = 'court'; }
    else use[i + 1] = 'court';
  });
  parcels.forEach((p, n) => {
    const pid = n + 1;
    if (use[pid] !== 'built') return;
    let pts = p.pts.map(([x, z]) => V(x, z));
    if (children[n].length) return; // a ring round a courtyard: filled by the passes below
    if (p.a > CELL_MAX) return;
    for (const tol of [0.45, 0.7, 1.0, 1.4]) { pts = simplify(p.pts.map(([x, z]) => V(x, z)), tol); if (pts.length <= 10) break; }
    if (pts.length < 3) return;
    // The front: the longest side with a lane in front of it; it becomes edge 0→1.
    let fk = -1, fl = 0, fout = V(0, 0);
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], L = a.distanceTo(b);
      if (L < 2.4 || L <= fl) continue;
      const e = b.clone().sub(a).normalize(), m = a.clone().add(b).multiplyScalar(0.5);
      for (const sd of [-1, 1]) {
        const o = V(-e.y * sd, e.x * sd);
        if (r.at(m.x + o.x * 1.3, m.y + o.y * 1.3) === STREET && r.pid(m.x - o.x * 1.3, m.y - o.y * 1.3) === pid) { fk = k; fl = L; fout = o; }
      }
    }
    use[pid] = 'house';
    r.fill(p.pts, (kk) => { if (r.grid[kk] === FREE) r.grid[kk] = HOUSE; });
    const h0 = density(pts[0].x, pts[0].y);
    if (fk < 0) { lay.lots.push({ id: lotId++, c: pts, h: R(4, 8) * (0.8 + 0.3 * h0), parcel: pid }); return; }
    const c = [...pts.slice(fk), ...pts.slice(0, fk)];
    const mid = c[0].clone().add(c[1]).multiplyScalar(0.5);
    lay.lots.push({ id: lotId++, c, front: { a: c[0].clone(), b: c[1].clone(), out: fout }, h: R(5, 10.5) * (0.75 + 0.35 * h0), street: Math.max(1.5, widthAt(mid, fout)), parcel: pid });
  });
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
  // Behind each front house: back ranges (kitchen, workshop, store, stable)
  // on the same plot, now and then across a small yard.
  for (const l of lay.lots.filter((q) => q.front)) {
    const pid = l.parcel;
    if (use[pid] !== 'built') continue;
    const nIn = l.front!.out.clone().negate();
    let A = l.c[3], B = l.c[2];
    for (let row = 0; row < 3; row++) {
      const yard = rand() < 0.25 ? R(1.5, 3.5) : 0.05;
      let ok = false, c: V2[] = [];
      const A0 = A.clone().addScaledVector(nIn, yard), B0 = B.clone().addScaledVector(nIn, yard);
      for (let d = R(3.5, 7); d > 2.4; d -= 0.8) {
        c = [A0, B0, B0.clone().addScaledVector(nIn, d), A0.clone().addScaledVector(nIn, d)];
        if (quadClear(c, 0.12, strict(pid), true)) { ok = true; break; }
      }
      if (!ok) break;
      markQuad(c);
      lay.lots.push({ id: lotId++, c, h: R(3.6, 8), parcel: pid });
      A = c[3]; B = c[2];
    }
  }
  // Then the rest of each block, tiled with buildings on the block's own
  // grain (its longest edge), shrinking where they meet the others; now and
  // then a tile is left as a small courtyard.
  for (const pass of [0, 1]) parcels.forEach((p, n) => {
    const pid = n + 1;
    if (use[pid] !== 'built') return;
    let best = 0, ang = 0;
    for (let i = 0; i < p.pts.length; i++) {
      const a = p.pts[i], c = p.pts[(i + 1) % p.pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L > best) { best = L; ang = Math.atan2(c[1] - a[1], c[0] - a[0]); }
    }
    const ex = V(Math.cos(ang), Math.sin(ang)), ez = V(-Math.sin(ang), Math.cos(ang));
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const [x, z] of p.pts) { const u = x * ex.x + z * ex.y, w = x * ez.x + z * ez.y; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
    const at = (u: number, w: number) => V(ex.x * u + ez.x * w, ex.y * u + ez.y * w);
    // A second pass on a shifted grid fills what the first left between.
    for (let w = w0 + R(0, 1.5) + pass * 2.5; w < w1 - 1.5; ) {
      const dw = R(4, 7);
      for (let u = u0 + R(0, 1.5) + pass * 2.2; u < u1 - 1.5; ) {
        const du = R(3.5, 7);
        if (rand() < 0.04 - pass * 0.04) { u += du; continue; }
        // The tile, or a smaller one anchored at one of its corners.
        let placed = false;
        for (const f of [1, 0.75, 0.55, 0.4]) for (const [su, sw] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          if (placed) break;
          const a = u + su * du * (1 - f), b2 = w + sw * dw * (1 - f), A2 = du * f, B2 = dw * f;
          if (A2 < 2.2 || B2 < 2.2) continue;
          const c = [at(a, b2), at(a + A2, b2), at(a + A2, b2 + B2), at(a, b2 + B2)];
          if (!quadClear(c, pass ? 0.4 : 0.2, strict(pid), true)) continue;
          markQuad(c);
          lay.lots.push({ id: lotId++, c, h: R(3.6, 8), parcel: pid });
          placed = true;
        }
        u += du;
      }
      w += dw;
    }
  });
  // Last, sheds and lean-tos into the leftover corners.
  const free: number[] = [];
  for (let k = 0; k < r.grid.length; k++) if (r.grid[k] === FREE && use[r.parcel[k]] === 'built') free.push(k);
  const tries = Math.min(15000, free.length / 6);
  for (let t = 0; t < tries && free.length; t++) {
    const k = free[Math.floor(rand() * free.length)];
    if (r.grid[k] !== FREE) continue;
    const x = r.x0 + ((k % r.nx) + 0.5) * r.res, z = r.z0 + (Math.floor(k / r.nx) + 0.5) * r.res;
    const ang = R(-0.3, 0.3) + (rand() < 0.5 ? 0 : Math.PI / 2);
    const ex = V(Math.cos(ang), -Math.sin(ang)), ez = V(Math.sin(ang), Math.cos(ang));
    for (let s = 0; s < 4; s++) {
      const w = R(2.2, 5) * (1 - s * 0.12), d = R(2.2, 5) * (1 - s * 0.12);
      const o = V(x, z).addScaledVector(ex, -w * R(0.2, 0.8)).addScaledVector(ez, -d * R(0.2, 0.8));
      const c = [o, o.clone().addScaledVector(ex, w), o.clone().addScaledVector(ex, w).addScaledVector(ez, d), o.clone().addScaledVector(ez, d)];
      if (!quadClear(c, 0.3, (pid) => use[pid] === 'built', true)) continue;
      markQuad(c);
      lay.lots.push({ id: lotId++, c, h: R(3, 5.5), parcel: pidOf(c) });
      break;
    }
  }
  // 7. Houses you can enter.
  const taken = new Set<number>();
  for (const t of EXPLORE_TARGETS) {
    let best: TownLot | null = null, bd = Infinity;
    for (const l of lay.lots) {
      if (!l.front || taken.has(l.id) || l.c.length !== 4) continue;
      const w = l.c[0].distanceTo(l.c[1]), d = l.c[1].distanceTo(l.c[2]);
      if (w < 3.6 || d < 4.2 || w > 8.5) continue;
      const m = l.c[0].clone().add(l.c[2]).multiplyScalar(0.5);
      const dd = Math.hypot(m.x - t.near[0], m.y - t.near[1]);
      if (dd < bd) { bd = dd; best = l; }
    }
    if (best) { best.explore = { id: t.id, kind: t.kind }; best.h = Math.max(best.h, 5.2); taken.add(best.id); }
  }

  // 7b. The street spaces narrowed. The plan draws the streets of the later medieval town at the
  //     width the Roman grid left them; by 700 they had been built into. In the excavated towns of
  //     the period the public street is encroached on by private building: porticoes walled up into
  //     shops, house fronts brought forward, lean-tos, sheds and yard walls set out into the old
  //     roadway, until a Roman street of 6-10 m is a lane of 2-4 m (Naples: P. Arthur, *Naples, from
  //     Roman town to city-state*, 2002; Rome: R. Santangeli Valenzani; northern Italy: G. P.
  //     Brogiolo; for Benevento, Bertelli 1992 and Rotili 1986 on the reuse of the Roman fabric and
  //     the pontili allowed over the lanes "with the obligation to keep the street public"). So:
  //     every lane of the plan keeps a clear way down its middle (the decumanus 6 m, the lanes their
  //     drawn width up to 4-5 m), the gates, wells, open places, the landmarks' frontages and the
  //     doors of the houses one can enter keep their room, and the rest of the street space is
  //     taken: house fronts brought forward, low shops and workshops built against the fronts, walled
  //     yards in front of the houses, and where a street space is wide enough, small islands of
  //     houses and sheds standing in it. docs/benevento/HISTORY.md §6.
  {
    const N = r.grid.length, nx = r.nx;
    const keep = new Uint8Array(N);
    const disc = (x: number, z: number, rad: number) => {
      const i0 = Math.floor((x - rad - r.x0) / r.res), i1 = Math.ceil((x + rad - r.x0) / r.res);
      const j0 = Math.floor((z - rad - r.z0) / r.res), j1 = Math.ceil((z + rad - r.z0) / r.res);
      for (let j = Math.max(0, j0); j <= Math.min(r.nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
        const cx = r.x0 + (i + 0.5) * r.res - x, cz = r.z0 + (j + 0.5) * r.res - z;
        if (cx * cx + cz * cz <= rad * rad) keep[j * nx + i] = 1;
      }
    };
    for (const st of lay.streets) {
      if (st.kind !== 'lane') continue;
      const rad = st.main ? 2.8 : !st.plan ? 2.4 : Math.min(1.75, Math.max(1.0, st.w * 0.5));
      for (let k = 0; k < st.pts.length - 1; k++) {
        const a = st.pts[k], b = st.pts[k + 1], L = a.distanceTo(b);
        for (let t = 0; t <= L; t += 0.5) disc(a.x + ((b.x - a.x) * t) / L, a.y + ((b.y - a.y) * t) / L, rad);
      }
    }
    // The open places that stay open: the forum and the places with a well.
    for (const q of lay.squares) if (q.r >= 10) disc(q.x, q.z, q.r + 2);
    for (const w of lay.wells) disc(w.x, w.z, 5.5);
    for (const g of GATES) disc(g.at[0], g.at[1], 14);
    for (const l of lay.lots) if (l.explore && l.front) {
      const m = l.front.a.clone().add(l.front.b).multiplyScalar(0.5);
      disc(m.x + l.front.out.x * 2.5, m.y + l.front.out.y * 2.5, 4);
    }
    for (const q of KEEP_OPEN) disc(q.x, q.z, q.r);
    // The frontages of the landmarks' precincts and the band inside the curtain: 6 m kept open.
    {
      const d = new Uint8Array(N).fill(255);
      let front: number[] = [];
      for (let k = 0; k < N; k++) if (r.grid[k] === RESERVED) { d[k] = 0; front.push(k); }
      for (let step = 1; step <= 12 && front.length; step++) {
        const next: number[] = [];
        for (const k of front) for (const o of [1, -1, nx, -nx]) { const q = k + o; if (q >= 0 && q < N && d[q] === 255) { d[q] = step; next.push(q); } }
        front = next;
      }
      for (let k = 0; k < N; k++) if (d[k] <= 12) keep[k] = 1;
    }
    const open = (k: number) => k >= 0 && r.grid[k] === STREET && !keep[k];
    // Cells a strip in front of a house may take: open street, or the house's own share of the plan's ink line.
    const takeable = (k: number, pid: number) => open(k) || (k >= 0 && r.grid[k] === FREE && r.parcel[k] === pid);
    const fill = (c: V2[], v: number, pid: number) => {
      r.fill(c.map((p) => [p.x, p.y] as P2), (k) => { if (r.grid[k] === STREET || r.grid[k] === FREE) { r.grid[k] = v; if (v === HOUSE && !r.parcel[k]) r.parcel[k] = pid; } });
    };
    const backed = new Set<number>(); // houses with a shop built against their front
    const yards = new Map<number, number>(); // houses with a walled yard in front: its depth
    const fronts = lay.lots.filter((l) => l.front && !l.explore);
    for (const l of fronts) {
      const f = l.front!, A = f.a, B = f.b;
      const L = A.distanceTo(B);
      if (L < 2.4) continue;
      const dir = B.clone().sub(A).divideScalar(L);
      // How far out the street may be taken at each point along the front.
      const us: number[] = [], es: number[] = [];
      for (let u = 0.3; u <= L - 0.3 + 1e-6; u += 0.45) {
        let e = 0;
        while (e < 7) {
          let ok = true;
          for (let de = 0.15; de <= 0.5; de += 0.35) {
            const k = r.idx(A.x + dir.x * u + f.out.x * (e + de), A.y + dir.y * u + f.out.y * (e + de));
            if (!takeable(k, l.parcel) && !(e + de < 0.6 && k >= 0 && r.grid[k] === HOUSE)) { ok = false; break; }
          }
          if (!ok) break;
          e += 0.5;
        }
        us.push(u); es.push(e);
      }
      const eAll = Math.min(...es);
      const v = rand();
      const A2 = (d: number) => A.clone().addScaledVector(f.out, d), B2 = (d: number) => B.clone().addScaledVector(f.out, d);
      if (!ENCROACH.forward) { /* measured off */ } else if (eAll >= 1.5 && (v < 0.45 || eAll < 2.4)) {
        // The front brought forward: the house grows into the street.
        const d = Math.min(eAll, R(1.5, 4.5));
        const near = (P: V2) => l.c.findIndex((q) => q.distanceTo(P) < 0.05);
        const i0 = near(A), i1 = near(B);
        if (i0 < 0 || i1 < 0) continue;
        fill([A, B, B2(d), A2(d)], HOUSE, l.parcel);
        l.c[i0] = A2(d);
        l.c[i1] = B2(d);
        l.front = { a: A2(d), b: B2(d), out: f.out };
        continue;
      }
      // Otherwise: along each stretch of the front with room before it (the whole front or part of
      // it), a shop against the wall or a walled yard.
      let i = 0;
      while (i < us.length) {
        if (es[i] < 2.4) { i++; continue; }
        let j = i, m = es[i];
        while (j + 1 < us.length && es[j + 1] >= 2.4) { j++; m = Math.min(m, es[j]); }
        const u0 = i === 0 ? 0 : us[i] - 0.2, u1 = j === us.length - 1 ? L : us[j] + 0.2;
        i = j + 1;
        if (u1 - u0 < 2.4) continue;
        const P = A.clone().addScaledVector(dir, u0), Q = A.clone().addScaledVector(dir, u1);
        const P2 = (d: number) => P.clone().addScaledVector(f.out, d), Q2 = (d: number) => Q.clone().addScaledVector(f.out, d);
        if (rand() < 0.35 && ENCROACH.shops) {
          // A shop or workshop of one storey built against the front (a walled-up portico, a bottega).
          const d = Math.min(m, R(2.4, 4.5));
          const c = [P2(d), Q2(d), Q.clone(), P.clone()];
          fill(c, HOUSE, l.parcel);
          lay.lots.push({ id: lotId++, c, front: { a: c[0], b: c[1], out: f.out }, h: R(3.0, 4.3), parcel: l.parcel });
          backed.add(l.id);
        } else {
          // A walled yard before the house, with its gate on the lane.
          const d = Math.min(m, R(2.5, 6));
          const c: P2[] = [[P2(d).x, P2(d).y], [Q2(d).x, Q2(d).y], [Q.x, Q.y], [P.x, P.y]];
          fill([P2(d), Q2(d), Q, P], PLOT, l.parcel);
        r.fill([[P2(d).x, P2(d).y], [Q2(d).x, Q2(d).y], [Q.x, Q.y], [P.x, P.y]], (k) => { r.trod[k] = 255; });
          const cx = (c[0][0] + c[2][0]) / 2, cz = (c[0][1] + c[2][1]) / 2;
          lay.plots.push({ pts: c, kind: 'cortis', seed: Math.floor(rand() * 1e9), cx, cz });
          yards.set(l.id, d);
        }
      }
      void v;
    }
    // Every street door keeps a passage before it (an andito of a metre and a half) whatever is built
    // in the street space beyond.
    for (const l of lay.lots) {
      if (!l.front) continue;
      const f = l.front, L = f.a.distanceTo(f.b), d = f.b.clone().sub(f.a).divideScalar(L || 1);
      for (let u = 0; u <= L; u += 0.4) for (let e = 0.3; e <= 1.6; e += 0.4) {
        const k = r.idx(f.a.x + d.x * u + f.out.x * e, f.a.y + d.y * u + f.out.y * e);
        if (k >= 0) keep[k] = 1;
      }
    }
    // Islands: what is left of a wide street space, built over with small houses and sheds turned
    // to the lanes round them.
    {
      const comp = new Int32Array(N).fill(-1);
      const comps: number[][] = [];
      for (let k0 = 0; k0 < N; k0++) {
        if (comp[k0] >= 0 || !open(k0)) continue;
        const cells = [k0]; comp[k0] = comps.length;
        for (let q = 0; q < cells.length; q++) {
          const k = cells[q];
          for (const o of [1, -1, nx, -nx]) { const m = k + o; if (m >= 0 && m < N && comp[m] < 0 && open(m)) { comp[m] = comps.length; cells.push(m); } }
        }
        comps.push(cells);
      }
      const cxOf = (k: number) => r.x0 + ((k % nx) + 0.5) * r.res, czOf = (k: number) => r.z0 + (Math.floor(k / nx) + 0.5) * r.res;
      for (let ci = 0; ci < comps.length; ci++) {
        const cells = comps[ci];
        if (cells.length * r.res * r.res < 14) continue;
        // Principal axis of the patch: the island's grain.
        let mx = 0, mz = 0;
        for (const k of cells) { mx += cxOf(k); mz += czOf(k); }
        mx /= cells.length; mz /= cells.length;
        let sxx = 0, szz = 0, sxz = 0;
        for (const k of cells) { const dx = cxOf(k) - mx, dz = czOf(k) - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
        const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
        const ex = V(Math.cos(ang), Math.sin(ang)), ez = V(-Math.sin(ang), Math.cos(ang));
        let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
        for (const k of cells) { const x = cxOf(k), z = czOf(k), u = x * ex.x + z * ex.y, w = x * ez.x + z * ez.y; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
        const at = (u: number, w: number) => V(ex.x * u + ez.x * w, ex.y * u + ez.y * w);
        const inComp = (c: V2[]) => {
          const [c0, c1, c2, c3] = c;
          for (let a = 0.05; a < 1; a += 0.15) for (let b2 = 0.05; b2 < 1; b2 += 0.15) {
            const p = c0.clone().lerp(c1, a).lerp(c3.clone().lerp(c2, a), b2);
            const k = r.idx(p.x, p.y);
            if (k < 0 || comp[k] !== ci || r.grid[k] !== STREET) return false;
          }
          return true;
        };
        const place = (placed: V2[], shed: boolean, withFront: boolean) => {
          fill(placed, HOUSE, 0);
          const ctr = placed[0].clone().add(placed[2]).multiplyScalar(0.5);
          // The front: the side with the most street before it.
          let best = -1, bw = 0;
          for (let q = 0; q < 4; q++) {
            const a = placed[q], b2 = placed[(q + 1) % 4], m = a.clone().add(b2).multiplyScalar(0.5);
            const e2 = b2.clone().sub(a).normalize(), o = V(e2.y, -e2.x);
            if (o.dot(m.clone().sub(ctr)) < 0) o.negate();
            const ww = widthAt(m, o);
            if (ww > bw + 0.4) { bw = ww; best = q; }
          }
          // The island's houses in rows show a street front to their lane; the small pieces filled in
          // after them are back buildings (walls with a few openings, a coarser build: phone budget).
          if (withFront && best >= 0 && bw >= 2.5 && placed[best].distanceTo(placed[(best + 1) % 4]) >= 2.4) {
            const c = [0, 1, 2, 3].map((q) => placed[(best + q) % 4]);
            const e2 = c[1].clone().sub(c[0]).normalize(), o = V(e2.y, -e2.x);
            if (o.dot(c[0].clone().sub(c[3])) < 0) o.negate();
            lay.lots.push({ id: lotId++, c, front: { a: c[0], b: c[1], out: o }, h: shed ? R(3.0, 4.2) : R(4.2, 7.8), parcel: 0 });
          } else lay.lots.push({ id: lotId++, c: placed, h: shed ? R(2.6, 3.6) : R(3.6, 6.5), parcel: 0 });
        };
        // Rows of houses on the island's grain where it is wide (not across a straggling network of
        // strips, whose bounds are mostly something else)...
        const compact = cells.length * r.res * r.res > 120 && (u1 - u0) * (w1 - w0) < cells.length * r.res * r.res * 3;
        if (compact && ENCROACH.islands) for (let w = w0 + 0.3; w < w1 - 1.5; ) {
          const dw = R(3.6, 7);
          for (let u = u0 + 0.3; u < u1 - 1.5; ) {
            const du = R(3.6, 7);
            for (const f of [1, 0.8, 0.6]) {
              const c = [at(u, w), at(u + du * f, w), at(u + du * f, w + dw * f), at(u, w + dw * f)];
              if (du * f >= 2.2 && dw * f >= 2.2 && inComp(c)) { place(c, false, true); break; }
            }
            u += du;
          }
          w += dw;
        }
        // ...then the pockets left between: walled gardens and pens (a wall a little over head height
        // round a plot of beds or a pen, its gate on the lane). Cheap to draw, they close the views as
        // the houses do (an island of small houses here cost the phone too many triangles).
        const order = cells.slice();
        for (let q = order.length - 1; q > 0; q--) { const t = Math.floor(rand() * (q + 1)); [order[q], order[t]] = [order[t], order[q]]; }
        let tries = 0;
        for (const k of order) {
          if (r.grid[k] !== STREET) continue;
          if (++tries > cells.length * GREEDY) break;
          const x = cxOf(k), z = czOf(k), u = x * ex.x + z * ex.y, w = x * ez.x + z * ez.y;
          const du = R(3.2, 6.5), dw = R(3.2, 6.5);
          for (const [su, sv] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]]) {
            const c = [at(u - su * du, w - sv * dw), at(u + (1 - su) * du, w - sv * dw), at(u + (1 - su) * du, w + (1 - sv) * dw), at(u - su * du, w + (1 - sv) * dw)];
            if (!inComp(c)) continue;
            // The gate on the side with the most street before it: that side first.
            const ctr = c[0].clone().add(c[2]).multiplyScalar(0.5);
            let best = 0, bw = -1;
            for (let q = 0; q < 4; q++) {
              const m = c[q].clone().add(c[(q + 1) % 4]).multiplyScalar(0.5), o = m.clone().sub(ctr).normalize();
              const ww = widthAt(m, o);
              if (ww > bw) { bw = ww; best = q; }
            }
            const cc = [0, 1, 2, 3].map((q) => c[(best + q) % 4]);
            fill(cc, PLOT, 0);
            lay.plots.push({ pts: cc.map((p) => [p.x, p.y] as P2), kind: 'hortulus', seed: Math.floor(rand() * 1e9), cx: ctr.x, cz: ctr.y });
            break;
          }
        }
      }
    }
    if (DEBUG_KEEP) (lay as unknown as { keep: Uint8Array }).keep = keep;
    // Every front measured again against the street as it now is; along the decumanus the houses
    // that mattered rise to two and three storeys.
    for (const l of lay.lots) {
      if (!l.front || l.explore) continue;
      const m = l.front.a.clone().add(l.front.b).multiplyScalar(0.5);
      l.street = backed.has(l.id) ? 1.5 : yards.has(l.id) ? yards.get(l.id)! : Math.max(1.5, widthAt(m, l.front.out));
      const k = r.idx(m.x + l.front.out.x * 2, m.y + l.front.out.y * 2);
      if (k >= 0 && r.main[k] > 0 && !backed.has(l.id) && l.h < 7.2 && rand() < 0.45) l.h = R(7.2, 10.5);
    }
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
      if (density(a.p.x, a.p.y) < 0.2) continue;
      lay.bridges.push({ x: c.x, z: c.y, dx: a.d.x, dz: a.d.y, w: W, pontile: rand() < 0.55 && !s.main, main: s.main });
    }
  }

  // 9. Wells in the open places and at some crossings of the busier quarters.
  for (const q of lay.squares) {
    if (q.r < 4 || density(q.x, q.z) < 0.3 || lay.wells.some((w) => Math.hypot(w.x - q.x, w.z - q.z) < 55)) continue;
    // Not in a landmark's square (the statue and the church stand there).
    if (Object.values(SITES).some((s) => s.square && Math.hypot(s.x - q.x, s.z - q.z) < (s.clear ?? 0) + 4)) continue;
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
