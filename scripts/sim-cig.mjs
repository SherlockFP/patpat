// Headless ÇIĞ DAĞLAR run (no browser): the REAL World + CigPlus + CigGame + bot on a fake DOM, one mountain at a time.
// Used by check-levels.mjs (par-time attainability of the ŞİMŞEK mountains, BOWLİNG fairness) and runnable by hand:
//   node scripts/sim-cig.mjs 19 23 29 37        (one line per mountain: result, time, par, gates, hits)
import * as THREE from 'three';

const noop2d = () => new Proxy(function () {}, { get: (t, k) => (k === 'width' || k === 'height' ? 256 : noop2d()), apply: () => noop2d(), set: () => true });
class FakeEl {
  constructor(tag) { this.tag = tag; this.style = { cssText: '' }; this.children = []; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; this.dataset = {}; this.width = 256; this.height = 256; }
  appendChild(c) { this.children.push(c); return c; } addEventListener() {} removeEventListener() {} setAttribute() {} remove() {}
  getContext() { return noop2d(); } getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
}
let simNow = 1000;
if (!globalThis.document) {
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.document = { body: new FakeEl('body'), head: new FakeEl('head'), documentElement: new FakeEl('html'), createElement: (t) => new FakeEl(t), getElementById: () => null, addEventListener() {} };
  globalThis.innerWidth = 390; globalThis.innerHeight = 844;
  globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  Object.defineProperty(globalThis, 'performance', { value: { now: () => simNow }, configurable: true, writable: true });
}
const { CFG } = await import('../src/config.js');
const { buildPropLibrary } = await import('../src/props.js');
const { World } = await import('../src/world.js');
const { Ball } = await import('../src/ball.js');
const { CigPlus, CigGame } = await import('../src/cigplus.js');
const { dagPlan } = await import('../src/cigplan.js');

const lib = buildPropLibrary();
const noUi = new Proxy({}, { get: () => () => {} });

// plays one mountain with the greedy bot; opts: { noise, latency, maxT, daily: {seed, dailyNo} }. Nothing is saved.
export function simMountain(n, opts = {}) {
  const plan = opts.plan || dagPlan(n, opts.daily ? { daily: true, ...opts.daily } : {});
  const scene = new THREE.Scene();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const ball = new Ball(scene, lib, mat);
  const world = new World(scene, lib, { seed: plan.seed, level: plan });
  const plus = new CigPlus(scene, world, { seed: plan.seed, lib, ui: noUi, hud: false, level: plan });
  const G = { mode: 'cig', state: 'menu', paused: false, level: 1, daily: false, hinted: true, lv: plan, runNo: 1, comboCoins: 0, cmTier: 0, tier: 0, peakR: CFG.startR, fovKick: 0, peakD: 0 };
  let firstHud = null;   // the very first level-HUD payload (stage counter / next gate size)
  let rolled = 0;   // balls rolled onto the slope (cannons + BOWLİNG)
  const spawnRoller = world.spawnRoller.bind(world);
  world.spawnRoller = (...a) => { rolled++; return spawnRoller(...a); };
  const host = new Proxy({
    labelBudget: () => 0,
    hitStop(s) { if (G.hitStopCd <= 0) { G.hitStop = Math.max(G.hitStop, s); G.hitStopCd = 0.15; } },
    shake(v) { G.shake += v; },
    tier(name, i) { G.tier = i; },
    hud(info) { if (!firstHud && info.lv) firstHud = { gateI: info.lv.gateI, S: info.lv.S, need: info.lv.need, gatesInWorld: world.gates.length }; },
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const game = new CigGame({ world, ball, plus, G, host, level: plan });
  game.auto = true;
  game.bot.mode = opts.mode || 'greedy'; game.bot.noise = opts.noise ?? 0; game.bot.latency = opts.latency ?? 0.1;
  game.reset();
  G.state = 'play'; G.paused = false; G.comboCoins = 0; G.cmTier = 0;
  plus.planTo(Math.min(world.genD, world.planEnd || Infinity) - 30);
  const dt = 1 / 60, maxT = opts.maxT || Math.max(120, plan.par * 3);
  let minGap = 1e9;
  for (let k = 0; k < Math.round(maxT / dt) && G.state === 'play'; k++) {
    simNow += 1000 * dt;
    let gdt = dt * G.timeScale;
    if (G.timeScale < 1) G.timeScale = Math.min(1, G.timeScale + dt * 0.5);
    G.hitStopCd -= dt;
    if (G.hitStop > 0) { G.hitStop -= dt; gdt *= 0.05; }
    game.update(gdt, 0);
    if (ball.d > G.peakD) G.peakD = ball.d;
    plus.update(gdt, ball, G);
    plus.planTo(Math.min(world.genD, world.planEnd || Infinity) - 30);
    ball.tick(dt);
    ball.sync();
    world.update(gdt, ball.d, CFG.viewAhead, CFG.viewBehind + 15, ball);
    if (game.wave.on) minGap = Math.min(minGap, ball.d - game.wave.d);
  }
  const end = G.state === 'play' ? 'timeout' : G.cause;
  const out = { n: plan.n, end, win: G.cause === 'win' || !!G.win, t: +game.stats.time.toFixed(1), par: plan.par, d: Math.round(ball.d), length: plan.length, hits: game.stats.hits, bounces: game.stats.bounces, gates: game.stats.gatesBroken, firstHud, rolled, eaten: game.stats.rolls, need: plan.stars[2].kind === 'rolls' ? plan.stars[2].count : 0, minGap: +minGap.toFixed(0), r: +ball.r.toFixed(2) };
  game.dispose?.(); plus.dispose(); world.dispose();
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('sim-cig.mjs')) {
  const ns = process.argv.slice(2).map(Number).filter(Boolean);
  for (const n of ns.length ? ns : [19]) {
    const t0 = Date.now();
    console.log(JSON.stringify(simMountain(n, {})), (Date.now() - t0) + 'ms');
  }
}
