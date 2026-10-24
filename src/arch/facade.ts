import * as THREE from 'three';
import type { Builder } from '../builder';
import type { MatName } from '../materials';
import { Acc, Frame, R, chance, box, voussoirs, planks } from './kit';
import { tiledLeanTo } from './roof';
import { torch, bracketLantern } from '../lights';

// A street front, built the way these walls were: a thick wall of rubble or
// reused brick, pierced by a few small openings with deep reveals; arches of
// separate voussoirs or a timber lintel under a relieving arch; projecting
// stone sills and thresholds; plank doors and shutters with iron straps set
// back in the reveals; dressed quoins at the corners; a batter at the foot;
// an upper floor that may jut out on joists, with a gallery on brackets.

type V2 = THREE.Vector2;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

interface Opening { u0: number; u1: number; v0: number; v1: number; arch: boolean }

function holePath(o: Opening) {
  const p = new THREE.Path();
  const r = (o.u1 - o.u0) / 2, c = (o.u0 + o.u1) / 2;
  p.moveTo(o.u0, o.v0);
  p.lineTo(o.u1, o.v0);
  if (o.arch) {
    p.lineTo(o.u1, o.v1);
    p.absarc(c, o.v1, r, 0, Math.PI, false);
  } else {
    p.lineTo(o.u1, o.v1);
    p.lineTo(o.u0, o.v1);
  }
  p.closePath();
  return p;
}

/** The wall panel itself: a slab from u 0..L, v y0..y1, w -T..0 with the openings cut through. */
function panel(b: Builder, m: MatName, f: Frame, L: number, y0: number, y1: number, T: number, ops: Opening[], wOff = 0) {
  const s = new THREE.Shape();
  s.moveTo(0, y0); s.lineTo(L, y0); s.lineTo(L, y1); s.lineTo(0, y1); s.closePath();
  for (const o of ops) s.holes.push(holePath(o));
  const g = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -T + wOff);
  const M = new THREE.Matrix4().makeBasis(f.x, f.y, f.z).setPosition(f.o);
  b.add(g, m, M, false, false);
}

/** Planked leaf filling an opening at depth w (arched tops follow the arch). */
function leaf(acc: Acc, f: Frame, o: Opening, w: number, straps = true) {
  const r = (o.u1 - o.u0) / 2, c = (o.u0 + o.u1) / 2;
  const top = (u: number) => (o.arch ? o.v1 + Math.sqrt(Math.max(0, r * r - (u - c) * (u - c))) - 0.02 : o.v1);
  planks(acc, 'wood', f, o.u0 - 0.01, o.u1 + 0.01, o.v0, top, w, 0.05, R(0.13, 0.2));
  if (!straps) return;
  const hgt = o.v1 - o.v0;
  for (const t of hgt > 1.2 ? [0.18, 0.78] : [0.25, 0.75]) {
    const v = o.v0 + hgt * t;
    box(acc, 'iron', f, o.u0 + (o.u1 - o.u0) * 0.38, v, w + 0.012, (o.u1 - o.u0) * 0.36, 0.025, 0.008, 0.002);
  }
}

export interface FacadeSpec {
  a: V2; b: V2; out: V2;       // front edge (a→b) and outward normal
  base: number;                // bottom of the wall (below ground)
  h1: number; h: number;       // ground floor height, eaves height
  lower: MatName; upper: MatName;
  street: number;              // width of the street in front
  lamp: boolean;
}

/** Build one street front. Returns the jetty depth, so the roof can follow it. */
export function facade(b: Builder, acc: Acc, s: FacadeSpec): number {
  let A = s.a, B = s.b;
  let e = B.clone().sub(A);
  const L = e.length();
  e.normalize();
  const out3 = v3(s.out.x, 0, s.out.y);
  // Keep the frame right-handed (u × v = w) so extrusions are not mirrored.
  if (v3(e.x, 0, e.y).cross(v3(0, 1, 0)).dot(out3) < 0) { [A, B] = [B, A]; e = e.negate(); }
  const f = Frame.facade(A.x, A.y, e.x, e.y, s.out.x, s.out.y);
  const stoneM: MatName = s.lower === 'brick' ? 'brick' : chance(0.75) ? 'stone' : 'bigstone';
  const T = R(0.5, 0.72);

  // ---- ground floor: a door (arched or under a lintel), maybe a slit or a shop arch
  const ops: Opening[] = [];
  const dw = R(0.92, 1.22);
  const du = THREE.MathUtils.clamp(R(0.55, L - 0.55 - dw), 0.45, Math.max(0.45, L - 0.45 - dw));
  const archDoor = chance(0.65);
  const door: Opening = { u0: du, u1: du + dw, v0: 0, v1: archDoor ? R(1.62, 1.9) : R(1.95, 2.15), arch: archDoor };
  if (door.u1 < L - 0.3) ops.push(door);
  const doorTop = door.arch ? door.v1 + dw / 2 : door.v1;
  // A small barred slit or a second, older arch now walled up.
  const free = (u0: number, u1: number, list = ops) => list.every((o) => u1 < o.u0 - 0.45 || u0 > o.u1 + 0.45) && u0 > 0.4 && u1 < L - 0.4;
  const slitU = R(0.4, L - 0.8);
  const slit: Opening = { u0: slitU, u1: slitU + R(0.16, 0.26), v0: R(1.2, 1.5), v1: 0, arch: false };
  slit.v1 = slit.v0 + R(0.45, 0.7);
  if (chance(0.45) && free(slit.u0, slit.u1)) ops.push(slit);
  const lowTop = Math.min(s.h, s.h1 + (s.upper === s.lower ? 0 : 0));
  const jetty = s.upper !== s.lower && (s.upper === 'wood' || s.upper === 'plaster') && chance(0.55) ? R(0.3, 0.55) : 0;
  const oneMass = s.upper === s.lower && jetty === 0;

  // ---- upper floors: small windows at irregular places
  const up: Opening[] = [];
  const floors: number[] = [];
  for (let y = s.h1 + R(0.75, 1.15); y < s.h - 1.0; y += R(2.4, 3.0)) floors.push(y);
  const balcony = floors.length > 0 && jetty === 0 && chance(0.13) && L > 2.6;
  for (const fy of floors) {
    const n = Math.max(1, Math.round(L / R(2.3, 3.6)));
    for (let i = 0; i < n; i++) {
      if (chance(0.22)) continue;
      const ww = R(0.42, 0.68), wh = R(0.6, 0.92);
      const u0 = R(0.45, L - 0.45 - ww);
      const o: Opening = { u0, u1: u0 + ww, v0: fy, v1: fy + wh, arch: chance(0.5) };
      if (up.every((q) => q.v0 !== fy || o.u1 < q.u0 - 0.5 || o.u0 > q.u1 + 0.5) && o.v1 + (o.arch ? ww / 2 : 0) < s.h - 0.35) up.push(o);
    }
  }
  if (balcony) {
    const fy = floors[0] - 0.55, bw = R(0.8, 1.0);
    const u0 = THREE.MathUtils.clamp(R(0.5, L - 0.5 - bw), 0.45, L - 0.45 - bw);
    for (let i = up.length - 1; i >= 0; i--) if (up[i].v0 === floors[0] && !(up[i].u1 < u0 - 0.4 || up[i].u0 > u0 + bw + 0.4)) up.splice(i, 1);
    up.push({ u0, u1: u0 + bw, v0: fy, v1: fy + R(1.6, 1.8), arch: false });
  }

  // ---- the wall panels
  if (oneMass) {
    panel(b, s.lower, f, L, s.base, s.h, T, [...ops, ...up]);
  } else {
    panel(b, s.lower, f, L, s.base, lowTop, T, ops);
    panel(b, s.upper, f, L, lowTop, s.h, s.upper === 'wood' ? 0.22 : 0.4, up, jetty);
    if (jetty > 0) {
      // Joists carry the jettied floor; their ends show under the overhang.
      for (let u = R(0.1, 0.3); u < L - 0.05; u += R(0.42, 0.55)) box(acc, 'wood', f, u, lowTop - 0.11, jetty / 2 - 0.1, 0.07, 0.1, jetty / 2 + 0.16, 0.012);
      box(acc, 'wood', f, L / 2, lowTop + 0.06, jetty - 0.12, L / 2 + 0.02, 0.07, 0.12, 0.01);
      for (const u of [0, L]) box(acc, s.upper, f, u + (u ? -0.06 : 0.06), (lowTop + s.h) / 2, jetty / 2 - 0.05, 0.06, (s.h - lowTop) / 2, jetty / 2 + 0.05);
    } else {
      // A string course or a slight set-back where the build changes.
      box(acc, stoneM === 'brick' ? 'brick' : 'stone', f, L / 2, lowTop - 0.04, 0.03, L / 2, 0.06, 0.07, 0.01);
    }
  }

  // ---- details around the openings
  const detailOpening = (o: Opening, wFace: number, big: boolean, isDoor: boolean) => {
    const w = o.u1 - o.u0, c = (o.u0 + o.u1) / 2, r = w / 2;
    const brick = s.lower === 'brick' || chance(0.4);
    if (o.arch) {
      voussoirs(acc, brick ? 'brick' : stoneM, f, c, o.v1, r, r + (brick ? R(0.3, 0.42) : R(0.24, 0.34)), wFace - 0.09, wFace + 0.005, 0, Math.PI, brick ? 0.075 : R(0.17, 0.24));
      // Jamb stones up the sides of doorways.
      if (isDoor && !brick) {
        for (let v = o.v0, k = 0; v < o.v1 - 0.1; k++) {
          const hgt = Math.min(o.v1 - v, R(0.26, 0.36));
          for (const side of [-1, 1]) {
            const ln = k % 2 ? R(0.22, 0.3) : R(0.34, 0.46);
            box(acc, stoneM, f, side < 0 ? o.u0 - ln / 2 - 0.006 : o.u1 + ln / 2 + 0.006, v + hgt / 2, wFace - 0.04, ln / 2, hgt / 2 - 0.006, 0.05, 0.008);
          }
          v += hgt;
        }
      }
    } else {
      // Timber lintel (end grain shows past the jambs), or a stone one; relieving arch above.
      const wood = chance(0.6);
      const ext = R(0.2, 0.32);
      box(acc, wood ? 'wood' : stoneM, f, c, o.v1 + 0.1, wFace - (big ? T / 2 : 0.15) + 0.02, r + ext, 0.1, big ? T / 2 + 0.02 : 0.17, 0.012);
      if (big || chance(0.4)) {
        const rr = r + ext * 0.7;
        voussoirs(acc, 'brick', f, c, o.v1 + 0.2, rr, rr + 0.18, wFace - 0.06, wFace + 0.004, 0.25, Math.PI - 0.25, 0.075);
      }
    }
    // Sill or threshold.
    if (isDoor) box(acc, 'slab', f, c, -0.06, wFace - T / 2 + 0.06, r + 0.08, 0.08, T / 2 + 0.08, 0.01);
    else box(acc, stoneM === 'bigstone' ? 'stone' : stoneM, f, c, o.v0 - 0.06, wFace - 0.12, r + R(0.06, 0.12), 0.06, 0.2, 0.01);
  };

  // Door: planked leaf set back in the deep reveal; sometimes standing ajar.
  if (ops.includes(door)) {
    detailOpening(door, 0, true, true);
    if (chance(0.82)) {
      leaf(acc, f, door, -T * R(0.4, 0.6));
      // Ring handle.
      box(acc, 'iron', f, door.u0 + dw * 0.78, 1.0, -T * 0.5 + 0.03, 0.035, 0.05, 0.02);
    } else {
      // Ajar: darkness inside, the leaf swung in against the reveal.
      box(acc, 'iron', f, (door.u0 + door.u1) / 2, (door.v1 + door.v0) / 2 + 0.2, -T + 0.03, dw / 2, (door.v1 - door.v0) / 2 + 0.4, 0.01);
    }
  }
  if (ops.includes(slit)) {
    detailOpening(slit, 0, false, false);
    box(acc, 'iron', f, (slit.u0 + slit.u1) / 2, (slit.v0 + slit.v1) / 2, -T * 0.6, (slit.u1 - slit.u0) / 2 + 0.02, (slit.v1 - slit.v0) / 2 + 0.02, 0.01);
  }
  const upFace = oneMass ? 0 : jetty;
  const upT = oneMass ? T : s.upper === 'wood' ? 0.22 : 0.4;
  for (const o of up) {
    const isDoor = o.v1 - o.v0 > 1.4;
    detailOpening(o, upFace, false, false);
    const w = o.u1 - o.u0, c = (o.u0 + o.u1) / 2;
    const glow = chance(0.3);
    const behind = upFace - upT + 0.02;
    if (isDoor || chance(0.55)) {
      // Closed shutters (two leaves) just inside the reveal.
      const mid = { ...o, u1: c - 0.005 }, mid2 = { ...o, u0: c + 0.005 };
      leaf(acc, f, mid, upFace - 0.1, true);
      leaf(acc, f, mid2, upFace - 0.1, true);
      if (glow) box(acc, 'window', f, c, (o.v0 + o.v1) / 2, behind + 0.06, w / 2, (o.v1 - o.v0) / 2, 0.01);
    } else {
      // One leaf swung open flat against the wall; inside, dark or firelit.
      box(acc, glow ? 'window' : 'iron', f, c, (o.v0 + o.v1) / 2 + (o.arch ? w / 4 : 0), behind, w / 2 + 0.02, (o.v1 - o.v0) / 2 + (o.arch ? w / 2 : 0), 0.01);
      const lw = w / 2;
      planks(acc, 'wood', f, o.u1 + 0.03, o.u1 + 0.03 + lw, o.v0, () => o.v1 - 0.02, upFace + 0.06, 0.04, 0.12);
      box(acc, 'iron', f, o.u1 + 0.03 + lw / 2, o.v0 + (o.v1 - o.v0) * 0.25, upFace + 0.065, lw / 2, 0.02, 0.006);
      box(acc, 'iron', f, o.u1 + 0.03 + lw / 2, o.v0 + (o.v1 - o.v0) * 0.75, upFace + 0.065, lw / 2, 0.02, 0.006);
    }
    if (glow && chance(0.35)) {
      const p = f.p(c, o.v0 + 0.4, upFace + 0.6);
      b.lamp('window', p);
    }
  }

  // ---- balcony: cantilevered beams on brackets, plank floor, pole railing, a pentice
  if (balcony) {
    const o = up[up.length - 1];
    const u0 = o.u0 - R(0.7, 1.1), u1 = o.u1 + R(0.7, 1.1);
    const bu0 = Math.max(0.1, u0), bu1 = Math.min(L - 0.1, u1);
    const depth = R(0.85, 1.05), fy = o.v0;
    const nB = Math.max(2, Math.round((bu1 - bu0) / 0.75));
    for (let i = 0; i <= nB; i++) {
      const u = bu0 + ((bu1 - bu0) * i) / nB;
      box(acc, 'wood', f, u, fy - 0.12, depth / 2 - 0.15, 0.06, 0.08, depth / 2 + 0.15, 0.01);
      // Diagonal strut from the wall to the beam end.
      const p0 = f.p(u - 0.04, fy - 0.85, 0.02), p1 = f.p(u + 0.04, fy - 0.85, 0.02);
      const p2 = f.p(u + 0.04, fy - 0.2, depth - 0.12), p3 = f.p(u - 0.04, fy - 0.2, depth - 0.12);
      const lift = v3(0, 0.08, 0);
      acc.hexa('wood', [p0, p1, p2, p3, p0.clone().add(lift), p1.clone().add(lift), p2.clone().add(lift), p3.clone().add(lift)]);
    }
    // Floor boards run along the façade.
    for (let w = 0.02; w < depth - 0.05; w += 0.16) box(acc, 'wood', f, (bu0 + bu1) / 2 + R(-0.03, 0.03), fy - 0.02, w + 0.07, (bu1 - bu0) / 2 + R(-0.05, 0.05), 0.025, 0.07, 0.01);
    // Railing of split poles.
    for (let u = bu0 + 0.05; u <= bu1; u += R(0.5, 0.7)) box(acc, 'wood', f, u, fy + 0.45, depth - 0.06, 0.035, 0.45, 0.035, 0.015);
    for (const hv of [0.92, 0.5]) box(acc, 'wood', f, (bu0 + bu1) / 2, fy + hv, depth - 0.06, (bu1 - bu0) / 2 + 0.05, 0.03, 0.03, 0.02);
    if (chance(0.5)) {
      const pc = f.p((bu0 + bu1) / 2, 0, (depth + 0.3) / 2);
      tiledLeanTo(acc, bu1 - bu0 + 0.5, depth + 0.3, fy + 2.35, fy + 1.95, pc.x, pc.z, Math.atan2(s.out.x, s.out.y) + Math.PI);
    }
  }

  // ---- pentice over the street door
  if (ops.includes(door) && !balcony && chance(0.22) && s.street > 1.5) {
    const c = (door.u0 + door.u1) / 2, run = Math.min(0.85, s.street * 0.4);
    const pc = f.p(c, 0, run / 2);
    const yTop = doorTop + R(0.5, 0.7);
    tiledLeanTo(acc, dw + 0.9, run, yTop, yTop - 0.35, pc.x, pc.z, Math.atan2(s.out.x, s.out.y) + Math.PI);
    for (const side of [-1, 1]) {
      const u = c + side * (dw / 2 + 0.3);
      const p0 = f.p(u - 0.03, yTop - 0.75, 0), p1 = f.p(u + 0.03, yTop - 0.75, 0), p2 = f.p(u + 0.03, yTop - 0.2, run - 0.1), p3 = f.p(u - 0.03, yTop - 0.2, run - 0.1);
      const l = v3(0, 0.07, 0);
      acc.hexa('wood', [p0, p1, p2, p3, p0.clone().add(l), p1.clone().add(l), p2.clone().add(l), p3.clone().add(l)]);
    }
  }

  // ---- quoins at the two corners, long and short in turn
  if (s.lower !== 'brick' || chance(0.4)) {
    for (const [u, dir] of [[0, 1], [L, -1]] as const) {
      if (chance(0.25)) continue;
      const qm: MatName = chance(0.15) ? 'marble' : stoneM === 'brick' ? 'stone' : stoneM;
      let v = s.base + 0.3;
      for (let k = 0; v < (oneMass ? s.h : lowTop) - 0.15; k++) {
        const hgt = R(0.26, 0.38);
        const ln = k % 2 ? R(0.24, 0.32) : R(0.42, 0.6);
        box(acc, qm, f, u + dir * (ln / 2 - 0.02), v + hgt / 2, -0.12, ln / 2, hgt / 2 - 0.006, 0.145, 0.01);
        v += hgt;
      }
    }
  }

  // ---- batter at the foot, broken by the door
  const segs: [number, number][] = [];
  if (ops.includes(door)) segs.push([0, door.u0 - 0.05], [door.u1 + 0.05, L]); else segs.push([0, L]);
  for (const [u0, u1] of segs) {
    if (u1 - u0 < 0.2) continue;
    box(acc, stoneM === 'brick' ? 'rubble' : stoneM, f, (u0 + u1) / 2, -0.05, 0.04, (u1 - u0) / 2, 0.28, 0.08, 0.02);
  }

  // ---- putlog holes in rows, a reused Roman block, an old arch walled up
  for (let v = 1.5 + R(-0.2, 0.2); v < s.h - 0.6; v += R(1.3, 1.8)) {
    for (let u = R(0.3, 1.0); u < L - 0.3; u += R(1.1, 2.0)) {
      if (chance(0.45)) continue;
      const clear = [...ops, ...up].every((o) => u < o.u0 - 0.3 || u > o.u1 + 0.3 || v < o.v0 - 0.3 || v > o.v1 + 0.6);
      if (!clear) continue;
      box(acc, 'iron', f, u, v, (v > lowTop && !oneMass ? upFace : 0) + 0.004, 0.065, 0.065, 0.006);
    }
  }
  if (chance(0.22)) {
    const u = R(0.4, L - 1.3), v = R(0.35, Math.max(0.4, lowTop - 0.9));
    if ([...ops].every((o) => u + 1 < o.u0 - 0.1 || u > o.u1 + 0.1)) box(acc, 'marble', f, u + 0.5, v, 0.012, R(0.35, 0.55), R(0.16, 0.26), 0.03, 0.01);
  }
  if (chance(0.18) && L > 3.4) {
    // A wider, older arch, blocked with different stuff.
    const bw = R(1.6, Math.min(2.6, L - 1)), u0 = R(0.4, L - 0.4 - bw);
    const blk: Opening = { u0, u1: u0 + bw, v0: 0, v1: R(1.3, 1.7), arch: true };
    if (free(blk.u0, blk.u1)) {
      voussoirs(acc, s.lower === 'brick' ? 'stone' : 'brick', f, u0 + bw / 2, blk.v1, bw / 2, bw / 2 + 0.36, -0.06, 0.012, 0, Math.PI, 0.09);
      box(acc, s.lower === 'brick' ? 'rubble' : 'brick', f, u0 + bw / 2, blk.v1 / 2, 0.006, bw / 2 - 0.02, blk.v1 / 2, 0.01);
      for (let k = 0; k < 7; k++) {
        const a = (k + 0.5) / 7 * Math.PI, rr = bw / 2 - 0.05;
        box(acc, s.lower === 'brick' ? 'rubble' : 'brick', f, u0 + bw / 2 + Math.cos(a) * rr * 0.55, blk.v1 + Math.sin(a) * rr * 0.55, 0.006, rr * 0.3, rr * 0.3, 0.01);
      }
    }
  }

  // ---- a lamp by the door
  if (s.lamp && ops.includes(door)) {
    const p = f.p(door.u1 + 0.45 < L ? door.u1 + 0.4 : door.u0 - 0.4, 0, 0.02);
    const ry = Math.atan2(s.out.x, s.out.y);
    if (chance(0.6)) bracketLantern(b, p.x, 2.2, p.z, ry);
    else torch(b, p.x, 2.4, p.z, ry);
  }
  return jetty;
}
