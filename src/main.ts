import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MeshBVH } from 'three-mesh-bvh';
import { shared, mat, MAT, makeSurfaceMaterial, makeSky, makeMotes } from './materials';
import { makeFire } from './fire';
import { makeBones } from './bones';
import { NLAMP } from './shaders';
import { buildWorld, SPAWN, regionName, mainLane, getTeleports, type Teleport } from './world';
import { terrain } from './displace';
import { Player } from './player';
import { Soundscape } from './audio';
import { initMap } from './map';
import { updateLibrary, pushOutOfSecretDoor } from './library';
import { isReading } from './codex';
import { loadMonkAssets, createMonk } from './monk';
import type { Lamp, Cell, PropKind } from './builder';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 900);
scene.add(makeSky());

// Title card shows progress while the world is built in stages; any failure
// is written on the card instead of leaving it hanging.
const enterEl = document.querySelector('#overlay .enter')!;
const progress = async (label: string, frac: number) => {
  enterEl.textContent = `${label}… ${Math.round(frac * 100)}%`;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
};
addEventListener('error', (e) => { enterEl.textContent = 'Something went wrong: ' + (e.message || e.error); });
addEventListener('unhandledrejection', (e) => { enterEl.textContent = 'Something went wrong: ' + (e.reason?.message ?? e.reason); });
await progress('Lighting the lamps', 0);
const t0 = performance.now();
const { collider, cells, lamps, flames, props, townTex } = await buildWorld(scene, progress);
shared.uTown.value = townTex;
(window as unknown as { __camera: THREE.Camera }).__camera = camera;
const bvh = new MeshBVH(collider.geometry);
(collider.geometry as unknown as { boundsTree: MeshBVH }).boundsTree = bvh;
const buildMs = performance.now() - t0;

// Moonlight and a faint sky fill.
// Overcast dusk: the sun is just down; light comes from the whole sky,
// a little warmer from the west. No hard shadows.
const moon = new THREE.DirectionalLight(0xc4ccd6, 0.5);
moon.castShadow = false;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 });
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 0.04;
scene.add(moon, moon.target);
const hemi = new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0);
scene.add(hemi);

// A fixed pool of point lights reassigned every frame to the nearest lamps.
const pool: THREE.PointLight[] = [];
for (let i = 0; i < NLAMP; i++) {
  const l = new THREE.PointLight(0xffaa66, 0, 16, 2);
  scene.add(l);
  pool.push(l);
}
const lantern = new THREE.PointLight(0xffa860, 0, 14, 2);
scene.add(lantern);
let lanternOn = false;

// Fire, split by zone so the whole underground can be switched off at once.
const fireAbove = makeFire(flames.filter((f) => f.pos.y > -2.5));
const fireUnder = makeFire(flames.filter((f) => f.pos.y <= -2.5));
scene.add(fireAbove, fireUnder);

// Bones: sculpted geometry, one instanced draw per kind and zone.
// Two levels of detail; instances are re-sorted into near / far / culled
// every few frames by distance and view direction.
const bonesHi = makeBones(1), bonesLo = makeBones(2.6);
const boneMat = makeSurfaceMaterial(MAT.bone);
boneMat.vertexColors = true;
boneMat.customProgramCacheKey = () => 'bone-vc';
const boneGroups: { kind: PropKind; list: typeof props; pos: THREE.Vector3[]; hi: THREE.InstancedMesh; lo: THREE.InstancedMesh }[] = [];
for (const kind of ['skull', 'femur', 'humerus', 'tibia'] as PropKind[]) {
  const list = props.filter((p) => p.kind === kind);
  if (!list.length) continue;
  const mk = (g: THREE.BufferGeometry) => {
    const im = new THREE.InstancedMesh(g, boneMat, list.length);
    im.count = 0;
    im.frustumCulled = false;
    im.receiveShadow = true;
    scene.add(im);
    return im;
  };
  boneGroups.push({ kind, list, pos: list.map((p) => new THREE.Vector3().setFromMatrixPosition(p.matrix)), hi: mk(bonesHi[kind]), lo: mk(bonesLo[kind]) });
}
const camDir = new THREE.Vector3(), toP = new THREE.Vector3();
function updateBones(showAbove: boolean, showUnder: boolean) {
  camera.getWorldDirection(camDir);
  for (const g of boneGroups) {
    let nh = 0, nl = 0;
    g.list.forEach((p, i) => {
      if (!(p.under ? showUnder : showAbove)) return;
      toP.subVectors(g.pos[i], camera.position);
      const d = toP.length();
      if (d > 26 || (d > 2 && toP.dot(camDir) < -0.3 * d)) return;
      if (d < 5) g.hi.setMatrixAt(nh++, p.matrix);
      else g.lo.setMatrixAt(nl++, p.matrix);
    });
    g.hi.count = nh; g.lo.count = nl;
    g.hi.instanceMatrix.needsUpdate = true;
    g.lo.instanceMatrix.needsUpdate = true;
  }
}
scene.add(makeMotes());

// Monks: rigged, animated bodies under cloth-simulated habits (Bullet soft
// bodies), each carrying a horn lantern that feeds the light pool.
function makeMonk(path: (t: number) => THREE.Vector3, rate: number) {
  const monk = createMonk(scene);
  const lamp: Lamp = { pos: new THREE.Vector3(), color: new THREE.Color(1, 0.5, 0.18), intensity: 0.5, under: false, seed: Math.random() * 50 };
  lamps.push(lamp);
  let t = Math.random() * 100;
  const prev = path(t);
  return (dt: number) => {
    t += dt * rate;
    const p = path(t), q = path(t + 0.05);
    const speed = dt > 0 ? p.distanceTo(prev) / dt : 0;
    prev.copy(p);
    monk.update(dt, p, Math.atan2(q.x - p.x, q.z - p.z), Math.min(speed, 2));
    lamp.pos.copy(monk.lanternWorldPos);
  };
}
// One monk walks the lane between the gate and the abbey, back and forth;
// another paces the atrium.
const lane = mainLane();
const laneLen = lane.reduce((a, p, i) => (i ? a + p.distanceTo(lane[i - 1]) : 0), 0);
const onLane = (t: number) => {
  let s = (Math.asin(Math.sin(t * 0.02)) / (Math.PI / 2) * 0.5 + 0.5) * laneLen * 0.9 + laneLen * 0.05;
  for (let i = 1; i < lane.length; i++) {
    const d = lane[i].distanceTo(lane[i - 1]);
    if (s <= d) {
      const p = lane[i - 1].clone().lerp(lane[i], s / d);
      return new THREE.Vector3(p.x + 0.45, terrain(p.x, p.y), p.y);
    }
    s -= d;
  }
  const e = lane[lane.length - 1];
  return new THREE.Vector3(e.x, terrain(e.x, e.y), e.y);
};
const atrium = (t: number) => {
  const a = t * 0.12;
  const x = -15.5 + Math.sin(a) * 3.6 + Math.sin(a * 2.3) * 0.6, z = -35.5 + Math.cos(a) * 2.6;
  return new THREE.Vector3(x, terrain(x, z), z);
};
// The brothers arrive a little after you do: their models load and are
// dressed in the background, never holding up the start.
const monks: ((dt: number) => void)[] = [];
const summonMonks = () => setTimeout(() => {
  loadMonkAssets()
    .then(() => { monks.push(makeMonk(onLane, 1)); setTimeout(() => monks.push(makeMonk(atrium, 1)), 300); })
    .catch((e) => console.warn('monks unavailable', e));
}, 500);

const player = new Player(collider, SPAWN, camera, renderer.domElement);
// Screenshot hooks: ?shot=…&hold waits for a teleport before counting frames.
let held = params.has('hold');
Object.assign(window, {
  __teleports: getTeleports,
  __setPitch: (p: number) => { player.pitch = p; },
});
(window as unknown as { __teleport: (t: Teleport) => void }).__teleport = (t) => {
  held = false;
  frames = 0;
  player.pos.set(t.x, t.y, t.z);
  player.vel.set(0, 0, 0);
  player.yaw = t.yaw;
  player.pitch = 0;
};
initMap();
let audio: Soundscape | null = null;
player.onStep = (run) => audio?.step(run, player.pos.y < -2);

// Post: bloom, ACES, then our own grade / grain / vignette / fringe.
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.7, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) }, uUnder: shared.uUnder },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uUnder;
    varying vec2 vUv;
    float h(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
    void main(){
      vec2 c = vUv - 0.5; float r = dot(c,c);
      vec2 off = c * r * 0.018;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299,0.587,0.114));
      // Cold, sick-green shadows; fire stays warm; blacks crushed.
      // Grey overcast: cool neutral shadows, no warm push; firelight keeps its own colour.
      vec3 shadowTint = mix(vec3(0.95,1.0,1.04), vec3(1.05,0.92,0.8), uUnder);
      col = mix(col*shadowTint, col, smoothstep(0.0,0.3,l));
      col = mix(col, col*col*(3.0-2.0*col), 0.22);
      float sat = mix(0.6, 0.85, smoothstep(0.15, 0.6, l));
      col = mix(vec3(dot(col, vec3(0.299,0.587,0.114))), col, sat);
      col *= 1.0 - r*0.9;
      col += (h(vUv*uRes + fract(uTime*7.13)*391.) - 0.5) * 0.045;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
});
composer.addPass(grade);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  grade.uniforms.uRes.value.set(innerWidth, innerHeight);
});

// UI: title card, pointer lock, region names.
const overlay = document.getElementById('overlay')!;
const regionEl = document.getElementById('region')!;
const hintEl = document.getElementById('hint')!;
// Compile every shader before letting anyone in, without freezing the page.
await progress('Mixing the pigments', 0.94);
try { await renderer.compileAsync(scene, camera); } catch { /* compiled on first frame instead */ }
enterEl.textContent = 'Enter';
summonMonks();
overlay.addEventListener('click', () => {
  overlay.classList.add('hidden');
  renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  if (!audio) { try { audio = new Soundscape(); } catch { /* no audio */ } }
  audio?.ctx.resume();
});
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !params.has('shot')) overlay.classList.remove('hidden');
});
const lanternBtn = document.getElementById('lanternbtn')!;
const setLantern = (v: boolean) => { lanternOn = v; lanternBtn.classList.toggle('on', v); lanternBtn.setAttribute('aria-pressed', String(v)); };
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') setLantern(!lanternOn);
});
lanternBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
lanternBtn.addEventListener('click', (e) => { e.stopPropagation(); setLantern(!lanternOn); });
if (matchMedia('(pointer: coarse)').matches) hintEl.textContent = 'It is dark. Tap the lantern to light it.';
let region = '';
let regionTimer = 0;

const noise1 = (t: number) => Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.1 + 1.3) * 0.3 + Math.sin(t * 23.7 + 2.1) * 0.2;
const tmp = new THREE.Vector3();

// ?shot=x,y,z,yaw,pitch places the camera for screenshots.
if (params.has('shot')) {
  const [x, y, z, yaw, pitch] = params.get('shot')!.split(',').map(Number);
  player.pos.set(x, y, z); player.yaw = yaw; player.pitch = pitch ?? 0;
  overlay.classList.add('hidden');
  if (params.has('lantern')) setLantern(true);
}

// ---- Culling ----------------------------------------------------------------
// 1. Zones: the earth is the biggest occluder. Underground cells are hidden
//    above ground and vice versa, except around the ossuary stair.
// 2. Distance: past ~120 m the fog has swallowed everything.
// 3. Occlusion: rays from the eye to the cell's bounds against the collision
//    BVH; a cell whose every ray is blocked twice in a row is hidden.
// Three.js frustum-culls each cell's meshes on top of this.
const ray = new THREE.Ray();
const pts: THREE.Vector3[] = Array.from({ length: 10 }, () => new THREE.Vector3());
const cen = new THREE.Vector3(), hit = new THREE.Vector3(), eye = new THREE.Vector3();
let rr = 0;
const cullStats = { visible: 0, occluded: 0, total: cells.length };
function occluded(c: Cell): boolean {
  if (c.box.distanceToPoint(eye) < 3) return false;
  const b = c.box;
  b.getCenter(cen);
  let k = 0;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts[k++].set(x, y, z).lerp(cen, 0.08);
  pts[8].copy(cen);
  pts[9].set(cen.x, b.max.y - 0.3, cen.z);
  for (const p of pts) {
    ray.origin.copy(eye);
    ray.direction.subVectors(p, eye).normalize();
    // Only the path up to the cell's bounds matters, not the cell's own walls.
    const entry = ray.intersectBox(b, hit) ? hit.distanceTo(eye) : eye.distanceTo(p);
    const h = bvh.raycastFirst(ray, THREE.DoubleSide, 0, Math.max(0, entry - 0.2));
    if (!h) return false;
  }
  return true;
}
function cull(isUnder: boolean) {
  eye.copy(camera.position);
  const nearStair = Math.abs(eye.x + 36) < 7 && eye.z < -46 && eye.z > -66;
  const showUnder = isUnder || nearStair || eye.y < -0.5;
  const showAbove = !isUnder || nearStair || eye.y > -3.5;
  fireAbove.visible = showAbove;
  fireUnder.visible = showUnder;
  if ((rr & 3) === 0) updateBones(showAbove, showUnder);
  const live: Cell[] = [];
  for (const c of cells) {
    const zoneOk = c.under ? showUnder : showAbove;
    const near = c.box.distanceToPoint(eye) < 120;
    if (zoneOk && near) live.push(c);
    else c.occluded = 0;
    c.visible = zoneOk && near;
  }
  // Re-test a slice of the live cells each frame.
  const per = Math.max(4, Math.ceil(live.length / 6));
  for (let i = 0; i < per && live.length; i++) {
    const c = live[(rr++) % live.length];
    c.occluded = occluded(c) ? c.occluded + 1 : 0;
  }
  let vis = 0, occ = 0;
  for (const c of cells) {
    const show = c.visible && c.occluded < 2;
    if (c.visible && !show) occ++;
    if (show) vis++;
    for (const m of c.meshes) m.visible = show;
  }
  cullStats.visible = vis;
  cullStats.occluded = occ;
}

// Adaptive resolution: keep the frame time near 1/45 s by scaling the internal
// render resolution between 0.55x and 1.5x CSS pixels (never above the screen's).
const maxRatio = Math.min(devicePixelRatio, 1.5);
let ratio = Math.min(devicePixelRatio, 1);
let slow = 0, fast = 0, settle = 0;
const frameTimes: number[] = [];
function adaptResolution(frameDt: number) {
  frameTimes.push(frameDt);
  if (frameTimes.length < 20) return;
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  frameTimes.length = 0;
  if (settle-- > 0) return;
  if (avg > 1 / 40) { slow++; fast = 0; } else if (avg < 1 / 55) { fast++; slow = 0; } else { slow = fast = 0; }
  let next = ratio;
  if (slow >= 1) next = Math.max(0.55, ratio * (avg > 1 / 20 ? 0.75 : 0.88));
  else if (fast >= 3) next = Math.min(maxRatio, ratio * 1.1);
  if (Math.abs(next - ratio) > 0.02) {
    ratio = next;
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    settle = 2;
    slow = fast = 0;
  }
}

const clock = new THREE.Clock();
let fps = 60;
let frames = 0;
function frame() {
  frames++;
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  shared.uTime.value = t;
  grade.uniforms.uTime.value = t;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  renderer.info.reset();

  if (!isReading()) player.update(dt);
  pushOutOfSecretDoor(player.pos);
  updateLibrary(camera);
  for (const m of monks) m(dt);

  const camY = camera.position.y;
  const under = THREE.MathUtils.smoothstep(-camY, 1.0, 4.0);
  shared.uUnder.value = under;
  moon.intensity = 0.5 * (1 - under);
  hemi.intensity = 3.0 * (1 - under) + 0.015;
  moon.position.copy(camera.position).addScaledVector(shared.uMoonDir.value, 120);
  moon.target.position.copy(camera.position);
  moon.position.x = Math.round(moon.position.x); moon.position.z = Math.round(moon.position.z);

  // Pick the nearest lamps on the same side of the ground as the camera.
  const isUnder = camY < -2.2;
  const cand: { l: Lamp; d: number }[] = [];
  for (const l of lamps) {
    if (l.under !== isUnder) continue;
    cand.push({ l, d: l.pos.distanceToSquared(camera.position) });
  }
  cand.sort((a, b) => a.d - b.d);
  const maxD = 38;
  for (let i = 0; i < NLAMP; i++) {
    const c = cand[i];
    const light = pool[i];
    if (!c) { light.intensity = 0; shared.uLampCol.value[i].set(0, 0, 0); shared.uLampPos.value[i].set(0, -999, 0); continue; }
    const d = Math.sqrt(c.d);
    const fade = THREE.MathUtils.smoothstep(maxD - d, 0, 10);
    const fl = 0.82 + 0.18 * noise1(t + c.l.seed) + 0.06 * Math.sin(t * 31 + c.l.seed);
    const I = c.l.intensity * fl * fade;
    tmp.copy(c.l.pos);
    tmp.x += Math.sin(t * 9 + c.l.seed) * 0.02;
    tmp.y += Math.sin(t * 11 + c.l.seed * 2) * 0.02;
    light.position.copy(tmp);
    light.color.copy(c.l.color);
    light.intensity = I * 18;
    light.distance = 16 * Math.max(0.4, c.l.intensity);
    shared.uLampPos.value[i].copy(tmp);
    shared.uLampCol.value[i].set(c.l.color.r * I, c.l.color.g * I, c.l.color.b * I);
  }
  // The player's own lantern swings slightly with movement.
  const lt = lanternOn ? 1 : 0;
  lantern.intensity += (lt * 9 * (0.9 + 0.1 * noise1(t * 1.3)) - lantern.intensity) * Math.min(1, dt * 8);
  tmp.set(0.35, -0.45 + Math.sin(player.stepPhase * 2) * 0.03 * player.bob, -0.4).applyEuler(camera.rotation);
  lantern.position.copy(camera.position).add(tmp);

  const name = regionName(player.pos);
  if (name !== region) {
    region = name;
    regionEl.textContent = name;
    regionEl.classList.add('show');
    regionTimer = 4;
  }
  regionTimer -= dt;
  if (regionTimer < 0) regionEl.classList.remove('show');
  hintEl.classList.toggle('show', isUnder && !lanternOn);

  cull(isUnder);
  audio?.update(dt, under, Math.hypot(player.pos.x - 0, player.pos.z + 45));
  if (!params.has('shot')) adaptResolution(rawDt);
  composer.render(dt);
  if (params.has('debug')) document.title = `${fps.toFixed(0)} fps · cells ${cullStats.visible}/${cullStats.total} · occluded ${cullStats.occluded} · ${renderer.info.render.calls} calls`;
  if (params.has('shot') && !held && frames > 12) { (window as unknown as { __done: boolean }).__done = true; return; }
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __ready: boolean }).__ready = true;
(window as unknown as { __stats: () => string }).__stats = () => `build ${buildMs.toFixed(0)}ms, ${renderer.info.render.triangles} tris drawn, ${renderer.info.render.calls} calls, cells ${cullStats.visible}/${cullStats.total} visible, ${cullStats.occluded} occluded`;
