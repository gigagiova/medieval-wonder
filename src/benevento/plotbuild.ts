import * as THREE from 'three';
import { rng, DETAIL, type Builder } from '../builder';
import type { MatName } from '../materials';
import { Acc, reseedKit } from '../arch/kit';
import { tiledGable, tiledLeanTo } from '../arch/roof';
import { ruin, reseedShapes } from '../shapes';
import type { P2 } from './geo';
import type { PlotPlan, Hut } from './plotfill';

// Geometry for the open cells' plans (plotfill.ts). Plain, untessellated boxes for the many
// small things (beds, stakes, fences, logs: 12 triangles each); the kit's shingled roofs on the
// huts; the ruins' jagged walls. Collision only for what one cannot walk through.

/** A plain box standing on y (12 triangles). */
function flat(b: Builder, m: MatName, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, collide = false, rx = 0, rz = 0) {
  b.geo(m, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry, collide, rx, rz, true);
}

export function buildPlan(b: Builder, plan: PlotPlan, seed = 1) {
  const r = rng(seed * 7 + 3);
  const R = (a: number, c: number) => a + (c - a) * r();
  const coll = b.mode === 'collide';
  const fol = new Foliage(r);
  for (const h of plan.huts) hut(b, h);
  for (const w of plan.ruins) {
    reseedShapes(Math.floor(w.x * 131 + w.z * 17));
    ruin(b, w.brick ? 'brick' : 'rubble', w.L, w.h, 0.62, w.x, -0.3, w.z, w.ry, 0.55, w.open, w.open ? 1.5 : 0);
  }
  for (const s of plan.stacks) {
    // A haystack round a pole: a bulging drum of straw under a pointed top, ragged at the edges.
    if (coll) { b.geo('straw', new THREE.CylinderGeometry(s.r, s.r, s.h * 0.6, 8, 1), s.x, s.h * 0.3 - 0.1, s.z, 0, true, 0, 0, true); continue; }
    b.geo('straw', haystack(s.r, s.h, r), s.x, -0.12, s.z, R(0, 3), false, 0, 0, true);
    flat(b, 'wood', 0.08, s.h + 0.7, 0.08, s.x, -0.1, s.z, 0, false, R(-0.04, 0.04));
  }
  if (plan.kiln) kiln(b, plan.kiln.x, plan.kiln.z, plan.kiln.ry, R);
  for (const p of plan.pens) wattle(b, p, 1.15, R);
  if (coll) return;
  // Dug beds: ridges of turned earth.
  for (const row of plan.beds) {
    const L = Math.hypot(row.b[0] - row.a[0], row.b[1] - row.a[1]);
    if (L < 1) continue;
    const ry = Math.atan2(row.b[0] - row.a[0], row.b[1] - row.a[1]);
    const mx = (row.a[0] + row.b[0]) / 2, mz = (row.a[1] + row.b[1]) / 2;
    flat(b, 'ground', 0.95, 0.22, L, mx, -0.08, mz, ry);
    // Boards along the bed's sides (the beds of the period's garden plans are edged and
    // walked between: the St Gall plan, c. 820).
    const cx = Math.cos(ry), sx = Math.sin(ry);
    for (const sd of [-0.5, 0.5]) flat(b, 'wood', 0.05, 0.2, L, mx + cx * sd, -0.06, mz - sx * sd, ry, false, 0, R(-0.04, 0.04));
    // Winter greens along the ridge (cabbages, beet, leeks): low clumps, now and then a gap.
    if (DETAIL.mid) continue;
    const ex = (row.b[0] - row.a[0]) / L, ez = (row.b[1] - row.a[1]) / L;
    for (let t = 0.3; t < L - 0.2; t += R(0.42, 0.6)) {
      if (r() < 0.12) continue;
      fol.rosette(row.a[0] + ex * t + R(-0.08, 0.08), row.a[1] + ez * t + R(-0.08, 0.08), 0.12, R(0.28, 0.42));
    }
  }
  // Vines on stakes, a pole tied along the row at shoulder height.
  for (const row of plan.vines) {
    const L = Math.hypot(row.b[0] - row.a[0], row.b[1] - row.a[1]);
    if (L < 1.5) continue;
    const ex = (row.b[0] - row.a[0]) / L, ez = (row.b[1] - row.a[1]) / L;
    const ry = Math.atan2(ex, ez);
    flat(b, 'wood', 0.05, 0.05, L + 0.2, (row.a[0] + row.b[0]) / 2, 1.3, (row.a[1] + row.b[1]) / 2, ry, false, R(-0.02, 0.02));
    for (let t = 0; t <= L; t += R(1.25, 1.5)) {
      const x = row.a[0] + ex * t, z = row.a[1] + ez * t;
      flat(b, 'wood', 0.06, 1.55, 0.06, x, -0.2, z, R(0, 3), false, R(-0.05, 0.05), R(-0.05, 0.05));
      // The vine: a gnarled stock leaning to its stake, a cane along the pole.
      flat(b, 'wood', 0.07, 1.25, 0.07, x + ez * 0.12, -0.1, z - ex * 0.12, R(0, 3), false, R(-0.18, 0.18), R(-0.18, 0.18));
      if (r() < 0.6) flat(b, 'wood', 0.03, 0.03, R(0.8, 1.3), x + ex * 0.4, 1.22, z + ez * 0.4, ry + R(-0.2, 0.2), false, R(-0.15, 0.15));
      // The last leaves along the pole.
      if (!DETAIL.mid) for (const k of [0.1, 0.6]) if (r() < 0.8) fol.leaves(x + ex * k, 1.15 + R(-0.1, 0.15), z + ez * k, R(0.3, 0.5), 9);
    }
  }
  // Tussocks of grass and weeds on the unworked ground.
  if (!DETAIL.mid) for (let i = 0; i < plan.tufts.length; i += 3) {
    const s = plan.tufts[i + 2];
    fol.tuft(plan.tufts[i], plan.tufts[i + 1], 0.3 * s, 5 + Math.floor(r() * 3));
  }
  fol.flush(b);
  for (const g of plan.graves) {
    const c = Math.cos(g.ry), s = Math.sin(g.ry);
    if (g.slab) flat(b, 'slab', 0.75, 0.12, 2.0, g.x, -0.04, g.z, g.ry);
    else {
      const m = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      m.scale(0.42, 0.26, 1.0);
      b.geo('ground', m, g.x, -0.05, g.z, g.ry, false, 0, 0, true);
    }
    // A small stone at the head (the west end).
    if (g.marker) flat(b, 'block', 0.36, 0.5, 0.1, g.x - s * 1.05, -0.1, g.z - c * 1.05, g.ry, false, R(-0.08, 0.08));
  }
  if (plan.floor) {
    // A threshing floor: beaten earth ringed and set with flat stones.
    const f = plan.floor;
    b.geo('slab', new THREE.CylinderGeometry(f.r, f.r, 0.14, 22, 1), f.x, 0.0, f.z, R(0, 3), false, 0, 0, true);
    for (let a = 0; a < Math.PI * 2; a += 0.42) flat(b, 'rubble', 1.0, 0.22, 0.34, f.x + Math.cos(a) * (f.r + 0.12), -0.08, f.z + Math.sin(a) * (f.r + 0.12), -a + Math.PI / 2 + R(-0.1, 0.1));
  }
  for (const m of plan.middens) {
    const g = new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(m.r, 0.5, m.r * R(0.7, 1));
    b.geo('ground', g, m.x, -0.1, m.z, R(0, 3), false, 0, 0, true);
    for (let i = 0; i < 3; i++) flat(b, 'wood', 0.05, 0.05, R(0.5, 1.0), m.x + R(-0.5, 0.5), 0.2, m.z + R(-0.5, 0.5), R(0, 3), false, R(-0.4, 0.4));
  }
  for (const w of plan.woodpiles) {
    const c = Math.cos(w.ry), s = Math.sin(w.ry);
    for (let i = 0; i < 10; i++) {
      const row = Math.floor(i / 4), col = i % 4;
      if (row === 2 && col === 3) continue;
      const u = (col - 1.5) * 0.15 + row * 0.07;
      flat(b, 'wood', 0.13, 0.13, R(0.9, 1.1), w.x + c * u, -0.12 + row * 0.13, w.z - s * u, w.ry + R(-0.06, 0.06));
    }
  }
  for (const sp of plan.spoil) {
    // Blocks and broken marble pulled from the ruins, stacked for the builders or the kiln.
    const c = Math.cos(sp.ry), s = Math.sin(sp.ry);
    for (let i = 0; i < 6; i++) {
      const u = R(-0.7, 0.7), v = R(-0.5, 0.5), m: MatName = r() < 0.4 ? 'marble' : 'block';
      flat(b, m, R(0.35, 0.7), R(0.2, 0.35), R(0.3, 0.5), sp.x + c * u + s * v, -0.05 + (i > 3 ? 0.3 : 0), sp.z - s * u + c * v, R(0, 3));
    }
  }
}

/**
 * Untextured foliage built from thin double-sided blades and leaves (no lumps: a solid clump
 * reads as a rock). One geometry per plot; normals lean upwards so the blades take the sky
 * light as grass does rather than going black on their shaded side.
 */
class Foliage {
  private pos: number[] = [];
  private nor: number[] = [];
  constructor(private r: () => number) {}
  private tri(a: number[], b: number[], c: number[]) {
    // both faces; a soft, mostly upward normal
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const sd of [1, -1]) {
      const mx = nx * sd * 0.45, my = Math.abs(ny) * 0.45 + 0.75, mz = nz * sd * 0.45, ml = Math.hypot(mx, my, mz);
      const q = sd > 0 ? [a, b, c] : [a, c, b];
      for (const v of q) { this.pos.push(v[0], v[1], v[2]); this.nor.push(mx / ml, my / ml, mz / ml); }
    }
  }
  /** A tussock: n blades fanning out from one root, up to h tall. */
  tuft(x: number, z: number, h: number, n: number) {
    const r = this.r;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, lean = 0.15 + r() * 0.45, hh = h * (0.55 + 0.45 * r()), w = 0.025 + r() * 0.03;
      const bx = x + Math.cos(a) * 0.05, bz = z + Math.sin(a) * 0.05;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      this.tri([bx - px, -0.03, bz - pz], [bx + px, -0.03, bz + pz], [bx + Math.cos(a) * hh * lean, hh, bz + Math.sin(a) * hh * lean]);
    }
  }
  /** Greens in a bed: a rosette of broad leaves splaying out low. */
  rosette(x: number, z: number, y: number, s: number) {
    const r = this.r, n = 5 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.5, L = s * (0.7 + 0.5 * r()), w = s * 0.32;
      const c = Math.cos(a), sn = Math.sin(a);
      const tip = [x + c * L, y + L * (0.35 + 0.4 * r()), z + sn * L];
      const m1 = [x + c * L * 0.5 - sn * w, y + L * 0.3, z + sn * L * 0.5 + c * w], m2 = [x + c * L * 0.5 + sn * w, y + L * 0.3, z + sn * L * 0.5 - c * w];
      const base = [x, y, z];
      this.tri(base, m1, tip); this.tri(base, tip, m2);
    }
  }
  /** A spray of leaves (on the vines): n small leaves round a point. */
  leaves(x: number, y: number, z: number, s: number, n: number) {
    const r = this.r;
    for (let i = 0; i < n; i++) {
      const cx = x + (r() - 0.5) * s * 1.6, cy = y + (r() - 0.5) * s, cz = z + (r() - 0.5) * s * 1.6;
      const a = r() * Math.PI * 2, t = (r() - 0.5) * 1.2, L = 0.1 + r() * 0.06;
      const ex = Math.cos(a) * L, ez = Math.sin(a) * L, ey = t * L;
      const fx = -Math.sin(a) * L * 0.6, fz = Math.cos(a) * L * 0.6;
      this.tri([cx - ex, cy - ey, cz - ez], [cx + fx, cy + 0.03, cz + fz], [cx + ex, cy + ey, cz + ez]);
      this.tri([cx - ex, cy - ey, cz - ez], [cx + ex, cy + ey, cz + ez], [cx - fx, cy - 0.02, cz - fz]);
    }
  }
  flush(b: Builder) {
    if (!this.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    b.geo('leaf', g, 0, 0, 0, 0, false, 0, 0, true);
    this.pos = []; this.nor = [];
  }
}

/** A haystack: a lathe (bulging drum, pointed top) with every vertex pushed in or out a little. */
function haystack(r0: number, h: number, r: () => number) {
  const prof: THREE.Vector2[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = t * h;
    const rr = t < 0.55 ? r0 * (0.9 + 0.18 * Math.sin((t / 0.55) * Math.PI * 0.8)) : r0 * 1.0 * Math.pow(1 - (t - 0.55) / 0.45, 0.85);
    prof.push(new THREE.Vector2(Math.max(0.02, rr), y));
  }
  const g = new THREE.LatheGeometry(prof, 14);
  const p = g.attributes.position as THREE.BufferAttribute;
  // Weld the seam's jitter: the same push for the same (angle, height) on both sides of the seam.
  const push = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let an = Math.atan2(z, x); if (an < 0) an += Math.PI * 2;
    const k = `${Math.round(an * 100) % 628}|${Math.round(y * 100)}`;
    let f = push.get(k);
    if (f === undefined) { f = 1 + (r() - 0.5) * 0.14; push.set(k, f); }
    p.setXYZ(i, x * f, y + (y > 0.05 && y < h - 0.1 ? (r() - 0.5) * 0.06 : 0), z * f);
  }
  g.computeVertexNormals();
  return g;
}

/** A timber hut (plank walls, shingled gable), a sunken-floored hut (low walls under a steep roof) or an open shed. */
function hut(b: Builder, h: Hut) {
  reseedKit(h.seed);
  const r = rng(h.seed + 5);
  const R = (a: number, c: number) => a + (c - a) * r();
  const c = Math.cos(h.ry), s = Math.sin(h.ry);
  const at = (u: number, v: number): P2 => [h.x + c * u + s * v, h.z - s * u + c * v];
  const T = 0.14;
  const wall = (u: number, v: number, L: number, H: number, along: boolean) => {
    const [x, z] = at(u, v);
    flat(b, 'wood', along ? L : T, H, along ? T : L, x, -0.3, z, h.ry, true);
  };
  if (h.kind === 'shed') {
    // Back wall and ends of planks, the front open on posts; a lean-to roof of old tiles.
    // (The back wall goes up to the boards of the roof, as in town.ts's lean-to houses:
    // it stopped short and left the shed open under its high side. docs/HOLES-AUDIT.md)
    const run = h.d + 0.5, under = h.h + 0.75 + (-0.8) * (-h.d / 2 + run / 2) / run - 0.08;
    wall(0, -h.d / 2, h.w, under + 0.3, true);
    wall(-h.w / 2, -h.d / 4, h.d / 2, h.h + 0.5, false);
    wall(h.w / 2, -h.d / 4, h.d / 2, h.h + 0.5, false);
    for (const u of [-h.w / 2 + 0.1, h.w / 2 - 0.1]) { const [x, z] = at(u, h.d / 2 - 0.1); flat(b, 'wood', 0.16, h.h + 0.3, 0.16, x, -0.3, z, h.ry, true); }
    if (b.mode === 'collide') return;
    const acc = new Acc();
    tiledLeanTo(acc, h.w + 0.5, h.d + 0.5, h.h + 0.75, h.h - 0.05, h.x, h.z, h.ry, 0.5);
    acc.flush(b);
    // A manger along the back wall.
    const [mx, mz] = at(0, -h.d / 2 + 0.45);
    flat(b, 'wood', h.w * 0.6, 0.45, 0.5, mx, 0.1, mz, h.ry);
    return;
  }
  const H = h.h;
  const door = R(-h.w / 4, h.w / 4), dw = 0.9;
  wall(0, -h.d / 2, h.w, H + 0.3, true);
  wall(-h.w / 2, 0, h.d, H + 0.3, false);
  wall(h.w / 2, 0, h.d, H + 0.3, false);
  // The front, with its door.
  const l0 = door - dw / 2 + h.w / 2, l1 = h.w / 2 - door - dw / 2;
  if (l0 > 0.1) wall(-h.w / 2 + l0 / 2, h.d / 2, l0, H + 0.3, true);
  if (l1 > 0.1) wall(h.w / 2 - l1 / 2, h.d / 2, l1, H + 0.3, true);
  if (h.kind === 'sunken') {
    // Above the door, the roof comes down low: a plank lintel.
    const [x, z] = at(door, h.d / 2);
    flat(b, 'wood', dw + 0.3, 0.2, T, x, H - 0.25, z, h.ry, true);
  } else {
    const [x, z] = at(door, h.d / 2);
    flat(b, 'wood', dw + 0.2, 0.5, T, x, H - 0.5, z, h.ry, true);
  }
  if (b.mode === 'collide') return;
  // Roof: ridge along the long side; steep and reaching low on the sunken hut.
  const acc = new Acc();
  const steep = h.kind === 'sunken' ? 0.75 : 0.5;
  tiledGable(b, acc, h.w, h.d, h.d * steep, h.x, H, h.z, h.ry, h.kind === 'sunken' ? 0.55 : 0.4, { shingle: true, gableMat: 'wood', pitch: 0.6, course: 1.0, seg: 2 });
  acc.flush(b);
  // A smoke hole's soot and a ladder or bench against the wall now and then.
  if (r() < 0.5) { const [x, z] = at(h.w / 2 + 0.25, R(-h.d / 4, h.d / 4)); flat(b, 'wood', 0.4, 0.45, 1.2, x, -0.1, z, h.ry); }
}

/** A lime kiln (calcara): a squat round furnace of rubble, its stoke-hole black, a heap of slaked lime by it. */
function kiln(b: Builder, x: number, z: number, ry: number, R: (a: number, c: number) => number) {
  b.geo('rubble', new THREE.CylinderGeometry(1.6, 1.95, 2.4, 16, 1), x, 0.8, z, ry, true, 0, 0, true);
  if (b.mode === 'collide') return;
  b.geo('iron', new THREE.CylinderGeometry(1.15, 1.15, 0.06, 14, 1), x, 2.01, z, 0, false, 0, 0, true);
  const c = Math.cos(ry), s = Math.sin(ry);
  flat(b, 'iron', 0.75, 0.85, 0.12, x + s * 1.86, -0.1, z + c * 1.86, ry);
  flat(b, 'block', 1.1, 0.25, 0.4, x + s * 1.9, 0.75, z + c * 1.9, ry);
  const lx = x + c * 2.8, lz = z - s * 2.8;
  b.geo('plaster', new THREE.ConeGeometry(0.95, 0.65, 10, 1), lx, 0.22, lz, R(0, 3), false, 0, 0, true);
  for (let i = 0; i < 6; i++) flat(b, 'marble', R(0.3, 0.6), R(0.15, 0.3), R(0.25, 0.45), x - c * 2.6 + R(-0.6, 0.6), -0.05, z + s * 2.6 + R(-0.6, 0.6), R(0, 3));
}

/** Wattle hurdles on stakes round a ring, with a gate gap on its first side. */
function wattle(b: Builder, ring: P2[], h: number, R: (a: number, c: number) => number) {
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], c = ring[(k + 1) % ring.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 0.5) continue;
    const ry = Math.atan2(c[0] - a[0], c[1] - a[1]) - Math.PI / 2;
    const seg = (t0: number, t1: number) => {
      if (t1 - t0 < 0.05) return;
      const tm = (t0 + t1) / 2, len = (t1 - t0) * L;
      flat(b, 'wood', len, h, 0.09, a[0] + (c[0] - a[0]) * tm, -0.1, a[1] + (c[1] - a[1]) * tm, ry, true, 0, R(-0.03, 0.03));
      if (b.mode === 'collide') return;
      for (let sd = 0; sd <= len; sd += R(1.1, 1.5)) {
        const t = t0 + sd / L;
        flat(b, 'wood', 0.07, h + 0.25, 0.07, a[0] + (c[0] - a[0]) * t, -0.2, a[1] + (c[1] - a[1]) * t, R(0, 3), false, R(-0.06, 0.06), R(-0.06, 0.06));
      }
    };
    if (k === 0 && L > 2.2) { const g = 1.3 / L, t = 0.5; seg(0, t - g / 2); seg(t + g / 2, 1); } else seg(0, 1);
  }
}
