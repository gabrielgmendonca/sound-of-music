import './hud.css';

// DOM overlay HUD for Do-Re-Mi Meadow. See docs/PLAN.md ("src/ui/hud.js").
// All containers are pointer-events:none; only real buttons (and the results
// scroller while the card is up) receive pointer events.

const RING_FRAC = 0.3; // hit ring position along the lane
const EXIT_MS = 350; // hit/miss bubble exit animation length
const CULL_PX = 90; // bubbles further left than this (px) are hidden

const NOTE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18.2V5.4l11-2.2v12.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="6.6" cy="18.4" rx="3.6" ry="2.8" fill="currentColor"/><ellipse cx="17.6" cy="15.8" rx="3.6" ry="2.8" fill="currentColor"/></svg>';
const NOTE_SINGLE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 18V4.2c0 0 1.2 3.600 5 4.800 2.200.700 3.800 2.200 3.500 4.800" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="7.600" cy="18.200" rx="3.700" ry="2.900" fill="currentColor"/></svg>';
const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21.2C6.200 17.200 2.400 13.600 2.400 9.200 2.400 6.300 4.600 4.200 7.200 4.200c1.900 0 3.600 1 4.800 2.800 1.200-1.800 2.900-2.800 4.800-2.800 2.600 0 4.800 2.100 4.800 5 0 4.400-3.800 8-9.600 12z"/></svg>';
const STAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.400" stroke-linejoin="round" d="M12 2.800l2.800 5.900 6.400.9-4.700 4.500 1.200 6.400L12 17.400l-5.700 3.100 1.200-6.400L2.800 9.600l6.400-.9z"/></svg>';
const REPLAY_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round" d="M4.500 12a7.500 7.500 0 1 0 2.400-5.500M4.500 4v4.800h4.800"/></svg>';

const TEMPLATE = `
<div class="hud__game" data-ref="game">
  <div class="hud__progress"><div class="hud__progress-fill" data-ref="progress"></div></div>
  <div class="hud__chip" data-ref="chip"><span class="hud__chip-ico">${NOTE_SINGLE_SVG}</span><span data-ref="chipText"></span></div>
  <div class="hud__combo" data-ref="combo"><span class="hud__combo-n" data-ref="comboN"></span><span class="hud__combo-t">combo</span></div>
  <div class="hud__prompt" data-ref="prompt" data-tone="info"><span data-ref="promptText"></span></div>
  <div class="hud__lane" data-ref="lane">
    <div class="hud__rail"></div>
    <div class="hud__ring" data-ref="ring">
      <div class="hud__ring-ripple" data-ref="ripple"></div>
      <div class="hud__ring-i" data-ref="ringI"></div>
    </div>
    <div class="hud__cues" data-ref="cues"></div>
    <div class="hud__pops" data-ref="pops"></div>
  </div>
</div>

<div class="hud__screen hud__title" data-ref="title">
  <div class="hud__decor" aria-hidden="true">
    <i class="hud__deco hud__deco--1">${NOTE_SVG}</i>
    <i class="hud__deco hud__deco--2">${NOTE_SINGLE_SVG}</i>
    <i class="hud__deco hud__deco--3">${NOTE_SVG}</i>
    <i class="hud__deco hud__deco--4">${NOTE_SINGLE_SVG}</i>
    <i class="hud__deco hud__deco--5">${NOTE_SINGLE_SVG}</i>
    <i class="hud__deco hud__deco--6">${NOTE_SVG}</i>
  </div>
  <div class="hud__tcard">
    <div class="hud__orn" aria-hidden="true"><span>${NOTE_SINGLE_SVG}</span><span>${NOTE_SVG}</span><span>${NOTE_SINGLE_SVG}</span></div>
    <h1 class="hud__h1" data-ref="titleText"></h1>
    <p class="hud__sub" data-ref="subText"></p>
    <button type="button" class="hud__btn hud__btn--red hud__start" data-ref="startBtn">Tap to begin</button>
    <p class="hud__hint">Tap anywhere in time with the music</p>
  </div>
</div>

<div class="hud__confetti" data-ref="confetti" aria-hidden="true"></div>

<div class="hud__screen hud__results" data-ref="results">
  <div class="hud__rcard">
    <div class="hud__rleft">
      <div class="hud__badge" data-ref="badge"><div class="hud__badge-i" data-ref="badgeIcon"></div></div>
      <div class="hud__rank" data-ref="rankLabel"></div>
      <ul class="hud__stats">
        <li><b data-ref="sPerfect"></b><span>Perfect</span></li>
        <li><b data-ref="sGood"></b><span>Good</span></li>
        <li><b data-ref="sMiss"></b><span>Missed</span></li>
        <li><b data-ref="sCombo"></b><span>Best combo</span></li>
      </ul>
    </div>
    <div class="hud__rright">
      <p class="hud__dear" data-ref="dear"></p>
      <p class="hud__msg" data-ref="msg"></p>
      <p class="hud__sig"><span data-ref="sig"></span><i>${HEART_SVG}</i></p>
      <button type="button" class="hud__btn hud__btn--green hud__replay" data-ref="replayBtn"><i>${REPLAY_SVG}</i>Play again</button>
    </div>
  </div>
</div>
`;

const BADGES = {
  superb: STAR_SVG,
  ok: NOTE_SVG,
  try: HEART_SVG,
};

const CONFETTI_COLORS = ['#d9483b', '#f2b632', '#5fb760', '#3fa9d6', '#a45fd0', '#f28c38'];

export function createHUD(root, text = {}) {
  root.classList.add('hud');
  root.innerHTML = TEMPLATE;
  // Localised labels (see src/i18n.js); the template's English is the fallback.
  const setText = (sel, value) => {
    const el = root.querySelector(sel);
    if (el && value) el.textContent = value;
  };
  setText('.hud__combo-t', text.combo);
  setText('[data-ref="startBtn"]', text.start);
  setText('.hud__hint', text.hint);
  [text.statPerfect, text.statGood, text.statMiss, text.statCombo].forEach((v, i) => {
    const b = root.querySelector('[data-ref="' + ['sPerfect', 'sGood', 'sMiss', 'sCombo'][i] + '"]');
    if (b && v && b.nextElementSibling) b.nextElementSibling.textContent = v;
  });
  if (text.replay) {
    const btn = root.querySelector('[data-ref="replayBtn"]');
    if (btn && btn.lastChild && btn.lastChild.nodeType === 3) btn.lastChild.textContent = text.replay;
  }

  const r = {};
  root.querySelectorAll('[data-ref]').forEach((el) => {
    r[el.dataset.ref] = el;
  });

  const reduce =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false };
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const stop = (e) => e.stopPropagation();

  // Buttons must never double as game taps.
  r.startBtn.addEventListener('pointerdown', stop);
  r.replayBtn.addEventListener('pointerdown', stop);
  // While the results card is up, taps/scrolls on it are not game taps either.
  r.results.addEventListener('pointerdown', stop);

  // ---------------------------------------------------------------- in-game
  let inGame = true;
  function setVisible(v) {
    inGame = !!v;
    r.game.classList.toggle('is-off', !inGame);
  }

  // Round chip
  let chipText = '';
  function showRound(label) {
    label = label == null ? '' : String(label);
    if (label === chipText) return;
    chipText = label;
    r.chipText.textContent = label;
    r.chip.classList.toggle('is-on', label !== '');
    if (label !== '' && canAnimate && !reduce.matches) {
      r.chip.animate(
        [
          { transform: 'scale(.82) rotate(-3deg)' },
          { transform: 'scale(1.06) rotate(1deg)', offset: 0.6 },
          { transform: 'scale(1) rotate(0)' },
        ],
        { duration: 450, easing: 'ease-out' }
      );
    }
  }

  // Progress
  let lastProg = -1;
  function setProgress(p) {
    p = p > 1 ? 1 : p > 0 ? p : 0;
    if (Math.abs(p - lastProg) < 0.0005) return;
    lastProg = p;
    r.progress.style.transform = 'scaleX(' + p.toFixed(4) + ')';
  }

  // Combo
  let comboVal = -1;
  function setCombo(n) {
    n = n | 0;
    if (n === comboVal) return;
    comboVal = n;
    if (n >= 3) {
      r.comboN.textContent = '×' + n;
      r.combo.classList.add('is-on');
      r.combo.classList.toggle('is-hot', n >= 10);
      if (canAnimate && !reduce.matches) {
        r.combo.animate(
          [
            { transform: 'scale(.8) rotate(-4deg)' },
            { transform: 'scale(1.25) rotate(3deg)', offset: 0.45 },
            { transform: 'scale(1) rotate(-2deg)' },
          ],
          { duration: 360, easing: 'cubic-bezier(.34,1.56,.64,1)' }
        );
      }
    } else {
      r.combo.classList.remove('is-on', 'is-hot');
    }
  }

  // Prompt banner
  let promptTimer = 0;
  function showPrompt(text, opts) {
    const o = opts || {};
    const duration = o.duration == null ? 2.5 : o.duration;
    const tone = o.tone || 'info';
    clearTimeout(promptTimer);
    r.promptText.textContent = text == null ? '' : String(text);
    r.prompt.dataset.tone = tone;
    r.prompt.classList.add('is-on');
    if (canAnimate && !reduce.matches) {
      r.prompt.animate(
        [{ filter: 'brightness(1.15)' }, { filter: 'brightness(1)' }],
        { duration: 400, easing: 'ease-out' }
      );
    }
    if (isFinite(duration) && duration > 0) {
      promptTimer = setTimeout(() => r.prompt.classList.remove('is-on'), duration * 1000);
    }
  }

  // Hit ring feedback
  function pulseTarget(kind) {
    if (!canAnimate) return;
    const calm = reduce.matches;
    let ringFrames;
    let rippleColor = null;
    if (kind === 'perfect') {
      rippleColor = '#f6c445';
      ringFrames = [
        { transform: 'scale(1)', borderColor: '#fff6e0', boxShadow: '0 0 0 0 rgba(246,196,69,0)' },
        {
          transform: calm ? 'scale(1)' : 'scale(1.28)',
          borderColor: '#f6c445',
          boxShadow: '0 0 0 6px rgba(246,196,69,.55), 0 0 28px 8px rgba(246,196,69,.75)',
          offset: 0.3,
        },
        { transform: 'scale(1)', borderColor: '#fff6e0', boxShadow: '0 0 0 0 rgba(246,196,69,0)' },
      ];
    } else if (kind === 'good') {
      rippleColor = '#5fb760';
      ringFrames = [
        { transform: 'scale(1)', borderColor: '#fff6e0', boxShadow: '0 0 0 0 rgba(95,183,96,0)' },
        {
          transform: calm ? 'scale(1)' : 'scale(1.16)',
          borderColor: '#5fb760',
          boxShadow: '0 0 0 5px rgba(95,183,96,.5), 0 0 20px 5px rgba(95,183,96,.6)',
          offset: 0.3,
        },
        { transform: 'scale(1)', borderColor: '#fff6e0', boxShadow: '0 0 0 0 rgba(95,183,96,0)' },
      ];
    } else {
      ringFrames = calm
        ? [
            { borderColor: '#fff6e0' },
            { borderColor: '#a8a49a', offset: 0.3 },
            { borderColor: '#fff6e0' },
          ]
        : [
            { transform: 'rotate(0) scale(1)', borderColor: '#fff6e0' },
            { transform: 'rotate(-9deg) scale(.94)', borderColor: '#a8a49a', offset: 0.18 },
            { transform: 'rotate(8deg) scale(.96)', borderColor: '#a8a49a', offset: 0.4 },
            { transform: 'rotate(-5deg) scale(.98)', borderColor: '#b9b5ab', offset: 0.62 },
            { transform: 'rotate(2deg) scale(1)', borderColor: '#d4d0c6', offset: 0.82 },
            { transform: 'rotate(0) scale(1)', borderColor: '#fff6e0' },
          ];
    }
    r.ringI.animate(ringFrames, { duration: kind === 'miss' ? 460 : 380, easing: 'ease-out' });
    if (rippleColor && !calm) {
      r.ripple.style.borderColor = rippleColor;
      r.ripple.animate(
        [
          { transform: 'scale(.9)', opacity: 0.85 },
          { transform: 'scale(2.1)', opacity: 0 },
        ],
        { duration: 520, easing: 'ease-out' }
      );
    }
  }

  // Judgment popups (small round-robin pool)
  const POP_COUNT = 5;
  const pops = [];
  for (let i = 0; i < POP_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'hud__pop';
    const main = document.createElement('span');
    main.className = 'hud__pop-main';
    const sub = document.createElement('span');
    sub.className = 'hud__pop-sub';
    el.appendChild(main);
    el.appendChild(sub);
    r.pops.appendChild(el);
    pops.push({ el, main, sub, anim: null });
  }
  let popIdx = 0;
  const JUDGE_TEXT = { perfect: text.perfect || 'Perfect!', good: text.good || 'Good', miss: text.miss || 'Oops' };
  function showJudgment(kind, opts) {
    const o = opts || {};
    const p = pops[popIdx];
    popIdx = (popIdx + 1) % POP_COUNT;
    if (p.anim) p.anim.cancel();
    p.el.dataset.kind = kind;
    p.main.textContent = JUDGE_TEXT[kind] || String(kind);
    if (o.label) {
      p.sub.textContent = o.label;
      p.sub.style.display = '';
      p.sub.style.setProperty('--c', o.color || '#7a8f7e');
    } else {
      p.sub.textContent = '';
      p.sub.style.display = 'none';
    }
    if (!canAnimate) return;
    const calm = reduce.matches;
    p.anim = p.el.animate(
      calm
        ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
        : [
            { opacity: 0, transform: 'translate(-50%, 0) scale(.5)' },
            { opacity: 1, transform: 'translate(-50%, -14px) scale(1.18)', offset: 0.18 },
            { opacity: 1, transform: 'translate(-50%, -30px) scale(1)', offset: 0.5 },
            { opacity: 0, transform: 'translate(-50%, -64px) scale(.95)' },
          ],
      { duration: kind === 'miss' ? 700 : 850, easing: 'ease-out' }
    );
  }

  // ------------------------------------------------------------- cue lane
  let laneW = 0;
  let ringX = 0;
  function measureLane() {
    laneW = r.lane.clientWidth;
    ringX = laneW * RING_FRAC;
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(measureLane).observe(r.lane);
  }
  window.addEventListener('resize', measureLane);
  window.addEventListener('orientationchange', measureLane);

  const free = []; // idle pooled nodes
  const live = []; // entries currently bound to a cue id
  const byId = new Map();
  let frame = 0;

  function makeNode() {
    const el = document.createElement('div');
    el.className = 'hud__cue';
    const inner = document.createElement('div');
    inner.className = 'hud__bub';
    const text = document.createTextNode('');
    inner.appendChild(text);
    el.appendChild(inner);
    r.cues.appendChild(el);
    return {
      id: null, el, inner, text,
      label: '', color: '', state: 'pending',
      seen: 0, vis: true, x: 1e9, exitAt: 0, done: false,
      lastDt: 0, lastT: 0, frozen: false,
    };
  }

  function bind(e, c) {
    e.id = c.id;
    e.label = null; // force update below
    e.color = null;
    e.state = 'pending';
    e.done = false;
    e.frozen = false;
    e.exitAt = 0;
    e.x = 1e9;
    e.inner.className = 'hud__bub';
    byId.set(c.id, e);
    live.push(e);
  }

  function setVis(e, v) {
    if (e.vis === v) return;
    e.vis = v;
    e.el.style.visibility = v ? 'visible' : 'hidden';
  }

  function release(i) {
    const e = live[i];
    byId.delete(e.id);
    setVis(e, false);
    e.id = null;
    const last = live.pop();
    if (last !== e) live[i] = last;
    free.push(e);
  }

  function place(e, x) {
    if (Math.abs(x - e.x) < 0.05) return;
    e.x = x;
    e.el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
  }

  function renderCues(cues, lookahead) {
    if (laneW === 0) measureLane();
    frame++;
    const now = performance.now();
    const span = laneW - ringX;
    const la = lookahead > 0 ? lookahead : 1;

    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      let e = byId.get(c.id);
      const dt = c.dt;
      if (!e) {
        if (dt > la || c.state !== 'pending') continue;
        e = free.pop() || makeNode();
        bind(e, c);
      }
      e.seen = frame;

      if (c.label !== e.label) {
        e.label = c.label;
        const t = c.label == null ? '' : String(c.label);
        e.text.nodeValue = t;
        e.inner.classList.toggle('is-dot', t === '');
      }
      if (c.color !== e.color) {
        e.color = c.color;
        e.el.style.setProperty('--c', c.color || '#d9a441');
      }

      const x = ringX + (dt / la) * span;
      e.lastDt = dt;
      e.lastT = now;

      if (c.state !== e.state) {
        e.state = c.state;
        if (c.state === 'hit' || c.state === 'miss') {
          e.exitAt = now;
          e.done = false;
          e.inner.classList.add(c.state === 'hit' ? 'is-hit' : 'is-miss');
          if (c.state === 'hit') {
            e.frozen = true;
            place(e, x);
          }
        }
      }

      if (e.state === 'pending') {
        place(e, x);
        setVis(e, dt <= la && x > -CULL_PX);
      } else if (!e.done) {
        if (e.state === 'miss') place(e, x);
      }
    }

    // Sweep: expire finished exits, drop bubbles no longer in the array.
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      const present = e.seen === frame;
      if (e.state === 'pending') {
        if (!present) release(i);
        continue;
      }
      // hit / miss: play out the exit animation
      if (!e.done && now - e.exitAt >= EXIT_MS) {
        e.done = true;
        setVis(e, false);
      }
      if (!present) {
        if (!e.done && e.state === 'miss') {
          // keep drifting left with the music while it fades
          place(e, ringX + ((e.lastDt - (now - e.lastT) / 1000) / la) * span);
        }
        if (e.done) release(i);
      }
    }
  }

  // ------------------------------------------------------------ title screen
  let titleCleanup = null;
  function teardownTitle() {
    if (titleCleanup) {
      titleCleanup();
      titleCleanup = null;
    }
  }
  function showTitle(opts) {
    const o = opts || {};
    teardownTitle();
    r.titleText.textContent = o.title == null ? '' : String(o.title);
    r.subText.textContent = o.subtitle == null ? '' : String(o.subtitle);
    setVisible(false);

    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      teardownTitle();
      if (typeof o.onStart === 'function') o.onStart();
    };
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        fire();
      }
    };
    const onPointerUp = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      fire();
    };
    r.startBtn.addEventListener('click', fire);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('keydown', onKey, true);
    titleCleanup = () => {
      r.startBtn.removeEventListener('click', fire);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('keydown', onKey, true);
    };

    r.title.classList.remove('is-shown');
    void r.title.offsetWidth; // restart entrance animation
    r.title.classList.add('is-shown');
  }
  function hideTitle() {
    teardownTitle();
    r.title.classList.remove('is-shown');
    setVisible(true);
  }

  // ----------------------------------------------------------------- results
  // Confetti + hearts, built once (deterministic pseudo-random layout).
  (function buildConfetti() {
    let s = 7;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 34; i++) {
      const heart = i % 4 === 3;
      const el = document.createElement('i');
      el.className = heart ? 'hud__conf hud__conf--heart' : 'hud__conf';
      const st = el.style;
      st.setProperty('--x', (rnd() * 100).toFixed(1) + '%');
      st.setProperty('--d', (-rnd() * 7).toFixed(2) + 's');
      st.setProperty('--t', (5 + rnd() * 4).toFixed(2) + 's');
      st.setProperty('--sw', (rnd() * 60 - 30).toFixed(0) + 'px');
      st.setProperty('--rot', (360 + rnd() * 540).toFixed(0) + 'deg');
      st.setProperty('--s', (heart ? 14 + rnd() * 12 : 7 + rnd() * 6).toFixed(0) + 'px');
      st.color = heart
        ? i % 8 === 3 ? '#e8645a' : '#f08aa0'
        : CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      if (heart) el.innerHTML = HEART_SVG;
      frag.appendChild(el);
    }
    r.confetti.appendChild(frag);
  })();

  let replayHandler = null;
  r.replayBtn.addEventListener('click', () => {
    const fn = replayHandler;
    if (!fn) return;
    replayHandler = null; // guard against double firing
    fn();
  });

  function showResults(o) {
    o = o || {};
    const rank = BADGES[o.rank] ? o.rank : 'ok';
    r.badge.dataset.rank = rank;
    r.badgeIcon.innerHTML = BADGES[rank];
    r.rankLabel.dataset.rank = rank;
    r.rankLabel.textContent = o.rankLabel == null ? '' : String(o.rankLabel);
    r.sPerfect.textContent = o.perfect | 0;
    r.sGood.textContent = o.good | 0;
    r.sMiss.textContent = o.miss | 0;
    r.sCombo.textContent = o.maxCombo | 0;
    r.dear.textContent = o.salutation || (o.recipient ? 'Dear ' + o.recipient + ',' : '');
    r.msg.textContent = o.message == null ? '' : String(o.message);
    r.sig.textContent = o.signature == null ? '' : String(o.signature);
    replayHandler = typeof o.onReplay === 'function' ? o.onReplay : null;

    setVisible(false);
    r.results.scrollTop = 0;
    r.results.classList.remove('is-shown');
    r.confetti.classList.remove('is-on');
    void r.results.offsetWidth;
    r.results.classList.add('is-shown');
    r.confetti.classList.add('is-on');
  }
  function hideResults() {
    r.results.classList.remove('is-shown');
    r.confetti.classList.remove('is-on');
    replayHandler = null;
  }

  // Initial state
  setProgress(0);
  setCombo(0);
  measureLane();

  return {
    showTitle,
    hideTitle,
    showPrompt,
    showRound,
    renderCues,
    pulseTarget,
    showJudgment,
    setCombo,
    setProgress,
    showResults,
    hideResults,
    setVisible,
  };
}
