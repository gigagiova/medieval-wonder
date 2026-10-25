// Dump the site definitions for the scratch map: npx tsx tools/benevento/dump_sites.mts > out.json
import { SITES, GATES, ROADS, DISTRICTS, EXPLORE_TARGETS } from '../../src/benevento/sites';
import { layoutTown } from '../../src/benevento/layout';
const L = layoutTown();
const explore = L.lots.filter((l) => l.explore).map((l) => ({ id: l.explore!.id, kind: l.explore!.kind, x: (l.c[0].x + l.c[2].x) / 2, z: (l.c[0].y + l.c[2].y) / 2 }));
console.log(JSON.stringify({ sites: Object.values(SITES), gates: GATES, roads: ROADS, districts: DISTRICTS, targets: EXPLORE_TARGETS, explore }));
