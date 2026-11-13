import * as THREE from 'three';
import { patchMaterial } from './shaders.js';

const STUCK_CAP = 28;   // per prop type; oldest gets buried first
const STUCK_TYPES = 22; // distinct prop types stuck on the ball at once (least recently eaten type is dropped)

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _axis = new THREE.Vector3();

// KARAKTER level badge: a ring hovering round the ball's equator, arc = level / 5 of a full turn, colour climbs with the level.
// Driven by snow.material.userData.level (1-5, set by makeSkin(id, level) or by hand); absent / 0 = no ring.
const BADGE_COL = [0x9fd8ff, 0x7aff9a, 0xffd23a, 0xff8a2a, 0xff5cf0];
let _badgeGeo = null;

export class Ball {
  constructor(scene, lib, material) {
    this.lib = lib;
    this.material = material;
    this.group = new THREE.Group();   // position + squash only
    this.spin = new THREE.Group();    // accumulated rolling rotation
    this.group.add(this.spin);
    scene.add(this.group);

    this._ownGeo = makeSnowGeometry();
    this._ownMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { snow: true });
    this.snow = new THREE.Mesh(this._ownGeo, this._ownMat);
    this.spin.add(this.snow);
    // lobby rim light: a fresnel shell (additive, view-space) so the hero ball does not melt into the lilac sky; main.js shows it in the menu only
    this.rim = new THREE.Mesh(new THREE.IcosahedronGeometry(1.012, 3), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 3.0); gl_FragColor = vec4(vec3(1.0, 0.93, 1.0) * f * 1.1, 1.0); }',
    }));
    this.rim.visible = false; this.rim.renderOrder = 3; this.rim.frustumCulled = false;
    this.snow.add(this.rim);      // (a child of the snow mesh: it shares its scale and spin)

    if (!_badgeGeo) _badgeGeo = BADGE_COL.map((_, i) => new THREE.RingGeometry(1.14, 1.3, 40, 1, 0, Math.PI * 2 * (i + 1) / 5).rotateX(-Math.PI / 2));
    this.badge = new THREE.Mesh(_badgeGeo[0], new THREE.MeshBasicMaterial({ color: BADGE_COL[0], transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.badge.visible = false; this.badge.frustumCulled = false; this.badge.renderOrder = 2;
    this.group.add(this.badge);
    this._bl = 0; this._bt = 0;
    this.pp = 0; this.pv = 0; // scale punch spring (growth feedback)
    this.sq = 0; this.sqv = 0; // squash spring (landing / bounce): >0 = flattened
    this.hopY = 0; this.hopV = 0; this.hopping = false; this.onHopLand = null; // lobby bounce
    this.visK = 1; this.visT = 1;  // visual-only size factor (the giant power)
    this.stuck = {}; // type → { mesh, items: [], t }
    this.stuckT = 0;
    this.riders = []; this.flee = []; this.rt = 0;   // EKİP TOPU: mini snowmen riding on top (max 3) + ones that ran away
    this.reset(0.55);
  }

  reset(r) {
    this.r = r;
    this.x = 0; this.d = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.speed = 0;
    this.airborne = false;
    this.airTime = 0;
    this.spin.quaternion.identity();
    for (const k of Object.keys(this.stuck)) this.dropSlot(k);
    this.pp = 0; this.pv = 0; this.sq = 0; this.sqv = 0;
    this.hopY = 0; this.hopV = 0; this.hopping = false;
    this.visK = 1; this.visT = 1;
    this.setRiders(0);
    for (const f of this.flee) f.m.parent && f.m.parent.remove(f.m);
    this.flee.length = 0;
    this.applyScale();
    this.group.scale.set(1, 1, 1);
  }

  // Take the ball out of the scene and free what it owns. (The skin's geometry / material belong to disposeSkin; the one built here is only
  // freed when it is still the mesh's own; main.js swapping in a skin leaves the original unreferenced but undisposed (one-off, ~4k verts).)
  dispose() {
    for (const k of Object.keys(this.stuck)) this.dropSlot(k);
    this.setRiders(0);
    for (const f of this.flee) f.m.parent && f.m.parent.remove(f.m);
    this.flee.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.snow.geometry === this._ownGeo) this._ownGeo.dispose();
    if (this.snow.material === this._ownMat) this._ownMat.dispose();
    this.badge.material.dispose();   // (the five ring geometries are shared module-wide)
  }

  // ---- EKİP TOPU: cute mini snowmen on top of the ball
  riderN() { return this.riders.length; }
  setRiders(n) {
    while (this.riders.length > n) this.group.remove(this.riders.pop());
    while (this.riders.length < n) { const m = makeRider(); this.group.add(m); this.riders.push(m); }
  }
  // the last rider is knocked off: it hops away to the side and shrinks out
  dropRider() {
    const m = this.riders.pop();
    if (!m) return;
    this.group.remove(m);
    const par = this.group.parent;
    if (!par) return;
    m.position.copy(this.group.position).add(_v.set(m.userData.ox * this.r, this.r * 0.95, 0));
    m.scale.setScalar(m.userData.sc);
    par.add(m);
    const side = m.userData.ox < 0 ? -1 : m.userData.ox > 0 ? 1 : (Math.random() < 0.5 ? -1 : 1);
    this.flee.push({ m, vx: side * (5 + Math.random() * 2), vy: 5, vz: -this.speed * 0.2, t: 0, gy: this.y - this.r * 0.9, s0: m.userData.sc });
  }

  applyScale() {
    this.snow.scale.setScalar(this.r * (1 + this.pp) * this.visK);
  }

  // Growth punch: a quick springy overshoot of the snowball's scale (peak about 0.9 * a, settles in ~0.25 s).
  punch(a) { this.pv += a * 45; }

  // Landing / hit squash: a = 0.1..0.4 (fraction flattened at the peak).
  squash(a) { this.sqv += a * 40; }

  // Lobby bounce: a hop with stretch on the way up and squash on landing.
  bounce(v = 7.5) {
    this.hopV = v;
    this.hopping = true;
    this.sqv -= 5; // stretch
  }

  setVisual(k) { this.visT = k; }

  tick(dt) {
    const h = Math.min(dt, 0.033);
    if (this.pp !== 0 || this.pv !== 0) {
      const w = 32, z = 0.32;
      this.pv += (-w * w * this.pp - 2 * z * w * this.pv) * h;
      this.pp += this.pv * h;
      if (Math.abs(this.pp) < 1e-4 && Math.abs(this.pv) < 1e-3) { this.pp = 0; this.pv = 0; }
    }
    if (this.sq !== 0 || this.sqv !== 0) {
      const w = 26, z = 0.34;
      this.sqv += (-w * w * this.sq - 2 * z * w * this.sqv) * h;
      this.sq += this.sqv * h;
      this.sq = Math.max(-0.35, Math.min(0.5, this.sq));
      if (Math.abs(this.sq) < 1e-3 && Math.abs(this.sqv) < 1e-2) { this.sq = 0; this.sqv = 0; }
    }
    if (this.hopping) {
      this.hopV -= 24 * h;
      this.hopY += this.hopV * h;
      if (this.hopY <= 0 && this.hopV < 0) {
        const v = -this.hopV;
        this.hopY = 0; this.hopV = 0; this.hopping = false;
        this.sqv += 2.4 + v * 0.5;
        if (this.onHopLand) this.onHopLand(v);
      }
    }
    if (this.visK !== this.visT) {
      this.visK += (this.visT - this.visK) * Math.min(1, dt * 6);
      if (Math.abs(this.visT - this.visK) < 0.002) this.visK = this.visT;
    }
    this.applyScale();
    this.tickBadge(dt);
    this.tickRiders(dt);
  }

  tickBadge(dt) {
    const u = this.snow.material && this.snow.material.userData, b = this.badge;
    const lv = u && u.level > 0 ? Math.min(5, u.level | 0) : 0;
    if (lv !== this._bl) {
      this._bl = lv;
      b.visible = lv > 0;
      if (lv) { b.geometry = _badgeGeo[lv - 1]; b.material.color.setHex(BADGE_COL[lv - 1]); }
    }
    if (!lv) return;
    this._bt += dt;
    b.rotation.y += dt * (0.8 + 0.3 * lv);   // (spins in its own plane: the ring geometry is already laid flat)
    b.scale.setScalar(this.r * this.visK * (1 + 0.04 * Math.sin(this._bt * 4)));
    b.position.y = -this.r * this.visK * 0.35;
    b.material.opacity = 0.55 + 0.05 * lv;
  }

  tickRiders(dt) {
    this.rt += dt;
    const rr = this.r * this.visK, sc = Math.max(0.3, Math.min(2.4, 0.3 * this.r + 0.15));
    for (let i = 0; i < this.riders.length; i++) {
      const m = this.riders[i], u = m.userData, tgt = RIDER_SLOT[i];
      u.pop = Math.min(1, u.pop + dt * 5);
      u.ox = tgt[0];
      const bob = Math.abs(Math.sin(this.rt * 6 + i * 2.1)) * 0.22 * sc;
      m.position.set(tgt[0] * rr, tgt[1] * rr * 0.97 + bob + (1 - u.pop) * sc, tgt[2] * rr);
      u.sc = sc * (0.6 + 0.4 * u.pop);
      m.scale.set(u.sc * (1 + 0.06 * Math.sin(this.rt * 12 + i)), u.sc * (1 - 0.06 * Math.sin(this.rt * 12 + i)), u.sc);
      m.rotation.y = Math.sin(this.rt * 3 + i) * 0.35;
    }
    for (let i = this.flee.length - 1; i >= 0; i--) {
      const f = this.flee[i], h = Math.min(dt, 0.033);
      f.t += h;
      f.vy -= 24 * h;
      f.m.position.x += f.vx * h; f.m.position.y += f.vy * h; f.m.position.z += f.vz * h;
      if (f.m.position.y < f.gy) { f.m.position.y = f.gy; f.vy = f.t < 1.2 ? 3.5 : 0; }
      f.m.scale.setScalar(f.s0 * Math.max(0, 1 - Math.max(0, f.t - 1.4) / 0.8));
      f.m.rotation.y += h * 9;
      if (f.t > 2.2) { f.m.parent && f.m.parent.remove(f.m); this.flee.splice(i, 1); }
    }
  }

  setRadius(r) {
    this.r = r;
    this.applyScale();
    this.bury();
  }

  // Roll the visual sphere by the distance travelled this frame.
  roll(dx, dd) {
    const dist = Math.hypot(dx, dd);
    if (dist < 1e-5) return;
    // velocity in world: (dx, 0, -dd); axis = up × v
    _axis.set(-dd, 0, -dx).normalize();
    _q.setFromAxisAngle(_axis, dist / (this.r * this.visK));
    this.spin.quaternion.premultiply(_q);
  }

  // Roll about an arbitrary world axis (endless runner: the track curves, so "forward" isn't -Z).
  rollAxis(axis, angle) {
    if (Math.abs(angle) < 1e-6) return;
    _q.setFromAxisAngle(axis, angle);
    this.spin.quaternion.premultiply(_q);
  }

  sync() {
    const sy = 1 - this.sq, sx = 1 + this.sq * 0.55;
    const rr = this.r * this.visK;
    this.group.position.set(this.x, this.y + this.hopY - rr * (1 - sy), -this.d);
    if (sy !== 1 || this.group.scale.y !== 1) this.group.scale.set(sx, sy, sx);
  }

  // Glue a swallowed prop onto the surface, standing outward like a tiny planet. `shrink` scales it down a little so
  // a swallowed house does not turn the ball into a skyscraper.
  stick(def, worldPos, scale, shrink = 0.6) {
    let slot = this.stuck[def.name];
    if (!slot) {
      if (Object.keys(this.stuck).length >= STUCK_TYPES) {
        let oldest = null;
        for (const k in this.stuck) if (!oldest || this.stuck[k].t < this.stuck[oldest].t) oldest = k;
        if (oldest) this.dropSlot(oldest);
      }
      const mesh = new THREE.InstancedMesh(def.geometry, this.material, STUCK_CAP);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.spin.add(mesh);
      slot = this.stuck[def.name] = { mesh, items: [], t: 0 };
    }
    slot.t = ++this.stuckT;
    // Direction from ball centre to the prop, in the ball's rotating frame.
    _v.copy(worldPos).sub(this.group.position);
    if (_v.lengthSq() < 1e-6) _v.set(Math.random() - 0.5, 1, Math.random() - 0.5);
    _v.normalize();
    // Bias toward the top-back so new loot is visible from the chase camera.
    _v.y = Math.abs(_v.y) * 0.6 + 0.35;
    _v.z = Math.abs(_v.z) * 0.5 + 0.3; // back-top (toward the chase camera) so every pickup is seen right away
    _v.x += (Math.random() - 0.5) * 0.6;
    _v.normalize();
    _q2.copy(this.spin.quaternion).invert();
    _v.applyQuaternion(_q2);

    const sc = scale * shrink;
    const embed = this.r * 0.78;
    const item = {
      px: _v.x * embed, py: _v.y * embed, pz: _v.z * embed,
      q: new THREE.Quaternion().setFromUnitVectors(_up, _v),
      s: sc,
      top: embed + def.height * sc * 0.8,
    };
    // Random twist + lean so the pile looks chaotic, not stamped.
    _q.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
    item.q.multiply(_q);
    _axis.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    _q.setFromAxisAngle(_axis, (Math.random() - 0.5) * 0.9);
    item.q.multiply(_q);

    if (slot.items.length >= STUCK_CAP) slot.items.shift();
    slot.items.push(item);
    this.writeSlot(slot);
  }

  dropSlot(k) {
    const slot = this.stuck[k];
    if (!slot) return;
    this.spin.remove(slot.mesh);
    slot.mesh.dispose();
    delete this.stuck[k];
  }

  // Items get swallowed by the snow as the ball grows past them.
  bury() {
    const limit = this.r * 1.02;
    for (const k in this.stuck) {
      const slot = this.stuck[k];
      const items = slot.items;
      let w = 0;
      for (let i = 0; i < items.length; i++) if (items[i].top > limit) items[w++] = items[i];
      if (w !== items.length) {
        items.length = w;
        this.writeSlot(slot);
      }
    }
  }

  writeSlot(slot) {
    const { mesh, items } = slot;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      _v.set(it.px, it.py, it.pz);
      _s.setScalar(it.s);
      _m.compose(_v, it.q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  stuckCount() {
    let n = 0;
    for (const k in this.stuck) n += this.stuck[k].items.length;
    return n;
  }
}

const RIDER_SLOT = [[0, 1, 0.05], [-0.52, 0.85, 0.1], [0.52, 0.85, 0.1]];
let _rg = null;
function makeRider() {
  if (!_rg) {
    _rg = {
      sph: new THREE.SphereGeometry(1, 10, 8), cone: new THREE.ConeGeometry(0.12, 0.5, 6), hat: new THREE.CylinderGeometry(0.38, 0.38, 0.5, 8),
      white: new THREE.MeshLambertMaterial({ color: 0xffffff }), orange: new THREE.MeshLambertMaterial({ color: 0xff8a1f }),
      dark: new THREE.MeshLambertMaterial({ color: 0x2b3a67 }),
    };
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(_rg.sph, _rg.white); body.scale.setScalar(0.5); body.position.y = 0.5;
  const head = new THREE.Mesh(_rg.sph, _rg.white); head.scale.setScalar(0.36); head.position.y = 1.2;
  const nose = new THREE.Mesh(_rg.cone, _rg.orange); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.2, 0.4); nose.scale.setScalar(0.8);
  const hat = new THREE.Mesh(_rg.hat, _rg.dark); hat.position.y = 1.62; hat.scale.set(0.8, 0.6, 0.8);
  g.add(body, head, nose, hat);
  g.userData = { ox: 0, sc: 1, pop: 0 };
  return g;
}

function makeSnowGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(0xffffff), shade = new THREE.Color(0xcfe2f7), c = new THREE.Color();
  const v = new THREE.Vector3();
  // Lumpy surface; displacement keyed by direction so shared vertices stay welded.
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = Math.sin(v.x * 5.1 + v.y * 2.3) * Math.sin(v.z * 4.3 - v.x * 1.7) + Math.sin(v.y * 7.7 + v.z * 3.1) * 0.5;
    v.multiplyScalar(1 + n * 0.045);
    pos.setXYZ(i, v.x, v.y, v.z);
    c.copy(base).lerp(shade, Math.max(0, n) * 0.6);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
