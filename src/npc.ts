import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadGltf } from './gltf';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Lamp } from './builder';
import { isReading } from './codex';
import { retarget, relaxArms, legIK, wool, matte, makeWeave, withAtmos, canon, type ClipName, type Motion } from './npc/rig';
import { prepScanBody } from './npc/scan';
import { dressBody, faceSwap, faceOnly, buildGarment, bakeHeadShade, measure, addSkirtBones, addSwingBones, swingRig, type GarmentSpec, type Garment, type Measure } from './npc/garment';
import { Clothing, clothStats } from './npc/cloth';
import * as Props from './npc/props';
import { makeStaff } from './npc/population-props';
import { fabric, type FabricKind } from './npc/fabric';
import { LINES, NAMES, TITLE, type Line, type Speaker } from './npc/lines';
import { loadV2, kitsV2, bodiesV2, outfitV2, type OutfitV2 } from './npc2/kit';
import { dressV2 } from './npc2/dress';
import { makeSprings } from './npc2/springs';

/** Townsfolk v2 (src/npc2): MakeHuman bodies in modelled garments, the default; `?npc=v1` for the older bodies. */
export const NPC_V2 = typeof location !== 'undefined' && new URLSearchParams(location.search).get('npc') !== 'v1';

// Townsfolk: monks, peasant men and women, and Lombard soldiers (arimanni)
// walking the streets, standing in talking groups and keeping the gates.
//
// Bodies: two realistic rigged humans (src/npc/rig.ts) animated with
// retargeted motion-capture-style clips. Clothes: period garments generated
// around each body and skinned to it (src/npc/garment.ts), simulated as cloth
// for the few people nearest the camera (src/npc/cloth.ts). Dyes are the
// muted ones a Lombard town had: undyed wool, madder, woad, weld. Props and
// arms in src/npc/props.ts; what they say in src/npc/lines.ts.
//
// Walk up to someone and press E (or the Loquere button) to speak with them.

const DIR = 'models/npc/';

type Sex = 'man' | 'woman';
/**
 * The bodies: photogrammetry scans of real people (Renderpeople, packed by
 * tools/fetch-people.ts, see public/models/npc/CREDITS.md), each re-dressed
 * in period clothes. Heights are the period's: men about 1.70 m, women 1.58.
 */
export type BodyId = 'eric' | 'nathan' | 'manuel' | 'claudia' | 'sophia';
const BODIES: Record<BodyId, { sex: Sex; height: number }> = {
  eric: { sex: 'man', height: 1.72 }, nathan: { sex: 'man', height: 1.7 }, manuel: { sex: 'man', height: 1.69 },
  claudia: { sex: 'woman', height: 1.6 }, sophia: { sex: 'woman', height: 1.57 },
};
export type Role = Speaker;
type OutfitId = 'monk' | 'monkBare' | 'peasantHood' | 'peasantCloak' | 'soldier' | 'soldierCloak' | 'woman' | 'womanShawl';
export interface OutfitDef { sex: Sex; bodies: BodyId[]; spec: GarmentSpec; beard: boolean; wraps: boolean; tonsure?: boolean }

// Which bodies wear an outfit: every pairing is tailored once at load.
const OUTFITS: Record<OutfitId, OutfitDef> = {
  monk: { sex: 'man', bodies: ['manuel', 'eric'], beard: false, wraps: false, spec: { hem: 'ankle', flare: 0.15, folds: 0.032, sleeve: 'bell', hood: 'cowl', scapular: true, belt: 'rope', tail: true, stride: 0.85 } },
  // A monk in habit and scapular without his cowl, the crown of his head shaven.
  monkBare: { sex: 'man', bodies: ['manuel', 'eric'], beard: false, wraps: false, tonsure: true, spec: { hem: 'ankle', flare: 0.15, folds: 0.032, sleeve: 'bell', hood: null, scapular: true, belt: 'rope', tail: true, stride: 0.85 } },
  peasantHood: { sex: 'man', bodies: ['nathan'], beard: true, wraps: true, spec: { hem: 'knee', flare: 0.2, folds: 0.03, sleeve: 'fitted', hood: 'hood', belt: 'leather', thighs: 0.6, swing: true } },
  peasantCloak: { sex: 'man', bodies: ['eric'], beard: true, wraps: true, spec: { hem: 'knee', flare: 0.2, folds: 0.03, sleeve: 'fitted', hood: null, cape: 'cloak', belt: 'leather', thighs: 0.35, swing: true } },
  soldier: { sex: 'man', bodies: ['nathan', 'manuel'], beard: true, wraps: true, spec: { hem: 'knee', flare: 0.18, folds: 0.025, sleeve: 'fitted', hood: null, belt: 'leather', legFollow: 0.6 } },
  soldierCloak: { sex: 'man', bodies: ['eric'], beard: true, wraps: true, spec: { hem: 'knee', flare: 0.18, folds: 0.025, sleeve: 'fitted', hood: null, cape: 'cloak', belt: 'leather', legFollow: 0.3, capeOpen: 0.8 } },
  woman: { sex: 'woman', bodies: ['claudia', 'sophia'], beard: false, wraps: false, spec: { hem: 'ankle', flare: 0.2, trail: 0.2, folds: 0.026, sleeve: 'fitted', hood: 'veil', belt: 'sash', stride: 0.85 } },
  womanShawl: { sex: 'woman', bodies: ['sophia', 'claudia'], beard: false, wraps: false, spec: { hem: 'ankle', flare: 0.2, trail: 0.2, folds: 0.026, sleeve: 'fitted', hood: 'veil', cape: 'shawl', belt: 'sash', stride: 0.85 } },
};
/** More outfits (src/npc/population.ts), tailored on first use like the others. */
export function registerOutfit(id: string, def: OutfitDef) { (OUTFITS as Record<string, OutfitDef>)[id] = def; }
export const outfitBodies = (id: string): string[] => {
  const d = (OUTFITS as Record<string, OutfitDef>)[id];
  const v2 = NPC_V2 && d ? bodiesV2(id, d.sex) : [];
  return v2.length ? v2 : d?.bodies ?? [];
};
/** Whether an `outfit:body` pairing is already tailored (dressing someone in it then costs nothing extra). */
export const outfitTailored = (key: string) => outfits.has(key) || (NPC_V2 && kitsV2.has(key.split(':')[1]));
const ROLE_OUTFITS: Record<Role, OutfitId[]> = { monk: ['monk', 'monkBare'], peasant: ['peasantHood', 'peasantCloak'], woman: ['woman', 'womanShawl'], soldier: ['soldier', 'soldierCloak'] };

// Natural dyes on wool and linen, muted and a little faded.
const DYES = {
  undyed: [0x6e6250, 0x5a5042, 0x4a4036, 0x7a6e5a, 0x3e352c],
  madder: [0x6a3428, 0x7a4232, 0x5e2a22, 0x8a5444],
  woad: [0x3a4656, 0x46505c, 0x34404e],
  weld: [0x7a6c3a, 0x5e5a36, 0x6e6a44],
  habit: [0x1f1813, 0x241c16, 0x2a2219, 0x1c1a17],
  linen: [0xb8ae98, 0xa89c84, 0xc2b8a2],
};
const pick = <T>(r: () => number, a: T[]) => a[Math.floor(r() * a.length) % a.length];

interface KitData { id: BodyId; sex: Sex; template: THREE.Object3D; motion: Motion; m: Measure; scale: number }
interface Outfit { id: OutfitId; body: BodyId; sex: Sex; template: THREE.Object3D; garment: Garment; m: Measure }

let kits: Record<BodyId, KitData> | null = null;
/** Tailored outfits, by `${outfit}:${body}`. */
const outfits = new Map<string, Outfit>();
let scans: { basket: THREE.Object3D | null; bucket: THREE.Object3D | null; jar: THREE.Object3D | null } = { basket: null, bucket: null, jar: null };
let weave: THREE.Texture | null = null;
let loading: Promise<void> | null = null;

/** Dev switches and numbers (test page). */
export const npcDebug = { beard: null as number | null, prof: { anim: 0, logic: 0, frames: 0, springs: 0, springPeople: 0 }, springDist: 15, cloth: clothStats, maxSim: 3, simDist: 15, people: [] as Person[], buildMs: {} as Record<string, number> };

// ------------------------------------------------------------------ loading

/** Load bodies, animations and props, retarget, and tailor every outfit. */
export function loadNpcAssets(): Promise<void> {
  loading ??= (async () => {
    const loader = new GLTFLoader();
    const get = (u: string) => loadGltf(u, loader);
    const ids = Object.keys(BODIES) as BodyId[];
    const [ual, ...bodies] = await Promise.all([get(DIR + 'ual.json'), ...ids.map((id) => get(DIR + id + '.json'))]);
    // (Lighter copies of the town's scanned props: see tools/npc-props.ts.)
    const scan = (id: string, top = false) => get(DIR + id + '_lo.json').then((g) => Props.prepScan(g.scene, top)).catch(() => null);
    const [basket, bucket, jar] = await Promise.all([scan('wicker_basket_02', true), scan('wooden_bucket_01', true), scan('planter_pot_clay')]);
    scans = { basket, bucket, jar };
    // Older faces (see faceSwap).
    await Promise.all(Object.keys(FACES).map((id) => get(DIR + id + '.json').then((g) => {
      const m = g.scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
      const map = (m.material as THREE.MeshStandardMaterial).map!;
      map.colorSpace = THREE.SRGBColorSpace;
      faces.set(id, { geo: m.geometry, map });
    }).catch((e) => console.warn('face', id, e))));
    const t0 = performance.now();
    kits = {} as Record<BodyId, KitData>;
    ids.forEach((id, i) => {
      const t = bodies[i].scene, { sex, height } = BODIES[id];
      prepScanBody(t);
      t.userData.sex = sex;
      // Arms down to the Mixamo bodies' A-pose (60° below level) before tailoring: some scans are bound in a T-pose.
      {
        t.updateMatrixWorld(true);
        const w = (n: string) => t.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
        const d = w('LeftForeArm').sub(w('LeftArm'));
        const drop = Math.atan2(-d.y, Math.abs(d.x));
        if (drop < 0.95) relaxArms(t, 1.05 - drop);
      }
      // Under a veil only the face shows; the veil is fitted to the skull's ellipsoid.
      if (sex === 'woman') faceOnly(t);
      t.updateMatrixWorld(true);
      const m = measure(t, sex === 'woman' ? { rx: 0.074, rz: 0.094 } : undefined);
      let top = 0;
      t.traverse((o) => { if (canon(o.name) === 'HeadTop_End') top = o.getWorldPosition(new THREE.Vector3()).y; });
      kits![id] = { id, sex, template: t, motion: retarget(t, ual), m, scale: height / (top || 1.8) };
    });
    if (NPC_V2) {
      await loadV2(get, ual);
      for (const [id, k] of kitsV2) (kits as Record<string, KitData>)[id] = k as unknown as KitData;
    }
    npcDebug.buildMs.retarget = performance.now() - t0;
    (npcDebug as unknown as { heads: unknown }).heads = Object.fromEntries(Object.entries(kits).map(([k, v]) => [k, { ...v.m.head, c: v.m.head.c.toArray(), hb: v.m.bone('Head').toArray(), top: v.m.bone('HeadTop_End').toArray(), neck: v.m.bone('Neck').toArray(), hips: v.m.bone('Hips').toArray() }]));
    weave = makeWeave();
    // Outfits are tailored when first needed (see outfitFor): the town dresses
    // the people nearest the camera first, one outfit a frame.
  })();
  return loading;
}

/**
 * Older faces, scanned (tools/fetch-faces.ts; see public/models/npc/CREDITS.md),
 * worn by some of those whose head is covered (`share` of them): the hood or
 * cowl hides where face and head meet.
 */
const FACES: Record<string, { outfits: OutfitId[]; share: number }> = {
  face_grandpa: { outfits: ['monk', 'monkBare', 'peasantHood'], share: 0.4 },
};
const faces = new Map<string, { geo: THREE.BufferGeometry; map: THREE.Texture }>();

/** An outfit on a body, tailored on first use (0.2-0.7 s each); `outfit:body#face` with another face. */
function outfitFor(key: string): Outfit {
  if (NPC_V2 && kitsV2.has(key.split(':')[1])) return outfitV2(key.split(':')[0], key.split(':')[1]) as unknown as Outfit;
  let o = outfits.get(key);
  if (!o && key.includes('#')) {
    const [base, fid] = key.split('#'), b = outfitFor(base), f = faces.get(fid)!;
    const t = SkeletonUtils.clone(b.template);
    t.updateMatrixWorld(true);
    faceSwap(t, f.geo, f.map, b.m);
    if (OUTFITS[b.id].spec.hood) bakeHeadShade(t, b.garment.geo, OUTFITS[b.id].spec.hood === 'cowl' ? 0.1 : 0.32);
    o = { ...b, template: t };
    outfits.set(key, o);
  }
  if (!o) {
    const [id, body] = key.split(':') as [OutfitId, BodyId];
    const t1 = performance.now();
    o = tailor(id, body);
    npcDebug.buildMs[key] = Math.round(performance.now() - t1);
    outfits.set(key, o);
  }
  return o;
}

function tailor(id: OutfitId, body: BodyId): Outfit {
  const o = OUTFITS[id], k = kits![body];
  const t = SkeletonUtils.clone(k.template);
  t.updateMatrixWorld(true);
  dressBody(t, o.sex, { beard: o.beard, wraps: o.wraps, m: k.m, tonsure: o.tonsure });
  t.traverse((x) => { if (/Teeth/.test(x.name)) x.visible = false; });
  if (o.spec.swing) addSwingBones(t);
  if (o.spec.stride) {
    addSkirtBones(t);
    // Under a robe to the ankles the hose show only below the knee; above it
    // the trousers' wide seat and thighs would only poke through the skirt.
    const knee = k.m.bone('LeftLeg').y + 0.06, v = new THREE.Vector3();
    t.traverse((x) => {
      const m = x as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !/^(Wolf3D_Outfit_Bottom|Scan_Bottom)$/.test(m.name)) return;
      const ix = m.geometry.index!, keep: number[] = [];
      const low = (i: number) => m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y < knee;
      for (let i = 0; i < ix.count; i += 3) if (low(ix.getX(i)) || low(ix.getX(i + 1)) || low(ix.getX(i + 2))) keep.push(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2));
      m.geometry.setIndex(keep);
    });
  }
  if (o.spec.hem === 'knee') {
    // Under a tunic to the knee, the trousers' thighs are never seen.
    const keepBelow = k.m.bone('LeftLeg').y + 0.14, v = new THREE.Vector3();
    t.traverse((x) => {
      const m = x as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !/^(Wolf3D_Outfit_Bottom|Scan_Bottom)$/.test(m.name)) return;
      const ix = m.geometry.index!, keep: number[] = [];
      const low = (i: number) => m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y < keepBelow;
      for (let i = 0; i < ix.count; i += 3) if (low(ix.getX(i)) || low(ix.getX(i + 1)) || low(ix.getX(i + 2))) keep.push(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2));
      m.geometry = m.geometry.clone();
      m.geometry.setIndex(keep);
    });
  }
  const garment = buildGarment(t, k.template, k.m, o.spec);
  if (o.spec.hood) bakeHeadShade(t, garment.geo, o.spec.hood === 'cowl' ? 0.1 : 0.32);
  return { id, body, sex: o.sex, template: t, garment, m: k.m };
}

// ------------------------------------------------------------------ a person

/**
 * Who a person is, beyond the four base roles (see src/npc/population.ts):
 * name, title and lines; skin, hair and dress; size (children); and extra
 * things to wear or carry, hung on the body by `equip`.
 */
export interface Look {
  name?: string; title?: string; lines?: Line[];
  /** Skin: 0-1 along the existing tan and olive axes, and a lightness factor. */
  skin?: { tan: number; olive: number; light?: number };
  hair?: number; grey?: number; beard?: number;
  /** Clothes: tunic, overgarment, headcloth, belt colours and the fabric kinds of the first three. */
  colors?: { tunic: number; over: number; head: number; belt?: number; beltKind?: FabricKind; kinds?: [FabricKind, FabricKind, FabricKind] };
  /** Body scale against the body's own (children), and the head's scale on it. */
  scale?: number; headScale?: number;
  equip?: (h: EquipHooks) => void;
}
export interface EquipHooks {
  person: Person; m: Measure; belt: Garment['belt']; rnd: () => number;
  /** Hang an object on a bone, given where it sits in the bind pose. */
  on: (bone: string, obj: THREE.Object3D, place: THREE.Matrix4) => void;
}
export interface Gear { staff?: boolean; lantern?: boolean; cap?: boolean; helmet?: boolean | 'spangen' | 'lamellar'; shield?: 'back' | 'arm'; spear?: boolean; arms?: boolean; sticks?: boolean; bucket?: boolean; basket?: boolean; jar?: boolean }
interface Held { obj: THREE.Object3D; kind: 'hang' | 'spear' | 'arm'; drop: number; swing: { a: number; v: number; b: number; w: number }; last: THREE.Vector3 }

const ANIMS: ClipName[] = ['walk', 'idle', 'talk', 'bless', 'kneel'];
const UP = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0);
const _sv = new THREE.Vector3();
const _gs = new THREE.Vector3(), _ge = new THREE.Vector3(), _gp = new THREE.Vector3();
const _gq = new THREE.Quaternion(), _gw = new THREE.Quaternion(), _gr = new THREE.Quaternion(), _gx = new THREE.Vector3(), _gd = new THREE.Vector3(), _gt = new THREE.Vector3(), _gz = new THREE.Vector3(), _gm = new THREE.Matrix4();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _h3 = new THREE.Vector3(), _h4 = new THREE.Vector3(), _h5 = new THREE.Vector3(), _h6 = new THREE.Vector3(), _h7 = new THREE.Vector3(), _h8 = new THREE.Vector3(), _hq = new THREE.Quaternion();

let rngSeed = 1;
const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export class Person {
  group = new THREE.Group();
  body: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  acts = {} as Record<ClipName, THREE.AnimationAction>;
  w = {} as Record<ClipName, number>;
  want = {} as Record<ClipName, number>;
  skeleton!: THREE.Skeleton;
  cloth: Clothing;
  scale: number;
  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  name: string;
  lines: Line[];
  line = 0;
  held: Held[] = [];
  lamp: Lamp | null = null;
  lanternLight: THREE.Object3D | null = null;
  look = { yaw: 0, target: 0, timer: 0 };
  animAcc = 0;
  tick = 0;
  visible = true;
  dist = 0;
  private bones = new Map<string, THREE.Bone>();
  private kit: KitData;
  private swing: (() => void) | null;
  /** A woman's load: a jar balanced on the head, or a basket over the right forearm. */
  private load: { jar: THREE.Object3D | null; jarQ: THREE.Quaternion; basket: boolean } = { jar: null, jarQ: new THREE.Quaternion(), basket: false };

  title: string;
  constructor(private scene: THREE.Scene, public outfit: Outfit, public role: Role, public rnd: () => number, gear: Gear, public persona: Look = {}) {
    const k = (this.kit = kits![outfit.body]);
    this.scale = k.scale * (persona.scale ?? 0.94 + rnd() * 0.12);
    this.body = SkeletonUtils.clone(outfit.template);
    this.group.add(this.body);
    this.group.scale.setScalar(this.scale);
    scene.add(this.group);
    this.body.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if ((o as THREE.Bone).isBone) this.bones.set(canon(o.name), o as THREE.Bone);
      if (m.isSkinnedMesh && !this.skeleton) this.skeleton = m.skeleton;
    });
    this.swing = swingRig(this.body, (n) => this.bones.get(n)!);
    this.name = persona.name ?? pick(rnd, NAMES[role]);
    this.lines = persona.lines ?? LINES[role];
    this.title = persona.title ?? TITLE[role];
    if (persona.headScale) this.bones.get('Head')?.scale.setScalar(persona.headScale);
    this.line = Math.floor(rnd() * this.lines.length);

    // Skin, within what a Lombard town held: from fair (Lombards, some
    // Latins) through olive to a light Mediterranean tan (Greeks, Levantines,
    // North Africans), more or less weathered: a shift along the warm/olive
    // axis and a little lightness, applied over each scan's own tone.
    const tan = persona.skin?.tan ?? rnd(), olive = persona.skin?.olive ?? rnd() * 0.6, light = persona.skin?.light ?? 0.96 + rnd() * 0.1;
    // Lombards wore their beards long; most townsmen here have one, short or
    // full, brown to black, greying with age. (Monks are shaven.)
    const hairCol = new THREE.Color(persona.hair ?? pick(rnd, [0x2a1d15, 0x1c1510, 0x3a2a1e, 0x4a3524, 0x2e2420])).lerp(new THREE.Color(0x8a8580), persona.grey ?? (rnd() < 0.25 ? 0.35 + rnd() * 0.3 : 0));
    const beardAmt = persona.beard ?? (outfit.sex === 'man' && role !== 'monk' && rnd() < 0.75 ? 0.75 + rnd() * 0.5 : 0);
    const beard = new THREE.Vector4(outfit.sex === 'man' ? npcDebug.beard ?? beardAmt : 0, hairCol.r, hairCol.g, hairCol.b);
    const tone = new THREE.Color().setRGB(1.04 - 0.08 * tan, 1.0 - 0.1 * tan + 0.02 * olive, 0.98 - 0.16 * tan - 0.03 * olive).multiplyScalar(light);
    this.body.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const re = (mat: THREE.Material) => {
        if (!mat.userData.skin) return mat;
        const c = (mat as THREE.MeshStandardMaterial).clone();
        c.color.multiply(tone);
        c.userData = { ...mat.userData, uBeard: { value: beard } };
        return withAtmos(c, { skin: true, scan: !!mat.userData.scan });
      };
      m.material = Array.isArray(m.material) ? m.material.map(re) : re(m.material);
    });

    // Clothes: dyes by station.
    const dirt = new THREE.Color(0x5a4a38);
    const dye = (hex: number, d = 0.15) => new THREE.Color(hex).lerp(dirt, d * rnd()).multiplyScalar(0.9 + rnd() * 0.2);
    const W = weave!;
    let tunic: THREE.Color, over: THREE.Color, belt: THREE.Material, head: THREE.Color;
    let ropeMat: THREE.Material | null = null;
    if (role === 'monk') {
      tunic = dye(pick(rnd, DYES.habit), 0.05); over = tunic.clone().multiplyScalar(0.85); head = tunic;
      belt = ropeMat = matte(0x6e5c40, 0.95);
    } else if (role === 'woman') {
      tunic = dye(pick(rnd, [...DYES.madder, ...DYES.woad, ...DYES.undyed, ...DYES.weld]));
      over = dye(pick(rnd, [...DYES.undyed, ...DYES.woad]));
      head = dye(pick(rnd, DYES.linen), 0.1);
      belt = fabric('tabby', dye(pick(rnd, [...DYES.madder, ...DYES.weld, ...DYES.undyed])));
    } else if (role === 'soldier') {
      tunic = dye(pick(rnd, [...DYES.madder, ...DYES.woad, DYES.undyed[0], DYES.undyed[2]]));
      over = dye(pick(rnd, [...DYES.undyed, ...DYES.woad]));
      head = over;
      belt = fabric('leather', 0x2e1e12);
    } else {
      tunic = dye(pick(rnd, [...DYES.undyed, ...DYES.undyed, ...DYES.madder, ...DYES.weld, ...DYES.woad]), 0.3);
      over = dye(pick(rnd, DYES.undyed), 0.3);
      head = dye(pick(rnd, [...DYES.undyed, ...DYES.weld]), 0.3);
      belt = fabric('leather', 0x3a2618);
    }
    const lc = persona.colors;
    if (lc) {
      tunic = dye(lc.tunic); over = dye(lc.over); head = dye(lc.head, 0.1);
      if (lc.belt !== undefined) belt = fabric(lc.beltKind ?? 'leather', dye(lc.belt));
    }
    // Coarse tabby homespun; twill for gowns and soldiers' tunics; fulled wool (felt) for cloaks; linen veils.
    const kinds: FabricKind[] = lc?.kinds ?? (role === 'monk' ? ['tabby', 'tabby', 'tabby'] : role === 'woman' ? ['twill', 'twill', 'linen'] : role === 'soldier' ? ['twill', 'felt', 'tabby'] : ['tabby', 'felt', 'tabby']);
    const mats = [fabric(kinds[0], tunic), fabric(kinds[1], over), belt, fabric(kinds[2], head)];
    // A long skirt is also skinned to helper bones that swing with the thighs.
    let skel = this.skeleton;
    const v2 = (outfit as unknown as OutfitV2).v2;
    const extra = outfit.garment.extraBones;
    if (extra) {
      skel = new THREE.Skeleton([...skel.bones, ...extra.map((e) => this.bones.get(e.name)!)], [...skel.boneInverses, ...extra.map((e) => e.inv)]);
      this.strideBones = extra.map((e, i) => {
        const up = this.bones.get(i ? 'RightUpLeg' : 'LeftUpLeg')!, leg = this.bones.get(i ? 'RightLeg' : 'LeftLeg')!, bone = this.bones.get(e.name)!;
        return { up, leg, bone, rest: bone.quaternion.clone(), bind: leg.position.clone().applyQuaternion(up.quaternion).normalize() };
      });
    }
    const sk = outfit.garment.skirt;
    if (sk) {
      // The skirt's front and back panels (garment.ts): two bones at the hip
      // joints, under the pelvis, swung by the legs (see swingSkirt).
      const local = this.bindOf('Hips').invert().multiply(new THREE.Matrix4().makeTranslation(sk.pivot));
      const inv = new THREE.Matrix4().makeTranslation(-sk.pivot.x, -sk.pivot.y, -sk.pivot.z);
      this.skirt = [0, 1].map(() => { const b = new THREE.Bone(); local.decompose(b.position, b.quaternion, b.scale); this.bones.get('Hips')!.add(b); return b; });
      this.skirtRest = this.skirt[0].quaternion.clone();
      this.hipsBindQ = new THREE.Quaternion().setFromRotationMatrix(this.bindOf('Hips'));
      this.thighBind = ['Left', 'Right'].map((s) => { const d = outfit.m.bone(s + 'Leg').sub(outfit.m.bone(s + 'UpLeg')); return Math.atan2(d.z, -d.y); });
      skel = new THREE.Skeleton([...skel.bones, ...this.skirt], [...skel.boneInverses, inv, inv.clone()]);
    }
    this.cloth = v2
      ? dressV2(this.body, outfit as unknown as OutfitV2, { tunic, over, head, belt, leg: dye(pick(rnd, [...DYES.undyed, ...DYES.woad]), 0.3), shoe: new THREE.Color(0x8a7a6a).multiplyScalar(0.8 + rnd() * 0.3), kinds: lc?.kinds, role }) as unknown as Clothing
      : new Clothing(scene, outfit.garment, skel, mats, ropeMat, this.scale, (n) => this.bones.get(n)!);
    if (v2) this.springs = makeSprings(this.body, outfit as unknown as OutfitV2, this.scale, (n) => this.bones.get(n));

    // Motion.
    this.mixer = new THREE.AnimationMixer(this.body);
    const walkClip = role === 'monk' ? 'walkFormal' : 'walk';
    for (const n of ANIMS) {
      const a = this.mixer.clipAction(k.motion.clips[n === 'walk' ? walkClip : n]);
      a.play();
      a.time = rnd() * a.getClip().duration;
      a.setEffectiveWeight(n === 'idle' ? 1 : 0);
      this.acts[n] = a;
      this.w[n] = this.want[n] = n === 'idle' ? 1 : 0;
    }
    this.walkSpeed = k.motion.speed[walkClip] > 0.3 && k.motion.speed[walkClip] < 3 ? k.motion.speed[walkClip] : 1.2;
    this.walkStart = k.motion.start[walkClip];
    this.legs = (['Left', 'Right'] as const).map((S) => ({
      chain: [S + 'UpLeg', S + 'Leg', S + 'Foot'].map((n) => this.bones.get(n)!), toe: this.bones.get(S + 'ToeBase')!,
      hA: k.m.bone(S + 'Foot').y, hT: k.m.bone(S + 'ToeBase').y,
    }));

    this.equip(gear);
  }
  walkSpeed = 1.2;
  /** v2: the cloth bones' spring update (src/npc2/springs.ts), and the time it steps. */
  private springs: ReturnType<typeof makeSprings> = null;
  private springDt = 0;
  /** Half the width of a bucket or basket a peasant carries (0: none). */
  carryHalf = 0;
  private walkStart = 0;
  /** How fast the body is turning (rad/s), and how far it is lifted to stand on uneven ground. */
  yawRate = 0;
  private lastYaw = 0;
  private lift = 0;
  private legs: { chain: THREE.Bone[]; toe: THREE.Bone; hA: number; hT: number }[] = [];
  /** A lantern held out before him by its bail, the right arm bent at the elbow, whatever the clip does with it. */
  private grip: ReturnType<Person['makeGrip']> | null = null;
  private makeGrip() {
    const b = (n: string) => this.bones.get(n)!;
    const w = (n: string) => b(n).getWorldPosition(new THREE.Vector3());
    const fingers = ['Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((j) => ({ bone: b(`RightHand${f}${j}`), rest: b(`RightHand${f}${j}`).quaternion.clone(), curl: [1.25, 1.45, 0.85][j - 1] })));
    return {
      arm: b('RightArm'), fore: b('RightForeArm'), hand: b('RightHand'),
      upper: w('RightArm').distanceTo(w('RightForeArm')), lower: w('RightForeArm').distanceTo(w('RightHand')),
      // In the bind pose's frame (metres, facing +Z, his left +X): where the wrist is held, which way the elbow points.
      wrist: new THREE.Vector3(-0.33, 1.15, 0.26), pole: new THREE.Vector3(-0.6, -0.2, -1).normalize(), palm: new THREE.Vector3(-0.1, -0.75, 1).normalize(),
      fingers, knuckles: [b('RightHandIndex2'), b('RightHandMiddle2'), b('RightHandRing2'), b('RightHandPinky2')], across: [b('RightHandPinky1'), b('RightHandIndex1')],
    };
  }
  private holdLantern() {
    const G = this.grip!;
    // Two-bone IK in his own frame, not his chest's: whatever the torso does, the lantern is held out ahead, clear of the robe.
    const C = _gq.copy(this.group.quaternion);
    const medial = _gx.set(1, 0, 0).applyQuaternion(C);
    const S = G.arm.getWorldPosition(_gs), T = this.group.localToWorld(_ge.copy(G.wrist));
    const a = G.upper, bl = G.lower;
    const u = _gt.copy(T).sub(S);
    const d = THREE.MathUtils.clamp(u.length(), Math.abs(a - bl) + 1e-3, a + bl - 1e-3);
    u.normalize();
    const cosA = (a * a + d * d - bl * bl) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = _gz.copy(G.pole).applyQuaternion(C);
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    const E = _ge.copy(S).addScaledVector(u, a * cosA).addScaledVector(pole, a * sinA);
    const wrist = _gp.copy(S).addScaledVector(u, d);
    // Upper arm and forearm swung onto the elbow and the wrist (their twist left to the clip)...
    const swing = (bone: THREE.Bone, child: THREE.Bone, to: THREE.Vector3) => {
      bone.getWorldQuaternion(_gw);
      _gd.copy(child.position).applyQuaternion(_gw).normalize();
      _gw.premultiply(_gr.setFromUnitVectors(_gd, to));
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(_gr).invert().multiply(_gw));
      return _gw;
    };
    swing(G.arm, G.fore, _gt.copy(E).sub(S).normalize());
    const fy = _gs.copy(wrist).sub(E).normalize();
    const fw = swing(G.fore, G.hand, fy);
    // ...then the forearm turns half way towards palm-down, so the wrist need not wring the whole turn.
    _gd.copy(medial).addScaledVector(fy, -medial.dot(fy)).normalize();
    _gz.set(1, 0, 0).applyQuaternion(fw);
    const tw = Math.atan2(_gt.crossVectors(_gz, _gd).dot(fy), _gz.dot(_gd));
    G.fore.quaternion.multiply(_gr.setFromAxisAngle(_gt.set(0, 1, 0), tw * 0.5));
    // The hand palm-down: its Y along the fingers, X towards the thumb side.
    const basis = (bone: THREE.Bone, y: THREE.Vector3) => {
      _gd.copy(medial).addScaledVector(y, -medial.dot(y)).normalize();
      _gm.makeBasis(_gd, y, _gz.crossVectors(_gd, y));
      _gw.setFromRotationMatrix(_gm);
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(_gr).invert().multiply(_gw));
    };
    basis(G.hand, _gt.copy(G.palm).applyQuaternion(C));
    // Fingers closed round the bail.
    for (const f of G.fingers) f.bone.quaternion.copy(f.rest).multiply(_gr.setFromAxisAngle(_gx.set(1, 0, 0), f.curl));
  }
  private strideBones: { up: THREE.Bone; leg: THREE.Bone; bone: THREE.Bone; rest: THREE.Quaternion; bind: THREE.Vector3 }[] = [];
  private skirt: THREE.Bone[] | null = null;
  private skirtRest = new THREE.Quaternion();
  private hipsBindQ = new THREE.Quaternion();
  private thighBind = [0, 0];
  private spear: THREE.Object3D | null = null;
  /** What the left hand holds: a point on it, the line of the fist along it, the palm's facing (all in its own frame). */
  private leftGrip: { obj: THREE.Object3D; at: THREE.Vector3; axis: THREE.Vector3; palm: THREE.Vector3; depth: number; always: boolean; pole: THREE.Vector3 } | null = null;

  private bindOf(name: string) {
    const b = this.bones.get(name)!;
    const i = this.skeleton.bones.indexOf(b);
    return this.skeleton.boneInverses[i].clone().invert();
  }

  private equip(g: Gear) {
    const m = this.outfit.m, r = this.rnd;
    const on = (bone: string, obj: THREE.Object3D, place: THREE.Matrix4) => Props.hangOn(this.bones.get(bone)!, this.bindOf(bone), obj, place);
    // (Laymen's leg wraps run down into their ankle boots: see garment.ts makeBoots.)

    // A cloak's brooch, on the right shoulder, facing out.
    const br = this.outfit.garment.brooch;
    if (br) {
      const sp = m.bone('Spine2'), out = new THREE.Vector3(br.x - sp.x, 0.25, br.z - sp.z + 0.08).normalize();
      on('Spine2', Props.makeBrooch(), Props.placeAt(br.clone().addScaledVector(out, 0.004), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out)));
    }
    if (g.helmet) { const h = Props.makeHelmet(m, g.helmet === true ? 'spangen' : g.helmet); on('Head', h.obj, h.place); }
    // Felt in the colours of undyed and walnut-dyed wool.
    else if (g.cap) { const c = Props.makeCap(m, new THREE.Color(pick(r, [0x7e6a4e, 0x6e5a40, 0x8c7a5c, 0x5e4a34, 0x74603f]))); on('Head', c.obj, c.place); }
    const belt = this.outfit.garment.belt;
    if (g.arms) {
      on('Hips', Props.makeBeltFittings(belt, r() * 10), new THREE.Matrix4());
      // Spatha at the left hip, point trailing back.
      const aL = g.shield === 'arm' ? 1.85 : 1.42, rL = belt.r(aL) + 0.055; // behind the shield arm's wrist
      // It slants back and, below the belt, out over the flare of the skirt.
      const nL = new THREE.Vector3(Math.sin(aL), 0, Math.cos(aL)), tL = new THREE.Vector3(-Math.cos(aL), 0, Math.sin(aL));
      const yL = new THREE.Vector3(0, Math.cos(0.6), 0).addScaledVector(tL, Math.sin(0.6)).addScaledVector(nL, -0.1).normalize();
      const zL = nL.clone().addScaledVector(yL, -nL.dot(yL)).normalize();
      const spatha = Props.makeSpatha(), qS = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(yL.clone().cross(zL), yL, zL));
      // Walking or standing, his left hand rests on the hilt, palm down and in.
      const palm = new THREE.Vector3(-1, -1, 0).normalize().applyQuaternion(qS.clone().invert());
      if (g.shield !== 'arm') this.leftGrip = { obj: spatha, at: new THREE.Vector3(0, 0.055, 0), axis: new THREE.Vector3(0, -1, 0), palm, depth: 0.028, always: false, pole: new THREE.Vector3(0.5, -0.2, -1) };
      on('Hips', spatha, Props.placeAt(new THREE.Vector3(belt.cx + Math.sin(aL) * rL, belt.y - 0.01, belt.cz + Math.cos(aL) * rL - 0.02), qS));
      // The scramasax hangs flat against his right hip, behind the spear
      // hand, its point slanting down and back (under a cloak, out of sight).
      const aS = -1.95, rS = belt.r(aS) + 0.016, nS = new THREE.Vector3(Math.sin(aS), 0, Math.cos(aS));
      const dS = new THREE.Vector3(-Math.cos(aS), 0, Math.sin(aS)).multiplyScalar(-0.6).add(new THREE.Vector3(0, -0.8, 0)).normalize();
      const qSx = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dS, nS.clone().cross(dS), nS));
      if (!OUTFITS[this.outfit.id].spec.cape) on('Hips', Props.makeSeax(), Props.placeAt(new THREE.Vector3(belt.cx + Math.sin(aS) * rS, belt.y - 0.03, belt.cz + Math.cos(aS) * rS).addScaledVector(dS, 0.1), qSx));
    }
    if (g.shield) {
      const paint = new THREE.Color(pick(r, [0x7a3a2a, 0x8a7c64, 0x46505e, 0x6e6040, 0x7e5236]));
      const s = Props.makeShield(paint);
      if (g.shield === 'back') {
        const sp = m.bone('Spine2');
        on('Spine2', s, Props.placeAt(new THREE.Vector3(sp.x, sp.y - 0.06, sp.z - 0.21), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.14, Math.PI, 0.05))));
      } else {
        // Carried at his left side, his fist through the grip behind the boss
        // (see holdGear), the face turned outwards and a little forwards.
        // Hung from the hips, where his
        // hanging hand holds it, so walking never swings it into his legs.
        const hp = m.bone('Hips'), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 - 0.25, Math.PI / 2, 'YXZ'));
        const grip = new THREE.Vector3(hp.x + 0.33, hp.y - 0.12, hp.z + 0.04);
        on('Hips', s, Props.placeAt(grip.clone().addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(q), 0.065), q));
        this.leftGrip = { obj: s, at: new THREE.Vector3(0, 0, -0.065), axis: new THREE.Vector3(0, 1, 0), palm: new THREE.Vector3(0, 0, -1), depth: 0.022, always: true, pole: new THREE.Vector3(-0.15, 0, -1) };
      }
    }
    if (g.sticks) {
      const sp = m.bone('Spine2');
      // Clear of the hood's cape on his shoulders, its top end behind his head.
      const cape = this.outfit.id === 'peasantHood';
      on('Spine2', Props.makeSticks(Math.floor(r() * 1e6) + 1), Props.placeAt(new THREE.Vector3(sp.x + 0.02, sp.y - 0.12, sp.z - (cape ? 0.27 : 0.21)), new THREE.Quaternion().setFromEuler(new THREE.Euler(cape ? -0.2 : -0.12, 0, 0.42))));
    }
    if (g.jar) {
      const h = m.head;
      const jar = Props.makeHeadJar(scans.jar);
      // On its pad, sitting down over the veiled crown.
      on('Head', jar, Props.placeAt(new THREE.Vector3(h.c.x, h.top + 0.006, h.c.z - 0.01)));
      this.load.jar = jar;
      this.load.jarQ.copy(jar.quaternion);
    }
    const hang = (obj: THREE.Object3D, kind: Held['kind'], drop: number) => {
      obj.traverse((o) => { o.frustumCulled = false; });
      obj.scale.multiplyScalar(this.scale / this.kit.scale);
      this.scene.add(obj);
      this.held.push({ obj, kind, drop, swing: { a: 0, v: 0, b: 0, w: 0 }, last: new THREE.Vector3() });
    };
    if (g.lantern) {
      const l = Props.makeLantern();
      hang(l.group, 'hang', 0.03);
      this.lanternLight = l.light;
      this.grip = this.makeGrip();
      this.lamp = { pos: new THREE.Vector3(), color: new THREE.Color(1, 0.5, 0.18), intensity: 0.5, under: false, seed: r() * 50 };
    }
    // A peasant's are a size a man carries in one hand, the basket long side forward.
    const pz = this.role === 'peasant';
    if (g.bucket && scans.bucket) { const b = scans.bucket.clone(); b.scale.setScalar(pz ? 0.62 : 0.8); const o = new THREE.Group(); o.add(b); hang(o, 'hang', 0.02); this.carryHalf = 0.115; }
    if (g.basket && scans.basket && this.role === 'woman') {
      // Over the crook of her right arm, clear of her skirts.
      const b = Props.makeArmBasket(scans.basket);
      b.scale.setScalar(0.8);
      hang(b, 'arm', 0);
      this.load.basket = true;
    } else if (g.basket && scans.basket) { const b = scans.basket.clone(); b.scale.setScalar(pz ? 1.0 : 1.25); if (pz) b.rotation.y = Math.PI / 2; const o = new THREE.Group(); o.add(b); hang(o, 'hang', 0.0); this.carryHalf = 0.14; }
    if (g.spear || g.staff) {
      // Held in the right fist (see gripSpear): it rides on the hand bone.
      const s = (this.spear = g.staff ? makeStaff(r) : Props.makeSpear());
      s.traverse((o) => { o.frustumCulled = false; });
      this.bones.get('RightHand')!.add(s);
    }
    this.persona.equip?.({ person: this, m, belt, rnd: r, on });
  }

  bone(n: string) { return this.bones.get(n)!; }

  /** Swing the skirt's front panel with the leading thigh, the back with the trailing one. */
  private swingSkirt() {
    const hips = this.bones.get('Hips')!;
    this.group.updateMatrixWorld(true);
    // From world to the pelvis's frame in the bind pose (+Z forward, +Y up).
    hips.getWorldQuaternion(_q).invert().premultiply(this.hipsBindQ);
    let fwd = 0, back = 0;
    ['Left', 'Right'].forEach((s, i) => {
      this.bones.get(s + 'Leg')!.getWorldPosition(_v).sub(this.bones.get(s + 'UpLeg')!.getWorldPosition(_v2)).applyQuaternion(_q);
      const a = Math.atan2(_v.z, -_v.y) - this.thighBind[i];
      fwd = Math.max(fwd, a);
      back = Math.min(back, a);
    });
    // Rotating about +X lifts the panel backwards; a little extra, for the knee.
    const [f, b] = this.skirt!;
    f.quaternion.copy(this.skirtRest).multiply(_q2.setFromAxisAngle(_X, -fwd * 1.1));
    b.quaternion.copy(this.skirtRest).multiply(_q2.setFromAxisAngle(_X, -back * 1.1));
  }

  /**
   * Two-bone reach: the wrist from the clip's place towards `goal` (by k), the
   * elbow bent towards `pole`; then the hand turned, by k, so its fingers lie
   * along F and its knuckles along K, and closed into a fist.
   */
  private reach(side: 'Left' | 'Right', goal: THREE.Vector3, pole: THREE.Vector3, F: THREE.Vector3, K: THREE.Vector3, k: number) {
    const B = (n: string) => this.bones.get(side + n)!;
    const arm = B('Arm'), fore = B('ForeArm'), hand = B('Hand');
    const A = arm.getWorldPosition(new THREE.Vector3()), E0 = fore.getWorldPosition(new THREE.Vector3()), W0 = hand.getWorldPosition(new THREE.Vector3());
    const l1 = A.distanceTo(E0), l2 = E0.distanceTo(W0);
    const AT = W0.clone().lerp(goal, k).sub(A);
    const d = THREE.MathUtils.clamp(AT.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
    const u = AT.normalize();
    const perp = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const E = A.clone().addScaledVector(u, a).addScaledVector(perp, h), W = A.clone().addScaledVector(u, d);
    const turn = (b: THREE.Bone, q: THREE.Quaternion) => {
      b.parent!.getWorldQuaternion(_q).invert();
      b.quaternion.copy(_q.multiply(q));
      b.updateMatrixWorld(true);
    };
    const aim = (b: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => turn(b, _q2.setFromUnitVectors(from.normalize(), to.normalize()).multiply(b.getWorldQuaternion(_q3)));
    aim(arm, E0.sub(A), E.clone().sub(A));
    aim(fore, hand.getWorldPosition(W0).sub(E), W.sub(E));
    const fl = B('HandMiddle1').position.clone().normalize();
    const kl = B('HandIndex1').position.clone().sub(B('HandPinky1').position);
    kl.addScaledVector(fl, -kl.dot(fl)).normalize();
    const Ml = new THREE.Matrix4().makeBasis(fl, kl, fl.clone().cross(kl));
    const Mw = new THREE.Matrix4().makeBasis(F, K, F.clone().cross(K));
    turn(hand, hand.getWorldQuaternion(_q3).slerp(new THREE.Quaternion().setFromRotationMatrix(Mw.multiply(Ml.transpose())), k).clone());
    // Fingers closed (towards the palm) round what it holds.
    const sgn = side === 'Right' ? 1 : -1;
    const kw = B('HandIndex1').getWorldPosition(new THREE.Vector3()).sub(B('HandPinky1').getWorldPosition(_v)).normalize();
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) [1.25, 1.5, 0.9].forEach((ang, j) => {
      const b = B(`Hand${f}${j + 1}`);
      if (!b) return;
      // From the bind pose's straight fingers, not the clip's own curl.
      b.quaternion.slerp(this.bindLocal(b), k);
      b.updateMatrixWorld(true);
      turn(b, _q2.setFromAxisAngle(kw, ang * sgn * k).multiply(b.getWorldQuaternion(_q3)).clone());
    });
  }

  private bindQ = new Map<THREE.Bone, THREE.Quaternion>();
  /** A bone's rotation relative to its parent in the bind pose. */
  private bindLocal(b: THREE.Bone) {
    let q = this.bindQ.get(b);
    if (!q) {
      const m = this.bindOf(canon(b.parent!.name)).invert().multiply(this.bindOf(canon(b.name)));
      this.bindQ.set(b, (q = new THREE.Quaternion().setFromRotationMatrix(m.extractRotation(m.clone()))));
    }
    return q;
  }

  /** Where a fist's grip is: half a fist's depth in from the palm. */
  private fistAt(side: 'Left' | 'Right', depth: number, out: THREE.Vector3) {
    const B = (n: string) => this.bones.get(side + n)!;
    const h = B('Hand').getWorldPosition(new THREE.Vector3()), m = B('HandMiddle1').getWorldPosition(new THREE.Vector3());
    const kw = B('HandIndex1').getWorldPosition(new THREE.Vector3()).sub(B('HandPinky1').getWorldPosition(_v));
    const P = m.clone().sub(h).cross(kw).normalize().multiplyScalar(side === 'Right' ? -1 : 1);
    return out.copy(h).lerp(m, 0.6).addScaledVector(P, depth * this.scale);
  }

  /**
   * Soldiers' hands on their arms. The right holds the spear upright at his
   * side, forearm forward, the shaft through the fist: walking it is carried,
   * standing its butt rests on the ground and the hand slides up the shaft.
   * The left holds the shield's grip, or rests on the sword's hilt (but for
   * talking, when it is free to gesture). The rest of the body keeps its clip.
   */
  private holdGear() {
    this.group.updateMatrixWorld(true);
    const sc = this.scale / this.kit.scale, walk = THREE.MathUtils.clamp(this.w.walk ?? 0, 0, 1);
    // Body frame: x to his left, y up, z forward (bind units).
    const toW = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x, y, z).multiplyScalar(this.scale).applyAxisAngle(UP, this.yaw).add(this.pos);
    const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(UP, this.yaw).normalize();
    if (this.leftGrip) {
      const g = this.leftGrip, k = g.always ? 1 : 1 - THREE.MathUtils.clamp(this.w.talk ?? 0, 0, 1);
      if (k > 0.001) {
        g.obj.updateMatrixWorld(true);
        const q = g.obj.getWorldQuaternion(new THREE.Quaternion());
        const K = g.axis.clone().applyQuaternion(q), P = g.palm.clone().applyQuaternion(q);
        const F = K.clone().cross(P).normalize(); // a left hand's palm faces F × K
        const target = g.obj.localToWorld(g.at.clone());
        // Twice: the wrist's offset from the fist depends on how the hand is turned.
        for (let i = 0; i < 2; i++) {
          const off = this.fistAt('Left', g.depth, new THREE.Vector3()).sub(this.bones.get('LeftHand')!.getWorldPosition(_v));
          this.reach('Left', target.clone().sub(off), dir(g.pole.x, g.pole.y, g.pole.z), F, K, k);
        }
      }
    }
    if (this.spear) {
      const hand = this.bones.get('RightHand')!;
      // A hint of the clip's own movement in where the hand is held.
      const T = toW(-0.25, THREE.MathUtils.lerp(1.04, 1.01, walk), THREE.MathUtils.lerp(0.11, 0.2, walk)).lerp(hand.getWorldPosition(_v), 0.15);
      // Fingers forward and a little in, knuckles stacked up the shaft, palm to the leg.
      const K = dir(0, 1, 0), F = dir(0.18, 0, 1);
      this.reach('Right', T, dir(-0.35, 0, -1), F, K, 1);
      const grip = this.fistAt('Right', 0.03, new THREE.Vector3());
      // Standing, the butt (0.8 m below the grip) is on the ground.
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02, this.yaw, -0.05, 'YXZ'));
      const axis = _v3.set(0, 1, 0).applyQuaternion(tilt);
      grip.addScaledVector(axis, -(1 - walk) * (grip.y - this.pos.y - 0.805 * sc) / axis.y);
      const m = new THREE.Matrix4().compose(grip, tilt, _v.setScalar(sc)).premultiply(hand.matrixWorld.clone().invert());
      m.decompose(this.spear.position, this.spear.quaternion, this.spear.scale);
    }
  }

  setVisible(v: boolean) {
    if (v === this.visible) return;
    this.visible = v;
    this.group.visible = v;
    this.cloth.visible = v;
    for (const h of this.held) h.obj.visible = v;
  }

  /** Blend towards the wanted clip weights and advance the animation. */
  animate(dt: number, every: number, lookAt: THREE.Vector3 | null, ground?: (x: number, z: number) => number) {
    let dy = this.yaw - this.lastYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.lastYaw = this.yaw;
    this.yawRate += (Math.abs(dy) / Math.max(dt, 1e-4) - this.yawRate) * Math.min(1, dt * 8);
    // Setting off from standing: from the step where one foot is planted
    // under the body and the other passes it.
    if (this.w.walk === 0 && this.want.walk > 0) this.acts.walk.time = this.walkStart;
    // Gestures cross-fade over a quarter second; starting and stopping, the
    // walk follows the speed more tightly. Weights are normalised: a total under 1 would let the
    // bind pose show through.
    let sum = 0;
    const rate = this.want.walk > 0 || this.w.walk > 0.01 ? 8 : 4;
    for (const n of ANIMS) {
      this.w[n] += (this.want[n] - this.w[n]) * Math.min(1, dt * rate);
      if (this.w[n] < 0.002) this.w[n] = 0;
      sum += this.w[n];
    }
    for (const n of ANIMS) this.acts[n].setEffectiveWeight(sum > 0 ? this.w[n] / sum : n === 'idle' ? 1 : 0);
    // Steps keep pace with the ground: the clips' ground speed is measured
    // when they are retargeted.
    // Turning on the spot, the feet shuffle round.
    this.acts.walk.timeScale = THREE.MathUtils.clamp(Math.max(this.speed / (this.walkSpeed * this.scale), Math.min(0.8, this.yawRate * 0.3)), 0.3, 1.6);
    this.group.position.copy(this.pos);
    this.group.position.y += this.lift;
    this.group.rotation.set(0, this.yaw, 0);
    this.animAcc += dt;
    if (++this.tick % every !== 0) return false;
    this.mixer.update(this.animAcc);
    this.plant(this.animAcc, ground);
    this.springDt = this.animAcc;
    this.animAcc = 0;
    // Skirt bones: the thighs' swing (relative to the pelvis), without their twist.
    for (const k of this.strideBones) {
      _sv.copy(k.leg.position).applyQuaternion(k.up.quaternion).normalize();
      k.bone.quaternion.setFromUnitVectors(k.bind, _sv).multiply(k.rest);
    }
    if (this.grip) this.holdLantern();
    if (this.spear || this.leftGrip) this.holdGear();
    if (this.skirt) this.swingSkirt();
    // Head and neck turn towards whatever holds their attention.
    let target = this.look.target;
    if (lookAt) {
      _v.copy(lookAt).sub(this.pos);
      let a = Math.atan2(_v.x, _v.z) - this.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) < 1.9) target = THREE.MathUtils.clamp(a, -1.1, 1.1);
    }
    // A veil is pinned at the shoulders: she turns her body sooner than wring her neck in it.
    if (this.role === 'woman') target = THREE.MathUtils.clamp(target, -0.6, 0.6);
    this.look.yaw += (target - this.look.yaw) * Math.min(1, dt * every * 3);
    if (Math.abs(this.look.yaw) > 0.01) {
      for (const [n, f] of [['Neck', 0.4], ['Head', 0.6]] as const) {
        const b = this.bones.get(n);
        if (!b) continue;
        b.parent!.getWorldQuaternion(_q);
        _q2.setFromAxisAngle(UP, this.look.yaw * f);
        // local' = P⁻¹ · R · P · local
        b.quaternion.premultiply(_q).premultiply(_q2).premultiply(_q.invert());
      }
    }
    if (this.load.jar || this.load.basket) this.poseLoad();
    if (this.carryHalf && this.role === 'peasant') this.holdOut();
    this.swing?.();
    if (this.springs) {
      // Cloth bones swing only near the camera (npcDebug.springDist); further off they hang still.
      const t0 = performance.now();
      if (this.dist < npcDebug.springDist) { this.springs.update(this.springDt); npcDebug.prof.springPeople++; } else this.springs.rest();
      npcDebug.prof.springs += performance.now() - t0;
    }
    return true;
  }

  /**
   * A peasant carrying a bucket or basket keeps that arm down and out, the
   * load clear of his skirts, whatever the clip does with it: talking, he
   * gestures with the other hand; walking, it swings only a little.
   */
  private holdOut() {
    const arm = this.bones.get('RightArm')!, fore = this.bones.get('RightForeArm')!, hand = this.bones.get('RightHand')!;
    this.group.updateMatrixWorld(true);
    const pA = arm.getWorldPosition(_h1), pF = fore.getWorldPosition(_h2), pH = hand.getWorldPosition(_h3);
    const right = _h4.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)), fwd = _h5.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const hips = this.bones.get('Hips')!.getWorldPosition(_h6);
    // Out from the hips' line by the skirt's flare and half the load.
    const L = pA.distanceTo(pF) + pF.distanceTo(pH) + 0.07 * this.scale;
    const lat = _h7.copy(pA).sub(hips).dot(right);
    const sin = THREE.MathUtils.clamp(((0.33 + this.carryHalf) * this.scale - lat) / L, 0, 0.6);
    const cur = _h7.copy(pF).sub(pA).normalize();
    const walk = THREE.MathUtils.clamp(this.w.walk ?? 0, 0, 1);
    const swing = THREE.MathUtils.clamp(cur.dot(fwd), -0.5, 0.5) * (0.2 + 0.4 * walk);
    const dir = _h8.set(0, -Math.sqrt(1 - sin * sin), 0).addScaledVector(right, sin).addScaledVector(fwd, swing).normalize();
    const turn = (b: THREE.Bone, from: THREE.Vector3, k: number) => {
      _q.setFromUnitVectors(from, dir);
      if (k < 1) _q.slerp(_hq.identity(), 1 - k);
      b.parent!.getWorldQuaternion(_q2);
      b.getWorldQuaternion(_hq).premultiply(_q);
      b.quaternion.copy(_q2.invert().multiply(_hq));
      b.updateMatrixWorld(true);
    };
    turn(arm, cur, 1);
    // The elbow nearly straight under the weight.
    fore.getWorldPosition(pF);
    hand.getWorldPosition(pH);
    turn(fore, _h7.copy(pH).sub(pF).normalize(), 0.85);
  }

  /**
   * Feet on the ground. The clips stand on flat ground; here the body is
   * raised or lowered onto the lower foot over the real ground (and over the
   * odd blend of two clips), and a foot the ground rises under is lifted by
   * bending its leg.
   */
  private plant(dt: number, ground?: (x: number, z: number) => number) {
    const g = ground ?? (() => this.pos.y), s = this.scale;
    const clear = (L: Person['legs'][number]) => {
      const a = L.chain[2].getWorldPosition(_v), t = L.toe.getWorldPosition(_v2);
      return Math.min(a.y - g(a.x, a.z) - L.hA * s, t.y - g(t.x, t.z) - L.hT * s);
    };
    this.group.updateMatrixWorld(true);
    const low = Math.min(...this.legs.map(clear));
    const want = THREE.MathUtils.clamp(this.lift - low, -0.3, 0.15);
    this.lift += (want - this.lift) * Math.min(1, dt * 10);
    this.group.position.y = this.pos.y + this.lift;
    this.group.updateMatrixWorld(true);
    _v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (const L of this.legs) {
      const c = clear(L);
      if (c < -0.005) legIK(L.chain, L.chain[2].getWorldPosition(_v).setY(_v.y - c), _v3);
    }
  }

  /**
   * Turn a bone (in world space, by the least rotation) so that the line to
   * its child points along `dir`, `k` of the way. World matrices of the
   * bone's ancestors must be current; its own subtree is updated.
   */
  private aim(name: string, child: string, dir: THREE.Vector3, k = 1) {
    const b = this.bones.get(name), c = this.bones.get(child);
    if (!b || !c) return;
    const cur = c.getWorldPosition(_v3).sub(b.getWorldPosition(_v2)).normalize();
    _q2.setFromUnitVectors(cur, dir);
    if (k < 1) _q2.slerp(_q.identity(), 1 - k);
    b.parent!.getWorldQuaternion(_q);
    // local' = P⁻¹ · R · P · local
    b.quaternion.premultiply(_q).premultiply(_q2).premultiply(_q.invert());
    b.updateMatrixWorld(true);
  }

  /** What a woman carries shapes how she holds herself. */
  private poseLoad() {
    this.group.updateMatrixWorld(true);
    const yq = this.group.quaternion, d = new THREE.Vector3();
    if (this.load.jar) {
      // A jar on the head: she keeps her head level under it and the jar
      // stays upright, whatever the clip does with her head.
      const m = this.outfit.m, bind = m.bone('HeadTop_End').sub(m.bone('Head')).normalize();
      this.aim('Head', 'HeadTop_End', d.copy(bind).applyQuaternion(yq), 0.75);
      const jar = this.load.jar;
      jar.quaternion.copy(this.load.jarQ);
      jar.updateMatrixWorld(true);
      const up = _v.set(0, 1, 0).applyQuaternion(jar.getWorldQuaternion(_q2));
      _q2.setFromUnitVectors(up, UP);
      jar.parent!.getWorldQuaternion(_q);
      jar.quaternion.premultiply(_q).premultiply(_q2).premultiply(_q.invert());
    }
    if (this.load.basket) {
      // The right arm bent at the elbow, the forearm carried forward level
      // with the basket's handle over it; the wrist relaxed.
      this.aim('RightArm', 'RightForeArm', d.set(-0.5, -1, 0.16).normalize().applyQuaternion(yq));
      this.aim('RightForeArm', 'RightHand', d.set(-0.5, 0.1, 1).normalize().applyQuaternion(yq));
      this.aim('RightHand', 'RightHandMiddle1', d.set(0.06, -0.35, 1).normalize().applyQuaternion(yq));
    }
  }

  /** Lanterns, buckets and spears follow the hand. */
  carry(dt: number) {
    if (!this.held.length) return;
    const hand = this.bones.get('RightHand')!;
    hand.getWorldPosition(_v);
    const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // A lantern's bail runs through the closed fingers, across the hand.
    let yaw = this.yaw;
    const G = this.grip;
    if (G) {
      _v.set(0, 0, 0);
      for (const k of G.knuckles) _v.add(k.getWorldPosition(_v3));
      _v.divideScalar(G.knuckles.length);
      G.across[1].getWorldPosition(_v3).sub(G.across[0].getWorldPosition(_gt));
      yaw = Math.atan2(-_v3.z, _v3.x);
    }
    for (const h of this.held) {
      const arm = h.kind === 'arm';
      if (arm) {
        // Where the handle rests: on the forearm, just short of the wrist.
        this.bones.get('RightForeArm')!.getWorldPosition(_v3);
        _v.lerp(_v3, 0.12);
      }
      const hv = _v.clone().sub(h.last).divideScalar(Math.max(dt, 1e-3));
      if (h.last.lengthSq() === 0 || hv.lengthSq() > 100) hv.set(0, 0, 0);
      h.last.copy(_v);
      const s = h.swing;
      s.v += (-s.a * 28 - hv.dot(fwd) * 0.7 - s.v * 3.2) * dt;
      const pz = this.role === 'peasant' && this.carryHalf > 0; // a full bucket swings less
      const la = arm ? 0.12 : pz ? 0.3 : 0.6;
      s.a = THREE.MathUtils.clamp(s.a + s.v * dt, -la, la);
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      s.w += (-s.b * 28 - hv.dot(side) * 0.5 - s.w * 3.2) * dt;
      // (Held by its bail, a lantern barely tips along it.)
      const lim = G ? 0.12 : pz ? 0.15 : 0.4;
      s.b = THREE.MathUtils.clamp(s.b + s.w * dt, -lim, lim);
      if (G) {
        // A striding knee (and the robe over it) bumps the lantern aside rather
        // than passing through it: keep its body clear of the thigh's line.
        const sc = this.scale / this.kit.scale, L = 0.2 * sc;
        const hip = this.bones.get('RightUpLeg')!.getWorldPosition(_gs), knee = this.bones.get('RightLeg')!.getWorldPosition(_ge);
        const side = _gx.set(fwd.z, 0, -fwd.x); // his left
        _gp.copy(_v).addScaledVector(fwd, -Math.sin(s.a) * L).addScaledVector(side, Math.sin(s.b) * L).y -= L; // the lantern's middle
        const kd = _gd.copy(knee).sub(hip), t = THREE.MathUtils.clamp(_gt.copy(_gp).sub(hip).dot(kd) / kd.lengthSq(), 0, 1);
        const away = _gt.copy(_gp).sub(hip.addScaledVector(kd, t)).setY(0);
        const clear = 0.27 * sc, dist = away.length();
        if (dist < clear && dist > 1e-4) {
          away.multiplyScalar((clear - dist) / dist);
          s.a -= away.dot(fwd) / L; s.b += away.dot(side) / L;
          s.a = THREE.MathUtils.clamp(s.a, -0.6, 0.6); s.b = THREE.MathUtils.clamp(s.b, -lim, lim);
          s.v *= 0.5; s.w *= 0.5;
        }
        // Hung by the top of its bail (0.015 above its origin), swinging about the bail.
        h.obj.quaternion.setFromEuler(new THREE.Euler(s.a, yaw, s.b, 'YXZ'));
        h.obj.position.copy(_v).sub(_v3.set(0, 0.015 * this.scale / this.kit.scale, 0).applyQuaternion(h.obj.quaternion));
        continue;
      }
      // A peasant's load is held in the palm (between wrist and knuckles), not at the wrist.
      if (pz) this.bones.get('RightHandMiddle1')!.getWorldPosition(_v3).add(_v).multiplyScalar(0.5), _v.copy(_v3);
      h.obj.position.copy(_v).addScaledVector(fwd, arm || pz ? 0 : 0.03).y -= h.drop;
      // Over the forearm, the handle's arch square across it.
      const ay = arm ? Math.atan2(_v.x - _v3.x, _v.z - _v3.z) : this.yaw;
      h.obj.quaternion.setFromEuler(new THREE.Euler(s.a, ay, s.b, 'YXZ'));
    }
    if (this.lamp && this.lanternLight) {
      this.held[0].obj.updateMatrixWorld(true);
      this.lanternLight.getWorldPosition(this.lamp.pos);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.cloth.dispose();
    for (const h of this.held) this.scene.remove(h.obj);
  }
}

/** Who a person will be: their outfit (by key), dice and gear, decided before they are dressed. */
interface Casting { role: Role; key: string; id: OutfitId; rnd: () => number; gear?: Gear; look?: Look }
function cast(role: Role, o: { outfit?: number; body?: number; seed?: number; gear?: Gear; face?: boolean; outfitId?: string; look?: Look } = {}): Casting {
  const rnd = mulberry(o.seed ?? rngSeed++ * 7919);
  const ids = ROLE_OUTFITS[role];
  const id = (o.outfitId as OutfitId | undefined) ?? ids[(o.outfit ?? Math.floor(rnd() * ids.length)) % ids.length];
  const v2b = NPC_V2 ? bodiesV2(id, OUTFITS[id].sex) : [];
  const bs: string[] = v2b.length ? v2b : OUTFITS[id].bodies;
  let key = `${id}:${bs[(o.body ?? Math.floor(rnd() * bs.length)) % bs.length]}`;
  if (v2b.length) return { role, id, key, rnd, gear: o.gear, look: o.look };
  for (const [fid, f] of Object.entries(FACES)) if (f.outfits.includes(id) && faces.has(fid) && (o.face ?? rnd() < f.share)) { key += '#' + fid; break; }
  return { role, id, key, rnd, gear: o.gear, look: o.look };
}

/** Make one person (also used by the test page and src/npc/population.ts). */
export function makePerson(scene: THREE.Scene, role: Role, o: { outfit?: number; body?: number; seed?: number; gear?: Gear; face?: boolean; outfitId?: string; look?: Look } = {}) {
  return dress(scene, cast(role, o));
}

function dress(scene: THREE.Scene, c: Casting) {
  const { role, id, rnd } = c;
  const outfit = outfitFor(c.key);
  let gear = c.gear;
  if (!gear) {
    const x = rnd();
    gear = role === 'monk' ? { lantern: x < 0.6 }
      : role === 'soldier' ? { arms: true, spear: true, helmet: x < 0.4 ? 'spangen' : x < 0.65 ? 'lamellar' : false, cap: x >= 0.65, shield: id === 'soldierCloak' ? 'arm' : 'back' }
      : role === 'woman' ? { jar: x < 0.3, basket: x >= 0.3 && x < 0.65 }
      : { cap: id === 'peasantCloak', sticks: id === 'peasantHood' && x < 0.4, bucket: x >= 0.4 && x < 0.65, basket: x >= 0.65 && x < 0.8 };
  }
  const p = new Person(scene, outfit, role, rnd, gear, c.look);
  npcDebug.people.push(p);
  return p;
}

// ------------------------------------------------------------------ the streets

interface Street { pts: THREE.Vector2[]; w: number; cum: number[]; L: number; junc: { s: number; to: number; toS: number }[] }
type Mode = 'walk' | 'pause' | 'chat' | 'post' | 'talk';
interface Agent {
  p: Person;
  mode: Mode;
  resume: Mode;
  timer: number; // time left in this mode
  nextPause: number;
  st: number; s: number; dir: number; off: number; // route
  allowed: Set<number> | null;
  home: THREE.Vector3; homeYaw: number; // posts and groups
  chatCool: number;
  partner: Agent | null;
  talkCycle: number;
  lastJ: number;
  maxSpeed: number;
  vel: THREE.Vector2;
  /** Standing still, the clip held instead of idling (e.g. kneeling at prayer or at the washing stones). */
  pose?: ClipName;
}

function prepStreets(raw: { pts: THREE.Vector2[]; w: number }[]): Street[] {
  const S: Street[] = raw.filter((r) => r.pts.length > 1).map((r) => {
    const cum = [0];
    for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + r.pts[i].distanceTo(r.pts[i - 1]));
    return { pts: r.pts, w: r.w, cum, L: cum[cum.length - 1], junc: [] };
  });
  // Junctions: wherever one street's end meets another street.
  for (let j = 0; j < S.length; j++) for (const endS of [0, S[j].L]) {
    const e = endS === 0 ? S[j].pts[0] : S[j].pts[S[j].pts.length - 1];
    for (let i = 0; i < S.length; i++) {
      if (i === j) continue;
      const n = nearestOn(S[i], e.x, e.y);
      if (n.d < Math.max(2.5, (S[i].w + S[j].w) / 2)) {
        S[i].junc.push({ s: n.s, to: j, toS: endS });
        S[j].junc.push({ s: endS, to: i, toS: n.s });
      }
    }
  }
  return S;
}
function nearestOn(st: Street, x: number, z: number) {
  let best = { d: Infinity, s: 0 };
  for (let i = 1; i < st.pts.length; i++) {
    const a = st.pts[i - 1], b = st.pts[i];
    const dx = b.x - a.x, dz = b.y - a.y, L2 = dx * dx + dz * dz || 1;
    const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.y) * dz) / L2, 0, 1);
    const d = Math.hypot(a.x + dx * t - x, a.y + dz * t - z);
    if (d < best.d) best = { d, s: st.cum[i - 1] + t * Math.sqrt(L2) };
  }
  return best;
}
const _pt = { x: 0, z: 0, tx: 0, tz: 1 };
function pointAt(st: Street, s: number) {
  s = THREE.MathUtils.clamp(s, 0, st.L);
  let i = 1;
  while (i < st.pts.length - 1 && st.cum[i] < s) i++;
  const a = st.pts[i - 1], b = st.pts[i];
  const seg = st.cum[i] - st.cum[i - 1] || 1;
  const t = (s - st.cum[i - 1]) / seg;
  _pt.x = a.x + (b.x - a.x) * t; _pt.z = a.y + (b.y - a.y) * t;
  _pt.tx = (b.x - a.x) / seg; _pt.tz = (b.y - a.y) / seg;
  return _pt;
}

export interface TownOpts {
  streets: { pts: THREE.Vector2[]; w: number; main?: boolean }[];
  ground: (x: number, z: number) => number;
  lamps: Lamp[];
  /** Named places (getMapData().landmarks): Porta, Atrium, Palatium… */
  places?: { name: string; x: number; z: number }[];
  /** How many people (default 18). */
  count?: number;
  /** Beyond this distance people are not drawn (default 60 m). */
  showDist?: number;
  /** Someone else decides who is about and where (src/npc/population.ts): the default plan is skipped. */
  director?: TownDirector;
}

/** A person handed to the town by a director: walking a street (from `start`, within `zone`), or standing at a post or in a group. */
export interface AgentSpec {
  person: Person; kind: 'walk' | 'post' | 'group';
  at?: THREE.Vector3; yaw?: number;
  start?: { st: number; s: number; dir?: number };
  zone?: Set<number> | null; pose?: ClipName; speed?: number; groupIndex?: number;
}
export interface TownApi {
  streets: readonly { pts: THREE.Vector2[]; w: number; L: number }[];
  add(spec: AgentSpec): void;
  remove(p: Person): void;
  /** The nearest street to a point: which, how far along, how far away, and the point on it with its direction. */
  spot(x: number, z: number, filter?: (st: number) => boolean): { st: number; s: number; d: number; x: number; z: number; tx: number; tz: number };
  pointAt(st: number, s: number): { x: number; z: number; tx: number; tz: number };
  ground: (x: number, z: number) => number;
  lamps: Lamp[];
}
export interface TownDirector {
  attach(town: TownApi): void;
  update(dt: number, player: THREE.Vector3, camera: THREE.Camera): void;
  dispose?(): void;
}

let town: Town | null = null;

/** People the town and puts them to work. Needs loadNpcAssets() first. */
export function spawnTownsfolk(scene: THREE.Scene, opts: TownOpts) {
  if (!kits) throw new Error('loadNpcAssets() first');
  town?.dispose();
  town = new Town(scene, opts);
}

/** Every frame: walk, animate, simulate the nearest cloth, and handle talking. */
export function updateTownsfolk(dt: number, camera: THREE.Camera, player: { pos: THREE.Vector3 }) {
  town?.update(Math.min(dt, 0.1), camera, player.pos);
}

/** Keep the player from walking through people (call after the player moves). */
export function pushOutOfTownsfolk(p: THREE.Vector3, radius = 0.32) {
  if (!town) return;
  for (const a of town.agents) {
    const q = a.p.pos;
    if (!a.p.visible || Math.abs(p.y - 1.5 - q.y) > 1.6) continue;
    const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz), r = radius + 0.28;
    if (d < r && d > 1e-4) { p.x = q.x + (dx / d) * r; p.z = q.z + (dz / d) * r; }
  }
}

class Town {
  agents: Agent[] = [];
  streets: Street[];
  ui = makeUI();
  talking: Agent | null = null;
  candidate: Agent | null = null;
  private frame = 0;
  /** People placed but not yet dressed (see admit). */
  private pending: { a: Agent; c: Casting; pos: THREE.Vector3; yaw: number }[] = [];

  constructor(private scene: THREE.Scene, private o: TownOpts) {
    this.streets = prepStreets(o.streets);
    const S = this.streets;
    if (o.director) {
      this.ui.onActivate = () => this.activate();
      o.director.attach(this.api());
      return;
    }
    const place = (n: string) => o.places?.find((p) => p.name === n);
    const rnd = mulberry(727);
    const near = (x: number, z: number, R: number) => new Set(S.map((st, i) => (st.pts.some((p) => Math.hypot(p.x - x, p.y - z) < R) ? i : -1)).filter((i) => i >= 0));
    const atrium = place('Atrium'), basilica = place('Basilica');
    const abbey = new Set<number>([0]);
    for (const pl of [atrium, basilica]) if (pl) near(pl.x, pl.z, 32).forEach((i) => abbey.add(i));
    const mains = new Set(S.map((_, i) => i).filter((i) => o.streets[i]?.main || i === 0));

    // A spot on the street nearest a place, `along` metres into it.
    const streetSpot = (x: number, z: number) => {
      let best = { st: 0, s: 0, d: Infinity };
      S.forEach((st, i) => { const n = nearestOn(st, x, z); if (n.d < best.d) best = { st: i, s: n.s, d: n.d }; });
      return best;
    };
    const count = o.count ?? 18;
    const plan: { role: Role; kind: 'walk' | 'post' | 'group'; at?: THREE.Vector3; yaw?: number; zone?: Set<number> | null }[] = [];

    // Guards at the gate and the palace, facing the street.
    const gate = place('Porta');
    if (gate) {
      const sp = streetSpot(gate.x, gate.z), st = S[sp.st];
      const s = sp.s < st.L / 2 ? Math.min(st.L, sp.s + 4) : Math.max(0, sp.s - 4);
      const c = pointAt(st, s);
      const n = new THREE.Vector2(-c.tz, c.tx);
      const half = Math.max(0.8, st.w / 2 - 0.55);
      const face = Math.atan2(gate.x - c.x, gate.z - c.z);
      for (const k of [1, -1]) plan.push({ role: 'soldier', kind: 'post', at: new THREE.Vector3(c.x + n.x * half * k, 0, c.z + n.y * half * k), yaw: face });
      // Townsfolk chatting inside the gate.
      const s2 = sp.s < st.L / 2 ? Math.min(st.L, sp.s + 9) : Math.max(0, sp.s - 9);
      const g = pointAt(st, s2);
      for (const r of ['peasant', 'woman'] as Role[]) plan.push({ role: r, kind: 'group', at: new THREE.Vector3(g.x, 0, g.z) });
    }
    const pal = place('Palatium');
    if (pal) {
      const sp = streetSpot(pal.x, pal.z), c = pointAt(S[sp.st], sp.s);
      const n = new THREE.Vector2(-c.tz, c.tx);
      const face = Math.atan2(c.x - pal.x, c.z - pal.z);
      for (const k of [1, -1]) plan.push({ role: 'soldier', kind: 'post', at: new THREE.Vector3(c.x + n.x * 1.1 * k + Math.sin(face) * 0.3, 0, c.z + n.y * 1.1 * k + Math.cos(face) * 0.3), yaw: face });
    }
    if (atrium) {
      const c = new THREE.Vector3(atrium.x + 0.5, 0, atrium.z - 0.5);
      for (const r of ['monk', 'monk', 'peasant'] as Role[]) plan.push({ role: r, kind: 'group', at: c });
    }
    const tmpl = place('Templum') ?? place('Civitas');
    if (tmpl) {
      const sp = streetSpot(tmpl.x, tmpl.z), c = pointAt(S[sp.st], sp.s);
      for (const r of ['woman', 'woman', 'peasant'] as Role[]) plan.push({ role: r, kind: 'group', at: new THREE.Vector3(c.x, 0, c.z) });
    }
    // Walkers: two monks about the abbey, a soldier on the main street, the rest everyone.
    const walkers: Role[] = ['monk', 'monk', 'soldier', 'peasant', 'woman', 'peasant', 'woman', 'peasant', 'woman', 'monk', 'peasant', 'woman'];
    for (const r of walkers) plan.push({ role: r, kind: 'walk', zone: r === 'monk' ? abbey : r === 'soldier' ? mains : null });
    // Fewer people asked for: drop walkers first, then groups.
    while (plan.length > count) {
      const i = plan.map((p) => p.kind).lastIndexOf('walk');
      plan.splice(i >= 0 ? i : plan.length - 1, 1);
    }

    // Group members stand round a small circle, facing in.
    const groups = new Map<string, number>();
    for (const pl of plan) if (pl.kind === 'group') { const k = `${pl.at!.x},${pl.at!.z}`; groups.set(k, (groups.get(k) ?? 0) + 1); }
    const placed = new Map<string, number>();
    for (const pl of plan) {
      // Placed now, dressed later (nearest first, see admit).
      const p = { pos: new THREE.Vector3(), yaw: 0 };
      const a: Agent = {
        p: null as unknown as Person, mode: 'walk', resume: 'walk', timer: 0, nextPause: 8 + rnd() * 25,
        st: 0, s: 0, dir: 1, off: 0, allowed: pl.zone ?? null,
        home: new THREE.Vector3(), homeYaw: 0, chatCool: 10, partner: null, talkCycle: rnd() * 5, lastJ: -1,
        maxSpeed: (pl.role === 'monk' ? 1.0 : pl.role === 'soldier' ? 1.3 : 1.15) * (0.9 + rnd() * 0.2), vel: new THREE.Vector2(),
      };
      if (pl.kind === 'walk') {
        const pool = [...(a.allowed ?? new Set(S.map((_, i) => i)))].filter((i) => S[i].L > 6);
        a.st = pool.length ? pick(rnd, pool) : 0;
        a.s = rnd() * S[a.st].L;
        a.dir = rnd() < 0.5 ? 1 : -1;
        a.off = (rnd() - 0.5) * Math.max(0, S[a.st].w - 1.2) * 0.6;
        const c = pointAt(S[a.st], a.s);
        p.pos.set(c.x - c.tz * a.off, 0, c.z + c.tx * a.off);
        p.yaw = Math.atan2(c.tx * a.dir, c.tz * a.dir);
      } else if (pl.kind === 'post') {
        a.mode = a.resume = 'post';
        a.home.copy(pl.at!);
        a.homeYaw = pl.yaw!;
        p.pos.copy(pl.at!);
        p.yaw = pl.yaw!;
      } else {
        const k = `${pl.at!.x},${pl.at!.z}`, n = groups.get(k)!, i = placed.get(k) ?? 0;
        placed.set(k, i + 1);
        const ang = (i / n) * Math.PI * 2 + rnd() * 0.3;
        const R = 0.55 + n * 0.08;
        p.pos.set(pl.at!.x + Math.sin(ang) * R, 0, pl.at!.z + Math.cos(ang) * R);
        p.yaw = ang + Math.PI + (rnd() - 0.5) * 0.4;
        a.mode = a.resume = 'post';
        a.home.copy(p.pos);
        a.homeYaw = p.yaw;
        a.talkCycle = i * 3.1;
        a.chatCool = -1; // marks a group member
      }
      p.pos.y = o.ground(p.pos.x, p.pos.z);
      this.pending.push({ a, c: cast(pl.role), pos: p.pos, yaw: p.yaw });
    }
    this.ui.onActivate = () => this.activate();
    // The first two at once (the gate's guards, as the plan begins), so the town is not empty.
    this.admit(null, 2);
  }

  /**
   * Dress the waiting person nearest the camera: tailor their outfit if no
   * one wears it yet (one outfit a frame: tailoring takes a few tenths of a
   * second), then bring them in (up to `n` a frame when their outfits are ready).
   */
  private admit(cam: THREE.Vector3 | null, n = 1) {
    for (let k = 0; k < n && this.pending.length; k++) {
      let bi = 0;
      if (cam) {
        let bd = Infinity;
        this.pending.forEach((q, i) => { const d = q.pos.distanceToSquared(cam); if (d < bd) { bd = d; bi = i; } });
      }
      const q = this.pending[bi], ready = outfits.has(q.c.key);
      if (!ready && k > 0) return;
      this.pending.splice(bi, 1);
      const p = (q.a.p = dress(this.scene, q.c));
      p.pos.copy(q.pos);
      p.yaw = q.yaw;
      if (p.lamp) this.o.lamps.push(p.lamp);
      this.agents.push(q.a);
      if (!ready) return;
    }
  }

  private api(): TownApi {
    const S = this.streets;
    return {
      streets: S, ground: this.o.ground, lamps: this.o.lamps,
      add: (sp) => this.addAgent(sp),
      remove: (p) => this.removeAgent(p),
      spot: (x, z, filter) => {
        let best = { st: 0, s: 0, d: Infinity };
        S.forEach((st, i) => { if (filter && !filter(i)) return; const n = nearestOn(st, x, z); if (n.d < best.d) best = { st: i, s: n.s, d: n.d }; });
        const c = pointAt(S[best.st], best.s);
        return { ...best, x: c.x, z: c.z, tx: c.tx, tz: c.tz };
      },
      pointAt: (st, s) => ({ ...pointAt(S[st], s) }),
    };
  }

  /** One person from a director (see AgentSpec). */
  private addAgent(sp: AgentSpec) {
    const S = this.streets, p = sp.person, rnd = p.rnd;
    const a: Agent = {
      p, mode: 'walk', resume: 'walk', timer: 0, nextPause: 8 + rnd() * 25,
      st: 0, s: 0, dir: 1, off: 0, allowed: sp.zone ?? null,
      home: new THREE.Vector3(), homeYaw: 0, chatCool: 10, partner: null, talkCycle: rnd() * 5, lastJ: -1,
      maxSpeed: (sp.speed ?? 1.15) * (0.9 + rnd() * 0.2), vel: new THREE.Vector2(), pose: sp.pose,
    };
    if (sp.kind === 'walk') {
      a.st = sp.start?.st ?? 0;
      a.s = THREE.MathUtils.clamp(sp.start?.s ?? 0, 0, S[a.st].L);
      a.dir = sp.start?.dir ?? (rnd() < 0.5 ? 1 : -1);
      a.off = (rnd() - 0.5) * Math.max(0, S[a.st].w - 1.2) * 0.6;
      const c = pointAt(S[a.st], a.s);
      p.pos.set(c.x - c.tz * a.off, 0, c.z + c.tx * a.off);
      p.yaw = Math.atan2(c.tx * a.dir, c.tz * a.dir);
    } else {
      a.mode = a.resume = 'post';
      a.home.copy(sp.at!);
      a.homeYaw = sp.yaw ?? 0;
      p.pos.copy(sp.at!);
      p.yaw = a.homeYaw;
      if (sp.kind === 'group') { a.talkCycle = (sp.groupIndex ?? 0) * 3.1; a.chatCool = -1; }
    }
    p.pos.y = this.o.ground(p.pos.x, p.pos.z);
    if (p.lamp) this.o.lamps.push(p.lamp);
    this.agents.push(a);
  }

  private removeAgent(p: Person) {
    const i = this.agents.findIndex((a) => a.p === p);
    if (i < 0) return;
    const a = this.agents[i];
    if (this.talking === a) this.endTalk();
    if (this.candidate === a) this.candidate = null;
    for (const b of this.agents) if (b.partner === a) { b.partner = null; if (b.mode === 'chat') b.mode = 'walk'; }
    p.dispose();
    if (p.lamp) { const j = this.o.lamps.indexOf(p.lamp); if (j >= 0) this.o.lamps.splice(j, 1); }
    this.agents.splice(i, 1);
    const k = npcDebug.people.indexOf(p);
    if (k >= 0) npcDebug.people.splice(k, 1);
  }

  dispose() {
    this.o.director?.dispose?.();
    for (const a of this.agents) {
      a.p.dispose();
      if (a.p.lamp) { const i = this.o.lamps.indexOf(a.p.lamp); if (i >= 0) this.o.lamps.splice(i, 1); }
    }
    this.agents = [];
    this.ui.close();
  }

  private allowed(a: Agent, st: number) { return !a.allowed || a.allowed.has(st); }

  /** Steering: follow the street, keep clear of others and of the player. */
  private walk(a: Agent, dt: number, player: THREE.Vector3) {
    const S = this.streets, st = S[a.st], p = a.p;
    const x0 = p.pos.x, z0 = p.pos.z;
    // Junctions.
    for (let j = 0; j < st.junc.length; j++) {
      const J = st.junc[j];
      if (Math.abs(J.s - a.s) > 0.7 || a.lastJ === J.to * 1000 + Math.round(J.toS) || !this.allowed(a, J.to)) continue;
      const atEnd = (a.dir > 0 && a.s > st.L - 1) || (a.dir < 0 && a.s < 1);
      a.lastJ = J.to * 1000 + Math.round(J.toS);
      if (atEnd || p.rnd() < 0.35) {
        const back = a.st * 1000 + Math.round(J.s);
        a.st = J.to; a.s = J.toS;
        const L = S[J.to].L;
        a.dir = J.toS < 0.5 ? 1 : J.toS > L - 0.5 ? -1 : p.rnd() < 0.5 ? 1 : -1;
        a.lastJ = back;
        a.off = THREE.MathUtils.clamp(a.off, -(S[a.st].w / 2 - 0.5), S[a.st].w / 2 - 0.5);
        return;
      }
    }
    const cur = S[a.st];
    if ((a.dir > 0 && a.s > cur.L - 0.3) || (a.dir < 0 && a.s < 0.3)) {
      a.dir = -a.dir;
      a.lastJ = -1;
      if (p.rnd() < 0.6) { a.mode = 'pause'; a.timer = 2 + p.rnd() * 4; }
      return;
    }
    const c = pointAt(cur, a.s + a.dir * 1.6);
    const half = Math.max(0.15, cur.w / 2 - 0.45);
    const tx = c.tx * a.dir, tz = c.tz * a.dir;
    let gx = c.x - c.tz * a.off - p.pos.x, gz = c.z + c.tx * a.off - p.pos.z;
    const gl = Math.hypot(gx, gz) || 1;
    gx /= gl; gz /= gl;
    // Others ahead push us aside; someone right in front makes us wait.
    let want = a.maxSpeed, sx = 0, sz = 0;
    const consider = (q: THREE.Vector3, R: number, strong: number) => {
      const dx = q.x - p.pos.x, dz = q.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > R || d < 1e-4) return;
      const ahead = (dx * gx + dz * gz) / d;
      if (ahead > 0.3) {
        // Sidestep: to whichever side the other is not.
        const lat = dx * -gz + dz * gx;
        const k = (1 - d / R) * strong;
        sx += gz * Math.sign(lat || 1) * k; sz += -gx * Math.sign(lat || 1) * k;
        if (d < 0.9) want = Math.min(want, a.maxSpeed * Math.max(0, (d - 0.5) / 0.4));
      }
      if (d < 0.6) { sx -= (dx / d) * (0.6 - d) * 3; sz -= (dz / d) * (0.6 - d) * 3; }
    };
    for (const b of this.agents) if (b !== a && b.p.dist < 30) consider(b.p.pos, 2.2, 1.2);
    consider(player, 2.6, 2);
    let vx = gx + sx, vz = gz + sz;
    const vl = Math.hypot(vx, vz) || 1;
    vx = (vx / vl) * want; vz = (vz / vl) * want;
    a.vel.x += (vx - a.vel.x) * Math.min(1, dt * 3);
    a.vel.y += (vz - a.vel.y) * Math.min(1, dt * 3);
    p.pos.x += a.vel.x * dt; p.pos.z += a.vel.y * dt;
    a.s = THREE.MathUtils.clamp(a.s + (a.vel.x * tx + a.vel.y * tz) * dt, 0, cur.L);
    // Stay inside the street.
    const m = pointAt(cur, a.s);
    const lat = (p.pos.x - m.x) * -m.tz + (p.pos.z - m.z) * m.tx;
    if (Math.abs(lat) > half) { const k = Math.sign(lat) * half - lat; p.pos.x += -m.tz * k; p.pos.z += m.tx * k; }
    // The steps follow how far the body actually went: held back by the
    // street's edge or by someone in the way, it walks no faster than it moves.
    p.speed += (Math.min(Math.hypot(a.vel.x, a.vel.y), Math.hypot(p.pos.x - x0, p.pos.z - z0) / Math.max(dt, 1e-4)) - p.speed) * Math.min(1, dt * 12);
    if (p.speed > 0.15) p.yaw = turn(p.yaw, Math.atan2(a.vel.x, a.vel.y), dt * 4, dt * 2.5);
    a.nextPause -= dt;
    if (a.nextPause < 0) { a.mode = 'pause'; a.timer = 3 + p.rnd() * 6; a.nextPause = 15 + p.rnd() * 30; p.look.timer = 0; }
  }

  private wants(a: Agent) {
    const p = a.p, W = p.want;
    for (const n of ANIMS) W[n] = 0;
    if (a.mode === 'talk') W[p.lines[(p.line + p.lines.length - 1) % p.lines.length].bless ? 'bless' : 'talk'] = 1;
    else if (a.mode === 'chat' || (a.mode === 'post' && a.chatCool === -1)) {
      // In a group, people take turns to speak.
      const k = Math.sin(a.talkCycle * 0.45) + Math.sin(a.talkCycle * 0.27 + 1);
      W[k > 0.6 ? 'talk' : 'idle'] = 1;
    } else W[a.mode === 'post' && a.pose ? a.pose : 'idle'] = 1;
    // Walking, starting and stopping, the walk's share follows the speed;
    // turning on the spot, it shuffles the feet round.
    const mv = Math.max(THREE.MathUtils.smoothstep(p.speed, 0.06, 0.45), 0.5 * THREE.MathUtils.smoothstep(p.yawRate, 0.4, 1.4));
    if (mv > 0) { for (const n of ANIMS) W[n] *= 1 - mv; W.walk += mv; }
  }

  update(dt: number, camera: THREE.Camera, player: THREE.Vector3) {
    const t0 = performance.now();
    this.frame++;
    this.o.director?.update(dt, player, camera);
    const cam = camera.position;
    if (this.pending.length) this.admit(cam, 2);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const sphere = new THREE.Sphere();
    // --- behaviour
    for (const a of this.agents) {
      const p = a.p;
      a.chatCool = a.chatCool === -1 ? -1 : a.chatCool - dt;
      a.talkCycle += dt;
      if (a.mode === 'walk') this.walk(a, dt, player);
      else {
        // Stopping takes a step or two, not an instant.
        a.vel.multiplyScalar(Math.exp(-dt * 7));
        if (a.vel.lengthSq() < 0.0025) a.vel.set(0, 0);
        p.pos.x += a.vel.x * dt; p.pos.z += a.vel.y * dt;
        p.speed = a.vel.length();
        if (a.mode === 'pause' || a.mode === 'chat') {
          a.timer -= dt;
          if (a.mode === 'pause') {
            p.look.timer -= dt;
            if (p.look.timer < 0) { p.look.target = (p.rnd() - 0.5) * 1.8; p.look.timer = 1 + p.rnd() * 2.5; }
          }
          if (a.mode === 'chat' && a.partner) p.yaw = turn(p.yaw, Math.atan2(a.partner.p.pos.x - p.pos.x, a.partner.p.pos.z - p.pos.z), dt * 3, dt * 1.6);
          if (a.timer < 0) { a.mode = 'walk'; p.look.target = 0; a.partner = null; }
        } else if (a.mode === 'post') {
          p.yaw = turn(p.yaw, a.homeYaw, dt * 2, dt * 1.6);
          _v.copy(a.home);
          if (p.pos.distanceToSquared(_v) > 0.01) p.pos.lerp(_v, Math.min(1, dt * 2));
        } else if (a.mode === 'talk') {
          p.yaw = turn(p.yaw, Math.atan2(player.x - p.pos.x, player.z - p.pos.z), dt * 4, dt * 1.6);
        }
      }
      p.pos.y = this.o.ground(p.pos.x, p.pos.z);
      p.dist = p.pos.distanceTo(cam);
    }
    // Two walkers meeting may stop to talk.
    for (const a of this.agents) {
      if (a.mode !== 'walk' || a.chatCool > 0 || a.p.dist > 40) continue;
      for (const b of this.agents) {
        if (b === a || b.mode !== 'walk' || b.chatCool > 0) continue;
        if (a.p.pos.distanceTo(b.p.pos) > 1.4) continue;
        a.chatCool = b.chatCool = 40;
        if (a.p.rnd() < 0.35) {
          const T = 5 + a.p.rnd() * 7;
          for (const [x, y] of [[a, b], [b, a]]) { x.mode = 'chat'; x.timer = T; x.partner = y; x.talkCycle = x === a ? 0 : 4; }
        }
        break;
      }
    }
    // --- the player talking to someone
    this.interact(camera, player);
    const t1 = performance.now();
    // --- level of detail: hidden far away and off-screen; cloth only on the nearest few.
    const sim: Agent[] = [];
    for (const a of this.agents) {
      const p = a.p;
      sphere.center.copy(p.pos).y += 0.9;
      sphere.radius = 1.4;
      const show = p.dist < (this.o.showDist ?? 60) && frustum.intersectsSphere(sphere);
      p.setVisible(show);
      if (show && p.dist < npcDebug.simDist) sim.push(a);
    }
    sim.sort((x, y) => x.p.dist - y.p.dist);
    const simSet = new Set(sim.slice(0, npcDebug.maxSim));
    for (const a of this.agents) {
      const p = a.p;
      this.wants(a);
      const near = simSet.has(a);
      const every = !p.visible ? 8 : near || p.dist < 18 ? 1 : p.dist < 35 ? 2 : 3;
      const lookAt = p.dist < 7 || a.mode === 'talk' ? player : a.partner ? a.partner.p.pos : null;
      const moved = p.animate(dt, every, lookAt, this.o.ground);
      if (!p.visible) continue;
      p.cloth.setSimulating(near);
      if (moved || near) {
        if (near) { p.group.updateMatrixWorld(true); p.cloth.update(dt, p.pos); }
        p.carry(dt);
      }
    }
    const t2 = performance.now();
    npcDebug.prof.logic += t1 - t0;
    npcDebug.prof.anim += t2 - t1;
    npcDebug.prof.frames++;
  }

  // ------------------------------------------------------------------ talking

  private interact(camera: THREE.Camera, player: THREE.Vector3) {
    const fwd = camera.getWorldDirection(_v2).setY(0).normalize();
    let best: Agent | null = null, bd = 2.8;
    for (const a of this.agents) {
      const d = Math.hypot(a.p.pos.x - player.x, a.p.pos.z - player.z);
      if (d > bd || Math.abs(a.p.pos.y - (player.y - 1.6)) > 1.5) continue;
      const dot = ((a.p.pos.x - player.x) * fwd.x + (a.p.pos.z - player.z) * fwd.z) / Math.max(d, 1e-3);
      if (dot < (d < 1.2 ? 0.2 : 0.6)) continue;
      best = a; bd = d;
    }
    this.candidate = best;
    if (this.talking) {
      const d = Math.hypot(this.talking.p.pos.x - player.x, this.talking.p.pos.z - player.z);
      if (d > 4.5) this.endTalk();
    }
    const readVisible = document.getElementById('readbtn')?.hidden === false;
    const show = !isReading() && !readVisible && (!!this.talking || !!best);
    this.ui.show(show, this.talking ? 'Vale' : 'Loquere', this.talking ? '' : best ? best.p.name : '');
  }

  activate() {
    if (this.talking) { this.endTalk(); return; }
    const a = this.candidate;
    if (!a) return;
    this.talking = a;
    a.resume = a.mode === 'talk' ? a.resume : a.mode === 'chat' || a.mode === 'pause' ? 'walk' : a.mode;
    a.mode = 'talk';
    if (a.partner) { a.partner.mode = 'walk'; a.partner.partner = null; a.partner = null; }
    const p = a.p;
    const line = p.lines[p.line % p.lines.length];
    p.line++;
    this.ui.say(`${p.name} · ${p.title}`, line);
  }

  private endTalk() {
    const a = this.talking;
    if (!a) return;
    this.talking = null;
    a.mode = a.resume;
    if (a.mode === 'walk') { a.p.look.target = 0; a.nextPause = 10 + a.p.rnd() * 20; }
    this.ui.close();
  }
}

/** Turn towards an angle; standing still, no faster than `max` per frame (feet can't spin). */
const turn = (from: number, to: number, k: number, max = Infinity) => {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + THREE.MathUtils.clamp(d * Math.min(1, k), -max, max);
};

// ------------------------------------------------------------------ UI

function makeUI() {
  const style = document.createElement('style');
  style.textContent = `
  #talkbtn { position: fixed; z-index: 6; left: 50%; transform: translateX(-50%);
    bottom: max(26px, calc(env(safe-area-inset-bottom, 0px) + 18px));
    display: flex; align-items: center; gap: 10px; padding: 10px 22px 10px 16px; border-radius: 28px; cursor: pointer;
    border: 2px solid rgba(201,154,86,0.85); color: #f0dcae; font: 20px 'IM Fell English', Georgia, serif; letter-spacing: 0.06em;
    background: radial-gradient(circle at 30% 30%, rgba(92,64,32,0.95), rgba(22,15,8,0.95)); box-shadow: 0 0 18px rgba(0,0,0,0.6);
    touch-action: manipulation; -webkit-tap-highlight-color: transparent; max-width: calc(100vw - 32px); white-space: nowrap; }
  #talkbtn svg { width: 26px; height: 26px; flex: none; }
  #talkbtn small { font-size: 13px; opacity: 0.7; font-style: italic; overflow: hidden; text-overflow: ellipsis; }
  #talkbtn:focus-visible { outline: 2px solid #e8c88a; outline-offset: 3px; }
  #speech { position: fixed; z-index: 6; left: 50%; transform: translateX(-50%) rotate(-0.4deg);
    bottom: max(92px, calc(env(safe-area-inset-bottom, 0px) + 84px)); width: min(560px, calc(100vw - 32px)); box-sizing: border-box;
    padding: 14px 20px 15px; border-radius: 4px 7px 5px 6px; color: #2a1c0e; cursor: pointer;
    background: radial-gradient(ellipse at 20% 15%, rgba(255,250,230,0.5), transparent 60%), radial-gradient(ellipse at 85% 90%, rgba(120,80,30,0.25), transparent 55%),
      linear-gradient(175deg, #e8dbb8, #d9c79d 60%, #cdb88a);
    box-shadow: 0 6px 24px rgba(0,0,0,0.6), inset 0 0 30px rgba(110,70,20,0.35); border: 1px solid rgba(80,50,20,0.55);
    font-family: 'IM Fell English', Georgia, serif; opacity: 0; transition: opacity 0.35s; pointer-events: none; }
  #speech.open { opacity: 1; pointer-events: auto; }
  #speech .who { font-family: 'UnifrakturMaguntia', serif; font-size: 18px; color: #6e2412; margin-bottom: 6px; }
  #speech .la { margin: 0 0 8px; font-size: 19px; font-style: italic; line-height: 1.35; }
  #speech .en { margin: 0; font-size: 15px; line-height: 1.35; opacity: 0.78; }
  body.touch #speech { bottom: max(196px, calc(env(safe-area-inset-bottom, 0px) + 188px)); }
  @media (max-width: 480px) { #speech .la { font-size: 17px; } #speech .en { font-size: 14px; } }
  /* Short screens (landscape phones, small windows): up top, out of the speaker's way. */
  @media (max-height: 520px) { #speech, body.touch #speech { bottom: auto; top: max(12px, env(safe-area-inset-top, 0px)); width: min(520px, calc(100vw - 180px)); padding: 9px 14px 10px; }
    #speech .who { font-size: 15px; margin-bottom: 3px; } #speech .la { font-size: 15px; margin-bottom: 4px; } #speech .en { font-size: 13px; } }`;
  document.head.appendChild(style);
  const btn = document.createElement('button');
  btn.id = 'talkbtn';
  btn.type = 'button';
  btn.hidden = true;
  btn.innerHTML = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M6 8.5c0-1.7 1.3-3 3-3h14c1.7 0 3 1.3 3 3v9c0 1.7-1.3 3-3 3h-8l-6 5v-5H9c-1.7 0-3-1.3-3-3z"/><path d="M11 11.5h10M11 15h7"/></svg><span>Loquere</span><small></small>`;
  const label = btn.querySelector('span')!, small = btn.querySelector('small')!;
  const panel = document.createElement('div');
  panel.id = 'speech';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = `<div class="who"></div><p class="la" lang="la"></p><p class="en"></p>`;
  document.body.append(btn, panel);
  const ui = {
    onActivate: () => {},
    show(v: boolean, text: string, who: string) {
      if (btn.hidden === !v && label.textContent === text && small.textContent === who) return;
      btn.hidden = !v;
      label.textContent = text;
      small.textContent = who;
      btn.setAttribute('aria-label', text === 'Vale' ? 'Say farewell' : `Speak with ${who}`);
    },
    say(who: string, l: Line) {
      panel.querySelector('.who')!.textContent = who;
      panel.querySelector('.la')!.textContent = `“${l.la}”`;
      panel.querySelector('.en')!.textContent = l.en;
      panel.classList.add('open');
    },
    close() { panel.classList.remove('open'); },
  };
  const go = (e: Event) => { e.stopPropagation(); ui.onActivate(); };
  btn.addEventListener('click', go);
  panel.addEventListener('click', go);
  for (const el of [btn, panel]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
  addEventListener('keydown', (e) => {
    if (isReading() || document.getElementById('readbtn')?.hidden === false) return;
    if (e.code === 'KeyE' || (e.code === 'Escape' && panel.classList.contains('open'))) {
      if (e.code === 'Escape' && !panel.classList.contains('open')) return;
      ui.onActivate();
    }
  });
  return ui;
}

void Props.propMats;
