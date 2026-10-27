import * as THREE from 'three';
import type { OutfitV2 } from './kit';

// Cloth bones as springs: the chains baked into the v2 bodies
// (tools/npc2/cloth_bones.py) hanging from the hips (skirts) and the upper
// back (cloaks, shawls) are swung each frame by a small Verlet solver, the
// way games do skirts, capes and hair on phones (VRM SpringBone; Unity and
// Unreal "dynamic"/"jiggle" bones): each bone's tip is a particle with
// inertia and drag, pulled back towards where the animation (the bind
// pose's hang) would put it, kept at its bone's length, and pushed out of
// capsules round the legs, pelvis, trunk and arms — so a striding thigh
// pushes the skirt before it, a turn swings the cloak out. Costs a few
// dozen vector operations per bone; nothing is simulated far away.

interface Link { bone: THREE.Bone; child: THREE.Object3D; rest: THREE.Quaternion; len: number; p: THREE.Vector3; q: THREE.Vector3; t: THREE.Vector3; tq: THREE.Vector3; h: THREE.Vector3 }
interface Chain { links: Link[] }
interface Ring { chains: Chain[]; levels: Link[][]; closed: boolean; stiff: number; drag: number; side: number[][] }
interface Cap { a: THREE.Object3D; b: THREE.Object3D; r: number; pa: THREE.Vector3; pb: THREE.Vector3 }

const SETS: Record<string, { stiff: number; drag: number; closed: boolean }> = {
  long: { stiff: 0.12, drag: 0.25, closed: true }, short: { stiff: 0.2, drag: 0.3, closed: true }, cape: { stiff: 0.30, drag: 0.35, closed: false },
};

const _d = new THREE.Vector3(), _e = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _p = new THREE.Vector3(), _sc = new THREE.Vector3();

/**
 * A bone's own world matrix from its parent's (already current), without
 * the recursive updates of three's helpers: down a chain level by level
 * that would redo every bone below each link (quadratic in its length).
 * The renderer's own scene update brings the rest of the tree up to date.
 */
function own(b: THREE.Object3D) {
  b.updateMatrix();
  b.matrixWorld.multiplyMatrices(b.parent!.matrixWorld, b.matrix);
}

/**
 * The spring update for a person's cloth bones (null if their outfit has
 * none). Call after the animation. Level by level down the chains: each
 * link's tip moves with the hang the animation gives it plus its own
 * velocity relative to that (so walking at a steady pace doesn't make the
 * cloth trail: only changes of pace and turns swing it), damped, pulled
 * back to the hang, pushed out of the body, kept at its length and at its
 * rest distance from the tips of the chains either side (so the cloth
 * between them can't fold over itself).
 */
export function makeSprings(body: THREE.Object3D, outfit: OutfitV2, scale: number, bone: (n: string) => THREE.Bone | undefined) {
  const sets = new Set<string>();
  for (const g of outfit.garments) { const c = (g as unknown as { chains?: { set: string } }).chains; if (c) sets.add(c.set); }
  if (!sets.size) return null;
  const byName = new Map<string, THREE.Bone>();
  body.traverse((o) => { if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone); });
  body.updateMatrixWorld(true);
  const rings: Ring[] = [];
  for (const set of sets) {
    const chains: Chain[] = [];
    for (let i = 0; ; i++) {
      const links: Link[] = [];
      for (let j = 0; ; j++) {
        const b = byName.get(`cb_${set}_${i}_${j}`);
        if (!b) break;
        const child = byName.get(`cb_${set}_${i}_${j + 1}`) ?? byName.get(`cb_${set}_${i}_end`);
        if (!child) break;
        links.push({ bone: b, child, rest: b.quaternion.clone(), len: child.position.length(), p: new THREE.Vector3(), q: new THREE.Vector3(), t: new THREE.Vector3(), tq: new THREE.Vector3(), h: new THREE.Vector3() });
      }
      if (!links.length) break;
      chains.push({ links });
    }
    if (!chains.length) continue;
    const S = SETS[set] ?? SETS.long;
    // Rest distances between neighbouring tips, per level (in the body's own units).
    const inv = body.matrixWorld.clone().invert();
    const tip = (c: Chain, j: number) => c.links[j].child.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const side = chains.map((c, i) => c.links.map((_, j) => {
      const k = (i + 1) % chains.length;
      if (!S.closed && i === chains.length - 1) return -1;
      const o = chains[k];
      return j < o.links.length ? tip(c, j).distanceTo(tip(o, j)) : -1;
    }));
    const depth = Math.max(...chains.map((c) => c.links.length));
    const levels = Array.from({ length: depth }, (_, j) => chains.map((c) => c.links[j]).filter(Boolean));
    rings.push({ chains, levels, closed: S.closed, stiff: S.stiff, drag: S.drag, side });
  }
  if (!rings.length) return null;
  const B = (n: string) => bone(n)!;
  const cap = (a: string, b: string, r: number): Cap => ({ a: B(a), b: B(b), r, pa: new THREE.Vector3(), pb: new THREE.Vector3() });
  const caps: Cap[] = [
    cap('LeftUpLeg', 'LeftLeg', 0.1), cap('RightUpLeg', 'RightLeg', 0.1),
    cap('LeftLeg', 'LeftFoot', 0.08), cap('RightLeg', 'RightFoot', 0.08),
    cap('LeftUpLeg', 'RightUpLeg', 0.1), cap('Hips', 'Spine1', 0.13), cap('Spine1', 'Neck', 0.13),
    cap('LeftShoulder', 'LeftArm', 0.08), cap('RightShoulder', 'RightArm', 0.08),
    // Fitted sleeves are ~6 cm at the elbow and taper to a 4 cm cuff.
    // The previous 10/8 cm capsules inflated the mantle around invisible
    // armour-sized arms, producing a sail even during a quiet walk.
    cap('LeftArm', 'LeftForeArm', 0.075), cap('RightArm', 'RightForeArm', 0.075),
    cap('LeftForeArm', 'LeftHand', 0.055), cap('RightForeArm', 'RightHand', 0.055),
  ];
  let fresh = true, resting = false, previousDt = 1 / 60;
  const g = new THREE.Vector3(0, -9.8, 0);
  /** Back to the plain hang (far from the camera), once. */
  const rest = () => {
    if (resting) return;
    resting = true;
    fresh = true;
    for (const R of rings) for (const c of R.chains) for (const L of c.links) L.bone.quaternion.copy(L.rest);
  };
  const advance = (dt: number) => {
    resting = false;
    // Coefficients below describe a 60 Hz step. Verlet velocity is a
    // displacement, so changes in frame duration must scale it as well as
    // gravity. The caller bounds each step for stability at low frame rates.
    const step = dt * 60, velocityScale = dt / previousDt;
    body.updateMatrixWorld(true);
    for (const c of caps) { c.pa.setFromMatrixPosition(c.a.matrixWorld); c.pb.setFromMatrixPosition(c.b.matrixWorld); }
    const s = body.getWorldScale(_v).x || scale;
    const grav = _e.copy(g).multiplyScalar(s * dt * dt * 0.3);
    for (const R of rings) {
      const drag = Math.pow(1 - R.drag, step), stiffness = R.stiff * step * step;
      for (let j = 0; j < R.levels.length; j++) {
        const lv = R.levels[j];
        for (const L of lv) {
          L.bone.quaternion.copy(L.rest);
          own(L.bone);
          L.h.setFromMatrixPosition(L.bone.matrixWorld);
          L.tq.copy(L.t);
          L.t.copy(L.child.position).applyMatrix4(L.bone.matrixWorld);
          if (fresh || L.p.distanceToSquared(L.t) > 1) { L.p.copy(L.t); L.q.copy(L.t); L.tq.copy(L.t); }
          // Velocity relative to the hang's own motion, damped.
          _d.copy(L.p).sub(L.q).multiplyScalar(velocityScale).sub(_w.copy(L.t).sub(L.tq)).multiplyScalar(drag);
          L.q.copy(L.p);
          L.p.add(_w);
          _v.copy(L.t).sub(L.p).multiplyScalar(stiffness);
          L.p.add(_d).add(grav).add(_v);
        }
        // Neighbours kept apart (and together) as at rest; then out of the body; then each at its length.
        for (let it = 0; it < 2; it++) {
          R.chains.forEach((c, i) => {
            const rd = R.side[i][j];
            if (rd === undefined || rd < 0) return;
            const A = c.links[j], N = R.chains[(i + 1) % R.chains.length].links[j];
            if (!A || !N) return;
            _d.copy(N.p).sub(A.p);
            const d = _d.length(), want = rd * s;
            if (d < 1e-6) return;
            const k = (d - want) / d * 0.5 * (d < want ? 1 : 0.3);
            A.p.addScaledVector(_d, k);
            N.p.addScaledVector(_d, -k);
          });
        }
        for (const L of lv) {
          for (const c of caps) pushOut(L.p, c, c.r * s + 0.01 * s);
          const len = L.len * s;
          _d.copy(L.p).sub(L.h);
          const dl = _d.length();
          if (dl > 1e-6) L.p.copy(L.h).addScaledVector(_d, len / dl);
          // The bone turned to point at it.
          _v.copy(L.t).sub(L.h).normalize();
          _d.normalize();
          _q.setFromUnitVectors(_v, _d);
          L.bone.matrixWorld.decompose(_p, _qw, _sc);
          _qw.premultiply(_q);
          L.bone.parent!.matrixWorld.decompose(_p, _qp, _sc);
          L.bone.quaternion.copy(_qp.invert().multiply(_qw));
          own(L.bone);
        }
      }
    }
    fresh = false;
    previousDt = dt;
  };
  const update = (dt: number) => {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Do not freeze cloth on a 15–20 FPS phone. Use at most three bounded
    // steps; after a suspended tab or a long stall discard stale inertia.
    if (dt > 0.25) fresh = true;
    const elapsed = Math.min(dt, 0.1), steps = Math.ceil(elapsed * 30);
    for (let i = 0; i < steps; i++) advance(elapsed / steps);
  };
  return { update, rest };
}

function pushOut(p: THREE.Vector3, c: Cap, r: number) {
  _ab.copy(c.pb).sub(c.pa);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-9 ? THREE.MathUtils.clamp(_ap.copy(p).sub(c.pa).dot(_ab) / l2, 0, 1) : 0;
  _ap.copy(c.pa).addScaledVector(_ab, t);
  const d = p.distanceTo(_ap);
  if (d < r && d > 1e-6) p.sub(_ap).multiplyScalar(r / d).add(_ap);
}
