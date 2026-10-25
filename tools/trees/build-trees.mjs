// Builds the vegetation pack from downloaded source models.
//
//   node tools/trees/build-trees.mjs <dir with the downloads>
//
// <dir>/<name>/model.glb for each source in SOURCES (see public/models/trees/CREDITS.md
// for where they come from). Writes public/models/trees/:
//   trees.json   every tree, every LOD: quantized geometry in one base64 blob
//   bark.webp    bark atlas (1024²): the oak pack's bark, a crusty oak bark, a dead-wood bark, poplar bark
//   barkn.webp   the same atlas's normal maps (512²)
//   leafA.webp   oak twig clusters, late autumn (1024²)
//   leafB.webp   oak twig clusters with dead brown leaves (left), poplar twigs (right) (1024×512)
// Impostors are baked afterwards from this pack in a browser (tools/trees/bake-impostors.cjs).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: build-trees.mjs <download dir>');
const OUT = path.resolve('public/models/trees');
fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const docs = {};
const doc = async (name) => (docs[name] ??= await io.read(path.join(SRC, name, 'model.glb')));

// ------------------------------------------------------------------ atlas layout
// Bark atlas (UV space, origin top-left like glTF): tile rects [u0, v0, du, dv].
const BARK = { oak: [0, 0, 0.5, 1], crust: [0.5, 0, 0.25, 0.5], poplar: [0.75, 0, 0.25, 0.5], dead: [0.5, 0.5, 0.5, 0.5] };
const BARK_ID = { oak: 0, crust: 1, poplar: 2, dead: 3 };
// Leaf kinds: 0 = oak cluster (texture chosen per instance: A, or the left half of B),
// 1 = poplar twig (already mapped into the right half of B).
const POPLAR_CROP = [0.59, 0, 0.34, 0.5]; // the part of the poplar's texture its cards use

// ------------------------------------------------------------------ geometry helpers
/** Every mesh primitive below `root` whose node name matches `re`, baked into world space (y up, the file's units). */
function collect(root, re, matRe) {
  const parts = [];
  const walk = (n) => {
    const m = n.getMesh();
    if (m && re.test(n.getName() + ' ' + m.getName())) {
      const M = n.getWorldMatrix();
      const N = normalMatrix(M);
      for (const p of m.listPrimitives()) {
        if (matRe && !matRe.test(p.getMaterial()?.getName() ?? '')) continue;
        const P = p.getAttribute('POSITION').getArray(), Nn = p.getAttribute('NORMAL')?.getArray(), U = p.getAttribute('TEXCOORD_0')?.getArray();
        const n3 = P.length / 3;
        const pos = new Float32Array(n3 * 3), nrm = new Float32Array(n3 * 3), uv = new Float32Array(n3 * 2);
        for (let i = 0; i < n3; i++) {
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
          pos[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
          pos[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
          pos[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
          if (Nn) {
            const a = Nn[i * 3], b = Nn[i * 3 + 1], c = Nn[i * 3 + 2];
            let nx = N[0] * a + N[3] * b + N[6] * c, ny = N[1] * a + N[4] * b + N[7] * c, nz = N[2] * a + N[5] * b + N[8] * c;
            const l = Math.hypot(nx, ny, nz) || 1;
            nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
          } else nrm[i * 3 + 1] = 1;
          if (U) { uv[i * 2] = U[i * 2]; uv[i * 2 + 1] = U[i * 2 + 1]; }
        }
        const I = p.getIndices()?.getArray();
        const idx = I ? Uint32Array.from(I) : Uint32Array.from({ length: n3 }, (_, i) => i);
        parts.push({ pos, nrm, uv, idx });
      }
    }
    for (const c of n.listChildren()) walk(c);
  };
  walk(root);
  return merge(parts);
}
function merge(parts) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.pos.length / 3; ni += p.idx.length; }
  const out = { pos: new Float32Array(nv * 3), nrm: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), idx: new Uint32Array(ni) };
  let v = 0, i = 0;
  for (const p of parts) {
    out.pos.set(p.pos, v * 3); out.nrm.set(p.nrm, v * 3); out.uv.set(p.uv, v * 2);
    for (let k = 0; k < p.idx.length; k++) out.idx[i + k] = p.idx[k] + v;
    v += p.pos.length / 3; i += p.idx.length;
  }
  return out;
}
const tris = (g) => g.idx.length / 3;
function mul(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}
function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ];
}
function normalMatrix(m) {
  const inv = invert(m);
  // transpose of the upper 3x3 of the inverse
  return [inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]];
}
function transform(g, s, dx, dy, dz) {
  for (let i = 0; i < g.pos.length; i += 3) { g.pos[i] = (g.pos[i] + dx) * s; g.pos[i + 1] = (g.pos[i + 1] + dy) * s; g.pos[i + 2] = (g.pos[i + 2] + dz) * s; }
}
function bbox(g) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g.pos[i + k]); hi[k] = Math.max(hi[k], g.pos[i + k]); }
  return { lo, hi };
}
/** Where the trunk meets the ground: centre of the bark within `band` m of the lowest point. */
function trunkFoot(bark, band) {
  const { lo } = bbox(bark);
  let sx = 0, sz = 0, n = 0, r = 0;
  for (let i = 0; i < bark.pos.length; i += 3) if (bark.pos[i + 1] < lo[1] + band) { sx += bark.pos[i]; sz += bark.pos[i + 2]; n++; }
  const cx = sx / n, cz = sz / n;
  for (let i = 0; i < bark.pos.length; i += 3) if (bark.pos[i + 1] < lo[1] + band * 2 && bark.pos[i + 1] > lo[1] + band) r = Math.max(r, Math.hypot(bark.pos[i] - cx, bark.pos[i + 2] - cz));
  return { cx, cz, y: lo[1], r };
}
/** Trunk radius at 1.3 m (breast height) above the foot: the median distance of bark vertices from the axis. */
function trunkRadius(bark) {
  const d = [];
  for (let i = 0; i < bark.pos.length; i += 3) if (Math.abs(bark.pos[i + 1] - 1.3) < 0.4) d.push(Math.hypot(bark.pos[i], bark.pos[i + 2]));
  d.sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length * 0.5)] : 0.2;
}
/** Simplify to about `target` triangles, keeping UV seams and normals sensible. */
function simplify(g, target, maxErr = 0.05) {
  if (tris(g) <= target) return g;
  const n = g.pos.length / 3;
  const attr = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) { attr.set(g.nrm.subarray(i * 3, i * 3 + 3), i * 5); attr[i * 5 + 3] = g.uv[i * 2]; attr[i * 5 + 4] = g.uv[i * 2 + 1]; }
  const [idx] = MeshoptSimplifier.simplifyWithAttributes(g.idx, g.pos, 3, attr, 5, [0.3, 0.3, 0.3, 0.6, 0.6], null, Math.floor(target) * 3, maxErr, []);
  return compact({ ...g, idx });
}
/** Coarse LODs: topology-blind clustering (thin branches merge into a few strands, fine at a distance). */
function sloppy(g, target) {
  if (tris(g) <= target) return g;
  const [idx] = MeshoptSimplifier.simplifySloppy(g.idx, g.pos, 3, null, Math.floor(target) * 3, 1);
  return compact({ ...g, idx });
}
function compact(g) {
  const map = new Int32Array(g.pos.length / 3).fill(-1);
  let n = 0;
  for (const i of g.idx) if (map[i] < 0) map[i] = n++;
  const out = { pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), idx: new Uint32Array(g.idx.length) };
  for (let i = 0; i < map.length; i++) if (map[i] >= 0) {
    out.pos.set(g.pos.subarray(i * 3, i * 3 + 3), map[i] * 3); out.nrm.set(g.nrm.subarray(i * 3, i * 3 + 3), map[i] * 3); out.uv.set(g.uv.subarray(i * 2, i * 2 + 2), map[i] * 2);
  }
  for (let k = 0; k < g.idx.length; k++) out.idx[k] = map[g.idx[k]];
  return out;
}
/** Weld vertices that share position and uv (sculpts come split per triangle); normals are averaged. */
function weld(g) {
  const key = new Map(), n = g.pos.length / 3, remap = new Uint32Array(n);
  const q = (v, s) => Math.round(v * s);
  let m = 0;
  const keep = [];
  for (let i = 0; i < n; i++) {
    const k = `${q(g.pos[i * 3], 1e4)},${q(g.pos[i * 3 + 1], 1e4)},${q(g.pos[i * 3 + 2], 1e4)},${q(g.uv[i * 2], 1e4)},${q(g.uv[i * 2 + 1], 1e4)}`;
    let j = key.get(k);
    if (j === undefined) { j = m++; key.set(k, j); keep.push(i); }
    remap[i] = j;
  }
  const out = { pos: new Float32Array(m * 3), nrm: new Float32Array(m * 3), uv: new Float32Array(m * 2), idx: g.idx.map((i) => remap[i]) };
  keep.forEach((i, j) => { out.pos.set(g.pos.subarray(i * 3, i * 3 + 3), j * 3); out.uv.set(g.uv.subarray(i * 2, i * 2 + 2), j * 2); });
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out.nrm[remap[i] * 3 + k] += g.nrm[i * 3 + k];
  for (let j = 0; j < m; j++) { const l = Math.hypot(out.nrm[j * 3], out.nrm[j * 3 + 1], out.nrm[j * 3 + 2]) || 1; for (let k = 0; k < 3; k++) out.nrm[j * 3 + k] /= l; }
  return out;
}
/** Keep a fraction of the leaf cards (connected pieces), each grown a little so the crown keeps its mass. */
function thinCards(g, keep, seed) {
  const n = g.pos.length / 3, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < g.idx.length; t += 3) { const a = find(g.idx[t]), b = find(g.idx[t + 1]), c = find(g.idx[t + 2]); parent[b] = a; parent[find(c)] = a; }
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const kept = new Map();
  const comp = (i) => { const r = find(i); if (!kept.has(r)) kept.set(r, rnd() < keep); return kept.get(r); };
  const idx = [];
  for (let t = 0; t < g.idx.length; t += 3) if (comp(g.idx[t])) idx.push(g.idx[t], g.idx[t + 1], g.idx[t + 2]);
  const out = compact({ ...g, idx: Uint32Array.from(idx) });
  // grow each kept card about its own centre
  const roots = new Map();
  const n2 = out.pos.length / 3, p2 = Int32Array.from({ length: n2 }, (_, i) => i);
  const f2 = (i) => { while (p2[i] !== i) { p2[i] = p2[p2[i]]; i = p2[i]; } return i; };
  for (let t = 0; t < out.idx.length; t += 3) { const a = f2(out.idx[t]); p2[f2(out.idx[t + 1])] = a; p2[f2(out.idx[t + 2])] = a; }
  for (let i = 0; i < n2; i++) { const r = f2(i); const c = roots.get(r) ?? [0, 0, 0, 0]; c[0] += out.pos[i * 3]; c[1] += out.pos[i * 3 + 1]; c[2] += out.pos[i * 3 + 2]; c[3]++; roots.set(r, c); }
  const grow = Math.min(1.5, 1 / Math.sqrt(keep));
  for (let i = 0; i < n2; i++) {
    const c = roots.get(f2(i));
    for (let k = 0; k < 3; k++) out.pos[i * 3 + k] = c[k] / c[3] + (out.pos[i * 3 + k] - c[k] / c[3]) * grow;
  }
  return out;
}
/** Bark UVs stay tiling; the shader wraps them into the atlas tile named by `kind`. */
const withKind = (g, kind) => ({ ...g, kind });

// ------------------------------------------------------------------ the trees
const trees = [];
const meshes = [];
let binParts = [];
let binLen = 0;
function pushMesh(g) {
  if (!g || g.idx.length === 0) return -1;
  // Vertex cache / fetch order, then the meshopt codec (decoded in the browser by three's meshopt_decoder).
  const [remap, n] = MeshoptEncoder.reorderMesh(Uint32Array.from(g.idx), true, true);
  const idx = new Uint32Array(g.idx.length);
  for (let k = 0; k < idx.length; k++) idx[k] = remap[g.idx[k]];
  const { lo, hi } = bbox(g);
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < g.uv.length; i += 2) { u0 = Math.min(u0, g.uv[i]); u1 = Math.max(u1, g.uv[i]); v0 = Math.min(v0, g.uv[i + 1]); v1 = Math.max(v1, g.uv[i + 1]); }
  // 16 bytes a vertex: int16 x y z kind | int8 nx ny nz 0 | uint16 u v  (positions and uvs relative to the mesh bounds)
  const vb = Buffer.alloc(n * 16);
  const qp = (v, k) => Math.round(((v - lo[k]) / Math.max(1e-6, hi[k] - lo[k])) * 65535) - 32768;
  const quv = (v, a, b) => Math.round(((v - a) / Math.max(1e-6, b - a)) * 65535);
  const sn = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i];
    if (j === 0xffffffff) continue;
    const o = j * 16;
    for (let k = 0; k < 3; k++) vb.writeInt16LE(qp(g.pos[i * 3 + k], k), o + k * 2);
    vb.writeInt16LE(g.kind, o + 6);
    for (let k = 0; k < 3; k++) vb.writeInt8(sn(g.nrm[i * 3 + k]), o + 8 + k);
    vb.writeUInt16LE(quv(g.uv[i * 2], u0, u1), o + 12);
    vb.writeUInt16LE(quv(g.uv[i * 2 + 1], v0, v1), o + 14);
  }
  const big = n > 65535;
  const ib = big ? new Uint8Array(idx.buffer) : new Uint8Array(Uint16Array.from(idx).buffer);
  const ev = Buffer.from(MeshoptEncoder.encodeVertexBufferLevel(new Uint8Array(vb.buffer, vb.byteOffset, vb.length), n, 16, 2, 0));
  const ei = Buffer.from(MeshoptEncoder.encodeIndexBuffer(ib, idx.length, big ? 4 : 2));
  meshes.push({ n, i: idx.length, ib: big ? 4 : 2, v: [binLen, ev.length], x: [binLen + ev.length, ei.length], bb: [...lo, ...hi].map((v) => +v.toFixed(4)), uv: [u0, v0, u1, v1].map((v) => +v.toFixed(5)) });
  binParts.push(ev, ei);
  binLen += ev.length + ei.length;
  return meshes.length - 1;
}

/**
 * Add a tree. lods: [{bark, leaf}] geometries already in metres, foot at the origin.
 * `fade` is the distance (m) out to which mesh LODs are drawn; impostors take over after.
 */
function addTree(def, lods) {
  const bark0 = lods[0].bark;
  const all = merge(lods[0].leaf ? [bark0, lods[0].leaf] : [bark0]);
  const { lo, hi } = bbox(all);
  let crown = 0;
  for (let i = 0; i < all.pos.length; i += 3) crown = Math.max(crown, Math.hypot(all.pos[i], all.pos[i + 2]));
  const t = {
    id: def.id, group: def.group, src: def.src,
    h: +hi[1].toFixed(2), crown: +crown.toFixed(2), trunk: +trunkRadius(bark0).toFixed(3),
    bb: [...lo, ...hi].map((v) => +v.toFixed(2)),
    lods: lods.map((l) => [pushMesh(l.bark), pushMesh(l.leaf)]),
    tris: lods.map((l) => tris(l.bark) + (l.leaf ? tris(l.leaf) : 0)),
  };
  trees.push(t);
  console.log(t.id.padEnd(10), 'h', t.h, 'crown', t.crown, 'trunk', t.trunk, 'tris', t.tris.join('/'));
}

// The oak pack (lolipop_1707): every tree has LOD0..2 with a bark part and a twig-cluster part.
const OAKS = [
  ['oakL1', 'Large_oak_tree_001', [1, 2]], ['oakL2', 'Large_oak_tree_002', [1, 2]], ['oakL3', 'Large_oak_tree_003', [1, 2]],   ['oakB1', 'Big_oak_tree__001', [0, 1, 2]], ['oakB3', 'Big_oak_tree__003', [0, 1, 2]], ['oakB4', 'Big_oak_tree__004', [0, 1, 2]],
  ['oakM1', 'Medium_oak_tree__001', [0, 1, 2]], ['oakM2', 'Medium_oak_tree__002', [0, 1, 2]], ['oakM3', 'Medium_oak_tree__003', [0, 1, 2]],
  ['oakS1', 'Small_oak_tree__001', [0, 1]], ['oakS2', 'Small_oak_tree__002', [0, 1]],
];
{
  const d = await doc('lolipop_oaks');
  const nodes = new Map();
  d.getRoot().listNodes().forEach((n) => nodes.set(n.getName(), n));
  for (const [id, name, levels] of OAKS) {
    const root = nodes.get(name);
    const lods = levels.map((l) => {
      const bark = withKind(collect(root, new RegExp(`_LOD${l}_Bark`)), BARK_ID.oak);
      const leaf = withKind(collect(root, new RegExp(`_LOD${l}_Cluster`)), 0);
      return { bark, leaf };
    });
    const f = trunkFoot(lods[0].bark, 0.3);
    for (const l of lods) { transform(l.bark, 1, -f.cx, -f.y, -f.cz); transform(l.leaf, 1, -f.cx, -f.y, -f.cz); }
    // One more, coarser level for the bigger trees (the pack's LOD2 is still 3-10k triangles).
    const last = lods[lods.length - 1];
    if (tris(last.bark) + tris(last.leaf) > 2500) lods.push({ bark: withKind(sloppy(last.bark, Math.max(150, tris(last.bark) * 0.35)), BARK_ID.oak), leaf: withKind(thinCards(last.leaf, 0.4, 3), 0) });
    addTree({ id, group: id.slice(0, 4), src: 'lolipop_oaks' }, lods);
  }
}

// Ancient pollard oak (Sereib): bark only, sculpted; 190k triangles brought down.
async function heroBark(id, src, height, bark, targets, opts = {}) {
  const d = await doc(src);
  const scene = d.getRoot().listScenes()[0];
  let g = weld(collect(scene.listChildren()[0], /./));
  const { lo, hi } = bbox(g);
  const s = height / (hi[1] - lo[1]);
  const f = trunkFoot(g, (hi[1] - lo[1]) * 0.03);
  transform(g, s, -f.cx, -f.y - (hi[1] - lo[1]) * (opts.sink ?? 0.01), -f.cz);
  // tiling: the source textures are tileable barks; repeat them a little more on a big trunk
  if (opts.uvScale) for (let i = 0; i < g.uv.length; i++) g.uv[i] *= opts.uvScale;
  const g0 = simplify(g, targets[0], 1);
  const lods = targets.map((t, k) => ({ bark: withKind(k === 0 ? g0 : sloppy(g0, t), BARK_ID[bark]), leaf: null }));
  console.log(`  ${id}: source ${tris(g)} tris`);
  addTree({ id, group: id, src }, lods);
}
await heroBark('ancient', 'sereib_oldoak', 15, 'crust', [18000, 6000, 2400], {});
await heroBark('twisted', 'yn_dead1', 13, 'dead', [18000, 6000, 2400]);
await heroBark('snag', 'yn_dead2', 14, 'dead', [9000, 3500, 1400]);

// Riverside poplar (intice184): bark + twig cards.
{
  const d = await doc('intice_poplar');
  const root = d.getRoot().listScenes()[0].listChildren()[0];
  const bark = collect(root, /Bark/);
  let leaf = collect(root, /Branch/);
  // map the cards' corner of the source texture into the right half of leafB
  for (let i = 0; i < leaf.uv.length; i += 2) {
    leaf.uv[i] = 0.5 + ((leaf.uv[i] - POPLAR_CROP[0]) / POPLAR_CROP[2]) * 0.5;
    leaf.uv[i + 1] = (leaf.uv[i + 1] - POPLAR_CROP[1]) / POPLAR_CROP[3];
  }
  const { lo, hi } = bbox(merge([bark, leaf]));
  const s = 19 / (hi[1] - lo[1]);
  const f = trunkFoot(bark, 0.3);
  for (const g of [bark, leaf]) transform(g, s, -f.cx, -f.y, -f.cz);
  const b0 = withKind(weld(bark), BARK_ID.poplar), l0 = withKind(leaf, 1);
  addTree({ id: 'poplar', group: 'poplar', src: 'intice_poplar' }, [
    { bark: b0, leaf: l0 },
    { bark: withKind(simplify(b0, 2500, 0.02), BARK_ID.poplar), leaf: withKind(thinCards(leaf, 0.5, 7), 1) },
    { bark: withKind(simplify(b0, 900, 0.05), BARK_ID.poplar), leaf: withKind(thinCards(leaf, 0.25, 11), 1) },
    { bark: withKind(sloppy(b0, 350), BARK_ID.poplar), leaf: withKind(thinCards(leaf, 0.11, 13), 1) },
  ]);
}

// ------------------------------------------------------------------ textures
async function img(src, mat, slot) {
  const d = await doc(src);
  const m = d.getRoot().listMaterials().find((x) => x.getName() === mat);
  const t = slot === 'nrm' ? m.getNormalTexture() : m.getBaseColorTexture();
  return Buffer.from(t.getImage());
}
const px = (r, W, H) => ({ left: Math.round(r[0] * W), top: Math.round(r[1] * H), width: Math.round(r[2] * W), height: Math.round(r[3] * H) });
async function atlas(W, H, tiles, bg, file, opts) {
  const comps = [];
  for (const [rect, buf, extract] of tiles) {
    const p = px(rect, W, H);
    let s = sharp(buf);
    if (extract) { const md = await sharp(buf).metadata(); s = s.extract(px(extract, md.width, md.height)); }
    comps.push({ input: await s.resize(p.width, p.height, { fit: 'fill' }).toBuffer(), left: p.left, top: p.top });
  }
  const out = await sharp({ create: { width: W, height: H, channels: 4, background: bg } }).composite(comps).webp(opts).toFile(path.join(OUT, file));
  console.log(file, W + 'x' + H, (out.size / 1024).toFixed(0) + ' KB');
}
const flat = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 128, g: 128, b: 255 } } }).png().toBuffer();
await atlas(1024, 1024, [
  [BARK.oak, await img('lolipop_oaks', 'Bark_Mat', 'base')],
  [BARK.crust, await img('sereib_oldoak', 'nature_bark_pear_01_l_0001', 'base')],
  [BARK.poplar, await img('intice_poplar', 'M_Bark.012', 'base')],
  [BARK.dead, await img('yn_dead1', 'dead_tree_mat', 'base')],
], { r: 40, g: 36, b: 32, alpha: 1 }, 'bark.webp', { quality: 82 });
await atlas(512, 512, [
  [BARK.oak, await img('lolipop_oaks', 'Bark_Mat', 'nrm')],
  [BARK.crust, flat],
  [BARK.poplar, await img('intice_poplar', 'M_Bark.012', 'nrm')],
  [BARK.dead, await img('yn_dead1', 'dead_tree_mat', 'nrm')],
], { r: 128, g: 128, b: 255, alpha: 1 }, 'barkn.webp', { quality: 85 });
await atlas(1024, 1024, [[[0, 0, 1, 1], await img('lolipop_oaks', 'Cluster_Mat_Late_Autumn_EX', 'base')]], { r: 0, g: 0, b: 0, alpha: 0 }, 'leafA.webp', { quality: 85, alphaQuality: 100 });
await atlas(1024, 512, [
  [[0, 0, 0.5, 1], await img('lolipop_oaks', 'Cluster_Mat_Early_autumn_EX', 'base')],
  [[0.5, 0, 0.5, 1], await img('intice_poplar', 'M_Branch.012', 'base'), POPLAR_CROP],
], { r: 0, g: 0, b: 0, alpha: 0 }, 'leafB.webp', { quality: 85, alphaQuality: 100 });

// ------------------------------------------------------------------ write
const bin = Buffer.concat(binParts);
const pack = { v: 1, bark: BARK, trees, meshes, bin: bin.toString('base64') };
fs.writeFileSync(path.join(OUT, 'trees.json'), JSON.stringify(pack));
console.log('trees.json', (fs.statSync(path.join(OUT, 'trees.json')).size / 1e6).toFixed(2), 'MB,', meshes.length, 'meshes,', trees.length, 'trees');
