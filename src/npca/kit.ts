import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { retarget, withAtmos, type Motion } from '../npc/rig';
import { measure, type Garment, type Measure } from '../npc/garment';
import { fabric, type FabricKind } from '../npc/fabric';

// Track A townsfolk (?npc=a): artist-made characters whose clothes were
// modelled, rigged and skinned with the body as one figure (Quaternius'
// CC0 "Modular Character Outfits - Fantasy" on his "Universal Base
// Characters" heads; packed by tools/npca/build.py, credits in
// public/models/npca/CREDITS.md). Nothing is layered at run time: each outfit
// is a fixed set of the artist's parts with no body beneath them, merged into
// two meshes (cloth, skin) drawn in two calls. The skirts of robes and gowns
// are made by the build, under the tunic's hem, and skinned to the legs.

const DIR = 'models/npca/';
export type Sex = 'man' | 'woman';
export interface KitA { id: string; sex: Sex; template: THREE.Object3D; motion: Motion; m: Measure; scale: number }
export interface OutfitA { npcA: true; id: string; body: string; sex: Sex; template: THREE.Object3D; m: Measure; garment: Garment; parts: string[] }

/** Layer order of the build's _LAYER attribute (tools/npca/build.py LAYERS). */
export const LAYERS = ['tunic', 'under', 'over', 'legs', 'shoes', 'hood', 'belt', 'skin', 'hair', 'eyes'] as const;
export type Layer = (typeof LAYERS)[number];

/** Which of the artist's parts each outfit profile (src/npc/population.ts) wears. */
const FACE = ['head', 'eyes', 'brows'];
const OUTFITS: Record<string, { sex: Sex; parts: string[] }> = {
  // Townsmen and peasants: the knee-short tunic over hose and boots.
  peasantHood: { sex: 'man', parts: ['tunic', 'arms', 'arms_skin', 'legs', 'boots', 'hood', 'beard', ...FACE] },
  peasantCloak: { sex: 'man', parts: ['tunic', 'arms', 'arms_skin', 'legs', 'boots', 'hair', 'beard', ...FACE] },
  // Armed men: a leather jerkin and belt over the tunic.
  soldier: { sex: 'man', parts: ['jerkin', 'jarms', 'jarms_skin', 'belt1', 'legs', 'boots', 'hair', 'beard', ...FACE] },
  soldierCloak: { sex: 'man', parts: ['jerkin', 'jarms', 'jarms_skin', 'belt1', 'legs', 'boots', 'hair', 'beard', ...FACE] },
  // Clergy and better-off townsmen: the tunic over an ankle-length robe.
  robe: { sex: 'man', parts: ['tunic', 'arms', 'arms_skin', 'robe', 'boots', 'hair', 'beard', ...FACE] },
  robeCloak: { sex: 'man', parts: ['tunic', 'arms', 'arms_skin', 'robe', 'boots', 'hair', 'beard', ...FACE] },
  // Monks: the habit to the ankles, the cowl up or the head shaven.
  monk: { sex: 'man', parts: ['tunic', 'arms', 'arms_skin', 'robe', 'boots', 'hood', ...FACE] },
  monkBare: { sex: 'man', parts: ['tunic', 'arms', 'arms_skin', 'robe', 'boots', 'buzz', ...FACE] },
  // Women: an ankle-length gown, the head covered.
  woman: { sex: 'woman', parts: ['jerkin', 'jarms', 'jarms_skin', 'robe', 'boots', 'hood', ...FACE] },
  womanShawl: { sex: 'woman', parts: ['jerkin', 'jarms', 'jarms_skin', 'robe', 'boots', 'hood', ...FACE] },
};

export const kitsA = new Map<string, KitA>();

export async function loadA(get: (u: string) => Promise<GLTF>, ual: GLTF, walkSource?: GLTF) {
  for (const sex of ['man', 'woman'] as Sex[]) {
    const g = await get(DIR + sex + '.json');
    const t = g.scene;
    t.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.frustumCulled = false;
      // (Single-primitive meshes load as the node itself.)
      m.userData.part = (m.name || m.parent?.name || '').replace(/^P_/, '');
    });
    t.updateMatrixWorld(true);
    const motion = retarget(t, ual, walkSource ? ['idle', 'talk', 'bless', 'kneel', 'pickup', 'interact'] : undefined);
    if (walkSource) {
      const walk = retarget(t, walkSource, ['walk', 'walkFormal']);
      const fingers = /Hand(?:Thumb|Index|Middle|Ring|Pinky)\d\.quaternion$/;
      for (const clip of Object.values(walk.clips)) {
        clip.tracks = clip.tracks.filter((track) => !fingers.test(track.name));
        for (const track of motion.clips.idle.tracks.filter((track) => fingers.test(track.name))) {
          const q = Array.from(track.values.slice(0, 4));
          clip.tracks.push(new THREE.QuaternionKeyframeTrack(track.name, [0, clip.duration], [...q, ...q]));
        }
      }
      Object.assign(motion.clips, walk.clips);
      motion.speed = walk.speed;
      motion.start = walk.start;
    }
    // Measured on the head alone (helmets, hoods and the head turn use it).
    const h = SkeletonUtils.clone(t);
    const drop: THREE.Object3D[] = [];
    h.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.userData.part !== 'head') drop.push(o); });
    drop.forEach((o) => o.parent!.remove(o));
    const m = measure(h);
    let top = 0;
    t.traverse((o) => { if (o.name === 'HeadTop_End') top = o.getWorldPosition(new THREE.Vector3()).y; });
    top = m.head.top || top - 0.03;
    const height = sex === 'man' ? 1.71 : 1.59;
    kitsA.set('a_' + sex, { id: 'a_' + sex, sex, template: t, motion, m, scale: height / top });
  }
}

export function bodiesA(outfit: string, sex: Sex) {
  const o = OUTFITS[outfit];
  return [...kitsA.values()].filter((k) => k.sex === (o?.sex ?? sex)).map((k) => k.id);
}

const outfitsA = new Map<string, OutfitA>();

/** An outfit: the kit's template with that outfit's parts merged into one cloth and one skin mesh. */
export function outfitA(id: string, body: string): OutfitA {
  const key = id + ':' + body;
  let o = outfitsA.get(key);
  if (o) return o;
  const k = kitsA.get(body)!;
  const def = OUTFITS[id] ?? OUTFITS[k.sex === 'man' ? 'peasantCloak' : 'woman'];
  const t = SkeletonUtils.clone(k.template);
  const groups: Record<'cloth' | 'skin', THREE.SkinnedMesh[]> = { cloth: [], skin: [] };
  const all: THREE.SkinnedMesh[] = [];
  t.traverse((x) => { if ((x as THREE.SkinnedMesh).isSkinnedMesh) all.push(x as THREE.SkinnedMesh); });
  for (const m of all) {
    if (!def.parts.includes(m.userData.part)) { m.parent!.remove(m); continue; }
    groups[(m.material as THREE.Material).name === 'cloth' ? 'cloth' : 'skin'].push(m);
  }
  for (const kind of ['cloth', 'skin'] as const) {
    const ms = groups[kind];
    if (!ms.length) continue;
    const geo = mergeGeometries(ms.map((m) => m.geometry), false)!;
    geo.setAttribute('rest', geo.attributes.position);
    geo.setAttribute('restN', geo.attributes.normal);
    const keep = ms[0];
    keep.geometry = geo;
    keep.name = 'A_' + kind;
    keep.userData.npcA = kind;
    for (const m of ms.slice(1)) m.parent!.remove(m);
  }
  t.updateMatrixWorld(true);
  o = { npcA: true, id, body, sex: k.sex, template: t, m: k.m, garment: beltOf(k.m, k.sex), parts: def.parts };
  outfitsA.set(key, o);
  return o;
}

/** Where a belt sits, for fittings hung on it (src/npc.ts equip): the waist, an oval round the hips. */
function beltOf(M: Measure, sex: Sex): Garment {
  const hips = M.bone('Hips'), y = THREE.MathUtils.lerp(hips.y, M.bone('Spine1').y, 0.5);
  const rx = sex === 'man' ? 0.17 : 0.16, rz = sex === 'man' ? 0.13 : 0.12;
  const r = (a: number) => 1 / Math.sqrt((Math.sin(a) / rx) ** 2 + (Math.cos(a) / rz) ** 2);
  return { belt: { y, cx: hips.x, cz: hips.z, r } } as unknown as Garment;
}

/** Stands in for v1's Clothing (src/npc/cloth.ts): plainly skinned. */
export class ClothingA {
  simulating = false;
  constructor(private meshes: THREE.Object3D[]) {}
  set visible(v: boolean) { for (const m of this.meshes) m.visible = v; }
  setSimulating(_on: boolean) { /* none */ }
  update(_dt: number, _at: THREE.Vector3) { /* skinned only */ }
  dispose() { for (const m of this.meshes) ((m as THREE.Mesh).geometry.getAttribute('color') as THREE.BufferAttribute | undefined)?.array; }
}

export interface DyesA { colors: Partial<Record<Layer, THREE.Color>>; kind: FabricKind }

let clothTex: Record<Sex, THREE.Texture | null> = { man: null, woman: null };

/**
 * Colour a person's cloned outfit: each cloth layer its dye, the skin its
 * tone, the hair its colour, through a per-person vertex colour (the
 * geometry is otherwise shared). The cloth is the scanned weave of the
 * game's other garments (src/npc/fabric.ts) under the artist's painted folds
 * and seams, which the build turned to grey.
 */
export function dressA(body: THREE.Object3D, outfit: OutfitA, d: DyesA) {
  const meshes: THREE.Object3D[] = [];
  body.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.userData.npcA) return;
    meshes.push(m);
    const g = m.geometry.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'color') g.setAttribute(n, m.geometry.getAttribute(n));
    const L = g.getAttribute('_layer') as THREE.BufferAttribute;
    const c = new Float32Array(L.count * 3);
    const one = new THREE.Color(1, 1, 1);
    for (let i = 0; i < L.count; i++) {
      const col = d.colors[LAYERS[Math.round(L.getX(i))]] ?? one;
      c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    m.geometry = g;
    const src = m.material as THREE.MeshStandardMaterial;
    if (m.userData.npcA === 'cloth') {
      const tex = (clothTex[outfit.sex] ??= src.map);
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      const mat = fabric(d.kind, 0xffffff, { attr: 'rest', vertexColors: true, side: THREE.FrontSide });
      mat.map = tex;
      m.material = mat;
    } else {
      const mat = withAtmos(new THREE.MeshStandardMaterial({ map: src.map, vertexColors: true, roughness: 0.72, metalness: 0 }), { skin: true });
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      m.material = mat;
    }
  });
  return new ClothingA(meshes);
}
