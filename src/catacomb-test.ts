import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Builder } from './builder';
import { buildCatacombs } from './catacombs';
import { shared, MAT, makeSurfaceMaterial, mat } from './materials';
import { NLAMP } from './shaders';
import { makeFire } from './fire';
import { makeBones } from './bones';

// Dev page: the carved catacombs alone. ?cam=x,y,z,yaw,pitch
const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);
const [x, y, z, yaw, pitch] = (q.get('cam') ?? '-36,-5.35,-64,0,0').split(',').map(Number);
camera.position.set(x, y, z);
camera.rotation.set(pitch, yaw, 0, 'YXZ');
shared.uUnder.value = 1;
const b = new Builder();
const t0 = performance.now();
buildCatacombs(b);
const ms = performance.now() - t0;
const { cells } = b.build(scene);
if (q.has('nopom')) {
  const done = new Set<THREE.Material>();
  for (const c of cells) for (const m of c.meshes) {
    const mm = m.material as THREE.MeshStandardMaterial;
    if (done.has(mm)) continue;
    done.add(mm);
    const prev = mm.onBeforeCompile;
    const key = mm.customProgramCacheKey();
    mm.onBeforeCompile = (sh, r) => { prev.call(mm, sh, r); sh.fragmentShader = sh.fragmentShader.replace(/#define POM_DEPTH [0-9.]+/g, '#define POM_DEPTH 0.0001'); };
    mm.customProgramCacheKey = () => key + 'nopom';
  }
}
scene.add(makeFire(b.flames));
const bones = makeBones();
const boneMat = makeSurfaceMaterial(MAT.bone);
boneMat.vertexColors = true;
for (const kind of ['skull', 'femur', 'humerus', 'tibia'] as const) {
  const list = b.props.filter((p) => p.kind === kind);
  if (!list.length) continue;
  const im = new THREE.InstancedMesh(bones[kind], boneMat, list.length);
  list.forEach((p, i) => im.setMatrixAt(i, p.matrix));
  scene.add(im);
}
scene.add(new THREE.HemisphereLight(0x332a22, 0x000000, 0.05));
if (q.has('ground')) {
  // Street level with the stair opening, as world.ts builds it.
  const sh = new THREE.Shape();
  sh.moveTo(-60, 30); sh.lineTo(-10, 30); sh.lineTo(-10, 80); sh.lineTo(-60, 80); sh.closePath();
  const h = new THREE.Path();
  h.moveTo(-37.5, 52); h.lineTo(-34.5, 52); h.lineTo(-34.5, 56); h.lineTo(-37.5, 56); h.closePath();
  sh.holes.push(h);
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  scene.add(new THREE.Mesh(g, mat('ground')));
  scene.add(new THREE.HemisphereLight(0x8899aa, 0x222018, 1.2));
  shared.uUnder.value = 0;
}
// Nearest lamps as point lights, plus a lantern at the camera.
const near = b.lamps.slice().sort((a, c) => a.pos.distanceTo(camera.position) - c.pos.distanceTo(camera.position)).slice(0, NLAMP);
near.forEach((l, i) => {
  const pl = new THREE.PointLight(l.color, l.intensity * 18, 16, 2);
  pl.position.copy(l.pos);
  scene.add(pl);
  shared.uLampPos.value[i].copy(l.pos);
  shared.uLampCol.value[i].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
});
if (q.has('lantern')) {
  const lan = new THREE.PointLight(0xffa860, 9, 14, 2);
  lan.position.copy(camera.position).add(new THREE.Vector3(0.3, -0.4, -0.3).applyEuler(camera.rotation));
  scene.add(lan);
}
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.7, 0.55, 0.82));
composer.addPass(new OutputPass());
let n = 0;
const w = window as unknown as { __done: boolean; __stats: string };
w.__stats = `catacombs ${ms.toFixed(0)} ms`;
function frame() {
  shared.uTime.value = 3 + n * 0.016;
  composer.render();
  if (++n > 6) { w.__done = true; return; }
  requestAnimationFrame(frame);
}
frame();
