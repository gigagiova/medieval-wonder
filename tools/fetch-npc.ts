// Fetch and pack the townsfolk's animations into web-friendly glTF
// (one JSON with embedded geometry + external .webp textures; the game is also
// published somewhere that serves .json and .webp but not .glb/.bin).
//
//   npx tsx tools/fetch-npc.ts
//
// The bodies are scanned people: see tools/fetch-people.ts.
// Source (see public/models/npc/CREDITS.md):
//  - ual:   Quaternius' Universal Animation Library (CC0), animations only,
//           downloaded from itch.io (free, name-your-own-price)
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = 'public/models/npc';
const CACHE = 'node_modules/.cache/npc';

/** The animations we use from the Universal Animation Library. */
export const UAL_CLIPS = [
  'A_TPose', 'Idle_Loop', 'Idle_Talking_Loop', 'Idle_Torch_Loop', 'Walk_Loop', 'Walk_Formal_Loop',
  'Interact', 'PickUp_Table', 'Sword_Idle', 'Spell_Simple_Idle_Loop', 'Fixing_Kneeling', 'Sitting_Idle_Loop',
];

function curl(args: string[]) { return execFileSync('curl', ['-sSfL', '--retry', '3', ...args]); }

/** itch.io's free-download flow for a name-your-own-price page (no login). */
function itchFree(page: string, uploadName: RegExp, file: string) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const jar = path.join(CACHE, 'cookies.txt');
  const html = curl(['-c', jar, page]).toString();
  const csrf = /name="csrf_token" value="([^"]+)"/.exec(html)![1];
  const dl = JSON.parse(curl(['-b', jar, '-c', jar, '-X', 'POST', '-d', `csrf_token=${encodeURIComponent(csrf)}`, page + '/download_url']).toString()).url;
  const dhtml = curl(['-b', jar, '-c', jar, dl]).toString();
  const csrf2 = /name="csrf_token" value="([^"]+)"/.exec(dhtml)![1];
  const key = /\/download\/([^"?]+)/.exec(dl)![1];
  // Uploads are listed in order; pick the one whose title matches.
  const ups = [...dhtml.matchAll(/data-upload_id="(\d+)"[\s\S]*?title="([^"]+)"/g)];
  const up = ups.find((m) => uploadName.test(m[2])) ?? ups[0];
  const r = JSON.parse(curl(['-b', jar, '-c', jar, '-X', 'POST', '-d', `csrf_token=${encodeURIComponent(csrf2)}`,
    `${page}/file/${up[1]}?source=game_download&key=${key}`]).toString());
  curl(['-o', file, r.url]);
}

async function write(doc: Document, io: NodeIO, id: string) {
  const root = doc.getRoot();
  const buffers = root.listBuffers();
  for (let i = 1; i < buffers.length; i++) {
    for (const a of root.listAccessors()) if (a.getBuffer() === buffers[i]) a.setBuffer(buffers[0]);
    buffers[i].dispose();
  }
  root.listTextures().forEach((t, i) => t.setURI(`${id}_${i}.webp`));
  const { json, resources } = await io.writeJSON(doc);
  for (const b of json.buffers ?? []) b.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[b.uri!]).toString('base64');
  let tex = 0;
  for (const im of json.images ?? []) { fs.writeFileSync(path.join(OUT, im.uri!), resources[im.uri!]); tex += resources[im.uri!].byteLength; }
  const s = JSON.stringify(json);
  fs.writeFileSync(path.join(OUT, `${id}.json`), s);
  console.log(`${id}: json ${(s.length / 1e6).toFixed(2)} MB, textures ${(tex / 1e6).toFixed(2)} MB`);
}

/** Keep only the skeleton + the named animations. */
function animationsOnly(doc: Document, keep?: string[]) {
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (keep && !keep.includes(a.getName())) a.dispose();
  for (const n of root.listNodes()) { n.setMesh(null); n.setSkin(null); }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
}

fs.mkdirSync(OUT, { recursive: true });
itchFree('https://quaternius.itch.io/universal-animation-library', /Standard/, path.join(CACHE, 'ual.zip'));
if (!fs.existsSync(path.join(CACHE, 'ual.glb'))) {
  execFileSync('unzip', ['-o', '-j', path.join(CACHE, 'ual.zip'), '*Unreal-Godot/UAL1_Standard.glb', '-d', CACHE]);
  fs.renameSync(path.join(CACHE, 'UAL1_Standard.glb'), path.join(CACHE, 'ual.glb'));
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
{
  const doc = await io.read(path.join(CACHE, 'ual.glb'));
  animationsOnly(doc, UAL_CLIPS);
  await doc.transform(resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }));
  await write(doc, io, 'ual');
}
// Credits: public/models/npc/CREDITS.md (the bodies come from tools/fetch-people.ts).
