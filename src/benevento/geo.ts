import RAW from './geo.json';

// Benevento as it lay c. AD 700, baked by tools/benevento/*.py: EU-DEM 25 m
// elevations (smoothed, river channels carved), the Calore and Sabato from
// OpenStreetMap, and the user's urban plan (docs/benevento) vectorised into
// streets, blocks and open spaces, registered onto the real ground through
// control points (thin-plate spline). The first Lombard circuit is the plan's
// outline minus the Civitas nova of Arechis II and the 10th-century annex at
// the later Porta Somma: 2.83 km (2750 m in Bertelli 1992).
// Frame: metres, x east, z south; origin lat 41.1305 N, lon 14.7745 E.

export type P2 = [number, number];
export interface River { name: string; pts: P2[]; w: number; level: number[] }
/** A lane of the plan (skeleton of its street spaces): width as drawn, on the decumanus, inside the circuit of 700. */
export interface GeoStreet { w: number; main: boolean; in: boolean; pts: P2[] }
/** A block or plot of the plan ('open' = a large unbuilt space), inside the circuit of 700 or not. */
export interface GeoParcel { k: 'parcel' | 'open'; a: number; in: boolean; pts: P2[] }
export interface GeoArea { hole: boolean; pts: P2[] }
interface Raw {
  bounds: [number, number, number, number];
  terrain: { x0: number; z0: number; step: number; nx: number; nz: number; dm: string };
  rivers: River[];
  wall: P2[];
  civitasNova: P2[];
  medievalOutline: P2[];
  streets: GeoStreet[];
  parcels: GeoParcel[];
  streetAreas: GeoArea[];
}
const G = RAW as unknown as Raw;

/** Heights are stored above sea level; the game works DATUM metres lower (better float precision). */
export const DATUM = 100;
export const BOUNDS = { x0: G.bounds[0], z0: G.bounds[1], x1: G.bounds[2], z1: G.bounds[3] };
export const RIVERS = G.rivers;
export const WALL700 = G.wall;
export const CIVITAS_NOVA = G.civitasNova;
export const MEDIEVAL_OUTLINE = G.medievalOutline;
export const GEO_STREETS = G.streets;
export const GEO_PARCELS = G.parcels;
export const GEO_STREET_AREAS = G.streetAreas;

const TT = G.terrain;
const H = (() => {
  const bin = atob(TT.dm);
  const a = new Float32Array(TT.nx * TT.nz);
  for (let i = 0; i < a.length; i++) {
    let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (v & 0x8000) v -= 0x10000;
    a[i] = v / 10 - DATUM;
  }
  return a;
})();

const hAt = (i: number, j: number) => H[Math.min(TT.nz - 1, Math.max(0, j)) * TT.nx + Math.min(TT.nx - 1, Math.max(0, i))];
/** Catmull-Rom weights. */
function cr(t: number, w: number[]) {
  const t2 = t * t, t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}
const wx = [0, 0, 0, 0], wz = [0, 0, 0, 0];
/** Natural ground (game units) from the DEM, bicubic so slopes shade smoothly. */
export function baseHeight(x: number, z: number) {
  const fx = (x - TT.x0) / TT.step, fz = (z - TT.z0) / TT.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  cr(fx - i, wx); cr(fz - j, wz);
  let s = 0;
  for (let b = 0; b < 4; b++) {
    let r = 0;
    for (let a = 0; a < 4; a++) r += wx[a] * hAt(i - 1 + a, j - 1 + b);
    s += wz[b] * r;
  }
  return s;
}

/** Point in polygon (even-odd). */
export function inPoly(x: number, z: number, poly: P2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** Distance from a point to a polyline (open). */
export function distPolyline(x: number, z: number, pts: P2[], closed = false) {
  let best = Infinity;
  const n = pts.length;
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (d < best) best = d;
  }
  return best;
}

// Inside-the-walls mask on a 4 m raster (1 inside, 0 outside, soft edge):
// used for ground roughness and many cheap queries.
const MS = 4;
const MNX = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / MS) + 1, MNZ = Math.ceil((BOUNDS.z1 - BOUNDS.z0) / MS) + 1;
const MASK = (() => {
  const m = new Float32Array(MNX * MNZ);
  // Only rows/cols over the wall's bbox can be inside.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of WALL700) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let j = 0; j < MNZ; j++) {
    const z = BOUNDS.z0 + j * MS;
    if (z < z0 - 8 || z > z1 + 8) continue;
    for (let i = 0; i < MNX; i++) {
      const x = BOUNDS.x0 + i * MS;
      if (x < x0 - 8 || x > x1 + 8) continue;
      const ins = inPoly(x, z, WALL700);
      const d = distPolyline(x, z, WALL700, true);
      m[j * MNX + i] = ins ? Math.min(1, 0.5 + d / 16) : Math.max(0, 0.5 - d / 16);
    }
  }
  return m;
})();
/** ~1 well inside the circuit, ~0 well outside, 0.5 on the wall line. */
export function insideness(x: number, z: number) {
  const fx = (x - BOUNDS.x0) / MS, fz = (z - BOUNDS.z0) / MS;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= MNX - 1 || j >= MNZ - 1) return 0;
  const tx = fx - i, tz = fz - j;
  const a = MASK[j * MNX + i], b = MASK[j * MNX + i + 1], c = MASK[(j + 1) * MNX + i], d = MASK[(j + 1) * MNX + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
export const insideWalls = (x: number, z: number) => insideness(x, z) > 0.5;

/** Water level of a river near (x, z), and the distance to its centre line, or null if far. */
export function riverAt(x: number, z: number, maxD = 60): { level: number; d: number; w: number; river: River } | null {
  let best: { level: number; d: number; w: number; river: River } | null = null;
  for (const r of RIVERS) {
    const P = r.pts;
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k], b = P[k + 1];
      if (Math.abs(a[0] - x) > maxD + 30 && Math.abs(b[0] - x) > maxD + 30) continue;
      if (Math.abs(a[1] - z) > maxD + 30 && Math.abs(b[1] - z) > maxD + 30) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      if (d < maxD && (!best || d < best.d)) best = { level: r.level[k] + (r.level[k + 1] - r.level[k]) * t - DATUM, d, w: r.w, river: r };
    }
  }
  return best;
}
