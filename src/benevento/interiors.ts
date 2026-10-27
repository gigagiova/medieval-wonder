import * as THREE from 'three';
import { Builder, rng } from '../builder';
import type { MatName } from '../materials';
import { arcadeGeo, archRings } from '../shapes';
import { prismWalls } from '../town';
import { Acc } from '../arch/kit';
import { tiledGable } from '../arch/roof';
import { lucerna, candle } from '../lights';
import type { LotData } from './fabric';
import { buildSynagogue, synagogueLayout } from './synagogue';

// Houses you can walk into. A single tall ground-floor room under a plank
// ceiling on beams, an arched door in a thick street wall, beaten-earth
// floor, a hearth, and furnishings by trade: the forge of a smith, a potter's
// kiln, a loom, a baker's oven, a notary's desk, a physician's jars... Each
// holds one thing worth reading (see lore.ts); its spot comes from
// interiorAnchors(), which the main thread also uses to register it.

const V = (x: number, z: number) => new THREE.Vector2(x, z);
export interface IFrame { a: THREE.Vector2; e: THREE.Vector2; inn: THREE.Vector2; L: number; D: number; ry: number; door: number; dw: number; H1: number; T: number }
export function interiorFrame(l: LotData): IFrame {
  const a = V(...l.front!.a), b = V(...l.front!.b);
  const L = a.distanceTo(b);
  const e = b.clone().sub(a).normalize();
  const inn = V(-l.front!.out[0], -l.front!.out[1]);
  const D = Math.min(Math.hypot(l.c[3][0] - l.c[0][0], l.c[3][1] - l.c[0][1]), Math.hypot(l.c[2][0] - l.c[1][0], l.c[2][1] - l.c[1][1]));
  const rand = rng(l.seed + 99);
  const dw = 1.15, door = THREE.MathUtils.clamp(L * (0.3 + rand() * 0.4), 1.0 + dw / 2, L - 1.0 - dw / 2);
  return { a, e, inn, L, D, ry: Math.atan2(-e.y, e.x), door, dw, H1: 3.5, T: 0.55 };
}
/** World x/z at (u along the front, w into the house). */
const at = (f: IFrame, u: number, w: number): [number, number] => [f.a.x + f.e.x * u + f.inn.x * w, f.a.y + f.e.y * u + f.inn.y * w];

/** Where the readable thing is (x, y, z, facing yaw) and where to stand. */
export function interiorAnchors(l: LotData) {
  const f = interiorFrame(l);
  const [x, z] = l.explore?.kind === 'synagoga' ? synagogueLayout(f).read : at(f, f.L - f.T - 0.55, f.D * 0.55);
  const [sx, sz] = at(f, f.door, f.T + 1.2);
  const [ox, oz] = at(f, f.door, -1.6);
  return { read: [x, 0.95, z] as [number, number, number], ry: f.ry, stand: [sx, sz] as [number, number], outside: [ox, oz] as [number, number], door: at(f, f.door, 0) };
}

/** Walls with a door gap, for collision only. */
export function interiorCollider(b: Builder, l: LotData) {
  const f = interiorFrame(l);
  const { L, D, T, H1, ry } = f;
  const wall = (u0: number, u1: number, w0: number, w1: number, h = l.h + 0.3) => {
    const [x, z] = at(f, (u0 + u1) / 2, (w0 + w1) / 2);
    b.box('rubble', Math.abs(u1 - u0), h, Math.abs(w1 - w0), x, -0.3, z, ry);
  };
  wall(0, f.door - f.dw / 2, 0, T);
  wall(f.door + f.dw / 2, L, 0, T);
  { const [x, z] = at(f, f.door, T / 2); b.box('rubble', f.dw, l.h - 2.1, T, x, 2.1, z, ry); }
  wall(0, T, T, D);
  wall(L - T, L, T, D);
  wall(T, L - T, D - T, D);
  // The ceiling stops anyone climbing out through the roof.
  { const [x, z] = at(f, L / 2, D / 2); b.box('wood', L, 0.2, D, x, H1, z, ry); }
  if (l.explore?.kind === 'synagoga') buildSynagogue(b, f, true);
}

const KIND_MATS: Record<string, MatName> = { fabrica: 'rubble', figulina: 'brick', pistrinum: 'brick', oratorium: 'plaster', scola: 'plaster', medicus: 'plaster', synagoga: 'plaster' };

export function buildInterior(b: Builder, l: LotData) {
  const f = interiorFrame(l);
  const rand = rng(l.seed + 7);
  const R = (a: number, c: number) => a + (c - a) * rand();
  const { L, D, T, H1, ry } = f;
  const kind = l.explore!.kind;
  const wm: MatName = KIND_MATS[kind] ?? (rand() < 0.6 ? 'rubble' : 'brick');
  const inner: MatName = rand() < 0.6 ? 'plaster' : wm;
  const box = (m: MatName, w: number, h: number, d: number, u: number, y: number, ww: number, rot = 0, rx = 0, rz = 0) => {
    const [x, z] = at(f, u, ww);
    b.box(m, w, h, d, x, y, z, ry + rot, false, rx, rz);
  };
  // Street wall: solid either side of an arched door.
  const dl = f.door - f.dw / 2 - 0.35, dr = f.door + f.dw / 2 + 0.35;
  box(wm, dl, l.h + 0.3, T, dl / 2, -0.3, T / 2);
  box(wm, L - dr, l.h + 0.3, T, (dr + L) / 2, -0.3, T / 2);
  {
    const [x, z] = at(f, f.door, T / 2);
    b.geo(wm, arcadeGeo(dr - dl, l.h + 0.3, T, 1, f.dw, 1.75), x, -0.3, z, ry, false);
    archRings(b, 'block', x, -0.3, z, ry, T, f.dw, 1.75, 0.34, 0.24);
    box('block', f.dw + 0.4, 0.12, T + 0.25, f.door, -0.1, T / 2);
  }
  // Side and back walls, rendered thick (both faces).
  box(wm, T, l.h + 0.3, D - T, T / 2, -0.3, (D + T) / 2);
  box(wm, T, l.h + 0.3, D - T, L - T / 2, -0.3, (D + T) / 2);
  box(wm, L - 2 * T, l.h + 0.3, T, L / 2, -0.3, D - T / 2);
  // Inner plaster skin, fallen in patches.
  if (inner === 'plaster') {
    box('plaster', 0.05, H1 - 0.2, D - 2 * T - 0.1, T + 0.03, 0, D / 2);
    box('plaster', 0.05, H1 - 0.2, D - 2 * T - 0.1, L - T - 0.03, 0, D / 2);
    box('plaster', L - 2 * T - 0.1, H1 - 0.2, 0.05, L / 2, 0, D - T - 0.03);
  }
  // Ceiling: beams and boards; the storey above is only its outer walls.
  const nb = Math.max(2, Math.round((L - 2 * T) / 1.1));
  for (let i = 0; i < nb; i++) box('wood', 0.2, 0.24, D - 2 * T + 0.3, T + ((i + 0.5) * (L - 2 * T)) / nb, H1 - 0.24, D / 2, R(-0.02, 0.02));
  box('wood', L - 2 * T, 0.08, D - 2 * T, L / 2, H1, D / 2);
  if (l.h > H1 + 0.6) b.add(prismWalls(l.c.map(([x, z]) => V(x, z)), H1, l.h - H1, 0.8), rand() < 0.5 ? 'plaster' : wm, undefined, false, true);
  // Roof.
  {
    const acc = new Acc();
    const [cx, cz] = at(f, L / 2, D / 2);
    tiledGable(b, acc, L + 0.2, D + 0.2, D * 0.22, cx, l.h, cz, ry, 0.4, { gableMat: wm, pitch: 0.4, course: 0.6 });
    acc.flush(b);
  }
  // A small barred window high in the back wall, and a slit beside the door.
  box('iron', 0.5, 0.6, T + 0.05, L * 0.4, 2.3, D - T / 2);
  box('window', 0.22, 0.6, T + 0.04, Math.min(L - 0.5, dr + 0.5), 1.5, T / 2);

  if (kind === 'synagoga') {
    buildSynagogue(b, f);
    return; // Prayer room has its own furnishings, without domestic hearth/bed.
  }

  // Hearth in a back corner: a ring of stones, embers and a pot.
  const hu = T + 0.9, hw = D - T - 0.9;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    box('stone', 0.24, 0.16, 0.18, hu + Math.cos(a) * 0.45, -0.05, hw + Math.sin(a) * 0.45, a);
  }
  box('ember', 0.55, 0.06, 0.55, hu, 0.0, hw);
  { const [x, z] = at(f, hu, hw); b.lamp('torch', new THREE.Vector3(x, 0.15, z), false, 'brazier', 0.55); }
  // Smoke has blackened the plaster above it.
  box('iron', 1.3, 1.6, 0.02, hu, 1.6, D - T - 0.04);

  // Table with the readable thing, bench, shelf, chest, pallet bed.
  const ru = L - T - 0.55, rw = D * 0.55;
  box('wood', 0.9, 0.06, 1.5, ru, 0.82, rw);
  for (const [du, dw] of [[-0.35, -0.6], [0.35, -0.6], [-0.35, 0.6], [0.35, 0.6]]) box('wood', 0.08, 0.82, 0.08, ru + du, 0, rw + dw);
  box('wood', 0.3, 0.45, 1.4, ru - 0.75, 0, rw);
  { const [x, z] = at(f, ru, rw - 0.45); lucerna(b, x, 0.88, z, ry); }
  box('wood', 0.3, 0.05, Math.min(2.2, D - 2 * T - 0.4), T + 0.18, 1.6, D / 2);
  for (let i = 0; i < 4; i++) box('clay', 0.18, R(0.2, 0.32), 0.18, T + 0.18, 1.65, D / 2 - 0.8 + i * 0.5);
  box('wood', 0.9, 0.55, 0.5, L / 2, 0, D - T - 0.3);
  box('iron', 0.94, 0.04, 0.54, L / 2, 0.42, D - T - 0.3);
  if (kind === 'domus' || kind === 'hospitium' || kind === 'scola' || kind === 'medicus') box('cloth', 1.0, 0.18, 1.9, T + 0.6, 0, T + 1.3);

  // By trade.
  const mid = (D - T) / 2 + T / 2;
  switch (kind) {
    case 'fabrica': {
      box('stone', 1.2, 0.9, 1.0, L * 0.35, 0, mid);
      box('ember', 0.7, 0.08, 0.6, L * 0.35, 0.9, mid);
      { const [x, z] = at(f, L * 0.35, mid); b.lamp('brazier', new THREE.Vector3(x, 0.95, z), false, 'brazier', 0.7); }
      box('wood', 0.5, 0.55, 0.5, L * 0.6, 0, mid + 0.4);
      box('iron', 0.55, 0.22, 0.24, L * 0.6, 0.55, mid + 0.4);
      for (let i = 0; i < 5; i++) box('iron', 0.04, R(0.4, 0.7), 0.04, T + 0.08, 1.2, mid - 0.6 + i * 0.25, 0, R(-0.1, 0.1));
      break;
    }
    case 'figulina': {
      const [x, z] = at(f, L * 0.4, mid);
      b.geo('brick', new THREE.SphereGeometry(1.0, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, 0, z, 0, false);
      b.lamp('brazier', new THREE.Vector3(x, 0.3, z), false, 'brazier', 0.5);
      for (let i = 0; i < 8; i++) box('clay', R(0.2, 0.32), R(0.25, 0.45), R(0.2, 0.32), L * 0.7 + R(-0.4, 0.4), 0, T + 0.5 + i * 0.35);
      box('wood', 0.45, 0.7, 0.45, L * 0.6, 0, mid + 0.7);
      break;
    }
    case 'textrinum': {
      box('wood', 0.1, 2.2, 0.1, L * 0.3, 0, mid - 0.8); box('wood', 0.1, 2.2, 0.1, L * 0.3, 0, mid + 0.8);
      box('wood', 0.12, 0.12, 1.8, L * 0.3, 2.1, mid);
      box('cloth', 0.03, 1.6, 1.5, L * 0.3, 0.4, mid, 0, 0.05);
      for (let i = 0; i < 6; i++) box('clay', 0.12, 0.1, 0.12, L * 0.3 + 0.05, 0.25, mid - 0.7 + i * 0.28);
      break;
    }
    case 'pistrinum': {
      const [x, z] = at(f, L * 0.35, mid + 0.4);
      b.geo('brick', new THREE.SphereGeometry(1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, 0.6, z, 0, false);
      box('brick', 2.2, 0.6, 2.2, L * 0.35, 0, mid + 0.4);
      b.lamp('brazier', new THREE.Vector3(x, 0.8, z), false, 'brazier', 0.5);
      box('wood', 0.7, 0.5, 1.8, L * 0.68, 0.3, mid);
      break;
    }
    case 'horreum': {
      for (let i = 0; i < 5; i++) {
        const [x, z] = at(f, T + 0.8 + i * ((L - 2 * T - 1.2) / 4), mid + R(-0.4, 0.4));
        b.geo('ground', new THREE.ConeGeometry(R(0.7, 1.0), R(0.6, 0.9), 12, 2), x, R(0.3, 0.4), z, R(0, 3), false);
      }
      for (let i = 0; i < 6; i++) box('cloth', 0.5, 0.65, 0.4, L - T - 0.4, 0, T + 0.6 + i * 0.5, R(-0.3, 0.3));
      break;
    }
    case 'officina': {
      box('wood', 1.8, 0.85, 0.7, L * 0.45, 0, mid);
      box('bronze', 0.3, 0.05, 0.2, L * 0.45 - 0.4, 0.86, mid);
      box('bronze', 0.12, 0.12, 0.12, L * 0.45 + 0.3, 0.86, mid + 0.1);
      { const [x, z] = at(f, L * 0.45 + 0.6, mid); candle(b, x, 0.86, z, 0.3); }
      box('stone', 0.6, 0.7, 0.6, L * 0.2, 0, mid + 0.5);
      box('ember', 0.35, 0.05, 0.35, L * 0.2, 0.7, mid + 0.5);
      break;
    }
    case 'medicus': {
      for (const y of [0.9, 1.4, 1.9]) {
        box('wood', 0.3, 0.04, D - 2 * T - 0.6, L - T - 0.18, y, mid);
        for (let i = 0; i < 6; i++) box(rand() < 0.5 ? 'clay' : 'horn', 0.12, R(0.12, 0.22), 0.12, L - T - 0.18, y + 0.04, T + 0.6 + i * ((D - 2 * T - 1.2) / 5));
      }
      for (let i = 0; i < 5; i++) box('cloth', 0.08, 0.5, 0.08, L * 0.5 + R(-0.8, 0.8), H1 - 0.75, mid + R(-0.8, 0.8));
      break;
    }
    case 'oratorium': {
      box('marble', 1.0, 0.95, 0.6, L / 2, 0, D - T - 0.4);
      box('wood', 0.7, 0.9, 0.04, L / 2, 1.3, D - T - 0.05);
      { const [x, z] = at(f, L / 2 - 0.3, D - T - 0.45); candle(b, x, 0.95, z, 0.35); }
      { const [x, z] = at(f, L / 2 + 0.3, D - T - 0.45); candle(b, x, 0.95, z, 0.3); }
      break;
    }
    case 'cella': {
      for (let i = 0; i < 4; i++) {
        const [x, z] = at(f, T + 0.5 + i * 0.9, D - T - 0.5);
        b.geo('wood', new THREE.CylinderGeometry(0.38, 0.38, 0.9, 12), x, 0.42, z, 0, false, Math.PI / 2, 0);
      }
      // A trapdoor in the floor, iron-bound.
      box('wood', 1.0, 0.05, 0.8, L * 0.45, 0.0, mid + 0.6);
      box('iron', 1.02, 0.06, 0.06, L * 0.45, 0.0, mid + 0.4);
      box('iron', 0.06, 0.07, 0.12, L * 0.45, 0.03, mid + 0.35);
      break;
    }
    case 'scola': {
      box('wood', 1.2, 0.05, 0.65, L * 0.4, 0.95, mid);
      for (const [du, dw] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) box('wood', 0.06, 0.95, 0.06, L * 0.4 + du, 0, mid + dw);
      for (let i = 0; i < 4; i++) box('bone', 0.22, 0.01, 0.3, L * 0.4 + R(-0.4, 0.4), 1.0 + i * 0.01, mid + R(-0.15, 0.15), R(-0.3, 0.3));
      { const [x, z] = at(f, L * 0.4 + 0.5, mid - 0.2); candle(b, x, 1.0, z, 0.25); }
      break;
    }
    case 'hospitium': {
      for (const ww of [mid - 0.9, mid + 0.9]) {
        box('wood', Math.min(2.6, L - 2 * T - 1.4), 0.07, 0.7, L / 2, 0.8, ww);
        box('wood', Math.min(2.6, L - 2 * T - 1.4), 0.4, 0.28, L / 2, 0, ww - 0.6);
      }
      break;
    }
    default: break;
  }
}
