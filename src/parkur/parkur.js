// PARKUR - third-person snow-yeti parkour on endless, seeded, procedurally generated courses.
//   SONSUZ        : go as far as you can; a draining clock is refilled by checkpoints.
//   GÜNÜN PARKURU : one fixed course per day (same for everybody), stopwatch time trial + leaderboard.
// Owns its own scene + camera (main.js renders this.scene / this.camera, like KARTOPU ARENA).
// Course data comes from gen.js (fair by construction), the board from lb.js (local + P2P gossip).
import * as THREE from 'three';
import { dailySeed, dailyNumber } from '../rng.js';
import { PH, Course } from './gen.js';
import { Board, myName, setMyName, lowerIsBetter } from './lb.js';

const RIGHT = -1;                 // the camera looks along +z, so screen-right is world -x
const STEP = 1 / 120;             // physics substep
const DAILY_SEGS = 30, CP_EVERY = 3;
const ENDLESS_T0 = 25;            // s on the clock at the start of SONSUZ
const DIE_PEN_DAILY = 2, DIE_PEN_ENDLESS = 3;

export const UNLOCKS = [
  { id: 'dj', ico: '⏫', name: 'ÇİFT ZIPLAMA', desc: 'Havadayken bir kez daha zıpla', need: (p) => p.cps >= 10 || p.fin >= 3, req: (p) => `${Math.min(p.cps, 10)}/10 🚩 ya da ${Math.min(p.fin, 3)}/3 günlük` },
  { id: 'dash', ico: '⚡', name: 'ATILMA', desc: 'İleri hızla atıl (Shift / yana kaydır)', need: (p) => p.cps >= 25, req: (p) => `${Math.min(p.cps, 25)}/25 🚩` },
  { id: 'wrLong', ico: '🧗', name: 'DUVAR USTASI', desc: 'Duvar koşusu %50 daha uzun', need: (p) => p.cps >= 45, req: (p) => `${Math.min(p.cps, 45)}/45 🚩` },
];

const CSS = `
.pk-root{position:absolute;inset:0;z-index:50;pointer-events:none;color:#fff;font-family:inherit;user-select:none;-webkit-user-select:none;text-shadow:0 2px 0 rgba(10,30,60,.55),0 0 6px rgba(10,30,60,.35)}
.pk-root button{pointer-events:auto;font-family:inherit;cursor:pointer;touch-action:manipulation}
.pk-top{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);left:0;right:0;text-align:center}
.pk-time{font-size:40px;font-weight:900;letter-spacing:.02em;font-variant-numeric:tabular-nums;line-height:1}
.pk-time.low{color:#ff6b6b;animation:pkPulse .5s ease-in-out infinite alternate}
@keyframes pkPulse{to{transform:scale(1.08)}}
.pk-tbar{width:150px;height:6px;margin:6px auto 0;border-radius:3px;background:rgba(255,255,255,.25);overflow:hidden}
.pk-tbar i{display:block;height:100%;background:linear-gradient(90deg,#5ee1ff,#b7ff7a);transition:width .2s}
.pk-stats{position:absolute;top:calc(env(safe-area-inset-top,0px) + 70px);left:12px;right:12px;display:flex;justify-content:space-between;font-weight:800;font-size:17px}
.pk-abil{position:absolute;top:calc(env(safe-area-inset-top,0px) + 96px);right:12px;font-size:20px;letter-spacing:4px}
.pk-abil .off{opacity:.25;filter:grayscale(1)}
.pk-x{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);left:10px;width:42px;height:42px;border-radius:50%;border:2px solid rgba(255,255,255,.7);background:rgba(20,40,80,.35);color:#fff;font-size:18px;font-weight:900}
.pk-msg{position:absolute;left:0;right:0;top:34%;text-align:center;font-size:64px;font-weight:900;opacity:0;transition:opacity .15s}
.pk-msg.on{opacity:1}
.pk-msg small{display:block;font-size:20px;font-weight:800}
.pk-pop{position:absolute;left:0;right:0;top:22%;text-align:center;font-size:26px;font-weight:900;opacity:0;transform:translateY(10px);transition:opacity .2s,transform .2s}
.pk-pop.on{opacity:1;transform:none}
.pk-flash{position:absolute;inset:0;background:#fff;opacity:0;transition:opacity .35s}
.pk-hint{position:absolute;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);display:flex;justify-content:space-between;font-size:13px;font-weight:800;opacity:.85;transition:opacity .6s}
.pk-hint div{background:rgba(20,40,80,.35);border-radius:12px;padding:6px 10px;max-width:46%}
.pk-stick{position:absolute;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;border:2px solid rgba(255,255,255,.45);display:none}
.pk-stick i{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.55)}
.pk-scr{position:absolute;inset:0;z-index:55;pointer-events:auto;display:flex;flex-direction:column;align-items:center;overflow-y:auto;padding:calc(env(safe-area-inset-top,0px) + 18px) 16px calc(env(safe-area-inset-bottom,0px) + 18px);box-sizing:border-box;background:linear-gradient(180deg,rgba(14,40,86,.72),rgba(14,40,86,.86));color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35)}
.pk-scr h1{margin:4px 0 2px;font-size:42px;font-weight:900;letter-spacing:.08em}
.pk-scr h2{margin:14px 0 6px;font-size:15px;font-weight:900;letter-spacing:.12em;opacity:.85}
.pk-scr .sub{font-size:13px;opacity:.85;margin-bottom:8px;text-align:center}
.pk-scr button.pk-b{width:min(100%,330px);margin:5px 0;padding:12px 14px;border:0;border-radius:16px;font-size:19px;font-weight:900;color:#fff;letter-spacing:.04em;background:linear-gradient(180deg,#ffb347,#ff7a18);box-shadow:0 5px 0 #b44d00;text-align:left;display:flex;align-items:center;gap:10px;font-family:inherit;cursor:pointer;text-shadow:0 2px 0 rgba(0,0,0,.25)}
.pk-scr button.pk-b.blue{background:linear-gradient(180deg,#7dc4ff,#2f7dff);box-shadow:0 5px 0 #1b4fae}
.pk-scr button.pk-b.ghost{background:transparent;border:2px solid rgba(255,255,255,.6);box-shadow:none;justify-content:center;font-size:16px}
.pk-scr button.pk-b:active{transform:translateY(3px);box-shadow:0 2px 0 rgba(0,0,0,.3)}
.pk-scr button.pk-b small{display:block;font-size:12px;font-weight:700;opacity:.9}
.pk-scr .ab{width:min(100%,330px);display:flex;flex-direction:column;gap:5px}
.pk-scr .ab div{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.1);border-radius:12px;padding:6px 10px;font-size:13px;font-weight:700}
.pk-scr .ab div b{font-size:14px}
.pk-scr .ab div.lock{opacity:.6}
.pk-scr .ab span.i{font-size:20px}
.pk-tabs{display:flex;gap:6px;width:min(100%,330px)}
.pk-tabs button{flex:1;padding:7px;border-radius:10px;border:2px solid rgba(255,255,255,.5);background:transparent;color:#fff;font-weight:900;font-family:inherit;cursor:pointer}
.pk-tabs button.on{background:rgba(255,255,255,.9);color:#1b4fae;text-shadow:none}
.pk-lb{width:min(100%,330px);margin-top:6px;border-radius:12px;background:rgba(0,0,0,.18);padding:4px 0;font-size:14px;font-weight:800}
.pk-lb div{display:flex;padding:4px 12px;gap:8px}
.pk-lb div span:first-child{width:28px;opacity:.8}
.pk-lb div span:nth-child(2){flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-lb div.me{background:linear-gradient(90deg,#ffd34d,#ffb020);color:#4a2a00;text-shadow:none;border-radius:8px}
.pk-lb .empty{justify-content:center;opacity:.7;font-weight:700;font-size:13px}
.pk-net{font-size:12px;opacity:.8;margin-top:4px}
.pk-name{display:flex;gap:6px;align-items:center;margin-top:10px;font-size:13px;font-weight:800}
.pk-name input{width:130px;padding:6px 8px;border-radius:8px;border:0;font:inherit;font-weight:800}
.pk-big{font-size:46px;font-weight:900;margin:6px 0 0;font-variant-numeric:tabular-nums}
.pk-badge{display:inline-block;margin-top:6px;padding:4px 12px;border-radius:999px;background:#ffd34d;color:#4a2a00;font-weight:900;font-size:14px;text-shadow:none}
.pk-unl{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%) scale(.6);opacity:0;z-index:56;text-align:center;padding:16px 22px;border-radius:20px;background:linear-gradient(180deg,#ffd34d,#ff9a1f);color:#4a2a00;text-shadow:none;box-shadow:0 8px 0 #b45d00,0 12px 30px rgba(0,0,0,.35);transition:opacity .25s,transform .35s cubic-bezier(.2,1.6,.4,1);pointer-events:none;width:min(80vw,300px)}
.pk-unl.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
.pk-unl .i{font-size:48px}.pk-unl b{display:block;font-size:22px;font-weight:900}.pk-unl small{display:block;font-size:13px;font-weight:800;margin-top:4px}
/* home menu entry (menus.js creates button.fm-parkur next to KARTOPU ARENA) */
`;

const fmtT = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return String(m).padStart(2, '0') + ':' + r.toFixed(2).padStart(5, '0'); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

export class ParkurMode {
  constructor({ renderer, post, ui, audio, save, platform, onExit, track } = {}) {
    this.renderer = renderer; this.post = post; this.audio = audio; this.save = save; this.platform = platform; this.onExit = onExit;
    this._track = typeof track === 'function' ? track : null;
    this.prog = save && save.parkur ? save.parkur() : { cps: 0, fin: 0, runs: 0, bestDist: 0, daily: {}, unl: {}, tut: 0 };
    this.board = new Board();
    this.board.onChange = () => { if (this.state === 'menu') this.refreshBoard(); if (this.state === 'result' && this._resBoard) this._resBoard(); };
    this.state = 'menu';
    this.kind = 'endless';
    this.auto = false;
    this.time = 0;
    this.sz = new THREE.Vector2();
    this.tab = 'daily';
    this._build3d();
    this._buildHud();
    this._bindInput();
  }

  get scene() { return this._scene; }
  get camera() { return this._camera; }
  get abil() { const u = this.prog.unl || {}; return { dj: !!u.dj, dash: !!u.dash, wrLong: !!u.wrLong }; }
  sfx(k, ...a) { try { const f = this.audio && this.audio[k]; if (typeof f === 'function') f.apply(this.audio, a); } catch { /* audio optional */ } }
  haptic(k) { try { this.platform && this.platform.haptic && this.platform.haptic(k); } catch { /* ignore */ } }
  track(ev, d) { try { this._track && this._track(ev, d); } catch { /* ignore */ } }

  // ------------------------------------------------------------------ 3D setup
  _build3d() {
    const S = this._scene = new THREE.Scene();
    const sky = 0xbfe2ff;
    S.background = new THREE.Color(sky);
    S.fog = new THREE.Fog(sky, 45, 150);
    this._camera = new THREE.PerspectiveCamera(70, 0.5, 0.1, 400);
    S.add(new THREE.HemisphereLight(0xeaf5ff, 0x7e95b8, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(-4, 9, -3);
    S.add(sun);
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    const L = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0 });
    const six = (side, top) => [side, side, top, side, side, side];
    const floorSides = [L(0x9cc3ea), L(0x8fb7e6), L(0xa9c9ec)];
    const top = L(0xf6faff);
    this.mats = {
      floor: floorSides.map((s) => six(s, top)),
      wall: six(L(0x3f9bff, 0x0a2a55), L(0xdff1ff)),
      pad: six(L(0xd02f7a), L(0xff4fa0, 0x5a1030)),
      bar: six(L(0xe08a00), L(0xffb52e, 0x402000)),
      post: L(0x7a8494),
      mover: six(L(0xd9b04a), L(0xfff1a8)),
      ice: six(L(0x6fcbee), L(0xc8f3ff, 0x103040)),
      pillar: L(0x5d6675),
      beam: six(L(0x8a6a4a), L(0xf6faff)),
      sweep: L(0xff4a4a, 0x401010),
      gate: L(0x8ab0d8), gateOn: L(0x2ecc71, 0x0a3a1a), banner: L(0x5d7fa8), bannerOn: L(0x2ecc71, 0x124a22), finish: L(0xffc21a, 0x4a3000),
      ring: L(0xffe14a, 0x6a5000),
    };
    this.ringGeo = new THREE.TorusGeometry(1.05, 0.13, 6, 18);
    this.world = new THREE.Group(); S.add(this.world);
    // far mountains: one group that follows the camera (cheap parallax backdrop)
    this.backdrop = new THREE.Group();
    const mm = new THREE.MeshLambertMaterial({ color: 0xdbeafa, fog: false }), md = new THREE.MeshLambertMaterial({ color: 0xa6c3e3, fog: false });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI - Math.PI / 2 + 0.15 * Math.sin(i * 7), r = 230 + 25 * Math.sin(i * 3.1);
      const h = 50 + 30 * Math.abs(Math.sin(i * 1.7));
      const m = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 5), i % 2 ? mm : md);
      m.position.set(Math.sin(a) * r, h / 2 - 30, Math.cos(a) * r);
      this.backdrop.add(m);
    }
    S.add(this.backdrop);
    // the yeti
    const Y = this.yeti = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff }), black = new THREE.MeshBasicMaterial({ color: 0x1a2030 });
    const blue = new THREE.MeshLambertMaterial({ color: 0x8fd0ff }), red = new THREE.MeshLambertMaterial({ color: 0xff4a5a });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 10), white);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 9), white); head.position.set(0, 0.62, 0.05);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), blue); face.position.set(0, 0.6, 0.22); face.scale.set(1, 0.85, 0.55);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), black); eye.position.set(0.09 * s, 0.66, 0.33); Y.add(eye);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), blue); horn.position.set(0.22 * s, 0.9, 0); horn.rotation.z = -0.5 * s; Y.add(horn);
      const arm = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), white); arm.position.set(0.46 * s, 0.05, 0.05); arm.name = 'arm' + s; Y.add(arm);
    }
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.07, 6, 14), red); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.36;
    Y.add(this.body, head, face, scarf);
    this.yetiIn = new THREE.Group(); this.yetiIn.add(Y); S.add(this.yetiIn);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: 0x0a1a33, transparent: true, opacity: 0.28, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; S.add(this.shadow);
    // particles: one Points object, fixed pool
    const N = this.pN = 90;
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    // soft round dots (one tiny canvas texture) instead of square points
    let dot = null;
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 32;
      const cx = cv.getContext('2d'), gr = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 32, 32);
      dot = this.dotTex = new THREE.CanvasTexture(cv);
    } catch { /* plain squares */ }
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.24, map: dot, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.points.frustumCulled = false; S.add(this.points);
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -9999;
    this.pI = 0;
  }

  burst(x, y, z, n, color = 0xffffff, spd = 4, up = 2) {
    const c = new THREE.Color(color === 'confetti' ? 0xffffff : color);
    for (let k = 0; k < n; k++) {
      const i = this.pI = (this.pI + 1) % this.pN;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      const a = Math.random() * 6.283, s = spd * (0.4 + Math.random() * 0.6);
      this.pVel[i * 3] = Math.cos(a) * s; this.pVel[i * 3 + 1] = up + Math.random() * up; this.pVel[i * 3 + 2] = Math.sin(a) * s;
      if (color === 'confetti') c.setHSL(Math.random(), 0.9, 0.6);
      this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
      this.pLife[i] = 0.5 + Math.random() * 0.5;
    }
  }

  // ------------------------------------------------------------------ HUD / screens
  _buildHud() {
    if (!document.getElementById('pk-style')) { const st = el('style'); st.id = 'pk-style'; st.textContent = CSS; document.head.appendChild(st); }
    const app = document.getElementById('app') || document.body;
    const h = this.hud = {};
    h.root = el('div', 'pk-root'); h.root.id = 'pk-root';
    h.top = el('div', 'pk-top'); h.time = el('div', 'pk-time', '00:00.00'); h.tbar = el('div', 'pk-tbar'); h.tfill = el('i'); h.tbar.appendChild(h.tfill);
    h.top.append(h.time, h.tbar);
    h.stats = el('div', 'pk-stats'); h.dist = el('span', '', '0 m'); h.cp = el('span', '', '🚩 0'); h.stats.append(h.dist, h.cp);
    h.abil = el('div', 'pk-abil');
    h.x = el('button', 'pk-x', '✕'); h.x.setAttribute('aria-label', 'Parkur menüsü');
    h.x.addEventListener('click', () => { this.sfx('ui', 'back'); this.toMenu(); });
    h.msg = el('div', 'pk-msg'); h.pop = el('div', 'pk-pop'); h.flash = el('div', 'pk-flash');
    h.hint = el('div', 'pk-hint');
    h.stick = el('div', 'pk-stick'); h.stick.appendChild(el('i'));
    h.unl = el('div', 'pk-unl');
    h.root.append(h.flash, h.top, h.stats, h.abil, h.x, h.msg, h.pop, h.hint, h.stick, h.unl);
    app.appendChild(h.root);
    this.scr = el('div', 'pk-scr'); this.scr.style.display = 'none';
    app.appendChild(this.scr);
    this.setHudVisible(false);
  }

  setHudVisible(on) { for (const k of ['top', 'stats', 'abil', 'x', 'hint']) this.hud[k].style.display = on ? '' : 'none'; }

  pop(txt, color = '#fff', ms = 1100) {
    const p = this.hud.pop; p.textContent = txt; p.style.color = color; p.classList.add('on');
    clearTimeout(this._popT); this._popT = setTimeout(() => p.classList.remove('on'), ms);
  }
  flash(c = '#fff', a = 0.55) { const f = this.hud.flash; f.style.transition = 'none'; f.style.background = c; f.style.opacity = a; void f.offsetWidth; f.style.transition = ''; f.style.opacity = 0; }

  dailyKey() { return 'd' + dailySeed(); }

  showMenu() {
    this.state = 'menu';
    this.setHudVisible(false);
    this.hud.msg.classList.remove('on');
    const s = this.scr; s.innerHTML = ''; s.style.display = '';
    const p = this.prog, dk = this.dailyKey();
    s.append(el('h1', '', 'PARKUR'), el('div', 'sub', 'Duvarlarda koş, boşlukları aş, saate karşı yarış!'));
    const b1 = el('button', 'pk-b'); b1.innerHTML = '<span style="font-size:26px">♾️</span><span>SONSUZ<small>' + (p.bestDist > 0 ? 'En iyi: ' + Math.round(p.bestDist) + ' m' : 'Saat bitmeden en uzağa koş') + '</small></span>';
    b1.addEventListener('click', () => { this.sfx('ui', 'confirm'); this.startRun('endless'); });
    const myBest = p.daily[dk];
    const rk = this.board.rank(dk);
    const b2 = el('button', 'pk-b blue'); b2.innerHTML = '<span style="font-size:26px">📅</span><span>GÜNÜN PARKURU #' + dailyNumber() + '<small>' + (myBest ? 'En iyi: ' + fmtT(myBest / 1000) + (rk ? ' · Sıra #' + rk : '') : 'Herkese aynı parkur · süreye karşı') + '</small></span>';
    b2.addEventListener('click', () => { this.sfx('ui', 'confirm'); this.startRun('daily'); });
    s.append(b1, b2);
    s.append(el('h2', '', 'YETENEKLER'));
    const ab = el('div', 'ab');
    const base = el('div'); base.innerHTML = '<span class="i">🧱</span><span><b>DUVAR KOŞUSU · KAYMA</b><br>Havada duvara değ, yapış ve zıpla. Alçak barların altından kay.</span>';
    ab.append(base);
    for (const u of UNLOCKS) {
      const on = !!p.unl[u.id], d = el('div', on ? '' : 'lock');
      d.innerHTML = `<span class="i">${on ? u.ico : '🔒'}</span><span><b>${u.name}</b><br>${on ? u.desc : 'Açmak için: ' + u.req(p)}</span>`;
      ab.append(d);
    }
    s.append(ab);
    s.append(el('h2', '', 'LİDERLİK'));
    const tabs = el('div', 'pk-tabs');
    const tD = el('button', '', 'GÜNÜN PARKURU'), tE = el('button', '', 'SONSUZ');
    tD.addEventListener('click', () => { this.tab = 'daily'; this.sfx('ui', 'select'); this.refreshBoard(); });
    tE.addEventListener('click', () => { this.tab = 'endless'; this.sfx('ui', 'select'); this.refreshBoard(); });
    tabs.append(tD, tE);
    this._tabs = [tD, tE];
    this._lb = el('div', 'pk-lb'); this._net = el('div', 'pk-net');
    s.append(tabs, this._lb, this._net);
    const nm = el('label', 'pk-name'); nm.append(el('span', '', 'İsmin:'));
    const inp = el('input'); inp.maxLength = 12; inp.value = myName(); inp.setAttribute('aria-label', 'İsmin');
    inp.addEventListener('change', () => { inp.value = setMyName(inp.value); this._renameMine(); this.refreshBoard(); });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    nm.append(inp); s.append(nm);
    const back = el('button', 'pk-b ghost', '← ANA MENÜ');
    back.addEventListener('click', () => { this.sfx('ui', 'back'); this.exit(); });
    s.append(back);
    this.refreshBoard();
  }

  _renameMine() {
    for (const k of Object.keys(this.board.data)) { const m = this.board.mine(k); if (m) { m.name = myName(); m.ts = Date.now(); } }
    this.board._persist();
  }

  boardHtml(key, n = 8) {
    const rows = this.board.top(key, n), low = lowerIsBetter(key), me = this.board.mine(key), rk = this.board.rank(key);
    const fmtV = (v) => (low ? fmtT(v / 1000) : Math.round(v) + ' m');
    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
    if (!rows.length) return '<div class="empty">Henüz skor yok - ilk sen ol!</div>';
    let h = rows.map((e, i) => `<div class="${me && e.id === me.id ? 'me' : ''}"><span>#${i + 1}</span><span>${esc(e.name)}</span><span>${fmtV(e.v)}</span></div>`).join('');
    if (me && rk > n) h += `<div class="me"><span>#${rk}</span><span>${esc(me.name)}</span><span>${fmtV(me.v)}</span></div>`;
    return h;
  }

  netText() {
    const b = this.board;
    return b.status === 'on' ? (b.online > 0 ? `🌐 ${b.online} oyuncu çevrimiçi · skorlar otomatik paylaşılıyor` : '🌐 Çevrimiçi · diğer oyuncular bekleniyor') : b.status === 'connecting' ? '🌐 Bağlanıyor…' : '📴 Çevrimdışı · yerel tablo';
  }

  refreshBoard() {
    if (!this._lb) return;
    const key = this.tab === 'daily' ? this.dailyKey() : 'endless';
    this._tabs[0].classList.toggle('on', this.tab === 'daily'); this._tabs[1].classList.toggle('on', this.tab !== 'daily');
    this._lb.innerHTML = this.boardHtml(key);
    this._net.textContent = this.netText();
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    this.board.watch(this.dailyKey());
    this.board.connect();
    this.showMenu();
  }

  startRun(kind, seed) {
    this.kind = kind;
    this.scr.style.display = 'none';
    this._lb = null;
    this.clearCourse();
    const daily = kind === 'daily';
    this.seed = daily ? (dailySeed() * 7919 + 1337) >>> 0 : (seed || ((Math.random() * 0x7fffffff) ^ Date.now())) >>> 0;
    this.course = new Course({ seed: this.seed, abil: daily ? {} : this.abil, daily, segCount: DAILY_SEGS, cpEvery: CP_EVERY });
    if (daily) this.course.ensure(1e9); // the whole daily course exists up front (meshes still stream in)
    this.total = daily ? Math.round(this.course.segs[this.course.segs.length - 1].finish.z) : 0;
    this.built = 0;
    this.live = [];          // segments with meshes
    this.movers = []; this.tiles = []; this.sweeps = [];
    this.clock = daily ? 0 : ENDLESS_T0;
    this.cpCount = 0; this.deaths = 0; this.lifeId = 1; this.runCps = 0;
    this.lastCp = null;
    this.resetPlayer({ x: 0, y: 0, z: 3 });
    this.stream();
    this.lastCp = this.live[0].cp;
    this.state = 'count'; this.countT = 3;
    this.setHudVisible(true);
    this.hud.time.classList.remove('low');
    this.hud.tbar.style.display = daily ? 'none' : '';
    this.updateHud();
    this.showHint();
    this.prog.runs++;
    this.save && this.save.saveParkur && this.save.saveParkur();
    this.updateCamera(1, true);
    this.track('parkur_start', { mode: kind });
  }

  showHint() {
    const h = this.hud.hint, first = (this.prog.tut | 0) < 3;
    h.style.opacity = first ? 1 : 0;
    const touch = matchMedia && matchMedia('(pointer: coarse)').matches;
    h.innerHTML = touch
      ? '<div>👈 Sol yarı: sürükle = yönlendir</div><div>👉 Sağ yarı: dokun = zıpla · aşağı kaydır = kay / havada hızlı in' + (this.abil.dash ? ' · yana kaydır = atıl' : '') + '</div>'
      : '<div>A/D ←/→ yönlendir</div><div>Boşluk zıpla · S kay / havada hızlı in' + (this.abil.dash ? ' · Shift atıl' : '') + '</div>';
    clearTimeout(this._hintT); this._hintT = setTimeout(() => { h.style.opacity = 0; }, 6500);
    this.prog.tut = (this.prog.tut | 0) + 1;
  }

  resetPlayer(at) {
    const P = this.P = this.P || { p: new THREE.Vector3(), v: new THREE.Vector3() };
    P.p.set(at.x, at.y + PH.R + 0.02, at.z); P.v.set(0, 0, 0);
    P.ground = true; P.groundBox = null; P.coyote = 0; P.buffer = 0; P.dj = true; P.dashOk = true; P.dashT = 0; P.dashCd = 0;
    P.slideT = 0; P.slideQ = false; P.wall = 0; P.wallT = 0; P.wallCo = 0; P.wallLock = 0; P.lockSide = 0; P.stunT = 0; P.touchWall = 0;
    P.speed = PH.RUN; P.boostT = 0; P.floorY = at.y; P.spin = 0; P.hitCd = 0; P.wasGround = true; P.jumpT = 9;
    this.inp = { steer: 0, jump: false, slide: false, dash: false };
  }

  toMenu() {
    if (this.state === 'menu') return;
    this.clearCourse();
    this.showMenu();
  }

  exit() {
    if (this.onExit) this.onExit();
  }

  onBack() {
    if (this.state === 'menu') this.exit();
    else this.toMenu();
  }

  clearCourse() {
    if (!this.live) return;
    for (const s of this.live) this.world.remove(s.g);
    this.live = []; this.movers = []; this.tiles = []; this.sweeps = [];
    this.course = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this._popT); clearTimeout(this._hintT); clearTimeout(this._unlT);
    this.board.stop();
    this._unbindInput();
    this.hud.root.remove(); this.scr.remove();
    this.clearCourse();
    const mats = new Set();
    this._scene.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) [].concat(n.material).forEach((m) => mats.add(m)); });
    for (const k in this.mats) [].concat(this.mats[k]).flat().forEach((m) => mats.add(m));
    for (const m of mats) m.dispose();
    this.geo.dispose(); this.ringGeo.dispose(); if (this.dotTex) this.dotTex.dispose();
    this._scene.clear();
  }

  // ------------------------------------------------------------------ course streaming / meshes
  stream() {
    const P = this.P, ahead = P.p.z + 170, C = this.course;
    C.ensure(ahead);
    while (this.built < C.segs.length && C.segs[this.built].z0 < ahead) this.buildSeg(C.segs[this.built++]);
    const keep = Math.min(P.p.z, this.lastCp ? this.lastCp.z : P.p.z) - 30;
    while (this.live.length > 2 && this.live[0].z1 < keep) {
      const s = this.live.shift();
      this.world.remove(s.g);
      this.movers = this.movers.filter((b) => b.seg !== s); this.tiles = this.tiles.filter((b) => b.seg !== s); this.sweeps = this.sweeps.filter((b) => b.seg !== s);
    }
  }

  mesh(mat, x, y, z, w, h, d, parent) {
    const m = new THREE.Mesh(this.geo, mat);
    m.position.set(x, y, z); m.scale.set(w, h, d);
    m.matrixAutoUpdate = false; m.updateMatrix();
    parent.add(m);
    return m;
  }

  buildSeg(s) {
    const g = s.g = new THREE.Group();
    const M = this.mats;
    for (const b of s.boxes) {
      b.seg = s; b.top = b.y + b.h / 2;
      const mat = b.t === 'floor' ? M.floor[s.i % 3] : M[b.t] || M.post;
      b.m = this.mesh(mat, b.x, b.y, b.z, b.w, b.h, b.d, g);
      if (b.mov) { b.m.matrixAutoUpdate = true; b.dx = 0; this.movers.push(b); }
      if (b.crumble) { b.m.matrixAutoUpdate = true; b.st = 0; b.t0 = 0; b.y0 = b.y; this.tiles.push(b); }
    }
    for (const r of s.rings) {
      const m = new THREE.Mesh(this.ringGeo, M.ring); m.position.set(r.x, r.y, r.z); g.add(m); r.m = m; r.got = false;
    }
    for (const w of s.sweep) {
      w.seg = s;
      const piv = new THREE.Group(); piv.position.set(w.x, w.y, w.z);
      const bar = new THREE.Mesh(this.geo, M.sweep); bar.scale.set(w.len, 0.3, 0.3); bar.position.x = w.len / 2; piv.add(bar);
      const tip = new THREE.Mesh(this.geo, M.sweep); tip.scale.set(0.45, 0.45, 0.45); tip.position.x = w.len; piv.add(tip);
      g.add(piv); w.m = piv; w.hitCd = 0;
      this.sweeps.push(w);
    }
    const gate = (c, fin) => {
      const W = (s.boxes[0] ? s.boxes[0].w : 5) / 2 + 0.25;
      c.posts = [this.mesh(fin ? M.finish : M.gate, c.x - W, c.y + 1.7, c.z, 0.3, 3.4, 0.3, g), this.mesh(fin ? M.finish : M.gate, c.x + W, c.y + 1.7, c.z, 0.3, 3.4, 0.3, g)];
      c.banner = this.mesh(fin ? M.finish : M.banner, c.x, c.y + 3.25, c.z, W * 2 + 0.3, 0.5, 0.2, g);
    };
    if (s.cp && s.i > 0) gate(s.cp, false);
    if (s.finish) gate(s.finish, true);
    this.world.add(g);
    this.live.push(s);
  }

  /** boxes near z (live segments overlapping [z0, z1]) */
  near(z0, z1, out) {
    out.length = 0;
    for (const s of this.live) {
      if (s.z1 + 2 < z0 || s.z0 - 2 > z1) continue;
      for (const b of s.boxes) if (!b.gone && b.z + b.d / 2 > z0 && b.z - b.d / 2 < z1) out.push(b);
    }
    return out;
  }

  // ------------------------------------------------------------------ input
  _bindInput() {
    const keys = this.keys = {};
    this._kd = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.code;
      if (k === 'Escape') { this.onBack(); return; }
      if (this.state === 'result' && (k === 'Enter' || k === 'Space')) { this.startRun(this.kind); e.preventDefault(); return; }
      if (!e.repeat) {
        if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') this.press('jump');
        if (k === 'ArrowDown' || k === 'KeyS' || k === 'KeyC' || k === 'ControlLeft') this.press('slide');
        if (k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyE' || k === 'KeyK') this.press('dash');
      }
      keys[k] = true;
      if (/^(Space|Arrow)/.test(k) && this.state !== 'menu') e.preventDefault();
    };
    this._ku = (e) => { keys[e.code] = false; };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    const d = this.dom = this.renderer.domElement;
    this._ta = d.style.touchAction; d.style.touchAction = 'none';
    this.ptr = new Map();
    this._pd = (e) => {
      try { this.audio && this.audio.init && this.audio.init(); } catch { /* ignore */ }
      if (this.state !== 'play' && this.state !== 'count') return;
      const w = d.clientWidth || window.innerWidth;
      const left = e.clientX < w * 0.5;
      const o = { left, x: e.clientX, y: e.clientY, t: performance.now(), done: false, jumpAt: -1 };
      this.ptr.set(e.pointerId, o);
      try { d.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (left) { const st = this.hud.stick; st.style.display = 'block'; st.style.left = o.x + 'px'; st.style.top = o.y + 'px'; st.firstChild.style.transform = ''; }
      else { o.jumpAt = this.time; o.ground = this.P && (this.P.ground || this.P.coyote > 0); this.press('jump'); }
    };
    this._pm = (e) => {
      const o = this.ptr.get(e.pointerId); if (!o) return;
      const dx = e.clientX - o.x, dy = e.clientY - o.y;
      if (o.left) {
        this.touchSteer = clamp(dx / 48, -1, 1);
        this.hud.stick.firstChild.style.transform = `translate(${clamp(dx, -40, 40)}px,0)`;
        return;
      }
      if (o.done || performance.now() - o.t > 350) return;
      if (dy > 34 && dy > Math.abs(dx)) {
        o.done = true;
        // a downward swipe that began as a ground jump becomes a slide instead
        if (o.ground && this.time - o.jumpAt < 0.2 && this.P.v.y > 0) this.P.v.y = 0;
        this.press('slide');
      } else if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy)) { o.done = true; this.press('dash'); }
    };
    this._pu = (e) => {
      const o = this.ptr.get(e.pointerId); if (!o) return;
      this.ptr.delete(e.pointerId);
      if (o.left) { this.touchSteer = null; this.hud.stick.style.display = 'none'; }
    };
    d.addEventListener('pointerdown', this._pd);
    d.addEventListener('pointermove', this._pm);
    d.addEventListener('pointerup', this._pu);
    d.addEventListener('pointercancel', this._pu);
    this.touchSteer = null;
  }

  _unbindInput() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    const d = this.dom;
    if (d) {
      d.removeEventListener('pointerdown', this._pd); d.removeEventListener('pointermove', this._pm);
      d.removeEventListener('pointerup', this._pu); d.removeEventListener('pointercancel', this._pu);
      d.style.touchAction = this._ta || '';
    }
  }

  press(a) {
    if (this.state !== 'play' || !this.P) return;
    if (a === 'jump') this.P.buffer = PH.BUFFER;
    else if (a === 'slide') this.P.slideReq = true;
    else if (a === 'dash') this.P.dashReq = true;
  }

  readSteer() {
    if (this.auto) return this.botSteer();
    if (this.touchSteer != null) return this.touchSteer;
    const k = this.keys;
    return ((k.ArrowRight || k.KeyD) ? 1 : 0) - ((k.ArrowLeft || k.KeyA) ? 1 : 0);
  }

  // ------------------------------------------------------------------ autoplay (tests / attract)
  botSteer() {
    const P = this.P, z = P.p.z;
    // act a little earlier when running faster than the speed the course was sized for
    const za = z + Math.max(0, P.v.z - PH.RUN) * 0.25;
    if (P.ground && P.v.z < 1.5 && P.stunT <= 0) { if ((this._stuck = (this._stuck || 0) + 1) > 12) { this._stuck = 0; this.press('jump'); } } else this._stuck = 0;
    let prev = null, next = null;
    for (const s of this.live) {
      if (s.z1 < z - 3 || s.z0 > z + 30) continue;
      for (const pt of s.path) {
        if (pt.act && pt._d !== this.lifeId && pt.z <= za && pt.z > za - 1.5) {
          pt._d = this.lifeId; this.press(pt.act);
          // remember where this jump should land (next floor point) so the bot can fast-fall onto short platforms
          if (pt.act === 'jump' && (P.ground || P.coyote > 0)) { const i = s.path.indexOf(pt); this._tgt = null; for (const q of s.path.slice(i + 1).concat(this.nextPath(s))) { if (q.y == null) break; if (q.z > pt.z + 0.8 && (q.box ? q.box !== P.groundBox : Math.abs(q.y - P.floorY) > 0.01)) { const e = s.path.concat(this.nextPath(s)).find((u) => u.z > q.z && (q.box ? u.box === q.box : u.y === q.y && !u.box)); this._tgt = { z: q.z, y: q.y, end: e ? e.z : q.z + 3, t: this.time }; break; } } }
        }
        if (pt.z <= z + 0.8) prev = pt; else if (!next) next = pt;
      }
    }
    // fast-fall (slam) when the full arc would overshoot a short landing
    const T = this._tgt;
    if (T && !P.ground && P.v.y < 4) {
      const hgt = P.p.y - PH.R - T.y, g = PH.G;
      if (hgt > 0.25) {
        const tN = (P.v.y + Math.sqrt(P.v.y * P.v.y + 2 * g * hgt)) / g, zN = P.p.z + P.v.z * tN;
        const tS = (-PH.SLAM + Math.sqrt(PH.SLAM * PH.SLAM + 2 * g * hgt)) / g, zS = P.p.z + P.v.z * tS;
        if (zN > T.end - 0.6 && zS >= T.z + 0.3) { this.press('slide'); this._tgt = null; }
      }
    }
    if (T && P.ground && this.time - T.t > 0.3) this._tgt = null;
    const px = (pt) => (pt.box ? pt.box.x : pt.x);
    let tx = P.p.x;
    if (next && prev) { const t = clamp((z + 0.8 - prev.z) / Math.max(0.01, next.z - prev.z), 0, 1); tx = px(prev) + (px(next) - px(prev)) * t; if (next.box || (next.z - z < 4)) tx = px(next); }
    else if (next) tx = px(next);
    else if (prev) tx = px(prev);
    return clamp(RIGHT * (tx - P.p.x) * 1.6, -1, 1);
  }

  nextPath(s) { const i = this.live.indexOf(s); const n = i >= 0 ? this.live[i + 1] : null; return n ? n.path : []; }

  // ------------------------------------------------------------------ physics
  physics(h) {
    const P = this.P, p = P.p, v = P.v, ab = this.abil;
    const steer = this.steer;
    P.buffer -= h; P.coyote -= h; P.wallCo -= h; P.wallLock -= h; P.stunT -= h; P.dashCd -= h; P.hitCd -= h; P.jumpT += h;
    if (P.boostT > 0) P.boostT -= h;
    // movers
    for (const b of this.movers) { const nx = b.mov.x0 + Math.sin(this.time * b.mov.spd + b.mov.ph) * b.mov.amp; b.dx = nx - b.x; b.x = nx; }
    if (P.ground && P.groundBox && P.groundBox.mov) p.x += P.groundBox.dx;
    // crumbling ice
    for (const b of this.tiles) {
      if (b.st === 1 && (b.t0 -= h) <= 0) { b.st = 2; b.gone = true; b.t0 = 3; b.vy = 0; }
      else if (b.st === 2) { b.vy -= 20 * h; b.y += b.vy * h; if ((b.t0 -= h) <= 0) { b.st = 0; b.gone = false; b.y = b.y0; } }
    }
    // jump / wall jump / double jump
    if (P.buffer > 0 && P.stunT <= 0) {
      if (P.ground || P.coyote > 0) {
        v.y = PH.JUMP; P.ground = false; P.coyote = 0; P.buffer = 0; P.slideT = 0; P.jumpT = 0;
        this.sfx('hop', 0.45); this.burst(p.x, p.y - 0.3, p.z, 5, 0xffffff, 2, 1);
      } else if (P.wall || P.wallCo > 0) {
        const side = P.wall || P.lastWall;
        v.y = PH.WJ_V; v.x = -side * PH.WJ_X; P.lockSide = side; P.wallLock = 0.35;
        P.wall = 0; P.wallCo = 0; P.buffer = 0; P.dj = true; P.dashOk = true; P.jumpT = 0;
        this.sfx('hop', 0.7); this.burst(p.x + side * 0.4, p.y, p.z, 8, 0xbfe9ff, 3, 1);
      } else if (ab.dj && P.dj) {
        v.y = PH.DJ; P.dj = false; P.buffer = 0; P.spin = 1; P.jumpT = 0;
        this.sfx('hop', 0.95); this.burst(p.x, p.y - 0.2, p.z, 10, 0x9fe0ff, 3, -0.5);
      }
    }
    // dash
    if (P.dashReq) {
      P.dashReq = false;
      if (ab.dash && P.dashOk && P.dashCd <= 0 && P.stunT <= 0) {
        P.dashT = PH.DASH_T; P.dashCd = 0.5; if (!P.ground) P.dashOk = false; P.wall = 0;
        this.sfx('whoosh'); this.burst(p.x, p.y, p.z - 0.4, 8, 0xfff2a8, 2, 0.3);
      }
    }
    // slide (in the air: slam down, then slide on landing)
    if (P.slideReq) {
      P.slideReq = false;
      if (P.ground) { P.slideT = PH.SLIDE_T; this.sfx('turn'); }
      else { v.y = Math.min(v.y, -PH.SLAM); P.slideQ = true; P.wall = 0; P.dashT = 0; this.burst(p.x, p.y + 0.4, p.z, 4, 0xbfe9ff, 1, 2); }
    }
    if (P.slideT > 0) P.slideT -= h;
    // forward speed (auto-run with momentum)
    if (P.ground && P.stunT <= 0) P.speed = Math.min(PH.RUN_MAX, P.speed + 0.22 * h);
    const want = P.speed + (P.boostT > 0 ? PH.BOOST : 0);
    if (P.dashT > 0) { P.dashT -= h; v.z = PH.DASH_V; v.y = Math.max(v.y, 0); }
    else if (P.stunT <= 0) v.z += (want - v.z) * Math.min(1, h * (P.ground ? 7 : 2.5));
    // lateral
    if (P.stunT <= 0) {
      if (P.wall) v.x = P.wall * 2;
      else {
        const tx = RIGHT * steer * (P.ground ? PH.LAT : PH.AIR_LAT);
        v.x += (tx - v.x) * Math.min(1, h * (P.ground ? 14 : 7));
      }
    }
    // gravity
    if (P.dashT > 0) { /* level flight */ } else if (P.wall) { v.y -= PH.G * PH.WR_G * h; if (v.y < -2.2) v.y = -2.2; } else v.y -= PH.G * h;
    if (v.y < -40) v.y = -40;
    p.addScaledVector(v, h);
    // wall-run upkeep
    if (P.wall) {
      P.wallT -= h;
      if (P.wallT <= 0 || steer * RIGHT * P.wall < -0.5) { P.lastWall = P.wall; P.wallCo = 0.14; P.lockSide = P.wall; P.wallLock = 0.45; P.wall = 0; }
    }
    // collisions
    const wasGround = P.ground;
    P.ground = false; P.touchWall = 0;
    const list = this.near(p.z - 3, p.z + 3, this._nb || (this._nb = []));
    this.collide(list, 0);
    if (P.slideT <= 0) this.collide(list, PH.HEAD);
    else if (this.overlapHead(list) && P.ground) P.slideT = Math.max(P.slideT, 0.05); // keep sliding under a bar
    if (P.wall && P.touchWall !== P.wall) { P.lastWall = P.wall; P.wallCo = 0.14; P.wall = 0; }
    // wall magnet: airborne next to a tall wall (and not steering away) -> drift onto it, so touch players stick easily
    if (!P.ground && !P.wall && P.stunT <= 0 && v.z > 3) {
      for (const b of list) {
        if (b.h < 2.5 || p.z < b.z - b.d / 2 || p.z > b.z + b.d / 2 || p.y < b.y - b.h / 2 + 0.6 || p.y > b.y + b.h / 2) continue;
        const side = b.x > p.x ? 1 : -1, gap = Math.abs(b.x - p.x) - b.w / 2 - PH.R;
        if (gap > 0 && gap < 1.1 && steer * RIGHT * side >= -0.2 && !(P.wallLock > 0 && P.lockSide === side)) v.x += side * 40 * h;
      }
    }
    // sweepers
    for (const w of this.sweeps) {
      w.hitCd -= h;
      const cx = Math.cos(w.a), cz = Math.sin(w.a);
      const rx = p.x - w.x, rz = p.z - w.z;
      const t = clamp(rx * cx + rz * cz, 0, w.len);
      const qx = w.x + cx * t, qz = w.z + cz * t, dy = p.y - w.y;
      const dx = p.x - qx, dz = p.z - qz;
      if (w.hitCd <= 0 && P.hitCd <= 0 && Math.abs(dy) < PH.R + 0.2 && dx * dx + dz * dz < (PH.R + 0.2) ** 2) {
        const sg = Math.sign(w.w) || 1;
        v.x = -cz * sg * 9; v.z = cx * sg * 9 - 2; v.y = 6.5; P.stunT = 0.35; P.speed = PH.RUN; P.hitCd = 0.5; w.hitCd = 0.5; P.slideT = 0;
        this.sfx('bump', 0.8); this.haptic('medium'); this.burst(p.x, p.y, p.z, 12, 0xff6060, 4, 2);
      }
    }
    // ground bookkeeping
    if (P.ground) {
      P.dj = true; P.dashOk = true; P.wall = 0; P.floorY = P.groundBox ? P.groundBox.top : p.y;
      if (!wasGround && P.fallV < -7) {
        this.sfx('land', clamp(-P.fallV / 25, 0.15, 1)); this.burst(p.x, p.y - 0.35, p.z, 6, 0xffffff, 2.5, 0.8);
        if (P.slideQ) { P.slideT = PH.SLIDE_T; this.sfx('turn'); }
      }
      P.slideQ = false;
    } else if (wasGround && v.y <= 0.01) P.coyote = PH.COYOTE;
    P.fallV = v.y;
  }

  collide(list, off) {
    const P = this.P, p = P.p, v = P.v, R = PH.R;
    for (const b of list) {
      const cy = p.y + off;
      const hw = b.w / 2, hh = b.h / 2, hd = b.d / 2;
      const qx = clamp(p.x, b.x - hw, b.x + hw), qy = clamp(cy, b.y - hh, b.y + hh), qz = clamp(p.z, b.z - hd, b.z + hd);
      let dx = p.x - qx, dy = cy - qy, dz = p.z - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= R * R) continue;
      let pen;
      if (d2 > 1e-9) { const d = Math.sqrt(d2); dx /= d; dy /= d; dz /= d; pen = R - d; }
      else { dx = 0; dy = 1; dz = 0; pen = b.y + hh - cy + R; }
      p.x += dx * pen; p.y += dy * pen; p.z += dz * pen;
      if (dy > 0.55 && off === 0) {
        if (v.y <= 0.5) {
          if (b.t === 'pad') {
            v.y = PH.BOUNCE; P.dj = true; P.dashOk = true; P.slideT = 0;
            this.sfx('pof'); this.sfx('hop', 1); this.haptic('light'); this.burst(p.x, p.y - 0.3, p.z, 12, 0xff7ab8, 3, 3);
            continue;
          }
          v.y = 0; P.ground = true; P.groundBox = b;
          if (b.crumble && b.st === 0) { b.st = 1; b.t0 = 0.42; }
        }
      } else if (dy < -0.55) { if (v.y > 0) v.y = 0; }
      else if (Math.abs(dx) > 0.6) {
        if (v.x * dx < 0) v.x = 0;
        const side = dx > 0 ? -1 : 1; // wall is on the opposite side of the push
        P.touchWall = side;
        if (!P.ground && !P.wall && b.h >= 2.5 && v.z > 3 && P.p.y > b.y - b.h / 2 + 0.6 && !(P.wallLock > 0 && P.lockSide === side)) {
          P.wall = side; P.wallT = PH.WR_T * (this.abil.wrLong ? 1.5 : 1); v.y = clamp(v.y, -1, 2.5); P.dj = true; P.dashOk = true; P.slideQ = false;
          this.sfx('near'); this.burst(p.x + side * 0.4, p.y, p.z, 6, 0xbfe9ff, 1.5, 0.5);
        }
      } else if (dz < -0.6) {
        if (v.z > 0) { if (v.z > 6 && P.hitCd <= 0) { this.sfx('bump', 0.35); P.hitCd = 0.3; } v.z = 0; P.speed = Math.max(PH.RUN, P.speed - 1.5); }
      }
    }
  }

  overlapHead(list) {
    const p = this.P.p, R = PH.R, cy = p.y + PH.HEAD;
    for (const b of list) {
      const qx = clamp(p.x, b.x - b.w / 2, b.x + b.w / 2), qy = clamp(cy, b.y - b.h / 2, b.y + b.h / 2), qz = clamp(p.z, b.z - b.d / 2, b.z + b.d / 2);
      if ((p.x - qx) ** 2 + (cy - qy) ** 2 + (p.z - qz) ** 2 < R * R * 0.9) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    if (this.state === 'menu') { this.idleCam(dt); this.updateParticles(dt); return; }
    if (!this.course) return;
    const P = this.P;
    if (this.state === 'count') {
      const before = Math.ceil(this.countT);
      this.countT -= dt;
      const n = Math.ceil(this.countT);
      const m = this.hud.msg;
      if (this.countT > 0) { m.innerHTML = String(n) + '<small>' + (this.kind === 'daily' ? 'GÜNÜN PARKURU #' + dailyNumber() : 'SONSUZ · saat bitmeden koş!') + '</small>'; m.classList.add('on'); if (n !== before || !this._cd) { this.sfx('ui', 'select'); this._cd = 1; } }
      else { this.state = 'play'; this._cd = 0; m.textContent = 'BAŞLA!'; this.sfx('ui', 'confirm'); this.sfx('whoosh'); setTimeout(() => { if (this.state === 'play') m.classList.remove('on'); }, 500); }
      this.updateCamera(dt); this.animYeti(dt); this.updateParticles(dt);
      return;
    }
    if (this.state === 'play') {
      this.steer = this.readSteer();
      let acc = dt;
      while (acc > 1e-6) { const h = Math.min(STEP, acc); this.physics(h); acc -= h; }
      // clock
      if (this.kind === 'daily') this.clock += dt;
      else { this.clock -= dt; if (this.clock <= 0) { this.clock = 0; this.finishRun(false); } }
      this.checkpoints();
      // fell off the course
      if (P.p.y < P.floorY - 11) this.die();
      this.stream();
    } else if (this.state === 'dead') {
      this.deadT -= dt;
      if (this.deadT <= 0) this.respawn();
    }
    for (const w of this.sweeps) { w.a += w.w * dt; w.m.rotation.y = -w.a; }
    for (const b of this.movers) b.m.position.x = b.x;
    for (const b of this.tiles) { b.m.position.y = b.y + (b.st === 1 ? Math.sin(this.time * 70) * 0.04 : 0); b.m.visible = b.y > b.y0 - 25; }
    for (const s of this.live) for (const r of s.rings) if (!r.got) r.m.rotation.z += dt * 2.5;
    this.animYeti(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  checkpoints() {
    const P = this.P, p = P.p;
    for (const s of this.live) {
      if (s.z0 > p.z + 3 || s.z1 < p.z - 3) continue;
      for (const r of s.rings) {
        if (r.got) continue;
        const dx = p.x - r.x, dy = p.y - r.y, dz = p.z - r.z;
        if (dx * dx + dy * dy + dz * dz < 1.6 * 1.6) {
          r.got = true; r.m.visible = false; P.boostT = 1.6;
          if (this.kind === 'endless') this.clock += 1;
          this.sfx('flake'); this.burst(r.x, r.y, r.z, 10, 0xffe14a, 3, 1);
          this.pop(this.kind === 'endless' ? '⚡ HIZ +1 sn' : '⚡ HIZ!', '#ffe14a', 700);
        }
      }
      const c = s.cp;
      if (c && s.i > 0 && !c.on && p.z >= c.z && (!this.lastCp || c.z > this.lastCp.z)) {
        c.on = true; this.lastCp = c; this.cpCount++; this.runCps++;
        for (const m of c.posts) m.material = this.mats.gateOn;
        c.banner.material = this.mats.bannerOn;
        this.prog.cps++;
        let txt = '🚩 KONTROL NOKTASI';
        if (this.kind === 'endless') { const add = clamp(12 - s.i * 0.06, 7, 12); this.clock += add; txt += ' +' + add.toFixed(0) + ' sn'; }
        this.pop(txt, '#7dff9a');
        this.sfx('chime'); this.haptic('light');
        this.burst(c.x, c.y + 3, c.z, 18, 'confetti', 4, 2);
        this.checkUnlocks();
        this.save && this.save.saveParkur && this.save.saveParkur();
      }
      if (s.finish && p.z >= s.finish.z && this.state === 'play') this.finishRun(true);
    }
  }

  checkUnlocks() {
    for (const u of UNLOCKS) {
      if (this.prog.unl[u.id] || !u.need(this.prog)) continue;
      this.prog.unl[u.id] = 1;
      if (this.course && !this.course.daily) this.course.abil = this.abil;
      this.celebrate(u);
      this.track('parkur_unlock', { id: u.id });
      break; // one celebration at a time; the next shows on a later checkpoint
    }
  }

  celebrate(u) {
    const e = this.hud.unl;
    e.innerHTML = `<div class="i">${u.ico}</div><b>${u.name} AÇILDI!</b><small>${u.desc}</small>`;
    e.classList.add('on');
    this.sfx('milestone', 4); this.haptic('heavy');
    const p = this.P ? this.P.p : { x: 0, y: 1, z: 0 };
    this.burst(p.x, p.y + 1.5, p.z + 2, 40, 'confetti', 6, 4);
    clearTimeout(this._unlT); this._unlT = setTimeout(() => e.classList.remove('on'), 2800);
  }

  die() {
    if (this.state !== 'play') return;
    this.state = 'dead'; this.deadT = 0.75; this.deaths++;
    this.sfx('bump', 0.6); this.haptic('medium');
    this.flash('#bfe2ff', 0.7);
    if (this.kind === 'daily') { this.clock += DIE_PEN_DAILY; this.pop('💥 +' + DIE_PEN_DAILY + ' sn', '#ff8a8a'); }
    else { this.clock = Math.max(0.01, this.clock - DIE_PEN_ENDLESS); this.pop('💥 −' + DIE_PEN_ENDLESS + ' sn', '#ff8a8a'); }
  }

  respawn() {
    const c = this.lastCp || { x: 0, y: 0, z: 3 };
    this.resetPlayer(c);
    this.lifeId++;
    // crumbled tiles ahead come back right away
    for (const b of this.tiles) if (b.st) { b.st = 0; b.gone = false; b.y = b.y0; }
    this.state = this.kind === 'endless' && this.clock <= 0 ? 'result' : 'play';
    this.burst(c.x, c.y + 0.5, c.z, 14, 0xffffff, 3, 2);
    this.updateCamera(1, true);
  }

  finishRun(won) {
    if (this.state === 'result') return;
    this.state = 'result';
    const p = this.prog, b = this.board;
    let key, val, best = false, coins = 0;
    if (this.kind === 'daily') {
      key = this.dailyKey(); val = Math.round(this.clock * 1000);
      p.fin++;
      const prev = p.daily[key];
      if (!prev || val < prev) { p.daily[key] = val; best = true; }
      coins = 40 + (best ? 20 : 0);
      this.sfx('win');
    } else {
      key = 'endless'; val = Math.round(this.P.p.z);
      if (val > p.bestDist) { p.bestDist = val; best = true; }
      coins = Math.floor(val / 25);
      this.sfx('lose');
    }
    this.checkUnlocks();
    const res = val > 0 ? b.submit(key, val) : { rank: b.rank(key) };
    try { if (coins > 0 && this.save && this.save.addCoins) this.save.addCoins(coins); } catch { /* ignore */ }
    this.save && this.save.saveParkur && this.save.saveParkur();
    this.track('parkur_end', { mode: this.kind, v: val, deaths: this.deaths, cps: this.runCps, won: !!won });
    this.setHudVisible(false);
    this.hud.msg.classList.remove('on');
    // result screen
    const s = this.scr; s.innerHTML = ''; s.style.display = '';
    s.append(el('h1', '', this.kind === 'daily' ? 'BİTTİ!' : 'SÜRE DOLDU'));
    s.append(el('div', 'sub', this.kind === 'daily' ? 'GÜNÜN PARKURU #' + dailyNumber() + ' · ' + this.deaths + ' düşüş' : this.runCps + ' kontrol noktası · ' + this.deaths + ' düşüş'));
    s.append(el('div', 'pk-big', this.kind === 'daily' ? fmtT(val / 1000) : val + ' m'));
    if (best) s.append(el('div', 'pk-badge', '⭐ YENİ REKOR!'));
    s.append(el('div', 'sub', (res.rank ? 'Sıran: #' + res.rank + ' · ' : '') + '+' + coins + ' ❄️'));
    s.append(el('h2', '', this.kind === 'daily' ? 'GÜNÜN PARKURU · LİDERLİK' : 'SONSUZ · LİDERLİK'));
    const lb = el('div', 'pk-lb'), net = el('div', 'pk-net');
    this._resBoard = () => { lb.innerHTML = this.boardHtml(key, 8); net.textContent = this.netText(); };
    this._resBoard();
    s.append(lb, net);
    const again = el('button', 'pk-b', '↻ TEKRAR');
    again.addEventListener('click', () => { this.sfx('ui', 'confirm'); this._resBoard = null; this.startRun(this.kind); });
    const menu = el('button', 'pk-b blue', '☰ PARKUR MENÜSÜ');
    menu.addEventListener('click', () => { this.sfx('ui', 'back'); this._resBoard = null; this.toMenu(); });
    s.append(again, menu);
    this.lastResult = { kind: this.kind, v: val, best, rank: res.rank || 0, deaths: this.deaths, cps: this.runCps };
  }

  // ------------------------------------------------------------------ visuals
  animYeti(dt) {
    const P = this.P; if (!P) return;
    const Y = this.yeti, p = P.p;
    this.yetiIn.position.set(p.x, p.y - 0.02, p.z);
    const sl = P.slideT > 0;
    const sy = sl ? 0.55 : 1, sx = sl ? 1.25 : 1;
    Y.scale.x += (sx - Y.scale.x) * Math.min(1, dt * 18); Y.scale.y += (sy - Y.scale.y) * Math.min(1, dt * 18); Y.scale.z = Y.scale.x;
    const run = P.ground && !sl ? Math.sin(this.time * 18) : 0;
    Y.position.y = Math.abs(run) * 0.08 - (sl ? 0.12 : 0);
    Y.rotation.z = P.wall ? -P.wall * 0.45 : RIGHT * this.steer * -0.15 || 0;
    if (P.spin > 0) { P.spin -= dt * 2.8; Y.rotation.x = (1 - Math.max(0, P.spin)) * Math.PI * 2; } else Y.rotation.x = sl ? -0.3 : P.dashT > 0 ? 0.5 : 0.08;
    this.yetiIn.visible = this.state !== 'dead';
    // blob shadow on the highest surface below
    let top = -1e9;
    const list = this.near(p.z - 0.6, p.z + 0.6, this._sb || (this._sb = []));
    for (const b of list) if (Math.abs(p.x - b.x) < b.w / 2 && b.top <= p.y + 0.1 && b.top > top) top = b.top;
    if (top > -1e8 && p.y - top < 14) { this.shadow.visible = this.state !== 'dead'; this.shadow.position.set(p.x, top + 0.02, p.z); const k = clamp(1 - (p.y - top) / 10, 0.3, 1); this.shadow.scale.setScalar(k); }
    else this.shadow.visible = false;
  }

  updateParticles(dt) {
    let any = false;
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -9999; continue; }
      this.pVel[i * 3 + 1] -= 12 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt; this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt; this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    if (any || this._pAny) { this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true; }
    this._pAny = any;
  }

  fitCamera() {
    this.renderer.getSize(this.sz);
    const asp = (this.sz.x || 1) / (this.sz.y || 1), C = this._camera;
    const vf = clamp(2 * Math.atan(Math.tan((66 * Math.PI) / 360) / asp) * 180 / Math.PI, 62, 84);
    if (Math.abs(asp - C.aspect) > 0.001 || Math.abs(vf - C.fov) > 0.01) { C.aspect = asp; C.fov = vf; C.updateProjectionMatrix(); }
  }

  idleCam(dt) {
    this.fitCamera();
    const C = this._camera, t = this.time * 0.15;
    C.position.set(Math.sin(t) * 9, 4.5, Math.cos(t) * 9 - 2);
    C.lookAt(0, 1, 0);
    this.yetiIn.position.set(0, PH.R, 0); this.yetiIn.visible = true; this.yeti.rotation.set(0, 0, 0); this.yeti.scale.setScalar(1); this.yeti.position.y = Math.abs(Math.sin(this.time * 3)) * 0.25;
    this.shadow.visible = true; this.shadow.position.set(0, 0.02, 0); this.shadow.scale.setScalar(1);
    this.backdrop.position.set(C.position.x, 0, C.position.z);
    if (!this._menuFloor) { this._menuFloor = this.mesh(this.mats.floor[0], 0, -0.6, 0, 6, 1.2, 6, this._scene); }
    this._menuFloor.visible = true;
  }

  updateCamera(dt, snap) {
    this.fitCamera();
    if (this._menuFloor) this._menuFloor.visible = false;
    const P = this.P, p = P.p, C = this._camera;
    const sp = clamp((P.v.z - PH.RUN) / 8, 0, 1);
    const want = this._cw || (this._cw = new THREE.Vector3());
    want.set(p.x * 0.55 + (P.wall ? -P.wall * 0.8 : 0), p.y + 2.5 + sp * 0.3, p.z - 5.6 - sp * 1.2);
    if (snap) this._cs = want.clone();
    const cs = this._cs;
    const k = Math.min(1, dt * 9);
    cs.x += (want.x - cs.x) * Math.min(1, dt * 6); cs.y += (want.y - cs.y) * k; cs.z += (want.z - cs.z) * Math.min(1, dt * 14);
    // never inside a wall: cast from the head to the camera and stop short of the first box
    const hx = p.x, hy = p.y + 1, hz = p.z;
    let dx = cs.x - hx, dy = cs.y - hy, dz = cs.z - hz;
    const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
    let tMin = len;
    const list = this.near(Math.min(cs.z, hz) - 1, Math.max(cs.z, hz) + 1, this._cb || (this._cb = []));
    for (const b of list) {
      const t = rayBox(hx, hy, hz, dx, dy, dz, b, 0.25);
      if (t >= 0 && t < tMin) tMin = t;
    }
    const d = Math.max(0.6, tMin - 0.3);
    C.position.set(hx + dx * d, hy + dy * d, hz + dz * d);
    C.lookAt(p.x * 0.8, p.y + 0.9, p.z + 5);
    this.backdrop.position.set(C.position.x, 0, C.position.z);
  }

  updateHud() {
    const h = this.hud, P = this.P;
    if (this.kind === 'daily') { h.time.textContent = fmtT(this.clock); h.time.classList.remove('low'); }
    else {
      h.time.textContent = this.clock.toFixed(1);
      h.time.classList.toggle('low', this.clock < 5);
      h.tfill.style.width = clamp(this.clock / 30, 0, 1) * 100 + '%';
    }
    const dist = Math.max(0, Math.floor(P.p.z));
    if (dist !== this._hd) { this._hd = dist; h.dist.textContent = '📏 ' + dist + ' m' + (this.kind === 'daily' ? ' / ' + this.total + ' m' : ''); }
    if (this.cpCount !== this._hc) { this._hc = this.cpCount; h.cp.textContent = '🚩 ' + this.cpCount; }
    const ab = this.abil, key = (ab.dj ? 1 : 0) + (ab.dash ? 2 : 0) + (ab.wrLong ? 4 : 0) + (P.dj ? 8 : 0) + (P.dashOk && P.dashCd <= 0 ? 16 : 0);
    if (key !== this._ha) { this._ha = key; h.abil.innerHTML = UNLOCKS.filter((u) => ab[u.id]).map((u) => `<span class="${(u.id === 'dj' && !P.dj) || (u.id === 'dash' && !(P.dashOk && P.dashCd <= 0)) ? 'off' : ''}">${u.ico}</span>`).join(''); }
  }

  // ------------------------------------------------------------------ debug / tests
  /** step the simulation for `sec` seconds (60 Hz) - used by the headless tests */
  sim(sec = 1) {
    const n = Math.round(sec * 60);
    for (let i = 0; i < n; i++) { this.update(1 / 60); if (this.state === 'result' || this.state === 'menu') break; }
    return this.summary();
  }
  summary() {
    const P = this.P;
    return { state: this.state, kind: this.kind, z: P ? Math.round(P.p.z) : 0, y: P ? +P.p.y.toFixed(1) : 0, clock: +this.clock?.toFixed?.(1), cps: this.cpCount, deaths: this.deaths, wall: P ? P.wall : 0, segs: this.live ? this.live.length : 0, abil: this.abil };
  }
  debugUnlock(id) { if (id) this.prog.unl[id] = 1; else for (const u of UNLOCKS) this.prog.unl[u.id] = 1; if (this.course && !this.course.daily) this.course.abil = this.abil; }
}

/** distance along a ray to an AABB inflated by pad (or -1) */
function rayBox(ox, oy, oz, dx, dy, dz, b, pad) {
  let t0 = 0, t1 = 1e9;
  const ax = [[ox, dx, b.x, b.w / 2 + pad], [oy, dy, b.y, b.h / 2 + pad], [oz, dz, b.z, b.d / 2 + pad]];
  for (const [o, d, c, h] of ax) {
    const lo = c - h, hi = c + h;
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; continue; }
    let a = (lo - o) / d, bb = (hi - o) / d;
    if (a > bb) { const t = a; a = bb; bb = t; }
    if (a > t0) t0 = a; if (bb < t1) t1 = bb;
    if (t0 > t1) return -1;
  }
  return t0 > 0 ? t0 : -1; // starting inside a box (e.g. sliding under a bar) does not count
}
