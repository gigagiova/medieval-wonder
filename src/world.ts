import * as THREE from 'three';
import { Builder, rng } from './builder';

export const WALL_R = 88;
const WALL_H = 10;
const SEGS = 16;
const rand = rng(1327);
const R = (a: number, b: number) => a + (b - a) * rand();

// Stair / catacomb constants. The stair descends towards -z from inside the
// ossuary chapel into a maze carved 7 m under the monastery.
const STAIR_X = -36, STAIR_W = 3, STAIR_TOP = -52, STAIR_RUN = 0.35, STAIR_RISE = 0.25, DEPTH = -7;
const STEPS = Math.round(-DEPTH / STAIR_RISE);
const STAIR_END = STAIR_TOP - STEPS * STAIR_RUN;
const HOLE_END = -56.2;
const CAT_X0 = -58, CAT_Z0 = -62, CELL = 4, COLS = 11, ROWS = 9;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildWorld(scene: THREE.Scene) {
  const b = new Builder();
  ground(b);
  townWall(b);
  monastery(b);
  catacombs(b);
  houses(b);
  outskirts(b);
  const collider = b.build(scene);
  return { collider, lamps: b.lamps, flames: b.flames };
}

function ground(b: Builder) {
  const s = new THREE.Shape();
  s.moveTo(-400, -400); s.lineTo(400, -400); s.lineTo(400, 400); s.lineTo(-400, 400); s.closePath();
  const hole = new THREE.Path();
  // Shape Y maps to world -Z after the rotation below.
  const x0 = STAIR_X - STAIR_W / 2, x1 = STAIR_X + STAIR_W / 2;
  hole.moveTo(x0, -STAIR_TOP); hole.lineTo(x1, -STAIR_TOP); hole.lineTo(x1, -HOLE_END); hole.lineTo(x0, -HOLE_END); hole.closePath();
  s.holes.push(hole);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  b.add(g, 'ground');
}

function torch(b: Builder, x: number, y: number, z: number, ry: number, under = false) {
  // Iron bracket sticking out of a wall, flame on top. ry points outward.
  const ox = Math.sin(ry), oz = Math.cos(ry);
  b.box('iron', 0.08, 0.5, 0.08, x + ox * 0.18, y - 0.45, z + oz * 0.18, ry, false, 0.5);
  b.box('wood', 0.12, 0.35, 0.12, x + ox * 0.3, y - 0.2, z + oz * 0.3, ry, false);
  b.lamp('torch', v(x + ox * 0.3, y + 0.15, z + oz * 0.3), under);
}

function lanternPost(b: Builder, x: number, z: number, ry = 0) {
  b.box('wood', 0.2, 3.3, 0.2, x, 0, z);
  const ox = Math.sin(ry) * 0.55, oz = Math.cos(ry) * 0.55;
  b.box('wood', 0.1, 0.1, 1.0, x + ox / 2, 3.1, z + oz / 2, ry, false);
  b.box('window', 0.32, 0.42, 0.32, x + ox, 2.55, z + oz, 0, false);
  b.geo('iron', new THREE.ConeGeometry(0.28, 0.25, 4), x + ox, 3.1, z + oz, Math.PI / 4, false);
  b.lamp('lantern', v(x + ox, 2.75, z + oz));
}

function hangingLantern(b: Builder, x: number, y: number, z: number) {
  b.box('iron', 0.03, 0.6, 0.03, x, y + 0.2, z, 0, false);
  b.box('window', 0.28, 0.36, 0.28, x, y - 0.18, z, 0, false);
  b.lamp('lantern', v(x, y, z));
}

function merlons(b: Builder, x: number, z: number, y: number, ry: number, len: number, mat: 'bigstone' | 'stone' = 'bigstone') {
  const n = Math.floor(len / 1.8);
  const dx = Math.sin(ry), dz = Math.cos(ry);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    b.box(mat, 0.7, 1.1, 0.95, x + dx * t * len, y, z + dz * t * len, ry);
  }
}

function townWall(b: Builder) {
  const T = 2.6;
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k < SEGS; k++) {
    const th = (k + 0.5) * (Math.PI * 2) / SEGS;
    pts.push(new THREE.Vector2(WALL_R * Math.sin(th), WALL_R * Math.cos(th)));
  }
  for (let k = 0; k < SEGS; k++) {
    const p1 = pts[k], p2 = pts[(k + 1) % SEGS];
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const d = p2.clone().sub(p1);
    const L = d.length();
    const ry = Math.atan2(d.x, d.y);
    const out = mid.clone().normalize();
    const mx = mid.x + out.x * (T / 2 - 0.35), mz = mid.y + out.y * (T / 2 - 0.35);
    if (k === SEGS - 1) {
      // South gate: split the curtain and flank it with two gatehouse towers.
      const gap = 5;
      const half = (L - gap) / 2;
      const dir = d.clone().normalize();
      for (const s of [-1, 1]) {
        const off = (gap / 2 + half / 2) * s;
        b.box('bigstone', T, WALL_H, half, mid.x + dir.x * off, -0.5, mid.y + dir.y * off, ry);
        merlons(b, mx + dir.x * off, mz + dir.y * off, WALL_H - 0.5, ry, half);
        const tx = mid.x + dir.x * 5.8 * s, tz = mid.y + dir.y * 5.8 * s;
        b.box('bigstone', 6.5, WALL_H + 5, 6.5, tx, -0.5, tz, ry);
        for (const [a, bb] of [[0, 3], [0, -3], [3, 0], [-3, 0]]) {
          const lx = Math.cos(ry) * a + Math.sin(ry) * bb, lz = -Math.sin(ry) * a + Math.cos(ry) * bb;
          merlons(b, tx + lx, tz + lz, WALL_H + 4.5, ry + (a !== 0 ? 0 : Math.PI / 2), 6.2);
        }
      }
      b.box('bigstone', T + 1, WALL_H - 6, gap + 1, mid.x, 6.5, mid.y, ry);
      // Torches either side of the gate, outside and inside.
      for (const s of [-1, 1]) for (const io of [1, -1]) {
        const off = 3.1 * s;
        const fx = mid.x + d.x / L * off + out.x * 3.3 * io;
        const fz = mid.y + d.y / L * off + out.y * 3.3 * io;
        torch(b, fx, 3.2, fz, Math.atan2(out.x * io, out.y * io));
      }
      continue;
    }
    b.box('bigstone', T, WALL_H, L + 1, mid.x, -0.5, mid.y, ry);
    merlons(b, mx, mz, WALL_H - 0.5, ry, L - 6);
  }
  for (let k = 0; k < SEGS; k++) {
    const p = pts[k];
    const th = 12 + (k % 3 === 0 ? 3 : 0);
    b.geo('bigstone', new THREE.CylinderGeometry(4.2, 4.6, th, 14), p.x, th / 2 - 0.5, p.y);
    if (k % 2 === 0) {
      b.geo('roof', new THREE.ConeGeometry(5.2, 6, 14), p.x, th - 0.5 + 3, p.y);
    } else {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        b.box('bigstone', 0.9, 1.1, 0.8, p.x + Math.sin(a) * 3.9, th - 0.5, p.y + Math.cos(a) * 3.9, a);
      }
    }
    if (k % 4 === 1) torch(b, p.x - p.x / WALL_R * 4.7, 4, p.y - p.y / WALL_R * 4.7, Math.atan2(-p.x, -p.y));
  }
}

function gable(b: Builder, w: number, d: number, hr: number, x: number, y: number, z: number, ry: number, wallMat: 'plaster' | 'stone', over = 0.5) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, hr); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  b.geo(wallMat, g, x, y, z, ry + Math.PI / 2);
  const a = Math.atan2(hr, d / 2);
  const run = d / 2 + over;
  const L = run / Math.cos(a) + 0.15;
  for (const s2 of [1, -1]) {
    const cz = (run / 2) * s2, cy = y + hr - Math.tan(a) * run / 2 + 0.12;
    const lx = Math.sin(ry) * cz, lz = Math.cos(ry) * cz;
    b.box('roof', w + over * 1.6, 0.2, L, x + lx, cy - 0.1, z + lz, ry, true, a * s2);
  }
}

function house(b: Builder, x: number, z: number, w: number, d: number, h: number, ry: number) {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const P = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  b.box('stone', w + 0.12, 0.9, d + 0.12, x, -0.2, z, ry);
  const jetty = h > 6.5;
  const h1 = jetty ? 3.3 : h;
  b.box('plaster', w, h1, d, x, 0, z, ry);
  let dd = d;
  if (jetty) {
    dd = d + 0.9;
    b.box('plaster', w, h - h1, dd, x, h1, z, ry);
    for (const s of [-1, 1]) {
      const [bx, bz] = P(0, s * (d / 2 + 0.2));
      b.box('wood', w + 0.1, 0.25, 0.45, bx, h1 - 0.25, bz, ry);
    }
  }
  gable(b, w, dd, dd * 0.55, x, h, z, ry, 'plaster');
  // Front door.
  const doorX = R(-w / 2 + 1, w / 2 - 1);
  const [dx, dz] = P(doorX, d / 2 + 0.04);
  b.box('wood', 1.1, 2.1, 0.12, dx, 0, dz, ry);
  if (rand() < 0.25) {
    const [tx, tz] = P(doorX + 1.0, d / 2 + 0.05);
    torch(b, tx, 2.6, tz, ry);
  }
  // Windows on all four faces, some glowing.
  const floors = jetty ? [1.5, h1 + 1.2] : h > 4.5 ? [1.5, 3.6] : [1.5];
  for (const face of [0, 1, 2, 3]) {
    const along = face % 2 === 0 ? w : d;
    const n = Math.max(1, Math.floor(along / 2.6));
    for (const fy of floors) for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const off = t * along;
      if (face === 0 && fy < 2.5 && Math.abs(off - doorX) < 1.2) continue;
      const depth = fy > h1 ? dd : d;
      let lx = 0, lz = 0, fr = 0;
      if (face === 0) { lx = off; lz = depth / 2 + 0.03; fr = 0; }
      if (face === 1) { lx = w / 2 + 0.03; lz = off * (d / along); fr = Math.PI / 2; }
      if (face === 2) { lx = off; lz = -depth / 2 - 0.03; fr = Math.PI; }
      if (face === 3) { lx = -w / 2 - 0.03; lz = off * (d / along); fr = -Math.PI / 2; }
      if (face % 2 === 1 && Math.abs(lz) > d / 2 - 0.6) continue;
      const [wx, wz] = P(lx, lz);
      if (rand() < 0.3) {
        b.box('window', 0.7, 0.95, 0.06, wx, fy, wz, ry + fr, false);
        if (rand() < 0.3) {
          const o = ry + fr;
          b.lamp('window', v(wx + Math.sin(o) * 0.7, fy + 0.5, wz + Math.cos(o) * 0.7));
        }
      } else {
        b.box('wood', 0.8, 1.0, 0.1, wx, fy - 0.05, wz, ry + fr, false);
      }
    }
  }
  if (rand() < 0.5) {
    const [cx, cz] = P(R(-w / 3, w / 3), R(-0.5, 0.5));
    b.box('stone', 0.8, dd * 0.55 + 1.6, 0.8, cx, h, cz, ry);
  }
}

interface Rect { x0: number; x1: number; z0: number; z1: number }
const overlaps = (a: Rect, c: Rect) => a.x0 < c.x1 && a.x1 > c.x0 && a.z0 < c.z1 && a.z1 > c.z0;

function houses(b: Builder) {
  const keepOut: Rect[] = [
    { x0: -48, x1: 50, z0: -68, z1: -5 }, // monastery
    { x0: -4.5, x1: 4.5, z0: -10, z1: 100 }, // main street
    { x0: -100, x1: 100, z0: 26, z1: 34 }, // cross street
  ];
  const placed: Rect[] = [];
  const tryPlace = (x: number, z: number, w: number, d: number, ry: number) => {
    const swap = Math.abs(Math.sin(ry)) > 0.5;
    const ex = (swap ? d : w) / 2 + 0.6, ez = (swap ? w : d) / 2 + 0.6;
    const r: Rect = { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez };
    for (const [cx, cz] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) if (Math.hypot(cx, cz) > WALL_R - 9) return false;
    if (keepOut.some((k) => overlaps(k, r)) || placed.some((p) => overlaps(p, r))) return false;
    placed.push(r);
    house(b, x, z, w, d, R(4, 8.5), ry + R(-0.04, 0.04));
    return true;
  };
  // Rows along the main street, facing it.
  for (const side of [-1, 1]) {
    let z = -2;
    while (z < 80) {
      const w = R(5, 8), d = R(5, 7);
      tryPlace(side * (5.4 + d / 2), z + w / 2, w, d, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      z += w + R(0.4, 2.5);
    }
  }
  // Rows along the cross street.
  for (const side of [-1, 1]) {
    let x = -84;
    while (x < 84) {
      const w = R(5, 8), d = R(5, 7);
      tryPlace(x + w / 2, 30 + side * (5.4 + d / 2), w, d, side > 0 ? Math.PI : 0);
      x += w + R(0.4, 2.5);
    }
  }
  // Fill the rest of the town with crooked blocks.
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * (WALL_R - 10);
    const rot = Math.floor(rand() * 4) * (Math.PI / 2);
    tryPlace(Math.sin(a) * r, Math.cos(a) * r, R(5, 9), R(5, 7.5), rot);
  }
  // Street lanterns.
  for (let z = 0, i = 0; z < 84; z += 13, i++) {
    const s = i % 2 ? 1 : -1;
    lanternPost(b, s * 4.2, z, s > 0 ? -Math.PI / 2 : Math.PI / 2);
  }
  for (let x = -76, i = 0; x < 80; x += 15, i++) {
    if (Math.abs(x) < 6) continue;
    const s = i % 2 ? 1 : -1;
    lanternPost(b, x, 30 + s * 4.2, s > 0 ? Math.PI : 0);
  }
  // A well at the crossroads.
  well(b, 9, 37);
}

function well(b: Builder, x: number, z: number) {
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box('stone', 0.5, 0.9, 0.45, x + Math.sin(a) * 1.1, 0, z + Math.cos(a) * 1.1, a);
  }
  for (const s of [-1, 1]) b.box('wood', 0.18, 2.6, 0.18, x + s * 1.1, 0, z);
  b.box('wood', 2.6, 0.15, 0.15, x, 2.5, z, 0, false);
  gable(b, 1.4, 1.8, 0.8, x, 2.6, z, Math.PI / 2, 'stone', 0.3);
}

function monastery(b: Builder) {
  // Enclosure wall with a gate on the main street.
  const W = { x0: -46, x1: 48, z0: -66, z1: -8 };
  const wallSeg = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    b.box('stone', 1, 4, L + 1, (x0 + x1) / 2, 0, (z0 + z1) / 2, ry);
    b.box('roof', 1.5, 0.3, L + 1.2, (x0 + x1) / 2, 4, (z0 + z1) / 2, ry);
  };
  wallSeg(W.x0, W.z0, W.x1, W.z0);
  wallSeg(W.x0, W.z0, W.x0, W.z1);
  wallSeg(W.x1, W.z0, W.x1, W.z1);
  wallSeg(W.x0, W.z1, -3, W.z1);
  wallSeg(3, W.z1, W.x1, W.z1);
  for (const s of [-1, 1]) {
    b.box('stone', 1.6, 5.5, 1.6, s * 3.6, 0, W.z1);
    torch(b, s * 3.6, 3.6, W.z1 + 0.85, 0);
  }
  b.box('stone', 8.8, 1.2, 1.4, 0, 5.5, W.z1);

  church(b);
  cloister(b);
  aedificium(b, 34, -24);
  chapel(b);
  // Cemetery north of the church.
  for (let i = 0; i < 34; i++) {
    const x = R(-6, 18), z = R(-63, -55);
    const ry = R(-0.2, 0.2), tilt = R(-0.15, 0.15);
    if (rand() < 0.5) {
      b.box('stone', 0.16, 1.2, 0.14, x, -0.1, z, ry, true, 0, tilt);
      b.box('stone', 0.7, 0.14, 0.14, x, 0.75, z, ry, false, 0, tilt);
    } else {
      b.box('stone', 0.6, 0.9, 0.15, x, -0.1, z, ry, true, tilt);
    }
  }
  // Path lanterns inside the precinct.
  lanternPost(b, 4.5, -18, -Math.PI / 2);
  lanternPost(b, 4.5, -32, -Math.PI / 2);
  lanternPost(b, -30, -44, 0);
  lanternPost(b, 20, -14, Math.PI);
}

function church(b: Builder) {
  const x0 = -16, x1 = 16, z0 = -51, z1 = -39, H = 11, T = 1;
  const L = x1 - x0, cz = (z0 + z1) / 2;
  // North wall.
  b.box('stone', L, H, T, 0, 0, z0 + T / 2);
  // South wall with a portal at x=0.
  b.box('stone', (L - 3) / 2, H, T, x0 + (L - 3) / 4, 0, z1 - T / 2);
  b.box('stone', (L - 3) / 2, H, T, x1 - (L - 3) / 4, 0, z1 - T / 2);
  b.box('stone', 3, H - 4.2, T, 0, 4.2, z1 - T / 2);
  // West facade with a door.
  b.box('stone', T, H, (z1 - z0 - 2.4) / 2, x0, 0, z0 + (z1 - z0 - 2.4) / 4);
  b.box('stone', T, H, (z1 - z0 - 2.4) / 2, x0, 0, z1 - (z1 - z0 - 2.4) / 4);
  b.box('stone', T, H - 4, 2.4, x0, 4, cz);
  gable(b, T, z1 - z0, 5, x0, H, cz, 0, 'stone', 0);
  b.box('wood', 0.2, 4, 2.4, x0 - 0.9, 0, cz + 0.9, 0.9, false);
  // Buttresses and clerestory windows.
  for (let x = x0 + 4; x < x1; x += 4) {
    for (const s of [-1, 1]) {
      const zw = s < 0 ? z0 : z1;
      b.box('stone', 1.2, H - 2, 1.4, x, 0, zw + s * 0.9);
      if (x + 2 < x1) b.box('window', 0.9, 2.6, T + 0.1, x + 2, 6.5, zw - s * T / 2, 0, false);
    }
  }
  gable(b, L, z1 - z0, 5.5, 0, H, cz, 0, 'stone', 0.7);
  // Apse built from a ring of wall blocks, roofed with a half cone.
  const ar = (z1 - z0) / 2;
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    b.box('stone', 2.6, H - 1.5, T, x1 + Math.cos(a) * (ar - 0.5), 0, cz + Math.sin(a) * (ar - 0.5), Math.PI / 2 - a);
  }
  b.geo('roof', new THREE.ConeGeometry(ar + 0.6, 5, 16, 1, false, 0, Math.PI), x1, H - 1.5 + 2.5, cz);
  b.box('window', 0.8, 2.6, 0.3, x1 + ar - 0.4, 5, cz, Math.PI / 2, false);
  // Interior: slab floor, arcades of columns, altar and candles.
  b.box('slab', L + ar, 0.06, z1 - z0 - 2 * T, ar / 2, 0, cz, 0, false);
  for (let x = x0 + 4; x <= x1 - 4; x += 4) {
    for (const s of [-1, 1]) {
      b.geo('stone', new THREE.CylinderGeometry(0.45, 0.5, H - 1, 10), x, (H - 1) / 2, cz + s * 3.2);
      b.box('stone', 1.2, 0.5, 1.2, x, 0, cz + s * 3.2);
      b.box('stone', 4, 1, 0.8, x + 2 <= x1 - 4 ? x + 2 : x, H - 2, cz + s * 3.2, 0, false);
    }
  }
  b.box('stone', 1.4, 1.1, 3.2, x1 + 1.5, 0, cz);
  b.box('slab', 1.7, 0.1, 3.5, x1 + 1.5, 1.1, cz, 0, false);
  for (let i = 0; i < 5; i++) {
    const zz = cz - 1.2 + i * 0.6;
    b.geo('bone', new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6), x1 + 1.4, 1.38, zz, 0, false);
    b.lamp('candle', v(x1 + 1.4, 1.6, zz));
  }
  b.box('wood', 0.12, 2.6, 0.12, x1 + 1.5, 1.2, cz, 0, false);
  b.box('wood', 1.3, 0.12, 0.12, x1 + 1.5, 3.1, cz, Math.PI / 2, false);
  for (let x = x0 + 3; x < x1 - 3; x += 1.8) {
    for (const s of [-1, 1]) {
      b.box('wood', 0.4, 0.45, 1.8, x, 0, cz + s * 1.75, 0);
      b.box('wood', 0.08, 0.9, 1.8, x - 0.2, 0, cz + s * 1.75, 0);
    }
  }
  for (const x of [x0 + 6, x1 - 6]) for (const s of [-1, 1]) {
    // Candle stands between the aisles.
    b.box('iron', 0.08, 1.4, 0.08, x, 0, cz + s * 2.2, 0, false);
    for (let k = -1; k <= 1; k++) b.lamp('candle', v(x + k * 0.25, 1.6, cz + s * 2.2));
  }
  torch(b, x0 + 1, 3.5, cz - 4.5, Math.PI / 2);
  torch(b, x0 + 1, 3.5, cz + 4.5, Math.PI / 2);
  torch(b, 1.8, 3.4, z1 + 0.05, 0);
  torch(b, -1.8, 3.4, z1 + 0.05, 0);
  // Bell tower on the north-west corner.
  const bx = -13, bz = -54, bh = 25;
  b.box('stone', 6, bh, 6, bx, 0, bz);
  for (const [ox, oz, r] of [[3, 0, Math.PI / 2], [-3, 0, Math.PI / 2], [0, 3, 0], [0, -3, 0]]) {
    b.box('iron', 1.4, 3.2, 0.3, bx + ox * 1.02, bh - 5, bz + oz * 1.02, r, false);
  }
  b.geo('roof', new THREE.ConeGeometry(5, 8, 4), bx, bh + 4, bz, Math.PI / 4);
  b.geo('iron', new THREE.CylinderGeometry(0.06, 0.06, 2.2), bx, bh + 9, bz, 0, false);
  b.box('iron', 1.0, 0.08, 0.08, bx, bh + 9.3, bz, 0, false);
}

function cloister(b: Builder) {
  const x0 = -27, x1 = -5, z0 = -37, z1 = -15, H = 5.5, g = 3;
  // Outer walls with openings on the east side and towards the church.
  b.box('stone', x1 - x0, H, 0.8, (x0 + x1) / 2, 0, z1);
  b.box('stone', 0.8, H, z1 - z0, x0, 0, (z0 + z1) / 2);
  b.box('stone', (x1 - x0 - 2.5) / 2, H, 0.8, x0 + (x1 - x0 - 2.5) / 4, 0, z0);
  b.box('stone', (x1 - x0 - 2.5) / 2, H, 0.8, x1 - (x1 - x0 - 2.5) / 4, 0, z0);
  b.box('stone', 0.8, H, (z1 - z0 - 2.5) / 2, x1, 0, z0 + (z1 - z0 - 2.5) / 4);
  b.box('stone', 0.8, H, (z1 - z0 - 2.5) / 2, x1, 0, z1 - (z1 - z0 - 2.5) / 4);
  // Arcade: columns around the garth, lean-to roofs over the walks.
  const ix0 = x0 + g, ix1 = x1 - g, iz0 = z0 + g, iz1 = z1 - g;
  const col = (x: number, z: number) => {
    b.geo('stone', new THREE.CylinderGeometry(0.17, 0.2, 3.2, 8), x, 0.6 + 1.6, z);
    b.box('stone', 0.55, 0.35, 0.55, x, 3.8, z, 0, false);
  };
  for (let t = 0; t <= 1.0001; t += 1 / 8) {
    const x = ix0 + (ix1 - ix0) * t, z = iz0 + (iz1 - iz0) * t;
    for (const zz of [iz0, iz1]) col(x, zz);
    for (const xx of [ix0, ix1]) if (t > 0 && t < 1) col(xx, z);
  }
  const sideMid = [
    { x: (x0 + x1) / 2, z: (z1 + iz1) / 2, len: x1 - x0, ry: Math.PI / 2, s: 1 },
    { x: (x0 + x1) / 2, z: (z0 + iz0) / 2, len: x1 - x0, ry: Math.PI / 2, s: -1 },
  ];
  // Low parapet between the columns and the garth.
  b.box('stone', ix1 - ix0, 0.6, 0.45, (ix0 + ix1) / 2, 0, iz0);
  b.box('stone', ix1 - ix0, 0.6, 0.45, (ix0 + ix1) / 2, 0, iz1);
  b.box('stone', 0.45, 0.6, iz1 - iz0 - 2.4, ix0, 0, (iz0 + iz1) / 2 + 1.2);
  b.box('stone', 0.45, 0.6, (iz1 - iz0) / 2 - 1.4, ix1, 0, iz0 + (iz1 - iz0) / 4 - 0.7);
  b.box('stone', 0.45, 0.6, (iz1 - iz0) / 2 - 1.4, ix1, 0, iz1 - (iz1 - iz0) / 4 + 0.7);
  const a = Math.atan2(H - 4.1, g);
  for (const m of sideMid) {
    b.box('roof', m.len, 0.2, g / Math.cos(a) + 0.6, m.x, 4.1 + (H - 4.1) / 2 - 0.1, m.z, 0, true, -a * m.s);
  }
  for (const s of [-1, 1]) {
    const xx = s < 0 ? (x0 + ix0) / 2 : (x1 + ix1) / 2;
    b.box('roof', g / Math.cos(a) + 0.6, 0.2, z1 - z0 - 2 * g, xx, 4.1 + (H - 4.1) / 2 - 0.1, (z0 + z1) / 2, 0, true, 0, a * s);
  }
  for (const [x, z] of [[ix0, iz0], [ix1, iz0], [ix0, iz1], [ix1, iz1]]) {
    hangingLantern(b, x + Math.sign((x0 + x1) / 2 - x) * -1.4, 3.6, z + Math.sign((z0 + z1) / 2 - z) * -1.4);
  }
  // A dead tree and a well in the garth.
  well(b, (x0 + x1) / 2, (z0 + z1) / 2 + 3);
  deadTree(b, (x0 + x1) / 2 - 3, (z0 + z1) / 2 - 3, 5);
}

function aedificium(b: Builder, cx: number, cz: number) {
  const S = 18, H = 17;
  b.box('stone', S, H, S, cx, 0, cz);
  b.geo('roof', new THREE.ConeGeometry(S * 0.72, 6, 4), cx, H + 3, cz, Math.PI / 4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tx = cx + sx * S / 2, tz = cz + sz * S / 2;
    b.geo('stone', new THREE.CylinderGeometry(4.2, 4.5, H + 5, 7), tx, (H + 5) / 2, tz);
    b.geo('roof', new THREE.ConeGeometry(5, 8, 7), tx, H + 5 + 4, tz);
    for (let i = 0; i < 7; i++) {
      const a = ((i + 0.5) / 7) * Math.PI * 2;
      const lit = rand() < 0.2;
      b.box(lit ? 'window' : 'iron', 0.5, 1.4, 0.3, tx + Math.sin(a) * 3.88, H - 2, tz + Math.cos(a) * 3.88, a, false);
    }
  }
  for (const [ox, oz, r] of [[1, 0, Math.PI / 2], [-1, 0, Math.PI / 2], [0, 1, 0], [0, -1, 0]]) {
    for (let i = -2; i <= 2; i++) for (const y of [5, 9.5, 13.5]) {
      const lit = y > 12 && rand() < 0.35;
      const px = cx + ox * (S / 2 + 0.05) + (oz !== 0 ? i * 2.8 : 0);
      const pz = cz + oz * (S / 2 + 0.05) + (ox !== 0 ? i * 2.8 : 0);
      b.box(lit ? 'window' : 'iron', 0.6, 1.8, 0.2, px, y, pz, r, false);
      if (lit && rand() < 0.5) b.lamp('window', v(px + ox * 1.2, y + 0.8, pz + oz * 1.2));
    }
  }
  b.box('wood', 0.3, 3.4, 2.4, cx - S / 2 - 0.1, 0, cz);
  b.box('stone', 1.4, 0.4, 4.6, cx - S / 2 - 0.6, 0, cz);
  torch(b, cx - S / 2 - 0.05, 3.2, cz - 2, -Math.PI / 2);
  torch(b, cx - S / 2 - 0.05, 3.2, cz + 2, -Math.PI / 2);
}

function chapel(b: Builder) {
  // Ossuary chapel over the catacomb stair. Door faces south.
  const x0 = -40.5, x1 = -31.5, z0 = -60, z1 = -49, H = 6;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.box('stone', x1 - x0, H, 0.8, cx, 0, z0);
  b.box('stone', 0.8, H, z1 - z0, x0, 0, cz);
  b.box('stone', 0.8, H, z1 - z0, x1, 0, cz);
  b.box('stone', (x1 - x0 - 2.2) / 2, H, 0.8, x0 + (x1 - x0 - 2.2) / 4, 0, z1);
  b.box('stone', (x1 - x0 - 2.2) / 2, H, 0.8, x1 - (x1 - x0 - 2.2) / 4, 0, z1);
  b.box('stone', 2.2, H - 3, 0.8, cx, 3, z1);
  gable(b, z1 - z0, x1 - x0, 3.5, cx, H, cz, Math.PI / 2, 'stone', 0.5);
  torch(b, cx + 1.8, 2.8, z1 + 0.45, 0);
  torch(b, x0 + 0.45, 2.6, -54, Math.PI / 2);
  // Skull shelves on the chapel walls.
  for (const s of [-1, 1]) skullShelf(b, s < 0 ? x0 + 0.4 : x1 - 0.4, 0.2, cz + 1, s < 0 ? Math.PI / 2 : -Math.PI / 2, 6, false);
  // Railing around the stair opening.
  const hx0 = STAIR_X - STAIR_W / 2, hx1 = STAIR_X + STAIR_W / 2;
  b.box('stone', 0.3, 1.0, STAIR_TOP - HOLE_END, hx0 - 0.15, 0, (STAIR_TOP + HOLE_END) / 2);
  b.box('stone', 0.3, 1.0, STAIR_TOP - HOLE_END, hx1 + 0.15, 0, (STAIR_TOP + HOLE_END) / 2);
  b.box('stone', STAIR_W + 0.6, 1.0, 0.3, STAIR_X, 0, HOLE_END - 0.15);
}

function skullShelf(b: Builder, x: number, y: number, z: number, ry: number, len: number, under: boolean) {
  const ox = Math.sin(ry), oz = Math.cos(ry);
  const tx = Math.cos(ry), tz = -Math.sin(ry);
  for (const ly of [y + 0.9, y + 1.75]) {
    b.box('rock', len, 0.1, 0.4, x + ox * 0.2, ly, z + oz * 0.2, ry + Math.PI / 2 * 0, false);
    const n = Math.floor(len / 0.32);
    for (let i = 0; i < n; i++) {
      if (rand() < 0.2) continue;
      const t = (i + 0.5) / n - 0.5;
      const px = x + tx * t * len + ox * 0.2, pz = z + tz * t * len + oz * 0.2;
      if (rand() < 0.65) {
        b.geo('bone', new THREE.SphereGeometry(0.12, 7, 5), px, ly + 0.2, pz, 0, false);
        // Eye sockets.
        b.geo('iron', new THREE.SphereGeometry(0.035, 4, 3), px + ox * 0.1 - tx * 0.04, ly + 0.22, pz + oz * 0.1 - tz * 0.04, 0, false);
        b.geo('iron', new THREE.SphereGeometry(0.035, 4, 3), px + ox * 0.1 + tx * 0.04, ly + 0.22, pz + oz * 0.1 + tz * 0.04, 0, false);
      } else {
        b.geo('bone', new THREE.CylinderGeometry(0.035, 0.03, 0.45, 5), px, ly + 0.1, pz, ry, false, 0, Math.PI / 2);
      }
    }
  }
  void under;
}

function catacombs(b: Builder) {
  // Stair: visual steps, smooth collision ramp, side walls and a sloped ceiling.
  for (let i = 0; i < STEPS; i++) {
    const top = -(i + 1) * STAIR_RISE;
    b.box('slab', STAIR_W, 0.6, STAIR_RUN + 0.02, STAIR_X, top - 0.6, STAIR_TOP - (i + 0.5) * STAIR_RUN, 0, false);
  }
  const runLen = STAIR_TOP - STAIR_END;
  const ra = Math.atan2(-DEPTH, runLen);
  const ramp = new THREE.BoxGeometry(STAIR_W, 0.1, Math.hypot(runLen, DEPTH));
  ramp.rotateX(-ra);
  ramp.translate(STAIR_X, DEPTH / 2 - 0.05, (STAIR_TOP + STAIR_END) / 2);
  b.collide(ramp.toNonIndexed());
  for (const s of [-1, 1]) {
    b.box('rock', 0.8, -DEPTH + 0.2, STAIR_TOP - CAT_Z0, STAIR_X + s * (STAIR_W / 2 + 0.4), DEPTH - 0.1, (STAIR_TOP + CAT_Z0) / 2);
  }
  b.box('rock', STAIR_W + 1.6, -DEPTH, 0.6, STAIR_X, DEPTH, STAIR_TOP + 0.3);
  const ceilRun = HOLE_END - CAT_Z0, ceilDrop = 3.8;
  const ca = Math.atan2(ceilDrop, ceilRun);
  b.box('rock', STAIR_W + 1.6, 0.5, Math.hypot(ceilRun, ceilDrop) + 0.4, STAIR_X, -ceilDrop / 2 - 0.1, (HOLE_END + CAT_Z0) / 2, 0, true, -ca);
  torch(b, STAIR_X - STAIR_W / 2, -3.2, -58, Math.PI / 2, true);

  // Maze over a grid of cells (randomised DFS plus a few extra loops).
  const idx = (c: number, r: number) => r * COLS + c;
  const east = new Array(COLS * ROWS).fill(true);
  const south = new Array(COLS * ROWS).fill(true);
  const seen = new Array(COLS * ROWS).fill(false);
  const entryCol = Math.round((STAIR_X - CAT_X0) / CELL - 0.5);
  const stack: [number, number][] = [[entryCol, 0]];
  seen[idx(entryCol, 0)] = true;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const nb = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      .map(([dc, dr]) => [c + dc, r + dr] as [number, number])
      .filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && !seen[idx(nc, nr)]);
    if (!nb.length) { stack.pop(); continue; }
    const [nc, nr] = nb[Math.floor(rand() * nb.length)];
    if (nc > c) east[idx(c, r)] = false;
    if (nc < c) east[idx(nc, r)] = false;
    if (nr > r) south[idx(c, r)] = false;
    if (nr < r) south[idx(c, nr)] = false;
    seen[idx(nc, nr)] = true;
    stack.push([nc, nr]);
  }
  for (let i = 0; i < COLS * ROWS * 0.15; i++) {
    const c = Math.floor(rand() * (COLS - 1)), r = Math.floor(rand() * (ROWS - 1));
    if (rand() < 0.5) east[idx(c, r)] = false; else south[idx(c, r)] = false;
  }
  // Crypt: open a 3x2 chamber in the far corner.
  const cc0 = COLS - 4, cr0 = ROWS - 3;
  for (let c = cc0; c < cc0 + 3; c++) for (let r = cr0; r < cr0 + 2; r++) {
    if (c < cc0 + 2) east[idx(c, r)] = false;
    if (r < cr0 + 1) south[idx(c, r)] = false;
  }

  const X = (c: number) => CAT_X0 + c * CELL;
  const Z = (r: number) => CAT_Z0 - r * CELL;
  const WT = 0.8, WH = 3.4;
  const wallsDrawn: { x: number; z: number; ry: number }[] = [];
  const wall = (x: number, z: number, ry: number) => {
    b.box('rock', WT, WH, CELL + WT, x, DEPTH, z, ry);
    wallsDrawn.push({ x, z, ry });
  };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (east[idx(c, r)] || c === COLS - 1) wall(X(c + 1), Z(r) - CELL / 2, 0);
    if (south[idx(c, r)] || r === ROWS - 1) wall(X(c) + CELL / 2, Z(r + 1), Math.PI / 2);
    if (c === 0) wall(X(0), Z(r) - CELL / 2, 0);
    if (r === 0 && c !== entryCol) wall(X(c) + CELL / 2, Z(0), Math.PI / 2);
  }
  const w = COLS * CELL, d = ROWS * CELL;
  b.box('rock', w + 2, 0.6, d + 2, CAT_X0 + w / 2, DEPTH - 0.6, CAT_Z0 - d / 2);
  b.box('rock', w + 2, 0.8, d + 2, CAT_X0 + w / 2, DEPTH + WH, CAT_Z0 - d / 2);
  // Transverse ribs give the ceiling some rhythm.
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    b.box('stone', CELL, 0.35, 0.45, X(c) + CELL / 2, DEPTH + WH - 0.35, Z(r) - CELL / 2, 0, false);
  }
  // Skull shelves on corridor walls, torches here and there.
  for (const wd of wallsDrawn) {
    for (const s of [-1, 1]) {
      if (rand() > 0.45) continue;
      const ox = Math.cos(wd.ry) * s, oz = -Math.sin(wd.ry) * s;
      const fx = wd.x + ox * (WT / 2), fz = wd.z + oz * (WT / 2);
      if (fx < CAT_X0 + 0.1 || fx > CAT_X0 + w - 0.1 || fz > CAT_Z0 - 0.1 || fz < CAT_Z0 - d + 0.1) continue;
      skullShelf(b, fx, DEPTH, fz, Math.atan2(ox, oz), CELL * 0.75, true);
    }
  }
  for (const wd of wallsDrawn) {
    if (rand() > 0.16) continue;
    const s = rand() < 0.5 ? -1 : 1;
    const ox = Math.cos(wd.ry) * s, oz = -Math.sin(wd.ry) * s;
    const fx = wd.x + ox * (WT / 2), fz = wd.z + oz * (WT / 2);
    if (fx < CAT_X0 + 0.1 || fx > CAT_X0 + w - 0.1 || fz > CAT_Z0 - 0.1 || fz < CAT_Z0 - d + 0.1) continue;
    torch(b, fx, DEPTH + 2.4, fz, Math.atan2(ox, oz), true);
  }
  // The crypt: a sarcophagus, a ring of candles and an open book.
  const kx = X(cc0) + CELL * 1.5, kz = Z(cr0) - CELL;
  b.box('stone', 1.4, 0.9, 2.6, kx, DEPTH, kz);
  b.box('slab', 1.6, 0.18, 2.8, kx, DEPTH + 0.9, kz);
  b.box('bone', 0.5, 0.12, 1.6, kx, DEPTH + 1.08, kz, 0, false);
  b.geo('bone', new THREE.SphereGeometry(0.16, 10, 8), kx, DEPTH + 1.2, kz - 0.95, 0, false);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const px = kx + Math.sin(a) * 2.4, pz = kz + Math.cos(a) * 2.8;
    b.geo('bone', new THREE.CylinderGeometry(0.05, 0.06, 0.6 + (i % 3) * 0.2, 6), px, DEPTH + 0.3 + (i % 3) * 0.1, pz, 0, false);
    b.lamp('candle', v(px, DEPTH + 0.75 + (i % 3) * 0.2, pz), true);
  }
  const lx = kx + 3.6, lz = kz;
  b.box('wood', 0.25, 1.1, 0.25, lx, DEPTH, lz);
  b.box('wood', 0.8, 0.08, 0.6, lx, DEPTH + 1.15, lz, 0, false, 0, 0.35);
  b.box('bone', 0.65, 0.05, 0.5, lx, DEPTH + 1.24, lz, 0, false, 0, 0.35);
  b.lamps.push({ pos: v(lx, DEPTH + 1.6, lz), color: new THREE.Color(0.35, 0.6, 1.0), intensity: 0.6, under: true, seed: 3 });
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

function outskirts(b: Builder) {
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, r = R(WALL_R + 10, 170);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x) < 7 && z > 0) continue;
    deadTree(b, x, z, R(4, 9));
  }
  // Wayside cross and a lantern by the approach road.
  b.box('wood', 0.25, 3.4, 0.25, -5, 0, 104);
  b.box('wood', 1.6, 0.22, 0.22, -5, 2.5, 104);
  lanternPost(b, 4.5, 100, -Math.PI / 2);
}

export const SPAWN = new THREE.Vector3(0, 1.7, 112);

export function regionName(p: THREE.Vector3): string {
  if (p.y < -2) return 'Catacumbae';
  const r = Math.hypot(p.x, p.z);
  if (r > WALL_R + 3) return 'Extra Muros';
  if (p.z > WALL_R - 8 && Math.abs(p.x) < 8) return 'Porta Meridionalis';
  if (p.x > -46 && p.x < 48 && p.z > -66 && p.z < -8) {
    if (p.x > -16 && p.x < 22 && p.z > -51 && p.z < -39) return 'Ecclesia Abbatialis';
    if (p.x > -27 && p.x < -5 && p.z > -37 && p.z < -15) return 'Claustrum';
    if (p.x > -41 && p.x < -31 && p.z > -60 && p.z < -49) return 'Ossuarium';
    if (p.x > 20 && p.x < 48 && p.z > -40 && p.z < -10) return 'Aedificium';
    if (p.z < -52) return 'Coemeterium';
    return 'Abbatia';
  }
  return 'Civitas';
}
