import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { canon, mixamoFrames, retarget, type Motion } from '../npc/rig';
import { measure, type Garment, type Measure } from '../npc/garment';
import { skinMaterial } from '../npc/scan';

// Townsfolk v2: rigged MakeHuman bodies (CC0, built by MPFB 2 in Blender,
// tools/npc2/build.py) with artist-modelled garments fitted and skinned to
// each body by MakeHuman's own clothes fitting, all in one glTF per body
// (public/models/npc2, see CREDITS.md there). Per outfit the body's (and
// lower layers') triangles that the outfit's garments cover are dropped,
// from the `_hide` bits baked into each vertex (tools/npc2/hide.py), so
// nothing under the cloth can poke through it.
//
// Switch: ?npc=v2 (src/npc.ts).

export type Sex = 'man' | 'woman';
export interface BodyMeta {
  body: string; sex: Sex; height: number;
  garments: Record<string, { fabric: string; layer: string; depth: number; map?: 'detail' | 'color' }>;
  outfits: Record<string, { garments: string[]; bit: number }>;
}
export interface KitV2 { id: string; sex: Sex; template: THREE.Object3D; motion: Motion; m: Measure; scale: number; meta: BodyMeta }
export interface OutfitV2 {
  v2: true; id: string; body: string; sex: Sex; template: THREE.Object3D; m: Measure;
  /** Enough of the v1 garment description for npc.ts's props (belt fittings, brooch). */
  garment: Garment;
  /** The garments worn, and their kinds. */
  garments: { id: string; fabric: string; layer: string; map?: 'detail' | 'color' }[];
}

const DIR = 'models/npc2/';
const flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
flatNormal.needsUpdate = true;
/** The bodies, and which v1 outfits each can wear (by sex). */
export const BODIES_V2: { id: string; sex: Sex }[] = [
  { id: 'm_young', sex: 'man' }, { id: 'm_mid', sex: 'man' }, { id: 'm_old', sex: 'man' }, { id: 'm_elder', sex: 'man' },
  { id: 'w_young', sex: 'woman' }, { id: 'w_mid', sex: 'woman' },
];

export const kitsV2 = new Map<string, KitV2>();

/** Load the v2 bodies (after the UAL clips): retarget each, measure it. */
export async function loadV2(get: (u: string) => Promise<GLTF>, ual: GLTF) {
  const got = await Promise.all(BODIES_V2.map((b) => get(DIR + b.id + '.json').then((g) => [b, g] as const).catch((e) => { console.warn('npc2', b.id, e); return null; })));
  for (const r of got) {
    if (!r) continue;
    const [b, g] = r;
    const t = g.scene;
    const meta = JSON.parse((g.scene.userData.npc2 ?? (g.parser.json.scenes?.[0]?.extras?.npc2) ?? '{}') as string) as BodyMeta;
    prep(t);
    mixamoFrames(t);
    t.updateMatrixWorld(true);
    let top = 0;
    t.traverse((o) => { if (canon(o.name) === 'HeadTop_End') top = o.getWorldPosition(new THREE.Vector3()).y; });
    kitsV2.set(b.id, { id: b.id, sex: b.sex, template: t, motion: retarget(t, ual), m: measureBody(t), scale: (meta.height || 1.7) / (top || 1.8), meta });
  }
}

/** Mesh roles by name; the rest pose kept as `rest`/`restN` for the fabric shader. */
function prep(t: THREE.Object3D) {
  t.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    m.castShadow = false;
    // (A mesh of several materials loads as a group of meshes, named after it.)
    const n = /^G_|body|eye|low-poly/i.test(m.name) ? m.name : m.parent?.name ?? m.name;
    m.userData.npc2 = /^G_/.test(n) ? 'garment' : /body/.test(n) ? 'body' : /eye|low-poly/i.test(n) ? 'eyes' : 'part';
    if (m.userData.npc2 === 'eyes') {
      // Wet, a little shadowed by the lids: a soft highlight, the whites not paper-white.
      const src = m.material as THREE.MeshStandardMaterial;
      if (src.map) src.map.colorSpace = THREE.SRGBColorSpace;
      m.material = new THREE.MeshStandardMaterial({ map: src.map, color: 0xc8beb4, roughness: 0.18, metalness: 0 });
    }
    if (m.userData.npc2 === 'garment') m.userData.garment = n.replace(/^G_/, '').replace(/_\d+$/, '');
    if (m.userData.npc2 === 'body') {
      // Skin: npc.ts tints it per person and gives it the soft wrapped light of skin (withAtmos).
      // The same skin shading as the scanned v1 bodies (src/npc/scan.ts): pores, wrapped light, matte.
      const src = m.material as THREE.MeshStandardMaterial;
      if (src.map) src.map.colorSpace = THREE.SRGBColorSpace;
      if (!m.geometry.getAttribute('beard')) m.geometry.setAttribute('beard', new THREE.BufferAttribute(new Float32Array(m.geometry.attributes.position.count), 1));
      // (The shared skin shader lays its pores on the normal map's UVs: a flat one where the body has none.)
      if (!src.normalMap) src.normalMap = flatNormal;
      m.material = skinMaterial(src);
    }
  });
}

/** Head and joint measurements from the body alone. */
function measureBody(t: THREE.Object3D): Measure {
  const hidden: THREE.Object3D[] = [];
  t.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.userData.npc2 !== 'body') hidden.push(o); });
  const parents = hidden.map((o) => o.parent!);
  hidden.forEach((o) => o.parent!.remove(o));
  const m = measure(t);
  hidden.forEach((o, i) => parents[i].add(o));
  return m;
}

const outfitsV2 = new Map<string, OutfitV2>();

/** Bodies that can wear a v1 outfit id in v2 (none: v2 doesn't make it). */
/** Outfits worn only by some bodies: a bare-headed monk is the old man (close-cropped, as if tonsured). */
const ONLY: Record<string, string[]> = { monkBare: ['m_elder'] };
export function bodiesV2(outfit: string, sex: Sex) {
  return [...kitsV2.values()].filter((k) => k.sex === sex && k.meta.outfits[outfit] && (!ONLY[outfit] || ONLY[outfit].includes(k.id))).map((k) => k.id);
}

/** An outfit on a body: the body's template with that outfit's garments, hidden parts dropped. */
export function outfitV2(id: string, body: string): OutfitV2 {
  const key = id + ':' + body;
  let o = outfitsV2.get(key);
  if (o) return o;
  const k = kitsV2.get(body)!;
  const of = k.meta.outfits[id];
  const t = SkeletonUtils.clone(k.template);
  const drop: THREE.Object3D[] = [];
  t.traverse((x) => {
    const m = x as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    if (m.userData.npc2 === 'garment' && !of.garments.includes(m.userData.garment)) { drop.push(m); return; }
    // Triangles all of whose corners this outfit hides.
    const h = m.geometry.getAttribute('_hide');
    if (!h) return;
    const g = m.geometry.clone();
    const ix = g.index!, keep: number[] = [];
    const hid = (i: number) => (Math.round(h.getX(i)) >> of.bit) & 1;
    for (let i = 0; i < ix.count; i += 3) {
      const a = ix.getX(i), b = ix.getX(i + 1), c = ix.getX(i + 2);
      if (!(hid(a) && hid(b) && hid(c))) keep.push(a, b, c);
    }
    g.setIndex(keep);
    g.deleteAttribute('_hide');
    // The bind pose, for the weave (fabric.ts lays it in metres on the rest shape).
    if (m.userData.npc2 === 'garment') {
      g.setAttribute('rest', g.attributes.position);
      g.setAttribute('restN', g.attributes.normal);
      g.setAttribute('color', grime(g, k.m));
    }
    m.geometry = g;
  });
  drop.forEach((d) => d.parent!.remove(d));
  t.updateMatrixWorld(true);
  const garment = beltOf(t, k.m, k.meta);
  t.traverse((x) => {
    const b = x.userData.npc2_brooch as number[] | undefined;
    // (Blender's Z-up bind-pose coordinates.)
    if (b && x.userData.npc2 === 'garment') garment.brooch = new THREE.Vector3(b[0], b[2], -b[1]);
  });
  o = {
    v2: true, id, body, sex: k.sex, template: t, m: k.m,
    garment,
    garments: of.garments.map((g) => ({ id: g, ...k.meta.garments[g] })),
  };
  outfitsV2.set(key, o);
  return o;
}

/** Where a belt sits (for fittings hung on it): the waist of the outermost body garment, measured round. */
function beltOf(t: THREE.Object3D, M: Measure, meta: BodyMeta): Garment {
  const y = THREE.MathUtils.lerp(M.bone('Hips').y, M.bone('Spine1').y, 0.55);
  const hips = M.bone('Hips');
  const rs = new Float32Array(36).fill(0);
  const v = new THREE.Vector3();
  t.traverse((x) => {
    const m = x as THREE.SkinnedMesh;
    // The tunic or gown only (in the bind pose the arms hang out at waist height).
    if (!m.isSkinnedMesh || m.userData.npc2 !== 'garment' || !/tunic|belt/.test(meta.garments[m.userData.garment]?.layer ?? '')) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.y - y) > 0.02 || Math.hypot(v.x - hips.x, v.z - hips.z) > 0.3) continue;
      const a = Math.atan2(v.x - hips.x, v.z - hips.z), r = Math.hypot(v.x - hips.x, v.z - hips.z);
      const k = ((Math.round((a / (Math.PI * 2)) * 36) % 36) + 36) % 36;
      rs[k] = Math.max(rs[k], r);
    }
  });
  const r = (a: number) => {
    const f = ((a / (Math.PI * 2)) * 36 % 36 + 36) % 36, i = Math.floor(f), j = (i + 1) % 36;
    return THREE.MathUtils.lerp(rs[i] || 0.15, rs[j] || 0.15, f - i);
  };
  return { belt: { y, cx: hips.x, cz: hips.z, r } } as unknown as Garment;
}

/**
 * Wear baked into a garment's vertex colours (multiplied over the dye):
 * dust and mud splashed up the hem from the street, fading out by the knee,
 * and the grubby, worn edges of cuffs round the wrists.
 */
function grime(g: THREE.BufferGeometry, M: Measure) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  const wr = [M.bone('LeftHand'), M.bone('RightHand')], v = new THREE.Vector3();
  const mud = new THREE.Color(0.72, 0.62, 0.5);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const hem = (1 - THREE.MathUtils.smoothstep(v.y, 0.04, 0.5)) * (0.75 + 0.25 * Math.sin(v.x * 37 + v.z * 23));
    const cuff = Math.max(...wr.map((w) => (1 - THREE.MathUtils.smoothstep(v.distanceTo(w), 0.03, 0.12)))) * 0.6;
    const k = Math.min(1, hem + cuff);
    c[i * 3] = THREE.MathUtils.lerp(1, mud.r, k);
    c[i * 3 + 1] = THREE.MathUtils.lerp(1, mud.g, k);
    c[i * 3 + 2] = THREE.MathUtils.lerp(1, mud.b, k);
  }
  return new THREE.BufferAttribute(c, 3);
}
