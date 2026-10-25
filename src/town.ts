import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder, rng, DETAIL } from './builder';
import type { MatName } from './materials';
import { arcadeGeo } from './shapes';
import { brazier } from './lights';
import { Acc, Frame, box as kbox, voussoirs } from './arch/kit';
import { tiledGable, tiledLeanTo } from './arch/roof';
import { facade } from './arch/facade';

// ART DIRECTION. Early-medieval Lombard Italy built from the bones of a
// Roman town: the alleys of Spello, Bevagna, Civita di Bagnoregio, Bobbio,
// Cividale. Heavy, rough, hand-made, asymmetric masonry; deep shadows in thick
// walls; few, small openings with deep reveals; arches of separate voussoirs;
// timber where stone ran out; everything patched, reused, sagging. Under a
// grey overcast dusk the eye reads silhouette and depth before texture, so
// every element must show THICKNESS and LAYERS: reveals, sills, lintels,
// quoins, jetties, tile courses, rafter ends. No two houses alike.
//
// The packed Lombard town: a few crooked lanes and many narrow alleys,
// houses wall to wall on every side, rooms bridging the alleys on arches.
// Everything is laid out on a 0.5 m occupancy raster so nothing intrudes
// into the streets and every scrap of land between them gets built on.

let rand = rng(777);
/** Restart this module's random sequence. */
export function reseedTown(seed: number) { rand = rng(seed); }
const R = (a: number, b: number) => a + (b - a) * rand();

type V2 = THREE.Vector2;
const V = (x: number, z: number) => new THREE.Vector2(x, z);

/** A house plot: footprint quad (front edge c[0]→c[1] on the street when `front`), eaves height, street width in front. */
export interface Lot { c: V2[]; front?: { a: V2; b: V2; out: V2 }; h: number; street?: number; seed?: number }

const ryOf = (e: V2) => Math.atan2(-e.y, e.x); // local +x → e

/** Mesh resolution of house walls in metres. */
const WALL_STEP = 0.8;

/**
 * Walls of a prism over polygon c, from y0 to y0 + h, as indexed grids (one per
 * side, so corners stay creased) that the displacement field can bend.
 */
export function prismWalls(c: V2[], y0: number, h: number, step = WALL_STEP, skip = -1, round = 0.14) {
  let cx = 0, cz = 0;
  for (const p of c) { cx += p.x / c.length; cz += p.y / c.length; }
  const n = c.length;
  // Rounded corners: for corner k, the arc centre, tangent distance and the
  // outward bisector. Both walls meeting there land on the same arc.
  const corner = c.map((P, k) => {
    const A = c[(k + 1) % n], B = c[(k + n - 1) % n];
    const eA = A.clone().sub(P).normalize(), eB = B.clone().sub(P).normalize();
    const phi = Math.acos(THREE.MathUtils.clamp(eA.dot(eB), -1, 1));
    const r = Math.min(round, 0.3 * Math.min(P.distanceTo(A), P.distanceTo(B)) * Math.tan(phi / 2));
    const bis = eA.clone().add(eB).normalize();
    const C = P.clone().addScaledVector(bis, r / Math.sin(phi / 2));
    return { P, eA, eB, r, dT: r / Math.tan(phi / 2), C, bo: bis.clone().negate() };
  });
  /** Point at distance t from corner k along the wall that leaves it in direction e. */
  const arc = (k: number, e: V2, t: number) => {
    const q = corner[k];
    if (q.r < 1e-3 || t >= q.dT) return q.P.clone().addScaledVector(e, t);
    const other = e === q.eA ? q.eB : q.eA;
    const nrm = other.clone().sub(e.clone().multiplyScalar(other.dot(e))).normalize().negate();
    // Spherical interpolation from the wall's normal (at the tangent point)
    // to the outward bisector (at the corner itself).
    const s = 1 - t / q.dT;
    const om = Math.acos(THREE.MathUtils.clamp(nrm.dot(q.bo), -1, 1));
    const ang = om * s;
    const w1 = om > 1e-4 ? Math.sin(om - ang) / Math.sin(om) : 1 - s, w2 = om > 1e-4 ? Math.sin(ang) / Math.sin(om) : s;
    return q.C.clone().add(new THREE.Vector2(nrm.x * w1 + q.bo.x * w2, nrm.y * w1 + q.bo.y * w2).multiplyScalar(q.r));
  };
  const pos: number[] = [], idx: number[] = [];
  const nv = Math.max(1, Math.ceil(h / step));
  // Winding from the polygon's signed area (right for concave footprints too).
  let area2 = 0;
  for (let k = 0; k < n; k++) { const a = c[k], b = c[(k + 1) % n]; area2 += a.x * b.y - b.x * a.y; }
  for (let k = 0; k < n; k++) {
    if (k === skip) continue;
    const a = c[k], b = c[(k + 1) % n];
    const L = a.distanceTo(b);
    if (L < 0.05) continue;
    const e = b.clone().sub(a).normalize();
    const ka = k, kb = (k + 1) % n;
    const dA = corner[ka].dT, dB = corner[kb].dT;
    // Columns: densely round each corner, ~step apart in between.
    const U: number[] = [0, dA * 0.4, dA * 0.75];
    const mid = Math.max(1, Math.ceil((L - dA - dB) / step));
    for (let i = 0; i <= mid; i++) U.push(dA + ((L - dA - dB) * i) / mid);
    U.push(L - dB * 0.75, L - dB * 0.4, L);
    const cols = U.filter((u, i) => i === 0 || u - U[i - 1] > 1e-3).map((u) =>
      u <= dA ? arc(ka, corner[ka].eA, u)
        : u >= L - dB ? arc(kb, corner[kb].eB, L - u)
          : a.clone().addScaledVector(e, u));
    const nu = cols.length - 1;
    const flip = area2 > 0;
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) for (const p of cols) pos.push(p.x, y0 + (h * j) / nv, p.y);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const p00 = base + j * (nu + 1) + i, p10 = p00 + 1, p01 = p00 + nu + 1, p11 = p01 + 1;
      if (flip) idx.push(p00, p11, p10, p00, p01, p11);
      else idx.push(p00, p10, p11, p00, p11, p01);
    }
  }
  const g0 = new THREE.BufferGeometry();
  g0.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g0.setIndex(idx);
  // Weld the walls at the corners so the shading flows round them.
  const g = mergeVertices(g0, 1e-3);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
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
  b.add(prismWalls(c, base, h1 - base, DETAIL.mid ? 3.2 : WALL_STEP, front ? 0 : -1), lower, undefined, true, true, false, prismWalls(c, base, h - base, 1e9));
  if (h > h1 + 0.5) b.add(prismWalls(c, h1, h - h1, DETAIL.mid ? 3.2 : WALL_STEP, front ? 0 : -1), upper, undefined, false, true);
  let jetty = 0;
  if (front) {
    const width = lot.street ?? 2;
    jetty = facade(b, acc, { a: front.a, b: front.b, out: front.out, base, h1, h: Math.max(h, h1 + 0.01), lower, upper, street: width, lamp: rand() < 0.2 });
    if (jetty > 0) c = c.map((p, i) => (i < 2 ? p.clone().addScaledVector(front.out, jetty) : p));
  } else {
    backWindows(acc, c, base, h, lower);
  }
  // A footprint drawn on the plan that is no quad gets a hipped roof that follows it.
  if (c.length !== 4) {
    polyRoof(b, c, h, front ? 0.42 : 0.5, R(0.3, 0.45));
    acc.flush(b);
    return;
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

/**
 * A hipped roof over any footprint: every eave runs along a wall (pushed out
 * by `over`), rising at `pitch` to a ridge line along the footprint's long
 * axis, so irregular plots from the plan keep their drawn shape. Plain tile
 * surface, a low eave fascia; two triangles per wall.
 */
export function polyRoof(b: Builder, c: V2[], h: number, pitch: number, over: number) {
  const n = c.length;
  let area2 = 0, cx = 0, cz = 0;
  for (let k = 0; k < n; k++) { const a = c[k], q = c[(k + 1) % n]; const cr = a.x * q.y - q.x * a.y; area2 += cr; cx += (a.x + q.x) * cr; cz += (a.y + q.y) * cr; }
  if (Math.abs(area2) < 1e-6) return;
  cx /= 3 * area2; cz /= 3 * area2;
  // Long axis from the second moments; the ridge runs along it through the centroid.
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of c) { sxx += (p.x - cx) ** 2; szz += (p.y - cz) ** 2; sxz += (p.x - cx) * (p.y - cz); }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz), ax = V(Math.cos(th), Math.sin(th)), nx = V(-ax.y, ax.x);
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const p of c) { const u = (p.x - cx) * ax.x + (p.y - cz) * ax.y, w = (p.x - cx) * nx.x + (p.y - cz) * nx.y; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
  const half = (w1 - w0) / 2, wm = (w0 + w1) / 2;
  const ridgeH = h + Math.min(half * pitch, 3.2);
  const r0 = Math.max(u0 + half * 0.8, (u0 + u1) / 2 - 0.01), r1 = Math.min(u1 - half * 0.8, (u0 + u1) / 2 + 0.01);
  // Height of the roof over a point: rises from the eaves towards the ridge segment.
  const ridgePt = (p: V2) => {
    const u = THREE.MathUtils.clamp((p.x - cx) * ax.x + (p.y - cz) * ax.y, r0, r1);
    return V(cx + ax.x * u + nx.x * wm, cz + ax.y * u + nx.y * wm);
  };
  const pos: number[] = [];
  const sgn = area2 > 0 ? 1 : -1;
  for (let k = 0; k < n; k++) {
    const a = c[k], q = c[(k + 1) % n];
    const e = q.clone().sub(a);
    const L = e.length();
    if (L < 0.05) continue;
    e.multiplyScalar(1 / L);
    const out = V(e.y, -e.x).multiplyScalar(sgn);
    const A = a.clone().addScaledVector(out, over).addScaledVector(e, -over), Q = q.clone().addScaledVector(out, over).addScaledVector(e, over);
    const ra = ridgePt(a), rq = ridgePt(q);
    const yE = h - over * pitch;
    const tri = (p1: number[], p2: number[], p3: number[]) => {
      // Wind so the face looks up.
      const ux = p2[0] - p1[0], uz = p2[2] - p1[2], vx = p3[0] - p1[0], vz = p3[2] - p1[2];
      const ny = uz * vx - ux * vz;
      if (ny >= 0) pos.push(...p1, ...p2, ...p3); else pos.push(...p1, ...p3, ...p2);
    };
    const PA = [A.x, yE, A.y], PQ = [Q.x, yE, Q.y], RA = [ra.x, ridgeH, ra.y], RQ = [rq.x, ridgeH, rq.y];
    tri(PA, PQ, RQ);
    if (ra.distanceTo(rq) > 0.02) tri(PA, RQ, RA);
    // Fascia under the eave.
    const FA = [A.x, yE - 0.18, A.y], FQ = [Q.x, yE - 0.18, Q.y];
    {
      // Wind the fascia to face outwards.
      const ux = FA[0] - PA[0], uy = FA[1] - PA[1], uz = FA[2] - PA[2], vx = FQ[0] - PA[0], vy = FQ[1] - PA[1], vz = FQ[2] - PA[2];
      const fx = uy * vz - uz * vy, fz = ux * vy - uy * vx;
      if (fx * out.x + fz * out.y >= 0) pos.push(...PA, ...FA, ...FQ, ...PA, ...FQ, ...PQ);
      else pos.push(...PA, ...FQ, ...FA, ...PA, ...PQ, ...FQ);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(g, 'roof', undefined, false, false);
}

/** Back buildings: a few small dark windows and putlog holes on their walls. */
function backWindows(acc: Acc, c: V2[], base: number, h: number, m: MatName) {
  let cx = 0, cz = 0;
  for (const p of c) { cx += p.x / c.length; cz += p.y / c.length; }
  for (let k = 0; k < c.length; k++) {
    if (rand() < 0.45) continue;
    const a = c[k], bb = c[(k + 1) % c.length];
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
      kbox(acc, m === 'brick' ? 'block' : 'wood', f, u, v + 0.3, 0.03, 0.4, 0.07, 0.04, 0.01);
    }
    void base;
  }
}

/**
 * Rooms bridging lanes on arches (pontili) and thin flying arches braced
 * between facing walls. The layout decides where (both sides built up).
 */
export interface BridgeSpec { x: number; z: number; dx: number; dz: number; w: number; pontile: boolean; main: boolean }
/** Where pontili stand (x, z, yaw looking along the lane), for debugging views. */
export const BRIDGE_SPOTS: { x: number; z: number; yaw: number; pontile: boolean }[] = [];

export function buildBridge(b: Builder, sp: BridgeSpec) {
  const a = { p: V(sp.x, sp.z), d: V(sp.dx, sp.dz).normalize() };
  const s = { w: sp.w, main: sp.main };
  const n = V(-a.d.y, a.d.x);
  const ry = ryOf(n);
  const span = s.w + 2.0;
  const acc = new Acc();
  // Frame on the bridge's face: u across the lane, w along the lane.
  const mk = (side: number, depth: number) => {
    const o = a.p.clone().addScaledVector(n, -span / 2).addScaledVector(a.d, side * depth / 2);
    const dz = a.d.clone().multiplyScalar(side);
    const ux = n.x, uz = n.y;
    const rh = (-uz) * dz.x + ux * dz.y; // (u × up)·w with up = y
    return rh >= 0 ? Frame.facade(o.x, o.y, ux, uz, dz.x, dz.y)
      : Frame.facade(o.x + n.x * span, o.y + n.y * span, -ux, -uz, dz.x, dz.y);
  };
  const stoneM: MatName = rand() < 0.5 ? 'block' : 'brick';
  const pont = sp.pontile;
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
      kbox(acc, 'block', f, span / 2, yb + 0.15, 0.06, span / 2, 0.06, 0.08, 0.01);
      if (rand() < 0.75) {
        const ww = R(0.45, 0.65), u0 = R(0.6, span - 0.6 - ww), v0 = yb + R(0.7, 1.1);
        kbox(acc, rand() < 0.35 ? 'window' : 'iron', f, u0 + ww / 2, v0 + 0.35, -0.12, ww / 2, 0.38, 0.01);
        voussoirs(acc, 'brick', f, u0 + ww / 2, v0 + 0.7, ww / 2, ww / 2 + 0.22, -0.05, 0.015, 0, Math.PI, 0.075);
        kbox(acc, 'block', f, u0 + ww / 2, v0 - 0.05, 0.02, ww / 2 + 0.1, 0.05, 0.12, 0.01);
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
    voussoirs(acc, rand() < 0.6 ? 'brick' : 'block', f2, span / 2, 0, r0, r0 + 0.38, -depth, 0, 0, Math.PI, rand() < 0.6 ? 0.075 : 0.22);
    b.geo('rubble', arcadeGeo(span - 0.4, r0 + 0.7, depth * 0.85, 1, s.w + 0.86, 0.01), a.p.x, y0, a.p.y, ry, false);
  }
  acc.flush(b);
}
