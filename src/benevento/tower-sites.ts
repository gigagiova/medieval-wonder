import type { TowerSpec } from './fabric';

/** Registered towers override local procedural placeholders. The remaining
 * candidates and unresolved wall-trace offsets are in docs/benevento/TOWERS.md.
 * Plan, rendering and collision must consume these same coordinates. */
export const REGISTERED_WALL_TOWERS: TowerSpec[] = [{
  // OSM way248001579, rounded footprint at the source plan's NE corner.
  // Radius approximates that footprint; 13m elevation is a reconstruction.
  id: 'panaro', name: 'Torre del Santo Panaro', visit: [695, -174],
  x: 675.4100727763, z: -148.6295499275, ox: 0, oz: 0, radius: 4.5,
  kind: 1, h: 13, seed: 248001579, roof: false, torch: false,
}];
