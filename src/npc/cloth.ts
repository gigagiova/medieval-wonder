import * as THREE from 'three';
import type { Garment } from './garment';

// A garment on one person. Far away it is an ordinary GPU-skinned mesh bound
// to the body's skeleton. Near the camera it becomes cloth: every frame it is
// skinned on the CPU to get its animated target shape, then free parts are
// simulated with position-based dynamics: distance, shear and bend
// constraints, a max-distance tether to the skinned target that grows
// towards the hem, gravity, inertia, and capsule collisions with the limbs.

export const clothStats = { skin: 0, sim: 0, normals: 0, frames: 0 };

const _kp = new THREE.Vector3(), _kt = new THREE.Vector3(), _sa = new THREE.Vector3(), _sd = new THREE.Vector3();

type Cap = { a: THREE.Bone; b: THREE.Bone; r: number; pa: THREE.Vector3; pb: THREE.Vector3 };

export class Clothing {
  far: THREE.SkinnedMesh;
  near: THREE.Mesh | null = null;
  rope: THREE.Mesh | null = null;
  private sim: ReturnType<Clothing['makeSim']> | null = null;
  private caps: Cap[];
  simulating = false;

  constructor(private scene: THREE.Scene, private G: Garment, private skeleton: THREE.Skeleton, private mats: THREE.Material[], private ropeMat: THREE.Material | null, private scale: number, bone: (n: string) => THREE.Bone) {
    // Bound with an identity bind matrix: the garment's bind positions are in
    // the same world-at-load space as the body's, and the skeleton's bone
    // matrices already carry the person's position, heading and size.
    // The bind pose, unskinned: fabric.ts lays the weave on it (also on the simulated mesh, below).
    G.geo.setAttribute('rest', G.geo.attributes.position); G.geo.setAttribute('restN', G.geo.attributes.normal);
    const far = new THREE.SkinnedMesh(G.geo, mats);
    far.bindMode = THREE.DetachedBindMode;
    far.bind(skeleton, new THREE.Matrix4());
    far.frustumCulled = false;
    scene.add(far);
    this.far = far;
    const s = scale;
    this.caps = ([
      ['LeftUpLeg', 'LeftLeg', 0.085], ['RightUpLeg', 'RightLeg', 0.085],
      ['LeftLeg', 'LeftFoot', 0.065], ['RightLeg', 'RightFoot', 0.065],
      ['LeftFoot', 'LeftToeBase', 0.085], ['RightFoot', 'RightToeBase', 0.085],
      ['LeftUpLeg', 'RightUpLeg', 0.12], ['Spine', 'Spine2', 0.14],
      ['LeftArm', 'LeftForeArm', 0.06], ['RightArm', 'RightForeArm', 0.06],
      ['LeftForeArm', 'LeftHand', 0.05], ['RightForeArm', 'RightHand', 0.05],
    ] as [string, string, number][]).map(([a, b, r]) => ({ a: bone(a), b: bone(b), r: r * s, pa: new THREE.Vector3(), pb: new THREE.Vector3() }));
  }

  set visible(v: boolean) {
    this.far.visible = v && !this.simulating;
    if (this.near) this.near.visible = v && this.simulating;
    if (this.rope) this.rope.visible = v && this.simulating;
  }

  /** Switch between cloth (near) and plain skinning (far). */
  setSimulating(on: boolean) {
    if (on === this.simulating) return;
    this.simulating = on;
    if (on && !this.sim) this.sim = this.makeSim();
    if (on) this.sim!.first = true;
    this.far.visible = !on;
    this.near!.visible = on;
    if (this.rope) this.rope.visible = on;
  }

  dispose() {
    this.scene.remove(this.far);
    if (this.near) this.scene.remove(this.near);
    if (this.rope) this.scene.remove(this.rope);
  }

  private makeSim() {
    const G = this.G;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(G.bind.length), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(G.bind.length), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', G.geo.attributes.uv);
    geo.setAttribute('color', G.geo.attributes.color);
    geo.setAttribute('rest', G.geo.attributes.rest); geo.setAttribute('restN', G.geo.attributes.restN);
    geo.setIndex(G.geo.index);
    for (const g of G.geo.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    const near = new THREE.Mesh(geo, this.mats);
    near.frustumCulled = false;
    this.scene.add(near);
    this.near = near;
    const N = G.bind.length / 3;
    const invM = new Float32Array(N);
    for (let i = 0; i < N; i++) invM[i] = G.maxD[i] > 0 ? 1 : 0;
    const idx = Array.from({ length: N }, (_, i) => i);
    const R = G.rope;
    let rope: { P: Float32Array; Q: Float32Array; geo: THREE.BufferGeometry } | null = null;
    if (R && this.ropeMat) {
      const RS = 6;
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(R.n * RS * 3), 3));
      rg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(R.n * RS * 3), 3));
      const rix: number[] = [];
      for (let i = 0; i < R.n - 1; i++) for (let s = 0; s < RS; s++) {
        const a = i * RS + s, b = i * RS + ((s + 1) % RS), c = a + RS, d = b + RS;
        rix.push(a, c, b, b, c, d);
      }
      rg.setIndex(rix);
      this.rope = new THREE.Mesh(rg, this.ropeMat);
      this.rope.frustumCulled = false;
      this.scene.add(this.rope);
      rope = { P: new Float32Array(R.n * 3), Q: new Float32Array(R.n * 3), geo: rg };
    }
    return {
      geo, N, invM,
      P: new Float32Array(N * 3), Q: new Float32Array(N * 3), T: new Float32Array(N * 3),
      rest: G.rest.map((r) => r * this.scale),
      free: Uint32Array.from(idx.filter((i) => invM[i] > 0)),
      pinned: Uint32Array.from(idx.filter((i) => invM[i] === 0)),
      rope, first: true, lastRoot: new THREE.Vector3(),
      riders: G.ride ? Uint32Array.from(idx.filter((i) => G.ride![i] >= 0)) : null,
      // The cloth a hanging cord lies on: whatever is near its line, below the knot.
      under: R ? Uint32Array.from(idx.filter((i) => {
        const k = R.root * 3, b = G.bind;
        return i !== R.root && Math.abs(b[i * 3] - b[k]) < 0.22 && Math.abs(b[i * 3 + 2] - b[k + 2]) < 0.3 && b[i * 3 + 1] < b[k + 1] - 0.02 && b[i * 3 + 1] > b[k + 1] - R.n * R.seg - 0.15;
      })) : null,
    };
  }

  /** Simulate one frame. The skeleton's world matrices must be current. */
  update(dt: number, root: THREE.Vector3) {
    if (!this.simulating || !this.sim) return;
    const S = this.sim, G = this.G, { P, Q, T, N } = S;
    dt = Math.min(dt, 1 / 20);
    const t0 = performance.now();
    this.skeleton.update();
    const M = this.skeleton.boneMatrices!;
    {
      const I = G.skinI, W = G.skinW, Bp = G.bind;
      for (let i = 0; i < N; i++) {
        const x = Bp[i * 3], y = Bp[i * 3 + 1], z = Bp[i * 3 + 2];
        let ox = 0, oy = 0, oz = 0;
        for (let k = 0; k < 4; k++) {
          const w = W[i * 4 + k];
          if (w === 0) continue;
          const o = I[i * 4 + k] * 16;
          ox += w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
          oy += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
          oz += w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
        }
        T[i * 3] = ox; T[i * 3 + 1] = oy; T[i * 3 + 2] = oz;
      }
    }
    const t1 = performance.now();
    const R = G.rope, rp = S.rope;
    if (S.first || S.lastRoot.distanceToSquared(root) > 1) {
      P.set(T); Q.set(T);
      if (R && rp) {
        const k = R.root;
        for (let j = 0; j < R.n; j++) { rp.P[j * 3] = T[k * 3]; rp.P[j * 3 + 1] = T[k * 3 + 1] - j * R.seg; rp.P[j * 3 + 2] = T[k * 3 + 2]; }
        rp.Q.set(rp.P);
      }
      S.first = false;
    }
    S.lastRoot.copy(root);
    const caps = this.caps;
    for (const c of caps) { c.a.getWorldPosition(c.pa); c.b.getWorldPosition(c.pb); }
    // The foot bone sits at the ankle: carry its capsule back to the heel and
    // down the shin's line to the sole, which otherwise kick up through a long
    // skirt's hem.
    for (const ci of [4, 5]) {
      const c = caps[ci], sh = caps[ci - 2];
      _sd.copy(sh.pb).sub(sh.pa).normalize().multiplyScalar(0.04 * this.scale);
      c.pa.lerp(c.pb, -0.45).add(_sd);
      c.pb.addScaledVector(_sd, 0.5).lerp(c.pa, -0.12);
    }
    const ground = root.y + 0.012;
    const collide = (arr: Float32Array, i: number, mask: number) => {
      let x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
      for (let ci = 0; ci < caps.length; ci++) {
        if (!(mask & (1 << ci))) continue;
        const c = caps[ci];
        const ax = c.pa.x, ay = c.pa.y, az = c.pa.z;
        const dx = c.pb.x - ax, dy = c.pb.y - ay, dz = c.pb.z - az;
        const L2 = dx * dx + dy * dy + dz * dz || 1;
        let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x - (ax + dx * t), qy = y - (ay + dy * t), qz = z - (az + dz * t);
        const d2 = qx * qx + qy * qy + qz * qz;
        const r = c.r + 0.012;
        if (d2 < r * r && d2 > 1e-10) {
          const s = r / Math.sqrt(d2);
          x = ax + dx * t + qx * s; y = ay + dy * t + qy * s; z = az + dz * t + qz * s;
        }
      }
      if (y < ground) y = ground;
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    };

    // A cloak hangs round the body: pulled taut it would cut straight through
    // the tunic to the spine. Keep it no nearer the spine's line than its skinned place.
    const sa = _sa.copy(caps[6].pa).lerp(caps[6].pb, 0.5), sd = _sd.copy(caps[7].pb).sub(sa).normalize();
    const slack = 0.012 * this.scale;
    const radial = (arr: Float32Array, o: number, out: THREE.Vector3) => {
      out.set(arr[o] - sa.x, arr[o + 1] - sa.y, arr[o + 2] - sa.z);
      return out.addScaledVector(sd, -out.dot(sd));
    };
    const kp = _kp, kt = _kt;
    const keepOut = (i: number) => {
      const o = i * 3;
      const dp = radial(P, o, kp).length(), dt2 = radial(T, o, kt).length() - slack;
      if (dp >= dt2 || dp < 1e-6) return;
      kp.multiplyScalar(dt2 / dp - 1);
      P[o] += kp.x; P[o + 1] += kp.y; P[o + 2] += kp.z;
    };
    // A cord lies on the skirt: kept outside the nearest cloth vertex's surface (last frame's normals).
    const NR = S.geo.attributes.normal.array as Float32Array, margin = 0.012 * this.scale;
    const outOf = (arr: Float32Array, prev: Float32Array, j: number) => {
      const U = S.under!, o = j * 3;
      let best = -1, bd = Infinity;
      for (let k = 0; k < U.length; k++) {
        const q = U[k] * 3, d = (P[q] - arr[o]) ** 2 + (P[q + 1] - arr[o + 1]) ** 2 + (P[q + 2] - arr[o + 2]) ** 2;
        if (d < bd) { bd = d; best = q; }
      }
      if (best < 0 || bd > 0.04) return;
      const s = (arr[o] - P[best]) * NR[best] + (arr[o + 1] - P[best + 1]) * NR[best + 1] + (arr[o + 2] - P[best + 2]) * NR[best + 2];
      // (Carried along, not flung: the push is no new speed.)
      if (s < margin) { const k = margin - s; for (let a = 0; a < 3; a++) { arr[o + a] += NR[best + a] * k; prev[o + a] += NR[best + a] * k; } }
    };
    const Ko = G.keepOut;
    const SUB = 2, h = dt / SUB, g = -9.8 * h * h;
    const D = G.maxD, Ed = G.edges, Rl = S.rest, St = G.stiff, ne = Rl.length, Cm = G.capMask, invM = S.invM, sc = this.scale;
    const { free, pinned } = S;
    for (let k = 0; k < pinned.length; k++) {
      const o = pinned[k] * 3;
      P[o] = Q[o] = T[o]; P[o + 1] = Q[o + 1] = T[o + 1]; P[o + 2] = Q[o + 2] = T[o + 2];
    }
    for (let s = 0; s < SUB; s++) {
      for (let k = 0; k < free.length; k++) {
        const o = free[k] * 3;
        const vx = (P[o] - Q[o]) * 0.985, vy = (P[o + 1] - Q[o + 1]) * 0.985, vz = (P[o + 2] - Q[o + 2]) * 0.985;
        Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
        P[o] += vx; P[o + 1] += vy + g; P[o + 2] += vz;
      }
      for (let e = 0; e < ne; e++) {
        const a = Ed[e * 2], b = Ed[e * 2 + 1];
        const wa = invM[a], wb = invM[b], w = wa + wb;
        if (w === 0) continue;
        const ax = a * 3, bx = b * 3;
        const dx = P[bx] - P[ax], dy = P[bx + 1] - P[ax + 1], dz = P[bx + 2] - P[ax + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const c = ((len - Rl[e]) / len) * St[e] / w;
        P[ax] += dx * c * wa; P[ax + 1] += dy * c * wa; P[ax + 2] += dz * c * wa;
        P[bx] -= dx * c * wb; P[bx + 1] -= dy * c * wb; P[bx + 2] -= dz * c * wb;
      }
      for (let k = 0; k < free.length; k++) {
        const i = free[k], o = i * 3;
        const dx = P[o] - T[o], dy = P[o + 1] - T[o + 1], dz = P[o + 2] - T[o + 2];
        const d2 = dx * dx + dy * dy + dz * dz, md = D[i] * sc;
        if (d2 > md * md) { const q = md / Math.sqrt(d2); P[o] = T[o] + dx * q; P[o + 1] = T[o + 1] + dy * q; P[o + 2] = T[o + 2] + dz * q; }
        if (Ko[i]) keepOut(i);
        collide(P, i, Cm[i]);
      }
      if (R && rp) {
        const k = R.root, rP = rp.P, rQ = rp.Q;
        rP[0] = T[k * 3]; rP[1] = T[k * 3 + 1]; rP[2] = T[k * 3 + 2];
        for (let j = 1; j < R.n; j++) {
          const o = j * 3;
          const vx = (rP[o] - rQ[o]) * 0.94, vy = (rP[o + 1] - rQ[o + 1]) * 0.94, vz = (rP[o + 2] - rQ[o + 2]) * 0.94;
          rQ[o] = rP[o]; rQ[o + 1] = rP[o + 1]; rQ[o + 2] = rP[o + 2];
          rP[o] += vx; rP[o + 1] += vy + g; rP[o + 2] += vz;
        }
        for (let it = 0; it < 3; it++) for (let j = 1; j < R.n; j++) {
          const a = (j - 1) * 3, b = j * 3;
          const dx = rP[b] - rP[a], dy = rP[b + 1] - rP[a + 1], dz = rP[b + 2] - rP[a + 2];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const c = (len - R.seg * sc) / len;
          if (j === 1) { rP[b] -= dx * c; rP[b + 1] -= dy * c; rP[b + 2] -= dz * c; }
          else { rP[a] += dx * c * 0.5; rP[a + 1] += dy * c * 0.5; rP[a + 2] += dz * c * 0.5; rP[b] -= dx * c * 0.5; rP[b + 1] -= dy * c * 0.5; rP[b + 2] -= dz * c * 0.5; }
          collide(rP, j, 0b01111111);
          if (S.under) outOf(rP, rQ, j);
        }
      }
    }
    // Layers over layers (a scapular on the tunic) keep their place on the cloth beneath.
    if (S.riders) {
      const Rd = G.ride!;
      for (let k = 0; k < S.riders.length; k++) {
        const o = S.riders[k] * 3, q = Rd[S.riders[k]] * 3;
        P[o] = P[q] + T[o] - T[q]; P[o + 1] = P[q + 1] + T[o + 1] - T[q + 1]; P[o + 2] = P[q + 2] + T[o + 2] - T[q + 2];
      }
    }
    const t2 = performance.now();
    const posAttr = S.geo.attributes.position as THREE.BufferAttribute;
    (posAttr.array as Float32Array).set(P);
    posAttr.needsUpdate = true;
    // Area-weighted vertex normals with typed arrays (three's version allocates).
    const IX = S.geo.index!.array, NRM = S.geo.attributes.normal.array as Float32Array;
    NRM.fill(0);
    for (let t = 0; t < IX.length; t += 3) {
      const a = IX[t] * 3, b = IX[t + 1] * 3, c = IX[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      NRM[a] += nx; NRM[a + 1] += ny; NRM[a + 2] += nz;
      NRM[b] += nx; NRM[b + 1] += ny; NRM[b + 2] += nz;
      NRM[c] += nx; NRM[c + 1] += ny; NRM[c + 2] += nz;
    }
    for (let i = 0; i < NRM.length; i += 3) {
      const l = Math.hypot(NRM[i], NRM[i + 1], NRM[i + 2]) || 1;
      NRM[i] /= l; NRM[i + 1] /= l; NRM[i + 2] /= l;
    }
    S.geo.attributes.normal.needsUpdate = true;
    if (R && rp) {
      const rP = rp.P, RS = 6;
      const pa = rp.geo.attributes.position.array as Float32Array, na = rp.geo.attributes.normal.array as Float32Array;
      const upv = new THREE.Vector3(), side = new THREE.Vector3(), dirv = new THREE.Vector3();
      for (let j = 0; j < R.n; j++) {
        const a = Math.max(0, j - 1), b = Math.min(R.n - 1, j + 1);
        dirv.set(rP[b * 3] - rP[a * 3], rP[b * 3 + 1] - rP[a * 3 + 1], rP[b * 3 + 2] - rP[a * 3 + 2]).normalize();
        side.set(1, 0, 0).cross(dirv);
        if (side.lengthSq() < 1e-4) side.set(0, 0, 1).cross(dirv);
        side.normalize();
        upv.crossVectors(dirv, side);
        const r = 0.011 * sc * (j === R.n - 1 ? 1.6 : 1);
        for (let s = 0; s < RS; s++) {
          const a2 = (s / RS) * Math.PI * 2, cx = Math.cos(a2), sx = Math.sin(a2);
          const o = (j * RS + s) * 3;
          const nx = side.x * cx + upv.x * sx, ny = side.y * cx + upv.y * sx, nz = side.z * cx + upv.z * sx;
          pa[o] = rP[j * 3] + nx * r; pa[o + 1] = rP[j * 3 + 1] + ny * r; pa[o + 2] = rP[j * 3 + 2] + nz * r;
          na[o] = nx; na[o + 1] = ny; na[o + 2] = nz;
        }
      }
      rp.geo.attributes.position.needsUpdate = true;
      rp.geo.attributes.normal.needsUpdate = true;
    }
    const t3 = performance.now();
    clothStats.skin += t1 - t0; clothStats.sim += t2 - t1; clothStats.normals += t3 - t2; clothStats.frames++;
  }
}
