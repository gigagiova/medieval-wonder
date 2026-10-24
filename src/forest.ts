import * as THREE from 'three';
import { Builder, rng } from './builder';
import { shared } from './materials';
import { noiseGLSL, atmosGLSL } from './shaders';
import { field } from './displace';
import { placeProp, commitProps, propsLoaded, type PropId } from './props';

// The wood around the town: old oaks and chestnuts gone wild, thick gnarled
// trunks on buttress roots, limbs that twist and fork and end in thorn-sharp
// spires; dead snags, young spindly trees, fallen trunks, stumps, brambles.
// Every tree type is grown procedurally (a recursive, noise-steered branching
// skeleton swept into generalized cylinders), then instanced hundreds of
// times with distance LOD.

type V3 = THREE.Vector3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

interface Branch { pts: V3[]; rs: number[]; ss: number[]; depth: number; trunk: boolean; r0: number }

interface Species {
  name: string;
  height: number; // trunk length
  r0: number; // trunk base radius
  maxDepth: number;
  forkStart: number; // fraction of trunk where limbs start
  limbs: number; // forks per metre on the trunk
  forkRate: number[]; // forks per metre per depth (limbs)
  childR: [number, number];
  childLen: [number, number];
  angle: [number, number]; // radians away from parent
  wander: number;
  curl: number; // amplitude of the slow snaking
  up: number[]; // gravitropism per depth (negative = sag)
  sag: number; // elbows: dips mid-branch
  twigs: number; // twig density at the last level
  roots: number;
  burls: number;
  leaves: number; // fraction of twig tips with clinging dead leaves
  moss: number;
  broken?: boolean; // dead snag: top snapped off
  split?: number; // oaks and chestnuts: the trunk divides into this many great limbs
  lean: number;
}

const SPECIES: Species[] = [
  // Ancient oaks: huge low trunks, enormous twisting limbs reaching sideways.
  { name: 'ancient', height: 10, r0: 1.35, maxDepth: 5, forkStart: 0.32, limbs: 0.9, forkRate: [0, 0.825, 1.35, 2.4, 3.9], childR: [0.42, 0.7], childLen: [0.55, 0.95], angle: [0.6, 1.25], wander: 0.12, curl: 0.35, up: [0.18, 0.05, 0.08, 0.12, 0.2, 0.25], sag: 0.22, twigs: 7.2, roots: 7, burls: 5, leaves: 0.08, moss: 1, split: 4, lean: 0.06 },
  { name: 'ancient2', height: 12, r0: 1.15, maxDepth: 5, forkStart: 0.38, limbs: 0.8, forkRate: [0, 0.9, 1.5, 2.55, 4.2], childR: [0.45, 0.72], childLen: [0.55, 0.9], angle: [0.55, 1.15], wander: 0.14, curl: 0.45, up: [0.22, 0.08, 0.1, 0.14, 0.22, 0.25], sag: 0.18, twigs: 6.4, roots: 6, burls: 4, leaves: 0.15, moss: 0.8, split: 3, lean: 0.08 },
  // Chestnuts / oaks of middle age: tall, spiralling.
  { name: 'oak', height: 15, r0: 0.68, maxDepth: 5, forkStart: 0.35, limbs: 0.7, forkRate: [0, 1.125, 1.8, 3, 4.5], childR: [0.4, 0.68], childLen: [0.5, 0.85], angle: [0.5, 1.05], wander: 0.16, curl: 0.5, up: [0.3, 0.12, 0.12, 0.18, 0.25, 0.3], sag: 0.12, twigs: 6.4, roots: 5, burls: 3, leaves: 0.25, moss: 0.6, split: 3, lean: 0.1 },
  { name: 'oak2', height: 18, r0: 0.72, maxDepth: 5, forkStart: 0.45, limbs: 0.6, forkRate: [0, 1.05, 1.65, 2.85, 4.2], childR: [0.42, 0.66], childLen: [0.5, 0.82], angle: [0.45, 0.95], wander: 0.12, curl: 0.6, up: [0.35, 0.16, 0.14, 0.2, 0.28, 0.3], sag: 0.08, twigs: 5.76, roots: 5, burls: 2, leaves: 0.05, moss: 0.5, split: 2, lean: 0.12 },
  { name: 'chestnut', height: 13, r0: 0.82, maxDepth: 5, forkStart: 0.28, limbs: 0.85, forkRate: [0, 0.975, 1.725, 2.85, 4.35], childR: [0.4, 0.66], childLen: [0.6, 0.95], angle: [0.65, 1.3], wander: 0.15, curl: 0.4, up: [0.2, 0.04, 0.08, 0.16, 0.22, 0.28], sag: 0.25, twigs: 6.72, roots: 6, burls: 4, leaves: 0.3, moss: 0.7, split: 4, lean: 0.07 },
  // Gaunt crooked ones that grew in the shade, all leaning one way.
  { name: 'crooked', height: 16, r0: 0.4, maxDepth: 4, forkStart: 0.4, limbs: 0.55, forkRate: [0, 0.9, 1.8, 3.6], childR: [0.4, 0.65], childLen: [0.45, 0.8], angle: [0.45, 1.0], wander: 0.2, curl: 0.8, up: [0.25, 0.1, 0.16, 0.25, 0.3], sag: 0.1, twigs: 5.12, roots: 4, burls: 2, leaves: 0.1, moss: 0.4, lean: 0.22 },
  // Young spindly trees: thin, few branches, spiky.
  { name: 'young', height: 10, r0: 0.17, maxDepth: 4, forkStart: 0.3, limbs: 0.9, forkRate: [0, 1.5, 2.4, 3.9], childR: [0.4, 0.65], childLen: [0.35, 0.65], angle: [0.4, 0.9], wander: 0.18, curl: 0.5, up: [0.35, 0.22, 0.25, 0.3, 0.3], sag: 0.04, twigs: 4.8, roots: 3, burls: 0, leaves: 0.35, moss: 0.2, lean: 0.15 },
  { name: 'young2', height: 13, r0: 0.22, maxDepth: 4, forkStart: 0.5, limbs: 0.7, forkRate: [0, 1.35, 2.25, 3.6], childR: [0.38, 0.6], childLen: [0.3, 0.6], angle: [0.35, 0.8], wander: 0.12, curl: 0.7, up: [0.45, 0.3, 0.3, 0.3, 0.3], sag: 0.02, twigs: 4.48, roots: 3, burls: 0, leaves: 0.1, moss: 0.2, lean: 0.12 },
  // Dead snags: snapped tops, stubby limbs, all spires.
  { name: 'snag', height: 12, r0: 0.68, maxDepth: 3, forkStart: 0.3, limbs: 0.7, forkRate: [0, 1.2, 2.4], childR: [0.35, 0.6], childLen: [0.3, 0.6], angle: [0.5, 1.2], wander: 0.18, curl: 0.4, up: [0.25, 0.2, 0.25, 0.3], sag: 0.05, twigs: 2.56, roots: 6, burls: 4, leaves: 0, moss: 1, broken: true, lean: 0.08 },
  { name: 'snag2', height: 17, r0: 0.52, maxDepth: 3, forkStart: 0.45, limbs: 0.5, forkRate: [0, 1.05, 2.1], childR: [0.3, 0.55], childLen: [0.25, 0.55], angle: [0.4, 1.1], wander: 0.14, curl: 0.5, up: [0.3, 0.25, 0.3, 0.3], sag: 0.05, twigs: 2.24, roots: 5, burls: 3, leaves: 0, moss: 0.7, broken: true, lean: 0.14 },
  // Twin-trunked hornbeam-like thing, writhing.
  { name: 'writhing', height: 12, r0: 0.6, maxDepth: 5, forkStart: 0.12, limbs: 0.9, forkRate: [0, 1.05, 1.8, 3, 4.5], childR: [0.55, 0.8], childLen: [0.6, 0.95], angle: [0.35, 0.85], wander: 0.2, curl: 0.9, up: [0.3, 0.15, 0.15, 0.2, 0.25, 0.3], sag: 0.15, twigs: 6.4, roots: 5, burls: 4, leaves: 0.12, moss: 0.8, split: 2, lean: 0.1 },
  { name: 'witch', height: 8, r0: 0.95, maxDepth: 5, forkStart: 0.25, limbs: 1.2, forkRate: [0, 1.05, 1.65, 2.7, 4.2], childR: [0.4, 0.62], childLen: [0.7, 1.05], angle: [0.8, 1.45], wander: 0.18, curl: 0.6, up: [0.15, -0.05, 0.05, 0.12, 0.2, 0.25], sag: 0.3, twigs: 6.72, roots: 8, burls: 6, leaves: 0.05, moss: 1, split: 4, lean: 0.05 },
];

// ------------------------------------------------------------- growth

function grow(sp: Species, seed: number, rateScale = 1): Branch[] {
  const rand = rng(seed);
  const R = (a: number, b: number) => a + (b - a) * rand();
  const out: Branch[] = [];
  const ph = [R(0, 6), R(0, 6), R(0, 6), R(0, 6)];
  const tmpQ = new THREE.Quaternion();
  const perp = (d: V3) => {
    const a = Math.abs(d.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
    return a.cross(d).normalize();
  };
  // Rotate d away by angle `a` around a random axis perpendicular to it.
  const away = (d: V3, a: number, az: number) => {
    const p = perp(d).applyAxisAngle(d, az);
    return d.clone().applyQuaternion(tmpQ.setFromAxisAngle(p, a)).normalize();
  };
  let golden = R(0, 6.28);

  const branch = (p0: V3, dir: V3, r0: number, len: number, depth: number, s0: number, trunk: boolean) => {
    const pts = [p0.clone()], rs = [r0], ss = [s0];
    const step = trunk ? 0.3 : THREE.MathUtils.clamp(r0 * 3.2, 0.09, 0.5);
    const n = r0 < 0.02 ? 3 + Math.floor(len / 0.6) : Math.max(3, Math.ceil(len / step));
    const st = len / n;
    const d = dir.clone();
    const p = p0.clone();
    const brokenAt = trunk && sp.broken ? R(0.55, 0.8) : 2;
    const splitAt = trunk && sp.split ? sp.forkStart + R(0.05, 0.2) : 2;
    let s = s0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (t > brokenAt) break;
      if (t > splitAt) {
        // Divide: great limbs of nearly the trunk's girth, spreading out and up.
        const nLimbs = sp.split!;
        const az0 = R(0, 6.28);
        for (let k2 = 0; k2 < nLimbs; k2++) {
          const az = az0 + (k2 / nLimbs) * Math.PI * 2 + R(-0.4, 0.4);
          const cd = away(d, R(0.35, 0.85), az);
          const cr = rs[rs.length - 1] * R(0.55, 0.78);
          branch(p.clone().addScaledVector(cd, -cr * 0.8), cd, cr, sp.height * R(0.55, 0.9), 1, s, false);
        }
        break;
      }
      // Slow snaking (a smooth curl that depends on where the branch is),
      // a little random wander, then gravitropism with an elbow.
      const c = sp.curl * (trunk ? 0.35 : 1);
      d.x += c * st * Math.sin(p.y * 0.9 + ph[0] + depth * 1.3) * 0.6;
      d.z += c * st * Math.cos(p.y * 0.8 + ph[1] - depth) * 0.6;
      d.x += c * st * Math.sin(p.z * 1.1 + ph[2]) * 0.3;
      d.z += c * st * Math.cos(p.x * 1.2 + ph[3]) * 0.3;
      d.x += R(-1, 1) * sp.wander * st * 2;
      d.y += R(-1, 1) * sp.wander * st * 2;
      d.z += R(-1, 1) * sp.wander * st * 2;
      const up = sp.up[Math.min(depth, sp.up.length - 1)];
      d.y += (up - sp.sag * Math.sin(t * Math.PI) * (depth === 1 ? 1.4 : 0.6)) * st;
      d.normalize();
      p.addScaledVector(d, st);
      s += st;
      // Taper: limbs to a needle point (the spires), the trunk to its leader.
      const taper = trunk
        ? (t < sp.forkStart ? 1 - 0.18 * (t / sp.forkStart) : 0.82 * Math.pow(1 - (t - sp.forkStart) / (1 - sp.forkStart), 1.25))
        : Math.pow(1 - t, depth >= sp.maxDepth - 1 ? 1.1 : 0.8);
      const r = Math.max(0.0025, r0 * taper);
      pts.push(p.clone()); rs.push(r); ss.push(s);
      if (depth >= sp.maxDepth) continue;
      // Forks.
      const start = trunk ? sp.forkStart : 0.12;
      if (t < start || t > 0.97) continue;
      const rate = trunk ? sp.limbs : sp.forkRate[Math.min(depth, sp.forkRate.length - 1)];
      const last = depth === sp.maxDepth - 1;
      const k = (last ? sp.twigs : rate) * st * (trunk ? 1 : rateScale);
      let forks = Math.floor(k) + (rand() < k - Math.floor(k) ? 1 : 0);
      while (forks-- > 0) {
        golden += 2.39996 + R(-0.4, 0.4);
        const a = R(sp.angle[0], sp.angle[1]) * (last ? 0.8 : 1);
        const cd = away(d, a, golden);
        const cr = r * R(sp.childR[0], sp.childR[1]) * (last ? 0.7 : trunk ? 1.15 : 1);
        if (cr < 0.006) continue;
        const remain = trunk ? sp.height * (1 - t) * 0.9 + sp.height * 0.35 : len * (1 - t) + len * 0.15;
        let cl = remain * R(sp.childLen[0], sp.childLen[1]);
        if (last) cl = THREE.MathUtils.clamp(cr * R(25, 55), 0.25, 1.4);
        // Start a little inside the parent so the join is buried.
        const cp = p.clone().addScaledVector(cd, -r * 0.6);
        branch(cp, cd, cr, cl, depth + 1, s, false);
      }
    }
    out.push({ pts, rs, ss, depth, trunk, r0 });
  };

  // Trunk.
  const lean = V(R(-1, 1), 0, R(-1, 1)).normalize().multiplyScalar(sp.lean);
  branch(V(0, -0.3, 0), V(lean.x, 1, lean.z).normalize(), sp.r0, sp.height, 0, 0, true);
  // A second leader for some.
  if (sp.name === 'writhing' || (sp.name.startsWith('ancient') && rand() < 0.5)) {
    const d = V(R(-0.5, 0.5), 1, R(-0.5, 0.5)).normalize();
    branch(V(R(-0.2, 0.2), 0.6, R(-0.2, 0.2)), d, sp.r0 * 0.7, sp.height * 0.85, 1, 0.6, false);
  }
  // Roots crawling over the ground from the buttresses.
  for (let i = 0; i < sp.roots; i++) {
    const a = (i / sp.roots) * Math.PI * 2 + R(-0.3, 0.3);
    const pts: V3[] = [], rs: number[] = [], ss: number[] = [];
    const len = sp.r0 * R(2.5, 5.5) + 0.8;
    const n = Math.max(4, Math.ceil(len / 0.18));
    let ang = a;
    const rr = sp.r0 * R(0.32, 0.5);
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      ang += R(-0.12, 0.12);
      const dist = sp.r0 * 0.55 + t * len;
      const y = 0.45 * sp.r0 * Math.pow(1 - t, 2.2) - 0.08 + Math.sin(t * 9 + i) * 0.04 * (1 - t);
      pts.push(V(Math.cos(ang) * dist, y, Math.sin(ang) * dist));
      rs.push(Math.max(0.004, rr * Math.pow(1 - t, 1.3)));
      ss.push(t * len);
    }
    out.push({ pts, rs, ss, depth: 2, trunk: false, r0: rr });
  }
  return out;
}

// ------------------------------------------------------------- sweeping

interface GeoBuf { pos: number[]; nor: number[]; uv: number[]; rad: number[]; kind: number[]; ao: number[]; idx: number[] }
const newBuf = (): GeoBuf => ({ pos: [], nor: [], uv: [], rad: [], kind: [], ao: [], idx: [] });

function sweep(buf: GeoBuf, br: Branch, sp: Species, lod: 0 | 1 | 2, rand: () => number) {
  const { pts, rs, ss } = br;
  if (pts.length < 2) return;
  let M = br.trunk ? 16 : Math.round(THREE.MathUtils.clamp(br.r0 * 38, 3, 12));
  if (lod === 1) M = br.trunk ? 9 : Math.max(3, Math.round(M / 2));
  if (lod === 2) M = br.trunk ? 6 : 3;
  const stride = lod && pts.length > 4 ? (lod === 2 ? 4 : 2) : 1;
  const keep: number[] = [];
  for (let i = 0; i < pts.length; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== pts.length - 1) keep.push(pts.length - 1);
  // Buttress lobes and burls for the trunk.
  const lobes = 4 + Math.floor(rand() * 3), lph = rand() * 6;
  const burls = Array.from({ length: br.trunk ? sp.burls : 0 }, () => ({ s: 1 + rand() * sp.height * 0.6, th: rand() * Math.PI * 2, a: 0.12 + rand() * 0.22, w: 0.35 + rand() * 0.4 }));
  let N = new THREE.Vector3();
  const T = new THREE.Vector3(), Tp = new THREE.Vector3(), B = new THREE.Vector3(), q = new THREE.Quaternion();
  const base = buf.pos.length / 3;
  keep.forEach((i, k) => {
    const p = pts[i];
    T.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]);
    if (T.lengthSq() < 1e-12) T.copy(k ? Tp : V(0, 1, 0));
    T.normalize();
    if (k === 0) {
      N.set(0, 1, 0);
      if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
      N.cross(T).normalize();
    } else {
      q.setFromUnitVectors(Tp, T);
      N.applyQuaternion(q).normalize();
    }
    Tp.copy(T);
    B.crossVectors(T, N).normalize();
    const r = rs[i];
    const s = ss[i];
    const h = p.y;
    const tip = i === pts.length - 1;
    for (let j = 0; j <= M; j++) {
      const th = (j / M) * Math.PI * 2;
      let mod = 1;
      if (br.trunk) {
        mod *= 1 + 0.4 * Math.exp(-Math.max(0, h) / 0.7) + 0.45 * Math.exp(-Math.max(0, h) / 1.1) * Math.pow(Math.max(0, Math.cos(lobes * th + lph)), 4);
        for (const b of burls) {
          let dth = Math.abs(th - b.th);
          dth = Math.min(dth, Math.PI * 2 - dth);
          mod *= 1 + b.a * Math.exp(-(((s - b.s) / b.w) ** 2) - (dth / 0.7) ** 2);
        }
        mod *= 1 + 0.07 * Math.sin(th * 3 + s * 1.7) + 0.05 * Math.sin(th * 7 - s * 2.3);
      } else if (r > 0.04) {
        mod *= 1 + 0.06 * Math.sin(th * 3 + s * 2.1);
      }
      const cx = Math.cos(th), sx = Math.sin(th);
      const nx = N.x * cx + B.x * sx, ny = N.y * cx + B.y * sx, nz = N.z * cx + B.z * sx;
      const rr = tip ? 0 : r * mod;
      buf.pos.push(p.x + nx * rr, p.y + ny * rr, p.z + nz * rr);
      buf.nor.push(nx, ny, nz);
      buf.uv.push(j / M, s);
      buf.rad.push(br.r0);
      buf.kind.push(0);
      const ao = (br.trunk ? 0.45 + 0.55 * THREE.MathUtils.smoothstep(h, -0.2, 2.2) : 0.85 + 0.15 * Math.min(1, br.depth / 4))
        * (br.trunk || br.depth > 1 ? 1 : 0.95);
      buf.ao.push(ao);
    }
  });
  const ring = M + 1;
  for (let k = 0; k < keep.length - 1; k++) for (let j = 0; j < M; j++) {
    const a = base + k * ring + j, b2 = a + 1, c = a + ring, d = c + 1;
    buf.idx.push(a, c, b2, b2, c, d);
  }
}

/** Little clusters of curled dead leaves clinging to twig tips. */
function leaves(buf: GeoBuf, br: Branch, rand: () => number) {
  const p = br.pts[br.pts.length - 1];
  const n = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const c = p.clone().add(V((rand() - 0.5) * 0.25, (rand() - 0.6) * 0.25, (rand() - 0.5) * 0.25));
    const u = V(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(0.045);
    const w = V(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().cross(u);
    if (w.lengthSq() < 1e-10) continue;
    w.normalize().multiplyScalar(0.03);
    const nrm = u.clone().cross(w);
    if (nrm.lengthSq() < 1e-12) continue;
    nrm.normalize();
    const base = buf.pos.length / 3;
    for (const [a, b] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
      buf.pos.push(c.x + u.x * a + w.x * b, c.y + u.y * a + w.y * b - Math.abs(a) * 0.01, c.z + u.z * a + w.z * b);
      buf.nor.push(nrm.x, nrm.y, nrm.z);
      buf.uv.push(a, b);
      buf.rad.push(0.01);
      buf.kind.push(2);
      buf.ao.push(0.9);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** Lumps of moss and ivy on the upper sides of the trunk and big limbs. */
function moss(buf: GeoBuf, br: Branch, rand: () => number, amount: number) {
  const n = Math.floor(amount * br.pts.length * (br.trunk ? 0.25 : 0.08));
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const ip = ico.attributes.position;
  for (let k = 0; k < n; k++) {
    const i = 1 + Math.floor(rand() * (br.pts.length - 2));
    const p = br.pts[i], r = br.rs[i];
    if (r < 0.06) continue;
    const sz = r * (0.35 + rand() * 0.5);
    const off = V(rand() - 0.5, 0.6 + rand() * 0.4, rand() - 0.5).normalize().multiplyScalar(r * 0.85);
    const base = buf.pos.length / 3;
    for (let v = 0; v < ip.count; v++) {
      const x = ip.getX(v), y = ip.getY(v), z = ip.getZ(v);
      buf.pos.push(p.x + off.x + x * sz * 1.3, p.y + off.y + y * sz * 0.45, p.z + off.z + z * sz * 1.3);
      buf.nor.push(x, y, z);
      buf.uv.push(0, 0);
      buf.rad.push(0.05);
      buf.kind.push(1);
      buf.ao.push(0.8);
    }
    for (let t = 0; t < ip.count; t++) buf.idx.push(base + t);
  }
}

function toGeometry(buf: GeoBuf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(buf.rad, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(buf.kind, 1));
  g.setAttribute('aAo', new THREE.Float32BufferAttribute(buf.ao, 1));
  g.setIndex(buf.idx);
  g.computeBoundingSphere();
  return g;
}

function treeGeometry(sp: Species, seed: number) {
  const rand = rng(seed * 31 + 7);
  // Keep each tree within a branch budget: grow, count, thin the forking, regrow.
  const budget = sp.name.startsWith('ancient') || sp.name === 'witch' ? 1100 : sp.name.startsWith('young') ? 260 : sp.name.startsWith('snag') ? 160 : 700;
  let scale = 1, skel = grow(sp, seed);
  for (let it = 0; it < 4 && skel.length > budget * 1.15; it++) {
    scale *= Math.pow(budget / skel.length, 0.45);
    skel = grow(sp, seed, scale);
  }
  const hi = newBuf(), lo = newBuf(), far = newBuf();
  for (const br of skel) {
    sweep(hi, br, sp, 0, rand);
    if (br.r0 > 0.025 || br.trunk) sweep(lo, br, sp, 1, rand);
    if (br.r0 > 0.07 || br.trunk) sweep(far, br, sp, 2, rand);
    if (br.depth === sp.maxDepth && rand() < sp.leaves) leaves(hi, br, rand);
    if (br.depth <= 1) moss(hi, br, rand, sp.moss);
  }
  return { hi: toGeometry(hi), lo: toGeometry(lo), far: toGeometry(far) };
}

// ------------------------------------------------------------- ground scatter

/** A bramble: arching thorny canes. */
function brambleGeometry(seed: number) {
  const rand = rng(seed);
  const R = (a: number, b: number) => a + (b - a) * rand();
  const buf = newBuf();
  const dummy = SPECIES[6];
  for (let c = 0; c < 16; c++) {
    const a = R(0, Math.PI * 2), d0 = R(0, 0.6);
    const p = V(Math.cos(a) * d0, -0.05, Math.sin(a) * d0);
    const dir = V(Math.cos(a) * R(0.3, 0.8), 1, Math.sin(a) * R(0.3, 0.8)).normalize();
    const pts = [p.clone()], rs = [0.016], ss = [0];
    const n = 9, len = R(1.2, 2.6);
    for (let i = 1; i <= n; i++) {
      dir.y -= 0.22; // arch over and down
      dir.x += R(-0.15, 0.15); dir.z += R(-0.15, 0.15);
      dir.normalize();
      p.addScaledVector(dir, len / n);
      if (p.y < -0.05) p.y = -0.05;
      pts.push(p.clone()); rs.push(0.016 * (1 - i / n) + 0.003); ss.push((i * len) / n);
      // Thorns: tiny spikes.
      if (i % 3 === 0) {
        const t = V(R(-1, 1), R(-1, 1), R(-1, 1)).normalize();
        const tp = [p.clone(), p.clone().addScaledVector(t, 0.05)];
        sweep(buf, { pts: tp, rs: [0.005, 0.0], ss: [0, 0.05], depth: 5, trunk: false, r0: 0.004 }, dummy, 0, rand);
      }
    }
    sweep(buf, { pts, rs, ss, depth: 4, trunk: false, r0: 0.016 }, dummy, 0, rand);
  }
  return toGeometry(buf);
}

/** A fallen trunk with snapped stubs, or a stump with a rotten jagged top. */
function deadwoodGeometry(seed: number, stump: boolean) {
  const rand = rng(seed);
  const R = (a: number, b: number) => a + (b - a) * rand();
  const buf = newBuf();
  const sp = SPECIES[8];
  if (stump) {
    const r0 = R(0.35, 0.7), h = R(0.4, 1.3);
    const br: Branch = { pts: [], rs: [], ss: [], depth: 0, trunk: true, r0 };
    for (let i = 0; i <= 8; i++) { br.pts.push(V(R(-0.02, 0.02), -0.25 + (i / 8) * h, R(-0.02, 0.02))); br.rs.push(r0 * (1 - i * 0.02)); br.ss.push((i / 8) * h); }
    sweep(buf, br, { ...sp, burls: 2 }, 0, rand);
    // Jagged rotten top: a crown of splinters.
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const b2 = V(Math.cos(a) * r0 * 0.75, h - 0.3, Math.sin(a) * r0 * 0.75);
      const pts = [b2, b2.clone().add(V(Math.cos(a) * 0.05, R(0.15, 0.6), Math.sin(a) * 0.05))];
      sweep(buf, { pts, rs: [r0 * 0.28, 0.003], ss: [h, h + 0.4], depth: 3, trunk: false, r0: r0 * 0.28 }, sp, 0, rand);
    }
    for (const br2 of grow({ ...sp, height: 0.01, roots: 5, r0 }, seed).slice(1)) sweep(buf, br2, sp, 0, rand);
  } else {
    const len = R(5, 10), r0 = R(0.3, 0.55);
    const a = R(0, Math.PI);
    const dir = V(Math.cos(a), 0.0, Math.sin(a));
    const pts: V3[] = [], rs: number[] = [], ss: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push(dir.clone().multiplyScalar(t * len - len / 2).add(V(0, r0 * 0.8 + Math.sin(t * 5) * 0.06, Math.sin(t * 4) * 0.2)));
      rs.push(r0 * (1 - t * 0.55)); ss.push(t * len);
    }
    sweep(buf, { pts, rs, ss, depth: 1, trunk: false, r0 }, sp, 0, rand);
    // Snapped limbs sticking up.
    for (let k = 0; k < 5; k++) {
      const t = R(0.2, 0.9);
      const p = pts[Math.floor(t * 20)];
      const d = V(R(-0.5, 0.5), 1, R(-0.5, 0.5)).normalize();
      const L = R(0.4, 1.8);
      sweep(buf, { pts: [p.clone(), p.clone().addScaledVector(d, L * 0.5).add(V(R(-0.1, 0.1), 0, R(-0.1, 0.1))), p.clone().addScaledVector(d, L)], rs: [r0 * 0.35, r0 * 0.18, 0.003], ss: [0, L / 2, L], depth: 3, trunk: false, r0: r0 * 0.35 }, sp, 0, rand);
    }
    moss(buf, { pts, rs, ss, depth: 1, trunk: true, r0 }, rand, 1.5);
  }
  return toGeometry(buf);
}

/** A few pale toadstools for the roots. */
function mushroomGeometry(seed: number) {
  const rand = rng(seed);
  const buf = newBuf();
  for (let k = 0; k < 6; k++) {
    const x = (rand() - 0.5) * 0.4, z = (rand() - 0.5) * 0.4, h = 0.03 + rand() * 0.07, cr = 0.015 + rand() * 0.035;
    const parts: [THREE.BufferGeometry, number][] = [
      [new THREE.CylinderGeometry(cr * 0.25, cr * 0.3, h, 5).translate(x, h / 2 - 0.02, z), 3],
      [new THREE.SphereGeometry(cr, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(x, h - 0.02, z), 3],
    ];
    for (const [g] of parts) {
      const ng = g.toNonIndexed();
      const p = ng.attributes.position, n = ng.attributes.normal;
      const base = buf.pos.length / 3;
      for (let i = 0; i < p.count; i++) {
        buf.pos.push(p.getX(i), p.getY(i), p.getZ(i));
        buf.nor.push(n.getX(i), n.getY(i), n.getZ(i));
        buf.uv.push(0, 0); buf.rad.push(0.01); buf.kind.push(3); buf.ao.push(1);
        buf.idx.push(base + i);
      }
    }
  }
  return toGeometry(buf);
}

// ------------------------------------------------------------- material

function barkMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'forest-bark';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aRad; attribute float aKind; attribute float aAo;
        varying vec3 vWPos; varying vec3 vWNrm; varying vec2 vBark; varying float vRad; varying float vKind; varying float vAo; varying vec3 vTint;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        vBark = uv; vRad = aRad; vKind = aKind; vAo = aAo;
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(1.0);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying vec2 vBark; varying float vRad; varying float vKind; varying float vAo; varying vec3 vTint;
        ${noiseGLSL}
        ${atmosGLSL}
        // Bark on a seamless cylinder: around-angle on a circle, length along.
        float barkH(vec2 b, float r){
          float a = b.x * 6.2831853;
          float circ = max(r, 0.03) * 7.0;
          vec3 q = vec3(cos(a) * circ, sin(a) * circ, b.y * 1.1);
          float f = fbm(q * vec3(1.0, 1.0, 0.28));
          float ridge = 1.0 - abs(2.0 * f - 1.0);
          float plates = vnoise(q * vec3(1.6, 1.6, 0.7) + 3.0);
          return smoothstep(0.25, 0.75, ridge) * 0.75 + plates * 0.25;
        }`)
      .replace('#include <map_fragment>', `
        vec3 nW = normalize(vWNrm);
        float h = 0.0;
        vec3 alb;
        float rough = 0.97;
        if (vKind < 0.5) {
          h = barkH(vBark, vRad);
          vec3 plate = mix(vec3(0.017,0.016,0.015), vec3(0.028,0.025,0.022), vnoise(vWPos*0.7));
          alb = mix(vec3(0.003,0.0028,0.0026), plate, h);
          alb *= mix(0.55, 1.0, smoothstep(-0.6, 0.4, nW.y));
          // Lichen: pale grey-green crusts; moss on the up-facing sides.
          float lich = smoothstep(0.6, 0.72, fbm(vWPos * 3.1 + 4.0)) * step(0.05, vRad) * h;
          alb = mix(alb, vec3(0.07,0.075,0.06), lich * 0.5);
          float up = nW.y + (fbm(vWPos * 0.9) - 0.5) * 0.8;
          float moss = smoothstep(0.15, 0.6, up) * smoothstep(0.03, 0.12, vRad);
          moss = max(moss, (1.0 - smoothstep(0.0, 1.4, vBark.y)) * smoothstep(0.45, 0.6, fbm(vWPos * 2.3)));
          alb = mix(alb, vec3(0.04,0.06,0.022) * (0.6 + 0.8 * fbm(vWPos * 6.0)), moss * 0.85);
          // Dark, wet foot.
          alb *= mix(0.55, 1.0, smoothstep(0.0, 1.6, vBark.y));
        } else if (vKind < 1.5) {
          float f = fbm(vWPos * 9.0);
          alb = vec3(0.035,0.055,0.02) * (0.6 + 0.8 * f);
          h = f;
        } else if (vKind < 2.5) {
          float f = vnoise(vWPos * 13.0);
          alb = mix(vec3(0.14,0.07,0.03), vec3(0.24,0.13,0.05), f) * (1.0 - 0.5 * max(abs(vBark.x), abs(vBark.y)));
          rough = 0.9;
        } else {
          alb = mix(vec3(0.45,0.42,0.36), vec3(0.32,0.24,0.16), smoothstep(0.0, 0.05, vWPos.y - floor(vWPos.y)));
          rough = 0.8;
        }
        diffuseColor.rgb *= alb * vAo * vTint;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float k = 0.035 * (1.0 - smoothstep(8.0, 30.0, length(vViewPosition)));
          vec3 pos = -vViewPosition;
          vec3 dx = dFdx(pos), dy = dFdy(pos);
          vec3 r1 = cross(dy, normal), r2 = cross(normal, dx);
          float det = dot(dx, r1);
          vec3 grad = sign(det) * (dFdx(h * k) * r1 + dFdy(h * k) * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <fog_fragment>', `gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPos);
        if (any(isnan(gl_FragColor.rgb)) || any(isinf(gl_FragColor.rgb))) gl_FragColor.rgb = vec3(0.0);`);
  };
  return m;
}

// ------------------------------------------------------------- placement

export const treeSpots: THREE.Vector2[] = [];

interface Kind { geos: THREE.BufferGeometry[]; dists: number[]; meshes: THREE.InstancedMesh[]; mats: THREE.Matrix4[]; pos: THREE.Vector3[]; rad: number[]; cols: THREE.Color[] }

/**
 * Plant the wood outside the walls. `inside(x,z)` is true within the town;
 * `keepOut(x,z)` marks clearings (gate, tomb road, aqueduct).
 * The returned object updates its own LOD/culling every few frames.
 */
export function buildForest(scene: THREE.Scene, b: Builder, opts: { inside: (x: number, z: number) => boolean; keepOut: (x: number, z: number) => boolean }): THREE.Object3D {
  const rand = rng(90210);
  const R = (a: number, b2: number) => a + (b2 - a) * rand();
  const group = new THREE.Group();
  group.name = 'forest';
  const mat = barkMaterial();
  const gv = new THREE.Vector3();
  const groundAt = (x: number, z: number) => field(x, 0, z, 'ground', gv).y;

  const kinds: Kind[] = [];
  /** geos[i] is drawn out to dists[i] metres. */
  const mk = (geos: THREE.BufferGeometry[], dists: number[]): Kind => {
    const k: Kind = { geos, dists, meshes: [], mats: [], pos: [], rad: [], cols: [] };
    kinds.push(k);
    return k;
  };
  // Two seeds per species.
  const treeKinds: { k: Kind; sp: Species }[] = [];
  SPECIES.forEach((sp, i) => {
    for (let v = 0; v < (sp.name.startsWith('ancient') || sp.name === 'witch' ? 1 : 2); v++) {
      const g = treeGeometry(sp, 1000 + i * 17 + v * 101);
      treeKinds.push({ k: mk([g.hi, g.lo, g.far], [12, 34, 88]), sp });
    }
  });
  const brambles = [mk([brambleGeometry(5)], [26]), mk([brambleGeometry(9)], [26])];
  const logs = [mk([deadwoodGeometry(11, false)], [55]), mk([deadwoodGeometry(12, false)], [55])];
  const stumps = [mk([deadwoodGeometry(21, true)], [50]), mk([deadwoodGeometry(22, true)], [50])];
  const shrooms = mk([mushroomGeometry(3)], [16]);

  const pick = (list: { k: Kind; sp: Species }[], w: (sp: Species) => number) => {
    const total = list.reduce((a, e) => a + w(e.sp), 0);
    let r = rand() * total;
    for (const e of list) { r -= w(e.sp); if (r <= 0) return e; }
    return list[list.length - 1];
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const place = (k: Kind, x: number, z: number, s: number, ry: number, tiltX = 0, tiltZ = 0, sink = 0.15, rad = 1) => {
    const y = groundAt(x, z) - sink * s;
    e.set(tiltX, ry, tiltZ, 'YXZ');
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * R(0.92, 1.12), s));
    k.mats.push(m4.clone());
    k.pos.push(new THREE.Vector3(x, y, z));
    k.rad.push(rad * s);
    const t = R(0.8, 1.15);
    k.cols.push(new THREE.Color(t * R(0.95, 1.05), t, t * R(0.92, 1.0)));
  };

  // Scanned ground cover (Poly Haven), when loaded. Returns false otherwise.
  const scan = (id: PropId, x: number, z: number, s: number, ry: number, sink: number) =>
    propsLoaded(id) && placeProp(null, id, x, sink * s, z, ry, s, { tilt: [R(-0.08, 0.08), R(-0.08, 0.08)] }) !== null;

  // Collision: a six-sided prism round the foot of each sizeable trunk.
  const colPos: number[] = [];
  const prism = (x: number, z: number, r: number) => {
    const y0 = groundAt(x, z) - 0.5, y1 = y0 + 3.5;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      const x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
      colPos.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0);
    }
  };

  const nearWall = (x: number, z: number, d: number) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (opts.inside(x + Math.cos(a) * d, z + Math.sin(a) * d)) return true;
    }
    return false;
  };

  // Ground cover draws from its own sequence, so the trees stay where they were.
  const gr = rng(4711);
  const GR = (a: number, b2: number) => a + (b2 - a) * gr();
  const STEP = 3.7, RMAX = 225;
  for (let gz = -RMAX; gz <= RMAX; gz += STEP) for (let gx = -RMAX; gx <= RMAX; gx += STEP) {
    const x = gx + R(-0.48, 0.48) * STEP, z = gz + R(-0.48, 0.48) * STEP;
    const r = Math.hypot(x, z);
    if (r > RMAX || opts.inside(x, z) || opts.keepOut(x, z)) continue;
    if (nearWall(x, z, 7)) { if (rand() < 0.93) continue; }
    // Ground cover (scans) everywhere in the wood: ferns, nettles, weeds,
    // fallen branches, bark, mossy stones; thick near the town, where people
    // walk, it is thinner but the fog hides how far it goes anyway.
    if (r < 150) for (let g = 0; g < 5; g++) {
      if (gr() > 0.8) continue;
      const gx2 = x + GR(-1.8, 1.8), gz2 = z + GR(-1.8, 1.8);
      if (opts.inside(gx2, gz2) || opts.keepOut(gx2, gz2)) continue;
      const u = gr();
      if (u < 0.22) scan('fern_02', gx2, gz2, GR(1.0, 1.6), GR(0, 6.28), 0);
      else if (u < 0.4) scan('nettle_plant', gx2, gz2, GR(3.5, 6), GR(0, 6.28), 0);
      else if (u < 0.55) scan('weed_plant_02', gx2, gz2, GR(3, 5), GR(0, 6.28), 0);
      else if (u < 0.68) scan('dry_branches_medium_01', gx2, gz2, GR(1.2, 2.2), GR(0, 6.28), 0);
      else if (u < 0.78) scan('bark_debris_01', gx2, gz2, GR(1.5, 3), GR(0, 6.28), 0);
      else if (u < 0.88) scan('rock_moss_set_02', gx2, gz2, GR(0.3, 0.8), GR(0, 6.28), -0.05);
      else if (u < 0.95) scan('grass_medium_02', gx2, gz2, GR(0.7, 1.1), GR(0, 6.28), 0);
      else scan('shrub_02', gx2, gz2, GR(0.5, 0.9), GR(0, 6.28), 0);
    }
    let dens = 0.7;
    if (nearWall(x, z, 14)) dens = 0.3;
    // Groves and glades: a slow noise modulates the density.
    dens *= 0.55 + 0.75 * (0.5 + 0.5 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 - 0.7));
    if (rand() > dens) {
      // Undergrowth in the gaps.
      const u = rand();
      if (u < 0.26) { const bk = brambles[rand() < 0.5 ? 0 : 1]; place(bk, x, z, R(0.7, 1.5), R(0, 6.28), 0, 0, 0.05); }
      else if (u < 0.31) {
        // A fallen trunk, scanned (or the procedural one).
        const id: PropId = rand() < 0.5 ? 'dead_tree_trunk' : 'dead_tree_trunk_02';
        if (!scan(id, x, z, R(1.0, 1.6), R(0, 6.28), -0.08)) { const lk = logs[rand() < 0.5 ? 0 : 1]; place(lk, x, z, R(0.8, 1.2), R(0, 6.28), 0, 0, 0.12); }
      } else if (u < 0.36) {
        const id: PropId = rand() < 0.5 ? 'tree_stump_01' : 'tree_stump_02';
        if (!scan(id, x, z, R(0.7, 1.15), R(0, 6.28), -0.06)) { const sk = stumps[rand() < 0.5 ? 0 : 1]; place(sk, x, z, R(0.8, 1.3), R(0, 6.28), 0, 0, 0.05); }
        prism(x, z, 0.55);
      } else if (u < 0.42) {
        scan(rand() < 0.5 ? 'rock_moss_set_01' : 'rock_moss_set_02', x, z, R(0.7, 1.5), R(0, 6.28), -0.1);
      } else if (u < 0.5) {
        scan((['nettle_plant', 'fern_02', 'weed_plant_02', 'shrub_02', 'dry_branches_medium_01', 'bark_debris_01'] as PropId[])[Math.floor(rand() * 6)], x, z, R(0.8, 1.3) * (rand() < 0.5 ? 1 : 3), R(0, 6.28), 0);
      }
      continue;
    }
    const big = rand() < 0.07;
    const e2 = big
      ? pick(treeKinds, (sp) => (sp.name.startsWith('ancient') || sp.name === 'witch' ? 1 : 0))
      : pick(treeKinds, (sp) => (sp.name.startsWith('ancient') || sp.name === 'witch' ? 0.05 : sp.name.startsWith('young') ? 2.2 : sp.name.startsWith('snag') ? 0.7 : 1));
    const s = big ? R(1.0, 1.35) : R(0.75, 1.2);
    place(e2.k, x, z, s, R(0, 6.28), R(-0.06, 0.06), R(-0.06, 0.06), big ? 0.25 : 0.15, e2.sp.r0 * 1.6 + 2);
    if (e2.sp.r0 * s > 0.15) prism(x, z, e2.sp.r0 * s * 0.95);
    if (big) {
      treeSpots.push(new THREE.Vector2(x, z));
      // Old trees heave their roots out of the ground and gather moss-grown stones.
      const a = R(0, 6.28);
      scan(rand() < 0.5 ? 'root_cluster_01' : 'pine_roots', x + Math.cos(a) * e2.sp.r0 * s * 0.6, z + Math.sin(a) * e2.sp.r0 * s * 0.6, R(0.8, 1.2), a, -0.05);
      if (rand() < 0.5) scan('rock_moss_set_01', x + Math.cos(a + 2) * (e2.sp.r0 * s + 2), z + Math.sin(a + 2) * (e2.sp.r0 * s + 2), R(1.4, 2.2), R(0, 6.28), -0.15);
    } else if (rand() < 0.12) {
      const a = R(0, 6.28);
      scan('root_cluster_02', x + Math.cos(a) * 0.6, z + Math.sin(a) * 0.6, R(1.2, 2.2), a, -0.03);
    }
    // Toadstools and brambles at the roots.
    if (rand() < 0.35) { const a = R(0, 6.28), d = e2.sp.r0 * s * R(1.3, 2.4); place(shrooms, x + Math.cos(a) * d, z + Math.sin(a) * d, R(0.8, 1.6), R(0, 6.28), 0, 0, 0.02); }
    if (rand() < 0.4) { const a = R(0, 6.28), d = e2.sp.r0 * s + R(1.2, 2.8); place(brambles[rand() < 0.5 ? 0 : 1], x + Math.cos(a) * d, z + Math.sin(a) * d, R(0.6, 1.2), R(0, 6.28), 0, 0, 0.05); }
  }

  commitProps(scene);
  if (colPos.length) {
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(colPos, 3));
    b.collide(cg);
  }

  for (const k of kinds) {
    const n = Math.max(1, k.mats.length);
    for (const g of k.geos) {
      const im = new THREE.InstancedMesh(g, mat, n);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      im.count = 0;
      im.frustumCulled = false;
      group.add(im);
      k.meshes.push(im);
    }
  }

  // LOD and per-instance culling, every few frames, from whichever camera renders.
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
  let frame = 0;
  const update = (camera: THREE.Camera) => {
    if (frame++ % 3 !== 0) return;
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    const cp = camera.position;
    const counts: number[] = [];
    for (const k of kinds) {
      counts.length = 0;
      for (let l = 0; l < k.meshes.length; l++) counts.push(0);
      const maxD = k.dists[k.dists.length - 1];
      for (let i = 0; i < k.mats.length; i++) {
        const d = k.pos[i].distanceTo(cp);
        if (d > maxD) continue;
        sph.center.copy(k.pos[i]); sph.center.y += k.rad[i] * 2;
        sph.radius = k.rad[i] * 4 + 4;
        if (!frustum.intersectsSphere(sph)) continue;
        let l = 0;
        while (d > k.dists[l]) l++;
        const im = k.meshes[l];
        im.setMatrixAt(counts[l], k.mats[i]);
        im.setColorAt(counts[l], k.cols[i]);
        counts[l]++;
      }
      k.meshes.forEach((im, l) => {
        im.count = counts[l];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      });
    }
  };
  // An invisible, never-culled helper that triggers the update each render.
  const ticker = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;
  ticker.onBeforeRender = (_r, _s, camera) => update(camera);
  group.add(ticker);
  group.userData.update = update;
  group.userData.stats = () => {
    let inst = 0, tris = 0, drawn = 0;
    for (const k of kinds) {
      inst += k.mats.length;
      tris += k.geos[0].index!.count / 3;
      k.meshes.forEach((im, l) => { drawn += im.count * (k.geos[l].index!.count / 3); });
    }
    return { kinds: kinds.length, instances: inst, trianglesPerSet: tris, drawn };
  };
  scene.add(group);
  return group;
}
