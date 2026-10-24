import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { shared, makeSky, makeSurfaceMaterial, MAT } from './materials';
import { Builder } from './builder';
import { buildForest } from './forest';
import { field } from './displace';
import { loadProps } from './props';

// Dev page: ?cam=x,y,z,yaw,pitch [&world] [&frames=n]
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
let inside = (x: number, z: number) => Math.hypot(x, z) < 72;
let keepOut = (x: number, z: number) => Math.abs(x - 3) < 7 && z > 60 && z < 200;
await loadProps();
const b = new Builder();
if (params.has('world')) {
  const w = await import('./world');
  const res = await w.buildWorld(scene);
  shared.uTown.value = res.townTex;
  const md = w.getMapData();
  const poly = md.wall;
  inside = (x, z) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], bb = poly[j];
      if ((a.y > z) !== (bb.y > z) && x < ((bb.x - a.x) * (z - a.y)) / (bb.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const g = md.gate;
  const [a0, a1] = md.aqueduct;
  keepOut = (x, z) => {
    if (Math.hypot(x - g.x, z - g.y) < 20) return true;
    if (z > g.y && Math.abs(x - g.x - Math.sin(z * 0.05) * 2) < 18) return true;
    const ab = a1.clone().sub(a0), ap = new THREE.Vector2(x - a0.x, z - a0.y);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
    return ap.sub(ab.multiplyScalar(t)).length() < 6;
  };
} else {
  // A plain ground grid with the real ground material and displacement.
  const n = 240, S = 480;
  const g = new THREE.PlaneGeometry(S, S, n, n).rotateX(-Math.PI / 2);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { field(p.getX(i), 0, p.getZ(i), 'ground', v); p.setY(i, v.y); }
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, makeSurfaceMaterial(MAT.ground)));
  // A stand-in for the town wall.
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(72, 72, 9, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x5a524a, side: THREE.DoubleSide }));
  wall.position.y = 4;
  scene.add(wall);
}
const forest = buildForest(scene, b, { inside, keepOut });
const buildMs = performance.now() - t0;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.7, 0.55, 0.82));
composer.addPass(new OutputPass());

const [x, y, z, yaw, pitch] = (params.get('cam') ?? '0,1.7,110,0,0').split(',').map(Number);
camera.position.set(x, y + field(x, 0, z, 'ground', new THREE.Vector3()).y, z);
camera.rotation.set(pitch ?? 0, yaw ?? 0, 0, 'YXZ');
camera.updateMatrixWorld();
shared.uTime.value = 3;
const frames = +(params.get('frames') ?? 4);
let f = 0;
function loop() {
  composer.render();
  if (++f >= frames) {
    const st = forest.userData.stats();
    (window as any).__stats = () => `build ${buildMs.toFixed(0)}ms kinds ${st.kinds} instances ${st.instances} tris/set ${st.trianglesPerSet} drawn ${st.drawn} colliderTris ${b.colliders.reduce((a, g) => a + g.attributes.position.count / 3, 0)}`;
    (window as any).__done = true;
    return;
  }
  requestAnimationFrame(loop);
}
loop();
