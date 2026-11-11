// Characters: the governess (Maria) and the seven children.
//
// Everything is procedural: rounded primitives merged into a handful of
// vertex-coloured meshes per character, one shared canvas-free (DataTexture)
// floral "curtain" fabric for the children's play-clothes, and a small
// spring-based animation rig driven only by update(dt, t).
//
// Rig hierarchy (all in metres, Y up, facing +Z):
//   group            caller positions / rotates this; origin at the feet
//    └ rig           hop height, squash & stretch, oops-wobble (pivot = feet)
//       ├ lower      legs, socks, shoes (static)
//       └ torso      pivot at the hips: breathing, weight shift, lean
//          ├ body / clothes / arms (/ guitar)
//          └ headPivot   neck: look, nod, singing tilt
//             └ head     scaled by head radius; face built in "head units"
//                ├ head mesh (skin, sclera, nose, ears, hair, accessories)
//                ├ irisL / irisR (gaze), shine (eye highlights)
//                ├ lids (blink), mouth (morph targets), brows
//                └ danglies (braids / pigtails / ponytail on springs)

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOTE_COLORS } from '../config.js';

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const HEAD_Z = 0.94; // heads are very slightly flattened front-to-back
const TILE = 0.16; // metres per repeat of the fabric pattern
const G = 34; // cartoon gravity (m/s²) — snappy hops

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function spring(s, target, k, c, h) {
  s.v += (-(s.x - target) * k - c * s.v) * h;
  s.x += s.v * h;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const col = (c) => new THREE.Color(c);
const shade = (c, k) => col(c).multiplyScalar(k);
const mix = (a, b, t) => col(a).lerp(col(b), t);

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _sv = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _c = new THREE.Color();

function paint(g, c) {
  const color = col(c);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = color.r;
    a[i * 3 + 1] = color.g;
    a[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function paintFn(g, fn) {
  const p = g.attributes.position;
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), _c);
    a[i * 3] = _c.r;
    a[i * 3 + 1] = _c.g;
    a[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function place(g, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const sc = Array.isArray(s) ? s : [s, s, s];
  _m4.compose(_pv.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _sv.set(sc[0], sc[1], sc[2]));
  g.applyMatrix4(_m4);
  return g;
}

// A (possibly squashed) sphere: s = radius or [rx, ry, rz].
function ball(c, p, s, r = [0, 0, 0], ws = 10, hs = 8) {
  return paint(place(new THREE.SphereGeometry(1, ws, hs), p, r, s), c);
}

// Capsule between two points.
function limb(a, b, radius, c, rad = 8, cap = 3) {
  const A = Array.isArray(a) ? V(...a) : a.clone();
  const B = Array.isArray(b) ? V(...b) : b.clone();
  const d = B.clone().sub(A);
  const L = Math.max(1e-4, d.length());
  const g = new THREE.CapsuleGeometry(radius, L, cap, rad);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, V(1, 1, 1)));
  return paint(g, c);
}

// Cylinder between two points (open or closed).
function rod(a, b, rTop, rBot, c, rad = 12, open = false) {
  const A = V(...a);
  const B = V(...b);
  const d = B.clone().sub(A);
  const L = Math.max(1e-4, d.length());
  const g = new THREE.CylinderGeometry(rTop, rBot, L, rad, 1, open);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, V(1, 1, 1)));
  return paint(g, c);
}

function lathe(pts, seg = 24, phiStart = 0, phiLen = TAU) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
}

function uvScale(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

function flip(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

// Weld seams/poles so deformed spheres shade smoothly.
function smoothNormals(g) {
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute('position', g.attributes.position);
  tmp.setIndex(g.index);
  const m = mergeVertices(tmp, 1e-4);
  m.computeVertexNormals();
  return m;
}

const KEEP = ['position', 'normal', 'uv', 'color'];
function merge(list) {
  const geos = list.filter(Boolean).map((g) => {
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.color) paint(g, 0xffffff);
    g.morphAttributes = {};
    g.clearGroups();
    return g;
  });
  const anyFlat = geos.some((g) => !g.index);
  const ready = anyFlat ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos;
  const out = mergeGeometries(ready, false);
  if (!out) throw new Error('characters: geometry merge failed');
  out.computeBoundingSphere();
  return out;
}

// Interpolated lathe radius at height y.
function profR(pts, y) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [r0, y0] = pts[k];
    const [r1, y1] = pts[k + 1];
    if (y1 > y0 && y >= y0 && y <= y1) return lerp(r0, r1, (y - y0) / (y1 - y0));
  }
  return y < pts[1][1] ? pts[1][0] : pts[pts.length - 1][0];
}

function latheLen(pts) {
  let len = 0;
  let maxR = 0;
  for (let k = 0; k < pts.length; k++) {
    maxR = Math.max(maxR, pts[k][0]);
    if (k) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  }
  return { len, maxR };
}

// Fabric lathe (UVs scaled so the pattern has a constant world size).
function fabricLathe(pts, seg, zf, yOff) {
  const g = lathe(pts, seg);
  const { len, maxR } = latheLen(pts);
  uvScale(g, (TAU * maxR * 0.85) / TILE, len / TILE);
  g.scale(1, 1, zf);
  g.translate(0, yOff, 0);
  return g;
}

function bodyLathe(pts, seg, zf, yOff, c, phiStart = 0, phiLen = TAU) {
  const g = lathe(pts, seg, phiStart, phiLen);
  g.scale(1, 1, zf);
  g.translate(0, yOff, 0);
  return paint(g, c);
}

function bow(c, size) {
  const k = shade(c, 0.82);
  const s = size;
  return merge([
    ball(c, [-0.55 * s, 0.05 * s, 0], [0.58 * s, 0.4 * s, 0.24 * s], [0, 0, -0.35], 9, 6),
    ball(c, [0.55 * s, 0.05 * s, 0], [0.58 * s, 0.4 * s, 0.24 * s], [0, 0, 0.35], 9, 6),
    ball(k, [-0.24 * s, -0.48 * s, -0.03 * s], [0.15 * s, 0.42 * s, 0.09 * s], [0, 0, -0.38], 6, 5),
    ball(k, [0.24 * s, -0.48 * s, -0.03 * s], [0.15 * s, 0.42 * s, 0.09 * s], [0, 0, 0.38], 6, 5),
    ball(c, [0, 0, 0.06 * s], [0.24 * s, 0.24 * s, 0.2 * s], [0, 0, 0], 8, 6),
  ]);
}

function triCount(g) {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

// ---------------------------------------------------------------------------
// Shared resources (materials + fabric texture), created lazily once.
// ---------------------------------------------------------------------------

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }),
    gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0 }),
    satin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 }),
    mouth: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    fabric: new THREE.MeshStandardMaterial({ map: makeFabricTexture(), roughness: 0.9, metalness: 0 }),
    cache: new Map(),
  };
  return SHARED;
}

function cached(key, make) {
  const S = shared();
  if (!S.cache.has(key)) S.cache.set(key, make());
  return S.cache.get(key);
}

// Green floral "curtain" fabric, generated pixel by pixel (tiles seamlessly).
function makeFabricTexture() {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const base = [138, 174, 100];
  const leaf = [86, 126, 66];
  const centre = [238, 186, 62];
  const flowers = [
    { x: 0.25, y: 0.27, R: 0.125, c: [252, 247, 232], rot: 0.2 },
    { x: 0.75, y: 0.77, R: 0.125, c: [247, 200, 198], rot: 1.1 },
    { x: 0.77, y: 0.22, R: 0.07, c: [252, 247, 232], rot: 0.6 },
    { x: 0.22, y: 0.76, R: 0.07, c: [250, 228, 196], rot: 2.0 },
  ];
  const leaves = [
    { x: 0.43, y: 0.38, a: 0.075, b: 0.028, ang: 0.7 },
    { x: 0.08, y: 0.13, a: 0.065, b: 0.025, ang: -0.6 },
    { x: 0.58, y: 0.6, a: 0.075, b: 0.028, ang: 2.3 },
    { x: 0.92, y: 0.92, a: 0.065, b: 0.025, ang: -2.2 },
    { x: 0.52, y: 0.06, a: 0.06, b: 0.024, ang: 0.2 },
    { x: 0.05, y: 0.55, a: 0.06, b: 0.024, ang: 1.6 },
    { x: 0.94, y: 0.45, a: 0.055, b: 0.022, ang: -1.0 },
  ];
  const wrap = (d) => d - Math.round(d);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const v = (j + 0.5) / N;
      const tw = ((i + j) % 4 < 2 ? 1 : -1) * 0.03; // faint twill
      let r = base[0] * (1 + tw);
      let g = base[1] * (1 + tw);
      let b = base[2] * (1 + tw);
      const put = (cc, a) => {
        r += (cc[0] - r) * a;
        g += (cc[1] - g) * a;
        b += (cc[2] - b) * a;
      };
      for (const L of leaves) {
        const dx = wrap(u - L.x);
        const dy = wrap(v - L.y);
        const ca = Math.cos(-L.ang);
        const sa = Math.sin(-L.ang);
        const lx = dx * ca - dy * sa;
        const ly = dx * sa + dy * ca;
        const e = Math.hypot(lx / L.a, ly / L.b);
        put(leaf, clamp((1 - e) * L.b * N * 0.9 + 0.5, 0, 1));
      }
      for (const F of flowers) {
        const dx = wrap(u - F.x);
        const dy = wrap(v - F.y);
        const rr = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx);
        const pr = F.R * (0.5 + 0.5 * Math.abs(Math.cos(2.5 * (th + F.rot))));
        put(F.c, clamp((pr - rr) * N * 0.8 + 0.5, 0, 1));
        put(centre, clamp((F.R * 0.28 - rr) * N + 0.5, 0, 1));
      }
      const o = (j * N + i) * 4;
      data[o] = clamp(Math.round(r), 0, 255);
      data[o + 1] = clamp(Math.round(g), 0, 255);
      data[o + 2] = clamp(Math.round(b), 0, 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Faces and hair (built in "head units": head radius = 1, centre = origin)
// ---------------------------------------------------------------------------

function ellipsoidZ(x, y, sy) {
  const q = 1 - x * x - (y / sy) * (y / sy);
  return q > 0 ? HEAD_Z * Math.sqrt(q) : 0;
}

function hairShell(o, h) {
  let g = new THREE.SphereGeometry(1, h.ws || 28, h.hs || 20);
  const p = g.attributes.position;
  const sideA0 = h.sideA0 ?? 0.62;
  const sideA1 = h.sideA1 ?? 1.2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const az = Math.atan2(x, z);
    const A = Math.abs(az);
    const frontW = 1 - smooth(sideA0, sideA1, A);
    let fh = h.front + (h.asym || 0) * az - (h.scallop ?? 0.04) * (0.5 + 0.5 * Math.cos(az * (h.freq || 9))) * frontW;
    if (h.part) fh += h.part * (1 - smooth(0, 0.16, A));
    let hl = lerp(fh, h.side, smooth(sideA0, sideA1, A));
    hl = lerp(hl, h.back, smooth(h.backA0 ?? 1.9, h.backA1 ?? 2.7, A));
    let R = h.R + (h.ridge ?? 0.012) * Math.sin(az * 11 + y * 3);
    if (h.flare) R += h.flare * smooth(h.flareY0 ?? 0.1, h.flareY1 ?? -0.5, y) * smooth(0.45, 1.1, A);
    if (h.extraR) R += h.extraR(az, y);
    if (y < hl) R = lerp(R, 0.84, smooth(0, 0.09, hl - y));
    p.setXYZ(i, x * R, y * R * o.sy, z * R * HEAD_Z);
  }
  g = smoothNormals(g);
  const hc = col(o.hairColor);
  paintFn(g, (x, y, z, c) => {
    const yy = y / o.sy;
    c.copy(hc).multiplyScalar(0.76 + 0.32 * smooth(-0.7, 0.95, yy) + 0.05 * Math.sin(Math.atan2(x, z) * 22));
  });
  return g;
}

function onHead(az, y, R, sy) {
  const k = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.sin(az) * k * R, y * R * sy, Math.cos(az) * k * R * HEAD_Z];
}

function curlCloud(o, rand, spec) {
  const out = [];
  const hc = o.hairColor;
  const add = (az, y, rr) => {
    const k = 0.9 + rand() * 0.22;
    out.push(ball(shade(hc, k), onHead(az, y, spec.R, o.sy), rr, [rand(), rand(), rand()], 7, 5));
  };
  // fringe row along the hairline
  for (let a = -0.7; a <= 0.71; a += 0.28) add(a, spec.front + 0.03, 0.17 + rand() * 0.04);
  // crown + sides
  for (let k = 0; k < spec.n; k++) {
    const az = (rand() * 2 - 1) * Math.PI;
    const A = Math.abs(az);
    const minY = A < 0.75 ? spec.front + 0.12 : lerp(spec.side, spec.back, smooth(1.4, 2.8, A)) + 0.06;
    const y = lerp(minY, 0.96, Math.pow(rand(), 0.8));
    add(az, y, 0.18 + rand() * 0.07);
  }
  // ringlets hanging by the ears
  if (spec.ringlets) {
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) add(s * (1.3 + rand() * 0.35), 0.15 - k * 0.2, 0.17 - k * 0.012);
    }
  }
  return out;
}

// Returns { geos: [...head-mesh pieces], danglies: [{ geo, pivot, side }] }
function buildHair(style, o, rand) {
  const hc = o.hairColor;
  const accent = o.accent;
  const geos = [];
  const danglies = [];
  const sy = o.sy;
  switch (style) {
    case 'bob': {
      // Maria: soft side-swept fringe, flared at the jaw.
      geos.push(hairShell(o, { front: 0.52, asym: -0.1, side: -0.64, back: -0.72, R: 1.1, flare: 0.12, scallop: 0.04, freq: 10, sideA0: 0.64, sideA1: 1.25 }));
      geos.push(ball(shade(hc, 1.05), [-0.22, 0.66 * sy, 0.72], [0.48, 0.17, 0.2], [0.2, -0.25, 0.32]));
      // tiny edelweiss clip
      const fc = [0.66, 0.6 * sy, 0.62];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        geos.push(ball('#fbf8ef', [fc[0] + Math.cos(a) * 0.07, fc[1] + Math.sin(a) * 0.07, fc[2]], [0.06, 0.035, 0.03], [0, 0, a], 8, 6));
      }
      geos.push(ball('#f2c94c', fc, 0.035, [0, 0, 0], 8, 6));
      break;
    }
    case 'long': {
      geos.push(hairShell(o, { front: 0.56, part: 0.05, side: -0.25, back: -0.75, R: 1.08, scallop: 0.05 }));
      const pts = [[1.0, 0.25], [1.07, -0.1], [1.1, -0.6], [1.16, -1.05], [1.2, -1.42], [1.15, -1.7], [1.0, -1.8]];
      const outer = lathe(pts, 20, 1.05, TAU - 2.1);
      const p = outer.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        let y = p.getY(i);
        const z = p.getZ(i);
        const phi = Math.atan2(x, z);
        const w = 1 + 0.035 * Math.sin(phi * 7 + y * 2.5);
        if (y < -1.55) y += 0.07 * Math.sin(phi * 9);
        p.setXYZ(i, x * w, y * sy, z * w * HEAD_Z);
      }
      outer.computeVertexNormals();
      const inner = outer.clone();
      inner.scale(0.95, 1, 0.95);
      flip(inner);
      for (const g of [outer, inner]) {
        paintFn(g, (x, y, z, c) => c.copy(hc).multiplyScalar(0.72 + 0.2 * smooth(-1.8, 0.2, y)));
        geos.push(g);
      }
      geos.push(place(bow(accent, 0.42), onHead(0.55, 0.78, 1.1, sy), [-0.25, 0.5, -0.5]));
      break;
    }
    case 'short': {
      geos.push(hairShell(o, { front: 0.6, side: 0.26, back: -0.5, R: 1.06, ridge: 0.02, scallop: 0.07, freq: 12 }));
      // little felt hat with a coloured band and a feather
      const felt = '#4a6a43';
      const hat = merge([
        rod([0, 0.66, 0], [0, 1.12, 0], 0.62, 0.8, felt, 20),
        ball(felt, [0, 1.12, 0], [0.62, 0.12, 0.62], [0, 0, 0], 16, 5),
        rod([0, 0.64, 0], [0, 0.7, 0], 1.16, 1.18, shade(felt, 0.9), 22),
        rod([0, 0.7, 0], [0, 0.86, 0], 0.79, 0.81, accent, 20),
        ball('#fbf6e8', [0.6, 1.05, -0.22], [0.06, 0.34, 0.11], [0, 0, -0.55], 8, 6),
        ball(accent, [0.47, 1.28, -0.22], [0.045, 0.13, 0.08], [0, 0, -0.55], 8, 6),
      ]);
      hat.rotateZ(0.12);
      hat.rotateX(-0.08);
      hat.scale(1, sy, HEAD_Z * 1.04);
      geos.push(hat);
      break;
    }
    case 'braids': {
      geos.push(hairShell(o, { front: 0.56, part: 0.06, side: 0.0, back: -0.55, R: 1.07 }));
      // headband over the crown
      const band = new THREE.TorusGeometry(1.1, 0.065, 5, 22, Math.PI);
      band.rotateX(-0.45);
      band.scale(1, sy, HEAD_Z);
      geos.push(paint(band, accent));
      for (const s of [-1, 1]) {
        const parts = [];
        for (let k = 0; k < 6; k++) {
          const wig = k % 2 ? 0.035 : -0.035;
          parts.push(ball(shade(hc, 0.92 + (k % 2) * 0.1), [s * (0.04 * k + wig), -0.19 * k, 0.065 * k], [0.17 - 0.01 * k, 0.15, 0.16 - 0.008 * k], [0, 0, s * wig * 4], 8, 6));
        }
        parts.push(place(bow(accent, 0.22), [s * 0.22, -1.08, 0.42], [0, 0, 0]));
        parts.push(ball(hc, [s * 0.24, -1.26, 0.43], [0.08, 0.12, 0.08], [0, 0, 0], 8, 6));
        danglies.push({ geo: merge(parts), pivot: [s * 0.8, -0.12 * sy, -0.3], side: s });
      }
      break;
    }
    case 'curls': {
      const spec = { front: 0.6, side: o.ringlets ? -0.3 : 0.2, back: o.ringlets ? -0.55 : -0.45, R: 1.06 };
      geos.push(hairShell(o, { front: spec.front, side: spec.side, back: spec.back, R: 1.04, ws: 22, hs: 16, scallop: 0.03 }));
      geos.push(...curlCloud(o, rand, { ...spec, R: 1.1, n: o.ringlets ? 16 : 20, ringlets: o.ringlets }));
      if (o.ringlets) geos.push(place(bow(accent, 0.5), onHead(-0.45, 0.8, 1.2, sy), [-0.2, -0.4, 0.45]));
      break;
    }
    case 'ponytail': {
      geos.push(hairShell(o, { front: 0.56, asym: 0.1, side: 0.12, back: -0.42, R: 1.06 }));
      const tail = [
        [0.13, 0.03, -0.02, 0.2],
        [0.28, -0.1, -0.05, 0.24],
        [0.37, -0.33, -0.05, 0.23],
        [0.38, -0.58, -0.02, 0.19],
        [0.33, -0.8, 0.0, 0.14],
        [0.26, -0.96, 0.02, 0.09],
      ];
      const parts = tail.map(([x, y, z, rr], k) => ball(shade(hc, 0.95 + (k % 2) * 0.08), [x, y, z], [rr, rr * 1.1, rr], [0, 0, -0.3], 10, 8));
      const tor = new THREE.TorusGeometry(0.15, 0.075, 5, 12);
      tor.rotateY(Math.PI / 2);
      tor.rotateZ(-0.35);
      parts.push(paint(tor.translate(0.03, 0.0, 0), accent));
      danglies.push({ geo: merge(parts), pivot: [0.74, 0.5 * sy, -0.38], side: 1 });
      break;
    }
    case 'pigtails': {
      geos.push(hairShell(o, { front: 0.55, part: 0.06, side: -0.05, back: -0.5, R: 1.07, scallop: 0.05, freq: 11 }));
      for (const s of [-1, 1]) {
        const tail = [
          [0.16, -0.08, 0, 0.18],
          [0.27, -0.27, 0.01, 0.2],
          [0.3, -0.48, 0.02, 0.16],
          [0.27, -0.64, 0.03, 0.1],
        ];
        const parts = tail.map(([x, y, z, rr], k) => ball(shade(hc, 0.95 + (k % 2) * 0.08), [s * x, y, z], [rr, rr * 1.1, rr], [0, 0, s * 0.3], 10, 8));
        parts.push(ball(accent, [s * 0.05, 0.02, 0], 0.12, [0, 0, 0], 9, 7));
        parts.push(ball(shade(accent, 1.1), [s * 0.05, 0.13, 0.02], 0.07, [0, 0, 0], 6, 5));
        danglies.push({ geo: merge(parts), pivot: [s * 0.86, 0.25 * sy, -0.18], side: s });
      }
      break;
    }
    default:
      geos.push(hairShell(o, { front: 0.58, side: 0.1, back: -0.5, R: 1.07 }));
  }
  return { geos, danglies };
}

function mouthGeometry(o) {
  const M = 16;
  const rows = [0, 0.1, 0.26, 0.5, 0.76, 1];
  const W = o.mouthW;
  const k = W / 0.24;
  const shapes = [
    // closed-ish smile (base)
    (phi, s) => {
      const x = W * Math.cos(phi);
      const sn = Math.sin(phi);
      const yc = -0.03 + 0.08 * (x / W) * (x / W);
      return [x, lerp(yc + 0.022 * sn, yc - 0.06 * sn, s)];
    },
    // open "Ah"
    (phi, s) => {
      const x = 0.16 * k * Math.cos(phi);
      const sn = Math.sin(phi);
      return [x, lerp(-0.01 + 0.1 * sn, -0.02 - 0.21 * sn, s)];
    },
    // small "o"
    (phi, s) => {
      const x = 0.08 * k * Math.cos(phi);
      const sn = Math.sin(phi);
      return [x, lerp(-0.03 + 0.08 * sn, -0.03 - 0.1 * sn, s)];
    },
  ];
  const nV = (M + 1) * rows.length;
  const arrays = shapes.map(() => new Float32Array(nV * 3));
  const normal = new Float32Array(nV * 3);
  const color = new Float32Array(nV * 3);
  const dark = col('#4a1820');
  const lip = col('#7a2c30');
  const teeth = col('#fff8ef');
  const tongue = col('#d9707a');
  let vi = 0;
  for (let j = 0; j <= M; j++) {
    const phi = Math.PI * (1 - j / M);
    const central = Math.abs(Math.cos(phi)) < 0.62;
    for (let r = 0; r < rows.length; r++) {
      const s = rows[r];
      shapes.forEach((fn, si) => {
        const [x, y] = fn(phi, s);
        const yy = o.mouthY + y;
        const z = ellipsoidZ(x, yy, o.sy) + 0.018;
        arrays[si].set([x, yy, z], vi * 3);
        if (si === 0) {
          const n = V(x, yy / (o.sy * o.sy), z / (HEAD_Z * HEAD_Z)).normalize();
          normal.set([n.x, n.y, n.z], vi * 3);
        }
      });
      let c = dark;
      if (r === 0 || r === rows.length - 1) c = lip;
      else if (r === 1 && central) c = teeth;
      else if (r === 4 && central) c = tongue;
      color.set([c.r, c.g, c.b], vi * 3);
      vi++;
    }
  }
  const idx = [];
  const R = rows.length;
  for (let j = 0; j < M; j++) {
    for (let r = 0; r < R - 1; r++) {
      const a = j * R + r;
      const b = (j + 1) * R + r;
      const c = j * R + r + 1;
      const d = (j + 1) * R + r + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arrays[0], 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(idx);
  g.morphAttributes.position = [new THREE.BufferAttribute(arrays[1], 3), new THREE.BufferAttribute(arrays[2], 3)];
  g.computeBoundingSphere();
  g.boundingSphere.radius += 0.25; // room for the morphs
  return g;
}

// Builds every head-level geometry for one character.
function buildHead(o, rand) {
  const { sy, ex, ey, eR } = o;
  const ez = ellipsoidZ(ex, ey, sy) - eR * 0.5;
  const skin = col(o.skin);
  const blush = col('#f07f78');
  const pieces = [];

  // skull / face with soft painted blush and chubby cheeks
  let g = new THREE.SphereGeometry(1, 26, 18);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    let z = p.getZ(i);
    let bump = 0;
    if (z > 0) for (const s of [-1, 1]) bump += o.chubby * Math.exp(-((x - s * 0.52) ** 2 + (y - (ey - 0.3)) ** 2 + (z - 0.78) ** 2) / 0.05);
    x *= 1 + bump;
    z *= 1 + bump;
    if (o.jaw) {
      const kk = smooth(-0.3, -0.95, y);
      x *= 1 - o.jaw * kk;
      z *= 1 - o.jaw * 0.35 * kk;
    }
    p.setXYZ(i, x, y * sy, z * HEAD_Z);
  }
  g = smoothNormals(g);
  paintFn(g, (x, y, z, c) => {
    c.copy(skin);
    if (z > 0) {
      const yy = y / sy;
      let w = 0;
      for (const s of [-1, 1]) w = Math.max(w, Math.exp(-((x - s * 0.5) ** 2 + (yy - (ey - 0.3)) ** 2) / 0.03));
      c.lerp(blush, 0.55 * w);
    }
  });
  pieces.push(g);

  // ears, nose
  for (const s of [-1, 1]) pieces.push(ball(skin, [s * 0.95, (ey - 0.08) * sy, -0.04], [0.2, 0.3, 0.15], [0, s * -0.3, 0], 9, 7));
  const ny = ey - 0.21;
  pieces.push(ball(mix(skin, '#e88f7c', 0.25), [0, ny * sy, ellipsoidZ(0, ny * sy, sy) + 0.01], [o.noseR, o.noseR * 0.82, o.noseR * 0.85], [0, 0, 0], 10, 7));

  // sclera (whites), faintly shaded at the rims
  for (const s of [-1, 1]) {
    const sc = new THREE.SphereGeometry(eR, 12, 9);
    paintFn(sc, (x, y, z, c) => c.set('#fbfbf8').lerp(col('#cfd5e2'), smooth(0.4, -0.3, z / eR)));
    pieces.push(sc.translate(s * ex, ey, ez));
  }

  // hair (+ head accessories)
  const hair = buildHair(o.hair, o, rand);
  pieces.push(...hair.geos);
  const headGeo = merge(pieces);

  // irises + pupils (eye-centred; shared by both eyes)
  const irisGeo = cached(`iris:${o.eyeColor}:${eR}:${o.irisA}`, () => {
    const ec = col(o.eyeColor);
    const light = mix(ec, '#ffffff', 0.35);
    const darkC = shade(ec, 0.42);
    const ir = new THREE.SphereGeometry(eR * 1.006, 18, 4, 0, TAU, 0, o.irisA);
    ir.rotateX(Math.PI / 2);
    paintFn(ir, (x, y, z, c) => {
      const a = Math.acos(clamp(z / (eR * 1.006), -1, 1));
      const tt = a / o.irisA;
      c.copy(light).lerp(ec, smooth(0.25, 0.6, tt)).lerp(darkC, smooth(0.74, 1, tt));
    });
    const pu = new THREE.SphereGeometry(eR * 1.014, 14, 2, 0, TAU, 0, o.irisA * 0.46);
    pu.rotateX(Math.PI / 2);
    paint(pu, '#140b0e');
    const m = merge([ir, pu]);
    m.scale(1, 1.08, 1);
    return m;
  });

  // highlights
  const sh = [];
  const d1 = V(0.36, 0.4, 0.84).normalize();
  const d2 = V(-0.32, -0.26, 0.91).normalize();
  for (const s of [-1, 1]) {
    for (const [d, sz] of [[d1, 0.21], [d2, 0.09]]) {
      const disc = new THREE.SphereGeometry(1, 8, 4);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d);
      disc.applyMatrix4(new THREE.Matrix4().compose(V(s * ex, ey, ez).addScaledVector(d, eR * 1.025), q, V(eR * sz, eR * sz, eR * 0.035)));
      sh.push(disc);
    }
  }
  const shineGeo = merge(sh);

  // upper lids (both eyes share one hinge line) + lash rims
  const lidC = mix(skin, '#e2957f', 0.18);
  const lashC = col(o.lashColor || '#2b1a14');
  const lp = [];
  for (const s of [-1, 1]) {
    const cap = new THREE.SphereGeometry(eR * 1.12, 14, 5, 0, TAU, 0, Math.PI / 2);
    lp.push(paint(cap.translate(s * ex, 0, 0), lidC));
    const rim = new THREE.TorusGeometry(eR * 1.12, eR * 0.075, 4, 12, Math.PI);
    rim.rotateX(Math.PI / 2);
    lp.push(paint(rim.translate(s * ex, 0, 0), lashC));
    if (o.lashes) {
      for (const [a, len, tilt] of [[0.28, 0.2, 0.55], [0.6, 0.14, 0.9]]) {
        const ang = s > 0 ? a : Math.PI - a;
        const px = Math.cos(ang) * eR * 1.14 + s * ex;
        const pz = Math.sin(ang) * eR * 1.14;
        lp.push(ball(lashC, [px + s * eR * len * 0.6, eR * 0.04, pz], [eR * len, eR * 0.045, eR * 0.05], [0, -s * 0.2, s * tilt], 6, 4));
      }
    }
  }
  const lidGeo = merge(lp);

  // brows
  const by = ey + eR + 0.1;
  const bp = [];
  const browC = shade(o.browColor || o.hairColor, 0.7);
  for (const s of [-1, 1]) {
    const pts = [
      [s * (ex - 0.15), by - 0.015],
      [s * ex, by + 0.05],
      [s * (ex + 0.17), by - 0.01],
    ].map(([x, y]) => V(x, y * sy, ellipsoidZ(x, y * sy, sy) + 0.025));
    const curve = new THREE.QuadraticBezierCurve3(pts[0], pts[1], pts[2]);
    bp.push(paint(new THREE.TubeGeometry(curve, 8, o.browT, 5, false), browC));
    bp.push(ball(browC, curve.getPoint(0).toArray(), o.browT, [0, 0, 0], 6, 4));
    bp.push(ball(browC, curve.getPoint(1).toArray(), o.browT * 0.8, [0, 0, 0], 6, 4));
  }
  const browGeo = merge(bp);

  return {
    headGeo,
    irisGeo,
    shineGeo,
    lidGeo,
    browGeo,
    mouthGeo: mouthGeometry(o),
    eyes: [V(-ex, ey, ez), V(ex, ey, ez)],
    lidPivot: V(0, ey, ez),
    danglies: hair.danglies,
  };
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

const CREAM = '#f3ead6';
const WHITE = '#fbf8f0';

function buildKidBody(P) {
  const { r, sh, hipY, sw, girl, skin, accent } = P;
  const zf = 0.8;
  const Y = (y) => y - hipY; // torso-local
  const lower = [];
  const body = [];
  const fabric = [];

  // ---- legs (rig space) ----
  const legR = r * 0.26;
  const legX = sw * 0.42;
  const shoeC = girl ? '#7a2f24' : '#4a2e1f';
  for (const s of [-1, 1]) {
    lower.push(limb([s * legX, legR * 1.05, 0], [s * legX * 0.96, hipY + 0.02, 0], legR, skin));
    if (girl) {
      lower.push(rod([s * legX, legR * 0.4, 0], [s * legX, legR * 2.3, 0], legR * 1.13, legR * 1.13, WHITE, 10));
      lower.push(ball(WHITE, [s * legX, legR * 2.3, 0], [legR * 1.18, legR * 0.3, legR * 1.18], [0, 0, 0], 10, 4));
    } else {
      const top = hipY * 0.58;
      lower.push(rod([s * legX, legR * 0.4, 0], [s * legX, top, 0], legR * 1.12, legR * 1.12, accent, 10));
      const fold = new THREE.TorusGeometry(legR * 1.13, legR * 0.22, 4, 10);
      fold.rotateX(Math.PI / 2);
      lower.push(paint(fold.translate(s * legX, top, 0), CREAM));
    }
    lower.push(ball(shoeC, [s * legX, legR * 1.0, legR * 0.55], [legR * 1.45, legR * 0.95, legR * 2.05], [0, 0, 0], 10, 7));
  }

  // neck
  body.push(limb([0, Y(sh - r * 0.1), 0], [0, Y(sh + r * 0.5), 0], r * 0.28, skin));

  let shirtPts = null;
  if (girl) {
    const waist = hipY + (sh - hipY) * 0.38;
    const hem = hipY * 0.45;
    const pts = [
      [sw * 1.0, hem + 0.012],
      [sw * 1.2, hem],
      [sw * 1.14, lerp(hem, waist, 0.35)],
      [sw * 0.98, lerp(hem, waist, 0.72)],
      [sw * 0.8, waist],
      [sw * 0.84, lerp(waist, sh, 0.5)],
      [sw * 0.92, sh - r * 0.12],
      [sw * 0.78, sh],
      [sw * 0.42, sh + r * 0.06],
      [r * 0.3, sh + r * 0.08],
    ];
    fabric.push(fabricLathe(pts, 24, zf, -hipY));
    for (const s of [-1, 1]) {
      const puff = new THREE.SphereGeometry(1, 12, 8);
      uvScale(puff, (TAU * r * 0.3) / TILE, (Math.PI * r * 0.3) / TILE);
      fabric.push(place(puff, [s * sw * 0.93, Y(sh - r * 0.16), 0], [0, 0, 0], [r * 0.31, r * 0.29, r * 0.29]));
      // Peter Pan collar
      body.push(ball(WHITE, [s * r * 0.17, Y(sh + r * 0.04), r * 0.22], [r * 0.25, r * 0.07, r * 0.17], [0.25, 0, s * -0.3], 10, 6));
    }
    // accent sash + bow
    const bandR = sw * 0.84;
    body.push(bodyLathe([[bandR - 0.004, waist - r * 0.14], [bandR, waist - r * 0.11], [bandR + 0.003, waist], [bandR, waist + r * 0.11], [bandR - 0.004, waist + r * 0.14]], 24, zf, -hipY, accent));
    body.push(place(bow(accent, r * 0.36), [sw * 0.5, Y(waist), bandR * zf * 0.86 + r * 0.04], [0, 0.55, 0]));
  } else {
    const waist = hipY + (sh - hipY) * 0.22;
    shirtPts = [
      [sw * 0.78, hipY - r * 0.05],
      [sw * 0.84, waist],
      [sw * 0.86, lerp(waist, sh, 0.5)],
      [sw * 0.92, sh - r * 0.12],
      [sw * 0.78, sh],
      [sw * 0.42, sh + r * 0.06],
      [r * 0.3, sh + r * 0.08],
    ];
    body.push(bodyLathe(shirtPts, 24, zf, -hipY, CREAM));
    const shortsPts = [
      [sw * 0.5, hipY - r * 0.34],
      [sw * 0.86, hipY - r * 0.18],
      [sw * 0.9, waist],
      [sw * 0.87, waist + r * 0.06],
      [sw * 0.6, waist + r * 0.07],
    ];
    fabric.push(fabricLathe(shortsPts, 24, zf, -hipY));
    const legTop = hipY - r * 0.12;
    const legBot = hipY - r * 0.95;
    for (const s of [-1, 1]) {
      const tube = new THREE.CylinderGeometry(legR * 1.75, legR * 2.0, legTop - legBot, 14, 1, true);
      uvScale(tube, (TAU * legR * 2) / TILE, (legTop - legBot) / TILE);
      fabric.push(tube.translate(s * legX, Y((legTop + legBot) / 2), 0));
    }
    // braces (dark green) with a front bar and buttons
    const brace = '#3b5a35';
    const front = (y) => profR(shirtPts, y) * zf + r * 0.035;
    const ym = lerp(waist, sh, 0.55);
    for (const s of [-1, 1]) {
      const pts = [
        V(s * sw * 0.4, Y(waist), front(waist)),
        V(s * sw * 0.42, Y(ym), front(ym)),
        V(s * sw * 0.5, Y(sh + r * 0.02), sw * 0.32 * zf),
        V(s * sw * 0.5, Y(sh + r * 0.05), 0),
        V(s * sw * 0.48, Y(sh), -sw * 0.5 * zf),
        V(s * sw * 0.4, Y(waist), -front(waist)),
      ];
      body.push(paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r * 0.05, 4, false), brace));
      body.push(ball(CREAM, [s * sw * 0.4, Y(waist + r * 0.06), front(waist) + r * 0.03], r * 0.05, [0, 0, 0], 8, 6));
    }
    body.push(paint(place(new THREE.BoxGeometry(sw * 0.84, r * 0.12, r * 0.05), [0, Y(ym), front(ym) + r * 0.01]), brace));
    // neckerchief (accent)
    const nf = front(sh - r * 0.22);
    const ring = new THREE.TorusGeometry(r * 0.33, r * 0.09, 5, 14);
    ring.rotateX(Math.PI / 2 - 0.15);
    body.push(paint(ring.translate(0, Y(sh + r * 0.08), 0), accent));
    const tri = new THREE.ConeGeometry(r * 0.38, r * 0.66, 10);
    tri.rotateX(Math.PI);
    tri.scale(1, 1, 0.3);
    body.push(paint(place(tri, [0, Y(sh - r * 0.24), nf + r * 0.02], [-0.3, 0, 0]), accent));
    body.push(ball(shade(accent, 0.9), [0, Y(sh + r * 0.03), r * 0.36], r * 0.12, [0, 0, 0], 10, 8));
  }

  // arms (hang along -Y from the shoulder pivot); same geometry both sides
  const armLen = (sh - hipY) * 1.12 + r * 0.12;
  const aR = r * 0.19;
  const hR = r * 0.27;
  const arm = [limb([0, -r * 0.05, 0], [0, -armLen + hR * 0.6, 0], aR, skin)];
  if (!girl) arm.push(limb([0, 0, 0], [0, -armLen * 0.36, 0], aR * 1.45, CREAM));
  arm.push(ball(skin, [0, -armLen, r * 0.02], [hR * 0.85, hR, hR * 0.8], [0, 0, 0], 10, 8));
  arm.push(ball(skin, [0, -armLen + hR * 0.2, hR * 0.7], [hR * 0.3, hR * 0.45, hR * 0.3], [0.4, 0, 0], 6, 4));

  return {
    lowerGeo: merge(lower),
    bodyGeo: merge(body),
    fabricGeo: merge(fabric),
    armGeo: merge(arm),
    shoulders: [V(-sw * 0.93, Y(sh - r * 0.16), 0), V(sw * 0.93, Y(sh - r * 0.16), 0)],
  };
}

// Maria: dress, apron, guitar. Coordinates hand-placed for H = 1.65 m.
function buildMariaBody(P) {
  const { hipY, skin, r } = P;
  const zf = 0.8;
  const Y = (y) => y - hipY;
  const dress = '#7f93ab';
  const lower = [];
  const body = [];

  // legs + shoes
  for (const s of [-1, 1]) {
    lower.push(limb([s * 0.07, 0.06, 0], [s * 0.07, 0.62, 0], 0.044, mix(skin, '#c99a82', 0.25)));
    lower.push(ball('#4b3024', [s * 0.07, 0.047, 0.035], [0.055, 0.045, 0.095], [0, 0, 0], 12, 8));
  }

  // dress
  const dressPts = [
    [0.25, 0.312],
    [0.3, 0.3],
    [0.27, 0.5],
    [0.215, 0.75],
    [0.16, 0.92],
    [0.135, 1.0],
    [0.15, 1.08],
    [0.168, 1.15],
    [0.172, 1.19],
    [0.14, 1.225],
    [0.075, 1.245],
    [0.045, 1.25],
  ];
  body.push(bodyLathe(dressPts, 26, zf, -hipY, dress));
  // apron skirt, bib, waistband, little lace edge
  body.push(bodyLathe([[0.31, 0.37], [0.292, 0.5], [0.24, 0.72], [0.186, 0.88], [0.158, 0.965]], 18, zf, -hipY, CREAM, -0.95, 1.9));
  body.push(bodyLathe([[0.152, 0.99], [0.162, 1.08], [0.176, 1.14]], 10, zf, -hipY, CREAM, -0.52, 1.04));
  body.push(bodyLathe([[0.144, 0.948], [0.15, 0.975], [0.144, 1.0]], 22, zf, -hipY, CREAM));
  for (let k = 0; k <= 8; k++) {
    const a = -0.95 + (1.9 * k) / 8;
    body.push(ball(WHITE, [Math.sin(a) * 0.312, Y(0.372), Math.cos(a) * 0.312 * zf], 0.016, [0, 0, 0], 5, 3));
  }
  for (const s of [-1, 1]) {
    const strap = new THREE.CatmullRomCurve3([
      V(s * 0.085, Y(1.14), 0.165 * zf * 0.95),
      V(s * 0.1, Y(1.2), 0.12 * zf),
      V(s * 0.1, Y(1.236), 0),
      V(s * 0.09, Y(1.2), -0.14 * zf),
      V(s * 0.06, Y(1.0), -0.15 * zf),
    ]);
    body.push(paint(new THREE.TubeGeometry(strap, 10, 0.009, 3, false), CREAM));
    // collar + shoulder puffs
    body.push(ball(WHITE, [s * 0.042, Y(1.247), 0.04], [0.055, 0.016, 0.04], [0.25, 0, s * -0.3], 10, 6));
    body.push(ball(dress, [s * 0.172, Y(1.195), 0], 0.06, [0, 0, 0], 10, 8));
  }
  // neck
  body.push(limb([0, Y(1.2), 0], [0, Y(P.centreY - 0.5 * r), 0], r * 0.25, skin));

  // guitar (built along +X in its own frame, then placed across the body)
  const top = 0.042;
  const sideC = '#7a4424';
  const outline = [];
  const C1 = [-0.12, 0, 0.165];
  const C2 = [0.07, 0, 0.125];
  const cx = -0.03;
  const NS = 44;
  for (let k = 0; k < NS; k++) {
    const th = (k / NS) * TAU;
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    let best = 0;
    for (const [ccx, ccy, cr] of [C1, C2]) {
      const ox = cx - ccx;
      const oy = -ccy;
      const b = ox * dx + oy * dy;
      const c = ox * ox + oy * oy - cr * cr;
      best = Math.max(best, -b + Math.sqrt(Math.max(0, b * b - c)));
    }
    outline.push([cx + dx * best, dy * best]);
  }
  for (let pass = 0; pass < 2; pass++) {
    const prev = outline.map((q) => q.slice());
    for (let k = 0; k < NS; k++) {
      const a = prev[(k + NS - 1) % NS];
      const b = prev[(k + 1) % NS];
      outline[k] = [(a[0] + 2 * prev[k][0] + b[0]) / 4, (a[1] + 2 * prev[k][1] + b[1]) / 4];
    }
  }
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const gb = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 2 });
  gb.translate(0, 0, -0.03);
  paintFn(gb, (x, y, z, c) => {
    if (z > 0.028) c.set('#e3ad62').lerp(col('#c98a45'), smooth(0.09, 0.17, Math.hypot(x - cx, y)));
    else if (z < -0.028) c.set('#8f5530');
    else c.set(sideC);
  });
  const gp = [gb];
  const hole = new THREE.CylinderGeometry(0.046, 0.046, 0.004, 16);
  hole.rotateX(Math.PI / 2);
  gp.push(paint(hole.translate(0.035, 0, top + 0.001), '#24150d'));
  const ros = new THREE.TorusGeometry(0.054, 0.006, 3, 18);
  gp.push(paint(ros.translate(0.035, 0, top + 0.001), '#7a4a2a'));
  gp.push(paint(place(new THREE.BoxGeometry(0.03, 0.11, 0.012), [-0.165, 0, top + 0.004]), '#3a2416'));
  gp.push(paint(place(new THREE.BoxGeometry(0.38, 0.05, 0.03), [0.36, 0, top - 0.008]), '#6b3d1e'));
  gp.push(paint(place(new THREE.BoxGeometry(0.37, 0.046, 0.006), [0.36, 0, top + 0.009]), '#2e1d14'));
  gp.push(paint(place(new THREE.BoxGeometry(0.14, 0.068, 0.024), [0.61, 0, top - 0.01], [0, -0.12, 0]), '#5a3218'));
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) gp.push(ball('#f2e6c8', [0.57 + k * 0.04, s * 0.045, top - 0.01], 0.011, [0, 0, 0], 5, 3));
  }
  for (let k = 0; k < 6; k++) {
    gp.push(paint(place(new THREE.BoxGeometry(0.73, 0.0022, 0.0022), [0.2, (k - 2.5) * 0.0075, top + 0.016]), '#efe4cc'));
  }
  const guitar = merge(gp);
  const gRot = 0.42;
  const gPos = V(-0.02, 0.14, 0.205);
  guitar.applyMatrix4(new THREE.Matrix4().compose(gPos, new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), gRot), V(1, 1, 1)));
  const gPt = (x, y, z) => V(x, y, z).applyAxisAngle(V(0, 0, 1), gRot).add(gPos);
  const strapCurve = new THREE.CatmullRomCurve3([
    gPt(0.19, 0, -0.04),
    V(0.17, 0.32, 0.12),
    V(0.16, 0.392, 0.05),
    V(0.14, 0.407, -0.04),
    V(0.1, 0.36, -0.125),
    V(-0.05, 0.2, -0.145),
    V(-0.2, 0.08, -0.13),
    V(-0.3, 0.03, 0.0),
    gPt(-0.3, 0, -0.03),
  ]);
  const strap = paint(new THREE.TubeGeometry(strapCurve, 30, 0.011, 4, false), '#b8463a');
  const guitarGeo = merge([guitar, strap]);

  // arms
  const sleeve = dress;
  const SR = V(-0.172, 0.355, 0);
  const ER = V(-0.25, 0.14, 0.11);
  const HR = gPt(-0.04, 0, 0.075);
  const SL = V(0.172, 0.355, 0);
  const EL = V(0.3, 0.13, 0.04);
  const HL = gPt(0.42, 0, -0.02);

  const lp = [];
  const rel = (v) => v.clone().sub(SL);
  lp.push(limb(rel(SL), rel(EL), 0.043, sleeve));
  const wristL = EL.clone().lerp(HL, 0.55);
  lp.push(limb(rel(EL), rel(wristL), 0.038, sleeve));
  lp.push(limb(rel(wristL), rel(HL), 0.031, skin));
  lp.push(ball(skin, rel(HL).toArray(), [0.042, 0.05, 0.036], [0, 0, 0.4], 10, 7));
  for (let k = 0; k < 3; k++) lp.push(ball(skin, rel(HL).add(V(-0.012 + k * 0.016, 0.022 - k * 0.012, 0.045)).toArray(), 0.014, [0, 0, 0], 5, 4));
  const armLGeo = merge(lp);

  const dU = ER.clone().sub(SR);
  const LU = dU.length();
  const dF = HR.clone().sub(ER);
  const LF = dF.length();
  const qU = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dU.normalize());
  const qF = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dF.normalize());
  const qUc = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), V(-0.42, 0.9, 0.14).normalize());
  const upperGeo = merge([limb([0, 0, 0], [0, -LU, 0], 0.043, sleeve)]);
  const foreGeo = merge([
    limb([0, 0, 0], [0, -LF * 0.55, 0], 0.038, sleeve),
    limb([0, -LF * 0.55, 0], [0, -LF, 0], 0.031, skin),
    ball(skin, [0, -LF - 0.02, 0.005], [0.04, 0.052, 0.032], [0, 0, 0], 10, 7),
  ]);

  return {
    lowerGeo: merge(lower),
    bodyGeo: merge(body),
    guitarGeo,
    armLGeo,
    upperGeo,
    foreGeo,
    SL,
    SR,
    LU,
    qU,
    qF,
    qUc,
  };
}

// ---------------------------------------------------------------------------
// Animation rig
// ---------------------------------------------------------------------------

const MOODS = new Set(['idle', 'happy', 'oops', 'cheer']);
const _v = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

class Rig {
  constructor(parts, cfg) {
    Object.assign(this, parts);
    this.cfg = cfg;
    this.rand = rng(cfg.seed);
    const R = this.rand;
    this.phase = R() * TAU;
    this.phase2 = R() * TAU;
    this.breathRate = 1.55 + R() * 0.4;
    this.clock = 0;

    this.hopPhase = 'ground';
    this.y = 0;
    this.vy = 0;
    this.anticT = 0;
    this.anticDur = 0.06;
    this.hopS = 1;
    this.hopH = 0;
    this.queued = 0;
    this.lastHopCall = -10;
    this.interval = 1;

    this.sq = { x: 1, v: 0 };
    this.lift = { x: 0, v: 0 };
    this.armOut = [{ x: cfg.armRest, v: 0 }, { x: cfg.armRest, v: 0 }];
    this.armFwd = [{ x: 0, v: 0 }, { x: 0, v: 0 }];
    this.nod = { x: 0, v: 0 };
    this.sway = { x: 0, v: 0 };
    this.wobble = { x: 0, v: 0 };
    this.strumS = { x: 0, v: 0 };
    this.dang = this.danglyMeshes.map((m) => ({ mesh: m, side: m.userData.side, x: 0, v: 0, ph: R() * TAU }));
    this.tgt = { outL: cfg.armRest, outR: cfg.armRest, fwdL: 0, fwdR: 0 };

    this.mood = 'idle';
    this.moodT = 0;
    this.oopsSide = 1;
    this.cheerWait = 0;
    this.cheerBlend = 0;

    this.singT = 0;
    this.singAmt = 0;
    this.singOpen = 1;
    this.singRound = 0;
    this.singRoll = 0;
    this.mouthOpen = 0;
    this.mouthO = 0;
    this.lid = cfg.lidOpen;
    this.browY = 0;
    this.pitchM = 0;
    this.rollM = 0;
    this.lean = 0;

    this.blinkWait = 0.6 + R() * 2.5;
    this.blinkT = -1;
    this.doubleBlink = false;

    this.look = null;
    this.headYaw = 0;
    this.headPitch = 0;
    this.eyeYaw = 0;
    this.eyePitch = 0;
    this.sacc = { x: 0, y: 0, tx: 0, ty: 0, wait: 1 + R() * 2 };

    this.beatSide = R() < 0.5 ? 1 : -1;
    this.lastStrum = -10;
    this.strumDir = -1;
  }

  // ---- public API ----
  hop(strength = 1) {
    const s = clamp(fin(strength, 1), 0.1, 1.6);
    this.interval = clamp(this.clock - this.lastHopCall, 0, 2);
    this.lastHopCall = this.clock;
    if (this.hopPhase === 'ground') this._startHop(s, false);
    else if (this.hopPhase === 'antic') {
      this.hopS = Math.max(this.hopS, s);
      this.hopH = this._fitHeight(this.hopS);
    } else this.queued = Math.max(this.queued, s);
  }

  sing(duration = 0.3) {
    const d = clamp(fin(duration, 0.3), 0.05, 6);
    if (this.singT > 0 || this.singAmt > 0.3) this.mouthOpen *= 0.4; // re-articulate
    this.singT = d;
    const R = this.rand;
    this.singOpen = 0.78 + 0.22 * R();
    this.singRound = R() < 0.3 ? 0.3 + 0.35 * R() : 0;
    this.singRoll = (R() - 0.5) * 0.16;
    this.nod.v -= 0.5;
  }

  beat() {
    this.sq.v -= 0.55;
    this.nod.v += 1.3;
    this.beatSide = -this.beatSide;
    this.sway.v += 0.32 * this.beatSide;
    for (const d of this.dang) d.v -= 0.8;
  }

  setMood(mood) {
    const m = MOODS.has(mood) ? mood : 'idle';
    if (m === this.mood && m !== 'oops') return;
    this.mood = m;
    this.moodT = 0;
    if (m === 'oops') {
      this.oopsSide = this.rand() < 0.5 ? -1 : 1;
      if (Math.abs(this.wobble.x) < 0.1) this.wobble.v += this.oopsSide * 1.7;
      this.sq.v -= 1.3;
      this.blinkT = -1;
    } else if (m === 'cheer') {
      this.cheerWait = 0;
    }
  }

  lookAt(x, y, z) {
    if (x && x.isVector3) return this.lookAt(x.x, x.y, x.z);
    if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      this.look = null;
      return;
    }
    this.look = (this.look || new THREE.Vector3()).set(x, y, z);
  }

  strum() {
    if (!this.foreR) return;
    const dir = this.clock - this.lastStrum < 0.32 ? -this.strumDir : -1;
    this.strumDir = dir;
    this.lastStrum = this.clock;
    this.strumS.v += dir * 8;
    this.sq.v -= 0.15;
    this.nod.v += 0.3;
  }

  update(dt, t) {
    dt = clamp(fin(dt, 0), 0, 0.1);
    this.clock += dt;
    const time = fin(t, this.clock);

    this.singT -= dt;
    this.moodT += dt;
    if (this.mood === 'oops' && this.moodT >= 0.8) {
      this.mood = 'idle';
      this.moodT = 0;
    }
    this._armTargets(time);

    const n = Math.min(14, Math.max(1, Math.ceil(dt * 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._step(h, time);

    this._pose(dt, time);
  }

  // ---- hop physics ----
  _fitHeight(s) {
    const natural = this.cfg.hopH * s;
    const air = clamp(this.interval - this.anticDur - 0.05, 0.13, 0.6);
    return Math.max(0.03, Math.min(natural, (G * air * air) / 8));
  }

  _startHop(s, quick) {
    this.hopPhase = 'antic';
    this.anticT = 0;
    this.anticDur = quick ? 0.035 : 0.06;
    this.hopS = s;
    this.hopH = this._fitHeight(s);
  }

  _launch() {
    this.hopPhase = 'air';
    this.vy = Math.sqrt(2 * G * this.hopH);
    this.sq.v += 2.2 * this.hopS;
    for (const d of this.dang) d.v -= 3 * this.hopS;
  }

  _land() {
    const impact = Math.min(-this.vy, 8);
    this.y = 0;
    this.vy = 0;
    this.hopPhase = 'ground';
    this.sq.v -= impact * 1.1;
    this.lift.v -= 2;
    for (const d of this.dang) d.v -= impact * 0.9;
    this.cheerWait = 0.05 + 0.07 * this.rand();
    if (this.queued > 0) {
      const s = this.queued;
      this.queued = 0;
      this._startHop(s, true);
    }
  }

  _step(h, t) {
    if (this.mood === 'cheer' && this.hopPhase === 'ground' && !this.queued) {
      this.cheerWait -= h;
      if (this.cheerWait <= 0) {
        this.interval = 0.46;
        this._startHop(0.45 + 0.2 * this.rand(), false);
      }
    }
    if (this.hopPhase === 'antic') {
      this.anticT += h;
      if (this.anticT >= this.anticDur) this._launch();
    } else if (this.hopPhase === 'air') {
      this.vy -= G * h;
      this.y += this.vy * h;
      if (this.y <= 0) this._land();
    }

    const air = this.hopPhase === 'air';
    const antic = this.hopPhase === 'antic';
    const sqT = antic ? 1 - 0.2 * this.hopS : air ? 1 + clamp(Math.abs(this.vy) * 0.03, 0, 0.13) : 1;
    spring(this.sq, sqT, 520, 15, h);
    if (this.sq.x < 0.72) {
      this.sq.x = 0.72;
      this.sq.v = Math.max(0, this.sq.v);
    } else if (this.sq.x > 1.28) {
      this.sq.x = 1.28;
      this.sq.v = Math.min(0, this.sq.v);
    }

    spring(this.lift, air ? Math.min(1.2, this.hopS) : antic ? -0.25 : 0, 170, 15, h);
    const T = this.tgt;
    spring(this.armOut[0], T.outL, 120, 14, h);
    spring(this.armOut[1], T.outR, 120, 14, h);
    spring(this.armFwd[0], T.fwdL, 120, 14, h);
    spring(this.armFwd[1], T.fwdR, 120, 14, h);
    spring(this.nod, 0, 160, 11, h);
    spring(this.sway, 0, 60, 7, h);
    spring(this.wobble, 0, 150, 4.5, h);
    this.wobble.x = clamp(this.wobble.x, -0.3, 0.3);
    spring(this.strumS, 0, 230, 17, h);
    for (const d of this.dang) {
      const tgt = (air ? 0.4 * Math.min(1.2, this.hopS) : 0) + 0.06 * Math.sin(t * 1.4 + d.ph) - this.wobble.x * 1.2 * d.side;
      spring(d, tgt, 70, 4.5, h);
      d.x = clamp(d.x, -0.9, 0.9);
    }
  }

  _armTargets(t) {
    const c = this.cfg;
    const T = this.tgt;
    const breath = Math.sin(t * this.breathRate + this.phase);
    let outL = c.armRest + 0.025 * breath;
    let outR = outL;
    const sw = 0.04 * Math.sin(t * 0.8 + this.phase2);
    let fwdL = sw;
    let fwdR = -sw;
    const m = this.mood;
    if (m === 'happy') {
      outL = 0.45 + 0.12 * Math.sin(t * 4 + this.phase);
      outR = 0.45 + 0.12 * Math.sin(t * 4 + this.phase + Math.PI);
      fwdL = fwdR = -0.12;
    } else if (m === 'cheer') {
      outL = 2.6 + 0.28 * Math.sin(t * 9 + this.phase);
      outR = 2.6 + 0.28 * Math.sin(t * 9 + this.phase + Math.PI);
      fwdL = fwdR = -0.2;
    } else if (m === 'oops') {
      if (this.moodT < 0.38) {
        outL = 1.15 + 0.3 * Math.sin(t * 26);
        outR = 1.15 + 0.3 * Math.sin(t * 26 + 1.7);
        fwdL = fwdR = -0.45;
      } else {
        outL = outR = 0.1;
        fwdL = fwdR = -0.5;
      }
    }
    if (m !== 'cheer') {
      outL += 0.22 * this.singAmt;
      outR += 0.22 * this.singAmt;
      fwdL -= 0.15 * this.singAmt;
      fwdR -= 0.15 * this.singAmt;
    }
    T.outL = outL;
    T.outR = outR;
    T.fwdL = fwdL;
    T.fwdR = fwdR;
  }

  // ---- per-frame pose ----
  _pose(dt, t) {
    const c = this.cfg;
    const R = this.rand;
    const m = this.mood;
    const mt = this.moodT;

    // expression targets
    let lidT = c.lidOpen;
    let browT = 0;
    let openT = 0;
    let oT = 0;
    let pitchT = 0;
    let rollT = 0;
    let leanT = 0;
    if (m === 'happy') {
      lidT = c.lidOpen + 0.2;
      browT = 0.05;
      openT = 0.28;
      rollT = 0.06 * Math.sin(t * 2.2 + this.phase);
    } else if (m === 'cheer') {
      lidT = c.lidOpen - 0.15;
      browT = 0.09;
      openT = 0.7 + 0.14 * Math.sin(t * 7.3 + this.phase);
      pitchT = -0.12;
      leanT = -0.05;
    } else if (m === 'oops') {
      if (mt < 0.38) {
        lidT = -1.08;
        browT = 0.15;
        oT = 0.95;
        pitchT = 0.06;
      } else {
        lidT = 0.18;
        browT = 0.06;
        openT = 0.12;
        rollT = 0.16 * this.oopsSide;
        pitchT = 0.05;
      }
    }

    const singing = this.singT > 0;
    this.singAmt = damp(this.singAmt, singing ? 1 : 0, singing ? 28 : 12, dt);
    const sa = this.singAmt;
    openT = Math.max(openT, sa * this.singOpen * (1 - this.singRound));
    oT = Math.max(oT, sa * this.singRound);
    if (!(m === 'oops' && mt < 0.38)) lidT = lerp(lidT, Math.max(lidT, -0.22), 0.5 * sa);
    browT += 0.05 * sa;
    pitchT -= 0.14 * sa;
    rollT += this.singRoll * sa;

    // mouth
    this.mouthOpen = damp(this.mouthOpen, openT, openT > this.mouthOpen ? 30 : 14, dt);
    this.mouthO = damp(this.mouthO, oT, oT > this.mouthO ? 30 : 14, dt);
    const wO = clamp(this.mouthO, 0, 1);
    const inf = this.mouth.morphTargetInfluences;
    inf[0] = clamp(this.mouthOpen, 0, 1) * (1 - wO);
    inf[1] = wO;

    // blink
    this.blinkWait -= dt;
    if (this.blinkT < 0 && this.blinkWait <= 0 && !(m === 'oops' && mt < 0.38)) {
      this.blinkT = 0;
      this.blinkWait = 1.8 + R() * 3.2;
      if (!this.doubleBlink && R() < 0.18) {
        this.doubleBlink = true;
        this.blinkWait = 0.22;
      } else this.doubleBlink = false;
    }
    let b = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const bd = 0.16;
      b = Math.sin(Math.PI * Math.min(1, this.blinkT / bd));
      if (this.blinkT >= bd) {
        this.blinkT = -1;
        b = 0;
      }
    }
    this.lid = damp(this.lid, lidT, 16, dt);
    this.lids.rotation.x = lerp(this.lid, c.lidClosed, b);

    // brows
    this.browY = damp(this.browY, browT, 10, dt);
    this.brows.position.y = this.browY - 0.03 * b;

    // gaze
    let yaw = 0;
    let pitch = 0;
    if (this.look) {
      this.torso.updateWorldMatrix(true, false);
      _v.copy(this.look);
      this.torso.worldToLocal(_v);
      _v.sub(this.headPivot.position);
      _v.y -= this.head.position.y;
      yaw = Math.atan2(_v.x, _v.z);
      pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    }
    const hy = clamp(yaw * 0.6, -0.5, 0.5);
    const hp = clamp(pitch * 0.6, -0.3, 0.3);
    this.headYaw = damp(this.headYaw, hy, 5, dt);
    this.headPitch = damp(this.headPitch, hp, 5, dt);
    this.eyeYaw = damp(this.eyeYaw, clamp(yaw - hy, -0.32, 0.32), 14, dt);
    this.eyePitch = damp(this.eyePitch, clamp(pitch - hp, -0.25, 0.25), 14, dt);
    const S = this.sacc;
    S.wait -= dt;
    if (S.wait <= 0) {
      S.wait = 0.7 + R() * 2.4;
      S.tx = (R() - 0.5) * 0.12;
      S.ty = (R() - 0.5) * 0.07;
    }
    S.x = damp(S.x, S.tx, 30, dt);
    S.y = damp(S.y, S.ty, 30, dt);
    const ex = -(this.eyePitch + S.y);
    const ey = this.eyeYaw + S.x;
    this.irisL.rotation.set(ex, ey, 0);
    this.irisR.rotation.set(ex, ey, 0);

    // head
    this.pitchM = damp(this.pitchM, pitchT, 9, dt);
    this.rollM = damp(this.rollM, rollT, 9, dt);
    const breath = Math.sin(t * this.breathRate + this.phase);
    const hx = -this.headPitch + this.nod.x + this.pitchM + 0.015 * Math.sin(t * this.breathRate + this.phase - 0.8);
    this.headPivot.rotation.set(clamp(hx, -0.45, 0.4), this.headYaw, 0.03 * Math.sin(t * 0.6 + this.phase2) + this.rollM);

    // torso
    this.torso.scale.set(1 - 0.007 * breath, 1 + 0.015 * breath, 1 - 0.007 * breath);
    const hopLean = this.hopPhase === 'antic' ? 0.09 * this.hopS : this.hopPhase === 'air' ? -0.035 : 0;
    this.lean = damp(this.lean, leanT + hopLean, 12, dt);
    this.torso.rotation.set(this.lean, 0, 0.022 * Math.sin(t * 0.75 + this.phase2) + this.sway.x);

    // whole body
    this.rig.position.y = Math.max(0, this.y);
    this.rig.rotation.z = this.wobble.x;
    const s = clamp(this.sq.x, 0.72, 1.28);
    const w = 1 / Math.sqrt(s);
    this.rig.scale.set(w, s, w);

    // arms
    if (this.foreR) {
      // Maria: left hand stays on the guitar neck, right arm strums / waves
      const cheerT = m === 'cheer' ? 1 : m === 'oops' && mt < 0.38 ? 0.35 : 0;
      this.cheerBlend = damp(this.cheerBlend, cheerT, 8, dt);
      const cb = this.cheerBlend;
      this.armL.rotation.set(0.02 * breath, 0, 0.015 * breath);
      this.upperR.quaternion.slerpQuaternions(this.qU, this.qUc, cb);
      _qa.setFromAxisAngle(Z_AXIS, this.strumS.x + 0.02 * breath);
      _qb.copy(this.qUinv).multiply(_qa).multiply(this.qF);
      _qc.setFromAxisAngle(Z_AXIS, 0.45 * Math.sin(t * 9)); // wave when the arm is raised
      this.foreR.quaternion.slerpQuaternions(_qb, _qc, cb);
    } else {
      const lift = this.lift.x;
      const outL = Math.min(2.95, this.armOut[0].x + lift * 0.85);
      const outR = Math.min(2.95, this.armOut[1].x + lift * 0.85);
      this.armL.rotation.set(this.armFwd[0].x - lift * 0.2, 0, outL);
      this.armR.rotation.set(this.armFwd[1].x - lift * 0.2, 0, -outR);
    }

    // danglies
    for (const d of this.dang) {
      d.mesh.rotation.z = d.side * d.x;
      d.mesh.rotation.x = d.x * 0.35;
    }
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function mesh(geo, mat, receive = false, name = '') {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = receive;
  return m;
}

// Builds the shared skeleton (group/rig/torso/head + face meshes).
function assembleCommon({ name, height, hipY, neckY, centreY, r, face, lowerGeo, bodyGeo }) {
  const S = shared();
  const group = new THREE.Group();
  group.name = name;
  const rig = new THREE.Group();
  rig.name = `${name}-rig`;
  group.add(rig);
  rig.add(mesh(lowerGeo, S.vc, true, 'legs'));

  const torso = new THREE.Group();
  torso.position.y = hipY;
  rig.add(torso);
  torso.add(mesh(bodyGeo, S.vc, true, 'body'));

  const headPivot = new THREE.Group();
  headPivot.position.y = neckY - hipY;
  torso.add(headPivot);
  const head = new THREE.Group();
  head.position.y = centreY - neckY;
  head.scale.setScalar(r);
  headPivot.add(head);

  head.add(mesh(face.headGeo, S.vc, true, 'head'));
  const irisL = mesh(face.irisGeo, S.gloss, false, 'iris');
  irisL.position.copy(face.eyes[0]);
  const irisR = mesh(face.irisGeo, S.gloss, false, 'iris');
  irisR.position.copy(face.eyes[1]);
  const shine = mesh(face.shineGeo, S.shine, false, 'shine');
  const lids = mesh(face.lidGeo, S.vc, false, 'lids');
  lids.position.copy(face.lidPivot);
  const mouth = mesh(face.mouthGeo, S.mouth, false, 'mouth');
  const brows = mesh(face.browGeo, S.vc, false, 'brows');
  head.add(irisL, irisR, shine, lids, mouth, brows);

  const danglyMeshes = face.danglies.map((d) => {
    const dm = mesh(d.geo, S.vc, true, 'hair-dangly');
    dm.position.set(...d.pivot);
    dm.userData.side = d.side;
    head.add(dm);
    return dm;
  });

  return { group, rig, torso, headPivot, head, irisL, irisR, lids, mouth, brows, danglyMeshes, height };
}

function api(rig, withStrum) {
  const o = {
    group: rig.group,
    height: rig.height,
    update: (dt, t) => rig.update(dt, t),
    hop: (strength = 1) => rig.hop(strength),
    sing: (duration = 0.3) => rig.sing(duration),
    beat: () => rig.beat(),
    setMood: (mood) => rig.setMood(mood),
    lookAt: (x, y, z) => rig.lookAt(x, y, z),
  };
  if (withStrum) o.strum = () => rig.strum();
  rig.update(0, 0);
  return o;
}

// ---------------------------------------------------------------------------
// Public: Maria
// ---------------------------------------------------------------------------

export function createMaria() {
  const S = shared();
  const H = 1.65;
  const r = 0.165;
  const sy = 1.06;
  const centreY = H - 1.1 * sy * r;
  const neckY = centreY - 0.85 * sy * r;
  const hipY = 0.84;
  const skin = '#f7cfb4';
  const rand = rng(777);

  const face = buildHead(
    {
      sy,
      ex: 0.33,
      ey: 0.04,
      eR: 0.215,
      irisA: 0.52,
      skin,
      chubby: 0.015,
      jaw: 0.1,
      noseR: 0.085,
      mouthW: 0.22,
      mouthY: -0.4,
      browT: 0.036,
      hair: 'bob',
      hairColor: '#e2b862',
      browColor: '#b9874a',
      eyeColor: '#4f7fb5',
      lashes: true,
      lashColor: '#3a2618',
    },
    rand,
  );
  const b = buildMariaBody({ hipY, skin, r, centreY });
  const parts = assembleCommon({ name: 'maria', height: H, hipY, neckY, centreY, r, face, lowerGeo: b.lowerGeo, bodyGeo: b.bodyGeo });

  parts.torso.add(mesh(b.guitarGeo, S.satin, true, 'guitar'));
  const armL = new THREE.Group();
  armL.position.copy(b.SL);
  armL.add(mesh(b.armLGeo, S.vc, true));
  parts.torso.add(armL);
  const upperR = new THREE.Group();
  upperR.position.copy(b.SR);
  upperR.quaternion.copy(b.qU);
  upperR.add(mesh(b.upperGeo, S.vc, true));
  parts.torso.add(upperR);
  const foreR = new THREE.Group();
  foreR.position.set(0, -b.LU, 0);
  foreR.add(mesh(b.foreGeo, S.vc, true));
  upperR.add(foreR);

  const rig = new Rig(
    { ...parts, armL, upperR, foreR, qU: b.qU, qUinv: b.qU.clone().invert(), qF: b.qF, qUc: b.qUc },
    { seed: 4242, hopH: 0.22, lidOpen: -0.5, lidClosed: 1.45, armRest: 0 },
  );
  return api(rig, true);
}

// ---------------------------------------------------------------------------
// Public: the seven children
// ---------------------------------------------------------------------------

const KIDS = [
  // 0 · Do — eldest girl: long chestnut hair, big red bow, red sash
  { girl: true, hair: 'long', hairColor: '#7a4428', eyeColor: '#4f86bd', skin: '#f6caa9' },
  // 1 · Re — eldest boy: short brown hair, felt hat with apricot band, apricot neckerchief + socks
  { girl: false, hair: 'short', hairColor: '#5a3520', eyeColor: '#5e8a4a', skin: '#f2c19d' },
  // 2 · Mi — auburn plaits with yellow ribbons, yellow headband + sash
  { girl: true, hair: 'braids', hairColor: '#a24f28', eyeColor: '#4b8a68', skin: '#f7cfb2' },
  // 3 · Fa — curly-haired boy, green neckerchief + socks
  { girl: false, hair: 'curls', hairColor: '#4a2e1e', eyeColor: '#7a5232', skin: '#f0bd98' },
  // 4 · So — honey-blonde side ponytail with a sky-blue scrunchie, blue sash
  { girl: true, hair: 'ponytail', hairColor: '#c99447', eyeColor: '#4686c8', skin: '#f6caa9' },
  // 5 · La — light-brown pigtails with gentian bobbles, blue sash
  { girl: true, hair: 'pigtails', hairColor: '#8e5a34', eyeColor: '#6a4a2e', skin: '#f4c4a2' },
  // 6 · Ti — youngest: golden ringlet curls, big violet bow, violet sash
  { girl: true, hair: 'curls', ringlets: true, hairColor: '#e6bc5c', eyeColor: '#4a8fd2', skin: '#f8d1b4' },
];

export function createChild(index = 0) {
  const i = clamp(Math.round(fin(Number(index), 0)), 0, 6);
  const S = shared();
  const spec = KIDS[i];
  const accent = NOTE_COLORS[i];
  const H = 1.5 - i * (0.65 / 6);
  const r = H / (7 - i / 6); // head ≈ 1/3.5 of height (eldest) → 1/3 (youngest)
  const sy = 1;
  const centreY = H - 1.08 * r;
  const neckY = centreY - 0.8 * r;
  const sh = centreY - 1.02 * r - 0.015;
  const hipY = sh * (0.6 - i * 0.005);
  const sw = r * 0.92;
  const rand = rng(1000 + i * 97);
  const eR = 0.26 + 0.008 * i;
  const ey = -0.012 * i;

  const face = buildHead(
    {
      sy,
      ex: 0.36,
      ey,
      eR,
      irisA: 0.6 + 0.01 * i,
      skin: spec.skin,
      chubby: 0.03 + 0.003 * i,
      jaw: 0,
      noseR: 0.1,
      mouthW: 0.24,
      mouthY: ey - 0.42,
      browT: 0.045,
      hair: spec.hair,
      ringlets: !!spec.ringlets,
      hairColor: spec.hairColor,
      eyeColor: spec.eyeColor,
      accent,
      lashes: spec.girl,
    },
    rand,
  );
  const b = buildKidBody({ r, sh, hipY, sw, girl: spec.girl, skin: spec.skin, accent });
  const parts = assembleCommon({ name: `child-${i}`, height: H, hipY, neckY, centreY, r, face, lowerGeo: b.lowerGeo, bodyGeo: b.bodyGeo });

  parts.torso.add(mesh(b.fabricGeo, S.fabric, true, 'clothes'));
  const armL = new THREE.Group();
  armL.position.copy(b.shoulders[1]); // character's left = +X
  armL.add(mesh(b.armGeo, S.vc, true));
  const armR = new THREE.Group();
  armR.position.copy(b.shoulders[0]);
  armR.add(mesh(b.armGeo, S.vc, true));
  parts.torso.add(armL, armR);

  const rig = new Rig(
    { ...parts, armL, armR },
    { seed: 31 + i * 1013, hopH: 0.3 + 0.01 * (6 - i), lidOpen: -0.62, lidClosed: 1.45, armRest: 0.18 },
  );
  return api(rig, false);
}
