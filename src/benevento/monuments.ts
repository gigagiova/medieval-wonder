import * as THREE from 'three';
import { Builder, rng } from '../builder';
import type { MatName } from '../materials';
import { arcadeGeo, archRings, ruin, column, fallenDrum, pyramidRoof, quoinBox, gable, ringGeo, wellHead } from '../shapes';
import { Acc } from '../arch/kit';
import { tiledGable } from '../arch/roof';
import { torch, brazier, lucerna, candle, hornLantern } from '../lights';
import { fastTerrain, toWorldXZ, toLocalXZ, SITE } from '../displace';
import { markReadable } from './readables';
import { placeProp } from '../props';

// The monuments of Benevento as they stood in AD 700, each built in its own
// frame (world.ts sets the site): the Arch of Trajan, now the Porta Aurea of
// the Lombard walls; the arch at the forum now a gate; the theatre lived in;
// the amphitheatre quarried for the walls and burnt for lime; the 7th-century
// Torre della Catena; S. Ilario outside Porta Aurea; the bridges; the ruins of
// the Iseum with its obelisks; the Lombard cemetery with its poles; the stump
// of the sacred walnut by the Sabato; a mill; the forum and its market; a
// Roman cistern under the dukes' orchard.

let rand = rng(1);
const R = (a: number, b: number) => a + (b - a) * rand();
const seed = (s: number) => { rand = rng(s); };
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Flip a geometry's faces inward (vaults and domes seen from inside). */
function inward(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  const p = n.attributes.position.array as Float32Array;
  const nr = n.attributes.normal?.array as Float32Array | undefined;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
    if (nr) { for (let k = 0; k < 3; k++) { const t = nr[i + 3 + k]; nr[i + 3 + k] = nr[i + 6 + k]; nr[i + 6 + k] = t; } }
  }
  if (nr) for (let i = 0; i < nr.length; i++) nr[i] = -nr[i];
  return n;
}
/** A barrel vault (half cylinder seen from inside), axis along local x. */
function vault(b: Builder, m: MatName, len: number, r: number, x: number, y: number, z: number, ry: number) {
  const g = inward(new THREE.CylinderGeometry(r, r, len, 20, Math.max(1, Math.round(len)), true, 0, Math.PI));
  g.rotateZ(Math.PI / 2); g.rotateX(-Math.PI / 2);
  b.geo(m, g, x, y, z, ry, false);
}

// ---------------------------------------------------------------- Arch of Trajan (Porta Aurea)
/** Passage along local z; the countryside (Via Traiana) is +z. */
export function arcusTraiani(b: Builder) {
  seed(114);
  const W = 8.6, D = 6.0, OW = 5.0, SP = 5.6, H = 11.4;
  b.geo('marble', arcadeGeo(W, H, D, 1, OW, SP), 0, -0.2, 0, 0);
  archRings(b, 'marble', 0, -0.2, 0, 0, D, OW, SP, 0.55, 0.36);
  for (const sz of [-1, 1]) {
    const fz = sz * (D / 2 + 0.35);
    // Pedestals, engaged columns, capitals: two each side of the passage.
    for (const x of [-(W / 2 - 0.62), -(OW / 2 + 0.66), OW / 2 + 0.66, W / 2 - 0.62]) {
      b.box('marble', 1.15, 2.4, 0.8, x, -0.2, sz * (D / 2 + 0.3));
      const shaft = new THREE.CylinderGeometry(0.36, 0.4, 6.6, 14, 6, false, sz > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI);
      b.geo('marble', shaft, x, 2.2 + 3.3, fz - sz * 0.35, 0, false);
      b.box('marble', 1.0, 0.75, 0.55, x, 8.8, fz - sz * 0.05, 0, false);
    }
    // Relief panels in two registers on the piers, and the long frieze.
    for (const x of [-(W / 2 + OW / 2) / 2, (W / 2 + OW / 2) / 2]) {
      b.box('marble', 1.15, 2.2, 0.12, x, 2.6, sz * (D / 2 + 0.03), 0, false);
      b.box('marble', 1.15, 2.2, 0.12, x, 5.8, sz * (D / 2 + 0.03), 0, false);
      b.box('slab', 1.0, 0.18, 0.14, x, 5.2, sz * (D / 2 + 0.05), 0, false);
    }
    b.box('marble', W - 0.4, 0.75, 0.14, 0, 8.9, sz * (D / 2 + 0.04), 0, false);
    // The attic and its inscription.
    b.box('slab', 4.3, 2.7, 0.12, 0, 12.0, sz * (D / 2 - 0.25), 0, false);
  }
  // Entablature: architrave, frieze, cornice in steps.
  b.box('marble', W + 0.25, 0.6, D + 0.6, 0, H - 0.1, 0);
  b.box('marble', W + 0.55, 0.4, D + 0.9, 0, H + 0.5, 0, 0, false);
  b.box('marble', W - 0.2, 3.6, D - 0.5, 0, H + 0.9, 0);
  b.box('marble', W + 0.1, 0.35, D - 0.2, 0, H + 4.45, 0, 0, false);
  markReadable('arcusInscriptio', 0, 12.6, -(D / 2 - 0.1));
  markReadable('arcusInscriptio', 0, 12.6, D / 2 - 0.1);
  // A Lombard brazier keeps the gate; a niche shrine scratched into the pier.
  brazier(b, -3.4, -6.5);
  torch(b, -(W / 2 + 0.1), 3.2, -(D / 2) + 0.6, -Math.PI / 2);
  markReadable('sesualdus', W / 2 + 0.2, 1.6, -D / 2 - 0.3);
}

// ---------------------------------------------------------------- Arch "del Sacramento" (a gate)
/** Passage along local z. Brick core, its marble long since prised away. */
export function arcusSacramenti(b: Builder) {
  seed(77);
  const W = 10.3, D = 4.8, OW = 4.4, SP = 4.4;
  b.geo('brick', arcadeGeo(W, 8.2, D, 1, OW, SP), 0, -0.3, 0, 0);
  archRings(b, 'brick', 0, -0.3, 0, 0, D, OW, SP, 0.9, 0.075);
  ruin(b, 'brick', W, 2.4, D, 0, 7.8, 0, 0, 0.75);
  // Sockets where the marble cladding was clamped, a few slabs left.
  for (let i = 0; i < 14; i++) b.box('iron', 0.14, 0.1, 0.08, R(-W / 2 + 0.4, W / 2 - 0.4), R(0.6, 7.5), (rand() < 0.5 ? -1 : 1) * (D / 2 + 0.01), 0, false);
  b.box('marble', 1.6, 2.1, 0.18, -(OW / 2 + 1.3), 0.4, D / 2 + 0.1, 0, false);
  // The late-antique pentagonal tower beside it, of big reused blocks.
  const g = new THREE.CylinderGeometry(3.2, 3.4, 11.5, 5, 4);
  b.geo('bigstone', g, 6.4, 5.45, 9.4, 0.3);
  ruin(b, 'rubble', 4.6, 1.8, 4.2, 6.4, 11.1, 9.4, 0.3, 0.85);
  torch(b, -(OW / 2 + 0.3), 3.0, -D / 2 - 0.3, Math.PI);
  markReadable('sacramentum', -(OW / 2 + 1.3), 1.4, D / 2 + 0.25);
}

// ---------------------------------------------------------------- the theatre, lived in
/**
 * Cavea on local +x (east), scaena along x ≈ -3 (west). Outer radius 44 m:
 * two orders of 25 arches, the upper half fallen; houses fill the arches and
 * huts stand on the seats.
 */
export function theatrum(b: Builder) {
  seed(126);
  const RI = 11, RO = 44, RC = RO - 5, HC = 13;
  // Seating, three wedges with stairs between; the top rows robbed out.
  const steps: THREE.Vector2[] = [new THREE.Vector2(RI - 0.6, -0.3)];
  for (let k = 0, r = RI; r < RC - 0.5; k++, r += 0.78) {
    const y = 0.4 + k * 0.36;
    steps.push(new THREE.Vector2(r, y), new THREE.Vector2(r + 0.78, y));
  }
  steps.push(new THREE.Vector2(RC, HC), new THREE.Vector2(RC, -0.3));
  for (const [a0, a1] of [[0.02, 0.98], [1.05, 2.09], [2.16, 3.12]]) {
    const g = new THREE.LatheGeometry(steps, 18, a0, a1 - a0);
    b.geo('block', g, 0, 0, 0, 0, true, 0, 0, false, new THREE.LatheGeometry([new THREE.Vector2(RI - 0.6, 0.2), new THREE.Vector2(RC, HC)], 8, a0, a1 - a0));
  }
  // Stairs up the gaps (walkable).
  for (const a of [1.015, 2.125]) {
    const g = new THREE.LatheGeometry([new THREE.Vector2(RI - 0.6, 0.0), new THREE.Vector2(RC, HC - 0.4), new THREE.Vector2(RC, -0.3)], 2, a - 0.03, 0.06);
    b.geo('stone', g, 0, 0, 0, 0, true);
  }
  // Orchestra: worn slabs, mud, a puddle.
  b.geo('slab', new THREE.CircleGeometry(RI - 0.6, 24, Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), 0, 0.02, 0, 0, false);
  // The cavea's back: the vaulted ambulatory behind two orders of arches.
  const NB = 25;
  for (let i = 0; i < NB; i++) {
    const a0 = -Math.PI / 2 + (i / NB) * Math.PI, a1 = -Math.PI / 2 + ((i + 1) / NB) * Math.PI, am = (a0 + a1) / 2;
    const bay = 2 * RO * Math.sin((a1 - a0) / 2);
    const x = Math.cos(am) * RO, z = Math.sin(am) * RO, ry = -am - Math.PI / 2;
    const infill = rand() < 0.55;
    b.geo('block', arcadeGeo(bay + 0.05, 8.2, 1.4, 1, 3.4, 4.6), x, -0.3, z, ry);
    archRings(b, 'block', x, -0.3, z, ry, 1.4, 3.4, 4.6, 0.55, 0.42);
    if (infill) {
      // A house walled into the arch: rubble, a door or a window, a vent.
      b.geo('rubble', arcadeGeo(3.4, 6.3, 0.6, 1, 1.0, 1.7), x * 0.995, -0.3, z * 0.995, ry);
      b.box('wood', 1.0, 1.9, 0.08, x * 0.99, -0.2, z * 0.99, ry, false);
      if (rand() < 0.5) b.box('iron', 0.5, 0.6, 0.62, x * 0.995 + Math.cos(am) * 0.01, 4.3, z * 0.995, ry, false);
      if (rand() < 0.35) b.lamp('window', V3(x * 0.98, 4.4, z * 0.98));
    }
    // Upper order: standing over the south half only, fallen elsewhere.
    if (i < 13 || rand() < 0.25) {
      b.geo('block', arcadeGeo(bay + 0.05, 5.6, 1.2, 1, 3.0, 3.2), x, 7.9, z, ry);
      if (rand() < 0.6) ruin(b, 'rubble', bay, R(0.5, 2.4), 1.2, x, 13.4, z, ry, 0.8);
    } else {
      ruin(b, 'block', bay, R(0.6, 2.2), 1.3, x, 7.9, z, ry, 0.9);
      for (let k = 0; k < 2; k++) b.box('block', R(0.6, 1.1), R(0.4, 0.6), R(0.5, 0.9), x * R(1.03, 1.12), -0.2, z * R(1.03, 1.12), R(0, 3));
    }
    // Radial wall between ambulatory bays; the vault over it.
    b.box('rubble', 0.9, 8.0, RO - RC, Math.cos(a0) * (RO + RC) / 2, -0.3, Math.sin(a0) * (RO + RC) / 2, -a0 + Math.PI / 2);
    vault(b, 'brick', RO - RC, bay / 2 - 0.2, Math.cos(am) * (RC + RO) / 2, 7.6, Math.sin(am) * (RC + RO) / 2, -am);
  }
  b.box('block', 0.9, 8.0, RO - RC, 0, -0.3, (RO + RC) / 2, Math.PI / 2);
  // Ring wall behind the seats.
  for (let i = 0; i < 24; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / 24) * Math.PI;
    b.box('rubble', 2 * RC * Math.sin(Math.PI / 48) + 0.2, HC, 1.0, Math.cos(a) * RC, -0.3, Math.sin(a) * RC, -a - Math.PI / 2, false);
  }
  // Scaena: the stage platform and the broken stage wall with its niches and a few columns.
  b.box('rubble', 6.0, 1.3, 2 * RO * 0.86, -6.4, -0.3, 0);
  for (let k = -3; k <= 3; k++) {
    const z = k * 10.6;
    const h = R(5, 13);
    b.geo(rand() < 0.5 ? 'brick' : 'rubble', arcadeGeo(10.4, h, 1.8, 1, k === 0 ? 3.6 : 2.4, k === 0 ? 4 : 2.6), -9.8, -0.3, z, Math.PI / 2);
    if (rand() < 0.6) ruin(b, 'rubble', 10.4, R(1, 3), 1.8, -9.8, h - 0.3, z, Math.PI / 2, 0.8);
  }
  for (let k = 0; k < 6; k++) column(b, -6.0 + R(-0.2, 0.2), 1.0, R(-24, 24), R(5, 7), 0.32, rand() < 0.5 ? R(0.3, 0.7) : 0);
  for (let k = 0; k < 5; k++) fallenDrum(b, R(-8, 4), R(-20, 20), 0.35, R(1, 2.2), R(0, 3));
  // Huts on the upper seats: the poor live here, outside the walls.
  for (let k = 0; k < 9; k++) {
    const a = R(-1.3, 1.3), r = R(RI + 12, RC - 4);
    const y = 0.4 + Math.floor((r - RI) / 0.78) * 0.36;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = R(2.8, 4), d = R(2.6, 3.4), ry = -a + R(-0.2, 0.2);
    b.box(rand() < 0.5 ? 'rubble' : 'wood', w, 2.3, d, x, y - 0.4, z, ry);
    gable(b, w, d, 0.8, x, y + 1.9, z, ry, 'wood', 0.35);
    if (rand() < 0.5) b.lamp('window', V3(x, y + 1.2, z));
  }
  brazier(b, 8, 4);
  torch(b, RO + 0.9, 3.0, 4, Math.PI / 2);
  markReadable('theatrum', -7.0, 1.6, 2.5);
}

// ---------------------------------------------------------------- the amphitheatre, quarried
export function amphitheatrum(b: Builder) {
  seed(301);
  const A = 48, B = 38, a = 27, bb = 17;
  const N = 56;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const ox = Math.cos(t) * A, oz = Math.sin(t) * B, ix = Math.cos(t) * a, iz = Math.sin(t) * bb;
    const mx = (ox + ix) / 2, mz = (oz + iz) / 2, L = Math.hypot(ox - ix, oz - iz);
    const ry = Math.atan2(ox - ix, oz - iz) - Math.PI / 2;
    // Radial walls: mostly cut down to stumps, some still standing to the first vault.
    const standing = (i > 6 && i < 13) || (i > 34 && i < 38);
    const h = standing ? R(7, 10) : R(0.4, 3.2);
    ruin(b, rand() < 0.6 ? 'rubble' : 'bigstone', L * R(0.5, 1), h, 1.1, mx, -0.4, mz, ry, standing ? 0.3 : 0.8);
    if (standing && i % 2 === 0) {
      const t2 = ((i + 0.5) / N) * Math.PI * 2;
      const bay = 2 * A * Math.sin(Math.PI / N);
      b.geo('block', arcadeGeo(bay + 0.1, 9, 1.2, 1, bay * 0.62, 5), Math.cos(t2) * A, -0.4, Math.sin(t2) * B, -t2 - Math.PI / 2);
    }
  }
  // Podium wall round the arena, a sunken floor of mud and weeds.
  for (let i = 0; i < 28; i++) {
    const t0 = (i / 28) * Math.PI * 2, t1 = ((i + 1) / 28) * Math.PI * 2;
    const x0 = Math.cos(t0) * a, z0 = Math.sin(t0) * bb, x1 = Math.cos(t1) * a, z1 = Math.sin(t1) * bb;
    if (rand() < 0.3) continue;
    ruin(b, 'block', Math.hypot(x1 - x0, z1 - z0) + 0.1, R(0.6, 2.2), 0.9, (x0 + x1) / 2, -0.5, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2, 0.6);
  }
  // Spoil heaps and blocks waiting for carts; a lime kiln burning marble.
  for (let i = 0; i < 9; i++) {
    const t = R(0, 6.28), r = R(0.7, 1.15);
    const x = Math.cos(t) * A * r, z = Math.sin(t) * B * r;
    b.geo('rubble', new THREE.ConeGeometry(R(2, 3.5), R(1.2, 2.2), 9, 2), x, 0.4, z, R(0, 3));
    for (let k = 0; k < 4; k++) b.box(rand() < 0.5 ? 'marble' : 'block', R(0.6, 1.2), R(0.4, 0.7), R(0.5, 1), x + R(-3, 3), -0.2, z + R(-3, 3), R(0, 3));
  }
  const kx = A + 9, kz = 6;
  b.geo('rubble', ringGeo(2.2, 1.4, 3.0), kx, -0.3, kz);
  b.box('rubble', 1.0, 1.2, 0.9, kx + 2.0, -0.3, kz, 0);
  b.lamp('brazier', V3(kx, 2.2, kz), false, 'brazier', 1.4);
  for (let k = 0; k < 6; k++) b.box('marble', R(0.5, 0.9), R(0.3, 0.5), R(0.4, 0.8), kx + R(-4, 4), -0.2, kz + R(3, 6), R(0, 3));
  markReadable('calcaria', kx + 2.4, 1.0, kz + 0.2);
}

// ---------------------------------------------------------------- Torre della Catena
/** A 7th-century fort tower guarding the theatre, the amphitheatre and the Appia. Door to local -x. */
export function turrisCatenae(b: Builder) {
  seed(640);
  const W = 11.6, D = 8.0, H = 15, T = 1.6, H1 = 4.6;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: MatName = 'rubble') => b.box(m, w, h, d, x, y, z, 0);
  // Ground storey with a door; solid above.
  box(T, H1, (D - 1.2) / 2, -W / 2 + T / 2, -0.4, -(D + 1.2) / 4);
  box(T, H1, (D - 1.2) / 2, -W / 2 + T / 2, -0.4, (D + 1.2) / 4);
  box(T, H1 - 2.3, 1.2, -W / 2 + T / 2, 2.3 - 0.4, 0);
  box(T, H1, D, W / 2 - T / 2, -0.4, 0);
  box(W - 2 * T, H1, T, 0, -0.4, -D / 2 + T / 2);
  box(W - 2 * T, H1, T, 0, -0.4, D / 2 - T / 2);
  box(W, H - H1, D, 0, H1 - 0.4, 0);
  quoinBox(b, 'bigstone', W, H - 0.4, D, 0, -0.4, 0, 0);
  // Courses of Roman brick through the cobble and mortar.
  for (const y of [3.0, 6.5, 10]) b.box('brick', W + 0.05, 0.35, D + 0.05, 0, y, 0, 0, false);
  for (const [x, z] of [[0, -D / 2], [0, D / 2], [W / 2, 0]]) for (const y of [6.2, 9.8, 12.8]) b.box('iron', x ? 0.3 : 0.25, 1.0, x ? 0.4 : 0.3, x || R(-3, 3), y, z, 0, false);
  ruin(b, 'rubble', W, 1.6, 0.8, 0, H - 0.4, -D / 2 + 0.4, 0, 0.6);
  ruin(b, 'rubble', W, 1.4, 0.8, 0, H - 0.4, D / 2 - 0.4, 0, 0.6);
  pyramidRoof(b, D + 0.5, 2.0, 0, H - 0.6, 0);
  // Inside: a guard room, a ladder to the floor above, a brazier.
  b.box('wood', W - 2 * T, 0.2, D - 2 * T, 0, H1 - 0.4, 0, 0, true);
  for (let i = 0; i < 9; i++) b.box('wood', 0.06, 0.06, 0.5, W / 2 - T - 0.5, 0.3 + i * 0.42, 0, 0, false);
  b.box('wood', 0.08, 4.2, 0.08, W / 2 - T - 0.5, -0.2, -0.25, 0, false); b.box('wood', 0.08, 4.2, 0.08, W / 2 - T - 0.5, -0.2, 0.25, 0, false);
  b.box('wood', 1.6, 0.06, 0.6, 0, 0.8, D / 2 - T - 0.4, 0, false);
  b.lamp('torch', V3(1.2, 0.3, -1.2), false, 'brazier', 0.6);
  torch(b, -W / 2 - 0.1, 3.0, 1.0, -Math.PI / 2);
  markReadable('catena', 0.2, 0.9, D / 2 - T - 0.4);
}

// ---------------------------------------------------------------- S. Ilario a Port'Aurea
/**
 * A single-naved hall of the late 7th / early 8th c. with two domes in line,
 * each under its own square tiburium with a pyramid roof; one apse (local +x);
 * a narrow, tall door in the west front (local -x).
 */
export function sanctusHilarius(b: Builder) {
  seed(690);
  const L = 15.0, W = 8.2, T = 0.85, H = 6.6;
  const m: MatName = 'rubble';
  // West front with its door; flanks; east wall with the apse opening.
  b.geo(m, arcadeGeo(W, H, T, 1, 1.0, 2.5), -L / 2 + T / 2, -0.3, 0, Math.PI / 2);
  archRings(b, 'brick', -L / 2 + T / 2, -0.3, 0, Math.PI / 2, T, 1.0, 2.5, 0.38, 0.075);
  b.box(m, L, H, T, 0, -0.3, -W / 2 + T / 2);
  b.box(m, L, H, T, 0, -0.3, W / 2 - T / 2);
  b.geo(m, arcadeGeo(W, H, T, 1, 3.4, 3.2), L / 2 - T / 2, -0.3, 0, Math.PI / 2);
  // Apse.
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    b.box('brick', 1.0, 5.0, 0.7, L / 2 + Math.cos(a) * 2.2, -0.3, Math.sin(a) * 2.2, -a + Math.PI / 2);
  }
  b.geo('roof', new THREE.ConeGeometry(2.9, 1.4, 14, 1, false, 0, Math.PI), L / 2, 5.4, 0, Math.PI / 2, false);
  // Two bays with strong transverse arches; domes on pendentives inside, tiburia outside.
  for (const [cx, th] of [[-3.6, 3.0], [3.6, 3.8]] as const) {
    const g = new THREE.SphereGeometry(3.1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    b.geo('plaster', inward(g), cx, H - 0.6, 0, 0, false);
    b.box(m, 7.1, th, 7.1, cx, H - 0.3, 0, 0);
    pyramidRoof(b, 7.6, 1.9, cx, H - 0.3 + th, 0);
    for (const s of [-1, 1]) b.box('iron', 0.35, 0.9, 0.3, cx, H + th * 0.4, s * 3.56, 0, false);
  }
  b.box(m, 0.9, 1.2, W - 2 * T, 0, H - 0.6, 0, 0, false);
  b.box(m, 0.9, H - 0.6, 0.7, 0, -0.3, -W / 2 + T + 0.35);
  b.box(m, 0.9, H - 0.6, 0.7, 0, -0.3, W / 2 - T - 0.35);
  // Altar block, candles, a lamp at the door; graves round the church.
  b.box('marble', 1.4, 1.0, 0.8, L / 2 - 1.1, -0.2, 0);
  candle(b, L / 2 - 1.1, 0.8, -0.3, 0.4); candle(b, L / 2 - 1.1, 0.8, 0.3, 0.35);
  lucerna(b, -L / 2 + 1.4, 1.4, W / 2 - T - 0.1, Math.PI);
  for (let i = 0; i < 14; i++) {
    const x = R(-L / 2 - 6, L / 2 + 4), z = (rand() < 0.5 ? -1 : 1) * R(W / 2 + 1.5, W / 2 + 8);
    if (rand() < 0.5) b.box('ground', 0.8, 0.3, 1.9, x, -0.1, z, R(-0.3, 0.3)); else b.box('stone', 0.7, 0.16, 1.8, x, -0.05, z, R(-0.3, 0.3), true, R(-0.05, 0.05));
  }
  markReadable('hilarius', L / 2 - 1.1, 1.1, 0);
}

// ---------------------------------------------------------------- bridges
/**
 * A Roman bridge from A to B (world points), deck width w, over a river.
 * Built at absolute heights (b.absY = 0): the deck follows the banks and
 * crowns over the channel; arches stand on the bed.
 */
export function bridge(b: Builder, A: [number, number], B2: [number, number], w: number, crown: number, m: MatName = 'block', seedN = 1) {
  seed(seedN);
  const dx = B2[0] - A[0], dz = B2[1] - A[1], L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  const ry = Math.atan2(-uz, ux); // local +x along the bridge
  const hA = fastTerrain(A[0], A[1]), hB = fastTerrain(B2[0], B2[1]);
  const top = Math.max(hA, hB) + crown;
  const deckY = (t: number) => {
    // Ramps from either bank up to the crown, flat over the middle.
    const s = Math.min(t, 1 - t) * L;
    const ramp = Math.min(1, s / 26);
    const end = t < 0.5 ? hA : hB;
    return end + (top - end) * (ramp * ramp * (3 - 2 * ramp));
  };
  b.absY = 0;
  const STEP = 4;
  const n = Math.ceil(L / STEP);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
    const x = A[0] + dx * tm, z = A[1] + dz * tm;
    const y0 = deckY(t0), y1 = deckY(t1), y = (y0 + y1) / 2;
    const bed = Math.min(fastTerrain(x, z), fastTerrain(x + uz * w / 2, z - ux * w / 2), fastTerrain(x - uz * w / 2, z + ux * w / 2));
    const seg = L / n + 0.05;
    const tilt = Math.atan2(y1 - y0, L / n);
    // Deck (walkable), paved; parapets.
    b.box('slab', seg, 0.6, w, x, y - 0.6, z, ry, true, 0, tilt);
    for (const s of [-1, 1]) b.box(m, seg, 1.0, 0.5, x + uz * s * (w / 2 - 0.25), y - 0.05, z - ux * s * (w / 2 - 0.25), ry, true, 0, tilt);
    // Spandrel / fill down to the bed: arched where the drop allows.
    const drop = y - 0.6 - bed;
    if (drop > 0.4) {
      if (drop > 5 && i % 3 === 1) {
        b.geo(m, arcadeGeo(STEP * 3 + 0.1, drop + 1.2, w - 0.2, 1, STEP * 3 - 2.6, Math.max(0.5, drop - (STEP * 3 - 2.6) / 2 - 0.6)), x, bed - 1.2, z, ry);
        archRings(b, m, x, bed - 1.2, z, ry, w - 0.2, STEP * 3 - 2.6, Math.max(0.5, drop - (STEP * 3 - 2.6) / 2 - 0.6) + 1.2, 0.6, 0.4);
      } else if (!(drop > 5 && (i % 3 !== 1))) b.box(m, seg, drop + 1.2, w - 0.2, x, bed - 1.2, z, ry);
      else if (i % 3 === 0 || i % 3 === 2) {
        // Piers with cutwaters under the arch springings.
        if ((i % 3 === 0 && i > 0) || i % 3 === 2) b.box(m, 1.4, drop + 1.0, w + 1.2, x + ux * (i % 3 === 0 ? -1.3 : 1.3), bed - 1.2, z + uz * (i % 3 === 0 ? -1.3 : 1.3), ry);
      }
    }
  }
  b.absY = null;
}

// ---------------------------------------------------------------- the Iseum
/** Ruins of Domitian's temple of Isis: a podium, granite columns, obelisks, the Apis bull in the mud. */
export function iseum(b: Builder) {
  seed(88);
  ruin(b, 'block', 16, 2.0, 1.2, 0, -0.4, -11, 0, 0.5);
  ruin(b, 'block', 22, 1.6, 1.2, -8, -0.4, 0, Math.PI / 2, 0.6);
  ruin(b, 'block', 22, 2.2, 1.2, 8, -0.4, 0, Math.PI / 2, 0.7);
  b.box('slab', 15, 0.5, 20, 0, -0.35, 0, 0.02, false);
  for (let i = 0; i < 6; i++) column(b, -5 + (i % 3) * 5 + R(-0.2, 0.2), 0, -6 + Math.floor(i / 3) * 9, R(5, 7), 0.38, rand() < 0.6 ? R(0.25, 0.6) : 0, 'stone');
  for (let i = 0; i < 4; i++) fallenDrum(b, R(-6, 6), R(-8, 9), 0.38, R(1.2, 2.6), R(0, 3));
  // Obelisks of red granite: one tilted and half sunk, one broken across the floor.
  const ob = (h: number, x: number, z: number, rx: number, rz: number, ry: number, y: number) => b.geo('stone', new THREE.CylinderGeometry(0.42, 0.62, h, 4, 6), x, y + h / 2, z, ry, true, rx, rz);
  ob(6.5, -2.5, 6.5, 0.12, -0.18, Math.PI / 4 + 0.2, -1.8);
  ob(3.2, 3.8, 3.0, 0, Math.PI / 2 - 0.05, 0.6, -2.7);
  ob(2.4, 5.5, 4.7, 0.05, Math.PI / 2 + 0.08, 0.7, -2.7);
  b.geo('stone', new THREE.ConeGeometry(0.55, 0.9, 4), 6.9, 0.2, 5.6, 0.3, false, 0.4, 1.2);
  // The Apis bull, couchant, sunk to its belly; the sun-disc between its horns.
  const bx = 1.5, bz = -3, by = -0.35;
  b.geo('marble', new THREE.SphereGeometry(1, 16, 10).scale(1.25, 0.65, 0.55), bx, by + 0.45, bz, 0.3, false);
  b.geo('marble', new THREE.SphereGeometry(0.42, 12, 8).scale(1.2, 0.9, 0.8), bx + Math.cos(0.3) * 1.35, by + 0.85, bz - Math.sin(0.3) * 1.35, 0.3, false);
  for (const s of [-1, 1]) b.geo('marble', new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6), bx + Math.cos(0.3) * 1.3 + Math.sin(0.3) * s * 0.25, by + 1.25, bz - Math.sin(0.3) * 1.3 + Math.cos(0.3) * s * 0.25, 0.3, false, 0, s * 0.6);
  b.geo('bronze', new THREE.CylinderGeometry(0.28, 0.28, 0.06, 18), bx + Math.cos(0.3) * 1.25, by + 1.55, bz - Math.sin(0.3) * 1.25, 0.3 + Math.PI / 2, false, Math.PI / 2);
  // Pools of standing water among the slabs.
  hornLantern(b, -6.5, 1.4, -10.2);
  markReadable('obeliscus', -2.4, 1.5, 6.2);
  markReadable('apis', bx + 0.4, 0.9, bz + 0.9);
  markReadable('isisVipera', 7.7, 1.2, -1.0);
}

// ---------------------------------------------------------------- the Lombard cemetery
/** Graves in rows facing east; poles with wooden doves for the men who died far away (Paul the Deacon, HL V 34). */
export function necropolis(b: Builder) {
  seed(568);
  for (let r = 0; r < 7; r++) for (let k = 0; k < 9; k++) {
    if (rand() < 0.3) continue;
    const x = -18 + k * 4.2 + R(-0.6, 0.6), z = -14 + r * 4.4 + R(-0.6, 0.6), ry = Math.PI / 2 + R(-0.15, 0.15);
    const u = rand();
    if (u < 0.45) b.box('ground', 0.9, 0.35, 2.1, x, -0.15, z, ry);
    else if (u < 0.75) b.box('stone', 0.8, 0.14, 2.0, x, -0.04, z, ry, true, R(-0.05, 0.05));
    else { b.box('ground', 1.0, 0.25, 2.2, x, -0.1, z, ry); b.box('wood', 0.08, 1.0, 0.08, x - 1.0, -0.1, z, 0, false, R(-0.1, 0.1)); }
  }
  // The perticae: tall poles, each topped by a wooden dove facing where a man fell.
  for (let i = 0; i < 9; i++) {
    const x = -20 + R(0, 40), z = -18 + R(0, 34), h = R(4, 6.5), face = R(0, 6.28);
    b.box('wood', 0.14, h, 0.14, x, -0.6, z, R(0, 3), true, R(-0.04, 0.04), R(-0.04, 0.04));
    b.geo('wood', new THREE.SphereGeometry(0.16, 8, 6).scale(1.6, 0.8, 0.8), x, h - 0.45, z, face, false);
    b.box('wood', 0.12, 0.03, 0.62, x, h - 0.45, z, face, false);
    b.geo('wood', new THREE.ConeGeometry(0.06, 0.18, 6).rotateZ(-Math.PI / 2), x + Math.cos(face) * 0.3, h - 0.42, z - Math.sin(face) * 0.3, face, false);
    if (i === 3) markReadable('perticae', x + 0.3, 1.4, z);
  }
  lucerna(b, 2, 0.3, 1, 0);
}

// ---------------------------------------------------------------- the walnut by the Sabato
/** The stump of the sacred walnut, cut down at Barbatus' word (c. 663): sprouting still. */
export function nux(b: Builder) {
  seed(663);
  b.geo('wood', new THREE.CylinderGeometry(1.3, 1.7, 1.1, 16, 2), 0, 0.25, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + R(-0.2, 0.2);
    b.geo('wood', new THREE.CylinderGeometry(0.12, 0.35, 2.6, 6).rotateZ(Math.PI / 2 - 0.25), Math.cos(a) * 1.8, 0.1, Math.sin(a) * 1.8, -a, false);
  }
  for (let i = 0; i < 11; i++) {
    const a = R(0, 6.28), r = R(0.4, 1.1), h = R(0.8, 2.4);
    b.geo('wood', new THREE.CylinderGeometry(0.015, 0.04, h, 5), Math.cos(a) * r, 0.75 + h / 2, Math.sin(a) * r, 0, false, R(-0.3, 0.3), R(-0.3, 0.3));
  }
  // A ring of stones, old ash, a stake with a rotting goatskin.
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; b.box('stone', R(0.5, 0.8), R(0.35, 0.6), R(0.4, 0.6), Math.cos(a) * 5.2, -0.15, Math.sin(a) * 5.2, a); }
  b.box('ember', 1.0, 0.04, 1.0, 3.0, -0.02, -1.5, 0.3, false);
  b.box('wood', 0.1, 2.6, 0.1, -2.6, -0.4, 2.2, 0, true, 0.1, 0);
  b.box('cloth', 0.7, 0.9, 0.04, -2.6, 1.2, 2.25, 0.4, false, 0, 0.15);
  candle(b, 0.4, 0.8, 0.3, 0.2);
  markReadable('nux', 0.0, 1.0, 1.4);
}

// ---------------------------------------------------------------- the mill
/** A water mill on a leat off the Sabato: undershot wheel, two millstones inside. Door to local -z. */
export function molendinum(b: Builder) {
  seed(721);
  const W = 7, D = 5.4, H = 4.2, T = 0.6;
  b.box('rubble', W, H, T, 0, -0.4, D / 2 - T / 2);
  b.box('rubble', T, H, D, -W / 2 + T / 2, -0.4, 0);
  b.box('rubble', T, H, D, W / 2 - T / 2, -0.4, 0);
  b.geo('rubble', arcadeGeo(W, H, T, 1, 1.1, 1.6), 0.8, -0.4, -D / 2 + T / 2, 0);
  gable(b, W + 0.4, D + 0.4, 1.6, 0, H - 0.4, 0, 0, 'rubble', 0.45);
  // Millstones on a timber stage, hopper above, sacks.
  b.geo('stone', new THREE.CylinderGeometry(0.75, 0.75, 0.25, 20), -1, 0.7, 0.5, 0, true);
  b.geo('stone', new THREE.CylinderGeometry(0.75, 0.75, 0.22, 20), -1, 0.95, 0.5, 0, false);
  b.box('wood', 2.2, 0.55, 2.0, -1, -0.1, 0.5);
  b.geo('wood', new THREE.ConeGeometry(0.5, 0.7, 4, 1, true).rotateX(Math.PI), -1, 1.75, 0.5, 0.78, false);
  for (let i = 0; i < 5; i++) b.box('cloth', 0.5, 0.6, 0.4, 2.2, -0.05, -1.6 + i * 0.55, R(-0.3, 0.3));
  b.lamp('torch', V3(1.5, 0.5, 1.5), false, 'brazier', 0.45);
  // The leat and the wheel outside the east wall.
  b.box('rubble', 1.0, 1.4, 9, W / 2 + 1.6, -1.4, 0);
  b.box('rubble', 1.0, 1.4, 9, W / 2 + 3.8, -1.4, 0);
  const wheel = new THREE.TorusGeometry(1.7, 0.12, 6, 24);
  b.geo('wood', wheel, W / 2 + 2.7, 0.6, 0, Math.PI / 2, false);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box('wood', 0.5, 0.06, 0.35, W / 2 + 2.7, 0.6 + Math.sin(a) * 1.7 - 0.03, Math.cos(a) * 1.7, 0, false, 0, a);
  }
  b.box('wood', 2.2, 0.15, 0.15, W / 2 + 1.6, 0.6, 0, 0, false);
  markReadable('molendinum', 2.2, 0.9, -0.6);
}

// ---------------------------------------------------------------- the forum and its market
/** Market on the old forum: trestles under awnings among the columns of a temple (module coords of the old roman()). */
export function forumMarket(b: Builder) {
  seed(312);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + R(-0.2, 0.2), r = R(8, 13);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, ry = -a + Math.PI / 2;
    b.box('wood', 2.2, 0.08, 0.9, x, 0.82, z, ry, false);
    for (const s of [-1, 1]) b.box('wood', 0.08, 0.82, 0.8, x + Math.cos(ry) * s * 0.95, 0, z - Math.sin(ry) * s * 0.95, ry, false);
    for (const s of [-1, 1]) b.box('wood', 0.07, 2.2, 0.07, x + Math.cos(ry) * s * 1.1, 0, z - Math.sin(ry) * s * 1.1, ry, false);
    b.box('cloth', 2.5, 0.03, 1.5, x + Math.sin(ry) * 0.3, 2.15, z + Math.cos(ry) * 0.3, ry, false, -0.25);
    for (let k = 0; k < 3; k++) b.box(rand() < 0.5 ? 'clay' : 'wood', R(0.15, 0.3), R(0.12, 0.3), R(0.15, 0.3), x + R(-0.8, 0.8), 0.86, z + R(-0.3, 0.3), R(0, 3), false);
  }
  brazier(b, 0, 0);
  b.box('marble', 1.0, 1.3, 1.0, 4.5, -0.2, -3.5, 0.3);
  markReadable('genius', 4.5, 1.2, -2.9);
}

// ---------------------------------------------------------------- the dukes' orchard and the cistern under it
export const CISTERN = { x0: -1.0, x1: 1.0, top: 3.0, bottom: -4.2, depth: -5.2 };
/** The ground opening of the stair down (local rect: x0..x1 × z bottom..top). */
export function cisternHole(): [number, number][] { return [[CISTERN.x0, CISTERN.bottom], [CISTERN.x1, CISTERN.bottom], [CISTERN.x1, CISTERN.top], [CISTERN.x0, CISTERN.top]]; }
/**
 * Where Arechis would later raise S. Sofia: in 700 the dukes' orchard, and
 * under it a Roman cistern reached by a stair, its vault dripping.
 */
export function cisterna(b: Builder) {
  seed(760);
  const C = CISTERN, d = C.depth, w = C.x1 - C.x0;
  // Stair down toward -z: steps of 0.26 m.
  const n = Math.round(-d / 0.26);
  const run = (C.top - C.bottom) / n;
  for (let i = 0; i < n; i++) {
    const y = -(i + 1) * (-d / n);
    b.box('block', w, 0.3, run + 0.05, 0, y - 0.04, C.top - (i + 0.5) * run, 0, false);
  }
  // Walk on a ramp, as on every stair here.
  {
    const h = w / 2, t = C.top + 0.2, bo = C.bottom;
    const ramp = new THREE.BufferGeometry();
    ramp.setAttribute('position', new THREE.Float32BufferAttribute([-h, 0.02, t, h, 0.02, t, h, d + 0.05, bo, -h, 0.02, t, h, d + 0.05, bo, -h, d + 0.05, bo], 3));
    b.collide(ramp);
    const fl = new THREE.PlaneGeometry(w, 3, 1, 1).rotateX(-Math.PI / 2).translate(0, d + 0.02, C.bottom - 1.5);
    b.collide(fl);
  }
  const stairLen = C.top - C.bottom;
  // Stair walls going down.
  for (const s of [-1, 1]) b.box('rubble', 0.5, -d + 0.6, stairLen + 1, s * (w / 2 + 0.25), d - 0.3, (C.top + C.bottom) / 2, 0, true);
  // The cistern: a hall 12 x 6 m, two aisles of piers, barrel vaults, black water.
  const cz = C.bottom - 6.2, hw = 6, hl = 6;
  const floor = d;
  b.box('rubble', 2 * hw + 1, 0.5, 2 * hl + 1, 0, floor - 0.5, cz, 0, true);
  for (const s of [-1, 1]) b.box('rubble', 0.6, 5.0, 2 * hl + 1, s * (hw + 0.3), floor, cz, 0, true);
  b.box('rubble', 2 * hw, 5.0, 0.6, 0, floor, cz - hl - 0.3, 0, true);
  b.box('rubble', hw - w / 2 - 0.5, 5.0, 0.6, -(hw + w / 2 + 0.5) / 2, floor, cz + hl + 0.3, 0, true);
  b.box('rubble', hw - w / 2 - 0.5, 5.0, 0.6, (hw + w / 2 + 0.5) / 2, floor, cz + hl + 0.3, 0, true);
  b.box('rubble', w + 1, 5.0 + d + 0.5, 0.6, 0, floor + 2.6, cz + hl + 0.3, 0, true);
  for (const x of [-hw / 2, hw / 2]) vault(b, 'brick', 2 * hl + 0.6, hw / 2, x, floor + 2.6, cz, Math.PI / 2);
  for (let k = -1; k <= 1; k++) b.box('brick', 0.9, 2.6, 0.9, 0, floor, cz + k * 4, 0, true);
  b.box('rubble', 2 * hw + 1.2, 0.5, 2 * hl + 1.2, 0, floor + 2.6 + hw / 2, cz, 0, false);
  // Opus signinum floor under a skin of water at the far end.
  b.box('slab', 2 * hw - 0.4, 0.04, 2 * hl - 0.4, 0, floor, cz, 0, false);
  // A niche in the back wall: an empty serpent-shaped hollow in the plaster, a lamp.
  b.box('plaster', 1.4, 1.6, 0.1, -2, floor + 0.6, cz - hl + 0.05, 0, false);
  b.geo('iron', new THREE.TorusGeometry(0.3, 0.05, 6, 16, Math.PI * 1.6), -2, floor + 1.4, cz - hl + 0.12, 0, false);
  lucerna(b, -1.3, floor + 0.62, cz - hl + 0.4, 0, true);
  lucerna(b, 2.6, floor + 0.05, cz - 2, 0, true);
  b.lamp('oil', V3(0, floor + 0.3, C.bottom - 0.6), true);
  markReadable('cisterna', -2, floor + 1.2, cz - hl + 0.6);
  // Above: the orchard, a well-head over the stair, beehives, a bench.
  b.box('rubble', w + 1.2, 0.6, 0.4, 0, -0.2, C.top + 0.2, 0, true);
  for (const s of [-1, 1]) b.box('rubble', 0.4, 0.6, stairLen, s * (w / 2 + 0.2), -0.2, (C.top + C.bottom) / 2, 0, true);
  for (let i = 0; i < 4; i++) b.geo('wood', new THREE.ConeGeometry(0.35, 0.7, 10), 5 + i * 0.9, 0.35, 4, 0, false);
  b.box('wood', 2.2, 0.45, 0.4, -5, 0, 2, 0.3);
}

export { wellHead, placeProp, SITE, toLocalXZ, toWorldXZ, tiledGable, Acc };
