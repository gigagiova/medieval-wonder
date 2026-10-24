import * as THREE from 'three';
import { shared, makeSky } from './materials';
import { buildWorld, getMapData } from './world';

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
const quad = q.get('quad');
// ?quad=<MAT id,...>: fragment cost only — a wall filling the screen, one material at a time.
if (quad !== null) {
  const { makeSurfaceMaterial } = await import('./materials');
  const tex = new THREE.DataTexture(new Uint8Array([0, 255, 0, 128]), 1, 1); tex.needsUpdate = true;
  shared.uTown.value = tex;
  const m = (await import('./materials')) as unknown as { texturesReady?: Promise<void> };
  if (m.texturesReady) await m.texturesReady;
  const out: string[] = [];
  const px = new Uint8Array(4); const gl = renderer.getContext();
  const camQ = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 100);
  camQ.position.set(0.3, 1.6, 1.5); camQ.lookAt(0.3, 1.4, 0);
  for (const id of quad.split(',').map(Number)) {
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0));
    const g = new THREE.PlaneGeometry(8, 6, 8, 6); g.translate(0, 1.5, 0);
    sc.add(new THREE.Mesh(g, makeSurfaceMaterial(id)));
    const fr = () => { renderer.render(sc, camQ); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    for (let i = 0; i < 2; i++) fr();
    const t0 = performance.now();
    for (let i = 0; i < N; i++) fr();
    out.push(`mat ${id}: ${((performance.now() - t0) / N).toFixed(1)} ms`);
  }
  (window as unknown as { __perf: string }).__perf = out.join(' | ');
  (window as unknown as { __done: boolean }).__done = true;
  throw new Error('quad benchmark done');
}
const w = await buildWorld(scene);
shared.uTown.value = w.townTex;
// Side-alley spots (eye positions) for screenshots: x,z,yaw per alley.
(window as unknown as { __alleys: string[] }).__alleys = getMapData().streets.filter((s) => !s.main && s.pts.length > 8).slice(0, 6).map((s) => {
  const i = Math.floor(s.pts.length / 2), p = s.pts[i], q = s.pts[i + 1];
  return `${p.x.toFixed(1)},${p.y.toFixed(1)},${Math.atan2(-(q.x - p.x), -(q.y - p.y)).toFixed(2)} w${s.w.toFixed(1)}`;
});
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
