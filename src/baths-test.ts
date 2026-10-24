import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { shared, makeSky } from './materials';
import { NLAMP } from './shaders';
import { Builder } from './builder';
import { buildBaths, BATHS_SPOT } from './baths';
import { makeFire } from './fire';
import { terrain } from './displace';
import { loadProps } from './props';

// Dev page for the thermae: ?cam=x,y,z,yaw,pitch (y above local ground) [&frames=n]
const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 900);
scene.add(makeSky());
scene.add(new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0));
const dl = new THREE.DirectionalLight(0xc4ccd6, 0.5);
dl.position.set(-0.9, 0.3, 0.4);
scene.add(dl);

const t0 = performance.now();
await loadProps();
const b = new Builder();
// Ground around the site.
const gg = new THREE.PlaneGeometry(120, 120, 120, 120).rotateX(-Math.PI / 2).translate(-33, 0, 24);
b.add(gg, 'ground', undefined, true, true);
buildBaths(b, scene);
const { collider } = b.build(scene);
scene.add(makeFire(b.flames));
const buildMs = performance.now() - t0;

// Lamps: the nearest ten feed point lights and the fog halos.
const pool: THREE.PointLight[] = [];
for (let i = 0; i < NLAMP; i++) { const l = new THREE.PointLight(0xffaa66, 0, 16, 2); scene.add(l); pool.push(l); }

const [cx, cy, cz, yaw, pitch] = (params.get('cam') ?? `${BATHS_SPOT.x},1.7,${BATHS_SPOT.z},${BATHS_SPOT.yaw},0`).split(',').map(Number);
camera.position.set(cx, cy + terrain(cx, cz) + 1.4 * 0, cz);
camera.rotation.set(pitch ?? 0, yaw, 0, 'YXZ');

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.7, 0.55, 0.82));
composer.addPass(new OutputPass());

let tris = 0;
scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.index) tris += m.geometry.index.count / 3; else if (m.isMesh) tris += m.geometry.attributes.position.count / 3; });
const frames = Number(params.get('frames') ?? 6);
let n = 0;
function frame() {
  shared.uTime.value = 4 + n * 0.05;
  const lamps = [...b.lamps].sort((a, c) => a.pos.distanceToSquared(camera.position) - c.pos.distanceToSquared(camera.position));
  for (let i = 0; i < NLAMP; i++) {
    const l = lamps[i];
    if (!l) { pool[i].intensity = 0; shared.uLampCol.value[i].set(0, 0, 0); shared.uLampPos.value[i].set(0, -999, 0); continue; }
    pool[i].position.copy(l.pos); pool[i].color.copy(l.color); pool[i].intensity = l.intensity * 18;
    shared.uLampPos.value[i].copy(l.pos);
    shared.uLampCol.value[i].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
  }
  composer.render();
  if (++n >= frames) {
    (window as unknown as { __done: boolean; __stats: string }).__stats = `build ${buildMs.toFixed(0)}ms, scene tris ${Math.round(tris)}, collider tris ${collider.geometry.attributes.position.count / 3}`;
    (window as unknown as { __done: boolean }).__done = true;
    return;
  }
  requestAnimationFrame(frame);
}
frame();
