import * as THREE from 'three';
import type { Builder } from './builder';
import { rng } from './builder';
import type { MatName } from './materials';
import { Acc, Frame, box as kbox, voussoirs } from './arch/kit';
import { tiledGable, tiledLeanTo } from './arch/roof';

// Reusable architectural pieces. Everything takes a Builder and world coordinates.
let rand = rng(4242);
/** Restart this module's random sequence. */
export function reseedShapes(seed: number) { rand = rng(seed); }
const R = (a: number, b: number) => a + (b - a) * rand();

/** A wall of length L along local x with n round-arched openings, extruded `depth` along z. */
export function arcadeGeo(L: number, h: number, depth: number, n: number, openW: number, spring: number) {
  const s = new THREE.Shape();
  s.moveTo(-L / 2, 0);
  const bay = L / n;
  for (let i = 0; i < n; i++) {
    const cx = -L / 2 + bay * (i + 0.5);
    s.lineTo(cx - openW / 2, 0);
    s.lineTo(cx - openW / 2, spring);
    s.absarc(cx, spring, openW / 2, Math.PI, 0, true);
    s.lineTo(cx + openW / 2, 0);
  }
  s.lineTo(L / 2, 0); s.lineTo(L / 2, h); s.lineTo(-L / 2, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  return g;
}
export function arcade(b: Builder, m: MatName, L: number, h: number, depth: number, n: number, openW: number, spring: number, x: number, y: number, z: number, ry: number) {
  b.geo(m, arcadeGeo(L, h, depth, n, openW, spring), x, y, z, ry);
}

/** Wall with a broken, jagged top: ruins and roofless shells. */
let lastTops: { tops: number[]; n: number; L: number } | null = null;
/** Solid wall block with a jagged top as indexed grids (cheap to bend). */
function jaggedWall(L: number, h: number, depth: number, jag: number) {
  const step = 0.8;
  const n = Math.max(3, Math.round(L / step));
  const tops: number[] = [];
  let y = h * R(1 - jag, 1);
  for (let i = 0; i <= n; i++) {
    y = THREE.MathUtils.clamp(y + R(-0.9, 0.9) * h * 0.15, h * (1 - jag), h);
    tops.push(y);
  }
  const nv = Math.max(1, Math.ceil(h / step));
  const pos: number[] = [], idx: number[] = [];
  const quadGrid = (pt: (i: number, j: number) => [number, number, number], ni: number, nj: number, flip: boolean) => {
    const base = pos.length / 3;
    for (let j = 0; j <= nj; j++) for (let i = 0; i <= ni; i++) pos.push(...pt(i, j));
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const a = base + j * (ni + 1) + i, b = a + 1, c = a + ni + 1, d = c + 1;
      if (flip) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c);
    }
  };
  const X = (i: number) => -L / 2 + (i / n) * L;
  lastTops = { tops, n, L };
  for (const [zz, flip] of [[depth / 2, false], [-depth / 2, true]] as const) {
    quadGrid((i, j) => [X(i), (tops[i] * j) / nv, zz], n, nv, flip);
  }
  // Broken top, then the two ends.
  quadGrid((i, j) => [X(i), tops[i], depth / 2 - depth * j], n, 1, false);
  quadGrid((i, j) => [-L / 2, (tops[0] * j) / nv, -depth / 2 + depth * i], 1, nv, false);
  quadGrid((i, j) => [L / 2, (tops[n] * j) / nv, -depth / 2 + depth * i], 1, nv, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}

export function ruinGeo(L: number, h: number, depth: number, jag = 0.5, openW = 0, spring = 0) {
  if (openW <= 0) return jaggedWall(L, h, depth, jag);
  const s = new THREE.Shape();
  s.moveTo(-L / 2, 0);
  if (openW > 0) {
    s.lineTo(-openW / 2, 0); s.lineTo(-openW / 2, spring);
    s.absarc(0, spring, openW / 2, Math.PI, 0, true);
    s.lineTo(openW / 2, 0);
  }
  s.lineTo(L / 2, 0);
  const n = Math.max(3, Math.round(L / 0.8));
  let y = h * R(1 - jag, 1);
  for (let i = 0; i <= n; i++) {
    const x = L / 2 - (i / n) * L;
    y = THREE.MathUtils.clamp(y + R(-0.9, 0.9) * h * 0.15, h * (1 - jag), h);
    if (openW > 0 && Math.abs(x) < openW / 2 + 0.4) y = Math.max(y, spring + openW / 2 + 0.6);
    s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}
export function ruin(b: Builder, m: MatName, L: number, h: number, depth: number, x: number, y: number, z: number, ry: number, jag = 0.5, openW = 0, spring = 0) {
  const proxy = openW <= 0 ? new THREE.BoxGeometry(L, h * (1 - jag / 2), depth).translate(0, (h * (1 - jag / 2)) / 2, 0) : undefined;
  if (b.mode === 'collide' && proxy) { b.geo(m, proxy, x, y, z, ry, true, 0, 0, true); return; }
  lastTops = null;
  b.geo(m, ruinGeo(L, h, depth, jag, openW, spring), x, y, z, ry, true, 0, 0, openW <= 0, proxy);
  if (!lastTops || jag < 0.05) return;
  // The broken top is not a clean line: loose blocks sit on it, some half
  // fallen, and the fallen ones lie at the foot of the wall.
  const { tops, n } = lastTops;
  const c = Math.cos(ry), s = Math.sin(ry);
  const acc = new Acc();
  const blockM: MatName = m === 'brick' ? (rand() < 0.5 ? 'brick' : 'rubble') : m;
  for (let i = 0; i <= n; i++) {
    if (rand() > 0.55) continue;
    const lx = -L / 2 + (i / n) * L + R(-0.2, 0.2), lz = R(-depth / 2 + 0.2, depth / 2 - 0.2);
    const f = new Frame(new THREE.Vector3(x + lx * c + lz * s, y + tops[i] - 0.06, z - lx * s + lz * c),
      new THREE.Vector3(Math.cos(ry + R(-0.4, 0.4)), R(-0.12, 0.12), -Math.sin(ry + R(-0.4, 0.4))).normalize(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)));
    kbox(acc, blockM, f, 0, R(0.08, 0.16), 0, R(0.16, 0.32), R(0.08, 0.15), R(0.12, 0.25), 0.04);
  }
  for (let i = 0; i < L / 1.6; i++) {
    if (rand() > 0.6) continue;
    const lx = R(-L / 2, L / 2), lz = (rand() < 0.5 ? -1 : 1) * (depth / 2 + R(0.2, 1.4));
    const f = new Frame(new THREE.Vector3(x + lx * c + lz * s, y > 1 ? 0 : y, z - lx * s + lz * c),
      new THREE.Vector3(Math.cos(R(0, 6)), 0, Math.sin(R(0, 6))), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    kbox(acc, blockM, f, 0, 0.08, 0, R(0.15, 0.35), R(0.08, 0.16), R(0.12, 0.28), 0.05);
  }
  acc.flush(b);
}

/** Roman column, often reused (spolia): plinth, base torus, tapering shaft, impost capital. */
export function column(b: Builder, x: number, y: number, z: number, h: number, r: number, broken = 0, m: MatName = 'marble') {
  b.box(m, r * 2.8, 0.22, r * 2.8, x, y, z);
  b.geo(m, new THREE.CylinderGeometry(r * 1.3, r * 1.4, 0.22, 18), x, y + 0.33, z, 0, false);
  const shaft = broken > 0 ? h * broken : h - 0.95;
  b.geo(m, new THREE.CylinderGeometry(r * 0.86, r, shaft, 16, Math.max(1, Math.round(shaft / 0.6))), x, y + 0.44 + shaft / 2, z, 0, true, 0, 0, false, new THREE.CylinderGeometry(r, r, shaft, 6, 1, true));
  if (broken > 0) {
    // A jagged break: a short tilted stub on top.
    b.geo(m, new THREE.CylinderGeometry(r * 0.6, r * 0.86, 0.25, 9), x + 0.05, y + 0.44 + shaft + 0.08, z, R(0, 3), true, R(-0.3, 0.3), R(-0.3, 0.3));
    return;
  }
  b.geo(m, new THREE.CylinderGeometry(r * 1.05, r * 0.88, 0.12, 16), x, y + 0.44 + shaft + 0.06, z, 0, false);
  b.geo(m, new THREE.CylinderGeometry(r * 1.75, r * 0.95, 0.4, 4), x, y + 0.44 + shaft + 0.32, z, Math.PI / 4, false);
}

export function fallenDrum(b: Builder, x: number, z: number, r: number, len: number, ry: number) {
  b.geo('marble', new THREE.CylinderGeometry(r, r * 0.95, len, 16, 2), x, r * 0.92, z, ry, true, 0, Math.PI / 2);
}

/** Low-pitched gable roof of coppi over a w × d footprint (ridge along local x). */
export function gable(b: Builder, w: number, d: number, hr: number, x: number, y: number, z: number, ry: number, wallMat: MatName, over = 0.5) {
  const acc = new Acc();
  tiledGable(b, acc, w, d, hr, x, y, z, ry, Math.max(0.25, over), { gableMat: wallMat });
  acc.flush(b);
}

/** Single-slope tiled roof (aisles, porticoes, cloister walks). Falls towards local +z. */
export function leanTo(b: Builder, len: number, run: number, hHigh: number, hLow: number, x: number, z: number, ry: number) {
  const acc = new Acc();
  tiledLeanTo(acc, len, run, hHigh, hLow, x, z, ry);
  acc.flush(b);
}

export function pyramidRoof(b: Builder, w: number, h: number, x: number, y: number, z: number) {
  b.geo('roof', new THREE.ConeGeometry(w * 0.74, h, 4, 3), x, y + h / 2, z, Math.PI / 4, false);
}

/**
 * A thick-walled drum (well-head, basin, bowl): outer face, rounded rim and
 * inner face, as one lathe. `depth` extends the inner face below y = 0 (a shaft).
 */
export function ringGeo(rOut: number, rIn: number, h: number, depth = 0, seg = 28) {
  const t = rOut - rIn, r = t * 0.45;
  const pts: THREE.Vector2[] = [new THREE.Vector2(rIn, -depth), new THREE.Vector2(rIn, h - r)];
  for (let i = 1; i < 6; i++) {
    const a = Math.PI - (i / 6) * Math.PI;
    pts.push(new THREE.Vector2(rIn + t / 2 + Math.cos(a) * t / 2, h - r + Math.sin(a) * r));
  }
  pts.push(new THREE.Vector2(rOut, h - r), new THREE.Vector2(rOut * 1.03, 0));
  // Lathe faces point outward when the profile climbs, so run it outer-up, inner-down.
  return new THREE.LatheGeometry(pts.reverse(), seg);
}

/** Where wells pierce the ground (x, z, radius at the middle of the wall). */
export const WELLS: { x: number; z: number; rIn: number; rOut: number }[] = [];

/**
 * A well: a ring of masonry ~0.4 m thick around an open shaft that goes
 * 3 m down to black water, capped with a ring of irregular stones.
 * The ground must be pierced at (x, z) — see WELLS.
 */
export function wellHead(b: Builder, m: MatName, x: number, y: number, z: number, rOut: number, h: number, cap: MatName = 'stone') {
  const rIn = rOut - 0.4;
  if (b.mode === 'collide') { b.geo(m, new THREE.CylinderGeometry(rOut, rOut, h, 10, 1, true).translate(0, h / 2, 0), x, y, z, 0, true, 0, 0, true); return; }
  const shaft = 3.0;
  // Body: outer face, inner face continuing down the shaft (one closed lathe).
  // Outer face climbing, across the top, inner face descending the shaft:
  // the order that makes every face look out of the masonry.
  const prof: THREE.Vector2[] = [
    new THREE.Vector2(rOut * 1.04, -0.15), new THREE.Vector2(rOut, h - 0.12),
    new THREE.Vector2(rIn, h - 0.12), new THREE.Vector2(rIn, -shaft),
  ];
  b.geo(m, new THREE.LatheGeometry(prof, 32), x, y, z, 0, true, 0, 0, false,
    new THREE.CylinderGeometry(rOut, rOut, h, 10, 1, true).translate(0, h / 2, 0));
  // Shaft floor: black water.
  b.add(new THREE.CircleGeometry(rIn + 0.05, 24).rotateX(-Math.PI / 2), 'iron',
    new THREE.Matrix4().makeTranslation(x, y - shaft + 0.4, z), false, true);
  // Cap stones: big irregular blocks set round the top, each a little different.
  const n = Math.max(9, Math.round((Math.PI * 2 * (rIn + rOut) / 2) / 0.4));
  let a0 = R(0, 1);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const len = ((Math.PI * 2 * (rIn + rOut) / 2) / n) * R(0.86, 0.97);
    const rad = (rIn + rOut) / 2 + R(-0.02, 0.03);
    b.box(cap, len, R(0.1, 0.15), (rOut - rIn) + R(0.04, 0.1), x + Math.sin(a) * rad, y + h - 0.13, z + Math.cos(a) * rad,
      a + Math.PI / 2, false, R(-0.04, 0.04), R(-0.04, 0.04));
  }
  WELLS.push({ x, z, rIn, rOut });
}

/**
 * Voussoir rings on both faces of an arched opening made with arcadeGeo:
 * the opening (width openW, springing at `spring`) centred at (x, y, z),
 * wall `depth` thick, rotated ry like Builder.geo.
 */
export function archRings(b: Builder, m: MatName, x: number, y: number, z: number, ry: number, depth: number, openW: number, spring: number, ring = 0.4, blk = 0.22, offU = 0) {
  const acc = new Acc();
  const X = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry)), Z = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
  for (const sd of [-1, 1]) {
    const o = new THREE.Vector3(x, y, z).addScaledVector(Z, sd * depth / 2).addScaledVector(X, offU);
    const f = new Frame(o, sd > 0 ? X.clone() : X.clone().negate(), new THREE.Vector3(0, 1, 0), Z.clone().multiplyScalar(sd));
    voussoirs(acc, m, f, 0, spring, openW / 2, openW / 2 + ring, -0.12, 0.025, 0, Math.PI, blk);
    // Imposts where the arch springs.
    for (const side of [-1, 1]) kbox(acc, m === 'brick' ? 'stone' : m, f, side * (openW / 2 + 0.12), spring - 0.08, -0.05, 0.22, 0.08, 0.08, 0.01);
  }
  acc.flush(b);
}

/** Dressed quoins up the four corners of a box-shaped mass (w × d, rotated ry). */
export function quoinBox(b: Builder, m: MatName, w: number, h: number, d: number, x: number, y: number, z: number, ry: number) {
  const acc = new Acc();
  const X = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry)), Z = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const o = new THREE.Vector3(x, y, z).addScaledVector(X, sx * w / 2).addScaledVector(Z, sz * d / 2);
    const f = new Frame(o, X, new THREE.Vector3(0, 1, 0), Z);
    let v = 0;
    for (let k = 0; v < h - 0.2; k++) {
      const hgt = R(0.32, 0.46), la = k % 2 ? R(0.35, 0.5) : R(0.65, 0.9), lb = k % 2 ? R(0.65, 0.9) : R(0.35, 0.5);
      kbox(acc, m, f, -sx * (la / 2 - 0.03), v + hgt / 2, -sz * (lb / 2 - 0.03), la / 2, hgt / 2 - 0.008, lb / 2, 0.012);
      v += hgt;
    }
  }
  acc.flush(b);
}
