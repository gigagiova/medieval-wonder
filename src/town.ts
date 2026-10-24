import * as THREE from 'three';
import { Builder, rng } from './builder';
import type { MatName } from './materials';
import { arcadeGeo } from './shapes';
import { brazier } from './lights';
import { Acc, Frame, box as kbox, voussoirs } from './arch/kit';
import { tiledGable, tiledLeanTo } from './arch/roof';
import { facade } from './arch/facade';
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
export function layoutTown(wall: V2[], reserved: V2[][], gate: V2, goal: V2, eastGate: V2, eastGoal = V(-58, 18), clear: [number, number, number][] = []): Town {
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
  add(walk(eastGate, -Math.PI / 2 - 0.25, 160, 2.2, eastGoal), 2.2, true);
  // Small open places (forecourts) cleared before the alleys grow, so alleys find them.
  for (const [cx, cz, r] of clear) {
    for (let zz = cz - r - 1; zz <= cz + r + 1; zz += RES) for (let xx = cx - r - 1; xx <= cx + r + 1; xx += RES) {
      const ang = Math.atan2(xx - cx, zz - cz);
      if (Math.hypot(xx - cx, zz - cz) < r * (0.8 + 0.2 * Math.sin(ang * 3 + 1.1)) && t.at(xx, zz) === FREE) t.set(xx, zz, STREET);
    }
    t.streets.push({ pts: [V(cx - r * 0.6, cz), V(cx, cz + 0.3), V(cx + r * 0.6, cz)], w: r, main: false });
  }
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
  townRef = t;
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
function prismWalls(c: V2[], y0: number, h: number, step = WALL_STEP, skip = -1) {
  let cx = 0, cz = 0;
  for (const p of c) { cx += p.x / c.length; cz += p.y / c.length; }
  const pos: number[] = [], idx: number[] = [];
  const nv = Math.max(1, Math.ceil(h / step));
  for (let k = 0; k < c.length; k++) {
    if (k === skip) continue;
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
  const { h } = lot;
  let c = lot.c;
  const base = -0.3;
  const lower: MatName = rand() < 0.7 ? 'rubble' : 'brick';
  const upper: MatName = rand() < 0.45 ? lower : (['rubble', 'brick', 'plaster', 'wood'] as MatName[])[Math.floor(rand() * 4)];
  const h1 = Math.min(h, R(2.8, 3.6));
  const acc = new Acc();
  const front = lot.front;
  // One plain prism is the whole house as far as collision goes. The street
  // front is a separate thick panel with real openings (see facade()).
  b.add(prismWalls(c, base, h1 - base, WALL_STEP, front ? 0 : -1), lower, undefined, true, true, false, prismWalls(c, base, h - base, 1e9));
  if (h > h1 + 0.5) b.add(prismWalls(c, h1, h - h1, WALL_STEP, front ? 0 : -1), upper, undefined, false, true);
  let jetty = 0;
  if (front) {
    const width = streetWidthNear(front.a.clone().lerp(front.b, 0.5).addScaledVector(front.out, 0.6));
    jetty = facade(b, acc, { a: front.a, b: front.b, out: front.out, base, h1, h: Math.max(h, h1 + 0.01), lower, upper, street: width, lamp: rand() < 0.2 });
    if (jetty > 0) c = [c[0].clone().addScaledVector(front.out, jetty), c[1].clone().addScaledVector(front.out, jetty), c[2], c[3]];
  } else {
    backWindows(acc, c, base, h, lower);
  }
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
  const gm: MatName = upper === 'wood' ? 'plaster' : upper;
  const opts = { pitch: front ? 0.37 : 0.55, course: front ? 0.52 : 1.0, smoke: rand() < 0.18, gableMat: gm };
  if (rand() < 0.16) {
    tiledLeanTo(acc, lenU + 0.5, lenV + 0.6, h + lenV * 0.28, h - 0.15, centre.x, centre.y, ryOf(e) + (rand() < 0.5 ? 0 : Math.PI), opts.pitch);
  } else if (lenU > lenV || rand() < 0.3) {
    tiledGable(b, acc, lenU, lenV, lenV * R(0.17, 0.26), centre.x, h, centre.y, ryOf(e), R(0.32, 0.55), opts);
  } else {
    tiledGable(b, acc, lenV, lenU, lenU * R(0.17, 0.26), centre.x, h, centre.y, ryOf(n), R(0.32, 0.55), opts);
  }
  acc.flush(b);
}

/** Width of the street around a point (for pentices and stairs). */
let townRef: Town | null = null;
function streetWidthNear(p: V2) {
  if (!townRef) return 2;
  let best = 2;
  let bd = Infinity;
  for (const s of townRef.streets) for (let i = 0; i < s.pts.length - 1; i++) {
    const d = distSeg(p, s.pts[i], s.pts[i + 1]);
    if (d < bd) { bd = d; best = s.w; }
  }
  return best;
}

/** Back buildings: a few small dark windows and putlog holes on their walls. */
function backWindows(acc: Acc, c: V2[], base: number, h: number, m: MatName) {
  let cx = 0, cz = 0;
  for (const p of c) { cx += p.x / 4; cz += p.y / 4; }
  for (let k = 0; k < 4; k++) {
    if (rand() < 0.45) continue;
    const a = c[k], bb = c[(k + 1) % 4];
    const L = a.distanceTo(bb);
    if (L < 1.5) continue;
    const e = bb.clone().sub(a).normalize();
    let out = V(-e.y, e.x);
    if (out.dot(V(a.x - cx, a.y - cz)) < 0) out = out.negate();
    const f = Frame.facade(a.x, a.y, e.x, e.y, out.x, out.y);
    for (let i = 0; i < Math.max(1, Math.floor(L / 3)); i++) {
      if (rand() < 0.4) continue;
      const u = R(0.5, L - 0.5), v = R(1.4, Math.max(1.5, h - 1.2));
      kbox(acc, 'iron', f, u, v, 0.006, R(0.18, 0.3), R(0.25, 0.4), 0.01);
      kbox(acc, m === 'brick' ? 'stone' : 'wood', f, u, v + 0.3, 0.03, 0.4, 0.07, 0.04, 0.01);
    }
    void base;
  }
}

/**
 * Rooms bridging alleys on arches (pontili) and thin flying arches braced
 * between facing walls, wherever both sides of a lane are built up.
 */
/** Where pontili stand (x, z, yaw looking along the lane), for debugging views. */
export const BRIDGE_SPOTS: { x: number; z: number; yaw: number; pontile: boolean }[] = [];

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
      const acc = new Acc();
      // Frame on the bridge's face: u across the lane, w along the lane.
      const mk = (side: number, depth: number) => {
        const o = a.p.clone().addScaledVector(n, -span / 2).addScaledVector(a.d, side * depth / 2);
        const dz = a.d.clone().multiplyScalar(side);
        // Keep it right-handed: u × up must point along w.
        const ux = n.x, uz = n.y;
        const rh = (uz * 1 - 0) * 0 + (-uz) * dz.x + ux * dz.y; // (u × up)·w with up = y
        return rh >= 0 ? Frame.facade(o.x, o.y, ux, uz, dz.x, dz.y)
          : Frame.facade(o.x + n.x * span, o.y + n.y * span, -ux, -uz, dz.x, dz.y);
      };
      const stoneM: MatName = rand() < 0.5 ? 'stone' : 'brick';
      const pont = rand() < 0.55 && !s.main;
      BRIDGE_SPOTS.push({ x: a.p.x, z: a.p.y, yaw: Math.atan2(-a.d.x, -a.d.y), pontile: pont });
      if (pont) {
        // Pontile: a room carried on a vaulted passage.
        const depth = R(2.2, 4.0), spring = R(2.4, 2.9), top = spring + s.w / 2 + R(2.6, 3.6);
        const m: MatName = rand() < 0.5 ? 'rubble' : 'brick';
        b.geo(m, arcadeGeo(span, top, depth, 1, s.w + 0.1, spring), a.p.x, -0.2, a.p.y, ry);
        for (const side of [-1, 1]) {
          const f = mk(side, depth);
          voussoirs(acc, stoneM, f, span / 2, spring - 0.2 + 0.2, (s.w + 0.1) / 2, (s.w + 0.1) / 2 + R(0.32, 0.45), -0.08, 0.02, 0, Math.PI, stoneM === 'brick' ? 0.075 : 0.2);
          // Corbel course under the room, a window with shutters.
          const yb = spring + s.w / 2 + 0.55;
          for (let u = 0.25; u < span - 0.2; u += R(0.38, 0.5)) kbox(acc, stoneM, f, u, yb, 0.08, 0.08, 0.1, 0.1, 0.01);
          kbox(acc, 'stone', f, span / 2, yb + 0.15, 0.06, span / 2, 0.06, 0.08, 0.01);
          if (rand() < 0.75) {
            const ww = R(0.45, 0.65), u0 = R(0.6, span - 0.6 - ww), v0 = yb + R(0.7, 1.1);
            kbox(acc, rand() < 0.35 ? 'window' : 'iron', f, u0 + ww / 2, v0 + 0.35, -0.12, ww / 2, 0.38, 0.01);
            voussoirs(acc, 'brick', f, u0 + ww / 2, v0 + 0.7, ww / 2, ww / 2 + 0.22, -0.05, 0.015, 0, Math.PI, 0.075);
            kbox(acc, 'stone', f, u0 + ww / 2, v0 - 0.05, 0.02, ww / 2 + 0.1, 0.05, 0.12, 0.01);
            for (const half of [0, 1]) kbox(acc, 'wood', f, u0 + ww * (0.25 + half * 0.5), v0 + 0.35, -0.05, ww / 4 - 0.01, 0.36, 0.025, 0.004);
          }
        }
        tiledGable(b, acc, span, depth, 0.7, a.p.x, top - 0.2, a.p.y, ry, 0.35, { gableMat: m, pitch: 0.36 });
      } else {
        // Flying arch of voussoirs bracing the two walls apart, with a thin spandrel.
        const y0 = R(3.4, 5.8);
        const depth = R(0.45, 0.65);
        const f = mk(1, depth);
        const r0 = (s.w + 0.1) / 2;
        const f2 = new Frame(f.o.clone().setY(y0), f.x, f.y, f.z);
        voussoirs(acc, rand() < 0.6 ? 'brick' : 'stone', f2, span / 2, 0, r0, r0 + 0.38, -depth, 0, 0, Math.PI, rand() < 0.6 ? 0.075 : 0.22);
        b.geo('rubble', arcadeGeo(span - 0.4, r0 + 0.7, depth * 0.85, 1, s.w + 0.86, 0.01), a.p.x, y0, a.p.y, ry, false);
      }
      acc.flush(b);
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
