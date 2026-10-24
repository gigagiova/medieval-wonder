import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Joystick, Pad } from './joystick';
import { Tilt } from './tilt';

const RADIUS = 0.35;
const EYE = 1.65;
const GRAVITY = 22;
const DEBUG = new URLSearchParams(location.search).has('debug');

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
  private joy: Joystick;
  private pad = new Pad();
  private tilt = new Tilt();
  /** Yaw added on top of the device heading while tilt-look is on (drag still turns you). */
  private tiltYaw = 0;
  private tiltWas = false;
  private seg = new THREE.Line3();
  private box = new THREE.Box3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(collider: THREE.Mesh, spawn: THREE.Vector3, private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.bvh = (collider.geometry as unknown as { boundsTree?: MeshBVH }).boundsTree ?? new MeshBVH(collider.geometry);
    this.pos = spawn.clone();
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.joy = new Joystick(dom);
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom) this.look(e.movementX, e.movementY);
      // Drag-to-look fallback where pointer lock is unavailable; not while steering the stick.
      else if ((e.buttons & 1) && !this.joy.active && e.target === dom) this.look(e.movementX, e.movementY);
    });
    dom.style.touchAction = 'none';
  }

  private look(dx: number, dy: number) {
    if (this.tilt.active) { this.tiltYaw -= dx * 0.0022; return; }
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.45, 1.45);
  }

  update(dt: number) {
    const k = this.keys;
    const pad = this.pad;
    pad.poll();
    // Look: touch drag (scaled up for small screens) and the right stick.
    const tl = this.joy.takeLook();
    if (tl.x || tl.y) this.look(tl.x * 1.6, tl.y * 1.6);
    this.yaw -= pad.lookX * 2.8 * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch - pad.lookY * 2.0 * dt, -1.45, 1.45);
    // Tilt-look: the phone's attitude drives the view. On enabling, re-centre
    // so the current heading maps to the current yaw.
    const t = this.tilt.read(dt);
    if (t) {
      if (!this.tiltWas) this.tiltYaw = this.yaw - t.yaw;
      this.tiltYaw -= pad.lookX * 2.8 * dt;
      this.yaw = t.yaw + this.tiltYaw;
      this.pitch = THREE.MathUtils.clamp(t.pitch, -1.45, 1.45);
    }
    this.tiltWas = !!t;

    // Move: keyboard + on-screen stick + gamepad, summed and clamped to 1.
    const run = k.has('ShiftLeft') || k.has('ShiftRight') || this.joy.run || pad.run;
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const kl = Math.hypot(f, s);
    if (kl > 1) { f /= kl; s /= kl; }
    f += this.joy.y + pad.y;
    s += this.joy.x + pad.x;
    const mag = Math.min(1, Math.hypot(f, s));
    const speed = mag * (run ? 6.0 : 2.9);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const accel = this.onGround ? 12 : 2;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && (k.has('Space') || pad.jump)) { this.vel.y = 5.5; this.onGround = false; }

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
    if (DEBUG) (window as unknown as { __player: Player }).__player = this;
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
