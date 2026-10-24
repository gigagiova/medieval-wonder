import * as THREE from 'three';
import { NLAMP, noiseGLSL, atmosGLSL, surfaceGLSL } from './shaders';

export const shared = {
  uTime: { value: 0 },
  uLampPos: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3(0, -999, 0)) },
  uLampCol: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3()) },
  uFogCol: { value: new THREE.Color(0.15, 0.155, 0.165) },
  uUnder: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(-0.92, 0.07, 0.38).normalize() },
  uTown: { value: null as THREE.Texture | null },
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
