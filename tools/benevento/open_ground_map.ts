// Dump the town with the open ground's plans (plotfill.ts) for tools/benevento/open_ground_map.py.
// Usage: npx tsx tools/benevento/open_ground_map.ts out.json
import { writeFileSync } from 'fs';
import { layoutTown } from '../../src/benevento/layout';
import { GEO_PARCELS, WALL700 } from '../../src/benevento/geo';
import { planPlot, plotSolids, PLANNED } from '../../src/benevento/plotfill';

const L = layoutTown();
const r1 = (v: number) => Math.round(v * 10) / 10;
const P = (pts: [number, number][]) => pts.map(([x, z]) => [r1(x), r1(z)]);
writeFileSync(process.argv[2] ?? 'open_ground.json', JSON.stringify({
  wall: P(WALL700 as [number, number][]),
  lots: L.lots.map((l) => P(l.c.map((p) => [p.x, p.y]))),
  squares: GEO_PARCELS.filter((p) => p.sq && p.in).map((p) => P(p.pts)),
  streets: L.streets.filter((s) => s.kind === 'lane').map((s) => ({ w: s.w, pts: s.pts.map((p) => [r1(p.x), r1(p.y)]) })),
  wells: L.wells.map((w) => [r1(w.x), r1(w.z)]),
  plots: L.plots.map((p) => {
    const plan = PLANNED.has(p.kind) ? planPlot(p) : null;
    return {
      kind: p.kind, open: !!p.open, src: p.src ?? null, pts: P(p.pts), walls: p.walls ?? [],
      solids: plan ? plotSolids(p).map(P) : [],
      trees: plan ? plan.trees.map((t) => [r1(t.x), r1(t.z)]) : [],
      beds: plan ? plan.beds.map((b) => [b.a, b.b].map(([x, z]) => [r1(x), r1(z)])) : [],
      vines: plan ? plan.vines.map((b) => [b.a, b.b].map(([x, z]) => [r1(x), r1(z)])) : [],
      pens: plan ? plan.pens.map(P) : [],
      graves: plan ? plan.graves.map((g) => [r1(g.x), r1(g.z)]) : [],
      floor: plan?.floor ?? null,
    };
  }),
}));
