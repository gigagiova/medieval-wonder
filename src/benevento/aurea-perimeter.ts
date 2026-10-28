import RAW from './geo.json';

type Point = [number, number];
/** The circuit of AD 700 as traced from the plan (tools/benevento/plan_trace.py). */
export const RAW_WALL700 = RAW.wall as Point[];
// Registration v2 (docs/benevento/PLAN-TRACE.md) matches the Arch of Trajan to the point
// where the plan's north edge passes under triangle 3, so the traced curtain now runs
// through the arch's mapped position: the arch stands at its OpenStreetMap footprint
// centroid (way 122652341), about 2 m from the curtain line, and no local correction of
// the curtain is needed (the former AUREA-ALIGNMENT repair is superseded).
export const AUREA_CENTER: Point = [389.26, -225.58];
export const CORRECTED_WALL700: Point[] = RAW_WALL700.map((p) => [p[0], p[1]] as Point);
