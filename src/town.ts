import * as THREE from 'three';
import { Builder, rng } from './builder';
import type { MatName } from './materials';
import { arcadeGeo, gable, leanTo } from './shapes';
import { torch, bracketLantern, brazier } from './lights';
import { terrain } from './displace';

// The packed Lombard town: a few crooked lanes and many narrow alleys,
// houses wall to wall on every side, rooms bridging the alleys on arches.
// Everything is laid out on a 0.5 m occupancy raster so nothing intrudes
// into the streets and every scrap of land between them gets built on.

const rand = rng(777);
const R = (a: number, b: number) => a + (b - a) * rand();

export const GRID_MIN = -100, GRID_SIZE = 200, RES = 0.5;
const N = GRID_SIZE / RES;
const FREE = 0, STREET = 1, RESERVED = 2, HOUSE = 3, OUTSIDE = 4;

type V2 = THREE.Vector2;
const V = (x: number, z: number) => new THREE.Vector2(x, z);

export interface Street { pts: V2[]; w: number; main: boolean }

export class Town {
  grid = new Uint8Array(N * N);
  /** 0..1: how much a cell belongs to a main lane (old Roman paving survives there). */
  mainMask = new Float32Array(N * N);
  /** Gutter depth along street centrelines (metres, negative). */
  gutter = new Float32Array(N * N);
  streets: Street[] = [];
  wall: V2[] = [];

  idx(x: number, z: number) {
    const i = Math.floor((x - GRID_MIN) / RES), j = Math.floor((z - GRID_MIN) / RES);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }
  at(x: number, z: number) {
    const k = this.idx(x, z);
    return k < 0 ? OUTSIDE : this.grid[k];
  }
  set(x: number, z: number, v: number) {
    const k = this.idx(x, z);
    if (k >= 0) this.grid[k] = v;
  }
  /** Bilinear sample of the gutter field. */
  gutterAt(x: number, z: number) {
    const fx = (x - GRID_MIN) / RES - 0.5, fz = (z - GRID_MIN) / RES - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return 0;
    const tx = fx - i, tz = fz - j, g = this.gutter;
    const a = g[j * N + i], b = g[j * N + i + 1], c = g[(j + 1) * N + i], d = g[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
}

function insidePoly(p: V2, poly: V2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
function distSeg(p: V2, a: V2, b: V2) {
  const abx = b.x - a.x, abz = b.y - a.y;
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + abz * t));
}

/** Point and direction at arc length s along a polyline. */
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
const lengthOf = (pts: V2[]) => pts.reduce((a, p, i) => (i ? a + p.distanceTo(pts[i - 1]) : 0), 0);

/**
 * Lay out the town inside `wall`, avoiding `reserved` polygons (abbey, ruins).
 * `gate` is where the main lane enters; `goal` where it ends (abbey atrium).
 */
export function layoutTown(wall: V2[], reserved: V2[][], gate: V2, goal: V2, eastGate: V2): Town {
  const t = new Town();
  t.wall = wall;
  // Classify cells.
  const p = V(0, 0);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    p.set(GRID_MIN + (i + 0.5) * RES, GRID_MIN + (j + 0.5) * RES);
    let v = insidePoly(p, wall) ? FREE : OUTSIDE;
    if (v === FREE) {
      for (let k = 0; k < wall.length; k++) if (distSeg(p, wall[k], wall[(k + 1) % wall.length]) < 2.2) { v = RESERVED; break; }
    }
    if (v === FREE && reserved.some((r) => insidePoly(p, r))) v = RESERVED;
    t.grid[j * N + i] = v;
  }

  const paint = (s: Street) => {
    for (let k = 0; k < s.pts.length - 1; k++) {
      const a = s.pts[k], b = s.pts[k + 1];
      const r = s.w / 2 + 0.6;
      for (let z = Math.min(a.y, b.y) - r; z <= Math.max(a.y, b.y) + r; z += RES) {
        for (let x = Math.min(a.x, b.x) - r; x <= Math.max(a.x, b.x) + r; x += RES) {
          p.set(x, z);
          const d = distSeg(p, a, b);
          // Ragged street edges: frontages never line up.
          const wob = 0.22 * Math.sin(x * 1.7 + z * 0.9) * Math.cos(z * 1.3 - x * 0.4);
          const k2 = t.idx(x, z);
          if (k2 < 0) continue;
          if (d < s.w / 2 + wob && t.grid[k2] !== OUTSIDE) {
            if (t.grid[k2] !== RESERVED || s.main) t.grid[k2] = STREET;
            if (s.main) t.mainMask[k2] = Math.max(t.mainMask[k2], 1 - d / (s.w / 2 + 0.01));
          }
          if (d < 0.55 && t.grid[k2] === STREET) t.gutter[k2] = Math.min(t.gutter[k2], -0.07 * (1 - d / 0.55));
        }
      }
    }
  };

  // Random walk with optional pull towards a goal; stops on leaving the
  // buildable area or on meeting another street (which it then joins).
  const walk = (start: V2, heading: number, maxLen: number, w: number, goalPt?: V2): V2[] => {
    const pts = [start.clone()];
    let h = heading, pos = start.clone(), len = 0;
    const step = 2.2;
    while (len < maxLen) {
      if (goalPt) {
        const want = Math.atan2(goalPt.x - pos.x, goalPt.y - pos.y);
        let dh = want - h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        h += dh * 0.25;
      }
      h += R(-0.32, 0.32);
      const next = pos.clone().add(V(Math.sin(h) * step, Math.cos(h) * step));
      const c = t.at(next.x, next.y);
      if (c === OUTSIDE || (c === RESERVED && len > 6 && !(goalPt && next.distanceTo(goalPt) < 4))) break;
      pts.push(next);
      len += step;
      pos = next;
      if (goalPt && pos.distanceTo(goalPt) < 2.5) break;
      if (c === STREET && len > 5) break;
    }
    return pts;
  };

  const add = (pts: V2[], w: number, main = false) => {
    if (pts.length < 3) return;
    const s = { pts, w, main };
    t.streets.push(s);
    paint(s);
  };
  // The one real lane, from the gate up to the abbey; and a crooked cross lane.
  add(walk(gate, Math.atan2(goal.x - gate.x, goal.y - gate.y), 220, 2.7, goal), 2.7, true);
  add(walk(eastGate, -Math.PI / 2 - 0.25, 160, 2.2, V(-58, 18)), 2.2, true);
  // Alleys branch off everything that exists, wander, and join or dead-end.
  for (let n = 0; n < 70; n++) {
    const src = t.streets[Math.floor(rand() * t.streets.length)];
    const L = lengthOf(src.pts);
    const a = along(src.pts, R(3, L - 3));
    if (!a) continue;
    const side = rand() < 0.5 ? 1 : -1;
    const h = Math.atan2(a.d.x, a.d.y) + side * (Math.PI / 2 + R(-0.5, 0.5));
    const start = a.p.clone().add(V(Math.sin(h), Math.cos(h)).multiplyScalar(src.w / 2 + 0.2));
    const dead = rand() < 0.25;
    add(walk(start, h, dead ? R(5, 12) : R(14, 48), R(1.3, 1.9)), R(1.3, 1.9));
  }
  return t;
}

// ------------------------------------------------------------- buildings

interface Lot { c: V2[]; front?: { a: V2; b: V2; out: V2 }; h: number }

function quadClear(t: Town, c: V2[], allowHouse: number) {
  // Sample the quad on the raster: no street / reserved / outside inside it.
  let total = 0, house = 0;
  const p = V(0, 0);
  for (let u = 0.08; u < 1; u += 0.14) for (let w = 0.08; w < 1; w += 0.14) {
    p.copy(c[0]).lerp(c[1], u);
    const q = c[3].clone().lerp(c[2], u);
    p.lerp(q, w);
    const v = t.at(p.x, p.y);
    if (v === STREET || v === RESERVED || v === OUTSIDE) return false;
    total++;
    if (v === HOUSE) house++;
  }
  return house / total <= allowHouse;
}
function markQuad(t: Town, c: V2[]) {
  const p = V(0, 0);
  for (let u = 0; u <= 1; u += 0.04) for (let w = 0; w <= 1; w += 0.04) {
    p.copy(c[0]).lerp(c[1], u);
    p.lerp(c[3].clone().lerp(c[2], u), w);
    if (t.at(p.x, p.y) === FREE) t.set(p.x, p.y, HOUSE);
  }
}

export function lotsFor(t: Town): Lot[] {
  const lots: Lot[] = [];
  // Frontages along every street, both sides, wall to wall.
  for (const s of t.streets) {
    const L = lengthOf(s.pts);
    for (const side of [-1, 1]) {
      let u = R(0, 1.5);
      while (u < L - 2) {
        const f = R(3.2, s.main ? 7 : 5.8);
        const a = along(s.pts, u), b = along(s.pts, Math.min(u + f, L));
        u += f + (rand() < 0.08 ? R(0.5, 1.5) : 0);
        if (!a || !b) break;
        const n = V(-a.d.y, a.d.x).multiplyScalar(side);
        const nb = V(-b.d.y, b.d.x).multiplyScalar(side);
        const off = s.w / 2 + 0.25;
        const F0 = a.p.clone().addScaledVector(n, off), F1 = b.p.clone().addScaledVector(nb, off);
        let d0 = R(5, s.main ? 11 : 9), d1 = d0 + R(-1.4, 1.4);
        let ok = false, c: V2[] = [];
        while (d0 > 2.6 && d1 > 2.6) {
          c = [F0, F1, F1.clone().addScaledVector(nb, d1), F0.clone().addScaledVector(n, d0)];
          if (quadClear(t, c, 0.35)) { ok = true; break; }
          d0 -= 0.8; d1 -= 0.8;
        }
        if (!ok) continue;
        markQuad(t, c);
        lots.push({ c, front: { a: F0, b: F1, out: n.clone().negate() }, h: R(5, 10.5) });
      }
    }
  }
  // Infill: every remaining scrap of land gets a back building.
  const free: number[] = [];
  for (let k = 0; k < t.grid.length; k++) if (t.grid[k] === FREE) free.push(k);
  for (let tries = 0; tries < 2600 && free.length; tries++) {
    const k = free[Math.floor(rand() * free.length)];
    if (t.grid[k] !== FREE) continue;
    const x = GRID_MIN + ((k % N) + 0.5) * RES, z = GRID_MIN + (Math.floor(k / N) + 0.5) * RES;
    const ang = R(-0.3, 0.3) + (rand() < 0.5 ? 0 : Math.PI / 2);
    const ex = V(Math.cos(ang), -Math.sin(ang)), ez = V(Math.sin(ang), Math.cos(ang));
    for (let s = 0; s < 4; s++) {
      const w = R(2.6, 7) * (1 - s * 0.2), d = R(2.6, 7) * (1 - s * 0.2);
      const o = V(x, z).addScaledVector(ex, -w * R(0.2, 0.8)).addScaledVector(ez, -d * R(0.2, 0.8));
      const c = [o, o.clone().addScaledVector(ex, w), o.clone().addScaledVector(ex, w).addScaledVector(ez, d), o.clone().addScaledVector(ez, d)];
      if (!quadClear(t, c, 0.6)) continue;
      markQuad(t, c);
      lots.push({ c, h: R(3.5, 9) });
      break;
    }
  }
  return lots;
}

const ryOf = (e: V2) => Math.atan2(-e.y, e.x); // local +x → e

/** Mesh resolution of house walls in metres. */
const WALL_STEP = 0.8;

/**
 * Walls of a prism over polygon c, from y0 to y0 + h, as indexed grids (one per
 * side, so corners stay creased) that the displacement field can bend.
 */
function prismWalls(c: V2[], y0: number, h: number, step = WALL_STEP) {
  let cx = 0, cz = 0;
  for (const p of c) { cx += p.x / c.length; cz += p.y / c.length; }
  const pos: number[] = [], idx: number[] = [];
  const nv = Math.max(1, Math.ceil(h / step));
  for (let k = 0; k < c.length; k++) {
    const a = c[k], b = c[(k + 1) % c.length];
    const L = a.distanceTo(b);
    if (L < 0.05) continue;
    const nu = Math.max(1, Math.ceil(L / step));
    const ex = (b.x - a.x) / L, ez = (b.y - a.y) / L;
    // Triangle (p00, p10, p11) faces (-ez, 0, ex); flip if that points inward.
    const mx = (a.x + b.x) / 2 - cx, mz = (a.y + b.y) / 2 - cz;
    const flip = -ez * mx + ex * mz < 0;
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      pos.push(a.x + (b.x - a.x) * (i / nu), y0 + (h * j) / nv, a.y + (b.y - a.y) * (i / nu));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const p00 = base + j * (nu + 1) + i, p10 = p00 + 1, p01 = p00 + nu + 1, p11 = p01 + 1;
      if (flip) idx.push(p00, p11, p10, p00, p01, p11);
      else idx.push(p00, p10, p11, p00, p11, p01);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}

/** A packed town house built on a (possibly skewed) quad footprint. */
export function buildHouse(b: Builder, lot: Lot) {
  const { c, h } = lot;
  const base = -0.3;
  const lower: MatName = rand() < 0.7 ? 'rubble' : 'brick';
  const upper: MatName = rand() < 0.45 ? lower : (['rubble', 'brick', 'plaster', 'wood'] as MatName[])[Math.floor(rand() * 4)];
  const h1 = Math.min(h, R(2.8, 3.6));
  // One plain prism (8 triangles) is the whole house as far as collision goes.
  b.add(prismWalls(c, base, h1 - base), lower, undefined, true, true, false, prismWalls(c, base, h - base, 1e9));
  if (h > h1 + 0.5) b.add(prismWalls(c, h1, h - h1), upper, undefined, false, true);
  // Roof over the footprint's oriented bounds, ridge along or across the street.
  const e = c[1].clone().sub(c[0]).normalize();
  const n = V(-e.y, e.x);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of c) {
    const u = p.dot(e), w = p.dot(n);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, w); maxV = Math.max(maxV, w);
  }
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  const centre = e.clone().multiplyScalar(cu).addScaledVector(n, cv);
  const lenU = maxU - minU, lenV = maxV - minV;
  const roofMat: MatName = upper === 'wood' ? 'wood' : rand() < 0.15 ? lower : upper;
  if (rand() < 0.2) {
    leanTo(b, lenU + 0.3, lenV, h + lenV * 0.3, h - 0.1, centre.x, centre.y, ryOf(e) + (rand() < 0.5 ? 0 : Math.PI));
  } else if (lenU > lenV || rand() < 0.3) {
    gable(b, lenU, lenV, lenV * R(0.17, 0.26), centre.x, h, centre.y, ryOf(e), roofMat, R(0.3, 0.6));
  } else {
    gable(b, lenV, lenU, lenU * R(0.17, 0.26), centre.x, h, centre.y, ryOf(n), roofMat, R(0.3, 0.6));
  }
  // Putlog holes: the rows of square scaffold holes every Italian rubble wall has.
  for (let k = 0; k < 4; k++) {
    if (rand() < 0.5) continue;
    const a = c[k], bb = c[(k + 1) % 4];
    const len = a.distanceTo(bb);
    const ed = bb.clone().sub(a).normalize();
    for (let y = 1.6 + R(-0.2, 0.2); y < h - 0.6; y += R(1.4, 1.9)) {
      for (let u = R(0.4, 1.2); u < len - 0.4; u += R(1.3, 2.4)) {
        if (rand() < 0.5) continue;
        const pp = a.clone().addScaledVector(ed, u);
        b.box('iron', 0.13, 0.13, 0.3, pp.x, y, pp.y, ryOf(ed), false);
      }
    }
  }
  if (!lot.front) return;
  // Street front: an arched doorway, a few small windows at odd places.
  const F = lot.front;
  const fl = F.a.distanceTo(F.b);
  const fe = F.b.clone().sub(F.a).normalize();
  const ry = ryOf(fe);
  const out = F.out;
  const at = (u: number, o: number) => F.a.clone().addScaledVector(fe, u).addScaledVector(out, o);
  const du = R(0.9, Math.max(1.0, fl - 0.9));
  const dp = at(du, 0.05);
  const archMat: MatName = rand() < 0.6 ? 'brick' : 'marble';
  const dw = R(0.95, 1.25), spring = R(1.7, 2.0);
  b.geo(archMat, arcadeGeo(dw + 0.7, spring + dw / 2 + 0.45, 0.32, 1, dw, spring), dp.x, -0.1, dp.y, ry, false, 0, 0, true);
  const dd = at(du, -0.06);
  b.box('wood', dw + 0.05, spring + dw / 2 - 0.05, 0.1, dd.x, -0.1, dd.y, ry, false);
  if (rand() < 0.18) {
    const tp = at(Math.min(fl - 0.3, du + dw / 2 + 0.5), 0.05);
    if (rand() < 0.6) bracketLantern(b, tp.x, 2.2, tp.y, Math.atan2(out.x, out.y));
    else torch(b, tp.x, 2.4, tp.y, Math.atan2(out.x, out.y));
  }
  const floors: number[] = [];
  for (let y = h1 + R(0.8, 1.3); y < h - 1.1; y += R(2.4, 3.0)) floors.push(y);
  for (const fy of floors) {
    const nw = Math.max(1, Math.floor(fl / R(2.2, 3.4)));
    for (let i = 0; i < nw; i++) {
      if (rand() < 0.25) continue;
      const u = R(0.5, fl - 0.5);
      const wp = at(u, 0.04);
      const glow = rand() < 0.3;
      const ww = R(0.45, 0.7), wh = R(0.65, 0.95);
      if (rand() < 0.5) {
        b.geo('brick', arcadeGeo(ww + 0.35, wh + ww / 2 + 0.25, 0.2, 1, ww, wh), wp.x, fy - 0.1, wp.y, ry, false, 0, 0, true);
      } else {
        b.box('marble', ww + 0.25, 0.14, 0.24, wp.x, fy - 0.2, wp.y, ry, false);
        b.box('wood', ww + 0.3, 0.16, 0.2, wp.x, fy + wh, wp.y, ry, false);
      }
      const sp = at(u, -0.02);
      b.box(glow ? 'window' : 'wood', ww, wh, 0.07, sp.x, fy - 0.1, sp.y, ry, false);
      if (glow && rand() < 0.3) {
        const lp = at(u, 0.6);
        b.lamp('window', new THREE.Vector3(lp.x, fy + 0.3, lp.y));
      }
    }
  }
  // Ground-floor slit for light and air.
  if (fl > 3 && rand() < 0.5) {
    const u = du < fl / 2 ? R(du + dw, fl - 0.4) : R(0.4, du - dw);
    const sp = at(u, -0.02);
    b.box('iron', 0.18, 0.55, 0.12, sp.x, 1.3, sp.y, ry, false);
  }
  // Spolia: a reused Roman block set in the wall.
  if (rand() < 0.2) {
    const sp = at(R(0.3, fl - 0.3), 0.02);
    b.box('marble', R(0.5, 1.1), R(0.3, 0.5), 0.2, sp.x, R(0.3, h1 - 0.5), sp.y, ry + R(-0.04, 0.04), false);
  }
  // A wooden balcony on the upper floor, now and then.
  if (floors.length && rand() < 0.12) {
    const u = R(1, Math.max(1.2, fl - 1));
    const bp = at(u, 0.45);
    b.box('wood', Math.min(2.4, fl - 0.4), 0.1, 0.8, bp.x, floors[0] - 0.3, bp.y, ry, false);
    const rp = at(u, 0.8);
    b.box('wood', Math.min(2.4, fl - 0.4), 0.06, 0.05, rp.x, floors[0] + 0.6, rp.y, ry, false);
  }
}

/**
 * Rooms bridging alleys on arches (pontili) and thin flying arches braced
 * between facing walls, wherever both sides of a lane are built up.
 */
export function buildBridges(b: Builder, t: Town) {
  for (const s of t.streets) {
    const L = lengthOf(s.pts);
    let u = R(6, 16);
    while (u < L - 4) {
      const a = along(s.pts, u);
      u += R(9, 22);
      if (!a) break;
      const n = V(-a.d.y, a.d.x);
      const probe = (side: number) => {
        let ok = 0;
        for (const k of [-1.2, 0, 1.2]) {
          const q = a.p.clone().addScaledVector(n, side * (s.w / 2 + 1.3)).addScaledVector(a.d, k);
          if (t.at(q.x, q.y) === HOUSE) ok++;
        }
        return ok >= 2;
      };
      if (!probe(1) || !probe(-1)) continue;
      const ry = ryOf(n);
      const span = s.w + 2.0;
      if (rand() < 0.55 && !s.main) {
        // Pontile: a room on an arch.
        const depth = R(2.2, 4.2), spring = R(2.4, 3.0), top = spring + s.w / 2 + R(2.6, 3.8);
        b.geo(rand() < 0.5 ? 'rubble' : 'brick', arcadeGeo(span, top, depth, 1, s.w + 0.15, spring), a.p.x, -0.2, a.p.y, ry);
        gable(b, span, depth, 0.7, a.p.x, top - 0.2, a.p.y, ry, 'brick', 0.35);
        for (const sd of [-1, 1]) {
          if (rand() < 0.5) continue;
          const wp = a.p.clone().addScaledVector(a.d, sd * (depth / 2 + 0.03));
          b.box(rand() < 0.4 ? 'window' : 'wood', 0.5, 0.7, 0.06, wp.x + n.x * R(-0.4, 0.4), top - 1.6, wp.y + n.y * R(-0.4, 0.4), ry, false);
        }
      } else {
        // Flying arch bracing the two walls apart.
        const y0 = R(3.4, 5.8);
        b.geo('brick', arcadeGeo(span - 0.6, s.w / 2 + R(0.5, 0.9), R(0.4, 0.6), 1, s.w + 0.05, 0.01), a.p.x, y0, a.p.y, ry, false);
      }
    }
  }
}

/** A small irregular open place: a well, a brazier, a bench of spolia. */
export function piazzetta(b: Builder, t: Town, x: number, z: number, r: number) {
  const p = V(0, 0);
  for (let zz = z - r - 2; zz <= z + r + 2; zz += RES) for (let xx = x - r - 2; xx <= x + r + 2; xx += RES) {
    p.set(xx, zz);
    const ang = Math.atan2(xx - x, zz - z);
    const rr = r * (0.75 + 0.25 * Math.sin(ang * 3 + 1.3) + 0.12 * Math.sin(ang * 5));
    if (Math.hypot(xx - x, zz - z) < rr && t.at(xx, zz) === FREE) t.set(xx, zz, STREET);
  }
  brazier(b, x + R(-1.5, 1.5), z + R(-1.5, 1.5));
}

/** RGBA texture for the shaders: R main-lane mask, G any street, B gutter, A terrain height. */
export function townTexture(t: Town): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    data[k * 4] = Math.round(t.mainMask[k] * 255);
    data[k * 4 + 1] = t.grid[k] === STREET ? 255 : 0;
    data[k * 4 + 2] = Math.round(Math.min(1, -t.gutter[k] / 0.07) * 255);
    const x = GRID_MIN + ((k % N) + 0.5) * RES, z = GRID_MIN + (Math.floor(k / N) + 0.5) * RES;
    data[k * 4 + 3] = Math.round(THREE.MathUtils.clamp((terrain(x, z) + 1.5) / 4, 0, 1) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
