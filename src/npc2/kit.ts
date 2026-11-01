import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { canon, mixamoFrames, retarget, withAtmos, type Motion } from '../npc/rig';
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
// The default townsfolk; ?npc=v1 for the older ones (src/npc.ts).

export type Sex = 'man' | 'woman';
export interface BodyMeta {
  body: string; sex: Sex; height: number;
  /** Coherent native anatomy and authored skin; preserve bone axes and binds. */
  nativeCharacter?: boolean;
  garments: Record<string, { fabric: string; layer: string; depth: number; map?: 'detail' | 'color' }>;
  outfits: Record<string, { garments: string[]; bit: number }>;
  /** Belts made for each body garment (tools/npc3/wardrobe_build.py): the default, and one per style. */
  belts?: Record<string, { default: string; styles: Partial<Record<BeltStyle, string>> }>;
}
/** How a person is girded (tools/npc3/wardrobe.json): a leather strap, a cord (rope or cingulum), a woven sash (girdle). */
export type BeltStyle = 'leather' | 'cord' | 'sash';
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
export async function loadV2(get: (u: string) => Promise<GLTF>, ual: GLTF, walkSource?: GLTF) {
  const got = await Promise.all(BODIES_V2.map((b) => get(DIR + b.id + '.json').then((g) => [b, g] as const).catch((e) => { console.warn('npc2', b.id, e); return null; })));
  for (const r of got) {
    if (!r) continue;
    const [b, g] = r;
    const t = g.scene;
    const encoded = g.scene.userData.npc2 ?? g.parser.json.scenes?.[0]?.extras?.npc2 ?? {};
    const meta = (typeof encoded === 'string' ? JSON.parse(encoded) : encoded) as BodyMeta;
    const native = meta.nativeCharacter === true || g.scene.userData.nativeCharacter === true;
    t.userData.nativeCharacter = native;
    prep(t, native);
    if (!native) mixamoFrames(t);
    t.updateMatrixWorld(true);
    let top = native ? Number(g.scene.userData.nativeHeight ?? 0) : 0;
    t.traverse((o) => { if (!native && canon(o.name) === 'HeadTop_End') top = o.getWorldPosition(new THREE.Vector3()).y; });
    if (native && !(top > 0)) top = new THREE.Box3().setFromObject(t).getSize(new THREE.Vector3()).y;
    const options = { preserveSpine: native };
    const motion = retarget(t, ual, walkSource ? ['idle', 'talk', 'bless', 'kneel', 'pickup', 'interact'] : undefined, options);
    if (walkSource) {
      const walk = retarget(t, walkSource, ['walk', 'walkFormal'], options);
      // CMU captures body motion, not individual fingers. Keep the relaxed
      // authored idle hand rather than blending uncovered fingers to T-pose.
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
    kitsV2.set(b.id, { id: b.id, sex: b.sex, template: t, motion, m: measureBody(t), scale: (meta.height || (native ? top : 1.7)) / (top || 1.8), meta });
  }
}

/** Mesh roles by name; the rest pose kept as `rest`/`restN` for the fabric shader. */
function prep(t: THREE.Object3D, native: boolean) {
  t.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    m.castShadow = false;
    // (A mesh of several materials loads as a group of meshes, named after it.)
    const n = /^G_|body|eye|low-poly/i.test(m.name) ? m.name : m.parent?.name ?? m.name;
    const nativePart = m.userData.nativePart ?? m.parent?.userData.nativePart;
    m.userData.npc2 = nativePart === 'skin' ? 'body' : nativePart === 'eyes' ? 'eyes' : /^G_/.test(n) ? 'garment' : /body/.test(n) ? 'body' : /eye|low-poly/i.test(n) ? 'eyes' : 'part';
    if (native && m.userData.npc2 !== 'garment') {
      // Native skin, eyes and hair already have their authored UVs/materials.
      // Only add the game's atmosphere: no scan pores, beard paint or tint.
      const prepare = (material: THREE.Material) => {
        const mat = material.clone() as THREE.MeshStandardMaterial;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        return withAtmos(mat);
      };
      m.material = Array.isArray(m.material) ? m.material.map(prepare) : prepare(m.material);
      return;
    }
    if (m.userData.npc2 === 'eyes') {
      // Wet, a little shadowed by the lids: a soft highlight, the whites not paper-white.
      const src = m.material as THREE.MeshStandardMaterial;
      if (src.map) src.map.colorSpace = THREE.SRGBColorSpace;
      m.material = new THREE.MeshStandardMaterial({ map: src.map, color: 0xc8beb4, roughness: 0.18, metalness: 0 });
    }
    if (m.userData.npc2 === 'garment') { m.userData.garment = n.replace(/^G_/, '').replace(/_\d+$/, ''); if (!native) outward(m.geometry); }
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

/**
 * A garment's faces turned to face out from the wearer (some of the
 * artists' meshes are wound inside out): their inner side is shaded as the
 * cloth's inside (dress.ts), so it must be the side towards the body.
 * Judged by the vertex normals against the direction away from the body's
 * vertical axis, over the whole garment; normals and winding flipped
 * together.
 */
function outward(g: THREE.BufferGeometry) {
  const P = g.attributes.position, N = g.attributes.normal;
  if (!N || !g.index) return;
  let cx = 0, cz = 0;
  for (let i = 0; i < P.count; i++) { cx += P.getX(i); cz += P.getZ(i); }
  cx /= P.count; cz /= P.count;
  // Judged by the normals and by the winding: only a mesh wound and shaded
  // inside out both ways is turned (a two-layered hood, its lining facing
  // in, is shaded as modelled).
  let s = 0;
  for (let i = 0; i < P.count; i++) s += N.getX(i) * (P.getX(i) - cx) + N.getZ(i) * (P.getZ(i) - cz);
  const I = g.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let w = 0;
  for (let i = 0; i < I.count; i += 3) {
    a.fromBufferAttribute(P, I.getX(i)); b.fromBufferAttribute(P, I.getX(i + 1)); c.fromBufferAttribute(P, I.getX(i + 2));
    const mx = (a.x + b.x + c.x) / 3 - cx, mz = (a.z + b.z + c.z) / 3 - cz;
    b.sub(a); c.sub(a); b.cross(c);
    w += b.x * mx + b.z * mz;
  }
  g.userData.flipped = (s < 0 ? 'N' : '') + (w < 0 ? 'W' : '');
  if (s >= 0 || w >= 0) return;
  for (let i = 0; i < N.count; i++) N.setXYZ(i, -N.getX(i), -N.getY(i), -N.getZ(i));
  for (let i = 0; i < I.count; i += 3) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); }
  N.needsUpdate = true; I.needsUpdate = true;
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
export function outfitV2(id: string, body: string, belt?: BeltStyle): OutfitV2 {
  const key = id + ':' + body + (belt ? ':' + belt : '');
  let o = outfitsV2.get(key);
  if (o) return o;
  const k = kitsV2.get(body)!;
  const base = k.meta.outfits[id];
  // The person's own belt in place of the outfit's default, where one of that style was made for the garment.
  const garments = base.garments.map((g) => {
    for (const b of Object.values(k.meta.belts ?? {})) if (b.default === g && belt && b.styles[belt]) return b.styles[belt]!;
    return g;
  });
  const of = { ...base, garments };
  const t = SkeletonUtils.clone(k.template);
  const drop: THREE.Object3D[] = [];
  t.traverse((x) => {
    const m = x as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    if (m.userData.npc2 === 'garment' && !of.garments.includes(m.userData.garment)) { drop.push(m); return; }
    // Triangles all of whose corners this outfit hides.
    const h = m.geometry.getAttribute('_hide');
    if (!h && m.userData.npc2 !== 'garment') return;
    const g = m.geometry.clone();
    if (h) {
      const ix = g.index!, keep: number[] = [];
      const hid = (i: number) => (Math.round(h.getX(i)) >> of.bit) & 1;
      for (let i = 0; i < ix.count; i += 3) {
        const a = ix.getX(i), b = ix.getX(i + 1), c = ix.getX(i + 2);
        if (!(hid(a) && hid(b) && hid(c))) keep.push(a, b, c);
      }
      g.setIndex(keep);
      g.deleteAttribute('_hide');
    }
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
  let y = THREE.MathUtils.lerp(M.bone('Hips').y, M.bone('Spine1').y, 0.55);
  const hips = M.bone('Hips');
  const rs = new Float32Array(36).fill(0);
  const v = new THREE.Vector3();
  // Use the belt that was actually fitted to this body, not an anatomical
  // waist estimate: otherwise fittings and the sword float above its strap.
  // The densest horizontal band excludes a hanging belt end / rope knot.
  const bands = new Map<number, { sum: number; count: number }>();
  t.traverse((x) => {
    const m = x as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || m.userData.npc2 !== 'garment' || meta.garments[m.userData.garment]?.layer !== 'belt') return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.y - y) > 0.2 || Math.hypot(v.x - hips.x, v.z - hips.z) > 0.3) continue;
      const bin = Math.round(v.y / 0.02), band = bands.get(bin) ?? { sum: 0, count: 0 };
      band.sum += v.y; band.count++; bands.set(bin, band);
    }
  });
  let count = 0;
  for (const band of bands.values()) if (band.count > count) { y = band.sum / band.count; count = band.count; }
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
