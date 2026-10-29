import { rng } from '../builder';
import type { P2 } from './geo';

// What stood in the open cells of the plan c. AD 700 (docs/benevento/HISTORY.md, "The open
// ground inside the walls"): the plan's large undivided cells and the drawn cells that open on
// the lanes were not empty. Written and excavated evidence from Benevento and the towns
// compared with it (Rome, Naples, Brescia, Rimini) has kitchen gardens, small vineyards, fruit
// and nut trees, pens and sheds for sheep, goats and pigs, timber and sunken-floored huts built
// among and against Roman ruins, roofless Roman walls reused as enclosures, yards where
// spolia were broken up and burned for lime, threshing floors and hay, middens, wells, and
// burials near the churches. This module decides, from a plot's outline and the free ground
// in it, where each of those things stands. It is a pure function of the plot's data (its
// own random stream), so the render worker, the collision pass, the props and the tools all
// see the same plan.

export type PlotKind =
  | 'orto' | 'vinea' | 'pratum' | 'ruina' | 'stabulum' | 'cortis' | 'hortulus'
  | 'pomarium' | 'casalinum' | 'calcaria' | 'coemeterium' | 'area';

export interface PlotInput {
  pts: P2[]; kind: PlotKind; seed: number;
  /** Unwalled: a drawn cell or wide part of the lane spaces that the lanes run through; things keep clear of the way. */
  open?: boolean;
  /** Free ground: x, z, clearance (m to the edge, a lane's way or a house door), on a 1 m grid. */
  free?: number[];
  /** A well of the layout (its ground hole is cut by the chunk) standing in this plot. */
  well?: P2;
  /** For a burial ground: the church it lies beside (graves are laid out from that side). */
  church?: P2;
}

export interface Hut { x: number; z: number; w: number; d: number; ry: number;
  /** 'hut' a timber house with a shingled gable roof; 'sunken' a sunken-floored hut, low walls under a steep roof; 'shed' an open-fronted lean-to. */
  kind: 'hut' | 'sunken' | 'shed'; h: number; seed: number }
export interface Row { a: P2; b: P2 }
export interface PlotPlan {
  huts: Hut[];
  /** Dug beds (ridges of turned earth) along rows. */
  beds: Row[];
  /** Vine rows: stakes along the row and a pole tied across them. */
  vines: Row[];
  /** Fruit and nut trees (drawn by the tree field). */
  trees: { x: number; z: number; s: number }[];
  /** Wattle pens: closed rings with a gap. */
  pens: P2[][];
  stacks: { x: number; z: number; r: number; h: number }[];
  graves: { x: number; z: number; ry: number; slab: boolean; marker: boolean }[];
  /** Roofless Roman walls: centre, length, height, rotation; open = a doorway or breach in the middle. */
  ruins: { x: number; z: number; L: number; h: number; ry: number; open: number; brick: boolean }[];
  kiln?: { x: number; z: number; ry: number };
  floor?: { x: number; z: number; r: number };
  middens: { x: number; z: number; r: number }[];
  woodpiles: { x: number; z: number; ry: number }[];
  /** Spoil: blocks and broken marble stacked for reuse or the kiln. */
  spoil: { x: number; z: number; ry: number }[];
  /** Scanned props (props.ts ids): tools, vessels, a few weeds. */
  props: { id: string; x: number; z: number; ry: number; s: number }[];
  /** Tussocks of grass and weeds on the unworked ground: x, z, size triples. */
  tufts: number[];
}

const empty = (): PlotPlan => ({ huts: [], beds: [], vines: [], trees: [], pens: [], stacks: [], graves: [], ruins: [], middens: [], woodpiles: [], spoil: [], props: [], tufts: [] });

/** The kinds that are given a plan here (courtyards and the small street gardens keep their own fill). */
export const PLANNED: ReadonlySet<PlotKind> = new Set<PlotKind>(['orto', 'vinea', 'pratum', 'ruina', 'stabulum', 'pomarium', 'casalinum', 'calcaria', 'coemeterium', 'area']);

const cache = new Map<number, PlotPlan>();
export function planPlot(p: PlotInput): PlotPlan {
  const key = p.seed * 31 + p.pts.length;
  const hit = cache.get(key);
  if (hit) return hit;
  const plan = makePlan(p);
  if (cache.size > 4000) cache.clear();
  cache.set(key, plan);
  return plan;
}

function makePlan(p: PlotInput): PlotPlan {
  const out = empty();
  if (!PLANNED.has(p.kind) || !p.free || p.free.length < 9) return out;
  const rand = rng(p.seed * 13 + 7);
  const R = (a: number, b: number) => a + (b - a) * rand();
  const F = p.free;
  // Grid lookup of the free points (1 m cells).
  const grid = new Map<number, number>();
  const gk = (x: number, z: number) => (Math.round(x) + 4096) * 8192 + (Math.round(z) + 4096);
  for (let i = 0; i < F.length; i += 3) grid.set(gk(F[i], F[i + 1]), F[i + 2]);
  const taken: { x: number; z: number; r: number }[] = [];
  const clearAt = (x: number, z: number) => {
    const c = grid.get(gk(x, z));
    if (c === undefined) return -1;
    let m = c;
    for (const t of taken) m = Math.min(m, Math.hypot(t.x - x, t.z - z) - t.r);
    return m;
  };
  const area = F.length / 3;
  // The plot's long axis (rows of beds and vines follow it).
  let lx = 0, lz = 0, ll = 0;
  for (let k = 0; k < p.pts.length; k++) {
    const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > ll) { ll = L; lx = (b[0] - a[0]) / L; lz = (b[1] - a[1]) / L; }
  }
  /** Nearest edge of the outline: its point, and the inward direction. */
  const edge = (x: number, z: number) => {
    let best = { d: Infinity, ex: 1, ez: 0, ix: 0, iz: 1 };
    let cx = 0, cz = 0;
    for (const q of p.pts) { cx += q[0] / p.pts.length; cz += q[1] / p.pts.length; }
    for (let k = 0; k < p.pts.length; k++) {
      const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
      if (d < best.d) {
        const L = Math.sqrt(L2);
        let ix = -dz / L, iz = dx / L;
        if (ix * (cx - (a[0] + b[0]) / 2) + iz * (cz - (a[1] + b[1]) / 2) < 0) { ix = -ix; iz = -iz; }
        best = { d, ex: dx / L, ez: dz / L, ix, iz };
      }
    }
    return best;
  };
  /**
   * A free spot for something of radius r. `wall`: against the plot's edge (sheds and huts
   * stood against the yard wall), `centre`: well inside; otherwise anywhere.
   */
  const pick = (r: number, where: 'wall' | 'centre' | 'any' = 'any', tries = 60): { x: number; z: number } | null => {
    const n = F.length / 3;
    let best: { x: number; z: number; s: number } | null = null;
    for (let t = 0; t < tries; t++) {
      const i = Math.floor(rand() * n) * 3, x = F[i], z = F[i + 1];
      const c = clearAt(x, z);
      if (c < r + 0.3) continue;
      const s = where === 'wall' ? -(c - r) + rand() * 0.8 : where === 'centre' ? c + rand() * 2 : rand();
      if (!best || s > best.s) best = { x, z, s };
    }
    if (best) return { x: best.x, z: best.z };
    return null;
  };
  const take = (x: number, z: number, r: number) => taken.push({ x, z, r });

  // ---- a building against the edge
  const hut = (kind: Hut['kind'], w: number, d: number) => {
    const r = Math.hypot(w, d) / 2;
    const s = pick(r, p.open ? 'centre' : 'wall', 90);
    if (!s) return null;
    const e = edge(s.x, s.z);
    // Long side along the edge; the door (local +z) faces into the plot.
    const ry = Math.atan2(e.ix, e.iz);
    const h: Hut = { x: s.x, z: s.z, w, d, ry, kind, h: kind === 'sunken' ? R(0.8, 1.1) : kind === 'shed' ? R(2.1, 2.5) : R(2.2, 2.8), seed: Math.floor(rand() * 1e9) };
    out.huts.push(h);
    take(s.x, s.z, r + 0.6);
    return h;
  };
  const stack = () => { const s = pick(1.8); if (!s) return; const r = R(1.2, 1.6); out.stacks.push({ x: s.x, z: s.z, r, h: R(2.2, 3.2) }); take(s.x, s.z, r + 0.4); };
  const midden = () => { const s = pick(1.4, 'wall'); if (!s) return; const r = R(0.9, 1.4); out.middens.push({ x: s.x, z: s.z, r }); take(s.x, s.z, r + 0.2); };
  const woodpile = (near?: Hut | null) => {
    let s: { x: number; z: number } | null = null;
    if (near) {
      const c = Math.cos(near.ry), sn = Math.sin(near.ry);
      // beside the hut's end wall
      const ox = c * (near.w / 2 + 0.9), oz = -sn * (near.w / 2 + 0.9);
      if (clearAt(near.x + ox, near.z + oz) > 0.6) s = { x: near.x + ox, z: near.z + oz };
    }
    s ??= pick(0.9, 'wall');
    if (!s) return;
    out.woodpiles.push({ x: s.x, z: s.z, ry: near ? near.ry : R(0, 3.14) }); take(s.x, s.z, 0.9);
  };
  const prop = (id: string, x: number, z: number, s: number) => out.props.push({ id, x, z, ry: R(0, 6.28), s });
  const near = (h: Hut | null, ids: string[], n: number) => {
    if (!h) return;
    const c = Math.cos(h.ry), sn = Math.sin(h.ry);
    for (let i = 0; i < n; i++) {
      // in front of the door (local +z), a little to either side
      const u = R(-h.w / 2, h.w / 2), v = h.d / 2 + R(0.5, 1.3);
      const x = h.x + c * u + sn * v, z = h.z - sn * u + c * v;
      if (clearAt(x, z) > 0.2) prop(ids[Math.floor(rand() * ids.length)], x, z, 1);
    }
  };
  const trees = (n: number, room: number, where: 'wall' | 'any' = 'wall') => {
    for (let i = 0; i < n; i++) {
      const s = pick(room, where, 40);
      if (!s) return;
      out.trees.push({ x: s.x, z: s.z, s: R(0.8, 1.15) });
      take(s.x, s.z, room);
    }
  };
  /** Parallel rows across the plot's free ground, `gap` apart, kept `margin` from everything. */
  const rows = (gap: number, margin: number, minLen: number, maxRows = 99): Row[] => {
    const res: Row[] = [];
    const ux = lx, uz = lz, vx = -lz, vz = lx;
    let cx = 0, cz = 0;
    for (let i = 0; i < F.length; i += 3) { cx += F[i]; cz += F[i + 1]; }
    cx /= area; cz /= area;
    const off = rand() * gap;
    for (let v = -80 + off; v < 80 && res.length < maxRows; v += gap) {
      let run: number | null = null, last = 0;
      for (let u = -80; u <= 80.5; u += 0.5) {
        const x = cx + ux * u + vx * v, z = cz + uz * u + vz * v;
        const ok = u <= 80 && clearAt(x, z) >= margin;
        if (ok) { if (run === null) run = u; last = u; }
        else if (run !== null) {
          if (last - run >= minLen) res.push({ a: [cx + ux * run + vx * v, cz + uz * run + vz * v], b: [cx + ux * last + vx * v, cz + uz * last + vz * v] });
          run = null;
        }
      }
    }
    return res;
  };
  const weeds = (n: number, ids = ['weed_plant_02', 'nettle_plant', 'grass_medium_02']) => {
    for (let i = 0; i < n; i++) {
      const s = pick(0.4, 'wall', 12);
      if (s) prop(ids[Math.floor(rand() * ids.length)], s.x, s.z, ids[0].startsWith('grass') ? 0.9 : 2.6);
    }
  };
  /** Tussocks over the free ground not taken by anything, `dens` per m². */
  const tufts = (dens: number) => {
    for (let i = 0; i < F.length; i += 3) {
      if (rand() > dens) continue;
      const x = F[i] + R(-0.5, 0.5), z = F[i + 1] + R(-0.5, 0.5);
      if (clearAt(x, z) < 0.5) continue;
      if (out.beds.length && onRow(x, z)) continue;
      out.tufts.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(R(0.9, 2.0) * 100) / 100);
    }
  };
  const onRow = (x: number, z: number) => out.beds.some((r) => {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - r.a[0]) * dx + (z - r.a[1]) * dz) / L2));
    return Math.hypot(r.a[0] + dx * t - x, r.a[1] + dz * t - z) < 0.7;
  });
  if (p.well) take(p.well[0], p.well[1], 1.6);

  const big = area > 900, mid = area > 380;
  switch (p.kind) {
    case 'orto': {
      // A kitchen garden: dug beds of winter greens (cabbage, leeks, beet), a tool shed
      // against the wall, fruit trees along the edges, a midden for the beds.
      const h = mid && !p.open ? hut('shed', R(3.2, 4.2), R(2.4, 2.9)) : null;
      woodpile(h);
      near(h, ['wooden_bucket_01', 'wicker_basket_02', 'wooden_bucket_02'], 2);
      trees(Math.min(8, Math.floor(area / 180)), 2.6);
      midden();
      out.beds = rows(1.6, 1.0, 2.5, 60);
      tufts(0.08);
      break;
    }
    case 'vinea': {
      // Vines trained on stakes in rows, with a pole tied along each row; a watchman's hut.
      const h = mid ? hut('hut', R(2.6, 3.2), R(2.4, 2.8)) : null;
      near(h, ['wicker_basket_02', 'wine_barrel_01'], 2);
      trees(Math.min(3, Math.floor(area / 500)), 2.4);
      out.vines = rows(2.0, 0.9, 3, 45);
      weeds(4);
      tufts(0.12);
      break;
    }
    case 'pomarium': {
      // An orchard of fruit and nut trees (walnut, fig, plum, apple: the seeds of Naples' dark
      // earth), grass under them, a shed.
      const h = mid && !p.open ? hut('shed', R(3, 3.8), R(2.2, 2.7)) : null;
      woodpile(h);
      trees(Math.min(18, Math.max(2, Math.floor(area / 55))), 3.2, 'any');
      if (big && rand() < 0.6) stack();
      weeds(Math.min(6, Math.floor(area / 160)), ['grass_medium_02', 'weed_plant_02']);
      tufts(0.4);
      break;
    }
    case 'casalinum': {
      // A cluster of timber huts on open ground (the casalini and casaleni of the charters;
      // sunken-floored huts in Brescia and Rome), each with its yard: hearth, woodpile, a
      // wattle-fenced patch of greens, a midden.
      const n = area > 1400 ? 3 : area > 600 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const sunk = rand() < 0.45;
        const h = hut(sunk ? 'sunken' : 'hut', sunk ? R(3.6, 4.6) : R(4.2, 5.6), sunk ? R(3.0, 3.6) : R(3.4, 4.2));
        woodpile(h);
        near(h, ['stone_fire_pit', 'wooden_bucket_01', 'ceramic_pot', 'wicker_basket_02', 'folding_wooden_stool'], 3);
      }
      const g = pick(3.4, 'any');
      if (g) {
        const w = R(4, 6), d = R(3.5, 5), c = Math.cos(R(0, 3.14)), s = Math.sin(Math.acos(c));
        const ring: P2[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [g.x + c * u - s * v, g.z + s * u + c * v]);
        out.pens.push(ring);
        take(g.x, g.z, Math.hypot(w, d) / 2 + 0.3);
        for (let v = -d / 2 + 0.8; v < d / 2 - 0.5; v += 1.1) out.beds.push({ a: [g.x + c * (-w / 2 + 0.6) - s * v, g.z + s * (-w / 2 + 0.6) + c * v], b: [g.x + c * (w / 2 - 0.6) - s * v, g.z + s * (w / 2 - 0.6) + c * v] });
      }
      midden();
      trees(Math.min(3, Math.floor(area / 400)), 2.6);
      weeds(4);
      tufts(0.15);
      break;
    }
    case 'stabulum': {
      // Pens for sheep and goats (which outnumber pigs in Naples' bones of the 6th-8th
      // centuries), an open shed with a manger, hay, the dung heap.
      const h = hut('shed', R(4.5, 6), R(2.8, 3.4));
      near(h, ['wooden_bucket_01', 'wooden_bucket_02', 'wicker_basket_02'], 2);
      const npen = big ? 2 : 1;
      for (let i = 0; i < npen; i++) {
        const w = R(7, Math.min(12, Math.sqrt(area) * 0.6)), d = R(5.5, Math.min(9, Math.sqrt(area) * 0.45));
        const g = pick(Math.hypot(w, d) / 2, 'any', 80);
        if (!g) break;
        const a = Math.atan2(lz, lx), c = Math.cos(a), s = Math.sin(a);
        out.pens.push([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [g.x + c * u - s * v, g.z + s * u + c * v] as P2));
        take(g.x, g.z, Math.hypot(w, d) / 2 + 0.3);
      }
      stack(); if (big) stack();
      midden();
      trees(Math.min(2, Math.floor(area / 600)), 2.6);
      weeds(3);
      tufts(0.12);
      break;
    }
    case 'pratum':
    case 'area': {
      // Meadow and hay; on many, a threshing floor of beaten earth and stones.
      if (p.kind === 'area' || (mid && rand() < 0.5)) {
        const s = pick(5, 'centre', 80);
        if (s) { out.floor = { x: s.x, z: s.z, r: R(3.8, 4.8) }; take(s.x, s.z, out.floor.r + 1.2); }
      }
      stack(); if (mid) stack(); if (big) stack();
      if (mid && !p.open) { const h = hut('shed', R(3.4, 4.2), R(2.4, 2.8)); woodpile(h); }
      trees(Math.min(8, Math.max(1, Math.floor(area / 160))), 2.8, 'any');
      weeds(Math.min(6, Math.floor(area / 150)), ['grass_medium_02', 'weed_plant_02', 'nettle_plant']);
      tufts(0.5);
      break;
    }
    case 'ruina':
    case 'calcaria': {
      // A Roman building fallen in: its walls stand roofless to a few metres and make an
      // enclosure; someone has built a hut against them inside. In a calcaria the stones are
      // being taken: blocks and broken marble stacked by a lime kiln.
      const s = pick(Math.min(7, Math.max(3.5, Math.sqrt(area) * 0.3)), 'centre', 80);
      if (s) {
        const W = Math.min(14, Math.max(6, Math.sqrt(area) * 0.45)), D = W * R(0.55, 0.85);
        const a = Math.atan2(lz, lx) + (rand() < 0.5 ? 0 : Math.PI / 2), c = Math.cos(a), sn = Math.sin(a);
        const brick = rand() < 0.5;
        const H = R(2.6, 4.8);
        // Four walls of the room; one is mostly gone.
        const gone = Math.floor(rand() * 4);
        const sides: [number, number, number, number][] = [[0, -D / 2, W, 0], [W / 2, 0, D, Math.PI / 2], [0, D / 2, W, 0], [-W / 2, 0, D, Math.PI / 2]];
        sides.forEach(([u, v, L, rr], k) => {
          const x = s.x + c * u - sn * v, z = s.z + sn * u + c * v;
          const h = k === gone ? R(0.6, 1.2) : H * R(0.7, 1.05);
          out.ruins.push({ x, z, L: L + 0.6, h, ry: -a - rr, open: k === gone ? 0 : rand() < 0.6 ? R(1.4, 2.2) : 0, brick });
        });
        take(s.x, s.z, Math.hypot(W, D) / 2 + 0.8);
        // The hut against the inside of the back wall.
        const back = (gone + 2) % 4, bv = sides[back];
        const off = Math.abs(bv[0]) + Math.abs(bv[1]), f = Math.max(0, (off - 1.65) / off);
        const iu = bv[0] * f, iv = bv[1] * f;
        const hw = Math.min(W, D) * 0.45;
        // Door (local +z) towards the room's middle: walls 0 and 1 face it as they are, 2 and 3 turned round.
        out.huts.push({ x: s.x + c * iu - sn * iv, z: s.z + sn * iu + c * iv, w: Math.max(2.6, hw), d: 2.4, ry: -a - bv[3] + (back >= 2 ? Math.PI : 0), kind: 'shed', h: R(2.0, 2.4), seed: Math.floor(rand() * 1e9) });
      }
      if (p.kind === 'calcaria') {
        const k = pick(2.6, 'any', 80);
        if (k) { out.kiln = { x: k.x, z: k.z, ry: R(0, 6.28) }; take(k.x, k.z, 2.6); }
        for (let i = 0; i < 3; i++) { const q = pick(1.2, 'any'); if (q) { out.spoil.push({ x: q.x, z: q.z, ry: R(0, 3.14) }); take(q.x, q.z, 1.2); } }
        woodpile(null); woodpile(null);
      } else {
        for (let i = 0; i < 2; i++) { const q = pick(1.2, 'any'); if (q) { out.spoil.push({ x: q.x, z: q.z, ry: R(0, 3.14) }); take(q.x, q.z, 1.2); } }
      }
      midden();
      trees(Math.min(2, Math.floor(area / 500)), 2.4);
      for (let i = 0; i < Math.min(5, area / 150); i++) {
        const q = pick(0.5, 'any', 10);
        if (q) prop(rand() < 0.55 ? 'nettle_plant' : 'fern_02', q.x, q.z, 2.8);
      }
      tufts(0.4);
      break;
    }
    case 'coemeterium': {
      // Graves near the church: rows west-east, heads to the west; slab-covered cists and earth
      // mounds, a few marked by a small stone. The rest of the cell is the church's garden.
      const ch = p.church;
      const ry0 = Math.PI / 2; // graves lie along x (west-east)
      let n = 0;
      const pts: { x: number; z: number; d: number }[] = [];
      for (let i = 0; i < F.length; i += 3) if (F[i + 2] >= 1.6) pts.push({ x: F[i], z: F[i + 1], d: ch ? Math.hypot(F[i] - ch[0], F[i + 1] - ch[1]) : 0 });
      pts.sort((a, b) => a.d - b.d);
      const maxG = Math.min(28, Math.floor(area / 14));
      for (const q of pts) {
        if (n >= maxG) break;
        // on a 1.4 (across) x 2.8 (along) lattice
        if (Math.round(q.x) % 3 !== 0 || Math.round(q.z) % 2 !== 0) continue;
        if (clearAt(q.x, q.z) < 1.3) continue;
        const slab = rand() < 0.45;
        out.graves.push({ x: q.x + R(-0.15, 0.15), z: q.z + R(-0.15, 0.15), ry: ry0 + R(-0.06, 0.06), slab, marker: rand() < 0.3 });
        take(q.x, q.z, 1.05);
        n++;
      }
      trees(1, 2.6);
      const rest = rows(1.5, 1.2, 2.5, 14);
      out.beds = rest;
      weeds(3, ['grass_medium_02', 'weed_plant_02']);
      tufts(0.2);
      break;
    }
  }
  return out;
}

/** Footprints of the solid things in a plot (huts, ruin walls, kiln, stacks): for tools that check where a person can stand. */
export function plotSolids(p: PlotInput): P2[][] {
  const plan = planPlot(p), out: P2[][] = [];
  const rect = (x: number, z: number, w: number, d: number, ry: number): P2[] => {
    const c = Math.cos(ry), s = Math.sin(ry);
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x + c * u + s * v, z - s * u + c * v] as P2);
  };
  const disc = (x: number, z: number, r: number): P2[] => Array.from({ length: 10 }, (_, i) => [x + Math.cos(i * 0.628) * r, z + Math.sin(i * 0.628) * r] as P2);
  for (const h of plan.huts) out.push(rect(h.x, h.z, h.w, h.d, h.ry));
  for (const r of plan.ruins) out.push(rect(r.x, r.z, r.L, 0.7, r.ry));
  if (plan.kiln) out.push(disc(plan.kiln.x, plan.kiln.z, 1.9));
  for (const s of plan.stacks) out.push(disc(s.x, s.z, s.r));
  return out;
}
