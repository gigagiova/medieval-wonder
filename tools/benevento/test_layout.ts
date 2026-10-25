import { layoutTown, FREE, STREET, RESERVED, HOUSE, OUTSIDE, PLOT } from '../../src/benevento/layout';
import { writeFileSync, mkdirSync } from 'fs';
import { GEO_PARCELS } from '../../src/benevento/geo';
// Output goes to $SCRATCH (default /tmp/benevento); layout_vs_plan.py reads it from there.
const OUT = (process.env.SCRATCH ?? '/tmp/benevento').replace(/\/$/, '') + '/';
mkdirSync(OUT, { recursive: true });
const t0 = performance.now();
const L = layoutTown();
const t1 = performance.now();
console.log('layout ms', (t1 - t0).toFixed(0), 'lots', L.lots.length, 'front', L.lots.filter((l) => l.front).length, 'explore', L.lots.filter((l) => l.explore).length,
  'plots', L.plots.length, 'bridges', L.bridges.length, 'pontili', L.bridges.filter((b) => b.pontile).length, 'wells', L.wells.length, 'streets', L.streets.length);
const counts: Record<number, number> = {};
for (const v of L.r.grid) counts[v] = (counts[v] ?? 0) + 1;
console.log('cells', counts, 'raster', L.r.nx, L.r.nz);
// PPM dump at 1 px per metre
const r = L.r, W = Math.floor(r.nx / 2), H = Math.floor(r.nz / 2);
const cols: Record<number, number[]> = { [FREE]: [235, 230, 200], [STREET]: [250, 250, 250], [RESERVED]: [200, 120, 120], [HOUSE]: [120, 100, 90], [OUTSIDE]: [60, 70, 60], [PLOT]: [140, 180, 110] };
const buf = Buffer.alloc(W * H * 3);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const v = r.grid[(j * 2) * r.nx + i * 2];
  const c = v === STREET && !r.trod[(j * 2) * r.nx + i * 2] ? [205, 215, 175] : (cols[v] ?? [255, 0, 255]);
  buf.set(c, (j * W + i) * 3);
}
writeFileSync(OUT + 'layout.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), buf]));
const plotKinds: Record<string, number> = {};
for (const p of L.plots) plotKinds[p.kind] = (plotKinds[p.kind] ?? 0) + 1;
console.log(plotKinds); writeFileSync(OUT + 'layout_meta.json', JSON.stringify({x0: r.x0, z0: r.z0, res: 1}));
// Against the plan: how much of its blocks is covered by buildings, how much of its open ground stays open.
{
  const inParcels = GEO_PARCELS.filter((p) => p.in);
  const c = { block: 0, blockHouse: 0, blockRes: 0, blockResHouse: 0, open: 0, openHouse: 0 };
  let eaves = 0;
  for (let k = 0; k < r.grid.length; k++) {
    const pid = r.parcel[k];
    if (!pid || pid > inParcels.length || r.grid[k] === OUTSIDE) continue;
    const h = r.grid[k] === HOUSE ? 1 : 0;
    if (inParcels[pid - 1].k === 'open') { c.open++; c.openHouse += h; continue; }
    if (r.grid[k] === RESERVED) { c.blockRes++; continue; }
    // Within 0.5 m of a wall: under the eaves.
    if (!h && r.grid[k] === FREE) { const nx = r.nx; for (const o of [1, -1, nx, -nx]) if (r.grid[k + o] === HOUSE) { eaves++; break; } }
    c.block++; c.blockHouse += h;
  }
  const ha = (n: number) => (n * r.res * r.res / 1e4).toFixed(1) + ' ha';
  console.log(`plan blocks ${ha(c.block)} (+${ha(c.blockRes)} in landmark precincts / wall band): ${(100 * c.blockHouse / c.block).toFixed(1)}% covered by buildings, ${(100 * (c.blockHouse + eaves) / c.block).toFixed(1)}% with their eaves`);
  console.log(`plan open ground ${ha(c.open)}: ${(100 * (1 - c.openHouse / c.open)).toFixed(1)}% left open`);
}
