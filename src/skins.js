// Ball skins + trail styles for the customization shop. 100% procedural: geometry + vertex colors.
//
//   makeSkin(id)    -> { id, geometry, material, puff, update?(dt, time, mesh), textures? }
//   trailStyle(id)  -> { color, rainbow, glow, color2?, palette? }   (palette: hex list, used with rainbow:true)
//   disposeSkin(s)  -> frees geometry / material / textures that makeSkin created
//   SKINS / TRAILS  -> shop catalog (rarity, price, unlock);  RARITY, sortCatalog(list) -> shop ordering
//
// Every skin geometry is non-indexed, unit radius (about 1, centred on the origin) and stays under ~2.5k
// triangles. Most carry position + normal + color; the two tile skins (cini, hali) carry position + normal +
// uv and sample a procedurally painted DataTexture instead (material.map, freed by disposeSkin).
// Materials are flat-shaded Lambert/Phong; none of them uses a custom onBeforeCompile except 'lav'.
// Animated skins touch their buffers at <= ~30 Hz and never allocate per frame.
import * as THREE from 'three';

const TAU = Math.PI * 2;

// ===================================================================================== catalog

export const RARITY = {
  common: { rank: 0, label: 'SIRADAN', color: '#8e9db3' },
  rare: { rank: 1, label: 'NADİR', color: '#2f7dff' },
  epic: { rank: 2, label: 'EPİK', color: '#a855f7' },
  legendary: { rank: 3, label: 'EFSANE', color: '#ffb400' },
};

// Catalog items: { id, name, rarity, price, unlock?, preview }
//   unlock: { stars: n }    free once totalStars() >= n (price 0) or purchasable from then on (price > 0)
//           { secret: id }  hidden ("GİZLİ"); the meta module grants it with save.own(kind, id) when the egg is found
//           { challenge: id } locked until the GÖREVLER entry `id` (meta.js ach 'ch_*') is claimed; shows its text and progress
//                             (its reward is the item itself, so it is owned once claimed). price stays 0: never sold.
// preview.pattern is consumed by shop.js (CSS preview); preview.c is an optional third colour, preview.glow adds an aura.
//   ball patterns : solid stripes dots swirl facets face cracks tiles eye globe
//                   tendrils flame goo plasma stars scales panels quills octo pumpkin zombie pentagon seams bowl tennis
//                   sesame baklava tile kilim donut cookie fluff penguin
//   trail patterns: solid (a -> b gradient) | swirl (full rainbow) | bands (a / b alternating)
export const SKINS = [
  // ---- SIRADAN
  { id: 'classic', name: 'Klasik Kar', rarity: 'common', price: 0, preview: { a: '#ffffff', b: '#cfe2f7', pattern: 'solid' } },
  { id: 'tenis', name: 'Tenis Topu', rarity: 'common', price: 120, preview: { a: '#d8f43a', b: '#a6c51a', c: '#ffffff', pattern: 'tennis' } },
  { id: 'ice', name: 'Buz Kristali', rarity: 'common', price: 150, preview: { a: '#d6f8ff', b: '#33b2e8', pattern: 'facets' } },
  { id: 'basket', name: 'Basket Topu', rarity: 'common', price: 180, preview: { a: '#f58a24', b: '#c8591a', c: '#1b1410', pattern: 'seams' } },
  { id: 'futbol', name: 'Futbol Topu', rarity: 'common', price: 200, preview: { a: '#ffffff', b: '#1a1c22', pattern: 'pentagon' } },
  { id: 'kurabiye', name: 'Kurabiye', rarity: 'common', price: 220, preview: { a: '#e6b66e', b: '#5d3016', pattern: 'cookie' } },
  { id: 'simit', name: 'Simit', rarity: 'common', price: 250, preview: { a: '#d98c3a', b: '#a85a1a', c: '#fff2c8', pattern: 'sesame' } },
  { id: 'donut', name: 'Donut', rarity: 'common', price: 280, preview: { a: '#ff8fc4', b: '#d9a05a', c: '#ffffff', pattern: 'donut' } },
  { id: 'kofte', name: 'Köfte', rarity: 'common', price: 300, preview: { a: '#9b5528', b: '#43200d', c: '#5cc552', pattern: 'stripes' } },
  { id: 'karpuz', name: 'Karpuz', rarity: 'common', price: 300, preview: { a: '#7fd96c', b: '#1b6a31', pattern: 'stripes' } },
  { id: 'bowling', name: 'Bowling Topu', rarity: 'common', price: 300, preview: { a: '#3b2db0', b: '#0f0a30', c: '#43b9f0', pattern: 'bowl' } },
  { id: 'mavikar', name: 'Mavi Kar', rarity: 'common', price: 140, preview: { a: '#9fd4ff', b: '#2f7dff', pattern: 'stripes' } },
  { id: 'nane', name: 'Nane Şekeri', rarity: 'common', price: 190, preview: { a: '#ffffff', b: '#ff4d6a', pattern: 'swirl' } },
  { id: 'cilek', name: 'Çilekli Kar', rarity: 'common', price: 260, preview: { a: '#ff7aa0', b: '#e0245a', c: '#fff2c8', pattern: 'dots' } },
  // ---- NADİR
  { id: 'yuz', name: 'Kardan Kafa', rarity: 'rare', price: 0, unlock: { stars: 6 }, preview: { a: '#ffffff', b: '#cfe2f7', c: '#ff7a1a', pattern: 'face' } },
  { id: 'penguen', name: 'Penguen Top', rarity: 'rare', price: 0, unlock: { stars: 10 }, preview: { a: '#26365c', b: '#f4f7fb', c: '#ff9a1a', pattern: 'penguin' } },
  { id: 'robot', name: 'Robo-Top', rarity: 'rare', price: 0, unlock: { stars: 24 }, preview: { a: '#aab6c8', b: '#5a6678', c: '#35e6ff', pattern: 'panels' } },
  { id: 'pamuk', name: 'Pamuk Şeker', rarity: 'rare', price: 500, preview: { a: '#ff9fd0', b: '#c7a6ff', pattern: 'swirl' } },
  { id: 'nazar', name: 'Nazar Boncuğu', rarity: 'rare', price: 500, preview: { a: '#12389e', b: '#3fc1ff', c: '#ffffff', pattern: 'eye' } },
  { id: 'kirpi', name: 'Kirpi', rarity: 'rare', price: 650, preview: { a: '#7a5230', b: '#3a281a', c: '#f0d2a8', pattern: 'quills' } },
  { id: 'poncik', name: 'Ponçik', rarity: 'rare', price: 750, preview: { a: '#ffd6e7', b: '#ffa9c8', c: '#2a1a2a', pattern: 'fluff' } },
  { id: 'disko', name: 'Disko Topu', rarity: 'rare', price: 800, preview: { a: '#e9f1ff', b: '#7d8db4', c: '#ff6ad5', pattern: 'tiles' } },
  { id: 'baklava', name: 'Baklava', rarity: 'rare', price: 800, preview: { a: '#f2b33d', b: '#a8620f', c: '#7fb83a', pattern: 'baklava' } },
  { id: 'balkabagi', name: 'Balkabağı', rarity: 'rare', price: 0, unlock: { secret: 'balkabagi' }, preview: { a: '#ff8a1a', b: '#c8520a', c: '#ffe45a', pattern: 'pumpkin' } },
  { id: 'zombi', name: 'Zombi Kafa', rarity: 'rare', price: 0, unlock: { secret: 'zombi' }, preview: { a: '#8fcf6a', b: '#4f7f3a', c: '#e8f0d0', pattern: 'zombie' } },
  // ---- EPİK
  { id: 'dunya', name: 'Mini Dünya', rarity: 'epic', price: 0, unlock: { stars: 18 }, preview: { a: '#2c78de', b: '#4cb050', c: '#ffffff', pattern: 'globe' } },
  { id: 'gunbatimi', name: 'Gün Batımı', rarity: 'rare', price: 900, preview: { a: '#ffb347', b: '#7a2fd0', pattern: 'swirl' } },
  { id: 'ahtapot', name: 'Ahtapot', rarity: 'epic', price: 1100, preview: { a: '#a24ce0', b: '#6a2aa8', c: '#ffc6ea', pattern: 'octo' } },
  { id: 'lav', name: 'Lav Topu', rarity: 'epic', price: 1200, preview: { a: '#2e2834', b: '#ff7a1a', pattern: 'cracks', glow: true } },
  { id: 'hali', name: 'Kilim', rarity: 'epic', price: 1400, preview: { a: '#c1272d', b: '#1f2f66', c: '#e8b43a', pattern: 'kilim' } },
  { id: 'ates', name: 'Ateş Topu', rarity: 'epic', price: 1500, preview: { a: '#ffd23a', b: '#ff3a10', c: '#ffb000', pattern: 'flame', glow: true } },
  { id: 'plazma', name: 'Plazma', rarity: 'epic', price: 1600, preview: { a: '#1d0a58', b: '#6a34e0', c: '#c6f4ff', pattern: 'plasma', glow: true } },
  { id: 'zehir', name: 'Zehir', rarity: 'epic', price: 1800, preview: { a: '#7dff4a', b: '#1b9e2a', c: '#e6ffa6', pattern: 'goo', glow: true } },
  { id: 'altin', name: 'Altın Top', rarity: 'epic', price: 2000, preview: { a: '#ffe681', b: '#d8940c', pattern: 'facets', glow: true } },
  // ---- EFSANE
  { id: 'buzejder', name: 'Buz Ejderi', rarity: 'legendary', price: 3000, preview: { a: '#7fe3ff', b: '#1b78c6', c: '#e8fcff', pattern: 'scales', glow: true } },
  { id: 'cini', name: 'İznik Çinisi', rarity: 'legendary', price: 3500, preview: { a: '#1b3f9e', b: '#1fb5b0', c: '#d8402a', pattern: 'tile' } },
  { id: 'karasivi', name: 'Kara Sıvı', rarity: 'legendary', price: 4500, preview: { a: '#1a2048', b: '#05060c', c: '#5a74ff', pattern: 'tendrils' } },
  { id: 'kizilkaos', name: 'Kızıl Kaos', rarity: 'legendary', price: 5500, preview: { a: '#e01428', b: '#3a0610', c: '#ff5a48', pattern: 'tendrils' } },
  { id: 'galaksi', name: 'Galaksi', rarity: 'legendary', price: 0, unlock: { secret: 'galaksi' }, preview: { a: '#0b0b3a', b: '#6a2aa8', c: '#ffffff', pattern: 'stars', glow: true } },
  // ---- YENİ: ucuz (300-800) / orta (1200-2500) / nadir (4000+) / 💎 premium (7500+) ❄ fiyatlı, aynı satın alma yolu
  { id: 'lahmacun', name: 'Lahmacun', rarity: 'common', price: 350, preview: { a: '#e9b26a', b: '#b5501f', c: '#6fb23c', pattern: 'dots' } },
  { id: 'kiraz', name: 'Kiraz', rarity: 'common', price: 420, preview: { a: '#ff3b5c', b: '#8a0820', c: '#ffe0e6', pattern: 'dots' } },
  { id: 'kavun', name: 'Kavun', rarity: 'common', price: 480, preview: { a: '#f7e27a', b: '#6aa84f', pattern: 'stripes' } },
  { id: 'konfeti', name: 'Konfeti Topu', rarity: 'common', price: 600, preview: { a: '#ffffff', b: '#ff5ca8', c: '#3ad0ff', pattern: 'dots' } },
  { id: 'zumrut', name: 'Zümrüt', rarity: 'rare', price: 750, preview: { a: '#3ee08a', b: '#0a7a4a', pattern: 'facets' } },
  { id: 'lokum', name: 'Lokum', rarity: 'rare', price: 1250, preview: { a: '#fff5f7', b: '#f2a6c0', pattern: 'fluff' } },
  { id: 'gokkusagi', name: 'Gökkuşağı Topu', rarity: 'epic', price: 1700, preview: { a: '#ff4d4d', b: '#7a5cff', c: '#ffd23a', pattern: 'swirl' } },
  { id: 'nebula', name: 'Nebula', rarity: 'epic', price: 2000, preview: { a: '#2b0a4a', b: '#ff5ac8', c: '#7ae7ff', pattern: 'plasma', glow: true } },
  { id: 'karprens', name: 'Kar Tanesi Prensi', rarity: 'epic', price: 2300, preview: { a: '#f4fbff', b: '#9fd8ff', c: '#ffffff', pattern: 'stars' } },
  { id: 'altinkral', name: 'Altın Kral', rarity: 'legendary', price: 4000, preview: { a: '#fff3b0', b: '#d8940c', c: '#7a4a00', pattern: 'tiles', glow: true } },
  { id: 'kristal', name: 'Kristal Ejder', rarity: 'legendary', price: 7500, preview: { a: '#ffffff', b: '#00b8e6', c: '#e8fcff', pattern: 'scales', glow: true } },
  { id: 'gunestaci', name: 'Güneş Tacı', rarity: 'legendary', price: 9000, preview: { a: '#ffd23a', b: '#ff3a10', c: '#ffb000', pattern: 'flame', glow: true } },
  // ---- GÖREVLER ödülü (özel): fiyatsız, satılmaz ve kutudan çıkmaz; yalnızca ilgili görevi bitirip ödülünü alınca açılır
  { id: 'kombo_top', name: 'Kombo Topu', rarity: 'epic', price: 0, unlock: { challenge: 'ch_kombo8' }, preview: { a: '#ff9a1a', b: '#fff3a0', c: '#7a2a00', pattern: 'swirl', glow: true } },
  { id: 'gunluk_kar', name: 'Günlük Kar', rarity: 'rare', price: 0, unlock: { challenge: 'ch_daily10' }, preview: { a: '#ffffff', b: '#9fd8ff', c: '#c6f0ff', pattern: 'dots' } },
  { id: 'gece_topu', name: 'Gece Topu', rarity: 'epic', price: 0, unlock: { challenge: 'ch_night5' }, preview: { a: '#0b1640', b: '#3a4fa0', c: '#c8d8ff', pattern: 'stars' } },
  { id: 'arena_kral', name: 'Arena Kralı', rarity: 'legendary', price: 0, unlock: { challenge: 'ch_arena1000' }, preview: { a: '#9fd8ff', b: '#2a6fb8', c: '#ffffff', pattern: 'facets', glow: true } },
  { id: 'tac_top', name: 'Taç Topu', rarity: 'legendary', price: 0, unlock: { challenge: 'ch_arenaLead' }, preview: { a: '#ffe681', b: '#d8940c', c: '#7a4a00', pattern: 'tiles', glow: true } },
];

// KARAKTER snowballs: one small passive Rush ability each (endless Rush only; read by runner.js).
export const ABILITIES = {
  kofte: { icon: '🧲', text: 'Mıknatıs %30 daha uzun sürer' },
  simit: { icon: '🥯', text: 'Her koşuda ilk çarpma affedilir' },
  nazar: { icon: '🧿', text: 'Yeti 3 m daha uzak başlar' },
  cini: { icon: '🪙', text: '+%10 bozuk para' },
  kizilkaos: { icon: '🔥', text: 'Öfke ölçeri %20 hızlı dolar' },
  buzejder: { icon: '🧊', text: 'Buz kaydırağı çifte hız verir' },
  kirpi: { icon: '🦔', text: 'Ezme sıçraması yüksek, kombo +1' },
  altin: { icon: '💎', text: 'Elmaslar daha sık çıkar' },
  penguen: { icon: '🐧', text: 'Penguen takipçisiyle başla (x1)' },
};

export const TRAILS = [
  // ---- SIRADAN
  { id: 'classic', name: 'Kar İzi', rarity: 'common', price: 0, preview: { a: '#e8f2ff', b: '#bcd3ee', pattern: 'solid' } },
  { id: 'pink', name: 'Pembe', rarity: 'common', price: 100, preview: { a: '#ffc2e2', b: '#ff6fb5', pattern: 'solid' } },
  { id: 'neon', name: 'Neon Mavi', rarity: 'common', price: 300, preview: { a: '#9aeeff', b: '#1fa8ff', pattern: 'solid', glow: true } },
  // ---- NADİR
  { id: 'kalp', name: 'Kalp', rarity: 'rare', price: 450, preview: { a: '#ffb3dc', b: '#ff3f9a', pattern: 'solid', glow: true } },
  { id: 'gold', name: 'Altın Toz', rarity: 'rare', price: 500, preview: { a: '#ffe681', b: '#ffb300', pattern: 'solid', glow: true } },
  { id: 'zehirli', name: 'Zehir İzi', rarity: 'rare', price: 600, preview: { a: '#c4ff7a', b: '#1fc84a', pattern: 'solid', glow: true } },
  { id: 'simsek', name: 'Şimşek', rarity: 'rare', price: 700, preview: { a: '#d4f2ff', b: '#2f66ff', pattern: 'solid', glow: true } },
  { id: 'fire', name: 'Ateş', rarity: 'rare', price: 800, preview: { a: '#ffd23a', b: '#ff3a10', pattern: 'solid', glow: true } },
  // ---- EPİK
  { id: 'rainbow', name: 'Gökkuşağı', rarity: 'epic', price: 0, unlock: { stars: 12 }, preview: { a: '#ff4d4d', b: '#7a5cff', pattern: 'swirl' } },
  { id: 'kaos', name: 'Kaos İzi', rarity: 'epic', price: 1500, preview: { a: '#ff2a3a', b: '#14000a', pattern: 'solid' } },
  { id: 'galaksi', name: 'Yıldız Tozu', rarity: 'epic', price: 1800, preview: { a: '#d6b8ff', b: '#5b3bd6', pattern: 'solid', glow: true } },
  // ---- EFSANE
  { id: 'cini', name: 'Çini İzi', rarity: 'legendary', price: 3200, preview: { a: '#1b3f9e', b: '#1fb5b0', pattern: 'bands' } },
  // ---- YENİ
  { id: 'konfeti', name: 'Konfeti', rarity: 'common', price: 250, preview: { a: '#ff5ca8', b: '#3ad0ff', pattern: 'swirl' } },
  { id: 'nane_izi', name: 'Nane İzi', rarity: 'common', price: 280, preview: { a: '#c8fff0', b: '#1fb88a', pattern: 'solid' } },
  { id: 'kar_firtinasi', name: 'Kar Fırtınası', rarity: 'rare', price: 550, preview: { a: '#ffffff', b: '#9fd8ff', pattern: 'solid', glow: true } },
  { id: 'okyanus', name: 'Okyanus', rarity: 'rare', price: 650, preview: { a: '#7ff0ff', b: '#0a4fa0', pattern: 'solid', glow: true } },
  { id: 'altin_pul', name: 'Altın Pul', rarity: 'rare', price: 900, preview: { a: '#fff6c2', b: '#d8940c', pattern: 'swirl', glow: true } },
  { id: 'lav_izi', name: 'Lav İzi', rarity: 'epic', price: 1300, preview: { a: '#ffb000', b: '#8a1a00', pattern: 'bands', glow: true } },
  { id: 'gunes', name: 'Güneş İzi', rarity: 'epic', price: 2200, preview: { a: '#fff3a0', b: '#ff8a1a', pattern: 'swirl', glow: true } },
  { id: 'kristal_izi', name: 'Kristal İzi', rarity: 'legendary', price: 3600, preview: { a: '#e8fcff', b: '#3ac8ff', pattern: 'bands', glow: true } },
  // ---- GÖREVLER ödülü (özel), bkz. SKINS
  { id: 'kart_izi', name: 'Kart İzi', rarity: 'epic', price: 0, unlock: { challenge: 'ch_buff25' }, preview: { a: '#ffd23a', b: '#3ad0ff', pattern: 'swirl' } },
  { id: 'firtina_izi', name: 'Çılgın Kar İzi', rarity: 'epic', price: 0, unlock: { challenge: 'ch_fever10' }, preview: { a: '#8ff4ff', b: '#3ac8ff', pattern: 'bands', glow: true } },
  { id: 'seri_izi', name: 'Seri İzi', rarity: 'rare', price: 0, unlock: { challenge: 'ch_play7' }, preview: { a: '#a8ffc0', b: '#2fd06a', pattern: 'solid', glow: true } },
];

const TRAIL_STYLES = {
  classic: { color: 0xbcd3ee, rainbow: false, glow: false },
  rainbow: { color: 0xffffff, rainbow: true, glow: false },
  gold: { color: 0xffcf3a, rainbow: false, glow: true },
  pink: { color: 0xff8fc8, rainbow: false, glow: false },
  neon: { color: 0x3ad0ff, rainbow: false, glow: true },
  // fire: color (head, near the ball) -> color2 (tail). Engines that only know `color` just use orange.
  fire: { color: 0xff7a1a, color2: 0xff2a0a, rainbow: false, glow: true },
  simsek: { color: 0x6ab8ff, color2: 0x2f5cff, rainbow: false, glow: true },
  zehirli: { color: 0x7dff4a, color2: 0x12a82a, rainbow: false, glow: true },
  kaos: { color: 0xe01428, color2: 0x12000a, rainbow: false, glow: false },
  galaksi: { color: 0xa070ff, color2: 0x4a8cff, rainbow: false, glow: true },
  kalp: { color: 0xff6fb5, color2: 0xff9fd0, rainbow: false, glow: true },
  konfeti: { color: 0xff5ca8, color2: 0x3ad0ff, rainbow: true, glow: false, palette: [0xff5ca8, 0xffd23a, 0x3ad0ff, 0x7dff4a, 0xb07aff] },
  nane_izi: { color: 0x7fffd4, color2: 0x1fb88a, rainbow: false, glow: false },
  kar_firtinasi: { color: 0xeaf6ff, color2: 0x9fd8ff, rainbow: false, glow: true },
  okyanus: { color: 0x7ff0ff, color2: 0x0a4fa0, rainbow: false, glow: true },
  altin_pul: { color: 0xffe681, color2: 0xd8940c, rainbow: true, glow: true, palette: [0xfff6c2, 0xffd23a, 0xd8940c, 0xffe681] },
  lav_izi: { color: 0xffb000, color2: 0x8a1a00, rainbow: true, glow: true, palette: [0xffb000, 0xff5a10, 0x8a1a00, 0xff3a10] },
  gunes: { color: 0xfff3a0, color2: 0xff8a1a, rainbow: true, glow: true, palette: [0xfff3a0, 0xffd23a, 0xff8a1a, 0xffffff] },
  kristal_izi: { color: 0xe8fcff, color2: 0x3ac8ff, rainbow: true, glow: true, palette: [0xe8fcff, 0x3ac8ff, 0xffffff, 0x7fe3ff] },
  // cini: rainbow:true means "per-vertex ribbon colours"; palette (hex list) replaces the HSL rainbow, cycled along the ribbon.
  cini: { color: 0x1b3f9e, color2: 0x1fb5b0, rainbow: true, glow: false, palette: [0x1b3f9e, 0x1fb5b0, 0xf4efe0, 0x1fb5b0] },
  kart_izi: { color: 0xffd23a, color2: 0x3ad0ff, rainbow: true, glow: false, palette: [0xffd23a, 0x3ad0ff, 0xff5ca8, 0xffffff] },
  firtina_izi: { color: 0x8ff4ff, color2: 0xffffff, rainbow: true, glow: true, palette: [0x8ff4ff, 0xffffff, 0x3ac8ff] },
  seri_izi: { color: 0xa8ffc0, rainbow: false, glow: true },
};

export function trailStyle(id) {
  const st = { ...(TRAIL_STYLES[id] || TRAIL_STYLES.classic) };
  if (st.palette) st.palette = st.palette.slice();
  return st;
}

// Rarity (common -> legendary), then secret last, then price, then star requirement, then catalog order.
export function sortCatalog(list) {
  const rank = (it) => (RARITY[it.rarity] ? RARITY[it.rarity].rank : 0);
  return list
    .map((it, i) => [it, i])
    .sort((A, B) => {
      const a = A[0], b = B[0];
      return (
        rank(a) - rank(b) ||
        (a.unlock && a.unlock.secret ? 1 : 0) - (b.unlock && b.unlock.secret ? 1 : 0) ||
        a.price - b.price ||
        ((a.unlock && a.unlock.stars) || 0) - ((b.unlock && b.unlock.stars) || 0) ||
        A[1] - B[1]
      );
    })
    .map((x) => x[0]);
}

// ===================================================================================== helpers

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Lattice hash -> [0,1)
function hash3(x, y, z) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in [0,1]. Continuous in position, so displacing welded vertices by it keeps the mesh closed.
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi), c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi);
  const e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1), g = hash3(xi, yi + 1, zi + 1), h = hash3(xi + 1, yi + 1, zi + 1);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}

function fbm3(x, y, z, oct = 3) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise3(x * f, y * f, z * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _v = new THREE.Vector3();

// Icosphere with radial displacement + colours chosen per direction.
//   shape(x,y,z) -> radial offset (added to 1)            (x,y,z is the unit direction)
//   paint(x,y,z,c) -> writes THREE.Color c, may return glow alpha (only when alpha:true)
//   perFace: colour each triangle from its centroid (crisp low-poly patterns); otherwise per vertex (soft gradients)
function buildSphere({ detail, shape, paint, perFace = true, alpha = false }) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position;
  const n = pos.count;
  const dirs = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(pos, i).normalize();
    dirs[i * 3] = _v.x; dirs[i * 3 + 1] = _v.y; dirs[i * 3 + 2] = _v.z;
    const r = 1 + (shape ? shape(_v.x, _v.y, _v.z) : 0);
    pos.setXYZ(i, _v.x * r, _v.y * r, _v.z * r);
  }
  const size = alpha ? 4 : 3;
  const col = new Float32Array(n * size);
  const c = new THREE.Color();
  const put = (i, a) => {
    const o = i * size;
    col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    if (alpha) col[o + 3] = a;
  };
  if (perFace) {
    for (let t = 0; t < n; t += 3) {
      let x = dirs[t * 3] + dirs[t * 3 + 3] + dirs[t * 3 + 6];
      let y = dirs[t * 3 + 1] + dirs[t * 3 + 4] + dirs[t * 3 + 7];
      let z = dirs[t * 3 + 2] + dirs[t * 3 + 5] + dirs[t * 3 + 8];
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      const a = paint(x, y, z, c);
      const aa = a === undefined ? 1 : a;
      put(t, aa); put(t + 1, aa); put(t + 2, aa);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const a = paint(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2], c);
      put(i, a === undefined ? 1 : a);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, size));
  geo.computeVertexNormals();
  return geo;
}

// Give an arbitrary geometry a uniform / per-vertex colour (for merged accessories).
function tint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (typeof fn === 'function') fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    else c.set(fn);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Merge non-indexed (or indexed -> converted) geometries that all carry a 3-component colour.
function mergeGeos(list) {
  const gs = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of gs) {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  for (let i = 0; i < list.length; i++) { list[i].dispose(); if (gs[i] !== list[i]) gs[i].dispose(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const lambert = (extra) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...extra });
const phong = (extra) => new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, ...extra });

// ===================================================================================== toolkit (wave 2)
// Everything below is build-time only unless it says "per frame" (those paths never allocate).

const STEP = 1 / 31; // animated skins touch their buffers at <= ~30 Hz
const _c1 = new THREE.Color();
const _qw = new THREE.Quaternion();
const _uv = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// n roughly even directions (Fibonacci lattice), optionally jittered.
function fibDirs(n, rnd, jitter = 0) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    let v = [Math.cos(ga * i) * r, y, Math.sin(ga * i) * r];
    if (jitter && rnd) v = norm3([v[0] + (rnd() - 0.5) * jitter, v[1] + (rnd() - 0.5) * jitter, v[2] + (rnd() - 0.5) * jitter]);
    out.push(v);
  }
  return out;
}

function randDir(rnd) {
  const z = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

// Tangent frame at direction F: R to the right, U up, F towards the viewer (R x U = F).
function frameOf(F, upHint = [0, 1, 0]) {
  F = norm3(F);
  let R = cross3(upHint, F);
  if (Math.hypot(R[0], R[1], R[2]) < 1e-4) R = cross3([1, 0, 0], F);
  R = norm3(R);
  return { F, R, U: cross3(F, R) };
}

// (u,v) on the tangent plane of a frame -> point on a sphere. r may be a number or (x,y,z)=>radius.
function at(fr, u, v, r = 1) {
  let x = fr.F[0] + fr.R[0] * u + fr.U[0] * v;
  let y = fr.F[1] + fr.R[1] * u + fr.U[1] * v;
  let z = fr.F[2] + fr.R[2] * u + fr.U[2] * v;
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  const k = typeof r === 'function' ? r(x, y, z) : r;
  return [x * k, y * k, z * k];
}

// Plain triangle soup builder: positions + vertex colours, auto-fixes winding for star-shaped parts.
class MB {
  constructor() { this.p = []; this.c = []; }
  get count() { return this.p.length / 3; }
  tri(a, b, c, col, fix = true) { this.tri3(a, b, c, col, col, col, fix); }
  tri3(a, b, c, ca, cb, cc, fix = true) {
    if (fix) {
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (nx * (a[0] + b[0] + c[0]) + ny * (a[1] + b[1] + c[1]) + nz * (a[2] + b[2] + c[2]) < 0) {
        const t = b; b = c; c = t;
        const tc = cb; cb = cc; cc = tc;
      }
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.c.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }
  // Triangle whose outward direction is known (non star-shaped parts such as a torus).
  triN(a, b, c, col, n) {
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nx * n[0] + ny * n[1] + nz * n[2] < 0) this.tri(a, c, b, col, false);
    else this.tri(a, b, c, col, false);
  }
  quad(a, b, c, d, col, fix = true) { this.tri(a, b, c, col, fix); this.tri(a, c, d, col, fix); }
  // Append a three geometry. col: Color | hex | (x,y,z,c)=>void | undefined (keep the geometry's own colours).
  geo(g, col) {
    const ng = g.index ? g.toNonIndexed() : g;
    const pos = ng.attributes.position, ca = ng.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      this.p.push(x, y, z);
      if (col === undefined) this.c.push(ca.getX(i), ca.getY(i), ca.getZ(i));
      else {
        if (typeof col === 'function') col(x, y, z, _c1); else _c1.set(col);
        this.c.push(_c1.r, _c1.g, _c1.b);
      }
    }
    if (ng !== g) ng.dispose();
    g.dispose();
  }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    geo.computeVertexNormals();
    return geo;
  }
}

// Orient a +Y-pointing accessory geometry along `dir`, stretched by (sx,sy,sz), base at `pos`.
const _qa = new THREE.Quaternion();
function aim(g, dir, pos, sx = 1, sy = 1, sz = 1) {
  g.deleteAttribute('uv');
  g.scale(sx, sy, sz);
  g.applyQuaternion(_qa.setFromUnitVectors(_Y, _uv.set(dir[0], dir[1], dir[2]).normalize()));
  g.translate(pos[0], pos[1], pos[2]);
  return g;
}
const cone = (r, h, seg = 5, open = true) => {
  const g = new THREE.ConeGeometry(r, h, seg, 1, open);
  g.translate(0, h / 2, 0);
  return g;
};
const ball = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);

// ---- decals: flat shapes drawn on the tangent plane and pushed onto the sphere (crisp, resolution independent) ----
function decalTri(mb, fr, a, b, c, r, col, sub = 1) {
  if (sub > 0) {
    const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
    decalTri(mb, fr, a, ab, ca, r, col, sub - 1);
    decalTri(mb, fr, ab, b, bc, r, col, sub - 1);
    decalTri(mb, fr, ca, bc, c, r, col, sub - 1);
    decalTri(mb, fr, ab, bc, ca, r, col, sub - 1);
    return;
  }
  mb.tri(at(fr, a[0], a[1], r), at(fr, b[0], b[1], r), at(fr, c[0], c[1], r), col, true);
}
// Star-shaped polygon (points in (u,v)), fanned from its centroid.
function decalPoly(mb, fr, pts, r, col, sub = 0) {
  let cu = 0, cv = 0;
  for (const p of pts) { cu += p[0]; cv += p[1]; }
  cu /= pts.length; cv /= pts.length;
  for (let i = 0; i < pts.length; i++) decalTri(mb, fr, [cu, cv], pts[i], pts[(i + 1) % pts.length], r, col, sub);
}
// Ellipse, rotated by rot radians.
function decalEllipse(mb, fr, u, v, ru, rv, sides, r, col, rot = 0, sub = 0) {
  const pts = [], cs = Math.cos(rot), sn = Math.sin(rot);
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU, x = Math.cos(a) * ru, y = Math.sin(a) * rv;
    pts.push([u + x * cs - y * sn, v + x * sn + y * cs]);
  }
  decalPoly(mb, fr, pts, r, col, sub);
}
// Ribbon along a polyline of unit directions. col: Color or (i)=>Color. closed: loop back to the start.
function decalStrip(mb, pts, width, r, col, closed = false) {
  const n = pts.length;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const pa = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)], pb = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const side = norm3(cross3(pts[i], [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]));
    const rr = typeof r === 'function' ? r(pts[i][0], pts[i][1], pts[i][2]) : r;
    const l = norm3(add3(pts[i], side, width / 2)), q = norm3(add3(pts[i], side, -width / 2));
    L.push([l[0] * rr, l[1] * rr, l[2] * rr]);
    R.push([q[0] * rr, q[1] * rr, q[2] * rr]);
  }
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n;
    const c = typeof col === 'function' ? col(i) : col;
    mb.tri(L[i], R[i], R[j], c, true);
    mb.tri(L[i], R[j], L[j], c, true);
  }
}
// Great circle (or small circle at angular radius `ang` from the pole) as a polyline of unit directions.
function circlePts(normal, steps, ang = Math.PI / 2) {
  const n = norm3(normal);
  const e1 = norm3(cross3(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const e2 = cross3(n, e1);
  const out = [];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU, c = Math.cos(t), s = Math.sin(t);
    out.push([n[0] * ca + (e1[0] * c + e2[0] * s) * sa, n[1] * ca + (e1[1] * c + e2[1] * s) * sa, n[2] * ca + (e1[2] * c + e2[2] * s) * sa]);
  }
  return out;
}

// ---- face-colour helpers for per-triangle animation ----
function faceCentroids(geo, count) {
  const pos = geo.attributes.position.array;
  const nf = count === undefined ? pos.length / 9 : count;
  const out = new Float32Array(nf * 3);
  for (let t = 0; t < nf; t++) {
    const o = t * 9;
    let x = pos[o] + pos[o + 3] + pos[o + 6], y = pos[o + 1] + pos[o + 4] + pos[o + 7], z = pos[o + 2] + pos[o + 5] + pos[o + 8];
    const l = Math.hypot(x, y, z) || 1;
    out[t * 3] = x / l; out[t * 3 + 1] = y / l; out[t * 3 + 2] = z / l;
  }
  return out;
}
function setFace(arr, f, r, g, b) {
  const o = f * 9;
  arr[o] = arr[o + 3] = arr[o + 6] = r;
  arr[o + 1] = arr[o + 4] = arr[o + 7] = g;
  arr[o + 2] = arr[o + 5] = arr[o + 8] = b;
}

// Concatenate static geometry with extra (dynamic) vertices; returns the geometry and the float offset of the extra part.
function joinGeo(core, extraPos, extraCol, boundR = 1.5) {
  const cp = core.attributes.position.array, cc = core.attributes.color.array;
  const pos = new Float32Array(cp.length + extraPos.length), col = new Float32Array(cc.length + extraCol.length);
  pos.set(cp); pos.set(extraPos, cp.length);
  col.set(cc); col.set(extraCol, cc.length);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boundR); // fixed: the vertices move every frame
  core.dispose();
  return { geometry: geo, offset: cp.length };
}

// Radial breathing of an icosphere region. Vertex copies of the same corner share one phase (it is a function of
// position), so the sines are evaluated once per unique corner (~6x fewer than per vertex).
function makeWobble(arr, nVerts) {
  const dirs = new Float32Array(nVerts * 3), uid = new Uint16Array(nVerts);
  const keys = new Map(), ru = [], q1 = [], q2 = [];
  for (let i = 0; i < nVerts; i++) {
    const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
    const r = Math.hypot(x, y, z) || 1;
    dirs[i * 3] = x / r; dirs[i * 3 + 1] = y / r; dirs[i * 3 + 2] = z / r;
    const key = Math.round(x * 2048) + ',' + Math.round(y * 2048) + ',' + Math.round(z * 2048);
    let u = keys.get(key);
    if (u === undefined) {
      u = ru.length;
      keys.set(key, u);
      ru.push(r); q1.push(x * 3.1 + y * 2.3 + z * 4.1); q2.push(-x * 2.2 + y * 4.7 + z * 1.9);
    }
    uid[i] = u;
  }
  const nU = ru.length, rad = Float32Array.from(ru), p1 = Float32Array.from(q1), p2 = Float32Array.from(q2), kk = new Float32Array(nU);
  return {
    apply(out, t, amp, w) {
      const a = t * w, b = t * w * 1.7;
      for (let u = 0; u < nU; u++) kk[u] = rad[u] * (1 + amp * (Math.sin(a + p1[u]) + 0.6 * Math.sin(b + p2[u])) * 0.62);
      for (let i = 0; i < nVerts; i++) {
        const k = kk[uid[i]], o = i * 3;
        out[o] = dirs[o] * k; out[o + 1] = dirs[o + 1] * k; out[o + 2] = dirs[o + 2] * k;
      }
    },
  };
}

// World "up" expressed in the mesh's local frame (so flames can lick upwards however the ball has rolled).
function localUp(mesh, out) {
  if (mesh && mesh.getWorldQuaternion) {
    mesh.getWorldQuaternion(_qw);
    _qw.invert();
    _uv.set(0, 1, 0).applyQuaternion(_qw);
    out[0] = _uv.x; out[1] = _uv.y; out[2] = _uv.z;
  } else { out[0] = 0; out[1] = 1; out[2] = 0; }
}

// Bendy tapered tubes growing out of the sphere: goo tendrils, flames, tentacles, quills.
// Each ring is placed by integrating a curvature profile along the arc, so the same code curls (octopus),
// sways (goo) or stays straight (quills). animate() never allocates.
class Limbs {
  // dirs [[x,y,z]], len[] arc length, thick[] tube radius, prof [[s, rho]] rings (s ascending in 0..1), rootR ring-0 radius
  constructor({ dirs, len, thick, prof, seg = 6, rootR = 0.7, apex = 0.12, rnd }) {
    const n = (this.n = dirs.length), nr = (this.nr = prof.length);
    this.seg = seg; this.rootR = rootR; this.apex = apex;
    this.T0 = new Float32Array(n * 3); this.P = new Float32Array(n * 3); this.Q = new Float32Array(n * 3);
    this.L = Float32Array.from(len); this.th = Float32Array.from(thick);
    this.psi0 = new Float32Array(n); this.ph = new Float32Array(n);
    this.s = Float32Array.from(prof, (p) => p[0]); this.rho = Float32Array.from(prof, (p) => p[1]);
    this.kap = new Float32Array(nr);
    this.out = { psi: 0, len: 1, thick: 1 };
    this.cosK = new Float32Array(seg); this.sinK = new Float32Array(seg);
    for (let k = 0; k < seg; k++) { this.cosK[k] = Math.cos((k / seg) * TAU); this.sinK[k] = Math.sin((k / seg) * TAU); }
    for (let j = 0; j < n; j++) {
      const a = norm3(dirs[j]);
      const p = norm3(cross3(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const q = cross3(a, p);
      this.T0.set(a, j * 3); this.P.set(p, j * 3); this.Q.set(q, j * 3);
      this.psi0[j] = rnd ? rnd() * TAU : j * 2.4;
      this.ph[j] = rnd ? rnd() * TAU : j * 1.7;
    }
    const idx = [];
    for (let i = 0; i < nr - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        const p00 = i * seg + k, p01 = i * seg + k1, p10 = (i + 1) * seg + k, p11 = (i + 1) * seg + k1;
        idx.push(p00, p01, p11, p00, p11, p10);
      }
    }
    for (let k = 0; k < seg; k++) idx.push((nr - 1) * seg + k, (nr - 1) * seg + ((k + 1) % seg), nr * seg);
    this.idx = Uint16Array.from(idx);
    this.vPer = idx.length;
    this.ring = new Float32Array((nr * seg + 1) * 3);
  }

  get vertexCount() { return this.n * this.vPer; }

  // fn(j, t, out{psi,len,thick}, kap[], s[]) fills the bend of limb j; kap[i] is curvature (rad per unit length) at ring i >= 1.
  animate(pos, off, t, fn) {
    const { n, nr, seg, T0, P, Q, s, rho, ring, idx, kap, out, cosK, sinK, vPer } = this;
    for (let j = 0; j < n; j++) {
      out.psi = this.psi0[j]; out.len = 1; out.thick = 1;
      for (let i = 0; i < nr; i++) kap[i] = 0;
      if (fn) fn(j, t, out, kap, s);
      const L = this.L[j] * out.len, th = this.th[j] * out.thick;
      const j3 = j * 3;
      const ax = T0[j3], ay = T0[j3 + 1], az = T0[j3 + 2];
      const cp = Math.cos(out.psi), sp = Math.sin(out.psi);
      const bx = P[j3] * cp + Q[j3] * sp, by = P[j3 + 1] * cp + Q[j3 + 1] * sp, bz = P[j3 + 2] * cp + Q[j3 + 2] * sp; // bend direction
      const zx = Q[j3] * cp - P[j3] * sp, zy = Q[j3 + 1] * cp - P[j3 + 1] * sp, zz = Q[j3 + 2] * cp - P[j3 + 2] * sp;  // out-of-plane axis
      let cx = ax * this.rootR, cy = ay * this.rootR, cz = az * this.rootR;
      let ang = 0, sPrev = s[0];
      let ca = 1, sa = 0;
      for (let i = 0; i < nr; i++) {
        if (i > 0) {
          const ds = (s[i] - sPrev) * L;
          const k = kap[i];
          const am = ang + 0.5 * k * ds;
          const c1 = Math.cos(am), s1 = Math.sin(am);
          cx += (ax * c1 + bx * s1) * ds; cy += (ay * c1 + by * s1) * ds; cz += (az * c1 + bz * s1) * ds;
          ang += k * ds;
          sPrev = s[i];
          ca = Math.cos(ang); sa = Math.sin(ang);
        }
        const n1x = bx * ca - ax * sa, n1y = by * ca - ay * sa, n1z = bz * ca - az * sa;
        const rr = th * rho[i];
        let o = i * seg * 3;
        for (let k = 0; k < seg; k++) {
          const ck = cosK[k] * rr, sk = sinK[k] * rr;
          ring[o++] = cx + n1x * ck + zx * sk; ring[o++] = cy + n1y * ck + zy * sk; ring[o++] = cz + n1z * ck + zz * sk;
        }
      }
      const ext = this.apex * L;
      const o = nr * seg * 3;
      ring[o] = cx + (ax * ca + bx * sa) * ext; ring[o + 1] = cy + (ay * ca + by * sa) * ext; ring[o + 2] = cz + (az * ca + bz * sa) * ext;
      let w = off + j * vPer * 3;
      for (let m = 0; m < vPer; m++) {
        const v = idx[m] * 3;
        pos[w++] = ring[v]; pos[w++] = ring[v + 1]; pos[w++] = ring[v + 2];
      }
    }
  }

  // Rest-pose positions and vertex colours. colorFn(j, i, k, s, out): ring i (k = segment, or -1 for the apex tip).
  bake(colorFn) {
    const pos = new Float32Array(this.vertexCount * 3), col = new Float32Array(this.vertexCount * 3);
    this.animate(pos, 0, 0, null);
    const { n, nr, seg, idx, vPer, s } = this;
    for (let j = 0; j < n; j++) {
      for (let m = 0; m < vPer; m++) {
        const v = idx[m];
        const apex = v >= nr * seg;
        const i = apex ? nr - 1 : (v / seg) | 0, k = apex ? -1 : v % seg;
        colorFn(j, i, k, apex ? 1 : s[i], _c1, apex);
        const o = (j * vPer + m) * 3;
        col[o] = _c1.r; col[o + 1] = _c1.g; col[o + 2] = _c1.b;
      }
    }
    return { pos, col };
  }
}

// ===================================================================================== skins

// -- classic: exactly the original lumpy snowball from ball.js --------------------------------
const classicN = (x, y, z) => Math.sin(x * 5.1 + y * 2.3) * Math.sin(z * 4.3 - x * 1.7) + Math.sin(y * 7.7 + z * 3.1) * 0.5;

function classicGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(0xffffff), shade = new THREE.Color(0xcfe2f7), c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = classicN(v.x, v.y, v.z);
    v.multiplyScalar(1 + n * 0.045);
    pos.setXYZ(i, v.x, v.y, v.z);
    c.copy(base).lerp(shade, Math.max(0, n) * 0.6);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function skinClassic() {
  return { geometry: classicGeometry(), material: lambert(), puff: 0xffffff };
}

// -- ice: sharp 80-facet gem, glassy highlights ------------------------------------------------
function skinIce() {
  const deep = new THREE.Color(0x2fb0ea), mid = new THREE.Color(0x86e0ff), pale = new THREE.Color(0xe6fbff);
  const geometry = buildSphere({
    detail: 1,
    shape: (x, y, z) => (noise3(x * 1.7 + 4, y * 1.7, z * 1.7) - 0.5) * 0.4,
    paint: (x, y, z, c) => {
      const t = clamp01(0.55 * noise3(x * 2.3 + 9, y * 2.3 + 2, z * 2.3 + 5) + 0.45 * noise3(x * 8 + 3, y * 8 + 1, z * 8 + 7));
      if (t < 0.5) c.copy(deep).lerp(mid, t * 2); else c.copy(mid).lerp(pale, (t - 0.5) * 2);
    },
  });
  const material = phong({ shininess: 110, specular: 0xffffff, emissive: 0x0b4766 });
  return { geometry, material, puff: 0xbfefff };
}

// -- köfte: charred brown meatball, grill marks, parsley flecks ---------------------------------
function skinKofte() {
  const rnd = rng(1453);
  const flecks = [];
  for (let i = 0; i < 20; i++) {
    const z = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - z * z);
    flecks.push(r * Math.cos(a), z, r * Math.sin(a));
  }
  const FLECK_COS = Math.cos(0.12);
  const crust = new THREE.Color(0x9b5528), crustHi = new THREE.Color(0xc07a44), burnt = new THREE.Color(0x3a1a0a), char2 = new THREE.Color(0x5c2c13);
  const leaf = new THREE.Color(0x4cb545), leaf2 = new THREE.Color(0x2e8c37);
  const geometry = buildSphere({
    detail: 7,
    shape: (x, y, z) => (fbm3(x * 2.2 + 1.3, y * 2.2 + 7.1, z * 2.2 + 3.7, 2) - 0.5) * 0.2 + (noise3(x * 6, y * 6, z * 6) - 0.5) * 0.05,
    paint: (x, y, z, c) => {
      c.copy(crust).lerp(crustHi, clamp01((fbm3(x * 3.1, y * 3.1 + 5, z * 3.1, 2) - 0.35) * 2.2));
      // diagonal grill bars, patchy like a real skewer
      const s = Math.sin((x * 0.85 + y * 0.6 + z * 0.25) * 17);
      if (s > 0.3 && noise3(x * 2.6 + 11, y * 2.6, z * 2.6) > 0.3) c.copy(s > 0.72 ? burnt : char2);
      for (let i = 0; i < flecks.length; i += 3) {
        if (x * flecks[i] + y * flecks[i + 1] + z * flecks[i + 2] > FLECK_COS) { c.copy(i % 2 ? leaf : leaf2); break; }
      }
    },
  });
  return { geometry, material: lambert(), puff: 0x9b5528 };
}

// -- pamuk: fluffy cotton candy swirl ------------------------------------------------------------
function skinPamuk() {
  const pink = new THREE.Color(0xff9fd0), lilac = new THREE.Color(0xc7a6ff), mint = new THREE.Color(0x9fe6ff), white = new THREE.Color(0xffffff);
  const lump = (x, y, z) => (fbm3(x * 1.7 + 2, y * 1.7 + 9, z * 1.7 + 4, 2) - 0.5) * 0.36 + (noise3(x * 4.6 + 6, y * 4.6, z * 4.6 + 2) - 0.5) * 0.16;
  const geometry = buildSphere({
    detail: 5,
    perFace: false,
    shape: lump,
    paint: (x, y, z, c) => {
      const ph = Math.atan2(z, x) * 2 + y * 5 + fbm3(x * 2, y * 2, z * 2, 2) * 2.5;
      const t = 0.5 + 0.5 * Math.sin(ph);
      c.copy(pink).lerp(lilac, t);
      if (noise3(x * 2.4 + 5, y * 2.4, z * 2.4 + 8) > 0.68) c.lerp(mint, 0.45);
      c.lerp(white, clamp01(lump(x, y, z) * 2.2 + 0.1) * 0.55); // puffed-out tips are paler
    },
  });
  return { geometry, material: lambert(), puff: 0xffa8d6 };
}

// -- karpuz: wavy dark/light green rind, pale ground spot, stem ----------------------------------
function skinKarpuz() {
  const mid = new THREE.Color(0x3ea54b), dark = new THREE.Color(0x14602a), light = new THREE.Color(0x9fe27e);
  const spot = new THREE.Color(0xdcd98e), stem = new THREE.Color(0x6e4a1e);
  const geometry = buildSphere({
    detail: 6,
    shape: (x, y, z) => (noise3(x * 2.6 + 1, y * 2.6, z * 2.6 + 3) - 0.5) * 0.04,
    paint: (x, y, z, c) => {
      const lon = Math.atan2(z, x);
      const s = Math.sin(lon * 8 + Math.sin(y * 5 + lon * 2) * 0.9);
      if (s > 0.45) c.copy(dark);
      else if (s < -0.72) c.copy(light);
      else c.copy(mid);
      if (y < -0.82) c.copy(spot);
      else if (y > 0.93) c.copy(stem);
    },
  });
  return { geometry, material: lambert(), puff: 0xff566c }; // red juice splash
}

// -- yeni kar topu renkleri / desenleri
function paintSkin(fn, puff) {
  const a = new THREE.Color(), b = new THREE.Color(), c = new THREE.Color();
  const geometry = buildSphere({ detail: 5, shape: () => 0, paint: (x, y, z, col) => fn(x, y, z, col, a, b, c) });
  return { geometry, material: lambert(), puff };
}
function skinMaviKar() {
  return paintSkin((x, y, z, col, a, b) => { a.set(0xbfe2ff); b.set(0x2f7dff); col.copy(Math.sin(y * 9) > 0.2 ? b : a); }, 0x7fb8ff);
}
function skinNane() {
  return paintSkin((x, y, z, col, a, b) => { a.set(0xffffff); b.set(0xff4d6a); col.copy(Math.sin(Math.atan2(z, x) * 4 + y * 5) > 0 ? b : a); }, 0xff8fa3);
}
function skinCilek() {
  return paintSkin((x, y, z, col, a, b, c) => {
    a.set(0xff7aa0); b.set(0xfff2c8);
    const n = noise3(x * 6, y * 6, z * 6);
    col.copy(n > 0.72 ? b : a);
  }, 0xff7aa0);
}
function skinGunBatimi() {
  return paintSkin((x, y, z, col, a, b, c) => {
    a.set(0xffb347); b.set(0x7a2fd0); c.set(0xff5a7a);
    const t = (y + 1) / 2;
    col.copy(t < 0.5 ? a.lerp(c, t * 2) : c.lerp(b, (t - 0.5) * 2));
  }, 0xff9a6a);
}

// -- disko: mirror tiles on a dark core, colour cycling in update() ------------------------------
function skinDisko() {
  const tiles = new THREE.IcosahedronGeometry(1, 3);
  tiles.deleteAttribute('uv');
  const tp = tiles.attributes.position;
  const TILES = tp.count / 3;
  const tcol = new Float32Array(tp.count * 3);
  const phase = new Float32Array(TILES);
  const silver = new Float32Array(TILES);
  const rnd = rng(777);
  for (let t = 0; t < TILES; t++) {
    const i = t * 3;
    const cx = (tp.getX(i) + tp.getX(i + 1) + tp.getX(i + 2)) / 3;
    const cy = (tp.getY(i) + tp.getY(i + 1) + tp.getY(i + 2)) / 3;
    const cz = (tp.getZ(i) + tp.getZ(i + 1) + tp.getZ(i + 2)) / 3;
    for (let k = 0; k < 3; k++) {
      tp.setXYZ(i + k, cx + (tp.getX(i + k) - cx) * 0.88, cy + (tp.getY(i + k) - cy) * 0.88, cz + (tp.getZ(i + k) - cz) * 0.88);
    }
    phase[t] = rnd();
    silver[t] = 0.6 + rnd() * 0.4;
    const k = silver[t];
    for (let j = 0; j < 3; j++) { tcol[(i + j) * 3] = k * 0.9; tcol[(i + j) * 3 + 1] = k * 0.93; tcol[(i + j) * 3 + 2] = k; }
  }
  tiles.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
  const core = tint(new THREE.IcosahedronGeometry(0.92, 1), 0x151a36);
  core.deleteAttribute('uv');
  const geometry = mergeGeos([tiles, core]);
  const colAttr = geometry.attributes.color;
  colAttr.setUsage(THREE.DynamicDrawUsage);
  const arr = colAttr.array;
  const material = phong({ shininess: 120, specular: 0xffffff, emissive: 0x141a30 });

  let clock = 0, acc = 0;
  const update = (dt) => {
    clock += dt;
    acc += dt;
    if (acc < 1 / 30) return; // 30 Hz is plenty for glitter
    acc = 0;
    for (let t = 0; t < TILES; t++) {
      const ph = phase[t];
      const a = clock * 2.1 + ph * TAU;
      const m = 0.32 + 0.3 * Math.sin(clock * 3.3 + ph * 41);
      const r = 0.5 + 0.5 * Math.sin(a), g = 0.5 + 0.5 * Math.sin(a + 2.094), b = 0.5 + 0.5 * Math.sin(a + 4.189);
      const k = silver[t] * (1 - m);
      const o = t * 9;
      const cr = k * 0.9 + r * m, cg = k * 0.93 + g * m, cb = k + b * m;
      arr[o] = arr[o + 3] = arr[o + 6] = cr;
      arr[o + 1] = arr[o + 4] = arr[o + 7] = cg;
      arr[o + 2] = arr[o + 5] = arr[o + 8] = cb;
    }
    colAttr.needsUpdate = true;
  };
  return { geometry, material, puff: 0xe4f2ff, update };
}

// -- altin: faceted gold nugget -------------------------------------------------------------------
function skinAltin() {
  const deep = new THREE.Color(0xd9930d), mid = new THREE.Color(0xffd23a), pale = new THREE.Color(0xfff2ae);
  const geometry = buildSphere({
    detail: 3,
    shape: (x, y, z) => (fbm3(x * 2.4 + 3, y * 2.4 + 1, z * 2.4 + 8, 2) - 0.5) * 0.22,
    paint: (x, y, z, c) => {
      const t = clamp01((0.5 * noise3(x * 4 + 1, y * 4 + 7, z * 4 + 3) + 0.5 * noise3(x * 11 + 2, y * 11, z * 11 + 5) - 0.2) * 1.7);
      if (t < 0.5) c.copy(deep).lerp(mid, t * 2); else c.copy(mid).lerp(pale, (t - 0.5) * 2);
    },
  });
  const material = phong({ shininess: 90, specular: 0xfff1b0, emissive: 0x3d2800 });
  return { geometry, material, puff: 0xffd84a };
}

// -- lav: dark basalt with glowing fissures. vertex colour alpha = glow mask (patched Lambert) ----
function lavaMaterial(glow) {
  const m = lambert();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uGlow;\nvoid main() {')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR_ALPHA\n\ttotalEmissiveRadiance += diffuseColor.rgb * ( vColor.a * uGlow );\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'cig-lava-v1';
  return m;
}

function skinLav() {
  const rock = new THREE.Color(0x3a3341), rockHi = new THREE.Color(0x5a505f), ember = new THREE.Color(0x6a1d10);
  const orange = new THREE.Color(0xff6a10), yellow = new THREE.Color(0xffd25a);
  const crack = (x, y, z) => {
    const f1 = Math.abs(noise3(x * 2.5 + 7, y * 2.5 + 1, z * 2.5 + 4) - 0.5);
    const f2 = Math.abs(noise3(x * 5.2 + 2, y * 5.2 + 9, z * 5.2 + 6) - 0.5);
    const main = 1 - smooth(0.018, 0.058, f1);
    const branch = f1 < 0.15 ? (1 - smooth(0.012, 0.04, f2)) * 0.8 : 0;
    return Math.max(main, branch);
  };
  const geometry = buildSphere({
    detail: 7,
    alpha: true,
    shape: (x, y, z) => (fbm3(x * 2.6 + 5, y * 2.6, z * 2.6 + 2, 2) - 0.5) * 0.14 - crack(x, y, z) * 0.05,
    paint: (x, y, z, c) => {
      const g = crack(x, y, z);
      if (g > 0.8) { c.copy(yellow); return 1; }
      if (g > 0.26) { c.copy(orange); return 0.85; }
      c.copy(rock).lerp(rockHi, clamp01((noise3(x * 4 + 3, y * 4, z * 4 + 1) - 0.4) * 2.5));
      if (g > 0.06) { c.copy(ember); return 0.25; }
      return 0;
    },
  });
  const glow = { value: 1.1 };
  const material = lavaMaterial(glow);
  let clock = 0;
  const update = (dt) => {
    clock += dt;
    glow.value = 1.05 + 0.28 * Math.sin(clock * 2.6) + 0.08 * Math.sin(clock * 7.3);
  };
  return { geometry, material, puff: 0xff7a1a, update };
}

// -- dunya: oceans, continents (3D noise), ice caps. Poles sit near the X axis so rolling spins it like a globe
function skinDunya() {
  const axis = new THREE.Vector3(1, 0.4, 0.15).normalize();
  const SEA = 0.535;
  const height = (x, y, z) => fbm3(x * 1.8 + 3.1, y * 1.8 + 1.7, z * 1.8 + 5.3, 4);
  const lat = (x, y, z) => Math.abs(x * axis.x + y * axis.y + z * axis.z);
  const deep = new THREE.Color(0x1c55c0), shallow = new THREE.Color(0x3a8ee6), beach = new THREE.Color(0xe6d38a);
  const low = new THREE.Color(0x3fae4a), mid = new THREE.Color(0x86b84a), hill = new THREE.Color(0xa9854f), peak = new THREE.Color(0xe9e5dd), ice = new THREE.Color(0xf2f8ff);
  const geometry = buildSphere({
    detail: 7,
    shape: (x, y, z) => Math.max(0, height(x, y, z) - SEA) * 0.3 + smooth(0.9, 0.94, lat(x, y, z)) * 0.015,
    paint: (x, y, z, c) => {
      const h = height(x, y, z);
      const l = lat(x, y, z);
      if (l > 0.925 - noise3(x * 6, y * 6, z * 6) * 0.04) { c.copy(ice); return; }
      if (h < SEA - 0.045) c.copy(deep).lerp(shallow, clamp01((h - 0.3) * 1.2));
      else if (h < SEA) c.copy(shallow);
      else if (h < SEA + 0.018) c.copy(beach);
      else if (h < SEA + 0.07) c.copy(low).lerp(mid, (h - SEA - 0.018) / 0.052);
      else if (h < SEA + 0.12) c.copy(mid).lerp(hill, (h - SEA - 0.07) / 0.05);
      else c.copy(hill).lerp(peak, clamp01((h - SEA - 0.12) / 0.05));
    },
  });
  return { geometry, material: lambert(), puff: 0x4cb050 };
}

// -- yuz: lumpy snowball with coal eyes, carrot nose, coal-dot smile (all merged into one geometry)
function skinYuz() {
  const base = classicGeometry();
  const F = new THREE.Vector3(0, 0.25, 1).normalize();
  const R = new THREE.Vector3(0, 1, 0).cross(F).normalize();
  const U = new THREE.Vector3().crossVectors(F, R);
  const surfR = (d) => 1 + classicN(d.x, d.y, d.z) * 0.045;
  const dirAt = (ax, ay) => new THREE.Vector3().copy(F).addScaledVector(R, ax).addScaledVector(U, ay).normalize();

  const parts = [base];
  const coalA = new THREE.Color(0x16161d), coalB = new THREE.Color(0x30303c);
  const coal = (x, y, z, c) => c.copy(coalA).lerp(coalB, clamp01(y * 0.5 + 0.5) * 0.5);
  const addBall = (d, radius, detail, color) => {
    const centre = d.clone().multiplyScalar(surfR(d) + radius * 0.2);
    const g = new THREE.IcosahedronGeometry(radius, detail);
    g.deleteAttribute('uv');
    g.translate(centre.x, centre.y, centre.z);
    parts.push(tint(g, color));
  };
  addBall(dirAt(-0.3, 0.27), 0.11, 1, coal);
  addBall(dirAt(0.3, 0.27), 0.11, 1, coal);
  for (let i = -3; i <= 3; i++) {
    const t = i / 3;
    addBall(dirAt(t * 0.46, -0.22 + 0.17 * t * t), 0.055, 0, coal);
  }
  // carrot: cone base buried in the snow, tip pointing along the face direction
  const nd = dirAt(0, -0.03);
  const cone = new THREE.ConeGeometry(0.12, 0.42, 9, 1);
  cone.deleteAttribute('uv');
  cone.translate(0, 0.21, 0);
  cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nd));
  cone.translate(nd.x * 0.96, nd.y * 0.96, nd.z * 0.96);
  const carrotA = new THREE.Color(0xff9a3a), carrotB = new THREE.Color(0xe55a0c);
  const carrot = tint(cone, (x, y, z, c) => {
    const t = clamp01((x * nd.x + y * nd.y + z * nd.z - 0.96) / 0.42);
    c.copy(carrotA).lerp(carrotB, t);
  });
  parts.push(carrot);
  return { geometry: mergeGeos(parts), material: lambert(), puff: 0xffffff };
}

// -- nazar: Turkish evil-eye bead, concentric rings on the +Z / up-front side ----------------------
function skinNazar() {
  const F = new THREE.Vector3(0, 0.3, 1).normalize();
  const pupil = new THREE.Color(0x0a0a16), light = new THREE.Color(0x3fc1ff), white = new THREE.Color(0xffffff);
  const blue = new THREE.Color(0x12389e), blue2 = new THREE.Color(0x1d4fc8);
  const geometry = buildSphere({
    detail: 8,
    shape: (x, y, z) => (noise3(x * 3, y * 3 + 2, z * 3) - 0.5) * 0.03,
    paint: (x, y, z, c) => {
      const th = Math.acos(Math.max(-1, Math.min(1, x * F.x + y * F.y + z * F.z)));
      if (th < 0.26) c.copy(pupil);
      else if (th < 0.52) c.copy(light);
      else if (th < 0.84) c.copy(white);
      else c.copy(blue).lerp(blue2, clamp01((noise3(x * 3 + 4, y * 3, z * 3 + 9) - 0.35) * 1.5) * 0.7);
    },
  });
  const material = phong({ shininess: 100, specular: 0x9fbfff });
  return { geometry, material, puff: 0x3fa2ff };
}

// ===================================================================================== wave 2 skins

// -- karasivi: glossy black living goo with wobbling tendrils (original design, no face) ----------------
function skinKarasivi() {
  const rnd = rng(6661);
  const deep = new THREE.Color(0x06070d), blue = new THREE.Color(0x111b44);
  const core = buildSphere({
    detail: 4,
    perFace: false,
    shape: (x, y, z) => -0.2 + (fbm3(x * 1.7 + 2, y * 1.7 + 5, z * 1.7 + 9, 2) - 0.5) * 0.1,
    paint: (x, y, z, c) => c.copy(deep).lerp(blue, clamp01((noise3(x * 2.4 + 1, y * 2.4 + 6, z * 2.4 + 3) - 0.45) * 2.2)),
  });
  const wob = makeWobble(core.attributes.position.array, core.attributes.position.count);
  const dirs = fibDirs(15, rnd, 0.35);
  const limbs = new Limbs({
    dirs,
    len: dirs.map(() => 0.4 + rnd() * 0.22),
    thick: dirs.map(() => 0.1 + rnd() * 0.02),
    prof: [[0, 1.7], [0.1, 1.35], [0.22, 0.98], [0.38, 0.74], [0.55, 0.62], [0.72, 0.6], [0.86, 0.7], [0.95, 0.82]],
    seg: 6, rootR: 0.72, apex: 0.12, rnd,
  });
  const baked = limbs.bake((j, i, k, s, c) => c.copy(deep).lerp(blue, s * s * 0.9));
  const { geometry, offset } = joinGeo(core, baked.pos, baked.col);
  const posAttr = geometry.attributes.position;
  const ph = limbs.ph;
  const bend = (j, t, o, kap, s) => {
    const p = ph[j];
    o.psi += 0.9 * Math.sin(t * 0.8 + p);
    o.len = 0.86 + 0.14 * Math.sin(t * 1.7 + p * 2);
    const a = 5 + 1.8 * Math.sin(t * 1.1 + p * 3);
    for (let i = 1; i < kap.length; i++) kap[i] = a * Math.sin(t * 2.1 + p + s[i] * 3.4) * (0.35 + s[i]);
  };
  let clock = 0, acc = 0;
  const update = (dt) => {
    clock += dt; acc += dt;
    if (acc < STEP) return;
    acc = 0;
    wob.apply(posAttr.array, clock, 0.028, 2.2);
    limbs.animate(posAttr.array, offset, clock, bend);
    posAttr.needsUpdate = true;
  };
  update(STEP);
  const material = phong({ shininess: 170, specular: 0x7f90ff, emissive: 0x03040c });
  return { geometry, material, puff: 0x1a2250, update };
}

// -- kizilkaos: crimson chaos goo, black streaks, wilder tendrils, emissive pulse (original design, no face) ----
function skinKizilKaos() {
  const rnd = rng(9137);
  const red = new THREE.Color(0xe01428), dark = new THREE.Color(0x9a0a1c), black = new THREE.Color(0x070103), hot = new THREE.Color(0xff4a3a);
  const core = buildSphere({
    detail: 4,
    perFace: false,
    shape: (x, y, z) => -0.2 + (fbm3(x * 2 + 8, y * 2 + 1, z * 2 + 3, 2) - 0.5) * 0.14,
    paint: (x, y, z, c) => {
      const n = noise3(x * 2.2 + 4, y * 2.2, z * 2.2 + 9);
      c.copy(red).lerp(dark, clamp01((n - 0.45) * 2.2));
      const s = Math.sin(x * 5.5 + y * 3.2 + n * 6.5) + 0.5 * Math.sin(z * 9 + y * 4 + n * 3);
      c.lerp(black, smooth(0.4, 0.65, s));
      c.lerp(hot, clamp01((noise3(x * 5 + 9, y * 5, z * 5 + 2) - 0.72) * 3) * 0.6);
    },
  });
  const wob = makeWobble(core.attributes.position.array, core.attributes.position.count);
  const dirs = fibDirs(22, rnd, 0.5);
  const limbs = new Limbs({
    dirs,
    len: dirs.map(() => 0.44 + rnd() * 0.24),
    thick: dirs.map(() => 0.105 + rnd() * 0.03),
    prof: [[0, 1.7], [0.1, 1.4], [0.24, 1.05], [0.4, 0.8], [0.58, 0.68], [0.76, 0.7], [0.9, 0.78]],
    seg: 5, rootR: 0.72, apex: 0.14, rnd,
  });
  const baked = limbs.bake((j, i, k, s, c) => {
    if (j % 3 === 0) c.copy(black).lerp(red, s * s);
    else c.copy(red).lerp(dark, s * 0.4).lerp(black, smooth(0.55, 1, s) * (j % 2 ? 0.85 : 0.35));
  });
  const { geometry, offset } = joinGeo(core, baked.pos, baked.col);
  const posAttr = geometry.attributes.position;
  const ph = limbs.ph;
  const bend = (j, t, o, kap, s) => {
    const p = ph[j];
    o.psi += 1.4 * Math.sin(t * 1.9 + p) + t * 0.45 * (j % 2 ? 1 : -1);
    o.len = 0.78 + 0.22 * Math.sin(t * 3.4 + p * 2) + 0.06 * Math.sin(t * 7.3 + p);
    const a = 7 + 2.5 * Math.sin(t * 2.3 + p * 3);
    for (let i = 1; i < kap.length; i++) kap[i] = a * Math.sin(t * 4.2 + p + s[i] * 4.6) * (0.3 + s[i]);
  };
  const material = phong({ shininess: 120, specular: 0xff9a8a, emissive: 0x30040a });
  let clock = 0, acc = 0;
  const update = (dt) => {
    clock += dt; acc += dt;
    material.emissiveIntensity = 0.7 + 0.6 * Math.sin(clock * 3.1) + 0.25 * Math.sin(clock * 8.7);
    if (acc < STEP) return;
    acc = 0;
    wob.apply(posAttr.array, clock, 0.05, 3.3);
    limbs.animate(posAttr.array, offset, clock, bend);
    posAttr.needsUpdate = true;
  };
  update(STEP);
  return { geometry, material, puff: 0xc4101e, update };
}

// -- zehir: toxic neon goo with bubbles that grow and pop ------------------------------------------------
function skinZehir() {
  const g1 = new THREE.Color(0x2fe82b), g2 = new THREE.Color(0x0e9a24), g3 = new THREE.Color(0xa8ff3c);
  const core = buildSphere({
    detail: 5,
    perFace: false,
    shape: (x, y, z) => -0.1 + (fbm3(x * 2 + 3, y * 2 + 7, z * 2 + 1, 2) - 0.5) * 0.12,
    paint: (x, y, z, c) => {
      const n = noise3(x * 2.6 + 5, y * 2.6, z * 2.6 + 2);
      c.copy(g1).lerp(g2, clamp01((n - 0.4) * 2.2));
      c.lerp(g3, clamp01((noise3(x * 4.5 + 1, y * 4.5 + 6, z * 4.5) - 0.62) * 3.2) * 0.8);
    },
  });
  const wob = makeWobble(core.attributes.position.array, core.attributes.position.count);
  const NB = 11, rnd = rng(3141);
  const tpl = new THREE.IcosahedronGeometry(1, 1);
  const tp = tpl.attributes.position.array, TV = tp.length / 3;
  const size = new Float32Array(NB), rate = new Float32Array(NB), off0 = new Float32Array(NB), lastCyc = new Float32Array(NB).fill(-1);
  const bd = new Float32Array(NB * 3);
  for (let b = 0; b < NB; b++) { size[b] = 0.14 + rnd() * 0.12; rate[b] = 0.28 + rnd() * 0.4; off0[b] = rnd() * 4; }
  const bpos = new Float32Array(NB * TV * 3), bcol = new Float32Array(NB * TV * 3);
  const lo = new THREE.Color(0x6dff3a), hi = new THREE.Color(0xe6ffb4);
  for (let b = 0; b < NB; b++) {
    for (let v = 0; v < TV; v++) {
      lo.clone().lerp(hi, clamp01(tp[v * 3 + 1] * 0.5 + 0.5)).toArray(bcol, (b * TV + v) * 3);
    }
  }
  const { geometry, offset } = joinGeo(core, bpos, bcol);
  const posAttr = geometry.attributes.position;
  const fillBubbles = (t) => {
    const arr = posAttr.array;
    for (let b = 0; b < NB; b++) {
      const u = t * rate[b] + off0[b], cyc = Math.floor(u), ph = u - cyc;
      if (cyc !== lastCyc[b]) {
        lastCyc[b] = cyc;
        const z = hash3(cyc, b, 7) * 2 - 1, a = hash3(cyc, b, 13) * TAU, r = Math.sqrt(1 - z * z);
        bd[b * 3] = r * Math.cos(a); bd[b * 3 + 1] = z; bd[b * 3 + 2] = r * Math.sin(a);
      }
      let sc;
      if (ph < 0.8) sc = size[b] * smooth(0, 0.8, ph);
      else if (ph < 0.97) sc = size[b] * (1 + 0.45 * ((ph - 0.8) / 0.17));
      else sc = 0;
      const cx = bd[b * 3] * 0.9, cy = bd[b * 3 + 1] * 0.9, cz = bd[b * 3 + 2] * 0.9;
      let o = offset + b * TV * 3;
      for (let v = 0; v < TV; v++) {
        arr[o++] = cx + tp[v * 3] * sc; arr[o++] = cy + tp[v * 3 + 1] * sc; arr[o++] = cz + tp[v * 3 + 2] * sc;
      }
    }
  };
  let clock = 0, acc = 0;
  const update = (dt) => {
    clock += dt; acc += dt;
    if (acc < STEP) return;
    acc = 0;
    wob.apply(posAttr.array, clock, 0.03, 2.6);
    fillBubbles(clock);
    posAttr.needsUpdate = true;
  };
  update(STEP);
  tpl.dispose();
  const material = phong({ shininess: 90, specular: 0xeaffc0, emissive: 0x0a4410 });
  return { geometry, material, puff: 0x7dff3a, update };
}

// -- plazma: violet glass ball with electric arcs that jump around ----------------------------------------
function skinPlazma() {
  const rnd = rng(2718);
  const deep = new THREE.Color(0x0c0430), mid = new THREE.Color(0x5a2ad2), glow = new THREE.Color(0xb078ff), pink = new THREE.Color(0xff6ad8);
  const geometry = buildSphere({
    detail: 9,
    paint: (x, y, z, c) => {
      const n = fbm3(x * 2.2 + 3, y * 2.2 + 1, z * 2.2 + 6, 3);
      c.copy(deep).lerp(mid, clamp01((n - 0.35) * 2.4));
      const vein = 1 - Math.abs(2 * noise3(x * 3.4 + 8, y * 3.4, z * 3.4 + 4) - 1); // ridged noise = glowing filaments
      c.lerp(glow, Math.pow(vein, 7) * 0.9);
      c.lerp(pink, Math.pow(1 - Math.abs(2 * noise3(x * 2.4 + 2, y * 2.4 + 7, z * 2.4 + 1) - 1), 9) * 0.7);
    },
  });
  const arr = geometry.attributes.color.array;
  const NF = arr.length / 9;
  const base = arr.slice();
  const fc = faceCentroids(geometry);
  // arc paths: geodesic random walks, stored as (face, weight) lists
  const SLOTS = 7, VARS = 5, W = 0.085, COSW = Math.cos(W);
  const G = 10, gk = (x) => Math.min(G - 1, Math.max(0, Math.floor((x * 0.5 + 0.5) * G))); // face lookup grid (cells are wider than W)
  const grid = Array.from({ length: G * G * G }, () => []);
  for (let f = 0; f < NF; f++) grid[(gk(fc[f * 3]) * G + gk(fc[f * 3 + 1])) * G + gk(fc[f * 3 + 2])].push(f);
  const arcs = [];
  const tmpW = new Float32Array(NF);
  for (let s = 0; s < SLOTS; s++) {
    arcs.push([]);
    for (let v = 0; v < VARS; v++) {
      tmpW.fill(0);
      let d = randDir(rnd), tg = norm3(cross3(d, randDir(rnd)));
      const steps = 8 + ((rnd() * 4) | 0);
      for (let k = 0; k < steps; k++) {
        const dl = (rnd() - 0.5) * 1.8, cd = Math.cos(dl), sd = Math.sin(dl);
        const nrm = cross3(d, tg);
        tg = [tg[0] * cd + nrm[0] * sd, tg[1] * cd + nrm[1] * sd, tg[2] * cd + nrm[2] * sd];
        for (let sub = 0; sub < 3; sub++) {
          const st = 0.065;
          const nd = norm3([d[0] + tg[0] * st, d[1] + tg[1] * st, d[2] + tg[2] * st]);
          const nt = cross3(cross3(nd, tg), nd);
          d = nd; tg = norm3(nt);
          const gx = gk(d[0]), gy = gk(d[1]), gz = gk(d[2]);
          for (let ix = Math.max(0, gx - 1); ix <= Math.min(G - 1, gx + 1); ix++) {
            for (let iy = Math.max(0, gy - 1); iy <= Math.min(G - 1, gy + 1); iy++) {
              for (let iz = Math.max(0, gz - 1); iz <= Math.min(G - 1, gz + 1); iz++) {
                const cell = grid[(ix * G + iy) * G + iz];
                for (let q = 0; q < cell.length; q++) {
                  const f = cell[q];
                  const dd = fc[f * 3] * d[0] + fc[f * 3 + 1] * d[1] + fc[f * 3 + 2] * d[2];
                  if (dd > COSW) { const w = (dd - COSW) / (1 - COSW); if (w > tmpW[f]) tmpW[f] = w; }
                }
              }
            }
          }
        }
      }
      let cnt = 0;
      for (let f = 0; f < NF; f++) if (tmpW[f] > 0) cnt++;
      const fl = new Uint16Array(cnt), wl = new Float32Array(cnt);
      let i = 0;
      for (let f = 0; f < NF; f++) if (tmpW[f] > 0) { fl[i] = f; wl[i] = tmpW[f]; i++; }
      arcs[s].push({ fl, wl });
    }
  }
  const variant = new Uint8Array(SLOTS), power = new Float32Array(SLOTS);
  const coreC = new THREE.Color(0xdfeaff), haloC = new THREE.Color(0x7a5cff), edgeC = new THREE.Color(0xff5cf0);
  const reroll = () => {
    for (let s = 0; s < SLOTS; s++) {
      if (rnd() < 0.55) variant[s] = (rnd() * VARS) | 0;
      power[s] = rnd() < 0.18 ? 0 : 0.7 + rnd() * 0.5;
    }
  };
  reroll();
  const paint = () => {
    arr.set(base);
    for (let s = 0; s < SLOTS; s++) {
      const p = power[s];
      if (p <= 0) continue;
      const { fl, wl } = arcs[s][variant[s]];
      for (let i = 0; i < fl.length; i++) {
        const w = wl[i];
        let r, g, b;
        if (w > 0.62) { const k = 3 * p; r = coreC.r * k; g = coreC.g * k; b = coreC.b * k; }
        else if (w > 0.25) { const k = 2.4 * p; r = haloC.r * k; g = haloC.g * k; b = haloC.b * k; }
        else { const k = 1.5 * p; r = edgeC.r * k; g = edgeC.g * k; b = edgeC.b * k; }
        setFace(arr, fl[i], r, g, b);
      }
    }
    geometry.attributes.color.needsUpdate = true;
  };
  paint();
  let acc = 0;
  const update = (dt) => {
    acc += dt;
    if (acc < 0.055) return;
    acc = 0;
    reroll();
    paint();
  };
  const material = phong({ shininess: 140, specular: 0xbfd0ff, emissive: 0x1a0c4a });
  geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
  return { geometry, material, puff: 0x9a8cff, update };
}

// -- galaksi: deep space with nebula clouds, a milky band and twinkling stars -----------------------------
function skinGalaksi() {
  const rnd = rng(8080);
  const navy = new THREE.Color(0x0a0c34), purple = new THREE.Color(0x4a1c92), magenta = new THREE.Color(0xc03aa8), teal = new THREE.Color(0x1f86d0), milk = new THREE.Color(0xd6ccff);
  const band = norm3([0.35, 0.8, 0.45]);
  const geometry = buildSphere({
    detail: 8,
    paint: (x, y, z, c) => {
      const n = fbm3(x * 2 + 1, y * 2 + 5, z * 2 + 9, 3);
      c.copy(navy).lerp(purple, clamp01((n - 0.3) * 2.2));
      c.lerp(magenta, clamp01((noise3(x * 2.8 + 4, y * 2.8, z * 2.8 + 7) - 0.5) * 2.6) * 0.85);
      c.lerp(teal, clamp01((noise3(x * 2.5 + 9, y * 2.5 + 3, z * 2.5) - 0.52) * 2.6) * 0.8);
      const b = Math.abs(x * band[0] + y * band[1] + z * band[2]);
      c.lerp(milk, smooth(0.3, 0.0, b) * (0.35 + 0.65 * noise3(x * 6 + 2, y * 6, z * 6 + 5)) * 0.8);
    },
  });
  const arr = geometry.attributes.color.array;
  const NF = arr.length / 9;
  const fc = faceCentroids(geometry);
  const stars = []; // face, r, g, b, speed, phase, gain
  const used = new Uint8Array(NF);
  const tints = [[1, 1, 1], [0.7, 0.85, 1], [1, 0.9, 0.6], [1, 0.65, 0.92]];
  const addStar = (f, big) => {
    if (used[f]) return;
    used[f] = 1;
    const tcol = tints[(rnd() * tints.length) | 0];
    stars.push({ f, r: tcol[0], g: tcol[1], b: tcol[2], sp: 1.5 + rnd() * 4, ph: rnd() * TAU, gain: big ? 3.4 : 2.2 });
  };
  for (let i = 0; i < 70; i++) addStar((rnd() * NF) | 0, false);
  for (let i = 0; i < 12; i++) {
    const d = randDir(rnd);
    const cosR = Math.cos(0.13);
    for (let f = 0; f < NF; f++) if (fc[f * 3] * d[0] + fc[f * 3 + 1] * d[1] + fc[f * 3 + 2] * d[2] > cosR) addStar(f, true);
  }
  const NS = stars.length;
  const sf = new Uint16Array(NS), sr = new Float32Array(NS), sg = new Float32Array(NS), sb = new Float32Array(NS), ssp = new Float32Array(NS), sph = new Float32Array(NS), sgn = new Float32Array(NS);
  stars.forEach((s, i) => { sf[i] = s.f; sr[i] = s.r; sg[i] = s.g; sb[i] = s.b; ssp[i] = s.sp; sph[i] = s.ph; sgn[i] = s.gain; });
  let clock = 0, acc = 0;
  const paint = () => {
    for (let i = 0; i < NS; i++) {
      const k = sgn[i] * (0.18 + 0.82 * (0.5 + 0.5 * Math.sin(clock * ssp[i] + sph[i])));
      setFace(arr, sf[i], sr[i] * k, sg[i] * k, sb[i] * k);
    }
    geometry.attributes.color.needsUpdate = true;
  };
  paint();
  geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
  const update = (dt) => {
    clock += dt; acc += dt;
    if (acc < 0.045) return;
    acc = 0;
    paint();
  };
  const material = lambert({ emissive: 0x151a58 });
  return { geometry, material, puff: 0x7a5aff, update };
}

// -- ates: fireball whose flame tongues flicker and always lick upwards ----------------------------------------
function skinAtes() {
  const rnd = rng(1881);
  const core = buildSphere({
    detail: 4,
    perFace: false,
    shape: (x, y, z) => -0.3 + (fbm3(x * 2 + 2, y * 2 + 5, z * 2 + 1, 2) - 0.5) * 0.1,
    paint: (x, y, z, c) => {
      const n = noise3(x * 3 + 1, y * 3 + 2, z * 3 + 5);
      c.setRGB(2.0, 0.5 + n * 0.45, 0.05 + n * 0.08);
    },
  });
  const dirs = fibDirs(26, rnd, 0.5);
  const limbs = new Limbs({
    dirs,
    len: dirs.map(() => 0.46 + rnd() * 0.16),
    thick: dirs.map(() => 0.16 + rnd() * 0.04),
    prof: [[0, 1.8], [0.2, 1.55], [0.42, 1.2], [0.66, 0.8], [0.86, 0.4]],
    seg: 5, rootR: 0.5, apex: 0.32, rnd,
  });
  const baked = limbs.bake((j, i, k, s, c, apex) => {
    if (apex) c.setRGB(1.1, 0.06, 0.02);
    else if (s < 0.25) c.setRGB(2.3, 1.45, 0.2);
    else if (s < 0.6) c.setRGB(2.1, 0.75 - (s - 0.25) * 1.2, 0.06);
    else c.setRGB(1.7, 0.2, 0.03);
  });
  const { geometry, offset } = joinGeo(core, baked.pos, baked.col);
  const posAttr = geometry.attributes.position;
  const ph = limbs.ph, P = limbs.P, Q = limbs.Q, T0 = limbs.T0;
  const up = [0, 1, 0];
  const bend = (j, t, o, kap, s) => {
    const p = ph[j], j3 = j * 3;
    const up_p = up[0] * P[j3] + up[1] * P[j3 + 1] + up[2] * P[j3 + 2];
    const up_q = up[0] * Q[j3] + up[1] * Q[j3 + 1] + up[2] * Q[j3 + 2];
    o.psi = Math.atan2(up_q, up_p); // bend towards world up
    const upness = Math.max(0, up[0] * T0[j3] + up[1] * T0[j3 + 1] + up[2] * T0[j3 + 2]);
    o.len = (0.66 + 0.5 * upness) * (0.84 + 0.16 * Math.sin(t * 12 + p * 5)) + 0.05 * Math.sin(t * 20.5 + p * 2);
    const ku = 2.4 * Math.sqrt(up_p * up_p + up_q * up_q);
    for (let i = 1; i < kap.length; i++) kap[i] = ku * (0.5 + s[i]) + 3.2 * Math.sin(t * 8.5 + p + s[i] * 5.5) * s[i];
  };
  let clock = 0, acc = 0;
  const update = (dt, time, mesh) => {
    clock += dt; acc += dt;
    if (acc < STEP) return;
    acc = 0;
    localUp(mesh, up);
    limbs.animate(posAttr.array, offset, clock, bend);
    posAttr.needsUpdate = true;
  };
  update(STEP, 0, null);
  const material = lambert({ emissive: 0x4a1400 });
  return { geometry, material, puff: 0xff7a1a, update };
}

// -- buzejder: crystal dragon -- domed ice scales, dorsal crystal spikes, a slit-pupil eye, travelling glint --
function skinBuzEjder() {
  const rnd = rng(7007);
  const seeds = fibDirs(62, rnd, 0.55);
  const pal = [0x1b8fd6, 0x39b8ee, 0x6fd0ff, 0x2a6fd0, 0x93ecff].map((h) => new THREE.Color(h));
  const edgeC = new THREE.Color(0x0a3f80), peakC = new THREE.Color(0xe4fbff);
  let b1 = 0, b2 = 0, i1 = 0;
  const nearTwo = (x, y, z) => {
    b1 = -2; b2 = -2; i1 = 0;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i], d = x * s[0] + y * s[1] + z * s[2];
      if (d > b1) { b2 = b1; b1 = d; i1 = i; } else if (d > b2) b2 = d;
    }
  };
  const shapeFn = (x, y, z) => {
    nearTwo(x, y, z);
    const h = clamp01((b1 - 0.93) / 0.07), edge = 1 - smooth(0, 0.03, b1 - b2);
    return -0.07 + 0.1 * h - 0.045 * edge;
  };
  const core = buildSphere({
    detail: 8,
    shape: shapeFn,
    paint: (x, y, z, c) => {
      nearTwo(x, y, z);
      const h = clamp01((b1 - 0.93) / 0.07), edge = 1 - smooth(0, 0.028, b1 - b2);
      c.copy(pal[i1 % pal.length]).lerp(peakC, h * h * 0.5);
      c.lerp(edgeC, edge * 0.85);
    },
  });
  const NF = core.attributes.position.count / 3;
  const fc = faceCentroids(core);
  const mb = new MB();
  mb.geo(core);
  const surf = (x, y, z) => 1 + shapeFn(x, y, z);
  // dorsal crystal spikes along a ridge
  const ridgeN = norm3([0.9, 0.2, -0.35]);
  const rp = circlePts(ridgeN, 72);
  const spikeC = new THREE.Color(0x7fdcff), spikeT = new THREE.Color(0xffffff);
  for (let k = -5; k <= 5; k++) {
    const d = rp[(36 + k * 4 + 72) % 72];
    const h = 0.22 + 0.2 * Math.cos((k / 5) * 1.2);
    const g = aim(cone(0.11, h, 5, true), d, [d[0] * 0.93, d[1] * 0.93, d[2] * 0.93]);
    mb.geo(g, (x, y, z, c) => { const t = clamp01((x * d[0] + y * d[1] + z * d[2] - 0.93) / h); c.copy(spikeC).lerp(spikeT, t); });
  }
  // the eye
  const E = frameOf([0.45, 0.28, 0.85]);
  const eyeR = (x, y, z) => surf(x, y, z) + 0.02;
  const almond = [[-0.19, 0], [-0.1, 0.085], [0.02, 0.105], [0.13, 0.075], [0.2, 0.0], [0.13, -0.065], [0.0, -0.085], [-0.1, -0.065]].map((p) => [p[0] * 1.35, p[1] * 1.35]);
  decalPoly(mb, E, almond.map((p) => [p[0] * 1.25, p[1] * 1.4]), eyeR, new THREE.Color(0x061a3a), 0);
  decalPoly(mb, E, almond, (x, y, z) => eyeR(x, y, z) + 0.006, new THREE.Color(1.2, 2.3, 2.7), 0);
  decalPoly(mb, E, [[0, 0.115], [0.032, 0], [0, -0.108], [-0.032, 0]], (x, y, z) => eyeR(x, y, z) + 0.012, new THREE.Color(0x04101c), 0);
  const geometry = mb.build();
  const col = geometry.attributes.color;
  col.setUsage(THREE.DynamicDrawUsage);
  const arr = col.array;
  const base = arr.slice(0, NF * 9);
  let clock = 0, acc = 0;
  const update = (dt) => {
    clock += dt; acc += dt;
    if (acc < 0.05) return;
    acc = 0;
    const a = clock * 0.9, nx = Math.cos(a) * 0.936, ny = 0.35, nz = Math.sin(a) * 0.936;
    for (let f = 0; f < NF; f++) {
      const d = Math.abs(fc[f * 3] * nx + fc[f * 3 + 1] * ny + fc[f * 3 + 2] * nz);
      const w = 1 - d / 0.15, o = f * 9;
      if (w > 0) {
        const k = 1 + 1.7 * w * w, tk = 0.3 * w * w;
        for (let v = 0; v < 3; v++) {
          arr[o + v * 3] = base[o + v * 3] * k + tk;
          arr[o + v * 3 + 1] = base[o + v * 3 + 1] * k + tk;
          arr[o + v * 3 + 2] = base[o + v * 3 + 2] * k + tk;
        }
      } else for (let q = 0; q < 9; q++) arr[o + q] = base[o + q];
    }
    col.needsUpdate = true;
  };
  const material = phong({ shininess: 130, specular: 0xffffff, emissive: 0x0b2c4a });
  return { geometry, material, puff: 0x9fe8ff, update };
}

// -- robot: steel panels, rivets, antenna and a glowing scanner visor ------------------------------------------
function skinRobot() {
  const steel = [0x9aa7b8, 0xc4cedc, 0x7886a0, 0xaebad0].map((h) => new THREE.Color(h));
  const core = buildSphere({
    detail: 6,
    paint: (x, y, z, c) => {
      const pi = (Math.floor((Math.atan2(z, x) / TAU + 1) * 8) % 8 + 8) % 8;
      const bi = y < -0.8 ? 0 : y < -0.35 ? 1 : y < 0.35 ? 2 : y < 0.8 ? 3 : 4;
      c.copy(steel[(hash3(pi, bi, 5) * 4) | 0]).multiplyScalar(0.9 + 0.2 * noise3(x * 9, y * 9, z * 9));
    },
  });
  const mb = new MB();
  mb.geo(core);
  const seam = new THREE.Color(0x232834), rivet = new THREE.Color(0xe6edf7);
  const dirLL = (lon, lat) => [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
  const RS = 1.012;
  for (let k = 0; k < 8; k++) { // meridian seams
    const lon = (k / 8) * TAU;
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push(dirLL(lon, -0.93 + (i / 12) * 1.86));
    decalStrip(mb, pts, 0.045, RS, seam);
  }
  for (const y of [-0.8, -0.35, 0.35, 0.8]) { // latitude seams
    const lat = Math.asin(y), pts = [];
    for (let i = 0; i < 40; i++) pts.push(dirLL((i / 40) * TAU, lat));
    decalStrip(mb, pts, 0.045, RS, seam, true);
  }
  for (let k = 0; k < 8; k++) {
    for (const y of [-0.8, -0.35, 0.35, 0.8]) {
      const d = dirLL((k / 8) * TAU, Math.asin(y));
      decalEllipse(mb, frameOf(d), 0, 0, 0.05, 0.05, 6, 1.024, rivet);
    }
  }
  // visor: dark frame, glass, scanning light
  const strip = (lonA, latA, latB, r, colFn) => {
    const N = 16;
    for (let i = 0; i < N; i++) {
      const l0 = -lonA + (i / N) * 2 * lonA, l1 = -lonA + ((i + 1) / N) * 2 * lonA;
      const a = dirLL(l0, latA), b = dirLL(l1, latA), c = dirLL(l1, latB), d = dirLL(l0, latB);
      const sc = (p) => [p[0] * r, p[1] * r, p[2] * r];
      const c0 = colFn(l0), c1 = colFn(l1);
      mb.tri3(sc(a), sc(d), sc(c), c0, c0, c1, true);
      mb.tri3(sc(a), sc(c), sc(b), c0, c1, c1, true);
    }
  };
  strip(1.08, 0.38, -0.1, 1.014, () => new THREE.Color(0x0a1018));
  strip(1.02, 0.33, -0.05, 1.02, () => new THREE.Color(0x061d28));
  const scanStart = mb.count;
  const scanBase = new THREE.Color(0.12, 1.0, 1.3);
  strip(0.95, 0.2, 0.07, 1.026, () => scanBase.clone());
  const scanEnd = mb.count;
  // antenna
  const A = norm3([0.22, 1, 0.1]);
  mb.geo(aim(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 5, 1, true).translate(0, 0.15, 0), A, [A[0] * 0.93, A[1] * 0.93, A[2] * 0.93]), 0x6a7384);
  const tipC = [A[0] * 1.26, A[1] * 1.26, A[2] * 1.26];
  const tipStart = mb.count;
  mb.geo(ball(0.075, 1).translate(tipC[0], tipC[1], tipC[2]), new THREE.Color(0xff3020));
  const tipEnd = mb.count;
  const geometry = mb.build();
  const col = geometry.attributes.color, arr = col.array, pos = geometry.attributes.position.array;
  col.setUsage(THREE.DynamicDrawUsage);
  const scanLon = new Float32Array(scanEnd - scanStart);
  for (let v = scanStart; v < scanEnd; v++) scanLon[v - scanStart] = Math.atan2(pos[v * 3], pos[v * 3 + 2]);
  let clock = 0, acc = 0;
  const update = (dt) => {
    clock += dt; acc += dt;
    if (acc < 0.045) return;
    acc = 0;
    const p = Math.sin(clock * 1.7) * 0.85;
    for (let v = scanStart; v < scanEnd; v++) {
      const d = (scanLon[v - scanStart] - p) / 0.3;
      const k = 0.3 + 1.5 * Math.exp(-d * d);
      const o = v * 3;
      arr[o] = scanBase.r * k; arr[o + 1] = scanBase.g * k; arr[o + 2] = scanBase.b * k;
    }
    const blink = 0.25 + 1.6 * Math.max(0, Math.sin(clock * 4.2));
    for (let v = tipStart; v < tipEnd; v++) { const o = v * 3; arr[o] = 1.6 * blink; arr[o + 1] = 0.12 * blink; arr[o + 2] = 0.08 * blink; }
    col.needsUpdate = true;
  };
  update(0.1);
  const material = phong({ shininess: 90, specular: 0xdfe8ff, emissive: 0x05070c });
  return { geometry, material, puff: 0xb5c2d6, update };
}

// -- kirpi: hedgehog ball: banded quills, cream snout, little ears ----------------------------------------------
function skinKirpi() {
  const rnd = rng(1359);
  const F = frameOf([0, 0.1, 1]);
  const fur = [new THREE.Color(0x6b4a2e), new THREE.Color(0x4a3320), new THREE.Color(0x8a6240)], cream = new THREE.Color(0xefd0a4);
  const core = buildSphere({
    detail: 5,
    shape: (x, y, z) => -0.14 + (noise3(x * 3, y * 3, z * 3) - 0.5) * 0.04,
    paint: (x, y, z, c) => {
      const n = noise3(x * 4 + 1, y * 4, z * 4 + 6);
      c.copy(fur[0]).lerp(n > 0.5 ? fur[2] : fur[1], Math.abs(n - 0.5) * 2);
      const ang = Math.acos(clamp01(x * F.F[0] + y * F.F[1] + z * F.F[2]));
      c.lerp(cream, smooth(0.78, 0.6, ang));
    },
  });
  const all = fibDirs(100, rnd, 0.3);
  const dirs = [];
  for (const d of all) if (dot3(d, F.F) < Math.cos(0.8)) dirs.push(norm3([d[0] + (rnd() - 0.5) * 0.25, d[1] + (rnd() - 0.5) * 0.25, d[2] + (rnd() - 0.5) * 0.25]));
  const limbs = new Limbs({
    dirs, len: dirs.map(() => 0.24 + rnd() * 0.1), thick: dirs.map(() => 0.075 + rnd() * 0.015),
    prof: [[0, 1.25], [0.55, 0.78]], seg: 4, rootR: 0.78, apex: 0.5, rnd,
  });
  const tan = new THREE.Color(0xd2a46c), dk = new THREE.Color(0x2c1d12), mid = new THREE.Color(0x5a3a22);
  const flip = dirs.map(() => rnd() < 0.55);
  const baked = limbs.bake((j, i, k, s, c, apex) => {
    if (apex) c.copy(dk);
    else if (i === 0) c.copy(dk).lerp(mid, 0.4);
    else c.copy(flip[j] ? tan : mid);
  });
  const mb = new MB();
  mb.geo(core);
  for (let i = 0; i < baked.pos.length; i++) { mb.p.push(baked.pos[i]); mb.c.push(baked.col[i]); }
  const P = (u, v, r) => at(F, u, v, r);
  mb.geo(aim(ball(0.17, 1), F.F, P(0, -0.08, 0.9), 1, 1.3, 1), 0xf6dcb6); // snout
  mb.geo(aim(ball(0.06, 0), F.F, P(0, -0.05, 1.1)), 0x14100e);          // nose
  for (const sx of [-1, 1]) {
    mb.geo(aim(ball(0.062, 0), F.F, P(sx * 0.26, 0.2, 0.9)), 0x14100e);   // eyes
    mb.geo(aim(ball(0.19, 1), F.F, P(sx * 0.52, 0.6, 0.94), 1, 0.45, 1), 0x6b4a2e); // ears
    mb.geo(aim(ball(0.12, 1), F.F, P(sx * 0.52, 0.6, 1.0), 1, 0.3, 1), 0xe9a5a0);
  }
  return { geometry: mb.build(), material: lambert(), puff: 0x8a5e38 };
}

// -- ahtapot: purple octopus ball with curling tentacles and big eyes -----------------------------------------------
function skinAhtapot() {
  const rnd = rng(8888);
  const F = frameOf([0, 0.2, 1]);
  const body = new THREE.Color(0x9a46d8), light = new THREE.Color(0xd08af8), dark = new THREE.Color(0x6a2aa8);
  const core = buildSphere({
    detail: 5,
    perFace: false,
    shape: (x, y, z) => -0.15 + (fbm3(x * 2 + 4, y * 2 + 2, z * 2 + 8, 2) - 0.5) * 0.08,
    paint: (x, y, z, c) => {
      c.copy(body).lerp(dark, clamp01((noise3(x * 2.4 + 1, y * 2.4, z * 2.4 + 5) - 0.5) * 2));
      c.lerp(light, clamp01((noise3(x * 6 + 3, y * 6 + 9, z * 6) - 0.68) * 4) * 0.8);
    },
  });
  const mb = new MB();
  mb.geo(core);
  const P = (u, v, r) => at(F, u, v, r);
  for (const sx of [-1, 1]) {
    mb.geo(aim(ball(0.19, 1), F.F, P(sx * 0.34, 0.2, 0.92)), 0xffffff);
    mb.geo(aim(ball(0.1, 0), F.F, P(sx * 0.33, 0.17, 1.06)), 0x140a24);
  }
  const all = fibDirs(10, rnd, 0.2);
  const dirs = all.filter((d) => dot3(d, F.F) < 0.55);
  const limbs = new Limbs({
    dirs, len: dirs.map(() => 0.64 + rnd() * 0.08), thick: dirs.map(() => 0.15),
    prof: [[0, 1.3], [0.1, 1.1], [0.22, 0.95], [0.36, 0.82], [0.5, 0.7], [0.62, 0.6], [0.74, 0.5], [0.86, 0.4], [0.95, 0.3]],
    seg: 5, rootR: 0.7, apex: 0.1, rnd,
  });
  const skinC = new THREE.Color(0x9a46d8), tipC = new THREE.Color(0xd070f0), suck = new THREE.Color(0xffc6ea);
  const baked = limbs.bake((j, i, k, s, c) => {
    c.copy(skinC).lerp(tipC, s * 0.8);
    if (k === 0 && i % 2 === 1 && i > 1) c.copy(suck);
  });
  const { geometry, offset } = joinGeo(mb.build(), baked.pos, baked.col);
  const posAttr = geometry.attributes.position;
  const ph = limbs.ph;
  const curl = (j, t, o, kap, s) => {
    const p = ph[j];
    o.psi += 0.7 * Math.sin(t * 0.9 + p * 2);
    o.len = 0.95 + 0.05 * Math.sin(t * 2.1 + p);
    const c = 3.4 + 1.6 * Math.sin(t * 1.7 + p);
    for (let i = 1; i < kap.length; i++) kap[i] = c * (0.12 + 3.4 * s[i] * s[i] * s[i]); // gentle at the root, curling hard at the tip
  };
  let clock = 0, acc = 0;
  const update = (dt) => {
    clock += dt; acc += dt;
    if (acc < STEP) return;
    acc = 0;
    limbs.animate(posAttr.array, offset, clock, curl);
    posAttr.needsUpdate = true;
  };
  update(STEP);
  return { geometry, material: lambert(), puff: 0xa24ce0, update };
}

// -- balkabagi: pumpkin with a flickering carved face -----------------------------------------------------------------
function skinBalkabagi() {
  const crest = new THREE.Color(0xff9a30), base = new THREE.Color(0xf47a14), groove = new THREE.Color(0xc4560a);
  const ribs = (x, y, z) => {
    const rib = 0.5 + 0.5 * Math.cos(Math.atan2(z, x) * 8);
    const ay = Math.abs(y);
    return (rib * 0.11 - 0.05) * (1 - Math.pow(ay, 5)) - 0.12 * smooth(0.8, 1.0, ay);
  };
  const core = buildSphere({
    detail: 7,
    shape: ribs,
    paint: (x, y, z, c) => {
      const rib = 0.5 + 0.5 * Math.cos(Math.atan2(z, x) * 8);
      c.copy(groove).lerp(base, smooth(0.1, 0.5, rib)).lerp(crest, smooth(0.7, 1, rib) * 0.6);
      c.multiplyScalar(0.94 + 0.12 * noise3(x * 5, y * 5, z * 5));
    },
  });
  const mb = new MB();
  mb.geo(core);
  // stem
  const stemA = new THREE.Color(0x5d7a22), stemB = new THREE.Color(0x8a6a2a);
  mb.geo(aim(new THREE.CylinderGeometry(0.075, 0.13, 0.3, 6, 1).translate(0, 0.15, 0), [0.08, 1, 0], [0, 0.82, 0]), (x, y, z, c) => c.copy(stemA).lerp(stemB, clamp01((y - 0.9) / 0.25)));
  mb.geo(aim(new THREE.CylinderGeometry(0.05, 0.075, 0.16, 6, 1).translate(0, 0.08, 0), [0.7, 1, 0], [0.04, 1.08, 0]), 0x7a6a28);
  // carved face
  const F = frameOf([0, -0.02, 1]);
  const rs = (off) => (x, y, z) => 1 + ribs(x, y, z) + off;
  const dark = new THREE.Color(0x3a1604);
  const polys = [
    [[-0.46, 0.05], [-0.15, 0.09], [-0.33, 0.34]],
    [[0.15, 0.09], [0.46, 0.05], [0.33, 0.34]],
    [[-0.06, -0.05], [0.06, -0.05], [0, 0.08]],
  ];
  const top = [], bot = []; // mouth: zig-zag top, smile bottom
  for (let i = 0; i <= 8; i++) {
    const x = -0.5 + i * 0.125, q = (x / 0.5) * (x / 0.5);
    top.push([x, -0.15 + 0.18 * q - (i % 2 ? 0.075 : 0)]);
    bot.push([x, -0.4 + 0.2 * q]);
  }
  for (let i = 0; i < 8; i++) polys.push([top[i], top[i + 1], bot[i + 1], bot[i]]);
  const glow = new THREE.Color(2.7, 1.75, 0.3);
  const ranges = [];
  for (const pts of polys) {
    let cu = 0, cv = 0;
    for (const p of pts) { cu += p[0]; cv += p[1]; }
    cu /= pts.length; cv /= pts.length;
    const grown = pts.map((p) => [cu + (p[0] - cu) * 1.22, cv + (p[1] - cv) * 1.22]);
    if (pts.length === 4) { decalTri(mb, F, grown[0], grown[1], grown[2], rs(0.012), dark, 1); decalTri(mb, F, grown[0], grown[2], grown[3], rs(0.012), dark, 1); }
    else decalPoly(mb, F, grown, rs(0.012), dark, 1);
    const a = mb.count;
    if (pts.length === 4) { decalTri(mb, F, pts[0], pts[1], pts[2], rs(0.018), glow, 1); decalTri(mb, F, pts[0], pts[2], pts[3], rs(0.018), glow, 1); }
    else decalPoly(mb, F, pts, rs(0.018), glow, 1);
    ranges.push([a, mb.count, hash3(ranges.length, 31, 7)]);
  }
  const geometry = mb.build();
  const col = geometry.attributes.color, arr = col.array;
  col.setUsage(THREE.DynamicDrawUsage);
  let clock = 0, acc = 0;
  const update = (dt) => {
    clock += dt; acc += dt;
    if (acc < 0.06) return;
    acc = 0;
    for (let r = 0; r < ranges.length; r++) {
      const a = ranges[r][0], b = ranges[r][1], ph = ranges[r][2];
      const k = 0.8 + 0.2 * Math.sin(clock * (9 + ph * 5) + ph * 20) + 0.1 * Math.sin(clock * 23 + ph * 7);
      for (let v = a; v < b; v++) { const o = v * 3; arr[o] = glow.r * k; arr[o + 1] = glow.g * k; arr[o + 2] = glow.b * k; }
    }
    col.needsUpdate = true;
  };
  update(0.1);
  return { geometry, material: lambert({ emissive: 0x1a0800 }), puff: 0xff8a1a, update };
}

// -- zombi: sickly green head, stitched scar, mismatched eyes, stitched mouth -------------------------------------------
function skinZombi() {
  const F = frameOf([0, 0.1, 1]);
  const skinA = new THREE.Color(0x86b868), skinB = new THREE.Color(0x5f8a58), bruise = new THREE.Color(0x7d6aa0);
  const core = buildSphere({
    detail: 6,
    shape: (x, y, z) => (noise3(x * 3, y * 3, z * 3) - 0.5) * 0.04,
    paint: (x, y, z, c) => {
      const n = fbm3(x * 2.4 + 1, y * 2.4 + 4, z * 2.4 + 2, 3);
      c.copy(skinA).lerp(skinB, clamp01((n - 0.4) * 2.4));
      c.lerp(bruise, clamp01((noise3(x * 2.8 + 6, y * 2.8, z * 2.8 + 1) - 0.62) * 4) * 0.7);
    },
  });
  const mb = new MB();
  mb.geo(core);
  const P = (u, v, r = 1) => at(F, u, v, r);
  const R1 = 1.012, thread = new THREE.Color(0x2a1a2e), mouthC = new THREE.Color(0x24121c), tooth = new THREE.Color(0xe8e0a0);
  // forehead scar + cross stitches
  const scar = [];
  for (let i = 0; i <= 10; i++) { const u = -0.58 + i * 0.1; scar.push(P(u, 0.56 + 0.06 * Math.sin(i * 0.5) + u * 0.12, 1)); }
  decalStrip(mb, scar, 0.04, R1, new THREE.Color(0x4a2c4a));
  for (let i = 1; i < 10; i++) {
    const u = -0.58 + i * 0.1, v = 0.56 + 0.06 * Math.sin(i * 0.5) + u * 0.12;
    decalStrip(mb, [P(u - 0.01, v - 0.085, 1), P(u + 0.01, v + 0.085, 1)], 0.03, R1 + 0.004, thread);
  }
  // mouth line, a few teeth, stitches
  const mouth = [];
  for (let i = 0; i <= 10; i++) { const u = -0.44 + i * 0.088; mouth.push(P(u, -0.3 + 0.05 * Math.sin(i * 0.9), 1)); }
  decalStrip(mb, mouth, 0.07, R1, mouthC);
  for (let i = 0; i < 4; i++) {
    const u = -0.3 + i * 0.2, v = -0.265 + 0.04 * Math.sin(u * 5);
    decalTri(mb, F, [u, v], [u + 0.07, v], [u + 0.035, -0.33], R1 + 0.006, tooth, 0);
  }
  for (let i = 0; i < 7; i++) {
    const u = -0.4 + i * 0.133, v = -0.3 + 0.05 * Math.sin(((u + 0.44) / 0.088) * 0.9);
    decalStrip(mb, [P(u, v + 0.1, 1), P(u, v - 0.1, 1)], 0.028, R1 + 0.012, thread);
  }
  // eyes: one huge bulging, one dark socket
  mb.geo(aim(ball(0.2, 1), F.F, P(-0.3, 0.22, 0.93)), 0xf2f0d8);
  mb.geo(aim(ball(0.1, 1), F.F, P(-0.3, 0.2, 1.06)), 0xc23a2a);
  mb.geo(aim(ball(0.05, 0), F.F, P(-0.3, 0.2, 1.15)), 0x15100e);
  decalEllipse(mb, F, 0.3, 0.22, 0.17, 0.15, 10, R1, new THREE.Color(0x1a2a1c));
  mb.geo(aim(ball(0.055, 0), F.F, P(0.3, 0.22, 0.99)), 0xf0e060);
  decalEllipse(mb, F, -0.045, -0.02, 0.025, 0.04, 6, R1, new THREE.Color(0x2a3a28)); // nostrils
  decalEllipse(mb, F, 0.045, -0.02, 0.025, 0.04, 6, R1, new THREE.Color(0x2a3a28));
  return { geometry: mb.build(), material: lambert(), puff: 0x7fb069 };
}

// -- futbol: faceted truncated icosahedron, black pentagons / white hexagons (generic, no logos) -------------------
function skinFutbol() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const seen = new Set(), V = [];
  const addV = (x, y, z) => {
    const k = [x, y, z].map((q) => Math.round(q * 1000)).join(',');
    if (!seen.has(k)) { seen.add(k); V.push(norm3([x, y, z])); }
  };
  for (const b of [[0, 1, 3 * phi], [1, 2 + phi, 2 * phi], [phi, 2, 2 * phi + 1]]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const x = b[0] * sx, y = b[1] * sy, z = b[2] * sz;
      addV(x, y, z); addV(y, z, x); addV(z, x, y);
    }
  }
  const centres = []; // [normal, isPentagon]
  const seenC = new Set();
  const addC = (x, y, z, pent) => {
    const k = [x, y, z].map((q) => Math.round(q * 1000)).join(',') + pent;
    if (!seenC.has(k)) { seenC.add(k); centres.push([norm3([x, y, z]), pent]); }
  };
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    addC(0, sa, sb * phi, true); addC(sa, sb * phi, 0, true); addC(sb * phi, 0, sa, true);
    addC(0, sa * phi, sb / phi, false); addC(sa * phi, sb / phi, 0, false); addC(sb / phi, 0, sa * phi, false);
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) addC(sx, sy, sz, false);
  const black = [new THREE.Color(0x15171c), new THREE.Color(0x1f2229)], white = new THREE.Color(0xfbfbf7), whiteEdge = new THREE.Color(0xe4e4de);
  const mb = new MB();
  const RV = 0.985, RE = 0.993;
  for (const [n, pent] of centres) {
    let best = -2;
    for (const v of V) best = Math.max(best, dot3(v, n));
    const vs = V.filter((v) => dot3(v, n) > best - 1e-3);
    const e1 = norm3(cross3(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross3(n, e1);
    vs.sort((a, b) => Math.atan2(dot3(a, e2), dot3(a, e1)) - Math.atan2(dot3(b, e2), dot3(b, e1)));
    const rc = pent ? 1.055 : 1.035, rm = (rc + RV) / 2 + 0.004;
    const sc = (v, r) => { const w = norm3(v); return [w[0] * r, w[1] * r, w[2] * r]; };
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      const C = sc(n, rc), A = sc(a, RV), B = sc(b, RV);
      const Mab = sc(add3(a, b), RE), Mca = sc(add3(n, a), rm), Mcb = sc(add3(n, b), rm);
      const cc = pent ? black[0] : white, ce = pent ? black[1] : whiteEdge;
      mb.tri(C, Mca, Mcb, cc);
      mb.tri(Mca, A, Mab, ce);
      mb.tri(Mcb, Mab, B, ce);
      mb.tri(Mca, Mab, Mcb, cc);
    }
  }
  return { geometry: mb.build(), material: phong({ shininess: 60, specular: 0x666666 }), puff: 0xffffff };
}

// -- basket: pebbled orange with black channel seams ----------------------------------------------------------------
function skinBasket() {
  const base = [0xf07f1e, 0xe4701a, 0xf79536].map((h) => new THREE.Color(h));
  const core = buildSphere({
    detail: 6,
    shape: (x, y, z) => (noise3(x * 13, y * 13, z * 13) - 0.5) * 0.014,
    paint: (x, y, z, c) => {
      const h = hash3(Math.floor(x * 9 + 20), Math.floor(y * 9 + 20), Math.floor(z * 9 + 20));
      c.copy(base[(h * 3) | 0]);
    },
  });
  const mb = new MB();
  mb.geo(core);
  const e = new THREE.Euler(0.42, 0.3, 0.15);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((a) => { const v = new THREE.Vector3(...a).applyEuler(e); return [v.x, v.y, v.z]; });
  const seam = new THREE.Color(0x15110e);
  for (const n of axes) decalStrip(mb, circlePts(n, 72), 0.05, 1.012, seam, true);
  return { geometry: mb.build(), material: lambert(), puff: 0xff8a2a };
}

// -- bowling: glossy swirl ball with three finger holes ---------------------------------------------------------------
function skinBowling() {
  const navy = new THREE.Color(0x141a6a), purple = new THREE.Color(0x5a1ea8), cyan = new THREE.Color(0x2aa6e0), ink = new THREE.Color(0x07051a);
  const core = buildSphere({
    detail: 7,
    perFace: false,
    paint: (x, y, z, c) => {
      const w = Math.sin(x * 3.2 + y * 2.1 + fbm3(x * 2 + 1, y * 2 + 3, z * 2, 3) * 7);
      const t = 0.5 + 0.5 * w;
      if (t < 0.5) c.copy(ink).lerp(navy, smooth(0, 0.5, t) * 1.4); else c.copy(navy).lerp(purple, smooth(0.5, 0.85, t));
      c.lerp(cyan, smooth(0.9, 1, t) * 0.8);
    },
  });
  const mb = new MB();
  mb.geo(core);
  const F = frameOf([0.2, 0.25, 1]);
  const rim = new THREE.Color(0x2a2a48), hole = new THREE.Color(0x030208);
  for (const [u, v, r] of [[-0.115, 0.17, 0.09], [0.115, 0.17, 0.09], [0, -0.18, 0.108]]) {
    decalEllipse(mb, F, u, v, r * 1.3, r * 1.3, 12, 1.012, rim);
    decalEllipse(mb, F, u, v, r, r, 12, 1.018, hole);
  }
  return { geometry: mb.build(), material: phong({ shininess: 170, specular: 0xffffff }), puff: 0x3b2db0 };
}

// -- tenis: optic-yellow felt with the classic double-lobe seam ------------------------------------------------------------
function skinTenis() {
  const a = new THREE.Color(0xd6f23a), b = new THREE.Color(0xb6d426);
  const core = buildSphere({
    detail: 6,
    shape: (x, y, z) => (noise3(x * 16, y * 16, z * 16) - 0.5) * 0.016,
    paint: (x, y, z, c) => {
      c.copy(a).lerp(b, noise3(x * 12 + 3, y * 12, z * 12 + 5));
      c.multiplyScalar(0.94 + 0.12 * hash3(Math.floor(x * 14 + 30), Math.floor(y * 14 + 30), Math.floor(z * 14 + 30)));
    },
  });
  const mb = new MB();
  mb.geo(core);
  const pts = [];
  for (let i = 0; i < 96; i++) { // baseball curve: lies exactly on the unit sphere
    const t = (i / 96) * TAU;
    pts.push([0.8 * Math.cos(t) + 0.2 * Math.cos(3 * t), 0.8 * Math.sin(t) - 0.2 * Math.sin(3 * t), 0.8 * Math.sin(2 * t)]);
  }
  decalStrip(mb, pts, 0.075, 1.012, new THREE.Color(0xf6f6ee), true);
  return { geometry: mb.build(), material: lambert(), puff: 0xd8f43a };
}

// -- simit: twisted golden dough with sesame seeds ----------------------------------------------------------------------------
function skinSimit() {
  const rnd = rng(2024);
  const gold = new THREE.Color(0xcf8a3a), crest = new THREE.Color(0xe9ac55), toast = new THREE.Color(0x96561c);
  const shapeFn = (x, y, z) => 0.05 * Math.sin(Math.atan2(z, x) * 3 + y * 6.5) + (noise3(x * 4, y * 4, z * 4) - 0.5) * 0.012;
  const core = buildSphere({
    detail: 7,
    shape: shapeFn,
    paint: (x, y, z, c) => {
      const ridge = Math.sin(Math.atan2(z, x) * 3 + y * 6.5);
      c.copy(gold).lerp(crest, smooth(0.2, 1, ridge) * 0.8).lerp(toast, smooth(-0.2, -1, ridge) * 0.5);
      c.lerp(toast, clamp01((noise3(x * 3 + 8, y * 3, z * 3 + 2) - 0.58) * 3) * 0.7);
    },
  });
  const mb = new MB();
  mb.geo(core);
  const seeds = [new THREE.Color(0xfff2c8), new THREE.Color(0xf4e0a4), new THREE.Color(0xffffe0)];
  const rs = (x, y, z) => 1 + shapeFn(x, y, z) + 0.012;
  for (let i = 0; i < 130; i++) {
    const d = randDir(rnd);
    decalEllipse(mb, frameOf(d), 0, 0, 0.075, 0.032, 4, rs, seeds[(rnd() * 3) | 0], rnd() * Math.PI);
  }
  return { geometry: mb.build(), material: phong({ shininess: 28, specular: 0x6a4a20 }), puff: 0xd98c3a };
}

// -- baklava: scored diamond pastry, honey sheen, pistachio crumbs ----------------------------------------------------------
function skinBaklava() {
  const rnd = rng(1071);
  const honey = new THREE.Color(0xe9a53a), peak = new THREE.Color(0xfbd062), seam = new THREE.Color(0x7a410c);
  const CELLS = 12;
  const cellOf = (x, y, z) => {
    const a = Math.atan2(z, x) / TAU * CELLS, b = Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI * (CELLS / 2);
    const U = a + b, V = a - b;
    const fu = U - Math.floor(U), fv = V - Math.floor(V);
    return { s: 1 - 2 * Math.max(Math.abs(fu - 0.5), Math.abs(fv - 0.5)), id: hash3(Math.floor(U) & 255, Math.floor(V) & 255, 3) };
  };
  const shapeFn = (x, y, z) => 0.012 * Math.min(1, cellOf(x, y, z).s * 2.2);
  const core = buildSphere({
    detail: 6,
    shape: shapeFn,
    paint: (x, y, z, c) => {
      const q = cellOf(x, y, z);
      c.copy(honey).lerp(peak, smooth(0.2, 0.9, q.s) * 0.7).multiplyScalar(0.9 + 0.2 * q.id);
    },
  });
  const mb = new MB();
  mb.geo(core);
  // score lines: spirals a +- b = k
  const RS = 1.026;
  for (const sgn of [-1, 1]) {
    for (let k = 0; k < CELLS; k++) {
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const b = -2.5 + (i / 14) * 5; // lat in cell units
        const lon = ((k - sgn * b) / CELLS) * TAU, lat = (b / (CELLS / 2)) * Math.PI;
        pts.push([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]);
      }
      decalStrip(mb, pts, 0.032, RS, seam);
    }
  }
  const pista = [new THREE.Color(0x8cc63e), new THREE.Color(0x6aa22a), new THREE.Color(0xa5d85a)];
  const rs = 1.03;
  for (let i = 0; i < 46; i++) {
    const d = randDir(rnd);
    decalEllipse(mb, frameOf(d), 0, 0, 0.05 + rnd() * 0.025, 0.03, 4, rs, pista[(rnd() * 3) | 0], rnd() * Math.PI);
  }
  return { geometry: mb.build(), material: phong({ shininess: 60, specular: 0xffd890 }), puff: 0xf2b33d };
}

// -- donut: a real ring donut (torus) with wavy pink frosting and sprinkles -----------------------------------------------------
function skinDonut() {
  const rnd = rng(3003);
  const R = 0.6, rr = 0.4, NT = 40, NP = 16;
  const dough = [new THREE.Color(0xdba25c), new THREE.Color(0xc98c44)], frost = [new THREE.Color(0xff8fc4), new THREE.Color(0xff7ab8)];
  const thresh = (th) => -0.05 + 0.3 * Math.sin(th * 5 + 0.7) + 0.1 * Math.sin(th * 11);
  const isFrost = (th, ph) => Math.sin(ph) > thresh(th);
  const rad = (th, ph) => rr * (isFrost(th, ph) ? 1.07 : 1);
  const P = (th, ph, off = 0) => {
    const r = rad(th, ph) + off, k = R + r * Math.cos(ph);
    return [k * Math.cos(th), r * Math.sin(ph), k * Math.sin(th)];
  };
  const mb = new MB();
  for (let i = 0; i < NT; i++) {
    for (let j = 0; j < NP; j++) {
      const t0 = (i / NT) * TAU, t1 = ((i + 1) / NT) * TAU, p0 = (j / NP) * TAU, p1 = ((j + 1) / NP) * TAU;
      const tc = (t0 + t1) / 2, pc = (p0 + p1) / 2;
      const nf = [isFrost(t0, p0), isFrost(t1, p0), isFrost(t1, p1), isFrost(t0, p1)].filter(Boolean).length;
      const col = nf >= 2 ? frost[(i + j) & 1] : dough[((i >> 1) + j) & 1];
      const n = [Math.cos(pc) * Math.cos(tc), Math.sin(pc), Math.cos(pc) * Math.sin(tc)];
      const a = P(t0, p0), b = P(t1, p0), c = P(t1, p1), d = P(t0, p1);
      mb.triN(a, b, c, col, n);
      mb.triN(a, c, d, col, n);
    }
  }
  const sprinkle = [0xffffff, 0x4cd6ff, 0xffe14a, 0x7be07b, 0xff5c5c, 0xb06cff].map((h) => new THREE.Color(h));
  let placed = 0, guard = 0;
  while (placed < 54 && guard++ < 2000) {
    const th = rnd() * TAU, ph = rnd() * TAU;
    if (!(Math.sin(ph) > thresh(th) + 0.25) || Math.sin(ph) < 0.2) continue;
    const n = [Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th)];
    const c = P(th, ph, 0.014);
    const eT = [-Math.sin(th), 0, Math.cos(th)], eP = [-Math.sin(ph) * Math.cos(th), Math.cos(ph), -Math.sin(ph) * Math.sin(th)];
    const al = rnd() * Math.PI;
    const d = [eT[0] * Math.cos(al) + eP[0] * Math.sin(al), eT[1] * Math.cos(al) + eP[1] * Math.sin(al), eT[2] * Math.cos(al) + eP[2] * Math.sin(al)];
    const sd = cross3(n, d);
    const L = 0.065, W = 0.02;
    const q = (a, b) => [c[0] + d[0] * L * a + sd[0] * W * b, c[1] + d[1] * L * a + sd[1] * W * b, c[2] + d[2] * L * a + sd[2] * W * b];
    const col = sprinkle[(rnd() * sprinkle.length) | 0];
    mb.triN(q(-1, -1), q(1, -1), q(1, 1), col, n);
    mb.triN(q(-1, -1), q(1, 1), q(-1, 1), col, n);
    placed++;
  }
  return { geometry: mb.build(), material: lambert(), puff: 0xff8fc4 };
}

// -- kurabiye: golden butter cookie with chocolate chips ------------------------------------------------------------------------------
function skinKurabiye() {
  const rnd = rng(4747);
  const gold = new THREE.Color(0xe3b36a), dark = new THREE.Color(0xc48a40), pale = new THREE.Color(0xf2cf8a);
  const shapeFn = (x, y, z) => (fbm3(x * 2.6 + 2, y * 2.6 + 8, z * 2.6 + 4, 2) - 0.5) * 0.12;
  const core = buildSphere({
    detail: 6,
    shape: shapeFn,
    paint: (x, y, z, c) => {
      const n = noise3(x * 3 + 1, y * 3 + 5, z * 3 + 7);
      c.copy(gold).lerp(n > 0.5 ? pale : dark, Math.abs(n - 0.5) * 1.6);
      c.multiplyScalar(0.95 + 0.1 * hash3(Math.floor(x * 11 + 30), Math.floor(y * 11 + 30), Math.floor(z * 11 + 30)));
    },
  });
  const mb = new MB();
  mb.geo(core);
  const chip = [new THREE.Color(0x4a2410), new THREE.Color(0x5d3016), new THREE.Color(0x3a1a0a)];
  const dirs = fibDirs(24, rnd, 0.6);
  for (const d of dirs) {
    const r = 0.1 + rnd() * 0.06;
    const g = ball(r, 0);
    g.deleteAttribute('uv');
    g.scale(1, 0.55 + rnd() * 0.4, 0.8 + rnd() * 0.4);
    g.rotateX(rnd() * 6); g.rotateY(rnd() * 6);
    const k = 0.98 + shapeFn(d[0], d[1], d[2]);
    g.translate(d[0] * k, d[1] * k, d[2] * k);
    mb.geo(g, chip[(rnd() * 3) | 0]);
  }
  return { geometry: mb.build(), material: lambert(), puff: 0xd9a35a };
}

// -- poncik: fluffy blob with tufts, round ears, blinking eyes and rosy cheeks ----------------------------------------------------------
function skinPoncik() {
  const rnd = rng(5150);
  const F = frameOf([0, 0.05, 1]);
  const pink = new THREE.Color(0xffd0e2), cream = new THREE.Color(0xfff2f7);
  const bumps = fibDirs(54, rnd, 0.7);
  const fluff = (x, y, z) => { // cotton-ball: soft mounds, calmer around the face
    let m = 0;
    for (let i = 0; i < bumps.length; i++) {
      const d = x * bumps[i][0] + y * bumps[i][1] + z * bumps[i][2];
      const h = smooth(0.9, 1, d);
      if (h > m) m = h;
    }
    return m * (1 - 0.75 * smooth(0.55, 0.85, x * F.F[0] + y * F.F[1] + z * F.F[2]));
  };
  const surf = (x, y, z) => 0.84 + 0.12 * fluff(x, y, z);
  const core = buildSphere({
    detail: 6,
    perFace: false,
    shape: (x, y, z) => surf(x, y, z) - 1,
    paint: (x, y, z, c) => c.copy(pink).lerp(cream, clamp01(fluff(x, y, z) * 1.2 + noise3(x * 4 + 7, y * 4, z * 4 + 3) * 0.25)),
  });
  const mb = new MB();
  mb.geo(core);
  const P = (u, v, r) => at(F, u, v, r);
  for (const sx of [-1, 1]) { // ears
    mb.geo(aim(ball(0.2, 1), F.F, P(sx * 0.5, 0.74, 0.88), 1, 0.5, 1.25), 0xffbcd6);
    mb.geo(aim(ball(0.13, 1), F.F, P(sx * 0.5, 0.74, 0.92), 1, 0.4, 1.15), 0xff8fb8);
  }
  const on = (off) => (x, y, z) => surf(x, y, z) + off; // decals ride the real surface
  for (const sx of [-1, 1]) decalEllipse(mb, F, sx * 0.43, -0.1, 0.1, 0.065, 8, on(0.012), new THREE.Color(0xff8fb8));
  decalTri(mb, F, [-0.035, -0.02], [0.035, -0.02], [0, -0.065], on(0.014), new THREE.Color(0xd9507f), 0);
  for (const sx of [-1, 1]) decalStrip(mb, [P(0, -0.07, 1), P(sx * 0.03, -0.11, 1), P(sx * 0.07, -0.115, 1), P(sx * 0.1, -0.09, 1)], 0.018, on(0.014), new THREE.Color(0x5a2a3a));
  for (const sx of [-1, 1]) mb.geo(aim(ball(0.03, 0), F.F, P(sx * 0.27 + 0.025, 0.2, 0.93)), 0xffffff); // eye glints
  // eyes last so blink() can find them
  const eyeStart = mb.count;
  const eyeC = [];
  for (const sx of [-1, 1]) {
    const c = P(sx * 0.27, 0.15, 0.88);
    eyeC.push(c);
    mb.geo(ball(0.075, 1).translate(c[0], c[1], c[2]), 0x1a0f1a);
  }
  const eyeEnd = mb.count;
  const geometry = mb.build();
  const posAttr = geometry.attributes.position, arr = posAttr.array;
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const per = (eyeEnd - eyeStart) / 2;
  const base = arr.slice(eyeStart * 3, eyeEnd * 3);
  const U = F.U;
  let clock = 0, acc = 0, nextBlink = 1.2, lastK = 1;
  const apply = (k) => {
    for (let e = 0; e < 2; e++) {
      const c = eyeC[e];
      for (let v = 0; v < per; v++) {
        const o = (e * per + v) * 3;
        const dx = base[o] - c[0], dy = base[o + 1] - c[1], dz = base[o + 2] - c[2];
        const du = (dx * U[0] + dy * U[1] + dz * U[2]) * (1 - k);
        const w = (eyeStart * 3) + o;
        arr[w] = base[o] - U[0] * du; arr[w + 1] = base[o + 1] - U[1] * du; arr[w + 2] = base[o + 2] - U[2] * du;
      }
    }
    posAttr.needsUpdate = true;
  };
  const update = (dt) => {
    clock += dt; acc += dt;
    if (acc < 0.03) return;
    acc = 0;
    let k = 1;
    const p = (clock - nextBlink) / 0.2;
    if (p >= 0 && p <= 1) k = 1 - 0.9 * Math.sin(p * Math.PI);
    else if (p > 1) nextBlink = clock + 1.8 + rnd() * 2.8;
    if (k !== lastK) { lastK = k; apply(k); }
  };
  return { geometry, material: lambert(), puff: 0xffc4dc, update };
}

// -- penguen: round penguin with white belly, beak, flippers and feet ------------------------------------------------------------------------
function skinPenguen() {
  const F = frameOf([0, 0.08, 1]);
  const bodyA = new THREE.Color(0x1c2c4a), bodyB = new THREE.Color(0x2e4470), belly = new THREE.Color(0xf4f7fc), bellyShade = new THREE.Color(0xd7e0ee);
  const core = buildSphere({
    detail: 6,
    shape: (x, y, z) => -0.1 + (noise3(x * 3, y * 3, z * 3) - 0.5) * 0.02,
    paint: (x, y, z, c) => {
      c.copy(bodyA).lerp(bodyB, noise3(x * 3 + 2, y * 3, z * 3 + 5));
      const df = x * F.F[0] + y * F.F[1] + z * F.F[2];
      if (df > 0.05) {
        const u = (x * F.R[0] + y * F.R[1] + z * F.R[2]) / df, v = (x * F.U[0] + y * F.U[1] + z * F.U[2]) / df;
        const e = (u / 0.62) * (u / 0.62) + ((v + 0.12) / 0.82) * ((v + 0.12) / 0.82);
        if (e < 1) c.copy(belly).lerp(bellyShade, smooth(0.7, 1, e));
      }
    },
  });
  const mb = new MB();
  mb.geo(core);
  const P = (u, v, r) => at(F, u, v, r);
  mb.geo(aim(cone(0.1, 0.26, 6, true), F.F, P(0, 0.3, 0.92), 1.3, 1, 0.75), 0xffa21a);          // beak
  for (const sx of [-1, 1]) {
    mb.geo(aim(ball(0.062, 0), F.F, P(sx * 0.21, 0.46, 0.93)), 0x0c0c12);                      // eyes
    mb.geo(aim(ball(0.022, 0), F.F, P(sx * 0.21 + 0.02, 0.5, 0.99)), 0xffffff);
    decalEllipse(mb, F, sx * 0.36, 0.33, 0.07, 0.045, 8, 0.915, new THREE.Color(0xffa6b4));       // blush
    // flipper: flat ellipsoid hanging from the side
    const side = [sx, -0.1, 0.1];
    const long = norm3([sx * 0.55, -0.85, 0.25]);
    const nrm = norm3(side);
    const X = norm3(add3(nrm, long, -dot3(nrm, long)));
    const Z = cross3(X, long);
    const g = ball(0.2, 1);
    g.deleteAttribute('uv');
    g.scale(0.3, 1.45, 0.85);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...long), new THREE.Vector3(...Z)));
    g.translate(sx * 0.86, -0.12, 0.08);
    mb.geo(g, 0x16233d);
    // foot: orange flat blob at the bottom front
    const g2 = ball(0.15, 1);
    g2.deleteAttribute('uv');
    g2.scale(1.2, 0.45, 1.0);
    g2.translate(sx * 0.28, -0.88, 0.42);
    mb.geo(g2, 0xff9a1a);
  }
  return { geometry: mb.build(), material: lambert(), puff: 0x2a3d63 };
}

// ------------------------------------------------------------------------------------------------------------------------------
// Tile skins: a procedurally painted texture (DataTexture, no assets) wrapped on a "cube sphere" so every
// triangle samples one of six tile faces. Triangles spill a little past the tile edge, so every tile carries a
// solid border colour that the clamped edge texels extend into (looks like grout between tiles).

function cubeTileSphere(detail) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position, n = pos.count;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(t + k); cy += pos.getY(t + k); cz += pos.getZ(t + k); }
    const ax = Math.abs(cx), ay = Math.abs(cy), az = Math.abs(cz);
    const major = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const sg = (major === 0 ? cx : major === 1 ? cy : cz) >= 0 ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(t + k), y = pos.getY(t + k), z = pos.getZ(t + k);
      let u, v, m;
      if (major === 0) { m = x * sg; u = -z * sg; v = y; } else if (major === 1) { m = y * sg; u = x; v = -z * sg; } else { m = z * sg; u = x * sg; v = y; }
      uv[(t + k) * 2] = (u / m) * 0.5 + 0.5;
      uv[(t + k) * 2 + 1] = (v / m) * 0.5 + 0.5;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function dataTexture(data, size, nearest) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  if (nearest) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; }
  else { tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; }
  tex.needsUpdate = true;
  return tex;
}

// -- cini: Iznik tile -- cobalt, turquoise and tomato red on white glaze: rosette, four tulips, four carnations ------------------
let _ciniData = null;
function paintCini(S) {
  const data = new Uint8Array(S * S * 4);
  const WHITE = [248, 245, 236], COB = [22, 54, 150], TURQ = [22, 182, 178], RED = [216, 62, 42];
  const o = [0, 0, 0];
  const lens = (px, py, Lh, W) => { // pointed oval along x, tips at +-Lh
    const Rc = (W * W + Lh * Lh) / (2 * W), cy = Rc - W;
    return Math.max(Math.hypot(px, py - cy) - Rc, Math.hypot(px, py + cy) - Rc);
  };
  const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const px = 2 / S, aa = px * 1.2;
  const mix = (c, t) => { o[0] += (c[0] - o[0]) * t; o[1] += (c[1] - o[1]) * t; o[2] += (c[2] - o[2]) * t; };
  const fill = (d, c) => mix(c, clamp01(0.5 - d / aa));
  const line = (d, w, c) => mix(c, clamp01((w * 0.5 + aa * 0.5 - Math.abs(d)) / aa));
  const shape = (d, fc, lw = 0.013) => { fill(d, fc); line(d, lw, COB); };
  const half = S / 2;
  for (let yy = 0; yy < half; yy++) {
    for (let xx = yy; xx < half; xx++) { // one octant is enough: the tile has D4 symmetry and gets mirrored below
      const u = ((half + xx + 0.5) / S) * 2 - 1, v = ((half + yy + 0.5) / S) * 2 - 1;
      const x = u, y = v; // x >= y >= 0 here
      o[0] = WHITE[0]; o[1] = WHITE[1]; o[2] = WHITE[2];
      // leaves + stems (behind the flowers)
      for (const sgn of [-1, 1]) {
        const q = rot(x - 0.3, y - sgn * 0.0, sgn * 0.62);
        shape(lens(q[0] - 0.12, q[1], 0.14, 0.036), TURQ, 0.011);
      }
      if (x > 0.1 && x < 0.46) line(y, 0.016, COB); // stem between rosette and tulip
      // tulip on the axis, pointing outward
      const tb = [x - 0.44, y];
      for (const sgn of [-1, 1]) {
        const q = rot(tb[0], tb[1], -sgn * 0.5);
        shape(lens(q[0] - 0.13, q[1], 0.14, 0.05), TURQ);
      }
      shape(lens(x - 0.58, y, 0.16, 0.07), RED);
      line(lens(x - 0.58, y, 0.16, 0.07) + 0.03, 0.01, WHITE);
      // carnation on the diagonal
      const cx = x - 0.5, cy = y - 0.5, ang = Math.atan2(cy, cx), rr = Math.hypot(cx, cy);
      shape(rr - (0.13 + 0.022 * Math.cos(ang * 10)), TURQ);
      shape(rr - 0.075, WHITE, 0.011);
      fill(rr - 0.035, RED);
      // rosette
      shape(lens(x - 0.205, y, 0.155, 0.065), TURQ);
      const dgx = (x + y) * Math.SQRT1_2, dgy = (y - x) * Math.SQRT1_2;
      shape(lens(dgx - 0.2, dgy, 0.13, 0.05), COB, 0.01);
      shape(Math.hypot(x, y) - 0.1, WHITE, 0.012);
      fill(Math.hypot(x, y) - 0.06, RED);
      fill(Math.hypot(x, y) - 0.022, WHITE);
      // small buds
      for (const [bx, by] of [[0.66, 0.27], [0.3, 0.2]]) { const dd = Math.hypot(x - bx, y - by) - 0.032; fill(dd, COB); }
      // frame
      fill(0.9 - x, COB);
      line(x - 0.835, 0.045, TURQ);
      line(x - 0.78, 0.016, COB);
      const r = Math.round(o[0]), g = Math.round(o[1]), b = Math.round(o[2]);
      const X0 = half + xx, Y0 = half + yy, X1 = half - 1 - xx, Y1 = half - 1 - yy;
      for (const [qx, qy] of [[X0, Y0], [Y0, X0], [X1, Y0], [Y0, X1], [X0, Y1], [Y1, X0], [X1, Y1], [Y1, X1]]) {
        const i = (qy * S + qx) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
  }
  return data;
}

function skinCini() {
  if (!_ciniData) _ciniData = paintCini(256);
  const tex = dataTexture(_ciniData, 256, false);
  const geometry = cubeTileSphere(5);
  const material = new THREE.MeshPhongMaterial({ map: tex, flatShading: true, shininess: 90, specular: 0x555555 });
  return { geometry, material, puff: 0x2a5bd7, textures: [tex] };
}

// -- hali: Anatolian kilim -- stepped medallion, zig-zag border, red / navy / ochre / cream ----------------------------------------------------
let _kilimData = null;
function paintKilim(S) {
  const data = new Uint8Array(S * S * 4);
  const RED = [178, 34, 40], NAVY = [28, 40, 98], OCHRE = [228, 170, 52], CREAM = [240, 226, 190], TEAL = [38, 112, 108];
  const set = (x, y, c) => { const i = (y * S + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  const half = (S - 1) / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.abs(x - half), dy = Math.abs(y - half);
      const ch = Math.max(dx, dy), man = dx + dy;
      let c;
      if (ch > half - 0.6) c = NAVY;
      else if (ch > half - 1.6) c = CREAM;
      else if (ch > half - 4.6) { // zig-zag band
        const phase = dy > dx ? x : y, tri = phase % 6 < 3 ? phase % 3 : 2 - (phase % 3);
        c = Math.floor(half - 1.6 - ch) <= tri ? OCHRE : RED;
      } else if (ch > half - 5.6) c = CREAM;
      else if (man < 2.5) c = CREAM;
      else if (man < 4.5) c = RED;
      else if (man < 6.5) c = OCHRE;
      else if (man < 8) c = NAVY;
      else if (man < 9.5) c = RED;
      else if (man < 10.5) c = CREAM;
      else c = (Math.abs(dx - 7) + Math.abs(dy - 7) < 2.5) ? (Math.abs(dx - 7) + Math.abs(dy - 7) < 1.2 ? RED : OCHRE) : NAVY;
      if (c === NAVY && (x + y) % 5 === 0 && man > 8) c = TEAL; // woven speckle
      set(x, y, c);
    }
  }
  return data;
}

function skinHali() {
  if (!_kilimData) _kilimData = paintKilim(32);
  const tex = dataTexture(_kilimData, 32, true);
  const geometry = cubeTileSphere(5);
  const material = new THREE.MeshPhongMaterial({ map: tex, flatShading: true, shininess: 12, specular: 0x222222 });
  return { geometry, material, puff: 0xc1272d, textures: [tex] };
}

// -- generic painted ball for the newer catalog entries: one of five colour layouts, three colours, no per-item code.
//   kind: stripes | dots | swirl | bands | facets   (per-face colour, flat-shaded like the rest)
function skinGen(kind, a, b, c, puff) {
  const A = new THREE.Color(a), B = new THREE.Color(b), C = new THREE.Color(c);
  const paint = {
    stripes: (x, y, z, o) => o.copy(Math.sin(y * 9) > 0.2 ? B : A),
    dots: (x, y, z, o) => {
      const lon = Math.atan2(z, x) * 4, lat = Math.asin(Math.max(-1, Math.min(1, y))) * 4;
      const u = Math.round(lon), v = Math.round(lat);
      o.copy(Math.hypot(lon - u, lat - v) < 0.3 ? (hash3(u, v, 3) < 0.5 ? B : C) : A);
    },
    swirl: (x, y, z, o) => {
      const s = Math.sin(Math.atan2(z, x) * 3 + Math.sin(y * 4) * 2);
      o.copy(s > 0.35 ? B : s < -0.35 ? C : A);
    },
    bands: (x, y, z, o) => { const t = (y + 1) / 2; o.copy(t < 0.33 ? A : t < 0.66 ? B : C); },
    facets: (x, y, z, o) => {
      const h = hash3(Math.floor(x * 4) + 8, Math.floor(y * 4) + 8, Math.floor(z * 4) + 8);
      o.copy(h < 0.4 ? A : h < 0.8 ? B : C);
    },
  }[kind] || ((x, y, z, o) => o.copy(A));
  const geometry = buildSphere({ detail: 5, shape: () => 0, paint: (x, y, z, col) => paint(x, y, z, col) });
  return { geometry, material: lambert(), puff };
}

const BUILDERS = {
  lahmacun: () => skinGen('dots', 0xe9b26a, 0xb5501f, 0x6fb23c, 0xf0b070),
  kiraz: () => skinGen('dots', 0xff3b5c, 0x8a0820, 0xffe0e6, 0xff7a8a),
  kavun: () => skinGen('stripes', 0xf7e27a, 0x6aa84f, 0x6aa84f, 0xffef9a),
  konfeti: () => skinGen('dots', 0xffffff, 0xff5ca8, 0x3ad0ff, 0xffd6ea),
  zumrut: () => skinGen('facets', 0x3ee08a, 0x0a7a4a, 0x9ff5c4, 0x7fe8b0),
  lokum: () => skinGen('bands', 0xfff5f7, 0xf2a6c0, 0xffffff, 0xffd8e6),
  gokkusagi: () => skinGen('swirl', 0xff4d4d, 0x7a5cff, 0xffd23a, 0xffb0b0),
  nebula: () => skinGen('swirl', 0x2b0a4a, 0xff5ac8, 0x7ae7ff, 0xb070ff),
  karprens: () => skinGen('dots', 0xf4fbff, 0x9fd8ff, 0xffffff, 0xe6f6ff),
  altinkral: () => skinGen('bands', 0xfff3b0, 0xd8940c, 0x7a4a00, 0xffe27a),
  kristal: () => skinGen('facets', 0xffffff, 0x00b8e6, 0xe8fcff, 0x9fe8ff),
  gunestaci: () => skinGen('swirl', 0xffd23a, 0xff3a10, 0xffb000, 0xffe07a),
  kombo_top: () => skinGen('swirl', 0xff9a1a, 0xfff3a0, 0x7a2a00, 0xffc070),
  gunluk_kar: () => skinGen('dots', 0xffffff, 0x9fd8ff, 0xc6f0ff, 0xe6f6ff),
  gece_topu: () => skinGen('stripes', 0x0b1640, 0x3a4fa0, 0xc8d8ff, 0x5a6ec0),
  arena_kral: () => skinGen('facets', 0x9fd8ff, 0x2a6fb8, 0xffffff, 0xcfeaff),
  tac_top: () => skinGen('bands', 0xffe681, 0xd8940c, 0x7a4a00, 0xffef9a),
  mavikar: skinMaviKar,
  nane: skinNane,
  cilek: skinCilek,
  gunbatimi: skinGunBatimi,
  classic: skinClassic,
  ice: skinIce,
  kofte: skinKofte,
  pamuk: skinPamuk,
  karpuz: skinKarpuz,
  disko: skinDisko,
  altin: skinAltin,
  lav: skinLav,
  dunya: skinDunya,
  yuz: skinYuz,
  nazar: skinNazar,
  karasivi: skinKarasivi,
  kizilkaos: skinKizilKaos,
  zehir: skinZehir,
  plazma: skinPlazma,
  galaksi: skinGalaksi,
  ates: skinAtes,
  buzejder: skinBuzEjder,
  robot: skinRobot,
  kirpi: skinKirpi,
  ahtapot: skinAhtapot,
  balkabagi: skinBalkabagi,
  zombi: skinZombi,
  futbol: skinFutbol,
  basket: skinBasket,
  bowling: skinBowling,
  tenis: skinTenis,
  simit: skinSimit,
  baklava: skinBaklava,
  donut: skinDonut,
  kurabiye: skinKurabiye,
  poncik: skinPoncik,
  penguen: skinPenguen,
  cini: skinCini,
  hali: skinHali,
};

// ---- golden snowball secret (10 quick taps on the lobby ball): the CLASSIC skin turns gold for the rest of the session ----
let activeSkin = null;
function tintGold(skin, on) {
  if (!skin || skin.id !== 'classic') return false;
  const mats = Array.isArray(skin.material) ? skin.material : [skin.material];
  for (const m of mats) {
    if (!m || !m.color) continue;
    m.color.set(on ? 0xffc83a : 0xffffff);
    if (m.emissive) m.emissive.set(on ? 0x4a2c00 : 0x000000);
  }
  return true;
}
/** Tint (or restore) the ball skin that is on screen right now. Returns true when it was the classic skin and got tinted. */
export function setGoldBall(on) {
  try { globalThis.__patpatGold = !!on; } catch (e) { /* ignore */ }
  return tintGold(activeSkin, !!on);
}

export function makeSkin(id) {
  const key = BUILDERS[id] ? id : 'classic';
  const skin = BUILDERS[key]();
  skin.id = key;
  activeSkin = skin;
  let gold = false;
  try { gold = !!globalThis.__patpatGold; } catch (e) { gold = false; }
  if (gold) tintGold(skin, true);
  return skin;
}

export function disposeSkin(skin) {
  if (!skin) return;
  if (skin === activeSkin) activeSkin = null;
  if (skin.geometry) skin.geometry.dispose();
  const mats = Array.isArray(skin.material) ? skin.material : [skin.material];
  for (const m of mats) {
    if (!m) continue;
    for (const k of ['map', 'emissiveMap', 'alphaMap', 'envMap']) if (m[k] && m[k].dispose) m[k].dispose();
    m.dispose();
  }
  if (skin.textures) for (const t of skin.textures) t.dispose();
}
