// Lighter copies of the scanned props the townsfolk carry (a basket, a
// bucket, a jar on the head): the town's own props are left as they are, and
// a person carrying one is seen from a few metres at most, among eighteen.
//
//   npx tsx tools/npc-props.ts
//
// Each is welded and simplified (meshoptimizer, its silhouette kept within
// a few millimetres to a centimetre) and written beside the bodies as
// public/models/npc/<id>_lo.json, sharing the town's maps (../props/*.webp).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';

const SRC = 'public/models/props', OUT = 'public/models/npc';
// Target share of the triangles kept, and the error allowed (relative to the prop's size).
const PROPS: { id: string; ratio: number; error: number }[] = [
  { id: 'wicker_basket_02', ratio: 0.2, error: 0.012 },
  { id: 'wooden_bucket_01', ratio: 0.22, error: 0.01 },
  { id: 'planter_pot_clay', ratio: 0.3, error: 0.008 },
];

const tris = (doc: import('@gltf-transform/core').Document) => {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
  return t;
};

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const P of PROPS) {
  const doc = await io.read(`${SRC}/${P.id}.json`);
  const t0 = tris(doc);
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: P.ratio, error: P.error }));
  const { json, resources } = await io.writeJSON(doc);
  for (const b of json.buffers ?? []) b.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[b.uri!]).toString('base64');
  // The maps stay where they are: the town's.
  const orig = JSON.parse(fs.readFileSync(`${SRC}/${P.id}.json`, 'utf8')) as { images?: { name?: string; uri?: string }[] };
  for (const im of json.images ?? []) {
    const o = orig.images?.find((x) => x.name === im.name);
    im.uri = '../props/' + (o?.uri ?? im.uri);
  }
  const s = JSON.stringify(json);
  fs.writeFileSync(`${OUT}/${P.id}_lo.json`, s);
  console.log(`${P.id}: ${t0} -> ${tris(doc)} tris, ${(s.length / 1e3).toFixed(0)} kB`);
}
