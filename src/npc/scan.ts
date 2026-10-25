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
  return withAtmos(m, { skin: true, scan: true });
}
