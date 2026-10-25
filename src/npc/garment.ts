import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { skinMaterial } from './scan';
import { canon, withAtmos, matte } from './rig';
import { fabric } from './fabric';
import { drape, ellipsoid, capsule, starField, gridSprings, smoothGrid, tethers } from './drape';

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
  /**
   * Hems and bindings: thin bands laid along the garments' edges, each band
   * vertex placed from edge vertex q[k] along the cloth towards q2[k] (cb) and
   * out along q's normal (cn), so they keep to the edge however it moves.
   */
  bands?: { v: Uint32Array; q: Uint32Array; q2: Uint32Array; cb: Float32Array; cn: Float32Array };
  /** Where a cloak's brooch sits (bind pose), if it has one. */
  brooch?: THREE.Vector3;
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
const HEAD = /^(Head.*|LeftEye|RightEye|Neck)$/; // Head.*: a scan's jaw, lids, brows
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
  const joint = (n: string) => {
    let o: THREE.Object3D | undefined;
    root.traverse((x) => { if (!o && (x as THREE.Bone).isBone && canon(x.name) === n) o = x; });
    return o!.getWorldPosition(new THREE.Vector3());
  };
  // Clothes are cut round the base of the neck. A scan's neck joint can sit
  // well up the neck (8 cm above the shoulder joints on some): its base is
  // taken level with the shoulders instead, as Mixamo's is.
  const neckY = Math.min(joint('Neck').y, joint('LeftArm').y + 0.025, joint('RightArm').y + 0.025);
  const bone = (n: string) => { const p = joint(n); if (n === 'Neck') p.y = neckY; return p; };
  let eyes: THREE.Vector3 | null = null;
  root.traverse((x) => { if (!eyes && canon(x.name) === 'LeftEye') eyes = bone('LeftEye').add(bone('RightEye')).multiplyScalar(0.5); });
  if (skull && eyes) {
    // A scan's skull, from its eyes: a head's crown is ~11.5 cm above the
    // eyes, the middle of the cranium ~8 cm behind them.
    const E = eyes as THREE.Vector3;
    const c = new THREE.Vector3(E.x, E.y + 0.01, E.z - 0.08);
    return { bone, head: { c, rx: skull.rx, rz: skull.rz, top: E.y + 0.115, brow: E.y + 0.03, skull: false } };
  }
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
  let cy = (hb.y + Math.min(top, hb.y + 0.165)) / 2, cone = 1.0;
  // A scan: the face is framed from the middle of the skull, behind the eyes (see measure).
  const eyes: THREE.Vector3[] = [];
  root.traverse((x) => { if (/^(Left|Right)Eye$/.test(canon(x.name))) eyes.push(x.getWorldPosition(new THREE.Vector3())); });
  if (eyes.length === 2) {
    const E = eyes[0].add(eyes[1]).multiplyScalar(0.5);
    hb.set(E.x, hb.y, E.z - 0.08);
    cy = E.y;
    cone = 0.8;
  }
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
      return a < cone && v.y < cy + 0.045;
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
 * Leather ankle boots (turnshoes) in place of a scan's modern shoes, which
 * re-coloured still looked like trainers: a soft, close-fitting shoe of one
 * thin leather, the sole barely thicker than the upper, a rounded, slightly
 * pointed toe, and a short shaft round the ankle, closed with a thong and
 * rolled over at the top (the leg wraps run into it).
 *
 * Each foot's shoe is lofted heel to toe inside the scan's shoe (whose bulk
 * gives the foot's length and width), and the shaft is a tube round the
 * ankle. The foot part moves with the foot (the toe with the toes), the top
 * of the shaft with the shin.
 */
function makeBoots(m: THREE.SkinnedMesh, M: Measure, shaft: number) {
  const P = m.geometry.attributes.position, idx = m.geometry.index!, w = new THREE.Vector3();
  const used = new Set<number>(Array.from(idx.array as ArrayLike<number>));
  const hips = M.bone('Hips');
  const boxes = [new THREE.Box3(), new THREE.Box3()];
  for (const i of used) {
    m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
    boxes[w.x > hips.x ? 0 : 1].expandByPoint(w);
  }
  const names = m.skeleton.bones.map((b) => canon(b.name));
  const leather = fabric('leather', 0x2e2016, { attr: 'position' });
  const thong = fabric('leather', 0x1a120c, { attr: 'position' });
  const inv = m.matrixWorld.clone().invert();
  const out: THREE.SkinnedMesh[] = [];
  (['Left', 'Right'] as const).forEach((side, si) => {
    const B = boxes[si];
    if (B.isEmpty()) return;
    const foot = M.bone(side + 'Foot'), toe = M.bone(side + 'ToeBase');
    const iFoot = names.indexOf(side + 'Foot'), iToe = names.indexOf(side + 'ToeBase'), iLeg = names.indexOf(side + 'Leg');
    const sole = B.min.y + 0.004, zH = B.min.z + 0.014, zT = B.max.z - 0.016;
    const x0 = (B.min.x + B.max.x) / 2, W0 = Math.min(0.1, B.max.x - B.min.x - 0.022);
    const pos: number[] = [], SI: number[] = [], SW: number[] = [], ix: number[] = [];
    const weigh = (x: number, y: number, z: number) => {
      const up = ss(foot.y + 0.012, foot.y + 0.06, y), tw = ss(toe.z - 0.025, toe.z + 0.02, z) * (1 - up);
      SI.push(iFoot, iLeg, iToe, 0); SW.push(1 - up - tw, up, tw, 0);
    };
    const add = (x: number, y: number, z: number) => { pos.push(x, y, z); weigh(x, y, z); return pos.length / 3 - 1; };
    // The foot: rings heel to toe, closed at both ends.
    const NU = 18, NV = 18;
    const ring: number[][] = [];
    for (let u = 0; u < NU; u++) {
      const t = u / (NU - 1), end = Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 8)));
      if (end < 1e-3) { ring.push([add(x0 + (t > 0.5 ? -0.002 : 0), sole + (t > 0.5 ? 0.014 : 0.03), zH + (zT - zH) * t)]); continue; }
      // Narrow heel, widest across the ball, a rounded point.
      const wd = W0 * (0.74 + 0.26 * ss(0.05, 0.62, t) - 0.16 * ss(0.8, 1, t)) * end;
      const ht = (0.072 - 0.022 * ss(0.3, 0.75, t) - 0.012 * ss(0.8, 1, t)) * Math.pow(end, 0.5);
      const row: number[] = [];
      for (let v = 0; v < NV; v++) {
        const th = (v / NV) * Math.PI * 2, c = Math.cos(th), s2 = Math.sin(th);
        const xx = (wd / 2) * Math.sign(c) * Math.pow(Math.abs(c), 0.8);
        const yy = s2 >= 0 ? (ht / 2) * Math.pow(s2, 0.85) : -(ht / 2) * Math.pow(-s2, 0.3);
        row.push(add(x0 + xx, sole + ht / 2 + yy, zH + (zT - zH) * t));
      }
      ring.push(row);
    }
    for (let u = 0; u < NU - 1; u++) {
      const a = ring[u], b = ring[u + 1];
      for (let v = 0; v < NV; v++) {
        const v1 = (v + 1) % NV;
        if (a.length === 1) ix.push(a[0], b[v1], b[v]);
        else if (b.length === 1) ix.push(a[v], a[v1], b[0]);
        else ix.push(a[v], a[v1], b[v], a[v1], b[v1], b[v]);
      }
    }
    // The shaft round the ankle, from inside the shoe to above the ankle bone.
    const yTop = foot.y + shaft, NS = 7, cz = foot.z - 0.008;
    const tube: number[][] = [];
    for (let k = 0; k < NS; k++) {
      const t = k / (NS - 1), y = sole + 0.03 + (yTop - sole - 0.03) * t;
      const rx = 0.041 + 0.006 * (1 - t) + 0.004 * ss(0.8, 1, t), rz = rx * (1.25 - 0.15 * t);
      const row: number[] = [];
      for (let v = 0; v < NV; v++) {
        const th = (v / NV) * Math.PI * 2;
        row.push(add(foot.x + Math.sin(th) * rx, y, cz + Math.cos(th) * rz));
      }
      tube.push(row);
    }
    // ...rolled over at the top.
    const roll = tube[NS - 1].map((i) => add(pos[i * 3] + (pos[i * 3] - foot.x) * 0.12, yTop - 0.012, cz + (pos[i * 3 + 2] - cz) * 1.12));
    tube.push(roll);
    for (let k = 0; k < tube.length - 1; k++) for (let v = 0; v < NV; v++) {
      const a = tube[k], b = tube[k + 1], v1 = (v + 1) % NV;
      ix.push(a[v], b[v], a[v1], a[v1], b[v], b[v1]);
    }
    const g = new THREE.BufferGeometry();
    const lp = Float32Array.from(pos);
    for (let i = 0; i < lp.length; i += 3) { w.set(lp[i], lp[i + 1], lp[i + 2]).applyMatrix4(inv); lp[i] = w.x; lp[i + 1] = w.y; lp[i + 2] = w.z; }
    g.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    g.setIndex(ix);
    g.computeVertexNormals();
    const shoe = new THREE.SkinnedMesh(g, leather);
    shoe.name = 'Boot';
    out.push(shoe);
    // A thong wound twice round the ankle.
    const tg: number[] = [], tSI: number[] = [], tSW: number[] = [], tix: number[] = [];
    const NT = 28, NR2 = 5;
    for (let k = 0; k < NT; k++) {
      const a = (k / NT) * Math.PI * 2;
      for (let r = 0; r < NR2; r++) {
        const b = (r / NR2) * Math.PI * 2, rr = 0.004;
        const y = foot.y + shaft * 0.55 + Math.sin(a) * 0.006 + Math.sin(b) * rr * 0.6;
        const R = 0.047 + Math.cos(b) * rr;
        w.set(foot.x + Math.sin(a) * R, y, cz + Math.cos(a) * R * 1.17).applyMatrix4(inv);
        tg.push(w.x, w.y, w.z);
        const up = ss(foot.y + 0.012, foot.y + 0.06, y);
        tSI.push(iFoot, iLeg, 0, 0); tSW.push(1 - up, up, 0, 0);
      }
    }
    for (let k = 0; k < NT; k++) for (let r = 0; r < NR2; r++) {
      const a = k * NR2 + r, b = ((k + 1) % NT) * NR2 + r, c = k * NR2 + ((r + 1) % NR2), d = ((k + 1) % NT) * NR2 + ((r + 1) % NR2);
      tix.push(a, b, c, b, d, c);
    }
    const t2 = new THREE.BufferGeometry();
    t2.setAttribute('position', new THREE.Float32BufferAttribute(tg, 3));
    t2.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(tSI, 4));
    t2.setAttribute('skinWeight', new THREE.Float32BufferAttribute(tSW, 4));
    t2.setIndex(tix);
    t2.computeVertexNormals();
    const th2 = new THREE.SkinnedMesh(t2, thong);
    th2.name = 'BootThong';
    out.push(th2);
  });
  for (const s of out) {
    s.frustumCulled = false;
    s.bind(m.skeleton, m.bindMatrix);
    s.position.copy(m.position); s.quaternion.copy(m.quaternion); s.scale.copy(m.scale);
    m.parent!.add(s);
  }
  m.visible = false;
}

/**
 * Strip the modern outfit. The man keeps head, beard, hands, his trousers as
 * hose and his shoes; the woman keeps head, hands and feet. Everything else
 * the clothes cover goes.
 */
const BOTTOM = /^(Wolf3D_Outfit_Bottom|Scan_Bottom)$/, FOOTWEAR = /^(Wolf3D_Outfit_Footwear|Scan_Footwear)$/;

/**
 * A scan's upper body down to what shows of a dressed townsman: face, neck
 * and hands, his hair (a woman's goes under her veil, see faceOnly), and the
 * skin at the base of the neck. Shirt collars, ties, cuffs, watches, rings
 * and earrings go: they don't look like skin (the packed `_skin` likeness).
 */
function trimScan(m: THREE.SkinnedMesh, kit: 'man' | 'woman', M: Measure) {
  m.frustumCulled = false;
  const cls = boneClassOf(m), g = (m.geometry = m.geometry.clone()), idx = g.index!;
  const skin = g.attributes._skin, w = new THREE.Vector3();
  const hb = M.bone('Head'), head = hb.y, nk = M.bone('Neck'), collar = nk.y - 0.12;
  const eyes = M.bone('LeftEye').add(M.bone('RightEye')).multiplyScalar(0.5);
  const ok = new Uint8Array(cls.length);
  for (let i = 0; i < cls.length; i++) {
    const s = skin ? skin.getX(i) : 1, y = m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld).y;
    const c = cls[i];
    // Hands keep everything (watches and cuffs are painted over in the atlas);
    // the face everything (lips, lids, beard), a man's head his hair; below
    // the jaw, and on the trunk, only skin.
    const face = w.z > hb.z + 0.03 && y > eyes.y - 0.14 && Math.abs(w.x - eyes.x) < 0.05;
    // Under a veil, nothing of her head behind the ears but skin (hair gathered at the nape would come through it).
    if (kit === 'woman' && cls[i] === 'head' && w.z < eyes.z - 0.07 && (s < 0.6 || (w.z < eyes.z - 0.1 && y > nk.y + 0.02))) { ok[i] = 0; continue; }
    // (Skin of the trunk only within the neckline: elsewhere the tunic is fitted close and it would show through.)
    const inNeck = Math.hypot(w.x - nk.x, w.z - nk.z) < 0.07 && y > nk.y - 0.07;
    ok[i] = c === 'hand' || (c === 'head' && (s > 0.35 || face || (kit === 'man' && y > head - 0.01))) || (c === 'head' && s > 0.5 && y > collar) || ((c === 'torso' || c === 'arm') && s > 0.5 && inNeck) ? 1 : 0;
  }
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) if (ok[idx.getX(t)] && ok[idx.getX(t + 1)] && ok[idx.getX(t + 2)]) keep.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
  g.setIndex(keep);
  // A modern cut (a quiff, a high fade) brought down to a plain short crop:
  // the hair above the crown of the skull pressed down towards it.
  if (kit === 'man') {
    const P = g.attributes.position, inv = m.matrixWorld.clone().invert(), top0 = eyes.y + 0.088;
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== 'head') continue;
      const s = skin ? skin.getX(i) : 1;
      if (s > 0.6) continue;
      m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
      if (w.y <= top0) continue;
      const k = 0.5 + 0.5 * ss(0.3, 0.6, s);
      w.y = top0 + (w.y - top0) * k;
      w.applyMatrix4(inv);
      P.setXYZ(i, w.x, w.y, w.z);
    }
  }
  // A wristwatch (painted out in the atlas, but still standing proud of the
  // wrist): everything round the wrist pressed in to the wrist's own round.
  {
    const P = g.attributes.position, inv = m.matrixWorld.clone().invert(), c = new THREE.Vector3();
    for (const side of ['Left', 'Right']) {
      const A = M.bone(side + 'ForeArm'), B = M.bone(side + 'Hand'), T = B.clone().sub(A).normalize();
      const radii: number[] = [];
      for (let i = 0; i < cls.length; i++) {
        if (cls[i] !== 'hand' && cls[i] !== 'arm') continue;
        m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
        const along = w.clone().sub(B).dot(T);
        if (along < -0.08 || along > -0.01) continue;
        c.copy(B).addScaledVector(T, along);
        radii.push(w.distanceTo(c));
      }
      if (radii.length < 10) continue;
      radii.sort((a, b) => a - b);
      const rw = radii[Math.floor(radii.length * 0.4)] + 0.004;
      for (let i = 0; i < cls.length; i++) {
        if (cls[i] !== 'hand' && cls[i] !== 'arm') continue;
        m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
        const along = w.clone().sub(B).dot(T);
        if (along < -0.09 || along > 0.0) continue;
        c.copy(B).addScaledVector(T, along);
        const r = w.distanceTo(c), lim = rw * (1 + 0.6 * ss(-0.015, 0.0, along));
        if (r <= lim) continue;
        w.sub(c).multiplyScalar(lim / r).add(c).applyMatrix4(inv);
        P.setXYZ(i, w.x, w.y, w.z);
      }
    }
  }
  // Where a beard grows (painted by the skin shader, per person): jaw, chin,
  // upper lip and cheeks below the cheekbones, not the lips.
  const beard = new Float32Array(cls.length), S = (x: number, a: number, b: number) => ss(a, b, x);
  if (kit === 'man') for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== 'head') continue;
    m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
    const dx = Math.abs(w.x - hb.x), dy = w.y - eyes.y, dz = w.z - eyes.z;
    // Under the nose, down past the mouth's corners, then up the line of the cheekbone to the sideburns.
    const top = -0.05 - 0.02 * S(dx, 0.02, 0.04) + 0.045 * S(dx, 0.045, 0.08);
    let b = S(dy, top + 0.02, top - 0.014) * S(dy, -0.175, -0.145) * S(dz, -0.13, -0.095) * (1 - S(dx, 0.085, 0.1));
    // The lips themselves are bare.
    b *= 1 - (1 - S(dx, 0.022, 0.03)) * S(dy, -0.066, -0.072) * (1 - S(dy, -0.094, -0.1)) * S(dz, -0.03, -0.02);
    beard[i] = b;
  }
  g.setAttribute('beard', new THREE.BufferAttribute(beard, 1));
  m.material = skinMaterial(m.material as THREE.MeshStandardMaterial);
  fillNeck(m, M, kit);
}

/** The average colour of a texture's pixels at the given uvs (sRGB), or null if its image is not to hand. */
const texPixels = new WeakMap<object, ImageData>();
function averageTexel(tex: THREE.Texture | null, uvs: [number, number][]) {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return null;
  let data = texPixels.get(img);
  if (!data) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 256, 256);
    data = g.getImageData(0, 0, 256, 256);
    texPixels.set(img, data);
  }
  let r = 0, gg = 0, b = 0;
  for (const [u, v] of uvs) {
    const x = Math.min(255, Math.max(0, Math.floor(u * 256))), y = Math.min(255, Math.max(0, Math.floor((tex!.flipY ? 1 - v : v) * 256)));
    const o = (y * 256 + x) * 4;
    r += data.data[o]; gg += data.data[o + 1]; b += data.data[o + 2];
  }
  const n = uvs.length || 1;
  return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

/**
 * Where a scan wore a high collar or a turtleneck there is no neck under it:
 * the trimmed body is open there (one saw into the head from behind). A
 * tube of skin is fitted inside the neck that is left, 3 mm under its skin,
 * so it shows only through the holes: round the scan's own neck where it has
 * one, an ellipse where not, from inside the tunic up into the head.
 * It is coloured from the scan's own skin at the front of the neck.
 */
function fillNeck(m: THREE.SkinnedMesh, M: Measure, kit: 'man' | 'woman') {
  const g = m.geometry, P = g.attributes.position, idx = g.index!, NV = P.count;
  const W = new Float32Array(NV * 3), v = new THREE.Vector3();
  for (let i = 0; i < NV; i++) m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).toArray(W, i * 3);
  const vis = new THREE.BufferGeometry();
  vis.setAttribute('position', new THREE.BufferAttribute(W, 3));
  vis.setIndex(Array.from(idx.array as ArrayLike<number>));
  const bvh = new MeshBVH(vis);
  const nk = M.bone('Neck'), hb = M.bone('Head');
  const NRg = 12, NCg = 28, ray = new THREE.Ray(), o = new THREE.Vector3(), d = new THREE.Vector3();
  const R: number[][] = [], C: THREE.Vector3[] = [];
  for (let r = 0; r < NRg; r++) {
    const t = -0.35 + (kit === 'man' ? 1.4 : 1.2) * (r / (NRg - 1));
    const c = nk.clone().lerp(hb, t);
    c.z += 0.008;
    C.push(c);
    const row: number[] = [];
    for (let k = 0; k < NCg; k++) {
      const a = (k / NCg) * Math.PI * 2;
      d.set(Math.sin(a), 0, Math.cos(a));
      ray.set(o.copy(c).addScaledVector(d, 0.2), d.clone().negate());
      const h = bvh.raycastFirst(ray, THREE.DoubleSide);
      const rr = h ? 0.2 - h.distance : NaN;
      row.push(rr > 0.035 && rr < 0.085 ? rr - 0.003 : NaN);
    }
    R.push(row);
  }
  // Holes: the ellipse of a neck, or the ring's own neighbours.
  for (let r = 0; r < NRg; r++) for (let k = 0; k < NCg; k++) {
    if (!isNaN(R[r][k])) continue;
    const a = (k / NCg) * Math.PI * 2, el = 1 / Math.sqrt((Math.sin(a) / 0.05) ** 2 + (Math.cos(a) / 0.056) ** 2);
    R[r][k] = -el; // marked, filled below
  }
  for (let it = 0; it < 6; it++) for (let r = 0; r < NRg; r++) for (let k = 0; k < NCg; k++) {
    if (R[r][k] >= 0) continue;
    let sum = 0, n = 0;
    for (const [dr, dk] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const rr = r + dr;
      if (rr < 0 || rr >= NRg) continue;
      const x = R[rr][(k + dk + NCg) % NCg];
      if (x > 0) { sum += x; n++; }
    }
    // Never outside the scan's neck where it has one, and no thinner than a neck.
    if (n) R[r][k] = -Math.min(-R[r][k] * 1.15, Math.max(-R[r][k] * 0.85, sum / n));
  }
  // The colour: a vertex of skin on the cheek.
  const eyes = M.bone('LeftEye').add(M.bone('RightEye')).multiplyScalar(0.5);
  const ref = new THREE.Vector3(eyes.x + 0.045, eyes.y - 0.045, eyes.z - 0.005);
  let best = 0, bd = Infinity;
  const used = new Set<number>(idx.array as ArrayLike<number> as number[]);
  for (const i of used) { const dd = (W[i * 3] - ref.x) ** 2 + (W[i * 3 + 1] - ref.y) ** 2 + (W[i * 3 + 2] - ref.z) ** 2; if (dd < bd) { bd = dd; best = i; } }
  const uv0 = [g.attributes.uv.getX(best), g.attributes.uv.getY(best)];
  // Its colour, the average of the cheeks' skin (a single texel of the atlas showed its weave).
  const cheek: [number, number][] = [];
  for (const i of used) {
    const x = Math.abs(W[i * 3] - eyes.x), y = W[i * 3 + 1] - eyes.y, z = W[i * 3 + 2] - eyes.z;
    if (x > 0.03 && x < 0.06 && y < -0.02 && y > -0.06 && z > -0.04) cheek.push([g.attributes.uv.getX(i), g.attributes.uv.getY(i)]);
  }
  const avg = averageTexel((m.material as THREE.MeshStandardMaterial).map, cheek);
  // Skin weights: the nearest vertex of the whole (untrimmed) body.
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const pos: number[] = [], uv: number[] = [], SI: number[] = [], SW: number[] = [], ix: number[] = [];
  const inv = m.matrixWorld.clone().invert();
  for (let r = 0; r < NRg; r++) for (let k = 0; k < NCg; k++) {
    const a = (k / NCg) * Math.PI * 2, rr = Math.abs(R[r][k]);
    v.set(C[r].x + Math.sin(a) * rr, C[r].y, C[r].z + Math.cos(a) * rr);
    let bi = 0, bdd = Infinity;
    for (let i = 0; i < NV; i++) { const dd = (W[i * 3] - v.x) ** 2 + (W[i * 3 + 1] - v.y) ** 2 + (W[i * 3 + 2] - v.z) ** 2; if (dd < bdd) { bdd = dd; bi = i; } }
    for (let j = 0; j < 4; j++) { SI.push(si.getComponent(bi, j)); SW.push(sw.getComponent(bi, j)); }
    v.applyMatrix4(inv);
    pos.push(v.x, v.y, v.z);
    uv.push(uv0[0], uv0[1]);
  }
  for (let r = 0; r < NRg - 1; r++) for (let k = 0; k < NCg; k++) {
    const a = r * NCg + k, b = r * NCg + ((k + 1) % NCg);
    ix.push(a, b, a + NCg, b, b + NCg, a + NCg);
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ng.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  ng.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  ng.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  ng.setAttribute('beard', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  for (const k of Object.keys(g.attributes)) if (!ng.attributes[k] && g.attributes[k].itemSize <= 4 && k !== 'normal') {
    // Other per-vertex data the skin shader reads (the scan's oil and skin likeness): the reference vertex's.
    const at = g.attributes[k], arr = new Float32Array((pos.length / 3) * at.itemSize);
    for (let i = 0; i < pos.length / 3; i++) for (let j = 0; j < at.itemSize; j++) arr[i * at.itemSize + j] = at.getComponent(best, j);
    ng.setAttribute(k, new THREE.BufferAttribute(arr, at.itemSize));
  }
  ng.setIndex(ix);
  ng.computeVertexNormals();
  let mat = m.material as THREE.Material;
  if (avg) {
    // A neck a little paler than the cheeks, matte.
    mat = withAtmos(new THREE.MeshStandardMaterial({ color: avg.multiplyScalar(1.04), roughness: 0.62, metalness: 0 }), { skin: true });
    mat.userData.skin = true;
  }
  const nm = new THREE.SkinnedMesh(ng, mat);
  nm.name = 'NeckFill';
  nm.frustumCulled = false;
  nm.bind(m.skeleton, m.bindMatrix);
  nm.position.copy(m.position); nm.quaternion.copy(m.quaternion); nm.scale.copy(m.scale);
  m.parent!.add(nm);
}

export function dressBody(root: THREE.Object3D, kit: 'man' | 'woman', o: { beard: boolean; wraps: boolean; m: Measure }) {
  const leather = fabric('leather', 0x2a1d14, { attr: 'position' });
  const shoes: THREE.SkinnedMesh[] = [];
  root.traverse((x) => {
    const m = x as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    // A scan's shoes give way to leather boots (makeBoots).
    if (m.name === 'Scan_Footwear') { shoes.push(m); return; }
    if (/Outfit_Top|Headwear/.test(m.name) || (!o.beard && /Beard/.test(m.name))) { m.visible = false; return; }
    // A scanned body (scan.ts): its legs go under a woman's gown.
    if (kit === 'woman' && m.name === 'Scan_Bottom') { m.visible = false; return; }
    if (m.name === 'Scan_Top') { trimScan(m, kit, o.m); return; }
    const trim = kit === 'woman' || m.name === 'Wolf3D_Body';
    if (trim) {
      const cls = boneClassOf(m);
      const idx = m.geometry.index!;
      const skin: number[] = [], feet: number[] = [];
      // The base of the neck and the top of the chest show in the collar.
      const collar = o.m.bone('Neck').y - (kit === 'man' ? 0.16 : 0.1), w = new THREE.Vector3();
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
    if (BOTTOM.test(m.name)) {
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
      // ...and taper the flared trouser cuffs in round the ankle and end them
      // level inside the leather shoe tops (props.ts makeShoeTop, on the shin).
      const shin = (['Left', 'Right'] as const).map((s) => ({ a: o.m.bone(s + 'Leg'), b: o.m.bone(s + 'Foot') }));
      const top = shin[0].b.y + 0.13, c = new THREE.Vector3(), d = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
        if (w.y > top) continue;
        const { a, b } = shin[Math.abs(w.x - shin[0].b.x) < Math.abs(w.x - shin[1].b.x) ? 0 : 1];
        d.subVectors(b, a);
        c.copy(a).addScaledVector(d, w.clone().sub(a).dot(d) / d.lengthSq());
        const f = THREE.MathUtils.smoothstep(top - w.y, 0, 0.1), r = w.distanceTo(c);
        if (r < 1e-4) continue;
        const rr = THREE.MathUtils.lerp(r, Math.min(r, 0.043), f);
        w.sub(c).multiplyScalar(rr / r).add(c);
        w.y = Math.max(w.y, b.y - 0.025);
        w.applyMatrix4(inv);
        p.setXYZ(i, w.x, w.y, w.z);
      }
      // The bit inside the shoe top rides on the shin, as the shoe top does,
      // so its cut edge never swings out of it when the ankle bends.
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const footI = (['Left', 'Right'] as const).map((s) => m.skeleton.bones.findIndex((x) => canon(x.name) === s + 'Leg'));
      for (let i = 0; i < p.count; i++) {
        m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
        const side = Math.abs(w.x - shin[0].b.x) < Math.abs(w.x - shin[1].b.x) ? 0 : 1;
        const t = THREE.MathUtils.smoothstep(shin[side].b.y + 0.07 - w.y, 0, 0.04);
        if (t <= 0 || footI[side] < 0) continue;
        const ws = [0, 1, 2, 3].map((k) => sw.getComponent(i, k) * (1 - t));
        const is = [0, 1, 2, 3].map((k) => si.getComponent(i, k));
        const j = is.indexOf(footI[side]);
        if (j >= 0) ws[j] += t;
        else { const lo = ws.indexOf(Math.min(...ws)); ws[lo] = t; is[lo] = footI[side]; }
        const sum = ws.reduce((a, b) => a + b, 0);
        for (let k = 0; k < 4; k++) { si.setComponent(i, k, is[k]); sw.setComponent(i, k, ws[k] / sum); }
      }
    }
    const old = m.material as THREE.MeshStandardMaterial;
    let nm: THREE.Material;
    if (FOOTWEAR.test(m.name)) {
      nm = leather;
      // Stiff leather: the shoe moves with the foot alone. Shin weights on its
      // collar tore it into spikes whenever the ankle bent.
      const g = (m.geometry = m.geometry.clone()), si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const names = m.skeleton.bones.map((b) => canon(b.name));
      const foot = (s: string) => names.indexOf(s + 'Foot');
      for (let i = 0; i < si.count; i++) {
        let side = '', wf = 0;
        for (let k = 0; k < 4; k++) {
          const n = names[si.getComponent(i, k)], s = n.startsWith('Left') ? 'Left' : n.startsWith('Right') ? 'Right' : '';
          if (s && sw.getComponent(i, k) > wf) { wf = sw.getComponent(i, k); side = s; }
        }
        if (!side) continue;
        for (let k = 0; k < 4; k++) {
          const n = names[si.getComponent(i, k)];
          if (!/Foot|Toe/.test(n)) si.setComponent(i, k, foot(side));
        }
      }
      // Its collar and tongue (laces, a modern shoe's) cut down level, under
      // the leather ankle top (props.ts makeShoeTop).
      const p = g.attributes.position, w = new THREE.Vector3(), inv = m.matrixWorld.clone().invert(), cut = o.m.bone('LeftFoot').y + 0.005;
      if (o.wraps) for (let i = 0; i < p.count; i++) {
        m.getVertexPosition(i, w).applyMatrix4(m.matrixWorld);
        if (w.y <= cut) continue;
        w.y = cut + (w.y - cut) * 0.15;
        w.applyMatrix4(inv);
        p.setXYZ(i, w.x, w.y, w.z);
      }
    }
    else if (BOTTOM.test(m.name)) {
      // Wool hose, with linen fasciae wound from ankle to knee on laymen.
      const ankle = o.m.bone('LeftFoot').y + 0.01, knee = o.m.bone('LeftLeg').y + 0.02;
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
    m.material = kit === 'woman' && m.geometry.groups.length ? [nm, leather] : nm;
  });
  // Laymen's run up over the foot of their leg wraps.
  for (const m of shoes) makeBoots(m, o.m, o.wraps ? 0.075 : 0.058);
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
    // A scan's shirt collar, tie and hanging hair: not part of the body's shape.
    const sk = g.attributes._skin;
    if (sk && neck) for (let i = 0; i < c.length; i++) if (c[i] === 'head' && sk.getX(i) < 0.4 && m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y < (neck as THREE.Vector3).y + 0.09) c[i] = 'none';
    // A woman's hair goes under her veil: it is no part of the shape her clothes are fitted to.
    const hr = g.attributes._hair;
    if (hr && full.userData.sex === 'woman') for (let i = 0; i < c.length; i++) if (hr.getX(i) > 0.5) c[i] = 'none';
    // (Nor any of it the hair mask missed: whatever on her head is not skin, such as long hair down her back.)
    if (sk && full.userData.sex === 'woman') for (let i = 0; i < c.length; i++) if (c[i] === 'head' && sk.getX(i) < 0.4) c[i] = 'none';
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
  /** A wrapped grid cut open between its last and first column on some rows: dup[r] (-1: not cut) stands in for (r, 0) on the last column's side. */
  seam?: { dup: number[] };
  /** A last vertex closing the first row like a cap (a crown). */
  pole?: number;
  constructor(public rows: number, public cols: number, public wrap: boolean) {}
}

/** GLSL-style smoothstep that also accepts reversed edges. */
const ss = (e0: number, e1: number, x: number) => { const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// Capsules (see cloth.ts): 0-1 thighs, 2-3 shins, 4-5 feet, 6 pelvis, 7 torso, 8-9 upper arms, 10-11 forearms.
const CAP_SKIRT = 0b000001111111, CAP_SLEEVE = 0b000010000000, CAP_CLOAK = 0b111111000011, CAP_SHAWL = 0b111110000000;

export function buildGarment(root: THREE.Object3D, full: THREE.Object3D, M: Measure, spec: GarmentSpec): Garment {
  const S = bodySets(root, full);
  const { P, cls } = S;
  const bone = M.bone;
  const neck = bone('Neck'), hips = bone('Hips'), spine2 = bone('Spine2');
  const knee = bone('LeftLeg').y, ankle = bone('LeftFoot').y;
  const yBelt = hips.y + 0.07, yTop = neck.y - 0.03;
  // Above the armpits the tunic is a yoke over the shoulders, moving with the arms.
  const yYoke = Math.min(bone('LeftArm').y, bone('RightArm').y) - 0.06;
  const openNeck = spec.hood !== 'hood' && spec.hood !== 'cowl';
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

  const ray = new THREE.Ray();
  let hood: Grid | null = null;

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
    // The neckline. Under a hood or cowl: closed in round the neck. Open
    // (bare-necked men, women under a veil): a plain round neck cut at the
    // base of the neck, lying on the collarbones and the top of the back, a
    // little lower in front (with a slit there, below), finished with a
    // narrow binding (see the bands, below).
    const nk = bone('Neck'), neckR = new Float32Array(NA);
    for (let k = 0; k < NA; k++) {
      const a = (k / NA) * Math.PI * 2, d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      ray.set(o2.set(nk.x, nk.y + 0.015, nk.z).addScaledVector(d, 0.3), d.negate());
      const hit = S.all.bvh.raycastFirst(ray, THREE.DoubleSide);
      neckR[k] = hit && hit.distance < 0.27 ? 0.3 - hit.distance : 0.06;
    }
    smooth(neckR, NA, true, 2);
    if (openNeck) {
      const down = new THREE.Vector3(0, -1, 0);
      const ys = new Float32Array(NA), xs: THREE.Vector2[] = [];
      for (let k = 0; k < NA; k++) {
        const a = (k / NA) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        // An oval round the base of the neck: wider across, deeper in front than behind.
        const rz = c > 0 ? 0.064 : 0.058, rx = 0.07;
        const r = 1 / Math.sqrt((sn / rx) ** 2 + (c / rz) ** 2);
        const x = nk.x + sn * r, z = nk.z + c * r;
        ray.set(o2.set(x, nk.y + 0.3, z), down);
        const hit = S.shoulders.bvh.raycastFirst(ray, THREE.DoubleSide);
        // On the body (never far up the neck, where a modern shirt collar stands in the scan).
        const base = nk.y + 0.004 - 0.042 * Math.max(0, c) ** 1.5 - 0.012 * sn * sn;
        ys[k] = hit ? Math.min(hit.point.y + 0.005, base + 0.03) : base;
        xs.push(new THREE.Vector2(x, z));
      }
      smooth(ys, NA, true, 3);
      for (let k = 0; k < NA; k++) tunic.pos.splice(k * 3, 3, xs[k].x, ys[k], xs[k].y);
    } else for (let k = 0; k < NA; k++) {
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
      // An open neckline lies close on the collarbones; the yoke eases out towards the arms.
      const ease = openNeck ? r / (nYoke - 1) : 1, offOut = 0.006 + 0.012 * ease, offUp = 0.005 + 0.011 * ease;
      for (let k = 0; k < NA; k++) {
        vv.fromArray(tunic.pos, (r * NA + k) * 3);
        if (r > 0) {
          // Out of the body, seen from the neck...
          d.set(vv.x - nk.x, 0, vv.z - nk.z);
          const rr = d.length();
          d.divideScalar(rr || 1);
          ray.set(o2.set(nk.x, vv.y, nk.z).addScaledVector(d, 0.6), d.clone().negate());
          const hit = S.shoulders.bvh.raycastFirst(ray, THREE.DoubleSide);
          if (hit && 0.6 - hit.distance + offOut > rr) vv.set(nk.x, vv.y, nk.z).addScaledVector(d, 0.6 - hit.distance + offOut);
        }
        // ...and from above.
        ray.set(o2.set(vv.x, vv.y + 0.4, vv.z), down);
        const hit = S.shoulders.bvh.raycastFirst(ray, THREE.DoubleSide);
        if (hit && hit.point.y + offUp > vv.y) vv.y = hit.point.y + offUp;
        vv.toArray(tunic.pos, (r * NA + k) * 3);
        ys[k] = vv.y;
      }
      // Smoothed round, so no single column stands up in a spike.
      smooth(ys, NA, true, r === 0 && openNeck ? 4 : 2); // an open neckline: one easy rise over each shoulder
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
  // --- An open neck has a short slit down the front (a keyhole neck), a
  // little open, with the linen of the shirt beneath showing in it.
  let slitPatch: Grid | null = null;
  if (openNeck) {
    const y0 = tunic.pos[1];
    let sr = 1;
    while (sr < NR - 2 && y0 - tunic.pos[sr * NA * 3 + 1] < 0.075) sr++;
    const dup: number[] = [], nk = bone('Neck');
    slitPatch = new Grid(sr + 1, 5, false);
    slitPatch.group = G_HEAD;
    for (let r = 0; r <= sr; r++) {
      // The shirt: 7 mm in under the tunic's front, a little higher at the top to fill the opening.
      for (const k of [NA - 2, NA - 1, 0, 1, 2]) {
        const o = (r * NA + k) * 3, x = tunic.pos[o], z = tunic.pos[o + 2], d = Math.hypot(x - nk.x, z - nk.z) || 1;
        slitPatch.pos.push(x - ((x - nk.x) / d) * 0.007, tunic.pos[o + 1] + (r === 0 ? 0.006 : 0), z - ((z - nk.z) / d) * 0.007);
        slitPatch.uv.push(x * 4, tunic.pos[o + 1] * 4);
        slitPatch.maxD.push(0);
        slitPatch.region.push(4);
      }
    }
    for (let r = 0; r < sr; r++) {
      const o = r * NA * 3, w = 0.01 * Math.pow(1 - r / sr, 0.8);
      const x = tunic.pos[o], y = tunic.pos[o + 1], z = tunic.pos[o + 2];
      tunic.pos[o] = x + w;
      dup.push(tunic.pos.length / 3);
      tunic.pos.push(x - w, y, z);
      tunic.uv.push(4, tunic.uv[r * NA * 2 + 1]);
      tunic.maxD.push(tunic.maxD[r * NA]);
      tunic.region.push(tunic.region[r * NA]);
    }
    tunic.seam = { dup: [...dup, ...new Array(NR - sr).fill(-1)] };
  }
  const tunicGeo = gridGeometry(tunic);
  const tunicBVH = new MeshBVH(tunicGeo);
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

  // --- Head covering: a veil, a hood or a monk's cowl, laid over the head (see layHood).
  if (spec.hood) {
    const under = [tunicGeo, ...sleeves.map(gridGeometry), ...scap.map(gridGeometry)];
    const clothes = new MeshBVH(mergeGeometries(under.map((g) => posOnly(g.clone()))));
    hood = layHood(M, spec.hood, clothes, new MeshBVH(mergeGeometries([...under, S.shoulders.geo.clone()].map(posOnly))),
      new MeshBVH(mergeGeometries([...under.map((g) => g.clone()), (spec.hood === 'veil' ? S.all : S.noBeard().all).geo.clone()].map(posOnly))), yBelt);
  }

  // --- A mantle: a cloak fastened on the right shoulder, or a woman's shawl (see layMantle).
  let cape: Grid | null = null, brooch: THREE.Vector3 | null = null;
  if (spec.cape) {
    const under0 = [tunicGeo, ...sleeves.map(gridGeometry), ...scap.map(gridGeometry), ...(hood ? [gridGeometry(hood)] : [])];
    const clothes = new MeshBVH(mergeGeometries(under0.map((g) => posOnly(g.clone()))));
    const yH = spec.cape === 'cloak' ? knee + 0.03 : yBelt + 0.05;
    ({ g: cape, brooch } = layMantle(M, spec.cape, spec.capeOpen ?? 0, clothes,
      new MeshBVH(mergeGeometries([...under0.map((g) => g.clone()), S.shoulders.geo.clone()].map(posOnly))),
      new MeshBVH(mergeGeometries([...under0.map((g) => g.clone()), S.all.geo.clone()].map(posOnly))), yH - 0.15, yH));
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
  const pieces: { g: Grid; wrapRows?: boolean }[] = [{ g: tunic }, ...sleeves.map((g) => ({ g })), ...(hood ? [{ g: hood }] : []), ...scap.map((g) => ({ g })), ...(cape ? [{ g: cape }] : []), ...(slitPatch ? [{ g: slitPatch }] : []), { g: beltRing, wrapRows: true }];
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
    const R = g.rows, C = g.cols, sm = g.seam;
    // (Across a seam, the first column's stand-in on the last column's side.)
    const id = (r: number, c: number) => { const rr = (r + R) % R; return sm && c >= C && sm.dup[rr] >= 0 ? base + sm.dup[rr] : base + rr * C + ((c + C) % C); };
    const cmax = g.wrap ? C : C - 1, rmax = wrapRows ? R : R - 1;
    for (let r = 0; r < rmax; r++) for (let c = 0; c < cmax; c++) {
      const a = id(r, c), b = id(r, c + 1), cc = id(r + 1, c), d = id(r + 1, c + 1);
      if (g.flip) index[g.group].push(a, b, cc, b, d, cc);
      else index[g.group].push(a, cc, b, b, cc, d);
    }
    if (g.pole !== undefined) for (let c = 0; c < C; c++) {
      const a = base + g.pole, b = id(0, c), d = id(0, c + 1);
      if (g.flip) index[g.group].push(a, d, b); else index[g.group].push(a, b, d);
      E.push(a, b); ES.push(1);
    }
    if (g === beltRing || g === slitPatch) continue; // rigid
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const a = id(r, c);
      if (g.wrap || c < C - 1) { E.push(a, id(r, c + 1)); ES.push(1); }
      if (r < R - 1) { E.push(a, id(r + 1, c)); ES.push(1); }
      if (r < R - 1 && (g.wrap || c < C - 1)) { E.push(a, id(r + 1, c + 1)); ES.push(0.6); E.push(id(r, c + 1), id(r + 1, c)); ES.push(0.6); }
      if (g.wrap || c < C - 2) { E.push(a, id(r, c + 2)); ES.push(0.18); }
      if (r < R - 2) { E.push(a, id(r + 2, c)); ES.push(0.18); }
    }
    if (sm) for (let r = 0; r < R; r++) {
      if (sm.dup[r] < 0) continue;
      // The stand-ins' own seams down the cut edge.
      if (r < R - 1) { E.push(base + sm.dup[r], id(r + 1, C)); ES.push(1); }
      if (r > 0 && sm.dup[r - 1] < 0) { E.push(base + sm.dup[r], id(r - 1, C)); ES.push(1); }
      if (r < R - 2) { E.push(base + sm.dup[r], id(r + 2, C)); ES.push(0.18); }
    }
  }
  // --- Bands along the edges: the turned hem of a skirt, sleeve or veil, the
  // binding of a neckline. Each is a strip of a few points across (a profile:
  // in along the cloth, out along its normal), wrapped round the edge.
  const bandV: number[] = [], bandQ: number[] = [], bandQ2: number[] = [], bandB: number[] = [], bandN: number[] = [];
  {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    tg.setIndex(index.flat());
    tg.computeVertexNormals();
    const TN = tg.attributes.normal;
    const nq = new THREE.Vector3(), eq = new THREE.Vector3(), bq = new THREE.Vector3(), cen3 = new THREE.Vector3();
    const addBand = (path: number[], inward: number[], closed: boolean, prof: [number, number][], group: number, shade: number) => {
      const n = path.length, np = prof.length, base = pos.length / 3;
      // Which way the stored normals face here: out of the body or into it.
      cen3.set(0, 0, 0);
      for (const q of path) { cen3.x += pos[q * 3] / n; cen3.y += pos[q * 3 + 1] / n; cen3.z += pos[q * 3 + 2] / n; }
      let out = 0;
      for (const q of path) out += (pos[q * 3] - cen3.x) * TN.getX(q) + (pos[q * 3 + 1] - cen3.y) * TN.getY(q) + (pos[q * 3 + 2] - cen3.z) * TN.getZ(q);
      const sg = out >= 0 ? 1 : -1;
      let len = 0;
      for (let j = 0; j < n; j++) {
        const q = path[j], q2 = inward[j];
        if (j) len += Math.hypot(pos[q * 3] - pos[path[j - 1] * 3], pos[q * 3 + 1] - pos[path[j - 1] * 3 + 1], pos[q * 3 + 2] - pos[path[j - 1] * 3 + 2]);
        eq.fromArray(pos, q * 3);
        nq.fromBufferAttribute(TN, q).normalize();
        bq.fromArray(pos, q2 * 3).sub(eq);
        bq.addScaledVector(nq, -bq.dot(nq)).normalize();
        for (const [pb, pn] of prof) {
          const v = eq.clone().addScaledVector(bq, pb).addScaledVector(nq, pn * sg);
          bandV.push(pos.length / 3); bandQ.push(q); bandQ2.push(q2); bandB.push(pb); bandN.push(pn * sg);
          pos.push(v.x, v.y, v.z);
          uv.push(len * 8, 0);
          col.push(col[q * 3] * shade, col[q * 3 + 1] * shade, col[q * 3 + 2] * shade);
          maxD.push(0); region.push(region[q]); capOf.push(0);
        }
      }
      for (let j = 0; j < (closed ? n : n - 1); j++) for (let k = 0; k < np - 1; k++) {
        const a = base + j * np + k, b = base + ((j + 1) % n) * np + k;
        index[group].push(a, b, a + 1, b, b + 1, a + 1);
      }
    };
    const T0 = baseOf.get(tunic)!;
    const tid = (r: number, c: number) => T0 + r * NA + ((c + NA) % NA);
    if (openNeck && tunic.seam) {
      const sm = tunic.seam, sr = sm.dup.filter((x) => x >= 0).length;
      const path: number[] = [tid(sr, 0)], inw: number[] = [tid(sr + 1, 0)];
      for (let r = sr - 1; r >= 0; r--) { path.push(tid(r, 0)); inw.push(r ? tid(r, 1) : tid(1, 1)); }
      for (let c = 1; c < NA; c++) { path.push(tid(0, c)); inw.push(tid(1, c)); }
      for (let r = 0; r < sr; r++) { path.push(T0 + sm.dup[r]); inw.push(r ? tid(r, NA - 1) : tid(1, NA - 1)); }
      addBand(path, inw, true, BAND.neck, G_TUNIC, 0.82);
    }
    // The skirt's hem, and the sleeves' (turned up inside).
    addBand(Array.from({ length: NA }, (_, c) => tid(NR - 1, c)), Array.from({ length: NA }, (_, c) => tid(NR - 2, c)), true, BAND.wool, G_TUNIC, 0.9);
    for (const g of sleeves) {
      const b0 = baseOf.get(g)!, C = g.cols, R = g.rows;
      addBand(Array.from({ length: C }, (_, c) => b0 + (R - 1) * C + c), Array.from({ length: C }, (_, c) => b0 + (R - 2) * C + c), true, BAND.wool, G_TUNIC, 0.9);
    }
    // A mantle's hem, all round.
    if (cape) {
      const b0 = baseOf.get(cape)!, { path, inw } = gridBoundary(cape.rows, cape.cols);
      addBand(path.map((i) => b0 + i), inw.map((i) => b0 + i), true, BAND.wool, G_OVER, 0.95);
    }
    // A veil's rolled linen hem round the face, down both front edges and
    // along the hem; a hood's wool, turned back round the face, and its cape's hem.
    if (hood) {
      const b0 = baseOf.get(hood)!, C = hood.cols, R = hood.rows, dup = hood.seam!.dup;
      const r0 = dup.findIndex((x) => x >= 0), r1 = dup.length - 1 - [...dup].reverse().findIndex((x) => x >= 0);
      const prof = spec.hood === 'veil' ? BAND.linen : BAND.wool, grp = hood.group, path: number[] = [], inw: number[] = [];
      for (let r = r1; r >= r0; r--) { path.push(b0 + r * C); inw.push(b0 + Math.min(r, R - 2) * C + 1); }
      path.push(b0 + (r0 - 1) * C); inw.push(b0 + Math.max(0, r0 - 2) * C);
      for (let r = r0; r <= r1; r++) { path.push(b0 + dup[r]); inw.push(b0 + Math.min(r, R - 2) * C + C - 1); }
      if (r1 === R - 1) {
        for (let c = C - 1; c > 0; c--) { path.push(b0 + (R - 1) * C + c); inw.push(b0 + (R - 2) * C + c); }
        addBand(path, inw, true, prof, grp, 0.97);
      } else {
        path.push(b0 + (r1 + 1) * C); inw.push(b0 + (r1 + 2) * C);
        addBand(path, inw, true, spec.hood === 'veil' ? prof : BAND.turn, grp, 0.95);
        addBand(Array.from({ length: C }, (_, c) => b0 + (R - 1) * C + c), Array.from({ length: C }, (_, c) => b0 + (R - 2) * C + c), true, prof, grp, 0.95);
      }
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
    // An open neckline rides on the upper back alone: weights from the
    // collarbones and arms there dragged it down and into shards whenever the
    // shoulders dropped from the bind pose.
    if (openNeck) {
      const nk = bone('Neck');
      for (let i = 0; i < N; i++) {
        if (region[i] !== 4) continue;
        const t = ss(0.15, 0.09, Math.hypot(bind[i * 3] - nk.x, bind[i * 3 + 2] - nk.z));
        if (t <= 0) continue;
        const m = wmap[i];
        for (const [k, w] of m) m.set(k, w * (1 - t));
        m.set(spineI, (m.get(spineI) ?? 0) + t);
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
  // Cloth worn over cloth (the scapular over the tunic) moves as the cloth
  // beneath it does, or the two cut through each other wherever their weights differ.
  let ride: Int32Array | undefined;
  if (spec.scapular) {
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
  }
  // A cloak skinned from the body bends differently from the tunic under it,
  // and the tunic shows through wherever the back or the hips bend; and where
  // it falls over the arms it must come down with them. Take the weights of
  // the tunic or sleeve at the nearest point beneath instead.
  // (So, too, a veil where it falls onto the shoulders: the tunic's yoke moves with the arms beneath it.)
  const onTunic: { g: Grid; f: (y: number) => number; ease: number }[] = [];
  if (cape) onTunic.push({ g: cape, f: () => 1, ease: 4 });
  if (hood) onTunic.push({ g: hood, f: (y) => ss(jaw - 0.03, jaw - 0.12, y), ease: 3 });
  if (onTunic.length) {
    const tix: number[] = [];
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
    for (const { g, f, ease } of onTunic) {
      const c0 = baseOf.get(g)!, n = g.pos.length / 3;
      for (let i = c0; i < c0 + n; i++) {
        const k = f(bind[i * 3 + 1]);
        if (k <= 0) continue;
        ubvh.closestPointToPoint(vv.fromArray(bind, i * 3), tmp);
        const vs = [uix.getX(tmp.faceIndex * 3), uix.getX(tmp.faceIndex * 3 + 1), uix.getX(tmp.faceIndex * 3 + 2)];
        tri.a.fromArray(bind, vs[0] * 3); tri.b.fromArray(bind, vs[1] * 3); tri.c.fromArray(bind, vs[2] * 3);
        const bc = tri.getBarycoord(tmp.point, new THREE.Vector3()) ?? new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
        const m = new Map<number, number>();
        const old = wmap[i], ot = [...old.values()].reduce((x, y) => x + y, 0) || 1;
        [bc.x, bc.y, bc.z].forEach((w, j) => { const tt = [...wmap[vs[j]].values()].reduce((x, y) => x + y, 0) || 1; for (const [kk, x] of wmap[vs[j]]) m.set(kk, (m.get(kk) ?? 0) + (x / tt) * w * k); });
        for (const [kk, x] of old) m.set(kk, (m.get(kk) ?? 0) + (x / ot) * (1 - k));
        wmap[i] = m;
      }
      // Eased between the arms and the back, so it drapes rather than tears.
      for (let it = 0; it < ease; it++) {
        const next = new Map<number, Map<number, number>>();
        for (let i = c0; i < c0 + n; i++) {
          if (f(bind[i * 3 + 1]) <= 0) continue;
          const o = new Map<number, number>();
          const add = (src: Map<number, number>, w0: number) => { for (const [kk, w] of src) o.set(kk, (o.get(kk) ?? 0) + w * w0); };
          add(wmap[i], 2);
          for (const j of nb[i]) add(wmap[j], 1);
          const sum = [...o.values()].reduce((a2, b2) => a2 + b2, 0);
          for (const [kk, w] of o) o.set(kk, w / sum);
          next.set(i, o);
        }
        for (const [i, o] of next) wmap[i] = o;
      }
    }
  }
  // Bands move exactly as the edge they are sewn to.
  for (let k = 0; k < bandV.length; k++) wmap[bandV[k]] = new Map(wmap[bandQ[k]]);
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
  for (let i = 0; i < N; i++) if (maxD[i] > 0) { capMask[i] = capOf[i]; keepOut[i] = capOf[i] === CAP_CLOAK || capOf[i] === CAP_SHAWL ? 1 : 0; }
  return { geo, bind, skinI, skinW, capMask, keepOut, maxD: new Float32Array(maxD), edges: new Uint32Array(fe), rest: new Float32Array(fr), stiff: new Float32Array(fsf), rope, belt: beltInfo, ride, extraBones, skirt, brooch: brooch ?? undefined,
    bands: bandV.length ? { v: Uint32Array.from(bandV), q: Uint32Array.from(bandQ), q2: Uint32Array.from(bandQ2), cb: Float32Array.from(bandB), cn: Float32Array.from(bandN) } : undefined };
}

/**
 * Lay the falling part of a garment (rows `from` on of a grid of points round
 * the neck's axis, columns 0..NC, NC repeating 0 unless the grid is `cut`)
 * clear of the clothed body: out of it seen from the neck's axis and from
 * above (from row `from0`), out from under overhangs, square to the clothes'
 * surface, with nothing of them just outside it; then smoothed (only ever
 * outwards) and hung (no point nearer the axis than the one above it).
 */
function clearFall(Pt: THREE.Vector3[][], nk: THREE.Vector3, from0: number, from: number, cut: boolean, clothes: MeshBVH, under: MeshBVH, all: MeshBVH) {
  const NR = Pt.length, NC = Pt[0].length - 1;
  // Then exactly clear of the clothed body (the field above is coarse), seen
  // from the neck's axis and from above, as the field is: by the shorter way out.
  {
    const ray = new THREE.Ray(), o = new THREE.Vector3(), dn = new THREE.Vector3(0, -1, 0), m = 0.012;
    for (let r = from0; r < NR; r++) for (const p of Pt[r]) {
      const dx = p.x - nk.x, dz = p.z - nk.z, rr = Math.hypot(dx, dz) || 1e-6;
      ray.set(o.set(nk.x + (dx / rr) * 0.7, p.y, nk.z + (dz / rr) * 0.7), new THREE.Vector3(-dx / rr, 0, -dz / rr));
      const h1 = all.raycastFirst(ray, THREE.DoubleSide), R = h1 ? 0.7 - h1.distance : 0;
      if (rr >= R + m) continue;
      ray.set(o.set(p.x, p.y + 0.5, p.z), dn);
      const h2 = all.raycastFirst(ray, THREE.DoubleSide), top = h2 ? h2.point.y : -Infinity;
      if (p.y >= top + m) continue;
      if (top + m - p.y < Math.min(0.03, R + m - rr)) p.y = top + m;
      else p.set(nk.x + (dx / rr) * (R + m), p.y, nk.z + (dz / rr) * (R + m));
    }
  }
  // Nor under an overhang (the yoke over the shoulder blades, a sleeve's
  // head): out from the axis until nothing of the clothes is just above it.
  {
    const ray = new THREE.Ray(), up = new THREE.Vector3(0, 1, 0);
    for (let r = from; r < NR; r++) for (const p of Pt[r]) for (let k = 0; k < 10; k++) {
      ray.set(p, up);
      if (!under.raycastFirst(ray, THREE.DoubleSide, 0, 0.12)) break;
      const dx = p.x - nk.x, dz = p.z - nk.z, rr = Math.hypot(dx, dz) || 1;
      p.x += (dx / rr) * 0.01; p.z += (dz / rr) * 0.01;
    }
  }
  // And a clear 12 mm from the nearest of the clothes beneath, measured square
  // to their surface (over the round of a shoulder, the views above along the
  // axis and from above leave it a few millimetres off and its faces dip in).
  {
    const geo = clothes.geometry, ix = geo.index!, P = geo.attributes.position;
    const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }, tri = new THREE.Triangle(), n = new THREE.Vector3(), d = new THREE.Vector3();
    for (let pass = 0; pass < 3; pass++) for (let r = from; r < NR; r++) for (const p of Pt[r]) {
      clothes.closestPointToPoint(p, hit);
      if (hit.distance > 0.05) continue;
      tri.a.fromBufferAttribute(P, ix.getX(hit.faceIndex * 3)); tri.b.fromBufferAttribute(P, ix.getX(hit.faceIndex * 3 + 1)); tri.c.fromBufferAttribute(P, ix.getX(hit.faceIndex * 3 + 2));
      tri.getNormal(n);
      d.set(hit.point.x - nk.x, 0.4, hit.point.z - nk.z);
      if (n.dot(d) < 0) n.negate();
      const s2 = d.subVectors(p, hit.point).dot(n);
      if (s2 < 0.016) p.addScaledVector(n, 0.016 - s2);
    }
    // Where clothes overlap (a sleeve's head under the yoke) the nearest
    // surface may be the one beneath: look out from each point too, and if
    // any of the clothes is just outside it, go out past that.
    const ray = new THREE.Ray(), dir = new THREE.Vector3();
    // (Only ever out from the axis, level: never climbing up what it meets.)
    const flat = new THREE.Vector3();
    for (let r = from; r < NR; r++) for (const p of Pt[r]) for (const up of [0, 0.6, 2]) for (let k = 0; k < 2; k++) {
      flat.set(p.x - nk.x, 0, p.z - nk.z).normalize();
      dir.copy(flat).setY(up).normalize();
      ray.set(p, dir);
      const h = clothes.raycastFirst(ray, THREE.DoubleSide, 0, 0.05);
      if (!h) break;
      p.addScaledVector(flat, Math.min(0.03, Math.hypot(h.point.x - p.x, h.point.z - p.z) + 0.014));
    }
  }
  // Where single points were pushed out further than their neighbours, the
  // neighbours rise to meet them (never the other way): soft bumps, no spikes.
  for (let it = 0; it < 4; it++) {
    const R = Pt.map((row) => row.map((p) => Math.hypot(p.x - nk.x, p.z - nk.z)));
    for (let r = from; r < NR; r++) for (let c = 0; c <= NC; c++) {
      let sum = 0, n = 0;
      for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (rr < from || rr >= NR) continue;
        const c2 = cc < 0 ? (cut ? -1 : NC - 1) : cc > NC ? (cut ? -1 : 1) : cc;
        if (c2 < 0) continue;
        sum += R[rr][c2]; n++;
      }
      const want = 0.5 * R[r][c] + 0.5 * (sum / n);
      if (want > R[r][c]) { const p = Pt[r][c], k = want / R[r][c]; p.set(nk.x + (p.x - nk.x) * k, p.y, nk.z + (p.z - nk.z) * k); }
    }
  }
  // Each column hangs: no point of the fall tucked in nearer the axis than the one above it.
  for (let c = 0; c <= NC; c++) for (let r = from; r < NR; r++) {
    const a = Pt[r - 1][c], b = Pt[r][c];
    const ra = Math.hypot(a.x - nk.x, a.z - nk.z), rb = Math.hypot(b.x - nk.x, b.z - nk.z);
    if (rb < ra - 0.004) { const k = (ra - 0.004) / rb; b.set(nk.x + (b.x - nk.x) * k, b.y, nk.z + (b.z - nk.z) * k); }
  }
}

/**
 * A mantle laid round the shoulders. A cloak (the Lombards' and Byzantines'
 * sagum or chlamys): a big piece of wool fastened with a brooch on the right
 * shoulder, its upper edge round the back of the neck, over the left shoulder
 * and across the breast, where it sags in a curve, back to the brooch; it
 * covers the back and the left side and arm, and opens on the right, the
 * sword arm free between its two edges falling from the brooch. A soldier's
 * is thrown back off the left shoulder to free the shield arm: its front
 * stops there. A shawl (a woman's palla): round the shoulders, over the veil,
 * its two ends falling down in front.
 *
 * Built as the hood's cape is: the upper edge laid on the shoulders, then the
 * fall like a tent, in upright folds, clear of the clothes beneath.
 */
function layMantle(M: Measure, kind: 'cloak' | 'shawl', open: number, clothes: MeshBVH, under: MeshBVH, all: MeshBVH, yLow: number, yHem: number): { g: Grid; brooch: THREE.Vector3 | null } {
  const nk = M.bone('Neck'), cloak = kind === 'cloak';
  // Bearings round the neck (0 in front, +pi/2 his left), from the cut edge one way round to the other.
  const b0 = cloak ? -Math.PI / 2 - 0.12 : 0.3;
  const sweep = cloak ? -(open ? Math.PI * 1.5 + 0.55 - open * 0.5 : Math.PI * 2 - 0.24) : Math.PI * 2 - 0.6;
  const NC = cloak ? 52 : 44, NF = cloak ? 24 : 15, NR = NF + 1;
  const ray = new THREE.Ray(), o = new THREE.Vector3(), dn = new THREE.Vector3(0, -1, 0);
  const front = (ph: number) => Math.max(0, Math.cos(ph));
  // The brooch: on the front of the right shoulder.
  const brooch = cloak ? new THREE.Vector3() : null;
  const top: THREE.Vector3[] = [];
  for (let c = 0; c <= NC; c++) {
    const ph = b0 + sweep * (c / NC), sp = Math.sin(ph), cp = Math.cos(ph);
    // Off the neck onto the shoulders, wider by the brooch.
    const TAU = Math.PI * 2, dd = ((((ph + Math.PI / 2 + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    const nearBrooch = cloak ? Math.exp(-(dd * dd) / 0.08) : 0;
    const r0 = (cloak ? 0.1 : 0.14) + 0.035 * nearBrooch;
    // (The clothed body without the head: from above, a beard or an ear would stand in the way.)
    ray.set(o.set(nk.x + sp * r0, nk.y + 0.4, nk.z + cp * r0), dn);
    const h = under.raycastFirst(ray, THREE.DoubleSide);
    // (Never up the neck or the head, whatever stands there.)
    let y = Math.min(h ? h.point.y : nk.y - 0.03, nk.y + (cloak ? 0.02 : 0.0)) + 0.014;
    // Across the breast the cloak's edge sags (but a soldier's thrown-back one, and a shawl's ends, do not).
    if (cloak && !open) y -= 0.15 * front(ph) ** 1.5 * (1 - nearBrooch);
    // Laid on the body at that height.
    ray.set(o.set(nk.x + sp * 0.7, y, nk.z + cp * 0.7), new THREE.Vector3(-sp, 0, -cp));
    const h2 = under.raycastFirst(ray, THREE.DoubleSide), R = Math.max(r0, h2 ? 0.7 - h2.distance + 0.014 : r0);
    top.push(new THREE.Vector3(nk.x + sp * R, y, nk.z + cp * R));
  }
  if (brooch) brooch.copy(top[0]).lerp(top[NC], 0.5);
  // The fall.
  const colliders = [starField(under, nk.x, nk.z, yLow, nk.y + 0.25)];
  const tmp = new Float32Array(3);
  const outOf = (q: THREE.Vector3) => { q.toArray(tmp); for (let it = 0; it < 2; it++) for (const cl of colliders) cl(tmp, 0, 0.012); return q.fromArray(tmp); };
  const ph0 = Math.random() * 6;
  const Pt: THREE.Vector3[][] = [top];
  for (let f = 1; f <= NF; f++) {
    const t = f / NF;
    Pt.push(top.map((L, c) => {
      const ph = b0 + sweep * (c / NC);
      // Its hem: level behind, a little shorter in front; a shawl's ends lower than its back.
      const hy = cloak ? yHem + 0.06 * front(ph) : yHem - 0.12 * front(ph);
      const y = L.y + (hy - L.y) * t;
      // Out like a tent, most where it hangs over the arms.
      const flare = (cloak ? 0.05 + 0.06 * Math.sin(ph) ** 2 : 0.03 + 0.05 * Math.sin(ph) ** 2) * Math.pow(t, 0.7);
      const dx = L.x - nk.x, dz = L.z - nk.z, dl = Math.hypot(dx, dz) || 1;
      // Upright folds, deepest at the hem, and fuller behind, where the cloth gathers from the shoulders.
      const fold = (Math.sin(c * 0.95 + ph0 + Math.sin(c * 0.37 + ph0) * 0.9) * 0.7 + Math.sin(c * 0.47 + ph0 * 1.7) * 0.3) * (cloak ? 0.028 : 0.014) * ss(0, 0.7, t);
      const p = new THREE.Vector3(L.x + (dx / dl) * (flare + fold), y, L.z + (dz / dl) * (flare + fold));
      return outOf(p);
    }));
  }
  clearFall(Pt, nk, 1, 1, true, clothes, under, all);
  const g = new Grid(NR, NC + 1, false);
  g.group = G_OVER;
  g.cap = cloak ? CAP_CLOAK : CAP_SHAWL;
  for (let r = 0; r < NR; r++) for (let c = 0; c <= NC; c++) {
    const p = Pt[r][c], t = r / NF;
    g.pos.push(p.x, p.y, p.z);
    g.uv.push(c / NC * 4, t * 3);
    // It swings free below the shoulders (see cloth.ts), held along its upper edge.
    // (Over the shoulders and back it lies on the tunic and goes as that does: only below the waist is it free to swing.)
    g.maxD.push(r < 2 ? 0 : (cloak ? 0.28 : 0.04) * Math.pow(ss(0, 1, t), 0.8) * ss(nk.y - 0.3, nk.y - 0.6, p.y));
    g.region.push(r < 3 ? 4 : 3);
  }
  return { g, brooch };
}

/** How each head covering is cut (metres; heights from the eyes). */
const HOODS: Record<HoodKind, {
  off: number; // room between the skull and the cloth (hair, ears, a cap)
  top: number; bottom: number | null; // the face's opening, from above the eyes down to (null: open all the way down)
  open: number; // its half-angle round the head's axis
  hem: [number, number, number]; // the cape's hem below the neck: in front, at the sides, behind
  flare: [number, number]; // how far it stands out by its hem: in front and behind, at the shoulders
  fold: number; point: number; group: number;
}> = {
  // A woman's veil: linen laid close over the hair, open down the front.
  veil: { off: 0, top: 0.05, bottom: null, open: 0.82, hem: [-0.1, -0.1, -0.2], flare: [0.035, 0.1], fold: 0.011, point: 0, group: G_HEAD },
  // A layman's hood (cucullus) with its cape over the shoulders, closed under the chin.
  hood: { off: 0.024, top: 0.07, bottom: -0.105, open: 0.72, hem: [-0.2, -0.07, -0.19], flare: [0.05, 0.14], fold: 0.013, point: 0.02, group: G_HEAD },
  // A monk's cowl: deeper, pointed behind, its capelet to the middle of the upper arm.
  cowl: { off: 0.04, top: 0.09, bottom: -0.125, open: 0.82, hem: [-0.25, -0.12, -0.26], flare: [0.06, 0.15], fold: 0.015, point: 0.055, group: G_TUNIC },
};

/**
 * A head covering, laid over the head: smooth over the crown and round the
 * skull, open round the face, and below it a cape falling onto the shoulders
 * and down the back in soft upright folds.
 *
 * Rows run from the crown (a small cap) down to the hem, columns round the
 * head from the front; where the face is (and, for a veil, from there on
 * down) the grid is cut open at the front. Over the head it follows the
 * skull's ellipsoid (a little out from it, by the kind), below its middle an
 * upright wall (cheeks and jaw in front, the back of the head behind); where
 * it leaves the head it falls away like a tent over the clothed shoulders and
 * back (seen from the neck's axis and from above, as drape.ts's starField,
 * then exactly), and never tucks back in.
 */
function layHood(M: Measure, kind: HoodKind, clothes: MeshBVH, under: MeshBVH, all: MeshBVH, yLow: number): Grid {
  const K = HOODS[kind], H = M.head, Hc = H.c, nk = M.bone('Neck');
  const eyes = M.bone('LeftEye').add(M.bone('RightEye')).multiplyScalar(0.5);
  // A veil's skull is the bare one, filled out by her hair; a man's head is measured with its hair and ears.
  const room = (H.skull ? 0.006 : 0.014) + K.off;
  const RX = H.rx + room, RY = (H.top - Hc.y) * 1.02 + room, RZ = H.rz + room * (H.skull ? 1 : 0.5);
  const front = (ph: number) => ss(-0.2, 0.7, Math.cos(ph));
  // Where it leaves the head: under the jaw (or chin) in front, the nape behind.
  const yLeave = (ph: number) => Hc.y - 0.075 - (kind === 'veil' ? 0.075 : 0.1) * front(ph);
  const yHem = (ph: number) => nk.y + K.hem[2] + (K.hem[0] - K.hem[2]) * front(ph) + (K.hem[1] - (K.hem[0] + K.hem[2]) / 2) * Math.sin(ph) ** 2;
  const yTop = eyes.y + K.top, yBot = K.bottom === null ? -Infinity : eyes.y + K.bottom;
  // The face's opening (half its angle round the head's axis), by height: rounded at the top and, for a hood, at the chin.
  const open = (y: number) => {
    if (y >= yTop || y <= yBot) return 0;
    const a = Math.sqrt(ss(yTop, yTop - 0.05, y)) * (K.bottom === null ? 1 : Math.sqrt(ss(yBot, yBot + 0.045, y)));
    return K.open * a + (K.bottom === null ? 0.1 * ss(yLeave(0), yLeave(0) - 0.15, y) : 0);
  };
  const NC = 44, NH = 17, NF = kind === 'veil' ? 14 : 11, NR = NH + NF;
  // A cowl's point: the cloth drawn out behind the crown.
  const point = (ph: number, th: number) => K.point * Math.exp(-((ph - Math.PI) ** 2) / 0.35 - ((th - 0.7) ** 2) / 0.18);
  const onHead = (ph: number, r: number, out: THREE.Vector3) => {
    const t = r / (NH - 1), th = Math.PI / 2 - 0.1 - (Math.PI / 2 - 0.1) * Math.min(1, t / 0.62);
    const sp = Math.sin(ph), cp = Math.cos(ph);
    if (t <= 0.62) {
      const dx = Math.cos(th) * sp, dy = Math.sin(th), dz = Math.cos(th) * cp;
      const k = 1 / Math.sqrt((dx / RX) ** 2 + (dy / RY) ** 2 + (dz / RZ) ** 2) + point(ph, th);
      return out.set(Hc.x + dx * k, Hc.y + dy * k, Hc.z + dz * k);
    }
    const k = 1 / Math.sqrt((sp / RX) ** 2 + (cp / RZ) ** 2), y = Hc.y + (yLeave(ph) - Hc.y) * ((t - 0.62) / 0.38);
    return out.set(Hc.x + sp * k, y, Hc.z + cp * k);
  };
  const g = new Grid(NR, NC, true);
  g.group = K.group;
  const dup: number[] = new Array(NR).fill(-1);
  const Pt: THREE.Vector3[][] = [];
  const v = new THREE.Vector3();
  // Bearings of a row's columns, its two cut edges included (c = 0 and c = NC).
  const bearings = (o: number) => Array.from({ length: NC + 1 }, (_, c) => o + (Math.PI * 2 - 2 * o) * (c / NC));
  const opens: number[] = [];
  for (let r = 0; r < NH; r++) {
    onHead(0, r, v);
    opens.push(open(v.y));
    Pt.push(bearings(opens[r]).map((ph) => onHead(ph, r, new THREE.Vector3())));
  }
  // The fall: each column from where it left the head, out and down, laid
  // over the shoulders and back.
  const colliders = [capsule(new THREE.Vector3(nk.x, nk.y - 0.03, nk.z - 0.01), new THREE.Vector3(Hc.x, Hc.y - 0.03, Hc.z), 0.066), starField(under, nk.x, nk.z, yLow, H.top + 0.02)];
  const tmp = new Float32Array(3);
  const outOf = (q: THREE.Vector3, m: number) => { q.toArray(tmp); for (let it = 0; it < 2; it++) for (const c of colliders) c(tmp, 0, m); return q.fromArray(tmp); };
  const ph0 = Math.random() * 6;
  const o1 = opens[NH - 1];
  for (let f = 1; f <= NF; f++) {
    const t = f / NF, o = o1 > 0 ? o1 + 0.12 * t : 0;
    Pt.push(bearings(o).map((ph, c) => {
      const L = Pt[NH - 1][c], y0 = L.y, y = y0 + (yHem(ph) - y0) * t;
      // Out like a tent: wider over the shoulders than behind or in front.
      const flare = (K.flare[0] + (K.flare[1] - K.flare[0]) * Math.sin(ph) ** 2) * Math.pow(t, 0.8);
      const dx = L.x - nk.x, dz = L.z - nk.z, dl = Math.hypot(dx, dz) || 1;
      const p = new THREE.Vector3(L.x + (dx / dl) * flare, y, L.z + (dz / dl) * flare);
      // Soft upright folds, deeper the further it falls.
      const fold = (Math.sin(ph * 9 + ph0 + Math.sin(ph * 4 + ph0) * 0.8) * 0.7 + Math.sin(ph * 5 + ph0 * 1.7) * 0.3) * K.fold * ss(0, 0.6, t);
      p.x += (dx / dl) * fold; p.z += (dz / dl) * fold;
      return outOf(p, 0.007);
    }));
  }
  clearFall(Pt, nk, NH - 5, NH, o1 > 0, clothes, under, all);
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
    const p = Pt[r][c];
    g.pos.push(p.x, p.y, p.z);
    g.uv.push(c / NC * 4, r / NR * 2);
    g.maxD.push(0);
    g.region.push(2);
  }
  // The cut edge's other side.
  for (let r = 0; r < NR; r++) if ((r < NH ? opens[r] : o1) > 0) {
    dup[r] = g.pos.length / 3;
    const p = Pt[r][NC];
    g.pos.push(p.x, p.y, p.z);
    g.uv.push(4, r / NR * 2);
    g.maxD.push(0);
    g.region.push(2);
  }
  g.seam = { dup };
  // The crown.
  g.pole = g.pos.length / 3;
  g.pos.push(Hc.x, Hc.y + RY, Hc.z);
  g.uv.push(2, 0); g.maxD.push(0); g.region.push(2);
  return g;
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

/** Band profiles (in along the cloth from its edge, out along its normal; metres). */
const BAND: Record<string, [number, number][]> = {
  // A neckline's binding: a narrow strip folded over the cut edge, standing a little proud.
  neck: [[0.013, -0.002], [0.002, -0.0022], [-0.0022, 0.0005], [0.002, 0.0032], [0.01, 0.0032], [0.0125, 0.0008]],
  // Wool turned up inside and hemmed: the edge's thickness, and the turn-up seen from below.
  wool: [[0.03, -0.0026], [0.002, -0.0026], [-0.0016, -0.0002], [0.0015, 0.0011], [0.004, 0.0002]],
  // A hood's face: the wool turned back on itself, a wide soft roll.
  turn: [[0.03, -0.003], [0.004, -0.0035], [-0.003, 0.0005], [0.003, 0.004], [0.022, 0.0035], [0.03, 0.0008]],
  // Linen rolled and whipped.
  linen: [[0.01, -0.0013], [0.0012, -0.0013], [-0.0011, 0], [0.0012, 0.0009], [0.003, 0.0001]],
};

/** The edge of a rows x cols sheet, all round, with each edge vertex's neighbour inside the sheet. */
function gridBoundary(R: number, C: number) {
  const path: number[] = [], inw: number[] = [];
  const id = (r: number, c: number) => r * C + c;
  const into = (r: number, c: number) => id(Math.min(R - 2, Math.max(1, r)), Math.min(C - 2, Math.max(1, c)));
  for (let c = 0; c < C - 1; c++) { path.push(id(0, c)); inw.push(into(0, c)); }
  for (let r = 0; r < R - 1; r++) { path.push(id(r, C - 1)); inw.push(into(r, C - 1)); }
  for (let c = C - 1; c > 0; c--) { path.push(id(R - 1, c)); inw.push(into(R - 1, c)); }
  for (let r = R - 1; r > 0; r--) { path.push(id(r, 0)); inw.push(into(r, 0)); }
  return { path, inw };
}

/** A geometry with nothing but positions, unindexed (for merging into collision meshes). */
function posOnly(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
  return n;
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
