import * as THREE from 'three';
import { fabric, type FabricKind } from '../npc/fabric';
import { matte } from '../npc/rig';
import type { OutfitV2 } from './kit';

// Dyeing a v2 person's garments: each garment gets the scanned cloth of its
// kind (src/npc/fabric.ts: weave at true size, laid in the bind pose) in the
// dye of its layer, over its own modelled detail (the artist's normal map,
// with seams and folds, and a grey map of the cloth's wear), mud at the hems.

export interface Dyes { tunic: THREE.Color; over: THREE.Color; head: THREE.Color; belt: THREE.Material; leg: THREE.Color; shoe: THREE.Color; kinds?: [FabricKind, FabricKind, FabricKind]; role?: string }

/** Stands in for v1's Clothing (cloth.ts): v2 garments are plainly skinned. */
export class ClothingV2 {
  simulating = false;
  constructor(private meshes: THREE.Object3D[]) {}
  set visible(v: boolean) { for (const m of this.meshes) m.visible = v; }
  setSimulating(_on: boolean) { /* no cloth simulation in v2 */ }
  update(_dt: number, _at: THREE.Vector3) { /* skinned only */ }
  dispose() { /* geometry and textures are shared by the template */ }
}

const KIND: Record<string, FabricKind> = { tabby: 'tabby', twill: 'twill', felt: 'felt', linen: 'linen', leather: 'leather' };

/** Dye every garment of a person (their cloned body), by layer. */
export function dressV2(body: THREE.Object3D, outfit: OutfitV2, dyes: Dyes) {
  const meshes: THREE.Object3D[] = [];
  const kinds = new Map(outfit.garments.map((g) => [g.id, g]));
  body.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || o.userData.npc2 !== 'garment') return;
    const g = kinds.get(o.userData.garment as string);
    if (!g) return;
    meshes.push(m);
    const src = m.material as THREE.MeshStandardMaterial;
    const col = g.layer === 'tunic' ? dyes.tunic : g.layer === 'over' ? dyes.over : g.layer === 'head' ? dyes.head : g.layer === 'leg' ? dyes.leg : g.layer === 'shoe' || g.layer === 'belt' ? dyes.shoe : dyes.tunic;
    if (g.layer === 'belt' && g.map !== 'color') { m.material = dyes.belt; return; }
    let mat: THREE.MeshStandardMaterial;
    // A persona's own cloth for tunic, overgarment and headcloth (src/npc/population.ts).
    const kind = (dyes.kinds && { tunic: dyes.kinds[0], over: dyes.kinds[1], head: dyes.kinds[2] }[g.layer]) || KIND[g.fabric];
    if (kind) {
      mat = fabric(kind, g.map === 'color' ? col.clone().lerp(new THREE.Color(1, 1, 1), 0.55) : col, { attr: 'rest', vertexColors: true });
    } else {
      mat = matte(0xffffff, 0.95);
    }
    if (src.normalMap) { mat.normalMap = src.normalMap; mat.normalScale = new THREE.Vector2(1, 1); }
    // The viking tunic's map is a mail shirt's: worn so by soldiers only.
    if (src.map && !(g.id === 'shirt' && dyes.role !== 'soldier')) {
      mat.map = src.map;
      src.map.colorSpace = g.map === 'detail' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      if (g.map === 'detail') detailMap(mat);
    }
    m.material = mat;
  });
  return new ClothingV2(meshes);
}

/** The map is a grey detail (mean 0.5): the dye times twice it. */
function detailMap(m: THREE.MeshStandardMaterial) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        diffuseColor.rgb *= clamp(texture2D(map, vMapUv).r * 2.0, 0.0, 1.6);
      #endif`);
  };
  m.customProgramCacheKey = () => key + '-detail';
}
