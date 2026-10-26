import * as THREE from 'three';
import type { Builder } from '../builder';
import { rng } from '../builder';
import type { MatName } from '../materials';
import { Acc, Frame, box } from './kit';

// Life on and around the houses: the outside stair of a two-storey house
// (the *casa solarata* of the early-medieval charters), woodpiles and benches
// against the street fronts, poles of washing out of the upper windows,
// patches of lime render and lacing courses of reused Roman brick on rubble
// walls, joist heads, hanging baskets. See docs/benevento/ARCHITECTURE.md.
//
// Everything that has a footprint in the street (stairs, woodpiles, benches)
// is planned from the lot's own seed by a pure function, so the collision
// pass on the main thread (fabric.ts, 'collide' mode) can place the same
// solids without building the house. Everything else is pure decoration,
// drawn from its own random stream at full detail only.

type V2 = THREE.Vector2;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export interface FrontLine { a: V2; b: V2; out: V2 }

/** An outside stair along a street front: landing at one end, flight running down towards the other. */
export interface StairPlan {
  /** Foot of the flight and the far end of the landing, on the wall line (world x/z). */
  foot: V2; end: V2;
  /** Landing length along the wall, run of the flight, depth out from the wall, landing height. */
  land: number; run: number; depth: number; hL: number;
}

/** Things set against a street front, in metres along the wall from `a` (u) and out from it. */
export interface FrontItem { kind: 'wood' | 'bench' | 'jars' | 'cart' | 'ladder' | 'scaffold'; u: number; len: number; depth: number; h: number }

export interface FrontPlan { stair: StairPlan | null; items: FrontItem[] }

/**
 * What stands in the street in front of a house (pure: same answer on every
 * thread). `street` is the width of the lane in front.
 */
export function planFront(fr: FrontLine, street: number, h: number, seed: number, sideWall = false): FrontPlan {
  const r = rng(seed * 13 + 5);
  const R = (a: number, b: number) => a + (b - a) * r();
  const L = fr.a.distanceTo(fr.b);
  const e = fr.b.clone().sub(fr.a).normalize();
  let stair: StairPlan | null = null;
  const pStair = r(), side = r() < 0.5, hL = R(2.55, 3.0), depth = R(0.85, 1.0);
  const run = hL / 0.235 * 0.27 + 0.1;
  const land = R(1.05, 1.3);
  // A two-storey house on a lane wide enough to keep the stair out of the way.
  if (!sideWall && pStair < 0.35 && street >= 2.7 && h > hL + 2.0 && L > run + land + 1.6) {
    const end = side ? fr.a.clone() : fr.b.clone();
    const dir = side ? e : e.clone().negate();
    stair = { end: end.clone().addScaledVector(dir, 0.15), foot: end.clone().addScaledVector(dir, 0.15 + land + run), land, run, depth, hL };
  }
  const items: FrontItem[] = [];
  // Woodpiles, a stone bench, jars by the door, now and then a handcart, on lanes that have room.
  if (street >= 1.8) {
    const n = Math.floor(R(0.6, 3.4));
    const taken: [number, number][] = [];
    if (stair) {
      const su = [stair.foot, stair.end].map((p) => p.clone().sub(fr.a).dot(e));
      taken.push([Math.min(...su) - 0.3, Math.max(...su) + 0.3]);
    }
    for (let i = 0; i < n; i++) {
      const k = r();
      const kind: FrontItem['kind'] = k < 0.42 ? 'wood' : k < 0.68 ? 'bench' : k < 0.9 ? 'jars' : 'cart';
      const len = kind === 'wood' ? R(1.0, 2.2) : kind === 'bench' ? R(1.1, 1.8) : kind === 'jars' ? R(0.5, 0.9) : 1.9;
      const depthI = kind === 'wood' ? R(0.38, 0.5) : kind === 'bench' ? 0.38 : kind === 'jars' ? 0.42 : 1.15;
      if (kind === 'cart' && (street < 3.4 || sideWall)) continue;
      if (street < 2.2 && kind !== 'jars' && kind !== 'wood') continue;
      const u = R(0.3, Math.max(0.31, L - 0.3 - len));
      if (u + len > L - 0.2) continue;
      if (taken.some(([t0, t1]) => u < t1 && u + len > t0)) continue;
      taken.push([u - 0.2, u + len + 0.2]);
      items.push({ kind, u, len, depth: depthI, h: kind === 'wood' ? R(0.7, 1.35) : kind === 'bench' ? 0.45 : kind === 'jars' ? 0.7 : 1.0 });
    }
  }
  // A ladder against the wall (to the upper window, or to the roof), and now
  // and then a front under repair: a scaffold of poles lashed to putlogs.
  const pL = r(), pS = r(), uL = r(), uS = r(), hS = r();
  const freeAt = (u0: number, u1: number) => items.every((it) => u1 < it.u - 0.2 || u0 > it.u + it.len + 0.2) &&
    !(stair && (() => { const su = [stair.foot, stair.end].map((p) => p.clone().sub(fr.a).dot(e)); return u1 > Math.min(...su) - 0.3 && u0 < Math.max(...su) + 0.3; })());
  if (street >= 1.9 && pS < 0.05 && L > 3.5 && h > 4.5) {
    const len = Math.min(L - 0.4, 3 + uS * 4), u = 0.2 + (L - 0.4 - len) * hS;
    if (freeAt(u, u + len)) items.push({ kind: 'scaffold', u, len, depth: 1.05, h: Math.min(h - 0.6, 3 + hS * 4) });
  } else if (street >= 1.9 && pL < 0.22) {
    const u = 0.4 + (L - 1.2) * uL;
    if (L > 2 && freeAt(u, u + 0.5)) items.push({ kind: 'ladder', u, len: 0.45, depth: 0.9, h: Math.min(h - 0.2, 2.6 + hS * 2.2) });
  }
  return { stair, items };
}

/** Collision solids for a front plan (a ramp for the stair, boxes for the rest), as a triangle soup. */
export function frontColliders(fr: FrontLine, p: FrontPlan): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const e = fr.b.clone().sub(fr.a).normalize(), o = fr.out;
  const P = (q: V2, w: number, y: number) => [q.x + o.x * w, y, q.y + o.y * w];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); };
  const solid = (A: V2, B: V2, w: number, ya: number, yb: number) => {
    // A prism from the wall out to w: top sloping from ya (at A) to yb (at B).
    const a0 = P(A, 0, -0.3), b0 = P(B, 0, -0.3), a1 = P(A, w, -0.3), b1 = P(B, w, -0.3);
    const a2 = P(A, 0, ya), b2 = P(B, 0, yb), a3 = P(A, w, ya), b3 = P(B, w, yb);
    quad(a2, b2, b3, a3); quad(a1, b1, b3, a3); quad(a0, a1, a3, a2); quad(b0, b1, b3, b2);
  };
  if (p.stair) {
    const s = p.stair, d = s.foot.clone().sub(s.end).normalize();
    const lEnd = s.end.clone().addScaledVector(d, s.land);
    solid(s.end, lEnd, s.depth, s.hL, s.hL);
    solid(lEnd, s.foot, s.depth, s.hL, 0.05);
  }
  for (const it of p.items) {
    if (it.kind === 'jars' || it.kind === 'ladder') continue;
    if (it.kind === 'scaffold') {
      for (const u of scaffoldPoles(it)) {
        const A = fr.a.clone().addScaledVector(e, u - 0.07), B = fr.a.clone().addScaledVector(e, u + 0.07);
        const o2 = fr.out;
        const a2 = A.clone().addScaledVector(o2, it.depth - 0.07), b2 = B.clone().addScaledVector(o2, it.depth - 0.07);
        const top = it.h + 1;
        quad(P(a2, 0, -0.3), P(b2, 0, -0.3), P(b2, 0, top), P(a2, 0, top));
        quad(P(a2, 0.14, -0.3), P(b2, 0.14, -0.3), P(b2, 0.14, top), P(a2, 0.14, top));
      }
      continue;
    }
    const A = fr.a.clone().addScaledVector(e, it.u), B = fr.a.clone().addScaledVector(e, it.u + it.len);
    solid(A, B, it.depth, it.h, it.h);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Frame on a front line with u from fr.a, w out of the wall (right-handed). */
function frontFrame(fr: FrontLine) {
  const e = fr.b.clone().sub(fr.a).normalize();
  // u × v must equal w: (e,0) × (0,1,0) = (-e.z... ) check the sign and flip u if needed.
  const right = v3(e.x, 0, e.y).cross(v3(0, 1, 0)).dot(v3(fr.out.x, 0, fr.out.y)) >= 0;
  return { f: Frame.facade(fr.a.x, fr.a.y, e.x, e.y, fr.out.x, fr.out.y), right };
}

/** Render the stair and the things in front of a house. */
export function buildFront(acc: Acc, fr: FrontLine, p: FrontPlan, stoneM: MatName, seed: number) {
  const r = rng(seed * 7 + 3);
  const R = (a: number, b: number) => a + (b - a) * r();
  const { f } = frontFrame(fr);
  const e = fr.b.clone().sub(fr.a).normalize();
  const uOf = (q: V2) => q.clone().sub(fr.a).dot(e);
  // Note: Frame.facade(u=e, w=out) is used only through f.p(u, v, w); handedness only
  // matters to extrusions, and acc.hexa winds every face outward by itself.
  if (p.stair) {
    const s = p.stair;
    const uE = uOf(s.end), uF = uOf(s.foot), dir = Math.sign(uF - uE);
    const uL = uE + dir * s.land;
    const D = s.depth;
    // Landing slab on a rubble pier, its edge a row of flat stones.
    const lu0 = Math.min(uE, uL), lu1 = Math.max(uE, uL);
    box(acc, 'rubble', f, (lu0 + lu1) / 2, (s.hL - 0.3) / 2 - 0.15, D / 2, (lu1 - lu0) / 2, (s.hL - 0.15) / 2 + 0.15, D / 2, 0.02);
    box(acc, 'slab', f, (lu0 + lu1) / 2, s.hL - 0.06, D / 2 + 0.03, (lu1 - lu0) / 2 + 0.04, 0.07, D / 2 + 0.05, 0.01);
    // The flight: each step a stone on a sloping rubble wall that carries it.
    const n = Math.max(4, Math.round(s.hL / 0.235));
    const rise = s.hL / n, tread = (s.run - 0.1) / n;
    for (let i = 0; i < n; i++) {
      const y = s.hL - rise * (i + 1);
      const ua = uL + dir * tread * i, ub = uL + dir * tread * (i + 1), u = (ua + ub) / 2;
      // The mass of the flight under each step (one solid of rubble), then the step stone with its nosing.
      const top = y + rise - 0.1;
      const q = (uu: number, v: number, w: number) => f.p(uu, v, w);
      acc.hexa('rubble', [q(ua, -0.2, 0), q(ub, -0.2, 0), q(ub, -0.2, D - 0.04), q(ua, -0.2, D - 0.04), q(ua, top, 0), q(ub, top, 0), q(ub, top, D - 0.04), q(ua, top, D - 0.04)], true, true);
      box(acc, stoneM === 'brick' ? 'block' : stoneM, f, u + dir * 0.02 + R(-0.01, 0.01), top + 0.05, D / 2 + R(-0.01, 0.01), tread / 2 + 0.03, 0.05, D / 2 + R(0, 0.03), 0.01);
    }
    // A pole rail on the open side.
    const rails = [lu0 + 0.05, lu1 - 0.05];
    for (const u of rails) box(acc, 'wood', f, u, s.hL + 0.48, D - 0.06, 0.035, 0.48, 0.035, 0.01);
    box(acc, 'wood', f, (lu0 + lu1) / 2, s.hL + 0.92, D - 0.06, (lu1 - lu0) / 2, 0.03, 0.03, 0.01);
  }
  for (const it of p.items) {
    const u0 = it.u, u1 = it.u + it.len, D = it.depth;
    if (it.kind === 'wood') {
      // Split logs stacked against the wall, under a few boards.
      // The stack (one block), the cut ends of the logs on its face.
      box(acc, 'wood', f, (u0 + u1) / 2, it.h / 2, D / 2 - 0.03, (u1 - u0) / 2, it.h / 2, D / 2 - 0.03, 0.02);
      const rows = Math.max(2, Math.round(it.h / 0.15));
      const back = f.p((u0 + u1) / 2, it.h / 2, -1);
      for (let k = 0; k < rows; k++) {
        const y = k * (it.h / rows) + 0.01;
        for (let u = u0 + R(0, 0.06); u < u1 - 0.08; u += R(0.12, 0.17)) {
          const rr = R(0.05, 0.075), w = D - 0.06 + R(-0.01, 0.04), j = R(-0.01, 0.01);
          // Fresh-cut ends are pale against the grey bark.
          acc.quad(r() < 0.7 ? 'marble' : 'wood', f.p(u, y + j, w), f.p(u + 2 * rr, y, w), f.p(u + 2 * rr + j, y + 2 * rr, w), f.p(u, y + 2 * rr, w), back);
        }
      }
      box(acc, 'wood', f, (u0 + u1) / 2, it.h + 0.03, D / 2 + 0.05, (u1 - u0) / 2 + 0.1, 0.02, D / 2 + 0.12, 0.02);
    } else if (it.kind === 'bench') {
      // A slab on two rough stones (or a reused column drum).
      box(acc, 'slab', f, (u0 + u1) / 2, 0.4, D / 2, (u1 - u0) / 2, 0.05, D / 2, 0.01);
      for (const u of [u0 + 0.2, u1 - 0.2]) box(acc, r() < 0.2 ? 'marble' : 'block', f, u, 0.17, D / 2 - 0.02, 0.14, 0.2, D / 2 - 0.05, 0.02);
    } else if (it.kind === 'jars') {
      // Storage jars and a basket: octagonal pots of clay.
      for (let u = u0 + 0.2; u < u1; u += R(0.3, 0.42)) jar(acc, f, u, D / 2 + R(-0.05, 0.05), R(0.42, 0.72), R(0.14, 0.2), r);
    } else if (it.kind === 'cart') {
      // The scanned cart is placed with the town's props (world.ts townProps).
    } else if (it.kind === 'ladder') {
      // Two rails of rough poles, rungs lashed across, leaning at ~75 degrees.
      const foot = Math.min(D, it.h * 0.27);
      for (const s of [0, 1]) pole(acc, f.p(u0 + s * 0.42, 0, foot), f.p(u0 + s * 0.42 + R(-0.02, 0.02), it.h, 0.06), 0.03);
      for (let y = 0.3; y < it.h - 0.15; y += 0.3) {
        const w = foot * (1 - y / it.h) + 0.06 * (y / it.h);
        pole(acc, f.p(u0 - 0.03, y, w + 0.03), f.p(u0 + 0.45, y + R(-0.02, 0.02), w + 0.03), 0.02);
      }
    } else {
      // Scaffold: standards in the street, putlogs into the wall's holes, boards on them.
      const poles = scaffoldPoles(it);
      for (const u of poles) pole(acc, f.p(u + R(-0.03, 0.03), -0.2, D), f.p(u + R(-0.08, 0.08), it.h + R(0.6, 1.2), D + R(-0.06, 0.06)), 0.055);
      for (let y = 1.9; y < it.h + 0.1; y += 1.8) {
        for (const u of poles) pole(acc, f.p(u, y, -0.25), f.p(u, y + 0.02, D + 0.15), 0.045);
        pole(acc, f.p(u0 - 0.2, y + 0.05, D + 0.02), f.p(u1 + 0.2, y + 0.05 + R(-0.05, 0.05), D + 0.02), 0.04);
        for (let w = 0.12; w < D - 0.1; w += 0.26) box(acc, 'wood', f, (u0 + u1) / 2 + R(-0.1, 0.1), y + 0.12, w + 0.1, (u1 - u0) / 2 + R(0, 0.15), 0.025, 0.12, 0.01);
      }
      // Braces across the bays.
      for (let i = 0; i + 1 < poles.length; i += 2) pole(acc, f.p(poles[i], 0.1, D + 0.06), f.p(poles[i + 1], Math.min(it.h, 3.4), D + 0.06), 0.035);
    }
  }
}

/** An octagonal storage jar standing at (u, w) in a frame. */
export function jar(acc: Acc, f: Frame, u: number, w: number, h: number, rad: number, r: () => number, y0 = 0) {
  const seg = 7;
  const prof = [[0, 0.55], [0.12, 0.9], [0.45, 1.0], [0.8, 0.75], [0.92, 0.42], [1.0, 0.48]];
  const rings = prof.map(([t, k]) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2 + r() * 0.05;
      pts.push(f.p(u + Math.cos(a) * rad * k, y0 + t * h, w + Math.sin(a) * rad * k));
    }
    return pts;
  });
  const ctr = f.p(u, y0 + h * 0.5, w);
  for (let j = 0; j + 1 < rings.length; j++) for (let i = 0; i < seg; i++) {
    const a = rings[j][i], b = rings[j][(i + 1) % seg], c = rings[j + 1][(i + 1) % seg], d = rings[j + 1][i];
    acc.quad('roof', a, b, c, d, ctr); // terracotta (the coppi's own material: no extra draw call)
  }
}

/** A two-wheeled handcart with its shafts down, parked along the wall. */
export function cart(acc: Acc, f: Frame, u: number, w: number, r: () => number) {
  const L = 1.25, W = 0.85, yB = 0.52;
  // Bed of boards and low sides.
  box(acc, 'wood', f, u, yB, w, L / 2, 0.03, W / 2, 0.01);
  for (const s of [-1, 1]) box(acc, 'wood', f, u, yB + 0.15, w + s * (W / 2 - 0.02), L / 2, 0.12, 0.02, 0.01);
  box(acc, 'wood', f, u - L / 2 + 0.02, yB + 0.15, w, 0.02, 0.12, W / 2, 0.01);
  // Shafts reaching to the ground.
  for (const s of [-1, 1]) {
    const p0 = f.p(u + L / 2 - 0.1, yB - 0.04, w + s * 0.3), p1 = f.p(u + L / 2 + 0.85, 0.03, w + s * 0.25);
    const a = v3(0, 0.05, 0), b = v3(0, 0, 0.05);
    acc.hexa('wood', [p0, p1, p1.clone().add(b), p0.clone().add(b), p0.clone().add(a), p1.clone().add(a), p1.clone().add(a).add(b), p0.clone().add(a).add(b)]);
  }
  // Wheels: 8-sided discs with a hub.
  for (const s of [-1, 1]) {
    const cw = w + s * (W / 2 + 0.06), R0 = 0.42, n = 10, th = 0.05;
    const ctr = f.p(u, R0, cw);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const q = (a: number, rr: number, dw: number) => f.p(u + Math.cos(a) * rr, R0 + Math.sin(a) * rr, cw + dw);
      // Felloe segment.
      acc.hexa('wood', [q(a0, R0 - 0.06, -th), q(a1, R0 - 0.06, -th), q(a1, R0, -th), q(a0, R0, -th), q(a0, R0 - 0.06, th), q(a1, R0 - 0.06, th), q(a1, R0, th), q(a0, R0, th)]);
      void ctr;
    }
    for (const a of [0, Math.PI / 2]) box(acc, 'wood', f, u, R0, cw, Math.abs(Math.cos(a)) * (R0 - 0.05) + 0.02, Math.abs(Math.sin(a)) * (R0 - 0.05) + 0.02, 0.02);
    box(acc, 'wood', f, u, R0, cw, 0.06, 0.06, 0.07);
  }
  void r;
}

/** Wall dressing on a front: lacing courses of brick, render patches, joist heads. */
export interface WallDress {
  f: Frame; L: number; lower: MatName; upper: MatName; lowTop: number; h: number; upFace: number; oneMass: boolean;
  /** Openings (u0,u1,v0,v1) to keep clear. */
  holes: { u0: number; u1: number; v0: number; v1: number }[];
}

export function dressWall(acc: Acc, d: WallDress, seed: number) {
  const r = rng(seed * 17 + 11);
  const R = (a: number, b: number) => a + (b - a) * r();
  const clearU = (v0: number, v1: number) => d.holes.filter((o) => o.v1 + 0.5 > v0 && o.v0 - 0.15 < v1).map((o) => [o.u0 - 0.12, o.u1 + 0.12 + (o.v1 - o.v0 > 1.3 ? 0 : 0)] as [number, number]);
  const runs = (v0: number, v1: number, a: number, b: number) => {
    // The spans of [a, b] not cut by an opening at heights v0..v1.
    const cuts = clearU(v0, v1).sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    let u = a;
    for (const [c0, c1] of cuts) { if (c0 > u + 0.3) out.push([u, Math.min(c0, b)]); u = Math.max(u, c1); }
    if (b > u + 0.3) out.push([u, b]);
    return out;
  };
  // Lacing courses: bands of reused Roman brick through a rubble wall.
  const top = d.oneMass ? d.h : d.lowTop;
  if (d.lower === 'rubble' && r() < 0.55) {
    for (let v = R(0.6, 1.0); v < top - 0.4; v += R(0.9, 1.4)) {
      const hb = R(0.13, 0.24);
      for (const [a, b] of runs(v - hb, v + hb, 0.05, d.L - 0.05)) {
        // Broken into lengths, as the bricks came from different ruins.
        for (let u = a; u < b - 0.1;) {
          const l = Math.min(b - u, R(0.8, 2.4));
          box(acc, 'brick', d.f, u + l / 2, v, 0.012, l / 2 - 0.01, hb / 2 + R(-0.015, 0.015), 0.03, 0.012);
          u += l + (r() < 0.2 ? R(0.1, 0.5) : 0);
        }
      }
    }
  }
  // Patches of lime render left on the rubble or brick: thin ragged sheets.
  if (d.lower !== 'plaster' && r() < 0.65) {
    const n = 1 + Math.floor(R(0, 3));
    for (let i = 0; i < n; i++) {
      const w = R(0.6, Math.min(2.2, d.L * 0.5)), hgt = R(0.5, 1.6);
      const cu = R(w / 2 + 0.1, d.L - w / 2 - 0.1), cv = R(0.3 + hgt / 2, Math.max(0.4 + hgt / 2, top - hgt / 2 - 0.1));
      if (clearU(cv - hgt / 2, cv + hgt / 2).some(([a, b]) => cu + w / 2 > a && cu - w / 2 < b)) continue;
      renderPatch(acc, d.f, cu, cv, w / 2, hgt / 2, r);
    }
  }
  // A timber upper storey: a frame of posts, rails and braces filled with
  // wattle and daub (plaster), or boards with battens over the joints (wood).
  if (!d.oneMass && d.h - d.lowTop > 1.2 && (d.upper === 'plaster' || d.upper === 'wood')) {
    const y0 = d.lowTop + 0.02, y1 = d.h - 0.05, w = d.upFace + 0.035;
    const holesUp = d.holes.filter((o) => o.v1 > y0 + 0.2);
    const blocked = (u: number) => holesUp.some((o) => u > o.u0 - 0.12 && u < o.u1 + 0.12);
    if (d.upper === 'plaster') {
      box(acc, 'wood', d.f, d.L / 2, y0 + 0.08, w, d.L / 2, 0.09, 0.05, 0.01); // sole plate
      box(acc, 'wood', d.f, d.L / 2, y1 - 0.08, w, d.L / 2, 0.08, 0.05, 0.01); // head plate
      const posts: number[] = [];
      for (let u = 0.08; u <= d.L - 0.05; u += R(0.9, 1.3)) { let uu = u; while (blocked(uu) && uu < d.L - 0.1) uu += 0.1; if (uu < d.L - 0.05 && (!posts.length || uu - posts[posts.length - 1] > 0.5)) posts.push(uu); }
      if (!posts.length || d.L - 0.08 - posts[posts.length - 1] > 0.4) posts.push(d.L - 0.08);
      for (const u of posts) box(acc, 'wood', d.f, u, (y0 + y1) / 2, w, 0.07, (y1 - y0) / 2 - 0.1, 0.05, 0.015);
      // A mid rail between posts (cut by windows) and a brace in some bays.
      const ym = y0 + (y1 - y0) * R(0.42, 0.55);
      for (const [a, b] of runs(ym - 0.08, ym + 0.08, 0.1, d.L - 0.1)) box(acc, 'wood', d.f, (a + b) / 2, ym, w - 0.005, (b - a) / 2, 0.065, 0.045, 0.012);
      for (let i = 0; i + 1 < posts.length; i++) {
        const a = posts[i] + 0.06, b = posts[i + 1] - 0.06;
        if (b - a < 0.5 || r() < 0.45 || holesUp.some((o) => o.u1 > a - 0.1 && o.u0 < b + 0.1)) continue;
        const up = r() < 0.5;
        const p0 = d.f.p(up ? a : b, y0 + 0.15, w - 0.04), p1 = d.f.p(up ? b : a, ym - 0.06, w - 0.04);
        const t = new THREE.Vector3(0, 0.12, 0), o = d.f.z.clone().multiplyScalar(0.08);
        acc.hexa('wood', [p0, p1, p1.clone().add(o), p0.clone().add(o), p0.clone().add(t), p1.clone().add(t), p1.clone().add(t).add(o), p0.clone().add(t).add(o)], true);
      }
    } else {
      for (let u = R(0.15, 0.3); u < d.L - 0.1; u += R(0.24, 0.32)) {
        if (blocked(u)) continue;
        box(acc, 'wood', d.f, u, (y0 + y1) / 2 + R(-0.05, 0.05), d.upFace + 0.015, 0.035, (y1 - y0) / 2 - 0.05 + R(-0.06, 0.02), 0.018, 0.006);
      }
    }
  }
  // Joist heads where the upper floor rests (no jetty: they stop at the face).
  if (!d.oneMass || d.h > 4.5) {
    const v = (d.oneMass ? Math.min(3.2, d.h * 0.48) : d.lowTop) + 0.12;
    if (v < d.h - 0.6 && r() < 0.6) for (const [a, b] of runs(v - 0.1, v + 0.1, 0.25, d.L - 0.25)) {
      for (let u = a + R(0, 0.2); u < b; u += R(0.5, 0.7)) box(acc, 'wood', d.f, u, v, 0.0, 0.06, 0.07, 0.05, 0.01);
    }
  }
}

/** A ragged patch of render on a wall: front face fanned from its centre, a thin rim. */
function renderPatch(acc: Acc, f: Frame, cu: number, cv: number, ru: number, rv: number, r: () => number) {
  const n = 14, w0 = -0.01, w1 = 0.022;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Rounded-rectangle outline, bitten in places where the lime fell away.
    const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)) * 1.0) ** 0.35;
    const k = (0.75 + 0.25 * r()) * (r() < 0.2 ? 0.7 : 1) * Math.min(1.25, sq);
    pts.push([cu + Math.cos(a) * ru * k, cv + Math.sin(a) * rv * k]);
  }
  const c = f.p(cu, cv, w1), inside = f.p(cu, cv, -1);
  for (let i = 0; i < n; i++) {
    const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % n];
    acc.tri('plaster', c, f.p(u0, v0, w1 + (r() - 0.5) * 0.006), f.p(u1, v1, w1), inside);
    acc.quad('plaster', f.p(u0, v0, w0), f.p(u1, v1, w0), f.p(u1, v1, w1), f.p(u0, v0, w1), f.p(cu, cv, w0 - 0.5));
  }
}

/** Washing on a pole pushed out of an upper window, or on a line across the lane. */
export function washing(acc: Acc, f: Frame, u: number, v: number, wFace: number, street: number, r: () => number) {
  const R = (a: number, b: number) => a + (b - a) * r();
  const reach = Math.min(street - 0.3, R(1.4, 2.4));
  if (reach < 0.9) return;
  const across = street < 3.2 && r() < 0.6;
  const y0 = v, y1 = across ? v + R(-0.3, 0.3) : v + R(0.1, 0.35);
  const p0 = f.p(u, y0, wFace), p1 = f.p(u + R(-0.4, 0.4), y1, wFace + (across ? street - 0.05 : reach));
  // Pole (or a rope: thinner).
  const th = across ? 0.012 : 0.03;
  const a = v3(0, th, 0), dir = p1.clone().sub(p0), sd = v3(-dir.z, 0, dir.x).normalize().multiplyScalar(th);
  acc.hexa('wood', [p0, p1, p1.clone().add(sd), p0.clone().add(sd), p0.clone().add(a), p1.clone().add(a), p1.clone().add(a).add(sd), p0.clone().add(a).add(sd)], true);
  // Cloths hung over it: a sheet, a tunic, rags, sagging with the line.
  const n = 1 + Math.floor(R(1, across ? 4 : 3));
  for (let i = 0; i < n; i++) {
    const t = R(0.15, 0.9), q = p0.clone().lerp(p1, t);
    if (across) q.y -= Math.sin(Math.PI * t) * 0.18;
    const wc = R(0.28, 0.55), hc = R(0.3, 0.65);
    // Bleached linen or unbleached (materials every chunk already draws: no extra draw call).
    const cm: MatName = r() < 0.6 ? 'marble' : 'plaster';
    const along = dir.clone().setY(0).normalize();
    const side = v3(-along.z, 0, along.x);
    // The cloth hangs folded over the pole: two sheets in a shallow V with a ragged hem.
    const hang = (s: number) => {
      const top0 = q.clone().addScaledVector(along, -wc / 2), top1 = q.clone().addScaledVector(along, wc / 2);
      const bot0 = top0.clone().addScaledVector(side, s * 0.06).add(v3(0, -hc * R(0.85, 1.05), 0));
      const bot1 = top1.clone().addScaledVector(side, s * 0.06).add(v3(0, -hc * R(0.85, 1.05), 0));
      const mid0 = top0.clone().lerp(bot0, 0.5).addScaledVector(side, s * 0.03), mid1 = top1.clone().lerp(bot1, 0.5).addScaledVector(side, s * 0.03);
      const ctr = q.clone().addScaledVector(side, -s * 1);
      acc.quad(cm, top0, top1, mid1, mid0, ctr);
      acc.quad(cm, mid0, mid1, bot1, bot0, ctr);
    };
    hang(1); hang(-1);
  }
}

/** Standards of a scaffold along a front item (u positions). */
function scaffoldPoles(it: FrontItem) {
  const n = Math.max(2, Math.round(it.len / 1.6) + 1), out: number[] = [];
  for (let i = 0; i < n; i++) out.push(it.u + (it.len * i) / (n - 1));
  return out;
}

/** A rough pole (square section, slightly twisted) from p to q. */
function pole(acc: Acc, p: THREE.Vector3, q: THREE.Vector3, rad: number) {
  const d = q.clone().sub(p).normalize();
  const a = Math.abs(d.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const s1 = v3().crossVectors(d, a).normalize().multiplyScalar(rad), s2 = v3().crossVectors(d, s1).normalize().multiplyScalar(rad);
  const c = (o: THREE.Vector3, i: number) => o.clone().addScaledVector(s1, i === 0 || i === 3 ? -1 : 1).addScaledVector(s2, i < 2 ? -1 : 1);
  acc.hexa('wood', [c(p, 0), c(p, 1), c(p, 2), c(p, 3), c(q, 0), c(q, 1), c(q, 2), c(q, 3)], true);
}

/** The wall k of a footprint as a front line (out = away from the footprint's middle). */
export function sideLine(c: (V2 | [number, number])[], k: number): FrontLine {
  const P = c.map((p) => (Array.isArray(p) ? new THREE.Vector2(p[0], p[1]) : p));
  let cx = 0, cz = 0;
  for (const p of P) { cx += p.x / P.length; cz += p.y / P.length; }
  const a = P[k].clone(), b = P[(k + 1) % P.length].clone();
  const e = b.clone().sub(a).normalize();
  let out = new THREE.Vector2(-e.y, e.x);
  if (out.x * ((a.x + b.x) / 2 - cx) + out.y * ((a.y + b.y) / 2 - cz) < 0) out = out.negate();
  return { a, b, out };
}

/**
 * A wall on a lane that is not the house's front (a side or back wall the plan
 * puts on a street): small windows with shutters, now and then a side door
 * (flush on the wall: the wall itself is not cut), a pentice, the wall's
 * dressing, and the same street things as a front. All on its own stream.
 */
export function sideFace(acc: Acc, fr: FrontLine, street: number, h: number, h1: number, m: MatName, seed: number, lamps: (p: THREE.Vector3) => void) {
  const r = rng(seed * 19 + 7);
  const R = (a: number, b: number) => a + (b - a) * r();
  const L = fr.a.distanceTo(fr.b);
  const e = fr.b.clone().sub(fr.a).normalize();
  // (A finger's breadth out: the wall under it is a bent grid, not a plane.)
  const f = Frame.facade(fr.a.x + fr.out.x * 0.025, fr.a.y + fr.out.y * 0.025, e.x, e.y, fr.out.x, fr.out.y);
  const holes: { u0: number; u1: number; v0: number; v1: number }[] = [];
  const plan = planFront(fr, street, h, seed, true);
  const taken = plan.items.map((it) => [it.u - 0.2, it.u + it.len + 0.2] as [number, number]);
  const clear = (u0: number, u1: number, v0: number) => holes.every((o) => u1 < o.u0 - 0.5 || u0 > o.u1 + 0.5 || v0 > o.v1 + 0.6 || v0 < o.v0 - 2) && u0 > 0.35 && u1 < L - 0.35;
  const stone: MatName = m === 'brick' ? 'brick' : 'block';
  // A side door at street level.
  if (L > 3.2 && r() < 0.4) {
    const dw = R(0.85, 1.05), u0 = R(0.5, L - 0.5 - dw), top = R(1.8, 2.05);
    if (taken.every(([a, b]) => u0 + dw < a || u0 > b)) {
      holes.push({ u0, u1: u0 + dw, v0: 0, v1: top });
      const c = u0 + dw / 2;
      box(acc, 'iron', f, c, top / 2, 0.004, dw / 2, top / 2, 0.006, 0, true);
      // Planks (one leaf with its joints as shallow battens), frame, lintel, threshold.
      box(acc, 'wood', f, c, top / 2 - 0.02, 0.02, dw / 2 - 0.05, top / 2 - 0.03, 0.02, 0, true);
      for (let u = u0 + 0.16; u < u0 + dw - 0.1; u += R(0.15, 0.2)) box(acc, 'wood', f, u, top / 2, 0.042, 0.008, top / 2 - 0.06, 0.006, 0, true);
      for (const t of [0.22, 0.78]) box(acc, 'iron', f, c - 0.05, top * t, 0.05, dw * 0.38, 0.022, 0.006, 0, true);
      for (const s of [-1, 1]) box(acc, 'wood', f, c + s * (dw / 2 - 0.02), top / 2, 0.035, 0.05, top / 2, 0.04, 0.005);
      box(acc, r() < 0.5 ? 'wood' : stone, f, c, top + 0.1, 0.05, dw / 2 + R(0.18, 0.3), 0.1, 0.07, 0.01);
      box(acc, 'slab', f, c, -0.04, 0.12, dw / 2 + 0.08, 0.06, 0.16, 0.01);
      if (street > 1.8 && r() < 0.45) {
        // A pentice of boards on two brackets over it.
        const run = Math.min(0.75, street * 0.35), y = top + 0.45;
        const q = (u: number, v: number, w: number) => f.p(u, v, w);
        acc.hexa('wood', [q(u0 - 0.35, y, 0.02), q(u0 + dw + 0.35, y, 0.02), q(u0 + dw + 0.35, y - 0.28, run), q(u0 - 0.35, y - 0.28, run),
          q(u0 - 0.35, y + 0.05, 0.02), q(u0 + dw + 0.35, y + 0.05, 0.02), q(u0 + dw + 0.35, y - 0.23, run), q(u0 - 0.35, y - 0.23, run)], true);
        for (const s of [-1, 1]) {
          const u = c + s * (dw / 2 + 0.2);
          acc.hexa('wood', [q(u - 0.03, y - 0.65, 0), q(u + 0.03, y - 0.65, 0), q(u + 0.03, y - 0.3, run - 0.1), q(u - 0.03, y - 0.3, run - 0.1),
            q(u - 0.03, y - 0.58, 0), q(u + 0.03, y - 0.58, 0), q(u + 0.03, y - 0.23, run - 0.1), q(u - 0.03, y - 0.23, run - 0.1)], true);
        }
      }
    }
  }
  // Windows: small and high on the ground floor, larger above; shutters open or shut, some lit.
  const rows: [number, number, number][] = [[R(1.45, 1.75), 0.3, 0.45]];
  for (let y = h1 + R(0.8, 1.1); y < h - 1.0; y += R(2.4, 2.9)) rows.push([y, 0.5, 0.75]);
  for (const [v0, wMin, hMax] of rows) {
    const n = Math.max(1, Math.round(L / R(2.2, 3.2)));
    for (let i = 0; i < n; i++) {
      if (r() < 0.25) continue;
      const ww = R(wMin, wMin + 0.2), wh = R(hMax * 0.75, hMax);
      const u0 = (L * (i + 0.5)) / n - ww / 2 + R(-0.4, 0.4);
      if (!clear(u0, u0 + ww, v0)) continue;
      if (v0 < 2 && taken.some(([a, b]) => u0 + ww > a && u0 < b)) continue;
      holes.push({ u0, u1: u0 + ww, v0, v1: v0 + wh });
      const c = u0 + ww / 2, lit = r() < 0.28;
      box(acc, lit ? 'window' : 'iron', f, c, v0 + wh / 2, 0.004, ww / 2, wh / 2, 0.008, 0, true);
      box(acc, r() < 0.6 ? 'wood' : stone, f, c, v0 + wh + 0.07, 0.03, ww / 2 + R(0.1, 0.2), 0.07, 0.05, 0.008);
      box(acc, stone, f, c, v0 - 0.05, 0.05, ww / 2 + 0.07, 0.045, 0.07, 0.008);
      const s = r();
      if (s < 0.4) {
        // Shut: two leaves over the opening.
        for (const sd of [-1, 1]) box(acc, 'wood', f, c + sd * ww / 4, v0 + wh / 2, 0.035, ww / 4 - 0.008, wh / 2 + 0.02, 0.018, 0.004, true);
      } else if (s < 0.8) {
        // Open: the leaves folded back flat against the wall.
        for (const sd of [-1, 1]) box(acc, 'wood', f, c + sd * (ww / 2 + ww / 4 + 0.03), v0 + wh / 2, 0.025, ww / 4, wh / 2 + 0.02, 0.016, 0.004, true);
      } else {
        // A wooden grille.
        for (let u = u0 + 0.08; u < u0 + ww - 0.05; u += 0.11) box(acc, 'wood', f, u, v0 + wh / 2, 0.02, 0.015, wh / 2, 0.015, 0, true);
      }
      if (lit && r() < 0.25) lamps(f.p(c, v0 + 0.3, 0.6));
    }
  }
  // Putlog holes in rows, the wall's dressing.
  for (let v = 1.4 + R(-0.2, 0.2); v < h - 0.6; v += R(1.3, 1.8)) for (let u = R(0.4, 1.2); u < L - 0.4; u += R(1.2, 2.2)) {
    if (r() < 0.5 || !clear(u - 0.1, u + 0.1, v)) continue;
    box(acc, 'iron', f, u, v, 0.004, 0.06, 0.06, 0.006, 0, true);
  }
  dressWall(acc, { f, L, lower: m, upper: m, lowTop: h1, h, upFace: 0, oneMass: true, holes }, seed + 3);
  // Washing out of an upper window over a narrow lane.
  const up = holes.filter((o) => o.v0 > 2.5);
  if (up.length && r() < (street < 3.2 ? 0.35 : 0.2)) { const o = up[Math.floor(r() * up.length)]; washing(acc, f, (o.u0 + o.u1) / 2, o.v0 + 0.05, 0.02, street, r); }
  buildFront(acc, fr, plan, stone, seed);
}
