// Simplify the packed Track A parts in place (meshoptimizer, open edges locked so
// the seams between parts stay closed). Run after tools/npca/build.py.
//   node tools/npca/simplify.mjs public/models/npca
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

const dir = process.argv[2];
// Share of each part's triangles to keep (the rest: 1).
const KEEP = {
  arms_skin: 0.35, jarms_skin: 0.45, head: 0.6, eyes: 0.5, brows: 0.5, hair: 0.55, beard: 0.6, buzz: 0.6, buns: 0.45,
  boots: 0.45, tunic: 0.65, arms: 0.7, jarms: 0.6, jerkin: 0.6, hood: 0.6, bodice: 0.7, belt1: 0.6,
};
const CT = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
await MeshoptSimplifier.ready;
for (const sex of ['man', 'woman']) {
  const path = `${dir}/${sex}.json`;
  const j = JSON.parse(fs.readFileSync(path, 'utf8'));
  const buf = Buffer.from(j.buffers[0].uri.split(',')[1], 'base64');
  const read = (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView];
    const T = CT[a.componentType];
    return new T(buf.buffer.slice(buf.byteOffset + v.byteOffset, buf.byteOffset + v.byteOffset + a.count * NC[a.type] * T.BYTES_PER_ELEMENT));
  };
  const extra = [];
  let off = buf.length;
  const before = {}, after = {};
  for (const m of j.meshes) {
    const part = m.name.replace(/^P_/, '');
    const k = KEEP[part];
    const p = m.primitives[0];
    const idx = read(p.indices);
    before[part] = idx.length / 3;
    if (!k) { after[part] = idx.length / 3; continue; }
    const pos = read(p.attributes.POSITION), nrm = read(p.attributes.NORMAL), uv = read(p.attributes.TEXCOORD_0);
    const nv = pos.length / 3, attr = new Float32Array(nv * 5);
    for (let v = 0; v < nv; v++) { attr.set(nrm.subarray(v * 3, v * 3 + 3), v * 5); attr.set(uv.subarray(v * 2, v * 2 + 2), v * 5 + 3); }
    const target = Math.floor((idx.length * k) / 3) * 3;
    const [out] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(idx), pos, 3, attr, 5, [0.3, 0.3, 0.3, 2, 2], null, target, 0.02, ['LockBorder']);
    const data = Buffer.from(new Uint16Array(out).buffer);
    while ((off + extra.reduce((s, b) => s + b.length, 0)) % 4) extra.push(Buffer.alloc(1));
    const at = off + extra.reduce((s, b) => s + b.length, 0);
    extra.push(data);
    j.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: data.length, target: 34963 });
    j.accessors.push({ bufferView: j.bufferViews.length - 1, componentType: 5123, count: out.length, type: 'SCALAR' });
    p.indices = j.accessors.length - 1;
    after[part] = out.length / 3;
  }
  const all = Buffer.concat([buf, ...extra]);
  j.buffers[0] = { byteLength: all.length, uri: 'data:application/octet-stream;base64,' + all.toString('base64') };
  fs.writeFileSync(path, JSON.stringify(j));
  console.log(sex, JSON.stringify(after));
}
