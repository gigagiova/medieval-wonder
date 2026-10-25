import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadGltf } from './gltf';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Builder } from './builder';
import { field, SITE, fastTerrain } from './displace';
import { placeWorld } from './builder';
import { shared } from './materials';
import { noiseGLSL, atmosGLSL } from './shaders';

// Photo-scanned CC0 props from Poly Haven (see tools/fetch-props.ts and
// public/models/props/CREDITS.md). Load them once with loadProps(), place them
// anywhere with placeProp(), then commitProps(scene) turns the placements into
// instanced meshes, chunked in space so they can be culled by distance.

export const PROP_IDS = [
  'wine_barrel_01', 'wooden_barrels_01', 'wicker_basket_02', 'wooden_bowl_01', 'carved_wooden_plate',
  'ceramic_pot', 'planter_pot_clay', 'wooden_bucket_01', 'wooden_bucket_02', 'folding_wooden_stool',
  'WoodenTable_01', 'treasure_chest', 'stone_fire_pit', 'wooden_axe', 'wooden_axe_02', 'cross_pein_hammer',
  'wooden_cutting_board', 'marble_bust_01', 'street_rat',
  'rock_moss_set_01', 'rock_moss_set_02',
  'tree_stump_01', 'tree_stump_02', 'dead_tree_trunk', 'dead_tree_trunk_02', 'root_cluster_01',
  'root_cluster_02', 'pine_roots', 'bark_debris_01', 'dry_branches_medium_01', 'nettle_plant', 'fern_02',
  'grass_medium_02', 'shrub_02', 'weed_plant_02',
] as const;
export type PropId = (typeof PROP_IDS)[number];
export const ALL_PROP_IDS: readonly PropId[] = PROP_IDS;

/** How far each kind stays visible (m): small things vanish into the fog early. */
const RANGE: Partial<Record<PropId, number>> = {
  rock_moss_set_01: 70, rock_moss_set_02: 70,
  tree_stump_01: 90, tree_stump_02: 90, dead_tree_trunk: 100, dead_tree_trunk_02: 100,
  root_cluster_01: 70, root_cluster_02: 70, pine_roots: 70,
  nettle_plant: 32, fern_02: 32, grass_medium_02: 28, shrub_02: 36, weed_plant_02: 28,
  bark_debris_01: 30, dry_branches_medium_01: 40, street_rat: 25,
};
const DEFAULT_RANGE = 45;

/** One piece of a model, with transforms baked in: base centred in x/z, resting on y = 0. */
interface Part { geometry: THREE.BufferGeometry; material: THREE.Material }
interface Variant { parts: Part[]; box: THREE.Box3 }
const variants = new Map<PropId, Variant[]>();

/** Models made of several separate objects (rock sets, plant sets) give one variant per object. */
const SETS: Partial<Record<PropId, true>> = {
  wooden_barrels_01: true, rock_moss_set_01: true, rock_moss_set_02: true, root_cluster_02: true,
  bark_debris_01: true, dry_branches_medium_01: true, nettle_plant: true, fern_02: true,
  shrub_02: true, weed_plant_02: true, wicker_basket_02: true,
};

const fogged = new WeakSet<THREE.Material>();
function fog(m: THREE.Material) {
  if (fogged.has(m)) return m;
  fogged.add(m);
  const sm = m as THREE.MeshStandardMaterial;
  // Scans are lit by dusk and lamps only: keep them matte.
  if ('roughness' in sm) sm.envMapIntensity = 0;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosF;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWPosF = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWPosF = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPosF;\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.45;
        reflectedLight.indirectSpecular *= 0.45;`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPosF);');
  };
  m.customProgramCacheKey = () => 'prop-fog';
  return m;
}

function bake(root: THREE.Object3D, rootInv: THREE.Matrix4): Variant {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'tangent'].includes(k)) g.deleteAttribute(k);
    g.deleteAttribute('tangent');
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld));
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const m = fog(mats[0]);
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m)!.push(g.index ? g : g);
  });
  const parts: Part[] = [];
  const box = new THREE.Box3();
  for (const [material, geos] of byMat) {
    const allIdx = geos.every((g) => g.index), noIdx = geos.every((g) => !g.index);
    const list = allIdx || noIdx ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const geometry = list.length === 1 ? list[0] : mergeGeometries(list, false)!;
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox!);
    parts.push({ geometry, material });
  }
  // Base centred in x/z, resting on y = 0.
  const c = box.getCenter(new THREE.Vector3());
  const shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
  for (const p of parts) { p.geometry.applyMatrix4(shift); p.geometry.computeBoundingSphere(); }
  box.applyMatrix4(shift);
  return { parts, box };
}

let loading: Promise<void> | null = null;
/** Load (once) the given props from models/props/<id>.json. */
export function loadProps(ids: readonly PropId[] = PROP_IDS): Promise<void> {
  const loader = new GLTFLoader();
  const todo = ids.filter((id) => !variants.has(id));
  const p = Promise.all(todo.map(async (id) => {
    try {
      const gltf = await loadGltf(`models/props/${id}.json`, loader);
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const list: Variant[] = [];
      // Find the level where a set splits into separate objects.
      let level: THREE.Object3D = scene;
      while (level.children.length === 1 && !(level.children[0] as THREE.Mesh).isMesh) level = level.children[0];
      if (SETS[id] && level.children.length > 1) {
        for (const ch of level.children) {
          const inv = new THREE.Matrix4().copy(ch.matrixWorld).invert();
          // Keep the object's own rotation and scale, drop only its placement in the set.
          const pos = new THREE.Vector3().setFromMatrixPosition(ch.matrixWorld);
          inv.identity().makeTranslation(-pos.x, -pos.y, -pos.z);
          list.push(bake(ch, inv));
        }
      } else {
        list.push(bake(scene, new THREE.Matrix4()));
      }
      variants.set(id, list.filter((v) => v.parts.length));
    } catch (e) {
      console.warn('prop failed to load', id, e);
      variants.set(id, []);
    }
  })).then(() => {});
  loading = loading ? loading.then(() => p) : p;
  return p;
}
export const propsLoaded = (id: PropId) => (variants.get(id)?.length ?? 0) > 0;
export const propVariants = (id: PropId) => variants.get(id)?.length ?? 0;
/** Size of a prop variant at scale 1 (after centring): width (x), height (y), depth (z). */
export function propSize(id: PropId, variant = 0) {
  const v = variants.get(id)?.[variant % Math.max(1, variants.get(id)?.length ?? 1)];
  return v ? v.box.getSize(new THREE.Vector3()) : new THREE.Vector3();
}

export interface PlaceOpts {
  /** Add a cheap box collider for this prop to the builder. */
  collide?: Builder;
  /** Lean, radians about x and z (after the yaw). */
  tilt?: [number, number];
  /** Variant of a set (default: picked from the position). */
  variant?: number;
  /** Do not follow the world's displacement field (already on bent geometry). */
  raw?: boolean;
  /** Scale per axis, multiplied with `scale`. */
  stretch?: [number, number, number];
}

interface Placement { id: PropId; variant: number; matrix: THREE.Matrix4; under: boolean }
const pending: Placement[] = [];
const fv = new THREE.Vector3();
const q = new THREE.Quaternion(), e = new THREE.Euler();

/**
 * Place a prop with its base at (x, y, z) (y = 0 is the street level before
 * the world's displacement; the prop follows the bent ground like everything
 * else). Returns the world position used, or null if the prop isn't loaded.
 */
export function placeProp(_scene: THREE.Scene | null, id: PropId, x: number, y: number, z: number, ry = 0, scale = 1, opts: PlaceOpts = {}): THREE.Vector3 | null {
  const list = variants.get(id);
  if (!list || !list.length) return null;
  const vi = (opts.variant ?? Math.abs(Math.floor(x * 7.31 + z * 3.17))) % list.length;
  const p = new THREE.Vector3(x, y, z);
  // Follow the same bend as the ground (and as walls near it) at this point.
  if (!opts.raw) { field(x, y, z, y < 0.5 && y > -0.5 ? 'ground' : 'stone', fv); p.add(fv); }
  // From the site's frame (if any) to the world, onto the terrain.
  const under = y < -2.5;
  placeWorld(p);
  e.set(opts.tilt?.[0] ?? 0, ry + (SITE.on ? SITE.rot : 0), opts.tilt?.[1] ?? 0, 'YXZ');
  q.setFromEuler(e);
  const s = new THREE.Vector3(scale, scale, scale);
  if (opts.stretch) s.multiply(new THREE.Vector3(...opts.stretch));
  const matrix = new THREE.Matrix4().compose(p, q, s);
  pending.push({ id, variant: vi, matrix, under });
  if (opts.collide) {
    const box = list[vi].box;
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const g = new THREE.BoxGeometry(size.x * 0.9, size.y, size.z * 0.9).translate(c.x, c.y, c.z).applyMatrix4(matrix).toNonIndexed();
    opts.collide.collideWorld(g);
  }
  return p;
}

interface Chunk { center: THREE.Vector3; range: number; meshes: THREE.InstancedMesh[]; under: boolean }
const chunks: Chunk[] = [];
const CHUNK = 40;
let ticker: THREE.Object3D | null = null;

/** Turn all pending placements into instanced meshes, chunked for culling. */
export function commitProps(scene: THREE.Object3D) {
  // Placements are in world space: add to the root, not to a site's group.
  while (scene.parent) scene = scene.parent;
  const groups = new Map<string, Placement[]>();
  for (const pl of pending) {
    const pos = new THREE.Vector3().setFromMatrixPosition(pl.matrix);
    const key = `${pl.id}|${pl.variant}|${Math.floor(pos.x / CHUNK)}|${Math.floor(pos.z / CHUNK)}|${pl.under ? 'u' : 'a'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pl);
  }
  pending.length = 0;
  for (const [, list] of groups) {
    const { id, variant } = list[0];
    const v = variants.get(id)![variant];
    const center = new THREE.Vector3();
    for (const pl of list) center.add(new THREE.Vector3().setFromMatrixPosition(pl.matrix));
    center.divideScalar(list.length);
    const chunk: Chunk = { center, range: (RANGE[id] ?? DEFAULT_RANGE) + CHUNK * 0.6, meshes: [], under: list[0].under };
    for (const part of v.parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((pl, i) => im.setMatrixAt(i, pl.matrix));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.computeBoundingBox();
      im.receiveShadow = true;
      scene.add(im);
      chunk.meshes.push(im);
    }
    chunks.push(chunk);
  }
  if (!ticker) {
    // A tiny invisible mesh whose onBeforeRender culls the chunks by distance
    // from whichever camera renders the scene.
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    ticker = new THREE.Mesh(empty, new THREE.MeshBasicMaterial());
    ticker.frustumCulled = false;
    let n = 0;
    ticker.onBeforeRender = (_r, _s, camera) => {
      if (n++ % 4) return;
      const cp = camera.getWorldPosition(tmp);
      const under = cp.y - fastTerrain(cp.x, cp.z) < -2.4;
      for (const c of chunks) {
        const vis = c.center.distanceTo(cp) < c.range && c.under === under || c.center.distanceTo(cp) < 6;
        for (const m of c.meshes) m.visible = vis;
      }
    };
    scene.add(ticker);
  }
}
const tmp = new THREE.Vector3();

/** Is there room for a prop here? (cheap rejection helper for scatterers) */
export function rand01(seed: number) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Street clutter at the given spots (x, z, facing yaw): barrels, baskets,
 * jars, buckets, a stool, the odd rat. Spots should be against a wall.
 */
export function scatterStreetProps(b: Builder, scene: THREE.Scene, spots: { x: number; z: number; ry: number }[]) {
  spots.forEach((s, i) => {
    const r = rand01(i * 3.7 + s.x);
    const r2 = rand01(i * 9.1 + s.z);
    if (r < 0.25) {
      placeProp(scene, 'wine_barrel_01', s.x, 0, s.z, s.ry + r2 * 6, 0.85 + r2 * 0.2, { collide: b });
      if (r2 < 0.5) placeProp(scene, 'wine_barrel_01', s.x + Math.cos(s.ry) * 0.75, 0, s.z - Math.sin(s.ry) * 0.75, r * 9, 0.8, { collide: b });
    } else if (r < 0.45) {
      placeProp(scene, r2 < 0.5 ? 'planter_pot_clay' : 'ceramic_pot', s.x, 0, s.z, r2 * 6, 1.4 + r2 * 0.5, { collide: b });
    } else if (r < 0.6) {
      placeProp(scene, 'wicker_basket_02', s.x, 0, s.z, r2 * 6, 1.0, { collide: b });
    } else if (r < 0.75) {
      placeProp(scene, r2 < 0.5 ? 'wooden_bucket_01' : 'wooden_bucket_02', s.x, 0, s.z, r2 * 6, 1.0, { collide: b });
    } else if (r < 0.85) {
      placeProp(scene, 'folding_wooden_stool', s.x, 0, s.z, s.ry + r2, 1.0, { collide: b });
    } else if (r < 0.92) {
      placeProp(scene, 'wooden_barrels_01', s.x, 0, s.z, r2 * 6, 1.0, { variant: Math.floor(r2 * 10) });
    } else {
      placeProp(scene, 'street_rat', s.x, 0, s.z, r2 * 6, 1.0);
    }
  });
  commitProps(scene);
}
