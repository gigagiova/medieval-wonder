// On-screen thumbstick (bottom-right) plus drag-to-look anywhere else on
// the screen. Pointer Events, so the same code serves touch and mouse, and
// several fingers at once (one moving, one looking).

const RADIUS = 52; // px the knob may travel from the centre
const DEADZONE = 0.12;
const RUN_AT = 0.9;

export class Joystick {
  /** Analog move vector: x = strafe right, y = forward. Length <= 1. */
  x = 0;
  y = 0;
  run = false;
  /** True while a pointer is holding the stick. */
  active = false;
  /** Look deltas in px accumulated since the last take(). */
  private lookX = 0;
  private lookY = 0;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private lastLook = { x: 0, y: 0 };
  private base: HTMLElement;
  private knob: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.base = document.getElementById('joy')!;
    this.knob = document.getElementById('joy-knob')!;

    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    const markTouch = (e: PointerEvent) => { if (e.pointerType === 'touch') document.body.classList.add('touch'); };
    addEventListener('pointerdown', markTouch, { capture: true });
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('locked', !!document.pointerLockElement);
    });

    this.base.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      this.stickId = e.pointerId;
      this.active = true;
      this.base.setPointerCapture(e.pointerId);
      this.base.classList.add('held');
      this.moveStick(e);
    });
    this.base.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.moveStick(e); });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.active = false;
      this.x = this.y = 0;
      this.run = false;
      this.base.classList.remove('held');
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    this.base.addEventListener('pointerup', release);
    this.base.addEventListener('pointercancel', release);
    this.base.addEventListener('lostpointercapture', release);

    // Touch look: any finger that lands on the canvas. The stick and the
    // buttons are separate elements, so their touches never reach it.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.lastLook = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.lookX += e.clientX - this.lastLook.x;
      this.lookY += e.clientY - this.lastLook.y;
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = null; };
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', endLook);
  }

  private moveStick(e: PointerEvent) {
    const r = this.base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const v = stickToVector(dx / RADIUS, -dy / RADIUS, DEADZONE);
    this.x = v.x;
    this.y = v.y;
    this.run = v.m >= RUN_AT;
  }

  /** Returns and clears the touch-look deltas (px). */
  takeLook() {
    const d = { x: this.lookX, y: this.lookY };
    this.lookX = this.lookY = 0;
    return d;
  }
}

/** Radial deadzone, rescaled so output magnitude runs 0..1 past the deadzone. */
export function stickToVector(x: number, y: number, dz: number) {
  const len = Math.hypot(x, y);
  const m = Math.min(1, len);
  if (m <= dz) return { x: 0, y: 0, m: 0 };
  const s = (m - dz) / (1 - dz);
  return { x: (x / len) * s, y: (y / len) * s, m: s };
}

/** Gamepad look axis: deadzone, then a quadratic curve for fine aiming. */
export function lookCurve(a: number, dz = 0.15) {
  const m = Math.abs(a);
  if (m <= dz) return 0;
  const s = (m - dz) / (1 - dz);
  return Math.sign(a) * s * s;
}

// Standard-mapping gamepad: left stick move, right stick look, triggers or
// L3 run, A jump, X/Y lantern (sent as an F key press so main.ts handles it).
export class Pad {
  x = 0;
  y = 0;
  lookX = 0;
  lookY = 0;
  run = false;
  jump = false;
  private prev: boolean[] = [];

  poll() {
    this.x = this.y = this.lookX = this.lookY = 0;
    this.run = this.jump = false;
    const pads = navigator.getGamepads?.() ?? [];
    const gp = Array.from(pads).find((p) => p && p.connected);
    if (!gp) return;
    const ax = (i: number) => gp.axes[i] ?? 0;
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const val = (i: number) => gp.buttons[i]?.value ?? 0;
    const v = stickToVector(ax(0), -ax(1), 0.15);
    this.x = v.x;
    this.y = v.y;
    this.lookX = lookCurve(ax(2));
    this.lookY = lookCurve(ax(3));
    this.run = val(6) > 0.3 || val(7) > 0.3 || btn(10);
    const pressed = (i: number) => btn(i) && !this.prev[i];
    this.jump = pressed(0);
    if (pressed(2) || pressed(3)) dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    this.prev = gp.buttons.map((b) => b.pressed);
  }
}
