// Porta Aurea: does the curtain run without a break up to the arch's piers on both sides, and
// does any house stand in the curtain's body there? Usage: npx tsx tools/check-aurea-curtain.ts
import { wallPlan } from '../src/benevento/fabric';
import { layoutTown } from '../src/benevento/layout';
import { SITES } from '../src/benevento/sites';
import { inPoly, type P2 } from '../src/benevento/geo';

const A = SITES.arcusTraiani;
const wp = wallPlan();
const near = wp.pieces.filter((p) => Math.hypot((p.a[0] + p.b[0]) / 2 - A.x, (p.a[1] + p.b[1]) / 2 - A.z) < 70);
// Order the pieces along the curtain and report gaps between consecutive ends.
const ends = near.map((p) => ({ p, da: Math.hypot(p.a[0] - A.x, p.a[1] - A.z), db: Math.hypot(p.b[0] - A.x, p.b[1] - A.z) }));
let bad = 0;
for (const e of ends) {
  const linkA = near.some((q) => q !== e.p && (Math.hypot(q.b[0] - e.p.a[0], q.b[1] - e.p.a[1]) < 0.05 || Math.hypot(q.a[0] - e.p.a[0], q.a[1] - e.p.a[1]) < 0.05));
  const linkB = near.some((q) => q !== e.p && (Math.hypot(q.a[0] - e.p.b[0], q.a[1] - e.p.b[1]) < 0.05 || Math.hypot(q.b[0] - e.p.b[0], q.b[1] - e.p.b[1]) < 0.05));
  const openA = !linkA, openB = !linkB;
  // A free end must be at the arch (its piers are ~4-6 m from its centre) or outside the 70 m window.
  for (const [open, d, pt] of [[openA, e.da, e.p.a], [openB, e.db, e.p.b]] as [boolean, number, P2][]) {
    if (!open) continue;
    const ok = d < 7.5 || d > 60;
    if (!ok) bad++;
    console.log(ok ? 'end ok ' : 'GAP    ', pt.map((v) => v.toFixed(1)).join(','), 'from the arch', d.toFixed(1), 'm');
  }
}
// Houses whose footprint crosses the curtain's 2.5 m body near the arch.
const L = layoutTown();
let clash = 0;
for (const p of near) {
  const L2 = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  for (let t = 0; t <= L2; t += 0.5) {
    const x = p.a[0] + (p.b[0] - p.a[0]) * (t / L2), z = p.a[1] + (p.b[1] - p.a[1]) * (t / L2);
    for (const l of L.lots) if (inPoly(x, z, l.c.map((q) => [q.x, q.y] as P2))) { clash++; break; }
  }
}
console.log('pieces within 70 m', near.length, 'gaps', bad, 'curtain samples inside a house', clash);
process.exit(bad ? 1 : 0);
