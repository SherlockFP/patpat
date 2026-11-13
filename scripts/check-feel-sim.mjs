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

globalThis.requestAnimationFrame = (f) => 0; globalThis.requestAnimationFrame = (f) => 0;
let fails = 0, n = 0;
const ok = (name, c) => { n++; if (!c) { fails++; console.log('FAIL ' + name); } };
const DT = 1 / 60;

function make({ seed = 1, level = null, runs = 9 } = {}) {
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
  localStorage.setItem('patpat.rushRuns', String(runs));      // 9 = a veteran: every system on; pass runs: 0 for a new player
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
  const h = make({ seed: 778 }), r = h.runner;
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
  ok('an untouched death ends by itself in ~0.75 s, no empty recap strip', r2.state === 'over' && k * DT < 0.95 && h2.log.ui.some((x) => x[0] === 'showRunnerResult'));
  const el = r2._tagEl; r2.dispose();
  ok('dispose removes the callout element', !el || (el.isConnected === false && r2._tagEl === null));
}

// ---------- state must not leak between runs: landmark gates, retry keeps the perk ----------
{
  const h = make({ seed: 3 }), r = h.runner; goLive(h);
  r.lmNext = 3000; r._nmAt = 500; r.ringChain = 4; r.slalom = { grp: 1, n: 2 };   // what a long previous run leaves behind
  r.start(4, null, {}); goLive(h);
  ok('the 500 m landmark gate is armed again on a new run', r.lmNext === 500);
  ok('near-miss / ring / slalom memory is cleared', r._nmAt === -9 && r.ringChain === 0 && r.slalom === null);
  let picks = 0; const ui = h.ctx.ui; ui.runnerPerkPick = (offer, cb) => { if (!offer) return; picks++; cb(offer[1].id); };
  r.start(5, null, {}); const first = r.perk;
  ok('a normal start offers the pick', picks === 1 && first && r.pickT === 0);
  r.start(6, null, { retry: true });
  ok('a quick retry keeps the perk and skips the 6 s pick', picks === 1 && r.perk === first && r.pickT === 0);
  r.start(7, null, {});
  ok('a start from the menu offers the pick again', picks === 2);
  ui.runnerPerkPick = null;
}

// ---------- opening: something to dodge within ~4 s, a boost strip in the first 20 s, no lost row ----------
{
  const h = make({ seed: 21 }), r = h.runner; goLive(h);
  const evs = []; const orig = r.handle.bind(r);
  r.handle = (e) => { evs.push({ t: r.time, type: e.type, kind: e.kind }); return orig(e); };
  let k = 0; while (r.time < 22 && k++ < 3000) step(h);
  const first = evs.find((e) => e.type === 'hit' || e.type === 'critter');
  ok('the first obstacle or critter comes within 4.5 s', first && first.t < 4.5);
  const boost = evs.find((e) => e.type === 'pad' && e.kind === 'boost');
  ok('the first BOOST strip (the speed rush) arrives inside the first 20 s', boost && boost.t < 20);
  ok('a pad jump and a duck bar are still taught in the first 22 s', evs.some((e) => e.type === 'pad' && e.kind === 'jump') && evs.some((e) => e.kind === 'overhead'));
}

// ---------- YETİ SOLUĞU: the Yeti sprints into view now and then without a stumble; TEMİZ KAT pays double ----------
{
  const h = make({ seed: 31 }), r = h.runner; goLive(h);
  let minGap = 99, k = 0, roars = 0; const roar = r.roar.bind(r); r.roar = (q) => { roars++; roar(q); };
  while (r.time < 40 && k++ < 4000) { step(h); if (r.time > 5) minGap = Math.min(minGap, r.gap); }
  ok('the Yeti closes in for a glimpse (gap < 9) with no stumble window', minGap < 9 && r.stumbleT === 0 && r.stumbles === 0);
  ok('the glimpse is announced by a roar', roars >= 1);
  ok('and it drops back again', r.gap > 9.5);
  const a = make({ seed: 32 }).runner, b = make({ seed: 32 }); const rb = b.runner;
  goLive({ runner: a }); goLive(b);
  a.b.s = 601; rb.b.s = 601; rb.crashes = 1;
  const c0 = a.coins, c1 = rb.coins;
  a.progression(DT); rb.progression(DT);
  ok('a clean layer pays double (50 vs 25 at 600 m)', a.coins - c0 === 50 && rb.coins - c1 === 25);
}

// ---------- generator: the new phrases exist, vertical rows keep >= 0.6 s apart (a jump or duck needs ~0.6 s) ----------
{
  const { speedAt } = await import('../src/runner/runner.js');
  const seen = new Set(); let pairs = 0, worst = 9, newRows = 0, blocked = 0, swapTight = 0, newFirst = 99999;
  for (let seed = 1; seed <= 24; seed++) {
    const r = make({ seed }).runner; r.track.ensure(4800);
    const rl = r.obstacles.rowsLog.slice().sort((a, b) => a.s - b.s);
    for (let i = 0; i < rl.length; i++) {
      if (rl[i].ph) seen.add(rl[i].ph);
      if (rl[i].ph >= 10) {      // the round-2 phrases: every row leaves a way through (a free lane, or a jump row), and a lane swap gets its time
        newRows++; newFirst = Math.min(newFirst, rl[i].s);
        if (!(rl[i].free & (1 << rl[i].route)) && !rl[i].jump) blocked++;
        if (i && rl[i - 1].ph === rl[i].ph && rl[i - 1].route !== rl[i].route && (rl[i].s - rl[i - 1].s) / (1.1 * speedAt(rl[i].s)) < 0.25 * Math.abs(rl[i].route - rl[i - 1].route)) swapTight++;
      }
      if (i && rl[i].vert && rl[i - 1].vert) { pairs++; worst = Math.min(worst, (rl[i].s - rl[i - 1].s) / speedAt(rl[i].s)); }
    }
  }
  ok('hopscotch / dodgeHop / duckWeave all show up across 16 seeds', seen.has(7) && seen.has(8) && seen.has(9));
  ok('the 4 round-2 phrases (duckTrain / hopSwitch / duckHurdle / zigStep) all show up (' + [10, 11, 12, 13].map((i) => seen.has(i) ? 'y' : 'n').join('') + ', ' + newRows + ' rows, first at ' + Math.round(newFirst) + ' m)', [10, 11, 12, 13].every((i) => seen.has(i)));
  ok('every round-2 row leaves a free lane or a jump, and swaps get their time (' + blocked + ' blocked, ' + swapTight + ' too tight)', newRows > 20 && blocked === 0 && swapTight === 0);
  ok('no two jump / duck rows closer than 0.6 s (' + pairs + ' pairs, worst ' + worst.toFixed(2) + ' s)', pairs > 20 && worst >= 0.6);
}

// ---------- HYPER-CASUAL FIRST MINUTE: new player = instant start, nothing to pick, nothing to read; depth unlocks by run count ----------
{
  let picks = 0;
  const h = make({ seed: 41, runs: 0 }), r = h.runner, ui = h.ctx.ui;
  ui.runnerPerkPick = (offer, cb) => { if (offer) picks++; };
  ok('run 1 is depth 0, no weekly mutator', r.depth === 0 && r.mut === null && !h.log.ui.some((x) => x[0] === 'runnerMutator' && x[1]));
  ok('play within 1 s of opening (' + r.countT.toFixed(2) + ' s count-in, no numbers)', r.countT <= 1 && !h.log.ui.some((x) => x[0] === 'banner'));
  let k = 0; while (r.countT > 0 && k++ < 200) step(h);
  ok('the world is live after ' + (k * DT).toFixed(2) + ' s', k * DT <= 1.0);
  const evs = [];
  const orig = r.grantBuff.bind(r), og = r.spawnGate.bind(r);
  r.grantBuff = (...a) => { evs.push('buff'); return orig(...a); }; r.spawnGate = (...a) => { evs.push('gate'); return og(...a); };
  k = 0; while (r.time < 65 && k++ < 5000) step(h);
  ok('no card gate and no auto card in the first 65 s of run 1', evs.length === 0 && !r.gate && r.buffs.size === 0);
  r.start(42, null, {}); ok('run 2 is depth 1: still no pick, no mutator', r.depth === 1 && r.mut === null && picks === 0 && r.pickT === 0);
  k = 0; while (r.time < 65 && k++ < 5000) step(h);
  ok('run 2: no gate either', evs.length === 0);
  r.start(43, null, {}); ok('run 3 is depth 2: the perk pick and every system are back', r.depth === 2 && picks === 1 && r.pickT > 0);
  ui.runnerPerkPick = null;
  r.start(44, null, { retry: true }); ok('a retry counts in 0.4 s, silent', Math.abs(r.countT - 0.4) < 1e-9 && r.countQuiet);
  const v = make({ seed: 45, runs: 0 }); v.ctx.save.runnerBestDist = () => 800; v.runner.start(46, null, {});
  ok('a save with a record counts as a veteran', v.runner.depth >= 2);
  // one hint at a time: a tip never shows over the first-run hint
  const t1 = make({ seed: 47, runs: 0 }); t1.ctx.noTut = false; t1.ctx.save.runnerTutDone = () => false; t1.runner.start(47, null, {}); goLive(t1);
  ok('first-run hint is up, tips wait', t1.runner.hintOn === true && t1.runner.tip('x1', 'TEST', false) === false);
}

// ---------- SCORE: numbers grow fast, skill clearly out-scores passive play ----------
{
  const run = (skilled) => {
    const rnd0 = Math.random; let q = 99991; Math.random = () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);   // same dice for both runs: only the player differs
    const h = make({ seed: 5 }), r = h.runner; goLive(h);
    const out = { s30: 0, s60: 0, d60: 0 }; let k = 0, nextNear = 3, nextOver = 5, nextPerfect = 12, jn = null;
    while (r.time < 60 && k++ < 6000 && r.state === 'play') {
      if (k % 8 === 0) r.obstacles.clearRange(r.b.s - 3, r.b.s + 130);       // an empty road: only the score formula is measured, no smash / snow / star windfalls
      if (r.jnJ && r.jnOpen && r.jnJ !== jn) { jn = r.jnJ; swipe(h, jn.dir * 40); }      // take the corners
      if (r.grounded && r.gapEdgeAhead(r.b.s, r.b.vs * 0.3)) swipe(h, 0, -45);          // and jump the gaps
      if (r.lane === 0 && r.track.pieceAt(r.b.s + 25)?.kind === 'split') swipe(h, 40);   // and leave a forked road's hollow middle
      if (skilled) {   // a decent player: a near miss every ~4 s, a hop over a hurdle every ~6 s, one on-beat pad every ~15 s
        if (r.time >= nextNear) { r.handle({ type: 'near', toughness: 3, side: 1, s: r.b.s, u: 0 }); nextNear += 4; }
        if (r.time >= nextOver) { r.handle({ type: 'over', toughness: 2, s: r.b.s, u: 0 }); nextOver += 6; }
        if (r.time >= nextPerfect) { r.handle({ type: 'pad', kind: 'jump', onBeat: true }); nextPerfect += 15; }
      }
      step(h);
      if (!out.s30 && r.time >= 30) out.s30 = r.score;
    }
    Math.random = rnd0;
    out.s60 = r.score; out.d60 = r.b.s; out.mult = r.mult; out.t = r.time; out.cause = r.cause; return out;
  };
  const p = run(false), s = run(true);
  ok('both score runs lived the full 60 s (' + p.t.toFixed(0) + ' / ' + s.t.toFixed(0) + ' s, ' + p.cause + '/' + s.cause + ' at ' + Math.round(p.d60) + ' m)', p.t >= 59.9 && s.t >= 59.9);
  const ratio = (s.s60 / s.d60) / (p.s60 / p.d60);
  console.log(`score sim: passive ${Math.round(p.s30)} @30 s / ${Math.round(p.s60)} @60 s (${Math.round(p.d60)} m); skilled ${Math.round(s.s30)} / ${Math.round(s.s60)} (${Math.round(s.d60)} m); skilled/passive per metre = ${ratio.toFixed(2)}x`);
  ok('a passive 30 s run already reads in the thousands (>= 1500)', p.s30 >= 1500);
  ok('a passive 60 s run reads in the several thousands (>= 4000)', p.s60 >= 4000);
  ok('skilled play out-scores passive 2x to 4x per metre', ratio >= 2 && ratio <= 4);
}

// ---------- YETİ KOŞUSU: a rewarded 4 s sprint: multiplier +2, near miss x2, clean = bonus, a crash cancels it ----------
{
  const h = make({ seed: 51 }), r = h.runner; goLive(h);
  const m0 = r.mult; r.pulseT = 4; r._pulseCr = r.crashes; r.flowSt = 0; r.furyT = 0;
  ok('sprint: multiplier +2', Math.abs(r.mult - (m0 + 2 * r.mutScore)) < 0.11);
  const s0 = r.score; r.handle({ type: 'near', toughness: 3, side: 1, s: r.b.s, u: 0 }); const nearIn = r.score - s0;
  r.pulseT = 0; const s1 = r.score; r.handle({ type: 'near', toughness: 3, side: 1, s: r.b.s, u: 0 }); const nearOut = r.score - s1;
  ok('sprint: a near miss pays about double (' + nearIn + ' vs ' + nearOut + ')', nearIn > nearOut * 1.6);
  const h2 = make({ seed: 52 }), q = h2.runner; goLive(h2);
  q.pulseT = 0.01; q._pulseCr = q.crashes; const a = q.score, want = Math.round(150 * q.mult); q.pulseEnd();
  ok('a clean sprint pays 150 x mult', q.score - a === want);
  q.pulseT = 3; q._pulseCr = q.crashes; q.openStumble();
  ok('a crash ends the multiplier at once', q.pulseT === 0);
  const h3 = make({ seed: 53 }), w = h3.runner; goLive(h3);
  w.pulseT = 3; w._pulseCr = w.crashes; w.crashes++; const b0 = w.score; w.pulseEnd();
  ok('a crashed sprint pays nothing', w.score === b0);
}

// ---------- the Yeti is alive: it runs harder at a sprint, swells at a roar, glows when close ----------
{
  const h = make({ seed: 61 }), r = h.runner; goLive(h);
  const y = r.yeti; y.group.visible = true; r.gap = 9;
  step(h, 30); const calm = y.heat;
  r.pulseT = 3; step(h, 60); const sprint = y.heat, spr = y.spr;
  r.pulseT = 0; r.roar(true); const roarK = y.roar; step(h, 2);
  ok('sprint: it runs harder and glows (' + spr.toFixed(2) + ', heat ' + calm.toFixed(2) + ' -> ' + sprint.toFixed(2) + ')', spr > 0.9 && sprint > calm + 0.3);
  ok('roar: the scale pulse is armed and decays', roarK > 0.5 && y.roar < roarK);
  ok('the emissive follows the heat', y.mat.emissive.r > 0.08);
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

// ---------- GOAL CHAIN (endless): run-start mission line, ONE strip goal, postcards, death-screen pick ----------
{
  const rows = () => [{ id: 'a', icon: '🎯', text: '3 yaratık ez', value: 1, goal: 3, done: false }, { id: 'b', icon: '🏃', text: '500 m koş', value: 100, goal: 500, done: false }];
  const lastGoal = (h) => { for (let i = h.log.ui.length - 1; i >= 0; i--) if (h.log.ui[i][0] === 'runnerGoal') return h.log.ui[i]; return null; };
  const h = make({ seed: 61 }), r = h.runner;
  const seenCards = new Set(), tracked = [];
  Object.assign(h.ctx.meta, { missions: rows, multiplier: () => 3, track: (e, d) => { if (e === 'biome_seen') { tracked.push(d.id); seenCards.add(d.id); } }, cardSeen: (id) => seenCards.has(id), cards: () => ({ n: seenCards.size, total: 14 }) });
  r.start(61, null, {});
  const hint = h.log.ui.filter((x) => x[0] === 'hint' && x[1] === true).pop();
  ok('run start: one mission line, the closest mission (33% beats 20%) and the next multiplier', !!hint && /(GÖREV|MISSION)/.test(hint[2]) && /(yaratık|creature)/.test(hint[2]) && /\(1\/3\)/.test(hint[2]) && /x4/.test(hint[2]) && r.hintOn === true);
  goLive(h); step(h, 150);
  ok('the start line goes away after 2 s', r.hintOn === false && h.log.ui.filter((x) => x[0] === 'hint').pop()[1] === false);
  const g = lastGoal(h);
  ok('strip shows the mission: mode rec, 2 left, text with n/N', !!g && g[1] === 'rec' && g[2] === 2 && /1\/3/.test(g[4] || ''));
  ok('snow postcard was counted silently at the start (no toast in the countdown)', tracked.includes('snow') && !h.log.ui.some((x) => x[0] === 'toastSoft' && /(KARTPOSTAL|POSTCARD)/.test(x[1])));
  // no open mission: the record takes the strip, and it speaks POINTS
  h.ctx.meta.missions = () => []; step(h, 40);
  r.passedScore = false; r.bestScore = Math.ceil(r.score * (1 + 40 / Math.max(60, r.b.s))) + 20;
  step(h, 3);
  const g2 = lastGoal(h);
  ok('record near: strip shows the gap in points', !!g2 && g2[1] === 'rec' && /(PTS TO RECORD|PUAN)/.test(g2[4] || '') && g2[2] % 10 === 0 && g2[2] >= 10);
  r.bestScore = 0; r.passedScore = true;
  // postcards: first time only, flash + one line with n/total; the count goes through meta.track('biome_seen')
  r.postcard({ id: 'volcano', name: 'Volkan' });
  const toast = h.log.ui.filter((x) => x[0] === 'toastSoft').pop();
  ok('postcard: tracked once', tracked.filter((x) => x === 'volcano').length === 1);
  ok('postcard: flash + one line with n/total', !!toast && /(POSTCARD: Volcano|KARTPOSTAL: Volkan) 2\/14/.test(toast[1]) && h.log.ui.some((x) => x[0] === 'flash' && x[1] === 'gold'));
  const nT = h.log.ui.filter((x) => x[0] === 'toastSoft').length;
  r.postcard({ id: 'volcano', name: 'Volkan' });
  ok('postcard: a seen biome is silent and not tracked again', h.log.ui.filter((x) => x[0] === 'toastSoft').length === nT && tracked.filter((x) => x === 'volcano').length === 1);
  const old = h.ctx.meta.cardSeen; delete h.ctx.meta.cardSeen; r.postcard({ id: 'moon', name: 'Ay Yüzeyi' }); h.ctx.meta.cardSeen = old;
  ok('a meta without cardSeen still gets biome_seen, stays quiet', tracked.includes('moon') && h.log.ui.filter((x) => x[0] === 'toastSoft').length === nT);
  // a natural biome change fires it (no direct call)
  const h3 = make({ seed: 62 }), t3 = [];
  Object.assign(h3.ctx.meta, { track: (e, d) => { if (e === 'biome_seen') t3.push(d.id); }, cardSeen: () => false, cards: () => ({ n: 1, total: 14 }) });
  h3.runner.start(62, null, {}); goLive(h3); step(h3, 90); h3.runner._pcId = 'zzz'; step(h3, 2);
  ok('entering a biome (id change) triggers the postcard', t3.length >= 1 && h3.log.ui.some((x) => x[0] === 'toastSoft' && /(POSTCARD|KARTPOSTAL)/.test(x[1])));
  // first two runs: silent (counted, no toast, no multiplier jargon) but the goal strip still shows the one mission
  const q = make({ seed: 63, runs: 0 }), tq = [];
  Object.assign(q.ctx.meta, { stats: () => ({ runs: 0 }), missions: rows, track: (e, d) => { if (e === 'biome_seen') tq.push(d.id); }, cardSeen: () => false, cards: () => ({ n: 1, total: 14 }) });
  q.runner.start(63, null, {}); goLive(q); q.runner.postcard({ id: 'volcano', name: 'Volkan' }); step(q, 150);
  ok('run 1: postcard counted but silent; mission line without the multiplier; the strip shows the mission',
    q.runner.quietRun && tq.includes('volcano') && !q.log.ui.some((x) => x[0] === 'toastSoft' && /(POSTCARD|KARTPOSTAL)/.test(x[1])) &&
    !q.log.ui.some((x) => x[0] === 'hint' && /(ÇARPAN|MULTIPLIER)/.test(x[2] || '')) && !!(lastGoal(q) && /1\/3/.test(lastGoal(q)[4] || '')));
  // death screen: the closest open mission (record far away) and how many are left for the set
  const missions3 = [{ id: 'a', text: '3 yaratık ez', value: 2, goal: 3, done: false }, { id: 'b', text: 'x', value: 5, goal: 5, done: true }, { id: 'c', text: 'y', value: 5, goal: 5, done: true }];
  const dead = (seed, ms) => {
    const d = make({ seed }); if (ms) d.ctx.meta.missions = () => ms;
    d.ctx.save.runnerBest = () => 100000; d.runner.start(seed, null, {}); goLive(d); step(d, 60); d.runner.die('wall');
    let kk = 0; while (d.runner.state !== 'over' && kk++ < 200) step(d, 1, false);
    return d.log.ui.filter((x) => x[0] === 'showRunnerResult').pop();
  };
  const res = dead(64, missions3), res2 = dead(65, null);
  ok('death screen names the closest mission and how many are left', !!res && res[1].nextGoalKind === 'mission' && /\(2\/3\)/.test(res[1].nextGoalText) && /· 1 (kaldı|to go)/.test(res[1].nextGoalText));
  // the death screen reads missionsReport (a set finished this run stays all-done: no new mission line); cig-only rows are never named
  const fin = make({ seed: 66 }); fin.ctx.meta.missionsReport = () => ({ rows: missions3.map((m) => ({ ...m, done: true })), setDone: true }); fin.ctx.save.runnerBest = () => 100000; fin.runner.start(66, null, {}); goLive(fin); step(fin, 60); fin.runner.die('wall');
  { let kk = 0; while (fin.runner.state !== 'over' && kk++ < 200) step(fin, 1, false); }
  const resF = fin.log.ui.filter((x) => x[0] === 'showRunnerResult').pop();
  ok('finished set: death screen takes missionsReport rows, no mission line', !!resF && resF[1].nextGoalKind === 'rec');
  ok('ÇIĞ-only mission is never the death-screen goal', (() => { const r3 = dead(67, [{ id: 'cigtons', text: 'x', modes: 'cig', value: 0, goal: 300, done: false }]); return !!r3 && r3[1].nextGoalKind !== 'mission'; })());
  ok('no open mission: the death screen keeps the record gap', !!res2 && res2[1].nextGoalKind === 'rec' && /(BEAT YOUR BEST|EN İYİYE)/.test(res2[1].nextGoalText));
}

// ---------- CAMPAIGN: live star pips, "az kaldı" on failure ----------
{
  const C = await import('../src/campaign.js');
  const lv = C.LEVELS.find((l) => l.goals[2].kind === 'nocrash');
  const h = make({ seed: 71, level: lv }), r = h.runner;
  goLive(h); step(h, 20);
  ok('live pips exist and start possible (finish / flakes / no-crash)', Array.isArray(r.starPips) && r.starPips[0] === 1 && r.starPips[2] === 1);
  r.crashes = 1; step(h, 20);
  ok('a crash loses the no-crash pip, and the HUD hears about it', r.starPips[2] === 0 && h.log.ui.some((x) => x[0] === 'runnerStars' && x[1][2] === 0));
  r.coins = 1e6; step(h, 20);
  ok('plenty of flakes light the star-2 pip', r.starPips[1] === 2);
  r.state = 'dying';
  const st = r.levelStats();
  ok('a failed level reports progress 0..1 and "az kaldı: %n"', st.progress >= 0 && st.progress <= 1 && /(az kaldı: %\d+|so close: \d+%)/.test(st.failText));
}

// ---------- RUSH CHAPTERS (PLAN_V3 §9) + permanent upgrade hooks (§8.2 / 8.3) ----------
{
  const G = await import('../src/runner/goals.js');
  const { ChapterPlan, CHAPTERS, CHAPTER_BY_ID, CHAPTER_FIXED, chapterReward, chapterLine, BONUS_EVERY } = G;
  const forced = (ids, len = 600) => {
    const p = new ChapterPlan(1, 0, () => 20); let s0 = 0;
    p.segs = ids.map((id, i) => { const def = CHAPTER_BY_ID[id], seg = { n: i + 1, id, def, s0, s1: s0 + len, bonus: !!def.bonus, i }; s0 += len; return seg; });
    return p;
  };
  const plan = (q) => { const o = []; for (let s = 0, k = 0; k < 40; k++) { const c = q.at(s); o.push(c); s = c.s1 + 0.5; } return o; };
  // -- the plan: first 6 fixed, a bonus after every 4th, 500-700 m, deterministic, unlocked by distance, every type shows up --
  {
    const p = new ChapterPlan(7, 0, () => 20), got = plan(p), reg = got.filter((c) => !c.bonus);
    ok('the first 6 chapters are fixed: Yamaç, Orman, Buz Tüneli, Ray, Çığ, Düello', CHAPTER_FIXED.every((id, i) => reg[i].id === id && reg[i].n === i + 1));
    ok('chapters 1-2 run 350 m, the rest 500-700 m, the plan is contiguous', reg.every((c, i) => (i < 2 ? c.s1 - c.s0 === 350 : c.s1 - c.s0 >= 500 && c.s1 - c.s0 <= 700)) && got.every((c, i) => !i || c.s0 === got[i - 1].s1));
    ok('ALTIN DAMAR (10 s) follows every 4th chapter and is not numbered', got.every((c, i) => (i > 0 && !got[i - 1].bonus && got[i - 1].n % BONUS_EVERY === 0) === c.bonus) && got.filter((c) => c.bonus).every((c) => c.s1 - c.s0 === 200));
    ok('same seed = same plan; at() reuses its segments', JSON.stringify(got.map((c) => [c.id, c.s0])) === JSON.stringify(plan(new ChapterPlan(7, 0, () => 20)).map((c) => [c.id, c.s0])) && p.at(100) === p.at(100));
    const seen = new Set(), early = [];
    for (let seed = 1; seed <= 80; seed++) for (const best of [0, 9000]) {
      const q = new ChapterPlan(seed, best, () => 20);
      for (let s = 0; s < 14000;) { const c = q.at(s); s = c.s1 + 0.5; if (c.n > 6 && !c.bonus) { seen.add(c.id); if (c.def.unlock > Math.max(best, c.s0)) early.push(c.id); if (c.n <= 8 && best === 9000) seen.add('vet:' + c.id); } }
    }
    ok('no type before its unlock distance (best distance, or the distance reached)', early.length === 0);
    ok('every seeded type appears across seeds after its unlock', CHAPTERS.filter((c) => !c.bonus && c.id !== 'yamac').every((c) => seen.has(c.id)));
    ok('a veteran (best 9000 m) meets late types right after the fixed six', [...seen].some((x) => /^vet:(ruzgar|yay|kaydirak|rampa|sis)$/.test(x)));
    ok('a clean chapter pays 2x', chapterReward(3, true).coins === 2 * chapterReward(3, false).coins && chapterReward(3, true).xp === 2 * chapterReward(3, false).xp);
    ok('chapter pay grows, then stops at chapter 8', chapterReward(2, false).coins < chapterReward(5, false).coins && chapterReward(8, false).coins === chapterReward(30, false).coins);
    ok('the strip is not swallowed by the BÖLÜM catch-all', chapterLine(3, 'BUZ TÜNELİ', (s) => s, false) === 'BÖLÜM 3 · BUZ TÜNELİ' && /^CHAPTER 3 · /.test(chapterLine(3, 'BUZ TÜNELİ', (s) => s, true)));
  }
  // -- every type is passable (a free lane or a jump on every row), builds its signature pieces, adds no pool --
  {
    const base = Object.keys(make({ seed: 1 }).runner.obstacles.pool).sort().join(',');
    for (const c of CHAPTERS) {
      let rows = 0, bad = 0, flakes = 0, samePool = true; const kinds = new Set();
      for (const seed of [1, 2, 3]) {
        const h = make({ seed }), r = h.runner; r.start(seed, null, { chapterPlan: forced([c.id, c.id, c.id], 700) }); r.track.ensure(1900);
        for (const row of r.obstacles.rowsLog) if (row.s > 330 && row.s < 2000) { rows++; if (row.free === 0 && !row.jump) bad++; }
        for (const p of r.track.pieces) kinds.add(p.kind);
        flakes += r.obstacles.picks.filter((q) => q.kind === 'flake').length;
        if (Object.keys(r.obstacles.pool).sort().join(',') !== base) samePool = false;
      }
      ok(c.id + ': every row leaves a free lane or a jump (' + rows + ' rows)', bad === 0 && (c.bonus ? rows <= 30 : rows > 15));
      ok(c.id + ': no new instanced pool (no new draw call)', samePool);
      if (c.set) ok(c.id + ': builds its set piece (' + c.set + ')', kinds.has(c.set));
      if (c.bonus) ok('damar: a coin rain (' + flakes + ' flakes)', flakes > 150);
    }
  }
  // -- a run through chapters: name strip, first-entry sentence, pay, clean x2, best chapter, HUD fields --
  {
    localStorage.removeItem('patpat.chapSeen');
    const h = make({ seed: 21 }), r = h.runner, T = [], saved = [], seenC = [];
    Object.assign(h.ctx.meta, { track: (e, d) => { T.push([e, d]); if (e === 'chapter_seen') seenC.push(d.id); } });
    h.ctx.save.setRunnerBestChapter = (n) => saved.push(n);
    r.start(21, null, { chapterPlan: forced(['yamac', 'orman', 'tunel', 'ray'], 250) });
    ok('the plan is the hand-made one', r.chapters && r.chapters.segs.length === 4 && r.track.chapterAt(10).id === 'yamac');
    goLive(h); const c0 = r.coins;
    let k = 0; while (r.b.s < 255 && k++ < 3000) step(h);
    ok('run start: a 1 s strip names chapter 1', h.log.ui.some((x) => (x[0] === 'banner' || x[0] === 'runnerChapter') && /^CHAPTER 1 · /.test(x[1])));
    ok('first entry: chapter_seen is reported once', seenC.filter((i) => i === 'yamac').length === 1);
    step(h, 80);
    ok('first entry: one sentence is shown', h.log.ui.some((x) => x[0] === 'toastSoft' && /slide|lane|jump/i.test(x[1])));
    ok('chapter 1 -> 2: the end pays 2x (no crash) and chapter_end is reported', r.chap.id === 'orman' && T.some((x) => x[0] === 'chapter_end' && x[1].n === 1 && x[1].clean === true && x[1].coins === chapterReward(1, true).coins) && r.coins - c0 >= chapterReward(1, true).coins);
    ok('the strip names chapter 2', h.log.ui.some((x) => (x[0] === 'banner' || x[0] === 'runnerChapter') && /^CHAPTER 2 · /.test(x[1])));
    r.crashes++;
    while (r.b.s < 505 && k++ < 6000) step(h);
    step(h, 60);
    const ends = T.filter((x) => x[0] === 'chapter_end');
    ok('a chapter with a crash pays only 1x', ends.length === 2 && ends[1][1].clean === false && ends[1][1].xp === chapterReward(2, false).xp && ends[1][1].coins === chapterReward(2, false).coins);
    ok('the toast shows coins and XP', h.log.ui.some((x) => x[0] === 'toastSoft' && /^CLEAN CHAPTER! x2 · \+60 ❄️ · \+32 XP$/.test(x[1])));
    r.die('wall'); { let kk = 0; while (r.state !== 'over' && kk++ < 300) step(h, 1, false); }
    const endp = T.filter((x) => x[0] === 'endless_end').pop();
    ok('run end carries the chapter fields (chapters, cleanChapters, chapterXp, bestChapter)', !!endp && endp[1].chapters === 2 && endp[1].cleanChapters === 1 && endp[1].chapterXp === chapterReward(1, true).xp + chapterReward(2, false).xp && endp[1].bestChapter === 3);
    ok('best chapter is tracked and handed to save.setRunnerBestChapter', r.bestChapter === 3 && saved.includes(3));
    const st = h.log.ui.filter((x) => x[0] === 'runnerStats').pop(), info = st && st[7];
    ok('runnerStats carries the HUD fields', !!info && info.chapter === 3 && info.chapterId === 'tunel' && info.chapterName === 'BUZ TÜNELİ' && info.chapterFrac >= 0 && info.chapterFrac <= 1 && info.chapterLeft >= 0 && info.bestChapter === 3 && typeof info.chapterBonus === 'boolean' && 'goalKind' in info);
    const h2 = make({ seed: 22 }), r2 = h2.runner; localStorage.removeItem('patpat.chapSeen');
    r2.start(22, null, { chapterPlan: forced(['cig', 'duello', 'damar'], 700) }); goLive(h2);
    r2.gap = 14; step(h2, 5);
    ok('ÇIĞ KAÇIŞI: the Yeti is pinned right behind you and the pace is +10%', r2.gap <= 6.5 + 1e-6 && Math.abs(r2.chapSpd - 1.1) < 1e-9);
  }
  // -- YETİ DÜELLOSU: the Yeti boss belongs to it; 3 boulder near-misses stun it --
  {
    const h = make({ seed: 23 }), r = h.runner; r.start(23, null, { chapterPlan: forced(['duello', 'yamac'], 700) }); goLive(h);
    let k = 0; while (!r.boss && k++ < 4000) step(h);
    ok('the duel chapter starts the Yeti boss (17 s)', !!r.boss && r.boss.dur === 17);
    const c0 = r.coins, s0 = r.score;
    for (let i = 0; i < 2; i++) r.handle({ type: 'near', toughness: 3, side: 1, s: r.b.s, u: 0, boulder: true });
    ok('two boulder near-misses: counted, not yet stunned', r.duelNear === 2 && r.boss && !r.boss.stun);
    r.handle({ type: 'near', toughness: 3, side: 1, s: r.b.s, u: 0, boulder: true });
    ok('the third stuns the Yeti: reward + it falls back', r.boss.stun === true && r.boss.ph === 'out' && r.coins - c0 >= 80 && r.score > s0);
    r.handle({ type: 'near', toughness: 3, side: 1, s: r.b.s, u: 0 });
    ok('an ordinary near-miss is not a duel point', r.duelNear === 3);
    k = 0; while (r.boss && k++ < 600) step(h);
    ok('the boss ends and nothing else schedules one (the old 2.5 km schedule is off)', !r.boss && r.nextBossS === Infinity);
  }
  // -- the chapter gate: a portal arch within 120 m of most chapter starts (a biome portal at the start counts); the pay does not depend on it --
  {
    let tot = 0, gated = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = make({ seed }).runner; r.track.ensure(9000);
      const gates = r.obstacles.obs.filter((o) => o.kind === 'portal').map((o) => o.s);
      for (const c of r.chapters.segs.filter((q) => q.s0 > 100 && q.s0 < 8600)) { tot++; if (gates.some((x) => x >= c.s0 - 1 && x < c.s0 + 120)) gated++; }
    }
    ok('chapter gates: ' + gated + ' of ' + tot + ' chapter starts have one within 120 m (>= 60%)', gated >= 0.6 * tot);
  }
  // -- upgrades: start size, melt resistance, magnet range, power durations; the score share is capped at 25% --
  {
    const lv = { topSize: 5, topMelt: 5, topMagnet: 5 };
    const fresh = make({ seed: 31 }), maxed = make({ seed: 31 });
    Object.assign(maxed.ctx.meta, { upgradeLevel: (id) => lv[id] || 0, duration: (kk) => ({ magnet: 20, x2: 24, superjump: 20, rocket: 9 })[kk] || 0, charLevel: () => 5 });
    maxed.ctx.save.perm = () => ({ speed: 5 });
    fresh.runner.start(31, null, {}); maxed.runner.start(31, null, {});
    const a = fresh.runner, b = maxed.runner;
    const dT = b.tier + b.grow - (a.tier + a.grow);      // (the weekly mutator may start higher: the start size is capped below the top tier)
    ok('fresh save: nothing changes (melt x1, no magnet range, no extra size)', a.meltK === 1 && a.magnetRadius() === 0 && a.upTier === 0 && a.upSize === 0);
    ok('maxed save: start size up to +0.75 tier (never past the top tier), melt x0.7', dT > 0.45 && dT <= 0.75 + 1e-9 && b.tier + b.grow < 4 && Math.abs(b.meltK - 0.7) < 1e-9);
    b.magnetT = 5; a.magnetT = 5;
    ok('magnet range +1.75 m while a magnet is on', Math.abs(b.magnetRadius() - a.magnetRadius() - 1.75) < 1e-9);
    a.magnetT = 0; b.magnetT = 0;
    goLive(fresh); goLive(maxed);
    let worst = 0;
    for (const flow of [0, 6, 20, 60]) for (const x2 of [false, true]) for (const near of [0, 5]) {
      for (const r of [a, b]) { r.flow = flow; r.nearChain = near; r.x2T = 0; r.x2Up = 0; if (x2) r.handle({ type: 'pickup', kind: 'x2', value: 1, s: r.b.s, u: 0, h: 1 }); }
      worst = Math.max(worst, b.mult / a.mult);
    }
    ok('maxed save: the multiplier is at most 1.25x a fresh save at equal play (worst ' + worst.toFixed(3) + ')', worst <= 1.25 + 1e-9 && worst > 1.1);
    for (const r of [a, b]) { r.x2T = 0; r.x2Up = 0; r.flow = 20; }
    let ma = 0, mb = 0, va = 0, vb = 0;      // the score a metre pays is vs * mult: compare the distance-weighted multiplier over 15 s of the same play (random pickups would only add noise)
    for (let i = 0; i < 900; i++) { step(fresh); step(maxed); ma += a.mult * a.b.vs; va += a.b.vs; mb += b.mult * b.b.vs; vb += b.b.vs; if (i % 100 === 50) { a.addFlow(2); b.addFlow(2); } }
    const ratio = (mb / vb) / (ma / va);
    ok('equal play: the score a metre pays is within 1.25x of a fresh save (' + ratio.toFixed(3) + ')', ratio <= 1.25 + 1e-6 && ratio >= 1);
    const sk = (id, level) => { const x = make({ seed: 33 }); x.ctx.save.selected = () => id; x.ctx.meta.charLevel = () => level; x.runner.start(33, null, {}); return x.runner; };
    ok('nazar: Yeti starts 3 m farther at level 1, 7 m at level 5', sk('nazar', 1).gapBonus === 3 && sk('nazar', 5).gapBonus === 7);
    ok('simit: a second forgiven crash from level 4', sk('simit', 1).simitMax === 1 && sk('simit', 4).simitMax === 2);
    ok('penguen: more followers with level', sk('penguen', 1).penN === 1 && sk('penguen', 5).penN === 3);
    { const x = sk('kofte', 5), y = sk('kofte', 1); x.handle({ type: 'pickup', kind: 'magnet', value: 1, s: 0, u: 0, h: 1 }); y.handle({ type: 'pickup', kind: 'magnet', value: 1, s: 0, u: 0, h: 1 }); ok('kofte: magnet lasts 1.7x at level 5, 1.3x at level 1', Math.abs(x.magnetT / y.magnetT - 1.7 / 1.3) < 1e-6); }
    { const x = make({ seed: 34 }); x.ctx.meta.charLevel = () => { throw new Error('x'); }; x.ctx.meta.upgradeLevel = () => { throw new Error('x'); }; ok('a broken meta never breaks the run', (() => { try { x.runner.start(34, null, {}); step(x, 5); return true; } catch (e) { return false; } })()); }
  }
}

console.log(`${n} checks: ${fails ? fails + ' failed' : 'ok'}`);
process.exit(fails ? 1 : 0);
