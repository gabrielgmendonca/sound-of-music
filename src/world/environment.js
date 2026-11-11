// Do-Re-Mi Meadow - the world: sky, meadow, hills, lake, chapel, mountains,
// lighting and the finale's petals + balloons. Everything is procedural and
// driven by update(dt, t); there are no timers and no external assets.
//
// Needs camera.far >= ~350 (the farthest mountains sit ~230 m behind origin).

import * as THREE from 'three';
import { NOTE_COLORS, STAGE } from '../config.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const CLEAR = STAGE.clearRadius;
const FOG_COLOR = '#d6e8f2';
const SUN_POS = new THREE.Vector3(-6, 10, 8);
const LAKE = { x: 6, z: -46, ax: 18, az: 10, y: 0.6 };
const CHAPEL_HILL = { x: -11, z: -63, sigma: 13, height: 6 };

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
  let h = (rolling(x, z) - 2.2) * 0.55 * w * front;
  // hills that rise behind the stage and fall away towards the far mountains
  const ridge =
    smooth(-22, -75, z) *
    (1 - 0.8 * smooth(-95, -165, z)) *
    (6 + 4 * Math.sin(x * 0.04 + 0.7) + 2.5 * Math.cos(x * 0.083 - z * 0.03));
  h += ridge * w;
  // gentle valley walls to either side
  h += smooth(30, 90, Math.abs(x)) * 5 * w * (0.7 + 0.3 * Math.sin(z * 0.06 + x * 0.02));
  // chapel hill
  const cdx = x - CHAPEL_HILL.x;
  const cdz = z - CHAPEL_HILL.z;
  h += CHAPEL_HILL.height * Math.exp(-(cdx * cdx + cdz * cdz) / (2 * CHAPEL_HILL.sigma * CHAPEL_HILL.sigma));
  // lake basin: flatten into a bank, then dip below the water
  const e = lakeE(x, z);
  const s = 1 - smooth(1.0, 1.7, e);
  if (s > 0) {
    const bank = LAKE.y - 1.7 + 2.2 * smooth(0.7, 1.05, e);
    h = lerp(h, bank, s);
  }
  return h;
}

// Geometry helpers ------------------------------------------------------------
// Everything merged into one mesh carries position / normal / color.
function paint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
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
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const C = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    P.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) N.set(g.attributes.normal.array, o * 3);
    C.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}

function upNormals(geo) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a[i * 3 + 1] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(a, 3));
  return geo;
}

// Build a non-indexed geometry from a flat list of triangles
// (each vertex [x,y,z]); colours via fn(x,y,z).
function trisToGeo(tris, colorFn) {
  const p = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => {
    p[i * 3] = v[0];
    p[i * 3 + 1] = v[1];
    p[i * 3 + 2] = v[2];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  paint(g, colorFn);
  return g;
}

function boxPart(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, new THREE.Color(color));
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

// Wind sway + beat bob injected into a Lambert material.
function patchSway(mat, shared, sway, bob) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uBeat = shared.uBeat;
    shader.uniforms.uSway = { value: sway };
    shader.uniforms.uBob = { value: bob };
    shader.vertexShader =
      'uniform float uTime;\nuniform float uBeat;\nuniform float uSway;\nuniform float uBob;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float swH = max(position.y, 0.0);
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
      );
  };
  mat.customProgramCacheKey = () => 'sway-v1';
  return mat;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function createEnvironment(scene, { lowPower = false } = {}) {
  const lp = !!lowPower;
  const rnd = mulberry32(20240611);
  const R = (a, b) => a + (b - a) * rnd();
  const shared = { uTime: { value: 0 }, uBeat: { value: 0 } };
  const dummy = new THREE.Object3D();

  // Keep-out zones for characters' feet.
  const inStage = (x, z, m = 0) =>
    (x > -3.7 - m && x < 3.7 + m && z > -0.9 - m && z < 1.1 + m) ||
    Math.hypot(x - STAGE.maria.x, z - STAGE.maria.z) < 1.0 + m;

  // Scene-level look ----------------------------------------------------------
  const fogColor = new THREE.Color(FOG_COLOR);
  scene.background = fogColor.clone();
  scene.fog = new THREE.Fog(fogColor.clone(), 45, 270);

  // Lights --------------------------------------------------------------------
  const sun = new THREE.DirectionalLight('#ffe0ad', 2.9);
  sun.position.copy(SUN_POS);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const smap = lp ? 512 : 1024;
  sun.shadow.mapSize.set(smap, smap);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
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
  const skyMat = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.BackSide,
    uniforms: {
      cZenith: { value: new THREE.Color('#3f8be0') },
      cMid: { value: new THREE.Color('#86c3f0') },
      cHorizon: { value: fogColor.clone() },
      cGlow: { value: new THREE.Color('#ffd99a') },
      sunDir: { value: new THREE.Vector3(-0.42, 0.2, -0.88).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: `
      uniform vec3 cZenith; uniform vec3 cMid; uniform vec3 cHorizon; uniform vec3 cGlow; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(cHorizon, cMid, smoothstep(0.0, 0.16, h));
        col = mix(col, cZenith, smoothstep(0.1, 0.75, h));
        float s = max(dot(d, sunDir), 0.0);
        col += cGlow * (pow(s, 6.0) * 0.28 + pow(s, 40.0) * 0.45 + pow(s, 400.0) * 1.6);
        col = mix(col, cHorizon, smoothstep(0.0, -0.1, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  // Ground ------------------------------------------------------------------------
  {
    const N = lp ? 52 : 80;
    const S = lp ? 128 : 192;
    const RM = 290;
    const count = N * S + 1;
    const P = new Float32Array(count * 3);
    const C = new Float32Array(count * 3);
    const greens = ['#78bd47', '#5aa63c', '#8fc653', '#468f3a', '#a2c95a'].map((h) => new THREE.Color(h));
    const sand = new THREE.Color('#cdbf80');
    const lawn = new THREE.Color('#7cc24a');
    const far = new THREE.Color('#5f9a63');
    const setV = (idx, x, z) => {
      const y = heightAt(x, z);
      P[idx * 3] = x; P[idx * 3 + 1] = y; P[idx * 3 + 2] = z;
      const n1 = Math.sin(x * 0.13 + z * 0.07) * 0.5 + Math.sin(x * 0.047 - z * 0.11 + 1.7) * 0.5;
      const n2 = Math.sin(x * 0.31 + 2.0) * Math.cos(z * 0.27) ;
      const n3 = Math.sin(x * 0.021 + z * 0.033 + 4.0);
      _c1.copy(greens[0]).lerp(greens[1], clamp(n1 * 0.5 + 0.5, 0, 1));
      _c1.lerp(greens[2], clamp(n2 * 0.5 + 0.3, 0, 0.6));
      _c1.lerp(greens[3], clamp(n3 * 0.5, 0, 0.5));
      _c1.lerp(greens[4], clamp(Math.sin(x * 0.07 - 1.0) * Math.sin(z * 0.06 + 2.0), 0, 1) * 0.5);
      const d = Math.hypot(x, z);
      _c1.lerp(lawn, 0.55 * (1 - smooth(CLEAR - 1, CLEAR + 10, d)));
      _c1.lerp(far, smooth(40, 160, d) * 0.45);
      // lighter tops of hills, sandy lake shore
      _c1.multiplyScalar(0.92 + clamp(y * 0.02, 0, 0.12));
      const e = lakeE(x, z);
      _c1.lerp(sand, smooth(1.12, 0.98, e) * smooth(0.6, 0.9, e) * 0.9);
      C[idx * 3] = _c1.r; C[idx * 3 + 1] = _c1.g; C[idx * 3 + 2] = _c1.b;
    };
    setV(0, 0, 0);
    for (let i = 1; i <= N; i++) {
      const rr = RM * (i / N) * (i / N);
      for (let j = 0; j < S; j++) {
        const a = (j / S) * Math.PI * 2;
        setV(1 + (i - 1) * S + j, Math.cos(a) * rr, Math.sin(a) * rr);
      }
    }
    const idx = [];
    const V = (i, j) => 1 + (i - 1) * S + (j % S);
    for (let j = 0; j < S; j++) idx.push(0, V(1, j + 1), V(1, j));
    for (let i = 1; i < N; i++) {
      for (let j = 0; j < S; j++) {
        const a = V(i, j), b = V(i, j + 1), c = V(i + 1, j), d = V(i + 1, j + 1);
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
  }

  // Grass tufts -------------------------------------------------------------------
  const grassCount = lp ? 2400 : 5500;
  {
    const tris = [];
    const blades = 7;
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * Math.PI * 2 + R(-0.3, 0.3);
      const rad = R(0.02, 0.14);
      const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad;
      const h = R(0.55, 1.0);
      const lean = R(0.1, 0.32);
      const w = 0.045;
      const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      tris.push([bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [tx, h, tz]);
    }
    const g = trisToGeo(tris, (x, y) => {
      const t = clamp(y / 0.9, 0, 1);
      return _c1.set('#2f7a2c').lerp(_c2.set('#b5dc62'), t);
    });
    upNormals(g);
    const mat = patchSway(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, 0.11, 0.2);
    const mesh = new THREE.InstancedMesh(g, mat, grassCount);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    let k = 0;
    let guard = 0;
    while (k < grassCount && guard++ < grassCount * 10) {
      let x, z;
      if (rnd() < 0.45) { x = R(-15, 15); z = R(-8, 18); }
      else { x = R(-48, 48); z = R(-38, 26); }
      if (inStage(x, z, 0.1)) continue;
      if (lakeE(x, z) < 1.2) continue;
      const d = Math.hypot(x, z);
      // short lawn around the stage, longer out in the meadow
      let s = R(0.7, 1.5) * lerp(0.4, 1, smooth(CLEAR - 3, CLEAR + 6, d));
      dummy.position.set(x, heightAt(x, z) - 0.02, z);
      dummy.rotation.set(0, R(0, 6.28), 0);
      dummy.scale.set(s * R(0.9, 1.5), s * R(0.8, 1.2), s * R(0.9, 1.5));
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      mesh.setColorAt(k, _c3.setRGB(R(0.8, 1.1), R(0.9, 1.1), R(0.65, 1.0)));
      k++;
    }
    mesh.count = k;
    scene.add(mesh);
  }

  // Wildflowers ---------------------------------------------------------------------
  {
    const flowerCount = lp ? 650 : 1250;
    // stem + centre (fixed colours)
    const baseParts = [];
    const H = 0.5;
    const stemTris = [];
    for (const a of [0, Math.PI / 2]) {
      const cx = Math.cos(a) * 0.012, cz = Math.sin(a) * 0.012;
      stemTris.push([-cx, 0, -cz], [cx, 0, cz], [cx * 0.6, H, cz * 0.6]);
      stemTris.push([-cx, 0, -cz], [cx * 0.6, H, cz * 0.6], [-cx * 0.6, H, -cz * 0.6]);
    }
    // two leaves
    for (const a of [0.6, 3.6]) {
      const ca = Math.cos(a), sa = Math.sin(a);
      stemTris.push([0, 0.1, 0], [-sa * 0.02, 0.1, ca * 0.02], [ca * 0.14, 0.24, sa * 0.14]);
    }
    baseParts.push(trisToGeo(stemTris, (x, y) => _c1.set('#2d7a2f').lerp(_c2.set('#6dba49'), clamp(y / 0.5, 0, 1))));
    const cTris = [];
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      cTris.push([0, H + 0.025, 0], [Math.cos(a1) * 0.04, H + 0.012, Math.sin(a1) * 0.04], [Math.cos(a0) * 0.04, H + 0.012, Math.sin(a0) * 0.04]);
    }
    baseParts.push(trisToGeo(cTris, () => _c1.set('#f7b733')));
    const baseGeo = upNormals(merge(baseParts));

    const pTris = [];
    const petals = 6;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = -sa, pz = ca;
      const at = (r, wv, y) => [ca * r + px * wv, H + y, sa * r + pz * wv];
      const inner = at(0.03, 0, 0.002);
      const L = at(0.07, -0.032, 0.012);
      const Rr = at(0.07, 0.032, 0.012);
      const tip = at(0.125, 0, 0.03);
      pTris.push(inner, Rr, L, L, Rr, tip);
    }
    const petalGeo = upNormals(trisToGeo(pTris, (x, y, z) => {
      const rr = Math.hypot(x, z);
      const v = 0.72 + 0.28 * clamp((rr - 0.03) / 0.09, 0, 1);
      return _c1.setRGB(v, v, v);
    }));

    const baseMat = patchSway(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, 0.22, 0.35);
    const petalMat = patchSway(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#2a2024' }), shared, 0.22, 0.35);
    const baseMesh = new THREE.InstancedMesh(baseGeo, baseMat, flowerCount);
    const petalMesh = new THREE.InstancedMesh(petalGeo, petalMat, flowerCount);
    baseMesh.frustumCulled = petalMesh.frustumCulled = false;

    const palette = ['#ffffff', '#ffd84a', '#ff86b0', NOTE_COLORS[0], NOTE_COLORS[1], NOTE_COLORS[4], NOTE_COLORS[5], NOTE_COLORS[6], '#fff2a8'].map((h) => new THREE.Color(h));
    // patches of mostly one or two colours
    const patches = [];
    const nPatches = lp ? 22 : 40;
    for (let i = 0; i < nPatches; i++) {
      const near = i < nPatches * 0.4;
      const cx = near ? R(-13, 13) : R(-34, 34);
      const cz = near ? R(3, 15) : R(-26, 12);
      patches.push({ x: cx, z: cz, r: R(1.6, 4.2), c1: palette[Math.floor(R(0, palette.length))], c2: palette[Math.floor(R(0, palette.length))] });
    }
    let k = 0, guard = 0;
    while (k < flowerCount && guard++ < flowerCount * 12) {
      let x, z, col;
      if (rnd() < 0.8) {
        const p = patches[Math.floor(R(0, patches.length))];
        const a = R(0, 6.28), rr = p.r * Math.sqrt(rnd());
        x = p.x + Math.cos(a) * rr; z = p.z + Math.sin(a) * rr;
        col = rnd() < 0.12 ? palette[Math.floor(R(0, palette.length))] : rnd() < 0.6 ? p.c1 : p.c2;
      } else {
        x = R(-36, 36); z = R(-26, 18);
        col = palette[Math.floor(R(0, palette.length))];
      }
      if (inStage(x, z, 0.15)) continue;
      if (lakeE(x, z) < 1.2) continue;
      const s = R(0.8, 1.55);
      dummy.position.set(x, heightAt(x, z) - 0.02, z);
      dummy.rotation.set(R(-0.15, 0.15), R(0, 6.28), R(-0.15, 0.15));
      dummy.scale.set(s, s * R(0.9, 1.25), s);
      dummy.updateMatrix();
      baseMesh.setMatrixAt(k, dummy.matrix);
      petalMesh.setMatrixAt(k, dummy.matrix);
      petalMesh.setColorAt(k, col);
      baseMesh.setColorAt(k, _c3.setRGB(1, 1, 1));
      k++;
    }
    baseMesh.count = petalMesh.count = k;
    baseMesh.receiveShadow = petalMesh.receiveShadow = true;
    scene.add(baseMesh, petalMesh);
  }

  // Pines -----------------------------------------------------------------------------
  {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 1.2, 5);
    trunk.translate(0, 0.6, 0);
    parts.push(paint(trunk, new THREE.Color('#6b4a30')));
    const tiers = [
      [1.7, 2.3, 1.5],
      [1.35, 2.1, 2.7],
      [1.0, 1.9, 3.8],
      [0.6, 1.6, 4.8],
    ];
    tiers.forEach(([rad, h, y], i) => {
      const g = new THREE.ConeGeometry(rad, h, 7, 1, true);
      g.translate(0, y + h / 2 - 0.3, 0);
      const dark = _c1.set('#1f5a38');
      const light = _c2.set('#3f8a4a');
      parts.push(paint(g, (x, yy) => _c3.copy(dark).lerp(light, clamp((yy - (y - 0.3)) / h, 0, 1) * 0.8 + i * 0.05)));
    });
    const geo = merge(parts);
    const mat = patchSway(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, 0.0022, 0.045);
    const total = lp ? 120 : 240;
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.frustumCulled = false;
    const groves = [
      [-20, -6, 5, 16], [24, -9, 5, 14], [-34, -18, 6, 16], [32, -24, 6, 14],
      [-9, -27, 4, 9], [10.5, -30, 4, 8], [-30, -42, 7, 14], [34, -52, 7, 12],
      [-22, -75, 8, 16], [22, -78, 8, 14], [0, -85, 9, 14], [-48, -60, 8, 10],
      [-3, -62, 5, 8], [-17, -58, 4, 8], [-16, 4, 4, 6], [20, 3, 5, 6],
    ];
    const sumN = groves.reduce((s, g) => s + g[3], 0);
    let k = 0, guard = 0;
    while (k < total && guard++ < total * 40) {
      const gv = groves[Math.floor(R(0, groves.length))];
      if (rnd() > gv[3] / (sumN / groves.length) * 0.75) continue;
      const a = R(0, 6.28), rr = gv[2] * Math.sqrt(rnd()) * 1.4;
      const x = gv[0] + Math.cos(a) * rr, z = gv[1] + Math.sin(a) * rr;
      if (Math.hypot(x, z) < CLEAR + 3.5) continue;
      // Keep the view corridor behind the stage open so the lake, chapel and peaks read.
      if (z < 6 && Math.abs(x) < 15 + Math.abs(z) * 0.22) continue;
      if (lakeE(x, z) < 1.25) continue;
      if (Math.hypot(x - CHAPEL_HILL.x, z - CHAPEL_HILL.z) < 7) continue;
      const s = R(0.8, 1.7);
      dummy.position.set(x, heightAt(x, z) - 0.15, z);
      dummy.rotation.set(0, R(0, 6.28), 0);
      dummy.scale.set(s * R(0.9, 1.1), s * R(0.9, 1.25), s * R(0.9, 1.1));
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      mesh.setColorAt(k, _c3.setRGB(R(0.8, 1.1), R(0.85, 1.15), R(0.8, 1.05)));
      k++;
    }
    mesh.count = k;
    scene.add(mesh);
  }

  // Lake ---------------------------------------------------------------------------------
  const water = [];
  {
    const g = new THREE.CircleGeometry(1, 56);
    g.rotateX(-Math.PI / 2);
    paint(g, (x, y, z) => {
      const r = Math.hypot(x, z);
      return _c1.set('#2f95c9').lerp(_c2.set('#8fd8e6'), smooth(0.35, 1.0, r));
    });
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, specular: '#9fc4e0', shininess: 70 });
    const m = new THREE.Mesh(g, mat);
    m.scale.set(LAKE.ax, 1, LAKE.az);
    m.position.set(LAKE.x, LAKE.y, LAKE.z);
    m.frustumCulled = false;
    scene.add(m);

    const glint = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const gr = mulberry32(7);
      for (let i = 0; i < 170; i++) {
        const x = gr() * w, y = gr() * h, len = 5 + gr() * 16, th = 1 + gr() * 1.6;
        ctx.globalAlpha = 0.35 + gr() * 0.6;
        ctx.fillStyle = '#ffffff';
        for (const ox of [-w, 0, w]) {
          ctx.beginPath();
          ctx.ellipse(x + ox, y, len, th, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    for (let i = 0; i < 2; i++) {
      const tex = glint.clone();
      tex.needsUpdate = true;
      tex.repeat.set(i ? 7 : 5, i ? 4 : 3);
      const gm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false });
      const gmesh = new THREE.Mesh(g, gm);
      gmesh.scale.copy(m.scale);
      gmesh.position.set(LAKE.x, LAKE.y + 0.03 + i * 0.01, LAKE.z);
      gmesh.frustumCulled = false;
      scene.add(gmesh);
      water.push({ tex, mat: gm, dir: i ? -1 : 1, i });
    }
  }

  // Chapel ---------------------------------------------------------------------------------
  {
    const parts = [];
    const white = '#fbf5e8';
    parts.push(boxPart(3.5, 0.3, 4.8, 0, 0.15, 0, '#a9a49a'));
    parts.push(boxPart(3.0, 2.3, 4.4, 0, 1.45, -0.1, white));
    // gabled roof with overhang
    const w = 1.95, hh = 1.5, L = 5.0, y0 = 2.55, zc = -0.1;
    const roofTris = [
      [-w, y0, L / 2 + zc], [w, y0, L / 2 + zc], [0, y0 + hh, L / 2 + zc],
    ];
    const slopeL = [[-w, y0, -L / 2 + zc], [-w, y0, L / 2 + zc], [0, y0 + hh, L / 2 + zc], [-w, y0, -L / 2 + zc], [0, y0 + hh, L / 2 + zc], [0, y0 + hh, -L / 2 + zc]];
    const slopeR = [[w, y0, L / 2 + zc], [w, y0, -L / 2 + zc], [0, y0 + hh, -L / 2 + zc], [w, y0, L / 2 + zc], [0, y0 + hh, -L / 2 + zc], [0, y0 + hh, L / 2 + zc]];
    const roofCol = (x, y) => _c1.set('#9a4a35').lerp(_c2.set('#b8654a'), clamp((y - y0) / hh, 0, 1) * 0.5);
    for (const t of [slopeL, slopeR]) { const g = trisToGeo(t, roofCol); g.computeVertexNormals(); parts.push(g); }
    void roofTris;
    // tower in front
    parts.push(boxPart(1.6, 4.4, 1.6, 0, 2.2, 2.55, white));
    parts.push(boxPart(1.8, 0.2, 1.8, 0, 4.5, 2.55, '#8c3f2d'));
    // belfry openings + door + windows
    parts.push(boxPart(0.5, 0.8, 0.05, 0, 3.7, 3.37, '#4a3b57'));
    parts.push(boxPart(0.6, 1.1, 0.05, 0, 0.85, 3.38, '#7a4b2d'));
    parts.push(boxPart(0.05, 0.75, 0.4, 1.53, 1.6, -0.6, '#4a5b7a'));
    parts.push(boxPart(0.05, 0.75, 0.4, -1.53, 1.6, -0.6, '#4a5b7a'));
    parts.push(boxPart(0.05, 0.75, 0.4, 1.53, 1.6, -1.8, '#4a5b7a'));
    parts.push(boxPart(0.05, 0.75, 0.4, -1.53, 1.6, -1.8, '#4a5b7a'));
    // onion dome
    const prof = [[0.001, 0], [0.8, 0.03], [0.98, 0.28], [0.86, 0.62], [0.52, 1.0], [0.2, 1.4], [0.06, 1.7], [0.001, 1.86]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const dome = new THREE.LatheGeometry(prof, 12);
    dome.translate(0, 4.6, 2.55);
    parts.push(paint(dome.toNonIndexed(), (x, y) => _c1.set('#a8402c').lerp(_c2.set('#c76a49'), clamp((y - 4.6) / 1.8, 0, 1))));
    const ball = new THREE.SphereGeometry(0.1, 8, 6);
    ball.translate(0, 6.52, 2.55);
    parts.push(paint(ball, new THREE.Color('#e9c452')));
    parts.push(boxPart(0.05, 0.5, 0.05, 0, 6.8, 2.55, '#e9c452'));
    parts.push(boxPart(0.3, 0.05, 0.05, 0, 6.9, 2.55, '#e9c452'));
    const geo = merge(parts.map((g) => (g.attributes.normal ? g : (g.computeVertexNormals(), g))));
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    const cs = 1.5;
    mesh.scale.setScalar(cs);
    mesh.position.set(CHAPEL_HILL.x, heightAt(CHAPEL_HILL.x, CHAPEL_HILL.z) - 0.1, CHAPEL_HILL.z);
    mesh.rotation.y = 0.35;
    scene.add(mesh);
  }

  // Mountains --------------------------------------------------------------------------------
  {
    const layers = [
      { z: -120, hmax: 22, seed: 11, forced: [[6, 22], [-34, 16], [48, 18]] },
      { z: -168, hmax: 30, seed: 23, forced: [[-12, 30], [34, 24], [-70, 26]] },
      { z: -218, hmax: 40, seed: 37, forced: [[18, 40], [-30, 34], [66, 30]] },
    ];
    const snowC = new THREE.Color('#fbfdff');
    const rockC = new THREE.Color('#8f8a88');
    const forestC = new THREE.Color('#4d7f55');
    const grassC = new THREE.Color('#6c9a58');
    for (const L of layers) {
      const r = mulberry32(L.seed);
      const peaks = L.forced.map(([x, h]) => ({ x, z: 0, h, rad: h * 1.9 }));
      for (let x = -340; x < 340; x += 26 + r() * 30) {
        const h = L.hmax * (0.4 + 0.6 * r());
        peaks.push({ x, z: (r() - 0.5) * 24, h, rad: h * (1.6 + 0.6 * r()) });
      }
      const W = 700, D = 90;
      const nx = Math.round(W / (lp ? 5.5 : 3.6)), nz = lp ? 12 : 18;
      const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
      const col = new Float32Array((nx + 1) * (nz + 1) * 3);
      const hOf = (x, z) => {
        let m = 0;
        for (const p of peaks) {
          const d = Math.hypot(x - p.x, (z - p.z) * 1.15);
          const v = p.h * Math.pow(Math.max(0, 1 - d / p.rad), 0.9);
          if (v > m) m = v;
        }
        const n = Math.sin(x * 0.37 + z * 0.21) * 0.8 + Math.sin(x * 0.91 - z * 0.53) * 0.4 + Math.sin(x * 0.17 + 3) * 0.5;
        return m > 0.5 ? m + n * Math.min(1, m / 6) * (L.hmax / 28) : m;
      };
      for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
          const x = -W / 2 + (i / nx) * W;
          const z = -D / 2 + (j / nz) * D;
          const y = hOf(x, z);
          const idx = j * (nx + 1) + i;
          pos[idx * 3] = x; pos[idx * 3 + 1] = y; pos[idx * 3 + 2] = z + L.z;
          const t = y / L.hmax + Math.sin(x * 0.23 + z * 0.4) * 0.04;
          _c1.copy(grassC).lerp(forestC, smooth(0.02, 0.12, t));
          _c1.lerp(rockC, smooth(0.14, 0.38, t));
          _c1.lerp(snowC, smooth(0.5, 0.58, t));
          col[idx * 3] = _c1.r; col[idx * 3 + 1] = _c1.g; col[idx * 3 + 2] = _c1.b;
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
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(index);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  // Clouds ----------------------------------------------------------------------------------------
  const clouds = [];
  let cloudMesh;
  {
    const nClouds = lp ? 9 : 16;
    const puffGeo = new THREE.SphereGeometry(1, lp ? 9 : 12, lp ? 6 : 8);
    let total = 0;
    for (let c = 0; c < nClouds; c++) {
      const dist = R(70, 210);
      const elev = R(10, 24) * (Math.PI / 180);
      const s = dist * 0.038 * R(0.8, 1.3);
      const n = Math.floor(R(6, 9));
      const puffs = [];
      for (let p = 0; p < n; p++) {
        const u = n > 1 ? (p / (n - 1)) * 2 - 1 : 0;
        const rad = (0.9 + (1 - u * u) * 0.95) * R(0.8, 1.2);
        const top = p % 3 === 1 ? R(0.5, 0.9) : 0;
        puffs.push({ x: u * 3.4 + R(-0.3, 0.3), y: rad * 0.55 + top * (1 - u * u), z: R(-0.7, 0.7), rx: rad * 1.1, ry: rad * 0.72, rz: rad * 0.9 });
      }
      total += n;
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
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#a9b9d8', emissiveIntensity: 0.5 });
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

  // Celebration: petals + balloons ---------------------------------------------------------------------
  const PETALS = lp ? 80 : 200;
  const BALLOONS = lp ? 18 : 36;
  const petalState = [];
  const balloonState = [];
  let celebrateT = -1; // < 0 : idle
  const CELEBRATE_LEN = 12;
  let petalMesh, balloonMesh, stringMesh;
  {
    // petal: a small curved diamond
    const pg = trisToGeo(
      [[0, 0, -0.09], [-0.055, 0.012, 0], [0, 0, 0.09], [0, 0, -0.09], [0, 0, 0.09], [0.055, 0.012, 0]],
      () => _c1.set('#ffffff')
    );
    pg.computeVertexNormals();
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

    // balloon: egg shaped, narrower at the bottom, with a tiny knot
    const bg = new THREE.SphereGeometry(0.5, 14, 11);
    const bp = bg.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      let x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const k = y < 0 ? 1 - 0.28 * (-y / 0.5) : 1;
      x *= k; z *= k; y *= 1.2;
      bp.setXYZ(i, x, y, z);
    }
    bg.computeVertexNormals();
    paint(bg, new THREE.Color('#ffffff'));
    const knot = new THREE.ConeGeometry(0.07, 0.12, 6);
    knot.rotateX(Math.PI);
    knot.translate(0, -0.66, 0);
    knot.computeVertexNormals();
    paint(knot, new THREE.Color('#ffffff'));
    balloonMesh = new THREE.InstancedMesh(merge([bg, knot]), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: '#666666' }), BALLOONS);
    balloonMesh.frustumCulled = false;
    balloonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    balloonMesh.visible = false;
    const balloonCols = NOTE_COLORS.concat(['#ff8fb3', '#ffd0e0']).map((h) => new THREE.Color(h));
    const sg = new THREE.BoxGeometry(0.02, 1.7, 0.02);
    sg.translate(0, -0.85, 0);
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
      b.x = clamp((rnd() + rnd() + rnd() - 1.5) * 9, -15, 15);
      b.z = R(-9, -2.5);
      b.speed = R(1.0, 1.7);
      b.ph = R(0, 6.28);
      b.sc = R(0.95, 1.35);
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
      if (y > 42) {
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
      dummy.position.set(x - Math.sin(tilt) * -0.66 * b.sc, y - 0.7 * b.sc, z);
      dummy.rotation.set(0, 0, tilt * 1.6);
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

  // Update -----------------------------------------------------------------------------------------------------
  function update(dt, t) {
    dt = clamp(dt || 0, 0, 0.1);
    shared.uTime.value = t;
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

    for (const w of water) {
      w.tex.offset.x = (t * 0.012 * w.dir + w.i * 0.3) % 1;
      w.tex.offset.y = (t * 0.007 + w.i * 0.5) % 1;
      w.mat.opacity = 0.38 + 0.2 * Math.sin(t * (1.1 + w.i * 0.7) + w.i * 2);
    }

    updateCelebration(dt, t);
  }

  return { update, beat, celebrate, sun };
}
