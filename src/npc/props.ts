import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { textureSet } from '../materials';
import { matte, withAtmos } from './rig';
import type { Measure, Garment } from './garment';

// What people carry. Built in code, in the bind pose's frame (metres, facing
// +Z, the body's left towards +X), then hung on a bone. The baskets, buckets
// and jars are Poly Haven photo-scans (see public/models/props).

let M: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  const wood = textureSet('wood');
  const tex = (c: number, r = 0.85) => withAtmos(new THREE.MeshStandardMaterial({ color: c, roughness: r, normalMap: wood.n, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide }));
  const D = { side: THREE.DoubleSide };
  return {
    iron: matte(0x3a3836, 0.55, 0.65, D),
    darkIron: matte(0x2a2826, 0.62, 0.55, D),
    bronze: matte(0x5a4426, 0.5, 0.7, D),
    leather: matte(0x3a2618, 0.8, 0, D),
    darkLeather: matte(0x22160e, 0.82, 0, D),
    ash: tex(0x7e6a52, 0.8),
    board: tex(0xffffff, 0.9),
    felt: matte(0x4a3e30, 1, 0, D),
    linen: matte(0x9a917e, 0.95, 0, D),
  };
}
export const propMats = () => (M ??= makeMats());

const lathe = (pts: [number, number][], seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
const clean = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; };
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(clean))!;
/** Wobble a geometry's vertices a little: nothing hand-made is true. */
function wobble(g: THREE.BufferGeometry, amt: number, freq = 9, seed = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * freq + seed) * Math.sin(y * freq * 1.3 + 1.7 + seed) * Math.sin(z * freq * 0.9 + 0.4);
    p.setXYZ(i, x * (1 + n * amt), y, z * (1 + n * amt));
  }
  g.computeVertexNormals();
  return g;
}

/** Put a built prop under a bone, given where it sits in the bind pose. */
export function hangOn(bone: THREE.Bone, boneBind: THREE.Matrix4, obj: THREE.Object3D, place: THREE.Matrix4) {
  const m = boneBind.clone().invert().multiply(place);
  m.decompose(obj.position, obj.quaternion, obj.scale);
  bone.add(obj);
  obj.traverse((o) => { o.frustumCulled = false; });
}
export const placeAt = (p: THREE.Vector3, q = new THREE.Quaternion(), s = 1) => new THREE.Matrix4().compose(p, q, new THREE.Vector3(s, s, s));

// ------------------------------------------------------------------ the monk's horn lantern

export function makeLantern() {
  const m = propMats();
  const lantern = new THREE.Group();
  const horn = withAtmos(new THREE.MeshStandardMaterial({ color: 0x1a0f05, emissive: 0xff8a30, emissiveIntensity: 1.6, roughness: 0.6, side: THREE.DoubleSide }));
  const hornMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.19, 14, 1, true), horn);
  hornMesh.position.y = -0.2;
  const parts: THREE.BufferGeometry[] = [
    at(new THREE.SphereGeometry(0.075, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, -0.105, 0),
    at(new THREE.TorusGeometry(0.045, 0.006, 4, 14), 0, -0.07, 0, Math.PI / 2),
    at(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 14), 0, -0.3, 0),
    at(new THREE.TorusGeometry(0.045, 0.005, 4, 12, Math.PI), 0, -0.03, 0),
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(at(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), Math.sin(a) * 0.072, -0.2, Math.cos(a) * 0.072));
  }
  lantern.add(hornMesh, new THREE.Mesh(merge(parts), m.bronze));
  return { group: lantern, light: hornMesh };
}

// ------------------------------------------------------------------ headgear

/** A felt cap (pileus), rounded and a little slouched. */
export function makeCap(Ms: Measure, color: THREE.Color) {
  const h = Ms.head, rx = h.rx + 0.014, rz = h.rz + 0.016, ht = h.top - h.brow + 0.03;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { const t = (i / 10) * Math.PI / 2; pts.push([Math.cos(t) * 1.0 + (i === 0 ? 0.04 : 0), Math.sin(t) * 1.0]); }
  pts.unshift([0.98, -0.06]);
  const g = lathe(pts.reverse().map(([r, y]) => [r, y]) as [number, number][], 18);
  g.scale(rx, ht, rz);
  wobble(g, 0.04, 14, color.r * 9);
  const mat = matte(color, 1, 0, { side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.rotation.x = -0.12; // worn tipped back a little
  const o = new THREE.Group();
  o.add(mesh);
  return { obj: o, place: placeAt(new THREE.Vector3(h.c.x, h.brow - 0.005, h.c.z - 0.005)) };
}

/**
 * A Spangenhelm: an iron cone of segments riveted to copper-alloy bands, a
 * brow band and a small finial; cheek pieces hang at the sides.
 */
export function makeHelmet(Ms: Measure) {
  const m = propMats();
  const h = Ms.head, rx = h.rx + 0.02, rz = h.rz + 0.022, ht = h.top - h.brow + 0.06;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // A slightly pointed ogive.
    prof.push([Math.pow(1 - t, 0.7) * (1 - 0.15 * t), t]);
  }
  const dome = lathe(prof.reverse(), 24);
  dome.scale(rx, ht, rz);
  const bands: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * 0.96;
      const r = Math.pow(1 - t, 0.7) * (1 - 0.15 * t);
      pts.push(new THREE.Vector3(Math.sin(a) * r * rx * 1.04 + 0.0, t * ht + 0.004, Math.cos(a) * r * rz * 1.04));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0085, 4, false);
    bands.push(tube);
  }
  bands.push(lathe([[rx * 1.05, -0.004], [rx * 1.07, 0.012], [rx * 1.06, 0.034], [rx * 1.03, 0.04]], 24).scale(1, 1, rz / rx));
  bands.push(at(new THREE.SphereGeometry(0.012, 8, 6), 0, ht + 0.006, 0));
  const cheeks: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const c = new THREE.BoxGeometry(0.008, 0.085, 0.06, 1, 4, 3);
    const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) - Math.pow(p.getY(i) / 0.045, 2) * 0.012 * sx);
    cheeks.push(at(c, sx * (rx * 0.98), -0.045, rz * 0.25, 0, 0, sx * 0.08));
  }
  const o = new THREE.Group();
  o.add(new THREE.Mesh(dome, m.darkIron), new THREE.Mesh(merge(bands), m.bronze), new THREE.Mesh(merge(cheeks), m.darkIron));
  return { obj: o, place: placeAt(new THREE.Vector3(h.c.x, h.brow - 0.012, h.c.z - 0.008)) };
}

// ------------------------------------------------------------------ arms

/** A round shield: dished planks covered in painted hide, rawhide rim, tall iron boss. Faces +Z. */
export function makeShield(paint: THREE.Color) {
  const m = propMats();
  const R = 0.4;
  const board = lathe([[0.001, 0.03], [0.1, 0.027], [0.2, 0.02], [0.3, 0.011], [R, 0], [R, -0.011], [0.25, 0.006], [0.001, 0.016]], 32);
  // Planks run straight across: planar UVs.
  const p = board.attributes.position, uv = board.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 1.1 + 0.5, p.getZ(i) * 0.45);
  board.rotateX(Math.PI / 2);
  wobble(board, 0.012, 7, paint.g * 7);
  const face = (propMats().board as THREE.MeshStandardMaterial).clone();
  face.color = paint;
  face.onBeforeCompile = (propMats().board as THREE.MeshStandardMaterial).onBeforeCompile;
  face.customProgramCacheKey = (propMats().board as THREE.MeshStandardMaterial).customProgramCacheKey;
  const rim = new THREE.TorusGeometry(R, 0.009, 5, 40);
  const boss = lathe([[0.088, 0], [0.088, 0.005], [0.062, 0.006], [0.06, 0.04], [0.052, 0.062], [0.03, 0.09], [0.012, 0.108], [0.016, 0.116], [0.001, 0.122]], 20);
  boss.rotateX(Math.PI / 2).translate(0, 0, 0.026);
  const rivets: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; rivets.push(at(new THREE.SphereGeometry(0.009, 6, 4), Math.sin(a) * 0.075, Math.cos(a) * 0.075, 0.03)); }
  const grip = at(new THREE.BoxGeometry(0.03, 0.34, 0.02), 0, 0, -0.03);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(board, face), new THREE.Mesh(rim, m.darkLeather), new THREE.Mesh(merge([boss, ...rivets]), m.darkIron), new THREE.Mesh(grip, m.ash));
  return o;
}

/** A spear: ash shaft, leaf-shaped iron head, butt ferrule. Origin at the grip, point up (+Y). */
export function makeSpear() {
  const m = propMats();
  const shaft = new THREE.CylinderGeometry(0.0135, 0.0155, 2.25, 7, 6);
  wobble(shaft, 0.06, 3);
  shaft.translate(0, 0.37, 0);
  const head = lathe([[0.001, 0], [0.013, 0.004], [0.012, 0.09], [0.026, 0.16], [0.03, 0.2], [0.022, 0.28], [0.001, 0.38]], 8);
  head.scale(1, 1, 0.32);
  head.translate(0, 1.48, 0);
  const socket = lathe([[0.016, 0], [0.0145, 0.06]], 8).translate(0, 1.44, 0);
  const ferrule = lathe([[0.001, -0.06], [0.014, 0], [0.015, 0.05]], 8).translate(0, -0.74, 0);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(shaft, m.ash), new THREE.Mesh(merge([head, socket, ferrule]), m.iron));
  return o;
}

/** A spatha in its wooden, leather-covered scabbard. Origin at the scabbard mouth; the point down (-Y). */
export function makeSpatha() {
  const m = propMats();
  const sc = new THREE.CylinderGeometry(0.03, 0.026, 0.82, 8, 6);
  sc.scale(1, 1, 0.32).translate(0, -0.41, 0);
  const chape = new THREE.CylinderGeometry(0.0275, 0.018, 0.05, 8).scale(1, 1, 0.36).translate(0, -0.84, 0);
  const mouth = new THREE.CylinderGeometry(0.033, 0.033, 0.03, 8).scale(1, 1, 0.38).translate(0, -0.03, 0);
  const guard = new THREE.BoxGeometry(0.09, 0.014, 0.028).translate(0, 0.008, 0);
  const grip = new THREE.CylinderGeometry(0.013, 0.015, 0.1, 7).translate(0, 0.066, 0);
  const pommel = lathe([[0.001, 0], [0.03, 0.002], [0.026, 0.016], [0.012, 0.028], [0.001, 0.03]], 10).scale(1, 1, 0.45).translate(0, 0.116, 0);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(sc, m.leather), new THREE.Mesh(merge([chape, mouth, guard, pommel]), m.bronze), new THREE.Mesh(grip, m.darkLeather));
  return o;
}

/** A scramasax in a leather sheath, worn across the belt. Origin at the centre; blade along +X. */
export function makeSeax() {
  const m = propMats();
  const sh = new THREE.BoxGeometry(0.3, 0.05, 0.016, 6, 1, 1);
  const p = sh.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), t = (x + 0.15) / 0.3;
    // Single-edged: the back straight, the edge sweeping up to the point.
    if (p.getY(i) < 0) p.setY(i, -0.0275 + t * t * 0.03);
    p.setZ(i, p.getZ(i) * (1 - t * 0.4));
  }
  sh.computeVertexNormals();
  sh.translate(0.03, 0, 0);
  const grip = new THREE.CylinderGeometry(0.014, 0.016, 0.13, 7).rotateZ(Math.PI / 2).translate(-0.175, 0.008, 0);
  const studs: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) studs.push(at(new THREE.SphereGeometry(0.006, 6, 4), -0.09 + k * 0.08, 0.02, 0.009));
  const o = new THREE.Group();
  o.add(new THREE.Mesh(sh, m.darkLeather), new THREE.Mesh(grip, m.ash), new THREE.Mesh(merge(studs), m.bronze));
  return o;
}

/**
 * The Lombard multi-part belt (vielteilige Gürtelgarnitur): small plates on
 * the belt and strap ends hanging from it. Built in bind space.
 */
export function makeBeltFittings(b: Garment['belt'], seed: number) {
  const m = propMats();
  const plates: THREE.BufferGeometry[] = [], straps: THREE.BufferGeometry[] = [], tips: THREE.BufferGeometry[] = [];
  const angles = [-1.35, -0.95, -0.55, 0.45, 0.85, 1.25, 2.6, 3.0, 3.4];
  for (const a of angles) {
    const r = b.r(a) + 0.004;
    const x = b.cx + Math.sin(a) * r, z = b.cz + Math.cos(a) * r;
    plates.push(at(new THREE.BoxGeometry(0.024, 0.03, 0.005), x, b.y, z, 0, a, 0));
  }
  for (const a of [-1.1, -0.7, 0.7, 1.1, 2.8, 3.2]) {
    const r = b.r(a) + 0.007;
    const x = b.cx + Math.sin(a) * r, z = b.cz + Math.cos(a) * r;
    const len = 0.07 + ((Math.sin(a * 13 + seed) + 1) / 2) * 0.05;
    straps.push(at(new THREE.BoxGeometry(0.012, len, 0.003), x, b.y - 0.015 - len / 2, z, 0.06, a, 0));
    tips.push(at(new THREE.BoxGeometry(0.014, 0.022, 0.004), x, b.y - 0.02 - len, z + Math.cos(a) * 0.002, 0.06, a, 0));
  }
  const o = new THREE.Group();
  o.add(new THREE.Mesh(merge(plates), m.bronze), new THREE.Mesh(merge(straps), m.leather), new THREE.Mesh(merge(tips), m.bronze));
  return o;
}

/** A bundle of sticks tied with withies, carried on the back. Origin at its centre, along Y. */
export function makeSticks(seed: number) {
  const m = propMats();
  const sticks: THREE.BufferGeometry[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.07;
    const L = 0.9 + rnd() * 0.35, y0 = (rnd() - 0.5) * 0.15;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push(new THREE.Vector3(Math.cos(a) * r + (rnd() - 0.5) * 0.025, y0 + (t - 0.5) * L, Math.sin(a) * r * 0.7 + (rnd() - 0.5) * 0.025));
    }
    sticks.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.008 + rnd() * 0.008, 4, false));
  }
  const ties = [-0.25, 0.22].map((y) => at(new THREE.TorusGeometry(0.075, 0.007, 4, 14), 0, y, 0, Math.PI / 2).scale(1, 1, 0.75));
  const bark = (m.ash as THREE.MeshStandardMaterial).clone();
  bark.color = new THREE.Color(0x8a7458);
  bark.onBeforeCompile = m.ash.onBeforeCompile;
  bark.customProgramCacheKey = m.ash.customProgramCacheKey;
  const o = new THREE.Group();
  o.add(new THREE.Mesh(merge(sticks), bark), new THREE.Mesh(merge(ties), m.leather));
  return o;
}

/** A cloth pad and a scanned clay jar, carried on the head. */
export function makeHeadJar(jar: THREE.Object3D | null) {
  const m = propMats();
  const o = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.02, 6, 16).rotateX(Math.PI / 2), m.linen);
  pad.position.y = 0.012;
  o.add(pad);
  if (jar) {
    const j = jar.clone();
    j.scale.setScalar(0.95);
    j.position.y = 0.02;
    o.add(j);
  }
  return o;
}

/** Prepare a scanned prop: centre it on its base, matte, fog-aware. */
export function prepScan(root: THREE.Object3D, top = false) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  const g = new THREE.Group();
  root.position.sub(new THREE.Vector3(c.x, top ? box.max.y : box.min.y, c.z));
  g.add(root);
  root.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (!mm.isMesh) return;
    const mat = (mm.material as THREE.MeshStandardMaterial).clone();
    mat.roughness = Math.max(mat.roughness, 0.8);
    mat.metalness = 0;
    mm.material = withAtmos(mat);
  });
  return g;
}
