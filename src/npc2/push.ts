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

export const MAX_CAPS = 16;
const MARGIN = 0.008;

interface CapDef { a: string; b: string; from?: number; extend?: number; bones: string[]; /** Quantile of the inner layers' distances taken as the radius (default: all of them). */ q?: number; /** Keep each cloth point on its own side of the limb, see SIDE. */ side?: boolean; /** Offsets (bind space, m) of the ends from the bones: a capsule across the trunk. */ ao?: [number, number, number]; bo?: [number, number, number]; /** Cloth skinned mostly (> half) to these bones is left alone by this capsule: a sleeve's own cuff by the hand's. */ own?: string[] }
interface Cap { a: THREE.Bone; b: THREE.Bone; from: number; extend: number; r: number; r1: number; side: boolean; own: number[]; /** Ends as points in the bones' own frames (offset capsules), else the bone origins. */ la?: THREE.Vector3; lb?: THREE.Vector3 }

// Which limbs each layer of garment is kept off.
const LEGS: CapDef[] = [
  { a: 'LeftUpLeg', b: 'LeftLeg', from: 0.35, bones: ['LeftUpLeg'], side: true }, { a: 'RightUpLeg', b: 'RightLeg', from: 0.35, bones: ['RightUpLeg'], side: true },
  { a: 'LeftLeg', b: 'LeftFoot', bones: ['LeftLeg'], side: true }, { a: 'RightLeg', b: 'RightFoot', bones: ['RightLeg'], side: true },
  { a: 'LeftFoot', b: 'LeftToeBase', extend: 0.6, bones: ['LeftFoot', 'LeftToeBase'] }, { a: 'RightFoot', b: 'RightToeBase', extend: 0.6, bones: ['RightFoot', 'RightToeBase'] },
];
// The hand's capsule must hold the closed fingers too (their bones count for its radius).
const fingers = (s: string) => ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((k) => `${s}Hand${f}${k}`));
const HANDS: CapDef[] = [
  { a: 'LeftHand', b: 'LeftHandMiddle1', extend: 0.7, bones: ['LeftHand', ...fingers('Left')], side: true, own: ['LeftForeArm', 'LeftHand'] }, { a: 'RightHand', b: 'RightHandMiddle1', extend: 0.7, bones: ['RightHand', ...fingers('Right')], side: true, own: ['RightForeArm', 'RightHand'] },
];
const ARMS: CapDef[] = [
  { a: 'LeftForeArm', b: 'LeftHand', bones: ['LeftForeArm'], side: true }, { a: 'RightForeArm', b: 'RightHand', bones: ['RightForeArm'], side: true },
  { a: 'LeftArm', b: 'LeftForeArm', from: 0.25, bones: ['LeftArm'], side: true }, { a: 'RightArm', b: 'RightForeArm', from: 0.25, bones: ['RightArm'], side: true },
];
const SHOULDERS: CapDef[] = [
  { a: 'LeftShoulder', b: 'LeftArm', from: 0.45, bones: ['LeftShoulder', 'LeftArm'], q: 0.97, side: true }, { a: 'RightShoulder', b: 'RightArm', from: 0.45, bones: ['RightShoulder', 'RightArm'], q: 0.97, side: true },
];
const UPPER: CapDef[] = [
  { a: 'LeftArm', b: 'LeftForeArm', bones: ['LeftArm'], side: true }, { a: 'RightArm', b: 'RightForeArm', bones: ['RightArm'], side: true },
];
// The trunk, as capsules lying across it (left to right) at the waist and
// the chest: their section in plan is a stadium, close to the trunk's own
// (wider than deep), where a capsule along the spine would be round. They
// keep a cloak or a hood's cape outside the cloth gathered by the belt, the
// belt itself and the chest beneath.
const TRUNK: CapDef[] = [
  { a: 'Spine', b: 'Spine', ao: [-0.09, 0, 0], bo: [0.09, 0, 0], bones: ['Hips', 'Spine'], q: 0.985, side: true },
  { a: 'Spine2', b: 'Spine2', ao: [-0.09, -0.02, 0], bo: [0.09, -0.02, 0], bones: ['Spine1', 'Spine2'], q: 0.985, side: true },
];
// Under a cloak: the skirt of the tunic or robe beneath, at the hips and
// across both thighs (riding on them), so it cannot swing out through the
// cloak's back and sides.
const SKIRT: CapDef[] = [
  { a: 'Hips', b: 'Hips', ao: [-0.09, -0.06, 0], bo: [0.09, -0.06, 0], bones: [], q: 0.985, side: true },
  { a: 'LeftUpLeg', b: 'RightUpLeg', ao: [0, -0.22, 0], bo: [0, -0.22, 0], bones: [], q: 0.985, side: true },
];
const BY_LAYER: Record<string, CapDef[]> = {
  // (Sleeves: the forearm only; round the upper arm the capsule would reach the chest's cloth.)
  tunic: [...LEGS, ...HANDS, ...ARMS.slice(0, 2)],
  over: [...SHOULDERS, ...ARMS, ...HANDS, ...LEGS.slice(0, 4), ...TRUNK, ...SKIRT],
  // A hood's shoulder cape over the tunic.
  head: [...SHOULDERS, ...UPPER, TRUNK[1]],
};

const GLSL_HEAD = `uniform vec4 uPushA[${MAX_CAPS}]; uniform vec4 uPushB[${MAX_CAPS}]; uniform float uPushR[${MAX_CAPS}]; uniform vec2 uPushX[${MAX_CAPS}];`;
// SIDE: a plain projection pushes a cloth point out of a capsule along the
// nearest way, so cloth that a striding leg (or a swinging arm under a cloak)
// has overtaken — the front of a skirt left behind the shin — is pushed
// further behind it and the limb shows through. The cloth's own side of the
// limb is known, though: where the point would be if it had moved rigidly
// with the limb's bone from the bind pose ("home": the bind position through
// that bone's skinning matrix). A point within the capsule's lateral radius,
// from SIDE_DEPTH radii on the wrong side of the axis up to the surface on
// its home side, is carried straight across to the surface on its home side
// (keeping its offset along and across the limb). This is the layered-cloth
// idea of keeping each cloth point on its bind-time side of the body
// (e.g. the "inside/outside" history used in cloth-body collision, Bridson,
// Fedkiw & Anderson, "Robust treatment of collisions, contact and friction
// for cloth animation", SIGGRAPH 2002), reduced to capsules.
// uPushB[i].w holds the capsule's bone index + 1 for SIDE capsules, else 0.
const SIDE_DEPTH = 5;
// Points just beside the capsule (up to SIDE_WIDE radii off its axis
// sideways) and behind it are brought forward to its side line too, so the
// cloth between a carried point and its neighbours does not cut the limb.
const SIDE_WIDE = 1.35;
// Only cloth that lay near the limb in the bind pose (home within SIDE_NEAR
// radii of its axis) has a side to keep: a point of the shirt's front, far
// from the forearm in the bind pose, would be carried round a forearm folded
// across the belly to wherever its rigid "home" happened to swing. Such
// points get the plain projection.
const SIDE_NEAR = 3;
const GLSL_BODY = `
  for (int i = 0; i < ${MAX_CAPS}; i++) {
    if (uPushA[i].w <= 0.0) continue;
    if (uPushX[i].x > 0.5) {
      float ow = 0.0;
      for (int k = 0; k < 4; k++) if (abs(skinIndex[k] - (uPushX[i].x - 1.0)) < 0.5 || abs(skinIndex[k] - (uPushX[i].y - 1.0)) < 0.5) ow += skinWeight[k];
      if (ow > 0.5) continue;
    }
    vec3 a = uPushA[i].xyz, ab = uPushB[i].xyz - a;
    float ab2 = max(dot(ab, ab), 1e-8);
    float t = clamp(dot(transformed - a, ab) / ab2, 0.0, 1.0);
    float r = mix(uPushA[i].w, uPushR[i], t);
    vec3 c = a + ab * t;
    vec3 d = transformed - c;
    if (uPushB[i].w > 0.5) {
      vec3 home = (bindMatrixInverse * getBoneMatrix(floor(uPushB[i].w - 0.5)) * bindMatrix * vec4(position, 1.0)).xyz;
      vec3 e = home - a - ab * (dot(home - a, ab) / ab2);
      float el = length(e);
      if (el > 1e-4 && el < ${SIDE_NEAR.toFixed(1)} * r) {
        e /= el;
        float de = dot(d, e);
        vec3 lat = d - e * de;
        float ll = length(lat);
        if (ll < ${SIDE_WIDE.toFixed(2)} * r && de > -${SIDE_DEPTH.toFixed(1)} * r) {
          float h = sqrt(max(r * r - ll * ll, 0.0));
          if (de < h) transformed = c + lat + e * h;
        }
        continue;
      }
    }
    float l = length(d);
    if (l < r && l > 1e-5) transformed += d * (r / l - 1.0);
  }`;

/** The same projection on the CPU, for the audit: p skinned, rest its bind position, both in the mesh's local space. */
function pushPoint(p: THREE.Vector3, rest: THREE.Vector3, A: Float32Array, B: Float32Array, R: Float32Array, X: Float32Array, own: (b: number) => number, M: THREE.Matrix4[]) {
  const home = new THREE.Vector3();
  for (let i = 0; i < MAX_CAPS; i++) {
    if (A[i * 4 + 3] <= 0) continue;
    if (X[i * 2] > 0.5 && own(X[i * 2] - 1) + (X[i * 2 + 1] > 0.5 ? own(X[i * 2 + 1] - 1) : 0) > 0.5) continue;
    const ax = A[i * 4], ay = A[i * 4 + 1], az = A[i * 4 + 2];
    const bx = B[i * 4] - ax, by = B[i * 4 + 1] - ay, bz = B[i * 4 + 2] - az, bb = Math.max(bx * bx + by * by + bz * bz, 1e-8);
    const t = Math.min(1, Math.max(0, ((p.x - ax) * bx + (p.y - ay) * by + (p.z - az) * bz) / bb));
    const r = A[i * 4 + 3] * (1 - t) + R[i] * t;
    const cx = ax + bx * t, cy = ay + by * t, cz = az + bz * t;
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    if (B[i * 4 + 3] > 0.5) {
      home.copy(rest).applyMatrix4(M[i]);
      const hx = home.x - ax, hy = home.y - ay, hz = home.z - az, k = (hx * bx + hy * by + hz * bz) / bb;
      let ex = hx - bx * k, ey = hy - by * k, ez = hz - bz * k;
      const el = Math.hypot(ex, ey, ez);
      if (el > 1e-4 && el < SIDE_NEAR * r) {
        ex /= el; ey /= el; ez /= el;
        const de = dx * ex + dy * ey + dz * ez;
        const lx = dx - ex * de, ly = dy - ey * de, lz = dz - ez * de, ll = Math.hypot(lx, ly, lz);
        if (ll < SIDE_WIDE * r && de > -SIDE_DEPTH * r) {
          const h = Math.sqrt(Math.max(r * r - ll * ll, 0));
          if (de < h) { p.x = cx + lx + ex * h; p.y = cy + ly + ey * h; p.z = cz + lz + ez * h; }
        }
        continue;
      }
    }
    const l = Math.hypot(dx, dy, dz);
    if (l < r && l > 1e-5) { const q = r / l - 1; p.x += dx * q; p.y += dy * q; p.z += dz * q; }
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
  const setups: { mesh: THREE.SkinnedMesh; caps: Cap[]; A: Float32Array; B: Float32Array; R: Float32Array; M: THREE.Matrix4[] }[] = [];
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
      if (d.ao) pa.add(new THREE.Vector3(...d.ao));
      if (d.bo) pb.add(new THREE.Vector3(...d.bo));
      const toLocal = (bn: THREE.Bone, p: THREE.Vector3) => p.clone().applyMatrix4(skel.boneInverses[skel.bones.indexOf(bn)]);
      const from = d.from ?? 0, extend = d.extend ?? 0;
      const s0 = pa.clone().lerp(pb, from), s1 = pb.clone().add(pb.clone().sub(pa).multiplyScalar(extend));
      seg.subVectors(s1, s0);
      const rs: number[] = [], ts: number[] = [];
      // A trunk capsule measures everything beneath it in a slab 5 cm either side of its axis, whatever the bone.
      const pts = d.ao ? [...inner.values()].flat().filter((p) => Math.abs(p.y - s0.y) < 0.05) : d.bones.flatMap((n) => { const bb = bone(n); return (bb && inner.get(bb)) ?? []; });
      {
        for (const p of pts) {
          const t = THREE.MathUtils.clamp(q.subVectors(p, s0).dot(seg) / seg.lengthSq(), 0, 1);
          // Only what lies along the capsule's own length (not round its rounded ends).
          if (t <= 0 || t >= 1) continue;
          rs.push(p.distanceTo(q.copy(s0).addScaledVector(seg, t))); ts.push(t);
        }
      }
      if (rs.length < 8) continue;
      // Tapered: a radius at each end (the wrist is narrower than the elbow,
      // the ankle than the calf), the larger of what lies in each half, then
      // both scaled until the line between them holds (the q quantile of) everything.
      let r0 = 0, r1 = 0;
      rs.forEach((x, k) => { if (ts[k] < 0.5) r0 = Math.max(r0, x); else r1 = Math.max(r1, x); });
      r0 ||= r1; r1 ||= r0;
      const need = rs.map((x, k) => x / (r0 * (1 - ts[k]) + r1 * ts[k])).sort((x, y) => x - y);
      const kq = Math.max(need[Math.floor((need.length - 1) * (d.q ?? 1))], d.q ? 0 : 1);
      caps.push({ a, b, from, extend, r: r0 * kq + MARGIN, r1: r1 * kq + MARGIN, own: (d.own ?? []).map((n) => skel.bones.indexOf(bone(n)!)).filter((k) => k >= 0).slice(0, 2), side: !!d.side, la: d.ao ? toLocal(a, pa) : undefined, lb: d.bo ? toLocal(b, pb) : undefined });
    }
    if (!caps.length) continue;
    const A = new Float32Array(MAX_CAPS * 4), B = new Float32Array(MAX_CAPS * 4), R = new Float32Array(MAX_CAPS), X = new Float32Array(MAX_CAPS * 2);
    const uA = { value: Array.from({ length: MAX_CAPS }, () => new THREE.Vector4()) }, uB = { value: Array.from({ length: MAX_CAPS }, () => new THREE.Vector4()) }, uR = { value: R }, uX = { value: Array.from({ length: MAX_CAPS }, () => new THREE.Vector2()) };
    const M = Array.from({ length: MAX_CAPS }, () => new THREE.Matrix4());
    const mat = m.material as THREE.Material;
    const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey();
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r);
      sh.uniforms.uPushA = uA; sh.uniforms.uPushB = uB; sh.uniforms.uPushR = uR; sh.uniforms.uPushX = uX;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${GLSL_HEAD}`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>${GLSL_BODY}`);
    };
    mat.customProgramCacheKey = () => key + '-push';
    m.onBeforeRender = () => {
      for (let i = 0; i < MAX_CAPS; i++) { uA.value[i].fromArray(A, i * 4); uB.value[i].fromArray(B, i * 4); uX.value[i].fromArray(X, i * 2); }
      (mat as THREE.Material & { uniformsNeedUpdate: boolean }).uniformsNeedUpdate = true;
    };
    caps.forEach((c, i) => c.own.forEach((k, j) => { X[i * 2 + j] = k + 1; }));
    const rest = new THREE.Vector3(), P = m.geometry.attributes.position, SJ = m.geometry.attributes.skinIndex, SW = m.geometry.attributes.skinWeight;
    m.userData.push = (p: THREE.Vector3, i: number) => {
      const own = (b: number) => { let w = 0; for (let k = 0; k < 4; k++) if (SJ.getComponent(i, k) === b) w += SW.getComponent(i, k); return w; };
      return pushPoint(p, rest.fromBufferAttribute(P, i), A, B, R, X, own, M);
    };
    m.userData.pushCaps = caps.map((c) => [c.a.name, c.b.name, +c.r.toFixed(3), +c.r1.toFixed(3)]);
    setups.push({ mesh: m, caps, A, B, R, M });
  }
  if (!setups.length) return null;
  const _m = new THREE.Matrix4();
  const inv = new THREE.Matrix4(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
  return () => {
    // Capsule ends in each mesh's bind space: world bone positions through the inverse
    // of the mesh's bind (skinned vertices are expressed there before modelMatrix).
    for (const s of setups) {
      inv.copy(s.mesh.matrixWorld).invert();
      s.caps.forEach((c, i) => {
        (c.la ? pa.copy(c.la).applyMatrix4(c.a.matrixWorld) : pa.setFromMatrixPosition(c.a.matrixWorld)).applyMatrix4(inv);
        (c.lb ? pb.copy(c.lb).applyMatrix4(c.b.matrixWorld) : pb.setFromMatrixPosition(c.b.matrixWorld)).applyMatrix4(inv);
        const s0 = pa.clone().lerp(pb, c.from), s1 = pb.clone().add(pb.clone().sub(pa).multiplyScalar(c.extend));
        s0.toArray(s.A, i * 4); s.A[i * 4 + 3] = c.r; s.R[i] = c.r1;
        s1.toArray(s.B, i * 4);
        const k = s.mesh.skeleton.bones.indexOf(c.a);
        s.B[i * 4 + 3] = c.side && k >= 0 ? k + 1 : 0;
        // (For the audit's CPU copy: the bone's skinning matrix in the mesh's space.)
        if (c.side && k >= 0) s.M[i].multiplyMatrices(s.mesh.bindMatrixInverse, _m.multiplyMatrices(c.a.matrixWorld, s.mesh.skeleton.boneInverses[k])).multiply(s.mesh.bindMatrix);
      });
    }
  };
}
