import * as THREE from 'three';
import { NLAMP, noiseGLSL, atmosGLSL, surfaceGLSL } from './shaders';

/**
 * A tiling 256² micro-detail texture for porous, coarse surfaces:
 * R pores (pits), G grain, B fine grit, A fibres (for wood).
 * Generated once with periodic noise, so it repeats seamlessly.
 */
function makeMicro(): THREE.DataTexture {
  const S = 256, data = new Uint8Array(S * S * 4);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lattice = (f: number) => { const a = new Float32Array(f * f); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const vn = (x: number, y: number, f: number, L: Float32Array) => {
    const fx = (x / S) * f, fy = (y / S) * f, i = Math.floor(fx), j = Math.floor(fy);
    let u = fx - i, v = fy - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const a = L[(j % f) * f + (i % f)], b = L[(j % f) * f + ((i + 1) % f)], c = L[((j + 1) % f) * f + (i % f)], d = L[((j + 1) % f) * f + ((i + 1) % f)];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const oct = [8, 16, 32, 64, 128].map((f) => ({ f, L: lattice(f) }));
  // Pores: periodic Worley over 40 random points per tile.
  const P: [number, number, number][] = Array.from({ length: 90 }, () => [rnd() * S, rnd() * S, 0.4 + rnd() * 0.9]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let d1 = 1e9;
    for (const [px, py, r] of P) {
      let dx = Math.abs(x - px), dy = Math.abs(y - py);
      dx = Math.min(dx, S - dx); dy = Math.min(dy, S - dy);
      d1 = Math.min(d1, Math.hypot(dx, dy) / (6 * r));
    }
    const pore = Math.max(0, 1 - d1) ** 2;
    const grain = vn(x, y, 16, oct[1].L) * 0.5 + vn(x, y, 32, oct[2].L) * 0.3 + vn(x, y, 64, oct[3].L) * 0.2;
    const grit = vn(x, y, 128, oct[4].L) * 0.6 + rnd() * 0.4;
    const fib = vn(x, y * 0.0625 + x * 0.02, 128, oct[4].L) * 0.7 + vn(x, y, 64, oct[3].L) * 0.3;
    const k = (y * S + x) * 4;
    data[k] = pore * 255; data[k + 1] = grain * 255; data[k + 2] = grit * 255; data[k + 3] = fib * 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 1;
  t.needsUpdate = true;
  return t;
}
const micro = makeMicro();

export const shared = {
  uTime: { value: 0 },
  uLampPos: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3(0, -999, 0)) },
  uLampCol: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3()) },
  uFogCol: { value: new THREE.Color(0.15, 0.155, 0.165) },
  uUnder: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(-0.92, 0.07, 0.38).normalize() },
  uTown: { value: null as THREE.Texture | null },
  uMicro: { value: micro as THREE.Texture },
};


export const MAT = {
  stone: 0, ground: 1, plaster: 2, wood: 3, roof: 4, rock: 5, bone: 6,
  iron: 7, window: 8, bigstone: 9, slab: 10, cloth: 11,
  brick: 12, rubble: 13, marble: 14, ember: 15, horn: 16, clay: 17, bronze: 18,
} as const;
export type MatName = keyof typeof MAT;

const BUMP = 0.02;

export function makeSurfaceMaterial(id: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  (m as unknown as { defines: Record<string, number> }).defines = { MAT: id };
  m.customProgramCacheKey = () => 'surf' + id;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
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
        `float occl;
         vec3 nW = normalize(vWNrm);
         vec3 pP = parallax(vWPos, nW, occl);
         Surf S = surface(pP, nW);
         diffuseColor.rgb *= S.alb * occl;
         totalEmissiveRadiance += S.emi;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = S.rough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n normal = bumpNormal(-vViewPosition, normal, S.h * ${BUMP.toFixed(4)} * (1.0 - smoothstep(10.0, 40.0, length(vViewPosition))));`,
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
        float cl = fbm(vec3(cuv*0.6 + vec2(uTime*0.006,0.), uTime*0.004));
        float cl2 = fbm(vec3(cuv*1.9 - vec2(uTime*0.01,0.), 3.));
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
