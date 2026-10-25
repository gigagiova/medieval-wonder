import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { shared } from './materials';

// Light in the mist. The materials fog every surface with an evenly lit
// mist; this pass adds what the key light (the bright west) scatters towards
// the eye from the parts of the mist it actually reaches. The town's shadow
// volume comes from the light field (one fetch per step), so the mist over a
// shaded alley stays dark while the air over roofs, squares and through gaps
// glows: shafts and layered depth instead of a flat grey veil.
//
// Cost: one march of 12 steps at half resolution (a quarter of the pixels),
// then a full-resolution composite that also does the NaN guard the bloom
// needs (so it replaces a pass rather than adding one).

const march = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjInv, uCamWorld;
  uniform vec3 uCam;
  uniform sampler2D uLF; uniform vec4 uLFBox;
  uniform vec4 uFogK; uniform float uFogBase; uniform float uUnder;
  uniform vec2 uRes;
  varying vec2 vUv;
  float litAt(vec3 p){
    vec2 uv = (p.xz - uLFBox.xy) * uLFBox.z;
    vec2 e = min(uv, 1.0 - uv);
    float inside = smoothstep(0.0, 0.1, min(e.x, e.y));
    uv.y = 1.0 - uv.y;
    float S = texture2D(uLF, uv).r;
    return mix(0.75, smoothstep(S - 0.3, S + 1.5, p.y), inside * uLFBox.w);
  }
  void main(){
    float d = texture2D(tDepth, vUv).r;
    vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 vp = uProjInv * ndc; vp /= vp.w;
    vec3 wp = (uCamWorld * vp).xyz;
    vec3 rd = wp - uCam; float L = length(rd); rd /= L;
    if (d >= 1.0) L = 140.0;
    float tMax = min(L, 90.0);
    // Fixed (not animated) interleaved offset: no crawling noise; the
    // composite's blur dissolves the pattern.
    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float T = 1.0, acc = 0.0;
    float t0 = 0.0;
    const int N = 12;
    for (int i = 1; i <= N; i++) {
      // steps grow with distance: more of them near the eye
      float f = (float(i) - 1.0 + j) / float(N);
      float t1 = tMax * f * f;
      float tm = 0.5 * (t0 + t1), dt = t1 - t0; t0 = t1;
      vec3 p = uCam + rd * tm;
      float sig = uFogK.x + uFogK.y * exp(-uFogK.z * (p.y - uFogBase));
      acc += T * sig * dt * litAt(p);
      T *= exp(-sig * dt);
    }
    // Beyond the march: evenly lit mist out to the surface (or the sky).
    float sigF = uFogK.x + uFogK.y * exp(-uFogK.z * max(uCam.y + rd.y * tMax - uFogBase, 0.0));
    acc += T * (1.0 - exp(-sigF * max(L - tMax, 0.0))) * 0.7;
    gl_FragColor = vec4(acc * (1.0 - uUnder), 0.0, 0.0, 1.0);
  }`;

const composite = /* glsl */ `
  uniform sampler2D tDiffuse; uniform sampler2D tShaft;
  uniform vec2 uTexel; uniform vec3 uKey; uniform vec3 uSunDir; uniform vec3 uCam;
  uniform mat4 uProjInv, uCamWorld;
  varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
    c.rgb = min(c.rgb, vec3(64.0));
    // Four bilinear taps (a 4x4 tent over the half-res march).
    float s = texture2D(tShaft, vUv + uTexel * vec2(-0.75, -0.75)).r
            + texture2D(tShaft, vUv + uTexel * vec2(0.75, -0.75)).r
            + texture2D(tShaft, vUv + uTexel * vec2(-0.75, 0.75)).r
            + texture2D(tShaft, vUv + uTexel * vec2(0.75, 0.75)).r;
    s *= 0.25;
    vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vp /= vp.w;
    vec3 rd = normalize((uCamWorld * vec4(vp.xyz, 1.0)).xyz - uCam);
    float md = dot(rd, uSunDir);
    // Henyey-Greenstein, g = 0.55, plus an isotropic floor.
    float g = 0.55, hg = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*md, 1.5) / 12.566;
    float phase = 0.03 + hg;
    c.rgb += uKey * phase * s;
    gl_FragColor = vec4(c.rgb, c.a);
  }`;

export class ShaftPass extends Pass {
  private rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private mq: FullScreenQuad;
  private cq: FullScreenQuad;
  /** Strength of the scattered key light (multiplies the light's colour × intensity). */
  strength = 0.07;
  constructor(private camera: THREE.PerspectiveCamera, private depth: () => THREE.Texture, private key: THREE.DirectionalLight) {
    super();
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.mq = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null }, uProjInv: { value: camera.projectionMatrixInverse }, uCamWorld: { value: camera.matrixWorld },
        uCam: { value: new THREE.Vector3() }, uRes: { value: new THREE.Vector2() },
        uLF: shared.uLF, uLFBox: shared.uLFBox, uFogK: shared.uFogK, uFogBase: shared.uFogBase, uUnder: shared.uUnder,
      },
      vertexShader: vs, fragmentShader: march, depthTest: false, depthWrite: false,
    }));
    this.cq = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tShaft: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2() },
        uKey: { value: new THREE.Vector3() }, uSunDir: shared.uMoonDir, uCam: { value: new THREE.Vector3() },
        uProjInv: { value: camera.projectionMatrixInverse }, uCamWorld: { value: camera.matrixWorld },
      },
      vertexShader: vs, fragmentShader: composite, depthTest: false, depthWrite: false,
    }));
  }
  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    (this.cq.material as THREE.ShaderMaterial).uniforms.uTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const m = (this.mq.material as THREE.ShaderMaterial).uniforms, c = (this.cq.material as THREE.ShaderMaterial).uniforms;
    m.tDepth.value = this.depth();
    m.uCam.value.setFromMatrixPosition(this.camera.matrixWorld);
    c.uCam.value.copy(m.uCam.value);
    const k = this.key;
    c.uKey.value.set(k.color.r, k.color.g, k.color.b).multiplyScalar(k.intensity * this.strength);
    renderer.setRenderTarget(this.rt);
    this.mq.render(renderer);
    c.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.cq.render(renderer);
  }
}
