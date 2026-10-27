import * as THREE from 'three';

/** Small free-arm corrections against the actually worn long garment.
 * Sampled skinning keeps the envelope responsive to thigh motion. Contact IK
 * must run afterwards. This does not rotate the clavicle or impose a grip.
 */
export function makeGarmentClearance(body: THREE.Object3D, bones: Map<string, THREE.Bone>) {
  const hips = bones.get('Hips'), chest = bones.get('Spine1');
  if (!hips || !chest) return null;
  body.updateMatrixWorld(true);
  const inverse = body.matrixWorld.clone().invert();
  const hipY = hips.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).y;
  const chestY = chest.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).y;
  const points: { mesh: THREE.SkinnedMesh; index: number; point: THREE.Vector3 }[] = [];
  body.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.visible || !/gown|robe|pattern_tunic/i.test(mesh.name)) return;
    const position = mesh.geometry.getAttribute('position');
    const transform = inverse.clone().multiply(mesh.matrixWorld);
    const chosen = new Map<string, number>();
    const p = new THREE.Vector3();
    let minY = Infinity;
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(transform);
      minY = Math.min(minY, p.y);
      if (p.y < hipY - .30 || p.y > chestY || Math.abs(p.x) > .29) continue;
      // A 25mm grid retains the cloth contour while limiting CPU skinning.
      const key = `${Math.round(p.x / .025)},${Math.round(p.y / .025)},${Math.round(p.z / .025)}`;
      if (!chosen.has(key)) chosen.set(key, i);
    }
    if (minY > hipY - .45) return; // A short tunic does not need this constraint.
    for (const index of chosen.values()) points.push({ mesh, index, point: new THREE.Vector3() });
  });
  if (!points.length) return null;
  const local = new THREE.Vector3(), target = new THREE.Vector3();
  const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  const setWorld = (bone: THREE.Bone, q: THREE.Quaternion) => {
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(parentQ).invert().multiply(q));
    bone.updateMatrixWorld(true);
  };
  return (weight = 1) => {
    if (weight < .001) return;
    body.updateMatrixWorld(true);
    inverse.copy(body.matrixWorld).invert();
    for (const sample of points) {
      const { mesh, index, point } = sample;
      point.fromBufferAttribute(mesh.geometry.getAttribute('position'), index);
      mesh.applyBoneTransform(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
    }
    const clearance = (p: THREE.Vector3, radius: number, side: number) => {
      local.copy(p).applyMatrix4(inverse);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const { point } of points) {
        if (Math.abs(point.y - local.y) > .045) continue;
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
      }
      if (!Number.isFinite(minX)) return 0;
      const cz = (minZ + maxZ) / 2, rz = (maxZ - minZ) / 2 + radius;
      const z = (local.z - cz) / rz;
      if (Math.abs(z) >= 1) return 0;
      const cx = (minX + maxX) / 2;
      const rx = (maxX - minX) / 2 + radius;
      const edge = cx + side * rx * Math.sqrt(1 - z * z);
      return Math.max(0, side * (edge - local.x));
    };
    for (const [name, side] of [['Left', 1], ['Right', -1]] as const) {
      const arm = bones.get(name + 'Arm'), fore = bones.get(name + 'ForeArm'), hand = bones.get(name + 'Hand'), finger = bones.get(name + 'HandMiddle1');
      if (!arm || !fore || !hand || !finger) continue;
      const a = arm.getWorldPosition(new THREE.Vector3()), e = fore.getWorldPosition(new THREE.Vector3()), w = hand.getWorldPosition(new THREE.Vector3());
      const palm = finger.getWorldPosition(new THREE.Vector3()).lerp(w, .35);
      const delta = Math.min(.065, Math.max(clearance(palm, .026, side), clearance(w, .025, side), 1.5 * clearance(e.clone().lerp(w, .5), .030, side))) * weight;
      if (delta < .0001) continue;
      const handQ = hand.getWorldQuaternion(new THREE.Quaternion());
      target.copy(w).applyMatrix4(inverse); target.x += side * delta; target.applyMatrix4(body.matrixWorld);
      const l1 = a.distanceTo(e), l2 = e.distanceTo(w), axis = target.clone().sub(a);
      const d = THREE.MathUtils.clamp(axis.length(), Math.abs(l1 - l2) + .001, l1 + l2 - .001); axis.normalize();
      const pole = e.clone().sub(a); pole.addScaledVector(axis, -pole.dot(axis));
      if (pole.lengthSq() < 1e-8) continue;
      pole.normalize();
      const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const elbow = a.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
      const wrist = a.clone().addScaledVector(axis, d);
      const swing = (bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
        worldQ.setFromUnitVectors(from.normalize(), to.normalize()).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
        setWorld(bone, worldQ);
      };
      swing(arm, e.clone().sub(a), elbow.clone().sub(a));
      swing(fore, hand.getWorldPosition(new THREE.Vector3()).sub(elbow), wrist.sub(elbow));
      setWorld(hand, handQ);
    }
  };
}
