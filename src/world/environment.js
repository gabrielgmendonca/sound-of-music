// Do-Re-Mi Meadow - the world: sky, meadow, Alps, lake, chapel, chalets,
// lighting and the finale's petals + balloons. Everything is procedural and
// driven by update(dt, t); there are no timers and no external assets.
//
// Needs camera.far >= ~560 (the farthest mountains sit ~250 m behind origin).
// Budget (normal): ~40 draw calls, < 450k triangles. lowPower roughly halves
// the instance counts and mesh resolutions.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NOTE_COLORS, STAGE } from '../config.js';

const smoothIco = (r, d) => {
  let g = new THREE.IcosahedronGeometry(r, d);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  return g;
};

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const CLEAR = STAGE.clearRadius;
const FOG_COLOR = '#d9e9f3';
const HAZE_COLOR = '#c3d8ea';
const SUN_POS = new THREE.Vector3(-6, 10, 8);
const SUN_DIR_SKY = new THREE.Vector3(-0.45, 0.21, -0.87).normalize();
const LAKE = { x: 6, z: -46, ax: 18, az: 10, y: 0.0 };
const CHAPEL_HILL = { x: -11, z: -63, sigma: 13, height: 6 };
// splat map (painted ground detail) covers this world rectangle
const SPLAT = { x0: -120, z0: -160, w: 240, h: 220 };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
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
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();
const _c4 = new THREE.Color();

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, z * f, seed + i * 17);
    n += a;
    f *= 2.03;
    a *= 0.5;
  }
  return s / n;
}
function ridged(x, z, oct = 5, seed = 0) {
  let s = 0, a = 0.5, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x * f, z * f, seed + i * 31) * 2 - 1);
    n *= n;
    n *= w;
    w = clamp(n * 2, 0, 1);
    s += n * a;
    f *= 2.1;
    a *= 0.5;
  }
  return s;
}

// Terrain -------------------------------------------------------------------
function rolling(x, z) {
  return (
    Math.sin(x * 0.09 + 1.3) * Math.cos(z * 0.07 + 0.4) * 1.1 +
    Math.sin(x * 0.21 - z * 0.17 + 2.0) * 0.45 +
    Math.sin(z * 0.045 + x * 0.025) * 1.3 +
    Math.cos(x * 0.05 - z * 0.06) * 0.9 +
    2.2
  );
}

function lakeE(x, z) {
  return Math.hypot((x - LAKE.x) / LAKE.ax, (z - LAKE.z) / LAKE.az);
}

export function heightAt(x, z) {
  const d = Math.hypot(x, z);
  const w = smooth(CLEAR, CLEAR + 15, d);
  // keep the ground near / under the camera low and calm
  const front = lerp(1, 0.12, smooth(0, 10, z));
  // calm corridor behind the stage so the lake and chapel stay visible
  const calm = lerp(0.22, 1, Math.max(smooth(16, 48, Math.abs(x)), smooth(-50, -85, z)));
  let h = (rolling(x, z) - 2.2) * 0.55 * w * front * calm;
  h += (Math.sin(x * 0.7 + z * 0.4) + Math.sin(z * 0.9 - x * 0.3)) * 0.05 * w * front;
  // hills that rise behind the lake and fall away towards the far mountains
  const ridge =
    smooth(-48, -108, z) *
    (1 - 0.8 * smooth(-112, -175, z)) *
    (6 + 4 * Math.sin(x * 0.04 + 0.7) + 2.5 * Math.cos(x * 0.083 - z * 0.03));
  h += ridge * w;
  // valley walls to either side
  h += smooth(24, 85, Math.abs(x)) * 7 * w * (0.7 + 0.3 * Math.sin(z * 0.06 + x * 0.02));
  // chapel hill
  const cdx = x - CHAPEL_HILL.x;
  const cdz = z - CHAPEL_HILL.z;
  h += CHAPEL_HILL.height * Math.exp(-(cdx * cdx + cdz * cdz) / (2 * CHAPEL_HILL.sigma * CHAPEL_HILL.sigma));
  // lake basin: shallow bank, then dip below the water
  const e = lakeE(x, z);
  const s = 1 - smooth(1.05, 1.9, e);
  if (s > 0) {
    const bank = LAKE.y - 1.1 + 1.18 * smooth(0.7, 1.12, e);
    h = lerp(h, bank, s);
  }
  return h;
}

// Geometry helpers ------------------------------------------------------------
function paint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  if (typeof fn === 'string') fn = new THREE.Color(fn);
  for (let i = 0; i < pos.count; i++) {
    const c = typeof fn === 'function' ? fn(pos.getX(i), pos.getY(i), pos.getZ(i), i) : fn;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function merge(list) {
  const geos = list.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    if (!x.attributes.normal) x.computeVertexNormals();
    return x;
  });
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const C = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    C.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}

const _M4 = new THREE.Matrix4();
const _Q = new THREE.Quaternion();
const _E = new THREE.Euler();
const _V = new THREE.Vector3();
const _S = new THREE.Vector3();
// Euler 'XYZ': rz is applied first, then ry, then rx.
function xf(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  _M4.compose(_V.set(x, y, z), _Q.setFromEuler(_E.set(rx, ry, rz)), _S.set(sx, sy, sz));
  geo.applyMatrix4(_M4);
  return geo;
}

function canvasTexture(w, h, draw, fallbackRGBA = [255, 255, 255, 0]) {
  let tex;
  try {
    if (typeof document === 'undefined') throw new Error('no document');
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d ctx');
    draw(ctx, w, h);
    tex = new THREE.CanvasTexture(c);
  } catch (e) {
    tex = new THREE.DataTexture(new Uint8Array(fallbackRGBA), 1, 1);
    tex.needsUpdate = true;
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A curved, pointed petal / leaf strip lying along +X (width along Z, curl up in Y).
function petalGeo(len, wid, curl = 0.15, segs = 2, cup = 0, r0 = 0, blunt = 0.6) {
  const across = cup > 0 ? 3 : 2;
  const rows = segs + 1;
  const pos = [];
  const idx = [];
  for (let i = 0; i < rows; i++) {
    const s = i / segs;
    const w = wid * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + s * 0.96)), blunt) * (1 - 0.15 * s);
    const x = r0 + s * len;
    const y = curl * len * s * s;
    for (let a = 0; a < across; a++) {
      const u = across === 2 ? (a === 0 ? -1 : 1) : a - 1;
      pos.push(x, y + (cup > 0 ? cup * w * u * u : 0), u * w);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let a = 0; a < across - 1; a++) {
      const p = i * across + a;
      idx.push(p, p + across, p + 1, p + 1, p + across, p + across + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function stemGeo(H, r0, r1, bend, c0 = '#3f8a2f', c1 = '#79c04a') {
  const g = new THREE.CylinderGeometry(r1, r0, H, 4, 3, true);
  g.translate(0, H / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / H;
    p.setX(i, p.getX(i) + bend * t * t);
  }
  g.computeVertexNormals();
  const a = new THREE.Color(c0), b = new THREE.Color(c1);
  return paint(g, (x, y) => _c1.copy(a).lerp(b, clamp(y / H, 0, 1)));
}

// Wind sway + beat bob + cloud shadows (+ ground splat / grass tip glow),
// injected into a Lambert material.
function patchWorld(mat, shared, o = {}) {
  const { sway = 0, bob = 0, tip = 0, splat = null, cloud = true } = o;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uBeat = shared.uBeat;
    shader.uniforms.uSway = { value: sway };
    shader.uniforms.uBob = { value: bob };
    shader.uniforms.uTip = { value: tip };
    if (splat) shader.uniforms.uSplat = { value: splat };
    shader.vertexShader =
      'uniform float uTime;\nuniform float uBeat;\nuniform float uSway;\nuniform float uBob;\nvarying vec3 vWP;\nvarying float vLY;\n' +
      shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
        vLY = position.y;
        ${
          sway > 0 || bob > 0
            ? `float swH = max(position.y, 0.0);
        #ifdef USE_INSTANCING
          vec3 swP = instanceMatrix[3].xyz;
        #else
          vec3 swP = vec3(0.0);
        #endif
        float swPh = swP.x * 0.31 + swP.z * 0.47;
        float swW = sin(uTime * 1.7 + swPh) + 0.5 * sin(uTime * 2.9 + swPh * 1.7);
        transformed.x += swW * swH * swH * uSway;
        transformed.z += cos(uTime * 1.3 + swPh * 1.3) * swH * swH * uSway * 0.6;
        transformed.y += uBeat * swH * uBob * (0.75 + 0.25 * sin(swPh * 3.0));
        transformed.x += uBeat * swH * uBob * 0.35 * sin(swPh);`
            : ''
        }`
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        wp4 = modelMatrix * wp4;
        vWP = wp4.xyz;`
        );
    shader.fragmentShader =
      `uniform float uTime;
uniform float uTip;
varying vec3 vWP;
varying float vLY;
${splat ? 'uniform sampler2D uSplat;' : ''}
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
` +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        ${
          splat
            ? `{
          vec2 suv = (vWP.xz - vec2(${SPLAT.x0.toFixed(1)}, ${SPLAT.z0.toFixed(1)})) / vec2(${SPLAT.w.toFixed(1)}, ${SPLAT.h.toFixed(1)});
          float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
          vec4 sp = texture2D(uSplat, suv);
          diffuseColor.rgb = diffuseColor.rgb * (1.0 - sp.a * inside) + sp.rgb * inside;
          float cd = length(vWP - cameraPosition);
          float fade = 1.0 - smoothstep(14.0, 60.0, cd);
          float mn = vn(vWP.xz * 2.1) * 0.5 + vn(vWP.xz * 6.3 + 7.0) * 0.3 + vn(vWP.xz * 17.0 + 3.0) * 0.2;
          float big = vn(vWP.xz * 0.35) - 0.5;
          diffuseColor.rgb *= 1.0 + (mn - 0.5) * 0.34 * fade + big * 0.18 * (1.0 - fade * 0.4);
        }`
            : ''
        }`
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
        ${
          cloud
            ? `{
          vec2 cp = vWP.xz * 0.016 + vec2(uTime * 0.035, uTime * 0.011);
          float cn = vn(cp) * 0.55 + vn(cp * 2.3 + 5.0) * 0.3 + vn(cp * 5.1 + 11.0) * 0.15;
          float cs = smoothstep(0.5, 0.68, cn);
          reflectedLight.directDiffuse *= mix(1.0, 0.42, cs);
          reflectedLight.indirectDiffuse *= mix(1.0, 0.93, cs);
        }`
            : ''
        }
        ${
          tip > 0
            ? `reflectedLight.indirectDiffuse += diffuseColor.rgb * uTip * smoothstep(0.35, 1.0, vLY) * vec3(1.0, 0.95, 0.55);`
            : ''
        }`
        );
  };
  mat.customProgramCacheKey = () => `pw1-${sway > 0 ? 1 : 0}${tip > 0 ? 1 : 0}${splat ? 1 : 0}${cloud ? 1 : 0}`;
  return mat;
}

// Wing flapping for far-away birds / near butterflies (unlit, instanced).
function patchFlap(mat, shared, mode) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader =
      'uniform float uTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fph = float(gl_InstanceID) * 1.713;
        ${
          mode === 'bird'
            ? `float fl = sin(uTime * 6.5 + fph * 2.0);
        transformed.y += fl * abs(position.x) * 0.38 - abs(position.x) * abs(position.x) * 0.06;`
            : `float fa = 0.12 + 0.95 * abs(sin(uTime * 15.0 + fph * 3.0));
        float fs = sign(position.x);
        float fx = abs(position.x);
        transformed.x = fs * fx * cos(fa);
        transformed.y += fx * sin(fa);`
        }`
      );
  };
  mat.customProgramCacheKey = () => 'flap-' + mode;
  return mat;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function createEnvironment(scene, { lowPower = false } = {}) {
  const lp = !!lowPower;
  const rnd = mulberry32(20240611);
  const R = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const shared = { uTime: { value: 0 }, uBeat: { value: 0 } };
  const dummy = new THREE.Object3D();
  const moodMats = {}; // unlit materials that setMood() has to tint by hand

  // Keep-out zones for characters' feet.
  const inStage = (x, z, m = 0) =>
    (x > -3.7 - m && x < 3.7 + m && z > -0.9 - m && z < 1.1 + m) ||
    Math.hypot(x - STAGE.maria.x, z - STAGE.maria.z) < 1.0 + m;

  // Scene-level look ----------------------------------------------------------
  const fogColor = new THREE.Color(FOG_COLOR);
  const hazeColor = new THREE.Color(HAZE_COLOR);
  scene.background = fogColor.clone();
  scene.fog = new THREE.Fog(fogColor.clone(), 70, 520);

  // Lights --------------------------------------------------------------------
  const sun = new THREE.DirectionalLight('#ffe0ad', 2.9);
  sun.position.copy(SUN_POS);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const smap = lp ? 1024 : 2048;
  sun.shadow.mapSize.set(smap, smap);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  {
    // Fit the orthographic shadow frustum to the stage box.
    const cam = sun.shadow.camera;
    cam.position.copy(SUN_POS);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    inv.copy(cam.matrixWorld).invert();
    let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity, n = Infinity, f = -Infinity;
    const v = new THREE.Vector3();
    for (const x of [-7, 7]) for (const y of [-0.2, 2.4]) for (const z of [-3, 4]) {
      v.set(x, y, z).applyMatrix4(inv);
      l = Math.min(l, v.x); r = Math.max(r, v.x);
      b = Math.min(b, v.y); t = Math.max(t, v.y);
      n = Math.min(n, -v.z); f = Math.max(f, -v.z);
    }
    cam.left = l - 0.5; cam.right = r + 0.5;
    cam.bottom = b - 0.5; cam.top = t + 0.5;
    cam.near = Math.max(0.5, n - 4); cam.far = f + 4;
    cam.updateProjectionMatrix();
  }
  const hemi = new THREE.HemisphereLight('#bfdcff', '#b9c27e', 1.6);
  const ambient = new THREE.AmbientLight('#fff1dc', 0.55);
  scene.add(hemi, ambient);

  // Sky dome (view-locked, so camera.far never clips it) ------------------------
  const skyUniforms = {
    cZenith: { value: new THREE.Color('#2f78d6') },
    cUpper: { value: new THREE.Color('#5aa6e8') },
    cMid: { value: new THREE.Color('#9ccff2') },
    cLow: { value: new THREE.Color('#cfe6f5') },
    cHorizon: { value: fogColor.clone() },
    cGlow: { value: new THREE.Color('#ffd99a') },
    sunDir: { value: SUN_DIR_SKY.clone() },
  };
  // Dome-only extras (the lake reflection does not use these).
  const domeUniforms = {
    ...skyUniforms,
    cDisc: { value: new THREE.Color().setRGB(1.0, 0.97, 0.86) },
    uStars: { value: 0 },
    uTime: shared.uTime,
  };
  const SKY_FUNCS = `
      uniform vec3 cZenith; uniform vec3 cUpper; uniform vec3 cMid; uniform vec3 cLow; uniform vec3 cHorizon; uniform vec3 cGlow; uniform vec3 sunDir;
      vec3 skyGrad(vec3 d) {
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(cHorizon, cLow, smoothstep(0.0, 0.05, h));
        col = mix(col, cMid, smoothstep(0.03, 0.22, h));
        col = mix(col, cUpper, smoothstep(0.15, 0.55, h));
        col = mix(col, cZenith, smoothstep(0.45, 1.0, h));
        float s = max(dot(d, sunDir), 0.0);
        // warm horizon haze, strongest towards the sun
        float haze = exp(-h * 7.0);
        col = mix(col, mix(cHorizon, cGlow, 0.35 + 0.5 * pow(s, 3.0)), haze * (0.35 + 0.35 * pow(s, 2.0)));
        col += cGlow * (pow(s, 5.0) * 0.16 + pow(s, 28.0) * 0.28);
        return col;
      }`;
  const skyMat = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.BackSide,
    uniforms: domeUniforms,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: `
      ${SKY_FUNCS}
      uniform vec3 cDisc; uniform float uStars; uniform float uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyGrad(d);
        if (uStars > 0.001) {
          // one possible star per cell of a grid wrapped around the dome
          vec3 g = d * 80.0;
          vec3 cell = floor(g);
          float h = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
          float tw = 0.7 + 0.3 * sin(uTime * (1.5 + h * 3.0) + h * 90.0);
          float star = step(0.982, h) * smoothstep(0.32, 0.04, length(fract(g) - 0.5));
          col += vec3(0.86, 0.92, 1.0) * star * tw * uStars * (0.6 + 40.0 * (h - 0.982)) * smoothstep(0.03, 0.3, d.y);
        }
        float s = dot(d, sunDir);
        float disc = smoothstep(0.99935, 0.99965, s);
        col = mix(col, cDisc * 1.6, disc);
        col += cDisc * vec3(1.0, 0.93, 0.7) * pow(max(s, 0.0), 220.0) * 0.8;
        col = mix(col, cHorizon, smoothstep(0.0, -0.08, d.y));
        col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 160.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  // =========================================================================
  // World layout: path, buildings, then everything that avoids them
  // =========================================================================
  const pathCurve = new THREE.CatmullRomCurve3(
    [[13, -9], [7, -13], [2, -19], [-5, -26], [-11, -34], [-17, -43], [-18, -53], [-14, -60], [-11, -66]].map(
      ([x, z]) => new THREE.Vector3(x, 0, z)
    ),
    false,
    'catmullrom',
    0.5
  );
  const pathPts = pathCurve.getPoints(160);
  const pathDist = (x, z) => {
    let m = 1e9;
    for (let i = 0; i < pathPts.length; i++) {
      const dx = pathPts[i].x - x, dz = pathPts[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  };

  const facing = (x, z) => Math.atan2(-x, 12 - z);
  const CHALETS = [
    { x: 20, z: -23, ry: facing(20, -23) - 0.25, s: 1.0 },
    { x: -23, z: -29, ry: facing(-23, -29) + 0.3, s: 1.1 },
    { x: 33, z: -42, ry: facing(33, -42) - 0.4, s: 1.15 },
    { x: -38, z: -48, ry: facing(-38, -48) + 0.5, s: 1.1 },
    { x: 56, z: -78, ry: facing(56, -78) - 0.3, s: 1.5 },
    { x: -62, z: -86, ry: facing(-62, -86) + 0.2, s: 1.5 },
  ];
  const nearBuilding = (x, z, m = 0) => {
    if (Math.hypot(x - CHAPEL_HILL.x, z - CHAPEL_HILL.z) < 9 + m) return true;
    for (const c of CHALETS) if (Math.hypot(x - c.x, z - c.z) < 5.5 * c.s + m) return true;
    return false;
  };

  // ---- placements --------------------------------------------------------
  const trees = []; // {x,z,s,kind} kind 0..2 pine variants, 3 broadleaf
  {
    const total = lp ? 100 : 185;
    const groves = [
      [-20, -6, 5, 16], [24, -9, 5, 14], [-34, -18, 6, 16], [32, -24, 6, 14],
      [-9, -27, 4, 9], [10.5, -30, 4, 8], [-30, -42, 7, 14], [34, -52, 7, 12],
      [-22, -75, 8, 16], [22, -78, 8, 14], [0, -85, 9, 14], [-48, -60, 8, 10],
      [-3, -62, 5, 8], [-17, -58, 4, 8], [-16, 4, 4, 6], [20, 3, 5, 6],
      [44, -34, 6, 10], [-52, -30, 6, 10],
    ];
    const sumN = groves.reduce((s, g) => s + g[3], 0);
    let guard = 0;
    while (trees.length < total && guard++ < total * 60) {
      const gv = groves[Math.floor(R(0, groves.length))];
      if (rnd() > (gv[3] / (sumN / groves.length)) * 0.75) continue;
      const a = R(0, 6.28), rr = gv[2] * Math.sqrt(rnd()) * 1.4;
      const x = gv[0] + Math.cos(a) * rr, z = gv[1] + Math.sin(a) * rr;
      if (Math.hypot(x, z) < CLEAR + 3.5) continue;
      // Keep the view corridor behind the stage open so the lake, chapel and peaks read.
      if (z < 6 && Math.abs(x) < 15 + Math.abs(z) * 0.22) continue;
      if (lakeE(x, z) < 1.25) continue;
      if (nearBuilding(x, z)) continue;
      if (pathDist(x, z) < 2.5) continue;
      const broad = z > -62 && rnd() < 0.08;
      trees.push({ x, z, s: broad ? R(0.9, 1.5) : R(0.8, 1.7), kind: broad ? 3 : pick([0, 0, 1, 1, 2]) });
    }
    // a few broadleaf trees standing by the chalets
    for (const c of CHALETS.slice(0, 4)) {
      for (let i = 0; i < (lp ? 1 : 2); i++) {
        const a = R(0, 6.28), rr = R(5, 8) * c.s;
        trees.push({ x: c.x + Math.cos(a) * rr, z: c.z + Math.sin(a) * rr, s: R(0.9, 1.3), kind: 3 });
      }
    }
  }

  const bushes = []; // {x,z,s,flowering}
  {
    const total = lp ? 28 : 48;
    let guard = 0;
    while (bushes.length < total && guard++ < total * 40) {
      let x, z;
      const r = rnd();
      if (r < 0.4 && trees.length) {
        const t = trees[Math.floor(rnd() * trees.length)];
        x = t.x + R(-3, 3); z = t.z + R(-3, 3);
      } else if (r < 0.7) {
        const p = pathPts[Math.floor(R(0, pathPts.length))];
        x = p.x + R(-3.5, 3.5); z = p.z + R(-3.5, 3.5);
      } else {
        const c = CHALETS[Math.floor(R(0, CHALETS.length))];
        x = c.x + R(-6, 6); z = c.z + R(-5, 5);
      }
      if (Math.hypot(x, z) < CLEAR + 2.5) continue;
      if (z > -4 && Math.abs(x) < 12) continue;
      if (lakeE(x, z) < 1.2) continue;
      if (nearBuilding(x, z, -3)) continue;
      if (pathDist(x, z) < 1.4) continue;
      bushes.push({ x, z, s: R(0.8, 1.5), flowering: rnd() < 0.5 });
    }
  }

  const boulders = []; // {x,z,s}
  {
    const total = lp ? 24 : 44;
    let guard = 0;
    while (boulders.length < total && guard++ < total * 40) {
      let x, z;
      const r = rnd();
      if (r < 0.35) {
        const p = pathPts[Math.floor(R(0, pathPts.length))];
        x = p.x + R(-3, 3); z = p.z + R(-3, 3);
      } else if (r < 0.55) {
        const a = R(0, 6.28);
        x = LAKE.x + Math.cos(a) * LAKE.ax * 1.12; z = LAKE.z + Math.sin(a) * LAKE.az * 1.15;
      } else {
        x = R(-45, 45); z = R(-70, -6);
      }
      if (Math.hypot(x, z) < CLEAR + 3) continue;
      if (z > -4 && Math.abs(x) < 12) continue;
      if (lakeE(x, z) < 1.05) continue;
      if (nearBuilding(x, z, -2)) continue;
      if (pathDist(x, z) < 1.1) continue;
      boulders.push({ x, z, s: R(0.4, 1.1) * (rnd() < 0.15 && z < -20 ? 1.6 : 1) });
    }
  }

  // =========================================================================
  // Painted ground detail ("splat" map): paths, lawn, drifts, tree shadows
  // =========================================================================
  const splatTex = canvasTexture(lp ? 1024 : 2048, lp ? 1024 : 2048, (ctx, W, H) => {
    const px = (x) => ((x - SPLAT.x0) / SPLAT.w) * W;
    const pz = (z) => ((z - SPLAT.z0) / SPLAT.h) * H;
    const sx = W / SPLAT.w, sz = H / SPLAT.h;
    const pr = mulberry32(99);
    const blob = (x, z, rad, rgb, a, squash = 1) => {
      ctx.save();
      ctx.translate(px(x), pz(z));
      ctx.scale(sx * rad, sz * rad * squash);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(0.55, `rgba(${rgb},${a * 0.55})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    ctx.clearRect(0, 0, W, H);
    // lush dark patches and sun-bleached warm patches across the meadow
    for (let i = 0; i < 70; i++) {
      const x = -90 + pr() * 180, z = -120 + pr() * 150;
      blob(x, z, 5 + pr() * 14, pr() < 0.6 ? '38,102,40' : '120,150,48', 0.3 + pr() * 0.25, 0.7 + pr() * 0.5);
    }
    // soft mown lawn around the stage
    blob(0, 2, 15, '150,208,86', 0.55, 0.8);
    blob(0, 0, 9, '165,216,92', 0.35, 0.8);
    // lake shore: wet mud, pale sand, then a darker reed line
    {
      ctx.save();
      ctx.translate(px(LAKE.x), pz(LAKE.z));
      ctx.scale(sx * LAKE.ax, sz * LAKE.az);
      const g = ctx.createRadialGradient(0, 0, 0.7, 0, 0, 1.35);
      g.addColorStop(0, 'rgba(120,100,62,0)');
      g.addColorStop(0.22, 'rgba(120,104,66,0.95)');
      g.addColorStop(0.4, 'rgba(206,190,134,0.9)');
      g.addColorStop(0.62, 'rgba(160,170,92,0.5)');
      g.addColorStop(1, 'rgba(100,150,70,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // wildflower drifts: thousands of tiny painted blossoms
    const flowerCols = ['#fff6d0', '#ffd84a', '#ffffff', '#ff9bbd', '#8aa2ff', '#b58cf0', '#ffb347'];
    const drifts = lp ? 36 : 56;
    for (let i = 0; i < drifts; i++) {
      const near = i < drifts * 0.5;
      const cx = near ? R(-20, 20) : R(-70, 70);
      const cz = near ? R(-14, 12) : R(-100, 0);
      const rad = R(4, 12);
      const c1 = pick(flowerCols), c2 = pick(flowerCols);
      const n = Math.floor(rad * rad * (lp ? 1.8 : 3.2));
      for (let k = 0; k < n; k++) {
        const a = pr() * 6.28, rr = rad * Math.sqrt(pr());
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr * 0.8;
        if (Math.hypot(x, z) < 20) continue;
        ctx.fillStyle = pr() < 0.7 ? c1 : c2;
        const s = 0.55 + pr() * 0.9;
        ctx.beginPath();
        ctx.ellipse(px(x), pz(z), s * sx * 0.12, s * sz * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // winding dirt path: soft edges built from three strokes
    const stroke = (wm, color, alpha) => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = wm * sx;
      ctx.beginPath();
      pathPts.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
      ctx.stroke();
      ctx.restore();
    };
    stroke(3.4, '#6e8a3a', 0.25);
    stroke(2.5, '#9b8650', 0.55);
    stroke(1.9, '#b9a468', 0.9);
    stroke(1.2, '#cdbb7c', 0.9);
    stroke(0.5, '#d8c88c', 0.6);
    // pebbles and grass fringe along the path
    for (let i = 0; i < 900; i++) {
      const p = pathPts[Math.floor(pr() * pathPts.length)];
      const a = pr() * 6.28, rr = pr() * 1.4;
      ctx.fillStyle = pr() < 0.5 ? '#8c8470' : '#e0d6b4';
      ctx.beginPath();
      ctx.arc(px(p.x + Math.cos(a) * rr), pz(p.z + Math.sin(a) * rr), 0.6 + pr() * 1.0, 0, Math.PI * 2);
      ctx.fill();
    }
    // soft ambient occlusion: under trees, bushes, boulders, buildings
    for (const t of trees) blob(t.x, t.z, (t.kind === 3 ? 3.6 : 2.6) * t.s, '14,40,12', 0.6);
    for (const b of bushes) blob(b.x, b.z, 1.5 * b.s, '16,44,14', 0.45);
    for (const b of boulders) blob(b.x, b.z, 1.4 * b.s, '24,30,14', 0.45);
    blob(CHAPEL_HILL.x, CHAPEL_HILL.z, 7.5, '30,40,20', 0.35);
    for (const c of CHALETS) blob(c.x, c.z, 5.5 * c.s, '30,36,18', 0.45, 0.8);
  });
  splatTex.wrapS = splatTex.wrapT = THREE.ClampToEdgeWrapping;
  splatTex.premultiplyAlpha = true;
  splatTex.flipY = false;
  splatTex.anisotropy = 8;

  // =========================================================================
  // Ground
  // =========================================================================
  {
    const N = lp ? 90 : 125;
    const S = lp ? 160 : 220;
    const RM = 520;
    const SPAN = Math.PI * 2;
    const count = (N + 1) * (S + 1);
    const P = new Float32Array(count * 3);
    const C = new Float32Array(count * 3);
    const greens = ['#7cc04a', '#5aa63c', '#92c856', '#4a9540', '#a6cc5c'].map((h) => new THREE.Color(h));
    const lawn = new THREE.Color('#82c64e');
    const far = new THREE.Color('#6a9f6e');
    const rock = new THREE.Color('#8e8a78');
    const setV = (idx, x, z) => {
      const y = heightAt(x, z);
      P[idx * 3] = x; P[idx * 3 + 1] = y; P[idx * 3 + 2] = z;
      const n1 = fbm(x * 0.06, z * 0.06, 3, 3);
      const n2 = fbm(x * 0.21 + 9, z * 0.21, 2, 5);
      const n3 = fbm(x * 0.02, z * 0.02 + 4, 3, 8);
      _c1.copy(greens[0]).lerp(greens[1], clamp(n1 * 1.6 - 0.35, 0, 1));
      _c1.lerp(greens[2], clamp(n2 * 1.5 - 0.5, 0, 0.6));
      _c1.lerp(greens[3], clamp(n3 * 1.5 - 0.4, 0, 0.5));
      _c1.lerp(greens[4], clamp((n1 - 0.5) * 3, 0, 0.5));
      const d = Math.hypot(x, z);
      _c1.lerp(lawn, 0.5 * (1 - smooth(CLEAR - 1, CLEAR + 12, d)));
      _c1.lerp(far, smooth(60, 260, d) * 0.55);
      _c1.multiplyScalar(0.9 + clamp(y * 0.018, 0, 0.14));
      _c1.lerp(rock, smooth(14, 40, y) * 0.35);
      C[idx * 3] = _c1.r; C[idx * 3 + 1] = _c1.g; C[idx * 3 + 2] = _c1.b;
    };
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const rr = RM * (0.23 * u + 0.77 * u * u * u);
      for (let j = 0; j <= S; j++) {
        const a = (j / S - 0.5) * SPAN; // measured from -Z
        setV(i * (S + 1) + j, Math.sin(a) * rr, -Math.cos(a) * rr);
      }
    }
    const idx = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < S; j++) {
        const a = i * (S + 1) + j, b = a + 1, c = a + S + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = patchWorld(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, { splat: splatTex });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
  }

  // =========================================================================
  // Grass: curved, tapered, multi-segment blades in tufts
  // =========================================================================
  {
    const grassCount = lp ? 1500 : 2700;
    const tris = [];
    const blades = 5;
    const segs = 3;
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * Math.PI * 2 + R(-0.4, 0.4);
      const rad = R(0.02, 0.2);
      const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad;
      const h = R(0.6, 1.0);
      const lean = R(0.12, 0.42);
      const dirA = a + R(-0.5, 0.5);
      const w0 = R(0.045, 0.065);
      const rows = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const cx = bx + Math.cos(dirA) * lean * t * t;
        const cz = bz + Math.sin(dirA) * lean * t * t;
        const cy = h * (t - 0.15 * t * t);
        const w = i === segs ? 0 : w0 * (1 - t * 0.85);
        const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        rows.push([[cx - px, cy, cz - pz], [cx + px, cy, cz + pz]]);
      }
      for (let i = 0; i < segs; i++) {
        const [l0, r0] = rows[i];
        const [l1, r1] = rows[i + 1];
        if (i === segs - 1) tris.push(l0, r0, l1);
        else tris.push(l0, r0, l1, r0, r1, l1);
      }
    }
    const pos = new Float32Array(tris.length * 3);
    tris.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    paint(g, (x, y) => {
      const t = clamp(y / 0.9, 0, 1);
      return _c1.set('#256b2a').lerp(_c2.set('#6cb83c'), Math.min(1, t * 1.5)).lerp(_c3.set('#d4e86a'), smooth(0.65, 1, t) * 0.75);
    });
    // grass normals lean upward so tufts shade like soft turf
    const nn = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < nn.length; i += 3) { nn[i] = 0; nn[i + 1] = 1; nn[i + 2] = 0; }
    g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
    const mat = patchWorld(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, { sway: 0.12, bob: 0.2, tip: 0.3 });
    const mesh = new THREE.InstancedMesh(g, mat, grassCount);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    let k = 0;
    let guard = 0;
    while (k < grassCount && guard++ < grassCount * 12) {
      let x, z;
      const r = rnd();
      if (r < 0.5) { x = R(-13, 13); z = R(-10, 15); }
      else if (r < 0.85) { x = R(-34, 34); z = R(-34, 12); }
      else { x = R(-60, 60); z = R(-70, 0); }
      if (inStage(x, z, 0.1)) continue;
      if (lakeE(x, z) < 1.14) continue;
      if (nearBuilding(x, z, -2)) continue;
      const d = Math.hypot(x, z);
      const pd = pathDist(x, z);
      if (pd < 0.9) continue;
      // short lawn around the stage, longer out in the meadow; calm in front of the cast
      let h = lerp(0.2, 0.75, smooth(CLEAR - 1, CLEAR + 16, d)) * R(0.7, 1.3);
      if (z > 1.5) h = Math.min(h, 0.2 * R(0.7, 1.2));
      if (pd < 2.0) h *= 0.6;
      const w = clamp(h * 1.7, 0.5, 1.5);
      dummy.position.set(x, heightAt(x, z) - 0.015, z);
      dummy.rotation.set(0, R(0, 6.28), 0);
      dummy.scale.set(w * R(0.9, 1.2), h, w * R(0.9, 1.2));
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      mesh.setColorAt(k, _c4.setRGB(R(0.8, 1.1), R(0.9, 1.1), R(0.65, 1.0)));
      k++;
    }
    // reeds around the lake
    const reeds = lp ? 40 : 90;
    for (let i = 0; i < reeds && k < grassCount; i++) {
      const a = R(0, 6.28), e = R(0.96, 1.12);
      const x = LAKE.x + Math.cos(a) * LAKE.ax * e, z = LAKE.z + Math.sin(a) * LAKE.az * e;
      if (pathDist(x, z) < 2) continue;
      dummy.position.set(x, heightAt(x, z) - 0.03, z);
      dummy.rotation.set(0, R(0, 6.28), 0);
      dummy.scale.set(R(0.8, 1.3), R(1.2, 2.0), R(0.8, 1.3));
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      mesh.setColorAt(k, _c4.setRGB(R(0.9, 1.2), R(0.95, 1.1), R(0.6, 0.8)));
      k++;
    }
    mesh.count = k;
    scene.add(mesh);
  }

  // =========================================================================
  // Wildflowers: five species with real 3D petals, stems and leaves
  // =========================================================================
  {
    const S5 = lp
      ? { daisy: 90, gentian: 70, buttercup: 110, rose: 40, edel: 40 }
      : { daisy: 150, gentian: 110, buttercup: 190, rose: 65, edel: 65 };
    const col = (h) => new THREE.Color(h);
    const leafGeo = (len, wid, curl, ang, y, c = '#3b8a35', c2 = '#6aae45') => {
      const g = petalGeo(len, wid, curl, 2, 0, 0.01, 0.8);
      xf(g, { y, ry: ang, rz: 0.55 });
      return paint(g, (x, yy, z) => _c1.set(c).lerp(_c2.set(c2), clamp(Math.hypot(x, z) / len, 0, 1)));
    };
    const species = {};

    // daisy: ring of white petals around a golden dome
    {
      const H = 0.34, bend = 0.03;
      const parts = [stemGeo(H, 0.014, 0.009, bend)];
      parts.push(leafGeo(0.12, 0.03, -0.35, 0.4, 0.05), leafGeo(0.1, 0.028, -0.3, 3.6, 0.09));
      const head = [];
      const n = 16;
      for (let i = 0; i < n; i++) {
        const g = petalGeo(0.1, 0.022, 0.22, 2, 0, 0.025, 0.55);
        xf(g, { ry: (i / n) * Math.PI * 2, rz: 0.12 + (i % 2) * 0.06 });
        head.push(paint(g, (x, y, z) => _c1.set('#fff9f0').lerp(_c2.set('#ffffff'), clamp(Math.hypot(x, z) / 0.12, 0, 1))));
      }
      const dome = new THREE.SphereGeometry(0.036, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      xf(dome, { y: 0.0, sy: 0.8 });
      head.push(paint(dome, (x, y, z) => _c1.set('#e9a417').lerp(_c2.set('#ffd23a'), clamp(y / 0.03, 0, 1))));
      for (const g of head) xf(g, { x: bend, y: H, rz: -0.12 });
      species.daisy = merge([...parts, ...head]);
    }
    // gentian: deep blue trumpet flaring into five lobes
    {
      const H = 0.2, bend = 0.015;
      const parts = [stemGeo(H, 0.012, 0.008, bend)];
      parts.push(leafGeo(0.09, 0.025, -0.2, 1.0, 0.03), leafGeo(0.09, 0.025, -0.2, 4.2, 0.05), leafGeo(0.08, 0.022, -0.2, 2.6, 0.1));
      const prof = [[0.004, 0], [0.02, 0.02], [0.032, 0.07], [0.046, 0.13], [0.062, 0.19]].map(([r, y]) => new THREE.Vector2(r, y));
      const trump = new THREE.LatheGeometry(prof, 8);
      trump.computeVertexNormals();
      paint(trump, (x, y) => _c1.set('#2336a8').lerp(_c2.set('#4a74f0'), clamp(y / 0.19, 0, 1)));
      parts.push(xf(trump, { x: bend, y: H }));
      for (let i = 0; i < 5; i++) {
        const g = petalGeo(0.06, 0.03, -0.2, 2, 0, 0.0, 0.7);
        xf(g, { x: 0, y: 0.19, ry: (i / 5) * Math.PI * 2, rz: 0.55 });
        xf(g, { x: bend, y: H });
        parts.push(paint(g, (x, y) => _c1.set('#3050d8').lerp(_c2.set('#6c93ff'), clamp((y - 0.19) / 0.04, 0, 1))));
      }
      species.gentian = merge(parts);
    }
    // buttercup: five glossy cupped petals, golden stamens
    {
      const H = 0.3, bend = 0.04;
      const parts = [stemGeo(H, 0.013, 0.009, bend)];
      parts.push(leafGeo(0.12, 0.045, -0.1, 0.8, 0.04, '#2f7a30', '#58a444'), leafGeo(0.1, 0.04, -0.1, 3.9, 0.07, '#2f7a30', '#58a444'));
      for (let i = 0; i < 5; i++) {
        const g = petalGeo(0.07, 0.042, 0.55, 2, 0.55, 0.0, 0.5);
        xf(g, { ry: (i / 5) * Math.PI * 2, rz: 0.5 });
        xf(g, { x: bend, y: H });
        parts.push(paint(g, (x, y, z) => _c1.set('#f2b705').lerp(_c2.set('#ffe34a'), clamp(Math.hypot(x - bend, z) / 0.07, 0, 1))));
      }
      const c = new THREE.SphereGeometry(0.02, 6, 4);
      xf(c, { x: bend, y: H + 0.012 });
      parts.push(paint(c, '#9c7a14'));
      species.buttercup = merge(parts);
    }
    // alpine rose: woody twig, dark oval leaves, clustered pink blossoms
    {
      const H = 0.28, bend = 0.02;
      const parts = [stemGeo(H, 0.02, 0.012, bend, '#5a3d2a', '#6e5a34')];
      for (let i = 0; i < 6; i++) parts.push(leafGeo(0.09, 0.04, -0.2, i * 1.05, 0.06 + i * 0.03, '#1f5a2c', '#3f8a45'));
      for (let b = 0; b < 4; b++) {
        const ox = Math.cos(b * 1.57 + 0.4) * 0.05, oz = Math.sin(b * 1.57 + 0.4) * 0.05, oy = H + (b % 2) * 0.03;
        for (let i = 0; i < 5; i++) {
          const g = petalGeo(0.05, 0.034, 0.5, 2, 0.5, 0.0, 0.5);
          xf(g, { ry: (i / 5) * Math.PI * 2 + b, rz: 0.45 });
          xf(g, { x: bend + ox, y: oy, z: oz });
          parts.push(paint(g, (x, y, z) => _c1.set('#d9306e').lerp(_c2.set('#ff8cb4'), clamp(Math.hypot(x - bend - ox, z - oz) / 0.05, 0, 1))));
        }
        const c = new THREE.IcosahedronGeometry(0.012, 0);
        xf(c, { x: bend + ox, y: oy + 0.01, z: oz });
        parts.push(paint(c, '#ffe6a0'));
      }
      species.rose = merge(parts);
    }
    // edelweiss: woolly white star with downy leaves
    {
      const H = 0.16, bend = 0.01;
      const parts = [stemGeo(H, 0.011, 0.008, bend, '#8fa088', '#b6c2a8')];
      for (let i = 0; i < 3; i++) parts.push(leafGeo(0.08, 0.02, -0.1, i * 2.1, 0.03 + i * 0.02, '#8aa27c', '#c4d0b6'));
      for (let layer = 0; layer < 2; layer++) {
        const n = 8;
        for (let i = 0; i < n; i++) {
          const g = petalGeo(0.105 - layer * 0.03, 0.026, 0.12, 2, 0, 0.012, 0.9);
          xf(g, { ry: ((i + layer * 0.5) / n) * Math.PI * 2, y: layer * 0.006, rz: 0.2 + layer * 0.15 });
          xf(g, { x: bend, y: H });
          parts.push(paint(g, (x, y, z) => _c1.set('#d9dcc8').lerp(_c2.set('#f6f6ea'), clamp(Math.hypot(x - bend, z) / 0.1, 0, 1))));
        }
      }
      for (let i = 0; i < 3; i++) {
        const c = new THREE.IcosahedronGeometry(0.014, 0);
        xf(c, { x: bend + Math.cos(i * 2.1) * 0.014, y: H + 0.012, z: Math.sin(i * 2.1) * 0.014 });
        parts.push(paint(c, '#e8c63c'));
      }
      species.edel = merge(parts);
    }

    const tints = {
      daisy: ['#ffffff', '#fff2f6', '#fffbe8'],
      gentian: ['#ffffff', '#e6d8ff', '#cfe0ff'],
      buttercup: ['#ffffff', '#fff0b0', '#ffd7a0'],
      rose: ['#ffffff', '#ffd0e0', '#ffe8f0'],
      edel: ['#ffffff', '#f4f4ea'],
    };
    const meshes = {};
    for (const key of Object.keys(species)) {
      const mat = patchWorld(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, { sway: 0.2, bob: 0.3 });
      const m = new THREE.InstancedMesh(species[key], mat, S5[key]);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.count = 0;
      meshes[key] = m;
      scene.add(m);
    }
    // drifts per species
    const drifts = [];
    const dn = lp ? 22 : 36;
    for (let i = 0; i < dn; i++) {
      const near = i < dn * 0.45;
      const sp = pick(['daisy', 'buttercup', 'buttercup', 'gentian', 'daisy', 'rose', 'edel']);
      drifts.push({
        sp,
        x: near ? R(-14, 14) : R(-36, 36),
        z: near ? R(-9, 12) : R(-30, -6),
        r: R(2, 5.5),
      });
    }
    const keys = Object.keys(species);
    let guard = 0;
    const total = keys.reduce((s, k) => s + S5[k], 0);
    let placed = 0;
    while (placed < total && guard++ < total * 40) {
      let x, z, sp;
      if (rnd() < 0.82) {
        const p = pick(drifts);
        const a = R(0, 6.28), rr = p.r * Math.sqrt(rnd());
        x = p.x + Math.cos(a) * rr; z = p.z + Math.sin(a) * rr;
        sp = rnd() < 0.78 ? p.sp : pick(keys);
      } else {
        x = R(-36, 36); z = R(-30, 14);
        sp = pick(keys);
      }
      if (meshes[sp].count >= S5[sp]) continue;
      if (inStage(x, z, 0.15)) continue;
      if (lakeE(x, z) < 1.12) continue;
      if (nearBuilding(x, z, -2)) continue;
      if (pathDist(x, z) < 0.8) continue;
      const d = Math.hypot(x, z);
      let s = R(0.9, 1.5);
      // keep tall plants away from the cast and the camera lane
      s *= lerp(0.7, 1, smooth(CLEAR - 2, CLEAR + 8, d));
      if (z > 1.2) s *= 0.7;
      const m = meshes[sp];
      dummy.position.set(x, heightAt(x, z) - 0.015, z);
      dummy.rotation.set(R(-0.12, 0.12), R(0, 6.28), R(-0.12, 0.12));
      dummy.scale.set(s, s * R(0.9, 1.2), s);
      dummy.updateMatrix();
      m.setMatrixAt(m.count, dummy.matrix);
      m.setColorAt(m.count, _c4.set(pick(tints[sp])).multiplyScalar(R(0.9, 1.05)));
      m.count++;
      placed++;
    }
    for (const k of keys) {
      meshes[k].instanceMatrix.needsUpdate = true;
      if (meshes[k].instanceColor) meshes[k].instanceColor.needsUpdate = true;
    }
  }

  // =========================================================================
  // Pines (three silhouettes), broadleaf trees, bushes, mossy boulders
  // =========================================================================
  function buildPine(seed, { H, R0, tiers, droop, trunkTop, hue }) {
    const pr = mulberry32(seed);
    const P = [], N = [], Cc = [];
    const addTri = (a, b, c) => {
      const ux = b.p[0] - a.p[0], uy = b.p[1] - a.p[1], uz = b.p[2] - a.p[2];
      const vx = c.p[0] - a.p[0], vy = c.p[1] - a.p[1], vz = c.p[2] - a.p[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const avg = a.n[0] + b.n[0] + c.n[0], avgy = a.n[1] + b.n[1] + c.n[1], avgz = a.n[2] + b.n[2] + c.n[2];
      const flip = nx * avg + ny * avgy + nz * avgz < 0;
      const order = flip ? [a, c, b] : [a, b, c];
      for (const v of order) { P.push(...v.p); N.push(...v.n); Cc.push(v.c.r, v.c.g, v.c.b); }
    };
    const vtx = (x, y, z, n, c) => {
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return { p: [x, y, z], n: [n[0] / l, n[1] / l, n[2] / l], c: c.clone() };
    };
    const dark = new THREE.Color('#14402b'), mid = new THREE.Color('#2a6a3c'), tipC = new THREE.Color(hue);
    const seg = 10;
    for (let k = 0; k < tiers; k++) {
      const u = k / (tiers - 1);
      const yb = trunkTop * 0.5 + u * (H - trunkTop * 0.5 - 0.7);
      const rad = (R0 * Math.pow(1 - u, 0.85) + 0.14) * (0.9 + pr() * 0.2);
      const hh = ((H - trunkTop * 0.5) / tiers) * 1.9;
      const ph = pr() * 6.28;
      const tierTone = 0.85 + pr() * 0.3;
      const apex = vtx(0, yb + hh, 0, [0, 1, 0], _c1.copy(mid).lerp(tipC, 0.5).multiplyScalar(tierTone));
      const ring = [];
      for (let j = 0; j < seg; j++) {
        const a = ph + (j / seg) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const spike = j % 2 === 0;
        const rr = rad * (spike ? 0.92 + pr() * 0.3 : 0.52 + pr() * 0.2);
        const dy = spike ? -droop * rad * (0.12 + pr() * 0.08) : droop * rad * 0.06;
        const jy = (pr() - 0.5) * 0.1;
        const nTop = [ca * 0.55, 0.8, sa * 0.55];
        ring.push({
          mid: vtx(ca * rad * 0.5, yb + hh * 0.45 + jy, sa * rad * 0.5, nTop, _c2.copy(dark).lerp(mid, 0.8).multiplyScalar(tierTone)),
          rim: vtx(ca * rr, yb + dy + jy, sa * rr, [ca * 0.8, 0.35, sa * 0.8], _c3.copy(mid).lerp(tipC, spike ? 0.85 : 0.35).multiplyScalar(tierTone)),
          rimU: vtx(ca * rr, yb + dy + jy, sa * rr, [0, -1, 0], _c4.copy(dark).multiplyScalar(0.8)),
        });
      }
      const under = vtx(0, yb + 0.04, 0, [0, -1, 0], _c4.copy(dark).multiplyScalar(0.55));
      for (let j = 0; j < seg; j++) {
        const A = ring[j], B = ring[(j + 1) % seg];
        addTri(apex, A.mid, B.mid);
        addTri(A.mid, A.rim, B.rim);
        addTri(A.mid, B.rim, B.mid);
        addTri(under, A.rimU, B.rimU);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    const trunk = new THREE.CylinderGeometry(0.06, 0.2, trunkTop + 1.2, 6);
    trunk.translate(0, (trunkTop + 1.2) / 2 - 0.1, 0);
    paint(trunk, (x, y) => _c1.set('#5c3f2a').lerp(_c2.set('#7a5a3a'), clamp(y / 3, 0, 1)));
    return merge([g, trunk]);
  }

  function buildBroadleaf(seed) {
    const pr = mulberry32(seed);
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.16, 0.3, 2.4, 8, 3);
    trunk.translate(0, 1.2, 0);
    parts.push(paint(trunk, (x, y) => _c1.set('#5b4331').lerp(_c2.set('#7d6448'), clamp(y / 2.4, 0, 1))));
    const greenA = new THREE.Color('#2f7a33'), greenB = new THREE.Color('#78b83c'), greenC = new THREE.Color('#b6d95a');
    const blob = (cx, cy, cz, r, detail) => {
      const g = smoothIco(r, detail);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = 0.82 + 0.36 * vnoise(x * 2.1 + cx * 3, y * 2.1 + z * 1.7 + cy, 5);
        p.setXYZ(i, x * n, y * n * 0.9, z * n);
      }
      g.computeVertexNormals();
      xf(g, { x: cx, y: cy, z: cz });
      paint(g, (x, y, z) => {
        const t = clamp((y - 2.0) / 3.2, 0, 1);
        const ln = vnoise(x * 3, z * 3 + y * 2, 9);
        _c1.copy(greenA).lerp(greenB, t * 0.9 + ln * 0.3).lerp(greenC, smooth(0.65, 1.0, t) * 0.7);
        return _c1;
      });
      parts.push(g);
    };
    const nb = lp ? 3 : 4;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * 6.28 + pr();
      blob(Math.cos(a) * 1.0, 3.3 + pr() * 0.9, Math.sin(a) * 1.0, 1.25 + pr() * 0.3, 2);
    }
    blob(0, 4.4, 0, 1.4, 2);
    for (let i = 0; i < (lp ? 3 : 6); i++) {
      const a = pr() * 6.28, hgt = 2.8 + pr() * 2.2;
      blob(Math.cos(a) * 1.7, hgt, Math.sin(a) * 1.7, 0.6 + pr() * 0.25, 1);
    }
    for (const a of [0.5, 2.4, 4.3]) {
      const br = new THREE.CylinderGeometry(0.05, 0.1, 1.4, 5);
      br.translate(0, 0.7, 0);
      xf(br, { y: 1.6, ry: a, rz: 0.7 });
      parts.push(paint(br, '#5b4331'));
    }
    return merge(parts);
  }

  function buildBush(flowering, seed) {
    const pr = mulberry32(seed);
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const g = smoothIco(0.5 + pr() * 0.25, 1);
      const p = g.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const n = 0.85 + 0.3 * vnoise(p.getX(v) * 3 + i, p.getZ(v) * 3, 2);
        p.setXYZ(v, p.getX(v) * n, p.getY(v) * n * 0.8, p.getZ(v) * n);
      }
      g.computeVertexNormals();
      const a = (i / 4) * 6.28;
      xf(g, { x: Math.cos(a) * 0.4, y: 0.35 + pr() * 0.15, z: Math.sin(a) * 0.4 });
      parts.push(paint(g, (x, y) => _c1.set('#2a6a30').lerp(_c2.set('#6fb040'), clamp(y / 1.0, 0, 1))));
    }
    if (flowering) {
      for (let i = 0; i < 12; i++) {
        const a = pr() * 6.28, el = 0.3 + pr() * 0.9;
        const g = new THREE.IcosahedronGeometry(0.07 + pr() * 0.03, 0);
        xf(g, { x: Math.cos(a) * Math.cos(el) * 0.75, y: 0.3 + Math.sin(el) * 0.55, z: Math.sin(a) * Math.cos(el) * 0.75 });
        parts.push(paint(g, pr() < 0.7 ? '#e8457e' : '#ffb3cf'));
      }
    }
    return merge(parts);
  }

  function buildBoulder(seed) {
    const g = smoothIco(1, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 0.78 + 0.45 * vnoise(x * 1.6 + seed, z * 1.6 + y, 4) + 0.1 * vnoise(x * 5, z * 5 + y * 3, 6);
      p.setXYZ(i, x * n * 1.1, Math.max(y * n * 0.7, -0.25), z * n);
    }
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    return paint(g, (x, y, z, i) => {
      const ny = nrm.getY(i);
      const grey = 0.5 + 0.2 * vnoise(x * 4, z * 4 + y * 2, 1);
      _c1.setRGB(grey * 0.85, grey * 0.8, grey * 0.74);
      const moss = smooth(0.35, 0.8, ny + (vnoise(x * 3, z * 3, 8) - 0.5) * 0.5);
      return _c1.lerp(_c2.set('#4f8a34'), moss * 0.85);
    });
  }

  {
    const pineVariants = [
      buildPine(11, { H: 7.8, R0: 1.5, tiers: lp ? 7 : 9, droop: 1.0, trunkTop: 1.2, hue: '#4a9a4e' }),
      buildPine(23, { H: 6.2, R0: 1.95, tiers: lp ? 6 : 8, droop: 1.4, trunkTop: 1.0, hue: '#5ba04c' }),
      buildPine(37, { H: 4.2, R0: 1.15, tiers: lp ? 5 : 6, droop: 1.1, trunkTop: 0.7, hue: '#58a652' }),
    ];
    const lists = [[], [], [], []];
    for (const t of trees) lists[t.kind].push(t);
    const geos = [...pineVariants, buildBroadleaf(5)];
    geos.forEach((geo, kind) => {
      const arr = lists[kind];
      if (!arr.length) return;
      const mat = patchWorld(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, {
        sway: kind === 3 ? 0.004 : 0.0022,
        bob: kind === 3 ? 0.02 : 0.045,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, arr.length);
      mesh.frustumCulled = false;
      arr.forEach((t, i) => {
        dummy.position.set(t.x, heightAt(t.x, t.z) - 0.15, t.z);
        dummy.rotation.set(0, R(0, 6.28), 0);
        dummy.scale.set(t.s * R(0.9, 1.1), t.s * R(0.9, 1.25), t.s * R(0.9, 1.1));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, kind === 3 ? _c4.setRGB(R(0.85, 1.15), R(0.9, 1.1), R(0.7, 1.0)) : _c4.setRGB(R(0.8, 1.1), R(0.85, 1.15), R(0.8, 1.05)));
      });
      scene.add(mesh);
    });

    for (const flowering of [false, true]) {
      const arr = bushes.filter((b) => b.flowering === flowering);
      if (!arr.length) continue;
      const mesh = new THREE.InstancedMesh(
        buildBush(flowering, flowering ? 4 : 3),
        patchWorld(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, { sway: 0.02, bob: 0.05 }),
        arr.length
      );
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      arr.forEach((b, i) => {
        dummy.position.set(b.x, heightAt(b.x, b.z) - 0.05, b.z);
        dummy.rotation.set(0, R(0, 6.28), 0);
        dummy.scale.set(b.s * R(0.9, 1.2), b.s * R(0.8, 1.1), b.s * R(0.9, 1.2));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, _c4.setRGB(R(0.85, 1.1), R(0.9, 1.1), R(0.8, 1.0)));
      });
      scene.add(mesh);
    }

    if (boulders.length) {
      const mesh = new THREE.InstancedMesh(
        buildBoulder(3),
        patchWorld(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, {}),
        boulders.length
      );
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      boulders.forEach((b, i) => {
        dummy.position.set(b.x, heightAt(b.x, b.z) - 0.1 * b.s, b.z);
        dummy.rotation.set(R(-0.15, 0.15), R(0, 6.28), R(-0.15, 0.15));
        dummy.scale.set(b.s * R(0.9, 1.3), b.s * R(0.7, 1.1), b.s * R(0.9, 1.3));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, _c4.setRGB(R(0.85, 1.1), R(0.85, 1.1), R(0.85, 1.1)));
      });
      scene.add(mesh);
    }
  }

  // =========================================================================
  // Lake: fresnel sky tint, ripples, sun glints, soft shoreline
  // =========================================================================
  const lakeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: shared.uTime,
        cDeep: { value: new THREE.Color('#1b6f9e') },
        cShallow: { value: new THREE.Color('#58c0c0') },
        cZenith: skyUniforms.cZenith,
        cUpper: skyUniforms.cUpper,
        cMid: skyUniforms.cMid,
        cLow: skyUniforms.cLow,
        cHorizon: skyUniforms.cHorizon,
        cGlow: skyUniforms.cGlow,
        sunDir: skyUniforms.sunDir,
      },
    ]),
    vertexShader: `
      varying vec3 vW;
      varying vec2 vL;
      #include <fog_pars_vertex>
      void main() {
        vL = position.xz;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 cDeep; uniform vec3 cShallow;
      ${SKY_FUNCS}
      varying vec3 vW; varying vec2 vL;
      #include <fog_pars_fragment>
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        vec2 p = vW.xz;
        float t = uTime;
        float nx = sin(p.x * 0.9 + t * 1.1 + sin(p.y * 0.3)) * 0.035 + sin(p.x * 0.31 - p.y * 0.47 + t * 0.7) * 0.05 + sin(p.x * 2.3 + p.y * 1.7 - t * 1.9) * 0.018;
        float nz = sin(p.y * 1.1 - t * 0.9 + sin(p.x * 0.4)) * 0.035 + sin(p.y * 0.37 + p.x * 0.41 - t * 0.6) * 0.05 + sin(p.y * 2.1 - p.x * 1.9 + t * 1.6) * 0.018;
        vec3 N = normalize(vec3(nx, 1.0, nz));
        float r = length(vL);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.03 + 0.97 * pow(1.0 - ndv, 4.0);
        vec3 Rf = reflect(-V, N);
        Rf.y = abs(Rf.y);
        vec3 refl = skyGrad(normalize(Rf));
        float sunG = pow(max(dot(Rf, sunDir), 0.0), 900.0) * 3.0 + pow(max(dot(Rf, sunDir), 0.0), 60.0) * 0.25;
        vec3 body = mix(cShallow, cDeep, smoothstep(0.98, 0.45, r));
        body *= 0.9 + 0.1 * sin(p.x * 0.5 + p.y * 0.3 + t * 0.2);
        vec3 col = mix(body, refl, clamp(fres * 0.78, 0.0, 1.0));
        col += cGlow * sunG;
        float foam = smoothstep(0.83, 0.9, r) * (1.0 - smoothstep(0.9, 0.97, r)) * (0.5 + 0.5 * sin(r * 70.0 - t * 1.3 + p.x * 0.4));
        col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.35);
        float alpha = 1.0 - smoothstep(0.88, 1.0, r);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  {
    const g = new THREE.CircleGeometry(1, 72);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, lakeMat);
    m.scale.set(LAKE.ax * 1.08, 1, LAKE.az * 1.08);
    m.position.set(LAKE.x, LAKE.y, LAKE.z);
    m.frustumCulled = false;
    m.renderOrder = 2;
    scene.add(m);
  }

  // =========================================================================
  // Static buildings: chapel, graveyard wall, chalets, fences, jetty
  // =========================================================================
  {
    const S = [];
    let cur = [];
    const begin = () => { cur = []; };
    const end = (x, y, z, ry, s = 1) => {
      _M4.compose(_V.set(x, y, z), _Q.setFromEuler(_E.set(0, ry, 0)), _S.set(s, s, s));
      for (const g of cur) { g.applyMatrix4(_M4); S.push(g); }
      cur = [];
    };
    const add = (g, c) => {
      if (c !== undefined) paint(g, c);
      if (!g.attributes.normal) g.computeVertexNormals();
      cur.push(g);
      return g;
    };
    const jit = (hex, a = 0.06) => new THREE.Color(hex).multiplyScalar(1 + (rnd() - 0.5) * 2 * a);
    const box = (w, h, d, x, y, z, color, o = {}) => add(xf(new THREE.BoxGeometry(w, h, d), { x, y, z, ...o }), color);
    const archShape = (w, h, seg = 10) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h);
      s.absarc(0, h, w / 2, 0, Math.PI, false);
      s.lineTo(-w / 2, 0);
      return new THREE.ShapeGeometry(s, seg);
    };
    const arch = (w, h, x, y, z, ry, color) => add(xf(archShape(w, h), { x, y, z, ry }), color);

    // shingled gable roof, ridge along z
    const gableRoof = (halfW, rise, y0, zA, zB, over, rows, cols, colA, colB, lip = 0.035) => {
      for (const side of [-1, 1]) {
        const slope = Math.hypot(halfW + over, rise * (halfW + over) / halfW);
        void slope;
        const ex = side * (halfW + over), ey = y0 - over * (rise / halfW);
        const rx = 0, ry = y0 + rise;
        const nx = side * rise / Math.hypot(halfW, rise), ny = halfW / Math.hypot(halfW, rise);
        const tris = [];
        const cA = new THREE.Color(colA), cB = new THREE.Color(colB);
        const colors = [];
        for (let r = 0; r < rows; r++) {
          const t0 = r / rows, t1 = (r + 1) / rows;
          const p0 = [lerp(ex, rx, t0), lerp(ey, ry, t0)], p1 = [lerp(ex, rx, t1), lerp(ey, ry, t1)];
          for (let c = 0; c < cols; c++) {
            const z0 = lerp(zA, zB, c / cols), z1 = lerp(zA, zB, (c + 1) / cols) - 0.01;
            const q = [
              [p0[0] + nx * lip, p0[1] + ny * lip, z0], [p0[0] + nx * lip, p0[1] + ny * lip, z1],
              [p1[0], p1[1], z1], [p1[0], p1[1], z0],
            ];
            tris.push(q[0], q[1], q[2], q[0], q[2], q[3]);
            const tone = 0.8 + rnd() * 0.4;
            const base = _c1.copy(cA).lerp(cB, rnd()).multiplyScalar(tone);
            colors.push([base.r * 0.78, base.g * 0.78, base.b * 0.78, base.r * 1.08, base.g * 1.08, base.b * 1.08]);
          }
        }
        const p = new Float32Array(tris.length * 3);
        tris.forEach((v, i) => { p[i * 3] = v[0]; p[i * 3 + 1] = v[1]; p[i * 3 + 2] = v[2]; });
        const col = new Float32Array(tris.length * 3);
        colors.forEach((c, qi) => {
          // quad vertex order q0,q1,q2,q0,q2,q3 : bottom,bottom,top,bottom,top,top
          const bo = [c[3], c[4], c[5]], to = [c[0], c[1], c[2]];
          const seq = [bo, bo, to, bo, to, to];
          seq.forEach((cc, k) => { col.set(cc, (qi * 6 + k) * 3); });
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.computeVertexNormals();
        cur.push(g);
      }
      // ridge cap + barge boards
      box(0.16, 0.08, zB - zA + 0.1, 0, y0 + rise + 0.03, (zA + zB) / 2, colB);
    };

    // ---------------- chapel ----------------
    {
      begin();
      const white = '#f6ecd8', stone = '#a49d90', wood = '#6a4426';
      box(3.7, 0.4, 5.0, 0, 0.2, -0.1, stone);
      add(xf(new THREE.BoxGeometry(3.0, 2.3, 4.4), { y: 1.5, z: -0.1 }), (x, y) => _c1.set(white).lerp(_c2.set('#d6c8a6'), smooth(1.2, 0.4, y)));
      box(3.1, 0.5, 4.5, 0, 0.65, -0.1, '#cbbf9f');
      // apse
      const ap = new THREE.CylinderGeometry(1.5, 1.5, 2.3, 14, 1, true, Math.PI / 2, Math.PI);
      add(xf(ap, { y: 1.5, z: -2.3 }), (x, y) => _c1.set(white).lerp(_c2.set('#d6c8a6'), smooth(1.2, 0.4, y)));
      const apBase = new THREE.CylinderGeometry(1.58, 1.62, 0.5, 14, 1, true, Math.PI / 2, Math.PI);
      add(xf(apBase, { y: 0.65, z: -2.3 }), '#cbbf9f');
      const apRoof = new THREE.ConeGeometry(1.8, 1.45, 14, 4, true, Math.PI / 2, Math.PI);
      add(xf(apRoof, { y: 2.65 + 0.725 - 0.02, z: -2.3 }), (x, y) => _c1.set('#8b3d2b').lerp(_c2.set('#b5624a'), clamp((y - 2.65) / 1.5, 0, 1)));
      gableRoof(1.5, 1.45, 2.65, -2.3, 2.5, 0.3, 11, 16, '#8f3d2a', '#b86448');
      // front gable triangle
      {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([-1.5, 2.65, 2.12, 1.5, 2.65, 2.12, 0, 4.1, 2.12], 3));
        add(g, white);
      }
      // tower
      add(xf(new THREE.BoxGeometry(1.7, 4.4, 1.7), { y: 2.55, z: 2.6 }), (x, y) => _c1.set(white).lerp(_c2.set('#d6c8a6'), smooth(1.2, 0.4, y)));
      box(1.85, 0.12, 1.85, 0, 1.6, 2.6, '#cbbf9f');
      box(1.95, 0.18, 1.95, 0, 4.82, 2.6, '#b79a78');
      box(1.82, 0.1, 1.82, 0, 4.7, 2.6, '#e9dcc0');
      for (const [dx, dz, ry] of [[0, 0.86, 0], [0, -0.86, Math.PI], [0.86, 0, Math.PI / 2], [-0.86, 0, -Math.PI / 2]]) {
        arch(0.66, 0.6, dx * 1.01, 3.85, 2.6 + dz * 1.01, ry, '#d8c9a8');
        arch(0.5, 0.52, dx * 1.02, 3.88, 2.6 + dz * 1.02, ry, '#2f2540');
        // louvre slats
        for (let i = 0; i < 3; i++) add(xf(new THREE.BoxGeometry(0.46, 0.03, 0.03), { x: dx * 1.03 + (ry ? 0 : 0), y: 3.95 + i * 0.16, z: 2.6 + dz * 1.03, ry }), '#6b5a74');
      }
      // clock
      add(xf(new THREE.CircleGeometry(0.36, 20), { y: 2.95, z: 2.6 + 0.86 }), '#8a6a3a');
      add(xf(new THREE.CircleGeometry(0.31, 20), { y: 2.95, z: 2.6 + 0.865 }), '#fbf3df');
      box(0.03, 0.22, 0.01, 0, 3.03, 3.47, '#2b2623');
      box(0.15, 0.03, 0.01, 0.06, 2.95, 3.47, '#2b2623');
      // door + steps
      arch(1.0, 1.35, 0, 0.4, 3.465, 0, '#cdbf9f');
      arch(0.78, 1.28, 0, 0.4, 3.472, 0, wood);
      box(0.04, 1.5, 0.01, 0, 0.4 + 0.65, 3.476, '#3f2a17');
      box(1.5, 0.12, 0.6, 0, 0.34, 3.75, '#9b948a');
      box(1.2, 0.12, 0.4, 0, 0.22, 3.95, '#8d867c');
      // drum + onion dome (smooth lathe)
      add(xf(new THREE.CylinderGeometry(0.76, 0.86, 0.6, 8), { y: 5.2, z: 2.6 }), '#efe3c8');
      const prof = new THREE.SplineCurve(
        [[0.84, 0], [1.05, 0.1], [1.12, 0.38], [0.98, 0.72], [0.66, 1.02], [0.34, 1.3], [0.15, 1.58], [0.07, 1.9], [0.01, 2.15]].map(([r, y]) => new THREE.Vector2(r, y))
      ).getPoints(26);
      const dome = new THREE.LatheGeometry(prof, 28);
      dome.computeVertexNormals();
      add(xf(dome, { y: 5.5, z: 2.6 }), (x, y) => _c1.set('#2f7a66').lerp(_c2.set('#58b79a'), clamp((y - 5.5) / 2.1, 0, 1)));
      // gilded bands
      add(xf(new THREE.TorusGeometry(1.08, 0.03, 5, 28), { y: 5.5 + 0.55, z: 2.6, rx: Math.PI / 2 }), '#e6bf4a');
      add(xf(new THREE.SphereGeometry(0.1, 8, 6), { y: 7.7, z: 2.6 }), '#eac44e');
      box(0.05, 0.55, 0.05, 0, 8.05, 2.6, '#eac44e');
      box(0.3, 0.05, 0.05, 0, 8.15, 2.6, '#eac44e');
      // nave windows
      for (const side of [-1, 1]) {
        for (const z of [-1.7, -0.45, 0.8]) {
          arch(0.72, 1.0, side * 1.505, 0.95, z, side * Math.PI / 2, '#d9ccaa');
          arch(0.5, 0.86, side * 1.512, 1.0, z, side * Math.PI / 2, (x, y) => _c1.set('#2d3f66').lerp(_c2.set('#7f9fd0'), smooth(1.0, 1.9, y)));
          box(0.12, 0.08, 0.7, side * 1.55, 0.92, z, '#9d968a');
        }
        box(0.4, 1.7, 0.4, side * 1.62, 0.9, -2.0, '#b9ae96', { rz: 0 });
        box(0.4, 1.7, 0.4, side * 1.62, 0.9, 1.9, '#b9ae96');
      }
      arch(0.5, 0.9, 0, 1.0, -3.82, Math.PI, '#33466e');
      end(CHAPEL_HILL.x, heightAt(CHAPEL_HILL.x, CHAPEL_HILL.z) - 0.1, CHAPEL_HILL.z, 0.35, 1.5);
    }

    // graveyard wall + crosses (world coordinates, follows the hill)
    {
      begin();
      const cx = CHAPEL_HILL.x, cz = CHAPEL_HILL.z;
      const half = [7.2, 8.6];
      const ang = 0.35;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const toW = (lx, lz) => [cx + lx * ca + lz * sa, cz - lx * sa + lz * ca];
      const ring = [];
      const addSide = (x0, z0, x1, z1) => {
        const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.7);
        for (let i = 0; i < n; i++) ring.push([lerp(x0, x1, i / n), lerp(z0, z1, i / n), lerp(x0, x1, (i + 1) / n), lerp(z0, z1, (i + 1) / n)]);
      };
      const gate = (lx, lz) => lz > half[1] - 0.2 && Math.abs(lx) < 1.3;
      addSide(-half[0], -half[1] + 1.5, half[0], -half[1] + 1.5);
      addSide(half[0], -half[1] + 1.5, half[0], half[1]);
      addSide(half[0], half[1], -half[0], half[1]);
      addSide(-half[0], half[1], -half[0], -half[1] + 1.5);
      for (const [x0, z0, x1, z1] of ring) {
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (gate(mx, mz)) continue;
        const [wx, wz] = toW(mx, mz);
        const len = Math.hypot(x1 - x0, z1 - z0);
        const yaw = Math.atan2(x1 - x0, z1 - z0) + ang;
        const gy = heightAt(wx, wz);
        add(xf(new THREE.BoxGeometry(0.34, 0.75 + (rnd() - 0.5) * 0.1, len * 1.04), { x: wx, y: gy + 0.3, z: wz, ry: yaw }), jit('#9b9486', 0.1));
        add(xf(new THREE.BoxGeometry(0.44, 0.1, len * 1.06), { x: wx, y: gy + 0.72, z: wz, ry: yaw }), jit('#b4ad9f', 0.05));
      }
      // gate posts
      for (const gx of [-1.35, 1.35]) {
        const [wx, wz] = toW(gx, half[1]);
        add(xf(new THREE.BoxGeometry(0.4, 1.2, 0.4), { x: wx, y: heightAt(wx, wz) + 0.5, z: wz, ry: ang }), '#a79f90');
      }
      // wooden crosses and a few stones
      for (let i = 0; i < 9; i++) {
        const lx = R(-5.5, 5.5), lz = R(-1, 5.5);
        if (Math.abs(lx) < 2.0 && lz < 4.4) continue;
        const [wx, wz] = toW(lx, lz);
        const gy = heightAt(wx, wz);
        add(xf(new THREE.BoxGeometry(0.06, 0.6, 0.06), { x: wx, y: gy + 0.3, z: wz, ry: ang }), '#4a3320');
        add(xf(new THREE.BoxGeometry(0.34, 0.06, 0.06), { x: wx, y: gy + 0.46, z: wz, ry: ang }), '#4a3320');
      }
      end(0, 0, 0, 0);
    }

    // ---------------- chalets ----------------
    const buildChalet = (c) => {
      begin();
      const W = 5.6, D = 4.6;
      box(W + 0.3, 2.0, D + 0.3, 0, -0.1, 0, '#8d887c');
      add(xf(new THREE.BoxGeometry(W, 2.0, D), { y: 1.9 }), (x, y) => _c1.set('#f1e8d4').lerp(_c2.set('#cdbf9f'), smooth(1.4, 0.9, y)));
      // upper floor: timber with vertical plank strips on every face
      const uy = 3.85;
      add(xf(new THREE.BoxGeometry(W + 0.3, 1.9, D + 0.3), { y: uy }), '#7b4f2c');
      const strips = 17;
      for (const [fw, nz, ry] of [[W + 0.3, D / 2 + 0.17, 0], [W + 0.3, -(D / 2 + 0.17), Math.PI]]) {
        for (let i = 0; i < strips; i++) {
          const sx = -fw / 2 + (i + 0.5) * (fw / strips);
          add(xf(new THREE.BoxGeometry(fw / strips * 0.82, 1.9, 0.05), { x: sx * Math.cos(ry), y: uy, z: nz }), jit(i % 2 ? '#9a6a3d' : '#82532e', 0.08));
        }
      }
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < 12; i++) {
          const sz = -D / 2 + 0.1 + (i + 0.5) * ((D - 0.2) / 12);
          add(xf(new THREE.BoxGeometry(0.05, 1.9, (D - 0.2) / 12 * 0.82), { x: sgn * (W / 2 + 0.17), y: uy, z: sz }), jit(i % 2 ? '#9a6a3d' : '#82532e', 0.08));
        }
      }
      box(W + 0.45, 0.12, D + 0.45, 0, 2.86, 0, '#5a3a20');
      // roof (ridge along z, gable towards the viewer)
      gableRoof((W + 0.3) / 2, 1.55, 4.8, -D / 2 - 1.0, D / 2 + 1.1, 1.0, 9, 14, '#6d5b4c', '#8c7866');
      // front gable board wall
      {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([-(W + 0.3) / 2, 4.8, D / 2 + 0.16, (W + 0.3) / 2, 4.8, D / 2 + 0.16, 0, 6.35, D / 2 + 0.16], 3));
        add(g, '#8b5a32');
      }
      add(xf(new THREE.CircleGeometry(0.28, 12), { y: 5.35, z: D / 2 + 0.2 }), '#3a2616');
      // balcony
      box(W - 0.4, 0.1, 1.1, 0, 3.0, D / 2 + 0.7, '#6b4426');
      for (let i = 0; i <= 14; i++) {
        const bx = -(W - 0.5) / 2 + (i / 14) * (W - 0.5);
        box(0.05, 0.78, 0.05, bx, 3.42, D / 2 + 1.22, i % 2 ? '#c9a06a' : '#b88a55');
      }
      box(W - 0.4, 0.07, 0.09, 0, 3.82, D / 2 + 1.22, '#6b4426');
      box(W - 0.4, 0.05, 0.07, 0, 3.12, D / 2 + 1.22, '#6b4426');
      for (const sx of [-1, 1]) box(0.1, 0.9, 0.1, sx * (W - 0.5) / 2, 3.4, D / 2 + 1.22, '#5a3a20');
      for (const sx of [-1, 1]) box(0.08, 0.7, 0.9, sx * (W - 0.5) / 2, 3.4, D / 2 + 0.75, '#6b4426');
      // flower boxes (rail-mounted) + hanging geranium blobs
      const blossoms = ['#e63946', '#ff5d8f', '#ffffff', '#ff8a3d'];
      const flowerBox = (x, y, z, w) => {
        box(w, 0.2, 0.26, x, y, z, '#5a3a20');
        box(w * 0.98, 0.1, 0.22, x, y + 0.13, z, '#2e6a2a');
        for (let i = 0; i < Math.round(w / 0.16); i++) {
          const g = new THREE.IcosahedronGeometry(0.075 + rnd() * 0.03, 0);
          add(xf(g, { x: x - w / 2 + 0.1 + i * 0.16, y: y + 0.24 + rnd() * 0.05, z: z + (rnd() - 0.5) * 0.08 }), pick(blossoms));
        }
      };
      flowerBox(0, 3.45, D / 2 + 1.38, W - 0.7);
      // windows with shutters
      const win = (x, y, z, ry, shut) => {
        const sn = Math.sin(ry), cs = Math.cos(ry);
        const P = (lx, ly, lz) => [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
        const put = (g, lx, ly, lz) => { const p = P(lx, ly, lz); return add(xf(g, { x: p[0], y: p[1], z: p[2], ry }), undefined); };
        put(paint(new THREE.BoxGeometry(0.86, 1.06, 0.08), '#f6efe0'), 0, 0, 0);
        put(paint(new THREE.BoxGeometry(0.66, 0.86, 0.1), (px, py) => _c1.set('#2c3d5c').lerp(_c2.set('#6f90c0'), clamp((py - y) / 0.9 + 0.5, 0, 1))), 0, 0, 0.01);
        put(paint(new THREE.BoxGeometry(0.05, 0.86, 0.11), '#f6efe0'), 0, 0, 0.012);
        put(paint(new THREE.BoxGeometry(0.66, 0.05, 0.11), '#f6efe0'), 0, 0.05, 0.012);
        put(paint(new THREE.BoxGeometry(0.4, 1.0, 0.05), shut), -0.64, 0, 0.0);
        put(paint(new THREE.BoxGeometry(0.4, 1.0, 0.05), shut), 0.64, 0, 0.0);
      };
      const shutC = pick(['#b23a30', '#3d6e44', '#2f5f8f']);
      win(-1.7, 1.95, D / 2 + 0.06, 0, shutC);
      win(1.7, 1.95, D / 2 + 0.06, 0, shutC);
      flowerBox(-1.7, 1.28, D / 2 + 0.22, 1.0);
      flowerBox(1.7, 1.28, D / 2 + 0.22, 1.0);
      win(-W / 2 - 0.07, 1.95, 0.4, Math.PI / 2, shutC);
      win(W / 2 + 0.07, 1.95, 0.4, -Math.PI / 2, shutC);
      win(-W / 2 - 0.19, 3.85, -0.2, Math.PI / 2, shutC);
      win(W / 2 + 0.19, 3.85, -0.2, -Math.PI / 2, shutC);
      // door
      box(1.0, 1.7, 0.1, 0, 1.15, D / 2 + 0.05, '#6d4326');
      box(1.2, 0.12, 0.15, 0, 2.05, D / 2 + 0.06, '#f6efe0');
      box(0.04, 1.6, 0.11, 0, 1.15, D / 2 + 0.06, '#4a2c16');
      box(1.4, 0.15, 0.6, 0, 0.4, D / 2 + 0.4, '#8d867c');
      // chimney
      box(0.55, 1.6, 0.55, 1.4, 5.6, -0.8, '#a79a8c');
      box(0.7, 0.1, 0.7, 1.4, 6.45, -0.8, '#6c6258');
      // stacked firewood
      for (let i = 0; i < 6; i++) add(xf(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), { x: -W / 2 - 0.5, y: 0.25 + (i > 2 ? 0.17 : 0), z: -1.0 + (i % 3) * 0.2 - (i > 2 ? 0.1 : 0) - 0.4, rx: Math.PI / 2 }), '#a6794a');
      end(c.x, heightAt(c.x, c.z) + 0.55, c.z, c.ry, c.s);
    };
    for (const c of CHALETS) buildChalet(c);

    // ---------------- fences along the path ----------------
    {
      begin();
      const run = (pts, spacing = 1.7) => {
        const cv = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
        const len = cv.getLength();
        const n = Math.max(2, Math.round(len / spacing));
        const ps = [];
        for (let i = 0; i <= n; i++) {
          const p = cv.getPoint(i / n);
          ps.push([p.x, heightAt(p.x, p.z), p.z]);
        }
        ps.forEach((p, i) => {
          add(xf(new THREE.BoxGeometry(0.11, 1.0, 0.11), { x: p[0], y: p[1] + 0.42, z: p[2], ry: i * 0.7 }), jit('#8b6a45', 0.1));
          add(xf(new THREE.BoxGeometry(0.13, 0.05, 0.13), { x: p[0], y: p[1] + 0.94, z: p[2], ry: i * 0.7 }), '#6e5233');
          if (i === 0) return;
          const q = ps[i - 1];
          const dx = p[0] - q[0], dz = p[2] - q[2], dy = p[1] - q[1];
          const L = Math.hypot(dx, dz);
          const yaw = Math.atan2(dx, dz) - Math.PI / 2;
          const tilt = Math.atan2(dy, L);
          for (const ry of [0.4, 0.78]) {
            add(xf(new THREE.BoxGeometry(L + 0.05, 0.07, 0.045), { x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 + ry, z: (p[2] + q[2]) / 2, ry: yaw, rz: tilt }), jit('#a07a4c', 0.08));
          }
        });
      };
      run([[9, -3.5], [14, -5.5], [20, -9], [26, -12]]);
      run([[-9, -9], [-14, -12], [-20, -16], [-24, -18]]);
      run([[8, -16], [4, -22], [-1, -28]]);
      end(0, 0, 0, 0);
    }

    // ---------------- jetty ----------------
    {
      begin();
      const jx = 3.4, z0 = -35.6;
      for (let i = 0; i < 16; i++) {
        box(1.3, 0.06, 0.26, jx, LAKE.y + 0.36, z0 - i * 0.3, jit(i % 2 ? '#9a7248' : '#86603a', 0.08), { ry: (rnd() - 0.5) * 0.04 });
      }
      for (const sx of [-1, 1]) {
        box(0.1, 0.12, 4.9, jx + sx * 0.5, LAKE.y + 0.27, z0 - 2.3, '#5e4128');
        for (let i = 0; i < 4; i++) {
          add(xf(new THREE.CylinderGeometry(0.07, 0.08, 1.2, 6), { x: jx + sx * 0.6, y: LAKE.y - 0.1 + 0.4, z: z0 - 0.3 - i * 1.4 }), '#4e3822');
        }
      }
      end(0, 0, 0, 0);
    }

    const mesh = new THREE.Mesh(
      merge(S),
      patchWorld(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, {})
    );
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // =========================================================================
  // Alps: displaced ridged meshes, smooth normals, slope-aware snow
  // =========================================================================
  {
    const layers = [
      { z: -132, snow: 0.4, hmax: 40, seed: 11, haze: 0.06, rock: '#85807c', forced: [[-26, 40, 70], [34, 34, 80], [88, 30, 60]] },
      { z: -182, snow: 0.5, hmax: 66, seed: 23, haze: 0.16, rock: '#8d8b90', forced: [[-6, 66, 105], [-78, 50, 90], [70, 54, 100], [140, 44, 80]] },
      { z: -240, snow: 0.52, hmax: 90, seed: 37, haze: 0.32, rock: '#9a9aa6', forced: [[26, 90, 130], [-60, 74, 120], [110, 62, 110], [-150, 62, 100]] },
      { z: -300, snow: 0.52, hmax: 80, seed: 51, haze: 0.48, rock: '#a8aab8', forced: [[-20, 70, 140], [90, 80, 130], [-120, 64, 120], [180, 60, 120]] },
    ];
    const snowC = new THREE.Color('#fbfdff');
    const snowShade = new THREE.Color('#d4e2f2');
    const forestC = new THREE.Color('#2f5e3c');
    const forestL = new THREE.Color('#4f8548');
    const meadowC = new THREE.Color('#79a251');
    const alpineC = new THREE.Color('#a0a468');
    const screeC = new THREE.Color('#9a8e80');
    const hazeC = hazeColor;
    for (const L of layers) {
      const r = mulberry32(L.seed);
      const peaks = L.forced.map(([x, h, rad]) => ({ x, z: L.z - 20 + (r() - 0.5) * 20, h, rad }));
      for (let x = -420; x < 420; x += 38 + r() * 42) {
        const h = L.hmax * (0.35 + 0.55 * r());
        peaks.push({ x, z: L.z - 20 + (r() - 0.5) * 36, h, rad: h * (1.5 + 0.6 * r()) + 30 });
      }
      const W = 900, D = 130;
      const fine = L.z > -200 ? 1 : 1.5;
      const sxs = (lp ? 4.0 : 2.8) * fine, szs = (lp ? 5.5 : 4.2) * fine;
      const nx = Math.round(W / sxs), nz = Math.round(D / szs);
      const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
      const hOf = (x, z) => {
        const wx = x + (fbm(x * 0.012, z * 0.012, 3, L.seed) - 0.5) * 60;
        const wz = z + (fbm(x * 0.012 + 5, z * 0.012, 3, L.seed + 3) - 0.5) * 60;
        let acc = 0;
        for (const p of peaks) {
          const d = Math.hypot(wx - p.x, (wz - p.z) * 1.25) / p.rad;
          if (d < 1) acc += Math.pow(p.h * Math.pow(1 - d, 1.12), 3);
        }
        const env = Math.cbrt(acc);
        const rg = ridged(wx * 0.026, wz * 0.034, 5, L.seed);
        const detail = fbm(x * 0.09, z * 0.09, 3, L.seed + 9);
        const base = L.hmax * 0.07 * fbm(x * 0.02, z * 0.02, 3, L.seed + 1);
        const edge = smooth(-D / 2, -D / 2 + 24, z - L.z) * (1 - smooth(D / 2 - 40, D / 2, z - L.z));
        return (env * (0.18 + 1.25 * rg + 0.1 * detail) + base) * (0.15 + 0.85 * edge) + (edge < 1 ? 0 : 0);
      };
      for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
          const x = -W / 2 + (i / nx) * W;
          const z = L.z - D / 2 + (j / nz) * D;
          const idx = j * (nx + 1) + i;
          pos[idx * 3] = x; pos[idx * 3 + 1] = hOf(x, z); pos[idx * 3 + 2] = z;
        }
      }
      const index = [];
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
          index.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(index);
      g.computeVertexNormals();
      const nrm = g.attributes.normal;
      const col = new Float32Array((nx + 1) * (nz + 1) * 3);
      const rockC = new THREE.Color(L.rock);
      const rockWarm = new THREE.Color('#9b8878');
      for (let k = 0; k < (nx + 1) * (nz + 1); k++) {
        const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
        const ny = nrm.getY(k);
        const nxv = nrm.getX(k);
        const t = y / L.hmax;
        const jn = fbm(x * 0.05, z * 0.05, 3, L.seed + 20);
        const fine = vnoise(x * 0.4, z * 0.4, L.seed);
        // forest line, alpine meadow, scree / rock, then snow that respects slope
        _c1.copy(forestC).lerp(forestL, clamp(fine * 1.4 + (jn - 0.5), 0, 1) * 0.7);
        _c1.lerp(meadowC, smooth(0.2, 0.28, t + (jn - 0.5) * 0.1) * 0.8);
        _c1.lerp(alpineC, smooth(0.3, 0.38, t + (jn - 0.5) * 0.12) * 0.6);
        const strata = 0.5 + 0.5 * Math.sin(y * 0.55 + jn * 9 + nxv * 3);
        _c2.copy(rockC).lerp(rockWarm, strata * 0.45 + 0.1).multiplyScalar(0.8 + 0.3 * fine);
        const rockAmt = Math.max(smooth(0.38, 0.5, t + (jn - 0.5) * 0.14), smooth(0.72, 0.5, ny) * smooth(0.2, 0.3, t));
        _c1.lerp(_c2, clamp(rockAmt, 0, 1));
        _c1.lerp(screeC, smooth(0.35, 0.55, ny) * smooth(0.3, 0.4, t) * (1 - smooth(0.45, 0.6, t)) * 0.25);
        const snowLine = L.snow + (jn - 0.5) * 0.14 + (1 - nxv) * 0.02;
        const snow = smooth(snowLine, snowLine + 0.08, t) * smooth(0.4, 0.78, ny + (fine - 0.5) * 0.18 + (jn - 0.5) * 0.5);
        _c3.copy(snowC).lerp(snowShade, clamp(0.5 - nxv * 0.6, 0, 1) * 0.35);
        _c1.lerp(_c3, snow);
        // aerial perspective: bluer/lighter with distance and in valley mist
        _c1.lerp(hazeC, L.haze + smooth(0.0, 0.18, 0.18 - t) * 0.16 * (1 - L.haze));
        col[k * 3] = _c1.r; col[k * 3 + 1] = _c1.g; col[k * 3 + 2] = _c1.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, patchWorld(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, {}));
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  // =========================================================================
  // Clouds: puffy cumulus with soft shaded undersides + high wisps
  // =========================================================================
  const clouds = [];
  let cloudMesh;
  {
    const nClouds = lp ? 9 : 15;
    const puffGeo = new THREE.SphereGeometry(1, lp ? 9 : 12, lp ? 6 : 8);
    let total = 0;
    for (let c = 0; c < nClouds; c++) {
      const dist = R(90, 260);
      const elev = R(9, 26) * (Math.PI / 180);
      const s = dist * 0.04 * R(0.8, 1.3);
      const n = Math.floor(R(7, 11));
      const puffs = [];
      for (let p = 0; p < n; p++) {
        const u = n > 1 ? (p / (n - 1)) * 2 - 1 : 0;
        const rad = (0.8 + (1 - u * u) * 1.0) * R(0.8, 1.2);
        const top = p % 3 === 1 ? R(0.5, 1.0) : 0;
        puffs.push({ x: u * 3.8 + R(-0.3, 0.3), y: rad * 0.5 + top * (1 - u * u), z: R(-0.8, 0.8), rx: rad * 1.15, ry: rad * 0.7, rz: rad * 0.95 });
        // little cauliflower bumps on top
        if (p % 2 === 0) puffs.push({ x: u * 3.8 + R(-0.5, 0.5), y: rad * 0.95 + top, z: R(-0.4, 0.4), rx: rad * 0.55, ry: rad * 0.45, rz: rad * 0.5 });
      }
      total += puffs.length;
      clouds.push({
        x: R(-1, 1) * dist * 1.0,
        y: 2.2 + dist * Math.tan(elev),
        z: 14 - dist,
        s,
        speed: R(0.5, 1.4) * (dist / 100),
        wrap: dist * 1.1 + 60,
        puffs,
      });
    }
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float up = dot(normal, upV);
          vec3 shade = mix(vec3(0.58, 0.67, 0.84), vec3(1.0, 0.99, 0.96), smoothstep(-0.55, 0.65, up));
          reflectedLight.directDiffuse *= 0.35;
          reflectedLight.indirectDiffuse = diffuseColor.rgb * shade * 1.2;
        }`
      );
    };
    mat.customProgramCacheKey = () => 'cloud-v2';
    moodMats.cloud = mat;
    cloudMesh = new THREE.InstancedMesh(puffGeo, mat, total);
    cloudMesh.frustumCulled = false;
    cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(cloudMesh);
  }
  const writeClouds = () => {
    const a = cloudMesh.instanceMatrix.array;
    let o = 0;
    for (const c of clouds) {
      for (const p of c.puffs) {
        a[o] = p.rx * c.s; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
        a[o + 4] = 0; a[o + 5] = p.ry * c.s; a[o + 6] = 0; a[o + 7] = 0;
        a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = p.rz * c.s; a[o + 11] = 0;
        a[o + 12] = c.x + p.x * c.s; a[o + 13] = c.y + p.y * c.s; a[o + 14] = c.z + p.z * c.s; a[o + 15] = 1;
        o += 16;
      }
    }
    cloudMesh.instanceMatrix.needsUpdate = true;
  };
  writeClouds();

  // wispy high clouds
  const wisps = [];
  let wispMesh;
  {
    const nW = lp ? 5 : 9;
    const tex = canvasTexture(256, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const wr = mulberry32(5);
      for (let i = 0; i < 22; i++) {
        const cx = w * (0.18 + 0.64 * wr()), cy = h * (0.35 + 0.3 * wr()), rx = w * (0.1 + 0.2 * wr()), ry = h * (0.1 + 0.15 * wr());
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(rx, ry);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8, color: '#fffdfa' });
    moodMats.wisp = mat;
    wispMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, nW);
    wispMesh.frustumCulled = false;
    wispMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < nW; i++) {
      const dist = R(280, 380);
      wisps.push({ x: R(-0.9, 0.9) * dist * 0.7, y: R(95, 190), z: -dist, w: R(160, 280), sp: R(0.8, 1.6), wrap: 330 });
    }
    scene.add(wispMesh);
  }
  const writeWisps = () => {
    wisps.forEach((w, i) => {
      dummy.position.set(w.x, w.y, w.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w.w, w.w * 0.12, 1);
      dummy.updateMatrix();
      wispMesh.setMatrixAt(i, dummy.matrix);
    });
    wispMesh.instanceMatrix.needsUpdate = true;
  };
  writeWisps();

  // =========================================================================
  // Birds (far, circling) and butterflies (near the flowers)
  // =========================================================================
  const birds = [];
  let birdMesh;
  {
    const nB = lp ? 6 : 12;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.3, -0.07, 0, -0.2, 0.07, 0, -0.2,
      0, 0, 0.12, 0, 0, -0.08, 1.0, 0, -0.18,
      0, 0, 0.12, -1.0, 0, -0.18, 0, 0, -0.08,
    ], 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(27).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    paint(bg, new THREE.Color('#2e2c32'));
    birdMesh = new THREE.InstancedMesh(bg, patchFlap(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, 'bird'), nB);
    birdMesh.frustumCulled = false;
    birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < nB; i++) {
      const flock = i % 3;
      const cx = [-14, 22, 4][flock], cz = [-95, -110, -80][flock];
      birds.push({ cx, cz, rad: R(14, 34), y: R(28, 52), sp: R(0.18, 0.3) * (rnd() < 0.5 ? 1 : -1), ph: R(0, 6.28), sc: R(1.4, 2.2), bob: R(0, 6.28) });
    }
    scene.add(birdMesh);
  }

  const flies = [];
  let flyMesh;
  {
    const nF = lp ? 8 : 16;
    const wing = (sgn) => [
      sgn * 0.01, 0, 0.03, sgn * 0.14, 0, 0.1, sgn * 0.12, 0, -0.01,
      sgn * 0.01, 0, 0.0, sgn * 0.12, 0, -0.02, sgn * 0.07, 0, -0.1,
    ];
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([...wing(1), ...wing(-1), 0, 0, 0.07, -0.008, 0, -0.06, 0.008, 0, -0.06], 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(21 * 3).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    paint(fg, (x, y, z, i) => (i >= 18 ? _c1.set('#2b2420') : _c1.set('#ffffff').lerp(_c2.set('#e8e0d0'), clamp(Math.hypot(x, z) * 6 - 0.2, 0, 1))));
    flyMesh = new THREE.InstancedMesh(fg, patchFlap(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, 'fly'), nF);
    flyMesh.frustumCulled = false;
    flyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const cols = ['#ff9a2e', '#ffe14a', '#ffffff', '#69a8ff', '#ff7ab0'];
    for (let i = 0; i < nF; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * R(2.5, 10) + R(-1, 1);
      const z = R(-7, -1.8);
      flies.push({ cx: x, cz: z, ax: R(1.0, 2.2), az: R(0.8, 1.8), sp: R(0.25, 0.5), ph: R(0, 6.28), y: R(0.8, 1.6), sc: R(0.8, 1.2) });
      flyMesh.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    }
    scene.add(flyMesh);
  }
  const writeFliers = (t) => {
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const a = t * b.sp + b.ph;
      const dir = Math.sign(b.sp);
      dummy.position.set(b.cx + Math.cos(a) * b.rad, b.y + Math.sin(t * 0.4 + b.bob) * 2, b.cz + Math.sin(a) * b.rad * 0.6);
      dummy.rotation.set(0, Math.atan2(-Math.sin(a) * dir, Math.cos(a) * 0.6 * dir), -0.25 * dir);
      dummy.scale.setScalar(b.sc);
      dummy.updateMatrix();
      birdMesh.setMatrixAt(i, dummy.matrix);
    }
    birdMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      const a = t * f.sp * 2 + f.ph;
      const x = f.cx + Math.sin(a) * f.ax + Math.sin(a * 2.3) * 0.4;
      const z = f.cz + Math.cos(a * 0.8 + 1.0) * f.az;
      const dx = Math.cos(a) * f.ax + Math.cos(a * 2.3) * 0.9;
      const dz = -Math.sin(a * 0.8 + 1.0) * f.az * 0.8;
      dummy.position.set(x, f.y + Math.sin(t * 1.9 + f.ph) * 0.18, z);
      dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      dummy.scale.setScalar(f.sc);
      dummy.updateMatrix();
      flyMesh.setMatrixAt(i, dummy.matrix);
    }
    flyMesh.instanceMatrix.needsUpdate = true;
  };
  writeFliers(0);

  // =========================================================================
  // Celebration: petals + balloons
  // =========================================================================
  const PETALS = lp ? 80 : 200;
  const BALLOONS = lp ? 18 : 36;
  const petalState = [];
  const balloonState = [];
  let celebrateT = -1; // < 0 : idle
  const CELEBRATE_LEN = 12;
  let petalMesh, balloonMesh, stringMesh;
  {
    // petal: a curved, cupped leaf shape
    const pg = petalGeo(0.16, 0.06, 0.25, 2, 0.4, -0.08, 0.6);
    paint(pg, () => _c1.set('#ffffff'));
    petalMesh = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#3a2a30' }), PETALS);
    petalMesh.frustumCulled = false;
    petalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    petalMesh.visible = false;
    const petalCols = ['#ffd0e0', '#ff9dbd', '#ffffff', '#ffe27a', '#ffb3c8', '#f7a1d6'].map((h) => new THREE.Color(h));
    dummy.scale.setScalar(0); dummy.updateMatrix();
    for (let i = 0; i < PETALS; i++) {
      petalMesh.setMatrixAt(i, dummy.matrix);
      petalMesh.setColorAt(i, petalCols[i % petalCols.length]);
      petalState.push({ on: false, x: 0, y: 0, z: 0, vy: 1, dx: 0, dz: 0, ph: 0, sp: 1, sc: 1 });
    }
    scene.add(petalMesh);

    // balloon: smooth egg with a highlight sheen, a pinched knot and a bow
    const bg = new THREE.SphereGeometry(0.5, 24, 18);
    const bp = bg.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      let x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const k = y < 0 ? 1 - 0.3 * Math.pow(-y / 0.5, 1.5) : 1;
      x *= k; z *= k; y *= 1.2;
      bp.setXYZ(i, x, y, z);
    }
    bg.computeVertexNormals();
    const hl = new THREE.Vector3(-0.45, 0.6, 0.65).normalize();
    const bn = bg.attributes.normal;
    paint(bg, (x, y, z, i) => {
      const d = Math.max(0, bn.getX(i) * hl.x + bn.getY(i) * hl.y + bn.getZ(i) * hl.z);
      const rim = Math.pow(1 - Math.abs(bn.getZ(i)), 3) * 0.1;
      const v = 1 + Math.pow(d, 8) * 0.9 + rim;
      return _c1.setRGB(v, v, v);
    });
    const knot = new THREE.ConeGeometry(0.07, 0.14, 8);
    knot.rotateX(Math.PI);
    knot.translate(0, -0.66, 0);
    knot.computeVertexNormals();
    paint(knot, new THREE.Color('#ffffff'));
    const bow = new THREE.TorusGeometry(0.03, 0.012, 5, 8);
    bow.translate(0, -0.77, 0);
    paint(bow, new THREE.Color('#ffffff'));
    balloonMesh = new THREE.InstancedMesh(merge([bg, knot, bow]), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 140, specular: '#bbbbbb' }), BALLOONS);
    balloonMesh.frustumCulled = false;
    balloonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    balloonMesh.visible = false;
    const balloonCols = NOTE_COLORS.concat(['#ff8fb3', '#ffd0e0']).map((h) => new THREE.Color(h));
    // string: a slightly curved ribbon
    const sg = new THREE.CylinderGeometry(0.008, 0.008, 1.6, 3, 4, true);
    sg.translate(0, -0.8, 0);
    const spp = sg.attributes.position;
    for (let i = 0; i < spp.count; i++) {
      const t = -spp.getY(i) / 1.6;
      spp.setX(i, spp.getX(i) + Math.sin(t * Math.PI * 2) * 0.05 * t);
    }
    sg.computeVertexNormals();
    stringMesh = new THREE.InstancedMesh(sg, new THREE.MeshLambertMaterial({ color: '#f3eee2' }), BALLOONS);
    stringMesh.frustumCulled = false;
    stringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    stringMesh.visible = false;
    dummy.scale.setScalar(0); dummy.updateMatrix();
    for (let i = 0; i < BALLOONS; i++) {
      balloonMesh.setMatrixAt(i, dummy.matrix);
      stringMesh.setMatrixAt(i, dummy.matrix);
      balloonMesh.setColorAt(i, balloonCols[i % balloonCols.length]);
      balloonState.push({ on: false, delay: 0, age: 0, x: 0, z: 0, speed: 1, ph: 0, sc: 1 });
    }
    scene.add(balloonMesh, stringMesh);
  }

  function spawnPetal(p, initial) {
    p.on = true;
    p.x = R(-18, 18);
    p.z = R(-14, 10);
    p.y = initial ? R(0.5, 14) : R(11, 16);
    p.vy = R(0.7, 1.3);
    p.dx = R(-0.35, 0.35);
    p.dz = R(-0.2, 0.2);
    p.ph = R(0, 6.28);
    p.sp = R(1.5, 3.5);
    p.sc = R(0.8, 1.6);
  }

  function celebrate() {
    celebrateT = 0;
    for (const p of petalState) {
      // keep petals already in flight; re-seed the idle ones across the sky
      if (!p.on) spawnPetal(p, true);
    }
    for (const b of balloonState) {
      if (b.on) continue;
      b.on = true;
      b.delay = R(0, 8);
      b.age = 0;
      // always well behind the cast (z < -3.5), spread wider the further back they are
      b.z = R(-22, -4.5);
      const spread = 6 + Math.abs(b.z) * 0.6;
      b.x = clamp((rnd() + rnd() + rnd() - 1.5) * spread * 1.2, -26, 26);
      b.speed = R(1.0, 1.7);
      b.ph = R(0, 6.28);
      b.sc = R(0.6, 0.9);
    }
    petalMesh.visible = balloonMesh.visible = stringMesh.visible = true;
  }

  function updateCelebration(dt, t) {
    if (celebrateT < 0) return;
    celebrateT += dt;
    const spawning = celebrateT < CELEBRATE_LEN;
    let active = 0;
    // petals
    const pa = petalMesh;
    for (let i = 0; i < PETALS; i++) {
      const p = petalState[i];
      if (!p.on) continue;
      p.y -= p.vy * dt;
      p.x += (p.dx + Math.sin(t * 0.9 + p.ph) * 0.45) * dt;
      p.z += (p.dz + Math.cos(t * 0.7 + p.ph) * 0.3) * dt;
      if (p.y < 0.03) {
        if (spawning) spawnPetal(p, false);
        else { p.on = false; dummy.scale.setScalar(0); dummy.position.set(0, -10, 0); dummy.updateMatrix(); pa.setMatrixAt(i, dummy.matrix); continue; }
      }
      active++;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(Math.sin(t * p.sp + p.ph) * 1.1, t * p.sp * 0.6 + p.ph, Math.cos(t * p.sp * 0.8 + p.ph) * 1.1);
      dummy.scale.setScalar(p.sc);
      dummy.updateMatrix();
      pa.setMatrixAt(i, dummy.matrix);
    }
    pa.instanceMatrix.needsUpdate = true;
    // balloons
    for (let i = 0; i < BALLOONS; i++) {
      const b = balloonState[i];
      if (!b.on) continue;
      if (b.delay > 0) {
        b.delay -= dt;
        active++;
        continue;
      }
      b.age += dt;
      const y = -1.5 + b.age * b.speed;
      if (y > 48) {
        b.on = false;
        dummy.scale.setScalar(0); dummy.position.set(0, -10, 0); dummy.updateMatrix();
        balloonMesh.setMatrixAt(i, dummy.matrix);
        stringMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      active++;
      const x = b.x + Math.sin(b.age * 0.7 + b.ph) * 0.6;
      const z = b.z + Math.cos(b.age * 0.5 + b.ph) * 0.3;
      const tilt = Math.sin(b.age * 1.3 + b.ph) * 0.1;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, b.age * 0.4 + b.ph, tilt);
      dummy.scale.setScalar(b.sc);
      dummy.updateMatrix();
      balloonMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x + Math.sin(tilt) * 0.66 * b.sc, y - 0.7 * b.sc, z);
      dummy.rotation.set(0, b.age * 0.4 + b.ph, tilt * 1.6);
      dummy.scale.setScalar(b.sc);
      dummy.updateMatrix();
      stringMesh.setMatrixAt(i, dummy.matrix);
    }
    balloonMesh.instanceMatrix.needsUpdate = true;
    stringMesh.instanceMatrix.needsUpdate = true;
    if (!spawning && active === 0) {
      celebrateT = -1;
      petalMesh.visible = balloonMesh.visible = stringMesh.visible = false;
    }
  }

  // Beat spring ----------------------------------------------------------------------------------------------
  let bPos = 0, bVel = 0;
  const K = 480, C = 11;
  function beat(strength = 1) {
    bVel += 9 * clamp(strength, 0, 2);
  }

  // Mood: time of day ------------------------------------------------------------------------------------------
  // Only lights, sky, fog and the few unlit materials change; the scene itself
  // is the same meadow. Colours ease over a couple of seconds.
  const MOODS = {
    day: {
      sun: '#ffe0ad', sunI: 2.9, hemiSky: '#bfdcff', hemiGround: '#b9c27e', hemiI: 1.6, amb: '#fff1dc', ambI: 0.55,
      zenith: '#2f78d6', upper: '#5aa6e8', mid: '#9ccff2', low: '#cfe6f5', horizon: FOG_COLOR, glow: '#ffd99a',
      disc: new THREE.Color().setRGB(1.0, 0.97, 0.86), cloud: '#ffffff', wisp: '#fffdfa', water: '#ffffff', fliers: '#ffffff', stars: 0,
    },
    sunset: {
      sun: '#ffb37a', sunI: 2.6, hemiSky: '#ffc7b0', hemiGround: '#a08f6a', hemiI: 1.25, amb: '#ffd6bf', ambI: 0.5,
      zenith: '#33509f', upper: '#6f7fc8', mid: '#e9a6a0', low: '#ffc58f', horizon: '#ffd2a6', glow: '#ff9a4d',
      disc: '#ffd08a', cloud: '#ffd9c8', wisp: '#ffc2b0', water: '#dba890', fliers: '#d9b8a8', stars: 0,
    },
    night: {
      sun: '#a9c0ff', sunI: 1.5, hemiSky: '#6f86d8', hemiGround: '#39466b', hemiI: 1.25, amb: '#aab4ff', ambI: 0.5,
      zenith: '#070d2e', upper: '#131f5c', mid: '#2e3b86', low: '#5a5fa8', horizon: '#6a6aa6', glow: '#aab8ff',
      disc: '#e6edff', cloud: '#6f78b0', wisp: '#5a639c', water: '#5a66a8', fliers: '#4a5078', stars: 1,
    },
  };
  const MOOD_COLORS = ['sun', 'hemiSky', 'hemiGround', 'amb', 'zenith', 'upper', 'mid', 'low', 'horizon', 'glow', 'disc', 'cloud', 'wisp', 'water', 'fliers'];
  const MOOD_NUMBERS = ['sunI', 'hemiI', 'ambI', 'stars'];
  const moodNow = {};
  const moodGoal = {};
  for (const k of MOOD_COLORS) { moodNow[k] = new THREE.Color(MOODS.day[k]); moodGoal[k] = moodNow[k].clone(); }
  for (const k of MOOD_NUMBERS) moodNow[k] = moodGoal[k] = MOODS.day[k];
  const waterDeep = lakeMat.uniforms.cDeep.value.clone();
  const waterShallow = lakeMat.uniforms.cShallow.value.clone();
  let moodBlend = 1; // 1 = arrived

  function applyMood() {
    const m = moodNow;
    sun.color.copy(m.sun); sun.intensity = m.sunI;
    hemi.color.copy(m.hemiSky); hemi.groundColor.copy(m.hemiGround); hemi.intensity = m.hemiI;
    ambient.color.copy(m.amb); ambient.intensity = m.ambI;
    scene.fog.color.copy(m.horizon);
    scene.background.copy(m.horizon);
    // The lake holds its own copies of the sky colours for its reflection.
    for (const u of [domeUniforms, lakeMat.uniforms]) {
      u.cZenith.value.copy(m.zenith); u.cUpper.value.copy(m.upper); u.cMid.value.copy(m.mid);
      u.cLow.value.copy(m.low); u.cHorizon.value.copy(m.horizon); u.cGlow.value.copy(m.glow);
    }
    domeUniforms.cDisc.value.copy(m.disc);
    domeUniforms.uStars.value = m.stars;
    lakeMat.uniforms.cDeep.value.copy(waterDeep).multiply(m.water);
    lakeMat.uniforms.cShallow.value.copy(waterShallow).multiply(m.water);
    moodMats.cloud?.color.copy(m.cloud);
    moodMats.wisp?.color.copy(m.wisp);
    birdMesh?.material.color.copy(m.fliers);
    flyMesh?.material.color.copy(m.fliers);
  }

  /** 'day' | 'sunset' | 'night'. Eases there unless `instant`. */
  function setMood(name, instant = false) {
    const goal = MOODS[name] || MOODS.day;
    for (const k of MOOD_COLORS) moodGoal[k].set(goal[k]);
    for (const k of MOOD_NUMBERS) moodGoal[k] = goal[k];
    moodBlend = 0;
    if (instant) updateMood(1e3);
  }

  function updateMood(dt) {
    if (moodBlend >= 1) return;
    const k = 1 - Math.exp(-dt * 2.2);
    moodBlend += (1 - moodBlend) * k;
    if (moodBlend > 0.995) moodBlend = 1;
    const a = moodBlend === 1 ? 1 : k;
    for (const c of MOOD_COLORS) moodNow[c].lerp(moodGoal[c], a);
    for (const n of MOOD_NUMBERS) moodNow[n] += (moodGoal[n] - moodNow[n]) * a;
    applyMood();
  }

  // Update -----------------------------------------------------------------------------------------------------
  function update(dt, t) {
    dt = clamp(dt || 0, 0, 0.1);
    shared.uTime.value = t;
    updateMood(dt);
    // spring, sub-stepped for stability
    let rem = dt;
    while (rem > 1e-6) {
      const h = Math.min(rem, 0.008);
      bVel += (-K * bPos - C * bVel) * h;
      bPos += bVel * h;
      rem -= h;
    }
    shared.uBeat.value = clamp(bPos, -1.5, 1.5);

    for (const c of clouds) {
      c.x += c.speed * dt;
      if (c.x > c.wrap) c.x -= c.wrap * 2;
    }
    writeClouds();
    for (const w of wisps) {
      w.x += w.sp * dt;
      if (w.x > w.wrap) w.x -= w.wrap * 2;
    }
    writeWisps();
    writeFliers(t);
    updateCelebration(dt, t);
  }

  return { update, beat, celebrate, setMood, sun };
}
