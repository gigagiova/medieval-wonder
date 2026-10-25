import RAW from './geo.json';

// Cellarulo: the river plain north-west of the town where the Calore runs
// south to meet the Sabato, and where the ruins of Ponte Fratto stand. It lies
// just north of the map baked in geo.json (z < -800), so its ground comes from
// here: EU-DEM 25 m (via OpenTopoData) sampled every 12.5 m, with the Calore's
// real course (OpenStreetMap way 838750109) carved into it the same way
// tools/benevento/gen_geo.py carves the rivers of the main map.
// Frame and units as in geo.ts (metres, x east, z south; heights in m asl).

type P2 = [number, number];

/** The patch of ground this module supplies (world x/z). */
export const CELLARULO = { x0: -1500, x1: -1175, z0: -1100, z1: -800 };

const DX0 = -1500, DZ0 = -1100, DST = 12.5, DN = 27;
/** EU-DEM, decimetres above 110 m. Rows north → south (z = -1100 … -775), columns west → east. */
// prettier-ignore
const DEM = [
  122,121,119,116,113,108,100,81,60,33,16,25,32,31,29,26,26,30,33,36,38,41,43,44,44,43,41,
  118,116,115,112,109,104,94,73,52,29,17,24,30,30,30,28,28,32,35,38,40,43,44,46,46,44,42,
  113,112,111,108,105,101,89,67,46,26,17,24,28,29,30,29,30,34,38,40,42,44,46,47,47,46,44,
  108,108,106,104,101,97,85,64,43,24,16,22,27,29,30,30,32,36,39,42,44,46,47,48,48,47,45,
  103,103,102,100,98,94,82,61,41,23,16,20,25,29,31,32,34,37,41,43,46,48,49,50,50,49,48,
  98,98,98,96,94,90,79,61,42,22,15,17,21,26,30,31,34,38,41,44,47,49,51,52,52,51,50,
  94,94,93,92,89,87,76,61,43,23,15,14,17,23,28,31,34,38,42,45,48,51,53,54,54,53,52,
  89,90,89,87,85,82,73,60,46,30,21,15,17,22,26,29,33,38,41,44,48,52,55,56,56,55,55,
  85,86,85,83,81,78,70,61,49,36,25,16,16,20,24,28,32,37,41,44,48,53,56,59,59,59,59,
  81,82,81,79,76,73,68,61,49,36,26,15,16,19,23,27,31,36,40,43,48,52,57,62,63,63,64,
  77,78,77,75,72,70,65,61,49,36,25,15,16,19,22,25,30,35,39,43,47,52,58,64,67,70,71,
  74,75,74,72,69,66,62,57,46,34,24,14,16,18,21,24,29,35,39,42,47,51,58,66,71,76,79,
  71,72,71,69,66,62,58,54,43,32,23,14,15,17,20,22,29,35,39,43,47,51,59,67,75,82,86,
  68,70,68,66,63,60,56,51,41,30,22,13,15,16,18,21,28,35,39,43,46,51,59,68,78,87,94,
  66,68,66,64,60,57,53,48,38,29,21,13,14,15,17,19,27,34,39,43,47,51,59,67,78,89,97,
  64,66,64,62,58,54,50,46,36,27,20,13,14,14,15,18,26,34,39,44,47,51,58,67,79,90,101,
  63,64,62,59,55,51,48,44,34,26,19,13,13,13,13,16,25,33,39,44,47,52,58,67,78,90,101,
  62,62,60,57,53,49,46,41,32,24,18,13,12,11,12,14,24,32,39,44,48,52,58,66,78,89,101,
  59,60,58,55,51,47,43,38,30,23,17,13,11,10,10,13,22,31,38,44,48,53,59,67,78,89,100,
  57,57,55,53,49,45,41,36,28,21,16,12,10,9,8,12,22,30,38,44,49,54,60,67,78,88,99,
  54,54,52,50,47,43,39,33,25,19,15,12,9,7,6,11,21,30,37,44,50,55,61,68,78,88,98,
  51,50,49,47,44,40,36,30,22,16,12,9,7,6,6,11,21,29,37,44,50,56,62,70,79,88,98,
  47,47,45,43,40,36,32,26,19,13,8,6,5,6,6,12,21,30,37,44,50,56,63,71,80,89,98,
  43,42,41,39,36,32,28,23,16,10,6,4,4,5,7,13,22,30,38,45,50,57,64,72,81,90,97,
  38,38,36,34,31,28,24,19,13,8,3,2,3,5,8,14,23,31,39,45,51,57,64,72,81,88,96,
  33,32,31,29,26,23,20,15,10,6,2,2,3,5,8,15,23,31,39,45,50,57,64,72,80,88,94,
  29,27,26,24,22,19,16,12,8,4,1,1,2,5,8,15,23,31,38,44,50,56,63,72,80,87,93,
];
const demAt = (i: number, j: number) => 110 + DEM[Math.min(DN - 1, Math.max(0, j)) * DN + Math.min(DN - 1, Math.max(0, i))] / 10;
function dem(x: number, z: number) {
  const fx = (x - DX0) / DST, fz = (z - DZ0) / DST;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const s = (t: number) => t * t * (3 - 2 * t);
  const su = s(u), sv = s(v);
  return (demAt(i, j) * (1 - su) + demAt(i + 1, j) * su) * (1 - sv) + (demAt(i, j + 1) * (1 - su) + demAt(i + 1, j + 1) * su) * sv;
}

// ---------------------------------------------------------------- the Calore's real course
// OSM way 838750109, downstream (north → south), ending on the point where
// geo.json's resampled course enters the main map (index 286, level 109.54 m).
const OSM: P2[] = [[-1344.0, -1170.7], [-1355.6, -1098.8], [-1352.0, -1026.1], [-1347.4, -884.6], [-1339.4, -809.0], [-1339.5, -801.2]];
const END_LEVEL = 109.54, SLOPE = 0.004;
/** Width of the Calore as drawn in geo.json. */
export const CALORE_W = 32;
/** The real course resampled every ~12 m and smoothed; levels (m asl) per point. */
export const CALORE_REAL: { pts: P2[]; level: number[] } = (() => {
  let total = 0;
  const seg = OSM.slice(1).map((b, k) => { const a = OSM[k], l = Math.hypot(b[0] - a[0], b[1] - a[1]); total += l; return l; });
  const n = Math.round(total / 12);
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    let s = (i / n) * total, k = 0;
    while (k < seg.length - 1 && s > seg[k]) { s -= seg[k]; k++; }
    const t = Math.min(1, s / seg[k]), a = OSM[k], b = OSM[k + 1];
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  for (let r = 0; r < 3; r++) for (let i = 1; i < pts.length - 1; i++) pts[i] = [(pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4];
  const level = pts.map((_, i) => END_LEVEL + SLOPE * ((n - i) / n) * total);
  return { pts, level };
})();

/** Nearest point of a polyline: distance and the interpolated value of `val`. */
function nearest(x: number, z: number, P: P2[], val: number[]) {
  let d = Infinity, v = 0;
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], b = P[k + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const dd = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (dd < d) { d = dd; v = val[k] + (val[k + 1] - val[k]) * t; }
  }
  return { d, v };
}

// The resampled course in geo.json cuts the river's loop short beyond the map's
// edge (an east-west stretch at z ≈ -890 … -930): keep that stretch under ground
// here, so the water ribbon drawn along it stays hidden (see pontefratto.ts).
const GEO_CAL = (RAW as unknown as { rivers: { pts: P2[]; level: number[] }[] }).rivers[0];
const STRAY: { pts: P2[]; level: number[] } = { pts: [], level: [] };
GEO_CAL.pts.forEach((p, k) => {
  if (p[1] < -803 && p[0] < -1100 && p[0] > -1500 && nearest(p[0], p[1], CALORE_REAL.pts, CALORE_REAL.level).d > CALORE_W / 2 + 3) { STRAY.pts.push(p); STRAY.level.push(GEO_CAL.level[k]); }
});

const smooth = (a: number, b: number, t: number) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/** Ground (m asl) of the patch with the channel carved, or null outside it. */
function patch(x: number, z: number) {
  if (x < CELLARULO.x0 || x > CELLARULO.x1 || z < CELLARULO.z0 - 40) return null;
  let h = dem(x, z);
  const { d, v: lv } = nearest(x, z, CALORE_REAL.pts, CALORE_REAL.level);
  const hw = CALORE_W / 2, bank = 26;
  if (d < hw) h = Math.min(h, lv - 0.3 - 2.6 * (1 - (d / hw) ** 2));
  else if (d < hw + bank) { const s = smooth(0, 1, (d - hw) / bank), low = lv + 0.25; h = low + (Math.max(h, low + 0.6) - low) * s; }
  else if (d < hw + 120) h = Math.max(h, lv + 0.9);
  if (STRAY.pts.length > 1) {
    const st = nearest(x, z, STRAY.pts, STRAY.level);
    if (st.d < hw + 6 && d > hw + 2) h = Math.max(h, st.v + 1.1 * smooth(0, 4, d - hw));
  }
  return h;
}

/**
 * Height (m asl) north of the baked map, blended in over 30 m from the map's
 * last row (`edge`, the height the main DEM gives there) and over 25 m at the
 * patch's east and west sides. Null where the main map applies.
 */
export function cellaruloHeight(x: number, z: number, edge: number): number | null {
  if (z >= CELLARULO.z1) return null;
  const p = patch(x, z);
  if (p === null) return null;
  const t = smooth(0, 30, CELLARULO.z1 - z) * smooth(CELLARULO.x0, CELLARULO.x0 + 25, x) * (1 - smooth(CELLARULO.x1 - 25, CELLARULO.x1, x));
  return edge + (p - edge) * t;
}
