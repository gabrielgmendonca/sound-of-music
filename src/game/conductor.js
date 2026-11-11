// Sequencer + judge. The audio clock is the only clock: sound is scheduled a
// little ahead on `ctx.currentTime`, while visuals and tap judgment use
// `songTime`, which is the same clock minus output latency (i.e. what the
// player is hearing right now).

import { GAME } from '../config.js';

const SCHEDULE_AHEAD = 0.25; // seconds
const LEAD_IN = 0.8; // silence before beat 0

export class Conductor {
  /**
   * handlers: onBeat(i, beatsPerBar), onAuto(note), onHit(note, kind), onMiss(note),
   *           onStray(), onCue(cue), onEnd(stats)
   */
  constructor(audio, handlers = {}) {
    this.audio = audio;
    this.h = handlers;
    this.running = false;
    this.chart = null;
  }

  /** Swap in a song. Call while stopped, before start(). */
  load(chart) {
    this.running = false;
    this.chart = chart;

    // Everything that makes sound on its own, in time order.
    this.sounds = [
      ...chart.backing,
      ...chart.notes.filter((n) => n.auto).map((n) => ({ ...n, inst: 'voice', vel: 0.9 })),
      ...chart.notes.filter((n) => n.ghost).map((n) => ({ ...n, inst: 'flute', vel: 0.22 })),
    ].sort((a, b) => a.t - b.t);
    // Things that only need a visual reaction, fired at heard-time.
    this.visuals = [
      ...chart.notes.filter((n) => n.auto).map((n) => ({ t: n.t, auto: n })),
      ...chart.cues.map((c) => ({ t: c.t, cue: c })),
    ].sort((a, b) => a.t - b.t);
  }

  start() {
    this.startTime = this.audio.now + LEAD_IN;
    this.soundIdx = 0;
    this.visualIdx = 0;
    this.missIdx = 0;
    this.lastBeat = -1;
    this.state = new Map(); // target id -> 'hit' | 'miss'
    this.stats = { perfect: 0, good: 0, miss: 0, combo: 0, maxCombo: 0, total: this.chart.targets.length };
    this.ended = false;
    this.running = true;
  }

  stop() { this.running = false; }

  /** Seconds into the song, as currently heard. */
  get songTime() {
    return this.audio.now - this.startTime - this.audio.latency;
  }

  get progress() {
    if (!this.chart) return 0;
    return Math.min(1, Math.max(0, this.songTime / this.chart.duration));
  }

  update() {
    if (!this.running) return;
    const { audio, chart, h } = this;

    // 1. Schedule upcoming sound.
    const horizon = audio.now - this.startTime + SCHEDULE_AHEAD;
    while (this.soundIdx < this.sounds.length && this.sounds[this.soundIdx].t < horizon) {
      const s = this.sounds[this.soundIdx++];
      const when = this.startTime + s.t;
      if (s.inst === 'sfx') audio.playSfx(s.name, when);
      else audio.playNote(s.inst, s.midi, when, s.len, s.vel);
    }

    const t = this.songTime;

    // 2. Visual events.
    while (this.visualIdx < this.visuals.length && this.visuals[this.visualIdx].t <= t) {
      const v = this.visuals[this.visualIdx++];
      if (v.auto) h.onAuto?.(v.auto);
      else h.onCue?.(v.cue);
    }

    // 3. Beats.
    const beat = Math.floor(t / chart.spb);
    if (beat > this.lastBeat && t >= 0) {
      this.lastBeat = beat;
      h.onBeat?.(beat, chart.meter);
    }

    // 4. Targets that slipped by.
    const targets = chart.targets;
    while (this.missIdx < targets.length && targets[this.missIdx].t + GAME.goodWindow < t) {
      const n = targets[this.missIdx++];
      if (!this.state.has(n.id)) {
        this.state.set(n.id, 'miss');
        this.stats.miss++;
        this.stats.combo = 0;
        h.onMiss?.(n);
      }
    }

    // 5. The end.
    if (!this.ended && t >= chart.duration) {
      this.ended = true;
      this.running = false;
      h.onEnd?.(this.result());
    }
  }

  /** `age` = seconds between the physical tap and this call. */
  tap(age = 0) {
    if (!this.running) return;
    const t = this.songTime - age - GAME.inputOffset;
    let best = null;
    let bestD = Infinity;
    const targets = this.chart.targets;
    for (let i = this.missIdx; i < targets.length; i++) {
      const n = targets[i];
      if (n.t - t > GAME.goodWindow) break;
      if (this.state.has(n.id)) continue;
      const d = Math.abs(n.t - t);
      if (d < bestD) { best = n; bestD = d; }
    }
    if (!best || bestD > GAME.goodWindow) {
      this.audio.playSfx('tap');
      this.h.onStray?.();
      return;
    }
    const kind = bestD <= GAME.perfectWindow ? 'perfect' : 'good';
    this.state.set(best.id, 'hit');
    this.stats[kind]++;
    this.stats.combo++;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
    this.audio.playNote('kids', best.midi, this.audio.now, Math.min(best.len, 2.6), 0.95);
    if (kind === 'perfect') this.audio.playSfx('perfect');
    this.h.onHit?.(best, kind);
  }

  /** Cue bubbles for the HUD: reuses one array to avoid per-frame garbage. */
  cues(lookahead, out) {
    out.length = 0;
    if (!this.running) return out;
    const t = this.songTime;
    const targets = this.chart.targets;
    for (let i = Math.max(0, this.missIdx - 4); i < targets.length; i++) {
      const n = targets[i];
      const dt = n.t - t;
      if (dt > lookahead) break;
      if (dt < -0.4) continue;
      out.push(n);
      n.dt = dt;
      n.state = this.state.get(n.id) || 'pending';
    }
    return out;
  }

  result() {
    const s = this.stats;
    const ratio = s.total ? (s.perfect + s.good * 0.6) / s.total : 0;
    const rank = ratio >= 0.85 ? 'superb' : ratio >= 0.55 ? 'ok' : 'try';
    return { ...s, ratio, rank };
  }
}
