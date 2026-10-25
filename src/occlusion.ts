import * as THREE from 'three';
import { fastTerrain } from './displace';
import type { ChunkItems, LotData } from './benevento/fabric';

// Occlusion culling for the town: a small software depth buffer.
//
// Every frame the houses near the eye (their footprints as plain prisms,
// shrunk so they always lie inside the walls that are actually drawn) are
// rasterised into a 96-pixel-wide buffer that keeps, per pixel, the
// farthest depth the nearest house can have anywhere inside that pixel
// (stored as its inverse, so nearer is larger and empty is 0).
// A cell (its bounding box) is hidden only when every pixel of its screen
// rectangle, grown by one pixel on each side, holds a house nearer than the
// nearest corner of the box. Growing the rectangle makes the coarse pixels
// safe at house silhouettes: if any part of the box could show past an edge,
// the pixel beyond that edge is empty and the box stays. The only thing it
// can miss is a gap between two houses narrower than a buffer pixel (under
// half a degree), which at that distance is fog.
//
// Shrinking the prisms: walls are bent by the world field (up to ~0.3 m, plus
// a lean of 3 % of the height) and their tops sag under the roof, so every
// outer face of a footprint is pulled in by INSET and the top lowered by DROP.
// Faces shared with a neighbouring house (party walls) are left in place, so
// a row of houses stays one unbroken occluder.

const W = 96;
const INSET = 0.35, DROP = 0.6, NEAR = 0.15;
/** Houses farther than this are not drawn into the buffer (small on screen, little to gain). */
export const OCC_RANGE = 96;

// ------------------------------------------------------------ occluder prisms
/** Per chunk: [x0,z0, x1,z1, x2,z2, x3,z3, y0, y1] for each house. */
const prisms = new Map<number, Float32Array>();

/** Lot edges of the whole town, bucketed by 4 m cells, to find party walls. */
let edgeIndex: Map<number, number[]> | null = null;
let edgeData: Float32Array = new Float32Array(0);
const EB = 4;
const ek = (x: number, z: number) => Math.floor(x / EB) * 65536 + Math.floor(z / EB);

function indexLots(lots: Iterable<LotData>) {
  const data: number[] = [];
  edgeIndex = new Map();
  let id = 0;
  for (const l of lots) {
    for (let k = 0; k < 4; k++) {
      const [ax, az] = l.c[k], [bx, bz] = l.c[(k + 1) % 4];
      const e = data.length / 5;
      data.push(ax, az, bx, bz, id);
      // Register under every bucket the edge passes through (edges are short).
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (EB / 2)) + 1;
      const seen = new Set<number>();
      for (let s = 0; s <= n; s++) {
        const key = ek(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n);
        if (seen.has(key)) continue;
        seen.add(key);
        let list = edgeIndex.get(key);
        if (!list) edgeIndex.set(key, (list = []));
        list.push(e);
      }
    }
    id++;
  }
  edgeData = new Float32Array(data);
}

/** Does another lot have an edge on the same line, overlapping this one by 20 cm or more? */
function shared(ax: number, az: number, bx: number, bz: number, self: number) {
  if (!edgeIndex) return false;
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 1e-3) return false;
  const dx = (bx - ax) / L, dz = (bz - az) / L;
  const n = Math.ceil(L / (EB / 2)) + 1;
  for (let s = 0; s <= n; s++) {
    const list = edgeIndex.get(ek(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n));
    if (!list) continue;
    for (const e of list) {
      const o = e * 5;
      if (edgeData[o + 4] === self) continue;
      const cx = edgeData[o], cz = edgeData[o + 1], qx = edgeData[o + 2], qz = edgeData[o + 3];
      // Both ends on this edge's line…
      if (Math.abs((cx - ax) * dz - (cz - az) * dx) > 0.08 || Math.abs((qx - ax) * dz - (qz - az) * dx) > 0.08) continue;
      // …and overlapping it.
      const t0 = (cx - ax) * dx + (cz - az) * dz, t1 = (qx - ax) * dx + (qz - az) * dz;
      const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(L, Math.max(t0, t1));
      if (hi - lo > 0.2) return true;
    }
  }
  return false;
}

/** The occluder prisms of one chunk: its houses and stretches of town wall (built once). */
export function chunkPrisms(it: ChunkItems): Float32Array {
  let p = prisms.get(it.key);
  if (p) return p;
  const out: number[] = [];
  for (const l of it.lots) {
    if (l.explore || l.c.length !== 4) continue;
    const c = l.c;
    let cx = 0, cz = 0;
    for (const [x, z] of c) { cx += x / 4; cz += z / 4; }
    // Each edge as a line n·p = d with n pointing inwards, moved in unless shared.
    const lines: [number, number, number][] = [];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      let nx = -(bz - az) / L, nz = (bx - ax) / L;
      if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; }
      const inset = shared(ax, az, bx, bz, indexOf(l)) ? 0 : INSET;
      lines.push([nx, nz, ax * nx + az * nz + inset]);
    }
    const q: number[] = [];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      const [n1x, n1z, d1] = lines[(k + 3) % 4], [n2x, n2z, d2] = lines[k];
      const det = n1x * n2z - n1z * n2x;
      if (Math.abs(det) < 0.2) { ok = false; break; }
      q.push((d1 * n2z - n1z * d2) / det, (n1x * d2 - d1 * n2x) / det);
    }
    if (!ok) continue;
    // Still a proper quad after the inset (same winding, not collapsed)?
    let area = 0;
    for (let k = 0; k < 4; k++) area += q[k * 2] * q[((k + 1) % 4) * 2 + 1] - q[((k + 1) % 4) * 2] * q[k * 2 + 1];
    let area0 = 0;
    for (let k = 0; k < 4; k++) area0 += c[k][0] * c[(k + 1) % 4][1] - c[(k + 1) % 4][0] * c[k][1];
    if (Math.sign(area) !== Math.sign(area0) || Math.abs(area) < 2 * 2) continue;
    // Walls ride the terrain vertex by vertex: the lowest of corners, edge midpoints and centre.
    let tMin = fastTerrain(cx, cz);
    for (let k = 0; k < 4; k++) {
      const [x, z] = c[k], [x2, z2] = c[(k + 1) % 4];
      tMin = Math.min(tMin, fastTerrain(x, z), fastTerrain((x + x2) / 2, (z + z2) / 2));
    }
    const y0 = tMin - 0.2, y1 = tMin + l.h - DROP;
    if (y1 - y0 < 1.5) continue;
    out.push(...q, y0, y1);
  }
  // The town walls (ruin() curtains, 2.5 m thick, base 1.2 m down, broken top
  // at 93-100 % of h): a 1.2 m-thick core, topped 0.4 m under the lowest break.
  for (const w of it.walls) {
    const [ax, az] = w.a, [bx, bz] = w.b;
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const nx = (-(bz - az) / L) * 0.6, nz = ((bx - ax) / L) * 0.6;
    let tMin = Infinity;
    const ns = Math.ceil(L / 2);
    for (let k = 0; k <= ns; k++) for (const sd of [-1, 1]) tMin = Math.min(tMin, fastTerrain(ax + ((bx - ax) * k) / ns + nx * sd, az + ((bz - az) * k) / ns + nz * sd));
    const y0 = tMin - 0.2, y1 = tMin - 1.2 + 0.93 * w.h - 0.4;
    if (y1 - y0 < 1.5) continue;
    out.push(ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz, y0, y1);
  }
  p = new Float32Array(out);
  prisms.set(it.key, p);
  return p;
}
function indexOf(l: LotData) { return edgeLot.get(l) ?? -1; }
/** Lot → its id in the edge index. */
const edgeLot = new Map<LotData, number>();
/** Index every house footprint of the town once (to tell party walls from outer walls). */
export function indexLotsFrom(all: LotData[]) {
  all.forEach((l, i) => edgeLot.set(l, i));
  indexLots(all);
}

// ------------------------------------------------------------ the buffer
export class OcclusionBuffer {
  w = W; h = 1;
  /** 1 / depth of the nearest house, at its farthest within the pixel; 0 = nothing. */
  inv = new Float32Array(1);
  private view = new THREE.Matrix4();
  private proj = new THREE.Matrix4();
  private px = 1; private py = 1; // projection scale (pixels per unit of x/-z, y/-z)
  stats = { faces: 0, ms: 0 };

  /**
   * Start a frame: size the buffer to the view and clear it. Returns false when
   * the view is exactly as last time (the buffer is still right: skip drawing).
   */
  begin(camera: THREE.PerspectiveCamera) {
    camera.updateMatrixWorld();
    const h = Math.max(16, Math.min(320, Math.round(W / camera.aspect)));
    if (h === this.h && this.view.equals(camera.matrixWorldInverse) && this.proj.equals(camera.projectionMatrix)) return false;
    if (h !== this.h) { this.h = h; this.inv = new Float32Array(W * h); }
    this.inv.fill(0);
    this.view.copy(camera.matrixWorldInverse);
    this.proj.copy(camera.projectionMatrix);
    const P = camera.projectionMatrix.elements;
    this.px = P[0] * 0.5 * this.w;
    this.py = P[5] * 0.5 * this.h;
    this.stats.faces = 0;
    return true;
  }

  // View-space transform of (x, y, z) into the scratch arrays.
  private vx = new Float32Array(16); private vy = new Float32Array(16); private vz = new Float32Array(16);
  private tx = new Float32Array(16); private ty = new Float32Array(16); private tz = new Float32Array(16);

  /** Draw a chunk's house prisms (only faces turned to the eye). */
  drawPrisms(p: Float32Array, eye: THREE.Vector3) {
    const e = this.view.elements;
    for (let o = 0; o < p.length; o += 10) {
      const y0 = p[o + 8], y1 = p[o + 9];
      for (let k = 0; k < 4; k++) {
        const ax = p[o + k * 2], az = p[o + k * 2 + 1], bx = p[o + ((k + 1) % 4) * 2], bz = p[o + ((k + 1) % 4) * 2 + 1];
        // Front-facing: the eye on the outer side of the wall (winding-free test via the centroid).
        const mx = (p[o] + p[o + 2] + p[o + 4] + p[o + 6]) / 4, mz = (p[o + 1] + p[o + 3] + p[o + 5] + p[o + 7]) / 4;
        let nx = -(bz - az), nz = bx - ax;
        if ((mx - ax) * nx + (mz - az) * nz > 0) { nx = -nx; nz = -nz; }
        if ((eye.x - ax) * nx + (eye.z - az) * nz <= 0) continue;
        this.quad(e, ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      }
      if (eye.y > y1) this.quad(e, p[o], y1, p[o + 1], p[o + 2], y1, p[o + 3], p[o + 4], y1, p[o + 5], p[o + 6], y1, p[o + 7]);
    }
  }

  private quad(e: ArrayLike<number>, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x3: number, y3: number, z3: number) {
    const X = [x0, x1, x2, x3], Y = [y0, y1, y2, y3], Z = [z0, z1, z2, z3];
    let n = 0;
    for (let i = 0; i < 4; i++) {
      this.vx[i] = e[0] * X[i] + e[4] * Y[i] + e[8] * Z[i] + e[12];
      this.vy[i] = e[1] * X[i] + e[5] * Y[i] + e[9] * Z[i] + e[13];
      this.vz[i] = e[2] * X[i] + e[6] * Y[i] + e[10] * Z[i] + e[14];
    }
    // Clip against the near plane (z = -NEAR), Sutherland-Hodgman.
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const ai = this.vz[i] <= -NEAR, aj = this.vz[j] <= -NEAR;
      if (ai) { this.tx[n] = this.vx[i]; this.ty[n] = this.vy[i]; this.tz[n] = this.vz[i]; n++; }
      if (ai !== aj) {
        const t = (-NEAR - this.vz[i]) / (this.vz[j] - this.vz[i]);
        this.tx[n] = this.vx[i] + (this.vx[j] - this.vx[i]) * t;
        this.ty[n] = this.vy[i] + (this.vy[j] - this.vy[i]) * t;
        this.tz[n] = -NEAR;
        n++;
      }
    }
    if (n < 3) return;
    this.stats.faces++;
    // Project: screen x right, y down, and 1/depth.
    const sx = this.vx, sy = this.vy, iz = this.vz; // reuse as screen arrays
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = -this.tz[i];
      sx[i] = this.w * 0.5 + (this.tx[i] / d) * this.px;
      sy[i] = this.h * 0.5 - (this.ty[i] / d) * this.py;
      iz[i] = 1 / d;
      minX = Math.min(minX, sx[i]); maxX = Math.max(maxX, sx[i]); minY = Math.min(minY, sy[i]); maxY = Math.max(maxY, sy[i]);
    }
    const x0p = Math.max(0, Math.floor(minX)), x1p = Math.min(this.w - 1, Math.ceil(maxX));
    const y0p = Math.max(0, Math.floor(minY)), y1p = Math.min(this.h - 1, Math.ceil(maxY));
    if (x0p > x1p || y0p > y1p) return;
    // The plane of 1/depth over the screen, from the three most spread vertices.
    const a = 0, b = Math.floor(n / 3), c = Math.floor((2 * n) / 3);
    const ux = sx[b] - sx[a], uy = sy[b] - sy[a], uz = iz[b] - iz[a];
    const wx = sx[c] - sx[a], wy = sy[c] - sy[a], wz = iz[c] - iz[a];
    const den = ux * wy - uy * wx;
    if (Math.abs(den) < 1e-6) return; // edge-on: covers nothing
    const A = (uz * wy - uy * wz) / den, B = (ux * wz - uz * wx) / den;
    const C = iz[a] - A * sx[a] - B * sy[a];
    // Farthest the plane gets inside a pixel: half a pixel each way.
    const slack = 0.5 * (Math.abs(A) + Math.abs(B));
    // Orientation of the projected polygon.
    let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += sx[i] * sy[j] - sx[j] * sy[i]; }
    const s = area > 0 ? 1 : -1;
    const D = this.inv;
    const C2 = C - slack;
    for (let y = y0p; y <= y1p; y++) {
      const cy = y + 0.5;
      // Span of this row inside the polygon (convex): intersect the edge half-planes.
      let lo = x0p + 0.5, hi = x1p + 0.5;
      let empty = false;
      for (let i = 0; i < n && !empty; i++) {
        const j = (i + 1) % n;
        // Inside if s * ((xj-xi)*(cy-yi) - (yj-yi)*(cx-xi)) >= 0
        const ex = sx[j] - sx[i], ey = sy[j] - sy[i];
        const k = s * -ey; // coefficient of cx
        const r = s * (ex * (cy - sy[i]) + ey * sx[i]); // constant part
        if (Math.abs(k) < 1e-9) { if (r < 0) empty = true; continue; }
        const xb = -r / k;
        if (k > 0) lo = Math.max(lo, xb); else hi = Math.min(hi, xb);
        if (lo > hi) empty = true;
      }
      if (empty) continue;
      const xa = Math.max(x0p, Math.ceil(lo - 0.5)), xb2 = Math.min(x1p, Math.floor(hi - 0.5));
      const row = y * this.w;
      let v = A * (xa + 0.5) + B * cy + C2;
      for (let x = xa; x <= xb2; x++, v += A) if (v > D[row + x]) D[row + x] = v;
    }
  }

  private cz = new Float32Array(8); private cx = new Float32Array(8); private cy = new Float32Array(8);
  /** Is the whole box behind the houses drawn this frame? */
  hidden(box: THREE.Box3): boolean {
    const e = this.view.elements;
    let minD = Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const X = i & 1 ? box.max.x : box.min.x, Y = i & 2 ? box.max.y : box.min.y, Z = i & 4 ? box.max.z : box.min.z;
      const vx = e[0] * X + e[4] * Y + e[8] * Z + e[12];
      const vy = e[1] * X + e[5] * Y + e[9] * Z + e[13];
      const vz = e[2] * X + e[6] * Y + e[10] * Z + e[14];
      if (vz > -NEAR) return false; // reaches the eye's plane
      const d = -vz;
      minD = Math.min(minD, d);
      const sx = this.w * 0.5 + (vx / d) * this.px, sy = this.h * 0.5 - (vy / d) * this.py;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    // One pixel more all round (see the note at the top).
    const x0 = Math.floor(minX) - 1, x1 = Math.floor(maxX) + 1, y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY) + 1;
    if (x1 < 0 || y1 < 0 || x0 >= this.w || y0 >= this.h) return false; // off screen: the frustum deals with it
    // Partly off screen: the part outside cannot be checked, and is not drawn anyway.
    // Every pixel needs a house nearer than the box's nearest corner (25 cm to spare).
    const D = this.inv, lim = 1 / Math.max(minD - 0.25, 1e-3);
    for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) {
      const row = y * this.w;
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) if (!(D[row + x] > lim)) return false;
    }
    return true;
  }
}
