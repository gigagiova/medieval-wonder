import * as THREE from 'three';
import { fastTerrain } from './displace';
import { FOG } from './fogcull';

// ?holes: the render audit's debug view (tools/audit-holes-render.mjs,
// docs/HOLES-AUDIT.md). Every material is swapped for a flat one drawn on
// both sides: front faces grey, back faces of one-sided materials pure
// magenta (they are culled in the game: there one sees through them). The
// clear colour is pure green, a fog-grey sphere 120 m out stands for the
// fog, and a copy of the terrain 0.6 m under the real ground is drawn pure
// green within 90 m, so a hole in the ground shows green wherever it is. Both markers give way to grey where the game's fog would
// leave less than 15 % of a surface's colour (FOG, as in fogcull.ts).

const MAGENTA = new THREE.Color(1, 0, 1), GREEN = new THREE.Color(0, 1, 0);
const uni = { uEye: { value: new THREE.Vector3() }, uFogBase: { value: 0 } };
const fogGLSL = /* glsl */ `
uniform vec3 uEye; uniform float uFogBase; varying vec3 vWP;
float seen(){
  float L = length(vWP - uEye), dy = max(vWP.y - uEye.y, 0.0) * ${FOG.b.toFixed(4)};
  float g = dy > 1e-4 ? (1.0 - exp(-dy)) / dy : 1.0;
  return exp(-${FOG.dens.toFixed(4)} * exp(-${FOG.b.toFixed(4)} * (uEye.y - uFogBase)) * L * g);
}`;
function debugMaterial(src: THREE.Material | null, kind: 'surface' | 'ref', pass: 'front' | 'back' = 'front'): THREE.Material {
  const s = src as THREE.MeshStandardMaterial | null;
  // Two passes: front faces first, then back faces that are strictly nearer
  // than what is drawn (depth LESS). A back face that coincides with a front
  // face (a surface given both sides, see bothSides()) loses, as in the game.
  const m = new THREE.MeshBasicMaterial({ side: pass === 'front' ? THREE.FrontSide : THREE.BackSide, toneMapped: false, fog: false });
  if (pass === 'back') m.depthFunc = THREE.LessDepth;
  if (s && (s.alphaTest > 0 || s.transparent) && s.map) { m.map = s.map; m.alphaTest = Math.max(0.5, s.alphaTest); }
  const oneSided = kind === 'surface' && (!s || s.side === THREE.FrontSide);
  // Materials that move their vertices (wind in the vegetation, impostors,
  // the water's flow) keep their own vertex stage: run their hook first.
  const own = s?.onBeforeCompile && /begin_vertex/.test(s.onBeforeCompile.toString()) ? s : null;
  m.onBeforeCompile = (sh, r) => {
    if (own) { own.onBeforeCompile(sh, r); sh.fragmentShader = THREE.ShaderLib.basic.fragmentShader; }
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + fogGLSL)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        vec3 nrm = normalize(cross(dFdx(vWP), dFdy(vWP)));
        float shade = 0.32 + 0.4 * abs(dot(nrm, normalize(vec3(-0.5, 0.8, 0.3)))) + 0.1 * abs(nrm.y);
        vec3 grey = vec3(shade * 0.85, shade * 0.85, shade * 0.9);
        bool vis = seen() > 0.15;
        ${kind === 'ref' ? 'gl_FragColor = vec4(vis ? vec3(0.0, 1.0, 0.0) : grey, 1.0);'
          : oneSided && pass === 'back' ? 'gl_FragColor = vec4(vis ? vec3(1.0, 0.0, 1.0) : grey, 1.0);'
          : 'gl_FragColor = vec4(grey, 1.0);'}`);
  };
  m.customProgramCacheKey = () => `holes-${kind}-${pass}-${oneSided}-${!!m.map}-${own ? own.customProgramCacheKey() : ''}`;
  if (own) (m as unknown as { defines: unknown }).defines = (own as unknown as { defines?: unknown }).defines;
  return m;
}

export interface HolesView {
  /** Swap materials of anything new in the scene; move the reference ground; then draw. */
  render(): void;
  /** Count magenta and green pixels of the last frame (green: below the horizon only). */
  count(): { w: number; h: number; magenta: number; green: number; greenBelow: number };
}

export function initHolesView(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, fogBase: () => number,
  hide: THREE.Object3D[], holes: { x: number; z: number; r: number }[]): HolesView {
  const swapped = new WeakMap<THREE.Material, THREE.Material>();
  const done = new WeakSet<THREE.Object3D>();
  for (const o of hide) o.visible = false;
  renderer.setClearColor(GREEN, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  const backOf = new WeakMap<THREE.Material, THREE.Material>();
  const swapOf = (m: THREE.Material) => {
    let d = swapped.get(m);
    if (!d) { d = debugMaterial(m, 'surface'); swapped.set(m, d); swapped.set(d, d); backOf.set(d, debugMaterial(m, 'surface', 'back')); }
    return d;
  };
  const meshes: THREE.Mesh[] = [];
  // The reference ground: 2 m cells, 90 m round the camera, 0.6 m under the terrain.
  const N = 90, ST = 2;
  const refGeo = new THREE.BufferGeometry();
  const refPos = new Float32Array((N + 1) * (N + 1) * 3);
  refGeo.setAttribute('position', new THREE.BufferAttribute(refPos, 3));
  const idx: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2); }
  refGeo.setIndex(idx);
  const ref = new THREE.Mesh(refGeo, debugMaterial(null, 'ref'));
  ref.frustumCulled = false;
  scene.add(ref);
  // The fog: past 120 m nothing of a surface is left (fogcull.ts), so a grey
  // sphere there, drawn behind everything, stands for it; the clear colour
  // (green) shows only where there is neither a surface nor the fog.
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(120, 24, 12), new THREE.MeshBasicMaterial({ color: 0x8a8d92, side: THREE.BackSide, toneMapped: false, fog: false }));
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -10;
  scene.add(backdrop);
  done.add(backdrop);
  done.add(ref);
  let refAt = '';
  const moveRef = () => {
    const cx = Math.round(camera.position.x / ST) * ST, cz = Math.round(camera.position.z / ST) * ST, key = `${cx},${cz}`;
    if (key === refAt) return;
    refAt = key;
    const x0 = cx - (N / 2) * ST, z0 = cz - (N / 2) * ST;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = x0 + i * ST, z = z0 + j * ST, o = (j * (N + 1) + i) * 3;
      // Stair openings and wells go deeper on purpose: no reference ground there.
      const deep = holes.some((h) => Math.hypot(x - h.x, z - h.z) < h.r);
      refPos[o] = x; refPos[o + 1] = deep ? -1e4 : fastTerrain(x, z) - 0.6; refPos[o + 2] = z;
    }
    refGeo.attributes.position.needsUpdate = true;
  };
  return {
    render() {
      scene.traverse((o) => {
        if (done.has(o)) return;
        const mesh = o as THREE.Mesh;
        if (o === ref || !(mesh.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return;
        if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine) { o.visible = false; done.add(o); return; }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        // Fire, motes and other custom shaders: not surfaces.
        if (mats.some((m) => (m as THREE.ShaderMaterial).isShaderMaterial)) { o.visible = false; o.onBeforeRender = () => { o.visible = false; }; done.add(o); return; }
        mesh.material = Array.isArray(mesh.material) ? mats.map(swapOf) : swapOf(mats[0]);
        mesh.userData.holesFront = mesh.material;
        mesh.userData.holesBack = Array.isArray(mesh.material) ? mesh.material.map((q) => backOf.get(q)!) : backOf.get(mesh.material)!;
        meshes.push(mesh);
        // Pool pages swap their geometry, not their material: once is enough.
        done.add(o);
      });
      moveRef();
      backdrop.position.copy(camera.position);
      uni.uEye.value.copy(camera.position);
      uni.uFogBase.value = fogBase();
      renderer.setRenderTarget(null);
      for (const q of meshes) q.material = q.userData.holesFront;
      renderer.render(scene, camera);
      for (const q of meshes) q.material = q.userData.holesBack;
      const ac = renderer.autoClear, refVis = ref.visible, bVis = backdrop.visible;
      renderer.autoClear = false; ref.visible = false; backdrop.visible = false;
      renderer.render(scene, camera);
      renderer.autoClear = ac; ref.visible = refVis; backdrop.visible = bVis;
      for (const q of meshes) q.material = q.userData.holesFront;
    },
    count() {
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // Rows below the horizon (no roll: it depends on the row only).
      const v = new THREE.Vector3();
      let magenta = 0, green = 0, greenBelow = 0;
      for (let y = 0; y < h; y++) {
        v.set(0, (y + 0.5) / h * 2 - 1, 0.5).unproject(camera).sub(camera.position);
        const below = v.y < 0;
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4, r = px[o], g = px[o + 1], b = px[o + 2];
          if (r > 235 && g < 20 && b > 235) magenta++;
          else if (g > 235 && r < 20 && b < 20) { green++; if (below) greenBelow++; }
        }
      }
      return { w, h, magenta, green, greenBelow };
    },
  };
}
void MAGENTA;
