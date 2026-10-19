// Regression check for the audio engine (node, no browser, no Web Audio): drives src/audio.js, src/sfx.js and src/runner/music.js
// through a STRICT Web Audio mock that throws on what real browsers reject (zero exponential-ramp targets, negative times,
// non-finite values, double start, stop-before-start, foreign-context connects) and records every violation even when the engine's
// own guard() swallows the throw. Then checks the behaviour that matters: the pickup streak climbs the music's scale and resets,
// the key hook is in scale, rate limits hold, one-shots clean up after themselves, the per-frame Yeti layer is cheap and fades out
// by itself, the music duck keeps the deeper dip, the limiter curve is sane.
// Usage: node scripts/check-audio.mjs        (runs twice: synth only, then with a fake decoded sample bank)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WITH_SAMPLES = process.env.CHECK_SAMPLES === '1';
if (!WITH_SAMPLES && !process.env.CHECK_CHILD) {
  const me = fileURLToPath(import.meta.url);
  let bad = 0;
  for (const s of ['0', '1']) {
    const r = spawnSync(process.execPath, [me], { stdio: 'inherit', env: { ...process.env, CHECK_SAMPLES: s, CHECK_CHILD: '1' } });
    if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}

// ------------------------------------------------------------------ strict mock
const violations = [];
const bad = (m) => { violations.push(m); throw new RangeError(m); };
const fin = (x, what) => { if (typeof x !== 'number' || !Number.isFinite(x)) bad(`${what}: not finite (${x})`); };
const ctxs = [];

class Param {
  constructor(ctx, value, name, nyq) { this.ctx = ctx; this._v = value; this.name = name; this.nyq = nyq; this.events = []; }
  get value() { return this._v; }
  set value(x) { fin(x, `${this.name}.value`); this._chk(x); this._v = x; }
  _chk(x) { if (this.nyq && (x < 0 || x > this.ctx.sampleRate / 2)) bad(`${this.name}: ${x} Hz outside 0..Nyquist`); }
  _t(t, w) { fin(t, `${this.name}.${w} time`); if (t < 0) bad(`${this.name}.${w}: negative time ${t}`); }
  _last() { const e = this.events[this.events.length - 1]; return e ? e.v : this._v; }
  setValueAtTime(v, t) { fin(v, `${this.name}.setValueAtTime`); this._t(t, 'setValueAtTime'); this._chk(v); this.events.push({ k: 'set', v, t }); return this; }
  linearRampToValueAtTime(v, t) { fin(v, `${this.name}.linearRamp`); this._t(t, 'linearRamp'); this._chk(v); this.events.push({ k: 'lin', v, t }); return this; }
  exponentialRampToValueAtTime(v, t) {
    fin(v, `${this.name}.expRamp`); this._t(t, 'expRamp');
    if (v === 0) bad(`${this.name}.exponentialRampToValueAtTime(0)`);
    if (!(this._last() > 0) && !this.audioOk) bad(`${this.name}: exponential ramp from a non-positive value (${this._last()})`);
    this._chk(v); this.events.push({ k: 'exp', v, t }); return this;
  }
  setTargetAtTime(v, t, tc) { fin(v, `${this.name}.setTarget`); this._t(t, 'setTarget'); fin(tc, `${this.name}.setTarget tc`); if (tc < 0) bad(`${this.name}: negative time constant`); this._chk(v); this.events.push({ k: 'tgt', v, t, tc }); return this; }
  cancelScheduledValues(t) { this._t(t, 'cancel'); this.events = this.events.filter((e) => e.t < t); return this; }
  setValueCurveAtTime(a, t, d) { this._t(t, 'curve'); if (!(d > 0)) bad(`${this.name}.setValueCurveAtTime duration ${d}`); this.events.push({ k: 'curve', v: a[a.length - 1], t }); return this; }
}

class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.out = []; this.onended = null; ctx.nodes.push(this); }
  connect(d) {
    if (d && d.ctx && d.ctx !== this.ctx) bad(`${this.kind}.connect: foreign context`);
    if (!d || (!(d instanceof Node) && !(d instanceof Param) && d !== this.ctx.destination)) bad(`${this.kind}.connect: bad destination`);
    this.out.push(d); return d;
  }
  disconnect() { this.out.length = 0; }
}
class Gain extends Node { constructor(c) { super(c, 'gain'); this.gain = new Param(c, 1, 'gain'); } }
class Biquad extends Node {
  constructor(c) { super(c, 'biquad'); this.type = 'lowpass'; this.frequency = new Param(c, 350, 'biquad.frequency', true); this.Q = new Param(c, 1, 'biquad.Q'); this.gain = new Param(c, 0, 'biquad.gain'); this.detune = new Param(c, 0, 'biquad.detune'); }
}
class Comp extends Node {
  constructor(c) { super(c, 'compressor'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[k] = new Param(c, 0, `compressor.${k}`); }
}
class Shaper extends Node {
  constructor(c) { super(c, 'shaper'); this._curve = null; this.oversample = 'none'; }
  get curve() { return this._curve; }
  set curve(a) { if (a && (!(a instanceof Float32Array) || a.length < 2)) bad('WaveShaper.curve must be a Float32Array of length >= 2'); this._curve = a; }
}
class Delay extends Node { constructor(c) { super(c, 'delay'); this.delayTime = new Param(c, 0, 'delay.delayTime'); } }
class Source extends Node {
  constructor(c, kind) { super(c, kind); this.started = false; this.stopAt = Infinity; this.startAt = 0; this.ended = false; }
  start(when = 0) {
    if (this.started) bad(`${this.kind}.start twice`);
    fin(when, `${this.kind}.start`); if (when < 0) bad(`${this.kind}.start negative`);
    this.started = true; this.startAt = when;
    if (this.ctx.live.indexOf(this) < 0) this.ctx.live.push(this);
  }
  stop(when = 0) { if (!this.started) bad(`${this.kind}.stop before start`); fin(when, `${this.kind}.stop`); if (when < 0) bad(`${this.kind}.stop negative`); this.stopAt = when; }
}
class Osc extends Source {
  constructor(c) { super(c, 'osc'); this.type = 'sine'; this.frequency = new Param(c, 440, 'osc.frequency', true); this.detune = new Param(c, 0, 'osc.detune'); }
  setPeriodicWave() { this.type = 'custom'; }
}
class BufSrc extends Source {
  constructor(c) { super(c, 'buffer'); this.buffer = null; this.loop = false; this.playbackRate = new Param(c, 1, 'buffer.playbackRate'); this.detune = new Param(c, 0, 'buffer.detune'); }
  start(when = 0, offset = 0) { if (!(offset >= 0)) bad('buffer.start offset'); super.start(when); if (!this.loop && this.buffer && this.stopAt === Infinity) this.stopAt = when + this.buffer.duration / Math.max(0.01, this.playbackRate.value); }
}

class Ctx {
  constructor(opts) {
    this.sampleRate = 48000; this.currentTime = 0.5; this.state = 'suspended'; this.baseLatency = 0.01; this.outputLatency = 0.02;
    this.nodes = []; this.live = []; this.destination = { kind: 'destination' };
    this.destination.ctx = this;
    this.opts = opts; this.resumes = 0; ctxs.push(this);
  }
  resume() { this.resumes++; if (this.state !== 'closed') this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { return new Gain(this); }
  createBiquadFilter() { return new Biquad(this); }
  createDynamicsCompressor() { return new Comp(this); }
  createWaveShaper() { return new Shaper(this); }
  createDelay() { return new Delay(this); }
  createOscillator() { return new Osc(this); }
  createBufferSource() { return new BufSrc(this); }
  createPeriodicWave(re, im) { if (re.length !== im.length) bad('periodic wave size'); return {}; }
  createBuffer(ch, len, rate) {
    if (!(len > 0) || !(rate >= 3000)) bad(`createBuffer(${ch}, ${len}, ${rate})`);
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: (i) => data[i] };
  }
  decodeAudioData(buf, ok) { const b = this.createBuffer(1, Math.round(this.sampleRate * 0.3), this.sampleRate); const p = Promise.resolve(b); if (ok) p.then(ok); return p; }
  /** Moves the clock and fires onended for sources whose stop time passed (disconnect like the browser does). */
  advance(sec) {
    this.currentTime += sec;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const n = this.live[i];
      if (n.stopAt <= this.currentTime && !n.ended) { n.ended = true; this.live.splice(i, 1); if (typeof n.onended === 'function') n.onended(); }
    }
  }
  liveCount() { return this.live.length; }
}

const store = new Map();
globalThis.AudioContext = Ctx;
// a minimal DOM: window/document listener registries, so the first-touch unlock and the back-from-background resume can be exercised
const listeners = { window: new Map(), document: new Map() };
const reg = (which) => (ev, fn) => { if (!listeners[which].has(ev)) listeners[which].set(ev, []); listeners[which].get(ev).push(fn); };
globalThis.window = { addEventListener: reg('window') };
globalThis.document = { hidden: false, addEventListener: reg('document') };
const fire = (ev, which = 'window') => { for (const fn of listeners[which].get(ev) || []) fn({}); };
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
if (WITH_SAMPLES) globalThis.fetch = async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(16) });
else delete globalThis.fetch;
globalThis.__cigAudioDebug = true;
const errors = [];
const origErr = console.error;
console.error = (...a) => { errors.push(a.join(' ')); };

// ------------------------------------------------------------------ tiny test runner
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; origErr('FAIL:', msg); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 5)); };

const { audio } = await import('../src/audio.js');
const { sfx } = await import('../src/sfx.js');
const { music } = await import('../src/runner/music.js');

ok(ctxs.length === 0, 'importing the modules creates no AudioContext');
ok(['pointerdown', 'touchstart', 'touchend', 'click'].every((e) => (listeners.window.get(e) || []).length >= 1), 'gesture listeners are registered on window');
fire('touchstart'); // the very first touch
await flush();
const A = ctxs[0];
ok(A && A.state === 'running', 'the first touch creates and resumes the audio context');
fire('touchend');
await flush();
ok(ctxs.length === 2 && ctxs[1].state === 'running', 'the music context is created and unlocked by the first completed tap');
audio.init(); // idempotent
ok(ctxs.length === 2, 'init() after the unlock does not create another context');
// interruption (phone call / app switch): the next gesture brings both back
A.state = 'interrupted'; ctxs[1].state = 'suspended';
const r0 = A.resumes;
fire('touchend'); await flush();
ok(A.state === 'running' && ctxs[1].state === 'running' && A.resumes > r0, 'a gesture resumes an interrupted/suspended context');
fire('pointerdown'); fire('click');
const r1 = A.resumes;
fire('touchend'); await flush();
ok(A.resumes === r1, 'gestures cost nothing while the context runs');
// back from the background without a gesture
A.state = 'suspended'; ctxs[1].state = 'suspended'; document.hidden = false;
fire('visibilitychange', 'document'); await flush();
ok(A.state === 'running' && ctxs[1].state === 'running', 'coming back to the tab resumes both contexts');
if (WITH_SAMPLES) ok(sfx.has('snow_crunch') && sfx.has('jingle_lose') && sfx.has('coin'), 'fake sample bank decoded');
else ok(!sfx.has('snow_crunch'), 'no samples without fetch');

const T = (dt) => { A.advance(dt); };

// ---- 0. API contract: every audio method the game calls (audio.x, ctx.audio.x, __cigSfx.x, the ui.js snd('x') hooks) still exists
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const used = new Map();
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.js') || /[\\/](audio|music|sfx)\.js$/.test(p)) continue;
      const t = readFileSync(p, 'utf8');
      const hook = /[\\/]ui\.js$/.test(p) ? '|(?<![.\\w])snd\\(\'(\\w+)\'' : ''; // (agar.js has its own, unrelated this.snd)
      for (const m of t.matchAll(new RegExp('\\baudio\\??\\.(\\w+)|__cigSfx\\??\\.(\\w+)' + hook, 'g'))) {
        const n = m[1] || m[2] || m[3];
        if (n === 'js') continue; // import './audio.js'
        if (!used.has(n)) used.set(n, relative(root, p));
      }
    }
  };
  walk(join(root, 'src'));
  const missing = [...used].filter(([n]) => typeof audio[n] !== 'function');
  ok(used.size >= 20, `found the audio calls in the game sources (${used.size})`);
  ok(missing.length === 0, `every audio method the game calls exists (missing: ${missing.map(([n, f]) => `${n} in ${f}`).join(', ')})`);
}

// ---- 1. every exported function runs without a violation, with odd arguments too
const ARGS = [[], [0], [1], [0.5], [-3], [99], [NaN], [undefined], [null], ['x'], [Infinity], [true]];
const names = Object.keys(audio).filter((k) => typeof audio[k] === 'function' && !['init', 'setMuted', 'suspend', 'resume', 'isMuted'].includes(k));
ok(names.length >= 28, `audio exposes ${names.length} functions`);
for (const k of ['pickupStreak', 'turnOk', 'nearMiss', 'comboTier', 'newBest', 'popBurst', 'roar', 'yetiNear', 'pop', 'flake', 'near', 'turn', 'crash', 'bump', 'lose', 'win', 'milestone', 'star', 'whoosh', 'land', 'hop', 'stomp', 'chime', 'ui', 'arena', 'setRoll', 'swallow', 'pof']) {
  ok(typeof audio[k] === 'function', `audio.${k} exists`);
}
for (const k of names) {
  for (const a of ARGS) {
    T(1.3); // past every limiter
    audio[k](...a);
    if (k === 'arena') for (const kind of ['pellet', 'gulp', 'merge', 'ice', 'golden', 'slide', 'deep', 'storm', 'tick', 'crash', 'pad', 'rain', 'fanfare', 'roar', 'wood', 'zzz']) { T(0.6); audio.arena(kind, 0.9, 3); }
    if (k === 'ui') for (const kind of ['click', 'select', 'confirm', 'back', 'close', 'open', 'toggle', 'error', 'reward', 'coin', 'pof', 'chime', 'pop', 'stomp', 'zzz']) { T(0.1); audio.ui(kind); }
  }
}
T(8);
ok(errors.length === 0, `no engine errors (${errors.slice(0, 3).join(' | ')})`);
ok(violations.length === 0, `no Web Audio violations (${violations.slice(0, 3).join(' | ')})`);
// one-shots clean up: after everything has played out only the long-lived loops (roll, Yeti bed) stay alive, and every ended source was disconnected
T(14);
const persist = A.live.filter((n) => n.stopAt === Infinity).length;
ok(A.live.length === persist && persist <= 12, `after 14 s only the persistent loops are alive (${A.live.length} live, ${persist} persistent)`);
{ const lk = A.nodes.filter((n) => n.ended && n.out.length); ok(lk.length === 0, 'every ended source was disconnected (' + lk.length + ': ' + [...new Set(lk.map((n) => n.kind + (n.buffer ? ' buf' + n.buffer.length : '') + ' loop=' + n.loop))].join(', ') + ')'); }
violations.length = 0; errors.length = 0;

// ---- 2. limiter curve
const lim = A.nodes.find((n) => n.kind === 'shaper');
ok(lim && lim.curve && lim.curve.length >= 256, 'master has a soft limiter (WaveShaper curve)');
if (lim && lim.curve) {
  const c = lim.curve, n = c.length;
  let mono = true, bounded = true, lin = true, odd = true;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    if (i && c[i] < c[i - 1] - 1e-7) mono = false;
    if (Math.abs(c[i]) > 1) bounded = false;
    if (Math.abs(x) <= 0.69 && !near(c[i], x, 1e-5)) lin = false;
    if (!near(c[i], -c[n - 1 - i], 1e-5)) odd = false;
  }
  ok(mono && bounded && lin && odd, `limiter curve: monotonic ${mono}, bounded ${bounded}, linear below the knee ${lin}, odd ${odd}`);
}

// ---- 3. pickup streak: climbs, tops out, resets after a gap, is rate limited
function firstFreqs(fn) { // primary tone frequencies of the voices a call created (osc nodes started at/after the call)
  const before = A.nodes.length;
  fn();
  return A.nodes.slice(before).filter((n) => n.kind === 'osc').map((n) => n.frequency.value);
}
function streakRun(n, gap) {
  const out = [];
  for (let i = 0; i < n; i++) { T(gap); const f = firstFreqs(() => audio.pickupStreak()); out.push(f.length ? f[0] : null); }
  return out;
}
T(2);
let run = streakRun(14, 0.12);
ok(run.every((f) => f > 200 && f < 5200), `streak pitches audible and bounded: ${run.map((f) => Math.round(f)).join(',')}`);
let climb = true;
for (let i = 1; i <= 9; i++) if (!(run[i] > run[i - 1])) climb = false;
ok(climb, 'streak climbs rung by rung over the first 10 pickups');
ok(run.slice(9).every((f) => near(f, run[9], 0.5)), 'streak holds the top rung after the ladder');
T(1.2);
const again = firstFreqs(() => audio.pickupStreak())[0];
ok(near(again, run[0], 0.5), 'streak resets to the root after a pause');
T(0.12); audio.pickupStreak(); T(0.12);
const explicit = firstFreqs(() => audio.pickupStreak(4))[0];
const explicit2 = (T(0.12), firstFreqs(() => audio.pickupStreak(4))[0]);
ok(near(explicit, explicit2, 0.5), 'explicit rung is honoured (same rung, same pitch)');
T(1.5);
let nodesBefore = A.nodes.length;
for (let i = 0; i < 30; i++) audio.pickupStreak();
const burst = A.nodes.slice(nodesBefore).filter((n) => n.kind === 'osc').length;
ok(burst > 0 && burst <= 8, `30 pickups in the same instant make one voice (${burst} oscillators)`);
// sparkle layer only on the top rungs
T(1.5);
const lowOsc = firstFreqs(() => audio.pickupStreak(1)).length;
T(0.5);
const topOsc = firstFreqs(() => audio.pickupStreak(9)).length;
ok(topOsc > lowOsc, `top rung adds the sparkle layer (${lowOsc} -> ${topOsc} oscillators)`);

// ---- 4. rate governor: a pile-up of different small sounds in one instant is capped (big ones always go through)
T(2);
const masterG = A.nodes.find((n) => n.kind === 'gain' && n.out.some((d) => d && d.kind === 'biquad'));
const startsFrom = (i0) => A.nodes.slice(i0).filter((n) => n.kind === 'gain' && n.out.includes(masterG)).length;
const g0 = A.nodes.length;
for (const kd of ['tick', 'wood', 'pad', 'merge', 'slide', 'pellet', 'deep', 'rain']) audio.arena(kd, 0.9, 1);
audio.hop(0.6); audio.pof(); audio.nearMiss(); audio.flake();
const small = startsFrom(g0);
ok(small >= 3 && small <= 6, `12 different small sounds in one instant -> at most 6 start (${small})`);
const g1 = A.nodes.length;
audio.arena('roar', 0.9); audio.crash(0.8); audio.popBurst(0.5);
ok(startsFrom(g1) === 3, `big sounds are never governed (${startsFrom(g1)} of 3)`);
T(0.2);
const g2 = A.nodes.length;
audio.hop(0.6);
ok(startsFrom(g2) === 1, 'after the window passes small sounds play again');

// ---- 5. new one-shots produce sound and respect their limiters
function voiceCount(fn) { const b = A.nodes.length; fn(); return A.nodes.slice(b).filter((n) => n.kind === 'osc' || n.kind === 'buffer').length; }
for (const [name, fn] of [
  ['turnOk', () => audio.turnOk(false)], ['turnOk perfect', () => audio.turnOk(true)], ['nearMiss', () => audio.nearMiss(0.8)],
  ['comboTier 1', () => audio.comboTier(1)], ['comboTier 5', () => audio.comboTier(5)], ['newBest', () => audio.newBest()],
  ['popBurst', () => audio.popBurst(0.8)], ['roar', () => audio.roar(0.9)], ['lose', () => audio.lose()], ['crash', () => audio.crash(1)],
]) {
  T(3.5);
  const n = voiceCount(fn);
  ok(n > 0, `${name} makes sound (${n} sources)`);
  ok(n < 70, `${name} stays within a sane source budget (${n})`);
}
T(3.5);
const t1 = voiceCount(() => audio.comboTier(1));
T(3.5);
const t5 = voiceCount(() => audio.comboTier(5));
ok(t5 > t1, `higher combo tier = longer arpeggio (${t1} < ${t5})`);
T(3.5);
const plain = voiceCount(() => audio.turnOk(false));
T(3.5);
const perfect = voiceCount(() => audio.turnOk(true));
ok(perfect > plain, `perfect turn adds the shimmer (${plain} < ${perfect})`);
// turn() then turnOk(true) for the same corner: one stab, plus the shimmer
T(3.5);
const both = voiceCount(() => { audio.turn(); audio.turnOk(true); });
ok(both > plain && both <= perfect + 4, `turn() followed by turnOk(true) = one stab + shimmer (${both})`);
T(3.5);
const twice = voiceCount(() => { audio.turnOk(true); audio.turnOk(true); });
ok(twice === perfect, `a second turnOk(true) in the same instant adds nothing (${twice} vs ${perfect})`);
T(0.4);
const nm = voiceCount(() => { audio.nearMiss(); audio.nearMiss(); });
const nm1 = (T(1), voiceCount(() => audio.nearMiss()));
ok(nm === nm1, `near miss is rate limited (${nm} vs ${nm1})`);
T(4);
const nb = voiceCount(() => { audio.newBest(); }); T(0.5);
const nb2 = voiceCount(() => { audio.newBest(); });
ok(nb > 0 && nb2 === 0, 'newBest fires once per 3 s');

// ---- 6. mute: nothing is scheduled while muted, and everything returns after unmute
T(4);
audio.setMuted(true);
let silent = voiceCount(() => { audio.pickupStreak(); audio.turnOk(true); audio.comboTier(3); audio.newBest(); audio.popBurst(); audio.roar(1); audio.yetiNear(1); audio.nearMiss(); audio.crash(1); });
ok(silent === 0, `muted: no sound is scheduled (${silent})`);
ok(near(A.nodes.filter((n) => n.kind === 'gain').find((g) => g.out.some((d) => d && d.kind === 'biquad')).gain.events.slice(-1)[0].v, 0, 1e-9), 'muted: master gain target is 0');
audio.setMuted(false);
T(1);
ok(voiceCount(() => audio.pickupStreak()) > 0, 'unmuted: sound is back');

// ---- 7. suspend / resume / gesture lifecycle
audio.suspend();
ok(A.state === 'suspended', 'suspend() suspends the context');
T(1);
ok(voiceCount(() => audio.pickupStreak()) === 0, 'nothing is scheduled while suspended');
audio.resume(); await flush();
ok(A.state === 'running', 'resume() brings the context back');
T(1);
ok(voiceCount(() => audio.pickupStreak()) > 0, 'sound after resume');

// ---- 8. Yeti layer: footfalls speed up with proximity, cheap per frame, fades out by itself
function yetiRun(p, secs) {
  const b = A.nodes.length;
  for (let f = 0; f < secs * 60; f++) { T(1 / 60); audio.yetiNear(p); }
  return A.nodes.slice(b).filter((n) => n.kind === 'osc').length;
}
T(3);
const far = yetiRun(0.05, 3);
ok(far === 0, `Yeti far away: silent, nothing created (${far})`);
T(2);
const mid = yetiRun(0.3, 6);
T(2);
const close = yetiRun(1, 6);
ok(close > mid * 1.5, `footfalls speed up as the Yeti closes in (${mid} -> ${close})`);
const yb = A.nodes.length, eventsOf = () => A.nodes.reduce((s, n) => s + (n.gain ? n.gain.events.length : 0), 0);
const ev0 = eventsOf();
for (let f = 0; f < 6; f++) { T(1 / 60); audio.yetiNear(0.5); } // 0.1 s at a constant proximity
ok(A.nodes.length - yb <= 8, `yetiNear at a steady proximity allocates almost nothing (${A.nodes.length - yb} nodes)`);
ok(eventsOf() - ev0 <= 12, `yetiNear refreshes the bed at most every 0.2 s (${eventsOf() - ev0} param events in 0.1 s)`);
const bed = A.nodes.filter((n) => n.kind === 'gain' && n.gain.events.some((e) => e.k === 'tgt' && e.v === 0 && e.tc === 0.25));
ok(bed.length >= 1, 'Yeti bed carries the dead-man fade (fades out by itself when the game stops calling)');
if (bed.length) {
  const ev = bed[0].gain.events;
  const dm = ev[ev.length - 1];
  ok(dm.k === 'tgt' && dm.v === 0 && dm.t > A.currentTime - 1 && dm.t - A.currentTime <= 0.7, 'dead-man fade is scheduled ~0.6 s after the last call');
}

// ---- 9. music key hook (needs the runner music running)
music.init();
await flush();
const M = ctxs[1];
ok(M && M.state === 'running', 'music context created and running');
const key = globalThis.__cigMusicKey;
ok(key && typeof key.ladder === 'function' && typeof key.chord === 'function', 'music publishes __cigMusicKey');
ok(key.ladder(0) === -1 && key.chord([0, 0, 0]) === 0, 'key hook reports "no music" before start()');
for (const id of music.styles) {
  music.start(id, 100);
  const m = []; for (let i = -5; i <= 9; i++) m.push(key.ladder(i)); // (-5..-1 below the root, 0..9 = the streak's rungs)
  ok(m.every((x) => x >= 40 && x <= 103), `${id}: ladder in range (${m[5]}..${m[14]} = ${Math.round(440 * Math.pow(2, (m[14] - 69) / 12))} Hz at the top rung)`);
  let up = true; for (let i = 1; i < m.length; i++) if (m[i] < m[i - 1]) up = false;
  ok(up, `${id}: ladder never goes down`);
  ok(m[5] >= 70 - 1 && m[5] <= 81 + 1, `${id}: rung 0 sits in the 70..81 register (${m[5]})`);
  ok(m.every((x) => x === Math.floor(x)), `${id}: integer MIDI notes`);
  const ch = [0, 0, 0];
  ok(key.chord(ch) === 3 && ch[0] < ch[1] && ch[1] < ch[2] && ch[0] >= 48 && ch[2] <= 90, `${id}: chord is 3 ascending pad notes (${ch})`);
}
// without a nudge (non-fit styles) every rung is exactly in the style's scale
for (const [id, scale, root] of [['desert', [0, 1, 4, 5, 7, 8, 10], 50], ['volcano', [0, 1, 3, 5, 7, 8, 10], 40]]) {
  music.start(id, 100);
  let inScale = true;
  for (let i = 0; i <= 12; i++) { const pc = (((key.ladder(i) - root) % 12) + 12) % 12; if (!scale.includes(pc)) inScale = false; }
  ok(inScale, `${id}: every rung is in the scale`);
}
// pickups follow the music: the streak's first tone is the key's rung 0
music.start('town', 100);
T(2);
const rung = [0, 3, 7].map((i) => 440 * Math.pow(2, (key.ladder(i) - 69) / 12));
const got = [0, 3, 7].map((i) => { T(0.12); return firstFreqs(() => audio.pickupStreak(i))[0]; });
ok(got.every((g, i) => near(g, rung[i], 0.6) || near(g, 440 * Math.pow(2, (key.ladder(i) - 69) / 12), 0.6)), `pickup pitches come from the music's key (${got.map(Math.round)} vs ${rung.map(Math.round)})`);
// turn stab uses the chord of the music
T(3.5);
const stabF = firstFreqs(() => audio.turnOk(false));
const cc = [0, 0, 0]; key.chord(cc);
const wantF = cc.map((m) => 440 * Math.pow(2, (m + 12 - 69) / 12));
ok(wantF.every((w) => stabF.some((f) => near(f, w, 0.5))), `turn stab plays the music's chord (${wantF.map(Math.round)} in ${stabF.map(Math.round)})`);
// after stop(), audio falls back to the G pentatonic
music.stop();
ok(key.ladder(0) === -1, 'key hook falls silent after stop()');
T(1);
const fb = firstFreqs(() => audio.pickupStreak(0))[0];
ok(near(fb, 784, 0.6), `no music: the ladder falls back to G5 (${fb})`);

// ---- 9b. the sequencer itself plays real-time ticks without a violation (all layers, a style switch, every stinger)
{
  music.start('snow', 140);
  music.setIntensity(1);
  await new Promise((r) => setTimeout(r, 450));
  music.setStyle('neon');
  music.stinger('portal');
  music.note(); music.perfect();
  await new Promise((r) => setTimeout(r, 900));
  music.stinger('death'); music.duck(true);
  await new Promise((r) => setTimeout(r, 120));
  music.stinger('revive'); music.duck(false);
  await new Promise((r) => setTimeout(r, 200));
  ok(music.running && music.voiceCount > 0, `sequencer is running and playing (${music.voiceCount} voices)`);
  music.stop();
  ok(violations.length === 0, `music sequencer: no Web Audio violations (${violations.slice(0, 3).join(' | ')})`);
}

// ---- 10. music duck keeps the deeper dip
music.start('snow', 100);
const bus = M.nodes.find((n) => n.kind === 'gain');
ok(bus && near(bus.gain.value, 0.34, 1e-9), 'found the music bus');
const dip = globalThis.__cigMusicDip;
M.advance(1);
dip(0.5, 1.0);
const e1 = bus.gain.events.length;
dip(0.1, 0.2); // shallower and shorter: must not cut the deeper dip
ok(bus.gain.events.length === e1, 'a shallower dip does not override a deeper one that is still holding');
dip(0.55, 0.3); // deeper: replaces, keeps the later release
const last2 = bus.gain.events.slice(-2);
ok(last2[0].k === 'tgt' && near(last2[0].v, 0.34 * 0.45, 1e-6) && last2[1].v === 0.34 && last2[1].t >= M.currentTime + 0.9, 'a deeper dip replaces it and keeps the later release');
M.advance(5);
dip(0.3, 0.4);
ok(near(bus.gain.events.slice(-2)[0].v, 0.34 * 0.7, 1e-6), 'after it expired a new dip applies normally');
music.stop();

// ---- 11. samples (second pass only): dedupe and playback
if (WITH_SAMPLES) {
  T(2);
  const b = A.nodes.length;
  sfx.play('snow_crunch', { when: A.currentTime + 0.1 }); sfx.play('snow_crunch', { when: A.currentTime + 0.1 });
  const n = A.nodes.slice(b).filter((x) => x.kind === 'buffer').length;
  ok(n === 1, `the same sample started twice at the same moment plays once (${n})`);
  const n2 = (sfx.play('snow_crunch', { when: A.currentTime + 0.13 }), A.nodes.slice(b).filter((x) => x.kind === 'buffer').length);
  ok(n2 === 2, 'a later start of the same sample still plays');
}

ok(violations.length === 0, `no Web Audio violations after the full run (${violations.slice(0, 3).join(' | ')})`);
ok(errors.length === 0, `no engine errors after the full run (${errors.slice(0, 3).join(' | ')})`);
console.error = origErr;
console.log(`check-audio (${WITH_SAMPLES ? 'with samples' : 'synth only'}): ${checks} checks, ${fails} failed, ${A.nodes.length} nodes created`);
process.exit(fails ? 1 : 0);
