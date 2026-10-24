// Fully procedural soundscape: wind, a distant chant drone, a bell, footsteps,
// and an echo send that opens up underground.
export class Soundscape {
  ctx = new AudioContext();
  private master = this.ctx.createGain();
  private wind = this.ctx.createGain();
  private chant = this.ctx.createGain();
  private wet = this.ctx.createGain();
  private dry = this.ctx.createBiquadFilter();
  private noise: AudioBuffer;
  private nextBell = 6;

  constructor() {
    const c = this.ctx;
    this.master.gain.value = 0.8;
    this.dry.type = 'lowpass';
    this.dry.frequency.value = 18000;
    this.dry.connect(this.master);
    this.master.connect(c.destination);
    // Echo send.
    const delay = c.createDelay(2);
    delay.delayTime.value = 0.23;
    const fb = c.createGain();
    fb.gain.value = 0.55;
    const lp = c.createBiquadFilter();
    lp.frequency.value = 1500;
    this.wet.gain.value = 0;
    this.wet.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(this.master);

    this.noise = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.98 * b + 0.02 * (Math.random() * 2 - 1); d[i] = b * 6; }

    // Wind: brown noise through a wandering band-pass.
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.7;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 250;
    lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start();
    src.connect(bp); bp.connect(this.wind); this.wind.connect(this.dry);
    this.wind.gain.value = 0.35;
    src.start();

    // Chant: an open fifth with slow vowel-like formant sweeps.
    const form = c.createBiquadFilter();
    form.type = 'bandpass'; form.frequency.value = 700; form.Q.value = 3;
    const fl = c.createOscillator(); fl.frequency.value = 0.11;
    const flg = c.createGain(); flg.gain.value = 300;
    fl.connect(flg); flg.connect(form.frequency); fl.start();
    for (const [f, g] of [[98, 0.5], [147, 0.35], [196, 0.25], [98.6, 0.3]]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = g;
      o.connect(og); og.connect(form); o.start();
    }
    form.connect(this.chant);
    this.chant.gain.value = 0;
    this.chant.connect(this.dry);
    this.chant.connect(this.wet);
  }

  bell(gain: number) {
    const c = this.ctx, t = c.currentTime;
    for (const [r, a, dec] of [[1, 0.5, 7], [2.0, 0.25, 4], [2.4, 0.2, 3], [3.0, 0.12, 2.5], [4.2, 0.08, 1.6], [0.5, 0.3, 9]]) {
      const o = c.createOscillator(); o.frequency.value = 220 * r;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(this.dry); g.connect(this.wet);
      o.start(t); o.stop(t + dec);
    }
  }

  step(run: boolean, under: boolean) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = under ? 900 : 600 + Math.random() * 300;
    const g = c.createGain();
    const v = (run ? 0.5 : 0.3) * (0.8 + Math.random() * 0.4);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(this.dry); g.connect(this.wet);
    s.start(t, Math.random() * 3, 0.15);
  }

  update(dt: number, under: number, distChurch: number) {
    const k = Math.min(1, dt * 2);
    this.wind.gain.value += ((1 - under) * 0.35 + under * 0.05 - this.wind.gain.value) * k;
    const chant = 0.012 + 0.05 * Math.max(0, 1 - distChurch / 45);
    this.chant.gain.value += (chant * (1 - under * 0.6) - this.chant.gain.value) * k;
    this.wet.gain.value += (under * 0.6 - this.wet.gain.value) * k;
    this.dry.frequency.value += ((under ? 2500 : 18000) - this.dry.frequency.value) * k;
    this.nextBell -= dt;
    if (this.nextBell < 0) {
      this.nextBell = 45 + Math.random() * 30;
      let n = 0;
      const toll = () => { this.bell(0.12 * (1 - under * 0.7)); if (++n < 3) setTimeout(toll, 2600); };
      toll();
    }
  }
}
