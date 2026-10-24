import * as THREE from 'three';
import { makeBones } from './bones';

// Ossuary shelf test bench for the procedural bones.
const params = new URLSearchParams(location.search);
const t0 = performance.now();
const B = makeBones();
const ms = performance.now() - t0;
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050403);
const view = params.get('view') ?? 'shelf';
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 20);
const bone = new THREE.MeshStandardMaterial({ color: 0x8a7d62, roughness: 0.7, vertexColors: true });
const shelfMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.95 });
const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(g, bone);
  m.position.set(x, y, z); m.rotation.set(0, ry, rz);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
};
if (view === 'shelf') {
  for (const y of [0, 0.42]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.4), shelfMat);
    s.position.set(0, y - 0.025, 0); s.receiveShadow = true; scene.add(s);
    // Back row of stacked long bones, front row of skulls.
    for (let i = 0; i < 4; i++) add([B.femur, B.tibia, B.humerus][i % 3], -0.6 + i * 0.4, y, -0.12 + (i % 2) * 0.02, (i % 2) * 0.1);
    for (let i = 0; i < 4; i++) add([B.femur, B.humerus][i % 2], -0.55 + i * 0.4, y + 0.035, -0.08, -0.08);
    for (let i = 0; i < 6; i++) add(B.skull, -0.85 + i * 0.34, y, 0.07, (i - 2.5) * 0.12 + Math.sin(i * 3) * 0.2);
  }
  add(B.jaw!, 0.9, 0.0, 0.17, 0.4);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), shelfMat);
  back.position.set(0, 0.5, -0.25); scene.add(back);
  camera.position.set(0.15, 0.55, 1.55);
  camera.lookAt(0, 0.25, 0);
} else {
  // Close-up of one skull with jaw, three-quarter view.
  add(B.skull, 0, 0, 0, 0);
  add(B.jaw!, 0.22, 0.0, 0.05, -0.5);
  add(B.femur, 0, 0, -0.35, 0);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shelfMat);
  f.rotation.x = -Math.PI / 2; f.position.y = -0.03; f.receiveShadow = true; scene.add(f);
  const a = Number(params.get('a') ?? 0.6);
  camera.position.set(Math.sin(a) * 0.55, 0.16, Math.cos(a) * 0.55);
  camera.lookAt(0, 0.07, 0);
}
const light = new THREE.PointLight(0xffc890, 7, 6, 2);
light.position.set(-0.9, 0.9, 0.9);
light.castShadow = true;
scene.add(light);
scene.add(new THREE.HemisphereLight(0x303848, 0x100c08, 0.25));
renderer.render(scene, camera);
renderer.render(scene, camera);
document.title = `build ${ms.toFixed(0)}ms skull ${tris(B.skull)} jaw ${tris(B.jaw!)} femur ${tris(B.femur)} humerus ${tris(B.humerus)} tibia ${tris(B.tibia)}`;
(window as unknown as { __done: boolean }).__done = true;
