// Wardrobe 3D preview: one small transparent WebGL canvas (own renderer, made when the shop opens, freed when it closes) that shows the
// selected item for real: the ball skin turning, a trail ribbon + its particles, a hop ring under a bouncing ball, a stomp burst,
// the BLAST halo, a tinted Yeti, a death effect. `dene(true)` is the 5 s try-before-buy roll (faster, effects fire more often).
import * as THREE from 'three';
import { makeSkin, disposeSkin, trailStyle } from './skins.js';
import { hopGeometry, Glyphs } from './cosmetics.js';
import { cloneYeti } from './glb.js';

const N = 30; // ribbon points
const _c = new THREE.Color(), _c2 = new THREE.Color();

export function createView(host, skinId) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }); } catch { return null; }
  const W = host.clientWidth || 340, H = host.clientHeight || 190;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'cs-cv';
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(36, W / H, 0.1, 60);
  cam.position.set(0, 3.4, 7.0); cam.lookAt(0, -0.2, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa8c0e8, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 5, 4); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshLambertMaterial({ color: 0xdbe9fb }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1; scene.add(floor);
  const glyphs = new Glyphs(scene, 48);
  const group = new THREE.Group(); scene.add(group);

  let kind = '', it = null, skin = null, ball = null, ringM = null, halo = null, yeti = null, mixer = null, ribbon = null;
  let t = 0, deneT = 0, raf = 0, last = 0, dead = false, popT = 0, evT = 0, fxOn = false;
  const hist = new Float32Array(N * 3);
  let hasHist = false;

  const clear = () => {
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse((m) => { if (m.geometry && !m.geometry.userData.keep) m.geometry.dispose(); if (m.material && m.material.dispose) { if (m.material.map && m.material.userData.ownMap) m.material.map.dispose(); m.material.dispose(); } });
    }
    if (skin) { disposeSkin(skin); skin = null; }
    ball = ringM = halo = yeti = ribbon = null; mixer = null; hasHist = false; glyphs.setEmit(null);
  };

  function makeBall(id) {
    skin = makeSkin(id || 'classic');
    ball = new THREE.Mesh(skin.geometry, skin.material);
    ball.scale.setScalar(kind === 'skin' ? 1.1 : 0.85);
    if (skin.id === 'classic' && skin.material.emissive) skin.material.emissive.setHex(0x4a5666);      // (the game's sparkly snow shader is not patched in here)
    group.add(ball);
  }
  function makeRibbon(style) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 8), 4));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    ribbon = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.NormalBlending }));      // (normal blending: a glowing ribbon would wash out on the pale floor)
    ribbon.frustumCulled = false; ribbon.userData.style = style; ribbon.userData.jag = style.jag || 0;
    const col = g.attributes.color.array;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);   // 0 = ball end, 1 = tail
      if (style.rainbow && style.palette) _c.setHex(style.palette[Math.floor(i / 5) % style.palette.length]);
      else if (style.rainbow) _c.setHSL((k * 2) % 1, 0.85, 0.6);
      else { _c.setHex(style.color); if (style.color2 !== undefined) _c.lerp(_c2.setHex(style.color2), k); }
      for (const s of [0, 4]) { col[i * 8 + s] = _c.r; col[i * 8 + s + 1] = _c.g; col[i * 8 + s + 2] = _c.b; col[i * 8 + s + 3] = (1 - k) * 0.95; }
    }
    group.add(ribbon);
  }
  function makeHalo() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 }));
    halo.material.userData.ownMap = true; halo.scale.setScalar(5);
    group.add(halo);
  }

  function show(k, item) {
    clear();
    kind = k; it = item; t = 0; evT = 0; popT = 0; fxOn = false;
    if (k === 'none') return;
    const fx = (item && item.fx) || {};
    if (k === 'yeti') {
      const gl = cloneYeti();
      const mat = new THREE.MeshLambertMaterial({ vertexColors: !!gl, color: new THREE.Color(fx.tint[0], fx.tint[1], fx.tint[2]), emissive: fx.em || 0x0a1630, flatShading: true });
      if (gl) {
        gl.model.traverse((o) => { if (o.isMesh) { o.material = mat; o.frustumCulled = false; } });
        mixer = new THREE.AnimationMixer(gl.model);
        mixer.clipAction(THREE.AnimationClip.findByName(gl.clips, 'run') || gl.clips[0]).play();
        yeti = gl.model; yeti.scale.setScalar(2.3 / 3.34);
      } else { yeti = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 1.6, 4, 8), mat); }
      yeti.position.y = -1; yeti.userData.pulse = fx.pulse || 0; yeti.userData.mat = mat;
      group.add(yeti);
      return;
    }
    makeBall(k === 'skin' ? (item && item.id) : skinId);
    if (k === 'skin') return;
    if (k === 'trail') { const st = trailStyle(item.id); makeRibbon(st); glyphs.setEmit(st.emit); }
    else if (k === 'blast') { makeRibbon({ color: fx.col, color2: fx.col, glow: true, rainbow: !!fx.hue }); makeHalo(); }
    else if (k === 'hop') {
      ringM = new THREE.Mesh(hopGeometry(fx.shape), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      ringM.geometry.userData.keep = true; ringM.rotation.x = -Math.PI / 2; ringM.position.y = -0.97; group.add(ringM);
    }
  }

  const sp = () => (deneT > 0 ? 1.9 : 1);
  function tick(dt) {
    t += dt * sp();
    if (deneT > 0) { deneT -= dt; if (deneT <= 0) { deneT = 0; if (host.__onDeneEnd) host.__onDeneEnd(); } }
    if (mixer) mixer.update(dt);
    if (yeti) {
      yeti.rotation.y = Math.PI + Math.sin(t * 0.7) * 0.6;
      if (yeti.userData.pulse) yeti.userData.mat.emissiveIntensity = 1 + yeti.userData.pulse * Math.sin(t * 3.5);
    }
    if (!ball) { glyphs.tick(dt, 0, 0, 0, 1, false); return; }
    if (skin && skin.update) skin.update(dt, t, ball);
    const fx = (it && it.fx) || {};
    let bx = 0, by = 0, bz = 0;
    if (kind === 'skin' || kind === 'emote') { ball.rotation.y += dt * 0.9 * sp(); by = kind === 'emote' ? Math.abs(Math.sin(t * 3)) * 0.35 : 0.04 * Math.sin(t * 2); ball.position.set(0, by, 0); }
    else if (kind === 'trail' || kind === 'blast') {
      const a = t * 1.15;
      bx = Math.sin(a) * 2.2; bz = Math.cos(a * 2) * 0.55 - 0.3; by = -0.15 + 0.12 * Math.abs(Math.sin(t * 5));
      ball.position.set(bx, by, bz); ball.rotation.z -= dt * 5 * sp() * (Math.cos(a) > 0 ? 1 : -1);
      pushHist(bx, -0.95, bz);
      if (ribbon) fillRibbon();
      const st = ribbon.userData.style;
      if (kind === 'trail' && st.emit) glyphs.tick(dt, hist[6] - 0.2 * Math.sign(Math.cos(a)), -0.5, hist[8], 0.85, true);
      else glyphs.tick(dt, 0, 0, 0, 1, false);
      if (kind === 'blast') {
        if (fx.hue) halo.material.color.setHSL((t * 1.1) % 1, 0.9, 0.62); else halo.material.color.setHex(fx.col);
        halo.position.set(bx, by, bz + 0.2); halo.scale.setScalar(4.6 * (fx.big || 1) * (1 + 0.08 * Math.sin(t * 18)));
        if (fx.spark && Math.random() < dt * 26) glyphs.spawn({ s: 'glint', cols: [fx.spark], size: 0.3, up: 0.8, sp: 3, life: 0.6, add: 1 }, bx, by - 0.4, bz, 0.8);
        else if (!fx.spark && Math.random() < dt * 14) glyphs.spawn({ s: 'spark', cols: [fx.col], size: 0.25, up: 0.6, sp: 3, life: 0.5, add: 1 }, bx, by - 0.4, bz, 0.8);
      }
    } else if (kind === 'hop' || kind === 'stomp') {
      const per = kind === 'hop' ? 1.5 : 1.25, ph = (t % per) / per, h = Math.sin(ph * Math.PI) * 1.9;      // a bounce: hang high, fall, land
      ball.position.set(0, -0.15 + h, 0); ball.rotation.y += dt * 2;
      const sq = ph > 0.93 || ph < 0.05 ? 0.72 : 1; ball.scale.set(0.85 / Math.sqrt(sq), 0.85 * sq, 0.85 / Math.sqrt(sq));
      if (kind === 'hop') {
        const near = Math.max(0, 1 - h / 1.9), hot = near > 0.7;
        ringM.material.color.setHex(hot ? fx.hot : fx.cool); ringM.material.opacity = 0.35 + 0.6 * near;
        ringM.scale.setScalar(1.1 + 2.1 * (1 - near) * (ph > 0.5 ? 1 : 0.2) + 0.5); ringM.rotation.z = fx.spin ? t * fx.spin : 0;
      } else if (ph < dt / per * 1.2 + 0.0001 && t > 0.2) stompBurst(fx);
    } else if (kind === 'death') {
      evT += dt * sp();
      if (evT > 2.6) { evT = 0; popT = 0; deathBurst(fx); }
      if (popT === 0 && fx.hide && evT < 0.9) ball.visible = false; else ball.visible = true;
      if (fx.t === 'stars' && evT < 1) for (let i = 0; i < 3; i++) { const a = evT * 7 + i * 2.094; glyphs.spawn({ s: 'glint', cols: fx.cols, size: 0.3, up: 0, sp: 0, life: 0.25, add: 1 }, Math.cos(a) * 1.1, 1.1, Math.sin(a) * 1.1, 0.1); }
      ball.rotation.y += dt;
      ball.position.set(0, 0, 0);
      ball.scale.setScalar(0.85 * (ball.visible && evT < 1.15 && evT > 0.9 ? 0.4 + (evT - 0.9) * 2.4 : 1));
    }
    if (kind !== 'trail' && kind !== 'blast') glyphs.tick(dt, 0, 0, 0, 1, false);
  }
  function stompBurst(fx) {
    for (let i = 0; i < 12; i++) glyphs.spawn({ s: 'pixel', cols: fx.cols, size: 0.3, up: 3 + (fx.up || 0), sp: (fx.sp || 3) * 1.8, life: 0.8 }, 0, -0.9, 0, 0.8);
    if (fx.mist) for (let i = 0; i < 4; i++) glyphs.spawn({ s: 'smoke', cols: [fx.mcol || fx.cols[0]], size: 1, up: 0.6, sp: 3, life: 0.7, grow: 1 }, 0, -0.9, 0, 0.8);
    if (fx.ring) for (let i = 0; i < fx.ring; i++) glyphs.spawn({ s: 'glint', cols: fx.cols, size: 0.4, up: 1.2, sp: 4, life: 0.7, add: 1 }, 0, -0.8, 0, 1);
  }
  function deathBurst(fx) {
    if (fx.t === 'pop') for (let i = 0; i < 20; i++) glyphs.spawn({ s: i % 2 ? 'pixel' : 'heart', cols: fx.cols, size: 0.35, up: 3.5, sp: 6, life: 0.9 }, 0, 0, 0, 0.8);
    else if (fx.t === 'smoke') for (let i = 0; i < 12; i++) glyphs.spawn({ s: 'smoke', cols: fx.cols, size: 1.2, up: 1, sp: 3, life: 1, grow: 1 }, 0, 0, 0, 0.8);
  }
  function pushHist(x, y, z) {
    if (!hasHist) { for (let i = 0; i < N; i++) { hist[i * 3] = x; hist[i * 3 + 1] = y; hist[i * 3 + 2] = z; } hasHist = true; }
    // shift every frame by sampling: cheap enough for 30 points
    hist.copyWithin(3, 0, (N - 1) * 3); hist[0] = x; hist[1] = y; hist[2] = z;
  }
  function fillRibbon() {
    const a = ribbon.geometry.attributes.position.array, jag = ribbon.userData.jag;
    for (let i = 0; i < N; i++) {
      const w = 0.55 * (1 - i / (N * 1.1)) + 0.03, j = jag ? Math.sin(i * 2.4 + t * 25) * jag * 0.5 : 0;
      a[i * 6] = hist[i * 3]; a[i * 6 + 1] = hist[i * 3 + 1] + 0.02; a[i * 6 + 2] = hist[i * 3 + 2] + j - w;
      a[i * 6 + 3] = hist[i * 3]; a[i * 6 + 4] = hist[i * 3 + 1] + 0.02; a[i * 6 + 5] = hist[i * 3 + 2] + j + w;
    }
    ribbon.geometry.attributes.position.needsUpdate = true;
  }

  function frame(now) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    tick(dt);
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(frame);

  return {
    show,
    /** start (true) the 5 s try roll; onEnd fires when it is over */
    dene(on, onEnd) { deneT = on ? 5 : 0; host.__onDeneEnd = onEnd || null; if (on) { evT = 2.5; } },
    get denning() { return deneT; },
    resize() { const w = host.clientWidth, h = host.clientHeight; if (w && h) { renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); } },
    dispose() {
      dead = true; cancelAnimationFrame(raf); clear(); glyphs.dispose();
      floor.geometry.dispose(); floor.material.dispose();
      renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ignore */ }
      renderer.domElement.remove();
    },
  };
}
