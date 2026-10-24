import * as THREE from 'three';
import { shared } from './materials';
import { noiseGLSL } from './shaders';

// Procedural fire: instanced, vertically locked billboards running a
// domain-warped flame with a blackbody colour ramp, plus rising embers.

export type FireKind = 'torch' | 'brazier' | 'oil' | 'candle';
export interface FireSource { pos: THREE.Vector3; kind: FireKind; scale?: number }

interface Tongue { x: number; z: number; w: number; h: number; turb: number }

// Each kind is one or more overlapping tongues; big fires layer several.
const LAYOUT: Record<FireKind, (r: () => number) => Tongue[]> = {
  candle: () => [{ x: 0, z: 0, w: 0.032, h: 0.085, turb: 0.25 }],
  oil: () => [{ x: 0, z: 0, w: 0.036, h: 0.075, turb: 0.35 }],
  torch: (r) => [
    { x: 0, z: 0, w: 0.26, h: 0.55, turb: 1 },
    { x: (r() - 0.5) * 0.06, z: 0.02, w: 0.18, h: 0.42, turb: 1 },
    { x: (r() - 0.5) * 0.08, z: -0.02, w: 0.14, h: 0.32, turb: 0.9 },
  ],
  brazier: (r) => {
    // A wide low bed of flame that the taller tongues rise out of.
    const out: Tongue[] = [
      { x: 0, z: 0, w: 0.75, h: 0.32, turb: 1 },
      { x: 0.05, z: 0.04, w: 0.6, h: 0.42, turb: 1 },
    ];
    for (let i = 0; i < 5; i++) {
      const a = (i / 6) * Math.PI * 2 + r();
      const d = i === 0 ? 0 : 0.12 + r() * 0.14;
      out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, w: 0.32 + r() * 0.16, h: 0.45 + r() * 0.3, turb: 1 });
    }
    return out;
  },
};
const EMBERS: Record<FireKind, number> = { candle: 0, oil: 0, torch: 7, brazier: 18 };

const flameVert = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 iSize;
  attribute float iSeed;
  attribute float iTurb;
  varying vec2 vUv;
  varying float vSeed;
  varying float vTurb;
  varying float vFade;
  void main(){
    vec3 toCam = cameraPosition - iPos;
    vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z) + 1e-5);
    vec3 right = vec3(fwd.z, 0.0, -fwd.x);
    // Lift the quad slightly towards the camera so it does not cut into a wick or torch head.
    vec3 p = iPos + right * position.x * iSize.x + vec3(0.0, position.y * iSize.y, 0.0) + fwd * iSize.x * 0.15;
    vUv = vec2(position.x, position.y);
    vSeed = iSeed;
    vTurb = iTurb;
    vFade = exp(-length(toCam) * 0.03);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const flameFrag = /* glsl */ `
  uniform float uTime;
  uniform float uUnder;
  varying vec2 vUv;
  varying float vSeed;
  varying float vTurb;
  varying float vFade;
  ${noiseGLSL}
  float fbm2(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise2(p); p=p*2.07+vec2(3.1,1.7); a*=.5; } return s/0.9375; }

  // Rough blackbody: deep red embers through orange and yellow to a near-white core.
  vec3 blackbody(float T){
    vec3 c = vec3(0.55,0.02,0.0);
    c = mix(c, vec3(1.0,0.22,0.02), smoothstep(0.12,0.38,T));
    c = mix(c, vec3(1.0,0.55,0.12), smoothstep(0.32,0.6,T));
    c = mix(c, vec3(1.0,0.78,0.38), smoothstep(0.58,0.9,T));
    c = mix(c, vec3(1.0,0.95,0.82), smoothstep(0.95,1.3,T));
    return c * (0.04 + 1.5*T*T*T + 0.3*T);
  }

  void main(){
    float t = uTime;
    float s = vSeed * 37.0;
    float big = step(0.5, vTurb);
    // Overall flicker: brightness and height breathe on noise, not sine.
    float fl = vnoise2(vec2(t * mix(6.0, 9.0, big) + s, s));
    float fl2 = vnoise2(vec2(t * 17.0 + s * 2.0, 3.0));
    float hScale = 0.82 + 0.25 * fl + 0.08 * fl2;
    vec2 uv = vec2(vUv.x, vUv.y / hScale);
    float y = uv.y;
    if (y > 1.0) discard;

    // Upward-advected, domain-warped turbulence.
    float spd = mix(1.3, 2.2, big);
    vec2 q = vec2(uv.x * 2.6, y * 1.6 - t * spd) + s;
    float n1 = fbm2(q);
    float n2 = fbm2(q * 2.3 + vec2(n1 * 1.7, -t * spd * 1.4));
    float n = mix(n1, n2, 0.45);

    // The whole flame sways, more at the top; tongues wander sideways.
    float sway = (vnoise2(vec2(t * 1.1 + s, s * 0.3)) - 0.5) * 0.3 * y * y * vTurb;
    float x = uv.x - sway - (n - 0.5) * 0.5 * y * vTurb;

    // Teardrop profile: round, full base, long taper.
    float w = 0.48 * pow(clamp(y / 0.22, 0.0, 1.0), 0.45) * pow(max(1.0 - y, 0.0), mix(0.9, 1.25, big));
    w *= mix(1.0, 0.75 + 0.5 * n, vTurb);
    float d = 1.0 - abs(x) / max(w, 1e-3);
    // Ragged edges: the outline is eaten by a finer turbulence.
    float rag = fbm2(vec2(uv.x * 7.0, y * 4.0 - t * spd * 1.8) + s * 2.0);
    float body = smoothstep(0.0, 0.4, d - (1.0 - rag) * 0.45 * vTurb);
    // Erode from the top so tongues tear off and burn out.
    float erode = (1.0 - n) * pow(y, 1.2) * mix(0.55, 1.6, vTurb);
    body = clamp(body - erode, 0.0, 1.0);
    body *= smoothstep(0.0, 0.06, y);

    // Temperature: hottest low in the middle, cooling outward and upward.
    float core = smoothstep(0.35, 1.0, d) * (1.0 - smoothstep(0.1, 0.75, y));
    float T = body * (0.4 + 0.45 * core) * (1.0 - 0.6 * y) * (0.85 + 0.3 * fl);
    // Bright and dim streaks run up through the flame.
    T *= mix(1.0, 0.55 + 0.9 * n2, vTurb);
    T += core * body * mix(0.35, 0.12, big);
    vec3 col = blackbody(T) * body;

    // Small flames: calm, a near-white body over a faint blue base.
    float small = 1.0 - big;
    float blueBase = exp(-y * 10.0) * smoothstep(0.0, 0.5, 1.0 - abs(uv.x) / 0.32) * smoothstep(0.0, 0.05, y);
    col += small * vec3(0.06, 0.12, 0.5) * blueBase * 0.9;
    col *= mix(1.0, 1.35, small);

    // A soft glow halo hugging the flame keeps it from looking cut out.
    float halo = exp(-length(vec2(uv.x * 2.2, (y - 0.25) * 1.3)) * 7.0) * 0.035 * (0.8 + 0.4 * fl);
    col += vec3(1.0, 0.4, 0.1) * halo;
    // Layered tongues add up, so each big one carries less.
    col *= mix(1.0, 0.55, big);

    gl_FragColor = vec4(col * vFade * (1.0 - 0.15 * uUnder), 1.0);
  }`;

const emberVert = /* glsl */ `
  uniform float uTime;
  attribute vec3 iPos;
  attribute vec4 iData; // seed, rate, rise, spread
  varying float vLife;
  varying float vFade;
  ${noiseGLSL}
  void main(){
    float seed = iData.x;
    float life = fract(uTime * iData.y + seed * 7.13);
    float cyc = floor(uTime * iData.y + seed * 7.13);
    float h = hash12(vec2(seed * 91.0, cyc));
    float h2 = hash12(vec2(cyc, seed * 13.0));
    vec3 p = iPos + vec3((h - 0.5) * iData.w, 0.0, (h2 - 0.5) * iData.w);
    // Rise fast then slow, curling on a noise wind.
    float rise = iData.z * (1.0 - pow(1.0 - life, 2.0));
    p.y += rise;
    float k = life * life;
    p.x += (vnoise(vec3(p.y * 2.0, cyc, seed * 5.0)) - 0.5) * 0.9 * k + sin(life * 9.0 + h * 6.0) * 0.05 * life;
    p.z += (vnoise(vec3(cyc, p.y * 2.0, seed * 3.0)) - 0.5) * 0.9 * k + cos(life * 7.0 + h2 * 6.0) * 0.05 * life;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(7.0 / -mv.z, 1.0, 3.0) * (1.0 - life * 0.5);
    vLife = life;
    vFade = exp(-length(mv.xyz) * 0.04) * step(0.08, hash12(vec2(seed, cyc * 3.1)));
  }`;

const emberFrag = /* glsl */ `
  varying float vLife;
  varying float vFade;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    float cool = vLife;
    vec3 col = mix(vec3(1.0, 0.8, 0.4) * 2.2, vec3(1.0, 0.25, 0.03) * 1.0, smoothstep(0.0, 0.45, cool));
    col = mix(col, vec3(0.4, 0.03, 0.0) * 0.6, smoothstep(0.45, 1.0, cool));
    col *= 1.0 - smoothstep(0.75, 1.0, cool);
    gl_FragColor = vec4(col * a * vFade, 1.0);
  }`;

export function makeFire(sources: FireSource[]): THREE.Object3D {
  const group = new THREE.Group();
  let seed = 9871;
  const r = () => ((seed = (Math.imul(seed, 48271) + 11) >>> 0) / 4294967296);

  const pos: number[] = [], size: number[] = [], seeds: number[] = [], turb: number[] = [];
  const ePos: number[] = [], eData: number[] = [];
  for (const src of sources) {
    const sc = src.scale ?? 1;
    for (const tg of LAYOUT[src.kind](r)) {
      pos.push(src.pos.x + tg.x * sc, src.pos.y, src.pos.z + tg.z * sc);
      size.push(tg.w * sc, tg.h * sc);
      seeds.push(r());
      turb.push(tg.turb);
    }
    const n = EMBERS[src.kind];
    const big = src.kind === 'brazier';
    for (let i = 0; i < n; i++) {
      ePos.push(src.pos.x, src.pos.y + 0.1 * sc, src.pos.z);
      eData.push(r(), (0.25 + r() * 0.35) * (big ? 0.8 : 1), (big ? 2.2 : 1.4) * sc * (0.6 + r() * 0.6), (big ? 0.5 : 0.12) * sc);
    }
  }

  if (pos.length) {
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    quad.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(size), 2));
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    g.setAttribute('iTurb', new THREE.InstancedBufferAttribute(new Float32Array(turb), 1));
    g.instanceCount = seeds.length;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uUnder: shared.uUnder },
      vertexShader: flameVert,
      fragmentShader: flameFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
  }

  if (ePos.length) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(ePos), 3));
    g.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array(eData), 4));
    g.instanceCount = eData.length / 4;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime },
      vertexShader: emberVert,
      fragmentShader: emberFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    group.add(pts);
  }
  return group;
}
