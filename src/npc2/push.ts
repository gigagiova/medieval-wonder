import * as THREE from 'three';
import type { OutfitV2 } from './kit';

// Cloth kept outside the limbs it hangs over, per vertex, on the GPU.
//
// The cloth bones (springs.ts) push only their own tips out of the legs and
// arms; the cloth between two chains, a sleeve's cuff or a cloak's edge can
// still be crossed by a striding knee, a foot or a swinging hand. Here every
// garment vertex, after skinning, is pushed out of a few capsules round the
// limbs beneath it, in the vertex shader: the standard capsule collider of
// game cloth (NVIDIA NvCloth / PhysX cloth collision capsules; Unity's Cloth
// capsule colliders), applied as a post-skinning projection instead of a
// simulation, so it costs a few ALU per vertex and nothing on the CPU but
// the capsules' ends. Each capsule's radius is measured from what lies
// under the garment in this outfit (the visible body and the lower layers:
// the hose under a skirt, the sleeves under a cloak) round that bone,
// plus a margin, so the cloth passes clear of all of it.
//
// The audit (audit.ts) applies the same projection on the CPU (`userData.push`).

export const MAX_CAPS = 12;
const MARGIN = 0.008;

interface CapDef { a: string; b: string; from?: number; extend?: number; bones: string[]; /** Quantile of the inner layers' distances taken as the radius (default: all of them). */ q?: number }
interface Cap { a: THREE.Bone; b: THREE.Bone; from: number; extend: number; r: number }

// Which limbs each layer of garment is kept off.
const LEGS: CapDef[] = [
  { a: 'LeftUpLeg', b: 'LeftLeg', from: 0.35, bones: ['LeftUpLeg'] }, { a: 'RightUpLeg', b: 'RightLeg', from: 0.35, bones: ['RightUpLeg'] },
  { a: 'LeftLeg', b: 'LeftFoot', bones: ['LeftLeg'] }, { a: 'RightLeg', b: 'RightFoot', bones: ['RightLeg'] },
  { a: 'LeftFoot', b: 'LeftToeBase', extend: 0.6, bones: ['LeftFoot', 'LeftToeBase'] }, { a: 'RightFoot', b: 'RightToeBase', extend: 0.6, bones: ['RightFoot', 'RightToeBase'] },
];
const HANDS: CapDef[] = [
  { a: 'LeftHand', b: 'LeftHandMiddle1', extend: 0.7, bones: ['LeftHand'] }, { a: 'RightHand', b: 'RightHandMiddle1', extend: 0.7, bones: ['RightHand'] },
];
const ARMS: CapDef[] = [
  { a: 'LeftForeArm', b: 'LeftHand', bones: ['LeftForeArm'] }, { a: 'RightForeArm', b: 'RightHand', bones: ['RightForeArm'] },
  { a: 'LeftArm', b: 'LeftForeArm', from: 0.25, bones: ['LeftArm'] }, { a: 'RightArm', b: 'RightForeArm', from: 0.25, bones: ['RightArm'] },
];
const SHOULDERS: CapDef[] = [
  { a: 'LeftShoulder', b: 'LeftArm', from: 0.45, bones: ['LeftShoulder', 'LeftArm'], q: 0.97 }, { a: 'RightShoulder', b: 'RightArm', from: 0.45, bones: ['RightShoulder', 'RightArm'], q: 0.97 },
];
const UPPER: CapDef[] = [
  { a: 'LeftArm', b: 'LeftForeArm', bones: ['LeftArm'] }, { a: 'RightArm', b: 'RightForeArm', bones: ['RightArm'] },
];
const BY_LAYER: Record<string, CapDef[]> = {
  tunic: [...LEGS, ...HANDS],
  over: [...SHOULDERS, ...ARMS, ...HANDS, ...LEGS.slice(0, 4)],
  // A hood's shoulder cape over the tunic.
  head: [...SHOULDERS, ...UPPER],
};

const GLSL_HEAD = `uniform vec4 uPushA[${MAX_CAPS}]; uniform vec4 uPushB[${MAX_CAPS}];`;
const GLSL_BODY = `
  for (int i = 0; i < ${MAX_CAPS}; i++) {
    float r = uPushA[i].w;
    if (r <= 0.0) continue;
    vec3 a = uPushA[i].xyz, ab = uPushB[i].xyz - a;
    float t = clamp(dot(transformed - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    vec3 d = transformed - (a + ab * t);
    float l = length(d);
    if (l < r && l > 1e-5) transformed += d * (r / l - 1.0);
  }`;

/** The same projection on the CPU, for the audit: p in the mesh's local (bind) space. */
function pushPoint(p: THREE.Vector3, A: Float32Array, B: Float32Array) {
  for (let i = 0; i < MAX_CAPS; i++) {
    const r = A[i * 4 + 3];
    if (r <= 0) continue;
    const ax = A[i * 4], ay = A[i * 4 + 1], az = A[i * 4 + 2];
    const bx = B[i * 4] - ax, by = B[i * 4 + 1] - ay, bz = B[i * 4 + 2] - az;
    const t = Math.min(1, Math.max(0, ((p.x - ax) * bx + (p.y - ay) * by + (p.z - az) * bz) / Math.max(bx * bx + by * by + bz * bz, 1e-8)));
    const dx = p.x - (ax + bx * t), dy = p.y - (ay + by * t), dz = p.z - (az + bz * t);
    const l = Math.hypot(dx, dy, dz);
    if (l < r && l > 1e-5) { const k = r / l - 1; p.x += dx * k; p.y += dy * k; p.z += dz * k; }
  }
  return p;
}

/**
 * Set up the push for a person's garments (their cloned body, dressed).
 * Returns the per-frame update (call after the animation and the springs),
 * or null if nothing needs it.
 */
export function makePush(body: THREE.Object3D, outfit: OutfitV2, bone: (n: string) => THREE.Bone | undefined) {
  const depthOf = new Map(outfit.garments.map((g) => [g.id, (g as unknown as { depth?: number }).depth ?? 50]));
  const layerOf = new Map(outfit.garments.map((g) => [g.id, g.layer]));
  const meshes: THREE.SkinnedMesh[] = [];
  body.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const skel = meshes[0]?.skeleton;
  if (!skel) return null;
  // Bind-pose bone positions (in the meshes' shared bind space).
  const bindPos = (b: THREE.Bone) => new THREE.Vector3().setFromMatrixPosition(skel.boneInverses[skel.bones.indexOf(b)].clone().invert());
  const v = new THREE.Vector3(), seg = new THREE.Vector3(), q = new THREE.Vector3();
  /** Vertices (bind space) of the visible inner layers, by their main bone. */
  const innerBy = (depth: number) => {
    const by = new Map<THREE.Bone, THREE.Vector3[]>();
    for (const m of meshes) {
      const kind = m.userData.npc2, g = m.userData.garment as string | undefined;
      const d = kind === 'body' ? -1 : kind === 'garment' ? depthOf.get(g!) ?? 50 : null;
      if (d === null || d >= depth) continue;
      const geo = m.geometry, P = geo.attributes.position, J = geo.attributes.skinIndex, W = geo.attributes.skinWeight;
      const used = geo.index ? new Set(geo.index.array as unknown as number[]) : null;
      for (let i = 0; i < P.count; i++) {
        if (used && !used.has(i)) continue;
        let best = 0, w = -1;
        for (let k = 0; k < 4; k++) if (W.getComponent(i, k) > w) { w = W.getComponent(i, k); best = J.getComponent(i, k); }
        const b = m.skeleton.bones[best];
        if (!by.has(b)) by.set(b, []);
        by.get(b)!.push(v.fromBufferAttribute(P, i).clone());
      }
    }
    return by;
  };
  const setups: { mesh: THREE.SkinnedMesh; caps: Cap[]; A: Float32Array; B: Float32Array }[] = [];
  for (const m of meshes) {
    if (m.userData.npc2 !== 'garment') continue;
    const defs = BY_LAYER[layerOf.get(m.userData.garment as string) ?? ''];
    if (!defs) continue;
    const inner = innerBy(depthOf.get(m.userData.garment as string) ?? 50);
    const caps: Cap[] = [];
    for (const d of defs) {
      const a = bone(d.a), b = bone(d.b);
      if (!a || !b) continue;
      const pa = bindPos(a), pb = bindPos(b);
      const from = d.from ?? 0, extend = d.extend ?? 0;
      const s0 = pa.clone().lerp(pb, from), s1 = pb.clone().add(pb.clone().sub(pa).multiplyScalar(extend));
      seg.subVectors(s1, s0);
      const rs: number[] = [];
      for (const n of d.bones) {
        const bb = bone(n);
        for (const p of (bb && inner.get(bb)) ?? []) {
          const t = THREE.MathUtils.clamp(q.subVectors(p, s0).dot(seg) / seg.lengthSq(), 0, 1);
          // Only what lies along the capsule's own length (not round its rounded ends).
          if (t <= 0 || t >= 1) continue;
          rs.push(p.distanceTo(q.copy(s0).addScaledVector(seg, t)));
        }
      }
      if (rs.length < 8) continue;
      rs.sort((x, y) => x - y);
      caps.push({ a, b, from, extend, r: rs[Math.floor((rs.length - 1) * (d.q ?? 1))] + MARGIN });
    }
    if (!caps.length) continue;
    const A = new Float32Array(MAX_CAPS * 4), B = new Float32Array(MAX_CAPS * 4);
    const uA = { value: Array.from({ length: MAX_CAPS }, () => new THREE.Vector4()) }, uB = { value: Array.from({ length: MAX_CAPS }, () => new THREE.Vector4()) };
    const mat = m.material as THREE.Material;
    const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey();
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r);
      sh.uniforms.uPushA = uA; sh.uniforms.uPushB = uB;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${GLSL_HEAD}`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>${GLSL_BODY}`);
    };
    mat.customProgramCacheKey = () => key + '-push';
    m.onBeforeRender = () => {
      for (let i = 0; i < MAX_CAPS; i++) { uA.value[i].fromArray(A, i * 4); uB.value[i].fromArray(B, i * 4); }
      (mat as THREE.Material & { uniformsNeedUpdate: boolean }).uniformsNeedUpdate = true;
    };
    m.userData.push = (p: THREE.Vector3) => pushPoint(p, A, B);
    m.userData.pushCaps = caps.map((c) => [c.a.name, c.b.name, +c.r.toFixed(3)]);
    setups.push({ mesh: m, caps, A, B });
  }
  if (!setups.length) return null;
  const inv = new THREE.Matrix4(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
  return () => {
    // Capsule ends in each mesh's bind space: world bone positions through the inverse
    // of the mesh's bind (skinned vertices are expressed there before modelMatrix).
    for (const s of setups) {
      inv.copy(s.mesh.matrixWorld).invert();
      s.caps.forEach((c, i) => {
        pa.setFromMatrixPosition(c.a.matrixWorld).applyMatrix4(inv);
        pb.setFromMatrixPosition(c.b.matrixWorld).applyMatrix4(inv);
        const s0 = pa.clone().lerp(pb, c.from), s1 = pb.clone().add(pb.clone().sub(pa).multiplyScalar(c.extend));
        s0.toArray(s.A, i * 4); s.A[i * 4 + 3] = c.r;
        s1.toArray(s.B, i * 4);
      });
    }
  };
}
