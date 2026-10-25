// node tools/trees/uvrange.mjs model.glb -> uv bounds per primitive (does the texture tile?)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2]);
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const uv = p.getAttribute('TEXCOORD_0');
  if (!uv) { console.log(m.getName(), 'no uv'); continue; }
  const a = uv.getArray(), lo = [1e9, 1e9], hi = [-1e9, -1e9];
  for (let i = 0; i < a.length; i += 2) for (let k = 0; k < 2; k++) { lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); }
  console.log(m.getName().slice(0, 50), p.getMaterial()?.getName(), 'u', lo[0].toFixed(2), hi[0].toFixed(2), 'v', lo[1].toFixed(2), hi[1].toFixed(2), 'attrs', p.listSemantics().join(','));
}
