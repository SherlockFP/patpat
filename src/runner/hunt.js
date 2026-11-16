// The Rush "Subway loop" helpers, pure (node-testable like ladder.js): the daily letter-hunt word, where its letters sit on the track,
// the mystery box roll and the ONE named goal of a run (pickGoal1). meta.js stores the hunt progress; obstacles.js / runner.js / ui.js read these.
import { TIER_AT, MAX_TIER, tierOf, tierInfo } from './ladder.js';

export const HUNT_LEN = 5, HUNT_STREAK = 5;
// 5-letter words, one list per language (the count of collected letters is what is saved, so switching language mid-day keeps the progress)
export const HUNT_TR = ['YETİM', 'ZİRVE', 'BUZUL', 'KAYAK', 'SİSLİ', 'KARLI', 'BORAN', 'DONUK', 'TUZAK', 'ÇIĞIR', 'SOĞUK', 'HIZLI'];
export const HUNT_EN = ['FROST', 'SLOPE', 'PEAKS', 'CHILL', 'FLAKE', 'BLAST', 'SPEED', 'STORM', 'DRIFT', 'SNOWY', 'GLIDE', 'BRISK'];
const dayN = (key) => { const p = String(key).split('-'); return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); };
/** today's word for a 'YYYY-MM-DD' key: a fixed shuffle of the list, same for everyone that day */
export const huntWord = (key, en = false) => (en ? HUNT_EN : HUNT_TR)[(((dayN(key) * 5) % 12) + 12) % 12];

/** Letter i (0..4) gets harder: 0-1 a free lane within reach, 2-3 a lane beside a hazard row, 4 right above a hazard (needs a jump). */
export const letterRisk = (i) => (i >= 4 ? 2 : i >= 2 ? 1 : 0);
export const LETTER_H = [1.2, 1.9, 2.6];            // pickup height per risk (m above the snow)
export const LETTER_FIRST = 90, LETTER_REPEAT = [260, 380], LETTER_GAP = 150;   // first spawn (m), a missed letter shows again after 260-380 m, a new one waits 150 m behind a collected one

/** Mystery box: a small random prize. r in [0,1) -> { k: 'coins' | 'score' | 'gem' | 'chest', v } (the same r always pays the same). */
export function mboxRoll(r) {
  if (r < 0.56) return { k: 'coins', v: 30 + 10 * Math.floor(((r / 0.56) * 100) % 7) };
  if (r < 0.86) return { k: 'score', v: 300 + 100 * Math.floor((((r - 0.56) / 0.3) * 100) % 6) };
  if (r < 0.96) return { k: 'gem', v: 1 };
  return { k: 'chest', v: 1 };
}
export const MBOX_FIRST = 350, MBOX_EVERY = [520, 760];

/**
 * The ONE named goal of a run. c = { letter: 'T'|'' (daily hunt, '' when done), best, rvNext: {place, name, score} | null (next weekly rival above best), score }.
 * Order: the hunt letter, else (scoreGoals !== false: no open mission, no record left to beat) the nearest of rival / ladder step against the best (pickNearest rule: within 35% of it), else null (the mission / record strip speaks).
 * -> { kind: 'letter'|'rival'|'ladder', ... } with target (score to reach) for the score goals.
 */
export function pickGoal1(c) {
  if (c.letter) return { kind: 'letter', letter: c.letter };
  if (c.scoreGoals === false) return null;      // an open mission / a record still to beat already is the goal: only the letter outranks them
  const best = c.best || 0, sc = c.score || 0, out = [];
  if (c.rvNext && c.rvNext.score > Math.max(best, sc)) out.push({ kind: 'rival', place: c.rvNext.place, name: c.rvNext.name, target: c.rvNext.score });
  const t = tierOf(Math.max(best, sc));
  if (t < MAX_TIER) out.push({ kind: 'ladder', tier: t + 1, target: TIER_AT[t] });
  let pick = null;
  for (const g of out) { const gap = g.target - sc; if (gap > 0 && (best <= 0 || g.target - Math.max(best, sc) <= best * 0.35) && (!pick || g.target < pick.target)) pick = g; }
  return pick;
}
/** how a score goal reads: '#12 Mert: 840 puan', 'BUZ II: 3.200 kaldı'. fmt turns a number into text, tl translates a Turkish chunk, up upper-cases in the active language */
export function goal1Text(g, score, fmt, tl = (x) => x, up = (x) => x.toLocaleUpperCase('tr-TR')) {
  if (!g) return '';
  const gap = Math.max(1, Math.ceil(g.target - score));
  if (g.kind === 'rival') return `#${g.place} ${g.name}: ${tl(fmt(gap) + ' puan')}`;
  const ti = tierInfo(g.tier);
  return `${up(tl(ti.name))} ${ti.label.slice(ti.name.length + 1)}: ${tl(fmt(gap) + ' kaldı')}`;
}
