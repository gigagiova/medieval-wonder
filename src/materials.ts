import * as THREE from 'three';
import { NLAMP, noiseGLSL, atmosGLSL, surfaceGLSL } from './shaders';

export const shared = {
  uTime: { value: 0 },
  uLampPos: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3(0, -999, 0)) },
  uLampCol: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3()) },
  uFogCol: { value: new THREE.Color(0.018, 0.024, 0.034) },
  uUnder: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(-0.35, 0.45, -0.82).normalize() },
};

export const MAT = {
  stone: 0, ground: 1, plaster: 2, wood: 3, roof: 4, rock: 5, bone: 6,
  iron: 7, window: 8, bigstone: 9, slab: 10, cloth: 11,
} as const;
export type MatName = keyof typeof MAT;

const BUMP = 0.012;

function makeSurfaceMaterial(id: number): THREE.MeshStandardMaterial {
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
        `Surf S = surface(vWPos, normalize(vWNrm));
         diffuseColor.rgb *= S.alb;
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
        vec3 col = mix(vec3(0.012,0.016,0.024), vec3(0.003,0.004,0.008), smoothstep(0.0,0.6,y));
        float md = dot(rd, uMoonDir);
        float disc = smoothstep(0.9993,0.9996,md);
        float crater = fbm(rd*400.);
        col += vec3(0.75,0.8,0.85)*disc*(0.7+0.3*crater)*3.0;
        col += vec3(0.12,0.16,0.22)*pow(max(md,0.),40.)*0.6 + vec3(0.05,0.07,0.1)*pow(max(md,0.),6.)*0.4;
        vec2 cuv = rd.xz/(y+0.15);
        float cl = fbm(vec3(cuv*1.3 + vec2(uTime*0.01,0.), uTime*0.01));
        float cloud = smoothstep(0.45,0.8,cl) * smoothstep(0.0,0.25,y);
        vec3 cloudC = vec3(0.02,0.025,0.032) + vec3(0.12,0.14,0.17)*pow(max(md,0.),8.)*0.8;
        col = mix(col, cloudC, cloud*0.85);
        float st = step(0.9985, hash13(floor(rd*600.))) * (1.-cloud) * smoothstep(0.1,0.4,y);
        col += vec3(st)*0.25;
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

// Billboarded procedural flames rendered as point sprites.
export function makeFlames(points: { pos: THREE.Vector3; size: number }[]): THREE.Points {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(points.length * 3);
  const seed = new Float32Array(points.length);
  const size = new Float32Array(points.length);
  points.forEach((p, i) => {
    pos.set([p.pos.x, p.pos.y + p.size * 0.3, p.pos.z], i * 3);
    seed[i] = Math.random();
    size[i] = p.size;
  });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...shared, uScale: { value: 600 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uScale;
      attribute float aSeed; attribute float aSize;
      varying float vSeed; varying float vFade;
      void main(){
        vec4 mv = modelViewMatrix*vec4(position,1.);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = aSize*uScale/max(-mv.z,0.1);
        vSeed = aSeed; vFade = exp(-length(mv.xyz)*0.03);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vSeed; varying float vFade;
      ${noiseGLSL}
      void main(){
        vec2 uv = vec2(gl_PointCoord.x-0.5, 1.0-gl_PointCoord.y);
        float t = uTime*3.5 + vSeed*20.;
        float n = vnoise2(vec2(uv.x*5.+vSeed*9., uv.y*3.5 - t));
        float x = uv.x + (n-0.5)*0.22*uv.y;
        float w = 0.2*(1.0-uv.y)*(0.75+0.5*n) + 0.015;
        float body = smoothstep(1.0,0.25,abs(x)/w) * smoothstep(0.0,0.12,uv.y) * smoothstep(0.95,0.35,uv.y + n*0.25);
        vec3 col = mix(vec3(1.0,0.28,0.04), vec3(1.0,0.82,0.45), smoothstep(0.35,1.0,body)*(1.0-uv.y));
        float glow = exp(-length(vec2(uv.x, uv.y-0.25))*7.0)*0.35;
        gl_FragColor = vec4(col*(body*2.6+glow)*vFade, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
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
