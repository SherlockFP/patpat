import * as THREE from 'three';
import { patchMaterial, SU } from './shaders.js';

const MAX_PARTS = 700;
const TRAIL_N = 90;

// ---- speed feel knobs ----
const MIST_N = 300;                        // soft puffs in the pool (spray, steam, powder)
const SPRAY_MIN = 7, SPRAY_FULL = 40;      // m/s: the ground kick-up starts / is at full strength
const SPRAY_RATE = 32;                     // puffs per second at full strength
const STREAK_MIN = 22, STREAK_FULL = 52;   // m/s: world-space speed streaks fade in / reach full strength
const STREAK_N = 56;                       // streaks in the pool (one draw call, positioned in the vertex shader)
const STREAK_ALPHA = 0.32;                 // peak opacity: they are a hint of wind, not a screen full of lines
const STREAK_PX = 1.4;                     // line width in CSS px

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
const _rgb = { r: 0, g: 0, b: 0 };

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
          gl_PointSize = size * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          float a = vA * smoothstep(1.0, 0.0, r) * (0.7 + 0.3 * (1.0 - r));
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
  puff(x, y, z, vx, vy, vz, size, life, color = 0xffffff, alpha = 0.55) {
    const i = this.mHead;
    this.mHead = (this.mHead + 1) % this.mN;
    const c = typeof color === 'number' ? _c.setHex(color) : color;
    this.mPos[i * 3] = x; this.mPos[i * 3 + 1] = y; this.mPos[i * 3 + 2] = z;
    this.mVel[i * 3] = vx; this.mVel[i * 3 + 1] = vy; this.mVel[i * 3 + 2] = vz;
    this.mCol[i * 3] = c.r; this.mCol[i * 3 + 1] = c.g; this.mCol[i * 3 + 2] = c.b;
    this.mLife[i] = this.mMax[i] = life;
    this.mSize[i] = size;
    this.mAlpha[i] = alpha;
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
        // storm / powder near the ball: thin it out so the white ball never vanishes into white
        const dx = this.mPos[o] - bp.x, dy = this.mPos[o + 1] - bp.y, dz = this.mPos[o + 2] - bp.z, q = (dx * dx + dy * dy + dz * dz) / (nearR * nearR);
        if (q < 1) { dens += al * (1 - q); al *= 0.3 + 0.7 * q; }
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
    count = Math.min(count, 12);
    if (this._bb === undefined) this._bb = 0;
    count = Math.min(count, Math.max(0, 40 - this._bb));
    this._bb += count;
    size *= 0.6;
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
      this.maxLife[i] = this.life[i] = 0.3 + Math.random() * 0.3;
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
    this.shadow.scale.setScalar(ball.r * 2.6 * (1 + lift * 0.05));
    // Lie along the slope instead of half-buried / half-floating.
    const hs = Math.max(0.5, ball.r);
    this.shadow.rotation.x = -Math.atan((w.groundY(ball.x, ball.d - hs) - w.groundY(ball.x, ball.d + hs)) / (2 * hs));
    this.shadow.material.opacity = Math.max(0.2, 1 - lift * 0.08) * 0.85;   // (the shaders add a tight contact occlusion on top)

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
        (0.28 + 0.42 * r) * (0.8 + 0.4 * kk), 0.5, this._sc, 0.5);
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
