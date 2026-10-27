import type * as THREE from 'three';

/** Drive authored eyelid shapes; never move or scale the eye/face mesh. */
export function makeBlink(root: THREE.Object3D, random: () => number) {
  const lids: { values: number[]; indices: number[] }[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const dictionary = mesh.morphTargetDictionary;
    if (!dictionary || !mesh.morphTargetInfluences) return;
    const indices = ['BlinkLeft', 'BlinkRight'].map((name) => dictionary[name]).filter((i) => i !== undefined);
    if (indices.length) lids.push({ values: mesh.morphTargetInfluences, indices });
  });
  if (!lids.length) return null;
  let remaining = 1 + random() * 4;
  let elapsed = -1;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  return (dt: number) => {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    // Resume with open eyes after a suspended tab, rather than replaying blinks.
    if (dt > 1) { elapsed = -1; remaining = 1 + random() * 4; }
    else if (elapsed < 0) {
      remaining -= dt;
      if (remaining <= 0) elapsed = -remaining;
    } else elapsed += dt;
    // Fast closure, brief contact, slower reopening; independent of frame rate.
    let closure = 0;
    if (elapsed >= 0 && elapsed < 0.08) closure = smooth(elapsed / 0.08);
    else if (elapsed >= 0.08 && elapsed < 0.11) closure = 1;
    else if (elapsed >= 0.11 && elapsed < 0.25) closure = 1 - smooth((elapsed - 0.11) / 0.14);
    else if (elapsed >= 0.25) { elapsed = -1; remaining = 3 + random() * 4; }
    for (const lid of lids) for (const index of lid.indices) lid.values[index] = closure;
  };
}
