// Minimal reader for the repo's JSON glTF models (embedded base64 buffers):
// world-space triangles per primitive with the material's draw side.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';

export interface Prim { mesh: string; pos: Float32Array; doubleSided: boolean; alpha: string; material: string }
const CT: Record<number, { new (b: ArrayBuffer, o: number, n: number): ArrayLike<number> }> = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const NC: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGltf(path: string): Prim[] {
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const bufs: ArrayBuffer[] = (d.buffers ?? []).map((b: { uri: string }) => {
    const u: Buffer = b.uri.startsWith('data:') ? Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64') : readFileSync(join(dirname(path), b.uri));
    return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  });
  const acc = (i: number) => {
    const a = d.accessors[i], bv = d.bufferViews[a.bufferView], nc = NC[a.type];
    const C = CT[a.componentType], size = (C as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = bv.byteStride ?? 0;
    const out = new Float64Array(a.count * nc);
    if (!stride || stride === nc * size) {
      const src = new C(bufs[bv.buffer], off, a.count * nc);
      for (let k = 0; k < out.length; k++) out[k] = src[k];
    } else {
      for (let v = 0; v < a.count; v++) { const src = new C(bufs[bv.buffer], off + v * stride, nc); for (let c = 0; c < nc; c++) out[v * nc + c] = src[c]; }
    }
    if (a.normalized) { const k = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType as 5120] ?? 1; for (let i2 = 0; i2 < out.length; i2++) out[i2] /= k; }
    return out;
  };
  const prims: Prim[] = [];
  const visit = (ni: number, parent: THREE.Matrix4) => {
    const n = d.nodes[ni];
    const m = new THREE.Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else m.compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
    const w = parent.clone().multiply(m);
    if (n.mesh !== undefined) for (const pr of d.meshes[n.mesh].primitives) {
      if ((pr.mode ?? 4) !== 4) continue;
      const P = acc(pr.attributes.POSITION);
      const I = pr.indices !== undefined ? acc(pr.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
      const pos = new Float32Array(I.length * 3), v = new THREE.Vector3();
      for (let k = 0; k < I.length; k++) { v.set(P[I[k] * 3], P[I[k] * 3 + 1], P[I[k] * 3 + 2]).applyMatrix4(w); pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z; }
      const mat = pr.material !== undefined ? d.materials[pr.material] : {};
      prims.push({ mesh: d.meshes[n.mesh].name ?? String(n.mesh), pos, doubleSided: !!mat.doubleSided, alpha: mat.alphaMode ?? 'OPAQUE', material: mat.name ?? '' });
    }
    for (const c of n.children ?? []) visit(c, w);
  };
  const sc = d.scenes?.[d.scene ?? 0];
  for (const r of sc?.nodes ?? []) visit(r, new THREE.Matrix4());
  return prims;
}
