import RAW from './geo.json';

type Point = [number, number];
/** Original trace remains the deterministic generation parameterization. */
export const RAW_WALL700 = RAW.wall as Point[];
// The triangular Porta Aurea annotation contaminated vertices52–54. Bridge
// its neighboring curtain samples directly, retaining the supplied plan's
// perimeter rather than adding a recessed passage to a symbol-centroid anchor.
const east = RAW_WALL700[51], west = RAW_WALL700[55];
const zAt = (x: number) => east[1] + (west[1] - east[1]) * (x - east[0]) / (west[0] - east[0]);
export const AUREA_CENTER: Point = [389, zAt(389)];
export const CORRECTED_WALL700: Point[] = RAW_WALL700.map((p, i) =>
  i >= 52 && i <= 54 ? [p[0], zAt(p[0])] : [...p]);
