// Stage 2 — "Edelweiss". C major, 3/4, a slow waltz at sunset.
// Form: A A' B A' (32 bars). See docs/PLAN.md → "Song arrangements".

import { createKit, CHORDS, N } from './kit.js';

export const BPM = 108;

const { E, F, G, A, B, C2, D2 } = N;

// One entry per bar: [midi, beat-in-bar, duration]
const A1 = [
  [[E, 0, 2], [G, 2, 1]], [[D2, 0, 3]], [[C2, 0, 2], [G, 2, 1]], [[F, 0, 3]],
  [[E, 0, 2], [E, 2, 1]], [[E, 0, 1], [F, 1, 1], [G, 2, 1]], [[A, 0, 3]], [[G, 0, 3]],
];
const A2 = [
  [[E, 0, 2], [G, 2, 1]], [[D2, 0, 3]], [[C2, 0, 2], [G, 2, 1]], [[F, 0, 3]],
  [[E, 0, 2], [G, 2, 1]], [[G, 0, 1], [A, 1, 1], [B, 2, 1]], [[C2, 0, 5]], [],
];
const BRIDGE = [
  [[D2, 0, 2], [G, 2, 0.5], [G, 2.5, 0.5]], [[B, 0, 1], [A, 1, 1], [G, 2, 1]], [[E, 0, 2], [G, 2, 1]], [[C2, 0, 3]],
  [[A, 0, 2], [C2, 2, 1]], [[D2, 0, 2], [C2, 2, 1]], [[B, 0, 3]], [[G, 0, 3]],
];
const BARS = [...A1, ...A2, ...BRIDGE, ...A2];

const BAR_CHORDS = [
  'C', 'G7', 'C', 'F', 'C', 'Am', 'Dm', 'G7',
  'C', 'G7', 'C', 'F', 'C', 'G7', 'C', 'C',
  'G7', 'G7', 'C', 'C', 'F', 'D7', 'G', 'G7',
  'C', 'G7', 'C', 'F', 'C', 'G7', 'C', 'C',
];

export function build(text) {
  const kit = createKit({ bpm: BPM, meter: 3, text, seed: 1959 });
  const { note, play, strum, waltzPick, waltzStrum, waltzBass, padBar, bells, count, prompt, round } = kit;
  const R = text.stages.edelweiss.rounds;
  const P = text.prompts;

  const chorus = (start, mode) => {
    BARS.forEach((bar, i) => {
      const beat = start + i * 3;
      const ch = BAR_CHORDS[i];
      const next = BAR_CHORDS[i + 1] || 'C';
      const repeat = i > 0 && BAR_CHORDS[i - 1] === ch ? 1 : 0;
      const bridge = i >= 16 && i < 24;

      bar.forEach(([midi, b, dur]) => {
        // Listening, you waltz along on the "one"; singing, every note is yours.
        if (mode === 'listen') note(beat + b, midi, dur, { auto: true, target: b === 0 });
        else note(beat + b, midi, dur, { target: true, ghost: true });
      });

      if (mode === 'listen') {
        // Guitar alone, then the bass; the bridge rolls and the accordion sighs in.
        waltzPick(beat, ch, { variant: i, roll: bridge, level: bridge ? 1.05 : 1 });
        if (i >= 8) waltzBass(beat, ch, next, { level: 0.7, variant: repeat });
        if (i >= 16) padBar(beat, ch, bridge ? 0.2 : 0.17);
      } else {
        const lift = bridge ? 1.08 : 1;
        waltzStrum(beat, ch, { variant: i, level: lift, ring: 1.1 });
        waltzBass(beat, ch, next, { level: lift, variant: repeat, walk: true });
        padBar(beat, ch, 0.26);
      }
      // Glockenspiel answers the notes that fill a whole bar.
      const held = bar.length === 1 && bar[0][2] >= 3;
      if (held && (mode !== 'listen' || i >= 8)) {
        bells(beat + 1, ch, { down: i % 8 === 3, vel: mode === 'listen' ? 0.26 : 0.34 });
      }
    });
  };

  // ── Intro: 8 bars, 0–24 ────────────────────────────────────────────────
  ['C', 'Am', 'F', 'G7', 'C', 'Am', 'F'].forEach((ch, i) => {
    waltzPick(i * 3, ch, { level: 0.8 + i * 0.03, variant: i });
    if (i >= 4) play('bass', i * 3, CHORDS[ch].bass[0], 2.6, 0.55);
  });
  strum(21, 'G7', { vel: 0.6, spread: 0.06, ring: 2.6 });
  play('bass', 21, 43, 2.6, 0.6);
  round(0, R.listen);
  prompt(0.5, P.howTo, 'info', 4);
  prompt(10, P.waltz, 'listen', 4);
  count(21, 22, 23);

  // ── Round 1: 24–120, she sings ─────────────────────────────────────────
  chorus(24, 'listen');

  // ── Interlude: 120–126 ─────────────────────────────────────────────────
  waltzStrum(120, 'C', { variant: 0, ring: 1.1 }); waltzBass(120, 'C', 'G7'); padBar(120, 'C', 0.22);
  waltzStrum(123, 'G7', { variant: 3, level: 1.05, ring: 1.1 }); waltzBass(123, 'G7', 'C', { walk: true }); padBar(123, 'G7', 0.24);
  round(120, R.sing);
  prompt(120, P.sing, 'go', 3);
  count(123, 124, 125);

  // ── Round 2: 126–222, you sing ─────────────────────────────────────────
  chorus(126, 'sing');

  // ── Finale: the last line once more, then the long last note ───────────
  round(222, R.finale);
  prompt(222, P.onceMore, 'go', 3);
  waltzStrum(222, 'G7', { variant: 1, level: 1.05, ring: 1.1 }); waltzBass(222, 'G7', 'C', { walk: true }); padBar(222, 'G7', 0.26);
  count(222, 223, 224);
  [[E, 0, 2], [G, 2, 1], [G, 3, 1], [A, 4, 1], [B, 5, 1]].forEach(([m, b, d]) => note(225 + b, m, d, { target: true }));
  waltzStrum(225, 'C', { level: 1.1, ring: 1.3 }); waltzBass(225, 'C', 'G7'); padBar(225, 'C', 0.3);
  // Held dominant: one stroke per beat, growing into the last chord.
  [0, 1, 2].forEach((b, i) => strum(228 + b, 'G7', { vel: 0.6 + i * 0.1, strings: 5, ring: 0.9 }));
  play('bass', 228, 43, 2.8, 0.95);
  padBar(228, 'G7', 0.32);
  note(231, C2, 6, { target: true, final: true });
  strum(231, 'C', { vel: 1.0, spread: 0.07, ring: 6 });
  play('guitar', 231, 36, 6, 0.85);
  play('bass', 231, 36, 6, 1);
  CHORDS.C.pad.forEach((m) => play('accordion', 231, m, 5, 0.55, 0.3));
  [72, 76, 79, 84, 79, 84, 88, 96].forEach((m, i) => play('bell', 231.5 + i * 0.5, m, 1.5, 0.45));
  strum(236, 'C', { vel: 0.45, spread: 0.12, ring: 4 });
  play('guitar', 237.2, 72, 3, 0.4);
  kit.celebrate(231);

  return kit.finish(241);
}
