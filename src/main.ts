import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { shared, mat, makeSky, makeFlames, makeMotes } from './materials';
import { NLAMP } from './shaders';
import { buildWorld, SPAWN, regionName } from './world';
import { Player } from './player';
import { Soundscape } from './audio';
import type { Lamp } from './builder';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 900);
scene.add(makeSky());

// Let the title card paint before the (synchronous) world build.
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
const t0 = performance.now();
const { collider, lamps, flames } = buildWorld(scene);
const buildMs = performance.now() - t0;

// Moonlight and a faint sky fill.
const moon = new THREE.DirectionalLight(0x8fa6d6, 0.8);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 });
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 0.04;
scene.add(moon, moon.target);
const hemi = new THREE.HemisphereLight(0x32405a, 0x0c0906, 0.35);
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

scene.add(makeFlames(flames));
scene.add(makeMotes());

// Hooded monks carrying lanterns on fixed rounds.
function makeMonk(path: (t: number) => THREE.Vector3, speed: number) {
  const g = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.55, 10, 1, true), mat('cloth'));
  robe.position.y = 0.78;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat('cloth'));
  hood.position.y = 1.62;
  hood.scale.set(1, 1.2, 1.1);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), mat('window'));
  box.position.set(0.32, 0.95, 0.25);
  for (const m of [robe, hood]) m.castShadow = true;
  g.add(robe, hood, box);
  scene.add(g);
  const lamp: Lamp = { pos: new THREE.Vector3(), color: new THREE.Color(1, 0.55, 0.22), intensity: 0.7, under: false, seed: Math.random() * 50 };
  lamps.push(lamp);
  let t = Math.random() * 100;
  return (dt: number) => {
    t += dt * speed;
    const p = path(t), q = path(t + 0.05);
    g.position.copy(p);
    g.position.y += Math.abs(Math.sin(t * 9)) * 0.03;
    g.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
    box.getWorldPosition(lamp.pos);
  };
}
const cloisterLoop = (t: number) => {
  const per = 4 * 19, u = ((t * 1.1) % per + per) % per, side = Math.floor(u / 19), f = u % 19;
  const x0 = -25.5, z0 = -35.5, s = 19;
  const pts = [[x0 + f, z0], [x0 + s, z0 + f], [x0 + s - f, z0 + s], [x0, z0 + s - f]];
  return new THREE.Vector3(pts[side][0], 0, pts[side][1]);
};
const streetRound = (t: number) => {
  const u = Math.sin(t * 0.035);
  return new THREE.Vector3(1.5 + Math.sin(t * 0.3) * 0.3, 0, 30 + u * 50);
};
const monks = [makeMonk(cloisterLoop, 1), makeMonk(streetRound, 1)];

const player = new Player(collider, SPAWN, camera, renderer.domElement);
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
      vec3 shadowTint = mix(vec3(0.82,0.98,1.18), vec3(1.05,0.92,0.8), uUnder);
      col = mix(col*shadowTint + vec3(0.0,0.004,0.01)*(1.0-uUnder), col, smoothstep(0.0,0.35,l));
      col = mix(col, col*vec3(1.12,1.0,0.82), smoothstep(0.35,0.9,l));
      col = mix(col, col*col*(3.0-2.0*col), 0.25);
      col = mix(vec3(l), col, 0.88);
      col *= 1.0 - r*1.25;
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
document.querySelector('#overlay .enter')!.textContent = 'Enter';
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
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') lanternOn = !lanternOn;
});
let region = '';
let regionTimer = 0;

const noise1 = (t: number) => Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.1 + 1.3) * 0.3 + Math.sin(t * 23.7 + 2.1) * 0.2;
const tmp = new THREE.Vector3();

// ?shot=x,y,z,yaw,pitch places the camera for screenshots.
if (params.has('shot')) {
  const [x, y, z, yaw, pitch] = params.get('shot')!.split(',').map(Number);
  player.pos.set(x, y, z); player.yaw = yaw; player.pitch = pitch ?? 0;
  overlay.classList.add('hidden');
  if (params.has('lantern')) lanternOn = true;
}

const clock = new THREE.Clock();
let fps = 60;
let frames = 0;
function frame() {
  frames++;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  shared.uTime.value = t;
  grade.uniforms.uTime.value = t;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  player.update(dt);
  for (const m of monks) m(dt);

  const camY = camera.position.y;
  const under = THREE.MathUtils.smoothstep(-camY, 1.0, 4.0);
  shared.uUnder.value = under;
  moon.intensity = 0.8 * (1 - under);
  hemi.intensity = 0.5 * (1 - under) + 0.02;
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

  audio?.update(dt, under, Math.hypot(player.pos.x - 0, player.pos.z + 45));
  composer.render(dt);
  if (params.has('debug')) document.title = `${fps.toFixed(0)} fps`;
  if (params.has('shot') && frames > 12) { (window as unknown as { __done: boolean }).__done = true; return; }
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __ready: boolean }).__ready = true;
(window as unknown as { __stats: string }).__stats = `build ${buildMs.toFixed(0)}ms, ${renderer.info.render.triangles} tris, collider ${collider.geometry.attributes.position.count / 3} tris`;
