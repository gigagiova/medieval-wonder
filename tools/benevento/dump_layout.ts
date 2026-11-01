// Dump the generated town (houses, plots, lanes, curtain, towers, gates, landmark sites) as
// JSON for tools/benevento/trace_overlay.py. Usage: npx tsx tools/benevento/dump_layout.ts out.json
import { writeFileSync } from 'fs';
import { layoutTown } from '../../src/benevento/layout';
import { WALL700, GEO_PARCELS } from '../../src/benevento/geo';
import { SITES, GATES, EXPLORE_TARGETS } from '../../src/benevento/sites';
import { wallPlan } from '../../src/benevento/fabric';

const L = layoutTown();
const wp = wallPlan();
const r2 = (v: number) => Math.round(v * 100) / 100;
writeFileSync(process.argv[2] ?? 'layout.json', JSON.stringify({
  lots: L.lots.map((l) => ({ id: l.id, c: l.c.map((p) => [r2(p.x), r2(p.y)]), front: !!l.front, explore: l.explore?.id ?? null, h: r2(l.h) })),
  plots: L.plots.map((p) => ({ kind: p.kind, pts: p.pts, walls: p.walls ?? [] })),
  streets: L.streets.filter((s) => s.kind === 'lane').map((s) => ({ w: s.w, main: s.main, pts: s.pts.map((p) => [r2(p.x), r2(p.y)]) })),
  parcels: GEO_PARCELS.map((p) => ({ k: p.k, sq: !!p.sq, pts: p.pts })),
  wall: WALL700,
  towers: wp.towers.map((t) => ({ id: t.id ?? null, x: r2(t.x + t.ox * 2.4), z: r2(t.z + t.oz * 2.4), kind: t.kind })),
  gates: GATES.map((g) => ({ id: g.id, at: g.at })),
  sites: Object.values(SITES).map((s) => ({ id: s.id, x: s.x, z: s.z, clear: s.clear ?? 0 })),
  targets: EXPLORE_TARGETS.map((t) => ({ id: t.id, near: t.near })),
}));
console.log('lots', L.lots.length, 'plots', L.plots.length, 'towers', wp.towers.length, 'wall pieces', wp.pieces.length);
