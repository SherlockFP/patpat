import * as THREE from 'three';
import { Track, flightDist, LANES, setLanes } from './track.js';
import { Obstacles } from './obstacles.js';
import { ABILITIES, SKINS } from '../skins.js';
import { Environment, biomeAt, trackPalette, musicStyleAt } from './biomes.js';
import * as Biomes from './biomes.js';
import { BuffSet, BUFFS, rollBuff, BUFF_LEN, DESTRUCTION, destructionTier } from './perks.js';
import { music } from './music.js';
import { RhythmLane } from './rhythm.js';
import { patchMaterial } from '../shaders.js';
import { gustAt, scoreMult, chainBonus, dangerBonus, checkpointReward, rageScale, goalFor, meltRate } from './goals.js';

// YETİ RUSH — endless Temple-Run-style downhill run (RUNNER.md).
// Core loop: the ball's SIZE is its health AND its hunger. It melts all the time; snow piles refill it, so you steer for
// snow trails as much as away from obstacles. Crashing knocks a layer off and opens a STUMBLE window (the Yeti is right
// behind you): crash again inside it and the Yeti catches you. Head-on hits with the big solid things (rock, cabin, cars, wall)
// end the run at once (a shield forgives one). Sharp junctions need a swipe toward the turn (miss = the barrier). Little
// critters can be stomped (Mario). Temporary buff cards arrive on their own — nothing ever pauses the game.
// Physics live in track-local coordinates: s along the path, u sideways (+right), h above the surface.
export const RCFG = {
  startSpeed: 14 * 1.1,
  maxSpeed: 48 * 1.1,    // asymptote of the late ramp (+10% pace)
  refSpeed: 30,          // "fast" for visuals (FOV, speed lines)
  speedPerM: 0.0065 * 1.1, // linear ramp up to speedKnee (+10% pace)
  speedKnee: 2000,
  speedTau: 3230,        // (maxSpeed - v(knee)) / speedPerM: slope continuous at the knee
  layerLen: 600,         // a new difficulty layer every 600 m (also a buff-card checkpoint)
  sizeSpeed: 0.025,      // top speed +2.5% per size tier
  hardRamp: 0.1,         // hardness grows by this much per layer (smoothly, every ~60 m)
  bpm0: 100,
  bpmMax: 150,
  bpmPerM: 0.012,
  accel: 7,
  gravity: 28,
  jumpV: 8.5,
  jumpPadV: 11,
  coyote: 0.12,
  jumpBuf: 0.15,         // a jump pressed this long before landing still fires at touchdown
  landTol: 0.45,         // m: a falling ball this close above the surface lands on it
  laneW: 2.4,            // 3 lanes at u = -2.4, 0, +2.4 (Subway Surfers style)
  laneStiff: 400,        // lane-change spring: ~0.2 s per lane at every speed
  diveV: -20,            // swipe down while airborne: slam back onto the snow (and duck on landing)
  // Size tiers = health. Index 0 is "about to burst". Max fits a lane (diameter 2.1 < 2.4).
  tierR: [0.45, 0.6, 0.75, 0.9, 1.05],
  pilesPerTier: [4, 6, 8, 11],   // snow piles needed to grow one tier (by current tier)
  smashMargin: 2,        // you must be this many sizes above an obstacle's toughness to plough through it
  smashCost: 0.08,       // growth lost per toughness point when smashing (not with the rocket / giant)
  crashSlow: 0.65,       // speed kept after a crash
  invulnAfterCrash: 1.0,
  // The Yeti: right behind you at the start and for a stumble window, otherwise it falls back off screen.
  yetiStart: 9,
  yetiHold: 2.5,         // seconds it stays right behind you at the start / after a revive
  yetiStumbleGap: 6,
  stumbleWin: 5.0,       // + 0.25 per layer (max 6); the Yeti catches only on the 3rd crash inside the window
  yetiMax: 16,
  yetiRecover: 2.0,      // m/s you pull away at full speed
  yetiStumbleSpeed: 0.8, // below this fraction of target speed you are not pulling away
  yetiH: 3.3,            // Yeti height in m
  wallMaxT: 1.3,         // s: a missed turn ends at the barrier at the latest after this long
  fallDeath: -5,         // m below the track plane over a real hole: the fall is final (quick — a fall must feel instant)
  fallDeep: 2.0,         // a ball this far below a SOLID surface is pulled up onto it (never a fall death), unless it really fell off a ledge
  helmetT: 20,
  sledCd: 45,
  // Hunger (melting). tiers per second = (meltBase + meltPerTier * tier) * (1 + meltGrow * min(1, s / meltRamp)).
  // Start = tier 2 + half a tier: a player who eats nothing melts away in about 45 s (eased in the v2 wave-1 QA pass: a decent bot
  // collecting snow still starved in 2 of 4 runs with 0.072 / 0.013 / 3 s grace).
  // The snow supply (obstacles._trails) offers ~0.3 tiers/s early, so collecting a quarter of it sustains you.
  meltBase: 0.055,
  meltPerTier: 0.010,
  meltGrow: 0.6,
  meltRamp: 4000,
  meltGrace: 4,          // s: no melting at the start of a run
  // Buff cards.
  buffFirst: [40, 45],   // first card gate of a run
  buffEvery: [65, 80],   // then one every ... seconds of play (~1200 m at mid-run speed; checkpoints no longer add one)
  // Junctions.
  juncMinSecs: 0.9,      // the turn window is never shorter than this (seconds at the current speed)
  // Head-on hits with the BIG solid things (rock, cabin, snow car, oncoming car, sliding wall, missile) end the run — a shield
  // forgives one. Only a centred hit counts (a side clip is a stumble). The obstacle generator paces them (lethalK, never two
  // in a row early on). Set false to turn every collision back into a stumble.
  lethal: true,
  // Critters.
  stompV: 9,
  critterSlow: 0.8,      // speed kept after bumping a critter (a crash keeps crashSlow)
  // Power-up durations (seconds) when the meta module isn't there to supply upgraded values.
  dur: { magnet: 8, x2: 10, superjump: 9, rocket: 6, sled: 20 },
  superJumpK: 1.55,
  rocketH: 6,
  // Goals & pressure (endless only).
  cpCoins: 25,           // checkpoint (every layerLen) pays this × layer (layer capped at 8)
  recNear: 300,          // metres out: the goal strip switches to "REKORA n m"
  recCoins: 50,          // one-off payout for passing your record distance
  rageLen: 130,          // "YETİ ÖFKESİ": the Yeti throws boulders over the last N m of a layer (from layer 2 on) ...
  rageSecs: 7,           // ... or the last N seconds of running, whichever is longer (so fast runs still get 2+ boulders)
  rageEvery: [14.0, 18.0], // seconds between boulders (× 0.93 per layer, floor 0.7)
  rageBack: 4,           // the Yeti drops back this far when you survive a barrage
  multCap: 6,            // + layer, at most 12
  closeCall: 4,
};

export const speedAt = (s) => {
  const x = Math.max(0, s), K = RCFG.speedKnee;
  if (x <= K) return RCFG.startSpeed + x * RCFG.speedPerM;
  const vK = RCFG.startSpeed + K * RCFG.speedPerM;
  return vK + (RCFG.maxSpeed - vK) * (1 - Math.exp(-(x - K) / RCFG.speedTau));
};
export const bpmAt = (s) => Math.min(RCFG.bpmMax, RCFG.bpm0 + Math.max(0, s) * RCFG.bpmPerM);
/** Turn window (seconds before the corner) the junction accepts a swipe in; shrinks with distance. */
export const juncWinAt = (s) => 0.8 + 0.3 * Math.min(1, Math.max(0, 1 - (s - 350) / 4650));

const DEATH_TEXT = {
  explode: 'PATLADIN!', yeti: 'YETİ SENİ YAKALADI!', fall: 'UÇURUMA DÜŞTÜN!', wall: 'DUVARA ÇARPTIN!', melt: 'ERİDİN!', smash: 'ÇARPTIN!',
};
const FLOAT_PRI = { '': 1, big: 2, bad: 3 };

const TIERS = RCFG.tierR.length;
const _f = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
const _f2 = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _upC = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _tp = new THREE.Vector3();
const _yp = new THREE.Vector3();
const _goal = { mode: 'cp', val: 0, frac: 0 };
const _bi = { biome: null, index: 0, t: 0, next: null };   // biomeAt() scratch: read it right away, never keep it
const RAGE_SKIP = new Set(['zipline', 'rail', 'loop', 'corkscrew']); // sections where the Yeti keeps its boulders
const GLOW_KINDS = new Set(['star', 'x2', 'superjump', 'crystal', 'timewarp', 'ghost', 'risk', 'clone', 'helmet', 'magnet', 'rocket', 'cannon']);
const ROUND_KINDS = new Set(['helix', 'halfpipe', 'tube', 'loop', 'corkscrew']);
const DEG = Math.PI / 180;
const MAX_ROLL = 12 * DEG;                                             // chase camera roll limit (banked / twisted track)
const COS_LOOK = Math.cos(25 * DEG), SIN_LOOK = Math.sin(25 * DEG);   // look direction limit off the track's forward
const LETHAL_BASE = new Set(['rock', 'cabin']);                  // campaign: from level 16
const LETHAL_CAR = new Set(['snowcat', 'oncoming', 'missile']);  // campaign: from level 30
const LETHAL_WALL = new Set(['slidewall']);                      // campaign: from level 60

/** GÜNÜN RUSH'I: same seed for everybody on a given local date. */
export function dailyInfo() {
  const d = new Date(), key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  const num = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86400000) + 1;
  return { key, num, seed: (h >>> 0) % 1000000000 };
}
function storeDaily(dl, dist, score) {
  let r = null;
  try { r = JSON.parse(localStorage.getItem('patpat.dailyRush') || 'null'); } catch (e) { r = null; }
  if (!r || r.key !== dl.key) r = { key: dl.key, dist: 0, score: 0 };
  if (dist > r.dist) { r.dist = dist; r.score = score; }
  try { localStorage.setItem('patpat.dailyRush', JSON.stringify(r)); } catch (e) { /* ignore */ }
  return r;
}
// Menu hook: `window.patpatDailyRush()` flags the next runner.start() as the daily run (call it right before main's startEndless()).
if (typeof window !== 'undefined') window.patpatDailyRush = () => { window.__patpatDailyRush = true; return dailyInfo(); };

export class Runner {
  constructor(ctx) {
    this.ctx = ctx; // { scene, camera, lib, ball, fx, ui, audio, platform, save, input, meta, menus }
    this.events = [];
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.state = 'idle';
    this.closed = true;
    this.buffs = new BuffSet();
    this._yeti = { mode: null, frac: 0 };
    this._vit = { tier: 0, tiers: TIERS, grow: 0, gap: 0, yetiMax: RCFG.yetiMax, helmet: false, helmetT: 0, magnet: false, rocket: false, x2: false, superjump: false, sled: false, sledCd: 0, yeti: this._yeti };
    this._groups = [];
    this.trailPool = null;
    this.camNear0 = null;
    // (created once: the buff expiry callback must not allocate every frame)
    this._onBuffEnd = (e) => { this.ctx.ui.buffRemove?.(e.id); this.ctx.audio.chime?.('end'); };
  }

  start(seed = (Math.random() * 1e9) | 0, level = null, opts = {}) {
    const { scene } = this.ctx;
    this.closeOut();           // bank / record the previous run BEFORE anything is wiped
    this.dispose();
    const save = this.ctx.save;
    this.level = level;
    // GÜNÜN RUSH'I: the menu sets window.__patpatDailyRush = true right before startEndless(); retries of a daily stay daily
    let dly = null;
    if (!level && (window.__patpatDailyRush || (opts.retry && this.daily))) { dly = dailyInfo(); seed = dly.seed; }
    window.__patpatDailyRush = false;
    this.daily = dly;
    if (level) seed = level.seed >>> 0;
    this.seed = seed;
    this.tut = !level && !this.ctx.noTut && !(save.runnerTutDone?.() ?? true);
    Biomes.setBiomeOverride?.(level ? level.biome : null);
    this.track = new Track(scene, {
      seed,
      palette: trackPalette,
      speedAt,
      bpmAt,
      biomeIndexAt: (s) => biomeAt(s, _bi).index,
      vGen: (s) => 1.1 * speedAt(s),
      juncWinAt,
      junctionOk: (s) => Biomes.junctionOkAt?.(s) ?? true,
      tutorial: this.tut,
    });
    this.rhythm?.dispose();
    this.rhythm = new RhythmLane(this);
    this.obstacles = new Obstacles(scene, this.track, { seed: seed ^ 0x9e3779b9, jumpPadV: RCFG.jumpPadV, vGen: (s) => 1.1 * speedAt(s), tutorial: this.tut, endless: !level, scarves: !level && !this.tut });
    this.track.onPiece = (piece) => {
      const bi = biomeAt(piece.s0, _bi);
      this.obstacles.spawn(piece, piece.diff ?? Math.min(1, piece.s0 / 5000), piece.biome ?? bi.index, bi.biome.id);
    };
    if (level) {
      // Campaign gating helpers (harmless when the track ignores them): junction turns from level 11, critters from level 3.
      const feats = (level.features || []).slice();
      if (level.id >= 11 && !feats.includes('junction')) feats.push('junction');
      if (level.id >= 3 && !feats.includes('critters')) feats.push('critters');
      this.track.setLevel?.({ id: level.id, length: level.length, features: feats, hardness: level.hardness, seed, boss: level.boss });
      this.obstacles.reset?.();
      this.obstacles.setHardness?.(level.hardness);
    }
    this.track.ensure(320);
    this.env = new Environment(scene, this.track, { lib: this.ctx.lib });
    this.yeti = makeYeti(scene, this.ctx.lib);
    this.avalanche = makeAvalanche(scene);

    // ---- size / hunger ----
    this.tier = level ? Math.max(0, Math.min(4, level.startTier ?? 1)) : 2;
    this.grow = level ? 0 : 0.5;            // progress to the next tier (0..1)
    const b = (this.b = { s: 16, u: 0, h: 0, r: RCFG.tierR[this.tier], vs: RCFG.startSpeed * 0.6, vu: 0, ve: 0, vh: 0, size: 2 });
    this.buffs.reset();
    b.r = this.radiusNow();
    b.size = this.sizeNow();
    this.rShown = b.r;
    this.meltK = level ? (level.id < 6 ? 0 : 0.35 + 0.25 * Math.min(1, (level.id - 6) / 40)) : 1;   // campaign: none before level 6, then gentle
    this.meltGraceT = 0;
    this.meltWarnT = 0;
    this.hungerWarn = false;
    this.maxTier = this.tier;

    // ---- movement ----
    this.grounded = true;
    this.coyoteT = 0;
    this.lane = 0;
    this.targetU = 0;
    this.lastSurf = 0;
    this.lastSlope = 0;
    this.holeRun = 0;        // metres travelled over a hole while still held up by its edge
    this.holeAir = false;    // this flight has been over a real hole (a fall that is allowed to kill)
    this.wallRun = null;     // a missed turn: the ball keeps going straight into the barrier
    this.fallLock = false;   // dropped off the track: no more steering
    this.groundT = 0;        // time since landing (stomp combo reset)
    this.jumpBufT = 0;
    this.duckOnLand = false;
    this.edgeS = -1;         // jump held until the take-off edge of a gap (assist)
    this.diveT = 0;
    this.duckT = 0;
    this.duckK = 0;
    this.zip = null;
    this.grind = null;
    this.rampAirT = 0;
    this.iceT = 0;
    this.lastSafe = { s: 16, u: 0 };
    this.safeT = 0;
    this.timeScale = 1;
    this.slowUntil = -1;
    this.slowScale = 1;
    this.warpT = 0;

    // ---- the Yeti ----
    this.gap = RCFG.yetiStart;
    this.yetiHoldT = RCFG.yetiHold;
    this.stumbleT = 0; this.stumbleHits = 0;
    this.stumbleMax = RCFG.stumbleWin;
    this.stumbles = 0;
    this.minGap = Infinity;
    this.closeArmed = false;
    this.roarT = 4;

    // ---- score / bookkeeping ----
    this.score = 0;
    this.coins = 0;
    this.coinsBanked = 0;
    this.coinsF = 0;
    this.closed = false;
    this.recorded = false;
    this.recInfo = null;
    this.finalized = false;
    this.time = 0;
    this.deadT = 0;
    this.revived = false; this.coinUsed = false; this.coinRev = false; this.wxT = 0;
    this.revives = 0;
    this.reviveCost = 0;
    this.invulnT = 1.2;
    this.helmet = false;
    this.helmetT = 0;
    this.magnetT = 0;
    this.rocketT = 0;
    this.x2T = 0;
    this.superT = 0;
    this.sledT = 0;
    this.sledCdT = 0;
    this.boxes = 0;
    this.crystals = 0;
    this.jumps = 0;
    this.smashes = 0;
    this.turns = 0;
    this.crashes = 0;
    this.layersLost = 0;
    this.perfects = 0;
    this.powerups = 0;
    this.destTons = 0;
    this.destTier = 0;
    this.cause = '';
    this.killKind = null;
    const lid = level ? level.id || 0 : 1e9;
    // endless Rush: nothing kills in one touch (only gaps and the Yeti); campaign keeps its level gates
    this.lethalOn = level ? { base: RCFG.lethal && lid >= 16, car: RCFG.lethal && lid >= 30, wall: RCFG.lethal && lid >= 60 } : { base: false, car: false, wall: false };
    this.state = 'play';
    this.countT = opts.retry ? 1 : 2;
    this.countQuiet = !!opts.retry;
    this.layer = 0;
    this.speedTier = 0;
    this.flow = 0;
    this.flowLvl = 0;
    this.rcp = []; this.rcpN = 0; this.rcpS = 0; this._rcpKill?.(); this._lblKey = null; this._stormShown = false; this._flowL = -1; this._flowF = -1;
    this.flowT = 0; this.cmbN = 0; this.cmbAt = 0; this.cmbT = 0; this.stormKm = undefined; this.stormOn = false; this.stormHit = false;
    this.gustK = 0; this.gustDir = 1; this.gustWarn = false; this.gustSndT = 0;
    this.bestDist = save.runnerBestDist?.() ?? 0;
    this.bestScore = save.runnerBest?.() ?? 0;
    this.passedDist = this.bestDist < 50;
    this.passedScore = this.bestScore < 100;
    this.baseHard = level ? level.hardness : 1;
    this.hardS = -1e9;
    this.perm = save.perm?.() ?? {};
    this.gateChain = 0;
    this.newRecT = 0;
    this.nearChain = 0;
    this.nearT = 0;
    this.fury = 0; this.furyT = 0; this.furyCd = 0;
    this.punch = 0;
    this._progT = 0;
    this.lastSmashStop = -9;
    this.smashTimes = [];
    this.rampT = 0;
    this.cannonN = 0; this.cannonCd = 0; this.cannonT = 0; this.slideT = 0; this.slideMsgT = 0; this.tunnelMsgT = 0;
    this.fogK = 0;
    this.fogTarget = this.wxT > 0 ? (this.wxT -= dt, this.wxFog) : 0;

    // ---- buff cards ----
    this.buffT = level ? Infinity : rand(RCFG.buffFirst[0], RCFG.buffFirst[1]);   // campaign levels have no auto cards
    this.lastBuff = '';
    this.buffTickT = 0;
    this.cardRiskT = 0;
    this.killGate?.();

    // ---- critters ----
    this.stompN = 0;
    this.stompTotal = 0;
    this.penN = 0; this.penHist = []; this.penMeshes = this.penMeshes || [];   // KAR SÜRÜSÜ: little penguins following the ball
    this.snowChain = 0;
    this.snowT = -9;

    // ---- junctions ----
    this.jnId = null;
    this.jnDone = false;
    this.jnOpen = false;
    this.jnNear = false;
    this.jnJ = null;
    this.jnSA = 0;
    this.jnCueT = 0;
    this.jnLean = 0;
    this.jnLeanT = 0;
    this.juncSlow = false;
    this.tipCd = 4; this.tipSlowT = 0;
    this.jnTutMiss = 0;
    this.cornerK = 0;
    this.camLookBias = 0;
    this.camLookBiasT = 0;

    // ---- queues ----
    this.bannerQ = [];        // queued banners [text, level, hold, ...]
    this.bannerT = 0;
    this.later = [];          // delayed callbacks that follow game time (and die with the run)
    this.rage = null;         // "YETİ ÖFKESİ" mini-boss { s0, B, t, n, crashes0 }
    this.rageCount = 0;
    this.zone = null; this._rainDone = false;      // staged rule change { kind, from, until, name, announced }
    this.inZone = null;
    this.warned = null;
    this.floatT = -9; this.floatSeen = new Map(); this.floatPend = null; this._bnSeen = new Map();
    this.floatPri = 0;
    this.threatT = 0;

    // ---- power-up leftovers ----
    this.ghostT = 0;
    this.riskT = 0;
    this.cloneT = 0;
    this.clone = null;

    // ---- camera / juice ----
    this.shake = 0;
    this.trauma = 0;
    this.shakeClock = 0;
    this.kick = 0;
    this.rollS = 0;
    this.rollU = 0;
    this.closeK = 1;
    this.camBackS = 9;
    this.camUpH = 5.6;
    this.camLa = 12;
    this.camU = 0;
    this.camLookU = 0;
    this.camRoundK = 0;
    this.camLoopK = 0;
    this.tilt = 0;
    this.leanT = 0;
    this.hitStop = 0;
    this.squash = 0;
    this.sqV = 0;
    this.trailN = 0;
    this.patchedCount = -1;
    this.deadSlowT = 0;
    this.off = null;
    const cam = this.ctx.camera;
    if (this.camNear0 === null) this.camNear0 = cam.near;
    if (cam.near > 0.05) { cam.near = 0.05; cam.updateProjectionMatrix?.(); }

    this.obstacles.setHardness?.(this.baseHard);
    this.track.setHardness?.(this.baseHard);
    this.makeRecordFlag();
    this.makeShadow();
    this.obstacles.markSmashable?.(this.sizeNow() - 1);
    this.markedSize = this.sizeNow();
    // KARAKTER ability (endless Rush only)
    { let id = null; try { id = this.level ? null : this.ctx.save.selected?.('skin'); } catch (e) { id = null; }
      this.abil = ABILITIES[id] ? id : null; this.simitUsed = false; this.gapBonus = 0; this._gemNext = 0;
      if (this.abil === 'nazar') { this.gapBonus = 3; this.gap += 3; }
      if (this.abil === 'penguen') this.penN = 1;
      if (this.abil) this.charIntro(id); }
    this.ctx.meta?.track?.('run_start', { mode: 'endless' });
    this.obstacles.setNextLetter?.(this.ctx.meta?.letterHunt?.()?.nextLetter ?? null);
    this.yetiN = 0; this.dblT = 0; this.turboN = 0; this.turboT = 0;
    this.bait = 0; this.baitT = 0; this.baitBonus = 0; this.baitTap = -9; this.baitChip(); this.seasonTokens = 0; this.scarfChip(); this.bread = 0; this.breadChip(); this.cannonChip();
    this.obstacles.setYetiLetter?.('Y');
    this.bossIntro = 0; this.ghostPassed = false; this.ghostRec = null; this.ghostLen = 0;
    this.initGhost();
    this.boss = null; this.nextBossS = 1800; this.glowT = 0; this.camHelixK = 0; this.camInK = 0; this.track.bossHold = false;

    const ball = this.ctx.ball;
    ball.reset(b.r);
    ball.group.visible = true;
    this.ctx.fx.reset();
    const input = this.ctx.input;
    input.clear ? input.clear() : (input.consumeDx(), input.consumeJump(), input.consumeDive?.(), input.consumeLane(), input.consumeDoubleTap?.());

    music.init();
    music.start(musicStyleAt(0), bpmAt(0));
    music.duck?.(false);
    music.setIntensity(0.55);
    const ui = this.ctx.ui;
    ui.runnerHud(true, biomeAt(0).biome.name);
    ui.runnerTurn?.(null);
    ui.runnerTutor?.(null);
    ui.hideRunnerRevive?.();
    ui.turnCue?.(0, 0);
    ui.stompCombo?.(0);
    ui.hunger?.(this.hungerFrac(), false);
    if (level) ui.runnerGoal?.(null); // campaign has its own finish-line progress bar
    if (!this.countQuiet) ui.banner(String(Math.ceil(this.countT)), 3);
    if (this.tut || level === 1) {
      // the very first run: one quiet line until the first swipe (or 8 s), never a popup
      ui.hint?.(true, '← → şerit · ↑ zıpla · ↓ eğil');
      this.after(5, () => { if (!this.jnOpen) ui.hint?.(false); });
    }
    this.updateHud();
    this.placeBall(true);
  }

  // Score multiplier: size, flow, near-miss chain, Yeti closeness and the x2 / twin power-ups all ADD to 1 (capped at
  // RCFG.multCap); permanent progression (mission sets, upgrades) sits on top of the cap. No more compounding.
  get mult() {
    if (!this.buffs) return 1;
    // Combo is earned: flow (skill events only) adds +0.5 per point (x10 / x25 / x50 at 18 / 48 / 98); size counts for at most +2.
    return (this.furyT > 0 ? 2 : 1) * (this.flow * 0.5 + 0.1 * (this.penN || 0) + scoreMult(Math.min(2, this.tier), 0, this.chainBonus(), this.dangerBonus(), this.riskBonus(),
      (this.ctx.meta?.multiplier?.() ?? 1) - 1 + 0.15 * Math.min(5, this.perm.speed || 0), RCFG.multCap));
  }

  dangerBonus() { return dangerBonus(this.stumbleT > 0); }

  chainBonus() { return chainBonus(this.nearChain || 0); }

  // Power-ups: flat bonuses instead of multipliers.
  riskBonus() {
    let m = 0;
    if (this.x2T > 0) m += 3;
    if (this.riskT > 0) m += 4;
    if (this.clone) m += 2;
    return m;
  }

  dur(kind) { return this.ctx.meta?.duration?.(kind) || RCFG.dur[kind]; }

  // ---------- size ----------
  /** b.size: 1 + tier (obstacle "smash" comparisons use it). */
  sizeNow() { return this.tier + 1 + (this.buffs.has('dev') ? 1 : 0); }

  /** Radius from tier + progress (+ the giant card). Computed from scratch every time: nothing ratchets. */
  radiusNow() {
    const dev = this.buffs.has('dev');
    const t = Math.min(TIERS - 1, this.tier + (dev ? 1 : 0));
    const g = this.tier >= TIERS - 1 ? (dev ? this.grow : 0) : this.grow;
    const r0 = RCFG.tierR[t];
    const r1 = t >= TIERS - 1 ? r0 + 0.15 : RCFG.tierR[t + 1];
    return r0 + (r1 - r0) * g * 0.6;
  }

  syncRadius() {
    this.b.r = this.radiusNow();
    const sz = this.sizeNow();
    this.b.size = sz;
    if (sz !== this.markedSize) { this.markedSize = sz; this.obstacles.markSmashable?.(sz - 1); }
  }

  /** 0..1: the whole size meter (5 tiers) as one bar; 0 = about to melt away. */
  hungerFrac() {
    return clamp((this.tier + this.grow) / TIERS, 0, 1);
  }

  // ---------- frame ----------
  update(rdt) {
    if (this._rcpEl && this.state === 'play') this._rcpKill();
    if (this.state === 'idle') return;
    if (rdt > 0.1) rdt = 0.1;
    const play = this.state === 'play';
    // Ski-jump slow-mo and the first-junction tutorial: ease into the slowed window, ease back out after.
    let want = 1;
    if (play && this.b.s < this.slowUntil && !this.grounded) want = this.slowScale;
    if (play && this.juncSlow) want = Math.min(want, 0.5);
    if (this.tipSlowT > 0) { this.tipSlowT -= rdt; if (play) want = Math.min(want, 0.6); }
    if (this.tipCd > 0 && play) this.tipCd -= rdt;
    this.timeScale += (want - this.timeScale) * Math.min(1, rdt * 8);
    let dt = rdt * this.timeScale;
    // Hit-stop: a crash freezes the world for a heartbeat so it lands.
    if (this.hitStop > 0) { this.hitStop -= rdt; dt *= 0.06; }
    if (this.warpT > 0) { this.warpT -= rdt; dt *= 0.5; }
    // The first moments of a death run in slow motion so the read-out lands.
    if (this.state === 'dying') { if (this.deadT < 0.12) dt *= 0.02; else if (this.deadT < 0.7) dt *= 0.4; }
    // Countdown before the chase starts (2 s the first time, 1 s on retries): the world is frozen.
    if (this.countT > 0) {
      const before = Math.ceil(this.countT);
      this.countT -= rdt;
      const after = Math.ceil(this.countT);
      if (after !== before) {
        if (after > 0) { if (!this.countQuiet) { this.ctx.ui.banner(String(after), 3); this.ctx.audio.ui('select'); } }
        else if (this.countQuiet) this.ctx.audio.whoosh();       // retry / revive: no banner, no roar — just go
        else { this.topMsg('KAÇ!', 'big'); this.roar(true); }
      }
      dt = 0;
    }
    if (this._introPend && this.countT <= 0 && this.introEl) {
      this._introPend = false; const ie = this.introEl; ie.style.visibility = ''; ie.style.animation = 'none'; void ie.offsetWidth; ie.style.animation = '';
      setTimeout(() => { if (this.introEl === ie) ie.classList.add('badge'); }, 1500);
    }
    if (play && this.countT <= 0) this.tickBanner(rdt);
    const beat = music.beat;
    this.time += dt;
    if (play) this.updatePlay(dt, beat);
    else if (this.state === 'dying') this.updateDying(dt, rdt);
    else if (this.state === 'finished') {
      this.finishT += dt;
      this.b.vs *= Math.exp(-1.2 * dt);
      this.b.s += this.b.vs * dt;
      this.gap = Math.min(RCFG.yetiMax, this.gap + 20 * dt);
      this.rollS += this.b.vs * dt;
    }

    this.track.ensure(this.b.s + 320);
    this.track.trim(this.b.s - 70);
    this.obstacles.trim(this.b.s - 70);
    this.obstacles.update(dt, beat, this.b);
    if (play) { this.rhythm?.update(dt, beat); if (this.rhythm?.strip) this.tip('rhythm', 'RİTİM HATTI: altın pedlere vuruşta bas!', false); }
    this.env.fogPress = this.fogK;
    this.env.ballVs = this.b.vs;
    this.env.update(dt, this.ctx.camera, this.b, beat);
    // Size changes animate quickly instead of popping (crash = visible shrink).
    this.rShown += (this.b.r - this.rShown) * Math.min(1, dt * 12);
    this.ctx.ball.setRadius(this.rShown);
    this.placeBall(false, dt);
    this.updatePenguins(dt);
    this.updateYeti(dt);
    this.ctx.fx.update(dt, this.ctx.ball);
    this.updateCamera(rdt);
  }

  // lane count of the piece under the ball (3 -> 4 -> 5 as the track widens); lane = signed lane offset (half lanes when even)
  laneW() { return RCFG.laneW; }
  laneMax() { return (LANES.length - 1) / 2; }
  laneSnap(l) { const n = LANES.length, m = (n - 1) / 2; return clamp(n % 2 ? Math.round(l) : Math.floor(l) + 0.5, -m, m); }
  syncLanes() {
    const b = this.b, pc = this.track.pieceAt(b.s);
    if (b.s < 100) this.widenS = -1;
    if (!pc || !pc.n) return;
    if (pc.n !== LANES.length) { setLanes(pc.n); this.lane = this.laneSnap(this.lane); }
    if (pc.widen && pc.s0 > (this.widenS ?? -1)) { this.widenS = pc.s0; this.float('ŞERİT AÇILDI!', 'big'); this.kick += 1.5; }
    if (pc.narrow) {
      if (pc.s0 > (this.narrowS ?? -1)) { this.narrowS = pc.s0; this.kick += 1; }
      // the outer lanes close: a ball in a closing lane is pushed one lane inward at a time (never killed by the narrowing)
      if (pc.hwAt && this.lane !== 0) {
        const lim = pc.hwAt(Math.min(pc.s1 - 0.5, b.s + 7)) - 1.4 + 0.01;
        let g = 0;
        while (Math.abs(this.lane * RCFG.laneW) > lim && Math.abs(this.lane) > (LANES.length % 2 ? 0.01 : 0.51) && g++ < 4) this.lane -= Math.sign(this.lane);
      }
    }
  }

  updatePlay(dt, beat) {
    const { input, ui } = this.ctx;
    const b = this.b;
    const tr = this.track;
    this.syncLanes();
    const counting = this.countT > 0;

    // ---- junction runtime (inert when the track has no junctions) ----
    const J = this.juncTick(b, tr);
    if (this.state !== 'play') return;

    // ---- input ----
    const hw = Math.max(1, tr.halfWidth(b.s) || tr.pieceAt(b.s)?.halfWidth || 3.5);
    input.consumeDx(); // free drag isn't used here — lanes are
    if (counting) { input.consumeJump(); input.consumeDive(); input.consumeDoubleTap(); }   // the countdown eats those
    let lane = input.consumeLane();
    if (this.wallRun) {
      // a missed turn is already a crash: nothing you do now counts
      lane = 0;
      input.consumeJump(); input.consumeDive(); input.consumeDoubleTap();
    } else if (lane && J && this.jnOpen && Math.sign(lane) === J.dir) {
      // A swipe toward the corner inside the turn window IS the turn (not a lane change): the touch is spent.
      this.commitTurn(J, false);
      input.endGesture?.();
      lane = 0;
    }
    if (lane) this.laneChange(lane);
    this.targetU = this.lane * RCFG.laneW;
    if (!counting && !this.wallRun) {
      if (input.consumeJump()) { ui.hint(false); this.jumpBufT = RCFG.jumpBuf; }
      if (input.consumeDive()) {
        const now = this.time, dbl = this.bait > 0 && now - this.baitTap < 0.4;      // down, down: drop the bait
        this.baitTap = now;
        if (dbl && this.useBait(false)) this.baitTap = -9; else this.dive();
      }
      if (input.consumeDoubleTap()) this.trySled();
    }
    this.tickJump(dt);
    this.diveT -= dt;
    this.duckT -= dt;

    // ---- speed: downhill pace + size bonus; rocket overrides ----
    const top = speedAt(b.s) * (1 + this.tier * RCFG.sizeSpeed) * (this.rocketT > 0 ? 1.35 : 1) * (this.riskT > 0 ? 1.45 : 1) * (this.cardRiskT > 0 ? 1.04 : 1) * (this.slideT > 0 ? (this.abil === 'buzejder' ? 1.4 : 1.2) : 1) * (this.rhythm ? this.rhythm.speedK : 1);
    if (b.vs < top) b.vs = Math.min(top, b.vs + RCFG.accel * dt);
    else b.vs = Math.max(top, b.vs - RCFG.accel * 0.6 * dt);
    this.invulnT -= dt;
    this.coyoteT -= dt;
    this.iceT -= dt;
    this.slideT -= dt; this.slideMsgT -= dt; this.tunnelMsgT -= dt;
    if (this.magnetT > 0) this.magnetT -= dt;
    if (this.abil === 'altin') { const n = this.obstacles.next; if (n) { if (this._gemNext && n.gem > this._gemNext) n.gem -= 200; this._gemNext = n.gem; } }
    if (this.x2T > 0) this.x2T -= dt;
    if (this.superT > 0) this.superT -= dt;
    if (this.helmetT > 0) { this.helmetT -= dt; if (this.helmetT <= 0 && this.helmet) { this.helmet = false; this.float('KASK GİTTİ', ''); } }
    if (this.sledCdT > 0) this.sledCdT -= dt;
    if (this.sledT > 0) { this.sledT -= dt; if (this.sledT <= 0) { this.sledCdT = RCFG.sledCd; this.float('KIZAK BİTTİ', ''); } }
    if (this.rocketT > 0) {
      this.rocketT -= dt;
      if (Math.random() < dt * 40) this.burst(1, 0xffa040, 2);
      if (this.rocketT <= 0) { this.invulnT = Math.max(this.invulnT, 1); this.yetiHoldT = 0; }
    }
    if (this.cannonN > 0) this.cannonTick(dt);
    this.furyTick(dt);
    if (this.rampT > 0) { this.rampT -= dt; if (Math.random() < dt * 30) this.burst(1, 0xffd060, 2); if (this.rampT <= 0) this.float('YIKIM BİTTİ', ''); }
    if (this.ghostT > 0) { this.ghostT -= dt; if (this.ghostT <= 0) { this.setGhost(false); this.float('HAYALET BİTTİ', ''); } }
    if (this.riskT > 0) { this.riskT -= dt; if (this.riskT <= 0) this.float('RİSK BİTTİ', ''); }
    if (this.cloneT > 0) { this.cloneT -= dt; if (this.cloneT <= 0) this.endClone(false); }
    if (this.nearT > 0) { this.nearT -= dt; if (this.nearT <= 0) this.nearChain = 0; }
    this.punch = Math.max(0, this.punch - dt * 4);
    this.tickLater(dt);
    if (!counting) {
      this.buffTick(dt);
      this.hungerTick(dt);
      this.hardTick();
    }
    if (this.state !== 'play') return;

    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps && this.state === 'play'; i++) this.step(h, hw);
    if (this.state !== 'play') return;
    if (this.grounded) {
      this.groundT += dt;
      if (this.stompN && this.groundT > 0.25) { this.stompN = 0; ui.stompCombo?.(0); }
    } else this.groundT = 0;

    // ---- Yeti: right behind you at the start and while you stumble, otherwise it falls back ----
    this.yetiTick(dt, top);

    this.rageTick(dt);
    this.bossTick(dt);
    this.progression(dt);
    this.zoneTick();
    this.fogK += (this.fogTarget - this.fogK) * Math.min(1, dt * 2.5);
    this.fogTarget = 0;

    // ---- scoring / music ----
    if (this.dblT > 0) this.dblT -= dt;
    if (this.turboT > 0) this.turboT -= dt; else this.turboN = 0;
    this.score += b.vs * dt * this.mult * (this.dblT > 0 ? 2 : 1);
    music.setBpm(bpmAt(b.s));
    music.setIntensity(clamp(0.55 + b.s / 4000 + (this.stumbleT > 0 || this.rage ? 0.35 : 0), 0.55, 1));
    this.ctx.audio.setRoll(this.grounded ? clamp(b.vs / RCFG.maxSpeed, 0, 1) * 0.7 : 0, clamp(b.r / 1.5, 0, 1) * 0.5);
    this.updateHud();

    // Remember a safe spot for "DEVAM ET" (never inside a junction approach: reviving there would be a trap).
    this.safeT -= dt;
    if (this.safeT <= 0 && this.grounded && !this.jnNear && Math.abs(b.u) < hw - 0.8 && tr.surfaceAt(b.s, b.u) !== -Infinity) {
      this.safeT = 0.4;
      this.lastSafe.s = b.s;
      this.lastSafe.u = b.u;
    }
  }

  // KAR KANONU: auto-fires a snowball every 0.3 s at the nearest breakable blocker ahead in the ball's lane (5 shots, 25 s).
  cannonTick(dt) {
    this.cannonT -= dt; this.cannonCd -= dt;
    if (this.cannonT <= 0) { this.cannonN = 0; this.cannonChip(); return; }
    if (this.cannonCd > 0 || this.grind || this.zip) return;
    const b = this.b, o = this.obstacles.snipe?.(b.s, b.u, 26 + b.vs * 0.25);
    if (!o) return;
    this.cannonCd = 0.3; this.cannonN--;
    const { audio, platform } = this.ctx;
    for (let i = 1; i <= 5; i++) {      // the snowball's streak from the ball to the target
      const t = i / 5;
      this.track.toWorld(b.s + (o.s - b.s) * t, b.u + (o.u - b.u) * t, b.h + 0.9 + 0.2 * Math.sin(t * Math.PI), _v);
      this.ctx.fx.puff(_v.x, _v.y, _v.z, 0, 0.3, 0, 0.5, 0.35, 0xffffff, 0.9);
    }
    this.debris({ s: o.s, u: o.u, h: 0, color: o.color }, 12);
    this.smashes++; this.addFlow(1.5); this.score += 40 * Math.max(1, o.tough) * this.mult;
    audio.crash?.(0.5); platform.haptic('light');
    this.kick += 1; this.trauma = Math.min(1, this.trauma + 0.1);
    if (this.cannonN <= 0) this.cannonT = 0;
    this.cannonChip();
  }

  // YETİ ÖFKESİ meter: near misses + stomp chains fill it (~8 near misses); full -> 5 s of snowball rain, invulnerable, score x2.
  addFury(a) {
    if (this.furyT > 0 || this.state !== 'play') return;
    this.fury = Math.min(1, this.fury + a * (this.abil === 'kizilkaos' ? 1.2 : 1));
    if (this.fury < 1) return;
    this.fury = 1; this.furyT = 5; this.furyCd = 0;
    const { audio, platform } = this.ctx;
    this.queueBanner('YETİ ÖFKESİ!', 5, 1.6, true);
    audio.milestone?.(5); audio.win?.(); platform.haptic('success');
    this.mistBurst(24, 0xff6a3a, 6, 1.3); this.kick += 4; this.punch = Math.min(1.5, this.punch + 1);
  }

  furyTick(dt) {
    const ui = this.ctx.ui;
    if (this.furyT <= 0) {
      if (this.fury > 0 && this.state === 'play') { this.fury = Math.max(0, this.fury - 0.012 * dt); ui.runnerGoal?.('fury', 0, this.fury); }
      return;
    }
    this.furyT -= dt;
    this.fury = Math.max(0, this.furyT / 5);
    this.invulnT = Math.max(this.invulnT, 0.25);
    this.glowT = Math.max(this.glowT, 0.2);
    ui.runnerGoal?.('fury', 0, this.fury);
    if (this.furyT <= 0) { this.fury = 0; this.furyT = 0; this.float('ÖFKE BİTTİ', ''); if (this.level) ui.runnerGoal?.(null); return; }
    this.furyCd -= dt;
    const b = this.b;
    if (Math.random() < dt * 14) {       // fiery sparks around the ball
      this.track.toWorld(b.s + 1 + Math.random() * 3, b.u + (Math.random() - 0.5) * 2, b.h + 0.5 + Math.random(), _v);
      this.ctx.fx.puff(_v.x, _v.y, _v.z, 0, 0.8, 0, 0.5, 0.4, Math.random() < 0.5 ? 0xff5a2a : 0xffb040, 0.9);
    }
    if (this.furyCd > 0 || this.grind || this.zip) return;
    const o = this.obstacles.snipe?.(b.s, b.u, 40 + b.vs * 0.3);
    if (!o) return;
    this.furyCd = 0.22;
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      this.track.toWorld(b.s + (o.s - b.s) * t, b.u + (o.u - b.u) * t, b.h + 1.6 - 1.2 * t, _v);
      this.ctx.fx.puff(_v.x, _v.y, _v.z, 0, 0.3, 0, 0.6, 0.4, 0xffffff, 0.9);
    }
    this.debris({ s: o.s, u: o.u, h: 0, color: o.color }, 12);
    this.smashes++; this.addFlow(1.5); this.score += 40 * Math.max(1, o.tough) * this.mult;
    this.ctx.audio.crash?.(0.5); this.kick += 0.8; this.trauma = Math.min(1, this.trauma + 0.08);
  }

  // ---------- input actions ----------
  laneChange(lane) {
    const { ui, platform, audio } = this.ctx;
    const b = this.b;
    ui.hint(false);
    if (this.grind) { this.grind = null; this.grounded = false; b.vh = 2.5; }   // hop off the rail sideways
    const prev = this.lane;
    this.lane = clamp(prev + lane, -this.laneMax(), this.laneMax());
    if (this.lane === prev) {
      // Already on the edge lane: a soft nudge into the snow bank instead of a fake lane change.
      b.vu += Math.sign(lane) * 5;
      audio.bump(0.15);
      platform.haptic('light');
      return;
    }
    platform.haptic('select');
    this.mistBurst(4, 0xffffff, 2, 0.8);
  }

  dive() {
    if (this.grind) return;     // swipes down are ignored on a rail
    const b = this.b;
    this.diveT = 0.7;
    if (!this.grounded && !this.zip) {
      // Slam: drop to the snow fast and duck on landing (the low-bar phrase right after a log needs it).
      if (b.vh > RCFG.diveV) b.vh = RCFG.diveV;
      this.duckOnLand = true;
      this.ctx.audio.whoosh();
    } else if (this.grounded) {
      this.duckT = 0.65;
      this.ctx.audio.whoosh();
      this.mistBurst(5, 0xffffff, 2, 0.8);
    }
  }

  // Jump buffer: a press shortly before landing (or while a gap edge is still ahead) still counts.
  tickJump(dt) {
    const b = this.b;
    if (this.jumpBufT > 0) {
      let fired = false;
      if (this.grind) { this.grind = null; fired = true; this.jump(RCFG.jumpV, false); }       // hop off the rail
      else if (!this.zip && this.edgeS < 0 && (this.grounded || this.coyoteT > 0)) {
        fired = true;
        if (!this.edgeAssist()) this.jump(RCFG.jumpV, false);
      }
      if (fired) this.jumpBufT = 0; else this.jumpBufT -= dt;
    }
    if (this.edgeS >= 0) {
      if (!this.grounded || this.zip) this.edgeS = -1;
      else if (b.s >= this.edgeS - b.vs * 0.03) { this.edgeS = -1; this.jump(RCFG.jumpV, false); }
    }
  }

  // A jump pressed a little BEFORE the take-off edge of a plain gap would land in the hole: hold it until the edge
  // (only when jumping right now would not clear the gap anyway). Returns true when the jump is being held.
  edgeAssist() {
    const b = this.b;
    if (!this.grounded) return false;
    const g = this.gapEdgeAhead(b.s, b.vs * 0.2);
    if (!g) return false;
    let v = RCFG.jumpV;
    if (this.superT > 0) v *= RCFG.superJumpK;
    if (this.buffs.has('yay')) v *= 1.35;
    const fl = flightDist(b.vs, v, 0, RCFG.gravity * (this.inZone === 'lowgrav' ? 0.5 : 1));
    if (b.s + fl >= g.far + 0.3) return false;      // jumping right now already clears it
    this.edgeS = g.edge;
    return true;
  }

  gapEdgeAhead(s, maxD) {
    const tr = this.track;
    let p = tr.pieceAt(s);
    for (let k = 0; k < 2 && p; k++) {
      if (p.kind === 'gapJump' && p.gapS0 !== undefined && p.gapS0 > s && p.gapS0 - s <= maxD) {
        const r = this._gapRes || (this._gapRes = { edge: 0, far: 0 });
        r.edge = p.gapS0; r.far = p.gapS1;
        return r;
      }
      p = tr.pieceAt(p.s1 + 0.1);
    }
    return null;
  }

  // Double-tap: ride a sled (Subway's hoverboard) — one free crash for its duration, then a cooldown.
  trySled() {
    const { ui } = this.ctx;
    const meta = this.ctx.meta;
    if (this.sledT > 0) return;
    if (this.sledCdT > 0 || this.helmetT > 0 || this.helmet) {
      if ((meta?.sleds?.() ?? 0) > 0) ui.toastSoft?.(this.sledCdT > 0 ? `Kızak ${Math.ceil(this.sledCdT)} sn sonra hazır` : 'Zaten korunuyorsun');
      return;
    }
    if (meta?.useSled?.()) {
      this.sledT = this.dur('sled');
      this.ctx.audio.milestone(2);
      this.float('KIZAK!', 'big');
      this.powerups = (this.powerups || 0) + 1; meta?.track?.('powerup', { kind: 'sled' });
    }
  }

  // ---------- junctions (Temple Run turns) ----------
  // Consumes track.junctionAt(s) -> { s0, s, dir, id } (the junction whose [s0 - 60, s + 6] contains s, else null).
  // Inside the window [s0, s) a swipe toward `dir` is a TURN. Passing the corner without one is the barrier (lethal).
  juncTick(b, tr) {
    const { ui } = this.ctx;
    const J = tr.junctionAt ? tr.junctionAt(b.s) : null;
    this.jnJ = J;
    if (!J) {
      if (this.jnId !== null) { this.jnId = null; this.jnOpen = false; this.jnNear = false; this.juncSlow = false; this.cornerK = 0; }
      return null;
    }
    const id = J.id !== undefined ? J.id : J.s;
    if (id !== this.jnId) {
      this.jnId = id;
      this.jnDone = false;
      this.jnOpen = false;
      this.jnTut = (this.ctx.save.runnerTurnHints?.() ?? 9) < 1;
    }
    const vs = Math.max(b.vs, 1);
    const win = Math.max(J.s - J.s0, RCFG.juncMinSecs * vs);     // never shorter than ~0.9 s at the current speed
    const sA = this.jnSA = J.s - win;
    const grace = this.jnGrace = Math.max(0.8, 0.06 * vs);
    this.jnNear = b.s >= sA - vs;
    const open = !this.jnDone && b.s >= sA && b.s <= J.s + grace;
    if (open) {
      if (!this.jnOpen) {
        this.jnCueT = -1;
        this.tip('turn', 'VİRAJ: köşede dönüş yönüne kaydır!', false);
        if (this.jnTut) {
          this.juncSlow = true;
          ui.hint?.(true, J.dir > 0 ? 'SAĞA KAYDIR ➜' : '⬅ SOLA KAYDIR');
        }
      }
      if (this.time - this.jnCueT >= 0.08) {
        this.jnCueT = this.time;
        ui.turnCue?.(J.dir, clamp((b.s - sA) / Math.max(1, J.s - sA), 0, 1));
      }
    } else if (this.jnOpen) {
      ui.turnCue?.(0, 0);
      this.juncSlow = false;
    }
    this.jnOpen = open;
    if (!this.jnDone && b.s > J.s + grace) this.missTurn(J);
    return J;
  }

  commitTurn(J, auto) {
    const { ui, audio, platform } = this.ctx;
    this.jnDone = true;
    this.jnOpen = false;
    this.juncSlow = false;
    ui.turnCue?.(0, 0);
    ui.hint?.(false);
    if (auto) return;
    this.turns++;
    this.score += 100 * this.mult;
    this.addFlow(4);
    if (audio.turn) audio.turn(); else audio.whoosh();
    platform.haptic('select');
    this.kick += 2.5;
    this.jnLean = J.dir * 0.22;
    this.jnLeanT = 0.45;
    this.camLookBias = J.dir * 1.6;
    this.camLookBiasT = 0.7;
    this.mistBurst(6, 0xffffff, 3, 0.9);
    ui.runnerTurnOk?.(J.dir);
    this.ctx.meta?.track?.('turn', {});
    const hints = this.ctx.save.runnerTurnHints?.();
    if (hints !== undefined && hints < 3) { this.float('DÖN!', 'big'); this.ctx.save.addRunnerTurnHint?.(); }
    if (this.tut) this.ctx.save.setRunnerTutDone?.();         // the first real turn ends the tutorial run for good
  }

  // Passed the corner without turning: shields / flying forgive it, the very first junctions ever teach, otherwise: the barrier.
  missTurn(J) {
    const { ui } = this.ctx;
    this.jnDone = true;
    this.jnOpen = false;
    this.juncSlow = false;
    ui.turnCue?.(0, 0);
    ui.hint?.(false);
    if (this.rocketT > 0 || this.zip) { this.jnDone = true; return; }
    if (this.jnTut && this.jnTutMiss < 2) {
      this.jnTutMiss++;
      this.float('KAYDIR!', 'bad');
      return;
    }
    if (this.absorbShield(null)) {
      // the shield / sled / kabuk takes it: the ball is turned for you, you stumble
      this.openStumble();
      this.float('KALKAN KURTARDI!', 'big');
      this.kick += 2;
      return;
    }
    // The barrier: the ball keeps going straight while the road bends away under it, drifts to the OUTSIDE of the corner
    // and runs into the red-white wall (wallStep decides the moment of impact).
    const turn = (J.Lc > 0 && J.R > 0) ? 0.9 * J.Lc / J.R : 1.0;      // heading change of the corner (rad)
    this.wallRun = { dir: J.dir, sC: J.s, Lc: Math.max(4, J.Lc || 8), turn: Math.min(1.3, Math.max(0.6, turn)), t: 0 };
    this.killKind = 'wall';
    this.rage = null;
    this.jumpBufT = 0;
    this.edgeS = -1;
    this.ctx.audio.bump(0.6);
  }

  // A missed turn in progress: the road bends by `turn` over Lc metres, the ball does not. Contact with the barrier = death.
  wallStep(dt, hw) {
    const w = this.wallRun, b = this.b;
    w.t += dt;
    const x = clamp((b.s - w.sC) / w.Lc, 0, 1);
    const ang = w.turn * x * x * (3 - 2 * x);                        // road heading relative to the ball's straight line
    b.u -= w.dir * b.vs * Math.sin(ang) * dt;                         // outside of the corner is -dir
    const wall = hw - 0.45 - b.r * 0.85;                              // the barrier's inner face (track.js _build_junction)
    if (b.s > w.sC + w.Lc * 1.5 || w.t > RCFG.wallMaxT || -w.dir * b.u >= wall) {
      if (-w.dir * b.u > wall) b.u = -w.dir * wall;
      this.hitWall();
    }
  }

  hitWall() {
    const b = this.b;
    this.wallRun = null;
    this.crashes++;
    this.layersLost++;
    this.ctx.meta?.track?.('crash', {});
    b.vs = 0;
    this.crashFx(40);
    this.ctx.audio.crash(1);
    this.ctx.audio.bump(1);
    this.die('wall');
  }

  // ---------- hunger ----------
  hungerTick(dt) {
    const b = this.b, ui = this.ctx.ui;
    if (this.meltGraceT > 0) this.meltGraceT -= dt;
    const melting = this.meltK > 0 && this.time >= RCFG.meltGrace && this.meltGraceT <= 0
      && !this.zip && this.rocketT <= 0 && this.invulnT <= 0 && !this.buffs.has('donma');
    if (melting) {
      this.grow -= meltRate(this.tier, b.s, RCFG, this.meltK) * dt;
      if (this.grow < 0) {
        if (this.tier > 0) { this.tier--; this.grow += 1; this.onMeltDrop(); }
        else { this.grow = 0; this.state === 'play' && this.die('melt'); return; }
      }
    }
    this.syncRadius();
    const warn = this.meltK > 0 && this.tier === 0 && this.grow < 0.5;
    if (warn && melting) {
      this.meltWarnT -= dt;
      if (this.meltWarnT <= 0) { this.meltWarnT = 5; this.float('ERİYORSUN!', 'bad'); this.ctx.platform.haptic('warning'); }
    } else if (!warn) this.meltWarnT = 0;
    this.hungerWarn = warn;
    ui.hunger?.(this.hungerFrac(), warn);
  }

  // A tier lost to melting: no Yeti, no stumble — just a soft blue puff.
  onMeltDrop() {
    this.syncRadius();
    this.mistBurst(8, 0xaed8ff, 2.5, 0.9);
    this.squash = Math.max(this.squash, 0.25);
    this.ctx.platform.haptic('light');
    this.ctx.audio.pop(0.25, 0);
  }

  // Hardness grows smoothly with distance (never in one step at a layer boundary).
  hardTick() {
    if (this.level || this.b.s < this.hardS + 60) return;
    this.hardS = this.b.s;
    const k = Math.min(3, this.baseHard * (1 + RCFG.hardRamp * this.b.s / RCFG.layerLen));
    this.obstacles.setHardness?.(k);
    this.track.setHardness?.(k);
  }

  // ---------- buff cards ----------
  buffTick(dt) {
    const ui = this.ctx.ui;
    this.buffs.update(dt, this._onBuffEnd);
    if (this.buffs.size) {
      this.buffTickT -= dt;
      if (this.buffTickT <= 0) { this.buffTickT = 0.25; ui.buffTick?.(this.buffs.list); }
    }
    if (!this.level) {
      this.buffT -= dt;
      if (this.buffT <= 0) {
        if (this.jnNear || this.zip || this.rocketT > 0) this.buffT = 1.5;     // not in the middle of a corner approach
        else if (this.tut) this.grantBuff();
        else if (this.gate) this.buffT = 2;                       // the very first run keeps the old auto card
        else { this.spawnGate(); this.buffT = rand(RCFG.buffEvery[0], RCFG.buffEvery[1]); }
      }
    }
    if (this.cardRiskT > 0) this.cardRiskT -= dt;
    if (this.gate) this.gateTick(dt);
  }

  // KART KAPISI: ~60 m ahead two card billboards across the outer lanes (left / right): one SAFE, one RİSKLİ (longer card, but
  // the Yeti closes in and you run +8% for a while). Rolling through one grants it; missing both grants nothing.
  spawnGate() {
    const b = this.b, tr = this.track;
    const a = rollBuff(this.buffs, Math.random, this.lastBuff);
    let r = rollBuff(this.buffs, Math.random, a.id), k = 0;
    while (r.id === a.id && k++ < 6) r = rollBuff(this.buffs, Math.random, a.id);
    if (r.id === a.id) r = BUFFS.find((x) => x.id !== a.id);
    const flip = Math.random() < 0.5;
    const cards = [{ def: a, risky: false, secs: BUFF_LEN }, { def: r, risky: true, secs: Math.round(BUFF_LEN * 1.6) }];
    if (flip) cards.reverse();
    const gs = b.s + 75;
    const g = new THREE.Group();
    const n = LANES.length, us = [LANES[0], LANES[n - 1]];
    const poleG = this._gatePoleG || (this._gatePoleG = new THREE.CylinderGeometry(0.07, 0.07, 3.6, 5).translate(0, 1.8, 0));
    const poleM = this._gatePoleM || (this._gatePoleM = new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const planeG = this._gatePlaneG || (this._gatePlaneG = new THREE.PlaneGeometry(2.8, 2.1));
    g.userData.mats = []; g.userData.cards = [];
    for (let i = 0; i < 2; i++) {
      const c = cards[i], x = us[i];
      let mat;
      if (typeof document !== 'undefined') {
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 192;
        const cx = cv.getContext('2d');
        cx.fillStyle = c.risky ? '#d8352a' : '#2a9d5c'; cx.fillRect(0, 0, 256, 192);
        cx.strokeStyle = '#17345c'; cx.lineWidth = 10; cx.strokeRect(5, 5, 246, 182);
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.font = '72px system-ui, sans-serif'; cx.fillStyle = '#fff'; cx.fillText(c.def.icon, 128, 70);
        cx.font = '900 30px system-ui, sans-serif'; cx.lineWidth = 6; cx.strokeStyle = '#17345c';
        const nm = c.def.name.toLocaleUpperCase('tr-TR');
        cx.strokeText(nm, 128, 128); cx.fillText(nm, 128, 128);
        cx.font = '900 20px system-ui, sans-serif'; cx.fillStyle = c.risky ? '#ffe066' : '#d6ffe4';
        cx.fillText(c.risky ? 'RİSKLİ · UZUN' : 'GÜVENLİ', 128, 164);
        mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.DoubleSide });
      } else mat = new THREE.MeshBasicMaterial({ color: c.risky ? 0xd8352a : 0x2a9d5c, side: THREE.DoubleSide });
      g.userData.mats.push(mat);
      const m = new THREE.Mesh(planeG, mat);
      m.position.set(x, 3.4, 0); m.scale.setScalar(1.2);
      g.add(m); g.userData.cards.push(m);
      for (const dx of [-1.75, 1.75]) { const p = new THREE.Mesh(poleG, poleM); p.position.set(x + dx, 0, 0); g.add(p); }
    }
    tr.frame(gs, _f);
    tr.toWorld(gs, 0, 0, _v);
    g.position.copy(_v);
    _x.copy(_f.right).negate();
    _m.makeBasis(_f.right, _f.up, _x.crossVectors(_f.right, _f.up));
    g.quaternion.setFromRotationMatrix(_m);
    this.ctx.scene.add(g);
    this.gate = { s: gs, g, cards, us, done: false, clrT: 0, t: 0 };
    const ui = this.ctx.ui, sd = (k) => (cards[k].risky ? 'RİSKLİ' : 'GÜVENLİ');
    ui.holdCentre?.(true);
    ui.toastSoft?.(`◀ ${sd(0)} · ${sd(1)} ▶`, { prio: 3, drop: true });
    this.obstacles.clearRange?.(gs - 15, gs + 15);
  }

  gateTick(dt) {
    const G = this.gate, b = this.b;
    G.t += dt;
    const cs = G.g.userData.cards, pu = 1 + 0.03 + 0.03 * Math.sin(G.t * 5);
    for (let k = 0; k < cs.length; k++) { cs[k].position.y = 3.4 + 0.08 * Math.sin(G.t * 2.2 + k * 1.7); cs[k].scale.setScalar(1.2 * pu); }
    if (!G.done) {
      G.clrT -= dt;
      if (G.clrT <= 0) { G.clrT = 0.4; this.obstacles.clearRange?.(G.s - 15, G.s + 15); }
      if (b.s >= G.s) {
        G.done = true;
        const w = RCFG.laneW * 0.6;
        const i = Math.abs(b.u - G.us[0]) < w ? 0 : Math.abs(b.u - G.us[1]) < w ? 1 : -1;
        if (i >= 0) {
          const c = G.cards[i];
          this.grantBuff(c.def, c.secs);
          this.ctx.ui.toastSoft?.(`${c.def.icon} ${c.def.name.toLocaleUpperCase('tr-TR')}${c.risky ? ' · RİSKLİ' : ''}`, { prio: 2 });
          this.burst(10, c.risky ? 0xff5040 : 0xffe066, 4);
          if (c.risky) { this.cardRiskT = 20; this.gap = Math.max(4, this.gap - 2); }
          G.g.visible = false;
        }
        this.gateRelease();
      }
    } else if (b.s > G.s + 25) this.killGate();
  }

  gateRelease() {
    this.ctx.ui.holdCentre?.(false);
  }

  killGate() {
    const G = this.gate;
    if (!G) return;
    if (!G.done) { G.done = true; this.gateRelease(); }
    this.ctx.scene.remove(G.g);
    for (const m of G.g.userData.mats) { m.map?.dispose(); m.dispose(); }
    this.gate = null;
  }

  // A random temporary card (90 s). Max 3 active: a new one replaces the one with the least time left; the same card
  // just refreshes. The game never pauses — ui.buffAdd plays the card animation at the top edge.
  grantBuff(forced, secs = BUFF_LEN) {
    const { ui, audio, platform } = this.ctx;
    const def = forced || rollBuff(this.buffs, Math.random, this.lastBuff);
    this.lastBuff = def.id;
    const res = this.buffs.add(def.id, secs);
    if (!res) return;
    if (res.replaced) ui.buffRemove?.(res.replaced.id);
    this.buffT = rand(RCFG.buffEvery[0], RCFG.buffEvery[1]);
    if (ui.buffAdd) ui.buffAdd(def.id, def.icon, def.name, secs);
    else this.float(`${def.icon} ${def.name.toLocaleUpperCase('tr-TR')}`, 'big');
    if (def.id === 'akis') this.flow = Math.min(100, this.flow + 25);
    if (def.id === 'yetikov') this.stumbleT = 0;
    this.syncRadius();
    if (!ui.buffAdd) { if (audio.chime) audio.chime(); else audio.milestone(3); }     // (ui.buffAdd plays the chime itself)
    platform.haptic('success');
    this.ctx.meta?.track?.('perk', { id: def.id });
  }

  // The kabuk card is spent by absorbing one hit.
  spendBuff(id) {
    const e = this.buffs.remove(id);
    if (e) this.ctx.ui.buffRemove?.(id);
  }

  // ---------- the Yeti ----------
  yetiTick(dt, top) {
    const b = this.b;
    if (this.baitT > 0) {                      // the Yeti is busy eating the bait
      this.baitT -= dt;
      if (!this.boss) { this.baitBonus += b.vs * dt; this.stumbleT = 0; this.yetiHoldT = 0; }
      if (this.baitT <= 0) this.baitT = 0;
      if (!this.boss) return;
    } else if (this.baitBonus > 0) this.baitBonus = Math.max(0, this.baitBonus - (this.baitBonus > 12 ? 14 : 1.5) * dt);
    if (this.bread && !this.boss && this.baitT <= 0 && this.gap <= 6) this.useBread();
    if (this.bait > 0 && !this.boss && this.stumbleT > 0 && this.stumbleHits >= 2) this.useBait(true);     // about to be caught: auto-use
    const far = this.buffs.has('yetikov');
    if (this.boss) { if (this.stumbleT > 0) this.stumbleT = Math.max(0, this.stumbleT - dt); this.gap = RCFG.yetiMax; return; }
    if (far) {
      // The repellent: no window, no hold — it drops back and stays far.
      this.stumbleT = 0;
      this.yetiHoldT = 0;
      this.gap = Math.min(RCFG.yetiMax, this.gap + 6 * dt);
    } else if (this.yetiHoldT > 0) {
      this.yetiHoldT -= dt;
      this.gap = Math.min(this.gap, RCFG.yetiStart + (this.gapBonus || 0));
    } else if (this.stumbleT > 0) {
      this.stumbleT -= dt;
      this.gap += ((this.stumbleHits >= 2 ? RCFG.yetiStumbleGap - 2.2 : RCFG.yetiStumbleGap) - this.gap) * Math.min(1, dt * 4);
      if (this.stumbleT <= 0) {
        this.stumbleT = 0;
        this.score += 50 * this.mult;
        this.float('KURTULDUN!', 'big');
      }
    } else if (b.vs >= top * RCFG.yetiStumbleSpeed) {
      this.gap = Math.min(RCFG.yetiMax, this.gap + RCFG.yetiRecover * dt);
    } else {
      this.gap = Math.max(RCFG.yetiStart, this.gap - (top * RCFG.yetiStumbleSpeed - b.vs) * 0.32 * dt);
    }
    if (this.stumbleT > 0) this.minGap = Math.min(this.minGap, this.gap);
    this.roarT -= dt;
    if (this.gap < 8 && !this._chaseHot && this.roarT <= 0) { this.roarT = 6; this.roar(true); }   // edge-triggered + rate-limited
    this._chaseHot = this.gap < 8;
  }

  /** BALIK YEMİ: drops the bait; the Yeti stops to eat it for 3 s (gap +12 m and more, no stumble window); in the boss phase it skips the next throw. */
  useBait(auto) {
    if (this.bait <= 0 || this.baitT > 0 || this.state !== 'play') return false;
    if (!(this.boss || this.stumbleT > 0 || this.gap < 9)) return false;
    this.bait--; this.baitT = 3; this.baitBonus = Math.max(this.baitBonus, 12);
    if (this.boss) this.boss.baitSkip = 1;
    this.stumbleT = 0; this.stumbleHits = 0; this.yetiHoldT = 0;
    this.roar(true); this.ctx.audio.chime?.(); this.ctx.platform.haptic('success');
    this.float('🐟 AFİYET OLSUN!', 'big');
    this.baitChip();
    this.ctx.meta?.track?.('bait_use', { auto: !!auto, boss: !!this.boss });
    return true;
  }

  /** YETİ EKMEĞİ: a warm bread held (max 1); auto-used when the Yeti is within 6 m: it stops to sniff it for 3 s (gap +10 m). */
  useBread() {
    if (!this.bread || this.baitT > 0 || this.state !== 'play') return false;
    this.bread = 0; this.baitT = 3; this.baitBonus = Math.max(this.baitBonus, 10);
    this.stumbleT = 0; this.stumbleHits = 0; this.yetiHoldT = 0;
    this.roar(true); this.ctx.audio.chime?.(); this.ctx.platform.haptic('success');
    this.float('🥐 YETİ KOKLUYOR', 'big');
    this.breadChip();
    return true;
  }

  _col() {
    let c = document.getElementById('rcol');
    if (!c) { c = document.createElement('div'); c.id = 'rcol'; document.body.appendChild(c); }
    return c;
  }
  _chipEl(key, bottom) {
    let el = this[key];
    if (!el) {
      el = this[key] = document.createElement('div');
      el.className = 'rcol-chip';
      this._col().appendChild(el);
    }
    return el;
  }
  breadChip() {
    if (!this.bread && !this._breadEl) return;
    const el = this._chipEl('_breadEl', 41);
    el.style.display = this.bread ? 'block' : 'none';
    el.textContent = '🥐';
  }
  cannonChip() {
    if (!this._cannonEl && !(this.cannonN > 0)) return;
    const el = this._chipEl('_cannonEl', 27);
    el.style.display = this.cannonN > 0 ? 'block' : 'none';
    el.textContent = '❄️×' + Math.max(0, this.cannonN);
  }

  scarfChip() {
    let el = this._scarfEl;
    if (!this.seasonTokens) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = this._scarfEl = document.createElement('div');
      el.className = 'rcol-chip';
      this._col().appendChild(el);
    }
    el.style.display = 'block';
    el.textContent = '🧣' + this.seasonTokens;
  }

  baitChip() {
    let el = this._baitEl;
    if (!this.bait) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = this._baitEl = document.createElement('div');
      el.className = 'rcol-chip tap';
      el.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.useBait(false); });
      this._col().appendChild(el);
    }
    el.style.display = 'block';
    el.textContent = '🐟×' + this.bait;
  }

  /** A stumble: the Yeti is right behind you for a while; a second crash inside the window catches you. */
  openStumble() {
    if (this.buffs.has('yetikov') || this.baitT > 0) return;
    const layerK = Math.min(4, this.layer);
    this.stumbleMax = Math.min(6, RCFG.stumbleWin + 0.25 * layerK) * (1 - 0.04 * Math.min(5, this.perm.yeti || 0));
    if (this.stumbleT <= 0) this.stumbleHits = 1;
    this.stumbleT = this.stumbleMax;
    this.gap = Math.min(this.gap, RCFG.yetiStumbleGap + 4);
    this.yetiHoldT = 0;
    this.stumbles++;
  }

  // Difficulty layers, speed steps, the skill-combo ("AKIŞ") and record moments.
  progression(dt) {
    const b = this.b;
    const { ui, audio, platform } = this.ctx;
    const layer = this.level ? 0 : Math.floor(b.s / RCFG.layerLen);
    if (layer > this.layer) this.layerUp(layer);
    const tier = Math.floor((speedAt(b.s) - RCFG.startSpeed) / 3.2);
    if (tier > this.speedTier) {
      this.speedTier = tier;       // a speed step: a felt kick and a puff of wind, no flash and no text
      this.kick += 3;
      this.trauma = Math.min(1, this.trauma + 0.12);
    }
    this.gustTick(dt);
    this.stormTick(dt);
    // Flow decays when you stop doing skilful things.
    this.flowT -= dt;
    if (this.flowT <= 0 && this.flow > 0) this.flow = Math.max(0, this.flow - 18 * (this.buffs.has('akis') ? 0.5 : 1) * (1 - 0.06 * Math.min(5, this.perm.flow || 0)) * dt);
    const lvl = this.flow >= 98 ? 4 : this.flow >= 48 ? 3 : this.flow >= 18 ? 2 : this.flow >= 6 ? 1 : 0;
    if (lvl !== this.flowLvl) {
      if (lvl > this.flowLvl) {
        this.float(['', 'AKIŞ!', 'SÜPER AKIŞ!', 'EFSANE AKIŞ!', 'DURDURULAMAZ!'][lvl], 'big');
        audio.star(Math.min(2, lvl - 1));
        platform.haptic('success');
      }
      this.flowLvl = lvl;
    }
    const ff = Math.round(this.flow);
    if (this.flowLvl !== this._flowL || ff !== this._flowF) { this._flowL = this.flowLvl; this._flowF = ff; ui.runnerFlow?.(this.flowLvl, this.flow / 100); }
    // Records.
    if (!this.passedDist && b.s > this.bestDist) {
      this.passedDist = true;
      this.rcpAdd('rec');
      // ONE record moment per run: a single top-edge toast (the HUD's score-record toast counts as it), never a centre banner
      if (!ui._recShown) { ui._recShown = true; ui.toastSoft?.(`★ YENİ REKOR! +${RCFG.recCoins} ❄️`, { prio: 2 }); }
      audio.win();
      platform.haptic('success');
      if (!this.level) {
        this.newRecT = 4;
        this.coins += RCFG.recCoins;
      }
    }
    if (this.newRecT > 0) this.newRecT -= dt;
    if (!this.passedScore && this.score > this.bestScore) this.passedScore = true;   // the HUD shows the one score-record toast
    ui.runnerRecord?.(this.bestDist, b.s);
    this.placeRecordFlag();
    this.landmarkTick();
    this.ghostTick();
    this.bossIntroTick();
    this.patchScene();
  }

  // ÇIĞ RÜZGÂRI (from 1.5 km): a 4-6 s crosswind, telegraphed ~1.5 s ahead by sideways snow streaks + a wind sound. Drives this.gustK / gustDir
  // (the lane-spring bias in step()); the obstacle spawner keeps lethal rows out of the whole zone (gustAt).
  gustTick(dt) {
    const b = this.b, vs = b.vs || 20;
    const calm = this.level || this.zip || this.grind || this.wallRun || this.jnNear || this.boss || this.inZone === 'boss' || this.rocketT > 0 || this.state !== 'play';
    const lead = Math.max(35, 1.5 * vs);
    const g = calm ? null : gustAt(b.s, lead);
    let want = 0, tele = false;
    if (g && b.s <= g.s1) {
      if (b.s >= g.s0) want = Math.min(1, (g.s1 - b.s) / 12, (b.s - g.s0) / 8 + 0.15);
      else tele = true;
      if (this.gustDir !== g.dir && this.gustK < 0.05) this.gustDir = g.dir;
      if (tele || want > 0) this.gustDir = g.dir;
      if (tele && !this.gustWarn) { this.gustWarn = true; this.float(g.dir < 0 ? '◀ ÇIĞ RÜZGÂRI' : 'ÇIĞ RÜZGÂRI ▶', 'big'); }
    } else this.gustWarn = false;
    this.gustK += (want - this.gustK) * Math.min(1, dt * 4);
    if (!(tele || want > 0)) return;
    this.gustSndT -= dt;
    if (this.gustSndT <= 0) { this.gustSndT = 0.7; this.ctx.audio.whoosh?.(); }
    // sideways snow streaks across the view (a bit of them already while telegraphing)
    const fx = this.ctx.fx;
    if (!fx?.puff) return;
    const n = (tele ? 0.45 : 1) * dt * 55, cnt = Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0);
    if (!cnt) return;
    this.track.frame(b.s, _f);
    const d = this.gustDir;
    for (let i = 0; i < cnt; i++) {
      const ahead = 4 + Math.random() * 26, side = -d * (5 + Math.random() * 7);
      this.track.toWorld(b.s + ahead, b.u + side, 0.8 + Math.random() * 3.5, _v);
      fx.puff(_v.x, _v.y, _v.z, _f.right.x * d * 22, 0, _f.right.z * d * 22, 0.35, 0.55, 0xffffff, 0.55);
    }
  }

  // Hook the runner's meshes into the shared shader look (visual modes, snow sparkle). Cheap: only re-walks
  // the groups when their child count changes (new track pieces).
  patchScene() {
    const gs = this._groups;
    gs.length = 0;
    if (this.track?.group) gs.push(this.track.group);
    if (this.obstacles?.group) gs.push(this.obstacles.group);
    if (this.env?.group) gs.push(this.env.group);
    let n = 0;
    for (let i = 0; i < gs.length; i++) n += gs[i].children.length;
    if (n === this.patchedCount) return;
    this.patchedCount = n;
    for (const g of gs) {
      g.traverse((o) => {
        if (!o.isMesh || o.isPoints) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m && (m.isMeshLambertMaterial || m.isMeshPhongMaterial) && !m.userData.noPatch && !m.onBeforeCompile.toString().includes('CIG')) {
            const snowy = g === this.track?.group;
            patchMaterial(m, { snow: snowy });
          }
        }
      });
    }
  }

  // Soft blob shadow on the track surface under the ball (grounds it visually; shrinks as it flies).
  makeShadow() {
    if (this.shadow) return;
    let tex = null;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c = cv.getContext('2d');
      const grd = c.createRadialGradient(32, 32, 3, 32, 32, 32);
      grd.addColorStop(0, 'rgba(20,40,80,0.6)');
      grd.addColorStop(1, 'rgba(20,40,80,0)');
      c.fillStyle = grd;
      c.fillRect(0, 0, 64, 64);
      tex = new THREE.CanvasTexture(cv);
    }
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x203050, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    this.ctx.scene.add(this.shadow);
  }

  placeShadow() {
    const sh = this.shadow;
    if (!sh) return;
    const b = this.b;
    const surf = this.track.surfaceAt(b.s, b.u);
    sh.visible = surf !== -Infinity && this.state !== 'idle' && !this.zip && !this.off;
    if (!sh.visible) return;
    this.track.frame(b.s, _f);
    this.track.toWorld(b.s, b.u, surf + 0.05, _v);
    sh.position.copy(_v);
    _x.crossVectors(_f.right, _f.up);
    _m.makeBasis(_f.right, _x.negate(), _f.up);
    sh.quaternion.setFromRotationMatrix(_m);
    const lift = Math.max(0, b.h - surf);
    const k = 1 / (1 + lift * 0.18);
    sh.scale.setScalar(this.rShown * 2.6 * (0.6 + 0.4 * k));
    sh.material.opacity = 0.8 * k;
  }

  // A layer boundary is also a checkpoint: a few coins, a soft toast, a buff card and the next rule-change zone.
  // Nothing here blocks the view (no banner cluster) and nothing pauses.
  layerUp(layer) {
    const { ui, audio, platform } = this.ctx;
    const rage = this.rageEnd(layer);   // 1 survived the barrage, -1 crashed in it, 0 no barrage
    this.layer = layer;
    this.stageZone(layer);
    // Checkpoint: a few coins through the normal run-coin path (banked with the run, like flakes).
    const pay = checkpointReward(layer, RCFG.cpCoins);
    this.coins += pay;
    const text = `✔ ${layer * RCFG.layerLen} m · +${pay} ❄️`;
    if (ui.toastSoft) ui.toastSoft(text); else this.queueBanner(`✔ ${layer * RCFG.layerLen} m`, 3);
    if (rage <= 0) audio.star(2);
    platform.haptic('success');
    ui.runnerGoalPop?.();
    this.after(1.1, () => audio.milestone(Math.min(5, 2 + (layer >> 1))));
    this.ctx.meta?.track?.('layer', { layer: layer + 1 });
  }

  // ui.banner is a single slot: queue banners so they show one after another instead of stomping.
  queueBanner(text, level, hold = 1.05, urgent = false) {
    const ls = this._bnSeen.get(text);
    if (ls !== undefined && this.time - ls < 4) return;
    this._bnSeen.set(text, this.time);
    if (!urgent && level <= 3 && this.ctx.ui.toastSoft) { this.ctx.ui.toastSoft(text); return; }   // info/milestones: top edge, never the road
    if (urgent || (this.bannerT <= 0 && !this.bannerQ.length)) { this.ctx.ui.banner(text, level); this.bannerT = hold; }
    else this.bannerQ.push(text, level, hold);
  }

  tickBanner(rdt) {
    this.tickFloatQ();
    if (this.bannerT > 0) this.bannerT -= rdt;
    const q = this.bannerQ;
    if (this.bannerT <= 0 && q.length && !this.jnOpen) {
      this.ctx.ui.banner(q.shift(), q.shift());
      this.bannerT = q.shift();
    }
  }

  // Delayed callbacks that follow game time (setTimeout would outlive a restart and ignore pauses).
  after(sec, fn) { this.later.push({ t: sec, fn }); }

  tickLater(dt) {
    const q = this.later;
    for (let i = q.length - 1; i >= 0; i--) {
      const l = q[i];
      l.t -= dt;
      if (l.t <= 0) { q.splice(i, 1); l.fn(); }
    }
  }

  // "YETİ ÖFKESİ": over the last rageLen m of every layer (from layer 2 on) the Yeti throws boulders at your lane (the
  // same throwBoulder path the boss zone uses). Survive without a crash → it gives up: bonus, and it falls back.
  rageOk() {
    if (this.boss || this.inZone === 'boss' || this.zip || this.grind || this.rocketT > 0 || this.jnNear) return false; // boss zone / rope / rail / corner already own the moment
    return !RAGE_SKIP.has(this.track.pieceAt(this.b.s)?.kind);
  }

  rageTick(dt) {
    return;   // YETİ ÖFKESİ barrages (boulders thrown from behind) are off
    // eslint-disable-next-line no-unreachable
    if (this.level || this.layer < 2 || this.layer % 2) return;   // campaign has no layers; endless: only every 2nd layer (2, 4, 6 …)
    const b = this.b, L = RCFG.layerLen;
    const B = (Math.floor(b.s / L) + 1) * L;
    let r = this.rage;
    if (!r) {
      if (b.s < B - Math.max(RCFG.rageLen, b.vs * RCFG.rageSecs) || b.s > B - 40 || !this.rageOk() || this.stumbleT > 0) return;
      r = this.rage = { s0: b.s, B, t: 0.9, n: 0, crashes0: this.crashes };
      this.roar(true);
      this.queueBanner('YETİ ÖFKESİ!', 4, 1.1, true);
      return;
    }
    r.t -= dt;
    if (r.t > 0) return;
    if (!this.rageOk() || this.stumbleT > 0) { r.t = 0.6; return; }   // never pile a boulder onto a stumble / a corner
    const sLand = b.s + b.vs * 1.8 + 9;             // lands ~9 m ahead of where you will be
    if (sLand > B - 6) { r.t = 1; return; }          // the last boulder lands before the boundary
    if (r.n >= (this.rageCount === 0 ? 2 : 3)) { r.t = 2; return; }  // a barrage is 2 boulders (first) / 3 at most
    const NLn = LANES.length, pl = Math.round(this.lane + (NLn - 1) / 2);
    const lane = Math.random() < 0.5 ? pl : (pl + 1 + ((Math.random() * (NLn - 1)) | 0)) % NLn;
    if (this.obstacles.throwBoulder(lane, sLand) < 0) { r.t = 0.8; return; }
    r.n++;
    r.t = rand(RCFG.rageEvery[0], RCFG.rageEvery[1]) * rageScale(this.layer);
    this.ctx.audio.bump(0.8);
    this.ctx.platform.haptic('warning');
  }

  // At the layer boundary: 1 survived (bonus, the Yeti falls back), -1 crashed during it, 0 it never got to throw.
  rageEnd(layer) {
    const r = this.rage;
    if (!r) return 0;
    this.rage = null;
    this.rageCount++;
    if (this.crashes !== r.crashes0) return -1;
    if (!r.n) return 0;
    const bonus = Math.round(150 * layer * this.mult);
    this.score += bonus;
    this.gap = Math.min(RCFG.yetiMax, this.gap + RCFG.rageBack);
    this.ctx.audio.win();
    this.ctx.platform.haptic('success');
    this.float('YETİ PES ETTİ!', 'big');
    this.after(0.35, () => this.float(`+${bonus.toLocaleString('tr-TR')}`, 'big'));
    return 1;
  }

  // Every layer the rules change (Jetpack Joyride-style zones) — announced ahead so you wonder what's next.
  stageZone(layer) {
    // Plain running is the default: a zone only on every 2nd layer (1.2 km apart), and the coin-rain bonanza at most once per run
    // and never before ~1.5 km (it is the 3rd zone, layer 6 = 3.6 km, or a later random pick).
    if (layer % 2) return;
    const ZONES = [
      { kind: 'movers', name: 'HAREKETLİ ENGELLER' },
      { kind: 'narrow', name: 'DAR KÖPRÜLER' },
      { kind: 'coinRain', name: 'KAR TANESİ YAĞMURU' },
      { kind: 'lasers', name: 'BUZ LAZERLERİ' },
      { kind: 'storm', name: 'FIRTINA' },
      { kind: 'lowgrav', name: 'DÜŞÜK YERÇEKİMİ', runner: true },
    ];
    const zi = layer / 2;
    let z = zi <= ZONES.length ? ZONES[zi - 1] : ZONES[Math.floor(Math.random() * ZONES.length)];
    if (z.kind === 'coinRain' && (this._rainDone || this.b.s < 1500)) z = ZONES[0];
    if (z.kind === 'coinRain') this._rainDone = true;
    const from = Math.max(this.b.s + 320, (this.zone && this.zone.until > this.b.s ? this.zone.until + 60 : 0)), until = from + 420;
    if (!z.runner) this.obstacles.setZone?.(z.kind, { from, until });
    this.zone = { ...z, from, until, announced: false };
  }

  zoneTick() {
    const z = this.zone;
    if (!z) return;
    const s = this.b.s;
    if (!z.announced && s >= z.from && !this.jnOpen) {
      z.announced = true;
      if (this.ctx.ui.toastSoft) this.ctx.ui.toastSoft(z.name, { prio: 2 }); else this.ctx.ui.banner(z.name, 4);     // top edge, never over the track
      this.ctx.audio.milestone(3);
      this.ctx.platform.haptic('success');
    }
    this.inZone = s >= z.from && s < z.until ? z.kind : null;
    if (s >= z.until) { this.zone = null; this.inZone = null; }
  }

  addFlow(n) {
    // first minute: the combo ceiling climbs slowly (8 + 0.25/s), so nobody is x15 at 15 s
    const cap = this.level ? 100 : Math.min(100, this.time < 60 ? 8 + this.time * 0.25 : 100);
    this.flow = Math.min(cap, this.flow + n);
    this.flowT = 1.8;
    // HUD KOMBO: its own earned counter. +1 per skill event (grind ticks don't count), at most one per 0.7 s,
    // breaks after 2 s without an event or on any hit.
    if (n >= 1 && !this.level) {
      const now = this.time || 0;
      if (!this.cmbAt || now - this.cmbAt >= 0.7) {
        this.cmbN = (this.cmbN || 0) + 1; this.cmbAt = now;
        if (this.cmbN > this.rcpN) { this.rcpN = this.cmbN; this.rcpS = this.b.s; }
        this.ctx.ui?.combo?.(this.cmbN);
      }
      this.cmbT = 2;
    }
  }

  breakCombo() {
    this.stormHit = true;
    if (this.cmbN) { this.cmbN = 0; this.cmbAt = 0; this.ctx.ui?.combo?.(0); }
    this.cmbT = 0;
  }

  // FIRTINA TÜNELİ: the last 100 m before every 1 km: snow-storm vignette + streaks; pass it without a hit = combo x2 + bonus.
  // YETİ RADYOSU: every km the sky/fog palette gets a subtle remix + a station toast (cosmetic only).
  radioTune(km) {
    const ST = [['Gün Batımı FM', 0xff9a6a], ['Kutup Işığı FM', 0x6affc8], ['Buz Lo-Fi', 0x8fb4ff], ['Pembe Kar FM', 0xff9ad0], ['Gece Vardiyası', 0x5a4cff], ['Altın Saat FM', 0xffd36a], ['Nane Esintisi', 0x9affb0]];
    const st = ST[(km - 1) % ST.length];
    this.env?.setRadio?.(st[1], 0.22);          // cosmetic palette remix only: no toast (one message at a time)
  }

  stormTick(dt) {
    if (this.cmbT > 0) { this.cmbT -= dt; if (this.cmbT <= 0 && this.cmbN) { const h = this.stormHit; this.breakCombo(); this.stormHit = h; } }
    if (this.level) return;
    const s = this.b.s, km = Math.floor(s / 1000), inZ = s >= 900 && s % 1000 >= 900;
    if (this.stormKm === undefined) this.stormKm = km;
    if (km > this.stormKm) {                       // crossed a milestone
      this.stormKm = km;
      if (km > 0) this.radioTune(km, true);
      if (this.stormOn && !this.stormHit) {
        this.cmbN = Math.max(2, (this.cmbN || 0) * 2); this.cmbAt = this.time; this.cmbT = 2;
        this.ctx.ui?.combo?.(this.cmbN);
        this.flow = Math.min(100, this.flow + 10);
        this.score += 400 * km * Math.max(1, this.mult);
        this.float('TEMİZ GEÇİŞ!', 'big');
        this.ctx.audio.milestone?.(4); this.ctx.platform.haptic('success');
      }
      this.stormOn = false;
    }
    if (inZ && !this.stormOn) { this.stormOn = true; this.stormHit = false; }
    this.stormFx(inZ && this.stormOn);
  }

  stormFx(on) {
    let el = this.stormEl;
    if (!on) { if (el && this._stormShown) { el.style.opacity = '0'; this._stormShown = false; } return; }
    if (this._stormShown && el && el.isConnected) return;
    if (!el || !el.isConnected) {
      el = this.stormEl = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity .6s;animation:stormMv .35s linear infinite;' +
        'background:radial-gradient(ellipse at center,rgba(255,255,255,0) 60%,rgba(190,225,255,.3) 100%),' +
        'repeating-linear-gradient(100deg,rgba(255,255,255,0) 0 18px,rgba(255,255,255,.1) 19px 20px,rgba(255,255,255,0) 21px 60px);' +
        'background-size:100% 100%,200px 200px;';
      if (!document.getElementById('stormKf')) {
        const st = document.createElement('style'); st.id = 'stormKf';
        st.textContent = '@keyframes stormMv{to{background-position:0 0,-200px 200px}}'; document.head.appendChild(st);
      }
      document.body.appendChild(el);
      void el.offsetWidth;
    }
    el.style.opacity = '1';
    this._stormShown = true;
  }

  // Distance landmark: one reusable gate across the track, re-labelled for the next 500 m milestone (endless only).
  landmarkTick() {
    if (this.level) return;
    const s = this.b.s;
    let next = this.lmNext;
    if (next === undefined || s > next + 25) next = this.lmNext = (Math.floor(s / 500) + 1) * 500;
    const ds = next - s;
    let g = this.lmGate;
    if (ds > 260 || ds < -25) { if (g) g.visible = false; return; }
    if (!g) {
      g = this.lmGate = new THREE.Group();
      const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const pl = new THREE.CylinderGeometry(0.22, 0.22, 8, 6).translate(0, 4, 0);
      g.add(new THREE.Mesh(pl, m));
      this.lmPr = new THREE.Mesh(pl, m); g.add(this.lmPr);
      this.lmBeam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 0.5).translate(0.5, 8, 0), new THREE.MeshLambertMaterial({ color: 0xe8322a }));
      g.add(this.lmBeam);
      const cv = this.lmCv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
      this.lmTex = new THREE.CanvasTexture(cv);
      this.lmBan = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9).translate(0, 6.9, 0), new THREE.MeshBasicMaterial({ map: this.lmTex, side: THREE.DoubleSide }));
      g.add(this.lmBan);
      this.ctx.scene.add(g);
    }
    if (this.lmLabel !== next) {
      this.lmLabel = next;
      const c = this.lmCv.getContext('2d');
      c.fillStyle = '#17345c'; c.fillRect(0, 0, 256, 96);
      c.lineWidth = 6; c.strokeStyle = '#ffd23a'; c.strokeRect(3, 3, 250, 90);
      c.fillStyle = '#fff'; c.font = '900 58px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(next % 1000 ? next + ' m' : next / 1000 + ' km', 128, 50);
      this.lmTex.needsUpdate = true;
      this.lmPassed = false;
    }
    g.visible = true;
    const tr = this.track, hw = (tr.halfWidth(next) || 3.8) + 0.8;
    tr.frame(next, _f);
    tr.toWorld(next, -hw, 0, _v);
    g.position.copy(_v);
    _x.copy(_f.right).negate();
    _m.makeBasis(_f.right, _f.up, _x.crossVectors(_f.right, _f.up));
    g.quaternion.setFromRotationMatrix(_m);
    this.lmPr.position.x = hw * 2;
    this.lmBeam.scale.x = hw * 2;
    this.lmBan.position.x = hw;
    if (ds <= 0 && !this.lmPassed) {
      this.lmPassed = true;
      this.kick += 1; this.ctx.audio.milestone?.(2);
      // gentle environment shift per 500 m (lerped by env.setRadio): snowfall -> clear -> sunset -> night
      const W = [[0xcfe3ff, 0.28, 0.35], [0xffffff, 0, 0], [0xff8a5a, 0.3, 0], [0x1a2a6a, 0.34, 0]], w = W[(next / 500) % 4 | 0];
      this.env?.setRadio?.(w[0], w[1]);
      this.wxFog = w[2]; this.wxT = w[2] ? 14 : 0;
    }
  }

  makeRecordFlag() {
    this.recFlag = null; return;                       // no record flag / line on the track (only the HUD 'REKOR n m' text)
    // eslint-disable-next-line no-unreachable
    if (this.bestDist < 50) { this.recFlag = null; return; }
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 6).translate(0, 3.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    g.add(pole);
    let mat;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 128;
      const c = cv.getContext('2d');
      c.fillStyle = '#e8322a'; c.fillRect(0, 0, 256, 128);
      c.fillStyle = '#fff'; c.font = '900 56px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 8; c.strokeStyle = '#17345c'; c.strokeText('REKOR', 128, 66); c.fillText('REKOR', 128, 66);
      mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.DoubleSide });
    } else mat = new THREE.MeshBasicMaterial({ color: 0xe8322a, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8).translate(1.8, 5.8, 0), mat);
    g.add(banner);
    // A glowing line across the track marks the exact spot.
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6), new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.75, depthWrite: false }));
    line.rotation.x = -Math.PI / 2;
    g.add(line);
    this.recLine = line;
    g.visible = false;
    this.ctx.scene.add(g);
    this.recFlag = g;
  }

  placeRecordFlag() {
    const f = this.recFlag;
    if (!f) return;
    const ds = this.bestDist - this.b.s;
    f.visible = ds > -20 && ds < 280;
    if (!f.visible) return;
    const tr = this.track;
    tr.frame(this.bestDist, _f);
    const hw = tr.halfWidth(this.bestDist) || 3.8;
    tr.toWorld(this.bestDist, -hw - 0.6, 0, _v);
    f.position.copy(_v);
    _x.copy(_f.right).negate();
    _m.makeBasis(_f.right, _f.up, _x.crossVectors(_f.right, _f.up));
    f.quaternion.setFromRotationMatrix(_m);
    this.recLine.scale.set(hw * 2 + 1.2, 1, 1);
    this.recLine.position.set(hw + 0.6, 0.06, 0);
  }


  // ---------- campaign boss levels: entrance in the last 150 m, celebration at the line ----------
  bossIntroTick() {
    const L = this.level;
    if (!L || !L.boss || this.bossIntro !== 0 || this.b.s < L.length - 150) return;
    this.bossIntro = 1;
    this.queueBanner('BOSS!', 5, 1.6, true);
    this.kick += 4; this.trauma = Math.min(1, this.trauma + 0.5); this.punch = Math.min(1.5, (this.punch || 0) + 1);
    this.roar?.(false);
    this.ctx.audio.milestone?.(5); this.ctx.platform.haptic('heavy');
  }

  bossWin() {
    this.bossIntro = 2;
    const bonus = Math.round(1500 * Math.max(1, this.mult || 1)), coins = 100;
    this.score += bonus; this.coins += coins;
    this.ctx.ui.runnerGoal?.(null);
    this.mistBurst(30, 0xffd060, 6, 1.4);
    this.ctx.menus?.confetti?.(140);
    this.ctx.audio.milestone?.(5);
    this.topMsg('BOSS YENİLDİ!', 'big');
    this.ctx.ui.float('+' + bonus.toLocaleString('tr-TR') + ' · +' + coins + ' ❄️', window.innerWidth * 0.5, window.innerHeight * 0.21, 'big');
  }

  // ---------- KAR YANKISI: ghost of your best Rush run (lane/height every 5 m, up to 5 km) ----------
  initGhost() {
    // record ghost disabled: no replayed best run, no recording
    this.gPlay = null; this.ghostRec = null; if (this.ghostMesh) this.ghostMesh.visible = false; return;
    // eslint-disable-next-line no-unreachable
    if (this.level) { this.ghost = this.ghost || null; if (this.ghostMesh) this.ghostMesh.visible = false; this.gPlay = null; return; }
    let g = null;
    try { const j = JSON.parse(localStorage.getItem('patpat.rush.ghost') || 'null'); if (j && j.t && j.t.length > 4 && j.t.length === j.u.length) g = j; } catch (e) { /* ignore */ }
    this.gPlay = g;                                   // { d: metres, t:[0.1 s], u:[0.1 u], h:[0.1 h] } index = 5 m step
    this.ghostRec = { t: new Int32Array(1000), u: new Int16Array(1000), h: new Int16Array(1000), n: 0 };
    if (this.ghostMesh) this.ghostMesh.visible = false;
  }

  ghostMeshMake() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0x9ae8ff, transparent: true, opacity: 0.32, depthWrite: false }));
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
      const c = cv.getContext('2d');
      c.font = '900 44px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 7; c.strokeStyle = '#17345c'; c.strokeText('REKOR', 128, 34); c.fillStyle = '#bff0ff'; c.fillText('REKOR', 128, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, depthTest: false }));
      sp.scale.set(3, 0.75, 1); sp.position.y = 1.9; sp.renderOrder = 10;
      m.add(sp);
    }
    this.ctx.scene.add(m);
    this.ghostMesh = m;
  }

  ghostTick() {
    if (!this.gPlay && !this.ghostRec) return;
    if (this.level || this.state !== 'play') return;
    const b = this.b, R = this.ghostRec;
    if (R) {
      const i = (b.s / 5) | 0;
      if (i >= R.n && i < 1000 && b.s > 0) { R.t[i] = Math.round(this.time * 10); R.u[i] = Math.round(b.u * 10); R.h[i] = Math.round(b.h * 10); R.n = i + 1; }
    }
    const G = this.gPlay;
    if (!G) return;
    const N = G.t.length, T10 = this.time * 10;
    // ghost position: the sample whose recorded time brackets now (ghost stays at its final spot after its run ended)
    let i = this.ghostIdx | 0;
    if (i >= N || (i > 0 && G.t[i] > T10)) i = 0;
    while (i < N - 1 && G.t[i + 1] <= T10) i++;
    this.ghostIdx = i;
    let gs, gu, gh;
    if (i >= N - 1) { gs = (N - 1) * 5; gu = G.u[N - 1] / 10; gh = G.h[N - 1] / 10; }
    else { const k = clamp((T10 - G.t[i]) / Math.max(1, G.t[i + 1] - G.t[i]), 0, 1); gs = (i + k) * 5; gu = (G.u[i] + (G.u[i + 1] - G.u[i]) * k) / 10; gh = (G.h[i] + (G.h[i + 1] - G.h[i]) * k) / 10; }
    const ds = gs - b.s;
    if (!this.ghostPassed && ds < -2 && b.s > 30) {
      this.ghostPassed = true;
      const bonus = 300; this.score += bonus; this.coins += 25;
      this.after(0.35, () => this.float('+' + bonus + ' · +25 ❄️', 'big'));
      this.ctx.audio.win?.(); this.ctx.platform.haptic('success');
    }
    if (!this.ghostMesh) this.ghostMeshMake();
    const gm = this.ghostMesh;
    gm.visible = ds > -60 && ds < 160;
    if (!gm.visible) return;
    this.track.toWorld(gs, gu, gh + b.r, _v);
    gm.position.copy(_v);
    gm.scale.setScalar(b.r);
    if (gm.children[0]) gm.children[0].position.y = 1.9 + 0.6 / Math.max(0.3, b.r);
  }

  saveGhost() {
    const R = this.ghostRec;
    if (this.level || !R || R.n < 5) return;
    const G = this.gPlay;
    if (G && G.t.length >= R.n) return;               // keep the better (longer) run
    try {
      localStorage.setItem('patpat.rush.ghost', JSON.stringify({ d: R.n * 5, t: Array.from(R.t.subarray(0, R.n)), u: Array.from(R.u.subarray(0, R.n)), h: Array.from(R.h.subarray(0, R.n)) }));
    } catch (e) { /* ignore */ }
  }

  // ---------- power-up helpers ----------
  setGhost(on) {
    const m = this.ctx.ball.snow.material;
    if (on) { this.ghostWas = { t: m.transparent, o: m.opacity }; m.transparent = true; m.opacity = 0.4; }
    else if (this.ghostWas) { m.transparent = this.ghostWas.t; m.opacity = this.ghostWas.o; this.ghostWas = null; }
    m.needsUpdate = true;
  }

  // İkiz Top (a power-up pickup): a twin rolls one lane over — it has to dodge too; while it lives, +2 on the multiplier.
  startClone(t) {
    this.cloneT = Math.max(this.cloneT, t);
    if (!this.clone) {
      const src = this.ctx.ball.snow;
      const mesh = new THREE.Mesh(src.geometry, src.material);
      mesh.frustumCulled = false;
      this.ctx.scene.add(mesh);
      this.clone = { mesh, u: this.b.u, vu: 0, events: [], ball: { id: 'clone', s: 0, u: 0, h: 0, r: 0, vs: 0, size: 1 } };
    }
    this.ctx.audio.milestone(3);
    this.float('İKİZ TOP!', 'big');
  }

  endClone(popped) {
    const c = this.clone;
    if (!c) return;
    if (popped) {
      const p = c.mesh.position;
      this.ctx.fx.burst(p.x, p.y, -p.z, 24, 0xffffff, 6, 0.2, 5);
      this.float('İKİZ PATLADI!', 'bad');
      this.ctx.audio.crash(0.4);
    } else this.float('İKİZ GİTTİ', '');
    this.ctx.scene.remove(c.mesh);
    this.clone = null;
    this.cloneT = 0;
  }

  updateClone() {
    const c = this.clone;
    if (!c) return;
    const b = this.b;
    const lane = this.lane + 1 > this.laneMax() ? this.lane - 1 : this.lane + 1; // always a different lane than you
    const dt = 1 / 60;
    c.vu += ((lane * RCFG.laneW - c.u) * 260 - c.vu * 2 * Math.sqrt(260) * 0.95) * dt;
    c.u += c.vu * dt;
    const cb = c.ball;
    cb.s = b.s; cb.u = c.u; cb.h = b.h; cb.r = b.r; cb.vs = b.vs; cb.size = b.size; cb.duck = b.duck;
    if (this.state === 'play' && this.countT <= 0) {
      c.events.length = 0;
      this.obstacles.collide(cb, c.events);
      for (const e of c.events) {
        if (e.type === 'hit' && !(this.sizeNow() >= (e.toughness ?? 5) + RCFG.smashMargin) && this.ghostT <= 0 && this.rocketT <= 0 && !(this.rampT > 0 && (e.toughness ?? 5) <= 4)) { this.endClone(true); return; }
        if (e.type === 'pickup' && (e.kind === 'flake' || e.kind === 'snow')) this.handle(e);
      }
    }
    this.track.toWorld(b.s, c.u, b.h + b.r * 0.96, _tp);
    c.mesh.position.copy(_tp);
    c.mesh.quaternion.copy(this.ctx.ball.spin.quaternion);
    c.mesh.scale.setScalar(this.rShown);
  }

  addTons(t) {
    this.destTons += t;
    const tier = destructionTier(this.destTons);
    if (tier > this.destTier) {
      this.destTier = tier;
      const text = `YIKIM: ${DESTRUCTION[tier].name}`;
      if (this.ctx.ui.toastSoft) this.ctx.ui.toastSoft(text); else this.ctx.ui.banner(text, Math.min(5, 2 + tier));
      this.ctx.audio.milestone(Math.min(5, 1 + tier));
      this.ctx.platform.haptic('success');
    }
  }

  updateHud() {
    const ui = this.ctx.ui;
    ui.runnerDanger?.(this.dangerBonus(), this.chainBonus(), this.riskT > 0 ? 4 : 0);
    ui.chaseVig?.(this.state === 'play' ? Math.max(0, Math.min(1, (9 - this.gap) / 5)) : 0);
    this.updateGoal();
    const bi = biomeAt(this.b.s, _bi);
    const prog = this.level ? clamp(this.b.s / this.level.length, 0, 1) : bi.t;
    const key = this.level ? this.level : bi.biome;
    if (this._lblKey !== key) { this._lblKey = key; this._lbl = this.level ? `${this.level.act}-${this.level.idx} · ${this.level.name}` : bi.biome.name; }
    const label = this._lbl;
    ui.runnerStats(this.score, this.coins, this.mult, prog, Math.round(this.b.s), label);
    if ((this._progT = (this._progT || 0) + 1) % 30 === 0) this.ctx.meta?.track?.('run_progress', { distance: Math.round(this.b.s), coins: this.coins });
    const v = this._vit, y = this._yeti;
    v.tier = this.tier; v.grow = this.grow; v.gap = Math.min(RCFG.yetiMax, this.gap + (this.baitBonus || 0));
    v.helmet = this.helmet; v.helmetT = this.helmetT; v.magnet = this.magnetT > 0 || this.buffs.has('miknatis'); v.rocket = this.rocketT > 0;
    v.x2 = this.x2T > 0; v.superjump = this.superT > 0 || this.buffs.has('yay'); v.sled = this.sledT > 0; v.sledCd = this.sledCdT;
    y.mode = this.stumbleT > 0 ? 'stumble' : this.yetiHoldT > 0 ? 'hold' : null;
    y.frac = this.stumbleT > 0 ? this.stumbleT / Math.max(0.1, this.stumbleMax) : this.yetiHoldT > 0 ? this.yetiHoldT / RCFG.yetiHold : 0;
    ui.runnerVitals(v);
  }

  // Goal strip: the next checkpoint (every layer), "REKORA n m" when your record is near, the Yeti's barrage while it lasts.
  updateGoal() {
    if (this.level) { if (this.bossIntro === 1) this.ctx.ui.runnerGoal?.('boss', 0, clamp((this.level.length - this.b.s) / 150, 0, 1)); return; }
    if (this.furyT > 0 || this.fury > 0) return;
    const ui = this.ctx.ui, s = this.b.s, r = this.rage;
    if (this.boss && this.boss.ph !== 'out') { ui.runnerGoal?.('boss', 0, this.boss.ph === 'in' ? 1 : Math.max(0, 1 - this.boss.t / this.boss.dur)); return; }
    if (r) { ui.runnerGoal?.('rage', 0, (s - r.s0) / Math.max(1, r.B - r.s0)); return; }
    if (this.cannonN > 0) { ui.runnerGoal?.('cannon', this.cannonN, this.cannonN / 5); return; }
    if (this.newRecT > 0) { ui.runnerGoal?.('new', 0, 1); return; }
    const g = goalFor(s, RCFG.layerLen, this.bestDist, this.passedDist, RCFG.recNear, _goal);
    ui.runnerGoal?.(g.mode, g.val, g.frac);
  }

  // ---------- physics ----------
  step(dt, hw) {
    const b = this.b;
    this.stepDt = dt;
    const tr = this.track;
    // Lateral: player spring (heavier when big, slippery on ice) + external knocks / curve drift.
    // Once the ball has dropped off the track it can no longer steer (no sliding back "through" the ground).
    const mass = 1 + this.tier * 0.06;
    const grip = this.slideT > 0 ? (this.abil === 'buzejder' ? 0.55 : 0.4) : this.iceT > 0 ? 0.5 : 1;   // BUZ KAYDIRAĞI: fast but lane changes are slow
    const k = (RCFG.laneStiff * grip * 1.21) / mass;   // sideways moves 10% faster (spring response x1.1, so the faster pace stays controllable)
    const locked = this.fallLock || this.wallRun !== null;
    const tgtU = locked ? b.u : this.targetU;
    b.vu += ((tgtU - b.u) * k - b.vu * 2 * Math.sqrt(k) * 0.95) * dt;
    b.ve *= Math.exp(-2.5 * dt);
    b.ve -= clamp(tr.curvature(b.s) * b.vs * b.vs * 0.12, -3, 3) * dt;   // curves push outward, but never fling you
    if (locked) { b.vu = 0; b.ve = 0; }
    if (this.gustK > 0.01 && !locked) b.vu += this.gustDir * this.gustK * 700 * dt;   // ÇIĞ RÜZGÂRI: a lane-spring bias (equilibrium ~1.8 m downwind), counter-steer to hold the line
    const du = (b.vu + b.ve) * dt;
    b.u += du;
    if (this.gustK > 0.01 && !locked) { const gl = Math.min(hw - b.r * 0.9, this.laneMax() * RCFG.laneW + 0.5); if (Math.abs(b.u) > gl) { b.u = Math.sign(b.u) * gl; if (b.vu * b.u > 0) b.vu = 0; } }
    const ds = b.vs * dt;
    b.s += ds;
    if (this.wallRun) { this.wallStep(dt, hw); if (this.state !== 'play') return; }

    // Snow banks keep you in; cliffs (edge 0) don't.
    const edge = tr.edgeAt(b.s);
    const lim = hw - b.r * 0.9;
    if (edge > 0 && this.grounded && b.h < edge + 0.05 && Math.abs(b.u) > lim) {
      b.u = Math.sign(b.u) * lim;
      this.ctx.platform.haptic('light');
      b.ve *= -0.35;
      // Bounced off the snow bank: snap back to the nearest lane that fits.
      while (Math.abs(this.lane * RCFG.laneW) > lim + 0.01 && Math.abs(this.lane) > (LANES.length % 2 ? 0.01 : 0.51)) this.lane -= Math.sign(this.lane);
    }

    // Vertical. Rideable train roofs/ramps count as ground too. groundAt bridges one-sample seam holes between pieces.
    const ts = this.groundAt(b.s, b.u);
    const ps = this.obstacles.platformAt ? this.obstacles.platformAt(b.s, b.u) : -Infinity;
    const surf = Math.max(ts, ps ?? -Infinity);
    if (this.zip) {
      // Hanging from the rope: centre lane, fixed height, no gravity until the far end.
      this.grounded = false;
      b.vh = 0;
      this.lane = this.laneSnap(0);
      b.h += (this.zip.h - b.h) * Math.min(1, dt * 10);
      if (b.s >= this.zip.s1) { this.zip = null; this.ctx.audio.whoosh(); }
    } else if (this.grind) {
      this.grounded = true;
      b.vh = 0;
      b.h = this.grind.h;
      this.lane = this.laneSnap(this.grind.u / RCFG.laneW);
      b.vs = Math.max(b.vs, Math.min(speedAt(b.s) + 4, b.vs + 3 * dt));
      this.score += 30 * dt * this.mult;
      this.addFlow(1.5 * dt);
      if (Math.random() < dt * 30) this.burst(1, 0xffd060, 2);
      if (b.s >= this.grind.s1) this.endGrind();
    } else if (this.rocketT > 0) {
      this.grounded = false;
      b.vh = 0;
      // round / upside-down sections (now or ~0.6 s ahead): hug the surface — 6 m of 'up' would cross a 5.5-11 m loop
      const rnd = ROUND_KINDS.has(this.track.pieceAt(b.s)?.kind) || ROUND_KINDS.has(this.track.pieceAt(b.s + b.vs * 0.6)?.kind);
      b.h += ((rnd ? 0.6 : RCFG.rocketH) - b.h) * Math.min(1, dt * (rnd ? 6 : 4));
    } else if (this.grounded) {
      if (this.lastSlope > 0.08 && (surf === -Infinity || surf < this.lastSurf - 0.2)) {
        // Left the end of a ramp: launched along its slope (works over a gap as well as onto lower ground).
        this.holeRun = 0;
        this.jump(Math.max(6, b.vs * this.lastSlope * 1.1), true);
      } else if (surf === -Infinity) {
        // Over a hole. The ball is held up by the edge for about its own radius before it really falls (also covers 1-sample seams).
        this.holeRun += ds;
        if (this.holeRun > Math.min(0.9, 0.5 * b.r + 0.1)) {
          this.grounded = false;
          this.holeAir = true;
          this.coyoteT = RCFG.coyote;
          b.vh = 0;
        }
      } else if (surf < b.h - RCFG.landTol) {
        // A step down taller than a landing tolerance: drop instead of teleporting.
        this.holeRun = 0;
        this.grounded = false;
        this.holeAir = false;
        this.coyoteT = RCFG.coyote;
        b.vh = 0;
        this.lastSurf = surf;
      } else {
        this.holeRun = 0;
        if (ds > 1e-4) this.lastSlope = (surf - this.lastSurf) / ds;       // (a frozen step — countdown — must not fake a slope)
        b.h = surf;
        this.lastSurf = surf;
      }
    } else {
      b.vh -= RCFG.gravity * (this.inZone === 'lowgrav' ? 0.5 : 1) * dt;
      b.h += b.vh * dt;
      const pS = ps ?? -Infinity;
      if (pS > ts && b.vh <= 0 && b.h <= pS && b.h > pS - 1.2) {
        this.land(pS);                                  // onto a train roof / its ramp
      } else if (ts !== -Infinity) {
        // SOLID ground under the ball. It always wins: below the surface (the ball ended up inside the slab, e.g. after a seam
        // or a rising ramp) or descending within a landing tolerance of it -> snap to the surface and land. The tolerance is
        // about two steps of travel, so a touchdown never visibly pops.
        const tol = clamp(-b.vh * dt * 2.5, 0.05, RCFG.landTol);
        const below = b.h < ts - 0.05;
        if ((below && (b.h >= ts - RCFG.fallDeep || !this.holeAir)) || (b.vh <= 0 && b.h <= ts + tol)) {
          this.land(ts);
        } else if (below) {
          // Really fell off a ledge / out of a gap and is now far below the track again: that fall is final.
          this.fallLock = true;
          if (b.h < ts - 2) { this.die('fall'); return; }
        }
      } else {
        // Over a hole (not just a seam: groundAt already bridged those). Falling for real after a moment.
        this.holeRun = 0;
        this.holeAir = true;
        if (b.h < -0.6) this.fallLock = true;
        if (b.h < RCFG.fallDeath) { this.die('fall'); return; }
      }
    }

    // Collisions.
    b.size = this.sizeNow();
    b.duck = this.duckT > 0;
    b.magnet = this.magnetRadius();   // obstacles.collide may widen flake pickup radius by this
    const ev = this.events;
    ev.length = 0;
    if (!this.wallRun) this.obstacles.collide(b, ev);       // a missed turn is already a crash
    for (let i = 0; i < ev.length && this.state === 'play'; i++) this.handle(ev[i]);

    this.rollS += ds;
    this.rollU += du;
  }

  // The ground height under (s, u): the track surface, or -Infinity over a real hole. A "hole" that is only ONE sample wide
  // (both neighbours 0.35 m before and after are solid) is a seam between two pieces, not a hole: the ball is held up by it.
  groundAt(s, u) {
    const tr = this.track;
    const y = tr.surfaceAt(s, u);
    if (y !== -Infinity) return y;
    const a = tr.surfaceAt(s - 0.35, u);
    if (a === -Infinity) return y;
    const c = tr.surfaceAt(s + 0.35, u);
    return c === -Infinity ? y : Math.max(a, c);
  }

  jump(vh, fromRamp) {
    const b = this.b;
    if (!fromRamp) {
      this.jumps++;
      this.ctx.meta?.track?.('jump', {});
      if (this.superT > 0) vh *= RCFG.superJumpK;
      if (this.buffs.has('yay')) vh *= 1.35;
    }
    this.grounded = false;
    this.holeAir = false;
    this.coyoteT = 0;
    this.edgeS = -1;
    this.duckT = 0;           // a jump cancels a duck
    b.vh = vh;
    this.lastSlope = 0;
    this.squash = -0.45; this.sqV = 0; // stretch up
    this.mistBurst(6, 0xffffff, 2.5, 1);
    if (this.ctx.audio.hop) this.ctx.audio.hop(fromRamp ? 0.8 : 0.6); else this.ctx.audio.whoosh();
    this.ctx.platform.haptic(fromRamp ? 'medium' : 'light');
  }

  land(surf) {
    const b = this.b;
    const impact = clamp(-b.vh / 14, 0, 1);
    this.grounded = true;
    this.fallLock = false;
    this.holeAir = false;
    this.holeRun = 0;
    this.groundT = 0;
    b.h = surf;
    b.vh = 0;
    this.lastSurf = surf;
    this.lastSlope = 0;
    this.squash = 0.25 + impact * 0.45; this.sqV = 0;
    if (impact > 0.15) this.mistBurst(Math.round(6 + impact * 16), 0xffffff, 3 + impact * 5, 1.2 + impact);
    if (impact > 0.3) {
      this.ctx.audio.land(impact);
      this.ctx.platform.haptic('medium');
      this.trauma = Math.min(1, this.trauma + impact * 0.3);
      this.burst(12, 0xffffff, 3);
    }
    if (impact > 0.6) this.kick += 1.5;
    if (this.duckOnLand) { this.duckOnLand = false; this.duckT = 0.65; }      // the slam: land into a duck
    if (this.jumpBufT > 0 && !this.grind && !this.zip) { this.jumpBufT = 0; this.jump(RCFG.jumpV, false); }   // buffered jump fires at touchdown
  }

  // ---------- the core loop ----------
  addSnow(amount) {
    if (this.tier >= TIERS - 1) {
      // Max size: the meter fills first, only the overflow is pure score.
      const prev = this.grow;
      this.grow = Math.min(1, this.grow + amount);
      if (amount > 0 && prev >= 1) this.score += 60 * this.mult;
    } else {
      this.grow += amount;
      if (this.grow >= 1) {
        this.grow -= 1;
        this.tier++;
        this.maxTier = Math.max(this.maxTier, this.tier);
        this.ctx.meta?.track?.('tier_up', { tier: this.tier });
        this.ctx.audio.milestone(this.tier + 1);
        this.ctx.platform.haptic('success');
        this.kick += 2;
        this.squash = Math.max(this.squash, 0.35);
      }
    }
    this.syncRadius();
  }

  // Smashing costs a little size (a fence is cheap, a cabin is not). Never fatal, never a stumble.
  drain(x) {
    this.grow -= x;
    if (this.grow < 0) {
      if (this.tier > 0) { this.tier--; this.grow += 1; this.mistBurst(10, 0xb8c2cc, 3, 1); this.float('KÜÇÜLDÜN', ''); }
      else this.grow = 0;
    }
    this.syncRadius();
    this.ctx.ui.runnerSizeTick?.();
  }

  // Hit something solid. Big enough (or rocketing / giant) → it shatters. Otherwise a shield takes it, or you stumble.
  hit(e) {
    const b = this.b;
    const { audio, platform } = this.ctx;
    const tough = e.toughness ?? 5;
    if ((e.kind === 'rock' || e.kind === 'stone') && !e.headOn) { this.obstacles.resolve?.(e.id, false); b.ve += Math.sign(e.du || 1) * 2; return; }   // glancing side contact with a rock: no damage
    const giant = this.buffs.has('dev');
    const cn = this.cannonN > 0 && tough <= 5;     // KAR KANONU: a blocker that slips through is smashed by the next shot
    if (cn && this.rocketT <= 0) { this.cannonN--; if (this.cannonN <= 0) this.cannonT = 0; }
    if (cn || this.rocketT > 0 || this.sizeNow() >= tough + RCFG.smashMargin || (giant && tough <= 3) || (this.rampT > 0 && tough <= 4)) {
      this.obstacles.resolve?.(e.id, true);
      this.smashes++;
      this.ctx.meta?.track?.('smash', { toughness: tough });
      this.score += 40 * tough * this.mult * (1 + 0.1 * Math.min(5, this.perm.smash || 0));
      this.addTons([0, 3, 8, 20, 60, 180][Math.min(5, tough)] * (0.6 + b.r));
      audio.crash(clamp(tough / 5, 0.3, 1));
      platform.haptic('light');
      this.trauma = Math.min(1, this.trauma + 0.12 + 0.06 * tough);
      this.kick += 1.5 + 0.5 * tough;
      this.squash = Math.max(this.squash, 0.35);
      if (this.rocketT <= 0 && tough >= 2 && this.time - this.lastSmashStop > 0.3) { this.hitStop = Math.max(this.hitStop, 0.025 + 0.01 * tough); this.lastSmashStop = this.time; }
      b.vs *= this.rocketT > 0 ? 1 : 0.94;
      this.debris(e, 14);
      // Smashing makes you STRONGER: a little snow per toughness point (double in YIKIM MODU), a smash streak, a short 'GÜÇ!' flash.
      this.addSnow((0.04 + 0.03 * tough) * (this.rampT > 0 ? 2 : 1));
      this.ctx.ui.runnerSizeTick?.();
      this.smashTimes.push(this.time);
      while (this.smashTimes.length && this.time - this.smashTimes[0] > 4) this.smashTimes.shift();
      if (this.rampT <= 0 && this.smashTimes.length >= 3) {
        this.rampT = 3; this.smashTimes.length = 0;
        this.queueBanner('YIKIM MODU!', 5, 1.2, true);
        this.kick += 3; this.trauma = Math.min(1, this.trauma + 0.25);
        this.mistBurst(14, 0xffd060, 4, 1);
      }
      return;
    }
    this.obstacles.resolve?.(e.id, false);
    if (e.soft && (this.obstacles.hk?.() ?? 1) < 2) { this.softHit(e); return; }
    this.hurt(e);
  }

  // A Yeti-phase hit (below high difficulty): a little size and speed, never a stumble window or death.
  softHit(e) {
    if (this.invulnT > 0 || this.ghostT > 0 || this.rocketT > 0) return;
    if (this.absorbShield(e)) return;
    const b = this.b;
    this.grow -= 0.5;
    if (this.grow < 0) { if (this.tier > 0) { this.tier--; this.grow += 1; this.syncRadius(); this.onMeltDrop?.(); } else this.grow = 0; }
    b.vs *= 0.88; this.squash = Math.max(this.squash, 0.45); this.trauma = Math.min(1, this.trauma + 0.35);
    this.invulnT = Math.max(this.invulnT, 0.9);
    this.flow = Math.max(0, this.flow - 3); this.nearChain = 0; this.breakCombo();
    this.debris(e, 10);
    this.float('YETİ ATTI!', 'bad'); this.ctx.audio.crash?.(0.4); this.ctx.platform.haptic('medium');
  }

  // ---------- YETİ BOSS FAZI ----------
  // Every ~2.5 km (first at 1.8 km) the Yeti roars, overtakes and runs AHEAD for ~20 s throwing telegraphed boulders back at
  // the lanes (red landing disc >= 1.3 s, at most 1 / 2 ahead so a lane is always free). Survive: it falls behind, reward + a card.
  bossSafe() {
    const b = this.b;
    if (this.state !== 'play' || this.jnNear || this.jnOpen || this.jnJ || this.zip || this.grind || this.wallRun || this.rocketT > 0 || this.stumbleT > 0 || this.rage || this.inZone || this.fallLock) return false;
    const pc = this.track.pieceAt(b.s), L = RCFG.layerLen;
    if (pc && (RAGE_SKIP.has(pc.kind) || ROUND_KINDS.has(pc.kind) || pc.kind === 'junction')) return false;
    return this.layer < 2 || (Math.floor(b.s / L) + 1) * L - b.s > 120;
  }

  bossTick(dt) {
    if (this.level) return;
    const b = this.b, tr = this.track;
    let B = this.boss;
    if (!B) {
      tr.bossHold = b.s > this.nextBossS - 420;       // no corners / loops / helixes generated for the stretch the Yeti owns
      if (b.s < this.nextBossS || !this.bossSafe()) return;
      const o0 = -Math.max(4, this.gap);
      this.boss = B = { ph: 'in', t: 0, off: o0, off0: o0, throwT: 2.6, n: 0, crashes0: this.crashes, yu: 0, dur: 20 };
      this.yetiHoldT = 0; this.stumbleT = 0;
      this.roar(false);
      this.queueBanner('YETİ ÖNÜNDE!', 5, 1.8, true);
      this.kick += 3; this.trauma = Math.min(1, this.trauma + 0.35); this.punch = Math.min(1.5, (this.punch || 0) + 0.8);
      this.ctx.audio.milestone?.(5);
      return;
    }
    B.t += dt;
    tr.bossHold = true;
    const lo = LANES[0], hi = LANES[LANES.length - 1], sideU = b.u > 0 ? lo : hi, mid = (lo + hi) / 2;
    if (B.ph === 'in') {
      const k = Math.min(1, B.t / 2.4), e = k * k * (3 - 2 * k);
      B.off = B.off0 + (22 - B.off0) * e; B.yu = sideU;
      if (k >= 1) { B.ph = 'run'; B.t = 0; }
    } else if (B.ph === 'run') {
      B.off = 22 + Math.sin(B.t * 1.3) * 2; B.yu = mid + Math.sin(B.t * 0.9) * (hi - lo) * 0.3;
      B.throwT -= dt;
      if (B.throwT <= 0 && B.t < B.dur - 3 && this.baitT <= 0) this.bossThrow(B);
      if (B.t >= B.dur) { B.ph = 'out'; B.t = 0; B.off0 = B.off; }
    } else {
      const k = Math.min(1, B.t / 2.4), e = k * k * (3 - 2 * k);
      B.off = B.off0 + (-14 - B.off0) * e; B.yu = sideU;
      if (k >= 1) this.endBoss(true);
    }
  }

  bossThrow(B) {
    const b = this.b, NLn = LANES.length, hk = this.obstacles.hk?.() ?? 1;
    if (B.baitSkip) { B.baitSkip = 0; B.throwT = 2.6 + Math.random() * 1.8; return; }     // the Yeti was eating: this throw is skipped
    let ahead = 0;
    for (const d of (this.obstacles.dyn || [])) if (d.s > b.s - 3) ahead++;
    if (ahead >= 1 || this.stumbleT > 0 || this.zip || this.jnNear) { B.throwT = 0.4; return; }
    const T = 2.0, sLand = b.s + b.vs * T + 10;
    const pl = Math.round(this.lane + (NLn - 1) / 2);
    const lane = Math.random() < 0.6 ? pl : (pl + 1 + ((Math.random() * (NLn - 1)) | 0)) % NLn;
    if (this.obstacles.throwBoulder(lane, sLand, false, { soft: true, T, sStart: b.s + B.off }) < 0) { B.throwT = 0.7; return; }
    B.n++;
    B.throwT = (2.6 + Math.random() * 1.8) / Math.min(1.6, hk);
    this.ctx.audio.bump?.(0.7); this.ctx.platform.haptic('warning');
  }

  endBoss(won) {
    const B = this.boss;
    if (!B) return;
    this.boss = null;
    this.track.bossHold = false;
    this.nextBossS = this.b.s + (won ? 1900 : 1500);
    if (!won) return;
    this.gap = Math.min(RCFG.yetiMax, 14);
    const bonus = Math.round(1000 * this.mult), coins = 120;
    this.score += bonus; this.coins += coins;
    this.rcpAdd('boss');
    this.queueBanner("YETİ'Yİ ATLATTIN!", 5, 1.8, true);
    this.after(0.4, () => { this.float('+' + bonus.toLocaleString('tr-TR') + ' · +' + coins + ' ❄️', 'big'); });
    this.ctx.audio.win?.(); this.ctx.platform.haptic('success');
    this.mistBurst(18, 0xffd060, 5, 1.2);
    this.ctx.menus?.confetti?.(70); this.kick += 2;
    this.grantBuff();
    this.ctx.meta?.track?.('yeti_boss', { n: B.n, crashes: this.crashes - B.crashes0 });
  }

  // Power-up pickup: a brief glow burst + a pulse of the ball.
  pickPulse(kind) {
    this.glowT = 0.5; this.kick += 1.2;
    const col = { star: 0xffe45a, x2: 0xffd24a, superjump: 0x7affb0, crystal: 0x9ae8ff, timewarp: 0xb48aff, ghost: 0xd8e8ff, risk: 0xff6a4a, clone: 0x7ad0ff, helmet: 0xffb050, magnet: 0xff7a7a, rocket: 0xffa040 }[kind] ?? 0xffffff;
    this.mistBurst(12, col, 3.2, 1.1); this.burst?.(8, col, 4);
  }

  // A hit that is not smashed: invulnerable / ghost → nothing; a shield → absorbed; otherwise a crash (stumble).
  hurt(e) {
    if (this.invulnT > 0 || this.ghostT > 0) return false;
    if (this.absorbShield(e)) { this.invulnT = RCFG.invulnAfterCrash; return false; }
    if (this.abil === 'simit' && !this.simitUsed) { this.simitUsed = true; this.invulnT = RCFG.invulnAfterCrash; this.float('SİMİT KURTARDI!', 'big'); this.ctx.audio.chime?.(); return false; }
    if (this.isLethal(e)) { this.lethalHit(e); return true; }
    this.crash(e);
    return true;
  }

  // A centred, head-on hit with one of the big solid things. A side clip, a ball riding on top of a car and the very first
  // 300 m of the tutorial run are all merely stumbles.
  isLethal(e) {
    const k = e.kind;
    if (!k || !e.headOn || e.nonLethal) return false;
    if (k === 'rock' && this.b.s < 1500) return false;       // big boulders only kill head-on after 1.5 km (before: a stumble)
    const on = this.lethalOn;
    if (!(LETHAL_BASE.has(k) ? on.base : LETHAL_CAR.has(k) ? on.car : LETHAL_WALL.has(k) ? on.wall : false)) return false;
    const b = this.b;
    if (this.tut && b.s < 300) return false;
    if (e.ride && e.ht > 0 && b.h >= 0.5 * e.ht) return false;
    return Math.abs(b.u - (e.u !== undefined ? e.u : b.u)) < 0.5 * (b.r + (e.halfW || 1));
  }

  lethalHit(e) {
    this.killKind = e.kind;
    this.crashes++;
    this.flow = 0;
    this.flowLvl = 0;
    this.breakCombo();
    this.breakCombo();
    this.layersLost++;
    this.ctx.meta?.track?.('crash', {});
    this.debris(e, 16);
    this.obstacles.tintKiller?.(e.id);       // the killer glows red through the death read-out
    this.crashFx(30);
    this.ctx.audio.crash(1);
    this.die('smash');
  }

  // Character intro: big card at ~22% height for 1.5 s, then it shrinks into a corner badge; small accessory mesh on the ball.
  charIntro(id) {
    const A = ABILITIES[id]; if (!A) return;
    let name = id; try { name = this.ctx.save.skinName?.(id) || (SKINS?.find?.((s) => s.id === id)?.name) || id; } catch { /* ignore */ }
    const el = this.introEl = document.createElement('div');
    el.className = 'char-intro';
    el.innerHTML = '<span class="ci-ico">' + A.icon + '</span><b>' + String(name).toLocaleUpperCase('tr-TR') + '</b><i>' + A.text + '</i>';
    document.body.appendChild(el);
    el.style.visibility = 'hidden'; this._introPend = true;      // revealed when the 3-2-1 ends (see step)
    this.ctx.ball.group.rotation.y = 0; this._introT = 1.5;
    try {
      const T = this.ctx.ball.group.constructor && this.ctx.THREE;
      const g = new THREE.Group();
      const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
      const acc = { simit: [0xd98a2b, 'ring'], nazar: [0x2a6fdb, 'eye'], penguen: [0xffa31a, 'beak'], altin: [0xffd24a, 'hat'] }[id] || [0xc62d3a, 'scarf'];
      const r = this.b.r || 0.5;
      if (acc[1] === 'eye') { const e = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 10, 8), m(acc[0])); e.position.set(0, r * 0.2, r * 0.92); g.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.1, 8, 6), m(0x111111)); p.position.set(0, r * 0.2, r * 1.08); g.add(p); }
      else if (acc[1] === 'beak') { const e = new THREE.Mesh(new THREE.ConeGeometry(r * 0.14, r * 0.35, 8), m(acc[0])); e.rotation.x = Math.PI / 2; e.position.set(0, 0, r * 1.05); g.add(e); }
      else if (acc[1] === 'hat') { const e = new THREE.Mesh(new THREE.ConeGeometry(r * 0.32, r * 0.55, 10), m(acc[0])); e.position.set(0, r * 1.05, 0); g.add(e); }
      else { const e = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, r * 0.1, 8, 20), m(acc[0])); e.rotation.x = Math.PI / 2 - 0.35; e.position.y = r * 0.35; g.add(e); }
      this.ctx.ball.group.add(g); this.accGroup = g;
    } catch (e) { /* cosmetic */ }
  }

  // A shield (sled / helmet / kabuk) rescues a fall: respawn on the first solid ground beyond the gap.
  fallRescue() {
    if (this.level || !(this.sledT > 0 || this.helmet || this.buffs.has('kabuk'))) return false;
    const b = this.b, tr = this.track;
    let s = b.s, ok = false;
    for (let k = 0; k < 40; k++) { s = b.s + 3 + k * 2; if (tr.surfaceAt(s, b.u) !== -Infinity) { ok = true; break; } }
    if (!ok) return false;
    this.absorbShield(null);
    b.s = s; b.h = Math.max(0, tr.surfaceAt(s, b.u)) + 0.1; b.vh = 0;
    this.grounded = true; this.lastSurf = b.h; this.lastSlope = 0;
    this.fallLock = false; this.holeRun = 0; this.holeAir = false; this.edgeS = -1;
    this.invulnT = Math.max(this.invulnT, 1.5);
    this.obstacles.clearRange?.(s, s + b.vs * 1.0);
    this.float('KURTARILDIN!', 'big');
    this.placeBall(true);
    return true;
  }

  // Sled → helmet → kabuk card: each absorbs ONE hit (a missed turn included).
  absorbShield(e) {
    const { audio, platform } = this.ctx;
    let msg = null;
    if (this.sledT > 0) { this.sledT = 0; this.sledCdT = RCFG.sledCd; msg = 'KIZAK KIRILDI!'; }
    else if (this.helmet) { this.helmet = false; this.helmetT = 0; msg = 'KASK KURTARDI!'; }
    else if (this.buffs.has('kabuk')) { this.spendBuff('kabuk'); msg = 'KABUK KIRILDI!'; }
    if (!msg) return false;
    this.invulnT = RCFG.invulnAfterCrash;
    audio.crash(0.3);
    platform.haptic('medium');
    this.burst(14, 0xcfe6ff, 5);
    if (e) this.debris(e, 8);
    this.float(msg, 'bad');
    return true;
  }

  // KAR SÜRÜSÜ: up to 5 tiny penguins queue behind the ball (each +0.1 on the multiplier); a crash scatters them.
  addPenguin() {
    if (this.penN >= 5) { this.score += 50 * this.mult; return; }
    this.penN++;
    this.float(`KAR SÜRÜSÜ x${this.penN}  +0.${this.penN}`, 'big');
    this.ctx.audio.chime?.();
  }

  scatterPenguins() {
    if (!this.penN) return;
    const n = this.penN; this.penN = 0;
    this.burst(6 + n * 2, 0x1a1d26, 3);
    this.float('SÜRÜ DAĞILDI!', '');
  }

  penMesh(i) {
    let g = this.penMeshes[i];
    if (g) return g;
    g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.8 }), white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), org = new THREE.MeshStandardMaterial({ color: 0xff9a2a, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), dark); body.scale.set(0.9, 1.1, 0.8); body.position.y = 0.55;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), white); belly.scale.set(0.85, 1, 0.5); belly.position.set(0, 0.5, 0.25);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), org); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.8, 0.5);
    g.add(body, belly, beak); g.scale.setScalar(0.55); g.visible = false;
    this.ctx.scene.add(g); this.penMeshes[i] = g;
    return g;
  }

  updatePenguins(dt) {
    const b = this.b, t = this.time || 0;
    const H = this.penHist || (this.penHist = []);
    if (this.state === 'play') { H.push(b.s, b.u); if (H.length > 160) H.splice(0, 2); }
    const tr = this.track;
    for (let i = 0; i < 5; i++) {
      const g = this.penMeshes[i] || (i < this.penN ? this.penMesh(i) : null);
      if (!g) continue;
      if (i >= this.penN || this.state !== 'play') { g.visible = false; continue; }
      const lag = 2 * (4 + 5 * (i + 1));                    // samples back (H holds s,u pairs ~ one per frame)
      const k = Math.max(0, H.length - 2 - lag);
      let ps = H[k] - 0.0, pu = H[k + 1];
      ps = Math.min(ps, b.s - 1.4 * (i + 1));
      if (ps < 0) { g.visible = false; continue; }
      const sf = tr.surfaceAt(ps, pu);
      tr.toWorld(ps, pu, Math.max(0, sf === -Infinity ? 0 : sf) + Math.abs(Math.sin(t * 9 + i * 1.3)) * 0.25, _v2);
      tr.frame(ps, _f2);
      g.position.copy(_v2);
      g.rotation.y = Math.atan2(_f2.tan.x, _f2.tan.z);
      g.rotation.z = 0.12 * Math.sin(t * 9 + i * 1.3);
      g.visible = true;
    }
  }

  crash(e) {
    const b = this.b;
    const { audio, platform, ui } = this.ctx;
    this.crashes++;
    this.flow = 0;
    this.flowLvl = 0;
    this.breakCombo();
    this.ctx.meta?.track?.('crash', {});
    this.layersLost++;
    this.debris(e, 10);
    this.scatterPenguins();
    // A second crash while the Yeti is right behind you: it catches you.
    if (this.stumbleT > 0 && !this.buffs.has('yetikov')) {
      this.stumbleHits = (this.stumbleHits || 1) + 1;
      if (this.stumbleHits >= 3) { this.crashFx(30, false); this.die('yeti'); return; }
    }
    // Smallest size: the ball bursts.
    if (this.tier === 0) { this.explode(); return; }
    // Knock a layer off: the lost snow sprays out as chunks, the ball visibly shrinks and stumbles.
    const lostR = b.r - RCFG.tierR[this.tier - 1];
    this.tier--;
    this.grow = 0;
    this.syncRadius();
    b.vs *= RCFG.crashSlow;
    if (e.headOn !== false) b.s -= 0.6; // bounce back off the obstacle
    b.ve += (b.u >= (e.u ?? 0) ? 1 : -1) * 3;
    this.nearChain = 0;
    this.invulnT = RCFG.invulnAfterCrash;
    this.openStumble();
    this.burst(18 + Math.round(lostR * 40), 0xffffff, 6);
    this.mistBurst(14, 0xffffff, 5, 1.6);
    this.hitStop = 0.11;
    this.trauma = Math.min(1, this.trauma + 0.75);
    this.kick += 1;
    ui.flash?.('hit');
    audio.crash(0.5);
    audio.bump(1);
    platform.haptic('heavy');
    this.float(this.tier === 0 ? 'ÇOK KÜÇÜLDÜN!' : 'TÖKEZLEDİN!', 'bad');
  }

  // The ball bursts into powder (and is hidden): used by explode / the barrier.
  crashFx(n, hide = true) {
    this.mistBurst(40, 0xffffff, 9, 3);
    this.hitStop = 0.2;
    this.trauma = 1;
    this.ctx.ui.flash?.('hit');
    this.burst(n + 20, 0xffffff, 10);
    this.burst(20, 0xd6e8ff, 6);
    if (hide) this.ctx.ball.group.visible = false;
  }

  explode() {
    this.crashFx(40);
    this.die('explode');
  }

  handle(e) {
    const b = this.b;
    const { audio, platform } = this.ctx;
    if (!(this.tipCd > 0)) this.tipFor(e);
    switch (e.type) {
      case 'hit':
        this.hit(e);
        break;
      case 'critter':
        this.critter(e);
        break;
      case 'snowball':
        // KARTOPU SAVAŞI: a hit costs a little size (never lethal) and a stumble in speed
        if (this.invulnT > 0 || this.ghostT > 0 || this.rocketT > 0) break;
        this.grow -= 0.3;
        if (this.grow < 0) { if (this.tier > 0) { this.tier--; this.grow += 1; this.onMeltDrop?.(); } else this.grow = 0; }
        b.vs *= 0.9; this.squash = Math.max(this.squash, 0.4); this.trauma = Math.min(1, this.trauma + 0.25);
        this.flow = Math.max(0, this.flow - 2); this.breakCombo();
        this.float('KARTOPU!', 'bad'); audio.bump?.(0.5); platform.haptic('medium');
        this.burst?.(12, 0xffffff, 3);
        break;
      case 'block': {
        // Older event shape: treat head-on blocks as a toughness-5 hit, glancing ones as a nudge.
        const headOn = Math.abs(e.ds) > Math.abs(e.du);
        if (headOn) this.hit({ toughness: 5, s: b.s, u: b.u, headOn: true });
        else b.ve += Math.sign(e.du || 1) * 2;
        break;
      }
      case 'knock':
        if (this.invulnT > 0 || this.rocketT > 0) break;
        b.ve += e.du * (e.strength ?? 1);
        if (e.dh > 0) { this.grounded = false; b.vh = Math.max(b.vh, e.dh); }
        audio.bump(0.5);
        platform.haptic('medium');
        this.trauma = Math.min(1, this.trauma + 0.3);
        break;
      case 'ice':
        this.iceT = 0.15;
        break;
      case 'slide':
        if (this.slideT <= 0 && this.slideMsgT <= 0) { this.float('BUZ KAYDIRAĞI!', 'big'); audio.whoosh?.(); this.slideMsgT = 6; this.kick += 2; }
        this.slideT = 0.2;
        if (Math.random() < 0.5) this.mistBurst(1, 0xcdeeff, 2.5, 0.7);
        break;
      case 'tunnel':
        if (e.enter && this.tunnelMsgT <= 0) { this.float('TÜNEL!', 'big'); this.tunnelMsgT = 5; }
        audio.whoosh?.(); this.kick += e.enter ? 3 : 1;
        break;
      case 'fx':
        if (e.value === 2 && e.kind === 'pensled') { this.addPenguin(); break; }
        if (e.value === 1) { if (e.kind === 'turret') audio.pop?.(); else if (e.kind === 'icegate') audio.bump?.(); else if (e.kind === 'pensled') audio.chime?.(); }
        break;
      case 'warn':
        if (!this.warned || this.warned !== e.kind + e.lane + Math.round(e.t * 10)) {
          this.warned = e.kind + e.lane + Math.round(e.t * 10);
          this.laneWarn(e);
          if (e.kind === 'oncoming') audio.ui('back');
          if (e.value) { this.trauma = Math.min(1, this.trauma + 0.15); }
          platform.haptic('light');
        }
        break;
      case 'wind':
        b.u += (e.du || 0) * this.stepDt;
        if (Math.random() < this.stepDt * 20) {
          const p = this.ctx.ball.group.position;
          this.ctx.fx.puff(p.x - (e.du || 0) * 4, p.y + 1 + Math.random() * 2, p.z, (e.du || 0) * 6, 0, 0, 0.4, 0.6, 0xffffff, 0.5);
        }
        break;
      case 'fog':
        this.fogTarget = Math.max(this.fogTarget, e.density || 0);
        break;
      case 'finish':
        this.finish();
        break;
      case 'near': {
        if ((e.toughness || 0) < 2) break;
        this.nearChain = this.nearT > 0 ? this.nearChain + 1 : 1;
        this.nearT = 2.6;
        this.addFury(0.125);
        this.addFlow(3);
        const bonus = Math.round(50 * this.mult);
        this.score += bonus;
        const cm = this.chainBonus();
        if (this.stumbleT > 0) this.ctx.meta?.track?.('close_call', {});
        if (this.time - (this._nmAt ?? -9) >= 4) {              // a quiet extra, rate-limited (no flash, no centre text)
          this._nmAt = this.time;
          this.kick += 1;
        }
        this.punch = Math.min(1.5, this.punch + 0.3);
        this.kick += 1;
        this.mistBurst(6, 0xbfe6ff, 4, 0.9);
        if (audio.near) audio.near(); else audio.whoosh();
        if (cm > 0) audio.star(Math.min(2, cm - 1));
        platform.haptic('light');
        this.ctx.meta?.track?.('near', {});
        break;
      }
      case 'over':
        this.addFlow(1.5);
        this.score += 50 * this.mult;
        break;
      case 'push':
        b.u += (e.du || 0) * this.stepDt;
        break;
      case 'slowmo':
        if (this.slowUntil < e.s1) {
          this.slowUntil = e.s1;
          this.slowScale = e.scale || 0.4;
          this.float('ZAMAN RAMPASI!', 'big');
        }
        break;
      case 'zip':
        if (!this.zip) {
          this.zip = { s1: e.s1, h: (e.h ?? 3.4) - this.b.r * 2.2 };
          this.lane = this.laneSnap(0);
          audio.whoosh();
          platform.haptic('medium');
          this.float('HALAT!', 'big');
          this.gap = Math.min(RCFG.yetiMax, this.gap + 6); // the Yeti can't follow on the rope
        }
        break;
      case 'loop':
        if (b.vs < (e.minSpeed || 0)) b.vs = e.minSpeed * 1.05; // the boost strips guarantee entry speed
        this.float('TAKLA!', 'big');
        this.score += 150 * this.mult;
        break;
      case 'grind':
        if (e.active && !this.grind) {
          this.grind = { s1: e.s1, u: e.u ?? b.u, h: e.h ?? 0.55 };
          audio.land(0.4);
          platform.haptic('medium');
          this.float('RAY!', 'big');
        } else if (!e.active || e.done) this.endGrind();
        break;
      case 'valley':
        if (e.ok && this.diveT > 0 && this.grounded) {
          b.vs = Math.max(b.vs, Math.min(speedAt(b.s) + 5, b.vs + 3.5));
          this.score += 80 * this.mult;
          this.gap = Math.min(RCFG.yetiMax, this.gap + 2);
          this.float('SÜPER DALIŞ!', 'big');
          this.addFlow(4);
          platform.haptic('light');
        }
        break;
      case 'crack':
        audio.bump(0.15);
        break;
      case 'pickup':
        this.pickup(e);
        break;
      case 'pad':
        if (e.kind === 'boost') {
          b.vs = Math.max(b.vs, Math.min(speedAt(b.s) * 1.3, b.vs + 7 * (e.power || 1)));
          this.gap = Math.min(RCFG.yetiMax, this.gap + 4);
          this.kick += 5;
          if (e.value) {
            this.turboN++; this.turboT = 3;
            b.vs += 3 * Math.min(4, this.turboN); this.gap = Math.min(RCFG.yetiMax, this.gap + 2);
            this.score += 50 * this.turboN * this.mult;
            if (this.turboN >= 2) this.float(`TURBO x${this.turboN}!`, 'big');
          }
        } else { this.jump(RCFG.jumpPadV * (e.onBeat ? 1.15 : 1) * (e.power || 1), true); this.kick += 3; }
        if (e.onBeat) {
          this.perfects++;
          this.addFlow(5);
          this.ctx.meta?.track?.('perfect', {});
          this.score += 100 * this.mult;
          music.perfect();
          this.float('PERFECT!', 'big');
          platform.haptic('success');
        }
        break;
      case 'smash':
        // Obstacles module decided it broke (older shape).
        this.score += 50 * this.mult;
        audio.crash(0.5);
        this.trauma = Math.min(1, this.trauma + 0.2);
        break;
      case 'melt':
        // Warm patches: they melt the ball faster (tiers per second). A soft drain, never a stumble.
        if (this.rocketT <= 0 && !this.buffs.has('donma')) this.drainSoft((e.rate || 0.2) * this.stepDt);
        break;
      case 'portal': {
        const bi = biomeAt(b.s + 5);
        this.score += 200 * this.mult;
        music.setStyle(musicStyleAt(b.s + 5));
        music.stinger('portal');
        this.ctx.meta?.track?.('portal', { biome: bi.biome.id });
        audio.milestone(3);
        this.gap = Math.min(RCFG.yetiMax, this.gap + 8);
        break;
      }
      default:
        break;
    }
  }

  // Warm ground (volcano / desert): extra melt on top of hunger.
  drainSoft(x) {
    if (this.meltK <= 0 || this.invulnT > 0) return;
    this.grow -= x;
    if (this.grow < 0) {
      if (this.tier > 0) { this.tier--; this.grow += 1; this.onMeltDrop(); }
      else { this.grow = 0; if (this.state === 'play') this.die('melt'); }
    }
  }

  // Lane warning above the threatened lane (projected at a capped distance so the icons stay legible).
  laneWarn(e) {
    const ui = this.ctx.ui;
    if (!ui.laneWarn) return;
    const b = this.b, d = Math.min(18, b.vs * (e.t || 1));
    this.track.toWorld(b.s + d, (LANES[e.lane] ?? 0), 1.2, _v2);
    _v2.project(this.ctx.camera);
    if (_v2.z > 1) { ui.laneWarn(e.lane, e.kind); return; }
    ui.laneWarn(e.lane, e.kind, (_v2.x * 0.5 + 0.5) * window.innerWidth, (-_v2.y * 0.5 + 0.5) * window.innerHeight);
  }

  // Pickups. Everything is credited silently — the result screen is where rewards show up.
  pickup(e) {
    if (!e.miss && !(this.tipCd > 0)) this.tipFor({ type: e.kind });
    const b = this.b;
    const { audio, platform, ui } = this.ctx;
    const gold = this.buffs.has('altin');
    if (GLOW_KINDS.has(e.kind) && !e.miss) this.pickPulse(e.kind);
    switch (e.kind) {
      case 'ring': {
        if (e.miss) { this.ringChain = 0; break; }
        this.ringChain = e.value > 1 ? (this.ringChain || 0) + 1 : 1;
        const n = this.ringChain;
        this.score += 100 * n * this.mult;
        this.addFlow(1 + 0.25 * n);
        audio.star(Math.min(2, n - 1));
        this.float(`HALKA x${n}!`, n >= 4 ? 'big' : '');
        this.kick += 1.5; this.burst?.(10, 0xffd24a, 3);
        break;
      }
      case 'gate':
        if (e.grp) {
          if (e.miss) { if (this.slalom && this.slalom.grp === e.grp) this.slalom = null; break; }
          if (!this.slalom || this.slalom.grp !== e.grp) this.slalom = { grp: e.grp, n: 0 };
          if (e.idx !== this.slalom.n + 1) { this.slalom = null; break; }      // (skipped one: the bonus is over)
          this.slalom.n = e.idx;
          this.score += 80 * e.idx * this.mult;
          audio.star(Math.min(2, e.idx - 1));
          this.float(`KAPI ${e.idx}/${e.n}`, '');
          if (e.idx >= e.n) {
            this.slalom = null;
            this.float('MÜKEMMEL SLALOM!', 'big');
            this.score += 500 * this.mult;
            this.addFlow(5);
            b.vs = Math.max(b.vs, Math.min(speedAt(b.s) * 1.3, b.vs + 8));
            this.gap = Math.min(RCFG.yetiMax, this.gap + 5);
            this.kick += 5; platform.haptic('success');
          }
          break;
        }
        this.gateChain = e.value || 1;
        this.score += 50 * this.gateChain * this.mult;
        audio.star(Math.min(2, this.gateChain - 1));
        this.float(`KAPI x${this.gateChain}`, '');
        break;
      case 'flake':
        this.addFlakes(e.value || 1);
        this.score += 10 * this.mult * (gold ? 2 : 1);
        if (audio.flake) audio.flake(); else music.note();
        platform.haptic('select');
        if (e.s !== undefined && e.s !== 0) {
          this.track.toWorld(e.s, e.u, e.h, _v);
          this.ctx.fx.burst(_v.x, _v.y, -_v.z, 3, 0xffe9a0, 2.5, 0.07, 1.5);
        }
        break;
      case 'snow': {
        this.snowChain = this.time - this.snowT < 1.5 ? this.snowChain + 1 : 0;
        this.snowT = this.time;
        this.addSnow((1 / RCFG.pilesPerTier[Math.min(3, this.tier)]) * (this.buffs.has('kar') ? 2 : 1) * (1 + 0.06 * Math.min(5, this.perm.size || 0)));
        audio.pop(0.4, Math.min(8, this.snowChain + 3));
        this.squash = Math.max(this.squash, 0.2);
        this.burst(8, 0xffffff, 2);
        break;
      }
      case 'star':
        this.score += 500;
        audio.milestone(2);
        break;
      case 'x2':
        this.x2T = this.dur('x2');
        audio.milestone(3);
        this.float('ÇARPAN +3!', 'big');
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'x2' });
        break;
      case 'superjump':
        this.superT = this.dur('superjump');
        audio.milestone(3);
        this.float('SÜPER ZIPLAMA!', 'big');
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'superjump' });
        break;
      case 'bread':
        if (this.bread) { this.score += 300 * this.mult; ui.toastSoft?.('🥐 Çörek dolu'); }
        else { this.bread = 1; this.breadChip(); this.float('🥐 SICAK ÇÖREK', 'big'); }
        audio.star(2); platform.haptic('success');
        break;
      case 'bait':
        if (this.bait >= 2) { this.score += 300 * this.mult; ui.toastSoft?.('🐟 Yem dolu (2/2)'); }
        else { this.bait++; this.baitChip(); ui.toastSoft?.('🐟 BALIK YEMİ!'); }
        audio.star(2); platform.haptic('success');
        break;
      case 'gem':
      case 'crystal':
        this.crystals++;              // the revive currency, credited the moment you grab it (a soft toast, no popup)
        this.ctx.meta?.addCrystals?.(1);
        audio.star(2);
        platform.haptic('success');
        ui.toastSoft?.('💎 +1');
        break;
      case 'box':
        this.boxes++;                 // credited when the run is recorded; no popup
        audio.star(1);
        platform.haptic('success');
        break;
      case 'plowdodge':
        this.score += 500 * this.mult; this.addFlakes(25);
        this.float('KAR SAVAŞI! +500', 'big'); audio.milestone?.(3);
        break;
      case 'letter': {
        if (this.yetiN < 4 && e.letter === 'YETİ'[this.yetiN]) {
          this.yetiN++;
          audio.milestone(4); platform.haptic('success');
          const got = 'YETİ'.slice(0, this.yetiN).split('').join('-');
          if (this.yetiN < 4) { this.float(got, 'big'); this.obstacles.setYetiLetter?.('YETİ'[this.yetiN]); }
          else {
            this.obstacles.setYetiLetter?.(null);
            this.addFlakes(500 * this.mult); this.score += 2000 * this.mult; this.dblT = 15;
            ui.buffAdd?.('yeti', '❄️', 'ÇİFT SKOR', 15);
            this.float('YETİ TAMAM!', 'big');
          }
          break;
        }
        this.ctx.meta?.collectLetter?.();
        audio.milestone(4);
        platform.haptic('success');
        this.obstacles.setNextLetter?.(this.ctx.meta?.letterHunt?.()?.nextLetter ?? null);
        break;
      }
      case 'scarf':
        this.seasonTokens = (this.seasonTokens || 0) + 1;
        this.ctx.meta?.track?.('season_token', { n: 1 });
        this.score += 50 * this.mult; audio.star(3); platform.haptic('light'); this.scarfChip();
        break;
      case 'timewarp':
        this.warpT = 3.5;
        audio.milestone(3);
        this.float('ZAMAN BÜKÜCÜ!', 'big');
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'timewarp' });
        break;
      case 'ghost':
        this.ghostT = 5;
        this.setGhost(true);
        audio.milestone(3);
        this.float('HAYALET!', 'big');
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'ghost' });
        break;
      case 'risk':
        this.riskT = 10;
        audio.milestone(5);
        this.float('RİSK MODU!', 'big');
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'risk' });
        break;
      case 'clone':
        this.startClone(12);
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'clone' });
        break;
      case 'helmet':
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'helmet' });
        if (this.helmet || this.sledT > 0) { this.coins += 50; this.float('+50 ❄️', ''); }   // already protected: a coin bonus instead
        else {
          this.helmet = true;
          this.helmetT = RCFG.helmetT;
          audio.milestone(3);
          platform.haptic('success');
          this.float('KASK!', 'big');
        }
        break;
      case 'magnet':
        this.magnetT = this.dur('magnet') * (this.abil === 'kofte' ? 1.3 : 1);
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'magnet' });
        audio.milestone(3);
        this.float('MIKNATIS!', 'big');
        break;
      case 'cannon':
        this.cannonN = 5; this.cannonT = 25; this.cannonCd = 0.5;
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'cannon' });
        audio.milestone(3); platform.haptic('success');
        this.float('KAR KANONU!', 'big'); this.cannonChip();
        break;
      case 'rocket':
        this.rocketT = this.dur('rocket');
        this.powerups = (this.powerups || 0) + 1; this.ctx.meta?.track?.('powerup', { kind: 'rocket' });
        // Sky lane of snowflakes for the flight (if the obstacles module supports it).
        this.obstacles.spawnSkyCoins?.(b.s + 12, b.s + 12 + this.rocketT * b.vs * 1.2);
        this.stumbleT = 0;                    // flying: the Yeti loses you
        this.gap = Math.max(this.gap, RCFG.yetiMax - 4);
        audio.whoosh();
        platform.haptic('success');
        this.float('ROKET!', 'big');
        break;
      default:
        break;
    }
  }

  // Flakes (coins). The gold card doubles them; permanent upgrades add a little. Whole coins only.
  addFlakes(v) {
    this.coinsF += v * (this.abil === 'cini' ? 1.1 : 1) * (this.buffs.has('altin') ? 2 : 1) * (1 + 0.08 * Math.min(5, this.perm.coin || 0));
    const whole = Math.floor(this.coinsF);
    this.coins += whole;
    this.coinsF -= whole;
  }

  // Little critters (Mario goombas): land on one from above and it pops and you bounce, chaining combos; touch one head-on
  // or from the side and you stumble (never lethal). B decides `stomp` (ball moving down, ball bottom above 45% of its height).
  critter(e) {
    const b = this.b;
    const { audio, platform, ui } = this.ctx;
    const obs = this.obstacles;
    if (e.stomp) {
      obs.killCritter?.(e.id);
      if (e.kind === 'penguin') this.addPenguin();
      this.stompN += this.abil === 'kirpi' ? 2 : 1;
      if (this.stompN >= 2) this.addFury(0.06);
      this.stompTotal++;
      this.groundT = 0;
      this.grounded = false;
      this.holeAir = false;
      this.coyoteT = 0;
      this.duckT = 0;
      b.vh = (this.jumpBufT > 0 ? RCFG.stompV + 3 : RCFG.stompV) + (this.abil === 'kirpi' ? 2 : 0);      // a jump pressed just before = a higher bounce (Mario)
      this.jumpBufT = 0;
      const n = this.stompN;
      this.addFlakes(n);
      this.score += 100 * n * this.mult;
      this.addFlow(2);
      this.kick += 1.5;
      this.squash = -0.2; this.sqV = 0;
      this.trauma = Math.min(1, this.trauma + 0.1);
      if (audio.stomp) audio.stomp(Math.min(6, n - 1)); else audio.pop(0.6, Math.min(8, n + 2));
      platform.haptic('light');
      ui.stompCombo?.(n);              // (the HUD counts the 'stomp' mission event itself; endless_end carries the run total)
      this.burst(10, 0xfff2b0, 3);
      this.mistBurst(5, 0xffffff, 2.5, 0.8);
      if (n >= 3 && n % 2 === 1) this.float(`EZDİN x${n}!`, 'big');
      return;
    }
    obs.killCritter?.(e.id);
    this.burst(8, 0xffffff, 3);
    if (this.rocketT > 0 || this.buffs.has('dev')) {
      // flying / giant: you just plough through it
      this.score += 50 * this.mult;
      audio.crash(0.3);
      return;
    }
    this.critterHit();
  }

  // A critter bump: one size down, the Yeti closes in for the stumble window, 1 s of invulnerability. It never kills by
  // itself (no Yeti catch, no burst): at the smallest size it just eats most of what is left of the meter.
  critterHit() {
    if (this.invulnT > 0 || this.ghostT > 0) return;
    const b = this.b;
    const { audio, platform, ui } = this.ctx;
    const ce = this._ce || (this._ce = { s: 0, u: 0, h: 0.4, color: 0xffffff, toughness: 1, headOn: true });
    ce.s = b.s; ce.u = b.u; ce.h = 0.4;
    if (this.absorbShield(ce)) return;
    this.crashes++;
    this.flow = 0;
    this.flowLvl = 0;
    this.breakCombo();
    this.layersLost++;
    this.ctx.meta?.track?.('crash', {});
    if (this.tier > 0) { this.tier--; this.grow = Math.min(this.grow, 0.5); }
    else this.grow = Math.max(0.05, this.grow - 0.4);
    this.syncRadius();
    b.vs *= RCFG.critterSlow;
    this.nearChain = 0;
    this.invulnT = RCFG.invulnAfterCrash;
    this.openStumble();
    this.burst(12, 0xffffff, 5);
    this.mistBurst(8, 0xffffff, 4, 1.2);
    this.hitStop = Math.max(this.hitStop, 0.06);
    this.trauma = Math.min(1, this.trauma + 0.45);
    this.kick += 1;
    ui.flash?.('hit');
    audio.crash(0.3);
    audio.bump(0.6);
    platform.haptic('heavy');
    this.float('TÖKEZLEDİN!', 'bad');
  }

  // Magnet: pull nearby flakes in by widening the pickup radius for flakes only.
  magnetRadius() { return this.magnetT > 0 || this.buffs.has('miknatis') ? 4.5 : 0; }

  finish() {
    if (this.state !== 'play') return;
    this.state = 'finished';
    this.finishT = 0;
    this.ctx.ui.turnCue?.(0, 0);
    this.topMsg('BİTİŞ!', 'big');
    this.ctx.ui.flash?.('gold');
    this.ctx.audio.win();
    this.ctx.platform.haptic('success');
    this.ctx.menus?.confetti?.(80);
    if (this.level?.boss) this.bossWin();
    this.ctx.audio.setRoll(0, 0);
    music.duck(true);
    this.onFinish?.(this.levelStats());
    this.coinsBanked = this.coins;      // the campaign's finish handler credits the coins itself
  }

  levelStats() {
    const len = this.level ? this.level.length : this.b.s;
    return {
      finished: this.state === 'finished',
      distance: Math.round(this.b.s), score: Math.round(this.score), coins: this.coins,
      flakes: this.coins, flakesPct: clamp(this.coins / Math.max(1, len / 8), 0, 1),
      crashes: this.crashes, layersLost: this.layersLost, maxTier: this.maxTier,
      minYetiGap: Number.isFinite(this.minGap) ? this.minGap : RCFG.yetiMax, perfects: this.perfects, powerups: this.powerups, time: this.time, seasonTokens: this.seasonTokens || 0,
      turns: this.turns, stumbles: this.stumbles, stomps: this.stompTotal, killKind: this.killKind,
    };
  }

  // ---------- death / result / revive ----------
  die(cause) {
    if (this._baitEl) this._baitEl.style.display = 'none';
    if (this._scarfEl) this._scarfEl.style.display = 'none';
    if (this.state !== 'play') return;
    this.saveGhost();
    this.endBoss(false);
    const { ui, audio, platform } = this.ctx;
    this.zip = null;
    this.grind = null;
    this.rage = null;
    this.wallRun = null;
    this.bannerQ.length = 0;
    this.later.length = 0;
    this.juncSlow = false;
    this.jnOpen = false;
    this.jumpBufT = 0;
    ui.turnCue?.(0, 0);
    ui.hint?.(false);
    ui.stompCombo?.(0);
    this.state = 'dying';
    this.cause = cause;
    if (cause !== 'smash' && cause !== 'wall') this.killKind = null;       // (killKind only names what a head-on hit / the barrier was)
    this.deadT = 0;
    this.deathZoom = 0;
    this.deathCard();
    music.stinger('death');
    music.duck(true);
    audio.setRoll(0, 0);
    audio.lose();
    platform.haptic('warning');
    this.trauma = Math.min(1, this.trauma + 0.5);
  }

  // Death read-out: cause icon + text + big distance, through the shared announcement scheduler.
  deathCard() {
    const ICON = { wall: '🧱', fall: '🕳️', melt: '💧', yeti: '👹', smash: '💥', explode: '💣' };
    const TXT = { wall: 'DUVARA ÇARPTIN', fall: 'DÜŞTÜN', melt: 'ERİDİN', yeti: 'YETİ YAKALADI', smash: 'ÇARPTIN', explode: 'PATLADIN' };
    const d = Math.round(this.b.s);
    this.ctx.ui.float?.((ICON[this.cause] || '💀') + ' ' + (TXT[this.cause] || 'BİTTİ') + ' · ' + d.toLocaleString('tr-TR') + ' m', window.innerWidth * 0.5, window.innerHeight * 0.3, 'bad');
  }

  updateDying(dt, rdt) {
    const b = this.b;
    this.deadT += rdt;
    if (this.deadT < 0.6) this.deathZoom = Math.min(1, this.deadT / 0.4);
    let T = 1.4;
    if (this.cause === 'fall') {
      b.vh -= RCFG.gravity * dt;
      b.h = Math.max(-70, b.h + b.vh * dt);
      b.s += b.vs * 0.5 * dt;
      T = 1.8;
    } else if (this.cause === 'yeti') {
      // The Yeti catches up and scoops the ball.
      this.gap = Math.max(-1, this.gap - 25 * dt);
      b.vs *= Math.exp(-3 * dt);
      b.s += b.vs * dt;
      if (this.deadT > 0.5) this.ctx.ball.group.visible = false;
    } else if (this.cause === 'melt') {
      // The ball melts away: it shrinks to nothing in a cloud of blue-white drops.
      b.vs *= Math.exp(-1.5 * dt);
      b.s += b.vs * dt;
      b.r = Math.max(0.04, b.r - rdt * 0.5);
      if (Math.random() < rdt * 40) this.mistBurst(1, 0xaed8ff, 1.5, 0.6);
      if (this.deadT > 1.0) this.ctx.ball.group.visible = false;
      T = 1.5;
    } else {
      b.vs *= Math.exp(-4 * dt);
    }
    if (this.deadT > T && this.state === 'dying') this.finishOver();
  }

  bankCoins() {
    const d = this.coins - this.coinsBanked;
    if (d > 0) this.ctx.save.addCoins(d);
    this.coinsBanked = this.coins;
  }

  // The run is over for good: record it (top list, daily best, missions) exactly once.
  recordRun() {
    if (this.recorded) return this.recInfo || { rank: 0, dailyBest: false };
    this.recorded = true;
    if (!this.level) this.ctx.meta?.track?.('season_run_end', { total: this.seasonTokens || 0, n: this.seasonTokens || 0 });
    const { save } = this.ctx;
    const meta = this.ctx.meta;
    const score = Math.round(this.score), dist = Math.round(this.b.s);
    const rank = save.recordRunner?.(score, dist) || 0;
    const dailyBest = !!save.recordDailyRunner?.(score);
    if (this.daily) this.dailyRec = storeDaily(this.daily, dist, score);
    meta?.track?.('endless_end', {
      distance: dist, score, coins: this.coins, crashes: this.crashes, cause: this.cause, killKind: this.killKind,
      maxTier: this.maxTier, seasonTokens: this.seasonTokens || 0, jumps: this.jumps, smashes: this.smashes, turns: this.turns, stumbles: this.stumbles, stomps: this.stompTotal,
    });
    if (this.boxes) meta?.addBoxes?.(this.boxes);      // credited silently
    this.recInfo = { rank, dailyBest };
    return this.recInfo;
  }

  // Leaving the run (retry, menu, quit): bank the coins, and record it if it had really ended. Idempotent.
  closeOut() {
    if (this.closed) return;
    this.closed = true;
    this.bankCoins();
    if (this.level || this.recorded) return;
    // a finished run, or one the player walked away from after real progress (quit / restart from the pause menu keeps the record)
    if (this.state === 'over' || this.state === 'dying' || (this.state === 'play' && this.b.s > 100)) this.recordRun();
  }

  finalizeRun() { this.closeOut(); }

  finishOver() {
    this.state = 'over';
    const meta = this.ctx.meta;
    this.bankCoins();
    if (this.level) {
      meta?.track?.('endless_end', { distance: Math.round(this.b.s), score: Math.round(this.score), coins: this.coins, crashes: this.crashes, cause: this.cause, maxTier: this.maxTier, campaign: true, turns: this.turns, stumbles: this.stumbles });
      this.onFail?.(this.cause, this.levelStats());
      return;
    }
    this.reviveCost = meta?.reviveCost?.(this.revives) ?? 0;
    let canRevive = meta ? (meta.crystals ?? 0) >= this.reviveCost : !this.revived;
    this.coinRev = false;
    if (!canRevive && !this.revived && !this.coinUsed && (this.ctx.save.coins || 0) >= 50) canRevive = this.coinRev = true;   // DEVAM ❄ 50, once per run
    this.showRecap(() => this.showResult(canRevive));
  }

  // BÖLÜM ÖZETİ: <=12 events collected during the run; a tiny strip plays <=1.2 s (tap skips) before the result screen.
  rcpAdd(k) { if (this.rcp.length < 10) this.rcp.push({ s: this.b.s, k }); }

  _rcpKill() { if (this._rcpEl) { this._rcpEl.remove(); this._rcpEl = null; } clearTimeout(this._rcpTm); this._rcpTm = 0; }

  showRecap(done) {
    const dist = Math.max(1, Math.round(this.b.s));
    if (dist < 50 || typeof document === 'undefined') { done(); return; }
    const ev = this.rcp.slice();
    if (this.rcpN >= 4) ev.push({ s: this.rcpS, k: 'combo', n: this.rcpN });
    ev.push({ s: this.b.s, k: 'death' });
    const LB = { rec: 'REKOR', boss: 'BOSS', combo: 'KOMBO', wall: 'DUVAR', fall: 'DÜŞÜŞ', melt: 'ERİME', yeti: 'YETİ', smash: 'ÇARPMA', explode: 'PATLAMA' };
    const IC = { rec: '🏆', boss: '🧌', combo: '🔥', wall: '🧱', fall: '🕳️', melt: '💧', yeti: '👹', smash: '💥', explode: '💣' };
    const el = this._rcpEl = document.createElement('div');
    el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);width:min(92vw,380px);box-sizing:border-box;top:calc(env(safe-area-inset-top,0px) + 70px);z-index:60;padding:10px 12px 8px;border-radius:18px;background:rgba(15,30,55,.88);color:#fff;font:800 16px system-ui,sans-serif;text-align:center;touch-action:manipulation;opacity:0;transition:opacity .15s';
    let h = '<div style="letter-spacing:.12em;opacity:.85">BÖLÜM ÖZETİ</div><div style="font-size:26px;line-height:1.1">' + dist.toLocaleString('tr-TR') + ' m</div><div style="position:relative;height:62px;margin:8px 10px 0"><div style="position:absolute;left:0;right:0;top:30px;height:6px;border-radius:3px;background:rgba(255,255,255,.2)"></div><div class="rf" style="position:absolute;left:0;top:30px;height:6px;width:0;border-radius:3px;background:#7fd0ff;transition:width 1s linear"></div>';
    for (const e of ev) {
      const f = Math.min(1, Math.max(0, e.s / dist));
      const ic = e.k === 'death' ? (IC[this.cause] || '💀') : IC[e.k];
      h += '<div class="ri" style="position:absolute;left:' + (f * 100).toFixed(1) + '%;top:0;transform:translateX(-50%) scale(0);font-size:26px;line-height:28px;transition:transform .18s cubic-bezier(.3,1.8,.5,1);transition-delay:' + (f * 0.8).toFixed(2) + 's">' + ic + (e.n ? '<span style="font-size:13px">' + e.n + '</span>' : '') + '<div style="font-size:10px;line-height:12px;opacity:.85">' + (LB[e.k === 'death' ? this.cause : e.k] || '') + '</div></div>';
    }
    el.innerHTML = h + '</div>';
    document.body.appendChild(el);
    let fin = false;
    const end = () => { if (fin) return; fin = true; this._rcpKill(); done(); };
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); end(); });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (fin) return;
      el.style.opacity = '1';
      el.querySelector('.rf').style.width = '100%';
      el.querySelectorAll('.ri').forEach((n) => { n.style.transform = 'translateX(-50%) scale(1)'; });
    }));
    this._rcpTm = setTimeout(end, 1500);
  }

  // The result screen. While a revive is possible the run is NOT recorded yet (a revive continues the same run).
  showResult(canRevive) {
    const { save, ui } = this.ctx;
    const meta = this.ctx.meta;
    const b = this.b;
    const bestBefore = save.runnerBest?.() ?? 0, bestDistBefore = save.runnerBestDist?.() ?? 0;
    const dist = Math.round(b.s), score = Math.round(this.score);
    let rank = 0, dailyBest = false;
    if (!canRevive) { const info = this.recordRun(); rank = info.rank; dailyBest = info.dailyBest; }
    else rank = save.previewRunnerRank?.(dist) ?? 0;
    const isBestDist = dist >= 50 && dist > bestDistBefore;
    const dt = ui.runnerDeathText ? ui.runnerDeathText(this.cause, this.killKind) : null;
    ui.showRunnerResult({
      cause: this.cause,
      killKind: this.killKind,
      title: (dt && dt.title) || DEATH_TEXT[this.cause] || 'BİTTİ!',
      tip: dt ? dt.tip : '',
      dailyBest,
      daily: this.daily ? { num: this.daily.num, best: (this.dailyRec || { dist }).dist } : null,
      destruction: DESTRUCTION[this.destTier].name,
      tons: Math.round(this.destTons),
      rank,
      toRecord: Math.max(0, Math.round(bestDistBefore - dist)),
      missions: meta?.missions?.() ?? [],
      layer: this.layer + 1,
      boxes: this.boxes,
      seasonTokens: this.seasonTokens || 0,
      reviveCost: this.reviveCost,
      coinRevive: this.coinRev ? 50 : 0,
      crystals: meta?.crystals ?? 0,
      distance: dist,
      score,
      coins: this.coins,
      best: Math.max(bestBefore, score),
      bestScore: Math.max(bestBefore, score),
      bestDist: Math.max(bestDistBefore, dist),
      isBest: isBestDist,
      isBestDist,
      canRevive,
      onRevive: () => this.revive(),
    });
  }

  // "BENİ KURTAR": gems buy a continuation of the same run (1, 2, 4, 8 💎). Nothing is banked or recorded twice.
  revive() {
    if (this.state !== 'over' || this.level || this.recorded) return false;
    this._rcpKill();                                  // the recap strip never survives into play
    const meta = this.ctx.meta;
    if (this.coinRev) {
      if (this.coinUsed || !this.ctx.save.spend?.(50)) return false;
      this.coinUsed = true; this.coinRev = false;
    } else if (meta) {
      if (!meta.spendCrystals?.(this.reviveCost ?? 1)) return false;
    } else if (this.revived) return false;
    this.revived = true;
    this.revives++;
    const { ui } = this.ctx;
    const b = this.b;
    const tr = this.track;
    // The safe spot can be older than the part of the track that is still built (fast runs): take the first solid ground after it.
    let sSafe = this.lastSafe.s;
    for (let k = 0; k < 60 && sSafe < b.s && tr.surfaceAt(sSafe, this.lastSafe.u) === -Infinity; k++) sSafe += 4;
    b.s = sSafe;
    this.lane = this.laneSnap(this.lastSafe.u / RCFG.laneW);
    b.u = this.lane * RCFG.laneW;
    b.h = Math.max(0, tr.surfaceAt(b.s, b.u));
    b.vh = 0; b.vu = 0; b.ve = 0;
    b.vs = speedAt(b.s) * 0.7;
    this.killKind = null;
    this.tier = Math.max(this.tier, 1);
    this.grow = 0.5;
    this.syncRadius();
    this.rShown = b.r;
    this.targetU = b.u;
    this.grounded = true;
    this.lastSurf = b.h;
    this.lastSlope = 0;
    this.fallLock = false;
    this.holeRun = 0;
    this.holeAir = false;
    this.wallRun = null;
    this.groundT = 0;
    this.coyoteT = 0;
    this.jumpBufT = 0;
    this.edgeS = -1;
    this.duckT = 0;
    this.duckOnLand = false;
    this.zip = null;
    this.grind = null;
    this.rocketT = 0;
    this.stumbleT = 0;
    this.yetiHoldT = 2;
    this.gap = RCFG.yetiStart;
    this.invulnT = 3;
    this.meltGraceT = 4;
    this.hungerWarn = false;
    this.nearChain = 0;
    this.stompN = 0;
    this.jnId = null; this.jnDone = false; this.jnOpen = false; this.jnNear = false; this.juncSlow = false;
    const J = tr.junctionAt ? tr.junctionAt(b.s) : null;
    if (J && b.s >= J.s - Math.max(J.s - J.s0, RCFG.juncMinSecs * b.vs) - 1) { this.jnId = J.id !== undefined ? J.id : J.s; this.jnDone = true; }   // revived inside a turn window: that corner is forgiven
    this.cornerK = 0;
    this.countT = 0.8;
    this.countQuiet = true;
    this.hitStop = 0;
    this.state = 'play';
    this.ctx.ball.group.visible = true;
    this.obstacles.clearRange?.(b.s, b.s + b.vs * 1.4);
    ui.hideRunnerRevive?.();
    ui.hideResult?.();
    music.duck(false);
    music.stinger('revive');
    this.ctx.input.clear ? this.ctx.input.clear() : (this.ctx.input.consumeDx(), this.ctx.input.consumeJump());
    this.placeBall(true);
    return true;
  }

  // The result screen's "BİTİR" (compat with a separate revive panel): give up the revive and show the final result.
  declineRevive() {
    if (this.state !== 'over' || this.level) return;
    this.ctx.ui.hideRunnerRevive?.();
    this.showResult(false);
  }

  endGrind() {
    if (!this.grind) return;
    this.grind = null;
    this.jump(6, true);
    this.b.vs = Math.max(this.b.vs, Math.min(speedAt(this.b.s) + 4, this.b.vs + 3));
    this.float('RAY BİTTİ! +HIZ', '');
  }

  // ---------- visuals ----------
  placeBall(snap, dt = 1 / 60) {
    const b = this.b;
    const tr = this.track;
    tr.frame(b.s, _f);
    // Squash & stretch as a damped spring (frame-rate independent); the duck eases in and out.
    const sdt = Math.min(dt, 0.05);
    if (sdt > 0) {
      this.sqV += (-260 * this.squash - 2 * 0.35 * 16.1 * this.sqV) * sdt;
      this.squash += this.sqV * sdt;
    }
    this.duckK += ((this.duckT > 0 ? 1 : 0) - this.duckK) * Math.min(1, sdt * 25);
    const sq = this.squash, dk = this.duckK;
    const sy = (1 - 0.3 * sq) * (1 - 0.5 * dk), sxz = (1 + 0.25 * sq) * (1 + 0.35 * dk);
    // The bottom of the ball stays on the snow while it squashes.
    tr.toWorld(b.s, b.u, b.h + this.rShown * 0.96 * sy, _v);
    const ball = this.ctx.ball;
    // Rolling: forward motion turns about -right, sideways motion about the tangent.
    ball.rollAxis(_f.right, -this.rollS / Math.max(0.2, this.rShown));
    ball.rollAxis(_f.tan, this.rollU / Math.max(0.2, this.rShown));
    this.rollS = this.rollU = 0;
    ball.group.position.copy(_v);
    ball.x = _v.x; ball.y = _v.y; ball.d = -_v.z; ball.r = this.rShown;
    const gp = this.glowT > 0 ? 1 + 0.2 * Math.sin(Math.min(1, this.glowT / 0.5) * Math.PI) : 1;
    if (this.glowT > 0) this.glowT -= sdt;
    ball.group.scale.set(sxz * gp, sy * gp, sxz * gp);
    this.juiceFrame(_f, _v, dt);
    this.updateClone();
    this.placeShadow();
    ball.airborne = !this.grounded;
    if (this.state === 'play') {
      // Blink while invulnerable after a crash/revive.
      ball.group.visible = this.invulnT > 0 ? Math.floor(this.time * 14) % 2 === 0 : true;
    }
    if (snap) this.updateCamera(1, true);
  }

  // Powder spray, ribbon trail and speed lines — what makes speed *feel* like speed.
  juiceFrame(f, pos, dt) {
    const b = this.b;
    const fx = this.ctx.fx;
    const playing = this.state === 'play' && this.countT <= 0;
    const speedK = clamp((b.vs - RCFG.startSpeed) / (RCFG.refSpeed - RCFG.startSpeed), 0, 1);
    if (playing && this.grounded && !this.grind) {
      const rate = (0.35 + speedK * 0.9) * Math.min(3, dt * 60);
      if (Math.random() < rate) {
        const side = Math.random() < 0.5 ? -1 : 1;
        _tp.copy(pos).addScaledVector(f.right, side * this.rShown * 0.8).addScaledVector(f.up, -this.rShown * 0.7);
        fx.puff(_tp.x, _tp.y, _tp.z,
          f.right.x * side * 2 - f.tan.x * b.vs * 0.15, 1.2, f.right.z * side * 2 - f.tan.z * b.vs * 0.15,
          0.35 + this.rShown * 0.5, 0.7, this.biomeMist ?? 0xffffff, 0.45);
      }
    }
    if (playing && this.rocketT > 0) {
      _tp.copy(pos).addScaledVector(f.tan, -this.rShown);
      fx.puff(_tp.x, _tp.y, _tp.z, (Math.random() - 0.5) * 2, -1, (Math.random() - 0.5) * 2, 0.8, 0.6, Math.random() < 0.5 ? 0xffb050 : 0xdddddd, 0.6);
    }
    // Ribbon trail pressed into the snow (uses the equipped trail's material).
    this.updateTrail(f, pos);
    this.ctx.ui.speedLines?.(playing && this.camLoopK < 0.2 && !ROUND_KINDS.has(this.track.pieceAt(b.s)?.kind) ? Math.min(1.4, Math.pow(Math.max(0, speedK - 0.2) / 0.8, 1.3) + (this.rocketT > 0 ? 0.5 : 0) + (b.vs > RCFG.maxSpeed ? 0.3 : 0)) : 0);
  }

  trailPush(x, y, z, rx, ry, rz, w, gap) {
    const TN = 18, P = this.tpt, G = this.tgap;
    if (this.tn === TN) { P.copyWithin(0, 7, TN * 7); G.copyWithin(0, 1, TN); this.tn--; }
    const i = this.tn++;
    P[i * 7] = x; P[i * 7 + 1] = y; P[i * 7 + 2] = z; P[i * 7 + 3] = rx; P[i * 7 + 4] = ry; P[i * 7 + 5] = rz; P[i * 7 + 6] = w;
    G[i] = gap ? 1 : 0;
  }

  updateTrail(f, pos) {
    const TN = 18; // ~12 m: a long ribbon reaches under the chase camera and reads as a giant wedge
    if (!this.trail) {
      const g = new THREE.BufferGeometry();
      this.trailPos = new Float32Array(TN * 2 * 3);
      this.trailCol = new Float32Array(TN * 2 * 3).fill(1);
      g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', this.ctx.fx.trail.geometry.attributes.color ? new THREE.BufferAttribute(this.ctx.fx.trailCol.slice(0, TN * 6), 3) : new THREE.BufferAttribute(this.trailCol, 3));
      const idx = [];
      for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      this.trail = new THREE.Mesh(g, this.ctx.fx.trail.material);
      this.trail.frustumCulled = false;
      this.trail.renderOrder = 2;
      this.ctx.scene.add(this.trail);
      // preallocated ring of trail points: x y z, right x y z, half width, gap flag
      this.tpt = new Float32Array(TN * 7);
      this.tgap = new Uint8Array(TN);
      this.tn = 0;
    }
    const P = this.tpt, G = this.tgap;
    const hw = this.rShown * 0.5;
    if (!this.grounded) {
      if (this.tn && !G[this.tn - 1]) this.trailPush(0, 0, 0, 0, 0, 0, 0, true);
    } else {
      _tp.copy(pos).addScaledVector(f.up, 0.04 - this.rShown * 0.96);
      const l = this.tn - 1;
      let far = true;
      if (l >= 0 && !G[l]) { const dx = _tp.x - P[l * 7], dy = _tp.y - P[l * 7 + 1], dz = _tp.z - P[l * 7 + 2]; far = dx * dx + dy * dy + dz * dz > 0.6; }
      if (far) this.trailPush(_tp.x, _tp.y, _tp.z, f.right.x, f.right.y, f.right.z, hw, false);
    }
    const arr = this.trailPos;
    let n = 0;
    for (let i = 0; i < this.tn; i++) {
      if (G[i]) continue;
      const o = i * 7;
      const fade = Math.min(1, n / 10);
      const w = P[o + 6] * fade;
      arr[n * 6] = P[o] - P[o + 3] * w; arr[n * 6 + 1] = P[o + 1] - P[o + 4] * w; arr[n * 6 + 2] = P[o + 2] - P[o + 5] * w;
      arr[n * 6 + 3] = P[o] + P[o + 3] * w; arr[n * 6 + 4] = P[o + 1] + P[o + 4] * w; arr[n * 6 + 5] = P[o + 2] + P[o + 5] * w;
      n++;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.trail.visible = this.state !== 'idle';
  }

  mistBurst(n, color, speed, size) {
    const p = this.ctx.ball.group.position;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.ctx.fx.puff(p.x + Math.cos(a) * this.rShown, p.y - this.rShown * 0.5, p.z + Math.sin(a) * this.rShown,
        Math.cos(a) * speed, Math.random() * speed * 0.5, Math.sin(a) * speed, size * (0.6 + Math.random() * 0.6), 0.9, color, 0.6);
    }
  }

  burst(n, color, speed) {
    const p = this.ctx.ball.group.position;
    this.ctx.fx.burst(p.x, p.y - this.rShown * 0.3, -p.z, n, color, speed, 0.08 + this.rShown * 0.12, 4);
  }

  debris(e, n) {
    this.track.toWorld(e.s ?? this.b.s, e.u ?? this.b.u, (e.h ?? 0) + 1, _v);
    this.ctx.fx.burst(_v.x, _v.y, -_v.z, n, e.color ?? 0x8a6a4a, 7, 0.25, 6);
  }

  // Floating callouts: at most about one per second (a higher-priority one may cut in after 0.35 s), spawned just BELOW the
  // ball over the trail — never on the strip of track the player is reading.
  // ---- first-encounter tips: once ever per mechanic (localStorage), max one per 8 s, never in danger ----
  tip(key, text, slow) {
    if (this.state !== 'play' || this.tipCd > 0 || this.countT > 0 || this.bannerT > 0 || this.ctx.ui.annBusy?.() || (this.zone && this.zone.announced && this.b.s - this.zone.from < 60) || (this.time - this.floatT < 1.5 && this.floatPri >= 2)) return false;
    if ((this.ctx.ui._cmN || 0) > 3) return false;     // no tips in a combo / at speed
    let runs = 0; try { runs = this.ctx.meta?.stats?.().runs || 0; } catch (e) { runs = 0; }
    if (runs >= 2 && this.b.s > 400) return false;      // tips are for new players
    if (this.stumbleT > 0 || this.gap < 9 || this.boss || this.rage || this.hungerWarn || this.zip || this.grind) return false;
    let seen = this.tipsSeen;
    if (!seen) {
      try { seen = JSON.parse(localStorage.getItem('patpat.rush.tips') || '{}') || {}; } catch (e) { seen = {}; }
      this.tipsSeen = seen;
    }
    if (seen[key]) return false;
    seen[key] = 1;
    try { localStorage.setItem('patpat.rush.tips', JSON.stringify(seen)); } catch (e) { /* ignore */ }
    this.tipCd = 8;
    this.ctx.ui.toastSoft?.(text, { drop: true });
    if (slow) this.tipSlowT = 0.9;
    return true;
  }

  tipFor(e) {
    switch (e.type) {
      case 'fx':
        if (e.value !== 0) break;
        if (e.kind === 'turret') this.tip('turret', 'KARTOPU TOPÇUSU: çizgili şeride dikkat, zıpla ya da kaç!', false);
        else if (e.kind === 'icegate') this.tip('icegate', 'BUZ KAPISI: çubuk yukarıdayken geç ya da eğil!', false);
        else if (e.kind === 'pensled') this.tip('pensled', 'PENGUEN KIZAĞI: hızını kolla, doğru anda şerit değiştir!', false);
        break;
      case 'critter': if (!e.stomp) this.tip('stomp', 'ŞİRİN YARATIK: üstüne zıpla, ez!', true); break;
      case 'slide': this.tip('ice', 'BUZ: hızlısın ama yan geçişler yavaş', false); break;
      case 'tunnel': this.tip('tunnel', 'TÜNEL: ışıkları takip et', false); break;
      case 'slowmo': this.tip('jump', 'ATLAYIŞ: boşlukta zıpla, havada kal!', true); break;
      case 'zip': this.tip('zip', 'HALAT: sadece tut, Yeti yetişemez', false); break;
      case 'grind': if (e.active) this.tip('rail', 'RAY: üstünde kay, yön ver', false); break;
      case 'ring': if (!e.miss) this.tip('ring', 'HALKA: art arda geç, çarpan artsın', false); break;
      case 'gate': if (e.grp && !e.miss) this.tip('slalom', 'SLALOM: kapıları sırayla geç', false); break;
      case 'loop': this.tip('loop', 'TAKLA: hız şart, devam et!', false); break;
      case 'pad': if (e.kind === 'boost') this.tip('boost', 'HIZ PEDİ: üstünden geç, hızlan', false); else this.tip('jumppad', 'ZIPLAMA PEDİ: yüksel, havada kal', false); break;
      case 'bait': this.tip('bait', 'BALIK YEMİ: Yeti yakınken ↓↓', false); break;
      case 'cannon': this.tip('cannon', 'KAR KANONU: engelleri otomatik vurur', false); break;
      case 'magnet': this.tip('magnet', 'MIKNATIS: kar ve altınlar sana gelir', false); break;
      case 'ghost': this.tip('ghostp', 'HAYALET: engellerden geçersin', false); break;
      case 'helmet': this.tip('helmet', 'KASK: bir çarpmayı affeder', false); break;
      case 'rocket': this.tip('rocket', 'ROKET: uç, her şeyi kır!', false); break;
      case 'snow': this.tip('snow', 'KAR: topla, büyü! Top sürekli erir', false); break;
      case 'risk': case 'x2': case 'timewarp': case 'clone': case 'superjump': this.tip('buff', 'BONUS KARTI: kısa süreli güç!', false); break;
    }
  }

  float(text, cls) {
    const pri = FLOAT_PRI[cls] ?? 1;
    if (pri < 2) return;                           // low-value info text (buff ends, +50, KAPI 1/3 ...) is never shown
    if (this.bannerT > 0 && pri < 3) return;      // one big centre text at a time: a banner owns the slot
    const lastSame = this.floatSeen.get(text);
    if (lastSame !== undefined && this.time - lastSame < (pri >= 3 ? 1.5 : 4)) return;   // repeat throttle
    const since = this.time - this.floatT;
    if (since < 0.9 && !(pri > this.floatPri && since > 0.3)) {
      if (pri === 1) return;                       // info never queues
      const p = this.floatPend;
      if (!p || pri >= p.pri) this.floatPend = { text, cls, pri, t: this.time };   // reward/danger wait (<=1.2 s) for the slot
      return;
    }
    this._floatNow(text, cls, pri);
  }

  _floatNow(text, cls, pri) {
    const p = this.ctx.ball.group.position;
    _v2.copy(p).project(this.ctx.camera);
    if (_v2.z > 1) return;
    this.floatT = this.time;
    this.floatPri = pri;
    this.floatSeen.set(text, this.time);
    if (this.floatSeen.size > 40) this.floatSeen.clear();
    const H = window.innerHeight;
    if (pri === 1) { this.ctx.ui.float(text, (_v2.x * 0.5 + 0.5) * window.innerWidth, H * 0.86, cls); return; }   // tiny info: below the ball, off the road
    this.topMsg(text, cls);
  }

  // centre messages live just under the HUD (~21% of the screen height), never on the road
  topMsg(text, cls) {
    this.ctx.ui.float(text, window.innerWidth * 0.5, window.innerHeight * 0.21, cls || 'big');
  }

  tickFloatQ() {
    const p = this.floatPend;
    if (!p) return;
    if (this.time - p.t > 1.2) { this.floatPend = null; return; }   // stale: drop
    if (this.time - this.floatT >= 0.9) { this.floatPend = null; this._floatNow(p.text, p.cls, p.pri); }
  }

  roar(quiet = false) {
    const { audio, platform } = this.ctx;
    audio.bump(1);
    audio.crash(0.25);
    platform.haptic('heavy');
    this.trauma = Math.min(1, this.trauma + (quiet ? 0.15 : 0.3));
  }

  updateYeti(dt) {
    const y = this.yeti;
    const b = this.b;
    // Only when it's really on the track (at the very start it would be clamped onto the start line, right in
    // front of the camera).
    // (It is also shown on the start line: the first metres extrapolate the track backwards so it looms right behind the ball.)
    const gapV = this.gap + (this.baitBonus || 0);
    const show = this.state !== 'idle' && (this.boss ? this.b.s + this.boss.off > 1 : this.b.s - gapV > 1 || (gapV < 12 && this.b.s < 40));
    y.group.visible = show;
    this.avalanche.group.visible = show;
    if (!show) return;
    y.t += dt;
    if (this.boss) this.avalanche.group.visible = false;
    const gs = this.boss ? b.s + this.boss.off : b.s - Math.max(-0.5, gapV);
    const eat = this.baitT > 0 ? Math.min(1, (3 - this.baitT) * 5, this.baitT * 5) : 0;
    const tr = this.track;
    tr.frame(Math.max(0, gs), _f);
    // The Yeti tracks your lane with a lag and bounds along.
    y.u += ((this.boss ? this.boss.yu : b.u) - y.u) * Math.min(1, dt * 2.5);
    const run = Math.abs(Math.sin(y.t * 7)) * (1 - eat);
    const sf = tr.surfaceAt(gs, y.u);
    tr.toWorld(Math.max(0, gs), y.u, Math.max(0, sf === -Infinity ? 0 : sf) + run * 0.8, _v);
    if (gs < 0) _v.addScaledVector(_f.tan, gs);       // behind the start line: follow the tangent back
    _x.copy(_f.right).negate();
    _m.makeBasis(_x, _f.up, _f.tan);
    _q.setFromRotationMatrix(_m);
    // Lean in and pump: tilt forward with the stride.
    const lean = 0.25 + Math.sin(y.t * 7) * 0.08 * (1 - eat) + eat * (0.55 + Math.sin(y.t * 16) * 0.12);   // head down, chomp chomp
    _q2.setFromAxisAngle(_ax.set(1, 0, 0), lean);
    y.mesh.quaternion.copy(_q).multiply(_q2);
    y.mesh.position.copy(_v);
    const sc = y.scale * (1 + Math.sin(y.t * 14) * 0.03 + eat * Math.sin(y.t * 16) * 0.06);
    y.mesh.scale.set(sc, sc * (1 - run * 0.06 - eat * Math.abs(Math.sin(y.t * 8)) * 0.12), sc);

    // A wall of powder rolls behind it.
    const av = this.avalanche;
    av.t += dt;
    const as = gs - 6;
    tr.frame(Math.max(0, as), _f);
    if (as < 0) _f.pos.addScaledVector(_f.tan, as);
    let k = 0;
    for (let i = 0; i < av.count; i++) {
      const row = i % 3;
      const col = Math.floor(i / 3);
      const u = (col / (av.count / 3 - 1) - 0.5) * 20;
      const bob = Math.sin(av.t * 3 + i * 1.7) * 0.6;
      const size = 2 + ((i * 37) % 11) / 11 * 1.6 - row * 0.4;
      _v.copy(_f.pos).addScaledVector(_f.right, u).addScaledVector(_f.up, 1 + row * 2.2 + bob).addScaledVector(_f.tan, -row * 1.8);
      _q.setFromAxisAngle(_f.right, av.t * 2 + i);
      _s.setScalar(size);
      _m.compose(_v, _q, _s);
      av.mesh.setMatrixAt(k++, _m);
    }
    av.mesh.count = k;
    av.mesh.instanceMatrix.needsUpdate = true;
  }

  // The chase camera rides the path (exactly `camBackS` behind the ball along the track — no world-space lag, so it never
  // cuts corners into banks), looks at a point 12-18 m AHEAD on the track, tilts at most 25° on banked sections (it only
  // follows the track fully where the track itself turns upside down), climbs on high curvature / steep pitch and keeps
  // the ball in the lower-middle of the screen. Hit-stop freezes its filters with the world.
  updateCamera(dt, snap = false) {
    const b = this.b;
    const tr = this.track;
    const r = this.rShown;
    const cam = this.ctx.camera;
    const playing = this.state === 'play';
    const dying = this.state === 'dying' || this.state === 'over';
    const cdt = this.hitStop > 0 ? dt * 0.06 : dt;      // camera filters freeze with the world during hit-stop
    const speedK = clamp((b.vs - RCFG.startSpeed) / (RCFG.refSpeed - RCFG.startSpeed), 0, 1);

    // When the Yeti closes in, the camera climbs and looks down so it looms at the bottom of the screen
    // (Temple Run style) instead of blocking the view. Rises slowly, falls quickly.
    const close = playing ? clamp((10 - this.gap) / 5, 0, 1) : 0;
    this.closeK += (close - this.closeK) * (snap ? 1 : Math.min(1, cdt * (close > this.closeK ? 1.5 : 4)));

    // What kind of ground is the ball on? (round sections / sharp curves / steep pitch need a higher, longer view)
    const pc = tr.pieceAt(b.s);
    const kind = pc ? pc.kind : '';
    this.camRoundK += ((ROUND_KINDS.has(kind) ? 1 : 0) - this.camRoundK) * kfil(snap, cdt, 3);
    const curv = Math.abs(tr.curvature(b.s + 6));
    const curvK = clamp(curv / 0.045, 0, 1);
    tr.frame(b.s + 10, _f2);
    const pitchK = clamp((Math.abs(_f2.tan.y) - 0.25) / 0.45, 0, 1);
    const cornerT = this.jnJ && b.s >= this.jnJ.s - 30 && b.s <= this.jnJ.s + 18 ? 1 : 0;
    this.cornerK += (cornerT - this.cornerK) * kfil(snap, cdt, 8);

    // Helix / corkscrew: ride on the inside of the turn, close behind and low, so the camera never swings out into terrain or an upper pass.
    const helT = kind === 'helix' || kind === 'corkscrew' ? 1 : 0;
    this.camHelixK += (helT - this.camHelixK) * kfil(snap, cdt, 4);
    const hk2 = this.camHelixK;
    let inside = 0;
    if (hk2 > 0.01) { tr.frame(b.s - 4, _f2); _x.copy(_f2.tan); tr.frame(b.s + 8, _f2); _ax.copy(_f2.tan).sub(_x); tr.frame(b.s, _f2); inside = clamp(_ax.dot(_f2.right) * 12, -1, 1); }
    this.camInK += (inside - this.camInK) * kfil(snap, cdt, 3);
    let backT = 9.6 + r * 3.2 - this.closeK * 1.2 + 1.2 * speedK;
    let upT = 5.6 + r * 1.8 + this.closeK * 3.2 + curvK * 1.8 + pitchK * 1.5 + this.camRoundK * 0.8 + this.cornerK * 1.8;
    const dk = this.state === 'dying' && this.cause !== 'fall' ? clamp(this.deadT / 0.9, 0, 1) : 0;   // death pull-back: ease back and up
    if (dk > 0) { const e = dk * dk * (3 - 2 * dk); backT += 5 * e; upT += 3 * e; }
    let laT = 24 + 8 * speedK + 2 * this.closeK - 6 * this.cornerK;       // through a sharp corner: look a little shorter, swing a little slower
    if (hk2 > 0.001) { backT += (5.6 + r * 1.8 - backT) * hk2; upT += (Math.min(upT, 2.9 + r * 1.1) - upT) * hk2; laT += (8 - laT) * hk2; }
    if (kind === 'tube') { upT = Math.min(upT, 4.6); backT = Math.min(backT, 7); }   // stay inside the 5.6 m tube (axis 4 m up)
    // Inside a vertical loop (a circle only 5.5-11 m in radius) the camera is a rigid chase rig in the BALL's own frame:
    // close behind (along the tangent), up toward the circle's centre, looking at the track a short way ahead.
    const loopT = pc && pc.loop && b.s > pc.loop.s0 - 4 && b.s < pc.loop.s1 + 2 ? 1 : 0;
    this.camLoopK += (loopT - this.camLoopK) * kfil(snap, cdt, 6);
    if (loopT) { const R = pc.loop.R; backT = 0.8 * R + 0.8; upT = 0.5 * R + 0.5; laT = 0.8 * R; }
    const lk = this.camLoopK;
    this.camBackS += (backT - this.camBackS) * kfil(snap, cdt, 5);
    this.camUpH += (upT - this.camUpH) * kfil(snap, cdt, 5);
    this.camLa += (laT - this.camLa) * kfil(snap, cdt, 5);
    this.camU += (b.u * 0.45 + this.camInK * hk2 * 1.6 - this.camU) * kfil(snap, cdt, 9);
    if (this.camLookBiasT > 0) this.camLookBiasT -= dt;
    const biasT = this.camLookBiasT > 0 ? this.camLookBias : 0;
    this.camLookU += (b.u * 0.5 + biasT - this.camLookU) * kfil(snap, cdt, 6);

    const camS = Math.max(0, b.s - this.camBackS);
    tr.frame(camS, _f);
    // Camera "up": a stable blend, 70% world up + 30% the track's up, with the roll clamped to 12 deg. A banked or twisted
    // track can't flip or roll the view, and the camera's height / look offsets use this up too (not the track's own up,
    // which on a steep bank would park the camera off the side of the track).
    _x.copy(WORLD_UP).multiplyScalar(0.7).addScaledVector(_f.up, 0.3);
    if (_x.lengthSq() < 1e-6) _x.copy(WORLD_UP); else _x.normalize();
    const rollA = Math.acos(clamp(WORLD_UP.dot(_x), -1, 1));
    if (rollA > MAX_ROLL) {
      _ax.crossVectors(WORLD_UP, _x);
      const sA = _ax.length();
      if (sA > 1e-4) { _ax.multiplyScalar(1 / sA); _x.copy(WORLD_UP).applyAxisAngle(_ax, MAX_ROLL); }
    }
    _upC.copy(_x);
    const camH = dying && this.cause === 'fall' ? Math.max(b.h + this.camUpH, -6) + this.camUpH * 0.5 : Math.max(b.h * 0.5, 0) + this.camUpH;
    tr.toWorld(camS, this.camU, 0, _v);
    _v.addScaledVector(_upC, camH);           // always above the ball's side of the track, never off to a bank's side
    if (lk > 0.001 && pc && pc.loop) {
      // Vertical loop: a rigid chase rig ON THE SAME PASS of the ring — a point of the track 0.8 R behind the ball, lifted 0.72 R (~0.25 R from the centre, ~0.85 R from the ball)
      // along that station's up (toward the circle's centre). Camera and ball both lie in the circle's disc, so the line of sight
      // is a chord that can never cut the ring or the laterally shifted entry / exit pass (the old centre camera looked across
      // them at the loop's ends and the screen filled with track). Camera up = the track's up at the camera station.
      const R = pc.loop.R, sc = b.s - 0.8 * R;
      tr.frame(sc, _f2);
      tr.toWorld(sc, b.u * 0.5, 0, _tp);
      _tp.addScaledVector(_f2.up, 0.72 * R);
      _v.lerp(_tp, lk);
      _x.lerp(_f2.up, lk).normalize();
    }
    if (pc && (lk > 0.001 || ROUND_KINDS.has(kind)) && this.env?.groundAt) {
      // Safety net: never below the terrain under the camera (+2 m), at most 6 m of correction.
      const gy = this.env.groundAt(_v.x, _v.z, b.s);
      if (gy !== null && _v.y < gy + 2) _v.y += Math.min(6, gy + 2 - _v.y);
    }
    if (dying && this.cause !== 'fall' && this.yeti?.group?.visible) {
      // never inside the Yeti's bounding sphere: push the camera out (and a touch up), and keep ball + Yeti both in frame
      const gsY = b.s - Math.max(-0.5, this.gap + (this.baitBonus || 0));
      tr.toWorld(gsY, b.u, 0, _yp); tr.frame(gsY, _f2); _yp.addScaledVector(_f2.up, 2);
      const YR = 4.2, dx = _v.x - _yp.x, dy = _v.y - _yp.y, dz = _v.z - _yp.z, dl = Math.hypot(dx, dy, dz) || 1e-3;
      if (dl < YR) { const k = YR / dl; _v.set(_yp.x + dx * k, _yp.y + dy * k + (YR - dl) * 0.5, _yp.z + dz * k); }
    }
    // Look target: a point on the track ahead (the lead term cancels the filter's lag at speed).
    const laS = b.s + this.camLa + (snap ? 0 : b.vs * 0.1);
    tr.toWorld(laS, this.camLookU, 0, _look);
    _look.addScaledVector(_upC, Math.max(b.h * 0.6, 0) + 3.2 - this.closeK * 0.6);   // look a little above the track: the ball sits in the lower-middle of the screen
    // Keep the ball horizontally centred: on a curve the track point ahead drifts sideways of the camera->ball line, so the
    // horizontal look direction is blended (85%) toward the camera->ball line, extended past the ball by camLa.
    if (!dying && lk < 0.5) {
      tr.toWorld(b.s, b.u, 0, _tp);
      const dx = _tp.x - _v.x, dz = _tp.z - _v.z, dl = Math.hypot(dx, dz);
      if (dl > 0.5) { const e = (dl + this.camLa) / dl, bx = _v.x + dx * e, bz = _v.z + dz * e, w = 0.85 * (1 - 2 * lk); _look.x += (bx - _look.x) * w; _look.z += (bz - _look.z) * w; }
    }
    if (lk > 0.001) _look.lerp(this.ctx.ball.group.position, lk);
    if (dying) {
      _look.copy(this.ctx.ball.group.position);
      if (this.cause === 'yeti' && this.yeti?.group?.visible) _look.lerp(_yp, 0.3 * clamp(this.deadT / 0.6, 0, 1));
    }
    if (!dying && lk < 0.5) {
      // The look direction never swings more than 25 deg off the track's forward direction at the ball (limits pitch and yaw).
      tr.frame(b.s, _f2);
      _ax.copy(_look).sub(_v);
      const vl = _ax.length();
      if (vl > 1e-3) {
        _ax.multiplyScalar(1 / vl);
        const c = clamp(_ax.dot(_f2.tan), -1, 1);
        if (c < COS_LOOK) {
          _tp.copy(_ax).addScaledVector(_f2.tan, -c);
          const pl = _tp.length();
          if (pl > 1e-4) {
            _tp.multiplyScalar(1 / pl);
            _ax.copy(_f2.tan).multiplyScalar(COS_LOOK).addScaledVector(_tp, SIN_LOOK);
            _look.copy(_v).addScaledVector(_ax, vl);
          }
        }
      }
    }
    this.camPos.copy(_v);
    this.camLook.lerp(_look, snap ? 1 : 1 - Math.exp(-cdt * (10 - 3 * this.cornerK)));
    this.camUp.lerp(_x, snap ? 1 : 1 - Math.exp(-cdt * (7 + 9 * lk)));
    if (this.camUp.lengthSq() < 1e-4) this.camUp.copy(_x);       // (a half-turn between two opposite "ups" would cancel to nothing)
    this.camUp.normalize();
    cam.position.copy(this.camPos);
    cam.up.copy(this.camUp);
    cam.lookAt(this.camLook);

    // Lean into lane changes a touch (≤ 3°) and into a committed turn.
    if (this.jnLeanT > 0) this.jnLeanT -= dt;
    const lean = this.jnLeanT > 0 ? this.jnLean * (this.jnLeanT / 0.45) : 0;
    this.tilt += (clamp(-b.vu * 0.006 - lean * 0.35, -0.052, 0.052) - this.tilt) * Math.min(1, dt * 8);     // <= 3 degrees
    cam.rotateZ(this.tilt);
    // Trauma shake: smooth rotational noise that keeps running through hit-stop (peaks ≈ 3° at trauma 1).
    if (!snap && this.trauma > 0) {
      const a = Math.min(1, this.trauma) ** 2, t = (this.shakeClock += dt);
      cam.rotateX(a * 0.035 * (Math.sin(t * 23.1) + 0.5 * Math.sin(t * 41.7)));
      cam.rotateY(a * 0.035 * (Math.sin(t * 19.3 + 1) + 0.5 * Math.sin(t * 37.9)));
      cam.rotateZ(a * 0.02 * Math.sin(t * 17.7 + 2));
      this.trauma = Math.max(0, this.trauma - dt * 1.8);
    }
    // FOV: a slow speed widening plus unfiltered kicks (smash, near-miss, boost, speed steps).
    if (this.kick > 8) this.kick = 8;
    this.kick *= Math.exp(-7 * dt);
    if (this.kick < 0.01) this.kick = 0;
    const ud = cam.userData;
    ud.fovKick = this.kick;
    // main.js low-passes fovBoost at 4/s, which keeps only ~27% of a short pulse: until it applies fovKick itself (and sets
    // fovKickOk) the pulse is sent through fovBoost with a gain that survives that filter (a smash or near miss: ~1.5 degrees).
    ud.fovBoost = -2 + speedK * 5 + (this.rocketT > 0 ? 6 : 0) + (this.riskT > 0 ? 4 : 0) + (ud.fovKickOk ? 0 : this.kick * 1.6) - (this.state === 'dying' ? 5 * (this.deathZoom || 0) : 0);
  }

  dispose() {
    for (const g of this.penMeshes || []) { this.ctx.scene.remove(g); g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
    this.penMeshes = [];
    this._rcpKill();
    this.stormEl?.remove(); this.stormEl = null;
    if (this.lmGate) { this.ctx.scene.remove(this.lmGate); this.lmGate.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } }); this.lmGate = null; }
    document.getElementById('rcol')?.remove(); this._baitEl = this._scarfEl = this._cannonEl = this._breadEl = null;
    this.introEl?.remove(); this.introEl = null; this._introPend = false; this.accGroup?.parent?.remove(this.accGroup); this.accGroup = null;
    this.closeOut();
    this.rhythm?.dispose(); this.rhythm = null;
    this.track?.dispose();
    this.obstacles?.dispose();
    this.env?.dispose();
    const ui = this.ctx.ui;
    if (this.buffs) { for (const e of this.buffs.list) ui.buffRemove?.(e.id); this.buffs.reset(); }
    ui.buffClear?.();
    ui.hungerHide?.();
    ui.turnCue?.(0, 0);
    ui.stompCombo?.(0);
    if (this.clone) { this.ctx.scene.remove(this.clone.mesh); this.clone = null; }
    if (this.ghostWas) this.setGhost(false);
    if (this.trail) { this.ctx.scene.remove(this.trail); this.trail.geometry.dispose(); this.trail = null; }
    if (this.shadow) { this.ctx.scene.remove(this.shadow); this.shadow.geometry.dispose(); this.shadow.material.map?.dispose(); this.shadow.material.dispose(); this.shadow = null; }
    if (this.ghostMesh) { this.ctx.scene.remove(this.ghostMesh); this.ghostMesh.geometry.dispose(); this.ghostMesh.material.dispose(); this.ghostMesh.children[0]?.material.map?.dispose(); this.ghostMesh = null; }
    if (this.recFlag) {
      this.ctx.scene.remove(this.recFlag);
      this.recFlag.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
      this.recFlag = null;
    }
    ui.speedLines?.(0);
    if (this._baitEl) { this._baitEl.remove(); this._baitEl = null; }
    if (this._scarfEl) { this._scarfEl.remove(); this._scarfEl = null; }
    for (const o of [this.avalanche, this.yeti]) {
      if (!o) continue;
      this.ctx.scene.remove(o.group);
      o.dispose();
    }
    this.track = this.obstacles = this.env = this.avalanche = this.yeti = null;
    const cam = this.ctx.camera;
    cam.up.set(0, 1, 0);
    cam.userData.fovBoost = 0;
    cam.userData.fovKick = 0;
    if (this.camNear0 !== null && cam.near !== this.camNear0) { cam.near = this.camNear0; cam.updateProjectionMatrix?.(); }
    if (this.ctx.ball) this.ctx.ball.group.visible = true;
    music.stop();
    Biomes.setBiomeOverride?.(null);
    this.state = 'idle';
  }
}

function makeYeti(scene, lib) {
  const group = new THREE.Group();
  const def = lib.yeti;
  const geo = def ? def.geometry : new THREE.CapsuleGeometry(0.8, 1.6, 4, 8);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: !!def, color: def ? 0xffffff : 0xdfe9f5, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  group.add(mesh);
  group.visible = false;
  scene.add(group);
  // ~3.3 m tall: big next to the ball, but it must not wall off the chase camera.
  const scale = def ? RCFG.yetiH / Math.max(0.5, def.height) : RCFG.yetiH / 3.2;
  return { group, mesh, scale, t: 0, u: 0, dispose: () => { mat.dispose(); if (!def) geo.dispose(); } };
}

function makeAvalanche(scene) {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xf4f9ff, flatShading: true });
  const count = 36;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(mesh);
  group.visible = false;
  scene.add(group);
  return { group, mesh, count, t: 0, dispose: () => { geo.dispose(); mat.dispose(); mesh.dispose(); } };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function kfil(snap, dt, rate) { return snap ? 1 : 1 - Math.exp(-dt * rate); }   // frame-rate independent smoothing factor
function rand(a, b) { return a + Math.random() * (b - a); }
