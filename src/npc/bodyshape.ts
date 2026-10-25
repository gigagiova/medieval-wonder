import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

// The clothed body as simple shapes, for laying loose garments over it at
// tailoring time (garment.ts: layHood, layMantle): a garment's fall is
// stepped down from where it leaves the head or the shoulders and pushed out
// of these wherever it would go in.

/** Push the point at p[o..o+2] out of the shape (with clearance m); true if it was inside. */
export type Collider = (p: Float32Array, o: number, m: number) => boolean;

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
