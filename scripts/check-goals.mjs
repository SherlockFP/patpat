// Node check (no browser): the Rush goal layer (ladder, medals, personal bests, nearest goal, record chase, weekly rivals, streak, one settle pass against a fake save).
// Usage: node scripts/check-goals.mjs
import assert from 'node:assert/strict';
import { TIER_AT, MAX_TIER, tierOf, tierInfo, leagueIdx, promotion, stepReward, medalFor, MEDALS, MEDAL_FIXED, comparePb, pbBeats, pbPay, pickNearest, streakStep,
  recPayout, REC_POP, recPops, dcTargets, dcStep, dcView, DC_COIN, beatHz, recMetres, RECORD_NEAR, toNextTier, LEAGUES } from '../src/runner/ladder.js';
import { rivalScores, rivalName, placeOf, nextAbove, settle, placePrize, weekKey, anchor } from '../src/runner/rivals.js';
import { rollWeek, settleRun } from '../src/runner/progress.js';
import { recordEqDist, isScoreRecord } from '../src/runner/goals.js';
import { weekInfo } from '../src/runner/runner.js';

let n = 0;
const ok = (name, c) => { n++; assert.ok(c, name); };

// ---- ladder: monotonic, every league reachable, boundaries ----
ok('tiers ascend', TIER_AT.every((v, i) => i === 0 || v > TIER_AT[i - 1]));
ok('every league reachable (3 steps each)', LEAGUES.every((_, li) => tierOf(TIER_AT[li * 3 + 2]) === li * 3 + 3 && leagueIdx(li * 3 + 3) === li));
let prev = 0; for (let s = 0; s <= 300000; s += 50) { const t = tierOf(s); assert.ok(t >= prev); prev = t; }
n++;
assert.equal(tierOf(399), 0); assert.equal(tierOf(400), 1); assert.equal(tierOf(1000), 3); assert.equal(tierOf(1500), 4); assert.equal(tierOf(250000), 18); assert.equal(tierOf(1e9), 18);
assert.equal(tierInfo(1).label, 'Kar Tanesi I'); assert.equal(tierInfo(8).label, 'Buz II'); assert.equal(tierInfo(18).label, 'Efsane III'); n += 4;
ok('step marks line up with round scores', [5000 > 4500, TIER_AT.includes(25000), TIER_AT.includes(50000), TIER_AT.includes(100000), TIER_AT.includes(250000)].every(Boolean));
const pr = promotion(tierOf(3199), 4500);
ok('3199 -> 4500 promotes into Buz I (tier 7) paying steps 6..7 + the league entry', pr.from === 5 && pr.to === 7 && pr.leagueUp && pr.coins === stepReward(6) + stepReward(7) + 120);
ok('a run 1 under a threshold does not promote', promotion(tierOf(1499), 1499).to === 3 && promotion(3, 1499).coins === 0);
ok('promotion pays only tiers above the stored peak', promotion(7, 4500).coins === 0 && promotion(7, 4500).to === 7);
ok('step reward grows with the tier (tier^2 / 2), capped at 150', stepReward(1) === 1 && stepReward(15) === 113 && stepReward(18) === 150 && Math.max(...TIER_AT.map((_, i) => stepReward(i + 1))) <= 150);
const full = promotion(0, 1e9);
ok('whole ladder pays a bounded sum (economy)', full.to === 18 && full.coins > 1500 && full.coins < 4000 && promotion(0, 3200).coins < 120);
ok('toNextTier', toNextTier(3199) === 1 && toNextTier(1e9) === 0 && toNextTier(0) === 400);

// ---- medals ----
ok('medal thresholds ordered', MEDAL_FIXED.every((v, i) => i === 0 || v > MEDAL_FIXED[i - 1]) && MEDALS[1].coins < MEDALS[2].coins && MEDALS[3].coins < MEDALS[4].coins);
const mf = (a, b, c) => medalFor(a, b, c);
ok('medalFor relative', mf(5000, 10000) === 1 && mf(8000, 10000) === 2 && mf(10000, 10000) === 3 && mf(12500, 10000) === 4 && mf(4999, 10000) === 0);
ok('medalFor fixed scale for new players, none under 50 m', mf(700, 0) === 1 && mf(1600, 0) === 2 && mf(4500, 0) === 3 && mf(12000, 0) === 4 && mf(9999, 9999, 50) === 3 && mf(9999, 9999, 49) === 0);

// ---- personal bests ----
ok('pb baseline is silent, improvement needs +max(1,5%)', comparePb({}, { hop: 8 }).improved.length === 0 && comparePb({}, { hop: 8 }).next.hop === 8);
ok('pb: 10 -> 14 improves, 10 -> 10 does not', comparePb({ hop: 10 }, { hop: 14 }).improved[0].k === 'hop' && comparePb({ hop: 10 }, { hop: 10 }).improved.length === 0 && comparePb({ hop: 10 }, { hop: 10 }).next.hop === 10);
ok('pb: below the floor never counts', !pbBeats('hop', 2, 4) && comparePb({ stomp: 3 }, { stomp: 4 }).improved.length === 0);
ok('pb: 5 stats at most, pay capped at 40', comparePb({ hop: 6, stomp: 6, spd: 9, blast: 3, chap: 3 }, { hop: 20, stomp: 20, spd: 30, blast: 9, chap: 9 }).improved.length === 5 && pbPay(5) === 40 && pbPay(1) === 10);

// ---- nearest goal ----
const pn = (g, b) => pickNearest(g, b);
ok('nearest: smallest gap wins', pn([{ k: 'rival', gap: 840 }, { k: 'medal', gap: 1200 }, { k: 'rec', gap: 3200 }, { k: 'ladder', gap: 3200 }], 10000).goal.k === 'rival');
ok('nearest: all gaps > 35% -> the ladder step', pn([{ k: 'rival', gap: 4000 }, { k: 'rec', gap: 5000 }, { k: 'ladder', gap: 9000 }], 10000).goal.k === 'ladder');
ok('nearest: ties break rival > medal > rec > ladder', pn([{ k: 'ladder', gap: 500 }, { k: 'rec', gap: 500 }, { k: 'medal', gap: 500 }, { k: 'rival', gap: 500 }], 10000).goal.k === 'rival' && pn([{ k: 'ladder', gap: 500 }, { k: 'rec', gap: 500 }], 10000).goal.k === 'rec');
ok('retry pulses iff gap <= 15% of best', pn([{ k: 'rec', gap: 1500 }], 10000).pulse && !pn([{ k: 'rec', gap: 1501 }], 10000).pulse);

// ---- record chase ----
ok('recordEqDist', recordEqDist(1000, 2000, 5000) === 2500 || recordEqDist(1000, 2000, 5000) === 1000 + 3000 * 1000 / 2000);
ok('recordEqDist unknown early', recordEqDist(10, 100, 5000) === 0);
ok('countdown window is 300 m', RECORD_NEAR === 300 && recMetres(237) === 240 && recMetres(1) === 10 && beatHz(300) === 1.2 && Math.abs(beatHz(0) - 2.4) < 1e-9);
ok('+10% pops: 1.0999 -> 0, 1.25 -> 2, capped at 10', recPops(10999, 10000) === 0 && recPops(12500, 10000) === 2 && recPops(1e9, 10000) === 10 && recPops(9000, 10000) === 0 && recPops(10000, 0) === 0);
ok('record payout 50 + 10 per 10%, cap 150', recPayout(0) === 50 && recPayout(0.25) === 70 && recPayout(9) === 150 && 50 + REC_POP * 10 === 150 && recPayout(5) === 150);
ok('no record under 100 pts (isScoreRecord)', !isScoreRecord(50, 0) && !isScoreRecord(99, 99) && isScoreRecord(150, 120));

// ---- rivals ----
const wk = '2026-W46';
const t1 = rivalScores(wk, 5000, 3), t2 = rivalScores(wk, 5000, 3);
ok('table deterministic for (week, anchor, day)', t1.every((v, i) => v === t2[i]) && t1.length === 30);
ok('table strictly sorted (non-increasing)', t1.every((v, i) => i === 0 || v <= t1[i - 1]));
ok('table differs between weeks', rivalScores('2026-W47', 5000, 3).some((v, i) => v !== t1[i]));
let climbs = true; for (let d = 0; d < 6; d++) { const a = rivalScores(wk, 5000, d), b = rivalScores(wk, 5000, d + 1); const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y); /* per-rival monotonic is checked through the sum + the top */ if (!(b[0] >= a[0] * 0.98) || sb.reduce((x, y) => x + y) < sa.reduce((x, y) => x + y)) climbs = false; }
ok('the table climbs over the week', climbs);
ok('place(0) = unranked, place(huge) = 1, A on day 3 sits mid-table', placeOf(t1, 0) === 0 && placeOf(t1, 1e9) === 1 && placeOf(rivalScores(wk, 5000, 3), 5000) >= 8 && placeOf(rivalScores(wk, 5000, 3), 5000) <= 18);
// pointer walk: sweeping a score from 0 up fires exactly count(rival <= score) overtakes, once each, in descending-rank order
{
  const sc = rivalScores(wk, 3000, 2); let ri = nextAbove(sc, 0), fired = 0, last = 31, okOrder = true;
  for (let v = 0; v <= sc[0] * 1.1; v += 7) { while (ri >= 0 && v > sc[ri]) { fired++; if (ri + 1 >= last) okOrder = false; last = ri + 1; ri--; } }
  ok('pointer walk fires each rival once in order', fired === 30 && okOrder && ri === -1);
}
ok('anchor floor 2000, no NaN', anchor(0) === 2000 && rivalScores(wk, anchor(0), 0).every((v) => Number.isFinite(v) && v > 0));
ok('names stable per week, from the list', rivalName(wk, 3) === rivalName(wk, 3) && typeof rivalName(wk, 30) === 'string' && new Set(Array.from({ length: 30 }, (_, i) => rivalName(wk, i + 1))).size === 30);
ok('week prizes', placePrize(1).coins === 1000 && placePrize(3).coins === 600 && placePrize(10).coins === 300 && placePrize(20).coins === 150 && placePrize(30).coins === 60 && placePrize(0).coins === 0);
ok('weekKey matches the runner weekInfo (menu, run and result read one key)', weekKey(new Date(2026, 10, 16)) === weekInfo(new Date(2026, 10, 16)).key && weekKey(new Date(2026, 0, 1)) === weekInfo(new Date(2026, 0, 1)).key);

// ---- streak (injected day numbers) ----
{
  let rs = { k: 0, n: 0 }; const seq = [];
  for (const d of [100, 101, 101, 103, 104, 105, 106, 107, 108, 109, 110]) { const r = streakStep(rs, d); rs = r.rs; seq.push(r.n + (r.reward ? 'r' : '')); }
  ok('streak sequence', seq[0] === '1' && seq[1] === '2' && seq[2] === '2' && seq[3] === '1');
  const day = (st, d) => streakStep(st, d);
  let s2 = { k: 10, n: 2 }; ok('streak reward at 3 / 5 / 7 once', day(s2, 11).reward.coins === 100 && day({ k: 10, n: 4 }, 11).reward.coins === 250 && day({ k: 10, n: 6 }, 11).reward.coins === 500 && day({ k: 10, n: 2 }, 10).reward === null && day({ k: 10, n: 13 }, 11).reward.coins === 100 && day({ k: 10, n: 7 }, 11).reward === null);
}

// ---- one settle pass against a fake save: pays once, old saves load, place consistent ----
const mkSave = (init = {}) => {
  const d = { coins: 0, lad: 0, pb: null, med: { b: 0, s: 0, g: 0, p: 0 }, rv: null, streak: null, ...init };
  return {
    d, addCoins(c) { d.coins += Math.floor(c); }, runnerLadTier: () => d.lad, setRunnerLadTier(t) { d.lad = Math.max(d.lad, t); }, runnerPb: () => ({ hop: 0, stomp: 0, spd: 0, blast: 0, chap: 0, ...(d.pb || {}) }), setRunnerPb(o) { d.pb = { ...o }; },
    runnerMedals: () => d.med, addRunnerMedal(id) { d.med[id]++; }, runnerRv: () => (d.rv ? { ...d.rv } : null), setRunnerRv(o) { d.rv = { ...o }; }, lastRunnerStreak: () => d.streak,
  };
};
{
  const sv = mkSave(), run = { score: 4600, dist: 900, bestBefore: 3000, wk, hop: 0, stomp: 0, spd: 0, blast: 0, chap: 0 };
  const a = settleRun(sv, null, run);
  ok('settle: promotion into Buz I paid once, medal paid', a.lad.up && a.lad.to === 7 && a.medal === 4 && sv.d.coins === a.coins && a.coins === promotion(0, 4600).coins + MEDALS[4].coins);
  const c1 = sv.d.coins, b = settleRun(sv, null, { ...run, bestBefore: 4600 });
  ok('settle again: the ladder pays nothing twice', !b.lad.up && sv.d.coins - c1 === b.coins && b.coins === MEDALS[3].coins);
  ok('settle: weekly place stable between result and menu math', b.rv.place === placeOf(rivalScores(wk, b.rv.wb > 0 ? sv.d.rv.A : 2000, new Date().getDay() === 0 ? 6 : (new Date().getDay() + 6) % 7), sv.d.rv.wb));
}
{
  const sv = mkSave({ lad: 0 }), r = settleRun(sv, null, { score: 300, dist: 400, bestBefore: 20000, wk, hop: 0, stomp: 0, spd: 0, blast: 0, chap: 0 });
  ok('old save with a big best: retroactive tiers paid once, flagged', r.lad.retro && !r.lad.up && sv.d.lad === tierOf(20000) && r.lad.coins > 0 && settleRun(sv, null, { score: 300, dist: 400, bestBefore: 20000, wk }).lad.coins === 0);
}
{
  const sv = mkSave(), p0 = settleRun(sv, null, { score: 120, dist: 49, bestBefore: 0, wk });
  ok('under 50 m: no medal, no weekly score, nothing paid', p0.medal === 0 && sv.d.coins === 0 && sv.d.rv.wb === 0);
}
{
  const sv = mkSave({ rv: { wk: '2026-W40', A: 4000, wb: 9000, last: null } });
  const st = rollWeek(sv, null, wk, 9000);
  ok('week end settles once and rolls the table', st && st.place >= 1 && sv.d.coins === st.coins && sv.d.rv.wk === wk && rollWeek(sv, null, wk, 9000) === null && sv.d.coins === st.coins);
  ok('settle(null/unranked) is a no-op', settle(null) === null && settle({ wk: 'x', A: 2000, wb: 0 }) === null);
}

// ---- daily score goals ----
{
  ok('daily targets use the floors for a new player', dcTargets(0).join() === '800,1800,4000' && dcTargets(10000).join() === '6000,9000,13000');
  const a = dcStep(null, 5, 10000, 9500);
  ok('daily: reaching target 2 with 1 attempt pays 50 + 120 once', a.counted && a.hits.join() === '0,1' && a.coins === 170 && a.dc.n === 1 && !a.chest);
  const b = dcStep(a.dc, 5, 10000, 9500);
  ok('daily: the same targets never pay twice', b.hits.length === 0 && b.coins === 0 && b.dc.n === 2);
  const c = dcStep(b.dc, 5, 12000, 14000);
  ok('daily: third target pays 250 and opens a chest, A stays the day-start best', c.hits.join() === '2' && c.coins === DC_COIN[2] && c.chest && c.dc.A === 10000);
  const d = dcStep(c.dc, 5, 12000, 99999);
  ok('daily: the 4th attempt does not count', !d.counted && d.coins === 0 && d.dc.n === 3);
  ok('daily: a new day resets', dcStep(c.dc, 6, 14000, 100).dc.n === 1 && dcView(c.dc, 6, 14000).n === 0 && dcView(c.dc, 5, 14000).hit === 3);
}

{
  const sv = mkSave(), d0 = JSON.stringify(sv.d), r = settleRun(sv, null, { score: 5200, dist: 900, bestBefore: 3000, wk, daily: true, hop: 9, stomp: 9, spd: 30, blast: 4, chap: 3 }, true);
  ok('dry settle (the revive preview) writes and pays nothing, shows no medal / promotion, still names ONE goal', JSON.stringify(sv.d) === d0 && r.coins === 0 && r.medal === 0 && !r.lad.up && !!r.near);
}

console.log(`check-goals: OK (${n} checks)`);
