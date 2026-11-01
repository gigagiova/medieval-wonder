// Totals of a render audit (render.json), before vs after when given two.
//   node tools/holes/summarize-render.mjs before/render.json [after/render.json]
// A frame more than 40 % magenta is a camera standing inside a solid (a house
// one cannot enter, a pier: the teleport found the ground inside it), as the
// geometry audit's standing points: it is counted apart, in either run.
import { readFileSync } from 'node:fs';
const load = (f) => JSON.parse(readFileSync(f, 'utf8')).rows;
const inside = (r) => r.magenta > 0.4 * r.w * r.h;
const sum = (rows, skip) => {
  const ok = rows.filter((r) => !skip.has(`${r.id}|${r.yaw}|${r.pitch}`));
  return {
    views: ok.length, insideSkipped: rows.length - ok.length,
    magentaPx: ok.reduce((a, r) => a + r.magenta, 0), greenBelowPx: ok.reduce((a, r) => a + r.greenBelow, 0),
    viewsWithMagenta: ok.filter((r) => r.magenta > 0).length, viewsWithGreen: ok.filter((r) => r.greenBelow > 0).length,
    viewsOver100Magenta: ok.filter((r) => r.magenta > 100).length,
  };
};
const [a, b] = process.argv.slice(2).map(load);
// Skip a view if it is "inside" in either run, so both totals cover the same frames.
const skip = new Set([...a, ...(b ?? [])].filter(inside).map((r) => `${r.id}|${r.yaw}|${r.pitch}`));
const out = { before: sum(a, skip) };
if (b) {
  out.after = sum(b, skip);
  const key = (r) => `${r.id}|${r.yaw}|${r.pitch}`;
  const am = new Map(b.map((r) => [key(r), r]));
  out.worstBefore = a.filter((r) => !skip.has(key(r))).sort((x, y) => (y.magenta + y.greenBelow) - (x.magenta + x.greenBelow)).slice(0, 12)
    .map((r) => ({ view: key(r), file: r.file, before: { magenta: r.magenta, green: r.greenBelow }, after: am.has(key(r)) ? { magenta: am.get(key(r)).magenta, green: am.get(key(r)).greenBelow } : null }));
}
console.log(JSON.stringify(out, null, 1));
