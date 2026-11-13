// Regression check (node, no browser) for the Rush "feel" layer: the pure timing / reward helpers in src/runner/goals.js and the
// swipe-on-release fallback in src/input.js (a short quick flick must still fire; nothing may fire twice; taps stay taps).
// Usage: node scripts/check-feel.mjs
import { ChapterPlan, CHAPTERS, chapterLine, chapterReward, capUpgradeMult, UP_SCORE_CAP, upStartSize, upMeltMul, upMagnet, charStep, BONUS_EVERY } from '../src/runner/goals.js';
import { turnBuffered, turnGrade, turnReward, comboLevel, flowStateSecs, multStep, TURN_BUF, TURN_PERFECT_F0, TURN_LATE_F0, chainBonus, checkpointReward, nextGoal, SCORE_STEPS, yetiFit, yetiSide, recordEqDist, pickMission, missionFrac, missionsLeft, nextMult, missionLine, postcardLine, deathGoalKind } from '../src/runner/goals.js';

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
  ['90 m · 468 puan', '90 m · 468 points'], ['1.250 m · 12.468 puan', '1.250 m · 12.468 points'], ['✔ 600 m · TEMİZ KAT! +50 ❄️', '✔ 600 m · CLEAN LAYER! +50 ❄️'],
  ['🐟 BALIK YEMİ!', '🐟 FISH BAIT!'], ['🐟 AFİYET OLSUN!', '🐟 BON APPETIT!'], ['KIZAK KIRILDI!', 'SLED BROKEN!'],
  ['KIL PAYI!', 'CLOSE CALL!'], ['KIL PAYI x3', 'CLOSE CALL x3'], ['DÖNÜŞ', 'TURN'], ['SON ANDA!', 'JUST IN TIME!'],
  ['MÜKEMMEL DÖNÜŞ!', 'PERFECT TURN!'], ['MÜKEMMEL DÖNÜŞ x2!', 'PERFECT TURN x2!'], ['ÜSTÜNDEN!', 'OVER IT!'], ['BOŞLUĞU GEÇTİN!', 'GAP CLEARED!'],
  ['PARÇALADIN', 'SHATTERED'], ['PARÇALADIN x2', 'SHATTERED x2'], ['KAR SERİSİ x5', 'SNOW STREAK x5'], ['ÇARPAN x4', 'MULTIPLIER x4'],
  ['AKIŞ HALİ!', 'FLOW STATE!'], ['AKIŞ HALİ UZADI!', 'FLOW STATE EXTENDED!'], ['+293 · ÇARPAN +0,5', '+293 · MULTIPLIER +0.5'],
  ['ÇARPAN +1 · 6 sn', 'MULTIPLIER +1 · 6 s'], ['HALKA x2!', 'RING x2!'],
  ['YETİ KOŞUSU!', 'YETI SPRINT!'], ['ÇARPAN +2', 'MULTIPLIER +2'], ['KOŞUYU ATLATTIN!', 'SPRINT SURVIVED!'],
  ['EN İYİYE 340 PUAN', 'BEAT YOUR BEST: 340 PTS'], ['EN İYİYE 1,250 PUAN', 'BEAT YOUR BEST: 1,250 PTS'], ['SIRADAKİ: 5.000 PUAN', 'NEXT GOAL: 5.000 PTS'],
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

// ---- goal chain: one goal at a time (closest open mission), the run-start line, postcards, the death-screen pick ----
{
  const rows = [{ text: '3 yaratık ez', value: 1, goal: 3, done: false }, { text: '500 m koş', value: 400, goal: 500, done: false }, { text: 'Bitti', value: 5, goal: 5, done: true }];
  eq('closest open mission wins (80% > 33%)', pickMission(rows).text, '500 m koş');
  eq('a done mission is never picked', pickMission([rows[2]]), null);
  eq('no rows -> no mission', pickMission(null), null);
  eq('a tie keeps the first', pickMission([{ text: 'a', value: 1, goal: 2 }, { text: 'b', value: 2, goal: 4 }]).text, 'a');
  eq('a 0-progress tie goes to the mission that moves early, not the first', pickMission([{ id: 'turn', text: 't', value: 0, goal: 3 }, { id: 'jump', text: 'j', value: 0, goal: 5 }]).id, 'jump');
  eq('a skipped (stuck) mission is rotated out', pickMission([{ id: 'turn', text: 't', value: 0, goal: 3 }, { id: 'jump', text: 'j', value: 0, goal: 5 }], 'jump').id, 'turn');
  eq('missions left in the set', missionsLeft(rows), 2);
  eq('mission fraction', missionFrac(rows[0]), 1 / 3);
  eq('set pays multiplier +1', nextMult(3), 4); eq('multiplier ceiling is 30', nextMult(30), 30); eq('bad multiplier is safe', nextMult(NaN), 2);
  eq('run-start line', missionLine(rows[0], 4), 'GÖREV: 3 yaratık ez (1/3) · ÇARPAN x4');
  eq('postcard line', postcardLine('Volkan', 5, 14), 'KARTPOSTAL: Volkan 5/14');
  const rec = { k: 'rec', val: 101 };
  eq('death goal: record in reach', deathGoalKind(rec, 900, 1000, rows[0]), 'rec');
  eq('death goal: record far, a mission is open', deathGoalKind(rec, 300, 1000, rows[0]), 'mission');
  eq('death goal: record far, no mission', deathGoalKind(rec, 300, 1000, null), 'rec');
  eq('death goal: record beaten, a mission is open', deathGoalKind({ k: 'next', val: 2500 }, 1200, 1000, rows[0]), 'mission');
  eq('death goal: record beaten, no mission', deathGoalKind({ k: 'next', val: 2500 }, 1200, 1000, null), 'next');
}
for (const [tr, en] of [
  ['GÖREV: 3 yaratık ez (1/3) · ÇARPAN x4', null], ["REKOR'A 1,250 PUAN", '1,250 PTS TO RECORD'], ['KARTPOSTAL: Volkan 5/14', null],
  ['SET İÇİN 1 GÖREV KALDI', '1 MISSION LEFT FOR THE SET'], ['SET İÇİN 2 GÖREV KALDI', '2 MISSIONS LEFT FOR THE SET'], ['az kaldı: %87', 'so close: 87%'],
  ['TOPLA', 'COLLECT'], ['DOKUNULMAZ', 'UNTOUCHABLE'], ['KAÇIŞ', 'ESCAPE'], ['PATRON', 'BOSS'], ['Bitişe ulaş!', 'Reach the finish!'],
]) if (en) eq(`EN ${tr}`, t(tr), en);
// the composed lines are built from translated parts: no Turkish word may survive in the English line
eq('EN mission line', missionLine({ text: 'Mission text', value: 1, goal: 3 }, 4, t), 'MISSION: Mission text (1/3) · MULTIPLIER x4');
eq('EN postcard line', postcardLine('Volkan', 5, 14, t), 'POSTCARD: Volcano 5/14');
{
  const { BIOMES } = await import('../src/runner/biomes.js').catch(() => ({}));
  if (BIOMES) for (const b of BIOMES) ok(`biome name ${b.name} has an English name`, t(b.name) !== b.name || /^[\x00-\x7f]+$/.test(b.name));
}

// ---- campaign: level types are explicit, deterministic, and every type is common enough to feel ----
{
  const C = await import('../src/campaign.js');
  const cnt = {};
  for (const lv of C.LEVELS) { cnt[lv.type] = (cnt[lv.type] || 0) + 1; ok(`L${lv.id} has a known type`, C.LEVEL_TYPES.includes(lv.type)); ok(`L${lv.id} has a one-sentence goal`, typeof lv.goal === 'string' && lv.goal.length > 3); }
  for (const ty of C.LEVEL_TYPES) ok(`type ${ty} has >= 8 levels (${cnt[ty] || 0})`, (cnt[ty] || 0) >= 8);
  eq('100 levels typed', Object.values(cnt).reduce((a, b) => a + b, 0), 100);
  ok('levels 1-3 teach: plain BİTİR', C.LEVELS.slice(0, 3).every((l) => l.type === 'BİTİR'));
  ok('every boss level is PATRON and only those', C.LEVELS.every((l) => (l.type === 'PATRON') === l.boss));
  ok('TOPLA = the star-2 goal counts flakes', C.LEVELS.every((l) => l.type !== 'TOPLA' || l.goals[1].kind === 'flakesN'));
  ok('KAÇIŞ = the Yeti star', C.LEVELS.every((l) => l.type !== 'KAÇIŞ' || (l.goals[2].kind === 'yeti' && !l.boss)));
  ok('DOKUNULMAZ = no-hit star', C.LEVELS.every((l) => l.type !== 'DOKUNULMAZ' || ['nocrash', 'noloss'].includes(l.goals[2].kind)));
  ok('bonus levels are typed and never PATRON', C.BONUS.every((l) => C.LEVEL_TYPES.includes(l.type) && l.type !== 'PATRON' && l.goal));
  eq('level types are deterministic', C.LEVELS.map((l) => l.type).join(), (await import('../src/campaign.js?again')).LEVELS.map((l) => l.type).join());
  // live pips: 1 possible / 2 met / 0 lost, and the settled pips equal evalGoals
  const nc = C.LEVELS.find((l) => l.goals[2].kind === 'nocrash'), fl = C.LEVELS.find((l) => l.goals[1].kind === 'flakes');
  eq('fresh run: all pips possible', C.starProgress(nc, {}).join(), '1,1,1');
  eq('a crash loses the no-crash pip', C.starProgress(nc, { crashes: 1 })[2], 0);
  eq('flakes target met lights pip 2', C.starProgress(fl, { flakesPct: 1 })[1], 2);
  eq('flakes short of the target stays possible', C.starProgress(fl, { flakesPct: 0.1 })[1], 1);
  const out = [9, 9, 9]; ok('fills the array it is given', C.starProgress(nc, {}, out) === out && out.join() === '1,1,1');
  for (const lv of C.LEVELS.filter((_, i) => i % 7 === 0)) for (const st of [{ finished: true }, { finished: true, crashes: 2, layersLost: 1, flakesPct: 1, flakes: 999, maxTier: 4, minYetiGap: 99, perfects: 99, powerups: 99 }]) {
    eq(`L${lv.id} settled pips == evalGoals`, C.starProgress(lv, st).map((v) => v === 2).join(), C.evalGoals(lv, st).join());
  }
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

// ---- checkpoint pay: a clean layer (no crash since the last checkpoint) pays double; the cap at layer 8 still holds ----
eq('checkpoint pay', checkpointReward(3, 25), 75);
eq('clean layer pays double', checkpointReward(3, 25, true), 150);
eq('checkpoint cap', checkpointReward(99, 25, true), 400);

// ---- death screen: below the record = points to beat it, at / above it = the next round score ----
eq('goal below the record', JSON.stringify(nextGoal(900, 1000)), JSON.stringify({ k: 'rec', val: 101 }));
eq('goal: a tie is not a new record', nextGoal(1000, 1000).k, 'rec');
eq('goal: the record is beaten by 1 point', nextGoal(1000 - 100 + 101, 1000).k, 'next');
eq('goal after a new best is the next round score', JSON.stringify(nextGoal(1200, 1000)), JSON.stringify({ k: 'next', val: 2500 }));
eq('goal on a first run (no record) is a round score', JSON.stringify(nextGoal(120, 0)), JSON.stringify({ k: 'next', val: 500 }));
eq('goal past every step keeps going', nextGoal(1500000, 0).val, 2000000);
ok('steps ascend', SCORE_STEPS.every((v, i) => !i || v > SCORE_STEPS[i - 1]));
for (const sc of [0, 1, 499, 500, 99999, 1e6]) for (const b of [0, 1, 500, 5e5]) { const g = nextGoal(sc, b); ok(`goal ${sc}/${b} is positive and finite`, Number.isFinite(g.val) && g.val > 0); }

// Yeti on screen: never more than ~20% of the view height (fit scales it down up close), slides aside when near the camera
{
  const H = 3.3, fov = 60;
  for (const d of [2, 4, 5, 8, 12, 30]) { const f = yetiFit(d, fov, H), px = (f * H) / (2 * d * Math.tan(fov * Math.PI / 360)); ok(`yeti at ${d} m: fit ${f.toFixed(2)} stays within 20% of the view unless it is at the floor`, px <= 0.2 + 1e-9 || f === 0.25); }
  ok('yeti far away is full size', yetiFit(40, fov, H) === 1);
  ok('yeti close is smaller than far', yetiFit(4, fov, H) < yetiFit(9, fov, H));
  eq('yeti slides fully aside at 4 m', yetiSide(4), 1); eq('yeti stays in lane at 10 m', yetiSide(10), 0);
  ok('yeti slide is monotonic', yetiSide(6) > yetiSide(8) && yetiSide(8) > 0);
}
// the record is the SCORE: points left -> metres at the run's own pace (0 = too early to say)
eq('record metres: too early', recordEqDist(30, 100, 5000), 0);
eq('record metres: half way there at 100 m / 1000 pts, best 2000', recordEqDist(100, 1000, 2000), 200);
ok('record metres: beaten record is behind you', recordEqDist(300, 3000, 2000) < 300);

// ---- chapters: pure helpers ----
ok('upgrade share is capped: 25% over the same play without upgrades', capUpgradeMult(5, 2) === 2.5 && capUpgradeMult(2.2, 2) === 2.2 && capUpgradeMult(9, 4) === 5 && UP_SCORE_CAP === 0.25);
ok('upgrade hooks: monotonic, clamped to levels 0..5', upStartSize(0) === 0 && upStartSize(5) === 0.75 && upStartSize(99) === 0.75 && upStartSize(-3) === 0 && upMeltMul(5) > 0.69 && upMeltMul(5) < 0.71 && upMeltMul(0) === 1 && upMagnet(5) === 1.75 && upMagnet(1) < upMagnet(2));
ok('character level 1..5 = passive step 0..4', charStep(1) === 0 && charStep(5) === 4 && charStep(0) === 0 && charStep(9) === 4 && charStep(undefined) === 0);
{
  const p = new ChapterPlan(3, 0, () => 20); let s = 0, last = -1, bonus = 0, ok2 = true;
  for (let i = 0; i < 30; i++) { const c = p.at(s); if (c.s0 !== s && i) ok2 = false; if (c.i !== last + 1) ok2 = false; last = c.i; if (c.bonus) bonus++; s = c.s1; }
  ok('plan: contiguous, indexed, a bonus every ' + BONUS_EVERY + ' chapters (' + bonus + ' in 30 segments)', ok2 && bonus >= 5 && p.at(-10).i === 0);
  ok('plan: random access backwards returns the same segment', p.at(5000) === p.at(5000) && p.at(10) === p.at(10) && p.at(5000).i > p.at(10).i);
}

// ---- chapters: every visible string has English, and the real t() is not fooled by the BÖLÜM / REKOR catch-alls ----
{
  const { t, getLang } = await import('../src/i18n.js');
  ok('i18n runs in English here (no navigator)', getLang() === 'en');
  const TR = /[ğüşıöçİĞÜŞÖÇ]/;
  const strings = [];
  for (const c of CHAPTERS) { strings.push(c.name, c.intro); }
  strings.push('TEMİZ BÖLÜM! x2', 'BÖLÜM TAMAM', 'HAVA BONUSU', 'YETİ SERSEMLEDİ!', 'KIL PAYI 1/3', 'KIL PAYI 2/3', "REKOR'A 1.250 PUAN", 'GÖREV:', 'ÇARPAN');
  for (const c of CHAPTERS) { strings.push(chapterLine(3, c.name, t, true)); strings.push(chapterReward(3, true).coins + ' ❄️'); }
  for (const str of strings) { const r = t(str); ok('English for: ' + str + ' -> ' + r, r !== str ? !TR.test(r) : /^[^\p{L}]*(CHAPTER \d+ · .+)?$/u.test(r) || /^[\d.,]+ ❄️$/.test(r)); }
  ok('the strip: BÖLÜM line in Turkish source is what the catch-all would break; ours stays CHAPTER n', chapterLine(3, 'BUZ TÜNELİ', t, true) === 'CHAPTER 3 · ICE TUNNEL' && t('BÖLÜM 3 · BUZ TÜNELİ').startsWith('LEVEL'));
  ok('reward line (clean, with XP)', t('TEMİZ BÖLÜM! x2') + ' · +60 ❄️ · +32 XP' === 'CLEAN CHAPTER! x2 · +60 ❄️ · +32 XP');
  ok("goal strip text is translated (REKOR'A n PUAN)", t("REKOR'A 1.250 PUAN") === '1.250 PTS TO RECORD' && t("REKOR'A 10 PUAN") === '10 PTS TO RECORD');
}

console.log(`${n} checks: ${fails ? fails + ' failed' : 'ok'}`);
process.exit(fails ? 1 : 0);
