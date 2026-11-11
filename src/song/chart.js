// The song, as data. Everything is authored in beats (quarter note = 1) and
// converted to seconds at the end. See docs/PLAN.md → "Song arrangement".
//
// On-screen text is solfège only; no lyrics are stored anywhere.

import { GAME, NOTE_COLORS } from '../config.js';
import { strings } from '../i18n.js';

const C = 60, D = 62, E = 64, F = 65, Fs = 66, G = 67, Gs = 68, A = 69, B = 71, C2 = 72, D2 = 74;

// pitch class -> [child index, is sharp]
const PITCH = {
  0: [0, 0], 2: [1, 0], 4: [2, 0], 5: [3, 0], 6: [3, 1],
  7: [4, 0], 8: [4, 1], 9: [5, 0], 11: [6, 0],
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
const CHORUS_CHORDS = ['C', 'C', 'Dm', 'G7', 'C', 'C', 'F', 'F', 'C', 'F', 'D7', 'G', 'E7', 'Am', ['F', 'G7'], 'C'];

// guitar: open-position shapes, low string → high string.
// bass:   [root, fifth] for the upright.  pad: close voicing for the accordion.
const CHORDS = {
  C: { guitar: [48, 52, 55, 60, 64], bass: [36, 43], pad: [55, 60, 64] },
  G7: { guitar: [43, 47, 50, 55, 59, 65], bass: [43, 38], pad: [53, 59, 62] },
  G: { guitar: [43, 47, 50, 55, 59, 67], bass: [43, 38], pad: [55, 59, 62] },
  F: { guitar: [41, 48, 53, 57, 60, 65], bass: [41, 36], pad: [53, 57, 60] },
  Dm: { guitar: [50, 57, 62, 65], bass: [38, 45], pad: [53, 57, 62] },
  D7: { guitar: [50, 57, 60, 66], bass: [38, 45], pad: [54, 57, 60] },
  E7: { guitar: [40, 47, 52, 56, 59, 64], bass: [40, 47], pad: [56, 59, 62] },
  Am: { guitar: [45, 52, 57, 60, 64], bass: [45, 40], pad: [57, 60, 64] },
};
const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);

// Small deterministic RNG so the "human" touches are the same every play.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildChart(text = strings()) {
  const notes = []; // melody notes (auto and/or tap targets)
  const backing = []; // accompaniment + count-in ticks
  const cues = []; // prompts, round labels, celebrations
  const rnd = mulberry32(1965);
  let nextId = 0;

  const note = (beat, midi, dur, opts = {}) => {
    const [step, sharp] = PITCH[midi % 12];
    notes.push({
      id: nextId++, beat, dur, midi, step,
      label: text.solfege[step] + (sharp ? text.sharp : ''),
      color: NOTE_COLORS[step],
      auto: false, target: false, ghost: false, final: false, ...opts,
    });
  };

  // Every backing note gets a few ms of timing drift and a little velocity
  // variation, so nothing lands machine-perfect.
  const play = (inst, beat, midi, dur, vel, loose = 1) => {
    backing.push({
      inst, midi, dur,
      beat: Math.max(0, beat + (rnd() - 0.5) * 0.022 * loose),
      vel: vel * (0.9 + rnd() * 0.2),
    });
  };
  const split = (chord) => (Array.isArray(chord) ? chord : [chord, chord]);

  // ── Guitar ──────────────────────────────────────────────────────────────

  /** One strum stroke: strings sound one after another, like a real hand. */
  const strum = (beat, chord, { up = false, vel = 0.6, strings: n = 6, spread = 0.03, ring = 1.6 } = {}) => {
    let shape = CHORDS[chord].guitar;
    if (up) shape = shape.slice(-Math.min(4, n)).reverse();
    else shape = shape.slice(-n);
    shape.forEach((m, i) => {
      // Downstrokes dig into the bass strings; upstrokes catch the trebles.
      const v = vel * (up ? 1 - i * 0.12 : 1 - i * 0.05);
      play('guitar', beat + i * spread * (0.8 + rnd() * 0.4), m, ring, v, 0.5);
    });
  };

  /** Fingerpicked bar: thumb on the bass strings, fingers rolling the trebles. */
  const pickBar = (beat, chord, { level = 1, variant = 0 } = {}) => {
    const [a, b] = split(chord);
    [a, b].forEach((ch, h) => {
      const shape = CHORDS[ch].guitar;
      const top = shape.slice(-3);
      const thumb = h === 0 || a !== b ? shape[0] : shape[1];
      const order = variant % 2 ? [1, 2, 0] : [0, 2, 1];
      const t = beat + h * 2;
      play('guitar', t, thumb, 2.4, 0.74 * level);
      play('guitar', t + 0.5, top[order[0]], 2, 0.4 * level);
      play('guitar', t + 1, top[order[1]], 2, 0.52 * level);
      if (variant % 4 === 3 && h === 1) {
        // Every fourth bar ends with a little pinch instead of a single note.
        play('guitar', t + 1.5, top[0], 1.5, 0.36 * level);
        play('guitar', t + 1.5, top[2], 1.5, 0.42 * level);
      } else {
        play('guitar', t + 1.5, top[order[2]], 1.6, 0.42 * level);
      }
    });
  };

  /** Folk strum: down · down-up · (mute) up-down-up. */
  const strumBar = (beat, chord, { level = 1 } = {}) => {
    const [a, b] = split(chord);
    strum(beat, a, { vel: 0.8 * level, ring: 1.8 });
    strum(beat + 1, a, { vel: 0.5 * level, strings: 4, ring: 0.9 });
    strum(beat + 1.5, a, { up: true, vel: 0.4 * level, ring: 0.9 });
    play('guitarMute', beat + 2, CHORDS[b].guitar[1], 0.2, 0.62 * level);
    strum(beat + 2.5, b, { up: true, vel: 0.42 * level, ring: 0.8 });
    strum(beat + 3, b, { vel: 0.58 * level, strings: 5, ring: 0.9 });
    strum(beat + 3.5, b, { up: true, vel: 0.38 * level, ring: 0.8 });
  };

  // ── Upright bass, accordion, glockenspiel ───────────────────────────────

  const bassBar = (beat, chord, next, { level = 1, walk = true } = {}) => {
    const [a, b] = split(chord);
    play('bass', beat, CHORDS[a].bass[0], 1.7, 0.9 * level);
    play('bass', beat + 2, CHORDS[b].bass[a === b ? 1 : 0], walk ? 0.95 : 1.7, 0.72 * level);
    const target = next ? CHORDS[split(next)[0]].bass[0] : null;
    if (walk && target != null && target !== CHORDS[b].bass[0]) {
      // Step into the next chord's root from a scale tone below it.
      const below = C_MAJOR.has((target - 2 + 120) % 12) ? target - 2 : target - 1;
      play('bass', beat + 3, below, 0.9, 0.62 * level);
    }
  };

  const padBar = (beat, chord, level = 0.3) => {
    const [a, b] = split(chord);
    const vel = level * 1.7; // the accordion speaks softly below ~0.4
    if (a === b) CHORDS[a].pad.forEach((m) => play('accordion', beat, m, 3.9, vel, 0.3));
    else [a, b].forEach((ch, h) => CHORDS[ch].pad.forEach((m) => play('accordion', beat + h * 2, m, 1.95, vel, 0.3)));
  };

  /** A glockenspiel answer under a held melody note. */
  const bells = (beat, chord, { down = false, vel = 0.34 } = {}) => {
    const p = CHORDS[split(chord)[0]].pad;
    let run = [p[0] + 12, p[1] + 12, p[2] + 12, p[0] + 24];
    if (down) run = [p[2] + 24, p[1] + 24, p[0] + 24, p[2] + 12];
    run.forEach((m, i) => play('bell', beat + i * 0.5, m, 1.2, vel * (1 - i * 0.06)));
  };

  const count = (...beats) => beats.forEach((beat) => backing.push({ beat, inst: 'sfx', name: 'count' }));
  const prompt = (beat, msg, tone = 'info', duration = 3) => cues.push({ beat, kind: 'prompt', text: msg, tone, duration });
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

  const R = text.rounds;
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
  const phrase = (start, call, opts) => call.forEach(([m, b, d]) => note(start + b, m, d, opts));
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
