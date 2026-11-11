# Do-Re-Mi Meadow — plan

A private birthday gift: a short 3D rhythm game inspired by *The Sound of Music*
(1965) and its "Do-Re-Mi" number. Personal use only; never published or
distributed.

## Goals

| Requirement | Decision |
|---|---|
| Runs in browser incl. Android + iOS | Three.js (WebGL) + Web Audio, static site built with Vite. Touch-first, portrait and landscape. |
| Features "Do-Re-Mi" | Melody arranged in `src/song/chart.js` and **synthesised live** with Web Audio. No recordings shipped. On-screen text is solfège syllables only (Do, Re, Mi…), not the lyrics. |
| Pixar-inspired characters + backgrounds | Stylised, original characters built from rounded primitives (big heads, big eyes, squash & stretch). Storybook Alpine meadow. No actor likenesses. |
| Rhythm Heaven feel | Cue-driven timing, call-and-response, characters react to every hit/miss, sparse UI, a rank at the end. |
| Super Mario Run controls | One input: tap anywhere (or Space / click). |
| Gift | Editable birthday card at the end (`src/config.js` → `GIFT`). |
| Local-only tooling | All dependencies in `./node_modules`. Nothing global. |

## Game flow (~1 min 45 s)

1. **Title** — tap to start (this tap also unlocks audio on iOS/Android).
2. **Intro** (4 bars) — guitar vamp, count-in, one-line instruction.
3. **Round 1 "Listen"** — the governess sings the whole tune. The player taps
   only each line's name-note (Do, Re, Mi, Fa, So, La, Ti) and each line's long
   closing note. The matching child hops and sings.
4. **Round 2 "Sing"** — the player taps *every* melody note; the tune only
   sounds when you hit it.
5. **Round 3 "Echo"** — call and response: she sings "So Do La Fa Mi Do Re",
   you tap it back; then "So Do La Ti Do Re Do".
6. **Finale** — run up the scale, one child per note, big final Do, petals and
   balloons.
7. **Card** — rank (Rhythm-Heaven style: *Try Again / OK / Superb*), stats, and
   the birthday message. Replay button.

One child per solfège step (child 0 = Do = eldest … child 6 = Ti = youngest).
Each has an accent colour from `NOTE_COLORS`; HUD cue bubbles use the same
colour, so the player learns "red bubble = the tall one hops".

## Architecture

No framework. ES modules, one responsibility each.

```
index.html
src/
  main.js               bootstrap: renderer, resize, input, game state machine   [lead]
  config.js             gift text, tuning, palette, stage layout                 [lead]
  song/index.js         stage list: song + meadow mood per stage                 [lead]
  song/kit.js           shared arranger toolkit (patterns, beats → seconds)      [lead]
  song/doremi.js, edelweiss.js, favorite.js   one song each: melody, rounds,
                        tap targets, accompaniment                               [lead]
  game/conductor.js     audio-clock sequencer + tap judgment                     [lead]
  game/director.js      camera, wiring events -> characters/HUD/environment      [lead]
  audio/engine.js       Web Audio instruments + sfx                              [subagent: sonnet]
  world/environment.js  sky, mountains, meadow, lighting, celebration fx         [subagent: sonnet]
  world/characters.js   governess + seven children, procedural animation         [subagent: opus]
  ui/hud.js, hud.css    title, prompts, cue lane, judgments, result card         [subagent: sonnet]
```

Timing rule: **the audio clock is the only clock.** `songTime =
ctx.currentTime - startTime - outputLatency`. Visuals and judgments derive from
it; nothing uses `setTimeout` for musical timing.

## Shared conventions

- three.js r170, `import * as THREE from 'three'`. No other runtime deps, no
  external assets (no textures/models/fonts/audio files fetched from the
  network). Everything procedural. Canvas-generated textures are fine.
- Y up, metres. Characters face +Z. Stage layout comes from `STAGE` in
  `src/config.js`. Ground is flat at y = 0 within `STAGE.clearRadius` of origin.
- Default camera: roughly (0, 2.2, 9–16) looking at (0, 1.1, 0); it pans/zooms,
  and in portrait it is further back. Assume it stays in front (z > 3) and
  never looks behind itself.
- Renderer (set in `main.js`): sRGB output, ACES filmic tone mapping,
  PCFSoft shadow maps, pixel ratio capped at 2.
- Budget for the whole scene (raised after the first version ran smoothly on an
  iPhone): ≤ ~220 draw calls, ≤ ~700k triangles (≈ 500k on phones via `lowPower`).
  Use `InstancedMesh` for anything repeated. No post-processing passes.
- Modules must not touch files they don't own, must not add dependencies, and
  must not start timers of their own — they are driven by `update(dt, t)`.

## Module contracts

### `src/audio/engine.js`

```js
export class AudioEngine {
  constructor()
  unlock(): Promise<void>      // call inside a user gesture; creates/resumes the AudioContext (idempotent)
  get ctx(): AudioContext | null
  get now(): number            // ctx.currentTime (0 before unlock)
  get latency(): number        // best estimate of output latency in seconds (outputLatency || baseLatency || 0)
  playNote(instrument, midi, when, duration, velocity = 1): void
  playSfx(name, when = this.now): void
  setMasterVolume(v): void     // 0..1, smoothed
  suspend(): Promise<void>; resume(): Promise<void>
}
```

- `instrument`: `'voice'` (the governess: warm, vowel-like, gentle vibrato on
  long notes), `'kids'` (children: brighter, slightly chorused, a touch of
  breath), `'guitar'` (nylon pluck, Karplus-Strong or equivalent), `'bass'`
  (soft upright), `'bell'` (glockenspiel sparkle), `'flute'` (airy).
- `when` is an absolute `ctx.currentTime`; `when <= now` means "immediately".
- `name`: `'tap'` (soft tick for an off-target tap), `'miss'` (gentle comic
  "boop", never harsh), `'perfect'` (tiny sparkle), `'count'` (woodblock),
  `'cheer'` (short children's-cheer-like swell + sparkle arpeggio), `'whoosh'`.
- Master chain: gentle compressor + small algorithmic/convolution reverb
  (generated impulse) so it sounds like open air. No clipping with 8 voices.
- Every voice must free its nodes when done.

### `src/world/environment.js`

```js
export function createEnvironment(scene, { lowPower = false } = {}) => {
  update(dt, t): void          // clouds drift, grass/flowers sway, water shimmer, fx
  beat(strength = 1): void     // called on each musical beat: subtle bob of flowers/trees
  celebrate(): void            // finale: petals + balloons rising for ~12 s (pooled, instanced)
  sun: THREE.DirectionalLight  // the shadow-casting key light
}
```

Owns: `scene.background`, `scene.fog`, all lights, ground, everything not a
character. Look: golden late-morning Alpine meadow — rolling green hills,
snow-capped peaks in layers with atmospheric haze, a lake, pines, a tiny
onion-domed chapel far off, wildflowers, puffy clouds, gradient sky dome.
Shadow camera tightly covers the stage (x ∈ [-7, 7], z ∈ [-3, 4]), 1024 map
(512 if `lowPower`).

### `src/world/characters.js`

```js
export function createMaria(): Character
export function createChild(index /* 0..6 */): Character

Character = {
  group: THREE.Group,          // origin at the feet, facing +Z; caller positions/rotates it
  height: number,              // metres, top of head
  update(dt, t): void,         // idle breathing, blinking, springs, mouth, hop physics
  hop(strength = 1): void,     // anticipation squash -> jump -> landing squash (≈0.35 s total)
  sing(duration = 0.3): void,  // mouth opens to an "O"/"Ah" for duration, head tilts back a little
  beat(): void,                // small on-beat bob/sway
  setMood(mood): void,         // 'idle' | 'happy' | 'oops' | 'cheer'
  lookAt(x, y, z): void,       // eyes/head ease towards a world point (null args = look at camera/front)
  strum?(): void,              // Maria only: strum the guitar
}
```

- Maria: young governess, short blonde bob, simple dress + apron, acoustic
  guitar. ~1.65 m. Children: stepped heights from ~1.5 m (index 0) down to
  ~0.85 m (index 6); mix of girls/boys; play-clothes cut from the same green
  floral "curtain" fabric; each wears a clearly visible accent in
  `NOTE_COLORS[index]`.
- `'oops'` is cute, never sad: wobble, eyes go wide/squint, quick recovery.
- `'cheer'`: arms up, bouncing.
- All meshes `castShadow = true`. ≤ ~22 draw calls and ≤ ~32k triangles per
  character (merge static geometry where practical).

### `src/ui/hud.js` (+ `hud.css`, imported from the JS)

```js
export function createHUD(root /* HTMLElement overlaying the canvas */) => {
  showTitle({ title, subtitle, onStart }): void   // onStart fires from a real pointer/keyboard event
  hideTitle(): void
  showPrompt(text, { duration = 2.5, tone = 'info' } = {}): void   // tone: 'info' | 'go' | 'listen'
  showRound(label): void                          // small persistent chip, e.g. "Round 2 · Sing"
  renderCues(cues, lookahead): void               // every frame; see below
  pulseTarget(kind): void                         // 'perfect' | 'good' | 'miss' — flashes the hit ring
  showJudgment(kind, { label, color } = {}): void // floating "Perfect!" / "Good" / "Oops"
  setCombo(n): void
  setProgress(p): void                            // 0..1 thin bar
  showResults({ rank, rankLabel, perfect, good, miss, maxCombo, total,
                recipient, message, signature, onReplay }): void
  hideResults(): void
  setVisible(inGame: boolean): void               // show/hide in-game widgets
}
```

`renderCues(cues, lookahead)`: `cues` is an array of
`{ id, label, color, dt, state }` where `dt` = seconds until the note should be
hit (negative = past), `state` ∈ `'pending' | 'hit' | 'miss'`. Draw a single
lane along the bottom: a fixed hit ring near the left third, bubbles travel
right→left and are centred on the ring at `dt = 0`. Position must be a pure
function of `dt` (use `transform`, pool DOM nodes by `id`, no CSS transitions
on position). Hit bubbles pop; missed ones fade and droop. The HUD must never
swallow game taps except on its own buttons (`pointer-events: none` on
containers). Respect safe-area insets. Storybook look: cream paper, rounded
display type from system fonts, soft shadows.

## Song arrangements (lead)

C major, 4/4, quarter = 1 beat, 116 BPM. Eight 8-beat lines (64 beats per
chorus). Chords per bar: C C | Dm G7 | C C | F F | C F | D7 G | E7 Am | F·G7 C.
Round 1 is fingerpicked guitar, with bass and accordion joining halfway;
round 2 is a strummed folk pattern with walking upright bass and accordion
pad; a glockenspiel answers the long notes. Backing notes get a few ms of
seeded timing and velocity drift so nothing is machine-perfect.

## Verification

- `npm run dev` → desktop Chrome (mouse + Space), then phone on the same Wi-Fi
  via the LAN URL Vite prints.
- Check: audio starts after first tap on iOS, taps judged against audio clock,
  portrait + landscape framing, 60 fps on a mid-range phone.
- `npm run build` → `dist/` is a self-contained static site.

## Status

- [x] Scaffold, config, plan
- [x] Subagent modules (audio, environment, characters, HUD)
- [x] Chart, conductor, director, main
- [x] Integration + automated browser test (headless Chrome, desktop and
      phone-sized viewports in both orientations; a bot played the full song:
      95/95 notes hit, results card shown, no console errors, ~60 fps)
- [ ] Human pass: listen to the instrument sounds, play it by hand, try it on
      a real iPhone and Android phone (none of these can be automated)

## Changes made during integration

- Pines directly behind the stage were removed (a view corridor) so the
  chapel, lake and peaks are visible.
- Camera lowered to nearly eye level in landscape; in portrait the children
  stand in two staggered rows and the camera sits higher.
- Instrument bus levels reduced by ~40% so the master compressor idles
  (measured output: peak 0.68, RMS 0.18).
- Rank labels softened to Superb! / Lovely! / Encore!.

## Second pass (owner feedback)

- Interface localised: PT-BR by default (`src/i18n.js`), `?lang=en` for English.
- Arrangement rewritten (see "Song arrangement"); guitar rebuilt as a
  Karplus-Strong string with body resonances and round-robin variants; new
  `accordion` and `guitarMute` instruments; plucked upright bass.
- Environment and characters rebuilt at much higher detail (≈ 455k and ≈ 240k
  triangles). Verified ~60 fps in headless desktop Chrome only — still needs a
  check on a real phone. If it struggles there, the cheapest cuts are the hair
  resolution in `characters.js` and instance counts in `environment.js`.

## Third pass: three stages

- The title card is now a stage picker (tap a song, or press 1–3; Enter/Space
  starts the last one played). The results card gained "Other songs". The best
  rank per stage is kept in `localStorage` and shown on the picker.
- `song/chart.js` was split into `song/kit.js` (shared patterns, now including
  3/4 waltz picking, strumming and bass) and one file per song. The Do-Re-Mi
  chart is byte-for-byte what it was before the split.
- `Conductor` takes its chart through `load(chart)`; charts carry `meter`, and
  `onBeat(i, meter)` lets the cast sway in three for the waltzes.
- `environment.setMood('day' | 'sunset' | 'night')` eases lights, sky, fog,
  lake and the unlit clouds/birds to a time of day; night adds twinkling stars
  in the sky shader. Same geometry, no extra draw calls.

### Song arrangements, stages 2 and 3

- **Edelweiss** — C major, 3/4, 108 BPM, sunset. Form A A′ B A′ (32 bars).
  Round 1: she sings, the player taps the "one" of every bar. Round 2: the
  player sings every note over a strummed oom-pah-pah. Finale: the last line
  once more and a long final Do.
- **My Favorite Things** — E minor, 3/4, 168 BPM, night. Only the 16-bar verse
  is arranged (the "when the dog bites" bridge is left out). Round 1: tap the
  "one". Round 2: sing. Round 3: echo in four-bar phrases. Finale: the verse
  over E major chords, and the last leading note resolves up to a held Mi.
- Verified as before: a bot played each stage start to finish in headless
  Chrome (88/88, 132/132 and 95/95 notes, no console errors, ~60 fps) in
  desktop, phone-portrait and phone-landscape sizes. Not yet heard by a human.
