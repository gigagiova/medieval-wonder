import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, type MatName } from './materials';

export type LampKind = 'torch' | 'lantern' | 'candle' | 'window';
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
  flames: { pos: THREE.Vector3; size: number }[] = [];

  add(g: THREE.BufferGeometry, m: MatName, matrix?: THREE.Matrix4, collide = true) {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    if (matrix) geo.applyMatrix4(matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2));
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
    this.add(new THREE.BoxGeometry(w, h, d), m, tmpM, collide);
  }

  geo(m: MatName, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, collide = true, rx = 0, rz = 0) {
    tmpE.set(rx, ry, rz, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(1, 1, 1));
    this.add(g, m, tmpM, collide);
  }

  lamp(kind: LampKind, pos: THREE.Vector3, under = false) {
    const cfg = {
      torch: { c: new THREE.Color(1.0, 0.45, 0.15), i: 1.0, s: 0.55 },
      lantern: { c: new THREE.Color(1.0, 0.55, 0.22), i: 1.0, s: 0 },
      candle: { c: new THREE.Color(1.0, 0.6, 0.3), i: 0.28, s: 0.12 },
      window: { c: new THREE.Color(1.0, 0.45, 0.15), i: 0.35, s: 0 },
    }[kind];
    this.lamps.push({ pos: pos.clone(), color: cfg.c, intensity: cfg.i, under, seed: Math.random() * 100 });
    if (cfg.s > 0) this.flames.push({ pos: pos.clone(), size: cfg.s });
  }

  build(scene: THREE.Scene): THREE.Mesh {
    for (const [m, geos] of this.parts) {
      const merged = mergeGeometries(geos, false)!;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat(m));
      mesh.castShadow = m !== 'window';
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    const col = mergeGeometries(this.colliders, false)!;
    return new THREE.Mesh(col);
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
