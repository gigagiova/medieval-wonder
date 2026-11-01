// Geometry audit for holes in the world (see docs/HOLES-AUDIT.md).
//
//   npx tsx tools/audit-holes.ts [--out docs/holes-audit/after] [--quick]
//
// Builds the world's geometry as the game does (town chunks through the
// fabric code in full and middle detail, the landmarks, bridges and rivers;
// see tools/holes/scene.ts), every triangle tagged with its source module,
// then measures:
//  A. ground holes: a 0.5 m grid over the whole world, a ray down at each
//     point; a hole is a point where no surface lies within the ground band
//     (stair openings: within their depth), in full and in middle detail;
//  B. seams between the levels of detail of the ground (chunk borders);
//  C. what an eye at street level sees: from a 4 m grid of standing points in
//     and around the town, 120 rays each (32 m), the first surface hit; a
//     back face of a one-sided surface is a see-through defect (roofs from
//     below, jars from above...); a ray going down that meets nothing before
//     it would reach the terrain looks through a hole in the ground;
//  D. open shells: boundary edges of every source's geometry;
//  E. the glTF props and trees: open shells and what shows of their backs.
// Writes report.json, holes-map.png and views.json (worst places, for the
// render audit tools/audit-holes-render.mjs).
import './holes/dom-shim';
import * as THREE from 'three';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorld, landmarkSoup, chunkSoup, bvhOf, concat, MAT_NAME, SCENE_MAT, type Soup } from './holes/scene';
import { TAGS } from './holes/tag';
import { readGltf } from './holes/gltf-node';
import { fastTerrain, field } from '../src/displace';
import { BOUNDS, insideness, WALL700, inPoly, type P2 } from '../src/benevento/geo';
import { SITES, ROADS, siteToWorld } from '../src/benevento/sites';
import { CHUNK, chunkKey, type ChunkItems } from '../src/benevento/fabric';
import { HOUSE, STREET, PLOT } from '../src/benevento/layout';
import type { MeshBVH } from 'three-mesh-bvh';

const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/holes-audit/current';
const QUICK = args.includes('--quick');
mkdirSync(OUT, { recursive: true });
const T0 = performance.now();
const log = (...a: unknown[]) => console.log(`[${((performance.now() - T0) / 1000).toFixed(0)}s]`, ...a);

const W = prepareWorld();
const lay = W.lay, R = lay.r;
log('layout ready', W.items.size, 'chunks');
const L = await landmarkSoup();
const LB = bvhOf(L)!;
log('landmarks', L.n, 'triangles');

// ---------------------------------------------------------------- casting
type BV = { bvh: MeshBVH; soup: Soup };
const ray = new THREE.Ray();
interface Hit { d: number; tri: number; soup: Soup; nx: number; ny: number; nz: number }
const _h: Hit = { d: 0, tri: 0, soup: L, nx: 0, ny: 0, nz: 0 };
function first(list: BV[], o: THREE.Vector3, dir: THREE.Vector3, far: number): Hit | null {
  ray.origin.copy(o); ray.direction.copy(dir);
  let best: THREE.Intersection | null = null, bs: Soup | null = null;
  for (const b of list) {
    const h = b.bvh.raycastFirst(ray, THREE.DoubleSide, 0, best ? best.distance : far) as THREE.Intersection | null;
    if (h && (!best || h.distance < best.distance)) { best = h; bs = b.soup; }
  }
  if (!best || !bs) return null;
  const tri = Math.floor(best.face!.a / 3);
  const P = bs.pos, o9 = tri * 9;
  const ux = P[o9 + 3] - P[o9], uy = P[o9 + 4] - P[o9 + 1], uz = P[o9 + 5] - P[o9 + 2];
  const vx = P[o9 + 6] - P[o9], vy = P[o9 + 7] - P[o9 + 1], vz = P[o9 + 8] - P[o9 + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  Object.assign(_h, { d: best.distance, tri, soup: bs, nx, ny, nz });
  return _h;
}
const LBV: BV = { bvh: LB.bvh, soup: L };

// ---------------------------------------------------------------- chunk soups
const full = new Map<number, Soup>();
function fullSoup(it: ChunkItems) {
  let s = full.get(it.key);
  if (!s) { s = chunkSoup(it, false); full.set(it.key, s); }
  return s;
}
const itemAt = (i: number, j: number) => W.items.get(chunkKey(i, j));

/** Lot footprints (houses one cannot enter) over a chunk, 0.5 m cells. */
function footprintMask(it: ChunkItems) {
  const MR = CHUNK / 0.5, m = new Uint8Array(MR * MR);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const n = itemAt(it.i + di, it.j + dj);
    for (const l of n?.lots ?? []) {
      if (l.explore) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of l.c) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const i0 = Math.max(0, Math.floor((x0 - it.i * CHUNK) / 0.5)), i1 = Math.min(MR - 1, Math.floor((x1 - it.i * CHUNK) / 0.5));
      const j0 = Math.max(0, Math.floor((z0 - it.j * CHUNK) / 0.5)), j1 = Math.min(MR - 1, Math.floor((z1 - it.j * CHUNK) / 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inPoly(it.i * CHUNK + (i + 0.5) * 0.5, it.j * CHUNK + (j + 0.5) * 0.5, l.c)) m[j * MR + i] = 1;
    }
  }
  return m;
}

// ---------------------------------------------------------------- A. ground holes
interface HolePt { x: number; z: number; lod: 'full' | 'mid'; kind: 'open' | 'house-raster' | 'stair'; tag?: string }
const holePts: HolePt[] = [];
const holeCount = { full: { open: 0, 'house-raster': 0, stair: 0 }, mid: { open: 0, 'house-raster': 0, stair: 0 } };
let groundPoints = 0;
const down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
function groundAudit(it: ChunkItems, s: Soup, lod: 'full' | 'mid', foot: Uint8Array) {
  const b = bvhOf(s);
  const list: BV[] = b ? [LBV, { bvh: b.bvh, soup: s }] : [LBV];
  const MR = CHUNK / 0.5;
  for (let j = 0; j < MR; j++) for (let i = 0; i < MR; i++) {
    if (foot[j * MR + i]) continue; // inside a house one cannot enter: not walkable, not seen
    const x = it.i * CHUNK + (i + 0.2 + 0.6 * ((i * 7 + j * 3) % 5) / 4) * 0.5, z = it.j * CHUNK + (j + 0.2 + 0.6 * ((j * 7 + i * 3) % 5) / 4) * 0.5;
    if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) continue;
    // The field bends the ground sideways by up to ~0.3 m, so a chunk's own
    // ground does not reach its square's very edge (its neighbour's does: same
    // border vertices). Edges are checked by the seam test (B) instead.
    const ex = x - it.i * CHUNK, ez = z - it.j * CHUNK;
    if (ex < 0.45 || ez < 0.45 || ex > CHUNK - 0.45 || ez > CHUNK - 0.45) continue;
    if (lod === 'full') groundPoints++;
    const stair = it.holes.some((h) => inPoly(x, z, h.pts));
    const t = fastTerrain(x, z);
    o.set(x, t + 0.8, z);
    const h = first(list, o, down, stair ? 14 : 2.3);
    if (h) continue;
    const kind: HolePt['kind'] = stair ? 'stair' : R.at(x, z) === HOUSE ? 'house-raster' : 'open';
    holeCount[lod][kind]++;
    if (holePts.length < 400000) holePts.push({ x, z, lod, kind });
  }
}

// ---------------------------------------------------------------- B. LOD seams of the ground
const fv = new THREE.Vector3();
function groundVertex(x: number, z: number, dy = 0): [number, number, number] {
  field(x, 0, z, 'ground', fv);
  return [x + fv.x, fv.y + fastTerrain(x + fv.x, z + fv.z) + dy, z + fv.z];
}
/** Largest gap (m) between two levels' border polylines along one chunk edge. */
function seamGap(x0: number, z0: number, dx: number, dz: number, stA: number, stB: number, dyB = 0) {
  const along = (st: number, u: number, dy: number) => {
    const k = Math.min(Math.floor(u / st), Math.round(CHUNK / st) - 1), f = (u - k * st) / st;
    const a = groundVertex(x0 + dx * k * st, z0 + dz * k * st, dy), c = groundVertex(x0 + dx * (k + 1) * st, z0 + dz * (k + 1) * st, dy);
    return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
  };
  let mx = 0;
  for (let u = 0.05; u < CHUNK; u += 0.16) {
    const p = along(stA, u, 0), q = along(stB, u, dyB);
    // Vertical gap only (lateral displacement moves both alike to first order).
    mx = Math.max(mx, Math.abs(p[1] - q[1]));
  }
  return mx;
}

// ---------------------------------------------------------------- C. what the eye sees
const NR = 120, RANGE = 32;
const dirs: THREE.Vector3[] = [];
{
  // Fibonacci directions over the band of elevations seen while walking (-35° .. +85°).
  const s0 = Math.sin(-35 * Math.PI / 180), s1 = Math.sin(85 * Math.PI / 180);
  for (let k = 0; k < NR; k++) {
    const y = s0 + (s1 - s0) * (k + 0.5) / NR, r = Math.sqrt(1 - y * y), a = k * Math.PI * (3 - Math.sqrt(5));
    dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
}
interface TagStat { tris: number; back: number; bEdges: number; bLen: number; pts: number[][] }
const tagStats = new Map<string, TagStat>();
const statOf = (tag: number, mat: number) => {
  const k = `${MAT_NAME[mat] ?? (mat === SCENE_MAT ? 'scene' : mat)}|${TAGS[tag]}`;
  let s = tagStats.get(k);
  if (!s) tagStats.set(k, (s = { tris: 0, back: 0, bEdges: 0, bLen: 0, pts: [] }));
  return s;
};
interface Eye { x: number; y: number; z: number; back: number; hole: number; yawBack: number; yawHole: number }
const eyes: Eye[] = [];
const sightHoles: number[][] = [];
let eyeRays = 0, backRays = 0, holeRays = 0, eyesInside = 0;
const eo = new THREE.Vector3(), up = new THREE.Vector3();
function eyeAudit(it: ChunkItems, list: BV[], foot: Uint8Array) {
  const MR = CHUNK / 0.5;
  for (let gz = 2; gz < CHUNK; gz += 4) for (let gx = 2; gx < CHUNK; gx += 4) {
    const x = it.i * CHUNK + gx, z = it.j * CHUNK + gz;
    if (foot[Math.floor(gz / 0.5) * MR + Math.floor(gx / 0.5)]) continue;
    const t = fastTerrain(x, z);
    eo.set(x, t + 1.4, z);
    const f = first(list, eo, down, 4);
    if (!f || f.ny < 0.3) continue; // no floor (a hole, counted in A) or standing in something
    const y = t + 1.4 - f.d + 1.65;
    eo.set(x, y, z);
    let back = 0, hole = 0, near = 0;
    let bx = 0, bz = 0, hx = 0, hz = 0;
    const found: { tag: number; mat: number; p: number[] }[] = [];
    const sh: number[][] = [];
    for (const d of dirs) {
      const h = first(list, eo, d, RANGE);
      if (h) {
        const dot = h.nx * d.x + h.ny * d.y + h.nz * d.z;
        if (dot > 0 && !h.soup.ds[h.tri]) {
          back++; bx += d.x; bz += d.z;
          if (h.d < 1.0) near++;
          found.push({ tag: h.soup.tag[h.tri], mat: h.soup.mat[h.tri], p: [x + d.x * h.d, y + d.y * h.d, z + d.z * h.d] });
        }
        continue;
      }
      if (d.y >= -0.01) continue;
      // Nothing hit going down: does the ray pass below the terrain within range?
      for (let s = 0.5; s <= RANGE; s += 0.5) {
        const px = x + d.x * s, py = y + d.y * s, pz = z + d.z * s;
        if (py < fastTerrain(px, pz) - 0.05) { hole++; hx += d.x; hz += d.z; sh.push([px, pz]); break; }
      }
    }
    // The eye is inside a solid (a tower, a thick wall, the cavea's mass): not a place to stand.
    if (near > NR * 0.15 || back > NR * 0.4) { eyesInside++; continue; }
    eyeRays += NR; backRays += back; holeRays += hole;
    for (const q of found) { const st = statOf(q.tag, q.mat); st.back++; if (st.pts.length < 40) st.pts.push(q.p.map((v) => +v.toFixed(2))); }
    for (const p of sh) if (sightHoles.length < 200000) sightHoles.push(p);
    eyes.push({ x, y: +y.toFixed(2), z, back, hole, yawBack: Math.atan2(-bx, -bz), yawHole: Math.atan2(-hx, -hz) });
  }
}

// ---------------------------------------------------------------- D. open shells
function openShells(s: Soup) {
  const vid = new Map<string, number>();
  const q = (v: number) => Math.round(v * 1000);
  const id = (o3: number) => {
    const k = `${q(s.pos[o3])},${q(s.pos[o3 + 1])},${q(s.pos[o3 + 2])}`;
    let v = vid.get(k);
    if (v === undefined) { v = vid.size; vid.set(k, v); }
    return v;
  };
  const edges = new Map<number, number>(); // key -> count * 2^26 is too big; store count and first tri
  const firstTri = new Map<number, number>();
  for (let t = 0; t < s.n; t++) {
    if (s.ds[t]) continue;
    statOf(s.tag[t], s.mat[t]).tris++;
    const a = id(t * 9), b = id(t * 9 + 3), c = id(t * 9 + 6);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (u === v) continue;
      const k = u < v ? u * 67108864 + v : v * 67108864 + u;
      edges.set(k, (edges.get(k) ?? 0) + 1);
      if (!firstTri.has(k)) firstTri.set(k, t * 9 + (u === a ? 0 : u === b ? 3 : 6) * 1);
    }
  }
  const pos = new Map<number, number>();
  for (const [k, n] of edges) {
    if (n !== 1) continue;
    const o3 = firstTri.get(k)!, t = Math.floor(o3 / 9);
    const st = statOf(s.tag[t], s.mat[t]);
    st.bEdges++;
    // Length: from the triangle's vertex at o3 to the next one.
    const base = t * 9, i0 = o3 - base, i1 = (i0 + 3) % 9;
    st.bLen += Math.hypot(s.pos[base + i1] - s.pos[base + i0], s.pos[base + i1 + 1] - s.pos[base + i0 + 1], s.pos[base + i1 + 2] - s.pos[base + i0 + 2]);
  }
  void pos;
}

// ---------------------------------------------------------------- run
const eyeChunk = (it: ChunkItems) => {
  const cx = (it.i + 0.5) * CHUNK, cz = (it.j + 0.5) * CHUNK;
  if (it.lots.length || it.walls.length || insideness(cx, cz) > 0.02) return true;
  for (const s of Object.values(SITES)) if (Math.hypot(cx - s.x, cz - s.z) < 90) return true;
  for (const r of ROADS) for (let k = 0; k + 1 < r.pts.length; k++) {
    const a = r.pts[k], c = r.pts[k + 1], dx = c[0] - a[0], dz = c[1] - a[1];
    const u = Math.max(0, Math.min(1, ((cx - a[0]) * dx + (cz - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(cx - a[0] - dx * u, cz - a[1] - dz * u) < 24) return true;
  }
  return false;
};
const allItems = [...W.items.values()].sort((a, b) => a.j - b.j || a.i - b.i);
const eyeSet = new Set(allItems.filter(eyeChunk).map((it) => it.key));
log('eye chunks', eyeSet.size);
const run = QUICK ? allItems.filter((it) => eyeSet.has(it.key) && Math.hypot((it.i + 0.5) * CHUNK - 30, (it.j + 0.5) * CHUNK + 60) < 260) : allItems;

// A and B over every chunk (full detail chunks are kept for C where needed).
let seamMax = 0, seamN = 0, seamOver = 0, seamMaxMid = 0, seamOverMid = 0;
const seamRows: number[][] = [];
let done = 0;
const footCache = new Map<number, Uint8Array>();
for (const it of run) {
  const foot = footprintMask(it);
  footCache.set(it.key, foot);
  const sf = eyeSet.has(it.key) ? fullSoup(it) : chunkSoup(it, false);
  groundAudit(it, sf, 'full', foot);
  const sm = chunkSoup(it, true);
  groundAudit(it, sm, 'mid', foot);
  openShells(sf);
  // Seams on the chunk's west and north edges (each edge once): full|mid and mid|coarse stand-in.
  const x0 = it.i * CHUNK, z0 = it.j * CHUNK;
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const g1 = seamGap(x0, z0, dx, dz, CHUNK / Math.round(CHUNK / 0.64), 2);
    const g2 = seamGap(x0, z0, dx, dz, 2, 4, -0.03);
    seamN++; seamMax = Math.max(seamMax, g1); if (g1 > 0.02) seamOver++;
    seamMaxMid = Math.max(seamMaxMid, g2); if (g2 > 0.02) seamOverMid++;
    if (seamRows.length < 20000 && (g1 > 0.02 || g2 > 0.02)) seamRows.push([x0, z0, dx, dz, +g1.toFixed(3), +g2.toFixed(3)]);
  }
  if (++done % 200 === 0) log('ground', done, '/', run.length, 'holes', JSON.stringify(holeCount));
}
openShells(L);
log('ground done', JSON.stringify(holeCount));

// C, by blocks of 4x4 chunks with a chunk of apron (rays are 32 m long).
const blocks = new Map<string, ChunkItems[]>();
for (const it of run) if (eyeSet.has(it.key)) {
  const k = `${Math.floor(it.i / 4)},${Math.floor(it.j / 4)}`;
  if (!blocks.has(k)) blocks.set(k, []);
  blocks.get(k)!.push(it);
}
let bn = 0;
for (const [k, members] of blocks) {
  const [bi, bj] = k.split(',').map(Number);
  const soups: Soup[] = [];
  for (let i = bi * 4 - 1; i <= bi * 4 + 4; i++) for (let j = bj * 4 - 1; j <= bj * 4 + 4; j++) {
    const it = itemAt(i, j);
    if (it) soups.push(fullSoup(it));
  }
  const s = concat(soups);
  const b = bvhOf(s);
  const list: BV[] = b ? [LBV, { bvh: b.bvh, soup: s }] : [LBV];
  for (const it of members) eyeAudit(it, list, footCache.get(it.key) ?? footprintMask(it));
  // Chunks no later block needs can go.
  // (blocks come row by row: rows of chunks above this block's apron are done with)
  for (const [key] of full) if ((key % 4096) - 2048 < bj * 4 - 1) full.delete(key);
  if (++bn % 10 === 0) log('eyes: block', bn, '/', blocks.size, 'eyes', eyes.length, 'back', backRays, 'hole', holeRays);
}
log('eyes done', eyes.length);

// ---------------------------------------------------------------- E. glTF props and trees
interface AssetRow { asset: string; tris: number; boundaryEdges: number; doubleSided: string; backSeenIfFront: number }
const assets: AssetRow[] = [];
for (const dir of ['public/models/props', 'public/models/trees']) {
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
  for (const f of files) {
    const prims = readGltf(join(dir, f));
    let n = 0;
    for (const p of prims) n += p.pos.length / 9;
    if (!n) continue;
    const s: Soup = { pos: new Float32Array(n * 9), mat: new Uint8Array(n), ds: new Uint8Array(n), tag: new Uint32Array(n), n };
    let k = 0;
    for (const p of prims) { s.pos.set(p.pos, k * 9); k += p.pos.length / 9; }
    // Open edges, welded at 0.1 mm.
    const vid = new Map<string, number>(), edges = new Map<number, number>();
    const id = (o3: number) => { const key = `${Math.round(s.pos[o3] * 1e4)},${Math.round(s.pos[o3 + 1] * 1e4)},${Math.round(s.pos[o3 + 2] * 1e4)}`; let v = vid.get(key); if (v === undefined) { v = vid.size; vid.set(key, v); } return v; };
    for (let t = 0; t < n; t++) { const a = id(t * 9), b2 = id(t * 9 + 3), c = id(t * 9 + 6); for (const [u, v] of [[a, b2], [b2, c], [c, a]]) { if (u === v) continue; const kk = u < v ? u * 67108864 + v : v * 67108864 + u; edges.set(kk, (edges.get(kk) ?? 0) + 1); } }
    let be = 0; for (const c of edges.values()) if (c === 1) be++;
    // From a dome of viewpoints (as a standing person sees a thing on the ground):
    // the share of rays that would meet a back face if it were drawn one-sided.
    const bv = bvhOf(s)!;
    const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(s.pos, 3));
    const c = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2;
    let hits = 0, backs = 0;
    const rnd = (() => { let q = 7; return () => ((q = (q * 16807) % 2147483647) / 2147483647); })();
    for (let v = 0; v < 400; v++) {
      const el = (10 + 70 * rnd()) * Math.PI / 180, az = rnd() * Math.PI * 2;
      const eye = c.clone().add(new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(rad * 3));
      const target = new THREE.Vector3(box.min.x + rnd() * (box.max.x - box.min.x), box.min.y + rnd() * (box.max.y - box.min.y), box.min.z + rnd() * (box.max.z - box.min.z));
      const h = first([{ bvh: bv.bvh, soup: s }], eye, target.sub(eye).normalize(), rad * 8);
      if (!h) continue;
      hits++;
      const d = ray.direction;
      if (h.nx * d.x + h.ny * d.y + h.nz * d.z > 0) backs++;
    }
    const dsSet = new Set(prims.map((p) => (p.doubleSided ? 'double' : 'front')));
    assets.push({ asset: `${dir.split('/').pop()}/${f}`, tris: n, boundaryEdges: be, doubleSided: [...dsSet].join('+'), backSeenIfFront: hits ? +(backs / hits).toFixed(3) : 0 });
  }
}
log('assets', assets.length);

// ---------------------------------------------------------------- report
const rows = [...tagStats.entries()].map(([k, v]) => {
  const [mat, ...src] = k.split('|');
  return { material: mat, source: src.join('|'), tris: v.tris, boundaryEdges: v.bEdges, boundaryLength: +v.bLen.toFixed(1), backHits: v.back, samples: v.pts.slice(0, 8) };
}).sort((a, b) => b.backHits - a.backHits || b.boundaryLength - a.boundaryLength);
const bySrcModule = new Map<string, { backHits: number; openSources: number; boundaryLength: number }>();
for (const r of rows) {
  const m = r.source.split(' > ')[0].split('#')[0];
  const e = bySrcModule.get(m) ?? { backHits: 0, openSources: 0, boundaryLength: 0 };
  e.backHits += r.backHits; e.boundaryLength += r.boundaryLength; if (r.boundaryEdges) e.openSources++;
  bySrcModule.set(m, e);
}
const worst = [...eyes].sort((a, b) => (b.back + 3 * b.hole) - (a.back + 3 * a.hole)).slice(0, 80);
const summary = {
  when: new Date().toISOString(), quick: QUICK,
  groundPointsTested: groundPoints,
  groundHoles: holeCount,
  lodSeams: { edges: seamN, fullVsMidMaxGap: +seamMax.toFixed(3), fullVsMidOver2cm: seamOver, midVsCoarseMaxGap: +seamMaxMid.toFixed(3), midVsCoarseOver2cm: seamOverMid },
  eyes: { standingPoints: eyes.length, skippedInsideSolid: eyesInside, rays: eyeRays, backFaceRays: backRays, seeThroughGroundRays: holeRays,
    backFacePerMille: +(1000 * backRays / Math.max(1, eyeRays)).toFixed(3), seeThroughPerMille: +(1000 * holeRays / Math.max(1, eyeRays)).toFixed(3),
    eyesWithBackFaces: eyes.filter((e) => e.back > 0).length, eyesWithSeeThrough: eyes.filter((e) => e.hole > 0).length },
  openSurfaces: { sources: rows.length, sourcesWithBoundary: rows.filter((r) => r.boundaryEdges > 0).length, sourcesSeenFromBehind: rows.filter((r) => r.backHits > 0).length,
    boundaryEdges: rows.reduce((a, r) => a + r.boundaryEdges, 0) },
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ summary, byModule: Object.fromEntries([...bySrcModule].sort((a, b) => b[1].backHits - a[1].backHits)), sources: rows, assets, worstEyes: worst, seams: seamRows.slice(0, 2000), holes: holePts.filter((h) => h.lod === 'full').slice(0, 5000) }, null, 1));
// A lattice of standing points (one per 40 m cell, in and around the town) for the render audit.
{
  const seen = new Set<string>(), grid: { id: string; x: number; y: number; z: number }[] = [];
  for (const e of eyes) {
    const k = `${Math.floor(e.x / 40)},${Math.floor(e.z / 40)}`;
    if (seen.has(k) || !(insideness(e.x, e.z) > 0.3 || Object.values(SITES).some((s) => Math.hypot(e.x - s.x, e.z - s.z) < 40))) continue;
    seen.add(k);
    grid.push({ id: `g${grid.length}`, x: e.x, y: e.y, z: e.z });
  }
  writeFileSync(join(OUT, 'grid.json'), JSON.stringify(grid, null, 1));
}
writeFileSync(join(OUT, 'views.json'), JSON.stringify(worst.slice(0, 40).map((e) => ({ x: e.x, y: e.y, z: e.z, yaw: e.back >= e.hole * 3 ? e.yawBack : e.yawHole, back: e.back, hole: e.hole })), null, 1));
log(JSON.stringify(summary, null, 1));

// ---------------------------------------------------------------- the map
{
  const S = 1; // px per metre
  const w = Math.ceil((BOUNDS.x1 - BOUNDS.x0) * S), h = Math.ceil((BOUNDS.z1 - BOUNDS.z0) * S);
  const img = Buffer.alloc(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = BOUNDS.x0 + (i + 0.5) / S, z = BOUNDS.z0 + (j + 0.5) / S, c = R.at(x, z), o3 = (j * w + i) * 3;
    const v = c === HOUSE ? 70 : c === STREET ? 150 : c === PLOT ? 115 : 30 + Math.max(0, Math.min(40, (fastTerrain(x, z) + 10) * 0.4));
    img[o3] = img[o3 + 1] = img[o3 + 2] = v;
  }
  const put = (x: number, z: number, rgb: number[], r = 0) => {
    const ci = Math.floor((x - BOUNDS.x0) * S), cj = Math.floor((z - BOUNDS.z0) * S);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const o3 = (j * w + i) * 3; img[o3] = rgb[0]; img[o3 + 1] = rgb[1]; img[o3 + 2] = rgb[2];
    }
  };
  for (let k = 0; k < WALL700.length; k++) {
    const a = WALL700[k], c = WALL700[(k + 1) % WALL700.length], n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]));
    for (let s = 0; s <= n; s++) put(a[0] + (c[0] - a[0]) * s / n, a[1] + (c[1] - a[1]) * s / n, [200, 170, 90]);
  }
  for (const p of sightHoles) put(p[0], p[1], [255, 150, 0]);
  for (const r of rows) if (r.backHits) for (const p of r.samples) put(p[0], p[2], [255, 0, 255], 1);
  for (const p of holePts) put(p.x, p.z, p.lod === 'mid' ? [0, 160, 255] : p.kind === 'stair' ? [255, 255, 0] : [255, 30, 30], p.lod === 'full' ? 1 : 0);
  for (const e of eyes) if (e.back + e.hole > 6) put(e.x, e.z, [255, 0, 255], 2);
  await sharp(img, { raw: { width: w, height: h, channels: 3 } }).png().toFile(join(OUT, 'holes-map.png'));
  // A close-up of the walled town.
  const cx0 = -330 - BOUNDS.x0, cz0 = -420 - BOUNDS.z0;
  await sharp(img, { raw: { width: w, height: h, channels: 3 } }).extract({ left: Math.max(0, cx0), top: Math.max(0, cz0), width: 1000, height: 620 }).resize(2000).png().toFile(join(OUT, 'holes-map-town.png'));
}
log('wrote', OUT);
void siteToWorld; void ({} as P2);
