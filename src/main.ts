import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { N8AOPass } from 'n8ao';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MeshBVH } from 'three-mesh-bvh';
import { shared, mat, MAT, makeSurfaceMaterial, makeSky, makeMotes, texturesReady } from './materials';
import { makeFire } from './fire';
import { makeBones } from './bones';
import { NLAMP } from './shaders';
import { buildWorld, SPAWN, SPAWN_YAW, STAIR_ZONES, TOWN_TEX, siteGroups, regionName, getTeleports, getMapData, type Teleport } from './world';
import { terrain, fastTerrain } from './displace';
import { SITES } from './benevento/sites';
import { updateSecrets, isReadingSecret } from './benevento/secrets';
import { Player } from './player';
import { Soundscape } from './audio';
import { initMap } from './map';
import { loadProps } from './props';
import { updateLibrary, pushOutOfSecretDoor } from './library';
import { isReading } from './codex';
import { loadNpcAssets, spawnTownsfolk, updateTownsfolk, pushOutOfTownsfolk, npcDebug } from './npc';
Object.assign(window, { __npc: npcDebug });
import type { Lamp, Cell, PropKind } from './builder';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 900);
const sky = makeSky();
scene.add(sky);

// Title card shows progress while the world is built in stages; any failure
// is written on the card instead of leaving it hanging.
const enterEl = document.querySelector('#overlay .enter')!;
const progress = async (label: string, frac: number) => {
  enterEl.textContent = `${label}… ${Math.round(frac * 100)}%`;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
};
addEventListener('error', (e) => { enterEl.textContent = 'Something went wrong: ' + (e.message || e.error); });
addEventListener('unhandledrejection', (e) => { enterEl.textContent = 'Something went wrong: ' + (e.reason?.message ?? e.reason); });
await progress('Gathering the furnishings', 0);
await loadProps();
await progress('Lighting the lamps', 0.01);
const t0 = performance.now();
const { collider, cells, lamps, flames, props, townTex, stream } = await buildWorld(scene, progress);
shared.uTown.value = townTex;
shared.uTownBox.value.set(TOWN_TEX.x0, TOWN_TEX.z0, 1 / TOWN_TEX.w, 1 / TOWN_TEX.h);
shared.uTownH.value.set(TOWN_TEX.hMin, TOWN_TEX.hMax);
Object.assign(window, { __stream: stream, __scene: scene, __collider: collider });
(window as unknown as { __camera: THREE.Camera }).__camera = camera;
const bvh = new MeshBVH(collider.geometry);
(collider.geometry as unknown as { boundsTree: MeshBVH }).boundsTree = bvh;
const buildMs = performance.now() - t0;
// Hand meshes to the GPU at once, so their CPU copies can go (the builder and
// the stream free each array on upload): a cheap pass into a 1x1 target.
const upRT = new THREE.WebGLRenderTarget(1, 1), upScene = new THREE.Scene();
upScene.overrideMaterial = new THREE.MeshBasicMaterial();
function gpuUpload(meshes: THREE.Mesh[]) {
  if (!meshes.length) return;
  const st = meshes.map((m) => ({ p: m.parent, v: m.visible, f: m.frustumCulled }));
  for (const m of meshes) { m.visible = true; m.frustumCulled = false; upScene.add(m); }
  renderer.setRenderTarget(upRT);
  renderer.render(upScene, camera);
  renderer.setRenderTarget(null);
  meshes.forEach((m, i) => { upScene.remove(m); st[i].p?.add(m); m.visible = st[i].v; m.frustumCulled = st[i].f; });
}
gpuUpload(cells.flatMap((c) => c.meshes as THREE.Mesh[]));
stream.uploader = gpuUpload;

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
// Image-based lighting from a real overcast sky over a medieval street (Poly
// Haven 'cobblestone_parish_road', baked to an RGBE PNG): light arrives from
// every direction with the sky's real distribution, walls get bounce from the
// street, and every material gets matching soft reflections. This replaces the
// flat hemisphere light, which lit everything evenly and looked like plastic.
// A dim hemisphere stays only as a fallback until the sky has loaded.
const hemi = new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 1.2);
scene.add(hemi);
let envReady = false;
const envLoaded = (async () => {
  try {
    const blob = await (await fetch('textures/env.png')).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const src = new THREE.Texture(bmp as unknown as HTMLImageElement);
    src.flipY = false;
    src.magFilter = src.minFilter = THREE.NearestFilter;
    src.generateMipmaps = false;
    src.colorSpace = THREE.NoColorSpace;
    src.needsUpdate = true;
    // Decode RGBE to linear HDR in a full-screen pass.
    const rt = new THREE.WebGLRenderTarget(bmp.width, bmp.height, { type: THREE.HalfFloatType });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { t: { value: src } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `uniform sampler2D t; varying vec2 vUv;
        void main(){ vec4 c = texture2D(t, vec2(vUv.x, 1.0 - vUv.y));
          gl_FragColor = vec4(c.rgb * 255.0 * exp2(c.a * 255.0 - 128.0) / 256.0, 1.0); }`,
      depthTest: false, depthWrite: false,
    }));
    const qs = new THREE.Scene(); qs.add(q);
    const cam2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    renderer.setRenderTarget(rt); renderer.render(qs, cam2); renderer.setRenderTarget(null);
    rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(rt.texture).texture;
    scene.environmentIntensity = 1.0;
    pmrem.dispose(); rt.dispose(); src.dispose(); bmp.close();
    envReady = true;
  } catch (e) { console.warn('environment light unavailable', e); }
})();

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
const fireAbove = makeFire(flames.filter((f) => !f.under));
const fireUnder = makeFire(flames.filter((f) => f.under));
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

// Townsfolk (monks, peasants, Lombard soldiers) arrive a little after you do:
// their models load and are dressed in the background, never holding up the start.
// A small status line says what the townsfolk are doing (loading, how many,
// or the exact error), so a failure on a phone is visible, not silent.
const npcStatus = document.createElement('div');
npcStatus.id = 'npcstatus';
Object.assign(npcStatus.style, { position: 'fixed', left: '50%', transform: 'translateX(-50%)', top: 'max(64px, calc(env(safe-area-inset-top, 0px) + 58px))',
  font: "italic 13px 'IM Fell English', Georgia, serif", color: '#e6d2a2', textShadow: '0 0 6px #000', pointerEvents: 'none', zIndex: '6',
  maxWidth: '90vw', textAlign: 'center', transition: 'opacity 1.5s' });
document.body.appendChild(npcStatus);
const say = (t: string, keep = false) => {
  npcStatus.textContent = t; npcStatus.style.opacity = '1';
  if (!keep) setTimeout(() => { npcStatus.style.opacity = '0'; }, 6000);
};
const summonTownsfolk = () => setTimeout(async () => {
  say('The townsfolk are coming…', true);
  const t0 = performance.now();
  try {
    await loadNpcAssets();
    say('The townsfolk are dressing…', true);
    spawnTownsfolk(scene, { streets: getMapData().streets.filter((st) => st.kind === 'lane'), ground: terrain, lamps, places: getMapData().landmarks });
    const n = npcDebug.people.length;
    say(n ? `${n} townsfolk are about (${((performance.now() - t0) / 1000).toFixed(0)} s)` : 'No townsfolk could be placed', !n);
  } catch (e) {
    const err = e as Error;
    console.warn('townsfolk unavailable', e);
    say('Townsfolk failed: ' + (err?.message ?? String(e)).slice(0, 160), true);
  }
}, 500);

const player = new Player(collider, SPAWN, camera, renderer.domElement);
player.yaw = SPAWN_YAW;
// Screenshot hooks: ?shot=…&hold waits for a teleport before counting frames.
let held = params.has('hold');
Object.assign(window, {
  __teleports: getTeleports,
  __setPitch: (p: number) => { player.pitch = p; },
});
/** First floor below (x, y, z) within `depth` m, or null. */
const downRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
function floorBelow(x: number, y: number, z: number, depth: number): number | null {
  downRay.origin.set(x, y, z);
  const h = bvh.raycastFirst(downRay, THREE.DoubleSide, 0, depth);
  return h ? h.point.y : null;
}
// Teleports always land on a floor: the eye goes 1.65 m above the first
// surface under the target. If there is none within 6 m, look a little higher
// and around before giving up (and then stay where you are).
(window as unknown as { __teleport: (t: Teleport) => void }).__teleport = (t) => {
  held = false;
  frames = 0;
  let land: [number, number, number] | null = null;
  search: for (const lift of [0.3, 1.5, 3]) for (const [dx, dz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [1.2, 1.2], [-1.2, -1.2]]) {
    const f = floorBelow(t.x + dx, t.y + lift, t.z + dz, 6 + lift);
    if (f !== null) { land = [t.x + dx, f + 1.65, t.z + dz]; break search; }
  }
  if (!land) { console.warn('teleport: no floor under', t.name); return; }
  player.pos.set(...land);
  player.vel.set(0, 0, 0);
  player.yaw = t.yaw;
  player.pitch = 0;
  lastSafe.set(...land);
};
// Falls: remember the last place the player stood; if they ever drop below
// anything walkable, put them back there.
const lastSafe = new THREE.Vector3().copy(SPAWN);
let safeTimer = 0;
function guardFall(dt: number) {
  safeTimer += dt;
  if (player.onGround && safeTimer > 0.5) { lastSafe.copy(player.pos); safeTimer = 0; }
  if (player.pos.y - fastTerrain(player.pos.x, player.pos.z) < -25) { player.pos.copy(lastSafe); player.vel.set(0, 0, 0); }
}
Object.assign(window, { __probe: (x: number, y: number, z: number) => floorBelow(x, y, z, 50) });
initMap();
let audio: Soundscape | null = null;
player.onStep = (run) => audio?.step(run, player.pos.y < -2);

// Post: bloom, ACES, then our own grade / grain / vignette / fringe.
// 4x multisampled HDR target: every geometric edge (stones, arches, tiles)
// is anti-aliased instead of stair-stepping and crawling.
const msaaTarget = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, msaaTarget);
composer.setPixelRatio(renderer.getPixelRatio());
// Ambient occlusion: contact shadows where walls meet the street, under eaves,
// in reveals, between stones. Its absence is what made everything float.
const ao = new N8AOPass(scene, camera, innerWidth, innerHeight);
Object.assign(ao.configuration, { aoRadius: 1.6, distanceFalloff: 1.2, intensity: 2.6, halfRes: true, screenSpaceRadius: false, gammaCorrection: false });
ao.setQualityMode('Medium');
composer.addPass(ao);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.35, 0.5, 0.95);
// One bad pixel (NaN/inf) would be smeared over the whole screen by the bloom:
// clear any non-finite or absurd values first.
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a); }`,
}));
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
await progress('Grinding the pigments', 0.9);
await texturesReady;
await envLoaded;
await progress('Building the lanes about you', 0.9);
{
  const named = params.has('at') ? getTeleports().find((q) => q.name.toLowerCase().includes(params.get('at')!.toLowerCase())) : undefined;
  const at = named ? [named.x, 0, named.z] : params.has('shot') ? params.get('shot')!.split(',').map(Number) : [SPAWN.x, 0, SPAWN.z];
  stream.update(new THREE.Vector3(at[0], 0, at[2]));
  const pump = setInterval(() => stream.update(new THREE.Vector3(at[0], 0, at[2])), 100);
  await stream.ready(at[0], at[2], params.has('shot') ? 60 : 36, (f) => { enterEl.textContent = `Building the lanes about you… ${Math.round(f * 100)}%`; });
  clearInterval(pump);
}
await progress('Mixing the pigments', 0.94);
try { await renderer.compileAsync(scene, camera); } catch { /* compiled on first frame instead */ }
enterEl.textContent = 'Enter';
summonTownsfolk();
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

const tmpDir = new THREE.Vector3();
// The library lives in the Episcopium's frame: give it the camera in that frame.
const libProxy = new THREE.PerspectiveCamera();
libProxy.matrixAutoUpdate = false;
const libInv = new THREE.Matrix4();
function libCam() {
  const g = siteGroups.episcopium;
  if (!g) return camera;
  libInv.copy(g.matrixWorld).invert();
  libProxy.matrix.multiplyMatrices(libInv, camera.matrixWorld);
  libProxy.matrixWorld.copy(libProxy.matrix);
  return libProxy;
}
const noise1 = (t: number) => Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.1 + 1.3) * 0.3 + Math.sin(t * 23.7 + 2.1) * 0.2;
const tmp = new THREE.Vector3();

// ?shot=x,y,z,yaw,pitch places the camera for screenshots.
if (params.has('shot') && !params.has('at')) {
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
function cull(isUnder: boolean, camLocal: number) {
  eye.copy(camera.position);
  const nearStair = STAIR_ZONES.some((s) => Math.hypot(eye.x - s.x, eye.z - s.z) < s.r);
  const showUnder = isUnder || nearStair || camLocal < -0.5;
  const showAbove = !isUnder || nearStair || camLocal > -3.5;
  fireAbove.visible = showAbove;
  fireUnder.visible = showUnder;
  if ((rr & 3) === 0) updateBones(showAbove, showUnder);
  const live: Cell[] = [];
  for (const c of cells) {
    const zoneOk = c.under ? showUnder : showAbove;
    const near = c.box.distanceToPoint(eye) < (c.range ?? 120);
    if (zoneOk && near && !c.lod) live.push(c);
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

  if (!isReading() && !isReadingSecret()) player.update(dt);
  guardFall(dt);
  pushOutOfSecretDoor(player.pos);
  updateLibrary(libCam());
  pushOutOfTownsfolk(player.pos);
  updateTownsfolk(dt, camera, player);

  const camY = camera.position.y;
  sky.position.copy(camera.position);
  const groundHere = fastTerrain(camera.position.x, camera.position.z);
  const camLocal = camY - groundHere;
  const under = THREE.MathUtils.smoothstep(-camLocal, 1.0, 4.0);
  shared.uFogBase.value += (groundHere - 1.0 - shared.uFogBase.value) * Math.min(1, dt * 2);
  shared.uUnder.value = under;
  moon.intensity = 0.5 * (1 - under);
  hemi.intensity = (envReady ? 0.0 : 1.2) * (1 - under) + 0.015;
  // The sky was captured by day: dusk is about half of it.
  scene.environmentIntensity = 0.55 * (1 - under) + 0.004;
  moon.position.copy(camera.position).addScaledVector(shared.uMoonDir.value, 120);
  moon.target.position.copy(camera.position);
  moon.position.x = Math.round(moon.position.x); moon.position.z = Math.round(moon.position.z);

  // Pick the nearest lamps on the same side of the ground as the camera.
  const isUnder = camLocal < -2.2;
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

  stream.update(camera.position, camera.getWorldDirection(tmpDir));
  cull(isUnder, camLocal);
  updateSecrets(camera);
  audio?.update(dt, under, Math.hypot(player.pos.x - SITES.episcopium.x, player.pos.z - SITES.episcopium.z));
  if (!params.has('shot')) adaptResolution(rawDt);
  composer.render(dt);
  if (params.has('debug')) document.title = `${fps.toFixed(0)} fps · cells ${cullStats.visible}/${cells.length} · occluded ${cullStats.occluded} · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · chunks ${stream.stats.ready}`;
  if (params.has('shot') && !held && frames > 12) { (window as unknown as { __done: boolean }).__done = true; return; }
  requestAnimationFrame(frame);
}
// ?at=<teleport name>[&yaw=..&pitch=..]: start at a named place (also for screenshots).
if (params.has('at')) {
  const want = params.get('at')!.toLowerCase();
  const t = getTeleports().find((q) => q.name.toLowerCase() === want) ?? getTeleports().find((q) => q.name.toLowerCase().includes(want));
  if (t) {
    (window as unknown as { __teleport: (t: Teleport) => void }).__teleport({ ...t, yaw: params.has('yaw') ? Number(params.get('yaw')) : t.yaw });
    if (params.has('pitch')) player.pitch = Number(params.get('pitch'));
  }
  if (params.has('shot')) overlay.classList.add('hidden');
}
frame();
(window as unknown as { __ready: boolean }).__ready = true;
(window as unknown as { __stats: () => string }).__stats = () => `build ${buildMs.toFixed(0)}ms, ${renderer.info.render.triangles} tris drawn, ${renderer.info.render.calls} calls, cells ${cullStats.visible}/${cells.length} visible, ${cullStats.occluded} occluded, chunks ready ${stream.stats.ready} (built ${stream.stats.built}, avg ${(stream.stats.ms / Math.max(1, stream.stats.built)).toFixed(0)} ms), geo ${renderer.info.memory.geometries}, tex ${renderer.info.memory.textures}`;
