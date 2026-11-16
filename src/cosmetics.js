// Wardrobe kinds beyond ball + trail: HOP ring, STOMP burst, BLAST aura, YETI skin, DEATH effect, result EMOTE.
// Data only (+ three small helpers the runner and the shop preview share). save.own/select/isOwned are generic by kind string.
//   item: { id, name, rarity, price, unlock?, preview:{a,b,pattern}, fx:{...}, new?, set? }   price 0 + no unlock = the free default of its kind
//   unlock: { stars: n } like skins (free once total stars reach n)
import * as THREE from 'three';
import { RARITY, SKINS, TRAILS } from './skins.js';

const I = (id, name, rarity, price, a, b, fx, extra = {}) => ({ id, name, rarity, price, preview: { a, b, pattern: 'solid', glow: rarity !== 'common' }, fx, new: true, ...extra });

export const HOPS = [
  I('std', 'Klasik Halka', 'common', 0, '#e8f6ff', '#ffe066', { shape: 'ring', hot: 0xffe066, cool: 0xe8f6ff }, { new: false }),
  I('hop_cift', 'Çift Halka', 'common', 250, '#3ad0ff', '#ff5ca8', { shape: 'double', hot: 0xff5ca8, cool: 0x3ad0ff }),
  I('hop_dalga', 'Kesik Halka', 'common', 300, '#9aeeff', '#ffffff', { shape: 'dash', hot: 0xffffff, cool: 0x9aeeff, spin: 2 }),
  I('hop_yildiz', 'Yıldız Halkası', 'rare', 600, '#fff6c2', '#ffd23a', { shape: 'star', hot: 0xffd23a, cool: 0xfff6c2, spin: 1.6 }),
  I('hop_kalp', 'Kalp Halkası', 'rare', 600, '#ffd0e8', '#ff6fb5', { shape: 'heart', hot: 0xff3f9a, cool: 0xffd0e8 }),
  I('hop_elmas', 'Elmas Halka', 'rare', 700, '#d6f8ff', '#33b2e8', { shape: 'diamond', hot: 0x33e0ff, cool: 0xd6f8ff, spin: 1 }, { unlock: { stars: 8 } }),
  I('hop_cicek', 'Çiçek Halkası', 'epic', 1100, '#ff9fd0', '#ffe45a', { shape: 'flower', hot: 0xffe45a, cool: 0xff9fd0, spin: 0.8 }),
];

// cols = chunk colours, n = chunks (fx.burst caps at 12), sp = speed, mist = puffs, ring = shock ring of puffs, shake = extra trauma
export const STOMPS = [
  I('std', 'Klasik Ezme', 'common', 0, '#fff2b0', '#ffffff', { cols: [0xfff2b0], n: 10, sp: 3 }, { new: false }),
  I('ezme_kar', 'Kar Patlaması', 'common', 300, '#ffffff', '#cfe6ff', { cols: [0xffffff, 0xcfe6ff], n: 12, sp: 4, mist: 8 }),
  I('ezme_buz', 'Buz Kırığı', 'common', 350, '#bff3ff', '#33b2e8', { cols: [0xbff3ff, 0x33b2e8, 0xffffff], n: 12, sp: 5, mist: 4 }),
  I('ezme_kalp', 'Kalp Patlaması', 'rare', 650, '#ffd0e8', '#ff6fb5', { cols: [0xff6fb5, 0xffd0e8], n: 10, sp: 2.5, up: 2, mist: 6, mcol: 0xffb3dc }),
  I('ezme_konfeti', 'Konfeti Patlaması', 'rare', 700, '#ff5ca8', '#3ad0ff', { cols: [0xff5ca8, 0xffd23a, 0x3ad0ff, 0x7dff4a], n: 12, sp: 5 }),
  I('ezme_altin', 'Altın Yağmuru', 'rare', 800, '#ffe681', '#ffb300', { cols: [0xffd23a, 0xffe681], n: 12, sp: 4, up: 2, mist: 4, mcol: 0xffe27a }),
  I('ezme_havai', 'Havai Fişek', 'epic', 1400, '#ffe27a', '#ff5ca8', { cols: [0xffd23a, 0xff5ca8, 0x3ad0ff], n: 12, sp: 6, ring: 10, mcol: 0xffe27a, shake: 0.1 }, { unlock: { stars: 20 } }),
  I('ezme_lav', 'Lav Fışkırması', 'epic', 1500, '#ffb000', '#8a1a00', { cols: [0xff5a10, 0xffb000, 0x8a1a00], n: 12, sp: 5, mist: 8, mcol: 0xff7a2a, shake: 0.08 }),
];

// col = halo colour, hue = cycles the hue, spark = coloured sparks round the ball, big = halo scale
export const BLASTS = [
  I('std', 'Altın Alev', 'common', 0, '#ffe27a', '#ff9a1a', { col: 0xffc850 }, { new: false }),
  I('aura_kirmizi', 'Kızıl Alev', 'rare', 850, '#ff9a8a', '#e01428', { col: 0xff4a3a, spark: 0xff7a5a }),
  I('aura_mavi', 'Mavi Alev', 'rare', 900, '#bfe9ff', '#2f7dff', { col: 0x3cc8ff, spark: 0x9fe8ff }),
  I('aura_buz', 'Buz Aurası', 'rare', 950, '#ffffff', '#7fe3ff', { col: 0xbfeaff, spark: 0xffffff, big: 1.1 }),
  I('aura_pembe', 'Pembe Şimşek', 'epic', 1500, '#ff9fd0', '#ff3ad0', { col: 0xff3ad0, spark: 0xffb3f0, big: 1.15 }),
  I('aura_gokkusagi', 'Gökkuşağı Aura', 'epic', 2200, '#ff4d4d', '#7a5cff', { col: 0xffffff, hue: true, spark: 0xffffff, big: 1.2 }),
  I('aura_hayalet', 'Hayalet Yeşili', 'legendary', 3500, '#c8ffd4', '#2fd06a', { col: 0x4aff8a, spark: 0xc8ffd4, big: 1.3 }),
];

// tint = multiplied onto the baked fur (1.9-2 reads icy cream), em = emissive colour, pulse = emissive breathing
export const YETIS = [
  I('std', 'Klasik Yeti', 'common', 0, '#f4efe0', '#c9bfa8', { tint: [2, 1.95, 2] }, { new: false }),
  I('yeti_pembe', 'Pembe Yeti', 'rare', 700, '#ffb3d9', '#ff6fb5', { tint: [2.4, 1.3, 1.8], em: 0x3a0a22 }),
  I('yeti_zombi', 'Zombi Yeti', 'rare', 800, '#9fd47a', '#4f7f3a', { tint: [1.2, 2.2, 1.0], em: 0x0a2a08 }),
  I('yeti_buz', 'Buz Yeti', 'rare', 900, '#bfe9ff', '#2f7dff', { tint: [1.2, 1.9, 2.8], em: 0x0a2850 }),
  I('yeti_gece', 'Gece Yeti', 'epic', 1600, '#7a6ac8', '#1a1038', { tint: [0.8, 0.7, 1.5], em: 0x200a50, pulse: 0.5 }),
  I('yeti_lav', 'Lav Yeti', 'epic', 1800, '#ff7a2a', '#3a0a00', { tint: [1.3, 0.55, 0.4], em: 0x6a1a00, pulse: 1 }),
  I('yeti_robot', 'Robot Yeti', 'epic', 2000, '#9fb0c4', '#35e6ff', { tint: [1.3, 1.5, 1.8], em: 0x063a46, pulse: 0.7 }),
  I('yeti_altin', 'Altın Yeti', 'legendary', 5000, '#ffe681', '#d8940c', { tint: [2.3, 1.7, 0.45], em: 0x2a1a00, pulse: 0.4 }),
];

// t = effect type played by the runner when the ball dies
export const DEATHS = [
  I('std', 'Klasik', 'common', 0, '#ffffff', '#cfe2f7', { t: 'none' }, { new: false }),
  I('olum_duman', 'Duman Bulutu', 'common', 350, '#c8d2e0', '#7a8498', { t: 'smoke', cols: [0xc8d2e0, 0x9aa4b4] }),
  I('olum_konfeti', 'Konfeti Çöküşü', 'rare', 600, '#ff5ca8', '#3ad0ff', { t: 'pop', cols: [0xff5ca8, 0xffd23a, 0x3ad0ff, 0x7dff4a], hide: 1 }),
  I('olum_kalp', 'Kalp Dağılması', 'rare', 650, '#ffd0e8', '#ff3f9a', { t: 'pop', cols: [0xff3f9a, 0xffb3dc], hide: 1, up: 1 }),
  I('olum_balon', 'Balon Patlaması', 'rare', 900, '#ff9a8a', '#ffd23a', { t: 'pop', cols: [0xffffff, 0xff5a3a], hide: 1, big: 1 }),
  I('olum_yildiz', 'Yıldız Uçuşu', 'epic', 1400, '#fff6c2', '#ffd23a', { t: 'stars', cols: [0xffe27a, 0xffffff] }),
  I('olum_altin', 'Altın Yağmuru', 'epic', 1500, '#ffe681', '#d8940c', { t: 'pop', cols: [0xffd23a, 0xffe681, 0xd8940c], hide: 1, big: 1, up: 1 }),
];

// css = animation class of the emoji shown over the result card, conf = confetti on a record
export const EMOTES = [
  I('std', 'Sessiz', 'common', 0, '#ffffff', '#cfe2f7', { e: '' }, { new: false }),
  I('em_selam', 'Selam', 'common', 250, '#ffd23a', '#ff9a1a', { e: '👋', css: 'bow' }),
  I('em_dans', 'Dans', 'common', 350, '#ff9fd0', '#b07aff', { e: '💃', css: 'dance' }),
  I('em_kalp', 'Kalp Atışı', 'rare', 700, '#ffd0e8', '#ff3f9a', { e: '💖', css: 'beat' }),
  I('em_zafer', 'Zafer Zıplaması', 'rare', 800, '#ffe681', '#ffb300', { e: '🏆', css: 'jump', conf: 1 }),
  I('em_roket', 'Roket', 'rare', 900, '#ffb3a0', '#ff5a3a', { e: '🚀', css: 'rocket' }),
  I('em_alev', 'Alev Dansı', 'epic', 1500, '#ffb000', '#ff3a10', { e: '🔥', css: 'beat', conf: 1 }),
  I('em_tac', 'Taç Töreni', 'epic', 1800, '#ffe681', '#d8940c', { e: '👑', css: 'drop', conf: 1 }, { unlock: { stars: 30 } }),
];

export const KINDS = [
  { k: 'skin', ic: '⚪', n: 'TOPLAR' }, { k: 'trail', ic: '✨', n: 'İZLER' }, { k: 'hop', ic: '⭕', n: 'HALKA' }, { k: 'stomp', ic: '💥', n: 'EZME' },
  { k: 'blast', ic: '🔥', n: 'AURA' }, { k: 'yeti', ic: '👹', n: 'YETİ' }, { k: 'death', ic: '💀', n: 'ÖLÜM' }, { k: 'emote', ic: '🎉', n: 'KUTLAMA' },
];
const LISTS = { skin: SKINS, trail: TRAILS, hop: HOPS, stomp: STOMPS, blast: BLASTS, yeti: YETIS, death: DEATHS, emote: EMOTES };
export const catalog = (kind) => LISTS[kind] || [];
export const isCosKind = (kind) => kind !== 'skin' && kind !== 'trail' && !!LISTS[kind];
export const itemOf = (kind, id) => catalog(kind).find((x) => x.id === id) || null;
export const equipped = (save, kind) => { let id; try { id = save && save.selected && save.selected(kind); } catch { id = null; } return itemOf(kind, id) || catalog(kind)[0]; };
export const fxOf = (save, kind) => equipped(save, kind).fx;

// Theme bundles: pieces from several kinds, -25% for the missing ones together.
export const BUNDLES = [
  { id: 'b_ask', name: 'Aşk Seti', ic: '💖', pcs: [['trail', 'kalp_yagmuru'], ['hop', 'hop_kalp'], ['stomp', 'ezme_kalp'], ['emote', 'em_kalp']] },
  { id: 'b_buz', name: 'Buz Seti', ic: '🧊', pcs: [['skin', 'kar_kuresi'], ['trail', 'baloncuk_izi'], ['blast', 'aura_buz'], ['yeti', 'yeti_buz']] },
  { id: 'b_ates', name: 'Ateş Seti', ic: '🔥', pcs: [['skin', 'magma'], ['trail', 'kuyruklu'], ['blast', 'aura_kirmizi'], ['stomp', 'ezme_lav'], ['yeti', 'yeti_lav']] },
];

// ---------------------------------------------------------------------------------------------- shared helpers
// A flat ring whose radius follows r(theta): star, heart, flower... one geometry builder for the Rush hop ring and the shop preview.
const SHAPES = {
  ring: () => 1,
  star: (a) => 0.45 + 0.55 * Math.abs(2 * ((a * 5 / 6.2832) % 1) - 1),      // 5 straight-edged points
  flower: (a) => 0.7 + 0.3 * Math.abs(Math.cos(a * 4)),
  diamond: (a) => 1 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))) * 0.85,
  heart: (a) => {
    const s = Math.sin(a), c = Math.cos(a);
    return (2 - 2 * s + (s * Math.sqrt(Math.abs(c))) / (s + 1.4)) / 3.2 + 0.18;
  },
};
const _rings = new Map();
export function hopGeometry(shape) {
  if (_rings.has(shape)) return _rings.get(shape);
  const dash = shape === 'dash', dbl = shape === 'double';
  const fn = SHAPES[shape] || SHAPES.ring, N = dash ? 48 : 64, loops = dbl ? [[1, 0.2], [0.58, 0.2]] : [[1, 0.17]];
  const pos = [], idx = [];
  for (const [sc, w] of loops) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, r = fn(a) * sc;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(a) * r * (1 - w), Math.sin(a) * r * (1 - w), 0);
      if (i < N && !(dash && i % 6 > 3)) { const k = base + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  _rings.set(shape, g);
  return g;
}

// Glyph particles for shaped trails (notes, hearts, bubbles...): a 24-sprite pool, one canvas texture per shape, no per-frame allocation.
const _tex = new Map();
function glyphTex(s) {
  if (_tex.has(s)) return _tex.get(s);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineWidth = 6; x.lineJoin = 'round'; x.lineCap = 'round';
  const poly = (pts) => { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill(); };
  if (s === 'note') { x.beginPath(); x.ellipse(20, 47, 14, 10, -0.4, 0, 7); x.fill(); x.lineWidth = 8; x.beginPath(); x.moveTo(31, 44); x.lineTo(31, 8); x.quadraticCurveTo(44, 14, 50, 30); x.stroke(); }
  else if (s === 'heart') { x.beginPath(); x.moveTo(32, 56); x.bezierCurveTo(2, 34, 8, 8, 32, 22); x.bezierCurveTo(56, 8, 62, 34, 32, 56); x.fill(); }
  else if (s === 'bubble') { x.lineWidth = 5; x.beginPath(); x.arc(32, 32, 22, 0, 7); x.stroke(); x.globalAlpha = 0.5; x.beginPath(); x.arc(24, 24, 5, 0, 7); x.fill(); }
  else if (s === 'glint' || s === 'spark') poly([[32, 2], [38, 26], [62, 32], [38, 38], [32, 62], [26, 38], [2, 32], [26, 26]]);
  else if (s === 'leaf') { x.beginPath(); x.ellipse(32, 32, 26, 12, -0.7, 0, 7); x.fill(); }
  else if (s === 'pixel') x.fillRect(14, 14, 36, 36);
  else if (s === 'bolt') poly([[38, 2], [14, 36], [30, 36], [24, 62], [50, 26], [34, 26]]);
  else { const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); } // smoke / dust
  const t = new THREE.CanvasTexture(c);
  _tex.set(s, t);
  return t;
}
export class Glyphs {
  constructor(scene, n = 24) {
    this.scene = scene; this.e = null; this.acc = 0; this.head = 0;
    const t0 = glyphTex('smoke');
    this.p = Array.from({ length: n }, () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t0, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false; sp.renderOrder = 4; scene.add(sp);
      return { sp, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, rot: 0, rv: 0, grow: 0 };
    });
  }
  /** emit = trailStyle(id).emit or null: { s: shape, rate /s, cols: [hex], size (x ball radius), up, sp, life, add, spin, grow } */
  setEmit(emit) {
    this.e = emit || null;
    for (const q of this.p) { q.life = 0; q.sp.visible = false; }
  }
  /** one particle of spec e at x,y,z (r = ball radius) */
  spawn(e, x, y, z, r) {
    const q = this.p[this.head]; this.head = (this.head + 1) % this.p.length;
    const cols = e.cols, sp = e.sp || 1, m = q.sp.material;
    q.sp.position.set(x + (Math.random() - 0.5) * r * 1.4, y + Math.random() * r * 0.8, z + (Math.random() - 0.5) * r * 1.4);
    q.vx = (Math.random() - 0.5) * sp; q.vz = (Math.random() - 0.5) * sp; q.vy = (e.up === undefined ? 1.4 : e.up) * (0.6 + Math.random() * 0.8);
    q.max = q.life = (e.life || 1) * (0.7 + Math.random() * 0.6); q.size = (e.size || 0.5) * r * 2.2 * (0.7 + Math.random() * 0.6);
    q.rot = Math.random() * 6; q.rv = e.spin ? (Math.random() - 0.5) * 6 : 0; q.grow = e.grow ? 1 : 0;
    m.map = glyphTex(e.s); m.blending = e.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.color.setHex(cols[(Math.random() * cols.length) | 0]);
    q.sp.visible = true;
  }
  /** x,y,z = spawn point (just behind the ball), r = ball radius, on = emitting */
  tick(dt, x, y, z, r, on) {
    const e = this.e;
    if (e && on) {
      this.acc += dt * e.rate;
      while (this.acc >= 1) { this.acc -= 1; this.spawn(e, x, y, z, r); }
    }
    for (const q of this.p) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) { q.sp.visible = false; continue; }
      const k = q.life / q.max, s = q.sp;
      s.position.x += q.vx * dt; s.position.y += q.vy * dt; s.position.z += q.vz * dt;
      q.rot += q.rv * dt; s.material.rotation = q.rot;
      s.material.opacity = Math.min(1, k * 2.2) * 0.95;
      s.scale.setScalar(q.size * (q.grow ? 1.6 - k * 0.6 : 0.6 + 0.4 * Math.min(1, (1 - k) * 6)));
    }
  }
  dispose() { for (const q of this.p) { this.scene.remove(q.sp); q.sp.material.dispose(); } this.p = []; }
}
