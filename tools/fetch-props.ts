// Fetch curated CC0 photo-scanned models from Poly Haven and pack each into a
// web-friendly glTF: one JSON file with geometry embedded (base64) and its
// textures as separate .webp files. (The game is also published somewhere
// that serves .json and .webp but not .glb/.bin.)
//
//   npx tsx tools/fetch-props.ts            # fetch + pack everything
//   npx tsx tools/fetch-props.ts rock_07    # just one
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// id → resolution to fetch, max texture size, target triangle budget.
// Chosen for an 8th-century Lombard town: nothing painted, glazed, machined.
export const PROPS: Record<string, { res: '1k' | '2k'; tex: number; tris: number; free?: boolean }> = {
  // Interiors and streets
  wine_barrel_01: { res: '1k', tex: 1024, tris: 6000 },
  wooden_barrels_01: { res: '1k', tex: 1024, tris: 12000 },
  wicker_basket_02: { res: '1k', tex: 1024, tris: 8000 },
  wooden_bowl_01: { res: '1k', tex: 512, tris: 3000 },
  carved_wooden_plate: { res: '1k', tex: 512, tris: 2000 },
  ceramic_pot: { res: '1k', tex: 1024, tris: 6000 },
  planter_pot_clay: { res: '1k', tex: 1024, tris: 4000 },
  wooden_bucket_01: { res: '1k', tex: 1024, tris: 6000 },
  wooden_bucket_02: { res: '1k', tex: 1024, tris: 6000 },
  folding_wooden_stool: { res: '1k', tex: 1024, tris: 4000 },
  WoodenTable_01: { res: '1k', tex: 1024, tris: 4000 },
  treasure_chest: { res: '2k', tex: 1024, tris: 10000 },
  stone_fire_pit: { res: '2k', tex: 1024, tris: 12000 },
  wooden_axe: { res: '1k', tex: 512, tris: 2000 },
  wooden_axe_02: { res: '1k', tex: 512, tris: 2000 },
  cross_pein_hammer: { res: '1k', tex: 512, tris: 2000 },
  wooden_cutting_board: { res: '1k', tex: 512, tris: 1500 },
  marble_bust_01: { res: '2k', tex: 1024, tris: 20000 },
  street_rat: { res: '1k', tex: 1024, tris: 6000 },
  // Ground, ruins, forest
  rock_07: { res: '1k', tex: 1024, tris: 5000 },
  rock_09: { res: '1k', tex: 1024, tris: 5000 },
  stone_01: { res: '1k', tex: 1024, tris: 8000 },
  rock_moss_set_01: { res: '1k', tex: 1024, tris: 8000 },
  rock_moss_set_02: { res: '1k', tex: 1024, tris: 8000 },
  tree_stump_01: { res: '1k', tex: 1024, tris: 8000 },
  tree_stump_02: { res: '1k', tex: 1024, tris: 8000 },
  dead_tree_trunk: { res: '1k', tex: 1024, tris: 8000 },
  dead_tree_trunk_02: { res: '1k', tex: 1024, tris: 8000 },
  root_cluster_01: { res: '1k', tex: 1024, tris: 8000 },
  root_cluster_02: { res: '1k', tex: 1024, tris: 8000 },
  pine_roots: { res: '1k', tex: 1024, tris: 8000 },
  bark_debris_01: { res: '1k', tex: 512, tris: 3000 },
  dry_branches_medium_01: { res: '1k', tex: 512, tris: 4000 },
  nettle_plant: { res: '1k', tex: 1024, tris: 12000 },
  fern_02: { res: '1k', tex: 1024, tris: 12000 },
  grass_medium_02: { res: '1k', tex: 1024, tris: 16000 },
  shrub_02: { res: '1k', tex: 1024, tris: 12000 },
  weed_plant_02: { res: '1k', tex: 1024, tris: 8000 },
};

const OUT = 'public/models/props';
const CACHE = 'node_modules/.cache/props';

// curl, not fetch: it honours the environment's HTTPS proxy.
async function get(url: string, file: string) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', file, url]);
}
const getJSON = (url: string) => JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '3', url]).toString());

function triCount(doc: Document) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION')!.getCount()) / 3;
  }
  return n;
}

async function pack(id: string) {
  const cfg = PROPS[id];
  const info = getJSON(`https://api.polyhaven.com/files/${id}`);
  const g = info.gltf[cfg.res].gltf;
  const dir = path.join(CACHE, id, cfg.res);
  await get(g.url, path.join(dir, `${id}.gltf`));
  for (const [rel, f] of Object.entries(g.include as Record<string, { url: string }>)) await get(f.url, path.join(dir, rel));

  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(dir, `${id}.gltf`));
  const before = triCount(doc);
  await doc.transform(dedup(), prune(), weld());
  if (triCount(doc) > cfg.tris) {
    const ratio = Math.max(0.02, cfg.tris / triCount(doc));
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.free ? 0.02 : 0.004, lockBorder: !cfg.free }));
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 82 }),
    prune(),
  );
  const after = triCount(doc);

  // Merge buffers, write JSON with embedded geometry + external webp images.
  const root = doc.getRoot();
  const buffers = root.listBuffers();
  for (let i = 1; i < buffers.length; i++) {
    for (const a of root.listAccessors()) if (a.getBuffer() === buffers[i]) a.setBuffer(buffers[0]);
    buffers[i].dispose();
  }
  root.listTextures().forEach((t, i) => t.setURI(`${id}_${i}.webp`));
  const { json, resources } = await io.writeJSON(doc);
  fs.mkdirSync(OUT, { recursive: true });
  for (const b of json.buffers ?? []) {
    const data = resources[b.uri!];
    b.uri = 'data:application/octet-stream;base64,' + Buffer.from(data).toString('base64');
  }
  let texBytes = 0;
  for (const im of json.images ?? []) {
    const data = resources[im.uri!];
    fs.writeFileSync(path.join(OUT, im.uri!), data);
    texBytes += data.byteLength;
  }
  const out = JSON.stringify(json);
  fs.writeFileSync(path.join(OUT, `${id}.json`), out);
  console.log(`${id}: ${before} → ${after} tris, json ${(out.length / 1e3).toFixed(0)} kB, textures ${(texBytes / 1e3).toFixed(0)} kB`);
}

const only = process.argv.slice(2);
for (const id of only.length ? only : Object.keys(PROPS)) {
  try { await pack(id); } catch (e) { console.log(`${id}: FAILED ${(e as Error).message}`); }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `# Props

Photo-scanned models from [Poly Haven](https://polyhaven.com), CC0 (public domain).
Fetched and packed by \`tools/fetch-props.ts\`.

${Object.keys(PROPS).map((id) => `- [${id}](https://polyhaven.com/a/${id})`).join('\n')}
`);
void flatten; void join;
