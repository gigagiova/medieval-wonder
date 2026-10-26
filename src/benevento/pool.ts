import * as THREE from 'three';
import { mat, type MatName } from '../materials';
import { NCL } from '../clusters';
import type { Baked } from './fabric';

// One draw per material for the whole streamed town.
//
// The town arrives chunk by chunk (32 m), each chunk with a dozen materials:
// drawn as its own meshes, the ten or so chunks in full detail and the
// thirty-odd in middle detail around them cost a draw call per material per
// chunk, 70-90 calls, more than everything else in a view together.
// Here every chunk's geometry for a material goes into one shared vertex
// buffer per material (a "page", grown by doubling on the GPU when full), at
// a range of its own. A single index buffer per page lists, every frame the
// view changes, the clusters (see clusters.ts) of the chunks that are shown:
// full or middle detail, in view, not fogged, not behind the houses. So the
// town is one draw per material whatever the number of chunks, and only what
// can be seen is drawn. Vertex data is written straight into the GL buffers
// (GLBufferAttribute) and kept nowhere else.

let gl: WebGL2RenderingContext | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Object3D | null = null;
export function setPoolTarget(r: THREE.WebGLRenderer, s: THREE.Object3D) {
  renderer = r;
  gl = r.getContext() as WebGL2RenderingContext;
  scene = s;
}

interface Range { off: number; n: number }
/** One chunk's share of a page. */
interface Slot { page: Page; off: number; n: number; start: Uint32Array; count: Uint32Array; entry: PoolEntry }

/** A chunk (one detail level) in the pool: shown or not, and which of its clusters. */
export class PoolEntry {
  slots: Slot[] = [];
  shown = false;
  mask = 0;
  /** Set by the culling each frame. */
  show(mask: number) {
    const shown = mask !== 0;
    if (shown === this.shown && (mask === this.mask || !shown)) return;
    this.shown = shown;
    this.mask = mask;
    for (const s of this.slots) s.page.dirty = true;
  }
  /** Give its ranges back (the chunk is dropped). */
  free() {
    for (const s of this.slots) s.page.release(s);
    this.slots = [];
  }
}

const COPY_R = 0x8f36, COPY_W = 0x8f37; // COPY_READ_BUFFER, COPY_WRITE_BUFFER

class Page {
  mesh: THREE.Mesh;
  cap = 0;
  used = 0;
  free: Range[] = [];
  slots = new Set<Slot>();
  dirty = false;
  private bufs: { pos: WebGLBuffer; nor: WebGLBuffer; ids: WebGLBuffer | null } | null = null;
  private index!: THREE.BufferAttribute;
  constructor(public m: MatName, private ids: boolean) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat(m));
    this.mesh.name = 'town:' + m;
    this.mesh.frustumCulled = false; // culled by cluster, in the index
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    scene!.add(this.mesh);
  }

  /** Make room for n vertices more than the largest free range: grow (copying on the GPU). */
  private grow(need: number) {
    const g = gl!;
    let cap = Math.max(this.cap * 2, 1 << 15);
    while (cap - this.cap < need) cap *= 2;
    const mk = (bytes: number, old: WebGLBuffer | null, oldBytes: number) => {
      const b = g.createBuffer()!;
      g.bindBuffer(COPY_W, b);
      g.bufferData(COPY_W, bytes, g.STATIC_DRAW);
      if (old && oldBytes) {
        g.bindBuffer(COPY_R, old);
        g.copyBufferSubData(COPY_R, COPY_W, 0, 0, oldBytes);
        g.bindBuffer(COPY_R, null);
      }
      g.bindBuffer(COPY_W, null);
      return b;
    };
    const o = this.bufs, oc = this.cap;
    const bufs = { pos: mk(cap * 12, o?.pos ?? null, oc * 12), nor: mk(cap * 3, o?.nor ?? null, oc * 3), ids: this.ids ? mk(cap, o?.ids ?? null, oc) : null };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.GLBufferAttribute(bufs.pos, g.FLOAT, 3, 4, cap) as unknown as THREE.BufferAttribute);
    geo.setAttribute('normal', new THREE.GLBufferAttribute(bufs.nor, g.BYTE, 3, 1, cap, true) as unknown as THREE.BufferAttribute);
    if (bufs.ids) geo.setAttribute('matId', new THREE.GLBufferAttribute(bufs.ids, g.UNSIGNED_BYTE, 1, 1, cap) as unknown as THREE.BufferAttribute);
    this.index = new THREE.BufferAttribute(new Uint32Array(cap), 1);
    this.index.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(this.index);
    geo.setDrawRange(0, 0);
    // The old geometry's buffers go with it (three deletes them on dispose if it ever drew it).
    const old = this.mesh.geometry;
    this.mesh.geometry = geo;
    old.dispose();
    if (o) { g.deleteBuffer(o.pos); g.deleteBuffer(o.nor); if (o.ids) g.deleteBuffer(o.ids); }
    // The new space is one free range at the end (merged with a free tail).
    const tail = this.free.find((r) => r.off + r.n === oc);
    if (tail) tail.n += cap - oc; else this.free.push({ off: oc, n: cap - oc });
    this.cap = cap;
    this.bufs = bufs;
    this.dirty = true;
  }

  private alloc(n: number): number {
    let best = -1;
    for (let i = 0; i < this.free.length; i++) if (this.free[i].n >= n && (best < 0 || this.free[i].n < this.free[best].n)) best = i;
    if (best < 0) {
      this.grow(n);
      return this.alloc(n);
    }
    const r = this.free[best], off = r.off;
    r.off += n; r.n -= n;
    if (!r.n) this.free.splice(best, 1);
    this.used += n;
    return off;
  }
  release(s: Slot) {
    this.slots.delete(s);
    this.used -= s.n;
    this.free.push({ off: s.off, n: s.n });
    this.free.sort((a, b) => a.off - b.off);
    for (let i = this.free.length - 1; i > 0; i--) {
      const a = this.free[i - 1], b = this.free[i];
      if (a.off + a.n === b.off) { a.n += b.n; this.free.splice(i, 1); }
    }
    this.dirty = true;
  }

  add(bk: Baked, entry: PoolEntry) {
    const g = gl!;
    const n = bk.pos.length / 3;
    const off = this.alloc(n);
    const put = (buf: WebGLBuffer, bytes: number, data: ArrayBufferView) => {
      g.bindBuffer(COPY_W, buf);
      g.bufferSubData(COPY_W, bytes, data);
      g.bindBuffer(COPY_W, null);
    };
    put(this.bufs!.pos, off * 12, bk.pos);
    put(this.bufs!.nor, off * 3, bk.nor);
    if (this.bufs!.ids && bk.ids) put(this.bufs!.ids, off, bk.ids);
    const s: Slot = { page: this, off, n, start: bk.start, count: bk.count, entry };
    this.slots.add(s);
    entry.slots.push(s);
    if (entry.shown) this.dirty = true;
  }

  /** Rewrite the index: the shown clusters of the shown chunks. */
  flush(all: ((s: Slot) => boolean) | null = null) {
    this.dirty = false;
    const arr = this.index.array as Uint32Array;
    let n = 0;
    for (const s of this.slots) {
      const e = s.entry;
      const mask = all ? (all(s) ? -1 : 0) : e.shown ? e.mask : 0;
      if (!mask) continue;
      for (let c = 0; c < NCL; c++) {
        if (!((mask >> c) & 1)) continue;
        const a = s.off + s.start[c], b = a + s.count[c];
        for (let i = a; i < b; i++) arr[n++] = i;
      }
    }
    this.mesh.geometry.setDrawRange(0, n);
    this.mesh.visible = n > 0;
    if (n) {
      this.index.clearUpdateRanges();
      this.index.addUpdateRange(0, n);
      this.index.needsUpdate = true;
      poolStats.uploaded += n * 4;
    }
    poolStats.rewrites++;
  }
}

export const poolStats = { rewrites: 0, uploaded: 0, pages: 0, verts: 0, cap: 0 };
const pages = new Map<string, Page>();

/** Put a chunk's baked meshes into the pool (hidden until shown). */
export function poolAdd(baked: Baked[]): PoolEntry {
  const e = new PoolEntry();
  for (const bk of baked) {
    if (!bk.pos.length) continue;
    let p = pages.get(bk.m);
    if (!p) { p = new Page(bk.m, !!bk.ids); pages.set(bk.m, p); }
    p.add(bk, e);
  }
  return e;
}

/** After the culling: rewrite the indices that changed. */
export function poolFlush() {
  for (const p of pages.values()) if (p.dirty) p.flush();
}

/**
 * Draw every chunk whose slot passes `want`, whatever the culling said (a bake
 * from another view), until poolRestore().
 */
export function poolAll(want: (e: PoolEntry) => boolean) {
  for (const p of pages.values()) p.flush((s) => want(s.entry));
}
export function poolRestore() {
  for (const p of pages.values()) p.flush();
}

export function poolInfo() {
  let verts = 0, cap = 0;
  for (const p of pages.values()) { verts += p.used; cap += p.cap; }
  Object.assign(poolStats, { pages: pages.size, verts, cap });
  return poolStats;
}
export const poolReady = () => !!renderer;
