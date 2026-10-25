import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadGltf } from '../gltf';
import type { Builder } from '../builder';
import { rng } from '../builder';
import { shared } from '../materials';
import { noiseGLSL, atmosGLSL } from '../shaders';
import { field, fastTerrain } from '../displace';
import { insideness, type P2 } from './geo';
import { SITES, GATES, siteToWorld, type SiteDef } from './sites';
import { wallPlan } from './fabric';
import type { Layout } from './layout';
import { markReadableWorld } from './readables';
import { LORE } from './lore';
import { ponsAt } from './pontefratto';
import META from './spolia.models.json';

// Spolia: broken Roman sculpture where Benevento's Lombards left it in AD 700.
// The walls of the late-antique and Lombard circuit were built with whatever
// the Roman town and its cemeteries offered: funerary portraits, reliefs,
// inscriptions, heads, altars and column pieces are still set in the faces of
// Benevento's walls (Bertelli Buquicchio 1992; Rotili 1986), and the Iseum's
// Egyptian statues turn up built into the walls by the east gate. Here:
//  - set in the outer face of the curtain all round (more by Porta Rufina, the
//    Arcus Sacramenti and Porta Summa, where the Isiac pieces are), in gate
//    jambs, and low in house fronts;
//  - lying broken in the ruins outside (theatre, amphitheatre, baths, Santi
//    Quaranta), half sunk in the ground;
//  - put to use: a cuirassed emperor on his base in the forum, a sarcophagus
//    for a Lombard grave, another as a trough at the mill and by wells, an
//    altar as a milestone at Ponte Fratto, a torso as a mounting block;
//  - the Iseum's Egyptian pieces round the Iseum, wherever SITES.iseum is.
// Every placement is computed from the layout (walls, gates, lots, sites) and
// tested against the collision of what is already built, so the pieces follow
// the town when it changes. Models: public/models/spolia (see CREDITS.md),
// drawn as instanced meshes, near and far versions, culled into the fog.

export type SpoliaId = keyof typeof META;
const IDS = Object.keys(META) as SpoliaId[];
const SIZE = (id: SpoliaId) => new THREE.Vector3(...(META[id].size as [number, number, number]));

interface Piece { id: SpoliaId; m: THREE.Matrix4; range: number; label?: string; view?: P2 }
const PIECES: Piece[] = [];
/** How many pieces went where (for the report and the debug hook). */
export const SPOLIA_STATS: Record<string, number> = {};
const count = (k: string) => { SPOLIA_STATS[k] = (SPOLIA_STATS[k] ?? 0) + 1; const p = PIECES[PIECES.length - 1]; if (p && !p.label) p.label = k; };

const rand = rng(70011);
const R = (a: number, b: number) => a + (b - a) * rand();
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];

// ---------------------------------------------------------------- placing
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m3 = new THREE.Matrix3(), gv = new THREE.Vector3();
/** World half-extents of a piece's box under a rotation. */
function halfExtents(id: SpoliaId, rot: THREE.Quaternion, s: number) {
  const sz = SIZE(id).multiplyScalar(s / 2);
  _m3.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rot));
  const e = _m3.elements; // column-major
  return new THREE.Vector3(
    Math.abs(e[0]) * sz.x + Math.abs(e[3]) * sz.y + Math.abs(e[6]) * sz.z,
    Math.abs(e[1]) * sz.x + Math.abs(e[4]) * sz.y + Math.abs(e[7]) * sz.z,
    Math.abs(e[2]) * sz.x + Math.abs(e[5]) * sz.y + Math.abs(e[8]) * sz.z,
  );
}
/** Put a piece so that the centre of its box lands on c (world). */
function put(id: SpoliaId, c: THREE.Vector3, rot: THREE.Quaternion, s: number, range: number) {
  // The model's origin is the middle of its base: its box centre is (0, h/2, 0).
  const off = new THREE.Vector3(0, SIZE(id).y * s / 2, 0).applyQuaternion(rot);
  const m = new THREE.Matrix4().compose(c.clone().sub(off), rot, new THREE.Vector3(s, s, s));
  PIECES.push({ id, m, range });
}
const groundY = (x: number, z: number) => field(x, 0, z, 'ground', gv).y + fastTerrain(x, z);

/**
 * Lying or standing on the ground, sunk by `sink` of its height. Tilt is
 * applied before the turn (rx, rz in the piece's frame, then ry).
 */
function onGround(id: SpoliaId, x: number, z: number, ry: number, o: { rx?: number; rz?: number; sink?: number; s?: number; collide?: Builder; range?: number; y?: number } = {}) {
  const s = o.s ?? 1;
  _e.set(o.rx ?? 0, ry, o.rz ?? 0, 'YXZ');
  const q = _q.setFromEuler(_e).clone();
  const he = halfExtents(id, q, s);
  const g = o.y ?? groundY(x, z);
  const c = new THREE.Vector3(x, g + he.y * (1 - 2 * (o.sink ?? 0.15)), z);
  put(id, c, q, s, o.range ?? 70);
  PIECES[PIECES.length - 1].view = [x + 3.2, z + 3.2];
  if (o.collide && he.y * 2 * (1 - (o.sink ?? 0.15)) > 0.3) {
    const box = new THREE.BoxGeometry(he.x * 1.7, he.y * 2, he.z * 1.7).translate(c.x, c.y, c.z).toNonIndexed();
    o.collide.collideWorld(box);
  }
  return c;
}
/**
 * Set in a wall face: face point (x, z) at hAbove over the ground there, the
 * piece's front (+z) facing `out`, sticking out by `proud` of its depth.
 */
function inWall(id: SpoliaId, x: number, z: number, out: P2, hAbove: number, o: { roll?: number; proud?: number; s?: number; range?: number; mat?: 'stone' | 'rubble' } = {}) {
  const s = o.s ?? 1;
  _e.set(0, Math.atan2(out[0], out[1]), o.roll ?? 0, 'YXZ');
  const q = _q.setFromEuler(_e).clone();
  const he = halfExtents(id, q, s);
  const depth = Math.abs(out[0]) * he.x + Math.abs(out[1]) * he.z;
  // The wall's surface is bent by the same field as its masonry.
  field(x, hAbove, z, o.mat ?? 'rubble', gv);
  const fx = x + gv.x, fz = z + gv.z;
  const k = (o.proud ?? 0.3) * 2 * depth - depth;
  const c = new THREE.Vector3(fx + out[0] * k, fastTerrain(x, z) + hAbove + gv.y, fz + out[1] * k);
  put(id, c, q, s, o.range ?? 75);
  PIECES[PIECES.length - 1].view = [c.x + out[0] * 5, c.z + out[1] * 5];
  return c;
}

// ---------------------------------------------------------------- what is free
/**
 * Occupancy of the ground: 1 m cells where some collision surface stands
 * more than 0.3 m above the terrain (walls, houses, ruins, trunks), gathered
 * once from the builders' colliders.
 */
class Occupancy {
  cells = new Set<number>();
  constructor(builders: Builder[], areas: { x: number; z: number; r: number }[]) {
    // Cells of 32 m worth looking at: round the sites and along the circuit.
    const roi = new Set<number>();
    const K = (x: number, z: number) => Math.floor(x / 32) * 4096 + Math.floor(z / 32);
    for (const a of areas) for (let x = a.x - a.r; x <= a.x + a.r + 31; x += 32) for (let z = a.z - a.r; z <= a.z + a.r + 31; z += 32) roi.add(K(x, z));
    const inArea = (x: number, z: number) => roi.has(K(x, z));
    const mark = (x: number, z: number, y: number) => {
      const h = y - groundY(x, z);
      if (h > 0.45 && h < 12) this.cells.add(Math.floor(x) * 8192 + Math.floor(z));
    };
    for (const b of builders) for (const g of b.colliders) {
      const P = g.attributes.position.array as ArrayLike<number>;
      for (let t = 0; t + 8 < P.length; t += 9) {
        const ax = P[t], az = P[t + 2], bx = P[t + 3], bz = P[t + 5], cx = P[t + 6], cz = P[t + 8];
        const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
        const ext = Math.max(Math.abs(ax - mx), Math.abs(bx - mx), Math.abs(cx - mx), Math.abs(az - mz), Math.abs(bz - mz), Math.abs(cz - mz));
        if (!inArea(mx, mz) && ext < 30) continue;
        if (ext > 400) continue;
        const n = Math.min(40, Math.ceil(ext / 0.7));
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v;
          const x = ax * w + bx * u + cx * v, z = az * w + bz * u + cz * v;
          if (inArea(x, z)) mark(x, z, P[t + 1] * w + P[t + 4] * u + P[t + 7] * v);
        }
      }
    }
  }
  free(x: number, z: number, r: number) {
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let j = Math.floor(z - r); j <= Math.floor(z + r); j++) if (this.cells.has(i * 8192 + j)) return false;
    return true;
  }
  take(x: number, z: number, r: number) {
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let j = Math.floor(z - r); j <= Math.floor(z + r); j++) this.cells.add(i * 8192 + j);
  }
}

/** A free spot near a site (local ring r0..r1 round a local centre), or null. */
function spotNear(occ: Occupancy, s: SiteDef, r0: number, r1: number, clear: number, lc: P2 = [s.lx ?? 0, s.lz ?? 0], tries = 60): P2 | null {
  for (let k = 0; k < tries; k++) {
    const a = R(0, Math.PI * 2), r = R(r0, r1);
    const [x, z] = siteToWorld(s, lc[0] + Math.cos(a) * r, lc[1] + Math.sin(a) * r);
    if (!occ.free(x, z, clear)) continue;
    // Keep off steep ground and out of the rivers.
    const sl = Math.hypot(fastTerrain(x + 1, z) - fastTerrain(x - 1, z), fastTerrain(x, z + 1) - fastTerrain(x, z - 1)) / 2;
    if (sl > 0.35) continue;
    occ.take(x, z, clear);
    return [x, z];
  }
  return null;
}

// ---------------------------------------------------------------- the readables
Object.assign(LORE, {
  spoliaTitulus: {
    id: 'spoliaTitulus', title: 'A gravestone in the wall', kind: 'inscription', status: 'style', range: 5,
    latin: 'D · M\n[...]AE · CONIVGI\nB · M · F',
    english: '"To the spirits of the dead. [...] to his wife, well deserving, made this." A Roman tombstone from the cemeteries along the roads, set into the town wall upside down among river stones. Many of Benevento\'s walls are built like this.',
    source: 'Formula of Roman epitaphs (Dis Manibus, bene merenti fecit); this text is illustrative. Spolia in the walls: Bertelli Buquicchio (1992), Rotili (1986).',
  },
  spoliaImperator: {
    id: 'spoliaImperator', title: 'The iron man', kind: 'note', status: 'style', range: 4,
    latin: 'ferreus homo',
    english: 'A headless emperor in a breastplate still stands on his base at the edge of the market. Nobody remembers who he was. The children call him the iron man and say that at night he walks to the river to look for his head.',
    source: 'Invented. Cuirassed statues of emperors stood in every Roman forum; their heads were often taken away or reused first.',
  },
  spoliaSphinx: {
    id: 'spoliaSphinx', title: 'The stone lion with a face', kind: 'note', status: 'style', range: 5,
    latin: 'leo cum facie hominis',
    english: 'A lion with a man\'s face, of dark Egyptian stone, laid in the wall like any other block. Domitian brought such beasts from Egypt for the temple of Isis; now they are building stone. In later centuries sphinxes and an Apis bull from the Iseum will be dug out of Benevento\'s walls.',
    source: 'Egyptian sculpture of the Iseum found reused in Benevento (Museo del Sannio): Treccani EAA "Benevento"; H. W. Müller, Il culto di Iside nell\'antica Benevento (1971).',
  },
});

// ---------------------------------------------------------------- the plan
const WALL_KINDS: SpoliaId[] = ['relief_couple', 'relief_funerary', 'tondo', 'lion', 'sarcophagus_seasons', 'altar_grave', 'head_priestess', 'bust_man', 'bust_aurelius', 'torso_dionysus', 'torso_woman', 'capital'];
const HOUSE_KINDS: SpoliaId[] = ['head_priestess', 'bust_man', 'head_priestess', 'relief_funerary'];
const RUIN_KINDS: SpoliaId[] = ['torso_apollo', 'torso_woman', 'torso_dionysus', 'capital', 'foot_colossal', 'bust_aurelius', 'altar_grave', 'lion_corbridge', 'relief_funerary', 'tondo', 'sarcophagus'];

function walls(b: Builder, occ: Occupancy) {
  const wp = wallPlan();
  const g = (id: string) => GATES.find((q) => q.id === id)?.at;
  const hot: { at?: P2; r: number; w: number }[] = [{ at: g('rufina'), r: 130, w: 0.55 }, { at: g('sacramenti'), r: 110, w: 0.45 }, { at: g('summa'), r: 90, w: 0.4 }];
  const towersNear = (x: number, z: number) => wp.towers.some((t) => Math.hypot(t.x + t.ox * 2.4 - x, t.z + t.oz * 2.4 - z) < 7.5);
  const summa = g('summa');
  let egypt = 0;
  for (const w of wp.pieces) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (L < 3) continue;
    const mx = (w.a[0] + w.b[0]) / 2, mz = (w.a[1] + w.b[1]) / 2;
    let p = 0.16;
    for (const h of hot) if (h.at && Math.hypot(mx - h.at[0], mz - h.at[1]) < h.r) p += h.w;
    if (rand() > p) continue;
    const t = R(0.2, 0.8), x = w.a[0] + (w.b[0] - w.a[0]) * t + w.out[0] * 1.25, z = w.a[1] + (w.b[1] - w.a[1]) * t + w.out[1] * 1.25;
    if (towersNear(x, z) || !occ.free(x + w.out[0] * 2.2, z + w.out[1] * 2.2, 0.3)) continue;
    // By Porta Summa the Iseum's beasts were built into the wall.
    if (summa && egypt < 2 && Math.hypot(mx - summa[0], mz - summa[1]) < 60) {
      const id: SpoliaId = egypt === 0 ? 'sphinx' : 'ram_amun';
      inWall(id, x, z, w.out, R(0.2, 0.5), { proud: 0.35, roll: id === 'ram_amun' ? 0 : 0 });
      egypt++; count('wall'); count('wall:egyptian');
      if (id === 'sphinx') markReadableWorld('spoliaSphinx', x + w.out[0] * 0.8, 1.2, z + w.out[1] * 0.8);
      continue;
    }
    const id = pick(WALL_KINDS);
    const lying = id.startsWith('torso');
    const h = lying ? R(2.0, 3.5) : id === 'sarcophagus_seasons' ? R(1.8, 2.6) : R(2.2, 6.2);
    // Torsos go in as building blocks, on their sides; a few slabs upside down.
    const roll = lying ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : id === 'altar_grave' || id.startsWith('relief') ? (rand() < 0.2 ? Math.PI : 0) : 0;
    const proud = id.startsWith('head') || id.startsWith('bust') ? 0.55 : lying ? 0.45 : id === 'capital' || id === 'altar_grave' ? 0.3 : 0.4;
    // Funerary stelae and portraits came in all sizes; most built in are big ones.
    const sc = id.startsWith('relief') || id === 'tondo' || id === 'altar_grave' ? R(1.25, 1.7) : id.startsWith('head') ? R(1.3, 1.8) : id.startsWith('bust') ? R(1.05, 1.3) : 1;
    inWall(id, x, z, w.out, h, { roll, proud, s: sc, range: id.startsWith('head') ? 50 : 80 });
    count('wall');
  }
  // The gravestone with a readable text, low by Porta Rufina.
  const ru = wp.pieces.filter((w) => { const r = g('rufina'); return r && Math.hypot((w.a[0] + w.b[0]) / 2 - r[0], (w.a[1] + w.b[1]) / 2 - r[1]) < 30; });
  const ruOk = ru.filter((w) => { const x = (w.a[0] + w.b[0]) / 2 + w.out[0] * 2.4, z = (w.a[1] + w.b[1]) / 2 + w.out[1] * 2.4; return !towersNear(x, z) && occ.free(x, z, 0.8); });
  if (ruOk.length) {
    const w = ruOk[0], x = w.a[0] + (w.b[0] - w.a[0]) * 0.5 + w.out[0] * 1.25, z = w.a[1] + (w.b[1] - w.a[1]) * 0.5 + w.out[1] * 1.25;
    inWall('altar_grave', x, z, w.out, 1.9, { roll: Math.PI, proud: 0.3 });
    count('wall');
    markReadableWorld('spoliaTitulus', x + w.out[0] * 0.9, 1.5, z + w.out[1] * 0.9);
  }
  // Gate jambs: a piece low on each side of the opening, on the gate's outer face.
  for (const gt of wp.gates) {
    const open = gt.main ? 3.4 : 2.4;
    let n: P2 = [-gt.dz, gt.dx];
    if (insideness(gt.x + n[0] * 6, gt.z + n[1] * 6) > 0.5) n = [-n[0], -n[1]];
    for (const side of [-1, 1]) {
      if (rand() < 0.25) continue;
      const u = side * (open / 2 + R(0.7, 1.1));
      const x = gt.x + gt.dx * u + n[0] * 1.5, z = gt.z + gt.dz * u + n[1] * 1.5;
      if (!occ.free(x + n[0] * 2.0, z + n[1] * 2.0, 0.3)) continue;
      const id = pick(['relief_funerary', 'altar_grave', 'head_priestess', 'tondo', 'bust_man'] as SpoliaId[]);
      inWall(id, x, z, n, id === 'altar_grave' ? R(0.0, 0.3) : R(1.4, 2.6), { proud: id.startsWith('head') || id.startsWith('bust') ? 0.5 : 0.3, roll: id === 'altar_grave' && rand() < 0.5 ? Math.PI / 2 : 0, s: id === 'altar_grave' ? 0.9 : 1 });
      count('gate');
    }
  }
}

function houses(lay: Layout, occ: Occupancy) {
  let k = 0;
  for (const l of lay.lots) {
    if (!l.front || l.explore || l.h < 3.5) continue;
    if ((k++ * 7919 + l.id * 31) % 23 !== 0) continue;
    const f = l.front, L = f.a.distanceTo(f.b);
    if (L < 3) continue;
    // In the 0.4 m at either end of a front no door or window is ever cut (arch/facade.ts).
    const end = rand() < 0.5 ? 0 : 1, u = end ? L - 0.22 : 0.22;
    const e = f.b.clone().sub(f.a).normalize();
    const x = f.a.x + e.x * u, z = f.a.y + e.y * u;
    if (!occ.free(x + f.out.x * 1.0, z + f.out.y * 1.0, 0.4)) continue;
    const id = pick(HOUSE_KINDS);
    if (id === 'relief_funerary' && L < 4) continue;
    inWall(id, x - (id === 'relief_funerary' ? 0 : 0), z, [f.out.x, f.out.y], id === 'relief_funerary' ? R(0.1, 0.4) : R(1.75, 2.4), { proud: id === 'relief_funerary' ? 0.25 : 0.5, s: id === 'relief_funerary' ? 0.6 : 1, mat: 'stone', range: 45 });
    count('house');
  }
}

function ruins(occ: Occupancy, b: Builder) {
  const S = SITES;
  const scatter = (s: SiteDef | undefined, n: number, r0: number, r1: number, label: string, kinds = RUIN_KINDS) => {
    if (!s) return;
    for (let i = 0; i < n; i++) {
      const id = pick(kinds);
      const sz = SIZE(id);
      const p = spotNear(occ, s, r0, r1, Math.max(sz.x, sz.z) * 0.6 + 0.3);
      if (!p) continue;
      // Fallen: torsos and busts on their backs or sides, the rest tipped and sunk.
      const fallen = id.startsWith('torso') || id.startsWith('bust') ? pick([-Math.PI / 2, Math.PI / 2, 1.3]) : R(-0.25, 0.25);
      onGround(id, p[0], p[1], R(0, 6.28), { rx: fallen, rz: R(-0.2, 0.2), sink: R(0.12, 0.35), collide: b });
      count(label);
    }
  };
  scatter(S.theatrum, 5, 20, 60, 'theatrum');
  scatter(S.amphitheatrum, 4, 30, 70, 'amphitheatrum');
  scatter(S.thermae, 3, 8, 30, 'thermae');
  scatter(S.quadraginta, 3, 10, 40, 'quadraginta');
  scatter(S.sanctusHilarius, 1, 6, 14, 'hilarius', ['capital', 'altar_grave']);
  scatter(S.arcusSacramenti, 2, 5, 14, 'sacramenti', ['capital', 'foot_colossal', 'tondo']);

  // The forum: a headless emperor in a breastplate still on his base; a capital and drums for seats.
  const fo = S.forum;
  if (fo) {
    const p = spotNear(occ, fo, 6, 18, 1.4);
    if (p) {
      const g = groundY(p[0], p[1]);
      b.box('marble', 1.15, 1.25, 0.95, p[0], g - fastTerrain(p[0], p[1]) - 0.2, p[1], R(0, 6.28));
      onGround('torso_emperor', p[0], p[1], R(0, 6.28), { y: g + 1.05, sink: 0, range: 80 });
      markReadableWorld('spoliaImperator', p[0], 1.6, p[1]);
      count('forum');
    }
    for (let i = 0; i < 2; i++) { const q = spotNear(occ, fo, 4, 16, 0.8); if (q) { onGround('capital', q[0], q[1], R(0, 6.28), { sink: 0.2, collide: b }); count('forum'); } }
  }
  // The bishop's church: a Roman sarcophagus reused for a burial in the atrium, a lion by the door.
  const ep = S.episcopium;
  if (ep) {
    const q = spotNear(occ, ep, 0, 9, 1.3, [-16, -35]);
    if (q) { onGround('sarcophagus', q[0], q[1], ep.rot + R(-0.1, 0.1), { sink: 0.05, collide: b }); count('episcopium'); }
    const l = spotNear(occ, ep, 0, 7, 0.8, [-16, -38]);
    if (l) { onGround('lion_corbridge', l[0], l[1], ep.rot + Math.PI + R(-0.2, 0.2), { sink: 0.02, collide: b }); count('episcopium'); }
  }
  // The Lombard cemetery: a noble buried in a Roman sarcophagus, its lid beside it.
  if (S.necropolis) {
    const q = spotNear(occ, S.necropolis, 4, 20, 1.6);
    if (q) { onGround('sarcophagus_seasons', q[0], q[1], Math.PI / 2 + R(-0.1, 0.1), { sink: 0.1, collide: b }); count('necropolis'); }
  }
  // The mill: a sarcophagus as the trough by the leat.
  if (S.molendinum) {
    const q = spotNear(occ, S.molendinum, 3, 10, 1.3);
    if (q) { onGround('sarcophagus', q[0], q[1], R(0, 6.28), { sink: 0.12, collide: b }); count('molendinum'); }
  }
  // The Iseum: whatever the site's frame is, its Egyptian pieces lie round it.
  const is = S.iseum;
  if (is) {
    const eg: [SpoliaId, number, { rx?: number; rz?: number; sink: number }][] = [
      ['sphinx', 0.6, { sink: 0.3 }], ['pharaoh', 1, { rx: -1.35, sink: 0.25 }], ['isis', 1, { rz: Math.PI / 2 - 0.1, sink: 0.25 }],
      ['apis', 1, { sink: 0.12 }], ['ram_amun', 1, { sink: 0.35 }], ['sarcophagus_lid', 1, { rz: 0.15, sink: 0.25 }],
    ];
    for (const [id, s, o] of eg) {
      const sz = SIZE(id);
      const p = spotNear(occ, is, 6, 20, Math.max(sz.x, sz.z) * 0.55 + 0.3);
      if (!p) continue;
      onGround(id, p[0], p[1], R(0, 6.28), { ...o, s, collide: b });
      count('iseum');
    }
  }
}

/** Along the roads out of town the tombs were; their pieces lie in the verges. */
function roads(occ: Occupancy, b: Builder) {
  const lep = SITES.pontesLeprosus;
  if (lep) for (let i = 0; i < 3; i++) {
    const p = spotNear(occ, lep, 14, 40, 1.3);
    if (p) { onGround(pick(['sarcophagus', 'altar_grave', 'relief_funerary'] as SpoliaId[]), p[0], p[1], R(0, 6.28), { rx: R(-0.3, 0.3), sink: 0.3, collide: b }); count('appia'); }
  }
  // Ponte Fratto: an altar set up on end as a milestone at the east approach; a capital in the shallows.
  const [mx, mz] = ponsAt(34 + 34 + 3, 4.2);
  onGround('altar_grave', mx, mz, R(0, 6.28), { rz: 0.08, sink: 0.12, collide: b });
  const [cx, cz] = ponsAt(-3, 7);
  onGround('capital', cx, cz, R(0, 6.28), { rx: 1.2, sink: 0.4 });
  count('pons'); count('pons');
  // A torso used as a mounting block inside Porta Summa; a drum by a well.
  const su = GATES.find((g) => g.id === 'summa');
  if (su) {
    const dummy: SiteDef = { id: 'su', name: '', x: su.at[0], z: su.at[1], rot: 0 };
    const p = spotNear(occ, dummy, 5, 12, 0.9);
    if (p) { onGround('torso_dionysus', p[0], p[1], R(0, 6.28), { rx: -Math.PI / 2, sink: 0.1, collide: b }); count('step'); }
  }
}

// ---------------------------------------------------------------- the look
/**
 * Museum scans become stones that have stood 600 years in the rain: greyed,
 * dark in their hollows, streaked, crusted with lichen, mossy on top and
 * stained with soil at the foot; then the same fog as everything else.
 */
function weather(m: THREE.MeshStandardMaterial) {
  m.envMapIntensity = 0;
  m.roughness = 0.95; m.metalness = 0;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosS;\nvarying vec3 vObjS;\nvarying vec3 vWNS;\nvarying float vSeedS;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vObjS = position;
        #ifdef USE_INSTANCING
          vWPosS = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNS = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
          vSeedS = dot(instanceMatrix[3].xyz, vec3(0.13, 0.071, 0.17));
        #else
          vWPosS = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNS = normalize(mat3(modelMatrix) * objectNormal);
          vSeedS = 0.0;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPosS;\nvarying vec3 vObjS;\nvarying vec3 vWNS;\nvarying float vSeedS;\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.3, 0.59, 0.11));
          vec3 o = vObjS + vec3(vSeedS * 7.1, vSeedS * 3.3, vSeedS * 5.7);
          // Weathered limestone and marble: grey, a little warm.
          c = mix(c, vec3(lum) * vec3(1.03, 1.0, 0.93), 0.4);
          // Dirt settles in the hollows the scan already shows dark.
          c *= mix(0.45, 1.0, smoothstep(0.05, 0.42, lum));
          // Rain streaks running down.
          float st = vnoise(vec3(o.x * 9.0, o.y * 0.7, o.z * 9.0));
          c *= 1.0 - 0.38 * smoothstep(0.5, 0.85, st);
          // Crustose lichen in patches, grey-green, now and then orange.
          float li = vnoise(o * 4.7) * 0.65 + vnoise(o * 13.0) * 0.35;
          float lm = smoothstep(0.64, 0.72, li);
          vec3 lc = mix(vec3(0.33, 0.35, 0.27), vec3(0.42, 0.27, 0.1), step(0.78, vnoise(o * 1.9 + 4.0)));
          c = mix(c, lc * (0.85 + 0.4 * vnoise(o * 30.0)), lm * 0.45);
          // Moss where water lies: the tops and ledges.
          float up = smoothstep(0.45, 0.9, vWNS.y) * smoothstep(0.4, 0.62, vnoise(o * 2.3 + 9.0));
          c = mix(c, vec3(0.07, 0.09, 0.035) * (0.8 + 0.5 * vnoise(o * 22.0)), up * 0.6);
          // Soil at the foot.
          c = mix(c, vec3(0.07, 0.06, 0.045), (1.0 - smoothstep(0.0, 0.3, vObjS.y)) * 0.55);
          diffuseColor.rgb = c * 0.82;
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.3;
        reflectedLight.indirectSpecular *= 0.3;`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPosS);');
  };
  m.customProgramCacheKey = () => 'spolia-weather' + (m.normalMap ? 'n' : '');
  return m;
}

// ---------------------------------------------------------------- loading and drawing
interface Model { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] }
const models = new Map<string, Model>();
async function loadModel(name: string, loader: GLTFLoader): Promise<Model> {
  const gltf = await loadGltf(`models/spolia/${name}.json`, loader);
  const parts: Model['parts'] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Quantized attributes (int16 / int8, normalized) cannot hold transformed
    // values: widen to floats before baking the node's (dequantizing) matrix.
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(mesh.geometry.attributes)) {
      const src = a as THREE.BufferAttribute, f = new Float32Array(src.count * src.itemSize);
      for (let i = 0; i < src.count; i++) for (let c = 0; c < src.itemSize; c++) f[i * src.itemSize + c] = src.getComponent(i, c);
      g.setAttribute(k, new THREE.BufferAttribute(f, src.itemSize));
    }
    if (mesh.geometry.index) g.setIndex(mesh.geometry.index);
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    // Some scans come unlit (KHR_materials_unlit): always shade them as stone.
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({ map: src.map ?? null, normalMap: src.normalMap ?? null, name: src.name });
    if (src.normalMap) mat.normalScale.set(0.8, 0.8);
    parts.push({ geometry: g, material: weather(mat) });
  });
  return { parts };
}
let loading: Promise<void> | null = null;
/** Fetch every model (near and far): started as soon as this module loads. */
export function loadSpolia() {
  if (!loading) {
    const loader = new GLTFLoader();
    loading = Promise.all(IDS.flatMap((id) => [id, `${id}_lo`]).map(async (n) => {
      try { models.set(n, await loadModel(n, loader)); } catch (e) { console.warn('spolia model failed', n, e); }
    })).then(() => {});
  }
  return loading;
}
if (typeof window !== 'undefined') void loadSpolia();

interface Chunk { c: THREE.Vector3; range: number; hi: THREE.InstancedMesh[]; lo: THREE.InstancedMesh[] }
const CH = 24, NEAR = 16;
function draw(scene: THREE.Scene) {
  const groups = new Map<string, Piece[]>();
  for (const p of PIECES) {
    const pos = new THREE.Vector3().setFromMatrixPosition(p.m);
    const key = `${p.id}|${Math.floor(pos.x / CH)}|${Math.floor(pos.z / CH)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const chunks: Chunk[] = [];
  for (const list of groups.values()) {
    const id = list[0].id, hi = models.get(id), lo = models.get(`${id}_lo`) ?? hi;
    if (!hi || !lo) continue;
    const c = new THREE.Vector3();
    for (const p of list) c.add(new THREE.Vector3().setFromMatrixPosition(p.m));
    c.divideScalar(list.length);
    const mk = (m: Model) => m.parts.map((part) => {
      const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((p, i) => im.setMatrixAt(i, p.m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.visible = false;
      im.matrixAutoUpdate = false;
      scene.add(im);
      return im;
    });
    chunks.push({ c, range: Math.max(...list.map((p) => p.range)), hi: mk(hi), lo: mk(lo) });
  }
  // Distance culling and the near/far switch, from whichever camera renders.
  const empty = new THREE.BufferGeometry();
  empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  const ticker = new THREE.Mesh(empty, new THREE.MeshBasicMaterial());
  ticker.frustumCulled = false;
  const cp = new THREE.Vector3();
  let n = 0;
  ticker.onBeforeRender = (_r, _s, camera) => {
    if (n++ % 3) return;
    camera.getWorldPosition(cp);
    for (const ch of chunks) {
      const d = ch.c.distanceTo(cp);
      const near = d < NEAR + CH * 0.5, far = !near && d < ch.range;
      for (const m of ch.hi) m.visible = near;
      for (const m of ch.lo) m.visible = far;
    }
  };
  scene.add(ticker);
  (window as unknown as { __spolia: () => unknown }).__spolia = () => {
    const near = PIECES.map((p) => ({ id: p.id, p: new THREE.Vector3().setFromMatrixPosition(p.m) })).map((q) => ({ id: q.id, d: +q.p.distanceTo(cp).toFixed(1), at: q.p.toArray().map((v) => +v.toFixed(1)) })).sort((a, b) => a.d - b.d).slice(0, 4);
    return { list: PIECES.map((p) => ({ id: p.id, label: p.label, at: new THREE.Vector3().setFromMatrixPosition(p.m).toArray(), view: p.view })), pieces: PIECES.length, chunks: chunks.length, visible: chunks.reduce((a, c) => a + c.hi.concat(c.lo).filter((m) => m.visible).length, 0), near, stats: SPOLIA_STATS };
  };
}

/**
 * Place every piece (call once the landmarks, the town's collision and the
 * wood are built: `builders` are searched for free ground), add colliders to
 * `b`, then wait for the models and add their instances to the scene.
 */
export async function buildSpolia(scene: THREE.Scene, b: Builder, builders: Builder[], lay: Layout) {
  const S = SITES;
  const areas = [S.theatrum, S.amphitheatrum, S.thermae, S.quadraginta, S.sanctusHilarius, S.arcusSacramenti, S.forum, S.episcopium, S.necropolis, S.molendinum, S.iseum, S.pontesLeprosus]
    .filter(Boolean).map((s) => ({ x: s.x, z: s.z, r: 90 }));
  const su = GATES.find((g) => g.id === 'summa');
  if (su) areas.push({ x: su.at[0], z: su.at[1], r: 20 });
  for (const w of wallPlan().pieces) areas.push({ x: (w.a[0] + w.b[0]) / 2, z: (w.a[1] + w.b[1]) / 2, r: 12 });
  for (const l of lay.lots) if (l.front) areas.push({ x: l.front.a.x, z: l.front.a.y, r: 6 });
  const occ = new Occupancy(builders, areas);
  walls(b, occ);
  houses(lay, occ);
  ruins(occ, b);
  roads(occ, b);
  await loadSpolia();
  draw(scene);
}

/** Test page: one of each model in a row along x at y = 0, then drawn (see tools). */
export async function spoliaTestGrid(scene: THREE.Scene) {
  IDS.forEach((id, i) => put(id, new THREE.Vector3((i % 6) * 2.6 - 6.5, SIZE(id).y / 2 - Math.floor(i / 6) * 2.4, 0), new THREE.Quaternion(), 1, 1000));
  await loadSpolia();
  draw(scene);
}
