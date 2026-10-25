import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { textureSet } from '../materials';
import { matte, withAtmos } from './rig';
import { fabric } from './fabric';
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
    leather: fabric('leather', 0x3a2618, { attr: 'position' }),
    darkLeather: fabric('leather', 0x22160e, { attr: 'position' }),
    ash: tex(0x7e6a52, 0.8),
    board: tex(0xffffff, 0.9),
    felt: fabric('felt', 0x4a3e30, { attr: 'position' }),
    linen: fabric('linen', 0x9a917e, { attr: 'position' }),
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

/** A tiling normal map from a height function on the unit square. */
function normalTex(size: number, height: (x: number, y: number) => number, k: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!, h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const img = g.createImageData(size, size), n = new THREE.Vector3();
  const H = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    n.set(-(H(x + 1, y) - H(x - 1, y)) * k, -(H(x, y + 1) - H(x, y - 1)) * k, 1).normalize();
    const o = (y * size + x) * 4;
    img.data[o] = (n.x * 0.5 + 0.5) * 255; img.data[o + 1] = (n.y * 0.5 + 0.5) * 255; img.data[o + 2] = (n.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Smooth value noise on a torus of period p (for tiling textures). */
function tileNoise(p: number, seed: number) {
  const r = (i: number, j: number) => { const v = Math.sin(((i % p + p) % p) * 127.1 + ((j % p + p) % p) * 311.7 + seed * 74.7) * 43758.5453; return v - Math.floor(v); };
  return (x: number, y: number) => {
    const X = x * p, Y = y * p, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (r(i, j) * (1 - u) + r(i + 1, j) * u) * (1 - v) + (r(i, j + 1) * (1 - u) + r(i + 1, j + 1) * u) * v;
  };
}

let HM: ReturnType<typeof makeHeadMats> | null = null;
function makeHeadMats() {
  // Forged iron: hammer-dimpled, darkened, with rust blooming in patches.
  const n1 = tileNoise(6, 1), n2 = tileNoise(22, 2), n3 = tileNoise(48, 3);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!, img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const u = x / 128, v = y / 128;
    const rust = THREE.MathUtils.smoothstep(n1(u, v) * 0.6 + n2(u, v) * 0.4, 0.55, 0.8);
    const grime = 0.85 + n3(u, v) * 0.15;
    const o = (y * 128 + x) * 4;
    img.data[o] = (0.62 * (1 - rust) + 0.55 * rust) * grime * 255;
    img.data[o + 1] = (0.6 * (1 - rust) + 0.32 * rust) * grime * 255;
    img.data[o + 2] = (0.58 * (1 - rust) + 0.18 * rust) * grime * 255;
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const rust = new THREE.CanvasTexture(c);
  rust.wrapS = rust.wrapT = THREE.RepeatWrapping;
  rust.colorSpace = THREE.SRGBColorSpace;
  const hammer = normalTex(128, (x, y) => tileNoise(14, 5)(x, y) + tileNoise(40, 6)(x, y) * 0.3, 2.5);
  // Riveted mail: rows of small rings, each row offset by half a ring.
  const mail = normalTex(128, (x, y) => {
    const R = 16, row = Math.floor(y * R), cy = (row + 0.5) / R, cx = (Math.round(x * R - (row % 2) * 0.5) + (row % 2) * 0.5) / R;
    const d = Math.hypot(x - cx, (y - cy) * 1.2) * R;
    return Math.exp(-Math.pow((d - 0.36) / 0.13, 2));
  }, 3);
  const D = { side: THREE.DoubleSide };
  return {
    iron: withAtmos(new THREE.MeshStandardMaterial({ color: 0x8a8580, map: rust, roughness: 0.5, metalness: 0.45, normalMap: hammer, normalScale: new THREE.Vector2(0.35, 0.35), ...D })),
    bronze: withAtmos(new THREE.MeshStandardMaterial({ color: 0x86683c, roughness: 0.45, metalness: 0.5, normalMap: hammer, normalScale: new THREE.Vector2(0.15, 0.15), ...D })),
    mail: withAtmos(new THREE.MeshStandardMaterial({ color: 0x4e4b47, roughness: 0.55, metalness: 0.5, normalMap: mail, normalScale: new THREE.Vector2(1.2, 1.2), ...D })),
    lace: fabric('leather', 0x2e1e12, { attr: 'position' }),
    felt: (color: THREE.Color) => fabric('felt', color, { attr: 'position' }),
  };
}
const headMats = () => (HM ??= makeHeadMats());

/** A grid surface p(i/rows, j/cols) with uvs; columns may wrap. */
function surface(rows: number, cols: number, p: (t: number, s: number) => THREE.Vector3, uvScale = [1, 1]) {
  const pos: number[] = [], uv: number[] = [], ix: number[] = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
    const v = p(i / rows, j / cols);
    pos.push(v.x, v.y, v.z);
    uv.push((j / cols) * uvScale[0], (i / rows) * uvScale[1]);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
    ix.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

/**
 * The shell of something worn on the head, in the frame of its base (y up
 * from y0): it clears the skull's ellipsoid by `margin` everywhere and rises
 * to a point of the given sharpness (0 = round).
 */
function headShell(h: Measure['head'], y0: number, H: number, margin: number, point: number) {
  const ry = h.top - h.c.y + margin * 0.6;
  const k = 0.02;
  const smax = (a: number, b: number) => (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
  const f = (t: number) => {
    const e = (y0 + t * H - h.c.y) / ry;
    return e <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - e * e));
  };
  const ax = (t: number) => (t >= 1 ? 0 : smax(h.rx * f(t) + margin * (1 - t * t), (h.rx + margin) * Math.pow(1 - t, 1 - point * 0.35) * point));
  const az = (t: number) => (t >= 1 ? 0 : smax(h.rz * f(t) + margin * (1 - t * t), (h.rz + margin) * Math.pow(1 - t, 1 - point * 0.35) * point));
  const at = (t: number, a: number, off = 0) => new THREE.Vector3(Math.sin(a) * (ax(t) + off), t * H, Math.cos(a) * (az(t) + off));
  return { ax, az, at, H };
}

/**
 * A felt cap, the pileus pannonicus: a soft, flat-topped pillbox of matted
 * wool, its sides a little uneven and its crown sagging.
 */
export function makeCap(Ms: Measure, color: THREE.Color) {
  const h = Ms.head;
  const y0 = h.brow + 0.008, H = h.top - y0 + 0.016;
  const ax0 = h.rx + 0.004, az0 = h.rz + 0.01;
  const seed = color.r * 31 + color.g * 7;
  // Profile: radius (fraction of the band) against height (fraction of H).
  const prof: [number, number][] = [[1.0, -0.02], [1.012, 0.25], [1.01, 0.55], [0.995, 0.78], [0.965, 0.9], [0.9, 0.965], [0.78, 0.995], [0.55, 1.0], [0.28, 1.0], [0.0, 0.995]];
  const L = [0];
  for (let i = 1; i < prof.length; i++) L.push(L[i - 1] + Math.hypot((prof[i][0] - prof[i - 1][0]) * ax0, (prof[i][1] - prof[i - 1][1]) * H));
  const along = (u: number) => {
    const d = u * L[L.length - 1];
    let i = 1;
    while (i < L.length - 1 && L[i] < d) i++;
    const f = (d - L[i - 1]) / (L[i] - L[i - 1]);
    return [prof[i - 1][0] + (prof[i][0] - prof[i - 1][0]) * f, prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * f];
  };
  const g = surface(22, 48, (u, s) => {
    const a = s * Math.PI * 2, [k, y] = along(u);
    // Felt is never true: soft dents in the sides, the crown sunk off-centre.
    const dent = 1 + Math.sin(a * 3 + seed) * 0.012 * k + Math.sin(a * 5 + seed * 2) * 0.006 * k;
    const sag = -Math.max(0, 1 - k) * 0.01 * (1 + 0.5 * Math.sin(a + seed));
    return new THREE.Vector3(Math.sin(a) * ax0 * k * dent, (y * H) + sag * (y > 0.9 ? 1 : 0), Math.cos(a) * az0 * k * dent);
  }, [3, 2]);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(g, headMats().felt(color)));
  o.rotation.x = -0.06; // worn tipped back a little
  return { obj: o, place: placeAt(new THREE.Vector3(h.c.x, y0, h.c.z)) };
}

/** Rivets: small domes at the given points, facing out from the axis. */
function rivets(pts: THREE.Vector3[], r: number) {
  return pts.map((p) => {
    const g = new THREE.SphereGeometry(r, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    const n = new THREE.Vector3(p.x, 0, p.z).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n));
    return g.translate(p.x, p.y, p.z);
  });
}

/** A mail aventail hanging from the rim at the back and sides. */
function aventail(sh: ReturnType<typeof headShell>, drop: number, open: number) {
  const a0 = open, a1 = Math.PI * 2 - open;
  return surface(8, 30, (t, s) => {
    const a = a0 + (a1 - a0) * s;
    const back = 0.5 - 0.5 * Math.cos(a); // 1 at the back
    const d = drop * (0.55 + 0.45 * back);
    const out = 0.006 + t * t * 0.03 + Math.sin(a * 14) * 0.002 * t;
    return new THREE.Vector3(Math.sin(a) * (sh.ax(0) + out), -t * d, Math.cos(a) * (sh.az(0) + out));
  }, [10, 2]);
}

/** Hinged cheek-guards, iron leaves following the line of the face. */
function cheekGuards(sh: ReturnType<typeof headShell>, rimY: number) {
  const plates: THREE.BufferGeometry[] = [], hinges: THREE.BufferGeometry[] = [], studs: THREE.Vector3[] = [];
  for (const sx of [1, -1]) {
    const ac = sx * (Math.PI / 2 - 0.42);
    plates.push(surface(8, 6, (t, s) => {
      // A rounded leaf: broad under the rim, narrowing to the jaw.
      const w = 0.33 * (1 - 0.55 * t * t) * Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.max(0, t - 0.8) / 0.2, 2)));
      const a = ac + (s - 0.5) * w;
      const y = rimY - 0.004 - t * 0.105;
      const r = 1 + 0.06 - t * 0.12;
      return new THREE.Vector3(Math.sin(a) * sh.ax(0) * r, y, Math.cos(a) * sh.az(0) * r);
    }));
    const hp = new THREE.Vector3(Math.sin(ac) * sh.ax(0) * 1.07, rimY - 0.006, Math.cos(ac) * sh.az(0) * 1.07);
    const hinge = new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6);
    hinge.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(ac), 0, -Math.sin(ac))));
    hinges.push(hinge.translate(hp.x, hp.y, hp.z));
    studs.push(new THREE.Vector3(Math.sin(ac) * sh.ax(0) * 1.03, rimY - 0.06, Math.cos(ac) * sh.az(0) * 1.03));
  }
  return { plates: merge(plates), fittings: merge([...hinges, ...rivets(studs, 0.005)]) };
}

/**
 * A Lombard Spangenhelm: iron segments riveted under gilt copper-alloy bands
 * (the Spangen), a broad riveted brow band, a plume tube at the apex, hinged
 * cheek-guards and a mail aventail. Or (kind 'lamellar') a helmet of narrow
 * iron lamellae laced together under a crown plate, Avar fashion.
 */
export function makeHelmet(Ms: Measure, kind: 'spangen' | 'lamellar' = 'spangen') {
  const m = headMats();
  const h = Ms.head;
  // The rim sits just above the eyebrows.
  const y0 = h.brow + 0.03, H = h.top - y0 + (kind === 'spangen' ? 0.07 : 0.035);
  // Fitted to the skull above the ears, not to the width across them.
  const sh = headShell({ ...h, rx: h.rx - 0.008 }, y0, H, 0.016, kind === 'spangen' ? 0.85 : 0.3);
  const o = new THREE.Group();
  const iron: THREE.BufferGeometry[] = [], bronze: THREE.BufferGeometry[] = [], lace: THREE.BufferGeometry[] = [];
  const studs: THREE.Vector3[] = [];
  if (kind === 'spangen') {
    iron.push(surface(24, 48, (t, s) => sh.at(t, s * Math.PI * 2), [4, 2]));
    // Six bands over the seams, each with rivets down both edges.
    for (let k = 0; k < 6; k++) {
      const ak = (k / 6) * Math.PI * 2 + Math.PI / 6;
      bronze.push(surface(16, 2, (t, s) => {
        const tt = t * 0.93, w = (0.016 * (1 - 0.55 * tt)) / Math.max(0.05, sh.ax(tt));
        return sh.at(tt, ak + (s - 0.5) * 2 * w, 0.003 + (1 - Math.abs(s - 0.5) * 2) * 0.0015);
      }));
      for (let i = 1; i < 9; i++) {
        const t = i * 0.095, w = (0.011 * (1 - 0.55 * t)) / Math.max(0.05, sh.ax(t));
        studs.push(sh.at(t, ak - w, 0.005), sh.at(t, ak + w, 0.005));
      }
    }
    // The brow band, with a beaded lower edge.
    bronze.push(surface(3, 64, (t, s) => sh.at(t * 0.16 - 0.01, s * Math.PI * 2, 0.003 + Math.sin(t * Math.PI) * 0.0012)));
    bronze.push(at(new THREE.TorusGeometry(1, 0.003 / sh.ax(0), 4, 64), 0, -0.002, 0, Math.PI / 2).scale(sh.ax(0) + 0.004, 1, sh.az(0) + 0.004));
    for (let k = 0; k < 24; k++) studs.push(sh.at(0.07, (k / 24) * Math.PI * 2, 0.007));
    // The finial: a cap over the apex and a short plume tube.
    const top = sh.at(0.93, 0);
    bronze.push(lathe([[0.001, 0], [0.026, 0], [0.022, 0.008], [0.01, 0.016], [0.008, 0.02]], 14).translate(0, top.y - 0.004, 0));
    bronze.push(lathe([[0.007, 0], [0.007, 0.03], [0.011, 0.036], [0.011, 0.04], [0.006, 0.04]], 10).translate(0, top.y + 0.016, 0));
    const ck = cheekGuards(sh, 0);
    o.add(new THREE.Mesh(ck.plates, m.iron), new THREE.Mesh(ck.fittings, m.bronze));
    o.add(new THREE.Mesh(aventail(sh, 0.13, 1.25), m.mail));
  } else {
    // Some forty lamellae, each overlapping the next, laced in two rows.
    const NL = 40, tTop = 0.78;
    for (let k = 0; k < NL; k++) {
      const ak = (k / NL) * Math.PI * 2, w = (Math.PI * 2 / NL) * 0.62;
      iron.push(surface(10, 2, (t, s) => {
        const tt = t * tTop + 0.0;
        // Rounded ends; the leading edge sits proud of the one it overlaps.
        const end = t > 0.9 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.9) / 0.1, 2))) : 1;
        return sh.at(tt, ak + (s - 0.5) * 2 * w * end, 0.002 + s * 0.0045);
      }, [0.3, 1]));
    }
    for (const t of [0.22, 0.6]) lace.push(surface(2, 64, (u, s) => sh.at(t + (u - 0.5) * 0.03, s * Math.PI * 2, 0.0075), [24, 1]));
    // The crown plate and its knob.
    iron.push(surface(8, 40, (t, s) => sh.at(tTop - 0.06 + t * (1 - tTop + 0.06), s * Math.PI * 2, 0.008 * (1 - t)), [2, 1]));
    bronze.push(lathe([[0.001, 0], [0.016, 0], [0.012, 0.012], [0.004, 0.022], [0.001, 0.024]], 12).translate(0, H - 0.004, 0));
    // A bronze-bound leather brow band.
    bronze.push(surface(3, 64, (t, s) => sh.at(t * 0.12 - 0.012, s * Math.PI * 2, 0.0085)));
    for (let k = 0; k < 20; k++) studs.push(sh.at(0.05, (k / 20) * Math.PI * 2, 0.01));
    const ck = cheekGuards(sh, 0);
    o.add(new THREE.Mesh(ck.plates, m.iron), new THREE.Mesh(ck.fittings, m.bronze));
    o.add(new THREE.Mesh(aventail(sh, 0.14, 1.15), m.mail));
  }
  bronze.push(...rivets(studs, 0.0032));
  o.add(new THREE.Mesh(merge(iron), m.iron), new THREE.Mesh(merge(bronze), m.bronze));
  if (lace.length) o.add(new THREE.Mesh(merge(lace), m.lace));
  o.rotation.x = -0.07; // the brow raised a little, the back down over the nape
  return { obj: o, place: placeAt(new THREE.Vector3(h.c.x, y0, h.c.z)) };
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
  // The grip stands off the back on two cleats, room for a fist and a sleeve behind the boss.
  const grip = merge([at(new THREE.BoxGeometry(0.03, 0.34, 0.02), 0, 0, -0.065), at(new THREE.BoxGeometry(0.03, 0.03, 0.065), 0, 0.155, -0.035), at(new THREE.BoxGeometry(0.03, 0.03, 0.065), 0, -0.155, -0.035)]);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(board, face), new THREE.Mesh(rim, m.darkLeather), new THREE.Mesh(merge([boss, ...rivets]), m.darkIron), new THREE.Mesh(grip, m.ash));
  return o;
}

/**
 * The soft leather top of an ankle shoe (a turnshoe laced round the ankle),
 * closing over the shoe's collar and the foot of the leg wraps. Origin on
 * the ankle's axis at the shoe's collar; up +Y.
 */
export function makeShoeTop(r = 0.05) {
  const m = propMats();
  const g = lathe([[r * 0.95, -0.035], [r * 1.02, 0], [r * 1.04, 0.035], [r * 1.07, 0.05], [r * 1.08, 0.056], [r * 1.02, 0.06], [r * 0.95, 0.054]], 18);
  const lace = at(new THREE.TorusGeometry(r * 1.07, 0.0035, 4, 18), 0, 0.03, 0, Math.PI / 2);
  // Longer than wide, over the instep.
  for (const x of [g, lace]) x.scale(1, 1, 1.3).translate(0, 0, r * 0.25);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(g, m.darkLeather), new THREE.Mesh(lace, m.leather));
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
  // The pad (a cercine): a twisted ring of cloth, soft and squashed under the weight.
  const tg = new THREE.TorusGeometry(0.052, 0.018, 8, 24).rotateX(Math.PI / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i), a = Math.atan2(z, x);
    // Flattened, with the twist of its wound cloth running round it.
    tp.setY(i, tp.getY(i) * 0.6 + Math.sin(a * 7 + Math.atan2(tp.getY(i), Math.hypot(x, z) - 0.052) * 1) * 0.0015);
  }
  tg.computeVertexNormals();
  const pad = new THREE.Mesh(tg, m.linen);
  o.add(pad);
  if (jar) {
    const j = jar.clone();
    j.scale.setScalar(0.95);
    j.position.y = 0.006;
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

/**
 * A lidded wicker basket for carrying over the forearm: the scanned basket
 * with its lid shut (the scan has it lying open beside it) and a bent-withy
 * handle arching across the top, side to side. Origin where the forearm runs
 * through the handle, resting under its crown; the arch spans X, so the arm
 * runs along Z.
 */
export function makeArmBasket(scan: THREE.Object3D) {
  const o = new THREE.Group();
  let mat: THREE.Material | null = null;
  scan.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    const lid = /lid/i.test(m.name);
    const g = m.geometry.clone();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    // The base standing on y = 0; the lid flat on its rim.
    g.translate(-(b.min.x + b.max.x) / 2, lid ? 0.2 - b.min.y - 0.012 : -b.min.y, -(b.min.z + b.max.z) / 2);
    if (!lid) mat = m.material as THREE.Material;
    o.add(new THREE.Mesh(g, m.material));
  });
  const arch = new THREE.CatmullRomCurve3([[-0.098, 0.19], [-0.096, 0.3], [-0.06, 0.385], [0, 0.4], [0.06, 0.385], [0.096, 0.3], [0.098, 0.19]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  o.add(new THREE.Mesh(new THREE.TubeGeometry(arch, 20, 0.0085, 6, false), mat ?? propMats().ash));
  for (const c of o.children) (c as THREE.Mesh).geometry.translate(0, -0.336, 0);
  return o;
}
