// Every travel point (teleport), the spawn and the plan-trace capture cameras must stand in the
// open: not inside a house's footprint, a plot's shed or hut, or a curtain/tower body.
// Usage: npx tsx tools/check-travel-points.ts
import { layoutTown } from '../src/benevento/layout';
import { inPoly, distPolyline, WALL700, type P2 } from '../src/benevento/geo';
import { getTeleports, SPAWN, setLayoutForTools } from '../src/world';
import { plotSolids, PLANNED } from '../src/benevento/plotfill';
import { worldTerrain } from '../src/displace';

const lay = layoutTown();
setLayoutForTools(lay);
const solids: P2[][] = [];
for (const l of lay.lots) solids.push(l.c.map((p) => [p.x, p.y] as P2));
for (const p of lay.plots) if (PLANNED.has(p.kind)) for (const s of plotSolids(p)) solids.push(s);

// The street cameras of docs/benevento/plan-trace/world and docs/benevento/open-ground/ (y '-' = on the ground).
export const STREET_CAMERAS: Record<string, P2> = {
  aurea_street: [402, -248], north_out: [328, -312], east_street_old: [640, -12], east_street: [636.5, -20.0],
  panaro_street: [695, -174], centre_street: [201.6, -125.1],
};
const pts: { name: string; x: number; z: number; under?: boolean }[] = [
  ...getTeleports().map((t) => ({ name: t.name, x: t.x, z: t.z, under: t.y < worldTerrain(t.x, t.z) - 1 })),
  { name: 'spawn', x: SPAWN.x, z: SPAWN.z },
  ...Object.entries(STREET_CAMERAS).map(([name, [x, z]]) => ({ name: 'camera ' + name, x, z })),
];
let bad = 0;
for (const p of pts) {
  if (p.under) { console.log('under  ', p.name, '(an underground room: its own geometry)'); continue; }
  const hit = solids.findIndex((c) => inPoly(p.x, p.z, c) || distPolyline(p.x, p.z, c, true) < 0.35);
  const wall = distPolyline(p.x, p.z, WALL700, true);
  const fail = hit >= 0 || wall < 1.6;
  const expected = p.name === 'camera east_street_old';
  if (fail && !expected) bad++;
  console.log(fail ? (expected ? 'inside (expected: the old camera)' : 'INSIDE') : 'ok    ', p.name, p.x.toFixed(1), p.z.toFixed(1), hit >= 0 ? 'footprint' : '', wall < 1.6 ? 'curtain' : '');
}
if (bad) { console.error(bad, 'points inside a building'); process.exit(1); }
console.log('all', pts.length, 'points in the open');
