import * as THREE from 'three';
import { shared } from '../materials';
import { atmosGLSL, noiseGLSL } from '../shaders';
import type { TreePack } from './pack';

// Materials for the trees: one bark material and one leaf material for every
// tree (BatchedMesh: one draw call each), and one impostor material.
//
// Per instance (BatchedMesh colour, a float texture): r = brightness tint,
// g = leaf season (integer part: 0 late autumn, 1 dead brown leaves, 2 bare
// twigs) + hue shift (fraction), b = fade band: fade-in start * 1024 +
// fade-out end, in metres (1023 = none). LODs and impostors switch outright,
// with hysteresis, in the fog (a screen-door cross-fade, without TAA to
// resolve it, read as a stippled flaw); the band is there for a tree that
// has to melt away at the edge of its range.
//
// BAKE: 1 albedo, 2 normal (view space) for the impostor baker.

export const vegUniforms = {
  uFade: { value: 3 },
  uWind: { value: 1 },
};

const commonVert = /* glsl */ `
  attribute float aKind;
  uniform float uWind; uniform float uTime;
  varying vec3 vWPosV; varying vec3 vTint; varying float vDist; varying float vKind; varying vec2 vUvT;
`;
const commonFrag = /* glsl */ `
  varying vec3 vWPosV; varying vec3 vTint; varying float vDist; varying float vKind; varying vec2 vUvT;
  uniform float uFade;
  float bayer4(vec2 p){
    ivec2 q = ivec2(mod(p, 4.0));
    int i = q.x + q.y * 4;
    int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
    return (float(m[i]) + 0.5) / 16.0;
  }
  // Screen-door LOD cross-fade: keep the fragment if it belongs to this LOD at this distance.
  bool lodKeep(float band, float d){
    float inS = floor(band / 1024.0), outE = band - inS * 1024.0;
    float th = bayer4(gl_FragCoord.xy);
    if (inS > 0.5 && th >= clamp((d - (inS - uFade)) / uFade, 0.0, 1.0)) return false;
    if (th < clamp((d - (outE - uFade)) / uFade, 0.0, 1.0)) return false;
    return true;
  }
  vec3 hueTint(vec3 c, float t, float h){
    // h in 0..1: 0.5 neutral, below cooler/greyer, above warmer.
    vec3 warm = c * vec3(1.08, 1.0, 0.86), cool = c * vec3(0.92, 0.98, 1.04);
    return (h < 0.5 ? mix(cool, c, h * 2.0) : mix(c, warm, h * 2.0 - 1.0)) * t;
  }
`;

/** Shared vertex hooks: instance tint/fade from the batching colour, distance, wind sway. */
function vertexHooks(sh: THREE.WebGLProgramParametersWithUniforms, leaf: boolean) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${commonVert}`)
    .replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      vec3 ip = vec3(0.0);
      #ifdef USE_BATCHING
        ip = batchingMatrix[3].xyz;
        vTint = getBatchingColor(getIndirectIndex(gl_DrawID));
      #else
        vTint = vec3(1.0, 0.5, 1023.0);
      #endif
      vKind = aKind; vUvT = uv;
      {
        // Wind: the whole crown leans and swings slowly; twigs flutter.
        float ph = dot(ip.xz, vec2(0.21, 0.17));
        float h = max(transformed.y, 0.0);
        float t = uTime;
        vec2 sw = vec2(sin(t * 0.61 + ph) + 0.4 * sin(t * 1.37 + ph * 2.3), sin(t * 0.47 + ph * 1.7) + 0.4 * sin(t * 1.13 + ph)) * h * h * 0.00022 * uWind;
        transformed.xz += sw;
        ${leaf ? 'transformed += vec3(sin(t * 3.1 + dot(position, vec3(2.1, 1.7, 2.9))), sin(t * 2.3 + dot(position, vec3(1.3, 2.9, 1.1))) * 0.6, sin(t * 2.7 + dot(position, vec3(2.7, 1.1, 1.9)))) * 0.035 * clamp(h * 0.15, 0.0, 1.0) * uWind;' : ''}
      }`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          wp = batchingMatrix * wp;
        #endif
        vWPosV = (modelMatrix * wp).xyz;
        vDist = distance(cameraPosition, (modelMatrix * vec4(ip, 1.0)).xyz);
      }`);
}

function fragmentCommon(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${commonFrag}\n${noiseGLSL}\n${atmosGLSL}`)
    .replace('#include <color_fragment>', '')
    .replace('#include <fog_fragment>', `
      #if BAKE == 0
        gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPosV);
      #endif`);
}

/** Bark: every tree's wood from one atlas of tileable barks; the tile is per vertex (aKind). */
export function barkMaterial(p: TreePack, bake = 0): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, side: THREE.FrontSide });
  m.envMapIntensity = 0;
  (m as unknown as { defines: Record<string, number> }).defines = { BAKE: bake };
  m.customProgramCacheKey = () => 'veg-bark-' + bake;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, vegUniforms, { tBark: { value: p.tex.bark }, tBarkN: { value: p.tex.barkN }, uTiles: { value: p.barkTiles } });
    vertexHooks(sh, false);
    fragmentCommon(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tBark; uniform sampler2D tBarkN; uniform vec4 uTiles[4];
        vec2 tileUV(vec2 uv, vec4 r){ return r.xy + (0.001 + fract(uv) * 0.998) * r.zw; }`)
      .replace('#include <map_fragment>', `
        #if BAKE == 0
          if (!lodKeep(vTint.b, vDist)) discard;
        #endif
        vec4 tile = uTiles[int(vKind + 0.5)];
        vec2 tuv = tileUV(vUvT, tile);
        vec2 gdx = dFdx(vUvT) * tile.zw, gdy = dFdy(vUvT) * tile.zw;
        vec3 alb = textureGrad(tBark, tuv, gdx, gdy).rgb;
        // Wet, dark, a little moss low down and on the up-facing sides.
        float lum = dot(alb, vec3(0.3, 0.5, 0.2));
        alb = mix(alb, vec3(lum), 0.25) * 0.62;
        diffuseColor.rgb = hueTint(alb, vTint.r, fract(vTint.g));`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 tn = textureGrad(tBarkN, tuv, gdx, gdy).xyz * 2.0 - 1.0;
          tn.xy *= 1.2;
          // cotangent frame from screen derivatives (the tiling uv, not the atlas uv)
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vUvT), st1 = dFdy(vUvT);
          vec3 N = normal;
          vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float sc = det == 0.0 ? 0.0 : inversesqrt(det);
          normal = normalize(mat3(T * sc, B * sc, N) * tn);
        }
        #if BAKE == 1
          gl_FragColor = vec4(diffuseColor.rgb, 1.0); return;
        #elif BAKE == 2
          gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0); return;
        #endif`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.95;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.3; reflectedLight.indirectSpecular *= 0.3;`);
  };
  return m;
}

/** Leaves and twig cards: alpha-tested, double-sided; the season picks the texture per instance. */
export function leafMaterial(p: TreePack, bake = 0): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.envMapIntensity = 0;
  (m as unknown as { defines: Record<string, number> }).defines = { BAKE: bake };
  m.customProgramCacheKey = () => 'veg-leaf-' + bake;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, vegUniforms, { tLeafA: { value: p.tex.leafA }, tLeafB: { value: p.tex.leafB } });
    vertexHooks(sh, true);
    fragmentCommon(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tLeafA; uniform sampler2D tLeafB;`)
      .replace('#include <map_fragment>', `
        #if BAKE == 0
          if (!lodKeep(vTint.b, vDist)) discard;
        #endif
        float season = floor(vTint.g);
        vec4 lc;
        vec2 ts;
        if (vKind > 0.5) { lc = texture(tLeafB, vUvT); ts = vec2(textureSize(tLeafB, 0)) * vec2(0.5, 1.0); }
        else if (season > 0.5 && season < 1.5) { lc = texture(tLeafB, vUvT * vec2(0.5, 1.0)); ts = vec2(textureSize(tLeafB, 0)) * vec2(0.5, 1.0); }
        else { lc = texture(tLeafA, vUvT); ts = vec2(textureSize(tLeafA, 0)); }
        // Bare: keep the twigs, drop the yellow leaves.
        if (season > 1.5 && vKind < 0.5 && lc.r - lc.b > 0.09) lc.a = 0.0;
        // Alpha keeps its coverage down the mip chain (otherwise far crowns thin out to nothing).
        vec2 tdx = dFdx(vUvT * ts), tdy = dFdy(vUvT * ts);
        float mip = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
        float a = lc.a * (1.0 + mip * 0.22);
        if (a < 0.5) discard;
        vec3 alb = lc.rgb * 0.8;
        // Poplar cards are summer green: turn them to November's yellow-brown.
        if (vKind > 0.5) { float l = dot(alb, vec3(0.3, 0.55, 0.15)); alb = mix(vec3(l), vec3(l) * vec3(1.45, 1.05, 0.42), 0.85); }
        diffuseColor.rgb = hueTint(alb, vTint.r, fract(vTint.g));`)
      .replace('#include <normal_fragment_maps>', `
        // Cards: bend the normal toward up so a crown is lit as a mass, not as flat planes.
        normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, 0.45));
        #if BAKE == 1
          gl_FragColor = vec4(diffuseColor.rgb, 1.0); return;
        #elif BAKE == 2
          gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0); return;
        #endif`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.9;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.2; reflectedLight.indirectSpecular *= 0.2;
        // a little light through the leaves
        reflectedLight.indirectDiffuse *= 1.15;`);
  };
  return m;
}

/**
 * Impostors: a camera-facing quad per tree (turning about its own vertical
 * axis), showing the baked view nearest the camera's direction (8 around).
 * Instance attributes: aImp = (atlas row, tree yaw, unused, far fade-out end),
 * aImpT = (tint, hue).
 */
export function impostorMaterial(p: TreePack): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.envMapIntensity = 0;
  m.customProgramCacheKey = () => 'veg-impostor';
  const imp = p.imp!;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, vegUniforms, { tImp: { value: p.tex.imp }, tImpN: { value: p.tex.impN }, uGrid: { value: new THREE.Vector2(imp.cols, imp.rows) } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aImp; attribute vec2 aImpT;
        uniform vec2 uGrid;
        varying vec3 vWPosV; varying float vDist; varying vec2 vIUv; varying vec4 vFrame; varying vec3 vRight; varying vec3 vFwd; varying vec2 vTintI; varying vec2 vBand;`)
      .replace('#include <beginnormal_vertex>', `
        vec3 ipos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec2 toCam = cameraPosition.xz - ipos.xz;
        toCam = length(toCam) > 1e-4 ? normalize(toCam) : vec2(0.0, 1.0);
        vec3 right = vec3(toCam.y, 0.0, -toCam.x);
        vec3 objectNormal = vec3(toCam.x, 0.0, toCam.y);
        vRight = right; vFwd = objectNormal;
        // Which baked views: the camera's azimuth in the tree's own frame.
        float f = mod((atan(toCam.x, toCam.y) - aImp.y) / 6.2831853 * uGrid.x, uGrid.x);
        vFrame = vec4(mod(floor(f + 0.5), uGrid.x), 0.0, 0.0, aImp.x);
        vTintI = aImpT; vBand = aImp.zw;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = right * position.x + vec3(0.0, position.y, 0.0);
        vIUv = vec2(position.x + 0.5, 1.0 - position.y);`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPosV = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vDist = distance(cameraPosition, ipos);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${noiseGLSL}
        ${atmosGLSL}
        uniform sampler2D tImp; uniform sampler2D tImpN; uniform vec2 uGrid; uniform float uFade;
        varying vec3 vWPosV; varying float vDist; varying vec2 vIUv; varying vec4 vFrame; varying vec3 vRight; varying vec3 vFwd; varying vec2 vTintI; varying vec2 vBand;
        float bayer4(vec2 p){
          ivec2 q = ivec2(mod(p, 4.0));
          int i = q.x + q.y * 4;
          int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
          return (float(m[i]) + 0.5) / 16.0;
        }
        vec2 cell(float col, float row, vec2 uv){ return (vec2(col, row) + clamp(uv, 0.002, 0.998)) / uGrid; }`)
      .replace('#include <map_fragment>', `
        float th = bayer4(gl_FragCoord.xy);
        // (the switch from the last mesh LOD is outright; only the far edge melts into the fog)
        if (th < clamp((vDist - (vBand.y - uFade * 3.0)) / (uFade * 3.0), 0.0, 1.0)) discard;
        // the baked view nearest the direction of the camera
        float col = vFrame.x;
        vec2 iuv = cell(col, vFrame.w, vIUv);
        vec4 ia = texture(tImp, iuv);
        if (ia.a < 0.4) discard;
        vec3 hc = ia.rgb;
        float hh = vTintI.y;
        hc = (hh < 0.5 ? mix(hc * vec3(0.92, 0.98, 1.04), hc, hh * 2.0) : mix(hc, hc * vec3(1.08, 1.0, 0.86), hh * 2.0 - 1.0)) * vTintI.x;
        diffuseColor.rgb = hc;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 bn = texture(tImpN, iuv).xyz * 2.0 - 1.0;
          vec3 nw = normalize(vRight * bn.x + vec3(0.0, 1.0, 0.0) * bn.y + vFwd * bn.z);
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.92;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.2; reflectedLight.indirectSpecular *= 0.2;`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPosV);');
  };
  return m;
}
