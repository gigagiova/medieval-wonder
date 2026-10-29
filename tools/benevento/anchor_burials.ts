// Re-anchor the two street-side burial stairs to the traced footprints (docs/benevento/PLAN-TRACE.md).
// A site frame has local +x into the host house (perpendicular to its street front), local +z
// along the front; the stair hole (x -2.12..-0.38, z -5.35..3.45) lies in the lane outside it.
// Prints the frames to paste into sites.ts (triggioBurials) and pacca-burials.ts (PACCA_SITE).
import { layoutTown, STREET, type TownLot } from '../../src/benevento/layout';
import { inPoly, type P2 } from '../../src/benevento/geo';
import { interiorFrame } from '../../src/benevento/interiors';

const L = layoutTown();
const frame = (l: TownLot, u: number) => {
  const a = l.front!.a, b = l.front!.b, e = b.clone().sub(a).normalize(), inn = l.front!.out.clone().negate();
  const o = a.clone().addScaledVector(e, u);
  return { x: o.x, z: o.y, rot: Math.atan2(-inn.y, inn.x), e, inn, o };
};
const toW = (f: ReturnType<typeof frame>, lx: number, lz: number): P2 => [f.o.x + f.inn.x * lx + f.e.x * lz, f.o.y + f.inn.y * lx + f.e.y * lz];
function holeOk(f: ReturnType<typeof frame>, host: TownLot) {
  let bad = 0, street = 0, n = 0;
  for (let x = -2.12; x <= -0.38; x += 0.29) for (let z = -5.35; z <= 3.45; z += 0.4) {
    const [wx, wz] = toW(f, x, z); n++;
    if (L.lots.some((l) => inPoly(wx, wz, l.c.map((p) => [p.x, p.y])))) bad++;
    if (L.r.at(wx, wz) === STREET) street++;
  }
  // under the house: the first 6 m behind the front
  let under = 0, m = 0;
  for (let x = 0.8; x <= 6; x += 1) for (let z = -0.5; z <= 2.5; z += 1) { m++; const [wx, wz] = toW(f, x, z); if (inPoly(wx, wz, host.c.map((p) => [p.x, p.y]))) under++; }
  return { bad, street: street / n, under: under / m };
}
function report(name: string, host: TownLot, u: number) {
  const f = frame(host, u), h = holeOk(f, host);
  console.log(name, 'host lot', host.id, JSON.stringify({ x: +f.x.toFixed(3), z: +f.z.toFixed(3), rot: +f.rot.toFixed(6) }), 'hole/lot overlaps', h.bad, 'hole on street', h.street.toFixed(2), 'chamber under host', h.under.toFixed(2));
  return h;
}
// San Pietro: the stair runs along the church's street front, its footbridge (local z ~0.24)
// before the church door.
const pietro = L.lots.find((l) => l.explore?.id === 'sanctusPetrusForum')!;
{
  const fr = interiorFrame({ c: pietro.c.map((p) => [p.x, p.y] as P2), front: { a: [pietro.front!.a.x, pietro.front!.a.y], b: [pietro.front!.b.x, pietro.front!.b.y], out: [pietro.front!.out.x, pietro.front!.out.y] }, h: pietro.h, street: pietro.street ?? 2, seed: 1000 + pietro.id * 7919, explore: pietro.explore });
  report('PACCA_SITE', pietro, fr.door - 0.24);
}
// Triggio: the house front nearest the former site whose lane takes the stair.
const T: P2 = [55.21, -5.62];
let best: { l: TownLot; u: number; d: number } | null = null;
for (const l of L.lots) {
  if (!l.front || l.explore) continue;
  const Lf = l.front.a.distanceTo(l.front.b);
  if (Lf < 4.5) continue;
  for (const t of [0.35, 0.5, 0.65]) {
    const f = frame(l, Lf * t), d = Math.hypot(f.x - T[0], f.z - T[1]);
    if (best && d >= best.d) continue;
    const h = holeOk(f, l);
    if (h.bad === 0 && h.street > 0.95 && h.under > 0.6) best = { l, u: Lf * t, d };
  }
}
if (best) { report('triggioBurials', best.l, best.u); console.log('  distance from former site', best.d.toFixed(1)); }

