// What the open cells hold (docs/benevento/OPEN-GROUND.md): plots by kind, with their area and
// the things planned in them. Usage: npx tsx tools/benevento/open_ground_stats.ts [out.json]
import { writeFileSync } from 'fs';
import { layoutTown } from '../../src/benevento/layout';
import { planPlot, PLANNED } from '../../src/benevento/plotfill';

const L = layoutTown();
const area = (pts: [number, number][]) => { let a = 0; for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
const rows: Record<string, { n: number; open: number; m2: number; huts: number; trees: number; beds: number; vines: number; pens: number; stacks: number; graves: number; ruins: number; kilns: number; floors: number; wells: number; props: number }> = {};
for (const p of L.plots) {
  if (!PLANNED.has(p.kind)) continue;
  const pl = planPlot(p);
  const r = rows[p.kind] ??= { n: 0, open: 0, m2: 0, huts: 0, trees: 0, beds: 0, vines: 0, pens: 0, stacks: 0, graves: 0, ruins: 0, kilns: 0, floors: 0, wells: 0, props: 0 };
  r.n++; if (p.open) r.open++;
  r.m2 += Math.round(area(p.pts));
  r.huts += pl.huts.length; r.trees += pl.trees.length; r.beds += pl.beds.length; r.vines += pl.vines.length; r.pens += pl.pens.length;
  r.stacks += pl.stacks.length; r.graves += pl.graves.length; r.ruins += pl.ruins.length; r.kilns += pl.kiln ? 1 : 0; r.floors += pl.floor ? 1 : 0;
  r.wells += p.well ? 1 : 0; r.props += pl.props.length;
}
console.table(rows);
const tot = Object.values(rows).reduce((a, r) => ({ n: a.n + r.n, m2: a.m2 + r.m2, huts: a.huts + r.huts, trees: a.trees + r.trees }), { n: 0, m2: 0, huts: 0, trees: 0 });
console.log('total', tot, 'houses', L.lots.length, 'wells', L.wells.length);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ rows, total: tot }, null, 1));
