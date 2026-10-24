import * as THREE from 'three';
import { Builder, rng } from './builder';
import type { MatName } from './materials';
import { shared } from './materials';
import { noiseGLSL, atmosGLSL } from './shaders';
import { arcadeGeo, ruinGeo, ruin, column, fallenDrum } from './shapes';
import { brazier, lucerna } from './lights';
import { displacePositions, terrain } from './displace';
import { placeProp, commitProps, type PropId } from './props';

// The thermae: an imperial bath hall four centuries old, abandoned for two,
// quarried for its marble ever since. One groin-vaulted bay of the
// frigidarium still stands 17 m up on brick piers; the other has fallen
// and lies in heaps on the mosaic. West, the natatio holds black rain
// water; north-east, the caldarium rotunda has lost its dome and its floor,
// showing the hypocaust stacks underneath.
//
// Footprint: x ∈ [-48, -18], z ∈ [12, 36]; entrance on the east at z ≈ 29.5,
// on the axis of the surviving vault.

const rand = rng(31415);
const R = (a: number, b: number) => a + (b - a) * rand();
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Floor level of the baths: the whole complex stands on a raised platform. */
const FL = 1.4;
/** Vault springing and half-span of the frigidarium bays. */
const SPRING = 12, A = 5;
const HX0 = -36, HX1 = -26; // frigidarium, along z: two 10 m bays
const BAYS = [19, 29];      // bay centres (z)

/** Arrival just inside the east entrance, looking west into the frigidarium. */
export const BATHS_SPOT = { x: -20.6, z: 29.5, yaw: Math.PI / 2 };

export function buildBaths(b: Builder, scene: THREE.Scene): void {
  platform(b);
  frigidarium(b);
  natatio(b, scene);
  caldarium(b);
  tepidarium(b);
  outerWalls(b);
  debris(b);
  mosaics(scene);
  commitProps(scene);
}

// ------------------------------------------------------------------ platform

function platform(b: Builder) {
  // Frigidarium floor.
  b.box('rubble', HX1 - HX0 + 0.4, FL, 20.6, (HX0 + HX1) / 2, 0, 24);
  // Walkways around the natatio (north, south, east strip next to the hall).
  b.box('rubble', 11.6, FL, 2.4, -42, 0, 34.6);
  b.box('rubble', 11.6, FL, 2.6, -42, 0, 13.3);
  b.box('rubble', 1.4, FL, 18, -36.9, 0, 24);
  // Vestibule (north-east), with a sunken patch where the floor fell into the hypocaust.
  b.box('rubble', 6.4, FL, 6.6, -22.8, 0, 27.3);
  b.box('rubble', 2.0, FL, 4.8, -25, 0, 32.9);
  b.box('rubble', 1.8, FL, 4.8, -20.5, 0, 32.9);
  b.box('rubble', 2.6, FL, 0.9, -22.7, 0, 35.0);
  hypocaust(b, -24, -21.4, 30.6, 34.6, 0.62);
  // Entrance steps from the lane.
  for (let i = 0; i < 5; i++) {
    const h = (i + 1) * (FL / 5);
    b.box('marble', 0.42, h, 4.0 - i * 0.07, -18.2 - i * 0.36, 0, 29.5 + R(-0.05, 0.05), R(-0.02, 0.02));
  }
}

/** Rows of short brick stacks (pilae) that once carried the hot floor. */
function hypocaust(b: Builder, x0: number, x1: number, z0: number, z1: number, step: number) {
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
    if (rand() < 0.12) continue;
    const h = rand() < 0.25 ? R(0.3, 0.9) : FL - 0.12;
    b.box('brick', 0.24, h, 0.24, x + R(-0.03, 0.03), 0, z + R(-0.03, 0.03), R(-0.08, 0.08), h > 0.8);
    if (h > 1.1 && rand() < 0.5) b.box('brick', 0.5, 0.06, 0.5, x, h, z, R(0, 1), false);
  }
}

// ------------------------------------------------------------------ vaults

/**
 * A shell sampled on a (u,v) grid: inner surface `inner(u,v)`, thickness along
 * `off(u,v)`, only cells where `keep(i,j)` is true. Faces are wound so the inner
 * surface faces `towards` (the air), and broken edges get rims, so the
 * masonry's thickness shows wherever the vault has fallen.
 */
function shell(nu: number, nv: number, inner: (u: number, v: number) => THREE.Vector3, off: (u: number, v: number) => THREE.Vector3,
  keep: (i: number, j: number) => boolean, towards: (p: THREE.Vector3) => THREE.Vector3) {
  const pos: number[] = [];
  const idx: number[] = [];
  const P: THREE.Vector3[][] = [], Q: THREE.Vector3[][] = [];
  for (let j = 0; j <= nv; j++) {
    P.push([]); Q.push([]);
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const p = inner(u, v);
      P[j].push(p);
      Q[j].push(p.clone().add(off(u, v)));
    }
  }
  const tri = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3, want: THREE.Vector3) => {
    const n = b2.clone().sub(a).cross(c.clone().sub(a));
    const base = pos.length / 3;
    if (n.dot(want) >= 0) pos.push(a.x, a.y, a.z, b2.x, b2.y, b2.z, c.x, c.y, c.z);
    else pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b2.x, b2.y, b2.z);
    idx.push(base, base + 1, base + 2);
  };
  const quad = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, want: THREE.Vector3) => {
    tri(a, b2, c, want); tri(a, c, d, want);
  };
  const k = (i: number, j: number) => i >= 0 && j >= 0 && i < nu && j < nv && keep(i, j);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (!k(i, j)) continue;
    const c = P[j][i].clone().add(P[j + 1][i + 1]).multiplyScalar(0.5);
    const air = towards(c);
    quad(P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i], air);
    quad(Q[j][i], Q[j][i + 1], Q[j + 1][i + 1], Q[j + 1][i], air.clone().negate());
    // Rims along broken edges (and along the shell's own border).
    const edges: [number, number, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      [i, j - 1, P[j][i], P[j][i + 1], Q[j][i + 1], Q[j][i]],
      [i, j + 1, P[j + 1][i], P[j + 1][i + 1], Q[j + 1][i + 1], Q[j + 1][i]],
      [i - 1, j, P[j][i], P[j + 1][i], Q[j + 1][i], Q[j][i]],
      [i + 1, j, P[j][i + 1], P[j + 1][i + 1], Q[j + 1][i + 1], Q[j][i + 1]],
    ];
    const cq = c.clone().add(Q[j][i].clone().sub(P[j][i]).multiplyScalar(0.5));
    for (const [ni, nj, a, b2, cc, d] of edges) {
      if (k(ni, nj)) continue;
      const mid = a.clone().add(b2).add(cc).add(d).multiplyScalar(0.25);
      quad(a, b2, cc, d, mid.sub(cq));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  // Weld coincident vertices of the curved faces for smooth shading.
  return weld(g);
}

/** Merge vertices that share position *and* face direction (keeps creases). */
function weld(g: THREE.BufferGeometry) {
  const p = g.attributes.position.array as Float32Array;
  const map = new Map<string, number>();
  const np: number[] = [], remap = new Int32Array(p.length / 3);
  // Per-vertex face normal sign bucket, so rims don't smear into the vault surface.
  const idx = g.index!.array;
  const fn = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b2 = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b2] - p[a], uy = p[b2 + 1] - p[a + 1], uz = p[b2 + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const o of [a, b2, c]) { fn[o] = nx / l; fn[o + 1] = ny / l; fn[o + 2] = nz / l; }
  }
  for (let i = 0; i < p.length / 3; i++) {
    const key = `${Math.round(p[i * 3] * 200)},${Math.round(p[i * 3 + 1] * 200)},${Math.round(p[i * 3 + 2] * 200)},${Math.round(fn[i * 3] * 2)},${Math.round(fn[i * 3 + 1] * 2)},${Math.round(fn[i * 3 + 2] * 2)}`;
    let n = map.get(key);
    if (n === undefined) { n = np.length / 3; map.set(key, n); np.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); }
    remap[i] = n;
  }
  const ni = Array.from(idx, (i) => remap[i]);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(np.length), 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((np.length / 3) * 2), 2));
  out.setIndex(ni);
  return out;
}

/** Cheap 2D value noise for masks. */
function n2(x: number, y: number, seed: number) {
  const h = (a: number, c: number) => {
    const s = Math.sin(a * 127.1 + c * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - w) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * w;
}

/**
 * Groin vault over a square bay (centre cx,cz, half-span a): the air is the
 * union of two crossing barrel vaults, so the intrados is the higher of the
 * two; groins form along the diagonals. `keep(u,v)` with u,v ∈ [-1,1].
 */
function groinVault(b: Builder, cx: number, cz: number, a: number, spring: number, thick: number, keep: (u: number, v: number) => boolean) {
  const n = 30;
  const inner = (s: number, t: number) => {
    const u = (s * 2 - 1) * a, w = (t * 2 - 1) * a;
    const y1 = Math.sqrt(Math.max(0, a * a - w * w)), y2 = Math.sqrt(Math.max(0, a * a - u * u));
    return v3(cx + u, spring + Math.max(y1, y2), cz + w);
  };
  // Thicker over the haunches, as built.
  const off = (s: number, t: number) => {
    const e = Math.max(Math.abs(s * 2 - 1), Math.abs(t * 2 - 1));
    return v3(0, thick * (1 + 0.8 * e * e), 0);
  };
  const geo = shell(n, n, inner, off, (i, j) => keep((i + 0.5) / n * 2 - 1, (j + 0.5) / n * 2 - 1), (p) => v3(cx, spring - 3, cz).sub(p));
  b.add(geo, 'brick', undefined, false, true);
}

/** Spherical dome shell over a rotunda (centre, radius, springing), partly fallen in. */
function dome(b: Builder, cx: number, cz: number, r: number, spring: number, thick: number, keep: (az: number, el: number) => boolean) {
  const nu = 40, nv = 12;
  const inner = (s: number, t: number) => {
    const az = s * Math.PI * 2, el = t * Math.PI / 2 * 0.97;
    return v3(cx + Math.cos(az) * Math.cos(el) * r, spring + Math.sin(el) * r, cz + Math.sin(az) * Math.cos(el) * r);
  };
  const off = (s: number, t: number) => {
    const az = s * Math.PI * 2, el = t * Math.PI / 2 * 0.97;
    return v3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(thick);
  };
  const geo = shell(nu, nv, inner, off, (i, j) => keep((i + 0.5) / nu * Math.PI * 2, (j + 0.5) / nv), (p) => v3(cx, spring, cz).sub(p));
  b.add(geo, 'brick', undefined, false, true);
}

// ------------------------------------------------------------------ thermal windows

/**
 * A lunette wall under a vault arch (radius r, centred at local x=0, base y=0)
 * pierced by a thermal window: a semicircle split in three lights by two
 * mullions. Built along local x, extruded `depth` along z.
 */
function lunetteGeo(r: number, depth: number, broken = 0) {
  const s = new THREE.Shape();
  const seg = 28;
  s.moveTo(-r, 0);
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI - (i / seg) * Math.PI;
    let rr = r;
    if (broken > 0 && a < Math.PI * broken) rr = r * (0.55 + 0.25 * n2(i * 0.7, 3, 5));
    s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.lineTo(-r, 0);
  const ri = r - 0.55, sill = 0.45, mw = 0.22;
  const xs = [-ri, -ri / 3 - mw, -ri / 3 + mw, ri / 3 - mw, ri / 3 + mw, ri];
  for (let k = 0; k < 3; k++) {
    const xa = xs[k * 2], xb = xs[k * 2 + 1];
    if (broken > 0 && k === 2) continue;
    const h = new THREE.Path();
    h.moveTo(xa, sill);
    h.lineTo(xb, sill);
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const x = xb + (xa - xb) * (i / steps);
      h.lineTo(x, Math.max(sill + 0.2, Math.sqrt(Math.max(0, ri * ri - x * x))));
    }
    h.lineTo(xa, sill);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ------------------------------------------------------------------ frigidarium

function frigidarium(b: Builder) {
  const PIER = 2.6;
  const zs = [14, 24, 34];
  // Massive brick piers with a marble impost and an engaged granite or
  // marble column on the inner face; some columns are gone, one lies broken.
  for (const x of [HX0, HX1]) for (const z of zs) {
    const tall = !(z === 14 && x === HX1);
    const h = tall ? SPRING : R(6, 8.5);
    if (tall) b.box('brick', PIER, h - FL, PIER, x, FL, z, R(-0.015, 0.015));
    else ruin(b, 'brick', PIER, h - FL, PIER, x, FL, z, 0.1, 0.4);
    if (tall) b.box('marble', PIER + 0.5, 0.55, PIER + 0.5, x, SPRING - 0.55, z, 0.01);
    // Patches of the old marble skin, with clamp holes where the rest was prised off.
    for (let k = 0; k < 3; k++) {
      const side = rand() < 0.5 ? -1 : 1;
      const py = R(FL + 0.6, h - 2);
      b.box('marble', 0.06, R(0.6, 1.6), R(0.6, 1.4), x + side * (PIER / 2 + 0.02), py, z + R(-0.6, 0.6), 0, false);
      for (let c = 0; c < 4; c++) b.box('iron', 0.05, 0.07, 0.07, x + side * (PIER / 2 + 0.02), R(FL + 0.5, h - 1), z + R(-1.1, 1.1), 0, false);
    }
    const inward = x === HX0 ? 1 : -1;
    const cx = x + inward * (PIER / 2 + 0.55);
    const roll = rand();
    if (z === 14 && x === HX0) continue; // column carted off
    const m: MatName = roll < 0.5 ? 'stone' : 'marble';
    if (z === 24 && x === HX1) column(b, cx, FL, z, 10.4, 0.62, 0.35, m);
    else column(b, cx, FL, z, SPRING - FL - 0.15, 0.62, 0, m);
  }
  // The north bay's vault survives, holed on its east side; of the south bay
  // only the springers cling to the piers.
  groinVault(b, (HX0 + HX1) / 2, BAYS[1], A, SPRING, 0.9, (u, v) => {
    const hole = Math.hypot(u - 0.55, v + 0.15) + (n2(u * 4, v * 4, 1) - 0.5) * 0.5;
    return hole > 0.42;
  });
  groinVault(b, (HX0 + HX1) / 2, BAYS[0], A, SPRING, 0.9, (u, v) => {
    const corner = Math.min(Math.hypot(u - 1, v - 1), Math.hypot(u + 1, v - 1), Math.hypot(u - 1, v + 1), Math.hypot(u + 1, v + 1));
    return corner + (n2(u * 5, v * 5, 2) - 0.5) * 0.3 < (v > 0 ? 0.62 : 0.4);
  });
  // Long walls below the springing: a great arch per bay opens west onto the
  // natatio and east onto the vestibule and caldarium. Above them, the thermal
  // windows in their lunettes.
  for (const [i, zc] of BAYS.entries()) {
    for (const x of [HX0, HX1]) {
      const ry = Math.PI / 2;
      const openW = 5.2, spring = 5.6;
      const L = 10 - 2.6 + 0.4;
      if (!(i === 0 && x === HX1)) b.geo('brick', arcadeGeo(L, SPRING - FL, 1.4, 1, openW, spring), x, FL, zc, ry);
      else b.geo('brick', ruinGeo(L, SPRING - FL - 3, 1.4, 0.5, openW, spring), x, FL, zc, ry);
      const brokenL = i === 0 ? 0.55 : x === HX1 ? 0.3 : 0;
      if (!(i === 0 && x === HX1)) b.geo('brick', lunetteGeo(A, 1.3, brokenL), x, SPRING, zc, ry, false);
    }
  }
  // North end: a solid wall with the lunette window and a statue niche.
  b.box('brick', 7.6, SPRING - FL, 1.6, (HX0 + HX1) / 2, FL, 34.6);
  b.geo('brick', lunetteGeo(A, 1.6, 0), (HX0 + HX1) / 2, SPRING, 34.6, 0, false);
  niche(b, (HX0 + HX1) / 2 + 0.4, 33.8);
  // South end: the façade wall broke away; a jagged fragment with half an arch.
  b.geo('brick', ruinGeo(8.2, SPRING - FL - 1, 1.6, 0.6, 4.8, 4.6), (HX0 + HX1) / 2 - 0.3, FL, 13.4, 0.02);
}

/** A statue niche with a headless draped torso, three lamps and an offering. */
function niche(b: Builder, x: number, z: number) {
  // Recess frame: two pilasters and an arched head proud of the wall.
  b.geo('marble', arcadeGeo(2.4, 4.4, 0.35, 1, 1.6, 2.9), x, FL, z - 0.15, 0, false);
  b.box('marble', 1.4, 0.9, 0.8, x, FL, z - 0.15);
  // Headless torso: a lathe of hips, waist and chest, flattened front to back,
  // with stumps of the arms and the neck, broken at mid-thigh.
  const prof: THREE.Vector2[] = [
    [0.0, 0], [0.17, 0.0], [0.19, 0.25], [0.21, 0.5], [0.2, 0.7], [0.16, 0.86], [0.17, 1.0], [0.2, 1.18], [0.21, 1.32], [0.18, 1.42], [0.09, 1.5], [0.06, 1.6], [0.0, 1.62],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  // A Roman portrait bust (scan) left on the plinth; failing that, the torso.
  if (!placeProp(null, 'marble_bust_01', x, FL + 0.9, z - 0.25, Math.PI + 0.25, 1.75, { collide: b })) {
    const torso = new THREE.LatheGeometry(prof, 16);
    torso.scale(1.25, 1, 0.72);
    b.geo('marble', torso, x, FL + 0.9, z - 0.25, R(-0.15, 0.15), true);
    for (const s of [-1, 1]) {
      b.geo('marble', new THREE.CylinderGeometry(0.07, 0.08, 0.35, 8), x + s * 0.3, FL + 0.9 + 1.28, z - 0.25, 0, false, 0, s * 0.5);
    }
    b.box('marble', 0.18, 1.2, 0.18, x - 0.26, FL + 0.9 + 0.2, z - 0.05, 0.2, false, 0.1, 0.12);
  }
  // Somebody comes here: three lamps alight, and a skull at the statue's feet.
  lucerna(b, x - 0.5, FL + 0.9, z + 0.05, 0.4);
  lucerna(b, x + 0.45, FL + 0.9, z + 0.1, -0.2);
  lucerna(b, x + 0.05, FL + 0.9, z + 0.25, 0.1, false, false);
  b.prop('skull', x + 0.2, FL + 0.9, z + 0.18, Math.PI + 0.3, 0, 0.1, 0.95);
}

// ------------------------------------------------------------------ natatio

function natatio(b: Builder, scene: THREE.Scene) {
  const x0 = -47.4, x1 = -37.6, z0 = 14.6, z1 = 33.4;
  // Marble lining on the pool's inner faces, cracked and missing in places.
  const lining = (x: number, z: number, w: number, d: number) => {
    const n = Math.ceil(Math.max(w, d) / 1.2);
    for (let i = 0; i < n; i++) {
      if (rand() < 0.22) continue;
      const t = (i + 0.5) / n - 0.5;
      b.box('marble', w > d ? w / n - 0.04 : 0.08, FL - R(0, 0.35), d > w ? d / n - 0.04 : 0.08, x + (w > d ? t * w : 0), 0, z + (d > w ? t * d : 0), R(-0.02, 0.02), false);
    }
  };
  lining((x0 + x1) / 2, z0 + 0.04, x1 - x0, 0.1);
  lining((x0 + x1) / 2, z1 - 0.04, x1 - x0, 0.1);
  lining(x1 - 0.04, (z0 + z1) / 2, 0.1, z1 - z0);
  // Steps down into the water at the north end.
  for (let i = 0; i < 4; i++) {
    const h = FL - (i + 1) * (FL / 5);
    b.box('marble', x1 - x0 - 0.2, h, 0.45, (x0 + x1) / 2, 0, z1 - 0.25 - i * 0.45, R(-0.01, 0.01));
  }
  // A column fell across the pool and lies there, one end on the edge.
  b.geo('marble', new THREE.CylinderGeometry(0.55, 0.6, 10.5, 16, 6), -42.6, 1.0, 22.5, 0.35, true, 0, Math.PI / 2 + 0.12);
  // West wall of the court: high, broken, its niches empty.
  ruin(b, 'brick', 19.2, 9.5, 1.6, x0 - 0.8, 0, 24, Math.PI / 2, 0.55);
  for (const z of [18, 24.5, 30]) b.box('iron', 0.3, 2.0, 1.1, x0 + 0.05, 2.4, z, 0, false);
  // Black, still water with leaves and a floating plank.
  const ty = terrain((x0 + x1) / 2, (z0 + z1) / 2);
  const wg = new THREE.PlaneGeometry(x1 - x0, z1 - z0 - 2.0, 40, 70).rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wg, waterMaterial());
  water.position.set((x0 + x1) / 2, ty + 0.62, (z0 + z1) / 2 - 1.0);
  water.renderOrder = 1;
  scene.add(water);
  for (let i = 0; i < 22; i++) {
    const x = R(x0 + 0.5, x1 - 0.5), z = R(z0 + 0.5, z1 - 2.5);
    b.box(rand() < 0.15 ? 'wood' : 'roof', rand() < 0.15 ? R(0.6, 1.4) : R(0.06, 0.14), 0.02, R(0.06, 0.25), x, 0.6, z, R(0, 3), false);
  }
  brazier(b, -37.2, 31.2, FL);
}

// ------------------------------------------------------------------ caldarium

function caldarium(b: Builder) {
  const cx = -22.0, cz = 17.2, r = 3.5, H = 8.4, T = 1.1;
  // Ring wall of brick piers, open to the west towards the frigidarium.
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (Math.cos(a) < -0.86) continue; // doorway
    const h = Math.sin(a) > 0.3 && Math.cos(a) > 0.2 ? H * R(0.45, 0.7) : H - R(0, 0.6);
    b.box('brick', 1.15, h, T, cx + Math.cos(a) * (r + T / 2), 0, cz + Math.sin(a) * (r + T / 2), Math.PI / 2 - a);
  }
  // Half the dome has fallen in; a ragged lip remains on the south.
  dome(b, cx, cz, r + 0.2, H - 0.2, 0.75, (az, el) => {
    const north = Math.sin(az) < 0.15 + (n2(az * 3, el * 4, 7) - 0.5) * 0.7;
    return north && el < 0.85 - (n2(az * 5, 1, 9)) * 0.35;
  });
  // Raised floor around the edge; the middle collapsed into the hypocaust.
  const s = new THREE.Shape();
  s.absarc(0, 0, r + 0.05, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const rr = 2.05 + (n2(i * 0.9, 2, 3) - 0.5) * 0.7;
    if (i === 0) hole.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else hole.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.holes.push(hole);
  const ring = new THREE.ExtrudeGeometry(s, { depth: FL, bevelEnabled: false, curveSegments: 20 });
  ring.rotateX(-Math.PI / 2);
  b.geo('slab', ring, cx, 0, cz);
  hypocaust(b, cx - 2.1, cx + 2.1, cz - 2.1, cz + 2.1, 0.55);
  // Praefurnium: the low stoking arch outside, still black with soot.
  b.geo('brick', arcadeGeo(1.8, 1.7, 1.2, 1, 0.8, 0.7), cx + r + 0.9, 0, cz - 0.6, Math.PI / 2, true);
  b.box('iron', 0.9, 0.9, 0.5, cx + r + 0.3, 0, cz - 0.6, Math.PI / 2, false);
  // Bath tub (alveus) in the south apse niche, its marble cracked.
  b.box('marble', 2.2, 0.9, 1.0, cx - 0.4, FL, cz + 2.7, 0.08);
}

// ------------------------------------------------------------------ tepidarium & vestibule

function tepidarium(b: Builder) {
  // The caldarium court (south-east): its walls up to where the vaults sprang.
  ruin(b, 'brick', 8.2, 7.5, 1.0, -22.4, 0, 12.5, 0.01, 0.5);
  ruin(b, 'brick', 11.0, 8.8, 1.1, -18.5, 0, 18.0, Math.PI / 2, 0.45);
  // Vestibule east wall, either side of the entrance arch.
  b.box('brick', 1.2, 9.6, 3.6, -18.5, 0, 25.5);
  b.geo('brick', arcadeGeo(5.4, 9.2, 1.2, 1, 4.0, 4.4), -18.5, 0, 29.5, Math.PI / 2);
  b.box('brick', 1.2, 7.8, 3.6, -18.5, 0, 33.8, 0.02);
  // Wall between vestibule and caldarium court.
  ruin(b, 'brick', 7.2, 6.4, 0.9, -22.4, 0, 23.7, 0.02, 0.4);
}

// ------------------------------------------------------------------ outer walls

function outerWalls(b: Builder) {
  // North: behind the natatio, a long brick wall with the springer of a
  // vanished vault leaning out.
  ruin(b, 'brick', 11.6, 10.5, 1.3, -42, 0, 35.9, 0.0, 0.5);
  // South: low, mostly robbed out.
  ruin(b, 'brick', 11.6, 4.2, 1.2, -42, 0, 12.1, 0.0, 0.7);
  ruin(b, 'rubble', 6, 2.5, 1.0, -30.5, 0, 12.2, 0.05, 0.8);
  // Caldarium court north wall.
  ruin(b, 'brick', 8.4, 7.5, 1.0, -22.2, 0, 35.8, 0.0, 0.5);
  // Buttress mass against the south-west corner.
  b.box('brick', 3.4, 7, 3.0, -46.6, 0, 13.6, 0.04);
}

// ------------------------------------------------------------------ debris

function debris(b: Builder) {
  // The fallen south vault: slabs of brick masonry still bonded together,
  // tilted and broken on the mosaic, and a heap of rubble.
  for (let i = 0; i < 9; i++) {
    const x = R(HX0 + 1.6, HX1 - 1.6), z = R(15.5, 22.5);
    b.box('brick', R(1.2, 3.2), R(0.5, 1.0), R(1.0, 2.4), x, FL - 0.2, z, R(0, 3), true, R(-0.4, 0.4), R(-0.4, 0.4));
  }
  for (let i = 0; i < 4; i++) {
    const g = new THREE.ConeGeometry(R(1.4, 2.4), R(0.8, 1.6), 9, 2);
    b.geo('rubble', g, R(HX0 + 1.5, HX1 - 1.5), FL + 0.3, R(15, 22), R(0, 3), true, R(-0.1, 0.1), R(-0.1, 0.1));
  }
  // Column drums rolled about.
  fallenDrumAt(b, -29.6, FL, 21.4, 0.6, 1.4, 0.4);
  fallenDrumAt(b, -32.4, FL, 26.1, 0.6, 1.1, 1.9);
  fallenDrumAt(b, -27.9, FL, 27.6, 0.55, 2.3, 2.6);
  // A stack of marble the spoilers left behind, near the entrance.
  for (let i = 0; i < 4; i++) b.box('marble', R(1.2, 1.8), 0.2, R(0.5, 0.8), -21.4 + R(-0.2, 0.2), FL + i * 0.2, 25.6 + R(-0.1, 0.1), R(-0.2, 0.2));
  // Stones outside, by the lane.
  fallenDrum(b, -16.6, 21.6, 0.45, 1.2, 0.9);
  overgrowth(b);
}

/**
 * Scanned rubble, mossy stones, weeds and a sapling or two: two centuries of
 * nobody sweeping. Stones gather where the vault fell and along the walls,
 * plants where water drips and soil collects.
 */
function overgrowth(b: Builder) {
  const P = (id: PropId, x: number, y: number, z: number, ry: number, s: number, collide = false, tilt?: [number, number]) =>
    placeProp(null, id, x, y, z, ry, s, { collide: collide ? b : undefined, tilt });
  // Fallen-vault field: mossy stones and broken bits around the brick slabs.
  for (let i = 0; i < 16; i++) {
    const x = R(HX0 + 1.2, HX1 - 1.2), z = R(14.8, 23.5);
    P('rock_moss_set_01', x, FL, z, R(0, 6), R(0.5, 0.9), false, [R(-0.2, 0.2), R(-0.2, 0.2)]);
  }
  for (let i = 0; i < 26; i++) {
    const x = R(HX0 + 0.8, HX1 - 0.8), z = R(14.5, 24);
    P(i % 2 ? 'rock_moss_set_02' : 'rock_moss_set_01', x, FL, z, R(0, 6), R(0.25, 0.55), false, [R(-0.4, 0.4), R(-0.4, 0.4)]);
  }
  for (let i = 0; i < 30; i++) P('rock_moss_set_02', R(HX0 + 0.6, HX1 - 0.6), FL, R(14.5, 33), R(0, 6), R(0.15, 0.3));
  // Along the foot of the walls and piers: weeds, nettles, ferns in the damp.
  const edge: [number, number][] = [];
  for (let z = 14.5; z < 34; z += R(0.8, 1.6)) { edge.push([HX0 + R(0.3, 0.8), z], [HX1 - R(0.3, 0.8), z]); }
  for (let x = HX0 + 0.5; x < HX1; x += R(0.9, 1.6)) edge.push([x, 33.6 - R(0, 0.4)]);
  edge.forEach(([x, z], i) => {
    const r = rand();
    if (r < 0.3) P('nettle_plant', x, FL, z, R(0, 6), R(3, 5));
    else if (r < 0.55) P('weed_plant_02', x, FL, z, R(0, 6), R(2.5, 4));
    else if (r < 0.72) P('fern_02', x, FL, z, R(0, 6), R(0.7, 1.1));
    else if (r < 0.82) P('grass_medium_02', x, FL, z, R(0, 6), R(0.6, 0.9));
    else if (r < 0.88 && i % 3 === 0) P('shrub_02', x, FL, z, R(0, 6), R(0.5, 0.8));
  });
  // Dead branches blown in, bark and twigs.
  for (let i = 0; i < 10; i++) P('dry_branches_medium_01', R(HX0 + 1, HX1 - 1), FL, R(15, 33), R(0, 6), R(1, 1.6));
  // Outside by the lane: a boulder of spolia core and weeds.
  P('rock_moss_set_02', -17.2, 0, 17.4, 0.4, 1.4, true);
  P('weed_plant_02', -17.6, 0, 19.2, 1.0, 3.5);
  P('nettle_plant', -16.9, 0, 26.4, 2.0, 4);
}

function fallenDrumAt(b: Builder, x: number, y: number, z: number, r: number, len: number, ry: number) {
  b.geo('marble', new THREE.CylinderGeometry(r, r * 0.97, len, 16, 2), x, y + r * 0.92, z, ry, true, 0, Math.PI / 2);
}

// ------------------------------------------------------------------ materials

const fogVert = (sh: THREE.WebGLProgramParametersWithUniforms) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
};

/** Dark stagnant water: the only thing in the ruin that gives back the sky. */
function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x030404, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.96 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    fogVert(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 q = vWorldPos.xz;
          float e = 0.05;
          float h0 = vnoise(vec3(q*2.2, uTime*0.15)) + 0.5*vnoise(vec3(q*6.0, uTime*0.3));
          float hx = vnoise(vec3((q+vec2(e,0.))*2.2, uTime*0.15)) + 0.5*vnoise(vec3((q+vec2(e,0.))*6.0, uTime*0.3));
          float hz = vnoise(vec3((q+vec2(0.,e))*2.2, uTime*0.15)) + 0.5*vnoise(vec3((q+vec2(0.,e))*6.0, uTime*0.3));
          vec3 nw = normalize(vec3(-(hx-h0)/e*0.03, 1.0, -(hz-h0)/e*0.03));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float scum = smoothstep(0.55, 0.8, fbm(vec3(vWorldPos.xz*0.6, 2.)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05,0.07,0.035), scum*0.8);`)
      .replace('#include <fog_fragment>', `{
          // No environment map in the world: reflect the overcast sky by Fresnel.
          vec3 vdir = normalize(cameraPosition - vWorldPos);
          vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float fr = 0.03 + 0.97 * pow(1.0 - max(dot(vdir, nw), 0.0), 5.0);
          vec3 sky = mix(vec3(0.2,0.205,0.215), vec3(0.11,0.115,0.13), clamp(reflect(-vdir, nw).y * 1.6, 0., 1.));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, sky * 1.15, fr * 0.85);
        }
        gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWorldPos);`);
  };
  return m;
}

/**
 * Black-and-white Roman mosaic: tesserae on a grid, each coloured from the
 * design sampled at its centre (so the pattern really is made of stones);
 * a spiral meander band, a guilloche, and in the field a marine thiasos of
 * dolphins and fish round a medallion. Lacunae show the mortar bed, with
 * moss and mud in them.
 */
let stoneT: THREE.Texture | null = null;
function stoneTex() {
  if (stoneT) return stoneT;
  stoneT = new THREE.TextureLoader().load('textures/marble_a.webp');
  stoneT.colorSpace = THREE.SRGBColorSpace;
  stoneT.wrapS = stoneT.wrapT = THREE.RepeatWrapping;
  return stoneT;
}

function mosaicMaterial(cx: number, cz: number, hx: number, hz: number, motif: number) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.customProgramCacheKey = () => 'mosaic';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, {
      tStone: { value: stoneTex() },
      uC: { value: new THREE.Vector2(cx, cz) },
      uH: { value: new THREE.Vector2(hx, hz) },
      uMotif: { value: motif },
    });
    fogVert(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;
        uniform vec2 uC; uniform vec2 uH; uniform float uMotif;
        ${noiseGLSL}
        ${atmosGLSL}
        uniform sampler2D tStone;
        const vec3 WHITE = vec3(0.4,0.37,0.31), BLACK = vec3(0.045,0.045,0.05), RED = vec3(0.42,0.14,0.07), OCHRE = vec3(0.52,0.37,0.16), GREY = vec3(0.32,0.32,0.31);
        float bitAt(float row, float col){
          float r = row < 0.5 ? 62. : row < 1.5 ? 34. : row < 2.5 ? 42. : row < 3.5 ? 46. : row < 4.5 ? 32. : 63.;
          return mod(floor(r / exp2(5. - col)), 2.);
        }
        // Dolphin silhouette in local coords (snout at +x).
        float dolphin(vec2 q){
          q.y -= 0.32 * q.x * q.x - 0.12;
          float x = q.x;
          float w = x > -0.8 && x < 0.95 ? 0.19 * (1. - pow((x - 0.1) / 0.9, 2.)) + 0.02 : 0.;
          float body = step(abs(q.y), w);
          float snout = step(0.95, x) * step(x, 1.22) * step(abs(q.y + 0.02), 0.045);
          vec2 t = q - vec2(-0.86, 0.);
          float tail = step(length(vec2(t.x * 1.6, abs(t.y) - 0.14)), 0.12) * step(t.x, 0.05);
          float fin = step(abs(x - 0.05), 0.18 - (q.y - 0.18) * 0.9) * step(0.15, q.y) * step(q.y, 0.36);
          return max(max(body, snout), max(tail, fin));
        }
        float fish(vec2 q){
          float body = step(length(vec2(q.x * 0.55, q.y)), 0.13);
          vec2 t = q - vec2(-0.32, 0.);
          float tail = step(abs(t.y), -t.x * 0.9) * step(-0.18, t.x) * step(t.x, 0.0);
          return max(body, tail);
        }
        // Design colour at a point (local metres from the panel centre).
        vec3 design(vec2 p){
          vec2 ap = abs(p);
          float dx = uH.x - ap.x, dz = uH.y - ap.y;
          float d = min(dx, dz);
          float s = dx < dz ? p.y : p.x;
          if (d < 0.14) return BLACK;
          if (d < 0.24) return WHITE;
          if (d < 0.84) {
            float t = (d - 0.24) / 0.1;
            float col = mod(floor(s / 0.1), 6.);
            return bitAt(floor(t), col) > 0.5 ? BLACK : WHITE;
          }
          if (d < 0.94) return WHITE;
          if (d < 1.02) return BLACK;
          if (d < 1.5) {
            float t = (d - 1.02) / 0.48;
            float ph = s / 0.9 * 6.2832;
            float c1 = 0.5 + 0.3 * sin(ph), c2 = 0.5 - 0.3 * sin(ph);
            float a1 = abs(t - c1), a2 = abs(t - c2);
            bool over = cos(ph) > 0.;
            float a = over ? a1 : a2, b = over ? a2 : a1;
            if (a < 0.1) return a < 0.035 ? WHITE : a < 0.07 ? (over ? RED : OCHRE) : BLACK;
            if (b < 0.1) return b < 0.035 ? WHITE : b < 0.07 ? (over ? OCHRE : RED) : BLACK;
            return BLACK;
          }
          if (d < 1.58) return WHITE;
          if (d < 1.66) return BLACK;
          vec2 q = p;
          if (uMotif < 0.5) {
            // Medallion with a marine thiasos.
            float rad = min(uH.x, uH.y) - 2.0;
            float r = length(q);
            if (abs(r - rad) < 0.06) return BLACK;
            if (abs(r - rad + 0.16) < 0.03) return BLACK;
            if (r < rad - 0.2) {
              float a = atan(q.y, q.x);
              for (int k = 0; k < 5; k++) {
                float ak = float(k) * 1.2566 + 0.3;
                vec2 c = vec2(cos(ak), sin(ak)) * rad * 0.58;
                vec2 l = q - c;
                float ca = cos(ak + 1.5708), sa = sin(ak + 1.5708);
                vec2 lq = vec2(ca * l.x + sa * l.y, -sa * l.x + ca * l.y) / 1.05;
                if (dolphin(lq) > 0.5) return BLACK;
              }
              for (int k = 0; k < 7; k++) {
                float ak = float(k) * 0.8976 + 0.7;
                vec2 c = vec2(cos(ak), sin(ak)) * rad * (0.25 + 0.06 * float(k - 3 * (k / 3)));
                vec2 l = q - c;
                float ca = cos(ak * 2.3), sa = sin(ak * 2.3);
                vec2 lq = vec2(ca * l.x + sa * l.y, -sa * l.x + ca * l.y);
                if (fish(lq * 1.6) > 0.5) return BLACK;
              }
              // Rosette at the centre.
              float rr = length(q), pa = atan(q.y, q.x);
              if (rr < 0.55 && rr < 0.35 + 0.18 * abs(cos(pa * 4.))) return rr < 0.12 ? RED : BLACK;
              return WHITE;
            }
            // Field: black crosslets on white, a little uneven.
            vec2 g = mod(q + 0.3, 0.6) - 0.3;
            if ((abs(g.x) < 0.04 && abs(g.y) < 0.16) || (abs(g.y) < 0.04 && abs(g.x) < 0.16)) return BLACK;
            return WHITE;
          }
          // Imbricated scales.
          vec2 sc = q / vec2(0.5, 0.36);
          float row = floor(sc.y);
          sc.x += mod(row, 2.) * 0.5;
          vec2 f = fract(sc) - vec2(0.5, 0.0);
          float rr = length(f * vec2(1., 1.4));
          return rr > 0.46 && rr < 0.58 ? BLACK : (rr < 0.2 && mod(row, 3.) < 0.5 ? GREY : WHITE);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 lp = vWorldPos.xz - uC;
        // Real floor tesserae are 1.5-2 cm: small, irregular, each its own stone.
        const float TS = 0.019;
        vec2 cell = lp / TS;
        float row = floor(cell.y);
        cell.x += hash12(vec2(row, 3.)) * 0.6;           // rows of tesserae don't align
        vec2 id = floor(cell);
        vec2 f = fract(cell);
        vec2 cc = (id + 0.5 + (hash22(id) - 0.5) * 0.18);
        cc.x -= hash12(vec2(row, 3.)) * 0.6;
        vec3 tc = design(cc * TS);
        float tv = hash12(id * 1.7 + 4.);
        // Each tessera is cut from real stone: sample a scanned stone at a
        // random spot so its colour, veining and pitting differ.
        vec3 st = texture2D(tStone, (id + hash22(id * 3.1) * 37.) * 0.013 + f * 0.012).rgb;
        float stL = dot(st, vec3(0.299, 0.587, 0.114));
        tc *= (0.7 + 0.25 * tv) * (0.6 + 1.1 * stL);
        // Grout: irregular, rounded tesserae; fades out in the distance instead of aliasing.
        float fw = fwidth(lp.x) / TS;
        vec2 e = min(f, 1. - f) + (hash22(id + 7.) - 0.5) * 0.08;
        float round = length(max(vec2(0.18) - e, 0.)) / 0.18;
        float grout = max(1. - smoothstep(0.05, 0.13 + fw, min(e.x, e.y)), smoothstep(0.85, 1.0, round));
        grout *= 1. - smoothstep(0.3, 0.7, fw);
        vec3 col = mix(tc, vec3(0.2, 0.19, 0.17), grout * 0.8);
        // Lacunae: whole patches lost, showing the pinkish mortar bed and mud.
        float lac = fbm(vec3(vWorldPos.xz * 0.32, 5.)) + 0.25 * vnoise(vec3(vWorldPos.xz * 2.4, 1.));
        float hole = smoothstep(0.88, 0.9, lac);
        float loose = smoothstep(0.82, 0.88, lac) * step(0.55, tv);
        vec3 bed = mix(vec3(0.3, 0.24, 0.2), vec3(0.15, 0.12, 0.09), fbm(vec3(vWorldPos.xz * 3., 2.)));
        float moss = smoothstep(0.5, 0.75, fbm(vec3(vWorldPos.xz * 1.1, 7.)));
        bed = mix(bed, vec3(0.05, 0.08, 0.025), moss * 0.85);
        col = mix(col, bed, max(hole, loose * 0.8));
        // Grime and damp: darker toward the walls and in streaks.
        float grime = fbm(vec3(vWorldPos.xz * 0.5, 9.));
        col *= 0.42 + 0.45 * grime;
        // Dust and silt lie in the grout and over everything, greyer than the stone.
        col = mix(col, vec3(0.16, 0.15, 0.13), 0.25 + 0.2 * fbm(vec3(vWorldPos.xz * 1.7, 3.)));
        col = mix(col, col * vec3(0.7, 0.85, 0.6), smoothstep(0.6, 0.8, fbm(vec3(vWorldPos.xz * 0.9, 4.))) * 0.6);
        diffuseColor.rgb = col;
        float mH = (1. - grout) * 0.6 + (1. - max(hole, loose)) * 0.8;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.86, 1.0, max(grout, hole));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
          vec3 r1 = cross(dy, normal), r2 = cross(normal, dx);
          float det = dot(dx, r1);
          float k = 0.004 * (1. - smoothstep(4., 14., length(vViewPosition)));
          vec3 grad = sign(det) * (dFdx(mH) * k * r1 + dFdy(mH) * k * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWorldPos);');
  };
  return m;
}

/** A floor grid at the platform top, bent by the world field, with holes where the floor is gone. */
function mosaicFloor(scene: THREE.Scene, x0: number, x1: number, z0: number, z1: number, motif: number, skip: (x: number, z: number) => boolean) {
  const step = 0.5;
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) pos.push(x0 + i * step, FL + 0.02, z0 + j * step);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (skip(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
    const a = j * (nx + 1) + i, b2 = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b2, b2, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  displacePositions(g, 'slab');
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mosaicMaterial((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, motif));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function mosaics(scene: THREE.Scene) {
  // Frigidarium: the grand floor between the piers.
  mosaicFloor(scene, HX0 + 1.3, HX1 - 1.3, 14.6, 33.6, 0, () => false);
  // Vestibule and tepidarium: scales, with the collapsed patch over the hypocaust.
  mosaicFloor(scene, -26, -19.6, 24.1, 35.4, 1, (x, z) => x > -24 && x < -21.4 && z > 30.6 && z < 34.6);
}
