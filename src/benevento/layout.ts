import * as THREE from 'three';
import { rng } from '../builder';
import { GEO_STREETS, GEO_PARCELS, GEO_STREET_AREAS, DECUMANUS, WALL700, BOUNDS, insideness, inPoly, distPolyline, type P2 } from './geo';
import { SITES, GATES, ROADS, EXPLORE_TARGETS, FIXED_EXPLORE_LOTS, siteToWorld, type ExploreKind } from './sites';
import DENSITY from './layout-density.json';
import type { Lot, BridgeSpec } from '../town';

// The town of AD 700 laid out on the owner's plan, which is the authority for
// what was built and what was open (docs/benevento/HISTORY.md §6 and
// docs/benevento/PLAN-TRACE.md): the plan's drawn building footprints are the
// houses, its yards and large open cells the courtyards, gardens and squares,
// its street spaces the lanes, at their drawn widths.

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
export interface Plot { pts: P2[]; kind: PlotKind; seed: number; cx: number; cz: number;
  /** Edges (index k: pts[k]→pts[k+1]) that face a lane or open ground: a rubble wall stands on them. */
  walls?: number[] }
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

/** Kept for tools: the plan's drawn footprints are no longer narrowed or encroached on. */
export const KEEP_OPEN: { x: number; z: number; r: number }[] = [];

// ---------------------------------------------------------------- intensity of settlement
// High along the decumanus, round the dukes' curtis and the bishop's church,
// inside Porta Aurea; low on the steep slopes to the Calore. It no longer
// decides what is built (the plan does): only how tall the houses are, and
// where the wells and the arches over the lanes go.
// Authored layout density is independent of elevation sampling: a terrain
// upgrade must not reroll house IDs or move streets and worship rooms.
const DEN = (() => {
  const raw = atob(DENSITY.float32le), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const view = new DataView(bytes.buffer), values = new Float32Array(DENSITY.nx * DENSITY.nz);
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
  return values;
})();
export function density(x: number, z: number) {
  const i = Math.floor((x - DENSITY.x0) / DENSITY.step), j = Math.floor((z - DENSITY.z0) / DENSITY.step);
  return i < 0 || j < 0 || i >= DENSITY.nx || j >= DENSITY.nz ? 0 : DEN[j * DENSITY.nx + i];
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
/** Douglas-Peucker on a closed ring, split at its two farthest points. */
function simplifyRing(pts: V2[], tol: number): V2[] {
  const ring = [...pts, pts[0]];
  const dp = (a: number, b: number, out: number[]) => {
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = distSeg(ring[i], ring[a], ring[b]); if (d > bd) { bd = d; best = i; } }
    if (best < 0) return;
    dp(a, best, out); out.push(best); dp(best, b, out);
  };
  let far = 0, fd = 0;
  for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[0]); if (d > fd) { fd = d; far = i; } }
  const idx: number[] = [0];
  dp(0, far, idx); idx.push(far); dp(far, ring.length - 1, idx);
  return idx.map((i) => ring[i]);
}
const areaOf = (c: V2[]) => { let a = 0; for (let k = 0; k < c.length; k++) { const p = c[k], q = c[(k + 1) % c.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; };

/**
 * The town of AD 700 on the owner's plan, cell by cell (docs/benevento/PLAN-TRACE.md):
 * every building footprint drawn on the plan is one house standing on exactly that
 * footprint; the cells drawn as yards and the large open cells are courtyards, gardens
 * and squares; the lanes are the plan's street spaces at their drawn width. Nothing is
 * added to or cut out of the drawn footprints, except where a landmark precinct (built
 * by its own module) takes the ground.
 */
export function layoutTown(seed = 700): Layout {
  const rand = rng(seed);
  const R = (a: number, b: number) => a + (b - a) * rand();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of WALL700) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const r = new Raster(Math.floor(x0 - 8), Math.floor(z0 - 8), Math.ceil(x1 + 8), Math.ceil(z1 + 8));
  const lay: Layout = { r, streets: [], lots: [], bridges: [], plots: [], wells: [], squares: [] };

  // 1. Inside the walls is free land; a band under the curtain (1.4 m each side of its line) is reserved.
  for (let j = 0; j < r.nz; j++) for (let i = 0; i < r.nx; i++) {
    const x = r.x0 + (i + 0.5) * r.res, z = r.z0 + (j + 0.5) * r.res;
    const ins = insideness(x, z);
    if (ins > 0.5) r.grid[j * r.nx + i] = ins < 0.5 + 1.4 / 16 ? RESERVED : FREE;
  }
  // 2. The plan's cells (each a parcel id) and its lane spaces. They tile the town: each cell
  //    already owns its half of the ink lines round it.
  const parcels = GEO_PARCELS.filter((p) => p.in);
  for (const a of GEO_STREET_AREAS) if (!a.hole) r.fill(a.pts, (k) => { if (r.grid[k] === FREE) r.grid[k] = STREET; });
  for (const a of GEO_STREET_AREAS) if (a.hole) r.fill(a.pts, (k) => { if (r.grid[k] === STREET) r.grid[k] = FREE; });
  // Largest first, so a cell drawn inside another owns its own ground.
  [...parcels.keys()].sort((a, b) => parcels[b].a - parcels[a].a).forEach((n) => r.fill(parcels[n].pts, (k) => {
    if (r.grid[k] === FREE || r.grid[k] === STREET) { r.parcel[k] = n + 1; r.grid[k] = FREE; }
  }));
  // The squares the plan draws as wide parts of its lane spaces are street ground.
  parcels.forEach((p, n) => { if (p.sq) r.fill(p.pts, (k) => { if (r.parcel[k] === n + 1) { r.parcel[k] = 0; r.grid[k] = STREET; } }); });
  // Slivers between simplified outlines: street ground where they touch a lane, else left free.
  for (let k = 0; k < r.grid.length; k++) if (r.grid[k] === FREE && !r.parcel[k]) r.grid[k] = STREET;

  // 3. Landmark precincts are kept clear (their modules build them); the forum is an open square.
  for (const s of Object.values(SITES)) {
    if (!s.clear && !s.reserve) continue;
    const square = s.id === 'forum' || !!s.square;
    const poly: P2[] = s.reserve ? s.reserve.map(([lx, lz]) => siteToWorld(s, lx, lz))
      : Array.from({ length: 20 }, (_, i) => [s.x + Math.cos((i / 20) * Math.PI * 2) * s.clear!, s.z + Math.sin((i / 20) * Math.PI * 2) * s.clear!] as P2);
    r.fill(poly, (k) => { if (r.grid[k] !== OUTSIDE) r.grid[k] = square ? STREET : RESERVED; });
    if (square) lay.squares.push({ x: s.x, z: s.z, r: s.clear! });
  }
  // Landmarks with their own floor (a church, a chapel) take the ground of the cells they stand on.
  for (const s of Object.values(SITES)) for (const f of s.floors ?? []) {
    const poly = f.map(([lx, lz]) => siteToWorld(s, lx, lz));
    r.fill(poly, (k) => { if (r.grid[k] !== OUTSIDE) r.grid[k] = RESERVED; });
  }

  // 4. Lanes: the plan's centre lines (for walkers, worn ground and the arches over them),
  //    the decumanus along them, and the gates' ways in. None of them cuts a drawn footprint.
  const paint = (s: Street) => {
    for (let k = 0; k < s.pts.length - 1; k++) {
      const a = s.pts[k], b = s.pts[k + 1];
      const rad = s.w / 2 + 0.6;
      for (let z = Math.min(a.y, b.y) - rad; z <= Math.max(a.y, b.y) + rad; z += r.res) {
        for (let x = Math.min(a.x, b.x) - rad; x <= Math.max(a.x, b.x) + rad; x += r.res) {
          const kk = r.idx(x, z);
          if (kk < 0) continue;
          const d = distSeg(V(x, z), a, b);
          if (d < s.w / 2 && r.grid[kk] !== OUTSIDE && r.grid[kk] !== RESERVED && !r.parcel[kk]) {
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
    paint(s);
  }
  for (const g of GEO_STREETS) {
    if (!g.in) continue;
    const pts = g.pts.map(([x, z]) => V(x, z));
    if (lengthOf(pts) < 3) continue;
    const w = Math.max(1.2, g.w);
    const s: Street = { pts, w, main: g.main, kind: 'lane', plan: true };
    lay.streets.push(s);
    if (g.w >= 7.5 && lengthOf(pts) > 6) { const m = along(pts, lengthOf(pts) / 2)!; lay.squares.push({ x: m.p.x, z: m.p.y, r: g.w / 2 }); }
  }
  // Gates: a short way inside each, to the nearest lane.
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
      lay.streets.push(s); paint(s);
    }
  }
  // The open squares the plan draws: wells and a little room kept clear.
  parcels.forEach((p) => {
    if (!p.sq || p.a < 120) return;
    let cx = 0, cz = 0;
    for (const [x, z] of p.pts) { cx += x / p.pts.length; cz += z / p.pts.length; }
    if (inPoly(cx, cz, p.pts)) lay.squares.push({ x: cx, z: cz, r: Math.min(12, Math.sqrt(p.a / Math.PI)) });
  });

  // 5. Each cell as the plan draws it.
  const STREET_AT = (x: number, z: number) => r.at(x, z) === STREET;
  const widthAt = (p: V2, n: V2) => {
    let s0 = 0;
    while (s0 < 2.5) { const k = r.idx(p.x + n.x * (s0 + 0.25), p.y + n.y * (s0 + 0.25)); if (k >= 0 && r.grid[k] === STREET) break; s0 += 0.25; }
    if (s0 >= 2.5) return 0;
    let w = 0;
    while (w < 16) { const k = r.idx(p.x + n.x * (s0 + w + 0.25), p.y + n.y * (s0 + w + 0.25)); if (k < 0 || r.grid[k] !== STREET) break; w += 0.5; }
    return Math.min(12, s0 + w);
  };
  let lotId = 0;
  const reservedShare = (pts: P2[]) => {
    let tot = 0, res = 0;
    r.fill(pts, (k) => { tot++; if (r.grid[k] === RESERVED) res++; });
    return tot ? res / tot : 1;
  };
  // Houses first (their raster marks decide which garden edges face a street).
  parcels.forEach((p, n) => {
    const pid = n + 1;
    if (p.k !== 'house') return;
    // A landmark precinct or the curtain band takes most of it: the landmark stands here.
    if (reservedShare(p.pts) > 0.3) return;
    let pts = p.pts.map(([x, z]) => V(x, z));
    for (const tol of [0.3, 0.5, 0.75, 1.0, 1.4]) { pts = simplifyRing(p.pts.map(([x, z]) => V(x, z)), tol); if (pts.length <= 12) break; }
    if (pts.length < 3 || areaOf(pts) < 5) return;
    r.fill(p.pts, (kk) => { if (r.grid[kk] !== OUTSIDE && r.grid[kk] !== RESERVED) r.grid[kk] = HOUSE; });
    const h0 = density(pts[0].x, pts[0].y), A = areaOf(pts);
    // Height: sheds and back rooms low, the larger houses of two storeys, the greatest
    // footprints (halls, ranges) not taller for being larger.
    const hs = A < 25 ? R(3, 4.8) : A < 60 ? R(4, 7.5) : R(5, 10) * (0.8 + 0.3 * h0);
    // The front: the longest side with a lane before it; it becomes edge 0→1.
    let fk = -1, fl = 0, fout = V(0, 0);
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], L = a.distanceTo(b);
      if (L < 2.4 || L <= fl) continue;
      const e = b.clone().sub(a).normalize(), m = a.clone().add(b).multiplyScalar(0.5);
      for (const sd of [-1, 1]) {
        const o = V(-e.y * sd, e.x * sd);
        if (STREET_AT(m.x + o.x * 1.3, m.y + o.y * 1.3) && inPoly(m.x - o.x * 0.6, m.y - o.y * 0.6, p.pts)) { fk = k; fl = L; fout = o; }
      }
    }
    if (fk < 0) { lay.lots.push({ id: lotId++, c: pts, h: hs, parcel: pid }); return; }
    const c = [...pts.slice(fk), ...pts.slice(0, fk)];
    const mid = c[0].clone().add(c[1]).multiplyScalar(0.5);
    const lot: TownLot = { id: lotId++, c, front: { a: c[0].clone(), b: c[1].clone(), out: fout }, h: Math.max(hs, R(4.5, 6)), street: Math.max(1.5, widthAt(mid, fout)), parcel: pid };
    // Along the decumanus the houses that mattered rise to two and three storeys.
    const km = r.idx(mid.x + fout.x * 2, mid.y + fout.y * 2);
    if (km >= 0 && r.main[km] > 0 && lot.h < 7.2 && rand() < 0.45) lot.h = R(7.2, 10.5);
    lay.lots.push(lot);
  });
  // Courtyards, gardens, pens and ruins: the courtyards are walled by the houses round them;
  // a garden's sides that face a lane or open ground get a rubble wall with a gate.
  parcels.forEach((p, n) => {
    if (p.k === 'house' || p.sq) return;
    if (reservedShare(p.pts) > 0.3) return;
    let cx = 0, cz = 0;
    for (const [x, z] of p.pts) { cx += x / p.pts.length; cz += z / p.pts.length; }
    let kind: PlotKind;
    if (p.k === 'court') kind = 'cortis';
    else {
      const v = rand();
      kind = v < 0.42 ? 'orto' : v < 0.56 ? 'vinea' : v < 0.74 ? 'pratum' : v < 0.88 ? 'ruina' : 'stabulum';
      if (p.a > 2500 && kind === 'stabulum') kind = 'pratum';
    }
    const ring = p.pts.map(([x, z]) => V(x, z));
    const pts = simplifyRing(ring, 0.5).map((q) => [q.x, q.y] as P2);
    const walls: number[] = [];
    if (p.k === 'open') for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.8) continue;
      const ex = (b[0] - a[0]) / L, ez = (b[1] - a[1]) / L;
      let out = 0, house = 0;
      for (const t of [0.2, 0.5, 0.8]) {
        const mx = a[0] + (b[0] - a[0]) * t, mz = a[1] + (b[1] - a[1]) * t;
        for (const sd of [-1, 1]) {
          const ox = -ez * sd, oz = ex * sd;
          if (inPoly(mx - ox * 0.8, mz - oz * 0.8, p.pts)) {
            const v = r.at(mx + ox * 1.2, mz + oz * 1.2);
            if (v === HOUSE || v === RESERVED || v === OUTSIDE) house++; else out++;
          }
        }
      }
      if (out >= 2) walls.push(k);
    }
    lay.plots.push({ pts, kind, seed: Math.floor(rand() * 1e9), cx, cz, walls: walls.length ? walls : undefined });
    r.fill(p.pts, (kk) => { if (r.grid[kk] === FREE) r.grid[kk] = PLOT; });
    void n;
  });
  // What is left free inside a cell (the edge of a landmark's precinct) is open ground.
  for (let k = 0; k < r.grid.length; k++) if (r.grid[k] === FREE) r.grid[k] = PLOT;

  // 6. Houses one can enter. The interior is a rectangle on the house's drawn front, as deep as
  //    the drawn footprint allows; whatever of the footprint lies behind it stays a building of
  //    its own (a back room against the rear wall). Footprints these two pieces cover to >= 90%
  //    are preferred, so the house one enters stands on its drawn outline.
  const nearRing = (x: number, z: number, c: V2[], tol: number) => {
    const P: P2[] = c.map((p) => [p.x, p.y]);
    if (inPoly(x, z, P)) return true;
    return distPolyline(x, z, P, true) < tol;
  };
  /** The part of ring c beyond the line through o with normal n (Sutherland-Hodgman). */
  const clipBeyond = (c: V2[], o: V2, n: V2): V2[] => {
    const out: V2[] = [], f = (p: V2) => p.clone().sub(o).dot(n);
    for (let k = 0; k < c.length; k++) {
      const a = c[k], b = c[(k + 1) % c.length], fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a.clone());
      if ((fa >= 0) !== (fb >= 0)) out.push(a.clone().lerp(b, fa / (fa - fb)));
    }
    return out;
  };
  const quadOf = (l: TownLot, minCover: number): { c: V2[]; back: V2[] } | null => {
    if (!l.front) return null;
    const A = l.front.a, B = l.front.b, inn = l.front.out.clone().negate();
    const L0 = A.distanceTo(B), e = B.clone().sub(A).divideScalar(L0), total = areaOf(l.c);
    let best: { c: V2[]; back: V2[] } | null = null, bs = 0;
    for (const trim of [0, 0.06, 0.12, 0.2]) {
      const a = A.clone().addScaledVector(e, L0 * trim), b = B.clone().addScaledVector(e, -L0 * trim);
      const L = L0 * (1 - 2 * trim);
      let d = 0;
      for (let dd = 1; dd <= 16; dd += 0.25) {
        let ok = true;
        for (let u = 0; u <= 1.0001 && ok; u += 0.125) {
          const p = a.clone().lerp(b, u).addScaledVector(inn, dd);
          if (!nearRing(p.x, p.y, l.c, 0.45)) ok = false;
        }
        if (!ok) break;
        d = dd;
      }
      if (d < 4.2) continue;
      const c = [a, b, b.clone().addScaledVector(inn, d), a.clone().addScaledVector(inn, d)];
      const back = clipBeyond(l.c, c[3], inn);
      const ab = back.length >= 3 ? areaOf(back) : 0;
      const cover = (L * d + (ab >= 4 ? ab : 0)) / total;
      if (cover >= minCover && L * d > bs) { bs = L * d; best = { c, back: ab >= 4 ? back : [] }; }
    }
    return best;
  };
  const taken = new Set<number>();
  const pick = (near: P2, id: string, kind: ExploreKind) => {
    // A footprint the rectangle and its back room cover to 90% within 45 m; failing that the
    // nearest one they cover to 75% (the rest of the drawn outline stays unbuilt ground).
    return pickWith(near, id, kind, 0.9, 45) ?? pickWith(near, id, kind, 0.75, Infinity);
  };
  const pickWith = (near: P2, id: string, kind: ExploreKind, minCover: number, maxD: number) => {
    let best: { l: TownLot; c: V2[]; back: V2[] } | null = null, bd = maxD;
    for (const l of lay.lots) {
      if (taken.has(l.id) || l.explore) continue;
      if (!l.front || Math.hypot(l.front.a.x - near[0], l.front.a.y - near[1]) > bd + 30) continue;
      const q = quadOf(l, minCover);
      if (!q) continue;
      const c = q.c, w = c[0].distanceTo(c[1]), d = c[1].distanceTo(c[2]);
      if (w < 3.6 || d < 4.2 || w > 14 || d > 16) continue;
      const m = c[0].clone().add(c[2]).multiplyScalar(0.5);
      const dd = Math.hypot(m.x - near[0], m.y - near[1]);
      if (dd < bd) { bd = dd; best = { l, ...q }; }
    }
    if (!best) return null;
    const { l, c, back } = best;
    l.c = c;
    l.front = { a: c[0].clone(), b: c[1].clone(), out: l.front!.out.clone() };
    l.explore = { id, kind };
    l.h = Math.max(l.h, 5.2);
    taken.add(l.id);
    if (back.length >= 3) lay.lots.push({ id: lotId++, c: back, h: Math.max(3.4, l.h - R(0.5, 1.5)), parcel: l.parcel });
    return l;
  };
  for (const t of EXPLORE_TARGETS) pick(t.near, t.id, t.kind);
  for (const t of FIXED_EXPLORE_LOTS) {
    // A named site: a footprint close to it matters more than a tidy rectangle.
    const l = pickWith(t.near, t.id, t.kind, 0.9, 25) ?? pickWith(t.near, t.id, t.kind, 0.6, 30) ?? pick(t.near, t.id, t.kind);
    if (!l) throw new Error(`No drawn footprint for ${t.id}`);
    l.h = 4.2; // Modest worship-room elevation on the drawn footprint.
  }

  // 7. Pontili and flying arches where both sides of a lane are built.
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

  // 8. Wells in the open places and at some crossings of the busier quarters.
  for (const q of lay.squares) {
    if (q.r < 4 || density(q.x, q.z) < 0.3 || lay.wells.some((w) => Math.hypot(w.x - q.x, w.z - q.z) < 55)) continue;
    // Not in a landmark's square (the statue and the church stand there).
    if (Object.values(SITES).some((s) => s.square && Math.hypot(s.x - q.x, s.z - q.z) < (s.clear ?? 0) + 4)) continue;
    const x = q.x + R(-1.5, 1.5), z = q.z + R(-1.5, 1.5);
    if (r.at(x, z) !== STREET) continue;
    lay.wells.push({ x, z });
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

  // 9. Roads outside the walls.
  for (const rd of ROADS) lay.streets.push({ pts: rd.pts.map(([x, z]) => V(x, z)), w: rd.w, main: false, kind: 'road' });
  void BOUNDS; void distPolyline;
  return lay;
}
