// Regression check (node, no browser) for the Rush "feel" layer: the pure timing / reward helpers in src/runner/goals.js and the
// swipe-on-release fallback in src/input.js (a short quick flick must still fire; nothing may fire twice; taps stay taps).
// Usage: node scripts/check-feel.mjs
import { turnBuffered, turnGrade, turnReward, comboLevel, flowStateSecs, multStep, TURN_BUF, TURN_PERFECT_F0, TURN_LATE_F0, chainBonus } from '../src/runner/goals.js';

let fails = 0, n = 0;
const eq = (name, got, want) => { n++; if (got !== want) { fails++; console.log(`FAIL ${name}: got ${got}, want ${want}`); } };
const ok = (name, c) => eq(name, !!c, true);

// ---- turn timing ----
eq('grade early', turnGrade(0), 0);
eq('grade early edge', turnGrade(TURN_PERFECT_F0 - 0.001), 0);
eq('grade perfect lo', turnGrade(TURN_PERFECT_F0), 1);
eq('grade perfect hi', turnGrade(TURN_LATE_F0 - 0.001), 1);
eq('grade late', turnGrade(TURN_LATE_F0), 2);
eq('grade past the corner', turnGrade(1.07), 2);
const r0 = turnReward(0), r1 = turnReward(1), r2 = turnReward(2);
ok('perfect pays most', r1.pts > r2.pts && r2.pts > r0.pts);
ok('perfect flows most', r1.flow > r2.flow && r2.flow >= r0.flow);
eq('early keeps the old payout', r0.pts, 100);
eq('early keeps the old flow', r0.flow, 4);
ok('only perfect pauses', r1.stop > 0 && r0.stop === 0 && r2.stop === 0);
ok('streak raises perfect', turnReward(1, 3).pts > turnReward(1, 0).pts);
eq('streak is capped', turnReward(1, 99).pts, turnReward(1, 4).pts);
eq('negative streak is safe', turnReward(1, -5).pts, turnReward(1, 0).pts);

// ---- the turn buffer: ~120 ms before the window opens, never after, never far before ----
const sA = 500, vs = 30, back = vs * TURN_BUF;
ok('buffered just before', turnBuffered(sA - 1, sA, vs));
ok('buffered at the edge', turnBuffered(sA - back, sA, vs));
ok('not buffered too early', !turnBuffered(sA - back - 0.01, sA, vs));
ok('not buffered once open', !turnBuffered(sA, sA, vs));
ok('standing still still has a buffer', turnBuffered(sA - 0.05, sA, 0));

// ---- combo tiers match the HUD chip (5 / 10 / 20 / 50), flow state starts at tier 2 ----
const tiers = [[0, 0], [4, 0], [5, 1], [9, 1], [10, 2], [19, 2], [20, 3], [49, 3], [50, 4], [999, 4]];
for (const [c, L] of tiers) eq(`combo ${c}`, comboLevel(c), L);
eq('no flow state below tier 2', flowStateSecs(1), 0);
ok('flow state grows with the tier', flowStateSecs(2) > 0 && flowStateSecs(3) > flowStateSecs(2) && flowStateSecs(4) > flowStateSecs(3));

// ---- multiplier steps: announce each rise once, stay quiet on flicker, re-arm after a real fall ----
let top = multStep(2.0, -1);
eq('first look sets the step', top, 2);
let t2 = multStep(2.9, top); eq('same step stays', t2, 2);
t2 = multStep(3.0, top); ok('rise announces', t2 > top); top = t2;
let said = 0;
for (const m of [3.4, 2.6, 3.1, 2.9, 3.0, 3.4]) { const nt = multStep(m, top); if (nt > top) said++; top = nt; }
eq('flicker around a step is quiet', said, 0);
top = multStep(1.5, top); eq('a whole-step fall re-arms', top, 1);
ok('regrowth announces again', multStep(2.0, top) > top);
// a ceiling-sized climb announces every step exactly once
top = multStep(1, -1); let steps = 0;
for (let i = 10; i <= 100; i++) { const nt = multStep(i / 10, top); if (nt > top) steps++; top = nt; }
eq('climb 1 -> 10 says 9 steps', steps, 9);

// ---- near-miss chain tiers the tag colours follow ----
eq('chain 2 has no bonus yet', chainBonus(2), 0);
eq('chain 3 steps up', chainBonus(3), 1);
eq('chain 5 steps up', chainBonus(5), 2);
eq('chain 8 steps up', chainBonus(8), 3);

// ---- English: every new visible string has an entry (i18n is forced to EN through the saved language) ----
globalThis.localStorage = { getItem: (k) => (k === 'patpat_lang' ? 'en' : null), setItem() {}, removeItem() {} };
globalThis.document = { documentElement: {}, addEventListener() {} };
const { t } = await import('../src/i18n.js');
const EN = [
  ['KIL PAYI!', 'CLOSE CALL!'], ['KIL PAYI x3', 'CLOSE CALL x3'], ['DÖNÜŞ', 'TURN'], ['SON ANDA!', 'JUST IN TIME!'],
  ['MÜKEMMEL DÖNÜŞ!', 'PERFECT TURN!'], ['MÜKEMMEL DÖNÜŞ x2!', 'PERFECT TURN x2!'], ['ÜSTÜNDEN!', 'OVER IT!'], ['BOŞLUĞU GEÇTİN!', 'GAP CLEARED!'],
  ['PARÇALADIN', 'SHATTERED'], ['PARÇALADIN x2', 'SHATTERED x2'], ['KAR SERİSİ x5', 'SNOW STREAK x5'], ['ÇARPAN x4', 'MULTIPLIER x4'],
  ['AKIŞ HALİ!', 'FLOW STATE!'], ['AKIŞ HALİ UZADI!', 'FLOW STATE EXTENDED!'], ['+293 · ÇARPAN +0,5', '+293 · MULTIPLIER +0.5'],
  ['ÇARPAN +1 · 6 sn', 'MULTIPLIER +1 · 6 s'], ['HALKA x2!', 'RING x2!'],
  ['💥 ÇARPTIN · 1.234 m', '💥 CRASH · 1.234 m'], ['💣 PATLADIN (KAYA) · 432 m', '💣 BLOWN UP (BOULDER) · 432 m'],
];
for (const [tr, en] of EN) eq(`EN ${tr}`, t(tr), en);
// every obstacle name the death card can print gets translated (parsed from the KILL_NAME table in runner.js)
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/runner/runner.js', import.meta.url), 'utf8');
  const tbl = /const KILL_NAME = \{([\s\S]*?)\};/.exec(src);
  ok('KILL_NAME table found', !!tbl);
  const names = [...(tbl ? tbl[1] : '').matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
  ok('KILL_NAME has entries', names.length >= 15);
  for (const nm of new Set(names)) { const out = t(`💥 ÇARPTIN (${nm}) · 5 m`); ok(`death name ${nm} -> ${out}`, !out.includes(nm) && out.includes('CRASH')); }
}

// ---- input: swipe on release ----
const L = {};
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {} };
let T = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => T }, configurable: true, writable: true });
const el = { addEventListener: (t, f) => { (L[t] ||= []).push(f); }, setPointerCapture() {} };
const { Input } = await import(process.env.INPUT_MODULE || '../src/input.js');   // INPUT_MODULE: run the checks against another build (e.g. the pre-change file)
const inp = new Input(el);
const fire = (type, o) => { for (const f of L[type] || []) f({ type, pointerId: 1, clientX: 0, clientY: 0, ...o }); };
// one touch: down at (100,300), move to (100+dx, 300+dy) over `ms`, lift there
function swipe(dx, dy, ms, { end = 'pointerup', mid = null } = {}) {
  inp.clear(); inp.lastTapT = 0; T += 1000;
  fire('pointerdown', { clientX: 100, clientY: 300 });
  T += ms;
  fire('pointermove', { clientX: 100 + dx, clientY: 300 + dy });
  if (mid) mid();
  fire(end, { clientX: 100 + dx, clientY: 300 + dy });
  return { lane: inp.laneQueued, jump: inp.jumpQueued, dive: inp.diveQueued, dbl: inp.doubleTapQueued };
}
let s = swipe(40, 0, 80);   eq('live lane fires once, not again on release', s.lane, 1);
s = swipe(18, 2, 60);       eq('short flick right fires on release', s.lane, 1);
s = swipe(-18, 0, 60);      eq('short flick left fires on release', s.lane, -1);
s = swipe(0, -20, 60);      ok('short flick up jumps on release', s.jump && s.lane === 0);
s = swipe(0, 20, 60);       ok('short flick down ducks on release', s.dive && s.lane === 0);
s = swipe(5, 4, 60);        ok('a tap stays a tap', !s.lane && !s.jump && !s.dive);
s = swipe(18, 0, 400);      eq('a slow drag is not a flick', s.lane, 0);
s = swipe(17, 16, 60);      ok('an ambiguous diagonal does nothing', !s.lane && !s.jump && !s.dive);
s = swipe(18, 0, 60, { end: 'pointercancel' }); eq('a cancelled touch never fires', s.lane, 0);
s = swipe(10, 0, 40, { mid: () => inp.endGesture() });
fire('pointerup', {}); // (already lifted; a stray second up is ignored)
eq('endGesture() spends the touch', s.lane, 0);
// the game consumed a touch as a turn, then the finger lifts a little further: still spent
inp.clear(); T += 1000;
fire('pointerdown', { clientX: 100, clientY: 300 }); T += 30; fire('pointermove', { clientX: 108, clientY: 300 }); inp.endGesture(); T += 20; fire('pointerup', { clientX: 130, clientY: 300 });
eq('a spent touch does not fire on lift', inp.laneQueued, 0);
// two quick flicks in a row both land (the queue holds both)
inp.clear();
for (let i = 0; i < 2; i++) { T += 300; fire('pointerdown', { clientX: 100, clientY: 300 }); T += 50; fire('pointerup', { clientX: 120, clientY: 300 }); }
eq('two flicks queue two lanes', inp.laneQueued, 2);

console.log(`${n} checks: ${fails ? fails + ' failed' : 'ok'}`);
process.exit(fails ? 1 : 0);
