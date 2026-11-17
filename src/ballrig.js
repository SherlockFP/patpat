// BallRig: what rides WITH the ball but does not spin with it. One per ball (game ball, shop preview). Children live in ball-radius units under a root that follows the ball.
//   effect layers : the pooled particles of an effect ball (effectballs.js `rig`): rise / fall / surf / out / orbit / sink / halo. One THREE.Points + one shared glyph atlas per layer = 1 draw call each
//   rings         : thin comet rings round the ball (1 draw call each)
//   hat           : a small merged mesh (accessories.js) on top that stays upright while the ball rolls (1 draw call)
// No per-frame allocation: typed arrays are filled in place, every temp is module-level.
import * as THREE from 'three';
import { EFFECT_BY_ID, stageOf } from './effectballs.js';
import { buildHat } from './accessories.js';

const GLY = ['dot', 'spark', 'smoke', 'star', 'flake', 'petal', 'heart', 'note', 'bubble', 'pixel', 'bolt', 'moon'];
export const glyphIndex = (s) => Math.max(0, GLY.indexOf(s));
let _atlas = null;
function atlas() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round';
  const poly = (pts) => { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill(); };
  const soft = (r0, a) => { const g = x.createRadialGradient(32, 32, r0, 32, 32, 30); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); x.fillStyle = '#fff'; };
  GLY.forEach((s, i) => {
    x.save(); x.translate((i % 4) * 64, Math.floor(i / 4) * 64); x.beginPath(); x.rect(0, 0, 64, 64); x.clip();
    if (s === 'dot') soft(2, 1);
    else if (s === 'smoke') soft(0, 0.8);
    else if (s === 'spark') poly([[32, 2], [38, 26], [62, 32], [38, 38], [32, 62], [26, 38], [2, 32], [26, 26]]);
    else if (s === 'star') { const p = []; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 12 : 29; p.push([32 + Math.cos(a) * r, 33 + Math.sin(a) * r]); } poly(p); }
    else if (s === 'flake') { x.lineWidth = 5; for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; x.beginPath(); x.moveTo(32 - Math.cos(a) * 27, 32 - Math.sin(a) * 27); x.lineTo(32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27); x.stroke(); } x.lineWidth = 3; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3, ex = 32 + Math.cos(a) * 17, ey = 32 + Math.sin(a) * 17; x.beginPath(); x.moveTo(ex, ey); x.lineTo(ex + Math.cos(a + 0.9) * 8, ey + Math.sin(a + 0.9) * 8); x.moveTo(ex, ey); x.lineTo(ex + Math.cos(a - 0.9) * 8, ey + Math.sin(a - 0.9) * 8); x.stroke(); } }
    else if (s === 'petal') { x.beginPath(); x.moveTo(32, 58); x.bezierCurveTo(4, 40, 6, 10, 26, 6); x.lineTo(32, 14); x.lineTo(38, 6); x.bezierCurveTo(58, 10, 60, 40, 32, 58); x.fill(); }
    else if (s === 'heart') { x.beginPath(); x.moveTo(32, 56); x.bezierCurveTo(2, 34, 8, 8, 32, 22); x.bezierCurveTo(56, 8, 62, 34, 32, 56); x.fill(); }
    else if (s === 'note') { x.beginPath(); x.ellipse(20, 47, 14, 10, -0.4, 0, 7); x.fill(); x.lineWidth = 8; x.beginPath(); x.moveTo(31, 44); x.lineTo(31, 8); x.quadraticCurveTo(44, 14, 50, 30); x.stroke(); }
    else if (s === 'bubble') { x.lineWidth = 5; x.beginPath(); x.arc(32, 32, 22, 0, 7); x.stroke(); x.globalAlpha = 0.5; x.beginPath(); x.arc(24, 24, 5, 0, 7); x.fill(); }
    else if (s === 'pixel') x.fillRect(14, 14, 36, 36);
    else if (s === 'bolt') poly([[38, 2], [14, 36], [30, 36], [24, 62], [50, 26], [34, 26]]);
    else if (s === 'moon') { x.beginPath(); x.arc(32, 32, 26, 0, 7); x.fill(); x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(42, 26, 22, 0, 7); x.fill(); }
    x.restore();
  });
  _atlas = new THREE.CanvasTexture(c); _atlas.flipY = false;
  return _atlas;
}

const VS = `attribute float aSize; attribute float aTile; attribute float aRot; attribute vec4 aCol;
uniform float uPx; uniform float uS; varying vec4 vC; varying float vT; varying float vR;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vC = aCol; vT = aTile; vR = aRot;
  gl_PointSize = min(aSize * uS * uPx * projectionMatrix[1][1] / max(0.5, -mv.z), 200.0); }`;
const FS = `uniform sampler2D uTex; varying vec4 vC; varying float vT; varying float vR;
void main() { vec2 p = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
  vec4 t = texture2D(uTex, (vec2(mod(vT, 4.0), floor(vT / 4.0)) + p) * 0.25); float a = vC.a * t.a; if (a < 0.02) discard;
  gl_FragColor = vec4(vC.rgb, a);
  #include <colorspace_fragment>
}`;

const _c = new THREE.Color();
const rnd = () => Math.random();

class Layer {
  constructor(spec, root, mk) {
    this.sp = spec; const n = this.n = spec.n || 8; this.m = spec.m;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n); this.tile = new Float32Array(n).fill(glyphIndex(spec.s)); this.rot = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1); this.ph = new Float32Array(n); this.rv = new Float32Array(n); this.s0 = new Float32Array(n);
    this.cols = (spec.cols || [0xffffff]).map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) this.ph[i] = rnd() * 6.283;
    const g = this.geo = new THREE.BufferGeometry();
    const dyn = (a, k) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this.pos, 3)); g.setAttribute('aCol', dyn(this.col, 4)); g.setAttribute('aSize', dyn(this.size, 1)); g.setAttribute('aRot', dyn(this.rot, 1)); g.setAttribute('aTile', dyn(this.tile, 1));
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: spec.add ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: atlas() }, uPx: mk.px, uS: mk.s } });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 4;
    root.add(this.pts); this.acc = 0; this.t = 0; this.head = 0;
  }
  spawn(i) {
    const s = this.sp, m = this.m, cs = this.cols, p = this.pos, v = this.vel, o = i * 3;
    const z = rnd() * 2 - 1, a = rnd() * 6.283, r = Math.sqrt(1 - z * z), dx = r * Math.cos(a), dy = z, dz = r * Math.sin(a), R = s.R || 1.02;
    this.max[i] = this.life[i] = (s.life || 1) * (0.7 + rnd() * 0.6); this.s0[i] = (s.size || 0.3) * (0.7 + rnd() * 0.6);
    _c.copy(cs[(rnd() * cs.length) | 0]); this.col[i * 4] = _c.r; this.col[i * 4 + 1] = _c.g; this.col[i * 4 + 2] = _c.b;
    this.rot[i] = rnd() * 6.283; this.rv[i] = s.spin ? (rnd() - 0.5) * 6 : 0; this.ph[i] = rnd() * 6.283;
    const sp = s.sp || 1;
    if (m === 'rise') { p[o] = dx * 0.95; p[o + 1] = dy * 0.5 + 0.5; p[o + 2] = dz * 0.95; v[o] = dx * sp * 0.3 + (rnd() - 0.5) * sp * 0.5; v[o + 1] = (s.up === undefined ? 1.4 : s.up) * (0.6 + rnd() * 0.8); v[o + 2] = dz * sp * 0.3 + (rnd() - 0.5) * sp * 0.5 + (s.back || 0); }
    else if (m === 'fall') { p[o] = (rnd() - 0.5) * 2.6; p[o + 1] = 1.5 + rnd() * 0.7; p[o + 2] = (rnd() - 0.5) * 2.6; v[o] = (rnd() - 0.5) * sp; v[o + 1] = s.up; v[o + 2] = (rnd() - 0.5) * sp; }
    else if (m === 'surf') { p[o] = dx * R; p[o + 1] = dy * R; p[o + 2] = dz * R; v[o] = v[o + 1] = v[o + 2] = 0; }
    else if (m === 'out') { p[o] = dx * R; p[o + 1] = dy * R; p[o + 2] = dz * R; v[o] = dx * sp; v[o + 1] = dy * sp + (s.up || 0); v[o + 2] = dz * sp; }
    else if (m === 'sink') { this.ph[i] = a; v[o] = R; }
  }
  update(dt, t, k, st) {
    const s = this.sp, m = this.m, n = this.n, p = this.pos, v = this.vel, o = this.col, on = !(s.minSt && st < s.minSt);
    const alpha = s.a === undefined ? 1 : s.a;
    if (m === 'halo') { this.size[0] = s.size * (1 + 0.06 * Math.sin(t * 3)); this.col[0] = this.cols[0].r; this.col[1] = this.cols[0].g; this.col[2] = this.cols[0].b; this.col[3] = on ? alpha * (0.8 + 0.2 * Math.sin(t * 2.2)) : 0; p[0] = p[1] = p[2] = 0; this.flush(); return; }
    if (m === 'orbit') {
      const act = on ? Math.min(n, Math.ceil(n * k / (s.kMax || 1))) : 0, ct = Math.cos(s.tilt || 0), sn = Math.sin(s.tilt || 0), R = s.R || 1.5;
      for (let i = 0; i < n; i++) {
        const a = this.ph[i] + t * (s.spd || 1) * (1 + (i % 3) * 0.12) + i * (6.283 / n), q = i * 3, pr = R * (1 + 0.08 * Math.sin(i * 2.1 + t));
        const px = Math.cos(a) * pr, pz = Math.sin(a) * pr; p[q] = px; p[q + 1] = pz * sn; p[q + 2] = pz * ct;
        const c = this.cols[i % this.cols.length]; o[i * 4] = c.r; o[i * 4 + 1] = c.g; o[i * 4 + 2] = c.b;
        o[i * 4 + 3] = i < act ? alpha : 0; this.size[i] = i < act ? (s.size || 0.3) * (0.85 + 0.15 * Math.sin(t * 4 + i)) : 0; this.rot[i] = s.spin ? t * 1.5 + i : 0;
      }
      this.flush(); return;
    }
    if (on && s.rate) { this.acc += dt * s.rate * k; while (this.acc >= 1) { this.acc -= 1; let j = -1; for (let q = 0; q < n; q++) { const i = (this.head + q) % n; if (this.life[i] <= 0) { j = i; break; } } if (j < 0) { j = this.head; } this.head = (j + 1) % n; this.spawn(j); } }
    const ct = Math.cos(s.tilt || 0), sn = Math.sin(s.tilt || 0);
    for (let i = 0; i < n; i++) {
      const q = i * 3;
      if (this.life[i] <= 0) { o[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const u = 1 - Math.max(0, this.life[i]) / this.max[i], fade = Math.min(1, (1 - u) * 2.4) * Math.min(1, u * 14 + 0.25);
      if (m === 'sink') {
        const r = (s.R || 2) * (1 - u) + 0.95 * u; this.ph[i] += (s.spd || 2) * dt * (1.8 / r);
        const px = Math.cos(this.ph[i]) * r, pz = Math.sin(this.ph[i]) * r; p[q] = px; p[q + 1] = pz * sn; p[q + 2] = pz * ct;
      } else {
        p[q] += v[q] * dt; p[q + 1] += v[q + 1] * dt; p[q + 2] += v[q + 2] * dt;
        if (m === 'fall') p[q] += Math.sin(t * 2.2 + this.ph[i]) * dt * 0.5;
      }
      this.rot[i] += this.rv[i] * dt;
      let al = fade;
      if (m === 'surf') al *= 0.6 + 0.4 * Math.sin(t * 60 + i * 7);
      o[i * 4 + 3] = al * alpha;
      this.size[i] = this.s0[i] * (s.grow ? 0.6 + u * 1.1 : m === 'out' ? 1 - u * 0.7 : 0.55 + 0.45 * Math.min(1, u * 5));
    }
    this.flush();
  }
  flush() { const a = this.geo.attributes; a.position.needsUpdate = a.aCol.needsUpdate = a.aSize.needsUpdate = a.aRot.needsUpdate = true; }
  dispose(root) { root.remove(this.pts); this.geo.dispose(); this.mat.dispose(); }
}

function makeRing(spec) {
  const N = 56, pos = new Float32Array((N + 1) * 6), col = new Float32Array((N + 1) * 6), idx = [];
  const a = new THREE.Color(spec.col === undefined ? 0xffffff : spec.col), b = new THREE.Color(spec.col2 === undefined ? (spec.col === undefined ? 0xffffff : spec.col) : spec.col2);
  for (let i = 0; i <= N; i++) {
    const an = (i / N) * 6.283, cs = Math.cos(an), sn = Math.sin(an), k = i / N, f = 0.12 + 0.88 * Math.pow(k, 1.4);
    pos.set([cs * spec.r0, 0, sn * spec.r0, cs * spec.r1, 0, sn * spec.r1], i * 6);
    _c.copy(b).lerp(a, k).multiplyScalar(f); col.set([_c.r, _c.g, _c.b, _c.r, _c.g, _c.b], i * 6);
    if (i < N) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, opacity: spec.op || 0.7, fog: false }));
  m.frustumCulled = false; m.renderOrder = 3; m.rotation.x = spec.face ? Math.PI / 2 : spec.tilt || 0; m.userData.spec = spec;
  return m;
}

export class BallRig {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'ballrig';
    this.layers = []; this.rings = []; this.hat = null; this.stage = 0; this.k = 1; this.t = 0;
    this.mk = { px: { value: 400 }, s: { value: 1 } };
    this.on = false;
  }
  /** skin = skin id (effect balls only get layers), level = KARAKTER level (mythic stage), hat = hat id or null */
  set({ skin, level = 0, hat = null } = {}) {
    this.clear();
    const def = EFFECT_BY_ID[skin];
    if (def) {
      this.stage = def.myth ? stageOf(level) : 0;
      const st = def.st || [1, 1, 1]; this.k = st[this.stage]; const kMax = st[st.length - 1];
      for (const sp of def.rig || []) { const s = kMax > 1 ? { ...sp, kMax } : sp; this.layers.push(new Layer(s, this.root, this.mk)); }
      for (const r of def.rings || []) if ((r.st || 0) <= this.stage) { const m = makeRing(r); this.rings.push(m); this.root.add(m); }
    }
    if (hat) { this.hat = buildHat(hat); if (this.hat) this.root.add(this.hat.group); }
    this.on = !!(this.layers.length || this.rings.length || this.hat);
  }
  clear() {
    for (const l of this.layers) l.dispose(this.root);
    for (const r of this.rings) { this.root.remove(r); r.geometry.dispose(); r.material.dispose(); }
    if (this.hat) { this.root.remove(this.hat.group); this.hat.dispose(); }
    this.layers.length = 0; this.rings.length = 0; this.hat = null; this.on = false; this.stage = 0; this.k = 1;
  }
  /** call every frame: scale = ball radius in world units, viewH = canvas height in px */
  update(dt, t, scale, viewH, visible = true) {
    this.root.visible = visible && this.on;
    if (!this.on || !visible) return;
    this.root.scale.setScalar(scale); this.mk.s.value = scale; this.mk.px.value = viewH * 0.5;
    for (const l of this.layers) l.update(dt, t, this.k, this.stage);
    for (const r of this.rings) {
      const sp = r.userData.spec; r.rotation.y += dt * (sp.spin || 1);
      r.material.opacity = (sp.op || 0.7) * (0.85 + 0.15 * Math.sin(t * 3 + sp.r0 * 4));
      if (sp.hue) { r.material.color.setHSL((t * 0.4) % 1, 0.9, 0.62); }
    }
    if (this.hat && this.hat.update) this.hat.update(dt, t);
  }
  /** meshes drawn (for the perf assert) */
  calls() { return this.layers.length + this.rings.length + (this.hat ? 1 : 0); }
  dispose() { this.clear(); if (this.root.parent) this.root.parent.remove(this.root); }
}
