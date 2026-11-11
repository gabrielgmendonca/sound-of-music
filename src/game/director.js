// Staging: where everyone stands, what the camera does, and how characters
// react to what the conductor reports.

import * as THREE from 'three';
import { NOTE_COLORS, STAGE, childX } from '../config.js';
import { createMaria, createChild } from '../world/characters.js';

// A wider lens in portrait pulls in more of the valley on a tall screen.
const FOV_LANDSCAPE = 42;
const FOV_PORTRAIT = 58;
const RING_POOL = 10;
const NOTE_POOL = 18;

export class Director {
  constructor(scene, camera, env) {
    this.scene = scene;
    this.camera = camera;
    this.env = env;

    this.maria = createMaria();
    this.children = Array.from({ length: 7 }, (_, i) => createChild(i));
    this.cast = [this.maria, ...this.children];
    this.cast.forEach((c) => scene.add(c.group));

    this.push = 0; // slow finale push-in
    this.pushTarget = 0;
    this.centerX = 0;
    this.dist = 10;
    this.t = 0;

    this._initNotes();
    this._initRings();
    this.layout(camera.aspect);
  }

  /** Arrange the cast for the current aspect ratio and frame them. */
  layout(aspect) {
    const portrait = aspect < 1;
    let mx, mz, mr;
    if (portrait) {
      // Two staggered rows so all seven fit a tall screen: the four eldest
      // at the back, the three youngest in the gaps in front.
      this.children.forEach((c, i) => {
        if (i < 4) c.group.position.set((i - 1.5) * 0.98, 0, -0.55);
        else c.group.position.set((i - 5) * 0.98, 0, 0.45);
      });
      mx = -2.45; mz = 0.9; mr = 0.6;
    } else {
      this.children.forEach((c, i) => c.group.position.set(childX(i), 0, STAGE.childZ));
      ({ x: mx, z: mz, rotY: mr } = STAGE.maria);
    }
    this.maria.group.position.set(mx, 0, mz);
    this.maria.group.rotation.y = mr;

    const xs = this.children.map((c) => c.group.position.x);
    const left = mx - (portrait ? 0.7 : 1.15);
    const right = Math.max(...xs) + (portrait ? 0.55 : 0.8);
    this.centerX = (left + right) / 2;
    const halfW = (right - left) / 2;
    const fov = portrait ? FOV_PORTRAIT : FOV_LANDSCAPE;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    const tanH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect;
    this.dist = Math.max(6.2, (halfW * 1.1) / tanH);
    this.portrait = portrait;
  }

  // ── Conductor reactions ────────────────────────────────────────────────

  onBeat(i, meter = 4) {
    const inBar = i % meter;
    this.env.beat(inBar === 0 ? 1 : 0.5);
    if (meter === 3) {
      // Waltz: she leans into the "one" and strums two and three; the
      // children sway one after another, a little wave along the row.
      if (inBar === 0) this.maria.beat();
      else this.maria.strum?.();
      this.children.forEach((c, k) => { if ((i + k) % 3 === 0) c.beat(); });
      return;
    }
    if (i % 2 === 1) this.maria.strum?.();
    else this.maria.beat();
    this.children.forEach((c, k) => { if ((i + k) % 2 === 0) c.beat(); });
  }

  onAuto(note) {
    this.maria.sing(note.len * 0.9);
    const kid = this.children[note.step];
    const p = kid.group.position;
    this.maria.lookAt(p.x, kid.height * 0.9, p.z);
    this._emitNote(this.maria, '#fff4d6');
  }

  onHit(note, kind) {
    const strength = kind === 'perfect' ? 1 : 0.7;
    if (note.final) {
      this.cast.forEach((c) => { c.hop(1.2); c.sing(2.5); });
      this.children.forEach((c, i) => { this._emitNote(c, NOTE_COLORS[i]); this._emitRing(c, NOTE_COLORS[i], 1.3); });
      return;
    }
    const kid = this.children[note.step];
    kid.setMood('happy');
    kid.hop(strength);
    kid.sing(Math.min(note.len * 0.9, 1.2));
    this._emitNote(kid, NOTE_COLORS[note.step]);
    // The camera stays still; a ring of the note's colour ripples out on the grass.
    this._emitRing(kid, NOTE_COLORS[note.step], strength);
  }

  onMiss(note) {
    this.children[note.step].setMood('oops');
  }

  celebrate() {
    this.env.celebrate();
    this.cast.forEach((c) => c.setMood('cheer'));
    this.pushTarget = 1;
  }

  reset() {
    this.cast.forEach((c) => { c.setMood('idle'); c.lookAt(null, null, null); });
    this.pushTarget = 0;
  }

  // ── Per-frame ──────────────────────────────────────────────────────────

  update(dt, t) {
    this.t = t;
    for (const c of this.cast) c.update(dt, t);
    this._updateNotes(dt);

    this._updateRings(dt);
    this.push += (this.pushTarget - this.push) * (1 - Math.exp(-dt * 0.5));

    // No kicks or pans: just a very slow drift, and a gentle push-in at the end.
    const dist = this.dist * (1 - 0.1 * this.push);
    const swayX = Math.sin(t * 0.17) * 0.08;
    const swayY = Math.sin(t * 0.23) * 0.03;
    const cam = this.camera;
    // Portrait sits higher and tilts down a touch so the cast lands in the
    // lower-middle of a tall screen, clear of the foreground grass.
    const camY = this.portrait ? 1.2 + dist * 0.12 : 1.25 + dist * 0.02;
    const lookY = this.portrait ? camY - dist * 0.05 : 1.15;
    cam.position.set(this.centerX + swayX, camY + swayY, dist);
    cam.lookAt(this.centerX, lookY, 0);
  }

  // ── Ground rings: the hit feedback ─────────────────────────────────────

  _initRings() {
    const geo = new THREE.RingGeometry(0.3, 0.4, 48);
    geo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 5;
      this.scene.add(m);
      this.rings.push({ mesh: m, life: 0, size: 1 });
    }
    this.ringIdx = 0;
  }

  _emitRing(character, color, strength) {
    const r = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % RING_POOL;
    const p = character.group.position;
    r.mesh.position.set(p.x, 0.04, p.z);
    r.mesh.material.color.set(color);
    r.mesh.visible = true;
    r.life = 1;
    r.size = 0.9 + strength * 0.7;
  }

  _updateRings(dt) {
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt / 0.6;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const age = 1 - r.life;
      const s = 1 + (1 - (1 - age) ** 3) * 1.6 * r.size; // ease-out
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 0.85 * r.life * r.life;
    }
  }

  // ── Floating music notes ───────────────────────────────────────────────

  _initNotes() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.save(); g.translate(36, 70); g.rotate(-0.35);
    g.beginPath(); g.ellipse(0, 0, 17, 12, 0, 0, Math.PI * 2); g.fill(); g.restore();
    g.beginPath(); g.moveTo(50, 66); g.lineTo(50, 16); g.stroke();
    g.beginPath(); g.moveTo(50, 16); g.quadraticCurveTo(78, 24, 72, 48); g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.notes = [];
    for (let i = 0; i < NOTE_POOL; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.renderOrder = 10;
      this.scene.add(s);
      this.notes.push({ sprite: s, life: 0, vx: 0, spin: 0 });
    }
    this.noteIdx = 0;
  }

  _emitNote(character, color) {
    const n = this.notes[this.noteIdx];
    this.noteIdx = (this.noteIdx + 1) % NOTE_POOL;
    const p = character.group.position;
    n.sprite.position.set(p.x + (Math.random() - 0.5) * 0.3, character.height + 0.25, p.z + 0.2);
    n.sprite.material.color.set(color);
    n.sprite.visible = true;
    n.life = 1;
    n.vx = (Math.random() - 0.5) * 0.6;
    n.spin = (Math.random() - 0.5) * 1.5;
  }

  _updateNotes(dt) {
    for (const n of this.notes) {
      if (n.life <= 0) continue;
      n.life -= dt / 1.3;
      if (n.life <= 0) { n.sprite.visible = false; continue; }
      const age = 1 - n.life;
      n.sprite.position.y += dt * (0.9 - age * 0.4);
      n.sprite.position.x += dt * n.vx + Math.sin(age * 9) * dt * 0.25;
      n.sprite.material.rotation = n.spin * age;
      n.sprite.material.opacity = Math.min(1, n.life * 2.2);
      const s = 0.42 * Math.min(1, age * 8 + 0.3);
      n.sprite.scale.set(s, s, s);
    }
  }
}
