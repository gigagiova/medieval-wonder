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
// rotation deltas from a common reference pose: both rigs are put in a T-pose
// whose bone directions are matched exactly, and every frame each target
// bone gets the source bone's world rotation relative to that reference.
// Twist and swing both carry over, and so does the pelvis's path, scaled by
// the ratio of hip heights.

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

/** First-frame local rotations of a T-pose clip, by canonical bone name. */
export function poseOf(clip: THREE.AnimationClip) {
  const m = new Map<string, THREE.Quaternion>();
  for (const t of clip.tracks) {
    const [node, prop] = t.name.split('.');
    if (prop === 'quaternion') m.set(canon(node), new THREE.Quaternion().fromArray(t.values as unknown as number[], 0));
  }
  return m;
}

export interface Motion {
  clips: Record<ClipName, THREE.AnimationClip>;
  /** Ground speed of the walk clips at timeScale 1, in the body's units (m). */
  speed: { walk: number; walkFormal: number };
}

export function retarget(template: THREE.Object3D, tpose: Map<string, THREE.Quaternion>, ual: GLTF): Motion {
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

  // Source reference: its T-pose.
  const mixer = new THREE.AnimationMixer(src);
  const clipBy = (n: string) => ual.animations.find((c) => c.name === n)!;
  mixer.clipAction(clipBy('A_TPose')).play();
  mixer.setTime(0);
  src.updateMatrixWorld(true);
  const fS = facing(sBy.get('thigh_l')!, sBy.get('thigh_r')!);
  const A = new THREE.Quaternion().setFromUnitVectors(fS, fT), Ai = A.clone().invert();
  const RsInv = new Map(mapped.map((b) => [b, sOf(b).getWorldQuaternion(new THREE.Quaternion()).invert()]));
  const sDir = (b: THREE.Bone, c: THREE.Bone) => sOf(c).getWorldPosition(v1).sub(sOf(b).getWorldPosition(v2)).applyQuaternion(A).normalize();
  const srcDirs = new Map<THREE.Bone, THREE.Vector3>();
  for (const b of mapped) { const c = byCanon.get(AIM[canon(b.name)]); if (c && isMapped.has(c)) srcDirs.set(b, sDir(b, c).clone()); }
  const Ps0 = sHips.getWorldPosition(new THREE.Vector3());
  const ratio = hipsRest.y / Ps0.y;

  // Target reference: its own T-pose, then bone directions matched exactly.
  for (const b of mapped) { const q = tpose.get(canon(b.name)); if (q && b !== hips) b.quaternion.copy(q); }
  tgt.updateMatrixWorld(true);
  const Rt = new Map(mapped.map((b) => [b, b.getWorldQuaternion(new THREE.Quaternion())]));
  for (const [b, d] of srcDirs) {
    const c = byCanon.get(AIM[canon(b.name)])!;
    const dt = c.getWorldPosition(v1).sub(b.getWorldPosition(v2)).normalize();
    Rt.get(b)!.premultiply(new THREE.Quaternion().setFromUnitVectors(dt, d));
  }

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
    let ground = 0;
    const lastFoot = [new THREE.Vector3(), new THREE.Vector3()];
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
      // Ground speed: how fast the lower foot slides back under the body.
      const feet = [sBy.get('foot_l')!.getWorldPosition(new THREE.Vector3()), sBy.get('foot_r')!.getWorldPosition(new THREE.Vector3())];
      if (f > 0) {
        const k = feet[0].y < feet[1].y ? 0 : 1;
        ground += Math.max(0, -feet[k].clone().sub(lastFoot[k]).applyQuaternion(A).dot(fT));
      }
      lastFoot[0].copy(feet[0]); lastFoot[1].copy(feet[1]);
    }
    // Loops: walk in place and close the loop.
    if (LOOPS.has(name)) {
      const dx = hp[(frames - 1) * 3] - hp[0], dz = hp[(frames - 1) * 3 + 2] - hp[2];
      for (let f = 0; f < frames; f++) { const k = f / (frames - 1); hp[f * 3] -= dx * k; hp[f * 3 + 2] -= dz * k; }
    }
    for (let f = 0; f < frames; f++) {
      v1.fromArray(hp, f * 3).add(hipsRest).applyMatrix4(hipsParentInv).toArray(hp, f * 3);
    }
    const tracks: THREE.KeyframeTrack[] = mapped.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, rot.get(b)!));
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, hp));
    return { clip: new THREE.AnimationClip(name, clip.duration, tracks), speed: (ground * ratio) / clip.duration };
  };
  const clips = {} as Record<ClipName, THREE.AnimationClip>;
  const speed = { walk: 1.2, walkFormal: 1 };
  for (const n of Object.keys(CLIP_SRC) as ClipName[]) {
    const r = bake(n);
    clips[n] = r.clip;
    if (n === 'walk' || n === 'walkFormal') speed[n] = r.speed;
  }
  mixer.stopAllAction();
  return { clips, speed };
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
