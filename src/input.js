// One-thumb relative drag steering (ÇIĞ) + swipe gestures (YETİ RUSH) + keyboard fallback for desktop testing.
//
// Swipe rules (runner):
//  * lane: one lane per gesture. 28 px of mostly-horizontal travel from the anchor fires it; the anchor then moves to the
//    finger. A second lane in the SAME direction needs another 150 px; reversing the finger by 24 px fires the opposite lane.
//  * jump / duck: a vertical flick measured over the last 120 ms of finger travel (so "touch, hesitate, flick" works and
//    "lane swipe, then up" works inside one touch). After every action the gesture re-anchors.
//  * endGesture(): the game says "this touch already did its job" (e.g. it was a junction turn): the rest of the touch is ignored.
//  * swipe on release: a quick short flick (REL_PX in under REL_MS) that never reached the live thresholds above still fires
//    once when the finger lifts, so no swipe is ever dropped just for being small.
const LANE_PX = 28;        // travel that fires a lane change
const REL_PX = 16;         // a flick this long (> the 14 px tap slop) fires on release
const REL_MS = 200;        // ... when the whole touch lasted less than this
const LANE_MORE_PX = 150;  // extra travel for a second lane in the same direction
const LANE_BACK_PX = 24;   // reversing by this much fires the opposite lane
const FLICK_PX = 36;       // vertical travel inside FLICK_MS that fires jump / duck
const FLICK_MS = 120;
const SLOW_V_PX = 52;      // a slow, mostly-vertical drag from the anchor still counts (no dead zone between lane and flick)
const RING = 10;

export class Input {
  constructor(el) {
    this.dx = 0;
    this.down = false;
    this.pointerId = null;
    this.lastX = 0;
    this.keys = { left: false, right: false };
    this.tapHandlers = [];
    this.jumpQueued = false;
    this.swipe = { x: 0, y: 0, t: 0 };   // touch-down point (tap / double-tap detection)
    this.laneQueued = 0;   // endless mode: discrete lane changes (Subway Surfers style)
    this.diveQueued = false;
    this.doubleTapQueued = false; // endless mode: activate the sled shield
    this.lastTapT = 0;
    // gesture state (runner)
    this.ax = 0; this.ay = 0;        // anchor: where the last action fired (or the touch-down point)
    this.hDir = 0;                   // direction of the last horizontal action in this touch (0 = none yet)
    this.extX = 0;                   // furthest finger x along hDir since the last action
    this.swallow = false;            // endGesture(): ignore the rest of this touch
    this.fired = false;              // this touch already fired a lane / jump / duck (no release-flick on top)
    this.ring = new Float64Array(RING * 3);   // last pointer samples: t, x, y
    this.ringN = 0; this.ringI = 0;

    el.addEventListener('pointerdown', (e) => {
      // A second finger (two-thumb players overlap by a few ms) takes over: the newest touch is the one that steers.
      this.pointerId = e.pointerId;
      this.down = true;
      this.lastX = e.clientX;
      const now = performance.now();
      this.swipe.x = e.clientX; this.swipe.y = e.clientY; this.swipe.t = now;
      this.swallow = false;
      this.fired = false;
      this.hDir = 0;
      this.anchor(e.clientX, e.clientY);
      this.ringN = 0; this.ringI = 0;
      this.pushSample(now, e.clientX, e.clientY);
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      const last = evs && evs.length ? evs[evs.length - 1] : e;
      const x = last.clientX, y = last.clientY;
      this.dx += x - this.lastX;
      this.lastX = x;
      if (this.swallow) return;
      const now = performance.now();
      this.pushSample(now, x, y);
      this.gesture(now, x, y);
    });
    const up = (e) => {
      if (e.pointerId !== this.pointerId) return;
      const spent = this.swallow || this.fired;      // this touch already did its job (a live swipe, or the game used it)
      this.pointerId = null;
      this.down = false;
      this.swallow = false;
      const sw = this.swipe, now = performance.now();
      // Swipe on release: a quick short flick that never reached the live thresholds still counts, once.
      if (!spent && e.type === 'pointerup' && now - sw.t < REL_MS) {
        const dx = e.clientX - sw.x, dy = e.clientY - sw.y, ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax >= REL_PX && ax > ay * 1.2) this.fireLane(Math.sign(dx), e.clientX, e.clientY);
        else if (ay >= REL_PX && ay > ax * 1.2) this.fireVertical(dy < 0, e.clientX, e.clientY);
      }
      // A tap = short press with little travel; two taps within 300 ms = double-tap.
      if (now - sw.t < 220 && Math.abs(e.clientX - sw.x) < 14 && Math.abs(e.clientY - sw.y) < 14) {
        if (now - this.lastTapT < 300) { this.doubleTapQueued = true; this.lastTapT = 0; } else this.lastTapT = now;
      }
      for (const h of this.tapHandlers) h(e);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // iOS still pinch-zooms despite the viewport meta; kill gestures outright.
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = true;
      if ((e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && !e.repeat) this.jumpQueued = true;
      if ((e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') && !e.repeat) this.diveQueued = true;
      if (!e.repeat && (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A')) this.laneQueued = Math.max(-2, this.laneQueued - 1);
      if (!e.repeat && (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D')) this.laneQueued = Math.min(2, this.laneQueued + 1);
    });
    // Losing focus mid-press must not leave a key "held".
    window.addEventListener('blur', () => { this.keys.left = this.keys.right = false; this.dx = 0; this.pointerId = null; this.down = false; this.swallow = false; });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = false;
    });
  }

  onRelease(fn) { this.tapHandlers.push(fn); }

  anchor(x, y) { this.ax = x; this.ay = y; this.extX = x; }

  pushSample(t, x, y) {
    const i = this.ringI, r = this.ring;
    r[i * 3] = t; r[i * 3 + 1] = x; r[i * 3 + 2] = y;
    this.ringI = (i + 1) % RING;
    if (this.ringN < RING) this.ringN++;
  }

  fireLane(d, x, y) {
    this.laneQueued = Math.max(-2, Math.min(2, this.laneQueued + d));
    this.hDir = d;
    this.fired = true;
    this.anchor(x, y);
    this.ringN = 0;                       // a new action starts a fresh flick window
  }

  fireVertical(up, x, y) {
    if (up) this.jumpQueued = true; else this.diveQueued = true;
    this.fired = true;
    this.anchor(x, y);
    this.ringN = 0;
  }

  // Classify the finger's travel: lanes by distance from the anchor, jump/duck by speed over the last 120 ms.
  gesture(now, x, y) {
    // ---- vertical flick over the last FLICK_MS ----
    const r = this.ring, n = this.ringN;
    if (n >= 2) {
      let k = (this.ringI - 1 + RING) % RING;       // newest sample
      const t1 = r[k * 3], x1 = r[k * 3 + 1], y1 = r[k * 3 + 2];
      let x0 = x1, y0 = y1;
      for (let j = 1; j < n; j++) {
        k = (k - 1 + RING) % RING;
        if (t1 - r[k * 3] > FLICK_MS) break;
        x0 = r[k * 3 + 1]; y0 = r[k * 3 + 2];
      }
      const dy = y1 - y0, dxs = x1 - x0;
      if (Math.abs(dy) > FLICK_PX && Math.abs(dy) > Math.abs(dxs) * 1.1) {
        this.fireVertical(dy < 0, x, y);
        return;
      }
    }
    // ---- lanes ----
    const lx = x - this.ax, ly = y - this.ay;
    const d = this.hDir;
    // a slow vertical drag from the anchor still jumps / ducks (a diagonal swipe never falls into a dead zone)
    if (Math.abs(ly) >= SLOW_V_PX && Math.abs(ly) > Math.abs(lx) * 1.25) { this.fireVertical(ly < 0, x, y); return; }
    if (d === 0) {
      if (Math.abs(lx) >= LANE_PX && Math.abs(lx) >= Math.abs(ly)) this.fireLane(Math.sign(lx), x, y);
      return;
    }
    if ((x - this.extX) * d > 0) this.extX = x;                   // track the furthest point in the current direction
    if ((this.extX - x) * d >= LANE_BACK_PX) { this.fireLane(-d, x, y); return; }           // reversed: opposite lane
    if (lx * d >= LANE_MORE_PX && Math.abs(lx) >= Math.abs(ly)) this.fireLane(d, x, y);    // a long drag: one more lane
  }

  /** The game consumed this touch (e.g. as a junction turn): ignore the rest of it and drop pending lane steps. */
  endGesture() {
    this.swallow = true;
    this.laneQueued = 0;
    this.hDir = 0;
  }

  /** Forget every queued action (start / revive / countdown). */
  clear() {
    this.dx = 0; this.laneQueued = 0; this.jumpQueued = false; this.diveQueued = false; this.doubleTapQueued = false;
  }

  consumeDx() {
    const v = this.dx;
    this.dx = 0;
    return v;
  }

  consumeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  consumeLane() {
    const l = this.laneQueued;
    this.laneQueued = 0;
    return l;
  }

  consumeDoubleTap() {
    const d = this.doubleTapQueued;
    this.doubleTapQueued = false;
    return d;
  }

  consumeDive() {
    const d = this.diveQueued;
    this.diveQueued = false;
    return d;
  }

  keyAxis() {
    return (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
  }
}
