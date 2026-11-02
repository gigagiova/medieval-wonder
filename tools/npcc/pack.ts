// Pack the track C townsfolk baked by Blender (tools/npcc/build.py) for the web:
// one skinned mesh and one texture each; the texture to .webp (1024² at most),
// JSON glTF with the geometry embedded next to its .webp (the host serves
// neither .glb nor .bin). Optional per-character colour grading (GRADE):
// pull baked-in highlights down and desaturate, so the AI-baked albedo reads
// as coarse undyed wool rather than a lit render.
//
//   npx tsx tools/npcc/pack.ts WORKDIR ID...      (reads WORKDIR/ID.glb)
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'public/models/npcc';
/** Saturation and brightness multipliers per character (1 = unchanged). */
const GRADE: Record<string, { sat: number; bri: number }> = {
  // The AI-baked habit is a saturated orange: brought down to undyed brown wool.
  c_friar: { sat: 0.55, bri: 0.8 },
};

async function pack(work: string, id: string, io: NodeIO) {
  const doc = await io.read(path.join(work, id + '.glb'));
  const root = doc.getRoot();
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices()!.getCount() / 3;
  for (const tex of root.listTextures()) {
    let img = sharp(Buffer.from(tex.getImage()!));
    const info = await img.metadata();
    const s = Math.min(1024, info.width ?? 1024);
    img = img.resize(s, s).removeAlpha();
    const g = GRADE[id];
    if (g) img = img.modulate({ saturation: g.sat, brightness: g.bri });
    tex.setImage(await img.webp({ quality: 88 }).toBuffer()).setMimeType('image/webp');
  }
  for (const mat of root.listMaterials()) {
    mat.setRoughnessFactor(0.95).setMetallicFactor(0).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    for (const ext of mat.listExtensions()) ext.dispose();
  }
  await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: true }));
  console.log(`${id}: ${tris} tris`);
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
