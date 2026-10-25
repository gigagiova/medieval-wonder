import * as THREE from 'three';
import type { MatName } from './materials';
import { baseHeight, insideness } from './benevento/geo';
import { plateausNear } from './benevento/sites';

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

// The ground is real: the ridge of Benevento between the Calore and the
// Sabato, from the DEM (see benevento/geo.ts), flattened into terraces where
// a landmark needs level footing (PLATEAUS). Geometry is authored with y = 0
// at the local ground; the Builder lifts every vertex by the terrain under it
// (a vertical shear, so walls stay plumb), see lift().
export { DATUM } from './benevento/geo';

/**
 * A landmark's local frame. While a site is active, module code works in its
 * own coordinates (as authored for the old town); field() is evaluated at the
 * matching world point and its result handed back in the local frame, so
 * anything a module positions with field() lands where the Builder puts it.
 */
export const SITE = { on: false, x: 0, z: 0, lx: 0, lz: 0, c: 1, s: 0, rot: 0 };
export function setSite(s: { x: number; z: number; rot: number; lx?: number; lz?: number } | null) {
  if (!s) { SITE.on = false; return; }
  Object.assign(SITE, { on: true, x: s.x, z: s.z, lx: s.lx ?? 0, lz: s.lz ?? 0, c: Math.cos(s.rot), s: Math.sin(s.rot), rot: s.rot });
}
/** Local (site) x/z to world, into out[0], out[1]. Identity when no site is active. */
export function toWorldXZ(x: number, z: number, out: number[]) {
  if (!SITE.on) { out[0] = x; out[1] = z; return out; }
  const dx = x - SITE.lx, dz = z - SITE.lz;
  out[0] = SITE.x + dx * SITE.c + dz * SITE.s;
  out[1] = SITE.z - dx * SITE.s + dz * SITE.c;
  return out;
}
/** World x/z to the active site's local frame. */
export function toLocalXZ(x: number, z: number, out: number[]) {
  if (!SITE.on) { out[0] = x; out[1] = z; return out; }
  const dx = x - SITE.x, dz = z - SITE.z;
  out[0] = SITE.lx + dx * SITE.c - dz * SITE.s;
  out[1] = SITE.lz + dx * SITE.s + dz * SITE.c;
  return out;
}

/** Terrain height (game units, DATUM below sea level) at a world point. */
export function worldTerrain(x: number, z: number) {
  let h = baseHeight(x, z);
  for (const p of plateausNear(x, z)) {
    const d = p.ex ? Math.max(Math.abs((x - p.x) * p.ca + (z - p.z) * p.sa) / p.ex, Math.abs(-(x - p.x) * p.sa + (z - p.z) * p.ca) / p.ez!) * p.r0 : Math.hypot(x - p.x, z - p.z);
    if (d >= p.r1) continue;
    const t = d <= p.r0 ? 0 : THREE.MathUtils.smoothstep(d, p.r0, p.r1);
    h = p.h + (h - p.h) * t;
  }
  return h;
}
/**
 * Ground height for code positioning things. Inside a site's local frame the
 * ground is its terrace, which the site's own lift supplies: 0 there.
 */
export function terrain(x: number, z: number) {
  return SITE.on ? 0 : worldTerrain(x, z);
}
const _w = [0, 0];
/** World terrain gradient (dh/dx, dh/dz). */
export function terrainGrad(x: number, z: number, out: number[]) {
  const e = 0.6;
  out[0] = (worldTerrain(x + e, z) - worldTerrain(x - e, z)) / (2 * e);
  out[1] = (worldTerrain(x, z + e) - worldTerrain(x, z - e)) / (2 * e);
  return out;
}
let extra: ((x: number, z: number) => number) | null = null;
/** Extra ground relief (street gutters), sampled for the 'ground' material only. */
export function setGroundExtra(f: (x: number, z: number) => number) { extra = f; }

export function groundBump(x: number, z: number) {
  // Rougher, lumpier ground outside the walls (fields, scrub, ruins).
  const out = 1 - insideness(x, z);
  return 0.09 * noise(x / 3.1, 7.7, z / 3.1) + 0.035 * noise(x / 1.2, 3.3, z / 1.2) + out * 0.5 * noise(x / 22, 1.1, z / 22);
}

const AMP: Partial<Record<MatName, number>> = { bone: 0.3, cloth: 0, marble: 0.5, horn: 0.2, clay: 0.1, bronze: 0.2, ember: 0.2 };

/** The part of the field that bends shapes (used for normals): no hill, no ground ride. */
export function shapeField(x: number, y: number, z: number, m: MatName, out: THREE.Vector3) {
  if (SITE.on) { toWorldXZ(x, z, _w); shapeFieldW(_w[0], y, _w[1], m, out); return toLocalVec(out); }
  return shapeFieldW(x, y, z, m, out);
}
/** Rotate a world-frame vector into the active site's frame. */
function toLocalVec(v: THREE.Vector3) {
  const x = v.x, z = v.z;
  v.x = x * SITE.c - z * SITE.s;
  v.z = x * SITE.s + z * SITE.c;
  return v;
}
function shapeFieldW(x: number, y: number, z: number, m: MatName, out: THREE.Vector3) {
  const a = (AMP[m] ?? 1) * (1.6 - 0.6 * THREE.MathUtils.smoothstep(y, -4, -2));
  const dx = a * (0.2 * noise(x / 4.7, y / 4.7, z / 4.7) + 0.07 * noise(x / 1.3 + 31, y / 1.3, z / 1.3));
  const dy = a * (0.12 * noise(x / 4.7 + 17, y / 4.7, z / 4.7) + 0.07 * noise(x / 1.3, y / 1.3 + 19, z / 1.3));
  const dz = a * (0.2 * noise(x / 4.7, y / 4.7, z / 4.7 + 53) + 0.07 * noise(x / 1.3, y / 1.3, z / 1.3 + 41));
  return out.set(dx, dy, dz);
}

export function field(x: number, y: number, z: number, m: MatName, out: THREE.Vector3) {
  if (SITE.on) { toWorldXZ(x, z, _w); fieldW(_w[0], y, _w[1], m, out); return toLocalVec(out); }
  return fieldW(x, y, z, m, out);
}
function fieldW(x: number, y: number, z: number, m: MatName, out: THREE.Vector3) {
  const a = (AMP[m] ?? 1) * (1.6 - 0.6 * THREE.MathUtils.smoothstep(y, -4, -2));
  const macro = 0.2, meso = 0.07;
  let dx = macro * noise(x / 4.7, y / 4.7, z / 4.7) + meso * noise(x / 1.3 + 31, y / 1.3, z / 1.3);
  let dy = macro * 0.6 * noise(x / 4.7 + 17, y / 4.7, z / 4.7) + meso * noise(x / 1.3, y / 1.3 + 19, z / 1.3);
  let dz = macro * noise(x / 4.7, y / 4.7, z / 4.7 + 53) + meso * noise(x / 1.3, y / 1.3, z / 1.3 + 41);
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
  dx += hy * 0.028 * noise(x / 9 + 5, 0.5, z / 9);
  dz += hy * 0.028 * noise(x / 9, 0.5, z / 9 + 5);
  if (m === 'roof') dy -= 0.16 * Math.abs(noise(x / 3, y / 3 + 9, z / 3));
  // Everything near the ground rides the ground's undulation.
  // (Both the street level and the catacomb floor.)
  const gw = Math.exp(-Math.abs(y) / 1.2) + 0.6 * Math.exp(-Math.abs(y + 7) / 0.8);
  if (gw > 0.01) dy += groundBump(x, z) * gw;
  if (m === 'ground' && extra) dy += extra(x, z);
  out.set(dx, dy, dz);
  return out;
}

export const TESS: Partial<Record<MatName, number>> = {
  stone: 0.7, bigstone: 0.9, brick: 1.0, rubble: 0.9, marble: 0.6, plaster: 0.8, roof: 0.9, wood: 0.9, rock: 0.6, slab: 0.8, ground: 0.8,
};


/**
 * Split every triangle into n² smaller ones (n from its longest edge), in one
 * pass. Much faster than iterative longest-edge splitting.
 */
let tessScale = 1;
/** Coarser (k > 1) or finer subdivision for what is built next: the streamed town uses a coarser one. */
export function setTessScale(k: number) { tessScale = k; }
export function tessellate(g: THREE.BufferGeometry, m: MatName): THREE.BufferGeometry {
  const L0 = TESS[m];
  if (!L0) return g;
  const L = L0 * tessScale;
  const src = g.index ? g.toNonIndexed() : g;
  const P = src.attributes.position.array as ArrayLike<number>;
  const Nn = src.attributes.normal?.array as ArrayLike<number> | undefined;
  const tris = P.length / 9;
  const ns = new Uint16Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const e = Math.max(
      Math.hypot(P[o] - P[o + 3], P[o + 1] - P[o + 4], P[o + 2] - P[o + 5]),
      Math.hypot(P[o + 3] - P[o + 6], P[o + 4] - P[o + 7], P[o + 5] - P[o + 8]),
      Math.hypot(P[o + 6] - P[o], P[o + 7] - P[o + 1], P[o + 8] - P[o + 2]),
    );
    const n = Math.min(24, Math.max(1, Math.ceil(e / L)));
    ns[t] = n;
    total += n * n;
  }
  const pos = new Float32Array(total * 9), nor = new Float32Array(total * 9);
  let w = 0;
  const put = (o: number, a: number, b: number) => {
    // Point at barycentric (1-a-b, a, b) of triangle at offset o.
    const c = 1 - a - b;
    for (let k = 0; k < 3; k++) {
      pos[w + k] = P[o + k] * c + P[o + 3 + k] * a + P[o + 6 + k] * b;
      nor[w + k] = Nn ? Nn[o + k] * c + Nn[o + 3 + k] * a + Nn[o + 6 + k] * b : 0;
    }
    w += 3;
  };
  for (let t = 0; t < tris; t++) {
    const o = t * 9, n = ns[t];
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      put(o, i / n, j / n); put(o, (i + 1) / n, j / n); put(o, i / n, (j + 1) / n);
      if (j < n - i - 1) { put(o, (i + 1) / n, j / n); put(o, (i + 1) / n, (j + 1) / n); put(o, i / n, (j + 1) / n); }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(total * 6), 2));
  return out;
}

/** Positions only (collision proxies): one field evaluation per vertex. */
export function displacePositions(g: THREE.BufferGeometry, m: MatName) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    field(pos.getX(i), pos.getY(i), pos.getZ(i), m, pv);
    pos.setXYZ(i, pos.getX(i) + pv.x, pos.getY(i) + pv.y, pos.getZ(i) + pv.z);
  }
}
const pv = new THREE.Vector3();

const s0 = new THREE.Vector3(), d0 = new THREE.Vector3(), d1 = new THREE.Vector3(), n = new THREE.Vector3(), j = new THREE.Vector3();
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
      shapeField(x, y, z, m, s0);
      shapeField(x + e, y, z, m, d1); d1.sub(s0).divideScalar(e); j.x = d1.dot(n);
      shapeField(x, y + e, z, m, d1); d1.sub(s0).divideScalar(e); j.y = d1.dot(n);
      shapeField(x, y, z + e, m, d1); d1.sub(s0).divideScalar(e); j.z = d1.dot(n);
      n.sub(j).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    pos.setXYZ(i, x + d0.x, y + d0.y, z + d0.z);
  }
}

// ---------------------------------------------------------------- lifting onto the terrain
// The terrain is smooth: sample it once per metre in 64 m tiles, then
// interpolate. Millions of vertices are lifted per chunk.
const TILE = 64, TN = TILE + 1;
const tiles = new Map<number, Float32Array>();
function tileOf(ti: number, tj: number) {
  const key = ti * 4096 + tj;
  let t = tiles.get(key);
  if (!t) {
    t = new Float32Array(TN * TN);
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) t[j * TN + i] = worldTerrain(ti * TILE + i, tj * TILE + j);
    tiles.set(key, t);
  }
  return t;
}
/** Terrain height, from the per-metre tiles (bilinear). */
export function fastTerrain(x: number, z: number) {
  const ti = Math.floor(x / TILE), tj = Math.floor(z / TILE);
  const t = tileOf(ti, tj);
  const fx = x - ti * TILE, fz = z - tj * TILE;
  const i = Math.min(TILE - 1, Math.floor(fx)), j = Math.min(TILE - 1, Math.floor(fz));
  const u = fx - i, v = fz - j, o = j * TN + i;
  return (t[o] * (1 - u) + t[o + 1] * u) * (1 - v) + (t[o + TN] * (1 - u) + t[o + TN + 1] * u) * v;
}
/** Gradient of fastTerrain (central differences over 1 m). */
export function fastGrad(x: number, z: number, out: number[]) {
  out[0] = (fastTerrain(x + 0.5, z) - fastTerrain(x - 0.5, z));
  out[1] = (fastTerrain(x, z + 0.5) - fastTerrain(x, z - 0.5));
  return out;
}
/** Drop cached terrain tiles (after plateaus change). */
export function resetTerrainCache() { tiles.clear(); }

const _g = [0, 0];
/**
 * Lift world-x/z geometry onto the terrain: y += h(x, z), a vertical shear,
 * with normals sheared to match (n' ∝ (nx - hx·ny, ny, nz - hz·ny)).
 * `dy` is a constant added on top (a site's terrace already includes it).
 */
export function liftGeometry(g: THREE.BufferGeometry) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
  const P = pos.array as Float32Array, N = nor?.array as Float32Array | undefined;
  for (let i = 0, n = pos.count; i < n; i++) {
    const o = i * 3, x = P[o], z = P[o + 2];
    P[o + 1] += fastTerrain(x, z);
    if (N) {
      fastGrad(x, z, _g);
      const ny = N[o + 1];
      let nx = N[o] - _g[0] * ny, nz = N[o + 2] - _g[1] * ny;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; nz /= l;
      N[o] = nx; N[o + 1] = ny / l; N[o + 2] = nz;
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
}
export function liftPoint(p: THREE.Vector3) { p.y += fastTerrain(p.x, p.z); return p; }
