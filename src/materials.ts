import * as THREE from 'three';
import { NLAMP, noiseGLSL, atmosGLSL, surfaceGLSL } from './shaders';

// ---------------------------------------------------------------- textures
// Photo-scanned CC0 PBR sets from Poly Haven (see public/textures/CREDITS.md
// and tools/fetch-textures.ts). Each set: _a albedo (sRGB), _n normal
// (OpenGL), _m packed (R ao, G roughness, B height). Loading starts at import.

const loader = new THREE.TextureLoader();
const pending: Promise<unknown>[] = [];
function load(path: string, srgb: boolean): THREE.Texture {
  let done: () => void = () => {};
  pending.push(new Promise<void>((res) => { done = res; }));
  // A missing texture must not hold up the world: resolve on error too.
  const t = loader.load(path, () => done(), undefined, () => { console.warn('texture failed', path); done(); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}
export interface TexSet { a: THREE.Texture; n: THREE.Texture; m: THREE.Texture }
const sets = new Map<string, TexSet>();
/** A texture set by slot name ('cobble', 'rubble', 'bark', ...). */
export function textureSet(slot: string): TexSet {
  let s = sets.get(slot);
  if (!s) {
    s = { a: load(`textures/${slot}_a.webp`, true), n: load(`textures/${slot}_n.webp`, false), m: load(`textures/${slot}_m.webp`, false) };
    sets.set(slot, s);
  }
  return s;
}
const noiseTex = load('textures/noise.png', false);
noiseTex.anisotropy = 1;

export const shared = {
  uTime: { value: 0 },
  uLampPos: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3(0, -999, 0)) },
  uLampCol: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3()) },
  uFogCol: { value: new THREE.Color(0.15, 0.155, 0.165) },
  uUnder: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(-0.92, 0.07, 0.38).normalize() },
  uTown: { value: null as THREE.Texture | null },
  uNoise: { value: noiseTex as THREE.Texture },
};


export const MAT = {
  stone: 0, ground: 1, plaster: 2, wood: 3, roof: 4, rock: 5, bone: 6,
  iron: 7, window: 8, bigstone: 9, slab: 10, cloth: 11,
  brick: 12, rubble: 13, marble: 14, ember: 15, horn: 16, clay: 17, bronze: 18,
} as const;
export type MatName = keyof typeof MAT;

/**
 * Per material: which texture set, metres per repeat, and gains. ALB scales
 * the scanned albedo to sit right under the overcast dusk light; TINT pulls a
 * scan towards the local stone (e.g. the quarry scan towards yellow tuff).
 */
interface MatCfg { set: string; tile: number; alb?: number; rough?: number; nrm?: number; moss?: number; tint?: [number, number, number] }
const CFG: Partial<Record<number, MatCfg>> = {
  0: { set: 'ashlar', tile: 2.0, alb: 0.72, moss: 0.7 },
  1: { set: 'cobble', tile: 2.0 },
  2: { set: 'plaster', tile: 2.3, alb: 0.7, moss: 0.4 },
  3: { set: 'wood', tile: 2.0, alb: 0.75, moss: 0.3 },
  4: { set: 'coppi', tile: 1.5, alb: 0.75, moss: 0.0 },
  5: { set: 'tuff', tile: 1.8, alb: 0.9, moss: 0.0, tint: [1.15, 0.98, 0.72] },
  9: { set: 'bigstone', tile: 3.0, alb: 0.7, moss: 0.8 },
  10: { set: 'basoli', tile: 1.8, alb: 0.75, moss: 0.2 },
  12: { set: 'brick', tile: 2.5, alb: 0.72, moss: 0.5 },
  13: { set: 'rubble', tile: 2.12, alb: 0.72, moss: 0.6 },
  14: { set: 'marble', tile: 1.8, alb: 0.65, moss: 0.5 },
};
const f = (x: number) => x.toFixed(4);

/** Every texture any surface material needs, loaded. Await before entering the world. */
export const texturesReady: Promise<void> = (() => {
  for (const c of Object.values(CFG)) textureSet(c!.set);
  textureSet('basoli'); textureSet('mud');
  return Promise.all(pending).then(() => undefined);
})();

export function makeSurfaceMaterial(id: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const cfg = CFG[id];
  const defines: Record<string, string | number> = { MAT: id };
  const uniforms: Record<string, { value: unknown }> = {};
  if (cfg) {
    const t = textureSet(cfg.set);
    Object.assign(defines, { TILE: f(cfg.tile), ALB_K: f(cfg.alb ?? 0.75), ROUGH_K: f(cfg.rough ?? 1), NRM_K: f(cfg.nrm ?? 1), MOSS: f(cfg.moss ?? 0.5) });
    if (cfg.tint) defines.TINT = `vec3(${cfg.tint.map(f).join(',')})`;
    Object.assign(uniforms, { tA: { value: t.a }, tN: { value: t.n }, tM: { value: t.m } });
    if (id === MAT.ground) {
      const b2 = textureSet('basoli'), b3 = textureSet('mud');
      Object.assign(uniforms, { tA2: { value: b2.a }, tN2: { value: b2.n }, tM2: { value: b2.m }, tA3: { value: b3.a }, tN3: { value: b3.n }, tM3: { value: b3.m } });
    }
  }
  (m as unknown as { defines: Record<string, string | number> }).defines = defines;
  m.customProgramCacheKey = () => 'surf2-' + id;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n${noiseGLSL}\n${atmosGLSL}\n${surfaceGLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 nW = normalize(vWNrm);
         Surf S = surface(vWPos, nW);
         diffuseColor.rgb *= S.alb * mix(1.0, S.ao, 0.85);
         totalEmissiveRadiance += S.emi;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = S.rough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n normal = normalize(mat3(viewMatrix) * S.nrm) * faceDirection;`,
      )
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= SPEC_K;
        reflectedLight.indirectSpecular *= SPEC_K;`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPos);');
  };
  return m;
}

const cache = new Map<MatName, THREE.MeshStandardMaterial>();
export function mat(name: MatName): THREE.MeshStandardMaterial {
  let m = cache.get(name);
  if (!m) {
    m = makeSurfaceMaterial(MAT[name]);
    cache.set(name, m);
  }
  return m;
}

export function makeSky(): THREE.Mesh {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...shared },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vWPos = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos;
      ${noiseGLSL}
      ${atmosGLSL}
      void main(){
        vec3 rd = normalize(vWPos - cameraPosition);
        float y = rd.y;
        // Overcast dusk: an even grey lid of cloud, slightly brighter towards
        // the horizon and in the west where the light is going. No colour.
        float md = dot(rd, uMoonDir);
        vec3 col = mix(vec3(0.2,0.205,0.215), vec3(0.11,0.115,0.13), smoothstep(-0.05,0.6,y));
        col *= 1.0 + 0.18 * pow(max(md,0.), 2.0) * (1.0 - smoothstep(0.0, 0.5, y));
        vec2 cuv = rd.xz/(max(y,0.0)+0.12);
        float cl = texture2D(uNoise, cuv*0.15 + vec2(uTime*0.0015, 0.)).r;
        float cl2 = texture2D(uNoise, cuv*0.47 - vec2(uTime*0.0025, 0.)).g;
        col *= 1.0 - (smoothstep(0.35,0.8,cl)*0.28 + smoothstep(0.5,0.85,cl2)*0.12)*smoothstep(0.0,0.25,y);
        gl_FragColor = vec4(applyAtmos(col, cameraPosition + rd*140.), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), m);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

// Slow drifting motes around the camera, lit only by the fog colour and lamps.
export function makeMotes(count = 2500): THREE.Points {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) pos[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...shared },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vA; varying vec3 vW;
      ${noiseGLSL}
      void main(){
        vec3 box = vec3(24., 8., 24.);
        vec3 p = position*box + vec3(uTime*0.25, -uTime*0.05, uTime*0.12);
        p += vec3(sin(uTime*0.3+position.y*40.), sin(uTime*0.5+position.x*30.)*0.5, cos(uTime*0.4+position.z*20.))*0.6;
        vec3 c = cameraPosition - box*0.5;
        p = c + mod(p - c, box);
        vW = p;
        vec4 mv = viewMatrix*vec4(p,1.);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = 9.0/max(-mv.z,0.5);
        vA = smoothstep(12.,3.,length(mv.xyz));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLampPos[10]; uniform vec3 uLampCol[10];
      varying float vA; varying vec3 vW;
      void main(){
        float d = length(gl_PointCoord-0.5);
        float a = smoothstep(0.5,0.0,d)*vA;
        vec3 l = vec3(0.05,0.06,0.08);
        for(int i=0;i<10;i++){ vec3 dd = uLampPos[i]-vW; l += uLampCol[i]*1.5/(1.0+dot(dd,dd)); }
        gl_FragColor = vec4(l*a*0.4, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
