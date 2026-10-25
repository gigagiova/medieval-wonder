// Fetch and pack the townsfolk's scanned bodies (Renderpeople free rigged
// people, photogrammetry scans, CC BY 4.0 via Sketchfab) into web-friendly
// glTF: one JSON with embedded geometry + .webp textures (the game is hosted
// where .glb/.bin are not served).
//
//   SKETCHFAB_TOKEN=... npx tsx tools/fetch-people.ts
//
// (The token is the user's own Sketchfab API token, read from the environment
// only; downloads are cached in tools/.cache/people.)
//
// Per body:
//  - bones renamed to Mixamo's names (so src/npc/rig.ts retargets onto them)
//    and set to the skin's bind pose; the clip baked into the animated scans
//    is dropped; centimetres under a 0.01 root, as Mixamo exports are;
//  - the 8K scan atlas cut down to what shows of a clothed townsman: every
//    UV island of the head, neck and hands is repacked into one 1024² skin
//    atlas (the face gets most of it), with its normal map (derived from the
//    albedo where the scan has none) and a roughness map: skin ~0.6, lips
//    and the oily T-zone smoother, hair and cavities rougher;
//  - per-vertex `_SKIN` (how much a vertex looks like skin, from the albedo:
//    shirt collars, ties, hair and jewellery score low) and `_OIL` (T-zone).
//  The modern clothes stay in the mesh: garments are fitted over them and they
//  are trimmed or re-dressed at runtime (src/npc/garment.ts).
import { NodeIO, Document, Node, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import * as THREE from 'three';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = 'public/models/npc';
const CACHE = 'tools/.cache/people';
const AT = 1024; // skin atlas size

export const PEOPLE = [
  { id: 'eric', uid: 'a46bc9f67aaa415bb4f3241eef900e7f', sex: 'man', title: 'Eric Rigged 001' },
  { id: 'nathan', uid: '143a2b1ea5eb4385ae90a73657aca3bc', sex: 'man', title: 'Nathan Animated 003 - Walking' },
  { id: 'manuel', uid: 'e65e0fef4e0743868c8d5bff36d61116', sex: 'man', title: 'Manuel Animated 001 - Dancing' },
  { id: 'claudia', uid: 'c659bd0accab47c6bbe390cf822a2b92', sex: 'woman', title: 'Claudia Rigged 002' },
  { id: 'sophia', uid: 'dc448c3be0e74f96a55fb475a13433cf', sex: 'woman', title: 'Sophia Animated 003 - Idling' },
] as const;

// ------------------------------------------------------------------ download

async function fetchModel(uid: string, dir: string) {
  if (fs.existsSync(path.join(dir, 'scene.gltf'))) return;
  const tok = process.env.SKETCHFAB_TOKEN;
  if (!tok) throw new Error(`${dir} not cached: set SKETCHFAB_TOKEN`);
  const r = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${tok}` } });
  if (!r.ok) throw new Error(`download ${uid}: HTTP ${r.status}`);
  const { gltf } = (await r.json()) as { gltf: { url: string } };
  const zip = Buffer.from(await (await fetch(gltf.url)).arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  unzip(zip, dir);
}

/** Minimal zip reader (stored/deflate), refusing paths that leave `dir`. */
function unzip(buf: Buffer, dir: string) {
  let e = buf.length - 22;
  while (buf.readUInt32LE(e) !== 0x06054b50) e--;
  let p = buf.readUInt32LE(e + 16);
  const n = buf.readUInt16LE(e + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + xl + cl;
    const dst = path.resolve(dir, name);
    if (!dst.startsWith(path.resolve(dir) + path.sep) || name.endsWith('/')) continue;
    const lo = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(lo, lo + csize);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, method === 8 ? zlib.inflateRawSync(data) : data);
  }
}

// ------------------------------------------------------------------ bones

/** Renderpeople bone → Mixamo name (facial bones under a Head prefix, twist bones under their limb's). */
function mixamoName(raw: string) {
  const n = raw.replace(/_\d+$/, '').replace(/^rp_.*_(walking|idling|dancing|rigged_\d+)_/, '');
  const fixed: Record<string, string> = {
    hip: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck: 'Neck', head: 'Head', head_end: 'HeadTop_End',
    jaw: 'HeadJaw', jaw_end: 'HeadJawEnd', root: 'Root',
  };
  if (fixed[n]) return fixed[n];
  const m = /^(.*?)_(l|r)$/.exec(n) ?? /^(.*?)_end_(l|r)$/.exec(n);
  if (!m) return n;
  const S = m[2] === 'l' ? 'Left' : 'Right', end = /_end_/.test(n);
  const b = end ? n.replace(/_end_(l|r)$/, '') : m[1];
  const limb: Record<string, string> = {
    shoulder: 'Shoulder', upperarm: 'Arm', lowerarm: 'ForeArm', hand: 'Hand', upperleg: 'UpLeg', lowerleg: 'Leg', ball: 'ToeBase',
    upperarm_twist: 'ArmTwist', lowerarm_twist: 'ForeArmTwist', upperleg_twist: 'UpLegTwist', lowerleg_twist: 'LegTwist',
  };
  if (b === 'foot') return S + (end ? 'Toe_End' : 'Foot');
  if (limb[b] && !end) return S + limb[b];
  const f = /^(thumb|index|middle|ring|pinky)(?:_0(\d))?$/.exec(b);
  if (f) return `${S}Hand${f[1][0].toUpperCase()}${f[1].slice(1)}${end ? 4 : f[2]}`;
  if (b === 'eye') return end ? `HeadEyeEnd${S}` : `${S}Eye`;
  const face: Record<string, string> = { mouth: 'Mouth', eyelid: 'Eyelid', eyebrow: 'Brow' };
  if (face[b]) return `Head${face[b]}${end ? 'End' : ''}${S}`;
  return n;
}

const toM = (a: number[]) => new THREE.Matrix4().fromArray(a);

/**
 * Name the joints, drop the baked clip, set every joint to the skin's bind
 * pose and convert to metres: positions, joint offsets and inverse bind
 * matrices, under identity roots (bone world · inverse bind = identity at
 * bind, as on a plain glTF).
 */
function prepSkeleton(doc: Document) {
  const root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  const top = root.listScenes()[0].listChildren()[0];
  // Sketchfab's Z-up wrapper: two turns that cancel.
  top.setMatrix(new THREE.Matrix4().toArray() as never);
  for (const c of top.listChildren()) c.setMatrix(new THREE.Matrix4().toArray() as never);
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices()!;
  const meshNode = root.listNodes().find((n) => n.getSkin() === skin)!;
  const Mmesh = toM(meshNode.getWorldMatrix() as number[]);
  // Joints no vertex is weighted to (end bones) carry no real bind matrix: they keep their place under their parent.
  const used = new Set<number>();
  for (const pr of meshNode.getMesh()!.listPrimitives()) {
    const J = pr.getAttribute('JOINTS_0')!, W = pr.getAttribute('WEIGHTS_0')!;
    for (let i = 0; i < J.getCount(); i++) { const j = J.getElement(i, []), w = W.getElement(i, []); for (let k = 0; k < 4; k++) if (w[k] > 0) used.add(j[k]); }
  }
  const want = new Map<Node, THREE.Matrix4>();
  joints.forEach((j, i) => { if (used.has(i)) want.set(j, Mmesh.clone().multiply(toM(ibm.getElement(i, [])).invert())); });
  const visit = (n: Node) => {
    const w = want.get(n);
    if (w) {
      const p = n.getParentNode();
      const pw = p ? toM(p.getWorldMatrix() as number[]) : new THREE.Matrix4();
      n.setMatrix(pw.invert().multiply(w).toArray() as never);
    }
    n.listChildren().forEach(visit);
  };
  visit(top);
  // Centimetres to metres.
  for (const j of joints) { const tr = j.getTranslation(); j.setTranslation([tr[0] * 0.01, tr[1] * 0.01, tr[2] * 0.01]); }
  const ib = ibm.getArray()!.slice();
  for (let i = 0; i < joints.length; i++) for (const k of [12, 13, 14]) ib[i * 16 + k] *= 0.01;
  ibm.setArray(ib);
  for (const pr of meshNode.getMesh()!.listPrimitives()) {
    const pa = pr.getAttribute('POSITION')!, a = pa.getArray()!.slice();
    for (let i = 0; i < a.length; i++) a[i] *= 0.01;
    pa.setArray(a);
  }
  for (const j of joints) j.setName(mixamoName(j.getName()));
  return { skin, joints, meshNode };
}

// ------------------------------------------------------------------ images

interface Img { w: number; h: number; c: number; d: Uint8Array }
async function load(file: string): Promise<Img> {
  const { data, info } = await sharp(file, { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, c: info.channels, d: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}
const px = (im: Img, u: number, v: number, out: number[]) => {
  const x = Math.min(im.w - 1, Math.max(0, Math.floor(u * im.w))), y = Math.min(im.h - 1, Math.max(0, Math.floor(v * im.h)));
  const o = (y * im.w + x) * im.c;
  out[0] = im.d[o]; out[1] = im.d[o + 1]; out[2] = im.d[o + 2];
  return out;
};
/** Average colour of a 5×5 block around (u, v). */
const avg = (im: Img, u: number, v: number) => {
  const s = [0, 0, 0], t = [0, 0, 0];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { px(im, u + dx / im.w, v + dy / im.h, t); s[0] += t[0]; s[1] += t[1]; s[2] += t[2]; }
  return s.map((x) => x / 25);
};

/** Fill each triangle (in atlas pixels) with barycentric-interpolated values, calling put(x, y, a, b, c). */
function raster(P: number[][], put: (x: number, y: number, w: number[]) => void) {
  const [a, b, c] = P;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(AT - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(AT - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const X = x + 0.5, Y = y + 0.5;
    const l0 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / d;
    const l1 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d;
    const l2 = 1 - l0 - l1;
    if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
    put(x, y, [l0, l1, l2]);
  }
}

/** Push covered pixels' colours outwards into the gutter, so mipmaps and filtering don't pull the background in. */
function dilate(d: Uint8Array, c: number, mask: Uint8Array, steps: number) {
  const m = mask.slice();
  for (let s = 0; s < steps; s++) {
    const add: number[] = [];
    for (let y = 0; y < AT; y++) for (let x = 0; x < AT; x++) {
      const i = y * AT + x;
      if (m[i]) continue;
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= AT || Y >= AT) continue;
        const j = Y * AT + X;
        if (!m[j]) continue;
        for (let k = 0; k < c; k++) acc[k] += d[j * c + k];
        n++;
      }
      if (n) { add.push(i); for (let k = 0; k < c; k++) d[i * c + k] = acc[k] / n; }
    }
    for (const i of add) m[i] = 1;
  }
}

function blur(src: Float32Array, r: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < AT; y++) for (let x = 0; x < AT; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const X = x + k; if (X >= 0 && X < AT) { s += src[y * AT + X]; n++; } } tmp[y * AT + x] = s / n; }
  for (let y = 0; y < AT; y++) for (let x = 0; x < AT; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const Y = y + k; if (Y >= 0 && Y < AT) { s += tmp[Y * AT + x]; n++; } } out[y * AT + x] = s / n; }
  return out;
}

// ------------------------------------------------------------------ one body

const HEADB = /^(Head|Neck|LeftEye|RightEye)/, HANDB = /Hand/, FOOTB = /Foot|Toe/, LEGB = /UpLeg|Leg/, ARMB = /Shoulder|Arm/;

async function pack(p: (typeof PEOPLE)[number], io: NodeIO) {
  const dir = path.join(CACHE, p.id);
  await fetchModel(p.uid, dir);
  const doc = await io.read(path.join(dir, 'scene.gltf'));
  const { joints, meshNode } = prepSkeleton(doc);
  const names = joints.map((j) => j.getName());
  const prim: Primitive = meshNode.getMesh()!.listPrimitives()[0];
  const mat = prim.getMaterial()!;
  const texFile = (t: ReturnType<typeof mat.getBaseColorTexture>) => t && path.join(dir, t.getURI());
  const alb = await load(texFile(mat.getBaseColorTexture())!);
  const nrmSrc = mat.getNormalTexture() ? await load(texFile(mat.getNormalTexture())!) : null;

  const pos = prim.getAttribute('POSITION')!, nrm = prim.getAttribute('NORMAL')!, uv = prim.getAttribute('TEXCOORD_0')!;
  const J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!;
  const idx = prim.getIndices()!.getArray()!;
  const nv = pos.getCount();
  const Mmesh = toM(meshNode.getWorldMatrix() as number[]);
  const P = Array.from({ length: nv }, (_, i) => new THREE.Vector3().fromArray(pos.getElement(i, [])).applyMatrix4(Mmesh));
  const N = Array.from({ length: nv }, (_, i) => new THREE.Vector3().fromArray(nrm.getElement(i, [])).transformDirection(Mmesh));
  const UV = Array.from({ length: nv }, (_, i) => uv.getElement(i, []) as number[]);
  const topJ = Array.from({ length: nv }, (_, i) => { const j = J.getElement(i, []), w = W.getElement(i, []); return names[j[w.indexOf(Math.max(...w))]]; });
  const cls = Array.from({ length: nv }, (_, i) => {
    const n = topJ[i];
    return HEADB.test(n) ? 'head' : HANDB.test(n) ? 'hand' : FOOTB.test(n) ? 'foot' : LEGB.test(n) ? 'leg' : ARMB.test(n) ? 'arm' : 'torso';
  });
  const jw = (n: string) => new THREE.Vector3().setFromMatrixPosition(toM(joints[names.indexOf(n)].getWorldMatrix() as number[]));
  const H = jw('Head'), top = jw('HeadTop_End'), neck = jw('Neck');

  // Skin likeness: chromaticity and lightness against the forehead's.
  const ref = [0, 0, 0];
  let nr = 0;
  for (let i = 0; i < nv; i++) {
    const v = P[i];
    if (cls[i] !== 'head' || N[i].z < 0.75 || Math.abs(v.x - H.x) > 0.025 || v.y < H.y + 0.03 || v.y > H.y + 0.07 || v.z < H.z) continue;
    const c = avg(alb, UV[i][0], UV[i][1]);
    ref[0] += c[0]; ref[1] += c[1]; ref[2] += c[2]; nr++;
  }
  for (let k = 0; k < 3; k++) ref[k] /= Math.max(1, nr);
  const chroma = (c: number[]) => { const s = c[0] + c[1] + c[2] + 1e-3; return [c[0] / s, c[1] / s, s]; };
  const R = chroma(ref);
  const skinOf = (c: number[]) => {
    const q = chroma(c);
    const dc = Math.hypot(q[0] - R[0], q[1] - R[1]), dl = q[2] / R[2];
    return (1 - THREE.MathUtils.smoothstep(dc, 0.025, 0.06)) * THREE.MathUtils.smoothstep(dl, 0.35, 0.55) * (1 - THREE.MathUtils.smoothstep(dl, 1.5, 1.9));
  };
  const skin = new Float32Array(nv), oil = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    skin[i] = skinOf(avg(alb, UV[i][0], UV[i][1]));
    const v = P[i];
    if (cls[i] !== 'head' || v.z < H.z) continue;
    // The T-zone: a strip down the middle of the forehead and the nose, a little on the chin.
    const mid = 1 - THREE.MathUtils.smoothstep(Math.abs(v.x - H.x), 0.012, 0.03);
    const band = THREE.MathUtils.smoothstep(v.y, H.y - 0.02, H.y + 0.01) * (1 - THREE.MathUtils.smoothstep(v.y, top.y - 0.05, top.y - 0.02));
    const chin = (1 - THREE.MathUtils.smoothstep(Math.abs(v.x - H.x), 0.01, 0.025)) * (1 - THREE.MathUtils.smoothstep(Math.abs(v.y - (H.y - 0.07)), 0.0, 0.02));
    oil[i] = Math.max(mid * band, chin * 0.6) * skin[i];
  }

  // UV islands of the head, neck and hands.
  const nt = idx.length / 3;
  const parent = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < nt; t++) { const a = find(idx[t * 3]), b = find(idx[t * 3 + 1]), c = find(idx[t * 3 + 2]); parent[b] = a; parent[find(c)] = find(a); }
  const isl = new Map<number, { verts: Set<number>; tris: number[]; show: number; n: number; box: number[] }>();
  for (let t = 0; t < nt; t++) {
    const r = find(idx[t * 3]);
    if (!isl.has(r)) isl.set(r, { verts: new Set(), tris: [], show: 0, n: 0, box: [1, 1, 0, 0] });
    const I = isl.get(r)!;
    I.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const i = idx[t * 3 + k];
      if (I.verts.has(i)) continue;
      I.verts.add(i);
      I.n++;
      if (cls[i] === 'head' || cls[i] === 'hand') I.show++;
      I.box[0] = Math.min(I.box[0], UV[i][0]); I.box[1] = Math.min(I.box[1], UV[i][1]);
      I.box[2] = Math.max(I.box[2], UV[i][0]); I.box[3] = Math.max(I.box[3], UV[i][1]);
    }
  }
  const keep = [...isl.values()].filter((I) => I.show / I.n > 0.5);
  // Shelf-pack their boxes, as large as they fit.
  const pad = 3;
  const place = (f: number) => {
    const rects = keep.map((I, k) => ({ k, w: Math.ceil((I.box[2] - I.box[0]) * alb.w * f) + 2 * pad, h: Math.ceil((I.box[3] - I.box[1]) * alb.h * f) + 2 * pad, x: 0, y: 0 }));
    rects.sort((a, b) => b.h - a.h);
    let x = 0, y = 0, sh = 0;
    for (const r of rects) {
      if (r.w > AT) return null;
      if (x + r.w > AT) { x = 0; y += sh; sh = 0; }
      r.x = x; r.y = y; x += r.w; sh = Math.max(sh, r.h);
    }
    return y + sh <= AT ? rects : null;
  };
  let lo = 0.01, hi = 1;
  for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (place(m)) lo = m; else hi = m; }
  const f = lo, rects = place(f)!;
  // New UVs; everything else (clothes, hidden or re-dressed at runtime) points at a skin-coloured texel.
  const nuv = new Float32Array(nv * 2).fill(0.5 / AT);
  for (const r of rects) {
    const I = keep[r.k];
    for (const i of I.verts) {
      nuv[i * 2] = (r.x + pad + (UV[i][0] - I.box[0]) * alb.w * f) / AT;
      nuv[i * 2 + 1] = (r.y + pad + (UV[i][1] - I.box[1]) * alb.h * f) / AT;
    }
  }
  // Rasterize: albedo and normal resampled from the 8K scan, oil interpolated.
  const eyePx = new Uint8Array(AT * AT), A = new Uint8Array(AT * AT * 3), Nm = new Uint8Array(AT * AT * 3), mask = new Uint8Array(AT * AT), O = new Float32Array(AT * AT);
  const t3 = [0, 0, 0];
  for (const r of rects) for (const t of keep[r.k].tris) {
    const eye = /Eye$/.test(topJ[idx[t * 3]]) ? 1 : 0;
    const ii = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    raster(ii.map((i) => [nuv[i * 2] * AT, nuv[i * 2 + 1] * AT]), (x, y, w) => {
      const u = w[0] * UV[ii[0]][0] + w[1] * UV[ii[1]][0] + w[2] * UV[ii[2]][0];
      const v = w[0] * UV[ii[0]][1] + w[1] * UV[ii[1]][1] + w[2] * UV[ii[2]][1];
      // Box-filter the 8K source over this texel's footprint.
      const s = Math.max(1, Math.round(1 / f / 2)), acc = [0, 0, 0], accN = [0, 0, 0];
      let n = 0;
      for (let dy = -s; dy <= s; dy += Math.max(1, s >> 1)) for (let dx = -s; dx <= s; dx += Math.max(1, s >> 1)) {
        px(alb, u + dx / alb.w, v + dy / alb.h, t3); acc[0] += t3[0]; acc[1] += t3[1]; acc[2] += t3[2];
        if (nrmSrc) { px(nrmSrc, u + dx / nrmSrc.w, v + dy / nrmSrc.h, t3); accN[0] += t3[0]; accN[1] += t3[1]; accN[2] += t3[2]; }
        n++;
      }
      const o = (y * AT + x) * 3;
      for (let k = 0; k < 3; k++) { A[o + k] = acc[k] / n; Nm[o + k] = nrmSrc ? accN[k] / n : 128; }
      O[y * AT + x] = w[0] * oil[ii[0]] + w[1] * oil[ii[1]] + w[2] * oil[ii[2]];
      mask[y * AT + x] = 1;
      eyePx[y * AT + x] = eye;
    });
  }
  // Fill the background with the reference skin tone before dilating.
  for (let i = 0; i < AT * AT; i++) if (!mask[i]) for (let k = 0; k < 3; k++) A[i * 3 + k] = ref[k];
  dilate(A, 3, mask, 8);
  // Luminance detail: pores and creases.
  const L = new Float32Array(AT * AT);
  for (let i = 0; i < AT * AT; i++) L[i] = (0.3 * A[i * 3] + 0.59 * A[i * 3 + 1] + 0.11 * A[i * 3 + 2]) / 255;
  const Lb = blur(L, 4), Lb2 = blur(L, 1);
  if (!nrmSrc) {
    // A normal map from the albedo: dark pores and creases read as dents.
    const h = new Float32Array(AT * AT);
    for (let i = 0; i < AT * AT; i++) h[i] = Lb2[i] - Lb[i];
    for (let y = 0; y < AT; y++) for (let x = 0; x < AT; x++) {
      const i = y * AT + x;
      if (!mask[i]) { Nm[i * 3] = 128; Nm[i * 3 + 1] = 128; Nm[i * 3 + 2] = 255; continue; }
      const hx = h[y * AT + Math.min(AT - 1, x + 1)] - h[y * AT + Math.max(0, x - 1)];
      const hy = h[Math.min(AT - 1, y + 1) * AT + x] - h[Math.max(0, y - 1) * AT + x];
      const k = 6, v = new THREE.Vector3(-hx * k, hy * k, 1).normalize();
      Nm[i * 3] = (v.x * 0.5 + 0.5) * 255; Nm[i * 3 + 1] = (v.y * 0.5 + 0.5) * 255; Nm[i * 3 + 2] = (v.z * 0.5 + 0.5) * 255;
    }
  } else for (let i = 0; i < AT * AT; i++) if (!mask[i]) { Nm[i * 3] = 128; Nm[i * 3 + 1] = 128; Nm[i * 3 + 2] = 255; }
  dilate(Nm, 3, mask, 8);
  // Roughness (G): skin 0.6; lips smoother, hair rougher; cavities rougher; T-zone oilier.
  const MR = new Uint8Array(AT * AT * 3);
  for (let i = 0; i < AT * AT; i++) {
    const c = [A[i * 3], A[i * 3 + 1], A[i * 3 + 2]];
    const sk = skinOf(c), q = chroma(c);
    const red = THREE.MathUtils.smoothstep(q[0] - R[0], 0.02, 0.06);
    let r = THREE.MathUtils.lerp(0.72, 0.6, sk) - 0.1 * red * sk - 0.16 * O[i] + (Lb[i] - L[i]) * 0.8;
    r = eyePx[i] ? 0.12 : THREE.MathUtils.clamp(r, 0.35, 0.9);
    MR[i * 3] = 255; MR[i * 3 + 1] = r * 255; MR[i * 3 + 2] = 0;
  }

  // Write back: UVs, attributes, one material with the three maps.
  uv.setArray(nuv);
  const attr = (name: string, a: Float32Array) => prim.setAttribute(name, doc.createAccessor().setType('SCALAR').setArray(a).setBuffer(doc.getRoot().listBuffers()[0]));
  attr('_SKIN', skin);
  attr('_OIL', oil);
  const webp = async (d: Uint8Array, q: number) => sharp(Buffer.from(d), { raw: { width: AT, height: AT, channels: 3 } }).webp({ quality: q }).toBuffer();
  const tex = async (d: Uint8Array, q: number, name: string) => doc.createTexture(name).setImage(await webp(d, q)).setMimeType('image/webp');
  mat.setBaseColorTexture(await tex(A, 90, 'albedo'));
  mat.setNormalTexture(await tex(Nm, 92, 'normal'));
  mat.setMetallicRoughnessTexture(await tex(MR, 90, 'rough'));
  mat.setRoughnessFactor(1).setMetallicFactor(0).setDoubleSided(false).setName('skin');
  await doc.transform(prune({ keepAttributes: true, keepLeaves: true }));
  await write(doc, io, p.id);
  console.log(`${p.id}: ${nt} tris, ${keep.length} skin islands at ${(f * alb.w).toFixed(0)}px per UV unit (from ${alb.w}), forehead ref ${ref.map((x) => x.toFixed(0))}`);
}

async function write(doc: Document, io: NodeIO, id: string) {
  const root = doc.getRoot();
  const buffers = root.listBuffers();
  for (let i = 1; i < buffers.length; i++) {
    for (const a of root.listAccessors()) if (a.getBuffer() === buffers[i]) a.setBuffer(buffers[0]);
    buffers[i].dispose();
  }
  root.listTextures().forEach((t, i) => t.setURI(`${id}_${i}.webp`));
  const { json, resources } = await io.writeJSON(doc);
  for (const b of json.buffers ?? []) b.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[b.uri!]).toString('base64');
  let tex = 0;
  for (const im of json.images ?? []) { fs.writeFileSync(path.join(OUT, im.uri!), resources[im.uri!]); tex += resources[im.uri!].byteLength; }
  const s = JSON.stringify(json);
  fs.writeFileSync(path.join(OUT, `${id}.json`), s);
  console.log(`${id}: json ${(s.length / 1e6).toFixed(2)} MB, textures ${(tex / 1e6).toFixed(2)} MB`);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const only = process.argv.slice(2);
for (const p of PEOPLE) if (!only.length || only.includes(p.id)) await pack(p, io);
