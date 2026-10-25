import * as THREE from 'three';
(window as unknown as { __npc: unknown }).__npc = await import('./npc');
import { loadNpcAssets, makePerson, spawnTownsfolk, updateTownsfolk, npcDebug, type Role, type Person } from './npc';
import { shared } from './materials';
import type { Lamp } from './builder';

// Dev page for the townsfolk.
//   ?view=lineup  every outfit side by side (&cam=front|side|back, &anim=idle|walk|talk|bless|kneel, &focus=i, &t=s)
//   ?view=town    a little street plan full of people (&t=s simulated seconds)
//   ?view=talk    walk up to someone and speak (&t=s)
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'lineup';
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
const ground = (x: number, z: number) => (view === 'lineup' ? 0 : Math.sin(x * 0.08) * 0.6 + Math.cos(z * 0.06) * 0.5);
{
  const g = new THREE.PlaneGeometry(120, 120, 60, 60).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1 })));
}
const T = Number(params.get('t') ?? 0);
const t0 = performance.now();
await loadNpcAssets();
const loadMs = performance.now() - t0;
const stats = (window as unknown as { __stats: Record<string, unknown> });
stats.__stats = { heads: (npcDebug as unknown as { heads: unknown }).heads, stripped: (npcDebug as unknown as { stripped: number[] }).stripped, loadMs: Math.round(loadMs), build: Object.fromEntries(Object.entries(npcDebug.buildMs).map(([k, v]) => [k, Math.round(v)])) };

let step: (dt: number) => void;
let place: () => void;
const lamps: Lamp[] = [];
const lights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xffa050, 0, 7, 2); scene.add(l); return l; });
const lampsToLights = () => lamps.slice(0, 4).forEach((l, i) => { lights[i].position.copy(l.pos); lights[i].intensity = 2.5; });

if (view === 'lineup') {
  let anim = params.get('anim') ?? 'idle';
  (window as unknown as { __setAnim: (a: string) => void }).__setAnim = (a) => { anim = a; };
  const cast: [Role, number, object][] = [
    ['monk', 0, { lantern: true }], ['peasant', 0, { sticks: true }], ['peasant', 1, { cap: true, bucket: true }],
    ['woman', 0, { jar: true }], ['woman', 1, { basket: true }],
    ['soldier', 0, { arms: true, spear: true, helmet: true, shield: 'back' }], ['soldier', 1, { arms: true, spear: true, shield: 'arm' }],
  ];
  // &cast=woman:0:jar,woman:1:basket — just these people (gear flags joined by +).
  if (params.get('cast')) cast.splice(0, cast.length, ...params.get('cast')!.split(',').map((c) => { const [r, o, g] = c.split(':'); return [r as Role, Number(o), Object.fromEntries((g ?? '').split('+').filter(Boolean).map((k) => [k, true]))] as [Role, number, object]; }));
  const people: Person[] = cast.map(([r, o, g], i) => {
    const p = makePerson(scene, r, { outfit: o, seed: 11 + i * 31, gear: g });
    p.pos.set((i - (cast.length - 1) / 2) * 1.15, 0, 0);
    if (p.lamp) lamps.push(p.lamp);
    return p;
  });
  const cam = params.get('cam') ?? 'front';
  const focus = params.has('focus') ? Number(params.get('focus')) : -1;
  let t = 0;
  step = (dt) => {
    t += dt;
    for (const p of people) {
      for (const k of Object.keys(p.want) as (keyof typeof p.want)[]) p.want[k] = k === anim ? 1 : 0;
      p.speed = anim === 'walk' ? 1.15 : 0;
      p.yaw = cam === 'side' ? Math.PI / 2 : cam === 'back' ? Math.PI : 0;
      if (cam === 'back') p.yaw = 0;
      p.animate(dt, 1, null);
      p.group.updateMatrixWorld(true);
      p.cloth.setSimulating(params.get('sim') !== '0');
      p.cloth.update(dt, p.pos);
      p.carry(dt);
    }
  };
  place = () => {
    const c = focus >= 0 ? people[focus].pos : new THREE.Vector3();
    const zoom = params.has('zoom');
    const d = zoom ? 1.0 : focus >= 0 ? 3.4 : 9.5, h = zoom ? 1.45 : focus >= 0 ? 1.15 : 1.1;
    const dir = cam === 'back' ? new THREE.Vector3(0, 0, -1) : cam === 'side' ? new THREE.Vector3(0.6, 0, 1).normalize() : new THREE.Vector3(0, 0, 1);
    camera.position.copy(c).addScaledVector(dir, d).setY(h + 0.2);
    camera.lookAt(c.x, zoom ? 1.45 : focus >= 0 ? 0.95 : 0.85, c.z);
  };
} else {
  // A small town plan: a winding main street from a gate, side lanes, a square.
  const P = (pts: number[][]) => pts.map(([x, z]) => new THREE.Vector2(x, z));
  const streets = [
    { pts: P([[0, -34], [1, -24], [-0.5, -14], [0.8, -4], [0, 6], [1.5, 16], [0.5, 26]]), w: 3.2, main: true },
    { pts: P([[0.8, -4], [8, -5], [15, -3], [22, -4]]), w: 2.4 },
    { pts: P([[-0.5, -14], [-8, -13], [-15, -15]]), w: 2.2 },
    { pts: P([[1.5, 16], [8, 17], [12, 22], [10, 28]]), w: 2.6 },
    { pts: P([[0, 6], [-7, 7], [-12, 4]]), w: 2.4 },
  ];
  const places = [{ name: 'Porta', x: 0, z: -36 }, { name: 'Palatium', x: 20, z: -8 }, { name: 'Atrium', x: -9, z: 9.5 }, { name: 'Templum', x: 9, z: 18 }];
  spawnTownsfolk(scene, { streets, ground, lamps, places, count: Number(params.get('count') ?? 18) });
  const player = { pos: new THREE.Vector3(0.5, ground(0.5, -27) + 1.6, -27) };
  let yaw = 0;
  if (view === 'talk') {
    // Stand in front of the gate guards.
    const g = npcDebug.people.find((p) => p.role === 'soldier')!;
    const f = new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw));
    player.pos.set(g.pos.x + f.x * 2.1 + 0.3, g.pos.y + 1.6, g.pos.z + f.z * 2.1);
    yaw = Math.atan2(g.pos.x - player.pos.x, g.pos.z - player.pos.z);
  }
  step = (dt) => {
    if (view === 'town') place(); else { camera.position.copy(player.pos); camera.rotation.set(-0.08, yaw + Math.PI, 0, 'YXZ'); }
    camera.updateMatrixWorld();
    updateTownsfolk(dt, camera, player);
  };
  place = () => {
    if (view === 'town') {
      const v = (params.get('cam') ?? '5,4.5,-40,0,0.5,-26').split(',').map(Number);
      camera.position.set(v[0], v[1], v[2]);
      camera.lookAt(v[3], v[4], v[5]);
    } else {
      camera.position.copy(player.pos);
      camera.rotation.set(-0.12, yaw + Math.PI, 0, 'YXZ');

    }
  };
}

const n = Math.round(T * 60);
const ts = performance.now();
for (let i = 0; i < n; i++) {
  // The talk view speaks up a second in, then watches the reply.
  if (view === 'talk' && i === 60) document.getElementById('talkbtn')?.click();
  step(1 / 60);
}
const simMs = performance.now() - ts;
place();
lampsToLights();
renderer.render(scene, camera);
const f = Math.max(1, npcDebug.prof.frames || n);
const c = npcDebug.cloth;
Object.assign(stats.__stats, {
  frames: n, msPerFrame: +(simMs / Math.max(1, n)).toFixed(2),
  town: { logic: +(npcDebug.prof.logic / f).toFixed(3), anim: +(npcDebug.prof.anim / f).toFixed(3) },
  clothPerSim: c.frames ? { skin: +(c.skin / c.frames).toFixed(3), sim: +(c.sim / c.frames).toFixed(3), normals: +(c.normals / c.frames).toFixed(3) } : null,
  people: npcDebug.people.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
  speeds: npcDebug.people.slice(0, 1).map((p) => p.walkSpeed),
});
// Audit hooks: step the simulation and re-render from a script.
(window as unknown as { __api: unknown }).__api = { THREE, scene, camera, renderer, people: npcDebug.people, step: (dt: number) => step(dt), render: () => { lampsToLights(); renderer.render(scene, camera); } };
(window as unknown as { __done: boolean }).__done = true;
if (!params.has('t')) {
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    place();
    lampsToLights();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();
}
