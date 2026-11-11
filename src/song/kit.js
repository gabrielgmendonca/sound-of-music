// The arranger's toolkit shared by every song: note/backing builders, the
// guitar, bass, accordion and glockenspiel patterns, and the final conversion
// from beats to seconds. Each song file (doremi.js, edelweiss.js, …) writes
// its tune with these and returns `kit.finish(totalBeats)`.
//
// On-screen text is solfège only; no lyrics are stored anywhere.

import { NOTE_COLORS } from '../config.js';

// MIDI numbers for the octave the children sing in.
export const N = {
  B3: 59, C: 60, D: 62, Ds: 63, E: 64, F: 65, Fs: 66, G: 67, Gs: 68, A: 69, B: 71, C2: 72, D2: 74,
};

// pitch class -> [child index, is sharp]
const PITCH = {
  0: [0, 0], 1: [0, 1], 2: [1, 0], 3: [1, 1], 4: [2, 0], 5: [3, 0], 6: [3, 1],
  7: [4, 0], 8: [4, 1], 9: [5, 0], 10: [5, 1], 11: [6, 0],
};

// guitar: open-position shapes, low string → high string.
// bass:   [root, fifth] for the upright.  pad: close voicing for the accordion.
export const CHORDS = {
  C: { guitar: [48, 52, 55, 60, 64], bass: [36, 43], pad: [55, 60, 64] },
  G7: { guitar: [43, 47, 50, 55, 59, 65], bass: [43, 38], pad: [53, 59, 62] },
  G: { guitar: [43, 47, 50, 55, 59, 67], bass: [43, 38], pad: [55, 59, 62] },
  F: { guitar: [41, 48, 53, 57, 60, 65], bass: [41, 36], pad: [53, 57, 60] },
  Dm: { guitar: [50, 57, 62, 65], bass: [38, 45], pad: [53, 57, 62] },
  D7: { guitar: [50, 57, 60, 66], bass: [38, 45], pad: [54, 57, 60] },
  E7: { guitar: [40, 47, 52, 56, 59, 64], bass: [40, 47], pad: [56, 59, 62] },
  Am: { guitar: [45, 52, 57, 60, 64], bass: [45, 40], pad: [57, 60, 64] },
  Em: { guitar: [40, 47, 52, 55, 59, 64], bass: [40, 47], pad: [55, 59, 64] },
  E: { guitar: [40, 47, 52, 56, 59, 64], bass: [40, 47], pad: [56, 59, 64] },
  A: { guitar: [45, 52, 57, 61, 64], bass: [45, 40], pad: [57, 61, 64] },
  Cmaj7: { guitar: [48, 52, 55, 59, 64], bass: [36, 43], pad: [55, 59, 64] },
  B7: { guitar: [47, 51, 57, 59, 66], bass: [35, 42], pad: [54, 57, 63] },
};

export const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);
export const G_MAJOR = new Set([0, 2, 4, 6, 7, 9, 11]); // also E minor

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

/**
 * bpm:   quarter notes per minute.   meter: beats per bar (4 or 3).
 * scale: pitch classes the walking bass may step on.
 */
export function createKit({ bpm, meter = 4, text, seed = 1965, scale = C_MAJOR }) {
  const notes = []; // melody notes (auto and/or tap targets)
  const backing = []; // accompaniment + count-in ticks
  const cues = []; // prompts, round labels, celebrations
  const rnd = mulberry32(seed);
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

  /** A run of [midi, beat, duration] notes, all with the same options. */
  const phrase = (start, list, opts) => list.forEach(([m, b, d]) => note(start + b, m, d, opts));

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

  /** Fingerpicked 4/4 bar: thumb on the bass strings, fingers rolling the trebles. */
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

  /** Folk 4/4 strum: down · down-up · (mute) up-down-up. */
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

  /**
   * Fingerpicked waltz bar: thumb on one, fingers answer on two and three.
   * `roll` turns the answer into running eighth notes.
   */
  const waltzPick = (beat, chord, { level = 1, variant = 0, roll = false } = {}) => {
    const c = CHORDS[chord];
    const top = c.guitar.slice(-3);
    const thumb = variant % 2 ? c.bass[1] + 12 : c.guitar[0];
    play('guitar', beat, thumb, 2.8, 0.74 * level);
    if (roll) {
      const order = variant % 4 === 3 ? [2, 1, 0, 1] : [0, 1, 2, 1];
      order.forEach((k, i) => play('guitar', beat + 1 + i * 0.5, top[k], 1.6, (i % 2 ? 0.36 : 0.46) * level));
    } else {
      play('guitar', beat + 1, top[0], 1.9, 0.38 * level);
      play('guitar', beat + 1, top[1], 1.9, 0.44 * level);
      play('guitar', beat + 2, top[1], 1.2, 0.36 * level);
      play('guitar', beat + 2, top[2], 1.2, 0.42 * level);
    }
  };

  /** Strummed waltz bar: bass string, then two light strokes (oom-pah-pah). */
  const waltzStrum = (beat, chord, { level = 1, variant = 0, ring = 0.8 } = {}) => {
    const c = CHORDS[chord];
    play('guitar', beat, variant % 2 ? c.bass[1] + 12 : c.guitar[0], 2, 0.82 * level);
    strum(beat + 1, chord, { vel: 0.5 * level, strings: 4, ring });
    strum(beat + 2, chord, { vel: 0.44 * level, strings: 4, ring });
    if (variant % 4 === 3) strum(beat + 2.5, chord, { up: true, vel: 0.32 * level, ring: ring * 0.8 });
  };

  // ── Upright bass, accordion, glockenspiel ───────────────────────────────

  /** Step into a root from a scale tone below it. */
  const below = (target) => (scale.has((target - 2 + 120) % 12) ? target - 2 : target - 1);

  const bassBar = (beat, chord, next, { level = 1, walk = true } = {}) => {
    const [a, b] = split(chord);
    play('bass', beat, CHORDS[a].bass[0], 1.7, 0.9 * level);
    play('bass', beat + 2, CHORDS[b].bass[a === b ? 1 : 0], walk ? 0.95 : 1.7, 0.72 * level);
    const target = next ? CHORDS[split(next)[0]].bass[0] : null;
    if (walk && target != null && target !== CHORDS[b].bass[0]) {
      play('bass', beat + 3, below(target), 0.9, 0.62 * level);
    }
  };

  /** Waltz bass: one note per bar, root and fifth taking turns, optional lead-in. */
  const waltzBass = (beat, chord, next, { level = 1, variant = 0, walk = false } = {}) => {
    const c = CHORDS[chord];
    const target = next ? CHORDS[next].bass[0] : null;
    const leadIn = walk && target != null && target !== c.bass[0];
    play('bass', beat, c.bass[variant % 2], leadIn ? 1.9 : 2.7, 0.9 * level);
    if (leadIn) play('bass', beat + 2, below(target), 0.9, 0.6 * level);
  };

  const padBar = (beat, chord, level = 0.3) => {
    const [a, b] = split(chord);
    const vel = level * 1.7; // the accordion speaks softly below ~0.4
    if (a === b) CHORDS[a].pad.forEach((m) => play('accordion', beat, m, meter - 0.1, vel, 0.3));
    else [a, b].forEach((ch, h) => CHORDS[ch].pad.forEach((m) => play('accordion', beat + h * 2, m, 1.95, vel, 0.3)));
  };

  /** A glockenspiel answer under a held melody note. */
  const bells = (beat, chord, { down = false, vel = 0.34, step = 0.5 } = {}) => {
    const p = CHORDS[split(chord)[0]].pad;
    let run = [p[0] + 12, p[1] + 12, p[2] + 12, p[0] + 24];
    if (down) run = [p[2] + 24, p[1] + 24, p[0] + 24, p[2] + 12];
    run.forEach((m, i) => play('bell', beat + i * step, m, 1.2, vel * (1 - i * 0.06)));
  };

  const count = (...beats) => beats.forEach((beat) => backing.push({ beat, inst: 'sfx', name: 'count' }));
  const prompt = (beat, msg, tone = 'info', duration = 3) => cues.push({ beat, kind: 'prompt', text: msg, tone, duration });
  const round = (beat, label) => cues.push({ beat, kind: 'round', label });
  const celebrate = (beat) => cues.push({ beat, kind: 'celebrate' });

  const finish = (totalBeats) => {
    const spb = 60 / bpm;
    const toTime = (e) => { e.t = e.beat * spb; if (e.dur != null) e.len = e.dur * spb; return e; };
    notes.forEach(toTime); backing.forEach(toTime); cues.forEach(toTime);
    const byTime = (a, b) => a.t - b.t;
    notes.sort(byTime); backing.sort(byTime); cues.sort(byTime);
    return {
      spb,
      meter,
      notes,
      backing,
      cues,
      targets: notes.filter((n) => n.target),
      duration: totalBeats * spb,
    };
  };

  return {
    note, phrase, play, split, strum, pickBar, strumBar, waltzPick, waltzStrum,
    bassBar, waltzBass, padBar, bells, count, prompt, round, celebrate, finish,
  };
}
