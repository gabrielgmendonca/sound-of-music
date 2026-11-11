// Stage 1 — "Do-Re-Mi". C major, 4/4. See docs/PLAN.md → "Song arrangements".

import { createKit, CHORDS, N } from './kit.js';

export const BPM = 116;

const { C, D, E, F, Fs, G, Gs, A, B, C2, D2 } = N;

// The chorus: eight lines of eight beats. [midi, beat-in-line, duration]
const LINES = [
  [[C, 0, 1.5], [D, 1.5, 0.5], [E, 2, 1.5], [C, 3.5, 0.5], [E, 4, 1], [C, 5, 1], [E, 6, 2]],
  [[D, 0, 1.5], [E, 1.5, 0.5], [F, 2, 0.5], [F, 2.5, 0.5], [E, 3, 0.5], [D, 3.5, 0.5], [F, 4, 4]],
  [[E, 0, 1.5], [F, 1.5, 0.5], [G, 2, 1.5], [E, 3.5, 0.5], [G, 4, 1], [E, 5, 1], [G, 6, 2]],
  [[F, 0, 1.5], [G, 1.5, 0.5], [A, 2, 0.5], [A, 2.5, 0.5], [G, 3, 0.5], [F, 3.5, 0.5], [A, 4, 4]],
  [[G, 0, 1.5], [C, 1.5, 0.5], [D, 2, 0.5], [E, 2.5, 0.5], [F, 3, 0.5], [G, 3.5, 0.5], [A, 4, 4]],
  [[A, 0, 1.5], [D, 1.5, 0.5], [E, 2, 0.5], [Fs, 2.5, 0.5], [G, 3, 0.5], [A, 3.5, 0.5], [B, 4, 4]],
  [[B, 0, 1.5], [E, 1.5, 0.5], [Fs, 2, 0.5], [Gs, 2.5, 0.5], [A, 3, 0.5], [B, 3.5, 0.5], [C2, 4, 3], [C2, 7, 0.5], [B, 7.5, 0.5]],
  [[A, 0, 1], [F, 1, 1], [B, 2, 1], [G, 3, 1], [C2, 4, 4]],
];
// Index of each line's long closing note, and whether its first note is a "name" note.
const CLOSE = [6, 6, 6, 6, 6, 6, 6, 4];
const HAS_NAME = [1, 1, 1, 1, 1, 1, 1, 0];

// One chord per bar of the chorus; arrays are half-bar splits.
const CHORUS_CHORDS = ['C', 'C', 'Dm', 'G7', 'C', 'C', 'F', 'F', 'C', 'F', 'D7', 'G', 'E7', 'Am', ['F', 'G7'], 'C'];


export function build(text) {
  const kit = createKit({ bpm: BPM, meter: 4, text, seed: 1965 });
  const { note, phrase, play, split, strum, pickBar, strumBar, bassBar, padBar, bells, count, prompt, round } = kit;

  const chorus = (start, mode) => {
    LINES.forEach((line, li) => {
      line.forEach(([midi, b, dur], ni) => {
        const beat = start + li * 8 + b;
        if (mode === 'listen') {
          const isTarget = (ni === 0 && HAS_NAME[li]) || ni === CLOSE[li];
          note(beat, midi, dur, { auto: true, target: isTarget });
        } else {
          note(beat, midi, dur, { target: true, ghost: true });
        }
      });
    });
    CHORUS_CHORDS.forEach((ch, i) => {
      const beat = start + i * 4;
      const next = CHORUS_CHORDS[i + 1] || 'C';
      const li = i >> 1;
      // The second half of each chorus opens up a little.
      const lift = li >= 4 ? 1.08 : 1;
      if (mode === 'listen') {
        // Verse 1: fingerpicked guitar; bass and accordion slip in halfway.
        pickBar(beat, ch, { level: lift, variant: i });
        if (li >= 4) {
          bassBar(beat, ch, next, { level: 0.7, walk: li >= 6 });
          padBar(beat, ch, 0.2);
        } else {
          play('bass', beat, CHORDS[split(ch)[0]].bass[0], 2.5, 0.55);
        }
      } else {
        // Verse 2: full strumming band.
        strumBar(beat, ch, { level: lift });
        bassBar(beat, ch, next, { level: lift });
        padBar(beat, ch, 0.28);
      }
      // Glockenspiel answers the long note that closes most lines.
      const holdsWholeBar = i % 2 === 1 && [1, 3, 4, 5].includes(li);
      if (holdsWholeBar) bells(beat + 1, ch, { down: mode !== 'listen', vel: mode === 'listen' ? 0.3 : 0.36 });
      if (i === 15) bells(beat + 1, 'C', { vel: 0.4 });
    });
  };

  const R = text.stages.doremi.rounds;
  const P = text.prompts;

  // ── Intro: 0–16 ────────────────────────────────────────────────────────
  // Guitar alone, then the bass joins, then a strummed turnaround.
  pickBar(0, 'C', { level: 0.8, variant: 0 });
  pickBar(4, 'Am', { level: 0.85, variant: 1 });
  pickBar(8, 'F', { level: 0.95, variant: 2 });
  play('bass', 8, 41, 3, 0.6);
  strum(12, 'G7', { vel: 0.7, spread: 0.05, ring: 2 });
  strum(14, 'G7', { vel: 0.5, strings: 4, ring: 1 });
  strum(15, 'G7', { vel: 0.55, strings: 5, ring: 0.9 });
  strum(15.5, 'G7', { up: true, vel: 0.4, ring: 0.6 });
  play('bass', 12, 43, 1.8, 0.7);
  play('bass', 14, 38, 0.9, 0.6);
  play('bass', 15, 35, 0.9, 0.6);
  round(0, R.listen);
  prompt(0.5, P.howTo, 'info', 4);
  prompt(9, P.listen, 'listen', 3);
  count(12, 13, 14, 15);

  // ── Round 1: 16–80 ─────────────────────────────────────────────────────
  chorus(16, 'listen');

  // ── Interlude: 80–88 ───────────────────────────────────────────────────
  strumBar(80, 'C'); bassBar(80, 'C', 'G7'); padBar(80, 'C', 0.24);
  strumBar(84, 'G7', { level: 1.1 }); bassBar(84, 'G7', 'C'); padBar(84, 'G7', 0.26);
  round(80, R.sing);
  prompt(80, P.sing, 'go', 3.5);
  count(84, 85, 86, 87);

  // ── Round 2: 88–152 ────────────────────────────────────────────────────
  chorus(88, 'sing');

  // ── Interlude: 152–160 ─────────────────────────────────────────────────
  pickBar(152, 'C', { variant: 0 }); bassBar(152, 'C', 'G7', { level: 0.8 }); padBar(152, 'C', 0.22);
  pickBar(156, 'G7', { variant: 3 }); bassBar(156, 'G7', 'C', { level: 0.8 }); padBar(156, 'G7', 0.22);
  round(152, R.echo);
  prompt(152, P.echo, 'listen', 3.5);
  count(156, 157, 158, 159);

  // ── Round 3: 160–192, call and response ────────────────────────────────
  // Her call is fingerpicked and gentle; the children's answer gets the band.
  const CALL_1 = [[G, 0, 1], [C, 1, 1], [A, 2, 1], [F, 3, 1], [E, 4, 1], [C, 5, 1], [D, 6, 2]];
  const CALL_2 = [[G, 0, 1], [C, 1, 1], [A, 2, 1], [B, 3, 1], [C2, 4, 1], [D2, 5, 1], [C2, 6, 2]];
  const echoBars = (start, chords, answer) => chords.forEach((ch, i) => {
    const beat = start + i * 4;
    const next = chords[i + 1] || 'C';
    if (answer) { strumBar(beat, ch); bassBar(beat, ch, next); padBar(beat, ch, 0.28); }
    else { pickBar(beat, ch, { variant: i + 1 }); bassBar(beat, ch, next, { level: 0.7, walk: false }); padBar(beat, ch, 0.18); }
  });
  phrase(160, CALL_1, { auto: true }); echoBars(160, [['C', 'F'], ['C', 'G7']], false);
  phrase(168, CALL_1, { target: true }); echoBars(168, [['C', 'F'], ['C', 'G7']], true);
  phrase(176, CALL_2, { auto: true }); echoBars(176, [['C', 'G7'], 'C'], false);
  phrase(184, CALL_2, { target: true }); echoBars(184, [['C', 'G7'], 'C'], true);
  prompt(166.5, P.yourTurn, 'go', 1.6);
  prompt(175, P.listenShort, 'listen', 1.6);
  prompt(182.5, P.yourTurn, 'go', 1.6);

  // ── Finale: 192–216 ────────────────────────────────────────────────────
  round(192, R.finale);
  prompt(192, P.finale, 'go', 3);
  strumBar(192, 'G7', { level: 1.1 }); bassBar(192, 'G7', 'C'); padBar(192, 'G7', 0.3);
  count(192, 193, 194, 195);
  [C, D, E, F, G, A, B, C2].forEach((m, i) => note(196 + i, m, 1, { target: true }));
  strumBar(196, 'C', { level: 1.1 }); bassBar(196, 'C', 'F'); padBar(196, 'C', 0.3);
  strumBar(200, ['F', 'G7'], { level: 1.15 }); bassBar(200, ['F', 'G7'], 'G7'); padBar(200, ['F', 'G7'], 0.32);
  // Held dominant: strums quicken into the last chord.
  note(204, G, 3.5, { target: true });
  [0, 1, 2, 2.5, 3, 3.25, 3.5, 3.75].forEach((b, i) =>
    strum(204 + b, 'G7', { up: i > 2 && i % 2 === 1, vel: 0.55 + i * 0.06, strings: 5, ring: 0.7 }));
  play('bass', 204, 43, 3.8, 0.95);
  padBar(204, 'G7', 0.34);
  // The last chord: one big slow strum, left to ring.
  note(208, C2, 6, { target: true, final: true });
  strum(208, 'C', { vel: 1.05, spread: 0.06, ring: 6 });
  play('guitar', 208, 36, 6, 0.9);
  play('bass', 208, 36, 6, 1);
  CHORDS.C.pad.forEach((m) => play('accordion', 208, m, 4, 0.6, 0.3));
  [72, 76, 79, 84, 79, 84, 88, 96].forEach((m, i) => play('bell', 208.5 + i * 0.5, m, 1.5, 0.5));
  strum(213, 'C', { vel: 0.5, spread: 0.11, ring: 4 });
  play('guitar', 214.2, 72, 3, 0.45);
  kit.celebrate(208);

  return kit.finish(218);
}
