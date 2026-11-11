// Characters: the governess (Maria) and the seven children.
//
// Everything is procedural: sculpted primitives (deformed spheres, lathes and
// tapered "sweeps" along curves) merged into a small number of meshes per
// character — one per material per rig part. Generated textures only
// (DataTexture: the floral "curtain" print, a weave bump map, iris fibres).
// The animation rig is spring-based and driven only by update(dt, t).
//
// Rig hierarchy (all in metres, Y up, facing +Z):
//   group            caller positions / rotates this; origin at the feet
//    └ rig           hop height, squash & stretch, oops-wobble (pivot = feet)
//       ├ legs / socks / shoes (static)
//       └ torso      pivot at the hips: breathing, weight shift, lean
//          ├ clothes (skirts carry morph targets: flare / sway X / sway Z)
//          ├ arms (/ guitar)
//          └ headPivot   neck: look, nod, singing tilt
//             └ head     scaled by head radius; face built in "head units"
//                ├ skin (skull, ears, nose, lower lids, freckles), hair
//                ├ eyeL / eyeR (eyeballs, rotate for gaze), shine
//                ├ lids (blink), mouth (morph targets), brows (morph targets)
//                └ danglies (braids / pigtails / ponytail / long hair on springs)

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
// piecewise-linear lookup in [[t, v], ...]
function pl(t, pts) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let k = 1; k < pts.length; k++) {
    if (t <= pts[k][0]) return lerp(pts[k - 1][1], pts[k][1], (t - pts[k - 1][0]) / (pts[k][0] - pts[k - 1][0]));
  }
  return pts[pts.length - 1][1];
}

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
    fn(p.getX(i), p.getY(i), p.getZ(i), _c, i);
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
function ball(c, p, s, r = [0, 0, 0], ws = 12, hs = 9) {
  return paint(place(new THREE.SphereGeometry(1, ws, hs), p, r, s), c);
}

function box(c, p, s, r = [0, 0, 0]) {
  return paint(place(new THREE.BoxGeometry(s[0], s[1], s[2]), p, r), c);
}

// Cylinder between two points.
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

function flipWinding(g) {
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  g.index.needsUpdate = true;
  return g;
}

function mirrorX(g) {
  g.scale(-1, 1, 1);
  flipWinding(g);
  g.computeVertexNormals();
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

// Relative morph targets computed from a displacement function of position.
function addMorphs(g, fns, pad = 0.1) {
  const p = g.attributes.position;
  const d = [0, 0, 0];
  g.morphAttributes.position = fns.map((fn) => {
    const a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      d[0] = d[1] = d[2] = 0;
      fn(p.getX(i), p.getY(i), p.getZ(i), d);
      a[i * 3] = d[0];
      a[i * 3 + 1] = d[1];
      a[i * 3 + 2] = d[2];
    }
    return new THREE.BufferAttribute(a, 3);
  });
  g.morphTargetsRelative = true;
  g.computeBoundingSphere();
  g.boundingSphere.radius += pad;
  return g;
}

// Interpolated lathe radius at height y (profile ascending or descending in y).
function profR(pts, y) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [r0, y0] = pts[k];
    const [r1, y1] = pts[k + 1];
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    if (hi > lo && y >= lo && y <= hi) return lerp(r0, r1, (y - y0) / (y1 - y0));
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  return Math.abs(y - first[1]) < Math.abs(y - last[1]) ? first[0] : last[0];
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

// Lathe with an optional deformation (x, y, z) -> [x, y, z] applied before
// squashing z by zf; fabric UVs get a constant world size.
function clothLathe(pts, seg, { zf = 0.8, yOff = 0, def = null, fabric = false, phiStart = 0, phiLen = TAU } = {}) {
  const g = lathe(pts, seg, phiStart, phiLen);
  if (fabric) {
    const { len, maxR } = latheLen(pts);
    uvScale(g, ((phiLen / TAU) * TAU * maxR * 0.85) / TILE, len / TILE);
  }
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    if (def) [x, y, z] = def(x, y, z);
    p.setXYZ(i, x, y + yOff, z * zf);
  }
  g.computeVertexNormals();
  return g;
}

// Tapered tube along a curve ("sweep"). Cross-section is an ellipse: thin
// along N (scaled by `flat`), wide along B. If `up` is given, N follows it
// (e.g. the head normal, so hair locks lie flat on the scalp).
function sweep(src, o = {}) {
  const segs = o.segs ?? 12;
  const rad = o.radial ?? 8;
  const curve = src.isCurve
    ? src
    : new THREE.CatmullRomCurve3(src.map((p) => (Array.isArray(p) ? V(...p) : p.clone())), false, 'centripetal');
  const rf = typeof o.r === 'function' ? o.r : () => o.r ?? 0.05;
  const ff = typeof o.flat === 'function' ? o.flat : () => o.flat ?? 1;
  const upF = o.up ? (typeof o.up === 'function' ? o.up : () => o.up) : null;
  const frames = upF ? null : curve.computeFrenetFrames(segs, false);
  const rings = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const P = curve.getPointAt(t);
    const T = curve.getTangentAt(t).normalize();
    let N;
    let B;
    if (upF) {
      const up = upF(t, P);
      N = up.clone().addScaledVector(T, -up.dot(T));
      if (N.lengthSq() < 1e-10) N = (Math.abs(T.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).cross(T);
      N.normalize();
      B = new THREE.Vector3().crossVectors(T, N);
    } else {
      N = frames.normals[i].clone();
      B = frames.binormals[i].clone();
    }
    rings.push({ P, T, N, B, r: Math.max(0, rf(t)), f: ff(t), t });
  }
  const cap = (R, sgn) =>
    [[0.5, 0.75], [0.88, 0.18]].map(([d, k]) => ({ ...R, P: R.P.clone().addScaledVector(R.T, sgn * R.r * d * (o.capLen ?? 1)), r: R.r * k }));
  if (o.capStart !== false && rings[0].r > 1e-6) rings.unshift(...cap(rings[0], -1).reverse());
  const last = rings[rings.length - 1];
  if (o.capEnd !== false && last.r > 1e-6) rings.push(...cap(last, 1));

  const n = rings.length;
  const pos = new Float32Array(n * rad * 3);
  const uv = new Float32Array(n * rad * 2);
  const colA = new Float32Array(n * rad * 3);
  const c0 = col(o.color ?? '#ffffff');
  const cf = o.colorFn;
  const c = new THREE.Color();
  let k = 0;
  for (const R of rings) {
    for (let j = 0; j < rad; j++) {
      const a = (j / rad) * TAU + (o.twist || 0) * R.t;
      const ca = Math.cos(a) * R.r * R.f;
      const sa = Math.sin(a) * R.r;
      pos[k * 3] = R.P.x + R.N.x * ca + R.B.x * sa;
      pos[k * 3 + 1] = R.P.y + R.N.y * ca + R.B.y * sa;
      pos[k * 3 + 2] = R.P.z + R.N.z * ca + R.B.z * sa;
      uv[k * 2] = R.t;
      uv[k * 2 + 1] = j / rad;
      if (cf) cf(R.t, a, c);
      else c.copy(c0);
      colA[k * 3] = c.r;
      colA[k * 3 + 1] = c.g;
      colA[k * 3 + 2] = c.b;
      k++;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < rad; j++) {
      const a = i * rad + j;
      const b = i * rad + ((j + 1) % rad);
      const cc = (i + 1) * rad + j;
      const d = (i + 1) * rad + ((j + 1) % rad);
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A soft ribbon bow centred at the origin, facing +Z, loops along ±X.
function bowGeo(c0, s, { tails = 0.85, tailSpread = 0.3 } = {}) {
  const c = col(c0);
  const dark = shade(c, 0.72);
  const light = mix(c, '#ffffff', 0.28);
  const parts = [];
  for (const k of [-1, 1]) {
    const g = new THREE.SphereGeometry(1, 14, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      let z = p.getZ(i);
      const t = (x + 1) / 2;
      const pinch = 0.28 + 0.72 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.8));
      if (z > 0) z *= 1 - 0.5 * Math.exp(-((x - 0.2) ** 2 + y * y) / 0.1);
      p.setXYZ(i, x, y * pinch, z * pinch);
    }
    g.computeVertexNormals();
    paintFn(g, (x, y, z, cc) => cc.copy(dark).lerp(c, smooth(-1, -0.1, x)).lerp(light, 0.55 * smooth(0.25, 0.9, y)));
    g.scale(0.55 * s, 0.44 * s, 0.24 * s);
    g.translate(0.5 * s, 0, 0);
    g.rotateZ(0.2);
    if (k < 0) mirrorX(g);
    parts.push(g);
    if (tails > 0) {
      parts.push(
        sweep(
          [V(k * 0.05 * s, -0.08 * s, 0.02 * s), V(k * tailSpread * 0.8 * s, -0.5 * tails * s, 0.0), V(k * tailSpread * s, -tails * s, 0.03 * s)],
          {
            segs: 10,
            radial: 6,
            r: (t) => 0.12 * s * (1 - 0.25 * t),
            flat: 0.22,
            up: V(0, 0, 1),
            capEnd: false,
            colorFn: (t, a, cc) => cc.copy(c).lerp(dark, 0.35 * (1 - t)),
          },
        ),
      );
    }
  }
  parts.push(ball(c, [0, 0, 0.05 * s], [0.18 * s, 0.21 * s, 0.14 * s], [0, 0, 0], 12, 8));
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Generated textures
// ---------------------------------------------------------------------------

function dataTex(data, w, h, srgb) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Green floral "curtain" fabric (tiles seamlessly).
function makeFabricTexture() {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const base = [146, 180, 106];
  const leafC = [82, 124, 64];
  const leafHi = [128, 164, 92];
  const centre = [244, 192, 58];
  const centreDot = [206, 120, 40];
  const big = [
    { x: 0.23, y: 0.26, R: 0.118, c: [253, 250, 238], e: [206, 196, 178], rot: 0.2 },
    { x: 0.73, y: 0.75, R: 0.118, c: [250, 196, 196], e: [208, 128, 140], rot: 1.1 },
    { x: 0.78, y: 0.22, R: 0.072, c: [253, 250, 238], e: [206, 196, 178], rot: 0.6 },
    { x: 0.21, y: 0.75, R: 0.072, c: [251, 224, 186], e: [214, 170, 120], rot: 2.0 },
  ];
  const small = [
    { x: 0.5, y: 0.49, R: 0.036 },
    { x: 0.96, y: 0.48, R: 0.03 },
    { x: 0.47, y: 0.97, R: 0.03 },
    { x: 0.58, y: 0.08, R: 0.028 },
    { x: 0.04, y: 0.5, R: 0.026 },
    { x: 0.37, y: 0.62, R: 0.024 },
  ];
  const blue = [116, 156, 222];
  const leaves = [
    { x: 0.42, y: 0.38, a: 0.075, b: 0.026, ang: 0.7 },
    { x: 0.08, y: 0.12, a: 0.065, b: 0.023, ang: -0.6 },
    { x: 0.58, y: 0.6, a: 0.075, b: 0.026, ang: 2.3 },
    { x: 0.92, y: 0.91, a: 0.065, b: 0.023, ang: -2.2 },
    { x: 0.5, y: 0.2, a: 0.06, b: 0.022, ang: 0.2 },
    { x: 0.06, y: 0.33, a: 0.055, b: 0.021, ang: 1.6 },
    { x: 0.93, y: 0.64, a: 0.055, b: 0.02, ang: -1.0 },
    { x: 0.36, y: 0.86, a: 0.05, b: 0.019, ang: 0.9 },
  ];
  const dots = [[0.12, 0.42], [0.62, 0.36], [0.88, 0.06], [0.34, 0.08], [0.66, 0.92], [0.03, 0.9], [0.88, 0.36], [0.44, 0.73]];
  const wrap = (d) => d - Math.round(d);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const v = (j + 0.5) / N;
      const tw = ((i + j) % 4 < 2 ? 1 : -1) * 0.025 + ((i * 7 + j * 13) % 17) / 17 * 0.03 - 0.015;
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
        if (Math.abs(lx) > L.a * 1.1) continue;
        const half = L.b * Math.max(0, 1 - (lx / L.a) ** 2);
        const d = Math.abs(ly) - half;
        put(leafC, clamp(0.5 - d * N, 0, 1));
        if (Math.abs(lx) < L.a * 0.8) put(leafHi, clamp(0.5 - (Math.abs(ly) - 0.002) * N, 0, 1) * 0.8);
      }
      for (const [dxp, dyp] of dots) {
        const d = Math.hypot(wrap(u - dxp), wrap(v - dyp)) - 0.008;
        put([250, 246, 230], clamp(0.5 - d * N, 0, 1));
      }
      for (const F of small) {
        const dx = wrap(u - F.x);
        const dy = wrap(v - F.y);
        const rr = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx);
        const pr = F.R * (0.55 + 0.45 * Math.abs(Math.cos(2.5 * th)));
        put(blue, clamp(0.5 - (rr - pr) * N, 0, 1));
        put([250, 230, 120], clamp(0.5 - (rr - F.R * 0.22) * N, 0, 1));
      }
      for (const F of big) {
        const dx = wrap(u - F.x);
        const dy = wrap(v - F.y);
        const rr = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx);
        const pr = F.R * (0.42 + 0.58 * Math.pow(Math.abs(Math.cos(2.5 * (th + F.rot))), 0.7));
        const a = clamp(0.5 - (rr - pr) * N, 0, 1);
        if (a > 0) {
          const k = rr / pr;
          const pc = [lerp(F.c[0], F.e[0], 0.55 * (1 - k)), lerp(F.c[1], F.e[1], 0.55 * (1 - k)), lerp(F.c[2], F.e[2], 0.55 * (1 - k))];
          // dark petal rim + petal separation lines
          const rim = clamp(1.6 - (pr - rr) * N, 0, 1) * 0.7;
          const sep = Math.pow(Math.abs(Math.sin(2.5 * (th + F.rot))), 40) * smooth(0.3, 0.7, k) * 0.6;
          const m = Math.max(rim, sep);
          put([lerp(pc[0], F.e[0], m), lerp(pc[1], F.e[1], m), lerp(pc[2], F.e[2], m)], a);
        }
        put(centre, clamp(0.5 - (rr - F.R * 0.26) * N, 0, 1));
        const ring = Math.abs(rr - F.R * 0.15);
        const dotty = Math.pow(Math.abs(Math.cos(th * 4)), 6);
        put(centreDot, clamp(0.5 - (ring - 0.004) * N, 0, 1) * dotty);
      }
      const o = (j * N + i) * 4;
      data[o] = clamp(Math.round(r), 0, 255);
      data[o + 1] = clamp(Math.round(g), 0, 255);
      data[o + 2] = clamp(Math.round(b), 0, 255);
      data[o + 3] = 255;
    }
  }
  return dataTex(data, N, N, true);
}

// Plain-weave height map for bump mapping.
function makeWeaveTexture() {
  const N = 64;
  const T = 8; // threads per tile
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) / N) * T;
      const v = ((j + 0.5) / N) * T;
      const ci = Math.floor(u);
      const cj = Math.floor(v);
      const fu = u - ci;
      const fv = v - cj;
      const over = (ci + cj) % 2 === 0;
      const h = over ? 0.45 + 0.55 * Math.sin(Math.PI * fu) * (0.75 + 0.25 * Math.sin(Math.PI * fv)) : 0.45 + 0.55 * Math.sin(Math.PI * fv) * (0.75 + 0.25 * Math.sin(Math.PI * fu));
      const val = clamp(Math.round(h * 255), 0, 255);
      const o = (j * N + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = val;
      data[o + 3] = 255;
    }
  }
  const t = dataTex(data, N, N, false);
  t.repeat.set(9, 9);
  return t;
}

// Iris fibres: u = angle around the eye axis, v = polar angle mapping
// (v < 0.5 iris, v >= 0.5 sclera = white).
function makeEyeTexture() {
  const W = 128;
  const H = 32;
  const data = new Uint8Array(W * H * 4);
  const R = rng(99);
  const ph = Array.from({ length: 6 }, () => R() * TAU);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      const v = (j + 0.5) / H;
      let val = 1;
      if (v < 0.5) {
        const tt = v / 0.5;
        const a = u * TAU;
        const streak =
          0.5 +
          0.22 * Math.sin(a * 29 + ph[0] + 2 * Math.sin(a * 3 + tt * 4)) +
          0.16 * Math.sin(a * 47 + ph[1]) +
          0.12 * Math.sin(a * 13 + ph[2] + tt * 6);
        val = 0.7 + 0.3 * clamp(streak, 0, 1);
        val += 0.16 * Math.exp(-(((tt - 0.5) / 0.08) ** 2)); // collarette
        val *= 1 - 0.18 * Math.pow(Math.max(0, Math.sin(a * 7 + ph[3])), 12) * smooth(0.5, 0.8, tt); // crypts
      }
      const o = (j * W + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = clamp(Math.round(val * 255), 0, 255);
      data[o + 3] = 255;
    }
  }
  const t = dataTex(data, W, H, false);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Shared materials (created lazily once)
// ---------------------------------------------------------------------------

// Cheap fresnel rim: a little extra light at grazing angles, tinted.
function rimify(mat, key, color, str, pow = 3, amb = 0) {
  const c = col(color);
  const v3 = `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `{
        float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        outgoingLight += ${v3} * diffuseColor.rgb * pow(rimF, ${pow.toFixed(2)}) * ${str.toFixed(3)};
        outgoingLight += diffuseColor.rgb * ${amb.toFixed(3)};
      }
      #include <opaque_fragment>`,
    );
  };
  mat.customProgramCacheKey = () => `char-rim-${key}`;
  return mat;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const weave = makeWeaveTexture();
  SHARED = {
    skin: rimify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0 }), 'skin', '#ffb08a', 0.55, 2.6),
    cloth: rimify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide }), 'cloth', '#ffffff', 0.3, 2.4),
    fabric: rimify(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: makeFabricTexture(),
        bumpMap: weave,
        bumpScale: 0.6,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
      'fabric',
      '#ffffff',
      0.3,
      2.4,
    ),
    hair: rimify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0 }), 'hair', '#fff0cc', 0.4, 3),
    gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0 }),
    satin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0 }),
    eye: rimify(new THREE.MeshStandardMaterial({ vertexColors: true, map: makeEyeTexture(), roughness: 0.07, metalness: 0 }), 'eye', '#ffffff', 0.0, 2, 0.32),
    mouth: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.5,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    cache: new Map(),
  };
  return SHARED;
}

function cached(key, make) {
  const S = shared();
  if (!S.cache.has(key)) S.cache.set(key, make());
  return S.cache.get(key);
}

// ---------------------------------------------------------------------------
// Heads (built in "head units": head radius = 1, centre = origin)
// ---------------------------------------------------------------------------

function ellipsoidZ(x, y, sy) {
  const q = 1 - x * x - (y / sy) * (y / sy);
  return q > 0 ? HEAD_Z * Math.sqrt(q) : 0;
}

// Sculpted head: unit-sphere direction -> surface point.
function headShape(o) {
  const { sy, ey, ex } = o;
  const jaw = o.jaw || 0;
  const B = [];
  for (const s of [-1, 1]) {
    B.push([s * 0.5, ey - 0.36, 0.74, 0.05, o.chubby * 1.7]); // cheeks
    B.push([s * ex, ey + 0.02, 0.9, 0.022, -0.028]); // eye sockets
    B.push([s * 0.7, ey + 0.3, 0.6, 0.04, 0.012]); // temples / brow ends
  }
  B.push([0, -0.88, 0.46, 0.045, o.chin ?? 0.03]); // chin
  B.push([0, ey + 0.46, 0.84, 0.06, 0.016]); // brow
  B.push([0, 0.3, -0.7, 0.3, o.cranium ?? 0.03]); // back of the skull
  return (x, y, z, out) => {
    let f = 1;
    for (const b of B) {
      const dx = x - b[0];
      const dy = y - b[1];
      const dz = z - b[2];
      f += b[4] * Math.exp(-(dx * dx + dy * dy + dz * dz) / b[3]);
    }
    let X = x * f;
    const Y = y * f;
    let Z = z * f;
    const kk = smooth(-0.1, -1, y);
    X *= 1 - jaw * kk;
    Z *= 1 - jaw * 0.3 * kk;
    return out.set(X, Y * sy, Z * HEAD_Z);
  };
}

// Front surface depth z at a (head-space) x, y — inverts the sculpt.
function surfaceFn(shape, sy) {
  const p = V();
  const f = (x, y) => {
    let ux = x;
    let uy = y / sy;
    for (let k = 0; k < 8; k++) {
      const m = Math.hypot(ux, uy);
      if (m > 0.995) {
        ux *= 0.995 / m;
        uy *= 0.995 / m;
      }
      shape(ux, uy, Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy)), p);
      ux += (x - p.x) * 0.9;
      uy += ((y - p.y) / sy) * 0.9;
    }
    const m = Math.hypot(ux, uy);
    if (m > 0.995) {
      ux *= 0.995 / m;
      uy *= 0.995 / m;
    }
    shape(ux, uy, Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy)), p);
    return p.z;
  };
  f.normal = (x, y) => {
    const e = 0.01;
    return V(-(f(x + e, y) - f(x - e, y)) / (2 * e), -(f(x, y + e) - f(x, y - e)) / (2 * e), 1).normalize();
  };
  return f;
}

function earGeo(skin, s, ey, sy) {
  const inner = mix(skin, '#e88c80', 0.35);
  const g = new THREE.SphereGeometry(1, 14, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let X = x;
    if (x > 0) X = x - 0.8 * Math.max(0, 1 - (y * y) / 0.7 - (z * z) / 0.6);
    p.setXYZ(i, X * 0.1, y * 0.27, z * 0.17);
  }
  g.computeVertexNormals();
  paintFn(g, (x, y, z, c) => c.copy(skin).lerp(inner, smooth(0.04, -0.04, x) * smooth(0.25, 0.1, Math.hypot(y, z * 1.4))));
  const rim = sweep([V(0.03, 0.08, 0.13), V(0.05, 0.25, 0.03), V(0.055, 0.2, -0.12), V(0.05, -0.02, -0.17), V(0.04, -0.22, -0.08), V(0.03, -0.26, 0.03)], {
    segs: 14,
    radial: 6,
    r: (t) => 0.045 * (0.6 + 0.4 * Math.sin(Math.PI * clamp(t * 1.1, 0, 1))),
    color: skin,
  });
  const ear = merge([g, rim]);
  if (s < 0) mirrorX(ear);
  ear.rotateY(-s * 0.3);
  ear.translate(s * 0.95, (ey - 0.1) * sy, -0.06);
  return ear;
}

function eyeballGeo(eR, irisA, eyeColor) {
  const pA = irisA * 0.42;
  const marks = [0, pA * 0.5, pA * 0.96, pA * 1.04, lerp(pA, irisA, 0.3), lerp(pA, irisA, 0.62), irisA * 0.9, irisA * 0.98, irisA * 1.05, irisA * 1.35, 1.15, 1.55, 1.95, 2.35].reverse(); // back -> front (outward faces)
  const pts = marks.map((a) => {
    const bul = a < irisA * 1.15 ? 0.05 * (1 - (a / (irisA * 1.15)) ** 2) : 0;
    const R = eR * (1 + bul);
    return new THREE.Vector2(R * Math.sin(a), R * Math.cos(a));
  });
  const seg = 28;
  const g = new THREE.LatheGeometry(pts, seg);
  const np = pts.length;
  const ec = col(eyeColor);
  const light = mix(ec, '#fff3d0', 0.45);
  const dark = shade(ec, 0.32);
  const pupil = col('#0d0709');
  const white = col('#fbfaf6');
  const edge = col('#d9cfd0');
  const uv = g.attributes.uv;
  const colors = new Float32Array(g.attributes.position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j < np; j++) {
      const k = i * np + j;
      const a = marks[j];
      if (a < pA) c.copy(pupil);
      else if (a <= irisA) {
        const t = (a - pA) / (irisA - pA);
        c.copy(light).lerp(ec, smooth(0.0, 0.5, t)).lerp(dark, smooth(0.72, 1.0, t));
      } else c.copy(white).lerp(edge, smooth(1.0, 2.0, a));
      colors.set([c.r, c.g, c.b], k * 3);
      uv.setXY(k, i / seg, a <= irisA ? (0.5 * a) / irisA : 0.5 + 0.5 * Math.min(1, (a - irisA) / 1.2));
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.rotateX(Math.PI / 2); // lathe axis +Y -> gaze axis +Z
  g.scale(1, 1.04, 1);
  g.computeBoundingSphere();
  return g;
}

function mouthGeometry(o, surf) {
  const M = 20;
  const rows = [0, 0.1, 0.24, 0.5, 0.74, 0.9, 1];
  const W = o.mouthW;
  const k = W / 0.24;
  const shapes = [
    // closed-ish smile (base)
    (phi, s) => {
      const x = W * Math.cos(phi);
      const sn = Math.sin(phi);
      const yc = -0.03 + 0.085 * (x / W) * (x / W);
      return [x, lerp(yc + 0.024 * sn, yc - 0.06 * sn, s)];
    },
    // open "Ah"
    (phi, s) => {
      const x = 0.16 * k * Math.cos(phi);
      const sn = Math.sin(phi);
      return [x, lerp(-0.005 + 0.1 * sn, -0.02 - 0.22 * sn, s)];
    },
    // small "o"
    (phi, s) => {
      const x = 0.08 * k * Math.cos(phi);
      const sn = Math.sin(phi);
      return [x, lerp(-0.03 + 0.085 * sn, -0.03 - 0.105 * sn, s)];
    },
  ];
  const nV = (M + 1) * rows.length;
  const arrays = shapes.map(() => new Float32Array(nV * 3));
  const normal = new Float32Array(nV * 3);
  const color = new Float32Array(nV * 3);
  const dark = col('#3e1219');
  const deep = col('#5a1c24');
  const lip = col(o.lipColor || '#b4545a');
  const teeth = col('#fffaf2');
  const tongue = col('#e07c84');
  let vi = 0;
  for (let j = 0; j <= M; j++) {
    const phi = Math.PI * (1 - j / M);
    const central = Math.abs(Math.cos(phi)) < 0.66;
    for (let r = 0; r < rows.length; r++) {
      const s = rows[r];
      shapes.forEach((fn, si) => {
        const [x, y] = fn(phi, s);
        const yy = o.mouthY + y;
        const z = surf(x, yy) + 0.016 + (r === 0 || r === rows.length - 1 ? 0.006 : 0);
        arrays[si].set([x, yy, z], vi * 3);
        if (si === 0) {
          const n = surf.normal(x, yy);
          normal.set([n.x, n.y, n.z], vi * 3);
        }
      });
      let c = r === 3 ? dark : deep;
      if (r === 0 || r === rows.length - 1) c = lip;
      else if (r === 1 && central) c = teeth;
      else if ((r === 4 || r === 5) && central) c = tongue;
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
  const ez = ellipsoidZ(ex, ey, sy) - eR * (o.eyeSink ?? 0.54);
  const skin = col(o.skin);
  const blush = col('#f27c74');
  const shape = headShape(o);
  const surf = surfaceFn(shape, sy);
  const skinParts = [];

  // skull / face, painted with soft blush, socket warmth and a cooler nape
  let g = new THREE.SphereGeometry(1, 40, 30);
  const p = g.attributes.position;
  const tmp = V();
  for (let i = 0; i < p.count; i++) {
    shape(p.getX(i), p.getY(i), p.getZ(i), tmp);
    p.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  g = smoothNormals(g);
  const socketC = col('#d98f80');
  const shadowC = mix(skin, '#c77f6c', 0.6);
  paintFn(g, (x, y, z, c) => {
    const yy = y / sy;
    c.copy(skin);
    c.lerp(shadowC, 0.22 * smooth(-0.55, -1.0, yy) + 0.12 * smooth(0.2, -0.6, z));
    if (z > 0) {
      let w = 0;
      let sk = 0;
      for (const s of [-1, 1]) {
        w = Math.max(w, Math.exp(-((x - s * 0.5) ** 2 + ((yy - (ey - 0.33)) ** 2) * 1.3) / 0.035));
        sk = Math.max(sk, Math.exp(-((x - s * ex) ** 2 + (yy - ey) ** 2) / 0.07));
      }
      c.lerp(socketC, 0.14 * sk);
      c.lerp(blush, (o.blush ?? 0.5) * w);
      // a hint of warmth on the nose bridge / chin
      c.lerp(blush, 0.1 * Math.exp(-(x * x + (yy - (ey - 0.2)) ** 2) / 0.02));
    }
  });
  skinParts.push(g);

  // ears
  for (const s of [-1, 1]) skinParts.push(earGeo(skin, s, ey, sy));

  // nose: soft button with nostril hints (and a bridge for the adult)
  const ny = (ey - 0.22) * sy;
  const nR = o.noseR;
  const nz = surf(0, ny);
  const noseC = mix(skin, '#ef9c88', 0.22);
  const nose = ball(noseC, [0, ny, nz + nR * 0.32], [nR, nR * 0.8, nR * 0.78], [0.3, 0, 0], 16, 12);
  paintFn(nose, (x, y, z, c) => c.copy(noseC).lerp(col('#ffe6d8'), 0.25 * smooth(0.3, 1, (y - ny) / (nR * 0.8) + (z - nz) / nR - 0.6)));
  skinParts.push(nose);
  for (const s of [-1, 1]) {
    skinParts.push(ball(mix(skin, '#a85a52', 0.5), [s * nR * 0.42, ny - nR * 0.42, nz + nR * 0.28], [nR * 0.2, nR * 0.1, nR * 0.16], [0.3, 0, s * 0.4], 8, 6));
    skinParts.push(ball(noseC, [s * nR * 0.62, ny - nR * 0.2, nz + nR * 0.05], [nR * 0.38, nR * 0.36, nR * 0.36], [0, 0, 0], 10, 8));
  }
  if (o.bridge) {
    const by = (ey - 0.06) * sy;
    skinParts.push(ball(skin, [0, by, surf(0, by) - 0.035], [0.055, 0.13, 0.05], [0.15, 0, 0], 10, 8));
  }

  // lower lids (thickness under each eye)
  const lidC = mix(skin, '#e2957f', 0.22);
  for (const s of [-1, 1]) {
    const c0 = V(s * ex, ey, ez);
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const a = lerp(-1.25, 1.25, k / 6);
      const d = V(Math.sin(a) * 0.95, -0.66 - 0.12 * Math.cos(a), Math.cos(a) * 0.9).normalize();
      pts.push(c0.clone().addScaledVector(d, eR * 1.03));
    }
    skinParts.push(sweep(pts, { segs: 14, radial: 6, r: (t) => eR * 0.06 * Math.pow(Math.sin(Math.PI * t), 0.6) + 0.002, color: skin }));
  }

  // freckles
  if (o.freckles) {
    const fc = mix(skin, '#a85a30', 0.5);
    for (let k = 0; k < o.freckles; k++) {
      const s = k % 2 ? 1 : -1;
      const x = s * (0.12 + rand() * 0.48);
      const y = (ey - 0.18 - rand() * 0.24 + Math.abs(x) * 0.12) * sy;
      const z = surf(x, y) + 0.004;
      const n = surf.normal(x, y);
      const disc = new THREE.CircleGeometry(0.011 + rand() * 0.009, 7);
      disc.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n), V(1, 0.8, 1)));
      skinParts.push(paint(disc, fc));
    }
  }
  const skinGeo = merge(skinParts);

  // hair (+ head accessories)
  const hair = buildHair(o.hair, o, rand);
  const hairGeo = merge(hair.geos);

  // eyeballs (shared by both eyes)
  const eyeGeo = cached(`eye:${o.eyeColor}:${eR}:${o.irisA}`, () => eyeballGeo(eR, o.irisA, o.eyeColor));

  // painted highlights (fixed in head space, so they "catch the light")
  const sh = [];
  const hl = [
    [V(0.38, 0.44, 0.81).normalize(), 0.22, 0.17],
    [V(-0.3, -0.28, 0.91).normalize(), 0.09, 0.08],
    [V(0.12, 0.5, 0.86).normalize(), 0.06, 0.06],
  ];
  for (const s of [-1, 1]) {
    for (const [d, a, b] of hl) {
      const disc = new THREE.SphereGeometry(1, 8, 4);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d);
      disc.applyMatrix4(new THREE.Matrix4().compose(V(s * ex, ey, ez).addScaledVector(d, eR * 1.07), q, V(eR * a, eR * b, eR * 0.03)));
      sh.push(disc);
    }
  }
  const shineGeo = merge(sh);

  // upper lids (shared hinge line): cap, fold with thickness, lash line, lashes
  const lashC = col(o.lashColor || '#2b1a14');
  const lp = [];
  for (const s of [-1, 1]) {
    lp.push(paint(new THREE.SphereGeometry(eR * 1.1, 18, 6, 0, TAU, 0, Math.PI / 2).translate(s * ex, 0, 0), lidC));
    const fold = new THREE.TorusGeometry(eR * 1.1, eR * 0.1, 6, 22, Math.PI);
    fold.rotateX(Math.PI / 2);
    lp.push(paint(fold.translate(s * ex, eR * 0.04, 0), mix(lidC, '#d58a78', 0.25)));
    const lash = new THREE.TorusGeometry(eR * 1.13, eR * (o.lashes ? 0.062 : 0.045), 5, 22, Math.PI);
    lash.rotateX(Math.PI / 2);
    lp.push(paint(lash.translate(s * ex, -eR * 0.035, 0), lashC));
    if (o.lashes) {
      for (let k = 0; k < 5; k++) {
        const u = 0.1 + k * 0.16;
        const cx = Math.cos(u);
        const sz = Math.sin(u);
        const base = V(s * ex + s * cx * eR * 1.13, -eR * 0.04, sz * eR * 1.13);
        const out = V(s * cx, 0, sz).normalize();
        const len = eR * (0.36 - k * 0.04);
        const pts = [base, base.clone().addScaledVector(out, len * 0.55).add(V(0, -len * 0.12, 0)), base.clone().addScaledVector(out, len).add(V(0, len * 0.18, 0))];
        lp.push(sweep(pts, { segs: 6, radial: 4, r: (t) => eR * 0.04 * (1 - 0.85 * t), color: lashC, capStart: false }));
      }
    }
  }
  const lidGeo = merge(lp);

  // brows: tapered, lying on the forehead; morphs = [worried, arched]
  const by = ey + eR + 0.11;
  const browC = shade(o.browColor || o.hairColor, 0.68);
  const bp = [];
  const bIn = ex - 0.16;
  const bOut = ex + 0.2;
  for (const s of [-1, 1]) {
    const pts = [
      [s * bIn, by - 0.02],
      [s * (ex - 0.02), by + 0.045],
      [s * bOut, by - 0.015],
    ].map(([x, y]) => V(x, y * sy, surf(x, y * sy) + 0.024));
    bp.push(
      sweep(pts, {
        segs: 12,
        radial: 6,
        r: (t) => o.browT * (s > 0 ? lerp(1.1, 0.45, t) : lerp(1.1, 0.45, t)),
        flat: 0.45,
        up: (t, P) => surf.normal(P.x, P.y),
        color: browC,
      }),
    );
  }
  const browGeo = merge(bp);
  addMorphs(
    browGeo,
    [
      (x, y, z, d) => {
        const u = clamp((Math.abs(x) - bIn) / (bOut - bIn), 0, 1);
        d[1] = 0.085 * Math.pow(1 - u, 1.3) - 0.02 * u;
        d[2] = -0.25 * d[1];
      },
      (x, y, z, d) => {
        const u = clamp((Math.abs(x) - bIn) / (bOut - bIn), 0, 1);
        d[1] = 0.035 + 0.035 * Math.sin(Math.PI * u);
        d[2] = -0.25 * d[1];
      },
    ],
    0.15,
  );

  return {
    skinGeo,
    hairGeo,
    eyeGeo,
    shineGeo,
    lidGeo,
    browGeo,
    mouthGeo: mouthGeometry(o, surf),
    eyes: [V(-ex, ey, ez), V(ex, ey, ez)],
    lidPivot: V(0, ey, ez),
    danglies: hair.danglies,
  };
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

function hairShell(o, h) {
  let g = new THREE.SphereGeometry(1, h.ws || 50, h.hs || 34);
  const p = g.attributes.position;
  const sideA0 = h.sideA0 ?? 0.62;
  const sideA1 = h.sideA1 ?? 1.2;
  const N = h.strands ?? 15;
  const grooveAmp = h.groove ?? 0.02;
  const R0 = rng(h.seed ?? 5);
  const lumpPh = [R0() * TAU, R0() * TAU, R0() * TAU];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const az = Math.atan2(x, z);
    const A = Math.abs(az);
    const frontW = 1 - smooth(sideA0, sideA1, A);
    let fh = h.front + (h.asym || 0) * az - (h.scallop ?? 0.05) * (0.5 + 0.5 * Math.cos(az * (h.freq || 9))) * frontW;
    if (h.part) fh += h.part * (1 - smooth(0, 0.16, A));
    let hl = lerp(fh, h.side, smooth(sideA0, sideA1, A));
    hl = lerp(hl, h.back, smooth(h.backA0 ?? 1.9, h.backA1 ?? 2.7, A));
    const gro = Math.pow(0.5 + 0.5 * Math.cos(az * N + 1.3 * Math.sin(y * 2.4 + az * 1.5)), 3);
    let R = h.R - grooveAmp * gro * smooth(1.0, 0.6, y);
    if (h.lumps) R += h.lumps * (Math.sin(az * 5 + lumpPh[0] + y * 4) * Math.sin(y * 6 + lumpPh[1]) + 0.5 * Math.sin(az * 9 + y * 7 + lumpPh[2]));
    if (h.flare) R += h.flare * smooth(h.flareY0 ?? 0.1, h.flareY1 ?? -0.5, y) * smooth(0.45, 1.1, A);
    if (y < hl) R = lerp(R, 0.84, smooth(0, 0.09, hl - y));
    p.setXYZ(i, x * R, y * R * o.sy, z * R * HEAD_Z);
  }
  g = smoothNormals(g);
  const hc = col(o.hairColor);
  const sheen = mix(o.hairColor, '#fff4dc', 0.5);
  paintFn(g, (x, y, z, c) => {
    const L = Math.hypot(x, y / o.sy, z / HEAD_Z) || 1;
    const yy = y / o.sy / L;
    const az = Math.atan2(x, z);
    const gro = Math.pow(0.5 + 0.5 * Math.cos(az * N + 1.3 * Math.sin(yy * 2.4 + az * 1.5)), 3);
    c.copy(hc).multiplyScalar((0.72 + 0.36 * smooth(-0.7, 0.95, yy)) * (1 - 0.2 * gro * smooth(1.0, 0.6, yy)));
    const band = Math.exp(-(((yy - 0.66) / 0.11) ** 2)) * (0.55 + 0.45 * (1 - gro));
    c.lerp(sheen, 0.34 * band);
  });
  return g;
}

// A lock of hair: flattened tapered sweep lying on the head.
function lockGeo(pts, o) {
  const base = col(o.color);
  const sheen = mix(o.color, '#fff4dc', 0.45);
  const centre = o.center || V();
  const k = o.k ?? 1;
  return sweep(pts, {
    segs: o.segs ?? 12,
    radial: o.radial ?? 6,
    r: (t) => o.w * (0.78 + 0.22 * smooth(0, 0.2, t)) * (1 - Math.pow(t, o.taper ?? 1.7) * 0.93),
    flat: o.flat ?? 0.42,
    up: o.up || ((t, P) => P.clone().sub(centre).normalize()),
    capStart: o.capStart ?? true,
    capEnd: false,
    colorFn: (t, a, c) => {
      c.copy(base).multiplyScalar(k * lerp(o.rootShade ?? 0.8, 1.05, smooth(0, 0.6, t)) * (0.9 + 0.1 * Math.cos(a)));
      if (o.sheenT != null) c.lerp(sheen, 0.3 * Math.exp(-(((t - o.sheenT) / 0.15) ** 2)) * (0.5 + 0.5 * Math.cos(a)));
    },
  });
}

// A spiral curl (or a corkscrew ringlet when `turns` is large).
function curlGeo(c, n, rc, tube, o) {
  const up = Math.abs(n.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const u = up.clone().cross(n).normalize();
  const v = n.clone().cross(u).normalize();
  const turns = o.turns ?? 0.85;
  const len = o.len ?? 0.05;
  const axis = o.axis || n;
  const pts = [];
  const steps = Math.max(8, Math.round(turns * 14));
  const ph = o.ph ?? 0;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const a = ph + t * turns * TAU;
    const R = rc * (1 - (o.shrink ?? 0.3) * t);
    pts.push(c.clone().addScaledVector(u, Math.cos(a) * R).addScaledVector(v, Math.sin(a) * R).addScaledVector(axis, len * t));
  }
  const base = col(o.color);
  const light = mix(o.color, '#fff4dc', 0.35);
  return sweep(pts, {
    segs: steps,
    radial: o.radial ?? 5,
    capEnd: false,
    r: (t) => tube * (1 - 0.55 * t),
    colorFn: (t, a, cc) => cc.copy(base).multiplyScalar((o.k ?? 1) * (0.82 + 0.2 * t)).lerp(light, 0.22 * Math.max(0, Math.cos(a))),
  });
}

// Returns { geos: [...head-mesh pieces], danglies: [{ geo, pivot, side, kx?, minX? }] }
function buildHair(style, o, rand) {
  const hc = o.hairColor;
  const accent = o.accent;
  const geos = [];
  const danglies = [];
  const sy = o.sy;
  const hp = (az, y, R) => {
    const k = Math.sqrt(Math.max(0, 1 - y * y));
    return V(Math.sin(az) * k * R, y * R * sy, Math.cos(az) * k * R * HEAD_Z);
  };
  const shadeR = () => 0.9 + rand() * 0.18;
  // A row of fringe locks across the forehead.
  const bangs = (az0, az1, n, yTop, yTip, swing, w, R = 1.1) => {
    for (let k = 0; k < n; k++) {
      const a = lerp(az0, az1, n === 1 ? 0.5 : k / (n - 1));
      const tip = yTip + (rand() - 0.5) * 0.05;
      geos.push(
        lockGeo([hp(a - swing * 0.4, yTop, R - 0.03), hp(a, lerp(yTop, tip, 0.5), R + 0.02), hp(a + swing, tip, R - 0.01)], {
          w: w * (0.85 + rand() * 0.3),
          color: hc,
          k: shadeR(),
          sheenT: 0.3,
        }),
      );
    }
  };
  // Flyaway tuft(s) on the crown.
  const tuft = (az, y, dir, len, w) => {
    const a = hp(az, y, 1.05);
    const n = a.clone().normalize();
    geos.push(lockGeo([a, a.clone().addScaledVector(n, len * 0.5).add(dir.clone().multiplyScalar(len * 0.4)), a.clone().addScaledVector(n, len * 0.7).add(dir.clone().multiplyScalar(len))], { w, color: hc, k: 1.05, flat: 0.5, segs: 8 }));
  };

  switch (style) {
    case 'bob': {
      // Maria: soft side-swept fringe, ends curling under at the jaw.
      geos.push(hairShell(o, { front: 0.52, asym: -0.1, side: -0.64, back: -0.72, R: 1.1, flare: 0.12, scallop: 0.04, freq: 10, sideA0: 0.64, sideA1: 1.25, seed: 3 }));
      for (let k = 0; k < 6; k++) {
        const a0 = 0.5 - k * 0.05;
        geos.push(
          lockGeo([hp(a0, 0.93, 1.06), hp(0.15 - k * 0.12, 0.76 - k * 0.012, 1.14), hp(-0.38 - k * 0.11, 0.56 - k * 0.025, 1.13), hp(-0.74 - k * 0.09, 0.32 - k * 0.02, 1.1)], {
            w: 0.2,
            color: hc,
            k: 0.95 + (k % 2) * 0.1,
            segs: 12,
            sheenT: 0.35,
          }),
        );
      }
      for (let k = 0; k < 16; k++) {
        const s = k % 2 ? 1 : -1;
        const a = s * lerp(1.0, 3.0, Math.floor(k / 2) / 7);
        const y0 = 0.15;
        const bottom = Math.abs(a) < 1.5 ? -0.66 : -0.74;
        geos.push(
          lockGeo([hp(a, y0, 1.12), hp(a, -0.35, 1.2), hp(a, bottom, 1.17), hp(a + s * 0.05, bottom + 0.06, 1.0)], {
            w: 0.22,
            color: hc,
            k: shadeR() * 0.97,
            segs: 10,
            sheenT: 0.15,
          }),
        );
      }
      tuft(0.9, 0.9, V(0.4, 0.3, -0.2), 0.16, 0.05);
      // tiny edelweiss clip
      const fc = hp(0.72, 0.62, 1.13);
      const petals = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        petals.push(ball('#fbf8ef', [Math.cos(a) * 0.065, Math.sin(a) * 0.065, 0], [0.065, 0.032, 0.022], [0, 0, a], 10, 6));
      }
      petals.push(ball('#f2c94c', [0, 0, 0.012], 0.034, [0, 0, 0], 10, 8));
      const clip = merge(petals);
      clip.applyMatrix4(new THREE.Matrix4().compose(fc, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), fc.clone().normalize()), V(1, 1, 1)));
      geos.push(clip);
      break;
    }
    case 'long': {
      geos.push(hairShell(o, { front: 0.56, part: 0.05, side: -0.25, back: -0.75, R: 1.08, scallop: 0.05, seed: 7 }));
      // face-framing locks from the parting
      for (const s of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const a = s * (0.12 + k * 0.22);
          geos.push(
            lockGeo([hp(a * 0.6, 0.95, 1.06), hp(s * (0.55 + k * 0.2), 0.62, 1.12), hp(s * (1.0 + k * 0.12), 0.1, 1.13), hp(s * (1.3 + k * 0.08), -0.45, 1.14), V(s * (0.9 - k * 0.05), -0.95, -0.35 - k * 0.08)], {
              w: 0.2,
              color: hc,
              k: shadeR(),
              segs: 18,
              sheenT: 0.2,
            }),
          );
        }
      }
      // the long fall of hair: a dangly that sways when she hops
      const pivot = V(0, 0.3 * sy, -0.55);
      const parts = [];
      const NL = 15;
      for (let k = 0; k < NL; k++) {
        const t = k / (NL - 1);
        const a = lerp(1.3, TAU - 1.3, t);
        const az = a > Math.PI ? a - TAU : a;
        const x3 = Math.sin(az) * 0.95;
        const zb = Math.min(Math.cos(az) * 1.12, -0.62) - 0.1 * (1 - Math.abs(Math.sin(az)));
        const pts = [hp(az, 0.45, 1.06), hp(az, -0.1, 1.14), V(Math.sin(az) * 1.08, -0.6 * sy, zb + 0.08), V(x3, -1.1, zb), V(x3 * 0.94, -1.5, zb - 0.03), V(x3 * 0.82, -1.82, zb + 0.08)].map((v) => v.sub(pivot));
        parts.push(
          lockGeo(pts, {
            w: 0.25,
            color: hc,
            k: shadeR(),
            segs: 16,
            flat: 0.4,
            taper: 3,
            center: V(0, -0.5, 0).sub(pivot),
            up: (tt, P) => V(P.x, 0, P.z + pivot.z).normalize(),
            sheenT: 0.12,
          }),
        );
      }
      danglies.push({ geo: merge(parts), pivot: pivot.toArray(), side: 0, kx: 0.22, minX: -0.04 });
      geos.push(place(bowGeo(accent, 0.46, { tails: 0.6 }), hp(0.55, 0.8, 1.12).toArray(), [-0.25, 0.5, -0.5]));
      break;
    }
    case 'short': {
      geos.push(hairShell(o, { front: 0.6, side: 0.26, back: -0.5, R: 1.06, groove: 0.03, scallop: 0.07, freq: 12, seed: 11 }));
      // layered tufts at the sides and nape, peeking out under the hat
      for (let k = 0; k < 13; k++) {
        const a = lerp(-2.9, 2.9, k / 12);
        if (Math.abs(a) < 0.8) continue;
        const y0 = 0.55;
        const yb = Math.abs(a) < 1.6 ? 0.18 : -0.45;
        geos.push(lockGeo([hp(a, y0, 1.07), hp(a, lerp(y0, yb, 0.6), 1.1), hp(a + 0.04, yb, 1.06)], { w: 0.17, color: hc, k: shadeR(), segs: 10 }));
      }
      bangs(-0.55, 0.45, 5, 0.75, 0.52, 0.12, 0.15, 1.08);
      // felt Tyrolean hat: shaped crown with a crease, curled brim, cord band, feather
      const felt = col('#4a6a43');
      const crownPts = [[0.8, 0.62], [0.79, 0.72], [0.76, 0.86], [0.7, 1.0], [0.6, 1.1], [0.42, 1.16], [0.2, 1.15], [0.0, 1.12]];
      const crown = lathe(crownPts, 36);
      const cp = crown.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i);
        let y = cp.getY(i);
        let z = cp.getZ(i);
        if (y > 0.95) y -= 0.09 * Math.exp(-(x * x) / 0.03) * smooth(0.95, 1.12, y);
        z *= 1 - 0.18 * smooth(0.85, 1.12, y) * (z > 0 ? 1 : 0.4);
        cp.setXYZ(i, x, y, z);
      }
      crown.computeVertexNormals();
      paintFn(crown, (x, y, z, c) => c.copy(felt).multiplyScalar(0.85 + 0.2 * smooth(0.6, 1.1, y)));
      const brimPts = [[0.79, 0.64], [1.0, 0.62], [1.18, 0.63], [1.27, 0.67], [1.25, 0.705], [1.15, 0.685], [1.0, 0.675], [0.79, 0.69]];
      const brim = lathe(brimPts, 48);
      const bpp = brim.attributes.position;
      for (let i = 0; i < bpp.count; i++) {
        const x = bpp.getX(i);
        let y = bpp.getY(i);
        const z = bpp.getZ(i);
        const rr = Math.hypot(x, z);
        const ang = Math.atan2(x, z);
        y += smooth(0.95, 1.27, rr) * (0.12 * Math.pow(Math.sin(ang), 2) * (z < 0 ? 1.25 : 1) - 0.05 * Math.max(0, Math.cos(ang)));
        bpp.setXYZ(i, x, y, z);
      }
      brim.computeVertexNormals();
      paintFn(brim, (x, y, z, c) => c.copy(felt).multiplyScalar(0.88));
      const cord = new THREE.TorusGeometry(0.8, 0.045, 5, 36);
      cord.rotateX(Math.PI / 2);
      cord.translate(0, 0.73, 0);
      const ac = col(accent);
      paintFn(cord, (x, y, z, c) => c.copy(ac).multiplyScalar(0.8 + 0.25 * Math.max(0, Math.sin(Math.atan2(x, z) * 30 + (y - 0.73) * 60))));
      const cord2 = new THREE.TorusGeometry(0.805, 0.03, 4, 32);
      cord2.rotateX(Math.PI / 2);
      cord2.translate(0, 0.8, 0);
      paint(cord2, shade(accent, 0.85));
      const feather = sweep([V(0.62, 0.78, -0.42), V(0.72, 1.05, -0.55), V(0.66, 1.35, -0.72)], {
        segs: 10,
        radial: 6,
        r: (t) => 0.1 * Math.sin(Math.PI * clamp(t * 0.95 + 0.05, 0, 1)),
        flat: 0.15,
        up: V(1, 0, 0.3).normalize(),
        colorFn: (t, a, c) => c.set('#fbf6e8').lerp(col('#3a3a3a'), smooth(0.7, 0.95, t)),
      });
      const tuftF = sweep([V(0.66, 0.78, -0.36), V(0.78, 0.95, -0.38), V(0.8, 1.08, -0.42)], { segs: 6, radial: 6, r: (t) => 0.06 * (1 - 0.6 * t), color: accent });
      // little edelweiss badge on the band
      const badge = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        badge.push(ball('#fbf8ef', [Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0], [0.05, 0.022, 0.015], [0, 0, a], 8, 5));
      }
      badge.push(ball('#f2c94c', [0, 0, 0.01], 0.022, [0, 0, 0], 8, 6));
      const bg = merge(badge);
      bg.rotateY(-0.5);
      bg.translate(-0.42, 0.76, 0.7);
      const hat = merge([crown, brim, cord, cord2, feather, tuftF, bg]);
      hat.rotateZ(0.12);
      hat.rotateX(-0.08);
      hat.scale(1, sy, HEAD_Z * 1.04);
      geos.push(hat);
      break;
    }
    case 'braids': {
      geos.push(hairShell(o, { front: 0.56, part: 0.06, side: 0.0, back: -0.55, R: 1.07, seed: 13 }));
      bangs(-0.5, 0.5, 6, 0.82, 0.52, 0.06, 0.15);
      // headband over the crown (accent)
      const band = sweep(
        Array.from({ length: 13 }, (_, k) => {
          const a = lerp(-1.45, 1.45, k / 12);
          return V(Math.sin(a) * 1.1, Math.cos(a) * 1.1 * sy * 0.98, 0).applyAxisAngle(V(1, 0, 0), -0.45);
        }),
        { segs: 30, radial: 6, r: 0.075, flat: 0.45, up: (t, P) => P.clone().normalize(), color: accent },
      );
      band.scale(1, 1, HEAD_Z);
      geos.push(band);
      for (const s of [-1, 1]) {
        const parts = [];
        // locks gathering from behind the ear into the braid
        for (let k = 0; k < 3; k++) {
          parts.push(lockGeo([V(s * 0.02, 0.4 - k * 0.05, -0.3 - k * 0.12), V(s * 0.12, 0.12, -0.1 - k * 0.05), V(s * 0.04, -0.06, 0.0)], { w: 0.14, color: hc, k: shadeR(), segs: 8, up: V(s, 0, 0) }));
        }
        // three-strand plait: alternating angled lobes
        for (let k = 0; k < 9; k++) {
          const alt = k % 2 ? 1 : -1;
          const rr = 0.135 - 0.006 * k;
          const g = new THREE.SphereGeometry(1, 10, 7);
          const lobeC = col(hc).multiplyScalar(0.95 + (k % 2) * 0.08);
          paintFn(g, (x, y, z, c) => c.copy(lobeC).multiplyScalar(0.72 + 0.4 * smooth(-0.8, 0.9, y)));
          place(g, [s * 0.035 * k + alt * 0.035, -0.06 - 0.115 * k, 0.06 * k], [0.15 * alt, 0.2 * alt, alt * 0.6], [rr, rr * 0.82, rr * 0.82]);
          parts.push(g);
        }
        const endY = -0.06 - 0.115 * 9;
        parts.push(place(bowGeo(accent, 0.22, { tails: 0.7 }), [s * 0.3, endY + 0.04, 0.57], [0, 0, 0]));
        for (let k = 0; k < 3; k++) {
          const sp = (k - 1) * 0.06;
          parts.push(lockGeo([V(s * 0.31 + sp * 0.4, endY - 0.02, 0.56), V(s * 0.31 + sp, endY - 0.14, 0.58), V(s * 0.31 + sp * 1.6, endY - 0.24, 0.6)], { w: 0.07, color: hc, k: 1.02, flat: 0.7, segs: 6, up: V(0, 0, 1) }));
        }
        danglies.push({ geo: merge(parts), pivot: [s * 0.8, -0.12 * sy, -0.3], side: s });
      }
      break;
    }
    case 'curls': {
      const ring = !!o.ringlets;
      geos.push(hairShell(o, { front: 0.6, side: ring ? -0.3 : 0.2, back: ring ? -0.55 : -0.45, R: 1.04, ws: 40, hs: 28, scallop: 0.03, groove: 0.01, lumps: 0.025, seed: 17 }));
      // fringe curls along the hairline, then crown and sides
      const curlAt = (az, y, R, rc, tube, turns) => {
        const c = hp(az, y, R);
        const out = c.clone().normalize();
        const tan = V(0, 1, 0).cross(out);
        if (tan.lengthSq() < 1e-4) tan.set(1, 0, 0);
        tan.normalize().applyAxisAngle(out, (rand() - 0.5) * 1.2);
        c.addScaledVector(out, rc * 0.6);
        geos.push(curlGeo(c, tan, rc, tube, { turns, len: 0.07, axis: tan, color: hc, k: shadeR(), ph: rand() * TAU }));
      };
      for (let a = -0.75; a <= 0.76; a += 0.25) curlAt(a, 0.62 + rand() * 0.04, 1.06, 0.075, 0.06, 1.1);
      const n = ring ? 16 : 22;
      for (let k = 0; k < n; k++) {
        const az = (rand() * 2 - 1) * Math.PI;
        const A = Math.abs(az);
        const minY = A < 0.75 ? 0.72 : lerp(ring ? -0.2 : 0.25, ring ? -0.45 : -0.35, smooth(1.4, 2.8, A));
        const y = lerp(minY, 0.95, Math.pow(rand(), 0.8));
        curlAt(az, y, 1.06, 0.08 + rand() * 0.025, 0.065, 1.05);
      }
      if (ring) {
        // corkscrew ringlets bouncing by the ears
        for (const s of [-1, 1]) {
          const parts = [];
          for (let k = 0; k < 3; k++) {
            const c = V(s * (0.02 + k * 0.03), 0.02, -0.14 * k);
            parts.push(curlGeo(c, V(0, -1, 0), 0.085 - k * 0.008, 0.06, { turns: 3.1 - k * 0.4, len: 0.72 - k * 0.12, axis: V(s * 0.12, -1, 0.1).normalize(), color: hc, k: 0.95 + k * 0.05, shrink: 0.15, ph: k * 1.3, radial: 5 }));
          }
          danglies.push({ geo: merge(parts), pivot: [s * 0.94, 0.0, -0.22], side: s });
        }
        geos.push(place(bowGeo(accent, 0.52, { tails: 0.55 }), hp(-0.45, 0.8, 1.16).toArray(), [-0.2, -0.4, 0.45]));
      } else {
        tuft(0.2, 0.97, V(-0.3, 0.6, 0.2), 0.2, 0.05);
      }
      break;
    }
    case 'ponytail': {
      geos.push(hairShell(o, { front: 0.56, asym: 0.1, side: 0.12, back: -0.42, R: 1.06, seed: 19 }));
      bangs(-0.65, 0.35, 6, 0.85, 0.5, 0.18, 0.15);
      tuft(-0.4, 0.95, V(-0.2, 0.5, -0.4), 0.18, 0.045);
      const parts = [];
      for (let k = 0; k < 9; k++) {
        const ang = (k / 9) * TAU;
        const off = V(0, Math.cos(ang) * 0.07, Math.sin(ang) * 0.07);
        const sp = 0.9 + rand() * 0.25;
        const pts = [
          off.clone(),
          V(0.24, 0.0, 0).add(off.clone().multiplyScalar(1.4)),
          V(0.38 * sp, -0.3, 0.0).add(off.clone().multiplyScalar(1.6)),
          V(0.38 * sp, -0.62, 0.02).add(off.clone().multiplyScalar(1.3)),
          V(0.28 * sp, -0.9, 0.04).add(off),
          V(0.36 * sp, -1.02, 0.05).add(off.clone().multiplyScalar(0.6)),
        ];
        parts.push(lockGeo(pts, { w: 0.17, color: hc, k: shadeR(), segs: 16, flat: 0.65, taper: 2.2, up: (t, P) => V(0, P.y - (-0.4), P.z).normalize(), sheenT: 0.25 }));
      }
      const scr = new THREE.TorusGeometry(0.13, 0.07, 8, 22);
      const sp2 = scr.attributes.position;
      for (let i = 0; i < sp2.count; i++) {
        const x = sp2.getX(i);
        const y = sp2.getY(i);
        const z = sp2.getZ(i);
        const k = 1 + 0.18 * Math.sin(Math.atan2(y, x) * 9);
        sp2.setXYZ(i, x * (1 + (k - 1) * 0.4), y * (1 + (k - 1) * 0.4), z * k);
      }
      scr.computeVertexNormals();
      scr.rotateY(Math.PI / 2);
      scr.rotateZ(-0.35);
      paintFn(scr, (x, y, z, c) => c.copy(col(accent)).multiplyScalar(0.85 + 0.25 * smooth(-0.1, 0.15, y)));
      parts.push(scr.translate(0.03, 0.0, 0));
      danglies.push({ geo: merge(parts), pivot: [0.74, 0.5 * sy, -0.38], side: 1 });
      break;
    }
    case 'pigtails': {
      geos.push(hairShell(o, { front: 0.55, part: 0.06, side: -0.05, back: -0.5, R: 1.07, scallop: 0.05, freq: 11, seed: 23 }));
      bangs(-0.6, 0.6, 7, 0.8, 0.5, 0.0, 0.14);
      for (const s of [-1, 1]) {
        const parts = [];
        for (let k = 0; k < 7; k++) {
          const ang = (k / 7) * TAU;
          const off = V(0, Math.cos(ang) * 0.06, Math.sin(ang) * 0.06);
          const sp = 0.85 + rand() * 0.3;
          const pts = [off.clone(), V(s * 0.16, -0.06, 0).add(off.clone().multiplyScalar(1.5)), V(s * 0.3 * sp, -0.3, 0.01).add(off.clone().multiplyScalar(1.6)), V(s * 0.3 * sp, -0.55, 0.02).add(off), V(s * 0.4 * sp, -0.66, 0.03)];
          parts.push(lockGeo(pts, { w: 0.12, color: hc, k: shadeR(), segs: 14, flat: 0.75, taper: 2, up: (t, P) => V(0, P.y + 0.3, P.z).normalize(), sheenT: 0.2 }));
        }
        const bob = ball(accent, [s * 0.05, 0.02, 0], 0.12, [0, 0, 0], 14, 10);
        paintFn(bob, (x, y, z, c) => c.copy(col(accent)).multiplyScalar(0.8 + 0.35 * smooth(-0.05, 0.12, y + z * 0.5)));
        parts.push(bob);
        parts.push(ball(mix(accent, '#ffffff', 0.2), [s * 0.05, 0.13, 0.03], 0.075, [0, 0, 0], 10, 8));
        danglies.push({ geo: merge(parts), pivot: [s * 0.86, 0.25 * sy, -0.18], side: s });
      }
      break;
    }
    default:
      geos.push(hairShell(o, { front: 0.58, side: 0.1, back: -0.5, R: 1.07 }));
  }
  return { geos, danglies };
}

// ---------------------------------------------------------------------------
// Hands, legs, shoes, socks
// ---------------------------------------------------------------------------

// Symmetric hand (works for both sides): palm centre at the origin, fingers
// down -Y in a row along Z, palm facing ±X, thumb forward (+Z).
function handGeo(hR, skinC, curl = 0) {
  const parts = [];
  const knuckle = mix(skinC, '#f0a08c', 0.18);
  const palm = ball(skinC, [0, 0, 0], [hR * 0.42, hR * 0.6, hR * 0.66], [0, 0, 0], 14, 10);
  parts.push(palm);
  for (let k = 0; k < 4; k++) {
    const z = (k - 1.5) * hR * 0.33;
    const len = hR * (0.62 + (k === 1 || k === 2 ? 0.08 : -0.05));
    const y0 = -hR * 0.38;
    const pts = [V(0, y0, z), V(curl * len * 0.25, y0 - len * 0.55, z * 1.04), V(curl * len * 0.7, y0 - len * (1 - curl * 0.35), z * 1.06)];
    parts.push(sweep(pts, { segs: 5, radial: 6, r: (t) => hR * 0.165 * (1 - 0.12 * t), colorFn: (t, a, c) => c.copy(skinC).lerp(knuckle, 0.5 * Math.exp(-(((t - 0.45) / 0.15) ** 2))) }));
  }
  parts.push(sweep([V(0, hR * 0.15, hR * 0.5), V(curl * hR * 0.1, -hR * 0.12, hR * 0.82), V(curl * hR * 0.25, -hR * 0.36, hR * 0.9)], { segs: 5, radial: 6, r: (t) => hR * 0.19 * (1 - 0.15 * t), color: skinC }));
  return merge(parts);
}

// Shoe with a flat sole: origin on the ground under the ankle, toe +Z.
function shoeGeo({ w, h, len, color, sole, style, s }) {
  const g = new THREE.SphereGeometry(1, 22, 13);
  const p = g.attributes.position;
  const soleY = -0.35;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let Y = (y + soleY + Math.sqrt((y - soleY) ** 2 + 0.004)) / 2; // soft max -> flat sole
    if (y > 0) Y *= 1 - 0.38 * smooth(0, 1, z);
    const Z = z > 0 ? z * len * 0.66 : z * len * 0.36;
    const X = x * w * (z > 0.4 ? 1 - 0.1 * smooth(0.4, 1, z) : 1);
    p.setXYZ(i, X, ((Y - soleY) / (1 - soleY)) * h, Z);
  }
  g.computeVertexNormals();
  const cc = col(color);
  const sc = col(sole);
  paintFn(g, (x, y, z, c) => {
    if (y < h * 0.09) c.copy(sc);
    else c.copy(cc).multiplyScalar(0.85 + 0.25 * smooth(h * 0.3, h, y));
  });
  const parts = [g];
  if (style === 'mary') {
    parts.push(sweep([V(-w * 0.98, h * 0.6, len * 0.02), V(-w * 0.5, h * 0.98, len * 0.06), V(w * 0.5, h * 0.98, len * 0.06), V(w * 0.98, h * 0.6, len * 0.02)], { segs: 12, radial: 6, r: h * 0.12, flat: 0.35, up: V(0, 1, 0.3).normalize(), color: shade(color, 0.8) }));
    parts.push(ball('#f3ead6', [s * w * 0.92, h * 0.62, len * 0.03], [h * 0.06, h * 0.1, h * 0.1], [0, 0, 0], 8, 6));
  } else {
    // tongue + laces
    parts.push(ball(shade(color, 0.92), [0, h * 0.82, len * 0.08], [w * 0.55, h * 0.18, len * 0.2], [-0.4, 0, 0], 12, 8));
    for (let k = 0; k < 3; k++) {
      const z = len * (0.02 + k * 0.08);
      const y = h * (0.9 - k * 0.1);
      parts.push(box('#efe4cc', [0, y, z], [w * 0.8, h * 0.05, h * 0.06], [-0.4, 0, 0]));
    }
    parts.push(ball('#efe4cc', [s * w * 0.3, h * 0.98, len * 0.0], [h * 0.12, h * 0.05, h * 0.07], [0, 0, 0.5], 8, 6));
  }
  return merge(parts);
}

// Ribbed knitted tube (lathe around a vertical axis at x = cx).
function knitLathe(cx, pts, seg, ribN, ribA, colorFn) {
  const g = lathe(pts, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const k = 1 + ribA * Math.cos(Math.atan2(x, z) * ribN);
    p.setXYZ(i, x * k + cx, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  return paintFn(g, colorFn);
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

const CREAM = '#f3ead6';
const WHITE = '#fbf8f0';

// Skirt morphs: [flare/lift, sway X, sway Z]; w = 0 at the waist, 1 at the hem.
function skirtMorphs(g, waistL, hemL, A, zf) {
  const W = (y) => {
    const w = smooth(waistL, hemL, y);
    return w * w;
  };
  return addMorphs(
    g,
    [
      (x, y, z, d) => {
        const w = W(y);
        const zz = z / zf;
        const L = Math.hypot(x, zz) || 1;
        d[0] = (x / L) * w * A * 0.8;
        d[2] = (zz / L) * w * A * 0.8 * zf;
        d[1] = w * A * 0.45;
      },
      (x, y, z, d) => {
        const w = W(y);
        d[0] = w * A;
        d[1] = w * A * 0.12;
      },
      (x, y, z, d) => {
        const w = W(y);
        d[2] = w * A;
        d[1] = w * A * 0.12;
      },
    ],
    A * 1.5,
  );
}

function buildKidBody(P) {
  const { r, sh, hipY, sw, girl, skin, accent, index } = P;
  const zf = 0.8;
  const Y = (y) => y - hipY; // torso-local
  const L = { skin: [], cloth: [], gloss: [] };
  const T = { fabric: [], cloth: [], skin: [], gloss: [] };
  const arm = { skin: [], sleeve: [] };
  const skinC = col(skin);

  // ---- legs (rig space): chubby tapered legs, knee bump ----
  const legR = r * 0.26;
  const legX = sw * 0.42;
  const shoeH = legR * 1.2;
  const kneeY = hipY * 0.48;
  const legRad = (y) => legR * pl(y / hipY, [[0, 0.62], [0.12, 0.68], [0.3, 0.9], [0.42, 0.84], [0.48, 0.88], [0.6, 0.92], [1, 1.12]]);
  const y0 = shoeH * 0.5;
  const y1 = hipY + 0.02;
  for (const s of [-1, 1]) {
    L.skin.push(
      sweep([V(s * legX, y0, 0), V(s * legX, kneeY, 0.003), V(s * legX, y1, 0)], {
        segs: 18,
        radial: 12,
        r: (t) => legRad(lerp(y0, y1, t)),
        colorFn: (t, a, c) => c.copy(skinC).lerp(col('#f2a08e'), 0.15 * Math.exp(-(((lerp(y0, y1, t) - kneeY) / (legR * 0.6)) ** 2)) * Math.max(0, Math.cos(a))),
      }),
    );
    // socks
    if (girl) {
      const top = legR * 2.5;
      const prof = [];
      for (let k = 0; k <= 6; k++) {
        const y = lerp(shoeH * 0.35, top, k / 6);
        prof.push([legRad(y) * 1.1, y]);
      }
      L.cloth.push(knitLathe(s * legX, prof, 32, 16, 0.035, (x, y, z, c) => c.set(WHITE).multiplyScalar(0.92 + 0.08 * smooth(shoeH, top, y))));
      const cuff = [];
      const cR = legRad(top) * 1.3;
      cuff.push([cR * 0.86, top + legR * 0.08], [cR, top - legR * 0.05], [cR * 1.03, top - legR * 0.45], [cR * 1.06, top - legR * 0.6]);
      const cg = knitLathe(s * legX, cuff, 36, 18, 0.03, (x, y, z, c) => c.set(WHITE));
      const cp = cg.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const yy = cp.getY(i);
        if (yy < top - legR * 0.5) cp.setY(i, yy + legR * 0.12 * Math.abs(Math.sin(Math.atan2(cp.getX(i) - s * legX, cp.getZ(i)) * 9)));
      }
      cg.computeVertexNormals();
      L.cloth.push(cg);
    } else {
      const top = kneeY - legR * 0.35;
      const prof = [];
      for (let k = 0; k <= 8; k++) {
        const y = lerp(shoeH * 0.35, top, k / 8);
        prof.push([legRad(y) * 1.12, y]);
      }
      const ac = col(accent);
      L.cloth.push(knitLathe(s * legX, prof, 32, 16, 0.04, (x, y, z, c) => c.copy(ac).multiplyScalar(0.88 + 0.12 * smooth(shoeH, top, y))));
      const cR = legRad(top) * 1.32;
      const cuff = [[cR * 0.85, top + legR * 0.1], [cR, top], [cR * 1.03, top - legR * 0.35], [cR * 1.05, top - legR * 0.75], [cR * 0.95, top - legR * 0.8]];
      L.cloth.push(
        knitLathe(s * legX, cuff, 36, 18, 0.03, (x, y, z, c) => {
          const f = (top - y) / (legR * 0.8);
          const stripe = (f > 0.25 && f < 0.37) || (f > 0.55 && f < 0.67);
          c.copy(stripe ? col(CREAM) : ac.clone().multiplyScalar(0.92));
        }),
      );
    }
    // shoes
    L.gloss.push(
      shoeGeo({ w: legR * 1.3, h: shoeH, len: legR * 3.4, color: girl ? '#8a2f26' : '#5a3622', sole: girl ? '#3a1d17' : '#2a1a12', style: girl ? 'mary' : 'lace', s }).translate(s * legX, 0, legR * 0.35),
    );
  }

  // neck
  T.skin.push(
    sweep([V(0, Y(sh - r * 0.15), 0), V(0, Y(sh + r * 0.55), 0.01)], {
      segs: 4,
      radial: 14,
      r: (t) => r * lerp(0.33, 0.28, t),
      colorFn: (t, a, c) => c.copy(skinC).multiplyScalar(0.86 + 0.14 * t),
    }),
  );

  // ---- arms (hang along -Y from the shoulder pivot); one geometry for both ----
  const armLen = (sh - hipY) * 1.12 + r * 0.12;
  const aR = r * 0.19;
  const hR = r * 0.27;
  arm.skin.push(
    sweep([V(0, -r * 0.02, 0), V(0, -armLen * 0.5, -0.004), V(0, -armLen + hR * 0.75, 0)], {
      segs: 14,
      radial: 10,
      r: (t) => aR * pl(t, [[0, 1.1], [0.3, 1.0], [0.48, 0.86], [0.56, 0.9], [0.9, 0.74], [1, 0.7]]),
      color: skinC,
    }),
  );
  arm.skin.push(handGeo(hR, skinC, 0.15).translate(0, -armLen, r * 0.01));

  let skirt = null;
  if (girl) {
    const waist = hipY + (sh - hipY) * 0.38;
    const hem = hipY * 0.45;
    const bod = [
      [sw * 0.8, waist - 0.012],
      [sw * 0.81, lerp(waist, sh, 0.25)],
      [sw * 0.86, lerp(waist, sh, 0.55)],
      [sw * 0.92, sh - r * 0.14],
      [sw * 0.86, sh - r * 0.03],
      [sw * 0.68, sh + r * 0.03],
      [sw * 0.44, sh + r * 0.07],
      [r * 0.3, sh + r * 0.09],
    ];
    T.fabric.push(clothLathe(bod, 40, { zf, yOff: -hipY, fabric: true }));
    const sk = [
      [sw * 0.77, waist + 0.004],
      [sw * 0.86, lerp(waist, hem, 0.08)],
      [sw * 1.0, lerp(waist, hem, 0.3)],
      [sw * 1.16, lerp(waist, hem, 0.6)],
      [sw * 1.27, lerp(waist, hem, 0.88)],
      [sw * 1.31, hem],
    ];
    const NP = 14;
    const def = (out = 0) => (x, y, z) => {
      const w = smooth(waist, hem, y);
      const phi = Math.atan2(x, z);
      const rr = Math.hypot(x, z) || 1;
      const k = (rr + out) / rr * (1 + 0.065 * w * Math.cos(phi * NP));
      return [x * k, y + r * 0.05 * w * w * w * Math.sin(phi * NP + 0.8), z * k];
    };
    const skirtFab = clothLathe(sk, 72, { zf, yOff: -hipY, fabric: true, def: def() });
    paintFn(skirtFab, (x, y, z, c) => {
      const yy = y + hipY;
      c.setRGB(1, 1, 1).multiplyScalar(0.9 + 0.1 * smooth(waist - r * 0.05, waist - r * 0.4, yy));
    });
    T.fabric.push(skirtFab);
    // accent ribbon trim near the hem + lace petticoat edge
    const trimY0 = hem + r * 0.07;
    const trimY1 = hem + r * 0.2;
    const trimPts = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const y = lerp(trimY0, trimY1, t);
      return [profR(sk, y), y];
    });
    T.cloth.push(paintFn(clothLathe(trimPts, 72, { zf, yOff: -hipY, def: def(0.004) }), (x, y, z, c) => c.copy(col(accent)).multiplyScalar(0.9 + 0.15 * Math.sin(Math.PI * clamp((y + hipY - trimY0) / (trimY1 - trimY0), 0, 1)))));
    const laceR = profR(sk, hem) * 0.985;
    const lace = clothLathe([[laceR * 0.98, hem + r * 0.05], [laceR, hem - r * 0.02], [laceR * 1.01, hem - r * 0.07]], 96, { zf, yOff: -hipY, def: def() });
    const lp = lace.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const y = lp.getY(i);
      if (y < Y(hem - r * 0.04)) lp.setY(i, y + r * 0.04 * Math.abs(Math.sin(Math.atan2(lp.getX(i), lp.getZ(i)) * 20)));
    }
    lace.computeVertexNormals();
    T.cloth.push(paint(lace, WHITE));
    // waist sash + bow (accent)
    const bandR = profR(bod, waist);
    T.cloth.push(
      paintFn(clothLathe([[bandR, waist - r * 0.14], [bandR + 0.006, waist - r * 0.1], [bandR + 0.008, waist], [bandR + 0.006, waist + r * 0.1], [bandR, waist + r * 0.14]], 40, { zf, yOff: -hipY }), (x, y, z, c) =>
        c.copy(col(accent)).multiplyScalar(0.85 + 0.2 * Math.cos(((y + hipY - waist) / (r * 0.14)) * 1.5)),
      ),
    );
    T.cloth.push(place(bowGeo(accent, r * 0.4, { tails: 1.3, tailSpread: 0.25 }), [sw * 0.5, Y(waist), bandR * zf * 0.86 + r * 0.05], [0, 0.55, 0]));
    // Peter Pan collar with accent stitching
    for (const s of [-1, 1]) {
      const lobe = ball(WHITE, [s * r * 0.18, Y(sh + r * 0.045), r * 0.22], [r * 0.26, r * 0.065, r * 0.18], [0.25, 0, s * -0.3], 16, 8);
      T.cloth.push(lobe);
      const edge = [];
      for (let k = 0; k <= 6; k++) {
        const a = lerp(-1.6, 1.4, k / 6);
        edge.push(V(s * r * 0.18 + s * Math.cos(a) * r * 0.24, Y(sh + r * 0.04) + Math.sin(a) * r * 0.02, r * 0.22 + Math.sin(a) * r * 0.165).applyAxisAngle(V(1, 0, 0), 0));
      }
      T.cloth.push(sweep(edge, { segs: 12, radial: 4, r: r * 0.012, color: accent }));
    }
    // buttons
    for (let k = 0; k < 3; k++) {
      const y = lerp(waist + r * 0.22, sh - r * 0.2, k / 2);
      T.gloss.push(ball(WHITE, [0, Y(y), profR(bod, y) * zf + r * 0.012], [r * 0.045, r * 0.045, r * 0.025], [0, 0, 0], 10, 6));
    }
    // puff sleeves (in the arm group, centred on the shoulder pivot)
    const puff = new THREE.SphereGeometry(1, 22, 14);
    const pp = puff.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i);
      const y = pp.getY(i);
      const z = pp.getZ(i);
      const phi = Math.atan2(x, z);
      const gather = (1 + 0.07 * Math.cos(phi * 10) * (1 - Math.abs(y))) * (y < -0.3 ? lerp(1, 0.72, smooth(-0.3, -1, y)) : 1);
      pp.setXYZ(i, x * gather, y, z * gather);
    }
    puff.computeVertexNormals();
    uvScale(puff, (TAU * r * 0.33) / TILE, (Math.PI * r * 0.33) / TILE);
    arm.sleeve.push(place(puff, [0, -r * 0.04, 0], [0, 0, 0], [r * 0.34, r * 0.3, r * 0.32]));
    const cuff = new THREE.TorusGeometry(r * 0.22, r * 0.035, 6, 20);
    cuff.rotateX(Math.PI / 2);
    arm.skin.push(paint(cuff.translate(0, -r * 0.3, 0), WHITE));
    skirt = { waistL: Y(waist), hemL: Y(hem), A: r * 0.28 };
  } else {
    const waist = hipY + (sh - hipY) * 0.22;
    const shirt = [
      [sw * 0.78, hipY - r * 0.05],
      [sw * 0.84, waist],
      [sw * 0.86, lerp(waist, sh, 0.5)],
      [sw * 0.92, sh - r * 0.12],
      [sw * 0.86, sh - r * 0.02],
      [sw * 0.68, sh + r * 0.03],
      [sw * 0.44, sh + r * 0.07],
      [r * 0.3, sh + r * 0.09],
    ];
    T.cloth.push(paintFn(clothLathe(shirt, 40, { zf, yOff: -hipY }), (x, y, z, c) => c.set(CREAM).multiplyScalar(0.9 + 0.1 * smooth(Y(waist), Y(sh), y))));
    // shirt collar points
    for (const s of [-1, 1]) {
      T.cloth.push(
        sweep([V(s * r * 0.3, Y(sh + r * 0.12), -r * 0.02), V(s * r * 0.3, Y(sh + r * 0.05), r * 0.22), V(s * r * 0.14, Y(sh - r * 0.14), r * 0.36)], {
          segs: 8,
          radial: 6,
          r: (t) => r * lerp(0.1, 0.03, t),
          flat: 0.3,
          up: V(s * 0.3, 1, 0.5).normalize(),
          color: WHITE,
        }),
      );
    }
    // lederhosen cut from the curtains
    const shorts = [
      [sw * 0.3, hipY - r * 0.24],
      [sw * 0.8, hipY - r * 0.17],
      [sw * 0.88, hipY - r * 0.05],
      [sw * 0.9, waist],
      [sw * 0.88, waist + r * 0.06],
      [sw * 0.6, waist + r * 0.07],
    ];
    T.fabric.push(clothLathe(shorts, 40, { zf, yOff: -hipY, fabric: true }));
    const legTop = hipY - r * 0.06;
    const legBot = hipY - r * 0.95;
    for (const s of [-1, 1]) {
      const tube = clothLathe(
        [[legR * 1.62, legTop], [legR * 1.68, lerp(legTop, legBot, 0.5)], [legR * 1.76, legBot + r * 0.12], [legR * 1.9, legBot + r * 0.1], [legR * 1.9, legBot], [legR * 1.75, legBot - 0.003]],
        28,
        { zf: 1, yOff: 0, fabric: true },
      );
      paintFn(tube, (x, y, z, c) => c.setRGB(1, 1, 1).multiplyScalar(y < legBot + r * 0.105 ? 0.8 : 0.95));
      tube.translate(s * legX, -hipY, 0);
      T.fabric.push(tube);
    }
    // front flap (Latz) with cream stitching and horn buttons
    const flapPts = [];
    for (let k = 0; k <= 4; k++) {
      const y = lerp(hipY - r * 0.12, waist + r * 0.04, k / 4);
      flapPts.push([profR(shorts, y) + 0.004, y]);
    }
    T.fabric.push(paintFn(clothLathe(flapPts, 10, { zf, yOff: -hipY, fabric: true, phiStart: -0.5, phiLen: 1.0 }), (x, y, z, c) => c.setRGB(0.95, 0.95, 0.95)));
    const front = (y) => profR(shirt, y) * zf + r * 0.035;
    const stitch = [];
    for (const a of [-0.45, 0.45]) {
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const y = lerp(hipY - r * 0.1, waist + r * 0.02, k / 4);
        const R = profR(shorts, y) + 0.007;
        pts.push(V(Math.sin(a) * R, Y(y), Math.cos(a) * R * zf));
      }
      stitch.push(sweep(pts, { segs: 8, radial: 4, r: r * 0.01, color: CREAM }));
    }
    T.cloth.push(...stitch);
    for (const s of [-1, 1]) {
      const y = waist - r * 0.05;
      const R = profR(shorts, y) + 0.01;
      T.gloss.push(ball('#6b4a2e', [Math.sin(s * 0.38) * R, Y(y), Math.cos(0.38) * R * zf], [r * 0.045, r * 0.045, r * 0.025], [0, 0, 0], 10, 6));
    }
    // H-braces (dark green): over the shoulders, chest bar with embroidery
    const brace = '#3b5a35';
    const ym = lerp(waist, sh, 0.55);
    for (const s of [-1, 1]) {
      const pts = [
        V(s * sw * 0.4, Y(waist - r * 0.02), front(waist)),
        V(s * sw * 0.42, Y(ym), front(ym)),
        V(s * sw * 0.5, Y(sh + r * 0.0), sw * 0.38 * zf),
        V(s * sw * 0.52, Y(sh + r * 0.05), 0),
        V(s * sw * 0.48, Y(sh - r * 0.02), -sw * 0.5 * zf),
        V(s * sw * 0.42, Y(ym), -front(ym)),
        V(s * sw * 0.4, Y(waist - r * 0.02), -front(waist)),
      ];
      T.cloth.push(sweep(pts, { segs: 28, radial: 6, r: r * 0.065, flat: 0.32, up: (t, P) => V(P.x * 0.3, 0, P.z).normalize(), color: brace }));
      T.gloss.push(ball('#6b4a2e', [s * sw * 0.4, Y(waist + r * 0.05), front(waist) + r * 0.03], [r * 0.05, r * 0.05, r * 0.03], [0, 0, 0], 10, 6));
    }
    const barPts = [-1, -0.5, 0, 0.5, 1].map((t) => V(t * sw * 0.44, Y(ym), front(ym) + r * 0.012 + (1 - t * t) * r * 0.02));
    T.cloth.push(sweep(barPts, { segs: 10, radial: 6, r: r * 0.085, flat: 0.3, up: V(0, 0, 1), color: brace }));
    // edelweiss embroidery on the bar
    const fz = front(ym) + r * 0.045;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      T.cloth.push(ball(WHITE, [Math.cos(a) * r * 0.04, Y(ym) + Math.sin(a) * r * 0.04, fz], [r * 0.035, r * 0.016, r * 0.01], [0, 0, a], 8, 4));
    }
    T.cloth.push(ball('#f2c94c', [0, Y(ym), fz + r * 0.005], r * 0.018, [0, 0, 0], 8, 5));
    for (const s of [-1, 1]) T.cloth.push(ball(accent, [s * r * 0.12, Y(ym), fz - r * 0.004], [r * 0.03, r * 0.012, r * 0.01], [0, 0, s * 0.4], 6, 4));
    // shirt buttons
    for (let k = 0; k < 2; k++) T.gloss.push(ball(WHITE, [0, Y(lerp(waist, ym, 0.4 + k * 0.4)), front(lerp(waist, ym, 0.4 + k * 0.4)) - r * 0.02], [r * 0.035, r * 0.035, r * 0.02], [0, 0, 0], 8, 5));
    // neckerchief (accent) with knot and little tails
    const nf = front(sh - r * 0.22);
    const ring = new THREE.TorusGeometry(r * 0.33, r * 0.09, 6, 20);
    ring.rotateX(Math.PI / 2 - 0.15);
    T.cloth.push(paint(ring.translate(0, Y(sh + r * 0.08), 0), accent));
    const tri = new THREE.ConeGeometry(r * 0.4, r * 0.7, 16, 3);
    tri.rotateX(Math.PI);
    tri.scale(1, 1, 0.3);
    const tp = tri.attributes.position;
    for (let i = 0; i < tp.count; i++) tp.setZ(i, tp.getZ(i) + 0.012 * r * Math.sin(tp.getX(i) / r * 18));
    tri.computeVertexNormals();
    T.cloth.push(paintFn(place(tri, [0, Y(sh - r * 0.26), nf + r * 0.02], [-0.3, 0, 0]), (x, y, z, c) => c.copy(col(accent)).multiplyScalar(0.85 + 0.2 * smooth(Y(sh - r * 0.6), Y(sh), y))));
    T.cloth.push(ball(shade(accent, 0.9), [0, Y(sh + r * 0.02), r * 0.37], [r * 0.12, r * 0.11, r * 0.1], [0, 0, 0], 12, 8));
    for (const s of [-1, 1]) {
      T.cloth.push(sweep([V(0, Y(sh), r * 0.42), V(s * r * 0.1, Y(sh - r * 0.12), r * 0.46), V(s * r * 0.14, Y(sh - r * 0.26), r * 0.46)], { segs: 6, radial: 6, r: (t) => r * 0.06 * (1 - 0.4 * t), flat: 0.35, up: V(0, 0, 1), color: accent }));
    }
    // rolled-up shirt sleeves
    const sleeveC = col(CREAM);
    arm.sleeve.push(ball(CREAM, [0, 0, 0], [aR * 1.65, aR * 1.65, aR * 1.65], [0, 0, 0], 14, 10));
    arm.sleeve.push(
      sweep([V(0, 0, 0), V(0, -armLen * 0.25, 0), V(0, -armLen * 0.46, 0)], { segs: 8, radial: 12, r: (t) => aR * lerp(1.6, 1.42, t), colorFn: (t, a, c) => c.copy(sleeveC).multiplyScalar(0.92 + 0.08 * Math.cos(a * 3 + t * 5)), capEnd: false, capStart: false }),
    );
    const roll = new THREE.TorusGeometry(aR * 1.42, aR * 0.32, 6, 18);
    roll.rotateX(Math.PI / 2);
    arm.sleeve.push(paint(roll.translate(0, -armLen * 0.46, 0), WHITE));
  }

  return {
    lower: { skin: merge(L.skin), cloth: merge(L.cloth), gloss: merge(L.gloss) },
    torso: { fabric: merge(T.fabric), cloth: merge(T.cloth), skin: merge(T.skin), gloss: merge(T.gloss) },
    armSkin: merge(arm.skin),
    armSleeve: merge(arm.sleeve),
    sleeveMat: girl ? 'fabric' : 'cloth',
    skirt,
    shoulders: [V(-sw * 0.93, Y(sh - r * 0.16), 0), V(sw * 0.93, Y(sh - r * 0.16), 0)],
  };
}

// Maria's guitar, built along +X in its own frame (top faces +Z).
function buildGuitarGeo() {
  const top = 0.042;
  const outline = [];
  const C1 = [-0.12, 0, 0.165];
  const C2 = [0.07, 0, 0.125];
  const cx = -0.03;
  const NS = 72;
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
  for (let pass = 0; pass < 3; pass++) {
    const prev = outline.map((q) => q.slice());
    for (let k = 0; k < NS; k++) {
      const a = prev[(k + NS - 1) % NS];
      const b = prev[(k + 1) % NS];
      outline[k] = [(a[0] + 2 * prev[k][0] + b[0]) / 4, (a[1] + 2 * prev[k][1] + b[1]) / 4];
    }
  }
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const gb = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 1 });
  gb.translate(0, 0, -0.03);
  const spruce = col('#efc27a');
  const burst = col('#b8702e');
  paintFn(gb, (x, y, z, c) => {
    if (z > 0.039) c.copy(spruce).lerp(burst, smooth(0.08, 0.19, Math.hypot((x - cx) * 0.8, y)) * 0.8);
    else if (z > 0.031) c.set('#f4e6c6');
    else if (z < -0.031) c.set('#7d4426');
    else c.set('#6a361c');
  });
  const gp = [gb];
  const hx = 0.035;
  const hole = new THREE.CircleGeometry(0.045, 28);
  gp.push(paint(hole.translate(hx, 0, top + 0.0006), '#1e120b'));
  const rings = [
    [0.047, 0.051, '#3a2416'],
    [0.051, 0.059, null],
    [0.059, 0.062, '#3a2416'],
    [0.064, 0.066, '#3a2416'],
  ];
  for (const [a, b, c] of rings) {
    const rg = new THREE.RingGeometry(a, b, 64, 1);
    if (c) paint(rg, c);
    else paintFn(rg, (x, y, z, cc) => {
      const k = Math.floor(((Math.atan2(y, x) + Math.PI) / TAU) * 48) % 3;
      cc.set(k === 0 ? '#3f7a4a' : k === 1 ? '#f2e6c8' : '#a8402e');
    });
    gp.push(rg.translate(hx, 0, top + 0.0008));
  }
  // bridge, saddle, tie block
  gp.push(box('#3a2416', [-0.165, 0, top + 0.004], [0.028, 0.11, 0.008]));
  gp.push(ball('#3a2416', [-0.165, 0.055, top + 0.004], [0.014, 0.008, 0.004], [0, 0, 0], 8, 4));
  gp.push(ball('#3a2416', [-0.165, -0.055, top + 0.004], [0.014, 0.008, 0.004], [0, 0, 0], 8, 4));
  gp.push(box('#f6efdc', [-0.159, 0, top + 0.0095], [0.003, 0.07, 0.004]));
  // neck, fretboard, frets, nut
  const neck = new THREE.CylinderGeometry(0.022, 0.025, 0.38, 14, 1);
  neck.rotateZ(Math.PI / 2);
  neck.scale(1, 1, 0.75);
  gp.push(paint(neck.translate(0.36, 0, top - 0.017), '#7a4424'));
  gp.push(box('#2a1a12', [0.365, 0, top + 0.006], [0.38, 0.05, 0.006]));
  const scale = 0.716;
  for (let n = 1; n <= 12; n++) {
    const x = 0.551 - scale * (1 - Math.pow(2, -n / 12));
    gp.push(box('#d9d6cc', [x, 0, top + 0.0098], [0.0022, 0.05, 0.0024]));
  }
  gp.push(box('#f6efdc', [0.553, 0, top + 0.01], [0.006, 0.05, 0.008]));
  // slotted headstock with tuners
  const head = merge([
    box('#6b3d1e', [0.625, 0, 0], [0.15, 0.064, 0.02]),
    box('#1e120b', [0.628, 0.015, 0], [0.105, 0.012, 0.022]),
    box('#1e120b', [0.628, -0.015, 0], [0.105, 0.012, 0.022]),
    ball('#6b3d1e', [0.7, 0, 0], [0.012, 0.034, 0.0105], [0, 0, 0], 10, 6),
    ...[0, 1, 2].flatMap((k) => [
      rod([0.59 + k * 0.034, -0.045, 0], [0.59 + k * 0.034, 0.045, 0], 0.0035, 0.0035, '#c8c4b8', 6),
      ball('#f4ecdc', [0.59 + k * 0.034, 0.052, 0], [0.008, 0.011, 0.004], [0, 0, 0], 8, 5),
      ball('#f4ecdc', [0.59 + k * 0.034, -0.052, 0], [0.008, 0.011, 0.004], [0, 0, 0], 8, 5),
    ]),
  ]);
  head.rotateY(-0.12);
  head.translate(0, 0, top - 0.01);
  gp.push(head);
  // six strings
  for (let k = 0; k < 6; k++) {
    const yb = (k - 2.5) * 0.0074;
    const yn = (k - 2.5) * 0.0066;
    gp.push(rod([-0.161, yb, top + 0.012], [0.553, yn, top + 0.0145], 0.0011 + (k < 3 ? 0.0005 : 0), 0.0011 + (k < 3 ? 0.0005 : 0), k < 3 ? '#d8d2c4' : '#f6eedd', 4, true));
  }
  return merge(gp);
}

// Maria: dress, apron, guitar. Coordinates hand-placed for H = 1.65 m.
function buildMariaBody(P) {
  const { hipY, skin, r } = P;
  const zf = 0.8;
  const Y = (y) => y - hipY;
  const dress = '#7f93ab';
  const dressC = col(dress);
  const skinC = col(skin);
  const L = { skin: [], gloss: [] };
  const T = { cloth: [], skin: [], satin: [] };

  // legs (sheer stockings) + Mary-Janes
  const stock = mix(skin, '#c99a82', 0.25);
  for (const s of [-1, 1]) {
    L.skin.push(sweep([V(s * 0.07, 0.05, 0), V(s * 0.069, 0.33, 0.004), V(s * 0.07, 0.64, 0)], { segs: 14, radial: 12, r: (t) => pl(t, [[0, 0.03], [0.12, 0.033], [0.35, 0.046], [0.5, 0.04], [0.6, 0.042], [1, 0.05]]), color: stock }));
    L.gloss.push(shoeGeo({ w: 0.046, h: 0.06, len: 0.17, color: '#4b3024', sole: '#24160f', style: 'mary', s }).translate(s * 0.07, 0, 0.02));
  }

  // bodice
  const bod = [
    [0.148, 0.93],
    [0.137, 1.0],
    [0.15, 1.08],
    [0.168, 1.15],
    [0.172, 1.19],
    [0.14, 1.225],
    [0.075, 1.245],
    [0.045, 1.25],
  ];
  T.cloth.push(paintFn(clothLathe(bod, 40, { zf, yOff: -hipY }), (x, y, z, c) => c.copy(dressC)));
  // gathered skirt
  const waist = 0.95;
  const hem = 0.31;
  const sk = [
    [0.152, 0.945],
    [0.2, 0.83],
    [0.24, 0.69],
    [0.272, 0.52],
    [0.296, 0.36],
    [0.302, 0.31],
  ];
  const NP = 18;
  const def = (out = 0) => (x, y, z) => {
    const w = smooth(waist, hem, y);
    const phi = Math.atan2(x, z);
    const rr = Math.hypot(x, z) || 1;
    const k = ((rr + out) / rr) * (1 + 0.05 * w * Math.cos(phi * NP));
    return [x * k, y + 0.012 * w * w * w * Math.sin(phi * NP + 0.8), z * k];
  };
  T.cloth.push(paintFn(clothLathe(sk, 80, { zf, yOff: -hipY, def: def() }), (x, y, z, c) => c.copy(dressC).multiplyScalar(0.88 + 0.12 * smooth(Y(waist), Y(0.8), y))));
  // dark-blue hem ribbon
  const hb = [0.335, 0.345, 0.36].map((y) => [profR(sk, y), y]);
  T.cloth.push(paint(clothLathe(hb, 80, { zf, yOff: -hipY, def: def(0.003) }), '#3e5378'));
  // apron: gathered front panel following the folds
  const apPts = [];
  for (let k = 0; k <= 8; k++) {
    const y = lerp(0.375, 0.945, k / 8);
    apPts.push([profR(sk, y) + 0.008, y]);
  }
  const aPhi = 0.95;
  T.cloth.push(paintFn(clothLathe(apPts, 40, { zf, yOff: -hipY, def: def(), phiStart: -aPhi, phiLen: aPhi * 2 }), (x, y, z, c) => c.set(CREAM).multiplyScalar(0.9 + 0.1 * smooth(Y(waist), Y(0.7), y))));
  // embroidered band near the apron hem (cross-stitch flowers)
  const emb = [0.395, 0.41, 0.425].map((y) => [profR(sk, y) + 0.011, y]);
  const embG = clothLathe(emb, 120, { zf, yOff: -hipY, def: def(), phiStart: -aPhi + 0.03, phiLen: aPhi * 2 - 0.06 });
  paintFn(embG, (x, y, z, c, i) => {
    const col_ = Math.floor(i / 3);
    const row = i % 3;
    const m = col_ % 6;
    if (row === 1 && (m === 1 || m === 4)) c.set(m === 1 ? '#c9403a' : '#3e6fb8');
    else if (row !== 1 && (m === 1 || m === 4)) c.set('#4f8a4a');
    else c.set(CREAM);
  });
  T.cloth.push(embG);
  // scalloped lace edge
  const lace = clothLathe([[profR(sk, 0.39) + 0.009, 0.385], [profR(sk, 0.37) + 0.01, 0.37], [profR(sk, 0.36) + 0.011, 0.358]], 96, { zf, yOff: -hipY, def: def(), phiStart: -aPhi, phiLen: aPhi * 2 });
  const lpp = lace.attributes.position;
  for (let i = 0; i < lpp.count; i++) {
    const y = lpp.getY(i);
    if (y < Y(0.365)) lpp.setY(i, y + 0.01 * Math.abs(Math.sin(Math.atan2(lpp.getX(i), lpp.getZ(i)) * 22)));
  }
  lace.computeVertexNormals();
  T.cloth.push(paint(lace, WHITE));
  // bib, waistband, straps, ties + bow at the back
  T.cloth.push(paint(clothLathe([[0.152, 0.99], [0.158, 1.04], [0.164, 1.09], [0.178, 1.14]], 14, { zf, yOff: -hipY, phiStart: -0.52, phiLen: 1.04 }), CREAM));
  for (let k = 0; k <= 10; k++) {
    const a = -0.5 + k * 0.1;
    T.cloth.push(ball(WHITE, [Math.sin(a) * 0.181, Y(1.143), Math.cos(a) * 0.181 * zf], [0.011, 0.008, 0.005], [0, a, 0], 6, 4));
  }
  T.cloth.push(paint(clothLathe([[0.144, 0.946], [0.151, 0.96], [0.153, 0.975], [0.15, 0.99], [0.144, 1.0]], 32, { zf, yOff: -hipY }), CREAM));
  for (const s of [-1, 1]) {
    T.cloth.push(
      sweep([V(s * 0.085, Y(1.14), 0.165 * zf * 0.95), V(s * 0.1, Y(1.2), 0.12 * zf), V(s * 0.1, Y(1.236), 0), V(s * 0.09, Y(1.2), -0.14 * zf), V(s * 0.06, Y(1.0), -0.15 * zf)], {
        segs: 18,
        radial: 6,
        r: 0.012,
        flat: 0.3,
        up: (t, P) => V(P.x, 0, P.z).normalize(),
        color: CREAM,
      }),
    );
  }
  const backBow = bowGeo(CREAM, 0.085, { tails: 3.2, tailSpread: 0.35 });
  backBow.rotateY(Math.PI);
  T.cloth.push(backBow.translate(0, Y(0.972), -0.152 * zf - 0.012));
  // Peter Pan collar + puff shoulders live on the arms; neck
  for (const s of [-1, 1]) T.cloth.push(ball(WHITE, [s * 0.044, Y(1.247), 0.042], [0.058, 0.016, 0.042], [0.25, 0, s * -0.3], 14, 8));
  T.skin.push(sweep([V(0, Y(1.2), 0), V(0, Y(P.centreY - 0.5 * r), 0.006)], { segs: 4, radial: 14, r: (t) => r * lerp(0.27, 0.24, t), colorFn: (t, a, c) => c.copy(skinC).multiplyScalar(0.86 + 0.14 * t) }));

  // guitar across the body
  const guitar = buildGuitarGeo();
  const gRot = 0.42;
  const gPos = V(-0.02, 0.14, 0.205);
  guitar.applyMatrix4(new THREE.Matrix4().compose(gPos, new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), gRot), V(1, 1, 1)));
  const gPt = (x, y, z) => V(x, y, z).applyAxisAngle(V(0, 0, 1), gRot).add(gPos);
  const strapCurve = [gPt(0.19, 0, -0.04), V(0.17, 0.32, 0.12), V(0.16, 0.392, 0.05), V(0.14, 0.407, -0.04), V(0.1, 0.36, -0.125), V(-0.05, 0.2, -0.145), V(-0.2, 0.08, -0.13), V(-0.3, 0.03, 0.0), gPt(-0.3, 0, -0.03)];
  const strap = sweep(strapCurve, {
    segs: 70,
    radial: 6,
    r: 0.013,
    flat: 0.35,
    colorFn: (t, a, c) => c.set(Math.floor(t * 90) % 4 === 0 ? '#f3e2b8' : '#b8463a'),
  });
  T.satin.push(guitar, strap);

  // arms
  const SR = V(-0.172, 0.355, 0);
  const ER = V(-0.25, 0.14, 0.11);
  const HR = gPt(-0.04, 0, 0.075);
  const SL = V(0.172, 0.355, 0);
  const EL = V(0.3, 0.13, 0.04);
  const HL = gPt(0.42, 0, -0.02);

  const puff = () => {
    const g = new THREE.SphereGeometry(0.064, 18, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const k = 1 + 0.07 * Math.cos(Math.atan2(x, z) * 10);
      p.setXYZ(i, x * k, p.getY(i), z * k);
    }
    g.computeVertexNormals();
    return paint(g, dress);
  };
  const sleeveR = (t) => lerp(0.046, 0.036, t);

  // left arm: on the guitar neck
  const rel = (v) => v.clone().sub(SL);
  const wristL = EL.clone().lerp(HL, 0.62);
  const aL = { cloth: [puff()], skin: [] };
  aL.cloth.push(sweep([rel(SL), rel(SL.clone().lerp(EL, 0.5)), rel(EL), rel(EL.clone().lerp(wristL, 0.5)), rel(wristL)], { segs: 16, radial: 10, r: sleeveR, color: dress, capEnd: false }));
  const cuffL = new THREE.TorusGeometry(0.034, 0.008, 6, 16);
  cuffL.applyMatrix4(new THREE.Matrix4().compose(rel(wristL), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), HL.clone().sub(EL).normalize()), V(1, 1, 1)));
  aL.skin.push(paint(cuffL, WHITE));
  const neckC = gPt(0.42, 0, 0.034);
  const na = V(Math.cos(gRot), Math.sin(gRot), 0);
  const nu = V(-Math.sin(gRot), Math.cos(gRot), 0);
  const nz = V(0, 0, 1);
  const palmL = neckC.clone().addScaledVector(nu, 0.03).addScaledVector(nz, -0.04);
  aL.skin.push(sweep([rel(wristL), rel(wristL.clone().lerp(palmL, 0.6))], { segs: 4, radial: 10, r: 0.028, color: skin }));
  aL.skin.push(paint(place(new THREE.SphereGeometry(1, 14, 10), rel(palmL).toArray(), [0, 0, gRot], [0.04, 0.034, 0.024]), skin));
  for (let k = 0; k < 4; k++) {
    const off = (k - 1.5) * 0.019;
    const base = neckC.clone().addScaledVector(na, off);
    aL.skin.push(
      sweep([base.clone().addScaledVector(nu, 0.04).addScaledVector(nz, -0.03), base.clone().addScaledVector(nu, 0.038).addScaledVector(nz, 0.012), base.clone().addScaledVector(nu, 0.012).addScaledVector(nz, 0.03)].map(rel), {
        segs: 6,
        radial: 8,
        r: 0.0085,
        color: skin,
      }),
    );
  }
  aL.skin.push(sweep([palmL.clone().addScaledVector(na, -0.02), neckC.clone().addScaledVector(nu, -0.01).addScaledVector(nz, -0.035).addScaledVector(na, -0.01)].map(rel), { segs: 4, radial: 8, r: 0.01, color: skin }));

  // right arm: upper + forearm (strums / waves)
  const dU = ER.clone().sub(SR);
  const LU = dU.length();
  const dF = HR.clone().sub(ER);
  const LF = dF.length();
  const qU = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dU.normalize());
  const qF = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dF.normalize());
  const qUc = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), V(-0.42, 0.9, 0.14).normalize());
  const upper = merge([puff(), sweep([V(0, 0, 0), V(0, -LU * 0.5, 0), V(0, -LU - 0.01, 0)], { segs: 10, radial: 10, r: (t) => lerp(0.046, 0.041, t), color: dress })]);
  const foreCloth = merge([sweep([V(0, 0.01, 0), V(0, -LF * 0.6, 0)], { segs: 8, radial: 10, r: (t) => lerp(0.041, 0.036, t), color: dress, capEnd: false })]);
  const cuffR = new THREE.TorusGeometry(0.034, 0.008, 6, 16);
  cuffR.rotateX(Math.PI / 2);
  const foreSkin = merge([
    paint(cuffR.translate(0, -LF * 0.6, 0), WHITE),
    sweep([V(0, -LF * 0.6, 0), V(0, -LF + 0.01, 0)], { segs: 4, radial: 10, r: (t) => lerp(0.03, 0.026, t), color: skin }),
    handGeo(0.06, skinC, 0.3).translate(0, -LF - 0.015, 0.004),
  ]);

  return {
    lower: { skin: merge(L.skin), gloss: merge(L.gloss) },
    torso: { cloth: merge(T.cloth), skin: merge(T.skin), satin: merge(T.satin) },
    armL: { cloth: merge(aL.cloth), skin: merge(aL.skin) },
    upperGeo: upper,
    foreCloth,
    foreSkin,
    skirt: { waistL: Y(waist), hemL: Y(hem), A: 0.06 },
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
    this.dang = this.danglyMeshes.map((m) => ({ mesh: m, side: m.userData.side, kx: m.userData.kx ?? 0.35, minX: m.userData.minX ?? -Infinity, x: 0, v: 0, ph: R() * TAU }));
    this.tgt = { outL: cfg.armRest, outR: cfg.armRest, fwdL: 0, fwdR: 0 };
    // secondary motion: skirt hem (flare, sway x, sway z) and brows
    this.skirt = parts.skirtMeshes || [];
    this.skF = { x: 0, v: 0 };
    this.skX = { x: 0, v: 0 };
    this.skZ = { x: 0, v: 0 };
    this.browWorry = 0;
    this.browArch = 0;

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
    this.skF.v += 0.6;
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
      this.skX.v -= this.oopsSide * 2;
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
    this.skF.v -= 3 * this.hopS;
  }

  _land() {
    const impact = Math.min(-this.vy, 8);
    this.y = 0;
    this.vy = 0;
    this.hopPhase = 'ground';
    this.sq.v -= impact * 1.1;
    this.lift.v -= 2;
    for (const d of this.dang) d.v -= impact * 0.9;
    this.skF.v += impact * 1.4;
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
    if (this.skirt.length) {
      spring(this.skF, air ? clamp(-this.vy * 0.07, -0.35, 0.7) : antic ? -0.2 : 0, 120, 5.5, h);
      spring(this.skX, -this.wobble.x * 2.4 - this.sway.x * 2.5 + 0.05 * Math.sin(t * 1.3 + this.phase), 75, 4, h);
      spring(this.skZ, this.lean * 1.8 + 0.04 * Math.sin(t * 1.1 + this.phase2) + (air ? 0.12 : 0), 75, 4, h);
      this.skF.x = clamp(this.skF.x, -0.5, 1.2);
      this.skX.x = clamp(this.skX.x, -1, 1);
      this.skZ.x = clamp(this.skZ.x, -1, 1);
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
    let worryT = 0;
    let archT = 0;
    if (m === 'happy') {
      lidT = c.lidOpen + 0.2;
      browT = 0.05;
      openT = 0.28;
      rollT = 0.06 * Math.sin(t * 2.2 + this.phase);
      archT = 0.6;
    } else if (m === 'cheer') {
      lidT = c.lidOpen - 0.15;
      browT = 0.09;
      openT = 0.7 + 0.14 * Math.sin(t * 7.3 + this.phase);
      pitchT = -0.12;
      leanT = -0.05;
      archT = 1;
    } else if (m === 'oops') {
      if (mt < 0.38) {
        lidT = -1.08;
        browT = 0.15;
        oT = 0.95;
        pitchT = 0.06;
        worryT = 0.6;
        archT = 0.5;
      } else {
        lidT = 0.18;
        browT = 0.06;
        openT = 0.12;
        rollT = 0.16 * this.oopsSide;
        pitchT = 0.05;
        worryT = 1;
      }
    }

    const singing = this.singT > 0;
    this.singAmt = damp(this.singAmt, singing ? 1 : 0, singing ? 28 : 12, dt);
    const sa = this.singAmt;
    openT = Math.max(openT, sa * this.singOpen * (1 - this.singRound));
    oT = Math.max(oT, sa * this.singRound);
    if (!(m === 'oops' && mt < 0.38)) lidT = lerp(lidT, Math.max(lidT, -0.22), 0.5 * sa);
    browT += 0.05 * sa;
    archT = Math.max(archT, 0.55 * sa);
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
    this.brows.position.y = this.browY * 0.6 - 0.03 * b;
    this.browWorry = damp(this.browWorry, worryT, 12, dt);
    this.browArch = damp(this.browArch, archT, 10, dt);
    const bi = this.brows.morphTargetInfluences;
    if (bi) {
      bi[0] = this.browWorry;
      bi[1] = this.browArch;
    }

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
      d.mesh.rotation.x = Math.max(d.minX, d.x * d.kx);
    }

    // skirt hem
    for (const sm of this.skirt) {
      const si = sm.morphTargetInfluences;
      si[0] = this.skF.x;
      si[1] = this.skX.x;
      si[2] = this.skZ.x;
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
// `lower` / `torso` map material names to merged geometries.
function assembleCommon({ name, height, hipY, neckY, centreY, r, face, lower, torsoGeos, skirt }) {
  const S = shared();
  const group = new THREE.Group();
  group.name = name;
  const rig = new THREE.Group();
  rig.name = `${name}-rig`;
  group.add(rig);
  for (const [mat, geo] of Object.entries(lower)) rig.add(mesh(geo, S[mat], true, `legs-${mat}`));

  const torso = new THREE.Group();
  torso.position.y = hipY;
  rig.add(torso);
  const skirtMeshes = [];
  for (const [mat, geo] of Object.entries(torsoGeos)) {
    if (skirt && (mat === 'fabric' || mat === 'cloth')) skirtMorphs(geo, skirt.waistL, skirt.hemL, skirt.A, 0.8);
    const m = mesh(geo, S[mat], true, `body-${mat}`);
    if (skirt && geo.morphAttributes.position) skirtMeshes.push(m);
    torso.add(m);
  }

  const headPivot = new THREE.Group();
  headPivot.position.y = neckY - hipY;
  torso.add(headPivot);
  const head = new THREE.Group();
  head.position.y = centreY - neckY;
  head.scale.setScalar(r);
  headPivot.add(head);

  head.add(mesh(face.skinGeo, S.skin, true, 'head'));
  head.add(mesh(face.hairGeo, S.hair, true, 'hair'));
  const irisL = mesh(face.eyeGeo, S.eye, false, 'eye');
  irisL.position.copy(face.eyes[0]);
  const irisR = mesh(face.eyeGeo, S.eye, false, 'eye');
  irisR.position.copy(face.eyes[1]);
  const shine = mesh(face.shineGeo, S.shine, false, 'shine');
  shine.castShadow = true;
  const lids = mesh(face.lidGeo, S.skin, false, 'lids');
  lids.position.copy(face.lidPivot);
  const mouth = mesh(face.mouthGeo, S.mouth, false, 'mouth');
  const brows = mesh(face.browGeo, S.hair, false, 'brows');
  head.add(irisL, irisR, shine, lids, mouth, brows);

  const danglyMeshes = face.danglies.map((d) => {
    const dm = mesh(d.geo, S.hair, true, 'hair-dangly');
    dm.position.set(...d.pivot);
    dm.userData.side = d.side;
    if (d.kx != null) dm.userData.kx = d.kx;
    if (d.minX != null) dm.userData.minX = d.minX;
    head.add(dm);
    return dm;
  });

  return { group, rig, torso, headPivot, head, irisL, irisR, lids, mouth, brows, danglyMeshes, skirtMeshes, height };
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
      eyeSink: 0.66,
      jaw: 0.14,
      chin: 0.04,
      bridge: true,
      noseR: 0.08,
      mouthW: 0.22,
      mouthY: -0.4,
      lipColor: '#c4505a',
      blush: 0.38,
      browT: 0.034,
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
  const parts = assembleCommon({ name: 'maria', height: H, hipY, neckY, centreY, r, face, lower: b.lower, torsoGeos: b.torso, skirt: b.skirt });

  const armL = new THREE.Group();
  armL.position.copy(b.SL);
  armL.add(mesh(b.armL.cloth, S.cloth, true, 'sleeve'), mesh(b.armL.skin, S.skin, true, 'hand'));
  parts.torso.add(armL);
  const upperR = new THREE.Group();
  upperR.position.copy(b.SR);
  upperR.quaternion.copy(b.qU);
  upperR.add(mesh(b.upperGeo, S.cloth, true, 'sleeve'));
  parts.torso.add(upperR);
  const foreR = new THREE.Group();
  foreR.position.set(0, -b.LU, 0);
  foreR.add(mesh(b.foreCloth, S.cloth, true, 'sleeve'), mesh(b.foreSkin, S.skin, true, 'hand'));
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
  // 0 · Do — eldest girl: long chestnut hair, big red bow, red sash + hem ribbon
  { girl: true, hair: 'long', hairColor: '#7a4428', eyeColor: '#4f86bd', skin: '#f6caa9' },
  // 1 · Re — eldest boy: short brown hair, felt hat with apricot cord, apricot neckerchief + socks
  { girl: false, hair: 'short', hairColor: '#5a3520', eyeColor: '#5e8a4a', skin: '#f2c19d' },
  // 2 · Mi — auburn plaits with yellow ribbons, yellow headband + sash, freckles
  { girl: true, hair: 'braids', hairColor: '#a24f28', eyeColor: '#4b8a68', skin: '#f7cfb2', freckles: 18 },
  // 3 · Fa — curly-haired boy, green neckerchief + socks, freckles
  { girl: false, hair: 'curls', hairColor: '#4a2e1e', eyeColor: '#7a5232', skin: '#f0bd98', freckles: 12 },
  // 4 · So — honey-blonde side ponytail with a sky-blue scrunchie, blue sash
  { girl: true, hair: 'ponytail', hairColor: '#c99447', eyeColor: '#4686c8', skin: '#f6caa9' },
  // 5 · La — light-brown pigtails with gentian bobbles, blue sash
  { girl: true, hair: 'pigtails', hairColor: '#8e5a34', eyeColor: '#6a4a2e', skin: '#f4c4a2' },
  // 6 · Ti — youngest: golden ringlet curls, big violet bow, violet sash
  { girl: true, hair: 'curls', ringlets: true, hairColor: '#e6bc5c', eyeColor: '#4a8fd2', skin: '#f8d1b4' },
];

export function createChild(index = 0) {
  const i = clamp(Math.round(fin(Number(index), 0)), 0, 6);
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
      jaw: 0.04,
      chin: 0.02,
      noseR: 0.1,
      mouthW: 0.24,
      mouthY: ey - 0.42,
      lipColor: spec.girl ? '#c8606a' : '#b8605c',
      blush: 0.5,
      browT: 0.045,
      hair: spec.hair,
      ringlets: !!spec.ringlets,
      hairColor: spec.hairColor,
      eyeColor: spec.eyeColor,
      accent,
      lashes: spec.girl,
      freckles: spec.freckles || 0,
    },
    rand,
  );
  const b = buildKidBody({ r, sh, hipY, sw, girl: spec.girl, skin: spec.skin, accent, index: i });
  const parts = assembleCommon({ name: `child-${i}`, height: H, hipY, neckY, centreY, r, face, lower: b.lower, torsoGeos: b.torso, skirt: b.skirt });

  const S = shared();
  const mkArm = (pos) => {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.add(mesh(b.armSkin, S.skin, true, 'arm'), mesh(b.armSleeve, S[b.sleeveMat], true, 'sleeve'));
    return g;
  };
  const armL = mkArm(b.shoulders[1]); // character's left = +X
  const armR = mkArm(b.shoulders[0]);
  parts.torso.add(armL, armR);

  const rig = new Rig(
    { ...parts, armL, armR },
    { seed: 31 + i * 1013, hopH: 0.3 + 0.01 * (6 - i), lidOpen: -0.62, lidClosed: 1.45, armRest: 0.18 },
  );
  return api(rig, false);
}
