import * as THREE from 'three';

// Look by tilting the phone: the device's attitude becomes the camera's, as if
// the screen were a window you hold up and turn with your body. Same maths as
// the old three.js DeviceOrientationControls, low-pass filtered, and
// re-centred so enabling it never snaps the view.

const ZEE = new THREE.Vector3(0, 0, 1);
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // camera looks out the back of the device, not the top
const DEG = Math.PI / 180;

type PermissionFn = () => Promise<'granted' | 'denied'>;
const needsPermission = () =>
  typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn } | undefined)?.requestPermission === 'function';

export class Tilt {
  active = false;
  /** Set once the sensor has been shown not to work here (denied, absent, or a sandbox that never fires). */
  unavailable = false;
  private raw = new THREE.Quaternion();
  private smooth = new THREE.Quaternion();
  private have = false;
  private fresh = false;
  private euler = new THREE.Euler();
  private q0 = new THREE.Quaternion();
  private orient = 0;
  private btn: HTMLElement | null;
  private watchdog = 0;

  constructor() {
    this.btn = document.getElementById('tilt');
    this.readOrient();
    screen.orientation?.addEventListener?.('change', () => this.readOrient());
    addEventListener('orientationchange', () => this.readOrient());
    addEventListener('deviceorientation', (e) => this.onEvent(e));
    this.btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.unavailable) return;
      if (this.active) this.disable();
      else void this.enable();
    });
    // On phones, switch it on as the player taps Enter: that tap is the user
    // gesture iOS (and recent Chrome) require before asking for motion access.
    document.getElementById('overlay')?.addEventListener('click', () => {
      if (matchMedia('(pointer: coarse)').matches && !this.active && !this.unavailable) void this.enable();
    });
    this.render();
  }

  private readOrient() {
    const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    this.orient = (+a || 0) * DEG;
  }

  private onEvent(e: DeviceOrientationEvent) {
    if (e.beta === null && e.gamma === null) return;
    const alpha = (e.alpha ?? 0) * DEG, beta = (e.beta ?? 0) * DEG, gamma = (e.gamma ?? 0) * DEG;
    this.euler.set(beta, alpha, -gamma, 'YXZ');
    this.raw.setFromEuler(this.euler);
    this.raw.multiply(Q1);
    this.raw.multiply(this.q0.setFromAxisAngle(ZEE, -this.orient));
    if (!this.have) this.smooth.copy(this.raw);
    this.have = true;
    this.fresh = true;
  }

  async enable() {
    if (needsPermission()) {
      try {
        const r = await (window.DeviceOrientationEvent as unknown as { requestPermission: PermissionFn }).requestPermission();
        if (r !== 'granted') return this.fail('Motion access was declined. Allow it in the browser settings to look by tilting.');
      } catch {
        return this.fail('Motion sensors are not available here.');
      }
    }
    this.active = true;
    this.have = false;
    this.render();
    // Sandboxed frames and desktops simply never fire the event.
    clearTimeout(this.watchdog);
    this.watchdog = window.setTimeout(() => {
      if (this.active && !this.have) this.fail('No motion sensor reached this page (some embedded views block it).');
    }, 2000);
  }

  disable() {
    this.active = false;
    this.render();
  }

  private fail(msg: string) {
    this.active = false;
    this.unavailable = true;
    if (this.btn) this.btn.title = msg;
    this.render();
  }

  private render() {
    if (!this.btn) return;
    this.btn.classList.toggle('on', this.active);
    this.btn.classList.toggle('off', this.unavailable);
    this.btn.setAttribute('aria-pressed', String(this.active));
    if (!this.unavailable) this.btn.title = this.active ? 'Tilt to look: on' : 'Tilt to look';
  }

  /** Smoothed device yaw/pitch (radians), or null when there is nothing to read yet. */
  read(dt: number): { yaw: number; pitch: number } | null {
    if (!this.active || !this.have) return null;
    if (this.fresh) {
      // Low-pass: ~60 ms time constant, enough to hide sensor jitter without feeling laggy.
      this.smooth.slerp(this.raw, 1 - Math.exp(-dt / 0.06));
    }
    this.euler.setFromQuaternion(this.smooth, 'YXZ');
    return { yaw: this.euler.y, pitch: this.euler.x };
  }
}
