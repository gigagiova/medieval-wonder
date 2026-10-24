import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Human skull and long bones sculpted as signed distance fields and meshed
// with surface nets at load. Baked ambient occlusion goes in a `color`
// attribute so eye sockets and the nasal cavity stay dark in torchlight.

export interface BoneSet {
  skull: THREE.BufferGeometry;
  femur: THREE.BufferGeometry;
  humerus: THREE.BufferGeometry;
  tibia: THREE.BufferGeometry;
  jaw?: THREE.BufferGeometry;
}

type V = [number, number, number];
type SDF = (x: number, y: number, z: number) => number;

// ---------- SDF toolkit ----------
const sphere = (x: number, y: number, z: number, c: V, r: number) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
function ellipsoid(x: number, y: number, z: number, c: V, r: V) {
  const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
  const k0 = Math.hypot(px, py, pz);
  const k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
  return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
}
function capsule(x: number, y: number, z: number, a: V, b: V, r: number) {
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
function roundBox(x: number, y: number, z: number, c: V, h: V, r: number) {
  const qx = Math.abs(x - c[0]) - h[0], qy = Math.abs(y - c[1]) - h[1], qz = Math.abs(z - c[2]) - h[2];
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

// Small value noise for organic irregularity.
const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
{
  let s = 977;
  const r = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) VAL[i] = r() * 2 - 1;
}
function noise(x: number, y: number, z: number) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const xi = fx & 255, yi = fy & 255, zi = fz & 255;
  let u = x - fx, v = y - fy, w = z - fz;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); w = w * w * (3 - 2 * w);
  const a = PERM[xi] + yi, b = PERM[xi + 1] + yi;
  const aa = PERM[a] + zi, ab = PERM[a + 1] + zi, ba = PERM[b] + zi, bb = PERM[b + 1] + zi;
  const x1 = VAL[PERM[aa]] + (VAL[PERM[ba]] - VAL[PERM[aa]]) * u;
  const x2 = VAL[PERM[ab]] + (VAL[PERM[bb]] - VAL[PERM[ab]]) * u;
  const x3 = VAL[PERM[aa + 1]] + (VAL[PERM[ba + 1]] - VAL[PERM[aa + 1]]) * u;
  const x4 = VAL[PERM[ab + 1]] + (VAL[PERM[bb + 1]] - VAL[PERM[ab + 1]]) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}
const bumps = (x: number, y: number, z: number, amp: number, f: number) => amp * noise(x * f + 3.1, y * f + 7.7, z * f + 1.3);

// ---------- Skull (face toward +Z, up +Y; metres) ----------
const skullSDF: SDF = (x, y, z) => {
  // Cheap early-out far from the bone keeps the grid pass fast.
  const bound = ellipsoid(x, y, z, [0, 0.085, 0], [0.085, 0.09, 0.125]);
  if (bound > 0.02) return bound;
  const ax = Math.abs(x);
  // Cranial vault, slightly wider behind the ears, with an occipital bulge.
  let d = ellipsoid(x, y, z, [0, 0.092, -0.012], [0.069, 0.071, 0.094]);
  d = smin(d, ellipsoid(x, y, z, [0, 0.078, -0.07], [0.056, 0.05, 0.045]), 0.02);
  // Flatten the cranial base.
  d = smax(d, -(y - 0.035 + 0.25 * Math.max(0, -z - 0.02)), 0.02);
  // Brow ridge.
  d = smin(d, capsule(ax, y, z, [0.0, 0.088, 0.078], [0.046, 0.087, 0.07], 0.009), 0.012);
  // Facial skeleton: maxilla narrowing to the rounded alveolar arch.
  d = smin(d, roundBox(x, y, z, [0, 0.05, 0.072], [0.026, 0.014, 0.016], 0.007), 0.014);
  d = smin(d, ellipsoid(x, y, z, [0, 0.031, 0.072], [0.03, 0.013, 0.021]), 0.012);
  // Canine eminences either side of the nose.
  d = smin(d, capsule(ax, y, z, [0.017, 0.022, 0.09], [0.014, 0.05, 0.087], 0.0045), 0.008);
  // Cheekbones and zygomatic arches running back to the ear.
  d = smin(d, ellipsoid(ax, y, z, [0.047, 0.052, 0.062], [0.016, 0.016, 0.016]), 0.012);
  d = smin(d, capsule(ax, y, z, [0.054, 0.05, 0.05], [0.066, 0.052, -0.005], 0.006), 0.008);
  // Mastoid processes.
  d = smin(d, ellipsoid(ax, y, z, [0.055, 0.03, -0.022], [0.009, 0.014, 0.01]), 0.012);
  // Upper teeth: a row of little pegs along the dental arch.
  for (let i = -3; i <= 3; i++) {
    const tx = i * 0.0072;
    const tz = 0.088 - 9.5 * tx * tx;
    d = smin(d, capsule(x, y, z, [tx, 0.007, tz + 0.001], [tx * 1.02, 0.022, tz - 0.002], 0.0036), 0.0012);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    const tx = s * (0.026 + i * 0.006), tz = 0.088 - 9.5 * 0.026 * 0.026 - 0.008 - i * 0.008;
    d = smin(d, capsule(x, y, z, [tx, 0.009, tz], [tx, 0.022, tz], 0.0044), 0.0015);
  }
  // Temporal hollows behind the eyes.
  d = smax(d, -ellipsoid(ax, y, z, [0.082, 0.07, 0.025], [0.02, 0.026, 0.03]), 0.012);
  // Hollow beneath each zygomatic arch.
  d = smax(d, -ellipsoid(ax, y, z, [0.054, 0.034, 0.02], [0.011, 0.012, 0.024]), 0.006);
  // Orbits: deep, slightly squared sockets.
  d = smax(d, -ellipsoid(ax, y, z, [0.03, 0.064, 0.086], [0.019, 0.016, 0.034]), 0.006);
  d = smax(d, -roundBox(ax, y, z, [0.03, 0.064, 0.095], [0.012, 0.009, 0.02], 0.006), 0.004);
  // Pear-shaped nasal aperture.
  d = smax(d, -ellipsoid(x, y, z, [0, 0.036, 0.094], [0.011, 0.013, 0.03]), 0.004);
  d = smax(d, -ellipsoid(x, y, z, [0, 0.05, 0.094], [0.006, 0.012, 0.028]), 0.004);
  // Foramen-ish hollow under the base so the skull doesn't look solid.
  d = smax(d, -ellipsoid(x, y, z, [0, 0.0, -0.02], [0.03, 0.03, 0.045]), 0.01);
  return d + bumps(x, y, z, 0.0007, 90);
};

const jawSDF: SDF = (x, y, z) => {
  const bound = ellipsoid(x, y, z, [0, 0.005, 0.05], [0.07, 0.05, 0.06]);
  if (bound > 0.02) return bound;
  const ax = Math.abs(x);
  let d = 1;
  // U-shaped body following the dental arch.
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const px = t * 0.046, pz = 0.082 - 18 * px * px;
    const nx = (t + 1 / 8) * 0.046, nz = 0.082 - 18 * nx * nx;
    if (i < 8) d = smin(d, capsule(ax, y, z, [px, -0.008 - t * 0.002, pz], [nx, -0.008 - (t + 0.125) * 0.002, nz], 0.0085 - 0.002 * t), 0.006);
  }
  // Chin.
  d = smin(d, ellipsoid(x, y, z, [0, -0.012, 0.085], [0.012, 0.01, 0.007]), 0.008);
  // Ramus rising to the condyle.
  d = smin(d, roundBox(ax, y, z, [0.048, 0.012, 0.028], [0.0045, 0.021, 0.015], 0.003), 0.01);
  // Coronoid process in front of the condyle.
  d = smin(d, capsule(ax, y, z, [0.047, 0.02, 0.04], [0.046, 0.034, 0.043], 0.004), 0.006);
  d = smin(d, ellipsoid(ax, y, z, [0.049, 0.036, 0.022], [0.006, 0.005, 0.008]), 0.004);
  d = smax(d, -ellipsoid(ax, y, z, [0.049, 0.034, 0.032], [0.012, 0.007, 0.005]), 0.003);
  // Lower teeth.
  for (let i = -3; i <= 3; i++) {
    const tx = i * 0.0068, tz = 0.083 - 12 * tx * tx;
    d = smin(d, capsule(x, y, z, [tx, -0.002, tz], [tx, 0.007, tz + 0.001], 0.004), 0.0015);
  }
  return d + bumps(x, y, z, 0.0006, 90);
};

// ---------- Long bones (lying along X) ----------
function shaft(x: number, y: number, z: number, x0: number, x1: number, r0: number, r1: number, bow: number) {
  // Slightly bowed, tapering shaft from several capsule segments.
  let d = 1;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    const xa = x0 + (x1 - x0) * a, xb = x0 + (x1 - x0) * b;
    const ya = bow * Math.sin(Math.PI * a), yb = bow * Math.sin(Math.PI * b);
    d = Math.min(d, capsule(x, y, z, [xa, ya, 0], [xb, yb, 0], r0 + (r1 - r0) * (a + b) / 2));
  }
  return d;
}

const femurSDF: SDF = (x, y, z) => {
  let d = shaft(x, y, z, -0.17, 0.17, 0.0125, 0.014, 0.008);
  // Neck angled up to the ball head.
  d = smin(d, capsule(x, y, z, [-0.175, 0.002, 0], [-0.203, 0.03, 0.006], 0.012), 0.01);
  d = smin(d, sphere(x, y, z, [-0.212, 0.038, 0.008], 0.022), 0.006);
  // Greater and lesser trochanter.
  d = smin(d, ellipsoid(x, y, z, [-0.182, 0.012, -0.004], [0.018, 0.02, 0.015]), 0.012);
  d = smin(d, sphere(x, y, z, [-0.158, -0.012, 0.008], 0.008), 0.008);
  // Distal flare and two condyles with a notch between them.
  d = smin(d, ellipsoid(x, y, z, [0.185, -0.004, 0], [0.025, 0.02, 0.028]), 0.02);
  d = smin(d, sphere(x, y, z, [0.205, -0.008, 0.017], 0.019), 0.01);
  d = smin(d, sphere(x, y, z, [0.205, -0.008, -0.017], 0.019), 0.01);
  d = smax(d, -capsule(x, y, z, [0.226, -0.03, 0], [0.226, 0.01, 0], 0.006), 0.004);
  return d + bumps(x, y, z, 0.0008, 60);
};

const humerusSDF: SDF = (x, y, z) => {
  let d = shaft(x, y, z, -0.12, 0.12, 0.0105, 0.0095, -0.004);
  d = smin(d, sphere(x, y, z, [-0.142, 0.008, 0.004], 0.022), 0.012);
  d = smin(d, ellipsoid(x, y, z, [-0.128, -0.004, -0.012], [0.013, 0.011, 0.011]), 0.008);
  // Flattened distal end with trochlea and capitulum.
  d = smin(d, ellipsoid(x, y, z, [0.135, 0, 0], [0.014, 0.012, 0.03]), 0.016);
  d = smin(d, sphere(x, y, z, [0.148, -0.002, 0.012], 0.011), 0.006);
  d = smin(d, ellipsoid(x, y, z, [0.148, -0.002, -0.012], [0.01, 0.012, 0.012]), 0.006);
  d = smax(d, -sphere(x, y, z, [0.128, 0.012, 0], 0.007), 0.004);
  return d + bumps(x, y, z, 0.0007, 60);
};

const tibiaSDF: SDF = (x, y, z) => {
  // Shaft with a sharp anterior crest.
  let d = shaft(x, y, z, -0.15, 0.15, 0.0125, 0.0105, 0.003);
  d = smin(d, capsule(x, y, z, [-0.12, 0.009, 0], [0.1, 0.006, 0], 0.005), 0.008);
  // Wide tibial plateau.
  d = smin(d, ellipsoid(x, y, z, [-0.175, 0, 0], [0.022, 0.02, 0.036]), 0.02);
  d = smax(d, -ellipsoid(x, y, z, [-0.2, 0, 0.014], [0.008, 0.014, 0.011]), 0.004);
  d = smax(d, -ellipsoid(x, y, z, [-0.2, 0, -0.014], [0.008, 0.014, 0.011]), 0.004);
  // Distal end and medial malleolus.
  d = smin(d, ellipsoid(x, y, z, [0.165, 0, 0], [0.014, 0.017, 0.02]), 0.012);
  d = smin(d, ellipsoid(x, y, z, [0.178, -0.002, 0.016], [0.012, 0.009, 0.007]), 0.006);
  return d + bumps(x, y, z, 0.0008, 60);
};

// ---------- Surface nets ----------
function grad(f: SDF, x: number, y: number, z: number, out: number[]) {
  const e = 0.0007;
  const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
  out[0] = a - b - c + d;
  out[1] = -a - b + c + d;
  out[2] = -a + b - c + d;
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
}

function polygonize(f: SDF, min: V, max: V, cell: number, aoScale = 1): THREE.BufferGeometry {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const val = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    val[id(i, j, k)] = f(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
  }
  const cid = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const vmap = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos: number[] = [];
  const corners: V[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) {
      cv[c] = val[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
      if (cv[c] < 0) inside++;
    }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
      sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
      sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
      n++;
    }
    vmap[cid(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = val[id(i, j, k)] < 0;
    // An edge with a sign change is surrounded by four cells; join their vertices.
    if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && (val[id(i + 1, j, k)] < 0) !== v0) {
      quad(vmap[cid(i, j - 1, k - 1)], vmap[cid(i, j, k - 1)], vmap[cid(i, j, k)], vmap[cid(i, j - 1, k)], !v0);
    }
    if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && (val[id(i, j + 1, k)] < 0) !== v0) {
      quad(vmap[cid(i - 1, j, k - 1)], vmap[cid(i - 1, j, k)], vmap[cid(i, j, k)], vmap[cid(i, j, k - 1)], !v0);
    }
    if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && (val[id(i, j, k + 1)] < 0) !== v0) {
      quad(vmap[cid(i - 1, j - 1, k)], vmap[cid(i, j - 1, k)], vmap[cid(i, j, k)], vmap[cid(i - 1, j, k)], !v0);
    }
  }
  // Pull vertices onto the true surface and take normals from the field.
  const nor = new Float32Array(pos.length);
  const col = new Float32Array(pos.length);
  const g = [0, 0, 0];
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    const d0 = f(x, y, z);
    grad(f, x, y, z, g);
    x -= g[0] * d0; y -= g[1] * d0; z -= g[2] * d0;
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
    nor[v] = g[0]; nor[v + 1] = g[1]; nor[v + 2] = g[2];
    // Baked ambient occlusion: how much the field closes in along the normal.
    let occ = 0, w = 1;
    for (const s of [0.005, 0.012, 0.024]) {
      const ds = s * aoScale;
      occ += w * Math.max(0, ds - f(x + g[0] * ds, y + g[1] * ds, z + g[2] * ds)) / ds;
      w *= 0.7;
    }
    const ao = Math.max(0.1, Math.min(1, 1 - occ * 0.5));
    col[v] = col[v + 1] = col[v + 2] = ao;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(idx);
  // Consistent outward winding: flip any triangle facing against the field normal.
  const ix = geo.index!.array as Uint32Array | Uint16Array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) {
    a.fromArray(pos, ix[t] * 3); b.fromArray(pos, ix[t + 1] * 3); c.fromArray(pos, ix[t + 2] * 3);
    fn.subVectors(b, a).cross(c.sub(a));
    const nx2 = nor[ix[t] * 3] + nor[ix[t + 1] * 3] + nor[ix[t + 2] * 3];
    const ny2 = nor[ix[t] * 3 + 1] + nor[ix[t + 1] * 3 + 1] + nor[ix[t + 2] * 3 + 1];
    const nz2 = nor[ix[t] * 3 + 2] + nor[ix[t + 1] * 3 + 2] + nor[ix[t + 2] * 3 + 2];
    if (fn.x * nx2 + fn.y * ny2 + fn.z * nz2 < 0) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
  }
  // Smooth the baked occlusion across neighbours so thin features don't speckle.
  for (let pass = 0; pass < 3; pass++) {
    const sum = new Float32Array(col.length / 3), cnt = new Float32Array(col.length / 3);
    for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) {
      const p0 = ix[t + e];
      for (let q = 0; q < 3; q++) { sum[p0] += col[ix[t + q] * 3]; cnt[p0]++; }
    }
    for (let v = 0; v < sum.length; v++) if (cnt[v]) col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = sum[v] / cnt[v];
  }
  return geo;
}

/** Put the lowest point at y=0 and centre x/z on the origin. */
function ground(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** `coarse` > 1 polygonizes on a coarser grid: the far level of detail. */
export function makeBones(coarse = 1): BoneSet {
  const c = coarse;
  const skull = ground(polygonize(skullSDF, [-0.085, -0.005, -0.125], [0.085, 0.17, 0.13], 0.0072 * c));
  const jaw = ground(polygonize(jawSDF, [-0.065, -0.03, 0.0], [0.065, 0.05, 0.1], 0.0058 * c));
  const femur = ground(polygonize(femurSDF, [-0.245, -0.035, -0.035], [0.235, 0.07, 0.04], 0.0085 * c, 1.4));
  const humerus = ground(polygonize(humerusSDF, [-0.17, -0.03, -0.04], [0.17, 0.04, 0.04], 0.0075 * c, 1.4));
  const tibia = ground(polygonize(tibiaSDF, [-0.205, -0.03, -0.045], [0.19, 0.03, 0.045], 0.008 * c, 1.4));
  return { skull, jaw, femur, humerus, tibia };
}

// Real scanned meshes win when present: drop CC0 glTFs into public/models/.
const TARGET: Record<keyof BoneSet, { axis: 'x' | 'z'; len: number }> = {
  skull: { axis: 'z', len: 0.19 },
  jaw: { axis: 'z', len: 0.1 },
  femur: { axis: 'x', len: 0.45 },
  humerus: { axis: 'x', len: 0.32 },
  tibia: { axis: 'x', len: 0.38 },
};

export async function loadBones(): Promise<BoneSet> {
  const set = makeBones();
  const loader = new GLTFLoader();
  const keys = Object.keys(TARGET) as (keyof BoneSet)[];
  await Promise.allSettled(keys.map(async (key) => {
    const gltf = await loader.loadAsync(`models/${key}.glb`);
    let mesh: THREE.Mesh | undefined;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
    if (!mesh) return;
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    const t = TARGET[key];
    const s = t.len / (t.axis === 'x' ? size.x : size.z);
    g.scale(s, s, s);
    set[key] = ground(g);
  }));
  return set;
}
