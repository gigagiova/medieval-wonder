import * as THREE from 'three';
import { withAtmos } from './rig';

// Cloth and leather for the townsfolk, from photo-scanned CC0 sets (Poly
// Haven; see tools/fetch-fabric.ts and public/textures/fabric/CREDITS.md).
//
// Each kind has two small maps shared by every person: a greyscale detail map
// (the scan's luminance, high-passed; the dye colour is multiplied in, so one
// scan serves every colour) and a two-channel normal map. They are laid on
// with biplanar projection in the garment's bind pose (metres), so the threads
// keep a true size (~2-3 mm) on every piece, never stretch across the
// garments' wrap-around seams, and stay put on the cloth as it is skinned or
// simulated: the cloth's tangent frame is rebuilt per pixel from screen-space
// derivatives of those coordinates.
//
// Wool, linen and felt scatter light: there is no glossy lobe at all (the
// specular is all but removed, which is what made the old cloth read as
// nylon), only a faint dye-coloured fuzz at grazing angles, as loose fibres
// catch the light on a silhouette.

export type FabricKind = 'tabby' | 'twill' | 'felt' | 'linen' | 'leather';

/** Per kind: metres per texture repeat, detail contrast, normal strength, roughness, fuzz, and how much specular survives. */
const KINDS: Record<FabricKind, { tile: number; contrast: number; nrm: number; rough: number; fuzz: number; spec: number }> = {
  tabby: { tile: 0.34, contrast: 1.25, nrm: 1.3, rough: 1.0, fuzz: 0.3, spec: 0.05 },
  twill: { tile: 0.4, contrast: 1.1, nrm: 1.1, rough: 1.0, fuzz: 0.3, spec: 0.05 },
  felt: { tile: 0.3, contrast: 1.3, nrm: 0.8, rough: 1.0, fuzz: 0.4, spec: 0.04 },
  linen: { tile: 0.36, contrast: 1.0, nrm: 0.9, rough: 0.95, fuzz: 0.15, spec: 0.08 },
  leather: { tile: 0.4, contrast: 0.8, nrm: 0.7, rough: 0.78, fuzz: 0.0, spec: 0.35 },
};

const inBrowser = typeof document !== 'undefined';
const loader = inBrowser ? new THREE.TextureLoader() : null;
const sets = new Map<FabricKind, Record<string, { value: unknown }>>();
function load(path: string, format: THREE.PixelFormat) {
  if (!loader) return new THREE.Texture();
  const t = loader.load(path, undefined, undefined, () => console.warn('texture failed', path));
  t.format = format; // one channel (detail) or two (normal XY): a quarter / half of RGBA's memory
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
/** The uniforms of one kind: its two maps (loaded once, shared by everyone) and its numbers. */
function kindUniforms(kind: FabricKind): Record<string, { value: unknown }> {
  let u = sets.get(kind);
  if (!u) {
    const k = KINDS[kind];
    u = {
      tFabD: { value: load(`textures/fabric/${kind}_d.webp`, THREE.RedFormat) },
      tFabN: { value: load(`textures/fabric/${kind}_n.webp`, THREE.RGFormat) },
      uFab: { value: new THREE.Vector4(1 / k.tile, k.contrast, k.nrm, k.fuzz) },
      uFabSpec: { value: k.spec },
    };
    sets.set(kind, u);
  }
  return u;
}

/** One kind's shared maps: `detail` (R: albedo gain x 0.5) and `normal` (RG: OpenGL normal XY). */
export function fabricTextures(kind: FabricKind) {
  const u = kindUniforms(kind);
  return { detail: u.tFabD.value as THREE.Texture, normal: u.tFabN.value as THREE.Texture, tile: KINDS[kind].tile };
}

const FABRIC_GLSL = /* glsl */ `
uniform sampler2D tFabD; uniform sampler2D tFabN;
uniform vec4 uFab; // 1/tile, contrast, normal strength, fuzz
uniform float uFabSpec;
varying vec3 vFab; varying vec3 vFabN;
// One planar projection: detail and normal XY (strength applied).
void fabTap(vec2 uv, out float d, out vec2 n){
  d = texture2D(tFabD, uv).r * 2.0;
  n = (texture2D(tFabN, uv).rg * 2.0 - 1.0) * uFab.z;
}
// Tangent frame from screen derivatives of a projection's uv (three's getTangentFrame).
vec3 fabPerturb(vec2 uv, vec2 n, vec3 N, vec3 eye){
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, N), q0p = cross(N, q0);
  vec3 T = q1p * st0.x + q0p * st1.x;
  vec3 B = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return T * (n.x * s) + B * (n.y * s);
}
`;

export interface FabricOpts {
  /**
   * Where the weave is laid: 'rest' (default) biplanar on the bind-pose
   * attributes `rest`/`restN` (cloth.ts gives both the skinned and the
   * simulated garment mesh those); 'position' biplanar on the mesh's own
   * position/normal, for meshes that are only skinned or rigid (hose, shoes,
   * props), in metres; 'uv' the mesh's own UVs (e.g. downloaded clothing),
   * repeated `uvRepeat` times.
   */
  attr?: 'rest' | 'position' | 'uv';
  uvRepeat?: number;
  /** Multiply by vertex colours (garments bake mud at the hem into them). Default: on for 'rest'. */
  vertexColors?: boolean;
  side?: THREE.Side;
  /** Linen leg wraps wound over the hose between knee and ankle (bind-pose heights). */
  wraps?: { knee: number; ankle: number; color: THREE.Color };
}

/** A cloth or leather material in a dye colour: matte, fibrous, with the scanned weave at true size. */
export function fabric(kind: FabricKind, color: THREE.ColorRepresentation, o: FabricOpts = {}) {
  const k = KINDS[kind];
  const mode = o.attr ?? 'rest', rest = mode === 'rest';
  const m = withAtmos(new THREE.MeshStandardMaterial({
    color, roughness: k.rough, metalness: 0, side: o.side ?? THREE.DoubleSide, vertexColors: o.vertexColors ?? rest,
  }), o.wraps ? { wraps: o.wraps } : {});
  const atmos = m.onBeforeCompile, atmosKey = m.customProgramCacheKey();
  const uniforms = { ...kindUniforms(kind) };
  if (mode === 'uv') uniforms.uFab = { value: (uniforms.uFab.value as THREE.Vector4).clone().setX(o.uvRepeat ?? 4) };
  m.onBeforeCompile = (sh, r) => {
    atmos.call(m, sh, r);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFab; varying vec3 vFabN;
        ${rest ? 'attribute vec3 rest; attribute vec3 restN;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        ${mode === 'uv' ? 'vFab = vec3(uv, 0.0); vFabN = vec3(0.0, 0.0, 1.0);' : rest ? 'vFab = rest; vFabN = restN;' : 'vFab = position; vFabN = normal;'}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FABRIC_GLSL}`)
      // Biplanar lookup in the bind pose: the two projections the surface
      // faces most, weights sharpened so the blend band stays narrow. Warp
      // runs along bind-pose up on everything that hangs.
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        vec3 fP = vFab * uFab.x;
        vec3 fA = abs(normalize(vFabN));
        ivec3 fMa = (fA.x > fA.y && fA.x > fA.z) ? ivec3(0,1,2) : (fA.y > fA.z) ? ivec3(1,2,0) : ivec3(2,0,1);
        ivec3 fMi = (fA.x < fA.y && fA.x < fA.z) ? ivec3(0,1,2) : (fA.y < fA.z) ? ivec3(1,2,0) : ivec3(2,0,1);
        ivec3 fMe = ivec3(3) - fMi - fMa;
        vec2 fUv1 = fMa.x == 0 ? fP.zy : fMa.x == 1 ? fP.xz : fP.xy;
        vec2 fUv2 = fMe.x == 0 ? fP.zy : fMe.x == 1 ? fP.xz : fP.xy;
        fUv2 += vec2(0.37, 0.61);
        vec2 fW = vec2(fA[fMa.x], fA[fMe.x]);
        fW = clamp((fW - 0.5773) / (1.0 - 0.5773), 0.0, 1.0);
        fW = pow(fW, vec2(6.0));
        fW /= fW.x + fW.y + 1e-5;
        float fD1, fD2 = 1.0; vec2 fN1, fN2 = vec2(0.0);
        fabTap(fUv1, fD1, fN1);
        if (fW.y > 0.01) fabTap(fUv2, fD2, fN2); else fW = vec2(1.0, 0.0);
        float fD = fD1 * fW.x + fD2 * fW.y;
        // Slow, irregular unevenness of a hand-spun, hand-dyed cloth: breaks up repeats too.
        vec4 fNz = texture2D(uNoise, (vFab.xy + vFab.zx * 0.7) * 0.9);
        fD *= 0.9 + 0.2 * fNz.r;
        diffuseColor.rgb *= max(mix(1.0, fD, uFab.y), 0.0);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), fNz.g * 0.6);
        // Hollows between threads are rougher still than their crowns.
        roughnessFactor = clamp(roughnessFactor * (1.06 - 0.12 * fD), 0.0, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 fEye = -vViewPosition;
          vec3 fPert = fabPerturb(fUv1, fN1, normal, fEye) * fW.x;
          if (fW.y > 0.0) fPert += fabPerturb(fUv2, fN2, normal, fEye) * fW.y;
          normal = normalize(normal + fPert);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // No glossy lobe on wool and linen; a soft fibre fuzz on the silhouette instead.
          reflectedLight.directSpecular *= uFabSpec;
          reflectedLight.indirectSpecular *= uFabSpec;
          float fz = pow(1.0 - saturate(dot(geometryNormal, normalize(vViewPosition))), 3.0) * uFab.w;
          reflectedLight.indirectDiffuse *= 1.0 + fz;
          reflectedLight.directDiffuse *= 1.0 + fz * 0.6;
        }`);
  };
  m.customProgramCacheKey = () => `fab-${mode}-${atmosKey}`;
  return m;
}
