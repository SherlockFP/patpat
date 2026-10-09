// PARKUR - seeded, endless course generator (pure data, no THREE: runs in node too).
//
// The course runs along +z. It is a chain of modular segments; every segment starts with a short "entry" floor
// (checkpoints sit there) and then one feature (gaps, wall-run corridor, bounce pad, movers, crumbling ice...).
// Fairness: every gap / height step is sized from reach(), which integrates the SAME jump physics the player uses
// (PH below) at the slowest run speed, then keeps a safety margin. Only abilities the player has (abil) are
// counted, so a course never needs a double jump you have not unlocked. Every segment also leaves a bot "path"
// ({z, x | box, act}) that the autoplay (and the tests) follow.
import { makeRng } from '../rng.js';

// Shared physics. Units: metres, seconds. The player is a sphere (feet) + a head sphere while standing.
export const PH = {
  G: 28, JUMP: 10.5, DJ: 9.5, RUN: 9.5, RUN_MAX: 12.5, BOOST: 3.5, SLAM: 16, LAT: 7.5, AIR_LAT: 6.5,
  WR_T: 1.1, WR_G: 0.16, WJ_V: 9.5, WJ_X: 6.5, DASH_V: 21, DASH_T: 0.22, BOUNCE: 18, R: 0.42, HEAD: 0.7,
  SLIDE_T: 0.65, COYOTE: 0.11, BUFFER: 0.13,
};
const SAFE = 0.7; // fraction of the theoretical reach we ever ask for

/** horizontal reach (m) of a running jump that lands on a surface dh higher (negative = lower) */
const _reach = new Map();
export function reach(dh, abil = {}) {
  const key = Math.round(dh * 10) + '|' + (abil.dj ? 1 : 0) + (abil.dash ? 1 : 0);
  if (_reach.has(key)) return _reach.get(key);
  const dt = 1 / 240, v = PH.RUN;
  let x = 0, y = 0, vy = PH.JUMP, best = 0, dj = !!abil.dj, dash = !!abil.dash, dashT = 0;
  for (let i = 0; i < 2400; i++) {
    if (dashT > 0) { dashT -= dt; x += PH.DASH_V * dt; vy = 0; }
    else {
      if (vy <= 0 && dj) { dj = false; vy = PH.DJ; }
      else if (vy <= 0 && !dj && dash) { dash = false; dashT = PH.DASH_T; continue; }
      vy -= PH.G * dt; x += v * dt; y += vy * dt;
    }
    if (y >= dh) best = x;
    if (vy < 0 && y < dh - 0.01 && !dj && !dash) break;
  }
  _reach.set(key, best);
  return best;
}
/** highest step you can jump up onto (single jump), with margin */
export const maxStep = (abil = {}) => (PH.JUMP * PH.JUMP / (2 * PH.G) + (abil.dj ? PH.DJ * PH.DJ / (2 * PH.G) * 0.8 : 0)) * 0.72;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// segment kinds and the course index from which they appear (difficulty ramps with distance)
const KINDS = [
  ['gaps', 0, 3], ['wallrun', 1, 2.2], ['stairs', 2, 1.2], ['bounce', 3, 1.3], ['slide', 4, 1.4], ['moving', 6, 1.5],
  ['crumble', 8, 1.3], ['sweeper', 10, 1.2], ['zigzag', 13, 1.5], ['beam', 15, 1], ['bigjump', 5, 1.1],
];

export class Course {
  /**
   * seed: number; abil: {dj, dash, wrLong}; daily: fixed length time trial (segCount segments then a finish);
   * cpEvery: checkpoint every n segments.
   */
  constructor({ seed = 1, abil = {}, daily = false, segCount = 34, cpEvery = 3 } = {}) {
    this.seed = seed >>> 0 || 1; this.abil = { ...abil }; this.daily = daily; this.segCount = segCount; this.cpEvery = cpEvery;
    this.segs = []; this.next = 0; this.end = { z: 0, y: 0, x: 0 }; this.done = false; this.lastKind = '';
  }

  diff(i) { return this.daily ? lerp(0.12, 0.8, i / this.segCount) : clamp(i / 48, 0, 1); }

  /** generate segments until the course reaches z (returns the new ones) */
  ensure(z) {
    const out = [];
    while (!this.done && this.end.z < z) out.push(this.gen());
    return out;
  }

  gen() {
    const i = this.next++;
    const r = makeRng((this.seed * 2654435761 + i * 40503 + 7) >>> 0);
    const k = this.diff(i);
    const s = { i, k, z0: this.end.z, boxes: [], path: [], rings: [], cp: null, finish: null, kind: 'start', sweep: [] };
    const st = { z: this.end.z, y: this.end.y, x: this.end.x };
    const W = lerp(5.2, 3.4, k);
    if (i === 0) {
      this.floor(s, st, 16, 6);
      s.cp = { x: st.x, y: st.y, z: 3, n: 0 };
    } else if (this.daily && i >= this.segCount) {
      this.floor(s, st, 14, 6);
      s.kind = 'finish';
      s.finish = { x: st.x, y: st.y, z: s.z0 + 4 };
      this.done = true;
    } else {
      // entry floor (checkpoints live here)
      const entry = r.range(3.5, 6) * (s.i % this.cpEvery === 0 ? 1.4 : 1);
      if (i % this.cpEvery === 0) s.cp = { x: st.x, y: st.y, z: st.z + entry * 0.5, n: i / this.cpEvery };
      this.floor(s, st, entry, W);
      // pick a feature (weighted, no immediate repeats)
      const pool = KINDS.filter(([n, from]) => i >= from && n !== this.lastKind && (n !== 'bigjump' || this.abil.dj || this.abil.dash));
      let tot = 0; for (const p of pool) tot += p[2];
      let u = r.next() * tot, kind = pool[0][0];
      for (const p of pool) { u -= p[2]; if (u <= 0) { kind = p[0]; break; } }
      s.kind = kind; this.lastKind = kind;
      this[kind](s, st, r, k, W);
    }
    this.end = { z: st.z, y: st.y, x: st.x };
    s.z1 = st.z;
    s.path.sort((a, b) => a.z - b.z);
    this.segs.push(s);
    return s;
  }

  // ---------------------------------------------------------------- building blocks
  box(s, b) { s.boxes.push(b); return b; }
  /** floor slab of length len starting at st.z (top at st.y), advances st */
  floor(s, st, len, w, t = 'floor') {
    const b = this.box(s, { t, x: st.x, y: st.y - 0.6, z: st.z + len / 2, w, h: 1.2, d: len });
    s.path.push({ z: st.z + 0.5, x: st.x, y: st.y }, { z: st.z + len - 0.5, x: st.x, y: st.y });
    st.z += len;
    return b;
  }
  /** dh for the next platform: random walk that stays inside a band */
  dh(st, r, lo, hi) {
    let d = r.range(lo, hi);
    if (st.y > 7) d = -Math.abs(d); else if (st.y < -5) d = Math.abs(d);
    return d;
  }
  jump(s, z, x, act = 'jump') { s.path.push({ z, x, act }); }

  // ---------------------------------------------------------------- features
  gaps(s, st, r, k, W) {
    const n = r.int(2, 3 + Math.round(k * 2));
    for (let j = 0; j < n; j++) {
      const dh = this.dh(st, r, -1.6, lerp(0.4, 1.2, k));
      const g = clamp(reach(dh) * lerp(0.36, SAFE, k) * r.range(0.8, 1), 1.6, 9);
      this.jump(s, st.z - 0.35, st.x);
      if (r.chance(0.35)) s.rings.push({ x: st.x, y: st.y + 1.9, z: st.z + g * 0.5 });
      st.z += g; st.y += dh;
      st.x = clamp(st.x + r.range(-1.6, 1.6) * k, -3, 3);
      this.floor(s, st, r.range(lerp(5, 2.6, k), lerp(7, 3.6, k)), W * r.range(0.7, 1));
    }
  }

  bigjump(s, st, r, k, W) {
    // a gap that needs the double jump (and/or dash) you own
    const dh = this.dh(st, r, -1, 0.6);
    const g = clamp(reach(dh, this.abil) * lerp(0.55, SAFE, k), 4, 16);
    this.jump(s, st.z - 0.35, st.x);
    const z0 = st.z;
    if (g > reach(dh) * SAFE) {
      if (this.abil.dj) this.jump(s, z0 + PH.RUN * PH.JUMP / PH.G * 0.95, st.x, 'jump');
      if (this.abil.dash && g > reach(dh, { dj: this.abil.dj }) * SAFE) this.jump(s, z0 + g * 0.55, st.x, 'dash');
    }
    s.rings.push({ x: st.x, y: st.y + 2.6, z: z0 + g * 0.45 });
    st.z += g; st.y += dh;
    this.floor(s, st, r.range(5, 7), W);
  }

  stairs(s, st, r, k, W) {
    const n = r.int(2, 4), up = r.chance(0.65) || st.y < -3;
    for (let j = 0; j < n; j++) {
      const dh = up && st.y < 8 ? r.range(0.7, maxStep()) : -r.range(0.8, 1.8);
      if (dh > 0) this.jump(s, st.z - 2.2, st.x);
      const g = dh > 0 ? 0 : r.range(0, 1.2 * k);
      if (g > 0) this.jump(s, st.z - 0.35, st.x);
      st.z += g; st.y += dh;
      this.floor(s, st, r.range(3.2, 4.6), W);
    }
  }

  wallrun(s, st, r, k, W) {
    const side = r.sign(), wrT = PH.WR_T * (this.abil.wrLong ? 1.5 : 1);
    // jump (3 m drift onto the wall) + wall-run + wall-jump; SAFE of that is the longest gap we ask for
    const maxL = (3.2 + wrT * PH.RUN * 0.9 + reach(0) * 0.9) * SAFE;
    const L = clamp(lerp(7, maxL, k) * r.range(0.85, 1), 6, maxL);
    const z0 = st.z, wx = st.x + side * (W / 2 + 0.3);
    this.box(s, { t: 'wall', x: wx, y: st.y + 0.6, z: z0 + L / 2 + 0.4, w: 0.6, h: 7, d: L + 2.4 });
    this.jump(s, z0 - 0.35, st.x);
    s.path.push({ z: z0 + 0.4, x: wx });
    this.jump(s, z0 + L - reach(0) * 0.62, wx, 'jump');
    s.path.push({ z: z0 + L + 0.5, x: st.x });
    st.z += L;
    this.floor(s, st, r.range(4, 6), W);
  }

  zigzag(s, st, r, k, W) {
    const side = r.sign(), wrT = PH.WR_T * (this.abil.wrLong ? 1.5 : 1), half = 2.2;
    const L1 = clamp(lerp(8, wrT * PH.RUN * 0.75 + 3, k), 7, 13);
    const L = L1 + clamp(lerp(6, 10, k), 5, 11);
    const z0 = st.z;
    this.box(s, { t: 'wall', x: st.x + side * (half + 0.3), y: st.y + 0.6, z: z0 + L1 / 2 + 0.4, w: 0.6, h: 7, d: L1 + 1.2 });
    this.box(s, { t: 'wall', x: st.x - side * (half + 0.3), y: st.y + 0.6, z: z0 + L1 - 1 + (L - L1 + 2.5) / 2, w: 0.6, h: 7, d: L - L1 + 2.5 });
    this.jump(s, z0 - 0.35, st.x);
    s.path.push({ z: z0 + 0.4, x: st.x + side * (half + 0.3) });
    this.jump(s, z0 + L1 - 3.8, st.x + side * (half + 0.3), 'jump');
    s.path.push({ z: z0 + L1 - 3.6, x: st.x - side * (half + 0.3) });
    this.jump(s, z0 + L - reach(0) * 0.62, st.x - side * (half + 0.3), 'jump');
    s.path.push({ z: z0 + L + 0.5, x: st.x });
    st.z += L;
    this.floor(s, st, r.range(4, 6), Math.max(W, 4.4));
  }

  bounce(s, st, r, k, W) {
    this.floor(s, st, 1.2, W);
    const pz = st.z;
    this.box(s, { t: 'pad', x: st.x, y: st.y - 0.3, z: pz + 1.1, w: W, h: 0.6, d: 2.2 });
    st.z += 2.2;
    if (r.chance(0.55) && st.y < 6) {
      // up a cliff
      this.floor(s, st, 3.4, W);
      const dh = r.range(2.8, 4);
      st.y += dh;
      this.floor(s, st, r.range(5, 7), W);
    } else {
      // across a chasm
      const g = clamp(lerp(4.5, 7, k) * r.range(0.85, 1), 4, 7);
      s.rings.push({ x: st.x, y: st.y + 4.5, z: st.z + g * 0.45 });
      st.z += g;
      this.floor(s, st, r.range(5, 7), W);
    }
  }

  slide(s, st, r, k, W) {
    const n = r.int(1, 2 + Math.round(k * 2)), len = 4 + n * 4.6;
    const z0 = st.z, y = st.y;
    this.floor(s, st, len, W);
    for (let j = 0; j < n; j++) {
      const bz = z0 + 3.5 + j * 4.6;
      if (j > 0 && r.chance(0.35 + 0.2 * k)) {
        // hurdle: jump it
        this.box(s, { t: 'bar', x: st.x, y: y + 0.4, z: bz, w: W + 0.8, h: 0.8, d: 0.45 });
        this.jump(s, bz - 2.3, st.x);
      } else {
        this.box(s, { t: 'bar', x: st.x, y: y + 1.3, z: bz, w: W + 0.8, h: 0.4, d: 0.45 });
        this.box(s, { t: 'post', x: st.x - W / 2 - 0.3, y: y + 0.75, z: bz, w: 0.3, h: 1.5, d: 0.3 });
        this.box(s, { t: 'post', x: st.x + W / 2 + 0.3, y: y + 0.75, z: bz, w: 0.3, h: 1.5, d: 0.3 });
        s.path.push({ z: bz - 2.6, x: st.x, act: 'slide' });
      }
    }
  }

  moving(s, st, r, k, W) {
    const n = r.int(2, 3);
    for (let j = 0; j < n; j++) {
      const g = clamp(reach(0) * lerp(0.34, 0.55, k), 2.4, 4.5);
      this.jump(s, st.z - 0.35, st.x);
      st.z += g;
      const len = 4.2, amp = r.range(1.2, lerp(2, 3, k)), spd = r.range(0.8, lerp(1.2, 1.9, k));
      const b = this.box(s, { t: 'mover', x: st.x, y: st.y - 0.3, z: st.z + len / 2, w: 3, h: 0.6, d: len, mov: { ax: 'x', amp, spd, ph: r.range(0, 6.28), x0: st.x } });
      s.path.push({ z: st.z + 0.6, box: b, y: st.y }, { z: st.z + len - 0.5, box: b, y: st.y });
      st.z += len;
    }
    const g = clamp(reach(0) * lerp(0.3, 0.55, k), 1.8, 4.5);
    this.jump(s, st.z - 0.35, st.x);
    st.z += g;
    this.floor(s, st, 4, W);
  }

  crumble(s, st, r, k, W) {
    const n = r.int(4, 6 + Math.round(k * 3));
    for (let j = 0; j < n; j++) {
      const len = 2.2;
      this.box(s, { t: 'ice', x: st.x, y: st.y - 0.3, z: st.z + len / 2, w: W, h: 0.6, d: len - 0.1, crumble: true });
      s.path.push({ z: st.z + 1, x: st.x });
      st.z += len;
      if (k > 0.4 && j === Math.floor(n / 2)) { this.jump(s, st.z - 0.35, st.x); st.z += 2.4; }
    }
    this.floor(s, st, 4, W);
  }

  sweeper(s, st, r, k, W) {
    const len = 14, z0 = st.z, y = st.y;
    this.floor(s, st, len, Math.max(W, 4.6));
    const pz = z0 + len / 2;
    this.box(s, { t: 'pillar', x: st.x, y: y + 1, z: pz, w: 0.8, h: 2, d: 0.8 });
    s.sweep.push({ x: st.x, y: y + 0.45, z: pz, len: Math.max(W, 4.6) / 2 + 0.6, w: r.sign() * r.range(1.6, lerp(2.2, 3.2, k)), a: r.range(0, 6.28) });
    const lane = st.x + r.sign() * 1.6;
    s.path.push({ z: pz - 5, x: lane });
    this.jump(s, pz - 3.2, lane);
    s.path.push({ z: pz + 3, x: lane }, { z: z0 + len - 0.5, x: st.x });
  }

  beam(s, st, r, k, W) {
    const len = r.range(8, 12), bx = st.x + r.range(-1, 1);
    this.jump(s, st.z - 0.35, bx);
    st.z += 1.8;
    this.box(s, { t: 'beam', x: bx, y: st.y - 0.3, z: st.z + len / 2, w: lerp(1.6, 1, k), h: 0.6, d: len });
    s.path.push({ z: st.z + 0.5, x: bx }, { z: st.z + len - 0.5, x: bx });
    st.z += len;
    this.jump(s, st.z - 0.35, bx);
    st.z += 1.8;
    this.floor(s, st, 4.5, W);
  }
}
