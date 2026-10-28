import type { Builder } from '../builder';
import type { IFrame } from './interiors';
import { lucerna } from '../lights';

// Small early-medieval worship rooms fitted to the registered urban footprint.
// The dedications/location evidence is separate from this reconstructed plan.
export function urbanChurchLayout(f: IFrame) {
  const at = (u: number, w: number): [number, number] => [f.a.x + f.e.x * u + f.inn.x * w, f.a.y + f.e.y * u + f.inn.y * w];
  return { at, altarU: f.L / 2, altarW: f.D - f.T - 0.85 };
}

/** Continuous masonry altar, timber cross, lamp and open standing congregation. */
export function buildUrbanChurch(b: Builder, f: IFrame, collision = false) {
  const { at, altarU, altarW } = urbanChurchLayout(f);
  const box = (mat: 'stone' | 'marble' | 'wood' | 'cloth', w: number, h: number, d: number, u: number, y: number, v: number) => {
    const [x, z] = at(u, v); b.box(mat, w, h, d, x, y, z, f.ry, collision);
  };
  if (collision) {
    box('stone', 1.15, 1.0, 0.72, altarU, 0, altarW);
    return;
  }
  box('stone', 0.78, 0.88, 0.5, altarU, 0, altarW);
  box('marble', 1.15, 0.12, 0.72, altarU, 0.88, altarW);
  box('cloth', 1.08, 0.014, 0.66, altarU, 1.002, altarW);
  // Plain cross; no late medieval retable or modern pew rows.
  box('wood', 0.065, 1.0, 0.065, altarU, 1.3, f.D - f.T - 0.10);
  box('wood', 0.58, 0.065, 0.065, altarU, 1.97, f.D - f.T - 0.10);
  const [lx, lz] = at(altarU - 0.35, altarW);
  lucerna(b, lx, 1.03, lz, f.ry, false, true);
  // A closed book and the dedication readable sit on the altar mensa.
  box('wood', 0.22, 0.055, 0.29, altarU + 0.20, 1.02, altarW);
  box('cloth', 0.19, 0.035, 0.265, altarU + 0.20, 1.025, altarW);
  // Restrained lintel cross makes the worship-room entrance recognizable.
  box('stone', 0.065, 0.42, 0.045, f.door, 2.65, -0.035);
  box('stone', 0.27, 0.065, 0.045, f.door, 2.91, -0.035);
}
