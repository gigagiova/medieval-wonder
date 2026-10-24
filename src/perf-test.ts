import * as THREE from 'three';
import { shared, makeSky } from './materials';
import { buildWorld } from './world';

// Fixed-view fragment benchmark: ?cam=x,y,z,yaw,pitch&n=10. Reports ms/frame
// on window.__perf (each frame forced to completion with a 1-pixel readback).
const q = new URLSearchParams(location.search);
const [x, y, z, yaw, pitch] = (q.get('cam') ?? '-9,3,19.8,0.22,0.1').split(',').map(Number);
const N = Number(q.get('n') ?? 10);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(makeSky());
const cam = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 900);
const w = await buildWorld(scene);
shared.uTown.value = w.townTex;
const m = (await import('./materials')) as unknown as { texturesReady?: Promise<void> };
if (m.texturesReady) await m.texturesReady;
scene.add(new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0));
cam.position.set(x, y, z);
cam.rotation.set(pitch, yaw, 0, 'YXZ');
const px = new Uint8Array(4);
const gl = renderer.getContext();
const frame = () => { renderer.render(scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
for (let i = 0; i < 3; i++) frame();
const t0 = performance.now();
for (let i = 0; i < N; i++) frame();
const ms = (performance.now() - t0) / N;
(window as unknown as { __perf: string }).__perf = `${ms.toFixed(1)} ms/frame, ${renderer.info.render.triangles} tris, ${renderer.info.programs?.length} programs`;
(window as unknown as { __done: boolean }).__done = true;
