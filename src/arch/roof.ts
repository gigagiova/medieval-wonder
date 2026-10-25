import * as THREE from 'three';
import type { Builder } from '../builder';
import type { MatName } from '../materials';
import { Acc, R, chance, coppo } from './kit';
import { DETAIL } from '../builder';

// Low Italian roofs of coppi: a sagging boarded underlay, real half-round
// cover tiles laid in courses down the slope (tapered, each course lapping the
// next), a ridge of bigger coppi, rafter ends under ragged eaves, purlins
// poking out of the gables, now and then a missing tile or a smoke louvre.

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export interface RoofOpts {
  /** Distance between cover-tile rows and course length: bigger = cheaper. */
  pitch?: number;
  course?: number;
  smoke?: boolean;
  gableMat?: MatName | null;
  /** Wooden shingles (*scandulae*) in lapped courses instead of coppi. */
  shingle?: boolean;
  /** Extra sag of the ridge (old, tired roofs). */
  sag?: number;
}

/**
 * Gable roof over a w (along the ridge, local x) × d footprint, ridge height hr
 * above y, centred at (x, z), rotated ry (same convention as Builder.box).
 */
export function tiledGable(b: Builder, acc: Acc, w: number, d: number, hr: number, x: number, y: number, z: number, ry: number, over = 0.45, o: RoofOpts = {}) {
  const X = v3(Math.cos(ry), 0, -Math.sin(ry)), Z = v3(Math.sin(ry), 0, Math.cos(ry)), Y = v3(0, 1, 0);
  const P = (lx: number, ly: number, lz: number) => v3(x + X.x * lx + Z.x * lz, y + ly, z + X.z * lx + Z.z * lz);
  const run = d / 2 + over;
  const tanA = hr / (d / 2);
  const W = w + over * 1.2;
  const sag = R(0.03, 0.12) + (o.sag ?? 0);
  const top = (lx: number, lz: number) => hr + 0.14 - tanA * Math.abs(lz) - sag * Math.sin(Math.PI * THREE.MathUtils.clamp((lx + W / 2) / W, 0, 1)) * (1 - Math.abs(lz) / run * 0.6);
  // Gable-end walls.
  if (o.gableMat !== null) {
    const s = new THREE.Shape();
    s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, hr); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    b.geo(o.gableMat ?? 'rubble', g, x, y, z, ry + Math.PI / 2, false);
  }
  const pitch = o.pitch ?? 0.34, course = o.course ?? 0.46;
  const nx = Math.max(2, Math.round(W / 0.9));
  for (const s of [-1, 1]) {
    // Underlay: a slab grid that sags, 0.1 thick, with a ragged eave line.
    const nz = Math.max(2, Math.round(run / 1.1));
    const eave: number[] = [];
    for (let i = 0; i <= nx; i++) eave.push(run + R(-0.08, 0.06));
    const pt = (i: number, k: number, dy: number) => {
      const lx = -W / 2 + (W * i) / nx, lz = s * (eave[i] * k) / nz;
      return P(lx, top(lx, lz) - 0.06 + dy, lz);
    };
    const inside = P(0, -5, 0);
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      acc.quad(o.shingle ? 'wood' : 'roof', pt(i, k, 0), pt(i + 1, k, 0), pt(i + 1, k + 1, 0), pt(i, k + 1, 0), inside);
      acc.quad('wood', pt(i, k, -0.1), pt(i + 1, k, -0.1), pt(i + 1, k + 1, -0.1), pt(i, k + 1, -0.1), P(0, 10, 0));
    }
    for (let i = 0; i < nx; i++) acc.quad('wood', pt(i, nz, 0), pt(i + 1, nz, 0), pt(i + 1, nz, -0.1), pt(i, nz, -0.1), P(0, top(0, 0) - 0.3, 0));
    if (o.shingle) {
      // Shingles: courses of split boards lapping down the slope, each course
      // a run of boards of uneven length with a ragged butt edge.
      const crs = 0.3;
      const nCr = Math.max(2, Math.round(run / crs));
      for (let k = 0; k < nCr; k++) {
        const z0 = s * (run * k) / nCr, z1 = s * Math.min(run, (run * (k + 1)) / nCr + 0.08);
        for (let lx = -W / 2; lx < W / 2 - 0.05;) {
          const bw = Math.min(W / 2 - lx, R(0.5, 1.4));
          const a = lx + 0.01, c = lx + bw - 0.01;
          const dz = s * R(-0.04, 0.03);
          const ya = (x: number, z: number) => top(x, z) - 0.05;
          if (!DETAIL.mid) acc.hexa('wood', [P(a, ya(a, z0), z0), P(c, ya(c, z0), z0), P(c, ya(c, z1 + dz) , z1 + dz), P(a, ya(a, z1 + dz), z1 + dz),
            P(a, ya(a, z0) + 0.025, z0), P(c, ya(c, z0) + 0.025, z0), P(c, ya(c, z1 + dz) + 0.045, z1 + dz), P(a, ya(a, z1 + dz) + 0.045, z1 + dz)], true);
          lx += bw;
        }
      }
    }
    // Cover tiles, row by row.
    const up = v3(), side = X;
    for (let lx = -W / 2 + R(0.1, 0.25); lx < W / 2 - 0.1 && !o.shingle; lx += pitch + R(-0.02, 0.02)) {
      const len = run + R(-0.1, 0.05);
      const nC = Math.max(1, Math.round(Math.hypot(len, len * tanA) / course));
      for (let k = 0; k < nC; k++) {
        if (chance(0.025)) continue;
        const z0 = s * (len * k) / nC - s * 0.03, z1 = s * (len * (k + 1)) / nC;
        const lift = 0.025;
        const p0 = P(lx, top(lx, z0) + lift, z0), p1 = P(lx, top(lx, z1) + 0.005, z1);
        up.set(0, 1, 0).addScaledVector(Z, s * tanA).normalize();
        coppo(acc, 'roof', p0, p1, up, side, 0.088, 0.072);
      }
    }
    // Rafter ends under the eave.
    for (let lx = -w / 2 + R(0.1, 0.3); lx < w / 2; lx += R(0.45, 0.6)) {
      const zIn = s * (d / 2 - 0.05), zOut = s * (run - R(0.02, 0.12));
      const yIn = top(lx, zIn) - 0.17, yOut = top(lx, zOut) - 0.17;
      const c = [P(lx - 0.045, yIn - 0.05, zIn), P(lx + 0.045, yIn - 0.05, zIn), P(lx + 0.045, yOut - 0.05, zOut), P(lx - 0.045, yOut - 0.05, zOut),
        P(lx - 0.045, yIn + 0.06, zIn), P(lx + 0.045, yIn + 0.06, zIn), P(lx + 0.045, yOut + 0.06, zOut), P(lx - 0.045, yOut + 0.06, zOut)];
      acc.hexa('wood', c);
    }
  }
  // Ridge: bigger coppi along the top.
  const nR = Math.max(2, Math.round(W / 0.42));
  if (o.shingle) {
    // A capping board on each side of the ridge.
    for (const sd of [-1, 1]) acc.hexa('wood', [P(-W / 2, top(-W / 2, 0), 0), P(W / 2, top(W / 2, 0), 0), P(W / 2, top(W / 2, sd * 0.22) + 0.01, sd * 0.22), P(-W / 2, top(-W / 2, sd * 0.22) + 0.01, sd * 0.22),
      P(-W / 2, top(-W / 2, 0) + 0.07, 0), P(W / 2, top(W / 2, 0) + 0.07, 0), P(W / 2, top(W / 2, sd * 0.22) + 0.06, sd * 0.22), P(-W / 2, top(-W / 2, sd * 0.22) + 0.06, sd * 0.22)], true);
  }
  for (let i = 0; i < nR && !o.shingle; i++) {
    const a = -W / 2 + (W * i) / nR - 0.03, c = -W / 2 + (W * (i + 1)) / nR;
    coppo(acc, 'roof', P(a, top(a, 0) + 0.04, 0), P(c, top(c, 0) + 0.02, 0), Y, Z, 0.12, 0.105);
  }
  // Purlins and the ridge beam poking out of both gables.
  for (const ex of [-1, 1]) {
    for (const lz of [0, -d * 0.27, d * 0.27]) {
      if (lz !== 0 && chance(0.4)) continue;
      const yb = top(ex * W / 2, lz) - 0.22;
      const x0 = ex * (w / 2 - 0.1), x1 = ex * (W / 2 - R(0, 0.12));
      acc.hexa('wood', [P(x0, yb - 0.08, lz - 0.08), P(x1, yb - 0.08, lz - 0.08), P(x1, yb - 0.08, lz + 0.08), P(x0, yb - 0.08, lz + 0.08),
        P(x0, yb + 0.08, lz - 0.08), P(x1, yb + 0.08, lz - 0.08), P(x1, yb + 0.08, lz + 0.08), P(x0, yb + 0.08, lz + 0.08)]);
    }
  }
  // Smoke louvre: a little tiled hood astride the ridge.
  if (o.smoke) {
    const lx = R(-w / 4, w / 4), hw = 0.35;
    for (const s of [-1, 1]) {
      const z0 = s * 0.05, z1 = s * 0.55;
      acc.quad('roof', P(lx - hw, top(lx, 0) + 0.45, z0), P(lx + hw, top(lx, 0) + 0.45, z0), P(lx + hw, top(lx, 0) + 0.25, z1), P(lx - hw, top(lx, 0) + 0.25, z1), P(lx, top(lx, 0), 0));
    }
    for (const ex of [-1, 1]) acc.hexa('wood', [P(lx + ex * hw - 0.04, top(lx, 0), -0.04), P(lx + ex * hw + 0.04, top(lx, 0), -0.04), P(lx + ex * hw + 0.04, top(lx, 0), 0.04), P(lx + ex * hw - 0.04, top(lx, 0), 0.04),
      P(lx + ex * hw - 0.04, top(lx, 0) + 0.45, -0.04), P(lx + ex * hw + 0.04, top(lx, 0) + 0.45, -0.04), P(lx + ex * hw + 0.04, top(lx, 0) + 0.45, 0.04), P(lx + ex * hw - 0.04, top(lx, 0) + 0.45, 0.04)]);
  }
}

/** Single-pitch tiled roof falling towards local +z (porticoes, lean-tos, pentices). */
export function tiledLeanTo(acc: Acc, len: number, run: number, hHigh: number, hLow: number, x: number, z: number, ry: number, pitch = 0.34) {
  const X = v3(Math.cos(ry), 0, -Math.sin(ry)), Z = v3(Math.sin(ry), 0, Math.cos(ry));
  const P = (lx: number, ly: number, lz: number) => v3(x + X.x * lx + Z.x * lz, ly, z + X.z * lx + Z.z * lz);
  const z0 = -run / 2, z1 = run / 2;
  const yAt = (lz: number) => hHigh + (hLow - hHigh) * (lz - z0) / (z1 - z0);
  const inside = P(0, yAt(0) - 4, 0);
  acc.quad('roof', P(-len / 2, yAt(z0), z0), P(len / 2, yAt(z0), z0), P(len / 2, yAt(z1), z1), P(-len / 2, yAt(z1), z1), inside);
  acc.quad('wood', P(-len / 2, yAt(z0) - 0.08, z0), P(len / 2, yAt(z0) - 0.08, z0), P(len / 2, yAt(z1) - 0.08, z1), P(-len / 2, yAt(z1) - 0.08, z1), P(0, yAt(0) + 4, 0));
  const up = v3(0, 1, 0).addScaledVector(Z, (hHigh - hLow) / run).normalize();
  const nC = Math.max(1, Math.round(Math.hypot(run, hHigh - hLow) / 0.46));
  for (let lx = -len / 2 + 0.15; lx < len / 2 - 0.1; lx += pitch + R(-0.02, 0.02)) {
    for (let k = 0; k < nC; k++) {
      const a = z0 + (run * k) / nC - 0.03, c = z0 + (run * (k + 1)) / nC + R(-0.03, 0.03) * (k === nC - 1 ? 1 : 0);
      coppo(acc, 'roof', P(lx, yAt(a) + 0.03, a), P(lx, yAt(c) + 0.005, c), up, X, 0.085, 0.07);
    }
  }
}
