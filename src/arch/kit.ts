import * as THREE from 'three';
import type { Builder } from '../builder';
import { rng } from '../builder';
import type { MatName } from '../materials';

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

  /** A hexahedron from 8 corners: bottom face 0-3, top face 4-7 (same order). */
  hexa(m: MatName, c: V3[]) {
    const ctr = v3();
    for (const p of c) ctr.add(p);
    ctr.multiplyScalar(1 / 8);
    const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    for (const [a, b, cc, d] of F) this.quad(m, c[a], c[b], c[cc], c[d], ctr);
  }

  /** Flush everything into the Builder (no collision; bent by the world field). */
  flush(b: Builder) {
    for (const [m, a] of this.parts) {
      if (!a.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      g.computeVertexNormals();
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((a.length / 3) * 2), 2));
      b.add(g, m, undefined, false, true);
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
    const pr = R(0, 0.025);
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
