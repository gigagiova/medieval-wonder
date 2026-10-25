import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

// GPU-compressed surface textures. Every scanned set is also shipped as
// KTX2 (Basis: albedo ETC1S, normal and packed maps UASTC), which the
// transcoder (public/basis/) turns into whatever the GPU reads natively
// (ASTC on iPhones, ETC2 on most Android, BC on desktops): about a quarter of
// the video memory and of the bandwidth of plain RGBA, with the same look.
// The texture object handed out at import time is filled in place once the
// data arrives, so materials can hold it from the start. If anything about
// KTX2 fails (no transcoder, a file the host would not serve, an old
// browser), the same object is filled from the WebP instead.

let resolveRenderer: (r: THREE.WebGLRenderer) => void = () => {};
const rendererReady = new Promise<THREE.WebGLRenderer>((res) => { resolveRenderer = res; });
let loader: Promise<KTX2Loader | null> | null = null;
/** ?noktx2 forces the WebP path (for comparisons). */
const disabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noktx2');

/** Main calls this as soon as the renderer exists (KTX2 needs it to pick a GPU format). */
export function setKtx2Renderer(r: THREE.WebGLRenderer) { resolveRenderer(r); Object.assign(window, { __ktx2: ktx2Stats }); }

function getLoader() {
  // Pages that never hand over a renderer (the test pages) get the WebP.
  const late = new Promise<null>((res) => setTimeout(() => res(null), 4000));
  if (!loader) loader = Promise.race([rendererReady, late]).then(async (r) => {
    if (!r) return null;
    const l = new KTX2Loader().setTranscoderPath('basis/').setWorkerLimit(2);
    l.detectSupport(r);
    return l;
  }).catch((e) => { console.warn('KTX2 unavailable', e); return null; });
  return loader;
}

export const ktx2Stats = { ktx2: 0, webp: 0, filled: [] as THREE.Texture[] };
/**
 * The published game is served by a host that only serves common web types
 * (.ktx2 is refused, .wasm is served byte for byte), so the KTX2 files are
 * named <set>_<map>.ktx2.wasm. They are plain KTX2 inside.
 */
const KTX2_EXT = '.ktx2.wasm';

/**
 * Fill `tex` from `base`.ktx2.wasm, else from `base`.webp. `srgb` is the colour
 * space of the WebP fallback (the KTX2 file carries its own).
 */
export async function fillTexture(tex: THREE.Texture, base: string, srgb: boolean): Promise<void> {
  const k = disabled ? null : await getLoader();
  if (k) {
    try {
      const c = await k.loadAsync(base + KTX2_EXT);
      const t = tex as THREE.Texture & { isCompressedTexture?: boolean; mipmaps: unknown[] };
      // Become the compressed texture: same object, the materials keep it.
      t.isCompressedTexture = true;
      t.image = c.image;
      t.mipmaps = c.mipmaps;
      t.format = c.format;
      t.type = c.type;
      t.colorSpace = c.colorSpace;
      t.generateMipmaps = false;
      t.flipY = false; // the files are stored flipped, matching the WebP's upload
      t.minFilter = c.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      // Once on the GPU, the CPU copy of the blocks (~1.4 MB a map) can go.
      t.onUpdate = () => { t.mipmaps = []; t.onUpdate = null; };
      t.needsUpdate = true;
      ktx2Stats.ktx2++;
      ktx2Stats.filled.push(t);
      return;
    } catch (e) {
      console.warn('KTX2 failed, using WebP:', base, e);
    }
  }
  const img = await new THREE.ImageLoader().loadAsync(base + '.webp');
  tex.image = img;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  ktx2Stats.webp++;
}
