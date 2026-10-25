import * as THREE from 'three';
import { Builder, rng } from '../builder';
import type { MatName } from '../materials';
import { Acc, Frame, box as kbox, voussoirs } from '../arch/kit';
import { arcadeGeo } from '../shapes';
import { field, fastTerrain } from '../displace';
import { placeProp } from '../props';
import { buildForest } from '../forest';
import { markReadableWorld } from './readables';
import { LORE } from './lore';
import { DATUM, type P2 } from './geo';
import { CALORE_REAL, CALORE_W } from './cellarulo';

// Ponte Fratto: the Roman bridge of the Via Latina (the branch from Telesia)
// over the Calore at Cellarulo, upstream of the Sabato's mouth (Meomartini
// 1889; Treccani EAA). Called Pons Maior in the old texts, "fratto" (broken)
// from its ruin; today only stumps of its piers show in the river (OSM node
// 3734199956). In AD 700 it is drawn as a Roman bridge of five arches on
// piers with cutwaters, faced with big limestone blocks, its middle arch
// carried off by a flood and spanned with timber on a trestle, the next arch
// half fallen, its approaches on low embankments with the paving robbed.
// The state in 700 is a reconstruction: see docs/benevento/HISTORY.md.
//
// The bridge lies just north of the map baked in geo.json, so this module also
// lays the ground there (heights from cellarulo.ts), its collision, the
// Calore's water along its real course, and the wood along the banks.

const rand = rng(17001);
const R = (a: number, b: number) => a + (b - a) * rand();

// ---------------------------------------------------------------- where
/** Ground this module draws (world x/z): around the bridge, out to where the fog closes. */
const GROUND = { x0: -1460, x1: -1240, z0: -1080, z1: -800 };

/** The crossing: where the real course passes z = -962 (the OSM site of the ruins). */
const CROSS = (() => {
  const P = CALORE_REAL.pts;
  let k = 0;
  for (let i = 0; i < P.length - 1; i++) if (P[i][1] <= -962 && P[i + 1][1] > -962) k = i;
  const a = P[k], b = P[k + 1], t = (-962 - a[1]) / (b[1] - a[1]);
  const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz);
  const level = CALORE_REAL.level[k] + (CALORE_REAL.level[k + 1] - CALORE_REAL.level[k]) * t;
  return { x: a[0] + tx * t, z: -962, flow: [tx / tl, tz / tl] as P2, level: level - DATUM };
})();
/** Along the bridge (west → east), turned 6° off square to the stream, as Roman crossings often are. */
const SKEW = 0.1;
const U: P2 = (() => { const [fx, fz] = CROSS.flow; const ux = -fz, uz = fx; const c = Math.cos(SKEW), s = Math.sin(SKEW); const x = ux * c - uz * s, z = ux * s + uz * c; return x > 0 ? [x, z] : [-x, -z]; })();
/** Across the bridge, pointing downstream (south). */
const Wd: P2 = (() => { const w: P2 = [-U[1], U[0]]; return w[1] > 0 ? w : [-w[0], -w[1]]; })();
export const ponsAt = (s: number, w = 0): P2 => [CROSS.x + U[0] * s + Wd[0] * w, CROSS.z + U[1] * s + Wd[1] * w];
const at = ponsAt;
const RY = Math.atan2(-U[1], U[0]);

const WIDTH = 6.4, BAY = 12, PIER = 3.2, OPEN = BAY - PIER, RAD = OPEN / 2;
const L = CROSS.level;
const SPRING = L + 1.7, DECK = L + 7.4;
/** Arch centres along the bridge (s), and which are broken. */
const ARCHES = [-24, -12, 0, 12, 24];
const END = 30 + 0.6 + 3.2; // abutments
const RAMP = 34;

/** Places for the map, the teleports and the region name. */
export const PONS = { name: 'Pons Maior', alt: 'Ponte Fratto', x: CROSS.x, z: CROSS.z, r: 70 };
export function ponsTeleport() {
  const [x, z] = at(END + RAMP * 0.75, 0.6), [lx, lz] = at(0, 0);
  return { name: 'Pons Maior (Ponte Fratto)', x, z, y: fastTerrain(x, z) + 2.2, yaw: Math.atan2(-(lx - x), -(lz - z)) };
}
export const inPons = (x: number, z: number) => Math.hypot(x - PONS.x, z - PONS.z) < PONS.r;

// ---------------------------------------------------------------- readables
Object.assign(LORE, {
  pontisTitulus: {
    id: 'pontisTitulus', title: 'A block in the river', kind: 'inscription', status: 'style', range: 5,
    latin: '[...] VIAM · ET · PONTEM\nVETVSTATE · CONLAPSVM\nPECVNIA · SVA · RESTITVIT',
    english: '"[...] restored at his own cost the road and the bridge, fallen down through age." Part of the building inscription has come down with the middle arch and lies in the shallows. The formula is the old one; the bridge has fallen again, and the duke\'s men have laid timber across the gap.',
    source: 'Formula of Roman road and bridge restorations ("vetustate conlapsum restituit"); this text is illustrative. The bridge: Meomartini (1889), Treccani EAA "Benevento".',
  },
  pontisNomen: {
    id: 'pontisNomen', title: 'Carved on the trestle', kind: 'graffito', status: 'style', range: 3,
    latin: '+ PONS MAIOR · FRACTVS EST · REFECIT AUDO GASTALDIVS',
    english: '"The Great Bridge is broken. Audo the gastald\'s man mended it." Someone has cut it into the post of the timber trestle. Nine centuries later the ruin is still called Ponte Fratto, the broken bridge.',
    source: '"Pons maior" for Ponte Fratto in the old texts (Archeomedia, Cellarulo); name and repair invented.',
  },
});

// ---------------------------------------------------------------- the ground and the water
function ground(b: Builder) {
  const st = 1.28;
  const nx = Math.round((GROUND.x1 - GROUND.x0) / st), nz = Math.round((GROUND.z1 - GROUND.z0) / st);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), nor = new Float32Array((nx + 1) * (nz + 1) * 3), idx: number[] = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = (j * (nx + 1) + i) * 3;
    pos[k] = GROUND.x0 + i * st; pos[k + 2] = GROUND.z0 + j * st; nor[k + 1] = 1;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, c = a + 1, d = a + nx + 1, e = d + 1;
    idx.push(a, d, c, c, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  b.add(g, 'ground', undefined, false, true);
  // Collision: a 2 m grid on the same surface.
  const cs = 2, cx = Math.round((GROUND.x1 - GROUND.x0) / cs), cz = Math.round((GROUND.z1 - GROUND.z0) / cs);
  const gv = new THREE.Vector3();
  const Y = (x: number, z: number) => field(x, 0, z, 'ground', gv).y + fastTerrain(x, z);
  const H: number[] = [];
  for (let j = 0; j <= cz; j++) for (let i = 0; i <= cx; i++) H.push(Y(GROUND.x0 + i * cs, GROUND.z0 + j * cs));
  const cp: number[] = [];
  for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) {
    const x = GROUND.x0 + i * cs, z = GROUND.z0 + j * cs;
    const a = H[j * (cx + 1) + i], c = H[j * (cx + 1) + i + 1], d = H[(j + 1) * (cx + 1) + i], e = H[(j + 1) * (cx + 1) + i + 1];
    cp.push(x, a, z, x, d, z + cs, x + cs, c, z, x + cs, c, z, x, d, z + cs, x + cs, e, z + cs);
  }
  const c = new THREE.BufferGeometry();
  c.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  b.collideWorld(c);
}

/**
 * The Calore along its real course through the patch, with the same ribbon
 * as rivers.ts (borrowing its material), and the stray stretch of the baked
 * course beyond the map's edge trimmed away.
 */
function water(scene: THREE.Scene) {
  let mat: THREE.Material | null = null;
  const rivers: THREE.Mesh[] = [];
  scene.traverse((o) => { if (o.userData.river) rivers.push(o as THREE.Mesh); });
  for (const m of rivers) {
    mat = m.material as THREE.Material;
    const g = m.geometry, P = g.attributes.position.array as ArrayLike<number>, I = g.index;
    if (!I) continue;
    const src = I.array, keep: number[] = [];
    let cut = 0;
    for (let t = 0; t < src.length; t += 3) {
      let cx = 0, cz = 0;
      for (let q = 0; q < 3; q++) { cx += P[src[t + q] * 3] / 3; cz += P[src[t + q] * 3 + 2] / 3; }
      if (cz < -801.6 && cx < -1100 && cx > -1520) { cut++; continue; }
      keep.push(src[t], src[t + 1], src[t + 2]);
    }
    if (cut) g.setIndex(keep);
  }
  if (!mat) return;
  const Pt = CALORE_REAL.pts, n = Pt.length, ACROSS = 6;
  const pos: number[] = [], flow: number[] = [], edge: number[] = [], idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = Pt[Math.max(0, k - 1)], c = Pt[Math.min(n - 1, k + 1)];
    let dx = c[0] - a[0], dz = c[1] - a[1];
    // Meet the baked ribbon on its own across-line at the map's edge.
    if (k === n - 1) { dx = 1.1; dz = 24; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx, y = CALORE_REAL.level[k] - DATUM, hw = CALORE_W / 2 + 2.5;
    for (let i = 0; i <= ACROSS; i++) {
      const t = (i / ACROSS) * 2 - 1;
      pos.push(Pt[k][0] + nx * hw * t, y, Pt[k][1] + nz * hw * t);
      flow.push(dx, dz);
      edge.push(Math.abs(t));
    }
  }
  for (let k = 0; k < n - 1; k++) for (let i = 0; i < ACROSS; i++) {
    const a = k * (ACROSS + 1) + i, b2 = a + 1, c = a + ACROSS + 1, d = c + 1;
    idx.push(a, b2, c, b2, d, c); // facing up (see rivers.ts)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, mat);
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 1;
  mesh.userData.river = true;
  scene.add(mesh);
}

// ---------------------------------------------------------------- the bridge
/** A frame on the bridge: u along it (from the crossing), v up (absolute), w across (downstream +). */
const F = new Frame(new THREE.Vector3(CROSS.x, 0, CROSS.z), new THREE.Vector3(U[0], 0, U[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Wd[0], 0, Wd[1]));

/** Box in the bridge frame: centre s, w; bottom y (absolute). */
function bbox(b: Builder, m: MatName, s: number, w: number, y: number, ls: number, h: number, lw: number, collide = true, rx = 0, rz = 0, dry = 0) {
  const [x, z] = at(s, w);
  b.box(m, ls, h, lw, x, y, z, RY + dry, collide, rx, rz);
}

/** River bed (absolute) under a point of the bridge. */
const bedAt = (s: number, w = 0) => { const [x, z] = at(s, w); return fastTerrain(x, z); };

function pier(b: Builder, acc: Acc, s: number, top: number, broken = false) {
  const foot = Math.min(bedAt(s, -WIDTH / 2), bedAt(s, WIDTH / 2), bedAt(s)) - 0.8;
  // Core faced with big blocks; a stepped footing of larger ones.
  bbox(b, 'bigstone', s, 0, foot, PIER, top - foot, WIDTH);
  bbox(b, 'bigstone', s, 0, foot, PIER + 0.7, Math.max(0.5, L - foot + 0.5), WIDTH + 0.6, false);
  // Cutwaters: pointed upstream (north, -w), rounder downstream; capped by sloping blocks.
  const cwTop = broken ? top : L + 3.6;
  for (const side of [-1, 1]) {
    const w = side * (WIDTH / 2), d = side < 0 ? PIER / Math.SQRT2 : PIER / Math.SQRT2 * 0.92;
    bbox(b, 'bigstone', s, w, foot, d, cwTop - foot, d, true, 0, 0, Math.PI / 4);
    if (!broken) {
      const [x, z] = at(s, w + side * 0.3);
      b.geo('block', new THREE.ConeGeometry(d * 0.72, 1.6, 4, 1), x, cwTop + 0.8, z, RY + Math.PI / 4, false);
    }
  }
  // Coursed facing showing on the faces: a few proud blocks and open joints.
  for (let y = L + 0.4; y < top - 0.6; y += R(0.55, 0.7)) {
    if (rand() < 0.5) continue;
    for (const side of [-1, 1]) kbox(acc, 'block', F, s + R(-PIER / 2 + 0.6, PIER / 2 - 0.6), y, side * (WIDTH / 2 + 0.02), R(0.35, 0.6), R(0.2, 0.28), 0.12, 0.03);
  }
}

/** Voussoir rings of one arch: the two faces and the barrel between, from angle a0 to a1. */
function arch(acc: Acc, s: number, w0: number, w1: number, a0 = 0, a1 = Math.PI) {
  const rings = Math.max(1, Math.round((w1 - w0) / 1.6));
  for (let i = 0; i < rings; i++) {
    const wa = w0 + ((w1 - w0) * i) / rings, wb = w0 + ((w1 - w0) * (i + 1)) / rings;
    const face = i === 0 || i === rings - 1;
    voussoirs(acc, 'block', F, s, SPRING, RAD, RAD + (face ? 0.85 : 0.6), wa + 0.01, wb - 0.01, a0, a1, face ? 0.5 : 0.75);
  }
}

/** A stretch of deck: paved slab on a bed, walkable, with broken parapets. */
function deck(b: Builder, s0: number, s1: number, w0: number, w1: number, parapets: [boolean, boolean] = [true, true]) {
  const len = s1 - s0, wm = (w0 + w1) / 2;
  bbox(b, 'slab', (s0 + s1) / 2, wm, DECK - 0.45, len, 0.45, w1 - w0);
  for (const [k, w] of [[0, w0 + 0.25], [1, w1 - 0.25]] as const) {
    if (!parapets[k]) continue;
    for (let s = s0; s < s1 - 0.4;) {
      const l = Math.min(s1 - s, R(1.5, 4.5));
      if (rand() < 0.62) bbox(b, 'block', s + l / 2, w, DECK - 0.05, l - 0.05, R(0.35, 0.95), 0.5, true, 0, R(-0.03, 0.03));
      s += l + R(0, 1.5);
    }
  }
}

/** Spandrels and piers of one bay as a solid with its arch cut out (from pier centre to pier centre). */
function bay(b: Builder, s: number, w0: number, w1: number, m: MatName = 'rubble') {
  const foot = Math.min(bedAt(s - BAY / 2), bedAt(s + BAY / 2)) - 0.8;
  const [x, z] = at(s, (w0 + w1) / 2);
  b.geo(m, arcadeGeo(BAY, DECK - 0.45 - foot, w1 - w0, 1, OPEN, SPRING - foot), x, foot, z, RY);
}

function bridge(b: Builder) {
  const acc = new Acc();
  b.absY = 0;
  const W2 = WIDTH / 2;
  // West bank bays (silted, bramble-grown), the river bays, the east bay.
  for (const s of [-24, -12, 24]) { bay(b, s, -W2, W2); arch(acc, s, -W2, W2); }
  // The east river arch: its upstream half has fallen; the downstream half stands.
  bay(b, 12, 0.2, W2);
  arch(acc, 12, 0.2, W2);
  // Springers of the fallen half, and its broken spandrel over the piers.
  arch(acc, 12, -W2, 0.0, 0, 0.55);
  arch(acc, 12, -W2, 0.0, Math.PI - 0.38, Math.PI);
  for (const sp of [6, 18]) for (let i = 0; i < 4; i++) bbox(b, 'rubble', sp + (sp < 12 ? 1 : -1) * R(0.8, 2.2), R(-W2 + 0.4, -0.3), SPRING + R(1.8, 3.6), R(0.8, 1.6), R(0.6, 1.4), R(0.8, 1.6), false, R(-0.2, 0.2), R(-0.2, 0.2));
  // Piers: the four standing to the deck; the middle arch (between ±6) is gone.
  for (const s of [-18, -6, 6, 18]) pier(b, acc, s, DECK - 0.45);
  arch(acc, 0, -W2, W2, 0, 0.42);
  arch(acc, 0, -W2, W2, Math.PI - 0.5, Math.PI);
  // Abutments into the banks, with wing walls.
  for (const side of [-1, 1]) {
    const s = side * (30 + 1.6);
    const foot = bedAt(s) - 1.0;
    bbox(b, 'bigstone', s, 0, foot, 3.2, DECK - 0.45 - foot, WIDTH + 1.2);
    for (const w of [-1, 1]) bbox(b, 'rubble', s + side * 5, w * (W2 + 0.2), foot, 8, DECK - 1.2 - foot, 1.0, true, 0, 0, side * w * 0.35);
  }
  // Deck over the standing arches; the half arch carries a narrow strip.
  deck(b, -END, -6 - PIER / 2, -W2, W2);
  deck(b, -6 - PIER / 2, -6 + PIER / 2, -W2, W2, [false, true]);
  deck(b, 6 - PIER / 2, 6 + PIER / 2, -W2, W2, [false, true]);
  deck(b, 6 + PIER / 2, 18 - PIER / 2, 0.4, W2, [false, true]);
  deck(b, 18 - PIER / 2, END, -W2, W2);
  // Embankments (aggeres) down to the plain, faced with rubble, the paving mostly robbed.
  for (const side of [-1, 1]) {
    const n = 16, top: P2[] = [], bot: P2[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = RAMP * t, g = bedAt(side * (END + x));
      top.push([x, DECK - 0.45 + (g + 0.15 - (DECK - 0.45)) * (t * t * (3 - 2 * t))]);
      bot.push([x, g - 0.8]);
    }
    const prism = (w: number, dy: number) => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.4, bot[0][1]);
      for (const [x, y] of top) sh.lineTo(x, y + dy);
      for (let i = n; i >= 0; i--) sh.lineTo(bot[i][0], bot[i][1]);
      const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false, curveSegments: 1 });
      return g.translate(0, 0, -w / 2);
    };
    const [x0, z0] = at(side * END, 0), ry = Math.atan2(-U[1] * side, U[0] * side);
    b.geo('ground', prism(WIDTH + 0.4, 0), x0, 0, z0, ry);
    for (const w of [-1, 1]) {
      const [x1, z1] = at(side * END, w * (W2 + 0.45));
      b.geo('rubble', prism(0.7, -0.12), x1, 0, z1, ry, false);
    }
    for (let i = 0; i < 40; i++) {
      if (rand() > 0.45) continue;
      const k = Math.floor(rand() * n), x = top[k][0] + R(0, RAMP / n), y = top[k][1] + (top[k + 1][1] - top[k][1]) * ((x - top[k][0]) / (RAMP / n));
      const sl = (top[k + 1][1] - top[k][1]) / (RAMP / n);
      bbox(b, 'slab', side * (END + x), R(-W2 + 0.6, W2 - 0.6), y - 0.12, R(0.6, 1.1), 0.2, R(0.5, 0.9), false, 0, side * Math.atan(sl) + R(-0.04, 0.04), R(-0.2, 0.2));
    }
  }
  // The flood's wreckage: the middle arch lies in the river as tumbled blocks.
  for (let i = 0; i < 46; i++) {
    const s = R(-4.5, 5.5) + (rand() < 0.3 ? R(0, 6) : 0), w = R(-W2 - 3, W2 + 6);
    const y = bedAt(s, w) + R(-0.3, 0.6);
    const big = rand() < 0.35;
    kbox(acc, rand() < 0.7 ? 'block' : 'bigstone', F, s, y, w, big ? R(0.6, 1.0) : R(0.3, 0.55), big ? R(0.35, 0.5) : R(0.2, 0.32), big ? R(0.4, 0.7) : R(0.25, 0.4), 0.05);
  }
  acc.flush(b);
  b.absY = null;
}

/** The timber mending: two spans on a trestle in the stream, a plank walk, a rail. */
function timber(b: Builder) {
  b.absY = 0;
  const s0 = -6 + PIER / 2 - 0.4, s1 = 6 - PIER / 2 + 0.4, top = DECK - 0.45;
  const w = 0.8;
  // Trestle: four raking posts and a cap beam at midstream, braced.
  for (const ws of [-1.4, 1.4]) for (const sd of [-0.5, 0.5]) {
    const foot = bedAt(sd, w + ws) - 0.6;
    bbox(b, 'wood', sd, w + ws, foot, 0.28, top - 0.42 - foot, 0.28, true, sd * 0.06, ws * 0.05);
  }
  bbox(b, 'wood', 0, w, top - 0.62, 1.6, 0.3, 3.6, false);
  for (const ws of [-1.4, 1.4]) bbox(b, 'wood', 0, w + ws, L + 1.6, 2.4, 0.16, 0.16, false, 0, 0.62);
  // Two log stringers each side of the trestle, resting on the pier tops.
  for (const [a, c] of [[s0, 0], [0, s1]]) for (const ws of [-0.8, 0.8]) {
    bbox(b, 'wood', (a + c) / 2, w + ws, top - 0.34, c - a + 0.6, 0.32, 0.34, false);
  }
  // Planks across, uneven, some missing.
  for (let s = s0; s < s1; s += R(0.32, 0.42)) {
    if (rand() < 0.07) continue;
    bbox(b, 'wood', s, w + R(-0.06, 0.06), top - 0.04, R(0.24, 0.32), 0.06, R(2.2, 2.5), false, 0, R(-0.03, 0.03), R(-0.04, 0.04));
  }
  // Walkable surface (one proxy), and a rail of poles on the upstream side.
  bbox(b, 'wood', 0, w, top - 0.06, s1 - s0, 0.06, 2.3, true);
  for (let s = s0 + 0.4; s < s1; s += 2.2) bbox(b, 'wood', s, w - 1.15, top, 0.1, 1.05, 0.1, false, R(-0.05, 0.05), R(-0.05, 0.05));
  bbox(b, 'wood', 0, w - 1.15, top + 0.95, s1 - s0, 0.08, 0.08, false);
  b.absY = null;
  markReadableWorld('pontisNomen', ...worldAt(0.6, w - 1.2, top + 1.0));
}
/** World (x, y-above-ground, z) for markReadableWorld from bridge s, w and an absolute y. */
function worldAt(s: number, w: number, y: number): [number, number, number] {
  const [x, z] = at(s, w);
  return [x, y - fastTerrain(x, z), z];
}

// ---------------------------------------------------------------- the road, the wood, the weeds
const ROAD_W: P2[] = [at(-END - RAMP, 0), at(-END - RAMP - 26, -3), at(-END - RAMP - 60, -9)];
const ROAD_E: P2[] = [at(END + RAMP, 0), at(END + RAMP + 24, 4), (() => { const [x, z] = at(END + RAMP + 24, 4); return [x + 34, z + 26] as P2; })()];
/** The path south along the east bank, into the map. */
const PATH_S: P2[] = [ROAD_E[1], [-1290, -900], [-1300, -840], [-1306, -790]];

function distLine(x: number, z: number, P: P2[]) {
  let d = Infinity;
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], b = P[k + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return d;
}
const BRIDGE_LINE: P2[] = [at(-END - RAMP, 0), at(END + RAMP, 0)];
/** Keep the wood off the bridge, its embankments and the roads. */
export function ponsKeepOut(x: number, z: number) {
  return distLine(x, z, BRIDGE_LINE) < WIDTH / 2 + 3.5 || distLine(x, z, ROAD_W) < 3.5 || distLine(x, z, ROAD_E) < 3.5 || distLine(x, z, PATH_S) < 2.2;
}

function road(b: Builder) {
  for (const P of [ROAD_W, ROAD_E]) for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], c = P[k + 1], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const ux = (c[0] - a[0]) / len, uz = (c[1] - a[1]) / len, ry = Math.atan2(-uz, ux);
    for (let s = 0; s < len; s += 0.9) for (let q = -1.4; q <= 1.4; q += 0.85) {
      // Robbed for building: fewer stones the further from the bridge.
      if (rand() > 0.62 - 0.35 * ((k + s / len) / (P.length - 1))) continue;
      const x = a[0] + ux * s - uz * q + R(-0.1, 0.1), z = a[1] + uz * s + ux * q + R(-0.1, 0.1);
      b.box('slab', R(0.6, 0.95), 0.22, R(0.5, 0.8), x, -0.12, z, ry + R(-0.25, 0.25), false, R(-0.04, 0.04), R(-0.04, 0.04));
    }
    // Kerb stones on one side here and there.
    for (let s = 0; s < len; s += R(1.5, 3)) if (rand() < 0.5) b.box('block', R(0.7, 1.1), 0.35, 0.3, a[0] + ux * s + uz * 1.9, -0.15, a[1] + uz * s - ux * 1.9, ry, false);
  }
}

/** Vegetation clinging to the ruin: weeds and shrubs on the pier tops, deck edges and rubble. */
function weeds(scene: THREE.Scene) {
  const put = (id: Parameters<typeof placeProp>[1], s: number, w: number, y: number, sc: number) => {
    const [x, z] = at(s, w);
    placeProp(scene, id, x, y - fastTerrain(x, z), z, R(0, 6.28), sc, { raw: true });
  };
  // Tufts on the broken arch ends, the pier tops by the gap, the parapets.
  for (const [s, w] of [[-6, -2.4], [-6.5, 2.2], [6, -2.6], [6.6, 1.9], [12, -1.2], [10.4, -2.4], [14.2, -2.0], [18.2, -2.6]] as P2[]) {
    put(rand() < 0.5 ? 'shrub_02' : 'weed_plant_02', s, w, DECK - 0.45, rand() < 0.5 ? 0.8 : 3.5);
  }
  for (let i = 0; i < 26; i++) {
    const s = R(-END, END), w = (rand() < 0.5 ? -1 : 1) * (WIDTH / 2 - R(0.1, 0.6));
    if (Math.abs(s) < 4.2) continue;
    if (s > 6 && s < 18 && w < 0) continue;
    put((['grass_medium_02', 'weed_plant_02', 'nettle_plant', 'fern_02'] as const)[Math.floor(rand() * 4)], s, w, DECK - 0.45, rand() < 0.5 ? 0.9 : 3);
  }
  // Bramble and nettles round the feet of the piers on the banks and on the silted west arch.
  for (let i = 0; i < 30; i++) {
    const s = R(-32, -16) + (rand() < 0.3 ? R(38, 50) : 0), w = R(-6, 6);
    const [x, z] = at(s, w);
    placeProp(scene, (['shrub_02', 'nettle_plant', 'fern_02', 'weed_plant_02'] as const)[Math.floor(rand() * 4)], x, 0, z, R(0, 6.28), rand() < 0.5 ? 0.9 : 3.2);
  }
}

function wood(scene: THREE.Scene, b: Builder) {
  const rivD = (x: number, z: number) => distLine(x, z, CALORE_REAL.pts);
  buildForest(scene, b, {
    inside: () => false,
    keepOut: (x, z) => ponsKeepOut(x, z) || rivD(x, z) < CALORE_W / 2 + 1 || z > GROUND.z1 - 3,
    density: (x, z) => {
      const d = rivD(x, z) - CALORE_W / 2;
      // Thick along the banks, thinner on the plain, open round the bridge so it reads in the fog.
      let v = 0.12 + 0.5 * Math.exp(-(((d - 10) / 22) ** 2));
      const nb = distLine(x, z, BRIDGE_LINE);
      v *= 0.12 + 0.88 * THREE.MathUtils.smoothstep(nb, 30, 60);
      // Fade out at the drawn ground's edges.
      const e = Math.min(x - GROUND.x0, GROUND.x1 - x, z - GROUND.z0);
      return e < 4 ? 0 : v;
    },
    bounds: { x0: GROUND.x0 + 4, z0: GROUND.z0 + 4, x1: GROUND.x1 - 4, z1: GROUND.z1 - 3 },
    // Scanned ground cover only where one walks, by the bridge and its approaches.
    cover: (x, z) => distLine(x, z, BRIDGE_LINE) < 22,
  });
}

/** Everything at Ponte Fratto. Call while the world's landmark Builder is open (before its build), then commit props. */
export function buildPonteFratto(scene: THREE.Scene, b: Builder) {
  ground(b);
  water(scene);
  bridge(b);
  timber(b);
  road(b);
  weeds(scene);
  wood(scene, b);
  // The fallen block with the old inscription, in the shallows below the gap.
  b.absY = 0;
  bbox(b, 'marble', 2.2, WIDTH / 2 + 2.5, Math.max(L - 0.3, bedAt(2.2, WIDTH / 2 + 2.5)), 1.9, 0.9, 0.75, true, 0.12, -0.08, 0.5);
  b.absY = null;
  markReadableWorld('pontisTitulus', ...worldAt(2.2, WIDTH / 2 + 2.5, Math.max(L + 0.6, bedAt(2.2, WIDTH / 2 + 2.5) + 0.8)));
}

/** Landmark entry for the map. */
export const PONS_LANDMARK = { name: PONS.name, x: PONS.x, z: PONS.z, kind: 'site' as const };
