import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import AmmoInit from 'ammojs-typed/wasm';
import wasmUrl from 'ammojs-typed/ammo.wasm.wasm?url';
import { shared } from './materials';
import { noiseGLSL, atmosGLSL } from './shaders';

// Monks: a rigged, animated Mixamo body (three.js AnimationMixer) under a
// Benedictine habit that is real cloth: Bullet soft bodies (ammo.js) anchored
// at the shoulders and at the cord belt, colliding with kinematic capsules
// that follow the bones, so the skirts swing with the legs. A short shoulder
// cape hangs over the arms; a pointed cowl sits on the head. Wool is rendered
// with MeshPhysicalMaterial sheen and a procedural weave normal map.

type AmmoT = Awaited<ReturnType<typeof AmmoInit>>;
let A: AmmoT;
let loaded = false;
let world: InstanceType<AmmoT['btSoftRigidDynamicsWorld']>;
let source: THREE.Object3D;
let clips: THREE.AnimationClip[] = [];
let weave: THREE.CanvasTexture;
const HEIGHT = 1.72;
const STEP = 1 / 60;

export interface Monk {
  group: THREE.Object3D;
  lanternWorldPos: THREE.Vector3;
  update(dt: number, pos: THREE.Vector3, facingYaw: number, speed: number): void;
}

/** Load the rigged body and the physics engine (once). */
export async function loadMonkAssets(): Promise<void> {
  if (loaded) return;
  const [ammo, gltf] = await Promise.all([
    // The emscripten factory assigns `this.Ammo`; give it a receiver under strict ESM.
    AmmoInit.call({}, { locateFile: () => wasmUrl } as object),
    new GLTFLoader().loadAsync(new URL('models/Xbot.glb', document.baseURI).href),
  ]);
  A = ammo as AmmoT;
  source = gltf.scene;
  clips = gltf.animations;
  const cc = new A.btSoftBodyRigidBodyCollisionConfiguration();
  world = new A.btSoftRigidDynamicsWorld(new A.btCollisionDispatcher(cc), new A.btDbvtBroadphase(), new A.btSequentialImpulseConstraintSolver(), cc, new A.btDefaultSoftBodySolver());
  const g = new A.btVector3(0, -9.81, 0);
  world.setGravity(g);
  world.getWorldInfo().set_m_gravity(g);
  weave = makeWeave();
  loaded = true;
}

// ------------------------------------------------------------------ rendering

/** Coarse wool twill as a normal map, drawn on a canvas. */
function makeWeave() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const h = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    // Diagonal twill ribs plus slubby irregular yarn.
    const rib = Math.sin(((x + y) / s) * Math.PI * 2 * 16) * 0.5 + 0.5;
    const yarn = Math.sin((x / s) * Math.PI * 2 * 32) * Math.sin((y / s) * Math.PI * 2 * 7 + x * 0.05) * 0.25;
    h[y * s + x] = rib * 0.8 + yarn + Math.random() * 0.15;
  }
  const img = g.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const H = (xx: number, yy: number) => h[((yy + s) % s) * s + ((xx + s) % s)];
    const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1);
    const n = new THREE.Vector3(-dx * 1.5, -dy * 1.5, 1).normalize();
    const k = (y * s + x) * 4;
    img.data[k] = (n.x * 0.5 + 0.5) * 255; img.data[k + 1] = (n.y * 0.5 + 0.5) * 255; img.data[k + 2] = (n.z * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

/** Run a material through the game's fog and lamp in-scattering. */
function withAtmos<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPos);');
  };
  m.customProgramCacheKey = () => 'monk-atmos';
  return m;
}

function wool(color: number, sheen: number) {
  return withAtmos(new THREE.MeshPhysicalMaterial({
    color, roughness: 0.96, metalness: 0, sheen: 1, sheenColor: new THREE.Color(sheen), sheenRoughness: 0.7,
    normalMap: weave, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide,
  }));
}

// ------------------------------------------------------------------ physics helpers

const tq = new THREE.Quaternion(), tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), ts = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function kinematic(shape: InstanceType<AmmoT['btCollisionShape']>) {
  const t = new A.btTransform();
  t.setIdentity();
  const ms = new A.btDefaultMotionState(t);
  const info = new A.btRigidBodyConstructionInfo(0, ms, shape, new A.btVector3(0, 0, 0));
  const body = new A.btRigidBody(info);
  body.setCollisionFlags(body.getCollisionFlags() | 2); // CF_KINEMATIC_OBJECT
  body.setActivationState(4); // DISABLE_DEACTIVATION
  world.addRigidBody(body);
  return body;
}
const bt = { t: null as InstanceType<AmmoT['btTransform']> | null, v: null as InstanceType<AmmoT['btVector3']> | null, q: null as InstanceType<AmmoT['btQuaternion']> | null };
function place(body: InstanceType<AmmoT['btRigidBody']>, p: THREE.Vector3, q: THREE.Quaternion) {
  if (!bt.t) { bt.t = new A.btTransform(); bt.v = new A.btVector3(0, 0, 0); bt.q = new A.btQuaternion(0, 0, 0, 1); }
  bt.t.setIdentity();
  bt.v!.setValue(p.x, p.y, p.z);
  bt.q!.setValue(q.x, q.y, q.z, q.w);
  bt.t.setOrigin(bt.v!);
  bt.t.setRotation(bt.q!);
  body.getMotionState().setWorldTransform(bt.t);
  body.setWorldTransform(bt.t);
}

/** Tube cloth: rings of (y, rx, rz) around the body axis, in monk-local space. */
function tube(rings: [number, number, number][], seg: number) {
  const pos: number[] = [], idx: number[] = [];
  rings.forEach(([y, rx, rz], j) => {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      // Fuller at the back where the cloth gathers; slight flare at the hem.
      const back = Math.cos(a) < 0 ? 1.08 : 1;
      pos.push(Math.sin(a) * rx, y, Math.cos(a) * rz * back);
    }
    if (j === 0) return;
    for (let i = 0; i < seg; i++) {
      const a0 = (j - 1) * seg + i, a1 = (j - 1) * seg + ((i + 1) % seg), b0 = j * seg + i, b1 = j * seg + ((i + 1) % seg);
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  });
  return { pos, idx };
}

let worldTime = -1;
let accum = 0;
function stepWorld(dt: number) {
  const now = performance.now();
  if (Math.abs(now - worldTime) < 0.5) return; // once per frame for all monks
  worldTime = now;
  accum = Math.min(accum + dt, STEP * 4);
  while (accum >= STEP) {
    world.stepSimulation(STEP, 0);
    accum -= STEP;
  }
}

// ------------------------------------------------------------------ the monk

export function createMonk(scene: THREE.Scene): Monk {
  const group = new THREE.Group();
  const body = SkeletonUtils.clone(source);
  group.add(body);
  scene.add(group);
  const habitBody = wool(0x1d1712, 0x4a3c30);
  body.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.material = habitBody;
    m.castShadow = true;
    m.frustumCulled = false;
  });
  const bone = (n: string) => body.getObjectByName('mixamorig' + n) ?? body.getObjectByName('mixamorig:' + n)!;
  // Normalise to a monk's height (Mixamo rigs come in centimetres or metres).
  body.updateMatrixWorld(true);
  const headTop = bone('HeadTop_End').getWorldPosition(new THREE.Vector3());
  const footY = bone('LeftToe_End').getWorldPosition(new THREE.Vector3()).y;
  body.scale.multiplyScalar(HEIGHT / (headTop.y - Math.min(0, footY)));
  body.updateMatrixWorld(true);

  const mixer = new THREE.AnimationMixer(body);
  const clip = (n: string) => clips.find((c) => c.name.toLowerCase() === n)!;
  const walk = mixer.clipAction(clip('walk'));
  const idle = mixer.clipAction(clip('idle'));
  walk.play(); idle.play();
  walk.setEffectiveWeight(1); idle.setEffectiveWeight(0);
  mixer.update(0);
  body.updateMatrixWorld(true);

  const B = {
    hips: bone('Hips'), spine: bone('Spine'), spine2: bone('Spine2'), neck: bone('Neck'), head: bone('Head'),
    lUp: bone('LeftUpLeg'), lLeg: bone('LeftLeg'), lFoot: bone('LeftFoot'),
    rUp: bone('RightUpLeg'), rLeg: bone('RightLeg'), rFoot: bone('RightFoot'),
    lArm: bone('LeftArm'), lFore: bone('LeftForeArm'), lHand: bone('LeftHand'),
    rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: bone('RightHand'),
  };
  const yOf = (o: THREE.Object3D) => o.getWorldPosition(tv).y;
  const neckY = yOf(B.neck), waistY = yOf(B.spine) + 0.02, hipY = yOf(B.hips);
  const shoulderY = (yOf(B.lArm) + yOf(B.rArm)) / 2;

  // Head-bone frame at rest, so the cowl and lantern can follow without scale.
  const headRest = B.head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const spineRest = B.spine2.getWorldQuaternion(new THREE.Quaternion()).invert();
  const beltRest = B.spine.getWorldQuaternion(new THREE.Quaternion()).invert();

  // --- the habit: skirt from the shoulders to the hem, cinched at the cord.
  const seg = 22;
  const rings: [number, number, number][] = [];
  const top = shoulderY - 0.02, hem = 0.07;
  const upper = 4, lower = 11;
  for (let j = 0; j <= upper; j++) {
    const t = j / upper;
    rings.push([top + (waistY - top) * t, 0.23 - 0.04 * t, 0.17 - 0.015 * t]);
  }
  for (let j = 1; j <= lower; j++) {
    const t = j / lower;
    rings.push([waistY + (hem - waistY) * t, 0.2 + 0.27 * Math.pow(t, 0.75), 0.17 + 0.25 * Math.pow(t, 0.75)]);
  }
  const habit = tube(rings, seg);
  const waistRing = upper;
  // --- the cape of the cowl over shoulders and arms.
  const cseg = 22;
  const capeRings: [number, number, number][] = [];
  for (let j = 0; j <= 5; j++) {
    const t = j / 5;
    capeRings.push([neckY + 0.03 - 0.34 * t, 0.12 + 0.25 * Math.pow(t, 0.55), 0.11 + 0.15 * Math.pow(t, 0.55)]);
  }
  const cape = tube(capeRings, cseg);

  // Kinematic colliders that follow the bones.
  const caps: { body: InstanceType<AmmoT['btRigidBody']>; a: THREE.Object3D; b: THREE.Object3D }[] = [];
  const capsule = (a: THREE.Object3D, b: THREE.Object3D, r: number) => {
    const len = a.getWorldPosition(tv).distanceTo(b.getWorldPosition(tv2));
    caps.push({ body: kinematic(new A.btCapsuleShape(r, Math.max(0.01, len - r * 0.5))), a, b });
  };
  capsule(B.lUp, B.lLeg, 0.095); capsule(B.lLeg, B.lFoot, 0.07);
  capsule(B.rUp, B.rLeg, 0.095); capsule(B.rLeg, B.rFoot, 0.07);
  capsule(B.lUp, B.rUp, 0.12);
  capsule(B.hips, B.spine2, 0.125);
  capsule(B.lArm, B.rArm, 0.06);
  capsule(B.lArm, B.lFore, 0.07);
  capsule(B.rArm, B.rFore, 0.07);
  const neckBody = kinematic(new A.btSphereShape(0.05));
  const beltBody = kinematic(new A.btSphereShape(0.05));
  const floor = kinematic(new A.btBoxShape(new A.btVector3(1.2, 0.1, 1.2)));

  const syncBones = () => {
    for (const c of caps) {
      c.a.getWorldPosition(tv); c.b.getWorldPosition(tv2);
      const mid = tv.clone().add(tv2).multiplyScalar(0.5);
      tq.setFromUnitVectors(UP, tv2.sub(tv).normalize());
      place(c.body, mid, tq);
    }
    place(neckBody, B.spine2.getWorldPosition(tv), B.spine2.getWorldQuaternion(tq).multiply(spineRest));
    place(beltBody, B.spine.getWorldPosition(tv), B.spine.getWorldQuaternion(tq).multiply(beltRest));
  };

  // Cloth bodies are built at the monk's first placement.
  const cloths: { sb: InstanceType<AmmoT['btSoftBody']>; mesh: THREE.Mesh; map: number[] }[] = [];
  const makeCloth = (t: { pos: number[]; idx: number[] }, segN: number, mass: number, stiff: number, anchors: [number, InstanceType<AmmoT['btRigidBody']>][], mat: THREE.Material) => {
    // Built node by node: this ammo build cannot marshal large JS arrays.
    const sb = new A.btSoftBody(world.getWorldInfo(), 0, new A.btVector3(0, 0, 0), []);
    const m = sb.get_m_materials().at(0);
    const v = new A.btVector3(0, 0, 0);
    for (let i = 0; i < t.pos.length; i += 3) {
      tv.set(t.pos[i], t.pos[i + 1], t.pos[i + 2]).applyMatrix4(group.matrixWorld);
      v.setValue(tv.x, tv.y, tv.z);
      sb.appendNode(v, 1);
    }
    const seen = new Set<number>();
    const link = (a: number, b: number) => {
      const k = Math.min(a, b) * 100000 + Math.max(a, b);
      if (seen.has(k)) return;
      seen.add(k);
      sb.appendLink(a, b, m, false);
    };
    for (let i = 0; i < t.idx.length; i += 3) {
      const [a, b, c] = [t.idx[i], t.idx[i + 1], t.idx[i + 2]];
      link(a, b); link(b, c); link(c, a);
      sb.appendFace(a, b, c, m);
    }
    const cfg = sb.get_m_cfg();
    cfg.set_viterations(8); cfg.set_piterations(10);
    cfg.set_kDF(0.08); cfg.set_kDP(0.012); cfg.set_kAHR(1);
    cfg.set_collisions(0x0001); // SDF_RS: soft vs rigid
    m.set_m_kLST(stiff); m.set_m_kAST(stiff * 0.7);
    sb.generateBendingConstraints(2, m);
    sb.setTotalMass(mass, false);
    A.castObject(sb, A.btCollisionObject).getCollisionShape().setMargin(0.035);
    world.addSoftBody(sb, 1, -1);
    sb.setActivationState(4);
    for (const [ring, rb] of anchors) for (let i = 0; i < segN; i++) sb.appendAnchor(ring * segN + i, rb, false, 1);
    // Render mesh with a duplicated seam column for clean UVs.
    const rows = t.pos.length / 3 / segN;
    const map: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i <= segN; i++) {
      map.push(j * segN + (i % segN));
      uv.push(i / segN * 2, 1 - j / (rows - 1) * 2.5);
    }
    for (let j = 1; j < rows; j++) for (let i = 0; i < segN; i++) {
      const a0 = (j - 1) * (segN + 1) + i, a1 = a0 + 1, b0 = j * (segN + 1) + i, b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(map.length * 3), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    scene.add(mesh);
    cloths.push({ sb, mesh, map });
  };

  // Cowl: a pointed hood following the head.
  const hood = (() => {
    const g = new THREE.SphereGeometry(0.13, 28, 22, Math.PI / 2 + 0.8, Math.PI * 2 - 1.6, 0, Math.PI * 0.94);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      tv.fromBufferAttribute(p, i);
      const d = tv.clone().normalize();
      // The Benedictine point at the back of the head, and a deeper fall behind.
      const tip = Math.max(0, -d.z) * Math.max(0, d.y + 0.2);
      tv.z -= tip * tip * 0.22;
      tv.y += tip * tip * 0.05;
      tv.multiply(new THREE.Vector3(1.05, 1.18, 1.18));
      // Below the jaw the cowl falls open onto the shoulders.
      const fall = Math.max(0, -d.y - 0.25);
      tv.x *= 1 + fall * 1.6;
      tv.z *= 1 + fall * 0.9;
      tv.y -= fall * 0.06;
      // ...and hangs lower at the back, over the nape.
      const nape = Math.max(0, -d.z) * Math.max(0, -d.y);
      tv.y -= nape * 0.12;
      tv.z -= nape * 0.05;
      p.setXYZ(i, tv.x, tv.y, tv.z);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, wool(0x1a1410, 0x3f3428));
    m.castShadow = true;
    scene.add(m);
    return m;
  })();
  const hoodOffset = new THREE.Vector3(0, 0.075, -0.02);

  // Cord belt (cingulum) with a hanging end.
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.012, 6, 28), withAtmos(new THREE.MeshStandardMaterial({ color: 0x5a4a33, roughness: 1 })));
  cord.scale.set(1, 0.85, 1);
  scene.add(cord);
  const cordEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.55, 5), cord.material);
  scene.add(cordEnd);

  // Roman-type horn lantern carried in the right hand.
  const lantern = new THREE.Group();
  const bronze = withAtmos(new THREE.MeshStandardMaterial({ color: 0x3a2c1a, roughness: 0.6, metalness: 0.6 }));
  const horn = withAtmos(new THREE.MeshStandardMaterial({ color: 0x1a0f05, emissive: 0xff8a30, emissiveIntensity: 1.6, roughness: 0.6, side: THREE.DoubleSide }));
  const hornMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 12, 1, true), horn);
  hornMesh.position.y = -0.2;
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), bronze);
  lid.position.y = -0.1;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), bronze);
  base.position.y = -0.3;
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 4, 12, Math.PI), bronze);
  bail.position.y = -0.03;
  lantern.add(hornMesh, lid, base, bail);
  scene.add(lantern);
  const lanternWorldPos = new THREE.Vector3();
  const swing = { a: 0, v: 0 };

  let built = false;
  let walkW = 1;

  const update = (dt: number, pos: THREE.Vector3, yaw: number, speed: number) => {
    dt = Math.min(dt, 0.1);
    group.position.copy(pos);
    group.rotation.set(0, yaw, 0);
    // Walk when moving, idle when not; playback matched to ground speed.
    walkW += ((speed > 0.08 ? 1 : 0) - walkW) * Math.min(1, dt * 4);
    walk.setEffectiveWeight(walkW);
    idle.setEffectiveWeight(1 - walkW);
    walk.timeScale = THREE.MathUtils.clamp(speed / 1.35, 0.4, 1.6);
    mixer.update(dt);
    group.updateMatrixWorld(true);
    if (!built) {
      syncBones();
      place(floor, tv.copy(pos).add(new THREE.Vector3(0, -0.1, 0)), tq.identity());
      makeCloth(habit, seg, 1.6, 0.7, [[0, neckBody], [waistRing, beltBody]], wool(0x211a14, 0x544434));
      makeCloth(cape, cseg, 0.45, 0.95, [[0, neckBody]], wool(0x1c1611, 0x4a3c30));
      built = true;
      // Settle the cloth before it is first seen.
      for (let i = 0; i < 90; i++) world.stepSimulation(STEP, 0);
    }
    syncBones();
    place(floor, tv.copy(pos).add(new THREE.Vector3(0, -0.1, 0)), tq.identity());
    stepWorld(dt);
    for (const c of cloths) {
      const nodes = c.sb.get_m_nodes();
      const arr = (c.mesh.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < c.map.length; i++) {
        const x = nodes.at(c.map[i]).get_m_x();
        arr[i * 3] = x.x(); arr[i * 3 + 1] = x.y(); arr[i * 3 + 2] = x.z();
      }
      c.mesh.geometry.attributes.position.needsUpdate = true;
      c.mesh.geometry.computeVertexNormals();
    }
    // Cowl on the head, cord at the waist.
    B.head.matrixWorld.decompose(tv, tq, ts);
    // World rotation of the head relative to its rest pose (yaw included).
    hood.quaternion.copy(tq).multiply(headRest);
    hood.position.copy(tv).add(hoodOffset.clone().applyQuaternion(hood.quaternion));
    B.spine.getWorldPosition(tv);
    cord.position.copy(tv);
    cord.quaternion.copy(B.spine.getWorldQuaternion(tq).multiply(beltRest)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    cordEnd.position.copy(tv).add(new THREE.Vector3(0.12, -0.27, 0.1).applyQuaternion(group.quaternion));
    // Lantern hangs from the hand and swings like a pendulum, staying upright-ish.
    B.rHand.getWorldPosition(tv);
    const handV = tv.clone().sub(lantern.position).divideScalar(Math.max(dt, 1e-3));
    swing.v += (-swing.a * 30 - handV.dot(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))) * 0.6 - swing.v * 3) * dt;
    swing.a = THREE.MathUtils.clamp(swing.a + swing.v * dt, -0.5, 0.5);
    lantern.position.copy(tv);
    lantern.rotation.set(0, yaw, 0);
    lantern.rotateX(swing.a);
    lantern.updateMatrixWorld(true);
    hornMesh.getWorldPosition(lanternWorldPos);
  };

  return { group, lanternWorldPos, update };
}
