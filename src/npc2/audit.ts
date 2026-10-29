import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Poke-through audit for the v2 townsfolk (dev only: the test page imports
// it). For one posed person: every visible vertex of an inner layer (the body,
// or a garment worn under another) that has come out through an outer garment
// — a short ray back in along its normal meets that garment's surface from
// outside — counted, per pair of layers. Bind-pose offenders (already outside
// at bind) are left out: those are where the cloth simply ends.

type Layer = { mesh: THREE.SkinnedMesh; depth: number; name: string };

function layers(body: THREE.Object3D, depthOf: (g: string) => number): Layer[] {
  const out: Layer[] = [];
  body.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    if (o.userData.npc2 === 'body') out.push({ mesh: m, depth: -1, name: 'body' });
    else if (o.userData.npc2 === 'garment') out.push({ mesh: m, depth: depthOf(o.userData.garment), name: o.userData.garment });
  });
  return out;
}

/** Posed (or bind, with `bind`) positions and normals of a mesh's indexed vertices, in world space. */
function posed(m: THREE.SkinnedMesh, bind = false) {
  const g = m.geometry, p = g.attributes.position, n = g.attributes.normal;
  const used = new Set<number>(g.index ? (g.index.array as unknown as number[]) : Array.from({ length: p.count }, (_, i) => i));
  const P = new Map<number, THREE.Vector3>(), N = new Map<number, THREE.Vector3>();
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (const i of used) {
    if (bind) { P.set(i, v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).clone()); N.set(i, w.fromBufferAttribute(n, i).transformDirection(m.matrixWorld).clone()); continue; }
    m.getVertexPosition(i, v);
    const skinned = v.clone();
    // (Garments kept off the limbs on the GPU, src/npc2/push.ts: the same projection here.)
    (m.userData.push as ((p: THREE.Vector3, i: number) => void) | undefined)?.(v, i);
    // Normal: skin a point a millimetre out along it.
    w.fromBufferAttribute(p, i).addScaledVector(new THREE.Vector3().fromBufferAttribute(n, i), 0.001);
    const tmp = p.getX(i), ty = p.getY(i), tz = p.getZ(i);
    p.setXYZ(i, w.x, w.y, w.z);
    const q = m.getVertexPosition(i, new THREE.Vector3());
    p.setXYZ(i, tmp, ty, tz);
    P.set(i, v.clone().applyMatrix4(m.matrixWorld));
    N.set(i, q.sub(skinned).transformDirection(m.matrixWorld));
  }
  return { P, N };
}

function shell(m: THREE.SkinnedMesh, bind = false) {
  const g = new THREE.BufferGeometry();
  const src = m.geometry, p = src.attributes.position, arr = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    if (bind) v.fromBufferAttribute(p, i); else { m.getVertexPosition(i, v); (m.userData.push as ((q: THREE.Vector3, i: number) => void) | undefined)?.(v, i); }
    v.applyMatrix4(m.matrixWorld);
    arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
  }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.setIndex(src.index!.clone());
  return new MeshBVH(g);
}

const ray = new THREE.Ray();
function outside(bvh: MeshBVH, p: THREE.Vector3, n: THREE.Vector3, reach: number) {
  ray.origin.copy(p).addScaledVector(n, 0.0005);
  ray.direction.copy(n).negate();
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, reach);
  if (!hit || !hit.face) return false;
  // Its face turned the way we came from: we are on the garment's outer side.
  const a = bvh.geometry.attributes.position, f = hit.face;
  const A = new THREE.Vector3().fromBufferAttribute(a, f.a), B = new THREE.Vector3().fromBufferAttribute(a, f.b), C = new THREE.Vector3().fromBufferAttribute(a, f.c);
  const fn = B.sub(A).cross(C.sub(A)).normalize();
  return fn.dot(n) > 0.2;
}

/**
 * Which vertices of a mesh are on its outer surface: in the bind pose, the
 * normal points away from the axis of the vertex's main bone (bone to its
 * first child). A shoe's lining, a garment's turned-in facing or a hem's
 * inside face away from the limb: they can only be seen through an opening,
 * never come out "through" a garment, so they are not counted. Cached.
 */
function outerSurface(m: THREE.SkinnedMesh) {
  if (m.userData.auditOuter) return m.userData.auditOuter as Uint8Array;
  const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, J = g.attributes.skinIndex, W = g.attributes.skinWeight;
  const sk = m.skeleton, at = (b: THREE.Bone) => new THREE.Vector3().setFromMatrixPosition(sk.boneInverses[sk.bones.indexOf(b)].clone().invert());
  const ends = sk.bones.map((b) => { const h = at(b), c = b.children.find((x) => (x as THREE.Bone).isBone) as THREE.Bone | undefined; return [h, c && sk.bones.includes(c) ? at(c) : h.clone()]; });
  const out = new Uint8Array(P.count), v = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Vector3(), ab = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    let best = 0, w = -1;
    for (let k = 0; k < 4; k++) if (W.getComponent(i, k) > w) { w = W.getComponent(i, k); best = J.getComponent(i, k); }
    const [a, b] = ends[best];
    v.fromBufferAttribute(P, i).applyMatrix4(m.bindMatrix); n.fromBufferAttribute(N, i).transformDirection(m.bindMatrix);
    ab.subVectors(b, a);
    const t = ab.lengthSq() > 1e-10 ? THREE.MathUtils.clamp(q.subVectors(v, a).dot(ab) / ab.lengthSq(), 0, 1) : 0;
    q.copy(a).addScaledVector(ab, t);
    out[i] = n.dot(v.sub(q)) > 0 ? 1 : 0;
  }
  m.userData.auditOuter = out;
  return out;
}

/** The bone with the largest skin weight on a vertex (where on the body a crossing is). */
function mainBone(m: THREE.SkinnedMesh, i: number) {
  const J = m.geometry.attributes.skinIndex, W = m.geometry.attributes.skinWeight;
  let best = 0, w = -1;
  for (let k = 0; k < 4; k++) if (W.getComponent(i, k) > w) { w = W.getComponent(i, k); best = J.getComponent(i, k); }
  return m.skeleton.bones[best]?.name.replace('mixamorig', '') ?? '?';
}

/**
 * Count poke-through vertices for a person in its current pose. With
 * `where`, also tally each pair's offenders by the inner vertex's main bone.
 */
export function pokeAudit(body: THREE.Object3D, depthOf: (g: string) => number, reach = 0.03, where?: Record<string, Record<string, number>>) {
  body.updateMatrixWorld(true);
  const L = layers(body, depthOf);
  const res: Record<string, number> = {};
  for (const outer of L) {
    if (outer.depth < 0) continue;
    const bvhP = shell(outer.mesh), bvhB = shell(outer.mesh, true);
    for (const inner of L) {
      if (inner.depth >= outer.depth || inner === outer) continue;
      const pp = posed(inner.mesh), pb = posed(inner.mesh, true), surf = outerSurface(inner.mesh);
      let k = 0;
      for (const [i, p] of pp.P) {
        if (!surf[i]) continue;
        if (!outside(bvhP, p, pp.N.get(i)!, reach)) continue;
        if (outside(bvhB, pb.P.get(i)!, pb.N.get(i)!, reach)) continue;
        k++;
        if (where) { const key = `${inner.name}>${outer.name}`, b = mainBone(inner.mesh, i); (where[key] ??= {})[b] = (where[key][b] ?? 0) + 1; }
      }
      if (k) res[`${inner.name}>${outer.name}`] = k;
    }
  }
  return res;
}
