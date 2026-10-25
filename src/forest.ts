import * as THREE from 'three';
import { Builder, rng } from './builder';
import { field, fastTerrain } from './displace';
import { placeProp, commitProps, propsLoaded, type PropId } from './props';
import { riverAt } from './benevento/geo';
import { loadTreePack, treePack } from './vegetation/pack';
import { TreeField } from './vegetation/field';

// The wood around the town, late in the year: old deciduous oaks (Turkey and
// downy oaks, some still holding their dead brown leaves, some nearly bare),
// younger oaks under them, an ancient pollard here and there, twisted dead
// trees and snags; poplars along the Sabato and the Calore. The trees are
// professional models (see public/models/trees/CREDITS.md) drawn through
// vegetation/field.ts: batched meshes with LODs near the eye, baked impostors
// further out, the fog over everything. Under them: scanned ground cover.

/** Start loading the trees (call before buildForest, alongside loadProps). */
export const loadForest = () => loadTreePack().then(() => undefined);

export const treeSpots: THREE.Vector2[] = [];

/**
 * Plant the wood outside the walls. `inside(x,z)` is true within the town;
 * `keepOut(x,z)` marks clearings (gate, roads, bridges, sites).
 * The returned object updates its own LOD/culling every few frames.
 */
export interface ForestOpts {
  inside: (x: number, z: number) => boolean;
  keepOut: (x: number, z: number) => boolean;
  /** How wooded the land is here (0 open fields .. 1 thick wood). */
  density?: (x: number, z: number) => number;
  bounds?: { x0: number; z0: number; x1: number; z1: number };
  /** Where scanned ground cover is worth placing (near where people walk). */
  cover?: (x: number, z: number) => boolean;
}

interface Sp {
  ids: string[];
  ends: number[];
  far: number;
  scale: [number, number];
  /** Clear radius (m at scale 1) kept free of other trunks. */
  room: number;
  /** Leafy (season applies) or bare wood only. */
  leafy: boolean;
}
const SPECIES: Record<string, Sp> = {
  // Big old oaks: crowns 25-30 m across at full size, so scaled down a little.
  large: { ids: ['oakL1', 'oakL2', 'oakL3'], ends: [8, 18, 42], far: 125, scale: [0.6, 0.78], room: 6.5, leafy: true },
  big: { ids: ['oakB1', 'oakB3', 'oakB4'], ends: [6, 14, 22, 40], far: 120, scale: [0.72, 0.95], room: 5, leafy: true },
  medium: { ids: ['oakM1', 'oakM2', 'oakM3'], ends: [6, 16, 38], far: 95, scale: [0.9, 1.3], room: 2.6, leafy: true },
  small: { ids: ['oakS1', 'oakS2'], ends: [8, 30], far: 0, scale: [0.75, 1.3], room: 1.6, leafy: true },
  ancient: { ids: ['ancient'], ends: [9, 22, 40], far: 100, scale: [0.95, 1.25], room: 6, leafy: false },
  twisted: { ids: ['twisted'], ends: [8, 18, 38], far: 95, scale: [0.85, 1.2], room: 3.2, leafy: false },
  snag: { ids: ['snag'], ends: [8, 18, 38], far: 95, scale: [0.75, 1.1], room: 2.4, leafy: false },
  poplar: { ids: ['poplar'], ends: [5, 10, 22, 40], far: 120, scale: [0.8, 1.15], room: 4.5, leafy: true },
};

export function buildForest(scene: THREE.Scene, b: Builder, o: ForestOpts): THREE.Object3D {
  const opts = {
    density: (x: number, z: number) => (Math.hypot(x, z) < 225 ? 1 : 0),
    bounds: { x0: -225, z0: -225, x1: 225, z1: 225 },
    cover: (x: number, z: number) => Math.hypot(x, z) < 150,
    ...o,
  };
  const group = new THREE.Group();
  group.name = 'forest';
  const pack = treePack();
  if (!pack) {
    console.warn('forest: the tree pack is not loaded (call loadForest() first); no trees');
    group.userData.stats = () => ({ trees: 0 });
    scene.add(group);
    return group;
  }
  const rand = rng(90210);
  const R = (a: number, b2: number) => a + (b2 - a) * rand();
  const gv = new THREE.Vector3();
  const groundAt = (x: number, z: number) => field(x, 0, z, 'ground', gv).y + fastTerrain(x, z);

  const trees = new TreeField(pack);
  const kinds: Record<string, number[]> = {};
  for (const [name, sp] of Object.entries(SPECIES)) {
    kinds[name] = sp.ids.filter((id) => pack.byId.has(id)).map((id) => trees.addKind({ tree: pack.byId.get(id)!, ends: sp.ends, far: sp.far }));
  }

  // Trunks already planted, on a 16 m hash, for spacing.
  const HB = 16;
  const planted = new Map<number, number[]>(); // x, z, room
  const hk = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  const roomy = (x: number, z: number, r: number) => {
    const i0 = Math.floor((x - r - 8) / HB), i1 = Math.floor((x + r + 8) / HB), j0 = Math.floor((z - r - 8) / HB), j1 = Math.floor((z + r + 8) / HB);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = planted.get(hk(i, j));
      if (!l) continue;
      for (let k = 0; k < l.length; k += 3) if (Math.hypot(l[k] - x, l[k + 1] - z) < Math.max(r, l[k + 2]) * 0.85) return false;
    }
    return true;
  };
  const mark = (x: number, z: number, r: number) => {
    const key = hk(Math.floor(x / HB), Math.floor(z / HB));
    let l = planted.get(key);
    if (!l) planted.set(key, (l = []));
    l.push(x, z, r);
  };

  // Scanned ground cover (Poly Haven), when loaded.
  const scan = (id: PropId, x: number, z: number, s: number, ry: number, sink: number) =>
    propsLoaded(id) && placeProp(null, id, x, sink * s, z, ry, s, { tilt: [R(-0.08, 0.08), R(-0.08, 0.08)] }) !== null;

  // Collision: a four-sided prism round the foot of each sizeable trunk.
  const colPos: number[] = [];
  const prism = (x: number, z: number, r: number) => {
    if (r < 0.15) return;
    const y0 = groundAt(x, z) - 0.5, y1 = y0 + 3.5;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2, a1 = ((i + 1) / 4) * Math.PI * 2;
      const x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
      colPos.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0);
    }
  };

  const nearWall = (x: number, z: number, d: number) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (opts.inside(x + Math.cos(a) * d, z + Math.sin(a) * d)) return true;
    }
    return false;
  };
  /** Room for a crown of radius r: no road, bridge or clearing under most of it. */
  const crownFree = (x: number, z: number, r: number) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      if (opts.keepOut(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  };

  const plant = (name: string, x: number, z: number, near: boolean) => {
    const sp = SPECIES[name], list = kinds[name];
    if (!list.length) return false;
    const k = list[Math.floor(rand() * list.length)];
    const s = R(sp.scale[0], sp.scale[1]);
    const def = trees.treeDef(k);
    const room = sp.room * s;
    if (!roomy(x, z, room)) return false;
    if (def.crown * s > 5 && (!crownFree(x, z, Math.min(def.crown * s * 0.45, 6)) || nearWall(x, z, 12))) return false;
    if (near && def.h * s > 9) return false;
    const y = groundAt(x, z) - 0.12 - 0.04 * def.trunk * s;
    // Late in the year: most oaks keep a few last leaves, many hold dead brown ones (downy oak), some are bare.
    const u = rand();
    const season = sp.leafy ? (name === 'poplar' ? 0 : u < 0.5 ? 0 : u < 0.82 ? 1 : 2) : 0;
    trees.add(k, x, y, z, s, R(0, Math.PI * 2), R(0.78, 1.08), season, R(0.2, 0.8));
    mark(x, z, room);
    prism(x, z, def.trunk * s * 1.05);
    if (name === 'large' || name === 'ancient') treeSpots.push(new THREE.Vector2(x, z));
    return true;
  };

  // Ground cover draws from its own sequence, so the trees stay where they were.
  const gr = rng(4711);
  const GR = (a: number, b2: number) => a + (b2 - a) * gr();
  const STEP = 3.7, B = opts.bounds;
  for (let gz = B.z0; gz <= B.z1; gz += STEP) for (let gx = B.x0; gx <= B.x1; gx += STEP) {
    const x = gx + R(-0.48, 0.48) * STEP, z = gz + R(-0.48, 0.48) * STEP;
    const wd = opts.density(x, z);
    if (wd <= 0.02 || rand() > wd) continue;
    if (opts.inside(x, z) || opts.keepOut(x, z)) continue;
    const wallNear = nearWall(x, z, 7);
    if (wallNear && rand() < 0.93) continue;
    const coverHere = opts.cover(x, z);
    // Ground cover (scans) where people walk: ferns, nettles, weeds, fallen
    // branches, bark, mossy stones; the fog hides how far it goes.
    if (coverHere) for (let g = 0; g < 3; g++) {
      if (gr() > 0.8) continue;
      const gx2 = x + GR(-1.8, 1.8), gz2 = z + GR(-1.8, 1.8);
      if (opts.inside(gx2, gz2) || opts.keepOut(gx2, gz2)) continue;
      const u = gr();
      if (u < 0.22) scan('fern_02', gx2, gz2, GR(1.0, 1.6), GR(0, 6.28), 0);
      else if (u < 0.4) scan('nettle_plant', gx2, gz2, GR(3.5, 6), GR(0, 6.28), 0);
      else if (u < 0.55) scan('weed_plant_02', gx2, gz2, GR(3, 5), GR(0, 6.28), 0);
      else if (u < 0.68) scan('dry_branches_medium_01', gx2, gz2, GR(1.2, 2.2), GR(0, 6.28), 0);
      else if (u < 0.78) scan('bark_debris_01', gx2, gz2, GR(1.5, 3), GR(0, 6.28), 0);
      else if (u < 0.88) scan('rock_moss_set_02', gx2, gz2, GR(0.3, 0.8), GR(0, 6.28), -0.05);
      else if (u < 0.95) scan('grass_medium_02', gx2, gz2, GR(0.7, 1.1), GR(0, 6.28), 0);
      else scan('shrub_02', gx2, gz2, GR(0.5, 0.9), GR(0, 6.28), 0);
    }
    let dens = 0.75;
    if (nearWall(x, z, 14)) dens = 0.3;
    // Groves and glades: a slow noise modulates the density.
    dens *= 0.55 + 0.75 * (0.5 + 0.5 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 - 0.7));
    if (rand() > dens) {
      // Undergrowth and deadwood in the gaps.
      const u = rand();
      if (u < 0.22) scan((['shrub_02', 'nettle_plant', 'weed_plant_02'] as PropId[])[Math.floor(rand() * 3)], x, z, R(0.7, 1.2) * (rand() < 0.5 ? 1 : 3), R(0, 6.28), 0);
      else if (u < 0.28) scan(rand() < 0.5 ? 'dead_tree_trunk' : 'dead_tree_trunk_02', x, z, R(1.0, 1.6), R(0, 6.28), -0.08);
      else if (u < 0.33) { if (scan(rand() < 0.5 ? 'tree_stump_01' : 'tree_stump_02', x, z, R(0.7, 1.15), R(0, 6.28), -0.06)) prism(x, z, 0.5); }
      else if (u < 0.39) scan(rand() < 0.5 ? 'rock_moss_set_01' : 'rock_moss_set_02', x, z, R(0.7, 1.5), R(0, 6.28), -0.1);
      else if (u < 0.47) scan((['fern_02', 'dry_branches_medium_01', 'bark_debris_01', 'root_cluster_02'] as PropId[])[Math.floor(rand() * 4)], x, z, R(0.8, 1.6), R(0, 6.28), 0);
      continue;
    }
    // Which tree: poplars on the river banks, oaks of all ages elsewhere,
    // the dead and the ancient among them. Too little room: try smaller.
    const rv = riverAt(x, z, 40);
    const bank = rv ? rv.d - rv.w / 2 : 99;
    const u = rand();
    let order: string[];
    if (bank < 22 && u < 0.55) order = ['poplar', 'medium', 'small'];
    else if (u < 0.1) order = ['large', 'big', 'medium', 'small'];
    else if (u < 0.27) order = ['big', 'medium', 'small'];
    else if (u < 0.31) order = ['ancient', 'big', 'medium', 'small'];
    else if (u < 0.37) order = ['twisted', 'small'];
    else if (u < 0.46) order = ['snag', 'small'];
    else if (u < 0.72) order = ['medium', 'small'];
    else order = ['small'];
    for (const name of order) if (plant(name, x, z, wallNear)) break;
  }

  commitProps(scene);
  if (colPos.length) {
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(colPos, 3));
    b.collideWorld(cg);
    colPos.length = 0;
  }
  group.add(trees.commit());
  group.userData.update = (camera: THREE.Camera) => trees.update(camera, true);
  group.userData.trees = trees;
  group.userData.stats = () => ({ ...trees.stats });
  Object.assign(window, { __veg: () => ({ ...trees.stats }), __vegNearest: (x: number, z: number, minH = 0) => trees.nearest(x, z, minH), __vegDensest: (x: number, z: number, r: number) => trees.densest(x, z, r) });
  scene.add(group);
  return group;
}
