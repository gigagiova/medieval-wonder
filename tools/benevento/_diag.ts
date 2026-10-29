import { layoutTown } from '../../src/benevento/layout';
import { EXPLORE_TARGETS, FIXED_EXPLORE_LOTS } from '../../src/benevento/sites';
import { GEO_PARCELS } from '../../src/benevento/geo';
const L = layoutTown();
const ar = (c: { x: number; y: number }[]) => { let a = 0; for (let k = 0; k < c.length; k++) { const p = c[k], q = c[(k + 1) % c.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; };
console.log('lots', L.lots.length, 'front', L.lots.filter(l => l.front).length, 'built m2', L.lots.reduce((s, l) => s + ar(l.c), 0).toFixed(0));
console.log('traced', GEO_PARCELS.filter(p => p.k === 'house').length, 'house', GEO_PARCELS.filter(p => p.k === 'open' && !p.sq).length, 'open', GEO_PARCELS.filter(p => p.sq).length, 'squares', GEO_PARCELS.filter(p => p.k === 'court').length, 'courts');
for (const t of [...EXPLORE_TARGETS, ...FIXED_EXPLORE_LOTS]) {
  const l = L.lots.find(q => q.explore?.id === t.id);
  if (!l) { console.log(t.id, 'MISSING'); continue; }
  const m = l.c[0].clone().add(l.c[2]).multiplyScalar(0.5);
  console.log(t.id, Math.hypot(m.x - t.near[0], m.y - t.near[1]).toFixed(0));
}
console.log('plots', L.plots.length, 'walled', L.plots.filter(p => p.walls).length, 'bridges', L.bridges.length, 'wells', L.wells.length, 'lanes', L.streets.filter(s => s.kind === 'lane').length);
