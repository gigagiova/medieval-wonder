import * as THREE from 'three';
import type { Builder } from './builder';
import { rng } from './builder';
import type { MatName } from './materials';

// Reusable architectural pieces. Everything takes a Builder and world coordinates.
const rand = rng(4242);
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
export function ruinGeo(L: number, h: number, depth: number, jag = 0.5, openW = 0, spring = 0) {
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
  b.geo(m, ruinGeo(L, h, depth, jag, openW, spring), x, y, z, ry);
}

/** Roman column, often reused (spolia): plinth, base torus, tapering shaft, impost capital. */
export function column(b: Builder, x: number, y: number, z: number, h: number, r: number, broken = 0, m: MatName = 'marble') {
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

export function fallenDrum(b: Builder, x: number, z: number, r: number, len: number, ry: number) {
  b.geo('marble', new THREE.CylinderGeometry(r, r * 0.95, len, 16, 2), x, r * 0.92, z, ry, true, 0, Math.PI / 2);
}

/** Low-pitched gable roof of coppi over a w × d footprint (ridge along local x). */
export function gable(b: Builder, w: number, d: number, hr: number, x: number, y: number, z: number, ry: number, wallMat: MatName, over = 0.5) {
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
export function leanTo(b: Builder, len: number, run: number, hHigh: number, hLow: number, x: number, z: number, ry: number) {
  const a = Math.atan2(hHigh - hLow, run);
  b.box('roof', len, 0.18, run / Math.cos(a) + 0.5, x, (hHigh + hLow) / 2 - 0.05, z, ry, true, a);
}

export function pyramidRoof(b: Builder, w: number, h: number, x: number, y: number, z: number) {
  b.geo('roof', new THREE.ConeGeometry(w * 0.74, h, 4, 3), x, y + h / 2, z, Math.PI / 4);
}
