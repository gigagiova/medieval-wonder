// Fetch and pack older faces for the townsfolk: photogrammetry scans of
// real heads (CC BY 4.0, via Sketchfab), cut down to the face that shows in a
// hood, cowl or veil and fitted onto a body's head at runtime (src/npc.ts,
// faceSwap).
//
//   SKETCHFAB_TOKEN=... npx tsx tools/fetch-faces.ts
//
// (The token is the user's own Sketchfab API token, read from the environment
// only; downloads are cached in tools/.cache/faces.)
//
// Per face:
//  - every primitive gathered in world space, scaled to a 63 mm eye span with
//    the eyes' midpoint (eyeballs' centres) at the origin, facing +Z, up +Y;
//  - the face kept (a cone round the head's axis, from above the brows to
//    under the chin) and its loose fragments dropped, then simplified;
//  - its colour baked from the scan's atlas onto a new 1024² map, unrolled
//    round the head's axis (cylindrical: the face nearly undistorted);
//  - written as one glTF JSON with embedded geometry + a .webp map.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = 'public/models/npc';
const CACHE = 'tools/.cache/faces';
const AT = 1024;

export const FACES = [
  {
    id: 'face_grandpa', uid: '35316e9640384a5589ab662a4f4998c8', title: 'Grandpa - RealityScan', author: 'teddygbg',
    // Landmarks in the scan's own frame (metres; read off front and side views).
    eyes: [0.335, 0.278, -0.417], eyeSpan: 0.06,
    // What is kept, relative to the eyes: half-angle round the head's axis, and heights.
    cone: 1.05, top: 0.075, bottom: -0.125, tris: 4500,
  },
] as const;

async function fetchModel(uid: string, dir: string) {
  if (fs.existsSync(path.join(dir, 'scene.gltf'))) return;
  const tok = process.env.SKETCHFAB_TOKEN;
  if (!tok) throw new Error(`${dir} not cached: set SKETCHFAB_TOKEN`);
  const r = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${tok}` } });
  if (!r.ok) throw new Error(`download ${uid}: HTTP ${r.status}`);
  const { gltf } = (await r.json()) as { gltf: { url: string } };
  unzip(Buffer.from(await (await fetch(gltf.url)).arrayBuffer()), dir);
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

async function pack(F: (typeof FACES)[number], io: NodeIO) {
  const dir = path.join(CACHE, F.uid);
  await fetchModel(F.uid, dir);
  const doc = await io.read(path.join(dir, 'scene.gltf'));
  const root = doc.getRoot();
  // Everything in world space, in the face's frame.
  const E = new THREE.Vector3(...F.eyes), k = 0.063 / F.eyeSpan;
  const pos: number[] = [], uv: number[] = [], ix: number[] = [];
  let texURI = '';
  const v = new THREE.Vector3();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = new THREE.Matrix4().fromArray(node.getWorldMatrix() as number[]);
    for (const pr of mesh.listPrimitives()) {
      texURI ||= pr.getMaterial()?.getBaseColorTexture()?.getURI() ?? '';
      const P = pr.getAttribute('POSITION')!, U = pr.getAttribute('TEXCOORD_0')!, I = pr.getIndices();
      const base = pos.length / 3;
      for (let i = 0; i < P.getCount(); i++) {
        v.fromArray(P.getElement(i, [])).applyMatrix4(M).sub(E).multiplyScalar(k);
        pos.push(v.x, v.y, v.z);
        const t = U.getElement(i, []);
        uv.push(t[0], t[1]);
      }
      const n = I ? I.getCount() : P.getCount();
      for (let i = 0; i < n; i++) ix.push(base + (I ? I.getScalar(i) : i));
    }
  }
  // The face: within the cone round the head's axis (8.5 cm behind the eyes), between brow-top and under-chin.
  const keepV = (i: number) => {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    return y < F.top && y > F.bottom && Math.abs(Math.atan2(x, z + 0.085)) < F.cone;
  };
  let tri: number[] = [];
  for (let t = 0; t < ix.length; t += 3) if (keepV(ix[t]) && keepV(ix[t + 1]) && keepV(ix[t + 2])) tri.push(ix[t], ix[t + 1], ix[t + 2]);
  // Loose fragments (hair, scan noise): only the biggest connected piece, welded by position.
  {
    const key = new Map<string, number>(), weld = new Int32Array(pos.length / 3);
    for (let i = 0; i < weld.length; i++) { const kk = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`; if (!key.has(kk)) key.set(kk, i); weld[i] = key.get(kk)!; }
    const par = Int32Array.from({ length: weld.length }, (_, i) => i);
    const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < tri.length; t += 3) { const a = find(weld[tri[t]]); par[find(weld[tri[t + 1]])] = a; par[find(weld[tri[t + 2]])] = a; }
    const size = new Map<number, number>();
    for (let t = 0; t < tri.length; t += 3) { const r = find(weld[tri[t]]); size.set(r, (size.get(r) ?? 0) + 1); }
    const big = [...size].sort((a, b) => b[1] - a[1])[0][0];
    tri = tri.filter((_, j) => find(weld[tri[j - (j % 3)]]) === big);
  }
  // Compact.
  const remap = new Map<number, number>(), P3: number[] = [], U3: number[] = [];
  const I3 = tri.map((i) => { let j = remap.get(i); if (j === undefined) { j = P3.length / 3; remap.set(i, j); P3.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); U3.push(uv[i * 2], uv[i * 2 + 1]); } return j; });
  // New map: unrolled round the head's axis; colour baked from the scan's.
  const src = await sharp(path.join(dir, texURI)).resize(4096, 4096).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const SW = src.info.width, SH = src.info.height, S = src.data;
  const NU: number[] = [];
  const amax = F.cone, ylo = F.bottom, yhi = F.top;
  for (let i = 0; i < P3.length / 3; i++) {
    const a = Math.atan2(P3[i * 3], P3[i * 3 + 2] + 0.085);
    NU.push(0.5 + (a / amax) * 0.5 * 0.98, 0.01 + ((yhi - P3[i * 3 + 1]) / (yhi - ylo)) * 0.98);
  }
  const img = new Uint8Array(AT * AT * 3), fill = new Uint8Array(AT * AT);
  const sample = (u: number, w: number, o: number) => {
    const x = Math.min(SW - 1, Math.max(0, u * SW)), y = Math.min(SH - 1, Math.max(0, w * SH));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(SW - 1, x0 + 1), y1 = Math.min(SH - 1, y0 + 1), fx = x - x0, fy = y - y0;
    const g = (xx: number, yy: number) => S[(yy * SW + xx) * 3 + o];
    return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
  };
  for (let t = 0; t < I3.length; t += 3) {
    const [a, b, c] = [I3[t], I3[t + 1], I3[t + 2]];
    const ax = NU[a * 2] * AT, ay = NU[a * 2 + 1] * AT, bx = NU[b * 2] * AT, by = NU[b * 2 + 1] * AT, cx = NU[c * 2] * AT, cy = NU[c * 2 + 1] * AT;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), x1 = Math.min(AT - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), y1 = Math.min(AT - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
      const u = U3[a * 2] * l1 + U3[b * 2] * l2 + U3[c * 2] * l3, w = U3[a * 2 + 1] * l1 + U3[b * 2 + 1] * l2 + U3[c * 2 + 1] * l3;
      const o = (y * AT + x) * 3;
      for (let ch = 0; ch < 3; ch++) img[o + ch] = sample(u, w, ch);
      fill[y * AT + x] = 1;
    }
  }
  // Bleed the edges outwards, so mip-mapping never pulls in black.
  for (let it = 0; it < 8; it++) {
    const f2 = fill.slice();
    for (let y = 0; y < AT; y++) for (let x = 0; x < AT; x++) {
      if (fill[y * AT + x]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= AT || yy >= AT || !fill[yy * AT + xx]) continue;
        for (let ch = 0; ch < 3; ch++) img[(y * AT + x) * 3 + ch] = img[(yy * AT + xx) * 3 + ch];
        f2[y * AT + x] = 1; break;
      }
    }
    fill.set(f2);
  }
  // Now the old map's seams are gone: weld by position and simplify (keeping the cut edge where it is).
  let PF: number[] = [], NF: number[] = [], IF: number[] = [];
  {
    const key = new Map<string, number>(), wid: number[] = [];
    for (let i = 0; i < P3.length / 3; i++) {
      const kk = `${Math.round(P3[i * 3] * 2e4)},${Math.round(P3[i * 3 + 1] * 2e4)},${Math.round(P3[i * 3 + 2] * 2e4)}`;
      let j = key.get(kk);
      if (j === undefined) { j = PF.length / 3; key.set(kk, j); PF.push(P3[i * 3], P3[i * 3 + 1], P3[i * 3 + 2]); NF.push(NU[i * 2], NU[i * 2 + 1]); }
      wid.push(j);
    }
    const IW = I3.map((i) => wid[i]).filter((_, j, a) => { const t = j - (j % 3); return a[t] !== a[t + 1] && a[t + 1] !== a[t + 2] && a[t] !== a[t + 2]; });
    await MeshoptSimplifier.ready;
    const [simp] = MeshoptSimplifier.simplify(new Uint32Array(IW), new Float32Array(PF), 3, F.tris * 3, 0.01, ['LockBorder']);
    const used = new Map<number, number>(), P4: number[] = [], N4: number[] = [];
    IF = Array.from(simp, (i) => { let j = used.get(i); if (j === undefined) { j = P4.length / 3; used.set(i, j); P4.push(PF[i * 3], PF[i * 3 + 1], PF[i * 3 + 2]); N4.push(NF[i * 2], NF[i * 2 + 1]); } return j; });
    PF = P4; NF = N4;
  }
  const webp = await sharp(Buffer.from(img), { raw: { width: AT, height: AT, channels: 3 } }).webp({ quality: 86 }).toBuffer();
  // The glTF.
  const out = new Document();
  const buf = out.createBuffer();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(PF, 3));
  geo.setIndex(IF);
  geo.computeVertexNormals();
  const tex = out.createTexture('face').setMimeType('image/webp').setImage(new Uint8Array(webp)).setURI(`${F.id}.webp`);
  const mat = out.createMaterial('face').setBaseColorTexture(tex).setRoughnessFactor(0.6).setMetallicFactor(0);
  const prim = out.createPrimitive()
    .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(new Float32Array(PF)).setBuffer(buf))
    .setAttribute('NORMAL', out.createAccessor().setType('VEC3').setArray(new Float32Array(geo.attributes.normal.array)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', out.createAccessor().setType('VEC2').setArray(new Float32Array(NF)).setBuffer(buf))
    .setIndices(out.createAccessor().setType('SCALAR').setArray(new Uint16Array(IF)).setBuffer(buf))
    .setMaterial(mat);
  const node = out.createNode(F.id).setMesh(out.createMesh(F.id).addPrimitive(prim));
  node.setExtras({ source: `"${F.title}" by ${F.author}, https://sketchfab.com/3d-models/${F.uid}, CC BY 4.0` });
  out.createScene().addChild(node);
  const { json, resources } = await io.writeJSON(out);
  for (const b of json.buffers ?? []) b.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[b.uri!]).toString('base64');
  fs.writeFileSync(path.join(OUT, `${F.id}.webp`), webp);
  const s = JSON.stringify(json);
  fs.writeFileSync(path.join(OUT, `${F.id}.json`), s);
  console.log(`${F.id}: ${IF.length / 3} tris (from ${I3.length / 3}), json ${(s.length / 1e3).toFixed(0)} kB, map ${(webp.byteLength / 1e3).toFixed(0)} kB`);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const only = process.argv.slice(2);
for (const f of FACES) if (!only.length || only.includes(f.id)) await pack(f, io);
