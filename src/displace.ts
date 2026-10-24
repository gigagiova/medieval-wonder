import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import type { MatName } from './materials';

// Nothing medieval is flat. Every vertex in the world is pushed through one
// continuous world-space vector field, so walls bulge and lean, roofs sag and
// wall bases follow the uneven ground, without cracks between pieces that
// touch (the same position always moves by the same amount).

// Value noise over a 256-entry permutation table: cheap enough to run on
// every vertex of the town at load.
const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
{
  let s = 12345;
  const r = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
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

export function groundBump(x: number, z: number) {
  const r = Math.hypot(x, z);
  const out = THREE.MathUtils.smoothstep(r, 92, 110);
  return 0.09 * noise(x / 3.1, 7.7, z / 3.1) + 0.035 * noise(x / 1.2, 3.3, z / 1.2) + out * 0.9 * noise(x / 22, 1.1, z / 22);
}

const AMP: Partial<Record<MatName, number>> = { bone: 0.3, cloth: 0 };

export function field(x: number, y: number, z: number, m: MatName, out: THREE.Vector3) {
  const a = (AMP[m] ?? 1) * (1.6 - 0.6 * THREE.MathUtils.smoothstep(y, -4, -2));
  const macro = 0.16, meso = 0.04;
  let dx = macro * noise(x / 4.7, y / 4.7, z / 4.7) + meso * noise(x / 1.5 + 31, y / 1.5, z / 1.5);
  let dy = macro * 0.6 * noise(x / 4.7 + 17, y / 4.7, z / 4.7) + meso * noise(x / 1.5, y / 1.5 + 19, z / 1.5);
  let dz = macro * noise(x / 4.7, y / 4.7, z / 4.7 + 53) + meso * noise(x / 1.5, y / 1.5, z / 1.5 + 41);
  dx *= a; dy *= a; dz *= a;
  // Underground everything is hacked out of tuff: chunky, hand-hewn lumps.
  const ug = 1 - THREE.MathUtils.smoothstep(y, -3.5, -2.2);
  if (ug > 0) {
    const k = 0.09 * ug * (AMP[m] ?? 1);
    dx += k * noise(x / 0.75 + 3, y / 0.75, z / 0.75);
    dy += k * noise(x / 0.75, y / 0.75 + 7, z / 0.75);
    dz += k * noise(x / 0.75, y / 0.75, z / 0.75 + 11);
  }
  // Walls lean more the higher they go.
  const hy = Math.max(0, y);
  dx += hy * 0.02 * noise(x / 9 + 5, 0.5, z / 9);
  dz += hy * 0.02 * noise(x / 9, 0.5, z / 9 + 5);
  if (m === 'roof') dy -= 0.1 * Math.abs(noise(x / 3, y / 3 + 9, z / 3));
  // Everything near the ground rides the ground's undulation.
  // (Both the street level and the catacomb floor.)
  dy += groundBump(x, z) * (Math.exp(-Math.abs(y) / 1.2) + 0.6 * Math.exp(-Math.abs(y + 7) / 0.8));
  out.set(dx, dy, dz);
  return out;
}

export const TESS: Partial<Record<MatName, number>> = {
  stone: 0.6, bigstone: 0.7, plaster: 0.6, roof: 0.6, wood: 0.5, rock: 0.35, slab: 0.6, ground: 0.6,
};

const tess = new TessellateModifier(0.5, 8);
export function tessellate(g: THREE.BufferGeometry, m: MatName): THREE.BufferGeometry {
  const L = TESS[m];
  if (!L) return g;
  tess.maxEdgeLength = L;
  tess.maxIterations = 8;
  return tess.modify(g);
}

const d0 = new THREE.Vector3(), d1 = new THREE.Vector3(), n = new THREE.Vector3(), j = new THREE.Vector3();
export function displace(g: THREE.BufferGeometry, m: MatName) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  if (g.index) {
    // Boxes and grids share vertices within each face, so the displaced mesh
    // itself gives smooth normals while box edges stay creased.
    for (let i = 0; i < pos.count; i++) {
      field(pos.getX(i), pos.getY(i), pos.getZ(i), m, d0);
      pos.setXYZ(i, pos.getX(i) + d0.x, pos.getY(i) + d0.y, pos.getZ(i) + d0.z);
    }
    g.computeVertexNormals();
    return;
  }
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const e = 0.05;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    field(x, y, z, m, d0);
    if (nor) {
      // New normal = inverse-transpose of (I + J) applied to n, to first order n - J^T n.
      n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
      j.set(0, 0, 0);
      field(x + e, y, z, m, d1); d1.sub(d0).divideScalar(e); j.x = d1.dot(n);
      field(x, y + e, z, m, d1); d1.sub(d0).divideScalar(e); j.y = d1.dot(n);
      field(x, y, z + e, m, d1); d1.sub(d0).divideScalar(e); j.z = d1.dot(n);
      n.sub(j).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    pos.setXYZ(i, x + d0.x, y + d0.y, z + d0.z);
  }
}
