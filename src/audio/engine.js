// Web Audio instruments + sfx for Do-Re-Mi Meadow. All sound is synthesised;
// no assets. The audio clock (ctx.currentTime) is the only clock.
//
// Graph:  voice -> instrument input (trim + reverb send) -> master -> limiter -> out
//                                                    \-> convolver -> wet -> master

const EPS = 0.005; // "play now" lead time, seconds

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Per-instrument trim and reverb send.
const BUSES = {
  voice: { trim: 0.62, send: 0.3 },
  kids: { trim: 0.6, send: 0.3 },
  guitar: { trim: 0.55, send: 0.18 },
  bass: { trim: 0.55, send: 0.05 },
  bell: { trim: 0.45, send: 0.35 },
  flute: { trim: 0.6, send: 0.35 },
  sfx: { trim: 0.55, send: 0.15 },
};

// Tracks the nodes of one voice so they can all be disconnected when the last
// source ends.
class Rec {
  constructor(ctx, noiseBuf) {
    this.ctx = ctx;
    this.noiseBuf = noiseBuf;
    this.sources = [];
    this.nodes = [];
  }
  osc(type, freq, t0, t1) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t0);
    o.stop(t1);
    this.sources.push(o);
    this.nodes.push(o);
    return o;
  }
  noise(t0, t1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start(t0, Math.random() * 1.5);
    s.stop(t1);
    this.sources.push(s);
    this.nodes.push(s);
    return s;
  }
  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }
  filter(type, freq, q = 1, gainDb = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gainDb;
    this.nodes.push(f);
    return f;
  }
  // Connect a -> b -> c ...; returns the last node.
  chain(...ns) {
    for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]);
    return ns[ns.length - 1];
  }
  // Delayed vibrato on the given detune params. Returns nothing.
  vibrato(params, t, delay, depthCents, rate, end) {
    const lfo = this.osc('sine', rate, t, end);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.setValueAtTime(0, t + delay);
    g.gain.linearRampToValueAtTime(depthCents, t + delay + 0.35);
    lfo.connect(g);
    for (const p of params) g.connect(p);
  }
  // Disconnect everything once all sources have ended.
  finish() {
    let left = this.sources.length;
    const nodes = this.nodes;
    const fin = () => {
      if (--left > 0) return;
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch (e) {
          /* already disconnected */
        }
      }
    };
    for (const s of this.sources) s.onended = fin;
  }
}

// Linear attack/decay/sustain/release on an AudioParam. Returns the end time.
function envelope(p, t, dur, peak, a, d, s, r) {
  a = Math.min(a, dur * 0.6);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  let level = peak;
  const dd = d > 0 ? Math.max(0, Math.min(d, dur - a)) : 0;
  if (dd > 0.001) {
    level = peak + (peak * s - peak) * (dd / d);
    p.linearRampToValueAtTime(level, t + a + dd);
  }
  p.setValueAtTime(level, t + dur);
  p.linearRampToValueAtTime(0, t + dur + r);
  return t + dur + r;
}

// Formant sets (centre Hz, Q, gain).
const VOWEL_AH = [
  [800, 6, 1.0],
  [1150, 8, 0.6],
  [2900, 10, 0.35],
];
const VOWEL_KIDS = [
  [650, 7, 1.0],
  [1900, 10, 0.7],
  [3400, 12, 0.5],
];

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._unlockPromise = null;
    this._volume = 0.85;
    this._master = null;
    this._buses = null;
    this._noise = null;
    this._pluckCache = new Map();
  }

  get ctx() {
    return this._ctx;
  }
  get now() {
    return this._ctx ? this._ctx.currentTime : 0;
  }
  get latency() {
    const c = this._ctx;
    if (!c) return 0;
    const o = c.outputLatency;
    if (typeof o === 'number' && o > 0) return o;
    const b = c.baseLatency;
    return typeof b === 'number' && b > 0 ? b : 0;
  }

  unlock() {
    if (this._unlockPromise) {
      // Already created; still nudge a suspended/interrupted context.
      this._kick();
      return this._unlockPromise;
    }
    this._unlockPromise = (async () => {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      let ctx;
      try {
        ctx = new Ctor({ latencyHint: 'interactive' });
      } catch (e) {
        ctx = new Ctor();
      }
      this._ctx = ctx;
      this._build();
      // Silent 1-sample buffer: unlocks audio output on iOS.
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) {
        /* ignore */
      }
      if (ctx.state !== 'running') {
        try {
          await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))]);
        } catch (e) {
          /* ignore */
        }
      }
    })();
    return this._unlockPromise;
  }

  _kick() {
    const c = this._ctx;
    if (c && c.state !== 'running' && c.state !== 'closed') {
      try {
        const p = c.resume();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        /* ignore */
      }
    }
  }

  setMasterVolume(v) {
    this._volume = clamp(Number.isFinite(v) ? v : 1, 0, 1);
    if (this._master) {
      const t = this._ctx.currentTime;
      this._master.gain.setTargetAtTime(this._volume, t, 0.03);
    }
  }

  async suspend() {
    if (this._ctx && this._ctx.state === 'running') {
      try {
        await this._ctx.suspend();
      } catch (e) {
        /* ignore */
      }
    }
  }
  async resume() {
    const c = this._ctx;
    if (c && c.state !== 'running' && c.state !== 'closed') {
      try {
        await c.resume();
      } catch (e) {
        /* ignore */
      }
    }
  }

  // ---- graph ---------------------------------------------------------------

  _build() {
    const ctx = this._ctx;
    const sr = ctx.sampleRate;

    // Master -> soft limiter -> out.
    const master = ctx.createGain();
    master.gain.value = this._volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    master.connect(comp);
    comp.connect(limiter);
    limiter.connect(ctx.destination);
    this._master = master;

    // Shared white-noise buffer (2 s).
    const nb = ctx.createBuffer(1, Math.floor(sr * 2), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this._noise = nb;

    // Procedural reverb: ~1.2 s, bright, stereo-decorrelated.
    const len = Math.floor(sr * 1.2);
    const ir = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      const pre = Math.floor(sr * 0.012);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const decay = Math.exp(-t * 5.6);
        const k = lerp(0.85, 0.35, Math.min(1, t / 1.2)); // gets darker slowly
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * decay;
      }
      // fade the very end to avoid a truncation click
      const fade = Math.floor(sr * 0.05);
      for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    conv.connect(wet);
    wet.connect(master);

    // Per-instrument inputs.
    this._buses = {};
    for (const name of Object.keys(BUSES)) {
      const cfg = BUSES[name];
      const input = ctx.createGain();
      input.gain.value = cfg.trim;
      input.connect(master);
      const send = ctx.createGain();
      send.gain.value = cfg.send;
      input.connect(send);
      send.connect(conv);
      this._buses[name] = input;
    }
  }

  _ready() {
    const c = this._ctx;
    if (!c || !this._buses || c.state === 'closed') return false;
    if (c.state !== 'running') this._kick(); // e.g. iOS "interrupted"
    return true;
  }

  _t(when) {
    const min = this._ctx.currentTime + EPS;
    return Number.isFinite(when) ? Math.max(when, min) : min;
  }

  // ---- public playback -----------------------------------------------------

  playNote(instrument, midi, when, duration, velocity = 1) {
    if (!this._ready()) return;
    if (!Number.isFinite(midi)) return;
    const t = this._t(when);
    const dur = clamp(Number.isFinite(duration) ? duration : 0.5, 0.05, 6);
    const vel = clamp(Number.isFinite(velocity) ? velocity : 1, 0, 1.5);
    if (vel <= 0) return;
    const out = this._buses[instrument];
    if (!out) return;
    const f = midiToHz(midi);
    try {
      switch (instrument) {
        case 'voice':
          return this._formant(out, f, t, dur, vel, {
            vowel: VOWEL_AH,
            detune: 5,
            peak: 0.6,
            attack: 0.05,
            release: 0.14,
            vibrato: 18,
            breath: 0,
            direct: 0.16,
          });
        case 'kids':
          return this._formant(out, f, t, dur, vel, {
            vowel: VOWEL_KIDS,
            detune: 10,
            peak: 0.55,
            attack: 0.03,
            release: 0.1,
            vibrato: 9,
            breath: 0.07,
            direct: 0.1,
          });
        case 'guitar':
          return this._guitar(out, midi, t, dur, vel);
        case 'bass':
          return this._bass(out, f, t, dur, vel);
        case 'bell':
          return this._bell(out, f, t, dur, vel);
        case 'flute':
          return this._flute(out, f, t, dur, vel);
      }
    } catch (e) {
      /* never let audio errors break the game loop */
    }
  }

  playSfx(name, when = this.now) {
    if (!this._ready()) return;
    const t = this._t(when);
    const out = this._buses.sfx;
    try {
      switch (name) {
        case 'tap':
          return this._sfxTap(out, t);
        case 'miss':
          return this._sfxMiss(out, t);
        case 'perfect':
          return this._sfxPerfect(out, t);
        case 'count':
          return this._sfxCount(out, t);
        case 'cheer':
          return this._sfxCheer(out, t);
        case 'whoosh':
          return this._sfxWhoosh(out, t);
      }
    } catch (e) {
      /* ignore */
    }
  }

  // ---- instruments ---------------------------------------------------------

  // Sung vowel: detuned saws through parallel formant bandpasses.
  _formant(out, f, t, dur, vel, o) {
    const ctx = this._ctx;
    const r = new Rec(ctx, this._noise);
    const end = t + dur + o.release + 0.04;

    const env = r.gain(0);
    const peakEnd = envelope(env.gain, t, dur, o.peak * vel, o.attack, 0.12, 0.8, o.release);
    const mix = r.gain(0.5);
    mix.connect(env);

    const oscs = [];
    for (const sgn of [-1, 1]) {
      const osc = r.osc('sawtooth', f, t, end);
      osc.detune.value = sgn * o.detune;
      // small "scoop" up into the pitch, as singers do
      osc.frequency.setValueAtTime(f * 0.975, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      oscs.push(osc);
    }
    const src = r.gain(1);
    oscs[0].connect(src);
    oscs[1].connect(src);

    // Soprano F1 follows the pitch a little so high notes stay open.
    const f1Shift = clamp(f * 1.15, 0, 1000);
    for (let i = 0; i < o.vowel.length; i++) {
      let [fc, q, g] = o.vowel[i];
      if (i === 0) fc = Math.max(fc, f1Shift);
      const bp = r.filter('bandpass', fc, q);
      const bg = r.gain(g);
      src.connect(bp);
      bp.connect(bg);
      bg.connect(mix);
    }
    // a little unfiltered body so low notes keep their fundamental
    const lp = r.filter('lowpass', 1300, 0.7);
    const dg = r.gain(o.direct);
    src.connect(lp);
    lp.connect(dg);
    dg.connect(mix);

    if (dur > 0.4) r.vibrato(oscs.map((x) => x.detune), t, 0.25, o.vibrato, 5.3, end);

    if (o.breath > 0) {
      const n = r.noise(t, t + 0.2);
      const bp = r.filter('bandpass', 3500, 0.8);
      const bg = r.gain(0);
      bg.gain.setValueAtTime(0, t);
      bg.gain.linearRampToValueAtTime(o.breath * vel, t + 0.02);
      bg.gain.linearRampToValueAtTime(0, t + 0.12);
      r.chain(n, bp, bg, env);
    }

    env.connect(out);
    r.finish();
    return peakEnd;
  }

  // Karplus-Strong pluck buffer (cached per midi note).
  _pluck(midi) {
    const hit = this._pluckCache.get(midi);
    if (hit) return hit;
    const ctx = this._ctx;
    const sr = ctx.sampleRate;
    const f = midiToHz(midi);
    const N = Math.max(2, Math.round(sr / f - 0.5)); // 2-point average => period N + 0.5
    const total = Math.floor(sr * 1.9);
    const buf = ctx.createBuffer(1, total, sr);
    const d = buf.getChannelData(0);

    // Deterministic excitation (so every pluck of a pitch sounds the same).
    let seed = 1234567 + midi * 7919;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296 * 2 - 1;
    };
    const exc = new Float32Array(N);
    for (let i = 0; i < N; i++) exc[i] = rnd();
    // dull it for nylon (two one-pole passes), then pick-position comb
    for (let pass = 0; pass < 2; pass++) {
      let y = 0;
      for (let i = 0; i < N; i++) {
        y += 0.45 * (exc[i] - y);
        exc[i] = y;
      }
    }
    const pp = Math.max(1, Math.floor(N * 0.17));
    for (let i = 0; i < N; i++) d[i] = exc[i] - 0.6 * exc[(i + pp) % N];

    const t60 = lerp(2.3, 1.0, clamp((midi - 36) / 48, 0, 1));
    const g = Math.min(0.9998, Math.exp(-6.9 / (t60 * f)));
    d[N] = g * 0.5 * d[0];
    for (let i = N + 1; i < total; i++) d[i] = g * 0.5 * (d[i - N] + d[i - N - 1]);

    let peak = 0;
    for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(d[i]));
    const norm = peak > 0 ? 0.85 / peak : 1;
    const tail = Math.floor(sr * 0.08);
    for (let i = 0; i < total; i++) {
      let v = d[i] * norm;
      if (i > total - tail) v *= (total - i) / tail;
      d[i] = v;
    }
    const entry = { buf, rate: f / (sr / (N + 0.5)) };
    this._pluckCache.set(midi, entry);
    return entry;
  }

  _guitar(out, midi, t, dur, vel) {
    const ctx = this._ctx;
    const r = new Rec(ctx, this._noise);
    const { buf, rate } = this._pluck(midi);
    const ring = clamp(dur + 0.15, 0.4, 1.8);
    const rel = 0.18;
    const end = t + ring + rel + 0.03;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.start(t);
    src.stop(Math.min(end, t + buf.duration / rate));
    r.sources.push(src);
    r.nodes.push(src);

    const body = r.filter('peaking', 210, 1.2, 4);
    const lp = r.filter('lowpass', 3200, 0.6);
    const env = r.gain(0);
    const peak = 0.75 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.003);
    env.gain.setValueAtTime(peak, t + ring);
    env.gain.linearRampToValueAtTime(0, t + ring + rel);
    r.chain(src, body, lp, env, out);
    r.finish();
  }

  _bass(out, f, t, dur, vel) {
    const r = new Rec(this._ctx, this._noise);
    const rel = 0.12;
    const end = t + dur + rel + 0.04;
    const env = r.gain(0);
    envelope(env.gain, t, dur, 0.8 * vel, 0.012, 0.25, 0.6, rel);

    const lp = r.filter('lowpass', 900, 0.8);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(280, t + 0.3);

    const o1 = r.osc('triangle', f, t, end);
    const o2 = r.osc('sine', f * 2, t, end);
    const g2 = r.gain(0.3);
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);

    // finger thump
    const n = r.noise(t, t + 0.06);
    const nbp = r.filter('bandpass', 260, 1.2);
    const ng = r.gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.18 * vel, t + 0.004);
    ng.gain.linearRampToValueAtTime(0, t + 0.05);
    r.chain(n, nbp, ng, lp);

    r.chain(lp, env, out);
    r.finish();
  }

  _bell(out, f, t, dur, vel) {
    const r = new Rec(this._ctx, this._noise);
    const ring = clamp(dur + 0.5, 1.0, 2.2);
    const end = t + ring;
    const master = r.gain(0.5 * vel);
    const partials = [
      [1, 1.0, 0.32],
      [2.76, 0.35, 0.16],
      [5.4, 0.15, 0.08],
    ];
    for (const [ratio, amp, tau] of partials) {
      const pf = f * ratio;
      if (pf > 12000) continue;
      const o = r.osc('sine', pf, t, end);
      const g = r.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, tau * (1 + Math.min(dur, 1.5) * 0.25));
      r.chain(o, g, master);
    }
    // final short fade so the stop is never abrupt
    master.gain.setValueAtTime(0.5 * vel, end - 0.06);
    master.gain.linearRampToValueAtTime(0, end - 0.005);
    master.connect(out);
    r.finish();
  }

  _flute(out, f, t, dur, vel) {
    const r = new Rec(this._ctx, this._noise);
    const rel = 0.12;
    const end = t + dur + rel + 0.04;
    const env = r.gain(0);
    envelope(env.gain, t, dur, 0.55 * vel, 0.07, 0.1, 0.85, rel);

    const mix = r.gain(1);
    const parts = [
      [1, 1.0],
      [2, 0.16],
      [3, 0.05],
    ];
    const dets = [];
    for (const [m, a] of parts) {
      const o = r.osc('sine', f * m, t, end);
      const g = r.gain(a);
      r.chain(o, g, mix);
      dets.push(o.detune);
    }
    if (dur > 0.4) r.vibrato(dets, t, 0.3, 12, 5, end);

    // airy noise, strongest in the attack "chiff"
    const n = r.noise(t, end);
    const bp = r.filter('bandpass', clamp(f * 2.5, 1200, 6000), 2.5);
    const ng = r.gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.16, t + 0.04);
    ng.gain.linearRampToValueAtTime(0.06, t + 0.15);
    ng.gain.setValueAtTime(0.06, t + dur);
    ng.gain.linearRampToValueAtTime(0, t + dur + rel);
    r.chain(n, bp, ng, mix);

    r.chain(mix, env, out);
    r.finish();
  }

  // ---- sfx -----------------------------------------------------------------

  // Decaying sine "ping".
  _ping(out, freq, t, peak, tau) {
    const r = new Rec(this._ctx, this._noise);
    const end = t + tau * 6 + 0.03;
    const o = r.osc('sine', freq, t, end);
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, tau);
    g.gain.setValueAtTime(peak * 0.003, end - 0.025);
    g.gain.linearRampToValueAtTime(0, end - 0.002);
    r.chain(o, g, out);
    r.finish();
  }

  _sfxTap(out, t) {
    const r = new Rec(this._ctx, this._noise);
    const end = t + 0.09;
    const o = r.osc('sine', 900, t, end);
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(560, t + 0.05);
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.004);
    g.gain.linearRampToValueAtTime(0, t + 0.07);
    r.chain(o, g, out);
    r.finish();
  }

  // Gentle comic "boop": a soft downward glide with a little wobble.
  _sfxMiss(out, t) {
    const r = new Rec(this._ctx, this._noise);
    const end = t + 0.4;
    const o = r.osc('triangle', 392, t, end);
    o.frequency.setValueAtTime(392, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.26);
    const lfo = r.osc('sine', 16, t, end);
    const lg = r.gain(14);
    lfo.connect(lg);
    lg.connect(o.detune);
    const lp = r.filter('lowpass', 1100, 0.5);
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.26, t + 0.015);
    g.gain.setValueAtTime(0.26, t + 0.1);
    g.gain.linearRampToValueAtTime(0, t + 0.33);
    r.chain(o, lp, g, out);
    r.finish();
  }

  _sfxPerfect(out, t) {
    this._ping(out, 2637, t, 0.1, 0.1);
    this._ping(out, 3520, t + 0.05, 0.08, 0.12);
  }

  // Woodblock.
  _sfxCount(out, t) {
    const r = new Rec(this._ctx, this._noise);
    const end = t + 0.22;
    const o = r.osc('sine', 1150, t, end);
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.04);
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.38, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, 0.025);
    g.gain.setValueAtTime(0.0005, t + 0.19);
    g.gain.linearRampToValueAtTime(0, t + 0.215);
    r.chain(o, g, out);

    const n = r.noise(t, t + 0.04);
    const bp = r.filter('bandpass', 2400, 4);
    const ng = r.gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.16, t + 0.002);
    ng.gain.linearRampToValueAtTime(0, t + 0.03);
    r.chain(n, bp, ng, out);
    r.finish();
  }

  // Children's cheer: breathy swell, a few rising "wee" voices, sparkle arpeggio.
  _sfxCheer(out, t) {
    const r = new Rec(this._ctx, this._noise);
    const end = t + 1.0;

    const n = r.noise(t, end);
    const bp = r.filter('bandpass', 900, 1.2);
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(2200, t + 0.5);
    const ng = r.gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.2, t + 0.15);
    ng.gain.linearRampToValueAtTime(0, t + 0.9);
    r.chain(n, bp, ng, out);

    const vf = r.filter('bandpass', 1200, 2.5);
    const vg = r.gain(0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(0.16, t + 0.12);
    vg.gain.setValueAtTime(0.16, t + 0.4);
    vg.gain.linearRampToValueAtTime(0, t + 0.85);
    r.chain(vf, vg, out);
    [[430, 1.0], [540, 1.01], [680, 0.99]].forEach(([f0, k], i) => {
      const o = r.osc('sawtooth', f0, t, end);
      const s = t + i * 0.03;
      o.frequency.setValueAtTime(f0 * 0.9, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.45 * k, t + 0.5 + i * 0.03);
      const og = r.gain(0.5);
      r.chain(o, og, vf);
      void s;
    });
    r.finish();

    [1047, 1319, 1568, 2093, 2637].forEach((fr, i) => {
      this._ping(out, fr, t + 0.12 + i * 0.07, 0.09, 0.22);
    });
  }

  _sfxWhoosh(out, t) {
    const r = new Rec(this._ctx, this._noise);
    const end = t + 0.7;
    const n = r.noise(t, end);
    const bp = r.filter('bandpass', 300, 1.4);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.22);
    g.gain.linearRampToValueAtTime(0, t + 0.62);
    r.chain(n, bp, g, out);
    r.finish();
  }
}
