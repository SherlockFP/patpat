// track.js — endless DOWNHILL snow run for the SONSUZ (endless) mode.
//
// Coordinates: s = arc length along the centreline (m), u = lateral offset (+ right), h = height above the
// path surface plane. Three lanes at u = LANES = [-2.4, 0, +2.4] (LANE_W = 2.4); normal halfWidth 3.8.
// The path starts at the origin heading -Z and descends continuously (mean pitch ~ -9 deg, -4 .. -16).
// The heading is mean-reverted inside +-64 deg of -Z, so the path is monotonic in -Z and never self-intersects.
//
// Frames: per-sample tangent + up built by PARALLEL TRANSPORT (rotation-minimizing) with a separate ROLL channel
// (banked turns: roll = clamp(11 * yawRate, +-35 deg)); right = tan x up (right.y != 0 when banked).
// Edges per piece: 'wall' (snow bank 0.8 m, edgeAt > 0) or 'cliff' (rocky drop, edgeAt = 0).
// Set pieces (phase 2, at most one per ~250-400 m, switchable with track.features.<name> = false):
//   helix, waves, skiJump, chasm, iceBridge, halfpipe, tube, zipline, corkscrew, loop.
//   piece fields: helix{R,dir,turns,bank} wave{k,A,base}+valleyAt(s) slowmo{s0,s1,scale} ice{state,...} pipe{} tube{}
//   zip{s0,s1,u,h} (needsZip) loop{s0,s1,R,minSpeed,plannedSpeed,shift} corkscrew{s0,s1,dir}
//   palette(s).checker = true -> Green Hill checkerboard (tileA/tileB top, earthA/earthB flanks).
// Temple Run junctions (kind 'junction'): piece.junction = { id, s0 (turn window start), s (corner), dir (-1 left / +1 right), sEnd, Lc, R, win }; track.junctionAt(s)
//   returns the junction whose [s0 - 60, s + 6] contains s (else null); opts.junctionOk(s) (false in the ice cave) and allows('junction') (campaign: level 11+) gate them.
// Ground queries: surfaceAt(s, u) (-Infinity = hole), solidAt(s, u), supportAt(s, u, r) (highest ground under a ball of radius r); every piece is [s0, s1) so a seam never reads as a hole.
// Zones: track.setZone('lasers'|'missiles'|'narrow'|'movers'|'coinRain'|'boss'|'storm'|null, { from, until }) stages a rule-change stretch.
// Every piece owns ONE merged vertex-coloured mesh (world-space vertices, shared material).
// Path samples are stored at 1 m spacing and interpolated.

import * as THREE from 'three';
import { makeRng } from '../rng.js';

const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;

export const TRACK = {
  HW: 3.8,            // standard half width (3 lanes at u = -2.4, 0, +2.4)
  CURB_W: 0.4, CURB_H: 0.8, TRIM_W: 0.14,   // wall = 0.8 m snow bank; cliff = no bank
  GROUT: 0.06,        // grout plane sits this far below the tile tops
  FAS_B: -0.5,        // bottom of the vertical fascia (relative to plane)
  BOT: -1.3,          // bottom of the slab
  YAW_MAX: 64 * DEG,
  PILLAR_EVERY: 60, PILLAR_DROP: 50,
  G: 28, JUMP_VH: 8.5, RAMP_BOOST: 1.1, RAMP_MIN_VH: 6,
  PORTAL_LEN: 30,
  ROW: 0.87,          // grid row spacing target (m)
  FLAT: -4 * DEG,     // 'flat' pitch before jumps
  FLAT2: -6 * DEG,    // mild pitch before other hazard pieces / obstacle clusters
  START_PITCH: -4 * DEG,
  PILLARS: false,
  BANK_K: 11, BANK_MAX: 35 * DEG,   // banked turns: roll = clamp(BANK_K * yawRate)
};
/** Subway-Surfers style lanes (track-local u). */
export const LANE_W = 2.4;
export const LANES = [-2.4, 0, 2.4];                // mutable: setLanes(n) re-centres it for n = 3 / 4 / 5 lanes
export const hwFor = (n) => ((n - 1) * LANE_W) / 2 + 1.4;   // 3 -> 3.8, 4 -> 5.0, 5 -> 6.2
export function setLanes(n) { n = Math.max(3, Math.min(5, n | 0 || 3)); if (LANES.length !== n) { LANES.length = 0; for (let i = 0; i < n; i++) LANES.push(+((i - (n - 1) / 2) * LANE_W).toFixed(4)); } return n; }
export const laneOf = (u) => Math.max(0, Math.min(LANES.length - 1, Math.round(u / LANE_W + (LANES.length - 1) / 2)));
export const laneMask = () => (1 << LANES.length) - 1;
const T = TRACK;

/** Flight distance of a ball launched at vertical speed vh0 from h0 above the landing level. */
export function flightDist(vs, vh0, h0, g = T.G) {
  const t = (vh0 + Math.sqrt(vh0 * vh0 + 2 * g * Math.max(0, h0))) / g;
  return vs * t;
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrapPi = (x) => x - TAU * Math.round(x / TAU);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _cc = new THREE.Color();
const col = (hex) => { _cc.setHex(hex); return [_cc.r, _cc.g, _cc.b]; };
const scl = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// kinds a campaign level can allow / forbid (everything else is always allowed)
const LEVEL_CTRL = Object.fromEntries(['waves', 'helix', 'skiJump', 'chasm', 'iceBridge', 'halfpipe', 'tube', 'rail', 'zipline', 'loop', 'corkscrew', 'oncoming', 'duck', 'boulder', 'slideWall', 'wind', 'fog', 'lasers', 'missiles', 'junction', 'critters'].map((k) => [k, 1]));
const CH = ['X', 'Y', 'Z', 'YW', 'PT', 'TX', 'TY', 'TZ', 'UX', 'UY', 'UZ', 'RL'];
const DEFAULT_PAL = { tileA: 0xe8f1fb, tileB: 0xc9d9ee, edge: 0x7fb4e8, rail: 0x4a6a92, glow: 0xffd24a, under: 0x3a4f70 };

// ---------------------------------------------------------------------------
// Merged mesh builder. Triangles are auto-oriented towards a hint normal.
// ---------------------------------------------------------------------------
// shared scratch buffers: building a piece mesh allocates only the final (exact-size) typed arrays
let BUF_P = new Float32Array(1 << 18), BUF_C = new Float32Array(1 << 18), BUF_N = new Float32Array(1 << 18);
class MB {
  constructor() { this.k = 0; this.n = 0; }
  tri(a, b, c, hx, hy, hz, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    cb = cb || ca; cc = cc || ca;
    if (nx * hx + ny * hy + nz * hz < 0) { let t = b; b = c; c = t; t = cb; cb = cc; cc = t; nx = -nx; ny = -ny; nz = -nz; }
    const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= il; ny *= il; nz *= il;
    let k = this.k;
    if (k + 9 > BUF_P.length) {
      const np = new Float32Array(BUF_P.length * 2), nc = new Float32Array(BUF_C.length * 2), nn = new Float32Array(BUF_N.length * 2);
      np.set(BUF_P); nc.set(BUF_C); nn.set(BUF_N); BUF_P = np; BUF_C = nc; BUF_N = nn;
    }
    const P = BUF_P, C = BUF_C, N = BUF_N;
    N[k] = N[k + 3] = N[k + 6] = nx; N[k + 1] = N[k + 4] = N[k + 7] = ny; N[k + 2] = N[k + 5] = N[k + 8] = nz;
    P[k] = a[0]; P[k + 1] = a[1]; P[k + 2] = a[2]; P[k + 3] = b[0]; P[k + 4] = b[1]; P[k + 5] = b[2]; P[k + 6] = c[0]; P[k + 7] = c[1]; P[k + 8] = c[2];
    C[k] = ca[0]; C[k + 1] = ca[1]; C[k + 2] = ca[2]; C[k + 3] = cb[0]; C[k + 4] = cb[1]; C[k + 5] = cb[2]; C[k + 6] = cc[0]; C[k + 7] = cc[1]; C[k + 8] = cc[2];
    this.k = k + 9;
    this.n++;
  }
  quad(a, b, c, d, hx, hy, hz, col1, col2) {
    // col2 (optional) = colour of the c/d side (vertical gradients): a,b top; c,d bottom
    this.tri(a, b, c, hx, hy, hz, col1, col1, col2 || col1);
    this.tri(a, c, d, hx, hy, hz, col1, col2 || col1, col2 || col1);
  }
  fan(pts, n, hx, hy, hz, c) { for (let i = 1; i < n - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], hx, hy, hz, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(BUF_P.slice(0, this.k), 3));
    g.setAttribute('color', new THREE.BufferAttribute(BUF_C.slice(0, this.k), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(BUF_N.slice(0, this.k), 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Hex helpers (pointy-top hexes in (s,u); tips along s). Template (ds/Rs, du/half).
// ---------------------------------------------------------------------------
const HEX = [[1, 0], [0.5, 1], [-0.5, 1], [-1, 0], [-0.5, -1], [0.5, -1]];
const _pa = new Float64Array(40), _pb = new Float64Array(40);

function clipHP(src, n, dst, A, B, C) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const s1 = src[2 * i], u1 = src[2 * i + 1], s2 = src[2 * j], u2 = src[2 * j + 1];
    const d1 = A * s1 + B * u1 - C, d2 = A * s2 + B * u2 - C;
    if (d1 <= 0) { dst[2 * m] = s1; dst[2 * m + 1] = u1; m++; }
    if ((d1 < 0 && d2 > 0) || (d1 > 0 && d2 < 0)) {
      const t = d1 / (d1 - d2);
      dst[2 * m] = s1 + (s2 - s1) * t; dst[2 * m + 1] = u1 + (u2 - u1) * t; m++;
    }
  }
  return m;
}

/** Hex (scaled by k about its centre) clipped to |u| <= a0 + slope*(s-sc). Result in _pb, returns count. */
function cellPoly(sc, uc, Rs, half, k, a0, slope) {
  for (let i = 0; i < 6; i++) { _pb[2 * i] = sc + HEX[i][0] * Rs * k; _pb[2 * i + 1] = uc + HEX[i][1] * half * k; }
  let m = clipHP(_pb, 6, _pa, -slope, 1, a0 - slope * sc);
  if (m < 3) return 0;
  m = clipHP(_pa, m, _pb, -slope, -1, a0 - slope * sc);
  return m < 3 ? 0 : m;
}

const LANES_FOR = (n) => Array.from({ length: n }, (_, i) => +((i - (n - 1) / 2) * LANE_W).toFixed(4));
function gridParams(a, b, nc, w) {
  const L = b - a;
  const n = Math.max(1, Math.round(L / T.ROW));
  const Rs = L / (1.5 * n + 0.5);
  return { a, b, nc, w, n, Rs, step: 1.5 * Rs, k: w / (Math.sqrt(3) * Rs), ext: nc * w * 0.5 };
}
const hexCols = (hwT) => { const nc = Math.max(2, Math.round(2 * hwT)); return { nc, w: (2 * hwT) / nc }; };
const rowBoundary = (g, r) => g.a + 0.25 * g.Rs + g.step * r;   // s between row r-1 and r

/** Half width of a piece at s (0 inside a gap). Piecewise linear with integer break points. */
function pieceHW(p, s) {
  if (p.hwAt) return p.hwAt(s);
  switch (p.kind) {
    case 'gapRamp': case 'skiJump': case 'chasm': case 'gapJump': case 'zipline': return s >= p.gapS0 && s < p.gapS1 ? 0 : p.hw;
    case 'narrow': {
      const d = Math.min(s - p.s0, p.s1 - s);
      return p.hw + (hwFor(p.n || 3) - p.hw) * Math.max(0, 1 - d / (p.taper || 5));
    }
    default: return p.hw;
  }
}

// ---------------------------------------------------------------------------
export class Track {
  constructor(scene, opts = {}) {
    const { seed = 1, palette, speedAt, bpmAt, biomeIndexAt } = opts;
    this.scene = scene;
    this.seed = seed >>> 0;
    this.palette = palette || (() => DEFAULT_PAL);
    this.speedAt = speedAt || ((s) => Math.min(26, 9 + s * 0.0045));
    this.bpmAt = bpmAt || ((s) => Math.min(150, 96 + s * 0.012));
    this.biomeIndexAt = biomeIndexAt || ((s) => Math.floor(s / 600));
    this.gravityAt = opts.gravityAt || (() => T.G);      // optional: biome gravity mods (moon = low gravity -> longer flights)
    this.vGen = opts.vGen || ((s) => 1.1 * this.speedAt(s));   // design speed (top speed the ball can have at s): every TIME -> metres conversion of the generator
    this.junctionOk = opts.junctionOk || (() => true);   // junctionOk(s) false (ice cave ...) = no junction there
    this.tutorial = !!opts.tutorial;
    this.juncWinAt = opts.juncWinAt || null;              // (kept for the runner; the window is stored on each junction: junction.s0)
    this.hardness = opts.hardness ?? 1;                   // 0.7 Kolay, 1 Normal, 1.3 Zor, 1.7 Kabus
    this.level = null;                                    // campaign level: { length, boss, features, hardness, seed } or null (endless)
    this.levelFeatures = null;
    this.group = new THREE.Group();
    this.group.name = 'track';
    if (scene && scene.add) scene.add(this.group);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    this.pieces = [];
    this.onPiece = null;
    this.onReset = null;
    this.features = Object.assign({ helix: true, boost: true, spring: true, skiJump: true, chasm: true, waves: true, gates: true, iceBridge: true,
      conveyor: true, halfpipe: true, tube: true, rail: true, zipline: true, loop: true, corkscrew: true, checker: true,
      oncoming: true, duck: true, boulder: true, slideWall: true, wind: true, fog: true, lasers: true, missiles: true }, opts.features || {});
    this._f = new Float64Array(12);
    this.disposedGeometries = 0;
    this._init();
  }

  /** (re)initialise the path and the generator state; meshes must already be gone */
  _init() {
    this.rng = makeRng((this.seed ^ 0x9e3779b9) >>> 0);
    this.laneN = 3;
    this._wideAt = 2200 + 1200 * (((Math.sin((this.seed || 1) + 1) * 43758.5453) % 1 + 1) % 1); this._wideEnd = 0; this._bonusAt = 800; this._bonusN = 0;
    this.sBase = 0;
    const sp0 = Math.sin(T.START_PITCH), cp0 = Math.cos(T.START_PITCH);
    // per-sample channels: position, heading (yaw/pitch, for curvature), tangent, up (incl. roll), roll
    this.X = [0]; this.Y = [0]; this.Z = [0]; this.YW = [0]; this.PT = [T.START_PITCH];
    this.TX = [0]; this.TY = [sp0]; this.TZ = [-cp0]; this.UX = [0]; this.UY = [cp0]; this.UZ = [sp0]; this.RL = [0];
    this._ub = [0, cp0, sp0];     // parallel-transported 'base up' (roll 0)
    this._q = []; this._qSince = 99;
    this.genEnd = 0;
    this._ids = 0;
    this._since = 99;          // pieces since the last hazardous piece
    this._yawOff = 0;          // multiple of 2 pi consumed by helix pieces (mean-reversion uses yaw - _yawOff)
    this._nextSet = this.level ? 300 : 340;   // earliest s of the next set piece (helix, loop, halfpipe ...); endless keeps the first 300 m for teaching rows
    this._lastSet = '';
    // Temple Run junctions: earliest corner of the next one (endless: ~350 m, tutorial: 300 m), live junction list (junctionAt), blocked ranges
    this._juncs = []; this._jid = 0;
    this._nextCorner = this.tutorial ? 300 : 640;      // first corner at ~45 s
    this._lastCorner = -1e9;
    this.juncBlock = [];
    this._tt = [0];            // design-time table (seconds to run s = 0..k at speedAt): timeAt()
    this._lastBiome = this.biomeIndexAt(0);
    this._pi = 0;
    this._frS = NaN; this._frV = -1; this._ver = (this._ver || 0) + 1;     // frame cache (station, sample version)
    this._ss = []; this._hh = [];
    this._bossStarted = false; this._forced = []; this.finishS = Infinity; this._finished = false;
    this.zone = null;
  }

  /**
   * Stage a rule-change zone: setZone('lasers' | 'missiles' | 'narrow' | 'movers' | 'coinRain' | 'boss' | 'storm' | null, { until, from }).
   * Pieces generated from `from` (default: the end of what is already generated, so a zone set now starts ~300 m ahead of the ball)
   * until s >= `until` follow the zone: 'narrow' = narrow bridges / split pieces / hex platforms, every other zone = plain pieces
   * (no set pieces) while obstacles.js biases its content. Returns { kind, from, until } (null when cleared).
   */
  setZone(kind, opts = {}) {
    if (!kind) { this.zone = null; return null; }
    const from = opts.from != null ? opts.from : this.genEnd;
    this.zone = { kind, from, until: opts.until != null ? opts.until : from + 400 };
    this._q.length = 0;
    return this.zone;
  }
  /** zone kind covering s, or null */
  zoneAt(s) { const z = this.zone; return z && s >= z.from && s < z.until ? z.kind : null; }

  /** gravity (m/s^2) at s, from the optional gravityAt callback */
  gravity(s) { return this.gravityAt ? this.gravityAt(s) : T.G; }

  setHardness(k) { this.hardness = clamp(+k || 1, 0.4, 3); }

  /** may the generator / obstacles use this set piece or mechanic? (campaign allowlist + features switches) */
  allows(name) {
    if (this.bossHold && (name === 'junction' || name === 'loop' || name === 'corkscrew' || name === 'helix')) return false;     // Yeti boss phase: no corners / set pieces
    if (this.features[name] === false) return false;
    if (name === 'junction' && this.levelFeatures) {
      // campaign: junctions from level 11 on (level.features carries 'junction', or setLevel got the level id; the cumulative feature list
      // of level 12+ contains 'chasm' = a safe stand-in when neither is there)
      const F = this.levelFeatures;
      return F.has('junction') || (this.level.id != null ? this.level.id >= 11 : F.has('chasm'));
    }
    if (name === 'critters' && this.levelFeatures) return this.levelFeatures.has('critters') || this.levelFeatures.has('waves');   // campaign: critters from level 3 (the runner adds 'critters'; 'waves' = level 4+ as a stand-in)
    if (this.levelFeatures && LEVEL_CTRL[name]) return this.levelFeatures.has(name);
    return true;
  }

  /**
   * Campaign level: setLevel({ length, features, hardness, seed, boss }) restarts the track at s = 0; setLevel(null) = endless.
   * features = allowlist of the controlled kinds (LEVEL_CTRL); a FINISH piece (wide 60 m straight with a BITIS arch)
   * starts at s = length and everything after it is empty.
   */
  setLevel(cfg) {
    for (const p of this.pieces) if (p.mesh) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); this.disposedGeometries++; p.mesh = null; }
    this.pieces.length = 0;
    this.level = cfg ? { length: Math.max(120, Math.round(cfg.length || 1000)), boss: !!cfg.boss, id: cfg.id ?? cfg.levelId ?? null } : null;
    this.levelFeatures = cfg && cfg.features ? new Set(cfg.features) : null;
    if (cfg && cfg.hardness != null) this.setHardness(cfg.hardness);
    else if (!cfg) this.setHardness(1);
    if (cfg && cfg.seed != null) this.seed = cfg.seed >>> 0;
    this._init();
    if (this.level) this.finishS = this.level.length;
    if (this.onReset) this.onReset();
  }

  // ---------- generation driver ----------
  ensure(sAhead) { let guard = 0; while (this.genEnd < sAhead && guard++ < 64) this._gen(); }

  trim(sBehind) {
    const P = this.pieces;
    let removed = 0;
    while (P.length > 1 && P[0].s1 < sBehind) {
      const p = P.shift();
      if (p.mesh) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); this.disposedGeometries++; p.mesh = null; }
      removed++;
    }
    if (removed) this._pi = Math.max(0, this._pi - removed);
    const J = this._juncs;
    while (J.length && J[0].sEnd + 12 < sBehind) J.shift();
    const k = Math.floor(sBehind - 200) - this.sBase;
    if (k > 600) {
      for (const n of CH) this[n].splice(0, k);
      this.sBase += k; this._ver++;
    }
  }

  dispose() {
    for (const p of this.pieces) if (p.mesh) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); this.disposedGeometries++; p.mesh = null; }
    this.pieces.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.mat.dispose();
  }

  // ---------- frames ----------
  // f: 0..2 pos, 3 rx, 4 rz, 5..7 up, 8..10 tan, 11 ry   (right = tan x up; up includes the bank roll)
  _fr(s) {
    if (s === this._frS && this._frV === this._ver) return;
    this._frS = s; this._frV = this._ver;
    const f = this._f, X = this.X, last = X.length - 1;
    let x = s - this.sBase, ex = 0;
    if (x < 0) { ex = x; x = 0; } else if (x > last) { ex = x - last; x = last; }
    const i = last > 0 ? Math.min(x | 0, last - 1) : 0, t = x - i, i1 = last > 0 ? i + 1 : i;
    const px = X[i] + (X[i1] - X[i]) * t, py = this.Y[i] + (this.Y[i1] - this.Y[i]) * t, pz = this.Z[i] + (this.Z[i1] - this.Z[i]) * t;
    let tx = this.TX[i] + (this.TX[i1] - this.TX[i]) * t, ty = this.TY[i] + (this.TY[i1] - this.TY[i]) * t, tz = this.TZ[i] + (this.TZ[i1] - this.TZ[i]) * t;
    let tl = 1 / Math.sqrt(tx * tx + ty * ty + tz * tz); tx *= tl; ty *= tl; tz *= tl;
    let ux = this.UX[i] + (this.UX[i1] - this.UX[i]) * t, uy = this.UY[i] + (this.UY[i1] - this.UY[i]) * t, uz = this.UZ[i] + (this.UZ[i1] - this.UZ[i]) * t;
    const d = ux * tx + uy * ty + uz * tz; ux -= d * tx; uy -= d * ty; uz -= d * tz;
    const ul = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz); ux *= ul; uy *= ul; uz *= ul;
    f[0] = px + tx * ex; f[1] = py + ty * ex; f[2] = pz + tz * ex;
    f[3] = ty * uz - tz * uy; f[11] = tz * ux - tx * uz; f[4] = tx * uy - ty * ux;
    f[5] = ux; f[6] = uy; f[7] = uz;
    f[8] = tx; f[9] = ty; f[10] = tz;
  }

  frame(s, out) {
    this._fr(s);
    const f = this._f;
    out.pos.set(f[0], f[1], f[2]);
    out.tan.set(f[8], f[9], f[10]);
    out.right.set(f[3], f[11], f[4]);
    out.up.set(f[5], f[6], f[7]);
    return out;
  }

  toWorld(s, u, h, out) {
    this._fr(s);
    const f = this._f;
    out.set(f[0] + f[3] * u + f[5] * h, f[1] + f[11] * u + f[6] * h, f[2] + f[4] * u + f[7] * h);
    return out;
  }

  /** Bank roll (rad, + = banked to the right) at s. */
  rollAt(s) {
    const R = this.RL, L = R.length;
    if (L < 2) return R[0];
    const x = clamp(s - this.sBase, 0, L - 1), i = Math.min(x | 0, L - 2);
    return R[i] + wrapPi(R[i + 1] - R[i]) * (x - i);
  }

  /** Vertical world position of the path plane at s (linear between samples). */
  _planeY(s) {
    const Y = this.Y;
    let x = s - this.sBase;
    if (x <= 0) return Y[0];
    if (x >= Y.length - 1) return Y[Y.length - 1];
    const i = x | 0;
    return Y[i] + (Y[i + 1] - Y[i]) * (x - i);
  }

  yawAt(s) {
    const x = clamp(s - this.sBase, 0, this.YW.length - 1), i = Math.min(x | 0, Math.max(0, this.YW.length - 2));
    return this.YW.length > 1 ? this.YW[i] + (this.YW[i + 1] - this.YW[i]) * (x - i) : this.YW[0];
  }

  curvature(s) {
    const x = Math.floor(s - this.sBase);
    if (x < 0 || x >= this.YW.length - 1) return 0;
    return this.YW[x + 1] - this.YW[x];
  }

  // ---------- piece queries ----------
  pieceAt(s) {
    const P = this.pieces, n = P.length;
    if (!n) return null;
    let i = this._pi < n ? this._pi : n - 1;
    if (s >= P[i].s0 && s < P[i].s1) return P[i];
    if (s >= P[i].s1 && i + 1 < n && s < P[i + 1].s1 && s >= P[i + 1].s0) { this._pi = i + 1; return P[i + 1]; }
    if (s < P[0].s0 || s >= P[n - 1].s1) return null;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (P[mid].s0 <= s) lo = mid; else hi = mid - 1; }
    this._pi = lo;
    return P[lo];
  }

  halfWidth(s) { const p = this.pieceAt(s); return p ? pieceHW(p, s) : 0; }

  edgeAt(s) {
    const p = this.pieceAt(s);
    if (!p) return 0;
    if (p.gapS0 !== undefined && s >= p.gapS0 && s < p.gapS1) return 0;
    if (p.edgeHAt) return p.edgeHAt(s);
    if (p.edgeH !== undefined) return p.edgeH;
    return p.curb ? T.CURB_H : 0;
  }

  /** Slope dh/ds of a kicker ramp at s (0 elsewhere). */
  rampSlopeAt(s) {
    const p = this.pieceAt(s);
    return p && p.rampSlope !== undefined && s >= p.rampS0 && s < p.rampS1 ? p.rampSlope : 0;
  }

  /**
   * Temple Run junction at s: the junction whose [s0 - 60, s + 6] contains s (s0 = start of the turn window, s = corner, dir -1 left / +1 right), else null.
   * The returned object is the live one stored on piece.junction: { id, s0, s, dir, sEnd (end of the turn arc), Lc, R, win }.
   */
  junctionAt(s) {
    const J = this._juncs;
    for (let i = 0; i < J.length; i++) { const j = J[i]; if (s >= j.s0 - 60 && s <= j.s + 6) return j; }
    return null;
  }

  /** No junction piece may overlap [a, b] (tutorial scripts, level specials). */
  blockJunctions(a, b) { this.juncBlock.push([a, b]); }

  /** Seconds the ball needs (at the design speed) to run from 0 to s: the generator's time axis (tension cycle, row clock). */
  timeAt(s) {
    if (s <= 0) return 0;
    const tt = this._tt, k = Math.floor(s);
    while (tt.length <= k) { const i = tt.length - 1; tt.push(tt[i] + 1 / Math.max(1, this.speedAt(i + 0.5))); }
    return tt[k] + (s - k) / Math.max(1, this.speedAt(k + 0.5));
  }

  /** The one smooth, monotone difficulty budget d(s) in 0..1 (spacing, pattern complexity, lethal share, junction gap all read it). */
  budget(s) { return this._diff(s); }

  /** Gap in front of the ball: { edge: take-off lip s, far: landing lip s } of the first gap piece whose near lip lies in (s, s + maxD], else null. */
  gapAhead(s, maxD) {
    for (const p of this.pieces) {
      if (p.gapS0 === undefined) continue;
      if (p.gapS0 > s && p.gapS0 <= s + maxD) return { edge: p.gapS0, far: p.gapS1 };
    }
    return null;
  }

  /** Is there ground under (s, u)? Exactly the test the runner uses for 'solid' (surfaceAt > -Infinity), so gap edges / seams / holes agree everywhere. */
  solidAt(s, u) { return this.surfaceAt(s, u) > -Infinity; }

  /**
   * Highest ground under a ball of radius r at (s, u): the centre plus 4 points on a 0.7 r ring (s +- k, u +- k). -Infinity only when ALL of them are holes,
   * so a ball that is half over a gap edge / hex-hole / seam still counts as supported (the runner can snap to this instead of letting it drop).
   * Pieces are half-open [s0, s1) and every piece reports the same surface at the seam, so there is no 1-sample hole between pieces.
   */
  supportAt(s, u, r = 0) {
    let best = this.surfaceAt(s, u);
    if (r > 0) {
      const k = 0.7 * r;
      let v = this.surfaceAt(s + k, u); if (v > best) best = v;
      v = this.surfaceAt(s - k, u); if (v > best) best = v;
      v = this.surfaceAt(s, u + k); if (v > best) best = v;
      v = this.surfaceAt(s, u - k); if (v > best) best = v;
    }
    return best;
  }

  /** True if (s,u) is on a present hex cell of a grid piece (split / hexHoles / stairs). */
  _cell(p, s, u) {
    const g = p.grid;
    if (u > g.ext || u < -g.ext) return true;           // under the curb
    const r0 = Math.round((s - g.a - g.Rs) / g.step);
    let best = 1e9, bi = 0;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      if (r < 0 || r >= g.n) continue;
      const odd = r & 1;
      let c = Math.round(odd ? u / g.w + g.nc * 0.5 : u / g.w + (g.nc - 1) * 0.5);
      const cmax = odd ? g.nc : g.nc - 1;
      c = c < 0 ? 0 : c > cmax ? cmax : c;
      const uc = odd ? (c - g.nc * 0.5) * g.w : (c - (g.nc - 1) * 0.5) * g.w;
      const ds = (s - (g.a + g.Rs + r * g.step)) * g.k, du = u - uc;
      const d = ds * ds + du * du;
      if (d < best) { best = d; bi = r * (g.nc + 1) + c; }
    }
    return g.holes[bi] === 0;
  }

  surfaceAt(s, u) {
    const p = this.pieceAt(s);
    if (!p) return -Infinity;
    const au = u < 0 ? -u : u;
    if (p.surf) return p.surf(s, u);
    switch (p.kind) {
      case 'gapRamp': case 'skiJump': case 'chasm':
        if (s >= p.gapS0 && s < p.gapS1) return -Infinity;
        if (au > p.hw) return -Infinity;
        return s >= p.rampS0 && s < p.rampS1 ? p.rampSlope * (s - p.rampS0) : 0;
      case 'gapJump': case 'zipline':
        if (s >= p.gapS0 && s < p.gapS1) return -Infinity;
        return au > p.hw ? -Infinity : 0;
      case 'narrow':
        return au > pieceHW(p, s) ? -Infinity : 0;
      case 'split': case 'hexHoles':
        if (au > p.hw) return -Infinity;
        return this._cell(p, s, u) ? 0 : -Infinity;
      case 'stairs': {
        if (au > p.hw) return -Infinity;
        const a = p.stairs.a;
        if (s < a[0] || s >= a[a.length - 1]) return 0;
        let k = 0;
        while (k < a.length - 2 && s >= a[k + 1]) k++;
        return p.stairs.y[k] - this._planeY(s);
      }
      default:
        return au > p.hw ? -Infinity : 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Generation: piece selection, specs, path integration
// ---------------------------------------------------------------------------
// set pieces: unlock distance, weight, rough length (for spacing); at most one every ~250-400 m
const SET = { waves: 250, helix: 350, skiJump: 450, iceBridge: 400, halfpipe: 500, chasm: 650, tube: 700, zipline: 800, corkscrew: 900, loop: 1000 };
const SET_W = { waves: 1.2, helix: 1.0, skiJump: 1.0, iceBridge: 0.9, halfpipe: 1.0, chasm: 0.8, tube: 0.8, zipline: 0.7, corkscrew: 0.7, loop: 0.8 };
const SET_LEN = { waves: 90, helix: 200, skiJump: 60, iceBridge: 60, halfpipe: 60, chasm: 55, tube: 60, zipline: 70, corkscrew: 50, loop: 70 };
const HAZARD = { narrow: 1, gapRamp: 1, gapJump: 1, hexHoles: 1, split: 1, stairs: 1, waves: 1, helix: 1, skiJump: 1, iceBridge: 1, halfpipe: 1, chasm: 1, tube: 1, zipline: 1, corkscrew: 1, loop: 1, junction: 1 };
const NEEDS_FLAT = { gapRamp: 1, gapJump: 1, slalom: 1, skiJump: 1, chasm: 1, loop: 1 };
// downhill run: mean pitch ~ -9 deg, from -4 (flats before jumps / clusters) to -16 (plunges)
const PITCH_MIX = [[9, 0.1], [11, 0.2], [13, 0.25], [15, 0.2], [16, 0.25]];
const flatOf = (kind) => (kind === 'gapRamp' || kind === 'gapJump' || kind === 'skiJump' || kind === 'chasm' ? T.FLAT : T.FLAT2);

Object.assign(Track.prototype, {
  // ~0.5 at 1200 m, ~0.84 at 3000 m (balance note)
  _diff(s) { s *= this.hardness; return s <= 100 ? 0 : 1 - Math.exp(-(s - 100) / 1587); },

  _pickKind(s0, diff, since) {
    const rng = this.rng, zk = this.zoneAt(s0);
    if (zk && s0 >= 150) {
      const w = zk === 'narrow' ? { narrow: 3, split: 2, hexHoles: 1, straight: 1.2, curve: 0.8 } : { straight: 4, curve: 3, slalom: 2 };
      let tot = 0; for (const k in w) tot += w[k];
      let r = rng.next() * tot, kind = 'straight';
      for (const k in w) { r -= w[k]; if (r <= 0) { kind = k; break; } }
      return kind;
    }
    if (s0 < (this.level ? 150 : 300)) return rng.chance(0.55) ? 'straight' : 'curve';     // endless: the first 300 m are plain pieces (teaching rows)
    const sk = s0 * this.hardness;     // hardness unlocks the hard pieces earlier (Kabus) / later (Kolay)
    const w = { straight: 5 - 3 * diff, curve: 4, slalom: 1.6 + 1.4 * diff, narrow: 0, gapRamp: 1.5 + diff, gapJump: 0, hexHoles: 0, split: 0, stairs: 0 };
    if (sk >= 220) w.narrow = 1 + 1.6 * diff;
    if (sk >= 300) { w.stairs = 0.9; w.hexHoles = 0.9 + 1.4 * diff; }
    if (sk >= 400) w.split = 0.9 + 1.2 * diff;
    if (sk >= 520) w.gapJump = 0.5 + 1.6 * diff;
    const cool = (since < 1 ? (diff < 0.5 ? 0 : 0.12) : 1) * (s0 < 1000 ? 0.6 : 1);
    let tot = 0;
    for (const k in w) { if (HAZARD[k]) w[k] *= cool; tot += w[k]; }
    let r = rng.next() * tot, kind = 'straight';
    for (const k in w) { r -= w[k]; if (r <= 0) { kind = k; break; } }
    return kind;
  },

  _pickSet(sEst, diff) {
    const rng = this.rng, w = {};
    let tot = 0;
    for (const k in SET) if (sEst * this.hardness >= SET[k] && this.allows(k) && k !== this._lastSet && this['_spec_' + k]) { w[k] = SET_W[k]; tot += w[k]; }
    if (tot <= 0) return null;
    let r = rng.next() * tot, kind = null;
    for (const k in w) { r -= w[k]; if (r <= 0) { kind = k; break; } }
    if (!kind) return null;
    this._lastSet = kind;
    this._nextSet = sEst + SET_LEN[kind] + rng.range(250, 400 - 80 * diff) / Math.sqrt(this.hardness);
    return kind;
  },

  _qPick(sEst) {
    const L = this.level, diff = this._diff(sEst);
    if (this._bossStarted) return this._forced.length ? this._forced.shift() : 'straight';   // boss finale: chasm, straight, skiJump, then run-in
    if (L && sEst > L.length - 150) return 'straight';                                         // calm run-in before the finish

    let kind = sEst >= this._nextSet && !this.zoneAt(sEst) && this.rng.chance(0.8) ? this._pickSet(sEst, diff) : null;
    if (!kind) kind = this._pickKind(sEst, diff, this._qSince);
    // Full vertical loops are no longer generated: from the inside, a 5.5-11 m ring fills the screen with track whatever the
    // camera does. A gentle rolling-hills section (waves) takes their slot. (A loop pushed into _q by hand still builds — tests.)
    if (kind === 'loop') kind = 'waves';
    this._qSince = HAZARD[kind] ? 0 : this._qSince + 1;
    return kind;
  },

  /** Signed yaw change of magnitude `mag`, biased to steer back towards -Z, never beyond YAW_MAX. */
  _turn(yaw0, mag) {
    const rng = this.rng;
    const toward = -Math.sign(yaw0) || rng.sign();
    const pTow = 0.5 + 0.45 * Math.min(1, Math.abs(yaw0) / T.YAW_MAX);
    let sg = rng.chance(pTow) ? toward : -toward;
    let d = sg * mag;
    if (Math.abs(yaw0 + d) > T.YAW_MAX) {
      sg = -sg; d = sg * mag;
      if (Math.abs(yaw0 + d) > T.YAW_MAX) d = clamp(yaw0 + d, -T.YAW_MAX, T.YAW_MAX) - yaw0;
    }
    return d;
  },

  /** Pitch at the end of a free-form piece: flat before pieces that need it, else a sample of PITCH_MIX. */
  _pitchPlan(p) {
    const rng = this.rng;
    if (p.flatten || NEEDS_FLAT[this._q[0]]) { p.pitch1 = flatOf(this._q[0]); return; }
    if (p.s0 > 100 && rng.chance(0.2)) { p.pitch1 = p.pitch0; return; }
    const lim = p.s0 < 150 ? 9 : 16;
    let r = rng.next(), acc = 0, d = 9;
    for (const m of PITCH_MIX) { acc += m[1]; if (r <= acc) { d = m[0]; break; } }
    p.pitch1 = -Math.min(d, lim) * DEG;
  },

  _pitchAt(p, s, t) {
    if (p.stairs) {
      const a = p.stairs.a, a0 = a[0], an = a[a.length - 1], P0 = p.pitch0, P = -p.stairs.P, P1 = p.pitch1;
      if (s <= a0 - 4) return P0;
      if (s < a0) return P0 + (P - P0) * smooth((s - (a0 - 4)) / 4);
      if (s <= an) return P;
      if (s < an + 4) return P + (P1 - P) * smooth((s - an) / 4);
      return P1;
    }
    return p.pitch0 + (p.pitch1 - p.pitch0) * smooth(t);
  },

  _spec(kind, s0, diff, biome, flatten) {
    const rng = this.rng, last = this.YW.length - 1;
    const p = {
      id: this._ids++, kind, s0, s1: s0, len: 0, hw: hwFor(this.laneN), halfWidth: hwFor(this.laneN), n: this.laneN, diff, biome,
      curb: true, edge: 'wall', needsJump: false, flatten: !!flatten,
      yaw0: this.YW[last], pitch0: this.PT[last], pitch1: this.PT[last], dYaw: 0, mesh: null,
    };
    // edge kind: 'wall' = snow bank (curb > 0, ball bounces) / 'cliff' = rocky drop (curb 0)
    if (kind === 'narrow') p.curb = false;
    else if (kind === 'portal' || kind === 'finish' || s0 < 150) p.curb = true;
    else p.curb = rng.next() >= Math.min(0.9, (0.1 + 0.55 * diff) * this.hardness);   // cliff share grows with hardness
    p.edge = p.curb ? 'wall' : 'cliff';
    const trim = p.curb ? T.CURB_W : T.TRIM_W;
    const yaw0 = p.yaw0 - this._yawOff;
    switch (kind) {
      case 'straight':
        p.len = s0 === 0 ? 40 : rng.int(28, 56);
        if (s0 > 100 && rng.chance(0.35)) p.dYaw = this._turn(yaw0, rng.range(5, 16) * DEG);
        this._pitchPlan(p);
        break;
      case 'curve':
        p.len = rng.int(42, 66);
        p.dYaw = this._turn(yaw0, rng.range(25, 62) * DEG);
        this._pitchPlan(p);
        break;
      case 'slalom':
        p.len = rng.int(40, 56);
        if (rng.chance(0.3)) p.dYaw = this._turn(yaw0, rng.range(6, 18) * DEG);
        this._pitchPlan(p);
        break;
      case 'narrow':
        p.len = rng.int(30, 50 + Math.round(10 * diff)); p.hw = 1.3;
        p.taper = clamp(Math.ceil(0.45 * this.speedAt(s0)), 6, 12);
        if (rng.chance(0.4)) p.dYaw = this._turn(yaw0, rng.range(8, 28) * DEG);
        break;
      case 'gapRamp': {
        const rampLen = 8, rampH = 2.0, land = 10, lead = Math.max(8, Math.ceil(1.0 * this.speedAt(s0)) - rampLen);
        const lipS = s0 + lead + rampLen;
        const vs = this.speedAt(lipS), slope = rampH / rampLen;
        const vh = Math.max(T.RAMP_MIN_VH, vs * slope * T.RAMP_BOOST);
        const fl = flightDist(vs, vh, rampH, this.gravity(lipS));
        const gap = Math.max(4, Math.floor(fl * rng.range(0.42, 0.62 + 0.04 * diff)));
        Object.assign(p, { rampS0: s0 + lead, rampS1: lipS, rampH, rampSlope: slope, gapS0: lipS, gapS1: lipS + gap, gap, flight: fl, launchVh: vh });
        p.len = lead + rampLen + gap + land;
        break;
      }
      case 'gapJump': {
        const lead = Math.max(10, Math.ceil(1.1 * this.speedAt(s0))), land = 10;
        const gS0 = s0 + lead, vs = this.speedAt(gS0);
        const fl = flightDist(vs, T.JUMP_VH, 0, this.gravity(gS0));
        const gap = Math.max(3, Math.floor(fl * rng.range(0.38, 0.5 + 0.16 * diff)));
        Object.assign(p, { gapS0: gS0, gapS1: gS0 + gap, gap, flight: fl });
        p.needsJump = true;
        p.len = lead + gap + land;
        break;
      }
      case 'split': {
        // centre lane missing for a stretch; left + right lanes stay
        const vs = this.speedAt(s0), lead = Math.max(12, Math.ceil(1.3 * vs)), hole = rng.int(14, 24), tail = 8;
        p.len = lead + hole + tail; p.hw = hwFor(p.n);
        const hc = hexCols(p.hw - trim);
        const g = (p.grid = gridParams(s0, s0 + p.len, hc.nc, hc.w));
        g.holes = new Uint8Array(g.n * (g.nc + 1));
        const sa = s0 + lead, sb = s0 + lead + hole;
        for (let r = 0; r < g.n; r++) {
          const odd = r & 1, sc = g.a + g.Rs + r * g.step;
          for (let c = 0; c <= g.nc; c++) {
            const uc = odd ? (c - g.nc * 0.5) * g.w : (c - (g.nc - 1) * 0.5) * g.w;
            g.holes[r * (g.nc + 1) + c] = (!odd && c === g.nc) || (sc >= sa && sc < sb && Math.abs(uc) < (p.n === 4 ? 2.5 : 1.3)) ? 1 : 0;
          }
        }
        p.lanes = LANES_FOR(p.n).filter((u) => Math.abs(u) >= (p.n === 4 ? 2.5 : 1.3)).map((u) => ({ u, hw: 1.2 }));
        p.holeS0 = sa; p.holeS1 = sb;
        break;
      }
      case 'hexHoles': {
        // platform with whole lane-segments missing; always >= 1 free lane, reachable from the previous segment
        const vs = this.speedAt(s0), segLen = Math.max(8, Math.round(vs * 1.0)), lead = Math.max(14, Math.ceil(1.5 * vs)), tail = 7;
        const nSeg = Math.max(3, Math.min(rng.int(3, 5), Math.floor(90 / segLen)));
        p.len = lead + nSeg * segLen + tail; p.hw = hwFor(p.n);
        const hc = hexCols(p.hw - trim);
        const g = (p.grid = gridParams(s0, s0 + p.len, hc.nc, hc.w));
        g.holes = new Uint8Array(g.n * (g.nc + 1));
        const segs = [];
        const NL = p.n; let route = NL >> 1;
        for (let k = 0; k < nSeg; k++) {
          const opts = [route - 1, route, route + 1].filter((x) => x >= 0 && x < NL);
          route = opts[rng.int(0, opts.length - 1)];
          const free = [route];
          if (k === 0 && route !== (NL >> 1)) free.push(NL >> 1);   // the entry always keeps the centre lane solid too
          else if (!(diff > 0.15 && rng.chance(0.35 + 0.5 * diff))) { let o; do { o = rng.int(0, NL - 1); } while (o === route); free.push(o); }
          segs.push({ s0: s0 + lead + k * segLen, s1: s0 + lead + (k + 1) * segLen, route, free });
        }
        p.laneSegs = segs;
        for (let r = 0; r < g.n; r++) {
          const odd = r & 1, sc = g.a + g.Rs + r * g.step;
          const seg = segs.find((q) => sc >= q.s0 && sc < q.s1);
          const fset = seg ? seg.free.slice() : null;
          // overlap: the old lane set stays solid for ~0.35 s into the next segment and the next set appears ~0.35 s early,
          // so a one-lane shift between consecutive segments is always possible (0.2 s per lane)
          const buf = Math.max(5, Math.ceil(0.35 * vs));
          if (seg) for (const q of segs) {
            if ((q.s1 === seg.s0 && sc - seg.s0 < buf) || (q.s0 === seg.s1 && seg.s1 - sc < buf)) for (const x of q.free) if (fset.indexOf(x) < 0) fset.push(x);
          }
          for (let c = 0; c <= g.nc; c++) {
            const uc = odd ? (c - g.nc * 0.5) * g.w : (c - (g.nc - 1) * 0.5) * g.w;
            let hole = (!odd && c === g.nc) ? 1 : 0;
            if (seg && !hole) { hole = 1; for (const li of fset) if (Math.abs(uc - LANES_FOR(NL)[li]) <= LANE_W * 0.5 + 0.4) { hole = 0; break; } }
            g.holes[r * (g.nc + 1) + c] = hole;
          }
        }
        p.pathU = (s) => {
          let k = 0;
          while (k < segs.length - 1 && s >= segs[k].s1) k++;
          const LF = LANES_FOR(NL); let u = LF[segs[k].route];
          if (k < segs.length - 1) { const w = smooth((s - (segs[k].s1 - 3)) / 6); u += (LF[segs[k + 1].route] - u) * w; }
          if (k > 0) { const w = smooth((s - (segs[k].s0 - 3)) / 6); u = LF[segs[k - 1].route] + (u - LF[segs[k - 1].route]) * w; }
          return u;
        };
        break;
      }
      case 'stairs': {
        const nSteps = rng.int(4, 6);
        p.len = Math.round((6 + 3 * nSteps + 8) * T.ROW);
        const hc = hexCols(p.hw - trim);
        const g = (p.grid = gridParams(s0, s0 + p.len, hc.nc, hc.w));
        g.holes = new Uint8Array(g.n * (g.nc + 1));
        for (let r = 0; r < g.n; r += 2) g.holes[r * (g.nc + 1) + g.nc] = 1;
        const r0 = 6, ns = Math.min(nSteps, Math.floor((g.n - r0 - 5) / 3));
        const a = [];
        for (let k = 0; k <= ns; k++) a.push(rowBoundary(g, r0 + 3 * k));
        p.stairs = { a, y: [], r0, n: ns, P: clamp(Math.abs(p.pitch0), 8 * DEG, 12 * DEG) };
        break;
      }
      case 'portal':
        p.len = T.PORTAL_LEN;
        break;
      default:
        if (!this._specX(kind, p, s0, diff, yaw0)) throw new Error('unknown piece kind ' + kind);
    }
    p.halfWidth = p.hw;
    p.s1 = s0 + p.len;
    return p;
  },

  /** Integrate samples for piece p: heading from yaw/pitch, up by parallel transport (+ level assist), roll = bank channel. */
  _integrate(p) {
    const last = this.YW.length - 1;
    let yawPrev = this.YW[last], pitchPrev = this.PT[last];
    let x = this.X[last], y = this.Y[last], z = this.Z[last];
    let tx = this.TX[last], ty = this.TY[last], tz = this.TZ[last];
    let ux = this._ub[0], uy = this._ub[1], uz = this._ub[2];
    for (let s = p.s0 + 1; s <= p.s1; s++) {
      const t = (s - p.s0) / p.len;
      const yaw = p.yawFn ? p.yawFn(t) : p.yaw0 + p.dYaw * (t - Math.sin(TAU * t) / TAU);
      const pitch = p.pitchFn ? p.pitchFn(t, s) : this._pitchAt(p, s, t);
      const ym = 0.5 * (yaw + yawPrev), pm = 0.5 * (pitch + pitchPrev), cpm = Math.cos(pm);
      x += Math.sin(ym) * cpm; y += Math.sin(pm); z -= Math.cos(ym) * cpm;
      const cp = Math.cos(pitch), nx = Math.sin(yaw) * cp, ny = Math.sin(pitch), nz = -Math.cos(yaw) * cp;
      // parallel transport of the base up from (tx,ty,tz) to (nx,ny,nz): rotate about T x N
      let kx = ty * nz - tz * ny, ky = tz * nx - tx * nz, kz = tx * ny - ty * nx;
      const sa = Math.sqrt(kx * kx + ky * ky + kz * kz), ca = tx * nx + ty * ny + tz * nz;
      if (sa > 1e-9) {
        kx /= sa; ky /= sa; kz /= sa;
        const kdu = kx * ux + ky * uy + kz * uz;
        const cx = ky * uz - kz * uy, cy = kz * ux - kx * uz, cz = kx * uy - ky * ux;
        const nux = ux * ca + cx * sa + kx * kdu * (1 - ca), nuy = uy * ca + cy * sa + ky * kdu * (1 - ca), nuz = uz * ca + cz * sa + kz * kdu * (1 - ca);
        ux = nux; uy = nuy; uz = nuz;
      }
      if (!p.free3d) {   // level assist: damp the holonomy twist back towards the world-up frame
        let ex = -nx * ny, ey = 1 - ny * ny, ez = -nz * ny;
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (el > 1e-3) { ex /= el; ey /= el; ez /= el; ux += (ex - ux) * 0.1; uy += (ey - uy) * 0.1; uz += (ez - uz) * 0.1; }
      }
      let d = ux * nx + uy * ny + uz * nz; ux -= d * nx; uy -= d * ny; uz -= d * nz;
      const ul = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz); ux *= ul; uy *= ul; uz *= ul;
      // bank roll about the tangent: up' = up cos + right sin  (right = N x up)
      const kappa = (p.dYaw / p.len) * (1 - Math.cos(TAU * t));
      const roll = p.rollAt ? p.rollAt(t) : clamp(T.BANK_K * kappa, -T.BANK_MAX, T.BANK_MAX);
      const rx = ny * uz - nz * uy, ry = nz * ux - nx * uz, rz = nx * uy - ny * ux;
      const cr = Math.cos(roll), sr = Math.sin(roll);
      this.X.push(x); this.Y.push(y); this.Z.push(z); this.YW.push(yaw); this.PT.push(wrapPi(pitch));
      this.TX.push(nx); this.TY.push(ny); this.TZ.push(nz);
      this.UX.push(ux * cr + rx * sr); this.UY.push(uy * cr + ry * sr); this.UZ.push(uz * cr + rz * sr); this.RL.push(wrapPi(roll));
      yawPrev = yaw; pitchPrev = pitch; tx = nx; ty = ny; tz = nz;
    }
    this._ub[0] = ux; this._ub[1] = uy; this._ub[2] = uz;
    this._yawOff += p.yawWrap || 0;
    this._ver++;
    this.genEnd = p.s1;
  },

  _finalize(p) {
    if (p.stairs) { const a = p.stairs.a; for (let k = 0; k < a.length - 1; k++) p.stairs.y[k] = this._planeY(a[k + 1]); }
  },

  /** can a lane-count change / bonus piece start at s0? (not in zones / boss / junction windows / right after hazards; loops are queue pieces, never overlapped) */
  _laneOk(s0) {
    const L = this.level;
    if (s0 < 400 || this.zone || this._bossStarted || this._finished || this._since < 1 || this._juncDue(s0)) return false;
    if (L && L.length && s0 > L.length - 260) return false;
    return true;
  },
  /** +1 = widen now, -1 = narrow now, 0 = neither. Wide sections (4 or 5 lanes) alternate with 3-lane ones. */
  _laneDue(s0) {
    // narrowing back to 3 is never held up by a zone / junction window: a wide section always stays short
    if (this.laneN !== 3) return s0 >= this._wideEnd && !this._finished ? -1 : 0;
    if (!this._laneOk(s0)) return 0;
    if (this.laneN === 3) return s0 >= this._wideAt && !(this._nextCorner > s0 - 1 && this._nextCorner - s0 < 170) ? 1 : 0;
    return s0 >= this._wideEnd ? -1 : 0;
  },
  _bonusDue(s0) { return s0 >= this._bonusAt && this._laneOk(s0) && !(this._nextCorner > s0 - 1 && this._nextCorner - s0 < 200); },

  _gen() {
    const s0 = this.genEnd, diff = this._diff(s0), L = this.level;
    const bNow = this.biomeIndexAt(s0);
    let p, lw = 0;
    if (L && this._finished) {
      // after the finish: empty straights so the ball can coast
      p = this._spec('straight', s0, diff, bNow, true);
      p.len = 40; p.s1 = s0 + 40; p.dYaw = 0; p.noObs = true;
    } else if (L && s0 >= L.length) {
      this._finished = true;
      p = this._spec('finish', s0, diff, bNow, true);
    } else if ((lw = this._laneDue(s0)) !== 0) {
      const oldN = this.laneN;
      this.laneN = lw > 0 ? (s0 > 6000 && this.rng.chance(0.1) ? 5 : 4) : 3;     // almost always 3 -> 4; 5 very rarely, only after 6 km
      p = this._spec('straight', s0, diff, bNow, false);
      const nn = this.laneN, hA = hwFor(oldN), hB = hwFor(nn);
      p.dYaw = 0; p.noObs = true; p.curb = true; p.edge = 'wall';
      if (lw > 0) {
        p.len = 44; p.s1 = s0 + 44; p.n = nn; p.widen = nn; p.hw = hB; p.halfWidth = hB; p.hwAt = (s) => hA + (hB - hA) * smooth((s - p.s0 - 4) / 34);
        this._wideEnd = s0 + 44 + this.rng.range(40, 80);       // SHORT burst: ~60-100 m at full width, ~140-180 m incl. the transitions
      } else {
        // narrowing: the piece keeps the wide lanes (n = old) while the outer lanes close; funnel arrows telegraph them, the runner pushes the ball inward
        p.len = 56; p.s1 = s0 + 56; p.n = oldN; p.narrow = oldN; p.hw = hA; p.halfWidth = hA; p.hwAt = (s) => hA + (hB - hA) * smooth((s - p.s0 - 14) / 34);
        this._wideAt = s0 + 56 + this.rng.range(3000, 4000);    // extremely rare: at most one wide burst per ~3-4 km
      }
    } else if (this._bonusDue(s0)) {
      const air = this._bonusN++ % 3 === 1, vs = this.speedAt(s0 + 40);
      p = this._spec('straight', s0, diff, bNow, false);
      p.bonus = air ? 'air' : 'slalom';
      p.len = air ? Math.round(10 + vs * 2.5 + 26) : Math.round(14 + 5 * vs * 0.85 + 8);
      p.s1 = s0 + p.len; p.dYaw = 0;
      this._bonusAt = s0 + p.len + this.rng.range(450, 800);
    } else if (bNow !== this._lastBiome) {
      this._lastBiome = bNow;
      p = this._spec('portal', s0, diff, bNow, true);
    } else {
      if (L && L.boss && !this._bossStarted && s0 >= L.length - 225) {
        this._bossStarted = true; this._forced = ['chasm', 'straight', 'skiJump']; this._q.length = 0;
      }
      while (this._q.length < 3) this._q.push(this._qPick(s0 + 40 * (this._q.length + 1)));
      let kind = this._q.shift();
      if (s0 === 0) kind = 'straight';
      else if (this._juncDue(s0)) { this._q.unshift(kind); kind = 'junction'; if (HAZARD[this._q[0]]) this._q[0] = 'straight'; }       // Temple Run junction: scheduled by the corner clock, not by the 3-deep queue
      const pNow = this.PT[this.PT.length - 1];
      const flatNow = Math.abs(pNow - flatOf(kind)) < 2.5 * DEG;
      let flatten = false;
      if (NEEDS_FLAT[kind] && !flatNow) { this._q.unshift(kind); kind = 'straight'; flatten = true; }
      p = this._spec(kind, s0, diff, bNow, flatten);
      if (L && p.s1 > L.length) {
        // would cross the finish line: replace by a straight that ends exactly on it (nearly flat for the arch)
        p = this._spec('straight', s0, diff, bNow, true);
        p.len = L.length - s0; p.s1 = L.length; p.dYaw = 0;
        if (p.len < 24) p.pitch1 = p.pitch0;
      } else if (this.biomeIndexAt(p.s1) !== bNow) {
        // biome boundary inside this piece: end it exactly at the boundary (portal follows)
        let lo = s0, hi = p.s1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.biomeIndexAt(mid) === bNow) lo = mid; else hi = mid; }
        const orig = p.kind;
        p = this._spec('straight', s0, diff, bNow, true);
        p.len = Math.min(hi - s0, 56); p.s1 = s0 + p.len; p.dYaw = 0;
        if (p.len < 24) p.pitch1 = p.pitch0;                       // no abrupt pitch change on a short filler
        if (SET[orig] !== undefined) this._q.unshift(orig);    // do not lose set pieces: retry after the portal
      }
    }
    this._integrate(p);
    this._finalize(p);
    if (p.junction) this._commitJunction(p);
    p.mesh = this._buildMesh(p);
    this.group.add(p.mesh);
    this.pieces.push(p);
    this._since = HAZARD[p.kind] ? 0 : this._since + 1;
    if (this.onPiece) this.onPiece(p);
    return p;
  },
});

// ---------------------------------------------------------------------------
// Mesh building
// ---------------------------------------------------------------------------
const VP = Array.from({ length: 12 }, () => [0, 0, 0]);
const SG = [-1, 1];
const TILE_K = 0.975;
const PILLARED = { straight: 1, curve: 1, slalom: 1, narrow: 1, portal: 1 };
const hash1 = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

Object.assign(Track.prototype, {
  _P(s, u, h, o) {
    this._fr(s);
    const f = this._f;
    o[0] = f[0] + f[3] * u + f[5] * h; o[1] = f[1] + f[11] * u + f[6] * h; o[2] = f[2] + f[4] * u + f[7] * h;
    return o;
  },

  _cols(p) {
    const pal = Object.assign({}, DEFAULT_PAL, this.palette(p.s0 + p.len * 0.5) || {});
    const under = col(pal.under), A = col(pal.tileA), B = col(pal.tileB);
    return {
      A, B, edge: col(pal.edge), rail: col(pal.rail), glow: col(pal.glow),
      under, grout: scl(mixc(B, under, 0.35), 0.8), dark: [0.012, 0.012, 0.02],
      // Green Hill style: palette.checker -> checkerboard top, brown / orange earth checker on the flanks
      checker: !!pal.checker && this.features.checker !== false,
      earthA: col(pal.earthA ?? 0x8a5a2b), earthB: col(pal.earthB ?? 0xc8782a),
    };
  },

  /**
   * Slab: packed-snow top (groomed bands + lane lines) or grout plane, snow banks (wall edge) or
   * jagged rock cliffs (cliff edge), fascia, tapered underside, optional end caps.
   */
  _slab(mb, o) {
    const { a, b, hwf, hTop, curb, C, rng } = o;
    const top = o.top || null, under = o.underside !== false;
    const trimW = curb ? T.CURB_W : T.TRIM_W, CH = curb ? T.CURB_H : 0, G = T.GROUT, FB = T.FAS_B, BOT = T.BOT, FOOT = 0.4;
    const bps = o.bps || null;
    const st = [a];
    for (let k = Math.floor(a) + 1; k < b - 1e-9; k++) st.push(k);
    st.push(b);
    if (bps) { for (const v of bps) if (v > a + 1e-6 && v < b - 1e-6) st.push(v); st.sort((x, y) => x - y); }
    const S = this._ss, H = this._hh;
    S.length = 0; H.length = 0;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (i > 0 && s - st[i - 1] < 1e-7) continue;
      if (bps && s > a + 1e-6 && s < b - 1e-6 && bps.indexOf(s) >= 0) { S.push(s, s); H.push(hTop(s - 1e-6), hTop(s + 1e-6)); }
      else { S.push(s); H.push(hTop(s)); }
    }
    let hm = 0;
    for (let i = 0; i < S.length; i++) hm = Math.max(hm, hwf(S[i]) - trimW);
    const nb = Math.max(2, Math.round((2 * hm) / 0.9));
    const f = this._f;
    // deterministic rock jitter at station s (cliff edges only)
    const jx = (s, sg) => (curb ? 0 : (hash1(s * 1.7 + sg * 9.1) - 0.5) * 0.7);
    const jy = (s, sg) => (curb ? 0 : -0.35 * hash1(s * 2.3 + sg * 4.7 + 1.3));
    for (let i = 0; i < S.length - 1; i++) {
      const s0 = S[i], s1 = S[i + 1];
      if (s1 - s0 < 1e-7) continue;
      const h0 = H[i], h1 = H[i + 1], w0 = hwf(s0), w1 = hwf(s1);
      if (w0 <= 0 && w1 <= 0) continue;
      this._fr(0.5 * (s0 + s1));
      const rx = f[3], rz = f[4], ux = f[5], uy = f[6], uz = f[7];
      const hT0 = w0 - trimW, hT1 = w1 - trimW, hb0 = w0 * 0.6, hb1 = w1 * 0.6;
      const P = (s, u, h, k) => this._P(s, u, h, VP[k]);
      if (top === 'grout') {
        mb.quad(P(s0, -hT0, h0 - G, 0), P(s0, hT0, h0 - G, 1), P(s1, hT1, h1 - G, 2), P(s1, -hT1, h1 - G, 3), ux, uy, uz, C.grout);
      } else if (top === 'snow') {
        const par = i & 1 ? 1 : 0.975;
        for (let bi = 0; bi < nb; bi++) {
          const f0 = -1 + (2 * bi) / nb, f1 = -1 + (2 * (bi + 1)) / nb;
          const cc = C.checker ? ((bi + i) & 1 ? C.A : C.B) : scl(mixc(C.A, C.B, bi & 1 ? 0.5 : 0.08), par * (0.985 + 0.03 * (rng ? rng.next() : 0.5)));
          mb.quad(P(s0, f0 * hT0, h0, 0), P(s0, f1 * hT0, h0, 1), P(s1, f1 * hT1, h1, 2), P(s1, f0 * hT1, h1, 3), ux, uy, uz, cc);
        }
        if (hT0 > 2.6) {   // lane lines at the lane boundaries (u = +-1.2)
          const lc = scl(C.B, 0.82);
          for (const sg of SG) {
            const u0 = sg * LANE_W * 0.5;
            mb.quad(P(s0, u0 - 0.05, h0 + 0.012, 0), P(s0, u0 + 0.05, h0 + 0.012, 1), P(s1, u0 + 0.05, h1 + 0.012, 2), P(s1, u0 - 0.05, h1 + 0.012, 3), ux, uy, uz, lc);
          }
        }
      }
      for (const sg of SG) {
        const hx = sg * rx, hz = sg * rz;
        if (curb) {
          // snow bank: sloped inner face + flat top
          mb.quad(P(s0, sg * (hT0 - FOOT), h0, 0), P(s0, sg * hT0, h0 + CH, 1), P(s1, sg * hT1, h1 + CH, 2), P(s1, sg * (hT1 - FOOT), h1, 3),
            -0.7 * hx + 0.7 * ux, 0.7 * uy, -0.7 * hz + 0.7 * uz, C.checker ? ((i + (sg > 0 ? 1 : 0)) & 1 ? C.earthA : C.earthB) : C.B);
          mb.quad(P(s0, sg * hT0, h0 + CH, 0), P(s0, sg * w0, h0 + CH, 1), P(s1, sg * w1, h1 + CH, 2), P(s1, sg * hT1, h1 + CH, 3), ux, uy, uz, C.A);
        } else {
          mb.quad(P(s0, sg * hT0, h0, 0), P(s0, sg * w0, h0, 1), P(s1, sg * w1, h1, 2), P(s1, sg * hT1, h1, 3), ux, uy, uz, C.A);
        }
        // outer wall (rock): top -> jagged bottom
        const rc = scl(C.rail, 0.85 + 0.3 * hash1(s0 * 3.1 + sg));
        const ju0 = jx(s0, sg), ju1 = jx(s1, sg), jb0 = FB + jy(s0, sg), jb1 = FB + jy(s1, sg);
        if (C.checker) {   // two stacked rows of earth checker on the flank
          const m0 = 0.5 * (h0 + CH + jb0), m1 = 0.5 * (h1 + CH + jb1);
          const e0 = (i + (sg > 0 ? 1 : 0)) & 1 ? C.earthA : C.earthB, e1 = (i + (sg > 0 ? 0 : 1)) & 1 ? C.earthA : C.earthB;
          mb.quad(P(s0, sg * w0, h0 + CH, 0), P(s0, sg * (w0 + 0.5 * ju0), m0, 1), P(s1, sg * (w1 + 0.5 * ju1), m1, 2), P(s1, sg * w1, h1 + CH, 3), hx, 0, hz, e0);
          mb.quad(P(s0, sg * (w0 + 0.5 * ju0), m0, 0), P(s0, sg * (w0 + ju0), jb0, 1), P(s1, sg * (w1 + ju1), jb1, 2), P(s1, sg * (w1 + 0.5 * ju1), m1, 3), hx, 0, hz, e1);
        } else mb.quad(P(s0, sg * w0, h0 + CH, 0), P(s0, sg * (w0 + ju0), jb0, 1), P(s1, sg * (w1 + ju1), jb1, 2), P(s1, sg * w1, h1 + CH, 3), hx, 0, hz, rc);
        if (under) mb.quad(P(s0, sg * (w0 + ju0), jb0, 0), P(s0, sg * hb0, BOT, 1), P(s1, sg * hb1, BOT, 2), P(s1, sg * (w1 + ju1), jb1, 3),
          0.7 * hx - 0.7 * ux, -0.7 * uy, 0.7 * hz - 0.7 * uz, C.under);
      }
      if (under) mb.quad(P(s0, -hb0, BOT, 0), P(s0, hb0, BOT, 1), P(s1, hb1, BOT, 2), P(s1, -hb1, BOT, 3), -ux, -uy, -uz, scl(C.under, 0.7));
    }
    const cap = (s, dir) => {
      const hw = hwf(s), topH = hTop(s) + CH;
      this._fr(s);
      const tx = f[8] * dir, ty = f[9] * dir, tz = f[10] * dir;
      const P = (ss, u, h, k) => this._P(ss, u, h, VP[k]);
      mb.quad(P(s, -hw, topH, 0), P(s, hw, topH, 1), P(s, hw, FB, 2), P(s, -hw, FB, 3), tx, ty, tz, C.rail);
      if (under) mb.quad(P(s, -hw, FB, 0), P(s, hw, FB, 1), P(s, hw * 0.6, BOT, 2), P(s, -hw * 0.6, BOT, 3), tx, ty, tz, C.under);
    };
    if (o.capA) cap(a, -1);
    if (o.capB) cap(b, 1);
  },

  /** Cell layer for grid pieces (split / hexHoles / stairs): snow blocks, hairline seams, walls around holes. */
  _hexGrid(mb, o) {
    const { g, hwf, C, rng, hFn, present, grout, walls } = o;
    const half = g.w * 0.5, f = this._f, G = T.GROUT;
    const emit = (m, h, r, ux, uy, uz, colr) => {
      for (let i = 0; i < m; i++) {
        const sv = _pb[2 * i], uv = _pb[2 * i + 1];
        this._P(sv, uv, h + (hFn ? hFn(sv, uv, r) : 0), VP[i]);
      }
      mb.fan(VP, m, ux, uy, uz, colr);
    };
    for (let r = 0; r < g.n; r++) {
      const odd = r & 1, sc = g.a + g.Rs + r * g.step, cnt = odd ? g.nc + 1 : g.nc;
      const a0 = hwf(sc), slope = hwf(sc + 0.5) - hwf(sc - 0.5);
      if (a0 <= 0.05) continue;
      this._fr(sc);
      const ux = f[5], uy = f[6], uz = f[7], tx = f[8], ty = f[9], tz = f[10], rx = f[3], rz = f[4];
      for (let c = 0; c < cnt; c++) {
        if (present && !present(r, c)) continue;
        const uc = odd ? (c - g.nc * 0.5) * g.w : (c - (g.nc - 1) * 0.5) * g.w;
        if (Math.abs(uc) - half > a0 + Math.abs(slope) * g.Rs) continue;
        const tc = C.checker ? ((r + c) & 1 ? C.A : C.B) : scl(mixc(C.A, C.B, 0.1 + 0.45 * rng.next()), 0.97 + 0.05 * rng.next());
        if (grout) {
          const m = cellPoly(sc, uc, g.Rs, half, 1.0, a0, slope);
          if (m) emit(m, -G, r, ux, uy, uz, C.grout);
        }
        const m2 = cellPoly(sc, uc, g.Rs, half, TILE_K, a0, slope);
        if (m2) emit(m2, 0, r, ux, uy, uz, tc);
        if (walls) this._walls(mb, g, r, c, sc, uc, half, C, hFn, tx, ty, tz, rx, rz);
      }
    }
  },

  _walls(mb, g, r, c, sc, uc, half, C, hFn, tx, ty, tz, rx, rz) {
    const nc1 = g.nc + 1, odd = r & 1, G = T.GROUT, D = 0.9;
    for (let k = 0; k < 6; k++) {
      let dr = 0, nbc = c;
      if (k === 1) nbc = c + 1; else if (k === 4) nbc = c - 1;
      else {
        dr = k === 0 || k === 5 ? 1 : -1;
        const du = k === 0 || k === 2 ? 1 : -1;
        nbc = odd ? (du > 0 ? c : c - 1) : (du > 0 ? c + 1 : c);
      }
      const nr = r + dr;
      if (nr < 0 || nr >= g.n) continue;
      const cmax = nr & 1 ? g.nc : g.nc - 1;
      if (nbc < 0 || nbc > cmax) continue;
      if (g.holes[nr * nc1 + nbc] === 0) continue;
      const A = HEX[k], B = HEX[(k + 1) % 6];
      const sa = sc + A[0] * g.Rs, ua = uc + A[1] * half, sb = sc + B[0] * g.Rs, ub = uc + B[1] * half;
      if (Math.abs(ua) > g.ext + 1e-6 || Math.abs(ub) > g.ext + 1e-6) continue;
      const hA = hFn ? hFn(sa, ua, r) : 0, hB = hFn ? hFn(sb, ub, r) : 0;
      const ds = 0.5 * (sa + sb) - sc, du2 = 0.5 * (ua + ub) - uc;
      this._P(sa, ua, hA - G, VP[0]); this._P(sb, ub, hB - G, VP[1]);
      this._P(sb, ub, hB - G - D, VP[2]); this._P(sa, ua, hA - G - D, VP[3]);
      mb.quad(VP[0], VP[1], VP[2], VP[3], tx * ds + rx * du2, ty * ds, tz * ds + rz * du2, scl(C.B, 0.85), scl(C.under, 0.7));
    }
  },

  /** Alternating glow/dark blocks across the full width between s=a..b (hazard lip) or one solid bar. */
  /** Dark abyss under a jump gap (far cliff face + floor) so the hole reads as a hole, not a flat band of sky colour. */
  _abyss(mb, a, b, hw, C) {
    const f = this._f, D = -12, W = hw + 1.5, col = scl(C.under, 0.35);
    this._fr(0.5 * (a + b));
    const ux = f[5], uy = f[6], uz = f[7];
    this._P(a, -W, D, VP[0]); this._P(a, W, D, VP[1]); this._P(b, W, D, VP[2]); this._P(b, -W, D, VP[3]);
    mb.quad(VP[0], VP[1], VP[2], VP[3], ux, uy, uz, col);
    this._P(b, -W, -0.05, VP[0]); this._P(b, W, -0.05, VP[1]); this._P(b, W, D, VP[2]); this._P(b, -W, D, VP[3]);
    mb.quad(VP[0], VP[1], VP[2], VP[3], -f[8], -f[9], -f[10], col);
  },

  _bandU(mb, a, b, hw, C, solid) {
    const nb = solid ? 1 : Math.max(2, Math.round((2 * hw) / 0.6)), bw = (2 * hw) / nb, f = this._f;
    this._fr(0.5 * (a + b));
    const ux = f[5], uy = f[6], uz = f[7];
    for (let i = 0; i < nb; i++) {
      const u0 = -hw + i * bw, u1 = u0 + bw;
      this._P(a, u0, 0.02, VP[0]); this._P(a, u1, 0.02, VP[1]); this._P(b, u1, 0.02, VP[2]); this._P(b, u0, 0.02, VP[3]);
      mb.quad(VP[0], VP[1], VP[2], VP[3], ux, uy, uz, solid || (i & 1 ? C.dark : C.glow));
    }
  },

  /** Kicker ramp top: 1 m stripes alternating glow / light, following the wedge slope. */
  _rampTop(mb, p, C) {
    const f = this._f, light = scl(C.A, 0.95);
    for (let s = p.rampS0; s < p.rampS1; s++) {
      const hA = p.rampSlope * (s - p.rampS0) + 0.015, hB = p.rampSlope * (s + 1 - p.rampS0) + 0.015;
      this._fr(s + 0.5);
      const ux = f[5], uy = f[6], uz = f[7];
      this._P(s, -p.hw, hA, VP[0]); this._P(s, p.hw, hA, VP[1]); this._P(s + 1, p.hw, hB, VP[2]); this._P(s + 1, -p.hw, hB, VP[3]);
      mb.quad(VP[0], VP[1], VP[2], VP[3], ux - p.rampSlope * f[8], uy - p.rampSlope * f[9], uz - p.rampSlope * f[10], (s & 1) ? light : C.glow);
    }
  },

  _frustum(mb, cx, cz, yT, yB, rT, rB, cT, cB, seg) {
    for (let i = 0; i < seg; i++) {
      const a0 = (TAU * i) / seg, a1 = (TAU * (i + 1)) / seg, am = 0.5 * (a0 + a1);
      const t0 = VP[0], t1 = VP[1], b1 = VP[2], b0 = VP[3];
      t0[0] = cx + Math.cos(a0) * rT; t0[1] = yT; t0[2] = cz + Math.sin(a0) * rT;
      t1[0] = cx + Math.cos(a1) * rT; t1[1] = yT; t1[2] = cz + Math.sin(a1) * rT;
      b1[0] = cx + Math.cos(a1) * rB; b1[1] = yB; b1[2] = cz + Math.sin(a1) * rB;
      b0[0] = cx + Math.cos(a0) * rB; b0[1] = yB; b0[2] = cz + Math.sin(a0) * rB;
      mb.quad(t0, t1, b1, b0, Math.cos(am), 0, Math.sin(am), cT, cB);
    }
  },

  _pillar(mb, s, C, rMax) {
    this._fr(s);
    const f = this._f, cx = f[0], cz = f[2], yT = f[1] + T.BOT;
    const cap = scl(C.under, 1.15), mid = C.under, low = scl(C.under, 0.55);
    this._frustum(mb, cx, cz, yT, yT - 1.5, rMax, 1.0, cap, mid, 8);
    this._frustum(mb, cx, cz, yT - 1.5, yT - T.PILLAR_DROP, 1.0, 0.55, mid, low, 8);
  },

  _buildMesh(p) {
    const mb = new MB(), C = this._cols(p);
    const rng = makeRng((this.seed * 7919 + p.id * 104729) >>> 0);
    const hwf = (a, b) => (s) => pieceHW(p, clamp(s, a + 1e-6, b - 1e-6));
    const zero = () => 0;
    let pillarsOk = T.PILLARS && !!PILLARED[p.kind];
    switch (p.kind) {
      case 'gapRamp': case 'skiJump': case 'chasm': {
        const hfA = hwf(p.s0, p.gapS0), hfB = hwf(p.gapS1, p.s1);
        const hTopA = (s) => (s < p.rampS0 ? 0 : p.rampSlope * (s - p.rampS0));
        this._slab(mb, { a: p.s0, b: p.gapS0, hwf: hfA, hTop: hTopA, curb: p.curb, C, rng, capB: true, top: 'snow' });
        this._rampTop(mb, p, C);
        this._slab(mb, { a: p.gapS1, b: p.s1, hwf: hfB, hTop: zero, curb: p.curb, C, rng, capA: true, top: 'snow' });
        this._bandU(mb, p.gapS1, p.gapS1 + 1.2, p.hw, C);
        this._abyss(mb, p.gapS0, p.gapS1, p.hw, C);
        break;
      }
      case 'gapJump': {
        const hfA = hwf(p.s0, p.gapS0), hfB = hwf(p.gapS1, p.s1);
        this._slab(mb, { a: p.s0, b: p.gapS0, hwf: hfA, hTop: zero, curb: p.curb, C, rng, capB: true, top: 'snow' });
        this._bandU(mb, p.gapS0 - 1.2, p.gapS0, p.hw, C);
        this._slab(mb, { a: p.gapS1, b: p.s1, hwf: hfB, hTop: zero, curb: p.curb, C, rng, capA: true, top: 'snow' });
        this._bandU(mb, p.gapS1, p.gapS1 + 1.2, p.hw, C);
        this._abyss(mb, p.gapS0, p.gapS1, p.hw, C);
        break;
      }
      case 'split': case 'hexHoles': {
        const g = p.grid, hf = hwf(p.s0, p.s1);
        this._slab(mb, { a: p.s0, b: p.s1, hwf: hf, hTop: zero, curb: p.curb, C, rng, top: null, underside: false });
        this._hexGrid(mb, { g, hwf: () => g.ext, C, rng, grout: true, walls: true, present: (r, c) => g.holes[r * (g.nc + 1) + c] === 0 });
        { const hs = p.kind === 'split' ? p.holeS0 : p.laneSegs[0].s0;   // warning chevrons across the road ahead of the first hole
          for (let k = 1; k <= 3; k++) this._bandU(mb, hs - 4 * k - 0.8, hs - 4 * k, p.hw, C); }
        break;
      }
      case 'stairs': {
        const g = p.grid, st = p.stairs, hf = hwf(p.s0, p.s1), nT = 3 * st.n;
        const hTop = (s) => {
          if (s < st.a[0] || s >= st.a[st.a.length - 1]) return 0;
          let k = 0; while (k < st.a.length - 2 && s >= st.a[k + 1]) k++;
          return st.y[k] - this._planeY(s);
        };
        const hFn = (sv, uv, r) => (r < st.r0 || r >= st.r0 + nT ? 0 : st.y[((r - st.r0) / 3) | 0] - this._planeY(sv));
        this._slab(mb, { a: p.s0, b: p.s1, hwf: hf, hTop, bps: st.a, curb: p.curb, C, rng, top: null });
        this._hexGrid(mb, { g, hwf: () => g.ext, C, rng, grout: true, hFn });
        pillarsOk = false;
        break;
      }
      default: {
        const custom = this['_build_' + p.kind];
        if (custom) { pillarsOk = false; custom.call(this, p, mb, C, rng, hwf); break; }
        const hf = hwf(p.s0, p.s1);
        this._slab(mb, { a: p.s0, b: p.s1, hwf: hf, hTop: zero, curb: p.curb, C, rng, top: 'snow' });
        if (p.kind === 'portal') for (let k = 0; k < 6; k++) { const a = p.s0 + 4 + k * 4.4; this._bandU(mb, a, a + 0.8, p.hw, C, C.glow); }
      }
    }
    if (pillarsOk) {
      const rMax = Math.min(1.6, p.hw * 0.62 + 0.2);
      for (let k = Math.ceil((p.s0 + 6 - 30) / T.PILLAR_EVERY); ; k++) {
        const sp = 30 + T.PILLAR_EVERY * k;
        if (sp > p.s1 - 6) break;
        this._pillar(mb, sp, C, rMax);
      }
    }
    const mesh = new THREE.Mesh(mb.geometry(), this.mat);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = 'track-' + p.id + '-' + p.kind;
    p.tris = mb.n;
    return mesh;
  },
});

// ---------------------------------------------------------------------------
// Phase 2 set pieces (TRACK_FEATURES.md). Each kind: _spec_<kind>(p, s0, diff, yaw0) fills the piece
// (len, hw, yawFn / pitchFn / rollAt hooks, surface hooks, events info); _build_<kind>(p, mb, C, rng)
// builds a custom mesh when the default snow slab is not enough.
// ---------------------------------------------------------------------------
const trapInt = (t, a) => {          // integral of a trapezoid (0 -> 1 over a, 1, 1 -> 0 over a), normalised to 1 at t = 1
  t = clamp(t, 0, 1);
  if (t < a) return (t * t) / (2 * a * (1 - a));
  if (t <= 1 - a) return (a / 2 + (t - a)) / (1 - a);
  return ((1 - a) - ((1 - t) * (1 - t)) / (2 * a)) / (1 - a);
};
const trapW = (t, a) => (t < a ? smooth(t / a) : t > 1 - a ? smooth((1 - t) / a) : 1);

Object.assign(Track.prototype, {
  _specX(kind, p, s0, diff, yaw0) {
    const fn = this['_spec_' + kind];
    if (!fn) return false;
    fn.call(this, p, s0, diff, yaw0);
    return true;
  },

  /** End pitch for a set piece: flat when the next piece needs it, else a typical descent. */
  _endPitch(p, dflt) {
    const nk = this._q[0];
    if (nk && NEEDS_FLAT[nk]) return flatOf(nk);
    return dflt !== undefined ? dflt : -this.rng.range(7, 12) * DEG;
  },

  /** pitch0 -> P (first f of the piece) ... P ... -> pitch1 (last f) */
  _plateau(p, P, f = 0.1) {
    p.pitchFn = (t) => (t < f ? p.pitch0 + (P - p.pitch0) * smooth(t / f) : t > 1 - f ? P + (p.pitch1 - P) * smooth((t - (1 - f)) / f) : P);
  },

  // ----- 1. helix "Buzul Girdabi": 1.0-1.2 turn banked downhill spiral -----
  // (the heading after the spiral must stay within +-64 deg of -Z, so the turn count is 1 + net/360 <= ~1.17)
  _spec_helix(p, s0, diff, yaw0) {
    const rng = this.rng, R = rng.range(22, 30), a = 0.12;
    const d = this._turn(yaw0, rng.range(10, 58) * DEG);
    const dir = d >= 0 ? 1 : -1;
    p.dYaw = dir * TAU + d;
    p.yawWrap = dir * TAU;
    p.len = Math.round((Math.abs(p.dYaw) * R) / (1 - a));
    p.hw = hwFor(p.n);
    p.curb = rng.chance(0.85);
    p.edge = p.curb ? 'wall' : 'cliff';
    p.pitch1 = this._endPitch(p);
    this._plateau(p, -rng.range(7, 9) * DEG, 0.1);
    p.yawFn = (t) => p.yaw0 + p.dYaw * trapInt(t, a);
    const B = rng.range(35, 48) * DEG;
    p.rollAt = (t) => dir * B * trapW(t, a);
    p.helix = { R: (p.len * (1 - a)) / Math.abs(p.dYaw), dir, turns: Math.abs(p.dYaw) / TAU, bank: B, ramp: a };
  },
});

// ---------------------------------------------------------------------------
// Phase 2, part B: waves, skiJump, chasm, zipline, iceBridge, halfpipe, tube, loop, corkscrew
// ---------------------------------------------------------------------------
const G_REAL = 9.8;

Object.assign(Track.prototype, {
  // ----- 4. waves "Dalga Dalga": Tiny-Wings hills (sine pitch). valleyAt(s) > 0 inside a trough -----
  _spec_waves(p, s0, diff) {
    const rng = this.rng;
    p.len = rng.int(90, 130);
    p.curb = rng.chance(0.85); p.edge = p.curb ? 'wall' : 'cliff';
    const k = Math.max(2, Math.round(p.len / 48)), A = rng.range(6.5, 9) * DEG, base = -rng.range(8.5, 10.5) * DEG, f = 0.07;
    p.pitch1 = this._endPitch(p, base);
    p.pitchFn = (t) => {
      const w = base + A * Math.sin(TAU * k * t);
      if (t < f) return p.pitch0 + (w - p.pitch0) * smooth(t / f);
      if (t > 1 - f) return w + (p.pitch1 - w) * smooth((t - (1 - f)) / f);
      return w;
    };
    p.wave = { k, A, base };
    // trough = pitch increasing (concave-up part of the hill); strength 0..1
    p.valleyAt = (s) => {
      const t = (s - p.s0) / p.len;
      if (t < f || t > 1 - f) return 0;
      const c = Math.cos(TAU * k * t);
      return c > 0.25 ? (c - 0.25) / 0.75 : 0;
    };
  },
  valleyAt(s) { const p = this.pieceAt(s); return p && p.valleyAt ? p.valleyAt(s) : 0; },

  // ----- 3. skiJump "Zaman Rampasi" / chasm: long steep kicker over a chasm into a lower landing deck -----
  _specKicker(p, s0, diff, c) {
    const rng = this.rng;
    const lipS = s0 + c.lead + c.rampLen;
    const vs = this.speedAt(lipS), slope = c.rampH / c.rampLen;
    const vh = Math.max(T.RAMP_MIN_VH, vs * slope * T.RAMP_BOOST);
    const g = this.gravity(lipS), fl = flightDist(vs, vh, c.rampH, g);
    let gap;
    if (c.beyondSwipe) {   // too long for a plain swipe-jump, so only the ramp gets you across
      const lo = Math.ceil(1.05 * vs * ((2 * T.JUMP_VH) / g)), hi = Math.floor(0.66 * fl);
      gap = hi >= lo ? rng.int(lo, hi) : hi;
    } else gap = Math.floor(fl * rng.range(c.lo, c.hi));
    gap = Math.max(5, gap);
    Object.assign(p, { rampS0: s0 + c.lead, rampS1: lipS, rampH: c.rampH, rampSlope: slope, gapS0: lipS, gapS1: lipS + gap, gap, flight: fl, launchVh: vh });
    p.len = c.lead + c.rampLen + gap + c.land;
    p.pitch1 = this._endPitch(p);
    const D = c.drop * DEG, FL = T.FLAT;
    // visual only: the plane dives inside the chasm and recovers on the (lower) landing deck
    p.pitchFn = (t, s) => {
      if (s <= p.rampS0) return p.pitch0 + (FL - p.pitch0) * smooth((s - p.s0) / (p.rampS0 - p.s0));
      if (s <= p.gapS0) return FL;
      const dEnd = p.gapS0 + 0.55 * gap, rE = p.gapS1 + 8;     // dive over most of the gap, recover over the landing deck
      if (s < dEnd) return FL + (-D - FL) * smooth((s - p.gapS0) / (dEnd - p.gapS0));
      if (s < rE) return -D + (p.pitch1 + D) * smooth((s - dEnd) / (rE - dEnd));
      return p.pitch1;
    };
  },
  _spec_skiJump(p, s0, diff) {
    this._specKicker(p, s0, diff, { lead: 14, rampLen: 16, rampH: 6, land: 14, lo: 0.45, hi: 0.6, drop: this.rng.range(20, 26) });
    p.slowmo = { s0: p.gapS0, s1: p.gapS1, scale: 0.4 };
  },
  _spec_chasm(p, s0, diff) {
    this._specKicker(p, s0, diff, { lead: 8, rampLen: 14, rampH: 8, land: 12, beyondSwipe: true, drop: this.rng.range(12, 16) });
  },

  // ----- 7b. zipline: a long gap crossed only by a rope; the runner lane-locks and hangs the ball -----
  _spec_zipline(p, s0, diff) {
    const rng = this.rng, lead = 12, land = 12, vs = this.speedAt(s0 + lead);
    const gap = Math.round(clamp(vs * rng.range(2.4, 3.0), 30, 70));
    Object.assign(p, { gapS0: s0 + lead, gapS1: s0 + lead + gap, gap, needsZip: true });
    p.len = lead + gap + land;
    p.pitch1 = this._endPitch(p);
    this._plateau(p, -rng.range(8, 10) * DEG, 0.1);
    p.zip = { s0: p.gapS0 - 6, s1: p.gapS1 + 2, u: 0, h: 3.4 };
  },

  // ----- 5b. iceBridge: collapsing ice tiles (3 lanes x rows). State lives in p.ice (shared with obstacles.js) -----
  _spec_iceBridge(p, s0, diff) {
    const rng = this.rng, lead = 8, tail = 8, rowLen = 2.4, n = rng.int(10, 16);
    p.hw = 3.6; p.curb = false; p.edge = 'cliff';
    p.len = lead + Math.ceil(n * rowLen) + tail;
    p.pitch1 = this._endPitch(p);
    this._plateau(p, -rng.range(7, 10) * DEG, 0.15);
    const ice = (p.ice = { s0b: s0 + lead, rowLen, n, state: new Uint8Array(n * 3), t0: new Float32Array(n * 3), s1b: s0 + lead + n * rowLen, lastRow: -9 });
    p.surf = (s, u) => {
      const au = u < 0 ? -u : u;
      if (au > p.hw) return -Infinity;
      if (s < ice.s0b || s >= ice.s1b) return 0;
      const row = ((s - ice.s0b) / rowLen) | 0, col = u < -1.2 ? 0 : u > 1.2 ? 2 : 1;
      return ice.state[row * 3 + col] === 2 ? -Infinity : 0;
    };
  },

  // ----- 6. halfpipe "Buz Kuveti" and tube "Buz Tuneli": cross-section profile (surfaceAt returns the curved height) -----
  _spec_halfpipe(p, s0, diff) {
    const rng = this.rng;
    p.len = rng.int(50, 70);
    p.curb = true; p.edge = 'wall';
    p.pitch1 = this._endPitch(p);
    this._plateau(p, -rng.range(8, 11) * DEG, 0.15);
    const FLOOR = hwFor(p.n), XM = 4.33, RW = 5;
    const kAt = (s) => Math.max(0.001, Math.min(smooth((s - p.s0) / 10), smooth((p.s1 - s) / 10)));
    p.pipeK = kAt;
    p.hw = FLOOR + XM;
    p.hwAt = (s) => FLOOR + XM * kAt(s);
    p.edgeHAt = (s) => 2.5 * kAt(s) + T.CURB_H;
    p.surf = (s, u) => {
      const au = u < 0 ? -u : u, k = kAt(s);
      if (au > FLOOR + XM * k) return -Infinity;
      if (au <= FLOOR) return 0;
      const x = (au - FLOOR) / k;
      return k * (RW - Math.sqrt(RW * RW - x * x));
    };
    p.pipe = { floor: FLOOR, xm: XM, rw: RW };
  },
  _spec_tube(p, s0, diff) {
    const rng = this.rng, RT = 5.6, CC = 4.0, U0 = Math.sqrt(RT * RT - CC * CC), HWT = 4.9;
    p.len = rng.int(50, 70);
    p.curb = true; p.edge = 'wall';
    p.pitch1 = this._endPitch(p);
    this._plateau(p, -rng.range(8, 11) * DEG, 0.15);
    p.hw = HWT; p.halfWidth = HWT;
    p.edgeH = CC - Math.sqrt(RT * RT - HWT * HWT) + T.CURB_H;
    p.surf = (s, u) => {
      const au = u < 0 ? -u : u;
      if (au > HWT) return -Infinity;
      return au <= U0 ? 0 : CC - Math.sqrt(RT * RT - au * au);
    };
    p.tube = { R: RT, c: CC, u0: U0 };
  },

  // ----- 8. loop "Takla Cemberi" (vertical circle, shifted sideways one road width) and corkscrew -----
  _spec_loop(p, s0, diff, yaw0) {
    const rng = this.rng, vp = this.speedAt(s0 + 30);
    const Gr = G_REAL * this.gravity(s0 + 30) / T.G, R = clamp((0.8 * vp * vp) / (5 * Gr), 5.5, 11);
    const entry = 10, exit = 12, L = Math.round(TAU * R);
    p.len = entry + L + exit; p.hw = hwFor(p.n); p.curb = true; p.edge = 'wall'; p.free3d = true;
    const ls = s0 + entry, phi0 = T.FLAT2;
    // yaw bump amplitude giving a net lateral shift of 8.6 m (> one road width): the horizontal part of the heading
    // is cos(pitch), which flips sign over the top, so integrate numerically and bisect
    const shiftOf = (Y) => { let sh = 0; for (let i = 0; i < 200; i++) { const u = (i + 0.5) / 200, sn = Math.sin(Math.PI * u); sh += Math.cos(phi0 + TAU * u) * Math.sin(Y * sn * sn) * (L / 200); } return Math.abs(sh); };
    let lo = 0.02, hi = 1.4;
    for (let i = 0; i < 24; i++) { const mid = 0.5 * (lo + hi); if (shiftOf(mid) < 8.6) lo = mid; else hi = mid; }
    const Y = rng.sign() * hi;
    p.pitch1 = this._endPitch(p);
    p.pitchFn = (t, s) => {
      if (s <= ls) return p.pitch0 + (phi0 - p.pitch0) * smooth((s - s0) / entry);
      if (s <= ls + L) return phi0 + (TAU * (s - ls)) / L;
      return phi0 + TAU + (p.pitch1 - phi0) * smooth((s - ls - L) / exit);   // phi0 + 2 pi == phi0 (wrapped on store)
    };
    p.yawFn = (t) => { const s = s0 + t * p.len; if (s <= ls || s >= ls + L) return p.yaw0; const u = (s - ls) / L, sn = Math.sin(Math.PI * u); return p.yaw0 + Y * sn * sn; };
    p.loop = { s0: ls, s1: ls + L, R, minSpeed: Math.sqrt(5 * Gr * R), plannedSpeed: vp, shift: 8.6 };
  },
  _spec_corkscrew(p, s0, diff) {
    const rng = this.rng, vp = this.speedAt(s0 + 20), L = Math.max(40, Math.round(1.5 * vp)), lead = 8, tail = 8, dir = rng.sign();
    p.len = lead + L + tail; p.hw = hwFor(p.n); p.curb = true; p.edge = 'wall'; p.free3d = true;
    p.pitch1 = this._endPitch(p);
    this._plateau(p, -rng.range(8, 11) * DEG, 0.12);
    const rs = lead / p.len, re = (lead + L) / p.len;
    p.rollAt = (t) => { if (t <= rs) return 0; if (t >= re) return dir * TAU; const u = (t - rs) / (re - rs); return dir * TAU * (u - Math.sin(TAU * u) / TAU); };
    p.corkscrew = { s0: s0 + lead, s1: s0 + lead + L, dir };
  },

  // ===== mesh builders =====
  /** axis-aligned (track frame) box between stations a..b, lateral u0..u1, heights h0..h1 */
  _boxS(mb, a, b, u0, u1, h0, h1, cTop, cSide) {
    const f = this._f, P = (s, u, h, k) => this._P(s, u, h, VP[k]);
    this._fr(0.5 * (a + b));
    const rx = f[3], ry = f[11], rz = f[4], ux = f[5], uy = f[6], uz = f[7], tx = f[8], ty = f[9], tz = f[10];
    cSide = cSide || cTop;
    mb.quad(P(a, u0, h1, 0), P(a, u1, h1, 1), P(b, u1, h1, 2), P(b, u0, h1, 3), ux, uy, uz, cTop);
    mb.quad(P(a, u0, h0, 0), P(a, u0, h1, 1), P(b, u0, h1, 2), P(b, u0, h0, 3), -rx, -ry, -rz, cSide);
    mb.quad(P(a, u1, h0, 0), P(a, u1, h1, 1), P(b, u1, h1, 2), P(b, u1, h0, 3), rx, ry, rz, cSide);
    mb.quad(P(b, u0, h0, 0), P(b, u0, h1, 1), P(b, u1, h1, 2), P(b, u1, h0, 3), tx, ty, tz, cSide);
    mb.quad(P(a, u0, h0, 0), P(a, u0, h1, 1), P(a, u1, h1, 2), P(a, u1, h0, 3), -tx, -ty, -tz, cSide);
  },

  _build_zipline(p, mb, C, rng, hwf) {
    const hfA = hwf(p.s0, p.gapS0), hfB = hwf(p.gapS1, p.s1), z = p.zip, rope = scl(C.A, 0.92), post = C.rail;
    this._slab(mb, { a: p.s0, b: p.gapS0, hwf: hfA, hTop: () => 0, curb: p.curb, C, rng, capB: true, top: 'snow' });
    this._bandU(mb, p.gapS0 - 1.2, p.gapS0, p.hw, C);
    this._slab(mb, { a: p.gapS1, b: p.s1, hwf: hfB, hTop: () => 0, curb: p.curb, C, rng, capA: true, top: 'snow' });
    this._bandU(mb, p.gapS1, p.gapS1 + 1.2, p.hw, C);
    // start gate (two posts + cross bar), end post pair, rope between them (follows the path plane)
    this._boxS(mb, z.s0, z.s0 + 0.5, -p.hw + 0.4, -p.hw + 0.9, 0, z.h + 0.6, post, C.under);
    this._boxS(mb, z.s0, z.s0 + 0.5, p.hw - 0.9, p.hw - 0.4, 0, z.h + 0.6, post, C.under);
    this._boxS(mb, z.s0, z.s0 + 0.5, -p.hw + 0.4, p.hw - 0.4, z.h + 0.35, z.h + 0.6, C.glow, post);
    this._boxS(mb, z.s1 - 0.5, z.s1, -p.hw + 0.4, -p.hw + 0.9, 0, z.h + 0.6, post, C.under);
    this._boxS(mb, z.s1 - 0.5, z.s1, p.hw - 0.9, p.hw - 0.4, 0, z.h + 0.6, post, C.under);
    for (let s = Math.ceil(z.s0 + 0.5); s < z.s1 - 0.5; s += 2) this._boxS(mb, s, Math.min(s + 2, z.s1 - 0.5), -0.07, 0.07, z.h - 0.07, z.h + 0.07, rope);
  },

  _build_iceBridge(p, mb, C, rng, hwf) {
    const ice = p.ice, hf = hwf(p.s0, p.s1);
    this._slab(mb, { a: p.s0, b: ice.s0b, hwf: hf, hTop: () => 0, curb: false, C, rng, capB: true, top: 'snow' });
    this._slab(mb, { a: ice.s1b, b: p.s1, hwf: hf, hTop: () => 0, curb: false, C, rng, capA: true, top: 'snow' });
    // thin side rails with posts (the tiles themselves are instanced by obstacles.js)
    for (const sg of [-1, 1]) {
      const u = sg * (p.hw - 0.06);
      this._boxS(mb, ice.s0b, ice.s1b, u - 0.06, u + 0.06, 0.55, 0.7, C.glow, C.edge);
      for (let s = ice.s0b; s <= ice.s1b + 0.01; s += ice.rowLen * 2) this._boxS(mb, s - 0.08, s + 0.08, u - 0.08, u + 0.08, 0, 0.7, C.rail);
    }
  },

  _build_halfpipe(p, mb, C, rng, hwf) {
    const { floor, xm, rw } = p.pipe, kAt = p.pipeK, f = this._f, nW = 8;
    const col = (i, h) => mixc(mixc(C.A, C.edge, 0.2 + 0.5 * clamp(h / 2.5, 0, 1)), C.B, (i & 1) * 0.15);
    const lane = [mixc(C.A, C.edge, 0.2), mixc(C.B, C.edge, 0.4), mixc(C.A, C.edge, 0.2)];
    const prof = (k, j, out) => {            // j = 0 .. 2*nW+3 : left rim .. right rim
      const nP = 2 * nW + 4;
      if (j <= nW) { const x = xm * (nW - j) / nW; out[0] = -(floor + k * x); out[1] = k * (rw - Math.sqrt(rw * rw - x * x)); }
      else if (j === nW + 1) { out[0] = -1.2; out[1] = 0; }
      else if (j === nW + 2) { out[0] = 1.2; out[1] = 0; }
      else { const x = xm * (j - nW - 3) / nW; out[0] = floor + k * x; out[1] = k * (rw - Math.sqrt(rw * rw - x * x)); }
      return nP;
    };
    const a = [0, 0], b = [0, 0], c = [0, 0], d = [0, 0], nP = 2 * nW + 4;
    for (let s = p.s0; s < p.s1; s++) {
      const ka = kAt(s), kb = kAt(s + 1);
      this._fr(s + 0.5);
      const ux = f[5], uy = f[6], uz = f[7], rx = f[3], rz = f[4];
      for (let j = 0; j < nP - 1; j++) {
        prof(ka, j, a); prof(ka, j + 1, b); prof(kb, j + 1, c); prof(kb, j, d);
        const floorSeg = j >= nW && j <= nW + 2;
        const cc = floorSeg ? lane[j - nW] : col(j, 0.5 * (a[1] + b[1]));
        this._P(s, a[0], a[1], VP[0]); this._P(s, b[0], b[1], VP[1]); this._P(s + 1, c[0], c[1], VP[2]); this._P(s + 1, d[0], d[1], VP[3]);
        mb.quad(VP[0], VP[1], VP[2], VP[3], ux, uy, uz, cc);
      }
      // underside: slopes from the rims to a flat bottom
      const wa = floor + xm * ka, wb = floor + xm * kb, ha = 2.5 * ka, hb = 2.5 * kb, P = (ss, u, h, i) => this._P(ss, u, h, VP[i]);
      for (const sg of [-1, 1]) {
        mb.quad(P(s, sg * wa, ha, 0), P(s, sg * wa * 0.55, T.BOT, 1), P(s + 1, sg * wb * 0.55, T.BOT, 2), P(s + 1, sg * wb, hb, 3), sg * rx - 0.7 * ux, -0.7 * uy, sg * rz - 0.7 * uz, C.rail);
      }
      mb.quad(P(s, -wa * 0.55, T.BOT, 0), P(s, wa * 0.55, T.BOT, 1), P(s + 1, wb * 0.55, T.BOT, 2), P(s + 1, -wb * 0.55, T.BOT, 3), -ux, -uy, -uz, scl(C.under, 0.7));
    }
  },

  _build_tube(p, mb, C, rng, hwf) {
    const { R, c, u0 } = p.tube, f = this._f, N = 28;
    const th0 = Math.acos(c / R), th1 = TAU - th0;
    const at = (i, out) => { const th = th0 + ((th1 - th0) * i) / N; out[0] = R * Math.sin(th); out[1] = c - R * Math.cos(th); };
    const ring = scl(C.glow, 1.0), a = [0, 0], b = [0, 0];
    for (let s = p.s0; s < p.s1; s++) {
      this._fr(s + 0.5);
      const ux = f[5], uy = f[6], uz = f[7], rx = f[3], ry = f[11], rz = f[4], isRing = (s - p.s0) % 6 === 0 || s === p.s1 - 1;
      for (let i = 0; i < N; i++) {
        at(i, a); at(i + 1, b);
        this._P(s, a[0], a[1], VP[0]); this._P(s, b[0], b[1], VP[1]); this._P(s + 1, b[0], b[1], VP[2]); this._P(s + 1, a[0], a[1], VP[3]);
        const hm = 0.5 * (a[1] + b[1]);
        const cc = isRing ? ring : mixc(mixc(C.A, C.edge, 0.3), C.under, smooth(hm / 9.5) * 0.85 + ((i + s) & 1) * 0.04);
        const hu = -0.5 * (a[0] + b[0]), hh = c - hm;      // inside faces: normal points towards the tube axis
        mb.quad(VP[0], VP[1], VP[2], VP[3], rx * hu + ux * hh, ry * hu + uy * hh, rz * hu + uz * hh, cc);
      }
      // floor: 3 lane bands + lane lines
      const P = (ss, u, h, i) => this._P(ss, u, h, VP[i]), lanes = [[-u0, -1.2, 0], [-1.2, 1.2, 1], [1.2, u0, 2]];
      for (const [x0, x1, li] of lanes) mb.quad(P(s, x0, 0, 0), P(s, x1, 0, 1), P(s + 1, x1, 0, 2), P(s + 1, x0, 0, 3), ux, uy, uz, li === 1 ? mixc(C.B, C.edge, 0.35) : mixc(C.A, C.edge, 0.15));
      for (const sg of [-1, 1]) mb.quad(P(s, sg * 1.2 - 0.05, 0.012, 0), P(s, sg * 1.2 + 0.05, 0.012, 1), P(s + 1, sg * 1.2 + 0.05, 0.012, 2), P(s + 1, sg * 1.2 - 0.05, 0.012, 3), ux, uy, uz, scl(C.B, 0.8));
      // slab under the floor
      for (const sg of [-1, 1]) mb.quad(P(s, sg * u0, 0, 0), P(s, sg * u0 * 0.6, T.BOT, 1), P(s + 1, sg * u0 * 0.6, T.BOT, 2), P(s + 1, sg * u0, 0, 3), sg * f[3] - 0.7 * ux, -0.7 * uy, sg * f[4] - 0.7 * uz, C.under);
      mb.quad(P(s, -u0 * 0.6, T.BOT, 0), P(s, u0 * 0.6, T.BOT, 1), P(s + 1, u0 * 0.6, T.BOT, 2), P(s + 1, -u0 * 0.6, T.BOT, 3), -ux, -uy, -uz, scl(C.under, 0.7));
    }
  },
});

// ---------------------------------------------------------------------------
// Temple Run JUNCTIONS: a long straight approach (>= 3.5 s at the design speed), then ONE sharp single-direction corner
// (55-64 deg over 8-9 m, min radius ~7 m, inside the YAW_MAX clamp so the biome terrain never folds), then a short exit.
// piece.junction = { id, s0 (start of the turn window), s (corner = start of the turn arc), dir (-1 left / +1 right), sEnd, Lc, R, win }.
// Telegraph (mesh): big yellow chevrons painted on the snow pointing into the turn (from ~2.7 s before the corner), a red / white striped
// barrier wall along the OUTSIDE of the corner (that is where a ball that does not turn leaves the road). The generator keeps the last
// 1.2 s before the corner and 1.0 s after it free of obstacle rows (obstacles.js _spawn_junction).
// ---------------------------------------------------------------------------
const J_BARRIER_RED = 0xd9482f, J_BARRIER_WHITE = 0xf4f1ea, J_CHEV = 0xffd24a, J_UNDER = 0x1d2433;

Object.assign(Track.prototype, {
  /** Lengths of a junction piece starting at s0 (deterministic: used by _juncDue before the piece exists and by the spec). */
  _juncDims(s0) {
    const vD = this.vGen(s0 + 80);
    return { vD, La: clamp(Math.round(3.7 * vD), 64, 215), Le: clamp(Math.round(1.6 * vD) + 16, 44, 110) };
  },

  /** Gap (s) between two corners: ~30 s at 350 m shrinking to ~15 s from 3 km on, +-17% jitter. */
  _juncGap(sC) {
    const k = smooth((sC - 350) / 2650), sec = (36 - 17 * k) * this.rng.range(0.85, 1.17);
    return sec * this.speedAt(sC);
  },

  /** Is a junction piece due to start at s0? (schedule, campaign / zone gates, biome, blocked ranges, fits inside the biome) */
  _juncDue(s0) {
    if (s0 < 40 || !this.allows('junction') || this._bossStarted || this._finished) return false;
    const zk = this.zoneAt(s0);
    if (zk === 'narrow') return false;
    const d = this._juncDims(s0), len = d.La + 9 + d.Le, sC = s0 + d.La;
    if (sC < this._nextCorner) return false;
    const L = this.level;
    if (L && s0 + len > L.length - 220) return false;
    // the whole piece has to live in one biome that allows junctions (a piece is cut at a portal, so wait for the next biome)
    const b = this.biomeIndexAt(s0);
    if (this.biomeIndexAt(s0 + len) !== b || !this.junctionOk(s0 + 10) || !this.junctionOk(sC) || !this.junctionOk(s0 + len)) return false;
    for (const r of this.juncBlock) if (s0 < r[1] && s0 + len > r[0]) return false;
    return true;
  },

  _spec_junction(p, s0, diff, yaw0) {
    const rng = this.rng, { La, Le } = this._juncDims(s0);
    const room = (d) => T.YAW_MAX - d * yaw0;
    let dir = rng.sign();
    if (room(dir) < 56 * DEG) dir = -dir;                       // heading already leans into this side: turn the other way
    const mag = Math.min(rng.range(55, 64) * DEG, room(dir));
    p.dYaw = dir * mag;
    const Lc = mag > 60 * DEG ? 9 : 8, a = 0.1;
    p.len = La + Lc + Le;
    p.hw = hwFor(p.n); p.curb = true; p.edge = 'wall';
    p.pitch1 = this._endPitch(p);
    this._plateau(p, -rng.range(6, 8) * DEG, 0.12);
    p.yawFn = (t) => {
      const x = t * p.len - La;
      if (x <= 0) return p.yaw0;
      if (x >= Lc) return p.yaw0 + p.dYaw;
      return p.yaw0 + p.dYaw * trapInt(x / Lc, a);
    };
    const B = rng.range(8, 12) * DEG;
    p.rollAt = (t) => dir * B * trapW(clamp((t * p.len - (La - 3)) / (Lc + 6), 0, 1), 0.35);
    const sC = s0 + La, win = Math.max(0.9 * this.speedAt(sC), 1.1 * this.vGen(sC)) * (sC < 1000 ? 1.45 : 1);   // generous first corner
    p.junction = { id: 0, s0: sC - win, s: sC, dir, sEnd: sC + Lc, Lc, R: (Lc * (1 - a)) / mag, win, La, Le };
  },

  _commitJunction(p) {
    const J = p.junction;
    J.id = ++this._jid;
    this._juncs.push(J);
    this._lastCorner = J.s;
    this._nextCorner = J.s + this._juncGap(J.s);
  },

  /** One painted chevron (tip towards dir) with a dark underlay so it reads on white snow as well as on dark tracks. */
  _chevron(mb, s, dir, C, w, d, th) {
    const f = this._f, VPq = VP;
    this._fr(s);
    const ux = f[5], uy = f[6], uz = f[7];
    const arm = (sc, hh, col2, k) => {
      for (const sg of SG) {
        // arm from (s + sg*d, -dir*w) to the tip (s, +dir*w)
        const sa = s + sg * (d + k), ub = -dir * (w + k), st = s, ut = dir * (w + k), t2 = th * 0.5 + k;
        this._P(sa - t2, ub, hh, VPq[0]); this._P(sa + t2, ub, hh, VPq[1]); this._P(st + t2, ut, hh, VPq[2]); this._P(st - t2, ut, hh, VPq[3]);
        mb.quad(VPq[0], VPq[1], VPq[2], VPq[3], ux, uy, uz, col2);
      }
    };
    arm(1, 0.03, C.jDark, 0.1);       // (6 cm / 3 cm above the snow: no z-fighting even 150 m away)
    arm(1, 0.06, C.jYel, 0);
  },

  /**
   * Chevron alignment sign (two black chevrons on a yellow board with a dark frame) facing the approaching ball, standing on the outside barrier.
   * uc = lateral centre, half = half width, h0..h1 = height span; the chevrons point the way of the turn (dir).
   */
  _signBoard(mb, s, uc, half, h0, h1, dir, C) {
    const f = this._f, VPq = VP, cap = col(J_UNDER);
    this._fr(s);
    const tx = -f[8], ty = -f[9], tz = -f[10];                               // normal: back towards the ball
    const rect = (ss, ua, ub, ha, hb, colr) => {
      this._P(ss, ua, ha, VPq[0]); this._P(ss, ub, ha, VPq[1]); this._P(ss, ub, hb, VPq[2]); this._P(ss, ua, hb, VPq[3]);
      mb.quad(VPq[0], VPq[1], VPq[2], VPq[3], tx, ty, tz, colr);
    };
    rect(s + 0.07, uc - half - 0.14, uc + half + 0.14, h0 - 0.14, h1 + 0.14, cap);          // frame (furthest from the viewer)
    rect(s, uc - half, uc + half, h0, h1, C.jYel);                                          // board
    const hc = (h0 + h1) * 0.5, a = half * 0.3, b = (h1 - h0) * 0.36, t = 0.3, ss = s - 0.07;
    for (const k of [-1, 1]) {
      const cu = uc + k * half * 0.46, tip = cu + dir * a, end = cu - dir * a;
      for (const sg of SG) {                                                                // upper and lower arm of one chevron
        const he = hc + sg * b;
        this._P(ss, end, he + t * 0.5, VPq[0]); this._P(ss, tip, hc + t * 0.5, VPq[1]); this._P(ss, tip, hc - t * 0.5, VPq[2]); this._P(ss, end, he - t * 0.5, VPq[3]);
        mb.quad(VPq[0], VPq[1], VPq[2], VPq[3], tx, ty, tz, cap);
      }
    }
  },

  _build_junction(p, mb, C, rng, hwf) {
    const J = p.junction, dir = J.dir, hw = p.hw, f = this._f;
    C.jYel = col(J_CHEV); C.jDark = col(J_UNDER);
    this._slab(mb, { a: p.s0, b: p.s1, hwf: hwf(p.s0, p.s1), hTop: () => 0, curb: true, C, rng, top: 'snow' });
    // painted chevrons: from ~2.7 s before the corner down to 2 m before it, one every 3.7 m
    const vD = this.vGen(J.s), sFrom = Math.max(p.s0 + 5, J.s - 2.7 * vD);
    for (let s = J.s - 2; s >= sFrom; s -= 3.7) this._chevron(mb, s, dir, C, 2.7, 1.45, 0.62);
    // the corner line: a yellow / dark hazard band across the whole road (the last place a turn can still start)
    {
      const nb = Math.max(2, Math.round((2 * (hw - 0.5)) / 0.6)), bw = (2 * (hw - 0.5)) / nb;
      this._fr(J.s);
      const ux = f[5], uy = f[6], uz = f[7];
      for (let i = 0; i < nb; i++) {
        const u0 = -(hw - 0.5) + i * bw;
        this._P(J.s - 0.6, u0, 0.05, VP[0]); this._P(J.s - 0.6, u0 + bw, 0.05, VP[1]); this._P(J.s + 0.2, u0 + bw, 0.05, VP[2]); this._P(J.s + 0.2, u0, 0.05, VP[3]);
        mb.quad(VP[0], VP[1], VP[2], VP[3], ux, uy, uz, i & 1 ? C.jDark : C.jYel);
      }
    }
    // barrier along the outside of the corner: red / white blocks every 1.2 m, dark cap, a little taller than the ball; it starts 28 m early
    // (a wall along the outer edge that you see coming) and runs round the whole arc
    const ou = -dir, u0 = ou * (hw - 0.45), u1 = ou * (hw + 0.15), cap = col(J_UNDER), red = col(J_BARRIER_RED), white = col(J_BARRIER_WHITE);
    const sa = Math.max(p.s0 + 2, J.s - 28), sb = J.sEnd + 9;
    for (let s = sa, k = 0; s < sb - 1e-6; s += 1.2, k++) {
      const e = Math.min(sb, s + 1.2), cc = k & 1 ? white : red;
      this._boxS(mb, s, e, Math.min(u0, u1), Math.max(u0, u1), -0.25, 2.5, cc, cc);
      this._boxS(mb, s, e, Math.min(u0, u1) - 0.04, Math.max(u0, u1) + 0.04, 2.5, 2.68, cap, cap);
    }
    // three chevron signs on the barrier (24 m, 12 m and 0 m before the corner): "this way!"
    // The boards stand OUTSIDE the road, on a mast on the barrier with arms reaching out. They must never hang over a lane:
    // the chase camera rides 4-8 m up over the ball's side, so a board over the outer lane covered the ball and the camera
    // flew through it like a portal (scripts/check-camera-clearance.mjs guards this).
    for (const d of [24, 12, 0]) {
      const s = J.s - d;
      if (s < sa + 1) continue;
      const half = 1.5, uw = ou * (hw - 0.15), uc = ou * (hw + 0.15 + 0.14 + half), uFar = ou * (hw + 0.29 + 2 * half);
      this._boxS(mb, s - 0.12, s + 0.12, uw - 0.1, uw + 0.1, 2.6, 4.85, cap, cap);          // mast on the barrier
      for (const ha of [3.1, 4.5]) this._boxS(mb, s + 0.1, s + 0.22, Math.min(uw, uFar), Math.max(uw, uFar), ha - 0.07, ha + 0.07, cap, cap);   // arms behind the board
      this._signBoard(mb, s, uc, half, 2.95, 4.65, dir, C);
    }
  },

});

// ---------------------------------------------------------------------------
// Campaign finish: wide 60 m straight, checkered line + arch + BITIS banner + confetti flags
// ---------------------------------------------------------------------------
const FIN_FONT = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
};
const CONFETTI = [0xff4a5e, 0xffc83a, 0x3ad06a, 0x3aa0ff, 0xb45bff, 0xff8a2e, 0x2ee6d6, 0xff5bb8];

Object.assign(Track.prototype, {
  _spec_finish(p, s0) {
    p.len = 60; p.hw = 6.0; p.halfWidth = 6.0; p.curb = true; p.edge = 'wall'; p.noObs = true;
    p.dYaw = 0;
    p.pitch1 = Math.max(p.pitch0, T.FLAT2);
    p.finish = { s: s0, length: s0 };
  },

  _build_finish(p, mb, C, rng, hwf) {
    const hf = hwf(p.s0, p.s1), hw = p.hw, hwT = hw - T.CURB_W, s0 = p.s0;
    this._slab(mb, { a: p.s0, b: p.s1, hwf: hf, hTop: () => 0, curb: true, C, rng, top: 'snow' });
    const white = [1, 1, 1], black = [0.03, 0.03, 0.05], f = this._f;
    // checkered finish line (2 rows)
    const nb = Math.round((2 * hwT) / 0.8), bw = (2 * hwT) / nb;
    for (let row = 0; row < 2; row++) {
      const a = s0 + row * 0.8, b = a + 0.8;
      this._fr(a + 0.4);
      const ux = f[5], uy = f[6], uz = f[7];
      for (let i = 0; i < nb; i++) {
        const u0 = -hwT + i * bw, u1 = u0 + bw;
        this._P(a, u0, 0.025, VP[0]); this._P(a, u1, 0.025, VP[1]); this._P(b, u1, 0.025, VP[2]); this._P(b, u0, 0.025, VP[3]);
        mb.quad(VP[0], VP[1], VP[2], VP[3], ux, uy, uz, (i + row) & 1 ? white : black);
      }
    }
    // arch: two posts + checkered beam + banner
    const sa = s0 + 1.0, sb = s0 + 2.2, up = hw - 0.9;
    this._boxS(mb, sa, sb, -up - 0.35, -up + 0.35, 0, 7.4, white, C.rail);
    this._boxS(mb, sa, sb, up - 0.35, up + 0.35, 0, 7.4, white, C.rail);
    const nbeam = Math.round((2 * up + 0.7) / 0.8), beamW = (2 * up + 0.7) / nbeam;
    for (let i = 0; i < nbeam; i++) {
      const c = i & 1 ? white : black, u0 = -up - 0.35 + i * beamW;
      this._boxS(mb, sa, sb, u0, u0 + beamW, 6.6, 7.6, c, c);
    }
    // banner panel (readable from the approach side, i.e. facing -tan) + voxel letters B I T I S
    const h0 = 4.0, h1 = 6.5, sp = s0 + 0.95, sl = s0 + 0.9, panelHW = up - 0.7;
    this._fr(sp);
    const tx = -f[8], ty = -f[9], tz = -f[10];
    const nav = [0.1, 0.2, 0.55], gold = [1, 0.82, 0.2];
    this._P(sp, -panelHW, h0, VP[0]); this._P(sp, panelHW, h0, VP[1]); this._P(sp, panelHW, h1, VP[2]); this._P(sp, -panelHW, h1, VP[3]);
    mb.quad(VP[0], VP[1], VP[2], VP[3], tx, ty, tz, nav);
    const word = ['B', 'I', 'T', 'I', 'S'], vx = 0.27, gapL = 0.42, lw = 5 * vx, total = word.length * lw + (word.length - 1) * gapL;
    let u = -total / 2;
    const hTop = h1 - 0.2 - vx;           // top voxel row centre ~ below the panel top; rows 0..6, dot row at -1, cedilla row at 7
    for (let li = 0; li < word.length; li++) {
      const rows = FIN_FONT[word[li]], extraTop = li === 1 || li === 3 ? '00100' : null, extraBot = li === 4 ? '00100' : null;
      const all = []; if (extraTop) all.push([extraTop, -1.6]); rows.forEach((r, i) => all.push([r, i])); if (extraBot) all.push([extraBot, 7.6]);
      for (const [r, ri] of all) for (let c = 0; c < 5; c++) {
        if (r[c] !== '1') continue;
        const uu = u + c * vx, hh = h1 - 0.45 - (ri + 1) * vx * 0.78 + 0.2;
        this._P(sl, uu, hh, VP[0]); this._P(sl, uu + vx, hh, VP[1]); this._P(sl, uu + vx, hh + vx * 0.78, VP[2]); this._P(sl, uu, hh + vx * 0.78, VP[3]);
        mb.quad(VP[0], VP[1], VP[2], VP[3], tx, ty, tz, (li === 1 || li === 3) && ri === -1.6 ? [1, 0.3, 0.3] : gold);
      }
      u += lw + gapL;
    }
    // confetti flags along both sides + bunting under the beam
    for (let s = s0 + 7, k = 0; s < p.s1 - 5; s += 6, k++) {
      for (const sg of [-1, 1]) {
        const uu = sg * (hw - 0.55), cc = col(CONFETTI[(k * 2 + (sg > 0 ? 1 : 0)) % CONFETTI.length]);
        this._boxS(mb, s - 0.06, s + 0.06, uu - 0.06, uu + 0.06, 0, 3.4, [0.9, 0.9, 0.95], [0.6, 0.6, 0.7]);
        this._boxS(mb, s - 0.04, s + 0.04, sg > 0 ? uu - 1.0 : uu, sg > 0 ? uu : uu + 1.0, 2.7, 3.35, cc, cc);
      }
    }
    for (let i = 0, n = 18; i < n; i++) {
      const u0 = -panelHW + (i * 2 * panelHW) / n, cc = col(CONFETTI[i % CONFETTI.length]);
      this._boxS(mb, sl - 0.05, sl + 0.05, u0, u0 + (2 * panelHW) / n - 0.08, h0 - 0.55 - 0.1 * (i & 1), h0 - 0.1, cc, cc);
    }
  },
});
