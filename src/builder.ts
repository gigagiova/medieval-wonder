import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A box whose faces are grids already fine enough to bend (spacing ~L), with
 * two extra grid lines just inside every edge, projected onto a rounded box of
 * radius r. Worn arrises for the price of a few more triangles.
 */
function wornBox(w: number, h: number, d: number, r: number, L: number) {
  const lines = (s: number) => {
    const half = s / 2, a = [-half, -half + r * 0.35, -half + r];
    const n = Math.max(1, Math.ceil((s - 2 * r) / L));
    for (let i = 1; i < n; i++) a.push(-half + r + ((s - 2 * r) * i) / n);
    a.push(half - r, half - r * 0.35, half);
    return a;
  };
  const X = lines(w), Y = lines(h), Z = lines(d);
  const pos: number[] = [], idx: number[] = [];
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const push = (x: number, y: number, z: number) => {
    const cx = Math.max(-hx, Math.min(hx, x)), cy = Math.max(-hy, Math.min(hy, y)), cz = Math.max(-hz, Math.min(hz, z));
    let dx = x - cx, dy = y - cy, dz = z - cz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    pos.push(cx + dx * r, cy + dy * r, cz + dz * r);
  };
  // Each face: a grid over two axes at a fixed third coordinate.
  const face = (U: number[], V: number[], f: (u: number, v: number) => [number, number, number], flip: boolean) => {
    const base = pos.length / 3;
    for (const v of V) for (const u of U) push(...f(u, v));
    const nu = U.length;
    for (let j = 0; j < V.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i, b = a + 1, c = a + nu, e = c + 1;
      if (flip) idx.push(a, e, b, a, c, e); else idx.push(a, b, e, a, e, c);
    }
  };
  face(X, Y, (u, v) => [u, v, d / 2], false);
  face(X, Y, (u, v) => [u, v, -d / 2], true);
  face(Z, Y, (u, v) => [w / 2, v, u], true);
  face(Z, Y, (u, v) => [-w / 2, v, u], false);
  face(X, Z, (u, v) => [u, h / 2, v], true);
  face(X, Z, (u, v) => [u, -h / 2, v], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Faces meet with duplicated vertices; merge so normals are smooth round the arris.
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  m.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(m.attributes.position.count * 2), 2));
  return m;
}

/**
 * Detail level of what is built. 'mid' is for town chunks seen from 40-96 m
 * (see benevento/stream.ts): small pieces (< ~0.5 m), roof tiles and worn or
 * bevelled edges are dropped and surfaces are tessellated coarsely, but every
 * random draw still happens, so the houses keep exactly the same shapes,
 * materials and roofs as their full-detail build.
 */
export const DETAIL = { mid: false };

/** Masonry never has knife edges: these materials get rounded, weathered arrises. */
const WORN: Partial<Record<MatName, number>> = { stone: 1, block: 1, bigstone: 1.3, rubble: 1.2, brick: 0.8, marble: 0.9, slab: 0.7, plaster: 1.1, rock: 1.4, ground: 1.4, clay: 0.6 };
import { mat, type MatName } from './materials';
import { tessellate, displace, displacePositions, field, TESS, SITE, toWorldXZ, liftGeometry, fastTerrain } from './displace';

// Point features (lamps, flames, props) move with the same field as the walls
// they hang on, so nothing floats off a bulging wall or the sloping ground;
// then, like every vertex, they go from the site's frame to the world and up
// onto the terrain.
const fv = new THREE.Vector3();
const _xz = [0, 0];
function follow(p: THREE.Vector3) {
  field(p.x, p.y, p.z, 'stone', fv);
  p.add(fv);
  return placeWorld(p);
}
/** Site frame → world, then onto the terrain. */
export function placeWorld(p: THREE.Vector3) {
  toWorldXZ(p.x, p.z, _xz);
  p.x = _xz[0]; p.z = _xz[1];
  p.y += fastTerrain(p.x, p.z);
  return p;
}
/** Local (above/below the ground under it) height of a world point. */
export const localY = (x: number, y: number, z: number) => y - fastTerrain(x, z);
/** Move a geometry from the active site's frame to world x/z (positions and normals). */
function siteToWorldGeo(g: THREE.BufferGeometry) {
  if (!SITE.on) return;
  const P = g.attributes.position.array as Float32Array;
  const N = g.attributes.normal?.array as Float32Array | undefined;
  const c = SITE.c, s = SITE.s;
  for (let o = 0; o < P.length; o += 3) {
    toWorldXZ(P[o], P[o + 2], _xz);
    P[o] = _xz[0]; P[o + 2] = _xz[1];
    if (N) { const nx = N[o], nz = N[o + 2]; N[o] = nx * c + nz * s; N[o + 2] = -nx * s + nz * c; }
  }
}
import type { FireKind, FireSource } from './fire';

export type LampKind = 'torch' | 'brazier' | 'lantern' | 'oil' | 'candle' | 'window' | 'poly';
export type PropKind = 'skull' | 'femur' | 'humerus' | 'tibia';
export interface Prop { kind: PropKind; matrix: THREE.Matrix4; under: boolean }

/** A spatial cell of merged geometry, used for frustum, zone and occlusion culling. */
export interface Cell { key: string; under: boolean; box: THREE.Box3; meshes: THREE.Mesh[]; visible: boolean; occluded: number; /** Draw distance (default 120 m). */ range?: number; /** A far stand-in (never ray-tested). */ lod?: boolean; /** Behind the houses in the occlusion buffer this frame. */ behind?: boolean }
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
  /** `raw`: geometry is already organic (e.g. carved SDF rock): no tessellation, no displacement. */
  /**
   * Collision never uses the render mesh: it uses `proxy` (or the piece's own
   * un-tessellated shape), bent by the same field so it stays in place.
   */
  /** 'collide': only collision is gathered (no render geometry); 'render': no collision. */
  mode: 'full' | 'collide' | 'render' = 'full';
  /**
   * When set, geometry is raised by this constant instead of riding the
   * terrain (bridges over a river valley, things hung at an absolute height).
   */
  absY: number | null = null;
  private lift(g: THREE.BufferGeometry) {
    if (this.absY === null) { liftGeometry(g); return; }
    const P = g.attributes.position.array as Float32Array;
    for (let o = 1; o < P.length; o += 3) P[o] += this.absY;
    g.attributes.position.needsUpdate = true;
  }
  private place(p: THREE.Vector3) {
    if (this.absY === null) return follow(p);
    field(p.x, p.y, p.z, 'stone', fv); p.add(fv);
    toWorldXZ(p.x, p.z, _xz); p.x = _xz[0]; p.z = _xz[1]; p.y += this.absY;
    return p;
  }
  add(g: THREE.BufferGeometry, m: MatName, matrix?: THREE.Matrix4, collide = true, fine = false, raw = false, proxy?: THREE.BufferGeometry) {
    if (collide && this.mode !== 'render') {
      let c = (proxy ?? g).clone();
      if (matrix) c.applyMatrix4(matrix);
      if (c.index) c = c.toNonIndexed();
      if (!raw) displacePositions(c, m);
      siteToWorldGeo(c);
      this.lift(c);
      this.pushCollider(c);
    }
    if (this.mode === 'collide') return;
    let geo = g.clone();
    if (matrix) geo.applyMatrix4(matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2));
    if (!raw) {
      if (!fine) geo = tessellate(geo, m);
      displace(geo, m);
    }
    if (geo.index) geo = geo.toNonIndexed();
    siteToWorldGeo(geo);
    this.lift(geo);
    if (!this.parts.has(m)) this.parts.set(m, []);
    this.parts.get(m)!.push(geo);
  }

  /** Add finished world-space geometry (already displaced and lifted). */
  addWorld(geo: THREE.BufferGeometry, m: MatName) {
    if (this.mode === 'collide') return;
    if (geo.index) geo = geo.toNonIndexed();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!this.parts.has(m)) this.parts.set(m, []);
    this.parts.get(m)!.push(geo);
  }

  /** A collision-only shape, bent by the world field like everything else. */
  collideShape(g: THREE.BufferGeometry, m: MatName) {
    if (this.mode === 'render') return;
    const c = g.index ? g.toNonIndexed() : g.clone();
    displacePositions(c, m);
    siteToWorldGeo(c);
    this.lift(c);
    this.pushCollider(c);
  }
  /** Collision triangles already in world space. */
  collideWorld(c: THREE.BufferGeometry) {
    if (this.mode === 'render') return;
    this.pushCollider(c.index ? c.toNonIndexed() : c);
  }

  /** Collision triangles in the current frame (site-local, y above local ground): placed in the world like geometry, but not displaced. */
  collide(geo: THREE.BufferGeometry) {
    if (this.mode === 'render') return;
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', (geo.index ? geo.toNonIndexed() : geo).attributes.position.clone());
    siteToWorldGeo(c);
    this.lift(c);
    this.colliders.push(c);
  }
  private pushCollider(geo: THREE.BufferGeometry) {
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', geo.attributes.position.clone());
    this.colliders.push(c);
  }

  /** Box centred at (x, y-bottom, z): y is the bottom of the box. */
  box(m: MatName, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, collide = true, rx = 0, rz = 0) {
    tmpE.set(rx, ry, rz, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(x, y + h / 2, z), tmpQ, new THREE.Vector3(1, 1, 1));
    if (this.mode === 'collide') { if (collide) this.add(new THREE.BoxGeometry(w, h, d), m, tmpM, true, true); return; }
    const L = TESS[m] ?? 1e9;
    const seg = (s: number) => Math.min(64, Math.max(1, Math.ceil(s / L)));
    const proxy = collide ? new THREE.BoxGeometry(w, h, d) : undefined;
    const worn = WORN[m];
    const small = Math.min(w, h, d);
    if (worn && small > 0.03 && !DETAIL.mid) {
      // Radius grows with the block: a few cm on a sill, 10-20 cm on a wall end.
      const r = THREE.MathUtils.clamp(small * 0.16 * worn, 0.012, 0.2 * worn);
      this.add(wornBox(w, h, d, Math.min(r, small * 0.45), Math.min(L, 4)), m, tmpM, collide, true, false, proxy);
      return;
    }
    this.add(new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)), m, tmpM, collide, true, false, proxy);
  }

  geo(m: MatName, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, collide = true, rx = 0, rz = 0, fine = false, proxy?: THREE.BufferGeometry) {
    tmpE.set(rx, ry, rz, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(1, 1, 1));
    this.add(g, m, tmpM, collide, fine, false, proxy);
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
    if (this.mode === 'collide') return;
    pos = this.place(pos.clone());
    const lp = pos.clone();
    lp.y += cfg.lift * scale;
    this.lamps.push({ pos: lp, color: cfg.c, intensity: cfg.i, under, seed: Math.random() * 100 });
    if (fk) this.flames.push({ pos: pos.clone(), kind: fk, scale, under });
  }

  /** A flame without its own light (e.g. the cups of a polykandelon). */
  flame(kind: FireKind, pos: THREE.Vector3, scale = 1) {
    if (this.mode === 'collide') return;
    const under = pos.y < -2.5;
    this.flames.push({ pos: this.place(pos.clone()), kind, scale, under });
  }

  prop(kind: PropKind, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1) {
    if (this.mode === 'collide') return;
    tmpE.set(rx, ry + (SITE.on ? SITE.rot : 0), rz, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    const m = new THREE.Matrix4().compose(this.place(new THREE.Vector3(x, y, z)), tmpQ, new THREE.Vector3(s, s, s));
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
      `${localY(x, y, z) < -2.5 ? 'u' : 'a'}|${Math.floor(x / CELL_SIZE)}|${Math.floor(z / CELL_SIZE)}`;
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
    this.parts.clear();
    const cells: Cell[] = [];
    for (const [key, b] of buckets) {
      const cell: Cell = { key, under: key[0] === 'u', box: new THREE.Box3(), meshes: [], visible: true, occluded: 0 };
      for (const [m, geos] of b) {
        // Shading is all in world space: no texture coordinates are needed.
        for (const g of geos) g.deleteAttribute('uv');
        const merged = mergeGeometries(geos, false)!;
        geos.length = 0;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        // Normals as bytes: a third of the memory, no visible difference.
        {
          const N = merged.attributes.normal.array as Float32Array, n8 = new Int8Array(N.length);
          for (let i = 0; i < N.length; i++) n8[i] = Math.max(-127, Math.min(127, Math.round(N[i] * 127)));
          merged.setAttribute('normal', new THREE.BufferAttribute(n8, 3, true));
        }
        // Keep no CPU copy once the GPU has it.
        for (const a of Object.values(merged.attributes)) (a as THREE.BufferAttribute).onUpload(function (this: THREE.BufferAttribute) { (this as unknown as { array: unknown }).array = null; });
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
    this.colliders.length = 0;
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
