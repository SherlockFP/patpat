// cigplus.js — ÇIĞ SONSUZ: the rules (CigGame) and the extra fun on the slope (CigPlus).
//
// CigGame  : the endless-avalanche rules. Steering follower, speed (heavier = faster), VISIBLE SUCTION (edible props
//            fly into the ball over 0.15-0.35 s and then stick), size tiers (YENİ BÖLGE), hunger/melt, bumps that
//            scatter re-collectable snow, size gates, golden snowballs, the avalanche wave that punishes stalling,
//            the pinned-ball safety net and a scripted bot used by the debug hooks and the balance sims.
//            It never touches the DOM: everything visible goes through the `host` callbacks main.js provides.
// CigPlus  : on-slope pickups (magnet, giant, rocket, shield, freeze, rainbow + the golden snowball), bouncy mushrooms,
//            flip kickers (inert: no flying), enemy snowballs and the snowman army — planned INCREMENTALLY as
//            the world streams in. Draw calls: 1 dynamic solid mesh + 1 dynamic translucent mesh.
//            (Slides, portals and the invert gate are gone: they stole food and mirrored the controls.)
//
// Coordinates follow world.js: downhill distance `d` grows forward, world z = -d.
import * as THREE from 'three';
import { CFG, tierOf, bandAt, bandRel, LABEL } from './config.js';
import { makeRng } from './rng.js';
import { patchMaterial } from './shaders.js';

// input activity clock for the AFK melt (any pointer/touch/key event counts)
let lastInputAt = performance.now();
if (typeof window !== 'undefined') for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'keydown']) window.addEventListener(ev, () => { lastInputAt = performance.now(); }, { passive: true, capture: true });
import { MOVE_ARMY, MOVE_NONE, clamp } from './world.js';
import { RAMP_AIR_K } from './cigplan.js';

const TAU = Math.PI * 2;
const MOM_T = 7;   // seconds of clean rolling for full momentum (+35% top speed)
const sm01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export const POWERS = {
  magnet: { name: 'MIKNATIS', icon: '🧲', color: 0xff4455, dur: 8 },
  giant: { name: 'DEV MANTAR', icon: '🍄', color: 0x45e06f, dur: 8 },
  rocket: { name: 'ROKET', icon: '🚀', color: 0xff9226, dur: 4 },
  shield: { name: 'KALKAN', icon: '🛡️', color: 0x44a6ff, dur: 25 },
  freeze: { name: 'SOĞUK DALGA', icon: '🧊', color: 0x8eeaff, dur: 8 },
  rainbow: { name: 'GÖKKUŞAĞI', icon: '🌈', color: 0xff5fd2, dur: 8 },
};
const KEYS = Object.keys(POWERS);
const PICK_STYLE = { ...POWERS, golden: { name: 'ALTIN KARTOPU', icon: '🌟', color: 0xffc928, dur: 0 } };

// Launch option objects (preallocated: hooks read them synchronously).
const OPT_FLIP = { flip: true };
const OPT_BOUNCE = { bounce: true };

const SLIDE_PAL = [0xff4d5e, 0xffc83a, 0x3ddc84, 0x3fa7ff, 0xb066ff];

// ---------------------------------------------------------------------------
// Build-time mesh helpers (allocation is fine here)
// ---------------------------------------------------------------------------
const colCache = new Map();
const _tc = new THREE.Color();
function C(hex, a = 1) {
  const key = hex + ':' + a;
  let c = colCache.get(key);
  if (!c) { _tc.setHex(hex); c = { r: _tc.r, g: _tc.g, b: _tc.b, a }; colCache.set(key, c); }
  return c;
}
const toC = (x) => (typeof x === 'number' ? C(x) : x);

class Mesher {
  constructor() {
    this.p = []; this.c = [];
    this.m = new THREE.Matrix4(); this.id = true;
    this._v = new THREE.Vector3(); this._t = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._q = new THREE.Quaternion();
  }
  at(x, y, z, o = {}) {
    this._e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    this._q.setFromEuler(this._e);
    this._s.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1);
    this.m.compose(this._t.set(x, y, z), this._q, this._s);
    this.id = false;
    return this;
  }
  reset() { this.m.identity(); this.id = true; return this; }
  v(x, y, z, c) {
    this._v.set(x, y, z);
    if (!this.id) this._v.applyMatrix4(this.m);
    this.p.push(this._v.x, this._v.y, this._v.z);
    this.c.push(c.r, c.g, c.b, c.a);
  }
  tri(a, b, c, ca, cb = ca, cc = ca) {
    this.v(a[0], a[1], a[2], ca); this.v(b[0], b[1], b[2], cb); this.v(c[0], c[1], c[2], cc);
    return this;
  }
  quad(a, b, c, d, ca, cb = ca, cc = ca, cd = ca) {
    this.tri(a, b, c, ca, cb, cc); this.tri(a, c, d, ca, cc, cd);
    return this;
  }
  box(sx, sy, sz, col) {
    const c = toC(col), x = sx / 2, y = sy / 2, z = sz / 2;
    const P = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
    const F = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
    for (const f of F) this.quad(P[f[0]], P[f[1]], P[f[2]], P[f[3]], c);
    return this;
  }
  // Surface of revolution around Y. prof = [[r, y], ...]; cf(j, i) -> colour for profile segment j, slice i.
  lathe(prof, seg, cf) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      for (let j = 0; j < prof.length - 1; j++) {
        const [r0, y0] = prof[j], [r1, y1] = prof[j + 1];
        const col = toC(typeof cf === 'function' ? cf(j, i) : cf);
        this.quad([r0 * c0, y0, r0 * s0], [r0 * c1, y0, r0 * s1], [r1 * c1, y1, r1 * s1], [r1 * c0, y1, r1 * s0], col);
      }
    }
    return this;
  }
  // Torus in the XY plane (axis = Z). cf(i) -> colour of segment i.
  torus(R, rr, segs, tube, cf, arc = TAU, a0 = 0) {
    const pt = (a, t) => [(R + rr * Math.cos(t)) * Math.cos(a), (R + rr * Math.cos(t)) * Math.sin(a), rr * Math.sin(t)];
    for (let i = 0; i < segs; i++) {
      const A0 = a0 + (i / segs) * arc, A1 = a0 + ((i + 1) / segs) * arc;
      const col = toC(typeof cf === 'function' ? cf(i) : cf);
      for (let k = 0; k < tube; k++) {
        const T0 = (k / tube) * TAU, T1 = ((k + 1) / tube) * TAU;
        this.quad(pt(A0, T0), pt(A1, T0), pt(A1, T1), pt(A0, T1), col);
      }
    }
    return this;
  }
  template() {
    return { pos: new Float32Array(this.p), col: new Float32Array(this.c), n: this.p.length / 3 };
  }
}

function profAt(prof, r) { // prof is ordered rim -> centre (r decreasing)
  for (let j = 0; j < prof.length - 1; j++) {
    const [r0, y0] = prof[j], [r1, y1] = prof[j + 1];
    if (r <= r0 && r >= r1) {
      const t = r0 === r1 ? 0 : (r0 - r) / (r0 - r1);
      return { y: y0 + (y1 - y0) * t, slope: (y1 - y0) / (r1 - r0) };
    }
  }
  return { y: prof[prof.length - 1][1], slope: 0 };
}
// Flat spot painted on a dome (oriented along the surface).
function domeSpot(m, prof, r, az, size, col, lift = 0.02) {
  const { y, slope } = profAt(prof, r);
  const tilt = Math.atan(-slope); // surface rises toward the centre, normal leans outward
  m.at(Math.cos(az) * r, y + lift, -Math.sin(az) * r, { ry: az, rz: -tilt });
  m.lathe([[0, 0], [size, 0]], 7, col);
  m.reset();
}

const PAD_PROF = []; // parabola dome, rim -> centre: y = 1 - r^2 (matches the physical lift exactly)
for (let i = 0; i <= 10; i++) { const r = 1 - i / 10; PAD_PROF.push([r, 1 - r * r]); }

function buildTemplates() {
  const T = {};
  const mk = (fn) => { const m = new Mesher(); fn(m); return m.template(); };

  T.magnet = mk((m) => {
    m.at(0, 0.05, 0).torus(0.62, 0.2, 12, 5, (i) => (i < 6 ? 0xff3b4a : 0x3b82ff), Math.PI, 0).reset();
    for (const s of [-1, 1]) {
      m.at(s * 0.62, -0.28, 0).box(0.42, 0.62, 0.42, s < 0 ? 0x3b82ff : 0xff3b4a).reset();
      m.at(s * 0.62, -0.5, 0).box(0.44, 0.2, 0.44, 0xf4f7ff).reset();
    }
  });
  T.giant = mk((m) => {
    m.lathe([[0, -0.8], [0.28, -0.8], [0.24, 0.05], [0, 0.05]], 8, 0xfff0cf);
    const cap = [[0.92, 0.0], [0.82, 0.3], [0.6, 0.52], [0.32, 0.66], [0, 0.72]];
    m.at(0, 0.0, 0).lathe(cap, 10, (j, i) => (i % 2 ? 0x37d067 : 0x2cc05a)).reset();
    domeSpot(m, cap, 0.42, 0.5, 0.17, 0xffffff);
    domeSpot(m, cap, 0.62, 2.2, 0.15, 0xffffff);
    domeSpot(m, cap, 0.6, 4.0, 0.16, 0xffffff);
    domeSpot(m, cap, 0.2, 3.1, 0.12, 0xffffff);
  });
  T.rocket = mk((m) => {
    m.lathe([[0.0, -0.85], [0.3, -0.85], [0.36, -0.3], [0.32, 0.3], [0, 0.95]], 8, (j) => (j === 3 ? 0xff3b4a : j === 0 ? 0x4b5568 : 0xf4f7ff));
    for (let a = 0; a < 3; a++) {
      m.at(0, 0, 0, { ry: (a / 3) * TAU });
      m.tri([0.3, -0.25, 0], [0.78, -0.95, 0], [0.3, -0.85, 0], C(0xff3b4a));
      m.reset();
    }
    m.at(0, 0.12, 0.33).lathe([[0, 0], [0.13, 0]], 7, 0x3b82ff).reset();
    m.lathe([[0.24, -0.85], [0.0, -1.45]], 8, (j, i) => (i % 2 ? 0xffb02e : 0xff6a1f));
  });
  T.shield = mk((m) => {
    m.at(0, 0, 0, { rx: Math.PI / 2 }).lathe([[0, 0.1], [0.85, 0.1], [0.85, -0.1], [0, -0.1]], 6, (j) => (j === 0 ? 0x2f86ff : j === 1 ? 0xdfe8f7 : 0x1a4fa8)).reset();
    m.at(0, 0, 0, { rx: Math.PI / 2 }).lathe([[0, 0.17], [0.52, 0.17], [0.52, 0.1]], 6, (j) => (j === 0 ? 0xffd24a : 0xd8a21f)).reset();
  });
  T.freeze = mk((m) => {
    const cf = (j) => (j === 0 ? 0x7fe6ff : 0xeaffff);
    const bi = [[0, -1], [0.26, 0], [0, 1]];
    m.lathe(bi, 5, cf);
    m.at(0, 0, 0, { rz: Math.PI / 2 }).lathe(bi, 5, cf).reset();
    m.at(0, 0, 0, { rx: Math.PI / 2 }).lathe(bi, 5, cf).reset();
    m.at(0, 0, 0, { rz: Math.PI / 4, s: 0.75 }).lathe(bi, 4, cf).reset();
    m.at(0, 0, 0, { rz: -Math.PI / 4, s: 0.75 }).lathe(bi, 4, cf).reset();
  });
  T.rainbow = mk((m) => {
    const bands = [0xff3b3b, 0xff9a2a, 0xffe03a, 0x3ddc6a, 0x3b9bff, 0x9a5cff];
    bands.forEach((c, k) => m.at(0, -0.3, 0).torus(1 - k * 0.12, 0.075, 12, 4, c, Math.PI, 0).reset());
    const cloud = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1]];
    for (const s of [-1, 1]) m.at(s * 0.9, -0.3, 0, { sx: 0.28, sy: 0.2, sz: 0.28 }).lathe(cloud, 6, 0xffffff).reset();
  });
  // Golden snowball: a fat gold sphere with a lighter band and a little crown of sparkles.
  T.golden = mk((m) => {
    const sph = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1]];
    m.lathe(sph, 12, (j, i) => (i % 2 ? 0xffd54a : 0xffbf1f));
    m.at(0, 0, 0, { sx: 1.04, sy: 0.16, sz: 1.04 }).lathe(sph, 12, 0xfff3b0).reset();
    for (let a = 0; a < 5; a++) {
      const an = (a / 5) * TAU;
      m.at(Math.cos(an) * 0.5, 1.05, Math.sin(an) * 0.5, { s: 0.16 }).lathe([[0, -1], [0.5, 0], [0, 1]], 4, 0xffffff).reset();
    }
  });
  T.shot = mk((m) => m.lathe([[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1]], 6, (j, i) => (i % 2 ? 0xe4f2ff : 0xbcdcff)));
  // Bouncy mushroom pad: unit dome, radius 1, height 1.
  T.pad = mk((m) => {
    m.lathe(PAD_PROF, 12, (j, i) => (i % 2 ? 0xe5283b : 0xcf1f33));
    m.at(0, 0, 0).lathe([[1.02, 0.0], [1.02, -0.18], [0.85, -0.3]], 12, 0xfff0d8).reset();
    const spots = [[0.36, 0.2, 0.2], [0.6, 1.5, 0.16], [0.7, 2.7, 0.19], [0.42, 3.8, 0.15], [0.8, 4.7, 0.17], [0.22, 5.5, 0.13], [0.62, 6.0, 0.14]];
    for (const [r, az, sz] of spots) domeSpot(m, PAD_PROF, r, az, sz, 0xffffff, 0.03);
  });
  T.ringS = mk((m) => m.torus(1, 0.06, 20, 4, 0xffffff));
  // Translucent glow shapes (alpha baked into vertex colours).
  T.ring = mk((m) => m.torus(1, 0.075, 20, 3, C(0xffffff, 0.9)));
  T.beam = mk((m) => {
    const n = 6, cb = C(0xffffff, 0.6), ct = C(0xffffff, 0);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
      m.quad([Math.cos(a0), 0, Math.sin(a0)], [Math.cos(a1), 0, Math.sin(a1)], [Math.cos(a1), 1, Math.sin(a1)], [Math.cos(a0), 1, Math.sin(a0)], cb, cb, ct, ct);
    }
  });
  T.ice = mk((m) => m.lathe([[0, -1], [0.9, 0], [0, 1]], 4, C(0xffffff, 0.55)));
  T.sphere = mk((m) => m.lathe([[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1]], 8, C(0xffffff, 0.22)));
  // ÇIĞ DAĞLAR: speed strip segment (unit quad, chevron pointing downhill = -z), flat glow lane, cannon, ice bridge segment
  T.strip = mk((m) => {
    m.quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], C(0x2b7bff));
    m.quad([-0.5, 0.02, -0.5], [-0.42, 0.02, -0.5], [-0.42, 0.02, 0.5], [-0.5, 0.02, 0.5], C(0xffe03a));
    m.quad([0.42, 0.02, -0.5], [0.5, 0.02, -0.5], [0.5, 0.02, 0.5], [0.42, 0.02, 0.5], C(0xffe03a));
    m.tri([0, 0.03, -0.42], [-0.34, 0.03, 0.08], [0.34, 0.03, 0.08], C(0xffffff));
    m.tri([0, 0.04, -0.2], [-0.2, 0.04, 0.08], [0.2, 0.04, 0.08], C(0x2b7bff));
  });
  T.disc = mk((m) => { for (let k = 0; k < 14; k++) { const a0 = (k / 14) * TAU, a1 = ((k + 1) / 14) * TAU; m.tri([0, 0, 0], [Math.cos(a0), 0, Math.sin(a0)], [Math.cos(a1), 0, Math.sin(a1)], C(0xffffff, 1)); } });
  T.lane = mk((m) => m.quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], C(0xffffff, 1)));
  T.cannon = mk((m) => {
    m.box(1.7, 0.9, 1.7, 0x4a525e);
    m.at(0, 0.62, 0, { rz: Math.PI / 2 }).lathe([[0.34, -1.0], [0.34, 0.9], [0.44, 1.1], [0.14, 1.1]], 8, (j) => (j === 2 ? 0x1d222b : 0x2f3748)).reset();
    m.at(0, 0.0, 0).box(2.0, 0.3, 2.0, 0xff5a4a).reset();
  });
  return T;
}

// ---------------------------------------------------------------------------
// Dynamic mesh: templates are transformed into preallocated buffers every frame.
// Transform order: p = T + Ry * Rx * Rz * S * v
// ---------------------------------------------------------------------------
class DynMesh {
  constructor(maxV, comps, material) {
    this.max = maxV; this.cs = comps; this.n = 0;
    this.pos = new Float32Array(maxV * 3);
    this.col = new Float32Array(maxV * comps);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, comps).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa);
    g.setAttribute('color', this.ca);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = comps === 4 ? 5 : 0;
  }
  begin() { this.n = 0; }
  emit(tpl, x, y, z, ry, sx, sy, sz, rx, rz, cr, cg, cb, ca) {
    const n = tpl.n;
    if (this.n + n > this.max) return;
    const cy = Math.cos(ry), sy_ = Math.sin(ry), cx = Math.cos(rx), sx_ = Math.sin(rx), cz = Math.cos(rz), sz_ = Math.sin(rz);
    const tp = tpl.pos, tc = tpl.col, pos = this.pos, col = this.col, cs = this.cs;
    let o = this.n * 3, q = this.n * cs;
    for (let i = 0, k = 0, h = 0; i < n; i++, k += 3, h += 4) {
      const px = tp[k] * sx, py = tp[k + 1] * sy, pz = tp[k + 2] * sz;
      const x1 = px * cz - py * sz_, y1 = px * sz_ + py * cz;
      const y2 = y1 * cx - pz * sx_, z2 = y1 * sx_ + pz * cx;
      pos[o] = x1 * cy + z2 * sy_ + x; pos[o + 1] = y2 + y; pos[o + 2] = -x1 * sy_ + z2 * cy + z;
      o += 3;
      col[q] = tc[h] * cr; col[q + 1] = tc[h + 1] * cg; col[q + 2] = tc[h + 2] * cb;
      if (cs === 4) col[q + 3] = tc[h + 3] * ca;
      q += cs;
    }
    this.n += n;
  }
  end() {
    this.geo.setDrawRange(0, this.n);
    const n = this.n;
    this.pa.clearUpdateRanges(); this.pa.addUpdateRange(0, Math.max(1, n) * 3); this.pa.needsUpdate = true;
    this.ca.clearUpdateRanges(); this.ca.addUpdateRange(0, Math.max(1, n) * this.cs); this.ca.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mesh.material.dispose(); }
}

const _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _u0 = new THREE.Vector3();
const _wup = new THREE.Vector3(0, 1, 0);
// Barrel-roll the camera 360° (angle in radians) around its own view axis, then the caller does lookAt.
// Sets camera.up only; call it right before camera.lookAt(target). angle 0 restores the normal up vector.
export function flipCamera(camera, target, angle) {
  if (Math.abs(angle) < 1e-4) { camera.up.set(0, 1, 0); return; }
  _fw.copy(target).sub(camera.position);
  if (_fw.lengthSq() < 1e-8) return;
  _fw.normalize();
  _rt.crossVectors(_fw, _wup);
  if (_rt.lengthSq() < 1e-8) _rt.set(1, 0, 0);
  _rt.normalize();
  _u0.crossVectors(_rt, _fw); // un-rolled up
  const c = Math.cos(angle), s = Math.sin(angle);
  camera.up.set(_u0.x * c + _rt.x * s, _u0.y * c + _rt.y * s, _u0.z * c + _rt.z * s);
}

const ICON_TILT = { rocket: 0.7, magnet: 0, giant: 0, shield: 0, freeze: 0, rainbow: 0, golden: 0 };

// ===========================================================================
// CigPlus — extras on the slope
// ===========================================================================
export class CigPlus {
  // opts: { seed, lib, ui (buffAdd/buffTick/buffRemove when present), hud (built-in buff chips, only without ui) }
  constructor(scene, world, { seed = 1, lib = null, ui = null, hud = true, level = null } = {}) {
    this.L = level || null;   // ÇIĞ DAĞLAR plan (null = the endless slope)
    this.scene = scene;
    this.world = world;
    this.lib = lib || world.lib;
    this.ui = ui && typeof ui.buffAdd === 'function' ? ui : null;
    this.hooks = {};
    this.time = 0;
    this.disposed = false;
    this.near = [];
    this.rng = makeRng(((seed ^ 0x5bd1e995) >>> 0) + 17);

    this.T = {};
    for (const k of KEYS) this.T[k] = 0;
    this.mods = { speedMul: 1, accelMul: 1, steerMul: 1, eatMul: 1, gravityMul: 1, magnetR: 0, ghost: false, shield: false, tonMul: 1, flying: false, noMelt: false, plow: false, magnet: false };

    this.pickups = []; this.mush = []; this.armies = []; this.shots = []; this.bossFx = null;
    this.strips = []; this.cannons = []; this.bridges = []; this.hazards = [];
    this._stT = 0;
    this.flip = { on: false, t: 0, dur: 1, landed: false, roll: 0 };
    this.sizeF = 1;
    this.boost = 0;
    this.rollNow = 0;
    this._fov = 0;
    this._cam = null;
    this._hudT = 0;
    this._rbT = 0;
    this._tickT = 0;
    this._tickList = [];
    this._tickObjs = {};
    this.ballR = level ? level.r0 : CFG.startR;
    this.planD = 70;
    this.nextPick = 150; this.nextFeat = 300;
    this.bag = []; this.featBag = [];
    this.nPicked = 0;

    this.TPL = buildTemplates();
    const solidMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.solid = new DynMesh(9000, 3, solidMat);
    this.glow = new DynMesh(9000, 4, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.group = new THREE.Group();
    this.group.add(this.solid.mesh, this.glow.mesh);
    scene.add(this.group);

    this._buildHud(hud && !this.ui);
    this._refreshMods(null);
  }

  // ------------------------------------------------------------------ incremental planning
  _expR() { return Math.max(this.L ? this.L.r0 : CFG.startR, this.ballR) * 1.15; }

  // earliest start >= a whose [a - pad, a + len + pad] avoids every world feature (ramps, patches, events) and our own
  _fit(a, len, dMax, pad = 6) {
    const w = this.world;
    let guard = 0;
    while (a < dMax && guard++ < 40) {
      if (w.zoneFree(a - pad, a + len + pad)) return a;
      a += 22;
    }
    return -1;
  }

  // Plan pickups / mushrooms / towers / armies in [.., dTo]. Called every frame with a bit less than the world's frontier.
  // Levels: the world hands over what the plan says (specialQueue) and nothing is drawn at random.
  planTo(dTo) {
    if (this.disposed) return;
    const w = this.world, R = this.rng;
    if (w.planEnd) dTo = Math.min(dTo, w.planEnd);
    while (w.specialQueue.length) this._special(w.specialQueue.shift());
    if (this.L) { this.planD = dTo; return; }
    // power-ups: one roughly every 150 m, a bag so kinds don't repeat; harder kinds join as you go
    while (this.nextPick < dTo) {
      const at = this._fit(this.nextPick, 6, dTo, 10);
      if (at < 0) { this.nextPick = dTo; break; }
      const hw = w.halfWidth(at);
      const x = R.range(-1, 1) * Math.max(1, hw - 3) * 0.75;
      const s = clamp(0.85 + this._expR() * 0.33, 1, 4.6);
      this.pickups.push({ kind: this._drawKind(at), x, d: at, s, gy: w.groundY(x, at), alive: true, ph: R.range(0, TAU) });
      w.zones.push({ d0: at - 5, d1: at + 9, kind: 'plus' });
      this.nextPick = at + R.range(120, 170);
    }
    // features: mushroom pads, updraft towers, snowman armies (rotating bag)
    while (this.nextFeat < dTo) {
      if (!this.featBag.length) {
        this.featBag = ['mush', 'army', 'mush', 'army'];
        for (let i = this.featBag.length - 1; i > 0; i--) { const j = (R.next() * (i + 1)) | 0; [this.featBag[i], this.featBag[j]] = [this.featBag[j], this.featBag[i]]; }
      }
      const kind = this.featBag.pop();
      const len = kind === 'mush' ? 70 : 34;
      const at = this._fit(this.nextFeat, len, dTo, 8);
      if (at < 0) { this.featBag.push(kind); this.nextFeat = dTo; break; }
      let used = len;
      if (kind === 'mush') used = this._addMush(at, R.chance(0.5) ? 3 : 2);
      else this._addArmy(at + 12);
      w.zones.push({ d0: at - 8, d1: at + used + 8, kind: 'plus' });
      this.nextFeat = at + used + R.range(130, 230);
    }
    this.planD = dTo;
  }

  // one thing from the world's queue: golden snowball (endless + levels), or a level item (power-up, army, mushrooms, strip, cannon, bridge)
  _special(s) {
    const w = this.world, R = this.rng;
    switch (s.kind) {
      case 'golden': {
        const sc = clamp(0.9 + this._expR() * 0.36, 1.1, 5);
        this.pickups.push({ kind: s.kind, x: s.x, d: s.d, s: sc, gy: w.groundY(s.x, s.d), alive: true, ph: R.range(0, TAU) });
        break;
      }
      case 'pickup': {
        const hw = w.halfWidth(s.at);
        const x = s.xf * Math.max(1, hw - 3);
        const sc = clamp(0.85 + this._expR() * 0.33, 1, 4.6);
        this.pickups.push({ kind: s.power, x, d: s.at, s: sc, gy: w.groundY(x, s.at), alive: true, ph: R.range(0, TAU) });
        break;
      }
      case 'army': this._addArmy(s.at); break;
      case 'mush': this._addMush(s.start + 6, s.count || 2); break;
      case 'strip': this._addStrip(s.at, s.xf); break;
      case 'puddle': case 'salt': this._addHazard(s); break;
      case 'cannon': this._addCannon(s); break;
      case 'bridge': this._addBridge(s); break;
      default: break;
    }
  }

  // ---- ÇIĞ DAĞLAR: speed strips, cannons, ice bridges
  _addStrip(d, xf) {
    const w = this.world, hw = w.halfWidth(d);
    const gr = this._expR() / 1.15;
    const wid = clamp(1.6 * gr + 2, 3, 14), len = clamp(6 + 2.2 * gr, 8, 40);
    const x = clamp(xf * hw, -(hw - wid / 2 - 0.5), hw - wid / 2 - 0.5);
    this.strips.push({ x, d, w: wid, len });
  }

  _addHazard(s) {
    const hw = this.world.halfWidth(s.start);
    const gr = Math.max(0.5, this._expR() / 1.15), salt = s.kind === 'salt';
    const rx = salt ? clamp(2 + 0.8 * gr, 2.2, 5) : clamp(1.6 + 0.7 * gr, 2, 4.2);
    const rd = salt ? Math.min(s.len / 2, clamp(4 + 1.6 * gr, 5, 10)) : Math.min(s.len / 2, clamp(1.8 + 0.5 * gr, 2, 3.5));
    const xm = Math.max(0, hw - rx - 0.5);
    this.hazards.push({ kind: s.kind, x: clamp(s.xf * hw, -xm, xm), d: s.start + s.len / 2, rx, rd, ph: this.rng.range(0, TAU), on: false });
  }

  _addCannon(s) {
    const w = this.world;
    const hw = w.halfWidth(s.start);
    this.cannons.push({
      side: s.side, d0: s.start - 70, d1: s.start + s.len + 250, d: s.start, x: s.side * (hw + 3), sc: clamp(0.8 + this._expR() * 0.5, 1, 6),
      t: 0.8, left: this.L && this.L.n >= 16 ? 4 : 3, tele: null,
    });
  }

  // an ice bridge along the left lane: shortcut with a strip + golden crates, but it collapses under a ball bigger than maxR;
  // a row of big rocks splits the track, the right lane is the safe feeding lane
  _addBridge(s) {
    const w = this.world, R = this.rng;
    const d0 = s.start + 8, d1 = s.start + s.len - 10;
    const hw = w.halfWidth(d0);
    const gr = this._expR() / 1.15;
    const tr = Math.max(1.6, gr * 1.9);
    const e = w.pick(w.obst, tr, 0.6, 1.7);
    if (e) {
      const sc = clamp(tr / e.r, 0.3, 22);
      for (let d = d0; d <= d1; d += tr * 1.6) { const p = w.add(e.type, R.range(-0.4, 0.4), d, { s: sc * R.range(0.95, 1.08), rot: R.range(0, TAU) }); if (p) p.obstacle = true; }
    }
    const x1 = -tr * 0.9, x0 = -hw;
    this.bridges.push({ d0, d1, x0, x1, maxR: s.maxR || gr * 1.2, state: 0, t: 0 });
    const xc = (x0 + x1) / 2;
    this._addStrip(d0 + 18, xc / hw);
    const pr = w.expectAt(d0 + 50);
    w.crateAt(xc - 1, d0 + 50, Math.min(3.4, 0.55 * pr) * 1.15, 'gold', pr);
    w.crateAt(xc + 1, d0 + 78, Math.min(3.4, 0.55 * pr) * 1.15, 'gold', pr);
    const T = tierOf(gr);
    for (let i = 0; i < 14; i++) w.food1(clamp(w.rollQ(T) * 0.9, 0.12, 0.7), gr, R.range(tr + 1, Math.max(tr + 2, hw - 1)), d0 + 6 + i * ((d1 - d0 - 12) / 14), hw, { spacing: 0.1 });
  }

  _drawKind(d) {
    if (!this.bag.length) {
      const kinds = ['magnet', 'giant', 'shield'];
      if (d > 500) kinds.push('rocket', 'freeze');
      if (d > 1300) kinds.push('rainbow');
      this.bag = kinds.slice();
      for (let i = this.bag.length - 1; i > 0; i--) { const j = (this.rng.next() * (i + 1)) | 0; [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; }
    }
    return this.bag.pop();
  }

  // Remove props from a rectangular footprint so features never sit on top of scenery.
  _clear(cx, d0, d1, halfW) {
    const w = this.world, out = this.near;
    for (let d = d0 - 2; d <= d1 + 2; d += 6) {
      w.query(cx, d, halfW + 6, out);
      for (let i = 0; i < out.length; i++) {
        const p = out[i];
        if (!p.alive) continue;
        if (Math.abs(p.x - cx) < halfW + p.r * 0.5 && p.d > d0 - 2 - p.r && p.d < d1 + 2 + p.r) w.kill(p);
      }
    }
  }

  _addMush(d0, n = 3) {
    const w = this.world, R = this.rng;
    const spacing = 26;
    const hw = w.halfWidth(d0);
    const expR = this._expR();
    const pr = clamp(2.4 + expR * 1.1, 3, hw * 0.3);
    let x = R.range(-1, 1) * Math.max(0, hw - pr - 1) * 0.6;
    for (let i = 0; i < n; i++) {
      const d = d0 + 6 + i * spacing;
      x = clamp(x + R.range(-4, 4), -(hw - pr - 1), hw - pr - 1);
      const slope = (w.groundY(x, d - 1) - w.groundY(x, d + 1)) / 2;
      this.mush.push({ x, d, pr, capH: pr * 0.55, gy: w.groundY(x, d), cd: 0, sq: 0, tilt: -Math.atan(slope) });
      this._clear(x, d - pr, d + pr, pr + 0.5);
    }
    return 6 + (n - 1) * spacing + pr + 2;
  }

  _addArmy(d) {
    const w = this.world, R = this.rng;
    const baseDef = this.lib.snowman || this.lib.k_snowman;
    if (!baseDef) return;
    const hw = w.halfWidth(d);
    const cx = R.range(-1, 1) * hw * 0.45;
    const n = R.int(5, 9);
    const boss = R.int(0, n - 1);
    const a = { d, cx, n, hw, members: [], woke: false, boss };
    const expR = this._expR();
    // clear the footprint FIRST: world.query also returns movers, so clearing after spawning killed the whole army
    this._clear(cx, d - 8, d + 8, 6);
    for (let i = 0; i < n; i++) {
      const isBoss = i === boss;
      const ratio = isBoss ? 1.6 : R.chance(0.68) ? R.range(0.45, 0.78) : R.range(1.15, 1.6);
      const tR = Math.max(0.45, expR * ratio);
      const s = tR / baseDef.radius;
      const ang = R.range(0, TAU), rad = R.range(0, 1) * (3 + expR * 1.2);
      const x = clamp(cx + Math.cos(ang) * rad, -hw + 1, hw - 1);
      const dd = d + Math.sin(ang) * rad * 1.5 + (isBoss ? 6 : 0);
      const p = w.add(baseDef.name, x, dd, { s, rot: Math.PI, move: MOVE_ARMY });
      if (!p) continue;
      p.cp = true; p.s0 = p.s; p.spd = R.range(5, 8.2); p.ox = x; p.od = dd;
      a.members.push(p);
    }
    this.armies.push(a);
  }

  _armyUpdate(dt, b, active) {
    const w = this.world;
    for (let i = 0; i < this.armies.length; i++) {
      const a = this.armies[i];
      if (!a.woke && active && b.d > a.d - 90) {
        a.woke = true;
        if (this.game?._msg) this.game._msg(2, 'KARDAN ADAM ORDUSU!'); else this._call('float', 'KARDAN ADAM ORDUSU!', 'big');
        this._call('sfx', 'rumble');
      }
      for (let j = 0; j < a.members.length; j++) {
        const p = a.members[j];
        if (!p.alive) continue;
        p.s = p.s0 * (1 + 0.07 * Math.sin(this.time * (a.woke ? 14 : 2) + p.phase)); // waddle
        if (!a.woke || p._fz) continue;
        if (b.d > p.d + 10) continue; // left behind
        // Interceptors: they slide sideways into the ball's line, never uphill into it (no shoving).
        const ddA = p.d - b.d;
        if (ddA < 0 || ddA > 60) continue;
        const hw = w.halfWidth(p.d) - 1;
        const step = clamp(b.x - p.x, -p.spd * dt, p.spd * dt);
        p.x = clamp(p.x + step, -hw, hw);
        p.ox = p.x;
        p.rot = Math.atan2(step, 0.0001);
      }
    }
  }

  _prune(b) {
    const cut = b.d - 70;
    const fresh = (a, f) => { let n = 0; for (let i = 0; i < a.length; i++) if (f(a[i])) a[n++] = a[i]; a.length = n; };
    fresh(this.pickups, (p) => p.alive && p.d > cut);
    fresh(this.mush, (m) => m.d > cut);
    fresh(this.shots, (q) => q.alive && q.d > cut);
    fresh(this.armies, (a) => a.d > cut - 40);
    fresh(this.strips, (q) => q.d + q.len > cut);
    fresh(this.hazards, (h) => h.d + h.rd > cut);
    fresh(this.cannons, (c) => c.d1 > cut);
    fresh(this.bridges, (q) => q.d1 > cut);
  }

  // ------------------------------------------------------------------ HUD (only when the page has no ui.buff* API)
  _buildHud(on) {
    this.hud = null;
    if (!on || typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 166px);display:none;justify-content:center;gap:6px;pointer-events:none;z-index:15;';
    this.chips = {};
    for (const k of KEYS) {
      const P = POWERS[k], hex = '#' + P.color.toString(16).padStart(6, '0');
      const el = document.createElement('div');
      el.style.cssText = `position:relative;width:44px;height:44px;border-radius:13px;background:rgba(10,20,40,.6);border:2px solid ${hex};display:none;align-items:center;justify-content:center;font-size:23px;line-height:1;`;
      el.textContent = P.icon;
      const bar = document.createElement('i');
      bar.style.cssText = `position:absolute;left:5px;right:5px;bottom:3px;height:4px;border-radius:2px;background:${hex};transform-origin:left center;`;
      el.appendChild(bar);
      root.appendChild(el);
      this.chips[k] = { el, bar, shown: false };
    }
    document.body.appendChild(root);
    this.hud = root;
    this.hudShown = false;
  }

  _hudUpdate(dt, active) {
    if (this.hud) {
      if (active !== this.hudShown) { this.hudShown = active; this.hud.style.display = active ? 'flex' : 'none'; }
      this._hudT -= dt;
      if (this._hudT <= 0) {
        this._hudT = 0.1;
        for (let i = 0; i < KEYS.length; i++) {
          const k = KEYS[i], ch = this.chips[k], v = this.T[k];
          const show = active && v > 0;
          if (show !== ch.shown) { ch.shown = show; ch.el.style.display = show ? 'flex' : 'none'; }
          if (show) {
            const f = clamp(v / POWERS[k].dur, 0, 1);
            ch.bar.style.transform = `scaleX(${f.toFixed(2)})`;
            ch.el.style.opacity = v < 1.2 && ((this.time * 6) | 0) % 2 ? '0.45' : '1';
          }
        }
      }
    }
    if (this.ui && active) {
      this._tickT -= dt;
      if (this._tickT <= 0) {
        this._tickT = 0.25;
        const list = this._tickList;
        list.length = 0;
        for (let i = 0; i < KEYS.length; i++) {
          const k = KEYS[i];
          if (this.T[k] > 0) {
            let o = this._tickObjs[k];
            if (!o) o = this._tickObjs[k] = { id: k, left: 0, total: POWERS[k].dur };
            o.left = this.T[k];
            list.push(o);
          }
        }
        if (this.ui.buffTick) this.ui.buffTick(list);
      }
    }
  }

  _buffOn(k) {
    if (this.ui) this.ui.buffAdd(k, POWERS[k].icon, POWERS[k].name, POWERS[k].dur);
  }
  _buffOff(k) {
    if (this.ui && this.ui.buffRemove) this.ui.buffRemove(k);
  }

  // ------------------------------------------------------------------ hooks
  _call(name, a, b, c, d, e, f, g, h) {
    const fn = this.hooks && this.hooks[name];
    if (fn) fn(a, b, c, d, e, f, g, h);
  }
  _burst(x, y, d, n, color, speed, size, up) { this._call('burst', x, y, d, n, color, speed, size, up); }

  // ------------------------------------------------------------------ queries main/game use each substep
  // Height of mushroom domes above the plain ground at (x, d). Add to the ramp height.
  lift(x, d) {
    const ms = this.mush;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (d < m.d - m.pr || d > m.d + m.pr) continue;
      const dx = x - m.x, dd = d - m.d, q = (dx * dx + dd * dd) / (m.pr * m.pr);
      if (q < 1) return m.capH * (1 - q);
    }
    return 0;
  }

  // Edible threshold multiplier for one prop (frozen movers are free to eat).
  eatMulFor(p) { return this.mods.eatMul * (p._fz ? 1.5 : 1); }

  // Call from bump(): returns true (and pops the shield) if the hit should be free.
  consumeShield() {
    if (this.T.shield <= 0) return false;
    this.T.shield = 0;
    this._buffOff('shield');
    this._call('onPowerEnd', 'shield');
    this._call('float', 'KALKAN KIRILDI!', 'big');
    this._call('sfx', 'shield');
    this._call('haptic', 'heavy');
    const b = this._ball;
    if (b) this._burst(b.x, b.y, b.d, 18, 0x44a6ff, 9, 0.28, 6);
    return true;
  }

  modifiers(ball) { this._refreshMods(ball); return this.mods; }

  _refreshMods(b) {
    const m = this.mods, T = this.T;
    m.speedMul = 1; m.accelMul = 1; m.steerMul = 1; m.eatMul = T.giant > 0 ? 1.5 : 1; m.gravityMul = 1; m.magnetR = 0; m.ghost = false; m.tonMul = 1;
    m.noMelt = false; m.plow = T.rocket > 0; m.magnet = T.magnet > 0;
    m.shield = T.shield > 0; m.flying = false;
    if (T.rocket > 0) { m.speedMul *= 1 + 0.8 * clamp(T.rocket / 0.6, 0, 1); m.accelMul = 4; }
    if (T.magnet > 0 && b) m.magnetR = (7 + b.r * 3.2) * clamp(T.magnet / 0.8, 0.3, 1);
    if (T.rainbow > 0) m.tonMul = 3;
    if (b) m.noMelt = T.freeze > 0 || this.lift(b.x, b.d) > 0.15 || this._onKicker(b);
  }

  _onKicker(b) {
    const rs = this.world.ramps;
    for (let i = 0; i < rs.length; i++) {
      const k = rs[i];
      if (b.d > k.d - 1 && b.d < k.d + k.len + 1 && Math.abs(b.x - k.x) < k.w / 2 + 1) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ per-frame
  reset() {
    for (const k of KEYS) { if (this.T[k] > 0) this._buffOff(k); this.T[k] = 0; }
    this.flip.on = false; this.shots.length = 0; this.bossFx = null;
    this._unfreeze();
    this.sizeF = 1;
  }

  update(dt, ball, G) {
    if (this.disposed) return;
    const b = ball;
    this._ball = b;
    this.ballR = b.r;
    this.time += dt;
    const active = G.state === 'play';
    if (active) {
      this._pickups(b);
      this._kickers(dt, b);
      this._shots(dt, b);
      this._mushrooms(dt, b);
      this._timers(dt, b);
      this._freeze(dt, b);
      this._effects(dt, b);
      if (this.L) { this._strips(dt, b, G); this._hazards(dt, b, G); this._cannons(dt, b); this._bridges(dt, b); }
    }
    this._armyUpdate(dt, b, active);
    this._rollUpdate(dt);
    this._draw(dt, b, active);
    this._hudUpdate(dt, active);
    this._refreshMods(b);
    this._pruneT = (this._pruneT || 0) - dt;
    if (this._pruneT <= 0) { this._pruneT = 1; this._prune(b); }
  }

  _gy(x, d) { return this.world.groundY(x, d) + this.world.rampAt(x, d); }

  _pickups(b) {
    const ps = this.pickups;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.alive || Math.abs(p.d - b.d) > b.r + p.s * 1.5 + 3) continue;
      const dx = b.x - p.x, dd = b.d - p.d, py = p.gy + p.s * 1.7;
      const dy = b.y - py;
      const reach = b.r + p.s * 1.5;
      if (dx * dx + dd * dd + dy * dy * 0.5 < reach * reach) {
        p.alive = false;
        this._activate(p.kind, b, p);
      }
    }
  }

  _activate(kind, b, p) {
    const P = PICK_STYLE[kind];
    if (kind === 'golden') {
      this._call('onGolden', p);
      if (p) this._burst(p.x, p.gy + p.s * 1.7, p.d, 26, P.color, 9, 0.26, 7);
      return;
    }
    const wasOn = this.T[kind] > 0;
    this.T[kind] = P.dur;
    if (!wasOn) this._buffOn(kind); else if (this.ui) this.ui.buffAdd(kind, P.icon, P.name, P.dur);
    this._call('onPower', kind);
    this._call('float', `${P.name}!`, 'big');
    this._call('sfx', 'power');
    this._call('haptic', 'success');
    if (p) this._burst(p.x, p.gy + p.s * 1.7, p.d, 20, P.color, 8, 0.24, 6);
    if (kind === 'rocket') b.speed *= 1.25;
    else if (kind === 'freeze') { this._burst(b.x, b.y, b.d, 24, 0xbff4ff, 12, 0.3, 4); this._call('sfx', 'freeze'); }
  }

  // ---- flip kickers (the world places the ramps; flagged ones are the TAKLA kind)
  _kickers(dt, b) {
    const f = this.flip;
    if (f.on) {
      if (b.airborne || !f.landed) {
        if (!b.airborne) { // just landed
          f.landed = true;
          this._call('onFlip');
          this._call('float', 'TAKLA!', 'big');
          this._call('sfx', 'flip');
          this._call('haptic', 'heavy');
          this._burst(b.x, b.y - b.r * 0.5, b.d, 22, 0xff4fd8, 11, 0.3, 7);
        } else f.t += dt;
      }
      if (f.landed) f.t += dt * (f.dur / 0.25); // finish the spin quickly after touchdown
      const p = clamp(f.t / f.dur, 0, 1);
      f.roll = TAU * sm01(p);
      if (f.landed && p >= 1) { f.on = false; f.roll = 0; }
      return;
    }
    if (!b.airborne || b.airTime > 0.3) return;
    const rs = this.world.ramps;
    for (let i = 0; i < rs.length; i++) {
      const k = rs[i];
      if (!k.flip) continue;
      const lip = k.d + k.len;
      if (b.d > lip - 3 && b.d < lip + 9 && Math.abs(b.x - k.x) < k.w / 2 + b.r) {
        const vy = 14 + b.speed * 0.5 + (k.R || 1) * 0.6;
        f.on = true; f.landed = false; f.t = 0; f.dur = (2 * vy) / CFG.gravity; f.roll = 0;
        this._call('onLaunch', vy, OPT_FLIP);
        this._call('sfx', 'whoosh');
        this._call('haptic', 'heavy');
        this._call('float', 'TAKLA ZAMANI!', 'big');
        this._burst(b.x, b.y - b.r * 0.6, b.d, 14, 0xffe03a, 9, 0.25, 6);
        break;
      }
    }
  }

  // ---- enemy snowballs: fly straight, dodgeable; a hit shaves a bit of snow (the game decides how much)
  spawnShot(x, y, d, vx, vd, big = 1) {
    if (this.shots.length >= 14) return;
    this.shots.push({ x, y, d, vx, vd, s: 0.45 * big, alive: true, life: 4.5 });
  }

  _shots(dt, b) {
    const sh = this.shots;
    for (let i = 0; i < sh.length; i++) {
      const q = sh[i];
      if (!q.alive) continue;
      q.life -= dt;
      q.x += q.vx * dt; q.d += q.vd * dt;
      q.y = this._gy(q.x, q.d) + b.r * 0.8 + q.s;
      if (q.life <= 0 || q.d < b.d - 12) { q.alive = false; continue; }
      const dx = q.x - b.x, dd = q.d - b.d;
      if (dx * dx + dd * dd < (b.r + q.s) * (b.r + q.s)) {
        q.alive = false;
        this._burst(q.x, q.y, q.d, 8, 0xdff0ff, 6, 0.16, 3);
        this._call('onShot', q);
      }
    }
  }

  // ---- bouncy mushrooms
  _mushrooms(dt, b) {
    for (let i = 0; i < this.mush.length; i++) {
      const m = this.mush[i];
      m.cd -= dt;
      m.sq = Math.max(0, m.sq - dt * 3);
      if (m.cd > 0 || Math.abs(m.d - b.d) > m.pr + b.r) continue;
      const dx = b.x - m.x, dd = b.d - m.d, rad = m.pr * 0.8 + b.r * 0.3;
      if (dx * dx + dd * dd > rad * rad) continue;
      const surface = this.world.groundY(b.x, b.d) + this.lift(b.x, b.d);
      if (b.y - b.r * 0.92 > surface + 1.2 || (b.airborne && b.vy > 2)) continue;
      m.cd = 0.6; m.sq = 1;
      const vy = Math.min(CFG.hopMax + 1.5, 7 + b.speed * 0.08 + this._expR() * 0.1);
      this._call('onLaunch', vy, OPT_BOUNCE);
      this._call('sfx', 'boing');
      this._call('haptic', 'medium');
      this._call('float', 'ZIP!', '');
      this._burst(m.x, m.gy + m.capH, m.d, 18, 0xffd7ec, 6, 0.22, 7);
      this._burst(m.x, m.gy + m.capH, m.d, 8, 0xff6fa8, 5, 0.2, 6);
    }
  }

  _rollUpdate() {
    this.rollNow = this.flip.on ? this.flip.roll : 0;
  }

  // ---- timers
  _timers(dt, b) {
    const T = this.T;
    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i];
      if (T[k] <= 0) continue;
      T[k] -= dt;
      if (T[k] <= 0) {
        T[k] = 0;
        this._buffOff(k);
        this._call('onPowerEnd', k);
        if (k === 'giant') this._call('float', 'KÜÇÜLÜYOR', '');
      }
    }
  }

  // ---- freeze
  _freeze(dt, b) {
    const mv = this.world.movers;
    if (this.T.freeze > 0) {
      const lo = b.d - 10, hi = b.d + 200;
      for (let i = 0; i < mv.length; i++) {
        const p = mv[i];
        if (!p.alive || p.kind === 'chunk' || p.move === 0 || p.d < lo || p.d > hi) continue;
        if (!p._fz) { p._fz = true; p._vd0 = p.vd; p._vx0 = p.vx; p.vd = 0; p.vx = 0; }
        if (p.move === 1) p.phase -= 0.9 * dt;
        else if (p.move === 2) p.phase -= 0.5 * dt;
      }
    } else if (this._frozenAny) this._unfreeze();
    this._frozenAny = this.T.freeze > 0;
  }
  _unfreeze() {
    const mv = this.world.movers;
    for (let i = 0; i < mv.length; i++) {
      const p = mv[i];
      if (p._fz) { p._fz = false; p.vd = p._vd0; p.vx = p._vx0; }
    }
    this._frozenAny = false;
  }

  // ---- ball trail effects for active powers
  _effects(dt, b) {
    const T = this.T;
    this._rbT -= dt;
    if (this._rbT <= 0) {
      this._rbT = 0.07;
      if (T.rainbow > 0) this._burst(b.x, b.y - b.r * 0.4, b.d - b.r * 0.8, 2, SLIDE_PAL[((this.time * 11) | 0) % SLIDE_PAL.length], 2.5, 0.16 + b.r * 0.04, 1.5);
      if (T.rocket > 0) this._burst(b.x, b.y - b.r * 0.2, b.d - b.r, 2, (this.time * 40) % 2 < 1 ? 0xffa21f : 0xff5a1f, 5, 0.2 + b.r * 0.05, 1);
    }
  }

  // ---- speed strips: roll over one and the ball gets a short speed boost (CigGame reads G.stripT / G.stripNew)
  _strips(dt, b, G) {
    const S = this.strips;
    let on = false;
    for (let i = 0; i < S.length; i++) {
      const q = S[i];
      if (b.d < q.d - b.r * 0.5 || b.d > q.d + q.len || b.airborne || Math.abs(b.x - q.x) > q.w / 2 + b.r * 0.3) continue;
      on = true;
      if (G.stripT <= 0.05) {
        G.stripNew = true;
        this._call('sfx', 'whoosh');
        this._call('haptic', 'medium');
        this._burst(b.x, b.y - b.r * 0.5, b.d - b.r, 14, 0x7fe0ff, 9, 0.22, 4);
      }
      G.stripT = CFG.lvl.stripT;
    }
    if (G.stripT > 0) {
      this._stT -= dt;
      if (this._stT <= 0) { this._stT = 0.06; this._burst(b.x, b.y - b.r * 0.4, b.d - b.r * 0.9, 2, on ? 0x7fe0ff : 0xffffff, 4, 0.15 + b.r * 0.03, 1.5); }
    }
  }

  // ---- ÇIĞ DAĞLAR light shrink pads: a warm puddle shrinks the ball once per entry (steam puff, never below G.hazFloor);
  // salt slowly melts it and bleeds its momentum while rolling over. Neither one kills, blocks or touches the props.
  _hazards(dt, b, G) {
    const H = this.hazards;
    for (let i = 0; i < H.length; i++) {
      const h = H[i];
      if (b.d < h.d - h.rd - 2 || b.d > h.d + h.rd + 2) continue;
      const u = (b.x - h.x) / (h.rx + b.r * 0.5), v = (b.d - h.d) / (h.rd + b.r * 0.5);
      const inside = !b.airborne && u * u + v * v <= 1;
      if (!inside) { h.on = false; continue; }
      const floor = G.hazFloor || 0;
      if (h.kind === 'puddle') {
        if (h.on || b.r <= floor) continue;
        h.on = true;
        b.setRadius(Math.max(floor, b.r * 0.92));
        G.hitPending = true; G.hazMsg = G.hazMsg || 'puddle';
        this._call('puff', b.x, b.y, -b.d, 0, 1.4, 0, 0.6 + b.r * 0.4, 1.1, 0xffe0c0, 0.55);
        this._burst(b.x, b.y - b.r * 0.5, b.d - b.r, 10, 0xff8a3a, 5, 0.2 + b.r * 0.05, 3);
        this._call('haptic', 'medium');
      } else {
        if (!h.on) { h.on = true; G.hazMsg = G.hazMsg || 'salt'; }
        if (b.r > floor) b.setRadius(Math.max(floor, b.r * (1 - 0.05 * dt)));
        G.momT = Math.max(0, G.momT - 1.2 * dt);
        if (Math.random() < dt * 8) this._burst(b.x, b.y - b.r * 0.9, b.d - b.r * 0.5, 1, 0xfff4e0, 2, 0.12, 1.5);
      }
    }
  }

  // ---- cannons: they run along the edge ahead of the ball; 1 s before a shot a lane on the ground shows the path
  // (white = a small ball: eat it, red = a big one: dodge it)
  _cannons(dt, b) {
    const w = this.world, R = this.rng, C = this.cannons;
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (b.d < c.d0 || b.d > c.d1) continue;
      const hw = w.halfWidth(c.d);
      c.x = c.side * (hw + 1.5 + c.sc);
      if (c.tele) {
        const T = c.tele;
        T.t -= dt;
        if (T.t <= 0) {
          c.tele = null; c.t = 2.6;
          const p = w.spawnRoller(T.x0, T.d0, T.r, T.vx, T.vd);
          if (p) { this._burst(c.x, w.groundY(c.x, T.d0) + c.sc, T.d0, 12, 0xffffff, 8, 0.22, 3); this._call('sfx', 'rumble'); }
        }
        continue;
      }
      if (c.left <= 0) continue;
      const sp = Math.max(b.speed, 12);
      c.d += (b.d + sp + 25 - c.d) * Math.min(1, dt * 3);
      c.t -= dt;
      if (c.t > 0) continue;
      let live = 0;
      const en = w.enemies;
      for (let k = 0; k < en.length; k++) if (en[k].alive && en[k].enemy.roll) live++;
      if (live >= 3) { c.t = 0.5; continue; }
      const red = R.chance(0.5);
      const r = red ? b.r * R.range(1.4, 1.8) : b.r * R.range(0.5, 0.65);
      const vx = -c.side * R.range(14, 22);
      const tc = (2 * hw + 4) / Math.abs(vx);
      const f = R.range(0.4, 0.9);
      const dS = b.d + sp * 1.0 + 0.55 * sp * tc * f;
      const vd = 0.45 * sp;
      c.d = dS;
      c.tele = { t: 1.0, x0: c.x, d0: dS, x1: c.x + vx * tc, d1: dS + vd * tc, red, r, vx, vd };
      c.left--;
    }
  }

  // ---- ice bridges: crack under a ball that is too big, then collapse
  _bridges(dt, b) {
    const B = this.bridges;
    for (let i = 0; i < B.length; i++) {
      const q = B[i];
      if (q.state === 2 || b.d < q.d0 - 5 || b.d > q.d1 + 5) continue;
      const on = !b.airborne && b.x < q.x1 + b.r * 0.3 && b.x > q.x0 - b.r * 0.3;
      if (q.state === 0) {
        if (on && b.r > q.maxR) {
          q.state = 1; q.t = 0.6;
          this._call('float', 'BUZ ÇATLIYOR!', 'bad');
          this._call('sfx', 'rumble');
          this._call('haptic', 'warning');
        }
      } else {
        q.t -= dt;
        if (q.t <= 0) { q.state = 2; if (on) this._call('onBridgeFall'); }
      }
    }
  }

  // ------------------------------------------------------------------ drawing
  _draw(dt, b, active) {
    const t = this.time, S = this.solid, Gl = this.glow, TP = this.TPL;
    S.begin(); Gl.begin();
    const lo = b.d - 40, hi = b.d + 300;

    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (!p.alive || p.d < lo || p.d > hi) continue;
      const P = PICK_STYLE[p.kind], col = P.color;
      const cr = ((col >> 16) & 255) / 255, cg = ((col >> 8) & 255) / 255, cb = (col & 255) / 255;
      const bob = Math.sin(t * 2 + p.ph) * 0.18 * p.s, y = p.gy + p.s * 1.7 + bob;
      S.emit(TP[p.kind], p.x, y, -p.d, t * 2.2 + p.ph, p.s, p.s, p.s, 0, ICON_TILT[p.kind], 1, 1, 1, 1);
      const pulse = 1 + 0.12 * Math.sin(t * 4 + p.ph);
      Gl.emit(TP.ring, p.x, y, -p.d, 0, p.s * 1.35 * pulse, p.s * 1.35 * pulse, p.s * 1.35, 0, t, cr, cg, cb, 0.9);
      Gl.emit(TP.ring, p.x, p.gy + 0.2, -p.d, 0, p.s * 1.6, p.s * 1.6, p.s * 1.6, Math.PI / 2, 0, cr, cg, cb, 0.8);
      Gl.emit(TP.beam, p.x, p.gy, -p.d, 0, 0.45 * p.s, 16 * p.s, 0.45 * p.s, 0, 0, cr, cg, cb, 1);
    }

    for (let i = 0; i < this.mush.length; i++) {
      const m = this.mush[i];
      if (m.d < lo || m.d > hi) continue;
      const sq = m.sq; // 0..1 squash amount
      const wob = sq > 0 ? Math.cos(t * 30) * 0.5 + 0.5 : 0;
      S.emit(TP.pad, m.x, m.gy - 0.05, -m.d, 0, m.pr * (1 + 0.1 * sq * wob), m.capH * (1 - 0.35 * sq * wob), m.pr * (1 + 0.1 * sq * wob), m.tilt, 0, 1, 1, 1, 1);
    }

    // flip-kicker hoops: the arc you fly through
    const rs = this.world.ramps;
    for (let i = 0; i < rs.length; i++) {
      const k = rs[i];
      if (!k.flip || k.d > hi || k.d + k.len < lo) continue;
      const R0 = k.R || 1;
      const lipY = this.world.groundY(k.x, k.d + k.len) + k.h;
      const v = Math.min(CFG.maxSpeed, CFG.baseSpeed + CFG.sizeSpeed * Math.sqrt(R0)), vy = 14 + v * 0.5 + R0 * 0.6;
      const hoopR = Math.max(k.w * 0.4, R0 * 1.5 + 2.5);
      for (let h = 0; h < 3; h++) {
        const tau = (4 + h * 7) / v;
        const y = lipY + vy * tau - 0.5 * CFG.gravity * tau * tau;
        const glowK = 0.55 + 0.45 * Math.sin(t * 6 - h * 1.6);
        Gl.emit(TP.ring, k.x, y, -(k.d + k.len + 4 + h * 7), 0, hoopR, hoopR, hoopR, 0, 0, 1, 0.3 + 0.3 * glowK, 0.85, 0.85);
      }
    }

    // enemy snowballs
    for (let i = 0; i < this.shots.length; i++) {
      const q = this.shots[i];
      if (!q.alive) continue;
      S.emit(TP.shot, q.x, q.y, -q.d, t * 5, q.s, q.s, q.s, 0, 0, 1, 1, 1, 1);
    }

    // frozen movers wear an ice shell
    if (this.T.freeze > 0) {
      const mv = this.world.movers;
      let n = 0;
      const fade = clamp(this.T.freeze / 0.8, 0.3, 1);
      for (let i = 0; i < mv.length && n < 36; i++) {
        const p = mv[i];
        if (!p._fz || !p.alive || p.d < lo || p.d > b.d + 120) continue;
        Gl.emit(TP.ice, p.x, p.y + p.h * 0.5, -p.d, p.phase, p.r * 1.15, p.h * 0.62, p.r * 1.15, 0, 0, 0.6, 0.9, 1, fade);
        n++;
      }
    }

    if (this.L) this._drawLevel(S, Gl, TP, t, lo, hi);

    // ball auras
    if (active) {
      const T = this.T, bx = b.x, by = b.y, bz = -b.d;
      if (T.shield > 0) {
        const a = b.r * 1.3, bl = POWERS.shield.color;
        const cr = ((bl >> 16) & 255) / 255, cg = ((bl >> 8) & 255) / 255, cb = (bl & 255) / 255;
        S.emit(TP.ringS, bx, by, bz, 0, a, a, a, Math.PI / 2 + 0.3 * Math.sin(t * 2), 0, cr, cg, cb, 1);
        S.emit(TP.ringS, bx, by, bz, t * 1.3, a, a, a, 0, 0, cr, cg, cb, 1);
        S.emit(TP.ringS, bx, by, bz, t * 1.3 + Math.PI / 2, a, a, a, 0, 0, cr, cg, cb, 1);
        Gl.emit(TP.sphere, bx, by, bz, 0, a, a, a, 0, 0, 0.3, 0.65, 1, 1);
      }
      if (T.magnet > 0 && this.mods.magnetR > 0) {
        const f = (t * 1.3) % 1, R = this.mods.magnetR * (1 - f);
        Gl.emit(TP.ring, bx, this._gy(bx, b.d) + 0.25, bz, 0, R, R, R, Math.PI / 2, 0, 1, 0.3, 0.35, 0.9 * Math.sin(f * Math.PI));
      }
      if (T.freeze > 0) {
        const R = b.r * 2.2;
        Gl.emit(TP.ring, bx, this._gy(bx, b.d) + 0.25, bz, 0, R, R, R, Math.PI / 2, 0, 0.55, 0.9, 1, 0.8);
      }
      if (T.giant > 0) {
        const R = b.r * 1.15 * (b.visK || 1);
        S.emit(TP.ringS, bx, by, bz, t * 0.8, R, R, R, Math.PI / 2, 0, 0.27, 0.88, 0.43, 1);
      }
    }
    S.end(); Gl.end();
  }

  // strips (a chain of short quads that follow the ground), cannons with their telegraph lane, ice bridges
  // boss attack telegraphs: falling shadow marks, laser line, shockwave rings, charge lane (state lives in the boss AI: bossFx)
  _drawBoss(S, Gl, TP, t) {
    const hwOf = (w, d) => w.halfWidth(d);
    const B = this.bossFx, w = this.world;
    if (!B || B.dead) return;
    for (const m of B.marks) {
      const k = clamp(m.t / m.dur, 0, 1), gy = w.groundY(m.x, m.d);
      const pu = 0.5 + 0.5 * Math.sin(t * 18), rr = m.r * (1.2 - 0.2 * k);
      Gl.emit(TP.ring, m.x, gy + 0.25, -m.d, 0, rr, rr, rr, Math.PI / 2, 0, 1, 0.3, 0.2, 0.3 + 0.4 * k + 0.25 * pu * k);
      Gl.emit(TP.lane, m.x, gy + 0.22, -m.d, 0, m.r * 1.6 * k, 1, m.r * 1.6 * k, 0, 0, 0.1, 0.05, 0.1, 0.5 * k);
      const h = (1 - k) * (1 - k) * 34 + m.s, sc = m.boulder ? m.s * 1.4 : m.s;
      if (!m.ghost) S.emit(m.boulder ? TP.ice : TP.shot, m.x, gy + h, -m.d, t * 4, sc, sc, sc, 0, 0, 1, 1, 1, 1);
    }
    if (B.shield > 0 && B.pos) {
      const P = B.pos, gy = w.groundY(P.x, P.d), pu = 0.5 + 0.5 * Math.sin(t * 9), R = P.r * 1.25;
      Gl.emit(TP.ring, P.x, gy + 0.3, -P.d, 0, R, R, R, Math.PI / 2, 0, 0.45, 0.85, 1, 0.55 + 0.3 * pu);
      Gl.emit(TP.lane, P.x, gy + 0.26, -P.d, 0, R * 1.5, 1, R * 1.5, 0, 0, 0.5, 0.9, 1, 0.4);
      for (let k = 0; k < 7; k++) {
        const a = t * 1.6 + k * 0.898, rr = P.r * 1.1, hy = P.h * (0.15 + 0.7 * ((k * 0.37) % 1));
        S.emit(TP.ice, P.x + Math.sin(a) * rr, gy + hy, -(P.d + Math.cos(a) * rr), t * 2 + k, 1.3, 2.2, 1.3, 0, 0, 0.6, 0.9, 1, 0.9);
      }
    }
    for (const T of B.traps || []) {
      const gy = w.groundY(T.x, T.d), rdy = T.cd <= 0, pu = 0.5 + 0.5 * Math.sin(t * 6 + T.x), al = rdy ? 0.7 + 0.3 * pu : 0.2, pk = 1 + 0.12 * pu;
      const col = T.k === 'ice' ? [0.5, 0.9, 1] : T.k === 'mirror' ? [1, 0.95, 0.5] : [1, 0.6, 0.4];
      if (T.k === 'ice') {
        Gl.emit(TP.ring, T.x, gy + 0.3, -T.d, 0, T.r * pk, T.r * pk, T.r * pk, Math.PI / 2, 0, col[0], col[1], col[2], al);
        Gl.emit(TP.ring, T.x, gy + 0.3, -T.d, 0, T.r * 0.6, T.r * 0.6, T.r * 0.6, Math.PI / 2, t, 0.8, 1, 1, al);
        Gl.emit(TP.lane, T.x, gy + 0.26, -T.d, 0, T.r * 1.5, 1, T.r * 1.5, 0, 0, 0.55, 0.9, 1, al * 0.6);
      } else {
        Gl.emit(TP.ice, T.x, gy + 2.2, -T.d, 0, 1.1, 2.6, 1.1, 0, 0, col[0], col[1], col[2], rdy ? 0.9 : 0.3);
        const R2 = Math.max(4.5, T.r) * pk;
        Gl.emit(TP.ring, T.x, gy + 0.3, -T.d, 0, R2, R2, R2, Math.PI / 2, 0, col[0], col[1], col[2], al);
        Gl.emit(TP.ring, T.x, gy + 0.32, -T.d, 0, R2 * 0.6, R2 * 0.6, R2 * 0.6, Math.PI / 2, 0, col[0], col[1], col[2], al);
        Gl.emit(TP.lane, T.x, gy + 0.26, -T.d, 0, R2 * 1.4, 1, R2 * 1.4, 0, 0, col[0], col[1], col[2], al * 0.5);
      }
      if (rdy) S.emit(TP.shot, T.x, gy + 7 + pu * 0.8, -T.d, t * 3, 1.3, 1.3, 1.3, 0, 0, col[0], col[1], col[2], 1);   // floating icon
      if (T.drop != null) {
        const k = clamp(T.drop / 0.9, 0, 1);
        for (let i = -4; i <= 4; i++) { const ix = i * (hwOf(w, T.zd) / 4.5); Gl.emit(TP.ice, ix, w.groundY(ix, T.zd) + (1 - k) * (1 - k) * 22 + 1.2, -T.zd, 0, 0.7, 2.4, 0.7, Math.PI, 0, 0.7, 0.95, 1, 0.95); Gl.emit(TP.ring, ix, w.groundY(ix, T.zd) + 0.3, -T.zd, 0, 1.5 * k, 1.5 * k, 1.5 * k, Math.PI / 2, 0, 1, 0.3, 0.2, 0.5 * k); }
      }
    }
    const L = B.laser;
    if (L) {
      const gy = w.groundY(0, L.d) + 0.7, on = L.on, hw = w.halfWidth(L.d) + 2;
      const a = on ? 0.9 : 0.25 + 0.3 * Math.sin(t * 22), th = on ? 1.5 : 0.5;
      const seg = (x0, x1, r, g, bl, al, wd) => { if (x1 - x0 > 0.2) Gl.emit(TP.lane, (x0 + x1) / 2, gy, -L.d, Math.PI / 2, wd, 1, x1 - x0, 0, 0, r, g, bl, al); };
      seg(-hw, L.g0, 1, on ? 0.25 : 0.15, 0.2, a, th); seg(L.g1, hw, 1, on ? 0.25 : 0.15, 0.2, a, th);
      seg(L.g0, L.g1, 0.3, 1, 0.5, 0.35 + 0.15 * Math.sin(t * 10), 0.7);
    }
    for (const R of B.rings) {
      const n = 22;
      for (let i = 0; i < n; i++) {
        const an = R.a0 + ((i + 0.5) / n - 0.5) * 2.6;
        if (Math.abs(an - R.gapA) < R.gapH) continue;
        const x = R.cx + Math.sin(an) * R.R, d = R.cd - Math.cos(an) * R.R;
        if (Math.abs(x) > w.halfWidth(d) + 3) continue;
        Gl.emit(TP.ring, x, w.groundY(x, d) + 0.5, -d, 0, 0.9, 0.9, 0.9, Math.PI / 2, 0, 0.7, 0.9, 1, 0.85);
      }
    }
    const C = B.lane;
    if (C) {
      const dx = C.x1 - C.x0, dz = -(C.d1 - C.d0), len = Math.hypot(dx, dz);
      const y0 = w.groundY(C.x0, C.d0), y1 = w.groundY(C.x1, C.d1);
      Gl.emit(TP.lane, (C.x0 + C.x1) / 2, (y0 + y1) / 2 + 0.3, -(C.d0 + C.d1) / 2, Math.atan2(dx, dz), C.w, 1, len, -Math.atan2(y1 - y0, len), 0, 1, 0.22, 0.15, C.solid ? 0.7 : 0.25 + 0.3 * Math.sin(t * 20));
    }
  }

  _drawLevel(S, Gl, TP, t, lo, hi) {
    const w = this.world;
    this._drawBoss(S, Gl, TP, t);
    for (let i = 0; i < this.strips.length; i++) {
      const q = this.strips[i];
      if (q.d + q.len < lo || q.d > hi) continue;
      const n = Math.max(1, Math.round(q.len / 4)), sl = q.len / n;
      for (let k = 0; k < n; k++) {
        const d = q.d + (k + 0.5) * sl;
        S.emit(TP.strip, q.x, w.groundY(q.x, d) + 0.16, -d, 0, q.w, 1, sl, this._tilt(q.x, d), 0, 1, 1, 1, 1);
      }
    }
    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i];
      if (h.d + h.rd < lo || h.d - h.rd > hi) continue;
      const y = w.groundY(h.x, h.d) + 0.12, pulse = 0.5 + 0.5 * Math.sin(t * 3 + h.ph);
      if (h.kind === 'puddle') {
        Gl.emit(TP.disc, h.x, y, -h.d, 0, h.rx, 1, h.rd, this._tilt(h.x, h.d), 0, 1, 0.42, 0.14, 0.55 + 0.2 * pulse);
        Gl.emit(TP.ring, h.x, y + 0.04, -h.d, 0, h.rx, h.rx, h.rx, Math.PI / 2, 0, 1, 0.55, 0.2, 0.8);
      } else {
        Gl.emit(TP.lane, h.x, y, -h.d, 0, h.rx * 2, 1, h.rd * 2, this._tilt(h.x, h.d), 0, 1, 0.9, 0.75, 0.5 + 0.2 * pulse);
      }
    }
    for (let i = 0; i < this.cannons.length; i++) {
      const c = this.cannons[i];
      if (c.d < lo || c.d > hi) continue;
      S.emit(TP.cannon, c.x, w.groundY(c.x, c.d) + 0.45 * c.sc, -c.d, 0, c.sc, c.sc, c.sc, 0, c.side * Math.PI / 2, 1, 1, 1, 1);
      const T = c.tele;
      if (T) {
        const dx = T.x1 - T.x0, dz = -(T.d1 - T.d0), len = Math.hypot(dx, dz);
        const mx = (T.x0 + T.x1) / 2, md = (T.d0 + T.d1) / 2;
        const y0 = w.groundY(T.x0, T.d0), y1 = w.groundY(T.x1, T.d1);
        const pitch = -Math.atan2(y1 - y0, len);
        const pulse = 0.35 + 0.3 * Math.sin(t * 16);
        const wd = clamp(T.r * 1.5, 1.4, 12);
        const cr = T.red ? 1 : 0.92, cg = T.red ? 0.26 : 0.96, cb = T.red ? 0.2 : 1;
        Gl.emit(TP.lane, mx, (y0 + y1) / 2 + 0.3, -md, Math.atan2(dx, dz), wd, 1, len, pitch, 0, cr, cg, cb, pulse + 0.25);
      }
    }
    for (let i = 0; i < this.bridges.length; i++) {
      const q = this.bridges[i];
      if (q.state === 2 || q.d1 < lo || q.d0 > hi) continue;
      const xc = (q.x0 + q.x1) / 2, wd = q.x1 - q.x0;
      const n = Math.max(1, Math.round((q.d1 - q.d0) / 8)), sl = (q.d1 - q.d0) / n;
      const crack = q.state === 1 ? 0.5 + 0.5 * Math.sin(t * 40) : 0;
      for (let k = 0; k < n; k++) {
        const d = q.d0 + (k + 0.5) * sl;
        Gl.emit(TP.lane, xc, w.groundY(xc, d) + 0.22, -d, 0, wd, 1, sl, this._tilt(xc, d), 0, 0.62 + crack * 0.38, 0.88 - crack * 0.5, 1 - crack * 0.6, 0.5);
      }
    }
  }

  _tilt(x, d) {
    const w = this.world;
    return -Math.atan((w.groundY(x, d - 1) - w.groundY(x, d + 1)) / 2);
  }

  // ------------------------------------------------------------------ camera helper
  // Use instead of camera.lookAt(target): applies the flip barrel-roll and a speed FOV kick.
  lookAt(camera, target) {
    this._cam = camera;
    flipCamera(camera, target, this.rollNow);
    camera.lookAt(target);
    const m = this.mods;
    const want = (this.T.rocket > 0 ? 14 : 0) + (this.boost > 0 ? 8 : 0);
    this._fov += (want - this._fov) * 0.08;
    if (Math.abs(this._fov) < 0.02 && want === 0) this._fov = 0;
    camera.userData.fovBoost = this._fov;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const k of KEYS) if (this.T[k] > 0) this._buffOff(k);
    if (this._frozenAny) this._unfreeze();
    for (const a of this.armies) for (const p of a.members) p.alive = false;
    this.scene.remove(this.group);
    this.solid.dispose();
    this.glow.dispose();
    if (this.hud && this.hud.parentNode) this.hud.parentNode.removeChild(this.hud);
    this.hud = null;
    if (this._cam) { this._cam.up.set(0, 1, 0); this._cam.userData.fovBoost = 0; }
  }
}

// ===========================================================================
// CigGame — the rules
// ===========================================================================
const _near = [];

export class CigGame {
  // host: optional callbacks (all may be missing):
  //   sfx(name, a, b)  haptic(kind)  burst(x,y,d,n,color,speed,size,up)  puff(x,y,z,vx,vy,vz,size,life,color,alpha)
  //   text(str, atObj, cls)  toast(str)  shake(v)  hitStop(sec)  flash(kind)  kick(zoom, fov)  track(ev, data)
  //   tier(name, tierIdx)  hud(info)  hunger(frac, warn)  combo(n)  tons(t)  end(cause)  stickPos(q) [unused]
  // level = a plan from cigplan.js (ÇIĞ DAĞLAR); without it this is the endless avalanche, exactly as before
  constructor({ world, ball, plus, G, host = {}, level = null }) {
    this.L = level || null;
    this._afkAcc = 0;
    this._next = null;
    this.world = world; this.ball = ball; this.plus = plus; if (plus) plus.game = this; this.G = G; this.host = host;
    this.auto = false;
    this.bot = { mode: 'greedy', latency: 0.3, noise: 0.5, queue: [], tick: 0, rw: 0 };
    this.hudT = 0;
    this.progT = 0; this.progD = 0;
    this.lastPopT = -9; this.lastPopHapT = -9; this.lastTextT = -9;
    this.melting = 0;
    this.powerT = 0; this.feverT = 0; this.fevAt = 40; this.fevCd = 0; this.enemyTextT = -9;
    this.labelsShown = 0; this.labelT = 0; this._hungry = false;
    this.pullBudget = 0;
    this.wave = { on: false, d: 0, v: 0, t: 0, warned: false, mesh: null, calm: 0, n: 0 };
    this.stats = newStats();
    this.world.onArrive = (q) => this._arrive(q);
    this.world.onTopple = (t) => this._dominoFell(t);
    this._wireHooks();
  }

  // ---- lifecycle
  reset() {
    this._starNudge = null;
    const G = this.G, b = this.ball, w = this.world;
    if (this.loot) { try { this.plus.group.remove(this.loot.grp); } catch { /* optional */ } this._lootHud(this.loot, false); this.loot = null; }
    const r0 = this.L ? this.L.r0 : CFG.startR;
    Object.assign(G, {
      state: 'play', targetX: 0, combo: 0, comboT: 0, swallowed: 0, townTons: 0, destroyed: 0,
      bumpCd: 0, recoverT: 0, momentumT: 0, timeScale: 1, hitStop: 0, hitStopCd: 0, shake: 0,
      onRamp: false, lastRamp: 0, tier: tierOf(r0), peakR: r0, slowT: 0, t: 0, endT: 0, cause: '', result: null,
      goldenTons: 0, bonusTons: 0, gatesBroken: 0, gateSlow: 0, comboUiT: 0, sprayT: 0, finalized: false, avl: tierOf(r0),
      // ÇIĞ DAĞLAR
      mom: 0, momT: 0, hitT: 0, hitPending: false, dn: 0, momMsg: false, hazFloor: 0, hazMsg: null, hazSeen: {}, chain: 0, chainT: 0, chainMul: 1, stripT: 0, stripNew: false, surgeT: 0, knockT: 0, knockV: 0, gateIdx: 0, tersDone: false, finalBroken: false, finalR: 0, bossFail: null, win: false, lastBounce: null, gateLog: [],
    });
    b.reset(r0);
    b.y = w.groundY(0, 0) + b.r * 0.92;
    b.speed = CFG.startSpeed * (this.L ? this.L.speedK * 1.2 : 1);
    this._afkAcc = 0; this._next = null; this._snowT = [];
    this.progT = 0; this.progD = 0;
    this.wave.on = false; this.wave.warned = false; this.wave.calm = 0; this.wave.n = 0;
    this.stats = newStats();
    this.powerT = 0; this.feverT = 0; this.fevAt = 40; this.fevCd = 0;
    this.bot.queue.length = 0; this.bot.tick = 0;
    this.melting = 0;
    this.hudT = 0;
    this.labelsShown = 0; this.labelT = 0; this._hungry = false; this._recNear = false; this._recHit = false;
  }

  snowTons() { return (4 / 3) * Math.PI * this.ball.r ** 3 * CFG.snowDensity; }
  totalTons() { return this.snowTons() + this.G.swallowed + this.G.townTons + this.G.bonusTons; }
  tier() { return tierOf(this.ball.r); }
  dieR() { return Math.max(CFG.minR, CFG.dieK * this.G.peakR); }
  hungerFrac() {
    const lo = this.dieR(), hi = Math.max(this.G.peakR, lo + 0.01);
    return clamp((this.ball.r - lo) / (hi - lo), 0, 1);
  }
  targetSpeed() {
    const M = this.plus.mods;
    const r = this.ball.r;
    const cap = CFG.maxSpeed * (1 + 0.25 * clamp(Math.log2(Math.max(1, r / 8)), 0, 3)); // huge balls may go a bit faster (it feels slow otherwise)
    let v = Math.min(cap, CFG.baseSpeed + CFG.sizeSpeed * Math.sqrt(r)) * M.speedMul * (this.powerT > 0 ? CFG.powerSpeed : 1) * (this.feverT > 0 ? 1.1 : 1);
    if (this.L) {
      // every mountain is faster than the last (speedK), a tier-up gives a short speed wave, a speed strip a longer boost
      const G = this.G, K = CFG.lvl;
      v *= this.L.speedK * (1 + K.surgeMul * clamp(G.surgeT / K.surgeT, 0, 1));
      if (G.stripT > 0) v *= 1 + (K.stripMul - 1) * Math.min(1, G.stripT / 0.5);
      v *= 1 + 0.2 * clamp(1 - G.t / 20, 0, 1);   // brisk first 20 s
      v *= 1.15 * (1 + 0.35 * G.mom);             // ÇIĞ DAĞLAR: +15% top speed, momentum up to +35%
    }
    return v;
  }

  // ---- momentum (ÇIĞ DAĞLAR): clean rolling (no hit, never uphill) builds it over MOM_T s, boosters count double.
  // +35% top speed at full, faster downhill acceleration, bigger smash threshold and suction radius. Hits halve it,
  // uphill and shrink pads bleed it. Also drives the hazard messages and the speed-line sparks.
  _momTick(dt) {
    const G = this.G, b = this.ball, w = this.world;
    if (G.hitPending) { G.hitPending = false; G.momT *= 0.5; G.hitT = 0.8; }
    G.hitT -= dt;
    const slope = w.groundY(b.x, b.d + 3) - w.groundY(b.x, b.d);   // < 0: downhill
    G.dn = clamp(-slope / (3 * CFG.grade), 0, 1);
    if (slope > 0.05) G.momT -= 1.5 * dt;
    else if (G.hitT <= 0 && !b.airborne) G.momT += dt * (G.stripT > 0 ? 2 : 1) * (0.6 + 0.4 * G.dn);
    G.momT = clamp(G.momT, 0, MOM_T);
    G.mom = G.momT / MOM_T;
    G.hazFloor = this.dieR() * 1.25;
    if (G.hazMsg) {
      const k = G.hazMsg; G.hazMsg = null;
      if (!G.hazSeen[k]) { G.hazSeen[k] = 1; this._msg(2, k === 'puddle' ? '♨️ Sıcak su: küçülürsün! Kenarından dolan.' : '🧂 Tuz şeridi: yavaş eriyorsun, hızın düşer.'); }
    }
    if (!G.momMsg && G.mom >= 0.999) { G.momMsg = true; this._msg(2, 'MOMENTUM! Tam hız.'); }
    if (G.mom > 0.3 && !b.airborne) {
      this._slT = (this._slT || 0) - dt;
      if (this._slT <= 0) { this._slT = 0.12; this._h('burst', b.x + (Math.random() - 0.5) * 2 * b.r, b.y + b.r * 0.3, b.d - b.r * 1.2, 2, 0xe8f7ff, 8 + b.speed * 0.3, 0.1 + b.r * 0.02, 1.5); }
    }
  }
  _momK() { return this.L ? 1 + 0.3 * this.G.mom : 1; }

  // ---- ÇIĞ DAĞLAR helpers
  _eff() { return this.ball.r * (this.G.stripT > 0 ? 1 + CFG.lvl.stripRam : 1); }   // effective size at a barrier (a strip = a harder hit)
  _band() { return this.L ? bandRel(this.world.expectAt(this.ball.d), this.ball.r) : bandAt(this.ball.r, this.ball.d); }
  // all growth goes through here: a mountain has a hard size cap (rCap)
  _grow(r3) { this.ball.setRadius(Math.min(Math.cbrt(r3), this.L ? this.L.rCap : Infinity)); }
  _cm() { return this.L ? this.G.chainMul || 1 : 1; }   // chain multiplier for the ton score
  _inArena() { const L = this.L; return !!(L && L.finale.kind === 'boss' && !this.G.finalBroken && this.ball.d > L.dF - 170); }
  _readyOf(g) {
    if (g.locked) { const e = this._eff(); return e >= g.minR * 0.995 ? 2 : e >= g.minR * CFG.lvl.amberFrom ? 1 : 0; }   // PATRON size
    if (this.powerT > 0 || this.plus.mods.plow) return 2;
    const e = this._eff();
    return e >= g.minR * CFG.lvl.gateTol ? 2 : e >= g.minR * CFG.lvl.amberFrom ? 1 : 0;
  }
  suctionR() {
    const b = this.ball, M = this.plus.mods;
    return (this.L ? 1 + 0.12 * this.G.mom : 1) * (b.r * CFG.suctionK + CFG.suctionC) * (M.magnet ? 2 : 1) * (M.eatMul > 1 ? 1.25 : 1) * (this.powerT > 0 ? CFG.powerSuction : 1) * (this.feverT > 0 ? 1.45 : 1);
  }

  _h(name, a, b, c, d, e, f, g, h, i, j) {
    const fn = this.host[name];
    if (fn) fn.call(this.host, a, b, c, d, e, f, g, h, i, j);
  }

  // ---- message queue: every ÇIĞ callout (toast / tier banner) goes through here. One visible at a time;
  // priority 3 danger > 2 milestone > 1 info. Info is dropped when stale; danger jumps ahead of everything waiting
  // (and replaces a visible info toast), a visible milestone is allowed to finish first.
  _msg(pri, str, a, b) {
    const q = this._mq || (this._mq = []);
    const key = str == null ? 'tier' + a : str;
    for (let i = 0; i < q.length; i++) if (q[i].key === key) return;
    if (this._mCur && this._mCur.key === key) return;
    q.push({ pri, str, a, b, key, t: this.G.t });
    if (pri === 3) for (let i = q.length - 2; i >= 0; i--) if (q[i].pri === 1) q.splice(i, 1);
    if (pri === 3 && this._mCur && this._mCur.pri === 1) this._mCur = null;
    this._msgTick();
  }
  _msgTick() {
    const G = this.G, q = this._mq;
    if (this._mCur && G.t >= this._mCur.until) this._mCur = null;
    if (this._mCur || !q || !q.length) return;
    let bi = -1;
    for (let i = 0; i < q.length; i++) {
      const m = q[i];
      if (m.pri === 1 && G.t - m.t > 3) { q.splice(i--, 1); continue; }
      if (m.pri === 2 && G.t - m.t > 10) { q.splice(i--, 1); continue; }
      if (m.str == null && this.plus.bossFx && !this.plus.bossFx.dead) continue;   // tier banners wait until the boss fight is over
      if (bi < 0 || m.pri > q[bi].pri) bi = i;
    }
    if (bi < 0) return;
    const m = q.splice(bi, 1)[0];
    if (m.str == null) this._h('tier', m.a, m.b); else this._h('toast', m.str);
    this._mCur = { pri: m.pri, key: m.key, until: G.t + (m.pri === 3 ? 2.2 : m.str == null ? 2.8 : m.pri === 2 ? 2.4 : 1.7) };
  }

  // ---- main per-frame entry (dt already includes time scale); steerM = meters the target moved this frame
  update(dt, steerM = 0) {
    const G = this.G, b = this.ball, w = this.world, M = this.plus.mods;
    G.t += dt;
    G.bumpCd -= dt; G.recoverT -= dt; G.momentumT -= dt;
    G.comboT -= dt; G.gateSlow = (G.gateSlow || 0) - dt;
    if (this.feverT > 0) { this.feverT -= dt; if (this.feverT <= 0) this.feverT = 0; }
    if (this.powerT > 0) { this.powerT -= dt; if (this.powerT <= 0) { this.powerT = 0; if (!this.L) this._msg(1, 'Güç bitti'); } }
    this.plus.boost = this.powerT + (G.stripT > 0 ? 1 : 0);
    this._afk(dt);
    if (this.L) this._levelTick(dt);
    w.tintR = b.r; w.tintEat = CFG.eatRatio * M.eatMul;
    this._events();
    this._labelAhead(dt);
    this._msgTick();
    this._secretGlow();
    if (G.comboT <= 0 && G.combo) { G.combo = 0; this._comboUi(0); }

    // steering: first-order follower on the finger target (no lag spring)
    const hw = w.halfWidth(b.d);
    const lim = Math.max(0.5, hw - b.r * 0.55);
    if (this.auto) G.targetX = this._botTarget(dt, lim);
    else G.targetX += steerM;
    const tw = this.L ? this.L.twist : null;
    if (tw === 'wind') G.targetX += 5 * Math.sin(G.t * 0.45) * dt;   // twist: a side wind drifts the finger target, you have to hold against it
    G.targetX = clamp(G.targetX, -lim, lim);
    const lam = (CFG.steerLam / (1 + b.r * CFG.steerMassK)) * M.steerMul * (tw === 'ice' ? 0.8 : 1);
    const maxV = 30 + 3 * b.r;
    const want = clamp((G.targetX - b.x) * lam, -maxV, maxV);
    b.vx += (want - b.vx) * (1 - Math.exp(-CFG.steerFilter * Math.max(1, M.steerMul) * (tw === 'ice' ? 0.55 : 1) * dt));   // (ice twist: the ball slides)

    // speed: heavier = faster
    const target = this.targetSpeed();
    let acc = CFG.accel * M.accelMul * (G.recoverT > 0 ? CFG.recoverBoost : 1);
    if (this.L) acc *= 1 + 0.35 * G.dn;   // downhill: faster acceleration
    if (this.L && G.stripT > 0) acc *= 3;
    if (this.L && G.stripNew) { G.stripNew = false; b.speed = Math.max(b.speed, target * 0.95); }
    if (G.knockT > 0) b.speed = 0;   // thrown back by a barrier: the ball moves by knockV (see _step), then accelerates again
    else b.speed += clamp(target - b.speed, -CFG.decel * dt, acc * dt);

    const steps = Math.max(1, Math.ceil((b.speed * dt) / Math.max(0.3, b.r * 0.45)));
    this.pullBudget = CFG.pullsPerStep * steps;
    for (let i = 0; i < steps; i++) this._step(dt / steps, lim);
    this._enemies(dt);
    this._tips();
    // never crawl: a minimum forward speed (only a too-small size gate may slow you down)
    if (G.gateSlow <= 0 && b.speed < target * CFG.minSpeedFrac) b.speed = target * CFG.minSpeedFrac;

    this._melt(dt);
    this._wave(dt, target);
    this._loot(dt);
    this._stallGuard(dt);
    this._ambient(dt);
    this._tierCheck();
    if (this.L) this._levelAfter();

    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this._hud(); }
  }

  // ---- readable cues: events announce themselves, the first too-big things on your line wear a size tag
  _events() {
    if (this.L) { this._levelEvents(); return; }
    const b = this.ball, ev = this.world.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.seen) continue;
      if (b.d < e.d0 - (e.kind === 'town' ? 70 : 0)) continue;
      e.seen = true;
      let msg = '';
      if (e.kind === 'town') msg = '🏘️ KASABA ÖNÜNDE: hepsini yut!';
      else if (e.kind === 'golden') msg = '🌟 ALTIN KARTOPU ÖNÜNDE!';
      else if (e.kind === 'gate' && e.gate) {
        const g = e.gate, need = fmtD(g.minR * 2);
        msg = b.r >= g.minR * 0.97 ? `⛔ KAPI ÖNÜNDE (${need} m): yıkabilirsin!` : `⛔ KAPI ÖNÜNDE: ${need} m olmalısın, ye ve büyü!`;
      }
      if (!msg) continue;
      this._msg(1, msg);
      this._h('haptic', 'light');
    }
  }

  // "⛔ 6 m" = the ball's diameter you need to swallow it. Tagged BEFORE you reach it (a few per run, fewer once you know the rule).
  _labelAhead(dt) {
    this.labelT -= dt;
    if (this.labelT > 0) return;
    this.labelT = 0.3;
    const budget = this.host.labelBudget ? this.host.labelBudget() : 4;
    if (this.labelsShown >= budget || this._bossNear()) return;
    const b = this.ball, w = this.world;
    const look = 26 + b.speed * 1.2;
    w.query(b.x, b.d + look * 0.5, look * 0.5, _near);
    let best = null, bestD = 1e9;
    for (let i = 0; i < _near.length; i++) {
      const p = _near[i];
      if (!p.alive || p.tag || p.move !== MOVE_NONE || p.kind === 'chunk' || p.decor || p.enemy || p.crate || p.statue || p.domino || p.throne || p.r <= b.r * CFG.smashRatio || this._edible(p)) continue;
      const dd = p.d - b.d;
      if (dd < 8 || dd > look) continue;
      if (Math.abs(p.x - b.x) > b.r + p.r * CFG.contactK + 4) continue;
      if (dd < bestD) { bestD = dd; best = p; }
    }
    if (best) { this.labelsShown++; w.tagObstacle(best, `⛔ ${fmtD(best.r / CFG.eatRatio * 2)} m`); }
  }

  // ---- one physics substep
  _step(dt, lim) {
    const G = this.G, b = this.ball, w = this.world, M = this.plus.mods;
    const px = b.x, pd = b.d;
    b.x += b.vx * dt;
    let vF = b.speed;
    if (G.knockT > 0) { vF = -G.knockV * clamp(G.knockT / CFG.lvl.bounceDur, 0, 1); G.knockT -= dt; }   // (linear fade: the ball is thrown back by a barrier)
    b.d += vF * dt;
    if (b.x < -lim || b.x > lim) { b.x = clamp(b.x, -lim, lim); b.vx *= -0.2; }

    const ramp = w.rampAt(b.x, b.d);
    const rest = w.groundY(b.x, b.d) + ramp + this.plus.lift(b.x, b.d) + b.r * 0.92;
    if (b.airborne) {
      b.vy -= CFG.gravity * M.gravityMul * dt;
      b.y += b.vy * dt;
      b.airTime += dt;
      if (b.y <= rest && b.vy < 0) this._land(rest);
    } else if (G.onRamp && ramp === 0 && G.lastRamp > 0.8) {
      this._launch();
    } else {
      b.y = rest;
    }
    G.lastRamp = ramp;
    G.onRamp = ramp > 0;
    b.roll(b.x - px, b.d - pd);

    this._gates(pd);
    this._collide();
  }

  _launch() {
    const b = this.ball;
    b.airborne = true; b.airTime = 0;
    b.vy = (this.L ? RAMP_AIR_K : 1) * Math.min(CFG.hopMax, 4 + b.speed * 0.18);   // a short hop, not a flight (ÇIĞ DAĞLAR: ~1/3 less airtime)
    this._h('sfx', 'whoosh');
    this._h('haptic', 'light');
  }

  _land(rest) {
    const b = this.ball, G = this.G;
    b.airborne = false; b.y = rest; b.vy = 0;
    G.timeScale = 1;
    const k = clamp(b.airTime / 1.2, 0.2, 1);
    this._h('sfx', 'land', k);
    this._h('haptic', 'heavy');
    G.shake += 0.45 * k + 0.1 * b.r * k;
    b.squash(0.18 + 0.2 * k);
    this._h('burst', b.x, b.y - b.r * 0.8, b.d, 14, 0xffffff, 6 + b.r, 0.25 + b.r * 0.08, 5);
    // belly-flop: everything edible around the landing point is sucked in
    this.world.query(b.x, b.d, b.r * 1.9 + 1, _near);
    for (let i = 0; i < _near.length; i++) {
      const p = _near[i];
      if (!p.alive || !this._edible(p)) continue;
      if (Math.hypot(p.x - b.x, p.d - b.d) < b.r * 1.9) this.world.pull(p, b, CFG.pullMin);
    }
  }

  _edible(p) {
    if (p.enemy || p.crate || p.statue || p.domino || p.throne) return false;
    return p.kind === 'chunk' || p.r <= this.ball.r * CFG.eatRatio * this.plus.eatMulFor(p);
  }

  // ---- collisions: suction first (edible), bumps for the rest
  _collide() {
    const b = this.ball, w = this.world, M = this.plus.mods;
    const Rs = this.suctionR();
    const pw = this.powerT > 0;
    w.query(b.x, b.d, Rs + 1, _near);
    for (let i = 0; i < _near.length; i++) {
      const p = _near[i];
      if (!p.alive) continue;
      const dx = p.x - b.x, dd = p.d - b.d;
      const dist = Math.hypot(dx, dd);
      const above = (b.y - b.r) - (p.y + p.h);       // > 0: the ball's bottom is above the prop's top (hopping over it)
      if (p.crate) { if (dist <= b.r + p.r * CFG.contactK && !(b.airborne && above > 0)) this._breakCrate(p, dx, dd, dist); continue; }
      if (p.enemy) { this._enemyContact(p, dx, dd, dist, above); continue; }
      if (this._edible(p)) {
        if (dist - p.r * CFG.contactK > Rs) continue;
        if (b.airborne && above > Rs * 0.5) continue;
        if (this.pullBudget <= 0) continue;
        this._startPull(p, dist, Rs);
        continue;
      }
      if (b.airborne && above > 0) continue;
      const contact = b.r + p.r * CFG.contactK;
      if (dist > contact) continue;
      if (M.ghost) continue;
      // small / medium: smash straight through (partial growth); power or rocket: smash anything; too big: glance off sideways
      if (M.plow || pw || p.domino || (p.throne && p.r <= b.r * this._momK() * CFG.smashRatio * 1.3) || p.r <= b.r * this._momK() * CFG.smashRatio) { this._smash(p, true); continue; }
      this._deflect(p, dx, dd, dist, contact);
    }
  }

  _startPull(p, dist, Rs) {
    const b = this.ball;
    const u = clamp((dist - b.r) / Math.max(0.5, Rs - b.r), 0, 1);
    const dur = CFG.pullMin + (CFG.pullMax - CFG.pullMin) * u + 0.05 * Math.min(1, p.r / Math.max(0.2, b.r));
    if (this.world.pull(p, b, Math.min(CFG.pullMax, dur))) this.pullBudget--;
  }

  // The prop reached the ball: it sticks, the ball grows, points and a pop.
  _arrive(q) {
    const G = this.G, b = this.ball, M = this.plus.mods;
    if (G.state !== 'play' && G.state !== 'end') return;
    const chunk = q.kind === 'chunk';
    const gain = CFG.growK * q.r ** 3 * (chunk ? CFG.chunkGain : this._band()) * (this.feverT > 0 ? 1.15 : 1);
    const rb = b.r;
    this._grow(b.r ** 3 + gain);
    b.punch(Math.min(0.09, 0.45 * q.r / Math.max(0.2, rb)));
    if (!chunk) {
      _stickPos.set(q.x, q.y, -q.d);
      b.stick(q.def, _stickPos, q.s0, 0.6);
    } else this.stats.chunksEaten++;
    G.combo = G.comboT > 0 ? G.combo + 1 : 1;
    if (G.combo === 1) this.fevAt = 40;   // a fresh chain: the first frenzy comes at x40
    const rid = b.riderN();   // EKİP TOPU: each rider = +10% combo time and score
    G.comboT = CFG.comboWindow * (1 + 0.1 * rid);
    G.swallowed += q.mass * M.tonMul * (q.tonK || 1) * (1 + 0.02 * Math.min(G.combo, 50)) * this._cm() * (1 + 0.1 * rid) * (this.feverT > 0 ? 1.5 : 1);
    if (!chunk && /snowman/i.test(q.type)) this._crew(); // a long chain is worth up to double
    if (G.combo > this.stats.maxCombo) this.stats.maxCombo = G.combo;
    this.stats.eats++;
    this._comboUi(G.combo);
    const nowT = G.t;
    if (nowT - this.lastPopT > 0.03) {
      this.lastPopT = nowT;
      this._h('sfx', 'pop', clamp(q.r / Math.max(0.3, b.r) * 0.9, 0, 1), G.combo);
      if (q.r > b.r * 0.35) this._h('puff', b.x, b.y + b.r * 0.55, -(b.d - b.r * 0.3), (Math.random() - 0.5) * 2, 1.6, 0, 0.4 + q.r * 0.5, 0.6, 0xf4f8ff, 0.5);
    }
    if (nowT - this.lastPopHapT > 0.09) {
      this.lastPopHapT = nowT;
      this._h('haptic', q.r > b.r * 0.5 ? 'medium' : 'light');
    }
    this._h('burst', q.x, q.y, q.d, 2 + Math.min(4, Math.round(q.r / Math.max(0.3, b.r) * 6)), 0xffffff, 1.5 + Math.min(4, q.r), 0.08 + Math.min(0.2, q.r * 0.06), 3);
    if (!chunk) this._h('track', 'swallow', { type: q.type });
    const label = LABEL[q.type];
    if (label && q.r > b.r * 0.8) { const seen = this._seen || (this._seen = new Set()); if (!seen.has(q.type)) { seen.add(q.type); this._text(`${label}!`, q, ''); } }
    else if (G.combo >= this.fevAt && G.t >= this.fevCd) this._fever(G.combo);
    else if (G.combo > 0 && G.combo % 15 === 0) this._msg(1, `x${G.combo}!`);
    this._tierCheck();
  }

  // ÇIĞ ÇILGINLIĞI: a x40 combo (then every +80, 10 s apart) = 4 s of frenzy (wider suction, +15% growth, x1.5 tons, a little faster).
  // It never smashes gates (that stays GÜÇLENDİN!'s job), so the size checks of a mountain keep their meaning.
  _fever(n) {
    const b = this.ball, G = this.G;
    const was = this.feverT > 0;
    this.feverT = 4;
    this.fevAt = n + 80; this.fevCd = G.t + 10;   // the next one needs +80 more and 10 s: a reward, not a permanent state
    this.stats.fevers = (this.stats.fevers || 0) + 1;
    this._h('track', 'fever', {});
    G.shake += 0.3;
    this._h('kick', 0.12, 6);
    this._h('flash', 'milestone');
    this._h('sfx', 'pop', 1, 30);
    this._h('haptic', 'success');
    this._h('burst', b.x, b.y + b.r * 0.5, b.d, 18, 0x8ff4ff, 8 + b.r, 0.25 + b.r * 0.05, 6);
    this._msg(2, was ? `ÇILGINLIK UZADI! x${n}` : `🌪️ ÇIĞ ÇILGINLIĞI! x${n}`);
  }

  // EKİP TOPU: 3+ snowmen swallowed within 3 s -> a mini snowman climbs on top of the ball (max 3)
  _crew() {
    const G = this.G, b = this.ball, a = this._snowT || (this._snowT = []);
    this._tip('riders', TIPS.riders);
    a.push(G.t);
    while (a.length && G.t - a[0] > 3) a.shift();
    if (a.length < 3 || b.riderN() >= 3) return;
    a.length = 0;
    b.setRiders(b.riderN() + 1);
    b.punch(0.05);
    this._msg(1, `EKİP TOPU ${b.riderN()}/3`);
    this._h('sfx', 'pop', 1, 20);
    this._h('haptic', 'medium');
    this._h('burst', b.x, b.y + b.r, b.d, 10, 0xffffff, 4, 0.2, 5);
  }
  _dropRider() {
    const b = this.ball;
    if (!b.riderN()) return;
    b.dropRider();
    this._msg(1, 'Ekip düştü! Kaçıyor...');
    this._h('burst', b.x, b.y + b.r, b.d, 8, 0xffffff, 5, 0.2, 5);
  }

  _comboUi(n) {
    const G = this.G;
    if (n === 0 || G.t - G.comboUiT > 0.06 || n % 5 === 0) { G.comboUiT = G.t; this._h('combo', n); }
  }

  // Floating callouts are rare on purpose (max ~1 per second); `imp` ones (power names, gates) may follow after 0.35 s.
  _text(str, at, cls = '', imp = false) {
    // every callout goes through the single message queue (one at a time, dedup, priority); no free-floating text
    this._msg(imp || cls === 'bad' || cls === 'big' ? 2 : 1, str);
  }

  // Shatter something on the way. Gives a little growth (grow = true); never stops the ball.
  _smash(p, grow = false) {
    const w = this.world, b = this.ball, G = this.G;
    w.kill(p);
    G.destroyed++;
    this.stats.smashes++;
    G.townTons += p.mass * this.plus.mods.tonMul * 0.5 * this._cm();
    if (this.L && grow) this._chainHit(1);
    if (grow) {
      const big = p.r > b.r * CFG.smashRatio;
      const gain = Math.min(CFG.growK * (this.L ? CFG.lvl.smashGrow : CFG.smashGrow) * p.r ** 3 * this._band(), (big ? 0.06 : 0.14) * b.r ** 3);
      if (gain > 0) { this._grow(b.r ** 3 + gain); b.punch(0.04); }
    }
    b.speed *= 0.985;
    this._h('burst', p.x, p.y + p.h * 0.5, p.d, 10, w.colorOf(p.type), 7, 0.25 + p.r * 0.08, 6);
    this._h('puff', p.x, p.y + p.h * 0.4, -p.d, (Math.random() - 0.5) * 4, 2.2, -1.5, 0.9 + p.r * 0.8, 0.9, 0xe9eff7, 0.6);
    this._h('puff', p.x + (Math.random() - 0.5) * p.r, p.y + p.h * 0.15, -p.d, (Math.random() - 0.5) * 3, 1.4, -2.5, 0.7 + p.r * 0.6, 0.8, 0xf4f8ff, 0.5);
    if (G.t - (this._smashSfxT || -9) > 0.08) { this._smashSfxT = G.t; this._h('sfx', 'crash', 0.3); this._h('haptic', 'medium'); }
    G.shake += 0.12;
    if (grow && p.r > b.r * 1.0 && LABEL[p.type] && !p.domino) { const seen = this._seen || (this._seen = new Set()); if (!seen.has('s' + p.type)) { seen.add('s' + p.type); this._text(LABEL[p.type] + ' EZİLDİ!', p, ''); } }
    this._h('track', 'smash', {});
    if (p.statue) this._statueBroken(p);
    if (p.domino) this._dominoStart(p);
    if (p.throne) this._throneStart(p);
    if (grow) this._tierCheck();
  }

  // DOMİNO ÇAM: smashing one pine topples the rest of its row in a chain (away from the hit tree); each fall pays growth.
  _dominoStart(p) {
    const row = p.domino.row;
    if (row.hit) return;
    row.hit = true; row.got = 1;
    for (const t of row.trees) {
      if (t === p || !t.alive) continue;
      this.world.topple(t, 0.18 + 0.17 * Math.abs(t.domino.i - p.domino.i), Math.sign(t.x - p.x) || 1);
    }
    if (row.trees.length < 2) this._dominoDone(row);
  }
  _dominoFell(t) {
    if (t.throne) { this._throneFell(t); return; }
    const row = t.domino && t.domino.row, b = this.ball;
    if (!row) return;
    row.got++;
    const gain = CFG.growK * 0.05 * b.r ** 3 * this._band();
    if (gain > 0) this._grow(b.r ** 3 + gain);
    this.G.destroyed += 1;
    this._h('burst', t.x, t.y + t.h * 0.3, t.d, 8, 0xffffff, 5, 0.2 + t.r * 0.05, 5);
    if (this.G.t - (this._domSfxT || -9) > 0.1) { this._domSfxT = this.G.t; this._h('sfx', 'crash', 0.35); }
    this._text('DOMİNO x' + row.got + '!', t, 'big', true);
    if (row.got >= row.n) this._dominoDone(row);
  }
  _dominoDone(row) {
    if (row.done) return;
    row.done = true;
    this._grow(this.ball.r ** 3 * 1.05);
    this._msg(2, 'DOMİNO x' + row.got + '!');
    this._h('sfx', 'milestone', 2);
    this._h('haptic', 'success');
    this.G.shake += 0.3;
  }

  _throneStart(p) {
    const tw = p.throne.tw;
    if (tw.hit) return;
    tw.hit = true;
    if (tw.deco) tw.deco.visible = false;
    this._msg(2, 'TAHT SARSILIYOR!');
    this._h('sfx', 'rumble');
    for (const t of tw.blocks) {
      if (t === p || !t.alive || t.throne.i < p.throne.i) continue;
      this.world.topple(t, 0.12 + 0.2 * (t.throne.i - p.throne.i), (t.throne.i % 2 ? 1 : -1) * (Math.sign(t.x - p.x) || 1));
    }
    this._throneFell(p, true);
  }
  _throneFell(t, direct) {
    const tw = t.throne.tw, b = this.ball;
    tw.got++;
    const gain = CFG.growK * 0.06 * b.r ** 3 * this._band();
    if (gain > 0) this._grow(b.r ** 3 + gain);
    this.G.destroyed += 1;
    this.G.combo = this.G.comboT > 0 ? this.G.combo + 1 : 1; this.G.comboT = CFG.comboWindow;
    this._h('burst', t.x, t.y + t.h * 0.4, t.d, 8, 0xffffff, 5, 0.2 + t.r * 0.05, 5);
    if (this.G.t - (this._domSfxT || -9) > 0.1) { this._domSfxT = this.G.t; this._h('sfx', 'crash', 0.35); }
    this._text('BLOK x' + tw.got, t, 'big', true);
    if (t.throne.i === tw.n - 1 && !tw.done) {
      tw.done = true;
      this._grow(b.r ** 3 * 1.2);
      this.stats.throne = (this.stats.throne | 0) + 1;
      this.G.destroyed += 4;
      this._msg(3, '👑 TAHT YIKILDI! BONUS');
      this._h('sfx', 'milestone', 2);
      this._h('haptic', 'success');
      this.G.shake += 0.4;
    }
  }

  _statueBroken(p) {
    const b = this.ball, set = p.statue.set;
    this.stats.statues = (this.stats.statues | 0) + 1;
    set.got++;
    const gain = CFG.growK * 0.07 * b.r ** 3 * this._band();
    if (gain > 0) { this._grow(b.r ** 3 + gain); b.punch(0.05); }
    this._text('HEYKEL YIKILDI ' + set.got + '/' + set.total, p, 'big', true);
    if (set.got >= set.total && !set.done) {
      set.done = true;
      this._grow(b.r ** 3 * 1.12);
      this.G.destroyed += 5;
      this._msg(2, 'HEYKEL SERİSİ! Tüm heykeller yıkıldı');
      this._h('sfx', 'crash', 0.6);
      this.G.shake += 0.4;
    }
  }

  // Too big to smash: the ball glances off and slides around it, never stopping (circle push along the lateral axis).
  _deflect(p, dx, dd, dist, contact) {
    const G = this.G, b = this.ball, w = this.world;
    G.hitPending = true;
    const lim = Math.max(0.5, w.halfWidth(b.d) - b.r * 0.55);
    const off = b.x - p.x;
    let side = Math.abs(off) > 0.15 * contact ? Math.sign(off) : (G.deflSide || (G.deflSide = Math.random() < 0.5 ? -1 : 1));
    const edge = Math.sqrt(Math.max(0, contact * contact - dd * dd)) + 0.05;
    let nx = p.x + side * edge;
    if (Math.abs(nx) > lim) { side = -side; nx = p.x + side * edge; }
    if (Math.abs(nx) > lim) { this._smash(p, true); return; }  // wall to wall: plough through, never a dead end
    b.x = nx;
    b.vx = side * Math.max(Math.abs(b.vx), 5 + 0.2 * b.speed);
    // (the steering target is left alone: an idle ball slides past and drifts back, it is never steered for you)
    if (G.bumpCd > 0) return;
    G.bumpCd = 0.35;
    const ratio = p.r / Math.max(0.2, b.r);
    b.speed *= 0.95;
    if (ratio > 1.6 && !this.plus.consumeShield()) {
      this._loseSnow(lerp(0.03, 0.1, clamp((ratio - 1.6) / 2, 0, 1)));
      this._dropRider();
      G.combo = 0; this._comboUi(0);
    }
    this.stats.bumps++;
    this._h('sfx', 'bump', clamp(p.r / (8 + b.r), 0.2, 0.6));
    this._h('haptic', 'light');
    G.shake += 0.25;
    b.squash(0.1);
    this._h('burst', b.x + (p.x - b.x) * 0.5, b.y, b.d, 6, 0xffffff, 5, 0.18 + b.r * 0.06, 4);
    if (this.labelsShown < 6 && !p.tag && !p.crate && !this._bossNear()) { this.labelsShown++; w.tagObstacle(p, '⛔ ' + fmtD(p.r / CFG.eatRatio * 2) + ' m'); }
    this._h('track', 'crash', {});
  }

  // ---- enemies (HP bars): ram them, they take damage, burst into XP
  _enemyContact(p, dx, dd, dist, above) {
    const b = this.ball, e = p.enemy;
    if (dist > b.r + p.r * 0.85) return;
    if (b.airborne && above > 0) return;
    if (e.rival) { this._rivalContact(p); return; }
    if (e.ai === 'arena') { this._bossResolve(p); return; }   // PATRON: eat it (big enough) or shatter on it
    // small enemies (relative to the ball) are flattened in one hit; a power / rocket flattens anything but bosses
    if (!e.boss && (p.r <= b.r * 0.8 || this.powerT > 0 || this.plus.mods.plow)) { this._killEnemy(p); return; }
    if (e.hitCd <= 0) this._hitEnemy(p, dx);
    this._slide(p);   // never pinned: the ball always glides around what it rams
  }

  // Slide the ball past an enemy (lateral push along the contact circle); if boxed in, shove the enemy aside instead.
  _slide(p) {
    const G = this.G, b = this.ball, w = this.world;
    const hw = w.halfWidth(b.d);
    const lim = Math.max(0.5, hw - b.r * 0.55);
    const contact = b.r + p.r * 0.85;
    const dd = p.d - b.d;
    const off = b.x - p.x;
    let side = Math.abs(off) > 0.12 * contact ? Math.sign(off) : (G.deflSide || (G.deflSide = Math.random() < 0.5 ? -1 : 1));
    const edge = Math.sqrt(Math.max(0, contact * contact - dd * dd)) + 0.05;
    let nx = p.x + side * edge;
    if (Math.abs(nx) > lim) { side = -side; nx = p.x + side * edge; }
    if (Math.abs(nx) > lim) { p.x = clamp(b.x - side * (edge + 0.3), -hw + 1, hw - 1); p.enemy.kbD = Math.max(p.enemy.kbD, 10 + b.speed); return; }
    b.x = nx;
    b.vx = side * Math.max(Math.abs(b.vx), 6 + 0.25 * b.speed);
    if (b.speed < this.targetSpeed() * 0.8) b.speed = this.targetSpeed() * 0.8;
  }

  // Rival snowball: eat it when you are bigger, it shaves you when it is bigger.
  _rivalContact(p) {
    const G = this.G, b = this.ball, e = p.enemy;
    if (b.r > p.r * 1.05) {
      e.hp = 0;
      this.world.kill(p);
      this.stats.kills++;
      const gain = Math.min(CFG.growK * p.r ** 3 * 1.2, 0.5 * b.r ** 3);
      this._grow(b.r ** 3 + gain);
      b.punch(0.12);
      const xp = Math.max(30, this.snowTons() * 0.4) * (e.roll ? 0.3 : 1);
      G.bonusTons += xp;
      this._h('burst', p.x, p.y + p.h * 0.5, p.d, 28, 0xeaf3ff, 10, 0.4 + p.r * 0.07, 8);
      this._h('hitStop', 0.09); G.shake += 0.8;
      this._h('sfx', 'crash', 0.7); this._h('sfx', 'milestone', 2); this._h('haptic', 'success'); this._h('flash', 'gold');
      this._text(e.roll ? 'TOP YUTULDU!' : 'RAKİP YUTULDU!', p, 'big', true);
      if (!e.roll) { this._msg(1, '+' + fmtTonsShort(xp) + ' XP'); this.stats.rivalEaten++; }
      if (this.L) this._chainHit(2);
      this._tierCheck();
      return;
    }
    if (p.r > b.r * 1.05 && (e.rcd || 0) <= 0) {
      e.rcd = 1.2;
      if (!this.plus.consumeShield()) {
        this._loseSnow(0.1);
        G.combo = 0; this._comboUi(0);
        this._text('RAKİP SENİ TIRAŞLADI!', b, 'bad', true);
      }
      b.speed *= 0.95; G.shake += 0.7; b.squash(0.15);
      this._h('sfx', 'bump', 0.7); this._h('haptic', 'heavy'); this._h('flash', 'hit');
      this._h('burst', b.x, b.y, b.d, 12, 0xeaf3ff, 8, 0.3, 5);
    }
    this._slide(p);
  }

  _hitEnemy(p, dx) {
    const G = this.G, b = this.ball, M = this.plus.mods, e = p.enemy;
    const target = this.targetSpeed();
    const mul = (this.powerT > 0 ? 3 : 1) * (M.plow ? 2 : 1);
    const dmg = CFG.ramDmg * b.r * (0.7 + 0.3 * clamp(b.speed / Math.max(1, target), 0, 1.3)) * mul;
    e.hp -= dmg;
    e.hitCd = 0.4; e.flash = 0.14; e.woke = true;
    e.kbD = Math.max(8, b.speed * 0.9); e.kbX = (dx >= 0 ? 1 : -1) * (3 + b.r * 0.4);
    b.speed *= 0.93;
    b.squash(0.12);
    this._h('hitStop', 0.05);
    this._h('sfx', 'crash', 0.35 + 0.3 * clamp(dmg / Math.max(1, e.max), 0, 1));
    this._h('haptic', 'medium');
    G.shake += 0.3;
    this._h('burst', p.x, p.y + p.h * 0.5, p.d, 8, 0xffffff, 7, 0.22 + p.r * 0.05, 5);
    if (G.t - this.enemyTextT > 0.12) { this.enemyTextT = G.t; this._h('text', '-' + Math.max(1, Math.round(dmg)), p, e.boss ? 'big' : ''); }
    if (e.hp <= 0) this._killEnemy(p);
  }

  _killEnemy(p) {
    const G = this.G, b = this.ball, w = this.world, e = p.enemy;
    e.hp = 0;
    w.kill(p);
    this.stats.kills++; if (e.boss) this.stats.bosses++;
    const gain = Math.min(CFG.growK * p.r ** 3, (e.boss ? 0.6 : 0.22) * b.r ** 3);
    this._grow(b.r ** 3 + gain);
    b.punch(0.12);
    const xp = Math.max(e.boss ? 40 : 6, this.snowTons() * (e.boss ? 0.35 : 0.12)) + p.mass * (p.tonK || 1);
    G.bonusTons += xp;
    this._h('burst', p.x, p.y + p.h * 0.5, p.d, 26, w.colorOf(p.type), 10, 0.4 + p.r * 0.07, 8);
    this._h('burst', p.x, p.y + p.h * 0.5, p.d, 14, 0xffffff, 9, 0.3, 7);
    this._h('puff', p.x, p.y + p.h * 0.4, -p.d, 0, 2, 0, 1.2 + p.r, 1, 0xf4f8ff, 0.6);
    this._h('hitStop', 0.09);
    G.shake += e.boss ? 1.1 : 0.55;
    this._h('sfx', 'crash', 0.8);
    this._h('sfx', 'milestone', e.boss ? 3 : 1);
    this._h('haptic', 'success');
    this._h('flash', e.boss ? 'milestone' : 'gold');
    this._text(e.boss ? e.name + ' YENİLDİ!' : e.name + ' EZİLDİ!', p, 'big', true);
    if (!this.L || e.boss) this._msg(1, '+' + fmtTonsShort(xp) + ' XP');
    this._h('track', 'enemy_kill', { id: e.id, boss: e.boss });
    if (e.boss) this._power();
    if (this.L) { this._chainHit(e.boss ? 5 : 2); if (e.boss) this._bossDown(); }
    if (e.B) this._bossFinale(p);
    this._tierCheck();
  }

  // enemy AI (per frame): knockback, chase sideways, throw snowballs
  _enemies(dt) {
    const b = this.ball, w = this.world, G = this.G;
    if (G.state !== 'play') return;
    const en = w.enemies;
    for (let i = 0; i < en.length; i++) {
      const p = en[i];
      if (!p.alive) continue;
      const e = p.enemy;
      if (e.hitCd > 0) e.hitCd -= dt;
      if (e.flash > 0) e.flash -= dt;
      const dd = p.d - b.d;
      if (e.ai === 'arena') { this._arenaAI(p, b, dt, w.halfWidth(p.d) - 1, dd); continue; }   // PATRON: always run (anchored, cannot be passed)
      if (dd > 140 || dd < -25) continue;
      const hw = w.halfWidth(p.d) - 1;
      if (e.ai === 'roll') { this._rollAI(p, b, dt, hw); continue; }
      if (e.rival) { this._rivalAI(p, b, dt, hw, dd); continue; }
      if (e.kbD > 0.2 || Math.abs(e.kbX) > 0.2) {
        p.d += e.kbD * dt; p.x = clamp(p.x + e.kbX * dt, -hw, hw);
        const k = Math.exp(-dt * 5); e.kbD *= k; e.kbX *= k;
      }
      if (!e.woke && dd < 95) {
        e.woke = true;
        if (e.boss) { this._msg(3, '⚠ ' + e.name + ' GELİYOR!'); this._h('sfx', 'rumble'); this._h('haptic', 'warning'); }
      }
      if (!e.woke) continue;
      if (dd > b.r + p.r && dd < 75 && e.spd > 0) {
        p.x = clamp(p.x + clamp(b.x - p.x, -e.spd * dt, e.spd * dt), -hw, hw);
      }
      if (dd > 0) p.rot = Math.atan2(b.x - p.x, 16) * 0.8;
      if (e.ai === 'throw' || e.ai === 'boss') {
        e.cd -= dt;
        if (e.cd <= 0 && dd > 14 && dd < 64) {
          e.cd = e.boss ? 1.7 + Math.random() * 0.8 : 2.4 + Math.random() * 1.4;
          const Vs = 20, t = Math.max(0.25, dd / (Vs + b.speed));
          const n = e.boss ? 3 : 1;
          for (let k = 0; k < n; k++) {
            const tx = b.x + b.vx * t * 0.5 + (k - (n - 1) / 2) * (4 + b.r);
            this.plus.spawnShot(p.x, p.y + p.h * 0.7, p.d - p.r, (tx - p.x) / t, -Vs, e.boss ? 1.5 : 1);
          }
        }
      }
    }
  }

  // Rival AI: bigger = hunts you (waits ahead, then rams from behind), smaller = races away and dodges sideways.
  _rivalAI(p, b, dt, hw, dd) {
    const e = p.enemy, target = this.targetSpeed();
    if (e.rcd > 0) e.rcd -= dt;
    const bigger = p.r > b.r * 1.05, smaller = b.r > p.r * 1.05;
    p.tint = bigger ? RIVAL_RED : smaller ? RIVAL_BLUE : RIVAL_WHITE;
    let v = target * (bigger ? (dd < 0 ? 1.12 : 0.96) : smaller ? 0.82 : 0.95);
    p.d += v * dt;
    const dx = b.x - p.x;
    if (bigger) p.x = clamp(p.x + clamp(dx, -e.spd * dt, e.spd * dt), -hw, hw);
    else if (smaller && Math.abs(dx) < b.r + p.r + 4 && dd > -2 && dd < 40) p.x = clamp(p.x - Math.sign(dx || 1) * e.spd * dt, -hw, hw);
    p.rot = Math.atan2(dx, 30) * 0.5;
    // the rival is a snowball: it rolls (visual wobble) and grows a little as it races
    p.s = p.s0 || (p.s0 = p.s);
    if (!e.grown && dd < 80) { e.grown = true; this._msg(3, bigger ? '⚠ RAKİP KARTOPU SENDEN BÜYÜK: kaç!' : '⚪ RAKİP KARTOPU: yakalayıp ye!'); }
  }

  // a ball rolled across the track by a cannon: straight line, bigger = red, smaller = white; gone once it leaves the track
  _rollAI(p, b, dt, hw) {
    const e = p.enemy;
    if (e.rcd > 0) e.rcd -= dt;
    p.x += e.vx * dt; p.d += e.vd * dt;
    p.rot += (e.vx > 0 ? -1 : 1) * 0.2 * dt * 10;
    p.tint = p.r > b.r * 1.05 ? RIVAL_RED : RIVAL_WHITE;
    if ((e.vx > 0 ? p.x > hw + 8 : p.x < -hw - 8) || p.d < b.d - 30) this.world.kill(p);
  }

  // ---- PATRON (boss levels): one readable rule. The boss has a fixed size (plan.bossNeedR, shown as 'DEV YETİ · 7,2 m'),
  // stands anchored on the track before the finish and always slides in front of the ball, so it cannot be passed.
  // Touch it: ball >= boss size -> you SWALLOW it (the finish opens); smaller -> you CRASH and shatter (level failed).
  _bossNear() { const L = this.L; return !!(L && L.boss && this.ball.d > L.dF - 300); }   // (no '⛔ X m' obstacle tags near the PATRON)
  _bossNeed() { return this.L ? this.L.bossNeedR || 1 : 1; }
  _bossCanEat() { return this._eff() >= this._bossNeed() * 0.995; }
  _bossLine() { return 'PATRON: ' + fmtD(this._bossNeed() * 2) + ' m — sen: ' + fmtD(this.ball.r * 2) + ' m'; }
  _arenaAI(p, b, dt, hw, dd) {
    const e = p.enemy, G = this.G;
    if (e.done) return;
    // anchored in d; slides sideways to stay in front of the ball (a goalkeeper, never a fight)
    p.d = e.homeD;
    const lim = Math.max(0, hw - p.r * 0.4);
    p.x = clamp(p.x + clamp(b.x - p.x, -9 * dt, 9 * dt), -lim, lim);
    p.y = this.world.groundY(p.x, p.d);
    e.kbD = 0; e.kbX = 0;
    if (p.tag) p.tag.position.set(p.x, p.y + p.h + p.tag.scale.x * 0.25, -p.d);
    if (!e.woke && dd < 220) {
      e.woke = true; e.tellT = 0;
      this._msg(3, '👹 ' + this._bossLine());
      this._msg(2, this._bossCanEat() ? 'Yeterince büyüksün: PATRONU YUT!' : 'Büyü! Küçük çarparsan paramparça olursun.');
      this._h('sfx', 'rumble'); this._h('haptic', 'warning');
    }
    if (e.woke) {
      e.tellT -= dt;
      if (e.tellT <= 0 && dd > 25) { e.tellT = 4; if (dd < 200) this._msg(1, (this._bossCanEat() ? '✓ ' : '⛔ ') + this._bossLine()); }
      p.tint = this._bossCanEat() ? RIVAL_WHITE : e.tint;
    }
    // contact: the ball's front reaches the boss (anywhere across the track), or the ball is somehow past it
    if (b.d + b.r >= p.d - p.r * 0.6) this._bossResolve(p);
  }

  _bossResolve(p) {
    const e = p.enemy, G = this.G;
    if (e.done || G.state !== 'play') return;
    e.done = true;
    if (this._bossCanEat()) this._bossEat(p);
    else this._bossCrash(p);
  }

  _bossEat(p) {
    const G = this.G, b = this.ball;
    this.plus.bossFx = null;
    if (p.tag) p.tag.visible = false;
    this._killEnemy(p);          // growth + XP + _bossDown (the hidden finish barrier is gone, G.finalBroken)
    this._bossDown();
    this._bossFinale(p);         // slow-mo + bursts + reward
    for (let k = 0; k < 14; k++) this._h('burst', b.x + (Math.random() - 0.5) * p.r * 2, b.y + Math.random() * p.r, p.d, 10, k % 2 ? 0xffd45a : 0xffffff, 12, 0.5 + p.r * 0.08, 8);
    G.timeScale = 0.25; G.shake += 1.4;
    b.punch(0.25);
    this._text('PATRON YUTULDU!', b, 'big', true);
    this._msg(3, '👹 PATRON YUTULDU!');
  }

  _bossCrash(p) {
    const G = this.G, b = this.ball;
    this.plus.bossFx = null;
    b.speed = 0;
    G.shake += 2; G.timeScale = 0.4;
    this._h('hitStop', 0.14);
    this._h('sfx', 'crash', 1); this._h('sfx', 'bump', 1);
    this._h('haptic', 'heavy'); this._h('flash', 'hit');
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      this._h('burst', b.x + Math.sin(a) * b.r, b.y + Math.cos(a) * b.r * 0.6, b.d, 10, k % 3 ? 0xffffff : 0xcfe6ff, 12, 0.3 + b.r * 0.12, 9);
    }
    this._text('PARAMPARÇA!', b, 'bad', true);
    G.bossFail = { need: this._bossNeed(), have: b.r };
    this.end('boss');
  }

  // boss defeated: big burst, slow-mo, bonus (the locked gate unlocks in _bossDown)
  _bossFinale(p) {
    const G = this.G, e = p.enemy, B = e.B;
    if (B) { B.dead = true; B.marks.length = 0; B.rings.length = 0; B.laser = null; B.lane = null; }
    this.plus.bossFx = null;
    G.timeScale = 0.3; G.shake += 1.6;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, rr = p.r * (0.6 + 0.5 * (k % 3));
      this._h('burst', p.x + Math.sin(a) * rr, p.y + p.h * (0.3 + 0.12 * (k % 4)), p.d + Math.cos(a) * rr, 8, k % 2 ? 0xffd45a : 0xd8ecff, 10, 0.5 + p.r * 0.06, 7);
    }
    const bonus = Math.max(30, this.snowTons() * 0.4);
    G.bonusTons += bonus;
    this._msg(2, '🏆 ' + e.name + ' YENİLDİ! ÖDÜL +' + fmtTonsShort(bonus));
    this._h('haptic', 'success');
  }

  // ---- first-time mechanic tips (once ever, localStorage 'patpat.cig.tips'), through the ÇIĞ message queue
  _tipSeen() {
    if (!this._tipS) { try { this._tipS = JSON.parse(localStorage.getItem('patpat.cig.tips') || '{}') || {}; } catch { this._tipS = {}; } }
    return this._tipS;
  }
  _tip(key, text) {
    const S = this._tipSeen();
    if (S[key] || (this.L && this._inArena())) return;
    S[key] = 1;
    try { localStorage.setItem('patpat.cig.tips', JSON.stringify(S)); } catch { /* ignore */ }
    this._msg(2, '💡 ' + text);
  }
  _tips() {
    const L = this.L, b = this.ball, G = this.G;
    if (!L || G.t - (this._tipT || 0) < 0.25) return;
    this._tipT = G.t;
    const S = this._tipSeen(), its = L.items;
    for (let i = 0; i < its.length; i++) {
      const it = its[i];
      if (it.start > b.d + 45) break;
      if (it.start + it.len < b.d) continue;
      const k = it.kind, key = k === 'crateLine' || k === 'crateWall' ? 'crate' : k;
      if (S[key] || !TIPS[key]) continue;
      this._tip(key, TIPS[key]);
      return;
    }
    if (!S.hot) for (const h of this.world.heats) if (h.d - h.rd < b.d + 45 && h.d + h.rd > b.d) { this._tip('hot', TIPS.hot); return; }
  }

  _shotHit() {
    const G = this.G, b = this.ball;
    if (this.plus.consumeShield()) return;
    this._loseSnow(0.03);
    b.speed *= 0.96;
    G.shake += 0.35;
    b.squash(0.12);
    this._h('sfx', 'bump', 0.4);
    this._h('haptic', 'medium');
    this._h('flash', 'hit');
    this._text('BUZ TOPU!', b, 'bad');
  }

  // GÜÇLENDİN!: a short boost after breaking a barrier (or a boss): faster, bigger suction, smash anything.
  _power() {
    const b = this.ball, G = this.G;
    this.powerT = CFG.powerT;
    G.shake += 0.5;
    this._h('kick', 0.18, 9);
    this._h('flash', 'milestone');
    this._h('plusSfx', 'power');
    this._h('haptic', 'success');
    this._h('burst', b.x, b.y, b.d, 24, 0xffd45a, 10 + b.r, 0.3 + b.r * 0.05, 7);
    this._text('GÜÇLENDİN!', b, 'big', true);
    if (!this.L) this._msg(1, '💪 GÜÇLENDİN! hızlan, her şeyi ez');
  }

  _loseSnow(frac, noScatter = false) {
    const b = this.ball, w = this.world;
    this.stats.hits++;
    const r0 = b.r;
    const r1 = Math.max(CFG.minR * 0.9, Math.cbrt(r0 ** 3 * (1 - frac)));
    b.setRadius(r1);
    const lostV = r0 ** 3 - r1 ** 3;
    if (lostV <= 1e-4) return;
    if (noScatter) { if (b.r < this.dieR()) this.end('melt'); return; }   // (a barrier gives the snow back through _gateSupply)
    const n = 3 + Math.min(4, Math.floor(r1));
    const cr = Math.cbrt((CFG.chunkRecover * lostV) / (n * CFG.growK * CFG.chunkGain));
    for (let i = 0; i < n; i++) w.spawnChunk(b.x + (Math.random() - 0.5) * 2 * (b.r * 3.2 + 3), b.d + b.r + 2 + Math.random() * (10 + 3 * b.r), Math.max(0.12, cr));
    const rd = this.dieR();
    if (b.r < rd) this.end('melt');
  }

  // ---- size gates
  _gates(pd) {
    const b = this.ball, w = this.world, L = this.L;
    const gs = w.gates;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      if (g.broken) continue;
      const front = b.d + b.r * 0.8;
      if (g.locked) continue;   // the boss level's finish barrier is the PATRON itself: no wall here (see _arenaAI)
      if (!L) {
        if (g.hit) continue;
        if (front >= g.d - g.T * 0.5 && b.d < g.d + g.T) this._hitGate(g);
        continue;
      }
      if (g.cd > 0 || front < g.d - g.T * 0.5 || b.d > g.d + g.T) continue;
      if (g.kind === 'mini' && (b.x + 0.6 * b.r < g.x0 || b.x - 0.6 * b.r > g.x1)) continue;   // (slid past the open side)
      this._hitGate(g);
    }
  }

  _hitGate(g) {
    const G = this.G, b = this.ball, w = this.world, M = this.plus.mods;
    if (this.L) {
      // Levels: a barrier is either broken (big enough) or the ball is thrown back. Never a free pass.
      this.stats.gates++;
      if (g.locked) return;
      const eff = this._eff();
      if (eff >= g.minR * CFG.lvl.gateTol || M.plow || this.powerT > 0) this._gateBreak(g);
      else if (g.kind === 'mini') this._miniDeflect(g);
      else this._gateBounce(g, eff / g.minR);
      return;
    }
    g.hit = true;
    this.stats.gates++;
    if (b.r >= g.minR * 0.97 || M.plow || this.powerT > 0) {
      // smash through: growth + a short power boost
      w.breakGate(g, b.x, 1);
      this.stats.gatesBroken++; G.gatesBroken++;
      const bonus = Math.max(8, 0.4 * this.snowTons());
      G.bonusTons += bonus;
      b.setRadius(Math.cbrt(b.r ** 3 * (1 + CFG.gateGrow)));
      b.punch(0.1);
      this._h('hitStop', 0.06);
      G.shake += 0.9;
      this._h('sfx', 'crash', 0.8);
      this._h('sfx', 'milestone', 2);
      this._h('haptic', 'success');
      b.squash(0.14);
      for (let k = 0; k < 6; k++) this._h('burst', b.x + (k - 2.5) * g.hw * 0.25, b.y, g.d, 6, 0xd8ecff, 8, 0.55, 7);
      this._h('flash', 'milestone');
      this._text('KAPI KIRILDI!', b, 'big', true);
      this._msg(2, '+' + fmtTonsShort(bonus) + ' bonus');
      this._h('track', 'gate', { ok: true });
      this._power();
      this._tierCheck();
    } else if (this.plus.consumeShield()) {
      w.breakGate(g, b.x, 0.7);
      this._h('sfx', 'crash', 0.6);
    } else {
      // too small: heavy bump, but the wall still gives way (never a soft-lock)
      w.breakGate(g, b.x, 0.6);
      this._loseSnow(CFG.gateLoss * (1 + 0.2 * Math.min(4, tierOf(b.r))));
      b.speed *= 0.5; G.gateSlow = 0.8;
      G.recoverT = 1.2;
      G.combo = 0; this._comboUi(0);
      G.shake += 1.1;
      this._h('hitStop', 0.1);
      this._h('sfx', 'bump', 1);
      this._h('sfx', 'crash', 0.6);
      this._h('haptic', 'heavy');
      b.squash(0.3);
      this._h('burst', b.x, b.y, g.d, 14, 0xd8ecff, 8, 0.5, 6);
      this._text('KAPI ÇOK BÜYÜK!', b, 'bad', true);
      this._h('track', 'gate', { ok: false });
    }
  }

  // ---- ÇIĞ DAĞLAR: barrier gates
  _gateBreak(g) {
    const G = this.G, b = this.ball, w = this.world, L = this.L;
    const mini = g.kind === 'mini';
    const fin = g.kind === 'final' || g.kind === 'boss';
    w.breakGate(g, b.x, mini ? 0.8 : 1);
    this.stats.gatesBroken++; G.gatesBroken++;
    this._grow(b.r ** 3 * (mini ? 1.03 : 1 + CFG.gateGrow));   // (the growth comes AFTER the smash: big gates pay back)
    b.punch(mini ? 0.06 : 0.1);
    G.shake += mini ? 0.5 : 0.9;
    this._h('hitStop', fin ? 0.12 : mini ? 0.04 : 0.06);
    this._h('sfx', 'crash', mini ? 0.6 : 0.8);
    this._h('sfx', 'milestone', mini ? 1 : 2);
    this._h('haptic', 'success');
    b.squash(0.14);
    for (let k = 0; k < (fin ? 10 : mini ? 3 : 6); k++) this._h('burst', b.x + (k - 2.5) * Math.min(g.hw, 40) * 0.25, b.y, g.d, 6, fin && k % 2 ? 0xffd45a : 0xd8ecff, 8, 0.55, 7);
    if (!mini) { const bonus = Math.max(8, 0.4 * this.snowTons()) * this._cm(); G.bonusTons += bonus; }
    this._chainHit(mini ? 2 : 3);
    if (mini) return;
    G.gateLog.push({ i: g.i, r: b.r, need: g.minR, ok: true });
    this._h('flash', 'milestone');
    this._text(fin ? 'DAĞ TAMAM!' : 'KAPI KIRILDI!', b, 'big', true);
    this._h('track', 'gate', { ok: true });
    this._power();
    G.gateIdx = g.i + 1;
    if (fin) {
      G.finalBroken = true; G.finalR = b.r;
      G.timeScale = 0.55;
    } else this._msg(1, '✓ ETAP ' + (g.i + 1));   // short and small; the HUD chip is the source of truth
    this._tierCheck();
  }

  // too small: the ball is thrown back, loses snow, the gate cracks (needs 4 % less, three times). The first two bounces drop snow
  // chunks between the ball and the gate (a rescue: you get close, you still have to eat the rest).
  _gateBounce(g, ratio) {
    const G = this.G, b = this.ball, w = this.world, K = CFG.lvl;
    const have = b.r, need = g.minR;
    const shield = this.plus.consumeShield();
    g.bounces++; this.stats.bounces++;
    if (!shield) { this._loseSnow(lerp(K.bounceLoss[0], K.bounceLoss[1], clamp((1 - ratio) / 0.4, 0, 1)), true); this._dropRider(); }
    if (G.state !== 'play') return;   // (melted away)
    const back = clamp(12 + 0.5 * have, K.bounceBack[0], K.bounceBack[1]);
    if (g.supplyLeft > 0) { g.supplyLeft--; this._gateSupply(g, back); }
    if (g.cracks < K.crackMax) { g.cracks++; g.minR = g.minR0 * (1 - K.crackStep * g.cracks); w.setGateLabel(g); }
    G.hitPending = true; G.knockT = K.bounceDur; G.knockV = (2 * back) / K.bounceDur;
    b.speed = 0; G.gateSlow = 0.8; G.recoverT = 1.2; g.cd = 0.8;
    this._chainBreak();
    G.combo = 0; this._comboUi(0);
    const lb = G.lastBounce || (G.lastBounce = { i: 0, need: 0, have: 0 });
    lb.i = g.i; lb.need = need; lb.have = have;
    G.gateLog.push({ i: g.i, r: have, need, ok: false });
    G.shake += 1.1;
    this._h('hitStop', 0.1);
    this._h('sfx', 'bump', 1);
    this._h('sfx', 'crash', 0.6);
    this._h('haptic', 'heavy');
    b.squash(0.3);
    this._h('burst', b.x, b.y, g.d, 14, 0xd8ecff, 8, 0.5, 6);
    this._text('YETERİNCE BÜYÜK DEĞİLSİN!', b, 'bad', true);
    this._h('track', 'gate', { ok: false });
  }

  _gateSupply(g, back) {
    const b = this.ball, w = this.world;
    if (this._afkAcc > 6) return;   // no rescue for a ball nobody is steering
    const target = CFG.lvl.supplyTo * g.minR;
    const R3 = target ** 3 - b.r ** 3;
    if (R3 <= 0) return;
    const n = clamp(Math.round(8 + 6 * (1 - b.r / target)), 8, 14);
    w.supplyChunks(b.x, b.d - back + 3, g.d - g.T * 0.5 - 3, R3 / CFG.growK / CFG.chunkGain, n);
  }

  // a half-width ice wall that is too strong for you: slide off through the open side (no snow lost)
  _miniDeflect(g) {
    const G = this.G, b = this.ball, w = this.world;
    const lim = Math.max(0.5, w.halfWidth(b.d) - b.r * 0.55);
    const left = g.x0 > -g.hw + 0.5;   // the wall touches the right edge: the gap is on the left
    const nx = clamp(left ? g.x0 - b.r - 0.6 : g.x1 + b.r + 0.6, -lim, lim);
    b.x = nx;
    b.vx = (left ? -1 : 1) * (6 + 0.25 * b.speed);
    b.speed *= 0.6;
    this._chainBreak();
    g.cd = 0.5;
    G.shake += 0.4;
    this._h('sfx', 'bump', 0.5);
    this._h('haptic', 'light');
    b.squash(0.1);
    this._h('burst', b.x, b.y, g.d, 6, 0xd8ecff, 5, 0.3, 4);
  }

  // ---- ÇIĞ DAĞLAR: crates and the break chain
  _chainHit(k) {
    const G = this.G, K = CFG.lvl, b = this.ball;
    const old = G.chainMul || 1;
    G.chain += k;
    G.chainT = K.chainWin;
    const mul = 1 + Math.min(K.chainMax - 1, Math.floor(G.chain / K.chainStep));
    G.chainMul = mul;
    if (G.chain > this.stats.maxChain) this.stats.maxChain = G.chain;
    if (mul > this.stats.maxMul) this.stats.maxMul = mul;
    if (mul > old) {
      this._h('sfx', 'milestone', mul - 1);
      this._h('haptic', 'medium');
      if (mul >= 3) this._text('ZİNCİR x' + mul + '!', b, 'big', true);
    }
    return mul;
  }
  _chainBreak() { const G = this.G; G.chain = 0; G.chainT = 0; G.chainMul = 1; }

  // a crate is broken by touch: it throws snow chunks in front of the ball (they are eaten like any other snow)
  _breakCrate(p, dx, dd, dist) {
    const G = this.G, b = this.ball, w = this.world, c = p.crate, K = CFG.lvl;
    const pw = this.powerT > 0 || this.plus.mods.plow;
    if (c.iron && b.r * this._momK() < c.need && !pw) {
      // iron crate: too big for you, bounces you off (no snow lost)
      this._deflect(p, dx, dd, dist, b.r + p.r * CFG.contactK);
      b.speed *= 0.75;
      this._h('burst', p.x, p.y + p.h * 0.5, p.d, 6, 0x9aa8bd, 5, 0.2, 4);
      return;
    }
    w.kill(p);
    G.destroyed++;
    if (c.secret) { this._secretOpen(p); return; }
    this.stats.crates++;
    if (c.gold) this.stats.gold++;
    const mul = this._chainHit(1);
    const y = c.y * (1 + 0.1 * (mul - 1));
    const n = c.gold ? 8 : w.expectAt(p.d) > 4 ? 8 : 5;
    const cr = Math.max(0.1, Math.cbrt(y / (CFG.growK * CFG.chunkGain * n)));
    for (let i = 0; i < n; i++) {
      w.spawnChunk(b.x + (Math.random() * 2 - 1) * (1.5 + 0.5 * b.r), b.d + 1 + Math.random() * (2 + b.r), cr);
    }
    G.townTons += p.mass * 0.5 * this._cm();
    this._h('burst', p.x, p.y + p.h * 0.5, p.d, 12, c.gold ? 0xffd54a : 0xc98a4b, 7, 0.22 + p.r * 0.06, 6);
    this._h('burst', p.x, p.y + p.h * 0.5, p.d, 6, 0xffffff, 6, 0.16, 5);
    if (G.t - (this._smashSfxT || -9) > 0.08) { this._smashSfxT = G.t; this._h('sfx', 'crash', 0.3); this._h('haptic', 'medium'); }
    G.shake += 0.12;
    b.speed *= b.r < 0.8 * p.r ? 0.93 : 0.99;
    this._h('track', 'smash', {});
  }

  // GİZLİ KAR TÜNELİ: the cracked wall broke -> the bonus lane appears
  _secretOpen(p) {
    const G = this.G, b = this.ball;
    const len = this.world.openSecret(p);
    this.stats.secret = (this.stats.secret | 0) + 1;
    this._msg(2, 'GİZLİ YOL!');
    this._text('GİZLİ YOL!', p, 'big', true);
    this._h('sfx', 'crash', 0.6);
    this._h('haptic', 'heavy');
    G.shake += 0.3;
    this._h('burst', p.x, p.y + p.h * 0.5, p.d, 18, 0xbfe6ff, 8, 0.3, 7);
    this._h('burst', p.x, p.y + p.h * 0.5, p.d, 8, 0xffd54a, 6, 0.2, 6);
    this._h('track', 'secret', { len });
    b.speed *= 0.98;
  }

  // cracked walls glow (and pulse) once the ball is big enough to smash them
  _secretGlow() {
    const w = this.world, b = this.ball, a = w.secrets;
    if (!a || !a.length) return;
    const k = 1.1 + 0.5 * Math.sin(this.G.t * 6);
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i];
      if (!p.alive) { a.splice(i, 1); continue; }
      if (Math.abs(p.d - b.d) > 140) continue;
      if (b.r >= p.crate.need) { const t = p.tint; t[0] = 1.2 + 0.4 * k; t[1] = 1.5 + 0.5 * k; t[2] = 1.9 + 0.5 * k; }
    }
  }

  // per frame: paint the gates ahead (red / amber / green) and remember the next barrier for the HUD
  _gateState() {
    const b = this.ball, w = this.world, gs = w.gates;
    let nx = null;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      if (g.broken || b.d > g.d + 4) continue;
      if (g.kind !== 'mini' && (!nx || g.d < nx.d)) nx = g;
      if (b.d < g.d - 300) continue;
      if (b.d < g.d - 140) { this._gateAid(g); continue; }
      const rdy = this._readyOf(g);
      w.setGateReady(g, rdy);
      this._gateAid(g);
      if (rdy === 2 && !g._kick && !g.locked && g.d - b.d < 40 && g.d - b.d > 0) { g._kick = true; this._h('kick', 0.1, 3); }
    }
    this._next = nx;
    // YOL AYRIMI: warn once when the fork is ~90 m ahead
    const fk = w.forks;
    if (fk) for (let i = 0; i < fk.length; i++) {
      const f = fk[i];
      if (!f.warned && b.d > f.d0 - 90 && b.d < f.d0 + 20) {
        f.warned = true;
        this._msg(2, 'YOL AYRIMI! ' + (f.risk > 0 ? 'Sağ' : 'Sol') + ': riskli kısa yol');
      }
    }
  }

  // 'kar yağışı' rescue patch 120-200 m before a barrier + a hint when you are far too small 300 m out
  _gateAid(g) {
    const b = this.ball, w = this.world;
    if (g.locked || g.kind === 'mini' || !this.L) return;
    const left = g.d - b.d;
    if (left < 0 || left > 300) return;
    if (!g._hint && b.r < 0.8 * g.minR) { g._hint = true; this._msg(1, 'BÜYÜMEN LAZIM! Kapıya kadar ye ve büyü'); }
    if (!g._rain && left <= 200 && left > 125) {
      g._rain = true;
      const target = 0.85 * g.minR, R3 = target ** 3 - b.r ** 3;
      if (R3 > 0) {
        w.supplyChunks(b.x * 0.5, g.d - 195, g.d - 125, R3 / CFG.growK / CFG.chunkGain, 14);
        this._msg(1, '❄️ Kar yağışı! Önündeki karı topla');
      }
    }
  }

  // one-shot "star is close" nudge per goal (size within 10% of the star-2 target, or a count goal one away)
  _starNear() {
    const L = this.L, st = this.stats;
    if (!L || !L.stars) return;
    const done = this._starNudge || (this._starNudge = {});
    const hit = (key) => { if (done[key]) return; done[key] = 1; this._msg(2, '⭐ YILDIZA AZ KALDI!'); };
    if (L.r2 > 0 && this.ball.r >= 0.9 * L.r2 && this.ball.r < L.r2) hit('size');
    const g = L.stars[2];
    if (!g) return;
    const cnt = { chain: [st.maxMul, g.mul], crates: [st.crates, g.count], gold: [st.gold, g.count], statues: [st.statues, g.count] }[g.kind];
    if (cnt && cnt[1] > 1 && (cnt[0] | 0) === cnt[1] - 1) hit('g3');
  }

  _levelTick(dt) {
    this._starNear();
    const G = this.G;
    if (G.surgeT > 0) G.surgeT -= dt;
    if (G.stripT > 0) G.stripT -= dt;
    if (G.chainT > 0) { G.chainT -= dt; if (G.chainT <= 0 && G.chain > 0) { G.chain = 0; G.chainMul = 1; } }
    const gs = this.world.gates;
    for (let i = 0; i < gs.length; i++) if (gs[i].cd > 0) gs[i].cd -= dt;
    this._momTick(dt);
    // PATRON failsafe: the boss prop got lost from the lists before the ball reached it: resolve the size rule right there
    const bp = this.world.bossProp;
    if (this.L.boss && !G.finalBroken && bp && !bp.enemy.done && (!bp.alive || !this.world.enemies.includes(bp)) && this.ball.d + this.ball.r >= bp.enemy.homeD - bp.r * 0.6) {
      bp.enemy.done = true;
      if (this._bossCanEat()) { this.plus.bossFx = null; this._bossDown(); this._bossFinale(bp); this._msg(3, '👹 PATRON YUTULDU!'); } else this._bossCrash(bp);
    }
    this.stats.time = G.t;
  }

  _levelAfter() {
    const G = this.G;
    this._gateState();
    if (G.state === 'play' && G.finalBroken && this.ball.d >= this.L.length) this._win();
  }

  // one toast when a barrier comes up (the warning distance grows with the speed: you always get a few seconds to read it)
  _levelEvents() {
    const b = this.ball, ev = this.world.events, L = this.L;
    const warn = Math.max(60, 2.5 * b.speed);
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.seen || e.kind !== 'gate' || !e.gate) continue;
      const g = e.gate;
      if (b.d < g.d - warn) continue;
      e.seen = true;
      if (g.locked) continue;   // the boss has its own bar
      const need = fmtD(g.minR * 2), ok = this._readyOf(g) === 2;
      this._msg(1, (g.kind === 'final' ? 'FİNAL KAPISI' : 'ETAP ' + (g.i + 1) + '/' + L.S) + ' · ⛔ ' + need + ' m ' + (ok ? 'kırabilirsin' : 'gerekli'));
      this._h('haptic', 'light');
    }
  }

  // the boss is down: its locked gate unlocks and bursts (the ball still has to roll across the finish line)
  _bossDown() {
    const G = this.G, b = this.ball, w = this.world, g = w.finalGate;
    if (!g || g.broken) return;
    w.unlockGate(g);
    w.breakGate(g, b.x, 1.4);
    this.stats.gatesBroken++; G.gatesBroken++;
    G.finalBroken = true; G.finalR = b.r; G.gateIdx = this.L.S;
    G.gateLog.push({ i: g.i, r: b.r, need: g.minR, ok: true });
    G.timeScale = 0.4;
    this._spawnLoot();
    for (let k = 0; k < 8; k++) this._h('burst', b.x + (k - 3.5) * Math.min(g.hw, 40) * 0.2, b.y, g.d, 6, k % 2 ? 0xffd45a : 0xd8ecff, 8, 0.55, 7);
  }

  // BOSS GANİMETİ: the defeated boss drops a glowing orb that rolls ahead; collect it before the finish or it is lost
  _spawnLoot() {
    const b = this.ball, L = this.L;
    if (this.loot || !L || !L.boss) return;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
    const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.4, depthWrite: false }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    const grp = new THREE.Group(); grp.add(core); halo.scale.setScalar(1.9); grp.add(halo);
    beam.scale.set(1, 60, 1); beam.position.y = 30; grp.add(beam);
    grp.frustumCulled = false; beam.frustumCulled = false;
    this.plus.group.add(grp);
    let hud = null;
    try { hud = document.createElement('div'); hud.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:30;pointer-events:none;padding:6px 14px;border-radius:18px;background:rgba(255,226,122,.92);color:#3a2a00;font:900 18px system-ui,sans-serif;box-shadow:0 3px 0 #8a6a00;white-space:nowrap'; document.body.appendChild(hud); } catch { hud = null; }
    this.loot = { grp, halo, hud, d: b.d + 30, x: b.x, v: Math.max(9, b.speed * 0.8), t: 0, got: false, lost: false, boss: L.bossId };
    this._msg(3, '✨ GANİMET!');
  }
  _lootHud(o, on) {
    if (!o.hud) return;
    if (!on) { try { o.hud.remove(); } catch { /* optional */ } o.hud = null; return; }
    const b = this.ball, dx = o.x - b.x;
    o.hud.textContent = (dx < -1.5 ? '◀ ' : dx > 1.5 ? '' : '▲ ') + '✨ GANİMET ' + Math.max(0, Math.round(o.d - b.d)) + 'm' + (dx > 1.5 ? ' ▶' : '');
  }
  _loot(dt) {
    const o = this.loot, b = this.ball, w = this.world, L = this.L;
    if (!o || o.got || o.lost) return;
    o.t += dt;
    o.v += (b.speed * (o.t < 3 ? 0.78 : 0.55) - o.v) * Math.min(1, dt * 1.5);
    o.d = Math.min(o.d + o.v * dt, L.length - 4);
    const hw = w.halfWidth(o.d) * 0.5;
    o.x = Math.sin(o.t * 0.7) * hw;
    const r = 1.8 + b.r * 0.4, y = w.groundY(o.x, o.d) + r + 0.6 + Math.sin(o.t * 4) * 0.2;
    o.grp.position.set(o.x, y, -o.d); o.grp.scale.setScalar(r); o.grp.rotation.y = o.t * 2;
    o.halo.scale.setScalar(1.9 + Math.sin(o.t * 6) * 0.25);
    this._lootHud(o, true);
    if (Math.abs(o.d - b.d) < b.r + r + 1.2 && Math.abs(o.x - b.x) < b.r + r + 1.6) {
      o.got = true; this.G.lootGot = o.boss; this.plus.group.remove(o.grp); this._lootHud(o, false);
      this.G.bonusTons += Math.max(30, 0.5 * this.snowTons()) * this._cm();
      this._h('burst', o.x, y, o.d, 22, 0xffe27a, 9, 0.35, 8); this._h('flash', 'gold'); this._h('sfx', 'milestone', 2); this._h('haptic', 'success');
      this._msg(2, '✨ GANİMET ALINDI!');
    } else if (b.d > o.d + 8 || (b.d >= L.length - 6 && o.d >= L.length - 5)) {
      o.lost = true; this.plus.group.remove(o.grp); this._lootHud(o, false); this._msg(1, 'Ganimet kayboldu...');
    }
  }

  // finish line crossed with the final barrier broken
  _win() {
    const G = this.G, b = this.ball;
    if (G.state !== 'play') return;
    G.win = true;
    G.finalR = Math.max(G.finalR || 0, b.r);   // size at the finish line (star 2)
    this.stats.time = G.t;
    this.end('win');
    G.timeScale = 0.6;
    this._h('hitStop', 0.08);
    this._h('haptic', 'success');
    const cols = [0xffd45a, 0xff5a4a, 0x5ad2ff, 0x7dff8a, 0xff7ad9];
    for (let k = 0; k < 10; k++) this._h('burst', b.x + (Math.random() - 0.5) * (6 + b.r * 3), b.y + b.r * (0.5 + Math.random() * 2.5), b.d + (Math.random() - 0.3) * 12, 14, cols[k % cols.length], 9 + b.r * 0.6, 0.3 + b.r * 0.05, 8);
  }

  // the ball fell into the water: slower, a little snow lost, the avalanche gets closer
  _bridgeFall() {
    const b = this.ball, W = this.wave;
    b.speed *= 0.6;
    this._loseSnow(0.06, true);
    if (W.on) W.d += 20;
    this._h('burst', b.x, b.y - b.r * 0.5, b.d, 24, 0x9fd6ff, 9, 0.3, 7);
    this._h('sfx', 'crash', 0.5);
    this._h('haptic', 'heavy');
    this._text('SUYA DÜŞTÜN!', b, 'bad', true);
  }

  // AFK clock in GAME time (so balance sims feel it too): real input resets it; the debug bot counts as playing unless it is idle
  _afk(dt) {
    const active = performance.now() - lastInputAt < 300 || (this.auto && this.bot.mode !== 'idle');
    this._afkAcc = active ? 0 : this._afkAcc + dt;
  }

  // ---- hunger: continuous melt
  _melt(dt) {
    const G = this.G, b = this.ball, w = this.world, M = this.plus.mods;
    if (G.state !== 'play') return;
    const T = tierOf(b.r);
    let rate = CFG.melt[Math.min(T, CFG.melt.length - 1)];
    const grace = sm01((G.t - CFG.meltGrace[0]) / (CFG.meltGrace[1] - CFG.meltGrace[0]));
    rate += 0.012 * clamp(Math.log2(Math.max(1, b.r / 6)), 0, 4);  // big balls burn faster: late game is harder
    rate *= grace;
    if (this.L) rate *= this.L.meltMul * (this._inArena() ? CFG.lvl.arenaMelt : 1) * (G.chain >= CFG.lvl.chainStep ? CFG.lvl.chainMelt : 1);
    // AFK: no touch/drag input at all for 12+ s melts you fast (an idle ball must not just coast and grow)
    // only real input activity counts (touch / drag / key): holding a lane with a still finger is not AFK
    this._afkT = this._afkAcc;
    rate += 0.1 * clamp((this._afkAcc - 12) / 6, 0, 1);
    // soft landing before a barrier: the last 15 % of a stage melts half as fast when you are close to the requirement
    const ng = this._next;
    if (ng && this.L && !ng.locked) {
      let pd = 0;
      for (const q of w.gates) if (q.d < ng.d - 1 && q.d > pd) pd = q.d;
      const left = ng.d - b.d;
      if (left > 0 && left < 0.15 * Math.max(200, ng.d - pd) && b.r >= 0.7 * ng.minR) rate *= 0.5;
    }
    // boss fight: much gentler melt + periodic snow drops so a player who keeps moving sustains; warn when shrunk below 70 %
    const bf = this.L && this._inArena() && this.plus.bossFx && !this.plus.bossFx.dead;
    if (bf) {
      rate *= 0.35;
      if (!this._bossR0) { this._bossR0 = b.r; this._bossDrop = 2; this._bossWarnT = 0; }
      this._bossDrop -= dt;
      if (this._bossDrop <= 0) {
        this._bossDrop = 1.8;
        const hwB = w.halfWidth(b.d), cr = clamp(b.r * 0.32, 0.5, 3.4);
        for (let k = 0; k < 3; k++) w.spawnChunk(clamp(b.x + (k - 1) * (2 + b.r), -hwB + 1, hwB - 1), Math.min(b.d + b.r * 1.6 + 5 + k * 2.5, (this._next && this._next.locked ? this._next.d - 3 : 1e9)), cr);
      }
      this._bossWarnT -= dt;
      if (b.r < 0.7 * this._bossR0 && this._bossWarnT <= 0) { this._bossWarnT = 4; this._msg(3, 'ERİYORSUN — KAR TOPLA!'); this._h('haptic', 'warning'); }
    } else if (this._bossR0 && !this._inArena()) this._bossR0 = 0;
    if (b.airborne || M.noMelt) rate = 0;
    let onPatch = false;
    if (!b.airborne && !M.noMelt && w.inPatch(b.x, b.d)) { rate += CFG.patchMelt; onPatch = true; }
    const hz = !b.airborne && !M.noMelt && w.inHeat ? w.inHeat(b.x, b.d) : null;
    if (hz) {
      rate += CFG.heatMelt;
      if (!this._inHeat) { this._inHeat = true; this._text('SICAK!', b, 'bad', true); this._h('haptic', 'light'); }
      this._heatFx = (this._heatFx || 0) - dt;
      if (this._heatFx <= 0) { this._heatFx = 0.14; this._h('burst', b.x, b.y + b.r * 0.2, b.d, 2, 0xff8a2a, 3, 0.12 + b.r * 0.05, 3); }
    } else this._inHeat = false;
    this.melting = rate;
    if (rate > 0) {
      b.setRadius(Math.cbrt(b.r ** 3 * (1 - rate * dt)));
      if (onPatch) {
        this._meltFx = (this._meltFx || 0) - dt;
        if (this._meltFx <= 0) {
          this._meltFx = 0.12;
          this._h('burst', b.x, b.y - b.r * 0.8, b.d, 3, 0x7a5a3e, 4, 0.15 + b.r * 0.05, 3);
          this._h('haptic', 'light');
          this._text('ERİYOR!', b, 'bad');
        }
      }
    }
    if (b.r > G.peakR) G.peakR = b.r;
    if (b.r < this.dieR()) this.end('melt');
  }

  // ---- avalanche wave: only comes when you stall
  // ÇIĞ DAĞLAR: the avalanche chases from t0 on at k * your target speed and never lets the gap grow past gap0 * clamp. A barrier bounce
  // or a stall eats the gap; it freezes while the boss arena is on. Same data contract as _wave (wave.on / d / v) so the visuals work.
  _chase(dt, target) {
    const G = this.G, b = this.ball, W = this.wave, C = this.L.chase;
    if (G.state !== 'play' || !C || G.t < C.t0) return;
    if (C.ters) { this._tersChase(dt, target); return; }
    if (!W.on) {
      if (this._gateNear(120)) return;   // wait: one message at a time, the gate sign goes first
      W.on = true; W.d = b.d - C.gap0; W.v = C.k * target; W.t = 0; W.calm = 0; W.warnT = 1; W.n++;
      this.stats.waves++;
      this._msg(3, 'ÇIĞ ARKANDAN GELİYOR!');
      this._h('sfx', 'rumble');
      this._h('haptic', 'warning');
    }
    if (this._inArena()) return;   // frozen
    W.t += dt;
    W.v += (C.k * target - W.v) * Math.min(1, dt * 2);
    W.d += W.v * dt;
    const maxGap = C.gap0 * C.clamp;
    if (b.d - W.d > maxGap) W.d = b.d - maxGap;
    const gap = b.d - W.d;
    if (gap < CFG.lvl.chaseNear && (W.t | 0) !== (W._lt | 0)) { W._lt = W.t; G.shake += 0.12; this._h('haptic', 'light'); if (gap < CFG.lvl.chaseNear * 0.7) this._h('flash', 'hit'); }
    if (W.d >= b.d - b.r * 0.3) this.end('wave');
  }

  // TERS ÇIĞ: the avalanche runs AHEAD and leaves snow behind it; eat the trail, catch up and break into it for a bonus.
  _tersChase(dt, target) {
    const G = this.G, b = this.ball, W = this.wave, C = this.L.chase;
    if (G.tersDone || this._inArena()) return;
    if (!W.on) {
      W.on = true; W.d = b.d + C.gap0; W.v = C.k * target; W.t = 0; W.calm = 0; W.warnT = 99; W.n++; W._tr = W.d;
      this._msg(3, 'TERS ÇIĞ! Önündeki çığı kovala, bıraktığı karı ye');
      this._h('sfx', 'rumble'); this._h('haptic', 'warning');
    }
    W.t += dt;
    W.v += (C.k * Math.max(0.55, 1 - 0.015 * W.t) * target - W.v) * Math.min(1, dt * 2);
    W.d += W.v * dt;
    if (W.d > this.L.dF - 20) W.d = this.L.dF - 20;   // never runs past the final gate
    if (W.d - W._tr > 14) {   // drop a snow trail behind the wall (rich: you grow fast eating it)
      const hw = this.world.halfWidth(W.d), vol = 0.16 * b.r ** 3 / CFG.growK / CFG.chunkGain;
      this.world.supplyChunks((Math.random() - 0.5) * hw * 0.9, W._tr, W.d - 6, vol * 0.5, 4);
      this.world.supplyChunks((Math.random() - 0.5) * hw * 0.9, W._tr, W.d - 6, vol * 0.5, 4);
      W._tr = W.d;
    }
    if (b.d >= W.d - b.r * 0.5) {
      G.tersDone = true; W.on = false;
      const bonus = Math.max(40, 0.7 * this.snowTons()) * this._cm();
      G.bonusTons += bonus; G.shake += 0.8;
      this._h('burst', b.x, b.y, b.d, 24, 0xeaf3ff, 10, 0.4, 8);
      this._h('flash', 'gold'); this._h('sfx', 'milestone', 2); this._h('haptic', 'success');
      this._msg(2, '🌨️ ÇIĞA GİRDİN! +' + fmtTonsShort(bonus));
    }
  }

  _wave(dt, target) {
    if (this.L) { this._chase(dt, target); return; }
    const G = this.G, b = this.ball, W = this.wave;
    if (G.state !== 'play') return;
    const slow = G.t > 6 && b.speed < target * CFG.waveSlow;
    G.slowT = slow ? G.slowT + dt : Math.max(0, G.slowT - dt * 1.5);
    if (!W.on) {
      if (G.slowT > CFG.waveT) {
        W.on = true; W.d = b.d - CFG.waveGap; W.v = 0; W.t = 0; W.calm = 0; W.warnT = 0.8; W.n++;
        this.stats.waves++;
        this._msg(3, '⚠ ÇIĞ GELİYOR!');
        this._h('sfx', 'rumble');
        this._h('haptic', 'warning');
        this._h('flash', 'milestone');
        G.shake += 0.6;
      }
      return;
    }
    W.t += dt;
    const ok = b.speed >= target * 0.85;
    W.calm = ok ? W.calm + dt : Math.max(0, W.calm - dt);
    // the wave runs at about the speed you SHOULD have; once you recover it falls back
    const wv = W.calm > 1.5 ? target * 0.45 : Math.max(target * 0.9, b.speed * 1.02);
    W.v += (wv - W.v) * Math.min(1, dt * 2);
    W.d += W.v * dt;
    const gap = b.d - W.d;
    if (gap > CFG.waveGap * 1.5 && W.calm > 1.5) { W.on = false; return; }
    W.warnT -= dt;
    if (W.warnT <= 0 && gap < 80) {
      W.warnT = 2.6;
      this._msg(3, '⚠ ÇIĞ YAKLAŞIYOR: hızlan, yemeye devam et!');
      if (gap < 35) this._h('flash', 'hit');
    }
    if ((W.t | 0) !== (W._lt | 0) && gap < 40) { W._lt = W.t; G.shake += 0.15; this._h('haptic', 'light'); }
    if (W.d >= b.d - b.r * 0.3) { this.end('wave'); }
  }

  // Safety net: pinned against something for 2 s means break free (never a soft-lock).
  _stallGuard(dt) {
    const G = this.G, b = this.ball, w = this.world;
    if (G.knockT > 0 || G.gateSlow > 0) { this.progT = 0; this.progD = b.d; return; }   // (being thrown back from a barrier is not being stuck)
    this.progT += dt;
    if (this.progT <= 2) return;
    if (b.d - this.progD < 2.5 && !b.airborne && G.state === 'play') {
      this.stats.stalls++;
      w.query(b.x, b.d, b.r * 2 + 8, _near);
      for (let i = 0; i < _near.length; i++) {
        const p = _near[i];
        if (!p.alive || p.kind === 'chunk' || p.enemy || p.crate || this._edible(p)) continue;
        if (Math.hypot(p.x - b.x, p.d - b.d) < b.r + p.r * CFG.contactK + 1) this._smash(p, false);
      }
      b.speed = Math.max(b.speed, CFG.baseSpeed * 0.9);
    }
    this.progT = 0;
    this.progD = b.d;
  }

  // powder spray, avalanche wake, melt drips
  _ambient(dt) {
    const G = this.G, b = this.ball;
    if (G.state !== 'play') return;
    if (this.feverT > 0 && Math.random() < dt * 30) this._h('burst', b.x + (Math.random() - 0.5) * b.r * 1.6, b.y + b.r * 0.3, b.d - b.r * 0.5, 1, Math.random() < 0.5 ? 0x8ff4ff : 0xff9ad0, 3, 0.16 + b.r * 0.04, 2);
    if (this.powerT > 0 && Math.random() < dt * 40) this._h('burst', b.x + (Math.random() - 0.5) * b.r, b.y - b.r * 0.2, b.d - b.r * 0.8, 1, Math.random() < 0.5 ? 0xffd45a : 0xffffff, 3, 0.16 + b.r * 0.04, 2);
    if (!b.airborne && b.speed > 3) {
      G.sprayT -= dt;
      if (G.sprayT <= 0) {
        G.sprayT = 0.05;
        const side = Math.random() < 0.5 ? -1 : 1;
        if (b.r < 2) this._h('burst', b.x + side * b.r * 0.7, b.y - b.r * 0.75, b.d - b.r * 0.4, 1, 0xffffff, 1.5 + b.speed * 0.08, 0.05 + b.r * 0.02, 2.5 + b.r * 0.3);
        else this._h('puff', b.x + side * b.r * 0.9, b.y - b.r * 0.6, -(b.d - b.r * 0.6), side * 2, 1.5, b.speed * 0.15, 0.6 + b.r * 0.35, 0.9, 0xf4f8ff, 0.4);
      }
    }
  }

  // ---- size tiers: YENİ BÖLGE!
  // a gate / finish sign within `m` metres ahead owns the message slot: tier banners and the avalanche warning wait
  _gateNear(m = 120) {
    const gs = this.world && this.world.gates, d = this.ball.d;
    if (!gs) return false;
    for (let i = 0; i < gs.length; i++) { const g = gs[i]; if (!g.broken && g.kind !== 'mini' && g.d - d < m && g.d - d > -6) return true; }
    return false;
  }

  _tierCheck() {
    const G = this.G, b = this.ball;
    const t = tierOf(b.r);
    if (G.tier < t && (this._gateNear(120) || G.finalBroken)) return;   // deferred: retried every frame
    while (G.tier < t && G.tier < CFG.tierNames.length - 1) {
      G.tier++;
      G.avl = G.tier;
      const name = CFG.tierNames[G.tier];
      this.stats.tierT[G.tier] = +G.t.toFixed(1);
      this.world.setTier(G.tier, b.d);
      if (this.L) G.surgeT = CFG.lvl.surgeT;
      this._msg(2, null, name, G.tier);
      this._h('track', 'cig_tier', { tier: G.tier + 1, name });
      this._h('track', 'milestone', { level: G.tier, r: b.r });
      this._h('sfx', 'milestone', G.tier);
      this._h('haptic', 'success');
      this._h('hitStop', 0.08);
      this._h('kick', 0.28, 7);
      this._h('flash', 'milestone');
      G.shake += 0.5 + G.tier * 0.15;
      this._h('burst', b.x, b.y, b.d, 24, 0xffffff, 10 + b.r, 0.3 + b.r * 0.06, 6);
      b.punch(0.12);
    }
  }

  // ---- golden snowball (cigplus pickup)
  _golden() {
    const G = this.G, b = this.ball;
    this.stats.goldens++;
    const bonus = Math.max(CFG.goldenMinTons, CFG.goldenTons * this.totalTons());
    G.bonusTons += bonus;
    this._grow(b.r ** 3 * (1 + CFG.goldenGrow));
    b.punch(0.1);
    this._h('sfx', 'milestone', 3);
    this._h('haptic', 'success');
    this._h('burst', b.x, b.y, b.d, 30, 0xffc928, 10 + b.r, 0.3 + b.r * 0.05, 7);
    this._h('flash', 'milestone');
    G.shake += 0.4;
    this._text('ALTIN KARTOPU!', b, 'big', true);
    this._msg(2, `🌟 +${fmtTonsShort(bonus)}`);
    this._tierCheck();
  }

  _wireHooks() {
    const self = this;
    this.plus.hooks = {
      onPower(kind) { self._h('onPower', kind); self._h('track', 'powerup', { kind }); },
      onPowerEnd(kind) { self._h('onPowerEnd', kind); },
      onGolden() { self._golden(); },
      onBridgeFall() { self._bridgeFall(); },
      onShot() { self._shotHit(); },
      onLaunch(vy, o) {
        const b = self.ball, G = self.G;
        b.airborne = true; b.airTime = 0; b.vy = Math.min(vy, CFG.hopMax + 2);
        self._h('haptic', 'medium');
      },
      onFlip() {
        const b = self.ball, G = self.G;
        self._grow(b.r ** 3 * 1.06);
        G.bonusTons += self.snowTons() * 0.1;
        G.shake += 0.9;
        self._h('burst', b.x, b.y, b.d, 30, 0xff4fd8, 12 + b.r, 0.35 + b.r * 0.06, 8);
        self._tierCheck();
      },
      float(text, cls) { self._text(text, self.ball, cls, true); },
      haptic(kind) { self._h('haptic', kind); },
      burst(x, y, d, n, color, speed, size, up) { self._h('burst', x, y, d, n, color, speed, size, up); },
      sfx(name) { self._h('plusSfx', name); },
    };
  }

  // ---- HUD pass (10 Hz)
  _hud() {
    const G = this.G, b = this.ball;
    const T = Math.min(tierOf(b.r), CFG.tierNames.length - 1);
    const lo = T === 0 ? CFG.startR : CFG.tierEdges[T - 1];
    const hi = CFG.tierSpan[T];
    const frac = clamp((b.r - lo) / Math.max(0.01, hi - lo), 0, 1);
    const hf = this.hungerFrac();
    const warn = hf < CFG.hungerWarn;
    if (warn && !this._hungry && G.t > 5 && G.state === 'play') {
      this._hungry = true;
      this._text('KAR ERİYOR! YE!', b, 'bad', true);
      this._h('haptic', 'warning');
    } else if (!warn && hf > CFG.hungerWarn * 1.5) this._hungry = false;
    this._h('hunger', hf, warn);
    // chase the record: a soft nudge near it, a proper cheer when it falls
    if (this.bestTons > 0 && G.state === 'play' && !this.L) {
      const t = this.totalTons();
      if (!this._recNear && t > this.bestTons * 0.9) { this._recNear = true; if (t <= this.bestTons) this._msg(2, '🏆 Rekora ramak kaldı!'); }
      if (!this._recHit && t > this.bestTons) {
        this._recHit = true;
        this._msg(2, '🏆 YENİ REKOR!');
        this._h('haptic', 'success');
        this._h('sfx', 'milestone', 3);
        this._h('flash', 'gold');
      }
    }
    // one reused payload (the host reads it synchronously): no per-tick allocation
    const I = this._hudInfo || (this._hudInfo = {});
    I.tons = this.totalTons(); I.dist = b.d; I.tierName = CFG.tierNames[T]; I.frac = frac; I.best = this.bestTons || 0;
    I.size = b.r * 2; I.tier = T + 1; I.speed = b.speed; I.hunger = hf; I.wave = this.wave.on && !(this.L && this.L.ters);
    if (this.L) this._fillLv(I);
    this._h('hud', I);
  }

  // the level HUD payload (one reused object, read synchronously by main.js)
  _fillLv(I) {
    const L = this.L, G = this.G, b = this.ball, g = this._next;
    const V = I.lv || (I.lv = { n: 0, label: '', S: 0, gateI: 0, gateD: 0, left: 0, need: 0, have: 0, ready: 0, kmh: 0, chainMul: 1, chain: 0, prog: 0, gap: 999, ters: 0, final: false, boss: false, locked: false, finalBroken: false });
    V.n = L.n; V.label = L.label; V.S = L.S;
    V.gateI = g ? g.i : L.S - 1;
    V.gateD = g ? g.d : L.length;
    V.left = Math.max(0, V.gateD - b.d);
    V.need = g ? g.minR * 2 : 0;
    V.have = b.r * 2;
    V.ready = g ? this._readyOf(g) : 2;
    V.kmh = b.speed * 3.6;
    V.mom = G.mom || 0;
    V.chainMul = G.chainMul || 1; V.chain = G.chain;
    V.prog = clamp(b.d / L.length, 0, 1);
    V.gap = this.wave.on && !L.ters ? b.d - this.wave.d : 999;
    V.ters = L.chase && L.chase.ters && this.wave.on ? Math.max(0, this.wave.d - b.d) : 0;
    V.final = !!g && (g.kind === 'final' || g.kind === 'boss');
    V.boss = L.boss; V.locked = !!g && g.locked; V.finalBroken = G.finalBroken;
  }

  // ---- end of run
  end(cause) {
    const G = this.G;
    if (G.state !== 'play') return;
    G.state = 'end';
    G.endT = 0;
    G.cause = cause;
    G.timeScale = 1;
    this.wave.on = cause === 'wave';
    this._h('ended', cause);
  }

  // Result payload (main shows it through ui.showResult).
  result() {
    const G = this.G, b = this.ball;
    const T = Math.min(Math.max(G.tier, tierOf(b.r)), CFG.tierNames.length - 1);
    return {
      cause: G.cause, tons: this.totalTons(), dist: b.d, tier: T + 1, tierName: CFG.tierNames[T],
      time: G.t, eats: this.stats.eats, maxCombo: this.stats.maxCombo, bumps: this.stats.bumps, gates: this.stats.gatesBroken, kills: this.stats.kills, bosses: this.stats.bosses, peakR: G.peakR,
      lv: this.L ? this.L.n : 0, win: !!G.win, finalR: G.finalR || b.r, stats: this.stats,
    };
  }

  // ---- end animation (the run is over: roll out, melt away or get buried)
  updateEnd(dt) {
    const G = this.G, b = this.ball, w = this.world;
    G.endT += dt;
    const pd = b.d;
    if (G.cause === 'melt') {
      b.speed = Math.max(0, b.speed - 18 * dt);
      const k = clamp(G.endT / 0.9, 0, 1);
      b.setRadius(Math.max(0.05, Math.cbrt(Math.max(1e-4, b.r ** 3 * (1 - 3 * dt)))));
      if (Math.random() < dt * 40) this._h('burst', b.x, b.y - b.r * 0.6, b.d, 2, 0x9fd6ff, 3, 0.12, 3);
      if (k >= 1) b.speed = 0;
    } else if (G.cause === 'wave') {
      b.speed = Math.max(0, b.speed - 25 * dt);
      this.wave.d += Math.max(this.wave.v, 8) * dt;
    } else if (G.cause === 'win') {
      b.speed = Math.max(0, b.speed - 22 * dt);
    } else if (G.cause === 'boss') {
      // shattered on the PATRON: the ball bursts into snow and is gone
      b.speed = 0;
      b.setRadius(Math.max(0.05, b.r * Math.exp(-6 * dt)));
      if (Math.random() < dt * 30) this._h('burst', b.x, b.y, b.d, 3, 0xffffff, 8, 0.2 + b.r * 0.1, 5);
    } else {
      b.speed = Math.max(0, b.speed - 14 * dt);
    }
    b.d += b.speed * dt;
    b.y = w.groundY(b.x, b.d) + b.r * 0.92;
    b.roll(0, b.d - pd);
  }

  // ===================================================================== bot (debug AUTO + balance sims)
  // bot.mode: 'greedy' (lane sampling toward food, around obstacles) | 'idle' (never steers) | 'random'.
  // bot.latency delays decisions like a human reaction; bot.noise adds sloppiness (0..1).
  _botTarget(dt, lim) {
    const G = this.G, bot = this.bot;
    if (bot.mode === 'idle') return G.targetX;
    if (bot.mode === 'random') {
      bot.rw -= dt;
      if (bot.rw <= 0) { bot.rw = 0.6 + Math.random() * 1.2; bot.rt = (Math.random() * 2 - 1) * lim; }
      return bot.rt ?? 0;
    }
    bot.tick -= dt;
    if (bot.tick <= 0) {
      bot.tick = 0.1;
      const x = this._botPlan(lim);
      bot.queue.push({ t: G.t + bot.latency, x });
    }
    while (bot.queue.length > 1 && bot.queue[1].t <= G.t) bot.queue.shift();
    if (bot.queue.length && bot.queue[0].t <= G.t) bot.cur = bot.queue[0].x;
    return bot.cur ?? G.targetX;
  }

  _botPlan(lim) {
    const b = this.ball, w = this.world, bot = this.bot;
    const look = 14 + b.speed * 0.9 + b.r * 3;
    const Rs = this.suctionR();
    w.query(b.x, b.d + look * 0.5, Math.max(lim, look * 0.5 + 2), _near);
    const N = 21;
    let bestX = b.x, bestS = -1e9;
    const maxV = 30 + 3 * b.r;
    for (let k = 0; k < N; k++) {
      const x = -lim + (2 * lim * k) / (N - 1);
      let s = 0;
      const move = Math.abs(x - b.x);
      for (let i = 0; i < _near.length; i++) {
        const p = _near[i];
        if (!p.alive) continue;
        const dd = p.d - b.d;
        if (dd < -2 || dd > look) continue;
        const need = (move - 0.5) / Math.max(1, maxV * 0.7);
        const have = Math.max(0, dd) / Math.max(4, b.speed);
        const lat = Math.abs(p.x - x);
        if (p.crate) {
          // crates: smash them (golden ones first); an iron one only when big enough
          if (lat < b.r + p.r * CFG.contactK + 0.4) s += p.crate.iron && b.r < p.crate.need ? -12 : (3 + (p.crate.gold ? 3 : 0)) / (1 + dd * 0.05);
          continue;
        }
        if (p.enemy && p.enemy.roll && b.r > p.r * 1.05) {   // a small rolling ball: eat it
          if (lat < b.r + p.r) s += 3 / (1 + dd * 0.05);
          continue;
        }
        if (this._edible(p)) {
          if (need > have + 0.15) continue;
          const reach = Rs * 0.85 + p.r * 0.4;
          if (lat < reach) s += ((p.r / b.r) ** 2 + 0.1) / (1 + dd * 0.06) * (1 - 0.5 * lat / reach);
        } else {
          const clear = b.r + p.r * CFG.contactK + 0.7 + (1 - bot.noise) * 0.4;
          if (lat < clear && dd < look) s -= 30 * (1 + p.r / b.r) / (1 + Math.max(0, dd) * 0.04);
        }
      }
      // dirt patches melt: stay off them
      for (const pt of w.patches) {
        const dd = pt.d - b.d;
        if (dd > -pt.rd && dd < look && Math.abs(x - pt.x) < pt.rx + b.r) s -= 6;
      }
      if (this.L) {
        // shrink pads: warm puddles cost more than salt; speed strips pull a little
        for (const h of this.plus.hazards) {
          const dd = h.d - b.d;
          if (dd > -h.rd - 1 && dd < look && Math.abs(x - h.x) < h.rx + b.r * 0.5) s -= h.kind === 'puddle' ? 9 : 4;
        }
        for (const q of this.plus.strips) {
          const dd = q.d - b.d;
          if (dd > -2 && dd < look && Math.abs(x - q.x) < q.w / 2) s += 2.5;
        }
        // half-width ice walls: break them when big enough, stay clear otherwise
        for (let q = 0; q < w.gates.length; q++) {
          const g = w.gates[q];
          if (g.kind !== 'mini' || g.broken) continue;
          const dd = g.d - b.d;
          if (dd > -2 && dd < look && x > g.x0 - b.r * 0.6 && x < g.x1 + b.r * 0.6) s += this._readyOf(g) === 2 ? 2 : -40;
        }
      }
      s -= move * 0.015;
      if (s > bestS) { bestS = s; bestX = x; }
    }
    // boss arena: go for the boss
    if (this.L && this.L.finale.kind === 'boss' && !this.G.finalBroken && w.bossProp && w.bossProp.alive) {
      const bp = w.bossProp, dd = bp.d - b.d;
      if (dd > -b.r * 2 && dd < 90) bestX = clamp(bp.x, -lim, lim);
    }
    // human sloppiness
    if (bot.noise > 0) bestX += (Math.random() - 0.5) * bot.noise * (2 + b.r);
    return bestX;
  }
}

function newStats() {
  return { eats: 0, bumps: 0, gates: 0, gatesBroken: 0, maxCombo: 0, goldens: 0, waves: 0, tierT: [], stalls: 0, chunksEaten: 0, kills: 0, bosses: 0, smashes: 0,
    bounces: 0, hits: 0, crates: 0, gold: 0, maxChain: 0, maxMul: 1, rivalEaten: 0, time: 0, statues: 0, secret: 0, throne: 0 };
}

const _stickPos = new THREE.Vector3();
const TIPS = {
  gate: 'Bariyer kapıyı kırmak için yeterince büyü: yeşil yanınca çarp!',
  crate: 'Kasalara çarp: kır, topla, zincir yap!',
  hot: 'Kızıl sıcak nokta karı eritir: etrafından dolan!',
  fork: 'Yol ayrımı: riskli taraf ödüllü, güvenli taraf sakin.',
  statues: 'Tüm heykelleri yık: seri bonusu kazan!',
  secret: 'Çatlak buz duvar: yeterince büyüksen parlar, kır!',
  throne: 'Kardan adam tahtına çarp: bloklar devrilsin, tacı yık!',
  domino: 'İlk ağaca çarp: domino gibi devrilsin!',
  riders: 'Art arda 3 kardan adam ye: EKİP TOPU üstüne biner!',
};
const RIVAL_RED = [1, 0.45, 0.45], RIVAL_BLUE = [0.7, 0.95, 1], RIVAL_WHITE = [1, 1, 1];

function fmtD(d) {
  if (d >= 10) return String(Math.round(d));
  return (Math.round(d * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '');
}

function fmtTonsShort(t) {
  if (t < 10) return `${t.toFixed(1).replace('.', ',')} ton`;
  if (t < 1000) return `${Math.round(t)} ton`;
  return `${(t / 1000).toFixed(1).replace('.', ',')} bin ton`;
}
