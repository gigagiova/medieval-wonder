import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder, rng } from './builder';
import { mat, shared, type MatName } from './materials';
import { noiseGLSL, atmosGLSL } from './shaders';
import { field } from './displace';
import { arcadeGeo, gable } from './shapes';
import { candle, lucerna, hornLantern, bracketLantern } from './lights';
import { TEXTS, type Text, openCodex, isReading, spreadTexture, fontsReady } from './codex';

// The abbey's book room: armarium and scriptorium in one long rubble hall.
// As at Bobbio or Nonantola around 720, the codices lie flat in wooden
// cupboards (armaria): boards covered in tawed or tanned leather, raised
// sewing bands, a strap and pin or a few bronze bosses on the better ones.
// Loose quires are tied with cord, a few books hang in satchels on pegs,
// rolls stand in a capsa. At the copyists' sloped desks: an exemplar on a
// stand, the copy half written, inkhorn, quill, knife, pumice, wax tablets.
// No chained books, no titles on spines: those came centuries later.

const rand = rng(9171);
const R = (a: number, b: number) => a + (b - a) * rand();
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

// Hall footprint (outer), long axis along z; door in the west wall.
const X0 = -10.2, X1 = -5.6, Z0 = -64, Z1 = -44, T = 0.7, H = 4.2;
const IX0 = X0 + T, IX1 = X1 - T, IZ0 = Z0 + T, IZ1 = Z1 - T;
// The secret cabinet: north of a partition at PZ, through an opening OX0..OX1.
const PZ = -59.0, OX0 = -8.55, OX1 = -7.45;
const SECRET_TEXTS = ['chrysopoeia', 'physika', 'compositiones'];
export const LIBRARY_DOOR = new THREE.Vector3(X0, 0, -50);

// ------------------------------------------------------------ materials

/** Fog and lamp halos for materials that are not world-shaded surfaces. */
function withAtmos<M extends THREE.MeshStandardMaterial>(m: M, key: string): M {
  m.customProgramCacheKey = () => 'lib-' + key;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
        #else
          vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPos);');
  };
  return m;
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let mats: { leather: THREE.MeshStandardMaterial; parch: THREE.MeshStandardMaterial; horn: THREE.MeshStandardMaterial; wax: THREE.MeshStandardMaterial; quill: THREE.MeshStandardMaterial; tanned: THREE.MeshStandardMaterial } | null = null;
function materials() {
  if (mats) return mats;
  // Leather grain and scuffs, as a bump map.
  const grain = canvasTex(256, 256, (c) => {
    const r = rng(5);
    c.fillStyle = '#808080'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
      const v = 110 + r() * 40;
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
    }
    c.strokeStyle = 'rgba(40,40,40,0.5)';
    for (let i = 0; i < 40; i++) {
      c.lineWidth = 0.5 + r();
      c.beginPath(); const x = r() * 256, y = r() * 256; c.moveTo(x, y); c.lineTo(x + R(-30, 30), y + R(-30, 30)); c.stroke();
    }
  }, true);
  grain.colorSpace = THREE.NoColorSpace;
  const leather = withAtmos(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, bumpMap: grain, bumpScale: 1.2 }), 'leather');
  // Text-block edges: the stacked leaves, slightly uneven and grubby.
  const leaves = canvasTex(64, 256, (c) => {
    const r = rng(11);
    c.fillStyle = '#d8c69f'; c.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 2) {
      const v = 175 + r() * 50;
      c.fillStyle = `rgba(${v},${v * 0.9},${v * 0.7},0.8)`;
      c.fillRect(0, y, 64, 1);
    }
    const g = c.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(90,60,30,0.25)'); g.addColorStop(0.5, 'rgba(90,60,30,0)'); g.addColorStop(1, 'rgba(90,60,30,0.25)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 256);
  });
  const parch = withAtmos(new THREE.MeshStandardMaterial({ color: 0xffffff, map: leaves, roughness: 0.9 }), 'parch');
  const horn = withAtmos(new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.35 }), 'horn');
  const wax = withAtmos(new THREE.MeshStandardMaterial({ color: 0x1c140c, roughness: 0.55 }), 'wax');
  // Satchels, straps, cords and open-book boards are one tanned brown.
  const tanned = withAtmos(new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7, bumpMap: grain, bumpScale: 1.2 }), 'tanned');
  const quill = withAtmos(new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.8, side: THREE.DoubleSide }), 'quill');
  mats = { leather, parch, horn, wax, quill, tanned };
  return mats;
}

// ------------------------------------------------------------ geometry helpers

const E = new THREE.Euler(), Q = new THREE.Quaternion(), S3 = new THREE.Vector3();
function M(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1) {
  E.set(rx, ry, rz, 'YXZ');
  Q.setFromEuler(E);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q, S3.set(s, s, s));
}
const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
function bx(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  return ni(new THREE.BoxGeometry(w, h, d)).applyMatrix4(M(x, y, z, ry, rx, rz));
}
function merge(list: THREE.BufferGeometry[]) {
  const clean = list.map((g) => {
    const n = ni(g);
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  return mergeGeometries(clean, false)!;
}

/** Collects furniture geometry per surface material, in world space. */
class Parts {
  map = new Map<string, THREE.BufferGeometry[]>();
  add(key: string, g: THREE.BufferGeometry, m: THREE.Matrix4) {
    if (!this.map.has(key)) this.map.set(key, []);
    this.map.get(key)!.push(ni(g).applyMatrix4(m));
  }
}

// ------------------------------------------------------------ books

type Size = 'folio' | 'quarto' | 'pocket' | 'thick';
const SIZES: Record<Size, [number, number, number]> = {
  folio: [0.26, 0.36, 0.07], quarto: [0.19, 0.26, 0.05], pocket: [0.12, 0.165, 0.035], thick: [0.23, 0.32, 0.11],
};
type Deco = 0 | 1 | 2; // plain, strap and pin, bronze bosses

interface Variant { leather: THREE.BufferGeometry; parch: THREE.BufferGeometry; metal: THREE.BufferGeometry | null; dims: [number, number, number] }
const variants = new Map<string, Variant>();

/**
 * A closed codex lying flat: origin at the centre of the bottom board, spine
 * along -x, length along z. Boards overhang the text block on three sides;
 * the spine is rounded with raised bands.
 */
function bookVariant(size: Size, deco: Deco): Variant {
  const key = size + deco;
  const hit = variants.get(key);
  if (hit) return hit;
  const [w, h, t] = SIZES[size];
  const bt = size === 'pocket' ? 0.005 : 0.008, sq = 0.004;
  const lea: THREE.BufferGeometry[] = [], par: THREE.BufferGeometry[] = [], met: THREE.BufferGeometry[] = [];
  lea.push(bx(w + sq, bt, h + 2 * sq, sq / 2, bt / 2, 0));
  lea.push(bx(w + sq, bt, h + 2 * sq, sq / 2, t - bt / 2, 0, 0, 0, R(-0.01, 0.01)));
  par.push(bx(w - 0.004, t - 2 * bt + 0.002, h, -0.002, t / 2, 0));
  const sp = new THREE.CylinderGeometry(t / 2, t / 2, h + 2 * sq, 10, 1, true, Math.PI, Math.PI);
  sp.rotateX(Math.PI / 2);
  sp.scale(0.55, 1, 1);
  sp.translate(-w / 2, t / 2, 0);
  lea.push(sp);
  const nb = h > 0.3 ? 4 : 3;
  for (let i = 0; i < nb; i++) {
    const z = -h / 2 + (h * (i + 0.5)) / nb;
    lea.push(bx(t * 0.22, t * 0.92, 0.012, -w / 2 - t * 0.2, t / 2, z));
  }
  if (deco === 1) {
    for (const z of h > 0.3 ? [-h * 0.24, h * 0.24] : [0]) {
      lea.push(bx(0.09, 0.003, 0.024, w / 2 - 0.035, t + 0.0015, z));
      lea.push(bx(0.004, t * 0.6, 0.024, w / 2 + sq + 0.002, t * 0.7, z));
      met.push(bx(0.01, 0.012, 0.012, w / 2 + sq + 0.004, t * 0.32, z));
    }
  } else if (deco === 2) {
    const r = Math.min(0.016, w * 0.08);
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const g = new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      g.translate(px * (w / 2 - 0.035) + 0.002, t, pz * (h / 2 - 0.04));
      met.push(g);
    }
    for (const z of [-h * 0.28, h * 0.28]) met.push(bx(0.012, t * 0.8, 0.03, w / 2 + sq + 0.004, t / 2, z));
  }
  const v: Variant = { leather: merge(lea), parch: merge(par), metal: met.length ? merge(met) : null, dims: [w, h, t] };
  variants.set(key, v);
  return v;
}

const LEATHER = [0xcdb898, 0xb8a080, 0x6b4429, 0x55361f, 0x3e2718, 0x7a3424, 0x8f5a48, 0x5e4a32];

interface BookInst { v: Variant; m: THREE.Matrix4; color: THREE.Color }

/** An open codex: two page surfaces bent up from the gutter, textured with a written spread. */
function openBook(w: number, h: number, t: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const nu = 16, nv = 3;
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const y = t * (0.35 + 0.65 * Math.sqrt(Math.min(1, u / 0.22))) - t * 0.12 * u * u + Math.sin(u * 9 + side) * 0.0015;
      pos.push(side * u * w, y, -h / 2 + (h * j) / nv);
      uv.push(side < 0 ? 0.5 - 0.5 * u : 0.5 + 0.5 * u, 1 - j / nv);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const pages = new THREE.BufferGeometry();
  pages.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pages.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  pages.setIndex(idx);
  pages.computeVertexNormals();
  const block = merge([bx(w * 0.98, t * 0.55, h * 0.99, -w / 2, t * 0.28, 0), bx(w * 0.98, t * 0.55, h * 0.99, w / 2, t * 0.28, 0)]);
  const boards = merge([
    bx(w + 0.012, 0.008, h + 0.014, -(w + 0.012) / 2, -0.004, 0, 0, 0, -0.025),
    bx(w + 0.012, 0.008, h + 0.014, (w + 0.012) / 2, -0.004, 0, 0, 0, 0.025),
  ]);
  return { pages, block, boards };
}

// ------------------------------------------------------------ reading

interface Readable { pos: THREE.Vector3; text: Text; page: number; seed: number; open: boolean }
const readables: Readable[] = [];
let btn: HTMLButtonElement | null = null;
let target: Readable | null = null;

function readButton() {
  const style = document.createElement('style');
  style.textContent = `
  #readbtn { position: fixed; z-index: 6; left: 50%; transform: translateX(-50%);
    bottom: max(26px, calc(env(safe-area-inset-bottom, 0px) + 18px));
    display: flex; align-items: center; gap: 10px; padding: 10px 22px 10px 16px; border-radius: 28px; cursor: pointer;
    border: 2px solid rgba(201,154,86,0.85); color: #f0dcae; font: 20px 'IM Fell English', Georgia, serif; letter-spacing: 0.06em;
    background: radial-gradient(circle at 30% 30%, rgba(92,64,32,0.95), rgba(22,15,8,0.95)); box-shadow: 0 0 18px rgba(0,0,0,0.6);
    touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  #readbtn svg { width: 26px; height: 26px; }
  #readbtn small { font-size: 13px; opacity: 0.7; font-style: italic; }
  #readbtn:focus-visible { outline: 2px solid #e8c88a; outline-offset: 3px; }`;
  document.head.appendChild(style);
  const b = document.createElement('button');
  b.id = 'readbtn';
  b.type = 'button';
  b.hidden = true;
  b.setAttribute('aria-label', 'Read the book');
  b.innerHTML = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M16 9c-3-2-7-2.5-11-2v17c4-.5 8 0 11 2 3-2 7-2.5 11-2V7c-4-.5-8 0-11 2z"/><path d="M16 9v17"/></svg><span>Lege</span><small></small>`;
  b.addEventListener('click', (e) => { e.stopPropagation(); activate(); });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.appendChild(b);
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && !isReading()) activate();
  });
  return b;
}

const camPos = new THREE.Vector3(), camDir = new THREE.Vector3(), tmp = new THREE.Vector3();
/** Per frame: offer the Read button for the open book nearby or the closed one being looked at. */
export function updateLibrary(camera: THREE.Camera) {
  if (!btn) return;
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camDir);
  let best: Readable | null = null, bestScore = Infinity;
  for (const r of readables) {
    tmp.subVectors(r.pos, camPos);
    const d = tmp.length();
    if (d > 1.7) continue;
    const c = tmp.dot(camDir) / Math.max(d, 1e-3);
    if (r.open) {
      if (c < 0.25) continue;
      const s = d - 1;
      if (s < bestScore) { best = r; bestScore = s; }
    } else {
      if (c < 0.96) continue;
      const s = (1 - c) * 20 + d;
      if (s < bestScore) { best = r; bestScore = s; }
    }
  }
  target = isReading() ? null : best;
  // The press in the north partition can be examined (and closed again).
  const door = secretDoorTick(camPos, camDir) && !isReading() && (!best || bestScore > 0.6);
  examine = door;
  if (door) target = null;
  btn.hidden = !target && !door;
  const label = btn.querySelector('span')!, small = btn.querySelector('small')!;
  if (door) {
    label.textContent = secret.target === 0 ? 'Inspice' : 'Claude';
    small.textContent = secret.target === 0 ? 'this press sits oddly' : 'the hidden door';
    btn.setAttribute('aria-label', secret.target === 0 ? 'Examine the press' : 'Close the hidden door');
  } else if (target) {
    label.textContent = 'Lege';
    small.textContent = target.text.rubric.replace(/^Incipit (liber )?/, '').split(' ').slice(0, 4).join(' ');
    btn.setAttribute('aria-label', 'Read the book');
  }
}

let examine = false;
function activate() {
  if (examine) { secret.target = secret.target === 0 ? OPEN_ANGLE : 0; return; }
  if (target) openCodex(target.text, target.page, target.seed);
}

// ------------------------------------------------------------ the room

export function buildLibrary(b: Builder, scene: THREE.Scene) {
  const m = materials();
  const parts = new Parts();
  const books: BookInst[] = [];
  const group = new THREE.Group();
  group.name = 'library';
  const off = new THREE.Vector3();
  // Furniture is rigid; it moves with the world's displacement field at its
  // own base, like the walls and floor around it.
  const anchor = (x: number, y: number, z: number) => field(x, y, z, 'wood', off.set(0, 0, 0)).clone();

  shell(b);

  // --- armaria along the west wall (north of the door) and the east wall (north half)
  let z = PZ + 0.3;
  while (z < -51.75) {
    const W = Math.min(R(1.2, 1.6), -51.6 - z);
    if (W < 0.9) break;
    armarium(b, parts, books, IX0 + 0.27, z + W / 2, Math.PI / 2 + R(-0.015, 0.015), W, R(1.95, 2.4), anchor);
    z += W + R(0.06, 0.28);
  }
  z = PZ + 0.3;
  while (z < -55.4) {
    const W = Math.min(R(1.2, 1.55), -55.2 - z);
    if (W < 0.9) break;
    armarium(b, parts, books, IX1 - 0.27, z + W / 2, -Math.PI / 2 + R(-0.015, 0.015), W, R(1.9, 2.3), anchor);
    z += W + R(0.06, 0.3);
  }
  // --- the press in the partition that is really a door, and what lies behind it
  secretDoor(group, m, anchor);
  cabinet(b, parts, group, anchor);
  // A small open press by the door, south side.
  armarium(b, parts, books, IX0 + 0.27, -44.7 - 0.62, Math.PI / 2, 1.0, 1.7, anchor, false);

  // --- scriptorium: two copyists' desks under the east windows, a lectern
  desk(b, parts, m, IX1 - 0.45, -52.6, -Math.PI / 2 + 0.03, anchor, 'regula', 1, 0.55, group);
  desk(b, parts, m, IX1 - 0.45, -48.9, -Math.PI / 2 - 0.05, anchor, 'dialogi', 0, 0.3, group);
  lectern(b, parts, m, -8.1, -45.75, Math.PI + 0.06, anchor, group);

  // --- satchels on pegs (the Irish habit at Bobbio), a capsa of rolls, a chest
  for (const [sz, sy] of [[-48.15, 1.85], [-47.45, 1.95], [-46.6, 1.8]] as const) satchel(b, parts, IX0, sy, sz, anchor);
  capsa(parts, -9.1, -45.35, anchor);
  chest(b, parts, IX1 - 0.4, -54.6, anchor);

  // --- lights: candles at the desks are placed with the desks; lamps on presses, a lantern
  lucerna(b, IX0 + 0.4, 2.42, -59.2, Math.PI / 2);
  lucerna(b, IX1 - 0.35, 2.35, -60.6, -Math.PI / 2);
  hornLantern(b, -7.8, 2.95, -50.4);
  b.box('iron', 0.012, H - 0.4 - 3.22, 0.012, -7.8, 3.22, -50.4, 0, false);
  bracketLantern(b, X0 - 0.02, 2.2, -48.7, -Math.PI / 2);

  addMeshes(parts, books, m, group);
  registerClosedBooks(group);
  refreshWhenFontsReady(group);
  scene.add(group);
  if (!btn) btn = readButton();
  return group;
}

/** Merge furniture per material and instance the books into `into`. */
function addMeshes(parts: Parts, books: BookInst[], m: ReturnType<typeof materials>, into: THREE.Object3D) {
  for (const [key, list] of parts.map) {
    const g = merge(list);
    const custom: Record<string, THREE.Material> = { leather: m.tanned, parch: m.parch, horn: m.horn, wax: m.wax, quill: m.quill };
    const mesh = new THREE.Mesh(g, custom[key] ?? mat(key as MatName));
    mesh.receiveShadow = true;
    into.add(mesh);
  }
  const byVariant = new Map<Variant, BookInst[]>();
  for (const bk of books) {
    if (!byVariant.has(bk.v)) byVariant.set(bk.v, []);
    byVariant.get(bk.v)!.push(bk);
  }
  for (const [v, list] of byVariant) {
    const lea = new THREE.InstancedMesh(v.leather, m.leather, list.length);
    const par = new THREE.InstancedMesh(v.parch, m.parch, list.length);
    const met = v.metal ? new THREE.InstancedMesh(v.metal, mat('bronze'), list.length) : null;
    list.forEach((bk, i) => {
      lea.setMatrixAt(i, bk.m); lea.setColorAt(i, bk.color);
      par.setMatrixAt(i, bk.m); par.setColorAt(i, new THREE.Color().setHSL(0.11, 0.35, R(0.72, 0.84)));
      met?.setMatrixAt(i, bk.m);
    });
    for (const im of [lea, par, met]) if (im) { im.computeBoundingSphere(); into.add(im); }
  }
}

/** Hall walls, door, windows, timber ceiling, roof, floor. */
function shell(b: Builder) {
  const cz = (Z0 + Z1) / 2, cx = (X0 + X1) / 2, L = Z1 - Z0;
  const wx = X0 + T / 2, ex = X1 - T / 2;
  // West wall with the arched door at z = -50.
  b.box('rubble', T, H, -51.4 - Z0, wx, -0.3, (Z0 - 51.4) / 2, 0.004);
  b.geo('brick', arcadeGeo(2.8, H + 0.3, T + 0.04, 1, 1.3, 2.05), wx, -0.3, -50, Math.PI / 2);
  b.box('rubble', T, H, Z1 + 48.6, wx, -0.3, (Z1 - 48.6) / 2, -0.006);
  b.box('rubble', T, H, L, ex, -0.3, cz, -0.004);
  b.box('rubble', X1 - X0, H, T, cx, -0.3, Z0 + T / 2, 0.005);
  b.box('rubble', X1 - X0, H, T, cx, -0.3, Z1 - T / 2, -0.004);
  // Partition closing off the cabinet at the north end; its opening hides
  // behind the press that serves as a door.
  b.box('rubble', OX0 - IX0, H, 0.45, (IX0 + OX0) / 2, -0.3, PZ, 0.005);
  b.box('rubble', IX1 - OX1, H, 0.45, (OX1 + IX1) / 2, -0.3, PZ, -0.005);
  b.box('rubble', OX1 - OX0 + 0.1, H - 0.3 - 2.2, 0.45, (OX0 + OX1) / 2, 2.2, PZ, 0, true);
  // Barrel vault of the cabinet, brick, seen from inside.
  const vg = new THREE.CylinderGeometry(1.62, 1.62, PZ - IZ0, 18, 4, true, Math.PI / 2, Math.PI);
  vg.rotateX(Math.PI / 2);
  vg.scale(-1, 1, 1);
  vg.computeVertexNormals();
  b.geo('brick', vg, (IX0 + IX1) / 2, 1.95, (IZ0 + PZ) / 2, 0, false);
  // Lime-washed inside faces, flaking.
  b.box('plaster', 0.03, H - 0.3, IZ1 - IZ0, IX1 - 0.015, 0, cz, 0, false);
  b.box('plaster', 0.03, H - 0.3, -51.45 - IZ0, IX0 + 0.015, 0, (IZ0 - 51.45) / 2, 0, false);
  b.box('plaster', IX1 - IX0, H - 0.3, 0.03, cx + 0.05, 0, IZ0 + 0.015, 0, false);
  // Door leaf standing open, a worn marble threshold.
  const s = 1.25;
  b.box('wood', 0.07, 2.3, 1.3, IX0 + Math.sin(s) * 0.65, 0, -50.65 + Math.cos(s) * 0.65, s, false);
  b.box('marble', T + 0.2, 0.08, 1.4, wx, -0.06, -50, 0.02, false);
  // Small windows: shutters inside, firelight leaking out.
  for (const wz of [-60.3, -56.9, -52.5, -48.7, -45.9]) {
    const y = R(2.25, 2.55);
    b.box('window', 0.06, 0.62, 0.42, X1 + 0.02, y, wz, 0, false);
    b.box('wood', 0.06, 0.62, 0.46, IX1 - 0.06, y, wz, R(-0.05, 0.05), false);
    b.box('brick', 0.12, 0.12, 0.7, IX1 - 0.04, y + 0.66, wz, 0, false);
  }
  for (const wz of [-57.8, -46.3]) b.box('window', 0.06, 0.6, 0.4, X0 - 0.02, R(2.3, 2.5), wz, 0, false);
  // Timber ceiling on irregular beams; low roof of coppi above.
  b.box('wood', IX1 - IX0 + 0.1, 0.07, IZ1 - IZ0 + 0.1, cx, H - 0.37, cz, 0, false);
  for (let bz = IZ0 + R(0.6, 1); bz < IZ1 - 0.3; bz += R(1.3, 1.9)) {
    b.box('wood', IX1 - IX0 + 0.5, R(0.2, 0.26), R(0.18, 0.24), cx, H - 0.62, bz, R(-0.03, 0.03), false, 0, R(-0.015, 0.015));
  }
  b.box('wood', 0.22, 0.2, IZ1 - IZ0, cx + 0.2, H - 0.82, cz, 0.004, false);
  gable(b, L + 0.3, X1 - X0 + 0.2, 1.05, cx, H - 0.3, cz, Math.PI / 2, 'rubble', 0.5);
  b.box('slab', IX1 - IX0, 0.06, IZ1 - IZ0, cx, -0.05, cz, 0.006, false);
}

type Anchor = (x: number, y: number, z: number) => THREE.Vector3;

/** Book piles, leaning books, quires and rolls on one shelf (in the press's local frame). */
function fillShelf(books: BookInst[], parts: Parts, pm: THREE.Matrix4, W: number, y: number, clear: number, D: number) {
  let x = -W / 2 + 0.05;
  const right = W / 2 - 0.05;
  while (x < right - 0.1) {
    const r = rand();
    if (r < 0.08) { x += R(0.05, 0.2); continue; }
    if (r < 0.15 && clear > 0.28) {
      // A codex standing, leaning on its neighbour.
      const v = bookVariant(pick(['quarto', 'pocket'] as Size[]), pick([0, 0, 1] as Deco[]));
      const [w, , t] = v.dims;
      if (w + 0.02 > clear) { x += 0.05; continue; }
      const lean = R(0.12, 0.4);
      const th = Math.PI / 2 - lean;
      const lm = M(x + t * 0.5 + Math.sin(lean) * w * 0.5, y + Math.sin(th) * w / 2 + 0.002, R(-0.02, 0.02), Math.PI / 2 + R(-0.05, 0.05), 0, th);
      books.push({ v, m: pm.clone().multiply(lm), color: new THREE.Color(pick(LEATHER)) });
      x += t + Math.sin(lean) * w + 0.02;
      continue;
    }
    if (r < 0.21) {
      // Loose quires tied with cord.
      const qw = R(0.17, 0.24), qh = R(0.23, 0.3);
      if (x + qh > right) break;
      let qy = y;
      for (let i = 0; i < 3 + Math.floor(rand() * 3); i++) {
        const tt = R(0.006, 0.012);
        parts.add('parch', bx(qw, tt, qh, 0, 0, 0), pm.clone().multiply(M(x + qh / 2, qy + tt / 2, R(-0.02, 0.02), Math.PI / 2 + R(-0.12, 0.12))));
        qy += tt;
      }
      parts.add('leather', bx(0.008, qy - y + 0.006, qw + 0.01, 0, 0, 0), pm.clone().multiply(M(x + qh / 2, (y + qy) / 2, 0, R(-0.05, 0.05))));
      x += qh + R(0.02, 0.06);
      continue;
    }
    if (r < 0.25 && clear > 0.1) {
      // A roll lying along the shelf.
      const rl = R(0.25, 0.34), rr = R(0.028, 0.04);
      if (x + rl > right) break;
      parts.add('parch', new THREE.CylinderGeometry(rr, rr, rl, 12, 1), pm.clone().multiply(M(x + rl / 2, y + rr, R(-0.05, 0.05), 0, 0, Math.PI / 2)));
      x += rl + 0.03;
      continue;
    }
    // A pile, biggest at the bottom.
    const size = pick(['folio', 'quarto', 'quarto', 'pocket', 'thick', 'folio'] as Size[]);
    const [, h0] = SIZES[size];
    if (x + h0 + 0.01 > right) { x += 0.04; continue; }
    let py = y;
    const order: Size[] = size === 'folio' || size === 'thick' ? [size, 'folio', 'quarto', 'pocket'] : [size, 'quarto', 'pocket', 'pocket'];
    const n = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const s = i === 0 ? size : order[Math.min(i, order.length - 1)];
      const v = bookVariant(s, pick([0, 0, 0, 1, 1, 2] as Deco[]));
      const [w, h, t] = v.dims;
      if (py + t - y > clear - 0.02 || w > D - 0.02) break;
      const sc = R(0.93, 1.05);
      const flip = rand() < 0.3 ? Math.PI : 0;
      const lm = M(x + h0 / 2 + R(-0.015, 0.015), py, R(-0.015, 0.02), Math.PI / 2 + flip + R(-0.07, 0.07), R(-0.01, 0.01), R(-0.012, 0.012), sc);
      books.push({ v, m: pm.clone().multiply(lm), color: new THREE.Color(pick(LEATHER)).multiplyScalar(R(0.85, 1.1)) });
      py += t * sc + 0.001;
      void h;
    }
    x += h0 + R(0.015, 0.05);
  }
}

/** A wooden press with shelves and two doors (or none), packed with books. */
function armarium(b: Builder, parts: Parts, books: BookInst[], x: number, z: number, ry: number, W: number, Hh: number, anchor: Anchor, doors = true, collide = true) {
  const D = 0.46;
  const a = anchor(x, 0.6, z);
  const pm = M(x + a.x, a.y, z + a.z, ry);
  const P = (g: THREE.BufferGeometry, k = 'wood') => parts.add(k, g, pm);
  P(bx(W, Hh, 0.03, 0, Hh / 2, -D / 2 + 0.015));
  for (const s of [-1, 1]) P(bx(0.05, Hh, D, s * (W / 2 - 0.025), Hh / 2, 0));
  P(bx(W + 0.1, 0.07, D + 0.08, 0, Hh + 0.035, 0.01));
  P(bx(W + 0.04, 0.05, D + 0.03, 0, Hh - 0.02, 0.01));
  P(bx(W, 0.13, D, 0, 0.065, 0));
  const n = Math.max(3, Math.round((Hh - 0.3) / 0.44));
  const sp = (Hh - 0.2) / n;
  for (let i = 0; i < n; i++) {
    const y = 0.13 + i * sp;
    if (i > 0) P(bx(W - 0.1, 0.03, D - 0.05, 0, y + 0.015, 0.015, 0, 0, R(-0.008, 0.008)));
    fillShelf(books, parts, pm, W - 0.1, y + 0.03, sp - 0.035, D - 0.06);
  }
  if (doors) {
    // Leaves hung on iron straps; at least one stands open.
    const angs = [rand() < 0.75 ? R(1.3, 2.0) : 0, R(1.1, 2.1)];
    if (rand() < 0.5) angs.reverse();
    [-1, 1].forEach((s, i) => {
      const lw = W / 2 - 0.02, ang = angs[i] * -s;
      const hx = s * (W / 2 - 0.01), hz = D / 2 + 0.02;
      const cxl = hx - s * Math.cos(ang) * lw / 2, czl = hz + Math.sin(-ang * s) * lw / 2 * s;
      const lm = M(cxl, Hh / 2 - 0.02, czl, ang);
      parts.add('wood', bx(lw, Hh - 0.25, 0.03, 0, 0, 0), pm.clone().multiply(lm));
      for (const hy of [-0.6, 0.5]) parts.add('iron', bx(lw * 0.7, 0.04, 0.036, s * lw * 0.12, hy * (Hh - 0.25) / 1.1, 0), pm.clone().multiply(lm));
    });
  }
  if (collide) b.collideShape(new THREE.BoxGeometry(W, Hh, D).applyMatrix4(M(x, Hh / 2, z, ry)), 'wood');
}

/** Sloped writing desk (pulpitum) with the copy and its exemplar, tools, stool and candle. */
function desk(b: Builder, parts: Parts, m: ReturnType<typeof materials>, x: number, z: number, ry: number, anchor: Anchor, textId: string, spread: number, upto: number, group: THREE.Group) {
  const a = anchor(x, 0.4, z);
  const pm = M(x + a.x, a.y, z + a.z, ry);
  const P = (g: THREE.BufferGeometry, k = 'wood') => parts.add(k, g, pm);
  const W = 0.72, D = 0.52, slope = 0.42;
  for (const [lx, lz, lh] of [[-0.32, 0.2, 0.82], [0.32, 0.2, 0.84], [-0.32, -0.21, 1.02], [0.33, -0.21, 1.0]]) P(bx(0.05, lh, 0.05, lx, lh / 2, lz, R(-0.02, 0.02)));
  P(bx(W - 0.05, 0.025, D - 0.08, 0, 0.32, 0));
  const topY = 0.94;
  const tm = M(0, topY, 0, 0, slope);
  parts.add('wood', bx(W, 0.03, D, 0, 0, 0), pm.clone().multiply(tm));
  parts.add('wood', bx(W, 0.04, 0.025, 0, 0.025, D / 2 - 0.01), pm.clone().multiply(tm));
  // The copy: the open quire, half written.
  const tex = new THREE.CanvasTexture(spreadTexture(TEXTS.find((t) => t.id === textId)!, spread, 7 + spread, 768, upto));
  tex.colorSpace = THREE.SRGBColorSpace;
  const ob = openBook(0.2, 0.28, 0.018);
  const om = pm.clone().multiply(tm).multiply(M(0, 0.017, 0.02, 0));
  const pageMat = withAtmos(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), 'page-' + textId);
  const pageMesh = new THREE.Mesh(ob.pages, pageMat);
  pageMesh.userData.spread = { text: TEXTS.find((t) => t.id === textId)!, spread, seed: 7 + spread, px: 768, upto };
  pageMesh.applyMatrix4(om);
  group.add(pageMesh);
  parts.add('parch', ob.block, om);
  parts.add('leather', ob.boards, om);
  const text = TEXTS.find((t) => t.id === textId)!;
  readables.push({ pos: new THREE.Vector3(0, 0.05, 0).applyMatrix4(om), text, page: spread * 2, seed: 7 + spread, open: true });
  // Exemplar on a small stand at the desk's side.
  const sm = M(-W / 2 - 0.32, 0, -0.05, 0.25);
  parts.add('wood', bx(0.05, 1.05, 0.05, 0, 0.525, 0), pm.clone().multiply(sm));
  parts.add('wood', bx(0.3, 0.04, 0.3, 0, 0.02, 0), pm.clone().multiply(sm));
  const stm = pm.clone().multiply(sm).multiply(M(0, 1.08, 0, 0, 0.55));
  parts.add('wood', bx(0.48, 0.025, 0.34, 0, 0, 0), stm);
  const etex = new THREE.CanvasTexture(spreadTexture(text, spread, 3 + spread, 768, 1));
  etex.colorSpace = THREE.SRGBColorSpace;
  const eb = openBook(0.19, 0.27, 0.03);
  const em = stm.clone().multiply(M(0, 0.014, 0.01, 0));
  const emesh = new THREE.Mesh(eb.pages, withAtmos(new THREE.MeshStandardMaterial({ map: etex, roughness: 0.85 }), 'ex-' + textId));
  emesh.userData.spread = { text, spread, seed: 3 + spread, px: 768, upto: 1 };
  emesh.applyMatrix4(em);
  group.add(emesh);
  parts.add('parch', eb.block, em);
  parts.add('leather', eb.boards, em);
  readables.push({ pos: new THREE.Vector3(0, 0.05, 0).applyMatrix4(em), text, page: spread * 2, seed: 3 + spread, open: true });
  // Tools: inkhorn in its socket, quill, knife, ruler, pumice; wax tablets on the shelf.
  const tl = (g: THREE.BufferGeometry, k: string, lm: THREE.Matrix4) => parts.add(k, g, pm.clone().multiply(tm).multiply(lm));
  tl(new THREE.ConeGeometry(0.03, 0.13, 10), 'horn', M(W / 2 - 0.06, 0.06, -D / 2 + 0.07, 0, -slope - 0.2, 0.25));
  const quill = new THREE.ConeGeometry(0.012, 0.3, 6, 1, true);
  quill.scale(1, 1, 0.25);
  tl(quill, 'quill', M(W / 2 - 0.13, 0.03, 0.02, 0.2, Math.PI / 2 - 0.05, 0.4));
  tl(bx(0.004, 0.004, 0.16, 0, 0, 0), 'quill', M(W / 2 - 0.13, 0.025, 0.06, 0.2, 0, 0));
  tl(bx(0.015, 0.006, 0.17, 0, 0, 0), 'iron', M(-W / 2 + 0.07, 0.022, 0.06, -0.3));
  tl(bx(0.03, 0.008, 0.42, 0, 0, 0), 'wood', M(-W / 2 + 0.03, 0.022, 0, 0.02));
  tl(new THREE.SphereGeometry(0.025, 7, 5).scale(1.3, 0.7, 1), 'stone', M(W / 2 - 0.09, 0.025, 0.18, 0));
  for (let i = 0; i < 2; i++) {
    const wm = M(R(-0.15, 0.15), 0.345 + i * 0.016, R(-0.05, 0.05), R(-0.3, 0.3));
    parts.add('wood', bx(0.16, 0.014, 0.11, 0, 0, 0), pm.clone().multiply(wm));
    parts.add('wax', bx(0.13, 0.004, 0.085, 0, 0.007, 0), pm.clone().multiply(wm));
  }
  parts.add('iron', new THREE.CylinderGeometry(0.003, 0.002, 0.13, 5), pm.clone().multiply(M(0.1, 0.39, 0.02, 0, 0, Math.PI / 2 - 0.1)));
  // Three-legged stool on the scribe's side.
  const st = M(R(-0.08, 0.08), 0, D / 2 + 0.38, R(0, 2));
  parts.add('wood', new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12), pm.clone().multiply(st).multiply(M(0, 0.47, 0)));
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    parts.add('wood', new THREE.CylinderGeometry(0.018, 0.022, 0.48, 6), pm.clone().multiply(st).multiply(M(Math.sin(ang) * 0.11, 0.23, Math.cos(ang) * 0.11, 0, Math.cos(ang) * 0.15, -Math.sin(ang) * 0.15)));
  }
  // Candle on the desk's high corner (world coordinates before displacement, the Builder adds it).
  const cp = new THREE.Vector3(-W / 2 + 0.06, 0, -D / 2 + 0.05).applyMatrix4(M(x, topY + 0.1, z, ry));
  candle(b, cp.x, cp.y, cp.z, 0.24);
  b.collideShape(new THREE.BoxGeometry(W + 0.7, 1.0, D).applyMatrix4(M(x, 0.5, z, ry)), 'wood');
}

/** The great gospel book open on a tall lectern. */
function lectern(b: Builder, parts: Parts, m: ReturnType<typeof materials>, x: number, z: number, ry: number, anchor: Anchor, group: THREE.Group) {
  const a = anchor(x, 0.6, z);
  const pm = M(x + a.x, a.y, z + a.z, ry);
  const P = (g: THREE.BufferGeometry, k = 'wood') => parts.add(k, g, pm);
  P(bx(0.62, 0.08, 0.1, 0, 0.04, 0, 0.4));
  P(bx(0.1, 0.08, 0.56, 0.02, 0.04, 0, 0.4));
  P(new THREE.CylinderGeometry(0.06, 0.075, 1.12, 8).translate(0, 0.6, 0));
  const tm = M(0, 1.2, 0, 0, 0.5);
  parts.add('wood', bx(0.72, 0.035, 0.5, 0, 0, 0), pm.clone().multiply(tm));
  parts.add('wood', bx(0.72, 0.05, 0.03, 0, 0.03, 0.24), pm.clone().multiply(tm));
  const text = TEXTS.find((t) => t.id === 'iohannes')!;
  const tex = new THREE.CanvasTexture(spreadTexture(text, 0, 21, 1024, 1));
  tex.colorSpace = THREE.SRGBColorSpace;
  const ob = openBook(0.3, 0.42, 0.06);
  const om = pm.clone().multiply(tm).multiply(M(0, 0.02, -0.01, 0));
  const mesh = new THREE.Mesh(ob.pages, withAtmos(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), 'gospel'));
  mesh.userData.spread = { text, spread: 0, seed: 21, px: 1024, upto: 1 };
  mesh.applyMatrix4(om);
  group.add(mesh);
  parts.add('parch', ob.block, om);
  parts.add('leather', ob.boards, om);
  // Bronze bosses on the boards of the gospel book.
  for (const s of [-1, 1]) for (const bz of [-0.17, 0.17]) {
    parts.add('bronze', new THREE.SphereGeometry(0.014, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), om.clone().multiply(M(s * 0.5, -0.008, bz, 0, Math.PI)));
  }
  readables.push({ pos: new THREE.Vector3(0, 0.05, 0).applyMatrix4(om), text, page: 0, seed: 21, open: true });
  // Candles either side of the gospel.
  for (const s of [-1, 1]) {
    const cp = new THREE.Vector3(s * 0.55, 0, 0.15).applyMatrix4(M(x, 0, z, ry));
    b.box('bronze', 0.05, 1.25, 0.05, cp.x, 0, cp.z, 0, false);
    candle(b, cp.x, 1.25, cp.z, 0.3);
  }
  b.collideShape(new THREE.BoxGeometry(0.75, 1.3, 0.55).applyMatrix4(M(x, 0.65, z, ry)), 'wood');
  // Keep the textures fresh once the uncial font has arrived.
  void m;
}

function satchel(b: Builder, parts: Parts, wallX: number, y: number, z: number, anchor: Anchor) {
  const a = anchor(wallX, y, z);
  const pm = M(wallX + a.x, y + a.y, z + a.z, Math.PI / 2);
  // Peg in the wall, strap over it, the bag hanging against the plaster.
  parts.add('wood', new THREE.CylinderGeometry(0.02, 0.025, 0.16, 6), pm.clone().multiply(M(0, 0, 0.08, 0, Math.PI / 2)));
  const tilt = R(-0.08, 0.08);
  const bag = pm.clone().multiply(M(0, -0.4, 0.07, 0, 0, tilt));
  parts.add('leather', bx(0.3, 0.36, 0.08, 0, 0, 0), bag);
  parts.add('leather', bx(0.31, 0.17, 0.012, 0, 0.1, 0.046, 0, 0.12), bag);
  parts.add('bronze', new THREE.SphereGeometry(0.012, 6, 3), bag.clone().multiply(M(0, 0.03, 0.055)));
  for (const s of [-1, 1]) parts.add('leather', bx(0.02, 0.26, 0.008, s * 0.08, 0.3, 0.05, 0, 0, -s * 0.25), bag);
  void b;
}

function capsa(parts: Parts, x: number, z: number, anchor: Anchor) {
  const a = anchor(x, 0.2, z);
  const pm = M(x + a.x, a.y, z + a.z, R(0, 3));
  parts.add('wood', new THREE.CylinderGeometry(0.2, 0.21, 0.42, 16, 1, true), pm.clone().multiply(M(0, 0.21, 0)));
  parts.add('wood', new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16), pm.clone().multiply(M(0, 0.015, 0)));
  for (let i = 0; i < 7; i++) {
    const ang = rand() * Math.PI * 2, r = R(0, 0.12);
    const rr = R(0.025, 0.04), rl = R(0.36, 0.55);
    const lm = M(Math.sin(ang) * r, rl / 2 + 0.02, Math.cos(ang) * r, 0, R(-0.15, 0.15), R(-0.15, 0.15));
    parts.add('parch', new THREE.CylinderGeometry(rr, rr, rl, 10), pm.clone().multiply(lm));
    parts.add('wood', new THREE.CylinderGeometry(0.008, 0.008, rl + 0.06, 5), pm.clone().multiply(lm));
  }
}

function chest(b: Builder, parts: Parts, x: number, z: number, anchor: Anchor) {
  const a = anchor(x, 0.3, z);
  const pm = M(x + a.x, a.y, z + a.z, -Math.PI / 2 + 0.04);
  parts.add('wood', bx(0.95, 0.5, 0.5, 0, 0.25, 0), pm);
  parts.add('wood', bx(0.98, 0.06, 0.53, 0, 0.53, 0), pm);
  for (const s of [-0.3, 0.3]) parts.add('iron', bx(0.05, 0.6, 0.54, s, 0.28, 0), pm);
  b.collideShape(new THREE.BoxGeometry(0.98, 0.56, 0.53).applyMatrix4(M(x, 0.28, z, -Math.PI / 2)), 'wood');
}

// Closed books in the presses can be opened too: each gets a text, picked
// once the presses are filled (see registerClosedBooks).
function registerClosedBooks(group: THREE.Object3D) {
  const p = new THREE.Vector3(), mm = new THREE.Matrix4();
  group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || im.material !== mats?.leather || o.parent?.userData.secret) return;
    const g = im.geometry;
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, mm);
      p.copy(c).applyMatrix4(mm);
      const open = TEXTS.filter((t) => !SECRET_TEXTS.includes(t.id));
      const text = open[Math.floor(rand() * open.length)];
      readables.push({ pos: p.clone(), text, page: 0, seed: 100 + i, open: false });
    }
  });
}

/** Re-render the open books once the uncial font has loaded. */
function refreshWhenFontsReady(group: THREE.Object3D) {
  fontsReady().then(() => {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mt = mesh.material as THREE.MeshStandardMaterial | undefined;
      const t = mt?.map as THREE.CanvasTexture | undefined;
      const info = mesh.userData.spread as { text: Text; spread: number; seed: number; px: number; upto: number } | undefined;
      if (t && info) {
        t.image = spreadTexture(info.text, info.spread, info.seed, info.px, info.upto);
        t.needsUpdate = true;
      }
    });
  });
}

// ------------------------------------------------------------ the secret cabinet

/**
 * The hidden door: a full press standing in the partition's opening, hinged
 * on its west edge. Examined, it swings out into the library.
 */
const secret = { pivot: null as THREE.Group | null, angle: 0, target: 0, front: new THREE.Vector3(), box: new THREE.Box3() };
const OPEN_ANGLE = -1.45;

function secretDoor(group: THREE.Group, m: ReturnType<typeof materials>, anchor: Anchor) {
  const W = 1.32, Hh = 2.32, D = 0.46;
  const x = (OX0 + OX1) / 2, z = PZ + 0.225 + D / 2 + 0.01;
  const a = anchor(x, 0.6, z);
  const parts = new Parts();
  const books: BookInst[] = [];
  const dummy = { collideShape() {} } as unknown as Builder;
  armarium(dummy, parts, books, x, z, 0, W, Hh, anchor, true, false);
  const inner = new THREE.Group();
  addMeshes(parts, books, m, inner);
  // Pivot at the west edge; children keep their world coordinates.
  const hinge = new THREE.Vector3(x - W / 2 + a.x, a.y, z + a.z);
  const pivot = new THREE.Group();
  pivot.position.copy(hinge);
  inner.position.copy(hinge).negate();
  pivot.add(inner);
  pivot.userData.secret = true;
  inner.userData.secret = true;
  group.add(pivot);
  secret.pivot = pivot;
  secret.front.set(x + a.x, 1.3 + a.y, z + D / 2 + a.z);
  // Telltale scrape marks on the floor where the press has swung before.
  const P = new Parts();
  for (let i = 0; i < 9; i++) {
    const t = (i / 8) * -OPEN_ANGLE;
    const r = W * R(0.75, 0.98);
    P.add('iron', bx(0.18, 0.004, 0.012, 0, 0, 0), M(hinge.x + Math.cos(t) * r, a.y + 0.004, hinge.z + Math.sin(t) * r, -t + Math.PI / 2 + R(-0.2, 0.2)));
  }
  addMeshes(P, [], m, group);
  updateSecretBox();
}

function updateSecretBox() {
  if (!secret.pivot) return;
  secret.pivot.updateMatrixWorld(true);
  secret.box.setFromObject(secret.pivot);
}

export const isSecretDoorOpen = () => secret.angle < OPEN_ANGLE * 0.9;

/**
 * The hidden door is not in the static collider (it moves). Call this after
 * the player moves: it pushes a capsule of `radius` at eye position `p` out of
 * the door's current footprint. Returns true if it pushed.
 */
export function pushOutOfSecretDoor(p: THREE.Vector3, radius = 0.35): boolean {
  const b = secret.box;
  if (b.isEmpty() || p.y - 1.65 > b.max.y || p.y < b.min.y) return false;
  const x0 = b.min.x - radius, x1 = b.max.x + radius, z0 = b.min.z - radius, z1 = b.max.z + radius;
  if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1) return false;
  const dx0 = p.x - x0, dx1 = x1 - p.x, dz0 = p.z - z0, dz1 = z1 - p.z;
  const mn = Math.min(dx0, dx1, dz0, dz1);
  if (mn === dx0) p.x = x0; else if (mn === dx1) p.x = x1; else if (mn === dz0) p.z = z0; else p.z = z1;
  return true;
}

let glassMat: THREE.Material | null = null, mercuryMat: THREE.Material | null = null;
function cabinetMaterials() {
  if (glassMat) return { glass: glassMat, mercury: mercuryMat! };
  glassMat = withAtmos(new THREE.MeshPhysicalMaterial({ color: 0xa8c8a0, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 }), 'glass');
  // Quicksilver: the one shiny thing, mirroring a dim warm room.
  const env = canvasTex(64, 32, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#1a1410'); g.addColorStop(0.45, '#6b5034'); g.addColorStop(0.55, '#d9a860'); g.addColorStop(1, '#100c08');
    c.fillStyle = g; c.fillRect(0, 0, 64, 32);
  });
  env.mapping = THREE.EquirectangularReflectionMapping;
  mercuryMat = withAtmos(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06, envMap: env, envMapIntensity: 1.4 }), 'mercury');
  return { glass: glassMat, mercury: mercuryMat };
}

function labelTexture(words: string[]) {
  return canvasTex(256, 64 * words.length, (c) => {
    words.forEach((w, i) => {
      c.fillStyle = '#d8c59a'; c.fillRect(0, i * 64, 256, 64);
      c.fillStyle = 'rgba(110,80,40,0.25)'; c.fillRect(0, i * 64 + 56, 256, 8);
      c.fillStyle = '#3d2616';
      c.font = '34px "Cardo", serif';
      c.textAlign = 'center';
      c.fillText(w, 128, i * 64 + 44);
    });
  });
}

/**
 * Behind the press: a low vaulted room for the art of Zosimos and the
 * Alexandrians, come up from Byzantine Italy in Greek books. A small furnace,
 * cucurbit and glass ambix, a kerotakis, crucibles, jars of orpiment, cinnabar,
 * sulphur and quicksilver, scales, a mortar; the Greek codex open at the
 * serpent that eats its tail. (No astrolabe, no Latin alchemy: both came later.)
 */
function cabinet(b: Builder, parts: Parts, group: THREE.Group, anchor: Anchor) {
  const cm = cabinetMaterials();
  const lm = materials();
  const extra: THREE.Mesh[] = [];
  const at = (x: number, y: number, z: number) => { const a = anchor(x, 0.5, z); return new THREE.Vector3(x + a.x, y + a.y, z + a.z); };
  const put = (key: string, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => {
    const p = at(x, y, z);
    parts.add(key, g, M(p.x, p.y, p.z, ry, rx, rz));
  };
  const own = (g: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => {
    const p = at(x, y, z);
    const mesh = new THREE.Mesh(g, material);
    mesh.applyMatrix4(M(p.x, p.y, p.z, ry, rx, rz));
    extra.push(mesh);
    return mesh;
  };
  // Furnace against the north wall, a glowing mouth.
  const fx = -8.85, fz = IZ0 + 0.42;
  b.box('brick', 1.0, 0.95, 0.84, fx, -0.05, fz, 0.04);
  b.geo('brick', arcadeGeo(0.7, 0.55, 0.12, 1, 0.34, 0.2), fx, 0.05, fz + 0.43, 0.04, false);
  b.box('ember', 0.3, 0.1, 0.3, fx, 0.06, fz + 0.2, 0.04, false);
  b.lamp('candle', new THREE.Vector3(fx, 0.25, fz + 0.38), false, 'brazier', 0.25);
  // Cucurbit on the furnace, ambix above, spout down into a receiver.
  const cuc = new THREE.SphereGeometry(0.15, 14, 10); cuc.scale(1, 1.1, 1);
  put('clay', cuc, fx, 1.05, fz);
  put('clay', new THREE.CylinderGeometry(0.06, 0.08, 0.12, 10), fx, 1.25, fz);
  const amb = new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  own(amb, cm.glass, fx, 1.33, fz);
  own(new THREE.CylinderGeometry(0.018, 0.012, 0.55, 8, 1, true), cm.glass, fx + 0.27, 1.27, fz + 0.04, 0, 0, -1.15);
  own(new THREE.SphereGeometry(0.1, 14, 10), cm.glass, fx + 0.55, 1.0, fz + 0.06);
  put('wood', new THREE.CylinderGeometry(0.035, 0.05, 0.9, 6), fx + 0.55, 0.45, fz + 0.06);
  // Kerotakis on its own little stand: a sealed bronze vessel with the palette inside.
  put('clay', new THREE.CylinderGeometry(0.16, 0.13, 0.45, 12), -9.25, 0.225, -61.8);
  put('bronze', new THREE.CylinderGeometry(0.075, 0.075, 0.2, 12), -9.25, 0.55, -61.8);
  put('bronze', new THREE.SphereGeometry(0.075, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), -9.25, 0.65, -61.8);
  // Work table along the east wall.
  const tx = IX1 - 0.38, tz = -61.4, ty = 0.84;
  b.box('wood', 0.62, 0.05, 1.7, tx, ty - 0.05, tz, -0.03);
  for (const [dx, dz] of [[-0.25, -0.75], [0.25, -0.78], [-0.24, 0.76], [0.26, 0.74]]) b.box('wood', 0.06, ty - 0.05, 0.06, tx + dx, 0, tz + dz, 0, false);
  // Mortar and pestle, crucibles, scales, mineral lumps, quicksilver.
  put('stone', new THREE.CylinderGeometry(0.11, 0.08, 0.12, 14, 1, true), tx - 0.05, ty + 0.06, tz - 0.55);
  put('stone', new THREE.CylinderGeometry(0.08, 0.08, 0.02, 14), tx - 0.05, ty + 0.01, tz - 0.55);
  put('stone', new THREE.CylinderGeometry(0.02, 0.03, 0.22, 8), tx - 0.02, ty + 0.15, tz - 0.53, 0, 0.5, 0.3);
  for (let i = 0; i < 3; i++) put('clay', new THREE.CylinderGeometry(0.045, 0.028, 0.07, 9, 1, true), tx + R(-0.15, 0.1), ty + 0.035, tz - 0.25 + i * 0.12);
  put('bronze', bx(0.4, 0.012, 0.012, 0, 0, 0), tx - 0.1, ty + 0.42, tz + 0.15);
  put('bronze', new THREE.CylinderGeometry(0.01, 0.012, 0.42, 6), tx - 0.1, ty + 0.21, tz + 0.15);
  for (const s of [-1, 1]) {
    put('bronze', new THREE.CylinderGeometry(0.075, 0.07, 0.012, 14), tx - 0.1 + s * 0.19, ty + 0.17, tz + 0.15);
    for (let k = 0; k < 3; k++) put('iron', bx(0.003, 0.24, 0.003, 0, 0, 0), tx - 0.1 + s * 0.19 + Math.sin(k * 2.1) * 0.05, ty + 0.3, tz + 0.15 + Math.cos(k * 2.1) * 0.05, 0, Math.cos(k * 2.1) * 0.2, -Math.sin(k * 2.1) * 0.2);
  }
  const lumps: [number, number][] = [[0xd8a520, 4], [0xa3281a, 4], [0xe0d058, 3]];
  lumps.forEach(([c, n], li) => {
    const mtl = withAtmos(new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }), 'lump' + li);
    for (let k = 0; k < n; k++) {
      const g = new THREE.IcosahedronGeometry(R(0.018, 0.034), 0); g.scale(1, R(0.6, 0.9), R(0.8, 1.2));
      own(g, mtl, tx + R(-0.2, 0.15), ty + 0.02, tz + 0.45 + li * 0.1 + R(-0.03, 0.03), R(0, 3), R(0, 3));
    }
  });
  own(new THREE.SphereGeometry(0.06, 14, 10).scale(1, 1.25, 1), cm.glass, tx + 0.12, ty + 0.075, tz - 0.05);
  own(new THREE.SphereGeometry(0.042, 16, 10).scale(1, 0.75, 1), cm.mercury, tx + 0.12, ty + 0.035, tz - 0.05);
  own(new THREE.SphereGeometry(0.012, 10, 6).scale(1, 0.5, 1), cm.mercury, tx - 0.08, ty + 0.004, tz + 0.02);
  // Jars with Greek labels on a wall shelf.
  b.box('wood', 0.28, 0.04, 2.0, IX0 + 0.14, 1.45, -61.4, 0, false);
  const words = ['ΘΕΙΟΝ', 'ΚΙΝΝΑΒΑΡΙ', 'ΑΡΣΕΝΙΚΟΝ', 'ΥΔΡΑΡΓΥΡΟΣ', 'ΧΑΛΚΑΝΘΟΝ', 'ΝΙΤΡΟΝ'];
  const lt = labelTexture(words);
  words.forEach((w, i) => {
    const jz = -62.2 + i * 0.3 + R(-0.03, 0.03), jh = R(0.18, 0.28);
    put('clay', new THREE.CylinderGeometry(0.065, 0.075, jh, 12), IX0 + 0.14, 1.49 + jh / 2, jz);
    put('cloth', new THREE.CylinderGeometry(0.07, 0.068, 0.025, 12), IX0 + 0.14, 1.49 + jh + 0.01, jz);
    const g = new THREE.PlaneGeometry(0.11, 0.035);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setY(k, (words.length - 1 - i + uv.getY(k)) / words.length);
    own(g, withAtmos(new THREE.MeshStandardMaterial({ map: lt, roughness: 0.9 }), 'label'), IX0 + 0.14 + 0.077, 1.49 + jh * 0.55, jz, Math.PI / 2);
    void w;
  });
  // Two Greek books and the recipe book lie on the shelf's end.
  const shelfBooks: [string, Size][] = [['chrysopoeia', 'quarto'], ['compositiones', 'pocket']];
  shelfBooks.forEach(([id, size], i) => {
    const v = bookVariant(size, i === 0 ? 2 : 1);
    const p = at(IX0 + 0.14, 1.47, -60.55 + i * 0.32);
    const bm = M(p.x, p.y, p.z, R(-0.1, 0.1));
    const lea = new THREE.Mesh(v.leather, lm.leather);
    lea.material = lm.leather;
    const inst = new THREE.InstancedMesh(v.leather, lm.leather, 1);
    inst.setMatrixAt(0, bm); inst.setColorAt(0, new THREE.Color(i ? 0x6b4429 : 0x3a2a40));
    const par = new THREE.InstancedMesh(v.parch, lm.parch, 1);
    par.setMatrixAt(0, bm);
    group.add(inst, par);
    if (v.metal) { const mt = new THREE.InstancedMesh(v.metal, mat('bronze'), 1); mt.setMatrixAt(0, bm); group.add(mt); }
    readables.push({ pos: p.clone().add(new THREE.Vector3(0, 0.05, 0)), text: TEXTS.find((t) => t.id === id)!, page: 0, seed: 50 + i, open: false });
    void lea;
  });
  // Scattered quires on the floor and table.
  for (let i = 0; i < 5; i++) put('parch', bx(R(0.17, 0.24), 0.008, R(0.22, 0.3), 0, 0, 0), R(-9.2, -7.2), 0.005 + (i % 2) * 0.008, R(-62.4, -59.8), R(0, 3));
  // The Greek codex open on a slanted desk: Democritus, and the serpent.
  const dx = -8.75, dz = -60.0, dry = Math.PI / 2 + 0.12;
  const da = anchor(dx, 0.4, dz);
  const pm = M(dx + da.x, da.y, dz + da.z, dry);
  for (const [lx, lz, lh] of [[-0.28, 0.18, 0.86], [0.28, 0.18, 0.86], [-0.28, -0.18, 1.04], [0.28, -0.18, 1.04]]) parts.add('wood', bx(0.05, lh, 0.05, lx, lh / 2, lz), pm);
  const tm = M(0, 0.98, 0, 0, 0.45);
  parts.add('wood', bx(0.64, 0.03, 0.48, 0, 0, 0), pm.clone().multiply(tm));
  parts.add('wood', bx(0.64, 0.04, 0.025, 0, 0.025, 0.23), pm.clone().multiply(tm));
  const text = TEXTS.find((t) => t.id === 'physika')!;
  const tex = new THREE.CanvasTexture(spreadTexture(text, 0, 61, 1024, 1));
  tex.colorSpace = THREE.SRGBColorSpace;
  const ob = openBook(0.2, 0.28, 0.03);
  const om = pm.clone().multiply(tm).multiply(M(0, 0.017, 0.01, 0));
  const page = new THREE.Mesh(ob.pages, withAtmos(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), 'physika'));
  page.userData.spread = { text, spread: 0, seed: 61, px: 1024, upto: 1 };
  page.applyMatrix4(om);
  extra.push(page);
  parts.add('parch', ob.block, om);
  parts.add('leather', ob.boards, om);
  readables.push({ pos: new THREE.Vector3(0, 0.05, 0).applyMatrix4(om), text, page: 0, seed: 61, open: true });
  b.collideShape(new THREE.BoxGeometry(0.7, 1.05, 0.5).applyMatrix4(M(dx, 0.52, dz, dry)), 'wood');
  const cp = new THREE.Vector3(0.27, 0, -0.18).applyMatrix4(M(dx, 1.08, dz, dry));
  candle(b, cp.x, cp.y, cp.z, 0.2);
  lucerna(b, tx + 0.15, ty, tz + 0.75, -Math.PI / 2);
  // Cobwebs in the corners of the vault.
  const web: number[] = [];
  for (const [cx, cy, cz, sx, sz] of [[IX0, 1.95, IZ0, 1, 1], [IX1, 1.95, IZ0, -1, 1], [IX0, 1.95, PZ - 0.23, 1, -1], [IX1, 1.6, -61.0, -1, 1]] as const) {
    const o = at(cx, cy, cz);
    const rays = 6;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < rays; k++) {
      const t = (k / (rays - 1)) * Math.PI / 2;
      const p = o.clone().add(new THREE.Vector3(Math.cos(t) * 0.45 * sx, -Math.sin(t) * 0.4 - 0.02, (1 - Math.cos(t)) * 0.12 * sz));
      pts.push(p);
      web.push(o.x, o.y, o.z, p.x, p.y, p.z);
    }
    for (const f of [0.3, 0.55, 0.8]) for (let k = 0; k < rays - 1; k++) {
      const a = o.clone().lerp(pts[k], f), c = o.clone().lerp(pts[k + 1], f * R(0.9, 1.1));
      web.push(a.x, a.y, a.z, c.x, c.y, c.z);
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(web, 3));
  group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xd8d0c0, transparent: true, opacity: 0.22 })));
  for (const e of extra) group.add(e);
}

// ------------------------------------------------------------ interaction

let lastT = 0;
/** Animate the hidden door; returns true if the player is looking at it close enough to examine it. */
function secretDoorTick(camPos: THREE.Vector3, camDir: THREE.Vector3) {
  const now = performance.now() / 1000;
  const dt = lastT ? Math.min(0.1, now - lastT) : 0;
  lastT = now;
  if (secret.pivot && secret.angle !== secret.target) {
    const d = secret.target - secret.angle;
    const step = Math.sign(d) * Math.min(Math.abs(d), dt * (0.5 + 1.2 * Math.abs(d)));
    secret.angle += step;
    secret.pivot.rotation.y = secret.angle;
    updateSecretBox();
  }
  if (!secret.pivot) return false;
  tmp.subVectors(secret.front, camPos);
  const d = tmp.length();
  return d < 2.0 && tmp.dot(camDir) / d > 0.8;
}
