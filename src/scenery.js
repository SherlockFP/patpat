// scenery.js — themes, sky, lighting, mountains and bank decoration around the valley.
//
// API (main.js):
//   import { Scenery, themeForLevel, THEMES } from './scenery.js';
//   const theme = themeForLevel(level, daily);
//   const scenery = new Scenery(scene, { world, lib, theme });   // after `new World(...)`
//   scenery.update(dt, camera, ball);                            // every frame, after the camera moved
//   scenery.dispose();                                           // before building the next world
//
// Theme object fields: id, name (Turkish), skyTop/skyMid/horizon/fog (hex), hemiSky/hemiGround/hemiIntensity,
// sunColor/sunIntensity/sunDir (light direction, from the scene towards the light), disc ('sun'|'moon'|null) with
// discDir/discSize/discColor/discGlow/glow (visual disc, placed where a portrait camera can see it), snowfall (0..1),
// windX/snowSpeed (m/s), stars, aurora, clouds (0..1), cloudColor, rock/snow (mountain tints), birds, and the hint
// `fogScale` (main.js may multiply its fog near/far by it; the blizzard is 0.55), ufo (night only).
//
// Easter eggs: new Scenery(scene, { ..., onEgg(id) }) calls onEgg once per discovered egg: 'snowman' (waves when the ball is
// within 8 m), 'duck' (giant rubber duck on the frozen lake behind the town, within 60 m of ball or camera), 'nasreddin'
// (~1 in 4 worlds, riding a donkey backwards along a bank, ball within 10 m), 'ufo' (night theme, ball near the beam),
// 'yeti3am' (local hour 3 only, fires 1.5 s after construction). Distances are measured from the ball surface.
// Test options: { eggs: true | [ids], hour: 3 } force optional eggs on / fake the clock. scenery.eggs holds live positions.
//
// Budget: at most 13 draw calls (night, lift in view, eggs: +1 actors mesh, +1 UFO beam), ~25-38k triangles built / ~16-19k drawn, no shadow maps, no
// per-frame allocations. Everything static is merged into a few vertex-coloured meshes; the long bank-decoration mesh
// is drawn through a moving `drawRange` window along d. World z = -d (downhill distance d), like world.js.
//
// main.js should no longer create its own sky / lights, and World.buildBackdrop() (the old cones) can go: the ridges,
// the end wall behind the town and the summit behind the start replace it.
//
// ENDLESS mode (world.endless, ÇIĞ SONSUZ): the slope has no end, so the valley ridges are built in 112 m chunks that
// stream in ahead of the ball and recycle behind it, the summit stays behind the start, and the finite-level extras
// (gate banners, ski lift, lake, flags, easter eggs) are skipped. Sky, lights, snowfall, clouds, birds are the same.

import * as THREE from 'three';
import { makeRng } from './rng.js';
import { t } from './i18n.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'day', name: 'Güneşli',
    skyTop: 0x5fa8ff, skyMid: 0xa9d4ff, horizon: 0xdcefff, fog: 0xdcefff,
    hemiSky: 0xffffff, hemiGround: 0xaec3e3, hemiIntensity: 1.55,
    sunColor: 0xfff1dc, sunIntensity: 1.9, sunDir: [0.25, 1, 0.6],
    disc: 'sun', discDir: [-0.3, 0.36, -1], discSize: 150, discColor: 0xfff4c8, discGlow: 0xfff0b0, glow: 0.22,
    snowfall: 0.14, windX: 1.5, snowSpeed: 2.0, stars: false, aurora: false,
    clouds: 0.55, cloudColor: 0xffffff, rock: 0x8fa3bf, snow: 0xffffff, birds: true, fogScale: 1,
  },
  {
    id: 'sunset', name: 'Gün Batımı',
    skyTop: 0x2f2d7a, skyMid: 0xc4558f, horizon: 0xffb066, fog: 0xf5a872,
    hemiSky: 0xffe3d0, hemiGround: 0x8f8ac8, hemiIntensity: 1.6,
    sunColor: 0xffb070, sunIntensity: 2.1, sunDir: [0.75, 0.42, 0.5],
    disc: 'sun', discDir: [-0.1, 0.1, -1], discSize: 330, discColor: 0xffc27a, discGlow: 0xffa050, glow: 0.95,
    snowfall: 0.1, windX: 1.0, snowSpeed: 1.8, stars: false, aurora: false,
    clouds: 0.6, cloudColor: 0xffb3a0, rock: 0x7d6fa3, snow: 0xffe9e2, birds: true, fogScale: 1,
  },
  {
    id: 'night', name: 'Gece',
    skyTop: 0x050c2a, skyMid: 0x142a6a, horizon: 0x35569b, fog: 0x35569b,
    hemiSky: 0xa9c0ff, hemiGround: 0x44588f, hemiIntensity: 1.75,
    sunColor: 0xbfd0ff, sunIntensity: 1.15, sunDir: [-0.3, 0.85, 0.5],
    disc: 'moon', discDir: [0.24, 0.22, -1], discSize: 190, discColor: 0xf2f6ff, discGlow: 0x9db8ff, glow: 0.2,
    snowfall: 0.22, windX: 1.2, snowSpeed: 1.8, stars: true, aurora: true,
    clouds: 0.28, cloudColor: 0xa8bce6, rock: 0x5a6e9a, snow: 0xdbe6ff, birds: false, ufo: true, fogScale: 1,
  },
  {
    id: 'blizzard', name: 'Tipi',
    skyTop: 0x8e9bb0, skyMid: 0xb9c3d1, horizon: 0xdfe5ec, fog: 0xdfe5ec,
    hemiSky: 0xf2f6fb, hemiGround: 0xb7c2d2, hemiIntensity: 1.7,
    sunColor: 0xffffff, sunIntensity: 0.75, sunDir: [0.2, 1, 0.4],
    disc: null, discDir: [0, 0.3, -1], discSize: 0, discColor: 0xffffff, discGlow: 0xffffff, glow: 0,
    snowfall: 1, windX: 17, snowSpeed: 7.5, stars: false, aurora: false,
    clouds: 0.9, cloudColor: 0xd5dce6, rock: 0x8c97a8, snow: 0xf2f6fb, birds: false, fogScale: 0.55,
  },
  {
    id: 'pink', name: 'Pembe Şafak',
    skyTop: 0x5b6fd0, skyMid: 0xf2a2cf, horizon: 0xffe3d6, fog: 0xf9d3df,
    hemiSky: 0xffe9f4, hemiGround: 0xb7a4e2, hemiIntensity: 1.6,
    sunColor: 0xffd8b8, sunIntensity: 1.8, sunDir: [0.45, 0.75, 0.5],
    disc: 'sun', discDir: [0.14, 0.1, -1], discSize: 250, discColor: 0xffe2b0, discGlow: 0xffb8c8, glow: 0.7,
    snowfall: 0.16, windX: 1.0, snowSpeed: 1.8, stars: false, aurora: false,
    clouds: 0.7, cloudColor: 0xffd0e6, rock: 0x8a7db0, snow: 0xfff0f6, birds: true, fogScale: 1,
  },
  {
    id: 'crystal', name: 'Kristal Gün',
    skyTop: 0x2d86ff, skyMid: 0x6fc1ff, horizon: 0xcff3ff, fog: 0xcff3ff,
    hemiSky: 0xeaffff, hemiGround: 0x9fd0f0, hemiIntensity: 1.6,
    sunColor: 0xffffff, sunIntensity: 2.0, sunDir: [-0.2, 1, 0.55],
    disc: 'sun', discDir: [0.32, 0.4, -1], discSize: 140, discColor: 0xffffff, discGlow: 0xcfeaff, glow: 0.18,
    snowfall: 0.3, windX: 0.6, snowSpeed: 1.4, stars: false, aurora: false,
    clouds: 0.35, cloudColor: 0xf2fbff, rock: 0x6f98c9, snow: 0xffffff, birds: true, fogScale: 1,
  },
];

const THEME_BY_ID = {};
for (const t of THEMES) THEME_BY_ID[t.id] = t;

// Level 1 day, 2 crystal day, 3 sunset, 4 day, 5 night, 6 blizzard, 7 pink dawn, 8 sunset, 9 night, ... then repeats.
const LEVEL_CYCLE = ['day', 'crystal', 'sunset', 'day', 'night', 'blizzard', 'pink', 'sunset', 'night', 'crystal', 'pink', 'blizzard', 'sunset', 'day', 'night'];

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

export function themeForLevel(level, daily, date = new Date()) {
  if (daily) return THEMES[dayOfYear(date) % THEMES.length];
  const i = (Math.max(1, level | 0) - 1) % LEVEL_CYCLE.length;
  return THEME_BY_ID[LEVEL_CYCLE[i]];
}

// ---------------------------------------------------------------------------------------------------------------
// Noise / helpers
// ---------------------------------------------------------------------------------------------------------------

function hash2(ix, iy, s) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise2(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm1 = (x, s) => noise2(x, 0.5, s) * 0.55 + noise2(x * 2.07, 1.5, s + 7) * 0.3 + noise2(x * 4.3, 2.5, s + 13) * 0.15;
const ridged = (n) => 1 - Math.abs(2 * n - 1);

const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _p3 = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const _e3 = new THREE.Euler();
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------------------------
// Geometry accumulator: non-indexed triangles with per-vertex colour (grows as needed). Build-time only.
// ---------------------------------------------------------------------------------------------------------------

class Accum {
  constructor(cap = 4096) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.n = 0;
  }

  grow(extra) {
    if (this.n + extra <= this.cap) return;
    let c = this.cap;
    while (c < this.n + extra) c *= 2;
    const p = new Float32Array(c * 3), q = new Float32Array(c * 3);
    p.set(this.pos.subarray(0, this.n * 3));
    q.set(this.col.subarray(0, this.n * 3));
    this.pos = p; this.col = q; this.cap = c;
  }

  vert(x, y, z, c) {
    const i = this.n * 3;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.col[i] = c.r; this.col[i + 1] = c.g; this.col[i + 2] = c.b;
    this.n++;
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, c1, c2 = c1, c3 = c1) {
    this.grow(3);
    this.vert(ax, ay, az, c1); this.vert(bx, by, bz, c2); this.vert(cx, cy, cz, c3);
  }

  // Wound so the face normal points away from the reference point (rx, ry, rz).
  triOut(ax, ay, az, bx, by, bz, cx, cy, cz, rx, ry, rz, c1, c2 = c1, c3 = c1) {
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const mx = (ax + bx + cx) / 3 - rx, my = (ay + by + cy) / 3 - ry, mz = (az + bz + cz) / 3 - rz;
    if (nx * mx + ny * my + nz * mz >= 0) this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, c1, c2, c3);
    else this.tri(ax, ay, az, cx, cy, cz, bx, by, bz, c1, c3, c2);
  }

  // Quad p0..p3 given counter-clockwise as seen from outside.
  quad(p0, p1, p2, p3, c) {
    this.tri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], c);
    this.tri(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], c);
  }

  // Box from half-vectors U, V, W (right handed: U x V ~ +W), centred at (cx, cy, cz).
  boxFrame(cx, cy, cz, ux, uy, uz, vx, vy, vz, wx, wy, wz, c) {
    this.grow(36);
    const P = (a, b, e) => [cx + a * ux + b * vx + e * wx, cy + a * uy + b * vy + e * wy, cz + a * uz + b * vz + e * wz];
    // +W / -W
    this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), c);
    this.quad(P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), c);
    // +U / -U  (axes V, W)
    this.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), c);
    this.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), c);
    // +V / -V  (axes W, U)
    this.quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), c);
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), c);
  }

  // Axis-aligned (then yawed about Y through its centre) box with half sizes hx, hy, hz.
  box(cx, cy, cz, hx, hy, hz, yaw, c) {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    this.boxFrame(cx, cy, cz, co * hx, 0, -si * hx, 0, hy, 0, si * hz, 0, co * hz, c);
  }

  // Square-section beam between two points.
  beam(ax, ay, az, bx, by, bz, t, c) {
    let wx = bx - ax, wy = by - ay, wz = bz - az;
    const len = Math.hypot(wx, wy, wz) || 1e-6;
    wx /= len; wy /= len; wz /= len;
    let rx = 0, ry = 1, rz = 0;
    if (Math.abs(wy) > 0.95) { rx = 1; ry = 0; }
    let ux = ry * wz - rz * wy, uy = rz * wx - rx * wz, uz = rx * wy - ry * wx;
    const ul = Math.hypot(ux, uy, uz) || 1e-6;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = wy * uz - wz * uy, vy = wz * ux - wx * uz, vz = wx * uy - wy * ux;
    const h = t / 2;
    this.boxFrame((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, ux * h, uy * h, uz * h, vx * h, vy * h, vz * h, wx * len / 2, wy * len / 2, wz * len / 2, c);
  }

  // Open cone (side faces only), apex up.
  cone(cx, cy, cz, r, h, seg, rot, cBase, cTip) {
    this.grow(seg * 3);
    const rx = cx, ry = cy + h * 0.3, rz = cz;
    for (let k = 0; k < seg; k++) {
      const a0 = rot + (k / seg) * TAU, a1 = rot + ((k + 1) / seg) * TAU;
      this.triOut(cx, cy + h, cz, cx + r * Math.cos(a0), cy, cz + r * Math.sin(a0), cx + r * Math.cos(a1), cy, cz + r * Math.sin(a1), rx, ry, rz, cTip, cBase, cBase);
    }
  }

  // Open cone pointing down (apex below the base).
  coneDown(cx, cy, cz, r, h, seg, rot, cBase, cTip) {
    this.grow(seg * 3);
    const rx = cx, ry = cy - h * 0.3, rz = cz;
    for (let k = 0; k < seg; k++) {
      const a0 = rot + (k / seg) * TAU, a1 = rot + ((k + 1) / seg) * TAU;
      this.triOut(cx, cy - h, cz, cx + r * Math.cos(a0), cy, cz + r * Math.sin(a0), cx + r * Math.cos(a1), cy, cz + r * Math.sin(a1), rx, ry, rz, cTip, cBase, cBase);
    }
  }

  // Ellipsoid (icosphere, detail 0 = 20 tris, 1 = 80 tris), flat colour.
  blob(cx, cy, cz, rx, ry, rz, c, detail = 1) {
    const src = icoVerts(detail);
    this.grow(src.length / 3);
    for (let i = 0; i < src.length; i += 9) {
      this.triOut(
        cx + src[i] * rx, cy + src[i + 1] * ry, cz + src[i + 2] * rz,
        cx + src[i + 3] * rx, cy + src[i + 4] * ry, cz + src[i + 5] * rz,
        cx + src[i + 6] * rx, cy + src[i + 7] * ry, cz + src[i + 8] * rz,
        cx, cy, cz, c);
    }
  }

  // Copy a non-indexed geometry (position + colour) transformed by matrix m, colours multiplied by tint.
  geo(g, m, tint) {
    const P = g.attributes.position.array, C = g.attributes.color ? g.attributes.color.array : null;
    const n = g.attributes.position.count;
    this.grow(n);
    const e = m.elements, o = this.n * 3;
    const tr = tint ? tint[0] : 1, tg = tint ? tint[1] : 1, tb = tint ? tint[2] : 1;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      this.pos[o + i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      this.pos[o + i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      this.pos[o + i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      this.col[o + i * 3] = (C ? C[i * 3] : 0.8) * tr;
      this.col[o + i * 3 + 1] = (C ? C[i * 3 + 1] : 0.8) * tg;
      this.col[o + i * 3 + 2] = (C ? C[i * 3 + 2] : 0.8) * tb;
    }
    this.n += n;
  }

  build(normals = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.n * 3), 3));
    if (normals) g.computeVertexNormals();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Easter-egg actors: tiny rigs written into ONE shared dynamic mesh (CPU-transformed parts), so every egg together
// costs a single draw call. Parts are built in local space; poses are written per frame (only for nearby eggs).
// ---------------------------------------------------------------------------------------------------------------

const _icoCache = [];
function icoVerts(detail) {
  if (!_icoCache[detail]) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    _icoCache[detail] = g.attributes.position.array.slice();
    g.dispose();
  }
  return _icoCache[detail];
}

const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _mC = new THREE.Matrix4(), _mD = new THREE.Matrix4();

function makePart(AB, fn) {
  const v0 = AB.n;
  fn();
  const n = AB.n - v0;
  return { v0, n, base: AB.pos.slice(v0 * 3, (v0 + n) * 3) };
}

function writePart(out, p, m) {
  const e = m.elements, b = p.base, o = p.v0 * 3, n = p.n * 3;
  for (let i = 0; i < n; i += 3) {
    const x = b[i], y = b[i + 1], z = b[i + 2];
    out[o + i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[o + i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[o + i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
}

// Local +z -> f (3D heading), local +y ~ up. Uniform scale s.
function frameMatrix(m, px, py, pz, fx, fy, fz, s) {
  const l = Math.hypot(fx, fy, fz) || 1;
  fx /= l; fy /= l; fz /= l;
  let xx = fz, xz = -fx;
  const xl = Math.hypot(xx, xz) || 1;
  xx /= xl; xz /= xl;
  const yx = fy * xz, yy = fz * xx - fx * xz, yz = -fy * xx;
  m.set(xx * s, yx * s, fx * s, px, 0, yy * s, fy * s, py, xz * s, yz * s, fz * s, pz, 0, 0, 0, 1);
}

// Rotation about a pivot line parallel to X (through y = py, z = pz) / parallel to Z (through x = px, y = py).
function pivRotX(m, a, py, pz) {
  m.makeRotationX(a);
  const e = m.elements, c = Math.cos(a), s = Math.sin(a);
  e[13] = py - (py * c - pz * s);
  e[14] = pz - (py * s + pz * c);
}
function pivRotZ(m, a, px, py) {
  m.makeRotationZ(a);
  const e = m.elements, c = Math.cos(a), s = Math.sin(a);
  e[12] = px - (px * c - py * s);
  e[13] = py - (px * s + py * c);
}

const col = (h) => new THREE.Color(h);

// Small modelling kit: all sizes are given in "unit" space and baked at scale S.
function kit(AB, S) {
  return {
    bx: (cx, cy, cz, hx, hy, hz, c) => AB.box(cx * S, cy * S, cz * S, hx * S, hy * S, hz * S, 0, c),
    bm: (a, b, t, c) => AB.beam(a[0] * S, a[1] * S, a[2] * S, b[0] * S, b[1] * S, b[2] * S, t * S, c),
    bl: (cx, cy, cz, rx, ry, rz, c, d = 1) => AB.blob(cx * S, cy * S, cz * S, rx * S, ry * S, rz * S, c, d),
  };
}

// Nasreddin Hoca (white turban, long beard, green robe) riding a grey donkey BACKWARDS. Donkey faces +z.
function buildNasreddin(AB, S) {
  const { bx, bm, bl } = kit(AB, S);
  const grey = col(0x8f959e), greyD = col(0x6a7079), light = col(0xdcd9d0), hoof = col(0x2f3036), blanket = col(0xc8352f);
  const robe = col(0x3f8f6b), robeD = col(0x2f6f52), sash = col(0xd9453a), boot = col(0x4a2f1d), skin = col(0xe9b58b);
  const white = col(0xffffff), beard = col(0xf1f1f1), dark = col(0x20232a);
  const body = makePart(AB, () => {
    // donkey
    bx(0, 0.92, 0, 0.27, 0.27, 0.62, grey);
    bx(0, 0.8, 0, 0.25, 0.1, 0.55, light);
    bm([0, 1.05, 0.5], [0, 1.5, 0.82], 0.24, grey);
    bx(0, 1.56, 0.98, 0.15, 0.17, 0.27, grey);
    bx(0, 1.48, 1.27, 0.12, 0.11, 0.1, light);
    bx(0, 1.48, 1.38, 0.07, 0.06, 0.03, hoof);
    bx(0.15, 1.62, 1.06, 0.02, 0.04, 0.04, dark); bx(-0.15, 1.62, 1.06, 0.02, 0.04, 0.04, dark);
    bm([0.08, 1.72, 0.92], [0.13, 2.05, 0.9], 0.075, grey); bm([-0.08, 1.72, 0.92], [-0.13, 2.05, 0.9], 0.075, grey);
    bx(0, 1.5, 0.66, 0.035, 0.14, 0.16, greyD);
    bm([0, 1.1, -0.62], [0, 0.72, -0.8], 0.07, grey);
    bx(0, 0.64, -0.8, 0.05, 0.1, 0.05, greyD);
    bx(0, 1.2, -0.05, 0.3, 0.04, 0.34, blanket);
    // Hoca, sitting on the donkey but facing the tail (-z)
    bx(0, 1.62, -0.1, 0.26, 0.4, 0.2, robe);
    bx(0, 1.4, -0.1, 0.275, 0.05, 0.215, sash);
    bx(0.36, 1.12, -0.05, 0.1, 0.27, 0.13, robeD); bx(-0.36, 1.12, -0.05, 0.1, 0.27, 0.13, robeD);
    bx(0.36, 0.78, -0.05, 0.1, 0.14, 0.14, boot); bx(-0.36, 0.78, -0.05, 0.1, 0.14, 0.14, boot);
    bm([0.28, 1.85, -0.1], [0.3, 1.58, -0.5], 0.14, robe); bm([-0.28, 1.85, -0.1], [-0.3, 1.58, -0.5], 0.14, robe);
    bx(0.3, 1.52, -0.56, 0.065, 0.065, 0.065, skin); bx(-0.3, 1.52, -0.56, 0.065, 0.065, 0.065, skin);
    bl(0, 2.2, -0.1, 0.2, 0.22, 0.2, skin, 1);
    bl(0, 2.45, -0.1, 0.34, 0.2, 0.34, white, 1);
    bl(0, 2.63, -0.1, 0.2, 0.14, 0.2, white, 1);
    bl(0, 1.98, -0.27, 0.16, 0.3, 0.1, beard, 1);
    bx(0, 2.17, -0.31, 0.04, 0.05, 0.03, skin);
    bx(0.075, 2.26, -0.3, 0.03, 0.03, 0.02, dark); bx(-0.075, 2.26, -0.3, 0.03, 0.03, 0.02, dark);
  });
  const legs = [[0.2, 0.48, 0], [-0.2, 0.48, Math.PI], [0.2, -0.48, Math.PI], [-0.2, -0.48, 0]].map(([x, z, ph]) => ({
    ph, py: 0.72 * S, pz: z * S,
    part: makePart(AB, () => { bx(x, 0.36, z, 0.065, 0.36, 0.065, grey); bx(x, 0.04, z, 0.075, 0.04, 0.085, hoof); }),
  }));
  return { body, legs };
}

// Special roadside snowman: waves a stick arm (armSign = which side the waving arm is on). Faces +z.
function buildWaveSnowman(AB, S, armSign) {
  const { bx, bm, bl } = kit(AB, S);
  const white = col(0xf6faff), hat = col(0x23262e), red = col(0xe03a3a), orange = col(0xff8a1f), dark = col(0x20232a), brown = col(0x6b4423);
  const body = makePart(AB, () => {
    bl(0, 0.52, 0, 0.6, 0.52, 0.6, white, 1);
    bl(0, 1.4, 0, 0.46, 0.42, 0.46, white, 1);
    bl(0, 2.08, 0, 0.33, 0.32, 0.33, white, 1);
    bx(0, 2.4, 0, 0.36, 0.04, 0.36, hat); bx(0, 2.68, 0, 0.22, 0.26, 0.22, hat); bx(0, 2.5, 0, 0.225, 0.05, 0.225, red);
    bx(0, 1.8, 0, 0.36, 0.06, 0.36, red); bx(0.18, 1.58, 0.34, 0.07, 0.2, 0.03, red);
    bm([0, 2.08, 0.28], [0, 2.03, 0.7], 0.1, orange);
    bx(0.12, 2.18, 0.29, 0.04, 0.04, 0.025, dark); bx(-0.12, 2.18, 0.29, 0.04, 0.04, 0.025, dark);
    for (const y of [1.65, 1.42, 1.19]) bx(0, y, 0.44, 0.045, 0.045, 0.03, dark);
    // idle arm on the other side
    bm([-armSign * 0.42, 1.45, 0], [-armSign * 1.15, 1.18, 0.05], 0.07, brown);
    bm([-armSign * 1.15, 1.18, 0.05], [-armSign * 1.4, 1.02, 0.05], 0.05, brown);
  });
  const arm = makePart(AB, () => {
    const a = armSign;
    bm([a * 0.42, 1.45, 0], [a * 1.2, 1.55, 0], 0.08, brown);
    bm([a * 1.2, 1.55, 0], [a * 1.46, 1.88, 0], 0.05, brown);
    bm([a * 1.2, 1.55, 0], [a * 1.55, 1.58, 0], 0.05, brown);
    bm([a * 1.2, 1.55, 0], [a * 1.5, 1.35, 0], 0.05, brown);
  });
  return { body, arm, px: armSign * 0.42 * S, py: 1.45 * S };
}

// Giant rubber duck, facing +z.
function buildDuck(AB, S) {
  const { bx, bl } = kit(AB, S);
  const y = col(0xffd21f), yd = col(0xf2b705), orange = col(0xff8a1f), orangeD = col(0xe5701a), dark = col(0x16181d), white = col(0xffffff);
  return makePart(AB, () => {
    bl(0, 0.75, 0, 1.0, 0.78, 1.25, y, 1);
    bl(0, 1.12, -1.15, 0.3, 0.3, 0.46, y, 1);
    bl(0.9, 0.86, -0.1, 0.2, 0.45, 0.7, yd, 1); bl(-0.9, 0.86, -0.1, 0.2, 0.45, 0.7, yd, 1);
    bl(0, 1.75, 0.7, 0.62, 0.6, 0.62, y, 1);
    bx(0, 1.62, 1.4, 0.3, 0.09, 0.3, orange); bx(0, 1.5, 1.36, 0.26, 0.05, 0.24, orangeD);
    bl(0.32, 1.9, 1.08, 0.1, 0.11, 0.08, dark, 0); bl(-0.32, 1.9, 1.08, 0.1, 0.11, 0.08, dark, 0);
    bl(0.34, 1.94, 1.14, 0.035, 0.035, 0.03, white, 0); bl(-0.3, 1.94, 1.14, 0.035, 0.035, 0.03, white, 0);
  });
}

// Classic flying saucer, spins about +y.
function buildSaucer(AB, S) {
  const { bx, bm, bl } = kit(AB, S);
  const hullT = col(0xc8d2de), hullB = col(0x8e99a8), underT = col(0x4d5663), underB = col(0x6c7684), glass = col(0x7be8ff), glow = col(0x7dffb0), gold = col(0xffe45c);
  const lights = [col(0xffe45c), col(0x7dffb0), col(0xff7ad9)];
  return makePart(AB, () => {
    AB.cone(0, 0, 0, 1.0 * S, 0.32 * S, 14, 0, hullB, hullT);
    AB.coneDown(0, 0, 0, 1.0 * S, 0.3 * S, 14, 0, underB, underT);
    bl(0, 0.3, 0, 0.46, 0.34, 0.46, glass, 1);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      bx(Math.cos(a) * 0.97, 0.0, Math.sin(a) * 0.97, 0.07, 0.06, 0.07, lights[i % 3]);
    }
    bx(0, -0.32, 0, 0.26, 0.04, 0.26, glow);
    bm([0, 0.6, 0], [0, 0.95, 0], 0.04, hullB);
    bl(0, 0.98, 0, 0.07, 0.07, 0.07, gold, 0);
  });
}

function buildCow(AB, S) {
  const { bx, bm } = kit(AB, S);
  const white = col(0xf7f4ee), black = col(0x24262c), pink = col(0xf4a6b4), horn = col(0xe8dcc0), dark = col(0x2a2c32);
  return makePart(AB, () => {
    bx(0, 0.78, 0, 0.3, 0.28, 0.55, white);
    bx(0, 0.9, 0.15, 0.31, 0.14, 0.2, black); bx(0, 0.7, -0.3, 0.31, 0.12, 0.15, black);
    bx(0, 1.0, 0.72, 0.17, 0.17, 0.2, white);
    bx(0, 0.93, 0.95, 0.13, 0.1, 0.06, pink);
    bx(0.12, 1.2, 0.7, 0.025, 0.06, 0.025, horn); bx(-0.12, 1.2, 0.7, 0.025, 0.06, 0.025, horn);
    bx(0.21, 1.08, 0.68, 0.07, 0.03, 0.05, white); bx(-0.21, 1.08, 0.68, 0.07, 0.03, 0.05, white);
    for (const [x, z] of [[0.2, 0.4], [-0.2, 0.4], [0.2, -0.4], [-0.2, -0.4]]) { bx(x, 0.25, z, 0.065, 0.25, 0.065, white); bx(x, 0.03, z, 0.07, 0.03, 0.07, dark); }
    bx(0, 0.45, -0.3, 0.09, 0.07, 0.1, pink);
    bm([0, 1.0, -0.55], [0, 0.6, -0.65], 0.04, white);
  });
}

function buildMiniSnowman(AB, S) {
  const { bx, bl } = kit(AB, S);
  const white = col(0xf6faff), hat = col(0x23262e), red = col(0xe03a3a), dark = col(0x20232a), orange = col(0xff8a1f);
  return makePart(AB, () => {
    bl(0, 0.4, 0, 0.42, 0.4, 0.42, white, 1);
    bl(0, 1.0, 0, 0.3, 0.3, 0.3, white, 1);
    bx(0, 1.32, 0, 0.26, 0.03, 0.26, hat); bx(0, 1.5, 0, 0.16, 0.17, 0.16, hat);
    bx(0, 1.18, 0, 0.26, 0.04, 0.26, red);
    bx(0, 1.02, 0.3, 0.04, 0.04, 0.12, orange);
    bx(0.08, 1.07, 0.27, 0.025, 0.025, 0.02, dark); bx(-0.08, 1.07, 0.27, 0.025, 0.025, 0.02, dark);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Textures (DataTexture works without a DOM; the text banner needs a canvas and is skipped in Node)
// ---------------------------------------------------------------------------------------------------------------

function glowTexture(kind) {
  const S = kind === 'flake' ? 32 : 128;
  const data = new Uint8Array(S * S * 4);
  const craters = [[-0.09, 0.07, 0.07], [0.1, -0.08, 0.09], [-0.06, -0.13, 0.05], [0.12, 0.1, 0.04], [0.0, 0.02, 0.05]];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x + 0.5) / S * 2 - 1, ny = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(nx, ny);
      let R = 255, G = 255, B = 255, A = 0;
      if (kind === 'flake') {
        A = 1 - smooth(0.25, 1, r);
      } else if (kind === 'sun') {
        const core = 1 - smooth(0.16, 0.21, r);
        const halo = Math.exp(-r * r * 7) * 0.55 + Math.exp(-r * r * 38) * 0.4;
        A = clamp(core + halo, 0, 1) * (1 - smooth(0.8, 1, r));
        G = 252; B = 235 + 20 * (1 - core);
      } else { // moon
        const disc = 1 - smooth(0.26, 0.285, r);
        const halo = Math.exp(-(r - 0.27) * 9) * 0.35 * (1 - disc) * (r > 0.27 ? 1 : 0) * (1 - smooth(0.7, 1, r));
        A = clamp(disc + halo, 0, 1);
        let sh = 1;
        for (const c of craters) {
          const d = Math.hypot(nx - c[0], ny - c[1]);
          sh -= 0.16 * (1 - smooth(c[2] * 0.7, c[2], d));
        }
        R = 238 * sh; G = 242 * sh; B = 255 * sh;
        if (disc < 0.5) { R = 200; G = 215; B = 255; }
      }
      const i = (y * S + x) * 4;
      data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = Math.round(clamp(A, 0, 1) * 255);
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// One canvas, two bands: top = start gate ("ÇIĞ!"), bottom = town arch ("HOŞ GELDİNİZ").
const BANNER_W = 1000; // texture width used by the bands; the rest is plain white
function bannerTexture() {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const g = cv.getContext('2d');
  if (!g) return null;
  const ink = '#17345c';
  const band = (y0, text, c1, c2, trim) => {
    text = t(text);
    const h = 256, w = BANNER_W, p = 10;
    const grad = g.createLinearGradient(0, y0, 0, y0 + h);
    grad.addColorStop(0, c1); grad.addColorStop(1, c2);
    g.fillStyle = trim;
    g.fillRect(0, y0, w, h);
    g.fillStyle = grad;
    g.fillRect(p, y0 + p, w - 2 * p, h - 2 * p);
    // candy stripes top and bottom
    g.save();
    g.beginPath(); g.rect(p, y0 + p, w - 2 * p, 22); g.rect(p, y0 + h - p - 22, w - 2 * p, 22); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let x = -40; x < w + 40; x += 64) {
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + 32, y0); g.lineTo(x + 8, y0 + h); g.lineTo(x - 24, y0 + h); g.fill();
    }
    g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.miterLimit = 2;
    const family = '"Arial Black", Impact, "Segoe UI Black", system-ui, sans-serif';
    g.font = `900 100px ${family}`;
    const w100 = g.measureText(text).width || 1;
    const size = Math.min((h - 70) * 0.9, (100 * (w - 90)) / w100);
    g.font = `900 ${size}px ${family}`;
    const cy = y0 + h / 2 + size * 0.04;
    g.lineWidth = size * 0.2; g.strokeStyle = ink;
    g.strokeText(text, w / 2, cy + size * 0.06);
    g.fillStyle = ink; g.fillText(text, w / 2, cy + size * 0.06);
    g.strokeText(text, w / 2, cy);
    g.fillStyle = '#ffffff'; g.fillText(text, w / 2, cy);
  };
  band(0, 'ÇIĞ!', '#ff9a3d', '#ff6a1a', '#2f7dff');
  band(256, 'HOŞ GELDİNİZ', '#3d8bff', '#1d55b8', '#ff7a2f');
  g.fillStyle = '#ffffff';
  g.fillRect(BANNER_W, 0, 1024 - BANNER_W, 512); // white texels: beams (vertex-coloured) sample here
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------------------------------------------

export class Scenery {
  // opts.onEgg(id) fires once per discovered easter egg ('nasreddin' | 'ufo' | 'duck' | 'snowman' | 'yeti3am').
  // opts.eggs: true | 'all' | [ids] forces optional eggs on (testing); opts.hour overrides the local hour (yeti3am).
  constructor(scene, { world, lib, theme, seed, onEgg, eggs, hour } = {}) {
    this.scene = scene;
    this.world = world;
    this.lib = lib || {};
    this.theme = theme || THEMES[0];
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    scene.add(this.group);
    this.t = 0;
    this.disposed = false;
    this.ballState = { x: 0, d: 0, y: 0, r: 1 };
    this.onEgg = typeof onEgg === 'function' ? onEgg : null;
    this.eggFound = new Set();
    this.eggOpts = {
      force: eggs === true || eggs === 'all' ? ['nasreddin', 'ufo', 'yeti3am'] : Array.isArray(eggs) ? eggs : [],
      hour: Number.isFinite(hour) ? hour : new Date().getHours(),
    };
    this.eggs = {};

    const W = world;
    this.endless = !!(W && (W.endless || W.lvl));
    const mid = !this.endless && W.statics.length ? W.statics[W.statics.length >> 1] : null;
    this.seed = (seed ?? (this.endless ? Math.imul(W.seed || 1, 2654435761) : ((W.L * 131 + W.townStart * 17 + W.statics.length * 7919 + Math.round((mid ? mid.x : 0) * 1000)) | 0))) >>> 0;
    this.sd = this.seed % 9973;
    this.rng = makeRng(this.seed);

    this.pal = {
      orange: new THREE.Color(0xff7a2f), blue: new THREE.Color(0x2f7dff), white: new THREE.Color(0xffffff),
      ink: new THREE.Color(0x17345c), stone: new THREE.Color(0x7f8794), snow: new THREE.Color(0xf4f8ff),
      dark: new THREE.Color(0x3a424f), red: new THREE.Color(0xe84a3a), wood: new THREE.Color(0xa86a3a),
    };

    this.applyAtmosphere();
    this.buildLights();
    this.buildSky();
    this.buildSnow();
    this.buildClouds();
    if (this.endless) {
      this.initEndlessRidges();
      this.buildBirds();
    } else {
      this.buildRidges();
      this.planGates();
      this.planLake();
      this.buildDecor();
      this.buildBanners();
      this.buildFlags();
      this.buildChairs();
      this.buildBirds();
      this.buildEggs();
    }
    this.computeInfo();
  }

  // ---------------------------------------------------------------- atmosphere / lights

  applyAtmosphere() {
    const th = this.theme, scene = this.scene;
    if (scene.fog) scene.fog.color.set(th.fog);
    if (scene.background && scene.background.isColor) scene.background.set(th.fog);
    else scene.background = new THREE.Color(th.fog);
  }

  buildLights() {
    const th = this.theme;
    this.hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiIntensity);
    this.sun = new THREE.DirectionalLight(th.sunColor, th.sunIntensity);
    this.sun.position.set(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize().multiplyScalar(100);
    this.group.add(this.hemi, this.sun);
  }

  // ---------------------------------------------------------------- sky, sun/moon, stars, aurora

  buildSky() {
    const th = this.theme;
    const R = 1000;
    this.sky = new THREE.Group();
    this.sky.name = 'sky';
    this.group.add(this.sky);

    const top = new THREE.Color(th.skyTop), mid = new THREE.Color(th.skyMid), hor = new THREE.Color(th.horizon);
    const glowC = new THREE.Color(th.discGlow);
    const dd = new THREE.Vector3(th.discDir[0], th.discDir[1], th.discDir[2]).normalize();
    const acc = new Accum(4096);

    // Dome: vertex-colour gradient + baked glow around the sun/moon.
    const nLon = 36, nLat = 18;
    const vcol = [], vpos = [];
    for (let j = 0; j <= nLat; j++) {
      const phi = (j / nLat) * Math.PI;
      for (let i = 0; i <= nLon; i++) {
        const th2 = (i / nLon) * TAU;
        const ux = Math.sin(phi) * Math.cos(th2), uy = Math.cos(phi), uz = Math.sin(phi) * Math.sin(th2);
        const c = new THREE.Color();
        if (uy > 0.3) c.copy(mid).lerp(top, clamp((uy - 0.3) / 0.65, 0, 1));
        else c.copy(hor).lerp(mid, smooth(0, 0.3, uy));
        const g = Math.max(0, ux * dd.x + uy * dd.y + uz * dd.z);
        const gl = th.glow * (Math.pow(g, 5) * 0.35 + Math.pow(g, 36) * 0.5);
        c.r = Math.min(1, c.r + glowC.r * gl); c.g = Math.min(1, c.g + glowC.g * gl); c.b = Math.min(1, c.b + glowC.b * gl);
        vcol.push(c);
        vpos.push(ux * R, uy * R, uz * R);
      }
    }
    for (let j = 0; j < nLat; j++) {
      for (let i = 0; i < nLon; i++) {
        const a = j * (nLon + 1) + i, b = a + 1, c = a + nLon + 1, d = c + 1;
        const P = (k) => [vpos[k * 3], vpos[k * 3 + 1], vpos[k * 3 + 2]];
        const pa = P(a), pb = P(b), pc = P(c), pd = P(d);
        if (j > 0) acc.triOut(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], pc[0], pc[1], pc[2], 0, 0, 0, vcol[a], vcol[b], vcol[c]);
        if (j < nLat - 1) acc.triOut(pb[0], pb[1], pb[2], pd[0], pd[1], pd[2], pc[0], pc[1], pc[2], 0, 0, 0, vcol[b], vcol[d], vcol[c]);
      }
    }

    // Distant skyline: two layers of jagged tents just inside the dome (no fog, hazed by colour).
    const rockFar = new THREE.Color(th.rock).lerp(hor, 0.38);
    const snowC = new THREE.Color(th.snow);
    const rr = makeRng(this.seed ^ 0x2f6e2b1);
    const layer = (n, Rr, apexMin, apexMax, cLowMix, capMix) => {
      const cLow = new THREE.Color().copy(hor).lerp(rockFar, cLowMix);
      const cHigh = new THREE.Color().copy(cLow).lerp(snowC, capMix);
      const pt = (ang, y) => [Rr * Math.sin(ang), y, -Rr * Math.cos(ang)];
      for (let k = 0; k < n; k++) {
        const a0 = ((k + rr.range(-0.25, 0.25)) / n) * TAU;
        const w = (TAU / n) * rr.range(0.9, 1.6);
        const ap = rr.range(apexMin, apexMax) * (0.55 + 0.9 * noise2(a0 * 2.2, 3.3, this.sd));
        const l = pt(a0 - w / 2, -170), r = pt(a0 + w / 2, -170), t = pt(a0 + rr.range(-0.2, 0.2) * w, ap);
        acc.triOut(l[0], l[1], l[2], t[0], t[1], t[2], r[0], r[1], r[2], 0, 0, 0, cLow, cHigh, cLow);
      }
    };
    layer(44, 975, 70, 140, 0.35, 0.7);
    layer(34, 935, 40, 100, 0.65, 0.55);

    const geo = acc.build(false);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false });
    const dome = new THREE.Mesh(geo, mat);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    this.sky.add(dome);

    // Sun / moon sprite.
    if (th.disc) {
      const tex = glowTexture(th.disc);
      const sm = new THREE.SpriteMaterial({
        map: tex, color: th.discColor, transparent: true, depthWrite: false, fog: false,
        blending: th.disc === 'sun' ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const spr = new THREE.Sprite(sm);
      spr.position.copy(dd).multiplyScalar(900);
      spr.scale.setScalar(th.discSize * 1.8);
      spr.renderOrder = -900;
      spr.frustumCulled = false;
      this.sky.add(spr);
    }

    // Stars.
    if (th.stars) {
      const n = 520;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      this.starBase = new Float32Array(n * 3);
      this.starPh = new Float32Array(n);
      const r = makeRng(this.seed ^ 0x51577);
      for (let i = 0; i < n; i++) {
        let x, y, z, l;
        if (i % 5 < 3) {
          // low band (3..24 deg above the horizon) - what a portrait camera looking down the slope sees
          const el = r.range(0.05, 0.42), az = r.next() * TAU;
          x = Math.cos(el) * Math.sin(az); y = Math.sin(el); z = -Math.cos(el) * Math.cos(az); l = 1;
        } else {
          do {
            x = r.next() * 2 - 1; y = r.next() * 2 - 1; z = r.next() * 2 - 1;
            l = Math.hypot(x, y, z);
          } while (l > 1 || l < 0.2 || y / l < 0.06);
        }
        pos[i * 3] = (x / l) * 960; pos[i * 3 + 1] = (y / l) * 960; pos[i * 3 + 2] = (z / l) * 960;
        const b = 0.5 + 0.5 * Math.pow(r.next(), 2);
        const warm = r.next();
        this.starBase[i * 3] = b * (0.82 + 0.18 * warm); this.starBase[i * 3 + 1] = b * (0.88 + 0.08 * warm); this.starBase[i * 3 + 2] = b;
        col[i * 3] = this.starBase[i * 3]; col[i * 3 + 1] = this.starBase[i * 3 + 1]; col[i * 3 + 2] = this.starBase[i * 3 + 2];
        this.starPh[i] = r.next() * TAU;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.starColor = new THREE.BufferAttribute(col, 3);
      g.setAttribute('color', this.starColor);
      const m = new THREE.PointsMaterial({
        size: 2.8, sizeAttenuation: false, vertexColors: true, map: glowTexture('flake'), transparent: true,
        depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      });
      this.stars = new THREE.Points(g, m);
      this.stars.frustumCulled = false;
      this.stars.renderOrder = -800;
      this.sky.add(this.stars);
      this.starCursor = 0;
    }

    // Aurora: two additive curtains, waved in place every frame.
    if (th.aurora) {
      const cols = 44, rows = 3;
      this.auroraDefs = [
        { R: 720, az: -0.4, span: 1.2, y0: 60, h: 200, ph: 0 },
        { R: 830, az: 0.42, span: 1.0, y0: 85, h: 170, ph: 2.3 },
      ];
      const nv = this.auroraDefs.length * cols * rows;
      const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 4);
      const idx = [];
      for (let k = 0; k < this.auroraDefs.length; k++) {
        for (let c = 0; c < cols - 1; c++) {
          for (let r = 0; r < rows - 1; r++) {
            const a = (k * cols + c) * rows + r, b = ((k * cols + c + 1) * rows) + r;
            idx.push(a, b, b + 1, a, b + 1, a + 1);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      this.auroraPos = new THREE.BufferAttribute(pos, 3);
      this.auroraCol = new THREE.BufferAttribute(col, 4);
      g.setAttribute('position', this.auroraPos);
      g.setAttribute('color', this.auroraCol);
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending,
      });
      this.aurora = new THREE.Mesh(g, m);
      this.aurora.frustumCulled = false;
      this.aurora.renderOrder = -850;
      this.aurora.userData.cols = cols;
      this.aurora.userData.rows = rows;
      this.sky.add(this.aurora);
      this.updateAurora(0);
    }
  }

  updateAurora(t) {
    const ud = this.aurora.userData, cols = ud.cols, rows = ud.rows;
    const pos = this.auroraPos.array, col = this.auroraCol.array;
    let vi = 0;
    for (let k = 0; k < this.auroraDefs.length; k++) {
      const d = this.auroraDefs[k];
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1);
        const wave = Math.sin(t * 0.45 + u * 6 + d.ph) * 0.5 + Math.sin(t * 0.8 + u * 13 + d.ph * 2) * 0.25;
        const R = d.R + wave * 70;
        const az = d.az + (u - 0.5) * d.span + Math.sin(t * 0.2 + d.ph) * 0.05;
        const x = R * Math.sin(az), z = -R * Math.cos(az);
        const y0 = d.y0 + 18 * Math.sin(t * 0.55 + u * 4 + d.ph);
        const h = d.h * (0.72 + 0.28 * Math.sin(t * 0.38 + u * 7 + d.ph));
        const bright = 0.55 + 0.45 * Math.sin(t * 0.7 + u * 9 + d.ph * 1.7);
        const edge = Math.min(1, u * 6, (1 - u) * 6);
        for (let r = 0; r < rows; r++) {
          const f = r / (rows - 1);
          const o = vi * 3, oc = vi * 4;
          pos[o] = x + wave * 30 * f; pos[o + 1] = y0 + h * f; pos[o + 2] = z;
          // green at the base, teal in the middle, violet fading out at the top
          col[oc] = lerp(0.15, 0.55, f); col[oc + 1] = lerp(1.0, 0.45, f * f); col[oc + 2] = lerp(0.45, 1.0, f);
          col[oc + 3] = (r === 0 ? 0.5 : r === 1 ? 0.3 : 0) * bright * edge;
          vi++;
        }
      }
    }
    this.auroraPos.needsUpdate = true;
    this.auroraCol.needsUpdate = true;
  }

  // ---------------------------------------------------------------- snowfall

  buildSnow() {
    const th = this.theme;
    if (th.snowfall <= 0.01) return;
    const N = 800;
    this.snowN = Math.floor(lerp(240, N, clamp(th.snowfall, 0, 1)));
    const r = makeRng(this.seed ^ 0x5a0f1);
    const pos = new Float32Array(N * 3);
    this.snowPh = new Float32Array(N);
    this.snowSp = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = r.range(-36, 36); pos[i * 3 + 1] = r.range(-24, 24); pos[i * 3 + 2] = r.range(-105, 15);
      this.snowPh[i] = r.next() * TAU;
      this.snowSp[i] = 0.7 + 0.6 * r.next();
    }
    const g = new THREE.BufferGeometry();
    this.snowPos = new THREE.BufferAttribute(pos, 3);
    this.snowPos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.snowPos);
    g.setDrawRange(0, this.snowN);
    const m = new THREE.PointsMaterial({
      size: 0.6, sizeAttenuation: true, color: th.id === 'night' ? 0xdce8ff : 0xffffff, map: glowTexture('flake'),
      transparent: true, opacity: 0.55 + 0.4 * th.snowfall, depthWrite: false, fog: false,
    });
    this.snow = new THREE.Points(g, m);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 10;
    this.group.add(this.snow);
    this.snowK = 1;
    this.snowInit = false;
    this.lcx = 0; this.lcy = 0; this.lcz = 0;
  }

  updateSnow(dt, camera, ball) {
    const th = this.theme;
    const cp = camera.position;
    if (!this.snowInit) { this.lcx = cp.x; this.lcy = cp.y; this.lcz = cp.z; this.snowInit = true; }
    const dx = cp.x - this.lcx, dy = cp.y - this.lcy, dz = cp.z - this.lcz;
    this.lcx = cp.x; this.lcy = cp.y; this.lcz = cp.z;
    this.snow.position.copy(cp);
    this.snowK += (clamp(1 + ball.r * 0.17, 1, 3.4) - this.snowK) * Math.min(1, dt * 2);
    const k = this.snowK;
    this.snow.material.size = 0.6 * k;
    const hx = 36 * k, hy = 24 * k, hz = 60 * k, zc = 45 * k;
    const px = this.snowPos.array, ph = this.snowPh, sp = this.snowSp;
    const fall = th.snowSpeed * k, wind = th.windX * k, t = this.t;
    const n = this.snowN;
    const w2x = 2 * hx, w2y = 2 * hy, w2z = 2 * hz;
    for (let i = 0; i < n; i++) {
      const o = i * 3, p = ph[i];
      let x = px[o] - dx + (wind + Math.sin(t * 0.9 + p) * 0.9 * k) * dt;
      let y = px[o + 1] - dy - fall * sp[i] * dt;
      let z = px[o + 2] - dz + Math.cos(t * 0.7 + p) * 0.6 * k * dt + zc;
      if (x < -hx || x > hx) x = ((x + hx) % w2x + w2x) % w2x - hx;
      if (y < -hy || y > hy) y = ((y + hy) % w2y + w2y) % w2y - hy;
      if (z < -hz || z > hz) z = ((z + hz) % w2z + w2z) % w2z - hz;
      px[o] = x; px[o + 1] = y; px[o + 2] = z - zc;
    }
    this.snowPos.needsUpdate = true;
  }

  // ---------------------------------------------------------------- clouds

  buildClouds() {
    const th = this.theme;
    if (th.clouds < 0.05) return;
    // One puffy template: a few flattened icosahedra, shaded white on top, blue-grey underneath.
    const acc = new Accum(512);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const ip = ico.attributes.position.array;
    const blobs = [[0, 0, 0, 1.0], [0.95, -0.12, 0.1, 0.75], [-0.95, -0.1, -0.1, 0.72], [1.7, -0.28, 0, 0.5], [-1.65, -0.3, 0.1, 0.48], [0.35, 0.5, 0, 0.7], [-0.45, 0.32, 0.25, 0.55]];
    const top = new THREE.Color(1, 1, 1), side = new THREE.Color(0.9, 0.93, 1), bot = new THREE.Color(0.74, 0.8, 0.93);
    for (const [bx, by, bz, s] of blobs) {
      for (let i = 0; i < ip.length; i += 9) {
        const a = [ip[i] * s + bx, ip[i + 1] * s * 0.62 + by, ip[i + 2] * s * 0.85 + bz];
        const b = [ip[i + 3] * s + bx, ip[i + 4] * s * 0.62 + by, ip[i + 5] * s * 0.85 + bz];
        const c = [ip[i + 6] * s + bx, ip[i + 7] * s * 0.62 + by, ip[i + 8] * s * 0.85 + bz];
        const cy = (a[1] + b[1] + c[1]) / 3 - by;
        const col = cy > 0.22 * s ? top : cy > -0.2 * s ? side : bot;
        acc.triOut(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], bx, by, bz, col);
      }
    }
    ico.dispose();
    const geo = acc.build(false);
    // Unlit: shading is baked into the vertex colours, the theme tints it through the instance colour.
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const n = Math.round(6 + 18 * th.clouds);
    this.cloudN = n;
    this.clouds = new THREE.InstancedMesh(geo, mat, n);
    this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clouds.frustumCulled = false;
    const tint = new THREE.Color(th.cloudColor);
    this.cloudD = new Float32Array(n);
    this.cloudX = new Float32Array(n);
    this.cloudH = new Float32Array(n);
    this.cloudS = new Float32Array(n);
    this.cloudYaw = new Float32Array(n);
    this.cloudV = new Float32Array(n);
    const r = makeRng(this.seed ^ 0xc10d);
    for (let i = 0; i < n; i++) {
      this.respawnCloud(i, r, 0, true);
      this.clouds.setColorAt(i, tint);
    }
    this.cloudRng = r;
    this.group.add(this.clouds);
  }

  respawnCloud(i, r, ballD, initial) {
    const x = r.range(-520, 520);
    this.cloudX[i] = x;
    this.cloudD[i] = ballD + (initial ? r.range(160, 1100) : r.range(800, 1250));
    this.cloudH[i] = Math.abs(x) < 190 ? r.range(200, 310) : r.range(90, 270);
    this.cloudS[i] = r.range(15, 36);
    this.cloudYaw[i] = r.range(0, TAU);
    this.cloudV[i] = r.range(1.5, 4.5);
  }

  updateClouds(dt, ball) {
    const W = this.world;
    const n = this.cloudN;
    for (let i = 0; i < n; i++) {
      this.cloudX[i] += this.cloudV[i] * dt;
      if (this.cloudX[i] > 560) this.cloudX[i] = -560;
      if (this.cloudD[i] < ball.d - 90) this.respawnCloud(i, this.cloudRng, ball.d, false);
      const d = this.cloudD[i];
      const s = this.cloudS[i];
      _p3.set(this.cloudX[i], W.baseY(d) + this.cloudH[i], -d);
      _q4.setFromAxisAngle(UP, this.cloudYaw[i]);
      _s3.set(s * 1.3, s, s * 1.0);
      _m4.compose(_p3, _q4, _s3);
      this.clouds.setMatrixAt(i, _m4);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- mountains

  // Absolute height of the "outer" surface (heightfield beyond the terrain mesh) at (x, d).
  ridgeH(x, d, central = false) {
    const W = this.world, sd = this.sd;
    const dEnd = this.endless ? Infinity : W.dEnd;
    const dMin = this.endless ? -64 : -70;
    const dc = d < dMin ? dMin : d > dEnd ? dEnd : d;
    const q = d < dMin ? dMin - d : d > dEnd ? d - dEnd : 0;
    const X = Math.abs(x);
    let y;
    if (X <= 100) y = W.groundY(x, dc);
    else {
      const side = x < 0 ? 0 : 1;
      const base = W.baseY(dc);
      const b100 = W.groundY(side ? 100 : -100, dc) - base;
      const cr = b100 + 55 + 120 * fbm1(dc * 0.0052 + side * 31.7, sd + side * 5);
      const xc = 200 + 70 * fbm1(dc * 0.0041 + 9.3 + side * 17.1, sd + 3);
      let rel;
      if (X <= xc) { const u = (X - 100) / (xc - 100); rel = b100 + (cr - b100) * u * (1.7 - 0.7 * u); }
      else { const u = clamp((X - xc) / (440 - xc), 0, 1); rel = cr * (1 - 0.74 * u * u * (3 - 2 * u)); }
      const w = smooth(100, 175, X);
      rel += w * (62 * ridged(noise2(X * 0.045 + side * 50, dc * 0.036, sd + 9)) + 26 * ridged(noise2(X * 0.1 + 3, dc * 0.085, sd + 21)) - 44);
      const floor = b100 * 0.85 + (X - 100) * 0.15;
      if (rel < floor) rel = floor;
      y = base + rel;
    }
    if (q > 0) {
      const which = d < 0 ? 0 : 1;
      const env = smooth(110, 330, q) * (1 - 0.65 * smooth(330, 480, q));
      const nz = noise2(x * 0.011 + which * 7.1, q * 0.011, sd + 31);
      const lat = 1 - 0.35 * smooth(250, 430, X);
      const jag = (ridged(noise2(x * 0.04 + 5, q * 0.04 + which * 11, sd + 41)) - 0.5) * 90;
      y += Math.max(0, env * ((105 + 160 * nz) * lat + jag));
    }
    // Hide the seam under the terrain mesh edge.
    if (X <= (this.endless ? 100.01 : 80.01)) {
      if (central && d > dMin + 0.01 && d < dEnd - 0.01) y -= 3;
      else y -= 0.5 * (1 - smooth(0, 32, q));
    }
    return y;
  }

  // Height of whatever is drawn at (x, d): terrain mesh inside |x| <= 80, my heightfield outside.
  surfaceY(x, d) {
    const W = this.world;
    if (Math.abs(x) <= 100 && d >= (this.endless ? -64 : -70) && d <= (this.endless ? Infinity : W.dEnd)) return W.groundY(x, d);
    return this.ridgeH(x, d, false);
  }

  buildRidges() {
    const W = this.world, th = this.theme;
    const dEnd = W.dEnd;
    const acc = new Accum(1 << 15);
    const rock = new THREE.Color(th.rock), rockDark = new THREE.Color(th.rock).multiplyScalar(0.7);
    const rockLight = new THREE.Color(th.rock).lerp(new THREE.Color(0xffffff), 0.22);
    const snow = new THREE.Color(th.snow), snowShade = new THREE.Color(th.snow).lerp(new THREE.Color(th.horizon), 0.28);
    const hor = new THREE.Color(th.horizon);
    const sd = this.sd;
    const tmp = new THREE.Color();

    const faceColor = (ny, cx, cy, cd, hz) => {
      const X = Math.abs(cx);
      const rel = cy - W.baseY(clamp(cd, -70, dEnd));
      const edge = 1.3 * (1 - smooth(80, 160, X));
      const score = (ny - 0.45) * 2.4 + (rel - 150) / 130 + edge + (hz - 0.5) * 0.6;
      if (score > 0) tmp.copy(snow).lerp(snowShade, hz * 0.5);
      else tmp.copy(rockDark).lerp(rockLight, clamp(0.2 + ny * 0.7 + hz * 0.4, 0, 1));
      tmp.lerp(hor, smooth(180, 440, X) * 0.4);
      return tmp;
    };

    const grid = (xs, ds, central) => {
      const nx = xs.length, nd = ds.length;
      const Y = new Float32Array(nx * nd);
      for (let i = 0; i < nd; i++) for (let j = 0; j < nx; j++) Y[i * nx + j] = this.ridgeH(xs[j], ds[i], central);
      const cache = new THREE.Color();
      const emit = (ax, ay, ad, bx, by, bd, cx, cy, cd) => {
        const az = -ad, bz = -bd, cz = -cd;
        const nxv = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const nyv = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nzv = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const l = Math.hypot(nxv, nyv, nzv) || 1;
        const hz = hash2(Math.round((ax + bx + cx) * 3), Math.round((ad + bd + cd) * 3), sd);
        const col = faceColor(nyv / l, (ax + bx + cx) / 3, (ay + by + cy) / 3, (ad + bd + cd) / 3, hz);
        cache.copy(col);
        acc.tri(ax, ay, az, bx, by, bz, cx, cy, cz, cache);
      };
      for (let i = 0; i < nd - 1; i++) {
        for (let j = 0; j < nx - 1; j++) {
          const x0 = xs[j], x1 = xs[j + 1], d0 = ds[i], d1 = ds[i + 1];
          const ya = Y[i * nx + j], yb = Y[i * nx + j + 1], yc = Y[(i + 1) * nx + j], yd = Y[(i + 1) * nx + j + 1];
          if ((i + j) & 1) {
            emit(x0, ya, d0, x1, yb, d0, x1, yd, d1);
            emit(x0, ya, d0, x1, yd, d1, x0, yc, d1);
          } else {
            emit(x0, ya, d0, x1, yb, d0, x0, yc, d1);
            emit(x1, yb, d0, x1, yd, d1, x0, yc, d1);
          }
        }
      }
    };

    const outerR = [80, 90, 100, 118, 140, 168, 200, 236, 276, 322, 374, 430];
    const outerL = outerR.map((v) => -v).reverse();
    const central = [-80, -60, -40, -20, 0, 20, 40, 60, 80];
    // Side strips along the whole valley.
    const rows = [];
    for (let d = -70; d < dEnd; d += 14) rows.push(d);
    rows.push(dEnd);
    grid(outerL, rows, false);
    grid(outerR, rows, false);
    // End wall (behind the town) and summit (behind the start): central part + two outer parts per end.
    const Q = [];
    for (let q = 16; q <= 480; q += 16) Q.push(q);
    const endRows = [dEnd, ...Q.map((q) => dEnd + q)];
    grid(central, [dEnd - 6, ...endRows], true);
    grid(outerL, endRows, false);
    grid(outerR, endRows, false);
    const sumRows = [...Q.map((q) => -70 - q).reverse(), -70];
    grid(central, [...sumRows, -64], true);
    grid(outerL, sumRows, false);
    grid(outerR, sumRows, false);

    const geo = acc.build(true);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.ridges = new THREE.Mesh(geo, mat);
    this.ridges.frustumCulled = false;
    this.group.add(this.ridges);
  }

  // ---------------------------------------------------------------- endless ridges (chunks) + summit

  initEndlessRidges() {
    this.ridgeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.ridgeChunks = new Map();
    this.ridgeCol = {
      rock: new THREE.Color(this.theme.rock), rockDark: new THREE.Color(this.theme.rock).multiplyScalar(0.7),
      rockLight: new THREE.Color(this.theme.rock).lerp(new THREE.Color(0xffffff), 0.22),
      snow: new THREE.Color(this.theme.snow), snowShade: new THREE.Color(this.theme.snow).lerp(new THREE.Color(this.theme.horizon), 0.28),
      hor: new THREE.Color(this.theme.horizon), tmp: new THREE.Color(),
    };
    this.ridgeTransN = 0;
    this.ridgeNear = [-80, -60, -40, -20, 0, 20, 40, 60, 80];
    this.ridgeOuterR = [96, 100, 118, 140, 168, 200, 236, 276, 322, 374, 430];
    this.ridgeOuterL = this.ridgeOuterR.map((v) => -v).reverse();
    this.updateEndlessRidges({ d: 0 }, true);
    // the summit behind the start
    const acc = new Accum(1 << 14);
    const Q = [];
    for (let q = 16; q <= 480; q += 16) Q.push(q);
    const sumRows = [...Q.map((q) => -64 - q).reverse(), -64];
    this.ridgeGrid(acc, this.ridgeNear, [...sumRows, -58], true);
    this.ridgeGrid(acc, this.ridgeOuterL, sumRows, false);
    this.ridgeGrid(acc, this.ridgeOuterR, sumRows, false);
    this.summit = new THREE.Mesh(acc.build(true), this.ridgeMat);
    this.summit.frustumCulled = false;
    this.group.add(this.summit);
  }

  ridgeFaceColor(ny, cx, cy, cd, hz) {
    const W = this.world, K = this.ridgeCol;
    const X = Math.abs(cx);
    const rel = cy - W.baseY(Math.max(-64, cd));
    const edge = 1.3 * (1 - smooth(80, 160, X));
    const score = (ny - 0.45) * 2.4 + (rel - 150) / 130 + edge + (hz - 0.5) * 0.6;
    const tmp = K.tmp;
    if (score > 0) tmp.copy(K.snow).lerp(K.snowShade, hz * 0.5);
    else tmp.copy(K.rockDark).lerp(K.rockLight, clamp(0.2 + ny * 0.7 + hz * 0.4, 0, 1));
    tmp.lerp(K.hor, smooth(180, 440, X) * 0.4);
    return tmp;
  }

  ridgeGrid(acc, xs, ds, central) {
    const nx = xs.length, nd = ds.length;
    const Y = new Float32Array(nx * nd);
    for (let i = 0; i < nd; i++) for (let j = 0; j < nx; j++) Y[i * nx + j] = this.ridgeH(xs[j], ds[i], central);
    const sd = this.sd;
    const cache = new THREE.Color();
    const emit = (ax, ay, ad, bx, by, bd, cx, cy, cd) => {
      const az = -ad, bz = -bd, cz = -cd;
      const nxv = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const nyv = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nzv = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const l = Math.hypot(nxv, nyv, nzv) || 1;
      const hz = hash2(Math.round((ax + bx + cx) * 3), Math.round((ad + bd + cd) * 3), sd);
      cache.copy(this.ridgeFaceColor(nyv / l, (ax + bx + cx) / 3, (ay + by + cy) / 3, (ad + bd + cd) / 3, hz));
      acc.tri(ax, ay, az, bx, by, bz, cx, cy, cz, cache);
    };
    for (let i = 0; i < nd - 1; i++) {
      for (let j = 0; j < nx - 1; j++) {
        const x0 = xs[j], x1 = xs[j + 1], d0 = ds[i], d1 = ds[i + 1];
        const ya = Y[i * nx + j], yb = Y[i * nx + j + 1], yc = Y[(i + 1) * nx + j], yd = Y[(i + 1) * nx + j + 1];
        if ((i + j) & 1) {
          emit(x0, ya, d0, x1, yb, d0, x1, yd, d1);
          emit(x0, ya, d0, x1, yd, d1, x0, yc, d1);
        } else {
          emit(x0, ya, d0, x1, yb, d0, x0, yc, d1);
          emit(x1, yb, d0, x1, yd, d1, x0, yc, d1);
        }
      }
    }
  }

  buildRidgeChunk(k) {
    const CHK = 112;
    const d0 = k * CHK;
    const rows = [];
    for (let d = d0; d < d0 + CHK; d += 14) rows.push(d);
    rows.push(d0 + CHK);
    const acc = new Accum(1 << 12);
    this.ridgeGrid(acc, this.ridgeOuterL, rows, false);
    this.ridgeGrid(acc, this.ridgeOuterR, rows, false);
    const mesh = new THREE.Mesh(acc.build(true), this.ridgeMat);   // (frustum culled: the chunks behind the camera cost no draw call)
    this.group.add(mesh);
    return mesh;
  }

  updateEndlessRidges(ball, all = false) {
    const CHK = 112;
    // The slope widened (tier-up): the terrain behind the new width changed shape, so every ridge chunk that reaches past the
    // start of the widening is rebuilt (one per frame, nearest first) instead of standing as a wall beside the new bank.
    const W = this.world, tn = W.trans ? W.trans.length : 0;
    if (tn !== this.ridgeTransN) {
      this.ridgeTransN = tn;
      const last = tn ? W.trans[tn - 1] : null;
      if (last) {
        const stale = last.d0 - 80;
        for (const [k, mesh] of this.ridgeChunks) {
          if ((k + 1) * CHK > stale) { this.group.remove(mesh); mesh.geometry.dispose(); this.ridgeChunks.delete(k); }
        }
      }
    }
    const fog = this.scene.fog, reach = fog ? Math.min(520, fog.far + 60) : 520;   // (a ridge past the fog's far plane is the horizon colour: no chunk there)
    const kMin = Math.max(-1, Math.floor((ball.d - 160) / CHK)), kMax = Math.floor((ball.d + reach) / CHK);
    for (const [k, mesh] of this.ridgeChunks) {
      if (k < kMin - 1 || k > kMax + 1) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.ridgeChunks.delete(k);
      }
    }
    let budget = all ? 99 : 1;
    for (let k = kMin; k <= kMax && budget > 0; k++) {
      if (this.ridgeChunks.has(k)) continue;
      this.ridgeChunks.set(k, this.buildRidgeChunk(k));
      budget--;
    }
  }

  // ---------------------------------------------------------------- gates (spec) and banners

  planGates() {
    const W = this.world;
    const mk = (kind, d, clear, bannerH, band) => {
      const hw = W.halfWidth(d);
      const inner = hw + clear;
      const base = W.baseY(d);
      const bottom = base + 33.5; // banner bottom (>= 30 m above any corridor ground, with margin)
      return {
        kind, d, inner, postW: 3.4, depth: 3.2, hw, base,
        bannerW: inner * 2, bannerH, bannerBottom: bottom, bannerTop: bottom + bannerH,
        beamBottomY: base + 32.6, topBeamTop: bottom + bannerH + 2.4, postTop: bottom + bannerH + 4.2,
        band, // 0 = start band (top of the canvas), 1 = arch band (bottom)
      };
    };
    // Start gate close to the ball, town arch just before the first houses. The arch is wide enough for a ball radius 15.
    const startW = mk('start', -4, 2.2, 8, 0);
    const archD = W.townStart - 10;
    const arch = mk('arch', archD, 8, 16, 1);
    this.gates = [startW, arch];
  }

  gateGeo(a, g) {
    const W = this.world, p = this.pal;
    for (const s of [-1, 1]) {
      const xc = s * (g.inner + g.postW / 2);
      const yb = W.groundY(xc, g.d) - 1.3;
      const stripeA = s < 0 ? p.orange : p.blue;
      // plinth
      a.box(xc, yb + 1.7, -g.d, g.postW / 2 + 0.9, 1.7, g.depth / 2 + 0.9, 0, p.stone);
      a.box(xc, yb + 3.5, -g.d, g.postW / 2 + 1.0, 0.2, g.depth / 2 + 1.0, 0, p.snow);
      // candy-striped shaft
      const y0 = yb + 3.4, y1 = g.postTop - 1.6;
      const n = Math.max(2, Math.round((y1 - y0) / 4));
      const h = (y1 - y0) / n;
      for (let i = 0; i < n; i++) a.box(xc, y0 + h * (i + 0.5), -g.d, g.postW / 2, h / 2, g.depth / 2, 0, i & 1 ? p.white : stripeA);
      // cap
      a.box(xc, g.postTop - 0.8, -g.d, g.postW / 2 + 0.6, 0.8, g.depth / 2 + 0.6, 0, p.ink);
      a.box(xc, g.postTop + 0.15, -g.d, g.postW / 2 + 0.7, 0.2, g.depth / 2 + 0.7, 0, p.snow);
    }
  }

  // Cross beams + banner frame (go into the fading banner mesh, not into the solid decor mesh).
  beamGeo(a, g) {
    const p = this.pal;
    const xo = g.inner + g.postW;
    a.box(0, g.beamBottomY + 0.45, -g.d, xo, 0.45, 1.1, 0, p.ink);
    a.box(0, g.topBeamTop - 1.2, -g.d, xo, 1.2, 1.3, 0, p.ink);
    a.box(0, g.topBeamTop + 0.1, -g.d, xo, 0.2, 1.4, 0, p.snow);
    a.box(0, g.beamBottomY + 1.0, -g.d, xo - 0.3, 0.12, 1.2, 0, g.kind === 'start' ? p.orange : p.blue);
    for (const s of [-1, 1]) a.box(s * g.inner, (g.bannerBottom + g.bannerTop) / 2, -g.d, 0.4, g.bannerH / 2 + 0.2, 0.9, 0, p.ink);
  }

  buildBanners() {
    const tex = bannerTexture();
    this.bannerTex = tex;
    const a = new Accum(1024);
    const uv = [];
    const UW = (BANNER_W + 12) / 1024;      // a white texel
    const UMAX = BANNER_W / 1024;
    const p = this.pal;
    for (const g of this.gates) {
      const n0 = a.n;
      this.beamGeo(a, g);
      for (let i = a.n - n0; i > 0; i--) uv.push(UW, 0.5);
      const x0 = -g.inner, x1 = g.inner, y0 = g.bannerBottom, y1 = g.bannerTop;
      const v0 = g.band === 0 ? 0.5 : 0.0, v1 = v0 + 0.5;
      const zf = -g.d + 0.75, zb = -g.d - 0.75;
      const c = tex ? p.white : g.kind === 'start' ? p.orange : p.blue;
      // front (+z): BL BR TR TL
      const f = [[x0, y0, zf, 0, v0], [x1, y0, zf, UMAX, v0], [x1, y1, zf, UMAX, v1], [x0, y1, zf, 0, v1]];
      // back (-z): as seen from behind, mirrored uv so the text reads correctly
      const b = [[x1, y0, zb, 0, v0], [x0, y0, zb, UMAX, v0], [x0, y1, zb, UMAX, v1], [x1, y1, zb, 0, v1]];
      for (const q of [f, b]) {
        for (const k of [0, 1, 2, 0, 2, 3]) {
          a.grow(1);
          a.vert(q[k][0], q[k][1], q[k][2], c);
          uv.push(q[k][3], q[k][4]);
        }
      }
    }
    const geo = a.build(true);
    // banner faces: flat normals from computeVertexNormals() already point to +z / -z
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true, map: tex || null, emissive: 0x262626, transparent: true, opacity: 1,
    });
    this.banners = new THREE.Mesh(geo, mat);
    this.banners.frustumCulled = false;
    this.group.add(this.banners);
  }

  // The camera sits high above a big ball and flies through the town arch: fade the beams/banner out when it gets close.
  updateGates(camera) {
    let op = 1;
    const cp = camera.position;
    for (const g of this.gates) {
      const dz = Math.abs(cp.z + g.d);
      if (cp.y > g.beamBottomY - 22 && cp.y < g.postTop + 22) op = Math.min(op, smooth(16, 52, dz));
    }
    const m = this.banners.material;
    if (Math.abs(m.opacity - op) > 0.004) m.opacity = op;
    this.banners.visible = op > 0.02;
  }

  // ---------------------------------------------------------------- bank decoration (one merged mesh, windowed)

  footprint(cx, cd, ang, hx, hz) {
    const c = Math.cos(ang), s = Math.sin(ang);
    let mn = Infinity, mx = -Infinity;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const lx = a * hx, lz = b * hz;
        const wx = cx + lx * c + lz * s, wz = -cd + (-lx * s + lz * c);
        const y = this.surfaceY(wx, -wz);
        if (y < mn) mn = y;
        if (y > mx) mx = y;
      }
    }
    return { min: mn, max: mx };
  }

  clearOfStatics(x, d, r) {
    const W = this.world, pad = r + 9;
    const st = W.statics;
    let i = W.lowerBound(d - pad);
    for (; i < st.length; i++) {
      const p = st[i];
      if (p.d > d + pad) break;
      if (!p.alive) continue;
      if (Math.hypot(p.x - x, p.d - d) < p.r * 0.7 + r) return false;
    }
    return true;
  }

  // Best-of-N spot beside the track: flat-ish, clear of the world's own scenery, never closer than hw + 6.
  findSpot(d, rad, hx, hz, tries) {
    const W = this.world, rng = this.rng;
    const offMin = 6.5 + rad, offMax = offMin + 24;
    let best = null, bestScore = 1e9;
    for (let k = 0; k < tries; k++) {
      const side = rng.sign();
      const dd = d + rng.range(-24, 24);
      const hw = W.halfWidth(dd);
      const x = side * (hw + rng.range(offMin, offMax));
      if (Math.abs(x) > 96 - rad * 0.3) continue;
      const ang = -side * Math.PI / 2 + rng.range(-0.22, 0.22);
      const fp = this.footprint(x, dd, ang, hx, hz);
      if (!this.clearOfStatics(x, dd, rad)) continue;
      const score = fp.max - fp.min;
      if (score < bestScore) { bestScore = score; best = { x, d: dd, ang, side, min: fp.min, max: fp.max }; }
    }
    return best;
  }

  buildDecor() {
    const W = this.world, lib = this.lib, rng = this.rng, p = this.pal;
    const L = W.L, dEnd = W.dEnd;
    const items = [];
    const push = (d, fn) => items.push({ d, fn });

    // gates
    for (const g of this.gates) push(g.d, (a) => this.gateGeo(a, g));
    // frozen lake on the flat ground just behind the town (the duck lives here)
    push(this.lake.d, (a) => this.lakeGeo(a));

    // chalets and kiosks, sitting on stone plinths so nothing floats on the slope
    const stone = p.stone, stone2 = new THREE.Color(0x8a8f98);
    const place = (def, spacing, d0, d1, sc0, sc1, hxM, hzM, plHx, plHz, plCol, rad0) => {
      if (!def) return;
      for (let d = d0 + spacing * 0.5; d < d1; d += spacing * rng.range(0.8, 1.2)) {
        const sc = lerp(sc0, sc1, clamp(d / L, 0, 1));
        const spot = this.findSpot(d, rad0 * sc, hxM * sc, hzM * sc, 14);
        if (!spot) continue;
        const tint = [rng.range(0.88, 1.12), rng.range(0.9, 1.08), rng.range(0.85, 1.12)];
        const y = spot.min + (spot.max - spot.min) * 0.25 - 0.05;
        const yb = spot.min - 0.8;
        push(spot.d, (a) => {
          _p3.set(spot.x, y, -spot.d); _q4.setFromAxisAngle(UP, spot.ang); _s3.setScalar(sc);
          _m4.compose(_p3, _q4, _s3);
          a.geo(def.geometry, _m4, tint);
          const top = y + 0.25 * sc;
          a.box(spot.x, (yb + top) / 2, -spot.d, plHx * sc, (top - yb) / 2, plHz * sc, spot.ang, plCol);
        });
      }
    };
    place(lib.cabin, 78, 50, W.townEnd + 50, 0.95, 1.9, 5.3, 4.8, 4.2, 3.7, stone, 6.2);
    place(lib.kiosk, 130, 85, W.townEnd + 40, 1.2, 2.2, 2.2, 2.1, 1.8, 1.6, stone2, 3.8);

    // fence runs along the foot of the banks
    const nRuns = 6 + Math.round(L / 220);
    for (let r = 0; r < nRuns; r++) {
      const d = rng.range(70, W.townEnd);
      const side = rng.sign();
      const off = rng.range(7.5, 11);
      const sc = lerp(1.3, 2.8, clamp(d / L, 0, 1));
      const segs = rng.int(4, 7);
      const segLen = 2.0 * sc;
      const pts = [];
      let ok = true;
      for (let i = 0; i <= segs; i++) {
        const dd = d + i * segLen;
        const x = side * (W.halfWidth(dd) + off);
        if (!this.clearOfStatics(x, dd, 1.4)) { ok = false; break; }
        pts.push([x, this.surfaceY(x, dd) - 0.15, -dd]);
      }
      if (!ok) continue;
      push(d + segs * segLen * 0.5, (a) => {
        const wood = new THREE.Color(0xb5793f), post = new THREE.Color(0x8a5a2e);
        for (let i = 0; i <= segs; i++) {
          const q = pts[i];
          a.box(q[0], q[1] + 0.5 * sc, q[2], 0.07 * sc, 0.5 * sc, 0.07 * sc, 0, post);
          a.box(q[0], q[1] + 1.04 * sc, q[2], 0.1 * sc, 0.04 * sc, 0.1 * sc, 0, p.white);
          if (i < segs) {
            const n = pts[i + 1];
            for (const hgt of [0.35, 0.72]) a.beam(q[0], q[1] + hgt * sc, q[2], n[0], n[1] + hgt * sc, n[2], 0.1 * sc, wood);
            a.beam(q[0], q[1] + 0.8 * sc, q[2], n[0], n[1] + 0.8 * sc, n[2], 0.05 * sc, p.white);
          }
        }
      });
    }

    // pine groves on the far banks
    const greens = [new THREE.Color(0x1b8048), new THREE.Color(0x219555), new THREE.Color(0x29aa62), new THREE.Color(0x17703f)];
    const tip = new THREE.Color(0xe6f1fb);
    for (const side of [-1, 1]) {
      for (let d = -45; d < dEnd + 40; d += rng.range(8, 15)) {
        const cluster = rng.int(1, 2);
        for (let c = 0; c < cluster; c++) {
          const dd = d + rng.range(-5, 5);
          const hw = W.halfWidth(dd);
          const x = side * Math.min(hw + rng.range(40, 78), 99);
          const s = rng.range(1.0, 2.3) * (1 + 0.5 * clamp(dd / L, 0, 1));
          const g1 = greens[rng.int(0, greens.length - 1)];
          const y = Math.min(this.surfaceY(x - 1.5 * s, dd), this.surfaceY(x + 1.5 * s, dd), this.surfaceY(x, dd - 1.5 * s), this.surfaceY(x, dd + 1.5 * s)) - 0.1;
          const rot = rng.next() * 3;
          push(dd, (a) => {
            const z = -dd;
            a.cone(x, y + 0.2 * s, z, 1.7 * s, 2.5 * s, 5, rot, g1, tip);
            a.cone(x, y + 1.5 * s, z, 1.25 * s, 2.2 * s, 5, rot + 0.4, g1, tip);
            a.cone(x, y + 2.6 * s, z, 0.85 * s, 1.9 * s, 5, rot + 0.8, g1, tip);
          });
        }
      }
    }

    // ski lift: pylons + cables (static); chairs are a separate InstancedMesh
    this.planLift(push);

    // merge in d order so a draw-range window can pick a contiguous slice
    items.sort((x, y) => x.d - y.d);
    const acc = new Accum(1 << 16);
    const n = items.length;
    this.decorD = new Float32Array(n);
    this.decorV = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.decorD[i] = items[i].d;
      this.decorV[i] = acc.n;
      items[i].fn(acc);
    }
    this.decorV[n] = acc.n;
    const geo = acc.build(true);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.decor = new THREE.Mesh(geo, mat);
    this.decor.frustumCulled = false;
    this.group.add(this.decor);
    this.decorWin0 = -1; this.decorWin1 = -1;
    this.updateDecorWindow({ d: 0, r: 1 });
  }

  lowerBoundD(d) {
    const a = this.decorD;
    let lo = 0, hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] < d) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  updateDecorWindow(ball) {
    const k = 1 + ball.r * 0.4;
    const i0 = this.lowerBoundD(ball.d - 110 - 7 * ball.r);
    const i1 = this.lowerBoundD(ball.d + 340 + 14 * ball.r + k);
    if (i0 === this.decorWin0 && i1 === this.decorWin1) return;
    this.decorWin0 = i0; this.decorWin1 = i1;
    const v0 = this.decorV[i0], v1 = this.decorV[i1];
    this.decor.geometry.setDrawRange(v0, v1 - v0);
  }

  // ---------------------------------------------------------------- ski lift

  planLift(push) {
    const W = this.world, rng = this.rng, lib = this.lib, p = this.pal;
    const L = W.L;
    this.lift = null;
    if (!lib.lift_pylon) return;
    const d0 = rng.range(70, 140);
    const d1 = Math.min(L - 30, d0 + 560);
    if (d1 - d0 < 160) return;
    const side = rng.sign();
    const S = 1.6; // pylon scale
    const nSpan = Math.round((d1 - d0) / 40);
    const spacing = (d1 - d0) / nSpan;
    const cableLX = 2.7 * S, cableY = 11.45 * S;
    const px = [], pd = [], py = [], pa = [];
    for (let i = 0; i <= nSpan; i++) {
      const d = d0 + i * spacing;
      // try a few offsets so the footprint is clear of the world's own trees
      let best = 12, bestScore = 1e9;
      for (const off of [12, 11, 13, 10.5, 14]) {
        const x = side * (W.halfWidth(d) + off);
        const sc = this.clearOfStatics(x, d, 3.2) ? 0 : 1;
        if (sc < bestScore) { bestScore = sc; best = off; if (sc === 0) break; }
      }
      const x = side * (W.halfWidth(d) + best);
      px.push(x); pd.push(d);
      py.push(Math.min(this.surfaceY(x - 1.1 * S, d), this.surfaceY(x + 1.1 * S, d), this.surfaceY(x, d - 1.0 * S), this.surfaceY(x, d + 1.0 * S)) - 0.35);
    }
    for (let i = 0; i <= nSpan; i++) {
      const a = Math.max(0, i - 1), b = Math.min(nSpan, i + 1);
      pa.push(Math.atan2(-(px[b] - px[a]), pd[b] - pd[a]));
    }
    // cable nodes: 4 per span, two cables (0 = inner / uphill-going, 1 = outer / downhill-going)
    const SUB = 4;
    const nodes = nSpan * SUB + 1;
    const cx = [new Float32Array(nodes), new Float32Array(nodes)];
    const cy = [new Float32Array(nodes), new Float32Array(nodes)];
    const cd = [new Float32Array(nodes), new Float32Array(nodes)];
    for (let k = 0; k < 2; k++) {
      const lx = (k === 0 ? -side : side) * cableLX;
      const anchors = [];
      for (let i = 0; i <= nSpan; i++) {
        const c = Math.cos(pa[i]), s = Math.sin(pa[i]);
        anchors.push([px[i] + lx * c, py[i] + cableY, pd[i] + lx * s]);
      }
      for (let i = 0; i < nSpan; i++) {
        for (let m = 0; m < SUB; m++) {
          const u = m / SUB, j = i * SUB + m;
          cx[k][j] = lerp(anchors[i][0], anchors[i + 1][0], u);
          cy[k][j] = lerp(anchors[i][1], anchors[i + 1][1], u) - 0.55 * 4 * u * (1 - u) * (spacing / 40);
          cd[k][j] = lerp(anchors[i][2], anchors[i + 1][2], u);
        }
      }
      const last = nodes - 1;
      cx[k][last] = anchors[nSpan][0]; cy[k][last] = anchors[nSpan][1]; cd[k][last] = anchors[nSpan][2];
    }
    this.lift = { side, d0, d1, spacing, nodes, SUB, cx, cy, cd, len: 0, S };
    // path length along d for chair placement
    this.lift.len = cd[0][nodes - 1] - cd[0][0];

    const cable = new THREE.Color(0x2c323d);
    // pylons + terminal huts
    for (let i = 0; i <= nSpan; i++) {
      const terminal = i === 0 || i === nSpan;
      push(pd[i], (a) => {
        _p3.set(px[i], py[i], -pd[i]); _q4.setFromAxisAngle(UP, pa[i]); _s3.setScalar(terminal ? S * 1.15 : S);
        _m4.compose(_p3, _q4, _s3);
        a.geo(lib.lift_pylon.geometry, _m4, null);
        if (terminal) {
          // terminal hut just beyond the pylon, along the cable line
          const hx = 5.6, hz = 4.8, hh = 6.2;
          const hd = pd[i] + (i === 0 ? -9 : 9);
          const fp = this.footprint(px[i], hd, pa[i], hx, hz);
          const y0 = fp.min + (fp.max - fp.min) * 0.3;
          a.box(px[i], (fp.min - 0.9 + y0 + 0.3) / 2, -hd, hx - 0.2, (y0 + 0.3 - fp.min + 0.9) / 2, hz - 0.2, pa[i], p.stone);
          a.box(px[i], y0 + hh / 2, -hd, hx, hh / 2, hz, pa[i], p.wood);
          a.box(px[i], y0 + hh + 0.5, -hd, hx + 0.9, 0.5, hz + 0.9, pa[i], p.red);
          a.box(px[i], y0 + hh + 1.15, -hd, hx + 0.6, 0.2, hz + 0.6, pa[i], p.snow);
        }
      });
    }
    // cables (per span so they live in the right draw-range slice)
    for (let i = 0; i < nSpan; i++) {
      push(pd[i] + spacing / 2, (a) => {
        for (let k = 0; k < 2; k++) {
          for (let m = 0; m < SUB; m++) {
            const j = i * SUB + m;
            a.beam(cx[k][j], cy[k][j], -cd[k][j], cx[k][j + 1], cy[k][j + 1], -cd[k][j + 1], 0.32, cable);
          }
        }
      });
    }
  }

  buildChairs() {
    const L = this.lift;
    if (!L) return;
    const a = new Accum(512);
    const dark = new THREE.Color(0x2c323d);
    const white = new THREE.Color(0xffffff);
    a.box(0, -1.05, 0, 0.06, 1.05, 0.06, 0, dark);
    a.box(0, -2.2, 0, 0.85, 0.09, 0.5, 0, white);
    a.box(0, -1.75, -0.45, 0.85, 0.5, 0.07, 0, white);
    a.box(0, -2.6, 0.5, 0.8, 0.04, 0.04, 0, dark);
    a.box(-0.8, -2.4, 0.35, 0.04, 0.2, 0.04, 0, dark);
    a.box(0.8, -2.4, 0.35, 0.04, 0.2, 0.04, 0, dark);
    const geo = a.build(true);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const per = Math.max(4, Math.floor(Math.abs(L.len) / 34));
    this.chairPer = per;
    this.chairs = new THREE.InstancedMesh(geo, mat, per * 2);
    this.chairs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chairs.frustumCulled = false;
    const cols = [new THREE.Color(0xe84a3a), new THREE.Color(0x2f7dff), new THREE.Color(0xff9a2f), new THREE.Color(0xffd23f)];
    for (let i = 0; i < per * 2; i++) this.chairs.setColorAt(i, cols[i % cols.length]);
    this.group.add(this.chairs);
    this.updateChairs(0, { d: 0 });
  }

  updateChairs(t, ball) {
    const L = this.lift;
    if (!L) return;
    const inView = ball.d > L.d0 - 420 && ball.d < L.d1 + 200;
    this.chairs.visible = inView;
    if (!inView) return;
    const len = Math.abs(L.len), per = this.chairPer, gap = len / per;
    const nodeStep = L.spacing / L.SUB;
    const speed = 5.5;
    const yaw = -L.side * Math.PI / 2;
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < per; i++) {
        // k = 0 climbs (towards smaller d), k = 1 descends
        let u = (i * gap + speed * t) % len;
        const pos = k === 0 ? len - u : u;
        const f = pos / nodeStep;
        let j = Math.floor(f);
        if (j >= L.nodes - 1) j = L.nodes - 2;
        if (j < 0) j = 0;
        const fr = f - j;
        const x = lerp(L.cx[k][j], L.cx[k][j + 1], fr);
        const y = lerp(L.cy[k][j], L.cy[k][j + 1], fr) + 0.1 * Math.sin(t * 1.7 + i * 1.3 + k);
        const d = lerp(L.cd[k][j], L.cd[k][j + 1], fr);
        // chairs shrink into the terminals
        const e = Math.min(pos, len - pos);
        const sc = L.S * smooth(0, 9, e);
        _p3.set(x, y, -d);
        _e3.set(Math.sin(t * 1.3 + i) * 0.05, yaw, Math.sin(t * 1.1 + i * 2 + k) * 0.05, 'YXZ');
        _q4.setFromEuler(_e3);
        _s3.setScalar(Math.max(0.001, sc));
        _m4.compose(_p3, _q4, _s3);
        this.chairs.setMatrixAt(k * per + i, _m4);
      }
    }
    this.chairs.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- flags

  buildFlags() {
    const W = this.world;
    const a = new Accum(64);
    const white = new THREE.Color(1, 1, 1), pole = new THREE.Color(0.9, 0.92, 0.95);
    a.box(0, 2, 0, 0.07, 2, 0.07, 0, pole);
    const tip = [2.1, 3.5, 0], t0 = [0.07, 3.95, 0], t1 = [0.07, 3.0, 0];
    a.tri(t0[0], t0[1], t0[2], t1[0], t1[1], t1[2], tip[0], tip[1], tip[2], white);
    a.tri(t0[0], t0[1], t0[2], tip[0], tip[1], tip[2], t1[0], t1[1], t1[2], white);
    const geo = a.build(true);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const list = [];
    // along the piste edge, alternating sides
    let k = 0;
    for (let d = 28; d < W.L + 6; d += 21, k++) {
      const side = k & 1 ? 1 : -1;
      const x = side * (W.halfWidth(d) + 2.4);
      const sc = lerp(1.3, 3.2, clamp(d / W.L, 0, 1));
      list.push({ x, y: this.surfaceY(x, d) - 0.1, d, s: sc, side, col: k % 3 === 0 ? 0xffffff : k % 3 === 1 ? 0xff6a2a : 0x2f7dff });
    }
    // big flags on the gate posts
    for (const g of this.gates) {
      for (const s of [-1, 1]) {
        const x = s * (g.inner + g.postW / 2);
        list.push({ x, y: g.postTop + 0.3, d: g.d, s: g.kind === 'arch' ? 6 : 4.5, side: s, col: s < 0 ? 0xff6a2a : 0x2f7dff });
      }
    }
    this.flagList = list;
    this.flags = new THREE.InstancedMesh(geo, mat, list.length);
    this.flags.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flags.frustumCulled = false;
    const c = new THREE.Color();
    list.forEach((f, i) => { this.flags.setColorAt(i, c.set(f.col)); });
    this.group.add(this.flags);
    this.updateFlags(0);
  }

  updateFlags(t) {
    const list = this.flagList;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const base = f.side > 0 ? 0 : Math.PI;
      const yaw = base + 0.42 * Math.sin(t * 3.1 + i * 1.7) * (f.side > 0 ? 1 : -1) + 0.12 * Math.sin(t * 7.3 + i);
      _p3.set(f.x, f.y, -f.d);
      _e3.set(0, yaw, 0.1 * Math.sin(t * 5.2 + i * 0.9), 'YXZ');
      _q4.setFromEuler(_e3);
      _s3.setScalar(f.s);
      _m4.compose(_p3, _q4, _s3);
      this.flags.setMatrixAt(i, _m4);
    }
    this.flags.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- birds

  buildBirds() {
    const th = this.theme;
    if (!th.birds) return;
    const a = new Accum(16);
    const c = new THREE.Color(0x2c3a52);
    const nose = [0, 0, 0.8], tail = [0, 0, -0.55], wl = [-2.4, 0.5, -0.2], wr = [2.4, 0.5, -0.2];
    a.tri(nose[0], nose[1], nose[2], wl[0], wl[1], wl[2], tail[0], tail[1], tail[2], c);
    a.tri(nose[0], nose[1], nose[2], tail[0], tail[1], tail[2], wr[0], wr[1], wr[2], c);
    const geo = a.build(true);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
    this.birdN = 9;
    this.birds = new THREE.InstancedMesh(geo, mat, this.birdN);
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birds.frustumCulled = false;
    this.birdC = { x: 0, d: 0, y: 0, ok: false };
    this.birdRng = makeRng(this.seed ^ 0xb12d);
    this.group.add(this.birds);
  }

  updateBirds(t, ball) {
    if (!this.birds) return;
    const W = this.world, B = this.birdC, r = this.birdRng;
    const k = 1 + ball.r * 0.17;
    if (!B.ok || B.d < ball.d - 90 * k) {
      B.ok = true;
      B.d = ball.d + (250 + r.next() * 170) * k;
      B.x = (r.next() - 0.5) * 120 * k;
      B.y = W.baseY(clamp(B.d, -70, Number.isFinite(W.dEnd) ? W.dEnd + 300 : 1e9)) + (45 + r.next() * 40) * k;
    }
    const R = 48 * k, w = 0.24;
    for (let i = 0; i < this.birdN; i++) {
      const a = w * t + i * 0.33;
      const x = B.x + R * Math.cos(a) * (1 + 0.06 * i), dd = B.d + R * Math.sin(a) * (1 + 0.06 * i);
      const y = B.y + Math.sin(t * 0.7 + i) * 3 * k;
      // heading = tangent, in world (x, z = -d)
      const hx = -Math.sin(a), hz = -Math.cos(a);
      _p3.set(x, y, -dd);
      _e3.set(0, Math.atan2(hx, hz), 0, 'YXZ');
      _q4.setFromEuler(_e3);
      const flap = 0.25 + 0.75 * Math.abs(Math.sin(t * 5.5 + i * 1.9));
      _s3.set(1.1 * k, 1.1 * k * flap, 1.1 * k); // ~5 m wingspan; bigger read as dark shards
      _m4.compose(_p3, _q4, _s3);
      this.birds.setMatrixAt(i, _m4);
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- easter eggs
  // 'snowman' (waves when you pass), 'duck' (giant rubber duck on the frozen lake behind the town), 'nasreddin' (1 in 4
  // worlds, rides a donkey backwards along a bank), 'ufo' (night theme, abducts a cow / snowman), 'yeti3am' (03:00-03:59).
  // All the actors live in ONE dynamic vertex-coloured mesh (+ one additive beam mesh for the UFO).

  planLake() {
    const W = this.world;
    const lr = makeRng(this.seed ^ 0x1a4e);
    const d = W.townEnd + 70; // the ball ends at most ~townEnd+28 (surface ~+43), the duck must be within 60 m of it
    this.lake = { x: lr.range(-5, 5), d, rx: 24, rd: 20, y: W.baseY(d) + 0.2 };
  }

  lakeGeo(a) {
    const L = this.lake, seg = 30;
    const iceC = new THREE.Color(0xb4eaf8), iceE = new THREE.Color(0x8fd3ea), rim = new THREE.Color(0xf4f8ff);
    const ring = (scale, y, cIn, cOut) => {
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * TAU, a1 = ((k + 1) / seg) * TAU;
        a.triOut(L.x, y, -L.d,
          L.x + L.rx * scale * Math.cos(a0), y, -L.d + L.rd * scale * Math.sin(a0),
          L.x + L.rx * scale * Math.cos(a1), y, -L.d + L.rd * scale * Math.sin(a1),
          L.x, y - 1, -L.d, cIn, cOut, cOut);
      }
    };
    ring(1.16, L.y - 0.09, rim, rim);
    ring(1, L.y, iceC, iceE);
  }

  fire(id) {
    if (this.eggFound.has(id)) return;
    this.eggFound.add(id);
    if (this.onEgg) {
      try { this.onEgg(id); } catch (e) { /* a broken callback must never break the frame */ }
    }
  }

  // Best-of-N roadside spot: flat-ish, clear of the world's own props, always outside the corridor (off >= 7 m).
  eggSpot(er, dMin, dMax, offMin, offMax, rad, tries) {
    const W = this.world;
    let best = null, bestScore = 1e9;
    for (let k = 0; k < tries; k++) {
      const d = er.range(dMin, dMax), side = er.sign(), off = er.range(offMin, offMax);
      const x = side * (W.halfWidth(d) + off);
      const fp = this.footprint(x, d, -side * Math.PI / 2, rad * 0.55, rad * 0.55);
      const score = (fp.max - fp.min) + (this.clearOfStatics(x, d, rad) ? 0 : 50);
      if (score < bestScore) { bestScore = score; best = { x, d, side, off, min: fp.min }; }
    }
    return best;
  }

  buildEggs() {
    const W = this.world, lib = this.lib, th = this.theme, force = this.eggOpts.force;
    const AB = new Accum(8192);
    const E = this.eggs;
    const L = W.L;

    // snowman that waves when the ball passes (always present)
    {
      const er = makeRng(this.seed ^ 0x534e4f57);
      const S = 2.4;
      const sp = this.eggSpot(er, L * 0.16, L * 0.3, 7, 8.6, 2.6, 24);
      const armSign = sp.side > 0 ? 1 : -1;
      const parts = buildWaveSnowman(AB, S, armSign);
      const root = new THREE.Matrix4().compose(new THREE.Vector3(sp.x, sp.min - 0.1, -sp.d), new THREE.Quaternion().setFromAxisAngle(UP, -sp.side * Math.PI / 2), new THREE.Vector3(1, 1, 1));
      E.snowman = { id: 'snowman', x: sp.x, d: sp.d, root, body: parts.body, arm: parts.arm, px: parts.px, py: parts.py, armSign, wave: 0, last: -9 };
    }

    // giant rubber duck on the frozen lake behind the town
    {
      const k = this.lake;
      E.duck = { id: 'duck', x: k.x, d: k.d, y: k.y, part: buildDuck(AB, 7), yaw0: 0.18 };
    }

    // Nasreddin Hoca on his donkey (about 1 in 4 worlds, deterministic by seed)
    if (force.includes('nasreddin') || makeRng(this.seed ^ 0x4e61).next() < 0.25) {
      const er = makeRng(this.seed ^ 0x4e617372);
      const S = 2.5, len = 48, off = er.range(7.8, 9.4);
      let best = null, bestScore = 1e9;
      for (let k = 0; k < 40; k++) {
        const d0 = er.range(L / 3 + 4, L * 2 / 3 - len - 4), side = er.sign();
        let score = 0;
        for (let q = 0; q <= 4; q++) {
          const dd = d0 + (len * q) / 4;
          if (!this.clearOfStatics(side * (W.halfWidth(dd) + off), dd, 3.2)) score += 10;
        }
        if (score < bestScore) { bestScore = score; best = { d0, side }; }
      }
      const rig = buildNasreddin(AB, S);
      E.nasreddin = {
        id: 'nasreddin', s: S, side: best.side, off, d0: best.d0, len, speed: 1.0, gait: 3.2, u0: er.range(0, len * 2),
        psi: Math.PI, x: 0, d: best.d0, body: rig.body, legs: rig.legs,
      };
    }

    // UFO over the bank (night theme only): saucer + additive tractor beam + the abducted cow / snowman
    if (th.ufo || force.includes('ufo')) {
      const er = makeRng(this.seed ^ 0x55464f);
      const sp = this.eggSpot(er, L * 0.4, L * 0.62, 12.5, 14, 3, 12);
      const S = 7;
      const saucer = buildSaucer(AB, S), cow = buildCow(AB, 2.2), mini = buildMiniSnowman(AB, 1.9);
      E.ufo = {
        id: 'ufo', x0: sp.x, d0: sp.d, x: sp.x, d: sp.d, gy0: this.surfaceY(sp.x, sp.d), S, saucer, cow, mini,
        off: er.range(0, 28), ph: er.range(0, 6),
      };
      this.makeBeam();
    }

    // dancing yeti at the start, only between 03:00 and 03:59 local time
    if (lib.yeti && (this.eggOpts.hour === 3 || force.includes('yeti3am'))) {
      _mB.makeScale(3, 3, 3);
      const part = makePart(AB, () => AB.geo(lib.yeti.geometry, _mB, null));
      const x = 6, d = 24; // right of the start line, inside the menu camera's view (it sits ~9 m behind the ball)
      E.yeti3am = { id: 'yeti3am', x, d, gy: W.groundY(x, d), part };
    }

    const geo = AB.build(false);
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(AB.n * 3), 3)); // flat shading ignores it
    this.actorPos = geo.attributes.position;
    this.actorPos.setUsage(THREE.DynamicDrawUsage);
    this.actorOut = this.actorPos.array;
    this.actors = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.actors.frustumCulled = false;
    this.group.add(this.actors);

    // initial poses
    writePart(this.actorOut, E.snowman.body, E.snowman.root);
    this.stepSnowman(E.snowman, 0, 0);
    this.stepDuck(E.duck, 0);
    if (E.nasreddin) this.stepNasreddin(E.nasreddin, 0, 0);
    if (E.ufo) this.stepUfo(E.ufo, 0);
    if (E.yeti3am) this.stepYeti(E.yeti3am, 0);
  }

  makeBeam() {
    const seg = 16, pos = [], c4 = [];
    const cone = (rTop, rBot, aTop, aBot, r, g, b) => {
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * TAU, a1 = ((k + 1) / seg) * TAU;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const t0 = [rTop * c0, 0, rTop * s0], t1 = [rTop * c1, 0, rTop * s1], b0 = [rBot * c0, -1, rBot * s0], b1 = [rBot * c1, -1, rBot * s1];
        for (const [p, a] of [[t0, aTop], [b0, aBot], [b1, aBot], [t0, aTop], [b1, aBot], [t1, aTop]]) { pos.push(p[0], p[1], p[2]); c4.push(r, g, b, a); }
      }
    };
    cone(2.2, 7.5, 0.5, 0.12, 0.45, 1.0, 0.6);
    cone(0.9, 3.2, 0.45, 0.2, 0.75, 1.0, 0.85);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c4, 4));
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    });
    this.beam = new THREE.Mesh(g, m);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 5;
    this.group.add(this.beam);
  }

  stepNasreddin(n, t, dt) {
    const W = this.world;
    const len2 = 2 * n.len;
    const u = (t * n.speed + n.u0) % len2;
    let d, target;
    if (u < n.len) { d = n.d0 + u; target = Math.PI; } else { d = n.d0 + len2 - u; target = 0; }
    let diff = target - n.psi;
    diff -= Math.round(diff / TAU) * TAU;
    n.psi += dt > 0 ? diff * Math.min(1, dt * 2.5) : diff;
    const x = n.side * (W.halfWidth(d) + n.off);
    const hx = Math.sin(n.psi), hz = Math.cos(n.psi), k = 1.1 * n.s;
    const yF = this.surfaceY(x + hx * k, d - hz * k), yB = this.surfaceY(x - hx * k, d + hz * k);
    n.x = x; n.d = d;
    const ph = t * n.gait;
    const bob = Math.abs(Math.sin(ph)) * 0.05 * n.s;
    frameMatrix(_mA, x, (yF + yB) / 2 + bob - 0.06 * n.s, -d, hx * 2 * k, yF - yB, hz * 2 * k, 1);
    _mB.makeRotationZ(Math.sin(ph * 0.5) * 0.04);
    _mC.multiplyMatrices(_mA, _mB);
    writePart(this.actorOut, n.body, _mC);
    for (let i = 0; i < 4; i++) {
      const lg = n.legs[i];
      pivRotX(_mB, Math.sin(ph + lg.ph) * 0.5, lg.py, lg.pz);
      _mD.multiplyMatrices(_mA, _mB);
      writePart(this.actorOut, lg.part, _mD);
    }
  }

  stepSnowman(s, t, dt) {
    if (s.wave > 0) s.wave = Math.max(0, s.wave - dt);
    const a = s.wave > 0 ? (0.75 + 0.5 * Math.sin(t * 9)) * smooth(0, 0.5, s.wave) : 0;
    if (a === s.last) return false;
    s.last = a;
    pivRotZ(_mB, a * s.armSign, s.px, s.py);
    _mC.multiplyMatrices(s.root, _mB);
    writePart(this.actorOut, s.arm, _mC);
    return true;
  }

  stepDuck(k, t) {
    const ph = (t % 4.5) / 4.5;
    const sq = ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0; // squeak: a quick squash
    const bob = 0.25 + 0.25 * Math.sin(t * 1.3);
    _e3.set(Math.sin(t * 0.9) * 0.02, k.yaw0 + Math.sin(t * 0.55) * 0.14, Math.sin(t * 1.1) * 0.04, 'YXZ');
    _q4.setFromEuler(_e3);
    _s3.set(1 + 0.07 * sq, 1 - 0.12 * sq, 1 + 0.07 * sq);
    _mA.compose(_p3.set(k.x, k.y + bob, -k.d), _q4, _s3);
    writePart(this.actorOut, k.part, _mA);
  }

  placeAbductee(part, on, x, y, d, spin, sc, roll) {
    _e3.set(0, spin, roll, 'YXZ');
    _q4.setFromEuler(_e3);
    const k = on ? sc : 0.0001;
    _mA.compose(_p3.set(x, y, -d), _q4, _s3.set(k, k, k));
    writePart(this.actorOut, part, _mA);
  }

  stepUfo(u, t) {
    const ux = u.x0 + Math.sin(t * 0.13 + u.ph) * 2, ud = u.d0 + Math.sin(t * 0.09 + u.ph * 1.7) * 12;
    u.x = ux; u.d = ud;
    const uy = u.gy0 + 31 + Math.sin(t * 0.7) * 1.2;
    _e3.set(Math.sin(t * 0.9) * 0.07, t * 0.7, Math.sin(t * 0.8 + 1) * 0.07, 'YXZ');
    _q4.setFromEuler(_e3);
    _mA.compose(_p3.set(ux, uy, -ud), _q4, _s3.set(1, 1, 1));
    writePart(this.actorOut, u.saucer, _mA);
    const gy = this.surfaceY(ux, ud);
    const top = uy - 0.28 * u.S;
    this.beam.position.set(ux, top, -ud);
    this.beam.scale.set(1, Math.max(6, top - gy), 1);
    this.beam.material.opacity = 0.8 + 0.2 * Math.sin(t * 2.6);
    // every 28 s: a cow, then a snowman, floats up the beam and shrinks into the saucer
    const T = 28, tt = t + u.off, ph = tt % T, cyc = Math.floor(tt / T);
    const act = ph > 7 && ph < 19;
    const w = act ? (ph - 7) / 12 : 0, e = w * w * (3 - 2 * w);
    const yy = gy + e * (top - gy - 3.5);
    const spin = t * 2.2 + e * 4, roll = Math.sin(t * 5) * 0.35 * e;
    this.placeAbductee(u.cow, act && (cyc & 1) === 0, ux, yy, ud, spin, lerp(1, 0.45, e), roll);
    this.placeAbductee(u.mini, act && (cyc & 1) === 1, ux, yy, ud, spin, lerp(1, 0.45, e), roll);
  }

  stepYeti(y, t) {
    const hop = Math.abs(Math.sin(t * 4.6));
    const wob = Math.sin(t * 9.2);
    _e3.set(0, t * 2.4, wob * 0.16, 'YXZ');
    _q4.setFromEuler(_e3);
    _mA.compose(_p3.set(y.x, y.gy + hop * 2.4, -y.d), _q4, _s3.set(1 - 0.03 * wob, 1 + 0.05 * wob, 1 - 0.03 * wob));
    writePart(this.actorOut, y.part, _mA);
  }

  updateEggs(dt, camera, ball) {
    const E = this.eggs;
    if (!this.actors) return;
    const t = this.t, bd = ball.d;
    let dirty = false;
    const n = E.nasreddin;
    if (n && bd > n.d0 - (320 + 14 * ball.r) && bd < n.d0 + n.len + 160) {
      this.stepNasreddin(n, t, dt);
      dirty = true;
      if (Math.hypot(ball.x - n.x, bd - n.d) - ball.r < 10) this.fire('nasreddin');
    }
    const sn = E.snowman;
    if (bd > sn.d - (320 + 14 * ball.r) && bd < sn.d + 160) {
      if (Math.hypot(ball.x - sn.x, bd - sn.d) - ball.r < 8) { this.fire('snowman'); sn.wave = 3.2; }
      if (this.stepSnowman(sn, t, dt)) dirty = true;
    }
    const u = E.ufo;
    if (u) {
      const near = bd > u.d0 - (520 + 14 * ball.r) && bd < u.d0 + 260;
      this.beam.visible = near;
      if (near) {
        this.stepUfo(u, t);
        dirty = true;
        if (Math.hypot(ball.x - u.x, bd - u.d) - ball.r < 18) this.fire('ufo');
      }
    }
    const k = E.duck;
    if (bd > k.d - (360 + 14 * ball.r)) {
      this.stepDuck(k, t);
      dirty = true;
      const cp = camera.position;
      if (Math.hypot(ball.x - k.x, bd - k.d) < 60 || Math.hypot(cp.x - k.x, cp.y - (k.y + 7), cp.z + k.d) < 60) this.fire('duck');
    }
    const y = E.yeti3am;
    if (y) {
      if (bd < 320) { this.stepYeti(y, t); dirty = true; }
      if (t > 1.5) this.fire('yeti3am');
    }
    if (dirty) this.actorPos.needsUpdate = true;
  }

  // ---------------------------------------------------------------- per-frame

  // Optional quality knob (0..1), e.g. from main.js's adaptive resolution: scales the snowflake count.
  setDetail(f) {
    if (!this.snow) return;
    const th = this.theme;
    this.snowN = Math.floor(lerp(120, 800, clamp(th.snowfall, 0, 1)) * lerp(0.4, 1, clamp(f, 0, 1)));
    this.snow.geometry.setDrawRange(0, this.snowN);
  }

  update(dt, camera, ball) {
    if (this.disposed) return;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    const b = this.ballState;
    b.x = ball.x || 0; b.d = ball.d || 0; b.y = ball.y || 0; b.r = ball.r > 0 ? ball.r : 1;
    ball = b;
    this.t += dt;
    const t = this.t;
    this.sky.position.copy(camera.position);
    if (this.stars) {
      const col = this.starColor.array, base = this.starBase, ph = this.starPh;
      const n = ph.length;
      for (let q = 0; q < 48; q++) {
        const i = (this.starCursor + q) % n;
        const f = 0.65 + 0.35 * Math.sin(t * 2.2 + ph[i] * 3);
        col[i * 3] = base[i * 3] * f; col[i * 3 + 1] = base[i * 3 + 1] * f; col[i * 3 + 2] = base[i * 3 + 2] * f;
      }
      this.starCursor = (this.starCursor + 48) % n;
      this.starColor.needsUpdate = true;
    }
    if (this.aurora) this.updateAurora(t);
    if (this.snow) this.updateSnow(dt, camera, ball);
    if (this.clouds) this.updateClouds(dt, ball);
    if (this.endless) {
      this.updateEndlessRidges(ball);
      this.updateBirds(t, ball);
      return;
    }
    this.updateGates(camera);
    this.updateDecorWindow(ball);
    this.updateFlags(t);
    this.updateChairs(t, ball);
    this.updateBirds(t, ball);
    this.updateEggs(dt, camera, ball);
  }

  // ---------------------------------------------------------------- stats / cleanup

  computeInfo() {
    let calls = 0, tris = 0;
    this.group.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isSprite || o.isLine) {
        calls++;
        if (o.isMesh) {
          const g = o.geometry;
          const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
          tris += per * (o.isInstancedMesh ? o.count : 1);
        }
      }
    });
    this.info = { drawCalls: calls, triangles: Math.round(tris) };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (m.map) m.map.dispose();
          if (m.emissiveMap) m.emissiveMap.dispose();
          m.dispose();
        }
      }
      if (o.isInstancedMesh) o.dispose();
    });
    this.hemi.dispose?.();
    this.sun.dispose?.();
    this.group.clear();
  }
}
