// EFFECT BALLS: every one is a distinct animated material (shared GLSL patch, a few modes) PLUS a small attached effect from the shared pool in ballrig.js
// (embers, orbiting stars, arcs, bubbles, petals, flakes, mist, hearts, rings). Data + builders only; imports nothing from skins.js (skins.js hands in its toolkit TK).
//   item : the catalog fields skins.js puts into SKINS (id, name, rarity, price, unlock?, preview, fxb = card-thumbnail hint)
//   look : (TK, stage) -> { detail, shape, paint, alpha, perFace, phong, mat }   stage 0..2 only for mythic balls (their look evolves with the shard level)
//   modes: shader modes  mask (vertex alpha glows) | hue | stars | arcs | facet (per-face sparkle) | swirl | rim (fresnel corona)
//   c1/c2: shader colours   glow: strength   pw: rim power
//   rig  : pooled particle layers (see ballrig.js) ;  rings : thin comet rings ;  st: mythic stage multipliers
import * as THREE from 'three';

const K = (h) => new THREE.Color(h);
const TAU = Math.PI * 2;
const I = (id, name, rarity, price, a, b, c, pattern, fxb, extra = {}) => ({ id, name, rarity, price, new: true, fxb, preview: { a, b, c, pattern, glow: true }, ...extra });
export const stageOf = (level) => (level >= 5 ? 2 : level >= 3 ? 1 : 0);

export const EFFECT_BALLS = [
  { item: I('fx_alev', 'Alev Topu', 'rare', 1100, '#ffd23a', '#ff3a10', '#7a2a00', 'flame', { k: 'up', c: '#ffb040' }),
    modes: ['mask', 'rim'], c1: 0xff8a1a, c2: 0xffd23a, glow: 1.5, pw: 2.2, puff: 0xff7a1a,
    look: (TK) => {
      const dark = K(0x5a1406), mid = K(0xe0501a), hot = K(0xffd23a);
      const tg = (x, y, z) => TK.fbm3(x * 3 + 4, y * 3 - 2, z * 3 + 1, 2);
      return { detail: 7, alpha: true, shape: (x, y, z) => (tg(x, y, z) - 0.5) * 0.12, perFace: false,
        paint: (x, y, z, c) => { const g = TK.clamp01(tg(x, y, z) * 1.5 + y * 0.35 - 0.1); c.copy(dark).lerp(mid, TK.smooth(0.2, 0.6, g)).lerp(hot, TK.smooth(0.6, 0.95, g)); return g; } };
    },
    rig: [{ m: 'rise', s: 'spark', n: 18, rate: 24, cols: [0xffd23a, 0xff7a1a, 0xff3a10], size: 0.22, up: 2.4, sp: 0.9, life: 0.9, add: 1 }] },

  { item: I('fx_simsek', 'Şimşek Topu', 'epic', 1900, '#d4f2ff', '#2f66ff', '#0a0a30', 'plasma', { k: 'zap', c: '#bfe9ff' }),
    modes: ['arcs', 'rim'], c1: 0x6ab8ff, c2: 0xffffff, glow: 1.6, pw: 2.6, puff: 0xaad4ff,
    look: (TK) => { const a = K(0x0c1030), b = K(0x1a2a78); return { detail: 6, perFace: false, phong: true, mat: { shininess: 90, specular: 0x6688ff }, paint: (x, y, z, c) => c.copy(a).lerp(b, TK.clamp01(y * 0.5 + 0.5)) }; },
    rig: [{ m: 'surf', s: 'bolt', n: 8, rate: 9, cols: [0xd4f2ff, 0x9fb8ff, 0xffffff], size: 0.5, life: 0.2, R: 1.25, add: 1 }] },

  { item: I('fx_galaksi', 'Galaksi Girdabı', 'epic', 2200, '#7a4aff', '#120a40', '#ff7ad0', 'stars', { k: 'orb', c: '#ffe9a0' }),
    modes: ['stars', 'swirl', 'rim'], c1: 0x9a7aff, c2: 0xff5ac8, glow: 0.9, pw: 3, puff: 0xb070ff,
    look: (TK) => { const a = K(0x0a0630), b = K(0x4a1a9a); return { detail: 6, perFace: false, paint: (x, y, z, c) => c.copy(a).lerp(b, TK.smooth(0.35, 0.8, TK.fbm3(x * 2 + 3, y * 2, z * 2 + 8, 3))) }; },
    rig: [{ m: 'orbit', s: 'star', n: 6, cols: [0xfff3a0, 0xffffff, 0xb8a0ff], size: 0.3, R: 1.55, spd: 1.1, tilt: 0.5, add: 1, spin: 1 },
      { m: 'orbit', s: 'dot', n: 2, cols: [0xe8e0ff, 0xffd8a0], size: 0.3, R: 1.9, spd: 0.7, tilt: -0.4, add: 0 }] },

  { item: I('fx_kiragi', 'Kırağı Topu', 'rare', 1000, '#e6fbff', '#5ac8ff', '#ffffff', 'facets', { k: 'fall', c: '#ffffff' }),
    modes: ['facet', 'rim'], c1: 0xbff3ff, c2: 0xffffff, glow: 0.9, pw: 2.4, puff: 0xe6fbff,
    look: (TK) => { const a = K(0xcdf3ff), b = K(0x4ab4e8), w = K(0xffffff); return { detail: 2, alpha: true, phong: true, mat: { shininess: 140, specular: 0xffffff, emissive: 0x0a2a40 },
      paint: (x, y, z, c) => { const h = TK.hash3(Math.floor(x * 9) + 9, Math.floor(y * 9) + 9, Math.floor(z * 9) + 9); c.copy(a).lerp(h < 0.4 ? b : w, 0.55 * h); return h; } }; },
    rig: [{ m: 'fall', s: 'flake', n: 10, rate: 7, cols: [0xffffff, 0xbfeaff], size: 0.3, up: -0.7, sp: 0.7, life: 1.5, add: 0, spin: 1 },
      { m: 'rise', s: 'smoke', n: 6, rate: 4, cols: [0xd8f4ff], size: 0.95, up: 0.2, sp: 0.5, life: 1.2, add: 0, grow: 1, a: 0.35, back: 0.6 }] },

  { item: I('fx_lav', 'Lav Çatlağı', 'rare', 1300, '#ffb000', '#3a3341', '#ff6a10', 'cracks', { k: 'up', c: '#ff8a2a' }),
    modes: ['mask'], c1: 0xff7a14, c2: 0xffd25a, glow: 1.4, pw: 2, puff: 0xff7a1a,
    look: (TK) => {
      const rock = K(0x2c262f), hi = K(0x4a424f), orange = K(0xff6a10), yellow = K(0xffd25a);
      const crack = (x, y, z) => { const f = Math.abs(TK.noise3(x * 2.5 + 7, y * 2.5 + 1, z * 2.5 + 4) - 0.5), g = Math.abs(TK.noise3(x * 5.2 + 2, y * 5.2 + 9, z * 5.2 + 6) - 0.5); return Math.max(1 - TK.smooth(0.02, 0.06, f), f < 0.15 ? (1 - TK.smooth(0.012, 0.04, g)) * 0.8 : 0); };
      return { detail: 7, alpha: true, shape: (x, y, z) => (TK.fbm3(x * 2.6 + 5, y * 2.6, z * 2.6 + 2, 2) - 0.5) * 0.12 - crack(x, y, z) * 0.05,
        paint: (x, y, z, c) => { const g = crack(x, y, z); if (g > 0.8) { c.copy(yellow); return 1; } if (g > 0.26) { c.copy(orange); return 0.85; } c.copy(rock).lerp(hi, TK.clamp01((TK.noise3(x * 4 + 3, y * 4, z * 4 + 1) - 0.4) * 2.5)); return 0; } };
    },
    rig: [{ m: 'rise', s: 'smoke', n: 8, rate: 6, cols: [0x4a4450, 0x6a606c], size: 0.9, up: 1.2, sp: 0.6, life: 1.2, add: 0, grow: 1, a: 0.55 },
      { m: 'rise', s: 'spark', n: 8, rate: 8, cols: [0xffb030, 0xff6a10], size: 0.2, up: 2, sp: 0.8, life: 0.8, add: 1 }] },

  { item: I('fx_hayalet', 'Hayalet Topu', 'rare', 900, '#e8fbff', '#8ad0e8', '#1a2a3a', 'face', { k: 'up', c: '#e8fbff' }, { unlock: { challenge: 'rs_3' }, price: 0 }),
    modes: ['rim'], c1: 0xa8f0ff, c2: 0xffffff, glow: 1.3, pw: 1.6, puff: 0xe8fbff, ghost: 0.7,
    look: (TK) => { const a = K(0xf2fdff), b = K(0xa8e0f0), eye = K(0x1a2a3a);
      return { detail: 6, perFace: false, mat: { transparent: true, opacity: 0.72, depthWrite: true, emissive: 0x2a4a5a },
        paint: (x, y, z, c) => { c.copy(a).lerp(b, TK.clamp01(0.5 - y * 0.6)); const ex = Math.abs(x); if (z > 0.55 && ((Math.abs(ex - 0.3) < 0.12 && Math.abs(y - 0.22) < 0.16) || (Math.abs(x) < 0.13 && Math.abs(y + 0.18) < 0.1))) c.copy(eye); } }; },
    rig: [{ m: 'rise', s: 'smoke', n: 10, rate: 9, cols: [0xe8fbff, 0xbfeaff], size: 1, up: 0.3, sp: 0.5, life: 1.2, add: 0, grow: 1, a: 0.5, back: 1.5 }] },

  { item: I('fx_zehir', 'Zehir Kazanı', 'rare', 1000, '#c4ff7a', '#1fa84a', '#0a3a1a', 'goo', { k: 'up', c: '#9aff4a' }),
    modes: ['mask'], c1: 0x7dff4a, c2: 0xffffff, glow: 1.1, pw: 2, puff: 0x7dff4a,
    look: (TK) => { const a = K(0x1a6a2a), b = K(0x4ad040), hi = K(0xc4ff7a);
      const bub = (x, y, z) => TK.smooth(0.62, 0.7, TK.noise3(x * 4 + 3, y * 4 + 1, z * 4 + 5));
      return { detail: 7, alpha: true, perFace: false, phong: true, mat: { shininess: 90, specular: 0x88ff88 }, shape: (x, y, z) => bub(x, y, z) * 0.07,
        paint: (x, y, z, c) => { const s = bub(x, y, z); c.copy(a).lerp(b, TK.clamp01(y * 0.5 + 0.5)).lerp(hi, s); return s; } }; },
    rig: [{ m: 'rise', s: 'bubble', n: 10, rate: 6, cols: [0xbfff7a, 0x7dff4a, 0xffffff], size: 0.38, up: 1.7, sp: 0.8, life: 1.2, add: 0 }] },

  { item: I('fx_gokkusagi', 'Akan Gökkuşağı', 'epic', 2000, '#ff4d4d', '#7a5cff', '#ffd23a', 'swirl', { k: 'orb', c: '#ffd23a' }, { price: 0, unlock: { stars: 36 } }),
    modes: ['hue', 'rim'], c1: 0xffffff, c2: 0xffffff, glow: 0.7, pw: 3, puff: 0xffd0ff,
    look: () => ({ detail: 6, perFace: false, paint: (x, y, z, c) => c.setRGB(1, 1, 1) }),
    rig: [{ m: 'rise', s: 'spark', n: 12, rate: 14, cols: [0xff4d4d, 0xffd23a, 0x4dff7a, 0x3ad0ff, 0xb07aff, 0xff5ca8], size: 0.26, up: 1.2, sp: 1.3, life: 0.9, add: 1 }],
    rings: [{ r0: 1.5, r1: 1.62, hue: 1, tilt: 1.2, spin: 1.6, op: 0.7, st: 0 }] },

  { item: I('fx_disko', 'Disko Işığı', 'rare', 1100, '#e9f1ff', '#7d8db4', '#ff6ad5', 'tiles', { k: 'zap', c: '#ff6ad5' }),
    modes: ['facet'], c1: 0xffffff, c2: 0xffffff, glow: 1.2, pw: 2, puff: 0xe9f1ff,
    look: (TK) => { const a = K(0xdde6f8), b = K(0x8a98c0), d = K(0x4a5478); return { detail: 2, alpha: true, phong: true, mat: { shininess: 180, specular: 0xffffff, emissive: 0x181c30 },
      paint: (x, y, z, c) => { const h = TK.hash3(Math.floor(x * 11) + 9, Math.floor(y * 11) + 9, Math.floor(z * 11) + 9); c.copy(h < 0.35 ? d : h < 0.7 ? b : a); return h; } }; },
    rig: [{ m: 'surf', s: 'spark', n: 14, rate: 14, cols: [0xff6ad5, 0x6ad5ff, 0xfff36a, 0xffffff], size: 0.4, life: 0.45, R: 1.12, add: 1 }] },

  { item: I('fx_plazma', 'Plazma Küresi', 'epic', 2300, '#ff5ae0', '#3a1aaa', '#0a0620', 'plasma', { k: 'zap', c: '#ff7ae8' }),
    modes: ['swirl', 'arcs', 'rim'], c1: 0xff5ae0, c2: 0x5a3aff, glow: 1.5, pw: 2.2, puff: 0xff5ae0,
    look: (TK) => { const a = K(0x16082e), b = K(0x2a1070); return { detail: 6, perFace: false, phong: true, mat: { shininess: 120, specular: 0xaa66ff }, paint: (x, y, z, c) => c.copy(a).lerp(b, TK.fbm3(x * 2, y * 2, z * 2, 2)) }; },
    rig: [{ m: 'surf', s: 'bolt', n: 8, rate: 8, cols: [0xff7ae8, 0xffffff, 0x9a7aff], size: 0.5, life: 0.22, R: 1.2, add: 1 }] },

  { item: I('fx_karadelik', 'Kara Delik', 'legendary', 3500, '#1a1030', '#000000', '#ff9a3a', 'tendrils', { k: 'orb', c: '#ff9a3a' }, { unlock: { challenge: 'ch_podium3' }, price: 0 }),
    modes: ['rim'], c1: 0xff8a2a, c2: 0xffffff, glow: 1.6, pw: 3.2, puff: 0x6a3aaa,
    look: (TK) => { const a = K(0x05030c), b = K(0x180a30); return { detail: 6, perFace: false, paint: (x, y, z, c) => c.copy(a).lerp(b, TK.smooth(0.3, 0.9, TK.fbm3(x * 2, y * 2, z * 2, 2))) }; },
    rig: [{ m: 'sink', s: 'dot', n: 16, rate: 12, cols: [0xffb060, 0xff7a2a, 0xffe0b0], size: 0.28, R: 2.1, tilt: 1.15, spd: 2.4, life: 1.1, add: 1 }],
    rings: [{ r0: 1.42, r1: 1.68, col: 0xff9a3a, col2: 0xffe8c0, tilt: 1.15, spin: 2.2, op: 0.85, st: 0 }] },

  { item: I('fx_gunes', 'Güneş Topu', 'legendary', 3600, '#fff3a0', '#ff8a1a', '#ff5a10', 'flame', { k: 'up', c: '#ffd23a' }),
    modes: ['mask', 'rim'], c1: 0xffb020, c2: 0xffffff, glow: 1.7, pw: 1.8, puff: 0xffd23a,
    look: (TK) => { const a = K(0xffd84a), b = K(0xff8a1a), s = K(0xff5a10);
      const g = (x, y, z) => TK.fbm3(x * 3.2 + 1, y * 3.2 + 6, z * 3.2 + 3, 3);
      return { detail: 7, alpha: true, perFace: false, paint: (x, y, z, c) => { const v = g(x, y, z); c.copy(a).lerp(b, TK.smooth(0.4, 0.7, v)).lerp(s, TK.smooth(0.62, 0.8, v) * 0.6); return 0.5 + v * 0.6; } }; },
    rig: [{ m: 'out', s: 'spark', n: 12, rate: 11, cols: [0xffd23a, 0xffffff, 0xff9a1a], size: 0.55, up: 0, sp: 3.4, life: 0.5, R: 1, add: 1 }],
    rings: [{ r0: 1.45, r1: 1.55, col: 0xffd23a, col2: 0xff8a1a, tilt: 0, spin: 0.8, op: 0.55, st: 0, face: 1 }] },

  { item: I('fx_ay', 'Dolunay', 'rare', 1200, '#e8e8f0', '#9a9aa6', '#ffffff', 'tiles', { k: 'orb', c: '#e8f0ff' }, { price: 0, unlock: { stars: 16 } }),
    modes: ['rim'], c1: 0xc8dcff, c2: 0xffffff, glow: 0.9, pw: 2.2, puff: 0xe8e8f0,
    look: (TK) => { const a = K(0xe4e4ec), d = K(0xa4a4b2), rim = K(0xf6f6fc); const cr = (x, y, z) => TK.noise3(x * 3.1 + 7, y * 3.1 + 1, z * 3.1 + 3);
      return { detail: 7, shape: (x, y, z) => { const n = cr(x, y, z); return n > 0.64 ? -0.06 * TK.smooth(0.64, 0.7, n) : 0; }, mat: { emissive: 0x20243a },
        paint: (x, y, z, c) => { const n = cr(x, y, z); c.copy(n > 0.64 ? d : n > 0.6 ? rim : a); } }; },
    rig: [{ m: 'halo', s: 'dot', n: 1, cols: [0xcfe0ff], size: 3.4, add: 1, a: 0.32 }, { m: 'orbit', s: 'star', n: 3, cols: [0xffffff, 0xcfe0ff], size: 0.2, R: 1.7, spd: 0.8, tilt: 0.3, add: 1 }] },

  { item: I('fx_yumurta', 'Ejderha Yumurtası', 'legendary', 4000, '#2a8a7a', '#1a1038', '#ff8a2a', 'scales', { k: 'up', c: '#ff8a2a' }),
    modes: ['mask'], c1: 0xff8a2a, c2: 0xffd25a, glow: 1.3, pw: 2, puff: 0xff8a2a,
    look: (TK) => { const a = K(0x1d6a62), b = K(0x2a1a50), vein = K(0xff9a2a);
      const sc = (x, y, z) => Math.abs(Math.sin(x * 9 + Math.sin(y * 6) * 1.2) * Math.sin(y * 9 + Math.sin(z * 6)) * Math.sin(z * 9 + Math.sin(x * 6)));
      const vn = (x, y, z) => 1 - TK.smooth(0.02, 0.07, Math.abs(TK.noise3(x * 2.4 + 2, y * 2.4 + 5, z * 2.4 + 1) - 0.5));
      return { detail: 7, alpha: true, phong: true, mat: { shininess: 70, specular: 0x66ccbb }, shape: (x, y, z) => sc(x, y, z) * 0.05,
        paint: (x, y, z, c) => { const v = vn(x, y, z); c.copy(b).lerp(a, TK.smooth(0.05, 0.5, sc(x, y, z))); if (v > 0.3) c.lerp(vein, v); return v; } }; },
    rig: [{ m: 'rise', s: 'spark', n: 10, rate: 7, cols: [0xff9a2a, 0xffd25a], size: 0.2, up: 1.6, sp: 0.8, life: 0.9, add: 1 }] },

  { item: I('fx_kalp', 'Kristal Kalp', 'epic', 2400, '#ffd0e8', '#ff3f9a', '#ffffff', 'facets', { k: 'up', c: '#ff7ab8' }),
    modes: ['facet', 'rim'], c1: 0xffe0f0, c2: 0xffffff, glow: 1.1, pw: 2.2, puff: 0xff9fd0,
    look: (TK) => { const a = K(0xff7ab8), b = K(0xe02a78), w = K(0xffe0f0); return { detail: 1, alpha: true, phong: true, mat: { shininess: 170, specular: 0xffffff, emissive: 0x3a0a22 },
      paint: (x, y, z, c) => { const h = TK.hash3(Math.floor(x * 5) + 9, Math.floor(y * 5) + 9, Math.floor(z * 5) + 9); c.copy(h < 0.4 ? b : h < 0.75 ? a : w); return h; } }; },
    rig: [{ m: 'rise', s: 'heart', n: 8, rate: 3.5, cols: [0xff3f9a, 0xff9fd0, 0xffffff], size: 0.42, up: 1.4, sp: 0.9, life: 1.4, add: 0 }] },

  { item: I('fx_tel', 'Neon Tel Kafes', 'rare', 1300, '#35e6ff', '#0a1a30', '#ff5ad0', 'panels', { k: 'zap', c: '#35e6ff' }, { price: 0, unlock: { stars: 28 } }),
    modes: ['mask'], c1: 0x35e6ff, c2: 0xff5ad0, glow: 1.5, pw: 2, puff: 0x35e6ff,
    look: (TK) => { const dark = K(0x070c1c), line = K(0x35e6ff);
      const ln = (x, y, z) => { const la = Math.abs(Math.sin(Math.asin(y) * 6)), lo = Math.abs(Math.sin(Math.atan2(z, x) * 6)); return Math.max(1 - TK.smooth(0.05, 0.14, la), (1 - TK.smooth(0.05, 0.14, lo)) * (1 - Math.abs(y) * 0.3)); };
      return { detail: 7, alpha: true, perFace: false, paint: (x, y, z, c) => { const v = ln(x, y, z); c.copy(dark).lerp(line, v); return v; } }; },
    rig: [{ m: 'surf', s: 'pixel', n: 12, rate: 10, cols: [0x35e6ff, 0xff5ad0, 0xffffff], size: 0.2, life: 0.5, R: 1.15, add: 1 }],
    rings: [{ r0: 1.4, r1: 1.46, col: 0x35e6ff, col2: 0x0a4a6a, tilt: 0.9, spin: -1.4, op: 0.7, st: 0 }] },

  { item: I('fx_sakura', 'Sakura Topu', 'rare', 1000, '#ffd0e0', '#ff8fb8', '#ffffff', 'dots', { k: 'fall', c: '#ffb3d1' }),
    modes: ['rim'], c1: 0xffc0dc, c2: 0xffffff, glow: 0.6, pw: 2.4, puff: 0xffc0dc,
    look: (TK) => { const a = K(0xffd6e6), b = K(0xff9fc4), w = K(0xffffff); return { detail: 6, perFace: false, paint: (x, y, z, c) => { const n = TK.noise3(x * 6 + 1, y * 6 + 3, z * 6 + 7); c.copy(a).lerp(b, 0.5 - y * 0.35); if (n > 0.72) c.lerp(w, 0.8); } }; },
    rig: [{ m: 'fall', s: 'petal', n: 12, rate: 7, cols: [0xffb3d1, 0xff8fb8, 0xffffff], size: 0.38, up: -0.8, sp: 1.2, life: 1.6, add: 0, spin: 1 }] },

  // ---- MİTİK: the look and the effect evolve at 3 stages (shard level 1-2 / 3-4 / 5; meta.shardInfo)
  { item: I('myth_anka', 'Anka Kuşu', 'mythic', 0, '#ffd23a', '#e01428', '#fff3a0', 'flame', { k: 'up', c: '#ffb040' }, { unlock: { challenge: 'lg_anka' } }),
    myth: 1, modes: ['mask', 'rim', 'swirl'], c1: 0xff7a1a, c2: 0xff3a10, glow: 1.7, pw: 2, puff: 0xffa030,
    look: (TK, st) => { const dark = K(0x7a0a10), mid = K(0xff5a1a), hot = K(0xfff0a0), gold = K(0xffd23a);
      const tg = (x, y, z) => TK.fbm3(x * 3 + 4, y * 3 - 2, z * 3 + 1, 3) + st * 0.06;
      return { detail: 7, alpha: true, perFace: false, phong: true, mat: { shininess: 60, specular: 0xffcc66 }, shape: (x, y, z) => (tg(x, y, z) - 0.5) * (0.1 + st * 0.03),
        paint: (x, y, z, c) => { const g = TK.clamp01(tg(x, y, z) * 1.5 + y * 0.3); c.copy(dark).lerp(mid, TK.smooth(0.15, 0.55, g)).lerp(hot, TK.smooth(0.55, 0.95, g)); if (st > 0 && Math.abs(Math.sin(Math.atan2(z, x) * 4)) > 0.9 && y > 0) c.lerp(gold, 0.6); return g; } }; },
    rig: [{ m: 'rise', s: 'spark', n: 24, rate: 22, cols: [0xffd23a, 0xff7a1a, 0xff3a10, 0xffffff], size: 0.24, up: 2.6, sp: 1.1, life: 1, add: 1 },
      { m: 'out', s: 'spark', n: 10, rate: 5, cols: [0xffd23a, 0xff9a1a], size: 0.6, up: 0.4, sp: 2.4, life: 0.7, R: 1, add: 1, minSt: 1 }],
    rings: [{ r0: 1.45, r1: 1.62, col: 0xffd23a, col2: 0xff3a10, tilt: 0.5, spin: 2, op: 0.75, st: 1 }, { r0: 1.8, r1: 1.92, col: 0xff7a1a, col2: 0xff2a10, tilt: -0.7, spin: -1.5, op: 0.6, st: 2 }], st: [1, 1.5, 2.2] },

  { item: I('myth_evren', 'Evren Çekirdeği', 'mythic', 8000, '#7a4aff', '#05030c', '#ff7ad0', 'stars', { k: 'orb', c: '#ffe9a0' }),
    myth: 1, modes: ['stars', 'swirl', 'rim'], c1: 0xb07aff, c2: 0xff5ac8, glow: 1.2, pw: 2.6, puff: 0xb070ff,
    look: (TK, st) => { const a = K(0x05030f), b = K(0x4a1a9a), c2 = K(0xff5ac8);
      return { detail: 7, perFace: false, paint: (x, y, z, c) => { const n = TK.fbm3(x * 2 + 3, y * 2, z * 2 + 8, 3); c.copy(a).lerp(b, TK.smooth(0.35, 0.8, n)); if (st > 0) c.lerp(c2, TK.smooth(0.6, 0.85, n) * 0.5); } }; },
    rig: [{ m: 'orbit', s: 'star', n: 9, cols: [0xfff3a0, 0xffffff, 0xb8a0ff], size: 0.3, R: 1.6, spd: 1.2, tilt: 0.5, add: 1, spin: 1 },
      { m: 'orbit', s: 'dot', n: 3, cols: [0xe8e0ff, 0xffd8a0, 0xa8d8ff], size: 0.34, R: 2.0, spd: 0.7, tilt: -0.4, add: 0 },
      { m: 'sink', s: 'dot', n: 14, rate: 9, cols: [0xb07aff, 0xff7ad0, 0xffffff], size: 0.22, R: 2.2, tilt: 0.8, spd: 2, life: 1.2, add: 1, minSt: 1 }],
    rings: [{ r0: 1.35, r1: 1.5, col: 0xb07aff, col2: 0xff5ac8, tilt: 1.1, spin: 1.8, op: 0.7, st: 1 }, { r0: 1.75, r1: 1.85, col: 0x6ad5ff, col2: 0x3a2a9a, tilt: -0.6, spin: -1.2, op: 0.6, st: 2 }], st: [1, 1.4, 1.9] },

  { item: I('myth_kral', 'Kış Kralı', 'mythic', 0, '#e6fbff', '#2f9aff', '#ffffff', 'facets', { k: 'fall', c: '#ffffff' }, { unlock: { challenge: 'rs_14' } }),
    myth: 1, modes: ['facet', 'rim'], c1: 0xbff3ff, c2: 0xffffff, glow: 1.2, pw: 2.2, puff: 0xe6fbff,
    look: (TK, st) => { const a = K(0xcdf3ff), b = K(0x3a9ae8), w = K(0xffffff), g = K(0xffe27a);
      return { detail: st > 0 ? 2 : 1, alpha: true, phong: true, mat: { shininess: 160, specular: 0xffffff, emissive: 0x0a2a48 },
        paint: (x, y, z, c) => { const h = TK.hash3(Math.floor(x * 7) + 9, Math.floor(y * 7) + 9, Math.floor(z * 7) + 9); c.copy(a).lerp(h < 0.4 ? b : w, 0.6 * h); if (st > 1 && y > 0.55) c.lerp(g, 0.5); return h; } }; },
    rig: [{ m: 'fall', s: 'flake', n: 14, rate: 9, cols: [0xffffff, 0xbfeaff, 0x8ad0ff], size: 0.32, up: -0.8, sp: 0.8, life: 1.5, add: 0, spin: 1 },
      { m: 'orbit', s: 'spark', n: 6, cols: [0xbff3ff, 0xffffff], size: 0.36, R: 1.6, spd: 1.0, tilt: 0.7, add: 1, minSt: 1 }],
    rings: [{ r0: 1.5, r1: 1.62, hue: 1, tilt: 1.0, spin: 1.2, op: 0.6, st: 1 }, { r0: 1.85, r1: 1.95, col: 0xbff3ff, col2: 0x2f9aff, tilt: -0.5, spin: -1, op: 0.6, st: 2 }], st: [1, 1.5, 2] },
];

// ------------------------------------------------------------------------------------------------ shader patch
const VS_PARS = 'varying vec3 vObj;\nvoid main() {';
const FS_PARS = `uniform float uFx; uniform float uGlow; uniform vec3 uC1; uniform vec3 uC2; uniform float uPow;
varying vec3 vObj;
float fxh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
vec3 fxRainbow(float h) { return clamp(abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
void main() {`;
const FS_BODY = `#include <emissivemap_fragment>
{
  vec3 fp = normalize(vObj); float ft = uFx; vec3 fe = vec3(0.0);
  #ifdef FX_MASK
    #ifdef USE_COLOR_ALPHA
      fe += uC1 * vColor.a * uGlow * (0.7 + 0.3 * sin(ft * 2.6 + fp.y * 5.0 + fp.x * 4.0));
    #endif
  #endif
  #ifdef FX_HUE
    vec3 hc = fxRainbow(fp.y * 0.45 + fp.x * 0.25 + ft * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, hc, 0.88); fe += hc * 0.22 * uGlow;
  #endif
  #ifdef FX_STARS
    vec3 sq = fp * 8.0; vec3 sc = floor(sq + 0.5); float sr = fxh(sc);
    float tw = step(0.9, sr) * smoothstep(0.4, 0.0, length(sq - sc)) * (0.5 + 0.5 * sin(ft * (2.0 + sr * 6.0) + sr * 50.0));
    fe += vec3(1.0, 0.95, 0.85) * tw * 2.2 * uGlow;
  #endif
  #ifdef FX_ARCS
    float a1 = abs(sin(fp.x * 4.5 + sin(fp.y * 5.0 + ft * 3.0) * 1.6 + ft * 1.3));
    float a2 = abs(sin(fp.z * 5.5 + sin(fp.x * 4.0 - ft * 2.5) * 1.8 - ft * 1.7));
    float arc = max(pow(1.0 - a1, 14.0), pow(1.0 - a2, 14.0));
    fe += mix(uC1, vec3(1.0), arc) * arc * uGlow * (0.55 + 0.45 * step(0.35, fract(ft * 6.0 + fp.y * 2.0)));
  #endif
  #ifdef FX_FACET
    #ifdef USE_COLOR_ALPHA
      fe += uC1 * pow(max(0.0, sin(ft * 2.4 + vColor.a * 60.0)), 14.0) * 2.0 * uGlow;
    #endif
  #endif
  #ifdef FX_SWIRL
    float sw = 0.5 + 0.5 * sin(atan(fp.z, fp.x) * 3.0 + fp.y * 7.0 - ft * 1.4);
    diffuseColor.rgb = mix(diffuseColor.rgb, uC2, sw * 0.35);
  #endif
  #ifdef FX_RIM
    float rf = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), uPow);
    fe += uC1 * rf * uGlow * (0.8 + 0.2 * sin(atan(fp.z, fp.x) * 7.0 + ft * 3.0));
  #endif
  totalEmissiveRadiance += fe;
}`;

/** TK = skins.js toolkit { buildSphere, noise3, fbm3, smooth, clamp01, hash3, lambert, phong }. Returns a skin object { geometry, material, puff, update }. */
export function buildEffectBall(def, TK, level = 0) {
  const stage = def.myth ? stageOf(level) : 0, L = def.look(TK, stage);
  const geometry = TK.buildSphere({ detail: L.detail || 6, shape: L.shape, paint: L.paint, perFace: L.perFace !== false, alpha: !!L.alpha });
  const material = (L.phong ? TK.phong : TK.lambert)(L.mat || {});
  const u = { uFx: { value: 0 }, uGlow: { value: def.glow * (1 + stage * 0.18) }, uC1: { value: K(def.c1) }, uC2: { value: K(def.c2) }, uPow: { value: def.pw } };
  const defs = def.modes.map((m) => '#define FX_' + m.toUpperCase()).join('\n') + '\n';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('void main() {', VS_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvObj = position;');
    shader.fragmentShader = defs + shader.fragmentShader.replace('void main() {', FS_PARS).replace('#include <emissivemap_fragment>', FS_BODY);
  };
  material.customProgramCacheKey = () => 'fxb:' + def.modes.join('+') + (L.alpha ? 'a' : '');
  const g0 = u.uGlow.value;
  const update = (dt, t) => { u.uFx.value = t % 1000; u.uGlow.value = g0 * (1 + 0.1 * Math.sin(t * 3.1)); if (def.ghost) material.opacity = def.ghost + 0.1 * Math.sin(t * 2.2); };
  return { geometry, material, puff: def.puff, update, fxDef: def, stage };
}
export const EFFECT_BY_ID = Object.fromEntries(EFFECT_BALLS.map((d) => [d.item.id, d]));
export { TAU };
