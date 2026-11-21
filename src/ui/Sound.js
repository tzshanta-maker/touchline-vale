/**
 * Tiny procedural sound engine — every sound is synthesised with WebAudio,
 * so the game ships without any audio assets.
 */
export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this.crowdGain = null;
    this._started = false;
  }

  init() {
    if (this.ctx || typeof window === 'undefined') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.master.connect(this.ctx.destination);
    this._buildCrowd();
    this._started = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
    }
  }

  _noiseBuffer(seconds = 1.2) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildCrowd() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.crowdGain = gain;
    // slow amplitude wobble so the crowd breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
    this.crowdFilter = filter;
  }

  crowdExcitement(level) {
    if (!this.crowdGain) return;
    this.crowdGain.gain.setTargetAtTime(0.05 + level * 0.11, this.ctx.currentTime, 0.6);
    this.crowdFilter.frequency.setTargetAtTime(480 + level * 500, this.ctx.currentTime, 0.8);
  }

  _tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _burst(dur = 0.12, gain = 0.25, freq = 1400, q = 0.9) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(Math.max(0.2, dur));
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  kick(power = 0.7) {
    if (!this.enabled || !this.ctx) return;
    this._tone(160 + power * 60, 0.09, 'sine', 0.18 + power * 0.14, 60);
    this._burst(0.06 + power * 0.05, 0.12 + power * 0.12, 2200, 0.6);
  }

  thud() {
    if (!this.enabled || !this.ctx) return;
    this._tone(110, 0.14, 'sine', 0.2, 50);
    this._burst(0.1, 0.16, 700, 0.8);
  }

  save() {
    if (!this.enabled || !this.ctx) return;
    this._burst(0.16, 0.2, 1200, 0.7);
    this._tone(320, 0.12, 'triangle', 0.12, 180);
  }

  whistle(long = false) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = long ? 0.55 : 0.22;
    for (const f of [2100, 2650]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      lfo.frequency.value = 34;
      lfoG.gain.value = 90;
      lfo.connect(lfoG).connect(osc.frequency);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      lfo.start(t0);
      osc.stop(t0 + dur + 0.02);
      lfo.stop(t0 + dur + 0.02);
    }
  }

  goal() {
    if (!this.enabled || !this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => this._tone(n, 0.5, 'triangle', 0.16, null, i * 0.09));
    this.crowdExcitement(1);
    setTimeout(() => this.crowdExcitement(0.3), 2600);
  }

  pass() {
    if (!this.enabled || !this.ctx) return;
    this.kick(0.25);
  }

  uiClick() {
    if (!this.enabled || !this.ctx) return;
    this._tone(660, 0.06, 'square', 0.05);
  }
}
