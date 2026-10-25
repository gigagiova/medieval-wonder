import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadNpcAssets, makePerson, spawnTownsfolk, updateTownsfolk, npcDebug, type Person, type Role } from './npc';
import { canon, CLIP_SRC, type ClipName, type Motion } from './npc/rig';
import { loadGltf } from './gltf';
import { shared } from './materials';

// Animation test bench for the townsfolk.
//
//   ?view=strip   one row per body, n poses of a clip side by side
//                 &who=man,woman (man|monk|soldier|woman) &anim=walk &n=12 &cam=front|side|back|q|top
//                 &bare=1 (undressed bind body) &skel=1 &zoom=full|upper|legs|hands &from=0&to=1 (cycle fraction)
//   ?view=metrics numbers for every clip on both bodies (window.__stats)
//   ?view=street  the real crowd code on one long street, numbers per person
//                 &t=s &slope=0..1 &count=n
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'strip';
const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5a5f66);
shared.uFogCol.value.setRGB(0.15, 0.155, 0.165);
scene.add(new THREE.HemisphereLight(0xb4bcc6, 0x4a4842, 3.0));
const sun = new THREE.DirectionalLight(0xc4ccd6, 0.9);
sun.position.set(-3, 5, 4);
scene.add(sun);
const stats: Record<string, unknown> = {};
(window as unknown as { __stats: unknown }).__stats = stats;
await loadNpcAssets();

type Kit = 'man' | 'woman';
interface KitData { template: THREE.Object3D; motion: Motion; scale: number }
const kitOf = (p: Person) => (p as unknown as { kit: KitData }).kit;
const ROLE: Record<string, [Role, number]> = { man: ['peasant', 0], peasant: ['peasant', 0], monk: ['monk', 0], soldier: ['soldier', 0], woman: ['woman', 0] };
const r2d = THREE.MathUtils.RAD2DEG;

/** A body to pose by hand: the dressed person, or its undressed template. */
interface Subject { st?: ReturnType<typeof sticks>; name: string; kit: Kit; group: THREE.Group; root: THREE.Object3D; bones: Map<string, THREE.Bone>; mixer: THREE.AnimationMixer; motion: Motion; person: Person; walkClip: ClipName }
let ualG: Awaited<ReturnType<typeof loadGltf>> | null = null;
if ((params.get('who') ?? '').includes('ual')) ualG = await loadGltf('models/npc/ual.json');
/** Sticks between every bone and its parent, for skeletons without a mesh. */
function sticks(root: THREE.Object3D) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8b090, roughness: 0.8 });
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
  const list: { b: THREE.Object3D; m: THREE.Mesh }[] = [];
  root.traverse((o) => { if (o.parent && o !== root && o.parent !== root && o.parent.parent !== root) { const m = new THREE.Mesh(geo, mat); g.add(m); list.push({ b: o, m }); } });
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const update = () => {
    root.updateMatrixWorld(true);
    for (const { b: o, m } of list) {
      o.parent!.getWorldPosition(a); o.getWorldPosition(b);
      const L = a.distanceTo(b);
      m.position.copy(a);
      m.scale.set(0.02, Math.max(L, 1e-4), 0.02);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    }
  };
  return { g, update };
}
function ualSubject(): Subject {
  const root = SkeletonUtils.clone(ualG!.scene);
  const group = new THREE.Group();
  group.add(root);
  scene.add(group);
  root.updateMatrixWorld(true);
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => { bones.set(o.name, o as THREE.Bone); });
  const mixer = new THREE.AnimationMixer(root);
  const st = sticks(root);
  scene.add(st.g);
  // Source clips under our names; scaled to the man's hip height.
  const clips = {} as Record<ClipName, THREE.AnimationClip>;
  for (const [k, v] of Object.entries(CLIP_SRC)) clips[k as ClipName] = ualG!.animations.find((c) => c.name === v)!;
  mixer.clipAction(ualG!.animations.find((c) => c.name === 'A_TPose')!).play();
  mixer.setTime(0);
  root.updateMatrixWorld(true);
  const hy = bones.get('pelvis')!.getWorldPosition(new THREE.Vector3()).y;
  group.scale.setScalar(0.93 / hy);
  mixer.stopAllAction();
  return { st, name: 'ual', kit: 'man', group, root, bones, mixer, motion: { clips, speed: { walk: 0, walkFormal: 0 }, start: { walk: 0, walkFormal: 0 } }, person: null as unknown as Person, walkClip: 'walk' };
}
function subject(name: string, bare: boolean): Subject {
  if (name === 'ual') return ualSubject();
  const [role, outfit] = ROLE[name] ?? ROLE.man;
  const person = makePerson(scene, role, { outfit, seed: 5, gear: {} });
  const k = kitOf(person);
  let group = person.group, root = person.body;
  if (bare) {
    person.setVisible(false);
    group = new THREE.Group();
    root = SkeletonUtils.clone(k.template);
    group.add(root);
    group.scale.setScalar(person.scale);
    scene.add(group);
    root.traverse((o) => { o.frustumCulled = false; });
  } else person.cloth.setSimulating(false);
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(canon(o.name), o as THREE.Bone); });
  let st: ReturnType<typeof sticks> | undefined;
  if (params.get('sticks') === '1') { st = sticks(root); scene.add(st.g); root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).visible = false; }); }
  return { st, name, kit: person.outfit.sex, group, root, bones, mixer: new THREE.AnimationMixer(root), motion: k.motion, person, walkClip: role === 'monk' ? 'walkFormal' : 'walk' };
}
function pose(s: Subject, clip: ClipName, t: number) {
  s.mixer.stopAllAction();
  const a = s.mixer.clipAction(s.motion.clips[clip]);
  a.reset().play();
  a.time = t;
  s.mixer.update(0);
  s.group.updateMatrixWorld(true);
  s.st?.update();
}
const clipName = (s: Subject, a: string) => (a === 'walk' ? s.walkClip : a) as ClipName;

// ------------------------------------------------------------------ strip
if (view === 'strip') {
  const who = (params.get('who') ?? 'man,woman').split(',');
  const bare = params.get('bare') === '1';
  const subs = who.map((w) => subject(w, bare));
  const anim = params.get('anim') ?? 'walk';
  const n = Number(params.get('n') ?? 12);
  const from = Number(params.get('from') ?? 0), to = Number(params.get('to') ?? 1);
  const cam = params.get('cam') ?? 'side';
  const zoom = params.get('zoom') ?? 'full';
  const grid = new THREE.GridHelper(4, 80, 0x222222, 0x3a3a3a);
  (grid.material as THREE.Material).depthWrite = false;
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(zoom === 'full' ? 30 : 30, (W / n) / (H / subs.length), 0.02, 50);
  const Z: Record<string, [number, number]> = { full: [0.88, 4.2], upper: [1.3, 1.7], legs: [0.45, 1.8], hands: [1.0, 1.7], feet: [0.15, 1.3], foot: [0.1, 0.8] };
  const [cy, cd] = Z[zoom] ?? Z.full;
  const D: Record<string, THREE.Vector3> = { front: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0), back: new THREE.Vector3(0, 0, -1), q: new THREE.Vector3(1, 0, 1).normalize(), top: new THREE.Vector3(0, 1, 0.02).normalize(), left: new THREE.Vector3(-1, 0, 0) };
  const dir = D[cam] ?? D.side;
  const helpers: THREE.SkeletonHelper[] = [];
  if (params.get('skel') === '1') for (const s of subs) { const h = new THREE.SkeletonHelper(s.root); (h.material as THREE.LineBasicMaterial).depthTest = false; scene.add(h); helpers.push(h); }
  const tw = W / n, th = H / subs.length;
  subs.forEach((s, row) => {
    for (const o of subs) { o.group.visible = o === s; if (o.st) o.st.g.visible = o === s; }
    helpers.forEach((h, i) => { h.visible = subs[i] === s; });
    const c = clipName(s, anim), dur = s.motion.clips[c].duration;
    for (let i = 0; i < n; i++) {
      const t = (from + ((to - from) * i) / n) * dur;
      pose(s, c, t);
      if (params.get('move') === '1' && s.person) {
        // Travel at the clip's own ground speed, as the game drives it.
        const v = s.motion.speed[c as 'walk'] * s.group.scale.x;
        s.group.position.z = v * (t - ((from + to) / 2) * dur);
        s.group.updateMatrixWorld(true);
        s.st?.update();
      }
      const h = cy * (s.kit === 'woman' ? 0.92 : 1);
      camera.position.set(0, h, 0).addScaledVector(dir, cd);
      if (cam === 'top') camera.position.y += 0.6;
      camera.lookAt(0, cam === 'top' ? 0 : h, 0);
      const x = i * tw, y = H - (row + 1) * th;
      renderer.setViewport(x, y, tw, th);
      renderer.setScissor(x, y, tw, th);
      renderer.render(scene, camera);
    }
  });
  stats.durations = Object.fromEntries(subs.map((s) => [s.name, s.motion.clips[clipName(s, anim)].duration]));
}

// ------------------------------------------------------------------ metrics
/** Sole vertices of a body (lowest few cm in the bind pose), per side. */
function soles(root: THREE.Object3D) {
  const out: { m: THREE.SkinnedMesh; i: number; side: number }[] = [];
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let minY = Infinity;
  const all: { m: THREE.SkinnedMesh; i: number; y: number; x: number }[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      if (v.y < 0.12) all.push({ m, i, y: v.y, x: v.x });
      minY = Math.min(minY, v.y);
    }
  });
  for (const a of all) if (a.y < minY + 0.035) out.push({ m: a.m, i: a.i, side: a.x > 0 ? 0 : 1 });
  return { verts: out, minY };
}
function solePoints(sl: ReturnType<typeof soles>, out: THREE.Vector3[]) {
  const v = new THREE.Vector3();
  sl.verts.forEach((s, k) => { s.m.getVertexPosition(s.i, v).applyMatrix4(s.m.matrixWorld); (out[k] ??= new THREE.Vector3()).copy(v); });
  return out;
}
const flex = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, axis: THREE.Vector3) => {
  const u = b.clone().sub(a).normalize(), w = c.clone().sub(b).normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(u.dot(w), -1, 1));
  return Math.sign(new THREE.Vector3().crossVectors(u, w).dot(axis) || 1) * ang * r2d;
};
const segDist = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
  const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
};

if (view === 'metrics') {
  const who = (params.get('who') ?? 'man,woman').split(',');
  const clips = (params.get('clips') ?? 'walk,walkFormal,idle,talk,bless,kneel,pickup,interact').split(',') as ClipName[];
  const res: Record<string, unknown> = {};
  for (const w of who) {
    const s = subject(w, true);
    s.group.updateMatrixWorld(true);
    const sl = soles(s.root);
    const P: THREE.Vector3[] = [];
    const B = (n: string) => s.bones.get(n)!.getWorldPosition(new THREE.Vector3());
    const restHips = B('Hips').y;
    const per: Record<string, unknown> = { soleRest: +(sl.minY * 100).toFixed(1), nSole: sl.verts.length, restHips: +restHips.toFixed(3) };
    for (const c of clips) {
      const clip = s.motion.clips[c], dur = clip.duration, N = 120;
      const all = [...s.bones.values()];
      let prevQ: THREE.Quaternion[] | null = null, prevP: THREE.Vector3[] | null = null;
      const angV: number[] = [];
      let maxAng = 0, maxAngBone = '', maxAngT = 0;
      let minSole = Infinity, maxSoleMin = -Infinity, hipsMin = Infinity, hipsMax = -Infinity;
      let kneeMin = Infinity, elbowMin = Infinity;
      let handTorso = Infinity, handThigh = Infinity, elbowTorso = Infinity;
      const footLow: number[] = [];
      for (let f = 0; f <= N; f++) {
        const t = f === N ? dur - 1e-4 : (f / N) * dur;
        pose(s, c, t);
        const q = all.map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
        const pp = all.map((b) => b.getWorldPosition(new THREE.Vector3()));
        if (prevQ && prevP) {
          let fm = 0, fb = '';
          all.forEach((b, i) => { const a = q[i].angleTo(prevQ![i]) * r2d; if (a > fm) { fm = a; fb = canon(b.name); } });
          angV.push(fm);
          if (fm > maxAng) { maxAng = fm; maxAngBone = fb; maxAngT = t; }
        }
        prevQ = q; prevP = pp;
        solePoints(sl, P);
        const lows = [Infinity, Infinity];
        sl.verts.forEach((v, k) => { lows[v.side] = Math.min(lows[v.side], P[k].y); });
        const low = Math.min(...lows);
        footLow.push(low);
        minSole = Math.min(minSole, low); maxSoleMin = Math.max(maxSoleMin, low);
        const hy = B('Hips').y; hipsMin = Math.min(hipsMin, hy); hipsMax = Math.max(hipsMax, hy);
        const lat = B('LeftUpLeg').sub(B('RightUpLeg')).normalize();
        for (const S of ['Left', 'Right']) {
          // Knee: positive = bent the right way (shin back).
          const kf = -flex(B(S + 'UpLeg'), B(S + 'Leg'), B(S + 'Foot'), lat);
          kneeMin = Math.min(kneeMin, kf);
          const sp = B(S + 'Arm'), el = B(S + 'ForeArm'), ha = B(S + 'Hand');
          const ef = Math.acos(THREE.MathUtils.clamp(el.clone().sub(sp).normalize().dot(ha.clone().sub(el).normalize()), -1, 1)) * r2d;
          elbowMin = Math.min(elbowMin, ef);
          // Hand/elbow against the torso axis and the thigh.
          const tor = segDist(ha, B('Hips'), B('Spine2')), th = Math.min(segDist(ha, B(S + 'UpLeg'), B(S + 'Leg')));
          handTorso = Math.min(handTorso, tor); handThigh = Math.min(handThigh, th);
          elbowTorso = Math.min(elbowTorso, segDist(el, B('Spine'), B('Spine2')));
        }
      }
      angV.sort((a, b) => a - b);
      per[c] = {
        dur: +dur.toFixed(2),
        soleMin: +(minSole * 100).toFixed(1), soleMinMax: +(maxSoleMin * 100).toFixed(1),
        hips: [+hipsMin.toFixed(3), +hipsMax.toFixed(3)],
        kneeFlexMin: +kneeMin.toFixed(1), elbowFlexMin: +elbowMin.toFixed(1),
        handTorso: +(handTorso * 100).toFixed(1), handThigh: +(handThigh * 100).toFixed(1), elbowTorso: +(elbowTorso * 100).toFixed(1),
        angV: { med: +angV[angV.length >> 1].toFixed(2), p95: +angV[Math.floor(angV.length * 0.95)].toFixed(2), max: +maxAng.toFixed(2), bone: maxAngBone, t: +maxAngT.toFixed(2) },
      };
    }
    // Loop seams: last frame against first.
    for (const c of clips) {
      const clip = s.motion.clips[c];
      pose(s, c, 0);
      const q0 = [...s.bones.values()].map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
      const p0 = B('Hips');
      pose(s, c, clip.duration - 1e-4);
      let m = 0, mb = '';
      [...s.bones.values()].forEach((b, i) => { const a = b.getWorldQuaternion(new THREE.Quaternion()).angleTo(q0[i]) * r2d; if (a > m) { m = a; mb = canon(b.name); } });
      (per[c] as Record<string, unknown>).seam = { deg: +m.toFixed(2), bone: mb, hipsCm: +(B('Hips').distanceTo(p0) * 100).toFixed(1) };
    }
    // Ground speed of the walks: how fast a planted sole moves back under the body.
    for (const c of ['walk', 'walkFormal'] as ClipName[]) {
      const clip = s.motion.clips[c], N = 240, dt = clip.duration / N;
      const tr: THREE.Vector3[][] = [];
      for (let f = 0; f < N; f++) { pose(s, c, f * dt); tr.push(solePoints(sl, []).map((v) => v.clone())); }
      // Per side: frames where that foot's lowest vertex is within 1 cm of its lowest.
      const speeds: number[] = [];
      for (const side of [0, 1]) {
        const ks = sl.verts.map((v, k) => (v.side === side ? k : -1)).filter((k) => k >= 0);
        const low = tr.map((fr) => Math.min(...ks.map((k) => fr[k].y)));
        const floor = Math.min(...low);
        for (let f = 0; f < N; f++) {
          const g = (f + 1) % N;
          if (low[f] > floor + 0.01 || low[g] > floor + 0.01) continue;
          // The lowest vertex now: its forward velocity.
          let kb = ks[0];
          for (const k of ks) if (tr[f][k].y < tr[f][kb].y) kb = k;
          speeds.push(-(tr[g][kb].z - tr[f][kb].z) / dt);
        }
      }
      speeds.sort((a, b) => a - b);
      const sc = s.group.scale.x;
      (per[c] as Record<string, unknown>).groundSpeed = { median: +speeds[speeds.length >> 1].toFixed(3), perScale: +(speeds[speeds.length >> 1] / sc).toFixed(3), estimate: s.motion.speed[c as 'walk'], frames: speeds.length };
    }
    res[w] = per;
    s.group.visible = false;
  }
  stats.metrics = res;
}

// ------------------------------------------------------------------ street
if (view === 'street') {
  const slope = Number(params.get('slope') ?? 0);
  const ground = (x: number, z: number) => slope * (Math.sin(x * 0.3) * 0.5 + Math.sin(z * 0.11) * 2.2 + Math.cos(z * 0.23 + x * 0.1) * 0.6);
  {
    const g = new THREE.PlaneGeometry(80, 80, 160, 160).rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1 })));
  }
  const P = (pts: number[][]) => pts.map(([x, z]) => new THREE.Vector2(x, z));
  const streets = [{ pts: P([[0, -12], [0, 12]]), w: 3.2, main: true }, { pts: P([[0, 0], [8, 1]]), w: 2.4 }];
  spawnTownsfolk(scene, { streets, ground, lamps: [], count: Number(params.get('count') ?? 6) });
  const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 110), W / H, 0.05, 200);
  const cv = (params.get('cam') ?? '0.1,9,0,0,0,0').split(',').map(Number);
  camera.position.set(cv[0], cv[1], cv[2]);
  camera.lookAt(cv[3], cv[4], cv[5]);
  camera.updateMatrixWorld();
  const player = { pos: new THREE.Vector3(30, 1.6, 30) };
  const people = npcDebug.people;
  const sls = people.map((p) => { p.group.updateMatrixWorld(true); return null as ReturnType<typeof soles> | null; });
  const T = Number(params.get('t') ?? 20), dt = 1 / 60, N = Math.round(T / dt);
  type Rec = { bad: unknown[]; penAt?: unknown; stances: number[]; pen: number; float: number; pops: { v: number; bone: string; t: number; ws: string }[]; vmax: number };
  const rec: Rec[] = people.map(() => ({ bad: [], stances: [], pen: 0, float: 0, pops: [], vmax: 0 }));
  const state = people.map(() => ({ open: [null, null] as ({ slide: number; n: number } | null)[], prevLow: [-1, -1], prevPts: null as THREE.Vector3[] | null, prevLocal: null as THREE.Vector3[] | null, prev2: null as THREE.Vector3[] | null }));
  const inv = new THREE.Matrix4(), v = new THREE.Vector3();
  const trace: unknown[] = [];
  for (let f = 0; f < N; f++) {
    updateTownsfolk(dt, camera, player);
    people.forEach((p, pi) => {
      p.group.updateMatrixWorld(true);
      if (!sls[pi]) {
        // Sole vertices from the bind pose of a clone (the person is already animated).
        const c = SkeletonUtils.clone(kitOf(p).template);
        c.scale.setScalar(p.scale);
        sls[pi] = soles(c);
        const map = new Map<string, THREE.SkinnedMesh>();
        p.body.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) map.set(o.name, o as THREE.SkinnedMesh); });
        sls[pi]!.verts = sls[pi]!.verts.filter((s) => map.has(s.m.name)).map((s) => ({ ...s, m: map.get(s.m.name)! }));
      }
      const sl = sls[pi]!;
      const pts = solePoints(sl, []);
      const r = rec[pi], st = state[pi];
      // Slide: how far the contact point (each foot's lowest vertex last
      // frame) moves while it stays on the ground, summed over a stance.
      const gy = (q: THREE.Vector3) => q.y - ground(q.x, q.z);
      for (const side of [0, 1]) {
        let kb = -1, lowH = Infinity;
        sl.verts.forEach((s, k) => { if (s.side !== side) return; const h = gy(pts[k]); if (h < lowH) { lowH = h; kb = k; } });
        if (lowH < r.pen) { r.pen = lowH; r.penAt = { t: +(f * dt).toFixed(2), sp: +p.speed.toFixed(2), ws: Object.entries(p.w).filter(([, x]) => x > 0.01).map(([k, x]) => `${k}${x.toFixed(2)}`).join(' ') }; }
        const planted = lowH < 0.012;
        let o = st.open[side];
        if (planted && !o) o = st.open[side] = { slide: 0, n: 0 };
        const j = st.prevLow[side];
        if (planted && o && st.prevPts && j >= 0) {
          if (gy(st.prevPts[j]) < 0.004 && gy(pts[j]) < 0.004 && Math.abs(gy(pts[j]) - gy(st.prevPts[j])) < 0.001) o.slide += Math.hypot(pts[j].x - st.prevPts[j].x, pts[j].z - st.prevPts[j].z);
          o.n++;
        }
        if (!planted && o) { if (o.n > 6) { r.stances.push(o.slide * 100); if (o.slide > 0.04) r.bad.push({ cm: +(o.slide * 100).toFixed(1), t: +(f * dt).toFixed(2), n: o.n, sp: +p.speed.toFixed(2), ts: +p.acts.walk.timeScale.toFixed(2), ws: Object.entries(p.w).filter(([, x]) => x > 0.01).map(([k, x]) => `${k}${x.toFixed(2)}`).join(' ') }); } st.open[side] = null; }
        st.prevLow[side] = kb;
      }
      st.prevPts = pts;
      // Pops: a body-local bone position jumping off its course (second
      // difference over three frames, cm; smooth motion stays well under 1).
      const loc = p.skeleton.bones.map((b) => b.getWorldPosition(v).applyMatrix4(inv.copy(p.group.matrixWorld).invert()).multiplyScalar(p.scale).clone());
      if (p.animAcc === 0 && st.prevLocal && st.prev2) {
        let m = 0, mb = '';
        loc.forEach((q, i) => { const d = q.clone().sub(st.prevLocal![i]).sub(st.prevLocal![i]).add(st.prev2![i]).length() * 100; if (d > m) { m = d; mb = canon(p.skeleton.bones[i].name); } });
        r.vmax = Math.max(r.vmax, m);
        if (m > 2) r.pops.push({ v: +m.toFixed(2), bone: mb, t: +(f * dt).toFixed(2), ws: Object.entries(p.w).filter(([, x]) => x > 0.01).map(([k, x]) => `${k}${x.toFixed(2)}`).join(' ') });
      }
      if (p.animAcc === 0) { st.prev2 = st.prevLocal; st.prevLocal = loc; }
      if (params.get('trace') === String(pi)) trace.push({ L: (() => { let kb = -1; sl.verts.forEach((s, k) => { if (s.side === 0 && (kb < 0 || pts[k].y < pts[kb].y)) kb = k; }); return pts[kb].toArray().map((x) => +x.toFixed(3)); })(), wt: +p.acts.walk.time.toFixed(2), vis: p.visible, t: +(f * dt).toFixed(2), yaw: +p.yaw.toFixed(3), x: +p.pos.x.toFixed(3), z: +p.pos.z.toFixed(3), sp: +p.speed.toFixed(2), ts: +p.acts.walk.timeScale.toFixed(2), w: Object.entries(p.w).filter(([, x]) => x > 0.01).map(([k, x]) => `${k}${x.toFixed(2)}`).join(' ') });
    });
  }
  stats.people = people.map((p, i) => {
    const s = rec[i].stances.slice().sort((a, b) => a - b);
    return { role: p.role, kit: p.outfit.sex + ":" + p.outfit.body, walkSpeed: +p.walkSpeed.toFixed(3), scale: +p.scale.toFixed(3), nStance: s.length, slideMed: +(s[s.length >> 1] ?? 0).toFixed(1), slideP90: +(s[Math.floor(s.length * 0.9)] ?? 0).toFixed(1), slideMax: +(s[s.length - 1] ?? 0).toFixed(1), penCm: +(rec[i].pen * 100).toFixed(1), vmax: +rec[i].vmax.toFixed(2), pops: rec[i].pops.slice(0, 6), nPops: rec[i].pops.length, bad: rec[i].bad.slice(0, 8), penAt: rec[i].penAt };
  });
  if (trace.length) stats.trace = trace.filter((_, i) => i % Number(params.get('every') ?? 10) === 0 && i < Number(params.get('upto') ?? 1e9));
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  renderer.render(scene, camera);
}
(window as unknown as { __dbg: unknown }).__dbg = { THREE, SkeletonUtils, scene, subject, pose, soles, solePoints, makePerson, npcDebug, kitOf, canon };
(window as unknown as { __done: boolean }).__done = true;
