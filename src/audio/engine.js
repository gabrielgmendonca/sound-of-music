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
  guitarMute: { trim: 0.55, send: 0.08 }, // palm-muted "chk"; shares the guitar body
  accordion: { trim: 0.5, send: 0.32 },
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
    if (typeof type === 'string') o.type = type;
    else o.setPeriodicWave(type);
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


// ---- plucked-string synthesis (offline, into Float32Array) ------------------

// Phase delay (samples) at angular freq w of the first-order all-pass
// (eta + z^-1) / (1 + eta z^-1).
function allpassDelay(eta, w) {
  const ph = Math.atan2(-Math.sin(w), eta + Math.cos(w)) - Math.atan2(-eta * Math.sin(w), 1 + eta * Math.cos(w));
  return -ph / w;
}

// One damped, fractionally tuned string loop (one polarisation).
function makeLoop(sr, f, fcRatio, fcMin, t60) {
  const w = (2 * Math.PI * f) / sr;
  const fc = clamp(f * fcRatio, fcMin, sr * 0.4);
  const c = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  // one-pole loop low-pass y += c (x - y): magnitude and phase delay at f
  const re = 1 - (1 - c) * Math.cos(w);
  const im = (1 - c) * Math.sin(w);
  const mag = c / Math.hypot(re, im);
  const pdLp = Math.atan2(im, re) / w;
  const gPer = Math.pow(10, -3 / (t60 * f)); // 60 dB over t60 at the fundamental
  const g = Math.min(0.9995, gPer / mag);
  const rem = sr / f - pdLp;
  const N = Math.max(4, Math.floor(rem - 0.5));
  const dap = rem - N; // in [0.5, 1.5) unless clamped
  let lo = -0.95,
    hi = 0.95;
  for (let i = 0; i < 24; i++) {
    const mid = 0.5 * (lo + hi);
    if (allpassDelay(mid, w) > dap) lo = mid;
    else hi = mid;
  }
  return { N, buf: new Float32Array(N), c, g, eta: 0.5 * (lo + hi) };
}

// Renders a plucked string to a Float32Array. o = {
//  len (s), cents, pol (cents), polMix, bright (exc. low-pass coeff), pick (0..1 of string),
//  fcRatio, fcMin, t60, tAlpha, tTau, tAmp, target (rms over first win s), win }
function renderString(sr, midi, o) {
  const total = Math.floor(sr * o.len);
  const out = new Float32Array(total);
  const f0 = midiToHz(midi) * Math.pow(2, o.cents / 1200);
  const A = makeLoop(sr, f0 * Math.pow(2, o.pol / 1200), o.fcRatio, o.fcMin, o.t60);
  const B = makeLoop(sr, f0 * Math.pow(2, -o.pol / 1200), o.fcRatio * 0.9, o.fcMin, o.t60 * 0.8);

  // Excitation: windowed noise, velocity-dependent low-pass, pick-position comb.
  const N = A.N;
  const e = new Float32Array(N);
  for (let i = 0; i < N; i++) e[i] = (Math.random() * 2 - 1) * Math.pow(Math.sin((Math.PI * (i + 0.5)) / N), 0.6);
  const smooth = (arr, a) => {
    let y = 0;
    for (let i = 0; i < arr.length; i++) {
      y += a * (arr[i] - y);
      arr[i] = y;
    }
  };
  smooth(e, o.bright);
  smooth(e, o.bright);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += e[i];
  mean /= N;
  const p = Math.max(1, Math.round(N * o.pick));
  const ea = A.buf;
  for (let i = 0; i < N; i++) ea[i] = e[i] - mean - 0.85 * (e[(i + p) % N] - mean);
  // second polarisation: other length, darker, weaker, different pick
  const NB = B.N;
  const pb = Math.max(1, Math.round(NB * (o.pick * 1.15)));
  const eb = B.buf;
  for (let i = 0; i < NB; i++) {
    const k = (i * N) / NB;
    const i0 = Math.floor(k);
    const v = e[i0 % N] * (1 - (k - i0)) + e[(i0 + 1) % N] * (k - i0);
    eb[i] = v - mean;
  }
  smooth(eb, 0.5);
  for (let i = 0; i < NB; i++) eb[i] = (eb[i] - 0.6 * eb[(i + pb) % NB]) * o.polMix;

  // string loops
  {
    const a = A.buf,
      b = B.buf;
    const aN = A.N,
      bN = B.N;
    const ac = A.c,
      ag = A.g,
      ae = A.eta,
      bc = B.c,
      bg = B.g,
      be = B.eta;
    let ia = 0,
      ib = 0,
      alp = 0,
      ax = 0,
      ay = 0,
      blp = 0,
      bx = 0,
      by = 0;
    for (let n = 0; n < total; n++) {
      const sa = a[ia];
      const sb = b[ib];
      out[n] = sa + sb;
      alp += ac * (sa - alp);
      const ya = ae * alp + ax - ae * ay;
      ax = alp;
      ay = ya;
      a[ia] = ya * ag;
      if (++ia === aN) ia = 0;
      blp += bc * (sb - blp);
      const yb = be * blp + bx - be * by;
      bx = blp;
      by = yb;
      b[ib] = yb * bg;
      if (++ib === bN) ib = 0;
    }
  }

  // Finger / palm attack transient (soft noise thump, no click).
  const tn = Math.floor(sr * Math.min(0.05, o.len));
  const tr = new Float32Array(tn);
  let l1 = 0,
    l2 = 0,
    e2 = 0;
  for (let i = 0; i < tn; i++) {
    const t = i / sr;
    l1 += o.tAlpha * (Math.random() * 2 - 1 - l1);
    l2 += o.tAlpha * (l1 - l2);
    const v = l2 * (1 - Math.exp(-t / 0.0007)) * Math.exp(-t / o.tTau);
    tr[i] = v;
    e2 += v * v;
  }
  const w20 = Math.floor(sr * 0.02);
  let s20 = 0;
  for (let i = 0; i < w20; i++) s20 += out[i] * out[i];
  const k20 = Math.sqrt(s20 / w20);
  const trRms = Math.sqrt(e2 / Math.max(1, Math.min(tn, w20)));
  const tk = trRms > 0 ? (o.tAmp * k20) / trRms : 0;
  for (let i = 0; i < tn; i++) out[i] += tr[i] * tk;

  // normalise by RMS over the first window, cap peak, fade tail
  const wn = Math.min(total, Math.floor(sr * o.win));
  // (measured through a ~1.5 kHz low-pass so bright and dark layers sound equally loud)
  const wc = 1 - Math.exp((-2 * Math.PI * 1500) / sr);
  let ss = 0,
    wl = 0;
  for (let i = 0; i < wn; i++) {
    wl += wc * (out[i] - wl);
    ss += wl * wl;
  }
  let k = ss > 0 ? o.target / Math.sqrt(ss / wn) : 1;
  let pk = 0;
  for (let i = 0; i < total; i++) pk = Math.max(pk, Math.abs(out[i]));
  if (pk * k > 0.9) k = 0.9 / pk;
  const fade = Math.floor(sr * 0.06);
  for (let i = 0; i < total; i++) {
    let v = out[i] * k;
    if (i > total - fade) v *= (total - i) / fade;
    out[i] = v;
  }
  return out;
}

// Guitar body resonances (centre Hz, Q, gain) mixed in parallel with the dry string.
const BODY_MODES = [
  [96, 7, 1.7], // air (Helmholtz)
  [190, 6, 2.0], // top plate
  [285, 8, 1.0],
  [405, 9, 0.8],
  [520, 9, 0.6],
  [700, 8, 0.55],
  [1080, 8, 0.5],
  [1650, 7, 0.4],
  [2450, 6, 0.3],
];

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
    this._pluckCount = 0;
    this._gtrIn = null;
    this._reed = null;
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

    // Shared guitar body: dry string + parallel resonators -> guitar bus.
    const gin = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 62;
    hp.Q.value = 0.6;
    const sum = ctx.createGain();
    sum.gain.value = 1;
    const dry = ctx.createGain();
    dry.gain.value = 0.55;
    gin.connect(hp);
    hp.connect(dry);
    dry.connect(sum);
    for (const [fc, q, g] of BODY_MODES) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fc;
      bp.Q.value = q;
      const bg = ctx.createGain();
      bg.gain.value = g;
      hp.connect(bp);
      bp.connect(bg);
      bg.connect(sum);
    }
    const top = ctx.createBiquadFilter(); // nylon is soft on top
    top.type = 'lowpass';
    top.frequency.value = 6500;
    top.Q.value = 0.5;
    sum.connect(top);
    top.connect(this._buses.guitar);
    this._gtrIn = gin;

    // Reed-like wave for the accordion: odd-heavy, 1/k roll-off.
    const H = 28;
    const re = new Float32Array(H + 1);
    const im = new Float32Array(H + 1);
    for (let k = 1; k <= H; k++) im[k] = (1 / k) * (k % 2 === 0 ? 0.55 : 1);
    this._reed = ctx.createPeriodicWave(re, im);
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
    let out = this._buses[instrument];
    if (!out) return;
    if (instrument === 'guitar' || instrument === 'guitarMute') out = this._gtrIn;
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
            breath: 0.035,
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
          return this._guitar(out, midi, t, dur, vel, false);
        case 'guitarMute':
          return this._guitar(out, midi, t, dur, vel, true);
        case 'accordion':
          return this._accordion(out, f, t, dur, vel);
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
      osc.detune.value = sgn * o.detune + (Math.random() - 0.5) * 6;
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

  // Renders one pluck variant. layer 0 = soft, 1 = hard, 2 = palm mute.
  _renderPluck(midi, layer) {
    const sr = this._ctx.sampleRate;
    const pos = clamp((midi - 36) / 48, 0, 1);
    if (layer === 2) {
      return renderString(sr, midi, {
        len: 0.32,
        cents: (Math.random() - 0.5) * 6,
        pol: 1.5,
        polMix: 0.3,
        bright: 0.3,
        pick: 0.14 + Math.random() * 0.05,
        fcRatio: 3.2,
        fcMin: 500,
        t60: 0.16,
        tAlpha: 0.1,
        tTau: 0.012,
        tAmp: 1.1,
        target: 0.12,
        win: 0.08,
      });
    }
    const hard = layer === 1;
    return renderString(sr, midi, {
      len: lerp(2.9, 1.9, pos),
      cents: (Math.random() - 0.5) * 5,
      pol: 0.9 + Math.random() * 0.8,
      polMix: 0.4 + Math.random() * 0.15,
      bright: hard ? 0.7 : 0.2,
      pick: 0.15 + Math.random() * 0.05, // ~1/6.5 .. 1/5 of the string
      fcRatio: hard ? 16 : 8,
      fcMin: hard ? 1800 : 1100,
      t60: lerp(3.8, 2.6, pos) * (0.92 + Math.random() * 0.16),
      tAlpha: hard ? 0.3 : 0.12,
      tTau: hard ? 0.005 : 0.008,
      tAmp: hard ? 0.7 : 0.55,
      target: 0.12,
      win: 0.5,
    });
  }

  // Round-robin pluck buffer, rendered lazily and cached (LRU, bounded memory).
  _pluckBuf(midi, layer) {
    const VAR = 3;
    const key = layer * 1000 + midi;
    let ent = this._pluckCache.get(key);
    if (ent) {
      this._pluckCache.delete(key); // refresh LRU position
    } else {
      ent = { v: [], last: -1 };
    }
    this._pluckCache.set(key, ent);
    let i;
    do i = Math.floor(Math.random() * VAR);
    while (i === ent.last);
    if (!ent.v[i]) {
      const d = this._renderPluck(midi, layer);
      const buf = this._ctx.createBuffer(1, d.length, this._ctx.sampleRate);
      buf.getChannelData(0).set(d);
      ent.v[i] = buf;
      this._pluckCount++;
      for (const [k, e] of this._pluckCache) {
        if (this._pluckCount <= 150) break;
        if (k === key) continue;
        this._pluckCount -= e.v.filter(Boolean).length;
        this._pluckCache.delete(k);
      }
    }
    ent.last = i;
    return ent.v[i];
  }

  // Nylon-string guitar (and palm-muted "chk" when mute is true).
  _guitar(out, midi, t, dur, vel, mute) {
    const ctx = this._ctx;
    const r = new Rec(ctx, this._noise);
    const layer = mute ? 2 : vel < 0.6 ? 0 : 1;
    const buf = this._pluckBuf(midi, layer);
    const bd = buf.duration;
    const v = clamp(vel / 1.2, 0, 1);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.start(t);
    r.sources.push(src);
    r.nodes.push(src);

    // brightness follows velocity (on top of the soft/hard excitation layers)
    const lp = r.filter('lowpass', (mute ? 1400 : 650 + 7500 * Math.pow(v, 1.3)) * (0.92 + Math.random() * 0.16), 0.5);
    const env = r.gain(0);
    const peak = (mute ? 0.75 : 1.2) * Math.pow(vel, 1.2) * (0.93 + Math.random() * 0.14);
    env.gain.setValueAtTime(peak, t);

    // How long the string is allowed to ring before a hand damps it.
    const sound = mute ? bd : Math.max(dur, 0.35);
    let stopAt = t + bd;
    if (!mute && sound < bd - 0.45) {
      const te = t + sound;
      env.gain.setTargetAtTime(0, te, 0.045);
      lp.frequency.setTargetAtTime(220, te, 0.06);
      stopAt = te + 0.35;
    }
    src.stop(stopAt);
    r.chain(src, lp, env, out);
    r.finish();
  }

  // Plucked upright: partials with individual woody decays + finger thump.
  _bass(out, f, t, dur, vel) {
    const r = new Rec(this._ctx, this._noise);
    const sound = Math.max(dur, 0.3);
    const rel = 0.14;
    const end = t + sound + rel + 0.05;
    const dk = clamp(120 / f, 0.7, 1.5); // low strings ring longer
    const low = f < 110 ? 0.55 : 1; // phone speakers: lean on harmonics for low notes
    const master = r.gain(0.34 * Math.pow(vel, 1.1));
    const lp = r.filter('lowpass', 1500 + 1500 * vel, 0.7);
    lp.frequency.setValueAtTime(1500 + 1800 * vel, t);
    lp.frequency.setTargetAtTime(700, t, 0.18);
    const env = r.gain(1);
    env.gain.setValueAtTime(1, t + sound);
    env.gain.setTargetAtTime(0, t + sound, rel / 3);
    // [harmonic, amp, decay tau]
    const parts = [
      [1, 0.8 * low, 0.5],
      [2, 1.0, 0.34],
      [3, 0.7, 0.22],
      [4, 0.42, 0.15],
      [5, 0.24, 0.1],
      [6, 0.12, 0.07],
    ];
    const sk = (Math.random() - 0.5) * 0.05;
    for (const [h, a, tau] of parts) {
      const pf = f * h * (1 + sk * 0.01 * h * h); // slight stiffness
      if (pf > 9000) continue;
      const o = r.osc('sine', pf, t, end);
      o.frequency.setValueAtTime(pf * 1.01, t); // string-tension glide after the pluck
      o.frequency.exponentialRampToValueAtTime(pf, t + 0.07);
      o.detune.value = (Math.random() - 0.5) * 6;
      const g = r.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.004);
      g.gain.setTargetAtTime(a * 0.12, t + 0.004, tau * dk);
      r.chain(o, g, master);
    }
    r.chain(master, lp, env, out);
    // thumb/finger: low thump + woody snap
    const n1 = r.noise(t, t + 0.08);
    const b1 = r.filter('bandpass', 170, 1.4);
    const g1 = r.gain(0);
    g1.gain.setValueAtTime(0, t);
    g1.gain.linearRampToValueAtTime(0.22 * vel, t + 0.004);
    g1.gain.linearRampToValueAtTime(0, t + 0.06);
    r.chain(n1, b1, g1, master);
    const n2 = r.noise(t, t + 0.04);
    const b2 = r.filter('bandpass', 1300, 1.6);
    const g2 = r.gain(0);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.1 * vel, t + 0.002);
    g2.gain.linearRampToValueAtTime(0, t + 0.02);
    r.chain(n2, b2, g2, master);
    r.finish();
  }

  // Harmonium / Alpine accordion: three detuned reeds + octave-down, bellows swell.
  _accordion(out, f, t, dur, vel) {
    const r = new Rec(this._ctx, this._noise);
    const att = 0.09 + Math.random() * 0.05;
    const rel = 0.3;
    const end = t + dur + rel + 0.05;
    const env = r.gain(0);
    const pk = 0.075 * Math.pow(vel, 0.9);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(pk * 0.35, t + att * 0.5);
    env.gain.linearRampToValueAtTime(pk, t + att);
    const hold = Math.max(t + att, t + dur);
    env.gain.setValueAtTime(pk, hold);
    env.gain.linearRampToValueAtTime(0, hold + rel);

    const fc = clamp(f * 4.2, 700, 2800);
    const lp = r.filter('lowpass', fc, 0.6);
    lp.frequency.setValueAtTime(fc * 0.45, t);
    lp.frequency.linearRampToValueAtTime(fc, t + att * 1.3);
    // gentle reed-box warmth
    const warm = r.filter('peaking', 900, 0.8, 2.5);
    const mix = r.gain(1);
    // musette tuning: beats of ~1.2 and ~2.2 Hz regardless of register
    const cents = (hz) => clamp(1200 * Math.log2(1 + hz / f), 2, 16);
    const reeds = [
      [0, 0.8],
      [cents(1.3) * (0.8 + Math.random() * 0.4), 0.6],
      [-cents(2.2) * (0.8 + Math.random() * 0.4), 0.6],
    ];
    for (const [c, a] of reeds) {
      const o = r.osc(this._reed, f, t, end);
      o.detune.value = c;
      const g = r.gain(a);
      r.chain(o, g, mix);
    }
    const sub = r.osc('sine', f * 0.5, t, end);
    const sg = r.gain(0.25);
    r.chain(sub, sg, mix);
    // slow bellows pressure wobble
    const lfo = r.osc('sine', 0.25 + Math.random() * 0.15, t, end);
    const lg = r.gain(pk * 0.05);
    lfo.connect(lg);
    lg.connect(env.gain);
    r.chain(mix, lp, warm, env, out);
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
    // Pitched high enough to survive phone speakers, but brief and quiet.
    const o = r.osc('triangle', 523, t, end);
    o.frequency.setValueAtTime(523, t);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.22);
    const lfo = r.osc('sine', 16, t, end);
    const lg = r.gain(14);
    lfo.connect(lg);
    lg.connect(o.detune);
    const lp = r.filter('lowpass', 1100, 0.5);
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.015);
    g.gain.setValueAtTime(0.2, t + 0.08);
    g.gain.linearRampToValueAtTime(0, t + 0.28);
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
