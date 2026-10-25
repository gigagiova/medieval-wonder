import * as THREE from 'three';
import type { TreePack } from './pack';
import { barkMaterial, leafMaterial, impostorMaterial, vegUniforms } from './materials';

// A field of trees over the whole world. Every tree is a few numbers in flat
// arrays, bucketed on a 32 m grid. Every few frames the trees near the camera
// are dealt out to two BatchedMeshes (all bark, all leaves: one draw call
// each, every tree type and LOD) and the ones further out to one instanced
// impostor mesh. LODs and impostors fade into one another with a screen-door
// dither over a few metres (see materials.ts).

export interface TreeKind {
  /** Index into pack.trees. */
  tree: number;
  /** Distance (m, at scale 1) where each mesh LOD ends; the last is where the impostor (if any) takes over. */
  ends: number[];
  /** Impostor draw distance (m), 0 = no impostor: the tree fades out at its last LOD end. */
  far: number;
}

const BK = 32;
const NONE: number[] = [];
const keyOf = (i: number, j: number) => (i + 2048) * 4096 + (j + 2048);

export class TreeField {
  readonly group = new THREE.Group();
  private kinds: TreeKind[] = [];
  // per tree
  private n = 0;
  private kind: number[] = [];
  private pos: number[] = [];
  private scale: number[] = [];
  private yaw: number[] = [];
  private tint: number[] = [];
  private season: number[] = [];
  private buckets = new Map<number, number[]>();
  private maxFar = 0;
  // GPU side
  private bark!: THREE.BatchedMesh;
  private leaf!: THREE.BatchedMesh;
  private imp: THREE.InstancedMesh | null = null;
  private impA: THREE.InstancedBufferAttribute | null = null;
  private impT: THREE.InstancedBufferAttribute | null = null;
  private barkGeo: number[] = []; // pack mesh index -> geometry id in the bark batch
  private leafGeo: number[] = [];
  private barkIds: number[] = []; // instance ids in the pools
  private leafIds: number[] = [];
  private frame = 0;
  private lod = new Uint8Array(0);
  readonly stats = { meshes: 0, impostors: 0, tris: 0, trees: 0, lodTris: [0, 0, 0, 0] };

  constructor(readonly pack: TreePack, private poolSize = 900, private impPool = 2600) {
    this.group.name = 'trees';
  }

  addKind(k: TreeKind): number {
    this.kinds.push(k);
    this.maxFar = Math.max(this.maxFar, k.far || k.ends[k.ends.length - 1]);
    return this.kinds.length - 1;
  }

  /** Plant a tree. `season`: 0 late autumn, 1 dead brown leaves, 2 bare; `hue` 0..1 (0.5 neutral). */
  add(kind: number, x: number, y: number, z: number, s: number, yaw: number, tint = 1, season = 0, hue = 0.5) {
    const i = this.n++;
    this.kind.push(kind);
    this.pos.push(x, y, z);
    this.scale.push(s);
    this.yaw.push(yaw);
    this.tint.push(tint);
    this.season.push(season + Math.min(0.999, Math.max(0, hue)));
    const k = keyOf(Math.floor(x / BK), Math.floor(z / BK));
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = []));
    b.push(i);
    return i;
  }
  get count() { return this.n; }
  /** The spot within R of (x, z) with the most trees within 20 m (debug, screenshots): [x, z, count]. */
  densest(x: number, z: number, R: number): number[] {
    let best = [x, z, 0];
    for (let gx = x - R; gx <= x + R; gx += 16) for (let gz = z - R; gz <= z + R; gz += 16) {
      let c = 0;
      for (let bi = Math.floor((gx - 20) / BK); bi <= Math.floor((gx + 20) / BK); bi++) for (let bj = Math.floor((gz - 20) / BK); bj <= Math.floor((gz + 20) / BK); bj++)
        for (const i of this.buckets.get(keyOf(bi, bj)) ?? NONE) if (Math.hypot(this.pos[i * 3] - gx, this.pos[i * 3 + 2] - gz) < 20) c++;
      if (c > best[2]) best = [gx, gz, c];
    }
    return best;
  }
  /** The nearest tree to (x, z) at least `minH` m tall: [x, y, z, height, trunk radius], or null (debug, screenshots). */
  nearest(x: number, z: number, minH = 0): number[] | null {
    let best: number[] | null = null, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const def = this.treeDef(this.kind[i]), h = def.h * this.scale[i];
      if (h < minH) continue;
      const d = Math.hypot(this.pos[i * 3] - x, this.pos[i * 3 + 2] - z);
      if (d < bd) { bd = d; best = [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], h, def.trunk * this.scale[i]]; }
    }
    return best;
  }
  treeDef(kind: number) { return this.pack.trees[this.kinds[kind].tree]; }

  /** Build the GPU side. Call once after planting. */
  commit(): THREE.Group {
    this.stats.trees = this.n;
    this.lod = new Uint8Array(this.n).fill(255);
    const p = this.pack;
    // Which pack meshes are used, and how big the batches must be.
    const usedBark = new Set<number>(), usedLeaf = new Set<number>();
    for (const k of this.kinds) for (const [b, l] of p.trees[k.tree].lods) { if (b >= 0) usedBark.add(b); if (l >= 0) usedLeaf.add(l); }
    const size = (set: Set<number>) => {
      let v = 0, i = 0;
      for (const m of set) { v += p.geos[m]!.attributes.position.count; i += p.geos[m]!.index!.count; }
      return [v, i];
    };
    const [bv, bi] = size(usedBark), [lv, li] = size(usedLeaf);
    this.bark = new THREE.BatchedMesh(this.poolSize, bv, bi, barkMaterial(p));
    this.leaf = new THREE.BatchedMesh(this.poolSize, Math.max(4, lv), Math.max(6, li), leafMaterial(p));
    for (const bm of [this.bark, this.leaf]) {
      bm.frustumCulled = false;
      bm.perObjectFrustumCulled = false; // culled here, per tree
      bm.sortObjects = true;
    }
    this.bark.name = 'trees-bark';
    this.leaf.name = 'trees-leaves';
    for (const m of usedBark) this.barkGeo[m] = this.bark.addGeometry(p.geos[m]!);
    for (const m of usedLeaf) this.leafGeo[m] = this.leaf.addGeometry(p.geos[m]!);
    const g0b = this.barkGeo[[...usedBark][0]], g0l = this.leafGeo[[...usedLeaf][0]];
    const white = new THREE.Color(1, 0, 1023);
    for (let i = 0; i < this.poolSize; i++) {
      const a = this.bark.addInstance(g0b);
      this.bark.setVisibleAt(a, false);
      this.bark.setColorAt(a, white);
      this.barkIds.push(a);
      if (usedLeaf.size) {
        const b = this.leaf.addInstance(g0l);
        this.leaf.setVisibleAt(b, false);
        this.leaf.setColorAt(b, white);
        this.leafIds.push(b);
      }
    }
    this.group.add(this.bark);
    if (usedLeaf.size) this.group.add(this.leaf);

    if (p.imp && p.tex.imp) {
      const q = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      q.deleteAttribute('uv');
      q.deleteAttribute('normal');
      this.impA = new THREE.InstancedBufferAttribute(new Float32Array(this.impPool * 4), 4);
      this.impT = new THREE.InstancedBufferAttribute(new Float32Array(this.impPool * 2), 2);
      this.impA.setUsage(THREE.DynamicDrawUsage);
      this.impT.setUsage(THREE.DynamicDrawUsage);
      q.setAttribute('aImp', this.impA);
      q.setAttribute('aImpT', this.impT);
      q.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      this.imp = new THREE.InstancedMesh(q, impostorMaterial(p), this.impPool);
      this.imp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.imp.count = 0;
      this.imp.frustumCulled = false;
      this.imp.name = 'trees-impostors';
      this.group.add(this.imp);
    }
    // An invisible helper that triggers the update each render; its draw range is negative, so
    // three calls onBeforeRender but issues no draw call.
    const tg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    tg.setDrawRange(0, -1); // a negative count: WebGLRenderer returns before binding or drawing anything
    const ticker = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    ticker.frustumCulled = false;
    ticker.onBeforeRender = (_r, _s, camera) => this.update(camera);
    this.group.add(ticker);
    return this.group;
  }

  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sv = new THREE.Vector3();
  private col = new THREE.Color();
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private sph = new THREE.Sphere();
  private up = new THREE.Vector3(0, 1, 0);
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private lastDir = new THREE.Vector3();

  /** Deal the trees near `camera` out to the batches and the impostors. */
  update(camera: THREE.Camera, force = false) {
    if (!this.bark) return;
    const cp = camera.position;
    const dir = camera.getWorldDirection(this.v);
    // Every third frame, or at once after a jump or a sharp turn.
    const moved = cp.distanceToSquared(this.lastCam) > 9 || dir.dot(this.lastDir) < 0.97;
    if (!force && !moved && this.frame++ % 3 !== 0) return;
    this.lastCam.copy(cp);
    this.lastDir.copy(dir);
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const W = vegUniforms.uFade.value, margin = W + 2;
    const p = this.pack;
    let nb = 0, nl = 0, ni = 0, tris = 0;
    const lodTris = this.stats.lodTris.fill(0);
    const maxD = this.maxFar + 4;
    const bx0 = Math.floor((cp.x - maxD) / BK), bx1 = Math.floor((cp.x + maxD) / BK), bz0 = Math.floor((cp.z - maxD) / BK), bz1 = Math.floor((cp.z + maxD) / BK);
    const impA = this.impA?.array as Float32Array | undefined, impT = this.impT?.array as Float32Array | undefined;
    const impM = this.imp?.instanceMatrix.array as Float32Array | undefined;
    for (let bi = bx0; bi <= bx1; bi++) for (let bj = bz0; bj <= bz1; bj++) {
      // whole bucket outside the range?
      const cx = Math.max(bi * BK, Math.min(cp.x, (bi + 1) * BK)), cz = Math.max(bj * BK, Math.min(cp.z, (bj + 1) * BK));
      if (Math.hypot(cx - cp.x, cz - cp.z) > maxD) continue;
      for (const i of this.buckets.get(keyOf(bi, bj)) ?? NONE) {
        const k = this.kinds[this.kind[i]], def = p.trees[k.tree];
        const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2], s = this.scale[i];
        const d = Math.hypot(x - cp.x, y - cp.y, z - cp.z);
        const far = k.far || k.ends[k.ends.length - 1];
        if (d > far + margin) continue;
        this.sph.center.set(x, y + def.h * s * 0.5, z);
        this.sph.radius = Math.max(def.h * 0.55, def.crown) * s + 1;
        if (!this.frustum.intersectsSphere(this.sph)) continue;
        this.q.setFromAxisAngle(this.up, this.yaw[i]);
        // Levels 0..nL-1 are the mesh LODs, nL the impostor. They switch
        // outright (the pack's LODs keep their silhouettes, and in this fog a
        // pop is gentler than a stippled cross-fade band without TAA).
        const im = p.imp?.trees[def.id];
        const hasImp = !!(k.far && im && impM);
        const nL = k.ends.length, last = k.ends[nL - 1];
        let l = 0;
        while (l < nL && d >= k.ends[l]) l++;
        if (l === nL && !hasImp) l = nL - 1; // no impostor: the last LOD melts into the fog at its end
        // A little hysteresis, so a head bob on a boundary does not flicker.
        const pl = this.lod[i];
        if (pl !== 255 && pl !== l && pl <= nL && Math.abs(d - k.ends[Math.min(pl, l)]) < 1) l = pl;
        this.lod[i] = l;
        if (l < nL) {
          const [bm, lm] = def.lods[l];
          const band = hasImp ? 1023 : Math.min(1023, Math.round(last));
          this.col.setRGB(this.tint[i], this.season[i], band);
          this.m4.compose(this.v.set(x, y, z), this.q, this.sv.setScalar(s));
          if (bm >= 0 && nb < this.poolSize) {
            const id = this.barkIds[nb++];
            this.bark.setGeometryIdAt(id, this.barkGeo[bm]);
            this.bark.setMatrixAt(id, this.m4);
            this.bark.setColorAt(id, this.col);
            this.bark.setVisibleAt(id, true);
            tris += p.geos[bm]!.index!.count / 3;
            lodTris[l] += p.geos[bm]!.index!.count / 3;
          }
          if (lm >= 0 && nl < this.poolSize) {
            const id = this.leafIds[nl++];
            this.leaf.setGeometryIdAt(id, this.leafGeo[lm]);
            this.leaf.setMatrixAt(id, this.m4);
            this.leaf.setColorAt(id, this.col);
            this.leaf.setVisibleAt(id, true);
            tris += p.geos[lm]!.index!.count / 3;
            lodTris[l] += p.geos[lm]!.index!.count / 3;
          }
        }
        // the impostor
        else if (hasImp && im && impM && impA && impT && ni < this.impPool) {
          const sw = im.w * s, sh = im.h * s;
          const o = ni * 16;
          impM.fill(0, o, o + 16);
          impM[o] = sw; impM[o + 5] = sh; impM[o + 10] = sw; impM[o + 15] = 1;
          impM[o + 12] = x; impM[o + 13] = y + im.y0 * s; impM[o + 14] = z;
          impA[ni * 4] = im.row; impA[ni * 4 + 1] = this.yaw[i]; impA[ni * 4 + 2] = last; impA[ni * 4 + 3] = k.far;
          impT[ni * 2] = this.tint[i]; impT[ni * 2 + 1] = this.season[i] - Math.floor(this.season[i]);
          ni++;
          tris += 2;
        }
      }
    }
    for (let j = nl; j < this.leafIds.length; j++) if (this.leaf.getVisibleAt(this.leafIds[j])) this.leaf.setVisibleAt(this.leafIds[j], false);
    for (let j = nb; j < this.barkIds.length; j++) if (this.bark.getVisibleAt(this.barkIds[j])) this.bark.setVisibleAt(this.barkIds[j], false);
    if (this.imp) {
      this.imp.count = ni;
      this.imp.visible = ni > 0; // no empty instanced draws
      this.imp.instanceMatrix.needsUpdate = true;
      this.impA!.needsUpdate = true;
      this.impT!.needsUpdate = true;
      if (ni > 0) {
        this.impA!.addUpdateRange(0, ni * 4);
        this.impT!.addUpdateRange(0, ni * 2);
        this.imp.instanceMatrix.addUpdateRange(0, ni * 16);
      }
    }
    this.bark.visible = nb > 0;
    this.leaf.visible = nl > 0;
    this.stats.meshes = Math.max(nb, nl);
    this.stats.impostors = ni;
    this.stats.tris = tris;
    this.stats.trees = this.n;
  }
}
