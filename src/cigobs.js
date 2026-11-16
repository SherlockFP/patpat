// cigobs.js — ÇIĞ ENGELLERİ: things you must steer around (rock outcrops, ice walls with a gap, crevasses, spiked fences, frozen lakes,
// snow groomers, rolling log piles, falling icicles). Plan side (pure data): obsItem() builds one 'obst' plan item (the same n + seed
// always gives the same items); runtime side: CigObs turns an item into shapes, moves the moving ones, tests the ball against them,
// draws them with the CigPlus templates and answers the bot (lane()). Hits go to CigGame._obstHit, near misses to CigGame._nearMiss.
//
// Sizes come from the size the plan EXPECTS at that distance (pr = world.expectAt), so a mountain's rocks are as big as its ball.
// Every shape is a circle (c = 1) or a rect (x, d = centre, rx, rd = half sizes) on the ground plane; the ball is a circle.
import { tierOf } from './config.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// first mountain that has each kind (the first one of a kind is its tutorial: it is the first obstacle of that mountain)
export const OBS_AT = { rock: 2, wall: 4, crev: 5, lake: 6, fence: 7, groomer: 9, logs: 11, icicle: 13 };
// metres of track one item reserves
export const OBS_LEN = { rock: 50, wall: 36, crev: 44, fence: 36, lake: 84, groomer: 44, logs: 50, icicle: 50 };
// one-word first-time labels
export const OBS_WORD = { rock: 'KAYA', wall: 'DUVAR', crev: 'YARIK', lake: 'GÖL', fence: 'ÇİT', groomer: 'PALET', logs: 'KÜTÜK', icicle: 'SARKIT' };
// share of the ball's volume a hit takes (before the mountain 1-3 teaching discount, see CigGame._obstHit)
const DMG = { rock: 0.3, wall: 0.34, crev: 0.3, fence: 0.3, groomer: 0.32, logs: 0.32, icicle: 0.24 };
// kinds that a jumping ball clears
const LOW = { crev: 1, fence: 1, groomer: 1, logs: 1 };

// the hazard sits near the start of its slot and the rest is a clear run-out: 1.1 s at the speed the mountain is rolled at (about 22 + 3.4 n m/s), so two
// hazards are never closer than a steering move apart
export const obsLen = (k, n) => OBS_LEN[k] + Math.round(1.1 * (22 + 3.4 * n));

// how many hazards a mountain has: 1-3 teach (1, 2), then 3 at DAĞ 4 growing to 13 at DAĞ 40
export const obsCount = (n) => (n < 2 ? 0 : n === 2 ? 1 : n === 3 ? 2 : Math.round(3 + 0.25 * (n - 3)));

const r2 = (v) => Math.round(v * 100) / 100;

// One plan item. rng = the plan's own obstacle stream; n = mountain number (endless: 4 + distance / 400); k = kind.
export function obsItem(k, start, rng, n) {
  const dif = clamp((n - 4) / 36, 0, 1);   // 0 at DAĞ 4 .. 1 at DAĞ 40: gaps narrow, groomers speed up
  const it = { kind: 'obst', k, start, len: obsLen(k, n), at: start + 14 };
  switch (k) {
    case 'rock': it.xf = r2(rng.range(-0.15, 0.15)); it.rk = r2(rng.range(0.9, 1.25)); break;   // (one rock per item: two in a row would leave no time to steer on the fast mountains)
    case 'wall': it.gxf = r2(rng.sign() * rng.range(0.3, 0.6)); it.gk = r2(5.6 - 1.0 * dif); break;   // gap centre (share of the half width), gap width in plan radii
    case 'crev': it.side = rng.sign(); it.gk = r2(5.6 - 1.0 * dif); break;                              // the crack spans the track from one side and leaves a lane of gk plan radii on the other
    case 'fence': it.side = rng.sign(); it.fw = r2(0.42 + 0.1 * dif); break;                              // spikes from one edge over this share of the track width
    case 'lake': it.cxf = r2(rng.range(-0.2, 0.2)); it.lw = r2(rng.range(0.3, 0.42)); it.rock = n >= 10 ? r2(rng.range(-0.1, 0.1)) : null; break;   // (from DAĞ 10 a rock waits at the far end)
    case 'groomer': it.ph = r2(rng.range(0, TAU)); it.vk = r2(1.9 + 0.8 * dif);   // sideways speed in plan radii per second (a groomer must be outwaited, never outrun) break;
    case 'logs': it.side = rng.sign(); break;
    case 'icicle': { const s = rng.sign(); it.ox = n < 16 ? [0, r2(s * 0.24)] : [0, r2(s * 0.24), r2(-s * 0.24)]; break; }
    default: break;
  }
  return it;
}

let SEEN = null;   // kinds whose one-word label was shown once (kept across runs)
function seen(k, add) {
  if (!SEEN) { SEEN = {}; try { SEEN = JSON.parse(localStorage.getItem('cig.obsSeen') || '{}') || {}; } catch { SEEN = {}; } }
  if (add) { SEEN[k] = 1; try { localStorage.setItem('cig.obsSeen', JSON.stringify(SEEN)); } catch { /* ignore */ } }
  return !!SEEN[k];
}

export class CigObs {
  constructor(plus) {
    this.plus = plus;
    this.list = [];
    this.t = 0;
    this.labels = [];
  }

  reset() { this.list.length = 0; this.t = 0; this._clearLabels(); }

  _clearLabels() {
    const w = this.plus.world;
    for (const s of this.labels) { if (w && w.group) w.group.remove(s); s.material.map.dispose(); s.material.dispose(); }
    this.labels.length = 0;
  }

  dispose() { this._clearLabels(); this.list.length = 0; }

  // ---- build: a plan item -> runtime obstacles + the rich food on the dangerous line
  add(it) {
    const w = this.plus.world, gr = Math.max(0.5, this.plus._expR() / 1.15);
    const hw = w.halfWidth(it.at), k = it.k;
    const pr = Math.max(0.5, w.expectAt(it.at), 1.3 * this.plus.ballR, 0.22 * hw);   // (the early mountains have a track 25 balls wide: a hazard the size of the ball would be a pebble there)
    const mk = (o) => { o.k = o.k || k; o.pr = pr; o.hit = false; o.clr = 9; o.gone = false; o.dmg = DMG[o.k] || 0.2; o.low = !!LOW[o.k]; this.list.push(o); return o; };
    const food = (x, d, n, step, q = 1.3) => {
      const T = tierOf(gr);
      for (let i = 0; i < n; i++) w.food1(clamp(w.rollQ(T) * q, 0.2, 0.85), gr, clamp(x, -hw + 1, hw - 1), d + i * step, hw, { spacing: 0.1 });
    };
    switch (k) {
      case 'rock': {
        const rr = it.rk * pr, x = clamp(it.xf * hw, -hw + rr, hw - rr), d = it.start + 14;
        mk({ d, rr, rot: it.rk * 7, sh: [{ x, d, rx: 0.85 * rr, rd: 0.85 * rr, c: 1 }] });
        food(x + (it.xf >= 0 ? 1 : -1) * (rr * 1.5 + gr), d - 6, 3, 5);   // the line that hugs the rock pays best
        break;
      }
      case 'wall': {
        const d = it.start + 14, gap = Math.min(it.gk * pr, 1.2 * hw), gx = clamp(it.gxf * hw, -hw + gap / 2 + 0.6 * pr, hw - gap / 2 - 0.6 * pr), th = 0.6 * pr, out = hw + 3 * pr;
        const a = -out, b1 = gx - gap / 2, c0 = gx + gap / 2, e = out;
        mk({ d, gx, gap, th, sh: [{ x: (a + b1) / 2, d, rx: (b1 - a) / 2, rd: th }, { x: (c0 + e) / 2, d, rx: (e - c0) / 2, rd: th }] });
        food(gx, d - 26, 5, 6);
        break;
      }
      case 'crev': {
        const d = it.start + 20, th = 1.5 * pr, gap = Math.min(it.gk * pr, 1.2 * hw), x0 = it.side < 0 ? -hw - 3 * pr : -hw + gap, x1 = it.side < 0 ? hw - gap : hw + 3 * pr;
        mk({ d, th, side: it.side, sh: [{ x: (x0 + x1) / 2, d, rx: (x1 - x0) / 2, rd: th }] });
        food(it.side < 0 ? hw - gap / 2 : -hw + gap / 2, d - 14, 6, 5);
        break;
      }
      case 'fence': {
        const d = it.start + 14, cover = Math.min(it.fw * 2 * hw, 2 * hw - Math.min(4.2 * pr, 1.2 * hw)), x0 = it.side < 0 ? -hw - 2 * pr : hw - cover, x1 = it.side < 0 ? -hw + cover : hw + 2 * pr;
        mk({ d, side: it.side, sh: [{ x: (x0 + x1) / 2, d, rx: (x1 - x0) / 2, rd: 0.5 * pr }] });
        food(it.side < 0 ? (-hw + cover + hw) / 2 : (hw - cover - hw) / 2, d - 8, 4, 5);
        break;
      }
      case 'lake': {
        const d = it.start + 36, rx = it.lw * hw, rd = 6.5 * pr, cx = it.cxf * hw;
        mk({ d, lx: cx, rx, rd, sh: [] });   // (no hit shape: the lake only makes you slide)
        food(cx, d - rd * 0.6, 6, rd * 0.22);
        if (it.rock !== null) mk({ k: 'rock', d: d + rd + 12, rr: 1.1 * pr, rot: 2, sh: [{ x: it.rock * hw, d: d + rd + 12, rx: 0.94 * pr, rd: 0.94 * pr, c: 1 }] });
        break;
      }
      case 'groomer': {
        const d = it.start + 20, s = 0.9 * pr, A = Math.max(0, hw - 0.85 * pr);
        mk({ d, s, A, ph: it.ph, w: (it.vk * pr) / Math.max(A, pr), vx: 0, sh: [{ x: 0, d, rx: 1.7 * s, rd: 1.0 * s }] });
        food(0, d - 12, 4, 8);
        break;
      }
      case 'logs': {
        const d = it.start + 25, s = 1.0 * pr;
        mk({ d, s, side: it.side, state: 0, vx: 0, spin: 0, sh: [{ x: 0, d, rx: 1.05 * s, rd: 1.0 * s, off: true }] });
        food(0, d - 10, 4, 7);
        break;
      }
      case 'icicle': {
        const d = it.start + 25;
        mk({ d, ox: it.ox, state: 0, sh: it.ox.map(() => ({ x: 0, d, rx: 1.0 * pr, rd: 1.0 * pr, c: 1, off: true, tt: 0 })) });
        food(0, d - 10, 4, 7);
        break;
      }
      default: break;
    }
  }

  // ---- per frame (active run only)
  update(dt, b, G, game) {
    this.t += dt;
    const w = this.plus.world, L = this.list, rb = 0.82 * b.r;
    G.lakeT = Math.max(0, (G.lakeT || 0) - dt);
    for (let i = 0; i < L.length; i++) {
      const o = L[i];
      if (o.gone) continue;
      const dd = o.d - b.d;
      if (dd < -(6 * o.pr + 2 * b.r + 40)) { o.gone = true; this._dropLabel(o); continue; }
      if (dd > 520 + 3 * b.speed) continue;
      const hw = w.halfWidth(o.d);
      switch (o.k) {
        case 'groomer': {
          const a = o.ph + o.w * this.t;
          o.sh[0].x = o.A * Math.sin(a); o.vx = o.A * o.w * Math.cos(a);
          break;
        }
        case 'logs': this._logs(o, b, dt, hw, dd); break;
        case 'icicle': this._icicles(o, b, dt, hw, dd, game); break;
        case 'lake': {
          const u = (b.x - o.lx) / (o.rx + 0.3 * b.r), v = (b.d - o.d) / o.rd;
          if (!b.airborne && u * u + v * v < 1) G.lakeT = 0.25;
          break;
        }
        default: break;
      }
      if (dd < 60 && o.k !== 'lake' && !seen(o.k) && dd > 0 && G.t > 1) this._label(o, w);
      // hit test + clearance for near misses
      let best = 99;
      for (let s = 0; s < o.sh.length; s++) {
        const S = o.sh[s];
        if (S.off) continue;
        const dx = Math.abs(b.x - S.x), dz = Math.abs(b.d - S.d);
        let gx, gd;
        if (S.c) { gx = Math.hypot(dx, dz) - S.rx; gd = 0; } else { gx = Math.max(dx - S.rx, 0); gd = Math.max(dz - S.rd, 0); }
        const gap = S.c ? gx - rb : Math.hypot(gx, gd) - rb;
        if (gap < 0 && !o.hit && !(o.low && b.airborne)) { o.hit = true; this._hit(o, S, b, game, hw); break; }
        if (dz <= (S.c ? S.rx : S.rd) + rb) best = Math.min(best, dx - S.rx - rb);   // lateral room while abreast
      }
      if (!o.hit && o.k !== 'lake') {
        if (best < 99) o.clr = Math.min(o.clr, best / b.r);
        let past = -1e9;
        for (let s = 0; s < o.sh.length; s++) past = Math.max(past, o.sh[s].d + (o.sh[s].c ? o.sh[s].rx : o.sh[s].rd));
        if (!o.near && b.d - b.r > past && o.clr < 0.55 && o.clr > -1) { o.near = true; game._nearMiss(o); }
      }
    }
  }

  _hit(o, S, b, game, hw) {
    const lim = Math.max(0.5, hw - b.r * 0.55);
    if (o.k === 'wall') {
      const side = Math.sign(o.gx - S.x) || 1;
      b.x = clamp(side > 0 ? S.x + S.rx + 0.82 * b.r + 0.1 : S.x - S.rx - 0.82 * b.r - 0.1, -lim, lim);
      b.vx = side * (4 + 0.2 * b.speed);
    } else if (o.k === 'crev') {
      const side = -o.side;
      b.x = clamp(S.x + side * (S.rx + 0.82 * b.r + 0.1), -lim, lim);
      b.vx = side * (3 + 0.15 * b.speed);
      b.airborne = true; b.airTime = 0; b.vy = 7 + 0.2 * b.r;   // (the ball claws its way out of the crack)
    } else {
      const side = Math.sign(b.x - S.x) || (Math.random() < 0.5 ? -1 : 1);
      const reach = S.c ? S.rx : S.rx;
      b.x = clamp(S.x + side * (reach + 0.82 * b.r + 0.1), -lim, lim);
      b.vx = side * (4 + 0.2 * b.speed);
    }
    game._obstHit(o.dmg, o.k, o);
  }

  _logs(o, b, dt, hw, dd) {
    const S = o.sh[0];
    if (o.state === 0) {
      const trig = Math.max(95, 2.5 * b.speed);
      if (dd < trig && dd > 0) {   // the pile starts at one side and is aimed at where you will be when you arrive
        o.state = 1;
        const tA = clamp(dd / Math.max(b.speed, 8), 1.6, 3), xs = o.side * (hw + 1.5 * o.s), xa = clamp(b.x + b.vx * 0.3, -hw * 0.85, hw * 0.85);
        S.x = xs; S.off = false; o.vx = (xa - xs) / tA;
        this.plus._call('sfx', 'rumble');
      }
    } else if (o.state === 1) {
      S.x += o.vx * dt; o.spin += o.vx * dt / Math.max(0.5, o.s);
      if (Math.abs(S.x) > hw + 3 * o.s && Math.sign(S.x) === Math.sign(o.vx)) { o.state = 2; S.off = true; }
    }
  }

  _icicles(o, b, dt, hw, dd, game) {
    if (o.state === 0) {
      const trig = Math.max(60, 1.5 * b.speed);   // (the first one lands 1.4 s later, about where the hazard sits)
      if (dd < trig && dd > -20) {   // aimed at the lane you are in; the ground marks show where each one lands
        o.state = 1;
        for (let i = 0; i < o.sh.length; i++) {
          const S = o.sh[i], tt = 1.4 + 0.35 * i;
          S.tt = tt; S.off = true; S.fx = false;
          S.x = clamp(b.x + b.vx * 0.3 + o.ox[i] * hw, -hw * 0.92, hw * 0.92);
          S.d = b.d + b.speed * tt;
        }
        this.plus._call('sfx', 'rumble');
      }
      return;
    }
    if (o.state !== 1) return;
    let live = 0;
    for (let i = 0; i < o.sh.length; i++) {
      const S = o.sh[i];
      S.tt -= dt;
      if (S.tt > 0) { live++; continue; }
      if (!S.fx) { S.fx = true; S.off = false; const p = this.plus; p._burst(S.x, p.world.groundY(S.x, S.d) + 0.4 * o.pr, S.d, 14, 0xd8f4ff, 8, 0.2 + 0.1 * o.pr, 4); p._call('sfx', 'crash'); game.G.shake += 0.25; }
      if (S.tt > -0.3) live++; else S.off = true;
    }
    if (!live) o.state = 2;
  }

  _label(o, w) {
    if (o.lab) return;
    o.lab = true;
    seen(o.k, true);
    const spr = w.makeLabel(OBS_WORD[o.k] + '!', '#ff5a4a');
    if (!spr) return;
    const s = clamp(o.pr * 3.2, 5, 60);
    spr.scale.set(s, s * 0.3, 1);
    const S = o.sh[0];
    spr.position.set(S ? S.x : 0, w.groundY(S ? S.x : 0, o.d) + o.pr * 3.2, -o.d);
    w.group.add(spr);
    o.spr = spr;
    this.labels.push(spr);
  }

  _dropLabel(o) {
    if (!o.spr) return;
    const w = this.plus.world, i = this.labels.indexOf(o.spr);
    if (i >= 0) this.labels.splice(i, 1);
    w.group.remove(o.spr); o.spr.material.map.dispose(); o.spr.material.dispose(); o.spr = null;
  }

  // ---- bot: steering penalty of lane x (ball radius r) for the hazards in the next `look` metres (moving ones at the place they will be on arrival)
  lane(x, r, look, speed, b) {
    const L = this.list, sp = Math.max(speed, 8), tMove = 0.3 + Math.abs(x - b.x) / (0.7 * (30 + 3 * r));   // (0.3 s reaction + the sideways run)
    let s = 0;
    for (let i = 0; i < L.length; i++) {
      const o = L[i];
      if (o.gone || o.k === 'lake') continue;
      for (let q = 0; q < o.sh.length; q++) {
        const S = o.sh[q];
        const dd = S.d - b.d;
        if (dd < -(S.c ? S.rx : S.rd) - r || dd > look) continue;
        let sx = S.x;
        const tA = Math.max(0, dd) / sp;
        if (o.k === 'groomer') sx = o.A * Math.sin(o.ph + o.w * (this.t + tA));
        else if (o.k === 'logs') { if (o.state === 2) continue; if (o.state === 0) { if (dd > Math.max(95, 2.5 * b.speed) * 1.1) continue; sx = b.x; } else sx = S.x + o.vx * tA; }
        else if (o.k === 'icicle') { if (o.state === 2 || S.tt < -0.3) continue; if (o.state === 0) continue; }
        const xe = b.x + (x - b.x) * Math.min(1, tA / tMove);   // where the ball is when it gets there if it heads for lane x now
        const e = Math.abs(xe - sx) - S.rx;   // (clear by under 1.15 balls = a hit once the human wobble is counted in; under 1.7 = too close for comfort; a hit outweighs any food)
        if (e < 1.15 * r) s -= o.k === 'wall' || o.k === 'crev' ? 400 : 200; else if (e < 1.7 * r) s -= 30;
      }
    }
    return s;
  }

  // ---- drawing (CigPlus templates; S = solid mesh, Gl = glow mesh)
  draw(S, Gl, TP, t, b) {
    const L = this.list, w = this.plus.world;
    const lo = b.d - 60, hi = b.d + 520 + 3 * b.speed;
    for (let i = 0; i < L.length; i++) {
      const o = L[i];
      if (o.gone || o.d < lo || o.d > hi) continue;
      const pr = o.pr, pulse = 0.55 + 0.35 * Math.sin(t * 7 + o.d);
      const warnA = clamp(1.4 - Math.max(0, o.d - b.d) / (6 * b.speed + 80), 0.18, 1) * pulse;   // red mark: fades in as you close in
      switch (o.k) {
        case 'rock': {
          const x = o.sh[0].x, d = o.sh[0].d, gy = w.groundY(x, d), rr = o.rr;
          Gl.emit(TP.disc, x, gy + 0.2, -d, 0, rr * 1.35, 1, rr * 1.35, this._tilt(x, d), 0, 1, 0.2, 0.15, 0.6 * warnA);
          S.emit(TP.rock, x, gy - 0.1 * rr, -d, o.rot, rr, rr * 1.7, rr * (0.85 + 0.1 * Math.sin(o.rot)), 0, 0, 0.74, 0.78, 0.86, 1);   // (tall: a rock the size of the ball would hide in the distance)
          break;
        }
        case 'wall':
          for (let s = 0; s < 2; s++) {
            const q = o.sh[s], h = 2.8 * pr, hwq = w.halfWidth(q.d), gy = w.groundY(clamp(q.x, -hwq, hwq), q.d);
            S.emit(TP.cube, q.x, gy + h / 2 - 0.25 * pr, -q.d, 0, q.rx * 2, h, q.rd * 2, 0, 0, 0.45, 0.78, 1, 1);
            S.emit(TP.cube, q.x, gy + h - 0.15 * pr, -q.d, 0, q.rx * 2 + 0.2 * pr, 0.3 * pr, q.rd * 2 + 0.2 * pr, 0, 0, 0.93, 0.98, 1, 1);
            Gl.emit(TP.lane, q.x, gy + 0.22, -q.d, 0, q.rx * 2, 1, q.rd * 2 + 2.4 * pr, this._tilt(q.x, q.d), 0, 1, 0.2, 0.15, 0.6 * warnA);
          }
          S.emit(TP.cube, o.gx - o.gap / 2, w.groundY(o.gx - o.gap / 2, o.d) + 2.1 * pr, -o.d, 0, 0.4 * pr, 4.2 * pr, 0.4 * pr, 0, 0, 1, 0.3, 0.22, 1);   // red posts mark the gap
          S.emit(TP.cube, o.gx + o.gap / 2, w.groundY(o.gx + o.gap / 2, o.d) + 2.1 * pr, -o.d, 0, 0.4 * pr, 4.2 * pr, 0.4 * pr, 0, 0, 1, 0.3, 0.22, 1);

          break;
        case 'crev': {
          const q = o.sh[0], gy = w.groundY(q.x, q.d), tl = this._tilt(q.x, q.d);
          Gl.emit(TP.lane, q.x, gy + 0.25, -q.d, 0, q.rx * 2 + 0.6 * pr, 1, q.rd * 2 + 1.4 * pr, tl, 0, 1, 0.2, 0.15, 0.6 * warnA);
          S.emit(TP.cube, q.x, gy + 0.08, -q.d, 0, q.rx * 2, 0.16, q.rd * 2, tl, 0, 0.03, 0.06, 0.14, 1);
          S.emit(TP.cube, q.x, gy + 0.35 * pr, -q.d - q.rd, 0, q.rx * 2, 0.7 * pr, 0.3 * pr, tl, 0, 0.9, 0.96, 1, 1);   // snow lips on both sides make the crack read from afar
          S.emit(TP.cube, q.x, gy + 0.35 * pr, -q.d + q.rd, 0, q.rx * 2, 0.7 * pr, 0.3 * pr, tl, 0, 0.9, 0.96, 1, 1);
          this._bang(Gl, TP, t, o.side < 0 ? q.x + q.rx + 1.2 * pr : q.x - q.rx - 1.2 * pr, q.d, pr, warnA);
          break;
        }
        case 'fence': {
          const q = o.sh[0], gy = w.groundY(q.x, q.d), n = clamp(Math.round((q.rx * 2) / (1.1 * pr)), 3, 14), step = (q.rx * 2) / n;
          Gl.emit(TP.lane, q.x, gy + 0.22, -q.d, 0, q.rx * 2 + pr, 1, 3 * pr, this._tilt(q.x, q.d), 0, 1, 0.2, 0.15, 0.6 * warnA);
          S.emit(TP.cube, q.x, gy + 0.95 * pr, -q.d, 0, q.rx * 2, 0.26 * pr, 0.26 * pr, 0, 0, 0.32, 0.26, 0.24, 1);
          for (let k = 0; k <= n; k++) {
            const x = q.x - q.rx + k * step, g = w.groundY(x, q.d);
            S.emit(TP.cube, x, g + 0.7 * pr, -q.d, 0, 0.26 * pr, 1.5 * pr, 0.26 * pr, 0, 0, 0.42, 0.34, 0.3, 1);
            S.emit(TP.spike, x, g + 1.7 * pr, -q.d, 0, 0.45 * pr, 1.2 * pr, 0.45 * pr, 0, 0, 0.9, 0.2, 0.18, 1);
          }
          break;
        }
        case 'lake': {
          const gy = w.groundY(o.lx, o.d), tl = this._tilt(o.lx, o.d);
          S.emit(TP.disc, o.lx, gy + 0.16, -o.d, 0, o.rx, 1, o.rd, tl, 0, 0.52, 0.82, 1, 1);
          S.emit(TP.disc, o.lx, gy + 0.22, -o.d, 0.5, o.rx * 0.72, 1, o.rd * 0.72, tl, 0, 0.76, 0.94, 1, 1);
          Gl.emit(TP.ring, o.lx, gy + 0.3, -o.d, 0, o.rx, o.rd, 1, tl + Math.PI / 2, 0, 0.8, 0.95, 1, 0.6);
          break;
        }
        case 'groomer': {
          const q = o.sh[0], gy = w.groundY(q.x, q.d);
          Gl.emit(TP.lane, 0, gy + 0.22, -q.d, 0, o.A * 2 + 2 * q.rx, 1, 2.6 * q.rd, this._tilt(0, q.d), 0, 1, 0.2, 0.15, 0.6 * warnA);
          S.emit(TP.groomer, q.x, gy + 0.05, -q.d, o.vx >= 0 ? 0 : Math.PI, o.s * 1.35, o.s * 1.35, o.s * 1.35, this._tilt(q.x, q.d) * 0.6, 0, 1, 1, 1, 1);
          this._bang(Gl, TP, t, q.x, q.d, pr, warnA * 1.4);
          break;
        }
        case 'logs': {
          const q = o.sh[0];
          if (o.state === 2) break;
          const gy = w.groundY(q.x, q.d), W = (o.state === 0 ? 0 : 1);
          Gl.emit(TP.lane, 0, gy + 0.22, -q.d, 0, 2 * (this.plus.world.halfWidth(q.d) + pr), 1, 2.4 * o.s, this._tilt(0, q.d), 0, 1, 0.2, 0.15, (o.state === 0 ? 0.12 : 0.34) * Math.max(warnA, 0.5 * W));
          if (o.state === 1) S.emit(TP.logs, q.x, gy + 0.05, -q.d, 0, o.s * 1.3, o.s * 1.3, o.s * 1.3, 0, o.spin, 1, 1, 1, 1);
          this._bang(Gl, TP, t, o.state === 1 ? q.x : -o.side * 0.8 * w.halfWidth(o.d), q.d, pr, Math.max(warnA, 0.4));
          break;
        }
        case 'icicle':
          for (let s = 0; s < o.sh.length; s++) {
            const q = o.sh[s];
            if (o.state === 0) continue;
            if (o.state === 2 || q.tt < -0.3) continue;
            const gy = w.groundY(q.x, q.d), k = clamp(1 - Math.max(0, q.tt) / 1.4, 0, 1);
            Gl.emit(TP.disc, q.x, gy + 0.2, -q.d, 0, q.rx, 1, q.rx, this._tilt(q.x, q.d), 0, 1, 0.2, 0.15, 0.3 + 0.35 * k);
            Gl.emit(TP.ring, q.x, gy + 0.3, -q.d, 0, q.rx * (1.0 - 0.3 * k), q.rx * (1.0 - 0.3 * k), 1, Math.PI / 2, 0, 1, 0.3, 0.2, 0.8);
            if (q.tt > 0) { const h = 0.3 + 14 * pr * (q.tt / 1.6) ** 2; S.emit(TP.icicle, q.x, gy + h, -q.d, q.tt * 5, 0.55 * pr, 2.6 * pr, 0.55 * pr, 0, 0, 1, 1, 1, 1); }
          }
          break;
        default: break;
      }
    }
  }

  _tilt(x, d) { const w = this.plus.world; return -Math.atan((w.groundY(x, d - 1) - w.groundY(x, d + 1)) / 2); }

  // the '!' lane hint over a moving hazard / a crack
  _bang(Gl, TP, t, x, d, pr, a) {
    const w = this.plus.world, gy = w.groundY(x, d);
    Gl.emit(TP.bang, x, gy + 2.6 * pr + 0.25 * pr * Math.sin(t * 6), -d, 0, 0.9 * pr, 0.9 * pr, 0.9 * pr, 0, 0, 1, 0.25, 0.2, clamp(a, 0, 1));
  }
}
