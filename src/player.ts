import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const RADIUS = 0.35;
const EYE = 1.65;
const GRAVITY = 22;

// First-person capsule controller against a static BVH collider.
export class Player {
  pos: THREE.Vector3;
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  keys = new Set<string>();
  bob = 0;
  stepPhase = 0;
  onStep?: (run: boolean) => void;
  private bvh: MeshBVH;
  private seg = new THREE.Line3();
  private box = new THREE.Box3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(collider: THREE.Mesh, spawn: THREE.Vector3, private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.bvh = new MeshBVH(collider.geometry);
    this.pos = spawn.clone();
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    const look = (dx: number, dy: number) => {
      this.yaw -= dx * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.45, 1.45);
    };
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom || (e.buttons & 1)) look(e.movementX, e.movementY);
    });
    // Touch: drag to look, hold two fingers to walk.
    let last: Touch | null = null;
    dom.addEventListener('touchstart', (e) => { last = e.touches[0]; if (e.touches.length > 1) this.keys.add('KeyW'); }, { passive: true });
    dom.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (last) look((t.clientX - last.clientX) * 2, (t.clientY - last.clientY) * 2);
      last = t;
    }, { passive: true });
    dom.addEventListener('touchend', (e) => { if (e.touches.length < 2) this.keys.delete('KeyW'); last = null; });
  }

  update(dt: number) {
    const k = this.keys;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = run ? 6.0 : 2.9;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const accel = this.onGround ? 12 : 2;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && k.has('Space')) { this.vel.y = 5.5; this.onGround = false; }

    const steps = 5;
    for (let i = 0; i < steps; i++) this.substep(dt / steps);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      const prev = Math.sin(this.stepPhase);
      this.stepPhase += dt * hs * 2.1;
      if (prev > 0 && Math.sin(this.stepPhase) <= 0 || prev < 0 && Math.sin(this.stepPhase) >= 0) this.onStep?.(run);
    }
    this.bob += (Math.min(hs, 6) / 6 - this.bob) * Math.min(1, dt * 6);
    if (this.pos.y < -40) { this.pos.set(0, 2, 112); this.vel.set(0, 0, 0); }

    this.camera.position.copy(this.pos);
    this.camera.position.y += Math.abs(Math.sin(this.stepPhase)) * 0.06 * this.bob - 0.03 * this.bob;
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.stepPhase) * 0.004 * this.bob, 'YXZ');
  }

  private substep(dt: number) {
    this.vel.y -= GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);
    // Capsule from feet+r to head.
    this.seg.start.set(this.pos.x, this.pos.y - EYE + RADIUS, this.pos.z);
    this.seg.end.set(this.pos.x, this.pos.y + 0.1 - RADIUS, this.pos.z);
    const before = this.seg.start.clone();
    this.box.makeEmpty();
    this.box.expandByPoint(this.seg.start).expandByPoint(this.seg.end);
    this.box.min.addScalar(-RADIUS);
    this.box.max.addScalar(RADIUS);
    this.bvh.shapecast({
      intersectsBounds: (bx) => bx.intersectsBox(this.box),
      intersectsTriangle: (tri) => {
        const d = tri.closestPointToSegment(this.seg, this.a, this.b);
        if (d < RADIUS) {
          const dir = this.b.sub(this.a).normalize();
          const depth = RADIUS - d;
          this.seg.start.addScaledVector(dir, depth);
          this.seg.end.addScaledVector(dir, depth);
        }
      },
    });
    const delta = this.seg.start.clone().sub(before);
    this.onGround = delta.y > Math.abs(dt * this.vel.y * 0.25);
    const off = Math.max(0, delta.length() - 1e-5);
    delta.normalize().multiplyScalar(off);
    this.pos.add(delta);
    if (this.onGround) this.vel.y = 0;
    else if (delta.lengthSq() > 0) {
      const n = delta.clone().normalize();
      this.vel.addScaledVector(n, -n.dot(this.vel));
    }
  }
}
