import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder, rng, type Cell } from './builder';
import type { MatName } from './materials';
import { arcadeGeo, arcade, ruin, column, fallenDrum, gable, leanTo, pyramidRoof, ringGeo, archRings, quoinBox } from './shapes';
import { torch, brazier, hornLantern, lucerna, polykandelon, candle } from './lights';
import { buildCatacombs, CATACOMB_SPOTS, CELLA_STAIR } from './catacombs';
import { buildForest, treeSpots } from './forest';
import { buildBaths, BATHS_SPOT } from './baths';
import { buildPalace, PALACE_SPOT } from './palace';
import { buildLibrary } from './library';
import { setSite, worldTerrain, fastTerrain, terrain, toLocalXZ } from './displace';
import { placeProp, commitProps, rand01, type PropId } from './props';
import { BOUNDS, RIVERS, WALL700, CIVITAS_NOVA, MEDIEVAL_OUTLINE, insideWalls, insideness, riverAt, inPoly, type P2 } from './benevento/geo';
import { SITES, GATES, ROADS, siteToWorld, DISTRICTS, type SiteDef } from './benevento/sites';
import { layoutTown, density, FREE, STREET, RESERVED, HOUSE, PLOT, type Layout } from './benevento/layout';
import { makeChunks, buildChunk, CHUNK, type Hole, type ChunkItems } from './benevento/fabric';
import { FabricStream } from './benevento/stream';
import * as M from './benevento/monuments';
import { buildRivers } from './benevento/rivers';
import { interiorAnchors } from './benevento/interiors';
import { PLACED, markReadable, markReadableWorld } from './benevento/readables';
import { LORE, explorableLore } from './benevento/lore';

// Benevento in AD 700, under Duke Gisulf I: the town of the first Lombard
// circuit on its ridge between the Calore and the Sabato, laid out on the
// user's plan (registered on real survey data), streamed around the player;
// the monuments where they stand; outside the walls the theatre, the baths,
// the amphitheatre and the Santi Quaranta in the ruralised west, the bridges,
// the nunnery of St Peter across the Sabato, the Lombard cemetery, S. Ilario
// on the Traiana, and the fields, scrub and woods along the rivers.

const rand = rng(1327);
const R = (a: number, b: number) => a + (b - a) * rand();

const STAIR_X = -36, STAIR_W = 3, STAIR_TOP = -52, HOLE_END = -56;

let lay: Layout;
let stream: FabricStream;

/** Rotation that turns local +z into world direction (dx, dz). */
const rotZTo = (dx: number, dz: number) => Math.atan2(dx, dz);

const AUREA_DIR: [number, number] = [0.88, -0.48]; // Via Traiana through the arch
export const SPAWN = (() => {
  const s = SITES.arcusTraiani, x = s.x + AUREA_DIR[0] * 16, z = s.z + AUREA_DIR[1] * 16;
  return new THREE.Vector3(x, worldTerrain(x, z) + 1.8, z);
})();
export const SPAWN_YAW = Math.atan2(AUREA_DIR[0], AUREA_DIR[1]);

/** Where the ground opens onto a stair down: both the town and the underworld are drawn here. */
export const STAIR_ZONES: { x: number; z: number; r: number }[] = [];

export interface Teleport { name: string; x: number; y: number; z: number; yaw: number }
const tp = (name: string, x: number, z: number, lookX: number, lookZ: number): Teleport =>
  ({ name, x, z, y: worldTerrain(x, z) + 2.2, yaw: Math.atan2(-(lookX - x), -(lookZ - z)) });
const sw = (s: SiteDef, lx: number, lz: number) => siteToWorld(s, lx, lz);

/** Places the map can send you to (y is eye height; the landing finds the floor). */
export function getTeleports(): Teleport[] {
  const S = SITES;
  const out: Teleport[] = [];
  const at = (name: string, s: SiteDef, lx: number, lz: number, llx: number, llz: number) => {
    const [x, z] = sw(s, lx, lz), [lx2, lz2] = sw(s, llx, llz);
    out.push(tp(name, x, z, lx2, lz2));
  };
  at('Porta Aurea', S.arcusTraiani, 0, 14, 0, 0);
  at('Arcus Sacramenti', S.arcusSacramenti, 0, 9, 0, 0);
  at('Curtis Ducis', S.curtis, 39.6, -4.5, 39.6, -16);
  at('Episcopium', S.episcopium, -15.5, -31, -17, -45);
  at('Sancta Maria', S.episcopium, -17.6, -45, -17, -62);
  at('Bibliotheca', S.episcopium, -12.6, -50, -7, -50);
  at('Forum', S.forum, 21, 18, 21, 6);
  at('Theatrum', S.theatrum, 6, 0, 30, 0);
  at('Thermae', S.thermae, -20.6, 29.5, -30, 29.5);
  at('Amphitheatrum', S.amphitheatrum, 0, -60, 0, 0);
  at('Sancti Quadraginta', S.quadraginta, -36, -46, -36, -56);
  at('Turris Catenae', S.turrisCatenae, -10, 0, 0, 0);
  at('Pons Leprosus', S.pontesLeprosus, 0, 0, 30, 0);
  at('Sanctus Petrus', S.sanctusPetrus, -15.5, -31, -17, -45);
  at('Sanctus Hilarius', S.sanctusHilarius, -13, 0, 0, 0);
  at('Iseum', S.iseum, 0, 16, 0, 0);
  at('Coemeterium Langobardorum', S.necropolis, 0, 26, 0, 0);
  at('Nux Sacra', S.nux, 0, 9, 0, 0);
  at('Molendinum', S.molendinum, 0.8, -7, 0.8, 0);
  at('Hortus Curtis', S.hortusSophiae, 0, 8, 0, 0);
  {
    const c = M.CISTERN;
    const [x, z] = sw(S.hortusSophiae, 0, c.bottom - 3);
    out.push({ name: 'Cisterna', x, z, y: fastTerrain(x, z) + c.depth + 1.85, yaw: 0 });
  }
  {
    const cs = CATACOMB_SPOTS, s = S.quadraginta;
    const lw = (v: THREE.Vector3) => { const [x, z] = sw(s, v.x, v.z); return { x, z, y: fastTerrain(x, z) + v.y + 0.2 }; };
    out.push({ name: 'Catacumbae', ...lw(cs.stairBottom), yaw: s.rot });
    out.push({ name: 'Crypta', ...lw(cs.crypt), yaw: 0.9 + s.rot });
  }
  for (const g of GATES) if (g.kind !== 'arch') out.push(tp(g.name, g.at[0], g.at[1], g.at[0] + 0.01, g.at[1] - 0.01));
  return out;
}

// ---------------------------------------------------------------- the cathedral (the old abbey church, in the Episcopium frame)
/** A buttress as stepped masses with weathered offsets, not a cube. */
function buttress(b: Builder, m: MatName, w: number, h: number, d: number, x: number, y: number, z: number, ry: number) {
  const h1 = h * R(0.5, 0.62);
  b.box(m, w, h1, d, x, y, z, ry);
  const X = Math.sin(ry), Z = Math.cos(ry);
  b.box(m, w * 0.82, h - h1, d * 0.6, x - X * d * 0.2, y + h1, z - Z * d * 0.2, ry);
  // Sloping weatherings on each step.
  b.box('stone', w + 0.06, 0.12, d * 0.45, x + X * d * 0.3, y + h1 - 0.04, z + Z * d * 0.3, ry, false, -0.45);
  b.box('stone', w * 0.86, 0.12, d * 0.4, x + X * d * 0.0, y + h - 0.06, z + Z * d * 0.0, ry, false, -0.5);
  quoinBox(b, 'block', w, h1, d, x, y, z, ry);
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
  for (let z = z0 + 3; z < z1 - 2; z += R(4.5, 6.5)) buttress(b, 'rubble', 1.1, R(5, 7), 1.2, x0 - 0.95, -0.3, z, -Math.PI / 2 + 0.012);
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
  // Aisle wall, with a doorway through to the library (z -51.3 .. -48.7).
  const az0w = cz - 1.5 - (L - 3) / 2, az1w = cz - 1.5 + (L - 3) / 2;
  b.box('rubble', 0.8, 5.6, -51.3 - az0w, ax1, -0.3, (az0w - 51.3) / 2, -0.01);
  b.box('rubble', 0.8, 5.6, az1w + 48.7, ax1, -0.3, (az1w - 48.7) / 2, -0.01);
  b.geo('brick', arcadeGeo(2.6, 5.6, 0.85, 1, 1.5, 2.1), ax1, -0.3, -50, Math.PI / 2);
  archRings(b, 'brick', ax1, -0.3, -50, Math.PI / 2, 0.85, 1.5, 2.1, 0.32, 0.075);
  leanTo(b, L - 2, 3.8, 6.5, 5.2, (x1 + ax1) / 2, cz - 1, Math.PI / 2);
  gable(b, L + 0.4, x1 - x0 + 1.2, 1.9, cx, H - 0.3, cz, Math.PI / 2, 'brick', 0.6);
  // Façade (south): portal off-centre, a small window, an older doorway bricked up.
  b.geo('rubble', arcadeGeo(x1 - x0 + 0.9, H, 0.9, 1, 2.0, 2.5), cx + 0.6, -0.3, z1, 0);
  b.geo('marble', arcadeGeo(3.1, 3.9, 0.3, 1, 2.0, 2.5), cx + 0.6, -0.3, z1 + 0.5, 0);
  archRings(b, 'marble', cx + 0.6, -0.3, z1 + 0.5, 0, 0.32, 2.0, 2.5, 0.3, 0.26);
  // Façade corners in reused squared blocks; a relieving arch over the portal.
  quoinBox(b, 'block', x1 - x0 + 0.95, H - 0.2, 0.95, cx, -0.3, z1, 0);
  archRings(b, 'brick', cx + 0.6, 1.4, z1, 0, 0.92, 3.6, 2.4, 0.3, 0.075);
  b.box('iron', 0.6, 0.9, 1.0, cx - 0.5, 7.2, z1, 0, false);
  b.box('brick', 1.3, 2.0, 0.2, x1 + 1.8, -0.3, z1 - 3, 0.02);
  // Apse, askew.
  const ar = 3.5, acx = cx + 0.5;
  for (let i = 0; i <= 9; i++) {
    const a = Math.PI / 2 + (i / 9) * Math.PI + 0.08;
    b.box('brick', 1.45, 7.2, 0.8, acx + Math.sin(a) * ar, -0.3, z0 + Math.cos(a) * ar, a);
  }
  b.geo('roof', new THREE.ConeGeometry(ar + 0.7, 1.9, 18, 2, false, Math.PI / 2 + 0.08, Math.PI), acx, 6.9 + 0.95, z0);
  // The nave's east wall above the apse arch, up to the roof.
  b.box('rubble', x1 - x0 + 0.9, H - 6.4, 0.8, cx, 6.6, z0 - 0.1, 0.012);
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
  b.geo('marble', ringGeo(1.0, 0.72, 0.72), -16.5, -0.05, -35.5);
  b.geo('marble', new THREE.CircleGeometry(0.9, 24).rotateX(-Math.PI / 2), -16.5, 0.12, -35.5, 0, false);
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


/**
 * Outside the north postern: a little roofless martyr's chapel (cella
 * memoriae) standing over the crypt, reached by a trodden path.
 */
function cellaMemoriae(b: Builder) {
  // Roofless memoria over the martyr's crypt. Its floor is mostly the
  // opening of the stair down to the crypt (CELLA_STAIR), walled round
  // with a parapet; you walk round it to the head of the stair by the apse.
  const cx = -20.3, cz = -93.1;
  const ry = 0;
  const P = (lx: number, lz: number): [number, number] => [cx + lx, cz + lz];
  const [ex, ez] = P(0, 3.5);
  b.geo('rubble', arcadeGeo(5.2, 3.6, 0.7, 1, 1.5, 1.7), ex, -0.2, ez, ry);
  archRings(b, 'block', ex, -0.2, ez, ry, 0.7, 1.5, 1.7, 0.3, 0.2);
  for (const s of [-1, 1]) {
    const [wx, wz] = P(s * 2.6, 0.15);
    ruin(b, 'rubble', 6.7, R(2.2, 3.4), 0.7, wx, -0.2, wz, ry + Math.PI / 2, 0.6);
  }
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 + (i / 6) * Math.PI;
    const [ax, az] = P(Math.sin(a) * 2.3, -3.2 + Math.cos(a) * 2.3);
    b.box('rubble', 1.3, R(1.6, 2.8), 0.7, ax, -0.2, az, ry + a);
  }
  const [tx, tz] = P(1.9, 3.88);
  torch(b, tx, 2.2, tz, ry);
}


// ---------------------------------------------------------------- the nunnery of St Peter
/**
 * Theodorada's foundation (before 687) across the Sabato: the church (built
 * like the cathedral's, in its own frame), a cloister-less enclosure of
 * rubble, two ranges of cells and a refectory, the nuns' graves.
 */
function nunnery(b: Builder) {
  const enc: [number, number][] = [[-50, -72], [-30, -78], [-4, -74], [2, -48], [-2, -22], [-26, -18], [-48, -26], [-52, -50]];
  for (let i = 0; i < enc.length; i++) {
    if (i === 5) continue; // the gate
    const a = enc[i], c = enc[(i + 1) % enc.length], mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    ruin(b, 'rubble', Math.hypot(c[0] - a[0], c[1] - a[1]) + 0.4, R(2.6, 3.2), 0.7, mid[0], -0.3, mid[1], Math.atan2(-(c[1] - a[1]), c[0] - a[0]), 0.15);
  }
  for (const [x, z, w, d, ry] of [[-36, -62, 14, 6, 0.05], [-38, -36, 12, 6, -0.04], [-8, -24, 8, 5.5, 0.1]] as const) {
    b.box('rubble', w, 4.2, d, x, -0.3, z, ry);
    gable(b, w + 0.3, d + 0.3, 1.4, x, 3.9, z, ry, 'rubble', 0.4);
    b.box('wood', 1.0, 2.0, 0.1, x, -0.2, z + d / 2 + 0.02, ry, false);
    if (rand() < 0.7) b.lamp('window', new THREE.Vector3(x + 1.5, 2.2, z + d / 2 + 0.1));
  }
  for (let i = 0; i < 22; i++) {
    const x = R(-31, -24), z = R(-58, -42), ry = R(-0.3, 0.3);
    if (rand() < 0.5) b.box('wood', 0.08, R(0.8, 1.1), 0.08, x, -0.2, z, ry, false, R(-0.15, 0.15), R(-0.15, 0.15));
    else b.box('ground', 0.8, 0.3, 1.9, x, -0.12, z, ry);
  }
  torch(b, -26, 2.6, -17.6, 0);
  candle(b, -8.5, 1.0, -21.2, 0.3);
}

/** Above the hypogea of the Santi Quaranta: vaults of the Roman complex, open to the sky. */
function quadragintaRuins(b: Builder) {
  for (let i = 0; i < 6; i++) {
    const x = -60 + i * 7.5, z = -84;
    b.geo('brick', arcadeGeo(7.6, R(5, 8), 2.0, 1, 4.6, 3.2), x, -0.4, z, 0);
    if (rand() < 0.6) ruin(b, 'rubble', 7.6, R(1, 3), 2.0, x, 4.5, z, 0, 0.8);
  }
  ruin(b, 'brick', 30, 6, 1.4, -48, -0.4, -92, 0, 0.6);
  ruin(b, 'rubble', 18, 3.5, 1.2, -66, -0.4, -70, Math.PI / 2, 0.7);
  for (let i = 0; i < 6; i++) fallenDrum(b, R(-62, -30), R(-80, -66), 0.4, R(1, 2), R(0, 3));
}

/** The temple of the forum (old frame: centre 21, 6), its columns scavenged, houses grown against it. */
function temple(b: Builder) {
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
}

/** Everything the map and the townsfolk need. */
export function getMapData() {
  const S = SITES;
  const W = (s: SiteDef) => ({ x: s.x, z: s.z });
  const landmarks: { name: string; x: number; z: number; kind?: string }[] = [
    // Names the townsfolk module looks for (gate guards, palace guards, monks, a market crowd).
    { name: 'Porta', ...W(S.arcusTraiani), kind: 'gate' },
    { name: 'Palatium', ...(() => { const [x, z] = sw(S.curtis, 39.6, -9); return { x, z }; })(), kind: 'palace' },
    { name: 'Atrium', ...(() => { const [x, z] = sw(S.episcopium, -16, -35); return { x, z }; })(), kind: 'church' },
    { name: 'Basilica', ...(() => { const [x, z] = sw(S.episcopium, -17.3, -53); return { x, z }; })(), kind: 'church' },
    { name: 'Templum', ...W(S.forum), kind: 'market' },
  ];
  for (const s of Object.values(S)) landmarks.push({ name: s.name, x: s.x, z: s.z, kind: 'site' });
  for (const g of GATES) landmarks.push({ name: g.name, x: g.at[0], z: g.at[1], kind: 'gate' });
  return {
    bounds: BOUNDS,
    raster: lay.r,
    codes: { free: FREE, street: STREET, reserved: RESERVED, house: HOUSE, plot: PLOT, outside: 4 },
    wall: WALL700, civitasNova: CIVITAS_NOVA, medievalOutline: MEDIEVAL_OUTLINE,
    rivers: RIVERS.map((r) => ({ name: r.name, pts: r.pts, w: r.w })),
    roads: ROADS,
    gates: GATES,
    streets: lay.streets.map((s) => ({ pts: s.pts, w: s.w, main: s.main, kind: s.kind })),
    plots: lay.plots.map((p) => ({ pts: p.pts, kind: p.kind })),
    landmarks,
    /** Quarters of the town and its surroundings, for placing people (see sites.ts DISTRICTS). */
    districts: DISTRICTS,
    /** Houses and places with something to find (id, kind, door position). */
    explorables: lay.lots.filter((l) => l.explore).map((l) => {
      const a = interiorAnchors({ c: l.c.map((p) => [p.x, p.y] as P2), front: { a: [l.front!.a.x, l.front!.a.y], b: [l.front!.b.x, l.front!.b.y], out: [l.front!.out.x, l.front!.out.y] }, h: l.h, street: l.street ?? 2, seed: 1000 + l.id * 7919, explore: l.explore });
      return { id: l.explore!.id, kind: l.explore!.kind, x: a.door[0], z: a.door[1], name: LORE[explorableLore(l.explore!.id)]?.place ?? l.explore!.id };
    }),
    readables: PLACED.map((p) => ({ id: p.id, x: p.pos.x, z: p.pos.z, title: LORE[p.id]?.title ?? p.id })),
    trees: treeSpots, tombs: [] as THREE.Vector2[], aqueduct: [] as THREE.Vector2[],
    teleports: getTeleports(),
  };
}

export type Progress = (label: string, frac: number) => Promise<void>;
const noProgress: Progress = async () => {};

/** A group that carries a site's frame (for the objects modules add to the scene themselves). */
function siteGroup(scene: THREE.Scene, s: SiteDef) {
  const g = new THREE.Group();
  const c = Math.cos(s.rot), sn = Math.sin(s.rot), lx = s.lx ?? 0, lz = s.lz ?? 0;
  g.position.set(s.x - (lx * c + lz * sn), worldTerrain(s.x, s.z), s.z - (-lx * sn + lz * c));
  g.rotation.y = s.rot;
  scene.add(g);
  g.updateMatrixWorld(true);
  return g;
}
export const siteGroups: Record<string, THREE.Group> = {};

/** Stair openings in the ground, in world space. */
function holes(): Hole[] {
  const S = SITES;
  const rect = (s: SiteDef, x0: number, z0: number, x1: number, z1: number): Hole => ({ pts: [sw(s, x0, z0), sw(s, x1, z0), sw(s, x1, z1), sw(s, x0, z1)] });
  const hx0 = STAIR_X - STAIR_W / 2, hx1 = STAIR_X + STAIR_W / 2, ch = CELLA_STAIR.hole, c = M.CISTERN;
  const list = [rect(S.quadraginta, hx0, HOLE_END, hx1, STAIR_TOP), rect(S.quadraginta, ch.x0, ch.z0, ch.x1, ch.z1), rect(S.hortusSophiae, c.x0, c.bottom, c.x1, c.top)];
  STAIR_ZONES.length = 0;
  STAIR_ZONES.push({ ...xz(sw(S.quadraginta, STAIR_X, -54)), r: 9 }, { ...xz(sw(S.quadraginta, -20.1, -93.6)), r: 7 }, { ...xz(sw(S.hortusSophiae, 0, (c.top + c.bottom) / 2)), r: 8 });
  return list;
}
const xz = ([x, z]: P2) => ({ x, z });

export async function buildWorld(scene: THREE.Scene, progress: Progress = noProgress) {
  const S = SITES;
  await progress('Surveying the Lombard walls', 0.02);
  lay = layoutTown();
  const hl = holes();
  const items = makeChunks(lay, hl);
  await progress('Pacing out the lanes', 0.08);
  // Collision of the whole town at once: cheap proxies only.
  const bc = new Builder();
  bc.mode = 'collide';
  let n = 0;
  for (const it of items.values()) {
    buildChunk(bc, it);
    if (++n % 400 === 0) await progress('Pacing out the lanes', 0.08 + 0.1 * (n / items.size));
  }
  groundCollider(bc, items, hl);

  // Landmarks, built in full in their own frames.
  const b = new Builder();
  const at = async (label: string, frac: number, s: SiteDef, fn: (g: THREE.Group) => void) => {
    await progress(label, frac);
    setSite(s);
    const g = siteGroup(scene, s);
    siteGroups[s.id] = g;
    try { fn(g); } finally { setSite(null); }
  };
  await at("At the dukes' curtis", 0.2, S.curtis, (g) => buildPalace(b, g as unknown as THREE.Scene));
  await at('In the bishop\'s church', 0.26, S.episcopium, (g) => { church(b); markReadable('calix', -17.0, 1.1, -62.4); buildLibrary(b, g as unknown as THREE.Scene); });
  await at('Carving the hypogea of the Santi Quaranta', 0.32, S.quadraginta, () => { chapel(b); buildCatacombs(b); cellaMemoriae(b); quadragintaRuins(b); });
  await at('In the old baths', 0.4, S.thermae, (g) => buildBaths(b, g as unknown as THREE.Scene));
  await at('At the nuns of St Peter', 0.45, S.sanctusPetrus, () => { church(b); nunnery(b); });
  await at('Under the Arch of Trajan', 0.5, S.arcusTraiani, () => M.arcusTraiani(b));
  await at('At the forum', 0.52, S.arcusSacramenti, () => M.arcusSacramenti(b));
  await at('At the forum', 0.53, { ...S.forum, x: S.forum.x - 9, z: S.forum.z - 7, lx: 21, lz: 6 }, () => temple(b));
  await at('At the forum', 0.54, S.forum, () => M.forumMarket(b));
  await at('In the theatre', 0.56, S.theatrum, () => M.theatrum(b));
  await at('Among the stones of the amphitheatre', 0.6, S.amphitheatrum, () => M.amphitheatrum(b));
  await at('Under the Torre della Catena', 0.63, S.turrisCatenae, () => M.turrisCatenae(b));
  await at('At S. Ilario', 0.65, S.sanctusHilarius, () => M.sanctusHilarius(b));
  await at('Among the ruins of the Iseum', 0.67, S.iseum, () => M.iseum(b));
  await at('Among the Lombard graves', 0.69, S.necropolis, () => M.necropolis(b));
  await at('By the old walnut', 0.7, S.nux, () => M.nux(b));
  await at('At the mill', 0.71, S.molendinum, () => M.molendinum(b));
  await at("In the dukes' orchard", 0.72, S.hortusSophiae, () => M.cisterna(b));
  await progress('Over the rivers', 0.74);
  M.bridge(b, [-793, -54], [-734, -145], 6.4, 5.5, 'block', 11);
  M.bridge(b, [-73, -326], [-100, -424], 6.0, 4.5, 'block', 12);
  // Readables in the houses one can enter.
  for (const l of lay.lots) if (l.explore) {
    const a = interiorAnchors({ c: l.c.map((p) => [p.x, p.y] as P2), front: { a: [l.front!.a.x, l.front!.a.y], b: [l.front!.b.x, l.front!.b.y], out: [l.front!.out.x, l.front!.out.y] }, h: l.h, street: 2, seed: 1000 + l.id * 7919, explore: l.explore });
    markReadableWorld(explorableLore(l.explore!.id), a.read[0], a.read[1], a.read[2]);
  }
  await progress('Water in the valleys', 0.76);
  buildRivers(scene);
  await progress('The scrub grows dark', 0.78);
  buildForest(scene, bc, {
    inside: (x, z) => insideness(x, z) > 0.35,
    keepOut,
    density: woodDensity,
    bounds: BOUNDS,
    cover: (x, z) => Math.abs(x - 50) < 760 && Math.abs(z + 80) < 480,
  });
  townProps(scene);
  await progress('The fog gathers', 0.8);
  const { collider: landCol, cells } = b.build(scene);
  // One collider: the landmarks and the whole town's proxies.
  const colGeos = [landCol.geometry, ...bc.colliders];
  const collider = new THREE.Mesh(mergeGeometries(colGeos.filter((g) => g.attributes.position.count > 0), false)!);
  const lamps = b.lamps;
  stream = new FabricStream(scene, items, cells, lamps, hl);
  return { collider, cells, lamps, flames: b.flames, props: b.props, townTex: townTexture(lay), stream };
}

// ---------------------------------------------------------------- ground collision
/** Walkable ground for the whole world: 4 m cells near the town, 8 m beyond; fine cells round the stair holes. */
function groundCollider(b: Builder, items: Map<number, ChunkItems>, hl: Hole[]) {
  const pos: number[] = [];
  const gv = new THREE.Vector3();
  const Y = (x: number, z: number) => { field0(x, z, gv); return gv.y + fastTerrain(x, z); };
  const inHole = (x: number, z: number) => hl.some((h) => inPoly(x, z, h.pts));
  for (const it of items.values()) {
    const x0 = it.i * CHUNK, z0 = it.j * CHUNK;
    const near = Math.abs(x0 + 16 - 60) < 900 && Math.abs(z0 + 16 + 90) < 560;
    const st = it.holes.length ? 0.5 : near ? 4 : 8;
    const n = Math.round(CHUNK / st);
    const H: number[] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) H.push(Y(x0 + i * st, z0 + j * st));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i * st, z = z0 + j * st;
      if (it.holes.length && inHole(x + st / 2, z + st / 2)) continue;
      const a = H[j * (n + 1) + i], c = H[j * (n + 1) + i + 1], d = H[(j + 1) * (n + 1) + i], e = H[(j + 1) * (n + 1) + i + 1];
      pos.push(x, a, z, x, d, z + st, x + st, c, z, x + st, c, z, x, d, z + st, x + st, e, z + st);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  b.collideWorld(g);
}
import { field } from './displace';
const field0 = (x: number, z: number, out: THREE.Vector3) => field(x, 0, z, 'ground', out);

// ---------------------------------------------------------------- the wood and the clearings
/** Where trees grow: thick along the rivers and on the bluffs, thin in the fields, none on the roads. */
function woodDensity(x: number, z: number) {
  const rv = riverAt(x, z, 90);
  let d = 0.08;
  if (rv) {
    if (rv.d < rv.w / 2 + 1.5) return 0;
    d = Math.max(d, 0.85 * Math.exp(-(((rv.d - rv.w / 2 - 6) / 30) ** 2)));
  }
  // Slopes: the bluffs under the town are scrub and wood.
  const sl = Math.hypot(fastTerrain(x + 3, z) - fastTerrain(x - 3, z), fastTerrain(x, z + 3) - fastTerrain(x, z - 3)) / 6;
  d = Math.max(d, Math.min(0.75, (sl - 0.08) * 3.5));
  // Far from the town the woods close in.
  const far = Math.hypot((x - 60) / 900, (z + 60) / 560);
  d = Math.max(d, Math.min(0.8, (far - 0.85) * 2.2));
  // Fields and gardens round the walls are kept open.
  const ins = insideness(x, z);
  if (ins > 0.05) d *= 0.2;
  return Math.max(0, Math.min(0.9, d * (0.65 + 0.7 * rand01(Math.floor(x / 23) * 31 + Math.floor(z / 23)))));
}
function distToPolyline(x: number, z: number, pts: P2[]) {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], c = pts[k + 1], dx = c[0] - a[0], dz = c[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return best;
}
function keepOut(x: number, z: number) {
  for (const r of ROADS) if (distToPolyline(x, z, r.pts) < r.w / 2 + 3.5) return true;
  for (const s of Object.values(SITES)) {
    const r = s.flat ? s.flat[1] + 4 : s.clear ? s.clear + 6 : 14;
    if (Math.hypot(x - s.x, z - s.z) < r) return true;
  }
  // The bridges' approaches.
  if (distToPolyline(x, z, [[-793, -54], [-734, -145]]) < 9) return true;
  if (distToPolyline(x, z, [[-73, -326], [-100, -424]]) < 9) return true;
  return false;
}

// ---------------------------------------------------------------- props in lanes and gardens
function townProps(scene: THREE.Scene) {
  const P = (id: PropId, x: number, z: number, ry: number, s: number) => placeProp(scene, id, x, 0, z, ry, s);
  let k = 0;
  for (const l of lay.lots) {
    if (!l.front || (k++ % 4) !== 0) continue;
    const f = l.front, t = rand01(l.id * 1.7);
    const x = f.a.x + (f.b.x - f.a.x) * t + f.out.x * 0.45, z = f.a.y + (f.b.y - f.a.y) * t + f.out.y * 0.45;
    const u = rand01(l.id * 3.1);
    if (u < 0.22) P('wine_barrel_01', x, z, u * 20, 0.85);
    else if (u < 0.4) P(u < 0.3 ? 'planter_pot_clay' : 'ceramic_pot', x, z, u * 9, 1.5);
    else if (u < 0.52) P('wicker_basket_02', x, z, u * 7, 1);
    else if (u < 0.62) P('wooden_bucket_01', x, z, u * 5, 1);
    else if (u < 0.7) P('street_rat', x, z, u * 11, 1);
    else P(u < 0.85 ? 'weed_plant_02' : 'nettle_plant', x, z, u * 13, 3);
  }
  for (const p of lay.plots) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of p.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const n = Math.min(40, Math.round(((x1 - x0) * (z1 - z0)) / (p.kind === 'pratum' ? 18 : 30)));
    for (let i = 0; i < n; i++) {
      const x = x0 + (x1 - x0) * rand01(p.seed % 9973 + i * 1.31), z = z0 + (z1 - z0) * rand01(p.seed % 7919 + i * 2.17);
      if (!inPoly(x, z, p.pts)) continue;
      const u = rand01(i * 5.3 + p.seed % 101);
      const id: PropId = p.kind === 'orto' ? (u < 0.5 ? 'weed_plant_02' : 'grass_medium_02') : p.kind === 'ruina' ? (u < 0.4 ? 'nettle_plant' : u < 0.7 ? 'rock_moss_set_02' : 'fern_02') : (u < 0.5 ? 'grass_medium_02' : u < 0.8 ? 'weed_plant_02' : 'shrub_02');
      P(id, x, z, u * 30, id === 'rock_moss_set_02' ? 0.6 : id === 'shrub_02' ? 0.7 : id.startsWith('grass') ? 0.9 : 3.2);
    }
  }
  commitProps(scene);
}

// ---------------------------------------------------------------- the town texture
/** RGBA over the whole world at 1 m: R Roman paving (main), G any street or road, B gutter, A terrain height. */
export const TOWN_TEX = { x0: BOUNDS.x0, z0: BOUNDS.z0, w: Math.ceil(BOUNDS.x1 - BOUNDS.x0), h: Math.ceil(BOUNDS.z1 - BOUNDS.z0), hMin: -10, hMax: 110 };
function townTexture(L: Layout): THREE.DataTexture {
  const T = TOWN_TEX, data = new Uint8Array(T.w * T.h * 4);
  const r = L.r;
  for (let j = 0; j < T.h; j++) for (let i = 0; i < T.w; i++) {
    const x = T.x0 + i + 0.5, z = T.z0 + j + 0.5, o = (j * T.w + i) * 4;
    data[o + 3] = Math.round(THREE.MathUtils.clamp((fastTerrain(x, z) - T.hMin) / (T.hMax - T.hMin), 0, 1) * 255);
    const k = r.idx(x, z);
    if (k < 0) continue;
    data[o] = r.main[k];
    data[o + 1] = r.grid[k] === STREET ? (r.trod[k] ? 255 : 40) : 0;
  }
  // Roads outside the walls: beaten earth, the Appia and the Traiana still paved in places.
  for (const rd of ROADS) {
    const paved = rd.name === 'Via Appia' || rd.name === 'Via Traiana';
    for (let k = 0; k < rd.pts.length - 1; k++) {
      const a = rd.pts[k], c = rd.pts[k + 1], L2 = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let s = 0; s <= L2; s += 0.5) {
        const px = a[0] + ((c[0] - a[0]) * s) / L2, pz = a[1] + ((c[1] - a[1]) * s) / L2;
        for (let dz = -rd.w / 2; dz <= rd.w / 2; dz += 0.7) for (let dx = -rd.w / 2; dx <= rd.w / 2; dx += 0.7) {
          if (dx * dx + dz * dz > (rd.w / 2) ** 2) continue;
          const i = Math.floor(px + dx - T.x0), j = Math.floor(pz + dz - T.z0);
          if (i < 0 || j < 0 || i >= T.w || j >= T.h) continue;
          const o = (j * T.w + i) * 4;
          data[o + 1] = 255;
          if (paved && rand01(i * 0.37 + j * 1.13) < 0.55) data[o] = 200;
        }
      }
    }
  }
  const tex = new THREE.DataTexture(data, T.w, T.h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- where am I
export function regionName(p: THREE.Vector3): string {
  const ly = p.y - fastTerrain(p.x, p.z);
  const near = (s: SiteDef, r: number) => Math.hypot(p.x - s.x, p.z - s.z) < r;
  const S = SITES;
  if (ly < -2.4) {
    if (near(S.hortusSophiae, 30)) return 'Cisterna';
    return 'Catacumbae Sanctorum Quadraginta';
  }
  for (const g of GATES) if (Math.hypot(p.x - g.at[0], p.z - g.at[1]) < 8) return g.name;
  const named: [SiteDef, number][] = [[S.curtis, 26], [S.episcopium, 30], [S.forum, 18], [S.theatrum, 50], [S.thermae, 28], [S.amphitheatrum, 55], [S.quadraginta, 48],
    [S.turrisCatenae, 14], [S.sanctusHilarius, 16], [S.sanctusPetrus, 32], [S.iseum, 22], [S.necropolis, 28], [S.nux, 14], [S.molendinum, 14], [S.hortusSophiae, 16], [S.pontesLeprosus, 50], [S.pontesOnuphrii, 45]];
  for (const [s, r] of named) if (near(s, r)) return s.name;
  for (const d of DISTRICTS) if (d.poly && inPoly(p.x, p.z, d.poly)) return d.name;
  const rv = riverAt(p.x, p.z, 40);
  if (rv && rv.d < rv.w / 2 + 25) return rv.river.name === 'Calor' ? 'Ripa Caloris' : 'Ripa Sabbati';
  if (insideWalls(p.x, p.z)) return 'Beneventum';
  return 'Extra Muros';
}
void density; void toLocalXZ; void terrain; void rotZTo; void CIVITAS_NOVA;
