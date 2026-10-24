import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Builder } from './builder';
import { shared, mat } from './materials';
import { NLAMP } from './shaders';
import { makeFire } from './fire';
import { buildLibrary, updateLibrary, pushOutOfSecretDoor } from './library';
import { TEXTS, openCodex, fontsReady } from './codex';
import { field } from './displace';

// Dev page: the library alone.
//   ?cam=x,y,z,yaw,pitch   camera (eye height ~1.65 above the floor)
//   &open                  the hidden door swung open
//   &read=<textId>[,page]  open the reading view
const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x26282c);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 200);
const [x, y, z, yaw, pitch] = (q.get('cam') ?? '-7.9,1.7,-45.4,0,-0.05').split(',').map(Number);
// The room rides the world's terrain; so does the eye.
const off = field(x, 0.5, z, 'wood', new THREE.Vector3());
camera.position.set(x + off.x, y + off.y, z + off.z);
camera.rotation.set(pitch, yaw, 0, 'YXZ');
const b = new Builder();
const t0 = performance.now();
const group = buildLibrary(b, scene);
// The floor under the room, for the test only.
b.box('ground', 12, 0.2, 26, -7.9, -0.25, -54, 0, false);
const { cells } = b.build(scene);
const ms = performance.now() - t0;
scene.add(makeFire(b.flames));
// Interior: the hemisphere is far weaker than in the street.
scene.add(new THREE.HemisphereLight(0x9aa6b8, 0x3a3026, q.has('dark') ? 0.25 : 0.7));
const near = b.lamps.slice().sort((a, c) => a.pos.distanceTo(camera.position) - c.pos.distanceTo(camera.position)).slice(0, NLAMP);
near.forEach((l, i) => {
  const pl = new THREE.PointLight(l.color, l.intensity * 18, 16 * Math.max(0.4, l.intensity), 2);
  pl.position.copy(l.pos);
  scene.add(pl);
  shared.uLampPos.value[i].copy(l.pos);
  shared.uLampCol.value[i].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
});
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.5, 0.85));
composer.addPass(new OutputPass());
let tris = 0;
group.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.geometry) return;
  const n = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  tris += n * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
});
let cellTris = 0;
for (const c of cells) for (const m of c.meshes) cellTris += m.geometry.attributes.position.count / 3;
const w = window as unknown as { __done: boolean; __stats: () => string };
w.__stats = () => `library build ${ms.toFixed(0)} ms · direct ${Math.round(tris)} tris · shell ${Math.round(cellTris)} tris · ${renderer.info.render.calls} calls`;
if (q.has('open')) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
let n = 0;
const read = q.get('read');
async function start() {
  await fontsReady();
  if (read) {
    const [id, page] = read.split(',');
    await openCodex(TEXTS.find((t) => t.id === id)!, Number(page ?? 0), 5);
  }
  frame();
}
function frame() {
  shared.uTime.value = 3 + n * 0.016;
  updateLibrary(camera);
  pushOutOfSecretDoor(camera.position);
  composer.render();
  // The door needs a few seconds of animation before the shot.
  const need = q.has('open') ? 160 : 8;
  if (++n > need) { w.__done = true; return; }
  requestAnimationFrame(frame);
}
void mat;
start();
