import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

// Draping at tailoring time. Loose garments (veils, hoods' capes, mantles)
// are cut as flat patterns, laid roughly over the body and let fall under
// gravity with position-based dynamics until they settle: their folds come
// from the cloth itself, as a cut piece of linen or wool hangs from where it
// is held, not from noise added to a fitted surface.
//
// The pattern gives the rest lengths (a circle cape's hem is longer than the
// cone it starts on, so it flutes; a veil's corners have more cloth than the
// shoulders they fall on, so they fold). The body is a few analytic shapes (the
// skull's ellipsoid, capsules) and a star-shaped field of the clothed trunk:
// for each height and bearing round the neck, how far out the outermost
// surface lies, and, from above, how high it rises.

export type Collider = (p: Float32Array, o: number, m: number) => boolean;

/** A skull, as an ellipsoid. */
export function ellipsoid(c: THREE.Vector3, rx: number, ry: number, rz: number): Collider {
  return (p, o, m) => {
    const dx = p[o] - c.x, dy = p[o + 1] - c.y, dz = p[o + 2] - c.z;
    const ax = rx + m, ay = ry + m, az = rz + m;
    const q = (dx / ax) ** 2 + (dy / ay) ** 2 + (dz / az) ** 2;
    if (q >= 1) return false;
    const s = 1 / Math.sqrt(q || 1e-9);
    p[o] = c.x + dx * s; p[o + 1] = c.y + dy * s; p[o + 2] = c.z + dz * s;
    return true;
  };
}

export function capsule(a: THREE.Vector3, b: THREE.Vector3, r: number): Collider {
  const d = b.clone().sub(a), L2 = d.lengthSq() || 1;
  return (p, o, m) => {
    let t = ((p[o] - a.x) * d.x + (p[o + 1] - a.y) * d.y + (p[o + 2] - a.z) * d.z) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = p[o] - a.x - d.x * t, qy = p[o + 1] - a.y - d.y * t, qz = p[o + 2] - a.z - d.z * t;
    const q2 = qx * qx + qy * qy + qz * qz, R = r + m;
    if (q2 >= R * R || q2 < 1e-12) return false;
    const s = R / Math.sqrt(q2);
    p[o] = a.x + d.x * t + qx * s; p[o + 1] = a.y + d.y * t + qy * s; p[o + 2] = a.z + d.z * t + qz * s;
    return true;
  };
}

/**
 * The clothed body as seen from a vertical axis (radius by height and
 * bearing) and from above (height by x, z). A point is inside where it is
 * both within the radius and under the top; it leaves by the shorter way.
 */
export function starField(bvh: MeshBVH, cx: number, cz: number, y0: number, y1: number, o: { dy?: number; na?: number; reach?: number; cell?: number; half?: number } = {}): Collider {
  const dy = o.dy ?? 0.01, NA = o.na ?? 72, reach = o.reach ?? 0.8, cell = o.cell ?? 0.012, half = o.half ?? 0.42;
  const NY = Math.ceil((y1 - y0) / dy) + 1;
  const R = new Float32Array(NY * NA);
  const ray = new THREE.Ray(), org = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let j = 0; j < NY; j++) for (let k = 0; k < NA; k++) {
    const a = (k / NA) * Math.PI * 2;
    dir.set(-Math.sin(a), 0, -Math.cos(a));
    ray.set(org.set(cx - dir.x * reach, y0 + j * dy, cz - dir.z * reach), dir);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    R[j * NA + k] = hit ? reach - hit.distance : 0;
  }
  const NH = Math.ceil((2 * half) / cell) + 1;
  const H = new Float32Array(NH * NH).fill(-1e3);
  dir.set(0, -1, 0);
  for (let i = 0; i < NH; i++) for (let k = 0; k < NH; k++) {
    ray.set(org.set(cx - half + i * cell, y1 + 0.5, cz - half + k * cell), dir);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    if (hit) H[i * NH + k] = hit.point.y;
  }
  const radius = (y: number, a: number) => {
    const fy = THREE.MathUtils.clamp((y - y0) / dy, 0, NY - 1.001), j = Math.floor(fy), ty = fy - j;
    let fa = (a / (Math.PI * 2)) * NA;
    fa = ((fa % NA) + NA) % NA;
    const k = Math.floor(fa), ta = fa - k, k1 = (k + 1) % NA;
    const r0 = R[j * NA + k] * (1 - ta) + R[j * NA + k1] * ta, r1 = R[(j + 1) * NA + k] * (1 - ta) + R[(j + 1) * NA + k1] * ta;
    return r0 * (1 - ty) + r1 * ty;
  };
  const top = (x: number, z: number) => {
    const fx = (x - cx + half) / cell, fz = (z - cz + half) / cell;
    if (fx < 0 || fz < 0 || fx >= NH - 1 || fz >= NH - 1) return -1e3;
    const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
    const a = H[i * NH + k], b = H[(i + 1) * NH + k], c = H[i * NH + k + 1], d = H[(i + 1) * NH + k + 1];
    // A cell half off the body: the lower of its corners is no surface.
    if (Math.min(a, b, c, d) < -100) return Math.max(a, b, c, d) < -100 ? -1e3 : Math.min(...[a, b, c, d].filter((v) => v > -100));
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  return (p, o, m) => {
    const x = p[o], y = p[o + 1], z = p[o + 2];
    if (y < y0 || y > y1) return false;
    const ex = x - cx, ez = z - cz, r = Math.hypot(ex, ez);
    const Rr = radius(y, Math.atan2(ex, ez)) + m;
    if (r >= Rr) return false;
    const Ht = top(x, z) + m;
    if (y >= Ht) return false;
    const up = Ht - y, out = Rr - r;
    if (up < out) p[o + 1] = Ht;
    else if (r > 1e-6) { p[o] = cx + (ex / r) * Rr; p[o + 2] = cz + (ez / r) * Rr; }
    return true;
  };
}

export interface DrapeOpts {
  /** Positions (in/out), xyz per particle. */
  pos: Float32Array;
  /** 0: held where it is. */
  free: Uint8Array;
  /** Pairs of particles and their rest lengths and stiffness (0-1). */
  edges: number[];
  rest: number[];
  stiff: number[];
  colliders: Collider[];
  /** Clearance kept from the colliders. */
  margin: number;
  steps?: number;
  iters?: number;
  /** Tangential damping on contact (0: slides, 1: sticks). */
  friction?: number;
  /**
   * Long-range tethers: each particle may get no further from the held point
   * `anchor[i]` (-1: none) than `anchorLen[i]` (its distance in the flat
   * pattern), which keeps a long fall from stretching like rubber.
   */
  anchor?: Int32Array;
  anchorLen?: Float32Array;
  /** Extra per-step hook (e.g. to keep a pinned line where it should be). */
  hook?: (pos: Float32Array, step: number) => void;
}

/** Let a piece of cloth fall and settle. */
export function drape(o: DrapeOpts) {
  const { pos: P, free, colliders, margin } = o;
  const E = Uint32Array.from(o.edges), rest = Float32Array.from(o.rest), stiff = Float32Array.from(o.stiff);
  const N = P.length / 3, steps = o.steps ?? 160, iters = o.iters ?? 10, fr = o.friction ?? 0.6;
  const Q = Float32Array.from(P);
  const dt = 1 / 60, g = -9.8 * dt * dt;
  const ne = rest.length;
  const contact = new Uint8Array(N);
  for (let s = 0; s < steps; s++) {
    // Strong damping: we want where it comes to rest, not how it swings there.
    const damp = 0.9;
    for (let i = 0; i < N; i++) {
      if (!free[i]) continue;
      const o3 = i * 3;
      const vx = (P[o3] - Q[o3]) * damp, vy = (P[o3 + 1] - Q[o3 + 1]) * damp, vz = (P[o3 + 2] - Q[o3 + 2]) * damp;
      Q[o3] = P[o3]; Q[o3 + 1] = P[o3 + 1]; Q[o3 + 2] = P[o3 + 2];
      P[o3] += vx; P[o3 + 1] += vy + g; P[o3 + 2] += vz;
    }
    for (let it = 0; it < iters; it++) {
      for (let e = 0; e < ne; e++) {
        const a = E[e * 2], b = E[e * 2 + 1], wa = free[a], wb = free[b], w = wa + wb;
        if (!w) continue;
        const ax = a * 3, bx = b * 3;
        const dx = P[bx] - P[ax], dy = P[bx + 1] - P[ax + 1], dz = P[bx + 2] - P[ax + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const c = ((len - rest[e]) / len) * stiff[e] / w;
        P[ax] += dx * c * wa; P[ax + 1] += dy * c * wa; P[ax + 2] += dz * c * wa;
        P[bx] -= dx * c * wb; P[bx + 1] -= dy * c * wb; P[bx + 2] -= dz * c * wb;
      }
      if (it === iters - 1) {
        // Strain limiting: linen and wool hardly stretch, whatever the solver's
        // stiffness: no structural spring may end longer than 4% over its rest.
        for (let pass = 0; pass < 3; pass++) for (let e = 0; e < ne; e++) {
          if (stiff[e] < 1) continue;
          const a = E[e * 2], b = E[e * 2 + 1], wa = free[a], wb = free[b], w = wa + wb;
          if (!w) continue;
          const ax = a * 3, bx = b * 3;
          const dx = P[bx] - P[ax], dy = P[bx + 1] - P[ax + 1], dz = P[bx + 2] - P[ax + 2];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz), lim = rest[e] * 1.04;
          if (len <= lim) continue;
          const c = (len - lim) / len / w;
          P[ax] += dx * c * wa; P[ax + 1] += dy * c * wa; P[ax + 2] += dz * c * wa;
          P[bx] -= dx * c * wb; P[bx + 1] -= dy * c * wb; P[bx + 2] -= dz * c * wb;
        }
      }
      if (o.anchor) {
        const A = o.anchor, AL = o.anchorLen!;
        for (let i = 0; i < N; i++) {
          const a = A[i];
          if (a < 0 || !free[i]) continue;
          const i3 = i * 3, a3 = a * 3;
          const dx = P[i3] - P[a3], dy = P[i3 + 1] - P[a3 + 1], dz = P[i3 + 2] - P[a3 + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d <= AL[i]) continue;
          const k = AL[i] / d;
          P[i3] = P[a3] + dx * k; P[i3 + 1] = P[a3 + 1] + dy * k; P[i3 + 2] = P[a3 + 2] + dz * k;
        }
      }
      for (let i = 0; i < N; i++) {
        if (!free[i]) continue;
        let hit = false;
        for (const c of colliders) hit = c(P, i * 3, margin) || hit;
        contact[i] = hit ? 1 : contact[i];
      }
    }
    // Friction: cloth resting on the body keeps most of its place.
    for (let i = 0; i < N; i++) {
      if (!contact[i]) continue;
      const o3 = i * 3;
      Q[o3] += (P[o3] - Q[o3]) * fr; Q[o3 + 1] += (P[o3 + 1] - Q[o3 + 1]) * fr; Q[o3 + 2] += (P[o3 + 2] - Q[o3 + 2]) * fr;
      contact[i] = 0;
    }
    o.hook?.(P, s);
  }
}

/** Tethers (see DrapeOpts.anchor) from every free particle to its nearest held one, in the pattern. */
export function tethers(n: number, free: Uint8Array, pat: (i: number) => [number, number], slack = 1.0) {
  const anchor = new Int32Array(n).fill(-1), anchorLen = new Float32Array(n);
  const held: number[] = [];
  for (let i = 0; i < n; i++) if (!free[i]) held.push(i);
  for (let i = 0; i < n; i++) {
    if (!free[i]) continue;
    const [x, y] = pat(i);
    let best = -1, bd = Infinity;
    for (const j of held) { const [hx, hy] = pat(j), d = Math.hypot(x - hx, y - hy); if (d < bd) { bd = d; best = j; } }
    anchor[i] = best; anchorLen[i] = bd * slack;
  }
  return { anchor, anchorLen };
}

/**
 * Edges of a rows x cols grid (optionally wrapping round its columns) with
 * rest lengths from a flat pattern: `pat(r, c)` gives the pattern point (2D, metres).
 * Structural, shear and bending (skip-one) springs.
 */
export function gridSprings(rows: number, cols: number, wrap: boolean, pat: (r: number, c: number) => [number, number], skip?: (r: number, c: number) => boolean, bend = 0.25) {
  const edges: number[] = [], rest: number[] = [], stiff: number[] = [];
  const id = (r: number, c: number) => r * cols + ((c + cols) % cols);
  const add = (r0: number, c0: number, r1: number, c1: number, k: number) => {
    if (r1 >= rows || (!wrap && c1 >= cols)) return;
    if (skip && (skip(r0, c0) || skip(r1, c1 % cols))) return;
    const a = pat(r0, c0), b = pat(r1, c1);
    edges.push(id(r0, c0), id(r1, c1));
    rest.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
    stiff.push(k);
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    add(r, c, r, c + 1, 1);
    add(r, c, r + 1, c, 1);
    add(r, c, r + 1, c + 1, 0.5);
    add(r, c + 1, r + 1, c, 0.5);
    add(r, c, r, c + 2, bend);
    add(r, c, r + 2, c, bend);
  }
  return { edges, rest, stiff };
}

/** A few passes of Laplacian smoothing over free grid vertices (takes the jitter out of a settled drape). */
export function smoothGrid(P: Float32Array, rows: number, cols: number, wrap: boolean, free: Uint8Array, passes = 1, k = 0.5) {
  const T = new Float32Array(P.length);
  for (let it = 0; it < passes; it++) {
    T.set(P);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!free[i]) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr;
        let cc = c + dc;
        if (rr < 0 || rr >= rows) continue;
        if (cc < 0 || cc >= cols) { if (!wrap) continue; cc = (cc + cols) % cols; }
        const j = (rr * cols + cc) * 3;
        sx += T[j]; sy += T[j + 1]; sz += T[j + 2]; n++;
      }
      if (n < 3) continue; // edges keep their line
      const o = i * 3;
      P[o] += (sx / n - P[o]) * k; P[o + 1] += (sy / n - P[o + 1]) * k; P[o + 2] += (sz / n - P[o + 2]) * k;
    }
  }
}
