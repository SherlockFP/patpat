// Regression check (node, no browser) for the look plumbing: the per-biome colour grade reaches the shared shader uniforms through the
// environment's look blend (right channel indices, smooth across a portal, reset on dispose), and the visual modes / quality rung set the
// right flags (grade only where the picture goes straight to the canvas, glitter / streaks off in pixel and lite, contact shadow off in lite).
// Usage: node scripts/check-look.mjs
import * as THREE from 'three';
// canvas 2D stub: every method is a no-op, every property reads as another no-op (Environment draws its sprite textures on canvases)
const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.window = { innerHeight: 800 };
const { Environment, BIOMES, BIOME_LENGTH } = await import('../src/runner/biomes.js');
const { Track } = await import('../src/runner/track.js');
const { SU, PostFX } = await import('../src/shaders.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

// ---- environment -> uniforms ----
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdcefff, 70, 330);
scene.background = new THREE.Color(0xdcefff);
const track = new Track(null, { seed: 7919 });
track.ensure(2200);
const env = new Environment(scene, track, {});
const cam = new THREE.PerspectiveCamera(60, 0.5, 0.5, 1800);
const ball = { s: 100 };
const upd = (s) => { ball.s = s; cam.position.set(0, 20, 0); env.update(1 / 60, cam, ball, null); };

const gradeOf = (b) => ({ sat: b.grade.sat, con: b.grade.con, vig: b.grade.vig, rim: b.grade.rim });
const snow = BIOMES.find((b) => b.id === 'snow'), forest = BIOMES.find((b) => b.id === 'forest');
upd(100);
ok(SU.uTail.value === 1, 'environment switches the finish on (normal mode)');
{
  const g = SU.uGrade.value, w = gradeOf(snow);
  ok(near(g.x, w.sat) && near(g.y, w.con) && near(g.z, w.vig) && near(g.w, w.rim), `snow grade reaches the uniforms: ${g.toArray().map((x) => x.toFixed(2))}`);
  ok(near(SU.uSh.value.r, snow.grade.sh[0]) && near(SU.uSh.value.g, snow.grade.sh[1]) && near(SU.uSh.value.b, snow.grade.sh[2]), 'shadow tint is the raw multiplier');
  ok(near(SU.uHi.value.r, snow.grade.hi[0]) && near(SU.uHi.value.b, snow.grade.hi[2]), 'highlight tint is the raw multiplier');
  const rim = new THREE.Color(snow.grade.rimC);
  ok(near(SU.uRim.value.r, rim.r) && near(SU.uRim.value.g, rim.g) && near(SU.uRim.value.b, rim.b), 'rim colour is a (linear) colour');
}
{ // across the first portal: 60 m before to 60 m after, monotonic
  const seq = [];
  for (let s = BIOME_LENGTH - 200; s <= BIOME_LENGTH + 160; s += 4) { upd(s); seq.push([s, SU.uGrade.value.x, SU.uGrade.value.z, SU.uSh.value.r]); }
  const a = snow.grade.sat, b = forest.grade.sat, dir = Math.sign(b - a);
  ok(dir !== 0 && seq.every((r, i) => i === 0 || (r[1] - seq[i - 1][1]) * dir >= -1e-6), 'saturation blends monotonically across the portal');
  ok(seq.filter((r) => r[0] < BIOME_LENGTH - 80).every((r) => near(r[1], a)), 'nothing moves before the blend window opens (portal - 60 m)');
  ok(seq.filter((r) => r[0] > BIOME_LENGTH + 80).every((r) => near(r[1], b)), 'the new biome grade is in place after the portal');
  const mid = seq.find((r) => r[0] === BIOME_LENGTH);
  ok(mid && mid[1] > Math.min(a, b) + 1e-4 && mid[1] < Math.max(a, b) - 1e-4, 'half way through the portal the grade is in between');
  ok(seq.every((r) => r.every(Number.isFinite)), 'no NaN while blending');
}
{ // every biome carries a complete grade
  for (const b of BIOMES) {
    const g = b.grade;
    ok(g && g.sat >= 0.9 && g.sat <= 1.4 && g.con >= 0 && g.con <= 0.5 && g.vig >= 0 && g.vig <= 0.5 && g.rim >= 0 && g.rim <= 1 && g.sh.length === 3 && g.hi.length === 3 && Number.isInteger(g.rimC), `grade of ${b.id} is complete and in range`);
    ok([...g.sh, ...g.hi].every((x) => x > 0.8 && x < 1.2), `${b.id}: tints are gentle multipliers`);
    ok(b.hemi.intensity > 0.8 && b.hemi.intensity < 1.8 && b.sun.intensity > 0.9 && b.sun.intensity < 2.6 && b.sun.el > 0.1 && b.sun.el < 1.3, `${b.id}: key / fill lights in a sane range`);
  }
  const lum = (h) => { const c = new THREE.Color(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  for (const b of BIOMES) ok(b.sun.intensity > 0 && lum(b.sun.color) > 0.3, `${b.id}: the key light is not dark`);
}
{ // speed feel: the vignette closes in with the ball speed, eases back at rest
  const base = SU.uGrade.value.z;
  env.ballVs = 55; for (let i = 0; i < 120; i++) upd(100);
  ok(SU.uGrade.value.z > base + 0.1 && SU.uGrade.value.z <= base + 0.125, 'vignette closes in at 55 m/s, got +' + (SU.uGrade.value.z - base).toFixed(3));
  env.ballVs = 0; for (let i = 0; i < 240; i++) upd(100);
  ok(near(SU.uGrade.value.z, base, 1e-3), 'vignette is back to the biome value at rest');
}
env.dispose();
ok(SU.uTail.value === 0, 'disposing the environment switches the finish off');

// ---- readability: the (white) ball must stand out from every track, the track from its sky, the two tiles must stay one family ----
{
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = (h) => 0.2126 * lin(((h >> 16) & 255) / 255) + 0.7152 * lin(((h >> 8) & 255) / 255) + 0.0722 * lin((h & 255) / 255);
  const cr = (a, b) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);   // WCAG contrast ratio
  const BALL = 0xe8f0ff;
  for (const b of BIOMES) {
    const t = b.track;
    ok(Math.min(cr(BALL, t.tileA), cr(BALL, t.tileB)) >= 2.0, `${b.id}: ball vs track contrast >= 2.0, got ${Math.min(cr(BALL, t.tileA), cr(BALL, t.tileB)).toFixed(2)}`);
    ok(Math.min(cr(t.tileA, b.sky.horizon), cr(t.tileB, b.sky.horizon)) >= 1.4 || b.id === 'neon', `${b.id}: track vs horizon contrast >= 1.4`);
    ok(cr(t.tileA, t.tileB) <= 2.4 && cr(t.edge, t.tileA) >= 1.3 && cr(t.edge, t.tileB) >= 1.3, `${b.id}: tiles one family (<= 2.4), edge outlines both (>= 1.3)`);
  }
}

// ---- budget: draw calls <= 25 and triangles <= 80k (every live instance counts, the GPU does not cull per instance), a whole 18-biome cycle ----
{
  const sc = new THREE.Scene();
  sc.fog = new THREE.Fog(0xdcefff, 70, 330);
  const long = new Track(null, { seed: 7919 });
  long.ensure(BIOME_LENGTH * BIOMES.length + 600);
  const e = new Environment(sc, long, {});
  let calls = 0, tris = 0;
  for (let s = 60; s < BIOME_LENGTH * BIOMES.length; s += 20) {
    cam.position.set(0, 20, 0); e.update(1 / 30, cam, { s }, null);
    let c = 0, t = 0;
    e.group.traverse((o) => {
      if (!(o.isMesh || o.isPoints) || !o.visible) return;
      const n = o.isInstancedMesh ? o.count : 1, g = o.geometry;
      if (n <= 0 || !g) return;
      c++; t += (g.index ? g.index.count : g.attributes.position.count) / 3 * n;
    });
    calls = Math.max(calls, c); tris = Math.max(tris, t);
  }
  ok(calls <= 25, 'environment draw calls over a full cycle <= 25, got ' + calls);
  ok(tris <= 80000, 'environment triangles over a full cycle <= 80k, got ' + Math.round(tris));
  e.dispose();
}

// ---- view culling: only instances inside the camera's cone are drawn (props + clouds); a camera looking steeply down draws everything ----
{
  const e = new Environment(new THREE.Scene(), track, {});
  const c2 = new THREE.PerspectiveCamera(60, 390 / 844, 0.5, 1800);
  const shown = () => { let n = 0, t = 0, k = 0; for (const T of e._types) { n += T.mesh.count; t += T.count; if (T.mesh.visible !== T.mesh.count > 0) k++; } return { n, t, k, cl: e.clouds.count }; };
  const go = (pitch) => { c2.position.set(0, 20, 0); c2.rotation.set(pitch, 0, 0); c2.updateMatrixWorld(true); for (let i = 0; i < 6; i++) e.update(1 / 60, c2, { s: 200 }, null); return shown(); };
  const f = go(-0.35);
  ok(f.t > 150 && f.n < f.t * 0.6 && f.n > 0, `portrait camera draws a fraction of the ${f.t} instances, got ${f.n}`);
  ok(f.k === 0, 'a type with nothing in view is not drawn (no draw call)');
  ok(f.cl >= 0 && f.cl < 44, `clouds are culled too, got ${f.cl} of 44`);
  const d = go(-1.45);
  ok(d.n === d.t && d.cl === 44, 'camera looking steeply down: everything is drawn');
  const w = new THREE.PerspectiveCamera(60, 2, 0.5, 1800); w.position.set(0, 20, 0); w.updateMatrixWorld(true);
  for (let i = 0; i < 3; i++) e.update(1 / 60, w, { s: 200 }, null);
  ok(shown().n > f.n, 'a wide (desktop) window shows more than the portrait one');
  e.dispose();
}

// ---- visual modes + quality rung ----
{
  const renderer = { getDrawingBufferSize: (v) => v.set(1080, 2160), render() {}, setRenderTarget() {} };
  const post = new PostFX(renderer);
  const flags = () => ({ tail: SU.uTail.value, toon: SU.uToon.value, spark: SU.uSparkle.value, fx: SU.uFx.value, ao: SU.uAO.value > 0, lite: SU.uLite.value });
  const set = (m, lite = false) => { post.setMode(m); post.setLite(lite); return flags(); };
  // (a Rush environment is driving the grade)
  const env2 = new Environment(scene, track, {});
  upd2(env2);
  function upd2(e) { e.update(1 / 60, cam, { s: 50 }, null); }
  let f = set('normal');
  ok(f.tail === 1 && f.toon === 0 && f.spark === 1 && f.fx === 1 && f.ao, 'normal: finish, glitter, streaks and contact shadow on');
  ok(SU.uView.value.x === 1080 && SU.uView.value.y === 2160, 'drawing-buffer size reaches the vignette');
  f = set('toon');
  ok(f.tail === 1 && f.toon === 1 && f.spark === 1, 'toon: finish stays on (vignette only), cel shading on');
  f = set('pixel');
  ok(f.tail === 0 && f.spark === 0 && f.fx === 0 && f.ao, 'pixel: no finish (linear low-res target), no glitter / streaks, contact shadow stays');
  ok(post.usesTarget() && !(set('normal') && post.usesTarget()), 'only pixel / postcard use the render target');
  f = set('postcard');
  ok(f.tail === 0 && f.spark === 1 && f.fx === 1, 'postcard: its own post pass, no finish');
  f = set('normal', true);
  ok(f.tail === 1 && f.spark === 0 && f.fx === 0 && !f.ao && f.lite === 1, 'lite: finish stays, glitter / streaks / contact shadow off');
  f = set('normal', false);
  ok(f.spark === 1 && f.fx === 1 && f.ao && f.lite === 0, 'lite off restores everything');
  env2.dispose();
  f = set('normal');
  ok(f.tail === 0, 'without a Rush environment (ÇIĞ, menu) the finish is off in every mode');
}

// ---- skins: every catalog entry builds its own geometry (finite, within the triangle budget, soft normals on the default ball) ----
{
  const { SKINS, makeSkin, disposeSkin } = await import('../src/skins.js');
  for (const k of SKINS) {
    const sk = makeSkin(k.id);
    ok(sk.id === k.id, `skin ${k.id} has its own builder (not the classic fallback)`);
    const p = sk.geometry.attributes.position.array, n = sk.geometry.attributes.normal.array;
    ok(p.every(Number.isFinite) && n.every(Number.isFinite) && p.length / 9 <= 2600, `skin ${k.id}: finite geometry within budget`);
    disposeSkin(sk);
  }
  const c = makeSkin('classic');
  ok(c.material.flatShading === false && c.geometry.attributes.color.array.every(Number.isFinite), 'classic ball is soft-shaded with finite colours');
  { // the snowball is the star: no accessory on top (the beanie read as a cup from the chase camera), freed by dispose
    const { Ball } = await import('../src/ball.js');
    const sc = new THREE.Scene(), ball = new Ball(sc, null, new THREE.MeshBasicMaterial());
    ok(!ball.hat && ball.spin.children.length === 1 && ball.group.children.length === 2 && ball.group.children[1] === ball.badge && !ball.badge.visible, 'ball: the snowball + a hidden level ring, no hat');
    ball.snow.geometry = c.geometry; ball.snow.material = c.material; ball.setRiders(1); ball.tick(0.016);
    ok(ball.group.children.length === 3, 'riders still stand on top of the ball');
    ball.dispose();
    ok(!sc.children.includes(ball.group), 'dispose takes the ball out of the scene');
  }
  disposeSkin(c);
}

console.log(fails ? `${fails} check(s) failed` : 'look: all checks passed');
process.exit(fails ? 1 : 0);
