import * as THREE from 'three';
import { toWorldXZ, fastTerrain } from '../displace';

// Where every readable thing lies in the world. Filled while the world is
// built (monuments register theirs in their own frame; the interiors from the
// layout); the reading UI (secrets.ts) and the map read this list.

export interface Placed { id: string; pos: THREE.Vector3; /** Look direction needed (0 = any). */ facing?: number }
export const PLACED: Placed[] = [];
const _w = [0, 0];
/** Register a readable at local (x, y, z) in the current site frame (y above the ground, or above absY). */
export function markReadable(id: string, x: number, y: number, z: number, absY: number | null = null) {
  toWorldXZ(x, z, _w);
  PLACED.push({ id, pos: new THREE.Vector3(_w[0], y + (absY ?? fastTerrain(_w[0], _w[1])), _w[1]) });
}
/** Register at a world point (y above the ground there). */
export function markReadableWorld(id: string, x: number, y: number, z: number) {
  PLACED.push({ id, pos: new THREE.Vector3(x, y + fastTerrain(x, z), z) });
}
