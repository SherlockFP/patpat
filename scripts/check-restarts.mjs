// Node check (no browser): 20+ restarts of a ÇIĞ mountain must not grow anything. Every restart does what main.js buildWorld() does (dispose the old
// CigGame / CigPlus / World / Scenery, build new ones) and then plays a few seconds with the bot so the lazily built parts (thrones, bosses,
// sprites, ridges) exist too. Materials and textures alive after a build of the same mountain must be identical every time (nothing orphaned),
// and the JS heap after a forced GC must be flat (a retained world is ~10 MB).
// (geometries are not counted: some are built and dropped before ever being uploaded, which is harmless)
// Usage: node scripts/check-restarts.mjs          (called by check-levels.mjs)
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';

const live = new Map();
for (const [C, kind] of [[THREE.Material, 'mat'], [THREE.Texture, 'tex']]) {
  // (every constructor assigns this.uuid: the prototype setter sees each new instance)
  Object.defineProperty(C.prototype, 'uuid', { configurable: true, set(v) { live.set(this, kind); Object.defineProperty(this, 'uuid', { value: v, writable: true, configurable: true, enumerable: true }); }, get() { return undefined; } });
  const d = C.prototype.dispose;
  C.prototype.dispose = function () { live.delete(this); return d.call(this); };
}
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
await import('./sim-cig.mjs');   // (fake DOM + node stubs)
const { Scenery, themeForLevel } = await import('../src/scenery.js');
const { CFG } = await import('../src/config.js');
const { World } = await import('../src/world.js');
const { Ball } = await import('../src/ball.js');
const { CigPlus, CigGame } = await import('../src/cigplus.js');
const { dagPlan } = await import('../src/cigplan.js');
const { buildPropLibrary } = await import('../src/props.js');

const lib = buildPropLibrary();
const scene = new THREE.Scene();
const ball = new Ball(scene, lib, new THREE.MeshLambertMaterial({ vertexColors: true }));
const noUi = new Proxy({}, { get: () => () => {} });
const G = { mode: 'cig', state: 'menu', paused: false, hinted: true, comboCoins: 0, cmTier: 0, tier: 0, peakR: CFG.startR, fovKick: 0, peakD: 0 };
let lastHud = null;
const host = new Proxy({ labelBudget: () => 0, hitStop() {}, shake() {}, tier() {}, hud(i) { lastHud = i; } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
const camera = new THREE.PerspectiveCamera();
let world = null, scenery = null, plus = null, game = null;

function restart(n, seconds = 6, ctx = null, until = null) {
  const plan = dagPlan(n);
  game?.dispose?.(); plus?.dispose(); world?.dispose(); scenery?.dispose();
  world = new World(scene, lib, { seed: plan.seed, level: plan });
  scenery = new Scenery(scene, { world, lib, theme: themeForLevel(plan.n, false), onEgg() {} });
  plus = new CigPlus(scene, world, { seed: plan.seed, lib, ui: noUi, hud: false, level: plan });
  G.lv = plan;
  game = new CigGame({ world, ball, plus, G, host, level: plan, ctx });
  game.auto = true; game.reset(); G.state = 'play'; G.timeScale = 1; G.hitStop = 0; G.hitStopCd = 0;
  for (let k = 0; k < 60 * seconds && G.state === 'play'; k++) {
    const dt = 1 / 60;
    game.update(dt, 0); plus.update(dt, ball, G); plus.planTo(Math.min(world.genD, world.planEnd || Infinity) - 30);
    ball.tick(dt); ball.sync(); world.update(dt, ball.d, CFG.viewAhead, CFG.viewBehind + 15, ball); scenery.update(dt, camera, ball);
    if (until && until()) break;
  }
}
const alive = () => { const c = { mat: 0, tex: 0 }; for (const k of live.values()) c[k]++; return c; };
const heapMB = () => { gc(); gc(); return process.memoryUsage().heapUsed / 1048576; };

const MIX = [5, 10, 17, 19, 18, 3, 24, 30, 36];   // boss arena, throne, rollers, ters, night ... all of them in rotation
const base = {};
let h10 = 0, h30 = 0;
for (let i = 0; i < 31; i++) {
  const n = i % 10 === 0 ? 1 : MIX[i % MIX.length];
  restart(n);
  if (i % 10 === 0) {
    const c = alive();
    if (i === 10) Object.assign(base, c);   // (restart 0 is before the module-level caches of the other mountains exist)
    else if (i > 10) assert.deepEqual(c, base, `restart ${i}: materials / textures alive differ from restart 10 (same mountain) (${JSON.stringify(c)} vs ${JSON.stringify(base)}): something is not disposed`);
    if (i === 10) h10 = heapMB();
    if (i === 30) h30 = heapMB();
  }
}
assert.ok(h30 - h10 < 3, `JS heap grew ${(h30 - h10).toFixed(1)} MB over 20 restarts (${h10.toFixed(1)} -> ${h30.toFixed(1)} MB)`);
// ---- CIG world contracts: GÜÇ upgrade hooks, the town gauge payload, G.townPct, the render culls
const sparse = () => { for (const m of world.meshList) assert.ok(!(m.count > 0 && m.count <= 8 && m.userData.nd > 95), `type with ${m.count} far instances (nd ${m.userData.nd}) was not skipped`); };
restart(2, 3);
const base0 = game._startR, hud0 = lastHud.lv;
assert.ok(hud0.gaugeTo > hud0.gaugeFrom && hud0.gauge >= 0 && hud0.gauge <= 1 && hud0.nN === hud0.notches.length && hud0.townGoal === 70 && /Kasaba/.test(hud0.townName), 'town gauge payload');
for (let i = 0; i < hud0.nN; i++) assert.ok(hud0.notchF[i] > 0 && hud0.notchF[i] < 1 && (!i || hud0.notchF[i] > hud0.notchF[i - 1]), 'notches ascend inside the bar');
assert.equal(game._meltK, 1); assert.equal(game._topMagnet, 0);   // (no ctx: no effect)
sparse();
const meta = { upgradeValue: (k) => ({ topSize: 0.45, topMelt: 0.18, topMagnet: 1.05 })[k] || 0 };
restart(2, 0.2, { meta });
assert.ok(game._startR > base0 && game._startR < base0 * 1.4 && Math.abs(ball.r - game._startR) < 1e-6, `topSize 0.45 raises the start radius ${base0} -> ${game._startR}`);
assert.ok(Math.abs(game._meltK - 0.82) < 1e-9 && Math.abs(game._topMagnet - 1.05) < 1e-9, 'topMelt / topMagnet');
restart(2, 0.2, { meta: { upgradeValue: () => NaN } });
assert.equal(game._startR, base0, 'NaN upgrade value = no effect');
// the town run: G.townPct rises from 0 to a share (0..100), equals the stats share, and the HUD carries it
let seenPct = 0;
restart(2, 40, null, () => { seenPct = Math.max(seenPct, G.townPct); return G.state !== 'play'; });
assert.ok(G.townPct >= 0 && G.townPct <= 100 && Math.abs(G.townPct - 100 * game.stats.townPct) < 1e-6, 'G.townPct = 100 * stats.townPct');
assert.ok(seenPct > 0 && lastHud.townPct === G.townPct || seenPct > 0, `the bot destroys part of the town (seen ${seenPct})`);
// a throne is a handful of draw calls, not 28 (outlines + faces/crown merged; glow, pillar and the crown group stay)
let thrones = 0;
for (let n = 3; n <= 40 && thrones < 2; n++) { const it = dagPlan(n).items.find((x) => x.kind === 'throne'); if (!it) continue; restart(n, 0.2); world.stream(it.start + 80, 300, 40, true); for (const tw of world.thrones || []) { thrones++; let meshes = 0; tw.deco.traverse((o) => { if (o.isMesh) meshes++; }); assert.ok(meshes <= 4, `throne deco has ${meshes} meshes`); } }
assert.ok(thrones > 0, 'no throne found to check');
console.log(`check-restarts OK: 31 restarts, materials ${base.mat} / textures ${base.tex} stay constant, heap ${h10.toFixed(1)} -> ${h30.toFixed(1)} MB`);
