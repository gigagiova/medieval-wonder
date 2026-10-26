import * as THREE from 'three';

// Cluster culling inside a cell.
//
// A cell (a town chunk, a landmark cell) is merged by material, so its draw
// calls stay few. Culled whole, though, every triangle of a cell that shows
// at all went to the GPU: standing in a lane, the houses behind the lane's
// walls and everything beside the narrow phone view were drawn with the rest.
// So each merged mesh's triangles are sorted by a small square of the cell
// (a cluster, 8-9 m, about a house), and the draw is fed by an index buffer
// that lists only the clusters in view: in the frustum, not wholly fogged,
// not behind the houses of the occlusion buffer. The call count does not
// change; an index is rewritten only when the set of clusters in view
// changes (a sub-range upload). Landmark cells keep an index per mesh here;
// the town's chunks share one per material (benevento/pool.ts).

/** Clusters per side of a cell. */
export const CL = 4;
export const NCL = CL * CL;

export interface Sorted { pos: Float32Array; nor: Int8Array | Float32Array; ids?: Uint8Array; start: Uint32Array; count: Uint32Array; box: Float32Array }

/**
 * Sort a triangle soup by cluster (centroid on a CL×CL grid over the square
 * x0..x0+size, z0..z0+size; outside it, clamped to the edge). Returns the
 * sorted arrays, each cluster's first vertex and vertex count, and its box
 * (6 floats per cluster: min xyz, max xyz; empty clusters get an inverted box).
 */
export function sortByCluster(pos: Float32Array, nor: Int8Array | Float32Array, x0: number, z0: number, size: number, ids?: Uint8Array): Sorted {
  const nt = pos.length / 9;
  const cl = new Uint8Array(nt);
  const cnt = new Uint32Array(NCL);
  const k = CL / size;
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const cx = (pos[o] + pos[o + 3] + pos[o + 6]) / 3, cz = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    const i = Math.min(CL - 1, Math.max(0, Math.floor((cx - x0) * k))), j = Math.min(CL - 1, Math.max(0, Math.floor((cz - z0) * k)));
    cl[t] = j * CL + i;
    cnt[cl[t]]++;
  }
  const start = new Uint32Array(NCL), count = new Uint32Array(NCL);
  let s = 0;
  for (let c = 0; c < NCL; c++) { start[c] = s * 3; count[c] = cnt[c] * 3; s += cnt[c]; }
  const P = new Float32Array(pos.length);
  const N = new (nor.constructor as Int8ArrayConstructor | Float32ArrayConstructor)(nor.length);
  const I = ids ? new Uint8Array(ids.length) : undefined;
  const at = new Uint32Array(NCL);
  for (let c = 0; c < NCL; c++) at[c] = start[c] / 3;
  const box = new Float32Array(NCL * 6);
  for (let c = 0; c < NCL; c++) box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], c * 6);
  for (let t = 0; t < nt; t++) {
    const c = cl[t], d = at[c]++;
    P.set(pos.subarray(t * 9, t * 9 + 9), d * 9);
    N.set(nor.subarray(t * 9, t * 9 + 9), d * 9);
    if (I) I.set(ids!.subarray(t * 3, t * 3 + 3), d * 3);
    const b = c * 6;
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      for (let a = 0; a < 3; a++) {
        const x = pos[o + a];
        if (x < box[b + a]) box[b + a] = x;
        if (x > box[b + 3 + a]) box[b + 3 + a] = x;
      }
    }
  }
  return { pos: P, nor: N, ids: I, start, count, box };
}

/** One mesh of a clustered cell: where each cluster's vertices are. */
interface Part { mesh: THREE.Mesh; start: Uint32Array; count: Uint32Array; index: THREE.BufferAttribute; shown: number }
export interface Clusters {
  /** Each cluster's box over all the cell's meshes (empty clusters: null). */
  boxes: (THREE.Box3 | null)[];
  parts: Part[];
  /** Clusters drawn now (bit c = cluster c). */
  mask: number;
}

export function newClusters(): Clusters {
  return { boxes: new Array(NCL).fill(null), parts: [], mask: (1 << NCL) - 1 };
}

/**
 * Register a mesh (whose geometry was sorted by sortByCluster) with its cell's
 * clusters: gives it an index buffer listing every cluster for now.
 */
export function addClustered(cl: Clusters, mesh: THREE.Mesh, s: { start: Uint32Array; count: Uint32Array; box: Float32Array }) {
  const g = mesh.geometry;
  const nv = g.attributes.position.count;
  const arr = nv > 65535 ? new Uint32Array(nv) : new Uint16Array(nv);
  for (let i = 0; i < nv; i++) arr[i] = i;
  const index = new THREE.BufferAttribute(arr, 1);
  index.setUsage(THREE.DynamicDrawUsage);
  g.setIndex(index);
  cl.parts.push({ mesh, start: s.start, count: s.count, index, shown: nv });
  addBoxes(cl, s.box);
}

/** Grow the clusters' boxes by a sorted mesh's (6 floats per cluster). */
export function addBoxes(cl: Clusters, box: Float32Array) {
  for (let c = 0; c < NCL; c++) {
    const b = c * 6;
    if (!(box[b] <= box[b + 3])) continue;
    const bx = cl.boxes[c] ?? (cl.boxes[c] = new THREE.Box3());
    bx.expandByPoint(new THREE.Vector3(box[b], box[b + 1], box[b + 2]));
    bx.expandByPoint(new THREE.Vector3(box[b + 3], box[b + 4], box[b + 5]));
  }
}

export const clusterStats = { rewrites: 0, uploaded: 0 };

/** Draw only the clusters in `mask` from now on (rewrites the index buffers if it changed). */
export function setClusterMask(cl: Clusters, mask: number) {
  if (mask === cl.mask) return;
  cl.mask = mask;
  for (const p of cl.parts) {
    const a = p.index.array as Uint16Array | Uint32Array;
    let n = 0;
    for (let c = 0; c < NCL; c++) {
      if (!((mask >> c) & 1)) continue;
      const s = p.start[c], e = s + p.count[c];
      for (let i = s; i < e; i++) a[n++] = i;
    }
    p.shown = n;
    p.mesh.geometry.setDrawRange(0, n);
    if (n) {
      p.index.clearUpdateRanges();
      p.index.addUpdateRange(0, n);
      p.index.needsUpdate = true;
      clusterStats.rewrites++;
      clusterStats.uploaded += n * a.BYTES_PER_ELEMENT;
    }
  }
}

const _f = new THREE.Frustum(), _m = new THREE.Matrix4(), _b = new THREE.Box3();
/** The view frustum for this frame (call once per frame before clusterMask). */
export function clusterFrustum(camera: THREE.Camera) {
  camera.updateMatrixWorld();
  _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _f.setFromProjectionMatrix(_m);
}

/**
 * Which clusters to draw: in the frustum (boxes grown by `margin`, so turning
 * slowly does not rewrite the index every frame) and not hidden by `hide`.
 */
export function clusterMask(cl: Clusters, hide: ((b: THREE.Box3) => boolean) | null, margin = 1.5) {
  let mask = 0;
  for (let c = 0; c < NCL; c++) {
    const b = cl.boxes[c];
    if (!b) continue;
    _b.copy(b).expandByScalar(margin);
    if (!_f.intersectsBox(_b)) continue;
    if (hide && hide(b)) continue;
    mask |= 1 << c;
  }
  return mask;
}

/**
 * Draw every cluster for a moment (a bake from another view: the light field)
 * without touching the index buffers: the meshes go back to their plain
 * vertex order, and back again with `false`.
 */
export function clustersWhole(cl: Clusters, whole: boolean) {
  for (const p of cl.parts) {
    const g = p.mesh.geometry;
    if (whole) { g.setIndex(null); g.setDrawRange(0, Infinity); }
    else { g.setIndex(p.index); g.setDrawRange(0, p.shown); }
  }
}
