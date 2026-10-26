import * as THREE from 'three';
import { Builder, rng } from '../builder';
import type { MatName } from '../materials';
import { Acc, Frame, voussoirs, reseedKit } from '../arch/kit';
import { fastTerrain } from '../displace';
import { placeProp, type PropId } from '../props';
import { markReadable } from './readables';
import type { P2 } from './geo';

// The Ponte Leproso (pons marmoreus "de Leprosis"), the Appia's bridge over
// the Sabato south-west of the town, as it stood c. 700.
//
// Its classical form after Meomartini's survey (1889; summarised in the
// it.wikipedia article "Ponte Leproso"): five equal semicircular arches of
// 8.70 m on four piers 5 m thick along the bridge and 7.50 m through, with a
// triangular cutwater upstream and none downstream; the arches spring from a
// projecting cornice 60 cm high; everything in "pseudisodomic" work of big,
// roughly bossed limestone blocks (hence "marmoreus"), the arch rings of
// great wedge-shaped voussoirs; a horizontal roadway reached by ramps on
// embankment walls of the same bossed blocks; foundations of tuff blocks.
// Restored under Valentinian, Valens and Gratian (367-375): their names were
// on the parapet. The four southern arches are Nauclerio's rebuild of 1712,
// and the mills and the widened pier date from after 1077, so none of that is
// here. In 700 the Sabato runs under the two southern arches and spreads
// over a gravel bed under the rest at flood (the river was pushed off the
// town bank only by the mills of 1077); sites.ts cuts the modern, silted
// ground down to that bed. Dimensions are Meomartini's own measurements
// (pp. 277-283); the in-game sizes are checked against them in
// docs/benevento/HISTORY.md §5.
//
// Position from OpenStreetMap (way 59431406, "Via Ponte Leproso"): from
// (-736.8, -143.4) at the town (north-east) end to (-788.5, -61.4).
// Everything is built in world coordinates at absolute heights.

let rand = rng(1712);
const R = (a: number, b: number) => a + (b - a) * rand();
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The bridge's axis: s along it (0 at the OSM north-east end, growing to the south-west), w across (+ upstream). */
const A: P2 = [-736.8, -143.4], B: P2 = [-788.5, -61.4];
const LEN = Math.hypot(B[0] - A[0], B[1] - A[1]);
const D: P2 = [(B[0] - A[0]) / LEN, (B[1] - A[1]) / LEN];
/** Across, towards the upstream (south-east) side: the Sabato flows north-west here. */
const N: P2 = [-D[1], D[0]].map((v) => -v) as P2;
const at = (s: number, w: number, y: number) => v3(A[0] + D[0] * s + N[0] * w, y, A[1] + D[1] * s + N[1] * w);
const xz = (s: number, w: number): P2 => [A[0] + D[0] * s + N[0] * w, A[1] + D[1] * s + N[1] * w];

// Meomartini's survey (pp. 278-281, Tav. XL-XLI): arches of radius 4.35 centred on the LOWER
// line of the impost band; band 0.60 high, standing out 0.32; voussoirs 1.20 long on the face;
// piers 5.00 thick and 7.50 long, the cutwater standing out 2.50 (half the pier).
const SPAN = 8.7, PIER = 5.0, RAD = SPAN / 2, RING = 1.2, BAND = 0.32, CUT = 2.5;
const HW = 3.75;
const S0 = 20, S1 = S0 + 5 * SPAN + 4 * PIER;
/**
 * Arch centre = springing = bottom of the impost band; roadway (extrados of the crown plus the
 * road's fill and paving); foundations; the gravel bed under the bridge in 700 (absolute heights,
 * game metres; the Sabato runs at 12.5 here).
 */
const YS = 13.0, YD = YS + RAD + RING + 0.35, YF = 8.6, CORN = 0.6;
/**
 * The approaches. Town side: Meomartini dug out the bossed walls of the approach for about 62 m
 * from the abutment, the road falling steeply at first, then more gently, then level. The far
 * side is not known: the same fall, and beyond its walled head an earth bank (agger).
 */
const RAMP_NE = S0 - 62, RAMP_SW = S1 + 50, WALL_SW = S1 + 12;
const arcCentre = (i: number) => S0 + RAD + i * (SPAN + PIER);

/** Height of the roadway at s: level over the bridge, falling to the banks in two slopes, then level. */
export function ponsDeckY(s: number) {
  const gNE = fastTerrain(...xz(RAMP_NE, 0)) + 0.15, gSW = fastTerrain(...xz(RAMP_SW, 0)) + 0.15;
  const fall = (d: number, g: number) => {
    // d metres from the abutment: 55% of the drop in the first 22 m, the rest by 50 m, then level.
    const k = YD - g;
    if (d <= 22) return YD - k * 0.55 * (d / 22);
    if (d <= 50) return YD - k * (0.55 + 0.45 * ((d - 22) / 28));
    return g;
  };
  if (s < S0) return fall(S0 - s, gNE);
  if (s > S1) return fall(s - S1, gSW);
  return YD;
}
/** The road over the bridge, ramp foot to ramp foot (for roads, forest mask and teleports). */
/** Axis coordinates (s along, w across towards upstream) of a world point. */
const axis = (x: number, z: number): P2 => [(x - A[0]) * D[0] + (z - A[1]) * D[1], (x - A[0]) * N[0] + (z - A[1]) * N[1]];
export const PONS = { ne: xz(RAMP_NE, 0), sw: xz(RAMP_SW, 0), rampNE: RAMP_NE, rampSW: RAMP_SW, s0: S0, s1: S1, at: xz, axis, deckY: ponsDeckY, arch: arcCentre };

// ---------------------------------------------------------------- masonry helpers
/**
 * A bossed ashlar face: the rim (shared with the neighbours, so no cracks)
 * at the wall plane, a drafted margin, the rough boss standing out in the
 * middle. 12 triangles. Corners bottom-left, bottom-right, top-right, top-left.
 */
function bossed(acc: Acc, m: MatName, c: THREE.Vector3[], nrm: THREE.Vector3, boss = R(0.04, 0.13)) {
  const ctr = v3(0, 0, 0);
  for (const p of c) ctr.add(p);
  ctr.multiplyScalar(0.25);
  const inside = ctr.clone().addScaledVector(nrm, -1);
  const mg = R(0.06, 0.1);
  const I = c.map((p) => p.clone().add(ctr.clone().sub(p).normalize().multiplyScalar(mg * 1.4)).addScaledVector(nrm, 0.035));
  const C = ctr.clone().addScaledVector(nrm, boss).add(v3(R(-0.08, 0.08), R(-0.05, 0.05), R(-0.08, 0.08)));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    acc.quad(m, c[i], c[j], I[j], I[i], inside);
    acc.tri(m, I[i], I[j], C, inside);
  }
}

/**
 * A wall face of bossed blocks in courses of uneven height (opus
 * pseudisodomum): along u from 0 to len on the plane through o with
 * horizontal direction U and outward normal Nr, from yBot up to top(u),
 * leaving out holes(y) (u-intervals, with the arch edges following their
 * curves), and blocks wholly under the ground.
 */
function face(acc: Acc, m: MatName, o: P2, U: P2, Nr: P2, len: number, yBot: number, top: (u: number) => number,
  holes: (y: number) => { a: number; b: number }[] = () => [], ground?: (u: number) => number) {
  const nrm = v3(Nr[0], 0, Nr[1]);
  const p = (u: number, y: number) => v3(o[0] + U[0] * u, y, o[1] + U[1] * u);
  let maxTop = -Infinity;
  for (let u = 0; u <= len; u += 1) maxTop = Math.max(maxTop, top(u));
  maxTop = Math.max(maxTop, top(len));
  let k = 0;
  for (let y0 = yBot; y0 < maxTop - 0.05; k++) {
    const y1 = y0 + (k % 2 ? R(0.48, 0.58) : R(0.62, 0.78));
    // Solid runs of this course between the holes (holes taken at the course's middle).
    const hm = holes((y0 + y1) / 2).sort((q, r2) => q.a - r2.a);
    const runs: { a: number; b: number; ea?: { a: number; b: number }; eb?: { a: number; b: number } }[] = [];
    let a = 0, ea: { a: number; b: number } | undefined;
    for (const h of hm) {
      if (h.b <= a) continue;
      if (h.a > a) runs.push({ a, b: Math.min(h.a, len), ea, eb: h });
      a = Math.max(a, h.b); ea = h;
    }
    if (a < len) runs.push({ a, b: len, ea });
    for (const run of runs) {
      // Where a run meets a hole, its edge follows the hole at each course line.
      const edgeL = (y: number) => run.ea ? holeEdge(holes, y, run.ea, 'b') : run.a;
      const edgeR = (y: number) => run.eb ? holeEdge(holes, y, run.eb, 'a') : run.b;
      const cuts = [0];
      const width = run.b - run.a;
      let t = R(0.3, 1.2);
      while (t < width - 0.6) { cuts.push(t); t += R(0.95, 1.9); }
      cuts.push(width);
      for (let i = 0; i < cuts.length - 1; i++) {
        const ua0 = i === 0 ? edgeL(y0) : run.a + cuts[i], ub0 = i === cuts.length - 2 ? edgeR(y0) : run.a + cuts[i + 1];
        const ua1 = i === 0 ? edgeL(y1) : run.a + cuts[i], ub1 = i === cuts.length - 2 ? edgeR(y1) : run.a + cuts[i + 1];
        if (ub0 - ua0 < 0.05 && ub1 - ua1 < 0.05) continue;
        const ta = Math.min(y1, top(ua1)), tb = Math.min(y1, top(ub1));
        if (ta <= y0 + 0.04 && tb <= y0 + 0.04) continue;
        if (ground && y1 < Math.max(ground(ua0), ground(ub0)) - 0.35) continue;
        bossed(acc, m, [p(ua0, y0), p(ub0, y0), p(ub1, Math.max(y0 + 0.04, tb)), p(ua1, Math.max(y0 + 0.04, ta))], nrm);
      }
    }
    y0 = y1;
  }
}
/** The u of a hole's edge at height y (the same hole as `h`, looked up again at y). */
function holeEdge(holes: (y: number) => { a: number; b: number }[], y: number, h: { a: number; b: number }, side: 'a' | 'b') {
  const mid = (h.a + h.b) / 2;
  const hs = holes(y);
  let best: { a: number; b: number } | null = null;
  for (const q of hs) if (q.a - 0.01 <= mid && q.b + 0.01 >= mid) best = q;
  return best ? best[side] : mid;
}

// ---------------------------------------------------------------- the bridge
export function ponsLeprosus(b: Builder) {
  rand = rng(1712);
  reseedKit(1713);
  b.absY = 0;
  const acc = new Acc();
  const gr = (s: number, w: number) => fastTerrain(...xz(s, w));
  const deck = ponsDeckY;
  const top = (s: number) => deck(s) - 0.12;

  // Openings in the long faces: between the piers below the springing, the
  // arch and its ring above it.
  const holes = (y: number) => {
    const out: { a: number; b: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const c = arcCentre(i);
      let h = 0;
      if (y < YS) h = RAD;
      else if (y < YS + RAD + RING) h = Math.sqrt(Math.max(0, (RAD + RING) ** 2 - (y - YS) ** 2));
      if (h > 0.02) out.push({ a: c - h - (RAMP_NE), b: c + h - (RAMP_NE) });
    }
    return out;
  };
  // The two long faces, from the town ramp's foot to the head of the far ramp (u = s - RAMP_NE).
  for (const side of [1, -1]) {
    const o = xz(RAMP_NE, side * HW), nr: P2 = [N[0] * side, N[1] * side];
    const len = WALL_SW - RAMP_NE;
    face(acc, 'block', o, D, nr, len, YF, (u) => top(u + RAMP_NE), (y) => {
      const hs = holes(y);
      // Upstream, the cutwaters hide the piers' faces below the cornice.
      if (side > 0 && y < YS) for (let i = 0; i < 4; i++) hs.push({ a: arcCentre(i) + RAD - RAMP_NE, b: arcCentre(i) + RAD + PIER - RAMP_NE });
      return hs;
    }, (u) => gr(u + RAMP_NE, side * HW));
  }
  // Pier and abutment faces looking into the arches, below the cornice.
  for (let i = 0; i <= 5; i++) {
    for (const dir of [-1, 1]) {
      // dir -1: the face at the start of arch i (looking +s); +1: the face at the end of arch i-1 (looking -s).
      const s = dir < 0 ? arcCentre(i) - RAD : arcCentre(i - 1) + RAD;
      if ((dir < 0 && i === 5) || (dir > 0 && i === 0)) continue;
      const nr: P2 = dir < 0 ? D : [-D[0], -D[1]];
      const U: P2 = [N[0] * -dir, N[1] * -dir];
      const o = xz(s, dir * HW);
      face(acc, 'block', o, U, nr, 2 * HW, YF, () => YS, () => [], (u) => gr(s, dir * HW - dir * u));
      // The impost band the arches spring from, standing out into the opening (it carried the centring).
      for (let w0 = -HW; w0 < HW - 0.01; ) {
        const w1 = Math.min(HW, w0 + R(1.2, 2.0));
        const sIn = s + (dir < 0 ? 1 : -1) * BAND;
        acc.hexa('block', [at(s, w0, YS), at(s, w1, YS), at(sIn, w1, YS), at(sIn, w0, YS),
          at(s, w0, YS + CORN), at(s, w1, YS + CORN), at(sIn, w1, YS + CORN), at(sIn, w0, YS + CORN)]);
        w0 = w1;
      }
    }
  }
  // The cornice on the long faces of the piers and abutments.
  for (const side of [1, -1]) for (let i = 0; i <= 5; i++) {
    const s0 = i === 0 ? S0 - 6 : arcCentre(i - 1) + RAD - 0.05, s1 = i === 5 ? S1 + 6 : arcCentre(i) - RAD + 0.05;
    for (let s = s0; s < s1 - 0.01; ) {
      const e = Math.min(s1, s + R(1.3, 2.2));
      const y0 = YS, y1 = YS + CORN, wo = side * (HW + BAND);
      acc.hexa('block', [at(s, side * HW, y0), at(e, side * HW, y0), at(e, wo, y0), at(s, wo, y0),
        at(s, side * HW, y1), at(e, side * HW, y1), at(e, wo, y1), at(s, wo, y1)]);
      s = e;
    }
  }
  // The arches: voussoirs on both faces, the barrel of wedge-stones under each.
  for (let i = 0; i < 5; i++) {
    const c = arcCentre(i);
    for (const side of [1, -1]) {
      const o = at(c, side * HW, 0);
      const f = new Frame(o, v3(D[0], 0, D[1]), v3(0, 1, 0), v3(N[0] * side, 0, N[1] * side));
      // Late-antique repair: the downstream ring of the second arch relaid in brick.
      const brick = i === 1 && side < 0;
      voussoirs(acc, brick ? 'brick' : 'block', f, 0, YS, RAD, RAD + RING, -0.7, 0.06, 0, Math.PI, brick ? 0.22 : 0.78);
    }
    const n = 15;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI, a1 = ((k + 1) / n) * Math.PI;
      const ws = [-HW, -HW + R(1.6, 2.8), HW - R(1.6, 2.8), HW];
      if (k % 2) ws.splice(1, 2, -HW + R(2.6, 4.4));
      for (let j = 0; j < ws.length - 1; j++) {
        const q = (a: number, w: number) => at(c + Math.cos(a) * RAD, w, YS + Math.sin(a) * RAD);
        const am = (a0 + a1) / 2;
        const nr = v3(-Math.cos(am) * D[0], -Math.sin(am), -Math.cos(am) * D[1]);
        bossed(acc, 'block', [q(a0, ws[j]), q(a0, ws[j + 1]), q(a1, ws[j + 1]), q(a1, ws[j])], nr, R(0.01, 0.04));
      }
    }
  }
  // Cutwaters on the upstream side: triangular, as high as the cornice, with a sloping cap.
  for (let i = 0; i < 4; i++) {
    const p0 = arcCentre(i) + RAD, p1 = p0 + PIER, pm = (p0 + p1) / 2, tip = HW + CUT;
    const P = (s: number, w: number): P2 => xz(s, w);
    const ct = YS;
    for (const [a, c2] of [[[p0, HW], [pm, tip]], [[pm, tip], [p1, HW]]] as [number[], number[]][]) {
      const o = P(a[0], a[1]), e = P(c2[0], c2[1]);
      const len = Math.hypot(e[0] - o[0], e[1] - o[1]);
      const U: P2 = [(e[0] - o[0]) / len, (e[1] - o[1]) / len];
      // Outward: away from the pier's middle.
      const mid = P(pm, HW + 0.8);
      let nr: P2 = [-U[1], U[0]];
      if ((o[0] + U[0] * len / 2 - mid[0]) * nr[0] + (o[1] + U[1] * len / 2 - mid[1]) * nr[1] < 0) nr = [-nr[0], -nr[1]];
      face(acc, 'block', o, U, nr, len, YF, () => ct, () => [], (u) => fastTerrain(o[0] + U[0] * u, o[1] + U[1] * u));
    }
    const capTop = at(pm, HW, ct + 1.5);
    acc.tri('block', at(p0, HW, ct), at(pm, tip, ct), capTop, at(pm, HW, ct - 3));
    acc.tri('block', at(pm, tip, ct), at(p1, HW, ct), capTop, at(pm, HW, ct - 3));
  }
  // The platea: a footing of tuff blocks round the piers, showing at low water.
  for (let i = 0; i < 4; i++) {
    const p0 = arcCentre(i) + RAD - 0.5, p1 = p0 + PIER + 1.0;
    for (const [w0, w1] of [[-HW - 0.5, 0], [0, HW + 0.5]]) {
      acc.hexa('bigstone', [at(p0, w0, YF - 0.6), at(p1, w0, YF - 0.6), at(p1, w1, YF - 0.6), at(p0, w1, YF - 0.6),
        at(p0, w0, YF + 0.3), at(p1, w0, YF + 0.3), at(p1, w1, YF + 0.3), at(p0, w1, YF + 0.3)]);
    }
  }

  // ---- the roadway: earth and gravel, the Appia's basalt slabs, kerbs, the parapets
  const SW = HW - 1.0; // half-width between the kerbs
  const below = v3(0, -100, 0);
  for (let s = RAMP_NE; s < RAMP_SW - 0.01; ) {
    const e = Math.min(RAMP_SW, s + 2.5);
    acc.quad('ground', at(s, -HW + 0.4, deck(s) - 0.1), at(e, -HW + 0.4, deck(e) - 0.1), at(e, HW - 0.4, deck(e) - 0.1), at(s, HW - 0.4, deck(s) - 0.1), below);
    s = e;
  }
  // Basoli in rows across the road; on the ramps many have been taken.
  for (let s = RAMP_NE + 0.4; s < RAMP_SW - 0.6; ) {
    const e = s + R(0.55, 0.85);
    const onBridge = s > S0 - 6 && s < S1 + 6;
    const ws = [-SW];
    while (ws[ws.length - 1] < SW - 0.5) ws.push(Math.min(SW, ws[ws.length - 1] + R(0.55, 1.0)));
    ws[ws.length - 1] = SW;
    for (let j = 0; j < ws.length - 1; j++) {
      if (rand() < (onBridge ? 0.04 : 0.4)) continue;
      const g = 0.015;
      const s0 = s + g + R(-0.04, 0.04), s1 = e - g + R(-0.04, 0.04), w0 = ws[j] + g, w1 = ws[j + 1] - g;
      const y0 = deck(s0) + R(-0.02, 0.015), y1 = deck(s1) + R(-0.02, 0.015);
      const t = [at(s0 + 0.04, w0 + 0.04, y0), at(s0 + 0.04, w1 - 0.04, y0 + R(-0.01, 0.01)), at(s1 - 0.04, w1 - 0.04, y1), at(s1 - 0.04, w0 + 0.04, y1 + R(-0.01, 0.01))];
      const lo = [at(s0, w0, y0 - 0.09), at(s0, w1, y0 - 0.09), at(s1, w1, y1 - 0.09), at(s1, w0, y1 - 0.09)];
      const ins = at((s0 + s1) / 2, (w0 + w1) / 2, (y0 + y1) / 2 - 1);
      acc.quad('slab', t[0], t[1], t[2], t[3], ins);
      for (let q = 0; q < 4; q++) acc.quad('slab', lo[q], lo[(q + 1) % 4], t[(q + 1) % 4], t[q], ins);
    }
    s = e;
  }
  // Kerbs (crepidines) and parapets, blocks laid along the slope; gaps where blocks fell or were taken.
  for (const side of [1, -1]) {
    for (let s = RAMP_NE; s < RAMP_SW - 0.01; ) {
      const e = Math.min(RAMP_SW, s + R(1.4, 2.4));
      const y0 = deck(s), y1 = deck(e);
      acc.hexa('block', [at(s, side * SW, y0 - 0.15), at(e, side * SW, y1 - 0.15), at(e, side * (HW - 0.45), y1 - 0.15), at(s, side * (HW - 0.45), y0 - 0.15),
        at(s, side * SW, y0 + 0.2), at(e, side * SW, y1 + 0.2), at(e, side * (HW - 0.45), y1 + 0.2), at(s, side * (HW - 0.45), y0 + 0.2)]);
      s = e;
    }
    for (let s = RAMP_NE + 1; s < WALL_SW - 0.3; ) {
      const e = Math.min(WALL_SW - 0.3, s + R(1.5, 2.6));
      const gone = rand() < 0.1;
      if (!gone) {
        const h = rand() < 0.15 ? R(0.45, 0.75) : R(0.95, 1.1);
        const y0 = deck(s) - 0.12, y1 = deck(e) - 0.12;
        acc.hexa('block', [at(s, side * (HW - 0.45), y0), at(e, side * (HW - 0.45), y1), at(e, side * HW, y1), at(s, side * HW, y0),
          at(s, side * (HW - 0.45), y0 + h), at(e, side * (HW - 0.45), y1 + h + R(-0.05, 0.05)), at(e, side * HW, y1 + h), at(s, side * HW, y0 + h + R(-0.05, 0.05))]);
      }
      s = e + 0.01;
    }
  }
  // Beyond the walled head of the far ramp the road runs on an earth bank (agger), its sides
  // sloping to the meadow, grassed over: the walls are attested only on the town side.
  {
    const slope = 1.5, below2 = v3(0, -100, 0);
    for (let s = WALL_SW - 0.3; s < RAMP_SW - 0.01; ) {
      const e = Math.min(RAMP_SW, s + 2.5);
      for (const side of [1, -1]) {
        const w = (q: number) => HW - 0.4 + Math.max(0.2, (deck(q) - gr(q, side * HW)) * slope);
        const ga = gr(s, side * w(s)) - 0.3, gb = gr(e, side * w(e)) - 0.3;
        const a = at(s, side * (HW - 0.4), deck(s) - 0.1), c = at(e, side * (HW - 0.4), deck(e) - 0.1);
        const a1 = at(s, side * w(s), ga), c1 = at(e, side * w(e), gb);
        acc.quad('ground', a, c, c1, a1, below2.clone().set(at(s, 0, 0).x, deck(s) - 30, at(s, 0, 0).z));
      }
      s = e;
    }
  }
  // The emperors' names on the parapet over the middle arch (upstream side).
  const ts = arcCentre(2);
  acc.hexa('marble', [at(ts - 1.3, HW - 0.47, YD - 0.1), at(ts + 1.3, HW - 0.47, YD - 0.1), at(ts + 1.3, HW + 0.02, YD - 0.1), at(ts - 1.3, HW + 0.02, YD - 0.1),
    at(ts - 1.3, HW - 0.47, YD + 1.02), at(ts + 1.3, HW - 0.47, YD + 1.02), at(ts + 1.3, HW + 0.02, YD + 1.02), at(ts - 1.3, HW + 0.02, YD + 1.02)]);
  acc.flush(b);
  {
    const p = at(ts, HW - 0.7, 0);
    markReadable('pontisTitulus', p.x, YD + 0.8, p.z, 0);
  }

  // ---- collision: the roadway, the parapets and ramp walls, the piers
  {
    const pos: number[] = [];
    const push = (...ps: THREE.Vector3[]) => { for (const q of ps) pos.push(q.x, q.y, q.z); };
    // Breakpoints every 2 m and at every arch's edges.
    const br: number[] = [];
    for (let s = RAMP_NE; s < RAMP_SW; s += 2) br.push(s);
    for (let i = 0; i < 5; i++) br.push(arcCentre(i) - RAD, arcCentre(i) + RAD);
    br.push(RAMP_SW);
    br.sort((a, c) => a - c);
    const inArch = (s: number) => { for (let i = 0; i < 5; i++) if (Math.abs(s - arcCentre(i)) < RAD - 0.01) return i; return -1; };
    for (let k = 0; k < br.length - 1; k++) {
      const s = br[k], e = br[k + 1];
      if (e - s < 0.01) continue;
      const a0 = at(s, -HW, deck(s)), a1 = at(e, -HW, deck(e)), b1 = at(e, HW, deck(e)), b0 = at(s, HW, deck(s));
      push(a0, a1, b1, a0, b1, b0);
      // Side walls from the ground (or the foundations) to the parapet's top; over the arches only
      // from the crown of the opening up, so one can walk under them.
      const ai = inArch((s + e) / 2);
      if ((s + e) / 2 > WALL_SW) {
        // The earth bank: its sloping sides.
        for (const side of [-1, 1]) {
          const w = (q: number) => HW + Math.max(0.2, (deck(q) - gr(q, side * HW)) * 1.5);
          push(at(s, side * HW, deck(s)), at(e, side * HW, deck(e)), at(e, side * w(e), gr(e, side * w(e)) - 0.4),
            at(s, side * HW, deck(s)), at(e, side * w(e), gr(e, side * w(e)) - 0.4), at(s, side * w(s), gr(s, side * w(s)) - 0.4));
        }
        continue;
      }
      for (const side of [-1, 1]) {
        const lo = (q: number) => ai < 0 ? Math.min(gr(q, side * HW), YF) - 0.5 : YS + Math.sqrt(Math.max(0, RAD * RAD - (q - arcCentre(ai)) ** 2)) - 0.2;
        const p0 = at(s, side * (HW - 0.3), lo(s)), p1 = at(e, side * (HW - 0.3), lo(e)), q1 = at(e, side * (HW - 0.3), deck(e) + 1.0), q0 = at(s, side * (HW - 0.3), deck(s) + 1.0);
        push(p0, p1, q1, p0, q1, q0);
      }
    }
    // The piers' and abutments' faces into the arches (walls across the bridge under the cornice).
    for (let i = 0; i < 5; i++) for (const s of [arcCentre(i) - RAD, arcCentre(i) + RAD]) {
      const lo = Math.min(gr(s, 0), YF) - 0.5;
      const p0 = at(s, -HW, lo), p1 = at(s, HW, lo), q1 = at(s, HW, YS + 0.3), q0 = at(s, -HW, YS + 0.3);
      push(p0, p1, q1, p0, q1, q0);
    }
    // The cutwaters.
    for (let i = 0; i < 4; i++) {
      const p0 = arcCentre(i) + RAD, p1 = p0 + PIER, pm = (p0 + p1) / 2, lo = YF - 0.5, hi = YS + 0.6;
      for (const [sa, wa, sb, wb] of [[p0, HW, pm, HW + CUT], [pm, HW + CUT, p1, HW]]) {
        const P0 = at(sa, wa, lo), P1 = at(sb, wb, lo), Q1 = at(sb, wb, hi), Q0 = at(sa, wa, hi);
        push(P0, P1, Q1, P0, Q1, Q0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    b.collide(g);
  }
  b.absY = null;

  // Reeds and scrub on the banks, never on the road.
  const kinds: [PropId, number][] = [['weed_plant_02', 3], ['grass_medium_02', 1], ['fern_02', 2.6], ['shrub_02', 0.8]];
  for (let k = 0; k < 40; k++) {
    const s = R(S0 - 4, S1 + 4), w = (rand() < 0.5 ? -1 : 1) * R(HW + 1.5, HW + 14);
    const [x, z] = xz(s, w);
    const [id, sc] = kinds[Math.floor(rand() * kinds.length)];
    placeProp(null, id, x, 0, z, R(0, 6), sc * R(0.7, 1.2));
  }
}
