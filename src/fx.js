import * as THREE from 'three';
import { patchMaterial, SU } from './shaders.js';

const MAX_PARTS = 700;
const TRAIL_N = 90;
const DEBRIS_MAX = 24, TAU2 = Math.PI * 2;   // town-destruction chunks per debris() call

// ---- speed feel knobs ----
const MIST_N = 300;                        // soft puffs in the pool (spray, steam, powder)
const SPRAY_MIN = 7, SPRAY_FULL = 40;      // m/s: the ground kick-up starts / is at full strength
const SPRAY_RATE = 32;                     // puffs per second at full strength
const STREAK_MIN = 22, STREAK_FULL = 52;   // m/s: world-space speed streaks fade in / reach full strength
const STREAK_N = 56;                       // streaks in the pool (one draw call, positioned in the vertex shader)
const STREAK_ALPHA = 0.32;                 // peak opacity: they are a hint of wind, not a screen full of lines
const STREAK_PX = 1.4;                     // line width in CSS px

// ---- score floaters: a pool of DOM "+N" labels animated by CSS (zero per-frame JS); two alternating keyframes restart a label without a reflow ----
const FL_N = 10;
const FL_CSS = `.fxfl{position:fixed;left:0;top:0;z-index:30;pointer-events:none;opacity:0;font:900 22px/1 system-ui,sans-serif;white-space:nowrap;text-shadow:0 2px 0 rgba(0,0,0,.45),0 0 6px rgba(0,0,0,.35);will-change:transform,opacity;animation-duration:.85s;animation-timing-function:ease-out;animation-fill-mode:forwards}
@keyframes fxflA{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}15%{opacity:1;transform:translate(-50%,-70%) scale(1.25)}100%{opacity:0;transform:translate(-50%,-230%) scale(1)}}
@keyframes fxflB{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}15%{opacity:1;transform:translate(-50%,-70%) scale(1.25)}100%{opacity:0;transform:translate(-50%,-230%) scale(1)}}
@keyframes fxpopA{0%{transform:scale(1)}35%{transform:scale(1.28)}100%{transform:scale(1)}}
@keyframes fxpopB{0%{transform:scale(1)}35%{transform:scale(1.28)}100%{transform:scale(1)}}`;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sprayK = (v) => clamp01((v - SPRAY_MIN) / (SPRAY_FULL - SPRAY_MIN));
export const sprayRate = (v, r) => SPRAY_RATE * sprayK(v) * (0.6 + 0.4 * clamp01(r / 1.5));   // puffs / s for a ball of radius r moving at v m/s
export const streakK = (v) => { const t = clamp01((v - STREAK_MIN) / (STREAK_FULL - STREAK_MIN)); return t * t * (3 - 2 * t); };

// Speed streaks: each streak is a thin screen-space quad from p0 (bright head) to p1 (fading tail, pointing along the direction of travel).
// The pool is a lattice of world-anchored seeds that wraps around a box ahead of the camera, so as the camera runs forward the streaks
// stream past it. They fade out near the lens and near the camera -> ball line of sight (the ball must always stay readable), and are
// depth-tested so walls and obstacles hide them. All per-vertex work happens here: nothing is touched per streak on the CPU.
const STREAK_VERT = /* glsl */`
uniform vec3 uDir;
uniform float uLen;
uniform float uBox;
uniform float uHalfW;
uniform float uAspect;
uniform float uK;
uniform vec3 uBall;
uniform float uBallR;
attribute vec2 aCorner;
attribute float aRnd;
varying float vA;
varying float vT;
void main() {
  vT = aCorner.x;
  vA = 0.0;
  vec3 e = vec3( uBox, uBox * 0.6, uBox );
  vec3 centre = cameraPosition + uDir * ( uBox * 0.6 );
  vec3 q = mod( position * ( 2.0 * e ) - centre + e, 2.0 * e ) - e;
  vec3 p0 = centre + q;
  vec3 p1 = p0 + uDir * ( uLen * ( 0.6 + 0.8 * aRnd ) );
  vec4 v0 = viewMatrix * vec4( p0, 1.0 );
  vec4 v1 = viewMatrix * vec4( p1, 1.0 );
  if ( v0.z > -0.8 || v1.z > -0.8 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  vec4 c0 = projectionMatrix * v0;
  vec4 c1 = projectionMatrix * v1;
  vec2 asp = vec2( uAspect, 1.0 );
  vec2 d = ( c1.xy / c1.w - c0.xy / c0.w ) * asp;
  float dl = length( d );
  vec2 dn = dl > 0.00001 ? d / dl : vec2( 1.0, 0.0 );
  vec4 c = aCorner.x < 0.5 ? c0 : c1;
  vec2 ndc = c.xy / c.w + vec2( -dn.y, dn.x ) / asp * ( aCorner.y * uHalfW );
  gl_Position = vec4( ndc * c.w, c.z, c.w );
  // opacity: nothing on the lens, nothing at the box edges (the wrap), nothing across the camera -> ball line of sight
  float dCam = length( p0 - cameraPosition );
  vec3 ab = uBall - cameraPosition;
  float tt = clamp( dot( p0 - cameraPosition, ab ) / max( dot( ab, ab ), 0.001 ), 0.0, 1.0 );
  float dLos = length( p0 - ( cameraPosition + ab * tt ) );
  float edge = max( max( abs( q.x ) / e.x, abs( q.y ) / e.y ), abs( q.z ) / e.z );
  vA = uK * ( 0.35 + 0.65 * aRnd ) * smoothstep( 3.0, 9.0, dCam ) * ( 1.0 - smoothstep( uBox, uBox * 1.6, dCam ) )
     * smoothstep( uBallR * 1.5 + 1.5, uBallR * 1.5 + 5.0, dLos ) * ( 1.0 - smoothstep( 0.72, 1.0, edge ) );
}
`;
const STREAK_FRAG = /* glsl */`
uniform vec3 uTint;
varying float vA;
varying float vT;
void main() {
  float a = vA * ( 1.0 - vT );
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( uTint, a );
}
`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _rgb = { r: 0, g: 0, b: 0 };
const _rgbWhite = new THREE.Color(1, 1, 1);

export class Fx {
  constructor(scene, world, camera = null) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;

    // ---- particles: one instanced low-poly rock/snow chunk mesh ----
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = patchMaterial(new THREE.MeshLambertMaterial({ flatShading: true }));
    this.parts = new THREE.InstancedMesh(geo, mat, MAX_PARTS);
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parts.frustumCulled = false;
    this.parts.count = 0;
    for (let i = 0; i < MAX_PARTS; i++) this.parts.setColorAt(i, _c.setRGB(1, 1, 1));
    scene.add(this.parts);
    this.px = new Float32Array(MAX_PARTS * 3);
    this.pv = new Float32Array(MAX_PARTS * 3);
    this.life = new Float32Array(MAX_PARTS);
    this.maxLife = new Float32Array(MAX_PARTS);
    this.size = new Float32Array(MAX_PARTS);
    this.spinA = new Float32Array(MAX_PARTS);
    this.n = 0;
    this.axis = new THREE.Vector3(0.3, 1, 0.5).normalize();
    this._shk = 0; this._st = 0; this.shakeOff = { x: 0, y: 0 };   // screen-shake hook (see shake())

    // ---- trail: ribbon pressed into the snow behind the ball ----
    const tg = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailCol = new Float32Array(TRAIL_N * 2 * 3).fill(1);
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    const idx = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    tg.setIndex(idx);
    this.trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({
      color: 0xbcd3ee, transparent: true, opacity: 0.75, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.trailPts = []; // {x, d, w}
    this.trailAcc = 0;

    // ---- blob shadow ----
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(20,40,95,0.9)');
    grd.addColorStop(0.55, 'rgba(20,40,95,0.55)');
    grd.addColorStop(1, 'rgba(20,40,95,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.shadow.frustumCulled = false;
    scene.add(this.shadow);

    // ---- mist / steam / powder puffs: soft round sprites that grow and fade ----
    const MN = MIST_N;
    this.mN = MN;
    this.mPos = new Float32Array(MN * 3);
    this.mVel = new Float32Array(MN * 3);
    this.mCol = new Float32Array(MN * 3);
    this.mLife = new Float32Array(MN);
    this.mMax = new Float32Array(MN);
    this.mSize = new Float32Array(MN);
    this.mSizeAttr = new Float32Array(MN);
    this.mAlpha = new Float32Array(MN);
    this.mKeep = new Uint8Array(MN);            // 1 = a pickup / hit flash: never thinned out near the ball
    this.mHead = 0;
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(this.mPos, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('color', new THREE.BufferAttribute(this.mCol, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('size', new THREE.BufferAttribute(this.mSizeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('alpha', new THREE.BufferAttribute(this.mAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mist = new THREE.Points(mg, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vA; varying vec3 vC; uniform float uScale;
        void main() {
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * uScale / max(0.5, -mv.z), 256.0);   // (a puff right at the lens would be a full-screen fill)
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          float a = vA * (1.0 - smoothstep(0.0, 1.0, r)) * (0.7 + 0.3 * (1.0 - r));   // (smoothstep with edge0 > edge1 is undefined in GLSL ES)
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
    }));
    this.mist.frustumCulled = false;
    this.mistNear = 0;   // 0..1 how much storm / powder is around the ball (read by main for the ball rim)
    scene.add(this.mist);

    // ---- ball speed (from its own movement, so it works in every mode) -> ground kick-up + world-space speed streaks ----
    this.speed = 0;                          // smoothed m/s of the ball, 0 after a teleport
    this._kp = new THREE.Vector3();          // last ball position
    this._kv = new THREE.Vector3();          // smoothed velocity
    this._kReady = false;
    this._ka = 0;                            // kick-up puff accumulator
    this._sk = 0;                            // streak strength (eased)
    this._ss = 1;                            // streak field scale (eased; follows the camera distance)
    this._sc = new THREE.Color();            // spray colour
    this.streaks = this._buildStreaks();
    scene.add(this.streaks);
    this._fl = null; this._flStyle = null; this._flI = 0; this._flA = 0; this._popA = 0;   // score floaters (built on the first floater() call)
  }

  _buildStreaks() {
    const n = STREAK_N, pos = new Float32Array(n * 12), cor = new Float32Array(n * 8), rn = new Float32Array(n * 4), idx = new Uint16Array(n * 6);
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const x = rnd(), y = rnd(), z = rnd(), a = rnd();
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        cor[v * 2] = k >> 1;                  // 0 = head, 1 = tail
        cor[v * 2 + 1] = k & 1 ? 1 : -1;      // side of the line
        rn[v] = a;
      }
      const b = i * 4;
      idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rn, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: {
        uDir: { value: new THREE.Vector3(0, 0, -1) }, uLen: { value: 2 }, uBox: { value: 24 }, uHalfW: { value: 0.002 }, uAspect: { value: 0.5 },
        uK: { value: 0 }, uBall: { value: new THREE.Vector3() }, uBallR: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.frustumCulled = false;
    m.renderOrder = 4;
    m.visible = false;
    return m;
  }

  // Soft puff: snow powder, steam, dust. vel in world units/s; size in metres.
  puff(x, y, z, vx, vy, vz, size, life, color = 0xffffff, alpha = 0.55, keep = 0) {
    const i = this.mHead;
    this.mHead = (this.mHead + 1) % this.mN;
    const c = typeof color === 'number' ? _c.setHex(color) : color;
    this.mPos[i * 3] = x; this.mPos[i * 3 + 1] = y; this.mPos[i * 3 + 2] = z;
    this.mVel[i * 3] = vx; this.mVel[i * 3 + 1] = vy; this.mVel[i * 3 + 2] = vz;
    this.mCol[i * 3] = c.r; this.mCol[i * 3 + 1] = c.g; this.mCol[i * 3 + 2] = c.b;
    this.mLife[i] = this.mMax[i] = life;
    this.mSize[i] = size;
    this.mAlpha[i] = alpha;
    this.mKeep[i] = keep;
    this.mBase = this.mBase || new Float32Array(this.mN);
    this.mBase[i] = alpha;
  }

  updateMist(dt, ball) {
    const n = this.mN;
    const bp = ball && ball.group ? ball.group.position : null, br = ball ? ball.r || 1 : 1;
    const nearR = br * 3 + 6;
    let dens = 0;
    for (let i = 0; i < n; i++) {
      if (this.mLife[i] <= 0) { this.mAlpha[i] = 0; this.mSizeAttr[i] = 0; continue; }
      this.mLife[i] -= dt;
      const t = 1 - Math.max(0, this.mLife[i]) / this.mMax[i];
      const o = i * 3;
      const drag = Math.exp(-2.2 * dt);
      this.mVel[o] *= drag; this.mVel[o + 1] = this.mVel[o + 1] * drag + 0.6 * dt; this.mVel[o + 2] *= drag;
      this.mPos[o] += this.mVel[o] * dt; this.mPos[o + 1] += this.mVel[o + 1] * dt; this.mPos[o + 2] += this.mVel[o + 2] * dt;
      this.mSizeAttr[i] = this.mSize[i] * (0.5 + 1.6 * t);
      let al = (this.mBase ? this.mBase[i] : 0.5) * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      if (bp) {
        // storm / powder near the ball: thin it out so the white ball never vanishes into white (the bright hit / pickup flashes are capped too: a ball buried in its own burst cannot be steered)
        const dx = this.mPos[o] - bp.x, dy = this.mPos[o + 1] - bp.y, dz = this.mPos[o + 2] - bp.z, q = (dx * dx + dy * dy + dz * dz) / (nearR * nearR);
        if (q < 1) { if (this.mKeep[i]) al *= 0.4 + 0.6 * q; else { dens += al * (1 - q); al *= 0.3 + 0.7 * q; } }
      }
      this.mAlpha[i] = al;
    }
    this.mistNear += (Math.min(1, dens / 2.5) - this.mistNear) * Math.min(1, dt * 4);
    const g = this.mist.geometry.attributes;
    g.position.needsUpdate = g.size.needsUpdate = g.alpha.needsUpdate = g.color.needsUpdate = true;
    this.mist.material.uniforms.uScale.value = window.innerHeight * 0.9;
  }

  // Trail look from the wardrobe: { color, rainbow, glow }.
  setTrailStyle(style) {
    const m = this.trail.material;
    m.color.setHex(style.rainbow ? 0xffffff : style.color);
    m.vertexColors = !!style.rainbow;
    m.blending = style.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.opacity = style.glow ? 0.9 : 0.75;
    m.needsUpdate = true;
    if (style.rainbow) {
      const c = new THREE.Color();
      for (let i = 0; i < TRAIL_N; i++) {
        if (style.palette) c.setHex(style.palette[Math.floor(i / 6) % style.palette.length]);
        else c.setHSL((i / TRAIL_N) * 2 % 1, 0.85, 0.6);
        for (const k of [0, 3]) { this.trailCol[i * 6 + k] = c.r; this.trailCol[i * 6 + k + 1] = c.g; this.trailCol[i * 6 + k + 2] = c.b; }
      }
      this.trail.geometry.attributes.color.needsUpdate = true;
    }
  }

  reset() {
    if (this.mLife) this.mLife.fill(0);
    this._kReady = false; this._ka = 0; this._sk = 0; this.speed = 0;
    this._shk = 0; this.shakeOff.x = this.shakeOff.y = 0;
    this.streaks.visible = false;
    this.n = 0;
    this.parts.count = 0;
    this.trailPts.length = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  // Burst of chunks. color: THREE.Color or hex.
  burst(x, y, d, count, color, speed = 6, size = 0.25, up = 4) {
    const c = typeof color === 'number' ? _c.setHex(color) : color;
    // debris budget: smaller, fewer, short-lived, thrown away from the camera (never between camera and ball)
    const big = count >= 3;
    count = Math.min(count, 12);
    if (this._bb === undefined) this._bb = 0;
    count = Math.min(count, Math.max(0, 40 - this._bb));
    this._bb += count;
    size *= 0.75;
    if (big) {
      // readability: a soft bright flash + a short-lived halo in the item's colour, so a pickup / hit reads even when the chunks are tiny
      _c2.copy(c).lerp(_rgbWhite, 0.4);
      this.puff(x, y + size, -d - size, 0, 0.6, 0, size * 9 + 0.6, 0.28, _c2, 0.8, 1);
      this.puff(x, y + size * 2, -d - size, 0, 1.2, 0, size * 14 + 1.0, 0.55, c, 0.4, 1);
      // pop ring: five bright sparks fly out sideways (skipped in the lite quality rung)
      if (!SU.uLite.value) for (let k = 0; k < 5; k++) { const a = k * 1.2566 + 0.4; this.puff(x, y + size, -d - size, Math.cos(a) * 4, Math.sin(a) * 3 + 1, 0, size * 3 + 0.25, 0.32, _c2, 0.75, 1); }
    }
    for (let k = 0; k < count; k++) {
      let i;
      if (this.n < MAX_PARTS) i = this.n++;
      else i = (Math.random() * MAX_PARTS) | 0; // recycle a random one when saturated
      const a = Math.random() * Math.PI * 2, e = Math.random();
      this.px[i * 3] = x + (Math.random() - 0.5) * size * 2;
      this.px[i * 3 + 1] = y + Math.random() * size;
      this.px[i * 3 + 2] = -d - Math.random() * size * 2;
      this.pv[i * 3] = Math.cos(a) * speed * (0.3 + e);
      this.pv[i * 3 + 1] = up * (0.4 + Math.random() * 0.6) * 0.8;
      this.pv[i * 3 + 2] = -Math.abs(Math.sin(a)) * speed * (0.3 + e);
      this.maxLife[i] = this.life[i] = 0.4 + Math.random() * 0.4;
      this.size[i] = size * (0.5 + Math.random());
      this.spinA[i] = Math.random() * 6;
      this.parts.setColorAt(i, c);
    }
    this.parts.instanceColor.needsUpdate = true;
  }

  update(dt, ball) {
    const w = this.world;
    this.updateMist(dt, ball);
    this._bb = 0;
    const fl = SU.uFlash.value;
    if (fl.w > 0) fl.w = fl.w < 0.004 ? 0 : fl.w * Math.exp(-dt * 9);
    if (this._shk > 0.005) {
      this._shk *= Math.exp(-dt * 7);
      this._st += dt * 55;
      this.shakeOff.x = Math.sin(this._st) * this._shk; this.shakeOff.y = Math.cos(this._st * 1.3) * this._shk * 0.7;
    } else { this._shk = 0; this.shakeOff.x = this.shakeOff.y = 0; }
    // particles
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        this.copyPart(n, i);
        i--;
        continue;
      }
      const o = i * 3;
      this.pv[o + 1] -= 22 * dt;
      this.px[o] += this.pv[o] * dt;
      this.px[o + 1] += this.pv[o + 1] * dt;
      this.px[o + 2] += this.pv[o + 2] * dt;
      const gy = w.groundY(this.px[o], -this.px[o + 2]);
      if (this.px[o + 1] < gy) {
        this.px[o + 1] = gy;
        this.pv[o + 1] *= -0.3;
        this.pv[o] *= 0.6;
        this.pv[o + 2] *= 0.6;
      }
      this.spinA[i] += dt * 8;
      const t = this.life[i] / this.maxLife[i];
      _p.set(this.px[o], this.px[o + 1], this.px[o + 2]);
      _q.setFromAxisAngle(this.axis, this.spinA[i]);
      _s.setScalar(this.size[i] * Math.min(1, t * 3));
      _m.compose(_p, _q, _s);
      this.parts.setMatrixAt(i, _m);
    }
    this.n = n;
    this.parts.count = n;
    this.parts.instanceMatrix.needsUpdate = true;

    // shadow
    const gy = w.groundY(ball.x, ball.d) + w.rampAt(ball.x, ball.d);
    const lift = Math.max(0, ball.y - ball.r - gy);
    this.shadow.position.set(ball.x, gy + 0.06, -ball.d);
    const lob = ball.rim && ball.rim.visible;      // lobby hero ball: a bigger, darker drop shadow
    this.shadow.scale.setScalar(ball.r * (lob ? 3.3 : 2.6) * (1 + lift * 0.05));
    // Lie along the slope instead of half-buried / half-floating.
    const hs = Math.max(0.5, ball.r);
    this.shadow.rotation.x = -Math.atan((w.groundY(ball.x, ball.d - hs) - w.groundY(ball.x, ball.d + hs)) / (2 * hs));
    this.shadow.material.opacity = Math.max(0.2, 1 - lift * 0.08) * (lob ? 1 : 0.85);   // (the shaders add a tight contact occlusion on top)

    this.updateTrail(dt, ball);
    this.updateKick(dt, ball);
    this.updateStreaks(dt, ball);
  }

  // Snow kicked up at the contact point: heading, rate and size follow the ball's speed and radius. Soft puffs only (the shared mist pool).
  updateKick(dt, ball) {
    const g = ball.group;
    if (!g || !(dt > 1e-4)) return;
    const p = g.position, v = this._kv;
    if (!this._kReady) { this._kp.copy(p); v.set(0, 0, 0); this._kReady = true; this.speed = 0; return; }
    const dx = p.x - this._kp.x, dy = p.y - this._kp.y, dz = p.z - this._kp.z;
    this._kp.copy(p);
    if (dx * dx + dy * dy + dz * dz > 25) { v.set(0, 0, 0); this.speed = 0; return; }   // teleport: respawn, revive, junction snap
    const k = 1 - Math.exp(-dt * 12);
    v.x += (dx / dt - v.x) * k; v.y += (dy / dt - v.y) * k; v.z += (dz / dt - v.z) * k;
    const sp = this.speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    // (a mostly vertical move is a loop / wall / drop: the contact point is not under the ball there)
    if (ball.airborne || !g.visible || sp < SPRAY_MIN || Math.abs(v.y) > sp * 0.7) { this._ka = 0; return; }
    this._ka += dt * sprayRate(sp, ball.r) * (SU.uLite.value ? 0.5 : 1);   // (half in the lite quality rung)
    const n = Math.min(3, this._ka | 0);
    this._ka -= this._ka | 0;
    if (!n) return;
    const r = ball.r, kk = sprayK(sp);
    let hx = v.x, hz = v.z;
    const hl = Math.sqrt(hx * hx + hz * hz) || 1;
    hx /= hl; hz /= hl;
    const f = this.scene.fog;
    if (f) {
      f.color.getRGB(_rgb, THREE.SRGBColorSpace);
      this._sc.setRGB(_rgb.r + (1 - _rgb.r) * 0.55, _rgb.g + (1 - _rgb.g) * 0.55, _rgb.b + (1 - _rgb.b) * 0.55, THREE.LinearSRGBColorSpace);
    } else this._sc.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace);
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1, sj = Math.random(), back = r * (0.5 + Math.random() * 0.6), lat = side * r * (0.35 + sj * 0.6);
      this.puff(
        p.x - hx * back - hz * lat, p.y - r * 0.82, p.z - hz * back + hx * lat,
        -hx * sp * 0.08 - hz * side * (0.8 + sj * 1.6), 1 + Math.random() * 2.4 * kk, -hz * sp * 0.08 + hx * side * (0.8 + sj * 1.6),
        (0.28 + 0.42 * r) * (0.8 + 0.4 * kk), 0.5, this._sc, 0.4);   // (< 50% alpha: a pale spray must not swallow the white ball on dust)
    }
  }

  // World-space speed streaks (see STREAK_VERT): strength follows the ball speed, off in the pixel look and the lite quality rung.
  updateStreaks(dt, ball) {
    const m = this.streaks, cam = this.camera;
    const want = cam && SU.uFx.value && ball.group.visible ? streakK(this.speed) : 0;
    this._sk += (want - this._sk) * (1 - Math.exp(-dt * 3));
    if (this._sk < 0.01) { m.visible = false; return; }
    m.visible = true;
    const u = m.material.uniforms, v = this._kv, sp = this.speed, inv = 1 / Math.max(sp, 0.001), bp = ball.group.position;
    // the field follows the camera's distance to the ball, so a big ball (far camera) gets proportionally bigger / longer streaks
    this._ss += (Math.min(6, Math.max(0.8, cam.position.distanceTo(bp) / 11)) - this._ss) * Math.min(1, dt * 2);
    u.uDir.value.set(v.x * inv, v.y * inv, v.z * inv);
    u.uK.value = this._sk * STREAK_ALPHA;
    u.uBox.value = 24 * this._ss;
    u.uLen.value = Math.min(4, Math.max(1, sp * 0.05)) * this._ss;
    u.uBall.value.copy(bp);
    u.uBallR.value = ball.r;
    u.uAspect.value = cam.aspect;
    u.uHalfW.value = STREAK_PX / window.innerHeight;
    // darker than the haze on pale biomes, a pale glint on dark ones, so they read on either
    const f = this.scene.fog;
    if (f) {
      f.color.getRGB(_rgb, THREE.SRGBColorSpace);
      const lum = 0.299 * _rgb.r + 0.587 * _rgb.g + 0.114 * _rgb.b;
      if (lum > 0.55) u.uTint.value.setRGB(_rgb.r * 0.8, _rgb.g * 0.84, _rgb.b * 0.9, THREE.LinearSRGBColorSpace);
      else u.uTint.value.setRGB(_rgb.r + (1 - _rgb.r) * 0.65, _rgb.g + (1 - _rgb.g) * 0.65, _rgb.b + (1 - _rgb.b) * 0.65, THREE.LinearSRGBColorSpace);
    }
  }

  // Full-screen hit flash (white by default, display-space rgb 0..1): the strength eases out in ~0.3 s in update(). Cheap: one uniform in the shared finish.
  // Intended call sites (nobody calls it yet; src/runner/runner.js, the rush lane owns it): on a lost life / stumble `fx.hitFlash(0.5, 1, 0.3, 0.25)` (red), on a near miss
  // `fx.hitFlash(0.25)` (white), on a multiplier / set-complete pop `fx.hitFlash(0.35, 1, 0.9, 0.5)` (gold). One call per event, never per frame (it only raises the strength).
  hitFlash(strength = 0.55, r = 1, g = 1, b = 1) {
    const fl = SU.uFlash.value;
    fl.set(r, g, b, Math.max(fl.w, Math.min(0.9, strength)));
  }

  // Short full-screen white "photo flash" (postcard moments): hitFlash at its cap.
  photoFlash() { this.hitFlash(0.9, 1, 1, 1); }

  // Town destruction (ÇIĞ finale; the cig lane calls these as fx.debris?.() / fx.dust?.() / fx.shake?.()). pos = world {x, y, z} (z = -d), like puff().
  // Chunks go into the shared particle pool (no new draw call); a call throws at most DEBRIS_MAX (the pool recycles when full). Both are off in the lite rung.
  debris(pos, color = 0xb08a5a, n = 8) {
    if (SU.uLite.value || !pos) return;
    const c = typeof color === 'number' ? _c.setHex(color) : color;
    n = Math.min(n | 0, DEBRIS_MAX);
    for (let k = 0; k < n; k++) {
      const i = this.n < MAX_PARTS ? this.n++ : (Math.random() * MAX_PARTS) | 0;
      const a = Math.random() * TAU2, sp = 3 + Math.random() * 7, sz = 0.3 + Math.random() * 0.5;
      this.px[i * 3] = pos.x + Math.cos(a) * 0.4; this.px[i * 3 + 1] = pos.y + Math.random() * 0.6; this.px[i * 3 + 2] = pos.z + Math.sin(a) * 0.4;
      this.pv[i * 3] = Math.cos(a) * sp; this.pv[i * 3 + 1] = 5 + Math.random() * 9; this.pv[i * 3 + 2] = Math.sin(a) * sp;
      this.maxLife[i] = this.life[i] = 0.8 + Math.random() * 0.7;
      this.size[i] = sz;
      this.spinA[i] = Math.random() * 6;
      this.parts.setColorAt(i, c);
    }
    this.parts.instanceColor.needsUpdate = true;
  }

  // Expanding dust ring of r metres (soft puffs from the shared mist pool, 8 + 3 rising).
  dust(pos, r = 3, color = 0xcdbfa8) {
    if (SU.uLite.value || !pos) return;
    for (let k = 0; k < 8; k++) {
      const a = k * 0.7854 + Math.random() * 0.4;
      this.puff(pos.x + Math.cos(a) * r * 0.3, pos.y + 0.3, pos.z + Math.sin(a) * r * 0.3, Math.cos(a) * r * 1.6, 0.8, Math.sin(a) * r * 1.6, r * 0.5 + 0.6, 0.9, color, 0.55, 1);
    }
    for (let k = 0; k < 3; k++) this.puff(pos.x + (Math.random() - 0.5) * r * 0.6, pos.y + 0.5, pos.z + (Math.random() - 0.5) * r * 0.6, 0, 2.5 + Math.random() * 2, 0, r * 0.6 + 0.8, 1.2, color, 0.5, 1);
  }

  // Screen-shake hook: raises the strength (metres of camera offset, max 1.2); update() decays it in ~0.4 s and keeps
  // this.shakeOff {x, y} current. The camera owner adds shakeOff to its position (nothing applies it here); dead in the lite rung.
  shake(amp = 0.4) { if (!SU.uLite.value) this._shk = Math.max(this._shk, Math.min(1.2, amp)); }

  // Pooled "+N" label at screen position (x, y) in CSS px (client coords), colour = hex or CSS string. Text is whatever the caller passes (already translated).
  // At most FL_N labels live at once (the oldest is reused); no per-frame work here: the CSS animation does it all. No DOM (node check, SSR) = no-op.
  floater(text, x, y, color = 0xffffff) {
    const d = typeof document !== 'undefined' ? document : null;
    if (!d || !d.body || !d.head) return;
    if (!this._fl) {
      this._ensureCss(); this._fl = [];
      for (let i = 0; i < FL_N; i++) { const e = d.createElement('div'); e.className = 'fxfl'; e.setAttribute('aria-hidden', 'true'); d.body.appendChild(e); this._fl.push(e); }
    }
    const e = this._fl[this._flI]; this._flI = (this._flI + 1) % FL_N;
    e.textContent = text;
    e.style.left = Math.max(48, Math.min((typeof innerWidth === 'number' ? innerWidth : 390) - 48, x)) + 'px'; e.style.top = y + 'px';      // (16 px margin + half a label)
    e.style.color = typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color;
    e.style.animationName = (this._flA ^= 1) ? 'fxflA' : 'fxflB';
  }

  // Shader-free score pop: a 0.18 s scale bump on any DOM element (the HUD score), restarted on every call. Safe to call per pickup.
  scorePop(el) {
    if (!el || !el.style) return;
    this._ensureCss();
    el.style.animationName = (this._popA ^= 1) ? 'fxpopA' : 'fxpopB';
    el.style.animationDuration = '0.18s';
    el.style.animationTimingFunction = 'ease-out';
  }

  _ensureCss() {
    const d = typeof document !== 'undefined' ? document : null;
    if (!d || !d.head || this._flStyle) return;
    const st = d.createElement('style'); st.textContent = FL_CSS; d.head.appendChild(st); this._flStyle = st;
  }

  // Level-up burst at world pos {x, y, z} (z = -d): a gold ring of soft puffs + a rising column + a faint gold flash. Pool puffs only; half as many in the lite rung.
  levelUp(pos) {
    if (!pos) return;
    const cam = this.camera;
    if (cam && typeof innerWidth === 'number') {      // the anchor stays 56 px (16 px margin + the ring's own radius) inside the screen edge: a ring cut by the edge is noise
      const m = 1 - 112 / innerWidth;
      _p.copy(pos).project(cam);
      if (_p.z < 1 && (_p.x > m || _p.x < -m)) { _p.x = _p.x > 0 ? m : -m; _p.unproject(cam); pos = _p; }
    }
    const n = SU.uLite.value ? 6 : 12;
    _c2.setHex(0xffd23a);
    for (let k = 0; k < n; k++) {
      const a = k * TAU2 / n;
      this.puff(pos.x + Math.cos(a) * 0.4, pos.y, pos.z + Math.sin(a) * 0.4, Math.cos(a) * 5, 1.2, Math.sin(a) * 5, 0.7, 0.7, _c2, 0.85, 1);
    }
    for (let k = 0; k < 3; k++) this.puff(pos.x, pos.y + k * 0.5, pos.z, 0, 3 + k, 0, 1.1, 0.9, _c2, 0.6, 1);
    this.hitFlash(0.3, 1, 0.9, 0.5);
  }

  // Compile every program this file owns once, before the first frame that needs it (the speed streaks are hidden until the ball is fast,
  // so their shader would otherwise compile in the middle of a run). Call after the scene is built, e.g. at run start: fx.prewarm?.(renderer, scene, camera).
  prewarm(renderer, scene = this.scene, camera = this.camera) {
    if (!renderer || !renderer.compile || !scene || !camera) return;
    const m = this.streaks, was = m.visible;
    m.visible = true;
    try { renderer.compile(scene, camera); } catch (e) { /* a failed warm-up must never stop the run */ }
    m.visible = was;
  }

  // Free the GPU resources (geometry, materials, the shadow texture) and take everything out of the scene.
  dispose() {
    SU.uFlash.value.w = 0;
    for (const m of [this.parts, this.trail, this.shadow, this.mist, this.streaks]) {
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
    }
    if (this.parts.dispose) this.parts.dispose();
    if (this._fl) for (const e of this._fl) e.remove();
    if (this._flStyle) this._flStyle.remove();
    this._fl = null; this._flStyle = null;
  }

  copyPart(from, to) {
    if (from === to) return;
    for (let k = 0; k < 3; k++) {
      this.px[to * 3 + k] = this.px[from * 3 + k];
      this.pv[to * 3 + k] = this.pv[from * 3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size[to] = this.size[from];
    this.spinA[to] = this.spinA[from];
    this.parts.getColorAt(from, _c);
    this.parts.setColorAt(to, _c);
    this.parts.instanceColor.needsUpdate = true;
  }

  updateTrail(dt, ball) {
    const pts = this.trailPts;
    const last = pts[pts.length - 1];
    const step = 0.6 + ball.r * 0.25;
    if (ball.airborne) {
      if (last && !last.gap) pts.push({ x: last.x, d: last.d, w: 0, gap: true });
    } else if (!last || Math.hypot(ball.x - last.x, ball.d - last.d) > step) {
      // After a jump, start with a zero-width point at the landing spot so no wedge spans the flight.
      if (last && last.gap) pts.push({ x: ball.x, d: ball.d, w: 0, gap: true });
      pts.push({ x: ball.x, d: ball.d, w: ball.r * 0.85 });
    }
    while (pts.length > TRAIL_N) pts.shift();
    const w = this.world;
    const arr = this.trailPos;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const nx = pts[Math.min(n - 1, i + 1)], pv = pts[Math.max(0, i - 1)];
      let tx = nx.x - pv.x, td = nx.d - pv.d;
      const len = Math.hypot(tx, td) || 1;
      tx /= len; td /= len;
      // perpendicular in xz (world z = -d)
      const fade = Math.min(1, i / 12);
      const hw = p.w * fade;
      const lx = p.x + td * hw, ld = p.d - tx * hw;
      const rx = p.x - td * hw, rd = p.d + tx * hw;
      arr[i * 6] = lx; arr[i * 6 + 1] = w.groundY(lx, ld) + 0.04; arr[i * 6 + 2] = -ld;
      arr[i * 6 + 3] = rx; arr[i * 6 + 4] = w.groundY(rx, rd) + 0.04; arr[i * 6 + 5] = -rd;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }
}
