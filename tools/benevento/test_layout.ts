import { layoutTown, FREE, STREET, RESERVED, HOUSE, OUTSIDE, PLOT } from '/home/user/medieval-wonder/.claude/worktrees/agent-a6d696e568780419c/src/benevento/layout';
import { writeFileSync } from 'fs';
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
writeFileSync('/tmp/claude-0/-home-user-medieval-wonder/bc93be6c-c281-5bc8-9970-42e320f63227/scratchpad/benevento/layout.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), buf]));
const plotKinds: Record<string, number> = {};
for (const p of L.plots) plotKinds[p.kind] = (plotKinds[p.kind] ?? 0) + 1;
console.log(plotKinds); writeFileSync('/tmp/claude-0/-home-user-medieval-wonder/bc93be6c-c281-5bc8-9970-42e320f63227/scratchpad/benevento/layout_meta.json', JSON.stringify({x0: r.x0, z0: r.z0, res: 1}));
