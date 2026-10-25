import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// The tree pack: professional tree models (see public/models/trees/CREDITS.md),
// prepared by tools/trees/build-trees.mjs into one JSON file of meshopt-coded
// geometry (every tree, every LOD), small texture atlases, and an impostor
// atlas baked from the same meshes (tools/trees/bake-impostors.cjs).

export interface TreeDef {
  id: string;
  group: string;
  /** Height, crown radius and trunk radius at 1.3 m, in metres at scale 1. */
  h: number; crown: number; trunk: number;
  bb: number[];
  /** Per LOD: [bark mesh, leaf mesh] (-1 for none). */
  lods: [number, number][];
  tris: number[];
}
interface MeshRec { n: number; i: number; ib: 2 | 4; v: [number, number]; x: [number, number]; bb: number[]; uv: number[] }
interface PackJson { v: number; bark: Record<string, number[]>; trees: TreeDef[]; meshes: MeshRec[]; bin: string }
export interface ImpostorDef { row: number; w: number; h: number; y0: number }
export interface ImpostorJson { cols: number; rows: number; size: number[]; trees: Record<string, ImpostorDef> }

export interface TreePack {
  trees: TreeDef[];
  byId: Map<string, number>;
  geos: (THREE.BufferGeometry | null)[];
  barkTiles: THREE.Vector4[];
  tex: { bark: THREE.Texture; barkN: THREE.Texture; leafA: THREE.Texture; leafB: THREE.Texture; imp: THREE.Texture | null; impN: THREE.Texture | null };
  imp: ImpostorJson | null;
}

const BASE = 'models/trees/';

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeMesh(m: MeshRec, bin: Uint8Array): THREE.BufferGeometry {
  const vb = new Uint8Array(m.n * 16);
  MeshoptDecoder.decodeVertexBuffer(vb, m.n, 16, bin.subarray(m.v[0], m.v[0] + m.v[1]));
  const ib = new Uint8Array(m.i * m.ib);
  MeshoptDecoder.decodeIndexBuffer(ib, m.i, m.ib, bin.subarray(m.x[0], m.x[0] + m.x[1]));
  const dv = new DataView(vb.buffer);
  const pos = new Float32Array(m.n * 3), nrm = new Int8Array(m.n * 3), uv = new Float32Array(m.n * 2), kind = new Uint8Array(m.n);
  const [x0, y0, z0, x1, y1, z1] = m.bb, [u0, v0, u1, v1] = m.uv;
  const sx = (x1 - x0) / 65535, sy = (y1 - y0) / 65535, sz = (z1 - z0) / 65535, su = (u1 - u0) / 65535, sv = (v1 - v0) / 65535;
  for (let i = 0; i < m.n; i++) {
    const o = i * 16;
    pos[i * 3] = x0 + (dv.getInt16(o, true) + 32768) * sx;
    pos[i * 3 + 1] = y0 + (dv.getInt16(o + 2, true) + 32768) * sy;
    pos[i * 3 + 2] = z0 + (dv.getInt16(o + 4, true) + 32768) * sz;
    kind[i] = dv.getInt16(o + 6, true);
    nrm[i * 3] = dv.getInt8(o + 8); nrm[i * 3 + 1] = dv.getInt8(o + 9); nrm[i * 3 + 2] = dv.getInt8(o + 10);
    uv[i * 2] = u0 + dv.getUint16(o + 12, true) * su;
    uv[i * 2 + 1] = v0 + dv.getUint16(o + 14, true) * sv;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.setIndex(new THREE.BufferAttribute(m.ib === 4 ? new Uint32Array(ib.buffer) : new Uint16Array(ib.buffer), 1));
  // BatchedMesh wants one index type for all: widen to 32 bits when any mesh needs it (none does today).
  g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return g;
}

const loader = new THREE.TextureLoader();
function tex(name: string, srgb: boolean, maxAniso = 4): Promise<THREE.Texture> {
  return loader.loadAsync(BASE + name).then((t) => {
    t.flipY = false; // glTF convention: UV origin at the top left of the image
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    return t;
  });
}

let pack: TreePack | null = null;
let loading: Promise<TreePack> | null = null;
export const treePack = () => pack;

/** Load (once) the tree pack: geometry, atlases, impostors. Resolves to null-free pack or throws. */
export function loadTreePack(): Promise<TreePack> {
  return (loading ??= (async () => {
    const [json, imp] = await Promise.all([
      fetch(BASE + 'trees.json').then((r) => { if (!r.ok) throw new Error(`trees.json: HTTP ${r.status}`); return r.json() as Promise<PackJson>; }),
      fetch(BASE + 'impostors.json').then((r) => (r.ok ? (r.json() as Promise<ImpostorJson>) : null)).catch(() => null),
      MeshoptDecoder.ready,
    ]);
    const [bark, barkN, leafA, leafB, impA, impN] = await Promise.all([
      tex('bark.webp', true), tex('barkn.webp', false), tex('leafA.webp', true), tex('leafB.webp', true),
      imp ? tex('impostor.webp', true, 1) : Promise.resolve(null), imp ? tex('impostorn.webp', false, 1) : Promise.resolve(null),
    ]);
    const bin = b64(json.bin);
    const geos = json.meshes.map((m) => decodeMesh(m, bin));
    const tiles = ['oak', 'crust', 'poplar', 'dead'].map((k) => new THREE.Vector4(...(json.bark[k] as [number, number, number, number])));
    pack = {
      trees: json.trees,
      byId: new Map(json.trees.map((t, i) => [t.id, i])),
      geos,
      barkTiles: tiles,
      tex: { bark, barkN, leafA, leafB, imp: impA, impN },
      imp,
    };
    return pack;
  })());
}
