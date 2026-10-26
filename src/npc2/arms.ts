import * as THREE from 'three';

// A cloaked walker's arms swing less behind him: under a mantle the arms
// are carried close (and the backswing would push the elbow out through the
// cloth's back). After the animation, each upper arm's backward angle from
// hanging straight down, in the body's own side plane, is clamped softly
// at `maxBack`; the forearm and hand follow as its children.

const _a = new THREE.Vector3(), _f = new THREE.Vector3(), _ax = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion();
const _inv = new THREE.Matrix4();

export function clampArmSwing(body: THREE.Object3D, bone: (n: string) => THREE.Bone | undefined, maxBack = THREE.MathUtils.degToRad(8)) {
  body.updateMatrixWorld(true);
  _inv.copy(body.matrixWorld).invert();
  for (const S of ['Left', 'Right']) {
    const A = bone(`${S}Arm`), F = bone(`${S}ForeArm`);
    if (!A || !F) continue;
    _a.setFromMatrixPosition(A.matrixWorld).applyMatrix4(_inv);
    _f.setFromMatrixPosition(F.matrixWorld).applyMatrix4(_inv).sub(_a);
    // Angle behind straight down (the body faces +z): positive when the elbow is behind the shoulder.
    const back = Math.atan2(-_f.z, -_f.y);
    if (back <= maxBack) continue;
    const want = maxBack + (back - maxBack) * 0.2;
    // Rotate forward about the body's side axis (+x turns down towards -z, so the other way).
    _ax.set(1, 0, 0).transformDirection(body.matrixWorld);
    _qr.setFromAxisAngle(_ax, -(back - want));
    A.getWorldQuaternion(_q).premultiply(_qr);
    A.parent!.getWorldQuaternion(_qp).invert();
    A.quaternion.copy(_qp.multiply(_q));
    A.updateMatrixWorld(true);
  }
}
