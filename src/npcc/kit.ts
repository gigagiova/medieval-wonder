import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mixamoFrames, retarget, withAtmos, type Motion } from '../npc/rig';
import { measure, type Garment, type Measure } from '../npc/garment';

// Townsfolk, track C (`?npc=c`): people already clothed, each one surface
// (photogrammetry-style and artist models from Sketchfab, CC BY 4.0, see
// public/models/npcc/CREDITS.md), auto-rigged offline in Blender with a
// Mixamo-named skeleton (tools/npcc/build.py). Nothing is layered at
// runtime: no garments, no cloth bones, no hiding; the clothes deform with
// the skin weights of the surface they are part of.

export const NPC_C = typeof location !== 'undefined' && new URLSearchParams(location.search).get('npc') === 'c';

export type Sex = 'man' | 'woman';
export interface KitC { id: string; sex: Sex; template: THREE.Object3D; motion: Motion; m: Measure; scale: number }
export interface OutfitC { c: true; v2?: false; id: string; body: string; sex: Sex; template: THREE.Object3D; m: Measure; garment: Garment }

const DIR = 'models/npcc/';
export const BODIES_C: { id: string; sex: Sex; height: number }[] = [
  { id: 'c_villager', sex: 'man', height: 1.70 }, { id: 'c_man', sex: 'man', height: 1.72 }, { id: 'c_eastern', sex: 'man', height: 1.70 },
  { id: 'c_soldier', sex: 'man', height: 1.76 }, { id: 'c_friar', sex: 'man', height: 1.70 },
  { id: 'c_woman', sex: 'woman', height: 1.60 }, { id: 'c_nun', sex: 'woman', height: 1.62 },
];
export const kitsC = new Map<string, KitC>();

/** Which bodies wear each outfit id of src/npc.ts and src/npc/population.ts. */
const WEARS: Record<string, string[]> = {
  soldier: ['c_soldier'], soldierCloak: ['c_soldier'],
  peasantHood: ['c_villager', 'c_man'], peasantCloak: ['c_man', 'c_villager'],
  woman: ['c_woman'], womanShawl: ['c_woman'],
  monk: ['c_friar'], monkBare: ['c_friar'],
  robe: ['c_eastern'], robeCloak: ['c_eastern'],
};
/** By title (population.ts), where the outfit alone would pick the wrong person. */
const BY_TITLE: Record<string, string> = { 'ancilla Dei': 'c_nun', presbyter: 'c_friar', diaconus: 'c_friar' };

export function bodiesC(outfit: string, title?: string): string[] {
  const t = title && BY_TITLE[title];
  const ids = t ? [t] : WEARS[outfit] ?? [];
  return ids.filter((i) => kitsC.has(i));
}

/** Load the bodies (after the UAL clips and the CMU walk) and retarget each. */
export async function loadC(get: (u: string) => Promise<GLTF>, ual: GLTF, walkSource: GLTF) {
  const got = await Promise.all(BODIES_C.map((b) => get(DIR + b.id + '.json').then((g) => [b, g] as const).catch((e) => { console.warn('npcc', b.id, e); return null; })));
  for (const r of got) {
    if (!r) continue;
    const [b, g] = r;
    const t = g.scene;
    t.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.frustumCulled = false;
      m.castShadow = false;
      const src = m.material as THREE.MeshStandardMaterial;
      if (src.map) { src.map.colorSpace = THREE.SRGBColorSpace; src.map.anisotropy = 4; }
      m.material = withAtmos(new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.95, metalness: 0 }));
    });
    mixamoFrames(t);
    t.updateMatrixWorld(true);
    const top = new THREE.Box3().setFromObject(t).max.y;
    const motion = retarget(t, ual, ['idle', 'talk', 'bless', 'kneel', 'pickup', 'interact']);
    const walk = retarget(t, walkSource, ['walk', 'walkFormal']);
    const fingers = /Hand(?:Thumb|Index|Middle|Ring|Pinky)\d\.quaternion$/;
    for (const clip of Object.values(walk.clips)) clip.tracks = clip.tracks.filter((track) => !fingers.test(track.name));
    Object.assign(motion.clips, walk.clips);
    motion.speed = walk.speed;
    motion.start = walk.start;
    kitsC.set(b.id, { id: b.id, sex: b.sex, template: t, motion, m: measure(t), scale: b.height / (top || b.height) });
  }
}

const outfitsC = new Map<string, OutfitC>();
/** The outfit is the body: one template per body, shared by every outfit id it wears. */
export function outfitC(id: string, body: string): OutfitC {
  let o = outfitsC.get(body);
  if (o) return { ...o, id };
  const k = kitsC.get(body)!;
  o = { c: true, id, body, sex: k.sex, template: k.template, m: k.m, garment: {} as Garment };
  outfitsC.set(body, o);
  return o;
}

/** Stands in for the v1 cloth simulation and the v2 dressing: nothing to simulate. */
export const noCloth = { visible: true, setSimulating() {}, update() {}, dispose() {} };
