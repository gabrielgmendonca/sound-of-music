// Stage 3 — "My Favorite Things". E minor, 3/4, a quick waltz under the stars.
// Only the verse is arranged (minor, then major for the finale).
// See docs/PLAN.md → "Song arrangements".

import { createKit, CHORDS, G_MAJOR, N } from './kit.js';

export const BPM = 168;

const { B3, C, D, Ds, E, Fs, G, A, B } = N;

// One entry per bar: [midi, beat-in-bar, duration]
const OPEN = [
  [[E, 0, 1], [B, 1, 1], [B, 2, 1]], [[Fs, 0, 1], [E, 1, 1], [E, 2, 1]],
  [[B3, 0, 1], [E, 1, 1], [E, 2, 1]], [[Fs, 0, 1], [E, 1, 2]],
];
const VERSE = [
  ...OPEN,
  ...OPEN,
  [[E, 0, 1], [B, 1, 1], [A, 2, 1]], [[E, 0, 1], [Fs, 1, 1], [D, 2, 1]],
  [[D, 0, 1], [A, 1, 1], [G, 2, 1]], [[C, 0, 3]],
  [[B3, 0, 1], [C, 1, 1], [D, 2, 1]], [[E, 0, 1], [Fs, 1, 1], [G, 2, 1]],
  [[A, 0, 1], [B, 1, 1], [A, 2, 1]], [[Ds, 0, 3]],
];

const MINOR = ['Em', 'Em', 'Em', 'Em', 'Cmaj7', 'Cmaj7', 'Cmaj7', 'Cmaj7', 'Am', 'D7', 'G', 'C', 'G', 'C', 'Am', 'B7'];
const MAJOR = ['E', 'E', 'E', 'E', 'A', 'A', 'A', 'A', 'Am', 'D7', 'G', 'C', 'G', 'C', 'Am', 'B7'];

export function build(text) {
  const kit = createKit({ bpm: BPM, meter: 3, text, seed: 1961, scale: G_MAJOR });
  const { note, play, strum, waltzPick, waltzStrum, waltzBass, padBar, bells, count, prompt, round } = kit;
  const R = text.stages.favorite.rounds;
  const P = text.prompts;

  // How many bars in a row this chord has already sounded (root/fifth turns).
  const run = (chords, i) => { let k = 0; while (i - k > 0 && chords[i - k - 1] === chords[i]) k++; return k; };

  /** Backing for a stretch of bars. style: 'soft' (picked) or 'band' (strummed). */
  const bars = (start, chords, style, { from = 0, after = 'Em', level = 1, pad = true } = {}) => {
    chords.forEach((ch, k) => {
      const beat = start + k * 3;
      const i = from + k;
      const next = chords[k + 1] || after;
      if (style === 'soft') {
        waltzPick(beat, ch, { variant: i, level });
        waltzBass(beat, ch, next, { level: 0.7 * level, variant: run(chords, k) });
        if (pad && i >= 8) padBar(beat, ch, 0.18);
      } else {
        waltzStrum(beat, ch, { variant: i, level });
        waltzBass(beat, ch, next, { level, variant: run(chords, k), walk: true });
        padBar(beat, ch, 0.26 * level);
      }
    });
  };

  const melody = (start, from, to, opts) => {
    for (let i = from; i < to; i++) {
      VERSE[i].forEach(([midi, b, dur]) => {
        const o = typeof opts === 'function' ? opts(b) : opts;
        note(start + (i - from) * 3 + b, midi, dur, o);
      });
    }
  };

  // ── Intro: 8 bars of vamp, 0–24 ────────────────────────────────────────
  for (let i = 0; i < 8; i++) {
    const ch = i < 4 ? 'Em' : 'Cmaj7';
    waltzPick(i * 3, ch, { variant: i, level: 0.8 + i * 0.03 });
    if (i >= 2) waltzBass(i * 3, ch, null, { level: 0.65, variant: i % 2 });
  }
  bells(13, 'Cmaj7', { vel: 0.22, step: 1 });
  round(0, R.listen);
  prompt(0.5, P.howTo, 'info', 3.6);
  prompt(12, P.waltz, 'listen', 3.4);
  count(21, 22, 23);

  // ── Round 1: 24–72, she sings; you tap the "one" ───────────────────────
  melody(24, 0, 16, (b) => ({ auto: true, target: b === 0 }));
  bars(24, MINOR, 'soft');
  bells(24 + 11 * 3 + 1, 'C', { vel: 0.26 });

  // ── Interlude: 72–84 ───────────────────────────────────────────────────
  bars(72, ['Em', 'Em', 'Em', 'Em'], 'band', { level: 0.95 });
  round(72, R.sing);
  prompt(72, P.sing, 'go', 3);
  count(81, 82, 83);

  // ── Round 2: 84–132, you sing ──────────────────────────────────────────
  melody(84, 0, 16, { target: true, ghost: true });
  bars(84, MINOR, 'band');
  bells(84 + 11 * 3 + 1, 'C', { vel: 0.32 });
  bells(84 + 15 * 3 + 1, 'B7', { down: true, vel: 0.32 });

  // ── Interlude: 132–144 ─────────────────────────────────────────────────
  bars(132, ['Em', 'Em', 'Em', 'Em'], 'soft', { pad: false });
  round(132, R.echo);
  prompt(132, P.echo, 'listen', 3);
  count(141, 142, 143);

  // ── Round 3: 144–216, call and response in four-bar phrases ────────────
  [[0, 4], [8, 12], [12, 16]].forEach(([from, to], k) => {
    const call = 144 + k * 24;
    const answer = call + 12;
    const chords = MINOR.slice(from, to);
    melody(call, from, to, { auto: true });
    bars(call, chords, 'soft', { from, after: chords[0], pad: false });
    melody(answer, from, to, { target: true });
    bars(answer, chords, 'band', { from, after: k === 2 ? 'B7' : MINOR[[8, 12, 0][k]] });
    prompt(answer - 2.5, P.yourTurn, 'go', 1.4);
    if (k < 2) prompt(answer + 9.5, P.listenShort, 'listen', 1.4);
  });

  // ── Finale: 216–222 turnaround, then the verse in E major ──────────────
  round(216, R.finale);
  prompt(216, P.major, 'go', 3);
  bars(216, ['B7', 'B7'], 'band', { after: 'E', level: 1.1 });
  count(219, 220, 221);
  melody(222, 0, 16, { target: true, ghost: true });
  bars(222, MAJOR, 'band', { after: 'E', level: 1.1 });
  bells(222 + 3 * 3 + 1, 'E', { vel: 0.3 });
  bells(222 + 7 * 3 + 1, 'A', { down: true, vel: 0.3 });
  bells(222 + 11 * 3 + 1, 'C', { vel: 0.34 });

  // The leading note finally resolves: one big E major chord, left to ring.
  note(270, E, 6, { target: true, final: true });
  strum(270, 'E', { vel: 1.05, spread: 0.07, ring: 6 });
  play('guitar', 270, 40, 6, 0.9);
  play('bass', 270, 40, 6, 1);
  CHORDS.E.pad.forEach((m) => play('accordion', 270, m, 5, 0.58, 0.3));
  [76, 80, 83, 88, 83, 88, 92, 100].forEach((m, i) => play('bell', 271 + i, m, 1.5, 0.45));
  strum(279, 'E', { vel: 0.45, spread: 0.12, ring: 4 });
  kit.celebrate(270);

  return kit.finish(284);
}
