// Impostor baker (dev page tools/trees/bake.html, driven by tools/trees/bake-impostors.cjs).
// Renders each tree of IMPOSTORS from COLS directions around it, orthographic and level,
// with the game's own bark/leaf materials in bake mode: albedo (sRGB, alpha) and
// view-space normals. One row per tree, one column per direction.
import * as THREE from 'three';
import { loadTreePack } from '../../src/vegetation/pack';
import { barkMaterial, leafMaterial, vegUniforms } from '../../src/vegetation/materials';

const IMPOSTORS = ['oakL1', 'oakL2', 'oakL3', 'oakB1', 'oakB3', 'oakB4', 'oakM1', 'oakM2', 'oakM3', 'oakS1', 'oakS2', 'ancient', 'twisted', 'snag', 'poplar'];
const COLS = 8, ROWS = 16, CELL = 96, W = COLS * CELL, H = ROWS * CELL;

const pack = await loadTreePack();
vegUniforms.uWind.value = 0;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);
renderer.setScissorTest(true);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
const out: Record<string, { row: number; w: number; h: number; y0: number }> = {};

function pass(bake: 1 | 2): string {
  const bm = barkMaterial(pack, bake), lm = leafMaterial(pack, bake);
  renderer.outputColorSpace = bake === 1 ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  renderer.setScissor(0, 0, W, H);
  renderer.setViewport(0, 0, W, H);
  renderer.clear();
  IMPOSTORS.forEach((id, row) => {
    const t = pack.trees[pack.byId.get(id)!];
    const [b, l] = t.lods[0];
    scene.clear();
    if (b >= 0) scene.add(new THREE.Mesh(pack.geos[b]!, bm));
    if (l >= 0) scene.add(new THREE.Mesh(pack.geos[l]!, lm));
    // frame: the crown's full width, from just below the foot to the top
    const R = t.crown * 1.02, y0 = Math.min(t.bb[1], -0.2), h = t.bb[4] - y0 + 0.3;
    out[id] = { row, w: 2 * R, h, y0 };
    for (let c = 0; c < COLS; c++) {
      const a = (c / COLS) * Math.PI * 2;
      cam.left = -R; cam.right = R; cam.top = h / 2; cam.bottom = -h / 2;
      cam.position.set(Math.sin(a) * 200, y0 + h / 2, Math.cos(a) * 200);
      cam.lookAt(0, y0 + h / 2, 0);
      cam.updateProjectionMatrix();
      const x = c * CELL, y = H - (row + 1) * CELL;
      renderer.setViewport(x, y, CELL, CELL);
      renderer.setScissor(x, y, CELL, CELL);
      renderer.render(scene, cam);
    }
  });
  // Bleed the colour of the edges out into the transparent texels (mip-mapping
  // would otherwise pull in black halos), keeping their alpha at 0.
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.drawImage(renderer.domElement, 0, 0);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  for (let it = 0; it < 12; it++) {
    const next = filled.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (filled[i]) continue;
      let r = 0, gg = 0, bb = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        // stay inside the cell
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || Math.floor(xx / CELL) !== Math.floor(x / CELL) || Math.floor(yy / CELL) !== Math.floor(y / CELL)) continue;
        const j = yy * W + xx;
        if (!filled[j]) continue;
        r += d[j * 4]; gg += d[j * 4 + 1]; bb += d[j * 4 + 2]; n++;
      }
      if (n) { d[i * 4] = r / n; d[i * 4 + 1] = gg / n; d[i * 4 + 2] = bb / n; next[i] = 1; }
    }
    filled.set(next);
  }
  g.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

const albedo = pass(1);
const normal = pass(2);
(window as unknown as { __bake: unknown }).__bake = { albedo, normal, json: { cols: COLS, rows: ROWS, size: [W, H], trees: out } };
