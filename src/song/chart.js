// The song, as data. Everything is authored in beats (quarter note = 1) and
// converted to seconds at the end. See docs/PLAN.md → "Song arrangement".
//
// On-screen text is solfège only; no lyrics are stored anywhere.

import { GAME, NOTE_COLORS } from '../config.js';

const C = 60, D = 62, E = 64, F = 65, Fs = 66, G = 67, Gs = 68, A = 69, B = 71, C2 = 72, D2 = 74;

// pitch class -> [child index, label]
const PITCH = {
  0: [0, 'Do'], 2: [1, 'Re'], 4: [2, 'Mi'], 5: [3, 'Fa'], 6: [3, 'Fi'],
  7: [4, 'So'], 8: [4, 'Si'], 9: [5, 'La'], 11: [6, 'Ti'],
};

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
const CHORUS_CHORDS = ['C', 'C', 'G7', 'G7', 'C', 'C', 'F', 'F', 'C', 'F', 'D7', 'G', 'E7', 'Am', ['F', 'G7'], 'C'];

const CHORDS = {
  C: { bass: [36, 43], guitar: [52, 55, 60] },
  G7: { bass: [43, 38], guitar: [53, 55, 59] },
  G: { bass: [43, 38], guitar: [55, 59, 62] },
  F: { bass: [41, 36], guitar: [53, 57, 60] },
  D7: { bass: [38, 45], guitar: [54, 57, 60] },
  E7: { bass: [40, 47], guitar: [56, 59, 62] },
  Am: { bass: [45, 40], guitar: [57, 60, 64] },
};

export function buildChart() {
  const notes = []; // melody notes (auto and/or tap targets)
  const backing = []; // accompaniment + count-in ticks
  const cues = []; // prompts, round labels, celebrations
  let nextId = 0;

  const note = (beat, midi, dur, opts = {}) => {
    const [step, label] = PITCH[midi % 12];
    notes.push({
      id: nextId++, beat, dur, midi, step, label, color: NOTE_COLORS[step],
      auto: false, target: false, ghost: false, final: false, ...opts,
    });
  };

  // Oom-pah: bass on 1 & 3, guitar chord on 2 & 4.
  const bar = (beat, chord, { soft = false } = {}) => {
    const [a, b] = Array.isArray(chord) ? chord : [chord, chord];
    const v = soft ? 0.6 : 1;
    const split = a !== b;
    backing.push({ beat, dur: 1.6, inst: 'bass', midi: CHORDS[a].bass[0], vel: 0.9 * v });
    backing.push({ beat: beat + 2, dur: 1.6, inst: 'bass', midi: CHORDS[b].bass[split ? 0 : 1], vel: 0.75 * v });
    for (const [off, ch] of [[1, a], [3, b]]) {
      CHORDS[ch].guitar.forEach((m, i) => {
        backing.push({ beat: beat + off + i * 0.035, dur: 1.2, inst: 'guitar', midi: m, vel: 0.55 * v });
      });
    }
  };
  const count = (...beats) => beats.forEach((beat) => backing.push({ beat, inst: 'sfx', name: 'count' }));
  const prompt = (beat, text, tone = 'info', duration = 3) => cues.push({ beat, kind: 'prompt', text, tone, duration });
  const round = (beat, label) => cues.push({ beat, kind: 'round', label });

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
    CHORUS_CHORDS.forEach((ch, i) => bar(start + i * 4, ch));
  };

  // ── Intro: 0–16 ────────────────────────────────────────────────────────
  ['C', 'Am', 'F', 'G7'].forEach((ch, i) => bar(i * 4, ch, { soft: i < 2 }));
  round(0, 'Round 1 · Listen');
  prompt(0.5, 'Tap anywhere when a bubble reaches the ring', 'info', 4);
  prompt(9, 'She sings — you tap the bubbles!', 'listen', 3);
  count(12, 13, 14, 15);

  // ── Round 1: 16–80 ─────────────────────────────────────────────────────
  chorus(16, 'listen');

  // ── Interlude: 80–88 ───────────────────────────────────────────────────
  bar(80, 'C'); bar(84, 'G7');
  round(80, 'Round 2 · Sing');
  prompt(80, 'Now you sing — tap every note!', 'go', 3.5);
  count(84, 85, 86, 87);

  // ── Round 2: 88–152 ────────────────────────────────────────────────────
  chorus(88, 'sing');

  // ── Interlude: 152–160 ─────────────────────────────────────────────────
  bar(152, 'C'); bar(156, 'G7');
  round(152, 'Round 3 · Echo');
  prompt(152, 'Echo time — listen first…', 'listen', 3.5);
  count(156, 157, 158, 159);

  // ── Round 3: 160–192, call and response ────────────────────────────────
  const CALL_1 = [[G, 0, 1], [C, 1, 1], [A, 2, 1], [F, 3, 1], [E, 4, 1], [C, 5, 1], [D, 6, 2]];
  const CALL_2 = [[G, 0, 1], [C, 1, 1], [A, 2, 1], [B, 3, 1], [C2, 4, 1], [D2, 5, 1], [C2, 6, 2]];
  const phrase = (start, call, opts) => call.forEach(([m, b, d]) => note(start + b, m, d, opts));
  phrase(160, CALL_1, { auto: true }); bar(160, ['C', 'F']); bar(164, ['C', 'G7']);
  phrase(168, CALL_1, { target: true }); bar(168, ['C', 'F']); bar(172, ['C', 'G7']);
  phrase(176, CALL_2, { auto: true }); bar(176, ['C', 'G7']); bar(180, 'C');
  phrase(184, CALL_2, { target: true }); bar(184, ['C', 'G7']); bar(188, 'C');
  prompt(166.5, 'Your turn!', 'go', 1.6);
  prompt(175, 'Listen…', 'listen', 1.6);
  prompt(182.5, 'Your turn!', 'go', 1.6);

  // ── Finale: 192–216 ────────────────────────────────────────────────────
  round(192, 'Finale');
  prompt(192, 'All together — up the scale!', 'go', 3);
  bar(192, 'G7'); count(192, 193, 194, 195);
  [C, D, E, F, G, A, B, C2].forEach((m, i) => note(196 + i, m, 1, { target: true }));
  bar(196, 'C'); bar(200, ['F', 'G7']);
  note(204, G, 3.5, { target: true }); bar(204, 'G7');
  note(208, C2, 6, { target: true, final: true });
  bar(208, 'C'); bar(212, 'C', { soft: true });
  // Sparkle run under the last note.
  [72, 76, 79, 84, 79, 84, 88, 96].forEach((m, i) =>
    backing.push({ beat: 208.5 + i * 0.5, dur: 1.5, inst: 'bell', midi: m, vel: 0.5 }));
  cues.push({ beat: 208, kind: 'celebrate' });

  const totalBeats = 218;
  const spb = 60 / GAME.bpm;
  const toTime = (e) => { e.t = e.beat * spb; if (e.dur != null) e.len = e.dur * spb; return e; };
  notes.forEach(toTime); backing.forEach(toTime); cues.forEach(toTime);
  const byTime = (a, b) => a.t - b.t;
  notes.sort(byTime); backing.sort(byTime); cues.sort(byTime);

  return {
    spb,
    notes,
    backing,
    cues,
    targets: notes.filter((n) => n.target),
    duration: totalBeats * spb,
  };
}
