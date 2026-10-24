import * as THREE from 'three';
import { Builder, rng } from './builder';
import type { MatName } from './materials';
import { arcadeGeo, arcade, ruinGeo, ruin, column, fallenDrum, gable, leanTo, pyramidRoof } from './shapes';
import { torch, brazier, hornLantern, bracketLantern, lucerna, polykandelon, candle } from './lights';
import { layoutTown, lotsFor, buildHouse, buildBridges, townTexture, type Town } from './town';
import { setGroundExtra } from './displace';
import { buildCatacombs, CATACOMB_SPOTS } from './catacombs';
import { buildForest, treeSpots } from './forest';
import { buildBaths, BATHS_SPOT } from './baths';
import { buildPalace, PALACE_SPOT } from './palace';
import { terrain } from './displace';

// A Lombard town around AD 750, packed inside what is left of a Roman circuit.
// Houses of river cobble and reused brick stand wall to wall along crooked
// alleys, rooms bridge the alleys on arches; the old forum is a quarry of
// columns with houses built into the temple. In the north-west, an abbey:
// an early-Christian basilica with its atrium, an ossuary chapel over the
// catacombs. No campanili, no crenellations, no cloister arcades yet: those
// belong to later centuries.

const rand = rng(1327);
const R = (a: number, b: number) => a + (b - a) * rand();

const STAIR_X = -36, STAIR_W = 3, STAIR_TOP = -52, HOLE_END = -56;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const V = (x: number, z: number) => new THREE.Vector2(x, z);

// The Roman circuit: irregular, bulging north-west where the abbey is.
const WALL: THREE.Vector2[] = (() => {
  const pts: THREE.Vector2[] = [];
  const n = 15;
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2 + R(-0.12, 0.12);
    let dth = th - 3.72;
    while (dth > Math.PI) dth -= Math.PI * 2;
    while (dth < -Math.PI) dth += Math.PI * 2;
    const r = 66 + 17 * Math.exp(-(dth * dth) / 0.55) + R(-5, 5);
    pts.push(V(r * Math.sin(th), r * Math.cos(th)));
  }
  return pts;
})();
export const WALL_R = 70;

/** Where the ray at angle th from the centre crosses the wall. */
function wallAt(th: number) {
  const d = V(Math.sin(th), Math.cos(th));
  for (let k = 0; k < WALL.length; k++) {
    const a = WALL[k], b = WALL[(k + 1) % WALL.length];
    const e = b.clone().sub(a);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-6) continue;
    const t = (a.x * e.y - a.y * e.x) / den;
    const u = (a.x * d.y - a.y * d.x) / den;
    if (t > 0 && u >= 0 && u <= 1) return { p: d.multiplyScalar(t), k, u };
  }
  throw new Error('wall');
}
const GATE = wallAt(0.06);
const EAST = wallAt(1.62);
// A postern in the north wall, right above the crypt.
const NORTH = wallAt(Math.atan2(-20.3, -93.1));
export const SPAWN = new THREE.Vector3(GATE.p.x + 1.5, 3, GATE.p.y + 30);

let town: Town;
const mapMarks = { trees: [] as THREE.Vector2[], tombs: [] as THREE.Vector2[], aqueduct: [] as THREE.Vector2[], arch: V(0, 0) };

export interface Teleport { name: string; x: number; y: number; z: number; yaw: number }
/** Places the map can send you to. y is eye height (above ground ones are dropped in from a little higher). */
export function getTeleports(): Teleport[] {
  const above = (name: string, x: number, z: number, lookX: number, lookZ: number): Teleport =>
    ({ name, x, z, y: terrain(x, z) + 2.2, yaw: Math.atan2(-(lookX - x), -(lookZ - z)) });
  const out = GATE.p.clone().normalize();
  const lane = town.streets[0].pts;
  const mid = lane[Math.floor(lane.length * 0.55)];
  const cs = CATACOMB_SPOTS;
  return [
    above('Porta', GATE.p.x + out.x * 9, GATE.p.y + out.y * 9, GATE.p.x, GATE.p.y),
    above('Via Sepulcrorum', GATE.p.x + out.x * 32, GATE.p.y + out.y * 32, GATE.p.x, GATE.p.y),
    above('Arcus', mapMarks.arch.x, mapMarks.arch.y + 4, mapMarks.arch.x, mapMarks.arch.y - 10),
    above('Civitas', mid.x, mid.y, lane[Math.floor(lane.length * 0.55) + 1].x, lane[Math.floor(lane.length * 0.55) + 1].y),
    above('Templum', 18.5, 21.5, 21, 6),
    above('Atrium', -15.5, -31, -17, -45),
    above('Basilica', -17.6, -45, -17, -62),
    above('Bibliotheca', -12.6, -50, -7, -50),
    above('Ossuarium', -36, -50.2, -36, -56),
    { name: 'Catacumbae', x: cs.stairBottom.x, y: cs.stairBottom.y + 0.2, z: cs.stairBottom.z, yaw: 0 },
    { name: 'Crypta', x: cs.crypt.x, y: cs.crypt.y + 0.2, z: cs.crypt.z, yaw: 0.9 },
    above('Aquaeductus', 92, -66, 140, -100),
    above('Palatium', PALACE_SPOT.x, PALACE_SPOT.z, PALACE_SPOT.x, PALACE_SPOT.z - 10),
    { name: 'Thermae', x: BATHS_SPOT.x, z: BATHS_SPOT.z, y: terrain(BATHS_SPOT.x, BATHS_SPOT.z) + 1.4 + 2.2, yaw: BATHS_SPOT.yaw },
    above('Porta Septentrionalis', NORTH.p.x - 0.5, NORTH.p.y - 6, -20.3, -93.1),
  ];
}

/** Everything the map needs: the town raster, the wall, streets, landmarks, surroundings. */
export function getMapData() {
  return {
    grid: town.grid, n: Math.round(Math.sqrt(town.grid.length)), min: -100, res: 0.5,
    codes: { free: 0, street: 1, reserved: 2, house: 3, outside: 4 },
    wall: WALL, gate: GATE.p.clone(), eastGate: EAST.p.clone(), northGate: NORTH.p.clone(),
    streets: town.streets.map((s) => ({ pts: s.pts, w: s.w, main: s.main })),
    landmarks: [
      { name: 'Porta', x: GATE.p.x, z: GATE.p.y },
      { name: 'Porta Septentrionalis', x: NORTH.p.x, z: NORTH.p.y },
      { name: 'Cella Memoriae', x: -20.3, z: -93.1 },
      { name: 'Thermae', x: -33, z: 24 },
      { name: 'Palatium', x: 40, z: -23 },
      { name: 'Basilica', x: -17.3, z: -53 },
      { name: 'Atrium', x: -16, z: -35 },
      { name: 'Ossuarium', x: -36, z: -54.5 },
      { name: 'Templum', x: 21, z: 6 },
      { name: 'Arcus', x: mapMarks.arch.x, z: mapMarks.arch.y },
    ],
    trees: mapMarks.trees, tombs: mapMarks.tombs, aqueduct: mapMarks.aqueduct,
    teleports: getTeleports(),
  };
}
/** The main lane, gate to abbey, as a polyline (for the monk's round). */
export const mainLane = () => town.streets[0].pts;

export function buildWorld(scene: THREE.Scene) {
  const b = new Builder();
  const abbey = [V(-49, -71), V(-30, -76), V(-8, -72), V(-3, -52), V(-6, -29), V(-24, -26), V(-41, -33), V(-50, -48)];
  // Sites for the Roman baths (west) and the gastald's palace (east).
  const thermae = [V(-48, 12), V(-18, 12), V(-18, 36), V(-48, 36)];
  const palatium = [V(28, -36), V(52, -36), V(52, -10), V(28, -10)];
  const temple = [V(12, -3), V(27, -6), V(30, 15), V(15, 18)];
  town = layoutTown(WALL, [abbey, temple, thermae, palatium], GATE.p.clone().multiplyScalar(0.985), V(-15.5, -27.5), EAST.p.clone().multiplyScalar(0.985),
    V(-16.2, 29.5), [[39.5, -6.5, 3.6], [NORTH.p.x * 0.96, NORTH.p.y * 0.96, 2.4]]);
  setGroundExtra((x, z) => town.gutterAt(x, z));
  ground(b);
  townWall(b);
  for (const lot of lotsFor(town)) buildHouse(b, lot);
  buildBridges(b, town);
  roman(b);
  monastery(b);
  buildCatacombs(b);
  buildBaths(b, scene);
  buildPalace(b, scene);
  outskirts(b);
  // The wood: dense, old and dead, right up to a cleared strip along the wall.
  const insideWall = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = WALL.length - 1; i < WALL.length; j = i++) {
      const a = WALL[i], bb = WALL[j];
      if ((a.y > z) !== (bb.y > z) && x < ((bb.x - a.x) * (z - a.y)) / (bb.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const [a0, a1] = mapMarks.aqueduct;
  const keepOut = (x: number, z: number) => {
    if (Math.hypot(x - GATE.p.x, z - GATE.p.y) < 20) return true;
    if (Math.hypot(x + 20.3, z + 93.1) < 9) return true;
    {
      const ab = new THREE.Vector2(-20.3 - NORTH.p.x, -93.1 - NORTH.p.y), ap = new THREE.Vector2(x - NORTH.p.x, z - NORTH.p.y);
      const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
      if (ap.sub(ab.multiplyScalar(t)).length() < 4.5) return true;
    }
    if (z > GATE.p.y && Math.abs(x - GATE.p.x - Math.sin(z * 0.05) * 2) < 16) return true;
    const ab = a1.clone().sub(a0), ap = new THREE.Vector2(x - a0.x, z - a0.y);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
    return ap.sub(ab.multiplyScalar(t)).length() < 6;
  };
  buildForest(scene, b, { inside: insideWall, keepOut });
  mapMarks.trees.push(...treeSpots);
  const { collider, cells } = b.build(scene);
  return { collider, cells, lamps: b.lamps, flames: b.flames, props: b.props, townTex: townTexture(town) };
}

// ---------------------------------------------------------------- town wall

/** Late-Roman curtain, decayed: brick below, Lombard rubble patching above, broken tops. */
function townWall(b: Builder) {
  const T = 2.4;
  for (let k = 0; k < WALL.length; k++) {
    const a = WALL[k], c = WALL[(k + 1) % WALL.length];
    const pieces: [THREE.Vector2, THREE.Vector2][] = [];
    const gaps = [GATE, EAST, NORTH].filter((g) => g.k === k);
    if (gaps.length) {
      const g = gaps[0];
      const gp = a.clone().lerp(c, g.u);
      const dir = c.clone().sub(a).normalize();
      const half = g === GATE ? 2.6 : 1.6;
      pieces.push([a, gp.clone().addScaledVector(dir, -half)], [gp.clone().addScaledVector(dir, half), c]);
      gateway(b, gp, dir, g === GATE);
    } else pieces.push([a, c]);
    for (const [p, q] of pieces) {
      const L = p.distanceTo(q);
      if (L < 0.5) continue;
      const mid = p.clone().add(q).multiplyScalar(0.5);
      const ry = Math.atan2(q.x - p.x, q.y - p.y) - Math.PI / 2;
      const h = R(6.5, 9.5);
      if (rand() < 0.3) {
        ruin(b, 'brick', L + 0.8, h * R(0.5, 0.8), T, mid.x, -0.6, mid.y, ry, 0.6);
      } else {
        ruin(b, 'brick', L + 0.8, h - 2.5, T, mid.x, -0.6, mid.y, ry, 0.12);
        ruin(b, 'rubble', L + 0.6, R(1.5, 3), T - 0.3, mid.x, h - 3.3, mid.y, ry, 0.7);
      }
    }
  }
  // Towers at some corners: Roman square and half-round, all decayed, a few
  // re-roofed and lived in.
  WALL.forEach((p, k) => {
    if (rand() < 0.3) return;
    const o = p.clone().normalize();
    const kind = rand();
    const h = R(8, 12.5);
    if (kind < 0.45) {
      const ry = Math.atan2(o.x, o.y) + R(-0.1, 0.1);
      b.box('brick', R(5, 6.5), h, R(5, 6.5), p.x + o.x * 1.8, -0.6, p.y + o.y * 1.8, ry);
      if (rand() < 0.5) pyramidRoof(b, 6.6, 1.6, p.x + o.x * 1.8, h - 0.6, p.y + o.y * 1.8);
      else ruin(b, 'rubble', 6, 2.2, 6, p.x + o.x * 1.8, h - 0.7, p.y + o.y * 1.8, ry, 0.8);
    } else if (kind < 0.8) {
      const r = R(3.2, 4.2);
      b.geo('brick', new THREE.CylinderGeometry(r, r * 1.05, h, 26, 1), p.x + o.x * 2, h / 2 - 0.6, p.y + o.y * 2);
      ruin(b, 'rubble', r * 1.6, 2, r * 1.6, p.x + o.x * 2, h - 0.7, p.y + o.y * 2, R(0, 3), 0.9);
    } else {
      b.geo('brick', new THREE.CylinderGeometry(3.6, 4.0, R(2, 4), 20, 1), p.x + o.x * 2, 0.8, p.y + o.y * 2);
    }
    if (k % 5 === 2) torch(b, p.x - o.x * 1.5, 3.2, p.y - o.y * 1.5, Math.atan2(-o.x, -o.y));
  });
}

/** An arched gate in the curtain; one side keeps its tower, the other is a stump. */
function gateway(b: Builder, p: THREE.Vector2, dir: THREE.Vector2, main: boolean) {
  const ry = Math.atan2(dir.x, dir.y) - Math.PI / 2 + Math.PI / 2;
  const span = main ? 5.2 : 3.2;
  const out = V(dir.y, -dir.x);
  const sgn = out.dot(p) > 0 ? 1 : -1;
  out.multiplyScalar(sgn);
  b.geo('brick', arcadeGeo(span + 1.6, main ? 9 : 6.5, 2.8, 1, main ? 3.9 : 2.4, main ? 3.6 : 2.4), p.x, -0.6, p.y, Math.atan2(-dir.y, dir.x));
  if (main) {
    const tp = p.clone().addScaledVector(dir, 5.5).addScaledVector(out, 1.4);
    b.box('brick', 6, 12, 6.4, tp.x, -0.6, tp.y, ry + 0.05);
    pyramidRoof(b, 6.8, 1.8, tp.x, 11.3, tp.y);
    const sp = p.clone().addScaledVector(dir, -5.2).addScaledVector(out, 1.6);
    ruin(b, 'brick', 6, 5.5, 5.8, sp.x, -0.6, sp.y, ry - 0.07, 0.7);
    const bp = p.clone().addScaledVector(out, 6.5).addScaledVector(dir, 2.6);
    brazier(b, bp.x, bp.y);
    const tq = p.clone().addScaledVector(out, 1.5).addScaledVector(dir, -2.1);
    torch(b, tq.x, 3.2, tq.y, Math.atan2(out.x, out.y));
  }
}

// ---------------------------------------------------------------- Roman ruins

function roman(b: Builder) {
  // The temple in the old forum, houses grown against it; skewed off the grid.
  const tx = 21, tz = 6, rot = 0.17;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const P = (lx: number, lz: number): [number, number] => [tx + lx * cs + lz * sn, tz - lx * sn + lz * cs];
  b.box('marble', 11, 1.7, 16, tx, -0.3, tz, rot);
  const front = [0.0, 1, 0.45, 0, 1, 0.3];
  front.forEach((f, i) => {
    if (f === 0) return;
    const [x, z] = P(-4.6 + i * 1.9 + R(-0.05, 0.05), 7.3);
    column(b, x, 1.4, z, R(8.4, 9), R(0.4, 0.47), f === 1 ? 0 : f);
  });
  const [ax, az] = P(-0.9, 7.3);
  b.box('marble', 4.6, 0.85, 1.1, ax, 10.0, az, rot + 0.02, true, 0, 0.03);
  for (let i = 0; i < 3; i++) {
    const [x, z] = P(4.6, 4 - i * 4.2);
    if (i !== 1) column(b, x, 1.4, z, 8.8, 0.44, i === 2 ? 0.4 : 0);
  }
  const [wx, wz] = P(0, -6);
  ruin(b, 'brick', 9, 7.5, 0.9, wx, 1.4, wz, rot, 0.65);
  for (let i = 0; i < 5; i++) {
    const [x, z] = P(R(-5, 5), R(8.5, 10.5));
    fallenDrum(b, x, z, 0.42, R(0.8, 2), R(0, Math.PI));
  }
  // Arch across the main lane, half swallowed by the houses either side.
  const s = town.streets[0];
  let acc = 0, idx = 0;
  const total = s.pts.reduce((a2, p2, i) => (i ? a2 + p2.distanceTo(s.pts[i - 1]) : 0), 0);
  for (let i = 1; i < s.pts.length; i++) {
    acc += s.pts[i].distanceTo(s.pts[i - 1]);
    if (acc > total * 0.42) { idx = i; break; }
  }
  const p = s.pts[idx], q = s.pts[Math.min(idx + 1, s.pts.length - 1)];
  const d = q.clone().sub(p).normalize();
  // Wall length across the lane: local x along the lane's normal.
  b.geo('marble', ruinGeo(9, 9.5, 2.6, 0.3, 3.6, 3.8), p.x, -0.3, p.y, Math.atan2(-d.x, -d.y));
  mapMarks.arch.copy(p);
  well(b, s.pts[Math.floor(s.pts.length * 0.62)].x + 2.2, s.pts[Math.floor(s.pts.length * 0.62)].y + 0.5);
}

function well(b: Builder, x: number, z: number) {
  // A reused Roman puteal: a marble drum, and a crooked wooden frame.
  b.geo('marble', new THREE.CylinderGeometry(0.7, 0.75, 0.85, 20, 2, true), x, 0.42, z);
  b.geo('marble', new THREE.TorusGeometry(0.7, 0.08, 6, 20), x, 0.85, z, 0, true, Math.PI / 2);
  b.box('wood', 0.15, 2.2, 0.15, x + 0.85, 0, z + 0.1, 0, true, 0, 0.06);
  b.box('wood', 0.15, 2.1, 0.15, x - 0.8, 0, z - 0.1, 0, true, 0.04, 0);
  b.box('wood', 2.1, 0.13, 0.13, x, 2.08, z, 0.08, false);
}

// ---------------------------------------------------------------- abbey

function monastery(b: Builder) {
  church(b);
  chapel(b);
  // Graves between chapel and church: mounds, slabs, a few wooden crosses.
  for (let i = 0; i < 26; i++) {
    const x = R(-31, -24), z = R(-63, -44);
    const ry = R(-0.5, 0.5);
    if (rand() < 0.45) b.box('wood', 0.09, R(0.8, 1.2), 0.08, x, -0.2, z, ry, false, R(-0.2, 0.2), R(-0.2, 0.2));
    else if (rand() < 0.6) b.box('ground', 0.8, 0.35, 1.9, x, -0.15, z, ry);
    else b.box('marble', 0.7, 0.18, 1.8, x, -0.1, z, ry, true, R(-0.08, 0.08), R(-0.08, 0.08));
  }
  // A low precinct wall, in pieces, with a gap towards the north postern.
  const enc = [V(-49, -71), V(-30, -76), V(-21.8, -74.5), V(-18.2, -73.9), V(-8, -72)];
  for (let i = 0; i < enc.length - 1; i++) {
    if (i === 2) continue;
    const a = enc[i], c = enc[i + 1];
    const mid = a.clone().add(c).multiplyScalar(0.5);
    ruin(b, 'rubble', a.distanceTo(c), 3.2, 0.8, mid.x, -0.3, mid.y, Math.atan2(-(c.y - a.y), c.x - a.x), 0.5);
  }
}

/**
 * The abbey church: an early-Christian basilica as the Lombards had them,
 * built of spolia and never quite regular: one aisle only, the other side a
 * collapsed annex; columns of different stones and heights; apse askew.
 * Oriented north, with an atrium (quadriporticus) before it, half fallen.
 */
function church(b: Builder) {
  const x0 = -21, x1 = -13.6, z0 = -64, z1 = -41, H = 10.5;
  const cx = (x0 + x1) / 2, L = z1 - z0, cz = (z0 + z1) / 2;
  // West wall: solid, buttressed, with a few small windows.
  b.box('rubble', 0.9, H, L, x0, -0.3, cz, 0.012);
  for (let z = z0 + 3; z < z1 - 2; z += R(4.5, 6.5)) b.box('rubble', 1.1, R(4, 6.5), 1.0, x0 - 0.9, -0.3, z, 0.012);
  for (let z = z0 + 2.5; z < z1 - 2; z += R(3.5, 5)) b.box('iron', 1.0, 1.2, 0.45, x0, R(6.5, 7.6), z, 0, false);
  // East side: nave arcade on mismatched columns, aisle beyond.
  const n = 6, bay = L / n;
  b.geo('brick', arcadeGeo(L, 6.4, 0.7, n, bay - 1.0, 3.9), x1, -0.3, cz, Math.PI / 2);
  for (let i = 1; i < n; i++) {
    const stoneMat: MatName = rand() < 0.35 ? 'stone' : 'marble';
    const plinth = R(0, 0.5);
    if (plinth > 0.1) b.box(stoneMat, 0.9, plinth, 0.9, x1, -0.3, z0 + bay * i, R(-0.2, 0.2));
    column(b, x1, -0.3 + plinth, z0 + bay * i, 4.15 - plinth, R(0.26, 0.34), 0, stoneMat);
  }
  b.box('brick', 0.7, H - 6.1, L, x1, 6.1, cz);
  for (let i = 0; i < n; i++) b.box('iron', 0.8, 1.2, 0.9, x1, 7.4, z0 + bay * (i + 0.5) + R(-0.4, 0.4), 0, false);
  const ax1 = -9.8;
  b.box('rubble', 0.8, 5.6, L - 3, ax1, -0.3, cz - 1.5, -0.01);
  leanTo(b, L - 2, 3.8, 6.5, 5.2, (x1 + ax1) / 2, cz - 1, Math.PI / 2);
  gable(b, L + 0.4, x1 - x0 + 1.2, 1.9, cx, H - 0.3, cz, Math.PI / 2, 'brick', 0.6);
  // Façade (south): portal off-centre, a small window, an older doorway bricked up.
  b.geo('rubble', arcadeGeo(x1 - x0 + 0.9, H, 0.9, 1, 2.0, 2.5), cx + 0.6, -0.3, z1, 0);
  b.geo('marble', arcadeGeo(3.1, 3.9, 0.3, 1, 2.0, 2.5), cx + 0.6, -0.3, z1 + 0.5, 0);
  b.box('iron', 0.6, 0.9, 1.0, cx - 0.5, 7.2, z1, 0, false);
  b.box('brick', 1.3, 2.0, 0.2, x1 + 1.8, -0.3, z1 - 3, 0.02);
  // Apse, askew.
  const ar = 3.5, acx = cx + 0.5;
  for (let i = 0; i <= 9; i++) {
    const a = Math.PI / 2 + (i / 9) * Math.PI + 0.08;
    b.box('brick', 1.45, 7.2, 0.8, acx + Math.sin(a) * ar, -0.3, z0 + Math.cos(a) * ar, a);
  }
  b.geo('roof', new THREE.ConeGeometry(ar + 0.7, 1.9, 18, 2, false, Math.PI / 2 + 0.08, Math.PI), acx, 6.9 + 0.95, z0);
  // The collapsed west annex.
  ruin(b, 'rubble', 10, 4.5, 0.7, x0 - 4.5, -0.3, z0 + 8, 0, 0.8);
  ruin(b, 'rubble', 7, 3.5, 0.7, x0 - 8.5, -0.3, z0 + 11.5, Math.PI / 2 + 0.1, 0.8);
  // Interior: worn floor slabs, a chancel screen of carved plutei (one fallen),
  // the altar under its ciborium, polykandela.
  b.box('slab', x1 - x0 - 0.5, 0.05, L - 0.8, cx, -0.32, cz, 0.012, false);
  b.box('marble', 2.2, 0.95, 0.16, cx - 1.6, -0.3, z0 + 5.5, 0.03);
  b.box('marble', 2.0, 0.16, 0.95, cx + 1.4, -0.25, z0 + 5.9, 0.3, true, 0, 0.12);
  const alx = acx - 0.2, alz = z0 + 1.6;
  b.box('marble', 1.6, 1.0, 0.95, alx, -0.3, alz, 0.05);
  const cib: [number, number, number][] = [[-1.1, -1.0, 0.13], [1.0, -1.05, 0.12], [-1.05, 1.0, 0.14], [1.15, 0.95, 0.11]];
  for (const [dx, dz, r] of cib) column(b, alx + dx, -0.3, alz + dz, 3.4, r, 0);
  b.box('marble', 2.8, 0.42, 2.6, alx, 3.1, alz, 0.04);
  pyramidRoof(b, 3.0, 1.0, alx, 3.52, alz);
  candle(b, alx - 0.4, 0.7, alz, 0.42);
  candle(b, alx + 0.35, 0.7, alz + 0.1, 0.36);
  polykandelon(b, cx - 0.2, 4.3, z0 + 9, H, 9);
  polykandelon(b, cx + 0.3, 4.0, z0 + 17.5, H, 8);
  lucerna(b, ax1 - 0.6, 1.0, cz + 4, Math.PI / 2);
  torch(b, x0 + 0.5, 2.9, z1 - 2.5, Math.PI / 2);
  // Atrium: trapezoid court; portico survives on the east and part of the south.
  const az0 = z1, az1 = -29.5;
  b.box('rubble', 0.8, 4.2, az1 - az0, -9.2, -0.3, (az0 + az1) / 2, 0.05);
  for (let i = 0; i < 4; i++) column(b, -12, -0.3, az0 + 2 + i * 2.9, 3.4, R(0.2, 0.26), i === 2 ? 0.45 : 0, rand() < 0.5 ? 'marble' : 'stone');
  leanTo(b, az1 - az0, 2.9, 4.2, 3.2, -10.6, (az0 + az1) / 2, -Math.PI / 2);
  ruin(b, 'rubble', 7, 3.8, 0.8, -22, -0.3, (az0 + az1) / 2 - 1, Math.PI / 2 + 0.07, 0.75);
  ruin(b, 'rubble', 5, 3.2, 0.8, -20.5, -0.3, az1, 0.05, 0.6);
  for (let i = 0; i < 2; i++) column(b, -10.6 - i * 2.4, -0.3, az1 - 0.8, 3.3, 0.22, i === 1 ? 0.6 : 0);
  // The cantharus, the fountain of the atrium, long dry.
  b.geo('marble', new THREE.CylinderGeometry(1.0, 0.8, 0.7, 18, 2, true), -16.5, 0.05, -35.5);
  brazier(b, -14.2, -32.5);
  hornLantern(b, -11.2, 2.4, -38.5);
}

function chapel(b: Builder) {
  // Ossuary chapel over the catacomb stair. Door faces south.
  const x0 = -40.5, x1 = -31.5, z0 = -60, z1 = -49, H = 5.5;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.box('rubble', x1 - x0, H, 0.8, cx, -0.2, z0);
  b.box('rubble', 0.8, H, z1 - z0, x0, -0.2, cz);
  b.box('rubble', 0.8, H, z1 - z0, x1, -0.2, cz);
  arcade(b, 'rubble', x1 - x0, H, 0.8, 1, 2.0, 2.0, cx, -0.2, z1, 0);
  gable(b, z1 - z0, x1 - x0, 1.9, cx, H - 0.2, cz, Math.PI / 2, 'rubble', 0.5);
  torch(b, cx + 1.8, 2.6, z1 + 0.45, 0);
  torch(b, x0 + 0.45, 2.4, -54, Math.PI / 2);
  for (const s of [-1, 1]) skullShelf(b, s < 0 ? x0 + 0.4 : x1 - 0.4, 0.0, cz + 1, s < 0 ? Math.PI / 2 : -Math.PI / 2, 6, false);
  const hx0 = STAIR_X - STAIR_W / 2, hx1 = STAIR_X + STAIR_W / 2;
  b.box('marble', 0.3, 0.9, STAIR_TOP - HOLE_END, hx0 - 0.15, -0.1, (STAIR_TOP + HOLE_END) / 2);
  b.box('marble', 0.3, 0.9, STAIR_TOP - HOLE_END, hx1 + 0.15, -0.1, (STAIR_TOP + HOLE_END) / 2);
  b.box('marble', STAIR_W + 0.6, 0.9, 0.3, STAIR_X, -0.1, HOLE_END - 0.15);
  lucerna(b, hx0 - 0.15, 0.82, -53, Math.PI / 2);
  lucerna(b, hx1 + 0.15, 0.82, -55, -Math.PI / 2);
}

/** Wall shelf of skulls and long bones, with an oil lamp here and there. */
function skullShelf(b: Builder, x: number, y: number, z: number, ry: number, len: number, under: boolean) {
  const ox = Math.sin(ry), oz = Math.cos(ry);
  const tx = Math.cos(ry), tz = -Math.sin(ry);
  for (const ly of [y + 0.75, y + 1.6]) {
    b.box('rock', len, 0.1, 0.42, x + ox * 0.21, ly, z + oz * 0.21, ry, false);
    // Long bones stacked lengthwise at the back.
    for (let k = 0; k < 3; k++) {
      const kind = (['femur', 'humerus', 'tibia'] as const)[Math.floor(rand() * 3)];
      b.prop(kind, x + ox * 0.1 + tx * R(-len / 3, len / 3), ly + 0.1 + k * 0.05, z + oz * 0.1 + tz * R(-len / 3, len / 3), ry + R(-0.15, 0.15), 0, 0, R(0.9, 1.05));
    }
    const n = Math.floor(len / 0.26);
    for (let i = 0; i < n; i++) {
      if (rand() < 0.25) continue;
      const t = (i + 0.5) / n - 0.5;
      const px = x + tx * t * len + ox * 0.26, pz = z + tz * t * len + oz * 0.26;
      if (rand() < 0.08) { lucerna(b, px, ly + 0.05, pz, ry, under, rand() < 0.3); continue; }
      b.prop('skull', px, ly + 0.1, pz, ry + R(-0.5, 0.5), R(-0.15, 0.1), R(-0.2, 0.2), R(0.92, 1.08));
    }
  }
}


// ---------------------------------------------------------------- ground

// ---------------------------------------------------------------- ground

function grid(x0: number, x1: number, step: number, y: number, skip: (cx: number, cz: number) => boolean, z0 = x0) {
  const n = Math.round((x1 - x0) / step);
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const nor = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j * (n + 1) + i) * 3;
    pos[k] = x0 + i * step; pos[k + 1] = y; pos[k + 2] = z0 + j * step;
    nor[k + 1] = 1;
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (skip(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

const GROUND_STEP = 0.6;
function ground(b: Builder) {
  const IN = 96;
  const hx0 = STAIR_X - STAIR_W / 2, hx1 = STAIR_X + STAIR_W / 2;
  const hole = (x: number, z: number) => x > hx0 && x < hx1 && z < STAIR_TOP && z > HOLE_END;
  b.add(grid(-IN, IN, GROUND_STEP, 0, hole), 'ground', undefined, false, true);
  b.add(grid(-400, 400, 4, -0.04, (x, z) => Math.abs(x) < IN - 2 && Math.abs(z) < IN - 2), 'ground', undefined, false, true);
  // Walkable ground for collision: 4 m cells, lined up so the stair opening
  // (x -38..-34, z -56..-52) is exactly one 4 x 4 cell, plus 10 m cells beyond.
  b.collideShape(grid(-98, 98, 4, 0, (x, z) => x > -38 && x < -34 && z > -56 && z < -52, -96), 'ground');
  b.collideShape(grid(-200, 200, 10, -0.04, (x, z) => Math.abs(x) < 95 && Math.abs(z) < 95), 'ground');
}


function deadTree(b: Builder, x: number, z: number, h: number) {
  b.geo('wood', new THREE.CylinderGeometry(0.12, 0.3, h, 6), x, h / 2, z, R(0, 3), true, R(-0.08, 0.08), R(-0.08, 0.08));
  const n = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const y = h * R(0.45, 0.95), len = R(1, 2.6);
    const a = rand() * Math.PI * 2, tilt = R(0.5, 1.1);
    const g = new THREE.CylinderGeometry(0.03, 0.09, len, 5);
    g.translate(0, len / 2, 0);
    g.rotateZ(tilt);
    g.rotateY(a);
    b.geo('wood', g, x, y, z, 0, false);
  }
}


/**
 * Outside the north postern: a little roofless martyr's chapel (cella
 * memoriae) standing over the crypt, reached by a trodden path.
 */
function cellaMemoriae(b: Builder) {
  const cx = -20.3, cz = -93.1;
  const ry = Math.atan2(NORTH.p.x - cx, NORTH.p.y - cz);
  const P = (lx: number, lz: number): [number, number] => [cx + lx * Math.cos(ry) + lz * Math.sin(ry), cz - lx * Math.sin(ry) + lz * Math.cos(ry)];
  const [ex, ez] = P(0, 3);
  b.geo('rubble', arcadeGeo(5.2, 3.6, 0.7, 1, 1.5, 1.7), ex, -0.2, ez, ry);
  for (const s of [-1, 1]) {
    const [wx, wz] = P(s * 2.6, 0);
    ruin(b, 'rubble', 6, R(2.2, 3.4), 0.7, wx, -0.2, wz, ry + Math.PI / 2, 0.6);
  }
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 + (i / 6) * Math.PI;
    const [ax, az] = P(Math.sin(a) * 2.3, -3 + Math.cos(a) * 2.3);
    b.box('rubble', 1.3, R(1.6, 2.8), 0.7, ax, -0.2, az, ry + a);
  }
  const [sx, sz] = P(0, -1.2);
  b.box('marble', 1.0, 0.25, 2.0, sx, -0.15, sz, ry + 0.06);
  lucerna(b, sx + 0.2, 0.12, sz, ry, false);
  const [tx, tz] = P(1.9, 2.7);
  torch(b, tx, 2.2, tz, ry);
}

function outskirts(b: Builder) {
  cellaMemoriae(b);
  const inside = (x: number, z: number) => Math.hypot(x, z) < 92;
  // The aqueduct, long dry, striding in from the hills; whole spans have fallen.
  const a0 = V(78, -50), a1 = V(205, -150);
  const dir = a1.clone().sub(a0);
  const len = dir.length();
  dir.normalize();
  const ry = Math.atan2(-dir.y, dir.x);
  const bay = 6;
  mapMarks.aqueduct.push(a0.clone(), a1.clone());
  for (let s = 0; s * bay * 3 < len; s++) {
    if (s % 4 === 2 || s % 7 === 5) {
      for (let k = 0; k < 3; k++) {
        const p = a0.clone().addScaledVector(dir, s * bay * 3 + k * bay + R(-0.5, 0.5));
        b.box('brick', R(1.8, 2.4), R(1, 4.5), R(1.8, 2.4), p.x, -0.4, p.y, ry + R(-0.2, 0.2), true, R(-0.08, 0.08));
      }
      continue;
    }
    const p = a0.clone().addScaledVector(dir, s * bay * 3 + bay * 1.5);
    const h = 10 + s * 0.55 + R(-0.6, 0.6);
    b.geo('brick', arcadeGeo(bay * 3 + 0.4, h * 0.75, 2.2, 3, bay - R(1.8, 2.3), h * 0.5), p.x, -0.4, p.y, ry + R(-0.03, 0.03));
    ruin(b, 'brick', bay * 3 + 0.4, h * 0.25, 2.2, p.x, -0.45 + h * 0.75, p.y, ry, s % 3 === 1 ? 0.85 : 0.35);
  }
  // Tombs along the road from the gate: drums, sarcophagi, cippi, broken mausolea.
  for (let i = 0; i < 16; i++) {
    const side = rand() < 0.5 ? 1 : -1;
    const z = GATE.p.y + 8 + i * R(3.5, 5.5);
    const x = GATE.p.x + side * R(5.5, 15) + Math.sin(z * 0.05) * 2;
    if (inside(x, z)) continue;
    mapMarks.tombs.push(V(x, z));
    const kind = rand();
    if (kind < 0.3) {
      const r = R(2.2, 3.4), h = R(2.5, 4.5);
      b.geo('brick', new THREE.CylinderGeometry(r, r * 1.03, h, 24, 4), x, h / 2 - 0.3, z);
      b.geo('ground', new THREE.ConeGeometry(r * 1.02, r * 0.7, 24, 2), x, h - 0.3 + r * 0.35, z);
    } else if (kind < 0.6) {
      const r0 = R(-0.4, 0.4) + (rand() < 0.5 ? Math.PI / 2 : 0);
      b.box('marble', 1.0, 0.85, 2.2, x, -0.1, z, r0);
      b.box('marble', 1.1, 0.25, 2.3, x + R(-0.3, 0.3), 0.75, z + R(-0.4, 0.4), r0 + R(-0.4, 0.4), true, R(-0.1, 0.1));
    } else if (kind < 0.85) {
      b.box('marble', 0.55, R(0.9, 1.6), 0.4, x, -0.15, z, R(-0.3, 0.3), true, R(-0.12, 0.12), R(-0.12, 0.12));
    } else {
      ruin(b, 'brick', R(3, 5), R(2.5, 4), R(3, 4), x, -0.2, z, R(0, 3), 0.6);
    }
    if (i === 6) lucerna(b, x, 0.75, z, 0);
  }
}

export function regionName(p: THREE.Vector3): string {
  if (p.y < -2.4) return 'Catacumbae';
  const r = Math.hypot(p.x, p.z);
  if (p.distanceTo(new THREE.Vector3(GATE.p.x, p.y, GATE.p.y)) < 9) return 'Porta';
  if (Math.hypot(p.x - NORTH.p.x, p.z - NORTH.p.y) < 7) return 'Porta Septentrionalis';
  if (Math.hypot(p.x + 20.3, p.z + 93.1) < 8) return 'Cella Memoriae';
  if (p.x > -48 && p.x < -18 && p.z > 12 && p.z < 36) return 'Thermae';
  if (p.x > 28 && p.x < 52 && p.z > -36 && p.z < -10) return 'Palatium';
  if (r > 75 && p.z > 40) return 'Via Sepulcrorum';
  if (r > 80) return 'Extra Muros';
  if (p.x > 10 && p.x < 32 && p.z > -7 && p.z < 19) return 'Templum';
  if (p.x > -41 && p.x < -31 && p.z > -60 && p.z < -49) return 'Ossuarium';
  if (p.x > -23 && p.x < -9 && p.z > -68 && p.z < -41) return 'Basilica';
  if (p.x > -23 && p.x < -9 && p.z > -41 && p.z < -28) return 'Atrium';
  if (p.x > -50 && p.x < -3 && p.z > -76 && p.z < -28) return 'Monasterium';
  return 'Civitas';
}
