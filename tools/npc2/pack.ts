// Pack the v2 townsfolk bodies baked by Blender (tools/npc2/build.py) for
// the web: decimate each mesh to its share of the triangle budget (meshopt,
// UV seams and borders kept; collapsed vertices keep their own attributes,
// so the per-outfit `_hide` bits stay exact), textures to .webp (faces
// 1024², everything else 512² or less), and write JSON glTF with embedded
// geometry next to its .webp files (the host serves neither .glb nor .bin).
//
//   npx tsx tools/npc2/pack.ts WORKDIR BODY...      (reads WORKDIR/BODY.glb)
import { NodeIO, Document, PropertyType, Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, simplifyPrimitive, weld, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'public/models/npc2';

/** Triangles kept per mesh (by node name prefix). */
const BUDGET: [RegExp, number][] = [
  [/body$/, 9000],
  [/^G_robe$/, 5500], [/^G_longrobe$/, 5500], [/^G_tunic$/, 2600], [/^G_shirt$/, 2600], [/^G_belt$/, 500], [/^G_rope$/, 500], [/^G_cowl$/, 3000], [/^G_hood$/, 3000], [/^G_cloak/, 1800], [/^G_shawl/, 1400],
  [/^G_hose$/, 900], [/^G_boots$/, 1300], [/^G_shoes$/, 900],
  [/^G_gown$/, 3600], [/^G_veil$/, 1600],
  [/eye/i, 200], [/./, 1500],
];
/** Texture edge per material (by material name). */
const TEX: [RegExp, number][] = [[/^skin/, 1024], [/^head/, 1024], [/eye/i, 128], [/./, 512]];

async function pack(work: string, id: string, io: NodeIO) {
  const doc = await io.read(path.join(work, id + '.glb'));
  const root = doc.getRoot();
  await MeshoptSimplifier.ready;
  await doc.transform(weld());
  let total = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName();
    const want = BUDGET.find(([r]) => r.test(name))![1];
    const prims = mesh.listPrimitives();
    const have = prims.reduce((s, p) => s + p.getIndices()!.getCount() / 3, 0);
    const ratio = Math.min(1, want / have);
    let got = 0;
    for (const p of prims) {
      if (ratio < 1) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: true });
      got += p.getIndices()!.getCount() / 3;
    }
    total += got;
    console.log(`  ${name}: ${have} -> ${got} tris`);
  }
  // Textures: .webp at their budget. A garment's own colour map is kept
  // (leather, rope), turned into a grey detail map (mean 0.5: the cloth's
  // seams, wear and shading; the game multiplies the dye by twice it), or
  // dropped (the scanned weave does the rest), per tools/npc2/specs.py.
  const meta = JSON.parse(String(root.listScenes()[0].getExtras().npc2 ?? '{}'));
  const done = new Map<Texture, string>();
  for (const mat of root.listMaterials()) {
    const edge = TEX.find(([r]) => r.test(mat.getName()))![1];
    const g = /^G_/.test(mat.getName()) ? meta.garments?.[mat.getName().slice(2)] : null;
    if (g && !g.map && mat.getBaseColorTexture()) mat.setBaseColorTexture(null);
    // A map shared by garments that use it differently is copied for each.
    const mode = g?.map ?? 'color';
    const bc = mat.getBaseColorTexture();
    if (bc) {
      if (done.has(bc) && done.get(bc) !== mode) mat.setBaseColorTexture(bc.clone());
      else if (done.has(bc)) mat.setBaseColorTexture(bc);
    }
    for (const [tex, isN] of [[mat.getBaseColorTexture(), false], [mat.getNormalTexture(), true]] as const) {
      if (!tex || done.has(tex)) continue;
      done.set(tex, isN ? 'normal' : mode);
      let img = sharp(Buffer.from(tex.getImage()!));
      const info = await img.metadata();
      const s = Math.min(edge, info.width ?? edge);
      img = img.resize(s, s);
      if (!isN && g?.map === 'detail') {
        const { data, info: ri } = await img.greyscale().raw().toBuffer({ resolveWithObject: true });
        // Mean over the cloth itself (UV islands; the background is black).
        let sum = 0, n = 0;
        for (let i = 0; i < data.length; i += ri.channels) if (data[i] > 8) { sum += data[i]; n++; }
        const k = 128 / Math.max(1, sum / Math.max(1, n));
        const out = Buffer.alloc(ri.width * ri.height);
        for (let i = 0, j = 0; i < data.length; i += ri.channels, j++) out[j] = Math.min(255, Math.round(data[i] * k));
        img = sharp(out, { raw: { width: ri.width, height: ri.height, channels: 1 } });
      }
      const buf = await img.webp({ quality: isN ? 92 : 88, alphaQuality: 90 }).toBuffer();
      tex.setImage(buf).setMimeType('image/webp');
    }
  }
  await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), prune({ keepAttributes: true, keepLeaves: true }));
  console.log(`${id}: ${total} tris in all meshes`);
  await write(doc, io, id);
}

async function write(doc: Document, io: NodeIO, id: string) {
  const root = doc.getRoot();
  const buffers = root.listBuffers();
  for (let i = 1; i < buffers.length; i++) {
    for (const a of root.listAccessors()) if (a.getBuffer() === buffers[i]) a.setBuffer(buffers[0]);
    buffers[i].dispose();
  }
  root.listTextures().forEach((t, i) => t.setURI(`${id}_${i}.webp`));
  // (Old textures of this body go first: their count may have changed.)
  for (const f of fs.readdirSync(OUT)) if (new RegExp(`^${id}_\\d+\\.webp$`).test(f)) fs.unlinkSync(path.join(OUT, f));
  const { json, resources } = await io.writeJSON(doc);
  for (const b of json.buffers ?? []) b.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[b.uri!]).toString('base64');
  let tex = 0;
  for (const im of json.images ?? []) { fs.writeFileSync(path.join(OUT, im.uri!), resources[im.uri!]); tex += resources[im.uri!].byteLength; }
  const s = JSON.stringify(json);
  fs.writeFileSync(path.join(OUT, `${id}.json`), s);
  console.log(`${id}: json ${(s.length / 1e6).toFixed(2)} MB, textures ${(tex / 1e6).toFixed(2)} MB`);
}

const [work, ...ids] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const id of ids) await pack(work, id, io);
