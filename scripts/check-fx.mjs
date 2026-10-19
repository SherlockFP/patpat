// Regression check (node, no browser) for the speed-feel effects in src/fx.js: ground kick-up spray and world-space speed streaks.
// Runs the real Fx class (with a stubbed canvas) against a fake ball and checks the emission rules: nothing at rest or in the air or on a
// teleport, a rate that follows speed and the lite quality rung, spray born at the contact point, streaks only when fast and allowed, no NaN.
// Usage: node scripts/check-fx.mjs
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(v) {} }) }) };
globalThis.window = { innerHeight: 800 };
const { Fx, sprayK, sprayRate, streakK } = await import('../src/fx.js');
const { SU } = await import('../src/shaders.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const finite = (a) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

// ---- pure curves ----
{
  let prev = -1, prevS = -1, prevR = -1;
  for (let v = 0; v <= 80; v += 0.5) {
    const k = sprayK(v), r = sprayRate(v, 1), s = streakK(v);
    ok(k >= 0 && k <= 1 && s >= 0 && s <= 1 && r >= 0, `curves in range at ${v}`);
    ok(k >= prev && s >= prevS && r >= prevR, `curves monotonic at ${v}`);
    prev = k; prevS = s; prevR = r;
  }
  ok(sprayK(5) === 0 && streakK(10) === 0, 'no spray / streaks when slow');
  ok(sprayK(60) === 1 && streakK(60) === 1, 'full strength when very fast');
  ok(sprayRate(40, 0.4) < sprayRate(40, 1.6) && sprayRate(40, 1.6) <= 32, 'a bigger ball kicks up more, capped by the rate knob');
}

// ---- the real class ----
function rig() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe2f4, 70, 330);
  const camera = new THREE.PerspectiveCamera(60, 0.5, 0.5, 1800);
  const ball = { group: new THREE.Group(), r: 0.8, x: 0, y: 0.8, d: 0, airborne: false };
  ball.group.position.set(0, 0.8, 0);
  const fx = new Fx(scene, { groundY: () => -1e9, rampAt: () => 0 }, camera);
  const out = { n: 0, bad: 0, maxOff: 0 };
  const puff = fx.puff.bind(fx);
  fx.puff = (x, y, z, ...rest) => {
    out.n++;
    const p = ball.group.position;
    if (!(y < p.y - ball.r * 0.5)) out.bad++;                               // born below the ball centre
    out.maxOff = Math.max(out.maxOff, Math.hypot(x - p.x, z - p.z) / ball.r);   // ... and close to it
    return puff(x, y, z, ...rest);
  };
  // moves the ball by (vx,vy,vz) m/s and updates the camera so it keeps chasing 10 m behind and 6 m up
  const step = (vx, vy, vz, secs, dt = 1 / 60) => {
    for (let t = 0; t < secs; t += dt) {
      const p = ball.group.position;
      p.x += vx * dt; p.y += vy * dt; p.z += vz * dt;
      ball.x = p.x; ball.y = p.y; ball.d = -p.z;
      camera.position.set(p.x, p.y + 6, p.z + 10);
      camera.lookAt(p);
      camera.updateMatrixWorld();
      fx.update(dt, ball);
    }
  };
  return { fx, ball, camera, out, step };
}

SU.uFx.value = 1; SU.uLite.value = 0;

{ // at rest
  const { fx, out, step } = rig();
  step(0, 0, 0, 2);
  ok(out.n === 0 && !fx.streaks.visible && fx.speed === 0, 'at rest: no spray, no streaks');
}
{ // slow roll: a few puffs at most
  const { out, step } = rig();
  step(0, 0, -10, 2);
  ok(out.n > 0 && out.n < 12, `10 m/s for 2 s: a few puffs, got ${out.n}`);
}
let fullRate;
{ // full speed
  const { fx, ball, out, step } = rig();
  step(0, 0, -40, 5);
  fullRate = out.n / 5;
  const want = sprayRate(40, 0.8);
  ok(Math.abs(fullRate - want) < want * 0.3, `40 m/s: ~${want.toFixed(1)} puffs/s, got ${fullRate.toFixed(1)}`);
  ok(out.bad === 0, 'spray is born under the ball');
  ok(out.maxOff < 2.2, `spray is born next to the ball (max ${out.maxOff.toFixed(2)} r)`);
  ok(Math.abs(fx.speed - 40) < 1, 'speed estimate ~40, got ' + fx.speed.toFixed(2));
  ok(fx.streaks.visible, 'streaks visible at 40 m/s');
  const u = fx.streaks.material.uniforms;
  ok(Math.abs(u.uDir.value.length() - 1) < 1e-3 && u.uDir.value.z < -0.99, 'streak direction = travel direction');
  ok(u.uK.value > 0.05 && u.uK.value <= 0.32 + 1e-6, 'streak strength in (0, STREAK_ALPHA], got ' + u.uK.value.toFixed(3));
  ok(Number.isFinite(u.uBox.value) && u.uBox.value > 10 && Number.isFinite(u.uLen.value) && u.uLen.value >= 1, 'streak field finite');
  ok(finite(fx.mPos) && finite(fx.mAlpha) && finite(fx.mSizeAttr), 'no NaN in the puff pool');
  ok(fx.mAlpha.every((a) => a >= 0 && a <= 1), 'puff alpha in [0,1]');
  // the ball stops: streaks fade out
  step(0, 0, 0, 4);
  ok(!fx.streaks.visible, 'streaks fade out when the ball stops');
}
{ // lite rung halves the spray and drops the streaks
  const { fx, out, step } = rig();
  SU.uLite.value = 1; SU.uFx.value = 0;
  step(0, 0, -40, 5);
  ok(Math.abs(out.n / 5 - fullRate / 2) < fullRate * 0.2, `lite: about half the spray (${(out.n / 5).toFixed(1)} vs ${fullRate.toFixed(1)})`);
  ok(!fx.streaks.visible, 'lite: no streaks');
  SU.uLite.value = 0; SU.uFx.value = 1;
}
{ // airborne, vertical moves, hidden ball, teleport
  const a = rig(); a.ball.airborne = true; a.step(0, 0, -40, 2);
  ok(a.out.n === 0, 'airborne: no kick-up');
  const b = rig(); b.step(0, -40, 0, 2);
  ok(b.out.n === 0, 'vertical drop: no kick-up');
  const c = rig(); c.ball.group.visible = false; c.step(0, 0, -40, 2);
  ok(c.out.n === 0 && !c.fx.streaks.visible, 'hidden ball: nothing');
  const d = rig(); d.step(0, 0, -40, 1);
  const before = d.out.n;
  d.ball.group.position.z -= 500; d.fx.update(1 / 60, d.ball);
  ok(d.fx.speed === 0 && d.out.n === before, 'teleport: speed resets, no spray that frame');
  d.fx.reset();
  ok(!d.fx.streaks.visible && d.fx.speed === 0, 'reset clears the streaks');
}
{ // a long frame never floods the pool
  const { out, step } = rig();
  step(0, 0, -40, 1);
  const n0 = out.n;
  step(0, 0, -40 / 3, 0.05, 0.05);   // one 50 ms frame
  ok(out.n - n0 <= 3, 'at most 3 puffs per frame, got ' + (out.n - n0));
}

console.log(fails ? `${fails} check(s) failed` : 'fx: all checks passed');
process.exit(fails ? 1 : 0);
