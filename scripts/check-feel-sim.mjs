// Headless run of the REAL Runner (track, obstacles, ball, fx, input) in node with a fake DOM / UI / audio / save: no browser.
// Drives scripted play and asserts the Rush "feel" layer: junction turn timing tiers + the 120 ms swipe buffer, near-miss streak
// callouts, combo -> FLOW STATE, rope / countdown input buffers, gap clearance, stomp / smash feedback, the death card naming what
// hit you, tap-to-skip, revive, and a short fuzz run (random swipes, deaths, retries) that must not throw or produce NaN.
// Usage: node scripts/check-feel-sim.mjs        (a few seconds per scenario)
import * as THREE from 'three';

// ---------- fake DOM (just enough for runner.js) ----------
const noop2d = () => new Proxy(function () {}, { get: (t, k) => (k === 'width' || k === 'height' ? 256 : noop2d()), apply: () => noop2d(), set: () => true });
class FakeEl {
  constructor(tag) { this.tag = tag; this.style = { cssText: '' }; this.children = []; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; this.dataset = {}; this._text = ''; this.width = 256; this.height = 256; this.isConnected = true; this.alog = []; }
  set innerHTML(h) { this._html = h; this.children = (h.match(/<(div|small|b|i|span)/g) || []).map(() => new FakeEl('x')); }
  get innerHTML() { return this._html || ''; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  after() {} remove() { this.isConnected = false; } addEventListener() {} removeEventListener() {} setAttribute() {} getAttribute() { return null; }
  querySelector() { return new FakeEl('q'); } querySelectorAll() { return []; } getContext() { return noop2d(); } getAnimations() { return []; }
  animate() { const el = this; return { cancel() { el.alog.push('cancel'); }, play() { el.alog.push('play'); } }; }
  get offsetWidth() { return 1; }
}
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.document = { body: new FakeEl('body'), head: new FakeEl('head'), documentElement: new FakeEl('html'), createElement: (t) => new FakeEl(t), getElementById: () => null, addEventListener() {} };
globalThis.innerWidth = 390; globalThis.innerHeight = 844;
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
let NOW = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => NOW }, configurable: true, writable: true });

const { Runner } = await import('../src/runner/runner.js');
const { Ball } = await import('../src/ball.js');
const { Fx } = await import('../src/fx.js');
const { Input } = await import('../src/input.js');
const { buildPropLibrary } = await import('../src/props.js');
const { levelById } = await import('../src/campaign.js');

let fails = 0, n = 0;
const ok = (name, c) => { n++; if (!c) { fails++; console.log('FAIL ' + name); } };
const DT = 1 / 60;

function make({ seed = 1, level = null } = {}) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 390 / 844, 0.05, 2000);
  camera.userData = {};
  const lib = buildPropLibrary();
  const ball = new Ball(scene, lib, new THREE.MeshBasicMaterial());
  const fx = new Fx(scene, { groundY: () => -1e9, rampAt: () => 0 });
  const L = {}, el = { addEventListener: (t, f) => { (L[t] ||= []).push(f); }, setPointerCapture() {} };
  const input = new Input(el);
  const fire = (type, o) => { for (const f of L[type] || []) f({ type, pointerId: 1, clientX: 0, clientY: 0, ...o }); };
  const log = { ui: [], floats: [] };
  const ui = new Proxy({ runnerPerkPick: null, float: (text, x, y, cls) => log.floats.push([text, cls]), annBusy: () => false },
    { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? (...a) => { log.ui.push([k, ...a]); } : undefined) });
  const quiet = new Proxy({}, { get: () => () => {} });
  const save = new Proxy({ runnerTutDone: () => true, runnerBestDist: () => 0, runnerBest: () => 0, perm: () => ({}), runnerTurnHints: () => 9, selected: () => null, recordRunner: () => 0, recordDailyRunner: () => false, previewRunnerRank: () => 0, spend: () => true, coins: 0 },
    { get: (t, k) => (k in t ? t[k] : () => undefined) });
  const meta = { track() {}, stats: () => ({ runs: 9 }), multiplier: () => 1, crystals: 0, duration: () => 0, missions: () => [], reviveCost: () => 1, spendCrystals: () => true, letterHunt: () => ({}), sleds: () => 0 };
  const ctx = { scene, camera, lib, ball, fx, ui, audio: quiet, platform: { haptic() {} }, save, input, meta, menus: { confetti() {} }, noTut: true };
  const runner = new Runner(ctx);
  runner.start(seed, level, {});
  const tags = [], orig = runner.skillTag.bind(runner);
  runner.skillTag = (m, s, l, p) => { tags.push({ main: m, sub: s, lvl: l, prio: p }); return orig(m, s, l, p); };
  return { runner, ctx, fire, log, tags };
}
// one frame; `safe` = nothing can hurt or melt the ball (isolates the thing under test)
function step(h, k = 1, safe = true) { for (let i = 0; i < k; i++) { NOW += 1000 * DT; if (safe) { h.runner.invulnT = 1e9; h.runner.meltK = 0; } h.runner.update(DT); } }
function swipe(h, dx, dy = 0) { h.fire('pointerdown', { clientX: 200, clientY: 500 }); NOW += 15; h.fire('pointermove', { clientX: 200 + dx, clientY: 500 + dy }); h.fire('pointerup', { clientX: 200 + dx, clientY: 500 + dy }); }
const goLive = (h) => { while (h.runner.countT > 0) step(h); step(h, 5); };

// ---------- junction turn: timing tiers and the 120 ms buffer ----------
function junction(f, { secBefore = 0 } = {}) {
  const h = make({ seed: 777 }), r = h.runner;
  let k = 0;
  while (!(r.jnJ && r.jnJ.s - r.b.s < 70 && r.countT <= 0) && k++ < 6000) step(h);
  const J = r.jnJ;
  if (!J) return null;
  const target = () => (secBefore ? r.jnSA - r.b.vs * secBefore : r.jnSA + f * (J.s - r.jnSA));
  while (r.b.s < target() - r.b.vs * DT * 0.5 && k++ < 9000) step(h);
  const out = { h, r, J, open: r.jnOpen, lane0: r.lane, turns0: r.turns };
  swipe(h, J.dir * 40);
  out.frames = -1;
  for (let i = 0; i < 20; i++) { step(h); if (r.turns > out.turns0 && out.frames < 0) out.frames = i; }
  out.turned = r.turns - out.turns0;
  out.tag = h.tags.find((t) => /DÖNÜŞ|SON ANDA/.test(t.main));
  return out;
}
{
  const e = junction(0.15), p = junction(0.7), l = junction(0.97), b = junction(0, { secBefore: 0.08 }), x = junction(0, { secBefore: 0.3 });
  ok('a junction exists on the test seed', !!(e && p && l && b && x));
  if (e && p && l && b && x) {
    ok('early swipe: turns this frame, plain callout', e.turned === 1 && e.frames === 0 && e.tag.main === 'DÖNÜŞ' && e.r.lane === e.lane0);
    ok('perfect swipe: PERFECT callout, prio 9, hit-pause, fov punch', p.turned === 1 && p.tag.main === 'MÜKEMMEL DÖNÜŞ!' && p.tag.prio === 9 && p.r.fovP > 0);
    ok('late swipe: SON ANDA', l.turned === 1 && l.tag.main === 'SON ANDA!');
    ok('perfect pays more than late, late more than early', parseInt(p.tag.sub, 10) > parseInt(l.tag.sub, 10) && parseInt(l.tag.sub, 10) > parseInt(e.tag.sub, 10));
    ok('a swipe 80 ms before the window is held, then turns (no stray lane change)', !b.open && b.turned === 1 && b.frames >= 3 && b.frames <= 8 && b.r.lane === b.lane0);
    ok('a swipe 300 ms early is still a normal lane change', !x.open && x.turned === 0 && x.r.lane === x.lane0 + 1);
  }
}

// ---------- near-miss streak: shown every time, steps announce the multiplier ----------
{
  const h = make({ seed: 5 }), r = h.runner; goLive(h);
  const m0 = r.mult;
  for (let i = 1; i <= 8; i++) { r.handle({ type: 'near', toughness: 3, side: 1, s: r.b.s, u: 0 }); step(h, 40); }
  const near = h.tags.filter((t) => /KIL PAYI/.test(t.main));
  ok('every near miss gets a callout', near.length === 8);
  ok('callouts carry the streak', near[7].main === 'KIL PAYI x8' && near[0].main === 'KIL PAYI!');
  ok('chain steps 3 / 5 / 8 announce the +0.5 multiplier', near.filter((t) => /ÇARPAN \+0,5/.test(t.sub)).length === 3);
  ok('callout heat grows with the chain', near[7].lvl > near[0].lvl);
  ok('multiplier grew', r.mult > m0);
}

// ---------- combo -> FLOW STATE ----------
{
  const h = make({ seed: 6 }), r = h.runner; goLive(h);
  for (let i = 1; i <= 12; i++) { r.addFlow(1); step(h, 48); }
  ok('combo reached 10', r.cmbN >= 10);
  ok('FLOW STATE started', r.flowSt > 0 && h.tags.some((t) => t.main === 'AKIŞ HALİ!' && t.prio === 9));
  const w = r.mult, fl = r.flowSt; r.flowSt = 0; const wo = r.mult; r.flowSt = fl;
  ok('worth +1 on the multiplier', Math.abs((w - wo) - r.mutScore) < 0.06);
  r.furyT = 3; const both = r.mult; r.flowSt = 0; const fury = r.mult; r.flowSt = fl; r.furyT = 0;
  ok('never stacks with ÖFKE', Math.abs(both - fury) < 1e-9);
  step(h, 90); const fovIn = h.ctx.camera.userData.fovBoost;
  r.cmbT = 0.01; step(h, 3);
  ok('a combo timeout rides the flow state out', r.cmbN === 0 && r.flowSt > 0);
  r.flow = 0; r.breakCombo();
  ok('a hit ends it', r.flowSt === 0);
  step(h, 120);
  ok('the view eases back', h.ctx.camera.userData.fovBoost < fovIn - 1);
  r.flowStateStart(2); let k = 0; while (r.flowSt > 0 && k++ < 1000) step(h);
  ok('and it expires by itself after ~6 s', k * DT > 5.5 && k * DT < 6.6 && r.flowSt === 0);
}

// ---------- input buffers ----------
{
  const h = make({ seed: 10 }), r = h.runner; goLive(h);
  r.zip = { s1: r.b.s + r.b.vs * 0.06, h: 3 };
  swipe(h, 40); step(h, 1);
  ok('lane swipe on the rope is held', r.lane === 0 && r.laneBufT > 0);
  step(h, 8);
  ok('and fires when the rope lets go', r.zip === null && r.lane === 1);
  const h2 = make({ seed: 10 }), r2 = h2.runner; goLive(h2);
  r2.zip = { s1: r2.b.s + 200, h: 3 }; swipe(h2, 40); step(h2, 30); r2.zip = null; step(h2, 5);
  ok('a long-gone rope swipe never fires later', r2.lane === 0);
  const h3 = make({ seed: 11 }), r3 = h3.runner;
  while (r3.countT > 0.1) step(h3);
  swipe(h3, 0, -45); step(h3, 15);
  ok('a jump in the last 120 ms of the countdown fires at go', r3.jumps >= 1);
  const h4 = make({ seed: 11 }), r4 = h4.runner;
  step(h4, 20); swipe(h4, 0, -45); step(h4, 130);
  ok('an earlier countdown jump is still dropped', r4.jumps === 0);
  const h5 = make({ seed: 12 }), r5 = h5.runner; goLive(h5);
  swipe(h5, 18, 1); step(h5, 2);
  ok('a short flick (swipe on release) changes lane', r5.lane === 1);
}

// ---------- gap, stomp, smash, over ----------
{
  const h = make({ seed: 9 }), r = h.runner; goLive(h);
  const s0 = r.score;
  r.grounded = false; r.holeAir = true; r.b.vh = -6; r.b.h += 0.3; step(h, 30);
  ok('clearing a real hole is called out and paid', h.tags.some((t) => t.main === 'BOŞLUĞU GEÇTİN!') && r.score > s0);
  h.tags.length = 0; r.grounded = false; r.holeAir = false; r.b.vh = -6; step(h, 30);
  ok('a plain landing is not', !h.tags.some((t) => /BOŞLUĞU/.test(t.main)));
  r.handle({ type: 'critter', stomp: true, id: 1, kind: 'x' }); r.handle({ type: 'critter', stomp: true, id: 2, kind: 'x' });
  ok('a stomp chain punches the view and pauses the world', r.fovP >= 3 && r.hitStop > 0);
  r.tier = 4; r.syncRadius(); step(h, 20);
  r.handle({ type: 'hit', toughness: 2, kind: 'crate', id: -5, headOn: true, s: r.b.s, u: r.b.u, color: 0x886644 });
  ok('smashing shows what it paid', h.tags.some((t) => /^PARÇALADIN/.test(t.main) && /^\+\d+$/.test(t.sub)));
  step(h, 40); r.handle({ type: 'over', toughness: 2, s: r.b.s, u: 0 });
  ok('jumping over something is called out', h.tags.some((t) => t.main === 'ÜSTÜNDEN!'));
}

// ---------- death: what hit you, tap to skip, revive ----------
{
  const h = make({ seed: 7 }), r = h.runner; goLive(h);
  r.tier = 0; r.grow = 0.2; r.syncRadius(); r.invulnT = 0; r.stumbleT = 0;
  r.crash({ kind: 'rock', id: -1, toughness: 5, headOn: true, s: r.b.s, u: r.b.u, color: 0x888888 });
  ok('the burst names the obstacle', r.state === 'dying' && r.cause === 'explode' && r.killKind === 'rock' && /\(KAYA\)/.test(h.log.floats.at(-1)[0]));
  ok('the announcement lanes were cleared for the death card', h.log.ui.some((x) => x[0] === '_annReset'));
  h.fire('pointerdown', { clientX: 100, clientY: 500 }); h.fire('pointerup', { clientX: 100, clientY: 500 });
  for (let i = 0; i < 40; i++) { NOW += 1000 * DT; r.update(DT); }
  ok('frantic swipes at the crash do not skip the read-out', r.state === 'dying');
  NOW += 100; h.fire('pointerdown', { clientX: 100, clientY: 500 }); h.fire('pointerup', { clientX: 100, clientY: 500 });
  r.update(DT);
  ok('a later tap goes straight to the result', r.state === 'over' && h.log.ui.some((x) => x[0] === 'showRunnerResult' && x[1].killKind === 'rock'));
  r.flowSt = 5; r.turnBufT = 1; r.pTurns = 3; r.fovP = 4; r.laneBufT = 1; r.recorded = false; r.revived = false;
  ok('revive works and clears the feel state', r.revive() === true && r.flowSt === 0 && r.turnBufT === 0 && r.pTurns === 0 && r.fovP === 0 && r.laneBufT === 0);
  const h2 = make({ seed: 8 }), r2 = h2.runner; goLive(h2);
  r2.tier = 0; r2.grow = 0.1; r2.syncRadius(); r2.invulnT = 0;
  r2.crash({ kind: 'pine', id: -1, toughness: 4, headOn: true, s: r2.b.s, u: r2.b.u, color: 0x2f7d4a });
  let k = 0; while (r2.state === 'dying' && k++ < 400) { NOW += 1000 * DT; r2.update(DT); }
  ok('an untouched death ends by itself in ~1.15 s, no empty recap strip', r2.state === 'over' && k * DT < 1.3 && h2.log.ui.some((x) => x[0] === 'showRunnerResult'));
  const el = r2._tagEl; r2.dispose();
  ok('dispose removes the callout element', !el || (el.isConnected === false && r2._tagEl === null));
}

// ---------- fuzz: random play, real hits, deaths and retries (endless + campaign) must not throw / go NaN ----------
{
  let rs = 12345; const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  const runs = [['endless 1', 1, null, 3000], ['endless 2', 2, null, 3000], ['campaign 1', 11, levelById(1), 2400], ['campaign 20', 12, levelById(20), 2400]];
  for (const [label, seed, level, frames] of runs) {
    const h = make({ seed, level }), r = h.runner;
    let thrown = null, bad = 0, deaths = 0;
    for (let f = 0; f < frames && !thrown; f++) {
      NOW += 1000 * DT;
      const J = r.jnJ;
      if (rnd() < 0.05) swipe(h, rnd() < 0.5 ? -40 : 40);
      if (rnd() < 0.03) swipe(h, 0, -50);
      if (rnd() < 0.015) swipe(h, 0, 50);
      if (rnd() < 0.01) swipe(h, rnd() < 0.5 ? -19 : 19, 1);
      if (J && r.state === 'play' && r.jnOpen && rnd() < 0.08) swipe(h, J.dir * 40);
      try { r.update(DT); } catch (e) { thrown = e; }
      const cam = h.ctx.camera;
      if (!Number.isFinite(cam.userData.fovBoost) || !Number.isFinite(cam.position.x) || !Number.isFinite(r.b.s) || !Number.isFinite(r.score)) bad++;
      if (r.state === 'over') { deaths++; if (level) r.start(undefined, level, { retry: true }); else r.start(seed + deaths, null, { retry: true }); }
    }
    ok(`fuzz ${label}: no exception${thrown ? ' (' + thrown.message + ')' : ''}`, !thrown);
    ok(`fuzz ${label}: no NaN`, bad === 0);
  }
}

console.log(`${n} checks: ${fails ? fails + ' failed' : 'ok'}`);
process.exit(fails ? 1 : 0);
