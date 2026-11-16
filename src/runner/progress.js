// Settles the goal layer of one finished Rush run against the save (ladder, medal, personal bests, weekly league, record streak). Pure of DOM/THREE: `save` / `meta` are injected.
import { dcStep, dayNum, tierOf, tierInfo, promotion, medalFor, MEDALS, nextMedalAt, comparePb, pbPay, pickNearest, toNextTier, TIER_AT, MAX_TIER } from './ladder.js';
import { rivalScores, rivalName, placeOf, settle, anchor, weekDay } from './rivals.js';

/** New week: pay the last week's place once (day-6 table) and start this week's table. Idempotent per week. Returns { wk, place, coins, boxes } of the settled week or null. */
export function rollWeek(save, meta, wk, best, pay = true) {
  const rv = save.runnerRv();
  if (rv && rv.wk === wk) return null;
  const st = settle(rv);
  if (st && pay) { if (st.coins) save.addCoins(st.coins); if (st.boxes) meta?.addBoxes?.(st.boxes); }
  save.setRunnerRv({ wk, A: anchor(best), wb: 0, last: st ? { wk: st.wk, place: st.place, coins: st.coins } : (rv && rv.last) || null });
  return st;
}

/** The weekly table for display: [{ place, name, score, you }] around the player (2 above, you, 2 below). */
export function tableAround(wk, A, d, wb, n = 2) {
  const sc = rivalScores(wk, A, d), place = wb > 0 ? placeOf(sc, wb) : 31, rows = [];
  for (let p = Math.max(1, place - n); p <= Math.min(31, place + n); p++) {
    if (p === place) rows.push({ place: p, name: '', score: wb, you: true });
    else { const i = p > place ? p - 2 : p - 1; if (i >= 0 && i < 30) rows.push({ place: p, name: rivalName(wk, i + 1), score: sc[i], you: false }); }
  }
  return rows;
}

/** run = { score, dist, bestBefore, wk, hop, stomp, spd, blast, chap }. Writes the save, pays flakes, returns the payload the result screen draws. */
/** dry = a preview for the revive screen (the run is not over): reads only, pays nothing, no medal / promotion yet. */
export function settleRun(save, meta, run, dry = false) {
  const { score, dist, bestBefore, wk } = run;
  const out = { coins: 0, medal: 0, lad: null, pb: null, rv: null, streak: null, near: null, pulse: false };
  const ok = dist >= 50;
  // medal (against the best BEFORE this run)
  const m = ok && !dry ? medalFor(score, bestBefore, dist) : 0;
  if (m) { out.medal = m; out.coins += MEDALS[m].coins; save.addRunnerMedal(MEDALS[m].id); }
  // ladder: pays every tier above the stored peak once (an old save pays its retroactive tiers once, as one flagged sum)
  const eff = Math.max(bestBefore, ok ? score : 0), lt = save.runnerLadTier(), pr = promotion(lt, eff);
  const fromT = tierOf(bestBefore), toT = dry ? fromT : tierOf(eff);
  if (pr.to > lt && !dry) { save.setRunnerLadTier(pr.to); out.coins += pr.coins; }
  out.lad = { from: fromT, to: toT, coins: dry ? 0 : pr.coins, leagueUp: pr.leagueUp && toT > fromT, up: toT > fromT, retro: !dry && pr.to > lt && fromT > lt, info: tierInfo(toT) };
  // personal bests
  if (ok && !dry) {
    const c = comparePb(save.runnerPb(), run);
    if (c.improved.length || PBchanged(save.runnerPb(), c.next)) save.setRunnerPb(c.next);
    const pay = c.improved.length ? pbPay(c.improved.length) : 0;
    out.coins += pay; out.pb = { improved: c.improved, coins: pay };
  }
  // weekly league
  if (wk) {
    if (!dry) rollWeek(save, meta, wk, bestBefore);
    const rv = save.runnerRv() || { A: 2000, wb: 0 }, d = weekDay(), sc = rivalScores(wk, rv.A, d);
    const p0 = placeOf(sc, rv.wb);
    if (ok && score > rv.wb) { rv.wb = score; if (!dry) save.setRunnerRv(rv); }
    const p1 = placeOf(sc, rv.wb);
    out.rv = { place: p1, was: p0, wb: rv.wb, last: rv.last || null, rows: tableAround(wk, rv.A, d, rv.wb) };
    // next rival above this run's score
    const hi = Math.max(score, rv.wb);
    let i = sc.length - 1; while (i >= 0 && sc[i] <= hi) i--;
    if (i >= 0) out.rv.next = { place: i + 1, name: rivalName(wk, i + 1), gap: Math.ceil(sc[i] - score) + 1 };
  }
  // Günün Rush'ı score goals
  if (run.daily && ok && !dry) {
    const c = dcStep(save.runnerDc?.(), dayNum(), bestBefore, score);
    if (c.counted) save.setRunnerDc?.(c.dc);
    out.coins += c.coins; if (c.chest) meta?.addBoxes?.(1);
    out.dc = { n: c.dc.n, claimed: c.dc.claimed, hits: c.hits, coins: c.coins, chest: c.chest, counted: c.counted };
  }
  // record streak (save.recordRunner computed it)
  const sk = save.lastRunnerStreak?.();
  if (sk && ok && !dry) { out.streak = { n: sk.n, reward: sk.reward }; if (sk.reward) out.coins += sk.reward.coins; }
  if (out.coins > 0 && !dry) save.addCoins(out.coins);
  // ONE nearest goal
  const best = Math.max(bestBefore, score), cands = [];
  if (out.rv && out.rv.next) cands.push({ k: 'rival', gap: out.rv.next.gap, place: out.rv.next.place, name: out.rv.next.name });
  if (m < 4 && ok) { const at = nextMedalAt(m, bestBefore); if (at > score) cands.push({ k: 'medal', gap: at - score, medal: m + 1 }); }
  if (score <= bestBefore && bestBefore > 0) cands.push({ k: 'rec', gap: bestBefore - score + 1 });
  if (toT < MAX_TIER) cands.push({ k: 'ladder', gap: toNextTier(best), tier: toT + 1 });
  const nr = pickNearest(cands, best);
  out.near = nr.goal; out.pulse = nr.pulse;
  return out;
}
const PBchanged = (a, b) => Object.keys(b).some((k) => b[k] !== (a[k] || 0));
export { TIER_AT };
