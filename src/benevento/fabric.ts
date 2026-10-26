import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder, rng, DETAIL, type Lamp } from '../builder';
import type { MatName } from '../materials';
import type { FireSource } from '../fire';
import { buildHouse, buildBridge, reseedTown, type BridgeSpec, type Lot } from '../town';
import { reseedKit } from '../arch/kit';
import { planFront, frontColliders, sideLine } from '../arch/dress';
import { reseedShapes, ruin, arcadeGeo, archRings, quoinBox, pyramidRoof, wellHead, fallenDrum } from '../shapes';
import { fastTerrain } from '../displace';
import { torch, brazier } from '../lights';
import { WALL700, BOUNDS, insideness, type P2 } from './geo';
import { GATES, SITES, siteToWorld } from './sites';
import type { Layout, Plot, PlotKind } from './layout';
import { buildInterior, interiorCollider } from './interiors';

// The streamed fabric of the town: houses, lanes' bridges, garden plots,
// the curtain wall with its towers and gates, and the ground itself, cut
// into CHUNK-metre squares. Each chunk is built from plain data, so it can be
// built in a worker (render geometry) or on the main thread (collision only)
// with identical results: every piece reseeds the random streams from its own
// seed before it is built.

export const CHUNK = 32;
const V = (x: number, z: number) => new THREE.Vector2(x, z);

export interface LotData { c: P2[]; front?: { a: P2; b: P2; out: P2 }; h: number; street: number; seed: number; explore?: { id: string; kind: string };
  /** A tower house (taller, few openings, low hipped roof) or a roofless ruin; see lotForm(). */
  form?: 'tower' | 'ruin';
  /** Walls other than the front that stand on a lane (edge index, width of the lane): they get windows, doors and things against them. */
  side?: [number, number][] }

/**
 * The walls of a lot (other than its front) that stand on a lane: sampled
 * a metre out from three points along each, with the lane's width there.
 */
function streetSides(lay: Layout, c: THREE.Vector2[], front: boolean): [number, number][] | undefined {
  const r = lay.r, out: [number, number][] = [];
  let cx = 0, cz = 0;
  for (const p of c) { cx += p.x / c.length; cz += p.y / c.length; }
  for (let k = front ? 1 : 0; k < c.length; k++) {
    const a = c[k], b = c[(k + 1) % c.length], L = a.distanceTo(b);
    if (L < 2.4) continue;
    const ex = (b.x - a.x) / L, ez = (b.y - a.y) / L;
    let ox = -ez, oz = ex;
    if (ox * ((a.x + b.x) / 2 - cx) + oz * ((a.y + b.y) / 2 - cz) < 0) { ox = -ox; oz = -oz; }
    let hits = 0, w = 99;
    for (const t of [0.2, 0.5, 0.8]) {
      const px = a.x + (b.x - a.x) * t, pz = a.y + (b.y - a.y) * t;
      if (r.at(px + ox * 1.0, pz + oz * 1.0) !== STREET_CODE) continue;
      hits++;
      let d = 1.0;
      while (d < 9 && r.at(px + ox * (d + 0.25), pz + oz * (d + 0.25)) === STREET_CODE) d += 0.25;
      w = Math.min(w, d);
    }
    if (hits >= 2) out.push([k, Math.round(w * 4) / 4]);
  }
  return out.length ? out : undefined;
}
const STREET_CODE = 1; // layout.ts STREET

/**
 * Some houses are not like the rest: here and there a back building has
 * fallen in (roofless walls, weeds; a town of 700 was full of them), and
 * near the duke's curtis and along the main street a few of the households
 * that mattered built high (a tower house: an inference, see
 * docs/benevento/ARCHITECTURE.md). Pure function of the lot.
 */
export function lotForm(c: P2[], front: boolean, seed: number): { form?: 'tower' | 'ruin'; h?: number } {
  const r = rng(seed * 3 + 17);
  const u = r(), v = r();
  let area = 0, cx = 0, cz = 0;
  for (let k = 0; k < c.length; k++) { const a = c[k], q = c[(k + 1) % c.length]; area += a[0] * q[1] - q[0] * a[1]; cx += a[0] / c.length; cz += a[1] / c.length; }
  area = Math.abs(area) / 2;
  const nearCurtis = Math.hypot(cx - SITES.curtis.x, cz - SITES.curtis.z) < 170;
  if (area > 14 && area < 60 && c.length === 4 && u < (nearCurtis ? 0.07 : 0.012)) return { form: 'tower', h: 12.5 + v * 4.5 };
  if (!front && area > 12 && u > 0.965) return { form: 'ruin', h: 1.8 + v * 2.6 };
  return {};
}
export interface WallPiece { a: P2; b: P2; out: P2; h: number; seed: number }
export interface TowerSpec { x: number; z: number; ox: number; oz: number; kind: 0 | 1 | 2; h: number; seed: number; roof: boolean; torch: boolean }
export interface GateSpec { id: string; x: number; z: number; dx: number; dz: number; main: boolean; seed: number }
export interface PlotData { pts: P2[]; kind: PlotKind; seed: number }
export interface Hole { pts: P2[] }
export interface WellSpec { x: number; z: number; seed: number }
export interface ChunkItems {
  key: number; i: number; j: number;
  lots: LotData[]; bridges: (BridgeSpec & { seed: number })[]; plots: PlotData[]; wells: WellSpec[];
  walls: WallPiece[]; towers: TowerSpec[]; gates: GateSpec[];
  holes: Hole[];
  /** House footprint mask for the ground (CHUNK/0.5 square, 1 = under a house). */
  mask?: Uint8Array;
  /** (while building the masks) landmark floors over this chunk. */
  floors?: P2[][]; floorMask?: Uint8Array;
}
export const chunkKey = (i: number, j: number) => (i + 2048) * 4096 + (j + 2048);

// ---------------------------------------------------------------- the curtain
const GATE_GAP: Record<string, number> = { aurea: 4.8, sacramenti: 3.8 };
export function wallPlan() {
  const pieces: WallPiece[] = [], towers: TowerSpec[] = [], gates: GateSpec[] = [];
  const W = WALL700, n = W.length;
  const rand = rng(6060);
  const R = (a: number, b: number) => a + (b - a) * rand();
  // Gate positions along the perimeter.
  const gaps: { s: number; half: number; id: string }[] = [];
  const cum: number[] = [0];
  for (let k = 0; k < n; k++) cum.push(cum[k] + Math.hypot(W[(k + 1) % n][0] - W[k][0], W[(k + 1) % n][1] - W[k][1]));
  const perim = cum[n];
  const at = (s: number): { p: P2; d: P2 } => {
    s = ((s % perim) + perim) % perim;
    let k = 0;
    while (k < n - 1 && cum[k + 1] < s) k++;
    const a = W[k], b = W[(k + 1) % n], L = cum[k + 1] - cum[k] || 1, t = (s - cum[k]) / L;
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
  };
  const outward = (p: P2, d: P2): P2 => {
    const nrm: P2 = [-d[1], d[0]];
    return insideness(p[0] + nrm[0] * 6, p[1] + nrm[1] * 6) < 0.5 ? nrm : [-nrm[0], -nrm[1]];
  };
  for (const g of GATES) {
    // Arc-length position of the gate on the circuit.
    let best = { s: 0, d: Infinity };
    for (let k = 0; k < n; k++) {
      const a = W[k], b = W[(k + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((g.at[0] - a[0]) * dx + (g.at[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(a[0] + dx * t - g.at[0], a[1] + dz * t - g.at[1]);
      if (d < best.d) best = { s: cum[k] + t * (cum[k + 1] - cum[k]), d };
    }
    const half = GATE_GAP[g.id] ?? (g.kind === 'postern' ? 1.2 : g.main ? 2.9 : 2.0);
    gaps.push({ s: best.s, half, id: g.id });
    if (g.kind !== 'arch') {
      const q = at(best.s);
      gates.push({ id: g.id, x: q.p[0], z: q.p[1], dx: q.d[0], dz: q.d[1], main: g.main, seed: Math.floor(rand() * 1e9) });
    }
  }
  const inGap = (s: number, m = 0) => gaps.some((g) => Math.abs(((s - g.s + perim / 2) % perim + perim) % perim - perim / 2) < g.half + m);
  // Curtain pieces of ~10 m, broken at the gates.
  const STEP = 10;
  for (let s = 0; s < perim; s += STEP) {
    let s0 = s, s1 = Math.min(s + STEP, perim);
    for (const g of gaps) {
      const a = g.s - g.half, b = g.s + g.half;
      if (s1 > a && s0 < b) { if (s0 >= a) s0 = Math.max(s0, b); else s1 = Math.min(s1, a); }
    }
    if (s1 - s0 < 0.6 || inGap((s0 + s1) / 2)) continue;
    const A = at(s0), B = at(s1);
    pieces.push({ a: A.p, b: B.p, out: outward(A.p, A.d), h: R(8.6, 11.2), seed: Math.floor(rand() * 1e9) });
  }
  // Towers every 40-55 m, square or round, a few reduced to stumps.
  for (let s = 18; s < perim; s += R(40, 55)) {
    if (inGap(s, 10)) continue;
    const q = at(s), o = outward(q.p, q.d);
    const u = rand();
    towers.push({ x: q.p[0], z: q.p[1], ox: o[0], oz: o[1], kind: u < 0.52 ? 0 : u < 0.88 ? 1 : 2, h: R(12, 15), seed: Math.floor(rand() * 1e9), roof: rand() < 0.45, torch: rand() < 0.3 });
  }
  return { pieces, towers, gates, perim };
}

function curtain(b: Builder, w: WallPiece) {
  reseedShapes(w.seed); reseedKit(w.seed + 1);
  const rand = rng(w.seed + 2);
  const [ax, az] = w.a, [bx, bz] = w.b;
  const L = Math.hypot(bx - ax, bz - az);
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const ry = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
  const T = 2.5;
  // Opus incertum of river stone and Roman rubble, refaced above; big spoil
  // blocks from the amphitheatre and the old tombs in the footing.
  ruin(b, 'rubble', L + 0.5, w.h, T, mx, -1.2, mz, ry, 0.07);
  if (b.mode === 'collide') return;
  const ox = w.out[0], oz = w.out[1];
  b.box('bigstone', L + 0.2, 1.3 + rand() * 0.6, 0.6, mx + ox * (T / 2 + 0.1), -1.0, mz + oz * (T / 2 + 0.1), ry, false);
  // Spolia set into the outer face: a marble block, an inscribed slab, a column drum.
  if (rand() < 0.45) {
    const t = rand() - 0.5, y = 1 + rand() * 4;
    b.box('marble', 0.8 + rand() * 0.9, 0.5 + rand() * 0.4, 0.5, mx + (bx - ax) * t * 0.8 + ox * (T / 2 + 0.05), y, mz + (bz - az) * t * 0.8 + oz * (T / 2 + 0.05), ry, false);
  }
  // Brick patching and a darker, newer course along the top.
  if (rand() < 0.4) b.box('brick', L * (0.3 + rand() * 0.4), 1.2, 0.4, mx + ox * (T / 2 + 0.02), w.h * 0.55, mz + oz * (T / 2 + 0.02), ry, false);
}

function tower(b: Builder, t: TowerSpec) {
  reseedShapes(t.seed); reseedKit(t.seed + 1);
  const rand = rng(t.seed + 2);
  const cx = t.x + t.ox * 2.4, cz = t.z + t.oz * 2.4;
  const ry = Math.atan2(t.ox, t.oz);
  if (t.kind === 0) {
    const w = 5.6 + rand(), d = 5.6 + rand();
    b.box('rubble', w, t.h, d, cx, -1.2, cz, ry);
    if (b.mode === 'collide') return;
    quoinBox(b, 'block', w, t.h * 0.85, d, cx, -1.2, cz, ry);
    for (const y of [3.5, 7.5, 11]) if (y < t.h - 1) b.box('iron', 0.35, 1.0, d + 0.1, cx, y, cz, ry, false);
    if (t.roof) pyramidRoof(b, w + 0.6, 1.8, cx, t.h - 1.25, cz);
    else ruin(b, 'rubble', w, 1.6, d, cx, t.h - 1.25, cz, ry, 0.8);
  } else if (t.kind === 1) {
    const r = 3.2 + rand() * 0.8;
    b.geo('rubble', new THREE.CylinderGeometry(r, r * 1.06, t.h, 28, 1), cx, t.h / 2 - 1.2, cz);
    if (b.mode === 'collide') return;
    b.geo('bigstone', new THREE.CylinderGeometry(r * 1.08, r * 1.1, 1.6, 28, 1), cx, -0.4, cz, 0, false);
    ruin(b, 'rubble', r * 1.5, 1.8, r * 1.5, cx, t.h - 1.3, cz, ry, 0.85);
  } else {
    b.geo('rubble', new THREE.CylinderGeometry(3.5, 3.9, 3.5, 22, 1), cx, 0.55, cz);
  }
  if (t.torch && b.mode !== 'collide') torch(b, t.x - t.ox * 1.6, 3.0, t.z - t.oz * 1.6, Math.atan2(-t.ox, -t.oz));
}

function gateway(b: Builder, g: GateSpec) {
  reseedShapes(g.seed); reseedKit(g.seed + 1);
  const span = g.main ? 4.6 : 3.4, open = g.main ? 3.4 : 2.4, spring = g.main ? 3.4 : 2.5;
  const ry = Math.atan2(-g.dz, g.dx);
  b.geo('rubble', arcadeGeo(span + 2.4, g.main ? 10 : 7.5, 3.0, 1, open, spring), g.x, -0.8, g.z, ry);
  if (b.mode === 'collide') return;
  archRings(b, g.main ? 'bigstone' : 'block', g.x, -0.8, g.z, ry, 3.0, open, spring + 0.8, g.main ? 0.6 : 0.45, g.main ? 0.34 : 0.26);
  // Iron-strapped leaves stand open against the reveal.
  const nx = -g.dz, nz = g.dx;
  b.box('wood', 0.12, spring + 0.6, open / 2, g.x + nx * 1.2 + g.dx * (open / 2 - 0.05), -0.2, g.z + nz * 1.2 + g.dz * (open / 2 - 0.05), ry + Math.PI / 2 + 0.4, false);
  torch(b, g.x + nx * 1.9 + g.dx * (span / 2 + 0.4), 3.0, g.z + nz * 1.9 + g.dz * (span / 2 + 0.4), Math.atan2(nx, nz));
  if (g.main) brazier(b, g.x - nx * 4.5 + g.dx * 2.2, g.z - nz * 4.5 + g.dz * 2.2);
}

// ---------------------------------------------------------------- gardens, vines, pens, ruins
function plot(b: Builder, p: PlotData) {
  reseedShapes(p.seed); reseedKit(p.seed + 1);
  const rand = rng(p.seed + 2);
  const R = (a: number, c: number) => a + (c - a) * rand();
  const P = p.pts;
  let cx = 0, cz = 0;
  for (const [x, z] of P) { cx += x / P.length; cz += z / P.length; }
  const fence = p.kind === 'orto' || p.kind === 'stabulum' || p.kind === 'vinea';
  if (fence) {
    // Wattle on stakes, set a little inside the plot edge, with gaps for gates.
    for (let k = 0; k < P.length; k++) {
      const a = P[k], c = P[(k + 1) % P.length];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 1.2) continue;
      const gap = rand() < 0.5 || k === 0 ? R(0.2, 0.7) : -1;
      const ry = Math.atan2(c[0] - a[0], c[1] - a[1]) - Math.PI / 2;
      const ix = (cx - (a[0] + c[0]) / 2), iz = (cz - (a[1] + c[1]) / 2), il = Math.hypot(ix, iz) || 1;
      const off = 0.6;
      const seg = (t0: number, t1: number) => {
        if (t1 - t0 < 0.05) return;
        const len = (t1 - t0) * L, tm = (t0 + t1) / 2;
        const x = a[0] + (c[0] - a[0]) * tm + (ix / il) * off, z = a[1] + (c[1] - a[1]) * tm + (iz / il) * off;
        const h = p.kind === 'stabulum' ? 1.15 : 0.9;
        b.box('wood', len, h, 0.09, x, -0.1, z, ry, true, 0, R(-0.04, 0.04));
        if (b.mode === 'collide') return;
        for (let s = 0; s <= len; s += R(1.1, 1.6)) {
          const t = t0 + (s / L);
          b.box('wood', 0.07, h + 0.25, 0.07, a[0] + (c[0] - a[0]) * t + (ix / il) * off, -0.2, a[1] + (c[1] - a[1]) * t + (iz / il) * off, R(0, 3), false, R(-0.08, 0.08), R(-0.08, 0.08));
        }
      };
      if (gap > 0 && L > 3) { const gw = 1.4 / L; seg(0, gap - gw / 2); seg(gap + gw / 2, 1); } else seg(0, 1);
    }
  }
  if (p.kind === 'cortis') { yardWalls(b, p); yardThings(b, p); }
  if (p.kind === 'hortulus') { yardWalls(b, p, true); if (b.mode !== 'collide') hortulus(b, p); return; }
  if (p.kind === 'orto' || p.kind === 'stabulum') yardThings(b, p);
  if (b.mode === 'collide' && p.kind !== 'ruina') return;
  // Interior: rows of beds in the gardens, vine stakes, a shed in the pens,
  // Roman walls and fallen drums among weeds in the ruins.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const inside = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[i], q = P[j];
      if ((a[1] > z) !== (q[1] > z) && x < ((q[0] - a[0]) * (z - a[1])) / (q[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const ang = R(0, Math.PI), ca = Math.cos(ang), sa = Math.sin(ang);
  if (p.kind === 'orto') {
    for (let u = -60; u < 60; u += 1.6) {
      // Beds along one direction across the plot.
      let run: number[] = [];
      for (let v = -60; v <= 60; v += 1.0) {
        const x = cx + ca * u - sa * v, z = cz + sa * u + ca * v;
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        if (inside(x, z) && inside(x + ca * 0.9, z + sa * 0.9) && inside(x - ca * 0.9, z - sa * 0.9)) run.push(v);
        else if (run.length) { bed(run); run = []; }
      }
      if (run.length) bed(run);
      function bed(r: number[]) {
        if (r.length < 2) return;
        const v0 = r[0] + 0.5, v1 = r[r.length - 1] - 0.5, vm = (v0 + v1) / 2;
        const x = cx + ca * u - sa * vm, z = cz + sa * u + ca * vm;
        b.box('ground', 0.85, 0.18, v1 - v0, x, -0.08, z, -ang, false);
      }
    }
  } else if (p.kind === 'vinea') {
    for (let u = -60; u < 60; u += 1.9) for (let v = -60; v <= 60; v += 1.3) {
      const x = cx + ca * u - sa * v, z = cz + sa * u + ca * v;
      if (x < x0 || x > x1 || z < z0 || z > z1 || !inside(x, z)) continue;
      b.box('wood', 0.06, R(1.2, 1.6), 0.06, x, -0.1, z, R(0, 3), false, R(-0.1, 0.1), R(-0.1, 0.1));
    }
  } else if (p.kind === 'stabulum') {
    // A lean-to shed of planks against one side.
    const a = P[0], c = P[1 % P.length];
    const mx = (a[0] + c[0]) / 2 + (cx - (a[0] + c[0]) / 2) * 0.25, mz = (a[1] + c[1]) / 2 + (cz - (a[1] + c[1]) / 2) * 0.25;
    const ry = Math.atan2(c[0] - a[0], c[1] - a[1]) - Math.PI / 2;
    b.box('wood', 3.2, 2.0, 0.1, mx, -0.1, mz, ry);
    b.box('roof', 3.6, 0.08, 2.2, mx + Math.cos(ry) * 0 + (cx - mx) * 0.1, 2.0, mz + (cz - mz) * 0.1, ry, false, 0.25);
  } else if (p.kind === 'ruina') {
    // Walls of a Roman house still standing to a few metres, its rooms full of weeds.
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const x = R(x0 + 2, x1 - 2), z = R(z0 + 2, z1 - 2);
      if (!inside(x, z)) continue;
      ruin(b, rand() < 0.5 ? 'brick' : 'rubble', R(3, 8), R(1.2, 4.2), 0.6, x, -0.3, z, ang + (rand() < 0.5 ? 0 : Math.PI / 2), 0.7);
    }
    if (b.mode !== 'collide' && rand() < 0.6) {
      const x = R(x0 + 2, x1 - 2), z = R(z0 + 2, z1 - 2);
      if (inside(x, z)) fallenDrum(b, x, z, R(0.3, 0.45), R(0.8, 2), R(0, 3));
    }
  }
}

/** A plain box (12 triangles, not tessellated): the yard and garden walls are many and low. */
function flat(b: Builder, m: MatName, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, collide = true, rx = 0, rz = 0) {
  b.geo(m, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry, collide, rx, rz, true);
}
/**
 * A walled yard in front of a house, taken out of the old street (layout.ts §7b): pts are
 * [street-left, street-right, house-right, house-left]. Rubble walls a little over head height on
 * the street and the two sides, the gate in the street wall (a plank leaf standing open, now and
 * then a tiled coping over it); the house's own front closes the fourth side.
 */
function yardWalls(b: Builder, p: PlotData, all = false) {
  const r = rng(p.seed * 7 + 3);
  const P = p.pts, T = 0.45;
  const h = 1.9 + r() * 0.7;
  let cx = 0, cz = 0;
  for (const [x, z] of P) { cx += x / 4; cz += z / 4; }
  for (const k of all ? [0, 1, 2, 3] : [0, 1, 3]) {
    const a = P[k], c = P[(k + 1) % 4];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 0.6) continue;
    const ry = Math.atan2(c[0] - a[0], c[1] - a[1]) - Math.PI / 2;
    // Set the wall inside the yard's edge by half its thickness.
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2, il = Math.hypot(cx - mx, cz - mz) || 1;
    const ox = ((cx - mx) / il) * T / 2, oz = ((cz - mz) / il) * T / 2;
    const seg = (t0: number, t1: number) => {
      if (t1 - t0 < 0.05) return;
      const tm = (t0 + t1) / 2;
      const hh = h * (k === 0 ? 1 : 0.92);
      flat(b, 'rubble', (t1 - t0) * L, hh, T, a[0] + (c[0] - a[0]) * tm + ox, -0.3, a[1] + (c[1] - a[1]) * tm + oz, ry);
      if (b.mode === 'collide') return;
      // A coping of flat stones.
      flat(b, 'slab', (t1 - t0) * L + 0.05, 0.08, T + 0.1, a[0] + (c[0] - a[0]) * tm + ox, hh - 0.3, a[1] + (c[1] - a[1]) * tm + oz, ry, false);
    };
    if (k === 0 && L > 2.2) {
      // The gate: 1.2 m, somewhere along the street wall.
      const g = 1.2 / L, t = g / 2 + 0.1 / L + r() * Math.max(0, 1 - g - 0.2 / L);
      seg(0, t - g / 2); seg(t + g / 2, 1);
      if (b.mode === 'collide') continue;
      // One leaf standing open into the yard.
      const hx = a[0] + (c[0] - a[0]) * (t - g / 2), hz = a[1] + (c[1] - a[1]) * (t - g / 2);
      flat(b, 'wood', 1.15, 1.75, 0.07, hx + ox * 2 + (cx - mx) / il * 0.5, -0.2, hz + oz * 2 + (cz - mz) / il * 0.5, ry + Math.PI / 2 - 0.3 + r() * 0.3, false);
    } else seg(0, 1);
  }
}

/**
 * Inside a little walled garden taken out of a wide street (layout.ts §7b): beds of greens, or a
 * pen's trodden floor with a manger; boxes only.
 */
function hortulus(b: Builder, p: PlotData) {
  const r = rng(p.seed * 3 + 11);
  const [a, c, , d] = p.pts;
  const ex = [c[0] - a[0], c[1] - a[1]], ez = [d[0] - a[0], d[1] - a[1]];
  const L = Math.hypot(ex[0], ex[1]), W = Math.hypot(ez[0], ez[1]);
  const ry = Math.atan2(ex[0], ex[1]) - Math.PI / 2;
  const at = (u: number, w: number): P2 => [a[0] + (ex[0] * u) / L + (ez[0] * w) / W, a[1] + (ex[1] * u) / L + (ez[1] * w) / W];
  if (r() < 0.65) {
    for (let w = 1.2; w < W - 0.8; w += 1.1) {
      const [x, z] = at(L / 2, w);
      flat(b, 'ground', Math.max(0.5, L - 1.6), 0.16, 0.7, x, -0.08, z, ry, false);
    }
  } else {
    const [x, z] = at(L * 0.3, W - 0.9);
    flat(b, 'wood', 1.6, 0.5, 0.5, x, 0.1, z, ry, false);
    flat(b, 'wood', 0.08, 0.6, 0.08, x - 0.7, -0.1, z, ry, false);
  }
}

/**
 * In a garden or a pen, now and then a bread oven (a dome of rubble on a
 * square base, its mouth black with soot) and a woodpile beside it: the
 * household ovens of the excavated early-medieval yards. Own random stream.
 */
function yardThings(b: Builder, p: PlotData) {
  const r = rng(p.seed * 5 + 31);
  if (r() > 0.4) return;
  const P = p.pts;
  let cx = 0, cz = 0;
  for (const [x, z] of P) { cx += x / P.length; cz += z / P.length; }
  const inPoly = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
    return c;
  };
  // Towards an edge (ovens stood against a yard wall), but well inside.
  const k = Math.floor(r() * P.length), a = P[k], c = P[(k + 1) % P.length];
  const t = 0.3 + r() * 0.4;
  const ex = a[0] + (c[0] - a[0]) * t, ez = a[1] + (c[1] - a[1]) * t;
  const dx = cx - ex, dz = cz - ez, dl = Math.hypot(dx, dz) || 1;
  const x = ex + (dx / dl) * 2.2, z = ez + (dz / dl) * 2.2;
  const ok = [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].every(([ox, oz]) => inPoly(x + ox, z + oz));
  if (!ok) return;
  const ry = Math.atan2(dx, dz); // mouth towards the middle of the yard
  const w = 1.5 + r() * 0.4;
  b.box('rubble', w, 0.75, w, x, -0.2, z, ry);
  if (b.mode === 'collide') return;
  const dome = new THREE.SphereGeometry(w * 0.48, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.8, 1);
  b.geo('rubble', dome, x, 0.5, z, ry, false);
  // The mouth: a soot-black arch on the front, a slab before it.
  const fx = Math.sin(ry), fz = Math.cos(ry);
  b.box('iron', 0.42, 0.42, 0.06, x + fx * (w * 0.47), 0.48, z + fz * (w * 0.47), ry, false);
  b.box('slab', 0.7, 0.06, 0.4, x + fx * (w * 0.5 + 0.15), 0.5, z + fz * (w * 0.5 + 0.15), ry, false);
  // Woodpile beside it.
  const sx = Math.cos(ry), sz = -Math.sin(ry);
  for (let i = 0; i < 9; i++) {
    const row = Math.floor(i / 3), col = i % 3;
    b.box('wood', 0.9 + r() * 0.2, 0.13, 0.13, x + sx * (w * 0.5 + 0.7) + fx * (col * 0.15 - 0.15), -0.15 + row * 0.13, z + sz * (w * 0.5 + 0.7) + fz * (col * 0.15 - 0.15), ry + Math.PI / 2 + (r() - 0.5) * 0.1, false);
  }
}

// ---------------------------------------------------------------- the ground
const GSTEP = 0.64;
function ground(b: Builder, it: ChunkItems) {
  const x0 = it.i * CHUNK, z0 = it.j * CHUNK, n = Math.round(CHUNK / (DETAIL.mid ? 2 : GSTEP));
  const st = CHUNK / n;
  const pos = new Float32Array((n + 1) * (n + 1) * 3), nor = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j * (n + 1) + i) * 3;
    pos[k] = x0 + i * st; pos[k + 1] = 0; pos[k + 2] = z0 + j * st; nor[k + 1] = 1;
  }
  const inHole = (x: number, z: number) => it.holes.some((h) => {
    let c = false;
    const P = h.pts;
    for (let a = 0, q = P.length - 1; a < P.length; q = a++) if ((P[a][1] > z) !== (P[q][1] > z) && x < ((P[q][0] - P[a][0]) * (z - P[a][1])) / (P[q][1] - P[a][1]) + P[a][0]) c = !c;
    return c;
  });
  const wells = it.wells.map((w) => ({ x: w.x, z: w.z, r: (0.55 + 0.95) / 2 }));
  const inWell = (x: number, z: number) => wells.some((w) => Math.hypot(x - w.x, z - w.z) < w.r);
  const MR = CHUNK / 0.5;
  const masked = (x: number, z: number) => {
    if (!it.mask) return false;
    const i = Math.floor((x - x0) / 0.5), j = Math.floor((z - z0) / 0.5);
    // A quad is hidden only if it is well inside a house (all four corners).
    const m = (a: number, c: number) => a >= 0 && c >= 0 && a < MR && c < MR && it.mask![c * MR + a] === 1;
    return m(i - 1, j - 1) && m(i + 1, j - 1) && m(i - 1, j + 1) && m(i + 1, j + 1);
  };
  const idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const cx = x0 + (i + 0.5) * st, cz = z0 + (j + 0.5) * st;
    if (inHole(cx, cz) || inWell(cx, cz) || masked(cx, cz)) continue;
    const a = j * (n + 1) + i, c = a + 1, d = a + n + 1, e = d + 1;
    idx.push(a, d, c, c, d, e);
  }
  if (!idx.length) return;
  // Snap the edge of each well's hole onto a circle hidden in its masonry.
  for (let k = 0; k < pos.length; k += 3) for (const w of wells) {
    const dx = pos[k] - w.x, dz = pos[k + 2] - w.z, d = Math.hypot(dx, dz);
    if (d < w.r && d > 1e-4) { pos[k] = w.x + (dx / d) * w.r; pos[k + 2] = w.z + (dz / d) * w.r; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  b.add(g, 'ground', undefined, false, true);
}

/** Sides of a prism over a polygon as a bare triangle soup (collision proxies). */
export function prismSoup(c: P2[], y0: number, y1: number) {
  const pos: number[] = [];
  for (let k = 0; k < c.length; k++) {
    const [ax, az] = c[k], [bx, bz] = c[(k + 1) % c.length];
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------------------------------------------------------------- one chunk
const toLot = (l: LotData): Lot => ({
  c: l.c.map(([x, z]) => V(x, z)), h: l.h, street: l.street, seed: l.seed, form: l.form, side: l.side,
  front: l.front ? { a: V(...l.front.a), b: V(...l.front.b), out: V(...l.front.out) } : undefined,
});
/** Build a chunk's content. In 'collide' mode only the cheap collision proxies are made. */
export function buildChunk(b: Builder, it: ChunkItems) {
  const coll = b.mode === 'collide';
  for (const l of it.lots) {
    reseedTown(l.seed); reseedKit(l.seed + 1); reseedShapes(l.seed + 2);
    if (l.explore) { if (coll) interiorCollider(b, l); else buildInterior(b, l); continue; }
    if (coll) {
      b.collideShape(prismSoup(l.c, -0.3, l.h), 'rubble');
      // Outside stairs (walkable), woodpiles and benches in the street.
      if (l.front) {
        const fr = { a: V(...l.front.a), b: V(...l.front.b), out: V(...l.front.out) };
        const g = frontColliders(fr, planFront(fr, l.street, l.h, l.seed));
        if (g) b.collideShape(g, 'rubble');
      }
      for (const [k, w] of l.side ?? []) {
        const fr = sideLine(l.c, k);
        const g = frontColliders(fr, planFront(fr, w, l.h, l.seed + k * 101, true));
        if (g) b.collideShape(g, 'rubble');
      }
      continue;
    }
    buildHouse(b, toLot(l));
  }
  if (!coll) for (const br of it.bridges) { reseedTown(br.seed); reseedKit(br.seed + 1); reseedShapes(br.seed + 2); buildBridge(b, br); }
  for (const p of it.plots) plot(b, p);
  for (const w of it.walls) curtain(b, w);
  for (const t of it.towers) tower(b, t);
  for (const g of it.gates) gateway(b, g);
  for (const w of it.wells) {
    reseedShapes(w.seed);
    wellHead(b, 'rubble', w.x, 0, w.z, 0.95, 0.85, 'stone');
  }
  if (!coll) ground(b, it);
}

/** Merge a render-mode Builder into one interleaved array per material (for transfer). */
export interface Baked { m: MatName; pos: Float32Array; nor: Int8Array }
export function bake(b: Builder): Baked[] {
  const out: Baked[] = [];
  for (const [m, geos] of b.parts) {
    if (!geos.length) continue;
    const g = geos.length === 1 ? geos[0] : mergeGeometries(geos.map((x) => { for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k); return x; }), false)!;
    const P = g.attributes.position.array as Float32Array, N = g.attributes.normal.array as Float32Array;
    const nor = new Int8Array(N.length);
    for (let i = 0; i < N.length; i++) nor[i] = Math.max(-127, Math.min(127, Math.round(N[i] * 127)));
    out.push({ m, pos: P instanceof Float32Array ? P : new Float32Array(P), nor });
  }
  return out;
}
export interface ChunkResult { key: number; baked: Baked[]; lamps: { p: number[]; c: number[]; i: number; under: boolean }[]; flames: { p: number[]; kind: string; scale: number; under: boolean }[]; ms: number }
export function packLights(lamps: Lamp[], flames: FireSource[]) {
  return {
    lamps: lamps.map((l) => ({ p: [l.pos.x, l.pos.y, l.pos.z], c: [l.color.r, l.color.g, l.color.b], i: l.intensity, under: l.under })),
    flames: flames.map((f) => ({ p: [f.pos.x, f.pos.y, f.pos.z], kind: f.kind as string, scale: f.scale ?? 1, under: !!f.under })),
  };
}

// ---------------------------------------------------------------- distributing the layout over chunks
export function makeChunks(lay: Layout, holes: Hole[]): Map<number, ChunkItems> {
  const map = new Map<number, ChunkItems>();
  const get = (x: number, z: number) => {
    const i = Math.floor(x / CHUNK), j = Math.floor(z / CHUNK), k = chunkKey(i, j);
    let c = map.get(k);
    if (!c) map.set(k, (c = { key: k, i, j, lots: [], bridges: [], plots: [], wells: [], walls: [], towers: [], gates: [], holes: [] }));
    return c;
  };
  // Every chunk of the world exists (for its ground), content or not.
  for (let i = Math.floor(BOUNDS.x0 / CHUNK); i < Math.ceil(BOUNDS.x1 / CHUNK); i++)
    for (let j = Math.floor(BOUNDS.z0 / CHUNK); j < Math.ceil(BOUNDS.z1 / CHUNK); j++) get(i * CHUNK + 1, j * CHUNK + 1);
  let seed = 1;
  for (const l of lay.lots) {
    const cx = (l.c[0].x + l.c[2].x) / 2, cz = (l.c[0].y + l.c[2].y) / 2;
    get(cx, cz).lots.push({
      c: l.c.map((p) => [p.x, p.y] as P2), h: l.h, street: l.street ?? 2, seed: 1000 + l.id * 7919,
      front: l.front ? { a: [l.front.a.x, l.front.a.y], b: [l.front.b.x, l.front.b.y], out: [l.front.out.x, l.front.out.y] } : undefined,
      explore: l.explore,
      side: l.explore ? undefined : streetSides(lay, l.c, !!l.front),
      ...(l.explore ? {} : lotForm(l.c.map((p) => [p.x, p.y] as P2), !!l.front, 1000 + l.id * 7919)),
    });
  }
  for (const br of lay.bridges) get(br.x, br.z).bridges.push({ ...br, seed: 50000 + seed++ * 104729 });
  for (const p of lay.plots) get(p.cx, p.cz).plots.push({ pts: p.pts, kind: p.kind, seed: p.seed });
  for (const w of lay.wells) get(w.x, w.z).wells.push({ x: w.x, z: w.z, seed: 70000 + seed++ * 31 });
  const wp = wallPlan();
  for (const p of wp.pieces) get((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2).walls.push(p);
  for (const t of wp.towers) get(t.x, t.z).towers.push(t);
  for (const g of wp.gates) get(g.x, g.z).gates.push(g);
  // Holes reach every chunk they overlap.
  for (const h of holes) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of h.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / CHUNK); i <= Math.floor(x1 / CHUNK); i++) for (let j = Math.floor(z0 / CHUNK); j <= Math.floor(z1 / CHUNK); j++) map.get(chunkKey(i, j))?.holes.push(h);
  }
  // Ground mask under houses (wells and holes stay open).
  const r = lay.r;
  // Landmarks with their own floors (a church's slabs lie a little below grade): no town ground over them.
  const floors: P2[][] = [];
  for (const s of Object.values(SITES)) for (const f of s.floors ?? []) floors.push(f.map(([lx, lz]) => siteToWorld(s, lx, lz)));
  for (const P of floors) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / CHUNK); i <= Math.floor(x1 / CHUNK); i++) for (let j = Math.floor(z0 / CHUNK); j <= Math.floor(z1 / CHUNK); j++) {
      const c = map.get(chunkKey(i, j));
      if (!c) continue;
      (c.floors ??= []).push(P);
    }
  }
  for (const c of map.values()) {
    if (c.floors) {
      const MR = CHUNK / 0.5, m = new Uint8Array(MR * MR);
      for (let j = 0; j < MR; j++) for (let i = 0; i < MR; i++) {
        const x = c.i * CHUNK + (i + 0.5) * 0.5, z = c.j * CHUNK + (j + 0.5) * 0.5;
        // A margin of a cell round the floor, so the ground's quads clear it.
        for (const P of c.floors) for (const [dx, dz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) {
          let ins = false;
          for (let a = 0, q = P.length - 1; a < P.length; q = a++) if ((P[a][1] > z + dz) !== (P[q][1] > z + dz) && x + dx < ((P[q][0] - P[a][0]) * (z + dz - P[a][1])) / (P[q][1] - P[a][1]) + P[a][0]) ins = !ins;
          if (ins) { m[j * MR + i] = 1; break; }
        }
      }
      c.floorMask = m;
    }
  }
  for (const c of map.values()) {
    if (!c.lots.length) continue;
    const MR = CHUNK / 0.5, m = new Uint8Array(MR * MR);
    for (let j = 0; j < MR; j++) for (let i = 0; i < MR; i++) {
      const x = c.i * CHUNK + (i + 0.5) * 0.5, z = c.j * CHUNK + (j + 0.5) * 0.5;
      if (r.at(x, z) === 3) m[j * MR + i] = 1;
    }
    // Explorable houses keep their floors.
    for (const l of c.lots) if (l.explore || l.form === 'ruin') {
      const P = l.c;
      for (let j = 0; j < MR; j++) for (let i = 0; i < MR; i++) {
        const x = c.i * CHUNK + (i + 0.5) * 0.5, z = c.j * CHUNK + (j + 0.5) * 0.5;
        let ins = false;
        for (let a = 0, q = P.length - 1; a < P.length; q = a++) if ((P[a][1] > z) !== (P[q][1] > z) && x < ((P[q][0] - P[a][0]) * (z - P[a][1])) / (P[q][1] - P[a][1]) + P[a][0]) ins = !ins;
        if (ins) m[j * MR + i] = 0;
      }
    }
    c.mask = m;
  }
  for (const c of map.values()) if (c.floorMask) {
    if (!c.mask) c.mask = c.floorMask;
    else for (let k = 0; k < c.mask.length; k++) c.mask[k] |= c.floorMask[k];
    delete c.floorMask; delete c.floors;
  }
  void WALL700;
  return map;
}

// ---------------------------------------------------------------- far LOD
/** Plain prisms and gable roofs for the houses of a chunk, lifted onto the terrain. */
export function lodChunk(it: ChunkItems): { walls: number[]; roofs: number[] } {
  const walls: number[] = [], roofs: number[] = [];
  /** A triangle, wound so that it faces away from `inside` (x, y, z). */
  let inside = [0, 0, 0];
  const tri = (arr: number[], a: number[], b: number[], c: number[]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3 - inside[0], my = (a[1] + b[1] + c[1]) / 3 - inside[1], mz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    if (nx * mx + ny * my + nz * mz < 0) arr.push(...a, ...c, ...b); else arr.push(...a, ...b, ...c);
  };
  const Y = (x: number, z: number, y: number) => [x, y + fastTerrain(x, z), z];
  for (const l of it.lots) {
    const c = l.c, h = l.h, n = c.length;
    let lx = 0, lz = 0;
    for (const [x, z] of c) { lx += x / n; lz += z / n; }
    inside = [lx, fastTerrain(lx, lz) + h * 0.5 - 2, lz];
    for (let k = 0; k < n; k++) {
      const [ax, az] = c[k], [bx, bz] = c[(k + 1) % n];
      const A0 = Y(ax, az, -0.6), B0 = Y(bx, bz, -0.6), A1 = Y(ax, az, h), B1 = Y(bx, bz, h);
      tri(walls, A0, B0, B1); tri(walls, A0, B1, A1);
    }
    if (l.form === 'ruin') continue;
    // Footprints drawn on the plan that are no quads: a flat cap at the eaves (it is far away).
    if (n !== 4) {
      for (let k = 1; k < n - 1; k++) tri(roofs, Y(c[0][0], c[0][1], h), Y(c[k][0], c[k][1], h), Y(c[k + 1][0], c[k + 1][1], h));
      continue;
    }
    // Ridge along the longer side.
    const e01 = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), e12 = Math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1]);
    const q = e01 >= e12 ? [0, 1, 2, 3] : [1, 2, 3, 0];
    const p = q.map((i) => c[i]);
    const short = Math.min(e01, e12), rh = h + short * 0.22;
    const m03: P2 = [(p[0][0] + p[3][0]) / 2, (p[0][1] + p[3][1]) / 2], m12: P2 = [(p[1][0] + p[2][0]) / 2, (p[1][1] + p[2][1]) / 2];
    const P0 = Y(p[0][0], p[0][1], h), P1 = Y(p[1][0], p[1][1], h), P2_ = Y(p[2][0], p[2][1], h), P3 = Y(p[3][0], p[3][1], h);
    const R0 = Y(m03[0], m03[1], rh), R1 = Y(m12[0], m12[1], rh);
    tri(roofs, P0, P1, R1); tri(roofs, P0, R1, R0);
    tri(roofs, P2_, P3, R0); tri(roofs, P2_, R0, R1);
    tri(walls, P1, P2_, R1); tri(walls, P3, P0, R0);
  }
  for (const w of it.walls) {
    const [ax, az] = w.a, [bx, bz] = w.b, T = 1.25;
    inside = [(ax + bx) / 2, fastTerrain((ax + bx) / 2, (az + bz) / 2) + w.h * 0.4, (az + bz) / 2];
    const nx = w.out[0] * T, nz = w.out[1] * T;
    const q = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = q[k], [x1, z1] = q[(k + 1) % 4];
      const A0 = Y(x0, z0, -1), B0 = Y(x1, z1, -1), A1 = Y(x0, z0, w.h), B1 = Y(x1, z1, w.h);
      tri(walls, A0, B0, B1); tri(walls, A0, B1, A1);
    }
    tri(walls, Y(q[0][0], q[0][1], w.h), Y(q[1][0], q[1][1], w.h), Y(q[2][0], q[2][1], w.h));
    tri(walls, Y(q[0][0], q[0][1], w.h), Y(q[2][0], q[2][1], w.h), Y(q[3][0], q[3][1], w.h));
  }
  for (const t of it.towers) {
    const cx = t.x + t.ox * 2.4, cz = t.z + t.oz * 2.4, r = 3.2, n = 8, h = t.kind === 2 ? 2.3 : t.h - 1.2;
    inside = [cx, fastTerrain(cx, cz) + h * 0.3, cz];
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const A0 = Y(cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, -1), B0 = Y(cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, -1);
      const A1 = Y(cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, h), B1 = Y(cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, h);
      tri(walls, A0, B1, B0); tri(walls, A0, A1, B1);
      tri(walls, A1, Y(cx, cz, h), B1);
    }
  }
  return { walls, roofs };
}
/** Flat-shaded geometry from a triangle soup (normals per face, facing out of the winding). */
export function soup(pos: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
