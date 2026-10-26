import * as THREE from 'three';
import type { Builder } from '../builder';
import { rng, DETAIL } from '../builder';
import type { MatName } from '../materials';
import { field, tessellate } from '../displace';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// A small kit for hand-built architecture: everything is emitted as raw
// triangles into per-material accumulators and handed to the Builder in one
// piece per house (already fine enough, so the Builder only bends it).
// Solids are given as 8 corners; faces are wound outward automatically, so
// callers never have to think about handedness.

let rand = rng(90210);

/** Restart the kit's random sequence (each streamed chunk builds from its own seed). */
export function reseedKit(seed: number) { rand = rng(seed); }
/**
 * Run fn on its own random stream (seeded), then give the kit its old stream
 * back: decoration built only at full detail must not shift the draws of
 * what comes after it, or the middle detail would no longer match.
 */
export function withStream<T>(seed: number, fn: () => T): T {
  const keep = rand;
  rand = rng(seed);
  try { return fn(); } finally { rand = keep; }
}
export const R = (a: number, b: number) => a + (b - a) * rand();
export const chance = (p: number) => rand() < p;

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = v3(), _b = v3(), _n = v3(), _c = v3();

/** Edge wear per material (metres): dressed stone more, brick a little, timber none. */
/** Corner jitter per material (metres, capped at 9% of the block's smallest edge). */
const IRREG: Partial<Record<MatName, number>> = { block: 0.03, stone: 0.03, bigstone: 0.045, rubble: 0.045, marble: 0.02, slab: 0.025, brick: 0.012, plaster: 0.03, roof: 0.01 };
const BEVEL: Partial<Record<MatName, number>> = { block: 0.035, stone: 0.035, bigstone: 0.045, marble: 0.03, rubble: 0.04, slab: 0.025, brick: 0.02, plaster: 0.04 };

/** Numeric key for a position on a 4 mm lattice (±250 m around the origin set by keyOrigin). */
let KO = [0, 0, 0];
const keyOrigin = (a: ArrayLike<number>) => { KO = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0]; };
const key = (x: number, y: number, z: number) =>
  ((Math.round((x - KO[0]) * 250) + 65536) * 131072 + (Math.round((y - KO[1]) * 250) + 65536)) * 131072 + (Math.round((z - KO[2]) * 250) + 65536);

export class Acc {
  private parts = new Map<MatName, number[]>();
  tris = 0;

  private arr(m: MatName) {
    let a = this.parts.get(m);
    if (!a) this.parts.set(m, (a = []));
    return a;
  }

  /** A triangle, flipped if needed so its normal points away from `inside`. */
  tri(m: MatName, p: V3, q: V3, r: V3, inside?: V3) {
    _a.subVectors(q, p); _b.subVectors(r, p); _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-14) return;
    let A = p, B = q;
    if (inside) {
      _c.set((p.x + q.x + r.x) / 3 - inside.x, (p.y + q.y + r.y) / 3 - inside.y, (p.z + q.z + r.z) / 3 - inside.z);
      if (_n.dot(_c) < 0) { A = q; B = p; }
    }
    this.arr(m).push(A.x, A.y, A.z, B.x, B.y, B.z, r.x, r.y, r.z);
    this.tris++;
  }

  quad(m: MatName, p: V3, q: V3, r: V3, s: V3, inside?: V3) {
    this.tri(m, p, q, r, inside);
    this.tri(m, p, r, s, inside);
  }

  /**
   * A hexahedron from 8 corners: bottom face 0-3, top face 4-7 (same order).
   * Stone-like materials get worn, chamfered edges (a narrow bevel along every
   * edge and a facet at every corner): no stone in a medieval wall has a
   * knife-sharp arris, and the bevels catch the light the way real ones do.
   */
  hexa(m: MatName, c: V3[], keep = false, flat = false) {
    // Nothing hand-made is square: nudge every corner of a block a little
    // (more for rough stone, less for brick), so edges are never ruled lines.
    // (`flat`: a mass of masonry, not a block: no jitter, no worn edges.)
    const irr = flat ? 0 : IRREG[m] ?? 0;
    if (irr > 0) {
      let minEdge = Infinity;
      for (let i = 0; i < 4; i++) minEdge = Math.min(minEdge, c[i].distanceTo(c[(i + 1) % 4]), c[i].distanceTo(c[i + 4]));
      const j = Math.min(irr, minEdge * 0.09);
      c = c.map((p) => p.clone().add(v3(R(-j, j), R(-j, j), R(-j, j))));
    }
    const ctr = v3();
    for (const p of c) ctr.add(p);
    ctr.multiplyScalar(1 / 8);
    let small = false;
    if (DETAIL.mid && !keep) { let r2 = 0; for (const p of c) r2 = Math.max(r2, p.distanceToSquared(ctr)); small = r2 < 0.25 * 0.25; }
    const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    const bev = flat ? 0 : BEVEL[m] ?? 0;
    if (bev > 0) {
      let minEdge = Infinity;
      for (const f of F) for (let i = 0; i < 4; i++) minEdge = Math.min(minEdge, c[f[i]].distanceTo(c[f[(i + 1) % 4]]));
      // Wear grows with the piece: 2-4 cm on a stone, up to 12 cm on a wall end.
      const r = Math.min(Math.max(bev * R(0.7, 1.3), minEdge * 0.12), minEdge * 0.3, 0.12);
      if (r > 0.003 && !DETAIL.mid) { this.bevelled(m, c, F, ctr, r); return; }
    }
    if (small) return;
    for (const [a, b, cc, d] of F) this.quad(m, c[a], c[b], c[cc], c[d], ctr);
  }
  private bevelled(m: MatName, c: V3[], F: number[][], ctr: V3, r: number) {
    // Q(f, k): corner k pulled into face f along its two in-face edges.
    const Q = (fi: number, k: number) => {
      const f = F[fi], i = f.indexOf(k);
      const p = c[f[(i + 3) % 4]], n = c[f[(i + 1) % 4]];
      const d1 = v3().subVectors(p, c[k]).normalize(), d2 = v3().subVectors(n, c[k]).normalize();
      return c[k].clone().addScaledVector(d1, r).addScaledVector(d2, r);
    };
    const q = F.map((f, fi) => f.map((k) => Q(fi, k)));
    for (let fi = 0; fi < 6; fi++) this.quad(m, q[fi][0], q[fi][1], q[fi][2], q[fi][3], ctr);
    // Edge bevels: for every edge shared by two faces.
    const seen = new Set<string>();
    for (let f1 = 0; f1 < 6; f1++) for (let i = 0; i < 4; i++) {
      const a = F[f1][i], b = F[f1][(i + 1) % 4];
      const key2 = a < b ? a + ',' + b : b + ',' + a;
      if (seen.has(key2)) continue;
      seen.add(key2);
      const f2 = F.findIndex((f, fi) => fi !== f1 && f.includes(a) && f.includes(b));
      if (f2 < 0) continue;
      this.quad(m, q[f1][F[f1].indexOf(a)], q[f1][F[f1].indexOf(b)], q[f2][F[f2].indexOf(b)], q[f2][F[f2].indexOf(a)], ctr);
    }
    // Corner facets.
    for (let k = 0; k < 8; k++) {
      const fs = F.map((f, fi) => (f.includes(k) ? fi : -1)).filter((x) => x >= 0);
      this.tri(m, q[fs[0]][F[fs[0]].indexOf(k)], q[fs[1]][F[fs[1]].indexOf(k)], q[fs[2]][F[fs[2]].indexOf(k)], ctr);
    }
  }


  /**
   * Flush everything into the Builder (no collision). The pieces are bent by
   * the world field here, once per distinct corner (blocks share many), and
   * keep flat facets so every block reads as a block.
   */
  flush(b: Builder) {
    const cache = new Map<number, THREE.Vector3>();
    const d = v3();
    for (const [m, a] of this.parts) {
      if (!a.length) continue;
      keyOrigin(a);
      for (let i = 0; i < a.length; i += 3) {
        const k = key(a[i], a[i + 1], a[i + 2]);
        let o = cache.get(k);
        if (!o) { field(a[i], a[i + 1], a[i + 2], 'stone', d); o = d.clone(); cache.set(k, o); }
        a[i] += o.x; a[i + 1] += o.y; a[i + 2] += o.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      g.computeVertexNormals();
      const sm = toCreasedNormals(g, (50 * Math.PI) / 180);
      g.setAttribute('normal', sm.attributes.normal);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((a.length / 3) * 2), 2));
      b.add(g, m, undefined, false, true, true);
    }
    this.parts.clear();
  }
}

/**
 * A local frame on a façade: u along the wall, v up, w out of the wall
 * (towards the street). p = o + x·u + y·v + z·w.
 */
export class Frame {
  constructor(public o: V3, public x: V3, public y: V3, public z: V3) {}
  p(u: number, v: number, w: number) {
    return v3(this.o.x + this.x.x * u + this.y.x * v + this.z.x * w, this.o.y + this.x.y * u + this.y.y * v + this.z.y * w, this.o.z + this.x.z * u + this.y.z * v + this.z.z * w);
  }
  static facade(ax: number, az: number, ex: number, ez: number, outx: number, outz: number, y0 = 0) {
    return new Frame(v3(ax, y0, az), v3(ex, 0, ez), v3(0, 1, 0), v3(outx, 0, outz));
  }
}

/** A box in a frame: centre (u,v,w), half sizes, optional skew so nothing is square. */
export function box(acc: Acc, m: MatName, f: Frame, u: number, v: number, w: number, hu: number, hv: number, hw: number, jit = 0, flat = false) {
  const J = () => (jit ? R(-jit, jit) : 0);
  const c: V3[] = [];
  for (const dv of [-1, 1]) for (const [du, dw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    c.push(f.p(u + du * hu + J(), v + dv * hv + J(), w + dw * hw + J()));
  }
  acc.hexa(m, c, false, flat);
}

/**
 * Voussoirs: an arch of individual wedge-shaped blocks around (cu, cv) in the
 * façade plane, from angle a0 to a1 (0 = right, π = left), between radii r0 and
 * r1, from depth w0 to w1. Irregular joints, uneven extrados, a bigger keystone.
 */
export function voussoirs(acc: Acc, m: MatName, f: Frame, cu: number, cv: number, r0: number, r1: number, w0: number, w1: number,
  a0 = 0, a1 = Math.PI, blk = 0.2) {
  const span = (a1 - a0) * (r0 + r1) / 2;
  const n = Math.max(5, Math.round(span / blk) | 1);
  const gap = 0.012 / ((r0 + r1) / 2);
  const archSag = R(0.02, 0.06), archLean = R(-0.02, 0.02);
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n + gap, t1 = a0 + ((a1 - a0) * (i + 1)) / n - gap;
    const key = i === (n >> 1);
    const ro = r1 + (key ? 0.07 : 0) + R(-0.07, 0.06);
    const pr = R(0.02, 0.06);
    // Centuries of settling: the crown has dropped a little and the arch leans.
    const sag = (a: number) => 1 - archSag * Math.sin(a) ** 4 + archLean * Math.cos(a);
    const ri0 = r0 + R(-0.025, 0.025), ri1 = r0 + R(-0.025, 0.025);
    const c: V3[] = [];
    for (const w of [w0 - 0.01 + R(-0.01, 0.01), w1 + pr]) {
      for (const [a, r] of [[t0, ri0], [t1, ri1], [t1, ro], [t0, ro + R(-0.03, 0.03)]] as const) {
        c.push(f.p(cu + Math.cos(a) * r * sag(a), cv + Math.sin(a) * r * sag(a), w));
      }
    }
    acc.hexa(m, [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]);
  }
}

/** Planks side by side in a frame, from u0 to u1, height given per plank (arched tops allowed). */
export function planks(acc: Acc, m: MatName, f: Frame, u0: number, u1: number, v0: number, top: (u: number) => number, w: number, th = 0.05, pw = 0.16) {
  // Boards of uneven width, each bowed and slightly twisted along its length,
  // with gaps that open and close and ends that are never quite square.
  const widths: number[] = [];
  let tot = 0;
  while (tot < u1 - u0 - 0.04) { const pwi = pw * R(0.7, 1.35); widths.push(pwi); tot += pwi; }
  const k = (u1 - u0) / tot;
  let u = u0;
  if (DETAIL.mid) {
    // One board-faced slab instead of every plank (same draws, same extent).
    let tops = 0;
    for (let i = 0; i < widths.length; i++) { R(0, 1); R(0, 1); tops += top(u0 + (u1 - u0) * (i + 0.5) / widths.length); R(0, 1); R(0, 1); R(0, 1); R(0, 1); R(0, 1); }
    const t = tops / Math.max(1, widths.length);
    acc.hexa(m, [f.p(u0, v0, w - th), f.p(u1, v0, w - th), f.p(u1, v0, w), f.p(u0, v0, w), f.p(u0, t, w - th), f.p(u1, t, w - th), f.p(u1, t, w), f.p(u0, t, w)], true);
    return;
  }
  for (const wd of widths) {
    const a = u + R(0.003, 0.012), b = u + wd * k - R(0.003, 0.012);
    u += wd * k;
    const ta = top(a) + R(-0.03, 0.015), tb = top(b) + R(-0.03, 0.015);
    const bow = R(-0.012, 0.012), twist = R(-0.01, 0.01), lean = R(-0.008, 0.008);
    const segs = Math.max(2, Math.round(((ta + tb) / 2 - v0) / 0.45));
    for (let sI = 0; sI < segs; sI++) {
      const t0 = sI / segs, t1 = (sI + 1) / segs;
      const off = (t: number) => bow * Math.sin(Math.PI * t);
      const tw = (t: number) => twist * (t - 0.5);
      const ya = (t: number) => v0 + (ta - v0) * t, yb = (t: number) => v0 + (tb - v0) * t;
      const sh = (t: number) => lean * t;
      const c = [
        f.p(a + sh(t0), ya(t0), w - th + off(t0) - tw(t0)), f.p(b + sh(t0), yb(t0), w - th + off(t0) + tw(t0)),
        f.p(b + sh(t0), yb(t0), w + off(t0) + tw(t0)), f.p(a + sh(t0), ya(t0), w + off(t0) - tw(t0)),
        f.p(a + sh(t1), ya(t1), w - th + off(t1) - tw(t1)), f.p(b + sh(t1), yb(t1), w - th + off(t1) + tw(t1)),
        f.p(b + sh(t1), yb(t1), w + off(t1) + tw(t1)), f.p(a + sh(t1), ya(t1), w + off(t1) - tw(t1)),
      ];
      acc.hexa(m, c);
    }
  }
}

/** A half-tube strip (a coppo course) between two points, radius tapering r0→r1, faces up. */
export function coppo(acc: Acc, m: MatName, p0: V3, p1: V3, up: V3, side: V3, r0: number, r1: number, seg = 3) {
  if (DETAIL.mid) return; // the underlay's tile texture carries the roof at mid distance
  const ring = (p: V3, r: number) => {
    const out: V3[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI;
      out.push(v3().copy(p).addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r * 0.85));
    }
    return out;
  };
  const A = ring(p0, r0), B = ring(p1, r1);
  const below = v3().copy(p0).add(p1).multiplyScalar(0.5).addScaledVector(up, -1);
  for (let k = 0; k < seg; k++) acc.quad(m, A[k], A[k + 1], B[k + 1], B[k], below);
}

/**
 * Add a plain-surfaced piece (wall panel, vault): subdivided like everything
 * else, bent by the world field with a per-corner cache, original normals kept.
 */
/**
 * tessellate() splits every triangle on its own (n from its longest edge), so
 * two neighbours split their shared edge differently: the finer one's points
 * sit on the coarser one's edge (T-junctions). Bent by the field, those points
 * leave the straight edge and open hairline cracks: the dark dashed lines that
 * ran down the house fronts above every opening (the shape triangulation of a
 * wall with holes is all long slivers from the holes' corners). Here every
 * triangle with points of its neighbours on its edges is re-made as a fan from
 * its centroid through those points, so the mesh is watertight before it bends.
 */
export function closeTJunctions(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const P = g.attributes.position.array as ArrayLike<number>;
  const N = g.attributes.normal?.array as ArrayLike<number> | undefined;
  const nv = P.length / 3;
  const C = 0.5, cell = (x: number) => Math.floor(x / C);
  const grid = new Map<string, number[]>();
  const seen = new Set<string>();
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(P[i * 3] * 2000)},${Math.round(P[i * 3 + 1] * 2000)},${Math.round(P[i * 3 + 2] * 2000)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const gk = `${cell(P[i * 3])},${cell(P[i * 3 + 1])},${cell(P[i * 3 + 2])}`;
    let l = grid.get(gk);
    if (!l) grid.set(gk, (l = []));
    l.push(i);
  }
  const eps = 6e-4;
  /** Vertices strictly inside segment a-b (as [t, index]), sorted by t. */
  const onEdge = (a: number, b: number) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], dx = P[b * 3] - ax, dy = P[b * 3 + 1] - ay, dz = P[b * 3 + 2] - az;
    const L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1e-8) return [];
    const out: [number, number][] = [];
    const x0 = cell(Math.min(ax, ax + dx) - eps), x1 = cell(Math.max(ax, ax + dx) + eps);
    const y0 = cell(Math.min(ay, ay + dy) - eps), y1 = cell(Math.max(ay, ay + dy) + eps);
    const z0 = cell(Math.min(az, az + dz) - eps), z1 = cell(Math.max(az, az + dz) + eps);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (let k = z0; k <= z1; k++) {
      const l = grid.get(`${i},${j},${k}`);
      if (!l) continue;
      for (const v of l) {
        const px = P[v * 3] - ax, py = P[v * 3 + 1] - ay, pz = P[v * 3 + 2] - az;
        const t = (px * dx + py * dy + pz * dz) / L2;
        if (t <= 1e-4 || t >= 1 - 1e-4) continue;
        const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t;
        if (ex * ex + ey * ey + ez * ez < eps * eps) out.push([t, v]);
      }
    }
    return out.sort((p, q) => p[0] - q[0]);
  };
  const pos: number[] = [], nor: number[] = [];
  const push = (i: number) => { pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); nor.push(N ? N[i * 3] : 0, N ? N[i * 3 + 1] : 0, N ? N[i * 3 + 2] : 0); };
  let fixed = 0;
  for (let t = 0; t < nv; t += 3) {
    const ring: number[] = [];
    const extra: number[][] = [];
    for (let e = 0; e < 3; e++) {
      const a = t + e, b = t + ((e + 1) % 3);
      ring.push(a);
      const on = onEdge(a, b).map(([, v]) => v);
      extra.push(on);
      ring.push(...on);
    }
    if (ring.length === 3) { push(t); push(t + 1); push(t + 2); continue; }
    fixed++;
    const withPts = extra.filter((x) => x.length).length;
    if (withPts === 1) {
      // Points on one edge only: fan from the opposite corner.
      const e = extra.findIndex((x) => x.length);
      const a = t + e, b = t + ((e + 1) % 3), c = t + ((e + 2) % 3);
      const chain = [a, ...extra[e], b];
      for (let i = 0; i + 1 < chain.length; i++) { push(c); push(chain[i]); push(chain[i + 1]); }
      continue;
    }
    // Fan from the centroid (all points are on the triangle's boundary, so no sliver is degenerate).
    const cx = (P[t * 3] + P[t * 3 + 3] + P[t * 3 + 6]) / 3, cy = (P[t * 3 + 1] + P[t * 3 + 4] + P[t * 3 + 7]) / 3, cz = (P[t * 3 + 2] + P[t * 3 + 5] + P[t * 3 + 8]) / 3;
    const cn = N ? [(N[t * 3] + N[t * 3 + 3] + N[t * 3 + 6]) / 3, (N[t * 3 + 1] + N[t * 3 + 4] + N[t * 3 + 7]) / 3, (N[t * 3 + 2] + N[t * 3 + 5] + N[t * 3 + 8]) / 3] : [0, 0, 0];
    for (let i = 0; i < ring.length; i++) {
      pos.push(cx, cy, cz); nor.push(cn[0], cn[1], cn[2]);
      push(ring[i]); push(ring[(i + 1) % ring.length]);
    }
  }
  if (!fixed) return g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return out;
}

export function addBent(b: Builder, g: THREE.BufferGeometry, m: MatName, M?: THREE.Matrix4) {
  let geo = g.index ? g.toNonIndexed() : g;
  if (M) geo.applyMatrix4(M);
  geo = closeTJunctions(tessellate(geo, m));
  const a = geo.attributes.position.array as Float32Array;
  keyOrigin(a);
  const cache = new Map<number, number[]>();
  const d = v3();
  for (let i = 0; i < a.length; i += 3) {
    const k = key(a[i], a[i + 1], a[i + 2]);
    let o = cache.get(k);
    if (!o) { field(a[i], a[i + 1], a[i + 2], m, d); o = [d.x, d.y, d.z]; cache.set(k, o); }
    a[i] += o[0]; a[i + 1] += o[1]; a[i + 2] += o[2];
  }
  b.add(geo, m, undefined, false, true, true);
}
