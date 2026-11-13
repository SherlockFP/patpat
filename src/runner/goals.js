// Pure helpers for the run-goal layer (checkpoints, record chase, Yeti rage, additive score multiplier).
// No DOM / THREE here so they can be smoke-tested in node.

/** In-run score multiplier: everything adds to 1 and the in-run part is capped; permanent progression (`keep`) sits on top. */
export function scoreMult(tier, flow, chain, danger, risk, keep = 0, cap = 8) {
  return Math.round((Math.min(cap, 1 + tier + flow + chain + danger + risk) + keep) * 10) / 10;
}

/** near-miss chain → bonus (replaces the old ×2/×3/×5) */
export const chainBonus = (c) => (c >= 8 ? 3 : c >= 5 ? 2 : c >= 3 ? 1 : 0);

/** Yeti closeness → bonus: +1 while a stumble window is open (the Yeti is right behind you), else 0 */
export const dangerBonus = (stumbling) => (stumbling ? 1 : 0);

/** Coins for crossing checkpoint number n (1 = first layer boundary); a CLEAN layer (no crash since the last checkpoint) pays double. */
export const checkpointReward = (n, per = 25, clean = false) => per * Math.min(Math.max(1, n), 8) * (clean ? 2 : 1);


/**
 * Hunger: how fast the ball melts, in size tiers per second.
 * (base + perTier * tier) grows with distance (up to +meltGrow after `ramp` m); `k` scales it (campaign is gentler).
 */
export function meltRate(tier, s, cfg, k = 1) {
  return (cfg.meltBase + cfg.meltPerTier * tier) * (1 + cfg.meltGrow * Math.min(1, Math.max(0, s) / cfg.meltRamp)) * k;
}

/**
 * Goal strip state at distance s. Fills `out` { mode: 'cp' | 'rec', val, frac }:
 *   rec = record within `near` metres (val = metres left, rounded up to 10; frac fills as you close in),
 *   cp  = next checkpoint (val = its distance; frac = progress through the current layer).
 */
export function goalFor(s, layerLen, best, passed, near, out) {
  const left = best - s;
  if (!passed && best >= 50 && left <= near) {
    out.mode = 'rec';
    out.val = Math.max(10, Math.ceil(left / 10) * 10);
    out.frac = Math.min(1, Math.max(0, 1 - left / near));
    return out;
  }
  const k = Math.floor(Math.max(0, s) / layerLen);
  out.mode = 'cp';
  out.val = (k + 1) * layerLen;
  out.frac = (s - k * layerLen) / layerLen;
  return out;
}

// ---------- feel helpers (pure; scripts/check-feel.mjs) ----------

/** A turn swipe made up to this many seconds before its window opens is held and fires the moment it opens (never dropped). */
export const TURN_BUF = 0.12;
/** Where a turn lands in its window, f = (s - windowStart) / (cornerS - windowStart): before PERFECT_F0 it is early, up to LATE_F0 perfect, after that (and past the corner) late. */
export const TURN_PERFECT_F0 = 0.5;
export const TURN_LATE_F0 = 0.9;

/** True when a swipe at track position `s` falls inside the buffer just before a turn window that opens at `sA`. */
export const turnBuffered = (s, sA, vs) => s < sA && s >= sA - Math.max(1, vs) * TURN_BUF;

/** 0 early / 1 perfect / 2 late. */
export const turnGrade = (f) => (f >= TURN_LATE_F0 ? 2 : f >= TURN_PERFECT_F0 ? 1 : 0);

/** Score points (x mult), flow and hit-pause seconds of a turn; `streak` = perfect turns in a row before this one. */
export function turnReward(g, streak = 0) {
  if (g === 1) return { pts: 250 + 50 * Math.min(4, Math.max(0, streak)), flow: 8, stop: 0.05 };
  if (g === 2) return { pts: 150, flow: 5, stop: 0 };
  return { pts: 100, flow: 4, stop: 0 };
}

/** Tier of the HUD combo chip (5 / 10 / 20 / 50): the 3D feedback grows in the same steps as the number on screen. */
export const comboLevel = (n) => (n >= 50 ? 4 : n >= 20 ? 3 : n >= 10 ? 2 : n >= 5 ? 1 : 0);

/** FLOW STATE: seconds granted when the combo reaches tier L (it starts at tier 2); 0 below. */
export const flowStateSecs = (L) => (L >= 4 ? 8 : L === 3 ? 7 : L === 2 ? 6 : 0);

/**
 * The multiplier counted in whole steps (called every frame: returns a number, allocates nothing). `top` = the highest step already
 * announced, -1 before the first look. Returns the new top: announce when it is higher than the old one (and the old one was >= 0).
 * A fall of a whole step re-arms it; a flicker around a step stays quiet.
 */
export function multStep(m, top) {
  const k = Math.floor(m);
  if (top < 0 || k > top) return k;
  return k < top - 1 ? k : top;
}

/**
 * ÇIĞ RÜZGÂRI: deterministic crosswind schedule (so the obstacle spawner and the runner agree). From 1500 m, one slot per 520 m,
 * 75% of them hold a gust (95-150 m, ~4-6 s). Returns the shared { s0, s1, dir } (dir -1 / +1 = the side it blows toward) or null.
 */
const _gust = { s0: 0, s1: 0, dir: 1 };
const gh = (k, n) => { const x = Math.sin(k * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
export function gustAt(s, lead = 0) {
  if (s + lead < 1500) return null;
  const k = Math.floor((s + lead - 1500) / 520);
  for (let kk = k; kk >= Math.max(0, k - 1); kk--) {
    if (gh(kk, 1) > 0.75) continue;
    const s0 = 1500 + kk * 520 + 120 + gh(kk, 2) * 220, s1 = s0 + 95 + gh(kk, 3) * 55;
    if (s + lead >= s0 - 4 && s <= s1 + 4) { _gust.s0 = s0; _gust.s1 = s1; _gust.dir = gh(kk, 4) < 0.5 ? -1 : 1; return _gust; }
  }
  return null;
}

// ---------- score read-out (death screen) ----------

/** Round scores a player chases once the record is theirs (a new best has no "points left"). */
export const SCORE_STEPS = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

/** The ONE next goal on the death screen: below the record = { k: 'rec', val: points that beat it }, else { k: 'next', val: the next round score }. */
export function nextGoal(score, best) {
  if (best > 0 && score <= best) return { k: 'rec', val: best - score + 1 };
  for (let i = 0; i < SCORE_STEPS.length; i++) if (SCORE_STEPS[i] > score) return { k: 'next', val: SCORE_STEPS[i] };
  return { k: 'next', val: (Math.floor(score / 1e6) + 1) * 1e6 };
}

// ---------- Yeti on screen / score record (pure) ----------

/** Scale (0.25..1) that keeps the Yeti at most ~`frac` of the view height: d3 = distance camera -> Yeti (m), fovDeg = vertical fov, H = its full height (m). */
export const yetiFit = (d3, fovDeg, H, frac = 0.2) => Math.min(1, Math.max(0.25, (2 * frac * d3 * Math.tan(fovDeg * Math.PI / 360)) / H));

/** How far (0..1) the Yeti slides to the far side of the track: full when it is within 4.5 m of the camera, none from 9.5 m. */
export const yetiSide = (dCam) => Math.min(1, Math.max(0, (9.5 - dCam) / 5));

/** "To the record" in METRES from a SCORE record: the points left, turned into metres at this run's own points-per-metre. 0 = unknown (too early). */
export const recordEqDist = (s, score, bestScore) => (s >= 50 && score > 0 ? s + (bestScore - score) * s / score : 0);

// ---------- goal chain (endless): always one visible goal ----------

/** ÇIĞ-only mission ids: they cannot advance in Rush (backs up rows without `modes`). */
const CIG_ONLY = { cigtier: 1, cigtons: 1, cigdist: 1, swallow: 1, stars: 1, destroy: 1 };
const EASY = { jump: 5, coins: 4, dist: 4, stomp: 3, smash: 3, buffs: 2 };
/** The open mission closest to done in `rows` (meta.missions(): { text, value, goal, done }): highest value / goal, a tie keeps the first. null when none is open. Allocates nothing. */
export function pickMission(rows, skip) {
  let best = null, bf = -1;
  if (!rows) return null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.done || (skip && r.id === skip) || r.modes === 'cig' || CIG_ONLY[r.id] || !(r.goal > 0)) continue;
    const f = r.value / r.goal + (EASY[r.id] || 0) * 1e-3;   // (a tie at 0 goes to the mission that moves early: jump, flakes, distance; never the rare 'turn')
    if (f > bf) { bf = f; best = r; }
  }
  return best;
}
export const missionFrac = (r) => (r && r.goal > 0 ? Math.min(1, Math.max(0, r.value / r.goal)) : 0);
/** How many missions of the set are still open. */
export function missionsLeft(rows) {
  let n = 0;
  if (rows) for (let i = 0; i < rows.length; i++) if (rows[i] && !rows[i].done) n++;
  return n;
}
/** What finishing the set pays: the permanent multiplier +1 (30 is meta's ceiling). */
export const nextMult = (m) => Math.min(30, Math.max(1, Math.round(m) || 1) + 1);
/** Run-start line (shown ~2 s): "GÖREV: 3 yaratık ez (1/3) · ÇARPAN x4". `tr` translates the parts, so the line is built in the player's language. */
export const missionLine = (r, mult, tr = (s) => s) => `${tr('GÖREV:')} ${tr(r.text)} (${r.value}/${r.goal})${mult > 0 ? ` · ${tr('ÇARPAN')} x${mult}` : ''}`;
/** Postcard moment: "KARTPOSTAL: Volkan 5/14". */
export const postcardLine = (name, n, total, tr = (s) => s) => `${tr('KARTPOSTAL:')} ${tr(name)} ${n}/${total}`;
/** Which ONE goal the death screen names: the record gap when it is within reach (>= 75% of it) or when no mission is open, else the closest mission, else the next round score. */
export function deathGoalKind(ng, score, best, row) {
  if (ng.k === 'rec' && (!row || score >= best * 0.75)) return 'rec';
  return row ? 'mission' : ng.k;
}

// ---------- YETİ RUSH chapters (PLAN_V3 §9) ----------
// A run is a chain of named chapters (~500-700 m) with one signature rule each. The plan is a pure function of (seed, best distance):
// the track generator, the obstacle spawner and the runner all ask chapterAt(s) and always agree. Rule fields are read by track.js
// (set: forced set piece, plain: only plain pieces, gap: gap-piece chance, slalom) and obstacles.js (dens, pat / own: row-pattern weights,
// fog / wind: chance on plain pieces, pads: jump-pad chance, slide: ice strips, bonus: coin rain with no rows); runner.js (spd, pin, duel, lights).
// Replaced by a chapter of existing pieces (a whole new system each): "Gece Koşusu" (no night grade) -> YAY TARLASI, "Kızak" (rideable sled) -> BUZ KAYDIRAĞI.
export const CHAPTERS = [
  { id: 'yamac', name: 'YAMAÇ', unlock: 0, intro: 'Zıpla, eğil, şerit değiştir.' },
  { id: 'orman', name: 'ORMAN SLALOMU', unlock: 0, intro: 'Ağaç kapılarından sağa sola kay.', slalom: 1, gates: 0.95, pat: { phrase: 2.2, single: 1.2, _: 0.6 } },
  { id: 'tunel', name: 'BUZ TÜNELİ', unlock: 600, intro: 'Tünelde duvarlara tırman, sarkıtlardan eğil.', set: 'tube', plain: 1 },
  { id: 'ray', name: 'RAY HATTI', unlock: 1200, intro: 'Raylara bin, raydan raya atla.', pat: { rail: 8, _: 0.4 }, own: ['rail'], gap: 0.3 },
  { id: 'cig', name: 'ÇIĞ KAÇIŞI', unlock: 1800, intro: 'Çığ arkanda: durma, engel az.', plain: 1, dens: 0.55, spd: 1.1, pin: 6.5 },
  { id: 'duello', name: 'YETİ DÜELLOSU', unlock: 2400, intro: 'Yeti kaya atıyor: 3 kıl payı onu sersemletir.', plain: 1, dens: 0.6, duel: 1, len: 680 },
  { id: 'damar', name: 'ALTIN DAMAR', unlock: 0, intro: 'Engel yok: kar tanesi yağıyor!', plain: 1, bonus: 1 },
  { id: 'sis', name: 'SİS VADİSİ', unlock: 3000, intro: 'Görüş kısa: kenardaki ışıkları izle.', plain: 1, fog: 0.9, lights: 1 },
  { id: 'rampa', name: 'KAYAK RAMPALARI', unlock: 3600, intro: 'Art arda rampalar: havada kal, bonus kap.', set: 'skiJump', plain: 1 },
  { id: 'ruzgar', name: 'TERS RÜZGÂR', unlock: 4200, intro: 'Rüzgâr seni yana iter: şeridini tut.', plain: 1, wind: 0.9 },
  { id: 'yay', name: 'YAY TARLASI', unlock: 5000, intro: 'Yaylara bas, havadaki kar tanelerini topla.', plain: 1, pads: 0.9 },
  { id: 'kaydirak', name: 'BUZ KAYDIRAĞI', unlock: 6000, intro: 'Buzda hızlan: dönüşler genişler.', plain: 1, dens: 0.7, slide: 1 },
];
export const CHAPTER_BY_ID = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]));
export const CHAPTER_FIXED = ['yamac', 'orman', 'tunel', 'ray', 'cig', 'duello'];
export const BONUS_EVERY = 4;       // an ALTIN DAMAR interlude after every 4th chapter (it is not numbered)
export const BONUS_SECS = 10;
const ch1 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7 + 7.7) * 43758.5453; return x - Math.floor(x); };

/**
 * The chapter plan of one run. at(s) returns a shared segment { n, id, def, s0, s1, bonus, i } (n = chapter number, the bonus interlude keeps the number of the
 * chapter before it), extending the plan lazily; nothing is allocated per call once the segment exists. speedFn(s) sizes the 10 s bonus.
 * Types unlock by the best distance (or the distance the run has reached: a chapter that starts at s can use every type unlocked <= max(best, s)).
 */
export class ChapterPlan {
  constructor(seed = 1, best = 0, speedFn = () => 20) { this.seed = seed >>> 0; this.best = Math.max(0, +best || 0); this.speedFn = speedFn; this.segs = []; this._c = 0; this._n = 0; this._i = 0; }

  _pick(n, s0, prevId) {
    if (n <= CHAPTER_FIXED.length) return CHAPTER_FIXED[n - 1];
    const lim = Math.max(this.best, s0), pool = CHAPTERS.filter((c) => !c.bonus && c.id !== 'yamac' && c.id !== prevId && c.unlock <= lim);
    return pool[Math.floor(ch1(this.seed % 9973, n) * pool.length) % pool.length].id;
  }

  _grow() {
    const last = this.segs[this.segs.length - 1], s0 = last ? last.s1 : 0;
    let seg;
    if (last && !last.bonus && last.n % BONUS_EVERY === 0) {
      seg = { n: last.n, id: 'damar', def: CHAPTER_BY_ID.damar, s0, s1: s0 + Math.round(BONUS_SECS * this.speedFn(s0 + 60)), bonus: true, i: this.segs.length };
    } else {
      const n = last ? last.n + 1 : 1, prev = last ? this.segs[this.segs.length - (last.bonus ? 2 : 1)] : null;
      const id = this._pick(n, s0, prev ? prev.id : ''), def = CHAPTER_BY_ID[id];
      const len = def.len || (n <= 2 ? 600 : 500 + Math.floor(ch1(this.seed % 7919, n + 50) * 200));
      seg = { n, id, def, s0, s1: s0 + len, bonus: false, i: this.segs.length };
    }
    this.segs.push(seg);
  }

  at(s) {
    const S = this.segs;
    if (!S.length) this._grow();
    while (S[S.length - 1].s1 <= s) this._grow();
    let i = Math.min(this._i, S.length - 1);
    while (i > 0 && S[i].s0 > s) i--;
    while (S[i].s1 <= s) i++;
    this._i = i;
    return S[i];
  }
}

/** Chapter-end pay: coins and XP grow with the chapter number (capped); a clean chapter (no crash) pays double. */
export const chapterReward = (n, clean) => { const k = clean ? 2 : 1, m = Math.min(8, Math.max(1, n | 0)); return { coins: 30 * m * k, xp: (12 + 4 * m) * k }; };

/** "BÖLÜM 3 · BUZ TÜNELİ" (the en_menus catch-all ^BÖLÜM (\d+) would turn it into "LEVEL 3 · BUZ TÜNELİ": the word is picked here, the name goes through `tr`). */
export const chapterLine = (n, name, tr = (s) => s, en = false) => `${en ? 'CHAPTER' : 'BÖLÜM'} ${n} · ${tr(name)}`;

// ---------- permanent upgrade hooks (PLAN_V3 §8.2): small, and the score share they add is capped ----------
export const UP_SCORE_CAP = 0.25;                 // upgrades add at most 25% to the score multiplier
export const upStartSize = (lv) => 0.15 * Math.min(5, Math.max(0, lv | 0));        // tiers added at the start (0..0.75)
export const upMeltMul = (lv) => 1 - 0.06 * Math.min(5, Math.max(0, lv | 0));      // melt rate x (1 .. 0.7)
export const upMagnet = (lv) => 0.35 * Math.min(5, Math.max(0, lv | 0));           // metres added to an active magnet's radius
/** The multiplier with its upgrade part limited: never more than (1 + cap) x what the same play earns without any upgrade. */
export const capUpgradeMult = (full, base, cap = UP_SCORE_CAP) => Math.min(full, base * (1 + cap));
/** Character level 1..5 (passive strength steps 0..4). */
export const charStep = (lv) => Math.min(4, Math.max(0, (lv | 0) - 1));
