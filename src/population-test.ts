import * as THREE from 'three';
import { loadNpcAssets, npcDebug, type Person } from './npc';
import { shared } from './materials';
import { fabricTextures } from './npc/fabric';
import { registerPopulationOutfits, makeOfGroup, GROUPS } from './npc/population';
import { makeWorkProp, type WorkProp } from './npc/population-props';
import type { GroupId } from './npc/lines-people';

// Dev page for the people of src/npc/population.ts.
//   ?groups=a,b,c   who stands in the line (default: every group); &seed=n, &gap=m
//   &cam=front|side|back, &focus=i (talk distance), &zoom (face), &anim=idle|walk|talk|kneel, &t=s
//   &props=anvil,stall,…  work props set out behind the line
const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5a5f66);
shared.uFogCol.value.setRGB(0.15, 0.155, 0.165);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 300);
scene.add(new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0));
const sun = new THREE.DirectionalLight(0xc4ccd6, 0.6);
sun.position.set(-3, 5, 4);
scene.add(sun);
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1 })));
registerPopulationOutfits();
const t0 = performance.now();
await loadNpcAssets();
const loadMs = performance.now() - t0;
const ids = (params.get('groups')?.split(',') ?? Object.keys(GROUPS)) as GroupId[];
const seed = Number(params.get('seed') ?? 1);
const gap = Number(params.get('gap') ?? 1.05);
const makeMs: number[] = [];
const people: Person[] = ids.map((id, i) => {
  const tm = performance.now();
  const p = makeOfGroup(scene, id, seed * 1000 + i * 31, { outfit: params.has('outfit') ? Number(params.get('outfit')) : undefined }).person;
  makeMs.push(Math.round(performance.now() - tm));
  p.pos.set((i - (ids.length - 1) / 2) * gap, 0, 0);
  return p;
});
for (const [i, k] of (params.get('props')?.split(',') ?? []).entries()) {
  const pr = makeWorkProp(k as WorkProp, i + 1);
  pr.position.set((i - 1) * 2.4, 0, -2.2);
  scene.add(pr);
}
const anim = params.get('anim') ?? 'idle', cam = params.get('cam') ?? 'front';
const focus = params.has('focus') ? Number(params.get('focus')) : -1;
const step = (dt: number) => {
  for (const p of people) {
    for (const k of Object.keys(p.want) as (keyof typeof p.want)[]) p.want[k] = k === anim ? 1 : 0;
    p.speed = anim === 'walk' ? 1.15 : 0;
    p.yaw = cam === 'side' ? Math.PI / 2 : cam === 'back' ? Math.PI : 0;
    p.animate(dt, 1, null);
    p.group.updateMatrixWorld(true);
    p.cloth.setSimulating(true);
    p.cloth.update(dt, p.pos);
    p.carry(dt);
  }
};
const n = Math.round(Number(params.get('t') ?? 1) * 60);
for (let i = 0; i < n; i++) step(1 / 60);
const pending = () => { let k = 0; for (const f of ['tabby', 'twill', 'felt', 'linen', 'leather'] as const) { const x = fabricTextures(f); if (!x.detail.image || !x.normal.image) k++; } return k; };
const t1 = performance.now();
while (pending() && performance.now() - t1 < 10000) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 1500));
const c = focus >= 0 ? people[focus].pos : new THREE.Vector3();
const zoom = params.has('zoom');
const fit = (ids.length * gap + 0.6) / 2 / (Math.tan(THREE.MathUtils.degToRad(17.5)) * camera.aspect);
const d = zoom ? 1.1 : focus >= 0 ? 2.6 : Math.max(4, fit), h = zoom ? 1.4 : focus >= 0 ? 1.45 : 1.2;
const dir = cam === 'back' ? new THREE.Vector3(0, 0, -1) : cam === 'side' ? new THREE.Vector3(0.6, 0, 1).normalize() : new THREE.Vector3(0, 0, 1);
camera.position.copy(c).addScaledVector(dir, d).setY(h + 0.2);
camera.lookAt(c.x, zoom ? 1.4 : focus >= 0 ? 1.2 : 0.85, c.z);
renderer.render(scene, camera);
(window as unknown as { __stats: unknown }).__stats = { loadMs: Math.round(loadMs), build: npcDebug.buildMs, makeMs, names: people.map((p) => `${p.name} · ${p.title}`), calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
(window as unknown as { __done: boolean }).__done = true;
