// Fetch photogrammetry scans of Roman (and Egyptian) sculpture from Sketchfab
// and pack each for the game: decimated, turned upright, scaled to its real
// size, base on y = 0, colour desaturated towards weathered stone, as one glTF
// JSON (geometry embedded) + .webp textures (the published host serves .json
// and .webp but not .glb/.bin). Writes public/models/spolia/*.json, CREDITS.md
// and src/benevento/spolia.models.json (sizes, triangle counts, credits).
//
//   SKETCHFAB_TOKEN=… npx tsx tools/fetch-spolia.ts        # download (if not cached) + pack all
//   npx tsx tools/fetch-spolia.ts torso_dionysus             # just one (from the cache)
//
// The token is read from the environment only; it is never written anywhere.
// Only CC BY / CC0 models are used (no NonCommercial or NoDerivatives).
import { NodeIO, Document, getBounds, type Primitive, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsPBRSpecularGlossiness, type PBRSpecularGlossiness } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, flatten, join, clearNodeTransform, transformMesh, quantize, compactPrimitive, cloneDocument } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * One scan. `rot`: Euler XYZ in degrees applied first (to stand it up / face
 * it +z); then scaled so that `fit` (h = height, l = longest horizontal side)
 * equals `size` metres. `tris`: triangle budget; `tex`: base colour size.
 */
interface Spec { uid: string; rot?: [number, number, number]; fit: 'h' | 'l'; size: number; tris: number; tex: 512 | 1024; normal?: boolean; sat?: number; /** Drop everything below this fraction of the height (a museum mount). */ cut?: number }
export const SPOLIA: Record<string, Spec> = {
  // Statues, torsos and heads.
  torso_emperor: { uid: 'a86e2a3297664c3690531a046e75a705', fit: 'h', size: 1.25, tris: 9000, tex: 1024 },
  torso_dionysus: { uid: 'de078950bd474c73bb6cd7e1cf31de9b', fit: 'h', size: 1.0, tris: 7000, tex: 1024 },
  torso_apollo: { uid: '368499d943d844e79e275fe0bc599078', fit: 'h', size: 0.95, tris: 7000, tex: 1024, normal: true },
  torso_woman: { uid: 'ef87b70aab6e42eca282f68933135830', fit: 'h', size: 0.95, tris: 6000, tex: 512, normal: true },
  bust_aurelius: { uid: 'dba064e7f177442c9e20f755042bf662', fit: 'h', size: 0.72, tris: 7000, tex: 1024 },
  bust_man: { uid: 'fc442ce1d47a49b0aea6ee03e86b5080', fit: 'h', size: 0.62, tris: 6000, tex: 512, normal: true },
  head_priestess: { uid: 'dc8675557181447dabd382816d5426e7', fit: 'h', size: 0.4, tris: 5000, tex: 512 },
  foot_colossal: { uid: '14d9f3705cb94f35a959903418bb14ed', fit: 'l', size: 1.05, tris: 5000, tex: 512 },
  // Funerary monuments, reliefs, inscriptions, architecture.
  relief_couple: { uid: '9f37bead9d4a41e095cf5ebe642f22df', rot: [0, 121.5, 0], fit: 'l', size: 1.25, tris: 9000, tex: 1024 },
  relief_funerary: { uid: 'fe4730a35f8c478194e0897195ca9717', fit: 'h', size: 0.75, tris: 5000, tex: 512, normal: true },
  tondo: { uid: 'e69f29a1fb114428a7759ac3fc6d06e3', fit: 'h', size: 0.85, tris: 5000, tex: 512, normal: true },
  altar_grave: { uid: 'e62834dccb1f428f8a1ad16730463968', fit: 'h', size: 1.0, tris: 6000, tex: 512 },
  sarcophagus: { uid: '6ae90150f27240d09ce2c171569128d9', fit: 'l', size: 2.1, tris: 9000, tex: 1024 },
  sarcophagus_seasons: { uid: '41cb8185bcca4282bb9c99906b10ff42', fit: 'l', size: 2.2, tris: 9000, tex: 1024 },
  sarcophagus_lid: { uid: 'd7fe1122c51941f59b81e96c2be341ed', fit: 'l', size: 2.0, tris: 7000, tex: 1024 },
  capital: { uid: 'e005471f537f4f05a464f70882cae945', fit: 'h', size: 0.86, tris: 7000, tex: 512, normal: true },
  lion: { uid: 'a9a37b152a08485a8abac3c7511b04c4', fit: 'l', size: 1.45, tris: 7000, tex: 512 },
  lion_corbridge: { uid: 'ab740d01dc7f49018d45369014bfacb8', fit: 'l', size: 1.0, tris: 6000, tex: 512 },
  // The Iseum: Egyptian pieces brought by Domitian (Apis, sphinx, a seated king, a ram, Isis).
  apis: { uid: '8f3c2abe63754b1cbb0f4010c4215538', fit: 'l', size: 1.9, cut: 0.385, tris: 7000, tex: 512, normal: true, sat: 0.8 },
  sphinx: { uid: 'ebd496a7e5364af1b32674389a38dffb', fit: 'l', size: 2.6, tris: 12000, tex: 1024, sat: 0.8 },
  pharaoh: { uid: '6334eacc070a44f882eb2f8d0e0821d2', fit: 'h', size: 1.3, tris: 9000, tex: 1024, sat: 0.8 },
  ram_amun: { uid: 'cdd9eb38c9a54cd5bf61abc112b97f11', fit: 'l', size: 1.6, tris: 7000, tex: 512, sat: 0.8 },
  isis: { uid: '8cd1f63c87a143c7b6c8cda8cf6b644f', fit: 'h', size: 1.75, tris: 8000, tex: 512, sat: 0.7 },
};

const OUT = 'public/models/spolia';
const CACHE = 'tools/.cache/spolia';
const META = 'src/benevento/spolia.models.json';

function sketchfab(uid: string) {
  const dir = path.join(CACHE, uid), glb = path.join(dir, 'model.glb');
  if (fs.existsSync(glb) && fs.existsSync(path.join(dir, 'info.json'))) return;
  const tok = process.env.SKETCHFAB_TOKEN;
  if (!tok) throw new Error(`${uid} not cached and SKETCHFAB_TOKEN is not set`);
  fs.mkdirSync(dir, { recursive: true });
  const api = (u: string) => JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '3', '-H', `Authorization: Token ${tok}`, u]).toString());
  const m = api(`https://api.sketchfab.com/v3/models/${uid}`);
  const lic = m.license?.label ?? '';
  if (/NonCommercial|NoDeriv/.test(lic) || !lic) throw new Error(`${uid}: licence ${lic} not usable`);
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ uid, name: m.name, user: m.user.username, displayName: m.user.displayName, url: m.viewerUrl, license: lic, licenseUrl: m.license?.url, faces: m.faceCount }, null, 1));
  const dl = api(`https://api.sketchfab.com/v3/models/${uid}/download`);
  if (!dl.glb) throw new Error(`${uid}: no glb download`);
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', glb, dl.glb.url]);
}

function triCount(doc: Document) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION')!.getCount()) / 3;
  }
  return n;
}

/** Euler XYZ (degrees) → column-major 4x4. */
function rotMat([ax, ay, az]: [number, number, number]) {
  const [x, y, z] = [ax, ay, az].map((d) => (d * Math.PI) / 180);
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // three.js Matrix4.makeRotationFromEuler, order XYZ (row-major te[] there is column-major storage).
  const m = new Array(16).fill(0);
  m[0] = c * e; m[4] = -c * f; m[8] = d;
  m[1] = af + be * d; m[5] = ae - bf * d; m[9] = -b * c;
  m[2] = bf - ae * d; m[6] = be + af * d; m[10] = a * c;
  m[15] = 1;
  return m;
}
const mul = (A: number[], B: number[]) => {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += A[k * 4 + i] * B[j * 4 + k];
  return o;
};

/** Diffuse of a spec-gloss material becomes its base colour. */
function specGlossToBase(doc: Document) {
  for (const m of doc.getRoot().listMaterials()) {
    const sg = m.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
    if (!sg) continue;
    const t = sg.getDiffuseTexture();
    if (t && !m.getBaseColorTexture()) m.setBaseColorTexture(t);
    m.setBaseColorFactor(sg.getDiffuseFactor());
    m.setExtension('KHR_materials_pbrSpecularGlossiness', null);
  }
  doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === KHRMaterialsPBRSpecularGlossiness.EXTENSION_NAME)?.dispose();
}

/**
 * Smooth vertex normals, area-weighted and shared by every vertex at the same
 * position (so UV seams do not show as creases). Scans often come flat-shaded
 * or with per-face normals that stop the simplifier from collapsing anything,
 * so the normals are dropped before welding and rebuilt here.
 */
function smoothNormals(doc: Document, p: Primitive) {
  const pos = p.getAttribute('POSITION')!, idx = p.getIndices();
  const n = pos.getCount(), P = new Float32Array(n * 3), a = [0, 0, 0];
  for (let i = 0; i < n; i++) { pos.getElement(i, a); P[i * 3] = a[0]; P[i * 3 + 1] = a[1]; P[i * 3 + 2] = a[2]; }
  const key = (i: number) => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
  const groups = new Map<string, number>(), gi = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = key(i); let g = groups.get(k); if (g === undefined) groups.set(k, (g = groups.size)); gi[i] = g; }
  const acc = new Float32Array(groups.size * 3);
  const I = idx ? Array.from({ length: idx.getCount() }, (_, k) => idx.getScalar(k)) : Array.from({ length: n }, (_, k) => k);
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
    const ux = P[i1 * 3] - P[i0 * 3], uy = P[i1 * 3 + 1] - P[i0 * 3 + 1], uz = P[i1 * 3 + 2] - P[i0 * 3 + 2];
    const vx = P[i2 * 3] - P[i0 * 3], vy = P[i2 * 3 + 1] - P[i0 * 3 + 1], vz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const i of [i0, i1, i2]) { acc[gi[i] * 3] += cx; acc[gi[i] * 3 + 1] += cy; acc[gi[i] * 3 + 2] += cz; }
  }
  const N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = gi[i], x = acc[g * 3], y = acc[g * 3 + 1], z = acc[g * 3 + 2], l = Math.hypot(x, y, z) || 1;
    N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l;
  }
  p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(pos.getBuffer()));
}

async function tint(t: Texture, sat: number) {
  const img = t.getImage();
  if (!img) return;
  // Museum light is warm and clean: pull the colour towards grey stone, a little darker.
  const out = await sharp(Buffer.from(img)).modulate({ saturation: sat, brightness: 0.92 }).png().toBuffer();
  t.setImage(new Uint8Array(out)).setMimeType('image/png');
}

interface Meta { id: string; size: [number, number, number]; tris: number; loTris: number; parts: number; name: string; author: string; url: string; license: string; licenseUrl: string }

async function pack(id: string): Promise<Meta> {
  const cfg = SPOLIA[id];
  sketchfab(cfg.uid);
  const info = JSON.parse(fs.readFileSync(path.join(CACHE, cfg.uid, 'info.json'), 'utf8'));
  if (/NonCommercial|NoDeriv/.test(info.license)) throw new Error('licence ' + info.license);
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(CACHE, cfg.uid, 'model.glb'));
  const root = doc.getRoot();
  const before = triCount(doc);
  specGlossToBase(doc);
  // Bake the node hierarchy into the vertices, one node per mesh.
  await doc.transform(flatten());
  for (const n of root.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  for (const n of root.listNodes()) if (n.getSkin()) n.setSkin(null);
  // Strip everything the game does not use.
  for (const m of root.listMaterials()) {
    m.setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
    m.setMetallicFactor(0).setRoughnessFactor(0.92).setAlphaMode('OPAQUE').setDoubleSided(false);
    if (!cfg.normal) m.setNormalTexture(null);
    m.setBaseColorFactor([1, 1, 1, 1]);
    // Unlit scans would lose their normals in prune(): they are lit here.
    m.setExtension('KHR_materials_unlit', null);
  }
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) for (const s of p.listSemantics()) if (!['POSITION', 'TEXCOORD_0'].includes(s)) p.setAttribute(s, null);
  await doc.transform(dedup(), prune(), join({ keepNamed: false }), weld());
  // Stand it up, scale to its real size, base on y = 0 centred in x/z.
  const R = rotMat(cfg.rot ?? [0, 0, 0]);
  for (const mesh of root.listMeshes()) transformMesh(mesh, R);
  let b = getBounds(root.listScenes()[0]);
  if (cfg.cut) {
    // Saw off the museum's mount: drop every triangle that reaches below the cut.
    const y0 = b.min[1] + cfg.cut * (b.max[1] - b.min[1]), v = [0, 0, 0];
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION')!, idx = p.getIndices()!, keep: number[] = [];
      for (let t = 0; t < idx.getCount(); t += 3) {
        const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
        if (tri.every((i) => pos.getElement(i, v)[1] >= y0)) keep.push(...tri);
      }
      idx.setArray(new Uint32Array(keep));
      compactPrimitive(p);
    }
    b = getBounds(root.listScenes()[0]);
  }
  const sz = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const k = cfg.size / (cfg.fit === 'h' ? sz[1] : Math.max(sz[0], sz[2]));
  const cx = (b.max[0] + b.min[0]) / 2, cz = (b.max[2] + b.min[2]) / 2;
  const T = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, -cx * k, -b.min[1] * k, -cz * k, 1];
  for (const mesh of root.listMeshes()) transformMesh(mesh, T);
  void mul;
  // Coarser error bounds until the budget is met (UV seams in scans hold collapses back).
  for (const error of [0.01, 0.03, 0.08, 0.2]) {
    if (triCount(doc) <= cfg.tris * 1.15) break;
    const ratio = Math.max(0.002, cfg.tris / triCount(doc));
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
  }
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) smoothNormals(doc, p);
  for (const m of root.listMaterials()) { const t = m.getBaseColorTexture(); if (t) await tint(t, cfg.sat ?? 0.55); }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 80, slots: /^baseColor/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 85, slots: /^normal/ }),
    prune(),
  );
  const after = triCount(doc);
  b = getBounds(root.listScenes()[0]);
  const size = [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(3)) as [number, number, number];
  // A far version (past ~14 m), sharing the textures: a sixth of the triangles.
  const lo = cloneDocument(doc);
  for (const error of [0.02, 0.08, 0.3]) {
    if (triCount(lo) <= Math.max(700, after / 6) * 1.2) break;
    await lo.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(700, after / 6) / triCount(lo), error, lockBorder: false }));
  }
  // Scans with a shattered UV atlas will not simplify further: collapse those sloppily
  // (vertices are only dropped, never moved, so each keeps its texture coordinate).
  const loGoal = Math.max(700, after / 6);
  if (triCount(lo) > loGoal * 1.5) for (const mesh of lo.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) sloppy(p, loGoal / triCount(lo));
  for (const mesh of lo.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) smoothNormals(lo, p);
  const loTris = triCount(lo);
  const texBytes = await write(io, doc, id, id, true);
  await write(io, lo, id, `${id}_lo`, false);
  const parts = root.listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0);
  console.log(`${id}: ${before} → ${after} tris (far ${loTris}), ${parts} parts, size ${size.join(' × ')} m, textures ${(texBytes / 1e3).toFixed(0)} kB`);
  return { id, size, tris: after, loTris, parts, name: info.name, author: info.displayName || info.user, url: info.url, license: info.license, licenseUrl: info.licenseUrl };
}

function sloppy(p: Primitive, ratio: number) {
  const pos = p.getAttribute('POSITION')!, idx = p.getIndices()!;
  const P = new Float32Array(pos.getCount() * 3), v = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); P.set(v, i * 3); }
  const I = new Uint32Array(idx.getCount());
  for (let k = 0; k < I.length; k++) I[k] = idx.getScalar(k);
  const target = Math.max(3, Math.floor((I.length * ratio) / 3) * 3);
  const [out] = MeshoptSimplifier.simplifySloppy(I, P, 3, null, target, 0.05);
  idx.setArray(new Uint32Array(out));
  compactPrimitive(p);
}

/** One JSON with the geometry embedded (quantized), textures as <id>_<n>.webp beside it. */
async function write(io: NodeIO, doc: Document, id: string, name: string, images: boolean) {
  // 16-bit positions and 8-bit normals (KHR_mesh_quantization, read by three's GLTFLoader).
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }));
  const root = doc.getRoot();
  const buffers = root.listBuffers();
  for (let i = 1; i < buffers.length; i++) {
    for (const a of root.listAccessors()) if (a.getBuffer() === buffers[i]) a.setBuffer(buffers[0]);
    buffers[i].dispose();
  }
  root.listTextures().forEach((t, i) => t.setURI(`${id}_${i}.webp`));
  const { json, resources } = await io.writeJSON(doc);
  fs.mkdirSync(OUT, { recursive: true });
  for (const bf of json.buffers ?? []) bf.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[bf.uri!]).toString('base64');
  let texBytes = 0;
  for (const im of json.images ?? []) { if (images) fs.writeFileSync(path.join(OUT, im.uri!), resources[im.uri!]); texBytes += resources[im.uri!].byteLength; }
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(json));
  return texBytes;
}

const only = process.argv.slice(2);
const prev: Record<string, Meta> = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};
const metas: Record<string, Meta> = {};
for (const id of Object.keys(SPOLIA)) {
  if (only.length && !only.includes(id)) { if (prev[id]) metas[id] = prev[id]; continue; }
  try { metas[id] = await pack(id); } catch (e) { console.log(`${id}: FAILED ${(e as Error).message}`); if (prev[id]) metas[id] = prev[id]; }
}
fs.writeFileSync(META, JSON.stringify(metas, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `# Spolia: scanned Roman and Egyptian sculpture

Photogrammetry scans from [Sketchfab](https://sketchfab.com), used under the licences below
(CC BY 4.0 or CC0; nothing NonCommercial or NoDerivatives). Each was decimated, scaled to a
plausible real size, its colour desaturated towards weathered stone, and re-encoded
(\`tools/fetch-spolia.ts\`); in the game a shader adds grime, lichen and moss
(\`src/benevento/spolia.ts\`). These are changes to the originals.

| In game | Original | Author | Licence | Triangles in game |
|---|---|---|---|---|
${Object.values(metas).map((m) => `| \`${m.id}\` | [${m.name}](${m.url}) | ${m.author} | [${m.license}](${m.licenseUrl}) | ${m.tris} |`).join('\n')}
`);
