// Weekly league of 30 local bots (no backend): a deterministic table from (week key, anchor score A, day of the week). Pure.
import { makeRng } from '../rng.js';

export const RIVAL_N = 30;
export const RIVAL_NAMES = ['Ayşe', 'Mert', 'Deniz', 'Kerem', 'Zeynep', 'Efe', 'Elif', 'Can', 'Selin', 'Burak', 'Defne', 'Emre', 'Ece', 'Yiğit', 'Naz', 'Kaan', 'Irmak', 'Arda', 'Duru', 'Onur',
  'Yeti_Avcısı', 'Kar_Kral', 'Buz_Pati', 'Çığ_1907', 'Pofuduk', 'Kartopu_34', 'Zirve_06', 'Bora', 'Ilgaz', 'Tuna'];
const hash = (i, wk, salt) => { let h = salt * 2654435761; for (let k = 0; k < wk.length; k++) h = Math.imul(h ^ wk.charCodeAt(k), 16777619); return makeRng((h ^ (i * 40503)) >>> 0).next(); };
/** Day of the ISO week 0..6 (Monday = 0). */
export const weekDay = (d = new Date()) => (d.getDay() + 6) % 7;
/** ISO week key 'YYYY-Www' (same string as runner.js weekInfo().key; kept here so the lobby does not pull the runner chunk). */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dn = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dn);
  const year = d.getUTCFullYear(), week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return year + '-W' + String(week).padStart(2, '0');
}
export const anchor = (best) => Math.max(2000, best | 0);

/** Scores of the 30 rivals sorted DESCENDING (place 1 first) for week `wk`, anchor `A`, day `d` (0..6). Fills `out` when given (no allocation). */
export function rivalScores(wk, A, d, out = new Float64Array(RIVAL_N)) {
  d = Math.max(0, Math.min(6, d | 0));
  for (let i = 1; i <= RIVAL_N; i++) {
    const base = A * Math.pow(1.9, (15.5 - i) / 7.5) * (0.92 + 0.16 * hash(i, wk, 1));
    out[i - 1] = Math.round(base * (0.55 + 0.45 * d / 6 * (0.6 + 0.8 * hash(i, wk, 2))));
  }
  out.sort(); out.reverse();      // typed array sort is numeric; the table is descending
  return out;
}
/** Which handle plays at `rank` (1-based): stable per week (a shuffled name list, so the same name is not always on top). */
export function rivalName(wk, rank) {
  const idx = []; for (let i = 0; i < RIVAL_N; i++) idx.push(i);
  const r = makeRng(Math.round(hash(0, wk, 3) * 4294967295));
  for (let i = RIVAL_N - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
  return RIVAL_NAMES[idx[(rank - 1) % RIVAL_N]];
}
/** The player's place for a weekly best `wb`: 1 + rivals above; 0 = unranked (no run this week). Ties go to the player. */
export function placeOf(sc, wb) {
  if (!(wb > 0)) return 0;
  let n = 1; for (let i = 0; i < sc.length; i++) if (sc[i] > wb) n++;
  return n;
}
/** Index of the first rival (in the descending table) whose score is still above `v` counting from the bottom: the next one to overtake; -1 = the leader is passed. */
export function nextAbove(sc, v) { let i = sc.length - 1; while (i >= 0 && sc[i] <= v) i--; return i; }
/** Week-end prize by final place. */
export const placePrize = (p) => (p <= 0 ? { coins: 0 } : p === 1 ? { coins: 1000, boxes: 1 } : p <= 3 ? { coins: 600 } : p <= 10 ? { coins: 300 } : p <= 20 ? { coins: 150 } : p <= 30 ? { coins: 60 } : { coins: 0 });
/** Settle a finished week: rv = { wk, A, wb } -> { place, coins, boxes } (day-6 table). */
export function settle(rv) {
  if (!rv || !rv.wk || !(rv.wb > 0)) return null;
  const place = placeOf(rivalScores(rv.wk, rv.A || 2000, 6), rv.wb);
  return { wk: rv.wk, place, ...placePrize(place) };
}
