import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Builder } from './builder';
import { buildPalace, PALACE_SPOT } from './palace';
import { shared, mat, makeSky } from './materials';
import { NLAMP } from './shaders';
import { makeFire } from './fire';
import { field } from './displace';

// Dev page: the gastald's palace alone. ?cam=x,y,z,yaw,pitch
const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(makeSky());
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 600);
const def = `${PALACE_SPOT.x},1.7,${PALACE_SPOT.z},${PALACE_SPOT.yaw},0.05`;
const [x, y, z, yaw, pitch] = (q.get('cam') ?? def).split(',').map(Number);
const t0 = performance.now();
const b = new Builder();
buildPalace(b, scene);
// Ground around it, bent like the world's.
const g = new THREE.PlaneGeometry(120, 120, 240, 240).rotateX(-Math.PI / 2).translate(40, 0, -23);
const p = g.attributes.position, fv = new THREE.Vector3();
for (let i = 0; i < p.count; i++) { field(p.getX(i), 0, p.getZ(i), 'ground', fv); p.setXYZ(i, p.getX(i) + fv.x, fv.y, p.getZ(i) + fv.z); }
g.computeVertexNormals();
scene.add(new THREE.Mesh(g, mat('ground')));
const { collider } = b.build(scene);
const ms = performance.now() - t0;
// Camera stands on the terrain.
field(x, 0, z, 'ground', fv);
camera.position.set(x, y + fv.y, z);
camera.rotation.set(pitch, yaw, 0, 'YXZ');
scene.add(makeFire(b.flames));
scene.add(new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0));
const near = b.lamps.slice().sort((a, c) => a.pos.distanceTo(camera.position) - c.pos.distanceTo(camera.position)).slice(0, NLAMP);
near.forEach((l, i) => {
  const pl = new THREE.PointLight(l.color, l.intensity * 18, 16 * Math.max(0.4, l.intensity), 2);
  pl.position.copy(l.pos);
  scene.add(pl);
  shared.uLampPos.value[i].copy(l.pos);
  shared.uLampCol.value[i].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
});
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.7, 0.55, 0.82));
composer.addPass(new OutputPass());
let tris = 0;
scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
const w = window as unknown as { __done: boolean; __stats: string };
w.__stats = `palace+build ${ms.toFixed(0)} ms, scene tris ${tris}, collider tris ${collider.geometry.attributes.position.count / 3}, lamps ${b.lamps.length}`;
let n = 0;
function frame() {
  shared.uTime.value = 3 + n * 0.016;
  composer.render();
  if (++n > 6) { w.__done = true; return; }
  requestAnimationFrame(frame);
}
frame();
