// Central, hand-editable settings. Everything a non-programmer might want to
// tweak for the gift lives here.

export const GIFT = {
  // Shown on the title screen.
  title: 'Do-Re-Mi Meadow',
  subtitle: 'Supresa musical de aniversário',
  // Shown on the final card after the song. Edit freely.
  recipient: 'querida',
  message:
    'Feliz aniversário! Aqui está um coral só pra você.',
  signature: 'Te amo',
};

export const GAME = {
  bpm: 116,
  // Judgment windows, in seconds either side of the note.
  perfectWindow: 0.075,
  goodWindow: 0.16,
  // How many seconds ahead cue bubbles appear in the HUD lane.
  cueLookahead: 2.0,
  // Extra manual latency offset in seconds (positive = judge taps as earlier).
  inputOffset: 0,
};

// Solfège steps. Index 0..6 = Do..Ti; each one belongs to one child.
// Child 0 is the eldest/tallest, child 6 the youngest/smallest.
export const SOLFEGE = ['Do', 'Re', 'Mi', 'Fa', 'So', 'La', 'Ti'];

// One colour per solfège step, shared by the HUD cues and each child's
// accent (ribbon / scarf / glow). Soft storybook rainbow.
export const NOTE_COLORS = [
  '#e8504a', // Do  – poppy red
  '#f28c38', // Re  – apricot
  '#f2c230', // Mi  – buttercup
  '#5fb760', // Fa  – meadow green
  '#3fa9d6', // So  – alpine sky
  '#5b6fd6', // La  – gentian blue
  '#a45fd0', // Ti  – crocus violet
];

// Where everyone stands. Y is up, units are metres, characters face +Z
// (towards the default camera). The ground is flat (y = 0) within
// STAGE.clearRadius of the origin.
export const STAGE = {
  clearRadius: 7,
  childSpacing: 0.95,
  childZ: 0,
  // Children are centred on x = 0: x = (i - 3) * childSpacing
  maria: { x: -4.1, z: 0.9, rotY: 0.75 },
};

export function childX(i) {
  return (i - 3) * STAGE.childSpacing;
}
