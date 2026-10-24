import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { shared } from './materials';
import { noiseGLSL, atmosGLSL } from './shaders';

// Benedictine monks, built the way game characters are dressed:
//
// 1. Base human: a rigged, realistically proportioned bearded man (the Ready
//    Player Me sample avatar shipped with the three.js examples), animated
//    with Mixamo walk / idle clips retargeted onto his skeleton.
// 2. Garment: a habit (tunic with wide sleeves), scapular, cowl with capelet
//    and a rope cingulum are generated around the body in its bind pose,
//    pushed out of the body with BVH closest-point queries, and given skin
//    weights transferred from the nearest body surface, so they follow every
//    joint. Body parts the habit covers are removed so nothing pokes through.
// 3. Cloth: every frame the garment is skinned on the CPU to get its animated
//    target shape; free parts (skirt, sleeve ends, cowl drape, scapular, rope
//    end) are then simulated with position-based dynamics: distance and bend
//    constraints, a max-distance tether to the skinned target that grows
//    towards the hem, gravity, inertia, and capsule collisions with the legs.

const BASE_URL = 'models/monk-base.glb';
const ANIM_URL = 'models/mixamo-anims.glb';
const SCALE = 0.92; // 1.87 m avatar → a 1.72 m monk
const WALK_SPEED = 1.3 * SCALE; // ground speed of the walk clip at timeScale 1

/** Dev switches (test page only). */
export const monkDebug = { sim: true, garment: true, undressed: false, prof: {} as Record<string, number>, ao: '' };

export interface Monk {
  group: THREE.Object3D;
  lanternWorldPos: THREE.Vector3;
  update(dt: number, pos: THREE.Vector3, facingYaw: number, speed: number): void;
}

interface Garment {
  geo: THREE.BufferGeometry; // bind-space positions, index, uv, color, groups
  bind: Float32Array; // bind-space positions (world-at-load)
  skinI: Uint16Array; // 4 bone indices per vertex
  skinW: Float32Array; // 4 weights per vertex
  maxD: Float32Array; // tether radius per vertex (0 = pinned)
  capMask: Uint8Array; // which collision capsules a vertex can touch (bit per capsule)
  edges: Uint32Array; // pairs
  rest: Float32Array;
  stiff: Float32Array;
  rope: { root: number; n: number; seg: number }; // the hanging rope end (simulated separately)
}

let template: THREE.Object3D | null = null;
let clips: { walk: THREE.AnimationClip; idle: THREE.AnimationClip } | null = null;
let garment: Garment | null = null;
let mats: { wool: THREE.Material[]; rope: THREE.Material } | null = null;

// ------------------------------------------------------------------ loading

export async function loadMonkAssets(): Promise<void> {
  if (template) return;
  const loader = new GLTFLoader();
  const [base, anim] = await Promise.all([loader.loadAsync(BASE_URL), loader.loadAsync(ANIM_URL)]);
  template = base.scene;
  template.updateMatrixWorld(true);
  clips = retargetClips(template, anim);
  dressBody(template);
  garment = buildGarment(template);
  bakeHeadShade(template, garment.geo);
  const weave = makeWeave();
  const habit = wool(0x1f1813, 0x4a3d33, weave);
  const scap = wool(0x19130f, 0x40342b, weave);
  mats = { wool: [habit, scap], rope: withAtmos(new THREE.MeshStandardMaterial({ color: 0x6e5c40, roughness: 0.95 })) };
}

// ------------------------------------------------------------------ retargeting

const MIXAMO = (n: string) => 'mixamorig' + n;
/** GLSL-style smoothstep that also accepts reversed edges. */
const ss = (e0: number, e1: number, x: number) => { const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/**
 * Bake Mixamo clips from the Soldier rig onto the avatar. Both rigs follow
 * Mixamo's bone naming and local-axis conventions, so local rotations carry
 * over as they are (the avatar's A-pose rest is just a pose). Only the hips
 * differ: the Soldier armature is Z-up at 1/100 scale, so the hips' rotation
 * and position are carried through world space, relative to each rig's rest.
 */
function retargetClips(target: THREE.Object3D, src: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }) {
  const tBones: THREE.Bone[] = [];
  target.traverse((o) => { if ((o as THREE.Bone).isBone) tBones.push(o as THREE.Bone); });
  const sByName = new Map<string, THREE.Object3D>();
  src.scene.traverse((o) => sByName.set(o.name, o));
  const mapped = tBones.filter((b) => sByName.has(MIXAMO(b.name)));
  const srcOf = (b: THREE.Bone) => sByName.get(MIXAMO(b.name))!;
  const hips = mapped.find((b) => b.name === 'Hips')!;
  src.scene.updateMatrixWorld(true);
  const sHips = srcOf(hips);
  const srcRestQ = sHips.getWorldQuaternion(new THREE.Quaternion());
  const srcRestP = sHips.getWorldPosition(new THREE.Vector3());
  const tgtRestQ = hips.getWorldQuaternion(new THREE.Quaternion());
  const tgtRestP = hips.getWorldPosition(new THREE.Vector3());
  const parQinv = hips.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  const posScale = tgtRestP.y / srcRestP.y;
  const mixer = new THREE.AnimationMixer(src.scene);
  const q = new THREE.Quaternion(), p = new THREE.Vector3();
  const bake = (clip: THREE.AnimationClip, name: string) => {
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().play();
    const fps = 30, frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const rot = new Map<THREE.Bone, Float32Array>(mapped.map((b) => [b, new Float32Array(frames * 4)]));
    const hipPos = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      const t = (f / (frames - 1)) * clip.duration;
      times[f] = t;
      mixer.setTime(t);
      src.scene.updateMatrixWorld(true);
      for (const b of mapped) {
        if (b === hips) {
          // World delta from the source rest, applied to the target rest.
          sHips.getWorldQuaternion(q).multiply(srcRestQ.clone().invert());
          q.multiply(tgtRestQ).premultiply(parQinv);
          q.toArray(rot.get(b)!, f * 4);
        } else srcOf(b).quaternion.toArray(rot.get(b)!, f * 4);
      }
      const d = sHips.getWorldPosition(p).sub(srcRestP).multiplyScalar(posScale);
      const local = hips.parent!.worldToLocal(tgtRestP.clone().add(d));
      local.toArray(hipPos, f * 3);
    }
    const tracks: THREE.KeyframeTrack[] = mapped.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, rot.get(b)!));
    // Bob and sway, but walk in place (forward drift removed).
    const x0 = hipPos[0], z0 = hipPos[2], hx = hips.position.x, hz = hips.position.z;
    for (let f = 0; f < frames; f++) { hipPos[f * 3] += hx - x0; hipPos[f * 3 + 2] += hz - z0; }
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipPos));
    return new THREE.AnimationClip(name, clip.duration, tracks);
  };
  const walk = bake(src.animations.find((c) => c.name === 'Walk')!, 'walk');
  const idle = bake(src.animations.find((c) => c.name === 'Idle')!, 'idle');
  mixer.stopAllAction();
  return { walk, idle };
}

// ------------------------------------------------------------------ body

const HANDS = /Hand|Thumb|Index|Middle|Ring|Pinky/;
const HEAD = /^(Head|HeadTop_End|LeftEye|RightEye|Neck)$/;
const ARMS = /Shoulder|Arm/;
const LEGS = /UpLeg|Leg|Foot|Toe/;

function boneClassOf(mesh: THREE.SkinnedMesh) {
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name);
  const cls: string[] = [];
  for (let i = 0; i < si.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    const n = names[best];
    cls.push(HANDS.test(n) ? 'hand' : HEAD.test(n) ? 'head' : ARMS.test(n) ? 'arm' : LEGS.test(n) ? 'leg' : 'torso');
  }
  return cls;
}

/** Strip the modern outfit, keep head, beard, hands and (re-dyed) shoes. */
function dressBody(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    m.castShadow = true;
    if (monkDebug.undressed) { m.material = withAtmos((m.material as THREE.Material).clone()); return; }
    if (/Outfit_Top|Headwear/.test(m.name)) { m.visible = false; return; }
    if (m.name === 'Wolf3D_Body') {
      // Only the hands and the neck stay; the habit covers everything else.
      const cls = boneClassOf(m);
      const idx = m.geometry.index!;
      const keep: number[] = [];
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
        const ok = (i: number) => cls[i] === 'hand' || cls[i] === 'head';
        if (ok(a) && ok(b) && ok(c)) keep.push(a, b, c);
      }
      m.geometry = m.geometry.clone();
      m.geometry.setIndex(keep);
    }
    const old = m.material as THREE.MeshStandardMaterial;
    let nm: THREE.MeshStandardMaterial;
    if (m.name === 'Wolf3D_Outfit_Footwear') {
      nm = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.88 });
    } else if (m.name === 'Wolf3D_Outfit_Bottom') {
      // Wool hose under the habit, seen only when a leg swings clear.
      nm = new THREE.MeshStandardMaterial({ color: 0x17120e, roughness: 0.97 });
    } else if (/Body|Head/.test(m.name)) {
      // Weathered skin: matte, a touch ruddy, slight wrap-around softness.
      nm = old.clone();
      nm.roughness = 0.72;
      nm.metalness = 0;
      nm.color = new THREE.Color(0.93, 0.84, 0.8);
    } else nm = old.clone();
    m.material = withAtmos(nm, /Body|Head/.test(m.name));
  });
}

// ------------------------------------------------------------------ garment

interface FitSet { bvh: MeshBVH; geo: THREE.BufferGeometry; si: Float32Array; sw: Float32Array }

/** Bind-space world positions + skin data of the visible-body meshes, split by region. */
function bodySets(root: THREE.Object3D) {
  const pos: number[] = [], si: number[] = [], sw: number[] = [], cls: string[] = [];
  const tris: number[][] = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || /Eye|Teeth|Headwear/.test(m.name)) return;
    const g = m.geometry;
    const base = pos.length / 3;
    const c = boneClassOf(m);
    for (let i = 0; i < g.attributes.position.count; i++) {
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld);
      pos.push(v.x, v.y, v.z);
      for (let k = 0; k < 4; k++) { si.push(g.attributes.skinIndex.getComponent(i, k)); sw.push(g.attributes.skinWeight.getComponent(i, k)); }
      cls.push(c[i]);
    }
    const idx = g.index!;
    const ci = (/Outfit_Top|Outfit_Bottom|Footwear/.test(m.name) || m.name === 'Wolf3D_Body') ? 0 : 1;
    for (let t = 0; t < idx.count; t += 3) tris.push([base + idx.getX(t), base + idx.getX(t + 1), base + idx.getX(t + 2), ci]);
  });
  const P = new Float32Array(pos);
  const make = (keep: (c: string) => boolean): FitSet => {
    const ix: number[] = [];
    for (const [a, b, c] of tris) if (keep(cls[a]) && keep(cls[b]) && keep(cls[c])) ix.push(a, b, c);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setIndex(ix);
    return { bvh: new MeshBVH(geo), geo, si: new Float32Array(si), sw: new Float32Array(sw) };
  };
  return {
    P, cls,
    trunk: make((c) => c === 'torso' || c === 'leg'),
    arms: make((c) => c === 'arm' || c === 'hand'),
    upper: make((c) => c === 'torso' || c === 'head'),
    all: make(() => true),
  };
}

/** A grid surface: rows × cols vertices, optional wrap of columns. */
class Grid {
  pos: number[] = [];
  uv: number[] = [];
  maxD: number[] = [];
  region: number[] = []; // which fit set to take weights from (0 trunk, 1 arms, 2 upper)
  group = 0;
  constructor(public rows: number, public cols: number, public wrap: boolean) {}
}

function buildGarment(root: THREE.Object3D): Garment {
  const S = bodySets(root);
  const { P, cls } = S;
  const bone = (n: string) => root.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
  const neck = bone('Neck'), hips = bone('Hips'), head = bone('Head'), spine2 = bone('Spine2');
  const yBelt = hips.y + 0.07, yHem = 0.075, yTop = neck.y - 0.03;
  const smooth = (a: Float32Array, n: number, wrap: boolean, it: number) => {
    const b = new Float32Array(n);
    for (let k = 0; k < it; k++) {
      for (let i = 0; i < n; i++) {
        const l = wrap ? a[(i - 1 + n) % n] : a[Math.max(0, i - 1)], r = wrap ? a[(i + 1) % n] : a[Math.min(n - 1, i + 1)];
        b[i] = (l + 2 * a[i] + r) / 4;
      }
      a.set(b);
    }
  };

  // --- Tunic: rings from the collar to the hem.
  const NA = 40, NR = 36;
  const tunic = new Grid(NR, NA, true);
  const rad: Float32Array[] = [];
  const cen: THREE.Vector2[] = [];
  for (let r = 0; r < NR; r++) {
    const y = yTop + (yHem - yTop) * Math.pow(r / (NR - 1), 0.92);
    const bins = new Float32Array(NA).fill(-1);
    let cx = 0, cz = 0, cn = 0;
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== 'torso' && cls[i] !== 'leg') continue;
      if (Math.abs(P[i * 3 + 1] - y) > 0.035) continue;
      cx += P[i * 3]; cz += P[i * 3 + 2]; cn++;
    }
    const c = cn ? new THREE.Vector2(cx / cn, cz / cn) : new THREE.Vector2(hips.x, hips.z);
    if (y < hips.y) c.set(hips.x, hips.z + 0.01);
    cen.push(c);
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== 'torso' && cls[i] !== 'leg') continue;
      if (Math.abs(P[i * 3 + 1] - y) > 0.035) continue;
      const dx = P[i * 3] - c.x, dz = P[i * 3 + 2] - c.y;
      const a = Math.atan2(dx, dz);
      const k = ((Math.round((a / (Math.PI * 2)) * NA) % NA) + NA) % NA;
      bins[k] = Math.max(bins[k], Math.hypot(dx, dz));
    }
    // Fill empty bins by circular interpolation.
    for (let k = 0; k < NA; k++) if (bins[k] < 0) {
      let l = 1, rr = 1;
      while (bins[(k - l + NA) % NA] < 0 && l < NA) l++;
      while (bins[(k + rr) % NA] < 0 && rr < NA) rr++;
      const a = bins[(k - l + NA) % NA], b = bins[(k + rr) % NA];
      bins[k] = a < 0 || b < 0 ? 0.12 : a + (b - a) * (l / (l + rr));
    }
    smooth(bins, NA, true, 3);
    rad.push(bins);
  }
  // Widest hip profile under the belt (the skirt hangs from it).
  const hipProfile = new Float32Array(NA);
  for (let r = 0; r < NR; r++) {
    const y = yTop + (yHem - yTop) * Math.pow(r / (NR - 1), 0.92);
    if (y < yBelt && y > hips.y - 0.22) for (let k = 0; k < NA; k++) hipProfile[k] = Math.max(hipProfile[k], rad[r][k]);
  }
  for (let r = 0; r < NR; r++) {
    const y = yTop + (yHem - yTop) * Math.pow(r / (NR - 1), 0.92);
    const below = Math.max(0, yBelt - y);
    for (let k = 0; k < NA; k++) {
      let rr = rad[r][k];
      const a = (k / NA) * Math.PI * 2;
      if (y > yBelt + 0.02) {
        // Collar snug, chest loose, blousing just over the belt.
        const collar = THREE.MathUtils.smoothstep(y, yTop - 0.12, yTop);
        const blouse = Math.exp(-Math.pow((y - (yBelt + 0.07)) / 0.06, 2)) * 0.035;
        rr += THREE.MathUtils.lerp(0.04, 0.014, collar) + blouse;
      } else if (y > yBelt - 0.03) {
        rr += 0.01; // cinched under the cord
      } else {
        // A-line skirt: never closer than the hips allow, flaring to the hem.
        const back = 0.5 + 0.5 * Math.cos(a - Math.PI); // a little more cloth behind
        rr = Math.max(rr + 0.045, hipProfile[k] + 0.035 + below * (0.15 + 0.05 * back));
        // Organ-pipe folds of heavy wool, deepening towards the hem, never regular.
        const fold = Math.sin(a * 11 + Math.sin(a * 3.1) * 1.7) * 0.6 + Math.sin(a * 6 + 1.3) * 0.4;
        rr += fold * (0.006 + below * 0.032);
      }
      rad[r][k] = rr;
    }
  }
  // Vertical smoothing.
  for (let k = 0; k < NA; k++) {
    const col = new Float32Array(NR);
    for (let r = 0; r < NR; r++) col[r] = rad[r][k];
    smooth(col, NR, false, 2);
    for (let r = 0; r < NR; r++) rad[r][k] = col[r];
  }
  for (let r = 0; r < NR; r++) {
    const y = yTop + (yHem - yTop) * Math.pow(r / (NR - 1), 0.92);
    for (let k = 0; k < NA; k++) {
      const a = (k / NA) * Math.PI * 2;
      tunic.pos.push(cen[r].x + Math.sin(a) * rad[r][k], y, cen[r].y + Math.cos(a) * rad[r][k]);
      tunic.uv.push((k / NA) * 4, y * 2.4);
      const free = y < yBelt - 0.04 ? Math.pow(ss(yBelt - 0.04, yHem, y), 0.85) : 0;
      tunic.maxD.push(0.33 * free);
      tunic.region.push(0);
    }
  }

  // --- Sleeves: wide bell sleeves along the arm chains.
  const sleeves: Grid[] = [];
  for (const side of ['Left', 'Right']) {
    const p0 = bone(side + 'Arm'), p1 = bone(side + 'ForeArm'), p2 = bone(side + 'Hand');
    const dirIn = p0.clone().sub(p1).normalize();
    const start = p0.clone().addScaledVector(dirIn, 0.05);
    const pts = [start, p0, p1, p2.clone().addScaledVector(p2.clone().sub(p1).normalize(), 0.02)];
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const L = lens[lens.length - 1];
    const NS = 13, NB = 14;
    const g = new Grid(NS, NB, true);
    let prevU: THREE.Vector3 | null = null;
    for (let r = 0; r < NS; r++) {
      const s = (r / (NS - 1)) * L;
      let i = 1;
      while (i < pts.length - 1 && lens[i] < s) i++;
      const t = (s - lens[i - 1]) / (lens[i] - lens[i - 1]);
      const C = pts[i - 1].clone().lerp(pts[i], t);
      const T = pts[i].clone().sub(pts[i - 1]).normalize();
      // Parallel-transported frame around the arm axis.
      const U: THREE.Vector3 = prevU ? prevU.clone().addScaledVector(T, -prevU.dot(T)).normalize() : new THREE.Vector3(0, 0, 1).addScaledVector(T, -T.z).normalize();
      prevU = U;
      const W = new THREE.Vector3().crossVectors(T, U);
      // Arm radius from the arm vertices near this ring.
      const bins = new Float32Array(NB).fill(-1);
      for (let k = 0; k < cls.length; k++) {
        if (cls[k] !== 'arm' && cls[k] !== 'hand') continue;
        if (Math.sign(P[k * 3]) !== Math.sign(p0.x)) continue; // this arm only
        const d = new THREE.Vector3(P[k * 3] - C.x, P[k * 3 + 1] - C.y, P[k * 3 + 2] - C.z);
        const along = d.dot(T);
        if (Math.abs(along) > 0.035) continue;
        d.addScaledVector(T, -along);
        const a = Math.atan2(d.dot(W), d.dot(U));
        const b = ((Math.round((a / (Math.PI * 2)) * NB) % NB) + NB) % NB;
        bins[b] = Math.max(bins[b], d.length());
      }
      let mx = 0.05;
      for (const b of bins) mx = Math.max(mx, b);
      for (let b = 0; b < NB; b++) if (bins[b] < 0) bins[b] = mx;
      smooth(bins, NB, true, 3);
      const f = s / L;
      for (let b = 0; b < NB; b++) {
        const a = (b / NB) * Math.PI * 2;
        const rr = bins[b] + 0.03 + Math.pow(f, 2.2) * 0.09;
        const p = C.clone().addScaledVector(U, Math.cos(a) * rr).addScaledVector(W, Math.sin(a) * rr);
        g.pos.push(p.x, p.y, p.z);
        g.uv.push((b / NB) * 3, f * 3);
        g.maxD.push(0.15 * THREE.MathUtils.smoothstep(f, 0.4, 1.0));
        g.region.push(1);
      }
    }
    sleeves.push(g);
  }

  // --- Cowl (cucullus) with its capelet: open around the face, pointed behind.
  const headBox = new THREE.Box3();
  for (let i = 0; i < cls.length; i++) if (cls[i] === 'head' && P[i * 3 + 1] > neck.y + 0.05) headBox.expandByPoint(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  const Hc = headBox.getCenter(new THREE.Vector3());
  Hc.z -= 0.01;
  const NH = 22, NC = 32;
  const hood = new Grid(NH, NC, false);
  const ray = new THREE.Ray();
  const th0 = -1.22, th1 = 1.5;
  for (let r = 0; r < NH; r++) {
    const th = th0 + (th1 - th0) * (r / (NH - 1));
    // Face opening half-angle: wide from chin to brow, closing over the
    // forehead (the cowl overhangs it) and under the chin (capelet closed).
    const open = th < -0.62 ? 0.2 : th < -0.42 ? THREE.MathUtils.lerp(0.2, 0.62, (th + 0.62) / 0.2)
      : th < 0.45 ? 0.62 : THREE.MathUtils.lerp(0.62, 0.1, Math.min(1, (th - 0.45) / 0.7));
    for (let c = 0; c < NC; c++) {
      const ph = open + (Math.PI * 2 - 2 * open) * (c / (NC - 1));
      const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.sin(th), Math.cos(ph) * Math.cos(th));
      ray.set(Hc, dir);
      const hit = S.all.bvh.raycastFirst(ray, THREE.DoubleSide);
      let d = hit ? hit.distance : 0.13;
      // Loose cloth around the head, standing a little proud; capelet over the shoulders.
      let off = th > -0.45 ? 0.055 : THREE.MathUtils.lerp(0.04, 0.055, (th + 1.22) / 0.77);
      if (th > -0.45) d = Math.max(d, 0.1);
      // The point of the cowl, behind and above.
      let dph = ph - Math.PI;
      off += 0.1 * Math.exp(-(dph * dph) / 0.28 - Math.pow(th - 0.75, 2) / 0.1);
      // The capelet stands off the chest and back.
      if (th < -0.5) off += (-0.5 - th) * 0.06 + Math.sin(ph * 9 + 0.7) * 0.012 * (-0.5 - th);
      const p = Hc.clone().addScaledVector(dir, d + off);
      // The rim of the cowl comes forward of the face, a deep brim.
      const edge = Math.min(c, NC - 1 - c);
      if (th > -0.5) p.z += 0.055 * Math.exp(-(edge * edge) / 3) * ss(-0.5, -0.2, th);
      hood.pos.push(p.x, p.y, p.z);
      hood.uv.push((c / NC) * 4, (r / NH) * 3);
      const capelet = THREE.MathUtils.smoothstep(-th, 0.75, 1.2);
      dph = Math.abs(ph - Math.PI);
      hood.maxD.push(0.05 * capelet + 0.035 * Math.exp(-(dph * dph) / 0.3 - Math.pow(th - 0.8, 2) / 0.1));
      hood.region.push(2);
    }
  }

  // --- Fit pass: push every garment vertex out of the body.
  const tmp = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 } as { point: THREE.Vector3; distance: number; faceIndex: number };
  const tri = new THREE.Triangle(), nrm = new THREE.Vector3(), vv = new THREE.Vector3();
  const setFor = (reg: number) => (reg === 0 ? S.trunk : reg === 1 ? S.arms : S.upper);
  const fit = (g: Grid, minOff: number) => {
    for (let i = 0; i < g.pos.length / 3; i++) {
      vv.fromArray(g.pos, i * 3);
      const fs = setFor(g.region[i]);
      fs.bvh.closestPointToPoint(vv, tmp);
      const ix = fs.geo.index!;
      const a = ix.getX(tmp.faceIndex * 3), b = ix.getX(tmp.faceIndex * 3 + 1), c = ix.getX(tmp.faceIndex * 3 + 2);
      tri.a.fromArray(P, a * 3); tri.b.fromArray(P, b * 3); tri.c.fromArray(P, c * 3);
      tri.getNormal(nrm);
      // Signed distance along the body's outward normal; inside or too close → push out.
      const dist = vv.clone().sub(tmp.point).dot(nrm);
      if (dist < minOff) vv.copy(tmp.point).addScaledVector(nrm, minOff);
      vv.toArray(g.pos, i * 3);
    }
  };
  fit(tunic, 0.018);
  sleeves.forEach((g) => fit(g, 0.022));
  fit(hood, 0.03);

  // --- Scapular: front and back panels over the tunic.
  const tunicGeo = gridGeometry(tunic);
  const tunicBVH = new MeshBVH(tunicGeo);
  const scap: Grid[] = [];
  for (const face of [1, -1]) {
    const NX = 6, NY = 22;
    const g = new Grid(NY, NX, false);
    const yA = spine2.y + 0.02, yB = 0.34;
    for (let r = 0; r < NY; r++) {
      const y = yA + (yB - yA) * (r / (NY - 1));
      for (let c = 0; c < NX; c++) {
        const x = -0.165 + 0.33 * (c / (NX - 1));
        ray.set(new THREE.Vector3(x, y, face * 1.2), new THREE.Vector3(0, 0, -face));
        const hit = tunicBVH.raycastFirst(ray, THREE.DoubleSide);
        const z = hit ? hit.point.z : face * 0.15;
        const off = Math.abs(y - yBelt) < 0.06 ? 0.035 : 0.014;
        g.pos.push(x, y, z + face * off);
        g.uv.push(c / NX * 1.5, y * 4);
        g.maxD.push(y < yBelt - 0.05 ? 0.2 * Math.pow(ss(yBelt - 0.05, yB, y), 0.8) : 0);
        g.region.push(0);
      }
    }
    g.group = 1;
    scap.push(g);
  }

  // --- Cingulum: a rope ring at the belt.
  const ropeRing = new Grid(6, 36, true);
  {
    const rr = rad.map((row, r) => ({ row, y: yTop + (yHem - yTop) * Math.pow(r / (NR - 1), 0.92) }));
    const ring = rr.reduce((m, x) => (Math.abs(x.y - yBelt) < Math.abs(m.y - yBelt) ? x : m));
    const rc = cen[rr.indexOf(ring)];
    const NT = 36, NTH = 6, tr = 0.011;
    for (let t = 0; t < NTH; t++) {
      for (let k = 0; k < NT; k++) {
        const a = (k / NT) * Math.PI * 2;
        const R0 = ring.row[Math.round((k / NT) * NA) % NA] + 0.013;
        const ta = (t / NTH) * Math.PI * 2;
        const R = R0 + Math.cos(ta) * tr;
        ropeRing.pos.push(rc.x + Math.sin(a) * R, ring.y + Math.sin(ta) * tr, rc.y + Math.cos(a) * R);
        ropeRing.uv.push(k / NT * 30, t / NTH);
        ropeRing.maxD.push(0);
        ropeRing.region.push(0);
      }
    }
    ropeRing.rows = NTH;
    ropeRing.cols = NT;
    ropeRing.group = 2;
  }
  // (The ring grid wraps in k; its tube rows wrap too, handled in topology below.)

  // --- Assemble one geometry: positions, uvs, colours, index, groups, constraints.
  const pieces: { g: Grid; wrapRows?: boolean }[] = [{ g: tunic }, ...sleeves.map((g) => ({ g })), { g: hood }, ...scap.map((g) => ({ g })), { g: ropeRing, wrapRows: true }];
  const pos: number[] = [], uv: number[] = [], col: number[] = [], maxD: number[] = [], region: number[] = [];
  const index: number[][] = [[], [], []];
  const E: number[] = [], ES: number[] = [];
  for (const { g, wrapRows } of pieces) {
    const base = pos.length / 3;
    const n = g.pos.length / 3;
    for (let i = 0; i < n; i++) {
      pos.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
      uv.push(g.uv[i * 2], g.uv[i * 2 + 1]);
      // Mud and wear towards the hem.
      const y = g.pos[i * 3 + 1];
      const mud = g.group === 2 ? 0 : 1 - THREE.MathUtils.smoothstep(y, 0.06, 0.38);
      col.push(1 - mud * 0.35, 1 - mud * 0.42, 1 - mud * 0.5);
      maxD.push(g.maxD[i]);
      region.push(g.region[i]);
    }
    const R = g.rows, C = g.cols;
    const id = (r: number, c: number) => base + ((r + R) % R) * C + ((c + C) % C);
    const cmax = g.wrap ? C : C - 1, rmax = wrapRows ? R : R - 1;
    for (let r = 0; r < rmax; r++) for (let c = 0; c < cmax; c++) {
      const a = id(r, c), b = id(r, c + 1), cc = id(r + 1, c), d = id(r + 1, c + 1);
      index[g.group].push(a, cc, b, b, cc, d);
    }
    if (g.group === 2) continue; // the rope ring is rigid
    // Structural, shear and bend constraints.
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const a = id(r, c);
      if (g.wrap || c < C - 1) { E.push(a, id(r, c + 1)); ES.push(1); }
      if (r < R - 1) { E.push(a, id(r + 1, c)); ES.push(1); }
      if (r < R - 1 && (g.wrap || c < C - 1)) { E.push(a, id(r + 1, c + 1)); ES.push(0.6); E.push(id(r, c + 1), id(r + 1, c)); ES.push(0.6); }
      if (g.wrap || c < C - 2) { E.push(a, id(r, c + 2)); ES.push(0.18); }
      if (r < R - 2) { E.push(a, id(r + 2, c)); ES.push(0.18); }
    }
  }
  const N = pos.length / 3;
  const bind = new Float32Array(pos);

  // --- Skin-weight transfer from the nearest body point (per region), then smoothing.
  const wmap: Map<number, number>[] = [];
  for (let i = 0; i < N; i++) {
    vv.fromArray(bind, i * 3);
    const fs = setFor(region[i]);
    fs.bvh.closestPointToPoint(vv, tmp);
    const ix = fs.geo.index!;
    const vs = [ix.getX(tmp.faceIndex * 3), ix.getX(tmp.faceIndex * 3 + 1), ix.getX(tmp.faceIndex * 3 + 2)];
    tri.a.fromArray(P, vs[0] * 3); tri.b.fromArray(P, vs[1] * 3); tri.c.fromArray(P, vs[2] * 3);
    const bc = tri.getBarycoord(tmp.point, new THREE.Vector3()) ?? new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
    const m = new Map<number, number>();
    [bc.x, bc.y, bc.z].forEach((w, j) => {
      for (let k = 0; k < 4; k++) {
        const bi = fs.si[vs[j] * 4 + k], bw = fs.sw[vs[j] * 4 + k] * w;
        if (bw > 0) m.set(bi, (m.get(bi) ?? 0) + bw);
      }
    });
    wmap.push(m);
  }
  // The skirt hangs from the pelvis; the legs only push it about (via collisions).
  const bones = (root.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh).skeleton.bones;
  const hipsI = bones.findIndex((b) => b.name === 'Hips');
  for (let i = 0; i < N; i++) {
    const y = bind[i * 3 + 1];
    if (region[i] !== 0 || y > yBelt) continue;
    const t = 0.8 * ss(yBelt, yBelt - 0.3, y);
    const m = wmap[i];
    for (const [k, w] of m) m.set(k, w * (1 - t));
    m.set(hipsI, (m.get(hipsI) ?? 0) + t);
  }
  // Laplacian smoothing of weights over the constraint graph (structural edges only).
  const nb: number[][] = Array.from({ length: N }, () => []);
  for (let e = 0; e < ES.length; e++) if (ES[e] === 1) { nb[E[e * 2]].push(E[e * 2 + 1]); nb[E[e * 2 + 1]].push(E[e * 2]); }
  for (let it = 0; it < 3; it++) {
    const next = wmap.map((m, i) => {
      const o = new Map<number, number>();
      const add = (src: Map<number, number>, f: number) => { for (const [k, w] of src) o.set(k, (o.get(k) ?? 0) + w * f); };
      add(m, 2);
      for (const j of nb[i]) add(wmap[j], 1);
      return o;
    });
    for (let i = 0; i < N; i++) wmap[i] = next[i];
  }
  const skinI = new Uint16Array(N * 4), skinW = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const top = [...wmap[i]].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0) || 1;
    top.forEach(([k, w], j) => { skinI[i * 4 + j] = k; skinW[i * 4 + j] = w / sum; });
  }

  // Constraints only where something can move.
  const fe: number[] = [], fr: number[] = [], fs: number[] = [];
  for (let e = 0; e < ES.length; e++) {
    const a = E[e * 2], b = E[e * 2 + 1];
    if (maxD[a] === 0 && maxD[b] === 0) continue;
    fe.push(a, b);
    fr.push(Math.hypot(bind[a * 3] - bind[b * 3], bind[a * 3 + 1] - bind[b * 3 + 1], bind[a * 3 + 2] - bind[b * 3 + 2]));
    fs.push(ES[e]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  const all: number[] = [];
  index.forEach((ix, gi) => { geo.addGroup(all.length, ix.length, gi); all.push(...ix); });
  geo.setIndex(all);

  // The rope's free end: a short chain hanging from the knot, front right.
  const knot = new THREE.Vector3(-0.09, yBelt - 0.01, 0);
  {
    ray.set(new THREE.Vector3(-0.09, yBelt, 1), new THREE.Vector3(0, 0, -1));
    const hit = tunicBVH.raycastFirst(ray, THREE.DoubleSide);
    knot.z = (hit ? hit.point.z : 0.15) + 0.03;
  }
  let knotI = 0, bd = Infinity;
  const ringStart = N - 6 * 36;
  for (let i = ringStart; i < N; i++) {
    const d = (bind[i * 3] - knot.x) ** 2 + (bind[i * 3 + 1] - knot.y) ** 2 + (bind[i * 3 + 2] - knot.z) ** 2;
    if (d < bd) { bd = d; knotI = i; }
  }
  // Capsules: 0-5 legs and feet, 6 pelvis, 7 torso. Skirt and scapular meet the
  // legs; sleeves meet the torso; the cowl meets nothing.
  const capMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (maxD[i] === 0) continue;
    capMask[i] = region[i] === 0 ? 0b01111111 : region[i] === 1 ? 0b10000000 : 0;
  }
  return { geo, bind, skinI, skinW, capMask, maxD: new Float32Array(maxD), edges: new Uint32Array(fe), rest: new Float32Array(fr), stiff: new Float32Array(fs), rope: { root: knotI, n: 12, seg: 0.05 } };
}

/**
 * The face sits deep in the cowl: bake how much of the sky each head vertex
 * sees past the cowl and habit into vertex colours.
 */
function bakeHeadShade(root: THREE.Object3D, garmentGeo: THREE.BufferGeometry) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', garmentGeo.attributes.position.clone());
  g.setIndex(garmentGeo.index!.clone());
  const bvh = new MeshBVH(g);
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    // Sky and the space in front: upper hemisphere, tilted forward.
    const u = (i + 0.5) / 24, a = i * 2.39996;
    const y = 0.15 + 0.85 * u, r = Math.sqrt(1 - y * y);
    dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r + 0.35).normalize());
  }
  const ray = new THREE.Ray(), v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !/Head|Beard|Eye|Teeth|Body/.test(m.name) || !m.visible) return;
    const n = m.geometry.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld);
      let open = 0;
      for (const d of dirs) {
        ray.origin.copy(v).addScaledVector(d, 0.004);
        ray.direction.copy(d);
        if (!bvh.raycastFirst(ray, THREE.DoubleSide, 0, 0.7)) open++;
      }
      const k = 0.1 + 0.9 * Math.pow(open / dirs.length, 2.0);
      col[i * 3] = k; col[i * 3 + 1] = k * 0.97; col[i * 3 + 2] = k * 0.95;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) sum += col[i * 3];
    monkDebug.ao += `${m.name}:${(sum / n).toFixed(2)} `;
    m.geometry = m.geometry.clone();
    m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (m.material as THREE.MeshStandardMaterial).vertexColors = true;
  });
}

function gridGeometry(g: Grid) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
  const ix: number[] = [];
  const R = g.rows, C = g.cols;
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < (g.wrap ? C : C - 1); c++) {
    const a = r * C + c, b = r * C + ((c + 1) % C), cc = a + C, d = b + C;
    ix.push(a, cc, b, b, cc, d);
  }
  geo.setIndex(ix);
  return geo;
}

// ------------------------------------------------------------------ materials

function makeWeave() {
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

/**
 * Run a material through the game's fog and lamp in-scattering. Skin gets a
 * soft wrap-around diffuse term so faces don't look like plastic.
 */
function withAtmos<M extends THREE.Material>(m: M, skin = false): M {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let fs = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPos);');
    if (skin) {
      fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.06, 0.025, 0.018);');
    }
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => (skin ? 'monk-skin' : 'monk-atmos');
  return m;
}

function wool(color: number, sheen: number, weave: THREE.Texture) {
  return withAtmos(new THREE.MeshPhysicalMaterial({
    color, roughness: 0.97, metalness: 0, sheen: 1, sheenColor: new THREE.Color(sheen), sheenRoughness: 0.75,
    normalMap: weave, normalScale: new THREE.Vector2(0.28, 0.28), side: THREE.DoubleSide, vertexColors: true,
  }));
}

// ------------------------------------------------------------------ the monk

export function createMonk(scene: THREE.Scene): Monk {
  if (!template || !clips || !garment || !mats) throw new Error('loadMonkAssets() first');
  const G = garment;
  const group = new THREE.Group();
  const body = SkeletonUtils.clone(template);
  group.add(body);
  group.scale.setScalar(SCALE);
  scene.add(group);
  let skeleton!: THREE.Skeleton;
  body.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skeleton) skeleton = (o as THREE.SkinnedMesh).skeleton; });
  const B = (n: string) => body.getObjectByName(n) as THREE.Bone;

  const mixer = new THREE.AnimationMixer(body);
  const walk = mixer.clipAction(clips.walk);
  const idle = mixer.clipAction(clips.idle);
  walk.play(); idle.play();
  walk.time = Math.random() * clips.walk.duration;
  idle.time = Math.random() * clips.idle.duration;

  // Garment: drawn in world space from the simulated positions.
  const geo = G.geo.clone();
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const habit = new THREE.Mesh(geo, [mats.wool[0], mats.wool[1], mats.rope]);
  habit.frustumCulled = false;
  habit.visible = monkDebug.garment;
  habit.castShadow = true;
  scene.add(habit);
  const N = G.bind.length / 3;
  const P = new Float32Array(N * 3), Q = new Float32Array(N * 3), T = new Float32Array(N * 3);
  const invM = new Float32Array(N);
  const restS = G.rest.map((r) => r * SCALE);
  for (let i = 0; i < N; i++) invM[i] = G.maxD[i] > 0 ? 1 : 0;
  const free = Uint32Array.from({ length: N }, (_, i) => i).filter((i) => invM[i] > 0);
  const pinned = Uint32Array.from({ length: N }, (_, i) => i).filter((i) => invM[i] === 0);

  // Rope end: a little chain.
  const RN = G.rope.n;
  const rP = new Float32Array(RN * 3), rQ = new Float32Array(RN * 3);
  const ropeGeo = new THREE.BufferGeometry();
  const RS = 6;
  ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RN * RS * 3), 3));
  ropeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(RN * RS * 3), 3));
  const rix: number[] = [];
  for (let i = 0; i < RN - 1; i++) for (let s = 0; s < RS; s++) {
    const a = i * RS + s, b = i * RS + ((s + 1) % RS), c = a + RS, d = b + RS;
    rix.push(a, c, b, b, c, d);
  }
  ropeGeo.setIndex(rix);
  const ropeMesh = new THREE.Mesh(ropeGeo, mats.rope);
  ropeMesh.frustumCulled = false;
  scene.add(ropeMesh);

  // Collision capsules on the legs and pelvis, refreshed from the bones.
  const caps: { a: THREE.Bone; b: THREE.Bone; r: number; pa: THREE.Vector3; pb: THREE.Vector3 }[] = [
    ['LeftUpLeg', 'LeftLeg', 0.085], ['RightUpLeg', 'RightLeg', 0.085],
    ['LeftLeg', 'LeftFoot', 0.065], ['RightLeg', 'RightFoot', 0.065],
    ['LeftFoot', 'LeftToeBase', 0.055], ['RightFoot', 'RightToeBase', 0.055],
    ['LeftUpLeg', 'RightUpLeg', 0.12], ['Spine', 'Spine2', 0.14],
  ].map(([a, b, r]) => ({ a: B(a as string), b: B(b as string), r: (r as number) * SCALE, pa: new THREE.Vector3(), pb: new THREE.Vector3() }));

  // Roman-type horn lantern carried in the right hand.
  const lantern = new THREE.Group();
  const bronze = withAtmos(new THREE.MeshStandardMaterial({ color: 0x3a2c1a, roughness: 0.6, metalness: 0.6 }));
  const horn = withAtmos(new THREE.MeshStandardMaterial({ color: 0x1a0f05, emissive: 0xff8a30, emissiveIntensity: 1.6, roughness: 0.6, side: THREE.DoubleSide }));
  const hornMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.19, 14, 1, true), horn);
  hornMesh.position.y = -0.2;
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), bronze);
  lid.position.y = -0.105;
  const holes = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 4, 14), bronze);
  holes.position.y = -0.07; holes.rotation.x = Math.PI / 2;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 14), bronze);
  base.position.y = -0.3;
  const posts = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), bronze);
    post.position.set(Math.sin(a) * 0.072, -0.2, Math.cos(a) * 0.072);
    posts.add(post);
  }
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.005, 4, 12, Math.PI), bronze);
  bail.position.y = -0.03;
  lantern.add(hornMesh, lid, holes, base, posts, bail);
  scene.add(lantern);
  const lanternWorldPos = new THREE.Vector3();
  const swing = { a: 0, v: 0, b: 0, w: 0 };
  const lastHand = new THREE.Vector3();

  let walkW = 1, first = true;
  const lastRoot = new THREE.Vector3();
  const M = skeleton.boneMatrices!;
  const fwd = new THREE.Vector3(), tv = new THREE.Vector3(), tq = new THREE.Quaternion();

  // Area-weighted vertex normals with typed arrays (three's version allocates).
  const IX = geo.index!.array as Uint32Array | Uint16Array, NRM = geo.attributes.normal.array as Float32Array;
  const normals = () => {
    NRM.fill(0);
    for (let t = 0; t < IX.length; t += 3) {
      const a = IX[t] * 3, b = IX[t + 1] * 3, c = IX[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      NRM[a] += nx; NRM[a + 1] += ny; NRM[a + 2] += nz;
      NRM[b] += nx; NRM[b + 1] += ny; NRM[b + 2] += nz;
      NRM[c] += nx; NRM[c + 1] += ny; NRM[c + 2] += nz;
    }
    for (let i = 0; i < NRM.length; i += 3) {
      const l = Math.hypot(NRM[i], NRM[i + 1], NRM[i + 2]) || 1;
      NRM[i] /= l; NRM[i + 1] /= l; NRM[i + 2] /= l;
    }
    geo.attributes.normal.needsUpdate = true;
  };

  /** CPU skinning of the garment into world space (targets). */
  const skin = () => {
    const I = G.skinI, W = G.skinW, Bp = G.bind;
    for (let i = 0; i < N; i++) {
      const x = Bp[i * 3], y = Bp[i * 3 + 1], z = Bp[i * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = W[i * 4 + k];
        if (w === 0) continue;
        const o = I[i * 4 + k] * 16;
        ox += w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
        oy += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
        oz += w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
      }
      T[i * 3] = ox; T[i * 3 + 1] = oy; T[i * 3 + 2] = oz;
    }
  };

  const collide = (arr: Float32Array, i: number, ground: number, mask: number) => {
    let x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
    for (let ci = 0; ci < caps.length; ci++) {
      if (!(mask & (1 << ci))) continue;
      const c = caps[ci];
      const ax = c.pa.x, ay = c.pa.y, az = c.pa.z;
      const dx = c.pb.x - ax, dy = c.pb.y - ay, dz = c.pb.z - az;
      const L2 = dx * dx + dy * dy + dz * dz || 1;
      let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x - (ax + dx * t), qy = y - (ay + dy * t), qz = z - (az + dz * t);
      const d2 = qx * qx + qy * qy + qz * qz;
      const r = c.r + 0.012;
      if (d2 < r * r && d2 > 1e-10) {
        const s = r / Math.sqrt(d2);
        x = ax + dx * t + qx * s; y = ay + dy * t + qy * s; z = az + dz * t + qz * s;
      }
    }
    if (y < ground) y = ground;
    arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
  };

  const update = (dt: number, pos: THREE.Vector3, yaw: number, speed: number) => {
    dt = Math.min(dt, 1 / 20);
    group.position.copy(pos);
    group.rotation.set(0, yaw, 0);
    const pr = monkDebug.prof, t0 = performance.now();
    walkW += ((speed > 0.08 ? 1 : 0) - walkW) * Math.min(1, dt * 4);
    walk.setEffectiveWeight(walkW);
    idle.setEffectiveWeight(1 - walkW);
    walk.timeScale = THREE.MathUtils.clamp(speed / WALK_SPEED, 0.5, 1.6);
    mixer.update(dt);
    group.updateMatrixWorld(true);
    skeleton.update();
    const t1 = performance.now();
    skin();
    const t2 = performance.now();
    // Teleports and the first frame: start from the skinned shape.
    if (first || lastRoot.distanceToSquared(pos) > 1) {
      P.set(T); Q.set(T);
      const k = G.rope.root;
      for (let j = 0; j < RN; j++) { rP[j * 3] = T[k * 3]; rP[j * 3 + 1] = T[k * 3 + 1] - j * G.rope.seg; rP[j * 3 + 2] = T[k * 3 + 2]; }
      rQ.set(rP);
      first = false;
    }
    lastRoot.copy(pos);
    for (const c of caps) { c.a.getWorldPosition(c.pa); c.b.getWorldPosition(c.pb); }
    const ground = pos.y + 0.012;

    if (!monkDebug.sim) { P.set(T); Q.set(T); }
    // --- Position-based dynamics.
    const SUB = monkDebug.sim ? 2 : 0, h = dt / SUB, g = -9.8 * h * h;
    const D = G.maxD, Ed = G.edges, Rl = restS, St = G.stiff, ne = Rl.length, Cm = G.capMask;
    // Pinned vertices simply sit on the skinned shape.
    for (let k = 0; k < pinned.length; k++) {
      const o = pinned[k] * 3;
      P[o] = Q[o] = T[o]; P[o + 1] = Q[o + 1] = T[o + 1]; P[o + 2] = Q[o + 2] = T[o + 2];
    }
    for (let s = 0; s < SUB; s++) {
      for (let k = 0; k < free.length; k++) {
        const i = free[k], o = i * 3;
        const vx = (P[o] - Q[o]) * 0.985, vy = (P[o + 1] - Q[o + 1]) * 0.985, vz = (P[o + 2] - Q[o + 2]) * 0.985;
        Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
        P[o] += vx; P[o + 1] += vy + g; P[o + 2] += vz;
      }
      {
        for (let e = 0; e < ne; e++) {
          const a = Ed[e * 2], b = Ed[e * 2 + 1];
          const wa = invM[a], wb = invM[b], w = wa + wb;
          if (w === 0) continue;
          const ax = a * 3, bx = b * 3;
          const dx = P[bx] - P[ax], dy = P[bx + 1] - P[ax + 1], dz = P[bx + 2] - P[ax + 2];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const c = ((len - Rl[e]) / len) * St[e] / w;
          P[ax] += dx * c * wa; P[ax + 1] += dy * c * wa; P[ax + 2] += dz * c * wa;
          P[bx] -= dx * c * wb; P[bx + 1] -= dy * c * wb; P[bx + 2] -= dz * c * wb;
        }
        for (let k = 0; k < free.length; k++) {
          const i = free[k], o = i * 3;
          // Tether to the animated shape.
          const dx = P[o] - T[o], dy = P[o + 1] - T[o + 1], dz = P[o + 2] - T[o + 2];
          const d2 = dx * dx + dy * dy + dz * dz, md = D[i] * SCALE;
          if (d2 > md * md) { const k = md / Math.sqrt(d2); P[o] = T[o] + dx * k; P[o + 1] = T[o + 1] + dy * k; P[o + 2] = T[o + 2] + dz * k; }
          collide(P, i, ground, Cm[i]);
        }
      }
      // Rope end.
      const k = G.rope.root;
      rP[0] = T[k * 3]; rP[1] = T[k * 3 + 1]; rP[2] = T[k * 3 + 2];
      for (let j = 1; j < RN; j++) {
        const o = j * 3;
        const vx = (rP[o] - rQ[o]) * 0.98, vy = (rP[o + 1] - rQ[o + 1]) * 0.98, vz = (rP[o + 2] - rQ[o + 2]) * 0.98;
        rQ[o] = rP[o]; rQ[o + 1] = rP[o + 1]; rQ[o + 2] = rP[o + 2];
        rP[o] += vx; rP[o + 1] += vy + g; rP[o + 2] += vz;
      }
      for (let it = 0; it < 3; it++) for (let j = 1; j < RN; j++) {
        const a = (j - 1) * 3, b = j * 3;
        const dx = rP[b] - rP[a], dy = rP[b + 1] - rP[a + 1], dz = rP[b + 2] - rP[a + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const c = (len - G.rope.seg * SCALE) / len;
        if (j === 1) { rP[b] -= dx * c; rP[b + 1] -= dy * c; rP[b + 2] -= dz * c; }
        else { rP[a] += dx * c * 0.5; rP[a + 1] += dy * c * 0.5; rP[a + 2] += dz * c * 0.5; rP[b] -= dx * c * 0.5; rP[b + 1] -= dy * c * 0.5; rP[b + 2] -= dz * c * 0.5; }
        collide(rP, j, ground, 0b01111111);
      }
    }
    const t3 = performance.now();
    (posAttr.array as Float32Array).set(P);
    posAttr.needsUpdate = true;
    normals();
    const t4 = performance.now();
    pr.anim = (pr.anim ?? 0) + (t1 - t0); pr.skin = (pr.skin ?? 0) + (t2 - t1); pr.sim = (pr.sim ?? 0) + (t3 - t2); pr.normals = (pr.normals ?? 0) + (t4 - t3);
    // Rope tube.
    const rp = ropeGeo.attributes.position.array as Float32Array, rn = ropeGeo.attributes.normal.array as Float32Array;
    const up = new THREE.Vector3(), side = new THREE.Vector3(), dirv = new THREE.Vector3();
    for (let j = 0; j < RN; j++) {
      const a = Math.max(0, j - 1), b = Math.min(RN - 1, j + 1);
      dirv.set(rP[b * 3] - rP[a * 3], rP[b * 3 + 1] - rP[a * 3 + 1], rP[b * 3 + 2] - rP[a * 3 + 2]).normalize();
      side.set(1, 0, 0).cross(dirv);
      if (side.lengthSq() < 1e-4) side.set(0, 0, 1).cross(dirv);
      side.normalize();
      up.crossVectors(dirv, side);
      const r = 0.011 * (j === RN - 1 ? 1.6 : 1);
      for (let s = 0; s < RS; s++) {
        const a2 = (s / RS) * Math.PI * 2, cx = Math.cos(a2), sx = Math.sin(a2);
        const o = (j * RS + s) * 3;
        const nx = side.x * cx + up.x * sx, ny = side.y * cx + up.y * sx, nz = side.z * cx + up.z * sx;
        rp[o] = rP[j * 3] + nx * r; rp[o + 1] = rP[j * 3 + 1] + ny * r; rp[o + 2] = rP[j * 3 + 2] + nz * r;
        rn[o] = nx; rn[o + 1] = ny; rn[o + 2] = nz;
      }
    }
    ropeGeo.attributes.position.needsUpdate = true;
    ropeGeo.attributes.normal.needsUpdate = true;

    // --- Lantern: hangs from the right hand and swings like a pendulum.
    B('RightHand').getWorldPosition(tv);
    fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    const hv = tv.clone().sub(lastHand).divideScalar(Math.max(dt, 1e-3));
    lastHand.copy(tv);
    swing.v += (-swing.a * 28 - hv.dot(fwd) * 0.7 - swing.v * 3.2) * dt;
    swing.a = THREE.MathUtils.clamp(swing.a + swing.v * dt, -0.6, 0.6);
    const sideDir = new THREE.Vector3(fwd.z, 0, -fwd.x);
    swing.w += (-swing.b * 28 - hv.dot(sideDir) * 0.5 - swing.w * 3.2) * dt;
    swing.b = THREE.MathUtils.clamp(swing.b + swing.w * dt, -0.4, 0.4);
    lantern.position.copy(tv).addScaledVector(fwd, 0.03);
    lantern.quaternion.setFromEuler(new THREE.Euler(swing.a, yaw, swing.b, 'YXZ'));
    lantern.updateMatrixWorld(true);
    hornMesh.getWorldPosition(lanternWorldPos);
    void tq;
  };

  return { group, lanternWorldPos, update };
}
