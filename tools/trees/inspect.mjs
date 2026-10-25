// node inspect.mjs file.glb -> scene tree summary: nodes, meshes, tris per mesh, materials, textures
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
let total = 0;
function walk(node, depth) {
  const m = node.getMesh();
  let s = '  '.repeat(depth) + node.getName();
  if (m) {
    let t = 0;
    const mats = [];
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const n = idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
      t += n;
      mats.push((p.getMaterial()?.getName() || '?') + ':' + Math.round(n));
    }
    total += t;
    s += `  [mesh ${m.getName()} tris=${Math.round(t)} ${mats.join(',')}]`;
  }
  const tr = node.getTranslation(), sc = node.getScale();
  if (depth < 4 || m) console.log(s, 't=' + tr.map((v) => v.toFixed(1)).join(','), 's=' + sc.map((v) => v.toFixed(2)).join(','));
  for (const c of node.listChildren()) walk(c, depth + 1);
}
for (const n of scene.listChildren()) walk(n, 0);
console.log('TOTAL tris', Math.round(total));
for (const mat of root.listMaterials()) {
  const tex = (t) => (t ? `${t.getName() || t.getURI()} ${t.getSize()?.join('x')} ${t.getMimeType()}` : '-');
  console.log('MAT', mat.getName(), 'alpha=' + mat.getAlphaMode(), 'cutoff=' + mat.getAlphaCutoff(), 'double=' + mat.getDoubleSided(), 'base=' + tex(mat.getBaseColorTexture()), 'nrm=' + tex(mat.getNormalTexture()), 'mr=' + tex(mat.getMetallicRoughnessTexture()), 'col=' + mat.getBaseColorFactor().map((v) => v.toFixed(2)).join(','));
}
