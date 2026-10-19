// Tiny sample bank for CIG! (CC0 one-shots in public/sfx, see public/sfx/CREDITS.txt).
//
// Companion to the procedural synth in audio.js: that module layers these samples on
// top of (or instead of) its oscillator sounds when they are available, and falls back
// to pure synthesis for anything that is missing.
//
//   sfx.load(ctx, destination, base)  fetch + decode every manifest file. Never throws,
//                                     resolves with the number of samples decoded.
//   sfx.has(name)                     true once `name` (or any variant name_N) decoded.
//   sfx.play(name, opts)              fire-and-forget one-shot; returns the source node
//                                     or null (missing / voice cap / error).
//
// Naming: a file called `snow_crunch_3` is variant 3 of the sound `snow_crunch`.
// play('snow_crunch') picks a random variant (never the same one twice in a row);
// play('snow_crunch_3') plays exactly that file. Files without a numeric suffix are
// single sounds.
//
// Robustness: every failure (404, no fetch, no Ogg Vorbis support in
// decodeAudioData - older iOS Safari - corrupt file...) just means "sample missing":
// nothing here ever rejects or throws, so the caller keeps its procedural fallback.

/**
 * [file (no extension), gain]. `gain` is a per-file loudness normalisation measured
 * offline (active-region RMS -> ~0.10, peak <= 0.95), so that audio.js can balance by
 * ear with one trim per use instead of per file.
 * The first and last entries double as the "can this device decode Ogg at all?" probes.
 */
const MANIFEST = [
  ['snow_crunch_1', 0.85], ['snow_crunch_2', 0.57], ['snow_crunch_3', 0.57], ['snow_crunch_4', 0.94], ['snow_crunch_5', 0.82],
  ['impact_soft_1', 0.54], ['impact_soft_2', 0.56], ['impact_soft_3', 0.51],
  ['hit_1', 1.25], ['hit_2', 1.16], ['hit_3', 0.86],
  ['crash_wood_1', 1.2], ['crash_wood_2', 1.16], ['crash_wood_3', 1.07],
  ['crash_glass_1', 1.68], ['crash_glass_2', 1],
  ['crash_rock_1', 1.25], ['crash_rock_2', 1.36],
  ['break_1', 1.44], ['break_2', 1.82], ['break_3', 1.25], ['break_4', 1.17],
  ['ui_click', 0.75], ['ui_select', 0.58], ['ui_confirm', 0.37], ['ui_back', 0.72], ['ui_toggle', 0.33],
  ['ui_tap', 0.6], ['ui_pick', 0.6], ['ui_ok', 0.55], ['ui_return', 0.55], ['ui_close', 0.55], ['ui_open', 0.55], ['ui_switch', 0.55], ['ui_nope', 0.5], ['ui_reward', 0.6],
  ['coin_1', 0.8], ['coin_2', 0.62],
  ['jingle_win', 0.55], ['jingle_lose', 0.59], ['jingle_milestone', 0.59], ['jingle_star', 0.77],
];

const MAX_VOICES = 12; // simultaneous sample voices (v1: 16)
const MIN_FADE = 0.004;
const SAME_GAP = 0.012; // s: the same sound started twice this close is one hit (two layers firing at once = louder + phasing)

/** @type {AudioContext|null} */ let ctx = null;
/** @type {AudioNode|null} */ let dest = null;
let loading = null; // the one load() promise
let serial = 0;
let active = 0;
const bank = Object.create(null); // name -> [{ buf, gain }]   (variants + the exact file name)
const lastPick = Object.create(null); // name -> index of the last variant played
const lastStart = Object.create(null); // name -> start time (ctx clock) of the last play
const slots = new Array(MAX_VOICES).fill(null); // live sources (no per-play bookkeeping allocations)

// ------------------------------------------------------------------- loading

const variantBase = (file) => {
  const m = /^(.*)_\d+$/.exec(file);
  return m ? m[1] : file;
};

function add(file, buf, gain) {
  const e = { buf, gain };
  (bank[file] || (bank[file] = [])).push(e);
  const base = variantBase(file);
  if (base !== file) (bank[base] || (bank[base] = [])).push(e);
}

/** decodeAudioData in both flavours (promise and legacy callbacks); resolves null on failure. */
function decode(c, data) {
  return new Promise((resolve) => {
    let done = false;
    const ok = (b) => { if (!done) { done = true; resolve(b || null); } };
    const bad = () => { if (!done) { done = true; resolve(null); } };
    try {
      const p = c.decodeAudioData(data, ok, bad);
      if (p && typeof p.then === 'function') p.then(ok, bad);
    } catch (e) { bad(); }
  });
}

/** Halve the memory: every sound is played mono through a phone speaker anyway. */
function toMono(c, b) {
  try {
    if (!b || b.numberOfChannels < 2) return b;
    const m = c.createBuffer(1, b.length, b.sampleRate);
    const o = m.getChannelData(0);
    const l = b.getChannelData(0);
    const r = b.getChannelData(1);
    for (let i = 0; i < o.length; i++) o[i] = (l[i] + r[i]) * 0.5;
    return m;
  } catch (e) { return b; }
}

async function run(c, destination, base) {
  if (!c || typeof c.decodeAudioData !== 'function' || typeof fetch !== 'function') return 0;
  ctx = c;
  dest = destination || c.destination;
  let ok = 0;
  const one = async (entry) => {
    try {
      const res = await fetch(base + entry[0] + '.ogg');
      if (!res || res.status >= 400) return false; // status 0 (file:// style schemes) is fine
      const buf = await decode(c, await res.arrayBuffer());
      if (!buf) return false;
      add(entry[0], toMono(c, buf), entry[1]);
      ok++;
      return true;
    } catch (e) { return false; }
  };
  // Probe two files first: if neither decodes (no Ogg support, files not shipped...) don't
  // bother fetching + decoding the rest.
  const probes = await Promise.all([one(MANIFEST[0]), one(MANIFEST[MANIFEST.length - 1])]);
  if (!probes[0] && !probes[1]) return 0;
  await Promise.all(MANIFEST.slice(1, -1).map(one));
  return ok;
}

// ------------------------------------------------------------------- playback

function onEnd() {
  this.onended = null;
  try { this.disconnect(); } catch (e) { /* ignore */ }
  const g = this._g;
  this._g = null;
  if (g) { try { g.disconnect(); } catch (e) { /* ignore */ } }
  if (slots[this._s] === this) { slots[this._s] = null; active--; }
}

/** Free a slot now: quick fade, then stop. The slot is reusable immediately. */
function steal(i) {
  const v = slots[i];
  slots[i] = null;
  active--;
  try {
    const t = ctx.currentTime;
    v._g.gain.cancelScheduledValues(t);
    v._g.gain.setTargetAtTime(0, t, MIN_FADE);
    v.stop(t + 0.03);
  } catch (e) { /* not started / already stopped */ }
}

const num = (x, d) => (typeof x === 'number' && x === x && x !== Infinity && x !== -Infinity ? x : d);

function play(name, o) {
  const list = bank[name];
  if (!list || !ctx || !dest) return null;

  const prio = o ? num(o.prio, 0) : 0;
  const when0 = o ? num(o.when, 0) : 0;
  const t0 = when0 > 0 ? when0 : ctx.currentTime;
  const ls = lastStart[name];
  if (ls !== undefined && t0 - ls >= 0 && t0 - ls < SAME_GAP) return null;
  lastStart[name] = t0;

  // find a slot; when full steal the oldest voice of the lowest priority (<= newcomer's)
  let s = -1;
  for (let i = 0; i < MAX_VOICES; i++) if (slots[i] === null) { s = i; break; }
  if (s < 0) {
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = slots[i];
      if (v._p <= prio && (s < 0 || v._p < slots[s]._p || (v._p === slots[s]._p && v._n < slots[s]._n))) s = i;
    }
    if (s < 0) return null; // everything alive outranks this sound
    steal(s);
  }

  // variant: random, but never the same file twice in a row
  const n = list.length;
  let k = 0;
  if (n > 1) {
    k = (Math.random() * n) | 0;
    if (k === lastPick[name]) k = (k + 1) % n;
    lastPick[name] = k;
  }
  const e = list[k];

  const vol = Math.max(0, num(o && o.volume, 1));
  const rate = Math.min(4, Math.max(0.1, num(o && o.rate, 1)));
  const det = num(o && o.detune, 0);
  const when = num(o && o.when, 0);
  const dur = num(o && o.dur, 0); // optional: cut the sample after `dur` seconds (with a short fade)

  const src = ctx.createBufferSource();
  src.buffer = e.buf;
  if (rate !== 1) src.playbackRate.value = rate;
  if (det !== 0) src.detune.value = det;
  const g = ctx.createGain();
  const level = vol * e.gain;
  g.gain.value = level;
  src.connect(g);
  g.connect(dest);

  src._g = g;
  src._s = s;
  src._p = prio;
  src._n = ++serial;
  src.onended = onEnd;
  slots[s] = src;
  active++;

  try {
    const t = when > 0 ? when : ctx.currentTime;
    src.start(t);
    if (dur > 0) {
      const f = Math.min(0.05, dur * 0.5);
      g.gain.setValueAtTime(level, t + dur - f);
      g.gain.linearRampToValueAtTime(0, t + dur);
      src.stop(t + dur + 0.005);
    }
  } catch (e) {
    onEnd.call(src); // never leak a slot
    return null;
  }
  return src;
}

// ----------------------------------------------------------------- public API

export const sfx = {
  /**
   * Fetch + decode every sample in the manifest into `ctx`; they play into `destination`
   * (default ctx.destination). Safe to call repeatedly (later calls return the first
   * promise). Resolves with the number of decoded samples (0 = everything missing).
   */
  load(c, destination, base = './sfx/') {
    if (!loading) loading = run(c, destination, base).catch(() => 0);
    return loading;
  },
  has(name) {
    const l = bank[name];
    return !!l && l.length > 0;
  },
  /**
   * opts: volume (1), rate (1, pitch+speed), detune (cents, 0), when (AudioContext time,
   * 0 = now), prio (0; higher survives the voice cap), dur (seconds, 0 = whole sample).
   * The opts object is only read during the call, so callers may reuse one.
   */
  play(name, o) {
    try { return play(name, o); } catch (e) { return null; }
  },
  /** Live sample voices (diagnostics). */
  active() { return active; },
};
