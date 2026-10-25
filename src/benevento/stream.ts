import * as THREE from 'three';
import { mat, type MatName } from '../materials';
import { makeFire } from '../fire';
import type { Cell, Lamp } from '../builder';
import { field, fastTerrain } from '../displace';
import { BOUNDS } from './geo';
import { CHUNK, lodChunk, type Baked, type ChunkItems, type ChunkResult, type Hole } from './fabric';

// Streams the town around the player. Every chunk always has a cheap
// stand-in (plain house blocks, roofs and coarse ground, merged per 128 m
// super-chunk); chunks near the player are built in full by web workers and
// swap in as they arrive, and are dropped again when left behind. The fog
// closes in at ~70 m, so nobody sees the swap.
//
// Between the full chunks and the plain blocks there is a middle detail
// (R_MID): the same houses built by the same code with the same random draws,
// but without the small pieces, roof tiles and bevels and with coarse
// tessellation (about a fifth of the triangles). A middle chunk is uploaded
// once when it arrives and then only shown or hidden: it stays under a full
// chunk while that one is drawn and comes back the moment it is dropped, so
// neither swap rebuilds anything; its super-chunk leaves out its blocks.

export const R_IN = 48, R_OUT = 68;
/** Middle detail is built within R_MID and forgotten beyond R_MID_OUT. */
export const R_MID = 88, R_MID_OUT = 104;
const SUPER = 4; // chunks per super-chunk side
interface ChunkState { it: ChunkItems; status: 'lod' | 'queued' | 'building' | 'ready'; cell?: Cell; lamps: Lamp[]; fire?: THREE.Object3D; lod?: { walls: number[]; roofs: number[] };
  /** Middle detail (kept on the GPU while within R_MID_OUT); shown when in this.cells. */
  midCell?: Cell; midShown?: boolean; midStatus: 'none' | 'queued' | 'building' | 'ready' }
interface Super { key: number; si: number; sj: number; members: number[]; dirty: boolean; cell?: Cell; holes: Hole[] }

export class FabricStream {
  chunks = new Map<number, ChunkState>();
  supers = new Map<number, Super>();
  /** Sends new meshes to the GPU straight away (so their CPU arrays can be freed). */
  uploader?: (meshes: THREE.Mesh[]) => void;
  private workers: { w: Worker; busy: number | null }[] = [];
  private queue: number[] = [];
  private midQueue: number[] = [];
  /** Middle chunks that came back from the workers, uploaded one per frame. */
  private midArrived: ChunkResult[] = [];
  stats = { built: 0, ms: 0, ready: 0, building: 0, lodRebuilds: 0, tris: 0, mid: 0, midBuilt: 0, midMs: 0, superMs: 0 };
  private waiters: { x: number; z: number; r: number; res: () => void; prog?: (f: number) => void }[] = [];

  constructor(private scene: THREE.Scene, items: Map<number, ChunkItems>, private cells: Cell[], private lamps: Lamp[], holes: Hole[]) {
    for (const it of items.values()) {
      this.chunks.set(it.key, { it, status: 'lod', lamps: [], midStatus: 'none' });
      const si = Math.floor(it.i / SUPER), sj = Math.floor(it.j / SUPER), sk = si * 4096 + sj;
      let s = this.supers.get(sk);
      if (!s) this.supers.set(sk, (s = { key: sk, si, sj, members: [], dirty: true, holes: [] }));
      s.members.push(it.key);
    }
    for (const s of this.supers.values()) {
      const x0 = s.si * SUPER * CHUNK, z0 = s.sj * SUPER * CHUNK, x1 = x0 + SUPER * CHUNK, z1 = z0 + SUPER * CHUNK;
      s.holes = holes.filter((h) => h.pts.some(([x, z]) => x > x0 - 2 && x < x1 + 2 && z > z0 - 2 && z < z1 + 2));
    }
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./fabric.worker.ts', import.meta.url), { type: 'module' });
      const slot = { w, busy: null as number | null };
      w.onmessage = (e: MessageEvent<ChunkResult & { mid?: boolean }>) => { slot.busy = null; if (e.data.mid) this.midArrived.push(e.data); else this.arrive(e.data); this.pump(); };
      w.onerror = (e) => { console.warn('fabric worker error', e.message); slot.busy = null; };
      this.workers.push(slot);
    }
    for (const s of this.supers.values()) this.rebuildSuper(s);
  }

  /** Resolve once every chunk within r of (x, z) is built; prog gets 0..1. */
  ready(x: number, z: number, r: number, prog?: (f: number) => void) {
    return new Promise<void>((res) => { this.waiters.push({ x, z, r, res, prog }); this.checkWaiters(); });
  }
  /** The chunks' items within r of (x, z) (for occlusion: their houses). */
  itemsNear(x: number, z: number, r: number) { return this.near(x, z, r).map((c) => c.it); }
  private near(x: number, z: number, r: number) {
    const out: ChunkState[] = [];
    for (let i = Math.floor((x - r) / CHUNK); i <= Math.floor((x + r) / CHUNK); i++)
      for (let j = Math.floor((z - r) / CHUNK); j <= Math.floor((z + r) / CHUNK); j++) {
        const c = this.chunks.get((i + 2048) * 4096 + (j + 2048));
        if (c && rectDist(c.it, x, z) < r) out.push(c);
      }
    return out;
  }
  private checkWaiters() {
    this.waiters = this.waiters.filter((w) => {
      const list = this.near(w.x, w.z, w.r);
      const done = list.filter((c) => c.status === 'ready').length;
      w.prog?.(list.length ? done / list.length : 1);
      if (done === list.length) { w.res(); return false; }
      return true;
    });
  }

  /** Each frame: request what is near, drop what is far, refresh one stand-in. */
  update(cam: THREE.Vector3, dir?: THREE.Vector3) {
    const want: { k: number; d: number }[] = [];
    for (const c of this.near(cam.x, cam.z, R_IN)) {
      if (c.status !== 'lod') continue;
      let d = rectDist(c.it, cam.x, cam.z);
      // Prefer what is in front.
      if (dir) {
        const cx = (c.it.i + 0.5) * CHUNK - cam.x, cz = (c.it.j + 0.5) * CHUNK - cam.z, l = Math.hypot(cx, cz) || 1;
        if ((cx * dir.x + cz * dir.z) / l < -0.3) d += 30;
      }
      want.push({ k: c.it.key, d });
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want) { const c = this.chunks.get(w.k)!; c.status = 'queued'; this.queue.push(w.k); }
    // Keep the queue ordered by current distance.
    this.queue.sort((a, b) => rectDist(this.chunks.get(a)!.it, cam.x, cam.z) - rectDist(this.chunks.get(b)!.it, cam.x, cam.z));
    this.queue = this.queue.filter((k) => {
      const c = this.chunks.get(k)!;
      if (rectDist(c.it, cam.x, cam.z) > R_OUT) { c.status = 'lod'; return false; }
      return true;
    });
    // Middle detail: wanted within R_MID (also under full chunks, so it is
    // there the moment they are dropped), forgotten beyond R_MID_OUT.
    for (const c of this.near(cam.x, cam.z, R_MID)) if (c.midStatus === 'none') { c.midStatus = 'queued'; this.midQueue.push(c.it.key); }
    if (this.midQueue.length) {
      this.midQueue.sort((a, b) => rectDist(this.chunks.get(a)!.it, cam.x, cam.z) - rectDist(this.chunks.get(b)!.it, cam.x, cam.z));
      this.midQueue = this.midQueue.filter((k) => {
        const c = this.chunks.get(k)!;
        if (rectDist(c.it, cam.x, cam.z) > R_MID_OUT) { c.midStatus = 'none'; return false; }
        return true;
      });
    }
    this.pump();
    for (const c of this.chunks.values()) {
      if (c.status === 'ready' && rectDist(c.it, cam.x, cam.z) > R_OUT) this.unload(c);
      if (c.midStatus === 'ready' && rectDist(c.it, cam.x, cam.z) > R_MID_OUT) {
        const shown = c.midShown;
        this.hideMid(c);
        for (const m of c.midCell!.meshes) { this.scene.remove(m); m.geometry.dispose(); }
        c.midCell = undefined; c.midStatus = 'none'; this.stats.mid--;
        if (shown) this.markSuper(c); // its blocks come back
      }
    }
    // One middle chunk to the GPU per frame: spreads the uploads after a teleport.
    const r = this.midArrived.shift();
    if (r) this.arriveMid(r);
    let budget = 2;
    for (const s of this.supers.values()) if (s.dirty && budget-- > 0) this.rebuildSuper(s);
  }

  private pump() {
    for (const slot of this.workers) {
      if (slot.busy !== null) continue;
      // Full detail first; middle detail only with a worker to spare.
      const k = this.queue.shift();
      if (k !== undefined) {
        const c = this.chunks.get(k)!;
        c.status = 'building';
        slot.busy = k;
        slot.w.postMessage({ items: c.it });
        continue;
      }
      const m = this.midQueue.shift();
      if (m === undefined) break;
      const c = this.chunks.get(m)!;
      c.midStatus = 'building';
      slot.busy = m;
      slot.w.postMessage({ items: c.it, mid: true });
    }
    this.stats.building = this.workers.filter((w) => w.busy !== null).length;
  }

  private arrive(r: ChunkResult) {
    const c = this.chunks.get(r.key);
    if (!c) return;
    this.stats.built++; this.stats.ms += r.ms;
    if (c.status !== 'building') return; // dropped while building
    const cell: Cell = { key: 'f' + r.key, under: false, box: new THREE.Box3(), meshes: [], visible: true, occluded: 0 };
    let tris = 0;
    for (const bk of r.baked) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(bk.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(bk.nor, 3, true));
      g.computeBoundingBox(); g.computeBoundingSphere();
      cell.box.union(g.boundingBox!);
      // Free the CPU copy once it is on the GPU.
      for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(function (this: THREE.BufferAttribute) { (this as unknown as { array: unknown }).array = null; });
      const mesh = new THREE.Mesh(g, mat(bk.m));
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      cell.meshes.push(mesh);
      tris += bk.pos.length / 9;
    }
    this.stats.tris += tris;
    this.uploader?.(cell.meshes as THREE.Mesh[]);
    c.cell = cell;
    this.cells.push(cell);
    c.lamps = r.lamps.map((l, i) => ({ pos: new THREE.Vector3(...l.p), color: new THREE.Color(l.c[0], l.c[1], l.c[2]), intensity: l.i, under: l.under, seed: (r.key % 97) + i * 7.3 }));
    this.lamps.push(...c.lamps);
    if (r.flames.length) {
      c.fire = makeFire(r.flames.map((f) => ({ pos: new THREE.Vector3(...f.p), kind: f.kind as 'torch', scale: f.scale, under: f.under })));
      this.scene.add(c.fire);
    }
    c.status = 'ready';
    this.stats.ready++;
    this.hideMid(c);
    this.markSuper(c);
    this.checkWaiters();
  }

  private arriveMid(r: ChunkResult) {
    const c = this.chunks.get(r.key);
    if (!c) return;
    this.stats.midBuilt++; this.stats.midMs += r.ms;
    if (c.midStatus !== 'building') return; // dropped while building
    c.midCell = this.makeCell('m' + r.key, r.baked);
    c.midStatus = 'ready';
    this.stats.mid++;
    // Shown by its super-chunk's next rebuild (which drops the blocks it replaces).
    if (c.status !== 'ready') this.markSuper(c);
  }
  private makeCell(key: string, baked: Baked[]): Cell {
    const cell: Cell = { key, under: false, box: new THREE.Box3(), meshes: [], visible: true, occluded: 0 };
    for (const bk of baked) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(bk.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(bk.nor, 3, true));
      g.computeBoundingBox(); g.computeBoundingSphere();
      cell.box.union(g.boundingBox!);
      for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(function (this: THREE.BufferAttribute) { (this as unknown as { array: unknown }).array = null; });
      const mesh = new THREE.Mesh(g, mat(bk.m));
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.scene.add(mesh);
      cell.meshes.push(mesh);
    }
    this.uploader?.(cell.meshes as THREE.Mesh[]);
    return cell;
  }
  private showMid(c: ChunkState) {
    if (!c.midCell || c.midShown) return;
    c.midShown = true;
    c.midCell.occluded = 0;
    this.cells.push(c.midCell);
  }
  private hideMid(c: ChunkState) {
    if (!c.midCell || !c.midShown) return;
    c.midShown = false;
    const i = this.cells.indexOf(c.midCell);
    if (i >= 0) this.cells.splice(i, 1);
    for (const m of c.midCell.meshes) m.visible = false;
  }

  private unload(c: ChunkState) {
    if (c.cell) {
      for (const m of c.cell.meshes) { this.scene.remove(m); m.geometry.dispose(); }
      const i = this.cells.indexOf(c.cell);
      if (i >= 0) this.cells.splice(i, 1);
      c.cell = undefined;
    }
    for (const l of c.lamps) { const i = this.lamps.indexOf(l); if (i >= 0) this.lamps.splice(i, 1); }
    c.lamps = [];
    if (c.fire) {
      this.scene.remove(c.fire);
      c.fire.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (m.material as THREE.Material).dispose(); });
      c.fire = undefined;
    }
    c.status = 'lod';
    this.stats.ready--;
    // The middle detail takes over at once; without it the blocks come back.
    if (c.midCell) this.showMid(c); else this.markSuper(c);
  }

  private markSuper(c: ChunkState) {
    const s = this.supers.get(Math.floor(c.it.i / SUPER) * 4096 + Math.floor(c.it.j / SUPER));
    if (s) s.dirty = true;
  }

  /** The stand-in for one super-chunk: blocks for every chunk not built in full, and coarse ground. */
  private rebuildSuper(s: Super) {
    s.dirty = false;
    this.stats.lodRebuilds++;
    if (s.cell) {
      for (const m of s.cell.meshes) { this.scene.remove(m); m.geometry.dispose(); }
      const i = this.cells.indexOf(s.cell);
      if (i >= 0) this.cells.splice(i, 1);
      s.cell = undefined;
    }
    const t0 = performance.now();
    const walls: number[] = [], roofs: number[] = [];
    const readyRect: [number, number][] = [];
    const showing: ChunkState[] = [];
    for (const k of s.members) {
      const c = this.chunks.get(k)!;
      if (c.status === 'ready') { readyRect.push([c.it.i, c.it.j]); continue; }
      // Middle detail carries its own ground.
      if (c.midCell) { showing.push(c); readyRect.push([c.it.i, c.it.j]); continue; }
      if (!c.lod) c.lod = lodChunk(c.it);
      for (const v of c.lod.walls) walls.push(v);
      for (const v of c.lod.roofs) roofs.push(v);
    }
    // Coarse ground, 4 m, except under the chunks built in full and round holes.
    const ST = 4, N = (SUPER * CHUNK) / ST, x0 = s.si * SUPER * CHUNK, z0 = s.sj * SUPER * CHUNK;
    const gp: number[] = [];
    const fv = new THREE.Vector3();
    const Y = (x: number, z: number) => { field(x, 0, z, 'ground', fv); return fv.y + fastTerrain(x, z) - 0.03; };
    const H: number[] = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H.push(Y(x0 + i * ST, z0 + j * ST));
    const inHole = (x: number, z: number) => s.holes.some((h) => inPoly2(x, z, h.pts, 3));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = x0 + i * ST, z = z0 + j * ST;
      if (x + ST <= BOUNDS.x0 || x >= BOUNDS.x1 || z + ST <= BOUNDS.z0 || z >= BOUNDS.z1) continue;
      const ci = Math.floor((x + ST / 2) / CHUNK), cj = Math.floor((z + ST / 2) / CHUNK);
      if (readyRect.some(([a, b]) => a === ci && b === cj)) continue;
      if (inHole(x + ST / 2, z + ST / 2)) continue;
      const a = H[j * (N + 1) + i], b = H[j * (N + 1) + i + 1], c = H[(j + 1) * (N + 1) + i], d = H[(j + 1) * (N + 1) + i + 1];
      gp.push(x, a, z, x, c, z + ST, x + ST, b, z, x + ST, b, z, x, c, z + ST, x + ST, d, z + ST);
    }
    const cell: Cell = { key: 's' + s.key, under: false, box: new THREE.Box3(), meshes: [], visible: true, occluded: 0, range: 420, lod: true };
    const add = (pos: number[], m: MatName) => {
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      g.computeBoundingBox(); g.computeBoundingSphere();
      cell.box.union(g.boundingBox!);
      for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(function (this: THREE.BufferAttribute) { (this as unknown as { array: unknown }).array = null; });
      const mesh = new THREE.Mesh(g, mat(m));
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      cell.meshes.push(mesh);
    };
    add(walls, 'rubble'); add(roofs, 'roof'); add(gp, 'ground');
    if (cell.meshes.length) { this.uploader?.(cell.meshes as THREE.Mesh[]); s.cell = cell; this.cells.push(cell); }
    for (const c of showing) this.showMid(c);
    this.stats.superMs += performance.now() - t0;
  }
}

function rectDist(it: ChunkItems, x: number, z: number) {
  const x0 = it.i * CHUNK, z0 = it.j * CHUNK;
  const dx = Math.max(x0 - x, 0, x - (x0 + CHUNK)), dz = Math.max(z0 - z, 0, z - (z0 + CHUNK));
  return Math.hypot(dx, dz);
}
function inPoly2(x: number, z: number, P: [number, number][], m: number) {
  let c = false;
  for (let a = 0, q = P.length - 1; a < P.length; q = a++) if ((P[a][1] > z) !== (P[q][1] > z) && x < ((P[q][0] - P[a][0]) * (z - P[a][1])) / (P[q][1] - P[a][1]) + P[a][0]) c = !c;
  if (c) return true;
  for (const [px, pz] of P) if (Math.hypot(px - x, pz - z) < m) return true;
  return false;
}
