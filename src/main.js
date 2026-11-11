// Bootstrap + the tiny state machine: title → playing → results.

import * as THREE from 'three';
import { GIFT, GAME, NOTE_COLORS } from './config.js';
import { AudioEngine } from './audio/engine.js';
import { buildChart } from './song/chart.js';
import { Conductor } from './game/conductor.js';
import { Director } from './game/director.js';
import { createEnvironment } from './world/environment.js';
import { createHUD } from './ui/hud.js';
import { strings, pickLocale } from './i18n.js';

const canvas = document.getElementById('scene');
const lowPower =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);

const env = createEnvironment(scene, { lowPower });
const director = new Director(scene, camera, env);
const text = strings();
document.documentElement.lang = pickLocale();
document.title = GIFT.title;
const hud = createHUD(document.getElementById('hud'), text);
const audio = new AudioEngine();
const chart = buildChart(text);

let state = 'title';

const conductor = new Conductor(audio, chart, {
  onBeat: (i) => director.onBeat(i),
  onAuto: (n) => director.onAuto(n),
  onHit: (n, kind) => {
    director.onHit(n, kind);
    hud.pulseTarget(kind);
    hud.showJudgment(kind, { label: n.label, color: NOTE_COLORS[n.step] });
    hud.setCombo(conductor.stats.combo);
    if (n.final) audio.playSfx('cheer');
  },
  onMiss: (n) => {
    director.onMiss(n);
    hud.pulseTarget('miss');
    hud.showJudgment('miss');
    hud.setCombo(0);
    audio.playSfx('miss');
  },
  onCue: (c) => {
    if (c.kind === 'prompt') hud.showPrompt(c.text, { duration: c.duration, tone: c.tone });
    else if (c.kind === 'round') hud.showRound(c.label);
    else if (c.kind === 'celebrate') director.celebrate();
  },
  onEnd: (r) => {
    state = 'results';
    hud.setVisible(false);
    hud.showResults({
      rank: r.rank,
      rankLabel: text.ranks[r.rank],
      perfect: r.perfect,
      good: r.good,
      miss: r.miss,
      maxCombo: r.maxCombo,
      total: r.total,
      salutation: GIFT.salutation,
      message: GIFT.message,
      signature: GIFT.signature,
      onReplay: startGame,
    });
  },
});

async function startGame() {
  await audio.unlock();
  hud.hideTitle();
  hud.hideResults();
  hud.setVisible(true);
  hud.setCombo(0);
  hud.setProgress(0);
  director.reset();
  conductor.start();
  state = 'playing';
}

hud.setVisible(false);
hud.showTitle({ title: GIFT.title, subtitle: GIFT.subtitle, onStart: startGame });

// ── Input: one button. Tap anywhere, click, or Space. ─────────────────────

function tap(e) {
  if (state !== 'playing') return;
  const age = e?.timeStamp ? Math.min(0.1, Math.max(0, (performance.now() - e.timeStamp) / 1000)) : 0;
  conductor.tap(age);
}
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('button, a')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  tap(e);
});
window.addEventListener('keydown', (e) => {
  if (e.repeat || (e.code !== 'Space' && e.code !== 'Enter')) return;
  if (state === 'playing') { e.preventDefault(); tap(e); }
});
// Keep iOS from scrolling / zooming / selecting while tapping fast.
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Pausing the audio context also pauses the song clock, so nothing drifts.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend();
  else audio.resume();
});

// ── Resize + loop ─────────────────────────────────────────────────────────

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  director.layout(camera.aspect);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
resize();

const clock = new THREE.Clock();
const cueList = [];
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  conductor.update();
  if (state === 'playing') {
    hud.renderCues(conductor.cues(GAME.cueLookahead, cueList), GAME.cueLookahead);
    hud.setProgress(conductor.progress);
  }
  director.update(dt, t);
  env.update(dt, t);
  renderer.render(scene, camera);
});

// Handy for debugging from the console; harmless otherwise.
window.__game = { conductor, director, audio, chart, hud, env };
