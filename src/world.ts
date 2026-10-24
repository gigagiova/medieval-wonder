import * as THREE from 'three';
import { Builder, rng } from './builder';
import type { MatName } from './materials';

// A Lombard town of the 7th century living inside the shell of a Roman one:
// late-Roman brick walls patched with river stone, the old cardo and decumanus
// still paved with basalt, a forum of broken columns, and a Benedictine abbey
// built from spolia, with catacombs beneath it.

export const WALL_R = 88;
const WALL_H = 9;
const SEGS = 16;
const rand = rng(1327);
const R = (a: number, b: number) => a + (b - a) * rand();

// Stair / catacomb constants. The stair descends towards -z from inside the
// ossuary chapel into a maze carved 7 m under the monastery.
const STAIR_X = -36, STAIR_W = 3, STAIR_TOP = -52, STAIR_RUN = 0.35, STAIR_RISE = 0.25, DEPTH = -7;
const STEPS = Math.round(-DEPTH / STAIR_RISE);
const STAIR_END = STAIR_TOP - STEPS * STAIR_RUN;
const HOLE_END = -56;
const CAT_X0 = -58, CAT_Z0 = -62, CELL = 4, COLS = 11, ROWS = 9;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildWorld(scene: THREE.Scene) {
  const b = new Builder();
  ground(b);
  townWall(b);
  roman(b);
  monastery(b);
  catacombs(b);
  houses(b);
  outskirts(b);
  const { collider, cells } = b.build(scene);
  return { collider, cells, lamps: b.lamps, flames: b.flames, props: b.props };
}

// ---------------------------------------------------------------- shapes

/** A wall of length L along local x with n round-arched openings, extruded `depth` along z. */
function arcadeGeo(L: number, h: number, depth: number, n: number, openW: number, spring: number) {
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
function arcade(b: Builder, m: MatName, L: number, h: number, depth: number, n: number, openW: number, spring: number, x: number, y: number, z: number, ry: number) {
  b.geo(m, arcadeGeo(L, h, depth, n, openW, spring), x, y, z, ry);
}

/** Wall with a broken, jagged top: ruins and roofless shells. */
function ruinGeo(L: number, h: number, depth: number, jag = 0.5, openW = 0, spring = 0) {
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
function ruin(b: Builder, m: MatName, L: number, h: number, depth: number, x: number, y: number, z: number, ry: number, jag = 0.5, openW = 0, spring = 0) {
  b.geo(m, ruinGeo(L, h, depth, jag, openW, spring), x, y, z, ry);
}

/** Roman column, often reused (spolia): plinth, base torus, tapering shaft, impost capital. */
function column(b: Builder, x: number, y: number, z: number, h: number, r: number, broken = 0, m: MatName = 'marble') {
  b.box(m, r * 2.8, 0.22, r * 2.8, x, y, z);
  b.geo(m, new THREE.CylinderGeometry(r * 1.3, r * 1.4, 0.22, 18), x, y + 0.33, z);
  const shaft = broken > 0 ? h * broken : h - 0.95;
  b.geo(m, new THREE.CylinderGeometry(r * 0.86, r, shaft, 16, Math.max(1, Math.round(shaft / 0.6))), x, y + 0.44 + shaft / 2, z);
  if (broken > 0) {
    // A jagged break: a short tilted stub on top.
    b.geo(m, new THREE.CylinderGeometry(r * 0.6, r * 0.86, 0.25, 9), x + 0.05, y + 0.44 + shaft + 0.08, z, R(0, 3), true, R(-0.3, 0.3), R(-0.3, 0.3));
    return;
  }
  b.geo(m, new THREE.CylinderGeometry(r * 1.05, r * 0.88, 0.12, 16), x, y + 0.44 + shaft + 0.06, z);
  b.geo(m, new THREE.CylinderGeometry(r * 1.75, r * 0.95, 0.4, 4), x, y + 0.44 + shaft + 0.32, z, Math.PI / 4);
}

function fallenDrum(b: Builder, x: number, z: number, r: number, len: number, ry: number) {
  b.geo('marble', new THREE.CylinderGeometry(r, r * 0.95, len, 16, 2), x, r * 0.92, z, ry, true, 0, Math.PI / 2);
}

/** Low-pitched gable roof of coppi over a w × d footprint (ridge along local x). */
function gable(b: Builder, w: number, d: number, hr: number, x: number, y: number, z: number, ry: number, wallMat: MatName, over = 0.5) {
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
    b.box('roof', w + over * 1.6, 0.18, L, x + lx, cy - 0.1, z + lz, ry, true, a * s2);
  }
}

/** Single-slope roof (aisles, porticoes, cloister walks). Falls towards local +z. */
function leanTo(b: Builder, len: number, run: number, hHigh: number, hLow: number, x: number, z: number, ry: number) {
  const a = Math.atan2(hHigh - hLow, run);
  b.box('roof', len, 0.18, run / Math.cos(a) + 0.5, x, (hHigh + hLow) / 2 - 0.05, z, ry, true, a);
}

function pyramidRoof(b: Builder, w: number, h: number, x: number, y: number, z: number) {
  b.geo('roof', new THREE.ConeGeometry(w * 0.74, h, 4, 3), x, y + h / 2, z, Math.PI / 4);
}

// ---------------------------------------------------------------- lights

/** Iron ring sconce with a pitch torch, pointing outward along ry. */
function torch(b: Builder, x: number, y: number, z: number, ry: number, under = false) {
  const ox = Math.sin(ry), oz = Math.cos(ry);
  b.box('iron', 0.05, 0.05, 0.3, x + ox * 0.12, y - 0.35, z + oz * 0.12, ry, false);
  b.geo('iron', new THREE.TorusGeometry(0.07, 0.015, 5, 10), x + ox * 0.25, y - 0.32, z + oz * 0.25, ry, false, Math.PI / 2);
  b.geo('wood', new THREE.CylinderGeometry(0.03, 0.025, 0.6, 6), x + ox * 0.27, y - 0.2, z + oz * 0.27, ry, false, 0.25);
  b.geo('iron', new THREE.CylinderGeometry(0.06, 0.045, 0.16, 8), x + ox * 0.33, y + 0.06, z + oz * 0.33, ry, false, 0.25);
  b.lamp('torch', v(x + ox * 0.35, y + 0.13, z + oz * 0.35), under);
}

/** Iron fire basket on a tripod: the street light of the age, at gates and squares. */
function brazier(b: Builder, x: number, z: number, y = 0) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.box('iron', 0.05, 1.05, 0.05, x + Math.sin(a) * 0.22, y, z + Math.cos(a) * 0.22, a, true, -0.25);
  }
  b.geo('iron', new THREE.CylinderGeometry(0.42, 0.24, 0.3, 14, 1, true), x, y + 1.1, z, 0, true);
  b.geo('iron', new THREE.TorusGeometry(0.42, 0.025, 5, 16), x, y + 1.25, z, 0, false, Math.PI / 2);
  b.geo('ember', new THREE.CylinderGeometry(0.38, 0.3, 0.12, 14), x, y + 1.14, z, 0, false);
  b.lamp('brazier', v(x, y + 1.2, z));
}

/**
 * Roman-type lantern: a bronze cylinder with panes of scraped horn and a domed,
 * pierced lid, hung by a chain. Dim and amber.
 */
function hornLantern(b: Builder, x: number, y: number, z: number, under = false) {
  b.geo('bronze', new THREE.CylinderGeometry(0.1, 0.11, 0.03, 12), x, y - 0.15, z, 0, false);
  b.geo('horn', new THREE.CylinderGeometry(0.095, 0.095, 0.26, 12, 1, true), x, y, z, 0, false);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.box('bronze', 0.015, 0.3, 0.015, x + Math.sin(a) * 0.1, y - 0.15, z + Math.cos(a) * 0.1, 0, false);
  }
  b.geo('bronze', new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, y + 0.13, z, 0, false);
  b.geo('bronze', new THREE.TorusGeometry(0.04, 0.008, 4, 10), x, y + 0.27, z, 0, false);
  b.box('iron', 0.012, 0.5, 0.012, x, y + 0.29, z, 0, false);
  b.lamp('lantern', v(x, y, z), under);
}

/** Wall bracket with a hanging horn lantern, out from the wall along ry. */
function bracketLantern(b: Builder, x: number, y: number, z: number, ry: number) {
  const ox = Math.sin(ry), oz = Math.cos(ry);
  b.box('iron', 0.04, 0.04, 0.6, x + ox * 0.3, y + 0.8, z + oz * 0.3, ry, false);
  b.box('iron', 0.03, 0.4, 0.03, x + ox * 0.08, y + 0.42, z + oz * 0.08, ry, false, 0.6);
  hornLantern(b, x + ox * 0.55, y, z + oz * 0.55);
}

/** Clay oil lamp (lucerna): a flattened body with a nozzle and a little flame. */
function lucerna(b: Builder, x: number, y: number, z: number, ry: number, under = false, light = true) {
  const g = new THREE.SphereGeometry(0.055, 10, 6);
  g.scale(1, 0.38, 1);
  b.geo('clay', g, x, y + 0.02, z, ry, false);
  const nx = Math.sin(ry) * 0.07, nz = Math.cos(ry) * 0.07;
  b.geo('clay', new THREE.CylinderGeometry(0.017, 0.022, 0.06, 6), x + nx * 0.7, y + 0.022, z + nz * 0.7, ry, false, Math.PI / 2);
  const fp = v(x + nx, y + 0.035, z + nz);
  if (light) b.lamp('oil', fp, under); else b.flame('oil', fp);
}

/** Polykandelon: a pierced bronze disc on three chains, holding glass oil-lamp cups. */
function polykandelon(b: Builder, x: number, y: number, z: number, top: number, cups = 10) {
  const r = 0.55;
  b.geo('bronze', new THREE.TorusGeometry(r, 0.02, 5, 28), x, y, z, 0, false, Math.PI / 2);
  b.geo('bronze', new THREE.TorusGeometry(r * 0.45, 0.015, 5, 18), x, y, z, 0, false, Math.PI / 2);
  for (let i = 0; i < 6; i++) b.box('bronze', 0.02, 0.012, r, x + Math.sin(i * Math.PI / 3) * r / 2, y - 0.006, z + Math.cos(i * Math.PI / 3) * r / 2, i * Math.PI / 3, false);
  const hang = v(x, y + 1.2, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = v(x + Math.sin(a) * r, y, z + Math.cos(a) * r);
    const mid = p.clone().add(hang).multiplyScalar(0.5);
    const len = p.distanceTo(hang);
    const g = new THREE.BoxGeometry(0.012, len, 0.012);
    const m = new THREE.Matrix4().lookAt(p, hang, new THREE.Vector3(0, 0, 1));
    const q = new THREE.Quaternion().setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    b.add(g, 'iron', new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), false);
  }
  b.box('iron', 0.015, top - hang.y, 0.015, x, hang.y, z, 0, false);
  for (let i = 0; i < cups; i++) {
    const a = (i / cups) * Math.PI * 2;
    const cx = x + Math.sin(a) * r, cz = z + Math.cos(a) * r;
    b.geo('horn', new THREE.CylinderGeometry(0.045, 0.012, 0.09, 8), cx, y - 0.02, cz, 0, false);
    b.flame('oil', v(cx, y + 0.03, cz), 0.9);
  }
  b.lamp('poly', v(x, y + 0.1, z));
}

function candle(b: Builder, x: number, y: number, z: number, h = 0.35, under = false) {
  b.geo('bronze', new THREE.CylinderGeometry(0.06, 0.09, 0.05, 10), x, y + 0.025, z, 0, false);
  b.geo('bronze', new THREE.CylinderGeometry(0.015, 0.02, h * 0.6, 6), x, y + 0.05 + h * 0.3, z, 0, false);
  b.geo('bone', new THREE.CylinderGeometry(0.022, 0.025, h * 0.4, 8), x, y + 0.05 + h * 0.6 + h * 0.2, z, 0, false);
  b.lamp('candle', v(x, y + 0.05 + h, z), under);
}

// ---------------------------------------------------------------- town wall

function merlons(b: Builder, x: number, z: number, y: number, ry: number, len: number, m: MatName = 'brick', ruinous = 0) {
  const n = Math.floor(len / 1.9);
  const dx = Math.sin(ry), dz = Math.cos(ry);
  for (let i = 0; i < n; i++) {
    if (rand() < ruinous) continue;
    const t = (i + 0.5) / n - 0.5;
    b.box(m, 0.75, R(0.9, 1.15), 1.05, x + dx * t * len, y, z + dz * t * len, ry);
  }
}

function roundTower(b: Builder, x: number, z: number, h: number, r: number, roofed: boolean, ruined: boolean) {
  const hh = ruined ? h * R(0.55, 0.8) : h;
  b.geo('brick', new THREE.CylinderGeometry(r, r * 1.04, hh, 28, Math.ceil(hh / 0.7)), x, hh / 2 - 0.5, z);
  // A Lombard repair course of river stone near the top.
  if (!ruined) b.geo('rubble', new THREE.CylinderGeometry(r * 1.01, r * 1.01, 2.2, 28, 3), x, hh - 1.6, z);
  if (roofed && !ruined) {
    b.geo('roof', new THREE.ConeGeometry(r * 1.15, 2.2, 28, 2), x, hh - 0.5 + 1.1, z);
  } else if (!ruined) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.box('brick', 0.9, 1.0, 0.8, x + Math.sin(a) * (r - 0.4), hh - 0.5, z + Math.cos(a) * (r - 0.4), a);
    }
  }
  // Small arched loops.
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    b.box('iron', 0.25, 1.0, 0.3, x + Math.sin(a) * (r - 0.05), R(3, hh - 3), z + Math.cos(a) * (r - 0.05), a, false);
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
    const mx = mid.x + out.x * (T / 2 - 0.4), mz = mid.y + out.y * (T / 2 - 0.4);
    if (k === SEGS - 1) {
      // Porta: a brick arch between two round towers.
      const gap = 9;
      const half = (L - gap) / 2;
      const dir = d.clone().normalize();
      for (const s of [-1, 1]) {
        const off = (gap / 2 + half / 2) * s;
        b.box('brick', T, WALL_H, half, mid.x + dir.x * off, -0.5, mid.y + dir.y * off, ry);
        merlons(b, mx + dir.x * off, mz + dir.y * off, WALL_H - 0.5, ry, half);
        const tx = mid.x + dir.x * 6.2 * s + out.x * 1.2, tz = mid.y + dir.y * 6.2 * s + out.y * 1.2;
        roundTower(b, tx, tz, WALL_H + 5, 3.6, true, false);
      }
      b.geo('brick', arcadeGeo(gap + 0.6, WALL_H + 1.5, T + 0.4, 1, 4.6, 4.2), mid.x, -0.5, mid.y, ry + Math.PI / 2);
      b.box('marble', T + 0.6, 0.35, gap + 0.6, mid.x, WALL_H + 0.6, mid.y, ry);
      merlons(b, mx, mz, WALL_H + 0.95, ry, gap);
      for (const io of [1, -1]) {
        const fx = mid.x + out.x * 5.5 * io, fz = mid.y + out.y * 5.5 * io;
        brazier(b, fx + dir.x * 3.6, fz + dir.y * 3.6);
        brazier(b, fx - dir.x * 3.6, fz - dir.y * 3.6);
      }
      for (const s of [-1, 1]) torch(b, mid.x + dir.x * 2.6 * s + out.x * (T / 2 + 0.25), 3.4, mid.y + dir.y * 2.6 * s + out.y * (T / 2 + 0.25), Math.atan2(out.x, out.y));
      continue;
    }
    // Curtain: Roman brick below, some stretches rebuilt in river stone above,
    // a few stretches broken down and never repaired.
    const broken = k % 5 === 2;
    if (broken) {
      ruin(b, 'brick', L + 1, WALL_H, T, mid.x, -0.5, mid.y, ry + Math.PI / 2, 0.55);
    } else if (rand() < 0.5) {
      b.box('brick', T, WALL_H - 3, L + 1, mid.x, -0.5, mid.y, ry);
      b.box('rubble', T - 0.1, 3, L + 1, mid.x, WALL_H - 3.5, mid.y, ry);
      merlons(b, mx, mz, WALL_H - 0.5, ry, L - 7, 'rubble', 0.25);
    } else {
      b.box('brick', T, WALL_H, L + 1, mid.x, -0.5, mid.y, ry);
      merlons(b, mx, mz, WALL_H - 0.5, ry, L - 7, 'brick', 0.15);
    }
  }
  for (let k = 0; k < SEGS; k++) {
    const p = pts[k];
    const o = p.clone().normalize().multiplyScalar(1.6);
    roundTower(b, p.x + o.x, p.y + o.y, 12 + (k % 3) * 1.5, 4.0, k % 3 === 0, k % 7 === 4);
    if (k % 4 === 1) torch(b, p.x - p.x / WALL_R * 2.6, 3.6, p.y - p.y / WALL_R * 2.6, Math.atan2(-p.x, -p.y));
  }
}

// ---------------------------------------------------------------- Roman ruins

function roman(b: Builder) {
  // Forum: the temple podium, half its colonnade still standing, the rest on the ground.
  const tx = 24, tz = 10;
  b.box('marble', 12, 1.8, 18, tx, -0.2, tz);
  for (let i = 0; i < 7; i++) b.box('marble', 7, 0.3, 0.45, tx, -0.2 + i * 0.26, tz + 9 + 3.15 - i * 0.45);
  const front = [0.0, 1, 0.45, 1, 0, 0.3];
  for (let i = 0; i < 6; i++) {
    const x = tx - 5 + i * 2, f = front[i];
    if (f === 0) continue;
    column(b, x, 1.6, tz + 8, 9, 0.45, f === 1 ? 0 : f);
  }
  // Architrave fragment still bridging two columns.
  b.box('marble', 4.8, 0.9, 1.2, tx - 1, 1.6 + 9.0 + 0.1, tz + 8);
  for (let i = 0; i < 4; i++) {
    const z = tz + 5 - i * 3.5;
    if (i % 2 === 0) column(b, tx - 5, 1.6, z, 9, 0.45, i === 2 ? 0.5 : 0);
    if (i !== 1) column(b, tx + 5, 1.6, z, 9, 0.45, i === 3 ? 0.35 : 0);
  }
  ruin(b, 'brick', 9, 8, 0.9, tx, 1.6, tz - 5, 0, 0.6);
  ruin(b, 'brick', 10, 7, 0.9, tx - 4.5, 1.6, tz - 0.5, Math.PI / 2, 0.7);
  for (let i = 0; i < 7; i++) fallenDrum(b, tx + R(-8, 10), tz + R(10, 15), 0.43, R(0.9, 2.2), R(0, Math.PI));
  b.box('marble', 1.6, 0.9, 0.9, tx + 7, -0.1, tz + 11, 0.5, true, 0.2, 0.15);
  brazier(b, tx - 4, tz + 14.5);
  brazier(b, tx + 4, tz + 14.5);

  // Triumphal arch across the decumanus, attic gone, one side cracked open.
  const ax = -46, az = 30;
  b.geo('marble', ruinGeo(13, 11.5, 3.2, 0.25, 5.5, 5.5), ax, 0, az, Math.PI / 2);
  for (const s of [-1, 1]) {
    column(b, ax - 1.8, 0.2, az + s * 4.4, 8.2, 0.35, s > 0 ? 0 : 0.6);
    column(b, ax + 1.8, 0.2, az + s * 4.4, 8.2, 0.35, 0);
  }
  for (let i = 0; i < 4; i++) b.box('marble', R(0.7, 1.4), R(0.5, 0.9), R(0.6, 1.2), ax + R(-4, 4), -0.2, az + R(-7, 7), R(0, 3), true, R(-0.3, 0.3));

  // Spolia lying about the town.
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2, r = R(10, WALL_R - 12);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x) < 6 || Math.abs(z - 30) < 6 || (x > -48 && x < 50 && z > -68 && z < -5)) continue;
    if (rand() < 0.6) fallenDrum(b, x, z, R(0.3, 0.45), R(0.8, 2.4), R(0, Math.PI));
    else column(b, x, 0, z, R(3, 6), 0.35, R(0.25, 0.7));
  }
}

// ---------------------------------------------------------------- houses

/**
 * A Lombard house: river-stone ground floor, an upper floor of stone,
 * plastered wattle or planks, a low coppi roof, small shuttered windows,
 * sometimes a wooden gallery. Some are roofless shells.
 */
function house(b: Builder, x: number, z: number, w: number, d: number, h: number, ry: number) {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const P = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  if (rand() < 0.12) {
    // Abandoned shell.
    for (const [lx, lz, len, r] of [[0, d / 2, w, 0], [0, -d / 2, w, 0], [w / 2, 0, d, Math.PI / 2], [-w / 2, 0, d, Math.PI / 2]] as const) {
      const [wx, wz] = P(lx, lz);
      ruin(b, rand() < 0.5 ? 'rubble' : 'brick', len + 0.6, h * R(0.5, 0.9), 0.6, wx, -0.2, wz, ry + r, 0.7);
    }
    if (rand() < 0.5) {
      const [cx, cz] = P(R(-w / 3, w / 3), R(-d / 3, d / 3));
      deadTree(b, cx, cz, R(3, 6));
    }
    return;
  }
  const h1 = Math.min(h, 3.2);
  b.box('rubble', w, h1, d, x, -0.2, z, ry);
  const upper = h > 4.2 ? (rand() < 0.4 ? 'rubble' : rand() < 0.6 ? 'plaster' : 'wood') as MatName : null;
  if (upper) b.box(upper, w - (upper === 'rubble' ? 0 : 0.1), h - h1, d - (upper === 'rubble' ? 0 : 0.1), x, h1 - 0.2, z, ry);
  // Spolia: a Roman column built into a corner.
  if (rand() < 0.15) {
    const [cx, cz] = P(w / 2, d / 2);
    b.geo('marble', new THREE.CylinderGeometry(0.28, 0.3, h1, 12, 4), cx, h1 / 2 - 0.2, cz);
  }
  gable(b, w, d, d * 0.21, x, h - 0.2, z, ry, upper ?? 'rubble', 0.6);
  // Door under a stone lintel.
  const doorX = R(-w / 2 + 1, w / 2 - 1);
  const [dx, dz] = P(doorX, d / 2 + 0.04);
  b.box('wood', 1.0, 1.95, 0.12, dx, -0.1, dz, ry);
  const [lx, lz] = P(doorX, d / 2 + 0.06);
  b.box('marble', 1.5, 0.3, 0.25, lx, 1.85, lz, ry);
  const lit = rand();
  if (lit < 0.16) {
    const [tx, tz] = P(doorX + 0.95, d / 2 + 0.05);
    bracketLantern(b, tx, 2.1, tz, ry);
  } else if (lit < 0.24) {
    const [tx, tz] = P(doorX + 0.95, d / 2 + 0.05);
    torch(b, tx, 2.3, tz, ry);
  }
  // Small windows: closed shutters, firelight leaking through some.
  const floors = h > 4.2 ? [1.4, h1 + 1.0] : [1.4];
  for (const face of [0, 1, 2, 3]) {
    const along = face % 2 === 0 ? w : d;
    const n = Math.max(1, Math.floor(along / 3.2));
    for (const fy of floors) for (let i = 0; i < n; i++) {
      if (rand() < 0.3) continue;
      const off = ((i + 0.5) / n - 0.5) * along;
      if (face === 0 && fy < 2.5 && Math.abs(off - doorX) < 1.2) continue;
      let lx2 = 0, lz2 = 0, fr = 0;
      if (face === 0) { lx2 = off; lz2 = d / 2 + 0.03; fr = 0; }
      if (face === 1) { lx2 = w / 2 + 0.03; lz2 = off; fr = Math.PI / 2; }
      if (face === 2) { lx2 = off; lz2 = -d / 2 - 0.03; fr = Math.PI; }
      if (face === 3) { lx2 = -w / 2 - 0.03; lz2 = off; fr = -Math.PI / 2; }
      if (face % 2 === 1 && Math.abs(lz2) > d / 2 - 0.6) continue;
      const [wx, wz] = P(lx2, lz2);
      const glow = rand() < 0.28;
      b.box(glow ? 'window' : 'wood', 0.55, 0.7, 0.07, wx, fy, wz, ry + fr, false);
      b.box('marble', 0.75, 0.1, 0.18, wx, fy - 0.08, wz, ry + fr, false);
      if (glow && rand() < 0.35) {
        const o = ry + fr;
        b.lamp('window', v(wx + Math.sin(o) * 0.6, fy + 0.4, wz + Math.cos(o) * 0.6));
      }
    }
  }
  // Wooden gallery (ballatoio) along the upper floor.
  if (h > 4.2 && rand() < 0.35) {
    const [gx, gz] = P(0, d / 2 + 0.6);
    b.box('wood', w * 0.8, 0.12, 1.1, gx, h1 - 0.1, gz, ry);
    const [rx, rz] = P(0, d / 2 + 1.1);
    b.box('wood', w * 0.8, 0.08, 0.06, rx, h1 + 0.9, rz, ry);
    for (const s of [-1, 0, 1]) {
      const [px, pz] = P(s * w * 0.38, d / 2 + 1.1);
      b.box('wood', 0.12, h1 + 0.9, 0.12, px, -0.2, pz, ry);
    }
  }
}

interface Rect { x0: number; x1: number; z0: number; z1: number }
const overlaps = (a: Rect, c: Rect) => a.x0 < c.x1 && a.x1 > c.x0 && a.z0 < c.z1 && a.z1 > c.z0;

function houses(b: Builder) {
  const keepOut: Rect[] = [
    { x0: -48, x1: 50, z0: -68, z1: -5 }, // monastery
    { x0: -4.5, x1: 4.5, z0: -10, z1: 100 }, // cardo
    { x0: -100, x1: 100, z0: 26, z1: 34 }, // decumanus
    { x0: 10, x1: 38, z0: -4, z1: 26 }, // forum
    { x0: -53, x1: -39, z0: 20, z1: 40 }, // arch
  ];
  const placed: Rect[] = [];
  const tryPlace = (x: number, z: number, w: number, d: number, ry: number) => {
    const swap = Math.abs(Math.sin(ry)) > 0.5;
    const ex = (swap ? d : w) / 2 + 0.6, ez = (swap ? w : d) / 2 + 0.6;
    const r: Rect = { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez };
    for (const [cx, cz] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) if (Math.hypot(cx, cz) > WALL_R - 10) return false;
    if (keepOut.some((k) => overlaps(k, r)) || placed.some((p) => overlaps(p, r))) return false;
    placed.push(r);
    house(b, x, z, w, d, R(3.2, 7), ry + R(-0.04, 0.04));
    return true;
  };
  for (const side of [-1, 1]) {
    let z = -2;
    while (z < 80) {
      const w = R(5, 8), d = R(5, 7);
      tryPlace(side * (5.4 + d / 2), z + w / 2, w, d, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      z += w + R(0.4, 3.5);
    }
  }
  for (const side of [-1, 1]) {
    let x = -84;
    while (x < 84) {
      const w = R(5, 8), d = R(5, 7);
      tryPlace(x + w / 2, 30 + side * (5.4 + d / 2), w, d, side > 0 ? Math.PI : 0);
      x += w + R(0.4, 3.5);
    }
  }
  for (let i = 0; i < 700; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * (WALL_R - 10);
    const rot = Math.floor(rand() * 4) * (Math.PI / 2);
    tryPlace(Math.sin(a) * r, Math.cos(a) * r, R(5, 9), R(5, 7.5), rot);
  }
  brazier(b, 6, 36);
  for (const z of [8, 52, 74]) brazier(b, z % 2 ? -3.2 : 3.2, z);
  for (const x of [-70, -24, 52, 76]) brazier(b, x, x % 4 ? 33.2 : 26.8);
  well(b, -8, 38);
}

function well(b: Builder, x: number, z: number) {
  // A reused Roman puteal: a marble drum.
  b.geo('marble', new THREE.CylinderGeometry(0.85, 0.9, 0.9, 20, 2, true), x, 0.45, z);
  b.geo('marble', new THREE.TorusGeometry(0.85, 0.09, 6, 20), x, 0.9, z, 0, true, Math.PI / 2);
  for (const s of [-1, 1]) b.box('wood', 0.16, 2.3, 0.16, x + s * 1.0, 0, z);
  b.box('wood', 2.3, 0.14, 0.14, x, 2.2, z, 0, false);
}

// ---------------------------------------------------------------- monastery

function monastery(b: Builder) {
  const W = { x0: -46, x1: 48, z0: -66, z1: -8 };
  const wallSeg = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    b.box('rubble', 0.9, 3.6, L + 1, (x0 + x1) / 2, -0.2, (z0 + z1) / 2, ry);
    b.box('roof', 1.3, 0.2, L + 1.2, (x0 + x1) / 2, 3.4, (z0 + z1) / 2, ry);
  };
  wallSeg(W.x0, W.z0, W.x1, W.z0);
  wallSeg(W.x0, W.z0, W.x0, W.z1);
  wallSeg(W.x1, W.z0, W.x1, W.z1);
  wallSeg(W.x0, W.z1, -3.2, W.z1);
  wallSeg(3.2, W.z1, W.x1, W.z1);
  arcade(b, 'brick', 7, 5.6, 1.4, 1, 3.4, 2.6, 0, -0.2, W.z1, 0);
  gable(b, 7, 1.4, 0.6, 0, 5.4, W.z1, 0, 'brick', 0.3);
  torch(b, -2.3, 3.0, W.z1 + 0.72, 0);
  torch(b, 2.3, 3.0, W.z1 + 0.72, 0);

  church(b);
  cloister(b);
  turris(b, 34, -24);
  chapel(b);
  for (let i = 0; i < 30; i++) {
    const x = R(0, 22), z = R(-63, -57);
    const ry = R(-0.2, 0.2), tilt = R(-0.15, 0.15);
    if (rand() < 0.5) {
      b.box('marble', 0.16, 1.1, 0.14, x, -0.15, z, ry, true, 0, tilt);
      b.box('marble', 0.6, 0.14, 0.14, x, 0.65, z, ry, false, 0, tilt);
    } else {
      b.box('rubble', 0.9, 0.35, 2.0, x, -0.15, z, ry);
    }
  }
}

/**
 * Early-Christian basilica as the Lombards built them: a tall nave on
 * reused marble columns, lower aisles, a semicircular apse, a portico.
 */
function church(b: Builder) {
  const x0 = -16, x1 = 14, nz0 = -49, nz1 = -41, H = 12, AH = 6.5, T = 0.9;
  const L = x1 - x0, cz = (nz0 + nz1) / 2, cx = (x0 + x1) / 2;
  const az0 = nz0 - 4, az1 = nz1 + 4;
  // Nave arcades on columns, clerestory above.
  for (const zz of [nz0, nz1]) {
    arcade(b, 'brick', L, AH + 0.4, 0.7, 7, 3.4, 4.2, cx, 0, zz, 0);
    for (let i = 1; i < 7; i++) column(b, x0 + (L / 7) * i, 0, zz, 4.25, 0.3, 0, 'marble');
    b.box('brick', L, H - AH - 0.4, 0.7, cx, AH + 0.4, zz);
    for (let i = 0; i < 7; i++) {
      b.box('iron', 0.7, 1.5, 0.8, x0 + (L / 7) * (i + 0.5), AH + 2.4, zz, 0, false);
    }
  }
  gable(b, L + 0.7, nz1 - nz0 + 0.7, 2.4, cx, H, cz, 0, 'brick', 0.6);
  // Aisles: outer walls with small arched windows, lean-to roofs.
  for (const s of [-1, 1]) {
    const zw = s < 0 ? az0 : az1;
    if (s > 0) {
      b.box('brick', (L - 3) / 2 - 2, AH, T, x0 + ((L - 3) / 2 - 2) / 2, 0, zw);
      arcade(b, 'brick', 7, AH, T, 1, 2.2, 2.8, cx - 3.5 + 3.5 + 0, 0, zw, 0);
      b.box('brick', (L - 3) / 2 - 2, AH, T, x1 - ((L - 3) / 2 - 2) / 2, 0, zw);
    } else {
      b.box('brick', L, AH, T, cx, 0, zw);
    }
    for (let i = 0; i < 6; i++) b.box('iron', 0.45, 1.1, T + 0.1, x0 + 2.5 + i * 5, 3.8, zw, 0, false);
    leanTo(b, L + 0.8, 4.4, AH + 2.2, AH - 0.1, cx, (zw + (s < 0 ? nz0 : nz1)) / 2, s < 0 ? Math.PI : 0);
  }
  // West facade: portal, small windows, gable.
  b.geo('brick', arcadeGeo(az1 - az0, H, T, 1, 2.4, 2.6), x0, 0, cz, Math.PI / 2);
  gable(b, T, nz1 - nz0 + 0.7, 2.4, x0, H, cz, 0, 'brick', 0);
  b.box('iron', T + 0.1, 1.6, 0.7, x0, H - 3.5, cz, 0, false);
  b.box('wood', 0.15, 2.6, 1.2, x0 - 0.8, 0, cz - 1.0, 0.8, false);
  // Portico on reused columns.
  for (let i = 0; i < 4; i++) column(b, x0 - 3.6, 0, az0 + 2 + i * ((az1 - az0 - 4) / 3), 4.0, 0.25, 0);
  leanTo(b, az1 - az0 + 0.6, 3.8, 5.0, 4.1, x0 - 1.9, cz, -Math.PI / 2);
  bracketLantern(b, x0 - 0.5, 2.4, cz - 2.2, -Math.PI / 2);
  bracketLantern(b, x0 - 0.5, 2.4, cz + 2.2, -Math.PI / 2);
  // East end: a wall with the apse arch, then the apse.
  b.geo('brick', arcadeGeo(az1 - az0, H, T, 1, 7, 5.5), x1, 0, cz, Math.PI / 2);
  const ar = 3.8;
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI;
    b.box('brick', 1.4, 8.5, T, x1 + Math.cos(a) * ar, 0, cz + Math.sin(a) * ar, Math.PI / 2 - a);
  }
  b.geo('roof', new THREE.ConeGeometry(ar + 0.8, 2.2, 20, 2, false, 0, Math.PI), x1, 8.5 + 1.1, cz);
  for (const a of [-0.6, 0, 0.6]) b.box('iron', 0.5, 1.5, 0.5, x1 + Math.cos(a) * (ar + 0.1), 4.5, cz + Math.sin(a) * (ar + 0.1), Math.PI / 2 - a, false);
  // Interior: slab floor, chancel screen of carved marble plutei, altar under a ciborium.
  b.box('slab', L + ar, 0.06, az1 - az0 - 2 * T, cx + ar / 2, 0, cz, 0, false);
  for (const s of [-1, 1]) b.box('marble', 0.18, 1.0, 2.6, x1 - 4, 0, cz + s * 2.0);
  b.box('slab', 4.2, 0.3, az1 - az0 - 2, x1 - 2, 0, cz, 0, true);
  const ax = x1 + 0.8;
  b.box('marble', 1.0, 1.05, 1.8, ax, 0.3, cz);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) column(b, ax + dx * 1.1, 0.3, cz + dz * 1.4, 3.2, 0.12, 0);
  b.box('marble', 2.8, 0.45, 3.4, ax, 3.5, cz);
  pyramidRoof(b, 3.0, 1.2, ax, 3.95, cz);
  for (let i = 0; i < 4; i++) candle(b, ax - 0.25 + (i % 2) * 0.5, 1.35, cz - 0.6 + Math.floor(i / 2) * 1.2, 0.4);
  // Polykandela down the nave.
  for (let i = 0; i < 3; i++) polykandelon(b, x0 + 6 + i * 8, 4.2, cz, H, 10);
  torch(b, x0 + 0.5, 3.0, az0 + 1.0, Math.PI / 2);
  torch(b, x0 + 0.5, 3.0, az1 - 1.0, Math.PI / 2);
  // Campanile (later than our date, but the silhouette is the place).
  const bx = -12, bz = -57, bh = 21;
  b.box('brick', 5, bh - 4, 5, bx, -0.2, bz);
  for (const r of [0, Math.PI / 2]) {
    b.geo('brick', arcadeGeo(5, 3.6, 5, 2, 0.9, 1.9), bx, bh - 4.2, bz, r);
  }
  b.box('brick', 5.4, 0.4, 5.4, bx, bh - 0.6, bz);
  pyramidRoof(b, 5.4, 2.0, bx, bh - 0.2, bz);
}

function cloister(b: Builder) {
  const x0 = -27, x1 = -5, z0 = -35, z1 = -15, H = 5.2, g = 3;
  b.box('rubble', x1 - x0, H, 0.8, (x0 + x1) / 2, -0.2, z1);
  b.box('rubble', 0.8, H, z1 - z0, x0, -0.2, (z0 + z1) / 2);
  b.box('rubble', (x1 - x0 - 2.5) / 2, H, 0.8, x0 + (x1 - x0 - 2.5) / 4, -0.2, z0);
  b.box('rubble', (x1 - x0 - 2.5) / 2, H, 0.8, x1 - (x1 - x0 - 2.5) / 4, -0.2, z0);
  b.box('rubble', 0.8, H, (z1 - z0 - 2.5) / 2, x1, -0.2, z0 + (z1 - z0 - 2.5) / 4);
  b.box('rubble', 0.8, H, (z1 - z0 - 2.5) / 2, x1, -0.2, z1 - (z1 - z0 - 2.5) / 4);
  // Arcades on paired marble colonnettes.
  const ix0 = x0 + g, ix1 = x1 - g, iz0 = z0 + g, iz1 = z1 - g;
  const lx = ix1 - ix0, lz = iz1 - iz0;
  for (const zz of [iz0, iz1]) arcade(b, 'brick', lx + 0.5, 3.6, 0.5, 7, 1.7, 2.0, (ix0 + ix1) / 2, 0.5, zz, 0);
  for (const xx of [ix0, ix1]) arcade(b, 'brick', lz + 0.5, 3.6, 0.5, 6, 1.7, 2.0, xx, 0.5, (iz0 + iz1) / 2, Math.PI / 2);
  b.box('marble', lx + 0.6, 0.55, 0.6, (ix0 + ix1) / 2, -0.05, iz0);
  b.box('marble', lx + 0.6, 0.55, 0.6, (ix0 + ix1) / 2, -0.05, iz1);
  b.box('marble', 0.6, 0.55, lz + 0.6, ix0, -0.05, (iz0 + iz1) / 2);
  b.box('marble', 0.6, 0.55, lz + 0.6, ix1, -0.05, (iz0 + iz1) / 2);
  leanTo(b, x1 - x0, g, H, 4.1, (x0 + x1) / 2, (z1 + iz1) / 2, Math.PI);
  leanTo(b, x1 - x0, g, H, 4.1, (x0 + x1) / 2, (z0 + iz0) / 2, 0);
  leanTo(b, z1 - z0 - 2 * g, g, H, 4.1, (x0 + ix0) / 2, (z0 + z1) / 2, Math.PI / 2);
  leanTo(b, z1 - z0 - 2 * g, g, H, 4.1, (x1 + ix1) / 2, (z0 + z1) / 2, -Math.PI / 2);
  for (const [x, z] of [[ix0, iz0], [ix1, iz0], [ix0, iz1], [ix1, iz1]]) {
    hornLantern(b, x + Math.sign((x0 + x1) / 2 - x) * -1.5, 3.1, z + Math.sign((z0 + z1) / 2 - z) * -1.5);
  }
  well(b, (x0 + x1) / 2, (z0 + z1) / 2 + 3);
  deadTree(b, (x0 + x1) / 2 - 3, (z0 + z1) / 2 - 3, 5);
}

/** The library: a heavy square tower of reused Roman masonry with four corner turrets. */
function turris(b: Builder, cx: number, cz: number) {
  const S = 14, H = 18;
  b.box('brick', S, H, S, cx, -0.3, cz);
  b.box('rubble', S + 0.05, 4, S + 0.05, cx, H - 4.3, cz);
  pyramidRoof(b, S + 1, 3, cx, H - 0.3, cz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tx = cx + sx * S / 2, tz = cz + sz * S / 2;
    b.box('brick', 4.4, H + 4, 4.4, tx, -0.3, tz);
    pyramidRoof(b, 4.9, 2.2, tx, H + 3.7, tz);
    const lit = rand() < 0.5;
    b.box(lit ? 'window' : 'iron', 0.5, 1.2, 0.3, tx + sx * 2.22, H + 1, tz, Math.PI / 2, false);
  }
  for (const [ox, oz, r] of [[1, 0, Math.PI / 2], [-1, 0, Math.PI / 2], [0, 1, 0], [0, -1, 0]] as const) {
    for (let i = -1; i <= 1; i++) for (const y of [6, 11, 15]) {
      const lit = y > 14 && rand() < 0.4;
      const px = cx + ox * (S / 2 + 0.05) + (oz !== 0 ? i * 3.2 : 0);
      const pz = cz + oz * (S / 2 + 0.05) + (ox !== 0 ? i * 3.2 : 0);
      b.box(lit ? 'window' : 'iron', 0.5, 1.3, 0.2, px, y, pz, r, false);
      if (lit && rand() < 0.5) b.lamp('window', v(px + ox * 1.2, y + 0.8, pz + oz * 1.2));
    }
  }
  b.geo('marble', arcadeGeo(3.4, 3.6, 0.5, 1, 1.6, 1.9), cx - S / 2 - 0.25, -0.2, cz, Math.PI / 2);
  b.box('wood', 0.2, 2.6, 1.6, cx - S / 2 + 0.1, -0.2, cz);
  torch(b, cx - S / 2 - 0.05, 3.0, cz - 2.2, -Math.PI / 2);
  torch(b, cx - S / 2 - 0.05, 3.0, cz + 2.2, -Math.PI / 2);
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

function grid(x0: number, x1: number, step: number, y: number, skip: (cx: number, cz: number) => boolean) {
  const n = Math.round((x1 - x0) / step);
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const nor = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j * (n + 1) + i) * 3;
    pos[k] = x0 + i * step; pos[k + 1] = y; pos[k + 2] = x0 + j * step;
    nor[k + 1] = 1;
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (skip(x0 + (i + 0.5) * step, x0 + (j + 0.5) * step)) continue;
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function ground(b: Builder) {
  const IN = 100;
  const hx0 = STAIR_X - STAIR_W / 2, hx1 = STAIR_X + STAIR_W / 2;
  b.add(grid(-IN, IN, 0.5, 0, (x, z) => x > hx0 && x < hx1 && z < STAIR_TOP && z > HOLE_END), 'ground', undefined, true, true);
  b.add(grid(-400, 400, 4, -0.04, (x, z) => Math.abs(x) < IN && Math.abs(z) < IN), 'ground', undefined, true, true);
}

// ---------------------------------------------------------------- catacombs

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
    if (rand() > 0.24) continue;
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
  b.lamps.push({ pos: v(lx, DEPTH + 1.6, lz), color: new THREE.Color(0.35, 0.6, 1.0), intensity: 0.3, under: true, seed: 3 });
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
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2, r = R(WALL_R + 12, 170);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x) < 18 && z > 0) continue;
    deadTree(b, x, z, R(4, 9));
  }
  // The aqueduct, long dry, striding in from the hills; whole spans have fallen.
  const a0 = new THREE.Vector2(70, -62), a1 = new THREE.Vector2(200, -150);
  const dir = a1.clone().sub(a0);
  const len = dir.length();
  dir.normalize();
  const ry = Math.atan2(dir.x, dir.y) - Math.PI / 2;
  const bay = 6;
  for (let s = 0; s * bay * 3 < len; s++) {
    if (s % 4 === 2) {
      // A collapsed run: stumps of piers and a scatter of blocks.
      for (let k = 0; k < 3; k++) {
        const p = a0.clone().addScaledVector(dir, s * bay * 3 + k * bay);
        b.box('brick', 2.2, R(1, 4), 2.2, p.x, -0.3, p.y, ry);
      }
      continue;
    }
    const p = a0.clone().addScaledVector(dir, s * bay * 3 + bay * 1.5);
    const h = 11 + s * 0.6;
    b.geo('brick', arcadeGeo(bay * 3 + 0.4, h * 0.75, 2.2, 3, bay - 2, h * 0.5), p.x, -0.4, p.y, ry);
    ruin(b, 'brick', bay * 3 + 0.4, h * 0.25, 2.2, p.x, -0.45 + h * 0.75, p.y, ry, s % 3 === 1 ? 0.8 : 0.3);
  }
  // Necropolis along the road south of the gate: tombs, cippi, sarcophagi.
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 98 + i * 4.5 + R(-1, 1);
    const x = side * R(8, 15);
    const kind = rand();
    if (kind < 0.3) {
      const r = R(2.2, 3.4), h = R(2.5, 4.5);
      b.geo('brick', new THREE.CylinderGeometry(r, r * 1.03, h, 24, 4), x, h / 2 - 0.3, z);
      b.geo('ground', new THREE.ConeGeometry(r * 1.02, r * 0.7, 24, 2), x, h - 0.3 + r * 0.35, z);
      b.box('marble', 1.4, 0.9, 0.2, x - side * r, 1.0, z, Math.PI / 2, false);
    } else if (kind < 0.6) {
      b.box('marble', 1.0, 0.85, 2.2, x, -0.1, z, R(-0.2, 0.2) + Math.PI / 2 * (rand() < 0.5 ? 1 : 0));
      b.box('marble', 1.1, 0.25, 2.3, x + R(-0.3, 0.3), 0.75, z + R(-0.4, 0.4), R(-0.4, 0.4), true, R(-0.1, 0.1));
    } else if (kind < 0.85) {
      b.box('marble', 0.55, R(0.9, 1.6), 0.4, x, -0.15, z, R(-0.3, 0.3), true, R(-0.12, 0.12), R(-0.12, 0.12));
    } else {
      ruin(b, 'brick', R(3, 5), R(2.5, 4), R(3, 4), x, -0.2, z, R(0, 3), 0.6);
    }
    if (i === 5) lucerna(b, x, 0.75, z, 0);
  }
  brazier(b, 6, 106);
}

export const SPAWN = new THREE.Vector3(0, 1.7, 124);

export function regionName(p: THREE.Vector3): string {
  if (p.y < -2) return 'Catacumbae';
  const r = Math.hypot(p.x, p.z);
  if (r > WALL_R + 3) return p.z > 90 && Math.abs(p.x) < 20 ? 'Via Sepulcrorum' : 'Extra Muros';
  if (p.z > WALL_R - 10 && Math.abs(p.x) < 10) return 'Porta Romana';
  if (p.x > 10 && p.x < 38 && p.z > -4 && p.z < 26) return 'Forum Vetus';
  if (p.x > -54 && p.x < -38 && p.z > 22 && p.z < 38) return 'Arcus';
  if (p.x > -46 && p.x < 48 && p.z > -66 && p.z < -8) {
    if (p.x > -20 && p.x < 18 && p.z > -53 && p.z < -37) return 'Basilica';
    if (p.x > -27 && p.x < -5 && p.z > -35 && p.z < -15) return 'Claustrum';
    if (p.x > -41 && p.x < -31 && p.z > -60 && p.z < -49) return 'Ossuarium';
    if (p.x > 24 && p.x < 46 && p.z > -34 && p.z < -12) return 'Turris Librorum';
    if (p.z < -55) return 'Coemeterium';
    return 'Monasterium';
  }
  if (Math.abs(p.x) < 4 || Math.abs(p.z - 30) < 4) return Math.abs(p.x) < 4 ? 'Cardo' : 'Decumanus';
  return 'Civitas';
}
