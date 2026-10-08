// KARTOPU ARENA - agar.io style snowball mode. Own scene + camera, own DOM overlay, own pointer input.
// Single player runs entirely here (no network code is loaded). Online (all lazily imported): PeerJS game link (net.js) + Trystero serverless room discovery (lobby.js):
// the host runs the whole simulation, clients only send input and render snapshots.
import * as THREE from 'three';
import { VERSION, MAX_HUMANS } from './proto.js';
import { Terrain, NICE, NDEEP, NRAMP } from './terrain.js';
import { generateNames, BOT_CHAT } from './names.js';
import { Trails, Snowfall } from './snowfx.js';
import { SKINS, TRAILS, makeSkin, disposeSkin } from '../skins.js';
const VALID_SKIN = new Set(SKINS.map((k) => k.id)), VALID_TRAIL = new Set(TRAILS.map((k) => k.id));
const SKIN_COL = new Map(SKINS.map((k) => [k.id, parseInt(String((k.preview && (k.preview.b || k.preview.a)) || '#ffffff').slice(1), 16) || 0xffffff]));
import { ArenaProps, TIER_NAMES, TIER_HINT, tierOfM } from './props.js';
import { meta } from '../meta.js';
const EAT_K = 1.1; // eat when 10% heavier (agar.io-like); closer than that the two balls bump

// ------------------------------------------------------------------ constants
const R = 1100; // arena radius (m) - a big agar.io-like map (2.2 km across)
const CAP = 260; // max live cells
const NOWN = 52; // owners (players + bots): up to 8 humans, the rest are bots
const FOOD = 24000, SPARE = 800, FT = FOOD + SPARE; // permanent pellets + slots for boost-trail pellets
const NVIR = 90, NPUP = 40;
const FR = 26; // kar kalesi radius
const PAINT_R = 90;
const FORT_POS = [[0, -520], [450, 260], [-450, 260]];
const NBUR = 8, BUR_R = 6, BUR_IN = 3.4, BUR_M = 80, BUR_T = 5, BUR_CD = 4; // GİZLİ YUVA: snow burrows small balls can hide in
const BUR = (() => { const a = []; for (let k = 0; k < NBUR; k++) { const an = 0.35 + k * 0.7854 + (k % 2) * 0.12; let d = 330 + ((k * 3) % 4) * 140; for (let t = 0; t < 4; t++) { const x = Math.cos(an) * d, z = Math.sin(an) * d; if (FORT_POS.some(([fx, fz]) => Math.hypot(x - fx, z - fz) < 90)) d += 110; } a.push({ x: Math.cos(an) * d, z: Math.sin(an) * d }); } return a; })();
const FLEE_ANG = [0.8, -0.8, 1.6, -1.6];
const GS = 40, GN = 55; // food grid (GN * GS >= 2 * R)
const KR = 0.3; // radius = KR * sqrt(mass)
const MAXM = 60000;
// bot personalities: each bot settles at its own share of the dynamic bot cap (0.55x .. 1.6x), so the leaderboard never
// shows a flat wall of equal masses and there are always a few bigger fish worth hunting
const capK = (id) => 0.55 + 1.05 * ((((id + 3) * 2654435761) >>> 0) % 997) / 996;
const BOSSM = 3600; // boss ball mass (fixed)
const TITLES = [[0, 'Çömez'], [60, 'Kar Tanesi'], [150, 'Kartopu'], [400, 'Dev Kartopu'], [1000, 'Çığ'], [2500, 'Buzul'], [6000, 'Kış Kralı'], [15000, 'Efsane Yeti'], [35000, 'Kartopu Tanrısı']];
const titleOf = (m) => { let k = 0; for (let i = 1; i < TITLES.length; i++) if (m >= TITLES[i][0]) k = i; return k; };
const VIRR = 3, VIR_MIN = 130; // ice crystal radius / smallest mass that gets shattered
const MAXPIECES = 16;
const TIP_KEY = 'patpat.agar.tip';
const BEST_KEY = 'patpat.agar.best', XP_KEY = 'patpat.agar.xp', NICK_KEY = 'patpat.agar.nick';
const PUP_TYPES = [
  { id: 'mag', emoji: '🧲', name: 'MIKNATIS', col: 0xff5a5a, t: 9 },
  { id: 'shd', emoji: '🛡️', name: 'KALKAN', col: 0x4aa8ff, t: 7 },
  { id: 'spd', emoji: '⚡', name: 'HIZ', col: 0xffd23f, t: 7 },
  { id: 'big', emoji: '🍄', name: 'DEV', col: 0xb06bff, t: 0 },
  { id: 'gld', emoji: '❄️', name: 'ALTIN KAR TANESİ', col: 0xffc400, t: 0 },
];
const FOOD_PAL = [0xff5c8a, 0x3fb0ff, 0xffd02e, 0x3fe08a, 0xa86cff, 0xff8a3d, 0x22d6e0, 0xff4fd0];
const VOWELS = 'aeıioöuü';
const BAD = new Set(['amk', 'aq', 'mk', 'orospu', 'piç', 'pic', 'siktir', 'sik', 'sikik', 'yarrak', 'yarak', 'göt', 'oç', 'ananı', 'anani', 'amına', 'amina', 'amcık', 'amcik', 'sikerim', 'bok']);

export const SPD = 1.15; // +15% movement speed for every cell (players and bots alike)
const speedFor = (m) => 17 * SPD * Math.pow(m, -0.12);
const rnd = (a, b) => a + Math.random() * (b - a);
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmtM = (m) => (m >= 100000 ? Math.floor(m / 1000) + 'k' : String(Math.floor(m)));
const fmtT = (s) => { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function accSuffix(name) {
  const low = name.toLocaleLowerCase('tr');
  let lv = 'e';
  for (let i = low.length - 1; i >= 0; i--) { if (VOWELS.includes(low[i])) { lv = low[i]; break; } }
  const endsV = VOWELS.includes(low[low.length - 1]);
  const s = (lv === 'a' || lv === 'ı') ? 'ı' : (lv === 'e' || lv === 'i') ? 'i' : (lv === 'o' || lv === 'u') ? 'u' : 'ü';
  if (endsV && /(si|sı|su|sü)$/.test(low)) return "'n" + s;
  return "'" + (endsV ? 'y' : '') + s;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } };
const fract = (x) => x - Math.floor(x);
const lvlOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1;


// matrix = translation * scale(sx,sy,sz) * rotation(q)  (instanced snowballs roll and can be squashed in world axes)
function wmq(a, p, x, y, z, sx, sy, sz, qx, qy, qz, qw) {
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  a[p] = sx * (1 - 2 * (yy + zz)); a[p + 1] = sy * 2 * (xy + wz); a[p + 2] = sz * 2 * (xz - wy); a[p + 3] = 0;
  a[p + 4] = sx * 2 * (xy - wz); a[p + 5] = sy * (1 - 2 * (xx + zz)); a[p + 6] = sz * 2 * (yz + wx); a[p + 7] = 0;
  a[p + 8] = sx * 2 * (xz + wy); a[p + 9] = sy * 2 * (yz - wx); a[p + 10] = sz * (1 - 2 * (xx + yy)); a[p + 11] = 0;
  a[p + 12] = x; a[p + 13] = y; a[p + 14] = z; a[p + 15] = 1;
}

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4; }
  return t;
}

function wm(a, p, x, y, z, s) {
  a[p] = s; a[p + 1] = 0; a[p + 2] = 0; a[p + 3] = 0;
  a[p + 4] = 0; a[p + 5] = s; a[p + 6] = 0; a[p + 7] = 0;
  a[p + 8] = 0; a[p + 9] = 0; a[p + 10] = s; a[p + 11] = 0;
  a[p + 12] = x; a[p + 13] = y; a[p + 14] = z; a[p + 15] = 1;
}

function spikyGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const base = new THREE.IcosahedronGeometry(1, 0).attributes.position;
  const keys = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < base.count; i++) { v.fromBufferAttribute(base, i).normalize(); keys.push(v.clone()); }
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let spike = false;
    for (let k = 0; k < keys.length; k++) if (v.dot(keys[k]) > 0.9995) { spike = true; break; }
    if (spike) v.multiplyScalar(1.55);
    else v.multiplyScalar(0.92);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class AgarMode {
  constructor({ renderer, post, ui, audio, save, platform, onExit, lib } = {}) {
    this.lib = lib || {}; this.cigTier = 0; this.camKick = 0;
    this.renderer = renderer; this.post = post; this.ui = ui; this.audio = audio; this.save = save; this.platform = platform; this.onExit = onExit;
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x6fb0e6);
    this._camera = new THREE.PerspectiveCamera(50, 0.5, 4, 9000);
    this.app = document.getElementById('app') || document.body;
    this.dom = this.renderer.domElement;
    this.sz = new THREE.Vector2();
    this.tmpC = new THREE.Color();
    this.state = 'title'; // title | lobby | play | dead
    this.mp = null; // null | 'host' | 'client'
    this.net = null;
    this.presence = null; this._tok = 0; this.privRoom = false; this.humans = 1;
    this.me = 0;
    this.time = 0;
    this.nick = (lsGet(NICK_KEY, '') || '').slice(0, 12);
    this.best = parseFloat(lsGet(BEST_KEY, '0')) || 0;
    this.xp = parseFloat(lsGet(XP_KEY, '0')) || 0;
    this.camH = 110; this.camX = 0; this.camZ = 0; this.fs = 1;
    this.inp = { dx: 0, dz: 0, mag: 0, ldx: 0, ldz: 1 };
    this.stickId = null; this.sx = 0; this.sy = 0; this.keys = { l: 0, r: 0, u: 0, d: 0 };
    this.hudT = 0; this.lbT = 0; this.mapT = 0; this.netT = 0; this.sendT = 0; this.lastSnap = 0;
    this.mDirty = true; this.cDirty = true; this.vDirty = true;
    this.deadT = 0; this.disposed = false;
    this.spareHint = FOOD;
    this.fdn = 0;
    this.lb = []; this.lbN = 0;
    this.lastLevel = 1;
    this.terrain = new Terrain(R); this.seed = 1; this.uTime = { value: 0 };
    this.storm = { on: false, x: 0, z: 0, dx: 0, dz: 0, t: 0, next: 40, r: 170 }; this.stormSndT = 0; this.rain = { st: 0, x: 0, z: 0, t: 0, next: 150 + Math.random() * 60, acc: 0 };
    this.duel = { on: false, a: -1, b: -1, ia: -1, ib: -1, cx: 0, cz: 0, nx: 1, nz: 0, r: 20, s: 0, t: 0, cd: 12, bt: [0, 0] };
    this.zn = { st: 0, t: 0, cx: 0, cz: 0, r: R, rt: R * 0.42, next: 300 }; this.sessT = 0; this.wo = { st: 0, t: 0, next: 240 + Math.random() * 120, k: 0 }; this.dirCalm = 25;
    this.av = { st: 0, t: 0, next: 150 + Math.random() * 60, a: 0, off: 0, w: 55, id: 0, rum: 0, s: 0 }; this.tipT = 0; this.tipDone = false; this.boss = { id: -1, hp: 0, max: 0, next: 280 + Math.random() * 40, hitCd: 0, t: 0 };
    this.titleIdx = 0; this.meZone = 0; this.lastMyMass = 0; this.botChatT = 20; this.botCap = 400;
    this.chatLog = []; this.lastChat = 0;
    this.trN = 0;
    this.resultEl = null; this.screenEl = null;
    this._lbCmp = (a, b) => b.mass - a.mass;

    this.sumT = 0; this.prevRank = 99;
    this.initData();
    this.buildScene();
    this.buildForts();
    this.buildZone();
    this.buildHud();
    this.bindInput();
    this.initWorld();
  }

  get scene() { return this._scene; }
  get camera() { return this._camera; }

  // ------------------------------------------------------------------ data
  initData() {
    this.cells = [];
    for (let i = 0; i < CAP; i++) this.cells.push({ on: false, o: 0, x: 0, z: 0, vx: 0, vz: 0, m: 0, r: 0, merge: 0, tx: 0, tz: 0, killer: -1, mvx: 0, mvz: 0, qx: 0, qy: 0, qz: 0, qw: 1, px0: 0, pz0: 0, lsx: 0, lsz: 0, rampT: 0, pcd: 0, bt: 0 });
    this.act = new Int16Array(CAP);
    this.tmpIdx = new Int16Array(CAP);
    this.owners = [];
    for (let i = 0; i < NOWN; i++) {
      const o = {
        id: i, name: '', col: 0xffffff, cr: 1, cg: 1, cb: 1, bot: true, human: null, alive: false, wasAlive: false, cellN: 0, mass: 0, cx: 0, cz: 0, lx: 0, lz: 0, maxR: 1, maxM: 0, ext: 0,
        dx: 0, dz: 1, mag: 0, ldx: 0, ldz: 1, boostT: 0, boostCd: 0, trailT: 0, splitCd: 0, shield: 0, magnet: 0, speed: 0, away: false, respawnT: 0, aiT: Math.random(), tx: 0, tz: 0, wanderT: 0,
        bc: 0, hideT: 0, burCd: 0, fleeT: 0, bur: -1, kills: 0, xpRun: 0, t0: 0, bestRank: 99, maxMass: 0, seen: 0, killer: -1, sprite: null, tex: null, spriteName: '',
      };
      this.owners.push(o);
    }
    // food
    this.fx = new Float32Array(FT); this.fz = new Float32Array(FT); this.fv = new Float32Array(FT);
    this.fej = new Uint8Array(FT); this.ejList = [];
    this.fcol = new Int32Array(FT); this.fcr = new Float32Array(FT); this.fcg = new Float32Array(FT); this.fcb = new Float32Array(FT);
    this.fnext = new Int32Array(FT); this.fprev = new Int32Array(FT); this.fcell = new Int32Array(FT); this.fin = new Uint8Array(FT);
    this.fd = new Uint8Array(FT); this.fdl = new Int32Array(FT);
    this.ghead = new Int32Array(GN * GN).fill(-1);
    // viruses + pickups
    this.vx = new Float32Array(NVIR); this.vz = new Float32Array(NVIR); this.vf = new Uint8Array(NVIR); this.von = new Uint8Array(NVIR); this.vt = new Float32Array(NVIR);
    this.px = new Float32Array(NPUP); this.pz = new Float32Array(NPUP); this.pon = new Uint8Array(NPUP); this.ptype = new Uint8Array(NPUP); this.pt = new Float32Array(NPUP);
    this.forts = FORT_POS.map(([x, z]) => ({ x, z, own: -1, prog: 0, cand: -1, list: [], lbl: '#' }));
    // feed
    this.feed = [{ t: '', until: 0 }, { t: '', until: 0 }, { t: '', until: 0 }, { t: '', until: 0 }];
  }

  // ------------------------------------------------------------------ scene
  buildScene() {
    const sc = this._scene;
    sc.add(new THREE.AmbientLight(0xffffff, 1.05));
    const dl = new THREE.DirectionalLight(0xffffff, 1.35);
    dl.position.set(0.5, 1, 0.35);
    sc.add(dl);
    // ground: a tiling snow texture (subtle variation, faint blue shadows, soft grid)
    this.groundTex = canvasTex(512, 512, (g, W, H) => {
      g.fillStyle = '#c2d8f2'; g.fillRect(0, 0, W, H);
      const T = W / 4; // 4x4 snow tiles, checkered tint
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { g.fillStyle = (a + b) & 1 ? 'rgba(240,246,255,0.55)' : 'rgba(130,175,235,0.42)'; g.fillRect(a * T, b * T, T, T); }
      for (let i = 0; i < 160; i++) {
        const x = Math.random() * W, y = Math.random() * H, r = 10 + Math.random() * 34;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, Math.random() < 0.55 ? 'rgba(150,185,230,0.22)' : 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 500; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(160,195,235,0.35)' : 'rgba(255,255,255,0.8)'; g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 3, 2 + Math.random() * 3); }
      { const im = g.getImageData(0, 0, W, H), d = im.data; for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; } g.putImageData(im, 0, 0); }
      g.strokeStyle = 'rgba(95,140,195,0.55)'; g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { const q = i === 4 ? W - 1.5 : i * T + 1.5; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, H); g.stroke(); g.beginPath(); g.moveTo(0, q); g.lineTo(W, q); g.stroke(); }
    }, 40);
    const gm = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.groundTex, color: 0xd2dcea }));
    sc.add(gm);
    const sea = new THREE.Mesh(new THREE.CircleGeometry(6000, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4f90c9 }));
    sea.position.y = -0.6;
    sc.add(sea);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.5, R + 1.5, 14, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0x2f8be0, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    wall.position.y = 7;
    sc.add(wall);
    // zone patches (ice blue / deep snow / pale violet) + crystal landmarks, visible from afar
    {
      const pr = (() => { let a = 20241; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
      const cols = [0x5cb8ff, 0xff7fb0, 0x6fe39a, 0xffd23f, 0xb48cff, 0xff9c5a, 0x42d9e8, 0xa6e84a];
      this.patches = [];
      for (let i = 0; i < 90; i++) {
        const a = pr() * 6.2832, d = Math.sqrt(pr()) * (R - 120), r = 40 + pr() * 90, col = cols[i % cols.length];
        const m = new THREE.Mesh(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, depthWrite: false }));
        m.position.set(Math.cos(a) * d, 0.04, Math.sin(a) * d); sc.add(m); this.patches.push([m.position.x, m.position.z, r, col]);
      }
      // coloured fort plazas + paths between the forts
      const pc = [0xff6fa5, 0x4db8ff, 0x5fdc7a], FP = FORT_POS;
      FP.forEach(([x, z], i) => { const m = new THREE.Mesh(new THREE.CircleGeometry(FR + 38, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: pc[i % 3], transparent: true, opacity: 0.85, depthWrite: false })); m.position.set(x, 0.06, z); sc.add(m); });
      for (let i = 0; i < FP.length; i++) {
        const A = FP[i], B = FP[(i + 1) % FP.length], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.85, depthWrite: false }));
        m.position.set((A[0] + B[0]) / 2, 0.05, (A[1] + B[1]) / 2); m.rotation.y = -Math.atan2(B[1] - A[1], B[0] - A[0]); sc.add(m);
        const m2 = m.clone(); m2.scale.set(1, 1, 1); m2.position.set(A[0] / 2, 0.05, A[1] / 2); const l2 = Math.hypot(A[0], A[1]); m2.geometry = new THREE.PlaneGeometry(l2, 22).rotateX(-Math.PI / 2); m2.rotation.y = -Math.atan2(A[1], A[0]); sc.add(m2);
      }
      const NC = 70, cm = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), NC);
      const cones = [], mt = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), cc = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < NC; i++) {
        const a = pr() * 6.2832, d = Math.sqrt(pr()) * (R - 60), h = 8 + pr() * 22, w = 2 + pr() * 3;
        pv.set(Math.cos(a) * d, h / 2, Math.sin(a) * d); sv.set(w, h, w); q.setFromAxisAngle(up, pr() * 6);
        cm.setMatrixAt(i, mt.compose(pv, q, sv)); cm.setColorAt(i, cc.setHSL(0.52 + pr() * 0.15, 0.7, 0.62 + pr() * 0.15));
        cones.push([pv.x, pv.z, h, w, q.clone()]);
      }
      cm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.coneMesh = cm; this.cones = cones;
      cm.frustumCulled = false; sc.add(cm);
    }
    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 14, R + 6, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a9be8 }));
    rim.position.y = 0.1;
    sc.add(rim);

    const mk = (geo, mat, n, color) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      if (color) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      m.count = 0;
      sc.add(m);
      return m;
    };
    this._mk = mk;
    const decal = (opts) => new THREE.MeshBasicMaterial(Object.assign({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, opts));
    const flat = (n) => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    // terrain: deep snow, ice, drifts (ramps)
    const deepTex = canvasTex(256, 256, (g, W, H) => {
      const gr = g.createRadialGradient(W / 2, H / 2, W * 0.15, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.82, 'rgba(238,246,255,0.8)'); gr.addColorStop(1, 'rgba(238,246,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) { const x = W / 2 + (Math.random() - 0.5) * W * 0.8, y = H / 2 + (Math.random() - 0.5) * H * 0.8; g.fillStyle = 'rgba(170,200,235,0.35)'; g.beginPath(); g.arc(x, y, 3 + Math.random() * 5, 0, 6.3); g.fill(); }
      g.strokeStyle = 'rgba(120,160,210,0.4)'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, W * 0.4, 0, 6.3); g.stroke();
    });
    const iceTex = canvasTex(256, 256, (g, W, H) => {
      const gr = g.createRadialGradient(W / 2, H / 2, W * 0.1, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(150,220,255,0.78)'); gr.addColorStop(0.85, 'rgba(120,200,250,0.7)'); gr.addColorStop(1, 'rgba(120,200,250,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2;
      for (let i = 0; i < 14; i++) { let x = W / 2 + (Math.random() - 0.5) * W * 0.5, y = H / 2 + (Math.random() - 0.5) * H * 0.5; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 70; g.lineTo(x, y); } g.stroke(); }
      g.strokeStyle = 'rgba(70,150,215,0.55)'; g.lineWidth = 4; g.beginPath(); g.arc(W / 2, H / 2, W * 0.42, 0, 6.3); g.stroke();
    });
    this.deepMesh = mk(flat(), decal({ map: deepTex }), NDEEP, false); this.deepMesh.position.y = 0.1; this.deepMesh.renderOrder = 1;
    this.iceMesh = mk(flat(), decal({ map: iceTex }), NICE, false); this.iceMesh.position.y = 0.14; this.iceMesh.renderOrder = 2;
    this.rampMesh = mk(new THREE.SphereGeometry(1, 14, 8, 0, 6.2832, 0, 1.5708), new THREE.MeshLambertMaterial({ color: 0xe9f4ff }), NRAMP, false);
    // storm: two counter-rotating swirl discs
    const stormTex = canvasTex(256, 256, (g, W, H) => {
      const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(235,245,255,0.35)'); gr.addColorStop(0.7, 'rgba(235,245,255,0.28)'); gr.addColorStop(1, 'rgba(235,245,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 5; g.lineCap = 'round';
      for (let k = 0; k < 9; k++) { g.beginPath(); for (let t = 0; t < 1; t += 0.05) { const ang = k * 0.7 + t * 5, rr = 20 + t * 100; const x = W / 2 + Math.cos(ang) * rr, y = H / 2 + Math.sin(ang) * rr; if (t === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
    });
    this.stormA = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), decal({ map: stormTex, opacity: 0.9 }));
    this.stormB = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), decal({ map: stormTex, opacity: 0.6 }));
    this.stormA.position.y = 0.5; this.stormB.position.y = 1.4; this.stormA.visible = this.stormB.visible = false; this.stormA.renderOrder = this.stormB.renderOrder = 6;
    sc.add(this.stormA); sc.add(this.stormB);
    // avalanche event: warning band + moving wave
    const avM = (col) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
    this.avBand = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), avM(0xff3b30)); this.avBand.position.y = 0.9; this.avBand.renderOrder = 7; this.avBand.visible = false;
    this.avWave = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), avM(0xf4fbff)); this.avWave.material.opacity = 0.85; this.avWave.renderOrder = 8; this.avWave.visible = false;
    sc.add(this.avBand); sc.add(this.avWave);
    // continuous snow grooves + snowfall
    this.trails = new Trails(sc, CAP);
    this.snowfall = new Snowfall(sc, 2400);
    // adaptive quality: 0 high, 1 medium, 2 low (frame-time EMA drives it)
    this.qLv = -1; this.qEma = 16; this.qLast = 0; this.qBad = 0; this.qGood = 0; this.fmask = 0;
    try { this.basePR = this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1; } catch (e) { this.basePR = 1; }
    this.setQuality(typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints | 0) > 0) ? 1 : 0);
    // cells (+ soft blob shadows)
    const shTex = canvasTex(64, 64, (g, W, H) => { const gr = g.createRadialGradient(W / 2, H / 2, 2, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(25,55,100,0.55)'); gr.addColorStop(0.6, 'rgba(25,55,100,0.28)'); gr.addColorStop(1, 'rgba(25,55,100,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); });
    this.shadowMesh = mk(flat(), decal({ map: shTex }), CAP, false);
    this.shadowMesh.position.y = 0.22; this.shadowMesh.renderOrder = 4;
    this.skinPool = new Map(); this.botPool = ['classic'];
    this.foodMesh = mk(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), FT, true);
    this.ejMesh = mk(new THREE.SphereGeometry(1, 9, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), 160, true);
    this.virMesh = mk(spikyGeometry(), new THREE.MeshLambertMaterial({ color: 0x9fe8ff, flatShading: true, emissive: 0x1a6a8a }), NVIR, false);
    this.pupMesh = mk(new THREE.OctahedronGeometry(1.3, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), NPUP, true);
    this.pupMesh.count = NPUP;
    { // GIZLI YUVA mounds + dark entrances (static)
      const mound = mk(new THREE.SphereGeometry(1, 14, 8, 0, 6.2832, 0, 1.5708), new THREE.MeshLambertMaterial({ color: 0xf2f8ff }), NBUR, false);
      const hole = mk(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x14203a }), NBUR, false);
      const ma = mound.instanceMatrix.array, ha = hole.instanceMatrix.array;
      for (let b = 0; b < NBUR; b++) { wm(ma, b * 16, BUR[b].x, 0, BUR[b].z, BUR_R); wm(ma, b * 16, BUR[b].x, 0, BUR[b].z, BUR_R * 1.4); ma[b * 16 + 5] = BUR_R * 0.7; wm(ha, b * 16, BUR[b].x, BUR_R * 0.7 + 0.08, BUR[b].z, BUR_IN * 1.05); }
      mound.count = hole.count = NBUR; mound.instanceMatrix.needsUpdate = hole.instanceMatrix.needsUpdate = true;
      mound.instanceMatrix.setUsage(THREE.StaticDrawUsage); hole.instanceMatrix.setUsage(THREE.StaticDrawUsage); hole.renderOrder = 3;
    }
    this.burRingM = new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    { const rg = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2); for (let b = 0; b < NBUR; b++) { const m = new THREE.Mesh(rg, this.burRingM); m.position.set(BUR[b].x, 0.35, BUR[b].z); m.scale.setScalar(BUR_R * 1.9); m.renderOrder = 4; m.frustumCulled = false; sc.add(m); } }
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x66bbff, transparent: true, opacity: 0.28, depthWrite: false }));
    this.aura.visible = false; this.aura.frustumCulled = false;
    sc.add(this.aura);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff6a6a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.visible = false; this.ring.position.y = 0.3; this.ring.frustumCulled = false;
    sc.add(this.ring);
    this.props = new ArenaProps(this, sc, this.lib, R, MAXM);
    if (this.qLv != null) this.props.setQuality([1, 0.8, 0.6][this.qLv], [12, 6, 3][this.qLv]); // quality was picked before props existed
    // name sprites
    for (const o of this.owners) {
      const cvs = document.createElement('canvas');
      cvs.width = 256; cvs.height = 64;
      const tex = new THREE.CanvasTexture(cvs);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      sp.renderOrder = 10; sp.visible = false; sp.frustumCulled = true;
      sc.add(sp);
      o.sprite = sp; o.tex = tex;
    }
    this.meRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 56).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.meRing.visible = false; this.meRing.frustumCulled = false; this.meRing.renderOrder = 6; sc.add(this.meRing);
    this.meShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a2a4a, transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
    this.meShadow.visible = false; this.meShadow.frustumCulled = false; this.meShadow.renderOrder = 5; sc.add(this.meShadow);
    this.pulseRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 56).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.pulseRing.visible = false; this.pulseRing.frustumCulled = false; this.pulseRing.renderOrder = 7; sc.add(this.pulseRing); this.pulseT = -1; this.msIdx = 0;
    {
      const gm = new THREE.MeshBasicMaterial({ color: 0xffd23a, fog: false }), cg = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.55, 0.38, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc400, side: THREE.DoubleSide, fog: false })); band.position.y = 0.19; cg.add(band);
      for (let k = 0; k < 5; k++) { const an = k * 1.2566, sp = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.6, 5), gm); sp.position.set(Math.cos(an) * 0.58, 0.66, Math.sin(an) * 0.58); cg.add(sp); const jb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xff4d6d : 0x4dd2ff, fog: false })); jb.position.set(Math.cos(an) * 0.58, 1.02, Math.sin(an) * 0.58); cg.add(jb); }
      cg.visible = false; cg.frustumCulled = false; cg.renderOrder = 11; sc.add(cg); this.crown = cg; this.king = null; this.kingId = -1;
      const bm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.6, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
      bm.visible = false; bm.frustumCulled = false; bm.renderOrder = 9; sc.add(bm); this.beam = bm;
    }
  }

  setName(o, name, isMe) {
    if (o.spriteName === name && o.isMeTag === isMe) return;
    o.name = name; o.spriteName = name; o.isMeTag = isMe;
    const cvs = o.tex.image;
    const g = cvs.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    if (isMe) {
      g.font = '900 36px "Trebuchet MS", system-ui, sans-serif';
      g.lineWidth = 10; g.strokeStyle = 'rgba(10,30,60,0.95)';
      g.strokeText(name, 128, 22, 246); g.fillStyle = '#ffe066'; g.fillText(name, 128, 22, 246);
      g.font = '900 26px system-ui, sans-serif'; g.lineWidth = 7;
      g.strokeText('\u25BC', 128, 51); g.fillStyle = '#fff7b0'; g.fillText('\u25BC', 128, 51);
    } else {
      g.font = '700 28px "Trebuchet MS", system-ui, sans-serif';
      g.lineWidth = 6; g.strokeStyle = 'rgba(10,30,60,0.6)';
      g.strokeText(name, 128, 34, 246); g.fillStyle = 'rgba(235,245,255,0.78)'; g.fillText(name, 128, 34, 246);
    }
    o.tex.needsUpdate = true;
  }

  // ---- per-player skins: one shared InstancedMesh per skin id
  validSkin(id) { return VALID_SKIN.has(id) ? id : 'classic'; }
  validTrail(id) { return VALID_TRAIL.has(id) ? id : 'classic'; }
  mySkin() { try { return this.validSkin(this.save.selected('skin')); } catch { return 'classic'; } }
  myTrail() { try { return this.validTrail(this.save.selected('trail')); } catch { return 'classic'; } }
  skinEntry(id) {
    let e = this.skinPool.get(id);
    if (e) return e;
    let skin;
    try { skin = makeSkin(id); } catch { skin = makeSkin('classic'); }
    const mesh = new THREE.InstancedMesh(skin.geometry, skin.material, CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
    if (id === 'classic') { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    this._scene.add(mesh);
    e = { skin, mesh, n: 0 }; this.skinPool.set(id, e);
    return e;
  }
  /** set a player's skin/trail ids (unknown -> classic) and the colour derived from the skin */
  setSkin(o, sk, tr) {
    o.skin = this.validSkin(sk); o.trail = this.validTrail(tr);
    this.setColor(o, SKIN_COL.get(o.skin) || 0xffffff);
  }
  botLook(o) { const P = this.botPool; this.setSkin(o, P[(Math.random() * P.length) | 0], Math.random() < 0.5 ? 'classic' : TRAILS[(Math.random() * TRAILS.length) | 0].id); }

  setColor(o, hex) {
    o.col = hex;
    this.tmpC.setHex(hex);
    o.cr = this.tmpC.r; o.cg = this.tmpC.g; o.cb = this.tmpC.b;
  }

  // ------------------------------------------------------------------ food grid
  gIdx(x, z) { return clampN(((x + R) / GS) | 0, 0, GN - 1) * GN + clampN(((z + R) / GS) | 0, 0, GN - 1); }
  gAdd(i) {
    const c = this.gIdx(this.fx[i], this.fz[i]);
    const h = this.ghead[c];
    this.fnext[i] = h; this.fprev[i] = -1;
    if (h !== -1) this.fprev[h] = i;
    this.ghead[c] = i; this.fcell[i] = c; this.fin[i] = 1;
  }
  gRemove(i) {
    if (!this.fin[i]) return;
    const p = this.fprev[i], n = this.fnext[i];
    if (p !== -1) this.fnext[p] = n; else this.ghead[this.fcell[i]] = n;
    if (n !== -1) this.fprev[n] = p;
    this.fin[i] = 0;
  }
  foodSize(v) { return (v >= 5 ? 1.35 : v >= 2 ? 0.85 : 0.62) * this.fs; }
  writeFood() { /* pellets are drawn compactly from the grid every frame (see render) */ }
  setFoodColor(i, hex) {
    this.fcol[i] = hex;
    this.tmpC.setHex(hex);
    this.fcr[i] = this.tmpC.r; this.fcg[i] = this.tmpC.g; this.fcb[i] = this.tmpC.b;
  }
  foodMark(i) { if (this.mp === 'host' && !this.fd[i]) { this.fd[i] = 1; this.fdl[this.fdn++] = i; } }
  foodPlace(i, x, z, v) {
    this.gRemove(i);
    this.fx[i] = x; this.fz[i] = z; this.fv[i] = v;
    if (v > 0) this.gAdd(i);
    this.writeFood(i);
    this.foodMark(i);
  }
  foodMove(i, x, z) {
    this.gRemove(i);
    this.fx[i] = x; this.fz[i] = z;
    this.gAdd(i);
    this.writeFood(i);
    this.foodMark(i);
  }
  baseVal(i) { return i % 60 === 0 ? 5 : 1; }
  randPos(out, pad) {
    const a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * (R - pad);
    out.x = Math.cos(a) * d; out.z = Math.sin(a) * d;
  }
  /** pellet respawn position: ~65% in a ring around a random active human (keeps the player's view ~3x denser) */
  foodPos(out) {
    if (Math.random() < 0.8) {
      const o = this.hum();
      if (o) { const a = Math.random() * 6.2832, d = 6 + Math.sqrt(Math.random()) * 110, x = o.lx + Math.cos(a) * d, z = o.lz + Math.sin(a) * d; if (x * x + z * z < (R - 4) * (R - 4)) { out.x = x; out.z = z; return; } }
    }
    this.randPos(out, 2);
  }
  hum() {
    const ow = this.owners; let n = 0, pick = null;
    for (let k = 0; k < NOWN; k++) { const o = ow[k]; if (o.alive && (k === this.me || (o.human && !o.bot))) { n++; if (Math.random() * n < 1) pick = o; } }
    return pick;
  }
  /** teleport a small single-cell bot next to (x,z) with mass m */
  placeBot(o, x, z, m) {
    for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.o === o.id) { c.x = c.tx = c.px0 = c.lsx = x; c.z = c.tz = c.pz0 = c.lsz = z; c.vx = c.vz = 0; c.m = m; c.r = KR * Math.sqrt(m); } }
    o.cx = o.lx = o.tx = x; o.cz = o.lz = o.tz = z; o.mass = m; o.wanderT = 4;
  }
  /** lively start: dense pellets + 3 bots (2 prey, 1 slight threat) close to a freshly spawned player */
  seedAround(x, z, m) {
    if (this.mp === 'client') return;
    for (let k = 0, n = 0; k < 5000 && n < 420; k++) {
      const i = (Math.random() * FOOD) | 0; if (i % 60 === 0 || this.fv[i] === 0) continue;
      const a = Math.random() * 6.2832, d = 5 + Math.sqrt(Math.random()) * 70, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (px * px + pz * pz > (R - 4) * (R - 4)) continue;
      this.foodMove(i, px, pz); n++;
    }
    for (let c = 0; c < 6; c++) { const ca = c * 1.047 + Math.random() * 0.5, cd = 14 + Math.random() * 36, qx = x + Math.cos(ca) * cd, qz = z + Math.sin(ca) * cd, hex = FOOD_PAL[(Math.random() * FOOD_PAL.length) | 0]; for (let k = 0; k < 14; k++) { const a = Math.random() * 6.2832, d = Math.random() * 5, px = qx + Math.cos(a) * d, pz = qz + Math.sin(a) * d; if (px * px + pz * pz < (R - 4) * (R - 4)) this.spawnPellet(px, pz, 2, hex); } }
    const sp = [0.5, 0.6, 0.7, 0.8, 0.55, 0.65, 1.0]; let j = 0;
    for (let k = 0; k < 40; k++) { const a = k * 0.157 + Math.random() * 0.1, d = 7 + Math.random() * 9, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; if (px * px + pz * pz < (R - 4) * (R - 4)) this.spawnPellet(px, pz, 3, [0xff4f86, 0xffc400, 0x2fd67a, 0x3fa8ff, 0xb070ff][k % 5]); }
    for (let k = 1; k < NOWN && j < 7; k++) {
      const o = this.owners[k];
      if (!o.alive || !o.bot || o.human || o.cellN !== 1) continue;
      const a = Math.random() * 6.2832, d = 24 + j * 7 + Math.random() * 8;
      this.placeBot(o, x + Math.cos(a) * d, z + Math.sin(a) * d, m * sp[j]); j++;
    }
    this.nearT = 3;
  }
  /** keep a few bots roaming near the human player */
  nearTick(dt) {
    if (this.mp === 'client' || this.state !== 'play') return;
    this.nearT = (this.nearT || 0) - dt;
    if (this.nearT > 0) return;
    this.nearT = 2.5;
    const me = this.owners[this.me];
    if (!me.alive) return;
    const early = this.time - me.t0 < 90;
    if (early && (this.strT = !this.strT)) { const ux = me.ldx || 0, uz = me.ldz || 1, hex = FOOD_PAL[(Math.random() * FOOD_PAL.length) | 0]; for (let k = 0; k < 6; k++) { const px = me.lx + ux * (16 + k * 3.2) - uz * Math.sin(k * 0.7) * 3, pz = me.lz + uz * (16 + k * 3.2) + ux * Math.sin(k * 0.7) * 3; if (px * px + pz * pz < (R - 4) * (R - 4)) this.spawnPellet(px, pz, 2, hex); } }
    if (!early && this.time - me.t0 > 60 && (this.bigT = (this.bigT || 0) + 2.5) >= 30) { // büyük lokma: rare big pellet cluster near the player
      this.bigT = 0; const ca = Math.random() * 6.2832, cd = 30 + Math.random() * 40, qx = me.lx + Math.cos(ca) * cd, qz = me.lz + Math.sin(ca) * cd, n = 5 + ((Math.random() * 3) | 0);
      for (let k = 0; k < n; k++) { const a2 = Math.random() * 6.2832, d2 = Math.random() * 9, px = qx + Math.cos(a2) * d2, pz = qz + Math.sin(a2) * d2; if (px * px + pz * pz < (R - 4) * (R - 4)) this.spawnPellet(px, pz, 20 + ((Math.random() * 21) | 0), 0xffd24a); }
      this.toast('BÜYÜK LOKMA! 🍖', 1800);
    }
    if (me.mass < 500) { const nb = Math.min(6, 1 + ((me.mass / 50) | 0)), hx = FOOD_PAL[(Math.random() * FOOD_PAL.length) | 0]; for (let k = 0; k < nb; k++) { const a1 = Math.random() * 6.2832, d1 = 8 + Math.random() * 50, px = me.lx + Math.cos(a1) * d1, pz = me.lz + Math.sin(a1) * d1; if (px * px + pz * pz < (R - 4) * (R - 4)) this.spawnPellet(px, pz, 1, hx); } } // density scales with player mass
    let near = 0, far = null, pn = 0;
    for (let k = 1; k < NOWN; k++) {
      const o = this.owners[k];
      if (!o.alive || !o.bot || o.human) continue;
      const d = Math.hypot(o.lx - me.lx, o.lz - me.lz);
      if (d < 90) { near++; if (o.mass > me.mass * 0.35 && o.mass < me.mass * 0.85 && o.cellN === 1) pn++; } else if (d > 160 && o.cellN === 1 && (!far || Math.random() < 0.3)) far = o;
    }
    if ((near >= (early ? 5 : this.time - me.t0 > 60 ? 4 : 3) && pn > 0) || !far) return;
    const a = Math.random() * 6.2832, d = 55 + Math.random() * 30, m = me.mass * (early ? 0.4 + Math.random() * 0.45 : pn === 0 ? 0.5 + Math.random() * 0.3 : 0.5 + Math.random() * 0.8);
    this.placeBot(far, me.lx + Math.cos(a) * d, me.lz + Math.sin(a) * d, Math.max(12, m));
  }
  spawnPellet(x, z, v, hex) {
    for (let k = 0; k < SPARE; k++) {
      let i = this.spareHint + k; if (i >= FT) i -= SPARE;
      if (this.fv[i] === 0) { this.fej[i] = 0; this.spareHint = i + 1 >= FT ? FOOD : i + 1; this.setFoodColor(i, hex); this.foodPlace(i, x, z, v); return i; }
    }
    return -1;
  }

  // ------------------------------------------------------------------ world init
  initWorld() {
    const p = { x: 0, z: 0 };
    this.fs = 1;
    this.genTerrain((Math.random() * 2147483647) | 0);
    this.zn.st = 0; this.zn.r = R; this.zn.next = 290 + Math.random() * 40;
    this.rain.st = 0; this.rain.next = 150 + Math.random() * 60; this.storm.on = false; this.storm.next = 35 + Math.random() * 25; this.stormA.visible = this.stormB.visible = false;
    this.wo.st = 0; this.wo.k = 0; this.wo.next = 240 + Math.random() * 120; this.dirCalm = 25; this.boss.id = -1; this.boss.next = 280 + Math.random() * 40; this.av.st = 0; this.av.next = 150 + Math.random() * 60; for (const f of this.forts) { f.own = -1; f.prog = 0; f.cand = -1; }
    this.trails.clear();
    for (let i = 0; i < FT; i++) { this.gRemove(i); this.fv[i] = 0; }
    this.ghead.fill(-1); this.fin.fill(0);
    for (let i = 0; i < FOOD; i++) {
      this.randPos(p, 2);
      const gold = i % 60 === 0;
      this.setFoodColor(i, gold ? 0xffc400 : FOOD_PAL[(Math.random() * FOOD_PAL.length) | 0]);
      this.fx[i] = p.x; this.fz[i] = p.z; this.fv[i] = this.baseVal(i);
      this.gAdd(i);
    }
    for (let i = 0; i < NVIR; i++) { this.randPos(p, 12); this.vx[i] = p.x; this.vz[i] = p.z; this.von[i] = 1; this.vt[i] = 0; }
    this.vDirty = true;
    for (let i = 0; i < NPUP; i++) { this.randPos(p, 12); this.px[i] = p.x; this.pz[i] = p.z; this.pon[i] = 1; this.ptype[i] = i === 7 || i === 23 ? 4 : i % 4; this.pt[i] = 0; this.setPupColor(i); }
    for (const c of this.cells) c.on = false;
    { const ids = SKINS.map((k) => k.id).filter((x) => x !== 'classic'); for (let i = ids.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [ids[i], ids[j]] = [ids[j], ids[i]]; } this.botPool = ['classic'].concat(ids.slice(0, 11)); }
    // bots
    const names = generateNames(NOWN, [this.nick]);
    for (let i = 0; i < NOWN; i++) {
      const o = this.owners[i];
      o.bot = i !== 0; o.human = null; o.away = false; o.alive = false; o.wasAlive = false; o.respawnT = 0; o.shield = o.magnet = o.speed = o.boostT = o.boostCd = 0;
      if (i === 0) { this.setSkin(o, this.mySkin(), this.myTrail()); this.setName(o, this.nick || 'Sen', true); } else {
        this.tmpC.setHSL((i * 0.6180339) % 1, 0.72, 0.56);
        this.setColor(o, this.tmpC.getHex()); this.botLook(o);
        this.setName(o, names[i], false);
        o.isMeTag = false;
      }
    }
    this.fdn = 0; this.fd.fill(0);
    if (this.mp !== 'client') {
      for (let i = 1; i < NOWN; i++) {
        let m = 22 * Math.exp(Math.random() * 3.4);
        if (i <= 3) m = rnd(900, 2600);
        this.spawnOwner(this.owners[i], m);
      }
      this.popTarget = this.popCenter(); this.popT = rnd(4, 9);
      const want = Math.round(this.popTarget);
      const cand = [];
      for (let i = 4; i < NOWN; i++) cand.push(i);
      for (let n = NOWN - want; n > 0 && cand.length; n--) { const j = (Math.random() * cand.length) | 0; this.removeBot(this.owners[cand[j]], false); cand.splice(j, 1); }
    }
  }

  genTerrain(seed) {
    this.seed = seed;
    const T = this.terrain;
    T.gen(seed);
    if (this.props) this.props.gen(seed);
    const w = (mesh, arr, n, h) => {
      const a = mesh.instanceMatrix.array;
      for (let i = 0; i < n; i++) wm(a, i * 16, arr[i * 3], h, arr[i * 3 + 1], arr[i * 3 + 2]);
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    };
    w(this.deepMesh, T.deep, NDEEP, 0);
    w(this.iceMesh, T.ice, NICE, 0);
    const ra = this.rampMesh.instanceMatrix.array;
    for (let i = 0; i < NRAMP; i++) { const r = T.ramp[i * 3 + 2]; wm(ra, i * 16, T.ramp[i * 3], 0, T.ramp[i * 3 + 1], r); ra[i * 16 + 5] = r * 0.45; }
    this.rampMesh.count = NRAMP; this.rampMesh.instanceMatrix.needsUpdate = true;
  }

  setPupColor(i) {
    this.tmpC.setHex(PUP_TYPES[this.ptype[i]].col);
    const a = this.pupMesh.instanceColor.array;
    a[i * 3] = this.tmpC.r; a[i * 3 + 1] = this.tmpC.g; a[i * 3 + 2] = this.tmpC.b;
    this.pupMesh.instanceColor.needsUpdate = true;
  }

  newCell(o, x, z, m) {
    for (let i = 0; i < CAP; i++) {
      const c = this.cells[i];
      if (!c.on) { c.on = true; c.o = o.id; c.x = c.tx = x; c.z = c.tz = z; c.vx = c.vz = 0; c.m = m; c.r = KR * Math.sqrt(m); c.merge = 0; c.killer = -1; c.mvx = c.mvz = 0; c.qx = c.qy = c.qz = 0; c.qw = 1; c.px0 = x; c.pz0 = z; c.lsx = x; c.lsz = z; c.rampT = 0; c.pcd = 0; c.bt = 0; return c; }
    }
    return null;
  }

  spawnOwner(o, m) {
    const p = { x: 0, z: 0 };
    for (let t = 0; t < 10; t++) {
      this.randPos(p, 25);
      let ok = !this.props.blockedAt(p.x, p.z, 4);
      for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.m > m * 0.8 && (c.x - p.x) * (c.x - p.x) + (c.z - p.z) * (c.z - p.z) < 900) { ok = false; break; } }
      if (ok) break;
    }
    if (!o.bot && o.id === this.me && this.state !== 'title' && this.mp !== 'client') {
      // fort-side spawn, but never next to a big cell (spawning beside the leader felt unfair)
      let best = -1, bx = p.x, bz = p.z;
      for (let t = 0; t < 12; t++) {
        const f = this.forts[(Math.random() * this.forts.length) | 0], a0 = Math.atan2(-f.z, -f.x) + (Math.random() - 0.5) * 1.2, dd = FR + 34, x = f.x + Math.cos(a0) * dd, z = f.z + Math.sin(a0) * dd;
        let near = 1e9;
        for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (!c.on || c.m < m * 2) continue; const sd = 45 + 5 * Math.sqrt(c.m); const d = Math.hypot(c.x - x, c.z - z) - sd; if (d < near) near = d; }
        if (near > best) { best = near; bx = x; bz = z; }
        if (near > 0) break;
      }
      p.x = bx; p.z = bz;
    }
    this.newCell(o, p.x, p.z, m);
    this.props.clearStuck(o.id);
    if (o.id === this.me) { this.titleIdx = 0; this.msIdx = 0; }
    o.away = false; o.alive = true; o.wasAlive = true; o.cellN = 1; o.mass = m; o.cx = p.x; o.cz = p.z; o.lx = p.x; o.lz = p.z;
    o.boostT = o.boostCd = o.splitCd = o.magnet = o.speed = 0; o.hideT = o.burCd = o.fleeT = 0; o.shield = o.bot ? 0 : (o.id === this.me ? 60 : 6); o.prot = !o.bot && o.id === this.me;
    o.kills = 0; o.xpRun = 0; o.t0 = this.time; o.bestRank = 99; o.maxMass = m; o.killer = -1;
    o.tx = p.x; o.tz = p.z; o.wanderT = 0; o.mag = 0;
    o.dx = Math.cos(Math.random() * 6.28); o.dz = Math.sin(Math.random() * 6.28);
    if (!o.bot && this.state !== 'title') this.seedAround(p.x, p.z, m);
    if (o.id === this.me && this.mp !== 'client' && this.state !== 'title') { this.sessT = this.time; for (let k = 4; k < NOWN; k++) { const b = this.owners[k]; if (!b.alive || !b.bot || b.human || b.cellN !== 1 || b.mass < 60 || Math.random() < 0.4) continue; const nm = 14 * Math.exp(Math.random() * 3.2); for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.o === b.id) { c.m = nm; c.r = KR * Math.sqrt(nm); } } b.mass = nm; } }
    if (o.id === this.me && this.mp !== 'client' && this.state !== 'title') this.spawnPrey(o);
    if (o.id === this.me) { this.firstEat = false; this.lastRankToast = 0; this.msDone = null; this.bigT = 0; this.rankBest = 99; }
  }

  startMass() { return 24; } // everybody starts equal (XP / level is cosmetic only)

  // ------------------------------------------------------------------ lifecycle
  start() {
    this.state = 'title';
    this.showTitle();
    this.hud.root.classList.add('ag-menu');
  }

  playSolo() {
    if (this.mp) return;
    this.deaths = 0; this.bestStreak = 0; this.kStreak = 0;
    this.state = 'play';
    this.clearScreen();
    this.hud.root.classList.remove('ag-menu');
    const o = this.owners[this.me];
    this.setName(o, this.nick || 'Sen', true);
    o.bot = false;
    this.spawnOwner(o, this.startMass());
    this.lastLevel = lvlOf(this.xp);
    this.audio?.init?.();
    this.audio?.whoosh?.();
  }

  respawnMe() {
    this.closeResult();
    if (this.hud.btns) this.hud.btns.style.display = '';
    if (this.mp === 'client') { this.net && this.net.send({ t: 'respawn' }); this.titleIdx = 0; this.msIdx = 0; this.lastMyMass = 0; this.state = 'play'; this.owners[this.me].t0 = this.time; this.owners[this.me].maxMass = 0; this.owners[this.me].bestRank = 99; return; }
    const o = this.owners[this.me];
    o.bot = false;
    this.spawnOwner(o, this.startMass());
    this.state = 'play';
    this.audio?.whoosh?.();
  }

  exit() {
    this._tok++;
    if (this.net) { try { this.net.close(); } catch { /* ignore */ } this.net = null; }
    this.stopPresence();
    this.mp = null;
    if (this.onExit) this.onExit();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { if (this.basePR && this.renderer.setPixelRatio) this.renderer.setPixelRatio(this.basePR); } catch (e) { /* ignore */ }
    clearInterval(this._brT); clearTimeout(this._tbT);
    if (this._escKey) window.removeEventListener("keydown", this._escKey);
    if (this.net) { try { this.net.close(); } catch { /* ignore */ } this.net = null; }
    this.stopPresence();
    this.unbindInput();
    if (this.hud && this.hud.root) this.hud.root.remove();
    if (this.screenEl) this.screenEl.remove();
    if (this.resultEl) this.resultEl.remove();
    this._scene.traverse((n) => {
      if (n.geometry && !(n.userData && n.userData.keepGeo)) n.geometry.dispose();
      if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); }
    });
    for (const e of this.skinPool.values()) { try { disposeSkin(e.skin); } catch (er) { /* ignore */ } }
    this.skinPool.clear();
    this.groundTex.dispose();
    this._scene.clear();
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const d = this.dom;
    this._style = d.style.touchAction;
    d.style.touchAction = 'none';
    this.onDown = (e) => {
      this.audio?.init?.();
      if (this.state !== 'play' && !this.ghost) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.stickId !== null) return;
      this.stickId = e.pointerId; this.sx = e.clientX; this.sy = e.clientY;
      try { d.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.stickMouse = e.pointerType === 'mouse';
      if (!this.stickMouse) { this.hud.stick.style.display = 'block'; this.hud.stick.style.left = this.sx + 'px'; this.hud.stick.style.top = this.sy + 'px'; this.hud.knob.style.transform = 'translate(0px,0px)'; }
      this.onMove(e);
    };
    this.onMove = (e) => {
      if (e.pointerType === 'mouse') {
        const w = d.clientWidth || 1, h = d.clientHeight || 1;
        const dx = e.clientX - w / 2, dy = e.clientY - h / 2, len = Math.hypot(dx, dy);
        this.setDir(dx, dy, len, 0.18 * Math.min(w, h));
        return;
      }
      if (e.pointerId !== this.stickId) return;
      const dx = e.clientX - this.sx, dy = e.clientY - this.sy, len = Math.hypot(dx, dy);
      this.setDir(dx, dy, len, 55);
      const k = len > 55 ? 55 / len : 1;
      this.hud.knob.style.transform = 'translate(' + dx * k + 'px,' + dy * k + 'px)';
    };
    this.onUp = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      if (e.pointerType !== 'mouse') { this.inp.mag = 0; this.hud.stick.style.display = 'none'; }
    };
    d.addEventListener('pointerdown', this.onDown);
    d.addEventListener('pointermove', this.onMove);
    d.addEventListener('pointerup', this.onUp);
    d.addEventListener('pointercancel', this.onUp);
    this.onKey = (e) => {
      const dn = e.type === 'keydown' ? 1 : 0;
      if (e.target && e.target.tagName === 'INPUT') return;
      switch (e.code) {
        case 'KeyA': case 'ArrowLeft': this.keys.l = dn; break;
        case 'KeyD': case 'ArrowRight': this.keys.r = dn; break;
        case 'KeyW': case 'ArrowUp': this.keys.u = dn; break;
        case 'KeyS': case 'ArrowDown': this.keys.d = dn; break;
        case 'KeyQ': case 'KeyF': if (dn && !e.repeat) this.doEject(); break;
        case 'Space': if (dn && !e.repeat) this.doSplit(); e.preventDefault(); break;
        case 'ShiftLeft': case 'ShiftRight': case 'KeyE': if (dn && !e.repeat) this.doBoost(); break;
        default: break;
      }
      const kx = this.keys.r - this.keys.l, kz = this.keys.d - this.keys.u;
      if (kx || kz) this.setDir(kx, kz, Math.hypot(kx, kz), 1);
      else if (this.stickId === null && dn === 0) this.inp.mag = 0;
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  unbindInput() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this.onDown);
    d.removeEventListener('pointermove', this.onMove);
    d.removeEventListener('pointerup', this.onUp);
    d.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    d.style.touchAction = this._style || '';
  }

  setDir(dx, dy, len, full) {
    const i = this.inp;
    if (len < 4 && full > 2) { i.mag = 0; return; }
    i.dx = dx / len; i.dz = dy / len;
    i.mag = clampN(len / full, 0, 1);
    if (i.mag < 0.12) i.mag = 0; else { i.ldx = i.dx; i.ldz = i.dz; }
  }

  doBoost() {
    if (this.state !== 'play') return;
    if (this.mp === 'client') { this.net && this.net.send({ t: 'b' }); return; }
    this.boost(this.owners[this.me]);
  }
  doEject() {
    if (this.state !== 'play') return;
    if (this.mp === 'client') { this.net && this.net.send({ t: 'e' }); return; }
    this.eject(this.owners[this.me]);
  }
  /** FIRLAT: each cell >= 40 mass spits a 12-mass snowball (costs 16); a pellet that hits an ice spike feeds it, 6 feeds shoot a new spike */
  eject(o) {
    if (!o.alive || o.hideT > 0 || (o.ejCd || 0) > 0) return false;
    o.ejCd = 0.12;
    const L = Math.hypot(o.ldx, o.ldz) || 1, ux = o.ldx / L, uz = o.ldz / L;
    let did = false;
    for (let i = 0; i < CAP; i++) {
      const c = this.cells[i];
      if (!c.on || c.o !== o.id || c.m < 40) continue;
      c.m -= 16; did = true;
      const d = c.r + 4, px = c.x + ux * d, pz = c.z + uz * d;
      let hit = -1;
      for (let v = 0; v < NVIR; v++) {
        if (!this.von[v]) continue;
        const rx = this.vx[v] - c.x, rz = this.vz[v] - c.z, t = rx * ux + rz * uz;
        if (t > c.r && t < c.r + 40 && Math.abs(rx * uz - rz * ux) < VIRR + 1.5) { hit = v; break; }
      }
      if (hit < 0) { if (px * px + pz * pz < (R - 3) * (R - 3)) { const pi = this.spawnPellet(px, pz, 12, o.col); if (pi >= 0) { this.fej[pi] = 1; if (this.ejList.length < 40) this.ejList.push({ i: pi, sx: c.x, sz: c.z, t: 0 }); } } if (o.id === this.me) this.floatTxt('-16', c.x, c.z, '#cfeaff'); continue; }
      this.vf[hit]++;
      if (this.vf[hit] >= 6) {
        this.vf[hit] = 0;
        for (let v = 0; v < NVIR; v++) if (!this.von[v]) {
          const nx = this.vx[hit] + ux * 16, nz = this.vz[hit] + uz * 16;
          if (nx * nx + nz * nz < (R - 6) * (R - 6)) { this.vx[v] = nx; this.vz[v] = nz; this.von[v] = 1; this.vDirty = true; if (o.id === this.me) { this.toast('DİKEN FIRLADI!', 1800); for (let k = 0; k < 6; k++) this.floatTxt('❄', nx + rnd(-14, 14), nz + rnd(-14, 14), '#bfefff'); this.snd('crash'); } }
          break;
        }
      }
    }
    if (did && (o.id === this.me || o.human === 'host')) this.audio?.pop?.(0.4, 1);
    return did;
  }
  doSplit() {
    if (this.state !== 'play') return;
    if (this.mp === 'client') { this.net && this.net.send({ t: 's' }); return; }
    this.split(this.owners[this.me]);
  }

  // ------------------------------------------------------------------ abilities
  boost(o) {
    if (o.hideT > 0) { this.burOut(o); return false; }
    if (!o.alive || o.boostCd > 0 || o.mass < 30) return false;
    for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.o === o.id) c.m = Math.max(15, c.m * 0.97); }
    o.boostT = 0.4; o.boostCd = 2.4; o.trailT = 0;
    if (o.id === this.me || o.human === 'host') this.audio?.whoosh?.();
    return true;
  }

  split(o) {
    if (!o.alive || o.hideT > 0 || o.splitCd > 0) return false;
    let n = 0;
    for (let i = 0; i < CAP; i++) if (this.cells[i].on && this.cells[i].o === o.id) this.tmpIdx[n++] = i;
    if (n >= MAXPIECES) return false;
    let did = false, total = n;
    for (let k = 0; k < n && total < MAXPIECES; k++) {
      const c = this.cells[this.tmpIdx[k]];
      if (!c.on || c.m < 40) continue;
      const half = c.m / 2;
      const nc = this.newCell(o, c.x, c.z, half);
      if (!nc) break;
      c.m = half; total++;
      nc.r = c.r;
      nc.vx = o.ldx * 30 * SPD; nc.vz = o.ldz * 30 * SPD;
      nc.merge = c.merge = 10 + Math.min(8, half * 0.004);
      did = true;
    }
    if (did) { o.splitCd = 0.3; if (o.id === this.me || o.human === 'host') this.audio?.pop?.(0.6, 1); }
    return did;
  }

  /** a ball hit something it cannot eat: leave the obstacle (n = unit normal pointing away from it, ov = overlap) and bounce back.
   *  The knockback grows with the speed into the contact (gentle when rolling, snappy on boost); squash + thud are rate limited. */
  bounceOff(c, o, nx, nz, ov, massHit) {
    c.x += nx * ov; c.z += nz * ov;
    const vin = c.vx * nx + c.vz * nz;
    if (vin < 0) { c.vx -= vin * nx; c.vz -= vin * nz; } // never keep velocity into the obstacle
    const into = -(c.mvx * nx + c.mvz * nz) - vin;
    if (into < 1.5 || c.pcd > 0) return into;
    const k = massHit === 0 ? Math.min(30, 1.5 + into * 0.7) : Math.min(70, 2.5 + into * 1.6);
    c.vx += nx * k; c.vz += nz * k;
    c.pcd = 0.3; c.bt = 0.24;
    if (massHit && into > 12 && o.shield <= 0) c.m = Math.max(12, c.m * (1 - 0.01 * clampN(into / 20, 0.5, 1.5)));
    const v = clampN(into / 30, 0.2, 0.9);
    if (c.o === this.me) { this.platform?.haptic?.('light'); if (into > 20) this.camKick = Math.max(this.camKick, 0.04); }
    if (o.human || c.o === this.me) this.sfxTo(c.o, 'bump', v);
    return into;
  }
  /** two balls of similar size (neither can eat the other) collide and bounce apart; mass-weighted */
  cellBump(ca, cb, d2, rs) {
    const d = Math.sqrt(d2) + 1e-4, nx = (cb.x - ca.x) / d, nz = (cb.z - ca.z) / d, ov = rs - d;
    const closing = ((ca.mvx + ca.vx) - (cb.mvx + cb.vx)) * nx + ((ca.mvz + ca.vz) - (cb.mvz + cb.vz)) * nz;
    const hi = Math.max(ca.m, cb.m), lo = Math.min(ca.m, cb.m);
    if (closing >= 14 && lo >= 25 && hi <= lo * 1.15 && this.state === 'play') return; // a fast clash between equals becomes a GÜREŞ duel
    const wa = cb.m / (ca.m + cb.m), wb = 1 - wa;
    this.bounceOff(ca, this.owners[ca.o], -nx, -nz, ov * wa, 0);
    this.bounceOff(cb, this.owners[cb.o], nx, nz, ov * wb, 0);
  }

  popCell(c, vi) {
    // an ice crystal shatters a big ball into pieces
    this.von[vi] = 0; this.vt[vi] = 15; this.vDirty = true;
    const o = this.owners[c.o];
    let n = 0;
    for (let i = 0; i < CAP; i++) if (this.cells[i].on && this.cells[i].o === o.id) n++;
    const k = Math.min(7, MAXPIECES - n, Math.floor(c.m / 30));
    if (k < 1) { c.m += 30; return; }
    const part = c.m / (k + 1);
    c.m = part;
    const a0 = Math.random() * 6.28;
    for (let j = 0; j < k; j++) {
      const nc = this.newCell(o, c.x, c.z, part);
      if (!nc) { c.m += part; continue; }
      const a = a0 + (j * 6.2832) / k;
      nc.vx = Math.cos(a) * 32 * SPD; nc.vz = Math.sin(a) * 32 * SPD;
      nc.merge = 12; nc.r = c.r * 0.7;
    }
    c.merge = 12;
    if (o.id === this.me || o.human === 'host') { this.audio?.crash?.(0.5); this.platform?.haptic?.('heavy'); }
    this.sfxTo(o.id, 'ice', 1);
    if (o.id !== this.me) this.snd('ice', c.x, c.z, 0.6);
  }

  applyPickup(o, type) {
    const t = PUP_TYPES[type];
    if (type === 0) o.magnet = t.t; else if (type === 1) o.shield = Math.max(o.shield, t.t); else if (type === 2) o.speed = t.t;
    else if (type === 4) { for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.o === o.id) c.m = Math.min(MAXM, c.m + 80 + c.m * 0.2); } this.pushFeed(o.name + ' altın kar tanesi aldı!'); }
    else for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.o === o.id) c.m = Math.min(MAXM, c.m * 1.3 + 10); }
    this.sfxTo(o.id, type === 4 ? 'golden' : 'chime', 1);
  }

  // ------------------------------------------------------------------ simulation (single player + host)
  simulate(dt) {
    const owners = this.owners, cells = this.cells;
    if (this.mp !== 'client') this.dirTick(dt);
    this.stormTick(dt); this.rainTick(dt);
    this.props.tick(dt);
    this.nearTick(dt);
    { const me0 = this.owners[this.me]; this.botCap = Math.max(220, 3 * (me0 && me0.alive && !me0.bot ? me0.mass : 0), 3 * (this.medHuman || 0)); }
    this.botChatTick(dt);
    if (this.mp !== 'client') { this.fortTick(dt); this.zoneTick(dt); this.duelTick(dt); }
    if (this.mp !== 'client' && this.state === 'play') this.popTick(dt);
    // local player input
    const me = owners[this.me];
    if (me.alive && this.state === 'play') {
      const i = this.inp;
      me.dx = i.dx; me.dz = i.dz; me.mag = i.mag;
      if (i.mag > 0) { me.ldx = i.dx; me.ldz = i.dz; }
    }
    // owners: timers + ai
    for (let k = 0; k < NOWN; k++) {
      const o = owners[k];
      if (o.boostT > 0) o.boostT -= dt;
      if (o.boostCd > 0) o.boostCd -= dt;
      if (o.splitCd > 0) o.splitCd -= dt;
      if (o.ejCd > 0) o.ejCd -= dt;
      if (o.shield > 0) o.shield -= dt;
      if (o.magnet > 0) o.magnet -= dt;
      if (o.speed > 0) o.speed -= dt;
      if (o.fleeT > 0) o.fleeT -= dt;
      if (o.hideT > 0) {
        if (!o.alive) o.hideT = 0;
        else { o.hideT -= dt; const hc = cells[o.bc]; if (hc && hc.on && hc.o === o.id) hc.m = Math.min(MAXM, hc.m + dt * 0.9); if (o.hideT <= 0) this.burOut(o); continue; }
      }
      if (o.burCd > 0) o.burCd -= dt;
      if (!o.alive) {
        if (o.bot && !o.human && !o.away) { o.respawnT -= dt; if (o.respawnT <= 0 && o.wasAlive === false) this.spawnOwner(o, rnd(20, 45)); }
        continue;
      }
      if (o.boss) this.bossThink(o); else if (o.preyT > this.time && o.bot && !o.human) this.preyThink(o); else if (o.bot) { o.aiT -= dt; if (o.aiT <= 0) { o.aiT = 0.18 + Math.random() * 0.1; if (this.qLv > 0 && !o.human) { const fd = Math.abs(o.lx - this.camX) + Math.abs(o.lz - this.camZ); if (fd > this.camH * 1.8 + 60) o.aiT *= 3; } this.think(o); } }
      else if (o.human && o.human !== 'host' && this.time - o.seen > 8) { this.dropHuman(o.human); }
      if (o.boostT > 0) {
        o.trailT -= dt;
        if (o.trailT <= 0) {
          o.trailT = 0.07;
          for (let i = 0; i < CAP; i++) {
            const c = cells[i];
            if (!c.on || c.o !== o.id || c.m < 20) continue;
            c.m -= 0.9;
            this.spawnPellet(c.x - o.ldx * (c.r + 0.8) + rnd(-0.4, 0.4), c.z - o.ldz * (c.r + 0.8) + rnd(-0.4, 0.4), 2, o.col);
          }
        }
      }
    }
    // movement
    const f = Math.exp(-4 * dt);
    let n = 0;
    for (let i = 0; i < CAP; i++) {
      const c = cells[i];
      if (!c.on) continue;
      const o = owners[c.o];
      if (o.hideT > 0) continue;
      if (this.duel.on && (i === this.duel.ia || i === this.duel.ib)) continue;
      this.act[n++] = i;
      const zone = this.terrain.zone(c.x, c.z);
      let sp = speedFor(c.m) * (o.speed > 0 ? 1.45 : 1) * (zone === 2 ? 0.62 : 1) * (o.preyT > this.time ? 0.72 : 1);
      let dx = o.dx, dz = o.dz, mg = o.mag;
      if (o.boostT > 0) { sp *= 2.4; dx = o.ldx; dz = o.ldz; mg = 1; }
      // ice: the velocity only slowly follows the steering (slide + momentum); everywhere else it snaps to it
      const ik = zone === 1 ? Math.min(1, dt * 0.9) : 1;
      c.mvx += (dx * sp * mg - c.mvx) * ik; c.mvz += (dz * sp * mg - c.mvz) * ik;
      if (zone === 2) c.m = Math.min(MAXM, c.m + dt * clampN(c.m * 0.003, 0.5, 5)); // deep snow: slow, but it packs on mass
      if (c.rampT > 0) c.rampT -= dt;
      if (c.bt > 0) c.bt -= dt;
      else if (this.terrain.rampAt(c.x, c.z, c.r) >= 0) {
        c.rampT = 1.2;
        const rl = Math.hypot(c.mvx, c.mvz) + 0.001;
        c.vx += (c.mvx / rl) * 55; c.vz += (c.mvz / rl) * 55;
        if (c.o === this.me) this.snd('slide', undefined, undefined, 0.9); else this.snd('slide', c.x, c.z, 0.6);
      }
      if (zone === 1 && c.o === this.me && Math.hypot(c.mvx, c.mvz) > 6) this.snd('slide');
      let vx = c.mvx + c.vx, vz = c.mvz + c.vz;
      if (c.merge <= 0 && o.cellN > 1) { const ax = o.cx - c.x, az = o.cz - c.z; const ad = Math.hypot(ax, az) + 0.01; vx += (ax / ad) * 2.5; vz += (az / ad) * 2.5; }
      c.x += vx * dt; c.z += vz * dt;
      c.vx *= f; c.vz *= f;
      if (c.merge > 0) c.merge -= dt;
      const d2 = c.x * c.x + c.z * c.z, lim = R - 1;
      if (d2 > lim * lim) { const k = lim / Math.sqrt(d2); c.x *= k; c.z *= k; }
      if (o.burCd <= 0 && c.m < BUR_M && o.cellN === 1 && this.mp !== 'client' && (!o.bot || o.fleeT > 0)) { for (let b = 0; b < NBUR; b++) { const bx = BUR[b].x - c.x, bz = BUR[b].z - c.z; if (bx * bx + bz * bz < BUR_IN * BUR_IN) { this.burIn(o, c, b); break; } } }
      if (o.bot && c.m > this.botCap * capK(o.id)) c.m -= c.m * 0.012 * dt;
      if (c.m > 400) c.m -= c.m * 0.0012 * dt; // big balls slowly shrink: growth stays gradual
      if (this.zn.st === 2 && this.mp !== 'client' && c.m > 10 && !(o.shield > 0 && o.prot)) { const zx = c.x - this.zn.cx, zz = c.z - this.zn.cz; if (zx * zx + zz * zz > this.zn.r * this.zn.r) c.m = Math.max(10, c.m - (c.m * 0.015 + 0.4) * dt); }
    }
    // cell vs cell
    const gk = Math.min(1, dt * 10);
    for (let a = 0; a < n; a++) {
      const ca = cells[this.act[a]];
      if (!ca.on) continue;
      for (let b = a + 1; b < n; b++) {
        const cb = cells[this.act[b]];
        if (!cb.on || !ca.on) continue;
        const dx = cb.x - ca.x, dz = cb.z - ca.z;
        if (dx > 150 || dx < -150 || dz > 150 || dz < -150) continue;
        const d2 = dx * dx + dz * dz, rs = ca.r + cb.r;
        if (d2 >= rs * rs) continue;
        if (ca.o === cb.o) {
          if (ca.merge > 0 || cb.merge > 0) {
            const d = Math.sqrt(d2) + 0.001, push = (rs - d) * 0.5 * gk;
            const nx = dx / d, nz = dz / d;
            ca.x -= nx * push; ca.z -= nz * push; cb.x += nx * push; cb.z += nz * push;
          } else if (d2 < Math.pow(Math.max(ca.r, cb.r) * 0.6, 2)) {
            if (ca.m >= cb.m) { ca.m = Math.min(MAXM, ca.m + cb.m); cb.on = false; } else { cb.m = Math.min(MAXM, cb.m + ca.m); ca.on = false; }
            this.sfxTo(ca.o, 'merge', 0.8);
          }
          continue;
        }
        { const oa = owners[ca.o], ob = owners[cb.o]; if (oa.boss || ob.boss) { this.bossContact(oa.boss ? ca : cb, oa.boss ? cb : ca, d2); continue; } }
        if (this.mp !== 'client' && !this.duel.on && this.duel.cd <= 0 && this.duelTry(ca, cb, d2)) continue;
        // EAT_K: how much heavier you must be to eat (was 1.25 — with the bounce that read as "I can't eat it, we just collide")
        if (ca.m > cb.m * EAT_K && d2 < Math.pow(ca.r - cb.r * 0.25, 2)) this.eatCell(ca, cb);
        else if (cb.m > ca.m * EAT_K && d2 < Math.pow(cb.r - ca.r * 0.25, 2)) this.eatCell(cb, ca);
        // near-equal balls just pass through each other (agar.io) — bumping them read as "we can't eat each other, we only collide"
      }
    }
    // food, crystals, power-ups
    for (let a = 0; a < n; a++) {
      const c = cells[this.act[a]];
      if (!c.on) continue;
      const o = owners[c.o];
      const pull = o.magnet > 0 ? 14 : 0, reach = c.r + pull;
      const gx0 = clampN(((c.x - reach + R) / GS) | 0, 0, GN - 1), gx1 = clampN(((c.x + reach + R) / GS) | 0, 0, GN - 1);
      const gz0 = clampN(((c.z - reach + R) / GS) | 0, 0, GN - 1), gz1 = clampN(((c.z + reach + R) / GS) | 0, 0, GN - 1);
      const r2 = c.r * c.r, p2 = reach * reach;
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          let i = this.ghead[gx * GN + gz];
          while (i !== -1) {
            const nx = this.fnext[i];
            const dx = this.fx[i] - c.x, dz = this.fz[i] - c.z, d2 = dx * dx + dz * dz;
            if (d2 < r2) {
              const v = this.fv[i];
              let pv = o.bot ? v * (this.time - this.sessT < 150 ? 0.5 : this.time - this.sessT < 240 ? 0.75 : 1) : v;
              if (o.bot && c.m > this.botCap * capK(o.id)) pv *= 0.1;
              for (const f of this.forts) if (f.pa > 0.5 && f.pc === c.o) { const px = this.fx[i] - f.x, pz = this.fz[i] - f.z; if (px * px + pz * pz < PAINT_R * PAINT_R) { pv *= 1.2; break; } }
              c.m = Math.min(MAXM, c.m + pv); o.xpRun += v;
              if (c.o === this.me) { this.snd('pellet'); if (!this.firstEat && this.state === 'play') { this.firstEat = true; this.toast('İLK YEMEK! 🎉'); this.audio?.milestone?.(1); } }
              if (i < FOOD) { const p = this.tmpP || (this.tmpP = { x: 0, z: 0 }); this.foodPos(p); this.foodPlace(i, p.x, p.z, this.baseVal(i)); } else this.foodPlace(i, 0, 0, 0);
            } else if (pull && d2 < p2) {
              const dd = Math.sqrt(d2), st = Math.min(dd - c.r * 0.5, 30 * dt);
              if (st > 0) this.foodMove(i, this.fx[i] - (dx / dd) * st, this.fz[i] - (dz / dd) * st);
            }
            i = nx;
          }
        }
      }
      this.props.interact(c, this.act[a], o, dt);
      if (c.m < VIR_MIN && !o.boss) {
        // an ice spike this ball is too small to shatter is a solid obstacle: push out + knock back
        for (let v = 0; v < NVIR; v++) {
          if (!this.von[v]) continue;
          const dx = c.x - this.vx[v], dz = c.z - this.vz[v], lim = c.r + VIRR * 0.95, d2 = dx * dx + dz * dz;
          if (d2 >= lim * lim) continue;
          const d = Math.sqrt(d2) + 1e-4;
          this.bounceOff(c, o, dx / d, dz / d, lim - d, 0);
        }
      }
      if (c.m >= VIR_MIN && o.shield <= 0 && !o.boss) {
        for (let v = 0; v < NVIR; v++) {
          if (!this.von[v]) continue;
          const dx = this.vx[v] - c.x, dz = this.vz[v] - c.z, lim = c.r - 0.9;
          if (dx * dx + dz * dz < lim * lim) { this.popCell(c, v); break; }
        }
      }
      if (!o.bot) {
        for (let p = 0; p < NPUP; p++) {
          if (!this.pon[p]) continue;
          const dx = this.px[p] - c.x, dz = this.pz[p] - c.z, lim = c.r + 1.4;
          if (dx * dx + dz * dz < lim * lim) { this.pon[p] = 0; this.pt[p] = 18; this.applyPickup(o, this.ptype[p]); }
        }
      }
    }
    for (let v = 0; v < NVIR; v++) if (!this.von[v]) { this.vt[v] -= dt; if (this.vt[v] <= 0) { const p = this.tmpP || (this.tmpP = { x: 0, z: 0 }); this.randPos(p, 12); this.vx[v] = p.x; this.vz[v] = p.z; this.von[v] = 1; this.vDirty = true; } }
    for (let p = 0; p < NPUP; p++) if (!this.pon[p]) { this.pt[p] -= dt; if (this.pt[p] <= 0) { const q = this.tmpP || (this.tmpP = { x: 0, z: 0 }); this.randPos(q, 12); this.px[p] = q.x; this.pz[p] = q.z; this.ptype[p] = Math.random() < 0.04 ? 4 : (Math.random() * 4) | 0; this.pon[p] = 1; this.setPupColor(p); } }
  }

  // ------------------------------------------------------------------ GİZLİ YUVA
  burIn(o, c, b) {
    o.hideT = BUR_T; o.bur = b; o.boostT = 0; o.fleeT = 0;
    c.x = BUR[b].x; c.z = BUR[b].z; c.mvx = c.mvz = c.vx = c.vz = 0; o.cx = o.lx = c.x; o.cz = o.lz = c.z; o.bc = this.cells.indexOf(c);
    if (o.id === this.me) { this.toast('YUVADASIN! HIZLAN ile çık'); this.snd('slide', undefined, undefined, 0.8); } else this.snd('slide', c.x, c.z, 0.5);
  }
  burOut(o) {
    const B = BUR[o.bur >= 0 ? o.bur : 0], a = Math.random() * 6.2832, ca = Math.cos(a), sa = Math.sin(a);
    o.hideT = 0; o.burCd = BUR_CD;
    for (let i = 0; i < CAP; i++) {
      const c = this.cells[i];
      if (!c.on || c.o !== o.id) continue;
      c.x = B.x + ca * (BUR_R + c.r + 1); c.z = B.z + sa * (BUR_R + c.r + 1); c.vx = ca * 28; c.vz = sa * 28; c.mvx = c.mvz = 0; c.px0 = c.x; c.pz0 = c.z; c.lsx = c.x; c.lsz = c.z;
    }
    if (o.id === this.me) this.snd('tick', undefined, undefined, 0.7); else this.snd('tick', B.x, B.z, 0.5);
  }

  // ------------------------------------------------------------------ sound / events
  /** arena sound; x,z = world position of the event (distance-attenuated), none = own sound at full volume */
  snd(kind, x, z, k) {
    const a = this.audio;
    if (!a || !a.arena) return;
    let v = k === undefined ? 1 : k;
    if (x !== undefined) v *= clampN(1 - Math.hypot(x - this.camX, z - this.camZ) / (this.camH * 1.3 + 40), 0, 1);
    if (v > 0.04) { if (kind === 'bump') a.bump?.(v); else a.arena(kind, v); }
  }
  /** an event that belongs to one owner: local sound, a message to the remote human, or a faint positional sound for bots */
  sfxTo(id, kind, v, x, z) {
    const o = this.owners[id];
    if (!o) return;
    if (id === this.me) { if (kind === 'chime') this.audio?.chime?.(); else this.snd(kind, undefined, undefined, v); } else if (o.human && o.human !== 'host') { if (this.net) this.net.sendTo(o.human, { t: 'sfx', k: kind, v }); } else if (x !== undefined) this.snd(kind, x, z, 0.5);
  }

  // ------------------------------------------------------------------ small prey bots near the player (first-minute 'hunt' moment)
  spawnPrey(me) {
    const cand = [];
    for (let k = 4; k < NOWN; k++) { const b = this.owners[k]; if (b.alive && b.bot && !b.human && !b.boss && b.cellN === 1 && b.hideT <= 0 && b.mass < 400) cand.push(b); }
    const want = Math.min(3, cand.length);
    for (let n = 0; n < want; n++) {
      const b = cand.splice((Math.random() * cand.length) | 0, 1)[0];
      const a = (n / 3) * 6.2832 + Math.random() * 1.2, d = 24 + Math.random() * 28, x = me.cx + Math.cos(a) * d, z = me.cz + Math.sin(a) * d, nm = 9 + Math.random() * 4;
      const k2 = x * x + z * z > (R - 8) * (R - 8) ? (R - 8) / Math.hypot(x, z) : 1, px = x * k2, pz = z * k2;
      for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.o === b.id) { c.x = c.tx = px; c.z = c.tz = pz; c.px0 = c.lsx = px; c.pz0 = c.lsz = pz; c.m = nm; c.r = KR * Math.sqrt(nm); c.vx = c.vz = 0; } }
      b.mass = nm; b.cx = b.lx = px; b.cz = b.lz = pz; b.preyT = this.time + 25; b.shield = 0;
      if (n === 0) { b.realName = b.name; this.setName(b, '🎯 av', false); b.name = b.realName; b.hiT = this.time + 25; }
    }
    if (want) this.toast('Küçükleri ye!');
  }
  preyThink(o) {
    const me = this.owners[this.me];
    if (o.wanderT <= 0 || Math.hypot(o.tx - o.lx, o.tz - o.lz) < 5) { o.wanderT = 2 + Math.random() * 2; const a = Math.random() * 6.2832, d = 18 + Math.random() * 34; o.tx = me.cx + Math.cos(a) * d; o.tz = me.cz + Math.sin(a) * d; }
    o.wanderT -= 0.016;
    const dx = o.tx - o.lx, dz = o.tz - o.lz, dl = Math.hypot(dx, dz) + 0.001;
    o.dx = dx / dl; o.dz = dz / dl; o.mag = 0.7; o.ldx = o.dx; o.ldz = o.dz;
    if (o.hiT && this.time > o.hiT) { o.hiT = 0; this.setName(o, o.realName, false); }
  }

  // ------------------------------------------------------------------ MEVSIM BOSS TOPU (host-authoritative; rammed at boost speed it takes hits, then drops a pellet shower)
  bossTick(dt) {
    const b = this.boss;
    if (this.mp === 'client' || this.state !== 'play') return;
    if (b.id < 0) { b.next -= dt; if (b.next <= 0 && this.dirOk()) this.spawnBoss(); return; }
    const o = this.owners[b.id];
    if (!o || !o.boss || !o.alive) { this.endBoss(false); return; }
    b.t += dt; if (b.hitCd > 0) b.hitCd -= dt;
    o.shield = 0;
    for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.o === o.id) c.m = BOSSM; }
    if (b.t > 170) { this.pushFeed('BOSS TOPU kayboldu...'); this.endBoss(false); }
  }
  spawnBoss() {
    const b = this.boss; let o = null;
    for (let i = NOWN - 1; i >= 4 && !o; i--) { const q = this.owners[i]; if (q.bot && !q.human && q.away) o = q; }
    for (let i = NOWN - 1; i >= 4 && !o; i--) { const q = this.owners[i]; if (q.bot && !q.human && i !== this.me) o = q; }
    if (!o) { b.next = 30; return; }
    if (!o.away) this.removeBot(o, false);
    const me = this.owners[this.me], p = { x: 0, z: 0 };
    for (let t = 0; t < 12; t++) { this.randPos(p, 90); if (!me.alive || Math.hypot(p.x - me.cx, p.z - me.cz) > 260) break; }
    this.setColor(o, 0x7a3cff); this.setName(o, '👑💀 BOSS TOPU', false);
    this.newCell(o, p.x, p.z, BOSSM);
    o.boss = true; o.bot = true; o.human = null; o.away = false; o.alive = true; o.wasAlive = true; o.cellN = 1; o.mass = BOSSM; o.cx = o.lx = p.x; o.cz = o.lz = p.z; o.shield = 0; o.preyT = 0; o.hideT = 0;
    o.dx = 0; o.dz = 1; o.mag = 0; o.tx = p.x; o.tz = p.z; o.wanderT = 0; o.aiT = 0;
    b.id = o.id; b.t = 0; b.hitCd = 0; b.max = b.hp = 12 + 4 * (this.net ? this.net.clients.size : 0);
    this.dirCalm = 40;
    this.toast('BOSS TOPU GELİYOR!'); this.pushFeed('BOSS TOPU geldi! HIZLAN ile çarp, küçükleri yutar'); this.audio?.milestone?.(5);
    if (this.net) this.net.broadcast({ t: 'own', i: o.id, n: o.name, c: o.col, h: 0, sk: o.skin, tr: o.trail });
  }
  endBoss() {
    const b = this.boss, o = this.owners[b.id];
    b.id = -1; b.next = 270 + Math.random() * 60; this.dirCalm = 40;
    if (o) { o.boss = false; this.removeBot(o, false); }
  }
  bossThink(o) {
    o.aiT -= 0.016; if (o.aiT > 0) return; o.aiT = 0.25;
    let best = null, bd = 190;
    for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (!c.on || c.o === o.id || c.m * 1.25 > BOSSM) continue; const ow = this.owners[c.o]; if (ow.hideT > 0) continue; const d = Math.hypot(c.x - o.lx, c.z - o.lz) + (ow.bot ? 40 : 0); if (d < bd) { bd = d; best = c; } }
    if (best) { o.tx = best.x; o.tz = best.z; }
    else { o.wanderT -= 0.25; if (o.wanderT <= 0 || Math.hypot(o.tx - o.lx, o.tz - o.lz) < 20) { const p = this.tmpP || (this.tmpP = { x: 0, z: 0 }); this.randPos(p, 90); o.tx = p.x; o.tz = p.z; o.wanderT = 10; } }
    const dx = o.tx - o.lx, dz = o.tz - o.lz, dl = Math.hypot(dx, dz) + 0.001;
    o.dx = dx / dl; o.dz = dz / dl; o.mag = best ? 0.9 : 0.5; o.ldx = o.dx; o.ldz = o.dz;
  }
  bossContact(B, X, d2) {
    const ox = this.owners[X.o], b = this.boss, d = Math.sqrt(d2) + 0.001, nx = (X.x - B.x) / d, nz = (X.z - B.z) / d;
    if (ox.hideT > 0) return;
    if (!ox.bot && ox.boostT > 0 && X.m >= 12) {
      if (b.hitCd > 0) return;
      b.hitCd = 0.7; b.hp--; ox.boostT = 0; X.vx += nx * 75; X.vz += nz * 75; ox.xpRun += 4;
      this.sfxTo(X.o, 'crash', 0.9, X.x, X.z);
      if (X.o === this.me) this.toast('VURDUN! ' + Math.max(0, b.hp) + ' kaldı');
      if (b.hp <= 0) this.defeatBoss(B, ox);
      return;
    }
    if (ox.boostT > 0) return;
    if (d2 < Math.pow(B.r - X.r * 0.4, 2) && ox.shield <= 0) this.eatCell(B, X);
    else { const rs = B.r + X.r, push = (rs - d) * 0.6; X.x += nx * push; X.z += nz * push; }
  }
  defeatBoss(B, killer) {
    const cols = [0xffd35a, 0xff4f86, 0xb070ff, 0x3fa8ff, 0x2fd67a, 0xffffff];
    for (let k = 0; k < 260; k++) { const a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * (B.r * 1.5 + 14); this.spawnPellet(B.x + Math.cos(a) * d, B.z + Math.sin(a) * d, 6, cols[k % cols.length]); }
    killer.kills++; killer.xpRun += 120;
    this.pushFeed('BOSS DÜŞTÜ! ' + killer.name + ' son vuruşu yaptı - peletler herkese!');
    if (killer.id === this.me) { this.toast('BOSS DÜŞTÜ! Peletleri topla'); this.audio?.milestone?.(6); } else this.sfxTo(killer.id, 'chime', 1);
    this.endBoss();
  }
  bossHud() {
    const el = this.hud && this.hud.bb; if (!el) return;
    const b = this.boss, on = b.id >= 0 && this.state === 'play';
    if (!on) { if (el._on) { el.style.display = 'none'; el._on = 0; } return; }
    if (!el._on) { el.style.display = 'block'; el._on = 1; el._k = ''; }
    const k = b.hp + '/' + b.max;
    if (k !== el._k) { el._k = k; el.lastChild.firstChild.style.width = Math.max(0, Math.round(100 * b.hp / Math.max(1, b.max))) + '%'; }
  }

  // ------------------------------------------------------------------ event director: one big event at a time, >= 40 s calm between them
  evBusy() { return this.boss.id >= 0 || this.av.st > 0 || this.rain.st > 0 || this.zn.st > 0 || this.storm.on || this.wo.st > 0; }
  dirOk() { return this.dirCalm <= 0 && !this.evBusy(); }
  dirTick(dt) { if (this.state !== 'play') return; if (this.evBusy()) this.dirCalm = 40; else if (this.dirCalm > 0) this.dirCalm -= dt; }
  // ------------------------------------------------------------------ GORUS FIRTINASI (whiteout blizzard; host-authoritative state, local fog)
  woTick(dt) {
    const w = this.wo;
    if (this.mp === 'client') { if (w.st > 0) w.t = Math.max(0, w.t - dt); }
    else if (this.state === 'play') {
      if (w.st === 0) {
        w.next -= dt;
        if (w.next <= 0 && this.dirOk()) { w.st = 1; w.t = 5; this.dirCalm = 40; this.toast('BEYAZ FIRTINA GELİYOR!'); this.pushFeed('Beyaz fırtına geliyor! Görüş düşecek, pusuya dikkat'); this.audio?.arena?.('storm', 0.8); }
      } else {
        w.t -= dt;
        if (w.st === 1 && w.t <= 0) { w.st = 2; w.t = 25; this.audio?.arena?.('storm', 1); }
        else if (w.st === 2 && w.t <= 0) { w.st = 0; w.next = 240 + Math.random() * 120; this.dirCalm = 40; this.pushFeed('Beyaz fırtına dindi'); }
      }
    } else if (w.st) { w.st = 0; }
    const tgt = w.st === 2 ? (w.t < 2.5 ? Math.max(0, w.t / 2.5) : 1) : w.st === 1 ? 0.3 : 0;
    w.k += (tgt - w.k) * Math.min(1, dt * 1.6);
    const el = this.hud?.wo; if (!el) return;
    const k = this.qLv === 2 ? Math.round(w.k * 10) / 10 : Math.round(w.k * 50) / 50;
    if (k !== el._k) {
      el._k = k; el.style.opacity = k > 0.01 ? String(k) : '0';
      if (k > 0.01 && !el._r) { /* radius (px) set per frame below */ }
    }
    if (w.k > 0.01) {
      const r = Math.round(Math.min(this.sz.x, this.sz.y) * 0.2 + 30 * (1 - w.k) * 0 + 40 * (1 - w.k));
      if (r !== el._rr) { el._rr = r; el.style.background = 'radial-gradient(circle at 50% 50%, rgba(232,242,255,0) 0, rgba(232,242,255,0) ' + r + 'px, rgba(232,242,255,0.78) ' + Math.round(r * 1.7) + 'px, rgba(240,247,255,0.97) ' + Math.round(r * 2.6) + 'px)'; }
    }
  }
  /** world radius a player can see during whiteout (0 = no limit) */
  woVis() { return this.wo.k > 0.35 ? Math.max(40, this.camH * 0.55) / (0.4 + this.wo.k * 0.6) : 0; }

  // ------------------------------------------------------------------ pellet rain (PELET YAĞMURU)
  rainTick(dt) {
    const r = this.rain;
    if (this.mp === 'client' || this.state !== 'play') return;
    if (r.st === 0) {
      r.next -= dt;
      if (r.next <= 0 && this.dirOk()) { const a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * (R - 140); r.x = Math.cos(a) * d; r.z = Math.sin(a) * d; r.st = 1; r.t = 5; this.toast('PELET YAĞMURU GELİYOR!'); this.pushFeed('Pelet yağmuru geliyor! Haritadaki işarete koş'); this.audio?.milestone?.(2); }
      return;
    }
    r.t -= dt;
    if (r.st === 1) { if (r.t <= 0) { r.st = 2; r.t = 8; r.acc = 0; this.toast('PELETLER YAĞIYOR!'); } return; }
    r.acc += dt * 45;
    const hex = [0xff4f86, 0xffc400, 0x2fd67a, 0x3fa8ff, 0xb070ff];
    while (r.acc >= 1) { r.acc--; const a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * 65; this.spawnPellet(r.x + Math.cos(a) * d, r.z + Math.sin(a) * d, 6, hex[(Math.random() * 5) | 0]); }
    if (r.t <= 0) { r.st = 0; r.next = 150 + Math.random() * 60; }
  }
  // ------------------------------------------------------------------ snow storm
  stormTick(dt) {
    const s = this.storm;
    if (!s.on) {
      s.next -= dt;
      if (s.next <= 0 && this.state === 'play' && this.dirOk()) {
        s.on = true; s.t = 38; s.x = rnd(-80, 80); s.z = rnd(-80, 80);
        const a = Math.random() * 6.2832; s.dx = Math.cos(a) * 16; s.dz = Math.sin(a) * 16;
        this.pushFeed('❄ Kar fırtınası başladı! Yemler savruluyor');
      }
      return;
    }
    s.t -= dt; s.x += s.dx * dt; s.z += s.dz * dt;
    if (Math.hypot(s.x, s.z) > R - 60) { s.dx = -s.dx; s.dz = -s.dz; }
    // scatter pellets that sit inside the storm
    const n = Math.ceil(dt * 220), p = this.tmpP || (this.tmpP = { x: 0, z: 0 });
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * s.r;
      const gx = clampN(((s.x + Math.cos(a) * d + R) / GS) | 0, 0, GN - 1), gz = clampN(((s.z + Math.sin(a) * d + R) / GS) | 0, 0, GN - 1);
      const i = this.ghead[gx * GN + gz];
      if (i === -1 || i >= FOOD) continue;
      p.x = this.fx[i] + rnd(-48, 48); p.z = this.fz[i] + rnd(-48, 48);
      const e = Math.hypot(p.x, p.z); if (e > R - 3) { p.x *= (R - 3) / e; p.z *= (R - 3) / e; }
      this.foodMove(i, p.x, p.z);
    }
    for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && (c.x - s.x) * (c.x - s.x) + (c.z - s.z) * (c.z - s.z) < s.r * s.r) { c.vx += s.dx * 0.8 * dt; c.vz += s.dz * 0.8 * dt; } }
    if (s.t <= 0) { s.on = false; s.next = 80 + Math.random() * 60; }
  }

  /** BUZ ÇEMBERİ: every ~5 min the playable circle shrinks toward a glowing centre for 60 s (host-authoritative) */
  zoneTick(dt) {
    const z = this.zn;
    if (z.st === 0) {
      z.next -= dt;
      if (z.next <= 0 && this.state === 'play' && this.dirOk()) {
        z.st = 1; z.t = 8; z.rt = R * 0.42; const a = Math.random() * 6.2832, d = Math.random() * R * 0.3; z.cx = Math.cos(a) * d; z.cz = Math.sin(a) * d; z.r = R;
        this.pushFeed('❄ BUZ ÇEMBERİ! Çember daralıyor'); this.audio?.milestone?.(3);
      }
      return;
    }
    const sm = (k) => k * k * (3 - 2 * k);
    if (z.st === 1) { z.t -= dt; z.r = R; if (z.t <= 0) { z.st = 2; z.t = 0; } return; }
    z.t += dt;
    if (z.t < 12) z.r = R - (R - z.rt) * sm(z.t / 12);
    else if (z.t < 48) z.r = z.rt;
    else if (z.t < 60) z.r = z.rt + (R - z.rt) * sm((z.t - 48) / 12);
    else { z.st = 0; z.r = R; z.next = 270 + Math.random() * 60; this.pushFeed('Buz çemberi çözüldü'); }
  }

  buildZone() {
    const sc = this._scene, z = this.zn, D = THREE.DoubleSide;
    const bm = (col, op) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, fog: false, side: D, blending: THREE.AdditiveBlending });
    z.ring = new THREE.Mesh(new THREE.RingGeometry(0.982, 1, 128).rotateX(-Math.PI / 2), bm(0x66f6ff, 0.95)); z.ring.position.y = 0.7;
    z.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 34, 128, 1, true), bm(0x66d8ff, 0.1)); z.wall.position.y = 17;
    z.out = new THREE.Mesh(new THREE.RingGeometry(1, 3, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1b3a8a, transparent: true, opacity: 0.12, depthWrite: false, fog: false })); z.out.position.y = 0.55; z.out.renderOrder = 5;
    z.tgt = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128).rotateX(-Math.PI / 2), bm(0xff5a4d, 0.9)); z.tgt.position.y = 0.75;
    z.beam = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 140, 16, 1, true), bm(0xfff09a, 0.38)); z.beam.position.y = 70;
    z.glow = new THREE.Mesh(new THREE.CircleGeometry(24, 40).rotateX(-Math.PI / 2), bm(0xffe680, 0.5)); z.glow.position.y = 0.8;
    for (const m of [z.ring, z.wall, z.out, z.tgt, z.beam, z.glow]) { m.visible = false; m.frustumCulled = false; sc.add(m); }
  }

  // ------------------------------------------------------------------ avalanche event (CIG OLAYI)
  avStart(a, off, broadcast) {
    const v = this.av; v.st = 1; v.t = 5; v.a = a; v.off = off; v.id++; v.rum = 0; v.meHit = false;
    this.pushFeed('🏔 ÇIĞ GELİYOR! Kristal arkasına ya da derin kara saklan');
    this.audio?.arena?.('storm', 0.9);
    if (broadcast && this.mp === 'host' && this.net) this.net.broadcast({ t: 'av', a, o: off });
  }
  avHidden(c, x, z, r, m) {
    if (x !== undefined) { c.x = x; c.z = z; c.r = r; c.m = m; }
    if (c.m < VIR_MIN) for (let v = 0; v < NVIR; v++) if (this.von[v] && Math.hypot(this.vx[v] - c.x, this.vz[v] - c.z) < c.r + 9) return true;
    return c.m < 500 && this.terrain.zone(c.x, c.z) === 2;
  }
  avTick(dt) {
    const v = this.av, client = this.mp === 'client';
    if (v.st === 0) {
      if (client || this.state !== 'play') return;
      v.next -= dt;
      if (v.next <= 0 && this.dirOk()) this.avStart(rnd(0, 3.1416), rnd(-R * 0.45, R * 0.45), true);
      return;
    }
    v.t -= dt;
    const dxn = Math.cos(v.a), dzn = Math.sin(v.a), nx = -dzn, nz = dxn;
    if (v.st === 1) {
      v.rum -= dt; if (v.rum <= 0) { v.rum = 1; this.audio?.arena?.('storm', 0.6); }
      if (v.t <= 0) { v.st = 2; v.t = 6; this.audio?.arena?.('storm', 1); }
      return;
    }
    v.rum -= dt; if (v.rum <= 0) { v.rum = 0.7; this.audio?.arena?.('storm', 1); }
    const s = -R - 40 + (6 - v.t) / 6 * (2 * R + 80);
    v.s = s;
    if (!client) {
      for (let i = 0; i < CAP; i++) {
        const c = this.cells[i];
        if (!c.on || c.avId === v.id || this.owners[c.o].hideT > 0) continue;
        const ps = (c.x * dxn + c.z * dzn) - s, pn = c.x * nx + c.z * nz - v.off;
        if (Math.abs(ps) > 32 || Math.abs(pn) > v.w) continue;
        c.avId = v.id;
        if (this.avHidden(c)) continue;
        const lost = c.m * 0.35; c.m -= lost;
        const o = this.owners[c.o], k = Math.min(10, Math.ceil(lost / 5));
        for (let q = 0; q < k; q++) this.spawnPellet(c.x + rnd(-c.r, c.r) * 1.5, c.z + rnd(-c.r, c.r) * 1.5, lost / k, o ? o.col : 0xffffff);
        if (c.o === this.me) { v.meHit = true; this.snd('crash'); this.toast('ÇIĞ vurdu! -%35'); } else if (o && !o.bot) this.sfxTo(c.o, 'crash', 1);
      }
    }
    if (v.t <= 0) {
      v.st = 0; v.next = 180 + Math.random() * 60;
      if (!v.meHit && this.owners[this.me]?.alive) meta.stamp?.('avalanche'); // Kış Pasaportu: survived the avalanche
    }
  }

  // ------------------------------------------------------------------ chat
  cleanChat(t) {
    t = String(t || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!t) return '';
    return t.split(' ').map((w) => (BAD.has(w.toLocaleLowerCase('tr').replace(/[^a-zçğıöşü0-9]/g, '')) ? '*'.repeat(Math.min(5, w.length)) : w)).join(' ');
  }
  chatAdd(name, col, text) {
    const L = this.chatLog;
    L.push({ n: name, c: col, x: text, until: this.time + 9 });
    if (L.length > 6) L.shift();
    this.chatDirty = true;
    this.snd('tick');
  }
  /** the local player types / taps a phrase */
  sendChat(text) {
    text = this.cleanChat(text);
    if (!text || !this.mp) return;
    if (this.time - this.lastChat < 1.2) { this.toast('Yavaş yaz!'); return; }
    this.lastChat = this.time;
    if (this.mp === 'client') this.net && this.net.send({ t: 'chat', x: text });
    else this.hostChat(this.owners[this.me], text);
  }
  hostChat(o, text) {
    text = this.cleanChat(text);
    if (!text) return;
    if (o.id !== this.me) { if (this.time - (o.chatAt || -9) < 1) return; o.chatAt = this.time; }
    this.chatAdd(o.name, o.col, text);
    if (this.net) this.net.broadcast({ t: 'chat', n: o.name, c: o.col, x: text });
  }
  botChatTick(dt) {
    if (this.state !== 'play') return;
    this.botChatT -= dt;
    if (this.botChatT > 0) return;
    this.botChatT = 14 + Math.random() * 30;
    const bots = [];
    for (let k = 1; k < NOWN; k++) { const o = this.owners[k]; if (o.bot && !o.human && o.alive) bots.push(o); }
    if (!bots.length) return;
    const o = bots[(Math.random() * bots.length) | 0];
    this.chatAdd(o.name, o.col, BOT_CHAT[(Math.random() * BOT_CHAT.length) | 0]);
    if (this.net) this.net.broadcast({ t: 'chat', n: o.name, c: o.col, x: this.chatLog[this.chatLog.length - 1].x });
  }

  // KARTOPU GÜREŞİ: similar-mass head-on collision -> 6 s ring duel (host-authoritative)
  duelTry(ca, cb, d2) {
    const oa = this.owners[ca.o], ob = this.owners[cb.o];
    if (this.state !== 'play' || oa.shield > 0 || ob.shield > 0 || oa.hideT > 0 || ob.hideT > 0 || oa.boss || ob.boss) return false;
    const hi = Math.max(ca.m, cb.m), lo = Math.min(ca.m, cb.m);
    if (lo < 25 || hi > lo * 1.15) return false;
    const rs = ca.r + cb.r; if (d2 > rs * rs * 0.7) return false;
    const d = Math.sqrt(d2) + 0.001, nx = (cb.x - ca.x) / d, nz = (cb.z - ca.z) / d;
    const rv = ((ca.mvx + ca.vx) - (cb.mvx + cb.vx)) * nx + ((ca.mvz + ca.vz) - (cb.mvz + cb.vz)) * nz;
    if (rv < 14) return false;
    if (!oa.human && !ob.human && oa.id !== this.me && ob.id !== this.me && Math.random() < 0.6) { this.duel.cd = 6; return false; }
    const D = this.duel;
    D.on = true; D.a = ca.o; D.b = cb.o; D.ia = this.cells.indexOf(ca); D.ib = this.cells.indexOf(cb);
    D.cx = (ca.x + cb.x) / 2; D.cz = (ca.z + cb.z) / 2; D.nx = nx; D.nz = nz; D.r = (ca.r + cb.r) * 1.15 + 7; D.s = 0; D.t = 6; D.bt[0] = D.bt[1] = 0;
    ca.mvx = ca.mvz = ca.vx = ca.vz = cb.mvx = cb.mvz = cb.vx = cb.vz = 0;
    this.sfxTo(ca.o, 'merge', 0.8); this.sfxTo(cb.o, 'merge', 0.8);
    if (ca.o === this.me || cb.o === this.me) this.toast('GÜREŞ! Rakibe doğru it, HIZLAN ile patlat');
    return true;
  }
  duelTick(dt) {
    const D = this.duel;
    if (!D.on) { if (D.cd > 0) D.cd -= dt; return; }
    const ca = this.cells[D.ia], cb = this.cells[D.ib], oa = this.owners[D.a], ob = this.owners[D.b];
    if (!ca.on || !cb.on || ca.o !== D.a || cb.o !== D.b || !oa.alive || !ob.alive || this.state !== 'play') { D.on = false; D.cd = 15; return; }
    D.t -= dt;
    const push = (o, sg, k) => {
      if (o.bot && !o.human && o.id !== this.me) { o.dx = sg * D.nx; o.dz = sg * D.nz; o.mag = 0.55 + 0.35 * Math.sin(this.time * 2.3 + o.id * 1.7); if (o.boostCd <= 0 && o.mass > 40 && Math.random() < dt * 0.7) this.boost(o); }
      const dd = o.dx * sg * D.nx + o.dz * sg * D.nz;
      let p = 0.5 + 0.9 * Math.max(0, dd) * (o.mag || 0);
      if (o.boostT > D.bt[k] + 0.05) p += 3.5; // boost burst
      D.bt[k] = o.boostT;
      return p;
    };
    const pa = push(oa, 1, 0), pb = push(ob, -1, 1);
    D.s = clampN(D.s + (pa - pb) * dt * 0.33, -1, 1);
    const half = (ca.r + cb.r) * 0.45, sh = D.s * (D.r - half - Math.max(ca.r, cb.r)) * 0.95;
    ca.x = D.cx + D.nx * (-half + sh); ca.z = D.cz + D.nz * (-half + sh);
    cb.x = D.cx + D.nx * (half + sh); cb.z = D.cz + D.nz * (half + sh);
    ca.mvx = ca.mvz = cb.mvx = cb.mvz = 0;
    if (Math.abs(D.s) >= 1 || D.t <= 0) {
      D.on = false; D.cd = 25;
      const w = D.s > 0.2 ? 0 : D.s < -0.2 ? 1 : -1;
      if (w >= 0) {
        const win = w ? cb : ca, los = w ? ca : cb, wo = this.owners[win.o], lo = this.owners[los.o];
        const take = los.m * 0.3; los.m -= take; win.m = Math.min(MAXM, win.m + take);
        this.pushFeed(wo.name + ', ' + lo.name + accSuffix(lo.name) + ' güreşte yendi!');
        if (win.o === this.me) { this.toast('GÜREŞİ KAZANDIN! +kütle'); this.audio?.milestone?.(2); }
      } else this.pushFeed(oa.name + ' ve ' + ob.name + ' güreşte berabere kaldı');
      for (const c of [ca, cb]) { const k = c === ca ? -1 : 1; c.vx = D.nx * k * 22; c.vz = D.nz * k * 22; }
      oa.shield = Math.max(oa.shield, 1.2); ob.shield = Math.max(ob.shield, 1.2);
    }
  }

  eatCell(pred, prey) {
    const po = this.owners[prey.o];
    if (po.shield > 0) return;
    let kb = 0;
    if (this.kingId === prey.o && pred.o !== prey.o && prey.m > po.mass * 0.4) { kb = prey.m * 0.25; this.pushFeed('KRAL DÜŞTÜ! ' + this.owners[pred.o].name + ', ' + po.name + accSuffix(po.name) + ' devirdi'); if (pred.o === this.me) { this.toast('LİDERİ DEVİRDİN! +%25 kütle', 2400); this.audio?.milestone?.(4); this.pulseT = 0; this.camKick = Math.max(this.camKick, 0.2); } this.kingId = -1; this.king = null; }
    pred.m = Math.min(MAXM, pred.m + prey.m + kb);
    if (pred.o === this.me && prey.o !== this.me && prey.m >= 6) this.floatTxt('+' + Math.round(prey.m + kb), prey.x, prey.z, '#7dffb0');
    { const pw = this.owners[pred.o]; if (pw.prot && pw.shield > 0) { pw.shield = 0; pw.prot = false; if (pred.o === this.me) this.toast('KORUMA BİTTİ'); } }
    this.owners[pred.o].xpRun += prey.m;
    prey.on = false;
    po.killer = pred.o;
    if (prey.o === this.me && pred.o !== this.me) { this.revId = pred.o; this.revT = this.time + 20; }
    else if (pred.o === this.me && prey.o === this.revId && this.time < (this.revT || 0)) { pred.m = Math.min(MAXM, pred.m + prey.m * 0.25); this.revT = 0; this.revId = -1; this.toast('İNTİKAM ALINDI! +bonus'); this.audio?.milestone?.(3); }
    this.sfxTo(pred.o, 'gulp', 1, pred.x, pred.z);
  }

  // ------------------------------------------------------------------ bot AI
  think(o) {
    const cells = this.cells;
    let thr = null, thrD = 1e9, prey = null, preyS = 0, preyD = 0;
    const cx = o.lx, cz = o.lz, om = o.maxM, orr = o.maxR;
    for (let i = 0; i < CAP; i++) {
      const c = cells[i];
      if (!c.on || c.o === o.id || this.owners[c.o].hideT > 0) continue;
      const dx = c.x - cx, dz = c.z - cz, d = Math.sqrt(dx * dx + dz * dz);
      if (c.m > om * EAT_K) {
        const e = d - c.r;
        if (e < 14 + orr * 2.5 + c.r * 1.5 && e < thrD) { thrD = e; thr = c; }
      } else if (c.m * EAT_K < om && this.owners[c.o].shield <= 0 && d < (c.o === this.kingId ? 60 + orr * 6 : 22 + orr * 4)) {
        const s = (c.m / (d + 6)) * (c.o === this.kingId ? 2.5 : 1);
        if (s > preyS) { preyS = s; prey = c; preyD = d; }
      }
    }
    let tx = 0, tz = 0, mode = 0;
    if (thr) {
      mode = 1;
      tx = cx - (thr.x - cx); tz = cz - (thr.z - cz);
      if (om < VIR_MIN) {
        let bd = 45, bv = -1;
        for (let v = 0; v < NVIR; v++) { if (!this.von[v]) continue; const d = Math.hypot(this.vx[v] - cx, this.vz[v] - cz); if (d < bd) { bd = d; bv = v; } }
        if (bv >= 0) { tx = this.vx[bv]; tz = this.vz[bv]; }
      }
      if (om < BUR_M && o.cellN === 1 && o.burCd <= 0) {
        let bb = -1, bdd = 90;
        for (let b = 0; b < NBUR; b++) { const d = Math.hypot(BUR[b].x - cx, BUR[b].z - cz); if (d < bdd) { bdd = d; bb = b; } }
        if (bb >= 0) { tx = BUR[bb].x; tz = BUR[bb].z; o.fleeT = 1.2; }
      }
      if (thrD < orr * 1.5 + 4 && o.boostCd <= 0 && om > 40 && Math.random() < 0.5) this.boost(o);
    } else if (prey && (o.id % 3 !== 0 || preyD < 20 + orr * 2)) {
      mode = 2;
      tx = prey.x + prey.vx * 0.2; tz = prey.z + prey.vz * 0.2;
      if (preyD < orr * 3.2 + prey.r) {
        if (o.boostCd <= 0 && om > 60 && Math.random() < 0.4) this.boost(o);
        else if (om > prey.m * 2.6 && om > 120 && o.cellN < 3 && o.splitCd <= 0 && Math.random() < 0.25) { o.ldx = (tx - cx) / (preyD + 0.01); o.ldz = (tz - cz) / (preyD + 0.01); this.split(o); }
      }
    } else if (this.king && this.king.alive && this.king !== o && o.id % 4 === 1 && om > this.king.mass * 0.5 && Math.hypot(this.king.lx - cx, this.king.lz - cz) < 240) {
      mode = 2; tx = this.king.lx; tz = this.king.lz;
    } else if (om > 50 && o.id % 3 === 0 && this.fortGoal(o)) {
      mode = 3; tx = this.tmpF.x; tz = this.tmpF.z;
    } else {
      // food
      let best = -1, bd = 1e9;
      const rad = 28;
      const gx0 = clampN(((cx - rad + R) / GS) | 0, 0, GN - 1), gx1 = clampN(((cx + rad + R) / GS) | 0, 0, GN - 1);
      const gz0 = clampN(((cz - rad + R) / GS) | 0, 0, GN - 1), gz1 = clampN(((cz + rad + R) / GS) | 0, 0, GN - 1);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        for (let i = this.ghead[gx * GN + gz]; i !== -1; i = this.fnext[i]) {
          const d = Math.hypot(this.fx[i] - cx, this.fz[i] - cz) / (this.fv[i] >= 5 ? 3 : this.fv[i] >= 2 ? 1.5 : 1);
          if (d < bd) { bd = d; best = i; }
        }
      }
      const pt = this.props.tmpT;
      if (this.props.bestFor(cx, cz, om, orr, pt) && (best < 0 || pt.g * (bd + 12) > 1.2 * (pt.d + 12))) { tx = pt.x; tz = pt.z; } else if (best >= 0) { tx = this.fx[best]; tz = this.fz[best]; } else {
        o.wanderT -= 0.2;
        if (o.wanderT <= 0 || Math.hypot(o.tx - cx, o.tz - cz) < 8) { const p = this.tmpP || (this.tmpP = { x: 0, z: 0 }); this.randPos(p, 20); o.tx = p.x; o.tz = p.z; o.wanderT = 8; }
        tx = o.tx; tz = o.tz;
      }
    }
    let dx = tx - cx, dz = tz - cz;
    const dl = Math.hypot(dx, dz) + 0.001;
    dx /= dl; dz /= dl;
    // a bot that is being chased stays off the ice (it would slide straight into the hunter); everybody dodges the storm
    if (mode === 1) {
      const T = this.terrain, la = 28;
      if (T.zone(cx, cz) === 1 || T.zone(cx + dx * la, cz + dz * la) === 1) {
        for (const ang of FLEE_ANG) {
          const cs = Math.cos(ang), sn = Math.sin(ang), nx = dx * cs - dz * sn, nz = dx * sn + dz * cs;
          if (T.zone(cx + nx * la, cz + nz * la) !== 1) { dx = nx; dz = nz; break; }
        }
      }
    }
    if (this.storm.on) { const sx = cx - this.storm.x, sz = cz - this.storm.z, sd = Math.hypot(sx, sz); if (sd < this.storm.r + 30) { dx += (sx / (sd + 0.01)) * 1.3; dz += (sz / (sd + 0.01)) * 1.3; } }
    if (this.av.st > 0 && !this.avHidden(this._ah || (this._ah = { x: 0, z: 0, r: 0, m: 0 }), cx, cz, orr, om)) {
      const av = this.av, anx = -Math.sin(av.a), anz = Math.cos(av.a), pn = cx * anx + cz * anz - av.off;
      if (Math.abs(pn) < av.w + 25 && !(av.st === 2 && (cx * Math.cos(av.a) + cz * Math.sin(av.a)) < av.s - 40)) { const sg = pn >= 0 ? 1 : -1; dx += anx * sg * 2.2; dz += anz * sg * 2.2; }
    }
    if (om > 150) {
      for (let v = 0; v < NVIR; v++) {
        if (!this.von[v]) continue;
        const vx = cx - this.vx[v], vz = cz - this.vz[v], vd = Math.hypot(vx, vz);
        if (vd < orr + 8) { dx += (vx / vd) * 1.6; dz += (vz / vd) * 1.6; }
      }
    }
    { const rp = this.props.tmpT; rp.x = 0; rp.z = 0; this.props.repel(cx, cz, orr, rp); dx += rp.x; dz += rp.z; }
    if (this.zn.st === 2) { const zx = cx - this.zn.cx, zz = cz - this.zn.cz, zd = Math.hypot(zx, zz); if (zd > this.zn.r - 30) { dx -= (zx / (zd + 0.01)) * 2.6; dz -= (zz / (zd + 0.01)) * 2.6; } }
    const ed = Math.hypot(cx, cz);
    if (ed > R - 14) { dx -= (cx / ed) * 1.8; dz -= (cz / ed) * 1.8; }
    const l2 = Math.hypot(dx, dz) + 0.001;
    o.dx = dx / l2; o.dz = dz / l2; o.mag = 1; o.ldx = o.dx; o.ldz = o.dz;
    if (mode === 0 && o.mag) o.mag = 1;
  }

  // ------------------------------------------------------------------ accumulate owner stats
  buildForts() {
    const sc = this._scene, mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, fog: false });
    for (const f of this.forts) {
      const g = new THREE.Group(); g.position.set(f.x, 0, f.z);
      const wall = new THREE.Mesh(new THREE.TorusGeometry(FR, 2.6, 6, 40).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x5a8fc8 })); wall.position.y = 5; wall.scale.y = 3.2;
      const tw = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.6, 3.2, 14, 7), new THREE.MeshLambertMaterial({ color: 0xffe2a0, emissive: 0x6a4a10 }), 8);
      { const m4 = new THREE.Matrix4(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; tw.setMatrixAt(k, m4.makeTranslation(Math.cos(a) * FR, 7, Math.sin(a) * FR)); } }
      const base = new THREE.Mesh(new THREE.CircleGeometry(FR, 36).rotateX(-Math.PI / 2), mat(0x7fd0ff, 0.35)); base.position.y = 0.2; base.renderOrder = 3;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(FR, 36).rotateX(-Math.PI / 2), mat(0xffffff, 0.35)); fill.position.y = 0.3; fill.renderOrder = 4;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 30, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd })); pole.position.y = 15;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(16, 9, 0.6), new THREE.MeshLambertMaterial({ color: 0xffffff })); flag.position.set(8, 25, 0);
      const cvs = document.createElement('canvas'); cvs.width = 512; cvs.height = 64;
      const tex = new THREE.CanvasTexture(cvs);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); sp.position.y = 38; sp.scale.set(60, 7.5, 1); sp.visible = false;
      const paint = new THREE.Mesh(new THREE.CircleGeometry(PAINT_R, 40).rotateX(-Math.PI / 2), mat(0xffffff, 0)); paint.position.y = 0.15; paint.renderOrder = 2; paint.visible = false;
      g.add(paint, wall, tw, base, fill, pole, flag, sp); sc.add(g);
      f.paint = paint; f.pa = 0; f.pc = -1;
      f.fill = fill; f.flag = flag; f.sp = sp; f.tex = tex; f.grp = g; f.wallM = wall.material; f.twM = tw.material;
    }
  }

  fortTick(dt) {
    const F = this.forts, ow = this.owners, cells = this.cells;
    for (const f of F) f.list.length = 0;
    for (let i = 0; i < CAP; i++) {
      const c = cells[i];
      if (!c.on || ow[c.o].hideT > 0) continue;
      for (const f of F) { const fx = c.x - f.x, fz = c.z - f.z; if (fx * fx + fz * fz < FR * FR && !f.list.includes(c.o)) f.list.push(c.o); }
    }
    for (const f of F) {
      const L = f.list;
      if (f.own >= 0 && !ow[f.own].alive) { f.own = -1; f.prog = 0; }
      if (L.length === 0) { if (f.own < 0 && f.prog > 0) f.prog = Math.max(0, f.prog - dt * 0.1); }
      else if (L.length === 1) {
        const x = L[0];
        if (x === f.own) f.prog = Math.min(1, f.prog + dt / 2);
        else if (f.own >= 0) { f.prog -= dt / 5; if (f.prog <= 0) { f.own = -1; f.prog = 0; f.cand = x; } }
        else { if (f.cand !== x) { f.cand = x; f.prog = 0; } f.prog += dt / 5; if (f.prog >= 1) { f.own = x; f.prog = 1; this.fortTaken(x); } }
      } else if (f.own >= 0) {
        let big = L[0]; for (const x of L) if (ow[x].mass > ow[big].mass) big = x;
        if (big !== f.own) { f.prog -= dt / 5; if (f.prog <= 0) { f.own = -1; f.prog = 0; f.cand = -1; } } else f.prog = Math.min(1, f.prog + dt / 2);
      }
      if (f.own >= 0 && f.prog >= 1) { const o = ow[f.own], c = cells[o.bc]; if (c && c.on && c.o === o.id && c.m < MAXM) c.m += 2.5 * dt; }
    }
  }

  fortTaken(id) {
    const o = this.owners[id];
    if (id === this.me) { this.toast('KAR KALESİ senin! +kütle'); this.audio?.milestone?.(2); } else this.pushFeed(o.name + ' bir kaleyi ele geçirdi');
  }

  fortGoal(o) {
    let bd = 1e9, bf = null;
    for (const f of this.forts) { if (f.own === o.id && f.prog >= 1) continue; const d = Math.hypot(f.x - o.lx, f.z - o.lz); if (d < bd) { bd = d; bf = f; } }
    if (!bf || bd > 700) return false;
    const t = this.tmpF || (this.tmpF = { x: 0, z: 0 }); t.x = bf.x; t.z = bf.z; return true;
  }

  accumulate() {
    const owners = this.owners, cells = this.cells;
    for (let k = 0; k < NOWN; k++) { const o = owners[k]; o.mass = 0; o.cellN = 0; o.cx = 0; o.cz = 0; o.maxM = 0; o.maxR = 0; o.ext = 0; }
    for (let i = 0; i < CAP; i++) {
      const c = cells[i];
      if (!c.on) continue;
      const o = owners[c.o];
      o.mass += c.m; o.cellN++; o.cx += c.x * c.m; o.cz += c.z * c.m;
      if (c.m > o.maxM) { o.maxM = c.m; o.maxR = c.r; o.lx = c.x; o.lz = c.z; o.bc = i; }
    }
    for (let k = 0; k < NOWN; k++) {
      const o = owners[k];
      if (o.cellN > 0) { o.cx /= o.mass; o.cz /= o.mass; o.alive = true; if (o.mass > o.maxMass) o.maxMass = o.mass; } else o.alive = false;
    }
    for (let i = 0; i < CAP; i++) {
      const c = cells[i];
      if (!c.on) continue;
      const o = owners[c.o];
      const e = Math.hypot(c.x - o.cx, c.z - o.cz) + c.r;
      if (e > o.ext) o.ext = e;
    }
  }

  checkDeaths() {
    for (let k = 0; k < NOWN; k++) {
      const o = this.owners[k];
      if (!(o.wasAlive && !o.alive)) { if (o.alive) o.wasAlive = true; continue; }
      o.wasAlive = false;
      const killer = o.killer >= 0 ? this.owners[o.killer] : null;
      if (killer && killer !== o && killer.id === this.me && this.mp !== 'client') this.meKill();
      if (killer && killer !== o) { killer.kills++; this.pushFeed(killer.name + ', ' + o.name + accSuffix(o.name) + ' yuttu!');
        if (killer.bot && this.time > (this._quipT || 0) && Math.random() < 0.4) { this._quipT = this.time + 9 + Math.random() * 8; const Q = ['yummy 😋', 'kaç kaç!', 'bu benim kalem!', 'ez gg', 'bir tane daha 😎', 'kar tanesi gibi eridin', 'sıradaki kim?', 'oha büyüdüm 🤩']; this.pushFeed(killer.name + ': ' + Q[(Math.random() * Q.length) | 0]); } }
      if (o.bot && !o.human) o.respawnT = 3 + Math.random() * 3;
      else if (k === this.me) this.onMeDead(killer);
      else if (o.human && o.human !== 'host') this.net && this.net.sendTo(o.human, { t: 'dead', k: killer ? killer.name : '' });
      o.killer = -1;
    }
  }

  // ---- population: bots 'join' and 'leave' like real players (slow random walk of the player count)
  popCenter() {
    const d = new Date(), hr = d.getHours() + d.getMinutes() / 60;
    const ev = Math.cos(((hr - 21) / 24) * Math.PI * 2); // 1 at 21:00, -1 at 09:00
    return 45 + ev * 4.5;
  }
  presentCount() { let n = 0; for (let i = 0; i < NOWN; i++) if (!this.owners[i].away) n++; return n; }
  /** take a bot out of the game: its balls dissolve into pellets, the slot stays free for a later 'join' */
  removeBot(o, announce) {
    for (let i = 0; i < CAP; i++) {
      const c = this.cells[i];
      if (c.on && c.o === o.id) { c.on = false; for (let k = 0; k < Math.min(8, c.m / 8); k++) this.spawnPellet(c.x + rnd(-c.r, c.r), c.z + rnd(-c.r, c.r), 1, o.col); }
    }
    o.alive = false; o.wasAlive = false; o.away = true; o.cellN = 0; o.mass = 0; o.respawnT = 0;
    if (announce) this.pushFeed(o.name + ' oyundan ayrıldı');
  }
  joinBot() {
    const free = [];
    for (let i = 1; i < NOWN; i++) { const o = this.owners[i]; if (o.away && o.bot && !o.human) free.push(o); }
    if (!free.length) return;
    const o = free[(Math.random() * free.length) | 0];
    const used = this.owners.filter((q) => !q.away).map((q) => q.name);
    const nm = generateNames(1, used)[0];
    this.tmpC.setHSL(Math.random(), 0.72, 0.56);
    this.setColor(o, this.tmpC.getHex()); this.botLook(o);
    this.setName(o, nm, false);
    this.spawnOwner(o, rnd(18, 32));
    this.pushFeed(nm + ' oyuna katıldı');
    if (this.net) this.net.broadcast({ t: 'own', i: o.id, n: o.name, c: o.col, h: 0, sk: o.skin, tr: o.trail });
  }
  leaveBot() {
    let best = null, bs = 1e18;
    for (let i = 4; i < NOWN; i++) {
      const o = this.owners[i];
      if (o.away || !o.bot || o.human || o.boss || i === this.me) continue;
      const sc = (o.alive ? o.mass : 0) * (0.6 + Math.random() * 0.8); // dead / small ones go first
      if (sc < bs) { bs = sc; best = o; }
    }
    if (best) this.removeBot(best, true);
  }
  popTick(dt) {
    this.popT -= dt;
    if (this.popT > 0) return;
    this.popT = rnd(5, 16);
    const ctr = this.popCenter();
    this.popTarget = clampN(this.popTarget + (ctr - this.popTarget) * 0.12 + rnd(-2.2, 2.2), 38, 52);
    const want = Math.round(this.popTarget), have = this.presentCount();
    if (have < want) this.joinBot(); else if (have > want) this.leaveBot();
  }

  dropHuman(id) {
    for (let k = 1; k < NOWN; k++) {
      const o = this.owners[k];
      if (o.human === id) {
        o.human = null; o.bot = true; this.botLook(o);
        this.removeBot(o, true); // slot freed; the population walk may refill it with a new 'player' later
        if (this.net) this.net.broadcast({ t: 'own', i: o.id, n: o.name, c: o.col, h: 0, sk: o.skin, tr: o.trail });
      }
    }
    if (this.net) this.net.kick(id);
  }

  // ------------------------------------------------------------------ result
  /** YUTUŞ SERİSİ: every bot you finish off pops a callout; kills within 6 s chain into a streak with a mass bonus */
  meKill() {
    const me = this.owners[this.me];
    if (!me || !me.alive) return;
    const n = this.kStreak = this.time - (this.kLastT ?? -99) < 6 ? (this.kStreak || 0) + 1 : 1;
    this.kLastT = this.time;
    this.platform?.haptic?.(n > 1 ? 'success' : 'medium');
    this.camKick = Math.max(this.camKick, n > 1 ? 0.12 + 0.04 * Math.min(4, n) : 0.07);
    if (n < 2) return;
    const bonus = Math.min(150, Math.round(me.mass * 0.05 * (n - 1)) + 4 * n);
    const c = this.cells[me.bc];
    if (c && c.on && c.o === this.me) c.m = Math.min(MAXM, c.m + bonus);
    const T = ['', '', 'ÇİFTE YUTUŞ!', 'ÜÇLÜ YUTUŞ!', 'DÖRTLÜ YUTUŞ!'];
    this.toast((T[n] || 'DURDURULAMAZ! x' + n) + ' +' + bonus + ' kütle', 1900);
    if (c && c.on) this.floatTxt('🔥 x' + n, c.x, c.z, '#ffd24a');
    this.audio?.milestone?.(Math.min(5, n + 1));
    if (n > (this.bestStreak || 0)) this.bestStreak = n;
  }

  onMeDead(killer) {
    this.kStreak = 0;
    const o = this.owners[this.me];
    this.state = 'dead';
    this.deadT = 1.1;
    this.deadKiller = killer ? killer.name : '';
    this.deaths = (this.deaths || 0) + 1;
    if (this.mp !== 'client' && this.deaths < 3) { this.ghostStart(o, killer); this.deadT = 1e9; } // GÖLGE AV: soft elimination
    this.audio?.lose?.();
    this.platform?.haptic?.('heavy');
    this.bank(o);
  }

  /** GÖLGE AV: after being eaten you roam 10 s as a ghost, collect a few pellets, then respawn with that bonus mass */
  ghostStart(o, killer) {
    if (this.hud.btns) this.hud.btns.style.display = 'none';
    this.ghost = { x: o.lx, z: o.lz, t: 10, bonus: 0, n: 0, ct: 0, kl: killer && killer !== o ? killer : null, rev: false };
    this.bank(o);
    const el = document.createElement('div');
    el.className = 'ag-ghost';
    el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;font-size:34px;filter:drop-shadow(0 0 8px #bfeaff);opacity:.85;z-index:5';
    el.textContent = '👻';
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;left:50%;top:30%;transform:translateX(-50%);text-align:center;color:#eaf6ff;font:800 15px system-ui,sans-serif;text-shadow:0 2px 6px #0007;z-index:6;pointer-events:none;background:rgba(10,20,40,.55);border-radius:16px;padding:6px 14px;white-space:nowrap';
    const menu = document.createElement('button'); menu.type = 'button'; menu.className = 'ag-btn'; menu.textContent = 'MENÜ'; menu.style.cssText = 'pointer-events:auto;width:auto;min-width:0;display:inline-block;margin:8px 0 0 6px;font-size:13px;padding:6px 14px;opacity:.8';
    const again = document.createElement('button'); again.type = 'button'; again.className = 'ag-btn'; again.textContent = 'TEKRAR DOĞ'; again.style.cssText = 'pointer-events:auto;width:auto;min-width:0;display:inline-block;margin-top:8px;font-size:15px;padding:7px 18px;font-weight:900';
    again.addEventListener('click', (e) => { e.stopPropagation(); this.audio?.init?.(); this.ghostEnd(true); });
    again.addEventListener('pointerdown', (e) => e.stopPropagation());
    const rv = document.createElement('div'); rv.style.cssText = 'color:#ff6a6a;font-size:13px;margin-top:2px';
    const kar = document.createElement('div'); kar.style.cssText = 'position:absolute;left:0;top:0;font-size:26px;color:#ff3a3a;text-shadow:0 2px 0 #3a0000,0 0 8px #ff2a2a;pointer-events:none;font-weight:900;z-index:6;opacity:0'; kar.textContent = '➤';
    this.hud.root.append(kar); this.ghost.kar = kar; this.ghost.rv = rv;
    this.foodMesh.material.transparent = true; this.foodMesh.material.opacity = 0.35; this.foodMesh.material.needsUpdate = true;
    menu.addEventListener('click', (e) => { e.stopPropagation(); this.ghostEnd(false); });
    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    const lab = document.createElement('div'); bar.append(lab, rv, again, menu);
    if (this.ghost.kl) rv.textContent = 'İntikam: katiline dokun +10 kütle';
    this.hud.root.append(el, bar);
    this.ghost.el = el; this.ghost.bar = bar; this.ghost.lab = lab;
  }
  ghostClean(g) {
    if (this.hud.btns) this.hud.btns.style.display = '';
    this.ghost = null; g.el.remove(); g.bar.remove(); g.kar?.remove();
    const m = this.foodMesh.material; m.transparent = false; m.opacity = 1; m.needsUpdate = true;
  }
  ghostEnd(respawn) {
    const g = this.ghost; if (!g) return;
    this.ghostClean(g);
    this.inp.mag = 0;
    if (!respawn) { this.deadT = 0; return; } // MENÜ -> result screen
    const o = this.owners[this.me];
    this.closeResult(); o.bot = false;
    this.spawnOwner(o, this.startMass() + g.bonus);
    this.state = 'play'; this.toast(g.bonus > 0 ? 'GERİ DÖNDÜN! +' + Math.round(g.bonus) + ' kütle' : 'GERİ DÖNDÜN!', 2000);
    this.audio?.whoosh?.();
  }
  ghostTick(dt) {
    const g = this.ghost; if (!g) return;
    if (this.state !== 'dead') { this.ghostClean(g); return; }
    g.t -= dt;
    const i = this.inp, sp = 24;
    g.x += i.dx * i.mag * sp * dt; g.z += i.dz * i.mag * sp * dt;
    const d = Math.hypot(g.x, g.z); if (d > R - 3) { g.x *= (R - 3) / d; g.z *= (R - 3) / d; }
    g.ct -= dt;
    if (g.ct <= 0 && g.n < 7) {
      g.ct = 0.1;
      for (let k = 0; k < FT; k++) {
        const v = this.fv[k]; if (v <= 0 || v > 5) continue;
        const dx = this.fx[k] - g.x, dz = this.fz[k] - g.z;
        if (dx * dx + dz * dz < 36) {
          g.bonus += v * 1.5; g.n++; this.snd('pellet');
          if (k < FOOD) { const p = this.tmpP || (this.tmpP = { x: 0, z: 0 }); this.foodPos(p); this.foodPlace(k, p.x, p.z, this.baseVal(k)); } else this.foodPlace(k, 0, 0, 0);
          if (g.n >= 7) break;
        }
      }
    }
    g.lab.textContent = 'GÖLGE: ' + Math.max(0, Math.ceil(g.t)) + ' sn · +' + Math.round(g.bonus) + ' kütle';
    const K = g.kl;
    if (K && K.alive && K.cellN > 0) {
      const kdist = Math.hypot(K.lx - g.x, K.lz - g.z);
      if (kdist > K.maxR + 16) g.armed = true;  // ghost starts on the killer: must leave and come back
      if (!g.rev && g.armed && kdist < K.maxR + 4) { g.rev = true; g.bonus += 10; g.rv.textContent = 'İNTİKAM ALINDI! +10 kütle'; g.rv.style.color = '#7dff9a'; this.snd('pellet'); }
      let tx = K.lx, tz = K.lz, bm = -1;
      for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on && c.o === K.id && c.m > bm) { bm = c.m; tx = c.x; tz = c.z; } }
      const cam = this._camera, w = this._pv3 || (this._pv3 = new THREE.Vector3()), W = this.sz.x || 1, H = this.sz.y || 1;
      w.set(tx, 0, tz).project(cam);
      let dx = w.x, dy = w.y; if (w.z > 1) { dx = -dx; dy = -dy; }
      const k = Math.max(Math.abs(dx) / 0.9, Math.abs(dy) / 0.8, 1e-4), kk = Math.min(1, 1 / k * 1.0);
      const on = !g.rev, px = (dx * (k > 1 || w.z > 1 ? 1 / k : 1) * 0.5 + 0.5) * W, py = (-dy * (k > 1 || w.z > 1 ? 1 / k : 1) * 0.5 + 0.5) * H;
      g.kar.style.transform = 'translate(' + (px - 16) + 'px,' + (py - 16) + 'px) rotate(' + Math.atan2(-dy, dx) * 57.3 + 'deg)';
      g.kar.style.opacity = on ? '1' : '0';
    } else g.kar.style.opacity = '0';
    if (g.t <= 0) { this.ghostEnd(true); return; }
    const cam = this._camera, v = this._pv3 || (this._pv3 = new THREE.Vector3());
    v.set(g.x, 0.5, g.z).project(cam);
    g.el.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * this.sz.x - 17) + 'px,' + ((-v.y * 0.5 + 0.5) * this.sz.y - 17) + 'px)';
  }

  bank(o) {
    if (o.maxMass > this.best) { this.best = o.maxMass; lsSet(BEST_KEY, Math.floor(this.best)); this.newBest = true; } else this.newBest = false;
    this.xp += o.xpRun; lsSet(XP_KEY, Math.floor(this.xp));
    o.xpRun = 0;
    // ties into the main game's economy: snowflakes (coins) for the run
    this.earned = Math.max(0, Math.floor(Math.sqrt(Math.max(0, o.maxMass)) * 1.2 + o.kills * 3));
    try { if (this.earned > 0 && this.save && typeof this.save.addCoins === 'function') this.save.addCoins(this.earned); } catch { /* ignore */ }
  }

  showResult() {
    const o = this.owners[this.me];
    this.closeResult();
    const el = document.createElement('div');
    el.className = 'ag-screen';
    const card = document.createElement('div');
    card.className = 'ag-card ag-result';
    const row = (k, v) => `<div class="ag-r"><span>${k}</span><b>${v}</b></div>`;
    const rk = o.bestRank >= 99 ? 0 : o.bestRank;
    const ms = this.owners.filter(q => q.alive && q !== o).map(q => q.mass).sort((x, y) => y - x);
    const gap = Math.max(1, Math.ceil((ms[2] || 0) - o.maxMass + 1));
    const hook = rk > 3 ? `En iyi sıran #${rk} — ilk 3'e ${gap} kütle!` : rk >= 1 ? `En iyi sıran #${rk} — bir üstüne çık!` : 'Bir dahaki sefere sıralamaya gir!';
    card.innerHTML = '<div class="ag-logo sm">YENDİN: <span class="kn"></span></div>' +
      `<div class="ag-earn"><small>kazanılan</small><b>+${this.earned || 0} ❄️</b></div>` +
      row('SÜRE', fmtT(this.time - o.t0)) + row('MAX KÜTLE', fmtM(o.maxMass) + (this.newBest ? ' 🏆 REKOR' : '')) + row('EN İYİ SIRA', rk ? '#' + rk : '-') + row('YEDİĞİN', o.kills) + (this.bestStreak >= 2 ? row('EN İYİ SERİ', '🔥 x' + this.bestStreak) : '') +
      '<div class="ag-sub" style="margin:8px 0;font-weight:800;color:#ffd23a"></div>';
    card.querySelector('.kn').textContent = this.deadKiller || 'Kar Fırtınası';
    card.querySelector('.ag-sub').textContent = hook;
    const b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'ag-btn go'; b1.textContent = 'TEKRAR DOĞ';
    const b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'ag-btn'; b2.textContent = 'MENÜ';
    b1.addEventListener('click', () => { this.audio?.init?.(); this.audio?.ui?.('confirm'); this.deaths = 0; this.bestStreak = 0; this.respawnMe(); });
    b2.addEventListener('click', () => { this.audio?.ui?.('back'); this.exit(); });
    card.append(b1, b2);
    el.appendChild(card);
    this.hud.root.appendChild(el);
    this.resultEl = el;
  }
  closeResult() { if (this.resultEl) { this.resultEl.remove(); this.resultEl = null; } }

  // ------------------------------------------------------------------ title / lobby screens
  clearScreen() { clearInterval(this._brT); this._brRender = null; if (this.screenEl) { this.screenEl.remove(); this.screenEl = null; } if (this.hud.btns && !this.ghost) this.hud.btns.style.display = ''; }

  /** wallet pills: the player's PATPAT snowflakes + crystals */
  wallet() {
    const w = document.createElement('div'); w.className = 'ag-wallet';
    let c = 0, g = 0;
    try { c = this.save ? this.save.coins | 0 : 0; g = this.save && this.save.crystals ? this.save.crystals() | 0 : 0; } catch { /* ignore */ }
    w.innerHTML = `<span class="ag-pill"><i>❄️</i>${c}</span><span class="ag-pill cr"><i>💎</i>${g}</span>`;
    return w;
  }
  /** card(title, back?) - back: a function makes a round '←' button in the corner (same look as the main menu's back/close) */
  card(title, back) {
    this.clearScreen();
    if (this.hud.btns) this.hud.btns.style.display = 'none'; // no BÖL/FIRLAT/HIZLAN over menus
    const el = document.createElement('div');
    el.className = 'ag-screen';
    const card = document.createElement('div');
    card.className = 'ag-card';
    const top = document.createElement('div'); top.className = 'ag-top';
    if (back) {
      const bb = document.createElement('button'); bb.type = 'button'; bb.className = 'ag-x'; bb.textContent = '←'; bb.setAttribute('aria-label', 'Geri');
      bb.addEventListener('click', () => { this.audio?.init?.(); this.audio?.ui?.('back'); back(); });
      top.appendChild(bb);
    }
    top.appendChild(this.wallet());
    card.appendChild(top);
    if (title) { const h = document.createElement('h2'); h.textContent = title; card.appendChild(h); }
    el.appendChild(card);
    this.hud.root.appendChild(el);
    this.screenEl = el;
    return card;
  }
  btn(parent, text, fn, cls) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ag-btn' + (cls ? ' ' + cls : ''); b.textContent = text;
    const kind = cls === 'go' ? 'confirm' : /GERİ|ÇIK|KAPAT|MENÜ/.test(text) ? 'back' : 'click';
    b.addEventListener('click', () => { this.audio?.init?.(); this.audio?.ui?.(kind); fn(); });
    parent.appendChild(b);
    return b;
  }
  nickInput(card) {
    const inp = document.createElement('input');
    inp.className = 'ag-inp'; inp.maxLength = 12; inp.placeholder = 'Takma adın'; inp.value = this.nick; inp.autocomplete = 'off';
    inp.style.cssText = 'flex:1 1 auto;min-width:0;width:auto;max-width:220px';
    inp.addEventListener('input', () => { this.nick = inp.value.slice(0, 12); lsSet(NICK_KEY, this.nick); });
    if (!inp.value.trim()) { inp.value = generateNames(1, [])[0].slice(0, 12); this.nick = inp.value; lsSet(NICK_KEY, this.nick); }
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:center;width:100%;max-width:290px;margin:0 auto';
    const dice = document.createElement('button'); dice.type = 'button'; dice.className = 'ag-btn'; dice.textContent = '🎲'; dice.title = 'Rastgele isim'; dice.style.cssText = 'flex:0 0 auto;width:auto;min-width:48px;padding:6px 10px';
    dice.addEventListener('click', () => { this.audio?.init?.(); this.audio?.ui?.('click'); inp.value = generateNames(1, [])[0].slice(0, 12); this.nick = inp.value; lsSet(NICK_KEY, this.nick); });
    row.appendChild(inp); row.appendChild(dice); card.appendChild(row);
    return inp;
  }
  ensureNick() { if (!this.nick.trim()) { this.nick = 'Yeti' + ((Math.random() * 900 + 100) | 0); lsSet(NICK_KEY, this.nick); } return this.nick.trim(); }

  showTitle() {
    this._tok++;
    this.closedShown = false;
    const c = this.card('', () => this.exit());
    c.classList.add('ag-title');
    const logo = document.createElement('div'); logo.className = 'ag-logo'; logo.innerHTML = 'KARTOPU<br>ARENA'; c.appendChild(logo);
    const o = this.owners[this.me];
    const ball = document.createElement('div'); ball.className = 'ag-ball';
    let hex = '#' + ('000000' + ((o && o.col) || 0xff7a2f).toString(16)).slice(-6);
    try {
      const sid = this.save && this.save.selected ? this.save.selected('skin') : null;
      const sk = sid ? SKINS.find((k) => k.id === sid) : null;
      if (sk && sk.preview && sk.preview.a) { hex = sk.preview.b || sk.preview.a; ball.style.setProperty('--ba', sk.preview.a); }
    } catch { /* ignore */ }
    ball.style.setProperty('--bc', hex); c.appendChild(ball);
    const s = document.createElement('div'); s.className = 'ag-sub'; s.textContent = 'Büyü, yut, hayatta kal! Rekor kütle: ' + fmtM(this.best) + ' · Seviye ' + lvlOf(this.xp); c.appendChild(s);
    this.nickInput(c);
    this.btn(c, '⚡ HIZLI OYNA', () => this.quickPlay(), 'go');
    const g = document.createElement('div'); g.className = 'ag-grid'; c.appendChild(g);
    this.btn(g, '🌐 AÇIK ODALAR', () => this.openBrowser(), 'blue');
    this.btn(g, '👥 ODA KUR', () => this.hostScreen(), 'blue');
    this.btn(g, '🔑 KODLA KATIL', () => this.joinScreen(), 'blue');
    this.btn(g, '⛄ TEK OYUNCU', () => { this.ensureNick(); this.playSolo(); }, 'blue');
  }

  statusEl(card) { const s = document.createElement('div'); s.className = 'ag-status'; card.appendChild(s); return s; }

  // ---- helpers
  closeNet() { if (this.net) { try { this.net.close(); } catch { /* ignore */ } this.net = null; } }
  stopPresence() { if (this.presence) { try { this.presence.stop(); } catch { /* ignore */ } this.presence = null; } }
  /** back to the (bot demo) title world after an online session */
  resetToMenu() {
    this.closeNet();
    this.mp = null; this.me = 0; this.state = 'title';
    this.closeResult();
    this.initWorld();
    this.hud.root.classList.add('ag-menu');
  }
  async ensurePresence() {
    if (this.disposed) return null;
    if (!this.presence || this.presence.dead) {
      const { Presence } = await import('./lobby.js');
      if (this.disposed) return null;
      this.presence = new Presence(() => this.onPresence());
    }
    const p = this.presence;
    p.start();
    return p;
  }
  onPresence() { if (this._brRender) this._brRender(); }

  // ---- host: public (default) or private room, starts playing immediately
  hostScreen() {
    const c = this.card('ODA KUR', () => this.showTitle());
    const s = document.createElement('div'); s.className = 'ag-sub'; s.textContent = 'Oda hemen açılır, oyun başlar. Herkes istediği an katılabilir (en fazla ' + MAX_HUMANS + ' kişi), boşlukları botlar doldurur.'; c.appendChild(s);
    this.nickInput(c);
    const tg = this.btn(c, '', () => { this.privRoom = !this.privRoom; upd(); }, 'blue');
    const note = document.createElement('div'); note.className = 'ag-sub'; c.appendChild(note);
    const upd = () => {
      tg.textContent = this.privRoom ? '🔒 Özel oda: AÇIK' : '🌐 Özel oda: KAPALI';
      note.textContent = this.privRoom ? 'Sadece kodu bilenler katılır, listede görünmez.' : 'Oda herkese açık: Açık Odalar listesinde görünür.';
    };
    upd();
    this.btn(c, 'KUR VE OYNA', () => this.createRoom(!this.privRoom), 'go');
  }

  async createRoom(pub) {
    const nick = this.ensureNick();
    const tok = ++this._tok;
    const c = this.card('ODA KURULUYOR');
    const st = this.statusEl(c); st.textContent = 'Oda açılıyor...';
    this.btn(c, 'İPTAL', () => { this._tok++; this.closeNet(); this.showTitle(); });
    try {
      const { ArenaNet } = await import('./net.js');
      if (this.disposed || tok !== this._tok) return;
      this.net = new ArenaNet({
        onData: (id, msg) => this.onHostData(id, msg),
        onGone: (id) => this.dropHuman(id),
        onLate: (id, rec) => this.lateJoin(id, rec),
        onClosed: () => { /* host side: nothing */ },
      });
      const code = await this.net.host(nick);
      if (this.disposed || tok !== this._tok) { this.closeNet(); return; }
      this.net.pub = !!pub;
      this.hostStart();
      if (pub) this.announceRoom(); else this.stopPresence();
      this.toast(pub ? '🌐 Herkese açık oda kuruldu · ' + code : '🔒 Özel oda · kod: ' + code);
    } catch (e) {
      this.closeNet();
      if (tok !== this._tok) return;
      const c2 = this.card('ODA KURULAMADI');
      const s2 = this.statusEl(c2); s2.textContent = 'İnternet bağlantını kontrol et ve tekrar dene.';
      this.btn(c2, 'GERİ', () => this.showTitle());
    }
  }

  async announceRoom() {
    const p = await this.ensurePresence();
    if (!p || !this.net || this.net.role !== 'host') return;
    p.announce(() => {
      const n = this.net;
      if (!n || n.dead) return null;
      return { code: n.code, name: n.nick + ' odası', host: n.nick, n: n.clients.size + 1, max: MAX_HUMANS, map: R, v: VERSION };
    });
  }

  // ---- public room browser
  async openBrowser() {
    this._tok++;
    this.closedShown = false;
    const c = this.card('AÇIK ODALAR', () => this.showTitle());
    const st = this.statusEl(c);
    const list = document.createElement('div');
    list.className = 'ag-list';
    c.appendChild(list);
    this.btn(c, '⚡ HIZLI OYNA', () => this.quickPlay(), 'go');
    this.btn(c, '🔑 KODLA KATIL', () => this.joinScreen(), 'blue');
    this.btn(c, '👥 ODA KUR', () => this.hostScreen(), 'blue');
    let spin = 0;
    const render = () => {
      if (!list.isConnected) return;
      const p = this.presence;
      const rooms = p ? p.list(VERSION) : [];
      spin++;
      const on = p && p.ok && p.online > 1 ? '🟢 ' + p.online + ' çevrimiçi · ' : '';
      if (p && p.failed) st.textContent = 'Oda listesine ulaşılamadı. Kodla katılabilir veya oda kurabilirsin.';
      else st.textContent = on + (['◐', '◓', '◑', '◒'][spin % 4]) + ' ' + (p && p.ok ? 'Odalar aranıyor...' : 'Bağlanılıyor...');
      list.textContent = '';
      if (!rooms.length) {
        const d = document.createElement('div'); d.className = 'ag-empty';
        d.innerHTML = '<div style="font-size:34px;line-height:1">🏔️</div><b>Şu an açık oda yok</b><span>HIZLI OYNA ile hemen oda kur — botlar dolduracak, arkadaşların kodla katılabilir.</span>';
        d.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 10px;margin:4px 0 8px;border-radius:14px;background:rgba(10,30,70,.35);color:#eaf6ff;text-align:center;font-size:13px';
        list.appendChild(d);
        return;
      }
      const now = Date.now();
      rooms.sort((a, b) => (a.n >= a.max) - (b.n >= b.max) || b.n - a.n);
      const hd = document.createElement('div'); hd.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;letter-spacing:.08em;color:#cfe6ff;padding:0 6px 4px'; hd.innerHTML = '<span>ODA</span><span>OYUNCU</span>'; list.appendChild(hd);
      for (const r of rooms) {
        const full = r.n >= r.max;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ag-btn blue room';
        b.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 12px;margin:0 0 6px;opacity:' + (full ? '.55' : '1');
        const nm = document.createElement('span'); nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px'; nm.textContent = (full ? '⛔ ' : '🟢 ') + r.name;
        const bar = document.createElement('span'); bar.style.cssText = 'flex:none;width:54px;height:7px;border-radius:4px;background:rgba(255,255,255,.25);overflow:hidden';
        const fill = document.createElement('i'); fill.style.cssText = 'display:block;height:100%;width:' + Math.round(100 * Math.min(1, r.n / r.max)) + '%;background:' + (full ? '#ff6b6b' : '#7dff9a'); bar.appendChild(fill);
        const cnt = document.createElement('span'); cnt.style.cssText = 'flex:none;font-size:13px;min-width:40px;text-align:right'; cnt.textContent = r.n + '/' + r.max;
        const go = document.createElement('span'); go.style.cssText = 'flex:none;font-size:12px;padding:3px 9px;border-radius:9px;background:' + (full ? '#5a6b8c' : '#ff7a2f'); go.textContent = full ? 'DOLU' : 'KATIL';
        b.append(nm, bar, cnt, go);
        b.title = Math.max(0, Math.round((now - r.ts) / 1000)) + ' sn önce görüldü';
        b.addEventListener('click', () => { this.audio?.init?.(); this.audio?.ui?.('click'); if (full) { this.toast('Oda dolu'); return; } this.doJoin(r.code, () => this.openBrowser()); });
        list.appendChild(b);
      }
    };
    this._brRender = render;
    this._brT = setInterval(render, 1000);
    render();
    await this.ensurePresence();
    render();
  }

  // ---- quick play: fullest non-full public room, else create one after ~3 s
  async quickPlay() {
    this.ensureNick();
    const tok = ++this._tok;
    this.closedShown = false;
    const c = this.card('HIZLI OYNA');
    const st = this.statusEl(c); st.textContent = 'Oda aranıyor...';
    this.btn(c, 'İPTAL', () => { this._tok++; this.showTitle(); });
    const p = await this.ensurePresence();
    if (!p || tok !== this._tok) return;
    const t0 = performance.now();
    const step = () => {
      if (tok !== this._tok || this.disposed) return;
      const open = p.list(VERSION).filter((r) => r.n < r.max);
      if (open.length) { st.textContent = open[0].name + ' odasına giriliyor...'; this.doJoin(open[0].code, () => this.openBrowser()); return; }
      if (p.failed || performance.now() - t0 > 3000) { st.textContent = 'Açık oda yok, yenisi kuruluyor...'; this.createRoom(true); return; }
      setTimeout(step, 300);
    };
    step();
  }

  // ---- join a room by code (from the browser list, quick play or the code screen)
  async doJoin(code, back) {
    const nick = this.ensureNick();
    const tok = ++this._tok;
    this.closedShown = false;
    this.closeNet();
    const c = this.card('BAĞLANILIYOR');
    const st = this.statusEl(c); st.textContent = 'Odaya bağlanılıyor...';
    this.btn(c, 'İPTAL', () => { this._tok++; this.closeNet(); back(); });
    try {
      const { ArenaNet } = await import('./net.js');
      if (this.disposed || tok !== this._tok) return;
      this.net = new ArenaNet({
        onLobby: (list) => { if (this.state !== 'play') this.renderLobby(list, code, false); },
        onStart: (m) => this.clientStart(m),
        onData: (id, msg) => this.onClientData(msg),
        onClosed: (why) => this.onRoomClosed(why, back),
      });
      await this.net.join(code, nick, this.mySkin(), this.myTrail());
      if (this.disposed || tok !== this._tok) { this.closeNet(); return; }
      this.stopPresence(); // players leave the discovery mesh once they are in a room
      st.textContent = 'Katıldın, oyun yükleniyor...';
    } catch (e) {
      this.closeNet();
      if (this.disposed || tok !== this._tok) return;
      this.toast(e && e.type === 'peer-unavailable' ? 'Oda bulunamadı' : e && e.type === 'timeout' ? 'Bağlantı zaman aşımı' : 'Bağlanılamadı');
      back();
    }
  }

  renderLobby(list, code) {
    if (this.state === 'play') return;
    const c = this.card('ODADASIN: ' + code);
    c.querySelector('h2').classList.add('code');
    const s = document.createElement('div'); s.className = 'ag-sub'; s.textContent = 'Oyun yükleniyor...'; c.appendChild(s);
    const ul = document.createElement('div'); ul.className = 'ag-plist';
    list.forEach((n, i) => { const d = document.createElement('div'); d.textContent = (i === 0 ? '👑 ' : '⛄ ') + n; ul.appendChild(d); });
    c.appendChild(ul);
    this.btn(c, 'ÇIK', () => { this._tok++; this.closeNet(); this.openBrowser(); });
  }

  joinScreen() {
    const c = this.card('KODLA KATIL', () => this.showTitle());
    const inp = document.createElement('input');
    inp.className = 'ag-inp code'; inp.maxLength = 5; inp.placeholder = 'KOD'; inp.autocomplete = 'off'; inp.autocapitalize = 'characters';
    c.appendChild(inp);
    this.nickInput(c);
    const st = this.statusEl(c);
    this.btn(c, 'KATIL', () => {
      const code = inp.value.trim().toUpperCase();
      if (code.length !== 5) { st.textContent = '5 haneli kodu gir.'; return; }
      this.doJoin(code, () => this.joinScreen());
    }, 'go');
  }

  onRoomClosed(why, back) {
    if (this.disposed || this.closedShown) return;
    this.closedShown = true;
    this._tok++;
    const inGame = this.mp === 'client';
    const msg = why === 'full' ? 'Oda dolu' : why === 'ver' ? 'Sürüm uyumsuz — oyunu güncelle' : why === 'timeout' ? 'Bağlantı zaman aşımı' : 'Oda kapandı';
    this.resetToMenu();
    if (!inGame) { this.toast(msg); (back || (() => this.openBrowser()))(); return; }
    const c = this.card(msg);
    this.btn(c, '🌐 AÇIK ODALAR', () => this.openBrowser(), 'go');
    this.btn(c, 'MENÜ', () => this.showTitle());
  }

  /** short rising text at a world position (DOM, auto-removed) */
  floatTxt(t, x, z, col) {
    try {
      const v = this._pv3 || (this._pv3 = new THREE.Vector3()); v.set(x, 0.5, z).project(this._camera);
      if (v.z > 1) return;
      const el = document.createElement('div');
      el.textContent = t;
      el.style.cssText = 'position:absolute;left:0;top:0;font-weight:900;font-size:17px;pointer-events:none;color:' + col + ';text-shadow:0 2px 0 #0a2a4a,1px 1px 0 #0a2a4a,-1px 1px 0 #0a2a4a';
      const px = (v.x * 0.5 + 0.5) * this.sz.x - 12, py = (-v.y * 0.5 + 0.5) * this.sz.y - 24;
      this.hud.root.appendChild(el);
      const an = el.animate([{ transform: 'translate(' + px + 'px,' + py + 'px)', opacity: 1 }, { transform: 'translate(' + px + 'px,' + (py - 46) + 'px)', opacity: 0 }], { duration: 850, easing: 'ease-out' });
      an.onfinish = () => el.remove();
      setTimeout(() => el.remove(), 1200);
    } catch (e) { /* cosmetic */ }
  }
  toast(t, ms) {
    const el = this.hud.toast;
    el.textContent = t; el.classList.add('on');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => el.classList.remove('on'), ms || 1800);
  }

  // ------------------------------------------------------------------ multiplayer: host
  hostStart() {
    if (!this.net || this.net.role !== 'host') return;
    const ids = Array.from(this.net.clients.keys());
    this.mp = 'host';
    this.net.started = true;
    this.clearScreen();
    this.hud.root.classList.remove('ag-menu');
    this.me = 0;
    this.initWorld(); // fresh world, bots filled (owner 0 left empty)
    const used = new Set();
    const mine = this.owners[0];
    mine.bot = false; mine.human = 'host';
    this.setName(mine, this.net.nick, true);
    used.add(this.net.nick);
    this.spawnOwner(mine, this.startMass());
    ids.forEach((id, k) => {
      const o = this.owners[k + 1];
      // replace the bot occupying this slot
      for (let i = 0; i < CAP; i++) if (this.cells[i].on && this.cells[i].o === o.id) this.cells[i].on = false;
      let nm = this.net.clients.get(id).nick;
      while (used.has(nm)) nm += '2';
      used.add(nm);
      o.bot = false; o.human = id; o.seen = this.time; this.setSkin(o, this.net.clients.get(id).sk, this.net.clients.get(id).tr);
      this.setName(o, nm, false);
      this.spawnOwner(o, 24);
      this.pushFeed(nm + ' oyuna katıldı');
    });
    this.fdn = 0; this.fd.fill(0);
    const food = new Array(FOOD * 2);
    for (let i = 0; i < FOOD; i++) { food[i * 2] = Math.round(this.fx[i] * 10); food[i * 2 + 1] = Math.round(this.fz[i] * 10); }
    const own = this.owners.map((o) => [o.name, o.col, o.human ? 1 : 0, o.skin, o.trail]);
    ids.forEach((id, k) => this.net.sendTo(id, { t: 'start', me: k + 1, owners: own, food, fc: this.foodColors(), seed: this.seed, pd: this.props.deadList() }));
    this.state = 'play';
    this.lastLevel = lvlOf(this.xp);
    this.pushFeed('Oda açıldı - katılmak serbest!');
  }

  foodColors() { const a = new Array(FOOD); for (let i = 0; i < FOOD; i++) a[i] = this.fcol[i]; return a; }

  /** a human connected while the match is running: he takes over the smallest bot slot as a fresh small ball */
  lateJoin(id, rec) {
    let slot = null, slotW = 0;
    for (let k = 1; k < NOWN; k++) {
      const o = this.owners[k];
      if (!o.bot || o.human) continue;
      const w = o.away ? -2 : o.alive ? o.mass : -1; // free slots first, then dead bots, then the smallest
      if (!slot || w < slotW) { slot = o; slotW = w; }
    }
    if (!slot) return false;
    if (!slot.away) this.pushFeed(slot.name + ' oyundan ayrıldı');
    for (let i = 0; i < CAP; i++) {
      const c = this.cells[i];
      if (c.on && c.o === slot.id) { c.on = false; for (let k = 0; k < Math.min(8, c.m / 8); k++) this.spawnPellet(c.x + rnd(-c.r, c.r), c.z + rnd(-c.r, c.r), 1, slot.col); } // despawn with a poof of pellets
    }
    const used = new Set(this.owners.filter((q) => q !== slot && (q.human || q.id === this.me)).map((q) => q.name));
    let nm = rec.nick;
    while (used.has(nm)) nm = nm.slice(0, 11) + ((Math.random() * 9 + 1) | 0);
    used.add(nm);
    slot.bot = false; slot.human = id; slot.seen = this.time; this.setSkin(slot, rec.sk, rec.tr);
    this.setName(slot, nm, false);
    this.spawnOwner(slot, 24);
    const own = this.owners.map((o) => [o.name, o.col, o.human ? 1 : 0, o.skin, o.trail]);
    this.net.sendTo(id, { t: 'start', me: slot.id, owners: own, food: this.foodPositions(), fc: this.foodColors(), seed: this.seed, pd: this.props.deadList() });
    this.net.broadcast({ t: 'own', i: slot.id, n: slot.name, c: slot.col, h: 1, sk: slot.skin, tr: slot.trail });
    this.pushFeed(nm + ' oyuna katıldı');
    return true;
  }

  foodPositions() {
    const food = new Array(FOOD * 2);
    for (let i = 0; i < FOOD; i++) { food[i * 2] = Math.round(this.fx[i] * 10); food[i * 2 + 1] = Math.round(this.fz[i] * 10); }
    return food;
  }

  onHostData(id, msg) {
    const o = this.owners.find((q) => q.human === id);
    if (!o) return;
    o.seen = this.time;
    if (msg.t === 'i') {
      const dx = +msg.x || 0, dz = +msg.z || 0, m = clampN(+msg.m || 0, 0, 1);
      o.dx = dx; o.dz = dz; o.mag = m;
      if (m > 0) { o.ldx = dx; o.ldz = dz; }
    } else if (msg.t === 'b') this.boost(o);
    else if (msg.t === 's') this.split(o);
    else if (msg.t === 'e') this.eject(o);
    else if (msg.t === 'chat') this.hostChat(o, msg.x);
    else if (msg.t === 'respawn') { if (!o.alive) this.spawnOwner(o, 24); }
  }

  sendSnapshot() {
    const net = this.net;
    if (!net || net.clients.size === 0) { this.fdn = 0; this.fd.fill(0); this.props.dropDelta(); return; }
    const pd = this.props.takeDelta();
    const c = [];
    for (let i = 0; i < CAP; i++) { const q = this.cells[i]; if (q.on) c.push(i, q.o, Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10, Math.round(q.m * 10) / 10); }
    const fd = [];
    for (let k = 0; k < this.fdn; k++) { const i = this.fdl[k]; fd.push(i, Math.round(this.fx[i] * 10), Math.round(this.fz[i] * 10), this.fv[i], this.fcol[i]); this.fd[i] = 0; }
    this.fdn = 0;
    const fk = [];
    for (const f of this.forts) fk.push(f.own, Math.round(f.prog * 100));
    const hd = [];
    for (let i = 0; i < NOWN; i++) if (this.owners[i].hideT > 0) hd.push(i);
    const v = [];
    for (let i = 0; i < NVIR; i++) v.push(this.von[i] ? Math.round(this.vx[i] * 10) : 99999, Math.round(this.vz[i] * 10));
    const p = [];
    for (let i = 0; i < NPUP; i++) p.push(this.pon[i] ? Math.round(this.px[i] * 10) : 99999, Math.round(this.pz[i] * 10), this.ptype[i]);
    for (const [id, rec] of net.clients) {
      const o = this.owners.find((q) => q.human === id);
      if (!o || !rec.conn.open) continue;
      net.sendTo(id, { t: 's', hn: net.clients.size + 1, pn: this.presentCount(), pd, st: [this.storm.on ? 1 : 0, Math.round(this.storm.x), Math.round(this.storm.z)], pr: [this.rain.st, Math.round(this.rain.x), Math.round(this.rain.z)], wo: [this.wo.st, Math.round(this.wo.t * 10) / 10], du: this.duel.on ? [this.duel.a, this.duel.b, Math.round(this.duel.cx), Math.round(this.duel.cz), Math.round(this.duel.r), Math.round(this.duel.s * 100) / 100, Math.round(this.duel.t * 10) / 10] : 0, bs: this.boss.id >= 0 ? [this.boss.id, this.boss.hp, this.boss.max] : 0, zn: [this.zn.st, Math.round(this.zn.cx), Math.round(this.zn.cz), Math.round(this.zn.r), Math.round(this.zn.rt), Math.round(this.zn.t * 10) / 10], fk, hd, c, fd, v, p, me: [o.shield, o.magnet, o.speed, o.boostCd, o.kills, o.xpRun, o.maxMass] });
    }
  }

  // ------------------------------------------------------------------ multiplayer: client
  clientStart(m) {
    this.mp = 'client';
    this.me = m.me;
    this.genTerrain(m.seed | 0); this.titleIdx = 0; this.lastMyMass = 0; this.chatLog.length = 0; this.chatDirty = true; this.trails.clear(); this.storm.on = false;
    this.clearScreen();
    this.hud.root.classList.remove('ag-menu');
    for (const c of this.cells) c.on = false;
    m.owners.forEach((d, i) => {
      const o = this.owners[i];
      this.setSkin(o, d[3], d[4]); this.setColor(o, d[1]);
      this.setName(o, d[0], i === this.me);
      o.bot = !d[2]; o.alive = false; o.wasAlive = false;
    });
    for (let i = 0; i < FT; i++) { this.gRemove(i); this.fv[i] = 0; }
    this.ghead.fill(-1);
    for (let i = 0; i < FOOD; i++) {
      this.setFoodColor(i, m.fc && m.fc[i] ? m.fc[i] : i % 60 === 0 ? 0xffc400 : FOOD_PAL[i % FOOD_PAL.length]);
      this.fx[i] = m.food[i * 2] / 10; this.fz[i] = m.food[i * 2 + 1] / 10; this.fv[i] = this.baseVal(i); this.gAdd(i);
    }
    for (let i = 0; i < FT; i++) this.writeFood(i);
    this.props.setDead(m.pd);
    const me = this.owners[this.me];
    me.t0 = this.time; me.maxMass = 0; me.bestRank = 99; me.kills = 0; me.xpRun = 0;
    this.state = 'play';
    this.lastSnap = this.time;
    this.lastLevel = lvlOf(this.xp);
  }

  onClientData(msg) {
    if (msg.t === 's') this.applySnapshot(msg);
    else if (msg.t === 'k') this.pushFeed(msg.x);
    else if (msg.t === 'av') { const a = +msg.a, o = +msg.o; if (isFinite(a) && isFinite(o)) this.avStart(a, clampN(o, -R, R), false); }
    else if (msg.t === 'chat') this.chatAdd(String(msg.n || '').slice(0, 14), msg.c | 0, String(msg.x || '').slice(0, 80));
    else if (msg.t === 'sfx') { if (msg.k === 'chime') this.audio?.chime?.(); else this.snd(String(msg.k), undefined, undefined, +msg.v || 1); }
    else if (msg.t === 'own') { const o = this.owners[msg.i]; if (o) { this.setSkin(o, msg.sk, msg.tr); this.setColor(o, msg.c); this.setName(o, msg.n, msg.i === this.me); o.bot = !msg.h; } }
    else if (msg.t === 'dead') { this.deadKiller = msg.k || ''; this.state = 'dead'; this.deadT = 1.1; this.bank(this.owners[this.me]); this.audio?.crash?.(); }
  }

  applySnapshot(m) {
    this.lastSnap = this.time;
    if (m.hn) this.humans = m.hn;
    if (m.pn) this.presentN = m.pn;
    { const b = m.bs, bb = this.boss; for (const q of this.owners) q.boss = false; if (b) { bb.id = b[0]; bb.hp = b[1]; bb.max = b[2]; if (this.owners[b[0]]) this.owners[b[0]].boss = true; } else bb.id = -1; }
    { const u = m.du, D = this.duel; if (u) { D.on = true; D.a = u[0]; D.b = u[1]; D.cx = u[2]; D.cz = u[3]; D.r = u[4]; D.s = u[5]; D.t = u[6]; } else D.on = false; D.ia = D.ib = -1; }
    if (m.wo) { const ow = this.wo.st; this.wo.st = m.wo[0] | 0; this.wo.t = +m.wo[1] || 0; if (this.wo.st === 1 && ow !== 1) this.toast('BEYAZ FIRTINA GELİYOR!'); }
    if (m.pr) { const pw = this.rain.st; this.rain.st = m.pr[0]; this.rain.x = m.pr[1]; this.rain.z = m.pr[2]; if (this.rain.st === 1 && pw !== 1) this.toast('PELET YAĞMURU GELİYOR!'); }
    if (m.st) { const sw = this.storm.on; this.storm.on = !!m.st[0]; this.storm.x = m.st[1]; this.storm.z = m.st[2]; if (this.storm.on && !sw) { this.pushFeed('❄ Kar fırtınası başladı!'); this.stormSndT = 0; } }
    if (m.zn) { const z = this.zn, was = z.st; z.st = m.zn[0]; z.cx = m.zn[1]; z.cz = m.zn[2]; z.r = m.zn[3]; z.rt = m.zn[4]; z.t = m.zn[5]; if (z.st === 1 && was !== 1) this.pushFeed('❄ BUZ ÇEMBERİ! Çember daralıyor'); }
    if (m.fk) this.forts.forEach((f, i) => { const ow = m.fk[i * 2]; if (ow !== f.own && ow >= 0) this.fortTaken(ow); f.own = ow; f.prog = m.fk[i * 2 + 1] / 100; });
    for (let i = 0; i < NOWN; i++) this.owners[i].hideT = 0;
    if (m.hd) for (let k = 0; k < m.hd.length; k++) { const ho = this.owners[m.hd[k]]; if (ho) ho.hideT = 1; }
    const cells = this.cells;
    for (let i = 0; i < CAP; i++) cells[i].killer = 0; // 0 = not seen this snapshot
    const c = m.c;
    for (let k = 0; k + 4 < c.length; k += 5) {
      const q = cells[c[k]];
      if (!q) continue;
      if (!q.on) { q.on = true; q.x = c[k + 2]; q.z = c[k + 3]; q.r = KR * Math.sqrt(c[k + 4]); q.vx = q.vz = 0; q.px0 = q.x; q.pz0 = q.z; q.lsx = q.x; q.lsz = q.z; q.qx = q.qy = q.qz = 0; q.qw = 1; }
      q.o = c[k + 1]; q.tx = c[k + 2]; q.tz = c[k + 3]; q.m = c[k + 4]; q.killer = 1;
    }
    for (let i = 0; i < CAP; i++) if (cells[i].on && cells[i].killer === 0) cells[i].on = false;
    this.props.applyDelta(m.pd);
    const fd = m.fd;
    for (let k = 0; k + 4 < fd.length; k += 5) {
      const i = fd[k];
      if (fd[k + 4]) this.setFoodColor(i, fd[k + 4]);
      this.foodPlace(i, fd[k + 1] / 10, fd[k + 2] / 10, fd[k + 3]);
    }
    for (let i = 0; i < NVIR; i++) { const x = m.v[i * 2]; this.von[i] = x < 90000 ? 1 : 0; this.vx[i] = x / 10; this.vz[i] = m.v[i * 2 + 1] / 10; }
    this.vDirty = true;
    for (let i = 0; i < NPUP; i++) { const x = m.p[i * 3]; this.pon[i] = x < 90000 ? 1 : 0; this.px[i] = x / 10; this.pz[i] = m.p[i * 3 + 1] / 10; const t = m.p[i * 3 + 2]; if (t !== this.ptype[i]) { this.ptype[i] = t; this.setPupColor(i); } }
    const o = this.owners[this.me], a = m.me;
    // my own pellet / gulp sounds are inferred from the mass change (the host does the real simulation)
    let mm = 0; for (let i = 0; i < CAP; i++) if (cells[i].on && cells[i].o === this.me) mm += cells[i].m;
    if (this.lastMyMass > 0 && this.state === 'play') { const d = mm - this.lastMyMass; if (d >= 0.9 && d < 8) this.snd('pellet'); }
    this.lastMyMass = mm;
    o.shield = a[0]; o.magnet = a[1]; o.speed = a[2]; o.boostCd = a[3]; o.kills = a[4]; o.xpRun = a[5];
  }

  clientSmooth(dt) {
    const k = Math.min(1, dt * 12);
    for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on) { c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; } }
    for (const o of this.owners) { if (o.boostCd > 0) o.boostCd -= dt; if (o.shield > 0) o.shield -= dt; if (o.magnet > 0) o.magnet -= dt; if (o.speed > 0) o.speed -= dt; }
    this.sendT -= dt;
    if (this.sendT <= 0 && this.state === 'play') {
      this.sendT = 0.05;
      const i = this.inp;
      this.net && this.net.send({ t: 'i', x: Math.round(i.dx * 100) / 100, z: Math.round(i.dz * 100) / 100, m: Math.round(i.mag * 100) / 100 });
    }
    if (this.time - this.lastSnap > 8 && this.state !== 'title') this.onRoomClosed('closed');
  }

  // ------------------------------------------------------------------ feed
  pushFeed(text) {
    const f = this.feed;
    for (let i = 0; i < 3; i++) { f[i].t = f[i + 1].t; f[i].until = f[i + 1].until; }
    f[3].t = text; f[3].until = this.time + 6;
    this.feedDirty = true;
    if (this.mp === 'host' && this.net && !text.startsWith('Oda açıldı')) this.net.broadcast({ t: 'k', x: text });
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    if (this.disposed) return;
    if (dt > 0.05) dt = 0.05;
    this.time += dt;
    if (this.mp === 'client') this.clientSmooth(dt);
    else if (this.state === 'play' || this.state === 'dead' || this.state === 'title' || this.state === 'lobby') this.simulate(dt);
    this.props.updatePulls(dt);
    this.avTick(dt); this.woTick(dt); this.bossTick(dt); this.bossHud();
    // radii
    const k = Math.min(1, dt * 9);
    for (let i = 0; i < CAP; i++) { const c = this.cells[i]; if (c.on) c.r += (KR * Math.sqrt(c.m) - c.r) * k; }
    this.accumulate();
    this.watch(dt);
    if (this.mp !== 'client') this.checkDeaths();
    // host snapshots
    if (this.mp === 'host') { this.netT -= dt; if (this.netT <= 0) { this.netT = 0.08; this.sendSnapshot(); } }
    this.ghostTick(dt);
    if (this.state === 'dead') { this.deadT -= dt; if (this.deadT <= 0 && !this.resultEl) this.showResult(); }
    this.render(dt);
    this.updateHud(dt);
  }

  setQuality(l) {
    if (l === this.qLv) return;
    this.qLv = l;
    this.snowfall?.setCap([2400, 1200, 500][l]);
    this.trails?.setCap([26000, 15000, 8000][l]);
    this.props?.setQuality([1, 0.8, 0.6][l], [12, 6, 3][l]);
    this.fmask = [0, 1, 3][l];
    this.qBad = this.qGood = 0;
    try { if (this.renderer.setPixelRatio && this.basePR) this.renderer.setPixelRatio(l === 2 ? 1 : l === 1 ? Math.min(this.basePR, 1.25) : this.basePR); } catch (e) { /* ignore */ }
  }

  /** frame-time EMA: >22 ms for 2 s steps down, <15 ms for 5 s steps up */
  adaptQuality(dt) {
    const now = performance.now(), ft = this.qLast ? now - this.qLast : 16;
    this.qLast = now;
    if (ft > 250) return; // tab switch / hitch
    this.qEma += (ft - this.qEma) * 0.08;
    if (this.qEma > 22) { this.qBad += dt; this.qGood = 0; } else if (this.qEma < 15) { this.qGood += dt; this.qBad = 0; } else { this.qBad = this.qGood = 0; }
    if (this.qBad > 2 && this.qLv < 2) this.setQuality(this.qLv + 1);
    else if (this.qGood > 5 && this.qLv > 0) this.setQuality(this.qLv - 1);
  }

  render(dt) {
    this.adaptQuality(dt);
    const owners = this.owners, cells = this.cells;
    const me = owners[this.me];
    this.uTime.value = this.time;
    // follow target
    let fo = me;
    if (!me.alive && this.ghost) fo = { cx: this.ghost.x, cz: this.ghost.z, mass: 24, ext: 0 };
    else if (!me.alive) { fo = null; let bm = -1; for (let i = 0; i < NOWN; i++) if (owners[i].alive && owners[i].mass > bm) { bm = owners[i].mass; fo = owners[i]; } }
    // camera: zooms out smoothly with size, stays inside the arena
    this.renderer.getSize(this.sz);
    const asp = (this.sz.x || 1) / (this.sz.y || 1);
    if (Math.abs(asp - this._camera.aspect) > 0.001) { this._camera.aspect = asp; this._camera.updateProjectionMatrix(); }
    const zf = asp < 1 ? 1 + (1 / asp - 1) * 0.5 : 1;
    let ht = 120 * zf;
    if (fo) {
      const rEff = Math.max(KR * Math.sqrt(fo.mass), fo.ext * 0.8);
      ht = me.alive ? Math.max(30 * zf, (14 + 7.5 * rEff) * zf * (0.72 + 0.28 * Math.min(1, (this.time - me.t0) / 50))) : Math.max(120 * zf, (16 + 7.5 * rEff) * zf);
      const kk = Math.min(1, dt * (me.alive ? 6 : 1.5));
      this.camX += (fo.cx + (me.alive ? this.inp.dx * this.inp.mag * rEff * 0.5 : 0) - this.camX) * kk;
      this.camZ += (fo.cz + (me.alive ? this.inp.dz * this.inp.mag * rEff * 0.5 : 0) - this.camZ) * kk;
    }
    if (this.camKick > 0) { this.camKick = Math.max(0, this.camKick - dt * 0.12); ht *= 1 + this.camKick; }
    ht = Math.min(ht, 1500);
    this.camH += (ht - this.camH) * Math.min(1, dt * 1.4);
    const cdist = Math.hypot(this.camX, this.camZ), clim = R * 0.97;
    if (cdist > clim) { this.camX *= clim / cdist; this.camZ *= clim / cdist; }
    this._camera.position.set(this.camX, this.camH, this.camZ + this.camH * 0.6);
    this._camera.lookAt(this.camX, 0, this.camZ);
    // visible ground rectangle (everything outside is skipped: pellets are drawn compactly from the grid)
    const H = this.camH, hx = H * (0.85 * asp + 0.12) * 1.15 + 25, zmin = this.camZ - 0.95 * H - 25, zmax = this.camZ + 0.62 * H + 25;
    const gx0 = clampN(((this.camX - hx + R) / GS) | 0, 0, GN - 1), gx1 = clampN(((this.camX + hx + R) / GS) | 0, 0, GN - 1);
    const gz0 = clampN(((zmin + R) / GS) | 0, 0, GN - 1), gz1 = clampN(((zmax + R) / GS) | 0, 0, GN - 1);
    const fs = 1 + Math.floor(H / 70) * 0.45;
    this.fs = fs;
    const fa = this.foodMesh.instanceMatrix.array, fcc = this.foodMesh.instanceColor.array;
    let fn = 0;
    const fmx = me.lx, fmz = me.lz, fr2 = me.alive ? Math.pow(me.maxR * 1.5 + 6, 2) : 0;
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let i = this.ghead[gx * GN + gz]; i !== -1; i = this.fnext[i]) {
          const v = this.fv[i];
          if (v <= 0 || this.fej[i] || (this.fmask && (i & this.fmask) !== 0 && v < 2)) continue;
          let sz = this.foodSize(v);
          if (fr2 > 0) { const ddx = this.fx[i] - fmx, ddz = this.fz[i] - fmz, d2 = ddx * ddx + ddz * ddz; if (d2 < fr2) sz *= 0.4 + 0.6 * d2 / fr2; } // calmer ground right around the player
          wm(fa, fn * 16, this.fx[i], sz, this.fz[i], sz);
          fcc[fn * 3] = this.fcr[i]; fcc[fn * 3 + 1] = this.fcg[i]; fcc[fn * 3 + 2] = this.fcb[i];
          fn++;
        }
      }
    }
    this.foodMesh.count = fn;
    { // ejected snowballs: coloured spheres with a short trail while flying
      const ea = this.ejMesh.instanceMatrix.array, ec = this.ejMesh.instanceColor.array, L = this.ejList;
      let en = 0;
      for (let k = L.length - 1; k >= 0; k--) {
        const e = L[k], i = e.i;
        if (this.fv[i] <= 0 || !this.fej[i]) { L.splice(k, 1); continue; }
        e.t += dt;
        const r = 2 * this.fs, fl = Math.min(1, e.t / 0.32);
        for (let q = fl < 1 ? 3 : 0; q >= 0; q--) {
          const f = Math.max(0, fl - q * 0.12), ez = 1 - (1 - f) * (1 - f);
          const x = e.sx + (this.fx[i] - e.sx) * ez, z = e.sz + (this.fz[i] - e.sz) * ez, y = 1.2 * this.fs + Math.sin(f * 3.14159) * 7;
          wm(ea, en * 16, x, y, z, r * (q === 0 ? 1 : 0.8 - q * 0.17));
          ec[en * 3] = this.fcr[i] * (q ? 0.8 : 1); ec[en * 3 + 1] = this.fcg[i] * (q ? 0.8 : 1); ec[en * 3 + 2] = this.fcb[i] * (q ? 0.8 : 1);
          en++;
        }
        if (en > 156) break;
      }
      this.ejMesh.count = en; this.ejMesh.instanceMatrix.needsUpdate = true; this.ejMesh.instanceColor.needsUpdate = true;
    }
    this.foodMesh.instanceMatrix.needsUpdate = true; this.foodMesh.instanceColor.needsUpdate = true;
    // snowballs: roll in the movement direction, squash on boost, belt/cap carry the player colour; grooves behind them
    const sa = this.shadowMesh.instanceMatrix.array;
    for (const e of this.skinPool.values()) e.n = 0;
    let n = 0;
    for (let i = 0; i < CAP; i++) {
      const c = cells[i];
      if (!c.on) continue;
      const o = owners[c.o];
      let r = c.r;
      if (o.hideT > 0) { if (c.o !== this.me) { c.px0 = c.x; c.pz0 = c.z; continue; } r *= 0.4; } // hidden in a burrow: only the owner sees a tiny ghost
      if (r < H * 0.05) r = H * 0.05; // small cells stay readable from the camera
      const ddx = c.x - c.px0, ddz = c.z - c.pz0;
      c.px0 = c.x; c.pz0 = c.z;
      const dd = Math.sqrt(ddx * ddx + ddz * ddz);
      if (dd > 1e-4 && dd < 40) {
        const ang = dd / Math.max(0.5, r), sh = Math.sin(ang * 0.5), ch = Math.cos(ang * 0.5);
        const ex = (ddz / dd) * sh, ez = (-ddx / dd) * sh;
        const nw = ch * c.qw - ex * c.qx - ez * c.qz;
        const nx = ch * c.qx + ex * c.qw - ez * c.qy;
        const ny = ch * c.qy - ex * c.qz + ez * c.qx;
        const nz = ch * c.qz + ex * c.qy + ez * c.qw;
        const nl = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
        c.qw = nw * nl; c.qx = nx * nl; c.qy = ny * nl; c.qz = nz * nl;
      }
      const sq = o.boostT > 0, bk = c.bt > 0 ? Math.sin(Math.min(1, c.bt / 0.24) * Math.PI) * 0.2 : 0; // bump: short squash
      const sx = (sq ? r * 1.12 : r) * (1 + bk * 0.6), sy = (sq ? r * 0.8 : r) * (1 - bk);
      const se = this.skinEntry(o.boss ? 'classic' : o.skin), k16 = se.n++;
      wmq(se.mesh.instanceMatrix.array, k16 * 16, c.x, sy, c.z, sx, sy, sx, c.qx, c.qy, c.qz, c.qw);
      wm(sa, n * 16, c.x + r * 0.12, 0, c.z + r * 0.18, r * 1.6);
      if (se.mesh.instanceColor) { const ic = se.mesh.instanceColor.array, bb = o.boss; ic[k16 * 3] = bb ? o.cr : 1; ic[k16 * 3 + 1] = bb ? o.cg : 1; ic[k16 * 3 + 2] = bb ? o.cb : 1; }
      n++;
      if (o.hideT <= 0 && Math.abs(c.x - this.camX) < hx + 60 && c.z > zmin - 60 && c.z < zmax + 60) this.trails.sample(i, c.o, c.x, c.z, r, this.time);
    }
    this.shadowMesh.count = n; this.shadowMesh.instanceMatrix.needsUpdate = true;
    for (const e of this.skinPool.values()) { // one update() per skin id per frame
      e.mesh.count = e.n; e.mesh.visible = e.n > 0;
      if (e.n > 0) { e.mesh.instanceMatrix.needsUpdate = true; if (e.mesh.instanceColor) e.mesh.instanceColor.needsUpdate = true; if (e.skin.update) { try { e.skin.update(dt, this.time, e.mesh); } catch (er) { e.skin.update = null; } } }
    }
    this.trails.build(this.time, cells, this.camX, this.camZ, hx, zmin, zmax);
    this.props.render(this.camX, this.camH, hx, zmin, zmax, cells, owners, me, this.camZ);
    {
      const st0 = this.storm; let heavy = 0;
      if (st0.on) { const d = Math.hypot(this.camX - st0.x, this.camZ - st0.z); heavy = clampN(1.4 - d / (st0.r * 1.2), 0, 1); }
      if (this.wo.k > heavy) heavy = this.wo.k;
      this.snowfall.update(dt, this.time, this.camX, this.camZ, this.camH, asp, this._camera.fov, this.sz.y * this.renderer.getPixelRatio(), heavy);
    }
    if (this.vDirty) {
      const va = this.virMesh.instanceMatrix.array;
      let vn = 0;
      for (let i = 0; i < NVIR; i++) if (this.von[i]) { wm(va, vn * 16, this.vx[i], VIRR, this.vz[i], VIRR); vn++; }
      this.virMesh.count = vn; this.virMesh.instanceMatrix.needsUpdate = true; this.vDirty = false;
    }
    const pa = this.pupMesh.instanceMatrix.array;
    for (let i = 0; i < NPUP; i++) {
      if (this.pon[i]) wm(pa, i * 16, this.px[i], 2 + Math.sin(this.time * 3 + i) * 0.5, this.pz[i], (this.ptype[i] === 4 ? 1.9 : 1) * (1 + Math.sin(this.time * 4 + i) * 0.1)); else wm(pa, i * 16, 0, -9, 0, 0);
    }
    this.pupMesh.instanceMatrix.needsUpdate = true;
    // storm
    const st = this.storm;
    const ql = this.qLv;
    this.stormA.visible = st.on; this.stormB.visible = st.on && ql < 2;
    if (st.on) {
      this.stormA.position.x = this.stormB.position.x = st.x; this.stormA.position.z = this.stormB.position.z = st.z;
      this.stormA.scale.set(st.r, 1, st.r); this.stormB.scale.set(st.r * 1.25, 1, st.r * 1.25);
      this.stormA.rotation.y += dt * 0.9; if (ql < 2) this.stormB.rotation.y -= dt * 0.55;
    }
    {
      const v = this.av, on = v.st > 0;
      this.avBand.visible = on; this.avWave.visible = v.st === 2;
      if (on) {
        const L = R * 2.6;
        this.avBand.position.set(-Math.sin(v.a) * v.off, 0.9, Math.cos(v.a) * v.off); this.avBand.rotation.y = -v.a; this.avBand.scale.set(L, 1, v.w * 2);
        this.avBand.material.opacity = v.st === 1 ? 0.18 + 0.2 * Math.abs(Math.sin(this.time * 6)) : 0.12;
        if (v.st === 2) { const s = v.s || 0; this.avWave.position.set(Math.cos(v.a) * s - Math.sin(v.a) * v.off, 12, Math.sin(v.a) * s + Math.cos(v.a) * v.off); this.avWave.rotation.y = -v.a; this.avWave.scale.set(46, 26, v.w * 2); }
      }
      const el = this.hud.av;
      const at = v.st === 1 ? 'ÇIĞ GELİYOR! ' + Math.max(1, Math.ceil(v.t)) : '';
      if (at !== el._t) { el._t = at; if (at) el.textContent = at; el.style.opacity = at ? '1' : '0'; }
    }
    for (const f of this.forts) {
      const ho = f.own >= 0 ? owners[f.own] : null, col = ho ? ho.col : 0xffffff, k = Math.max(0.01, f.prog);
      { const held = ho && f.prog >= 1; if (held) f.pc = f.own; f.pa = clampN(f.pa + (held ? 1 : -1) * dt / (held ? 20 : 6), 0, 1);
        if (f.pa > 0 && f.pc >= 0 && this.qLv < 2) { f.paint.visible = true; f.paint.material.color.setHex(owners[f.pc].col); f.paint.material.opacity = 0.32 * f.pa; } else f.paint.visible = false; }
      f.fill.scale.set(k, 1, k); f.fill.material.color.setHex(ho ? col : 0xdff3ff);
      f.flag.material.color.setHex(ho ? col : 0xff4d4d); f.flag.position.y = 12 + 13 * (ho ? f.prog : 0);
      const a = ho ? accSuffix(ho.name) : '', txt = ho ? ho.name + (a.includes("'y") ? a.replace("'y", "'n") : a) + 'n KALESİ' : '';
      if (txt !== f.lbl) {
        f.lbl = txt; const g = f.tex.image.getContext('2d'); g.clearRect(0, 0, 512, 64);
        if (txt) { g.font = '900 40px "Trebuchet MS", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 9; g.strokeStyle = 'rgba(10,30,60,0.92)'; g.strokeText(txt, 256, 34, 500); g.fillStyle = '#' + ('000000' + col.toString(16)).slice(-6); g.fillText(txt, 256, 34, 500); }
        f.tex.needsUpdate = true;
      }
      f.sp.visible = !!txt;
    }
    {
      const z = this.zn, on2 = z.st === 2, pu = 0.65 + 0.35 * Math.sin(this.time * 5);
      const zq = this.qLv;
      z.ring.visible = z.out.visible = on2; z.wall.visible = on2 && zq < 2; z.tgt.visible = z.st === 1; z.beam.visible = z.st > 0 && zq < 2; z.glow.visible = z.st > 0 && zq < 2;
      if (z.st > 0) {
        z.beam.position.x = z.glow.position.x = z.cx; z.beam.position.z = z.glow.position.z = z.cz; z.beam.material.opacity = 0.25 + 0.2 * pu; z.glow.scale.setScalar(0.8 + 0.3 * pu);
        if (on2) { const zm = this._zm || (this._zm = [z.ring, z.wall, z.out]); for (let q = 0; q < 3; q++) { const m = zm[q]; m.position.x = z.cx; m.position.z = z.cz; m.scale.set(z.r, 1, z.r); } z.ring.material.opacity = 0.6 + 0.4 * pu; }
        else { z.tgt.position.x = z.cx; z.tgt.position.z = z.cz; z.tgt.scale.set(z.rt, 1, z.rt); z.tgt.material.opacity = 0.35 + 0.6 * pu; }
      }
    }
    // auras (local player)
    if (me.alive && me.shield > 0) { this.aura.visible = true; this.aura.position.set(me.lx, me.maxR, me.lz); this.aura.scale.setScalar(me.maxR * 1.18 + 0.4); } else this.aura.visible = false;
    if (me.alive && me.magnet > 0) { this.ring.visible = true; this.ring.position.set(me.lx, 0.3, me.lz); this.ring.scale.setScalar(me.maxR + 14); } else this.ring.visible = false;
    // name sprites
    const camH = this.camH, camX = this.camX, camZ = this.camZ, king = this.king, woR = this.woVis();
    for (let i = 0; i < NOWN; i++) {
      const o = owners[i], sp = o.sprite;
      if (!o.alive || (o.hideT > 0 && i !== this.me)) { sp.visible = false; continue; }
      const isM = i === this.me;
      if (!isM && woR && (o.lx - me.lx) * (o.lx - me.lx) + (o.lz - me.lz) * (o.lz - me.lz) > woR * woR) { sp.visible = false; continue; }
      sp.visible = true;
      const w = Math.max(o.maxR * 2.2, camH * 0.1) * (isM ? 1.3 : 0.8);
      sp.scale.set(w, w * 0.25, 1);
      sp.position.set(o.lx, o.maxR + 0.3 + w * 0.1 + (isM ? w * 0.08 : 0) + (o === king ? w * 0.35 : 0), o.lz + o.maxR * 0.2);
      sp.renderOrder = isM ? 12 : 10; sp.material.opacity = isM ? 1 : 0.8;
    }
    // local player ring + crown + height caps / occlusion fade
    const mr = this.meRing, pls = 0.5 + 0.5 * Math.sin(this.time * 6);
    if (me.alive) { mr.visible = true; mr.position.set(me.lx, 0.6, me.lz); mr.scale.setScalar(me.maxR * (1.12 + 0.08 * pls) + 0.8); mr.material.color.setHex(me.col); mr.material.opacity = 0.85 + 0.15 * pls; } else mr.visible = false;
    { const sh = this.meShadow; if (me.alive) { sh.visible = true; sh.position.set(me.lx + me.maxR * 0.08, 0.4, me.lz + me.maxR * 0.14); sh.scale.setScalar(me.maxR * 1.32 + 1); } else sh.visible = false;
      const pr = this.pulseRing; if (this.pulseT >= 0 && me.alive) { this.pulseT += 0.016; const q = this.pulseT / 1.1; if (q >= 1) { this.pulseT = -1; pr.visible = false; } else { pr.visible = true; pr.position.set(me.lx, 0.7, me.lz); pr.scale.setScalar(me.maxR * (1.2 + q * 3.5) + 2); pr.material.opacity = 0.9 * (1 - q); } } else pr.visible = false; }
    const cr = this.crown;
    if (king && king.alive) { const cs = Math.max(king.maxR * 1.1, camH * 0.06); { const bm = this.beam, bh = camH * 1.6, bw = Math.max(king.maxR * 0.5, camH * 0.012); bm.visible = true; bm.position.set(king.lx, bh * 0.5, king.lz); bm.scale.set(bw, bh, bw); const kd = me.alive ? Math.hypot(king.lx - me.lx, king.lz - me.lz) / (camH * 0.9) : 1; bm.material.opacity = (0.26 + 0.1 * Math.sin(this.time * 4)) * Math.min(1, Math.max(0.15, kd * kd)); } cr.visible = true; cr.position.set(king.lx, king.maxR * 2 + cs * 0.5, king.lz); cr.scale.setScalar(cs); if (this.qLv < 2) cr.rotation.y = this.time * 1.6; } else { cr.visible = false; if (this.beam) this.beam.visible = false; }
    this.burRingM.opacity = 0.45 + 0.25 * Math.sin(this.time * 3);
    this.discover(me, king, camH);
    {
      const cs = this.cones, cmesh = this.coneMesh;
      if (cs) {
        let cdirty = false;
        const cap = camH * 0.16, m4 = this._m4 || (this._m4 = new THREE.Matrix4()), pv = this._pv || (this._pv = new THREE.Vector3()), sv = this._sv || (this._sv = new THREE.Vector3());
        for (let k = 0; k < cs.length; k++) {
          const c = cs[k]; let h = Math.min(c[2], cap);
          if (Math.abs(c[0] - camX) < c[3] + 5 + camH * 0.1 && c[1] - c[3] < camZ + h * 0.8 + camH * 0.08 && c[1] + c[3] > camZ - 4 - camH * 0.04) h *= 0.18;
          if (Math.abs(h - (c[5] || 0)) < 0.05) continue;
          c[5] = h; cdirty = true;
          cmesh.setMatrixAt(k, m4.compose(pv.set(c[0], h / 2, c[1]), c[4], sv.set(c[3], h, c[3])));
        }
        if (cdirty) cmesh.instanceMatrix.needsUpdate = true;
      }
      const fs = Math.max(0.35, Math.min(1, camH * 0.3 / 30));
      for (const f of this.forts) {
        if (!f.grp) continue;
        f.grp.scale.y = fs;
        const near = Math.abs(me.lx - f.x) < FR + 30 && me.lz - f.z > -FR - 30 && me.lz - f.z < FR + 10 + camH * 0.4;
        const op = near ? 0.28 : 1;
        if (f.wallM.opacity !== op) { f.wallM.transparent = f.twM.transparent = near; f.wallM.opacity = f.twM.opacity = op; f.wallM.depthWrite = f.twM.depthWrite = !near; f.wallM.needsUpdate = f.twM.needsUpdate = true; }
      }
    }
  }

  discover(me, king, camH) {
    const hud = this.hud, cam = this._camera, W = this.sz.x || 1, H = this.sz.y || 1;
    if (!cam) return;
    let L = this._lbls; if (!L) { L = this._lbls = []; try { this._seen = JSON.parse(localStorage.getItem('patpat.agar.seen') || '{}') || {}; } catch (e) { this._seen = {}; } this._pv3 = new THREE.Vector3(); this._dT = 0; }
    const v = this._pv3, play = this.state === 'play';
    let ar = this._kArrow;
    if (!ar) { ar = this._kArrow = document.createElement('div'); ar.style.cssText = 'position:absolute;left:0;top:0;font-size:26px;color:#ffd23a;text-shadow:0 2px 0 #3a2a00,0 0 8px #ffb400;pointer-events:none;opacity:0;font-weight:900;z-index:3'; hud.root.appendChild(ar); }
    let showAr = false;
    if (play && king && king.alive && king.id !== this.me) {
      v.set(king.lx, 0, king.lz).project(cam);
      const off = v.z > 1 || Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.88;
      if (off) {
        let dx = v.x, dy = v.y; if (v.z > 1) { dx = -dx; dy = -dy; }
        const k = Math.max(Math.abs(dx) / 0.9, Math.abs(dy) / 0.8, 1e-4), px = (dx / k * 0.5 + 0.5) * W, py = (-dy / k * 0.5 + 0.5) * H;
        ar.style.transform = 'translate(' + (px - 16) + 'px,' + (py - 16) + 'px) rotate(' + Math.atan2(-dy, dx) * 57.3 + 'deg)'; ar.textContent = '➤'; showAr = true;
      }
    }
    ar.style.opacity = showAr ? '1' : '0';
    // threat / prey cues
    { let TR = this._thr;
      if (!TR) { TR = this._thr = { rings: [], ars: [], gm: new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2) }; }
      let ri = 0, ai = 0;
      if (play && me.alive) {
        const mm = me.maxM, dg = Math.max(60, me.maxR * 7);
        for (let k = 0; k < NOWN; k++) {
          const o = this.owners[k]; if (o === me || !o.alive || o.cellN < 1 || o.hideT > 0) continue;
          const dx = o.lx - me.lx, dz = o.lz - me.lz, d = Math.sqrt(dx * dx + dz * dz) - o.maxR - me.maxR;
          const thr = o.maxM > mm * EAT_K, prey = !thr && !o.boss && mm > o.maxM * EAT_K;
          if (!thr && !prey) continue;
          if (d > (thr ? dg : dg * 0.5)) continue;
          if (ri < 10) {
            let r = TR.rings[ri];
            if (!r) { r = TR.rings[ri] = new THREE.Mesh(TR.gm, new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })); this._scene.add(r); }
            r.visible = true; r.material.color.setHex(thr ? 0xff3a3a : 0x5cff8a); r.material.opacity = thr ? 0.55 + 0.35 * Math.sin(this.time * 9) : 0.4;
            r.position.set(o.lx, 0.5, o.lz); r.scale.setScalar(o.maxR * 1.12 + 1); ri++;
          }
          if (thr && ai < 3) {
            v.set(o.lx, 0, o.lz).project(cam);
            if (v.z > 1 || Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.88) {
              let e = TR.ars[ai]; if (!e) { e = TR.ars[ai] = document.createElement('div'); e.style.cssText = 'position:absolute;left:0;top:0;font-size:22px;color:#ff3a3a;text-shadow:0 2px 0 #3a0000,0 0 8px #ff0000;pointer-events:none;font-weight:900;z-index:3;display:none'; e.textContent = '➤'; hud.root.appendChild(e); }
              let ex = v.x, ey = v.y; if (v.z > 1) { ex = -ex; ey = -ey; }
              const kk = Math.max(Math.abs(ex) / 0.9, Math.abs(ey) / 0.8, 1e-4), px = (ex / kk * 0.5 + 0.5) * W, py = (-ey / kk * 0.5 + 0.5) * H;
              e.style.display = 'block'; e.style.transform = 'translate(' + (px - 12) + 'px,' + (py - 12) + 'px) rotate(' + Math.atan2(-ey, ex) * 57.3 + 'deg)'; ai++;
            }
          }
        }
      }
      for (let q = ri; q < TR.rings.length; q++) TR.rings[q].visible = false;
      for (let q = ai; q < TR.ars.length; q++) TR.ars[q].style.display = 'none';
    }
    for (let i = L.length - 1; i >= 0; i--) { const l = L[i]; if (this.time > l.until || !play) { l.el.remove(); L.splice(i, 1); continue; }
      v.set(l.x, l.y, l.z).project(cam); const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      l.el.style.opacity = vis ? '1' : '0'; if (vis) l.el.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * W) + 'px,' + ((-v.y * 0.5 + 0.5) * H) + 'px) translate(-50%,-100%)'; }
    if (!play || this.time < this._dT) return;
    this._dT = this.time + 0.3;
    const seen = this._seen, inV = (x, y, z) => { v.set(x, y, z).project(cam); return v.z < 1 && Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8; };
    const add = (key, txt, x, y, z) => {
      seen[key] = 1; try { localStorage.setItem('patpat.agar.seen', JSON.stringify(seen)); } catch (e) { /* ignore */ }
      const el = document.createElement('div'); el.style.cssText = 'position:absolute;left:0;top:0;padding:3px 9px;border-radius:10px;font:900 14px "Trebuchet MS",system-ui,sans-serif;color:#fff;background:rgba(10,42,74,.78);border:2px solid #ffe066;white-space:nowrap;pointer-events:none;z-index:3;transition:opacity .3s';
      el.textContent = txt; hud.root.appendChild(el); L.push({ el, x, y, z, until: this.time + 3 });
    };
    if (!seen.king && king && king.alive && king.id !== this.me && inV(king.lx, 0, king.lz)) add('king', 'KRAL ♛', king.lx, king.maxR * 2 + camH * 0.12, king.lz);
    if (!seen.bur) for (let b = 0; b < NBUR; b++) if (inV(BUR[b].x, 0, BUR[b].z)) { add('bur', 'YUVA: saklan!', BUR[b].x, BUR_R * 1.2, BUR[b].z); break; }
    if (!seen.fort) for (const f of this.forts) if (inV(f.x, 0, f.z)) { add('fort', 'KALE: ele geçir', f.x, 14, f.z); break; }
    if (!seen.crys) for (let q = 0; q < NVIR; q++) if (this.von[q] && inV(this.vx[q], 0, this.vz[q])) { add('crys', 'KRİSTAL: büyükleri patlatır', this.vx[q], 5, this.vz[q]); break; }
  }

  tierBanner(t) {
    this.toast('🔼 ' + TIER_NAMES[t] + ' boyutu!' + (TIER_HINT[t] ? ' ' + TIER_HINT[t] : ''), 2000);
    this.camKick = 0.35;
    if (this.mp !== 'client') this.owners[this.me].xpRun += 25 * t;
    this.audio?.milestone?.(Math.min(6, t + 1));
    this.platform?.haptic?.('success');
  }

  /** per-frame watchers: terrain-entry sounds, size titles, storm rumble */
  watch(dt) {
    const me = this.owners[this.me];
    if (!me.alive || this.state !== 'play') this._pm = 0;
    if (me.alive && this.state === 'play') {
      const z = this.terrain.zone(me.lx, me.lz);
      if (z !== this.meZone) { this.meZone = z; if (z === 2) this.snd('deep'); else if (z === 1) this.snd('slide'); }
      if (this._pm > 0 && me.mass < this._pm * 0.6 && this.time > (this._cbT || 0)) {
        this._cbT = this.time + 8;
        if (this.mp !== 'client') {
          me.shield = Math.max(me.shield, 4);
          const ux = me.cx, uz = me.cz, hex = FOOD_PAL[(Math.random() * FOOD_PAL.length) | 0];
          for (let k = 0; k < 14; k++) { const a = Math.random() * 6.2832, d = 8 + Math.random() * 10, px = ux + Math.cos(a) * d, pz = uz + Math.sin(a) * d; if (px * px + pz * pz < (R - 4) * (R - 4)) this.spawnPellet(px, pz, 2, hex); }
        }
        this.toast('TOPARLAN! 🛡️', 2000);
      }
      this._pm = me.mass;
      { const MS = [100, 250, 500, 1000]; while (this.msIdx < MS.length && me.mass >= MS[this.msIdx]) { this.toast('KÜTLE ' + MS[this.msIdx] + '! 🔥', 2000); this.pulseT = 0; this.camKick = Math.max(this.camKick, 0.28); this.audio?.milestone?.(Math.min(6, 2 + this.msIdx)); this.msIdx++; } }
      const ct = tierOfM(me.mass);
      if (ct > this.cigTier) { this.cigTier = ct; this.tierBanner(ct); }
      const ti = titleOf(me.mass);
      if (ti > this.titleIdx) { this.titleIdx = ti; this.toast('★ ' + TITLES[ti][1] + '!'); this.audio?.milestone?.(Math.min(6, ti)); }
    }
    if (!me.alive) this.cigTier = 0;
    const st = this.storm;
    if (st.on && this.state !== 'title') {
      this.stormSndT -= dt;
      if (this.stormSndT <= 0) {
        this.stormSndT = 3;
        const v = clampN(1 - Math.hypot(st.x - this.camX, st.z - this.camZ) / (st.r * 3.5), 0, 1);
        if (v > 0.05) this.audio?.arena?.('storm', v);
      }
    }
  }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const root = document.createElement('div');
    root.id = 'ag-root';
    root.className = 'ag-root';
    root.innerHTML =
      '<div class="ag-tl"><div class="ag-mass"><div class="r1"><b class="m">0</b><span class="ag-rank"><b>-</b></span></div><small class="tt"></small><small class="rg" style="display:block;font-size:10px;color:#ffe9a8;font-weight:900"></small><div class="ag-lvl"><span class="lv">Sv 1</span><div class="bar"><i></i></div></div></div>' +
      '<div class="ag-room"></div><div class="ag-feed"></div><div class="ag-chips"></div></div>' +
      '<div class="ag-tr"><div class="ag-lb"><div class="t"><span>LİDERLER</span><span class="ag-online">🟢<span class="on">0</span></span><span class="tg">▾</span></div><div class="rows"></div></div><canvas class="ag-map" width="84" height="84"></canvas></div><div class="ag-zn"></div>' +
      '<div class="ag-stick"><i></i></div><div class="ag-toast" style="top:calc(env(safe-area-inset-top,0px) + 82px);padding:0 8px;font-size:15px;text-shadow:0 2px 0 #0a2a4a;pointer-events:none"></div><div class="ag-avw" style="position:absolute;left:0;right:0;top:12%;text-align:center;font-size:34px;font-weight:900;color:#ff5a4d;text-shadow:0 3px 0 #3a0a0a,2px 2px 0 #3a0a0a,-2px 2px 0 #3a0a0a;pointer-events:none;opacity:0;transition:opacity .2s"></div><div class="ag-tip" style="position:absolute;left:8%;right:8%;top:25%;text-align:center;font-size:15px;color:#fff;background:rgba(10,42,74,.7);border-radius:14px;padding:10px 14px;pointer-events:none;opacity:0;transition:opacity .4s"></div><div class="ag-arrow" style="position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;opacity:0;transition:opacity .4s"><div style="position:absolute;left:-14px;top:-150px;font-size:34px;color:#ffe066;opacity:.7">▲</div></div>' +
      '<div class="ag-btns"><button type="button" class="ag-act split"><span>✂️</span><small>BÖL</small></button>' +
      '<button type="button" class="ag-act eject"><span>❄️</span><small>FIRLAT</small></button>' +
      '<button type="button" class="ag-act boost"><span>🚀</span><small>HIZLAN</small><i class="cd"></i></button></div>';
    const st = document.createElement('style');
    st.textContent = '#ag-root .ag-btns{position:absolute;right:0;bottom:calc(var(--sab,0px) + 18px);width:min(240px,64vw);height:190px;display:block;pointer-events:none}#ag-root .ag-act{position:absolute;margin:0;width:80px;height:80px;font-weight:900}#ag-root .ag-act span{font-size:28px}#ag-root .ag-act small{font-size:12px;letter-spacing:.03em;margin-top:3px}#ag-root .ag-act.boost{right:12px;bottom:0;width:100px;height:100px}#ag-root .ag-act.boost span{font-size:36px}#ag-root .ag-act.boost small{font-size:13px}#ag-root .ag-act.split{right:96px;bottom:104px;background:linear-gradient(180deg,#d28bff,#8a3fe0);box-shadow:0 6px 0 #4a1c8a,inset 0 3px 0 rgba(255,255,255,.4)}#ag-root .ag-act.eject{right:126px;bottom:6px;width:76px;height:76px;background:linear-gradient(180deg,#9fe9ff,#2fa6e8);box-shadow:0 6px 0 #165f93,inset 0 3px 0 rgba(255,255,255,.45)}#ag-root .ag-tl{width:130px}#ag-root .ag-mass{padding:4px 9px 5px}#ag-root .ag-mass .r1{display:flex;align-items:baseline;justify-content:space-between;gap:6px}#ag-root .ag-mass b.m{font-size:26px}#ag-root .ag-rank{background:none;border:0;box-shadow:none;padding:0;font-size:13px;font-weight:900;color:#bfe6ff}#ag-root .ag-rank b{font-size:14px;color:#bfe6ff}#ag-root .ag-mass .tt{display:block;font-size:10px;margin:0}#ag-root .ag-lvl{background:none;border:0;box-shadow:none;padding:0;margin-top:2px;font-size:10px}#ag-root .ag-lb{width:126px;padding:3px 6px}#ag-root .ag-lb .t{display:flex;justify-content:space-between;align-items:center;cursor:pointer;pointer-events:auto;font-size:10px}#ag-root .ag-online{background:none;border:0;box-shadow:none;padding:0;font-size:8px;opacity:.75;letter-spacing:0}#ag-root .ag-lb.col .rows{display:none}#ag-root .ag-map{width:62px;height:62px}#ag-root .ag-zn{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 52px);text-align:center;font:900 16px inherit;font-family:inherit;color:#8ff4ff;text-shadow:0 2px 0 #0a2a4a,1px 1px 0 #0a2a4a,-1px 1px 0 #0a2a4a;pointer-events:none;opacity:0;transition:opacity .3s}';
    root.appendChild(st);
    this.app.appendChild(root);
    const q = (s) => root.querySelector(s);
    const rows = [];
    const rowsEl = q('.rows');
    for (let i = 0; i < 6; i++) { const d = document.createElement('div'); d.className = 'row'; d.innerHTML = '<span class="n"></span><span class="v"></span>'; rowsEl.appendChild(d); rows.push(d); }
    const chips = [];
    for (let i = 0; i < 3; i++) { const d = document.createElement('div'); d.className = 'chip'; q('.ag-chips').appendChild(d); chips.push(d); }
    const feeds = [];
    for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'f'; q('.ag-feed').appendChild(d); feeds.push(d); }
    const tier = document.createElement('div');
    tier.style.cssText = 'position:absolute;left:0;right:0;top:20%;text-align:center;pointer-events:none;opacity:0;transform:scale(.6);transition:opacity .35s,transform .45s cubic-bezier(.2,1.6,.4,1);text-shadow:0 3px 0 #0a2a4a,2px 2px 0 #0a2a4a,-2px 2px 0 #0a2a4a;';
    tier.innerHTML = '<div style="font-size:20px;color:#ffe066">YENİ BÖLGE!</div><div style="font-size:48px;font-weight:900"></div><div style="font-size:15px;color:#cfe8ff"></div>';
    root.appendChild(tier);
    this.hud = {
      tier, root, rows, chips, feeds, mass: q('.m'), tt: q('.tt'), rg: q('.rg'), lv: q('.lv'), bar: q('.bar i'), online: q('.on'), room: q('.ag-room'), rank: q('.ag-rank b'), stick: q('.ag-stick'), knob: q('.ag-stick i'), toast: q('.ag-toast'), av: q('.ag-avw'), zn: q('.ag-zn'), lbBox: q('.ag-lb'), tip: q('.ag-tip'), arrow: q('.ag-arrow'),
      map: q('.ag-map'), mctx: q('.ag-map').getContext('2d'), boost: q('.boost'), cd: q('.cd'), bsplit: q('.split'), beject: q('.eject'), btns: q('.ag-btns'),
    };
    { const w = document.createElement('div'); w.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;z-index:3;will-change:opacity'; root.appendChild(w); this.hud.wo = w; }
    { const w = document.createElement('div'); w.style.cssText = 'position:absolute;left:50%;top:46px;transform:translateX(-50%);width:min(300px,56vw);pointer-events:none;z-index:4;display:none;text-align:center;font:900 13px "Trebuchet MS",system-ui,sans-serif;color:#ffe9a8;text-shadow:0 1px 3px #000'; w.innerHTML = '<span>BOSS TOPU</span><div style="height:11px;margin-top:3px;border-radius:6px;background:rgba(20,10,40,.7);border:2px solid #ffd35a;overflow:hidden"><i style="display:block;height:100%;width:100%;background:linear-gradient(90deg,#b13cff,#ff4f86)"></i></div>'; root.appendChild(w); this.hud.bb = w; }
    q('.ag-lb .t').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); const c = this.hud.lbBox.classList.toggle('col'); q('.ag-lb .tg').textContent = c ? '▸' : '▾'; });
    const press = (el, fn) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.audio?.init?.(); fn(); });
    };
    // chat (log is always shown - bots talk too; the input is only offered in online rooms)
    const chat = document.createElement('div');
    chat.className = 'ag-chat';
    chat.innerHTML = '<div class="ag-clog"></div><div class="ag-cpanel"><div class="ag-cin"><input maxlength="80" placeholder="Mesaj yaz..." autocomplete="off"><button type="button">➤</button></div><div class="ag-cq"></div></div><button type="button" class="ag-cbtn">💬</button>';
    root.appendChild(chat);
    const cl = chat.querySelector('.ag-clog'), cin = chat.querySelector('input'), cpanel = chat.querySelector('.ag-cpanel'), cbtn = chat.querySelector('.ag-cbtn');
    const cels = [];
    for (let i = 0; i < 6; i++) { const d = document.createElement('div'); d.className = 'ag-cl'; d.innerHTML = '<b></b><span></span>'; cl.appendChild(d); cels.push(d); }
    const send = () => { const t = cin.value; cin.value = ''; if (t.trim()) this.sendChat(t); };
    chat.querySelector('.ag-cin button').addEventListener('click', () => { this.audio?.init?.(); send(); });
    cin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { send(); e.preventDefault(); } e.stopPropagation(); });
    cin.addEventListener('keyup', (e) => e.stopPropagation());
    for (const ph of ['Selam!', 'GG', 'Kaç!', 'Takım?']) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = ph;
      b.addEventListener('click', () => { this.audio?.init?.(); this.sendChat(ph); });
      chat.querySelector('.ag-cq').appendChild(b);
    }
    cbtn.addEventListener('click', () => { this.audio?.init?.(); this.audio?.ui?.('click'); cpanel.classList.toggle('on'); if (cpanel.classList.contains('on')) { try { cin.focus(); } catch { /* ignore */ } } });
    this.hud.chat = { root: chat, els: cels, btn: cbtn, panel: cpanel };
    // exit to the main menu: first tap arms, second tap (within 2.5 s) leaves
    const quit = document.createElement('button');
    quit.type = 'button'; quit.className = 'ag-quit'; quit.textContent = '✕ MENÜ';
    quit.style.cssText = 'position:absolute;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);z-index:5;padding:7px 14px;border-radius:14px;border:3px solid #0a2a4a;background:#ff5a5f;color:#fff;font:900 14px inherit;font-family:inherit;box-shadow:0 4px 0 #0a2a4a;pointer-events:auto;cursor:pointer;';
    let armT = 0;
    quit.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); this.audio?.init?.();
      const now = performance.now();
      if (now - armT < 2500) { this.audio?.ui?.('back'); this.exit(); return; }
      armT = now; quit.textContent = 'EMİN MİSİN? TEKRAR BAS'; this.audio?.ui?.('click');
      setTimeout(() => { if (performance.now() - armT >= 2400) quit.textContent = '✕ MENÜ'; }, 2500);
    });
    root.appendChild(quit);
    this.hud.quit = quit;
    this._escKey = (e) => { if (e.key === 'Escape' && !this.disposed) { e.preventDefault(); this.exit(); } };
    window.addEventListener('keydown', this._escKey);
    press(this.hud.boost, () => this.doBoost());
    press(this.hud.bsplit, () => this.doSplit());
    press(this.hud.beject, () => this.doEject());
  }

  duelHud() {
    const D = this.duel, h = this.hud;
    if (!h.duelEl) {
      const w = document.createElement('div'); w.style.cssText = 'position:absolute;left:50%;top:38%;transform:translateX(-50%);width:min(220px,50vw);pointer-events:none;z-index:4;display:none;text-align:center;font:900 12px "Trebuchet MS",system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000';
      w.innerHTML = '<span>GÜREŞ</span><div style="position:relative;height:10px;margin-top:2px;border-radius:6px;background:#e8584a;border:2px solid #fff;overflow:hidden"><i style="display:block;height:100%;width:50%;background:#4ab0ff"></i></div><div style="display:flex;justify-content:space-between;font-size:10px"><b></b><b></b></div>';
      h.root.appendChild(w); h.duelEl = w; h.duelBar = w.querySelector('i'); h.duelN = w.querySelectorAll('b');
      const rg = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      rg.position.y = 0.8; rg.renderOrder = 6; rg.visible = false; this._scene.add(rg); h.duelRing = rg;
    }
    const on = D.on && this.state === 'play';
    h.duelEl.style.display = on ? 'block' : 'none'; h.duelRing.visible = on;
    if (!on) return;
    const oa = this.owners[D.a], ob = this.owners[D.b];
    h.duelRing.position.x = D.cx; h.duelRing.position.z = D.cz; h.duelRing.scale.setScalar(D.r);
    h.duelBar.style.width = ((D.s + 1) * 50).toFixed(0) + '%';
    h.duelN[0].textContent = oa.name; h.duelN[1].textContent = ob.name;
  }

  updateHud(dt) {
    const h = this.hud, me = this.owners[this.me];
    this.duelHud();
    this.hudT -= dt; this.lbT -= dt; this.mapT -= dt;
    if (this.state === 'play' && !this.tipDone) {
      if (this.tipT === 0 && lsGet(TIP_KEY, '') === '1') this.tipDone = true;
      else {
        if (this.tipT === 0) { h.tip.textContent = 'Sürükle: yön · HIZLAN: atıl · BÖL: ikiye bölün · küçükleri ye, büyüklerden kaç'; lsSet(TIP_KEY, '1'); if (lsGet(TIP_KEY + '.v', '') !== '1') { lsSet(TIP_KEY + '.v', '1'); this.toast('❄ Buz dikeni büyükleri böler — arkasına saklan!', 3200); } }
        this.tipT += dt;
        h.tip.style.opacity = this.tipT < 5 ? '1' : '0';
        if (false) {
          if (this.arrT === undefined || this.time - this.arrT > 0.4) {
            this.arrT = this.time; let sx = 0, sz = 0, n = 0;
            for (let k = 0; k < 160; k++) { const i = (Math.random() * FOOD) | 0; if (this.fv[i] <= 0) continue; const d = Math.hypot(this.fx[i] - me.cx, this.fz[i] - me.cz); if (d < 40 || d > 320) continue; sx += this.fx[i] - me.cx; sz += this.fz[i] - me.cz; n++; }
            if (n) this.arrAng = Math.atan2(sx, -sz);
            this.arrOn = n > 0;
          }
          h.arrow.style.opacity = this.arrOn ? '1' : '0'; h.arrow.style.transform = 'rotate(' + (this.arrAng || 0) + 'rad)';
        } else { h.arrow.style.opacity = '0'; if (this.tipT >= 30) this.tipDone = true; }
      }
    }
    if (this.state === 'play' && me.alive && this.time - me.t0 < 60) {
      if (this.arrT === undefined || this.time - this.arrT > 0.35) {
        this.arrT = this.time; let bd = 160, tx = 0, tz = 0, f = false;
        for (let k = 0; k < NOWN; k++) { const o = this.owners[k]; if (o === me || !o.alive || o.mass > me.mass * 0.8) continue; const d = Math.hypot(o.cx - me.cx, o.cz - me.cz); if (d < bd) { bd = d; tx = o.cx - me.cx; tz = o.cz - me.cz; f = true; } }
        if (!f) { bd = 260; for (let i = FOOD; i < FT; i++) { if (this.fv[i] < 2) continue; const d = Math.hypot(this.fx[i] - me.cx, this.fz[i] - me.cz); if (d > 12 && d < bd) { bd = d; tx = this.fx[i] - me.cx; tz = this.fz[i] - me.cz; f = true; } } }
        if (!f) { let sx = 0, sz = 0, n = 0; for (let k = 0; k < 160; k++) { const i = (Math.random() * FOOD) | 0; if (this.fv[i] <= 0) continue; const d = Math.hypot(this.fx[i] - me.cx, this.fz[i] - me.cz); if (d < 30 || d > 320) continue; sx += this.fx[i] - me.cx; sz += this.fz[i] - me.cz; n++; } if (n) { tx = sx; tz = sz; f = true; } }
        this.arrOn = f; if (f) this.arrAng = Math.atan2(tx, -tz);
      }
      h.arrow.style.opacity = this.arrOn ? '0.9' : '0'; h.arrow.style.transform = 'rotate(' + (this.arrAng || 0) + 'rad)';
    } else if (this.arrOn) { this.arrOn = false; h.arrow.style.opacity = '0'; }
    if (this.feedDirty || this.hudT <= 0) {
      for (let i = 0; i < 4; i++) { const f = this.feed[i], e = h.feeds[i]; const on = f.until > this.time; if (e._t !== f.t || e._on !== on) { e.textContent = on ? f.t : ''; e.style.opacity = on ? '1' : '0'; e._t = f.t; e._on = on; } }
      this.feedDirty = false;
    }
    if (this.lbT <= 0) {
      this.lbT = 0.25;
      let n = 0;
      for (let i = 0; i < NOWN; i++) if (this.owners[i].alive && !this.owners[i].boss) this.lb[n++] = this.owners[i];
      this.lbN = n; this.lb.length = n;
      this.lb.sort(this._lbCmp);
      { const k0 = this.lb[0]; this.king = k0 && n >= 3 && k0.mass > 60 ? k0 : null; this.kingId = this.king ? this.king.id : -1; }
      let myRank = -1;
      for (let i = 0; i < n; i++) if (this.lb[i] === me) { myRank = i; break; }
      for (let i = 0; i < 5; i++) {
        const r = h.rows[i], o = this.lb[i];
        if (o) { r.style.display = 'flex'; r.classList.toggle('me', o === me); r.children[0].textContent = (i + 1) + '. ' + o.name; r.children[1].textContent = fmtM(o.mass); } else r.style.display = 'none';
      }
      const yr = h.rows[5];
      if (myRank >= 5) { yr.style.display = 'flex'; yr.classList.add('me'); yr.children[0].textContent = (myRank + 1) + '. ' + me.name; yr.children[1].textContent = fmtM(me.mass); } else yr.style.display = 'none';
      if (myRank >= 0 && this.state === 'play') {
        if (myRank < this.prevRank && this.prevRank < 99) { const row = myRank < 5 ? h.rows[myRank] : yr; if (row.animate) row.animate([{ background: 'rgba(255,224,102,0.9)' }, { background: 'rgba(255,224,102,0)' }], { duration: 900 }); }
        this.prevRank = myRank;
      } else this.prevRank = 99;
      if (this.state === 'play' && this.lb[0]) { this.sumT += 0.25; if (this.sumT >= 300) { this.sumT = 0; this.toast('En büyük: ' + this.lb[0].name + ' · Sen: ' + (myRank >= 0 ? '#' + (myRank + 1) : '-')); } }
      { const pr = me.alive && me.prot && me.shield > 0;
        h.rank.textContent = pr ? 'KORUMA' : myRank >= 0 ? '#' + (myRank + 1) + '/' + n : '-';
        let g = '';
        if (me.alive && this.state === 'play') { if (myRank > 0) g = 'Sonraki sıra: +' + fmtM(Math.max(1, Math.ceil(this.lb[myRank - 1].mass - me.mass))) + ' kütle'; else if (myRank === 0) g = 'Zirvedesin!'; }
        if (h.rg.textContent !== g) h.rg.textContent = g; }
      h.online.textContent = String(this.mp === 'client' && this.presentN ? this.presentN : this.presentCount());
      if (myRank >= 0 && this.state === 'play' && myRank + 1 < me.bestRank) me.bestRank = myRank + 1;
      if (myRank >= 0 && this.state === 'play' && me.alive) {
        const rk = myRank + 1, rb = this.rankBest === undefined ? 99 : this.rankBest;
        const ms = rk <= 1 ? 1 : rk <= 5 ? 5 : rk <= 10 ? 10 : 0; this.msDone = this.msDone || {};
        if (ms && !this.msDone[ms] && this.time - me.t0 > 15) { for (const q of [1, 5, 10]) if (q >= ms) this.msDone[q] = 1; this.toast(ms === 1 ? '#1! 👑 +bonus' : 'TOP ' + ms + '! +bonus', 2200); this.audio?.milestone?.(ms === 1 ? 4 : 2); if (this.mp !== 'client') for (let i = 0; i < CAP; i++) { const cc = this.cells[i]; if (cc.on && cc.o === this.me) { cc.m = Math.min(MAXM, cc.m + (ms === 1 ? 30 : ms === 5 ? 20 : 12)); break; } } }
        if (rk < rb) { if (rb < 99 && this.time - (this.lastRankToast || 0) > 3) { this.toast('SIRA ' + rb + ' → ' + rk + '!'); this.lastRankToast = this.time; this.audio?.milestone?.(2); } this.rankBest = rk; }
      }
    }
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      { const mv = me.alive ? me.mass : 0; if (mv > (this._lm || 0) + 0.9) { h.mass.style.transition = 'none'; h.mass.style.transform = 'scale(1.25)'; h.mass.style.color = '#ffe066'; void h.mass.offsetWidth; h.mass.style.transition = 'transform .35s,color .5s'; h.mass.style.transform = ''; h.mass.style.color = ''; } this._lm = mv; }
      h.mass.textContent = me.alive ? fmtM(me.mass) : '0';
      h.tt.textContent = TITLES[titleOf(me.alive ? me.mass : 0)][1] + ' · ' + TIER_NAMES[tierOfM(me.alive ? me.mass : 0)];
      const ch = h.chat;
      ch.btn.style.display = this.mp ? '' : 'none';
      if (!this.mp) ch.panel.classList.remove('on');
      if (this.chatDirty) {
        const L = this.chatLog;
        for (let i = 0; i < 6; i++) { const e = ch.els[i], m = L[L.length - 6 + i]; if (m) { e.children[0].textContent = m.n + ': '; e.children[0].style.color = '#' + ('000000' + m.c.toString(16)).slice(-6); e.children[1].textContent = m.x; } else { e.children[0].textContent = ''; e.children[1].textContent = ''; } }
        this.chatDirty = false;
      }
      for (let i = 0; i < 6; i++) { const m = this.chatLog[this.chatLog.length - 6 + i]; ch.els[i].style.opacity = m ? clampN((m.until - this.time) / 1.5, 0, 1).toFixed(2) : '0'; }
      if (this.mp && this.net) { const hn = this.mp === 'host' ? this.net.clients.size + 1 : this.humans; h.room.style.display = ''; h.room.textContent = (this.net.pub === false ? '🔒 ' : this.net.pub ? '🌐 ' : '🏠 ') + this.net.code + ' · ' + hn + '/' + MAX_HUMANS + ' oyuncu'; } else h.room.style.display = 'none';
      const xp = this.xp + me.xpRun, lv = lvlOf(xp), lo = 60 * (lv - 1) * (lv - 1), hi = 60 * lv * lv;
      h.lv.textContent = 'Sv ' + lv;
      h.bar.style.width = clampN(((xp - lo) / (hi - lo)) * 100, 0, 100).toFixed(0) + '%';
      if (lv > this.lastLevel && this.state === 'play') { this.toast('SEVİYE ' + lv + '!'); this.audio?.milestone?.(Math.min(6, lv)); }
      this.lastLevel = lv;
      // chips
      let ci = 0;
      const eff = [[me.magnet, PUP_TYPES[0]], [me.shield, PUP_TYPES[1]], [me.speed, PUP_TYPES[2]]];
      for (let i = 0; i < 3; i++) {
        const [t, d] = eff[i];
        if (t > 0) { const c = h.chips[ci++]; c.style.display = 'block'; if (i === 1 && me.prot) { const q = Math.ceil(t); c.textContent = '🛡 KORUMA ' + Math.floor(q / 60) + ':' + ('0' + (q % 60)).slice(-2); c.style.fontSize = '11px'; } else { c.textContent = d.emoji + ' ' + Math.ceil(t) + 's'; c.style.fontSize = ''; } }
      }
      for (; ci < 3; ci++) h.chips[ci].style.display = 'none';
      const cd = me.boostCd > 0 ? me.boostCd / 2.4 : 0;
      if (cd !== this._cd) { this._cd = cd; h.cd.style.height = (cd * 100).toFixed(0) + '%'; }
    }
    {
      const z = this.zn; let txt = '', col = '#8ff4ff';
      if (z.st === 1) txt = '❄ BUZ ÇEMBERİ! Çember ' + Math.ceil(z.t) + ' sn sonra daralıyor';
      else if (z.st === 2) { const out = me.alive && Math.hypot(me.cx - z.cx, me.cz - z.cz) > z.r; if (out) { txt = '⚠ ÇEMBERİN DIŞINDASIN! Kütle eriyor'; col = '#ff6b5e'; } else txt = '❄ Çemberin içinde kal · ' + Math.max(1, Math.ceil(60 - z.t)) + ' sn'; }
      if (txt !== h.zn._t) { h.zn._t = txt; h.zn.textContent = txt; h.zn.style.opacity = txt ? '1' : '0'; }
      if (txt && h.zn._c !== col) { h.zn._c = col; h.zn.style.color = col; }
    }
    if (this.mapT <= 0) { this.mapT = 0.2; this.drawMap(); }
  }

  drawMap() {
    const g = this.hud.mctx, W = 84, c0 = W / 2, sc = (W / 2 - 3) / R;
    g.clearRect(0, 0, W, W);
    const me = this.owners[this.me];
    const T = this.terrain;
    // static layer (disc, ice, deep snow, patches, burrows) is cached on an offscreen canvas; rebuilt only when the terrain seed changes
    if (!this._mapBg || this._mapSeed !== this.seed) {
      const bc = this._mapBg || (this._mapBg = document.createElement('canvas'));
      bc.width = bc.height = W; const b = bc.getContext('2d'); b.clearRect(0, 0, W, W);
      b.fillStyle = 'rgba(20,50,95,0.55)'; b.beginPath(); b.arc(c0, c0, c0 - 1, 0, 6.2832); b.fill();
      b.fillStyle = 'rgba(140,215,255,0.35)';
      for (let i = 0; i < NICE; i++) { b.beginPath(); b.arc(c0 + T.ice[i * 3] * sc, c0 + T.ice[i * 3 + 1] * sc, Math.max(1, T.ice[i * 3 + 2] * sc), 0, 6.2832); b.fill(); }
      b.fillStyle = 'rgba(255,255,255,0.22)';
      for (let i = 0; i < NDEEP; i++) { b.beginPath(); b.arc(c0 + T.deep[i * 3] * sc, c0 + T.deep[i * 3 + 1] * sc, Math.max(1, T.deep[i * 3 + 2] * sc), 0, 6.2832); b.fill(); }
      if (this.patches) for (const p of this.patches) { b.fillStyle = '#' + ('000000' + p[3].toString(16)).slice(-6); b.globalAlpha = 0.28; b.beginPath(); b.arc(c0 + p[0] * sc, c0 + p[1] * sc, Math.max(1, p[2] * sc), 0, 6.2832); b.fill(); }
      b.globalAlpha = 1; b.fillStyle = '#1a2a4a'; b.strokeStyle = '#eaf6ff'; b.lineWidth = 1;
      for (let k = 0; k < NBUR; k++) { b.beginPath(); b.arc(c0 + BUR[k].x * sc, c0 + BUR[k].z * sc, 2, 0, 6.2832); b.fill(); b.stroke(); }
      this._mapSeed = this.seed;
    }
    g.drawImage(this._mapBg, 0, 0);
    if (this.revId >= 0 && this.time < (this.revT || 0)) { const ro = this.owners[this.revId]; if (ro && ro.alive) { const rx = c0 + ro.cx * sc, rz = c0 + ro.cz * sc; g.fillStyle = '#ff2a2a'; g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.arc(rx, rz, 3.2, 0, 6.2832); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.font = '700 7px sans-serif'; g.textAlign = 'center'; g.fillText('İNTİKAM', Math.min(W - 16, Math.max(16, rx)), Math.max(8, rz - 5)); g.textAlign = 'start'; } }
    const wr = this.wo.k > 0.35 && me.alive ? Math.max(6, this.woVis() * sc * 1.3) : 0;
    if (wr) { g.save(); g.beginPath(); g.arc(c0 + me.cx * sc, c0 + me.cz * sc, wr, 0, 6.2832); g.clip(); }
    if (this.rain.st) { const rx = c0 + this.rain.x * sc, rz = c0 + this.rain.z * sc, pu = 0.6 + 0.4 * Math.sin(this.time * 8); g.strokeStyle = this.rain.st === 1 ? 'rgba(255,220,60,' + pu + ')' : '#ffd23f'; g.fillStyle = 'rgba(255,210,60,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(rx, rz, Math.max(5, 65 * sc), 0, 6.2832); g.fill(); g.stroke(); }
    if (this.storm.on) { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.arc(c0 + this.storm.x * sc, c0 + this.storm.z * sc, this.storm.r * sc, 0, 6.2832); g.stroke(); }
    if (this.zn.st > 0) { const z = this.zn; g.strokeStyle = z.st === 1 ? '#ff6b5e' : '#6ff2ff'; g.lineWidth = 1.5; g.beginPath(); g.arc(c0 + z.cx * sc, c0 + z.cz * sc, (z.st === 1 ? z.rt : z.r) * sc, 0, 6.2832); g.stroke(); }
    for (const f of this.forts) if (f.pa > 0 && f.pc >= 0) { g.fillStyle = '#' + ('000000' + this.owners[f.pc].col.toString(16)).slice(-6); g.globalAlpha = 0.35 * f.pa; g.beginPath(); g.arc(c0 + f.x * sc, c0 + f.z * sc, PAINT_R * sc, 0, 6.2832); g.fill(); g.globalAlpha = 1; }
    for (const f of this.forts) {
      const fo = f.own >= 0 ? this.owners[f.own] : null;
      g.fillStyle = fo ? '#' + ('000000' + fo.col.toString(16)).slice(-6) : 'rgba(255,255,255,0.5)'; g.strokeStyle = '#fff'; g.lineWidth = 1;
      g.beginPath(); g.rect(c0 + f.x * sc - 4, c0 + f.z * sc - 4, 8, 8); g.fill(); g.stroke(); g.strokeStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(c0 + f.x * sc, c0 + f.z * sc, 7, 0, 6.2832); g.stroke();
    }
    for (let i = 0; i < NOWN; i++) {
      const o = this.owners[i];
      if (!o.alive || o === me || o.hideT > 0) continue;
      if (wr && Math.hypot(o.cx - me.cx, o.cz - me.cz) * sc > wr) continue;
      g.fillStyle = o.mass > me.mass * EAT_K && me.alive ? '#ff6b6b' : '#d8ecff';
      const s = 1.2 + Math.min(2.2, Math.log10(o.mass + 1) * 0.6);
      g.fillRect(c0 + o.cx * sc - s / 2, c0 + o.cz * sc - s / 2, s, s);
    }
    if (me.alive) { g.fillStyle = '#ffe066'; g.beginPath(); g.arc(c0 + me.cx * sc, c0 + me.cz * sc, 3, 0, 6.2832); g.fill(); }
    if (wr) { g.restore(); g.fillStyle = 'rgba(225,238,255,0.55)'; g.beginPath(); g.arc(c0, c0, c0 - 1, 0, 6.2832); g.arc(c0 + me.cx * sc, c0 + me.cz * sc, wr, 0, 6.2832, true); g.fill('evenodd'); }
    const kg = wr ? null : this.king;
    if (kg && kg.alive) { g.font = '900 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = '#5a3a00'; g.fillStyle = '#ffd23a'; g.strokeText('\u265B', c0 + kg.cx * sc, c0 + kg.cz * sc - 4); g.fillText('\u265B', c0 + kg.cx * sc, c0 + kg.cz * sc - 4); }
  }
}
