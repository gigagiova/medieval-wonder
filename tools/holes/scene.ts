import './dom-shim';
// The world's geometry as the game builds it, for the offline audits: the
// streamed town chunks through the fabric code (as the worker builds them, in
// full and middle detail), the landmarks, bridges and rivers, each triangle
// with its material, its draw side and its source tag (see tag.ts).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { installTagging, tagId, type Tagged } from './tag';
import { Builder, DETAIL } from '../../src/builder';
import { MAT, type MatName } from '../../src/materials';
import { setTessScale } from '../../src/displace';
import { buildChunk, makeChunks, type ChunkItems, type Hole } from '../../src/benevento/fabric';
import { initLayout, buildLandmarks } from '../../src/world';
import { buildRivers } from '../../src/benevento/rivers';
import { buildPonteFratto } from '../../src/benevento/pontefratto';
import type { Layout } from '../../src/benevento/layout';

/** A triangle soup: 9 floats per triangle, and per triangle its material id, double-sidedness and tag. */
export interface Soup { pos: Float32Array; mat: Uint8Array; ds: Uint8Array; tag: Uint32Array; n: number }
export const MAT_NAME: string[] = [];
for (const [k, v] of Object.entries(MAT)) MAT_NAME[v] = k;
/** Ids above the surface materials: meshes the modules add to the scene themselves. */
export const SCENE_MAT = 40;

export function soupOfBuilder(b: Builder): Soup {
  let n = 0;
  for (const geos of b.parts.values()) for (const g of geos) n += g.attributes.position.count / 3;
  const pos = new Float32Array(n * 9), mat = new Uint8Array(n), ds = new Uint8Array(n), tag = new Uint32Array(n);
  let o = 0;
  for (const [m, geos] of b.parts) for (const g of geos) {
    const P = g.attributes.position.array as Float32Array, k = P.length / 9;
    pos.set(P, o * 9);
    mat.fill(MAT[m as MatName], o, o + k);
    const t = (g.userData as Tagged).tags;
    if (t && t.length === k) tag.set(t, o); else tag.fill(tagId('untagged:' + m), o, o + k);
    o += k;
  }
  b.parts.clear();
  return { pos, mat, ds, tag, n };
}

/** Meshes a module put straight into the scene (water, Ponte Fratto's own pieces). */
export function soupOfScene(scene: THREE.Object3D, label: string): Soup {
  const parts: { P: Float32Array; ds: boolean; name: string }[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const g = m.geometry as THREE.BufferGeometry;
    if (!g?.attributes?.position || (g.attributes.position as unknown as { isGLBufferAttribute?: boolean }).isGLBufferAttribute) return;
    const ng = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m.matrixWorld);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    parts.push({ P: ng.attributes.position.array as Float32Array, ds: mats[0]?.side === THREE.DoubleSide, name: m.name || (mats[0] as THREE.Material)?.type || 'mesh' });
  });
  let n = 0;
  for (const p of parts) n += p.P.length / 9;
  const pos = new Float32Array(n * 9), mat = new Uint8Array(n).fill(SCENE_MAT), ds = new Uint8Array(n), tag = new Uint32Array(n);
  let o = 0;
  for (const p of parts) {
    const k = p.P.length / 9;
    pos.set(p.P, o * 9);
    ds.fill(p.ds ? 1 : 0, o, o + k);
    tag.fill(tagId(`${label}:${p.name}`), o, o + k);
    o += k;
  }
  return { pos, mat, ds, tag, n };
}

export function concat(list: Soup[]): Soup {
  const n = list.reduce((a, s) => a + s.n, 0);
  const out: Soup = { pos: new Float32Array(n * 9), mat: new Uint8Array(n), ds: new Uint8Array(n), tag: new Uint32Array(n), n };
  let o = 0;
  for (const s of list) { out.pos.set(s.pos, o * 9); out.mat.set(s.mat, o); out.ds.set(s.ds, o); out.tag.set(s.tag, o); o += s.n; }
  return out;
}

export interface World { lay: Layout; holes: Hole[]; items: Map<number, ChunkItems> }
export function prepareWorld(): World {
  installTagging();
  const { lay, holes } = initLayout();
  const items = makeChunks(lay, holes);
  return { lay, holes, items };
}

/** Landmarks (main-thread tessellation), Ponte Fratto, bridges and rivers. */
export async function landmarkSoup(): Promise<Soup> {
  setTessScale(1);
  DETAIL.mid = false;
  const scene = new THREE.Scene();
  const b = new Builder();
  b.mode = 'render';
  await buildLandmarks(scene, b, async () => {}, { reliefs: false });
  buildPonteFratto(scene, b);
  const s1 = soupOfBuilder(b);
  const water = new THREE.Scene();
  buildRivers(water);
  return concat([s1, soupOfScene(scene, 'landmark-scene'), soupOfScene(water, 'rivers')]);
}

/** One town chunk as the fabric worker builds it (full or middle detail). */
export function chunkSoup(it: ChunkItems, mid: boolean): Soup {
  DETAIL.mid = mid;
  setTessScale(mid ? 5 : 1.9);
  const b = new Builder();
  b.mode = 'render';
  buildChunk(b, it);
  const s = soupOfBuilder(b);
  DETAIL.mid = false;
  return s;
}

/** A BVH over a soup (positions only; the soup keeps the per-triangle data). */
export function bvhOf(s: Soup): { bvh: MeshBVH; geo: THREE.BufferGeometry } | null {
  if (!s.n) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(s.pos, 3));
  const bvh = new MeshBVH(geo, { maxLeafSize: 8 });
  return { bvh, geo };
}
