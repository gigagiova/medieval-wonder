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
// Torre della Catena; S. Ilario outside Porta Aurea; the bridges; the remains of
// the Iseum before the bishop's church; the Lombard cemetery with its poles; the stump
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

// Architectural model lives separately from the other monuments.
export { arcusTraiani } from './arcus-traiani';

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
// Built block by block in theatrum.ts.
export { theatrum } from './theatrum';

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
/**
 * What is left of Domitian's temple of Isis (AD 88) in AD 700, in the heart
 * of the town before the bishop's church: authored in the Episcopium's frame
 * (the church's atrium front is at z = -29.5, x -22…-9). The temple's podium
 * stumps out of the square with a house built on it; one obelisk lies broken
 * across the square, the other in pieces; two granite sphinxes have been set
 * up as guardians at the atrium gate; the Apis bull sinks in the mud at the
 * corner; a pharaoh's statue is walled into the house. See HISTORY.md §5.
 */
export function iseum(b: Builder) {
  seed(88);
  // The podium: walls of big blocks, its floor of slabs tilted and broken, a house on top.
  const px = -19, pz = -16, pw = 12, pd = 15;
  ruin(b, 'block', pw, 1.7, 1.1, px, -0.4, pz - pd / 2, 0, 0.35);
  ruin(b, 'block', pd, 1.4, 1.1, px - pw / 2, -0.4, pz, Math.PI / 2, 0.4);
  ruin(b, 'block', pd * 0.7, 1.9, 1.1, px + pw / 2, -0.4, pz + pd * 0.15, Math.PI / 2, 0.5);
  b.box('slab', pw - 1, 0.4, pd - 1, px, 0.9, pz, 0.02, true, 0.03, -0.02);
  // Steps up the front (south), half buried.
  for (let k = 0; k < 3; k++) b.box('block', 6.5 - k * 0.3, 0.3, 0.6, px + R(-0.1, 0.1), -0.3 + k * 0.3, pz + pd / 2 + 1.6 - k * 0.55, R(-0.03, 0.03));
  // Granite columns of the pronaos: two standing to their capitals, one snapped, drums in the mud.
  column(b, px - 2.4, 1.2, pz + pd / 2 - 1.2, R(5, 6), 0.38, 0, 'stone');
  column(b, px + 2.6, 1.2, pz + pd / 2 - 1.2, R(4.2, 5), 0.38, R(0.3, 0.5), 'stone');
  column(b, px - 2.4, 1.2, pz + pd / 2 - 4.6, R(2, 3), 0.36, R(0.5, 0.8), 'stone');
  for (let i = 0; i < 4; i++) fallenDrum(b, px + R(-4, 6), pz + pd / 2 + R(1, 6), 0.38, R(1.2, 2.4), R(0, 3));
  // A house built onto the back of the podium, of its own blocks.
  b.box('rubble', 6.5, 3.4, 5.0, px - 1.5, 1.1, pz - 4.5, 0.04);
  gable(b, 6.5, 5.0, 1.4, px - 1.5, 4.5, pz - 4.5, 0.04, 'rubble', 0.4);
  b.box('wood', 1.0, 1.9, 0.08, px - 1.2, 1.1, pz - 1.98, 0.04, false);
  // A granite pharaoh, headless, walled upright into the house's corner.
  b.box('stone', 0.75, 1.9, 0.55, px + 1.75, 1.1, pz - 2.05, 0.04, false);
  b.box('stone', 1.0, 0.3, 0.6, px + 1.75, 2.95, pz - 2.05, 0.04, false);
  // Obelisks of red granite: one lying broken across the square, the other in pieces.
  const ob = (h: number, x: number, z: number, rx: number, rz: number, ry: number, y: number) => b.geo('stone', new THREE.CylinderGeometry(0.4, 0.58, h, 4, 6), x, y + h / 2, z, ry, true, rx, rz);
  // (Lying pieces: the cylinder's centre sits at y + h/2, so lift y by -h/2 to lay them on the ground.)
  ob(4.8, -8.0, -19.5, Math.PI / 2 - 0.04, 0, 0.35, 0.25 - 2.4);
  ob(2.6, -6.4, -24.4, Math.PI / 2 + 0.06, 0, 0.35, 0.2 - 1.3);
  ob(2.2, -4.6, -12.2, 0.05, Math.PI / 2 + 0.08, 1.1, 0.2 - 1.1);
  b.geo('stone', new THREE.ConeGeometry(0.5, 0.85, 4), -5.2, 0.15, -27.0, 0.3, false, 0.4, 1.2);
  // Two sphinxes set up as guardians at the gate of the atrium.
  for (const sx of [-18.6, -13.4]) {
    const fz = -28.3;
    b.box('block', 1.0, 0.5, 2.2, sx, -0.3, fz + 0.2, 0);
    b.box('stone', 0.75, 0.62, 1.8, sx, 0.2, fz + 0.15, 0);
    b.box('stone', 0.62, 0.95, 0.6, sx, 0.4, fz + 0.95, 0);
    b.box('stone', 0.5, 0.55, 0.5, sx, 1.3, fz + 1.05, 0, false);
    b.geo('stone', new THREE.CylinderGeometry(0.1, 0.36, 0.55, 4), sx, 1.45, fz + 0.9, Math.PI / 4, false);
  }
  // Where the Apis bull lies, sunk to its belly at the corner of the square.
  const bx = -5.5, bz = -9.5;
  // (The bull itself is the scanned Apis among the spolia: src/benevento/spolia.ts.)
  // The relief of the Lady with the serpent at her brow, propped against the podium.
  b.box('marble', 1.1, 1.5, 0.22, px + pw / 2 + 0.75, -0.2, pz + 3.5, Math.PI / 2 - 0.2, false, 0.12);
  hornLantern(b, px - 4.6, 2.2, pz - 2.0);
  markReadable('obeliscus', -8.0, 0.8, -18.6);
  markReadable('apis', bx + 0.4, 0.9, bz + 0.9);
  markReadable('isisVipera', px + pw / 2 + 0.95, 0.9, pz + 3.5);
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
  // Roman columns stacked in the orchard by the duke's men: six granite and marble shafts, two set
  // upright to carry a vine, the rest lying in a rough ring. Sixty years on Arechis II will raise
  // S. Sophia here on a ring of six Roman columns (the plan is a star; the columns are spolia).
  const ring = (k: number) => [9 + Math.cos((k / 6) * Math.PI * 2) * 3.4, 9 + Math.sin((k / 6) * Math.PI * 2) * 3.4];
  for (let k = 0; k < 6; k++) {
    const [x, z] = ring(k), m: MatName = k % 2 ? 'marble' : 'stone';
    if (k === 1 || k === 4) column(b, x, -0.1, z, R(3.2, 3.8), 0.3, 0, m);
    else fallenDrum(b, x + R(-0.5, 0.5), z + R(-0.5, 0.5), 0.3, R(2.6, 3.6), (k / 6) * Math.PI * 2 + Math.PI / 2 + R(-0.3, 0.3));
  }
  { const [x1, z1] = ring(1), [x4, z4] = ring(4); b.box('wood', 0.16, 0.16, Math.hypot(x4 - x1, z4 - z1), (x1 + x4) / 2, 3.35, (z1 + z4) / 2, Math.atan2(x4 - x1, z4 - z1), false); }
  markReadable('sophia', 9, 1.0, 9 - 3.4 + 0.9);
}


// ---------------------------------------------------------------- the castellum aquae (where the Rocca will stand)
/**
 * The Roman water-castle on the height outside Porta Summa, where the
 * aqueduct from the Serino reached the town: a brick-faced hall of two
 * barrel vaults over a cistern (enterable through a broken arch; water
 * still stands in it), the distribution tank on its roof, and the last
 * arches of the aqueduct coming in from the east, two of them fallen. On
 * the roof the Lombards keep a timber watch platform over the Via Summa.
 * The papal rectors' Rocca (1321) and the Lombard Torrione (871/875) will
 * stand here; the Benedictine nuns come later in the 8th century.
 * Frame: the hall's long axis along local x, its door on local +z.
 */
export function castellumAquae(b: Builder) {
  seed(1321);
  const L = 16, W = 11, H = 6.6, T = 1.1;
  // Long walls: the front (+z) with three arches, one open, two walled up with rubble.
  b.geo('brick', arcadeGeo(L, H, T, 3, 2.6, 2.6), 0, -0.3, W / 2, 0);
  for (const k of [-1, 0, 1]) archRings(b, 'brick', k * L / 3, -0.3, W / 2, 0, T, 2.6, 2.6, 0.45, 0.24);
  b.geo('rubble', arcadeGeo(2.7, 3.9, 0.5, 1, 0.7, 2.6), 0, -0.3, W / 2 - 0.2, 0);
  b.geo('rubble', arcadeGeo(2.7, 3.9, 0.5, 1, 0.8, 1.2), L / 3, -0.3, W / 2 - 0.2, 0);
  b.box('brick', L, H, T, 0, -0.3, -W / 2, 0);
  for (const s of [-1, 1]) b.box('brick', T, H, W, s * (L / 2 - T / 2), -0.3, 0, 0);
  // Buttresses on the downhill side.
  for (const x of [-5.5, 0.6, 5.5]) b.box('rubble', 1.6, 4.5, 1.2, x, -0.3, -W / 2 - T / 2 - 0.55, 0);
  // Inside: a row of piers down the middle, two barrel vaults, standing water.
  for (let k = -1; k <= 1; k++) b.box('brick', 1.0, 3.4, 1.0, k * 4.6, -0.3, 0, 0);
  for (const z of [-W / 4 + 0.25, W / 4 - 0.25]) vault(b, 'brick', L - 2 * T, W / 4 - 0.25, 0, 3.1, z, 0);
  b.box('slab', L - 2 * T, 0.06, W - 2 * T, 0, -0.32, 0, 0, true);
  b.box('ground', L - 2 * T - 0.4, 0.04, W / 2 - T - 0.6, 0, -0.27, -W / 4, 0, false);
  // A channel along the back wall: the water still comes in a trickle.
  b.box('slab', L - 2 * T, 0.3, 0.6, 0, -0.32, -W / 2 + T + 0.35, 0, false);
  // The roof: the distribution tank, its rim broken; a mantle of earth and grass.
  b.box('rubble', L, 0.7, W, 0, H - 0.6, 0, 0);
  for (const [x, z, l, ry] of [[0, -W / 2 + 0.3, L, 0], [-L / 2 + 0.3, 0, W, Math.PI / 2], [L / 2 - 0.3, 0, W, Math.PI / 2]] as const) ruin(b, 'brick', l, R(0.6, 1.2), 0.55, x, H + 0.1, z, ry, 0.8);
  ruin(b, 'brick', L * 0.55, R(0.4, 1.0), 0.55, -L * 0.2, H + 0.1, W / 2 - 0.3, 0, 0.9);
  // The Lombard watch platform on the roof's east corner: posts, planks, a rail, a ladder.
  const px = -L / 2 + 2.4, pz = -W / 2 + 2.4;
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [1.3, 1.3], [-1.3, 1.3]]) b.box('wood', 0.22, 4.2, 0.22, px + dx, H + 0.1, pz + dz, 0, true, R(-0.03, 0.03), R(-0.03, 0.03));
  b.box('wood', 3.0, 0.14, 3.0, px, H + 2.6, pz, 0.05, true);
  for (const s of [-1, 1]) {
    b.box('wood', 3.0, 0.1, 0.1, px, H + 3.5, pz + s * 1.45, 0.05, false);
    b.box('wood', 0.1, 0.1, 3.0, px + s * 1.45, H + 3.5, pz, 0.05, false);
  }
  gable(b, 3.2, 3.2, 0.9, px, H + 4.3, pz, 0.05, 'wood', 0.3);
  // A cleated plank up to it from the roof.
  b.box('wood', Math.hypot(4, 2.64), 0.1, 0.9, px + 3.3, H + 0.1 + 1.32 - 0.05, pz, 0, true, 0, -Math.atan2(2.64, 4));
  for (let i = 1; i < 7; i++) b.box('wood', 0.06, 0.05, 0.85, px + 5.3 - i * 0.57, H + 0.1 + i * 0.377, pz, 0, false);
  // A stair of reused blocks up the far end to the roof, walkable as a ramp.
  for (let i = 0; i < 12; i++) b.box('block', 1.3, 0.55, 0.9, L / 2 + 1.0, -0.3 + i * 0.55, W / 2 - 1.0 - i * 0.82, 0, false);
  {
    const x0 = L / 2 + 0.35, x1 = L / 2 + 1.65, z0 = W / 2 - 0.5, z1 = W / 2 - 0.5 - 12 * 0.82, y1 = H + 0.1;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, y1, z1, x0, 0, z0, x1, y1, z1, x0, y1, z1], 3));
    b.collide(g);
  }
  
  // The aqueduct from the Serino coming in from the east (local -x) on arches; two have fallen.
  const n = 6, span = 4.2, pier = 1.5;
  for (let i = 0; i < n; i++) {
    const x = -(L / 2 + 1.5 + pier / 2 + span / 2 + i * (span + pier));
    const hy = H + 0.4 - i * 0.12;
    if (i === 3 || i === 4) {
      ruin(b, 'brick', span + pier, R(1, 2.5), 2.2, x, -0.3, 0, 0, 0.9);
      for (let k = 0; k < 4; k++) b.box('brick', R(0.8, 1.6), R(0.5, 0.9), R(0.8, 1.6), x + R(-2, 2), -0.3, R(-3, 3), R(0, 3));
      continue;
    }
    b.geo('brick', arcadeGeo(span + pier, hy, 2.2, 1, span, hy - span / 2 - 1.3), x, -0.3, 0, 0);
    archRings(b, 'brick', x, -0.3, 0, 0, 2.2, span, hy - span / 2 - 1.3, 0.5, 0.36);
    // The specus on top, its cover slabs gone in places.
    b.box('rubble', span + pier, 1.0, 1.8, x, hy - 0.3, 0, 0, false);
    if (rand() < 0.6) b.box('slab', span + pier - 0.3, 0.2, 1.9, x, hy + 0.7, 0, 0, false);
  }
  // Tombs of the old cemetery on the slope, a spring trough by the door.
  for (let k = 0; k < 4; k++) b.box('block', R(1.8, 2.4), R(0.6, 0.9), R(0.9, 1.2), R(4, 12), -0.4, R(9, 15), R(-0.3, 0.3));
  b.box('stone', 2.2, 0.7, 0.9, 3.5, -0.3, W / 2 + 1.6, 0.05);
  torch(b, -L / 3 - 1.6, 2.6, W / 2 + T / 2 + 0.1, 0);
  lucerna(b, -2, 0.1, 2.2, 0, false);
  torch(b, px + 1.3, H + 3.2, pz + 1.45, 0);
  markReadable('castellum', -L / 3, 1.5, W / 2 + 0.7);
  markReadable('rocca', px, H + 3.1, pz + 1.4);
}

export { wellHead, placeProp, SITE, toLocalXZ, toWorldXZ, tiledGable, Acc };

// ---------------------------------------------------------------- ad Caballum
/**
 * The place "ad Caballum" before the dukes' curtis: a small square named after a Roman equestrian
 * statue still on its base (two fragments of an equestrian monument came out of Piazza Piano di
 * Corte in 1920 and are in the Museo del Sannio's depot), and on its east side the little church of
 * S. Petrus ad Caballum: a hall with one apse under two domes in a row, the type of S. Ilario a
 * Port'Aurea, of which Bertelli (1992) calls the two the southern prototypes; later turned into a
 * house. Graves round it. See docs/benevento/HISTORY.md §5 "Ad Caballum".
 * Local frame: x east, z south; the statue at (-4, -2), the church's west door at x = 1.4.
 */
export const CABALLUM = { statue: [-4, -2] as [number, number], church: { x: 7.4, z: 3.0, L: 12.0, W: 7.0 } };

/** A limb from p to q (local, y above the ground), radius r0 at p and r1 at q. */
function limb(b: Builder, m: MatName, p: THREE.Vector3, q: THREE.Vector3, r0: number, r1: number, seg = 10, collide = false) {
  const d = q.clone().sub(p), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
  const c = p.clone().add(q).multiplyScalar(0.5);
  b.geo(m, g, c.x, c.y, c.z, 0, collide);
}
/** An ellipsoid with semi-axes (a, bb, c) at p, turned by ry about y and rz about z. */
function blob(b: Builder, m: MatName, p: THREE.Vector3, a: number, bb: number, c: number, rz = 0, ry = 0, seg = 14) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.6)));
  g.scale(a, bb, c);
  b.geo(m, g, p.x, p.y, p.z, ry, false, 0, rz);
}

export function adCaballum(b: Builder) {
  seed(742);
  const [sx, sz] = CABALLUM.statue;
  // ---- the statue: a Roman horse with its rider broken off at the waist, on a pedestal of reused
  // blocks. Over life size, as these monuments were (horse ~2.4 m long).
  const m: MatName = 'marble';
  // Pedestal: footing, die, crowning moulding; the die's face once carried the dedication.
  b.box('bigstone', 3.6, 0.45, 2.0, sx, -0.25, sz, 0);
  b.box(m, 3.1, 1.55, 1.5, sx, 0.2, sz, 0);
  b.box(m, 3.4, 0.28, 1.75, sx, 1.75, sz, 0);
  b.box('slab', 1.6, 0.6, 0.06, sx, 0.65, sz + 0.77, 0, false);
  const top = 2.03;
  const P = (x: number, y: number, z = 0) => V3(sx + x, top + y, sz + z);
  // Horse, walking to the east (+x), the near foreleg lifted, as the classic equestrian statue.
  blob(b, m, P(0, 1.38), 1.05, 0.48, 0.42, 0, 0, 18);           // barrel
  blob(b, m, P(0.78, 1.45), 0.48, 0.5, 0.4, 0.2);                // chest and shoulders
  blob(b, m, P(-0.78, 1.42), 0.5, 0.48, 0.41, -0.1);             // haunches
  limb(b, m, P(0.95, 1.6), P(1.38, 2.3), 0.3, 0.19, 12);          // neck
  blob(b, m, P(1.32, 2.33), 0.2, 0.17, 0.12, 0.6);               // crest/poll
  limb(b, m, P(1.4, 2.32), P(1.82, 1.98), 0.15, 0.09, 10);        // head, muzzle down
  for (const s of [-1, 1]) limb(b, m, P(1.42, 2.42, s * 0.07), P(1.4, 2.6, s * 0.08), 0.04, 0.01, 5); // ears
  // Legs: hind pair and the far foreleg on the plinth; the near foreleg raised and broken at the knee.
  const leg = (x: number, z: number, kneeDx: number) => {
    limb(b, m, P(x, 1.12, z), P(x + kneeDx, 0.55, z), 0.13, 0.09, 8);
    limb(b, m, P(x + kneeDx, 0.55, z), P(x + kneeDx * 0.6, 0.05, z), 0.08, 0.07, 8);
    blob(b, m, P(x + kneeDx * 0.6, 0.06, z), 0.1, 0.07, 0.09);
  };
  leg(-0.9, 0.2, -0.08); leg(-0.85, -0.2, 0.05); leg(0.85, -0.2, 0.04);
  limb(b, m, P(0.88, 1.15, 0.2), P(1.18, 0.75, 0.2), 0.13, 0.09, 8);  // the lifted near foreleg, stump
  limb(b, m, P(-1.05, 1.5), P(-1.25, 0.75, 0.04), 0.11, 0.05, 8);     // tail
  // The rider: thighs along the flanks and the hips; above the waist only a rough break.
  for (const s of [-1, 1]) limb(b, m, P(0.05, 1.86, s * 0.3), P(0.35, 1.3, s * 0.43), 0.13, 0.09, 8);
  blob(b, m, P(-0.02, 2.0), 0.32, 0.26, 0.3);
  b.geo('rubble', new THREE.DodecahedronGeometry(0.24, 0), sx - 0.02, top + 2.2, sz, 0.4, false);
  // A cloak's edge falling over the horse's quarters.
  b.box(m, 0.55, 0.06, 0.7, sx - 0.5, top + 1.86, sz, 0, false, 0, 0.35);
  // The pieces that have fallen: the rider's arm and a hoof in the weeds by the base.
  fallenDrum(b, sx + 2.4, sz + 1.4, 0.12, 0.8, 0.7);
  b.box(m, 0.35, 0.22, 0.3, sx - 2.1, -0.1, sz + 1.3, 0.4, false);
  markReadable('caballus', sx, 1.2, sz + 1.1);
  // Old paving slabs round the base, many lifted.
  for (let i = 0; i < 26; i++) {
    const x = sx + R(-5, 5), z = sz + R(-4, 4);
    if (Math.abs(x - sx) < 2.0 && Math.abs(z - sz) < 1.2) continue;
    b.box('slab', R(0.9, 1.5), 0.14, R(0.6, 1.1), x, -0.1, z, R(-0.15, 0.15), false, R(-0.03, 0.03), R(-0.03, 0.03));
  }

  // ---- S. Petrus ad Caballum: a small hall with one apse under two domes in a row, of the town's
  // walling (rubble and river stones with Roman brick), Roman stones built in.
  const { x: cx, z: cz, L, W } = CABALLUM.church, T = 0.8, H = 5.4;
  const rub: MatName = 'rubble';
  b.geo(rub, arcadeGeo(W, H, T, 1, 1.0, 2.4), cx - L / 2 + T / 2, -0.3, cz, Math.PI / 2);
  archRings(b, 'brick', cx - L / 2 + T / 2, -0.3, cz, Math.PI / 2, T, 1.0, 2.4, 0.36, 0.075);
  b.box(rub, L, H, T, cx, -0.3, cz - W / 2 + T / 2);
  b.box(rub, L, H, T, cx, -0.3, cz + W / 2 - T / 2);
  b.geo(rub, arcadeGeo(W, H, T, 1, 3.0, 3.0), cx + L / 2 - T / 2, -0.3, cz, Math.PI / 2);
  // A Roman inscription reused upside down as the lintel stone over the door, a column drum each side.
  b.box('marble', 1.7, 0.42, 0.25, cx - L / 2 - 0.05, 2.75, cz, Math.PI / 2, false);
  for (const s of [-1, 1]) column(b, cx - L / 2 - 0.45, -0.2, cz + s * 1.15, 1.9, 0.2);
  // Apse.
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    b.box('brick', 0.95, 4.4, 0.65, cx + L / 2 + Math.cos(a) * 2.0, -0.3, cz + Math.sin(a) * 2.0, -a + Math.PI / 2);
  }
  b.geo('roof', new THREE.ConeGeometry(2.7, 1.3, 14, 1, false, 0, Math.PI), cx + L / 2, 4.75, cz, Math.PI / 2, false);
  // Two bays, domes inside, square drums (tiburia) with pyramid roofs outside, the east one higher.
  for (const [dx, th] of [[-2.9, 2.6], [2.9, 3.3]] as const) {
    const g = new THREE.SphereGeometry(2.7, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    b.geo('plaster', inward(g), cx + dx, H - 0.6, cz, 0, false);
    b.box(rub, 6.0, th, 6.0, cx + dx, H - 0.3, cz, 0);
    pyramidRoof(b, 6.5, 1.7, cx + dx, H - 0.3 + th, cz);
    // A slit window in each free side of the drum.
    for (const s of [-1, 1]) b.box('iron', 0.3, 0.8, 0.25, cx + dx, H + th * 0.35, cz + s * 3.0, 0, false);
  }
  // The transverse arch between the bays, on pilasters.
  b.box(rub, 0.8, 1.1, W - 2 * T, cx, H - 0.6, cz, 0, false);
  b.box(rub, 0.8, H - 0.6, 0.6, cx, -0.3, cz - W / 2 + T + 0.3);
  b.box(rub, 0.8, H - 0.6, 0.6, cx, -0.3, cz + W / 2 - T - 0.3);
  // Altar of a Roman altar stone, candles; a lamp at the door.
  b.box('marble', 1.2, 0.95, 0.75, cx + L / 2 - 1.0, -0.2, cz);
  candle(b, cx + L / 2 - 1.0, 0.75, cz - 0.28, 0.38); candle(b, cx + L / 2 - 1.0, 0.75, cz + 0.25, 0.33);
  lucerna(b, cx - L / 2 + 1.3, 1.4, cz + W / 2 - T - 0.1, Math.PI);
  markReadable('petrusCaballi', cx + L / 2 - 1.0, 1.1, cz);
  // The little cemetery on the church's north and south sides: earth mounds, slabs, a Roman sarcophagus.
  for (let i = 0; i < 12; i++) {
    const x = R(cx - L / 2, cx + L / 2 + 1.5), z = cz + (rand() < 0.5 ? -1 : 1) * R(W / 2 + 1.0, W / 2 + 4.2);
    if (rand() < 0.5) b.box('ground', 0.8, 0.28, 1.9, x, -0.1, z, R(-0.25, 0.25) + Math.PI / 2);
    else b.box('stone', 0.7, 0.15, 1.8, x, -0.05, z, R(-0.25, 0.25) + Math.PI / 2, true, R(-0.05, 0.05));
  }
  b.box('marble', 2.1, 0.75, 0.8, cx + 2.5, -0.1, cz - W / 2 - 1.6, 0.05);
  b.box('marble', 2.2, 0.2, 0.9, cx + 2.5, 0.62, cz - W / 2 - 1.6, 0.08, false);
  // A low wall of the churchyard on the square's side, with a gap.
  for (const [z0, z1] of [[cz - W / 2 - 4.6, cz - 1.6], [cz + 1.6, cz + W / 2 + 4.6]]) b.box(rub, 0.5, 1.0, z1 - z0, cx - L / 2 - 1.6, -0.2, (z0 + z1) / 2, 0);
  placeProp(null, 'nettle_plant', cx - L / 2 - 1.3, 0, cz - W / 2 - 2, 0.4, 3);
  placeProp(null, 'weed_plant_02', sx + 1.4, 0, sz - 1.2, 1.1, 3);
  placeProp(null, 'weed_plant_02', sx - 1.6, 0, sz + 1.0, 2.1, 2.6);
}
