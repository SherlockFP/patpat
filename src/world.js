// world.js — the endless ÇIĞ slope.
//
// Downhill distance `d` grows forward, world z = -d. The slope is generated forever in ~64 m terrain chunks and
// ~10-36 m content segments just ahead of the ball and recycled behind it. Everything is seeded (same seed = same slope).
//
// Content is RADIUS-DRIVEN: what spawns is chosen from the prop library by its size relative to the ball
// (food = clearly smaller than the ball, obstacles = clearly bigger), so every size tier automatically gets the right
// stuff: pebbles/people/snowmen -> cars/kiosks -> trucks/cabins/houses -> hotels/apartments -> towers. Props are scaled
// (never below ~0.3x or above ~6x) to fit when the library has no natural size. Tier N always also holds food of the tier below.
//
// The slope WIDENS with every size tier (width keyframes blend over ~60 m, started beyond what is on screen).
//
// Public API used by main.js / cigplus.js:
//   new World(scene, lib, { seed })
//   world.update(dt, ballD, ahead, behind, ball)      stream + animate + render
//   world.halfWidth(d), baseY(d), groundY(x, d), rampAt(x, d), inPatch(x, d), footY(p)
//   world.query(x, d, reach, out), world.kill(p), world.spawnChunk(x, d, r)
//   world.pull(p, ball, dur)  /  world.onArrive(proxy)  visible suction (the flight itself is rendered here)
//   world.setTier(tier, ballD)  widen the slope + new-tier welcome food;  world.colorOf(type)
//   world.gates / world.breakGate(g)  size gates;  world.events  (town / gate / golden cues for the HUD)
//   world.zoneFree(d0, d1, kinds), world.specialQueue (golden snowballs for cigplus), world.dispose()
import * as THREE from 'three';
import { CFG, MASS, fallbackMass, tierOf, foodRelAt, expectedRAt } from './config.js';
import { planAt, planSlope, crateRadius, RAMP_AIR_K } from './cigplan.js';
import { makeRng } from './rng.js';
import { patchMaterial } from './shaders.js';

// Movement modes for props.
export const MOVE_NONE = 0, MOVE_SKI = 1, MOVE_WANDER = 2, MOVE_CROSS = 3, MOVE_ARMY = 77, MOVE_ENEMY = 55, MOVE_PULL = 88, MOVE_CHUNK = 99;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zax = new THREE.Vector3(0, 0, 1);
const _q2 = new THREE.Quaternion();
const _c = new THREE.Color();

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

// ---- terrain chunk layout ----
const CH = 64;                 // chunk length (m)
const NR = 16;                 // rows per chunk
const ROW = CH / NR;           // 4 m
const NCI = 10;                // cells across the track
const BANK_F = [1.0, 0.88, 0.72, 0.56, 0.42, 0.3, 0.2, 0.12, 0.06, 0.02]; // bank columns as fractions of (edge - hw), outermost first
const NB = BANK_F.length;
const NC = 2 * NB + NCI + 1;   // columns per row
const EDGE = 100;              // minimum terrain half-extent (it grows with the slope width)
const edgeFor = (hw) => Math.max(EDGE, hw * 1.7 + 50);
const segLen = (gr) => clamp(5 + 3.2 * gr, 9, 320);
const MESH_CAP = 700;          // instances per prop type

// Content size mix per tier: [weight, qLo, qHi] with q = prop radius / ball radius (food is always < 0.9).
// Later tiers are made of MANY smaller things (a field of people and cars for a ball the size of a house).
const Q_MIX = [
  [[0.6, 0.25, 0.42], [0.3, 0.42, 0.65], [0.1, 0.65, 0.86]],
  [[0.62, 0.17, 0.34], [0.3, 0.34, 0.56], [0.08, 0.56, 0.86]],
  [[0.66, 0.11, 0.26], [0.28, 0.26, 0.46], [0.06, 0.46, 0.84]],
  [[0.68, 0.08, 0.22], [0.27, 0.22, 0.42], [0.05, 0.42, 0.82]],
  [[0.7, 0.06, 0.2], [0.25, 0.2, 0.4], [0.05, 0.4, 0.8]],
];
const DECOR_SCALE = [1, 1.3, 1.75, 2.3, 3];
const STRUCT = new Set(['lift_pylon', 'water_tower', 'gondola_station', 'hotel', 'clocktower', 'apartment']);

export class World {
  // opts.level = a plan from cigplan.js (ÇIĞ DAĞLAR: finite mountain, items placed from the plan); without it: the endless slope.
  constructor(scene, lib, { seed = 1, level = null } = {}) {
    this.lvl = level || null;
    this.endless = !level;
    this.scene = scene;
    this.lib = lib;
    this.seed = (seed >>> 0) || 1;
    this.rng = makeRng(this.seed);
    this.rngD = makeRng(this.seed ^ 0x5bd1e995);
    this.time = 0;
    this.ballD = 0; this.ballR = CFG.startR; this.ballX = 0;
    this.ahead = CFG.viewAhead; this.behind = CFG.viewBehind;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.snowMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { snow: true });

    this.statics = [];   // colliding props, sorted by d
    this.decor = [];     // scenery, sorted by d (never collides)
    this.movers = [];
    this.enemies = [];   // live enemy units (HP bars): also in `movers`
    this.pulls = []; this.pullPool = [];
    this.falls = [];   // DOMİNO ÇAM: toppling pines (visual only)
    this.ramps = [];
    this.patches = [];
    this.heats = []; this.nextHeatD = 170;
    this.gates = [];
    this.arches = [];
    this.events = [];
    this.zones = []; this.forks = [];
    this.specialQueue = [];
    this.secrets = [];   // cracked-ice walls (glow when you are big enough)
    this.boxItems = [];
    this.trans = [];     // width transitions {d0, d1, from, to, tier}
    this.hw0 = CFG.tierWidth[0] / 2;
    this.curTier = 0;
    this.maxPropR = 1;
    this.meshes = {}; this.meshList = [];
    this.recent = []; this.obsRecent = [];
    this.credit = 0; this.spent = 0; // food ledger: features and events spend from the same budget as ordinary stretches
    this.genD = 4; this.decorD = -70;
    this.nextFeatureD = 230; this.nextEventD = CFG.firstEvent; this.nextGateD = CFG.firstGate; this.nextEnemyD = CFG.firstEnemy; this.nextBossD = CFG.firstBoss; this.nextRivalD = CFG.firstRival; this.eventNo = 0; this.lastEventKind = '';
    this.cullT = 0;
    this.labels = [];
    this.onArrive = null;
    this.lastGen = { gr: CFG.startR, T: 0 };
    // Size tint (readability): the game sets the ball radius and its eat ratio every frame; props near the ball that are too
    // big to swallow are painted amber (almost) / red (no way) through per-instance colours. 0 = off (lobby).
    this.tintR = 0; this.tintEat = CFG.eatRatio;
    this.finalGate = null; this.bossProp = null; this.cratesLeft = 0;
    if (level) this.initLevel(level);

    this.buildCatalog();
    this.buildShared();
    this.initTerrain();
    if (this.lvl) this.levelOpening(); else this.breadcrumbs();
    for (let i = 0; i < 40 && this.genD < 150; i++) this.genSegment();
    this.stream(0, 300, 40, true);
    this.render(0);
  }

  // ===================================================================== ÇIĞ DAĞLAR (level mode)
  // The plan (cigplan.js) decides WHAT goes WHERE; this class only builds it. Nothing random is timed any more: the endless
  // generators' timers are switched off and the content comes from plan.items (sorted by start).
  initLevel(P) {
    this.endD = P.length;
    this.planEnd = P.length + 60;       // CigPlus must not plan beyond this
    this.hw0 = P.hw0;
    this.trans = P.widths.map((w) => ({ d0: w.d0, d1: w.d1, from: w.from, to: w.to, tier: w.tier, scale: w.scale }));
    this.ballR = P.r0;
    this.lastGen.gr = P.r0;
    this.items = P.items;               // read-only
    this.qi = 0;
    this.genDone = false;
    this.nextEventD = this.nextFeatureD = this.nextGateD = this.nextEnemyD = this.nextBossD = this.nextRivalD = Infinity;
    let pt = P.tierStart;
    for (const w of this.trans) if (w.tier > pt) { pt = w.tier; this.addArch(w.d1, w.to, Math.min(4, w.tier)); }
  }

  // the plan's expected radius at d (levels) / the endless pacing curve
  expectAt(d) {
    return this.lvl ? planAt(this.lvl, d) : expectedRAt(d);
  }

  // How much of the plan's growth the food on this stretch can pay for, relative to the endless budget (see CFG.lvl.feed):
  // a ball eating at full efficiency grows ~feed x faster than the plan, a ball that eats nothing stays far behind it.
  foodMulAt(d, gr) {
    if (!this.lvl) return 1;
    const L = CFG.lvl;
    const k = ((L.feed * 3 * planSlope(this.lvl, d)) / Math.max(1e-4, foodRelAt(gr))) * (this.lvl.n >= 6 ? 0.8 : 1);
    return k < L.feedMin ? L.feedMin : k > L.feedMax ? L.feedMax : k;
  }

  // ===================================================================== terrain shape
  // The slope widens with every tier: a list of smooth width transitions keyed by distance.
  halfWidth(d) {
    const T = this.trans;
    let hw = this.hw0;
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      if (d <= t.d0) break;
      if (d >= t.d1) hw = t.to;
      else { hw = lerp(t.from, t.to, smooth01((d - t.d0) / (t.d1 - t.d0))); break; }
    }
    return hw;
  }

  // Scenery / pole scale at distance d: follows the tier, and the ball radius beyond it.
  scaleAtD(d) {
    let k = 1;
    for (let i = 0; i < this.trans.length; i++) { if (d > this.trans[i].d0) k = this.trans[i].scale || DECOR_SCALE[Math.min(this.trans[i].tier, 4)]; else break; }
    return k;
  }

  // Tier whose width applies at distance d (for scaling scenery with the zone).
  tierAtD(d) {
    let t = 0;
    for (let i = 0; i < this.trans.length; i++) if (d > this.trans[i].d0) t = this.trans[i].tier; else break;
    return t;
  }

  baseY(d) {
    return -CFG.grade * d + 4 * Math.sin(d * 0.011) + 2.2 * Math.sin(d * 0.0037 + 1.3);
  }

  groundY(x, d) {
    let y = this.baseY(d);
    const hw = this.halfWidth(d);
    const ax = Math.abs(x) - hw;
    if (ax > 0) y += ax * ax * 0.014 + ax * 0.22 + ax * 0.1 * Math.sin(d * 0.05 + x * 0.13);
    y += 0.2 * Math.sin(x * 0.45 + d * 0.09) * Math.sin(d * 0.13 - x * 0.2);
    return y;
  }

  // Ramp kicker height above the ground at (x, d).
  rampAt(x, d) {
    for (let i = 0; i < this.ramps.length; i++) {
      const r = this.ramps[i];
      const u = d - r.d;
      if (u < 0 || u > r.len || Math.abs(x - r.x) > r.w / 2) continue;
      return r.h * Math.pow(u / r.len, 1.4);
    }
    return 0;
  }

  // Lowest ground under a prop's footprint, so long things sink into slopes instead of floating.
  footY(p) {
    const e = Math.min(p.r * 0.7, 6);
    return Math.min(
      this.groundY(p.x, p.d),
      this.groundY(p.x, p.d + e), this.groundY(p.x, p.d - e),
      this.groundY(p.x + e, p.d), this.groundY(p.x - e, p.d),
    );
  }

  // SICAK NOKTA: warm zone (ellipse) - melts the ball faster, holds the rich food
  inHeat(x, d) {
    for (let i = 0; i < this.heats.length; i++) {
      const p = this.heats[i];
      const a = (x - p.x) / p.rx, b = (d - p.d) / p.rd;
      if (a * a + b * b < 1) return p;
    }
    return null;
  }

  inPatch(x, d) {
    for (let i = 0; i < this.patches.length; i++) {
      const p = this.patches[i];
      const a = (x - p.x) / p.rx, b = (d - p.d) / p.rd;
      if (a * a + b * b < 1) return true;
    }
    return false;
  }

  // ===================================================================== catalog
  buildCatalog() {
    const lib = this.lib;
    const FOOD = new Set(['static', 'walker', 'skier', 'car', 'building', 'rock', 'tree']);
    const houses = [], food = [], obst = [], town = [], walkers = [], trees = [], decorAll = [];
    for (const name in lib) {
      if (name === 'chunk') continue;
      const def = lib[name];
      if (!def || !def.geometry || !(def.radius > 0.2)) continue;
      const kind = def.kind;
      if (!FOOD.has(kind)) continue;
      const e = { type: name, r: def.radius, h: def.height, kind, w: 1 };
      const isRockTree = kind === 'rock' || kind === 'tree';
      food.push({ ...e, w: isRockTree ? 0.35 : (kind === 'building' || STRUCT.has(name)) ? 2.2 : 1 });
      if (isRockTree || STRUCT.has(name) || kind === 'building') obst.push({ ...e, w: kind === 'rock' ? 1.2 : kind === 'building' ? 1.6 : 1 });
      if (kind === 'building' && !STRUCT.has(name)) houses.push(e);
      if (!isRockTree && e.r > 0.3) town.push(e);
      if (kind === 'walker' || kind === 'skier') walkers.push(e);
      if (isRockTree) decorAll.push({ ...e, w: kind === 'tree' ? 3 : 1 });
    }
    const byR = (a, b) => a.r - b.r;
    food.sort(byR); obst.sort(byR); town.sort(byR); walkers.sort(byR); decorAll.sort(byR); trees.sort(byR);
    houses.sort(byR); this.landmarks = ['snowman', 'fence', 'kiosk', 'boulder', 'bench', 'sled'].filter((n) => lib[n] && lib[n].geometry).map((n) => ({ type: n, r: lib[n].radius }));
    this.houses = houses; this.food = food; this.obst = obst; this.town = town; this.walkers = walkers; this.decorPool = decorAll;
    // late-game themed models: tier 6 city, tier 7 mountain, tier 8 planet (cumulative)
    const TH = [['skyscraper', 'stadium', 'radio_tower', 'ferris_wheel'], ['castle', 'ship', 'airplane', 'wind_turbine'], ['rocket_pad', 'rock_big', 'hotel']];
    this.themed = [];
    for (let k = 0; k < TH.length; k++) {
      const names = TH[k].concat(k ? this.themed[k - 1].names : []);
      const list = obst.filter((o) => names.includes(o.type)).map((o) => ({ ...o, w: 1 }));
      this.themed.push({ names, list });
    }
    this.snackNames = ['pebble', 'gift', 'traffic_cone', 'penguin', 'bush_small', 'rabbit'].filter((n) => lib[n]);
    if (!this.snackNames.length) this.snackNames = food.slice(0, 4).map((e) => e.type);
  }

  // Pick a library entry whose natural radius lets a scale in [sLo, sHi] reach `tr`; nearest entry when none does.
  pick(list, tr, sLo = 0.6, sHi = 1.6) {
    const n = list.length;
    if (!n) return null;
    let lo = 0, hi = n;
    const a = tr / sHi;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].r < a) lo = m + 1; else hi = m; }
    const i0 = lo;
    lo = i0; hi = n;
    const b = tr / sLo;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].r <= b) lo = m + 1; else hi = m; }
    const i1 = lo;
    if (i1 <= i0) {
      let i = clamp(i0, 0, n - 1);
      if (i > 0 && Math.abs(list[i - 1].r - tr) < Math.abs(list[i].r - tr)) i--;
      return list[i];
    }
    let tot = 0;
    for (let i = i0; i < i1; i++) tot += list[i].w;
    let roll = this.rng.next() * tot;
    for (let i = i0; i < i1; i++) { roll -= list[i].w; if (roll <= 0) return list[i]; }
    return list[i1 - 1];
  }

  rollQ(T) {
    const mix = Q_MIX[Math.min(T, Q_MIX.length - 1)];
    let roll = this.rng.next();
    for (let i = 0; i < mix.length; i++) {
      roll -= mix[i][0];
      if (roll <= 0 || i === mix.length - 1) return this.rng.range(mix[i][1], mix[i][2]);
    }
    return 0.3;
  }

  colorOf(type) {
    const def = this.lib[type];
    if (!def) return _c.setHex(0xcccccc);
    if (!def._avg) def._avg = averageColor(def.geometry);
    return def._avg;
  }

  // ===================================================================== props
  add(type, x, d, opts = {}) {
    const def = this.lib[type];
    if (!def) return null;
    const s = clamp(opts.s ?? 0.9 + this.rng.next() * 0.25, 0.2, 24);
    const p = {
      type, def, x, d,
      y: 0,
      rot: opts.rot ?? this.rng.range(0, Math.PI * 2),
      s,
      r: def.radius * s,
      h: def.height * s,
      tier: def.tier,
      kind: def.kind,
      mass: (MASS[type] ?? fallbackMass(def.radius)) * s * s * s,
      alive: true,
      decor: !!opts.decor,
      move: opts.move ?? MOVE_NONE,
      m: null,
      ox: x, od: d, vx: opts.vx ?? 0, vd: opts.vd ?? 0, phase: Math.random() * 6.28,
      tonK: opts.tonK ?? 1,
      id: 0,
    };
    p.y = this.footY(p) - 0.05;
    if (p.move === MOVE_NONE) {
      p.m = new Float32Array(16);
      _p.set(p.x, p.y, -p.d);
      _q.setFromAxisAngle(_up, p.rot);
      _s.setScalar(p.s);
      _m.compose(_p, _q, _s);
      _m.toArray(p.m);
      if (p.decor) insertSorted(this.decor, p);
      else {
        insertSorted(this.statics, p);
        if (p.r > this.maxPropR) this.maxPropR = p.r;
      }
    } else {
      this.movers.push(p);
      if (p.r > this.maxPropR) this.maxPropR = p.r;
    }
    return p;
  }

  // Place with overlap rejection against recently placed things (a few retries). Returns the prop or null.
  place(type, x, d, hw, opts = {}) {
    const def = this.lib[type];
    if (!def) return null;
    const s = clamp(opts.s ?? 1, 0.2, 24);
    const rad = def.radius * s * 0.8;
    const rec = this.recent;
    const pad = opts.pad ?? 0.4;
    for (let k = 0; k < 6; k++) {
      let ok = true;
      for (let i = rec.length - 1; i >= 0; i--) {
        const c = rec[i];
        if (Math.abs(c.d - d) > rad + c.r + 1) continue;
        if (Math.hypot(c.x - x, c.d - d) < (rad + c.r) * 0.95 + pad) { ok = false; break; }
      }
      if (ok) {
        const p = this.add(type, x, d, opts);
        if (p) { rec.push({ x, d, r: rad }); if (rec.length > 260) rec.splice(0, 100); }
        return p;
      }
      x = clamp(x + this.rng.range(-1, 1) * (rad * 2 + 1), -hw, hw);
      d += this.rng.range(-0.5, 1) * (rad + 0.6);
    }
    return null;
  }

  // Food piece at relative size q (prop radius / ball radius) near (x, d). Returns its radius^3 (volume units) or 0.
  // From ~120 m on, food keeps out of the centre line (the ball's suction reach): an idle ball starves, a steering one feeds.
  offCenter(x, d, gr, hw) {
    if (d < 120) return x;
    const gap = Math.min(hw * 0.6, (gr * 1.35 * CFG.suctionK + CFG.suctionC) * 1.15);
    if (Math.abs(x) >= gap) return x;
    const side = x === 0 ? this.rng.sign() : Math.sign(x);
    return side * (gap + Math.pow(this.rng.next(), 1.4) * Math.max(0, hw - gap - 1));
  }

  food1(q, gr, x, d, hw, opts = {}) {
    x = this.offCenter(x, d, gr, hw);
    // early mountains: chunkier food (still edible) so the slope reads as full of things, not tiny dots
    if (this.lvl && this.lvl.n <= 5 && !opts.list) q = Math.min(0.86, q * (this.lvl.n <= 2 ? 1.9 : 1.6));
    const tr = Math.max(0.12, q * gr);
    const list = opts.list || this.food;
    const e = this.pick(list, tr, opts.sLo ?? 0.62, opts.sHi ?? 1.6);
    if (!e) return 0;
    const s = clamp(tr / e.r * this.rng.range(0.94, 1.06), 0.22, 22);
    const pad = Math.min(0.5 + tr * 0.5, hw * 0.3);
    const p = this.place(e.type, clamp(x, -hw + pad, hw - pad), d, hw, { s, tonK: opts.tonK, rot: opts.rot, pad: opts.spacing });
    if (!p) return 0;
    const v = p.r ** 3;
    this.spent += v;
    return v;
  }

  // ===================================================================== generation
  genRad() { return Math.max(CFG.startR, this.ballR); }

  breadcrumbs() {
    const R = this.rng;
    const names = this.snackNames;
    // (scaled so every crumb is edible for the starting ball whatever the library's natural size is)
    const cap = (type, k) => Math.min(1, (CFG.startR * CFG.eatRatio * k) / Math.max(0.05, this.lib[type].radius));
    for (let i = 0; i < 9; i++) {
      const type = names[i % names.length];
      const x = Math.sin(i * 0.55) * 1.6;
      this.add(type, x, 6 + i * 2.8, { s: R.range(0.85, 1.05) * cap(type, 0.9) });
    }
    // a second, wider breadcrumb wave so the first seconds are one satisfying combo
    for (let i = 0; i < 12; i++) {
      const type = names[(i + 2) % names.length];
      this.add(type, Math.cos(i * 0.7) * (3 + i * 0.35), 36 + i * 3.4, { s: R.range(0.7, 1.0) * cap(type, 0.9) });
    }
  }

  // the first seconds of a mountain: a ring of crumbs sized for the plan's starting ball
  levelOpening() {
    const R = this.rng, P = this.lvl;
    const gr = P.r0, sk = clamp(gr * 0.7, 1, 3);
    for (let i = 0; i < 9; i++) {
      const d = (6 + i * 2.8) * sk, hw = this.halfWidth(d);
      this.food1(R.range(0.3, 0.55), gr, Math.sin(i * 0.55) * 1.6 * sk, d, hw, { spacing: 0.1 });
    }
    for (let i = 0; i < 12; i++) {
      const d = (36 + i * 3.4) * sk, hw = this.halfWidth(d);
      this.food1(R.range(0.3, 0.55), gr, Math.cos(i * 0.7) * (3 + i * 0.35) * sk, d, hw, { spacing: 0.1 });
    }
    // food lanes: arcs of small props leading the eye down the first 300 m (off the centre line, so an idle ball misses them)
    if (P.n <= 8) {
      for (let k = 0; k < 6; k++) {
        const sgn = k % 2 ? 1 : -1, d0 = 70 + k * 40;
        this.patLane(d0, 38, gr, this.halfWidth(d0 + 20), sgn, 0.4 + 0.1 * (k % 3));
      }
    }
  }

  // A lane: an arc of small props across `len` m at side*frac*hw - the eye follows it. Never on the centre line.
  patLane(d, len, gr, hw, side, frac) {
    const R = this.rng, T = tierOf(gr);
    const q0 = clamp(this.rollQ(T) * 0.8, 0.14, 0.6);
    const sp = Math.max(1.9, q0 * gr * 2.1 + 0.7);
    const n = clamp(Math.floor(len / sp), 4, 12);
    const ph = R.range(0, 6.28), amp = hw * 0.12;
    let used = 0;
    for (let i = 0; i < n; i++) {
      const x = side * hw * frac + Math.sin(ph + i * 0.55) * amp;
      used += this.food1(clamp(q0 * R.range(0.9, 1.1), 0.12, 0.7), gr, x, d + i * sp, hw, { spacing: 0.1 });
    }
    return used;
  }

  // a landmark prop (snowman / fence / kiosk / rock) near the edge: too big now, edible a bit later
  placeLandmark(d, gr, hw) {
    const R = this.rng, L = this.landmarks;
    if (!L || !L.length) return;
    const e = L[R.int(0, L.length - 1)];
    const q = R.range(0.8, 1.7);
    const s = clamp(q * gr / e.r, 0.3, 14);
    const rad = e.r * s;
    const x = R.sign() * R.range(hw * 0.5, Math.max(hw * 0.52, hw - rad * 0.8 - 0.8));
    const p = this.place(e.type, x, d, hw, { s, pad: 0.6 });
    if (p && q > 1.05) p.obstacle = true;
  }

  placeCluster(d, gr, T, hw) {
    const R = this.rng;
    const side = R.sign();
    for (let i = 0; i < 2; i++) this.placeLandmark(d + i * 7 + R.range(0, 4), gr, hw);
    if (this.houses && this.houses.length) this.placeHouse(d + 10, gr, Math.max(1, T), hw);
    const cx = -side * hw * R.range(0.15, 0.4);
    for (let i = 0; i < 6; i++) this.food1(clamp(this.rollQ(T) * 0.85, 0.12, 0.6), gr, clamp(cx + Math.sin(i * 1.2) * 1.8, -hw, hw), d + 2 + i * 3.2, hw, { spacing: 0.1 });
    this.placeObstacle(d + 14, gr, T, hw);
  }

  _forkSign(p, text, col) {
    if (!p) return;
    const l = this.makeLabel(text, col);
    if (!l) return;
    p.tag = l;
    l.scale.set(12, 3.6, 1);
    l.position.set(p.x, p.y + p.h + 3.4, -p.d);
    this.group.add(l);
    this.labels.push(p);
  }

  // YOL AYRIMI (DAG 3+, once per mountain, ~124 m): a rock ridge splits the slope in two corridors. GÜVENLİ (wide): lots of
  // small food, calm. RİSKLİ (narrow, KISA YOL ⚡): extra obstacles, a double speed strip, 4 gold + 2 plain crates, fat food.
  // Deterministic per level seed (this.rng); the plan decides the risky side. world.forks lets the game warn the player.
  placeFork(it, gr, T, hw) {
    const R = this.rng, P = this.lvl;
    const d0 = it.start, d1 = it.start + it.len;
    const hwL = this.halfWidth(d0 + it.len * 0.5);
    const risk = it.side || 1, safe = -risk;
    const rx = risk * hwL * 0.3;   // ridge line: risky corridor ~0.7 hw wide, safe ~1.3 hw
    this.forks = this.forks || [];
    this.forks.push({ d0, d1, risk });
    const tr = clamp(gr * 1.4, 1, hwL * 0.15);
    const e = this.pick(this.obst, tr, 0.6, 1.7);
    if (e) {
      const sc = clamp(tr / e.r, 0.3, 22);
      for (let d = d0 + 6; d <= d1 - 6; d += tr * 1.4) {
        const taper = Math.min(1, (d - d0) / 14, (d1 - d) / 14);
        const p = this.place(e.type, rx, d, hwL, { s: sc * R.range(0.95, 1.08) * (0.55 + 0.45 * taper), pad: 0.1 });
        if (p) p.obstacle = true;
      }
    }
    const sg = this.pick(this.decorPool, 3.4, 0.6, 1.7);
    if (sg) {
      const ss = clamp(3.4 / sg.r, 0.3, 8);
      this._forkSign(this.add(sg.type, safe * hwL * 0.55, d0 + 4, { s: ss, decor: true }), 'GÜVENLİ', '#2fd36b');
      this._forkSign(this.add(sg.type, risk * hwL * 0.7, d0 + 4, { s: ss, decor: true }), 'KISA YOL ⚡ RİSKLİ', '#ff7a1a');
    }
    for (let i = 0; i < 24; i++) {
      this.food1(R.range(0.22, 0.5), gr, safe * hwL * R.range(0.3, 0.8), d0 + 14 + i * ((it.len - 28) / 24), hwL, { spacing: 0.1 });
    }
    const pr = planAt(P, d0 + 40), ct = crateRadius(pr);
    const lim = Math.max(1, hwL - ct - 1.5);
    for (let i = 0; i < 4; i++) {
      const q = gr * R.range(1.4, 2);
      const oe = this.pick(this.obst, q, 0.6, 1.7);
      if (!oe) break;
      const p = this.place(oe.type, risk * hwL * (i % 2 ? 0.8 : 0.62), d0 + 26 + i * 20, hwL, { s: clamp(q / oe.r, 0.3, 22), pad: 0.8 });
      if (p) p.obstacle = true;
    }
    this.specialQueue.push({ kind: 'strip', at: d0 + 14, xf: risk * 0.68 });
    this.specialQueue.push({ kind: 'strip', at: d0 + 74, xf: risk * 0.68 });
    for (let i = 0; i < 8; i++) this.food1(R.range(0.6, 0.8), gr, risk * hwL * R.range(0.6, 0.82), d0 + 20 + i * 12, hwL, { spacing: 0.1 });
    const cx = (f) => clamp(risk * hwL * f, -lim, lim);
    this.crateAt(cx(0.7), d0 + 30, ct * 1.15, 'gold', pr);
    this.crateAt(cx(0.78), d0 + 48, ct * 1.15, 'gold', pr);
    this.crateAt(cx(0.64), d0 + 66, ct, 'plain', pr);
    this.crateAt(cx(0.76), d0 + 84, ct * 1.15, 'gold', pr);
    this.crateAt(cx(0.66), d0 + 100, ct * 1.15, 'gold', pr);
    this.crateAt(cx(0.72), d0 + 112, ct, 'plain', pr);
    this.zones.push({ d0: d0 - 4, d1: d1 + 6, kind: 'crates' });
    return it.len;
  }

  // SICAK NOKTA: warm zone (ellipse) - melts the ball faster, holds the rich food
  inHeat(x, d) {
    for (let i = 0; i < this.heats.length; i++) {
      const p = this.heats[i];
      const a = (x - p.x) / p.rx, b = (d - p.d) / p.rd;
      if (a * a + b * b < 1) return p;
    }
    return null;
  }

  inPatch(x, d) {
    for (let i = 0; i < this.patches.length; i++) {
      const p = this.patches[i];
      const a = (x - p.x) / p.rx, b = (d - p.d) / p.rd;
      if (a * a + b * b < 1) return true;
    }
    return false;
  }

  // ===================================================================== catalog
  buildCatalog() {
    const lib = this.lib;
    const FOOD = new Set(['static', 'walker', 'skier', 'car', 'building', 'rock', 'tree']);
    const houses = [], food = [], obst = [], town = [], walkers = [], trees = [], decorAll = [];
    for (const name in lib) {
      if (name === 'chunk') continue;
      const def = lib[name];
      if (!def || !def.geometry || !(def.radius > 0.2)) continue;
      const kind = def.kind;
      if (!FOOD.has(kind)) continue;
      const e = { type: name, r: def.radius, h: def.height, kind, w: 1 };
      const isRockTree = kind === 'rock' || kind === 'tree';
      food.push({ ...e, w: isRockTree ? 0.35 : (kind === 'building' || STRUCT.has(name)) ? 2.2 : 1 });
      if (isRockTree || STRUCT.has(name) || kind === 'building') obst.push({ ...e, w: kind === 'rock' ? 1.2 : kind === 'building' ? 1.6 : 1 });
      if (kind === 'building' && !STRUCT.has(name)) houses.push(e);
      if (!isRockTree && e.r > 0.3) town.push(e);
      if (kind === 'walker' || kind === 'skier') walkers.push(e);
      if (isRockTree) decorAll.push({ ...e, w: kind === 'tree' ? 3 : 1 });
    }
    const byR = (a, b) => a.r - b.r;
    food.sort(byR); obst.sort(byR); town.sort(byR); walkers.sort(byR); decorAll.sort(byR); trees.sort(byR);
    houses.sort(byR); this.landmarks = ['snowman', 'fence', 'kiosk', 'boulder', 'bench', 'sled'].filter((n) => lib[n] && lib[n].geometry).map((n) => ({ type: n, r: lib[n].radius }));
    this.houses = houses; this.food = food; this.obst = obst; this.town = town; this.walkers = walkers; this.decorPool = decorAll;
    // late-game themed models: tier 6 city, tier 7 mountain, tier 8 planet (cumulative)
    const TH = [['skyscraper', 'stadium', 'radio_tower', 'ferris_wheel'], ['castle', 'ship', 'airplane', 'wind_turbine'], ['rocket_pad', 'rock_big', 'hotel']];
    this.themed = [];
    for (let k = 0; k < TH.length; k++) {
      const names = TH[k].concat(k ? this.themed[k - 1].names : []);
      const list = obst.filter((o) => names.includes(o.type)).map((o) => ({ ...o, w: 1 }));
      this.themed.push({ names, list });
    }
    this.snackNames = ['pebble', 'gift', 'traffic_cone', 'penguin', 'bush_small', 'rabbit'].filter((n) => lib[n]);
    if (!this.snackNames.length) this.snackNames = food.slice(0, 4).map((e) => e.type);
  }

  // Pick a library entry whose natural radius lets a scale in [sLo, sHi] reach `tr`; nearest entry when none does.
  pick(list, tr, sLo = 0.6, sHi = 1.6) {
    const n = list.length;
    if (!n) return null;
    let lo = 0, hi = n;
    const a = tr / sHi;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].r < a) lo = m + 1; else hi = m; }
    const i0 = lo;
    lo = i0; hi = n;
    const b = tr / sLo;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].r <= b) lo = m + 1; else hi = m; }
    const i1 = lo;
    if (i1 <= i0) {
      let i = clamp(i0, 0, n - 1);
      if (i > 0 && Math.abs(list[i - 1].r - tr) < Math.abs(list[i].r - tr)) i--;
      return list[i];
    }
    let tot = 0;
    for (let i = i0; i < i1; i++) tot += list[i].w;
    let roll = this.rng.next() * tot;
    for (let i = i0; i < i1; i++) { roll -= list[i].w; if (roll <= 0) return list[i]; }
    return list[i1 - 1];
  }

  rollQ(T) {
    const mix = Q_MIX[Math.min(T, Q_MIX.length - 1)];
    let roll = this.rng.next();
    for (let i = 0; i < mix.length; i++) {
      roll -= mix[i][0];
      if (roll <= 0 || i === mix.length - 1) return this.rng.range(mix[i][1], mix[i][2]);
    }
    return 0.3;
  }

  colorOf(type) {
    const def = this.lib[type];
    if (!def) return _c.setHex(0xcccccc);
    if (!def._avg) def._avg = averageColor(def.geometry);
    return def._avg;
  }

  // ===================================================================== props
  add(type, x, d, opts = {}) {
    const def = this.lib[type];
    if (!def) return null;
    const s = clamp(opts.s ?? 0.9 + this.rng.next() * 0.25, 0.2, 24);
    const p = {
      type, def, x, d,
      y: 0,
      rot: opts.rot ?? this.rng.range(0, Math.PI * 2),
      s,
      r: def.radius * s,
      h: def.height * s,
      tier: def.tier,
      kind: def.kind,
      mass: (MASS[type] ?? fallbackMass(def.radius)) * s * s * s,
      alive: true,
      decor: !!opts.decor,
      move: opts.move ?? MOVE_NONE,
      m: null,
      ox: x, od: d, vx: opts.vx ?? 0, vd: opts.vd ?? 0, phase: Math.random() * 6.28,
      tonK: opts.tonK ?? 1,
      id: 0,
    };
    p.y = this.footY(p) - 0.05;
    if (p.move === MOVE_NONE) {
      p.m = new Float32Array(16);
      _p.set(p.x, p.y, -p.d);
      _q.setFromAxisAngle(_up, p.rot);
      _s.setScalar(p.s);
      _m.compose(_p, _q, _s);
      _m.toArray(p.m);
      if (p.decor) insertSorted(this.decor, p);
      else {
        insertSorted(this.statics, p);
        if (p.r > this.maxPropR) this.maxPropR = p.r;
      }
    } else {
      this.movers.push(p);
      if (p.r > this.maxPropR) this.maxPropR = p.r;
    }
    return p;
  }

  // Place with overlap rejection against recently placed things (a few retries). Returns the prop or null.
  place(type, x, d, hw, opts = {}) {
    const def = this.lib[type];
    if (!def) return null;
    const s = clamp(opts.s ?? 1, 0.2, 24);
    const rad = def.radius * s * 0.8;
    const rec = this.recent;
    const pad = opts.pad ?? 0.4;
    for (let k = 0; k < 6; k++) {
      let ok = true;
      for (let i = rec.length - 1; i >= 0; i--) {
        const c = rec[i];
        if (Math.abs(c.d - d) > rad + c.r + 1) continue;
        if (Math.hypot(c.x - x, c.d - d) < (rad + c.r) * 0.95 + pad) { ok = false; break; }
      }
      if (ok) {
        const p = this.add(type, x, d, opts);
        if (p) { rec.push({ x, d, r: rad }); if (rec.length > 260) rec.splice(0, 100); }
        return p;
      }
      x = clamp(x + this.rng.range(-1, 1) * (rad * 2 + 1), -hw, hw);
      d += this.rng.range(-0.5, 1) * (rad + 0.6);
    }
    return null;
  }

  // Food piece at relative size q (prop radius / ball radius) near (x, d). Returns its radius^3 (volume units) or 0.
  // From ~120 m on, food keeps out of the centre line (the ball's suction reach): an idle ball starves, a steering one feeds.
  offCenter(x, d, gr, hw) {
    if (d < 120) return x;
    const gap = Math.min(hw * 0.6, (gr * 1.35 * CFG.suctionK + CFG.suctionC) * 1.15);
    if (Math.abs(x) >= gap) return x;
    const side = x === 0 ? this.rng.sign() : Math.sign(x);
    return side * (gap + Math.pow(this.rng.next(), 1.4) * Math.max(0, hw - gap - 1));
  }

  food1(q, gr, x, d, hw, opts = {}) {
    x = this.offCenter(x, d, gr, hw);
    // early mountains: chunkier food (still edible) so the slope reads as full of things, not tiny dots
    if (this.lvl && this.lvl.n <= 5 && !opts.list) q = Math.min(0.86, q * (this.lvl.n <= 2 ? 1.9 : 1.6));
    const tr = Math.max(0.12, q * gr);
    const list = opts.list || this.food;
    const e = this.pick(list, tr, opts.sLo ?? 0.62, opts.sHi ?? 1.6);
    if (!e) return 0;
    const s = clamp(tr / e.r * this.rng.range(0.94, 1.06), 0.22, 22);
    const pad = Math.min(0.5 + tr * 0.5, hw * 0.3);
    const p = this.place(e.type, clamp(x, -hw + pad, hw - pad), d, hw, { s, tonK: opts.tonK, rot: opts.rot, pad: opts.spacing });
    if (!p) return 0;
    const v = p.r ** 3;
    this.spent += v;
    return v;
  }

  // ===================================================================== generation
  genRad() { return Math.max(CFG.startR, this.ballR); }

  breadcrumbs() {
    const R = this.rng;
    const names = this.snackNames;
    // (scaled so every crumb is edible for the starting ball whatever the library's natural size is)
    const cap = (type, k) => Math.min(1, (CFG.startR * CFG.eatRatio * k) / Math.max(0.05, this.lib[type].radius));
    for (let i = 0; i < 9; i++) {
      const type = names[i % names.length];
      const x = Math.sin(i * 0.55) * 1.6;
      this.add(type, x, 6 + i * 2.8, { s: R.range(0.85, 1.05) * cap(type, 0.9) });
    }
    // a second, wider breadcrumb wave so the first seconds are one satisfying combo
    for (let i = 0; i < 12; i++) {
      const type = names[(i + 2) % names.length];
      this.add(type, Math.cos(i * 0.7) * (3 + i * 0.35), 36 + i * 3.4, { s: R.range(0.7, 1.0) * cap(type, 0.9) });
    }
  }

  // the first seconds of a mountain: a ring of crumbs sized for the plan's starting ball
  levelOpening() {
    const R = this.rng, P = this.lvl;
    const gr = P.r0, sk = clamp(gr * 0.7, 1, 3);
    for (let i = 0; i < 9; i++) {
      const d = (6 + i * 2.8) * sk, hw = this.halfWidth(d);
      this.food1(R.range(0.3, 0.55), gr, Math.sin(i * 0.55) * 1.6 * sk, d, hw, { spacing: 0.1 });
    }
    for (let i = 0; i < 12; i++) {
      const d = (36 + i * 3.4) * sk, hw = this.halfWidth(d);
      this.food1(R.range(0.3, 0.55), gr, Math.cos(i * 0.7) * (3 + i * 0.35) * sk, d, hw, { spacing: 0.1 });
    }
    // food lanes: arcs of small props leading the eye down the first 300 m (off the centre line, so an idle ball misses them)
    if (P.n <= 8) {
      for (let k = 0; k < 6; k++) {
        const sgn = k % 2 ? 1 : -1, d0 = 70 + k * 40;
        this.patLane(d0, 38, gr, this.halfWidth(d0 + 20), sgn, 0.4 + 0.1 * (k % 3));
      }
    }
  }

  // A lane: an arc of small props across `len` m at side*frac*hw - the eye follows it. Never on the centre line.
  patLane(d, len, gr, hw, side, frac) {
    const R = this.rng, T = tierOf(gr);
    const q0 = clamp(this.rollQ(T) * 0.8, 0.14, 0.6);
    const sp = Math.max(1.9, q0 * gr * 2.1 + 0.7);
    const n = clamp(Math.floor(len / sp), 4, 12);
    const ph = R.range(0, 6.28), amp = hw * 0.12;
    let used = 0;
    for (let i = 0; i < n; i++) {
      const x = side * hw * frac + Math.sin(ph + i * 0.55) * amp;
      used += this.food1(clamp(q0 * R.range(0.9, 1.1), 0.12, 0.7), gr, x, d + i * sp, hw, { spacing: 0.1 });
    }
    return used;
  }

  // a landmark prop (snowman / fence / kiosk / rock) near the edge: too big now, edible a bit later
  placeLandmark(d, gr, hw) {
    const R = this.rng, L = this.landmarks;
    if (!L || !L.length) return;
    const e = L[R.int(0, L.length - 1)];
    const q = R.range(0.8, 1.7);
    const s = clamp(q * gr / e.r, 0.3, 14);
    const rad = e.r * s;
    const x = R.sign() * R.range(hw * 0.5, Math.max(hw * 0.52, hw - rad * 0.8 - 0.8));
    const p = this.place(e.type, x, d, hw, { s, pad: 0.6 });
    if (p && q > 1.05) p.obstacle = true;
  }

  placeCluster(d, gr, T, hw) {
    const R = this.rng;
    const side = R.sign();
    for (let i = 0; i < 2; i++) this.placeLandmark(d + i * 7 + R.range(0, 4), gr, hw);
    if (this.houses && this.houses.length) this.placeHouse(d + 10, gr, Math.max(1, T), hw);
    const cx = -side * hw * R.range(0.15, 0.4);
    for (let i = 0; i < 6; i++) this.food1(clamp(this.rollQ(T) * 0.85, 0.12, 0.6), gr, clamp(cx + Math.sin(i * 1.2) * 1.8, -hw, hw), d + 2 + i * 3.2, hw, { spacing: 0.1 });
    this.placeObstacle(d + 14, gr, T, hw);
  }

  // SICAK NOKTA (DAG 6+): a glowing hot patch with gold crates and fat food inside. Melts you while you are in it.
  placeHeat(d, gr, T, hw, sideFix = 0) {
    const R = this.rng, P = this.lvl;
    const rx = Math.min(hw * 0.36, 4.2 + gr * 1.3), rd = 12 + gr * 1.6;
    const side = sideFix || R.sign();
    const x = clamp(side * hw * R.range(0.38, 0.55), -hw + rx + 0.5, hw - rx - 0.5);
    const pd = d + rd + 6;
    const heat = { x, d: pd, rx, rd, mesh: null, tex: R.range(0, 6.28) };
    this.heats.push(heat);
    this.zones.push({ d0: pd - rd - 8, d1: pd + rd + 8, kind: 'heat' });
    this.buildHeatMesh(heat);
    const pr = planAt(P, pd), tr = crateRadius(pr);
    const ng = P.n >= 12 ? 3 : 2;
    for (let i = 0; i < ng; i++) {
      const a = (i + 0.5) / ng;
      this.crateAt(clamp(x + (i % 2 ? 1 : -1) * rx * 0.45, -hw + 1.5, hw - 1.5), pd - rd * 0.6 + a * rd * 1.2, tr * 1.1, 'gold', pr);
    }
    const nf = 8;
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * 6.283 + heat.tex;
      this.food1(clamp(R.range(0.55, 0.8), 0.3, 0.86), gr, x + Math.cos(a) * rx * 0.62, pd + Math.sin(a) * rd * 0.62, hw, { spacing: 0.1 });
    }
    return 2 * rd + 12;
  }

  buildHeatMesh(h) {
    const g = new THREE.CircleGeometry(1, 20);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) * h.rx, ly = pos.getY(i) * h.rd;
      pos.setXYZ(i, h.x + lx, this.groundY(h.x + lx, h.d + ly) + 0.18, -(h.d + ly));
    }
    g.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const disc = new THREE.Mesh(g, mat);
    disc.frustumCulled = false; disc.renderOrder = 3;
    const grp = new THREE.Group();
    grp.add(disc);
    // heat shimmer: a few tall translucent columns that wobble over the zone
    const cm = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const cols = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 6.283 + 0.6, k = i % 2 ? 0.45 : 0.2;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 5.5, 10, 1, true), cm);
      const cx = h.x + Math.cos(a) * h.rx * k * 2, cd = h.d + Math.sin(a) * h.rd * k * 2;
      c.position.set(cx, this.groundY(cx, cd) + 2.6, -cd);
      c.scale.set(h.rx * 0.28, 1, h.rx * 0.28);
      c.frustumCulled = false; c.renderOrder = 4;
      c.userData.ph = i * 1.7;
      grp.add(c); cols.push(c);
    }
    this.group.add(grp);
    h.mesh = grp; h.disc = disc; h.cols = cols; h.cm = cm;
  }

  animateHeat(ballD) {
    const t = this.time;
    for (let i = 0; i < this.heats.length; i++) {
      const h = this.heats[i];
      if (!h.mesh) continue;
      const near = Math.abs(h.d - ballD) < 260;
      h.mesh.visible = near;
      if (!near) continue;
      h.disc.material.opacity = 0.32 + 0.14 * Math.sin(t * 4 + h.tex);
      h.cm.opacity = 0.13 + 0.06 * Math.sin(t * 3 + h.tex);
      for (const c of h.cols) {
        const ph = c.userData.ph;
        c.scale.y = 0.85 + 0.35 * Math.sin(t * 2.4 + ph);
        c.rotation.y = t * 0.6 + ph;
      }
    }
  }

  // Level mode: place the next plan item when the frontier reaches it, otherwise ordinary food up to the next item.
  genLevelSegment() {
    const gr = this.genRad();
    const T = tierOf(gr);
    this.lastGen.gr = gr; this.lastGen.T = T;
    const d = this.genD;
    if (d >= this.endD) { this.genD = Infinity; this.genDone = true; return; }
    const it = this.items[this.qi];
    if (it && d >= it.start - 0.01) {
      this.qi++;
      const len = this.placeLevelItem(it, d, gr, T, this.halfWidth(d + 10)) || 4;
      const nx = this.items[this.qi];
      this.genD = d + Math.max(4, nx ? Math.min(len, nx.start - d) : len);
      return;
    }
    const lim = it ? it.start : this.endD;
    if (this.lvl.n >= 6 && d >= this.nextHeatD && d > 160) {
      const need = 2 * (12 + gr * 1.6) + 18;
      if (lim - d >= need && this.zoneFree(d - 8, d + need, null)) {
        const len = this.placeHeat(d, gr, T, this.halfWidth(d + 10));
        this.genD = d + len;
        this.nextHeatD = this.genD + this.rng.range(230, 340);
        return;
      }
    }
    const seg = Math.max(4, Math.min(segLen(gr), lim - d));
    if (d > 36) this.regular(d, seg, gr, T, this.halfWidth(d + 10), 0);
    // a landmark cluster (village corner / picnic / lift base) about every 150 m: food + something to smash
    if (d > 90 && d >= (this.nextClusterD || 0) && lim - d > 30 && this.zoneFree(d - 4, d + 30, null)) {
      this.nextClusterD = d + this.rng.range(130, 170);
      this.placeCluster(d + 6, gr, T, this.halfWidth(d + 16));
    }
    this.genD = d + seg;
    const rec = this.recent;
    if (rec.length && rec[0].d < d - 60) { let k = 0; while (k < rec.length && rec[k].d < d - 60) k++; rec.splice(0, k); }
    const ob = this.obsRecent;
    if (ob.length && ob[0].d < d - 60) { let k = 0; while (k < ob.length && ob[k].d < d - 60) k++; ob.splice(0, k); }
  }

  placeLevelItem(it, d, gr, T, hw) {
    switch (it.kind) {
      case 'gate': return this.placeGate(d, gr, T, hw, { gd: it.gd, minR: it.minR, skin: it.skin, i: it.i, final: it.final, locked: it.locked, start: it.start });
      case 'crateLine': return this.placeCrateLine(it, gr, hw);
      case 'crateWall': return this.placeCrateWall(it, gr, hw);
      case 'iceWall': return this.placeIceWall(it, gr, hw);
      case 'statues': return this.placeStatues(it, gr, hw);
      case 'domino': return this.placeDomino(it, gr, hw);
      case 'throne': return this.placeThrone(it, gr, hw);
      case 'secret': return this.placeSecret(it, gr, hw);
      case 'ramp': return this.placeRamp(d, gr, T, hw);
      case 'patch': return this.placePatch(d, gr, T, hw);
      case 'town': return this.placeTown(d, gr, T, hw);
      case 'golden': return this.placeGolden(d, gr, T, hw);
      case 'rival': return this.placeRival(d, gr, T, hw, 1.1);
      case 'arena': return this.placeArena(it, gr, T, hw);
      case 'fork': return this.placeFork(it, gr, T, hw);
      case 'finish': this.addFinish(it.at); return 4;
      case 'army': case 'mush': case 'strip': case 'cannon': case 'bridge': case 'pickup': case 'puddle': case 'salt':
        // CigPlus builds these (it owns the meshes); it receives a plain copy of the plan item
        this.specialQueue.push({ ...it });
        this.zones.push({ d0: it.start - 6, d1: it.start + it.len + 6, kind: it.kind === 'strip' || it.kind === 'pickup' ? 'plus' : it.kind });
        return it.len;
      default: return 4;
    }
  }

  genSegment() {
    if (this.lvl) { this.genLevelSegment(); return; }
    const gr = this.genRad();
    const T = tierOf(gr);
    this.lastGen.gr = gr; this.lastGen.T = T;
    const d = this.genD;
    const hw = this.halfWidth(d + 10);
    const seg = segLen(gr);
    if (d >= this.nextGateD && d > 200) {
      const len = this.placeGate(d, gr, T, hw);
      this.genD = d + len;
      this.nextGateD = this.genD + this.rng.range(CFG.gateGap[0], CFG.gateGap[1]);
      if (this.nextEventD < this.genD + 70) this.nextEventD = this.genD + 70;
      if (this.nextFeatureD < this.genD + 70) this.nextFeatureD = this.genD + 70;
      return;
    }
    if (d >= this.nextEventD) {
      const len = this.placeEvent(d, gr, T, hw);
      this.genD = d + len;
      this.nextEventD = this.genD + this.rng.range(CFG.eventGap[0], CFG.eventGap[1]);
      if (this.nextFeatureD < this.genD + 120) this.nextFeatureD = this.genD + 120;
      return;
    }
    if (d >= this.nextFeatureD && d > 150) {
      const len = this.placeFeature(d, gr, T, hw);
      this.genD = d + len;
      this.nextFeatureD = this.genD + this.rng.range(190, 330);
      if (this.nextEventD < this.genD + 120 && this.nextEventD - this.genD < 120) this.nextEventD = this.genD + 120;
      return;
    }
    if (d > 36) this.regular(d, seg, gr, T, hw, 0);
    this.genD = d + seg;
    // keep the overlap list short
    const rec = this.recent;
    if (rec.length && rec[0].d < d - 60) { let k = 0; while (k < rec.length && rec[k].d < d - 60) k++; rec.splice(0, k); }
    const ob = this.obsRecent;
    if (ob.length && ob[0].d < d - 60) { let k = 0; while (k < ob.length && ob[k].d < d - 60) k++; ob.splice(0, k); }
  }

  // One ordinary stretch: a budget of food volume, spent on trails / clusters / scatter, plus a few obstacles and movers.
  // `inner` > 0 = fill only the strip |x| in [inner, hw] (used when the slope just widened).
  regular(d, seg, gr, T, hw, inner) {
    const R = this.rng;
    const frac = inner > 0 ? clamp((hw - inner) / hw, 0, 1) : 1;
    let allowed = (foodRelAt(gr) * gr ** 3 * seg * frac) / CFG.growK;
    // The very first stretches are generous: the first minute must feel like a feast.
    if (d < 400) allowed *= 1.35;
    if (this.lvl) {
      allowed *= this.foodMulAt(d, gr);
      // early mountains feel empty otherwise: roughly double the edible props
      const ln = this.lvl.n;
      allowed *= ln <= 5 ? 2 : ln <= 8 ? 1.4 : 1.15;
    }
    // Everything placed anywhere (trails, towns, ramps' landing fields...) draws on one ledger, so jackpots are followed
    // by a thinner stretch instead of snowballing the growth.
    this.credit += allowed;
    let budget = Math.max(this.credit - this.spent, allowed * 0.25);
    const floor = 0.0008 * gr ** 3;
    let guard = 0;
    while (budget > floor && guard++ < 60) {
      const roll = R.next();
      let used = 0;
      if (inner > 0 || roll >= 0.58) used = this.patScatter(d, seg, gr, T, hw, budget, inner);
      else if (roll < 0.34) used = this.patTrail(d, seg, gr, T, hw, budget);
      else used = this.patCluster(d, seg, gr, T, hw, budget);
      if (used <= 0) { budget -= floor * 4; continue; }
      budget -= used;
    }
    this.credit = Math.min(this.credit, this.spent + 3 * allowed);
    if (inner > 0) return;
    // food lanes between gates (early mountains): a lane most segments, alternating sides
    if (this.lvl && this.lvl.n <= 8 && d > 36 && R.next() < (this.lvl.n <= 5 ? 0.7 : 0.4)) {
      this.laneSide = -(this.laneSide || 1);
      this.patLane(d, seg, gr, hw, this.laneSide, R.range(0.35, 0.6));
    }
    if (this.lvl && this.lvl.n <= 8 && d > 60 && R.next() < 0.5) this.placeLandmark(d + R.range(0, seg), gr, hw);
    // obstacles: bigger than the ball, never walls (a free corridor is guaranteed)
    if (d > 130) {
      const rate = CFG.obstacleRate[T] * seg / 100;
      let n = Math.floor(rate);
      if (R.next() < rate - n) n++;
      for (let i = 0; i < n; i++) this.placeObstacle(d + R.range(0, seg), gr, T, hw);
    }
    // houses (edible once the ball is big enough, smashable before that)
    if (T >= 1 && this.houses.length && R.next() < 0.3 * seg / 12) this.placeHouse(d + R.range(0, seg), gr, T, hw);
    // enemies with HP bars: a group every ~170 m, a boss every ~800 m
    if (d > 140 && d >= this.nextBossD) { this.placeBoss(d + R.range(4, seg), gr, T, hw); this.nextBossD = d + CFG.bossGap; if (this.nextEnemyD < d + 60) this.nextEnemyD = d + 60; }
    else if (d > 140 && d >= this.nextEnemyD) { this.placeEnemies(d + R.range(0, seg * 0.5), gr, T, hw); this.nextEnemyD = d + R.range(CFG.enemyGap[0], CFG.enemyGap[1]) * (1 - 0.13 * Math.min(T, 4)); }
    // late tiers: themed giants (city / mountain / planet) as extra food and obstacles
    if (T >= 5 && inner <= 0) {
      const th = this.themed[Math.min(T - 5, this.themed.length - 1)];
      if (th && th.list.length) {
        const n = R.int(1, 3);
        for (let i = 0; i < n; i++) this.food1(R.range(0.3, 0.8), gr, R.range(-hw, hw), d + R.range(0, seg), hw, { list: th.list, sLo: 0.25, sHi: 4 });
        if (R.chance(0.35 * seg / 20)) this.placeObstacle(d + R.range(0, seg), gr, T, hw);
      }
    }
    if (d > 200 && d >= this.nextRivalD) { this.placeRival(d + R.range(10, seg), gr, T, hw); this.nextRivalD = d + R.range(CFG.rivalGap[0], CFG.rivalGap[1]); }
    // life: skiers / walkers racing or wandering around
    if (d > 90 && R.next() < 0.1 * seg / 12) this.patMovers(d, seg, gr, T, hw);
  }

  patScatter(d, seg, gr, T, hw, budget, inner) {
    const R = this.rng;
    const n = R.int(3, 8);
    let used = 0;
    for (let i = 0; i < n && used < budget; i++) {
      const q = this.rollQ(T);
      let x;
      if (inner > 0) x = R.sign() * R.range(inner, hw);
      else x = R.range(-hw, hw);
      used += this.food1(q, gr, x, d + R.range(0, seg), hw);
    }
    return used;
  }

  // A snake of snack-size pieces: the "follow the line" candy.
  patTrail(d, seg, gr, T, hw, budget) {
    const R = this.rng;
    const n = R.int(6, 11);
    const x0 = R.range(-hw * 0.75, hw * 0.75);
    const amp = R.range(0, hw * 0.35), freq = R.range(0.04, 0.1);
    const q0 = this.rollQ(T);
    let used = 0;
    let dd = d + R.range(0, seg * 0.4);
    for (let i = 0; i < n && used < budget * 1.3; i++) {
      const q = clamp(q0 * R.range(0.85, 1.15), 0.1, 0.86);
      const tr = Math.max(0.12, q * gr);
      const x = clamp(x0 + Math.sin(dd * freq) * amp, -hw, hw);
      used += this.food1(q, gr, x, dd, hw, { spacing: 0.1 });
      dd += Math.max(1.5, tr * 2.1 + 0.4);
    }
    return used;
  }

  // One bigger piece with a ring of snacks: the "meal".
  patCluster(d, seg, gr, T, hw, budget) {
    const R = this.rng;
    const cx = R.range(-hw * 0.7, hw * 0.7);
    const cd = d + R.range(0, seg * 0.6);
    const qc = R.range(0.45, 0.8);
    const trc = qc * gr;
    let used = this.food1(qc, gr, cx, cd, hw);
    const ringR = trc * 0.9 + R.range(0.8, 2) + gr * 0.5;
    const n = R.int(5, 9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R.next() * 0.4;
      const q = clamp(this.rollQ(T) * 0.8, 0.1, 0.5);
      used += this.food1(q, gr, cx + Math.cos(a) * ringR * R.range(0.9, 1.3), cd + Math.sin(a) * ringR * R.range(0.9, 1.3), hw);
      if (used > budget * 1.6) break;
    }
    return used;
  }

  patMovers(d, seg, gr, T, hw) {
    const R = this.rng;
    if (!this.walkers.length) return;
    const skiers = R.chance(0.55);
    const n = R.int(3, 6);
    const q = R.range(0.3, 0.7);
    const e = this.pick(this.walkers, q * gr, 0.6, 1.6);
    if (!e) return;
    const s = clamp(q * gr / e.r, 0.25, 20);
    const cx = R.range(-hw * 0.6, hw * 0.6);
    for (let i = 0; i < n; i++) {
      const x = clamp(cx + R.range(-5, 5) * (1 + gr * 0.3), -hw + 1, hw - 1);
      if (skiers) this.add(e.type, x, d + R.range(0, 10), { s: s * R.range(0.92, 1.08), move: MOVE_SKI, vd: R.range(5, 8.5), rot: Math.PI });
      else this.add(e.type, x, d + R.range(0, 10), { s: s * R.range(0.92, 1.08), move: MOVE_WANDER });
    }
  }

  // A house scaled to 0.45-0.85 of the ball: edible (suction + crumble into the ball).
  placeHouse(d, gr, T, hw) {
    const R = this.rng;
    const e = this.houses[R.int(0, this.houses.length - 1)];
    if (!e) return;
    const tr = R.range(0.45, 0.85) * gr;
    const s = clamp(tr / e.r, 0.22, 22);
    const pad = Math.min(e.r * s * 0.6, hw * 0.3);
    this.place(e.type, clamp(R.range(-hw * 0.8, hw * 0.8), -hw + pad, hw - pad), d, hw, { s, tonK: 1.5 });
  }

  // ---- enemies: HP bar units. Rammed by the ball (see CigGame), never eaten.
  enemyDefs() {
    const L = this.lib;
    const pick = (...n) => n.find((k) => L[k]);
    return [
      { id: 'soldier', name: 'KARDAN ASKER', lib: pick('snowman', 'k_snowman_hat', 'k_snowman'), hp: 0.8, ai: 'throw', ratio: [0.9, 1.3], tint: [1, 0.62, 0.6], spd: 5 },
      { id: 'sled', name: 'KAR ARACI', lib: pick('snowmobile', 'k_tractor', 'car'), hp: 1.0, ai: 'chase', ratio: [1, 1.4], tint: [1, 0.78, 0.45], spd: 9 },
      { id: 'yeti', name: 'YETİ', lib: pick('yeti', 'snowman'), hp: 1.25, ai: 'chase', ratio: [1.05, 1.5], tint: [0.8, 0.88, 1], spd: 7 },
      { id: 'robot', name: 'BUZ ROBOTU', lib: pick('robot'), hp: 2.2, ai: 'throw', ratio: [1.2, 1.7], tint: [0.8, 0.9, 1], spd: 6, boss: 'DEV ROBOT' },
      { id: 'golem', name: 'BUZ GOLEMİ', lib: pick('boulder', 'k_rock_snow', 'rock_big'), hp: 1.8, ai: 'throw', ratio: [1.2, 1.7], tint: [0.5, 0.85, 1], spd: 0 },
    ].filter((d) => d.lib);
  }

  makeEnemy(def, x, d, tr, boss) {
    const lib = this.lib[def.lib];
    const s = clamp(tr / lib.radius, 0.25, 24);
    const p = this.add(def.lib, x, d, { s, rot: 0, move: MOVE_ENEMY, tonK: boss ? 4 : 2 });
    if (!p) return null;
    const hp = Math.max(8, p.r * CFG.hpPerR * def.hp * (boss ? 2 : 1) * (1 + 0.28 * Math.min(4, tierOf(this.genRad()))));
    p.enemy = {
      id: def.id, name: boss ? (def.boss || 'DEV YETİ') : def.name, ai: boss ? 'boss' : def.ai, boss: !!boss,
      hp, max: hp, spd: def.spd * (boss ? 0.7 : 1), cd: 1.5 + Math.random() * 2, hitCd: 0, kbD: 0, kbX: 0, flash: 0, woke: false,
      tint: boss ? [1, 0.5, 0.46] : def.tint,
    };
    p.tint = p.enemy.tint;
    p.ox = x; p.od = d;
    this.enemies.push(p);
    return p;
  }

  placeEnemies(d, gr, T, hw) {
    const R = this.rng;
    const defs = this.enemyDefs();
    if (!defs.length) return;
    const rb = T >= 5 ? defs.findIndex((e) => e.id === 'robot') : -1;
    const ti = rb >= 0 ? rb : Math.min(T, defs.length - 1);
    const n = R.int(1 + (T >= 1 ? 1 : 0), 2 + T);
    const cx = R.chance(0.5) ? R.range(-hw * 0.12, hw * 0.12) : R.range(-hw * 0.6, hw * 0.6);
    for (let i = 0; i < n; i++) {
      const def = defs[R.chance(0.65) ? ti : Math.max(0, ti - 1)];
      const tr = gr * R.range(def.ratio[0], def.ratio[1]) * (1 + 0.06 * T);
      this.makeEnemy(def, clamp(cx + R.range(-4, 4) * (1 + gr * 0.3), -hw + 1.5, hw - 1.5), d + i * (2 + tr), tr, false);
    }
  }

  // A rival snowball of about your size races down the slope: eat it if you are bigger, it shaves you if it is.
  placeRival(d, gr, T, hw, k = 0) {
    const def = this.lib.rival_ball;
    if (!def) return 70;
    const R = this.rng;
    const tr = gr * (k || R.range(0.8, 1.3));
    const s = clamp(tr / def.radius, 0.3, 40);
    const x = R.range(-hw * 0.5, hw * 0.5);
    const p = this.add('rival_ball', x, d + 30, { s, rot: 0, move: MOVE_ENEMY, tonK: 3 });
    if (!p) return 70;
    p.enemy = { id: 'rival', name: 'RAKİP KARTOPU', ai: 'rival', rival: true, boss: false, hp: 1, max: 1, spd: 8, cd: 0, hitCd: 0, kbD: 0, kbX: 0, flash: 0, woke: true, tint: [1, 1, 1], rcd: 0 };
    p.tint = p.enemy.tint;
    p.ox = x; p.od = p.d;
    this.enemies.push(p);
    this.zones.push({ d0: d + 5, d1: d + 55, kind: 'rival' });
    return 70;
  }

  placeBoss(d, gr, T, hw) {
    const defs = this.enemyDefs();
    const def = (T >= 5 ? defs.find((e) => e.id === 'robot') : null) || defs.find((e) => e.id === 'yeti') || defs[defs.length - 1];
    if (!def) return;
    const tr = gr * this.rng.range(2.4, 3) + 1;
    this.zones.push({ d0: d - 12, d1: d + 40, kind: 'boss' });
    this.makeEnemy(def, this.rng.range(-hw * 0.15, hw * 0.15), d + 10, tr, true);
  }

  // A prop clearly bigger than the ball. Never closes the track: a corridor of at least ~3 ball widths stays free.
  placeObstacle(d, gr, T, hw) {
    const R = this.rng;
    const q = R.chance(0.15) ? R.range(2.6, 3.6) : R.range(1.3, 2.5);
    const tr = q * gr;
    const th = T >= 5 && R.chance(0.65) ? this.themed[Math.min(T - 5, this.themed.length - 1)] : null;
    const e = this.pick(th && th.list.length ? th.list : this.obst, tr, 0.6, th ? 3 : 1.7);
    if (!e) return;
    const s = clamp(tr / e.r * R.range(0.95, 1.08), 0.3, 22);
    const rad = e.r * s;
    const big = q > 2;
    for (let k = 0; k < 5; k++) {
      const gapC = Math.min(hw * 0.6, (gr * 1.35 * CFG.suctionK + CFG.suctionC) * 1.15);
      const x = R.chance(0.55) ? R.range(-gapC * 0.8, gapC * 0.8) : big ? R.sign() * R.range(hw * 0.35, hw * 0.9) : R.range(-hw * 0.85, hw * 0.85);
      if (Math.abs(x) + rad * 0.7 > hw + rad * 0.3) continue;
      // free-corridor check against the obstacles around this distance
      const need = Math.max(3.2 * gr + 2, 4);
      const ivs = [[x - rad * CFG.contactK, x + rad * CFG.contactK]];
      for (const o of this.obsRecent) if (Math.abs(o.d - d) < (o.r + rad) * 0.7 + gr * 5) ivs.push([o.x - o.r * CFG.contactK, o.x + o.r * CFG.contactK]);
      ivs.sort((a, b) => a[0] - b[0]);
      let cursor = -hw, best = 0;
      for (const iv of ivs) { best = Math.max(best, iv[0] - cursor); cursor = Math.max(cursor, iv[1]); }
      best = Math.max(best, hw - cursor);
      if (best < need) continue;
      const p = this.place(e.type, x, d, hw, { s, pad: 1 });
      if (!p) continue;
      p.obstacle = true;
      this.obsRecent.push({ x, d, r: rad });
      // a snack arc around it: steering around is rewarded
      const side = x > 0 ? -1 : 1;
      const arcN = 6;
      for (let i = 0; i < arcN; i++) {
        const t = i / (arcN - 1);
        this.food1(clamp(this.rollQ(T) * 0.75, 0.12, 0.45), gr, x + side * (rad * CFG.contactK + gr * 1.2 + 1.2 + Math.sin(t * Math.PI) * 1.5), d - rad + t * rad * 2.4, hw, { spacing: 0.1 });
      }
      return;
    }
  }

  // ---- terrain features: kicker ramp with a landing field, or a bare-ground patch with bait on the far side ----
  placeFeature(d, gr, T, hw) {
    const R = this.rng;
    const kind = R.chance(0.55) ? 'ramp' : 'patch';
    if (kind === 'ramp') return this.placeRamp(d, gr, T, hw);
    return this.placePatch(d, gr, T, hw);
  }

  placeRamp(d, gr, T, hw) {
    const R = this.rng;
    const w = Math.min(hw * 1.1, R.range(6, 8) + gr * 1.3);
    const len = 9 + gr * 1.2;
    const h = 2.6 + gr * 0.3;
    const x = R.range(-hw + w / 2 + 0.5, hw - w / 2 - 0.5) * 0.9;
    const flip = false; // (no barrel rolls / flying: ramps are short hops)
    const ramp = { x, d, w, len, h, flip, mesh: null, R: gr };
    this.ramps.push(ramp);
    this.zones.push({ d0: d - 8, d1: d + len + 60 + gr * 3, kind: 'ramp' });
    // landing field: flying into a crowd is the money shot
    const v = Math.min(CFG.maxSpeed, CFG.baseSpeed + CFG.sizeSpeed * Math.sqrt(gr));
    const B = (this.lvl ? RAMP_AIR_K : 1) * Math.min(CFG.hopMax, 4 + 0.18 * v) + CFG.grade * v;
    const t = (B + Math.sqrt(B * B + 2 * CFG.gravity * h)) / CFG.gravity;
    const land = d + len + v * t;
    const n = 14 + (flip ? 6 : 0);
    for (let i = 0; i < n; i++) {
      const q = clamp(this.rollQ(T) * R.range(0.8, 1.1), 0.12, 0.86);
      this.food1(q, gr, clamp(x + R.range(-7, 7), -hw + 1, hw - 1), land + R.range(-8, 10), hw, { spacing: 0.1 });
    }
    this.buildRampMesh(ramp);
    return land - d + 14;
  }

  placePatch(d, gr, T, hw) {
    const R = this.rng;
    const rx = Math.min(hw * 0.4, R.range(4, 7) + gr * 1.6), rd = R.range(8, 14) + gr * 2.6;
    const x = R.range(-hw + rx * 0.6, hw - rx * 0.6);
    const pd = d + rd + 4;
    this.patches.push({ x, d: pd, rx, rd });
    this.zones.push({ d0: pd - rd - 6, d1: pd + rd + 6, kind: 'patch' });
    this.markDirty(pd - rd - 8);
    // bait on the far side of the dirt, and a clean path around it
    for (let i = 0; i < 7; i++) {
      const q = clamp(this.rollQ(T), 0.15, 0.7);
      this.food1(q, gr, clamp(x + R.range(-rx, rx) * 0.7, -hw + 1, hw - 1), pd + rd * R.range(0.4, 1.1), hw);
    }
    return rd * 2 + 14;
  }

  zoneFree(d0, d1, kinds) {
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (kinds && kinds.indexOf(z.kind) < 0) continue;
      if (d0 < z.d1 && d1 > z.d0) return false;
    }
    return true;
  }

  // ---- events: KASABA jackpot, size gate, golden snowball ----
  placeEvent(d, gr, T, hw) {
    const kinds = ['town', 'golden'];
    let kind;
    if (this.eventNo === 0) kind = 'town';
    else {
      const pool = kinds.filter((k) => k !== this.lastEventKind);
      kind = pool[Math.floor(this.rng.next() * pool.length)];
    }
    this.eventNo++;
    this.lastEventKind = kind;
    if (kind === 'town') return this.placeTown(d, gr, T, hw);
    if (kind === 'gate') return this.placeGate(d, gr, T, hw);
    return this.placeGolden(d, gr, T, hw);
  }

  placeTown(d, gr, T, hw) {
    const R = this.rng;
    const tr = gr * 0.58;
    const pitch = Math.max(2.6, tr * 2 + 2.2);
    const rows = clamp(Math.round(70 / pitch), 5, 8);
    const len = rows * pitch + 16;
    const street = Math.max(2.4 + gr * 0.9, 4);
    const d0 = d + 8;
    this.events.push({ kind: 'town', d0, d1: d0 + rows * pitch, name: 'KASABA', seen: false });
    this.zones.push({ d0: d - 10, d1: d + len + 10, kind: 'town' });
    for (let i = 0; i < rows; i++) {
      const dd = d0 + i * pitch;
      for (const side of [-1, 1]) {
        const q = R.range(0.3, 0.62);
        const e = this.pick(this.town, q * gr, 0.55, 1.7);
        if (!e) continue;
        const s = clamp(q * gr / e.r, 0.25, 20);
        const rad = e.r * s;
        const x = side * (street + rad * CFG.contactK + R.range(0, 0.8));
        if (Math.abs(x) + rad * 0.5 > hw) continue;
        this.place(e.type, x, dd + R.range(-0.5, 0.5), hw, { s, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, tonK: 1.5, pad: 0.1 });
      }
      // street life
      this.food1(clamp(this.rollQ(T) * 0.9, 0.12, 0.6), gr, R.range(-street * 0.6, street * 0.6), dd + pitch * 0.5, hw, { tonK: 1.5, spacing: 0.1 });
    }
    return len;
  }

  placeGolden(d, gr, T, hw) {
    const R = this.rng;
    const x = R.range(-hw * 0.5, hw * 0.5);
    const gd = d + 22;
    this.specialQueue.push({ kind: 'golden', x, d: gd });
    this.events.push({ kind: 'golden', d0: gd - 25, d1: gd + 4, name: 'ALTIN KARTOPU', seen: false });
    this.zones.push({ d0: d - 6, d1: d + 46, kind: 'golden' });
    // a halo of snacks around it, so the detour is worth it anyway
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.food1(clamp(this.rollQ(T) * 0.8, 0.12, 0.5), gr, x + Math.cos(a) * (3 + gr * 1.6), gd + Math.sin(a) * (4 + gr * 1.6), hw, { spacing: 0.1 });
    }
    return 46;
  }

  // Size gate: a full-width wall of ice blocks you smash through if you are big enough ('⛔ X m').
  // Endless: too small = heavy bump, but the wall always breaks (no soft-lock). Levels: too small = the ball is thrown back and
  // the gate stays, cracked (CigGame._hitGate). A feast before it lets you top up.
  placeGate(d, gr, T, hw, o = {}) {
    const R = this.rng;
    const gd = o.gd ?? d + 70;
    // a pace check: you should be about as big as the slope expects there
    // (sized to the current tier: the ball keeps growing on the way there, so a fed ball usually breaks it)
    const minR = o.minR != null ? o.minR : Math.max(gr * (0.9 + 0.05 * T), Math.min(gr * (1.25 + 0.1 * T), expectedRAt(gd) * 0.85), CFG.startR + 0.1);
    const g = this.buildGate(gd, minR, Math.max(hw, this.halfWidth(gd)), o);
    if (o.final) this.finalGate = g;
    this.events.push({ kind: 'gate', d0: gd - 60, d1: gd + 5, name: 'KAPI', seen: false, gate: g });
    this.zones.push({ d0: d - 6, d1: gd + 14, kind: 'gate' });
    // feeding zone before the wall: two snack trails
    const gap = this.lvl ? Math.min(2.2 + gr * 0.4, 4.6) : 2.2 + gr * 0.4;
    const d00 = this.lvl ? Math.min(d, gd - 70) : d;
    for (let k = 0; k < 2; k++) {
      let x = R.range(-hw * 0.5, hw * 0.5);
      const amp = R.range(2, hw * 0.3);
      for (let i = 0; i < 11; i++) {
        const dd = d00 + 8 + k * 14 + i * gap;
        this.food1(clamp(this.rollQ(T) * 0.9, 0.12, 0.7), gr, clamp(x + Math.sin(i * 0.6 + k) * amp, -hw, hw), dd, hw, { spacing: 0.1 });
      }
    }
    return gd + 14 - d;
  }

  // o: { mini (a half-width wall between x0..x1), skin 'ice'|'wall'|'big', i, final, locked }. The state colour (red = too small,
  // amber = almost, green = you break it) lives in the cap blocks and the label; setGateReady() changes it.
  buildGate(gd, minR, hw, o = {}) {
    const mini = !!o.mini;
    const hwG = hw + 1.4;
    const x0 = mini ? o.x0 : -hwG, x1 = mini ? o.x1 : hwG;
    const colW = Math.max(1.8, Math.min(3.4, minR * 0.7));
    const n = Math.max(mini ? 2 : 4, Math.ceil((x1 - x0) / colW));
    const w = (x1 - x0) / n;
    const H = mini ? Math.max(2, minR * 1.6) : Math.max(2.4, minR * 2.1);
    const T = mini ? Math.max(1.2, minR * 0.4) : Math.max(1.5, minR * 0.45);
    const skin = o.skin || 'ice';
    const pal = GATE_SKIN[skin] || GATE_SKIN.ice;
    const g = {
      d: gd, minR, minR0: minR, hw: hwG, H, T, cols: [], caps: [], broken: false, t: 0, weak: false, label: null, labelText: '', labelCol: '', hit: false,
      i: o.i ?? -1, kind: mini ? 'mini' : o.locked ? 'boss' : o.final ? 'final' : 'gate', skin, x0, x1,
      cracks: 0, bounces: 0, supplyLeft: CFG.lvl.supplyMax, cd: 0, ready: -1, locked: !!o.locked,
    };
    for (let i = 0; i < n; i++) {
      const x = x0 + w * (i + 0.5);
      const gy = this.groundY(x, gd);
      const col = { x, y: gy + H / 2 - 0.2, d: gd, sx: w * 0.96, sy: H, sz: T, rot: 0, rx: 0, color: pal[i % 2], vx: 0, vy: 0, vd: 0, wx: 0, wy: 0, alive: true, big: true };
      const cap = { x, y: gy + H + 0.35, d: gd, sx: w * 0.96, sy: Math.max(0.5, H * 0.14), sz: T * 1.08, rot: 0, rx: 0, color: i % 2 ? 0xff4d4d : 0xffffff, vx: 0, vy: 0, vd: 0, wx: 0, wy: 0, alive: true, big: true };
      g.cols.push(col, cap);
      g.caps.push(cap);
      this.boxItems.push(col, cap);
    }
    g.label = this.makeLabel('', '#ff5a4a');
    if (g.label) {
      const cx = (x0 + x1) / 2;
      g.label.position.set(cx, this.groundY(cx, gd) + H + Math.max(1.4, H * 0.35), -gd);
      const lw = mini ? clamp((x1 - x0) * 0.35, 4, 9) : clamp(2.6 + minR * 1.1, 5, 11);
      g.label.scale.set(lw, lw * 0.3, 1);
      this.group.add(g.label);
    }
    this.setGateLabel(g);
    if (skin === 'big' && !mini) this.addArch(gd, hwG, 2);
    this.gates.push(g);
    return g;
  }

  setGateLabel(g) {
    if (!g.label) return;
    const txt = g.locked ? '🔒 PATRON' : '⛔ ' + fmtDiam(g.minR * 2) + ' m';
    const col = g.ready === 2 ? '#2fd36b' : g.ready === 1 ? '#ffb03a' : '#ff5a4a';
    g.labelText = txt;
    if (col === g.labelCol && g._lt === txt) return;
    g.labelCol = col; g._lt = txt;
    drawLabel(g.label, txt, col);
  }

  // 0 = too small (red), 1 = almost (amber: eat a little more), 2 = you break it (green). Only repaints when it changes.
  setGateReady(g, r) {
    if (g.ready === r) return;
    g.ready = r;
    const c = r === 2 ? 0x2fd36b : r === 1 ? 0xffb03a : 0xff4d4d;
    for (let i = 0; i < g.caps.length; i++) g.caps[i].color = i % 2 ? 0xffffff : c;
    this.setGateLabel(g);
  }

  unlockGate(g) {
    g.locked = false;
    this.setGateLabel(g);
  }

  // Gate smashed (or it smashed you): blocks fly apart.
  breakGate(g, hitX = 0, power = 1) {
    if (g.broken) return;
    g.broken = true; g.t = 0;
    for (const c of g.cols) {
      const dx = c.x - hitX;
      c.vx = dx * 0.5 * power + (Math.random() - 0.5) * 3;
      c.vy = (2 + Math.random() * 4) * power;
      c.vd = (7 + Math.random() * 9) * power;   // always away from the camera, never toward the ball
      c.wx = (Math.random() - 0.5) * 8;
      c.wy = (Math.random() - 0.5) * 6;
    }
    if (g.label) g.label.visible = false;
  }

  makeLabel(text, color = '#ffffff') {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 96;
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    spr.userData.cv = cv;
    spr.renderOrder = 8;
    spr.frustumCulled = false;
    drawLabel(spr, text, color);
    return spr;
  }

  // ---- crates (levels): breakable, never edible. CigGame._breakCrate reads p.crate = { gold, iron, y (snow volume), need }
  crateAt(x, d, rad, kind, pr) {
    const L = CFG.lvl;
    const name = kind === 'gold' && this.lib.crate_gold ? 'crate_gold' : 'crate';
    const def = this.lib[name];
    if (!def) return null;
    const p = this.add(name, x, d, { s: clamp(rad / def.radius, 0.2, 24), rot: this.rng.range(-0.25, 0.25) });
    if (!p) return null;
    const y = L.crateYield * pr ** 3 * (kind === 'gold' ? L.goldMul : kind === 'iron' ? L.ironMul : 1);
    p.crate = { gold: kind === 'gold', iron: kind === 'iron', y, need: kind === 'iron' ? 0.62 * pr : 0 };
    p.tint = kind === 'iron' ? CRATE_IRON : CRATE_PLAIN;
    this.spent += y / CFG.growK;
    return p;
  }

  // a zig-zag line of crates across the track: steer through them (golden ones sit out at the edges)
  placeCrateLine(it, gr, hw) {
    const pr = planAt(this.lvl, it.start + 20);
    const tr = crateRadius(pr);
    const hwL = this.halfWidth(it.start + 20);
    const n = it.n, gold = it.gold || 0;
    const sp = Math.max((it.len - 12) / Math.max(1, n - 1), 1.9 * tr);
    const amp = Math.min(hwL * 0.5, 4 + 1.4 * gr);
    const lim = Math.max(1, hwL - tr - 1.5);
    for (let j = 0; j < n; j++) {
      const isGold = j >= n - gold;
      let x = Math.sin(it.phase + j * 0.95) * amp;
      if (isGold) x = (j % 2 ? 1 : -1) * Math.min(lim, amp * 1.5);
      this.crateAt(clamp(x, -lim, lim), it.start + 6 + j * sp, isGold ? tr * 1.15 : tr, isGold ? 'gold' : 'plain', pr);
    }
    this.zones.push({ d0: it.start - 4, d1: it.start + it.len + 8, kind: 'crates' });
    return it.len;
  }

  // 3 rows x N columns of crates (the middle ones iron from DAĞ 11); the track always keeps a free corridor
  placeCrateWall(it, gr, hw) {
    const pr = planAt(this.lvl, it.start + 20);
    const tr = crateRadius(pr);
    const hwL = this.halfWidth(it.start + 20);
    const pitch = Math.max(2.4, 2.3 * tr);
    const rows = it.rows, cols = it.cols;
    const wallW = cols * pitch;
    const xc = clamp(it.side * 0.2 * hwL, -(hwL - 1 - wallW / 2), hwL - 1 - wallW / 2);
    const mid = Math.floor(cols / 2);
    let goldLeft = it.gold || 0, ironLeft = it.iron || 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let kind = 'plain';
        if (ironLeft > 0 && r === 1 && (cols >= 3 ? Math.abs(c - mid) <= 1 : c === mid)) { kind = 'iron'; ironLeft--; }
        else if (goldLeft > 0 && r === rows - 1 && (c === 0 || c === cols - 1)) { kind = 'gold'; goldLeft--; }
        const x = xc + (c - (cols - 1) / 2) * pitch;
        this.crateAt(x, it.start + 8 + r * pitch, kind === 'iron' ? tr * 1.25 : kind === 'gold' ? tr * 1.15 : tr, kind, pr);
      }
    }
    this.zones.push({ d0: it.start - 4, d1: it.start + it.len + 8, kind: 'crates' });
    return it.len;
  }

  // half-width ice wall (a mini gate): break it when big enough, slide around it through the open side otherwise
  // HEYKEL YIKIMI: giant snow statues staggered down the slope; smash each (size label) for growth, the whole set pays a bonus.
  // Too big for you = you glance off (the normal deflect), never stopped.
  placeStatues(it, gr, hw) {
    const kinds = [['snowman', 'KARDAN ADAM'], ['yeti', 'YETİ'], ['snowman', 'DEV KARDAN ADAM'], ['yeti', 'YETİ KRALI'], ['boulder', 'KAYA HEYKEL']];
    const n = it.count, set = { total: n, got: 0, done: false };
    for (let i = 0; i < n; i++) {
      const [type, name] = kinds[i % kinds.length];
      const def = this.lib[type] || this.lib.snowman;
      if (!def) continue;
      const t = n === 1 ? 0.5 : i / (n - 1);
      const tr = gr * (0.7 + 0.85 * t);
      const s = clamp(tr / def.radius, 0.3, 24);
      const hwL = this.halfWidth(it.start + 10 + i * 12);
      const x = clamp((i % 2 ? 1 : -1) * it.side * hwL * 0.42, -hwL + 1, hwL - 1);
      const p = this.add(this.lib[type] ? type : 'snowman', x, it.start + 8 + i * (it.len - 16) / Math.max(1, n - 1), { s, rot: Math.PI, tonK: 2 });
      if (!p) continue;
      p.statue = { name, set };
      this.tagObstacle(p, '🗿 ' + name + ' · ' + fmtDiam(p.r / CFG.smashRatio * 2) + ' m');
    }
    this.zones.push({ d0: it.start - 4, d1: it.start + it.len + 6, kind: 'plus' });
    return it.len;
  }

  // DOMİNO ÇAM: a row of pines across the slope; smash one and the whole row topples in a chain (see topple / updateFalls).
  placeDomino(it, gr, hw) {
    const def = this.lib.pine; if (!def) return it.len;
    const n = 7, d = it.start + it.len * 0.5, hwL = this.halfWidth(d);
    const row = { trees: [], n, got: 0, hit: false };
    const s = clamp(gr * 0.5 / def.radius, 0.3, 24);
    const span = Math.min(hwL - 2, Math.max(8, def.radius * s * 2.6 * (n - 1) / 2));
    for (let i = 0; i < n; i++) {
      const x = -span + (2 * span) * i / (n - 1);
      const p = this.add('pine', x, d + (i % 2 ? 0.8 : -0.8), { s, rot: this.rng.range(0, 6.28), tonK: 1.5 });
      if (!p) continue;
      p.domino = { row, i };
      row.trees.push(p);
    }
    row.n = row.trees.length;
    this.zones.push({ d0: it.start - 4, d1: it.start + it.len + 6, kind: 'plus' });
    return it.len;
  }

  // KARDAN ADAM TAHTI: a tall stack of snowman blocks in a side area, crowned on top. Hitting any block topples everything above it
  // (see CigGame._throneStart); each fallen block = growth + combo, the crown = bonus + star goal. Never blocks the main path.
  placeThrone(it, gr, hw) {
    const def = this.lib.snowman; if (!def) return it.len;
    const d = it.start + it.len * 0.5, hwL = this.halfWidth(d);
    const tw = { blocks: [], n: 5, got: 0, hit: false, done: false };
    const s0 = clamp(gr * 0.55 / def.radius, 0.3, 24);
    const x = clamp(it.side * hwL * 0.62, -hwL + s0 * def.radius + 1, hwL - s0 * def.radius - 1);
    let y = 0;
    for (let i = 0; i < tw.n; i++) {
      const s = s0 * (1 - i * 0.1);
      const p = this.add('snowman', x + (i % 2 ? 0.25 : -0.25) * s0, d + i * 0.02, { s, rot: this.rng.range(0, 6.28), tonK: 1.3 });
      if (!p) continue;
      p.y += y; y += p.h * 0.85;
      _p.set(p.x, p.y, -p.d); _q.setFromAxisAngle(_up, p.rot); _s.setScalar(p.s); _m.compose(_p, _q, _s); _m.toArray(p.m);
      p.throne = { tw, i };
      p.tint = i === tw.n - 1 ? [1.5, 1.3, 0.55] : i % 2 ? [1.05, 1.18, 1.5] : [1.4, 1.4, 1.45];
      tw.blocks.push(p);
    }
    const top = tw.blocks[tw.blocks.length - 1];
    if (top) {
      // visual dressing (hidden by CigPlus._throneStart when the tower topples): blue/white outlines, faces, gold crown, glow + light pillar
      const deco = new THREE.Group(); tw.deco = deco;
      const gold = new THREE.MeshBasicMaterial({ color: 0xffc933, fog: false });
      const dark = new THREE.MeshBasicMaterial({ color: 0x14202e });
      const orange = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
      for (let i = 0; i < tw.blocks.length; i++) {
        const p = tw.blocks[i], cy = p.y + p.h * 0.5, R = p.r || p.h * 0.5;
        const ol = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 14, 10), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x4aa8ff : 0xffffff, side: THREE.BackSide }));
        ol.position.set(p.x, cy, -p.d); deco.add(ol);
        const fz = -p.d + R * 0.92;
        for (const sx of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(R * 0.09, 8, 6), dark);
          eye.position.set(p.x + sx * R * 0.26, cy + R * 0.2, fz - R * 0.1); deco.add(eye);
        }
        const nose = new THREE.Mesh(new THREE.ConeGeometry(R * 0.08, R * 0.38, 8), orange);
        nose.rotation.x = Math.PI / 2; nose.position.set(p.x, cy + R * 0.02, fz + R * 0.1); deco.add(nose);
      }
      const R = top.r || top.h * 0.5, ty = top.y + top.h;
      const crown = new THREE.Group(); crown.position.set(top.x, ty + R * 0.12, -top.d);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.5, R * 0.3, 12), gold); band.position.y = R * 0.15; crown.add(band);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * 6.283, sp = new THREE.Mesh(new THREE.ConeGeometry(R * 0.13, R * 0.4, 6), gold);
        sp.position.set(Math.cos(a) * R * 0.45, R * 0.5, Math.sin(a) * R * 0.45); crown.add(sp);
      }
      const glowM = new THREE.MeshBasicMaterial({ color: 0xffd860, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(R * 1.4, 12, 8), glowM); glow.position.y = R * 0.3; crown.add(glow);
      deco.add(crown);
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.35, R * 0.7, 70, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd860, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      pil.position.set(top.x, ty + 35, -top.d); pil.frustumCulled = false; pil.renderOrder = 4; deco.add(pil);
      tw.crownPos = { x: top.x, y: ty, d: top.d, r: R };
      (this.thrones || (this.thrones = [])).push(tw);
      this.group.add(deco);
    }
    if (top) this.tagObstacle(top, '👑 TAHT · YIK!');
    tw.n = tw.blocks.length;
    this.zones.push({ d0: it.start - 4, d1: it.start + it.len + 6, kind: 'plus' });
    return it.len;
  }

  // Topple one pine of a domino row: it leaves the static list and falls as a visual proxy after `delay` seconds.
  topple(p, delay, dir) {
    if (!p.alive) return;
    p.alive = false;
    this.falls.push({ type: p.type, def: p.def, kind: p.kind, x: p.x, y: p.y, d: p.d, rot: p.rot, s: p.s, r: p.r, h: p.h,
      t: 0, delay, dur: 0.55, dir, fired: false, p, tint: null });
  }

  updateFalls(dt) {
    const a = this.falls;
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      const q = a[i];
      q.t += dt;
      if (!q.fired && q.t >= q.delay) { q.fired = true; if (this.onTopple) this.onTopple(q.p); }
      if (q.t < q.delay + q.dur + 3.5) a[n++] = q;
    }
    a.length = n;
  }

  // GİZLİ KAR TÜNELİ: a cracked ice wall hugging the slope edge. CigGame._breakCrate opens the bonus lane (openSecret) when it breaks.
  placeSecret(it, gr, hw) {
    const d = it.start + 10, pr = planAt(this.lvl, d), hwL = this.halfWidth(d + 8);
    const rad = clamp(1.3 * crateRadius(pr), 1.3, 4.2);
    const x = it.side * (hwL - rad * 0.8);
    const p = this.crateAt(x, d, rad, 'iron', pr);
    if (!p) return it.len;
    p.crate.secret = { side: it.side, gr, pr, open: false };
    p.tint = SECRET_DIM.slice();
    this.tagObstacle(p, '❄ ÇATLAK BUZ · ' + fmtDiam(2 * p.crate.need) + ' m');
    this.secrets.push(p);
    // a few crumbs along the edge as a hint
    const T = tierOf(gr);
    for (let i = 0; i < 4; i++) this.food1(clamp(this.rollQ(T) * 0.8, 0.12, 0.5), gr, x - it.side * (rad + 1.2), d - 18 + i * 4, hwL, { spacing: 0.1 });
    this.zones.push({ d0: it.start - 4, d1: it.start + it.len, kind: 'plus' });
    return it.len;
  }

  // the wall broke: a 60-80 m lane of gold crates and food along the same edge (it rejoins the slope at the end)
  openSecret(p) {
    const s = p.crate.secret, R = this.rng;
    if (!s || s.open) return 0;
    s.open = true;
    const len = R.int(62, 80), T = tierOf(s.gr), ct = Math.min(3.4, 0.55 * s.pr) * 1.15;
    let n = 0;
    for (let i = 0; i < 16; i++) {
      const d = p.d + 8 + i * ((len - 12) / 15), hwL = this.halfWidth(d);
      const x = s.side * (hwL - clamp(0.9 * s.gr + 1.2, 2, hwL * 0.5)) + Math.sin(i * 0.7) * 0.6;
      if (i % 5 === 2) { if (this.crateAt(clamp(x, -hwL + ct + 0.5, hwL - ct - 0.5), d, ct, 'gold', s.pr)) n++; }
      else this.food1(clamp(this.rollQ(T) * 0.9, 0.12, 0.7), s.gr, x, d, hwL, { spacing: 0.1 });
    }
    return len;
  }

  placeIceWall(it, gr, hw) {
    const gd = it.start + 24;
    const hwL = Math.max(hw, this.halfWidth(gd));
    const need = Math.max(3.2 * gr + 2, 4);
    let w = 2 * hwL * it.cover;
    if (2 * hwL - w < need) w = Math.max(4, 2 * hwL - need);
    const x0 = it.side > 0 ? hwL - w : -hwL, x1 = x0 + w;
    this.buildGate(gd, it.minR, hwL, { mini: true, x0, x1, skin: 'ice', i: -1 });
    this.zones.push({ d0: it.start - 4, d1: gd + 14, kind: 'gate' });
    // snacks along the open side: going around is a real, rewarded choice
    const gx = it.side > 0 ? (-hwL + x0) / 2 : (x1 + hwL) / 2;
    const T = tierOf(gr);
    for (let i = 0; i < 6; i++) this.food1(clamp(this.rollQ(T) * 0.8, 0.12, 0.6), gr, gx + Math.sin(i * 1.1) * Math.min(2, need * 0.2), gd - 14 + i * 5, hwL, { spacing: 0.1 });
    return it.len;
  }

  // boss arena: the boss waits in front of the locked final gate (CigGame._arenaAI drives it)
  placeArena(it, gr, T, hw) {
    const P = this.lvl;
    const defs = this.enemyDefs();
    const def = defs.find((e) => e.id === it.boss) || defs.find((e) => e.id === 'yeti') || defs[defs.length - 1];
    if (!def) return 100;
    const p = this.makeEnemy(def, 0, P.dF - 30, P.bossR, true);
    if (p) {
      const e = p.enemy;
      e.hp = e.max = P.finale.hp * 0.8;   // (the boss takes less outside its stun window, see CigGame._hitEnemy)
      e.ai = 'arena';
      e.arena = { d0: P.dF - 170, d1: P.dF - 10 };
      e.spd = 7 * (P.n >= 20 ? 1.3 : 1);
      e.name = P.n === 30 ? 'KIŞ KRALI' : P.n === 20 ? 'YETİ KRALI' : it.boss === 'robot' ? 'DEV ROBOT' : it.boss === 'golem' ? 'BUZ GOLEMİ' : 'DEV YETİ';
      e.woke = false;
      this.bossProp = p;
    }
    this.zones.push({ d0: P.dF - 175, d1: P.dF + 20, kind: 'boss' });
    return 100;
  }

  // the finish line: a checkered strip + two pylons + a flag label
  addFinish(d) {
    const hw = Math.max(this.halfWidth(d), this.halfWidth(d - 30));
    const pitch = Math.max(2.4, hw / 18);
    const cols = Math.ceil((2 * hw) / pitch);
    for (let i = 0; i < cols; i++) {
      for (let r = 0; r < 2; r++) {
        const x = -hw + pitch * (i + 0.5);
        this.boxItems.push({ x, y: this.groundY(x, d) + 0.1, d: d + (r - 0.5) * pitch, sx: pitch * 0.98, sy: 0.16, sz: pitch * 0.98, rot: 0, rx: 0, color: (i + r) % 2 ? 0x1c2430 : 0xffffff, alive: true });
      }
    }
    const tier = this.lvl ? Math.min(4, this.lvl.tierCap) : 1;
    this.addArch(d, hw, tier);
    const spr = this.makeLabel('🏁 FİNİŞ', '#2fd36b');
    if (spr) {
      const lw = clamp(hw * 0.7, 12, 50);
      spr.scale.set(lw, lw * 0.3, 1);
      spr.position.set(0, this.groundY(0, d) + 7 + tier * 3.2 + lw * 0.2, -d);
      this.group.add(spr);
    }
  }

  // Snow chunks along the line x, d0..d1 totalling vol (sum of chunk radius^3): the rescue after a bounce. Chunks that do not fit
  // under the live-chunk cap hand their share to the others, so the volume is not lost.
  supplyChunks(x, d0, d1, vol, n) {
    let rem = vol;
    const hw = this.halfWidth((d0 + d1) / 2);
    for (let i = 0; i < n; i++) {
      const k = n - i;
      const cr = Math.max(0.12, Math.cbrt(Math.max(1e-6, rem) / k));
      const t = (i + 0.5) / n;
      const p = this.spawnChunk(clamp(x + Math.sin(i * 1.3) * Math.min(1.2, hw * 0.1), -hw + 1, hw - 1), d0 + (d1 - d0) * t, cr);
      if (p) rem -= cr ** 3;
    }
  }

  // Floating "⛔ X m" tag above a too-big obstacle (used for the first few the player meets).
  tagObstacle(p, text) {
    if (p.tag) return;
    const spr = this.makeLabel(text, '#ff5a4a');
    if (!spr) return;
    p.tag = spr;
    const lw = clamp(p.r * 1.3, 2.6, 22);
    spr.scale.set(lw, lw * 0.3, 1);
    spr.position.set(p.x, p.y + p.h + lw * 0.22, -p.d);
    this.group.add(spr);
    this.labels = this.labels || [];
    this.labels.push(p);
  }

  // ---- tier-up: the slope widens, new-tier food drops right ahead ----
  setTier(t, ballD) {
    if (this.lvl || t <= this.curTier) return;
    this.curTier = t;
    this.widen(Math.max(CFG.tierWidth[Math.min(t, CFG.tierWidth.length - 1)] / 2, this.ballR * 5.2), ballD, true);
  }

  // The slope keeps up with the ball: wide enough that the ball is ~1/5 of it, whatever its size.
  growWidth(ballD) {
    if (this.lvl) return;
    const last = this.trans.length ? this.trans[this.trans.length - 1].to : this.hw0;
    const want = Math.max(CFG.tierWidth[Math.min(this.curTier, CFG.tierWidth.length - 1)] / 2, this.ballR * 5.2);
    if (want < last * 1.15 || ballD < (this._lastWiden || 0) + 30) return;
    this._lastWiden = ballD;
    this.widen(want, ballD, false);
  }

  widen(to, ballD, arch) {
    const t = this.curTier;
    const from = this.trans.length ? this.trans[this.trans.length - 1].to : this.hw0;
    const gr = this.genRad();
    const lead = Math.max(CFG.widthLead, gr * 9);
    const blend = Math.max(CFG.widthBlend, gr * 6);
    let d0 = ballD + lead;
    if (this.trans.length) d0 = Math.max(d0, this.trans[this.trans.length - 1].d1 + 4);
    this.trans.push({ d0, d1: d0 + blend, from, to, tier: t, scale: Math.max(DECOR_SCALE[Math.min(t, 4)], gr / 3.3) });
    // scenery beyond the start of the widening is re-decorated for the new width
    const cut = lbD(this.decor, d0 - 10);
    this.decor.length = Math.min(this.decor.length, cut);
    this.decorD = Math.min(this.decorD, d0 - 10);
    this.markDirty(d0 - CH);
    if (arch) this.addArch(d0 + blend, to, t);
    // welcome food, then fill the new strip of slope
    const T = tierOf(gr);
    const hw = this.halfWidth(ballD + 55);
    const wd = ballD + 42;
    for (let i = 0; i < 3; i++) this.food1(this.rng.range(0.45, 0.7), gr, this.rng.range(-hw * 0.6, hw * 0.6), wd + i * 9, hw);
    for (let i = 0; i < 9; i++) this.food1(clamp(this.rollQ(T), 0.15, 0.55), gr, this.rng.range(-hw * 0.7, hw * 0.7), wd + this.rng.range(0, 34), hw, { spacing: 0.1 });
    this.food1(this.rng.range(0.72, 0.84), gr, this.rng.range(-hw * 0.3, hw * 0.3), wd + 24, hw);
    if (this.genD > d0) {
      for (let dd = d0; dd < this.genD; dd += segLen(gr)) {
        const hwd = this.halfWidth(dd + 20);
        const inner = this.halfWidth(d0 - 1);
        if (hwd > inner + 1) this.regular(dd, segLen(gr), gr, T, hwd, inner);
      }
    }
  }

  // Zone border: two striped pylons at the end of the widening + a coloured line across the new slope.
  addArch(d, hw, tier) {
    const H = 7 + tier * 3.2;
    const w = 1.6 + tier * 0.5;
    const cols = [0xff6a2a, 0x2f7dff, 0xffc83a, 0xb066ff, 0xff4fd8];
    const a = { d, hw, tier, items: [] };
    for (const sd of [-1, 1]) {
      const x = sd * (hw + w);
      const gy = this.groundY(x, d);
      for (let i = 0; i < 4; i++) {
        const it = { x, y: gy + (H / 4) * (i + 0.5), d, sx: w, sy: H / 4, sz: w, rot: 0, rx: 0, color: i % 2 ? 0xffffff : cols[Math.min(tier, 4)], alive: true };
        a.items.push(it); this.boxItems.push(it);
      }
      const cap = { x, y: gy + H + w * 0.4, d, sx: w * 1.4, sy: w * 0.8, sz: w * 1.4, rot: 0, rx: 0, color: 0x1f3a66, alive: true };
      a.items.push(cap); this.boxItems.push(cap);
    }
    this.arches.push(a);
  }

  // ===================================================================== decor (banks)
  genDecor() {
    const R = this.rngD;
    const d = this.decorD;
    const T = this.tierAtD(d);
    const ts = this.scaleAtD(d);
    const dense = this.lvl && this.lvl.n <= 8;
    const step = (2.6 + this.ballR * 0.5) * ts * (dense ? 0.55 : 1);
    this.decorD = d + step * R.range(0.8, 1.25);
    if (!this.decorPool.length) return;
    const hw = this.halfWidth(d);
    for (const side of [-1, 1]) {
      if (R.chance(dense ? 0.04 : 0.14)) continue;
      const off = R.range(1.2, dense ? 22 : 30) * ts;
      const near = off < 7 * ts;
      const tr = ts * (near ? R.range(1.2, 2.6) : off < 18 * ts ? R.range(2.2, 4.8) : R.range(4.5, 9));
      const e = this.pick(this.decorPool, tr, 0.6, 1.7);
      if (!e) continue;
      const s = clamp(tr / e.r * R.range(0.92, 1.18), 0.3, 8);
      const x = side * (hw + off + e.r * s * 0.4 + 1.2);
      if (Math.abs(x) > edgeFor(hw) - 4) continue;
      this.add(e.type, x, d + R.range(-1, 1) * step * 0.4, { s, decor: true });
    }
  }

  // ===================================================================== shared meshes: chunks, boxes, poles
  buildShared() {
    // snow chunk (knocked-off snow, always edible)
    const cgeo = new THREE.IcosahedronGeometry(1, 0);      // (already non-indexed: no toNonIndexed() warning)
    const col = new Float32Array(cgeo.attributes.position.count * 3);
    _c.setHex(0xf6faff);
    for (let i = 0; i < col.length; i += 3) { col[i] = _c.r; col[i + 1] = _c.g; col[i + 2] = _c.b; }
    cgeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cgeo.translate(0, 0.8, 0);
    cgeo.computeBoundingSphere();
    this.chunkDef = { name: 'chunk', geometry: cgeo, radius: 1, height: 2, tier: 0, kind: 'chunk' };
    this.lib.chunk = this.chunkDef;

    // generic box (gate blocks, zone pylons): unit cube, per-instance colour
    const bgeo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const bcol = new Float32Array(bgeo.attributes.position.count * 3).fill(1);
    bgeo.setAttribute('color', new THREE.BufferAttribute(bcol, 3));
    this.boxMesh = new THREE.InstancedMesh(bgeo, this.mat, 420);
    this.boxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boxMesh.setColorAt(0, _c.setHex(0xffffff));
    this.boxMesh.frustumCulled = false;
    this.boxMesh.count = 0;
    this.group.add(this.boxMesh);

    // piste poles marking the track edge
    const pgeo = new THREE.CylinderGeometry(0.09, 0.09, 1.8, 5).translate(0, 0.9, 0);
    this.poleMesh = new THREE.InstancedMesh(pgeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 96);
    this.poleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.poleMesh.setColorAt(0, _c.setHex(0xff6a2a));
    this.poleMesh.frustumCulled = false;
    this.poleMesh.count = 0;
    this.group.add(this.poleMesh);
    this.poleA = new THREE.Color(0xff6a2a); this.poleB = new THREE.Color(0x2f7dff);
  }

  getMesh(type) {
    let mesh = this.meshes[type];
    if (mesh) return mesh;
    const def = this.lib[type];
    mesh = new THREE.InstancedMesh(def.geometry, this.mat, MESH_CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MESH_CAP * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.userData.prev = 0;
    this.meshes[type] = mesh;
    this.meshList.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  // ===================================================================== terrain chunks (pooled)
  initTerrain() {
    this.chunks = new Map();
    this.chunkPool = [];
    const idx = new Uint32Array(NR * (NC - 1) * 6);
    let k = 0;
    for (let j = 0; j < NR; j++) {
      for (let i = 0; i < NC - 1; i++) {
        const a = j * NC + i, b = a + 1, c = a + NC, dd = c + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = dd; idx[k++] = c; // counter-clockwise from above
      }
    }
    this.terrIndex = new THREE.BufferAttribute(idx, 1);
    this.cSnow = new THREE.Color(0xf4f8ff); this.cShade = new THREE.Color(0xdde8f6); this.cBank = new THREE.Color(0xe2ecf8);
    this.cDirt = new THREE.Color(0x8a6447); this.cGrass = new THREE.Color(0x6f9a52);
  }

  newChunk() {
    const pos = new Float32Array((NR + 1) * NC * 3);
    const col = new Float32Array((NR + 1) * NC * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(this.terrIndex);
    const mesh = new THREE.Mesh(geo, this.snowMat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, geo, pos, col, k: -9999, stale: false };
  }

  colX(i, hw) {
    const E = edgeFor(hw);
    if (i < NB) return -(hw + BANK_F[i] * (E - hw));
    if (i <= NB + NCI) return -hw + (2 * hw * (i - NB)) / NCI;
    return hw + BANK_F[NB - 1 - (i - NB - NCI - 1)] * (E - hw);
  }

  fillChunk(ch, k) {
    ch.k = k;
    ch.stale = false;
    const d0 = k * CH;
    const { pos, col } = ch;
    const c = _c;
    let o = 0;
    for (let j = 0; j <= NR; j++) {
      const d = d0 + j * ROW;
      const hw = this.halfWidth(d);
      // zone borders: a coloured line across the track where the slope starts to widen
      let zone = 0;
      for (let t = 0; t < this.trans.length; t++) {
        const dz = Math.abs(d - this.trans[t].d1);
        if (dz < 2.4) zone = Math.max(zone, 1 - dz / 2.4);
      }
      for (let i = 0; i < NC; i++) {
        const x = this.colX(i, hw);
        pos[o] = x; pos[o + 1] = this.groundY(x, d); pos[o + 2] = -d;
        const ax = Math.abs(x) - hw;
        if (ax > 0.001) c.copy(this.cBank).lerp(this.cShade, Math.min(1, 0.5 + 0.5 * Math.sin(d * 0.07 + x))).lerp(this.cSnow, Math.max(0, 1 - ax / 6));
        else c.copy(this.cSnow).lerp(this.cShade, 0.25 + 0.25 * Math.sin(x * 0.7 + d * 0.21));
        for (let q = 0; q < this.patches.length; q++) {
          const p = this.patches[q];
          const a = (x - p.x) / (p.rx + 1.5), b = (d - p.d) / (p.rd + 1.5);
          const qq = a * a + b * b;
          if (qq < 1) c.copy(qq < 0.6 ? this.cDirt : this.cGrass).lerp(this.cDirt, Math.sin(x * 3 + d) * 0.3 + 0.3);
        }
        if (zone > 0 && ax < 0.5) c.lerp(_c2.setHex(0x7fd0ff), zone * 0.8);
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
        o += 3;
      }
    }
    ch.geo.attributes.position.needsUpdate = true;
    ch.geo.attributes.color.needsUpdate = true;
    ch.geo.computeVertexNormals();
    ch.geo.computeBoundingSphere();
  }

  syncTerrain(ballD, ahead, behind, unlimited = false) {
    const kMin = Math.max(-1, Math.floor((ballD - behind - 10) / CH));
    const kMax = Math.floor((ballD + ahead) / CH);
    // release chunks out of range (chunk.k is its index; iterating values() allocates no entry arrays)
    for (const ch of this.chunks.values()) {
      const k = ch.k;
      if (k < kMin || k > kMax) { this.chunks.delete(k); this.chunkPool.push(ch); ch.mesh.visible = false; }
    }
    let budget = unlimited ? 99 : 2;
    for (let k = kMin; k <= kMax && budget > 0; k++) {
      let ch = this.chunks.get(k);
      if (!ch) {
        ch = this.chunkPool.pop() || this.newChunk();
        ch.mesh.visible = true;
        this.chunks.set(k, ch);
        this.fillChunk(ch, k);
        budget--;
      } else if (ch.stale) {
        this.fillChunk(ch, k);
        budget--;
      }
    }
  }

  // The ground changed (slope widened, patch added): chunks reaching past `d` get rebuilt over the next frames.
  markDirty(d) {
    for (const ch of this.chunks.values()) if ((ch.k + 1) * CH > d) ch.stale = true;
  }

  buildRampMesh(r) {
    const pos = [], col = [];
    const white = new THREE.Color(0xffffff), blue = new THREE.Color(0x4aa8ff), orange = new THREE.Color(0xff7a2f);
    const pink = new THREE.Color(0xff4fd8), cyan = new THREE.Color(0x3fe0ff), yellow = new THREE.Color(0xffe03a), violet = new THREE.Color(0x6a3df0);
    const push = (x, y, d, c) => { pos.push(x, y, -d); col.push(c.r, c.g, c.b); };
    const n = 8;
    const surf = (x, u) => this.groundY(x, r.d + u) + r.h * Math.pow(u / r.len, 1.4);
    const xl = r.x - r.w / 2, xr = r.x + r.w / 2;
    for (let i = 0; i < n; i++) {
      const u0 = (i / n) * r.len, u1 = ((i + 1) / n) * r.len;
      const c = r.flip ? (i >= n - 1 ? yellow : i % 2 ? pink : cyan) : (i >= n - 1 ? orange : i % 2 ? white : blue);
      push(xl, surf(xl, u0), r.d + u0, c); push(xr, surf(xr, u0), r.d + u0, c); push(xl, surf(xl, u1), r.d + u1, c);
      push(xr, surf(xr, u0), r.d + u0, c); push(xr, surf(xr, u1), r.d + u1, c); push(xl, surf(xl, u1), r.d + u1, c);
      const sc = r.flip ? violet : blue;
      for (const x of [xl, xr]) {
        const g0 = this.groundY(x, r.d + u0) - 0.3, g1 = this.groundY(x, r.d + u1) - 0.3;
        push(x, g0, r.d + u0, sc); push(x, surf(x, u0), r.d + u0, sc); push(x, g1, r.d + u1, sc);
        push(x, surf(x, u0), r.d + u0, sc); push(x, surf(x, u1), r.d + u1, sc); push(x, g1, r.d + u1, sc);
      }
    }
    const u = r.len;
    const lc = r.flip ? pink : orange;
    push(xl, this.groundY(xl, r.d + u) - 0.3, r.d + u, lc); push(xl, surf(xl, u), r.d + u, lc); push(xr, surf(xr, u), r.d + u, lc);
    push(xl, this.groundY(xl, r.d + u) - 0.3, r.d + u, lc); push(xr, surf(xr, u), r.d + u, lc); push(xr, this.groundY(xr, r.d + u) - 0.3, r.d + u, lc);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    if (!this.rampMat) this.rampMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), { snow: true });
    r.mesh = new THREE.Mesh(geo, this.rampMat);
    r.mesh.frustumCulled = false;
    this.group.add(r.mesh);
  }

  // ===================================================================== streaming
  stream(ballD, ahead, behind, unlimited = false) {
    // content must reach as far as the fog lets you see, or props pop in on a big ball (the camera rises with the radius)
    const contentAhead = clamp(140 + 20 * this.ballR, 150, 900);
    let n = 0;
    while (this.genD < ballD + contentAhead && (unlimited || n++ < 5)) this.genSegment();
    n = 0;
    const decorAhead = Math.max(ahead, contentAhead) + 20;
    while (this.decorD < ballD + decorAhead && (unlimited || n++ < 10)) this.genDecor();
    this.syncTerrain(ballD, ahead, behind, unlimited);
    // recycle what is far behind
    this.cullT -= 1;
    if (this.cullT <= 0 || unlimited) {
      this.cullT = 45;
      const cut = ballD - behind - 70;
      let k = lbD(this.statics, cut);
      if (k > 0) this.statics.splice(0, k);
      k = lbD(this.decor, cut);
      if (k > 0) this.decor.splice(0, k);
      for (let i = this.ramps.length - 1; i >= 0; i--) {
        const r = this.ramps[i];
        if (r.d + r.len < cut) { if (r.mesh) { this.group.remove(r.mesh); r.mesh.geometry.dispose(); } this.ramps.splice(i, 1); }
      }
      for (let i = this.patches.length - 1; i >= 0; i--) if (this.patches[i].d + this.patches[i].rd < cut) this.patches.splice(i, 1);
      for (let i = this.heats.length - 1; i >= 0; i--) {
        const h = this.heats[i];
        if (h.d + h.rd < cut) { if (h.mesh) { this.group.remove(h.mesh); h.disc.geometry.dispose(); h.disc.material.dispose(); h.cm.dispose(); for (const c of h.cols) c.geometry.dispose(); } this.heats.splice(i, 1); }
      }
      for (let i = this.zones.length - 1; i >= 0; i--) if (this.zones[i].d1 < cut) this.zones.splice(i, 1);
      for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].d1 < cut) this.events.splice(i, 1);
      for (let i = this.gates.length - 1; i >= 0; i--) {
        const g = this.gates[i];
        if (g.d < cut) { if (g.label) { this.group.remove(g.label); g.label.material.map?.dispose(); g.label.material.dispose(); } this.gates.splice(i, 1); }
      }
      for (let i = this.arches.length - 1; i >= 0; i--) if (this.arches[i].d < cut) { for (const it of this.arches[i].items) it.alive = false; this.arches.splice(i, 1); }
      let w = 0;
      for (let i = 0; i < this.boxItems.length; i++) { const b = this.boxItems[i]; if (b.alive && b.d > cut) this.boxItems[w++] = b; }
      this.boxItems.length = w;
      if (this.labels) {
        for (let i = this.labels.length - 1; i >= 0; i--) {
          const p = this.labels[i];
          if (!p.alive || p.d < cut) { this.group.remove(p.tag); p.tag.material.map?.dispose(); p.tag.material.dispose(); p.tag = null; this.labels.splice(i, 1); }
        }
      }
    }
  }

  // ===================================================================== per frame
  update(dt, ballD, ahead = CFG.viewAhead, behind = CFG.viewBehind, ball = null) {
    this.ahead = ahead;
    this.behind = behind;
    this.time += dt;
    this.ballD = ballD;
    if (ball) { this.ballR = ball.r; this.ballX = ball.x; }
    this.growWidth(ballD);
    this.stream(ballD, ahead, behind);
    this.updateMovers(dt);
    this.pruneEnemies(ballD);
    if (ball) this.updatePulls(dt, ball);
    if (this.falls.length) this.updateFalls(dt);
    this.updateGateAnim(dt);
    if (this.heats.length) this.animateHeat(ballD);
    this.render(ballD);
  }

  pruneEnemies(ballD) {
    const a = this.enemies;
    let n = 0;
    for (let i = 0; i < a.length; i++) { const p = a[i]; if (p.alive && (p.d > ballD - 80 || (p.enemy && p.enemy.ai === 'arena'))) a[n++] = p; }
    a.length = n;
  }

  updateMovers(dt) {
    const t = this.time;
    const a = this.movers;
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      if (!p.alive) continue;
      if (p.move !== MOVE_CHUNK && p.d < this.ballD - this.behind - 90 && !(p.enemy && p.enemy.ai === 'arena')) { p.alive = false; continue; }
      if (p.kind === 'chunk' && p.d < this.ballD - 60) { p.alive = false; continue; }
      a[n++] = p;
      if (p.move === MOVE_SKI) {
        p.d += p.vd * dt;
        const hw = this.halfWidth(p.d);
        p.x = clamp(p.ox + Math.sin(t * 0.9 + p.phase) * 4, -hw + 1, hw - 1);
        p.rot = Math.PI + Math.cos(t * 0.9 + p.phase) * 0.5;
      } else if (p.move === MOVE_WANDER) {
        const ph = t * 0.5 + p.phase;
        p.x = p.ox + Math.sin(ph) * 2.5;
        p.d = p.od + Math.sin(ph * 0.7) * 2;
        p.rot = Math.atan2(Math.cos(ph) * 2.5, Math.cos(ph * 0.7) * -1.4);
      } else if (p.move === MOVE_CROSS) {
        p.x += p.vx * dt;
        if (p.x > 45) p.x = -45;
        if (p.x < -45) p.x = 45;
      }
      p.y = this.footY(p) - 0.05;
    }
    a.length = n;
  }

  // ---- visible suction ----
  // The prop leaves the slope immediately (alive = false) and flies as a pooled proxy: curved path, shrinking and
  // spinning toward the ball's surface; world.onArrive(proxy) is called when it sticks.
  pull(p, ball, dur) {
    if (this.pulls.length >= CFG.maxPulls) return false;
    const q = this.pullPool.pop() || { def: null };
    q.type = p.type; q.def = p.def; q.kind = p.kind; q.tier = p.tier; q.mass = p.mass; q.tonK = p.tonK || 1;
    q.s0 = p.s; q.s = p.s; q.r = p.r; q.h = p.h;
    q.x = p.x; q.y = p.y + p.h * 0.3; q.d = p.d; q.rot = p.rot;
    q.sx = p.x; q.sy = q.y; q.sd = p.d;
    q.t = 0; q.dur = Math.max(0.05, dur);
    // (cosmetic randomness only: never draw from the seeded generator, or the slope would depend on what you ate)
    q.spin = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 8);
    q.arc = (Math.random() - 0.5) * 2.2;
    q.lift = 0.6 + Math.random() * 0.6;
    p.alive = false;
    this.pulls.push(q);
    return true;
  }

  updatePulls(dt, ball) {
    const a = this.pulls;
    let n = 0;
    const bx = ball.x, by = ball.y, bd = ball.d, br = ball.r;
    for (let i = 0; i < a.length; i++) {
      const q = a[i];
      q.t += dt;
      const u = q.t / q.dur;
      if (u >= 1) {
        q.x = bx; q.y = by + br * 0.4; q.d = bd;
        if (this.onArrive) this.onArrive(q, bx, by, bd);
        q.def = null;
        this.pullPool.push(q);
        continue;
      }
      const e = u * u * (1.7 - 0.7 * u);          // ease-in: it hangs for a beat, then is sucked in
      // aim at the ball's surface (toward the prop), not the centre
      let dx = q.sx - bx, dz = q.sd - bd;
      const dl = Math.hypot(dx, dz) || 1;
      const tx = bx + (dx / dl) * br * 0.6, td = bd + (dz / dl) * br * 0.6, ty = by + br * 0.25;
      q.x = lerp(q.sx, tx, e) + (-dz / dl) * q.arc * Math.sin(u * Math.PI);
      q.d = lerp(q.sd, td, e) + (dx / dl) * q.arc * Math.sin(u * Math.PI);
      q.y = lerp(q.sy, ty, e) + Math.sin(u * Math.PI) * q.lift * Math.min(q.h, br * 1.5 + 1);
      q.s = q.s0 * (1 - 0.4 * u * u);   // ends at the 0.6 scale it sticks with: no size pop
      q.rot += q.spin * dt;
      a[n++] = q;
    }
    a.length = n;
  }

  updateGateAnim(dt) {
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (!g.broken) continue;
      g.t += dt;
      const fade = clamp(1 - (g.t - 0.1) / 0.5, 0, 1);   // blocks shrink away within ~0.6 s
      for (const c of g.cols) {
        if (!c.alive) continue;
        c.vy -= 24 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.d += c.vd * dt;
        c.rot += c.wy * dt; c.rx += c.wx * dt;
        c.k = fade;
        if (fade <= 0) c.alive = false;
      }
    }
  }

  // ===================================================================== rendering
  // Per-instance colour: white = edible, amber = almost (a little more snow and it is yours), red = far too big.
  // Only props within ~110 m ahead are tinted, fading in over the last 40 m so nothing pops.
  paintTint(mesh, i, p, ballD, tR, tE) {
    const a = mesh.instanceColor.array, o = i * 3;
    if (p.tint) {
      const f = p.enemy && p.enemy.flash > 0 ? 1 : 0;
      a[o] = f ? 1.6 : p.tint[0]; a[o + 1] = f ? 1.3 : p.tint[1]; a[o + 2] = f ? 1.3 : p.tint[2];
      return;
    }
    let g = 1, b = 1;
    if (tR > 0 && p.kind !== 'chunk') {
      const lim = tR * tE;
      if (p.r > lim) {
        const dd = p.d - ballD;
        if (dd < 110) {
          const f = dd < 70 ? 1 : (110 - dd) / 40;
          if (p.r > tR * CFG.smashRatio) { g = 1 - 0.42 * f; b = 1 - 0.46 * f; } else { g = 1 - 0.16 * f; b = 1 - 0.38 * f; }
        }
      }
    }
    a[o] = 1; a[o + 1] = g; a[o + 2] = b;
  }

  render(ballD) {
    if (this.camBack === undefined) { this.camBack = 12; this.camXlo = -2; this.camXhi = 2; }
    const meshes = this.meshList;
    for (let i = 0; i < meshes.length; i++) { meshes[i].userData.prev = meshes[i].count; meshes[i].count = 0; }
    const d0 = ballD - this.behind, d1 = ballD + this.ahead;
    const tR = this.tintR, tE = this.tintEat;
    const st = this.statics;
    for (let i = lbD(st, d0), n = lbD(st, d1); i < n; i++) {
      const p = st[i];
      if (!p.alive) continue;
      // keep decor out of the camera corridor (between camera and ball / bottom of the view)
      if (p.d < ballD - 0.3 && p.d > ballD - this.camBack * 1.7 - 3 && p.r > 0.5 && p.x > this.camXlo - 4 - p.r && p.x < this.camXhi + 4 + p.r) continue;
      const mesh = this.getMesh(p.type);
      if (mesh.count >= MESH_CAP) continue;
      mesh.instanceMatrix.array.set(p.m, mesh.count * 16);
      this.paintTint(mesh, mesh.count, p, ballD, tR, tE);
      mesh.count++;
    }
    const dc = this.decor;
    for (let i = lbD(dc, d0), n = lbD(dc, d1); i < n; i++) {
      const p = dc[i];
      if (!p.alive) continue;
      const mesh = this.getMesh(p.type);
      if (mesh.count >= MESH_CAP) continue;
      mesh.instanceMatrix.array.set(p.m, mesh.count * 16);
      this.paintTint(mesh, mesh.count, p, ballD, 0, tE);
      mesh.count++;
    }
    const mv = this.movers;
    for (let i = 0; i < mv.length; i++) {
      const p = mv[i];
      if (!p.alive || p.d < d0 || p.d > d1) continue;
      const mesh = this.getMesh(p.type);
      if (mesh.count >= MESH_CAP) continue;
      _p.set(p.x, p.y, -p.d);
      _q.setFromAxisAngle(_up, p.rot);
      _s.setScalar(p.s);
      _m.compose(_p, _q, _s);
      _m.toArray(mesh.instanceMatrix.array, mesh.count * 16);
      this.paintTint(mesh, mesh.count, p, ballD, tR, tE);
      mesh.count++;
    }
    const pl = this.pulls;
    for (let i = 0; i < pl.length; i++) {
      const p = pl[i];
      const mesh = this.getMesh(p.type);
      if (mesh.count >= MESH_CAP) continue;
      _p.set(p.x, p.y, -p.d);
      _q.setFromAxisAngle(_up, p.rot);
      _s.setScalar(p.s);
      _m.compose(_p, _q, _s);
      _m.toArray(mesh.instanceMatrix.array, mesh.count * 16);
      this.paintTint(mesh, mesh.count, p, ballD, 0, tE);
      mesh.count++;
    }
    const fl = this.falls;
    for (let i = 0; i < fl.length; i++) {
      const p = fl[i];
      if (p.d < d0 || p.d > d1) continue;
      const mesh = this.getMesh(p.type);
      if (mesh.count >= MESH_CAP) continue;
      const u = clamp((p.t - p.delay) / p.dur, 0, 1);
      const ang = p.fired ? (Math.PI / 2 - 0.12) * u * u * (3 - 2 * u) : 0;
      const sink = p.t > p.delay + p.dur + 2.5 ? (p.t - p.delay - p.dur - 2.5) * 0.8 : 0;
      _p.set(p.x, p.y - sink, -p.d);
      _q.setFromAxisAngle(_up, p.rot);
      _q2.setFromAxisAngle(_zax, -p.dir * ang);
      _q.premultiply(_q2);
      _s.setScalar(p.s);
      _m.compose(_p, _q, _s);
      _m.toArray(mesh.instanceMatrix.array, mesh.count * 16);
      this.paintTint(mesh, mesh.count, p, ballD, 0, tE);
      mesh.count++;
    }
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      mesh.visible = mesh.count > 0; // empty types cost no draw call
      if (!mesh.count && !mesh.userData.prev) continue;
      const k = Math.max(1, mesh.count);
      const attr = mesh.instanceMatrix;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, k * 16);
      attr.needsUpdate = true;
      const ic = mesh.instanceColor;
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, k * 3);
      ic.needsUpdate = true;
    }
    this.renderBoxes(d0, d1);
    this.renderPoles(ballD);
  }

  renderBoxes(d0, d1) {
    const mesh = this.boxMesh;
    let n = 0;
    const items = this.boxItems;
    for (let i = 0; i < items.length && n < 420; i++) {
      const b = items[i];
      if (!b.alive || b.d < d0 - 20 || b.d > d1 + 20) continue;
      const k = b.k === undefined ? 1 : b.k;
      _p.set(b.x, b.y, -b.d);
      _q.setFromAxisAngle(_up, b.rot);
      if (b.rx) { _q.multiply(_qx.setFromAxisAngle(_rx, b.rx)); }
      _s.set(b.sx * k, b.sy * k, b.sz * k);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, _c.setHex(b.color));
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  renderPoles(ballD) {
    const mesh = this.poleMesh;
    const d0 = ballD - this.behind * 0.6, d1 = ballD + Math.min(this.ahead, 340);
    let n = 0;
    const step = 14;   // fixed spacing: a tier-up must not shift every pole (only their size follows the zone)
    for (let d = Math.ceil(d0 / step) * step; d < d1 && n < 94; d += step) {
      const t = this.scaleAtD(d);
      const hw = this.halfWidth(d);
      for (let si = 0; si < 2; si++) {
        const side = si ? 1 : -1;
        const x = side * (hw + 0.6);
        _p.set(x, this.groundY(x, d), -d);
        _q.identity();
        _s.set(t, t, t);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n, _m);
        mesh.setColorAt(n, side < 0 ? this.poleA : this.poleB);
        n++;
      }
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // ===================================================================== queries
  // Collect live colliding props whose centres fall within `reach` of (x, d).
  query(x, d, reach, out) {
    out.length = 0;
    const st = this.statics;
    const pad = reach + this.maxPropR;
    const i1 = lbD(st, d + pad);
    for (let i = lbD(st, d - pad); i < i1; i++) {
      const p = st[i];
      if (p.alive && Math.abs(p.x - x) < reach + p.r) out.push(p);
    }
    const mv = this.movers;
    for (let i = 0; i < mv.length; i++) {
      const p = mv[i];
      if (p.alive && Math.abs(p.d - d) < reach + p.r && Math.abs(p.x - x) < reach + p.r) out.push(p);
    }
    return out;
  }

  // Snow knocked off the ball: lands ahead and can be re-collected (always edible).
  spawnChunk(x, d, r) {
    let live = 0;
    for (const p of this.movers) if (p.move === MOVE_CHUNK && p.alive && p.d > d - 40) live++;
    if (live >= 110) return null;
    const hw = this.halfWidth(d);
    const p = {
      type: 'chunk', def: this.chunkDef, x: clamp(x, -hw + 1, hw - 1), d, y: 0, rot: 0, s: r, r, h: r * 2,
      tier: 0, kind: 'chunk', mass: MASS.chunk * r * r * r * 20, alive: true, decor: false, move: MOVE_CHUNK, m: null,
      ox: x, od: d, vx: 0, vd: 0, phase: 0, tonK: 1, id: 0,
    };
    p.y = this.footY(p) - 0.05;
    this.movers.push(p);
    return p;
  }

  // A ball rolled across the track by a cannon (levels): small = white and edible, big = red and dangerous. CigGame._rollAI moves it.
  spawnRoller(x, d, r, vx, vd) {
    const def = this.lib.rival_ball;
    if (!def) return null;
    const p = this.add('rival_ball', x, d, { s: clamp(r / def.radius, 0.2, 40), rot: 0, move: MOVE_ENEMY, tonK: 2 });
    if (!p) return null;
    p.enemy = { id: 'roll', name: 'TOP', ai: 'roll', rival: true, roll: true, boss: false, hp: 1, max: 1, spd: 0, cd: 0, hitCd: 0, kbD: 0, kbX: 0, flash: 0, woke: true, tint: [1, 1, 1], rcd: 0, vx, vd };
    p.tint = p.enemy.tint;
    p.ox = x; p.od = d;
    this.enemies.push(p);
    return p;
  }

  kill(p) { p.alive = false; }

  dispose() {
    this.scene.remove(this.group);
    const shared = new Set();
    for (const k in this.lib) if (k !== 'chunk') shared.add(this.lib[k].geometry);
    this.group.traverse((o) => {
      if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); return; }
      if (!o.isMesh) return;
      if (o.isInstancedMesh) o.dispose();
      if (!shared.has(o.geometry)) o.geometry.dispose();
      if (o.material && o.material !== this.mat && o.material !== this.snowMat && o.material !== this.rampMat) { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.mat.dispose(); this.snowMat.dispose(); this.rampMat?.dispose();
    this.chunks.clear();
    delete this.lib.chunk;
  }
}

const _c2 = new THREE.Color();
const _qx = new THREE.Quaternion();
const _rx = new THREE.Vector3(1, 0, 0);

const GATE_SKIN = { ice: [0xbfdcf7, 0xd8ecff], wall: [0xc9b8a6, 0xb09a86], big: [0xffffff, 0xf1e6c8] };
const CRATE_PLAIN = [1, 1, 1], CRATE_IRON = [0.62, 0.68, 0.8], SECRET_DIM = [0.7, 0.9, 1.15];

// (re)draw a label sprite's canvas: dark pill, coloured outline, white text shrunk to fit
function drawLabel(spr, text, color) {
  const cv = spr.userData.cv;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 320, 96);
  g.fillStyle = 'rgba(20,28,48,0.78)';
  const r = 26;
  g.beginPath();
  g.moveTo(r, 4); g.lineTo(316 - r, 4); g.quadraticCurveTo(316, 4, 316, r); g.lineTo(316, 92 - r); g.quadraticCurveTo(316, 92, 316 - r, 92);
  g.lineTo(r, 92); g.quadraticCurveTo(4, 92, 4, 92 - r); g.lineTo(4, r); g.quadraticCurveTo(4, 4, r, 4);
  g.closePath(); g.fill();
  g.lineWidth = 5; g.strokeStyle = color; g.stroke();
  let fs = 54;
  g.font = '800 ' + fs + 'px system-ui, -apple-system, Segoe UI, sans-serif';
  while (fs > 26 && g.measureText(text).width > 270) { fs -= 2; g.font = '800 ' + fs + 'px system-ui, -apple-system, Segoe UI, sans-serif'; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(text, 160, 52);
  spr.material.map.needsUpdate = true;
}

function fmtDiam(d) {
  if (d >= 10) return String(Math.round(d));
  return (Math.round(d * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '');
}
export { fmtDiam };

// First index whose d >= v in a d-sorted array.
function lbD(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].d < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Keep a d-sorted array sorted after pushing p (it is nearly always the last or second-to-last).
function insertSorted(a, p) {
  let i = a.length;
  a.push(p);
  while (i > 0 && a[i - 1].d > p.d) { a[i] = a[i - 1]; i--; }
  a[i] = p;
}

function averageColor(geo) {
  const col = geo.attributes.color;
  if (!col) return new THREE.Color(0xcccccc);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < col.count; i++) { r += col.getX(i); g += col.getY(i); b += col.getZ(i); }
  return new THREE.Color(r / col.count, g / col.count, b / col.count);
}
