import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { shared } from '../materials';
import { noiseGLSL, atmosGLSL } from '../shaders';

// Bodies and their motion.
//
// Two realistically proportioned rigged bodies (a bearded man, a woman) share
// Mixamo's bone naming. Their animations come from Quaternius' Universal
// Animation Library, made for the Unreal mannequin skeleton: different bone
// names, rest pose, proportions and axes. Clips are retargeted by world-space
// rotation deltas from a common reference pose: the source in its T-pose,
// the target in its own bind pose with each bone swung, without twist, to
// point the way the source's does. (Taking the target's T-pose from another
// rig's local rotations twists any bone whose axes differ: the Ready Player
// Me man's legs came out turned 180 degrees and his arms 90.) Every frame
// each target bone gets the source bone's world rotation relative to that
// reference, so twist and swing both carry over. The pelvis's path is scaled
// by the ratio of hip heights, then raised or lowered so the soles stand on
// the ground as the source's do.

export type ClipName = 'walk' | 'walkFormal' | 'idle' | 'talk' | 'bless' | 'kneel' | 'pickup' | 'interact';
export const CLIP_SRC: Record<ClipName, string> = {
  walk: 'Walk_Loop', walkFormal: 'Walk_Formal_Loop', idle: 'Idle_Loop', talk: 'Idle_Talking_Loop',
  bless: 'Spell_Simple_Idle_Loop', kneel: 'Fixing_Kneeling', pickup: 'PickUp_Table', interact: 'Interact',
};
const LOOPS = new Set<ClipName>(['walk', 'walkFormal', 'idle', 'talk', 'bless', 'kneel']);

/** Strip the "mixamorig" prefix so both bodies use the same bone names. */
export const canon = (n: string) => n.replace(/^mixamorig:?/, '');

// Mixamo bone → Unreal-mannequin bone.
const UAL: Record<string, string> = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head' };
// Which bone each bone points at, to match directions in the reference pose.
const AIM: Record<string, string> = { Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head' };
for (const [S, s] of [['Left', 'l'], ['Right', 'r']]) {
  Object.assign(UAL, {
    [S + 'Shoulder']: 'clavicle_' + s, [S + 'Arm']: 'upperarm_' + s, [S + 'ForeArm']: 'lowerarm_' + s, [S + 'Hand']: 'hand_' + s,
    [S + 'UpLeg']: 'thigh_' + s, [S + 'Leg']: 'calf_' + s, [S + 'Foot']: 'foot_' + s, [S + 'ToeBase']: 'ball_' + s,
  });
  Object.assign(AIM, {
    [S + 'Shoulder']: S + 'Arm', [S + 'Arm']: S + 'ForeArm', [S + 'ForeArm']: S + 'Hand', [S + 'Hand']: S + 'HandMiddle1',
    [S + 'UpLeg']: S + 'Leg', [S + 'Leg']: S + 'Foot', [S + 'Foot']: S + 'ToeBase',
  });
  for (const [F, f] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Pinky', 'pinky']]) {
    for (let k = 1; k <= 3; k++) {
      UAL[`${S}Hand${F}${k}`] = `${f}_0${k}_${s}`;
      if (k < 3) AIM[`${S}Hand${F}${k}`] = `${S}Hand${F}${k + 1}`;
    }
  }
}

export interface Motion {
  clips: Record<ClipName, THREE.AnimationClip>;
  /** Ground speed of the walk clips at timeScale 1, in the body's units (m). */
  speed: { walk: number; walkFormal: number };
  /** Where to start the walks from standing (s into the clip): the left foot planted under the body, the right one passing it. */
  start: { walk: number; walkFormal: number };
}

export function retarget(template: THREE.Object3D, ual: GLTF): Motion {
  const tgt = SkeletonUtils.clone(template);
  tgt.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  tgt.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  const byCanon = new Map(bones.map((b) => [canon(b.name), b]));
  const src = ual.scene;
  const sBy = new Map<string, THREE.Object3D>();
  src.traverse((o) => sBy.set(o.name, o));
  const mapped = bones.filter((b) => UAL[canon(b.name)] && sBy.has(UAL[canon(b.name)]));
  const isMapped = new Set(mapped);
  const sOf = (b: THREE.Bone) => sBy.get(UAL[canon(b.name)])!;
  const hips = byCanon.get('Hips')!;
  const sHips = sOf(hips);

  // Target rest (bind) pose.
  const restLocal = new Map(bones.map((b) => [b, b.quaternion.clone()]));
  const staticW = new Map<THREE.Object3D, THREE.Quaternion>(); // world rotations of non-bone ancestors
  for (const b of bones) if (!(b.parent as THREE.Bone).isBone) staticW.set(b.parent!, b.parent!.getWorldQuaternion(new THREE.Quaternion()));
  const hipsRest = hips.getWorldPosition(new THREE.Vector3());
  const hipsParentInv = hips.parent!.matrixWorld.clone().invert();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const facing = (l: THREE.Object3D, r: THREE.Object3D) => {
    const L = l.getWorldPosition(v1).sub(r.getWorldPosition(v2)).setY(0);
    return new THREE.Vector3().crossVectors(L, up).normalize();
  };
  const fT = facing(byCanon.get('LeftUpLeg')!, byCanon.get('RightUpLeg')!);
  // Soles: heel, ball and toe tip of each foot, dropped to the ground in the
  // reference pose and carried by the foot bones. The lowest of them is how
  // high above the ground the body stands.
  const soles = (chains: THREE.Object3D[][]) => chains.flatMap(([foot, toe, end]) => [[foot, foot], [foot, toe], [toe, end]].map(([o, j]) => {
    o.updateWorldMatrix(true, false);
    return { o, p: o.worldToLocal(j.getWorldPosition(new THREE.Vector3()).setY(0)) };
  }));
  let lowI = 0;
  const lowest = (sole: { o: THREE.Object3D; p: THREE.Vector3 }[]) => {
    let m = Infinity;
    sole.forEach((s, i) => { const y = v1.copy(s.p).applyMatrix4(s.o.matrixWorld).y; if (y < m) { m = y; lowI = i; } });
    return m;
  };
  const solePt = (sole: { o: THREE.Object3D; p: THREE.Vector3 }[], i: number, out: THREE.Vector3) => out.copy(sole[i].p).applyMatrix4(sole[i].o.matrixWorld);
  // The target's soles come from its shoes: the lowest vertices of each foot
  // at the heel, the toe tip and both sides of the ball, and the front of the
  // toe cap and back of the heel, each carried rigidly
  // by the bone that moves it most (shoes reach past the toe joint).
  const tSole: { o: THREE.Object3D; p: THREE.Vector3; foot: number }[] = [];
  {
    const cand = new Map<THREE.Bone, { b: THREE.Bone; w: THREE.Vector3 }[]>();
    const feet = ['Left', 'Right'].map((S) => byCanon.get(S + 'Foot')!);
    const footOf = (b: THREE.Bone) => feet.find((f) => f === b || f.children.includes(b) || b.parent?.parent === f);
    const w = new THREE.Vector3();
    let minY = Infinity;
    tgt.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let bi = 0, bw = -1;
        for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); bi = si.getComponent(i, k); }
        const b = m.skeleton.bones[bi], f = b && footOf(b);
        if (!f) continue;
        m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
        minY = Math.min(minY, w.y);
        if (!cand.has(f)) cand.set(f, []);
        cand.get(f)!.push({ b, w: w.clone() });
      }
    });
    const side = new THREE.Vector3().crossVectors(up, fT);
    for (const [foot, list] of cand) {
      const low = list.filter((c) => c.w.y < minY + 0.012);
      const by = (k: (c: { w: THREE.Vector3 }) => number) => low.reduce((a, c) => (k(c) > k(a) ? c : a));
      const toe = by((c) => c.w.dot(fT)), heel = by((c) => -c.w.dot(fT));
      const mid = (toe.w.dot(fT) * 0.6 + heel.w.dot(fT) * 0.4);
      const ball = low.filter((c) => Math.abs(c.w.dot(fT) - mid) < 0.03);
      // The rounded toe cap and heel counter touch first when the foot tips.
      const shoe = list.filter((c) => c.w.y < minY + 0.05);
      const cap = shoe.reduce((a, c) => (c.w.dot(fT) > a.w.dot(fT) ? c : a)), back = shoe.reduce((a, c) => (c.w.dot(fT) < a.w.dot(fT) ? c : a));
      const pts = [toe, heel, cap, back];
      if (ball.length) pts.push(ball.reduce((a, c) => (c.w.dot(side) > a.w.dot(side) ? c : a)), ball.reduce((a, c) => (c.w.dot(side) < a.w.dot(side) ? c : a)));
      for (const c of pts) tSole.push({ o: c.b, p: c.b.worldToLocal(c.w.clone()), foot: feet.indexOf(foot) });
    }
  }

  // Source reference: its T-pose.
  const mixer = new THREE.AnimationMixer(src);
  const clipBy = (n: string) => ual.animations.find((c) => c.name === n)!;
  mixer.clipAction(clipBy('A_TPose')).play();
  mixer.setTime(0);
  src.updateMatrixWorld(true);
  const fS = facing(sBy.get('thigh_l')!, sBy.get('thigh_r')!);
  const sSole = soles(['l', 'r'].map((x) => ['foot_', 'ball_', 'ball_leaf_'].map((n) => sBy.get(n + x)!)));
  const A = new THREE.Quaternion().setFromUnitVectors(fS, fT), Ai = A.clone().invert();
  const RsInv = new Map(mapped.map((b) => [b, sOf(b).getWorldQuaternion(new THREE.Quaternion()).invert()]));
  const sDir = (b: THREE.Bone, c: THREE.Bone) => sOf(c).getWorldPosition(v1).sub(sOf(b).getWorldPosition(v2)).applyQuaternion(A).normalize();
  const srcDirs = new Map<THREE.Bone, THREE.Vector3>();
  for (const b of mapped) { const c = byCanon.get(AIM[canon(b.name)]); if (c && isMapped.has(c)) srcDirs.set(b, sDir(b, c).clone()); }
  const Ps0 = sHips.getWorldPosition(new THREE.Vector3());
  const ratio = hipsRest.y / Ps0.y;

  // Target reference: its bind pose, every bone swung without twist to
  // point the way the source's bone points in its T-pose. Bones that aim at
  // nothing (finger tips) swing with their parent; hips and head stay as
  // bound, upright and facing forward like the source's.
  const swing = new Map<THREE.Bone, THREE.Quaternion>();
  const Rt = new Map<THREE.Bone, THREE.Quaternion>();
  for (const b of mapped) {
    const d = srcDirs.get(b), n = canon(b.name);
    let s: THREE.Quaternion;
    if (d) s = new THREE.Quaternion().setFromUnitVectors(byCanon.get(AIM[n])!.getWorldPosition(v1).sub(b.getWorldPosition(v2)).normalize(), d);
    else if (n === 'Hips' || n === 'Head') s = new THREE.Quaternion();
    else s = (swing.get(b.parent as THREE.Bone) ?? new THREE.Quaternion()).clone();
    swing.set(b, s);
    Rt.set(b, s.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())));
  }

  // Planted feet. The walks are hand-keyed in place, and a foot on the
  // ground does not pass back under the body at a steady rate: it lands
  // still moving forward and creeps as the heel rolls up. Walking the body
  // at the clip's ground speed, such a foot skates. So, per foot, wherever
  // its sole is on the ground, the slip of its contact point is measured
  // against the ground speed and taken out by bending the leg (two-bone IK,
  // the foot keeping its orientation); the correction fades out as the foot
  // lifts, and a foot left hovering by the other's longer stride is set
  // down. Returns the ground speed (m/s at timeScale 1).
  const legs = ['Left', 'Right'].map((S) => [S + 'UpLeg', S + 'Leg', S + 'Foot'].map((n) => byCanon.get(n)!));
  const sideOf = [0, 1].map((k) => tSole.map((s, i) => (s.foot === k ? i : -1)).filter((i) => i >= 0));
  const plantFeet = (frames: number, dt: number, rot: Map<THREE.Bone, Float32Array>, hp: Float32Array, sLow: Float32Array, pose: (f: number) => void) => {
    const N = frames - 1; // the last frame repeats the first
    // Contact points (lowest sole point per foot) and every sole point, per frame.
    const pts: THREE.Vector3[][] = [], low: { i: number; y: number }[][] = [];
    for (let f = 0; f < N; f++) {
      pose(f);
      pts.push(tSole.map((_, i) => solePt(tSole, i, new THREE.Vector3())));
      low.push(sideOf.map((ix) => ix.reduce((a, i) => (pts[f][i].y < a.y ? { i, y: pts[f][i].y } : a), { i: -1, y: Infinity })));
    }
    // Planted: while the source's foot is on its ground.
    const wAt = (f: number, k: number) => THREE.MathUtils.smoothstep(0.035 - sLow[(f % N) * 2 + k], 0, 0.02);
    // Ground speed: median backward speed of a contact point flat on the ground.
    const vs: number[] = [];
    for (let f = 0; f < N; f++) for (const k of [0, 1]) {
      const l = low[f][k], g = (f + 1) % N;
      if (l.y < 0.006 && pts[g][l.i].y < 0.006) vs.push(-(pts[g][l.i].clone().sub(pts[f][l.i]).dot(fT)) / dt);
    }
    vs.sort((a, b) => a - b);
    const v = vs.length ? vs[vs.length >> 1] : 0;
    // Offsets, run over two cycles so the loop closes.
    const off = [0, 1].map(() => Array.from({ length: N }, () => new THREE.Vector3()));
    for (const k of [0, 1]) {
      const o = new THREE.Vector3();
      for (let n = 1; n < N * 2 + 1; n++) {
        const f = n % N, p = (n - 1) % N, i = low[p][k].i;
        // The grip on the ground lets go a few frames after the source's foot
        // starts to rise, while the target's longer toes still touch.
        const w = Math.max(...[0, 1, 2, 3, 4].map((j) => wAt(f + N - j, k) * (1 - j * 0.15)));
        o.sub(pts[f][i]).add(pts[p][i]).addScaledVector(fT, -v * dt).setY(0).multiplyScalar(w);
        if (n > N) off[k][f].copy(o);
      }
    }
    // A planted foot is also set down on the ground; when the leg cannot
    // reach (the target's legs are shorter for the stride), the pelvis is
    // lowered a little.
    const a = new THREE.Vector3(), lowOf = (k: number) => Math.min(...sideOf[k].map((i) => solePt(tSole, i, a).y));
    const ik = (f: number) => {
      const F = f % N;
      pose(f);
      const y = [0, 1].map(lowOf);
      let miss = 0;
      for (const k of [0, 1]) {
        // Planted: on the ground. Swinging: at least as high as the source's
        // foot (the shorter-legged target would scuff its toes).
        const w = wAt(F, k), dy = -y[k] * w + Math.max(0, sLow[F * 2 + k] - y[k]) * (1 - w);
        if (w <= 0 && dy <= 0) continue;
        const T = legs[k][2].getWorldPosition(a).add(off[k][F]).setY(a.y + dy).clone();
        legIK(legs[k], T, fT);
        miss = Math.max(miss, legs[k][2].getWorldPosition(a).distanceTo(T) * Math.max(0, w * 2 - 1));
      }
      return miss;
    };
    // How far each planted foot is left short of where it should be, smoothed over
    // a few frames so the pelvis dips without jerks.
    const short = Array.from({ length: N }, (_, f) => ik(f));
    const dip = short.map((_, f) => Math.max(...[-3, -2, -1, 0, 1, 2, 3].map((j) => short[(f + j + N) % N])));
    const sm = dip.map((_, f) => [-4, -3, -2, -1, 0, 1, 2, 3, 4].reduce((acc, j) => acc + dip[(f + j + N) % N] * (5 - Math.abs(j)), 0) / 25);
    for (let f = 0; f < frames; f++) {
      hp[f * 3 + 1] -= Math.min(0.025, sm[f % N] * 1.2);
      ik(f);
      for (const b of legs.flat()) b.quaternion.toArray(rot.get(b)!, f * 4);
    }
    // Starting phase: left foot planted under the hips, right foot off the ground.
    let best = 0, bd = Infinity;
    for (let f = 0; f < N; f++) {
      if (wAt(f, 0) < 1 || wAt(f, 1) > 0.2) continue;
      pose(f);
      const dz = Math.abs(legs[0][2].getWorldPosition(a).sub(hips.getWorldPosition(v2)).dot(fT));
      if (dz < bd) { bd = dz; best = f; }
    }
    return { v, start: best * dt };
  };
  const W = new Map<THREE.Object3D, THREE.Quaternion>(bones.map((b) => [b, new THREE.Quaternion()]));
  const q = new THREE.Quaternion(), qi = new THREE.Quaternion();
  const bake = (name: ClipName) => {
    const clip = clipBy(CLIP_SRC[name]);
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().play();
    const fps = 30, frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const rot = new Map(mapped.map((b) => [b, new Float32Array(frames * 4)]));
    const hp = new Float32Array(frames * 3);
    const clear = new Float32Array(frames), sLow = new Float32Array(frames * 2);
    for (let f = 0; f < frames; f++) {
      const t = (f / (frames - 1)) * clip.duration;
      times[f] = t;
      mixer.setTime(t);
      src.updateMatrixWorld(true);
      for (const b of bones) {
        const pw = W.get(b.parent!) ?? staticW.get(b.parent!)!;
        const w = W.get(b)!;
        if (isMapped.has(b)) {
          sOf(b).getWorldQuaternion(q).multiply(RsInv.get(b)!);
          w.copy(A).multiply(q).multiply(Ai).multiply(Rt.get(b)!);
          qi.copy(pw).invert().multiply(w).toArray(rot.get(b)!, f * 4);
        } else w.copy(pw).multiply(restLocal.get(b)!);
      }
      const d = sHips.getWorldPosition(v1).sub(Ps0).applyQuaternion(A).multiplyScalar(ratio);
      d.toArray(hp, f * 3);
      clear[f] = Math.max(0, lowest(sSole) * ratio);
      for (const k of [0, 1]) sLow[f * 2 + k] = Math.min(...[0, 1, 2].map((j) => solePt(sSole, k * 3 + j, v2).y)) * ratio;
    }
    // Loops: walk in place and close the loop.
    if (LOOPS.has(name)) {
      const dx = hp[(frames - 1) * 3] - hp[0], dz = hp[(frames - 1) * 3 + 2] - hp[2];
      for (let f = 0; f < frames; f++) { const k = f / (frames - 1); hp[f * 3] -= dx * k; hp[f * 3 + 2] -= dz * k; }
    }
    // Pose the target and stand it on the ground: legs of other proportions
    // put the feet elsewhere than the scaled pelvis path expects, so the body
    // is raised or lowered until its lowest sole point is as high above the
    // ground as the source's. Then measure how fast the planted foot passes
    // back under the body: the clip's ground speed.
    const pose = (f: number) => {
      for (const b of mapped) b.quaternion.fromArray(rot.get(b)!, f * 4);
      hips.position.copy(v1.fromArray(hp, f * 3).add(hipsRest).applyMatrix4(hipsParentInv));
      tgt.updateMatrixWorld(true);
    };
    const ground = () => {
      for (let f = 0; f < frames; f++) {
        pose(f);
        hp[f * 3 + 1] += clear[f] - lowest(tSole);
      }
    };
    // The source carries itself low: standing, it lunges on bent knees, one
    // foot well ahead; walking, it steps high on deeply bent knees. On these
    // bodies that reads as a crouch, so the legs are eased towards straight
    // (thighs and knees part of the way back to the bind pose).
    const stand = name === 'idle' || name === 'talk' || name === 'bless';
    const ease = stand ? 0.45 : 0;
    const footQ: THREE.Quaternion[][] = [];
    if (stand) for (let f = 0; f < frames; f++) { pose(f); footQ.push(legs.map((L) => L[2].getWorldQuaternion(new THREE.Quaternion()))); }
    if (ease) for (let f = 0; f < frames; f++) for (const L of legs) for (const b of [L[0], L[1]]) {
      q.fromArray(rot.get(b)!, f * 4).slerp(restLocal.get(b)!, ease).toArray(rot.get(b)!, f * 4);
    }
    ground();
    if (stand) {
      // Standing feet stay put, flat as the source's, where they stand on average.
      const mean = [0, 1].map(() => new THREE.Vector3());
      for (let f = 0; f < frames; f++) { pose(f); legs.forEach((L, k) => mean[k].add(L[2].getWorldPosition(v1).divideScalar(frames))); }
      for (let f = 0; f < frames; f++) {
        pose(f);
        legs.forEach((L, k) => {
          legIK(L, mean[k], fT);
          L[2].parent!.getWorldQuaternion(qi).invert();
          L[2].quaternion.copy(qi.multiply(footQ[f][k]));
          L[2].updateMatrixWorld(true);
          for (const b of L) b.quaternion.toArray(rot.get(b)!, f * 4);
        });
      }
      ground();
    }
    let speed = 0, start = 0;
    if (name === 'walk' || name === 'walkFormal') ({ v: speed, start } = plantFeet(frames, clip.duration / (frames - 1), rot, hp, sLow, pose));
    for (let f = 0; f < frames; f++) {
      v1.fromArray(hp, f * 3).add(hipsRest).applyMatrix4(hipsParentInv).toArray(hp, f * 3);
    }
    const tracks: THREE.KeyframeTrack[] = mapped.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, rot.get(b)!));
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, hp));
    return { clip: new THREE.AnimationClip(name, clip.duration, tracks), speed, start };
  };
  const clips = {} as Record<ClipName, THREE.AnimationClip>;
  const speed = { walk: 1.2, walkFormal: 1 }, start = { walk: 0, walkFormal: 0 };
  for (const n of Object.keys(CLIP_SRC) as ClipName[]) {
    const r = bake(n);
    clips[n] = r.clip;
    if (n === 'walk' || n === 'walkFormal') { speed[n] = r.speed; start[n] = r.start; }
  }
  mixer.stopAllAction();
  return { clips, speed, start };
}

// Two-bone IK for a leg: put the ankle at T, the knee bending the way it did
// (or towards `fwd` if the leg was straight), the foot keeping its world
// rotation. Used when baking the walks and, at run time, on uneven ground.
const ik = { A: new THREE.Vector3(), B: new THREE.Vector3(), C: new THREE.Vector3(), B1: new THREE.Vector3(), B2: new THREE.Vector3(), C2: new THREE.Vector3(), u: new THREE.Vector3(), c: new THREE.Vector3(), pole: new THREE.Vector3(), d1: new THREE.Vector3(), d2: new THREE.Vector3(), fq: new THREE.Quaternion(), q: new THREE.Quaternion(), qi: new THREE.Quaternion() };
export function legIK([up, kn, ft]: THREE.Object3D[], T: THREE.Vector3, fwd: THREE.Vector3) {
  const { A, B, C, B1, B2, C2, u, c, pole, d1, d2, fq, q, qi } = ik;
  up.getWorldPosition(A); kn.getWorldPosition(B); ft.getWorldPosition(C);
  ft.getWorldQuaternion(fq);
  const la = A.distanceTo(B), lb = B.distanceTo(C);
  const d = THREE.MathUtils.clamp(A.distanceTo(T), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  u.copy(T).sub(A).normalize(); c.copy(C).sub(A).normalize();
  pole.copy(B).sub(A);
  pole.addScaledVector(c, -pole.dot(c)).addScaledVector(u, -pole.dot(u));
  if (pole.lengthSq() < 1e-10) pole.copy(fwd).addScaledVector(u, -fwd.dot(u));
  pole.normalize();
  const ca = (la * la + d * d - lb * lb) / (2 * la * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  B2.copy(A).addScaledVector(u, la * ca).addScaledVector(pole, la * sa);
  C2.copy(A).addScaledVector(u, d);
  const setW = (b: THREE.Object3D, w: THREE.Quaternion) => { b.parent!.getWorldQuaternion(qi).invert(); b.quaternion.copy(qi.multiply(w)); b.updateMatrixWorld(true); };
  setW(up, q.setFromUnitVectors(d1.copy(B).sub(A).normalize(), d2.copy(B2).sub(A).normalize()).multiply(up.getWorldQuaternion(qi)));
  kn.getWorldPosition(B1); ft.getWorldPosition(C);
  setW(kn, q.setFromUnitVectors(d1.copy(C).sub(B1).normalize(), d2.copy(C2).sub(B1).normalize()).multiply(kn.getWorldQuaternion(qi)));
  setW(ft, fq);
}

/**
 * Lower a T-posed body's arms and make that the new bind pose (the meshes
 * are re-skinned into it and the bone inverses recomputed), so garments
 * can be fitted round arms hanging at the sides.
 */
export function relaxArms(root: THREE.Object3D, angle: number) {
  root.updateMatrixWorld(true);
  const find = (n: string) => { let b: THREE.Object3D | undefined; root.traverse((o) => { if (!b && (o as THREE.Bone).isBone && canon(o.name) === n) b = o; }); return b!; };
  const P = new THREE.Quaternion(), R = new THREE.Quaternion();
  for (const [side, sgn] of [['Left', -1], ['Right', 1]] as const) {
    const b = find(side + 'Arm');
    b.parent!.getWorldQuaternion(P);
    R.setFromAxisAngle(new THREE.Vector3(0, 0, 1), sgn * angle);
    b.quaternion.premultiply(P).premultiply(R).premultiply(P.invert());
  }
  root.updateMatrixWorld(true);
  const skeletons = new Set<THREE.Skeleton>();
  const M = new THREE.Matrix4(), B = new THREE.Matrix4(), N3 = new THREE.Matrix3(), v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.skeleton.update();
    skeletons.add(m.skeleton);
    const g = m.geometry, pos = g.attributes.position, nrm = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const bm = m.skeleton.boneMatrices!;
    for (let i = 0; i < pos.count; i++) {
      const e = M.elements;
      e.fill(0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (!w) continue;
        const o16 = si.getComponent(i, k) * 16;
        for (let j = 0; j < 16; j++) e[j] += bm[o16 + j] * w;
      }
      // Exactly how three renders it: world = M · bindMatrix · v.
      B.copy(m.bindMatrix).invert().multiply(M).multiply(m.bindMatrix);
      pos.setXYZ(i, ...v.fromBufferAttribute(pos, i).applyMatrix4(B).toArray());
      if (nrm) nrm.setXYZ(i, ...v.fromBufferAttribute(nrm, i).applyMatrix3(N3.setFromMatrix4(B)).normalize().toArray());
    }
    pos.needsUpdate = true;
    if (nrm) nrm.needsUpdate = true;
  });
  for (const s of skeletons) s.calculateInverses();
}

// ------------------------------------------------------------------ materials

/**
 * Run a material through the game's fog and lamp in-scattering. Skin gets a
 * soft wrap-around diffuse term so faces don't look like plastic; hose can
 * get fasciae, linen bands wound from ankle to knee.
 */
export function withAtmos<M extends THREE.Material>(m: M, o: { skin?: boolean; wraps?: { knee: number; ankle: number; color: THREE.Color } } = {}): M {
  const w = o.wraps;
  const uWrap = w ? { value: w.color } : null;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    if (uWrap) sh.uniforms.uWrap = uWrap;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;' + (w ? '\nvarying vec3 vBind;' : ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;' + (w ? '\nvBind = position;' : ''));
    let fs = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${w ? 'varying vec3 vBind;\nuniform vec3 uWrap;' : ''}\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPos);');
    if (o.skin) fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.06, 0.025, 0.018);');
    if (w) {
      // Strips about 6 cm wide wound in a spiral; each turn overlaps the last.
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float inWrap = smoothstep(${(w.knee + 0.02).toFixed(3)}, ${(w.knee - 0.02).toFixed(3)}, vBind.y) * smoothstep(${(w.ankle - 0.02).toFixed(3)}, ${(w.ankle + 0.02).toFixed(3)}, vBind.y);
          float side = vBind.x > 0.0 ? 1.0 : -1.0;
          float ph = vBind.y * 17.0 + side * vBind.z * 5.0 + vBind.x * 3.0;
          float edge = smoothstep(0.0, 0.18, fract(ph)) * (0.75 + 0.25 * smoothstep(0.5, 1.0, fract(ph)));
          vec3 wrapCol = uWrap * (0.62 + 0.38 * edge) * (0.9 + 0.2 * vnoise(vBind * 60.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, wrapCol, inWrap);
        }`);
    }
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => (o.skin ? 'npc-skin' : w ? `npc-wrap${w.knee.toFixed(2)}` : 'npc-atmos');
  return m;
}

export function makeWeave() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const h = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    // Diagonal twill ribs plus slubby, uneven homespun yarn.
    const rib = Math.sin(((x + y) / s) * Math.PI * 2 * 16) * 0.5 + 0.5;
    const yarn = Math.sin((x / s) * Math.PI * 2 * 32) * Math.sin((y / s) * Math.PI * 2 * 7 + x * 0.05) * 0.25;
    h[y * s + x] = rib * 0.8 + yarn + Math.random() * 0.18;
  }
  const img = g.createImageData(s, s);
  const n = new THREE.Vector3();
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const H = (xx: number, yy: number) => h[((yy + s) % s) * s + ((xx + s) % s)];
    n.set(-(H(x + 1, y) - H(x - 1, y)) * 1.5, -(H(x, y + 1) - H(x, y - 1)) * 1.5, 1).normalize();
    const k = (y * s + x) * 4;
    img.data[k] = (n.x * 0.5 + 0.5) * 255; img.data[k + 1] = (n.y * 0.5 + 0.5) * 255; img.data[k + 2] = (n.z * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function wool(color: THREE.ColorRepresentation, weave: THREE.Texture, o: { sheen?: number; linen?: boolean } = {}) {
  const c = new THREE.Color(color);
  return withAtmos(new THREE.MeshPhysicalMaterial({
    color: c, roughness: o.linen ? 0.9 : 0.97, metalness: 0, sheen: o.linen ? 0.4 : 1,
    sheenColor: c.clone().lerp(new THREE.Color(0xb0a090), 0.35).multiplyScalar(o.sheen ?? 1.4), sheenRoughness: 0.75,
    normalMap: weave, normalScale: new THREE.Vector2(o.linen ? 0.12 : 0.28, o.linen ? 0.12 : 0.28), side: THREE.DoubleSide, vertexColors: true,
  }));
}

export const matte = (color: THREE.ColorRepresentation, roughness = 0.9, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  withAtmos(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
