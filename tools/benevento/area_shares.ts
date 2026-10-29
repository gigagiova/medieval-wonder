// Shares of the walled area: the drawing (the traced cells of urban-plan-reference.webp, in
// world m²) against the generated town (the layout's 0.5 m raster and its plots).
// Usage: npx tsx tools/benevento/area_shares.ts
import { layoutTown, HOUSE, STREET, RESERVED, PLOT, FREE } from '../../src/benevento/layout';
import { GEO_PARCELS, WALL700, inPoly } from '../../src/benevento/geo';

const area = (pts: [number, number][]) => { let a = 0; for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
const town = area(WALL700 as [number, number][]);
const P = GEO_PARCELS.filter((p) => p.in);
const sum = (f: (p: (typeof P)[number]) => boolean) => P.filter(f).reduce((s, p) => s + p.a, 0);
const drawing = {
  building: sum((p) => p.k === 'house'),
  courtyard: sum((p) => p.k === 'court'),
  'garden / open cell': sum((p) => p.k === 'open' && !p.sq),
  'open cell opening on a lane': sum((p) => !!p.sq),
};
const dStreet = town - Object.values(drawing).reduce((a, b) => a + b, 0);

const L = layoutTown();
const r = L.r, cellA = r.res * r.res;
const openPlots = L.plots.filter((p) => p.open);
const courts = L.plots.filter((p) => p.kind === 'cortis');
const res = { building: 0, courtyard: 0, 'garden / open cell': 0, 'open cell opening on a lane': 0, street: 0, 'landmark precincts': 0 };
for (let j = 0; j < r.nz; j++) for (let i = 0; i < r.nx; i++) {
  const g = r.grid[j * r.nx + i];
  if (g === 4) continue;
  const x = r.x0 + (i + 0.5) * r.res, z = r.z0 + (j + 0.5) * r.res;
  if (g === HOUSE) res.building += cellA;
  else if (g === RESERVED) res['landmark precincts'] += cellA;
  else if (g === PLOT || g === FREE) res[courts.some((p) => inPoly(x, z, p.pts)) ? 'courtyard' : 'garden / open cell'] += cellA;
  else if (g === STREET) res[openPlots.some((p) => inPoly(x, z, p.pts)) ? 'open cell opening on a lane' : 'street'] += cellA;
}
const pct = (v: number) => (100 * v / town).toFixed(1) + '%';
console.log('walled area', Math.round(town), 'm²');
console.log('class'.padEnd(30), 'drawing'.padStart(10), 'game'.padStart(10));
for (const k of ['building', 'courtyard', 'garden / open cell', 'open cell opening on a lane'] as const) console.log(k.padEnd(30), pct(drawing[k]).padStart(10), pct(res[k]).padStart(10));
console.log('street'.padEnd(30), pct(dStreet).padStart(10), pct(res.street).padStart(10));
console.log('landmark precincts'.padEnd(30), '-'.padStart(10), pct(res['landmark precincts']).padStart(10));
