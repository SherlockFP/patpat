// Procedural rhythm-music engine for the endless runner ("SONSUZ PARKUR").
// No audio files: everything is oscillators, FM, filtered noise and envelopes.
//
// Public API: `music` (bottom of file). Every method is a safe no-op when the
// AudioContext is missing / locked / muted and never throws.
//
// BEAT CLOCK (the important part for gameplay)
//   The beat model lives in the performance.now() time domain, so it keeps running
//   whether or not audio exists (muted, no AudioContext, autoplay-locked...). Tempo is
//   a piecewise-quadratic curve (linear BPM ramps), integrated in closed form, so
//   setBpm() never makes the beat jump. The scheduler maps model time -> audio time
//   with a drift-tracking offset (ctx.currentTime - performance.now()), and the
//   `beat` getter returns the beat that is being HEARD now, i.e. model(now - output
//   latency), where latency = ctx.baseLatency + ctx.outputLatency (slew-limited so
//   switching audio on/off never makes the clock go backwards).
//
// SCHEDULER
//   Classic lookahead: a 25 ms timer schedules 16th-note steps <= 0.12 s ahead on the
//   audio clock (grows temporarily if the main thread stalls). All musical state is a
//   pure function of the step index, so catching up after a stall just skips steps.

const LS_KEY = 'cig.music.muted';
const TICK_MS = 25;
const LOOKAHEAD = 0.12; // s
const LOOKAHEAD_MAX = 0.3; // s, only after the main thread was seen stalling
const START_LEAD = 0.08; // s between start() and beat 0
const BUS_LEVEL = 0.34; // v1 was 0.55: music sits under the sound effects
const NOTE_TRIM = 0.7; // pickup motif notes (heard hundreds of times a run) are trimmed
const NOTE_GAP = 0.06; // s: pickup notes are never closer than this (a magnet pulling ten flakes is not a buzz)
const DUCK_FREQ = 650;
const DUCK_VOL = 0.55;
const OPEN_FREQ = 7600; // v1 left the top end wide open (18 kHz): the open bus now rolls off above ~7.6 kHz, less fatiguing
const MIN_BPM = 60;
const MAX_BPM = 200;
const DEFAULT_BPM = 96;
const RAMP_BEATS = 8; // setBpm() ramps over 2 bars
const PHRASE_GAP = 2.2; // s without a pickup -> the next pickup restarts the motif

// Voice caps per priority tier (hats/arp < layers < core drums+bass < sfx).
const PR_HAT = 0, PR_LAYER = 1, PR_CORE = 2, PR_SFX = 3;
const CAPS_NORMAL = [14, 22, 30, 40];
const CAPS_LOW = [9, 15, 22, 32]; // navigator.hardwareConcurrency <= 4

// ------------------------------------------------------------------- utils

const rand = (a, b) => a + Math.random() * (b - a);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const perfSec = () => nowMs() / 1000;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function loadMuted() {
  try { return globalThis.localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; }
}
function saveMuted(m) {
  try { globalThis.localStorage.setItem(LS_KEY, m ? '1' : '0'); } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------- state

/** @type {AudioContext|null} */ let ctx = null;
let bus = null, lpF = null, stingG = null, duckG = null, muteG = null, comp = null;
let delayIn = null, delayN = null, distIn = null, whiteBuf = null;
let pulse25 = null, pulse12 = null;
let caps = CAPS_NORMAL;
let muted = loadMuted();
let ducked = false;
let paused = false; // suspend() in effect: clock frozen
let pausedAt = 0;
let graceUntil = 0; // ms: a resume() is in flight right after a gesture
let lastResumeTry = 0;

let started = false; // start() was called at least once
let running = false; // sequencer active
let stopped = false; // stop() froze the clock (revive can continue it)
let stopAt = 0;
let held = false; // death stinger: silence the music, keep the clock
let timer = 0;
let intensity = 0.5;
let baseBpm = DEFAULT_BPM;

// sequencer position
let nextStep = 0; // next unscheduled 16th step
let style = null; // current style object (set after STYLES is defined)
let styleId = 'snow';
let styleBar0 = 0; // bar index at which the current style began
let pendId = null; // style waiting for the next bar boundary
let pendBar = 0; // step index of that boundary (multiple of 16)
let riserBar = -1;
let accent = false;
let phraseIdx = 0;
let lastNoteAt = -1e9;

// ------------------------------------------------------------ beat model
// Time domain: performance.now()/1000. One live segment + the previous one (only
// used to evaluate times slightly before the live segment began, because the heard
// time lags the scheduling horizon).

function mkSeg(t0, b0, bpm0, bpm1, D) { return { t0, b0, bpm0, bpm1, D }; }
let seg = mkSeg(0, 0, DEFAULT_BPM, DEFAULT_BPM, 0);
let prevSeg = null;
let tStart = 0; // model time of beat 0

function segBeat(s, T) {
  const dt = T - s.t0;
  if (dt <= 0) return s.b0 + (s.bpm0 * dt) / 60;
  const D = s.D;
  if (D <= 0 || dt >= D) return s.b0 + (D * (s.bpm0 + s.bpm1) * 0.5 + s.bpm1 * (dt - D)) / 60;
  return s.b0 + (s.bpm0 * dt + ((s.bpm1 - s.bpm0) * dt * dt) / (2 * D)) / 60;
}
function segBpm(s, T) {
  const dt = T - s.t0;
  if (dt <= 0) return s.bpm0;
  if (s.D <= 0 || dt >= s.D) return s.bpm1;
  return s.bpm0 + ((s.bpm1 - s.bpm0) * dt) / s.D;
}
const beatAt = (T) => (prevSeg && T < seg.t0 ? segBeat(prevSeg, T) : segBeat(seg, T));
const bpmAtT = (T) => (prevSeg && T < seg.t0 ? segBpm(prevSeg, T) : segBpm(seg, T));

/** Inverse of beatAt for the live segment (closed form, numerically stable). */
function timeAtBeat(b) {
  const x = (b - seg.b0) * 60;
  if (x <= 0) return seg.t0 + x / seg.bpm0;
  const D = seg.D;
  const xe = D * (seg.bpm0 + seg.bpm1) * 0.5;
  if (D <= 0 || x >= xe) return seg.t0 + D + (x - xe) / seg.bpm1;
  const k = (seg.bpm1 - seg.bpm0) / D;
  return seg.t0 + (2 * x) / (seg.bpm0 + Math.sqrt(seg.bpm0 * seg.bpm0 + 2 * k * x));
}

function shiftModel(d) {
  seg.t0 += d;
  if (prevSeg) prevSeg.t0 += d;
  tStart += d;
}

// ------------------------------------------------- clock <-> audio mapping

let latApplied = 0, latT = 0;
let off = 0, offOk = false, offPs = 0; // ctx time = perf time + off
let lastBeat = 0, lastTime = 0;
let frozen = null; // {beat, bpm, time} while stopped / suspended

function latencyTarget() {
  if (!ctx || ctx.state !== 'running') return 0;
  let l = 0;
  const b = ctx.baseLatency, o = ctx.outputLatency;
  if (typeof b === 'number' && Number.isFinite(b)) l += b;
  l += typeof o === 'number' && Number.isFinite(o) && o > 0 ? o : 0.025;
  return clamp(l, 0, 0.3);
}

/** Slew-limited so the beat clock rate stays within [0.75, 1.25] when latency changes. */
function updateLat(ps) {
  const dt = clamp(ps - latT, 0, 0.5);
  latT = ps;
  const d = latencyTarget() - latApplied;
  const mx = 0.25 * dt;
  latApplied += d > mx ? mx : d < -mx ? -mx : d;
}

/**
 * Track ctx.currentTime - performance.now(). currentTime is a staircase that only ever
 * lags the truth, so rises are taken instantly (fresher sample) and falls slowly (clock
 * drift); a big drop means the context was suspended/restarted, so snap.
 */
function updateOff(ps) {
  if (!ctx || ctx.state !== 'running') { offOk = false; return; }
  const s = ctx.currentTime - ps;
  if (!offOk || s > off || s < off - 0.1) { off = s; offOk = true; offPs = ps; return; }
  off = Math.max(s, off - 0.0015 * Math.max(0, ps - offPs));
  offPs = ps;
}

function readBeat(out) {
  let beat = 0, bpm = baseBpm, time = 0;
  if (!started) {
    bpm = baseBpm;
  } else if (frozen) {
    beat = frozen.beat; bpm = frozen.bpm; time = frozen.time;
  } else {
    const ps = perfSec();
    updateLat(ps);
    const T = ps - latApplied;
    beat = beatAt(T);
    bpm = bpmAtT(T);
    time = T - tStart;
    if (!(beat > 0)) beat = 0;
    if (!(time > 0)) time = 0;
    if (beat < lastBeat) beat = lastBeat; else lastBeat = beat; // monotonic
    if (time < lastTime) time = lastTime; else lastTime = time;
  }
  out.beat = beat;
  out.phase = beat - Math.floor(beat);
  out.bpm = bpm;
  out.time = time;
  return out;
}

function freezeClock() {
  if (frozen || !started) return;
  frozen = readBeat({ beat: 0, phase: 0, bpm: 0, time: 0 });
}

// -------------------------------------------------------------- audio graph
// bus(0.55) -> lowpass(duck) -> stingG(death/revive fade) -> duckG -> muteG -> compressor -> out
// delay send  -> bus,  dist send (volcano) -> bus,  one-shot sfx -> muteG directly.

function gainN(value) {
  const g = ctx.createGain();
  g.gain.value = value === undefined ? 0 : value;
  return g;
}

function filtN(type, freq, q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q !== undefined) f.Q.value = q;
  return f;
}

function link() {
  for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
}

function normalizeRms(d, target) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
  const k = target / (Math.sqrt(sum / d.length) || 1);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

function build(c) {
  ctx = c;
  try {
    const hc = globalThis.navigator && globalThis.navigator.hardwareConcurrency;
    caps = hc && hc <= 4 ? CAPS_LOW : CAPS_NORMAL;
  } catch (e) { caps = CAPS_NORMAL; }
  bus = gainN(BUS_LEVEL);
  lpF = filtN('lowpass', Math.min(OPEN_FREQ, c.sampleRate * 0.45), 0.5);
  stingG = gainN(1);
  duckG = gainN(ducked ? DUCK_VOL : 1);
  muteG = gainN(muted ? 0 : 1);
  comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 18;
  comp.ratio.value = 5;
  comp.attack.value = 0.006;
  comp.release.value = 0.18;
  link(bus, lpF, stingG, duckG, muteG, comp, c.destination);
  if (ducked) lpF.frequency.value = DUCK_FREQ;
  // old iOS: a started silent buffer inside the gesture unlocks output
  try {
    const sb = c.createBuffer(1, 1, 22050);
    const ss = c.createBufferSource();
    ss.buffer = sb;
    ss.connect(c.destination);
    ss.start(0);
  } catch (e) { /* ignore */ }
  const b = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  normalizeRms(d, 0.3);
  whiteBuf = b;
}

/** Tempo-synced (dotted 8th) echo, created on first use. */
function getDelay() {
  if (delayIn) return delayIn;
  delayIn = gainN(1);
  delayN = ctx.createDelay(1.5);
  delayN.delayTime.value = 0.4;
  const fb = gainN(0.3);
  const tone = filtN('lowpass', 3200, 0.5);
  const wet = gainN(0.55);
  link(delayIn, delayN, tone, fb, delayN);
  link(tone, wet, bus);
  return delayIn;
}

/** Shared soft-clipper for the volcano's bass/chords (one WaveShaper for all voices). */
function getDist() {
  if (distIn) return distIn;
  distIn = gainN(1);
  const sh = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n), k = 5;
  const nrm = 1 / Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) * nrm;
  }
  sh.curve = curve;
  const post = filtN('lowpass', 2600, 0.6);
  const out = gainN(0.4);
  link(distIn, sh, post, out, bus);
  return distIn;
}

/** Pulse wave with duty d as a PeriodicWave (chiptune leads). */
function getPulse(d) {
  const cached = d === 0.25 ? pulse25 : pulse12;
  if (cached) return cached;
  const N = 40;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    re[n] = Math.sin(2 * Math.PI * n * d) / (n * Math.PI);
    im[n] = (1 - Math.cos(2 * Math.PI * n * d)) / (n * Math.PI);
  }
  const w = ctx.createPeriodicWave(re, im);
  if (d === 0.25) pulse25 = w; else pulse12 = w;
  return w;
}

// -------------------------------------------------------------- voice pool
// A voice = one logical note: a gain node (level + routing) and 1..n source nodes.

const voices = [];

function endVoice(v) {
  if (v.done) return;
  v.done = true;
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
  try { v.out.disconnect(); } catch (e) { /* ignore */ }
  if (v.send) { try { v.send.disconnect(); } catch (e) { /* ignore */ } }
}

function prune(now) {
  for (let i = voices.length - 1; i >= 0; i--) {
    if (voices[i].end < now - 0.25) endVoice(voices[i]); // safety net if `ended` never fired
  }
}

/** True when sounds may be scheduled right now (context usable, not muted). */
function ready() {
  if (!ctx || !muteG || muted) return false;
  const st = ctx.state;
  if (st === 'running') return true;
  if (st === 'closed') return false;
  if (nowMs() < graceUntil) return true; // resume() in flight right after a gesture
  const t = nowMs();
  if (!paused && t - lastResumeTry > 600) { // interrupted / autoplay-blocked: retry quietly
    lastResumeTry = t;
    resumeCtx(false);
  }
  return false;
}

function resumeCtx(grace) {
  if (!ctx) return;
  if (grace) graceUntil = nowMs() + 400;
  try {
    const p = ctx.resume();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* ignore */ }
}

/**
 * Open a voice. `dur` = total audible length incl. tail. `dest`: null = music bus,
 * 'dist' = shared distortion, 'sfx' = straight to the mute stage, or a node.
 * Returns null when muted / over the cap for this priority tier.
 */
function voice(prio, t, dur, level, dest, send) {
  if (!ctx || muted) return null;
  if (voices.length >= caps[prio]) {
    prune(ctx.currentTime);
    if (voices.length >= caps[prio]) return null;
  }
  const out = gainN(level);
  out.connect(dest === 'dist' ? getDist() : dest === 'sfx' ? muteG : dest || bus);
  const v = { out, send: null, end: t + dur + 0.05, prio, live: 0, done: false, nodes: [] };
  if (send) {
    v.send = gainN(send);
    link(out, v.send, getDelay());
  }
  voices.push(v);
  return v;
}

function track(v, node) {
  v.live++;
  v.nodes.push(node);
  node.onended = () => {
    try { node.disconnect(); } catch (e) { /* ignore */ }
    if (--v.live <= 0) endVoice(v);
  };
}

/** Fast fade + stop of every live voice (restart / mute). */
function killVoices() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = voices.length - 1; i >= 0; i--) {
    const v = voices[i];
    try {
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setTargetAtTime(0, t, 0.008);
      for (let k = 0; k < v.nodes.length; k++) {
        try { v.nodes[k].stop(t + 0.05); } catch (e) { /* not started */ }
      }
    } catch (e) { /* ignore */ }
  }
}

// ------------------------------------------------------------ node primitives

/** Percussive envelope: ~silence -> peak (linear attack) -> ~silence (exponential decay). */
function env(p, t, peak, atk, dec) {
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(Math.max(peak, 0.0002), t + atk);
  p.exponentialRampToValueAtTime(0.0001, t + atk + dec);
}

function sweep(p, t, f0, f1, d) {
  p.setValueAtTime(f0, t);
  p.exponentialRampToValueAtTime(f1, t + d);
}

function osc(v, type, freq, t, dur) {
  const o = ctx.createOscillator();
  if (type === 'pulse25') o.setPeriodicWave(getPulse(0.25));
  else if (type === 'pulse12') o.setPeriodicWave(getPulse(0.125));
  else o.type = type;
  o.frequency.value = freq;
  track(v, o);
  o.start(t);
  o.stop(t + dur);
  return o;
}

function noiseSrc(v, t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = whiteBuf;
  s.loop = true;
  track(v, s);
  s.start(t, rand(0, Math.max(0, whiteBuf.duration - 0.05)));
  s.stop(t + dur);
  return s;
}

/** Filtered noise burst: noise -> biquad (optional sweep f0->f1) -> percussive gain -> out. */
function nzHit(v, t, type, f0, f1, q, sweepT, peak, atk, dec) {
  const s = noiseSrc(v, t, atk + dec + 0.04);
  const f = filtN(type, f0, q);
  if (f1 && f1 !== f0) sweep(f.frequency, t, f0, f1, sweepT);
  const g = gainN();
  env(g.gain, t, peak, atk, dec);
  link(s, f, g, v.out);
}

/** Pitched blip: osc -> percussive gain -> out. f1 = optional glide target over sweepT. */
function toneHit(v, type, t, f0, f1, sweepT, peak, atk, dec) {
  const o = osc(v, type, f0, t, atk + dec + 0.03);
  if (f1 && f1 !== f0) sweep(o.frequency, t, f0, f1, sweepT);
  const g = gainN();
  env(g.gain, t, peak, atk, dec);
  link(o, g, v.out);
  return o;
}

// ------------------------------------------------------------- instruments
// Every instrument opens exactly one voice (so the voice cap really bounds the load)
// and is a no-op when muted / over the cap.

/**
 * Generic subtractive voice. freqs = one oscillator per entry, o.w = wave type(s) cycled,
 * o.det = cents cycled, o.lp / o.lpm = lowpass [f0, f1, sweepT, Q] (lpm: multiples of
 * freqs[0]), ADSR-ish via atk/dec/sus/rel, o.bend = [startRatio, time] (pick twang),
 * o.vib = [Hz, cents, delay], o.sub = extra sine one octave down at that level.
 */
function synth(t, freqs, dur, o, vel) {
  const rel = o.rel === undefined ? 0.06 : o.rel;
  const atk = o.atk === undefined ? 0.004 : o.atk;
  const v = voice(
    o.prio === undefined ? PR_LAYER : o.prio, t, dur + rel * 2 + 0.06,
    (o.level || 0.2) * vel, o.dest, o.send,
  );
  if (!v) return null;
  const n = freqs.length;
  const pk = 1 / Math.sqrt(n + (o.sub ? 0.5 : 0));
  const tr = t + Math.max(dur, atk + 0.012);
  const total = tr - t + rel * 2 + 0.03;
  const g = gainN();
  const p = g.gain;
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(pk, t + atk);
  if (o.dec) {
    const te = Math.min(tr, t + atk + o.dec);
    p.exponentialRampToValueAtTime(Math.max(pk * (o.sus === undefined ? 0 : o.sus), 0.0001), te);
  }
  p.setTargetAtTime(0.0001, tr, rel / 3);
  let inp = g;
  if (o.lp || o.lpm) {
    let f0, f1, tc, q;
    if (o.lpm) {
      f0 = Math.min(14000, freqs[0] * o.lpm[0]);
      f1 = Math.min(14000, freqs[0] * o.lpm[1]);
      tc = o.lpm[2]; q = o.lpm[3];
    } else {
      f0 = o.lp[0]; f1 = o.lp[1]; tc = o.lp[2]; q = o.lp[3];
    }
    const f = filtN('lowpass', f0, q);
    if (f1 !== f0) sweep(f.frequency, t, f0, f1, tc);
    f.connect(g);
    inp = f;
  }
  let lfoG = null;
  if (o.vib) {
    const lfo = osc(v, 'sine', o.vib[0], t, total);
    lfoG = gainN();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(o.vib[1], t + o.vib[2] + 0.2);
    lfo.connect(lfoG);
  }
  for (let i = 0; i < n; i++) {
    const type = Array.isArray(o.w) ? o.w[i % o.w.length] : o.w;
    const f = freqs[i];
    const so = osc(v, type, f, t, total);
    if (o.det) so.detune.value = o.det[i % o.det.length];
    if (o.bend) sweep(so.frequency, t, f * o.bend[0], f, o.bend[1]);
    if (lfoG) lfoG.connect(so.detune);
    so.connect(inp);
  }
  if (o.sub) {
    const so = osc(v, 'sine', freqs[0] * 0.5, t, total);
    const sg = gainN(o.sub);
    link(so, sg, g);
  }
  g.connect(v.out);
  return v;
}

const OPT = {
  bassSoft: { w: ['triangle', 'sine'], lp: [1100, 450, 0.18, 0.7], atk: 0.008, dec: 0.28, sus: 0.5, rel: 0.06, level: 0.55, prio: PR_CORE },
  bassPop: { w: ['sawtooth', 'square'], lp: [2600, 500, 0.09, 1.2], atk: 0.003, dec: 0.16, sus: 0.35, rel: 0.04, level: 0.45, sub: 0.5, prio: PR_CORE },
  bassChip: { w: ['triangle', 'square'], atk: 0.002, dec: 0.1, sus: 0.6, rel: 0.03, level: 0.3, prio: PR_CORE },
  bassNeon: { w: ['sawtooth'], det: [-8, 8], lp: [3200, 700, 0.1, 2], atk: 0.004, dec: 0.15, sus: 0.55, rel: 0.05, level: 0.42, sub: 0.6, prio: PR_CORE },
  bassDist: { w: ['sawtooth', 'square'], lp: [1800, 900, 0.1, 1.5], atk: 0.004, dec: 0.12, sus: 0.7, rel: 0.04, level: 0.55, dest: 'dist', prio: PR_CORE },
  bassSaz: { w: ['sawtooth', 'sine'], lp: [1500, 600, 0.15, 0.9], atk: 0.005, dec: 0.3, sus: 0.45, rel: 0.06, level: 0.5, sub: 0.4, prio: PR_CORE },
  padSoft: { w: ['triangle', 'triangle', 'sine'], det: [-5, 5, 0], lp: [1800, 1800, 0.1, 0.5], atk: 0.07, rel: 0.35, level: 0.22 },
  stabPop: { w: ['sawtooth'], det: [-6, 0, 6], lp: [3500, 1100, 0.12, 0.9], atk: 0.004, dec: 0.12, sus: 0.35, rel: 0.06, level: 0.22 },
  stabNeon: { w: ['sawtooth'], det: [-9, 0, 9], lp: [2600, 900, 0.08, 1.2], atk: 0.006, dec: 0.1, sus: 0.6, rel: 0.04, level: 0.2 },
  stabDist: { w: ['sawtooth', 'sawtooth', 'square'], lp: [2000, 1000, 0.1, 1], atk: 0.004, dec: 0.2, sus: 0.5, rel: 0.05, level: 0.32, dest: 'dist' },
  pluckPop: { w: ['sawtooth', 'square'], det: [0, 5], lpm: [8, 2.5, 0.09, 1.3], atk: 0.002, dec: 0.22, sus: 0.25, rel: 0.06, level: 0.24, send: 0.25 },
  pulse25: { w: ['pulse25'], atk: 0.002, dec: 0.08, sus: 0.55, rel: 0.04, level: 0.17 },
  pulse12: { w: ['pulse12'], atk: 0.002, dec: 0.06, sus: 0.5, rel: 0.04, level: 0.14, prio: PR_HAT },
  sawLead: { w: ['sawtooth'], det: [-7, 7], lpm: [6, 3, 0.25, 1.2], atk: 0.01, dec: 0.3, sus: 0.6, rel: 0.12, level: 0.22, vib: [5.2, 14, 0.25], send: 0.3 },
  arpNeon: { w: ['sawtooth'], lpm: [9, 2.2, 0.07, 2], atk: 0.002, dec: 0.14, sus: 0.1, rel: 0.04, level: 0.16, send: 0.3, prio: PR_HAT },
  arpPop: { w: ['sawtooth', 'square'], det: [0, 5], lpm: [6, 2, 0.08, 1.2], atk: 0.002, dec: 0.16, sus: 0.15, rel: 0.05, level: 0.15, send: 0.2, prio: PR_HAT },
  arpDark: { w: ['sawtooth', 'triangle'], lpm: [5, 1.6, 0.1, 1.5], atk: 0.002, dec: 0.16, sus: 0.1, rel: 0.05, level: 0.17, prio: PR_HAT },
  leadDist: { w: ['sawtooth', 'square'], det: [0, 6], lpm: [4, 2, 0.2, 1.5], atk: 0.006, dec: 0.25, sus: 0.55, rel: 0.08, level: 0.22 },
  saz: { w: ['sawtooth', 'sawtooth', 'triangle'], det: [0, 9, 0], lpm: [10, 2.4, 0.22, 1.8], atk: 0.002, dec: 0.45, sus: 0.12, rel: 0.1, level: 0.27, bend: [1.035, 0.035], send: 0.2 },
  sazArp: { w: ['sawtooth', 'sawtooth', 'triangle'], det: [0, 9, 0], lpm: [9, 2.2, 0.15, 1.6], atk: 0.002, dec: 0.28, sus: 0.1, rel: 0.06, level: 0.17, bend: [1.03, 0.03], send: 0.15, prio: PR_HAT },
  noteSaz: { w: ['sawtooth', 'sawtooth', 'triangle'], det: [0, 9, 0], lpm: [14, 3, 0.3, 2], atk: 0.002, dec: 0.5, sus: 0.14, rel: 0.12, level: 0.62, bend: [0.97, 0.045], send: 0.3, prio: PR_SFX },
  notePop: { w: ['sawtooth', 'square'], det: [0, 5], lpm: [12, 2.8, 0.1, 1.4], atk: 0.002, dec: 0.26, sus: 0.2, rel: 0.06, level: 0.56, send: 0.3, prio: PR_SFX },
  noteChip: { w: ['pulse12'], atk: 0.002, dec: 0.12, sus: 0.3, rel: 0.04, level: 0.42, bend: [0.96, 0.03], send: 0.15, prio: PR_SFX },
  noteNeon: { w: ['sawtooth'], det: [-7, 7], lpm: [14, 3, 0.1, 2], atk: 0.002, dec: 0.3, sus: 0.15, rel: 0.1, level: 0.52, send: 0.5, prio: PR_SFX },
  noteMetal: { w: ['sawtooth', 'square'], det: [0, 6], lpm: [10, 2, 0.12, 1.8], atk: 0.002, dec: 0.3, sus: 0.1, rel: 0.08, level: 0.52, send: 0.2, prio: PR_SFX },
  padPortal: { w: ['triangle', 'triangle', 'sine'], det: [-6, 6, 0], lp: [600, 3200, 0.8, 0.7], atk: 0.5, rel: 0.6, level: 0.28, send: 0.4, prio: PR_SFX },
};

/** note-number -> synth wrappers */
function mkNote(opt, mult, fixedDur) {
  const ms = mult || [1];
  return (t, m, vel, dur) => {
    const f = mtof(m);
    synth(t, ms.map((x) => f * x), fixedDur || dur, opt, vel);
  };
}
function mkChord(opt) {
  return (t, ms, vel, dur) => { synth(t, ms.map(mtof), dur, opt, vel); };
}

// ---- bells (FM) and mallets

const BELL = {
  note: { ratio: 3.5, idx: 2.4, dec: 0.85, level: 0.62, top: 0.3, topR: 2, send: 0.5, prio: PR_SFX },
  arp: { ratio: 3.5, idx: 1.4, dec: 0.5, level: 0.17, send: 0.3, prio: PR_HAT },
  lead: { ratio: 3.5, idx: 2, dec: 0.8, level: 0.24, send: 0.4 },
  portal: { ratio: 3.01, idx: 2.2, dec: 1.4, level: 0.34, top: 0.2, topR: 2, send: 0.5, prio: PR_SFX },
  chime: { ratio: 4.1, idx: 2.8, dec: 1.1, level: 0.4, top: 0.3, topR: 3, send: 0.55, prio: PR_SFX },
};

function bell(t, f, vel, p) {
  const v = voice(p.prio === undefined ? PR_LAYER : p.prio, t, p.dec + 0.2, p.level * vel, null, p.send);
  if (!v) return;
  const dur = p.dec + 0.1;
  const c = osc(v, 'sine', f, t, dur);
  const m = osc(v, 'sine', f * p.ratio, t, dur);
  const mg = gainN();
  const depth = f * p.idx;
  mg.gain.setValueAtTime(depth, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(depth * 0.03, 0.01), t + p.dec * 0.5);
  link(m, mg);
  mg.connect(c.frequency);
  const g = gainN();
  env(g.gain, t, 1, p.atk || 0.002, p.dec);
  link(c, g, v.out);
  if (p.top) toneHit(v, 'sine', t, f * p.topR, 0, 0, p.top, 0.001, 0.14);
}

const MAL = {
  note: { dec: 0.55, h: 4, hl: 0.4, hd: 0.07, level: 0.68, send: 0.25, prio: PR_SFX },
  arp: { dec: 0.32, h: 4, hl: 0.3, hd: 0.05, level: 0.24, prio: PR_HAT },
  lead: { dec: 0.7, h: 5.4, hl: 0.28, hd: 0.14, level: 0.3, send: 0.3 },
};

function mallet(t, f, vel, p) {
  const dec = p.dec * clamp(700 / f, 0.5, 1.5);
  const v = voice(p.prio === undefined ? PR_LAYER : p.prio, t, dec + 0.15, p.level * vel, null, p.send);
  if (!v) return;
  toneHit(v, 'sine', t, f, 0, 0, 1, 0.0012, dec);
  toneHit(v, 'sine', t, f * p.h, 0, 0, p.hl, 0.001, p.hd);
  toneHit(v, 'triangle', t, f * 0.5, 0, 0, 0.18, 0.001, dec * 0.5); // warm body
}

// ---- drums

function kick(t, vel, p) {
  const v = voice(PR_CORE, t, p.dec + 0.12, 1, null);
  if (!v) return;
  const o = osc(v, p.w || 'sine', p.f0, t, p.dec + 0.06);
  sweep(o.frequency, t, p.f0, p.f1, p.sw);
  const g = gainN();
  env(g.gain, t, p.amp * vel, 0.002, p.dec);
  link(o, g, v.out);
  if (p.click) toneHit(v, 'triangle', t, p.cf || 1400, 300, 0.012, p.click * vel, 0.001, 0.02);
  if (p.mid) toneHit(v, 'triangle', t, p.f0 * 1.6, p.f1 * 2.2, p.sw, p.mid * vel, 0.002, p.dec * 0.35);
}
const K_SOFT = { f0: 140, f1: 52, sw: 0.09, dec: 0.3, amp: 0.8, click: 0.15, mid: 0.25 };
const K_PUNCH = { f0: 190, f1: 55, sw: 0.065, dec: 0.26, amp: 0.9, click: 0.4, mid: 0.3 };
const K_HEAVY = { f0: 170, f1: 42, sw: 0.12, dec: 0.5, amp: 0.95, click: 0.4, mid: 0.35 };
const K_CHIP = { w: 'triangle', f0: 230, f1: 48, sw: 0.05, dec: 0.14, amp: 0.85, click: 0.1 };
const K_NEON = { f0: 200, f1: 50, sw: 0.08, dec: 0.36, amp: 0.9, click: 0.45, mid: 0.3 };
const K_WOOD = { w: 'triangle', f0: 125, f1: 68, sw: 0.07, dec: 0.2, amp: 0.75, click: 0.2, cf: 900 };

function snare(t, vel, p) {
  const v = voice(PR_CORE, t, p.dec + 0.12, 1, null);
  if (!v) return;
  nzHit(v, t, 'bandpass', p.f, p.f * 0.8, p.q, p.dec, p.amp * vel, 0.001, p.dec);
  if (p.body) toneHit(v, 'triangle', t, p.tone, p.tone * 0.65, 0.07, p.body * vel, 0.001, 0.09);
  if (p.hp) nzHit(v, t, 'highpass', p.hp, 0, 0.7, 0, p.hpAmp * vel, 0.001, p.dec * 0.5);
}
const SN_SOFT = { f: 2200, q: 0.7, dec: 0.14, amp: 0.6, body: 0.15, tone: 200 };
const SN_SNAP = { f: 2000, q: 0.8, dec: 0.16, amp: 1.0, body: 0.3, tone: 210, hp: 4500, hpAmp: 0.25 };
const SN_CHIP = { f: 3500, q: 0.5, dec: 0.09, amp: 0.7 };
const SN_GATE = { f: 1700, q: 0.6, dec: 0.3, amp: 0.9, body: 0.25, tone: 190 };
const SN_HEAVY = { f: 1600, q: 0.6, dec: 0.26, amp: 1.1, body: 0.5, tone: 165, hp: 3500, hpAmp: 0.2 };

function clap(t, vel) {
  const v = voice(PR_CORE, t, 0.3, 1, null);
  if (!v) return;
  const s = noiseSrc(v, t, 0.26);
  const f = filtN('bandpass', 1500, 1.2);
  const g = gainN();
  const pk = 1.1 * vel;
  g.gain.setValueAtTime(0.0001, t);
  for (let k = 0; k < 3; k++) {
    const tk = t + k * 0.011;
    g.gain.linearRampToValueAtTime(pk * (0.6 + 0.2 * k), tk + 0.001);
    g.gain.exponentialRampToValueAtTime(pk * 0.08, tk + 0.0095);
  }
  g.gain.linearRampToValueAtTime(pk, t + 0.0345);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.0345 + 0.15);
  link(s, f, g, v.out);
}

function hat(t, vel, open, f, amp) {
  const v = voice(PR_HAT, t, open ? 0.3 : 0.1, 1, null);
  if (!v) return;
  nzHit(v, t, 'highpass', f, 0, 0.7, 0, amp * vel, 0.0008, open ? 0.2 : 0.035);
}

function shaker(t, vel) {
  const v = voice(PR_HAT, t, 0.12, 1, null);
  if (!v) return;
  nzHit(v, t, 'bandpass', 5500, 0, 0.9, 0, 0.55 * vel, 0.012, 0.05);
}

function wood(t, vel, f, dec, amp) {
  const v = voice(PR_HAT, t, dec + 0.1, 1, null);
  if (!v) return;
  toneHit(v, 'sine', t, f * 1.08, f, 0.01, amp * vel, 0.0008, dec);
  toneHit(v, 'triangle', t, f * 2.3, 0, 0, amp * 0.35 * vel, 0.0008, dec * 0.4);
}

function tom(t, vel, f) {
  const v = voice(PR_CORE, t, 0.5, 1, null);
  if (!v) return;
  toneHit(v, 'sine', t, f * 1.5, f, 0.07, 0.85 * vel, 0.002, 0.34);
  toneHit(v, 'triangle', t, f * 2.4, f * 1.4, 0.06, 0.3 * vel, 0.002, 0.1);
  nzHit(v, t, 'lowpass', 700, 300, 0.7, 0.05, 0.4 * vel, 0.001, 0.05);
}

/** darbuka: dum = low skin thump, tek = sharp rim slap, ka = light finger tap */
function dum(t, vel) {
  const v = voice(PR_CORE, t, 0.4, 1, null);
  if (!v) return;
  toneHit(v, 'sine', t, 200, 98, 0.07, 0.9 * vel, 0.002, 0.26);
  toneHit(v, 'triangle', t, 380, 190, 0.05, 0.3 * vel, 0.002, 0.07);
  nzHit(v, t, 'lowpass', 600, 250, 0.7, 0.05, 0.3 * vel, 0.001, 0.04);
}
function tek(t, vel) {
  const v = voice(PR_CORE, t, 0.22, 1, null);
  if (!v) return;
  nzHit(v, t, 'highpass', 2800, 0, 0.8, 0, 0.95 * vel, 0.0008, 0.07);
  toneHit(v, 'sine', t, 1500, 950, 0.03, 0.24 * vel, 0.0008, 0.08);
}
function ka(t, vel) {
  const v = voice(PR_HAT, t, 0.15, 1, null);
  if (!v) return;
  nzHit(v, t, 'bandpass', 4600, 0, 1.0, 0, 0.6 * vel, 0.0008, 0.035);
  toneHit(v, 'sine', t, 1900, 1500, 0.02, 0.12 * vel, 0.0008, 0.04);
}

function crash(t, vel) {
  const v = voice(PR_CORE, t, 1.3, 1, null);
  if (!v) return;
  nzHit(v, t, 'highpass', 4200, 0, 0.7, 0, 0.4 * vel, 0.004, 0.9);
  nzHit(v, t, 'bandpass', 6200, 0, 2, 0, 0.25 * vel, 0.004, 0.5);
}

/** Noise + tonal riser used in the bar before a style switch. */
function riser(t, dur) {
  dur = Math.max(dur, 0.15);
  const v = voice(PR_SFX, t, dur + 0.2, 0.6, null);
  if (!v) return;
  const s = noiseSrc(v, t, dur + 0.1);
  const f = filtN('bandpass', 400, 1.2);
  sweep(f.frequency, t, 400, 5200, dur);
  const g = gainN();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + dur);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.04);
  link(s, f, g, v.out);
  const o = osc(v, 'triangle', 220, t, dur + 0.1);
  sweep(o.frequency, t, 220, 1760, dur);
  const og = gainN();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.linearRampToValueAtTime(0.18, t + dur);
  og.gain.linearRampToValueAtTime(0.0001, t + dur + 0.04);
  link(o, og, v.out);
}

// ---- per-style instrument bindings (drums take (t, vel); tonal take (t, midi, vel, dur))

const kickSoft = (t, v) => kick(t, v, K_SOFT);
const kickPunch = (t, v) => kick(t, v, K_PUNCH);
const kickHeavy = (t, v) => kick(t, v, K_HEAVY);
const kickChip = (t, v) => kick(t, v, K_CHIP);
const kickNeon = (t, v) => kick(t, v, K_NEON);
const kickWood = (t, v) => kick(t, v, K_WOOD);
const snareSoft = (t, v) => snare(t, v, SN_SOFT);
const snareSnap = (t, v) => snare(t, v, SN_SNAP);
const snareChip = (t, v) => snare(t, v, SN_CHIP);
const snareGate = (t, v) => snare(t, v, SN_GATE);
const snareHeavy = (t, v) => snare(t, v, SN_HEAVY);
const hatClosed = (t, v) => hat(t, v, false, 5200, 0.36);
const hatChip = (t, v) => hat(t, v, false, 4200, 0.34);
const hatOpen = (t, v) => hat(t, v, true, 4800, 0.32);
const woodHi = (t, v) => wood(t, v, 1250, 0.05, 0.5);
const woodLo = (t, v) => wood(t, v, 420, 0.09, 0.7);
const tomHigh = (t, v) => tom(t, v, 175);
const tomMid = (t, v) => tom(t, v, 128);
const tomLow = (t, v) => tom(t, v, 92);

const bassSoft = mkNote(OPT.bassSoft, [1, 2]);
const bassPop = mkNote(OPT.bassPop, [1, 1]);
const bassChip = mkNote(OPT.bassChip, [1, 1]);
const bassNeon = mkNote(OPT.bassNeon, [1, 1]);
const bassDist = mkNote(OPT.bassDist, [1, 2]); // saw + square an octave up: stays audible on phone speakers
const bassSaz = mkNote(OPT.bassSaz, [1, 1]);

const chordPad = mkChord(OPT.padSoft);
const chordPop = mkChord(OPT.stabPop);
const chordNeon = mkChord(OPT.stabNeon);
const chordDist = mkChord(OPT.stabDist);
/** saz strum: 3 plucks 14 ms apart */
const chordSaz = (t, ms, vel, dur) => {
  for (let i = 0; i < ms.length; i++) {
    const f = mtof(ms[i]);
    synth(t + i * 0.014, [f, f, f * 2], dur, OPT.sazArp, vel * 0.9);
  }
};

const arpBell = (t, m, vel) => bell(t, mtof(m), vel, BELL.arp);
const arpMallet = (t, m, vel) => mallet(t, mtof(m), vel, MAL.arp);
const arpPop = mkNote(OPT.arpPop, [1, 1]);
const arpChip = mkNote(OPT.pulse12, [1]);
const arpNeon = mkNote(OPT.arpNeon, [1]);
const arpDark = mkNote(OPT.arpDark, [1, 1]);
const arpSaz = mkNote(OPT.sazArp, [1, 1, 2]);

const leadBell = (t, m, vel) => bell(t, mtof(m), vel, BELL.lead);
const leadMallet = (t, m, vel) => mallet(t, mtof(m), vel, MAL.lead);
const leadPop = mkNote(OPT.pluckPop, [1, 1]);
const leadChip = mkNote(OPT.pulse25, [1]);
const leadNeon = mkNote(OPT.sawLead, [1, 1]);
const leadDist = mkNote(OPT.leadDist, [1, 1]);
const leadSaz = mkNote(OPT.saz, [1, 1, 2]);

const noteBell = (t, m, vel) => bell(t, mtof(m), vel, BELL.note);
const noteMallet = (t, m, vel) => mallet(t, mtof(m), vel, MAL.note);
const notePop = mkNote(OPT.notePop, [1, 1], 0.26);
const noteChip = mkNote(OPT.noteChip, [1], 0.16);
const noteNeon = mkNote(OPT.noteNeon, [1, 1], 0.3);
const noteMetal = mkNote(OPT.noteMetal, [1, 1], 0.3);
const noteSaz = mkNote(OPT.noteSaz, [1, 1, 2], 0.5);

// ------------------------------------------------------------------ styles
// Patterns are 16-char bars (one char per 16th step), arrays = one entry per bar,
// cycling (the chord progression is 4 bars, so 4-entry arrays follow it).
//   drums : x = hit, X = accent, o = ghost, . = rest
//   bass  : 1 root, 3 chord third, 5 fifth, 7 b7, 8 octave
//   arp   : digit = chord-tone index (3 = root+12 ...)   [arpMode 'scale': scale degree]
//   lead  : hex digit = scale degree from lead0, '-' = hold the previous note
// Chord `r` = bass offset from `root` (chosen so bass notes stay in a phone-friendly
// range), `t` = intervals above the chord root. Voicings are folded into a window
// (`cLo` / `aLo`) for smooth voice leading, or stacked from `cBase` when not folded.

const M = [0, 4, 7], m = [0, 3, 7], P5 = [0, 7, 12];

const STYLES = {
  // Bright major pentatonic, glock/bell plucks, soft kick, shaker. (C)
  snow: {
    root: 48, scale: [0, 2, 4, 7, 9], fit: true, swing: 0,
    chords: [{ r: 0, t: M }, { r: -3, t: m }, { r: 5, t: M }, { r: -5, t: M }],
    kick: ['X...x...x...x...', 'x...x...x...x...', 'X...x...x...x...', 'x...x...x...x.x.'], kickF: kickSoft,
    bass: ['1.....8.1.....5.', '1.....8.1.....5.', '1.....8.1.....5.', '1.....8.1...5.8.'], bassF: bassSoft,
    perc: [{ f: shaker, p: ['.oxo.oxo.oxo.oxo'] }, { f: snareSoft, p: ['....x.......x...'] }],
    cLo: 60, chordP: ['x.......x.......'], chordF: chordPad, chordDur: 7,
    aLo: 60, arpP: ['0.1.2.1.0.1.2.1.', '0.1.2.1.0.1.2.3.'], arpF: arpBell, arpDur: 2,
    lead0: 72, lead: ['2...3...5...3.2.', '4...5...4...2.3.', '4...5...6...5.4.', '3...6...8...6.3.'], leadF: leadBell,
    note0: 84, motif: [0, 2, 4, 7, 9, 7, 4, 2, 4, 7, 9, 12, 14, 12, 9, 7], noteF: noteBell,
    fillF: snareSoft,
  },

  // Warm marimba/kalimba, woody percussion. (G)
  forest: {
    root: 43, scale: [0, 2, 4, 7, 9], fit: true, swing: 0.1,
    chords: [{ r: 0, t: M }, { r: 5, t: M }, { r: 9, t: m }, { r: 7, t: M }],
    kick: ['X.....x.x.......', 'x.....x.x.......', 'X.....x.x.......', 'x.....x.x.....x.'], kickF: kickWood,
    bass: ['1.....5.1...5...', '1.....5.1...5...', '1.....5.1...5...', '1.....5.1.....8.'], bassF: bassSoft,
    perc: [
      { f: woodHi, p: ['..x...x...x...x.'] },
      { f: woodLo, p: ['....x.......x...'] },
      { f: shaker, p: ['o.o.o.o.o.o.o.o.'] },
    ],
    cLo: 55, chordP: ['x.......x.......'], chordF: chordPad, chordDur: 7,
    aLo: 62, arpP: ['0.1.2.1.2.1.0.1.', '0.1.2.1.2.1.0.2.'], arpF: arpMallet, arpDur: 2,
    lead0: 67, lead: ['0...2...3...2.0.', '4...5...4...3.2.', '4...5...7...5.4.', '3...6...5...3.1.'], leadF: leadMallet,
    note0: 79, motif: [0, 4, 7, 4, 9, 7, 4, 2, 0, 4, 7, 9, 12, 9, 7, 4], noteF: noteMallet,
    fillF: woodLo,
  },

  // Upbeat pop: punchy kick/clap, plucky synth bass, offbeat chord stabs. (A)
  town: {
    root: 45, scale: [0, 2, 4, 7, 9], fit: true, swing: 0,
    chords: [{ r: 0, t: M }, { r: 7, t: M }, { r: 9, t: m }, { r: 5, t: M }],
    kick: ['X...x...x...x...', 'x...x...x...x...', 'X...x...x...x...', 'x...x...x..xx...'], kickF: kickPunch,
    bass: ['1.8.1.8.1.8.1.5.', '1.8.1.8.1.8.1.5.', '1.8.1.8.1.8.1.5.', '1.8.1.8.1.8.5.8.'], bassF: bassPop,
    perc: [
      { f: clap, p: ['....x.......x...'] },
      { f: hatClosed, p: ['..x...x...x...x.'] },
      { f: hatClosed, p: ['.o.o.o.o.o.o.o.o'] },
    ],
    cLo: 57, chordP: ['..x...x...x...x.'], chordF: chordPop, chordDur: 1.6,
    aLo: 61, arpP: ['0..1..2..1..2.1.'], arpF: arpPop, arpDur: 1.5,
    lead0: 69, lead: ['3..3..4.3..2.0..', '4..4..3.4..3.1..', '4..4..5.4..2.4..', '4..4..5.3..4.0..'], leadF: leadPop,
    note0: 81, motif: [4, 4, 7, 9, 12, 9, 7, 4, 2, 4, 7, 9, 14, 12, 9, 7], noteF: notePop,
    fillF: clap,
  },

  // TURKISH: Hicaz makami on D (D Eb F# G A Bb C), darbuka maqsum (dum-tek) with ka rolls,
  // saz-like plucked lead with a pitch twang. Chords are open fifths (modal, no thirds).
  desert: {
    root: 50, scale: [0, 1, 4, 5, 7, 8, 10], fit: false, swing: 0,
    chords: [{ r: 0, t: P5 }, { r: 5, t: P5 }, { r: 1, t: P5 }, { r: 0, t: P5 }],
    kick: ['X.......x.......', 'X.......x.x.....', 'X.......x.......', 'X.......x.....x.'], kickF: dum,
    bass: ['1...1...1...1...', '1...1...1.5.1...', '1...1...1...1...', '1...1...1.5.1.5.'], bassF: bassSaz,
    perc: [
      { f: tek, p: ['..x...x.....x...'] },
      { f: ka, p: ['.o..o.....o..o.o', '.o..o.....o..o..', '.o..o.....o..o.o', '.o..o.....o.oooo'] },
    ],
    cBase: 62, chordP: ['x.......x.......', 'x.......x.......', 'x.......x.......', 'x.......x.....x.'], chordF: chordSaz, chordDur: 6,
    arpMode: 'scale', arp0: 74, arpP: ['0.1.2.1.0.1.2.3.', '3.4.5.4.3.4.5.7.', '1.3.5.3.1.3.5.6.', '0.1.2.1.0.1.2.4.'], arpF: arpSaz, arpDur: 1.5,
    lead0: 62, lead: ['4.4.5.4.2.1.0.1.', '2.2.3.2.1.0.1.2.', '5.5.6.5.3.1.3.5.', '4.5.4.2.1.0-----'], leadF: leadSaz,
    note0: 74, motif: [0, 1, 4, 5, 7, 8, 7, 5, 4, 5, 4, 1, 0, 1, 4, 7], noteF: noteSaz,
    fillF: tek,
  },

  // Chiptune: pulse leads, noise hats, bouncy (swung) octave bass. (E)
  candy: {
    root: 52, scale: [0, 2, 4, 5, 7, 9, 11], fit: true, swing: 0.14,
    chords: [{ r: 0, t: M }, { r: -5, t: M }, { r: -3, t: m }, { r: 5, t: M }],
    kick: ['X...x...x...x...', 'x...x...x...x...', 'X...x...x...x...', 'x...x...x..xx.x.'], kickF: kickChip,
    bass: ['1.8.1.8.1.8.1.8.', '1.8.1.8.1.8.1.8.', '1.8.1.8.1.8.1.8.', '1.8.1.8.1.8.5.8.'], bassF: bassChip,
    perc: [{ f: snareChip, p: ['....x.......x...'] }, { f: hatChip, p: ['x.x.x.x.x.x.x.x.'] }],
    cLo: 56, chordP: null, chordF: null, chordDur: 1,
    aLo: 57, arpP: ['0120120120120120'], arpF: arpChip, arpDur: 1,
    lead0: 64, lead: ['2.4.7.4.2.4.7.9.', '4.6.8.6.4.6.8.6.', '5.7.9.7.5.7.9.7.', '3.5.7.5.3.5.7.8.'], leadF: leadChip,
    note0: 76, motif: [0, 4, 7, 12, 7, 4, 7, 9, 12, 16, 19, 16, 12, 9, 7, 4], noteF: noteChip,
    fillF: snareChip,
  },

  // Synthwave: four on the floor, offbeat open hats, gated saw chords, octave bass. (A minor)
  neon: {
    root: 57, scale: [0, 2, 3, 5, 7, 8, 10], fit: true, swing: 0,
    chords: [{ r: 0, t: m }, { r: -4, t: M }, { r: 3, t: M }, { r: -2, t: M }],
    kick: ['X...x...x...x...', 'x...x...x...x...', 'X...x...x...x...', 'x...x...x...x.x.'], kickF: kickNeon,
    bass: ['1.1.8.1.1.1.8.1.', '1.1.8.1.1.1.8.1.', '1.1.8.1.1.1.8.1.', '1.1.8.1.1.1.8.5.'], bassF: bassNeon,
    perc: [
      { f: clap, p: ['....x.......x...'] },
      { f: hatOpen, p: ['..x...x...x...x.'] },
      { f: hatClosed, p: ['.o.o.o.o.o.o.o.o'] },
    ],
    cLo: 60, chordP: ['x..x..x.x..x..x.'], chordF: chordNeon, chordDur: 1.5,
    aLo: 72, arpP: ['0.1.2.3.2.1.2.1.'], arpF: arpNeon, arpDur: 1.5,
    lead0: 69, lead: ['4-----2.0-----4.', '5-----3.2-----5.', '4-----2.4-----6.', '6-----3.1-----3.'], leadF: leadNeon,
    note0: 81, motif: [7, 12, 10, 7, 8, 7, 3, 0, 3, 7, 10, 12, 15, 14, 12, 10], noteF: noteNeon,
    fillF: snareGate,
  },

  // E phrygian, heavy toms, distorted gallop bass, power chords. (E)
  volcano: {
    root: 40, scale: [0, 1, 3, 5, 7, 8, 10], fit: false, swing: 0,
    chords: [{ r: 0, t: P5 }, { r: 1, t: P5 }, { r: 0, t: P5 }, { r: -2, t: P5 }],
    kick: ['X..xx.x.X..xx.x.', 'X..xx.x.X..xx.x.', 'X..xx.x.X..xx.x.', 'X..xx.x.X.......'], kickF: kickHeavy,
    bass: ['1.11.11.1.11.11.', '1.11.11.1.11.11.', '1.11.11.1.11.11.', '1.11.11.1.11.5.5.'], bassF: bassDist,
    perc: [
      { f: snareHeavy, p: ['....x.......x...'] },
      { f: hatClosed, p: ['o.o.o.o.o.o.o.o.'] },
      { map: { h: tomHigh, m: tomMid, l: tomLow }, p: ['................', '............h.m.', '................', '..........hhmmll'] },
    ],
    cBase: 52, chordP: ['x.......x.......', 'x.....x.x.......', 'x.......x.......', 'x..x....x..x....'], chordF: chordDist, chordDur: 3,
    arpMode: 'scale', arp0: 64, arpP: ['0.0.1.0.3.0.1.0.'], arpF: arpDark, arpDur: 1.5,
    lead0: 64, lead: ['4--.4.5.4--.3.1.', '5--.5.6.5--.3.1.', '4--.4.5.7--.5.4.', '3--.3.5.3--.2.0.'], leadF: leadDist,
    note0: 76, motif: [0, 1, 0, 3, 5, 3, 1, 0, 7, 8, 7, 5, 3, 5, 7, 12], noteF: noteMetal,
    fillF: snareHeavy,
  },
};

// Four more biomes: variations of existing styles (other key / mode / pulse), same instrument bindings.
STYLES.aurora = Object.assign({}, STYLES.snow, { root: 45, scale: [0, 2, 3, 7, 8], chords: [{ r: 0, t: m }, { r: -4, t: M }, { r: 3, t: M }, { r: -2, t: M }] });
STYLES.bamboo = Object.assign({}, STYLES.forest, { root: 50, scale: [0, 2, 5, 7, 9] });
STYLES.glacier = Object.assign({}, STYLES.snow, { root: 52, scale: [0, 2, 4, 6, 7, 9, 11] });
STYLES.carnival = Object.assign({}, STYLES.candy, { root: 53, scale: [0, 2, 4, 5, 7, 9, 11] });

const STYLE_IDS = Object.keys(STYLES);

function foldTo(x, lo) {
  while (x < lo) x += 12;
  while (x >= lo + 12) x -= 12;
  return x;
}

/** Precompute per-chord voicings (cv: chord notes, av: arp tones, pcs: pitch classes). */
(function precompute() {
  for (let k = 0; k < STYLE_IDS.length; k++) {
    const S = STYLES[STYLE_IDS[k]];
    S.cv = []; S.av = []; S.pcs = [];
    for (let i = 0; i < S.chords.length; i++) {
      const ch = S.chords[i];
      const rootM = S.root + ch.r;
      S.pcs.push(ch.t.map((x) => (((rootM + x) % 12) + 12) % 12));
      S.cv.push(S.cLo !== undefined
        ? ch.t.map((x) => foldTo(rootM + x, S.cLo)).sort((a, b) => a - b)
        : ch.t.map((x) => S.cBase + ch.r + x));
      S.av.push(S.aLo !== undefined
        ? ch.t.map((x) => foldTo(rootM + x, S.aLo)).sort((a, b) => a - b)
        : S.cv[i]);
    }
  }
}());

style = STYLES.snow;

/** scale degree -> semitones above the scale root (degrees past the scale wrap an octave up). */
function degSemi(S, d) {
  const n = S.scale.length;
  return S.scale[d % n] + 12 * ((d / n) | 0);
}

// --------------------------------------------------------------- sequencer
// All musical state is a pure function of the 16th-step index `n` (plus the pending
// style switch), so skipping steps after a stall never desyncs anything.

const HEX = '0123456789abcdef';
const velOf = (c) => (c === 'X' ? 1 : c === 'x' ? 0.82 : c === 'o' ? 0.5 : c === 'g' ? 0.32 : 0);
const jitter = () => 0.92 + Math.random() * 0.16;
const barPat = (arr, bi) => arr[bi % arr.length];

function bassSemis(c, ch) {
  switch (c) {
    case '1': return 0;
    case '3': return ch.t[1];
    case '5': return 7;
    case '7': return 10;
    case '8': return 12;
    default: return -1;
  }
}

/** State changes that must happen even while silent (style switch at the bar line). */
function stepState(n) {
  accent = false;
  if (pendId && n >= pendBar) {
    styleId = pendId;
    style = STYLES[pendId];
    styleBar0 = pendBar >> 4;
    accent = n === pendBar;
    pendId = null;
  }
}

/** Schedule everything that sounds on step n. P = model time, t = audio-clock time. */
function playStep(n, P, t) {
  const S = style;
  const s = n & 15;
  const bi = Math.max(0, (n >> 4) - styleBar0);
  const ci = bi & 3;
  const ch = S.chords[ci];
  const stepSec = 15 / bpmAtT(P);
  if ((n & 1) && S.swing) t += S.swing * stepSec;
  const I = intensity;
  let c;

  // build-up in the bar before a style switch: noise riser + snare roll
  if (pendId) {
    const d = pendBar - n;
    if (d >= 1 && d <= 8) {
      if (riserBar !== pendBar) { riserBar = pendBar; riser(t, d * stepSec); }
      if (d === 8 || d === 6 || d <= 4) S.fillF(t, 0.35 + 0.65 * (1 - d / 8));
    }
  }
  if (accent) crash(t, 0.8);

  // layer 0: kick + bass
  c = barPat(S.kick, bi)[s];
  if (c !== '.') S.kickF(t, velOf(c) * jitter());
  const bp = barPat(S.bass, bi);
  c = bp[s];
  if (c !== '.') {
    const sm = bassSemis(c, ch);
    if (sm >= 0) {
      let len = 1;
      while (len < 4 && s + len < 16 && bp[s + len] === '.') len++;
      S.bassF(t, S.root + ch.r + sm, 0.9 * jitter(), len * stepSec * 0.92);
    }
  }

  // layer 1 (>= 0.4): hats / percussion
  if (I >= 0.4) {
    for (let i = 0; i < S.perc.length; i++) {
      const L = S.perc[i];
      c = barPat(L.p, bi)[s];
      if (c === '.') continue;
      if (L.map) {
        const fn = L.map[c];
        if (fn) fn(t, 0.9 * jitter());
      } else {
        L.f(t, velOf(c) * jitter());
      }
    }
  }

  // layer 2 (>= 0.7): chords + arp
  if (I >= 0.7) {
    if (S.chordP) {
      c = barPat(S.chordP, bi)[s];
      if (c !== '.') S.chordF(t, S.cv[ci], velOf(c) * jitter(), S.chordDur * stepSec);
    }
    if (S.arpP) {
      const k = HEX.indexOf(barPat(S.arpP, bi)[s]);
      if (k >= 0) {
        const midi = S.arpMode === 'scale'
          ? S.arp0 + degSemi(S, k)
          : S.av[ci][k % 3] + 12 * ((k / 3) | 0);
        S.arpF(t, midi, 0.66 * jitter(), S.arpDur * stepSec);
      }
    }
  }

  // layer 3 (>= 0.9): counter-melody
  if (I >= 0.9) {
    const lp = barPat(S.lead, bi);
    const k = HEX.indexOf(lp[s]);
    if (k >= 0) {
      let len = 1;
      while (s + len < 16 && lp[s + len] === '-') len++;
      S.leadF(t, S.lead0 + degSemi(S, k), 0.72 * jitter(), len * stepSec * 0.95);
    }
  }
}

let lastTickPs = 0;
let look = LOOKAHEAD;
let delayT = 0.4;

function tick() {
  if (!running || paused) return;
  const ps = perfSec();
  const gap = ps - lastTickPs;
  lastTickPs = ps;
  // main thread stalls (WebGL frames) -> look further ahead for a while
  if (gap > 0.07) look = Math.min(LOOKAHEAD_MAX, Math.max(look, gap * 1.6));
  else look = Math.max(LOOKAHEAD, look - gap * 0.1);

  updateOff(ps);
  const can = ready() && offOk && !held;
  const cn = can ? ctx.currentTime : 0;
  const horizon = ps + look;

  for (let guard = 0; guard < 64; guard++) {
    const P = timeAtBeat(nextStep * 0.25);
    if (P > horizon) break;
    if (P < ps - 0.5) {
      // long stall / suspension: jump to the present instead of replaying the past
      nextStep = Math.max(nextStep + 1, Math.ceil(beatAt(ps) * 4));
      continue;
    }
    stepState(nextStep);
    if (can) {
      let t = P + off;
      if (t >= cn - 0.03) { // a step that is already >30 ms late is skipped, not flammed
        if (t < cn + 0.003) t = cn + 0.003;
        playStep(nextStep, P, t);
      }
    }
    nextStep++;
  }

  if (can && delayN) { // dotted-eighth echo follows the tempo
    const dt = clamp((0.75 * 60) / bpmAtT(ps), 0.15, 0.9);
    if (Math.abs(dt - delayT) > 0.004) {
      delayT = dt;
      delayN.delayTime.setTargetAtTime(dt, cn, 0.08);
    }
  }
}

// --------------------------------------------------------------- lifecycle

let frozenAt = 0;
let lastNoteT = -1;
let lastPerfT = -1;
let lastPortalT = -1e9;

function teardown(c) {
  ctx = null;
  bus = lpF = stingG = duckG = muteG = comp = null;
  delayIn = delayN = distIn = whiteBuf = null;
  pulse25 = pulse12 = null;
  try { if (c) c.close(); } catch (e) { /* ignore */ }
}

/** Create the context once. Never throws: the beat clock must start even if audio cannot. */
function ensureCtx() {
  if (ctx) return true;
  let c = null;
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    try { c = new AC({ latencyHint: 'interactive' }); } catch (e) { c = new AC(); }
    build(c);
    return true;
  } catch (e) {
    teardown(c);
    return false;
  }
}

function init() {
  try {
    const nav = globalThis.navigator;
    if (nav && nav.audioSession) nav.audioSession.type = 'playback'; // iOS: ignore the silent switch
  } catch (e) { /* ignore */ }
  if (!ensureCtx()) return;
  if (!paused && ctx.state !== 'running') resumeCtx(true);
}

/** Clears the duck state AND the duck gain / lowpass (they used to stay at 650 Hz / 55 % after the first death). */
function resetDuck() {
  ducked = false;
  held = false;
  if (!ctx || !lpF || !duckG) return;
  const t = ctx.currentTime;
  try {
    duckG.gain.cancelScheduledValues(t);
    duckG.gain.setValueAtTime(1, t);
    lpF.frequency.cancelScheduledValues(t);
    lpF.frequency.setValueAtTime(Math.min(OPEN_FREQ, ctx.sampleRate * 0.45), t);
  } catch (e) { /* ignore */ }
}

/** Undo any death/revive/duck-less state of the bus (lowpass + sting fade). */
function restoreBus(fadeIn) {
  if (!ctx || !stingG) return;
  const t = ctx.currentTime;
  const f = ducked ? DUCK_FREQ : Math.min(OPEN_FREQ, ctx.sampleRate * 0.45);
  lpF.frequency.cancelScheduledValues(t);
  stingG.gain.cancelScheduledValues(t);
  if (fadeIn) {
    stingG.gain.setValueAtTime(0.0001, t);
    stingG.gain.linearRampToValueAtTime(1, t + fadeIn);
    lpF.frequency.setValueAtTime(300, t);
    lpF.frequency.exponentialRampToValueAtTime(f, t + fadeIn * 1.6);
  } else {
    stingG.gain.setValueAtTime(1, t);
    lpF.frequency.setValueAtTime(f, t);
  }
}

function unfreeze() {
  if (!frozen) return;
  const ps = perfSec();
  shiftModel(ps - frozenAt);
  frozen = null;
  latT = ps;
}

function tickGuarded() {
  try { tick(); } catch (e) { /* never kill the timer */ }
}

function startTimer() {
  if (timer) clearInterval(timer);
  lastTickPs = perfSec();
  look = LOOKAHEAD;
  timer = setInterval(tickGuarded, TICK_MS);
}

function start(id, bpm) {
  ensureCtx(); // may stay locked until a user gesture; the clock does not care
  paused = false;
  if (ctx && ctx.state !== 'running') resumeCtx(true);
  styleId = STYLES[id] ? id : 'snow';
  style = STYLES[styleId];
  const b = clamp(num(bpm, baseBpm), MIN_BPM, MAX_BPM);
  baseBpm = b;
  if (voices.length) killVoices();
  resetDuck(); // a new run never starts muffled
  dipEnd = 0; dipAmt = 0;
  restoreBus(0);
  const ps = perfSec();
  tStart = ps + START_LEAD;
  seg = mkSeg(tStart, 0, b, b, 0);
  prevSeg = null;
  nextStep = 0;
  styleBar0 = 0;
  pendId = null;
  riserBar = -1;
  accent = false;
  held = false;
  phraseIdx = 0;
  lastNoteAt = -1e9;
  started = true;
  running = true;
  pubState();
  stopped = false;
  frozen = null;
  lastBeat = 0;
  lastTime = 0;
  latT = ps;
  latApplied = latencyTarget();
  startTimer();
  tick();
}

function stop() {
  if (!started) return;
  if (running) {
    if (!frozen) { freezeClock(); frozenAt = perfSec(); }
    stopped = true;
  }
  running = false;
  pubState();
  if (timer) { clearInterval(timer); timer = 0; }
}

/** Continue a stop()ped sequencer exactly where it froze (used by the revive stinger). */
function continueSeq() {
  if (!started || running || paused) return;
  unfreeze();
  running = true;
  stopped = false;
  startTimer();
  tick();
}

function setStyle(id) {
  if (!STYLES[id]) return;
  if (!running) { // nothing to quantize against
    styleId = id;
    style = STYLES[id];
    pendId = null;
    return;
  }
  if (id === styleId) { pendId = null; return; }
  const had = pendId !== null && pendBar >= nextStep;
  pendId = id;
  if (!had) {
    pendBar = Math.ceil(nextStep / 16) * 16; // next bar line
    riserBar = -1;
  }
}

function setBpm(x) {
  const target = clamp(num(x, baseBpm), MIN_BPM, MAX_BPM);
  baseBpm = target;
  if (!started) return;
  // Rebase at the first unscheduled step: everything already scheduled keeps its time,
  // and the beat curve stays continuous (the old segment still serves earlier times).
  const b = nextStep * 0.25;
  const T = timeAtBeat(b);
  const cur = bpmAtT(T);
  const D = Math.abs(target - cur) < 0.05 ? 0 : (RAMP_BEATS * 60) / ((cur + target) * 0.5);
  prevSeg = seg;
  seg = mkSeg(T, b, cur, target, D);
}

function setIntensity(x) {
  intensity = clamp(num(x, intensity), 0, 1);
}

// ----------------------------------------------------------- pickup sounds

/** Pitch of the pickup motif, nudged to a chord tone only when it would clash by a semitone. */
function fitToChord(S, midi, pcs) {
  if (!S.fit) return midi;
  const pc = ((midi % 12) + 12) % 12;
  for (let i = 0; i < pcs.length; i++) if (pcs[i] === pc) return midi;
  for (let i = 0; i < pcs.length; i++) if ((pcs[i] - pc + 12) % 12 === 11) return midi - 1;
  for (let i = 0; i < pcs.length; i++) if ((pcs[i] - pc + 12) % 12 === 1) return midi + 1;
  return midi;
}

function chordIdxNow() {
  if (!running) return 0;
  const bi = Math.max(0, ((nextStep > 0 ? nextStep - 1 : 0) >> 4) - styleBar0);
  return bi & 3;
}

// Key hook for audio.js (it owns a separate AudioContext): one-shots such as the pickup streak ladder and the turn stab are
// pitched from here so they land in the key and chord the music is playing right now. Reads only; allocation-free.
const LADDER_LO = 70; // MIDI: rung 0 is the key's root somewhere in 70..81
const keyHook = {
  /** MIDI pitch of rung `i` (any integer, 0 = root) of the running style's scale, nudged to the current chord; -1 = no music running. */
  ladder(i) {
    if (!running) return -1;
    const S = style, n = S.scale.length;
    const d = Math.floor(num(i, 0));
    const oct = Math.floor(d / n);
    const midi = LADDER_LO + ((((S.root - LADDER_LO) % 12) + 12) % 12) + S.scale[d - oct * n] + 12 * oct;
    return S.fit ? fitToChord(S, midi, S.pcs[chordIdxNow()]) : midi;
  },
  /** Writes the current chord's pad voicing (ascending MIDI notes) into out[0..2]; returns 3, or 0 when no music runs. */
  chord(out) {
    if (!running) return 0;
    const cv = style.cv[chordIdxNow()];
    for (let k = 0; k < 3; k++) out[k] = cv[k];
    return 3;
  },
};
try { globalThis.__cigMusicKey = keyHook; } catch (e) { /* ignore */ }

function note() {
  const ps = perfSec();
  if (ps - lastNoteAt > PHRASE_GAP) phraseIdx = 0; // a fresh line of flakes restarts the motif
  lastNoteAt = ps;
  const S = style;
  if (!ready()) return;
  const t0 = ctx.currentTime;
  if (t0 - lastNoteT < NOTE_GAP) return;
  const semis = S.motif[phraseIdx % S.motif.length];
  phraseIdx++;
  lastNoteT = t0;
  const midi = fitToChord(S, S.note0 + semis, S.pcs[chordIdxNow()]);
  S.noteF(t0 + 0.004, midi, NOTE_TRIM, 0.3);
}

function perfect() {
  if (!ready()) return;
  const t0 = ctx.currentTime;
  if (t0 - lastPerfT < 0.06) return;
  lastPerfT = t0;
  const S = style;
  const ch = S.chords[chordIdxNow()];
  const rp = (((S.root + ch.r) % 12) + 12) % 12;
  const base = S.note0 - 12;
  const m = base + ((rp - (base % 12) + 12) % 12); // chord root, in the pickup register
  const t = t0 + 0.004;
  bell(t, mtof(m), 0.8, BELL.chime);
  bell(t + 0.012, mtof(m + 12), 0.55, BELL.chime);
  const v = voice(PR_SFX, t, 0.3, 0.6, null);
  if (v) { // sparkle + tiny whoosh
    const s = noiseSrc(v, t, 0.28);
    const f = filtN('bandpass', 1500, 1.2);
    sweep(f.frequency, t, 1500, 6500, 0.14);
    const g = gainN();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    link(s, f, g, v.out);
    nzHit(v, t + 0.01, 'highpass', 5200, 0, 0.7, 0, 0.18, 0.004, 0.1);
  }
}

// ----------------------------------------------------------------- stingers

const TAPE = (() => {
  const a = new Float32Array(32);
  for (let i = 0; i < 32; i++) a[i] = 1200 * Math.log2(Math.max(1 - 0.97 * (i / 31), 0.03));
  return a;
})();

function stPortal() {
  if (!ready()) return;
  const t0 = ctx.currentTime;
  if (t0 - lastPortalT < 0.5) return;
  lastPortalT = t0;
  const T = pendId ? STYLES[pendId] : style;
  const t = t0 + 0.01;
  const w = voice(PR_SFX, t, 1.5, 0.7, null);
  if (w) { // whoosh: rises to a peak then falls away
    const s = noiseSrc(w, t, 1.45);
    const bp = filtN('bandpass', 350, 1.1);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.55);
    bp.frequency.exponentialRampToValueAtTime(1000, t + 1.35);
    const g = gainN();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    link(s, bp, g, w.out);
    nzHit(w, t + 0.2, 'highpass', 5000, 0, 0.7, 0, 0.12, 0.3, 0.7);
  }
  // rising chord of the style we are heading into
  const cv = T.cv[0];
  const notes = [cv[0] + 12, cv[1] + 12, cv[2] + 12, cv[0] + 24, cv[1] + 24, cv[2] + 24];
  for (let i = 0; i < notes.length; i++) bell(t + 0.05 + i * 0.065, mtof(notes[i]), 0.65 + 0.06 * i, BELL.portal);
  synth(t + 0.4, cv.map((x) => mtof(x + 12)), 1.1, OPT.padPortal, 1);
}

function stDeath() {
  held = true; // music silent until revive / start(); the beat clock keeps running
  if (!ready()) return;
  const t = ctx.currentTime + 0.005;
  const dur = 0.9;
  // tape stop: every live note glides down in pitch, the lowpass closes, the bus fades
  for (let i = 0; i < voices.length; i++) {
    const nodes = voices[i].nodes;
    for (let k = 0; k < nodes.length; k++) {
      const d = nodes[k].detune;
      if (!d) continue;
      try {
        d.cancelScheduledValues(t);
        d.setValueCurveAtTime(TAPE, t, dur);
      } catch (e) { /* ignore */ }
    }
  }
  lpF.frequency.cancelScheduledValues(t);
  lpF.frequency.setValueAtTime(lpF.frequency.value, t);
  lpF.frequency.exponentialRampToValueAtTime(260, t + dur);
  stingG.gain.cancelScheduledValues(t);
  stingG.gain.setValueAtTime(1, t);
  stingG.gain.setTargetAtTime(0.0001, t + dur * 0.35, dur * 0.2);
  // record scratch on top
  const v = voice(PR_SFX, t, 0.5, 0.8, 'sfx');
  if (v) {
    const s = noiseSrc(v, t, 0.46);
    const bp = filtN('bandpass', 1400, 3);
    const fz = [1400, 4200, 700, 3600, 500, 2400];
    bp.frequency.setValueAtTime(fz[0], t);
    for (let i = 1; i < fz.length; i++) bp.frequency.linearRampToValueAtTime(fz[i], t + i * 0.07);
    const g = gainN();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.02);
    g.gain.linearRampToValueAtTime(0.5, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);
    link(s, bp, g, v.out);
    toneHit(v, 'sawtooth', t, 1800, 90, 0.35, 0.16, 0.005, 0.38);
  }
}

function stRevive() {
  held = false;
  if (!running && started && stopped && !paused) continueSeq(); // the runner stop()ped on death
  if (!ready()) return;
  const t = ctx.currentTime + 0.005;
  const v = voice(PR_SFX, t, 0.8, 0.8, 'sfx'); // tape rewind whirr
  if (v) {
    const s = noiseSrc(v, t, 0.7);
    const bp = filtN('bandpass', 250, 1.5);
    sweep(bp.frequency, t, 250, 5200, 0.5);
    const g = gainN();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    link(s, bp, g, v.out);
    toneHit(v, 'triangle', t, 120, 1700, 0.5, 0.22, 0.05, 0.5);
    toneHit(v, 'sine', t + 0.04, 240, 3400, 0.46, 0.08, 0.05, 0.45);
  }
  restoreBus(0.45); // music fades back in, filter opening
}

function stinger(kind) {
  if (kind === 'portal') stPortal();
  else if (kind === 'death') stDeath();
  else if (kind === 'revive') stRevive();
}

// --------------------------------------------------------- duck / mute / pause

// Shared flags for the ambient bed in audio.js (it plays only while the runner music does not), plus a short dip hook
// so big one-shot moments (milestone / win / boss) duck the music slightly.
function pubState() { try { globalThis.__cigMusicState = { muted, running }; } catch (e) { /* ignore */ } }
// Sidechain-style duck: fast attack (the hit lands on a clear mix), slower swell back. A shallower dip never cuts a deeper one that is
// still holding; a deeper one replaces it and keeps the later release.
let dipAmt = 0, dipEnd = 0;
function dip(amount, sec) {
  if (!ctx || !bus || muted) return;
  const t = ctx.currentTime;
  let a = clamp(num(amount, 0.25), 0, 0.6);
  let end = t + Math.max(0.1, num(sec, 0.5));
  if (t < dipEnd) {
    if (a <= dipAmt && end <= dipEnd) return;
    a = Math.max(a, dipAmt);
    end = Math.max(end, dipEnd);
  }
  dipAmt = a;
  dipEnd = end;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setTargetAtTime(BUS_LEVEL * (1 - a), t, 0.02);
  bus.gain.setTargetAtTime(BUS_LEVEL, end, 0.3);
}
try { globalThis.__cigMusicDip = (a, s) => { try { dip(a, s); } catch (e) { /* ignore */ } }; } catch (e) { /* ignore */ }
pubState();

function duck(on) {
  ducked = !!on;
  if (!ctx || !lpF) return;
  const t = ctx.currentTime;
  lpF.frequency.cancelScheduledValues(t);
  lpF.frequency.setTargetAtTime(ducked ? DUCK_FREQ : Math.min(OPEN_FREQ, ctx.sampleRate * 0.45), t, 0.12);
  duckG.gain.cancelScheduledValues(t);
  duckG.gain.setTargetAtTime(ducked ? DUCK_VOL : 1, t, 0.12);
}

function setMuted(b) {
  muted = !!b;
  saveMuted(muted);
  pubState();
  if (ctx && muteG) {
    const t = ctx.currentTime;
    muteG.gain.cancelScheduledValues(t);
    muteG.gain.setTargetAtTime(muted ? 0 : 1, t, 0.02);
  }
  if (muted) killVoices();
}

function suspend() {
  if (started && !paused && !frozen) { freezeClock(); frozenAt = perfSec(); }
  paused = true;
  if (ctx) {
    try {
      const p = ctx.suspend();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* ignore */ }
  }
}

function resume() {
  if (paused) {
    paused = false;
    if (frozen && running) unfreeze(); // a stop() during the pause stays frozen
  }
  resumeCtx(true);
}

// Mobile: a context that is suspended / interrupted (autoplay lock, phone call, app switch) can only be restarted from a user gesture,
// so every gesture (and coming back to the tab) retries until it runs. This module is prefetched while the menu is up, so the first tap
// also creates the context (the runner starts asynchronously, after the tap, and iOS would leave a context made then locked).
// One cheap state check per gesture once it runs.
try {
  if (typeof window !== 'undefined' && window.addEventListener) {
    const wake = () => { if (ctx && !paused && ctx.state !== 'running' && ctx.state !== 'closed') resumeCtx(false); };
    const unlock = () => { if (!ctx) ensureCtx(); wake(); };
    for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  }
} catch (e) { /* ignore */ }

// --------------------------------------------------------------- public API

// Every method goes through guard(): whatever happens inside, callers never see a throw.
const guard = (fn, fallback) => function () {
  try { return fn.apply(null, arguments); } catch (e) { if (globalThis.__cigAudioDebug) console.error('[audio]', fn.name, e && e.message); return fallback; }
};

function readBeatSafe(out) {
  try {
    return readBeat(out);
  } catch (e) {
    out.beat = lastBeat; out.phase = lastBeat - Math.floor(lastBeat); out.bpm = baseBpm; out.time = lastTime;
    return out;
  }
}

export const music = {
  /** Call from a user gesture. Creates (once) and resumes the music AudioContext. Idempotent. */
  init: guard(init),
  /** Start the sequencer from beat 0 in the given style (see STYLES) at `bpm`. */
  start: guard(start),
  /** Stop scheduling; tails ring out; the beat clock freezes. */
  stop: guard(stop),
  /** Quantized to the next bar line, with a riser + snare roll in the bar before. */
  setStyle: guard(setStyle),
  /** Smooth tempo change over 2 bars; the beat clock stays continuous. */
  setBpm: guard(setBpm),
  /** 0..1: 0 kick+bass, 0.4 +hats/perc, 0.7 +arp/chords, 0.9+ +lead counter-melody. */
  setIntensity: guard(setIntensity),
  /** Beat the player is hearing now: { beat, phase, bpm, time }. Works with no audio. */
  get beat() { return readBeatSafe({ beat: 0, phase: 0, bpm: baseBpm, time: 0 }); },
  /** Zero-allocation variant of `beat` for per-frame use. */
  beatInto: (out) => readBeatSafe(out),
  /** Pickup: next note of the style's motif (restarts after a pause in collecting). */
  note: guard(note),
  /** On-beat bonus chime. */
  perfect: guard(perfect),
  /** 'portal' | 'death' | 'revive' */
  stinger: guard(stinger),
  /** true: lowpass + volume down (pause/death screen); false: back. */
  duck: guard(duck),
  /** Forget any duck / death muffling right now (start() already does this). */
  resetDuck: guard(resetDuck),
  setMuted: guard(setMuted),
  isMuted: guard(() => muted, false),
  suspend: guard(suspend),
  resume: guard(resume),
  /** Extras (not in the contract): restart the pickup motif now; introspection. */
  resetPhrase: guard(() => { phraseIdx = 0; }),
  get styles() { return STYLE_IDS.slice(); },
  get style() { return styleId; },
  get running() { return running; },
  get voiceCount() { return voices.length; },
  /** Diagnostics: the duck state of the bus (tests check that a new run starts fully open). */
  get bus() { return { ducked, held, duckGain: duckG ? duckG.gain.value : null, lpFreq: lpF ? lpF.frequency.value : null }; },
};
