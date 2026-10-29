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
interface Ring { chains: Chain[]; levels: Link[][]; closed: boolean; stiff: number; drag: number; side: number[][]; cape: boolean }
interface Cap { a: THREE.Object3D; b: THREE.Object3D; r: number; pa: THREE.Vector3; pb: THREE.Vector3; /** Ends as points in the bones' frames (else the bone origins). */ la?: THREE.Vector3; lb?: THREE.Vector3 }

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
    rings.push({ chains, levels, closed: S.closed, stiff: S.stiff, drag: S.drag, side, cape: set === 'cape' });
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
  // A cloak's chains are also kept outside what is worn under it: two upright
  // capsules side by side from the hips to the chest (in plan a stadium, like
  // the trunk, wider than deep), sized from the
  // tunic, robe and belt actually beneath (the gathered blouse over the belt,
  // the flare of the skirt), plus the cloak's own thickness. The fixed trunk
  // capsule above is round and 13 cm: a belted tunic stands out further, and
  // the cloak's front edges swung in through it in the walk.
  const capeCaps = rings.some((R) => R.cape) ? underCloak(body, B) : [];
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
    for (const c of capeCaps) { c.pa.copy(c.la!).applyMatrix4(c.a.matrixWorld); c.pb.copy(c.lb!).applyMatrix4(c.b.matrixWorld); }
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
          if (R.cape) for (const c of capeCaps) pushOut(L.p, c, c.r * s);
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

/**
 * The capsules a cloak's chains are kept outside of (see makeSprings), in the
 * bind pose: ends as points in the bones' own frames, radii from the vertices
 * of the tunic-, robe- and belt-layer garments' trunk (not sleeves) that lie
 * along each (their 90th percentile distance), plus 1 cm.
 */
function underCloak(body: THREE.Object3D, B: (n: string) => THREE.Bone) {
  const pts: THREE.Vector3[] = [];
  let skel: THREE.Skeleton | null = null;
  body.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || m.userData.npc2 !== 'garment' || !m.visible) return;
    skel ??= m.skeleton;
    const id = m.userData.garment as string;
    if (!/^(shirt|tunic|longrobe|robe|belt|belt_tunic|belt_robe|cord_tunic|cord_robe|sash_robe|rope)$/.test(id)) return;
    const P = m.geometry.attributes.position, used = m.geometry.index ? new Set(m.geometry.index.array as unknown as number[]) : null;
    const J = m.geometry.attributes.skinIndex, W = m.geometry.attributes.skinWeight;
    for (let i = 0; i < P.count; i++) {
      if (used && !used.has(i)) continue;
      // The trunk's cloth only (not the sleeves).
      let best = 0, w = -1;
      for (let k = 0; k < 4; k++) if (W.getComponent(i, k) > w) { w = W.getComponent(i, k); best = J.getComponent(i, k); }
      if (/Arm|Hand|Shoulder|Neck|Head/.test(m.skeleton.bones[best]?.name ?? '')) continue;
      pts.push(new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(m.bindMatrix));
    }
  });
  if (!skel || !pts.length) return [];
  const sk = skel as THREE.Skeleton;
  const bindAt = (b: THREE.Bone) => new THREE.Vector3().setFromMatrixPosition(sk.boneInverses[sk.bones.indexOf(b)].clone().invert());
  const local = (b: THREE.Bone, p: THREE.Vector3) => p.clone().applyMatrix4(sk.boneInverses[sk.bones.indexOf(b)]);
  const ab = new THREE.Vector3(), q = new THREE.Vector3();
  const make = (a: THREE.Bone, b: THREE.Bone, pa: THREE.Vector3, pb: THREE.Vector3): Cap | null => {
    ab.subVectors(pb, pa);
    const ds: number[] = [];
    for (const p of pts) {
      const t = q.subVectors(p, pa).dot(ab) / ab.lengthSq();
      if (t <= 0 || t >= 1) continue;
      const d = p.distanceTo(q.copy(pa).addScaledVector(ab, t));
      if (d < 0.25) ds.push(d);
    }
    if (ds.length < 20) return null;
    ds.sort((x, y) => x - y);
    return { a, b, r: ds[Math.floor(ds.length * 0.9)] + 0.01, pa: new THREE.Vector3(), pb: new THREE.Vector3(), la: local(a, pa), lb: local(b, pb) };
  };
  const hips = B('Hips'), chest = B('Spine2');
  const h = bindAt(hips), c = bindAt(chest);
  const out: (Cap | null)[] = [];
  for (const x of [-0.07, 0.07]) out.push(make(hips, chest, h.clone().add(new THREE.Vector3(x, 0, 0)), c.clone().add(new THREE.Vector3(x, 0, 0))));
  return out.filter((x): x is Cap => !!x);
}

function pushOut(p: THREE.Vector3, c: Cap, r: number) {
  _ab.copy(c.pb).sub(c.pa);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-9 ? THREE.MathUtils.clamp(_ap.copy(p).sub(c.pa).dot(_ab) / l2, 0, 1) : 0;
  _ap.copy(c.pa).addScaledVector(_ab, t);
  const d = p.distanceTo(_ap);
  if (d < r && d > 1e-6) p.sub(_ap).multiplyScalar(r / d).add(_ap);
}
