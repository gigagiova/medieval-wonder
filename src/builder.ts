import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, type MatName } from './materials';
import { tessellate, displace, TESS } from './displace';
import type { FireKind, FireSource } from './fire';

export type LampKind = 'torch' | 'brazier' | 'lantern' | 'oil' | 'candle' | 'window' | 'poly';
export type PropKind = 'skull' | 'femur' | 'humerus' | 'tibia';
export interface Prop { kind: PropKind; matrix: THREE.Matrix4; under: boolean }

/** A spatial cell of merged geometry, used for frustum, zone and occlusion culling. */
export interface Cell { key: string; under: boolean; box: THREE.Box3; meshes: THREE.Mesh[]; visible: boolean; occluded: number }
export const CELL_SIZE = 36;
export interface Lamp {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  under: boolean;
  seed: number;
  follow?: () => THREE.Vector3;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

// Collects every static piece of the world, then merges it into one draw call
// per material plus a single position-only collision mesh.
export class Builder {
  parts = new Map<MatName, THREE.BufferGeometry[]>();
  colliders: THREE.BufferGeometry[] = [];
  lamps: Lamp[] = [];
  flames: FireSource[] = [];
  props: Prop[] = [];

  /** `fine`: geometry is already finely subdivided, so skip tessellation. */
  add(g: THREE.BufferGeometry, m: MatName, matrix?: THREE.Matrix4, collide = true, fine = false) {
    let geo = g.clone();
    if (matrix) geo.applyMatrix4(matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2));
    if (!fine) geo = tessellate(geo, m);
    displace(geo, m);
    if (geo.index) geo = geo.toNonIndexed();
    if (!this.parts.has(m)) this.parts.set(m, []);
    this.parts.get(m)!.push(geo);
    if (collide) this.collide(geo);
  }

  collide(geo: THREE.BufferGeometry) {
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', geo.attributes.position.clone());
    this.colliders.push(c);
  }

  /** Box centred at (x, y-bottom, z): y is the bottom of the box. */
  box(m: MatName, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, collide = true, rx = 0, rz = 0) {
    tmpE.set(rx, ry, rz, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(x, y + h / 2, z), tmpQ, new THREE.Vector3(1, 1, 1));
    const L = TESS[m] ?? 1e9;
    const seg = (s: number) => Math.min(64, Math.max(1, Math.ceil(s / L)));
    this.add(new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)), m, tmpM, collide, true);
  }

  geo(m: MatName, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, collide = true, rx = 0, rz = 0) {
    tmpE.set(rx, ry, rz, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(1, 1, 1));
    this.add(g, m, tmpM, collide);
  }

  /** A light source; `pos` is the base of the flame, the light sits a little above it. */
  lamp(kind: LampKind, pos: THREE.Vector3, under = false, fire?: FireKind | null, scale = 1) {
    const cfg = {
      torch: { c: new THREE.Color(1.0, 0.42, 0.12), i: 1.0, f: 'torch', lift: 0.25 },
      brazier: { c: new THREE.Color(1.0, 0.38, 0.1), i: 1.4, f: 'brazier', lift: 0.35 },
      lantern: { c: new THREE.Color(1.0, 0.5, 0.18), i: 0.45, f: null, lift: 0 },
      oil: { c: new THREE.Color(1.0, 0.55, 0.25), i: 0.3, f: 'oil', lift: 0.05 },
      candle: { c: new THREE.Color(1.0, 0.58, 0.28), i: 0.2, f: 'candle', lift: 0.06 },
      window: { c: new THREE.Color(1.0, 0.42, 0.12), i: 0.3, f: null, lift: 0 },
      poly: { c: new THREE.Color(1.0, 0.6, 0.3), i: 1.5, f: null, lift: 0 },
    }[kind];
    const fk = fire === undefined ? (cfg.f as FireKind | null) : fire;
    const lp = pos.clone();
    lp.y += cfg.lift * scale;
    this.lamps.push({ pos: lp, color: cfg.c, intensity: cfg.i, under, seed: Math.random() * 100 });
    if (fk) this.flames.push({ pos: pos.clone(), kind: fk, scale });
  }

  /** A flame without its own light (e.g. the cups of a polykandelon). */
  flame(kind: FireKind, pos: THREE.Vector3, scale = 1) {
    this.flames.push({ pos: pos.clone(), kind, scale });
  }

  prop(kind: PropKind, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1) {
    tmpE.set(rx, ry, rz, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(s, s, s));
    this.props.push({ kind, matrix: m, under: y < -2.5 });
  }

  /**
   * Merge everything into cells (36 m squares, split above / below ground),
   * one mesh per material per cell, so whole cells can be culled cheaply.
   * Large pieces (the ground) are split per triangle.
   */
  build(scene: THREE.Scene): { collider: THREE.Mesh; cells: Cell[] } {
    const buckets = new Map<string, Map<MatName, THREE.BufferGeometry[]>>();
    const put = (key: string, m: MatName, g: THREE.BufferGeometry) => {
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = new Map()));
      if (!b.has(m)) b.set(m, []);
      b.get(m)!.push(g);
    };
    const keyOf = (x: number, y: number, z: number) =>
      `${y < -2.5 ? 'u' : 'a'}|${Math.floor(x / CELL_SIZE)}|${Math.floor(z / CELL_SIZE)}`;
    const box = new THREE.Box3(), c = new THREE.Vector3();
    for (const [m, geos] of this.parts) {
      for (const g of geos) {
        box.setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute);
        const size = box.getSize(c).length();
        if (size < CELL_SIZE * 0.75) {
          box.getCenter(c);
          put(keyOf(c.x, c.y, c.z), m, g);
          continue;
        }
        // Split by triangle centroid.
        const pos = g.attributes.position.array as Float32Array;
        const nor = g.attributes.normal.array as Float32Array;
        const uv = g.attributes.uv.array as Float32Array;
        const groups = new Map<string, number[]>();
        for (let t = 0; t < pos.length / 9; t++) {
          const o = t * 9;
          const k = keyOf((pos[o] + pos[o + 3] + pos[o + 6]) / 3, (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3, (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(t);
        }
        for (const [k, tris] of groups) {
          const p2 = new Float32Array(tris.length * 9), n2 = new Float32Array(tris.length * 9), u2 = new Float32Array(tris.length * 6);
          tris.forEach((t, i) => {
            p2.set(pos.subarray(t * 9, t * 9 + 9), i * 9);
            n2.set(nor.subarray(t * 9, t * 9 + 9), i * 9);
            u2.set(uv.subarray(t * 6, t * 6 + 6), i * 6);
          });
          const sg = new THREE.BufferGeometry();
          sg.setAttribute('position', new THREE.BufferAttribute(p2, 3));
          sg.setAttribute('normal', new THREE.BufferAttribute(n2, 3));
          sg.setAttribute('uv', new THREE.BufferAttribute(u2, 2));
          put(k, m, sg);
        }
      }
    }
    const cells: Cell[] = [];
    for (const [key, b] of buckets) {
      const cell: Cell = { key, under: key[0] === 'u', box: new THREE.Box3(), meshes: [], visible: true, occluded: 0 };
      for (const [m, geos] of b) {
        const merged = mergeGeometries(geos, false)!;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        cell.box.union(merged.boundingBox!);
        const mesh = new THREE.Mesh(merged, mat(m));
        mesh.castShadow = !['window', 'ember', 'horn'].includes(m) && !cell.under;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        cell.meshes.push(mesh);
      }
      cells.push(cell);
    }
    const col = mergeGeometries(this.colliders, false)!;
    return { collider: new THREE.Mesh(col), cells };
  }
}

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
