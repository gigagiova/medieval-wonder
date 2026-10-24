import * as THREE from 'three';
const el = () => ({ addEventListener() {}, removeEventListener() {}, style: {}, getContext: () => null, setAttribute() {} });
(globalThis as any).document = { createElementNS: el, createElement: el };
(globalThis as any).self = globalThis;
const { Builder } = await import('./builder');
const { layoutTown, lotsFor, buildHouse, buildBridges } = await import('./town');
const V = (x: number, z: number) => new THREE.Vector2(x, z);
const wall: THREE.Vector2[] = []; for (let k = 0; k < 15; k++) { const th = k / 15 * Math.PI * 2; wall.push(V(70 * Math.sin(th), 70 * Math.cos(th))); }
let t = performance.now();
const town = layoutTown(wall, [], V(0, 68), V(-15, -28), V(68, 0));
const lots = lotsFor(town);
const b = new Builder();
const stats = new Map<string, [number, number]>();
const orig = b.add.bind(b);
b.add = (g, m, mat, col, fine, raw, proxy) => {
  const t0 = performance.now();
  orig(g, m, mat, col, fine, raw, proxy);
  const tris = b.parts.get(m)!.at(-1)!.attributes.position.count / 3;
  const k = m + (g.index ? '/idx' : '/ext') + (fine ? '/fine' : '');
  const s = stats.get(k) ?? [0, 0]; s[0] += performance.now() - t0; s[1] += tris; stats.set(k, s);
};
t = performance.now();
for (const l of lots) buildHouse(b, l);
console.log('houses', lots.length, (performance.now() - t).toFixed(0), 'ms');
t = performance.now(); buildBridges(b, town); console.log('bridges', (performance.now() - t).toFixed(0));
let tot = 0; for (const [, [, tr]] of stats) tot += tr;
console.log('total tris', tot);
console.log([...stats].sort((a, c) => c[1][1] - a[1][1]).slice(0, 14).map(([k, [ms, tr]]) => `${k}: ${ms.toFixed(0)}ms ${tr}`).join('\n'));
t = performance.now(); b.build(new THREE.Scene()); console.log('merge', (performance.now() - t).toFixed(0));
