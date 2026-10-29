import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { propMats } from './props';
import { matte } from './rig';
import { fabric } from './fabric';
import type { Garment, Measure } from './garment';

// Things the townsfolk of src/npc/population.ts wear and work with, kept light:
// a staff, a leather apron, a disc brooch, a pilgrim's scrip; and a few
// things set down in the street where people work (an anvil, a stall, pots,
// sacks, a washing basket). Worn things are built in the bind pose's frame
// (metres, facing +Z, the body's left towards +X), like src/npc/props.ts.

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
const clean = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; };
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(clean))!;
const lathe = (pts: [number, number][], seg = 12) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

let mats: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  return {
    gold: matte(0xc09a48, 0.38, 0.45, { emissive: 0x2a1c06 }),
    garnet: matte(0x5a0e10, 0.25, 0.1),
    clay: matte(0x8a5a3c, 0.85),
    clayDark: matte(0x5e3e2a, 0.9),
    sack: fabric('tabby', 0x8a7c62, { attr: 'position' }),
    linen: fabric('linen', 0xb8b0a0, { attr: 'position' }),
    cloth: fabric('twill', 0x6a3428, { attr: 'position' }),
    stone: matte(0x6a665e, 0.95),
  };
}
const M = () => (mats ??= makeMats());

/**
 * A walking staff (baculus), held like the spear (src/npc.ts holdGear): the
 * origin at the grip, the foot 0.805 m below it. Pilgrims' staffs are long,
 * with a knob; old people's shorter and crooked.
 */
export function makeStaff(r: () => number) {
  const m = propMats();
  const top = 0.45 + r() * 0.45;
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    pts.push(new THREE.Vector3(Math.sin(t * 5 + top * 9) * 0.012, -0.805 + t * (0.805 + top), Math.cos(t * 4 + top * 7) * 0.01));
  }
  const shaft = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.016, 6, false);
  const knob = at(new THREE.SphereGeometry(0.026, 8, 6), pts[6].x, pts[6].y, pts[6].z);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(merge([shaft, knob]), m.ash));
  return o;
}

/** A working apron of leather or heavy cloth, tied at the belt, to mid-thigh. Built in bind space: hang on the hips at identity. */
export function makeApron(b: Garment['belt'], color: number, leather = true, length = 0.4) {
  const g = new THREE.BufferGeometry();
  const cols = 14, rows = 6, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const t = j / rows, a = (i / cols - 0.5) * 1.9 * (1 - t * 0.12);
    const r = b.r(a) + 0.016 + t * 0.085 + Math.sin(i * 1.7 + j) * 0.003;
    pos.push(b.cx + Math.sin(a) * r, b.y + 0.015 - t * length, b.cz + Math.cos(a) * r);
    uv.push(i / cols, t);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const q = j * (cols + 1) + i;
    idx.push(q, q + cols + 1, q + 1, q + 1, q + cols + 1, q + cols + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = fabric(leather ? 'leather' : 'tabby', color, { attr: 'position' });
  // The tie round the waist.
  const tie = new THREE.TorusGeometry(1, 0.006, 4, 32).rotateX(Math.PI / 2);
  const p = tie.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getX(i), p.getZ(i)), r = b.r(a) + 0.012;
    p.setXYZ(i, b.cx + Math.sin(a) * r, b.y + 0.012 + p.getY(i), b.cz + Math.cos(a) * r);
  }
  tie.computeVertexNormals();
  const o = new THREE.Group();
  o.add(new THREE.Mesh(g, mat), new THREE.Mesh(tie, mat));
  return o;
}

/**
 * A Lombard disc brooch (Scheibenfibel), gold with a garnet boss, the
 * fashion of the 7th century; worn on the right shoulder to close a cloak
 * (men) or at the throat (women). Placed from the neck bone, in bind space.
 */
export function makeFibula(Ms: Measure, side: 'right' | 'throat') {
  const n = Ms.bone('Neck'), s2 = Ms.bone('Spine2');
  const disc = new THREE.CylinderGeometry(0.019, 0.02, 0.006, 16).rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(0.019, 0.0025, 4, 16);
  const pellets: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pellets.push(at(new THREE.SphereGeometry(0.0028, 5, 3), Math.sin(a) * 0.012, Math.cos(a) * 0.012, 0.004)); }
  const boss = at(new THREE.SphereGeometry(0.006, 8, 5), 0, 0, 0.004);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(merge([disc, rim, ...pellets]), M().gold), new THREE.Mesh(boss, M().garnet));
  const p = side === 'throat'
    ? new THREE.Vector3(n.x, n.y - 0.15, n.z + 0.13)
    : new THREE.Vector3(n.x - 0.1, (n.y + s2.y) / 2 + 0.01, n.z + 0.11);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, side === 'throat' ? 0 : -0.35, 0));
  return { obj: o, place: new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)) };
}

/** A pilgrim's scrip (pera): a leather pouch on a strap, at the left hip. Bind space: hang on the hips at identity. */
export function makeScrip(b: Garment['belt']) {
  const m = propMats();
  const a = 1.95, r = b.r(a) + 0.05;
  const bag = new THREE.SphereGeometry(0.1, 10, 8);
  bag.scale(0.45, 1, 1).translate(0, -0.06, 0);
  const flap = at(new THREE.BoxGeometry(0.092, 0.07, 0.17), 0.002, 0.01, 0);
  const g = merge([bag, flap]);
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(a - Math.PI / 2));
  g.translate(b.cx + Math.sin(a) * r, b.y - 0.1, b.cz + Math.cos(a) * r);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(g, m.leather));
  return o;
}

/**
 * The buckle of a leather belt, at the front: a D-shaped frame with its
 * tongue and, behind it, the plate riveted to the strap. Lombard men's are
 * bronze (often a set with plates and strap ends, makeBeltFittings); a
 * Latin townsman's a plain iron frame. Bind space: hang on the hips at identity.
 */
export function makeBuckle(b: Garment['belt'], metal: 'bronze' | 'iron') {
  const m = propMats();
  const r = b.r(0) + 0.004;
  const frame = new THREE.TorusGeometry(0.019, 0.0032, 4, 10, Math.PI);
  frame.rotateZ(-Math.PI / 2);
  const bar = new THREE.CylinderGeometry(0.0032, 0.0032, 0.038, 5);
  const tongue = at(new THREE.BoxGeometry(0.019, 0.004, 0.003), 0.009, 0, 0.002);
  const parts = [frame, bar, tongue];
  if (metal === 'bronze') parts.push(at(new THREE.BoxGeometry(0.026, 0.03, 0.0025), -0.016, 0, -0.002));
  const g = merge(parts);
  // The frame's open side to his left; standing proud of the strap.
  g.translate(b.cx + 0.012, b.y, b.cz + r + 0.002);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(g, metal === 'bronze' ? m.bronze : m.darkIron));
  return o;
}

// ------------------------------------------------------------------ set down in the street

/** Things set down where people work: built at the origin, standing on y = 0, facing +Z. */
export type WorkProp = 'anvil' | 'stall' | 'pots' | 'sacks' | 'laundry' | 'kiln' | 'loom';
export function makeWorkProp(kind: WorkProp, seed = 1) {
  const m = propMats(), x = M();
  const o = new THREE.Group();
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  if (kind === 'anvil') {
    const stump = lathe([[0.001, 0], [0.2, 0], [0.19, 0.05], [0.18, 0.5], [0.001, 0.5]], 10);
    const iron = merge([at(new THREE.BoxGeometry(0.34, 0.09, 0.13), 0, 0.58, 0), at(new THREE.BoxGeometry(0.12, 0.08, 0.1), 0, 0.5, 0), at(new THREE.ConeGeometry(0.055, 0.16, 6).rotateZ(-Math.PI / 2), 0.25, 0.6, 0)]);
    const tongs = at(new THREE.BoxGeometry(0.4, 0.012, 0.02), -0.05, 0.635, 0.03, 0, 0.3, 0);
    o.add(new THREE.Mesh(stump, m.ash), new THREE.Mesh(merge([iron, tongs]), m.darkIron));
  } else if (kind === 'stall') {
    // Trestles and a board under a cloth, a few jars and a basket of produce on it.
    const legs = [[-0.7, -0.25], [0.7, -0.25], [-0.7, 0.25], [0.7, 0.25]].map(([lx, lz]) => at(new THREE.BoxGeometry(0.05, 0.72, 0.05), lx, 0.36, lz, lz * 0.3, 0, lx * 0.05));
    const board = at(new THREE.BoxGeometry(1.7, 0.04, 0.7), 0, 0.74, 0);
    const cloth = at(new THREE.BoxGeometry(1.74, 0.012, 0.74), 0, 0.765, 0);
    const drop = at(new THREE.BoxGeometry(1.74, 0.22, 0.01), 0, 0.66, 0.37);
    const jars: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) jars.push(at(lathe([[0.001, 0], [0.06, 0.01], [0.085, 0.09], [0.06, 0.2], [0.035, 0.23], [0.045, 0.26], [0.001, 0.26]], 10), -0.6 + i * 0.22 + rnd() * 0.05, 0.77, -0.15 + rnd() * 0.1));
    const fruit: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 14; i++) fruit.push(at(new THREE.SphereGeometry(0.035, 6, 4), 0.35 + (rnd() - 0.5) * 0.4, 0.8 + rnd() * 0.04, (rnd() - 0.5) * 0.35));
    o.add(new THREE.Mesh(merge([...legs, board]), m.ash), new THREE.Mesh(merge([cloth, drop]), x.cloth), new THREE.Mesh(merge(jars), x.clay), new THREE.Mesh(merge(fruit), matte(rnd() < 0.5 ? 0x6e5a2a : 0x5a2a1e, 0.7)));
  } else if (kind === 'pots') {
    const pots: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const h = 0.25 + rnd() * 0.25, w = 0.1 + rnd() * 0.08;
      pots.push(at(lathe([[0.001, 0], [w * 0.6, 0.01], [w, h * 0.45], [w * 0.55, h * 0.9], [w * 0.62, h], [0.001, h]], 10), (i % 4) * 0.3 - 0.45 + rnd() * 0.08, 0, Math.floor(i / 4) * 0.3 + rnd() * 0.08));
    }
    o.add(new THREE.Mesh(merge(pots), x.clay));
  } else if (kind === 'sacks') {
    const sacks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) { const g = new THREE.SphereGeometry(0.22, 9, 7); g.scale(1, 1.35, 0.85); sacks.push(at(g, (i % 2) * 0.42 - 0.2 + rnd() * 0.05, 0.26 + (i > 1 ? 0.42 : 0), (rnd() - 0.5) * 0.1, 0, rnd(), (rnd() - 0.5) * 0.3)); }
    o.add(new THREE.Mesh(merge(sacks), x.sack));
  } else if (kind === 'laundry') {
    // A shallow basket of wet linen and a flat beating stone.
    const basket = lathe([[0.001, 0], [0.26, 0.01], [0.3, 0.16], [0.31, 0.18], [0.001, 0.18]], 14);
    const linen = new THREE.SphereGeometry(0.27, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    linen.scale(1, 0.4, 1).translate(0, 0.16, 0);
    const stone = at(new THREE.BoxGeometry(0.5, 0.1, 0.36), 0.15, 0.05, 0.55, 0, 0.4, 0.05);
    o.add(new THREE.Mesh(basket, m.ash), new THREE.Mesh(linen, x.linen), new THREE.Mesh(stone, x.stone));
  } else if (kind === 'kiln') {
    // A heap of burnt lime and a few blocks of marble waiting their turn.
    const heap = new THREE.SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    heap.scale(1, 0.55, 1);
    const blocks = [0, 1, 2].map((i) => at(new THREE.BoxGeometry(0.5, 0.35, 0.4), 1.0 + i * 0.1, 0.17 + (i === 2 ? 0.35 : 0), -0.3 + i * 0.45 - (i === 2 ? 0.45 : 0), 0, rnd(), 0));
    o.add(new THREE.Mesh(heap, matte(0xd8d2c4, 0.95)), new THREE.Mesh(merge(blocks), matte(0xbab4a6, 0.8)));
  } else if (kind === 'loom') {
    // A warp-weighted loom leaned against the wall, its clay weights hanging.
    const frame = merge([at(new THREE.BoxGeometry(0.06, 1.9, 0.06), -0.6, 0.95, 0, 0.2), at(new THREE.BoxGeometry(0.06, 1.9, 0.06), 0.6, 0.95, 0, 0.2), at(new THREE.BoxGeometry(1.3, 0.06, 0.06), 0, 1.82, -0.18)]);
    const warp = at(new THREE.PlaneGeometry(1.1, 1.3), 0, 1.15, -0.08, 0.2);
    const weights: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 10; i++) weights.push(at(new THREE.TorusGeometry(0.03, 0.015, 4, 8), -0.5 + i * 0.11, 0.42, 0.12, 0.2));
    o.add(new THREE.Mesh(frame, m.ash), new THREE.Mesh(warp, fabric('twill', 0x7a6e5a, { attr: 'position' })), new THREE.Mesh(merge(weights), x.clayDark));
  }
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = false; c.receiveShadow = true; } });
  return o;
}
