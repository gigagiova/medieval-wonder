import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { shared } from './materials';
import { makeFire } from './fire';

// Side-by-side test bench: candle, oil lamp, torch, brazier.
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
const params = new URLSearchParams(location.search);
const close = params.has('close');
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 50);
camera.position.set(close ? 0.9 : 0, close ? 0.55 : 0.9, close ? 0.9 : 2.6);
camera.lookAt(close ? 0.9 : 0, close ? 0.55 : 0.45, 0);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x222018, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const light = new THREE.PointLight(0xff9a50, 6, 6, 2);
light.position.set(0, 0.8, 0.3);
scene.add(light);
const holder = (w: number, h: number, x: number, c = 0x2a1a10) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
  m.position.set(x, h / 2, 0);
  scene.add(m);
};
holder(0.04, 0.25, -1.2, 0xcab890);
holder(0.12, 0.05, -0.6, 0x6a3a20);
holder(0.08, 0.5, 0.15);
holder(0.7, 0.3, 1.1, 0x151210);
scene.add(makeFire([
  { pos: new THREE.Vector3(-1.2, 0.25, 0), kind: 'candle' },
  { pos: new THREE.Vector3(-0.6, 0.05, 0), kind: 'oil' },
  { pos: new THREE.Vector3(0.15, 0.5, 0), kind: 'torch' },
  { pos: new THREE.Vector3(1.1, 0.3, 0), kind: 'brazier' },
]));

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.7, 0.55, 0.82));
composer.addPass(new OutputPass());

const t0 = Number(params.get('t') ?? 3);
let frames = 0;
const clock = new THREE.Clock();
function frame() {
  frames++;
  shared.uTime.value = params.has('shot') ? t0 + frames * 0.016 : clock.getElapsedTime();
  composer.render();
  if (params.has('shot') && frames > 4) { (window as unknown as { __done: boolean }).__done = true; return; }
  requestAnimationFrame(frame);
}
frame();
