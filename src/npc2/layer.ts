import * as THREE from 'three';

// Layer constraint: an outer garment (a cloak, a hood's cape) kept outside the
// actual garment beneath it, per vertex, on the GPU.
//
// The capsules of push.ts stand in for the limbs and the trunk; they cannot
// follow the skirt of a tunic swinging on its own cloth bones, the gathered
// blouse above a belt, or a robe's shoulder cape, so a cloak hung on its own
// cloth bones still cut through them. Here each outer vertex is tied, once,
// in the bind pose, to the nearest point of the layer beneath that it lies
// over (the inner vertex, its normal, its skin). Every frame the vertex
// shader skins that inner point with the inner garment's own bones (the
// skeleton's bone texture is shared) and, if the outer vertex has come
// within `gap` of the inner surface or through it, moves it back out along
// the inner surface's normal. It is the cloth-layer ordering of layered
// clothing (keep the outer layer on the outside of the inner one, e.g.
// Bridson, Fedkiw and Anderson, SIGGRAPH 2002, for cloth against cloth), as a
// one-sided projection against a bound point rather than a collision search.
// Cost: one extra 4-bone skinning per outer vertex; nothing on the CPU per frame.

export const LAYER_HEAD = 'attribute vec3 pIn; attribute vec4 pInJ; attribute vec4 pInW; attribute vec4 pInN;';
export const LAYER_BODY = `
  if (pInW.x + pInW.y + pInW.z + pInW.w > 0.5) {
    mat4 lsm = getBoneMatrix(pInJ.x) * pInW.x + getBoneMatrix(pInJ.y) * pInW.y + getBoneMatrix(pInJ.z) * pInW.z + getBoneMatrix(pInJ.w) * pInW.w;
    lsm = bindMatrixInverse * lsm * bindMatrix;
    vec3 iq = (lsm * vec4(pIn, 1.0)).xyz;
    vec3 inq = normalize((lsm * vec4(pInN.xyz, 0.0)).xyz);
    vec3 dd = transformed - iq;
    float dn = dot(dd, inq);
    float lat = length(dd - inq * dn);
    if (dn < pInN.w && dn > -0.12 && lat < 0.08) transformed += inq * (pInN.w - dn);
  }`;

// A cloak is coarse (its triangles span 5-8 cm): its vertices must keep the clearance
// they had in the bind pose, up to GAP_MAX, for the cloth between them to clear the folds beneath.
const REACH = 0.25, CELL = 0.05, GAP_MAX = 0.03;

/**
 * Bind each outer vertex to the inner layer beneath it (attributes pIn, pInJ,
 * pInW, pInN on the outer geometry, cloned if another person's outfit bound it
 * differently). Returns whether any vertex was bound.
 */
export function bindLayer(outer: THREE.SkinnedMesh, inners: THREE.SkinnedMesh[]) {
  const key = inners.map((m) => m.geometry.uuid).sort().join(',');
  if (outer.geometry.userData.layerKey === key) return !!outer.geometry.userData.layerAny;
  if (outer.geometry.userData.layerKey !== undefined) outer.geometry = outer.geometry.clone();
  const geo = outer.geometry, P = geo.attributes.position, n = P.count;
  // Inner points in the outer mesh's local bind space.
  const toOuter = new THREE.Matrix4();
  const pts: { p: THREE.Vector3; nrm: THREE.Vector3; j: number[]; w: number[] }[] = [];
  for (const m of inners) {
    toOuter.multiplyMatrices(outer.bindMatrixInverse, m.bindMatrix);
    const g = m.geometry, IP = g.attributes.position, IN = g.attributes.normal, IJ = g.attributes.skinIndex, IW = g.attributes.skinWeight;
    const used = g.index ? new Set(g.index.array as unknown as number[]) : null;
    // Bone indices refer to the inner mesh's skeleton; map them to the outer's.
    const map = m.skeleton.bones.map((b) => outer.skeleton.bones.indexOf(b));
    for (let i = 0; i < IP.count; i++) {
      if (used && !used.has(i)) continue;
      pts.push({
        p: new THREE.Vector3().fromBufferAttribute(IP, i).applyMatrix4(toOuter),
        nrm: new THREE.Vector3().fromBufferAttribute(IN, i).transformDirection(toOuter),
        j: [0, 1, 2, 3].map((k) => Math.max(0, map[IJ.getComponent(i, k)])),
        w: [0, 1, 2, 3].map((k) => (map[IJ.getComponent(i, k)] >= 0 ? IW.getComponent(i, k) : 0)),
      });
    }
  }
  const grid = new Map<string, number[]>();
  const cell = (v: THREE.Vector3) => [Math.floor(v.x / CELL), Math.floor(v.y / CELL), Math.floor(v.z / CELL)];
  pts.forEach((q, k) => { const c = cell(q.p).join(','); (grid.get(c) ?? grid.set(c, []).get(c)!).push(k); });
  const aP = new Float32Array(n * 3), aJ = new Float32Array(n * 4), aW = new Float32Array(n * 4), aN = new Float32Array(n * 4);
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  const R = Math.ceil(REACH / CELL);
  let any = false;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i);
    const [cx, cy, cz] = cell(v);
    let best = -1, bd = REACH * REACH;
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
      for (const k of grid.get(`${cx + x},${cy + y},${cz + z}`) ?? []) {
        const q = pts[k];
        d.subVectors(v, q.p);
        const l2 = d.lengthSq();
        // Over it: on the outer side of the inner surface (a little slack).
        if (l2 < bd && d.dot(q.nrm) > -0.004) { bd = l2; best = k; }
      }
    }
    if (best < 0) continue;
    const q = pts[best];
    const d0 = d.subVectors(v, q.p).dot(q.nrm);
    q.p.toArray(aP, i * 3);
    aJ.set(q.j, i * 4);
    const ws = q.w.reduce((a, b) => a + b, 0) || 1;
    aW.set(q.w.map((w) => w / ws), i * 4);
    q.nrm.toArray(aN, i * 4);
    // Kept at least as far out as in the bind pose, up to GAP_MAX (and never less than 4 mm).
    aN[i * 4 + 3] = THREE.MathUtils.clamp(d0, 0.004, GAP_MAX);
    any = true;
  }
  geo.setAttribute('pIn', new THREE.BufferAttribute(aP, 3));
  geo.setAttribute('pInJ', new THREE.BufferAttribute(aJ, 4));
  geo.setAttribute('pInW', new THREE.BufferAttribute(aW, 4));
  geo.setAttribute('pInN', new THREE.BufferAttribute(aN, 4));
  geo.userData.layerKey = key;
  geo.userData.layerAny = any;
  return any;
}

/** The same constraint on the CPU (for the audit): p skinned (and pushed), in the mesh's local space. */
export function layerPoint(m: THREE.SkinnedMesh, i: number, p: THREE.Vector3) {
  const g = m.geometry, W = g.attributes.pInW;
  if (!W) return p;
  const w = [0, 1, 2, 3].map((k) => W.getComponent(i, k));
  if (w[0] + w[1] + w[2] + w[3] < 0.5) return p;
  const J = g.attributes.pInJ, sk = m.skeleton;
  const sm = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), t = new THREE.Matrix4();
  for (let k = 0; k < 4; k++) {
    if (!w[k]) continue;
    const b = J.getComponent(i, k);
    t.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]);
    for (let e = 0; e < 16; e++) sm.elements[e] += t.elements[e] * w[k];
  }
  sm.premultiply(m.bindMatrixInverse).multiply(m.bindMatrix);
  const q = new THREE.Vector3().fromBufferAttribute(g.attributes.pIn as THREE.BufferAttribute, i).applyMatrix4(sm);
  const N = g.attributes.pInN;
  const nq = new THREE.Vector3(N.getX(i), N.getY(i), N.getZ(i)).transformDirection(sm);
  const gap = N.getW(i);
  const dd = p.clone().sub(q), dn = dd.dot(nq), lat = dd.addScaledVector(nq, -dn).length();
  if (dn < gap && dn > -0.12 && lat < 0.08) p.addScaledVector(nq, gap - dn);
  return p;
}
