import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canon, withAtmos, matte } from './rig';
import { fabric } from './fabric';

// Clothes, made the way game characters are dressed: each garment is
// generated around the body in its bind pose, pushed out of the body with
// BVH closest-point queries, and given skin weights transferred from the
// nearest body surface, so it follows every joint. Body parts it covers are
// removed so nothing pokes through. Free parts (skirts, sleeve ends, hoods,
// cloaks) are later simulated as cloth near the camera (see cloth.ts).

export type HoodKind = 'cowl' | 'hood' | 'veil';
export interface GarmentSpec {
  hem: 'ankle' | 'calf' | 'knee';
  flare: number; // skirt flare per metre below the belt
  trail?: number; // extra flare at the back (room for the heel kicking up behind in a long skirt)
  folds: number; // fold depth per metre below the belt
  sleeve: 'bell' | 'fitted';
  hood: HoodKind | null;
  scapular?: boolean;
  cape?: 'cloak' | 'shawl';
  belt: 'rope' | 'leather' | 'sash';
  tail?: boolean; // the rope's hanging end
  thighs?: number; // share of a skirt's skinning carried by the thighs (default: hung from the pelvis)
  cloakClose?: boolean; // a cloak cut round the trunk (and the hanging arms), skinned like the tunic under it
  swing?: boolean; // skin to twist-free stand-ins for the limb bones (needs addSwingBones on the body first)
  stride?: number; // a long skirt: how much of it swings with the thighs (0-1)
  /** A short skirt pushed by the striding legs: how much of its front and back swing with the leading and trailing thigh. */
  legFollow?: number;
  /** Skin the cloak like the tunic beneath it, so the two layers bend together. */
  capeOnTunic?: boolean;
  /** Radians by which the cloak is thrown back off the left shoulder (to free a shield arm). */
  capeOpen?: number;
}

/** Material groups of a garment. */
export const G_TUNIC = 0, G_OVER = 1, G_BELT = 2, G_HEAD = 3;

export interface Garment {
  geo: THREE.BufferGeometry; // bind-space positions, normals, uv, color, skin attributes, groups
  bind: Float32Array;
  skinI: Uint16Array;
  skinW: Float32Array;
  maxD: Float32Array; // tether radius per vertex (0 = pinned)
  capMask: Uint16Array; // which collision capsules a vertex can touch (bit per capsule)
  keepOut: Uint8Array; // 1 = may not sink in towards the spine past where skinning puts it (cloaks)
  edges: Uint32Array;
  rest: Float32Array;
  stiff: Float32Array;
  rope: { root: number; n: number; seg: number } | null;
  /** Cloth laid over other cloth: follows vertex ride[i] of the layer beneath (-1: its own). */
  ride?: Int32Array;
  /** Helper bones the garment is also skinned to, indexed after the body's skeleton (see addSkirtBones). */
  extraBones?: { name: string; inv: THREE.Matrix4 }[];
  /** Skirt panels (see legFollow): two extra bones after the body's, front and back, pivoting at the hip joints. */
  skirt?: { pivot: THREE.Vector3; front: number; back: number };
  /** Where the belt sits, for fittings hung on it. */
  belt: { y: number; cx: number; cz: number; r: (a: number) => number };
}

/** Body measurements in the bind pose (world-at-load units, metres). */
export interface Measure {
  bone: (n: string) => THREE.Vector3;
  head: { c: THREE.Vector3; rx: number; rz: number; top: number; brow: number; skull: boolean };
}

// ------------------------------------------------------------------ body

const HANDS = /Hand|Thumb|Index|Middle|Ring|Pinky/;
const HEAD = /^(Head|HeadTop_End|LeftEye|RightEye|Neck)$/;
const ARMS = /Shoulder|Arm/;
const FEET = /Foot|Toe/;
const LEGS = /UpLeg|Leg/;
type Cls = 'hand' | 'head' | 'arm' | 'leg' | 'foot' | 'torso' | 'none';

export function boneClassOf(mesh: THREE.SkinnedMesh): Cls[] {
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => canon(b.name));
  const cls: Cls[] = [];
  for (let i = 0; i < si.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    const n = names[best];
    cls.push(HANDS.test(n) ? 'hand' : HEAD.test(n) ? 'head' : ARMS.test(n) ? 'arm' : FEET.test(n) ? 'foot' : LEGS.test(n) ? 'leg' : 'torso');
  }
  return cls;
}

/**
 * Remove modern accessories modelled as separate pieces on the head
 * (sunglasses, earrings, hair puffs): every connected piece made only of
 * head vertices, except the largest one, the head itself.
 */
export function stripHeadPieces(root: THREE.Object3D) {
  const removed: number[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const g = m.geometry, pos = g.attributes.position, idx = g.index!;
    const cls = boneClassOf(m);
    // Weld by position so UV seams don't split pieces.
    const key = new Map<string, number>(), weld = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
      if (!key.has(k)) key.set(k, i);
      weld[i] = key.get(k)!;
    }
    const parent = Int32Array.from({ length: pos.count }, (_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < idx.count; t += 3) {
      const a = find(weld[idx.getX(t)]), b = find(weld[idx.getX(t + 1)]), c = find(weld[idx.getX(t + 2)]);
      parent[b] = a; parent[find(c)] = find(a);
    }
    const size = new Map<number, number>(), allHead = new Map<number, boolean>();
    for (let t = 0; t < idx.count; t += 3) {
      const r = find(weld[idx.getX(t)]);
      size.set(r, (size.get(r) ?? 0) + 1);
      const h = cls[idx.getX(t)] === 'head' && cls[idx.getX(t + 1)] === 'head' && cls[idx.getX(t + 2)] === 'head';
      allHead.set(r, (allHead.get(r) ?? true) && h);
    }
    let biggest = -1, bs = 0;
    for (const [r, n] of size) if (allHead.get(r) && n > bs) { bs = n; biggest = r; }
    const keep: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const r = find(weld[idx.getX(t)]);
      if (allHead.get(r) && r !== biggest) continue;
      keep.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
    }
    removed.push((idx.count - keep.length) / 3, ...[...size].filter(([r]) => allHead.get(r)).map(([, n]) => n));
    g.setIndex(keep);
  });
  return removed;
}

export function measure(root: THREE.Object3D, skull?: { rx: number; rz: number }): Measure {
  root.updateMatrixWorld(true);
  const bone = (n: string) => {
    let o: THREE.Object3D | undefined;
    root.traverse((x) => { if (!o && (x as THREE.Bone).isBone && canon(x.name) === n) o = x; });
    return o!.getWorldPosition(new THREE.Vector3());
  };
  if (skull) {
    // A head without its skull (see faceOnly): measured from the bones.
    const hb = bone('Head'), top = Math.min(bone('HeadTop_End').y, hb.y + 0.165);
    const c = new THREE.Vector3(hb.x, (hb.y + top) / 2 + 0.01, hb.z + 0.012);
    return { bone, head: { c, rx: skull.rx, rz: skull.rz, top, brow: c.y + (top - hb.y) * 0.14, skull: false } };
  }
  const neck = bone('Neck');
  const box = new THREE.Box3(), v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || /Eye|Teeth|Headwear|Outfit/.test(m.name)) return;
    const cls = boneClassOf(m);
    const used = new Set<number>(m.geometry.index!.array as unknown as number[]);
    for (const i of used) {
      if (cls[i] !== 'head') continue;
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      if (v.y > neck.y + 0.05) box.expandByPoint(v);
    }
  });
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  return { bone, head: { c, rx: s.x / 2, rz: s.z / 2, top: box.max.y, brow: c.y + s.y * 0.12, skull: true } };
}

/**
 * Keep only the face and neck of a head that will be veiled: hair, ears and
 * anything worn on them go (the veil is fitted to the skull's ellipsoid).
 */
export function faceOnly(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  let hb = new THREE.Vector3(), top = 0;
  root.traverse((x) => {
    if (canon(x.name) === 'Head') x.getWorldPosition(hb);
    if (canon(x.name) === 'HeadTop_End') top = x.getWorldPosition(new THREE.Vector3()).y;
  });
  hb = hb.clone();
  const cy = (hb.y + Math.min(top, hb.y + 0.165)) / 2;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const cls = boneClassOf(m), idx = m.geometry.index!;
    const ok = (i: number) => {
      if (cls[i] !== 'head') return true;
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      if (v.y < hb.y + 0.01) return true; // neck and under the jaw
      const a = Math.abs(Math.atan2(v.x - hb.x, v.z - hb.z));
      return a < 1.0 && v.y < cy + 0.045;
    };
    const keep: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (ok(a) && ok(b) && ok(c)) keep.push(a, b, c);
    }
    m.geometry.setIndex(keep);
  });
}

/**
 * Strip the modern outfit. The man keeps head, beard, hands, his trousers as
 * hose and his shoes; the woman keeps head, hands and feet. Everything else
 * the clothes cover goes.
 */
export function dressBody(root: THREE.Object3D, kit: 'man' | 'woman', o: { beard: boolean; wraps: boolean; m: Measure }) {
  const leather = fabric('leather', 0x2a1d14, { attr: 'position' });
  root.traverse((x) => {
    const m = x as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    if (/Outfit_Top|Headwear/.test(m.name) || (!o.beard && /Beard/.test(m.name))) { m.visible = false; return; }
    const trim = kit === 'woman' || m.name === 'Wolf3D_Body';
    if (trim) {
      const cls = boneClassOf(m);
      const idx = m.geometry.index!;
      const skin: number[] = [], feet: number[] = [];
      // The base of the neck and the top of the chest show in the collar.
      const collar = o.m.bone('Neck').y - 0.1, w = new THREE.Vector3();
      const high = new Uint8Array(cls.length);
      for (let i = 0; i < cls.length; i++) if (cls[i] === 'torso') high[i] = m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld).y > collar ? 1 : 0;
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
        const ok = (i: number) => cls[i] === 'hand' || cls[i] === 'head' || high[i] === 1;
        if (ok(a) && ok(b) && ok(c)) skin.push(a, b, c);
        else if (kit === 'woman' && cls[a] === 'foot' && cls[b] === 'foot' && cls[c] === 'foot') feet.push(a, b, c);
      }
      m.geometry = m.geometry.clone();
      m.geometry.setIndex([...skin, ...feet]);
      m.geometry.clearGroups();
      m.geometry.addGroup(0, skin.length, 0);
      if (feet.length) m.geometry.addGroup(skin.length, feet.length, 1);
    }
    if (m.name === 'Wolf3D_Outfit_Bottom') {
      // Trousers become close-fitting hose: pull them in above the knee so they
      // stay inside a short tunic's skirt.
      const knee = o.m.bone('LeftLeg').y, g = (m.geometry = m.geometry.clone());
      const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
      const inv = m.matrixWorld.clone().invert(), w = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
        const k = THREE.MathUtils.smoothstep(w.y, knee - 0.05, knee + 0.15) * 0.016;
        if (k <= 0) continue;
        v.fromBufferAttribute(n, i).normalize();
        p.setXYZ(i, p.getX(i) - v.x * k, p.getY(i) - v.y * k, p.getZ(i) - v.z * k);
      }
      void inv;
    }
    const old = m.material as THREE.MeshStandardMaterial;
    let nm: THREE.Material;
    if (m.name === 'Wolf3D_Outfit_Footwear') nm = leather;
    else if (m.name === 'Wolf3D_Outfit_Bottom') {
      // Wool hose, with linen fasciae wound from ankle to knee on laymen.
      const ankle = o.m.bone('LeftFoot').y + 0.03, knee = o.m.bone('LeftLeg').y + 0.02;
      nm = fabric('tabby', 0x2b241d, { attr: 'position', wraps: o.wraps ? { knee, ankle, color: new THREE.Color(0x6e6656) } : undefined });
    } else if (/Body|Head|^Mesh$/.test(m.name) || kit === 'woman') {
      // Weathered skin: matte, slight wrap-around softness.
      const s = old.clone();
      s.roughness = 0.72;
      s.metalness = 0;
      // The man's head is textured; his hands (Wolf3D_Body) only have a colour.
      if (kit === 'man') s.color = m.name === 'Wolf3D_Body' ? s.color.clone().multiplyScalar(1.2) : new THREE.Color(0.93, 0.84, 0.8);
      else { s.roughness = 0.78; s.normalScale?.set(0.6, 0.6); }
      nm = withAtmos(s, { skin: true });
      nm.userData.skin = true;
    } else nm = withAtmos(old.clone());
    m.material = kit === 'woman' ? [nm, leather] : nm;
  });
}

// ------------------------------------------------------------------ garment

interface FitSet { bvh: MeshBVH; geo: THREE.BufferGeometry; si: Float32Array; sw: Float32Array }

/**
 * The avatar's modern top is a suit: lapels and a shirt collar standing up
 * round the neck, a bow tie, a rose in the buttonhole, buttons and cuffs.
 * Clothes fitted over those come out lumpy and spiked, so they are left out
 * of the body's shape (marked 'none'): every small piece, and whatever stands
 * up round the base of the neck.
 */
function dropTrimmings(m: THREE.SkinnedMesh, cls: Cls[], neck: THREE.Vector3) {
  const g = m.geometry, pos = g.attributes.position, idx = g.index!;
  const key = new Map<string, number>(), weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (!key.has(k)) key.set(k, i);
    weld[i] = key.get(k)!;
  }
  const parent = Int32Array.from({ length: pos.count }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < idx.count; t += 3) {
    const a = find(weld[idx.getX(t)]), b = find(weld[idx.getX(t + 1)]), c = find(weld[idx.getX(t + 2)]);
    parent[b] = a; parent[find(c)] = find(a);
  }
  const w = Array.from({ length: pos.count }, (_, i) => m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld));
  const lo = new Map<number, number>(), hi = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const r = find(weld[i]);
    lo.set(r, Math.min(lo.get(r) ?? Infinity, w[i].y));
    hi.set(r, Math.max(hi.get(r) ?? -Infinity, w[i].y));
  }
  for (let i = 0; i < pos.count; i++) {
    const r = find(weld[i]);
    const small = hi.get(r)! - lo.get(r)! < 0.15;
    const collar = w[i].y > neck.y - 0.03 && Math.hypot(w[i].x - neck.x, w[i].z - neck.z) < 0.13;
    if (small || collar) cls[i] = 'none';
  }
}

/** Bind-space world positions + skin data of the body meshes, split by region. */
function bodySets(root: THREE.Object3D, full: THREE.Object3D) {
  const pos: number[] = [], si: number[] = [], sw: number[] = [], cls: Cls[] = [], beard: boolean[] = [];
  const tris: number[][] = [];
  const v = new THREE.Vector3();
  // The untrimmed body (full) gives the shape; skin data are the same.
  full.updateMatrixWorld(true);
  let neck: THREE.Vector3 | null = null;
  full.traverse((x) => { if (!neck && (x as THREE.Bone).isBone && canon(x.name) === 'Neck') neck = x.getWorldPosition(new THREE.Vector3()); });
  full.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || /Eye|Teeth|Headwear/.test(m.name)) return;
    const g = m.geometry;
    const base = pos.length / 3;
    const c = boneClassOf(m);
    if (/Outfit_Top/.test(m.name) && neck) dropTrimmings(m, c, neck);
    for (let i = 0; i < g.attributes.position.count; i++) {
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld);
      pos.push(v.x, v.y, v.z);
      for (let k = 0; k < 4; k++) { si.push(g.attributes.skinIndex.getComponent(i, k)); sw.push(g.attributes.skinWeight.getComponent(i, k)); }
      cls.push(c[i]);
      beard.push(/Beard/.test(m.name));
    }
    const idx = g.index!;
    for (let t = 0; t < idx.count; t += 3) tris.push([base + idx.getX(t), base + idx.getX(t + 1), base + idx.getX(t + 2)]);
  });
  void root;
  const P = new Float32Array(pos);
  const make = (keep: (c: Cls) => boolean, skip?: boolean[]): FitSet => {
    const ix: number[] = [];
    for (const [a, b, c] of tris) if (keep(cls[a]) && keep(cls[b]) && keep(cls[c]) && !(skip && (skip[a] || skip[b] || skip[c]))) ix.push(a, b, c);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setIndex(ix);
    return { bvh: new MeshBVH(geo), geo, si: new Float32Array(si), sw: new Float32Array(sw) };
  };
  const leg = (c: Cls) => c === 'leg' || c === 'foot';
  let nb: { all: FitSet; upper: FitSet } | null = null;
  return {
    P, cls,
    trunk: make((c) => c === 'torso' || leg(c)),
    arms: make((c) => c === 'arm' || c === 'hand'),
    upper: make((c) => c === 'torso' || c === 'head'),
    torso: make((c) => c === 'torso'),
    shoulders: make((c) => c === 'torso' || c === 'arm'),
    all: make((c) => c !== 'none'),
    noBeard: () => (nb ??= { all: make((c) => c !== 'none', beard), upper: make((c) => c === 'torso' || c === 'head', beard) }),
  };
}

/** A grid surface: rows × cols vertices, optional wrap of columns. */
class Grid {
  pos: number[] = [];
  uv: number[] = [];
  maxD: number[] = [];
  region: number[] = []; // weights from: 0 trunk, 1 arms, 2 upper, 3 torso, 4 torso and arms (the yoke)
  group = G_TUNIC;
  cap = 0; // capsule mask for free vertices
  flip = false; // wound the other way, so faces point out of the body
  constructor(public rows: number, public cols: number, public wrap: boolean) {}
}

/** GLSL-style smoothstep that also accepts reversed edges. */
const ss = (e0: number, e1: number, x: number) => { const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// Capsules (see cloth.ts): 0-1 thighs, 2-3 shins, 4-5 feet, 6 pelvis, 7 torso, 8-9 upper arms, 10-11 forearms.
const CAP_SKIRT = 0b000001111111, CAP_SLEEVE = 0b000010000000, CAP_CLOAK = 0b111111000011, CAP_SHAWL = 0b111110000000;

/** Where a veil leaves the head and begins to hang (elevation from the head's centre). */
const VEIL_J = -0.45;
const HOODS: Record<HoodKind, { off: number; minD: number; point: number; brim: number; cape: number; mid: number; top: number; drape: number }> = {
  // The monk's cowl: deep, pointed, with a capelet.
  cowl: { off: 0.055, minD: 0.1, point: 0.1, brim: 0.055, cape: 0.06, mid: 0.62, top: 0.1, drape: 0 },
  // A layman's hood (cucullus) with a short shoulder cape.
  hood: { off: 0.04, minD: 0.095, point: 0.07, brim: 0.03, cape: 0.05, mid: 0.6, top: 0.12, drape: 0.02 },
  // A woman's veil: close round the head, falling over the shoulders.
  veil: { off: 0.02, minD: 0.088, point: 0, brim: 0.006, cape: 0.035, mid: 0.7, top: 0.16, drape: 0.06 },
};

export function buildGarment(root: THREE.Object3D, full: THREE.Object3D, M: Measure, spec: GarmentSpec): Garment {
  const S = bodySets(root, full);
  const { P, cls } = S;
  const bone = M.bone;
  const neck = bone('Neck'), hips = bone('Hips'), spine2 = bone('Spine2');
  const knee = bone('LeftLeg').y, ankle = bone('LeftFoot').y;
  const yBelt = hips.y + 0.07, yTop = neck.y - 0.03;
  // Above the armpits the tunic is a yoke over the shoulders, moving with the arms.
  const yYoke = Math.min(bone('LeftArm').y, bone('RightArm').y) - 0.06;
  const yHem = spec.hem === 'ankle' ? Math.max(0.055, ankle * 0.72) : spec.hem === 'knee' ? knee - 0.07 : (knee + ankle) / 2 - 0.02;
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
  const isTrunk = (c: Cls) => c === 'torso' || c === 'leg' || c === 'foot';

  // --- Tunic: rings from the collar to the hem.
  const NA = 40, NR = Math.max(20, Math.round(36 * (yTop - yHem) / (yTop - 0.075)));
  // The first YOKE rows run from the collar to the armpits; the rest down to the hem.
  const YOKE = 5, y1 = yYoke - 0.03;
  const ringY = (r: number) => r < YOKE ? yTop + (yYoke + 0.005 - yTop) * (r / (YOKE - 1)) : y1 + (yHem - y1) * Math.pow((r - YOKE) / (NR - 1 - YOKE), 0.92);
  const tunic = new Grid(NR, NA, true);
  tunic.cap = CAP_SKIRT;
  const rad: Float32Array[] = [];
  const cen: THREE.Vector2[] = [];
  for (let r = 0; r < NR; r++) {
    const y = ringY(r);
    const bins = new Float32Array(NA).fill(-1);
    let cx = 0, cz = 0, cn = 0;
    for (let i = 0; i < cls.length; i++) {
      if (!isTrunk(cls[i]) || Math.abs(P[i * 3 + 1] - y) > 0.035) continue;
      cx += P[i * 3]; cz += P[i * 3 + 2]; cn++;
    }
    const c = cn ? new THREE.Vector2(cx / cn, cz / cn) : new THREE.Vector2(hips.x, hips.z);
    if (y < hips.y) c.set(hips.x, hips.z + 0.01);
    cen.push(c);
    for (let i = 0; i < cls.length; i++) {
      if (!isTrunk(cls[i]) || Math.abs(P[i * 3 + 1] - y) > 0.035) continue;
      const dx = P[i * 3] - c.x, dz = P[i * 3 + 2] - c.y;
      const a = Math.atan2(dx, dz);
      const k = ((Math.round((a / (Math.PI * 2)) * NA) % NA) + NA) % NA;
      bins[k] = Math.max(bins[k], Math.hypot(dx, dz));
    }
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
  const hipProfile = new Float32Array(NA);
  for (let r = 0; r < NR; r++) {
    const y = ringY(r);
    if (y < yBelt && y > hips.y - 0.22) for (let k = 0; k < NA; k++) hipProfile[k] = Math.max(hipProfile[k], rad[r][k]);
  }
  const fp = Math.random() * 6; // each garment folds its own way
  for (let r = 0; r < NR; r++) {
    const y = ringY(r);
    const below = Math.max(0, yBelt - y);
    for (let k = 0; k < NA; k++) {
      let rr = rad[r][k];
      const a = (k / NA) * Math.PI * 2;
      if (y > yBelt + 0.02) {
        const collar = THREE.MathUtils.smoothstep(y, yTop - 0.12, yTop);
        const blouse = Math.exp(-Math.pow((y - (yBelt + 0.07)) / 0.06, 2)) * 0.035;
        rr += THREE.MathUtils.lerp(0.04, 0.014, collar) + blouse;
      } else if (y > yBelt - 0.03) {
        rr += 0.01;
      } else {
        const back = 0.5 + 0.5 * Math.cos(a - Math.PI);
        rr = Math.max(rr + 0.045, hipProfile[k] + 0.035 + below * (spec.flare + (0.05 + (spec.trail ?? 0)) * back));
        const fold = Math.sin(a * 11 + Math.sin(a * 3.1 + fp) * 1.7 + fp) * 0.6 + Math.sin(a * 6 + 1.3 + fp * 0.7) * 0.4;
        rr += fold * (0.006 + below * spec.folds);
      }
      rad[r][k] = rr;
    }
  }
  for (let k = 0; k < NA; k++) {
    const col = new Float32Array(NR);
    for (let r = 0; r < NR; r++) col[r] = rad[r][k];
    smooth(col, NR, false, 2);
    for (let r = 0; r < NR; r++) rad[r][k] = col[r];
  }
  // (A skirt that already strides with the legs needs less room to swing.)
  const skirtD = 0.33 * Math.min(1, (yBelt - yHem) / 0.9) * (spec.stride ? 0.45 : 1);
  for (let r = 0; r < NR; r++) {
    const y = ringY(r);
    for (let k = 0; k < NA; k++) {
      const a = (k / NA) * Math.PI * 2;
      tunic.pos.push(cen[r].x + Math.sin(a) * rad[r][k], y, cen[r].y + Math.cos(a) * rad[r][k]);
      tunic.uv.push((k / NA) * 4, y * 2.4);
      const free = y < yBelt - 0.04 ? Math.pow(ss(yBelt - 0.04, yHem, y), 0.85) : 0;
      tunic.maxD.push(skirtD * free);
      tunic.region.push(y > yYoke ? 4 : 0);
    }
  }

  // --- Sleeves along the arm chains: wide bell sleeves, or fitted to the wrist.
  const bell = spec.sleeve === 'bell';
  const sleeves: Grid[] = [];
  for (const side of ['Left', 'Right']) {
    const p0 = bone(side + 'Arm'), p1 = bone(side + 'ForeArm'), p2 = bone(side + 'Hand');
    const dirIn = p0.clone().sub(p1).normalize();
    // The sleeve starts at the shoulder joint, under the tunic's yoke.
    const start = p0.clone().addScaledVector(dirIn, -0.015);
    const end = bell ? p2.clone().addScaledVector(p2.clone().sub(p1).normalize(), 0.02) : p2.clone().addScaledVector(p2.clone().sub(p1).normalize(), -0.025);
    const pts = [start, p0, p1, end];
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const L = lens[lens.length - 1];
    const NS = 13, NB = 14;
    const g = new Grid(NS, NB, true) as Grid & { axis: THREE.Vector3[] };
    g.axis = [];
    g.cap = CAP_SLEEVE;
    g.flip = true;
    let prevU: THREE.Vector3 | null = null;
    for (let r = 0; r < NS; r++) {
      const s = (r / (NS - 1)) * L;
      let i = 1;
      while (i < pts.length - 1 && lens[i] < s) i++;
      const t = (s - lens[i - 1]) / (lens[i] - lens[i - 1]);
      const C = pts[i - 1].clone().lerp(pts[i], t);
      const T = pts[i].clone().sub(pts[i - 1]).normalize();
      const U: THREE.Vector3 = prevU ? prevU.clone().addScaledVector(T, -prevU.dot(T)).normalize() : new THREE.Vector3(0, 0, 1).addScaledVector(T, -T.z).normalize();
      prevU = U;
      const W = new THREE.Vector3().crossVectors(T, U);
      g.axis.push(C);
      const bins = new Float32Array(NB).fill(-1);
      for (let k = 0; k < cls.length; k++) {
        if (cls[k] !== 'arm' && (cls[k] !== 'hand' || !bell)) continue;
        if (Math.sign(P[k * 3]) !== Math.sign(p0.x)) continue;
        const d = new THREE.Vector3(P[k * 3] - C.x, P[k * 3 + 1] - C.y, P[k * 3 + 2] - C.z);
        const along = d.dot(T);
        if (Math.abs(along) > 0.035) continue;
        d.addScaledVector(T, -along);
        const a = Math.atan2(d.dot(W), d.dot(U));
        const b = ((Math.round((a / (Math.PI * 2)) * NB) % NB) + NB) % NB;
        bins[b] = Math.max(bins[b], d.length());
      }
      let mx = 0.04;
      for (const b of bins) mx = Math.max(mx, b);
      for (let b = 0; b < NB; b++) if (bins[b] < 0) bins[b] = mx;
      smooth(bins, NB, true, 3);
      const f = s / L;
      for (let b = 0; b < NB; b++) {
        const a = (b / NB) * Math.PI * 2;
        const rr = bins[b] + (bell ? 0.03 + Math.pow(f, 2.2) * 0.09 : 0.018 + f * 0.004 + Math.sin(a * 3 + f * 9) * 0.003);
        const p = C.clone().addScaledVector(U, Math.cos(a) * rr).addScaledVector(W, Math.sin(a) * rr);
        g.pos.push(p.x, p.y, p.z);
        g.uv.push((b / NB) * 3, f * 3);
        g.maxD.push(bell ? 0.15 * THREE.MathUtils.smoothstep(f, 0.4, 1.0) : 0.02 * THREE.MathUtils.smoothstep(f, 0.75, 1.0));
        g.region.push(1);
      }
    }
    sleeves.push(g);
  }

  // --- Head covering: cowl, hood or veil, open round the face.
  const ray = new THREE.Ray();
  let hood: Grid | null = null;
  if (spec.hood) {
    const H = HOODS[spec.hood];
    const Hc = M.head.c.clone();
    Hc.z -= 0.01;
    const NH = 22, NC = 32;
    hood = new Grid(NH, NC, false);
    hood.group = spec.hood === 'cowl' ? G_TUNIC : G_HEAD;
    hood.flip = true;
    const th0 = -1.22, th1 = 1.5;
    const veil = spec.hood === 'veil';
    // A layman's hood is fitted to the skull and neck, under his beard.
    const hb = spec.hood === 'hood', hset = hb ? S.noBeard().all : S.all, hr: number[] = [], hdir: THREE.Vector3[] = [];
    for (let r = 0; r < NH; r++) {
      const th = th0 + (th1 - th0) * (r / (NH - 1));
      const o0 = hb ? 0.05 : 0.2; // a layman's hood is closed under the chin
      let open = th < -0.62 ? o0 : th < -0.42 ? THREE.MathUtils.lerp(o0, H.mid, (th + 0.62) / 0.2)
        : th < 0.45 ? H.mid : THREE.MathUtils.lerp(H.mid, H.top, Math.min(1, (th - 0.45) / 0.7));
      // A veil frames the face, straight across the brow, and its edges fall open down the front.
      if (veil) open = th < VEIL_J ? H.mid + (VEIL_J - th) * 0.12 : THREE.MathUtils.lerp(H.mid, 0.02, ss(0.22, 0.5, th));
      for (let c = 0; c < NC; c++) {
        const ph = open + (Math.PI * 2 - 2 * open) * (c / (NC - 1));
        if (veil && th < VEIL_J) {
          // Below the jaw it hangs: straight down from where it leaves the
          // head, over the neck onto the shoulders and the top of the back
          // (laid onto the tunic once that is fitted, below).
          const s = (VEIL_J - th) / (VEIL_J - th0), back = 0.5 - 0.5 * Math.cos(ph);
          const dj = new THREE.Vector3(Math.sin(ph) * Math.cos(VEIL_J), Math.sin(VEIL_J), Math.cos(ph) * Math.cos(VEIL_J));
          const ell = 1 / Math.sqrt((dj.x / M.head.rx) ** 2 + (dj.y / ((M.head.top - Hc.y) * 1.02)) ** 2 + (dj.z / M.head.rz) ** 2);
          const J = Hc.clone().addScaledVector(dj, Math.max(ell, H.minD) + H.off);
          const R0 = Math.hypot(J.x - Hc.x, J.z - Hc.z) + s * 0.015;
          hood.pos.push(Hc.x + Math.sin(ph) * R0, J.y - s * (0.1 + 0.1 * back), Hc.z + Math.cos(ph) * R0);
          hood.uv.push((c / NC) * 4, (r / NH) * 3);
          // Pinned: it lies on the shoulders, and loose it sank through them.
          hood.maxD.push(0);
          hood.region.push(2);
          continue;
        }
        const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.sin(th), Math.cos(ph) * Math.cos(th));
        ray.set(Hc, dir);
        const hit = hset.bvh.raycastFirst(ray, THREE.DoubleSide);
        // Where there is no skull to hit (a veiled head keeps only its face), the head's ellipsoid.
        const ell = 1 / Math.sqrt((dir.x / M.head.rx) ** 2 + (dir.y / ((M.head.top - Hc.y) * 1.02)) ** 2 + (dir.z / M.head.rz) ** 2);
        let d = hit ? hit.distance : 0.13;
        if (spec.hood === 'cowl') {
          // The cowl stands clear of the whole head, ears and all: the outermost surface along the ray.
          ray.set(Hc.clone().addScaledVector(dir, 0.3), dir.clone().negate());
          const o = S.all.bvh.raycastFirst(ray, THREE.DoubleSide);
          if (o && th > -0.45) d = Math.max(d, 0.3 - o.distance);
        }
        if (th > -0.45 && (!hit || hit.distance > ell * 1.3)) d = ell;
        let off = th > -0.45 ? H.off : THREE.MathUtils.lerp(H.off * 0.75, H.off, (th + 1.22) / 0.77);
        if (th > -0.45) d = Math.max(d, H.minD);
        let dph = ph - Math.PI;
        off += H.point * Math.exp(-(dph * dph) / 0.28 - Math.pow(th - 0.75, 2) / 0.1);
        if (th < -0.5) off += (-0.5 - th) * H.cape + Math.sin(ph * 9 + 0.7) * 0.012 * (-0.5 - th);
        const p = Hc.clone().addScaledVector(dir, d + off);
        hr.push(d + off);
        hdir.push(dir);
        const edge = Math.min(c, NC - 1 - c);
        if (th > -0.5) p.z += H.brim * Math.exp(-(edge * edge) / 3) * ss(-0.5, -0.2, th);
        hood.pos.push(p.x, p.y, p.z);
        hood.uv.push((c / NC) * 4, (r / NH) * 3);
        const capelet = THREE.MathUtils.smoothstep(-th, 0.75, 1.2);
        dph = Math.abs(ph - Math.PI);
        hood.maxD.push(H.drape * capelet + (H.point ? 0.035 : 0) * Math.exp(-(dph * dph) / 0.3 - Math.pow(th - 0.8, 2) / 0.1));
        hood.region.push(2);
      }
    }
    if (hb) {
      // Smoothed over ears and jaw, so it falls in folds, not in shards.
      const sm = Float32Array.from(hr);
      for (let it = 0; it < 3; it++) {
        const o = Float32Array.from(sm);
        for (let r = 0; r < NH; r++) for (let c = 0; c < NC; c++) {
          let a = 0, n = 0;
          for (const [dr, dc] of [[0, 0], [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= NH || cc < 0 || cc >= NC) continue;
            a += o[rr * NC + cc]; n++;
          }
          sm[r * NC + c] = a / n;
        }
      }
      for (let i = 0; i < NH * NC; i++) {
        const k = sm[i] - hr[i];
        hood.pos[i * 3] += hdir[i].x * k; hood.pos[i * 3 + 1] += hdir[i].y * k; hood.pos[i * 3 + 2] += hdir[i].z * k;
      }
    }
  }

  // --- Fit pass: push every garment vertex out of the body.
  const tmp = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 } as { point: THREE.Vector3; distance: number; faceIndex: number };
  const tri = new THREE.Triangle(), nrm = new THREE.Vector3(), vv = new THREE.Vector3();
  const setFor = (reg: number) => (reg === 0 ? S.trunk : reg === 1 ? S.arms : reg === 2 ? (spec.hood === 'hood' ? S.noBeard().upper : S.upper) : reg === 3 ? S.torso : S.shoulders);
  const fit = (g: Grid, minOff: number, skipAbove = Infinity) => {
    for (let i = 0; i < g.pos.length / 3; i++) {
      vv.fromArray(g.pos, i * 3);
      if (vv.y > skipAbove) continue;
      const fs = setFor(g.region[i]);
      fs.bvh.closestPointToPoint(vv, tmp);
      const ix = fs.geo.index!;
      const a = ix.getX(tmp.faceIndex * 3), b = ix.getX(tmp.faceIndex * 3 + 1), c = ix.getX(tmp.faceIndex * 3 + 2);
      tri.a.fromArray(P, a * 3); tri.b.fromArray(P, b * 3); tri.c.fromArray(P, c * 3);
      tri.getNormal(nrm);
      const dist = vv.clone().sub(tmp.point).dot(nrm);
      if (dist < minOff) vv.copy(tmp.point).addScaledVector(nrm, minOff);
      vv.toArray(g.pos, i * 3);
    }
  };
  // Tubes (the tunic, the sleeves) are pushed out along their own radius, to
  // the outermost body surface a ray from outside meets. The closest-point
  // normal is no use here: the body's outfit is layered, with inward-facing
  // linings, and near the cut-away shoulders the closest face can point any
  // way, which threw single vertices across their neighbours (shards).
  const out = new THREE.Vector3(), o2 = new THREE.Vector3();
  const fitRadial = (g: Grid, centre: (i: number, c: THREE.Vector3) => THREE.Vector3, fs: FitSet, minOff: number, reach: number) => {
    const c = new THREE.Vector3();
    for (let i = 0; i < g.pos.length / 3; i++) {
      vv.fromArray(g.pos, i * 3);
      centre(i, c);
      out.copy(vv).sub(c);
      const r0 = out.length();
      if (r0 < 1e-6) continue;
      out.divideScalar(r0);
      ray.set(o2.copy(c).addScaledVector(out, reach), out.clone().negate());
      const hit = fs.bvh.raycastFirst(ray, THREE.DoubleSide);
      if (!hit) continue;
      const rb = reach - hit.distance;
      if (r0 < rb + minOff) vv.copy(c).addScaledVector(out, rb + minOff).toArray(g.pos, i * 3);
    }
  };
  {
    // Rows of the yoke reach over the shoulders; the rest only the trunk.
    const yoke = new Grid(0, NA, true), body = new Grid(0, NA, true);
    tunic.pos.forEach((v, j) => (tunic.region[Math.floor(j / 3)] === 4 ? yoke : body).pos.push(v));
    const rowOf = (off: number) => (i: number, c: THREE.Vector3) => { const r = Math.floor(i / NA) + off; return c.set(cen[r].x, ringY(r), cen[r].y); };
    const nYoke = yoke.pos.length / 3 / NA;
    fitRadial(yoke, rowOf(0), S.shoulders, 0.02, 0.7);
    fitRadial(body, rowOf(nYoke), S.trunk, 0.018, 0.7);
    tunic.pos = [...yoke.pos, ...body.pos];
    // The neckline: the top row closes in round the base of the neck, a little lower in front.
    const nk = bone('Neck'), neckR = new Float32Array(NA);
    for (let k = 0; k < NA; k++) {
      const a = (k / NA) * Math.PI * 2, d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      ray.set(o2.set(nk.x, nk.y + 0.015, nk.z).addScaledVector(d, 0.3), d.negate());
      const hit = S.all.bvh.raycastFirst(ray, THREE.DoubleSide);
      neckR[k] = hit && hit.distance < 0.27 ? 0.3 - hit.distance : 0.06;
    }
    smooth(neckR, NA, true, 2);
    for (let k = 0; k < NA; k++) {
      const a = (k / NA) * Math.PI * 2, rn = neckR[k] + 0.02;
      tunic.pos.splice(k * 3, 3, nk.x + Math.sin(a) * rn, nk.y - 0.008 - 0.03 * Math.max(0, Math.cos(a)) ** 2, nk.z + Math.cos(a) * rn);
    }
    // Between it and the armpit row the yoke turns over the shoulder in a
    // quarter ellipse, then is laid onto the body wherever that rises higher.
    const N0 = new THREE.Vector3(), E0 = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0), d = new THREE.Vector3();
    for (let r = 1; r < nYoke - 1; r++) {
      const t = (r / (nYoke - 1)) * Math.PI / 2, h = Math.sin(t), v = 1 - Math.cos(t);
      for (let k = 0; k < NA; k++) {
        N0.fromArray(tunic.pos, k * 3);
        E0.fromArray(tunic.pos, ((nYoke - 1) * NA + k) * 3);
        tunic.pos.splice((r * NA + k) * 3, 3, N0.x + (E0.x - N0.x) * h, N0.y + (E0.y - N0.y) * v, N0.z + (E0.z - N0.z) * h);
      }
    }
    for (let r = 0; r < nYoke; r++) {
      const ys = new Float32Array(NA);
      for (let k = 0; k < NA; k++) {
        vv.fromArray(tunic.pos, (r * NA + k) * 3);
        if (r > 0) {
          // Out of the body, seen from the neck...
          d.set(vv.x - nk.x, 0, vv.z - nk.z);
          const rr = d.length();
          d.divideScalar(rr || 1);
          ray.set(o2.set(nk.x, vv.y, nk.z).addScaledVector(d, 0.6), d.clone().negate());
          const hit = S.shoulders.bvh.raycastFirst(ray, THREE.DoubleSide);
          if (hit && 0.6 - hit.distance + 0.018 > rr) vv.set(nk.x, vv.y, nk.z).addScaledVector(d, 0.6 - hit.distance + 0.018);
        }
        // ...and from above.
        ray.set(o2.set(vv.x, vv.y + 0.4, vv.z), down);
        const hit = S.shoulders.bvh.raycastFirst(ray, THREE.DoubleSide);
        if (hit && hit.point.y + 0.016 > vv.y) vv.y = hit.point.y + 0.016;
        vv.toArray(tunic.pos, (r * NA + k) * 3);
        ys[k] = vv.y;
      }
      // Smoothed round, so no single column stands up in a spike.
      smooth(ys, NA, true, 2);
      for (let k = 0; k < NA; k++) tunic.pos[(r * NA + k) * 3 + 1] = ys[k];
    }
  }
  for (const g of sleeves) {
    const ax = (g as Grid & { axis: THREE.Vector3[] }).axis;
    fitRadial(g, (i, c) => c.copy(ax[Math.floor(i / g.cols)]), S.arms, bell ? 0.022 : 0.014, 0.16);
    // Its top tucks in under the yoke rather than standing open above the shoulder.
    for (const [r, k] of [[0, 0.55], [1, 0.85]]) for (let c = 0; c < g.cols; c++) {
      const o = (r * g.cols + c) * 3;
      vv.fromArray(g.pos, o).sub(ax[r]).multiplyScalar(k).add(ax[r]).toArray(g.pos, o);
    }
  }
  // Keep the belt on the fitted cloth.
  for (let r = 0; r < NR; r++) for (let k = 0; k < NA; k++) {
    const o = (r * NA + k) * 3;
    rad[r][k] = Math.hypot(tunic.pos[o] - cen[r].x, tunic.pos[o + 2] - cen[r].y);
  }
  // A head kept without its skull has nothing to push the hood out of above the jaw.
  if (hood && spec.hood === 'hood') fit(hood, 0.03, M.head.skull ? Infinity : bone('Head').y);
  if (hood && spec.hood === 'cowl') {
    // Below the jaw the cowl is a capelet lying over the tunic's shoulders,
    // not a ring through its collar: the rows under the face are laid, from
    // the neck outwards, onto whatever is outermost there (tunic, sleeves,
    // body), a short collar round the base of the neck.
    const under = new MeshBVH(mergeGeometries([gridGeometry(tunic), ...sleeves.map(gridGeometry), S.all.geo.clone()].map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
      return n;
    })));
    const nk = bone('Neck'), NC = hood.cols, top = 6, yBot = nk.y - 0.06;
    const R = new Float32Array(NC), Y = new Float32Array(NC), PH = new Float32Array(NC), P6 = new THREE.Vector3();
    for (let r = top - 1; r >= 0; r--) {
      const s = r / top;
      // Closed under the chin but for a slit: the row's own opening, as the hood's rows have.
      const th = -1.22 + 2.72 * (r / (hood.rows - 1));
      const open = th < -0.62 ? 0.2 : THREE.MathUtils.lerp(0.2, HOODS.cowl.mid, (th + 0.62) / 0.2);
      for (let c = 0; c < NC; c++) {
        P6.fromArray(hood.pos, (top * NC + c) * 3);
        const ph = open + (Math.PI * 2 - 2 * open) * (c / (NC - 1)), R6 = Math.hypot(P6.x - nk.x, P6.z - nk.z);
        const y = yBot + (P6.y - yBot) * Math.pow(s, 0.8);
        const d = new THREE.Vector3(Math.sin(ph), 0, Math.cos(ph));
        ray.set(o2.set(nk.x, y, nk.z).addScaledVector(d, 0.6), d.clone().negate());
        const hit = under.raycastFirst(ray, THREE.DoubleSide);
        const out = hit ? 0.6 - hit.distance : 0.08;
        R[c] = Math.max(out + 0.03 + 0.015 * (1 - s), 0.085 + (R6 - 0.085) * s * s);
        Y[c] = y; PH[c] = ph;
      }
      smooth(R, NC, false, 2);
      for (let c = 0; c < NC; c++) {
        hood.pos.splice((r * NC + c) * 3, 3, nk.x + Math.sin(PH[c]) * R[c], Y[c], nk.z + Math.cos(PH[c]) * R[c]);
        hood.maxD[r * NC + c] = 0;
      }
    }
  }

  const tunicGeo = gridGeometry(tunic);
  const tunicBVH = new MeshBVH(tunicGeo);
  // A layman's hood: its cape lies over the tunic's shoulders, not under them.
  const hoodBase = (tunic.pos.length + sleeves.reduce((a, g) => a + g.pos.length, 0)) / 3;
  let hoodOver: { bvh: MeshBVH; geo: THREE.BufferGeometry } | null = null;
  if (hood && spec.hood === 'hood') {
    const geo = mergeGeometries([tunicGeo, ...sleeves.map(gridGeometry)])!;
    hoodOver = { bvh: new MeshBVH(geo), geo };
    // The rows below the neck are laid round the shoulders, ring by ring
    // down to the top of the arms, on the tunic and sleeves.
    const nk = bone('Neck'), NC = hood.cols, d = new THREE.Vector3();
    let R0 = 0;
    while (-1.22 + 2.72 * ((R0 + 1) / (hood.rows - 1)) < -0.45) R0++;
    const yCape = yYoke - 0.05, jaw = bone('Head').y;
    // How far out the tunic reaches, a little above and below too: the rows are far apart.
    const clear = (y: number) => {
      let rb = 0;
      for (const dy of [-0.04, -0.02, 0, 0.02, 0.04]) {
        ray.set(o2.set(nk.x, y + dy, nk.z).addScaledVector(d, 0.6), d.clone().negate());
        const hit = hoodOver!.bvh.raycastFirst(ray, THREE.DoubleSide);
        if (hit) rb = Math.max(rb, 0.6 - hit.distance);
      }
      return rb;
    };
    for (let r = hood.rows - 1; r >= 0; r--) for (let c = 0; c < NC; c++) {
      const i = r * NC + c, u = (R0 + 1 - r) / (R0 + 1);
      vv.fromArray(hood.pos, i * 3);
      // Columns round the neck, evenly: those of the rays from the head bunch up at the sides.
      const ang = (x: number, z: number) => { const t = Math.atan2(x - nk.x, z - nk.z); return t < 0 ? t + Math.PI * 2 : t; };
      const ph = r > R0 ? ang(vv.x, vv.z) : THREE.MathUtils.lerp(ang(hood.pos[((R0 + 1) * NC + c) * 3], hood.pos[((R0 + 1) * NC + c) * 3 + 2]), 0.05 + (Math.PI * 2 - 0.1) * (c / (NC - 1)), Math.sqrt(u));
      d.set(Math.sin(ph), 0, Math.cos(ph));
      if (r > R0) {
        // The neck of the hood, where it comes down onto the shoulders: only out of the tunic.
        if (vv.y > jaw) continue;
        const rb = clear(vv.y), rr = Math.hypot(vv.x - nk.x, vv.z - nk.z);
        if (rb && rr < rb + 0.022) vv.set(nk.x, vv.y, nk.z).addScaledVector(d, rb + 0.022).toArray(hood.pos, i * 3);
        continue;
      }
      const yN = hood.pos[((R0 + 1) * NC + c) * 3 + 1];
      const y = THREE.MathUtils.lerp(yN, yCape + 0.05 * Math.pow(Math.sin(ph), 4), Math.pow(u, 0.85));
      const rb = clear(y);
      if (!rb) continue;
      const a = Math.atan2(d.x, d.z);
      // Roomier over the shoulder points, where the sleeve heads rise as the arms come up.
      const R = rb + 0.026 + (0.02 + 0.025 * Math.pow(Math.sin(a), 4)) * u + Math.sin(a * 9 + 0.7) * 0.006 * u;
      vv.set(nk.x, y, nk.z).addScaledVector(d, R);
      vv.toArray(hood.pos, i * 3);
    }
  }
  if (hood && spec.hood === 'veil') {
    // The veil's fall lies on the tunic: each column, from the jaw down,
    // keeps clear of the tunic and body seen from the head's axis and never
    // tucks back in (cloth hangs, it does not cling). Rays, not closest
    // points: those threw single vertices about.
    const ax = M.head.c, NHh = hood.rows, NCh = hood.cols;
    const rJ = Math.floor(((VEIL_J + 1.22) / 2.72) * (NHh - 1));
    const d = new THREE.Vector3();
    for (let c = 0; c < NCh; c++) {
      let prev = 0;
      for (let r = rJ + 1; r >= 0; r--) {
        const o = (r * NCh + c) * 3;
        vv.fromArray(hood.pos, o);
        d.set(vv.x - ax.x, 0, vv.z - ax.z);
        let R = d.length();
        d.divideScalar(R || 1);
        if (r <= rJ) {
          let need = 0;
          for (const [b, gap] of [[tunicBVH, 0.02], [S.all.bvh, 0.045]] as const) {
            ray.set(o2.set(ax.x, vv.y, ax.z).addScaledVector(d, 0.6), d.clone().negate());
            const hit = b.raycastFirst(ray, THREE.DoubleSide);
            if (hit) need = Math.max(need, 0.6 - hit.distance + gap);
          }
          R = Math.max(R, need, prev - 0.002);
          vv.set(ax.x + d.x * R, vv.y, ax.z + d.z * R).toArray(hood.pos, o);
        }
        prev = R;
      }
    }
  }

  // --- Scapular: front and back panels over the tunic (monks).
  const scap: Grid[] = [];
  if (spec.scapular) for (const face of [1, -1]) {
    const NX = 6, NY = 22;
    const g = new Grid(NY, NX, false);
    g.cap = CAP_SKIRT;
    const yA = spine2.y + 0.02, yB = 0.34;
    for (let r = 0; r < NY; r++) {
      const y = yA + (yB - yA) * (r / (NY - 1));
      for (let c = 0; c < NX; c++) {
        const x = -0.165 + 0.33 * (c / (NX - 1));
        // It hangs flat across the tunic's folds: over the outermost of them nearby.
        let z = face * 0.15;
        for (let k = 0; k < 21; k++) {
          // (Above the cord, also over the tunic's blousing between this row and the next.)
          const dy = y > yBelt + 0.012 ? ((k % 3) - 1) * 0.022 : 0;
          ray.set(new THREE.Vector3(x + (Math.floor(k / 3) - 3) * 0.016, y + dy, face * 1.2), new THREE.Vector3(0, 0, -face));
          const hit = tunicBVH.raycastFirst(ray, THREE.DoubleSide);
          if (hit && (k === 0 || face * hit.point.z > face * z)) z = hit.point.z;
        }
        // Clear of the tunic's folds; drawn in under the cord at the waist.
        const off = THREE.MathUtils.lerp(0.007, y < yBelt ? 0.03 : 0.022, ss(0.012, 0.04, Math.abs(y - yBelt)));
        g.pos.push(x, y, z + face * off);
        g.uv.push(c / NX * 1.5, y * 4);
        g.maxD.push(y < yBelt - 0.05 ? 0.2 * Math.pow(ss(yBelt - 0.05, yB, y), 0.8) : 0);
        g.region.push(0);
      }
    }
    g.group = G_OVER;
    g.flip = face < 0;
    scap.push(g);
  }

  // --- Cloak (sagum) hanging from the shoulders down the back, or a shawl.
  let cape: Grid | null = null;
  if (spec.cape) {
    const long = spec.cape === 'cloak';
    // A close cloak is cut round the trunk, not round the arms held out in the bind pose.
    const close = !!spec.cloakClose;
    const under = mergeGeometries((close ? [tunicGeo, S.torso.geo.clone()] : [tunicGeo, ...sleeves.map(gridGeometry), ...(hood ? [gridGeometry(hood)] : []), S.all.geo.clone()]).map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
      return n;
    }));
    const ubvh = new MeshBVH(under);
    // A shawl stops clear above the sash: lower, the sash cut through it as she swayed.
    const yT = neck.y - 0.045, yB = long ? knee + 0.06 : yBelt + 0.085;
    const NR2 = long ? 28 : 16, NC2 = long ? 26 : 34, oL = spec.capeOpen ?? 0;
    const g = new Grid(NR2, NC2, false);
    g.group = G_OVER;
    g.cap = long ? CAP_CLOAK : CAP_SHAWL;
    const cx = hips.x, cz = hips.z - 0.01;
    const radii: number[][] = [];
    for (let r = 0; r < NR2; r++) {
      const t = r / (NR2 - 1);
      const y = yT + (yB - yT) * Math.pow(t, 0.9);
      const a0 = long ? THREE.MathUtils.lerp(0.36, 0.62, Math.pow(t, 0.6)) * Math.PI : THREE.MathUtils.lerp(0.16, 0.3, t) * Math.PI;
      const row: number[] = [];
      for (let c = 0; c < NC2; c++) {
        const a = a0 + oL + (Math.PI * 2 - 2 * a0 - oL) * (c / (NC2 - 1));
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        ray.set(new THREE.Vector3(cx, y, cz).addScaledVector(dir, 1.2), dir.clone().negate());
        const hit = ubvh.raycastFirst(ray, THREE.DoubleSide);
        let R = hit ? Math.hypot(hit.point.x - cx, hit.point.z - cz) : 0.15;
        // It hangs straight from the shoulder blades; it does not follow the small of the back.
        if (r > 0) R = Math.max(R, radii[r - 1][c] - 0.004);
        row.push(R);
      }
      radii.push(row);
    }
    for (let c = 0; c < NC2; c++) {
      const col = Float32Array.from(radii.map((row) => row[c]));
      smooth(col, NR2, false, 2);
      radii.forEach((row, r) => { row[c] = Math.max(row[c], col[r]); });
    }
    for (let r = 0; r < NR2; r++) {
      const t = r / (NR2 - 1);
      const y = yT + (yB - yT) * Math.pow(t, 0.9);
      const a0 = long ? THREE.MathUtils.lerp(0.36, 0.62, Math.pow(t, 0.6)) * Math.PI : THREE.MathUtils.lerp(0.16, 0.3, t) * Math.PI;
      const row = Float32Array.from(radii[r]);
      smooth(row, NC2, false, 5);
      for (let c = 0; c < NC2; c++) {
        const a = a0 + oL + (Math.PI * 2 - 2 * a0 - oL) * (c / (NC2 - 1));
        const fold = (Math.sin(a * 9 + fp + Math.sin(a * 2.3) * 1.4) * 0.6 + Math.sin(a * 5 + fp * 1.3) * 0.4) * t * (long ? 0.03 : 0.012);
        // Ease over the belt and round the swinging upper arms.
        const side = Math.exp(-Math.pow(Math.cos(a), 2) / 0.12) * (1 - t);
        let R = row[c] + 0.022 + t * (long ? 0.04 : 0.02) + fold + 0.02 * Math.exp(-Math.pow((y - yBelt) / 0.05, 2)) + 0.025 * side;
        // Room for the arms hanging inside it.
        if (close) R += 0.11 * Math.exp(-Math.pow(Math.cos(a) + 0.35, 2) / 0.5) * ss(yYoke + 0.08, yYoke - 0.04, y);
        g.pos.push(cx + Math.sin(a) * R, y, cz + Math.cos(a) * R);
        g.uv.push((c / NC2) * 3, t * (long ? 3 : 1.6));
        g.maxD.push(r < 2 ? 0 : (long ? 0.3 : 0.035) * Math.pow(ss(0, 1, t), 0.8));
        // A shawl is wrapped round the arms too: where it lies on them, it goes with them.
        g.region.push(y > yYoke - 0.03 || !long ? 4 : 3);
      }
    }
    // Over the shoulders it lies on the yoke, not in a level ring through it.
    const down = new THREE.Vector3(0, -1, 0);
    for (let r = 0; r < NR2 && g.pos[r * NC2 * 3 + 1] > yYoke - 0.08; r++) {
      const ys = new Float32Array(NC2);
      for (let c = 0; c < NC2; c++) {
        vv.fromArray(g.pos, (r * NC2 + c) * 3);
        ray.set(o2.set(vv.x, vv.y + 0.4, vv.z), down);
        const hit = ubvh.raycastFirst(ray, THREE.DoubleSide);
        ys[c] = hit ? Math.max(vv.y, hit.point.y + 0.02) : vv.y;
      }
      smooth(ys, NC2, false, 2);
      for (let c = 0; c < NC2; c++) {
        const o = (r * NC2 + c) * 3 + 1;
        g.pos[o] = r === 0 ? ys[c] : Math.min(Math.max(ys[c], g.pos[o]), g.pos[o - NC2 * 3] - 0.012);
      }
    }
    cape = g;
  }

  // --- Belt: a rope, a leather belt, or a wide sash.
  const NT = 36, NTH = spec.belt === 'rope' ? 6 : 8;
  const beltRing = new Grid(NTH, NT, true);
  let beltInfo: Garment['belt'];
  {
    const rr = rad.map((row, r) => ({ row, y: ringY(r) }));
    const ring = rr.reduce((m, x) => (Math.abs(x.y - yBelt) < Math.abs(m.y - yBelt) ? x : m));
    const rc = cen[rr.indexOf(ring)];
    const [ry, rz, gap] = spec.belt === 'rope' ? [0.011, 0.011, 0.021] : spec.belt === 'leather' ? [0.019, 0.005, 0.009] : [0.034, 0.01, 0.014];
    const Rat = (a: number) => ring.row[((Math.round((a / (Math.PI * 2)) * NA) % NA) + NA) % NA] + gap;
    for (let t = 0; t < NTH; t++) {
      for (let k = 0; k < NT; k++) {
        const a = (k / NT) * Math.PI * 2;
        const ta = (t / NTH) * Math.PI * 2;
        // Round for rope; a flattened, rounded rectangle for leather and cloth.
        const cs = Math.cos(ta), sn = Math.sin(ta);
        const e = spec.belt === 'rope' ? 1 : 0.35;
        const R = Rat(a) + Math.sign(cs) * Math.pow(Math.abs(cs), e) * rz + (spec.belt === 'sash' ? Math.sin(a * 13 + t) * 0.002 : 0);
        beltRing.pos.push(rc.x + Math.sin(a) * R, ring.y + Math.sign(sn) * Math.pow(Math.abs(sn), e) * ry, rc.y + Math.cos(a) * R);
        beltRing.uv.push(k / NT * (spec.belt === 'rope' ? 30 : 8), t / NTH);
        beltRing.maxD.push(0);
        beltRing.region.push(0);
      }
    }
    beltRing.group = G_BELT;
    beltRing.flip = true;
    beltInfo = { y: ring.y, cx: rc.x, cz: rc.y, r: (a: number) => Rat(a) + rz };
  }

  // --- Assemble one geometry: positions, uvs, colours, index, groups, constraints.
  const pieces: { g: Grid; wrapRows?: boolean }[] = [{ g: tunic }, ...sleeves.map((g) => ({ g })), ...(hood ? [{ g: hood }] : []), ...scap.map((g) => ({ g })), ...(cape ? [{ g: cape }] : []), { g: beltRing, wrapRows: true }];
  const pos: number[] = [], uv: number[] = [], col: number[] = [], maxD: number[] = [], region: number[] = [], capOf: number[] = [];
  const index: number[][] = [[], [], [], []];
  const E: number[] = [], ES: number[] = [];
  let ringStart = 0;
  const baseOf = new Map<Grid, number>();
  for (const { g, wrapRows } of pieces) {
    const base = pos.length / 3;
    baseOf.set(g, base);
    if (g === beltRing) ringStart = base;
    const n = g.pos.length / 3;
    for (let i = 0; i < n; i++) {
      pos.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
      uv.push(g.uv[i * 2], g.uv[i * 2 + 1]);
      // Mud and wear towards the hem.
      const y = g.pos[i * 3 + 1];
      const mud = g.group === G_BELT ? 0 : 1 - THREE.MathUtils.smoothstep(y, 0.06, 0.38);
      col.push(1 - mud * 0.35, 1 - mud * 0.42, 1 - mud * 0.5);
      maxD.push(g.maxD[i]);
      region.push(g.region[i]);
      capOf.push(g.cap);
    }
    const R = g.rows, C = g.cols;
    const id = (r: number, c: number) => base + ((r + R) % R) * C + ((c + C) % C);
    const cmax = g.wrap ? C : C - 1, rmax = wrapRows ? R : R - 1;
    for (let r = 0; r < rmax; r++) for (let c = 0; c < cmax; c++) {
      const a = id(r, c), b = id(r, c + 1), cc = id(r + 1, c), d = id(r + 1, c + 1);
      if (g.flip) index[g.group].push(a, b, cc, b, d, cc);
      else index[g.group].push(a, cc, b, b, cc, d);
    }
    if (g === beltRing) continue; // rigid
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
  const hipsI = bones.findIndex((b) => canon(b.name) === 'Hips');
  const upL = bones.findIndex((b) => canon(b.name) === 'LeftUpLeg'), upR = bones.findIndex((b) => canon(b.name) === 'RightUpLeg');
  let extraBones: Garment['extraBones'];
  for (let i = 0; i < N; i++) {
    const y = bind[i * 3 + 1];
    if (region[i] !== 0 || y > yBelt) continue;
    const m = wmap[i];
    if (spec.thighs) {
      // Hung from the pelvis and carried on by the thighs, shared out
      // smoothly from side to side: weighted to whichever leg was nearest,
      // the forward thigh came out through the front of the skirt.
      const k = ss(yBelt, yBelt - 0.3, y), f = ss(-0.07, 0.07, bind[i * 3] - hips.x), th = spec.thighs;
      for (const [b, w] of m) m.set(b, w * (1 - k));
      m.set(hipsI, (m.get(hipsI) ?? 0) + k * (1 - th));
      m.set(upL, (m.get(upL) ?? 0) + k * th * f);
      m.set(upR, (m.get(upR) ?? 0) + k * th * (1 - f));
      continue;
    }
    const t = (spec.trail ? 1 : 0.8) * ss(yBelt, yBelt - 0.3, y);
    for (const [k, w] of m) m.set(k, w * (1 - t));
    m.set(hipsI, (m.get(hipsI) ?? 0) + t);
  }
  if (spec.stride) {
    // A long skirt cannot hang from the pelvis alone: a striding knee would
    // come straight through it. Below the hip joints each side swings with
    // the thigh beneath it (the front and back centre with both), the rest
    // with the pelvis. Not with the thigh bones themselves: their twist would
    // wring the skirt round; with helper bones that copy only their swing.
    const upL = bones.length, upR = bones.length + 1;
    root.updateMatrixWorld(true);
    extraBones = SKIRT_BONES.map((n) => ({ name: n, inv: root.getObjectByName(n)!.matrixWorld.clone().invert() }));
    for (let i = 0; i < N; i++) {
      const y = bind[i * 3 + 1];
      if (region[i] !== 0 || y > yBelt) continue;
      const k = spec.stride * ss(hips.y + 0.02, knee + 0.05, y);
      const x = bind[i * 3] - hips.x, z = bind[i * 3 + 2] - hips.z;
      const sL = 0.5 + 0.5 * THREE.MathUtils.clamp(x / (Math.hypot(x, z) * 0.28 || 1), -1, 1);
      const m = wmap[i];
      for (const [b, w] of m) m.set(b, w * (1 - k));
      m.set(upL, (m.get(upL) ?? 0) + k * sL);
      m.set(upR, (m.get(upR) ?? 0) + k * (1 - sL));
    }
  }
  // A skirt over striding legs is pushed out by whichever thigh leads (and
  // trails): its front and back panels hang from two extra bones that swing
  // with them (driven in npc.ts), its sides from the pelvis.
  let skirt: Garment['skirt'];
  if (spec.legFollow) {
    const pivot = bone('LeftUpLeg').add(bone('RightUpLeg')).multiplyScalar(0.5);
    // After the stride bones, if any (npc.ts appends them in that order).
    const n0 = bones.length + (extraBones?.length ?? 0);
    skirt = { pivot, front: n0, back: n0 + 1 };
    for (let i = 0; i < N; i++) {
      const y = bind[i * 3 + 1];
      if (region[i] !== 0 || y > pivot.y) continue;
      const c = Math.cos(Math.atan2(bind[i * 3] - hips.x, bind[i * 3 + 2] - hips.z));
      const t = spec.legFollow * ss(pivot.y, pivot.y - 0.22, y) * Math.pow(Math.abs(c), 0.6);
      const m = wmap[i];
      for (const [k, w] of m) m.set(k, w * (1 - t));
      m.set(c > 0 ? skirt.front : skirt.back, t);
    }
  }
  // Hoods and veils sit on the skull: rigid with the head above the jaw.
  const headI = bones.findIndex((b) => canon(b.name) === 'Head');
  const jaw = bone('Head').y;
  for (let i = 0; i < N; i++) {
    if (region[i] !== 2) continue;
    const t = ss(jaw - 0.1, jaw + 0.02, bind[i * 3 + 1]);
    if (t <= 0) continue;
    const m = wmap[i];
    for (const [k, w] of m) m.set(k, w * (1 - t));
    m.set(headI, (m.get(headI) ?? 0) + t);
  }
  // A neckline sits on the shoulders; it does not nod with the head.
  {
    const spineI = bones.findIndex((b) => canon(b.name) === 'Spine2');
    const neckI = bones.findIndex((b) => canon(b.name) === 'Neck');
    for (let i = 0; i < N; i++) {
      if (region[i] === 2) continue;
      const m = wmap[i];
      for (const k of [neckI, headI]) {
        const w = m.get(k);
        if (!w || k < 0) continue;
        m.delete(k);
        m.set(spineI, (m.get(spineI) ?? 0) + w);
      }
    }
  }
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
  // Cloth on the inner side of a shoulder joint (the top of a sleeve, the
  // yoke by the neck) must not swing with the upper arm: lowering the arm
  // would lift it up round the neck. It goes with the collarbone instead.
  for (const side of ['Left', 'Right']) {
    const armI = bones.findIndex((b) => canon(b.name) === side + 'Arm');
    const clavI = bones.findIndex((b) => canon(b.name) === side + 'Shoulder');
    if (armI < 0 || clavI < 0) continue;
    const j = bone(side + 'Arm'), T = bone(side + 'ForeArm').sub(j).normalize();
    for (let i = 0; i < N; i++) {
      const m = wmap[i], w = m.get(armI);
      if (!w) continue;
      const along = (bind[i * 3] - j.x) * T.x + (bind[i * 3 + 1] - j.y) * T.y + (bind[i * 3 + 2] - j.z) * T.z;
      const t = ss(0.03, -0.03, along) * w;
      if (t <= 0) continue;
      m.set(armI, w - t);
      m.set(clavI, (m.get(clavI) ?? 0) + t);
    }
  }
  // Limbs move the cloth through their twist-free stand-ins (see addSwingBones).
  if (spec.swing) {
    const at = (n: string) => bones.findIndex((b) => canon(b.name) === n);
    const sw = new Map<number, number>();
    for (const n of SWING) sw.set(at(n), at(n + '_swing'));
    for (const side of ['Left', 'Right']) sw.set(at(side + 'Hand'), at(side + 'ForeArm_swing'));
    sw.delete(-1);
    for (const m of wmap) for (const [k, w] of [...m]) {
      const s = sw.get(k);
      if (s === undefined || s < 0) continue;
      m.delete(k);
      m.set(s, (m.get(s) ?? 0) + w);
    }
  }
  // Under the cape, the yoke's back and breast need not swing with the arms
  // (reaching forward, they rose through it): only out at the shoulder points.
  if (hood && hoodOver) {
    const nk = bone('Neck');
    for (const side of ['Left', 'Right']) {
      const armI = bones.findIndex((b) => canon(b.name) === side + 'Arm' + (spec.swing ? '_swing' : ''));
      const clavI = bones.findIndex((b) => canon(b.name) === side + 'Shoulder');
      if (armI < 0 || clavI < 0) continue;
      for (let i = 0; i < hoodBase; i++) {
        const m = wmap[i], w = m.get(armI);
        if (!w || bind[i * 3 + 1] < yYoke - 0.08) continue;
        const k = 0.75 * ss(0.19, 0.12, Math.abs(bind[i * 3] - nk.x));
        m.set(armI, w * (1 - k));
        m.set(clavI, (m.get(clavI) ?? 0) + w * k);
      }
    }
  }
  // ...and below the neck moves with them: its weights are the tunic's beneath it.
  if (hood && hoodOver) {
    const ix = tunicGeo.index!, ny = bone('Neck').y; // the tunic's yoke, not the sleeve tops tucked under it
    for (let i = hoodBase; i < hoodBase + hood.pos.length / 3; i++) {
      vv.fromArray(bind, i * 3);
      const t = ss(ny, ny + 0.08, vv.y);
      if (t >= 1) continue;
      tunicBVH.closestPointToPoint(vv, tmp);
      const vs = [ix.getX(tmp.faceIndex * 3), ix.getX(tmp.faceIndex * 3 + 1), ix.getX(tmp.faceIndex * 3 + 2)];
      tri.a.fromArray(bind, vs[0] * 3); tri.b.fromArray(bind, vs[1] * 3); tri.c.fromArray(bind, vs[2] * 3);
      const bc = tri.getBarycoord(tmp.point, new THREE.Vector3()) ?? new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
      const m = new Map<number, number>();
      [bc.x, bc.y, bc.z].forEach((w, j) => { for (const [k, x] of wmap[vs[j]]) m.set(k, (m.get(k) ?? 0) + x * w * (1 - t)); });
      for (const [k, x] of wmap[i]) m.set(k, (m.get(k) ?? 0) + x * t);
      wmap[i] = m;
    }
  }
  // A close cloak moves with the tunic beneath it, so neither the shoulders nor
  // the skirt pushed back by a stride come through it; less so towards the hem.
  if (cape && spec.cloakClose) {
    const base = hoodBase + (hood ? hood.pos.length / 3 : 0) + scap.reduce((a, g) => a + g.pos.length / 3, 0);
    const ix = tunicGeo.index!;
    for (let i = base; i < base + cape.pos.length / 3; i++) {
      vv.fromArray(bind, i * 3);
      const t = 1 - 0.35 * ss(yBelt, yHem, vv.y);
      if (t <= 0) continue;
      tunicBVH.closestPointToPoint(vv, tmp);
      const vs = [ix.getX(tmp.faceIndex * 3), ix.getX(tmp.faceIndex * 3 + 1), ix.getX(tmp.faceIndex * 3 + 2)];
      tri.a.fromArray(bind, vs[0] * 3); tri.b.fromArray(bind, vs[1] * 3); tri.c.fromArray(bind, vs[2] * 3);
      const bc = tri.getBarycoord(tmp.point, new THREE.Vector3()) ?? new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
      const m = new Map<number, number>();
      [bc.x, bc.y, bc.z].forEach((w, j) => { for (const [k, x] of wmap[vs[j]]) m.set(k, (m.get(k) ?? 0) + x * w * t); });
      for (const [k, x] of wmap[i]) m.set(k, (m.get(k) ?? 0) + x * (1 - t));
      wmap[i] = m;
    }
  }
  // Cloth worn over cloth (the scapular over the tunic) moves as the cloth
  // beneath it does, or the two cut through each other wherever their weights differ.
  let ride: Int32Array | undefined;
  if (spec.scapular || spec.hood === 'cowl') {
    ride = new Int32Array(N).fill(-1);
    const range = (g: Grid) => { const b = baseOf.get(g)!; return Array.from({ length: g.pos.length / 3 }, (_, k) => b + k); };
    const tunicIx = range(tunic);
    const near3 = (i: number, cand: number[]) => {
      const best: [number, number][] = [];
      for (const j of cand) {
        const d = (bind[i * 3] - bind[j * 3]) ** 2 + (bind[i * 3 + 1] - bind[j * 3 + 1]) ** 2 + (bind[i * 3 + 2] - bind[j * 3 + 2]) ** 2;
        if (best.length < 3 || d < best[2][1]) { best.push([j, d]); best.sort((a, b) => a[1] - b[1]); if (best.length > 3) best.pop(); }
      }
      return best;
    };
    // The weights of the tunic just beneath: where a ray in towards the body
    // meets it (barycentric on that face), else its nearest three vertices.
    const bc = new THREE.Vector3(), rp = new THREE.Vector3(), rd = new THREE.Vector3();
    const follow = (i: number, cand: number[], f: number, dir: THREE.Vector3 | null) => {
      let src: [number, number][] = [];
      if (dir) {
        ray.set(rp.fromArray(bind, i * 3), rd.copy(dir));
        const hit = tunicBVH.raycastFirst(ray, THREE.DoubleSide);
        if (hit && hit.distance < 0.12 && hit.faceIndex != null) {
          const ix = tunicGeo.index!, P0 = tunicGeo.attributes.position;
          const vs = [ix.getX(hit.faceIndex * 3), ix.getX(hit.faceIndex * 3 + 1), ix.getX(hit.faceIndex * 3 + 2)];
          tri.a.fromBufferAttribute(P0, vs[0]); tri.b.fromBufferAttribute(P0, vs[1]); tri.c.fromBufferAttribute(P0, vs[2]);
          tri.getBarycoord(hit.point, bc);
          src = vs.map((v, k) => [baseOf.get(tunic)! + v, Math.max(0, bc.getComponent(k))] as [number, number]);
        }
      }
      if (!src.length) src = near3(i, cand).map(([j, d]) => [j, 1 / (Math.sqrt(d) + 0.005)]);
      const o = new Map<number, number>();
      for (const [j, w] of src) {
        const tot = [...wmap[j].values()].reduce((x, y) => x + y, 0) || 1;
        for (const [k, x] of wmap[j]) o.set(k, (o.get(k) ?? 0) + (x / tot) * w);
      }
      const sw = [...o.values()].reduce((x, y) => x + y, 0) || 1;
      const m = wmap[i], mt = [...m.values()].reduce((x, y) => x + y, 0) || 1;
      for (const [k, x] of m) m.set(k, (x / mt) * (1 - f));
      for (const [k, x] of o) m.set(k, (m.get(k) ?? 0) + (x / sw) * f);
      return src.reduce((x, y) => (y[1] > x[1] ? y : x))[0];
    };
    for (const g of scap) for (const i of range(g)) { ride[i] = follow(i, tunicIx, 1, new THREE.Vector3(0, 0, g.flip ? 1 : -1)); maxD[i] = 0; }
    // The capelet rides on the chest and the collarbones, never on the arms:
    // swinging with them it would fold up over the shoulders.
    if (hood && spec.hood === 'cowl') {
      const sp = bones.findIndex((b) => canon(b.name) === 'Spine2'), cl = bones.findIndex((b) => canon(b.name) === 'LeftShoulder'), cr = bones.findIndex((b) => canon(b.name) === 'RightShoulder');
      const nk = bone('Neck');
      for (const i of range(hood)) {
        const f = ss(jaw - 0.06, jaw - 0.13, bind[i * 3 + 1]);
        if (f <= 0) continue;
        const x = bind[i * 3] - nk.x, a = 0.25 * ss(0.04, 0.16, Math.abs(x));
        const m = wmap[i], mt = [...m.values()].reduce((p, q) => p + q, 0) || 1;
        for (const [k, w] of m) m.set(k, (w / mt) * (1 - f));
        m.set(sp, (m.get(sp) ?? 0) + f * (1 - a));
        const c = x > 0 ? cl : cr;
        m.set(c, (m.get(c) ?? 0) + f * a);
      }
    }
  }
  // A cloak skinned from the body bends differently from the tunic under it,
  // and the tunic shows through wherever the back or the hips bend; and where
  // it falls over the arms it must come down with them. Take the weights of
  // the tunic or sleeve at the nearest point beneath instead.
  if (cape && spec.capeOnTunic) {
    const c0 = baseOf.get(cape)!, n = cape.pos.length / 3, tix: number[] = [];
    for (const g of [tunic, ...sleeves]) {
      const b = baseOf.get(g)!, C = g.cols;
      for (let r = 0; r < g.rows - 1; r++) for (let c = 0; c < (g.wrap ? C : C - 1); c++) {
        const a = b + r * C + c, b2 = b + r * C + ((c + 1) % C);
        tix.push(a, a + C, b2, b2, a + C, b2 + C);
      }
    }
    const ug = new THREE.BufferGeometry();
    ug.setAttribute('position', new THREE.BufferAttribute(bind, 3));
    ug.setIndex(tix);
    const ubvh = new MeshBVH(ug), uix = ug.index!;
    for (let i = c0; i < c0 + n; i++) {
      ubvh.closestPointToPoint(vv.fromArray(bind, i * 3), tmp);
      const vs = [uix.getX(tmp.faceIndex * 3), uix.getX(tmp.faceIndex * 3 + 1), uix.getX(tmp.faceIndex * 3 + 2)];
      tri.a.fromArray(bind, vs[0] * 3); tri.b.fromArray(bind, vs[1] * 3); tri.c.fromArray(bind, vs[2] * 3);
      const bc = tri.getBarycoord(tmp.point, new THREE.Vector3()) ?? new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
      const m = new Map<number, number>();
      [bc.x, bc.y, bc.z].forEach((w, j) => { for (const [k, x] of wmap[vs[j]]) m.set(k, (m.get(k) ?? 0) + x * w); });
      wmap[i] = m;
    }
    // Eased between the arms and the back, so it drapes rather than tears.
    for (let it = 0; it < 8; it++) {
      const next = new Map<number, Map<number, number>>();
      for (let i = c0; i < c0 + n; i++) {
        const o = new Map<number, number>();
        const add = (src: Map<number, number>, f: number) => { for (const [k, w] of src) o.set(k, (o.get(k) ?? 0) + w * f); };
        add(wmap[i], 2);
        for (const j of nb[i]) add(wmap[j], 1);
        const sum = [...o.values()].reduce((a, b) => a + b, 0);
        for (const [k, w] of o) o.set(k, w / sum);
        next.set(i, o);
      }
      for (const [i, o] of next) wmap[i] = o;
    }
  }
  const skinI = new Uint16Array(N * 4), skinW = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const top = [...wmap[i]].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0) || 1;
    top.forEach(([k, w], j) => { skinI[i * 4 + j] = k; skinW[i * 4 + j] = w / sum; });
  }

  const fe: number[] = [], fr: number[] = [], fsf: number[] = [];
  for (let e = 0; e < ES.length; e++) {
    const a = E[e * 2], b = E[e * 2 + 1];
    if (maxD[a] === 0 && maxD[b] === 0) continue;
    fe.push(a, b);
    fr.push(Math.hypot(bind[a * 3] - bind[b * 3], bind[a * 3 + 1] - bind[b * 3 + 1], bind[a * 3 + 2] - bind[b * 3 + 2]));
    fsf.push(ES[e]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinI, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinW, 4));
  const all: number[] = [];
  index.forEach((ix, gi) => { if (ix.length) geo.addGroup(all.length, ix.length, gi); all.push(...ix); });
  geo.setIndex(all);
  geo.computeVertexNormals();

  let rope: Garment['rope'] = null;
  if (spec.tail) {
    const knot = new THREE.Vector3(-0.09, yBelt - 0.01, 0);
    ray.set(new THREE.Vector3(-0.09, yBelt, 1), new THREE.Vector3(0, 0, -1));
    const hit = tunicBVH.raycastFirst(ray, THREE.DoubleSide);
    knot.z = (hit ? hit.point.z : 0.15) + 0.03;
    let knotI = ringStart, bd = Infinity;
    for (let i = ringStart; i < N; i++) {
      const d = (bind[i * 3] - knot.x) ** 2 + (bind[i * 3 + 1] - knot.y) ** 2 + (bind[i * 3 + 2] - knot.z) ** 2;
      if (d < bd) { bd = d; knotI = i; }
    }
    rope = { root: knotI, n: 12, seg: 0.05 };
  }
  const capMask = new Uint16Array(N), keepOut = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (maxD[i] > 0) { capMask[i] = capOf[i]; keepOut[i] = capOf[i] === CAP_CLOAK || capOf[i] === CAP_SHAWL || (hoodOver && i >= hoodBase && i < hoodBase + hood!.pos.length / 3) ? 1 : 0; }
  return { geo, bind, skinI, skinW, capMask, keepOut, maxD: new Float32Array(maxD), edges: new Uint32Array(fe), rest: new Float32Array(fr), stiff: new Float32Array(fsf), rope, belt: beltInfo, ride, extraBones, skirt };
}

/** Skirt helper bones (see GarmentSpec.stride), at the hip joints, children of the pelvis. */
export const SKIRT_BONES = ['SkirtL', 'SkirtR'];
export function addSkirtBones(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  let hips: THREE.Object3D | undefined;
  const legs: Record<string, THREE.Object3D> = {};
  root.traverse((o) => { const n = canon(o.name); if (n === 'Hips' && !hips) hips = o; if (n === 'LeftUpLeg' || n === 'RightUpLeg') legs[n] = o; });
  if (!hips || root.getObjectByName(SKIRT_BONES[0])) return;
  const hq = hips.getWorldQuaternion(new THREE.Quaternion()).invert();
  SKIRT_BONES.forEach((n, i) => {
    const b = new THREE.Bone();
    b.name = n;
    b.position.copy(hips!.worldToLocal(legs[i ? 'RightUpLeg' : 'LeftUpLeg'].getWorldPosition(new THREE.Vector3())));
    b.quaternion.copy(hq);
    hips!.add(b);
  });
  root.updateMatrixWorld(true);
}

/**
 * Faces deep in a hood: bake how much of the sky each head vertex sees past
 * the garment into vertex colours.
 */
export function bakeHeadShade(root: THREE.Object3D, garmentGeo: THREE.BufferGeometry, floor = 0.1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', garmentGeo.attributes.position.clone());
  g.setIndex(garmentGeo.index!.clone());
  const bvh = new MeshBVH(g);
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const u = (i + 0.5) / 24, a = i * 2.39996;
    const y = 0.15 + 0.85 * u, r = Math.sqrt(1 - y * y);
    dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r + 0.35).normalize());
  }
  const ray = new THREE.Ray(), v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible || /Footwear|Bottom/.test(m.name)) return;
    const n = m.geometry.attributes.position.count;
    const col = new Float32Array(n * 3).fill(1);
    const cls = boneClassOf(m);
    for (let i = 0; i < n; i++) {
      if (cls[i] !== 'head') continue;
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld);
      let open = 0;
      for (const d of dirs) {
        ray.origin.copy(v).addScaledVector(d, 0.004);
        ray.direction.copy(d);
        if (!bvh.raycastFirst(ray, THREE.DoubleSide, 0, 0.7)) open++;
      }
      const k = floor + (1 - floor) * Math.pow(open / dirs.length, 2.0);
      col[i * 3] = k; col[i * 3 + 1] = k * 0.97; col[i * 3 + 2] = k * 0.95;
    }
    m.geometry = m.geometry.clone();
    m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mm of mats) (mm as THREE.MeshStandardMaterial).vertexColors = true;
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

// ------------------------------------------------------------------ twist-free limbs

/**
 * The retargeted clips roll the limb bones about their own length (the
 * thighs by about half a turn, the arms by a third) relative to the bind
 * pose. Bare limbs, being round, hide it; cloth weighted to a limb and to
 * the trunk twists like a sweet wrapper, and a skirt following the thighs
 * folds in on itself. Stand-ins that copy each limb's swing but none of its
 * roll carry the cloth instead. They are added to the body's first
 * skeleton (the one garments bind to) and posed by swingRig every frame.
 */
const SWING = ['LeftUpLeg', 'RightUpLeg', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm'];
// Measured against the trunk, not the collarbone: the clips roll that too.
const ANCHOR: Record<string, string> = { UpLeg: 'Hips', Arm: 'Spine2', ForeArm: '' };

/** A bone's place and turn in the frame of one of its ancestors. */
function frameIn(anc: THREE.Object3D, b: THREE.Object3D, P: THREE.Vector3, Q: THREE.Quaternion) {
  P.copy(b.position); Q.copy(b.quaternion);
  for (let o = b.parent!; o !== anc; o = o.parent!) { P.applyQuaternion(o.quaternion).add(o.position); Q.premultiply(o.quaternion); }
}

export function addSwingBones(root: THREE.Object3D) {
  const mesh = root.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
  const sk = mesh.skeleton, bones = [...sk.bones], inv = [...sk.boneInverses];
  const made = new Map<string, THREE.Bone>();
  root.updateMatrixWorld(true);
  for (const n of SWING) {
    const src = bones.find((b) => canon(b.name) === n)!;
    const a = ANCHOR[n.replace(/^(Left|Right)/, '')];
    const parent = a ? bones.find((b) => canon(b.name) === a)! : made.get(canon(src.parent!.name))!;
    const h = new THREE.Bone();
    h.name = src.name + '_swing';
    if (a) frameIn(parent, src, h.position, h.quaternion);
    else { h.position.copy(src.position); h.quaternion.copy(src.quaternion); }
    h.userData.swing = n;
    parent.add(h);
    made.set(n, h);
    h.updateMatrixWorld(true);
    bones.push(h);
    inv.push(h.matrixWorld.clone().invert());
  }
  mesh.bind(new THREE.Skeleton(bones, inv), mesh.bindMatrix);
}

/** Poses a body's swing stand-ins from its limbs; call after the animation (build it while the body is in its bind pose). */
export function swingRig(body: THREE.Object3D, bone: (n: string) => THREE.Bone) {
  type E = { h: THREE.Bone; b: THREE.Bone; R: THREE.Object3D; up: THREE.Bone | null; Q0h: THREE.Quaternion; a0: THREE.Vector3; c: THREE.Vector3; k: number };
  const hs: E[] = [];
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), qi = new THREE.Quaternion(), a1 = new THREE.Vector3();
  body.traverse((o) => {
    const n = o.userData.swing as string | undefined;
    if (!n) return;
    const h = o as THREE.Bone, b = bone(n), up = (h.parent as THREE.Bone).userData.swing ? (h.parent as THREE.Bone) : null;
    const R = up ? up.parent! : h.parent!;
    const c = b.children.find((x) => (x as THREE.Bone).isBone)!.position.clone();
    const Q0h = new THREE.Quaternion();
    frameIn(R, b, P, Q0h);
    // A forearm's, in the frame of the upper arm's stand-in, as at bind.
    if (up) { frameIn(R, bone(up.userData.swing), P, qi); Q0h.premultiply(qi.invert()); }
    hs.push({ h, b, R, up, Q0h, c, a0: c.clone().applyQuaternion(Q0h).normalize(), k: SWING.indexOf(n) });
  });
  if (!hs.length) return null;
  hs.sort((x, y) => x.k - y.k); // upper limbs before forearms
  return () => {
    for (const { h, b, R, up, Q0h, a0, c } of hs) {
      frameIn(R, b, P, Q);
      if (up) {
        // Into the frame of the upper arm's stand-in.
        qi.copy(up.quaternion).invert();
        Q.premultiply(qi);
        P.sub(up.position).applyQuaternion(qi);
      }
      // Keep only what turns the bone's line away from where it lay at bind.
      a1.copy(c).applyQuaternion(Q).normalize();
      h.quaternion.setFromUnitVectors(a0, a1).multiply(Q0h);
      h.position.copy(P);
    }
  };
}
