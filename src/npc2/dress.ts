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
  if (outfit.id === 'monkBare') tonsure(body, outfit);
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
      // Hemp rope: its own photographed twist (the map), toned to unbleached fibre.
      mat = matte(0x8a7a5c, 0.95);
    }
    if (src.normalMap) { const k = (g as { nrm?: number }).nrm ?? 1; mat.normalMap = src.normalMap; mat.normalScale = new THREE.Vector2(k, k); }
    // The viking tunic's map is a mail shirt's: worn so by soldiers only.
    if (src.map && !(g.id === 'shirt' && dyes.role !== 'soldier')) {
      mat.map = src.map;
      src.map.colorSpace = g.map === 'detail' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      if (g.map === 'detail') detailMap(mat);
    }
    inside(mat);
    // Hood and cowl: closed shells wound outwards (tools/npc2/derive.py), drawn one-sided.
    if (g.id === 'hood' || g.id === 'cowl') { mat.side = THREE.FrontSide; lining(mat, m.geometry); }
    m.material = mat;
  });
  return new ClothingV2(meshes);
}

/**
 * The cloth's inner face (seen up a hem or a sleeve, the material being
 * two-sided) is the same cloth in its own shadow: darkened and without the
 * sheen, not a bright lining. (The usual cloth-shading treatment: an
 * occlusion term for back faces, e.g. Unreal's two-sided foliage/cloth.)
 */
function inside(m: THREE.MeshStandardMaterial) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      if (!gl_FrontFacing) outgoingLight *= 0.6;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => key + '-in';
}

/**
 * A hood's lining (the shell's faces that look in at the head, seen round
 * the face): in its own shadow and without sheen — dark and matte, so the
 * opening reads as a soft fold of wool, not a glossy crumpled strip. Told
 * from the outer face in the bind pose: the rest normal against the
 * direction from the head's middle.
 */
function lining(m: THREE.MeshStandardMaterial, g: THREE.BufferGeometry) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  // The skull's middle, from the hood itself: 12 cm under its crown, midway across.
  const b = new THREE.Box3().setFromBufferAttribute(g.attributes.rest as THREE.BufferAttribute);
  const u = { value: new THREE.Vector4((b.min.x + b.max.x) / 2, b.max.y - 0.12, (b.min.z + b.max.z) / 2, b.max.z) };
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uHeadC = u;
    // The lining, and the folded rim round the face (the front 6 cm of the
    // hood, +z being forward): light taken down after shading, sheen and all.
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 uHeadC; varying float vLin;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLin = max(smoothstep(0.05, -0.35, dot(normalize(restN), normalize(rest - uHeadC.xyz))),
                   0.8 * smoothstep(uHeadC.w - 0.08, uHeadC.w - 0.02, rest.z));`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLin;')
      .replace('#include <opaque_fragment>', 'outgoingLight *= 1.0 - 0.7 * vLin;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => key + '-lining';
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

/**
 * A monk's tonsure (the Roman, St Peter's): the crown shaven in a round,
 * painted on the head's skin in the shader — a disc about the top of the
 * skull, in the bind pose, in the tone of the forehead's skin.
 */
function tonsure(body: THREE.Object3D, o: OutfitV2) {
  // (The MakeHuman rig has no eye bones: the crown from the head's measured box.)
  const h = o.m.head;
  const u = { value: new THREE.Vector4(h.c.x, h.top - 0.045, h.c.z - 0.012, 0.055) };
  body.traverse((x) => {
    const m = x as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || x.userData.npc2 !== 'body') return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    m.material = mats.map((mat) => {
      const c = mat.clone();
      const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey();
      c.onBeforeCompile = (sh, r) => {
        prev.call(c, sh, r);
        sh.uniforms.uTons = u;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTons;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTons = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTons; uniform vec4 uTons;').replace('#include <map_fragment>', `#include <map_fragment>
          {
            float td = length(vTons.xz - uTons.xz);
            float tk = smoothstep(uTons.w, uTons.w - 0.012, td) * smoothstep(uTons.y - 0.01, uTons.y + 0.01, vTons.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.19, 0.15) * diffuse * (0.92 + 0.08 * fract(sin(dot(vTons.xz, vec2(127.1, 311.7)) * 9.0) * 43758.5)), tk);
          }`);
      };
      c.customProgramCacheKey = () => key + '-tonsure';
      return c;
    });
    if (!Array.isArray(m.material) || m.material.length === 1) m.material = (m.material as THREE.Material[])[0];
  });
}
