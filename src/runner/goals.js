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

/** Coins for crossing checkpoint number n (1 = first layer boundary). */
export const checkpointReward = (n, per = 25) => per * Math.min(Math.max(1, n), 8);

/** Seconds-between-boulders scale for the Yeti rage: 1 at the first one, faster every layer, floor 0.7. */
export const rageScale = (layer) => Math.max(0.7, Math.pow(0.93, Math.max(0, layer - 1)));

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
