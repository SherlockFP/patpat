// Rush goals that give a high score a reason: rank ladder, medals, personal bests, nearest goal, record streak, in-run record chase. Pure (node-testable like goals.js).

// ---------- RANK LADDER: 6 leagues x 3 steps = 18 tiers by BEST SCORE (never demotes) ----------
export const LEAGUES = [
  { id: 'kt', name: 'Kar Tanesi', icon: '❄️', col: '#d9a066' },
  { id: 'kp', name: 'Kartopu', icon: '⚪', col: '#7fb8ff' },
  { id: 'bz', name: 'Buz', icon: '🧊', col: '#5fe3ff' },
  { id: 'cg', name: 'Çığ', icon: '🌨️', col: '#f2f8ff' },
  { id: 'ya', name: 'Yeti Avcısı', icon: '🦣', col: '#b58cff' },
  { id: 'ef', name: 'Efsane', icon: '👑', col: '#ffd24a' },
];
export const TIER_AT = [400, 700, 1000, 1500, 2200, 3200, 4500, 6500, 9000, 13000, 18000, 25000, 35000, 50000, 70000, 100000, 150000, 250000];
export const MAX_TIER = TIER_AT.length;
const ROMAN = ['I', 'II', 'III'];
/** 0 = no tier yet, 1..18. */
export const tierOf = (score) => { let t = 0; while (t < MAX_TIER && score >= TIER_AT[t]) t++; return t; };
export const leagueIdx = (tier) => (tier > 0 ? Math.floor((tier - 1) / 3) : -1);
/** { league, step (1..3), name 'BUZ II', short 'Buz II', icon, col } or null. */
export function tierInfo(tier) {
  if (!(tier > 0)) return null;
  const li = leagueIdx(tier), L = LEAGUES[li], step = ((tier - 1) % 3) + 1;
  return { league: li, step, name: L.name, label: L.name + ' ' + ROMAN[step - 1], icon: L.icon, col: L.col, tier };
}
export const stepReward = (tier) => Math.min(150, Math.ceil(tier * tier / 2));
/** What entering a league the first time pays (league index 1..5): flakes + the item an ach('lg_*') grants. */
export const LEAGUE_REWARD = { 1: { coins: 50 }, 2: { coins: 120 }, 3: { coins: 250 }, 4: { coins: 450 }, 5: { coins: 900 } };
/** Pays every tier in (lt, tierOf(score)] once. lt = the peak tier already paid. { from, to, coins, leagueUp, steps } (to === from when nothing). */
export function promotion(lt, score) {
  const to = tierOf(score);
  const o = { from: lt | 0, to: Math.max(lt | 0, to), coins: 0, leagueUp: false, steps: 0 };
  for (let t = o.from + 1; t <= to; t++) {
    o.coins += stepReward(t); o.steps++;
    if ((t - 1) % 3 === 0 && LEAGUE_REWARD[leagueIdx(t)]) { o.coins += LEAGUE_REWARD[leagueIdx(t)].coins; o.leagueUp = true; }
  }
  return o;
}
/** Points to the next step (0 at the top). */
export const toNextTier = (score) => { const t = tierOf(score); return t >= MAX_TIER ? 0 : TIER_AT[t] - score; };

// ---------- MEDALS ----------
export const MEDALS = [null,
  { id: 'b', name: 'BRONZ', icon: '🥉', col: '#b9773a', coins: 2 },
  { id: 's', name: 'GÜMÜŞ', icon: '🥈', col: '#cfd6e0', coins: 4 },
  { id: 'g', name: 'ALTIN', icon: '🥇', col: '#ffd24a', coins: 10 },
  { id: 'p', name: 'PLATİN', icon: '💎', col: '#9fe8ff', coins: 30 },
];
export const MEDAL_FIXED = [0, 600, 1500, 4000, 10000];
/** Medal tier 0..4 of a run of `score` over `dist` m against the personal `best` BEFORE the run. New players (best < 1000) read the fixed scale too. */
export function medalFor(score, best, dist = 50) {
  if (dist < 50 || !(score > 0)) return 0;
  let m = 0;
  if (best > 0) m = score >= best * 1.25 ? 4 : score >= best ? 3 : score >= best * 0.8 ? 2 : score >= best * 0.5 ? 1 : 0;
  if (best < 1000) for (let i = 4; i > m; i--) if (score >= MEDAL_FIXED[i]) { m = i; break; }
  return m;
}
/** Score of the next medal above `m` (0 = none left). */
export const nextMedalAt = (m, best) => (m >= 4 ? 0 : best >= 1000 ? Math.ceil(best * [0.5, 0.8, 1, 1.25][m]) : MEDAL_FIXED[m + 1]);

// ---------- PERSONAL BESTS ----------
export const PB_KEYS = ['hop', 'stomp', 'spd', 'blast', 'chap'];
export const PB_FLOOR = { hop: 5, stomp: 5, spd: 8, blast: 2, chap: 2 };
export const PB_NAME = { hop: 'KIL PAYI SERİSİ', stomp: 'EZME', spd: 'HIZ', blast: 'PATLAMA', chap: 'BÖLÜM SAYISI' };
export const PB_ICON = { hop: '🔗', stomp: '🦶', spd: '⚡', blast: '🔥', chap: '🏁' };
/** A stat counts as a PB when old > 0 and v >= old + max(1, 5%) and v >= floor; the first value over the floor is a silent baseline. */
export const pbBeats = (k, old, v) => v >= (PB_FLOOR[k] || 1) && old > 0 && v >= old + Math.max(1, old * 0.05);
/** old/run = { hop, stomp, spd, blast, chap }. { improved: [{k, old, v}], next } (next = the stored PBs after the run). */
export function comparePb(old, run) {
  const next = {}, improved = [];
  for (const k of PB_KEYS) {
    const o = +(old && old[k]) || 0, v = +(run && run[k]) || 0;
    next[k] = o;
    if (pbBeats(k, o, v)) { improved.push({ k, old: o, v }); next[k] = v; }
    else if (o <= 0 && v >= PB_FLOOR[k]) next[k] = v;
  }
  return { improved, next };
}
export const pbPay = (n) => Math.min(40, 10 * n);

// ---------- ONE NEAREST GOAL ----------
const ORDER = { rival: 0, medal: 1, rec: 2, ladder: 3, pb: 4 };
/** cands: [{ k: 'rival'|'medal'|'rec'|'ladder'|'pb', gap, ... }] (gap in points). One pick: smallest gap within 35% of best, ties in ORDER, else the ladder step. { goal, pulse } */
export function pickNearest(cands, best) {
  const ok = cands.filter((c) => c && c.gap > 0 && (best > 0 ? c.gap <= best * 0.35 : true));
  let pick = null;
  for (const c of ok) if (!pick || c.gap < pick.gap || (c.gap === pick.gap && ORDER[c.k] < ORDER[pick.k])) pick = c;
  if (!pick) pick = cands.find((c) => c && c.k === 'ladder' && c.gap > 0) || cands.find((c) => c && c.gap > 0) || null;
  return { goal: pick, pulse: !!pick && best > 0 && pick.gap / best <= 0.15 };
}

// ---------- RECORD STREAK ----------
/** rs = { k: last record day number, n }. day = a day count (consecutive days differ by 1). { rs, reward: {coins, trail?, skin?} | null, n } */
export function streakStep(rs, day) {
  const o = { k: rs && rs.k | 0, n: rs && rs.n | 0 };
  if (o.k === day) return { rs: o, reward: null, n: o.n };
  o.n = o.k === day - 1 ? o.n + 1 : 1; o.k = day;
  const n = o.n;
  const reward = n === 3 ? { coins: 100 } : n === 5 ? { coins: 250 } : n === 7 ? { coins: 500 } : n > 7 && n % 7 === 0 ? { coins: 100 } : null;
  return { rs: o, reward, n };
}
export const dayNum = (d = new Date()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

// ---------- DAILY SCORE GOALS (Günün Rush'ı): 3 target scores from the best at day start, 3 counted attempts ----------
export const DC_FLOOR = [800, 1800, 4000], DC_COIN = [50, 120, 250], DC_TRIES = 3;
export const dcTargets = (A) => [0.6, 0.9, 1.3].map((m, i) => Math.max(DC_FLOOR[i], Math.round(A * m)));
/** What the menu shows: { hit (targets reached), n (counted attempts), targets }. A stale / missing record is a fresh day. */
export function dcView(dc, day, best) {
  const f = dc && dc.k === day ? dc : { A: best | 0, n: 0, claimed: 0 };
  let hit = 0; for (let i = 0; i < 3; i++) if (f.claimed & (1 << i)) hit++;
  return { hit, n: f.n | 0, targets: dcTargets(f.A | 0), best: f.best | 0 };
}
/** One daily run: { dc (to store), counted, hits (newly reached target indexes), coins, chest }. Targets paid once each; the 4th+ run still plays but counts for nothing. */
export function dcStep(dc, day, bestBefore, score) {
  const d = dc && dc.k === day ? { ...dc } : { k: day, A: bestBefore | 0, n: 0, best: 0, claimed: 0 };
  const o = { dc: d, counted: d.n < DC_TRIES, hits: [], coins: 0, chest: false };
  if (!o.counted) return o;
  d.n++; d.best = Math.max(d.best | 0, score | 0);
  const tg = dcTargets(d.A);
  for (let i = 0; i < 3; i++) if (!(d.claimed & (1 << i)) && score >= tg[i]) { d.claimed |= 1 << i; o.hits.push(i); o.coins += DC_COIN[i]; }
  if (d.claimed === 7 && o.hits.length) o.chest = true;
  return o;
}

// ---------- RECORD CHASE (in-run) ----------
export const RECORD_NEAR = 300;
/** Pass payout: 50 + 10 per started 10% over the old record, capped at 150. gain = score / best - 1. */
export const REC_POP = 10;
export const recPayout = (gain) => Math.min(150, 50 + REC_POP * Math.floor(Math.max(0, gain) * 10));
/** How many "+10% over the old record" pops a score has earned (max 10). */
export const recPops = (score, best) => (best > 0 && score > best ? Math.min(10, Math.floor((score / best - 1) / 0.1 + 1e-9)) : 0);
/** Heart-beat rate (Hz) 1.2 -> 2.4 over the last 300 m. */
export const beatHz = (m) => 1.2 + 1.2 * Math.min(1, Math.max(0, 1 - m / RECORD_NEAR));
/** HUD text rounding: metres to the record, to 10. */
export const recMetres = (m) => Math.max(10, Math.ceil(m / 10) * 10);
