import * as THREE from 'three';
import type { Builder } from '../builder';
import { rng } from '../builder';
import type { MatName } from '../materials';
import { field, tessellate } from '../displace';

// A small kit for hand-built architecture: everything is emitted as raw
// triangles into per-material accumulators and handed to the Builder in one
// piece per house (already fine enough, so the Builder only bends it).
// Solids are given as 8 corners; faces are wound outward automatically, so
// callers never have to think about handedness.

const rand = rng(90210);
export const R = (a: number, b: number) => a + (b - a) * rand();
export const chance = (p: number) => rand() < p;

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = v3(), _b = v3(), _n = v3(), _c = v3();

/** Edge wear per material (metres): dressed stone more, brick a little, timber none. */
const BEVEL: Partial<Record<MatName, number>> = { block: 0.03, stone: 0.03, bigstone: 0.04, marble: 0.025, rubble: 0.035, slab: 0.02, brick: 0.012 };

/** Numeric key for a position on a 4 mm lattice (±250 m). */
const key = (x: number, y: number, z: number) =>
  ((Math.round(x * 250) + 65536) * 131072 + (Math.round(y * 250) + 65536)) * 131072 + (Math.round(z * 250) + 65536);

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
  hexa(m: MatName, c: V3[]) {
    const ctr = v3();
    for (const p of c) ctr.add(p);
    ctr.multiplyScalar(1 / 8);
    const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    const bev = BEVEL[m] ?? 0;
    if (bev > 0) {
      let minEdge = Infinity;
      for (const f of F) for (let i = 0; i < 4; i++) minEdge = Math.min(minEdge, c[f[i]].distanceTo(c[f[(i + 1) % 4]]));
      const r = Math.min(bev * R(0.7, 1.3), minEdge * 0.22);
      if (r > 0.003) { this.bevelled(m, c, F, ctr, r); return; }
    }
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
      for (let i = 0; i < a.length; i += 3) {
        const k = key(a[i], a[i + 1], a[i + 2]);
        let o = cache.get(k);
        if (!o) { field(a[i], a[i + 1], a[i + 2], 'stone', d); o = d.clone(); cache.set(k, o); }
        a[i] += o.x; a[i + 1] += o.y; a[i + 2] += o.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      g.computeVertexNormals();
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
export function box(acc: Acc, m: MatName, f: Frame, u: number, v: number, w: number, hu: number, hv: number, hw: number, jit = 0) {
  const J = () => (jit ? R(-jit, jit) : 0);
  const c: V3[] = [];
  for (const dv of [-1, 1]) for (const [du, dw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    c.push(f.p(u + du * hu + J(), v + dv * hv + J(), w + dw * hw + J()));
  }
  acc.hexa(m, c);
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
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n + gap, t1 = a0 + ((a1 - a0) * (i + 1)) / n - gap;
    const key = i === (n >> 1);
    const ro = r1 + (key ? 0.06 : 0) + R(-0.035, 0.035);
    const pr = R(0.025, 0.05);
    const c: V3[] = [];
    for (const w of [w0 - 0.01, w1 + pr]) {
      for (const [a, r] of [[t0, r0], [t1, r0], [t1, ro], [t0, ro]] as const) {
        c.push(f.p(cu + Math.cos(a) * r, cv + Math.sin(a) * r, w));
      }
    }
    acc.hexa(m, [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]);
  }
}

/** Planks side by side in a frame, from u0 to u1, height given per plank (arched tops allowed). */
export function planks(acc: Acc, m: MatName, f: Frame, u0: number, u1: number, v0: number, top: (u: number) => number, w: number, th = 0.05, pw = 0.16) {
  const n = Math.max(2, Math.round((u1 - u0) / pw));
  const step = (u1 - u0) / n;
  for (let i = 0; i < n; i++) {
    const a = u0 + i * step + 0.006, b = u0 + (i + 1) * step - 0.006;
    const ta = top(a) + R(-0.015, 0.01), tb = top(b) + R(-0.015, 0.01);
    const sink = R(-0.008, 0.008);
    const c = [f.p(a, v0, w - th + sink), f.p(b, v0, w - th + sink), f.p(b, v0, w + sink), f.p(a, v0, w + sink),
      f.p(a, ta, w - th + sink), f.p(b, tb, w - th + sink), f.p(b, tb, w + sink), f.p(a, ta, w + sink)];
    acc.hexa(m, c);
  }
}

/** A half-tube strip (a coppo course) between two points, radius tapering r0→r1, faces up. */
export function coppo(acc: Acc, m: MatName, p0: V3, p1: V3, up: V3, side: V3, r0: number, r1: number, seg = 3) {
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
export function addBent(b: Builder, g: THREE.BufferGeometry, m: MatName, M?: THREE.Matrix4) {
  let geo = g.index ? g.toNonIndexed() : g;
  if (M) geo.applyMatrix4(M);
  geo = tessellate(geo, m);
  const a = geo.attributes.position.array as Float32Array;
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
