import * as THREE from 'three';
import { Builder, rng } from '../builder';
import type { MatName } from '../materials';
import { arcadeGeo, archRings, ruin, column, fallenDrum, gable } from '../shapes';
import { Acc, reseedKit } from '../arch/kit';
import { torch, brazier } from '../lights';
import { placeProp, type PropId } from '../props';
import { markReadable } from './readables';

// Hadrian's theatre of Benevento as it stood c. 700: outside the Lombard
// circuit, the orchestra silted up, the lowest rows under the earth, the top
// rows robbed for lime, two sectors of the cavea slumped where the vaults
// under them gave way; families living in the arches of the outer arcade
// and in huts on the seats.
//
// Frame: the orchestra's centre at the origin, the cavea on +x (angles
// −π/2…π/2 from +x towards +z), the stage wall along x ≈ −10.
//
// The cavea is built of real blocks (the arch kit's irregular, bevelled
// hexahedra): every row is a tread AND a riser (each block's top and its
// front face), set on a stepped concrete core that shows wherever blocks
// are missing. Collision is a separate smooth ramp through the middle of
// every tread (stairs climb as ramps), lowered onto the core where the
// seats have gone.

let rand = rng(126);
const R = (a: number, b: number) => a + (b - a) * rand();
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const P = (r: number, a: number, y: number) => v3(Math.cos(a) * r, y, Math.sin(a) * r);

/** Orchestra radius, outer radius of the seats, outer radius of the arcade. */
export const THEATRE = { RI: 11, RC: 39, RO: 44 };
const A0 = -Math.PI / 2, A1 = Math.PI / 2;

/** One row of the cavea: front radius, tread depth, top height, riser height, and what it is. */
interface Row { r: number; d: number; y: number; h: number; kind: 'seat' | 'walk' | 'balteus'; zone: 0 | 1 | 2 }
/** The rows, from the orchestra out: ima cavea, walkway, media, walkway, summa. */
export function caveaRows(): Row[] {
  const rows: Row[] = [];
  let r = THEATRE.RI, y = 0;
  const push = (kind: Row['kind'], zone: Row['zone'], h: number, d: number) => { y += h; rows.push({ r, d, y, h, kind, zone }); r += d; };
  for (let k = 0; k < 12; k++) push('seat', 0, 0.38, 0.78);
  push('walk', 0, 0.38, 1.7);
  push('balteus', 1, 0.95, 0.78);
  for (let k = 0; k < 10; k++) push('seat', 1, 0.38, 0.78);
  push('walk', 1, 0.38, 1.6);
  push('balteus', 2, 0.95, 0.78);
  while (r + 0.78 <= THEATRE.RC - 0.4) push('seat', 2, 0.38, 0.78);
  return rows;
}

/** Radial stairs (scalaria) per zone: their angles; 0.9 m wide. */
function stairAngles(zone: number): number[] {
  const out: number[] = [];
  if (zone === 0) for (let i = 1; i <= 5; i++) out.push(A0 + (Math.PI * i) / 6);
  else for (let i = 1; i <= 11; i++) out.push(A0 + (Math.PI * i) / 12);
  return out;
}
const STAIR_W = 0.95;

/** Where the cavea has slumped: angular sectors and the row from which the seats are gone. */
const SLUMPS = [
  { a0: -1.18, a1: -0.84, from: 9 },
  { a0: 0.52, a1: 0.95, from: 15 },
];
/** Rows (from the top) robbed out for lime, varying round the cavea. */
const robbedFrom = (a: number, n: number) => n - 2 - Math.round(2.5 + 2.5 * Math.sin(a * 2.3 + 0.7) + 1.5 * Math.sin(a * 5.1));
function slumpAt(a: number): number | null {
  for (const s of SLUMPS) {
    if (a < s.a0 - 0.08 || a > s.a1 + 0.08) continue;
    // Ragged edges: the break climbs at the sides of the sector.
    const t = Math.min(a - s.a0, s.a1 - a);
    return s.from + Math.max(0, Math.round(-t * 24));
  }
  return null;
}
/** Buried: the orchestra is silted up over the first row and a half. */
const SILT_R = THEATRE.RI + 0.95;
const siltBase = (r: number) => 0.05 + 0.53 * Math.min(1, r / SILT_R) ** 3;
const silt = (r: number, a: number) => siltBase(r) + 0.08 * Math.sin(a * 3 + r * 0.7) * Math.min(1, r / SILT_R);

/** Height of the walkable ramp (through the middle of the treads) at radius r. */
function rampY(rows: Row[], r: number) {
  if (r <= rows[1].r) return siltBase(Math.min(r, SILT_R));
  const m1 = rows[1].r + rows[1].d / 2;
  if (r <= m1) return siltBase(SILT_R) + (rows[1].y - siltBase(SILT_R)) * (r - rows[1].r) / (m1 - rows[1].r);
  for (let k = 1; k < rows.length - 1; k++) {
    const m0 = rows[k].r + rows[k].d / 2, m2 = rows[k + 1].r + rows[k + 1].d / 2;
    if (r <= m2) return rows[k].y + (rows[k + 1].y - rows[k].y) * (r - m0) / (m2 - m0);
  }
  return rows[rows.length - 1].y;
}

export function theatrum(b: Builder) {
  rand = rng(126);
  reseedKit(127);
  const { RI, RC, RO } = THEATRE;
  const rows = caveaRows();
  const N = rows.length, TOP = rows[N - 1].y;
  const acc = new Acc();
  const below = v3(0, -50, 0);

  // ---- the core: concrete stepped under the seats, showing where blocks are gone
  const AS = 48;
  for (let i = 0; i < AS; i++) {
    const a0 = A0 + (Math.PI * i) / AS, a1 = A0 + (Math.PI * (i + 1)) / AS;
    for (let k = 0; k < N; k++) {
      const rw = rows[k], yb = rw.y - 0.24, yp = k ? rows[k - 1].y - 0.24 : -0.3;
      const r0 = rw.r + 0.06, r1 = rw.r + rw.d + 0.06;
      // Tread of the core (faces up) and its riser (faces the orchestra).
      acc.quad('rubble', P(r0, a0, yb), P(r1, a0, yb), P(r1, a1, yb), P(r0, a1, yb), below);
      acc.quad('rubble', P(r0, a0, yp), P(r0, a1, yp), P(r0, a1, yb), P(r0, a0, yb), P(r0 + 5, (a0 + a1) / 2, yp));
    }
  }

  // ---- seats, walkways and the parapet walls, block by block
  const robbedN = (a: number) => Math.min(robbedFrom(a, N), slumpAt(a) ?? N);
  const stairsOf = rows.map((rw) => stairAngles(rw.zone));
  const loose: { r: number; a: number; y: number }[] = [];
  for (let k = 0; k < N; k++) {
    const rw = rows[k];
    if (rw.y < 0.45) continue; // under the silt
    const r0 = rw.r, r1 = rw.r + rw.d + 0.14;
    // Cut the row at its stairs into cunei (walkways run round unbroken).
    const st = rw.kind === 'walk' ? [] : stairsOf[k];
    const cuts: [number, number][] = [];
    let a = A0 + 0.004;
    for (const s of st) { const half = (STAIR_W / 2) / r0; cuts.push([a, s - half]); a = s + half; }
    cuts.push([a, A1 - 0.004]);
    for (const [c0, c1] of cuts) {
      // Blocks along the arc: Roman seat blocks 1.4-2.8 m long, walkway slabs shorter.
      const arc = (c1 - c0) * r0;
      const nb = Math.max(1, Math.round(arc / (rw.kind === 'walk' ? 1.3 : 2.1)));
      const edges = [c0];
      for (let i = 1; i < nb; i++) edges.push(c0 + ((c1 - c0) * (i + R(-0.25, 0.25))) / nb);
      edges.push(c1);
      for (let i = 0; i < nb; i++) {
        const b0 = edges[i] + 0.006 / r0 * 10 * R(0.2, 1), b1 = edges[i + 1] - 0.006 / r0 * 10 * R(0.2, 1), am = (b0 + b1) / 2;
        // Robbed, slumped, or simply missing.
        const rob = robbedN(am);
        if (k >= rob) { if (k < rob + 3 && rand() < 0.25) loose.push({ r: r0 + R(-1, 1), a: am, y: 0 }); continue; }
        if (rand() < (rw.zone === 2 ? 0.1 : 0.04)) { if (rand() < 0.5) loose.push({ r: r0, a: am, y: 0 }); continue; }
        const near = k >= rob - 2; // the edge of a gap: blocks shifted and tipped
        const sink = R(0, 0.05) + (near ? R(0.03, 0.18) : 0);
        const nose = R(0.03, 0.1); // the front edge worn round by two thousand years of feet
        const shift = near ? R(-0.12, 0.25) : R(-0.02, 0.03);
        const tilt = near ? R(-0.12, 0.12) : R(-0.02, 0.02);
        const yt = rw.y - sink, yb = rw.y - rw.h - 0.16;
        const m: MatName = rw.kind === 'balteus' ? 'block' : rand() < 0.07 ? 'marble' : 'block';
        const ra = r0 + shift, rb = r1 + shift;
        const c = [
          P(ra, b0, yb), P(ra, b1, yb), P(rb, b1, yb), P(rb, b0, yb),
          P(ra, b0, yt - nose + tilt * 0.4), P(ra, b1, yt - nose * R(0.5, 1.4) - tilt * 0.4), P(rb, b1, yt - tilt * 0.4), P(rb, b0, yt + tilt * 0.4),
        ];
        seatBlock(acc, m, c, k + 1 >= rob || rand() < 0.05);
        // A seat broken across: its front corner lies on the tread below.
        if (rand() < 0.03 && k > 1) loose.push({ r: r0 - 0.4, a: b0 + 0.1 / r0, y: rows[k - 1].y });
        // Earth and moss in the angle of tread and riser.
        if (k + 1 < N && rand() < (rw.zone === 2 ? 0.35 : 0.18)) {
          const e0 = am + R(-0.4, 0.1) * (b1 - b0), e1 = e0 + R(0.25, 0.6) * (b1 - b0);
          const rr = r0 + rw.d - R(0.18, 0.32);
          acc.hexa('ground', [P(rr, e0, yt - 0.03), P(rr, e1, yt - 0.03), P(r0 + rw.d + 0.02, e1, yt - 0.03), P(r0 + rw.d + 0.02, e0, yt - 0.03),
            P(rr + 0.05, e0, yt + 0.03), P(rr + 0.05, e1, yt + 0.03), P(r0 + rw.d + 0.02, e1, yt + R(0.08, 0.16)), P(r0 + rw.d + 0.02, e0, yt + R(0.08, 0.16))]);
        }
      }
    }
    // The stairs: two steps to every row of seats.
    if (rw.kind === 'walk') continue;
    for (const s of stairsOf[k]) {
      if (k >= robbedN(s) || rand() < 0.05) continue;
      const half = (STAIR_W / 2) / r0;
      const yPrev = k ? rows[k - 1].y : 0;
      for (let q = 0; q < 2; q++) {
        const sr0 = r0 + (q * rw.d) / 2, sr1 = r0 + ((q + 1) * rw.d) / 2 + 0.1;
        const yt = yPrev + (rw.h * (q + 1)) / 2 - R(0, 0.04), yb = yPrev - 0.12 + (rw.h * q) / 2;
        const nose = R(0.03, 0.08);
        seatBlock(acc, 'stone', [P(sr0, s - half, yb), P(sr0, s + half, yb), P(sr1, s + half, yb), P(sr1, s - half, yb),
          P(sr0, s - half, yt - nose), P(sr0, s + half, yt - nose * R(0.6, 1.3)), P(sr1, s + half, yt), P(sr1, s - half, yt)], q === 1 && k + 1 >= robbedN(s));
      }
    }
  }
  // Fallen and robbed-over blocks lying about the slope and in the slumps.
  for (const L of loose) {
    const y = L.y || rampY(rows, L.r) - 0.25;
    const w = R(0.7, 1.6), d = R(0.5, 0.8), h = R(0.3, 0.42), ry = R(0, Math.PI);
    const cx = Math.cos(L.a) * L.r, cz = Math.sin(L.a) * L.r;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const corner = (u: number, w2: number, yy: number) => v3(cx + u * cs - w2 * sn, yy, cz + u * sn + w2 * cs);
    const t1 = R(-0.15, 0.15), t2 = R(-0.15, 0.15);
    acc.hexa('block', [corner(-w / 2, -d / 2, y - 0.1 + t1), corner(w / 2, -d / 2, y - 0.1 - t1), corner(w / 2, d / 2, y - 0.1 - t2), corner(-w / 2, d / 2, y - 0.1 + t2),
      corner(-w / 2, -d / 2, y + h + t1), corner(w / 2, -d / 2, y + h - t1), corner(w / 2, d / 2, y + h - t2), corner(-w / 2, d / 2, y + h + t2)]);
  }
  // Rubble slopes in the slumps, where the vaults beneath fell in.
  for (const s of SLUMPS) {
    for (let i = 0; i < 7; i++) {
      const a = R(s.a0 + 0.04, s.a1 - 0.04), r = R(rows[s.from].r + 1, RC - 3);
      ruin(b, 'rubble', R(2.5, 5), R(0.6, 1.6), R(1.5, 3), Math.cos(a) * r, rampY(rows, r) - 0.9, Math.sin(a) * r, -a + Math.PI / 2, 0.9);
    }
  }

  // ---- the analemmata: the retaining walls at each end of the cavea
  for (const side of [-1, 1]) {
    const a = side * (A1 - 0.002), na = v3(Math.cos(a + side * Math.PI / 2), 0, Math.sin(a + side * Math.PI / 2));
    const T = 1.1;
    for (let r = RI - 0.6; r < RC; ) {
      const r2 = Math.min(RC, r + R(1.6, 2.6));
      const yt0 = rampY(rows, r) + 0.6 + R(-0.1, 0.1), yt1 = rampY(rows, r2) + 0.6 + R(-0.1, 0.1);
      const o = (rr: number, w: number, y: number) => P(rr, a, y).addScaledVector(na, w);
      // Courses of big blocks.
      for (let y0 = -0.3; y0 < Math.max(yt0, yt1) - 0.1; y0 += 1.12) {
        const y1 = y0 + 1.1;
        const top0 = Math.min(y1, yt0), top1 = Math.min(y1, yt1);
        if (top0 - y0 < 0.1 && top1 - y0 < 0.1) continue;
        acc.hexa('block', [o(r, 0, y0), o(r2, 0, y0), o(r2, T, y0), o(r, T, y0),
          o(r, 0, Math.max(y0 + 0.1, top0)), o(r2, 0, Math.max(y0 + 0.1, top1)), o(r2, T, Math.max(y0 + 0.1, top1)), o(r, T, Math.max(y0 + 0.1, top0))]);
      }
      r = r2;
    }
  }

  // ---- the ring wall behind the top row
  for (let i = 0; i < 40; i++) {
    const a0 = A0 + (Math.PI * i) / 40, a1 = A0 + (Math.PI * (i + 1)) / 40;
    const rob = Math.min(robbedN(a0), robbedN(a1));
    const h = rob >= N - 1 ? TOP + R(0.4, 1.1) : rows[Math.max(0, rob - 1)].y + R(0.6, 2.4);
    acc.hexa('rubble', [P(RC - 0.35, a0, -0.3), P(RC - 0.35, a1, -0.3), P(RC + 0.65, a1, -0.3), P(RC + 0.65, a0, -0.3),
      P(RC - 0.35, a0, h + R(-0.3, 0.3)), P(RC - 0.35, a1, h + R(-0.3, 0.3)), P(RC + 0.65, a1, h + R(-0.3, 0.3)), P(RC + 0.65, a0, h + R(-0.3, 0.3))]);
  }

  // ---- the orchestra: silted up, a few paving slabs showing, a puddle of mud
  {
    const n = 18, m = 8;
    const hAt = silt;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const a0 = Math.PI / 2 + (Math.PI * i) / n, a1 = Math.PI / 2 + (Math.PI * (i + 1)) / n;
      // The half-circle in front of the cavea (x ≥ 0) plus the strip to the stage.
      const aa0 = a0 + Math.PI, aa1 = a1 + Math.PI;
      const r0 = (SILT_R * j) / m, r1 = (SILT_R * (j + 1)) / m;
      const p = (r: number, a: number) => P(r, a, hAt(r, a));
      acc.quad('ground', p(r0, aa0), p(r1, aa0), p(r1, aa1), p(r0, aa1), below);
    }
    for (let k = 0; k < 14; k++) {
      const a = R(-1.4, 1.4), r = R(1, RI - 1.5), x = Math.cos(a) * r, z = Math.sin(a) * r;
      b.box('slab', R(0.8, 1.4), 0.12, R(0.6, 1.0), x, hAt(r, a) - 0.05, z, R(0, 3), false, R(-0.04, 0.04), R(-0.04, 0.04));
    }
  }
  acc.flush(b);

  // ---- collision: the ramp through the treads, the orchestra floor, walls
  {
    const pos: number[] = [];
    const AN = 36;
    const yC = (r: number, a: number) => {
      const k = rows.findIndex((rw) => rw.r + rw.d > r);
      const rob = robbedN(a);
      if (r < SILT_R) return silt(r, a);
      return k >= 0 && k >= rob ? rampY(rows, r) - 0.28 : rampY(rows, r);
    };
    const radii = [0];
    for (let r = 1.5; r < SILT_R; r += 1.5) radii.push(r);
    radii.push(SILT_R);
    for (const rw of rows) if (rw.r + rw.d / 2 > SILT_R) radii.push(rw.r + rw.d / 2);
    radii.push(RC - 0.3);
    for (let i = 0; i < AN; i++) {
      const a0 = A0 + (Math.PI * i) / AN, a1 = A0 + (Math.PI * (i + 1)) / AN;
      for (let j = 0; j < radii.length - 1; j++) {
        const q = (r: number, a: number) => { const p = P(r, a, yC(r, a)); return [p.x, p.y, p.z]; };
        const A = q(radii[j], a0), B = q(radii[j + 1], a0), C = q(radii[j + 1], a1), D = q(radii[j], a1);
        pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    b.collide(g);
    // The analemmata and the ring wall stop you walking off the ends and the back.
    for (const side of [-1, 1]) {
      const wall = new THREE.BoxGeometry(1.1, TOP + 1.8, RC - RI + 0.6).translate(-0.55, (TOP + 1.8) / 2 - 0.3, side * (RI - 0.6 + RC) / 2);
      b.collide(wall);
    }
  }

  // ---- the outer arcade: two orders of 25 arches, houses walled into them
  const NB = 25;
  for (let i = 0; i < NB; i++) {
    const a0 = A0 + (i / NB) * Math.PI, a1 = A0 + ((i + 1) / NB) * Math.PI, am = (a0 + a1) / 2;
    const bay = 2 * RO * Math.sin((a1 - a0) / 2);
    const x = Math.cos(am) * RO, z = Math.sin(am) * RO, ry = -am - Math.PI / 2;
    const slumped = SLUMPS.some((s) => am > s.a0 - 0.05 && am < s.a1 + 0.05);
    const infill = rand() < 0.55;
    b.geo('block', arcadeGeo(bay + 0.05, 8.2, 1.4, 1, 3.4, 4.6), x, -0.3, z, ry);
    archRings(b, 'block', x, -0.3, z, ry, 1.4, 3.4, 4.6, 0.6, 0.7);
    if (infill) {
      // A house walled into the arch: rubble, a door or a window, a vent.
      b.geo('rubble', arcadeGeo(3.4, 6.3, 0.6, 1, 1.0, 1.7), x * 0.995, -0.3, z * 0.995, ry);
      b.box('wood', 1.0, 1.9, 0.08, x * 0.99, -0.2, z * 0.99, ry, false);
      if (rand() < 0.5) b.box('iron', 0.5, 0.6, 0.62, x * 0.995 + Math.cos(am) * 0.01, 4.3, z * 0.995, ry, false);
      if (rand() < 0.35) b.lamp('window', v3(x * 0.98, 4.4, z * 0.98));
    }
    // Upper order: standing over the south half only, fallen elsewhere and over the slumps.
    if (!slumped && (i < 13 || rand() < 0.25)) {
      b.geo('block', arcadeGeo(bay + 0.05, 5.6, 1.2, 1, 3.0, 3.2), x, 7.9, z, ry);
      if (rand() < 0.6) ruin(b, 'rubble', bay, R(0.5, 2.4), 1.2, x, 13.4, z, ry, 0.8);
    } else {
      ruin(b, 'block', bay, R(0.6, 2.2), 1.3, x, 7.9, z, ry, 0.9);
      for (let k = 0; k < 2; k++) b.box('block', R(0.6, 1.1), R(0.4, 0.6), R(0.5, 0.9), x * R(1.03, 1.12), -0.2, z * R(1.03, 1.12), R(0, 3));
    }
    // Radial wall between ambulatory bays; the vault over it (fallen in under the slumps).
    b.box('rubble', 0.9, 8.0, RO - RC - 0.6, Math.cos(a0) * (RO + RC + 0.6) / 2, -0.3, Math.sin(a0) * (RO + RC + 0.6) / 2, -a0 + Math.PI / 2);
    if (!slumped) vault(b, 'brick', RO - RC - 0.6, bay / 2 - 0.2, Math.cos(am) * (RC + 0.6 + RO) / 2, 7.6, Math.sin(am) * (RC + 0.6 + RO) / 2, -am);
  }
  b.box('block', 0.9, 8.0, RO - RC, 0, -0.3, (RO + RC) / 2, Math.PI / 2);

  // ---- the scaena: stage platform, the broken stage wall with niches, columns
  b.box('rubble', 6.0, 1.3, 2 * RO * 0.86, -6.4, -0.3, 0);
  for (let k = -3; k <= 3; k++) {
    const z = k * 10.6;
    const h = R(5, 13);
    b.geo(rand() < 0.5 ? 'brick' : 'rubble', arcadeGeo(10.4, h, 1.8, 1, k === 0 ? 3.6 : 2.4, k === 0 ? 4 : 2.6), -9.8, -0.3, z, Math.PI / 2);
    if (rand() < 0.6) ruin(b, 'rubble', 10.4, R(1, 3), 1.8, -9.8, h - 0.3, z, Math.PI / 2, 0.8);
  }
  for (let k = 0; k < 6; k++) column(b, -6.0 + R(-0.2, 0.2), 1.0, R(-24, 24), R(5, 7), 0.32, rand() < 0.5 ? R(0.3, 0.7) : 0);
  for (let k = 0; k < 5; k++) fallenDrum(b, R(-8, 4), R(-20, 20), 0.35, R(1, 2.2), R(0, 3));

  // ---- huts on the upper seats: the poor live here, outside the walls
  for (let k = 0; k < 8; k++) {
    const a = R(-1.3, 1.3);
    if (SLUMPS.some((s) => a > s.a0 - 0.1 && a < s.a1 + 0.1) || stairAngles(1).some((s) => Math.abs(s - a) < 0.09)) continue;
    const ri = 14 + Math.floor(R(0, 9));
    const rw = rows[ri];
    const r = rw.r + 1.6, y = rw.y;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = R(2.8, 3.6), d = R(2.4, 3.0), ry = -a + R(-0.15, 0.15);
    b.box(rand() < 0.5 ? 'rubble' : 'wood', w, 2.3, d, x, y - 0.4, z, ry);
    gable(b, w, d, 0.8, x, y + 1.9, z, ry, 'wood', 0.35);
    if (rand() < 0.5) b.lamp('window', v3(x, y + 1.2, z));
  }

  // ---- weeds in the joints, scrub on the robbed top rows
  {
    const kinds: [PropId, number][] = [['grass_medium_02', 0.8], ['weed_plant_02', 2.6], ['fern_02', 2.4], ['nettle_plant', 2.6]];
    for (let i = 0; i < 70; i++) {
      const k = Math.floor(R(1, N - 1)), rw = rows[k], a = R(A0 + 0.05, A1 - 0.05);
      if (k >= robbedN(a)) continue;
      const [id, s] = kinds[Math.floor(rand() * kinds.length)];
      placeProp(null, id, Math.cos(a) * (rw.r + rw.d - 0.15), rw.y - 0.02, Math.sin(a) * (rw.r + rw.d - 0.15), R(0, 6), s * R(0.7, 1.1));
    }
    for (let i = 0; i < 40; i++) {
      const a = R(A0 + 0.05, A1 - 0.05), rob = robbedN(a);
      if (rob >= N) continue;
      const k = Math.min(N - 1, rob + Math.floor(R(0, N - rob))), rw = rows[k];
      const id: PropId = rand() < 0.4 ? 'shrub_02' : rand() < 0.5 ? 'rock_moss_set_02' : 'weed_plant_02';
      placeProp(null, id, Math.cos(a) * (rw.r + R(0, rw.d)), rampY(rows, rw.r) - 0.25, Math.sin(a) * (rw.r + R(0, rw.d)), R(0, 6), id === 'shrub_02' ? R(0.5, 0.9) : id === 'rock_moss_set_02' ? 0.6 : 3);
    }
  }
  brazier(b, 6, 4);
  torch(b, RO + 0.9, 3.0, 4, Math.PI / 2);
  markReadable('theatrum', -7.0, 1.6, 2.5);
}

/**
 * A seat block with only what can be seen: its tread, its riser, the worn
 * nose between them (a bevel), both ends (seen at the stairs and the gaps)
 * and, when the row behind is gone, its back. 12-14 triangles instead of a
 * fully bevelled hexahedron's 44. Corners as Acc.hexa: bottom 0-3, top 4-7,
 * 0-1 the front (riser) edge.
 */
function seatBlock(acc: Acc, m: MatName, c: THREE.Vector3[], back: boolean) {
  const j = 0.025;
  c = c.map((p) => p.clone().add(v3(R(-j, j), R(-j, j) * 0.6, R(-j, j))));
  const ctr = v3(0, 0, 0);
  for (const p of c) ctr.add(p);
  ctr.multiplyScalar(1 / 8);
  const bev = R(0.04, 0.09);
  const toward = (a: THREE.Vector3, b2: THREE.Vector3, d: number) => a.clone().add(b2.clone().sub(a).normalize().multiplyScalar(d));
  const t4 = toward(c[4], c[7], bev), t5 = toward(c[5], c[6], bev * R(0.6, 1.4));
  const f4 = toward(c[4], c[0], bev), f5 = toward(c[5], c[1], bev * R(0.6, 1.4));
  acc.quad(m, t4, t5, c[6], c[7], ctr);
  acc.quad(m, f4, f5, t5, t4, ctr);
  acc.quad(m, c[0], c[1], f5, f4, ctr);
  // Ends: pentagons (fans from the bottom-back corner).
  acc.tri(m, c[3], c[0], f4, ctr); acc.tri(m, c[3], f4, t4, ctr); acc.tri(m, c[3], t4, c[7], ctr);
  acc.tri(m, c[2], c[1], f5, ctr); acc.tri(m, c[2], f5, t5, ctr); acc.tri(m, c[2], t5, c[6], ctr);
  if (back) acc.quad(m, c[3], c[2], c[6], c[7], ctr);
}

/** A barrel vault (half cylinder seen from inside) along local x, rotated ry. */
function vault(b: Builder, m: MatName, len: number, r: number, x: number, y: number, z: number, ry: number) {
  const g = new THREE.CylinderGeometry(r, r, len, 12, Math.max(1, Math.round(len / 1.5)), true, 0, Math.PI);
  g.rotateZ(Math.PI / 2); g.rotateX(-Math.PI / 2);
  const n = g.toNonIndexed();
  const p = n.attributes.position.array as Float32Array, nr = n.attributes.normal.array as Float32Array;
  for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) {
    const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t;
    const u = nr[i + 3 + k]; nr[i + 3 + k] = nr[i + 6 + k]; nr[i + 6 + k] = u;
  }
  for (let i = 0; i < nr.length; i++) nr[i] = -nr[i];
  b.geo(m, n, x, y, z, ry, false);
}

/** A good place to stand: on the lower walkway, looking across the cavea. */
export function theatreView(): { x: number; z: number; y: number; lx: number; lz: number } {
  const rows = caveaRows();
  const w = rows.find((r) => r.kind === 'walk')!;
  const a = -0.62, r = w.r + w.d * 0.45;
  // Across the curve of the seats to the far side and its arcade, the stage at the left.
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: w.y, lx: Math.cos(0.75) * 26, lz: Math.sin(0.75) * 26 };
}
