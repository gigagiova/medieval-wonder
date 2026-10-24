import * as THREE from 'three';
import { loadMonkAssets, createMonk } from './monk';
import { shared } from './materials';

// Dev page: monks walking a circle at grey dusk. ?t=seconds simulates that much
// time at a fixed step before rendering one frame (for screenshots).
const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5a5f66);
shared.uFogCol.value.setRGB(0.3, 0.31, 0.33);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);
const cam = (params.get('cam') ?? '0,1.5,4.2,0,1.0,0').split(',').map(Number);
camera.position.set(cam[0], cam[1], cam[2]);
camera.lookAt(cam[3], cam[4], cam[5]);
scene.add(new THREE.HemisphereLight(0xb8c0cc, 0x403830, 2.2));
const dir = new THREE.DirectionalLight(0xdfe4ea, 0.7);
dir.position.set(-3, 5, 2);
scene.add(dir);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const lamp = new THREE.PointLight(0xffa050, 3, 6, 2);
scene.add(lamp);

await loadMonkAssets();
const monk = createMonk(scene);
const R = 1.6, speed = Number(params.get('speed') ?? 1.1);
let t = 0;
const step = (dt: number) => {
  t += dt;
  const a = (t * speed) / R;
  const pos = new THREE.Vector3(Math.sin(a) * R, 0, Math.cos(a) * R);
  monk.update(dt, pos, a + Math.PI / 2, speed);
  lamp.position.copy(monk.lanternWorldPos);
};
const T = Number(params.get('t') ?? 0);
const t0 = performance.now();
// Fixed steps with fake frame time so the once-per-frame stepping advances.
for (let i = 0; i < T * 60; i++) {
  step(1 / 60);
  const until = performance.now() + 0.6;
  while (performance.now() < until) { /* let the frame clock tick */ }
}
const simMs = performance.now() - t0;
const follow = () => {
  if (params.has('cam')) return;
  const p = monk.group.position;
  if (params.has('front')) {
    // Ahead of the monk along his path, at eye level.
    const yaw = monk.group.rotation.y;
    camera.position.set(p.x + Math.sin(yaw) * 2.6 + Math.cos(yaw) * 0.6, 1.5, p.z + Math.cos(yaw) * 2.6 - Math.sin(yaw) * 0.6);
  } else camera.position.set(p.x * 2.6, 1.45, p.z * 2.6 + 0.01);
  camera.lookAt(p.x, 1.0, p.z);
};
follow();
renderer.render(scene, camera);
(window as unknown as { __done: boolean; __stats: string }).__stats = ` sim ${T}s in ${simMs.toFixed(0)}ms (${(simMs / Math.max(1, T * 60)).toFixed(2)} ms/frame)`;
(window as unknown as { __done: boolean }).__done = true;
if (!params.has('t')) {
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    follow();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();
}
