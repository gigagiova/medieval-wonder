import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder, rng, DETAIL } from './builder';
import type { MatName } from './materials';
import { arcadeGeo, ruin } from './shapes';
import { brazier } from './lights';
import { Acc, Frame, box as kbox, voussoirs, coppo } from './arch/kit';
import { tiledGable, tiledLeanTo } from './arch/roof';
import { facade } from './arch/facade';
import { planFront, buildFront, sideFace, sideLine } from './arch/dress';
import { withStream } from './arch/kit';

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
export interface Lot { c: V2[]; front?: { a: V2; b: V2; out: V2 }; h: number; street?: number; seed?: number; form?: 'tower' | 'ruin'; side?: [number, number][] }

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
  if (lot.form === 'ruin') { ruinHouse(b, lot); return; }
  const tower = lot.form === 'tower';
  let lower: MatName = rand() < 0.7 ? 'rubble' : 'brick';
  let upper: MatName = rand() < 0.45 ? lower : (['rubble', 'brick', 'plaster', 'wood'] as MatName[])[Math.floor(rand() * 4)];
  // A tower house is one mass of stone from the footing to the eaves.
  if (tower) { if (lower === 'brick' && rand() < 0.5) lower = 'rubble'; upper = lower; }
  let h1 = Math.min(h, R(2.8, 3.6));
  const acc = new Acc();
  const front = lot.front;
  const seed = lot.seed ?? 1;
  // What stands in the street in front: an outside stair to the upper floor
  // (then the floor is at its landing), woodpiles, benches, jars, a cart.
  const fp = front ? planFront(front, lot.street ?? 2, h, seed) : null;
  if (fp?.stair) h1 = Math.min(h - 1.6, fp.stair.hL);
  // One plain prism is the whole house as far as collision goes. The street
  // front is a separate thick panel with real openings (see facade()).
  // Back buildings are seen across yards and over roofs, never at arm's length: a coarser grid.
  const step = DETAIL.mid ? 3.2 : front || lot.side ? WALL_STEP : 1.6;
  b.add(prismWalls(c, base, h1 - base, step, front ? 0 : -1), lower, undefined, true, true, false, prismWalls(c, base, h - base, 1e9));
  if (h > h1 + 0.5) b.add(prismWalls(c, h1, h - h1, step, front ? 0 : -1), upper, undefined, false, true);
  let jetty = 0;
  if (front) {
    const width = lot.street ?? 2;
    jetty = facade(b, acc, { a: front.a, b: front.b, out: front.out, base, h1, h: Math.max(h, h1 + 0.01), lower, upper, street: width, lamp: rand() < 0.2, stair: fp?.stair, seed });
    withStream(seed * 11 + 4, () => buildFront(acc, front, fp!, lower === 'brick' ? 'brick' : 'block', seed));
    if (jetty > 0) c = c.map((p, i) => (i < 2 ? p.clone().addScaledVector(front.out, jetty) : p));
  } else {
    backWindows(acc, c, base, h, lower);
  }
  // Side and back walls that stand on a lane: windows, doors and street things there too.
  for (const [k, w] of lot.side ?? []) {
    withStream(seed * 13 + k * 7 + 1, () => sideFace(acc, sideLine(lot.c, k), w, h, h1, lower, seed + k * 101, (p) => b.lamp('window', p)));
  }
  // A footprint drawn on the plan that is no quad gets a hipped roof that follows it
  // (and so does a tower: a low four-sided roof).
  if (c.length !== 4 || tower) {
    polyRoof(b, c, h, front ? 0.42 : 0.5, R(0.3, 0.45), acc, front ? 0.37 : 0.55, front ? 3 : 2, !!front);
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
  // Sheds, stables and the poorer back houses are often shingled (scandulae);
  // old roofs sag more along the ridge.
  const shU = rand(), sagU = rand();
  const shingle = shU < (front ? 0.06 : h < 6 ? 0.3 : 0.12);
  const opts = { pitch: front ? 0.37 : 0.55, course: front ? 0.52 : 1.0, smoke: rand() < 0.18, gableMat: gm, shingle, sag: sagU < 0.3 ? sagU * 0.5 : 0, seg: front ? 3 : 2, street: front ? [front.out.x, front.out.y] as [number, number] : undefined };
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
 * A house that has fallen in: its walls stand to a ragged height, the roof is
 * gone (a rafter or two left leaning), rubble and fallen beams inside.
 */
function ruinHouse(b: Builder, lot: Lot) {
  const c = lot.c, n = c.length;
  let cx = 0, cz = 0;
  for (const p of c) { cx += p.x / n; cz += p.y / n; }
  const m: MatName = rand() < 0.65 ? 'rubble' : 'brick';
  const acc = new Acc();
  for (let k = 0; k < n; k++) {
    const a = c[k], q = c[(k + 1) % n];
    const L = a.distanceTo(q);
    if (L < 0.6) continue;
    const e = q.clone().sub(a).normalize();
    let inw = V(-e.y, e.x);
    if (inw.dot(V(cx - a.x, cz - a.y)) < 0) inw = inw.negate();
    const T = 0.55;
    const mid = a.clone().add(q).multiplyScalar(0.5).addScaledVector(inw, T / 2);
    // A doorway in one wall now and then; some walls almost gone.
    const hw = lot.h * R(0.45, 1.0) * (rand() < 0.2 ? 0.4 : 1);
    const door = L > 2.6 && rand() < 0.35;
    ruin(b, m, L + 0.2, hw + 0.3, T, mid.x, -0.3, mid.y, ryOf(e), R(0.35, 0.7), door ? R(0.9, 1.2) : 0, door ? R(1.3, 1.7) : 0);
  }
  // Rafters still hanging from a wall top, a beam fallen across, heaps of rubble.
  const f = Frame.facade(cx, cz, 1, 0, 0, 1);
  for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
    const a = R(0, Math.PI * 2), len = R(2, 4), x0 = R(-1.2, 1.2), z0 = R(-1.2, 1.2), y0 = R(0.05, lot.h * 0.6);
    const p0 = f.p(x0, 0.05, z0), p1 = f.p(x0 + Math.cos(a) * len, y0, z0 + Math.sin(a) * len);
    const s = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.12), u = new THREE.Vector3(0, 0.12, 0);
    acc.hexa('wood', [p0, p1, p1.clone().add(s), p0.clone().add(s), p0.clone().add(u), p1.clone().add(u), p1.clone().add(u).add(s), p0.clone().add(u).add(s)]);
  }
  for (let i = 0; i < 4; i++) kbox(acc, m, f, R(-1.5, 1.5), 0.1, R(-1.5, 1.5), R(0.4, 1.0), R(0.2, 0.45), R(0.4, 0.9), 0.15);
  acc.flush(b);
}

/**
 * A hipped roof over any footprint: every eave runs along a wall (pushed out
 * by `over`), rising at `pitch` to a ridge line along the footprint's long
 * axis, so irregular plots from the plan keep their drawn shape. Plain tile
 * surface, a low eave fascia; two triangles per wall.
 */
export function polyRoof(b: Builder, c: V2[], h: number, pitch: number, over: number, acc?: Acc, rowPitch = 0.4, seg = 3, street = false) {
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
    if (acc) {
      const seen = street && (k === 0 || k === 1 || k === n - 1);
      polyFaceTiles(acc, A, Q, ra, rq, yE, ridgeH, e, out, seen ? rowPitch : 0.55, seen ? seg : 2, seen ? 0.5 : 1.0);
      // Boards under the overhang (seen from the lane), then the rafter ends
      // under them, from the wall head out to the fascia.
      const yS = (d: number) => h - d * pitch - 0.07;
      const P3 = (q: V2, y: number) => new THREE.Vector3(q.x, y, q.y);
      acc.quad('wood', P3(a.clone().addScaledVector(out, -0.12), yS(-0.12)), P3(q.clone().addScaledVector(out, -0.12), yS(-0.12)), P3(Q, yS(over)), P3(A, yS(over)), new THREE.Vector3((a.x + q.x) / 2, h + 3, (a.y + q.y) / 2));
      // (Only on the street front: elsewhere nobody stands under them.)
      for (let u = R(0.15, 0.35); street && k === 0 && u < L - 0.1; u += R(0.48, 0.62)) {
        const w0 = a.clone().addScaledVector(e, u).addScaledVector(out, -0.1), w1 = a.clone().addScaledVector(e, u).addScaledVector(out, over - R(0.0, 0.08));
        const y0 = h + 0.1 * pitch - 0.08, y1 = h - (over - 0.04) * pitch - 0.08;
        const sx = e.x * 0.045, sz = e.y * 0.045;
        const p = (q: V2, y: number, s: number, dy: number) => new THREE.Vector3(q.x + sx * s, y + dy, q.y + sz * s);
        acc.hexa('wood', [p(w0, y0, -1, -0.11), p(w0, y0, 1, -0.11), p(w1, y1, 1, -0.11), p(w1, y1, -1, -0.11), p(w0, y0, -1, 0), p(w0, y0, 1, 0), p(w1, y1, 1, 0), p(w1, y1, -1, 0)]);
      }
    }
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
  if (acc) {
    // The tiles ride the same bend as the boards under them: the underlay goes
    // through the kit too, cut fine enough to follow it.
    const P = (i: number) => new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]);
    const lim = DETAIL.mid ? 5 : 1.6;
    const split = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, d: number): void => {
      const lpq = p.distanceToSquared(q), lqr = q.distanceToSquared(r), lrp = r.distanceToSquared(p);
      const mx = Math.max(lpq, lqr, lrp);
      if (mx < lim * lim || d > 6) { acc.tri('roof', p, q, r); return; }
      if (mx === lpq) { const m = p.clone().add(q).multiplyScalar(0.5); split(p, m, r, d + 1); split(m, q, r, d + 1); }
      else if (mx === lqr) { const m = q.clone().add(r).multiplyScalar(0.5); split(p, q, m, d + 1); split(p, m, r, d + 1); }
      else { const m = r.clone().add(p).multiplyScalar(0.5); split(p, q, m, d + 1); split(m, q, r, d + 1); }
    };
    for (let i = 0; i < pos.length; i += 9) split(P(i), P(i + 3), P(i + 6), 0);
    return;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(g, 'roof', undefined, false, false);
}

/**
 * Coppi on one hipped face of a polygon roof: rows square to the eave from A
 * to Q, each running up the slope until it meets a hip or the ridge, in
 * lapped courses; a few tiles slipped or missing; hip tiles along both hips.
 */
function polyFaceTiles(acc: Acc, A: V2, Q: V2, ra: V2, rq: V2, yE: number, yR: number, e: V2, out: V2, rowPitch: number, seg = 3, course = 0.5) {
  const inw = out.clone().negate();
  // Plan distance from the eave line to the ridge points.
  const dA = ra.clone().sub(A).dot(inw), dQ = rq.clone().sub(A).dot(inw);
  if (dA < 0.3 && dQ < 0.3) return;
  const slopeK = (yR - yE) / Math.max(0.3, (dA + dQ) / 2);
  const yAt = (p: V2) => yE + Math.max(0, p.clone().sub(A).dot(inw)) * slopeK;
  // Exit of the up-slope ray from p through the hips/ridge.
  const segs: [V2, V2][] = [[A, ra], [ra, rq], [rq, Q]];
  const exitS = (p: V2) => {
    let best = Infinity;
    for (const [s0, s1] of segs) {
      const d = s1.clone().sub(s0);
      const den = inw.x * d.y - inw.y * d.x;
      if (Math.abs(den) < 1e-6) continue;
      const w = s0.clone().sub(p);
      const s = (w.x * d.y - w.y * d.x) / den, t = (w.x * inw.y - w.y * inw.x) / den;
      if (s > 0.02 && t >= -0.02 && t <= 1.02) best = Math.min(best, s);
    }
    return best;
  };
  const L = A.distanceTo(Q);
  // Tile 'up': the face normal, tilted towards the eave (downhill = out).
  const up3 = new THREE.Vector3(out.x * slopeK, 1, out.y * slopeK).normalize();
  const side = new THREE.Vector3(e.x, 0, e.y);
  for (let u = R(0.08, 0.2); u < L - 0.08; u += rowPitch + R(-0.02, 0.02)) {
    const p = A.clone().addScaledVector(e, u);
    const sMax = exitS(p) - 0.06;
    if (!(sMax > 0.25) || sMax > 40) continue;
    const nC = Math.max(1, Math.round((sMax * Math.hypot(1, slopeK)) / course));
    for (let k = 0; k < nC; k++) {
      if (rand() < 0.02) continue;
      const s0 = (sMax * k) / nC - (k ? 0.03 : 0), s1 = (sMax * (k + 1)) / nC;
      const q0 = p.clone().addScaledVector(inw, s0), q1 = p.clone().addScaledVector(inw, s1);
      const slip = rand() < 0.03 ? R(-0.12, 0.12) : 0;
      coppo(acc, 'roof', new THREE.Vector3(q0.x + e.x * slip, yAt(q0) + 0.03, q0.y + e.y * slip), new THREE.Vector3(q1.x + e.x * slip, yAt(q1) + 0.01, q1.y + e.y * slip), up3, side, 0.085, 0.07, seg);
    }
  }
  // Hip / ridge tiles: bigger coppi along the hip from A to ra.
  const hipLen = A.distanceTo(ra);
  const nH = Math.max(1, Math.round(hipLen / 0.42));
  const hd = ra.clone().sub(A).normalize();
  const hs = new THREE.Vector3(-hd.y, 0, hd.x);
  for (let i = 0; i < nH; i++) {
    const a = A.clone().lerp(ra, i / nH), q = A.clone().lerp(ra, (i + 1) / nH);
    coppo(acc, 'roof', new THREE.Vector3(a.x, yAt(a) + 0.05, a.y), new THREE.Vector3(q.x, yAt(q) + 0.04, q.y), new THREE.Vector3(0, 1, 0), hs, 0.11, 0.1);
  }
  if (ra.distanceTo(rq) > 0.3 && ra.clone().sub(A).dot(inw) > 0.2) {
    const nR = Math.max(1, Math.round(ra.distanceTo(rq) / 0.42));
    const rd = rq.clone().sub(ra).normalize();
    for (let i = 0; i < nR; i++) {
      const a = ra.clone().lerp(rq, i / nR), q = ra.clone().lerp(rq, (i + 1) / nR);
      coppo(acc, 'roof', new THREE.Vector3(a.x, yR + 0.06, a.y), new THREE.Vector3(q.x, yR + 0.05, q.y), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-rd.y, 0, rd.x), 0.12, 0.105);
    }
  }
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
      kbox(acc, 'iron', f, u, v, 0.02, R(0.18, 0.3), R(0.25, 0.4), 0.02);
      kbox(acc, m === 'brick' ? 'block' : 'wood', f, u, v + 0.3, 0.05, 0.4, 0.07, 0.05, 0.01);
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
