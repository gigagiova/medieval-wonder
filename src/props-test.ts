import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { loadProps, placeProp, commitProps, PROP_IDS, propVariants, propSize } from './props';
import { shared, mat, makeSky } from './materials';

// Dev page: every prop in a grid. ?cam=x,y,z,yaw,pitch  ?only=id,id
const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(makeSky());
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 600);
const ids = (q.get('only')?.split(',') ?? PROP_IDS) as typeof PROP_IDS[number][];
await loadProps(ids);
const info: string[] = [];
ids.forEach((id, i) => {
  const x = (i % 8) * 3, z = Math.floor(i / 8) * 3;
  const nv = propVariants(id);
  for (let v = 0; v < Math.min(nv, 3); v++) placeProp(scene, id, x + v * 0.9 - (Math.min(nv, 3) - 1) * 0.45, 0, z, 0.5, 1, { raw: true, variant: v });
  const s = propSize(id);
  info.push(`${id}:${nv}v ${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}`);
});
commitProps(scene);
const g = new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2).translate(10, 0, 6);
scene.add(new THREE.Mesh(g, mat('ground')));
const [x, y, z, yaw, pitch] = (q.get('cam') ?? '10.5,9,22,0,-0.45').split(',').map(Number);
camera.position.set(x, y, z);
camera.rotation.set(pitch, yaw, 0, 'YXZ');
scene.add(new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0));
const pl = new THREE.PointLight(0xffaa66, 60, 30, 2); pl.position.set(x - 2, y - 2, z - 4); scene.add(pl);
shared.uFogCol.value.setRGB(0.15, 0.155, 0.165);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
const w = window as unknown as { __done: boolean; __stats: string };
w.__stats = info.join('\n');
let n = 0;
function frame() {
  composer.render();
  if (++n > 6) { w.__done = true; return; }
  requestAnimationFrame(frame);
}
frame();
