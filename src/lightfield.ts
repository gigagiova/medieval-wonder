import * as THREE from 'three';
import { shared } from './materials';
import type { Cell } from './builder';

// The light field: what the open sky and the low western light can reach,
// baked from a top-down height map of the town around the player.
//
// Every few dozen metres the town is drawn once from above into a height map
// (cheap: one flat-shaded pass). A second pass turns it into a small RGBA
// texture that every lit surface reads with two fetches:
//   R  the sun's shadow height: a point is in the key light's shadow when it
//      lies below it (exact for a height field: ray-marched once per bake,
//      not per pixel and not per frame);
//   G, B, A  the mean height of the town within ~0.5, 5 and 12 m, from which
//      the shader estimates how much sky a point sees (sky occlusion: alleys
//      dark at the bottom, light up top; interiors and archways dark).
// Nothing is drawn per frame: the per-frame cost is the two fetches.

const SIZE = 176;       // metres covered
const HRES = 1024;      // height map texels (17 cm)
const LRES = 1024;      // light field texels (17 cm)
const MOVE = 30;        // re-bake when the eye is this far from the centre
const OFS = 20;         // heights are stored + OFS so the clear value (0) means "far below"

// Every lit material that runs through the shared atmosphere (it defines
// WORLDLIGHT) takes the light field: the first directional light (the key)
// is shadowed by the town, and the sky's light (image-based diffuse and
// reflections, hemisphere) is occluded by it. World position and normal come
// from the view-space ones, so no material needs anything extra.
{
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.lights_fragment_begin = C.lights_fragment_begin.replace(
    'vec3 geometryClearcoatNormal = vec3( 0.0 );',
    `vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef WORLDLIGHT
	vec2 wl = worldLight( cameraPosition - vViewPosition * mat3( viewMatrix ), normalize( nonPerturbedNormal * mat3( viewMatrix ) ) );
#endif`,
  ).replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    `getDirectionalLightInfo( directionalLight, directLight );
		#if defined( WORLDLIGHT ) && ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= wl.x;
		#endif`,
  );
  C.lights_fragment_maps += `
#ifdef WORLDLIGHT
	#if defined( RE_IndirectDiffuse )
	irradiance *= wl.y;
	iblIrradiance *= wl.y;
	#endif
	#if defined( RE_IndirectSpecular )
	radiance *= wl.y * wl.y;
	#endif
#endif
`;
  // Debug views (?dbg=wl|albedo|normal|rough|light|ao): what each lit
  // material feeds the lighting, for diagnosing flat or plastic surfaces.
  const dbg = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('dbg') : null;
  const views: Record<string, string> = {
    wl: '#ifdef WORLDLIGHT\n vec3 dbgC = vec3(wl.x, wl.y, 0.0) * 0.5;\n#else\n vec3 dbgC = vec3(0.0);\n#endif',
    albedo: 'vec3 dbgC = material.diffuseColor;',
    normal: 'vec3 dbgC = (normalize(geometryNormal * mat3(viewMatrix)) * 0.5 + 0.5) * 0.5;',
    rough: 'vec3 dbgC = vec3(material.roughness) * 0.5;',
    light: 'vec3 dbgC = 0.18 * (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(material.diffuseColor, vec3(0.02));',
    spec: 'vec3 dbgC = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
  };
  if (dbg && views[dbg])
    C.lights_fragment_end += `
	{ ${views[dbg]}
	reflectedLight.directDiffuse = vec3(0.0); reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);
	reflectedLight.indirectDiffuse = dbgC; }
`;
}


const quadVS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class LightField {
  private hRT = new THREE.WebGLRenderTarget(HRES, HRES, {
    type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: true,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  readonly rt = new THREE.WebGLRenderTarget(LRES, LRES, {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  private cam = new THREE.OrthographicCamera(-SIZE / 2, SIZE / 2, SIZE / 2, -SIZE / 2, 1, 400);
  private hMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `varying float vY;
      void main(){ vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
        vec4 w = modelMatrix * p; vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying float vY; void main(){ gl_FragColor = vec4(vY + ${OFS.toFixed(1)}, 0.0, 0.0, 1.0); }`,
  });
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private centre = new THREE.Vector2(1e9, 1e9);
  private lastReady = -1;
  private wait = 0;
  bakes = 0;
  ms = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private cells: Cell[], private skip: THREE.Object3D[]) {
    this.cam.up.set(0, 0, -1);
    this.cam.lookAt(0, -1, 0);
    const tex = HRES / SIZE;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { tH: { value: this.hRT.texture }, uSun: { value: new THREE.Vector3() } },
      vertexShader: quadVS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tH; uniform vec3 uSun; varying vec2 vUv;
        const float SIZE = ${SIZE.toFixed(1)};
        const float TEXEL = ${(1 / tex).toFixed(5)};
        float H(vec2 uv, float lod){ return textureLod(tH, uv, lod).r - ${OFS.toFixed(1)}; }
        void main(){
          // Sun: the highest point of the column that is still in shadow is
          // max over t of H(p + d t) - t tan(elevation), marched towards the sun
          // with growing steps; farther samples read coarser mips (softer).
          // (texture v runs towards -z: the camera looks down with -z up)
          vec2 d = normalize(uSun.xz) * vec2(1.0, -1.0);
          float tanE = uSun.y / length(uSun.xz);
          float S = -1e4;
          float t = 0.2, dt = 0.18;
          for (int i = 0; i < 36; i++) {
            vec2 uv = vUv + d * (t / SIZE);
            if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
            float lod = clamp(log2(dt / TEXEL) - 1.0, 0.0, 4.0);
            S = max(S, H(uv, lod) - t * tanE);
            t += dt; dt *= 1.1;
          }
          // Mean town height around the point at three scales (mips).
          float h1 = H(vUv, log2(0.5 / TEXEL));
          float h2 = H(vUv, log2(9.0 / TEXEL));
          float h3 = H(vUv, log2(24.0 / TEXEL));
          gl_FragColor = vec4(S, h1, h2, h3);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
    const t = this.rt.texture;
    shared.uLF.value = t;
  }

  /** Re-bake if the eye has moved far from the centre, or new chunks arrived near it. */
  update(eye: THREE.Vector3, readyChunks: number, dt: number, force = false) {
    this.wait -= dt;
    const far = Math.max(Math.abs(eye.x - this.centre.x), Math.abs(eye.z - this.centre.y)) > MOVE;
    const fresh = readyChunks !== this.lastReady && this.wait <= 0;
    // The bake is split over two frames (heights, then the field) so neither
    // frame carries both; a new chunk triggers it at most every 4 s.
    if (this.pending) {
      const p = this.pending; this.pending = null;
      try { this.field(p.x, p.y); } catch (e) { console.warn('light field pass failed', e); this.renderer.setRenderTarget(null); }
      return;
    }
    if (!(far || fresh || force)) return;
    this.lastReady = readyChunks;
    this.wait = 4;
    // A failed bake must never stop the frame loop: keep the last field.
    try { this.bake(eye.x, eye.z); } catch (e) { console.warn('light field bake failed', e); this.scene.overrideMaterial = null; this.renderer.setRenderTarget(null); }
  }
  private pending: THREE.Vector2 | null = null;

  bake(cx: number, cz: number) {
    const t0 = performance.now();
    // Snap to whole texels of the light field so a re-bake does not shimmer.
    const step = SIZE / LRES;
    cx = Math.round(cx / step) * step; cz = Math.round(cz / step) * step;
    this.centre.set(cx, cz);
    const r = this.renderer;
    const box = new THREE.Box3(new THREE.Vector3(cx - SIZE / 2, -1e3, cz - SIZE / 2), new THREE.Vector3(cx + SIZE / 2, 1e3, cz + SIZE / 2));
    // Everything above ground in the square is drawn, culled or not.
    const restore: [THREE.Object3D, boolean][] = [];
    for (const c of this.cells) {
      const want = !c.under && c.box.intersectsBox(box);
      for (const m of c.meshes) if (m.visible !== want) { restore.push([m, m.visible]); m.visible = want; }
    }
    this.scene.traverse((o) => {
      const skin = (o as THREE.SkinnedMesh).isSkinnedMesh;
      const mm = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const mat = Array.isArray(mm) ? mm[0] : mm;
      const odd = (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine
        || skin || (mat && (mat.transparent || mat.userData?.foliage || (mat as THREE.ShaderMaterial).isShaderMaterial));
      if ((odd || this.skip.includes(o)) && o.visible) { restore.push([o, true]); o.visible = false; }
    });
    this.cam.position.set(cx, 300, cz);
    this.cam.updateMatrixWorld();
    const prevOverride = this.scene.overrideMaterial, prevBg = this.scene.background, prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevAuto = r.shadowMap.autoUpdate;
    this.scene.overrideMaterial = this.hMat;
    this.scene.background = null;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.hRT);
    try {
      r.clear();
      r.render(this.scene, this.cam);
    } finally {
      this.scene.overrideMaterial = prevOverride;
      this.scene.background = prevBg;
      for (const [o, v] of restore) o.visible = v;
    }
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    r.shadowMap.autoUpdate = prevAuto;
    this.pending = new THREE.Vector2(cx, cz);
    this.ms = performance.now() - t0;
  }

  /** Second half of a bake: the field from the height map (mips were made on unbind). */
  private field(cx: number, cz: number) {
    const t0 = performance.now();
    const r = this.renderer, prevTarget = r.getRenderTarget();
    const q = this.quad.material as THREE.ShaderMaterial;
    q.uniforms.uSun.value.copy(shared.uMoonDir.value);
    r.setRenderTarget(this.rt);
    r.render(this.qScene, this.qCam);
    r.setRenderTarget(prevTarget);
    shared.uLFBox.value.set(cx - SIZE / 2, cz - SIZE / 2, 1 / SIZE, 1);
    this.bakes++;
    this.ms += performance.now() - t0;
  }
}
