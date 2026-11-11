// Bootstrap + the tiny state machine: title → playing → results.

import * as THREE from 'three';
import { GIFT, GAME, NOTE_COLORS } from './config.js';
import { AudioEngine } from './audio/engine.js';
import { SONGS, buildChart } from './song/index.js';
import { Conductor } from './game/conductor.js';
import { Director } from './game/director.js';
import { createEnvironment } from './world/environment.js';
import { createHUD } from './ui/hud.js';
import { strings, pickLocale } from './i18n.js';

const canvas = document.getElementById('scene');
// Phones get the same scene as desktop. Only clearly weak devices (or
// `?quality=low`) get the lighter one; `?quality=high` forces the full one.
const quality = new URLSearchParams(location.search).get('quality');
const lowPower =
  quality === 'low' ||
  (quality !== 'high' && ((navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3));
let pixelRatioCap = 2;

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

let state = 'title';
let stage = SONGS[0]; // the song being played (or last played)
const charts = new Map(); // stage id -> chart, built on first play

// Best rank per stage, kept on this device so the title screen can show it.
const RANK_ORDER = ['try', 'ok', 'superb'];
const BEST_KEY = 'do-re-mi-meadow.best';
let best = {};
try { best = JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { /* private mode etc. */ }
function recordRank(id, rank) {
  if (RANK_ORDER.indexOf(rank) <= RANK_ORDER.indexOf(best[id])) return;
  best[id] = rank;
  try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* not saved; fine */ }
}

const conductor = new Conductor(audio, {
  onBeat: (i, meter) => director.onBeat(i, meter),
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
    // Guitar-Hero style, toned down: a dead-string "chk" under a soft droop.
    audio.playNote('guitarMute', 50 + (n.step % 3), audio.now, 0.2, 0.7);
    audio.playSfx('miss');
  },
  onCue: (c) => {
    if (c.kind === 'prompt') hud.showPrompt(c.text, { duration: c.duration, tone: c.tone });
    else if (c.kind === 'round') hud.showRound(c.label);
    else if (c.kind === 'celebrate') director.celebrate();
  },
  onEnd: (r) => {
    state = 'results';
    recordRank(stage.id, r.rank);
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
      onReplay: () => startGame(stage.id),
      onMenu: showMenu,
    });
  },
});

async function startGame(id) {
  stage = SONGS.find((s) => s.id === id) || SONGS[0];
  await audio.unlock();
  if (!charts.has(stage.id)) charts.set(stage.id, buildChart(stage.id, text));
  hud.hideTitle();
  hud.hideResults();
  hud.setVisible(true);
  hud.setCombo(0);
  hud.setProgress(0);
  hud.showRound('');
  director.reset();
  env.setMood(stage.mood);
  conductor.load(charts.get(stage.id));
  conductor.start();
  state = 'playing';
}

function showMenu() {
  state = 'title';
  hud.hideResults();
  director.reset();
  hud.showTitle({
    title: GIFT.title,
    subtitle: GIFT.subtitle,
    stages: SONGS.map((s) => ({
      id: s.id,
      name: text.stages[s.id].name,
      sub: text.stages[s.id].sub,
      color: s.color,
      rank: best[s.id] || null,
    })),
    current: stage.id,
    onStart: startGame,
  });
}

hud.setVisible(false);
showMenu();

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
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

// Safety net for the full-detail scene: if frames run slow for a couple of
// seconds, render at a lower resolution rather than stutter. Never steps up.
let slowTime = 0;
let fastTime = 0;
function watchFrameRate(rawDt) {
  if (document.hidden || rawDt > 0.25) return;
  if (rawDt > 1 / 45) slowTime += rawDt;
  else fastTime += rawDt;
  if (fastTime > 4) slowTime = fastTime = 0;
  if (slowTime > 1.5 && pixelRatioCap > 1) {
    pixelRatioCap = Math.max(1, pixelRatioCap - 0.5);
    slowTime = fastTime = 0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
}

renderer.setAnimationLoop(() => {
  const rawDt = clock.getDelta();
  watchFrameRate(rawDt);
  const dt = Math.min(rawDt, 0.05);
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
window.__game = { conductor, director, audio, hud, env, startGame, get chart() { return conductor.chart; } };
