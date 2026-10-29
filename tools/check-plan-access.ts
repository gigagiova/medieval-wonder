// Reachability on the traced town (docs/benevento/PLAN-TRACE.md): from the inner mouth of every
// gate and the street side of every enterable door, walk the 0.5 m raster over lane ground
// (STREET) and see whether the main lane network (the decumanus) is reached. Houses, gardens'
// walls and landmark precincts block. Exit code 1 if any is cut off.
import { layoutTown, STREET, PLOT } from '../src/benevento/layout';
import { GATES, SITES, siteToWorld } from '../src/benevento/sites';
import { DECUMANUS, insideness, type P2 } from '../src/benevento/geo';
import { interiorAnchors } from '../src/benevento/interiors';
import { PACCA_SITE } from '../src/benevento/pacca-burials';

const L = layoutTown(), r = L.r, N = r.grid.length, nx = r.nx;
const walk = (k: number) => k >= 0 && k < N && r.grid[k] === STREET;
// The main network: lane cells connected to the decumanus's middle point.
const seen = new Int32Array(N).fill(-1);
let comp = 0;
const flood = (k0: number) => {
  const q = [k0]; seen[k0] = comp;
  for (let i = 0; i < q.length; i++) for (const o of [1, -1, nx, -nx]) { const m = q[i] + o; if (walk(m) && seen[m] < 0) { seen[m] = comp; q.push(m); } }
  return comp++;
};
const nearestWalk = (x: number, z: number, rad = 4) => {
  let best = -1, bd = Infinity;
  for (let dz = -rad; dz <= rad; dz += 0.5) for (let dx = -rad; dx <= rad; dx += 0.5) {
    const k = r.idx(x + dx, z + dz), d = Math.hypot(dx, dz);
    if (walk(k) && d < bd) { bd = d; best = k; }
  }
  return best;
};
const mid = DECUMANUS[Math.floor(DECUMANUS.length / 2)];
const k0 = nearestWalk(mid[0], mid[1], 6);
const main = flood(k0);
let size = 0; for (let k = 0; k < N; k++) if (seen[k] === main) size++;
const check = (name: string, p: P2) => {
  const k = nearestWalk(p[0], p[1]);
  if (k < 0) return { name, ok: false, why: 'no lane ground within 4 m' };
  if (seen[k] < 0) flood(k);
  return { name, ok: seen[k] === main, why: seen[k] === main ? '' : 'cut off from the main lanes' };
};
const out: { name: string; ok: boolean; why: string }[] = [];
for (const g of GATES) {
  // the inner mouth: 4 m from the gate towards the inside
  let best: P2 = g.at, bi = -1;
  for (let a = 0; a < 16; a++) {
    const p: P2 = [g.at[0] + Math.cos(a * Math.PI / 8) * 4, g.at[1] + Math.sin(a * Math.PI / 8) * 4];
    const v = insideness(p[0], p[1]);
    if (v > bi) { bi = v; best = p; }
  }
  out.push(check('gate ' + g.id, best));
}
for (const l of L.lots) if (l.explore) {
  const a = interiorAnchors({ c: l.c.map((p) => [p.x, p.y] as P2), front: { a: [l.front!.a.x, l.front!.a.y], b: [l.front!.b.x, l.front!.b.y], out: [l.front!.out.x, l.front!.out.y] }, h: l.h, street: l.street ?? 2, seed: 1000 + l.id * 7919, explore: l.explore });
  out.push(check('door ' + l.explore.id, a.outside));
}
for (const id of ['caballus', 'forum'] as const) out.push(check('site ' + id, [SITES[id].x, SITES[id].z]));
out.push(check('Triggio stair', siteToWorld(SITES.triggioBurials, -1.25, -6.4)));
out.push(check('Pacca stair', siteToWorld(PACCA_SITE, -1.25, -6.4)));
void PLOT;
console.log(JSON.stringify({ mainLaneCells: size, failures: out.filter((o) => !o.ok), checked: out.length }, null, 2));
if (out.some((o) => !o.ok)) process.exitCode = 1;
