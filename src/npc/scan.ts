import * as THREE from 'three';
import { mixamoFrames, withAtmos } from './rig';
import { boneClassOf } from './garment';

// Scanned bodies (Renderpeople photogrammetry, packed by tools/fetch-people.ts).
//
// Each comes as one skinned mesh in modern clothes with a repacked skin atlas
// (albedo, normal, roughness) and a per-vertex `_skin` likeness. Here it is
// re-oriented to Mixamo's bone axes and split into the pieces the dressing
// code (garment.ts dressBody) knows: the upper body (trimmed to the skin of
// head, neck and hands), the legs (re-dressed as hose) and the feet (leather
// shoes). The skin itself gets its own shading, below.

export type Sex = 'man' | 'woman';

export function prepScanBody(root: THREE.Object3D) {
  mixamoFrames(root);
  const src: THREE.SkinnedMesh[] = [];
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) src.push(o as THREE.SkinnedMesh); });
  for (const m of src) {
    const cls = boneClassOf(m), idx = m.geometry.index!;
    const parts: Record<string, number[]> = { Scan_Top: [], Scan_Bottom: [], Scan_Footwear: [] };
    for (let t = 0; t < idx.count; t += 3) {
      const c = [cls[idx.getX(t)], cls[idx.getX(t + 1)], cls[idx.getX(t + 2)]];
      const k = c.every((x) => x === 'foot') ? 'Scan_Footwear' : c.every((x) => x === 'foot' || x === 'leg') ? 'Scan_Bottom' : 'Scan_Top';
      parts[k].push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
    }
    for (const [name, ix] of Object.entries(parts)) {
      const g = m.geometry.clone();
      g.setIndex(ix);
      const s = new THREE.SkinnedMesh(g, m.material);
      s.name = name;
      s.bind(m.skeleton, m.bindMatrix);
      s.position.copy(m.position); s.quaternion.copy(m.quaternion); s.scale.copy(m.scale);
      m.parent!.add(s);
    }
    m.parent!.remove(m);
  }
  root.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ skin shading

/**
 * Skin from the scan's maps, made to read as skin and not plastic or paint:
 *  - roughness from the packed map (0.6 on the cheeks, oilier T-zone, smoother lips, rough hair);
 *  - a tiling micro-normal (pores and fine creases) over the scan's own normal map;
 *  - subsurface scattering, cheaply: light wraps further round the terminator
 *    in red than in green and blue, so shadow edges on the face go warm and soft
 *    instead of grey and hard, and a little red is added to the ambient;
 *  - specular at skin's F0 (~0.028), dimmed in cavities by the albedo.
 * The tone (material colour) is set per person.
 */
export function skinMaterial(base: THREE.MeshStandardMaterial) {
  const m = new THREE.MeshStandardMaterial({
    map: base.map, normalMap: base.normalMap, roughnessMap: base.roughnessMap,
    roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1),
  });
  m.userData.skin = true;
  m.userData.scan = true;
  withAtmos(m, { skin: true, scan: true });
  // Living skin is not one colour: blotches of redness and sallowness a
  // centimetre or two across. And its creases (darker in the scan's albedo)
  // are occluded, not just painted: the sky's light and its sheen stay out
  // of them (albedo-derived cavity, multi-bounce AO after Jimenez et al.).
  const atmos = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    atmos.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        float skCav;
        {
          float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          vec3 blur = textureLod(map, vMapUv, 5.0).rgb;
          float lb = dot(blur, vec3(0.3, 0.59, 0.11));
          skCav = clamp(l / max(lb, 1e-3), 0.0, 1.0);
          float b1 = skinNoise(vMapUv * 90.0), b2 = skinNoise(vMapUv * 23.0 + 3.1);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.06, 0.95, 0.94), smoothstep(0.45, 0.8, b1) * 0.8);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.02, 1.01, 0.93), smoothstep(0.5, 0.85, b2) * 0.6);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float ao = skCav * skCav;
          vec3 al = diffuseColor.rgb;
          vec3 ka = 2.0404 * al - 0.3324, kb = -4.7951 * al + 0.6417, kc = 2.7552 * al + 0.6903;
          reflectedLight.indirectDiffuse *= max(vec3(ao), ((ao * ka + kb) * ao + kc) * ao);
          reflectedLight.indirectSpecular *= ao;
          reflectedLight.directSpecular *= mix(0.5, 1.0, ao);
        }`);
  };
  m.customProgramCacheKey = () => key + '-skin2';
  return m;
}
