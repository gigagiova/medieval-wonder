import type * as THREE from 'three';

// Where the fog has swallowed everything: a conservative CPU twin of the
// height fog in applyAtmos() (shaders.ts). Keep FOG in step with it.
//
// The shader's optical depth along a ray of length L that climbs dy is
//   od = dens · e^(−b·h0) · L · (1 − e^(−b·dy)) / (b·dy) · drift
// with h0 the eye's height over the fog base and drift ∈ [0.45, 1.6] the
// slowly drifting density. The lowest it can be anywhere over a box is with
// the box's nearest distance, its highest point and the thinnest drift, so a
// box whose minimum optical depth is past HIDDEN is at least 98.5 % fog colour
// at every pixel, whatever the drift does, and can be skipped.

export const FOG = { dens: 0.045, b: 0.06, driftMin: 0.45 };
/** e^-4.2 ≈ 0.015: what is left of the surface's own colour. */
const HIDDEN = 4.2;

/** Smallest optical depth the fog can have between the eye and any point of the box. */
export function minFogDepth(box: THREE.Box3, eye: THREE.Vector3, fogBase: number) {
  const L = box.distanceToPoint(eye);
  if (L < 1) return 0;
  const h0 = eye.y - fogBase;
  const dy = Math.max(box.max.y - eye.y, 0) * FOG.b;
  // (1 − e^−x) / x falls with x; climbing makes the ray thinner, never thicker
  // (descending rays only thicken, so they are bounded by the level case).
  const g = dy > 1e-4 ? (1 - Math.exp(-dy)) / dy : 1;
  return FOG.dens * Math.exp(-FOG.b * h0) * L * g * FOG.driftMin;
}

/** True when the fog hides the whole box (above ground only; underground has its own fog). */
export function fogHides(box: THREE.Box3, eye: THREE.Vector3, fogBase: number, under: number) {
  if (under > 0.001) return false;
  return minFogDepth(box, eye, fogBase) > HIDDEN;
}
