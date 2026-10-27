import * as THREE from 'three';
import type { Builder } from '../builder';
import { lucerna } from '../lights';
import type { IFrame } from './interiors';

// A modest prayer room fitted to an existing urban lot. The reconstruction
// rationale and its limits belong in docs/benevento/JEWISH-PRESENCE.md.
export function synagogueLayout(f: IFrame) {
  const at = (u: number, w: number): [number, number] => [f.a.x + f.e.x * u + f.inn.x * w, f.a.y + f.e.y * u + f.inn.y * w];
  // World x is east and z south. Choose the closest available wall toward
  // Jerusalem, keeping the street entrance unobstructed.
  const walls = [
    { u: f.L / 2, w: f.D - f.T - 0.36, dx: f.inn.x, dz: f.inn.y, side: 'back' },
    { u: f.T + 0.36, w: f.D * 0.62, dx: -f.e.x, dz: -f.e.y, side: 'left' },
    { u: f.L - f.T - 0.36, w: f.D * 0.62, dx: f.e.x, dz: f.e.y, side: 'right' },
  ];
  walls.sort((a, b) => (b.dx * 0.8 + b.dz * 0.6) - (a.dx * 0.8 + a.dz * 0.6));
  const shrine = walls[0];
  const table = { u: f.L / 2, w: f.D * 0.49 };
  return { at, shrine, table, read: at(table.u, table.w) };
}

/** Furniture and matching collision proxies; shell/door remain the lot's. */
export function buildSynagogue(b: Builder, f: IFrame, collision = false) {
  const { at, shrine, table } = synagogueLayout(f);
  const cabinetYaw = Math.atan2(-shrine.dx, -shrine.dz); // front toward worshippers
  const box = (w: number, h: number, d: number, u: number, y: number, v: number, yaw = f.ry) => {
    const [x, z] = at(u, v);
    b.box('wood', w, h, d, x, y, z, yaw, collision);
  };
  // Perimeter benches, with a continuous route from doorway to reading table.
  const seatLength = Math.max(1.0, Math.min(2.8, f.D - 2 * f.T - 1.5));
  for (const side of ['left', 'right'] as const) {
    if (shrine.side === side) continue;
    const u = side === 'left' ? f.T + 0.24 : f.L - f.T - 0.24;
    const w = f.T + 0.75 + seatLength / 2;
    if (collision) box(0.38, 0.48, seatLength, u, 0, w);
    else {
      box(0.38, 0.07, seatLength, u, 0.43, w);
      for (const dv of [-seatLength * 0.37, seatLength * 0.37]) box(0.3, 0.43, 0.12, u, 0, w + dv);
    }
  }
  // Plain timber Torah cupboard, deliberately unlike a Christian stone altar.
  if (collision) box(1.08, 1.85, 0.5, shrine.u, 0, shrine.w, cabinetYaw);
  else {
    const [sx, sz] = at(shrine.u, shrine.w);
    const part = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      b.box('wood', w, h, d, sx + Math.cos(cabinetYaw) * x + Math.sin(cabinetYaw) * z,
        y, sz - Math.sin(cabinetYaw) * x + Math.cos(cabinetYaw) * z, cabinetYaw, false);
    };
    part(1.06, 0.1, 0.5, 0, 0.12, 0);
    part(1.06, 0.1, 0.5, 0, 1.77, 0);
    for (const x of [-0.49, 0.49]) part(0.08, 1.55, 0.5, x, 0.22, 0);
    part(0.9, 1.55, 0.055, 0, 0.22, -0.22);
    // Two closed doors with a small central joint and simple timber panels.
    for (const x of [-0.235, 0.235]) part(0.455, 1.48, 0.055, x, 0.25, 0.22);
    for (const y of [0.38, 1.58]) part(0.91, 0.045, 0.025, 0, y, 0.26);
  }
  if (collision) {
    box(0.9, 0.9, 0.7, table.u, 0, table.w);
    return;
  }
  box(0.9, 0.07, 0.7, table.u, 0.84, table.w);
  for (const du of [-0.35, 0.35]) for (const dw of [-0.25, 0.25]) box(0.075, 0.84, 0.075, table.u + du, 0, table.w + dw);
  const [tx, tz] = at(table.u, table.w);
  // Open scroll: parchment between two wooden rollers, no invented inscription.
  b.box('bone', 0.47, 0.008, 0.36, tx, 0.915, tz, f.ry, false);
  for (const du of [-0.26, 0.26]) {
    const [x, z] = at(table.u + du, table.w);
    b.geo('bone', new THREE.CylinderGeometry(0.045, 0.045, 0.39, 10), x, 0.95, z, f.ry, false, Math.PI / 2);
    b.geo('wood', new THREE.CylinderGeometry(0.013, 0.013, 0.47, 8), x, 0.95, z, f.ry, false, Math.PI / 2);
  }
  const [lx, lz] = at(table.u + 0.32, table.w + 0.22);
  lucerna(b, lx, 0.92, lz, f.ry, false, true);
  // A second oil lamp on a small wall shelf brings out the cupboard's timber.
  const lampU = shrine.side === 'left' ? f.L - f.T - 0.25 : f.T + 0.25;
  const lampW = f.D - f.T - 0.6;
  box(0.36, 0.06, 0.4, lampU, 1.35, lampW);
  const [ax, az] = at(lampU, lampW);
  lucerna(b, ax, 1.42, az, f.ry, false, true);
}
