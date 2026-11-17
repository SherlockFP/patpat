// Customization shop: full-screen DOM overlay ("DOLAP") for ball skins, snow trails and power upgrades (what ❄️ is for).
//
//   const close = openShop({ save, onClose, onSelect });
//
// Self-contained (injects its own <style id="cig-shop-style">). Portrait-phone first.
// Buying: save.spend(price) -> save.own(kind,id) -> save.select(kind,id) -> onSelect(kind,id).
// Items are sorted by rarity (SIRADAN -> NADİR -> EPİK -> EFSANE), then price. Items with unlock.secret stay
// hidden ("GİZLİ", name and look concealed) until save.isOwned(kind, id) becomes true.
import { getLang } from './i18n.js';
import { SKINS, ABILITIES, TRAILS, RARITY, sortCatalog } from './skins.js';
import { KINDS, BUNDLES as SETS, catalog, itemOf } from './cosmetics.js';
import { createView } from './shopview.js';
import { stageOf } from './effectballs.js';
import { meta, ACHIEVEMENTS, UPGRADES as POWER_UPGRADES, SLED_PACK } from './meta.js';
import * as Perks from './runner/perks.js';

// Permanent run upgrades (runner/perks.js owns the list; this is only the fallback).
const PERM_FALLBACK = [
  { id: 'size', icon: '🧊', name: 'Kartopu', desc: 'Kar yığınları daha çok büyütür' },
  { id: 'speed', icon: '🦬', name: 'Yeti Kaçağı', desc: 'Skor çarpanı artar' },
  { id: 'smash', icon: '🏔️', name: 'Çığ', desc: 'Yıkım puanı ve tonu artar' },
  { id: 'coin', icon: '💰', name: 'Altın', desc: 'Kar taneleri daha değerli' },
  { id: 'yeti', icon: '🧤', name: 'Kalın Eldiven', desc: 'Tökezleme süresi kısalır' },
  { id: 'flow', icon: '🌊', name: 'Akış', desc: 'Akış kombosu daha yavaş söner' },
];
const permList = () => (Array.isArray(Perks.UPGRADES) && Perks.UPGRADES.length ? Perks.UPGRADES : PERM_FALLBACK);
const MAX_LV = 5;
// Star-gated items unlock with ÇIĞ level stars + MACERA stars (the finite ÇIĞ levels are no longer the only way to earn them).
function starsOf(sv) {
  let n = 0;
  try { n += sv.totalStars(); } catch { /* ignore */ }
  try { n += meta.campaign().totalStars || 0; } catch { /* ignore */ }
  return n;
}

// The next thing coins can buy: the cheapest unowned skin / trail / upgrade that costs more than you have ("1.250 ❄️ → Kızıl Kaos").
// Items gated by stars or secrets are never coin goals. Returns { kind, id, name, icon, price, have, frac, ready } or null.
// every sellable, unowned, ungated item of every wardrobe kind: [[kind, item], ...]
function buyables(sv) {
  const out = [];
  for (const kd of KINDS) for (const it of catalog(kd.k)) if (it.price > 0 && !(it.unlock && (it.unlock.stars || it.unlock.secret || it.unlock.challenge)) && !sv.isOwned(kd.k, it.id)) out.push([kd, it]);
  return out;
}
/** the priciest wardrobe item the wallet can pay right now (Rush result 'you can buy it' pill): { kind, id, name, icon, price } or null */
export function affordItem(sv) {
  try {
    const have = sv && Number.isFinite(sv.coins) ? sv.coins : 0;
    let best = null;
    for (const [kd, it] of buyables(sv)) if (it.price <= have && (!best || it.price > best.price)) best = { kind: kd.k, id: it.id, name: it.name, icon: kd.k === 'skin' ? '👕' : kd.ic, price: it.price };
    return best;
  } catch { return null; }
}
export function nextGoal(sv) {
  const have = sv && Number.isFinite(sv.coins) ? sv.coins : 0;
  const c = [];
  try {
    for (const [kd, it] of buyables(sv)) c.push({ kind: kd.k, id: it.id, name: kd.k === 'trail' && !it.name.toLocaleLowerCase('tr-TR').includes('izi') ? it.name + ' izi' : it.name, icon: kd.k === 'skin' ? '👕' : kd.ic, price: it.price });
    const perm = sv.perm ? sv.perm() : {};
    for (const u of permList()) {
      const cost = sv.permCost ? sv.permCost(u.id) : null;
      if (cost != null) c.push({ kind: 'perm', id: u.id, name: `${u.name} Sv${(perm[u.id] || 0) + 1}`, icon: u.icon, price: cost });
    }
    for (const u of POWER_UPGRADES) {
      const cost = meta.upgradeCost(u.id);
      if (cost != null) c.push({ kind: 'power', id: u.id, name: `${u.name} Sv${meta.upgradeLevel(u.id) + 1}`, icon: u.icon, price: cost });
    }
  } catch { /* a bad catalog entry must never break the result screen */ }
  if (!c.length) return null;
  const above = c.filter((x) => x.price > have).sort((a, b) => a.price - b.price);
  const pick = above.length ? above[0] : c.sort((a, b) => b.price - a.price)[0];
  return { ...pick, have, frac: Math.max(0, Math.min(1, have / pick.price)), ready: have >= pick.price };
}

// ---- YETI PAZARI: 3 weekly offers seeded by the ISO week (same for everyone, refreshes Monday 00:00 local) ----
function isoWeekInfo(d = new Date()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7; // Mon=0
  t.setDate(t.getDate() - day + 3); // Thursday of this week
  const year = t.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 7);
  return { key: year + '-W' + week, seed: year * 100 + week, msLeft: Math.max(0, next - d) };
}
function seededPick(arr, seed) { return arr.length ? arr[(Math.imul(seed, 2654435761) >>> 0) % arr.length] : null; }
// DÖNEN VİTRİN: one skin per 3 days (local midnight), 15% off; same for everyone
export function vitrinInfo(sv) {
  try {
    const d = new Date(), t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dn = Math.floor((t0.getTime() - t0.getTimezoneOffset() * 60000) / 86400000), per = Math.floor(dn / 3);
    const pool = SKINS.filter((it) => it.price > 0 && !(it.unlock && (it.unlock.stars || it.unlock.secret)));
    const it = seededPick(pool, per * 31 + 5);
    if (!it) return null;
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (3 - (dn % 3)));
    return { id: it.id, name: it.name, was: it.price, price: Math.max(1, Math.round(it.price * 0.85)), msLeft: Math.max(0, end - d), owned: !!(sv && sv.isOwned && sv.isOwned('skin', it.id)) };
  } catch { return null; }
}
const BUNDLES = [{ cr: 3, coins: 1500 }, { cr: 5, coins: 2800 }, { cr: 4, coins: 2100 }];
function weeklyOffers(sv, wk) {
  const gate = (it) => it.price > 0 && !(it.unlock && (it.unlock.stars || it.unlock.secret));
  const sPick = seededPick(SKINS.filter(gate), wk.seed);
  const tPick = seededPick(TRAILS.filter(gate), wk.seed + 7);
  const b = BUNDLES[wk.seed % BUNDLES.length];
  const out = [];
  if (sPick) out.push({ id: 'w-skin', kind: 'skin', item: sPick, icon: '👕', name: sPick.name, price: Math.round(sPick.price * 0.6), was: sPick.price, cur: 'coins', tag: '%40 İNDİRİM' });
  out.push({ id: 'w-bundle', kind: 'bundle', icon: '❄️', name: b.coins.toLocaleString('tr-TR') + ' ❄️ Paketi', price: b.cr, cur: 'crystals', coins: b.coins, tag: 'HAFTALIK PAKET' });
  if (tPick) out.push({ id: 'w-trail', kind: 'trail', item: tPick, icon: '✨', name: tPick.name, price: Math.round(tPick.price * 0.6), was: tPick.price, cur: 'coins', tag: '%40 İNDİRİM' });
  return out;
}
const pzKey = (wk) => 'patpat.pazar.' + wk.key;
function pzBought(wk) { try { return JSON.parse(localStorage.getItem(pzKey(wk)) || '[]'); } catch { return []; } }
function pzMark(wk, id) { try { const a = pzBought(wk); if (!a.includes(id)) a.push(id); localStorage.setItem(pzKey(wk), JSON.stringify(a)); } catch { /* ignore */ } }
const fmtLeft = (ms) => { const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60, en = getLang() === 'en'; return d > 0 ? d + (en ? 'd ' : 'g ') + hh + (en ? 'h' : 'sa') : hh + (en ? 'h ' : 'sa ') + String(mm).padStart(2, '0') + (en ? 'm' : 'dk'); };

const STYLE_ID = 'cig-shop-style';

const CSS = `
.cs-root {
  --ink: #17345c; --orange: #ff7a2f; --orange-dark: #d2541a; --blue: #2f7dff; --blue-dark: #1d55b8; --gold: #ffcf3a;
  position: absolute; inset: 0; z-index: 50;
  display: flex; flex-direction: column;
  padding-top: calc(var(--sat, env(safe-area-inset-top, 0px)) + 10px);
  background: linear-gradient(180deg, rgba(118, 183, 250, 0.97) 0%, rgba(188, 224, 255, 0.98) 55%, rgba(233, 245, 255, 0.99) 100%);
  color: #fff; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-weight: 900;
  user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  animation: csIn 0.22s ease-out;
}
.cs-root button { font-family: inherit; -webkit-tap-highlight-color: transparent; }
.cs-root button:focus { outline: none; }
.cs-root button:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
@keyframes csIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

/* ---- header ---- */
.cs-head {
  display: flex; align-items: center; gap: 10px; width: 100%; max-width: 520px; margin: 0 auto; padding: 0 16px; flex: none;
}
.cs-titles { flex: 1; min-width: 0; }
.cs-title {
  font-size: 34px; line-height: 1; letter-spacing: 0.01em; transform: rotate(-2deg); transform-origin: left center;
  text-shadow: 0 3px 0 var(--ink), 2px 2px 0 var(--ink), -2px 2px 0 var(--ink), 2px -2px 0 var(--ink), -2px -2px 0 var(--ink), 0 6px 12px rgba(10, 30, 60, 0.35);
}
.cs-sub { margin-top: 5px; font-size: 12px; font-weight: 800; letter-spacing: 0.14em; color: var(--ink); }
.cs-coins {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px 6px 10px; border-radius: 16px;
  border: 3px solid var(--ink); background: linear-gradient(180deg, #2c5799, var(--ink));
  box-shadow: 0 3px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.18);
  font-size: 19px; line-height: 1; color: var(--gold); white-space: nowrap;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
}
.cs-coins .ico { font-size: 17px; text-shadow: none; }
.cs-coins.bump { animation: csBump 0.4s cubic-bezier(.2, 1.8, .4, 1); }
@keyframes csBump { 0% { transform: scale(1); } 35% { transform: scale(1.18); } 100% { transform: scale(1); } }
.cs-close {
  flex: none; width: 44px; height: 44px; border-radius: 14px; border: 3px solid var(--ink);
  background: rgba(255, 255, 255, 0.88); color: var(--ink); font-size: 18px; font-weight: 900; line-height: 1;
  box-shadow: 0 3px 0 var(--ink); cursor: pointer; padding: 0;
  transition: transform 0.06s, box-shadow 0.06s;
}
.cs-close:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink); }

/* ---- tabs ---- */
.cs-tabs { display: flex; gap: 8px; width: 100%; margin: 10px 0 8px; padding: 2px 16px 6px; flex: none; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; touch-action: pan-x; box-sizing: border-box; }
.cs-tabs::-webkit-scrollbar { display: none; }
.cs-tab {
  position: relative; flex: none; display: flex; align-items: center; gap: 5px; cursor: pointer; padding: 8px 12px 7px; border-radius: 15px; border: 3px solid var(--ink);
  background: rgba(255, 255, 255, 0.78); color: var(--ink); font-size: 13px; font-weight: 900; letter-spacing: 0.04em; white-space: nowrap;
  box-shadow: 0 4px 0 var(--ink); transition: transform 0.06s, box-shadow 0.06s;
}
.cs-tab .ti { font-size: 15px; line-height: 1; }
.cs-tab .cs-dot { display: none; position: absolute; top: -5px; right: -4px; width: 12px; height: 12px; border-radius: 50%; background: #ff3d6e; border: 2px solid #fff; box-shadow: 0 1px 0 var(--ink); }
.cs-tab.dot .cs-dot { display: block; }
.cs-tab.on {
  background: linear-gradient(180deg, #ff9a52, var(--orange)); color: #fff; text-shadow: 0 2px 0 var(--orange-dark);
  transform: translateY(2px); box-shadow: 0 2px 0 var(--ink);
}

/* ---- scroll area + grid ---- */
.cs-scroll {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; touch-action: pan-y; overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch; padding: 6px 0 calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 28px);
}
.cs-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 14px;
  width: 100%; max-width: 520px; margin: 0 auto; padding: 4px 16px 0;
}
.cs-card {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 14px 8px 12px; border-radius: 22px; border: 3px solid var(--ink);
  background: linear-gradient(180deg, #ffffff, #e2f0ff); box-shadow: 0 5px 0 var(--ink); color: var(--ink);
}
.cs-card.sel {
  background: linear-gradient(180deg, #fff9dc, #ffe9a2);
  box-shadow: 0 5px 0 var(--ink), 0 0 0 4px var(--gold), 0 0 20px 4px rgba(255, 207, 58, 0.55);
}
.cs-card.shake { animation: csShake 0.32s; }
.cs-card.pop { animation: csPop 0.6s cubic-bezier(.2, 1.8, .4, 1); z-index: 2; }
.cs-card.ping { animation: csPing 0.25s ease-out; }
@keyframes csShake { 0%, 100% { transform: none; } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
@keyframes csPop { 0% { transform: scale(0.82) rotate(-4deg); } 40% { transform: scale(1.14) rotate(2.5deg); } 70% { transform: scale(0.97) rotate(-1deg); } 100% { transform: none; } }
@keyframes csPing { 0% { transform: scale(1); } 40% { transform: scale(1.05); } 100% { transform: scale(1); } }
.cs-name { font-size: 15px; line-height: 1.15; text-align: center; letter-spacing: 0.01em; min-height: 34px; display: flex; align-items: center; justify-content: center; overflow-wrap: anywhere; }
.cs-note { margin-top: -4px; font-size: 12px; font-weight: 800; color: #3f5a85; text-align: center; overflow-wrap: anywhere; }
.cs-lockbadge { position: absolute; top: 8px; right: 10px; font-size: 18px; filter: drop-shadow(0 2px 0 rgba(23, 52, 92, 0.4)); }
.cs-flake {
  position: absolute; left: 50%; top: 38%; font-size: 17px; pointer-events: none; z-index: 3;
  animation: csFlake 0.85s ease-out forwards;
}
@keyframes csFlake {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(0.4); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1.15) rotate(200deg); }
}

/* ---- rarity: border + glow colour (--rc / --rg), corner label, legendary shimmer ---- */
.cs-card { --rc: #8e9db3; --rg: rgba(142, 157, 179, 0); border-color: var(--rc); box-shadow: 0 5px 0 var(--ink), 0 0 12px 1px var(--rg); }
.cs-card.r-rare { --rc: #2f7dff; --rg: rgba(47, 125, 255, 0.42); }
.cs-card.r-epic { --rc: #a855f7; --rg: rgba(168, 85, 247, 0.5); }
.cs-card.r-legendary { --rc: #ffb400; --rg: rgba(255, 180, 0, 0.62); }
.cs-card.r-mythic { --rc: #ff4fd8; --rg: rgba(255, 79, 216, 0.72); }
.cs-card.r-mythic .cs-rar { background: linear-gradient(100deg, #ff4fd8, #7a5cff, #3ad0ff, #ff4fd8) 0 0 / 300% 100%; animation: csShimmer 2.2s linear infinite; text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35); }
/* EFFECT BALL cards: a few animated motes over the thumbnail hint what the ball does (rise / fall / orbit / zap) */
.cs-fxb { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.cs-fxb i { position: absolute; width: 7px; height: 7px; margin: -3px 0 0 -3px; border-radius: 50%; background: var(--fc); box-shadow: 0 0 6px 1px var(--fc); left: calc(var(--x) * 1%); bottom: 10%; opacity: 0; animation: csMoteUp 1.4s ease-out infinite; animation-delay: var(--d); }
.cs-fxb.f-fall i { bottom: auto; top: 0; animation-name: csMoteFall; }
.cs-fxb.f-orb i { left: 50%; top: 50%; bottom: auto; opacity: 1; animation: csMoteOrb 2.6s linear infinite; animation-delay: var(--d); }
.cs-fxb.f-zap i { width: 3px; height: 14px; border-radius: 1px; bottom: auto; top: 20%; transform: skewX(-20deg); animation: csMoteZap 0.9s steps(2) infinite; animation-delay: var(--d); }
@keyframes csMoteUp { 0% { opacity: 0; transform: translateY(0) scale(0.6); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(-48px) scale(1.1); } }
@keyframes csMoteFall { 0% { opacity: 0; transform: translateY(-4px); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(54px) rotate(160deg); } }
@keyframes csMoteOrb { from { transform: rotate(0deg) translateX(46px) rotate(0deg); } to { transform: rotate(360deg) translateX(46px) rotate(-360deg); } }
@keyframes csMoteZap { 0%, 45% { opacity: 1; } 50%, 100% { opacity: 0; } }
.cs-card.sel { box-shadow: 0 5px 0 var(--ink), 0 0 0 4px var(--gold), 0 0 20px 4px rgba(255, 207, 58, 0.55); }
.cs-abilbox { display:flex; flex-direction:column; align-items:center; gap:2px; text-align:center; flex:none; max-width:100%; }
.cs-abil-b { display:inline-block; font-size:11px; font-weight:900; letter-spacing:.04em; padding:2px 8px; border-radius:7px; background:linear-gradient(180deg,#ffe27a,#ffb400); color:#2a1a00; border:2px solid var(--ink,#17345c); }
.cs-abil { font-size:11px; font-weight:800; line-height:1.2; color:#5a3a00; }
.cs-abil-lv { display:flex; align-items:center; gap:5px; font-size:11px; font-weight:900; color:#5a3a00; white-space:nowrap; }
.cs-abil-bar { display:inline-block; width:34px; height:6px; border-radius:4px; background:rgba(0,0,0,.18); overflow:hidden; }
.cs-abil-bar i { display:block; height:100%; background:linear-gradient(90deg,#ffb300,#ff7a1a); }
.cs-rar {
  position: absolute; top: 6px; left: 7px; z-index: 2; padding: 3px 7px 3px; border-radius: 8px; pointer-events: none;
  font-size: 11px; line-height: 1; letter-spacing: 0.03em; white-space: nowrap; color: #fff; background: var(--rc);
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.28); box-shadow: 0 2px 0 rgba(23, 52, 92, 0.5);
}
.cs-card.r-legendary .cs-rar {
  color: #4a2f00; text-shadow: none;
  background: linear-gradient(100deg, #ffb400 0%, #ffe27a 24%, #fff8d2 38%, #ffd04a 52%, #ffb400 70%, #ffb400 100%) 0 0 / 260% 100%;
  animation: csShimmer 2.6s linear infinite;
}
@keyframes csShimmer { from { background-position: 100% 0; } to { background-position: -60% 0; } }
.cs-card.r-legendary::after {
  content: ""; position: absolute; inset: 0; z-index: 1; border-radius: 19px; pointer-events: none;
  background: linear-gradient(110deg, rgba(255, 255, 255, 0) 35%, rgba(255, 246, 200, 0.55) 48%, rgba(255, 255, 255, 0) 60%) 0 0 / 280% 100%;
  animation: csSheen 3.4s ease-in-out infinite;
}
@keyframes csSheen { 0% { background-position: 140% 0; } 45%, 100% { background-position: -40% 0; } }

/* ---- buttons ---- */
.cs-btn {
  width: 100%; margin-top: auto; cursor: pointer; padding: 9px 4px 8px; border: 3px solid var(--ink); border-radius: 16px;
  font-size: 15px; font-weight: 900; letter-spacing: 0.03em; color: #fff; white-space: nowrap;
  background: linear-gradient(180deg, #ff9a52, var(--orange)); box-shadow: 0 4px 0 var(--ink); text-shadow: 0 2px 0 var(--orange-dark);
  transition: transform 0.06s, box-shadow 0.06s;
}
.cs-btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
.cs-btn.pick { background: linear-gradient(180deg, #5aa0ff, var(--blue)); text-shadow: 0 2px 0 var(--blue-dark); }
.cs-btn.poor, .cs-btn.lock { background: linear-gradient(180deg, #bcc7d6, #98a7bb); text-shadow: 0 2px 0 #6d7c92; }
.cs-btn.on {
  background: linear-gradient(180deg, #ffe27a, var(--gold)); color: var(--ink); text-shadow: none; cursor: default;
  transform: translateY(3px); box-shadow: 0 1px 0 var(--ink);
}

/* ---- ball previews (pure CSS, driven by --a --b --c) ---- */
.cs-prev { position: relative; flex: none; }
.cs-prev.ball {
  width: 84px; height: 84px; border-radius: 50%; border: 3px solid var(--ink); overflow: hidden;
  box-shadow: 0 4px 0 var(--ink);
}
.cs-prev.ball.over { overflow: visible; }
.cs-prev.ball.glow { box-shadow: 0 4px 0 var(--ink), 0 0 16px 3px var(--b); }
.cs-prev.ball::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background:
    radial-gradient(circle at 30% 26%, rgba(255, 255, 255, 0.8) 0 6%, rgba(255, 255, 255, 0) 26%),
    radial-gradient(circle at 74% 82%, rgba(10, 30, 70, 0.34), rgba(10, 30, 70, 0) 62%);
}
.cs-fill { position: absolute; inset: 0; display: block; border-radius: 50%; overflow: hidden; }
.cs-prev .pt { position: absolute; display: block; }
.p-solid { background: radial-gradient(circle at 34% 30%, var(--a), var(--b) 92%); }
.p-stripes {
  background:
    radial-gradient(circle at 26% 62%, var(--c, transparent) 0 3px, transparent 4px),
    radial-gradient(circle at 64% 26%, var(--c, transparent) 0 3px, transparent 4px),
    radial-gradient(circle at 74% 70%, var(--c, transparent) 0 3px, transparent 4px),
    radial-gradient(circle at 40% 82%, var(--c, transparent) 0 2.5px, transparent 3.5px),
    repeating-linear-gradient(72deg, var(--a) 0 9px, var(--b) 9px 15px);
}
.p-dots { background: radial-gradient(var(--b) 3.5px, transparent 4.5px) 0 0 / 16px 16px, var(--a); }
.p-blotch {
  background:
    radial-gradient(ellipse 12px 8px at 30% 30%, var(--b) 0 96%, transparent 100%),
    radial-gradient(ellipse 8px 12px at 66% 24%, var(--b) 0 96%, transparent 100%),
    radial-gradient(ellipse 14px 9px at 70% 62%, var(--b) 0 96%, transparent 100%),
    radial-gradient(ellipse 17px 12px at 70% 62%, var(--c, transparent) 0 96%, transparent 100%),
    radial-gradient(ellipse 9px 8px at 34% 72%, var(--b) 0 96%, transparent 100%),
    radial-gradient(ellipse 12px 11px at 34% 72%, var(--c, transparent) 0 96%, transparent 100%),
    radial-gradient(ellipse 6px 6px at 50% 50%, var(--b) 0 96%, transparent 100%),
    var(--a);
}
.cs-newtag { position: absolute; top: 6px; right: 7px; z-index: 3; padding: 3px 7px 3px; border-radius: 8px; pointer-events: none; font-size: 11px; line-height: 1; letter-spacing: 0.03em; white-space: nowrap; color: #fff; background: #ff3d6e; box-shadow: 0 2px 0 rgba(23, 52, 92, 0.5); }
.p-swirl {
  background:
    radial-gradient(circle, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 62%),
    conic-gradient(from 30deg at 50% 50%, var(--a), var(--b), var(--a), var(--b), var(--a));
}
.p-facets {
  background:
    linear-gradient(115deg, rgba(255, 255, 255, 0) 0 38%, rgba(255, 255, 255, 0.5) 38% 52%, rgba(255, 255, 255, 0) 52%),
    linear-gradient(200deg, rgba(255, 255, 255, 0) 0 60%, rgba(255, 255, 255, 0.32) 60% 70%, rgba(255, 255, 255, 0) 70%),
    linear-gradient(35deg, rgba(0, 50, 110, 0) 0 52%, rgba(0, 50, 110, 0.24) 52% 100%),
    linear-gradient(150deg, var(--a), var(--b));
}
.p-tiles {
  background:
    linear-gradient(rgba(23, 52, 92, 0.6) 2px, transparent 2px) 0 0 / 14px 14px,
    linear-gradient(90deg, rgba(23, 52, 92, 0.6) 2px, transparent 2px) 0 0 / 14px 14px,
    conic-gradient(from 0deg at 50% 50%, var(--c, #ff6ad5), var(--a), var(--b), var(--a), var(--c, #ff6ad5), var(--a), var(--b), var(--a), var(--c, #ff6ad5));
  animation: csHue 2.6s linear infinite;
}
@keyframes csHue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }
.p-cracks {
  background:
    linear-gradient(112deg, transparent 0 36%, var(--b) 36% 40%, transparent 40% 100%),
    linear-gradient(28deg, transparent 0 55%, var(--b) 55% 58.5%, transparent 58.5% 100%),
    linear-gradient(160deg, transparent 0 18%, var(--b) 18% 21%, transparent 21% 100%),
    radial-gradient(circle at 34% 30%, #54495c, var(--a) 85%);
  animation: csPulse 1.8s ease-in-out infinite;
}
@keyframes csPulse { 0%, 100% { filter: brightness(0.95); } 50% { filter: brightness(1.3); } }
.p-eye {
  background:
    radial-gradient(circle at 48% 46%, #0a0a16 0 11%, var(--b) 12% 29%, var(--c, #fff) 30% 47%, var(--a) 48%);
}
.p-globe {
  background:
    linear-gradient(180deg, var(--c, #fff) 0 13%, transparent 13% 87%, var(--c, #fff) 87%),
    radial-gradient(ellipse 22px 15px at 30% 40%, var(--b) 0 70%, transparent 72%),
    radial-gradient(ellipse 14px 20px at 64% 60%, var(--b) 0 70%, transparent 72%),
    radial-gradient(ellipse 10px 8px at 70% 26%, var(--b) 0 70%, transparent 72%),
    radial-gradient(circle at 34% 30%, var(--a), var(--a));
}
.p-face { background: radial-gradient(circle at 34% 30%, var(--a), var(--b) 92%); }
.p-face i { position: absolute; display: block; }
.p-face .eye { width: 9px; height: 9px; border-radius: 50%; background: #16161d; top: 33%; }
.p-face .e1 { left: 29%; }
.p-face .e2 { left: 59%; }
.p-face .nose { left: 45%; top: 46%; width: 11px; height: 11px; border-radius: 50% 50% 50% 50% / 35% 35% 65% 65%; background: radial-gradient(circle at 40% 30%, #ffa04a, var(--c, #ff7a1a)); }
.p-face .mouth { left: 28%; top: 60%; width: 31px; height: 12px; border-bottom: 3.5px dotted #16161d; border-radius: 0 0 50% 50%; }

/* ---- wave 2 ball previews ---- */
/* goo tendrils (Kara Sıvı / Kızıl Kaos) */
.p-tendrils {
  background:
    radial-gradient(circle at 30% 26%, rgba(255, 255, 255, 0.4) 0 5%, rgba(255, 255, 255, 0) 20%),
    radial-gradient(circle at 36% 32%, var(--a), var(--b) 95%);
}
.cs-prev .td {
  left: 50%; top: 50%; width: 9px; height: var(--h); margin: calc(var(--h) / -2) 0 0 -4.5px; box-sizing: border-box;
  border-radius: 6px 6px 7px 7px; background: var(--b); border: 2px solid var(--ink);
  transform: rotate(var(--r)) translateY(calc(-30px - var(--h) / 2));
  animation: csWob 1.7s ease-in-out infinite; animation-delay: var(--d);
}
@keyframes csWob {
  0%, 100% { transform: rotate(var(--r)) translateY(calc(-30px - var(--h) / 2)) scaleX(1); }
  50% { transform: rotate(calc(var(--r) + 12deg)) translateY(calc(-33px - var(--h) / 2)) scaleX(1.25); }
}
/* flames (Ateş Topu) */
.p-flame { background: radial-gradient(circle at 42% 38%, #fff3a0 0 12%, var(--a) 40%, var(--c, #ffb000) 70%, #ff5a10 100%); }
.cs-prev .fl {
  left: 50%; top: 50%; width: 17px; height: var(--h); margin: calc(var(--h) / -2) 0 0 -8.5px;
  background: linear-gradient(0deg, var(--a), var(--b)); clip-path: polygon(50% 0, 100% 60%, 82% 100%, 18% 100%, 0 60%);
  transform: rotate(var(--r)) translateY(calc(-30px - var(--h) / 2));
  animation: csFlick 0.55s ease-in-out infinite alternate; animation-delay: var(--d);
}
@keyframes csFlick {
  from { transform: rotate(var(--r)) translateY(calc(-30px - var(--h) / 2)) scale(0.9, 0.82); }
  to { transform: rotate(calc(var(--r) + 7deg)) translateY(calc(-32px - var(--h) / 2)) scale(1.08, 1.18); }
}
/* toxic goo with bubbles (Zehir) */
.p-goo {
  background:
    radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.75) 0 4%, rgba(255, 255, 255, 0) 20%),
    radial-gradient(circle at 28% 68%, var(--c) 0 4px, rgba(255, 255, 255, 0.7) 4.5px 5.5px, transparent 6px),
    radial-gradient(circle at 72% 62%, var(--c) 0 3px, rgba(255, 255, 255, 0.7) 3.5px 4.5px, transparent 5px),
    radial-gradient(circle at 62% 22%, var(--c) 0 2.5px, rgba(255, 255, 255, 0.7) 3px 4px, transparent 4.5px),
    radial-gradient(circle at 36% 30%, var(--a), var(--b) 92%);
  animation: csGoo 1.8s ease-in-out infinite;
}
@keyframes csGoo { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.18) saturate(1.2); } }
.cs-prev .gb {
  left: var(--x); top: var(--y); width: var(--w); height: var(--w); box-sizing: border-box; border-radius: 50%;
  border: 2px solid var(--ink); background: radial-gradient(circle at 35% 30%, #fff, var(--c) 45%, var(--a));
  animation: csBub 1.9s ease-in-out infinite; animation-delay: var(--d);
}
@keyframes csBub { 0%, 100% { transform: scale(0.75); opacity: 1; } 70% { transform: scale(1.1); opacity: 1; } 88% { transform: scale(1.3); opacity: 0.55; } }
/* plasma arcs (Plazma) */
.p-plasma {
  background:
    radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.5) 0 5%, rgba(255, 255, 255, 0) 22%),
    radial-gradient(circle at 50% 50%, var(--b), var(--a) 88%);
}
.cs-prev .bolt {
  left: 30%; top: 4%; width: 30%; height: 92%; background: var(--c);
  clip-path: polygon(47% 0, 55% 25%, 41% 50%, 57% 75%, 43% 100%, 49% 100%, 63% 75%, 47% 50%, 61% 25%, 53% 0);
  transform: rotate(var(--r)); filter: drop-shadow(0 0 3px var(--c)); animation: csZap 1.1s steps(1) infinite; animation-delay: var(--d);
}
@keyframes csZap { 0%, 100% { opacity: 1; } 18% { opacity: 0.15; } 30% { opacity: 1; } 62% { opacity: 0; } 70% { opacity: 1; } }
/* night sky (Galaksi) */
.p-stars {
  background:
    radial-gradient(circle at 20% 30%, #fff 0 1.2px, transparent 1.8px),
    radial-gradient(circle at 72% 20%, #fff 0 1.5px, transparent 2.2px),
    radial-gradient(circle at 30% 78%, #ffe9a8 0 1.3px, transparent 2px),
    radial-gradient(circle at 86% 56%, #fff 0 1.2px, transparent 1.8px),
    radial-gradient(circle at 56% 40%, #cfe3ff 0 1.1px, transparent 1.7px),
    radial-gradient(ellipse at 28% 72%, rgba(210, 60, 170, 0.75), transparent 55%),
    radial-gradient(ellipse at 76% 34%, rgba(40, 150, 230, 0.65), transparent 55%),
    radial-gradient(circle at 50% 50%, var(--b), var(--a) 90%);
}
.p-stars::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  background:
    radial-gradient(circle at 45% 58%, #fff 0 1.7px, transparent 2.4px),
    radial-gradient(circle at 80% 72%, #fff 0 1.5px, transparent 2.1px),
    radial-gradient(circle at 14% 60%, #ffe9a8 0 1.5px, transparent 2.1px),
    radial-gradient(circle at 58% 12%, #cfe3ff 0 1.5px, transparent 2.1px);
  animation: csTwinkle 1.3s ease-in-out infinite alternate;
}
@keyframes csTwinkle { from { opacity: 0.15; } to { opacity: 1; } }
/* ice dragon scales (Buz Ejderi) */
.p-scales {
  background:
    radial-gradient(circle at 30% 26%, rgba(255, 255, 255, 0.7) 0 5%, rgba(255, 255, 255, 0) 22%),
    radial-gradient(circle at 50% 100%, var(--a) 0 36%, var(--b) 38% 44%, transparent 46%) 11px 8px / 22px 16px,
    radial-gradient(circle at 50% 100%, var(--a) 0 36%, var(--b) 38% 44%, transparent 46%) 0 0 / 22px 16px,
    var(--b);
}
.cs-prev .dgs {
  top: -9px; width: 9px; height: 14px; margin-left: -4px; left: var(--x); background: var(--c);
  clip-path: polygon(50% 0, 100% 100%, 0 100%); transform: rotate(var(--r));
}
.cs-prev .dge {
  left: 52%; top: 30%; width: 22px; height: 12px; border-radius: 50%; box-shadow: 0 0 0 2px #06203f, 0 0 8px 1px var(--c);
  background: linear-gradient(90deg, transparent 46%, #04101c 46% 54%, transparent 54%), radial-gradient(ellipse, #fff, #7fe4ff);
}
/* robot panels (Robo-Top) */
.p-panels {
  background:
    linear-gradient(90deg, rgba(36, 42, 56, 0.9) 0 2px, transparent 2px) 13px 0 / 26px 100%,
    linear-gradient(rgba(36, 42, 56, 0.9) 0 2px, transparent 2px) 0 11px / 100% 28px,
    radial-gradient(circle at 34% 30%, var(--a), var(--b) 95%);
}
.cs-prev .rv {
  left: -2px; right: -2px; top: 30%; height: 19px; box-sizing: border-box; overflow: hidden; background: #07161d;
  border-top: 2px solid #0a1018; border-bottom: 2px solid #0a1018;
}
.cs-prev .rv::after {
  content: ""; position: absolute; top: 3px; bottom: 3px; left: 0; width: 32%; border-radius: 3px;
  background: linear-gradient(90deg, rgba(53, 230, 255, 0.15), var(--c), rgba(53, 230, 255, 0.15)); animation: csScan 1.6s ease-in-out infinite alternate;
}
@keyframes csScan { from { transform: translateX(8%); } to { transform: translateX(200%); } }
.cs-prev .ran { left: 50%; top: -14px; width: 3px; height: 16px; margin-left: -1.5px; background: #6a7384; }
.cs-prev .ran::after {
  content: ""; position: absolute; left: -2.5px; top: -5px; width: 8px; height: 8px; border-radius: 50%;
  background: #ff3a2a; box-shadow: 0 0 6px #ff3a2a; animation: csBlink 1s steps(2) infinite;
}
@keyframes csBlink { 50% { opacity: 0.25; } }
/* hedgehog (Kirpi) */
.p-quills {
  background:
    radial-gradient(circle at 34% 30%, rgba(255, 255, 255, 0.2), transparent 40%),
    radial-gradient(circle at 50% 50%, var(--a), var(--b) 100%);
}
.cs-prev .qu {
  left: 50%; top: 50%; width: 9px; height: var(--h); margin: calc(var(--h) / -2) 0 0 -4.5px;
  background: linear-gradient(0deg, var(--b), var(--a) 55%, var(--b)); clip-path: polygon(50% 0, 100% 100%, 0 100%);
  transform: rotate(var(--r)) translateY(calc(-32px - var(--h) / 2));
}
.cs-prev .kear { top: -4px; width: 18px; height: 18px; box-sizing: border-box; border-radius: 50%; background: var(--a); border: 2px solid var(--ink); }
.cs-prev .kf {
  left: 26%; top: 34%; width: 48%; height: 54%; border-radius: 50% 50% 46% 46%;
  background: radial-gradient(circle at 50% 35%, #fff3dc, var(--c) 75%);
}
.cs-prev .ke { top: 48%; width: 7px; height: 7px; border-radius: 50%; background: #16161d; }
.cs-prev .kn { left: 45%; top: 64%; width: 9px; height: 8px; border-radius: 50%; background: #16161d; }
/* octopus (Ahtapot) */
.p-octo { background: radial-gradient(circle at 34% 30%, #d58af7, var(--a) 45%, var(--b) 100%); }
.cs-prev .oc {
  left: 50%; top: 50%; width: 11px; height: var(--h); margin: calc(var(--h) / -2) 0 0 -5.5px; box-sizing: border-box;
  border-radius: 6px; background: var(--a); border: 2px solid var(--ink);
  transform: rotate(var(--r)) translateY(calc(-30px - var(--h) / 2));
  animation: csWob 2.1s ease-in-out infinite; animation-delay: var(--d);
}
.cs-prev .oe { top: 24%; width: 24px; height: 24px; border-radius: 50%; background: radial-gradient(circle at 40% 58%, #140a24 0 4px, #fff 4.5px); box-shadow: 0 0 0 1.5px rgba(23, 52, 92, 0.5); }
/* pumpkin (Balkabağı) */
.p-pumpkin { background: repeating-linear-gradient(90deg, var(--b) 0, var(--a) 5px, var(--b) 11px); }
.cs-prev .pst {
  left: 50%; top: -9px; width: 10px; height: 14px; margin-left: -4px; box-sizing: border-box; border: 2px solid var(--ink);
  border-radius: 3px 3px 1px 1px; background: linear-gradient(#8a6a2a, #5d7a22); transform: rotate(8deg);
}
.cs-prev .pe { width: 15px; height: 13px; background: var(--c); clip-path: polygon(50% 0, 100% 100%, 0 100%); animation: csGlowF 1.3s ease-in-out infinite alternate; }
.cs-prev .pn { left: 46%; top: 50%; width: 8px; height: 7px; background: var(--c); clip-path: polygon(50% 0, 100% 100%, 0 100%); animation: csGlowF 1.1s ease-in-out infinite alternate; }
.cs-prev .pm {
  left: 22%; top: 60%; width: 56%; height: 22%; background: var(--c); animation: csGlowF 1.5s ease-in-out infinite alternate;
  clip-path: polygon(0 20%, 12% 0, 25% 25%, 38% 0, 50% 25%, 62% 0, 75% 25%, 88% 0, 100% 20%, 100% 55%, 85% 85%, 50% 100%, 15% 85%, 0 55%);
}
@keyframes csGlowF { from { filter: brightness(0.82); } to { filter: brightness(1.28); } }
/* zombie head (Zombi Kafa) */
.p-zombie { background: radial-gradient(circle at 34% 30%, var(--a), var(--b) 95%); }
.cs-prev .ze1 { left: 17%; top: 32%; width: 22px; height: 22px; border-radius: 50%; background: radial-gradient(circle at 50% 50%, #15100e 0 2.5px, #c23a2a 3px 6px, #f2f0d8 6.5px); box-shadow: 0 0 0 1.5px rgba(23, 52, 92, 0.45); }
.cs-prev .ze2 { left: 56%; top: 36%; width: 16px; height: 15px; border-radius: 50%; background: radial-gradient(circle at 50% 50%, #f0e060 0 2px, #1a2a1c 2.5px); }
.cs-prev .zs { left: 14%; top: 20%; width: 72%; height: 4px; background: #4a2c4a; border-radius: 2px; transform: rotate(-7deg); }
.cs-prev .zs::after { content: ""; position: absolute; left: 0; right: 0; top: -4px; height: 12px; background: repeating-linear-gradient(90deg, #2a1a2e 0 2px, transparent 2px 8px); }
.cs-prev .zm { left: 26%; top: 68%; width: 48%; height: 6px; background: #24121c; border-radius: 3px; }
.cs-prev .zm::after { content: ""; position: absolute; left: 0; right: 0; top: -4px; height: 14px; background: repeating-linear-gradient(90deg, #d8cfa0 0 2px, transparent 2px 8px); }
/* football */
.p-pentagon { background: radial-gradient(circle at 34% 30%, #ffffff, #dde2ea 95%); }
.cs-prev .pg { width: 27px; height: 26px; left: calc(50% - 13.5px); top: calc(48% - 13px); background: var(--b); clip-path: polygon(50% 0, 100% 38%, 81% 100%, 19% 100%, 0 38%); }
.cs-prev .pg.o { transform: rotate(var(--r)) translateY(-37px) rotate(180deg); }
/* basketball */
.p-seams {
  background:
    linear-gradient(90deg, transparent calc(50% - 1.5px), var(--c) calc(50% - 1.5px) calc(50% + 1.5px), transparent calc(50% + 1.5px)),
    linear-gradient(transparent calc(50% - 1.5px), var(--c) calc(50% - 1.5px) calc(50% + 1.5px), transparent calc(50% + 1.5px)),
    radial-gradient(circle 108px at 150% 50%, transparent 0 103px, var(--c) 103px 106px, transparent 106px),
    radial-gradient(circle 108px at -50% 50%, transparent 0 103px, var(--c) 103px 106px, transparent 106px),
    radial-gradient(circle at 34% 30%, var(--a), var(--b) 95%);
}
/* bowling */
.p-bowl { background: conic-gradient(from 20deg at 45% 55%, var(--b), var(--a), var(--c), var(--a), var(--b), #000, var(--b)); }
.cs-prev .bh { left: var(--x); top: var(--y); width: 10px; height: 10px; border-radius: 50%; background: #05030c; box-shadow: 0 1px 0 rgba(255, 255, 255, 0.3); }
/* tennis */
.p-tennis {
  background:
    radial-gradient(circle 60px at -40% 50%, transparent 0 51px, var(--c) 51px 55px, transparent 55px),
    radial-gradient(circle 60px at 140% 50%, transparent 0 51px, var(--c) 51px 55px, transparent 55px),
    radial-gradient(circle at 34% 30%, var(--a), var(--b) 95%);
}
/* simit */
.p-sesame {
  background:
    radial-gradient(ellipse 3px 1.6px at 30% 40%, var(--c) 90%, transparent) 0 0 / 19px 15px,
    radial-gradient(ellipse 3px 1.6px at 70% 70%, var(--c) 90%, transparent) 3px 5px / 23px 17px,
    radial-gradient(ellipse 3px 1.6px at 50% 20%, var(--c) 90%, transparent) 7px 2px / 14px 21px,
    repeating-linear-gradient(60deg, var(--a) 0 11px, var(--b) 11px 15px);
}
/* baklava */
.p-baklava {
  background:
    radial-gradient(circle at 20% 30%, var(--c) 0 2.5px, transparent 3px) 0 0 / 17px 17px,
    radial-gradient(circle at 70% 70%, var(--c) 0 2px, transparent 2.5px) 5px 7px / 23px 23px,
    linear-gradient(45deg, transparent calc(50% - 1.5px), #7a410c calc(50% - 1.5px) calc(50% + 1.5px), transparent calc(50% + 1.5px)) 0 0 / 16px 16px,
    linear-gradient(-45deg, transparent calc(50% - 1.5px), #7a410c calc(50% - 1.5px) calc(50% + 1.5px), transparent calc(50% + 1.5px)) 0 0 / 16px 16px,
    radial-gradient(circle at 34% 30%, #ffd870, var(--a) 60%, #c4781a);
}
/* Iznik tile (İznik Çinisi) */
.p-tile {
  background:
    radial-gradient(circle at 50% 50%, var(--c) 0 4px, #fff 4.5px 6px, transparent 6.5px),
    radial-gradient(circle at 50% 15%, var(--c) 0 3.5px, var(--a) 4px 6px, transparent 6.5px),
    radial-gradient(circle at 50% 85%, var(--c) 0 3.5px, var(--a) 4px 6px, transparent 6.5px),
    radial-gradient(circle at 15% 50%, var(--c) 0 3.5px, var(--a) 4px 6px, transparent 6.5px),
    radial-gradient(circle at 85% 50%, var(--c) 0 3.5px, var(--a) 4px 6px, transparent 6.5px),
    radial-gradient(circle at 50% 50%, transparent 0 27px, var(--b) 28px 30px, transparent 31px 33px, var(--a) 34px 36px, transparent 37px),
    radial-gradient(circle at 50% 50%, transparent 0 25px, #f7f4ec 26px),
    repeating-conic-gradient(from 34deg at 50% 50%, var(--a) 0 22deg, transparent 22deg 90deg),
    repeating-conic-gradient(from -11deg at 50% 50%, var(--b) 0 22deg, transparent 22deg 90deg),
    #f7f4ec;
}
/* kilim (Kilim) */
.p-kilim {
  background:
    linear-gradient(180deg, var(--a) 0 11%, transparent 11% 89%, var(--a) 89%),
    linear-gradient(135deg, var(--c) 25%, transparent 25%) -9px 0 / 18px 18px,
    linear-gradient(225deg, var(--c) 25%, transparent 25%) -9px 0 / 18px 18px,
    linear-gradient(315deg, var(--c) 25%, transparent 25%) 0 0 / 18px 18px,
    linear-gradient(45deg, var(--c) 25%, transparent 25%) 0 0 / 18px 18px,
    var(--b);
}
/* donut */
.p-donut { background: radial-gradient(circle at 34% 30%, #efb878, var(--b) 90%); }
.cs-prev .dfr { inset: 7px; border-radius: 48% 52% 50% 50% / 52% 48% 52% 48%; background: radial-gradient(circle at 36% 30%, #ffc0de, var(--a) 70%); }
.cs-prev .dho { left: 50%; top: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--ink); background: #bcdcff; box-shadow: inset 0 3px 0 rgba(23, 52, 92, 0.3); }
.cs-prev .dsp { left: var(--x); top: var(--y); width: 8px; height: 3px; border-radius: 2px; background: var(--k); transform: rotate(var(--r)); }
/* cookie */
.p-cookie { background: radial-gradient(circle at 34% 30%, #f6d28f, var(--a) 60%, #b97f36 100%); }
.cs-prev .ck { left: var(--x); top: var(--y); width: var(--w); height: calc(var(--w) * 0.78); border-radius: 45% 55% 50% 50%; background: var(--b); transform: rotate(var(--r)); }
/* fluffy pet (Ponçik) */
.p-fluff { background: radial-gradient(circle at 34% 30%, #fff, var(--a) 42%, var(--b) 100%); }
.cs-prev .pear { top: -7px; width: 20px; height: 22px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--ink); background: radial-gradient(circle at 50% 62%, #ff9fc2 0 35%, var(--b) 36%); }
.cs-prev .fe { top: 42%; width: 7px; height: 9px; border-radius: 50%; background: var(--c); }
.cs-prev .fc { top: 56%; width: 12px; height: 8px; border-radius: 50%; background: #ff8fb8; opacity: 0.75; }
.cs-prev .fn { left: 46%; top: 56%; width: 6px; height: 5px; border-radius: 50%; background: #d9507f; }
/* penguin (Penguen Top) */
.p-penguin { background: radial-gradient(circle at 34% 30%, #3b5488, var(--a) 90%); }
.cs-prev .pbe { left: 22%; top: 36%; width: 56%; height: 62%; border-radius: 50%; background: radial-gradient(circle at 40% 30%, #fff, var(--b)); }
.cs-prev .pey { top: 32%; width: 8px; height: 8px; border-radius: 50%; background: radial-gradient(circle at 65% 30%, #fff 0 1.4px, #0c0c12 2px); }
.cs-prev .pbk { left: 43%; top: 44%; width: 14px; height: 9px; background: var(--c); clip-path: polygon(0 0, 100% 0, 50% 100%); }
.cs-prev .pfl { top: 40%; width: 12px; height: 28px; border-radius: 50%; background: #16233d; border: 2px solid var(--ink); box-sizing: border-box; }
.cs-prev .pft { bottom: -6px; width: 17px; height: 9px; border-radius: 50%; background: var(--c); border: 2px solid var(--ink); box-sizing: border-box; }
/* hidden (secret) items: dark silhouette + question mark */
.cs-q {
  position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; pointer-events: none;
  font-size: 40px; color: rgba(255, 255, 255, 0.92); text-shadow: 0 3px 0 rgba(0, 0, 0, 0.35);
}
.cs-prev.trail .cs-q { font-size: 30px; }

/* ---- trail previews: ribbon + little snowball ---- */
.cs-prev.trail { width: 100%; height: 84px; }
.cs-prev.trail .rib {
  position: absolute; left: 4px; right: 38px; top: 50%; height: 30px; margin-top: -15px;
  border-radius: 18px 8px 8px 18px; border: 2.5px solid var(--ink);
  background: linear-gradient(270deg, var(--a), var(--b));
  -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.12), #000 45%); mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.12), #000 45%);
}
.cs-prev.trail.glow { filter: drop-shadow(0 0 7px var(--a)); }
.cs-prev.trail.swirl .rib {
  background: linear-gradient(180deg, #ff4d4d 0 16.6%, #ffb347 16.6% 33.3%, #ffe14a 33.3% 50%, #5fe08a 50% 66.6%, #3fb7ff 66.6% 83.3%, #8a6bff 83.3%);
}
.cs-prev.trail.bands .rib { background: repeating-linear-gradient(90deg, var(--a) 0 14px, var(--b) 14px 28px); }
.cs-prev.trail .head {
  position: absolute; right: 3px; top: 50%; width: 42px; height: 42px; margin-top: -21px; border-radius: 50%;
  border: 3px solid var(--ink); background: radial-gradient(circle at 34% 30%, #fff, #cfe2f7 92%); box-shadow: 0 3px 0 var(--ink);
}
.cs-card.locked .cs-prev { filter: grayscale(0.85) brightness(0.92); }

/* ---- next goal strip ---- */
.cs-goal { width: 100%; max-width: 520px; margin: -4px auto 8px; padding: 0 16px; flex: none; }
.cs-goal .gi {
  display: flex; flex-direction: column; gap: 4px; padding: 7px 12px 8px; border-radius: 14px; border: 3px solid var(--ink); background: linear-gradient(180deg, #2c5799, var(--ink));
  box-shadow: 0 3px 0 var(--ink); color: #fff;
}
.cs-goal .gt { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; letter-spacing: 0.02em; text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4); }
.cs-goal .gt b { color: var(--gold); font-weight: 900; }
.cs-goal .gb { height: 9px; border-radius: 5px; background: rgba(255, 255, 255, 0.2); overflow: hidden; }
.cs-goal .gb i { display: block; height: 100%; background: linear-gradient(90deg, #ffe066, #ff9a3a); }
.cs-goal.ready .gb i { background: linear-gradient(90deg, #8dff9a, #2fc13f); }

/* ---- power tab: upgrade rows ---- */
.cs-list { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 520px; margin: 0 auto; padding: 4px 16px 0; }
.cs-vit { color: #b36200; font-weight: bold; }
.cs-sec { margin: 6px 2px -4px; font-size: 13px; letter-spacing: 0.14em; color: var(--ink); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55); }
.cs-up {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 20px; border: 3px solid var(--ink);
  background: linear-gradient(180deg, #ffffff, #e2f0ff); box-shadow: 0 5px 0 var(--ink); color: var(--ink);
}
.cs-up.shake { animation: csShake 0.32s; }
.cs-up .ui { flex: none; width: 46px; height: 46px; display: grid; place-items: center; font-size: 25px; line-height: 1; border-radius: 15px; background: rgba(23, 52, 92, 0.1); border: 2.5px solid var(--ink); }
.cs-up .um { flex: 1; min-width: 0; }
.cs-up .un { font-size: 16px; line-height: 1.15; }
.cs-up .ud { margin-top: 2px; font-size: 12.5px; color: #5a7196; line-height: 1.25; font-weight: 800; }
.cs-up .up { display: flex; gap: 4px; margin-top: 5px; }
.cs-up .up i { width: 18px; height: 8px; border-radius: 4px; background: rgba(23, 52, 92, 0.18); border: 2px solid var(--ink); }
.cs-up .up i.on { background: linear-gradient(180deg, #8dff9a, #2fc13f); }
.cs-up .cs-btn { width: auto; min-width: 84px; margin-top: 0; flex: none; padding: 9px 10px 8px; }

/* ---- wardrobe v2: 3D stage, collection line, filters, equal cards, effect-kind previews, daily offer / bundles ---- */
.cs-grid { grid-auto-rows: 1fr; }
.cs-card { min-height: 190px; }
.cs-card.pv { outline: 3px dashed var(--ink); outline-offset: 2px; }
.cs-empty { grid-column: 1 / -1; text-align: center; color: var(--ink); font-size: 15px; padding: 24px 0; }
.cs-view { position: relative; width: calc(100% - 32px); max-width: 488px; height: 178px; margin: 0 auto 6px; flex: none; border-radius: 22px; border: 3px solid var(--ink); overflow: hidden;
  background: radial-gradient(ellipse at 50% 78%, #9fcdff 0%, #4a86d8 62%, #1f4f9a 100%); box-shadow: 0 4px 0 var(--ink); }
.cs-view.hidden, .cs-coll.hidden, .cs-filt.hidden, .cs-goal.hidden { display: none; }
.cs-stagecv { position: absolute; inset: 0; }
.cs-cv { display: block; width: 100% !important; height: 100% !important; }
.cs-view.nogl .cs-stagecv::after { content: "🎈"; position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); font-size: 54px; }
.cs-vinfo { position: absolute; left: 0; right: 0; bottom: 0; padding: 6px 10px 8px; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; pointer-events: none; }
.cs-vtop { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
.cs-vabil { max-width: 132px; padding: 4px 7px; border-radius: 9px; background: rgba(255, 244, 200, 0.94); color: #5a3a00; font-size: 11px; font-weight: 800; line-height: 1.25; }
.cs-vabil:empty { display: none; }
.cs-abil-star { position: absolute; top: 6px; right: 8px; z-index: 2; font-size: 17px; color: #ffb400; text-shadow: 0 1px 0 var(--ink), 1px 0 0 var(--ink), -1px 0 0 var(--ink), 0 -1px 0 var(--ink); }
.cs-vname { max-width: 190px; font-size: 17px; line-height: 1.1; color: #fff; overflow-wrap: anywhere; text-shadow: 0 2px 0 var(--ink), 2px 0 0 var(--ink), -2px 0 0 var(--ink), 0 -2px 0 var(--ink); }
.cs-vrar { padding: 3px 8px; border-radius: 8px; font-size: 11px; line-height: 1; color: #fff; background: #8e9db3; box-shadow: 0 2px 0 rgba(23, 52, 92, 0.5); }
.cs-vrar.r-rare { background: #2f7dff; } .cs-vrar.r-epic { background: #a855f7; } .cs-vrar.r-legendary { background: #ffb400; color: #4a2f00; } .cs-vrar.r-mythic { background: linear-gradient(100deg, #ff4fd8, #7a5cff); }
.cs-vbtns { display: flex; gap: 6px; pointer-events: auto; }
.cs-vb { cursor: pointer; padding: 8px 12px 7px; border-radius: 14px; border: 3px solid var(--ink); font-size: 14px; font-weight: 900; color: #fff; white-space: nowrap; box-shadow: 0 3px 0 var(--ink);
  background: linear-gradient(180deg, #ff9a52, var(--orange)); text-shadow: 0 2px 0 var(--orange-dark); }
.cs-vb:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink); }
.cs-vb.dene { background: linear-gradient(180deg, #7be07b, #2fb04a); text-shadow: 0 2px 0 #1b7a2f; min-width: 52px; }
.cs-vb.dene.busy { background: linear-gradient(180deg, #bcc7d6, #98a7bb); text-shadow: none; color: var(--ink); }
.cs-vb.buy.pick { background: linear-gradient(180deg, #5aa0ff, var(--blue)); text-shadow: 0 2px 0 var(--blue-dark); }
.cs-vb.buy.poor, .cs-vb.buy.lock { background: linear-gradient(180deg, #bcc7d6, #98a7bb); text-shadow: 0 2px 0 #6d7c92; }
.cs-vb.buy.on { background: linear-gradient(180deg, #ffe27a, var(--gold)); color: var(--ink); text-shadow: none; }
.cs-coll { width: 100%; max-width: 520px; margin: 0 auto; padding: 2px 16px 0; flex: none; box-sizing: border-box; }
.cs-collt { font-size: 13px; letter-spacing: 0.03em; color: var(--ink); }
.cs-collb { height: 7px; margin-top: 3px; border-radius: 4px; background: rgba(23, 52, 92, 0.2); overflow: hidden; }
.cs-collb i { display: block; height: 100%; background: linear-gradient(90deg, #ffe066, #ff9a3a); }
.cs-filt { display: flex; gap: 6px; width: 100%; max-width: 520px; margin: 6px auto 4px; padding: 0 16px; flex: none; box-sizing: border-box; overflow-x: auto; scrollbar-width: none; }
.cs-chip { flex: none; cursor: pointer; padding: 6px 11px 5px; border-radius: 12px; border: 2px solid var(--ink); background: rgba(255, 255, 255, 0.75); color: var(--ink); font-size: 12px; font-weight: 900; letter-spacing: 0.03em; white-space: nowrap; }
.cs-chip.on { background: var(--ink); color: #fff; }
.cs-prev.fxp { width: 84px; height: 84px; border-radius: 24px; border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--ink); display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 34% 28%, var(--a), var(--b) 96%); }
.cs-prev.fxp.glow { box-shadow: 0 4px 0 var(--ink), 0 0 16px 3px var(--b); }
.cs-prev.fxp .fg { font-style: normal; font-size: 40px; line-height: 1; color: #fff; text-shadow: 0 2px 0 var(--ink), 2px 0 0 var(--ink), -2px 0 0 var(--ink); }
.cs-up .ui.mini { position: relative; width: 48px; height: 48px; flex: none; font-size: 0; }
.cs-up .ui.mini .cs-prev { position: absolute; left: 0; top: 0; transform: scale(0.55); transform-origin: top left; }
.cs-up .ui.set { display: flex; flex-wrap: wrap; gap: 2px; width: 100px; font-size: 0; flex: none; }
.cs-up .ui.set .ui.mini { width: 24px; height: 24px; }
.cs-up .ui.set .ui.mini .cs-prev { transform: scale(0.27); }
.cs-sec .cs-left { margin-left: 8px; font-size: 13px; color: var(--ink); white-space: nowrap; }
/* result-screen emote preview inside the stage */
.cs-stagecv .rx-emote { top: 12px; right: 14px; }
@media (prefers-reduced-motion: reduce) {
  .cs-root *, .cs-root *::before, .cs-root *::after, .cs-root { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
`;

const fmt = (n) => String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, getLang() === 'en' ? ',' : '.');

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function sfx() {
  try { if (typeof window !== 'undefined') window.__cigSfx?.ui?.(); } catch { /* audio is optional */ }
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  (document.head || document.body).appendChild(st);
}

function setVars(el, pv) {
  el.style.setProperty('--a', pv.a);
  el.style.setProperty('--b', pv.b);
  if (pv.c) el.style.setProperty('--c', pv.c);
}

// ---- preview decorations: small absolutely positioned parts, driven by CSS custom properties ----
//   behind : children of the ball wrapper, drawn under the disc (they poke out of its edge)
//   inside : children of the clipped disc
const P = (cls, vars) => ({ cls, vars });
const ringOf = (n, cls, make) => Array.from({ length: n }, (_, i) => P(cls, make(i)));
const wobRing = (n, hMin, hRange, from = 0, span = 360) => ringOf(n, 'td', (i) => ({
  '--r': `${Math.round(from + (span / n) * i + (i % 2) * 7)}deg`,
  '--h': `${hMin + ((i * 7) % hRange)}px`,
  '--d': `-${((i * 0.43) % 1.7).toFixed(2)}s`,
}));
const PARTS = {
  tendrils: { behind: wobRing(11, 14, 9) },
  flame: {
    behind: ringOf(9, 'fl', (i) => ({
      '--r': `${Math.round((360 / 9) * i + (i % 2) * 9)}deg`, '--h': `${20 + ((i * 5) % 9)}px`, '--d': `-${((i * 0.29) % 0.55).toFixed(2)}s`,
    })),
  },
  goo: {
    behind: [
      P('gb', { '--x': '66%', '--y': '-7px', '--w': '15px', '--d': '0s' }),
      P('gb', { '--x': '-7px', '--y': '52%', '--w': '12px', '--d': '-0.7s' }),
      P('gb', { '--x': '78%', '--y': '66%', '--w': '10px', '--d': '-1.3s' }),
    ],
  },
  plasma: { inside: [P('bolt', { '--r': '-12deg', '--d': '0s' }), P('bolt', { '--r': '34deg', '--d': '-0.4s' }), P('bolt', { '--r': '-58deg', '--d': '-0.8s' })] },
  scales: {
    behind: [-30, -15, 0, 15, 30].map((r, i) => P('dgs', { '--x': `${24 + i * 13}%`, '--r': `${r}deg` })),
    inside: [P('dge')],
  },
  panels: { behind: [P('ran')], inside: [P('rv')] },
  quills: {
    behind: [
      ...ringOf(16, 'qu', (i) => ({ '--r': `${Math.round((360 / 16) * i + (i % 2) * 6)}deg`, '--h': `${13 + ((i * 5) % 7)}px` })),
      P('kear', { left: '8px' }), P('kear', { right: '8px' }),
    ],
    inside: [P('kf'), P('ke', { left: '34%' }), P('ke', { left: '58%' }), P('kn')],
  },
  octo: {
    behind: ringOf(7, 'oc', (i) => ({ '--r': `${100 + i * 26}deg`, '--h': `${15 + ((i * 5) % 7)}px`, '--d': `-${((i * 0.37) % 2.1).toFixed(2)}s` })),
    inside: [P('oe', { left: '16%' }), P('oe', { left: '55%' })],
  },
  pumpkin: {
    behind: [P('pst')],
    inside: [P('pe', { left: '22%', top: '28%' }), P('pe', { left: '58%', top: '28%' }), P('pn'), P('pm')],
  },
  zombie: { inside: [P('ze1'), P('ze2'), P('zs'), P('zm')] },
  pentagon: {
    inside: [P('pg'), ...ringOf(5, 'pg o', (i) => ({ '--r': `${i * 72}deg` }))],
  },
  bowl: { inside: [P('bh', { '--x': '36%', '--y': '24%' }), P('bh', { '--x': '56%', '--y': '24%' }), P('bh', { '--x': '46%', '--y': '44%' })] },
  donut: {
    inside: [
      P('dfr'), P('dho'),
      ...[['16%', '30%', '30deg', '#4cd6ff'], ['38%', '14%', '-20deg', '#ffe14a'], ['66%', '20%', '60deg', '#7be07b'], ['76%', '46%', '-35deg', '#fff'],
        ['66%', '74%', '20deg', '#b06cff'], ['40%', '80%', '-50deg', '#ff5c5c'], ['16%', '60%', '75deg', '#ffe14a'], ['28%', '70%', '-10deg', '#fff']]
        .map(([x, y, r, k]) => P('dsp', { '--x': x, '--y': y, '--r': r, '--k': k })),
    ],
  },
  cookie: {
    inside: [['22%', '26%', '10px', '20deg'], ['58%', '18%', '9px', '-30deg'], ['68%', '52%', '10px', '55deg'], ['30%', '56%', '9px', '-10deg'],
      ['52%', '74%', '10px', '35deg'], ['14%', '46%', '7px', '70deg'], ['44%', '40%', '8px', '-60deg']]
      .map(([x, y, w, r]) => P('ck', { '--x': x, '--y': y, '--w': w, '--r': r })),
  },
  fluff: {
    behind: [P('pear', { left: '9px' }), P('pear', { right: '9px' })],
    inside: [P('fe', { left: '28%' }), P('fe', { left: '62%' }), P('fc', { left: '14%' }), P('fc', { left: '68%' }), P('fn')],
  },
  penguin: {
    behind: [P('pfl', { left: '-6px', transform: 'rotate(16deg)' }), P('pfl', { right: '-6px', transform: 'rotate(-16deg)' }), P('pft', { left: '16px' }), P('pft', { right: '16px' })],
    inside: [P('pbe'), P('pey', { left: '34%' }), P('pey', { left: '56%' }), P('pbk')],
  },
};

function makePart(spec) {
  const e = h('i', `pt ${spec.cls}`);
  if (spec.vars) {
    for (const k of Object.keys(spec.vars)) {
      if (k.startsWith('--')) e.style.setProperty(k, spec.vars[k]);
      else e.style[k] = spec.vars[k];
    }
  }
  return e;
}

// the three blotch skins (cow / mushroom / leopard) draw with the 'blotch' preview pattern
const BLOTCH = new Set(['inek', 'mantar', 'leopar']);
// NEW badge = data: an item flagged `new: true` that is not owned and whose id was never shown in the shop yet ('patpat.shopSeen')
const SEEN_KEY = 'patpat.shopSeen';
const seenSet = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
const markSeen = (k) => { try { const z = seenSet(); for (const it of catalog(k)) z.add(k + ':' + it.id); localStorage.setItem(SEEN_KEY, JSON.stringify([...z])); } catch { /* ignore */ } };
export function shopNewCount(save) {
  try { const z = seenSet(); let n = 0; for (const kd of KINDS) for (const it of catalog(kd.k)) if (it.new && !save.isOwned(kd.k, it.id) && !z.has(kd.k + ':' + it.id)) n++; return n; } catch { return 0; }
}
const HIDDEN = { a: '#3f4f72', b: '#141c30', pattern: 'solid' };

function buildPreview(kind, pv, secret) {
  if (kind === 'trail') {
    const wrap = h('div', `cs-prev trail${pv.glow ? ' glow' : ''}${pv.pattern === 'swirl' ? ' swirl' : ''}${pv.pattern === 'bands' ? ' bands' : ''}`);
    setVars(wrap, pv);
    wrap.appendChild(h('i', 'rib'));
    wrap.appendChild(h('i', 'head'));
    if (secret) wrap.appendChild(h('i', 'cs-q', '?'));
    return wrap;
  }
  const parts = PARTS[pv.pattern] || {};
  const wrap = h('div', `cs-prev ball${pv.glow ? ' glow' : ''}${parts.behind ? ' over' : ''}`);
  setVars(wrap, pv);
  if (parts.behind) for (const p of parts.behind) wrap.appendChild(makePart(p));
  const fill = h('i', `cs-fill p-${pv.pattern || 'solid'}`);
  setVars(fill, pv);
  if (pv.pattern === 'face') {
    fill.appendChild(h('i', 'eye e1'));
    fill.appendChild(h('i', 'eye e2'));
    fill.appendChild(h('i', 'nose'));
    fill.appendChild(h('i', 'mouth'));
  }
  if (parts.inside) for (const p of parts.inside) fill.appendChild(makePart(p));
  wrap.appendChild(fill);
  if (secret) wrap.appendChild(h('i', 'cs-q', '?'));
  return wrap;
}

// flat card icon for the effect kinds (a rotating 3D preview of the selected one sits on top of the list)
const HOP_GLYPH = { star: '★', heart: '♥', diamond: '◆', flower: '✿', dash: '◌', double: '◎', ring: '○' };
const KIND_GLYPH = { stomp: '💥', blast: '🔥', yeti: '👹', death: '💀', hat: '🎩', yacc: '🧣' };
function buildFxPreview(kind, it, secret) {
  const pv = secret ? HIDDEN : it.preview;
  const wrap = h('div', `cs-prev fxp${pv.glow ? ' glow' : ''}`);
  setVars(wrap, pv);
  wrap.appendChild(h('i', 'fg', secret ? '?' : kind === 'hop' ? HOP_GLYPH[it.fx.shape] || '○' : kind === 'emote' ? it.fx.e || '😶' : KIND_GLYPH[kind] || '✨'));
  return wrap;
}
const withFxb = (el, it, secret) => {      // effect balls: animated motes over the thumbnail
  if (!it.fxb || secret) return el;
  el.classList.add('over');
  const f = h('span', `cs-fxb f-${it.fxb.k}`); f.style.setProperty('--fc', it.fxb.c);
  for (let i = 0; i < 4; i++) { const d = h('i'); d.style.setProperty('--x', 20 + i * 20); d.style.setProperty('--d', i * 0.33 + 's'); f.appendChild(d); }
  el.appendChild(f);
  return el;
};
const previewFor = (kind, it, secret) => (kind === 'skin' || kind === 'trail'
  ? withFxb(buildPreview(kind, secret ? HIDDEN : kind === 'skin' && BLOTCH.has(it.id) ? { ...it.preview, pattern: 'blotch' } : it.preview, secret), it, secret)
  : buildFxPreview(kind, it, secret));

// ---- DAILY OFFER (3 items, 20/30/40% off, same for everyone, new at local midnight) and THEME BUNDLES ----
const dayKey = (d = new Date()) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const dayLeft = () => { const d = new Date(); return Math.max(0, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) - d); };
const buyable = (kd, it) => it.price > 0 && !(it.unlock && (it.unlock.stars || it.unlock.secret || it.unlock.challenge));
export function dailyOffers(sv) {
  let seed = dayKey();
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const all = [];
  for (const kd of KINDS) for (const it of catalog(kd.k)) if (buyable(kd, it)) all.push({ kind: kd.k, it });
  const fresh = all.filter((x) => !sv.isOwned(x.kind, x.it.id));
  const src = fresh.length >= 6 ? fresh : all;
  const out = [], kinds = new Set();
  for (let i = 0; out.length < 3 && i < 60; i++) {
    const p = src[Math.floor(rnd() * src.length)];
    if (out.includes(p) || (kinds.has(p.kind) && i < 40)) continue;
    kinds.add(p.kind); out.push(p);
  }
  const pcts = [20, 30, 40];
  return out.map((p, i) => ({ id: 'd' + i, kind: p.kind, item: p.it, pct: pcts[i], was: p.it.price, price: Math.max(1, Math.round((p.it.price * (100 - pcts[i])) / 100)) }));
}
const dailyKey = () => 'patpat.daily.' + dayKey();
function dailyBought() { try { return JSON.parse(localStorage.getItem(dailyKey()) || '[]'); } catch { return []; } }
function dailyMark(id) { try { const a = dailyBought(); if (!a.includes(id)) a.push(id); localStorage.setItem(dailyKey(), JSON.stringify(a)); } catch { /* ignore */ } }
const BUNDLE_OFF = 25;
export function bundleInfo(sv, b) {
  const pcs = b.pcs.map(([k, id]) => ({ kind: k, it: itemOf(k, id) })).filter((p) => p.it);
  const miss = pcs.filter((p) => !sv.isOwned(p.kind, p.it.id));
  const sum = miss.reduce((a, p) => a + p.it.price, 0);
  return { pcs, miss, have: pcs.length - miss.length, was: sum, price: Math.max(10, Math.round((sum * (100 - BUNDLE_OFF)) / 1000) * 10) };
}

let activeClose = null;
const DENE_SEC = 5;

export function openShop({ save, onClose, onSelect } = {}) {
  if (activeClose) activeClose();
  injectStyle();

  const host = document.getElementById('app') || document.body;
  let kind = 'skin';
  let filt = 'all';
  let closed = false;
  let shownCoins = save.coins;
  let raf = 0;
  let pv = null;          // the item shown in the 3D preview
  let pvKey = '';
  let view = null;
  let deneTm = 0;
  const seen0 = seenSet();   // items that were NEW when the shop opened keep their badge until it is closed

  // ---- skeleton ----
  const root = h('div', 'cs-root');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Dolap');

  const head = h('div', 'cs-head');
  const titles = h('div', 'cs-titles');
  titles.appendChild(h('div', 'cs-title', 'DOLAP'));
  titles.appendChild(h('div', 'cs-sub', 'KAR TANESİYLE TOP VE İZ AL'));
  const coins = h('div', 'cs-coins');
  coins.appendChild(h('span', 'ico', '❄️'));
  const coinsNum = h('span', 'num', fmt(shownCoins));
  coins.appendChild(coinsNum);
  const closeBtn = h('button', 'cs-close', '✕');
  closeBtn.setAttribute('type', 'button');
  closeBtn.setAttribute('aria-label', 'Kapat');
  head.appendChild(titles);
  head.appendChild(coins);
  head.appendChild(closeBtn);

  const tabs = h('div', 'cs-tabs');
  tabs.setAttribute('role', 'tablist');
  const TABS = [...KINDS.map((k) => ({ k: k.k, n: k.n, ic: k.ic })), { k: 'power', n: 'GÜÇLER', ic: '💪' }, { k: 'pazar', n: 'PAZAR', ic: '🛒' }];
  const tabEl = {};
  for (const tb of TABS) {
    const b = h('button', 'cs-tab');
    b.setAttribute('type', 'button');
    b.setAttribute('role', 'tab');
    b.appendChild(h('span', 'ti', tb.ic));
    b.appendChild(h('span', 'tn', tb.n));
    b.appendChild(h('i', 'cs-dot'));
    b.addEventListener('click', () => setTab(tb.k));
    tabEl[tb.k] = b;
    tabs.appendChild(b);
  }

  const goalBox = h('div', 'cs-goal');
  // 3D stage: canvas + name / rarity + DENE (try 5 s) + the buy/equip button
  const stage = h('div', 'cs-view');
  const stageCv = h('div', 'cs-stagecv');
  const stageInfo = h('div', 'cs-vinfo');
  const stName = h('div', 'cs-vname');
  const stRar = h('span', 'cs-vrar');
  const stAbil = h('div', 'cs-vabil');
  const stBtns = h('div', 'cs-vbtns');
  const deneBtn = h('button', 'cs-vb dene', 'DENE');
  deneBtn.setAttribute('type', 'button');
  const stBuy = h('button', 'cs-vb buy');
  stBuy.setAttribute('type', 'button');
  stBtns.appendChild(deneBtn);
  stBtns.appendChild(stBuy);
  const stTop = h('div', 'cs-vtop');
  stTop.appendChild(stAbil);
  stTop.appendChild(stName);
  stTop.appendChild(stRar);
  stageInfo.appendChild(stTop);
  stageInfo.appendChild(stBtns);
  stage.appendChild(stageCv);
  stage.appendChild(stageInfo);
  const coll = h('div', 'cs-coll');
  const collT = h('div', 'cs-collt');
  const collB = h('div', 'cs-collb');
  const collI = h('i');
  collB.appendChild(collI);
  coll.appendChild(collT);
  coll.appendChild(collB);
  const filtBar = h('div', 'cs-filt');
  const FILTS = [['all', 'HEPSİ'], ['own', 'SENDE'], ['buy', 'ALINABİLİR'], ['new', 'YENİ']];
  const filtEl = {};
  for (const [k, n] of FILTS) {
    const b = h('button', 'cs-chip' + (k === 'all' ? ' on' : ''), n);
    b.setAttribute('type', 'button');
    b.addEventListener('click', () => { filt = k; for (const f of FILTS) filtEl[f[0]].classList.toggle('on', f[0] === k); scroll.scrollTop = 0; sfx(); render(); });
    filtEl[k] = b;
    filtBar.appendChild(b);
  }
  const scroll = h('div', 'cs-scroll');
  const grid = h('div', 'cs-grid');
  const plist = h('div', 'cs-list');
  scroll.appendChild(grid);

  root.appendChild(head);
  root.appendChild(tabs);
  root.appendChild(goalBox);
  root.appendChild(stage);
  root.appendChild(coll);
  root.appendChild(filtBar);
  root.appendChild(scroll);

  // The game blocks document-level touchmove with preventDefault (to kill iOS rubber-band / zoom);
  // keep it from ever seeing drags that start inside the scroller so native scrolling survives.
  scroll.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
  tabs.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

  // ---- coins ----
  function renderGoal() {
    goalBox.innerHTML = '';
    let g = null;
    try { g = nextGoal(save); } catch { g = null; }
    goalBox.classList.toggle('hidden', !g);
    if (!g) return;
    goalBox.classList.toggle('ready', g.ready);
    const gi = h('div', 'gi');
    const gt = h('div', 'gt');
    gt.appendChild(h('span', '', `🎯 ${g.name}`));
    gt.appendChild(h('b', '', g.ready ? 'HAZIR!' : `${fmt(g.have)} / ${fmt(g.price)} ❄️`));
    const gb = h('div', 'gb');
    const bi = h('i');
    bi.style.width = `${Math.round(g.frac * 100)}%`;
    gb.appendChild(bi);
    gi.appendChild(gt);
    gi.appendChild(gb);
    goalBox.appendChild(gi);
  }

  function showCoins(target, animate) {
    const from = shownCoins;
    shownCoins = target;
    renderGoal();
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    if (!animate || from === target || typeof requestAnimationFrame !== 'function') {
      coinsNum.textContent = fmt(target);
      return;
    }
    coins.classList.remove('bump');
    void coins.offsetWidth; // restart the CSS animation
    coins.classList.add('bump');
    const t0 = performance.now();
    const step = (now) => {
      if (closed) return;
      const k = Math.min(1, (now - t0) / 450);
      const e = 1 - Math.pow(1 - k, 3);
      coinsNum.textContent = fmt(Math.round(from + (target - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // ---- item state ----
  const list0 = () => catalog(kind);
  const curId = () => save.selected(kind) || (list0()[0] && list0()[0].id);
  function vitOf(it) { if (kind !== 'skin') return null; const v = vitrinInfo(save); return v && v.id === it.id ? v : null; }
  function basePriceOf(it) { const v = vitOf(it); return v ? v.price : it.price; }
  function priceOf(it) { return save.shopPrice ? save.shopPrice(basePriceOf(it)) : basePriceOf(it); }  // ŞANS ÇARKI coupon applied
  function stateOf(it) {
    const stars = starsOf(save);
    const need = (it.unlock && it.unlock.stars) || 0;
    const secretGate = !!(it.unlock && it.unlock.secret);
    const ch = it.unlock && it.unlock.challenge ? challengeOf(it.unlock.challenge) : null; // GÖREVLER gate (özel ödül)
    const selected = curId() === it.id;
    const owned = selected || save.isOwned(kind, it.id);
    const secret = !owned && secretGate; // hidden until the meta module grants it
    const locked = !owned && (secret || !!ch || need > stars);
    const needsBuy = !owned && !locked && it.price > 0;
    const canAfford = save.coins >= priceOf(it);
    return { stars, need, selected, owned, locked, secret, needsBuy, canAfford, ch };
  }

  // The challenge behind a locked item: its title, text and progress (value/goal), from the achievements engine.
  function challengeOf(id) {
    const d = ACHIEVEMENTS.find((x) => x.id === id);
    const pr = meta.progress(id);
    return { id, name: d ? d.name : id, desc: d ? d.desc.replace(/\s*\[özel\]/, '') : '', value: pr.value, goal: pr.goal, done: pr.done };
  }

  function flakes(card) {
    for (let i = 0; i < 9; i++) {
      const f = h('span', 'cs-flake', '❄️');
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
      const d = 56 + Math.random() * 38;
      f.style.setProperty('--dx', `${Math.round(Math.cos(a) * d)}px`);
      f.style.setProperty('--dy', `${Math.round(Math.sin(a) * d * 0.9)}px`);
      card.appendChild(f);
      setTimeout(() => f.remove(), 950);
    }
  }

  function anim(card, cls, ms) {
    card.classList.remove('shake', 'pop', 'ping');
    void card.offsetWidth;
    card.classList.add(cls);
    setTimeout(() => card.classList.remove(cls), ms);
  }

  function act(it, card) {
    const st = stateOf(it);
    if (st.selected) return;
    if (st.locked || (st.needsBuy && !st.canAfford)) {
      sfx();
      anim(card, 'shake', 340);
      return;
    }
    let bought = false;
    if (st.needsBuy) {
      if (!(save.shopCharge ? save.shopCharge(basePriceOf(it)) : save.spend(priceOf(it)))) { anim(card, 'shake', 340); return; }
      save.own(kind, it.id);
      bought = true;
    } else if (!st.owned) {
      save.own(kind, it.id); // free once its star requirement is met
    }
    save.select(kind, it.id);
    sfx();
    pv = it;
    render(it.id, bought);
    showCoins(save.coins, bought);
    if (onSelect) onSelect(kind, it.id);
  }

  // label + style of the buy / equip button of an item (cards and the 3D stage share it)
  function btnSpec(it, st) {
    if (st.selected) return { label: 'SEÇİLİ ✓', cls: 'on' };
    if (st.owned) return { label: 'SEÇ', cls: 'pick' };
    if (st.secret) return { label: 'GİZLİ', cls: 'lock' };
    if (st.ch) return { label: st.ch.done ? '🏆 Ödülü Başarımlardan al' : '🏆 Görev gerekli', cls: 'lock' };
    if (st.locked) return { label: `⭐ ${st.need} gerekli`, cls: 'lock' };
    if (st.needsBuy) return { label: `❄️ ${fmt(priceOf(it))}` + (priceOf(it) < basePriceOf(it) ? ' · %50' : ''), cls: st.canAfford ? '' : 'poor' };
    return { label: 'SEÇ', cls: 'pick' };
  }

  const isNew = (it, st) => !!it.new && !st.owned && !seen0.has(kind + ':' + it.id);

  function makeCard(it, pop, bought) {
    const st = stateOf(it);
    const rar = RARITY[it.rarity] ? it.rarity : 'common';
    const card = h('div', `cs-card r-${rar}${st.selected ? ' sel' : ''}${st.locked ? ' locked' : ''}${st.secret ? ' secret' : ''}${pv && pv.id === it.id ? ' pv' : ''}`);
    card.dataset.id = it.id;
    card.appendChild(previewFor(kind, it, st.secret));
    if (isNew(it, st)) card.appendChild(h('span', 'cs-newtag', 'YENİ'));
    card.appendChild(h('span', 'cs-rar', RARITY[rar].label));
    card.appendChild(h('div', 'cs-name', st.secret ? '???' : it.name));
    if (kind === 'skin' && ABILITIES[it.id]) card.appendChild(h('span', 'cs-abil-star', '★'));      // the ability text + level live in the 3D stage (equal card heights)
    if (st.locked) {
      const nd = h('div', 'cs-note');
      if (st.ch) { // short: the quest name and its counter (the long sentence lives in the title); one node each so the English translator reads them alone
        nd.appendChild(h('b', '', st.ch.name)); nd.appendChild(document.createTextNode(' 🏆 '));
        nd.appendChild(document.createTextNode(`${fmt(Math.min(st.ch.value, st.ch.goal))}/${fmt(st.ch.goal)}`));
        nd.title = st.ch.desc;
      } else if (st.secret) nd.appendChild(h('span', '', 'Gizli ödül'));
      else nd.textContent = `⭐ ${Math.min(st.stars, st.need)}/${st.need}`;
      card.appendChild(nd);
      card.appendChild(h('span', 'cs-lockbadge', '🔒'));
    }

    const vt = !st.owned && !st.locked ? vitOf(it) : null;
    if (vt) card.appendChild(h('div', 'cs-note cs-vit', `⭐ VİTRİN -%15 · ⏳ ${fmtLeft(vt.msLeft)}`));
    const sp = btnSpec(it, st);
    const btn = h('button', `cs-btn ${sp.cls}`.trim(), sp.label);
    btn.setAttribute('type', 'button');
    if (st.selected || st.locked || sp.cls === 'poor') btn.setAttribute('aria-disabled', 'true');
    btn.addEventListener('click', () => act(it, card));
    card.appendChild(btn);
    card.addEventListener('click', (e) => { if (!e.target.closest('.cs-btn')) selectPv(it); });

    if (pop) {
      card.classList.add(bought ? 'pop' : 'ping');
      if (bought) flakes(card);
    }
    return card;
  }

  // ---- 3D stage ----
  function ensureView() {
    if (view || closed) return;
    try { view = createView(stageCv, save.selected('skin') || 'classic'); } catch { view = null; }
    stage.classList.toggle('nogl', !view);
  }
  let emoteEl = null;
  function emoteDemo() {
    if (emoteEl) emoteEl.remove();
    emoteEl = null;
    if (!pv || kind !== 'emote' || !pv.fx.e) return;
    emoteEl = h('div', `rx-emote ${pv.fx.css}`, pv.fx.e);
    stageCv.appendChild(emoteEl);
  }
  function showPv() {
    ensureView();
    const st = pv ? stateOf(pv) : null;
    const key = kind + ':' + (pv ? pv.id : '') + (st && st.secret ? 's' : '');
    if (view && key !== pvKey) { pvKey = key; view.show(!pv || st.secret ? 'none' : kind, pv); stopDene(); }
    emoteDemo();
    updateStage();
  }
  function updateStage() {
    if (!pv) return;
    const st = stateOf(pv);
    stName.textContent = st.secret ? '???' : pv.name;
    const rar = RARITY[pv.rarity] ? pv.rarity : 'common';
    stRar.textContent = RARITY[rar].label;
    stRar.className = 'cs-vrar r-' + rar;
    stAbil.textContent = '';
    const ab = kind === 'skin' && !st.secret ? ABILITIES[pv.id] : null;
    if (ab) {
      stAbil.appendChild(h('span', 'cs-abil-b', '★ ABİLİTE'));
      stAbil.appendChild(document.createTextNode(' '));
      stAbil.appendChild(h('span', '', ab.icon));
      stAbil.appendChild(document.createTextNode(' '));
      stAbil.appendChild(h('span', '', ab.text));
      try { const si = meta.shardInfo(pv.id); if (si) { if (ab.myth) { stAbil.appendChild(document.createTextNode(' · ')); stAbil.appendChild(h('span', '', 'EVRİM ' + (stageOf(si.level) + 1) + '/3')); } stAbil.appendChild(document.createTextNode(' · ')); stAbil.appendChild(h('span', '', si.max ? `★ Sv ${si.level}/5 · MAKS` : `★ Sv ${si.level}/5 · 🧩 ${si.shards}/${si.next}`)); } } catch { /* ignore */ }
    }
    const sp = btnSpec(pv, st);
    stBuy.textContent = sp.label;
    stBuy.className = `cs-vb buy ${sp.cls}`.trim();
    stBuy.setAttribute('aria-disabled', st.selected || st.locked || sp.cls === 'poor' ? 'true' : 'false');
  }
  function selectPv(it) {
    if (pv && pv.id === it.id) return;
    pv = it;
    for (const c of grid.children) c.classList.toggle('pv', c.dataset.id === it.id);
    sfx();
    showPv();
  }
  function stopDene() { clearInterval(deneTm); deneBtn.textContent = 'DENE'; deneBtn.classList.remove('busy'); }
  deneBtn.addEventListener('click', () => {
    if (!pv || deneBtn.classList.contains('busy')) return;
    sfx();
    let n = DENE_SEC;
    deneBtn.classList.add('busy');
    deneBtn.textContent = '⏱ ' + n;
    if (view) view.dene(true);
    emoteDemo();
    deneTm = setInterval(() => { n--; if (n <= 0 || closed) stopDene(); else deneBtn.textContent = '⏱ ' + n; }, 1000);
  });
  stBuy.addEventListener('click', () => { if (pv) act(pv, stage); });

  function render(popId, bought) {
    renderGoal();
    for (const tb of TABS) tabEl[tb.k].classList.toggle('on', tb.k === kind);
    const itemTab = kind !== 'pazar' && kind !== 'power';
    stage.classList.toggle('hidden', !itemTab);
    coll.classList.toggle('hidden', !itemTab);
    filtBar.classList.toggle('hidden', !itemTab);
    refreshDots();
    if (kind === 'pazar') { renderPazar(); return; }
    if (kind === 'power') { renderPower(); return; }
    if (plist.parentNode) { plist.remove(); scroll.appendChild(grid); }
    const all = sortCatalog(catalog(kind));
    const own = (it) => { const st = stateOf(it); return st.owned; };
    const n0 = all.filter(own).length;
    collT.textContent = `KOLEKSİYON ${n0}/${all.length} · %${Math.round((n0 / Math.max(1, all.length)) * 100)}`;
    collI.style.width = `${Math.round((n0 / Math.max(1, all.length)) * 100)}%`;
    const list = all.filter((it) => {
      if (filt === 'all') return true;
      const st = stateOf(it);
      return filt === 'own' ? st.owned : filt === 'buy' ? st.needsBuy && st.canAfford : isNew(it, st);
    });
    if (!pv || !all.includes(pv)) pv = all.find((it) => it.id === curId()) || all[0];
    grid.innerHTML = '';
    for (const it of list) grid.appendChild(makeCard(it, it.id === popId, bought));
    if (!list.length) grid.appendChild(h('div', 'cs-empty', 'Burada henüz bir şey yok.'));
    showPv();
  }

  // red dot on a tab while it still holds items that are new to the player (data: item.new, not owned, not seen)
  function refreshDots() {
    const live = seenSet();
    for (const kd of KINDS) {
      const any = catalog(kd.k).some((it) => it.new && !save.isOwned(kd.k, it.id) && !live.has(kd.k + ':' + it.id));
      tabEl[kd.k].classList.toggle('dot', any && kd.k !== kind);
    }
  }

  // ---- GÜÇLER: what coins are for. Permanent run upgrades + power-up durations + sled pack. ----
  function upRow(icon, name, desc, lv, cost, onBuy) {
    const row = h('div', 'cs-up');
    row.appendChild(typeof icon === 'string' ? h('div', 'ui', icon) : icon);
    const mid = h('div', 'um');
    mid.appendChild(h('div', 'un', name));
    { const ud = h('div', 'ud'); String(desc).split(' · ').forEach((p, i) => { if (i) ud.appendChild(document.createTextNode(' · ')); ud.appendChild(h('span', '', p)); }); mid.appendChild(ud); }
    if (lv !== null) {
      const pips = h('div', 'up');
      for (let i = 0; i < MAX_LV; i++) pips.appendChild(h('i', i < lv ? 'on' : ''));
      mid.appendChild(pips);
    }
    row.appendChild(mid);
    let btn;
    if (cost === null) btn = h('button', 'cs-btn on', 'MAKS ✓');
    else {
      const afford = save.coins >= cost;
      btn = h('button', `cs-btn${afford ? '' : ' poor'}`, `❄️ ${fmt(cost)}`);
      btn.addEventListener('click', () => {
        if (!afford || !onBuy()) { anim(row, 'shake', 340); sfx(); return; }
        sfx();
        showCoins(save.coins, true);
        renderPower();
      });
    }
    btn.setAttribute('type', 'button');
    row.appendChild(btn);
    return row;
  }

  function renderPower() {
    if (grid.parentNode) { grid.remove(); scroll.appendChild(plist); }
    const keep = scroll.scrollTop;
    plist.innerHTML = '';
    plist.appendChild(h('div', 'cs-sec', 'KALICI GELİŞTİRMELER'));
    const perm = save.perm ? save.perm() : {};
    for (const u of permList()) {
      const lv = Math.min(MAX_LV, perm[u.id] || 0);
      const cost = save.permCost ? save.permCost(u.id) : null;
      plist.appendChild(upRow(u.icon, u.name, `${u.desc} · Sv ${lv}/${MAX_LV}`, lv, cost, () => !!save.buyPerm(u.id, cost)));
    }
    plist.appendChild(h('div', 'cs-sec', 'GÜÇ SÜRELERİ'));
    for (const u of POWER_UPGRADES) {
      const lv = meta.upgradeLevel(u.id);
      const cost0 = meta.upgradeCost(u.id), cost = cost0 > 0 && save.shopPrice ? save.shopPrice(cost0) : cost0;
      const sec = (x) => String(x).replace('.', ','); // 3.5 -> 3,5 (Turkish decimal comma)
      const cur = sec(meta.duration(u.id));
      const nxt = lv < MAX_LV ? sec(u.durations[lv + 1]) : null;
      plist.appendChild(upRow(u.icon, u.name, nxt ? `${cur} sn → ${nxt} sn · ${u.desc}` : `${cur} sn (en yüksek) · ${u.desc}`, lv, cost, () => meta.buyUpgrade(u.id)));
    }
    plist.appendChild(h('div', 'cs-sec', 'KIZAK'));
    plist.appendChild(upRow('🛷', 'Kızak', `Bir çarpışmayı affeder · Stok: ${meta.sleds()}`, null, SLED_PACK.price, () => meta.buySled(1)));
    scroll.scrollTop = keep;
  }

  // ---- PAZAR: daily offer, theme bundles, weekly offers ----
  let pzTimer = 0;
  const miniOf = (k, it) => { const w = h('div', 'ui mini'); w.appendChild(previewFor(k, it, false)); return w; };
  function offerRow(prev, name, desc, price, cur, done, doneLabel, onBuy) {
    const afford = cur === 'crystals' ? save.crystals() >= save.shopPrice(price) : save.coins >= (save.shopPrice ? save.shopPrice(price) : price);
    const op = save.shopPrice ? save.shopPrice(price) : price;
    const row = h('div', 'cs-up');
    row.appendChild(prev);
    const mid = h('div', 'um');
    mid.appendChild(h('div', 'un', name));
    { const ud = h('div', 'ud'); String(desc).split(' · ').forEach((p, i) => { if (i) ud.appendChild(document.createTextNode(' · ')); ud.appendChild(h('span', '', p)); }); mid.appendChild(ud); }
    row.appendChild(mid);
    const btn = h('button', done ? 'cs-btn on' : 'cs-btn' + (afford ? '' : ' poor'), done ? doneLabel : (cur === 'crystals' ? '💎 ' + op : '❄️ ' + fmt(op)) + (op < price ? ' · %50' : ''));
    btn.setAttribute('type', 'button');
    if (!done) btn.addEventListener('click', () => {
      let ok = false;
      try { ok = afford && (save.shopCharge ? save.shopCharge(price, cur === 'crystals' ? 'crystals' : 'coins') : (cur === 'crystals' ? save.spendCrystals(price) : save.spend(price))); if (ok) onBuy(); } catch { ok = false; }
      if (!ok) { anim(row, 'shake', 340); sfx(); return; }
      sfx();
      showCoins(save.coins, true);
      renderPazar();
    });
    row.appendChild(btn);
    return row;
  }
  function renderPazar() {
    if (grid.parentNode) { grid.remove(); scroll.appendChild(plist); }
    const keep = scroll.scrollTop;
    plist.innerHTML = '';
    const wk = isoWeekInfo();
    const bought = pzBought(wk);
    clearInterval(pzTimer);
    // daily offer
    const dh = h('div', 'cs-sec', 'GÜNÜN FIRSATI');
    const dl = h('span', 'cs-left', '⏳ ' + fmtLeft(dayLeft()));
    dh.appendChild(dl);
    plist.appendChild(dh);
    const db = dailyBought();
    for (const o of dailyOffers(save)) {
      const done = db.includes(o.id) || save.isOwned(o.kind, o.item.id);
      plist.appendChild(offerRow(miniOf(o.kind, o.item), o.item.name, `%${o.pct} İNDİRİM · eski fiyat ❄️ ${fmt(o.was)}`, o.price, 'coins', done, 'SENDE ✓', () => { save.own(o.kind, o.item.id); dailyMark(o.id); }));
    }
    // theme bundles
    plist.appendChild(h('div', 'cs-sec', 'SETLER'));
    for (const b of SETS) {
      const bi = bundleInfo(save, b);
      const prev = h('div', 'ui set');
      for (const p of bi.pcs) prev.appendChild(miniOf(p.kind, p.it));
      const done = bi.miss.length === 0;
      plist.appendChild(offerRow(prev, b.name, `${bi.have}/${bi.pcs.length} parça · %${BUNDLE_OFF} SET İNDİRİMİ`, bi.price, 'coins', done, 'TAMAM ✓', () => { for (const p of bi.miss) save.own(p.kind, p.it.id); }));
    }
    // weekly offers
    const hd = h('div', 'cs-sec', 'YETİ PAZARI');
    const left = h('span', 'cs-left', '⏳ ' + fmtLeft(wk.msLeft));
    hd.appendChild(left);
    plist.appendChild(hd);
    pzTimer = setInterval(() => { if (closed || kind !== 'pazar') { clearInterval(pzTimer); return; } const w = isoWeekInfo(); left.textContent = '⏳ ' + fmtLeft(w.msLeft); dl.textContent = '⏳ ' + fmtLeft(dayLeft()); if (w.key !== wk.key) renderPazar(); }, 30000);
    for (const o of weeklyOffers(save, wk)) {
      const done = bought.includes(o.id) || (o.kind !== 'bundle' && save.isOwned(o.kind, o.item.id));
      const desc = o.kind === 'bundle' ? o.tag + ' · 💎 ' + o.price + ' karşılığı' : o.tag + ' · eski fiyat ❄️ ' + fmt(o.was);
      plist.appendChild(offerRow(o.kind === 'bundle' ? h('div', 'ui', o.icon) : miniOf(o.kind, o.item), o.name, desc, o.price, o.cur, done, o.kind === 'bundle' ? 'ALINDI ✓' : 'SENDE ✓',
        () => { if (o.kind === 'bundle') save.addCoins(o.coins); else save.own(o.kind, o.item.id); pzMark(wk, o.id); }));
    }
    plist.appendChild(h('div', 'cs-sec', 'Her pazartesi yeni teklifler gelir.'));
    scroll.scrollTop = keep;
  }

  function setTab(k) {
    if (k === kind) return;
    stopDene();
    markSeen(kind);
    kind = k;
    filt = 'all';
    for (const f of FILTS) filtEl[f[0]].classList.toggle('on', f[0] === 'all');
    pv = null; pvKey = '';
    scroll.scrollTop = 0;
    sfx();
    render();
    try { tabEl[k].scrollIntoView({ inline: 'center', block: 'nearest' }); } catch { /* ignore */ }
  }

  // ---- close ----
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (closed) return;
    closed = true;
    if (activeClose === close) activeClose = null;
    document.removeEventListener('keydown', onKey);
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    clearInterval(pzTimer);
    clearInterval(deneTm);
    if (kind !== 'pazar' && kind !== 'power') markSeen(kind);
    if (view) { view.dispose(); view = null; }
    root.remove();
    if (onClose) onClose();
  }
  closeBtn.addEventListener('click', () => { sfx(); close(); });
  document.addEventListener('keydown', onKey);

  host.appendChild(root);
  render();
  activeClose = close;
  try {
    const want = localStorage.getItem('patpat.shopTab'); // menu chips: 'pazar' | 'skin' | ... ; the result screen sends 'kind:id' through patpat.shopItem
    if (want) { localStorage.removeItem('patpat.shopTab'); if (TABS.some((x) => x.k === want)) setTab(want); }
    const wi = localStorage.getItem('patpat.shopItem');
    if (wi) {
      localStorage.removeItem('patpat.shopItem');
      const [wk2, wid] = wi.split(':');
      const it = itemOf(wk2, wid);
      if (it && TABS.some((x) => x.k === wk2)) {
        if (wk2 !== kind) setTab(wk2);
        pv = it; pvKey = '';
        render(wid);
        const c = grid.querySelector(`[data-id="${wid}"]`);
        if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' });
      }
    }
  } catch { /* ignore */ }
  return close;
}
