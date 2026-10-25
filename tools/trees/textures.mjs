// node tools/trees/textures.mjs model.glb outDir  -> dumps every texture (by material/slot) as png, for review
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'fs';
const [file, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
const seen = new Set();
for (const m of doc.getRoot().listMaterials()) {
  for (const [slot, t] of [['base', m.getBaseColorTexture()], ['nrm', m.getNormalTexture()], ['mr', m.getMetallicRoughnessTexture()], ['ao', m.getOcclusionTexture()]]) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const ext = t.getMimeType() === 'image/jpeg' ? 'jpg' : t.getMimeType() === 'image/webp' ? 'webp' : 'png';
    const name = `${m.getName().replace(/[^\w.-]+/g, '_')}_${slot}.${ext}`;
    fs.writeFileSync(`${out}/${name}`, t.getImage());
    console.log(name, t.getSize()?.join('x'));
  }
}
