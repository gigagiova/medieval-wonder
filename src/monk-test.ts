import * as THREE from 'three';
import { loadMonkAssets, createMonk, monkDebug } from './monk';
import { shared } from './materials';

// Dev page: a monk walking a circle at grey dusk.
// ?t=seconds simulates that much time at 60 Hz before rendering one frame.
// ?view=front|side|back|hood|hem picks the camera; ?speed= walking speed.
const params = new URLSearchParams(location.search);
monkDebug.sim = !params.has('nosim');
monkDebug.garment = !params.has('nogarment');
monkDebug.undressed = params.has('undressed');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6a6f76);
shared.uFogCol.value.setRGB(0.15, 0.155, 0.165);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
scene.add(new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0));
const dir = new THREE.DirectionalLight(0xc4ccd6, 0.5);
dir.position.set(-3, 5, 2);
scene.add(dir);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const lamp = new THREE.PointLight(0xffa050, 2.5, 6, 2);
scene.add(lamp);

const tl = performance.now();
await loadMonkAssets();
const loadMs = performance.now() - tl;
const monk = createMonk(scene);
const R = 3, speed = Number(params.get('speed') ?? 1.15);
let t = 0;
const step = (dt: number) => {
  t += dt;
  const a = (t * speed) / R;
  const pos = new THREE.Vector3(Math.sin(a) * R, 0, Math.cos(a) * R);
  monk.update(dt, pos, a + Math.PI / 2, speed);
  lamp.position.copy(monk.lanternWorldPos);
};
const T = Number(params.get('t') ?? 0);
const n = Math.round(T * 60);
const t0 = performance.now();
for (let i = 0; i < n; i++) step(1 / 60);
const simMs = performance.now() - t0;
const view = params.get('view') ?? 'side';
const place = () => {
  const p = monk.group.position;
  const yaw = monk.group.rotation.y;
  const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), s = new THREE.Vector3(f.z, 0, -f.x);
  const at = (d: THREE.Vector3, dist: number, h: number, look: number) => {
    camera.position.copy(p).addScaledVector(d, dist).setY(h);
    camera.lookAt(p.x, look, p.z);
  };
  if (view === 'front') at(f, 3.2, 1.35, 0.95);
  else if (view === 'back') at(f.clone().negate(), 3.2, 1.35, 0.95);
  else if (view === 'hood') { at(f.clone().add(s.clone().multiplyScalar(0.35)).normalize(), 1.1, 1.62, 1.55); }
  else if (view === 'hem') at(s.clone().add(f.clone().multiplyScalar(0.3)).normalize(), 2.0, 0.6, 0.35);
  else at(s, 3.2, 1.3, 0.95);
};
place();
renderer.render(scene, camera);
(window as unknown as { __stats: string }).__stats = `load ${loadMs.toFixed(0)} ms; ${n} frames in ${simMs.toFixed(0)} ms = ${(simMs / Math.max(1, n)).toFixed(2)} ms/frame; prof ${Object.entries(monkDebug.prof).map(([k, v]) => k + ' ' + (v / Math.max(1, n)).toFixed(2)).join(', ')}; ao ${monkDebug.ao}`;
(window as unknown as { __done: boolean }).__done = true;
if (!params.has('t')) {
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    place();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();
}
