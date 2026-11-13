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

{ // pickup / hit burst: chunks + a flash and halo, all finite; dispose frees everything and empties the scene
  const { fx, out } = rig();
  fx.burst(0, 1, 5, 8, 0xffcc33);
  ok(out.n === 7 && fx.n === 8, 'a burst of 8 emits 8 chunks, a flash, a halo and a 5-spark ring, got ' + fx.n + ' / ' + out.n);
  ok(fx.mKeep.reduce((a, b) => a + b, 0) === 7, 'every flash puff is exempt from the near-ball thinning');
  fx.burst(0, 1, 5, 2, new THREE.Color(1, 0, 0));
  ok(out.n === 7, 'a tiny burst emits no glow');
  { // the flash stays visible next to the ball but is capped there (a ball buried in its own hit burst cannot be steered); far from it, it keeps full alpha
    const f = rig().fx, b = { group: new THREE.Group(), r: 0.8, x: 0, y: 1, d: 5, airborne: false };
    b.group.position.set(0, 1, -5);
    f.burst(0, 1, 5, 6, 0xffcc33); for (let k = 0; k < 3; k++) f.updateMist(0.02, b);
    const aN = Math.max(...f.mAlpha);
    ok(aN > 0.2 && aN < 0.5, 'pickup / hit flash is capped (0.2..0.5) at the ball, got ' + aN.toFixed(2));
    { const g2 = rig().fx, far = { group: new THREE.Group(), r: 0.8, x: 0, y: 1, d: 5, airborne: false }; far.group.position.set(0, 1, -60); g2.burst(0, 1, 5, 6, 0xffcc33); for (let k = 0; k < 3; k++) g2.updateMist(0.02, far); ok(Math.max(...g2.mAlpha) > 0.7, 'flash far from the ball keeps its alpha'); }
    f.puff(0, 1, -5, 0, 0, 0, 1, 1, 0xffffff, 0.8); for (let k = 0; k < 3; k++) f.updateMist(0.1, b);
    ok(f.mAlpha[f.mHead - 1] < 0.4, 'ordinary powder at the ball is still thinned, got ' + f.mAlpha[f.mHead - 1].toFixed(2));
  }
  SU.uLite.value = 1;
  { const g = rig(); g.fx.burst(0, 1, 5, 8, 0xffcc33); ok(g.out.n === 2, 'lite rung: flash + halo only, no ring, got ' + g.out.n); }
  SU.uLite.value = 0;
  ok(finite(fx.px) && finite(fx.pv), 'burst state is finite');
  let freed = 0;
  const track = (o) => { const d = o.dispose.bind(o); o.dispose = () => { freed++; d(); }; };
  track(fx.parts.geometry); track(fx.trail.geometry); track(fx.mist.geometry); track(fx.streaks.geometry); track(fx.shadow.geometry);
  fx.dispose();
  ok(freed === 5 && !fx.scene.children.includes(fx.parts) && !fx.scene.children.includes(fx.streaks), 'dispose frees every geometry and leaves the scene');
}

{ // town destruction: debris joins the shared chunk pool, dust the mist pool, shake decays to exactly 0; all dead in the lite rung
  const { fx, step } = rig();
  const P = { x: 2, y: 1, z: -30 };
  fx.debris(P, 0xb08a5a, 999);
  ok(fx.n === 24, 'debris: one call throws at most 24 chunks, got ' + fx.n);
  ok(fx.parts.count <= 700 && finite(fx.px) && finite(fx.pv), 'debris state finite');
  step(0, 0, 0, 2);
  ok(fx.n === 0, 'debris chunks expire (<= 1.5 s), left ' + fx.n);
  const live = () => { let c = 0; for (let i = 0; i < fx.mN; i++) if (fx.mLife[i] > 0) c++; return c; };
  fx.dust(P, 4);
  ok(live() === 11, 'dust: 8 ring + 3 rising puffs, got ' + live());
  fx.shake(9); ok(fx._shk === 1.2, 'shake is capped at 1.2');
  step(0, 0, 0, 0.1); ok(fx.shakeOff.x !== 0 || fx.shakeOff.y !== 0, 'shake offsets the camera hook');
  step(0, 0, 0, 2); ok(fx.shakeOff.x === 0 && fx.shakeOff.y === 0, 'shake decays to exactly 0');
  fx.photoFlash(); ok(SU.uFlash.value.w === 0.9, 'photoFlash is a full white flash');
  fx.reset(); SU.uLite.value = 1;
  fx.debris(P, 0xffffff, 8); fx.dust(P, 4); fx.shake(1);
  ok(fx.n === 0 && live() === 0 && fx._shk === 0, 'lite rung: debris, dust and shake are off');
  SU.uLite.value = 0; fx.dispose();
}

{ // hit flash: sets the shared uniform, never lowers a stronger one, eases out to exactly 0, dispose clears it
  const { fx, ball, step } = rig();
  const fl = SU.uFlash.value;
  fx.hitFlash(0.5);
  ok(fl.w === 0.5 && fl.x === 1 && fl.y === 1 && fl.z === 1, 'hitFlash(0.5) is a white 0.5 flash');
  fx.hitFlash(0.2);
  ok(fl.w === 0.5, 'a weaker flash does not lower a stronger one');
  fx.hitFlash(5, 1, 0.2, 0.2);
  ok(fl.w === 0.9 && fl.y === 0.2, 'strength is capped at 0.9 and takes the new colour');
  step(0, 0, 0, 0.35);
  ok(fl.w > 0 && fl.w < 0.1, 'flash eases out (~0.3 s), got ' + fl.w.toFixed(3));
  step(0, 0, 0, 1.5);
  ok(fl.w === 0, 'flash reaches exactly 0');
  fx.hitFlash(0.5); fx.dispose();
  ok(fl.w === 0, 'dispose clears a running flash');
}

{ // score floaters, score pop, level-up burst, prewarm, level badge
  const { fx, ball } = rig();
  fx.floater('+5', 10, 10);   // (the stub document has no body: a no-op, never a throw)
  ok(fx._fl === null, 'floater without a DOM is a no-op');
  const kids = [], mk = () => ({ style: {}, setAttribute() {}, remove() { this.gone = true; }, className: '' });
  const doc0 = globalThis.document, cv = doc0.createElement('canvas');
  globalThis.document = { createElement: (t) => (t === 'canvas' ? cv : mk()), body: { appendChild: (e) => kids.push(e) }, head: { appendChild: (e) => kids.push(e) } };
  for (let i = 0; i < 25; i++) fx.floater('+' + i, 100 + i, 200, i & 1 ? 0xffd23a : '#fff');
  ok(fx._fl.length === 10 && kids.length === 11, 'floater pool is built once: 10 labels + 1 style, got ' + kids.length);
  ok(fx._fl[4].textContent === '+24' && fx._fl[4].style.left === '124px' && fx._fl[4].style.color === '#fff' && fx._fl[3].style.color === '#ffd23a', 'oldest label is reused with the new text / position / colour');
  ok(fx._fl[0].style.animationName !== fx._fl[1].style.animationName, 'consecutive floaters alternate keyframes so each restarts');
  const el = mk(); fx.scorePop(el); const a1 = el.style.animationName; fx.scorePop(el);
  ok(a1 && el.style.animationName !== a1 && el.style.animationDuration === '0.18s', 'scorePop alternates keyframes (restarts) and runs 0.18 s');
  fx.scorePop(null); fx.scorePop({});   // no throw
  const live = () => { let c = 0; for (let i = 0; i < fx.mN; i++) if (fx.mLife[i] > 0) c++; return c; };
  fx.levelUp(null); ok(live() === 0, 'levelUp(null) is a no-op');
  fx.levelUp({ x: 0, y: 1, z: -20 });
  ok(live() === 15 && SU.uFlash.value.w === 0.3, 'levelUp: 12 ring + 3 column puffs and a gold flash, got ' + live());
  fx.reset(); SU.uFlash.value.w = 0; SU.uLite.value = 1; fx.levelUp({ x: 0, y: 1, z: -20 });
  ok(live() === 9, 'levelUp is lighter in the lite rung, got ' + live()); SU.uLite.value = 0;
  let seen = null;
  fx.prewarm({ compile: () => { seen = fx.streaks.visible; } });   // (no scene / camera given: uses its own)
  ok(seen === true && fx.streaks.visible === false, 'prewarm shows the streaks while compiling and restores them');
  fx.prewarm({ compile: () => { throw new Error('x'); } }); ok(!fx.streaks.visible, 'a throwing compile is swallowed and state restored');
  fx.prewarm(null);
  fx.dispose(); ok(kids.every((k) => k.gone) && fx._fl === null, 'dispose removes the floater DOM');
  globalThis.document = doc0;
  const { Ball } = await import('../src/ball.js');
  const sc = new THREE.Scene(), b = new Ball(sc, null, null);
  b.tick(1 / 60); ok(!b.badge.visible, 'no level = no ring');
  const arc = [];
  for (let lv = 1; lv <= 5; lv++) { b.snow.material.userData.level = lv; b.tick(1 / 60); arc.push(b.badge.geometry.parameters.thetaLength); ok(b.badge.visible, 'level ' + lv + ' shows the ring'); }
  ok(arc.every((t, i) => i === 0 || t > arc[i - 1]) && Math.abs(arc[4] - Math.PI * 2) < 1e-9, 'ring arc grows with the level up to a full turn');
  b.snow.material.userData.level = 9; b.tick(1 / 60); ok(b.badge.geometry.parameters.thetaLength === arc[4], 'level is capped at 5');
  b.snow.material.userData.level = 0; b.tick(1 / 60); ok(!b.badge.visible, 'level 0 hides the ring');
  b.dispose();
  const { makeSkin, disposeSkin } = await import('../src/skins.js');
  const k = makeSkin('kofte', 3), c = makeSkin('classic', 3);
  ok(k.material.userData.level === 3 && c.material.userData.level === undefined, 'makeSkin(id, level): only KARAKTER skins carry a level');
  disposeSkin(k); disposeSkin(c);
}

console.log(fails ? `${fails} check(s) failed` : 'fx: all checks passed');
process.exit(fails ? 1 : 0);
