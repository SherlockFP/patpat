// ui.js — HUD, result screens and the soft (non-blocking) feedback layer.
//
// Contracts other packages call (always with ?. on their side):
//   buffAdd(id, icon, name, secs) · buffTick([{id,left,total}]) · buffRemove(id)
//   turnCue(dir:-1|0|1, urgency 0..1) · hunger(frac 0..1, warn) · stompCombo(n)
//   cigHud({tons, dist, tierName, frac, best}) · cigTier(name) · toastSoft(text)
// Everything lives at the top / bottom edge of the screen: the middle strip (the reaction zone) stays empty.
import { meta } from './meta.js';
import { t as tr } from './i18n.js';
import { save } from './save.js';
import { nextGoal } from './shop.js';
import { shareCard } from './sharecard.js';

const $ = (id) => document.getElementById(id);

const NF = new Intl.NumberFormat('tr-TR');
export const fmtN = (n) => NF.format(Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
export function fmtTons(t) {
  const kg = Math.round(t * 1000);
  if (kg < 1000) return `${kg} kg`;
  const t1 = Math.round(t * 10) / 10;
  if (t1 < 10) return `${t1.toFixed(1).replace('.', ',')} ton`;
  return `${NF.format(Math.round(t))} ton`;
}
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);

// ---- pure helpers (checked by scripts/check-ui-math.mjs) ----
export const MILESTONE_STEP = 500;
const MS_TAGS = ['GÜZEL!', 'HARİKA!', 'SÜPER!', 'MUHTEŞEM!', 'EFSANE!'];
// highest unseen milestone index once `dist` passes it (1 = 500 m, 2 = 1000 m ...), else 0. `last` = index already celebrated.
export const milestoneIdx = (dist, last) => { const k = Math.floor(Math.max(0, Number(dist) || 0) / MILESTONE_STEP); return k > last ? k : 0; };
export const milestoneText = (k) => { const m = k * MILESTONE_STEP; return m % 1000 ? `${fmtN(m)} m` : `${fmtN(m / 1000)} km`; };
export const milestoneTag = (k) => MS_TAGS[Math.max(0, Math.min(MS_TAGS.length - 1, k - 1))];
// XP bar endpoints from the run start (`pre`) to now; a level-up restarts the bar at 0. pre/now = { level, frac }.
export function xpBar(pre, now) {
  const up = now.level > pre.level;
  const from = up ? 0 : clamp01(pre.frac);
  return { from, to: Math.max(from, clamp01(now.frac)), up };
}
// Season bar toward the next tier. needs = ascending token thresholds; pre/tok = tokens at run start / now.
export function seasonBar(pre, tok, needs) {
  pre = Math.min(pre, tok);
  let lo = 0, hi = 0, preLo = 0;
  for (const n of needs) { if (n <= tok) lo = n; else { hi = n; break; } }
  if (!hi) return { from: 1, to: 1, up: false, left: 0, hi: 0, done: true };
  for (const n of needs) if (n <= pre) preLo = n;
  const up = preLo < lo, span = hi - lo;
  const from = up ? 0 : clamp01((pre - lo) / span);
  return { from, to: Math.max(from, clamp01((tok - lo) / span)), up, left: hi - tok, hi, done: false };
}
// Which records did a run break? dist: farthest ever; score: most points ever (a first-ever score is not a "record").
export const recKind = (isDist, score, prevScore) => ({ dist: !!isDist, score: prevScore > 0 && score > prevScore });
export const recTitle = (k) => (k.dist && k.score ? '★ ÇİFT REKOR! ★' : k.dist ? 'YENİ REKOR!' : k.score ? 'YENİ SKOR REKORU!' : '');

// Respect the OS "reduce motion" setting (JS-driven pops; style.css handles the CSS animations).
const _mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reduceMotion = () => !!(_mq && _mq.matches);
// Small GPU-only scale pulse (transform only). Event-driven and rate-limited by the callers, never per frame.
function pop(el, k = 1.1, ms = 150) {
  if (!el || !el.animate || reduceMotion()) return;
  try { el.animate([{ transform: 'scale(1)' }, { transform: `scale(${k})`, offset: 0.35 }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' }); } catch { /* optional */ }
}
// Tiny sound hooks (main.js exposes the audio engine as window.__cigSfx); every one is optional and rate-limited inside audio.js.
function snd(name, a) {
  try { const s = typeof window !== 'undefined' ? window.__cigSfx : null; if (s && s[name]) s[name](a); } catch { /* audio is optional */ }
}

// The boot splash (index.html) goes away as soon as any real screen shows.
export function hideBoot() {
  const b = typeof document !== 'undefined' ? document.getElementById('boot') : null;
  if (!b) return;
  b.classList.add('out');
  setTimeout(() => b.remove(), 300);
}

// What killed you -> headline + one short tip. Used by the result screen (and exported for the runner / menus).
const DEATH = {
  wall: { icon: '🚧', title: 'DÖNEMEDİN!', tip: 'Kavşakta okun gösterdiği yöne kaydır.' },
  turn: { icon: '🚧', title: 'DÖNEMEDİN!', tip: 'Kavşakta okun gösterdiği yöne kaydır.' },
  turnFall: { icon: '🕳️', title: 'DÜŞTÜN!', tip: 'Kavşağı geç kaçırdın. Okları erken takip et.' },
  melt: { icon: '💧', title: 'ERİDİN!', tip: 'Kar yığınlarını ve kar izlerini topla, boyunu koru.' },
  yeti: { icon: '👹', title: 'YETİ YAKALADI!', tip: 'Üst üste çarpma. Yeti ensende bekliyor.' },
  explode: { icon: '💥', title: 'PATLADIN!', tip: 'Cam top tek çarpmaya dayanmaz.' },
  fall: { icon: '🕳️', title: 'DÜŞTÜN!', tip: 'Boşlukları zıplayarak geç.' },
  smash: { icon: '💢', title: 'ÇARPTIN!', tip: 'Büyük engellerin yanından dolan.' },
  finish: { icon: '🏁', title: 'BİTİŞ!', tip: '' },
};
const KILL_TIP = {
  rock: 'Küçük kayaya zıpla, büyük kayanın yanından dolan.',
  boulder: 'Gölgeye dikkat: yuvarlanan kaya şeridi kapatır.',
  overhead: 'Üstten geçen barın altından eğilerek geç.',
  laser: 'Lazerin altından eğilerek geç.',
  slidewall: 'Kayan duvarın açıklığına gir.',
  oncoming: 'Karşıdan gelen araca çarpma, şerit değiştir.',
};
export function runnerDeathText(cause, killKind) {
  const d = DEATH[cause] || { icon: '❄️', title: 'OLMADI!', tip: '' };
  return { icon: d.icon, title: d.title, tip: (killKind && KILL_TIP[killKind]) || d.tip };
}

// buff colours (ring); unknown ids get a stable hue
const BUFF_COL = { miknatis: '#ff7a7a', kar: '#9be7ff', kabuk: '#ffd23a', akis: '#7dff9a', altin: '#ffc21a', yay: '#c79bff', donma: '#bfe9ff', yetikov: '#ffa05a', dev: '#ff8ad0' };
function buffColor(id) {
  if (BUFF_COL[id]) return BUFF_COL[id];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 85% 62%)`;
}
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), level: $('hud-level'), prog: $('hud-prog'), dot: $('hud-dot'), tons: $('hud-tons'), combo: $('hud-combo'),
      floats: $('floats'), banner: $('banner'), hint: $('hint'),
      menu: $('menu'), menuLevel: $('menu-level'), menuStars: $('menu-stars'), daily: $('btn-daily'),
      result: $('result'), resTitle: $('res-title'), resStars: $('res-stars'), resPct: $('res-pct'), resTons: $('res-tons'), resSub: $('res-sub'), resBadge: $('res-badge'),
      next: $('btn-next'), retry: $('btn-retry'), menuBtn: $('btn-menu'), toast: $('toast'), pause: $('pause'), debug: $('debug'),
      sound: $('btn-sound'), haptic: $('btn-haptic'),
      coins: $('hud-coins'), vitals: $('hud-vitals'), pips: $('hud-pips'), grow: $('hud-grow'), powers: $('hud-powers'),
      yeti: $('hud-yeti'), yetiFill: $('hud-yetifill'), yetiLbl: $('hud-yeti-lbl'), goal: $('hud-goal'), goalFill: $('hud-goal-fill'), goalLbl: $('hud-goal-lbl'),
      flow: $('hud-flow'), flowFill: $('hud-flow-fill'), flowLbl: $('hud-flow-lbl'), record: $('hud-record'), resExtra: $('res-extra'), resCoins: $('res-coins'), menuBest: $('menu-best'), resLabel: document.querySelector('.res-label'),
      // v2
      buffs: $('buffs'), buffFly: $('buff-fly'), hunger: $('hunger'), hgFill: $('hg-fill'), hgIco: $('hg-ico'), turn: $('turn-cue'), stomp: $('stomp'),
      cigHud: $('cig-hud'), cgTn: $('cg-tn'), cgFill: $('cg-fill'), cgDist: $('cg-dist'), cgBest: $('cg-best'), cigBanner: $('cig-banner'), cbN: $('cb-n'),
      toastSoft: $('toast-soft'), tutor: $('tutor'), revive: $('revive-panel'), rvTitle: $('rv-title'), rvDist: $('rv-dist'), btnRevive: $('btn-revive'), btnReviveEnd: $('btn-revive-end'),
    };
    this.floatCount = 0;
    try { meta.onStamp((d) => this.toastSoft(`Yeni damga: ${d.name}!`, { icon: d.icon })); } catch { /* ignore */ }
    this.lastTonsText = '';
    this.pulseT = 0;
    this.timers = [];
    this.buffMap = new Map();
    this.reviveFn = null;
    this._lastFloat = 0;
    this._banAt = 0; this._banLv = 0;
    this._tcDir = 0; this._tcU = -1; this._hgOn = false; this._hgQ = -1; this._hgHue = -1; this._hgWarn = false;
    this._stompAt = 0; this._cg = { kg: -1, tnRaw: null, fill: -1, dm: -1, bk: -1 };
    this._tsLast = ''; this._tsAt = 0;
    this._ms = 0; this._tkAt = 0; this._noTick = 0; this._pre = null; this._best = 0; this._bestD = 0; this._hc = null;
    this._tutorTap = null;
    // A revive button wired through the result payload (onRevive) must win over any generic btn-next handler.
    this.el.next?.addEventListener('click', (e) => {
      if (this.reviveFn) { e.stopImmediatePropagation(); e.stopPropagation(); const fn = this.reviveFn; snd('ui', 'confirm'); try { fn(); } catch { /* the runner decides; never break the button */ } }
    });
    this.el.tutor?.addEventListener('click', (e) => { e.stopPropagation(); const fn = this._tutorTap; this.runnerTutor(null); if (fn) fn(); });
  }

  on(id, fn) {
    $(id).addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
  }

  showMenu({ level, stars, dailyNum, dailyBest, theme }) {
    hideBoot();
    this.clearTimers();
    this.el.menu.classList.remove('hidden');
    this.el.result.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.add('hidden');
    this.resetHud();
    this.el.menuLevel.textContent = theme ? `DAĞ ${level} · ${theme.toLocaleUpperCase('tr-TR')}` : `DAĞ ${level}`;
    this.el.menuStars.innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
    this.el.daily.textContent = dailyBest ? `🏔️ GÜNÜN DAĞI #${dailyNum} · ${fmtTons(dailyBest)}` : `🏔️ GÜNÜN DAĞI #${dailyNum}`;
  }

  // Clears every v2 HUD widget (buffs, hunger, turn arrow, stomp text, ÇIĞ block, banners, tutor, revive).
  resetHud() {
    this._sc = this._co = this._di = this._mu = null; this._rg = 0; // HUD number caches: the next frame rewrites everything
    this._prog = -1;
    this.lastVitals = '';
    this.el.hud.classList.remove('rush');
    this.buffClear();
    this.turnCue(0);
    this.hungerHide();
    this.cigReset();
    this.el.stomp.classList.add('hidden');
    this.el.cigBanner.classList.remove('on'); this.el.cigBanner.classList.add('hidden');
    this.el.buffFly.innerHTML = '';
    this._annReset();
    this.el.toastSoft.innerHTML = '';
    this.el.toastSoft.classList.remove('res');
    this.runnerTutor(null);
    this.hideRunnerRevive();
    this.el.banner.innerHTML = '';
    this.el.banner.classList.remove('runner');
    this.reviveFn = null;
  }

  // ---------- endless mode (YETİ RUSH) ----------
  runnerHud(on, biomeName) {
    hideBoot();
    this.el.menu.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.result.classList.toggle('runner', on);
    this.el.hud.classList.toggle('hidden', !on);
    this.el.hud.classList.remove('cig-endless');
    this.el.coins.classList.toggle('hidden', !on);
    this.el.vitals.classList.toggle('hidden', !on);
    this.el.yeti.classList.toggle('hidden', !on);
    this.el.flow.classList.toggle('hidden', !on);
    this.resetHud();
    this.el.hud.classList.toggle('rush', on);
    if (!on) this.runnerDanger(0, 0, 0);
    this.runnerGoal(null); // the runner switches it on once it knows the next goal (endless only)
    this.runnerSurge(false);
    this.el.record.classList.toggle('hidden', !on);
    this.lastFlow = this.lastRec = null;
    this.lastVitals = '';
    if (!on) return;
    this.el.banner.classList.add('runner');
    this._annReset();
    this.el.level.textContent = String(biomeName || '').toLocaleUpperCase('tr-TR');
    this.el.floats.innerHTML = '';
    this.floatCount = 0;
    this._annReset();
    this.comboReset();
    this.scoreReset();
    this._ms = 0;
    this._pre = this._progSnap();   // XP / season at run start: the result screen animates its bars from here
    // the swipe hint only teaches brand-new players
    let runs = 0;
    try { runs = meta.stats().runs || 0; } catch { runs = 0; }
    this.hint(runs < 3, 'kaydır · yukarı: zıpla');
    this.lastBiome = biomeName;
  }

  // Persistent nodes (coins | metres | record gap): only the part that changed is rewritten, and a coin pickup pops the coin number.
  _coinsRender() {
    const el = this.el.coins;
    let h = this._hc;
    if (!h || h.p !== el) {
      const mk = (c) => { const s = document.createElement('span'); s.className = c; return s; };
      el.textContent = '';
      h = this._hc = { p: el, c: mk('hc-c'), d: mk('hc-d'), g: mk('rec-gap'), co: null, di: null, rg: -1, pt: 0 };
      el.append(h.c, '\n', h.d, h.g);
    }
    if (h.co !== this._co) {
      const up = h.co !== null && this._co > h.co;
      h.co = this._co; h.c.textContent = `❄️ ${this._co}`;
      if (up) { const t = performance.now(); if (t - h.pt > 90) { h.pt = t; pop(h.c, 1.22, 170); } }   // a flake stream pops ~10x a second at most
    }
    if (h.di !== this._di) { h.di = this._di; h.d.textContent = `${this._di} m`; }
    const rg = this._rg > 0 ? this._rg : 0;
    if (h.rg !== rg) { h.rg = rg; h.g.textContent = rg ? `\nREKOR −${rg} m` : ''; }
  }

  runnerStats(score, coins, mult, biomeT, dist, biomeName) {
    // numbers are compared first: no string building / Intl formatting on frames where nothing visible changed
    const sc = Math.round(score);
    if (sc !== this._sc) this.scoreTo(sc);
    if (coins !== this._co || dist !== this._di) { this._co = coins; this._di = dist; this._coinsRender(); }
    if (biomeName && biomeName !== this.lastBiome) { this.el.level.textContent = String(biomeName).toLocaleUpperCase('tr-TR'); this.lastBiome = biomeName; }
    const mm = mult > 1 ? mult : 0;
    if (mm !== (this._mu || 0)) { const up = Math.floor(mm) > Math.floor(this._mu || 0); this._mu = mm; this._cmRender(); if (up) pop(this._cmKu, 1.3, 260); }   // pop when the multiplier reaches a new whole step (x2 -> x3 ...)
    if (dist >= MILESTONE_STEP) {
      const k = milestoneIdx(dist, this._ms);
      if (k) { this._ms = k; if (!/^\d+-\d+ · /.test(this.lastBiome || '')) this.runnerMilestone(k); }   // campaign levels have their own finish line
    }
    this.setProgress(biomeT);
  }

  // Every 500 m: a gold pill under the HUD (centre announcement lane, milestone priority), edge glow and chime.
  runnerMilestone(k) {
    const txt = milestoneText(k), tag = milestoneTag(k);
    this._say('c', {
      text: 'ms' + k, prio: 2, ms: 1500,
      show: () => {
        const b = document.createElement('div');
        b.className = `b ms${k % 2 ? '' : ' km'}`;
        const n = document.createElement('b'); n.textContent = txt;
        const s = document.createElement('small'); s.textContent = tag;
        b.append(n, s);
        this.el.banner.innerHTML = '';
        this.el.banner.appendChild(b);
        this.flash('gold');
        snd('chime');
        return () => { b.getAnimations?.().forEach((an) => an.cancel()); b.style.opacity = '0'; this.el.banner.innerHTML = ''; };
      },
    });
  }

  // XP level fraction + season tokens right now (defaults when the meta layer is unavailable).
  _progSnap() {
    const s = { level: 1, frac: 0, xp: 0, tok: 0, sid: '', needs: [] };
    try { const li = meta.levelInfo(); s.level = li.level; s.frac = li.frac; s.xp = meta.xp; } catch { /* ignore */ }
    try { const se = meta.season(); s.tok = se.tokens; s.sid = se.id; s.needs = se.tiers.map((t) => t.need); } catch { /* ignore */ }
    return s;
  }

  // Size = health pips + growth, Yeti closeness, active power-ups. Understands both the old ({gap, yetiMax}) and the new
  // ({yeti: {mode: 'stumble'|'hold'|null, frac}}) shape.
  runnerVitals(v) {
    const { tier, tiers, grow, gap, yetiMax, helmet, helmetT, magnet, rocket, x2, superjump, sled, sledCd, yeti } = v;
    const ym = yeti ? yeti.mode || '' : '';
    const yf = yeti ? Math.round(clamp01(yeti.frac) * 50) : (yetiMax ? Math.round(clamp01(1 - gap / yetiMax) * 50) : 0);
    const L = this._vit || (this._vit = { tier: -2, g: -1, yf: -1, ym: '', h: 0, m: 0, r: 0, x: 0, s: 0, sl: 0, sc: 0 });
    const gq = Math.round(grow * 20);
    if (this.lastVitals !== '' && L.tier === tier && L.g === gq && L.yf === yf && L.ym === ym && L.h === (helmet ? 1 : 0) && L.m === (magnet ? 1 : 0) && L.r === (rocket ? 1 : 0)
      && L.x === (x2 ? 1 : 0) && L.s === (superjump ? 1 : 0) && L.sl === (sled ? 1 : 0) && L.sc === (sledCd ? 1 : 0)) return;
    L.tier = tier; L.g = gq; L.yf = yf; L.ym = ym; L.h = helmet ? 1 : 0; L.m = magnet ? 1 : 0; L.r = rocket ? 1 : 0; L.x = x2 ? 1 : 0; L.s = superjump ? 1 : 0; L.sl = sled ? 1 : 0; L.sc = sledCd ? 1 : 0;
    this.lastVitals = 'x';
    if (this.lastTier !== tier || !this.el.pips.children.length) {
      this.lastTier = tier;
      let html = '';
      for (let i = 0; i < tiers; i++) {
        const s = 12 + i * 3.5;
        const cls = i > tier ? 'off' : tier === 0 ? 'danger' : '';
        html += `<div class="pip ${cls}" style="width:${s}px;height:${s}px"></div>`;
      }
      this.el.pips.innerHTML = html;
    }
    this.el.grow.style.width = `${Math.round(clamp01(grow) * 100)}%`;
    if (yeti || yetiMax) {
      const close = yeti ? clamp01(yeti.frac) : clamp01(1 - gap / yetiMax);
      this.el.yetiFill.style.width = `${Math.round(close * 100)}%`;
      this.el.yeti.classList.toggle('close', yeti ? ym === 'stumble' : gap < 14);
      this.el.yetiLbl.textContent = ym === 'stumble' ? 'YETİ ARKANDA!' : ym === 'hold' ? 'YETİ ENSENDE' : '';
    }
    this.el.powers.textContent = `${sled ? '🛷' : ''}${helmet ? '⛑️' : ''}${magnet ? '🧲' : ''}${rocket ? '🚀' : ''}${x2 ? '✖️+3' : ''}${superjump ? '👟' : ''}`;
  }

  // red tick on the size bar when smashing costs snow
  runnerSizeTick() {
    const gb = $('hud-growbar');
    if (!gb) return;
    gb.classList.remove('tick');
    void gb.offsetWidth;
    gb.classList.add('tick');
    setTimeout(() => gb.classList.remove('tick'), 520);
  }

  // PAYLAŞ 📸 share-card button under TEKRAR (created once, re-armed per result)
  shareCardBtn(o) {
    let b = document.getElementById('btn-card');
    if (!b) { b = document.createElement('button'); b.id = 'btn-card'; b.className = 'btn big'; this.el.retry.after(b); }
    window.__cigUi = this;
    b.style.display = '';
    { const old = document.getElementById('btn-share'); if (old) old.style.display = 'none'; }   // the image card replaces the old text share
    b.textContent = 'PAYLAŞ 📸';
    b.classList.toggle('rec', !!o.isRec);
    b.onclick = () => { b.disabled = true; shareCard(o).finally(() => { b.disabled = false; }); };
  }

  // ---------- result screen (YETİ RUSH) ----------
  // p: { title?, cause?, killKind?, tip?, distance, score, coins, best, bestDist, isBest, isBestDist, canRevive, reviveCost, crystals,
  //      rank, toRecord, missions?, onRevive? }. No box overlay, no upgrade card, no chained popups.
  showRunnerResult(p) {
    const { distance = 0, score = 0, coins = 0, best = 0, canRevive = false, rank = 0, toRecord = 0, onRevive = null } = p || {};
    this.runnerDanger(0, 0, 0);
    this.chaseVig(0);
    this.runnerGoal(null);
    this.runnerSurge(false);
    this.clearTimers();
    // (the buff icons stay in the hidden #hud on purpose: a revive continues the same run with the same cards)
    this.turnCue(0);
    this.hideRunnerRevive();
    this.runnerTutor(null);
    this.el.hud.classList.add('hidden');
    this.el.coins.classList.add('hidden');
    this.el.flow.classList.add('hidden');
    this.el.record.classList.add('hidden');
    this.el.vitals.classList.add('hidden');
    this.el.yeti.classList.add('hidden');
    this.el.toastSoft.classList.add('res');
    this.hint(false);

    const dt = runnerDeathText(p && p.cause, p && p.killKind);
    const title = (p && p.cause && DEATH[p.cause] ? dt.title : p && p.title) || dt.title;
    let bestDist = p && p.bestDist;
    if (!(bestDist > 0)) { try { bestDist = save.runnerBestDist(); } catch { bestDist = 0; } }
    const isRec = !!(p && (p.isBestDist ?? p.isBest));
    const rk = recKind(isRec, score, this._best);   // _best / _bestD = records at the START of this run
    const anyRec = rk.dist || rk.score;

    // what the soft toasts / mission rows should say (queued mid-run notices are drained here, never shown during play)
    const mrep = this.missionBlock(p && p.missions);

    const ex = this.el.resExtra;
    let html = '';
    const tipTxt = (p && p.tip) || dt.tip;
    let note = '';
    if (isRec) note = '';
    else if (toRecord > 0 && toRecord < Math.max(400, distance * 0.6)) note = `Rekora ${fmtN(toRecord)} m kaldı!`;
    else if (rank > 0 && rank <= 3) note = `#${rank}. en iyi koşun`;
    const chips = [`<div class="rx-chip${anyRec ? ' gold' : ''}"><small>EN İYİ</small><b>${anyRec ? '★ ' : ''}${fmtN(Math.max(best, score))}</b></div>`];
    if (p && p.perk) chips.push(`<div class="rx-chip"><small>YETENEK</small><b>${p.perk.icon} ${tr(p.perk.name)}</b></div>`);
    if (coins) chips.push(`<div class="rx-chip"><small>KAZANÇ</small><b>❄️ +${fmtN(coins)}</b></div>`);
    if ((this._bestCombo || 0) >= 3) chips.push(`<div class="rx-chip"><small>KOMBO</small><b>🔥 x${this._bestCombo}</b></div>`);
    let seaTok = 0;
    try { seaTok = Math.floor(Number(p && (p.seasonTokens ?? (p.stats && p.stats.seasonTokens))) || meta.stats().seasonTokens || 0); } catch { seaTok = 0; }
    if (seaTok > 0) chips.push(`<div class="rx-chip"><small>SEZON</small><b>+${fmtN(seaTok)} 🧣</b></div>`);
    html += `<div class="rx-stats">${chips.join('')}</div>`;
    html += this.progressBlock();
    if (p && p.mutator) html += `<div class="rx-line">${tr('BU HAFTA: ' + p.mutator.name)} ${p.mutator.icon}${p.mutator.score > 1 ? ' · ' + tr('x' + p.mutator.score + ' puan') : ''}</div>`;
    if (p && p.weeklyBest) html += `<div class="rx-line">🏆 Haftalık rekor! ${fmtN(p.weeklyRecord || score)}</div>`;
    if (p && p.synergies) html += `<div class="rx-line">${tr('SİNERJİ:')} ${p.synergies.map((x) => tr(x)).join(' · ')}</div>`;
    const dly = p && p.daily;
    let shareTxt = '';
    if (dly) {
      const dm = Math.max(dly.best || 0, distance);
      shareTxt = `🏔 PATPAT Günün Rush'ı #${dly.num} — ${fmtN(distance)} m` + ((this._bestCombo || 0) >= 3 ? ` 🔥x${this._bestCombo}` : '');
      html += `<div class="rx-line">GÜNÜN RUSH'I #${dly.num}: ${fmtN(distance)} m${dm > distance ? ` · EN İYİ ${fmtN(dm)} m` : ''}</div>`;
    }
    if (!isRec && toRecord > 0 && distance >= 50) {
      const pr = Math.max(0, Math.min(1, distance / Math.max(1, distance + toRecord)));
      html = `<div class="rx-rec">REKORA ${fmtN(toRecord)} m KALDI!</div><div class="rx-prog"><b style="width:${Math.round(pr * 100)}%"></b></div>` + html;
    }
    if (note && !dly && !(html.includes('rx-rec'))) html += `<div class="rx-line">${note}</div>`;
    // ONE next-goal card: closest unfinished quest, else the next reward; full quest list behind a tap
    let qRows = [];
    try { const r = meta.missionsReport(); qRows = (r && r.rows) || []; } catch { qRows = []; }
    if (!qRows.length && Array.isArray(p && p.missions)) qRows = p.missions.slice(0, 3);
    qRows = qRows.slice(0, 3);
    let nq = null, nf = -1;
    for (const m of qRows) { if (m.done || !(m.goal > 0)) continue; const f = (m.value || 0) / m.goal; if (f > nf) { nf = f; nq = m; } }
    if (nq) {
      html += `<div class="rx-goal rx-next"><div class="rg-h">SIRADAKİ HEDEF</div><div class="rg-goal">${nq.icon || '📜'} ${nq.text} <b>${fmtN(Math.floor(nq.value || 0))}/${fmtN(nq.goal)}</b></div><div class="rg-b"><i class="gain" style="width:${Math.round(clamp01(nf) * 100)}%" data-to="${Math.round(clamp01(nf) * 100)}"></i></div></div>`;
    } else html += this.goalBlock(coins, true);
    if (mrep.html) {
      const dn = qRows.filter((m) => m.done).length;
      html += `<div class="rx-qtoggle">▸ Görevler ${dn}/${qRows.length}</div><div class="rx-qlist hidden">${mrep.html}</div>`;
    }
    if (!isRec && tipTxt) html += `<div class="rx-dim">${tipTxt}</div>`;
    ex.innerHTML = html;
    const qt = ex.querySelector('.rx-qtoggle');
    if (qt) qt.onclick = () => { const l = ex.querySelector('.rx-qlist'); const open = l.classList.toggle('hidden'); qt.textContent = qt.textContent.replace(/^[▸▾]/, open ? '▸' : '▾'); };
    ex.classList.toggle('hidden', !html);
    this.lastShareText = shareTxt;  // bottom PAYLAŞ uses it for the daily run
    const shb = ex.querySelector('.rx-share');
    if (shb) shb.onclick = () => { try { if (navigator.share) navigator.share({ text: shareTxt }).catch(() => {}); else navigator.clipboard?.writeText(shareTxt); shb.textContent = 'KOPYALANDI'; } catch { /* ignore */ } };

    this.el.result.classList.remove('hidden');
    this.el.result.classList.add('runner');
    this.shareCardBtn({ mode: 'YETİ RUSH', big: fmtN(distance), unit: 'metre', isRec, challenge: 'Beni geçebilir misin? 🏔️' });
    this.el.resTitle.textContent = title;
    this.el.resBadge.classList.toggle('hidden', !anyRec);
    this.el.resBadge.textContent = recTitle(rk);
    this.el.resLabel.textContent = 'metre';
    // a record shows what it beat; otherwise the target to chase
    const prevD = Math.round(this._bestD || 0);
    this.el.resSub.textContent = rk.dist ? (prevD > 0 ? `ÖNCEKİ REKOR ${fmtN(prevD)} m · +${fmtN(Math.max(0, distance - prevD))} m` : '')
      : rk.score ? `ÖNCEKİ SKOR REKORU ${fmtN(this._best)}` : `REKOR ${fmtN(bestDist)} m`;
    this.el.resCoins.classList.add('hidden');
    this.el.resCoins.innerHTML = '';

    // buttons: TEKRAR is the big thumb-zone button, MENÜ small, BENİ KURTAR only when you can really pay for it
    let cost = p && p.reviveCost ? p.reviveCost : 0;
    let cr = p && Number.isFinite(p.crystals) ? p.crystals : null;
    try { if (cr === null) cr = save.crystals(); } catch { cr = 0; }
    const coinRv = (p && p.coinRevive) || 0;
    const show = !!coinRv || (!!canRevive && cost > 0 ? cr >= cost : !!canRevive && cost === 0 && cr > 0);
    this.reviveFn = show && typeof onRevive === 'function' ? onRevive : null;
    this.el.next.classList.toggle('hidden', !show);
    this.el.next.classList.toggle('revive', show);
    this.el.next.classList.remove('next');
    this.el.next.textContent = show ? (coinRv ? `DEVAM ❄ ${coinRv}` : `BENİ KURTAR 💎${cost || 1}`) : '';
    this.el.next.classList.remove('rv-ring');
    if (show) { void this.el.next.offsetWidth; this.el.next.classList.add('rv-ring'); }   // 3 s countdown ring
    clearTimeout(this._rvTm); this._rvTm = show ? setTimeout(() => { this.el.next.classList.remove('rv-ring'); }, 3000) : 0;
    this.el.retry.classList.remove('hidden');
    // the one-tap TEKRAR carries the next target right under the thumb
    this.retryLabel(rk.dist ? `Rekoru geç: ${fmtN(distance)} m` : toRecord > 0 && distance >= 50 ? `Rekora ${fmtN(toRecord)} m kaldı!` : '');
    this.el.menuBtn.classList.remove('hidden');

    this.resultFx(anyRec);
    this.goalAnimate();
    this.countUp(distance, (v, e) => {
      this.el.resPct.textContent = `${fmtN(v)} m`;
      this.el.resTons.textContent = `SKOR ${fmtN(score * e)}`;
    }, 1400, { tick: true, done: () => this.resultScoreDone(anyRec) });
    this.flushNotices(mrep.notices);
  }

  // TEKRAR: big label + an optional small target line (no sub line = plain label, also used to reset it for other result screens)
  retryLabel(sub) {
    const b = this.el.retry;
    b.textContent = '↻ TEKRAR';
    if (sub) { const s = document.createElement('small'); s.className = 'rt-sub'; s.textContent = sub; b.appendChild(s); }
  }

  // SEVİYE (XP) and SEZON bars of the result: they start where they stood at the run start and fill up while the numbers count.
  progressBlock() {
    const pre = this._pre;
    if (!pre) return '';
    const cur = this._progSnap();
    const row = (cls, label, b, val) => `<div class="pg-row ${cls}${b.up ? ' up' : ''}"><span class="pg-l">${label}</span><div class="pg-b"><i class="gain" style="transform:scaleX(${b.from.toFixed(3)})" data-to="${b.to.toFixed(3)}"></i></div><b class="pg-v">${val}</b></div>`;
    const xb = xpBar(pre, cur), gx = Math.max(0, Math.round(cur.xp - pre.xp));
    let h = row('lv', `SEVİYE ${cur.level}${xb.up ? ' ▲' : ''}`, xb, gx ? `+${fmtN(gx)} XP` : '');
    if (cur.needs.length && pre.sid === cur.sid) {
      const sb = seasonBar(pre.tok, cur.tok, cur.needs), gt = cur.tok - pre.tok;
      if (!sb.done) h += row('sz', 'SEZON', sb, `${fmtN(cur.tok)}/${fmtN(sb.hi)} 🧣${gt > 0 ? ` +${fmtN(gt)}` : ''}`);
    }
    return `<div class="rx-pg">${h}</div>`;
  }

  // closest unfinished mission, e.g. '3/5 kombo'
  nearQuest(fb) {
    let rows = null;
    try { const r = meta.missionsReport(); rows = r && r.rows; } catch { rows = null; }
    if (!rows || !rows.length) rows = Array.isArray(fb) ? fb : [];
    let best = null, bf = -1;
    for (const m of rows) { if (m.done || !(m.goal > 0)) continue; const f = (m.value || 0) / m.goal; if (f > bf) { bf = f; best = m; } }
    return best ? `${fmtN(Math.floor(best.value || 0))}/${fmtN(best.goal)} ${best.text}` : '';
  }

  // Chase pressure: red screen-edge vignette, intensity 0..1 (called per frame; DOM touched only when the quantised value changes)
  chaseVig(k) {
    const q = Math.round(k * 12) / 12;
    if (q === this._cvK) return;
    this._cvK = q;
    let el = this._cvEl;
    if (!el) {
      if (!q) return;
      el = this._cvEl = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;transition:opacity .25s;background:radial-gradient(ellipse at center,rgba(255,0,0,0) 68%,rgba(220,20,20,.6) 100%)';
      document.body.appendChild(el);
    }
    el.style.opacity = String(q * 0.5);
  }

  // Missions block (3 rows + multiplier) for the result screens. Drains the queued notices.
  missionBlock(fallback) {
    let rep = null;
    try { rep = meta.missionsReport(); } catch { rep = null; }
    let notices = [];
    try { notices = meta.takeNotices(); } catch { notices = []; }
    const rows = rep && rep.rows ? rep.rows : Array.isArray(fallback) ? fallback.slice(0, 3) : [];
    if (!rows.length) return { html: '', notices };
    const mult = rep ? rep.mult : 1;
    const up = !!(rep && rep.setDone);
    let html = `<div class="rx-head"><span>GÖREVLER</span><span class="rx-mult${up ? ' up' : ''}">ÇARPAN x${mult}${up ? ' ▲' : ''}</span></div>`;
    for (const m of rows.slice(0, 3)) {
      const f = clamp01((m.value || 0) / (m.goal || 1));
      html += `<div class="rx-m${m.done ? ' done' : ''}${m.justDone ? ' just' : ''}"><span>${m.icon || '📜'}</span><span class="rx-t">${m.text}</span><span class="rx-b"><i style="width:${Math.round(f * 100)}%"></i></span><span class="rx-c">${m.done ? '✓' : ''}</span></div>`;
    }
    return { html, notices };
  }

  // The next thing coins can buy (a skin, a trail or an upgrade) as a progress bar.
  goalBlock(gained = 0, compact = false) {
    gained = Math.max(0, Number(gained) || 0);
    let g = null;
    try { g = nextGoal(save); } catch { g = null; }
    let li = null;
    try { li = meta.levelInfo(); } catch { li = null; }
    let dt = null;
    try {
      const ts = meta.dailyTasks().tasks.filter((t) => !t.done);
      ts.sort((x, y) => (y.value / y.goal) - (x.value / x.goal));
      dt = ts[0] || null;
    } catch { dt = null; }
    if (g && !(g.price > 0)) g = null;
    if (dt && !(dt.goal > 0)) dt = null;
    if (li && !(li.need > 0)) li = null;
    if (!g && !li && !dt) return '';
    if (compact) { if (g) { li = null; dt = null; } else if (li) dt = null; }
    let h = `<div class="rx-goal${compact ? ' rx-next' : ''}"><div class="rg-h">${compact ? 'SIRADAKİ HEDEF' : 'SONRAKİ ÖDÜL'}</div>`;
    const bar = (from, to, cls = '') => `<div class="rg-b ${cls}"><i class="gain" style="width:${Math.round(clamp01(from) * 100)}%" data-to="${Math.round(clamp01(to) * 100)}"></i></div>`;
    if (g) {
      const left = Math.max(0, g.price - g.have);
      const nm = String(g.name).replace(/\s*Sv\d+$/, '');
      const lv = (nm.match(/[aeıioöuüAEIİOÖUÜ](?=[^aeıioöuüAEIİOÖUÜ]*$)/) || ['e'])[0];
      const back = /[aıouAIOU]/.test(lv), endsV = /[aeıioöuüAEIİOÖUÜ]$/.test(nm);
      const dat = `${nm}'${endsV ? 'y' : ''}${back ? 'a' : 'e'}`;
      h += left > 0 ? `<div class="rg-goal">${g.icon} ${dat} <b>${fmtN(left)} ❄️</b> kaldı</div>` : `<div class="rg-goal">${g.icon} ${tr(g.name)} <b>${tr('HAZIR!')}</b></div>`;
      h += bar(g.price > 0 ? Math.max(0, g.have - gained) / g.price : 0, g.frac);
      h += `<div class="rg-sub"><span>${fmtN(g.have)} / ${fmtN(g.price)} ❄️</span>${gained ? `<em>+${fmtN(gained)}</em>` : ''}</div>`;
    }
    if (li) h += `<div class="rg-row"><span>SEVİYE ${li.level + 1}</span>${bar(li.frac, li.frac, 'sm')}<b>${fmtN(Math.max(0, li.need - li.cur))} XP</b></div>`;
    if (dt) h += `<div class="rg-row"><span>${dt.icon} ${String(dt.text).replace(/^[^:]+:s*/, '')}</span>${bar(dt.value / dt.goal, dt.value / dt.goal, 'sm')}<b>${fmtN(dt.value)}/${fmtN(dt.goal)}</b></div>`;
    return h + '</div>';
  }

  // Animate the NEXT REWARD bars from their pre-run fill to now.
  goalAnimate() {
    this.timers.push(setTimeout(() => {
      for (const i of this.el.resExtra.querySelectorAll('.rg-b i.gain')) i.style.width = `${i.dataset.to}%`;
      for (const i of this.el.resExtra.querySelectorAll('.pg-b i.gain')) i.style.transform = `scaleX(${i.dataset.to})`;   // transform: no layout work
    }, 900));
  }

  // One soft toast per completed mission (max 3), a multiplier toast when the set is done. Achievements are credited silently.
  flushNotices(list) {
    if (!list || !list.length) return;
    let n = 0;
    for (const x of list) {
      if (x.kind === 'mission' && n < 3) { const t = x; this.timers.push(setTimeout(() => this.toastSoft(`${t.icon || '🎯'} ${tr('GÖREV TAMAM:')} ${tr(t.text)}`), 700 + n * 900)); n++; }
      else if (x.kind === 'missionset') {
        const t = x, r = x.reward || {};
        const gift = `${r.coins ? ` · +❄️${fmtN(r.coins)}` : ''}${r.crystals ? ` +💎${r.crystals}` : ''}${r.boxes ? ' +🎁' : ''}`;
        this.timers.push(setTimeout(() => this.toastSoft(`✖️ ÇARPAN x${t.multiplier}!${gift || ' Görev seti tamam'}`), 700 + n * 900));
        n++;
      }
    }
  }

  countUp(target, fn, dur = 800, opt = null) {
    const t0 = performance.now();
    let lastTick = 0;
    const tick = () => {
      const now = performance.now();
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      fn(target * e, e);
      if (opt && opt.tick && k < 1 && now - lastTick > 65) { lastTick = now; snd('ui'); }
      if (k < 1) this.raf = requestAnimationFrame(tick);
      else if (opt && opt.done) opt.done();
    };
    tick();
  }

  // Result-screen juice shared by both result screens: stat rows slide in, coins fly to the counter, record = confetti + glow.
  resultFx(rec) {
    const R = this.el.result;
    R.classList.remove('rec');
    this.el.resTons.classList.remove('pop');
    let i = 0;
    for (const ch of this.el.resExtra.children) { ch.classList.add('slidein'); ch.style.animationDelay = `${0.5 + i * 0.12}s`; i++; }
    if (rec) {
      R.classList.add('rec');
      if (!reduceMotion()) this.timers.push(setTimeout(() => this.confetti(), 1100));
    }
    if (!reduceMotion()) this.timers.push(setTimeout(() => this.coinFly(), 1000));
  }

  resultScoreDone(rec) {
    const t = this.el.resTons;
    t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
    if (rec) { pop(this.el.resPct, 1.14, 420); snd('chime'); } else snd('ui', 'confirm');
  }

  confetti() {
    const R = this.el.result;
    const cols = ['#ffd23a', '#ff5c8a', '#4fd3ff', '#7dff6a', '#fff', '#b46bff'];
    const box = document.createElement('div');
    box.className = 'confetti';
    let h = '';
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 190;
      h += `<i style="background:${cols[i % cols.length]};--x:${Math.round(Math.cos(a) * r)}px;--y:${Math.round(Math.sin(a) * r - 60)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;animation-delay:${(Math.random() * 0.15).toFixed(2)}s"></i>`;
    }
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; h += `<b style="--x:${Math.round(Math.cos(a) * 130)}px;--y:${Math.round(Math.sin(a) * 130 - 60)}px">★</b>`; }
    box.innerHTML = h;
    R.appendChild(box);
    snd('chime');
    setTimeout(() => box.remove(), 2200);
  }

  coinFly() {
    const dst = this.el.resCoins, src = this.el.resPct;
    if (!dst || dst.classList.contains('hidden') || !dst.textContent) return;
    let a, b;
    try { a = src.getBoundingClientRect(); b = dst.getBoundingClientRect(); } catch { return; }
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('div');
      c.className = 'coin-fly';
      c.textContent = '❄️';
      c.style.left = `${a.left + a.width / 2}px`; c.style.top = `${a.top + a.height / 2}px`;
      this.el.result.appendChild(c);
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      try {
        const an = c.animate([{ transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1 }, { transform: `translate(calc(-50% + ${dx * 0.5 + (i - 3) * 14}px),calc(-50% + ${dy * 0.3 - 30}px)) scale(1)`, opacity: 1, offset: 0.5 }, { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0.5)`, opacity: 0.6 }], { duration: 650, delay: i * 70, easing: 'ease-in', fill: 'backwards' });
        an.onfinish = () => { c.remove(); if (i === 5) { dst.classList.remove('pop'); void dst.offsetWidth; dst.classList.add('pop'); snd('ui'); } };
      } catch { c.remove(); }
    }
  }

  hideResult() {
    this.el.result.classList.remove('rec');
    this.el.result.querySelectorAll('.confetti,.coin-fly').forEach((n) => n.remove());
    this.clearTimers(); // pending "GÖREV TAMAM" toasts / count-ups belong to the result screen, not to the continued run
    this.el.toastSoft.classList.remove('res');
    this.el.toastSoft.innerHTML = '';
    this.el.result.classList.add('hidden');
    this.el.flow.classList.remove('hidden');
    this.lastFlow = null;
    this.el.record.classList.remove('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.coins.classList.remove('hidden');
    this.el.vitals.classList.remove('hidden');
    this.el.yeti.classList.remove('hidden');
    this.reviveFn = null;
    this.lastVitals = '';
  }

  // Compat revive panel (thumb zone): the runner may still open it instead of putting BENİ KURTAR on the result screen.
  showRunnerRevive({ title, distance, cost, crystals }) {
    this.el.rvTitle.textContent = title || 'PATLADIN!';
    this.el.rvDist.textContent = `${fmtN(distance || 0)} m`;
    this.el.btnRevive.textContent = `BENİ KURTAR 💎${cost}`;
    this.el.btnRevive.classList.toggle('poor', Number.isFinite(crystals) && crystals < cost);
    this.el.btnReviveEnd.textContent = 'BİTİR';
    this.el.revive.classList.remove('hidden');
  }

  hideRunnerRevive() { this.el.revive.classList.add('hidden'); }

  // A red "!" over the lane something is coming down/at you (boulder shadow, oncoming snowcat).
  laneWarn(lane, kind, x, y) {
    const now = performance.now();
    if (now - (this._laneAt || 0) < 500) return;
    this._laneAt = now;
    const d = document.createElement('div');
    d.className = 'lane-warn';
    d.textContent = kind === 'boulder' ? '⚠' : '❗';
    if (Number.isFinite(x)) {
      // the runner projected the threat onto the screen: put the sign right there (kept off the very top / bottom edge)
      const H = window.innerHeight || 800;
      d.style.left = `${Math.round(Math.max(24, Math.min((window.innerWidth || 390) - 24, x)))}px`;
      if (Number.isFinite(y)) d.style.top = `${Math.round(Math.max(H * 0.2, Math.min(H * 0.62, y - 36)))}px`;
    } else d.style.left = `${50 + (lane - 1) * 26}%`;
    this.el.floats.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  // Compat for the old pick-1-of-3 cards: nothing blocks any more. Mid-run cards are resolved immediately (random pick) and shown
  // as a soft toast; the post-run permanent-upgrade card is never shown (upgrades are bought with ❄️ in the shop).
  showPerks(cards, title, onPick) {
    if (!cards || !cards.length) return;
    if (/KALICI/i.test(String(title))) return;
    const c = cards[Math.floor(Math.random() * cards.length)];
    this.toastSoft(`${c.icon} ${c.name}`);
    try { onPick && onPick(c); } catch { /* ignore */ }
  }

  // Score bonuses are additive now (they add to the x-multiplier): danger / chain / risk are the +N each contributes.
  runnerDanger(danger, chain, risk) {
    // called every frame: nothing is built (no array / string) unless one of the three numbers changed
    if (danger === this._dgD && chain === this._dgC && risk === this._dgR) return;
    this._dgD = danger; this._dgC = chain; this._dgR = risk;
    const el = this.dangerEl || (this.dangerEl = document.getElementById('danger'));
    const parts = [];
    if (risk) parts.push(`RİSK +${risk}`);
    if (danger > 0) parts.push(`TEHLİKE +${danger}`);
    if (chain > 0) parts.push(`ZİNCİR +${chain}`);
    const t = parts.join(' · ');
    if (t !== this.lastDanger) {
      this.lastDanger = t;
      el.textContent = t;
      el.classList.toggle('hidden', !t);
    }
  }

  // Goal strip under the score: mode 'cp' = next checkpoint (val = its distance), 'rec' = record in reach (val = metres
  // left), 'rage' = the Yeti's boulder barrage (fill = how much of it is behind you), 'new' = record just broken.
  // mode null hides it (campaign, menus). Only touches the DOM when something visible changed.
  runnerGoal(mode, val = 0, frac) {
    if (mode === 'fury') { if (frac === undefined) frac = val; val = 0; }
    if (frac === undefined) frac = 0;
    if (mode === 'cp' && frac < 0.8) mode = null;   // declutter: the checkpoint strip only shows in the last 20% of a layer
    const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    if (mode === this.gMode && val === this.gVal && pct === this.gPct) return;
    const g = this.el.goal, mChanged = mode !== this.gMode;
    if (mChanged) {
      g.classList.toggle('hidden', !mode);
      this.el.hud.classList.toggle('has-goal', !!mode);
      g.classList.remove('cp', 'rec', 'rage', 'new', 'fury');
      if (mode) g.classList.add(mode === 'boss' ? 'rage' : mode === 'fury' ? 'fury' : mode === 'cannon' ? 'rec' : mode);
    }
    if (mode && (mChanged || val !== this.gVal)) {
      this.el.goalLbl.textContent = mode === 'cp' ? `SIRADAKİ: ${val} m` : mode === 'rec' ? `REKORA ${val} m` : mode === 'new' ? 'YENİ REKOR!' : mode === 'cannon' ? `KAR KANONU: ${val}` : mode === 'boss' ? 'YETİ ÖNÜNDE!' : mode === 'fury' ? 'YETİ ÖFKESİ' : '⚠ YETİ ÖFKESİ';
    }
    if (mode && (mChanged || pct !== this.gPct)) this.el.goalFill.style.width = `${pct}%`;
    this.gMode = mode; this.gVal = val; this.gPct = pct;
  }

  // Checkpoint passed: the strip bounces.
  runnerGoalPop() {
    const g = this.el.goal;
    g.classList.remove('pop');
    void g.offsetWidth; // restart the animation
    g.classList.add('pop');
    clearTimeout(this.popT);
    this.popT = setTimeout(() => g.classList.remove('pop'), 650); // so the rage / record pulse can take over again
  }

  // Yeti lunge window: the Yeti gauge shakes red.
  runnerSurge(on) {
    if (on === this.surgeOn) return;
    this.surgeOn = on;
    this.el.yeti.classList.toggle('surge', on);
  }

  runnerFlow(lvl, frac) {
    const key = lvl * 100 + Math.round(frac * 50);
    if (key === this.lastFlow) return;
    this.lastFlow = key;
    this.el.flowFill.style.width = `${Math.round(frac * 100)}%`;
    this.el.flowLbl.textContent = lvl ? `AKIŞ +${lvl}` : 'AKIŞ';
    this.el.flow.className = `hud-flow l${lvl}${lvl === 0 && frac < 0.04 ? ' hidden' : ''}`;   // declutter: only while a streak is alive
  }

  // runnerRecord(bestDist, dist): distance record flag. Old callers pass only a score and get a plain label.
  runnerRecord(best, dist) {
    if (dist === undefined) {
      if (best === this.lastRec) return;
      this.lastRec = best;
      this.el.record.textContent = best ? `REKOR ${Math.round(best).toLocaleString('tr-TR')}` : '';
      return;
    }
    const over = dist > best;
    const rg = !over && best >= 50 && best - dist <= 150 ? Math.max(1, Math.ceil(best - dist)) : 0;
    if (rg !== (this._rg || 0)) { this._rg = rg; if (this._co != null) this._coinsRender(); }
    const km = over ? Math.floor(dist / 1000) : -1;
    const bq = Math.round(best);
    if (bq === this._rb && km === this._rk && this.lastRec === 'd') return;
    this._rb = bq; this._rk = km; this.lastRec = 'd';
    if (!best) { this.el.record.textContent = ''; return; }
    this.el.record.textContent = over ? `HEDEF ${km + 1} km` : `REKOR ${fmtN(best)} m`;
  }

  speedLines(k) {
    const el = this.speedEl || (this.speedEl = document.getElementById('speedlines'));
    const v = Math.max(0, Math.min(1, k));
    const q = Math.round(v * 10) / 10;
    if (q !== this.lastSpeed) { this.lastSpeed = q; el.style.opacity = String(q * 0.4); }
  }

  // No full-screen white flash: every kind is a soft edge vignette ('hit' red, 'gold' gold, the rest barely-there white).
  flash(kind = 'hit') {
    const el = this.flashEl || (this.flashEl = document.getElementById('flash'));
    const now = performance.now();
    if (now - (this._flashAt || 0) < 250) return;
    this._flashAt = now;
    el.className = '';
    void el.offsetWidth; // restart the animation
    el.className = kind;
  }

  setMenuBest(text) { this.el.menuBest.textContent = text; }

  startRun(label) {
    hideBoot();
    this.clearTimers();
    this.resetHud();
    this.el.resExtra?.classList.add('hidden');
    this.el.flow?.classList.add('hidden');
    this.el.record?.classList.add('hidden');
    this.el.vitals.classList.add('hidden');
    this.el.yeti.classList.add('hidden');
    this.el.result.classList.remove('runner');
    this.el.resCoins.classList.add('hidden');
    this.el.resLabel.textContent = 'kasaba yıkıldı';
    this.el.coins.classList.add('hidden');
    this.runnerGoal(null);
    this.el.hud.classList.remove('cig-endless');
    this.el.menu.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.level.textContent = label;
    this.el.floats.innerHTML = '';
    this.floatCount = 0;
    this._annReset();
    this.comboReset();
    this.scoreReset();
  }

  hint(on, text = 'sürükle') {
    this.el.hint.classList.toggle('hidden', !on);
    if (on) this.el.hint.lastElementChild.textContent = text;
    clearTimeout(this._hintT);
    if (on) this._hintT = setTimeout(() => this.el.hint.classList.add('hidden'), 2000);
  }

  setTons(t) {
    const s = fmtTons(t);
    if (s !== this.lastTonsText) {
      this.el.tons.textContent = s;
      this.lastTonsText = s;
    }
  }

  pulse() {
    this.el.tons.classList.add('pulse');
    clearTimeout(this.pulseT);
    this.pulseT = setTimeout(() => this.el.tons.classList.remove('pulse'), 90);
  }

  setProgress(p) {
    const q = Math.round(Math.max(0, Math.min(1, p)) * 200) / 2; // 0.5 % steps: no DOM write when nothing visibly changed
    if (q === this._prog) return;
    this._prog = q;
    const v = `${q}%`;
    this.el.prog.style.width = v;
    this.el.dot.style.left = v;
  }

  // ÇIĞ swallow combo (external): same counter as the derived Yeti Rush one
  setCombo(n) {
    if (n > 0) this._extCombo = true;
    this._comboSet(n, 3200);
  }

  comboReset() {
    clearTimeout(this._dT);
    this._dN = 0; this._cmN = 0; this._mu = 0; this._bestCombo = 0; this._extCombo = false; this._cmT = 0;
    if (this._cmb) this._cmb.className = 'cmb';
  }

  _mkCmb() {
    const c = document.createElement('div');
    c.className = 'cmb';
    c.innerHTML = '<span class="cmb-n"></span><i class="cmb-bar"><b></b></i>';
    this._cmK = document.createElement('b'); this._cmK.className = 'ch k';
    this._cmKs = document.createElement('small'); this._cmKe = document.createElement('em'); this._cmKu = document.createElement('u');
    this._cmK.append(this._cmKs, this._cmKe, this._cmKu);
    this._cmM = document.createElement('b'); this._cmM.className = 'ch m';
    c.firstChild.appendChild(this._cmK); c.firstChild.appendChild(this._cmM);
    this.el.hud.appendChild(c);
    this._cmb = c; this._cmn = c.firstChild; this._cmbar = c.lastChild.firstChild;
    return c;
  }

  // one tidy row under the score: 'KOMBO x34 · x5 SKOR' (+ drain bar beneath while a combo runs)
  _cmRender() {
    const c = this._cmb || this._mkCmb();
    if (c.classList.contains('broke')) return;
    const n = this._cmN >= 3 ? this._cmN : 0, mu = this._mu || 0;
    if (!n) { if (c.classList.contains('on')) c.className = 'cmb'; return; }
    // ONE small chip: 'KOMBO x34 · x5' (the multiplier rides inside it, no second chip, no drain bar)
    this._cmKs.textContent = 'KOMBO'; this._cmKe.textContent = `x${n}`; this._cmKe.dataset.t = `x${n}`; this._cmKu.textContent = mu > 1 ? `x${Math.round(mu * 10) / 10} SKOR` : '';
    this._cmK.style.display = n ? '' : 'none';
    this._cmM.textContent = '';
    this._cmM.style.display = 'none';
    this._cmM.className = `ch m m${Math.min(4, Math.max(0, Math.floor(mu) - 1))}`;
    if (!n) { const lv = mu >= 6 ? 3 : mu >= 4 ? 2 : mu >= 3 ? 1 : 0; c.className = `cmb on t${lv} nobar`; }
  }

  _comboSet(n, drainMs) {
    const c = this._cmb || this._mkCmb();
    if (n >= 3) {
      if (n === this._cmN) return;
      const rose = n > this._cmN;
      this._cmN = n;
      if (n > (this._bestCombo || 0)) this._bestCombo = n;
      const t = n >= 50 ? 4 : n >= 20 ? 3 : n >= 10 ? 2 : n >= 5 ? 1 : 0;
      const tierUp = t > (this._cmT || 0);
      this._cmT = t;
      c.className = `cmb on t${t}`;
      this._cmRender();
      void c.offsetWidth;
      c.classList.add(tierUp ? 'tierup' : 'hit');
      if (tierUp) snd('chime');
      if (rose) {
        const b = this._cmbar;
        b.style.transition = 'none'; b.style.transform = 'scaleX(1)';
        void b.offsetWidth;
        b.style.transition = `transform ${drainMs}ms linear`; b.style.transform = 'scaleX(0)';
      }
    } else if (this._cmN >= 3) {
      this._cmN = 0; this._cmT = 0;
      this._cmKs.textContent = ''; this._cmKe.textContent = 'KOMBO KIRILDI'; this._cmKe.dataset.t = ''; this._cmKu.textContent = ''; this._cmK.style.display = ''; this._cmM.style.display = 'none';
      c.className = 'cmb broke';
      clearTimeout(this._cmBk);
      this._cmBk = setTimeout(() => { if (c.classList.contains('broke')) { c.className = 'cmb'; this._cmRender(); } }, 1150);
    }
  }

  // ---------- score feel: smooth count-up, bump + flash on big chunks, milestones, popups, record ribbon ----------
  scoreReset() {
    cancelAnimationFrame(this._sraf);
    this._sraf = 0; this._disp = 0; this._tgt = 0; this._rate = 0; this._sc = -1; this._shown = -1; this._recShown = false; this._pops = 0;
    let b = 0;
    try { b = save.runnerBest(); } catch { b = 0; }
    this._best = b;
    try { this._bestD = save.runnerBestDist() || 0; } catch { this._bestD = 0; }   // before this run: the result screen shows the improvement
    this._noTick = 0;
    this.el.tons.className = 'hud-tons';
    this.el.tons.textContent = '0';
  }

  scoreTo(sc) {
    const prev = this._sc < 0 ? 0 : this._tgt;
    this._sc = sc; this._tgt = sc;
    const delta = sc - prev;
    if (delta < 0) { this._disp = sc; this._shown = sc; this.el.tons.textContent = fmtN(sc); this.lastTonsText = this.el.tons.textContent; return; }
    const big = delta >= 20 && delta > this._rate * 4 + 10;
    if (!big) this._rate = this._rate * 0.9 + delta * 0.1;
    const el = this.el.tons;
    const now = performance.now();
    if (big) {
      const k = delta >= 300 ? 1.5 : delta >= 100 ? 1.3 : 1.18;
      this._noTick = now + 450;
      if (!reduceMotion()) { try { el.animate([{ transform: 'scale(1)', color: '#fff' }, { transform: `scale(${k})`, color: '#ffd23a', offset: 0.3 }, { transform: 'scale(1)', color: '#fff' }], { duration: 420, easing: 'cubic-bezier(.2,1.6,.4,1)' }); } catch { /* optional */ } }
      this.scorePop(delta);
      this.comboDerive();
    } else if (delta >= 8 && now - this._tkAt > 170 && now > this._noTick) {
      this._tkAt = now;   // a small pickup-sized chunk (the steady distance drip is 1-4 a frame and stays calm): light tick, max ~6 a second
      pop(el, 1.07, 130);
    }
    const m = (v, st) => Math.floor(v / st);
    if (m(sc, 1000) > m(prev, 1000)) {
      const ms = m(sc, 10000) > m(prev, 10000) ? 3 : m(sc, 5000) > m(prev, 5000) ? 2 : 1;
      this._noTick = now + (ms === 3 ? 1900 : ms === 2 ? 1400 : 1000);   // the gold flourish owns the transform meanwhile
      el.classList.remove('gold1', 'gold2', 'gold3'); void el.offsetWidth; el.classList.add(`gold${ms}`);
      snd('chime');
    }
    if (!this._recShown && this._best > 0 && sc > this._best) { this._recShown = true; this.recRibbon(); }
    if (!this._sraf) this._sraf = requestAnimationFrame(this._scoreTick || (this._scoreTick = () => this.scoreStep()));
  }

  scoreStep() {
    this._sraf = 0;
    const d = this._tgt - this._disp;
    this._disp = Math.abs(d) < 1.5 ? this._tgt : this._disp + d * 0.2;
    const r = Math.round(this._disp);
    if (r !== this._shown) { this._shown = r; const s = fmtN(r); this.el.tons.textContent = s; this.lastTonsText = s; }
    if (this._disp !== this._tgt) this._sraf = requestAnimationFrame(this._scoreTick);
  }

  scorePop(delta) {
    if (this._pops >= 3 || typeof document === 'undefined' || reduceMotion()) return;
    this._pops++;
    const d = document.createElement('div');
    d.className = 'score-pop';
    d.textContent = `+${fmtN(delta)}`;
    this.el.hud.appendChild(d);
    let dx = 0, dy = -90;
    const W = window.innerWidth || 390, H = window.innerHeight || 800;
    try { const r = this.el.tons.getBoundingClientRect(); dx = r.left + r.width / 2 - W / 2; dy = r.top + r.height / 2 - H * 0.3; } catch { /* default */ }
    const done = () => { d.remove(); this._pops--; };
    try {
      const a = d.animate([{ transform: 'translate(-50%,0) scale(0.6)', opacity: 0 }, { transform: 'translate(-50%,0) scale(1.35)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,0) scale(1.2)', opacity: 1, offset: 0.4 }, { transform: `translate(calc(-50% + ${dx}px),${dy}px) scale(0.45)`, opacity: 0.1 }], { duration: 750, easing: 'ease-in' });
      a.onfinish = done;
    } catch { done(); }
  }

  recRibbon() {
    snd('chime');
    this.toastSoft('★ YENİ REKOR!');
  }

  // no combo data from the runner: a big score chunk is a combo hit, 2.2 s without one breaks it
  comboDerive() {
    if (this._extCombo) return;
    this._dN = (this._dN || 0) + 1;
    this._comboSet(this._dN, 2200);
    clearTimeout(this._dT);
    this._dT = setTimeout(() => { this._comboSet(0); this._dN = 0; }, 2200);
  }

  // Floating text is rationed (plain ones at most one a second) and never piles up. Big/bad ones are announcements:
  // they go through the single centre channel (bad = danger, big = milestone) and are dropped when blocked.
  float(text, x, y, cls = '') {
    const now = performance.now();
    const prio = cls === 'big' || cls === 'bad';
    if (this.el.hud.classList.contains('rush') && y < window.innerHeight * 0.27) y = window.innerHeight * 0.27;   // never into the top HUD block
    const mk = () => {
      const d = document.createElement('div');
      d.className = `float ${cls}`;
      d.textContent = text;
      d.style.left = `${x}px`;
      d.style.top = `${y}px`;
      this.floatCount++;
      let gone = false;
      const rm = () => { if (gone) return; gone = true; this.floatCount--; d.getAnimations?.().forEach((an) => an.cancel()); d.style.opacity = '0'; d.remove(); };
      d.addEventListener('animationend', rm);
      this.el.floats.appendChild(d);
      setTimeout(rm, 2200);      // hard max lifetime: a float can never linger
      return rm;
    };
    if (prio) {
      this._say('c', { text, prio: cls === 'bad' ? 3 : 2, ms: 1100, drop: true, show: mk });
      return;
    }
    if (now - this._lastFloat < 1000 || this.floatCount > 2) return;
    this._lastFloat = now;
    mk();
  }

  banner(text, level = 1) {
    const t = String(text);
    const count = /^\d+$/.test(t);   // countdown digits replace each other instantly
    this._say('c', {
      text: t, prio: level >= 4 ? 3 : level >= 2 ? 2 : 1, ms: count ? 900 : 1400, count,
      show: () => {
        const b = document.createElement('div');
        b.className = `b l${level}`;
        b.textContent = t;
        this.el.banner.innerHTML = '';
        this.el.banner.appendChild(b);
        return () => { b.getAnimations?.().forEach((an) => an.cancel()); b.style.opacity = '0'; this.el.banner.innerHTML = ''; };
      },
    });
  }

  // ---------- v2 HUD API ----------

  // ---- buff cards: icon + radial countdown top-right, a 1 s fly-in card at the top edge on add ----
  buffAdd(id, icon, name, secs) {
    id = String(id);
    let b = this.buffMap.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'buff';
      el.style.setProperty('--bc', buffColor(id));
      el.style.setProperty('--p', '1');
      el.innerHTML = '<span class="bi"></span>';
      el.firstChild.textContent = icon || '✨';
      el.setAttribute('aria-label', name || id);
      this.el.buffs.appendChild(el);
      b = { el, q: 72, total: secs, low: false };
      this.buffMap.set(id, b);
    } else {
      b.total = secs; b.q = 72; b.low = false;
      b.el.classList.remove('low', 'out');
      b.el.style.setProperty('--p', '1');
    }
    try { meta.track('buff', { id }); } catch { /* ignore */ }
    snd('chime');
    // fly-in card
    if (!this.el.hud.classList.contains('rush')) this._say('c', { text: 'buff:' + name, prio: 2, ms: 1000, drop: true, show: () => this._buffCardNow(b, icon, name, secs) });
  }

  _buffCardNow(b, icon, name, secs) {
    {
      const card = document.createElement('div');
      card.className = 'buff-card';
      const ic = document.createElement('div'); ic.className = 'bc-i'; ic.textContent = icon || '✨';
      const tx = document.createElement('div');
      const nm = document.createElement('div'); nm.className = 'bc-n'; nm.textContent = name || '';
      const sb = document.createElement('div'); sb.className = 'bc-s'; sb.textContent = `${fmtClock(secs)} SÜRESİNCE`;
      tx.appendChild(nm); tx.appendChild(sb);
      card.appendChild(ic); card.appendChild(tx);
      const r = b.el.getBoundingClientRect();
      const W = window.innerWidth || 390;
      card.style.setProperty('--dx', `${Math.round(r.left + r.width / 2 - W / 2)}px`);
      card.style.setProperty('--dy', `${Math.round(r.top + r.height / 2 - 188)}px`);
      card.addEventListener('animationend', () => card.remove());
      this.el.buffFly.appendChild(card);
    }
  }

  // list = [{id, left, total}] every ~0.25 s
  buffTick(list) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const b = this.buffMap.get(String(it.id));
      if (!b) continue;
      const total = it.total > 0 ? it.total : b.total || 1;
      const q = Math.round(clamp01(it.left / total) * 72);
      if (q !== b.q) { b.q = q; b.el.style.setProperty('--p', String(q / 72)); }
      const low = it.left > 0 && it.left <= Math.min(8, total * 0.3); // 90 s cards blink for their last 8 s, a 5 s power-up only at the very end
      if (low !== b.low) { b.low = low; b.el.classList.toggle('low', low); }
    }
  }

  buffRemove(id) {
    id = String(id);
    const b = this.buffMap.get(id);
    if (!b) return;
    this.buffMap.delete(id);
    b.el.classList.remove('low');
    b.el.classList.add('out');
    setTimeout(() => b.el.remove(), 320);
  }

  // ---- RUN-START PERK picker (Rush): 3 big cards, one tap, auto-picks the first after `secs`; the runner waits meanwhile ----
  runnerPerkPick(perks, onPick, secs = 6) {
    if (this._perkEl) { clearTimeout(this._perkTm); clearInterval(this._perkIv); this._perkEl.remove(); this._perkEl = null; }
    if (!perks || !perks.length) return;
    const root = document.createElement('div');
    root.className = 'perk-pick';
    const h = document.createElement('div'); h.className = 'pp-h'; h.textContent = 'YETENEK SEÇ';
    root.appendChild(h);
    let done = false;
    const pick = (id) => {
      if (done) return; done = true;
      clearTimeout(this._perkTm); clearInterval(this._perkIv);
      root.classList.add('out'); setTimeout(() => root.remove(), 220);
      this._perkEl = null;
      snd('chime');
      onPick && onPick(id);
    };
    for (const p of perks) {
      const c = document.createElement('button');
      c.className = 'buff-card perk-card';
      c.innerHTML = '<div class="bc-i"></div><div><div class="bc-n"></div><div class="bc-s"></div></div>';
      c.children[0].textContent = p.icon;
      c.querySelector('.bc-n').textContent = p.name;
      c.querySelector('.bc-s').textContent = p.desc;
      c.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pick(p.id); });
      root.appendChild(c);
    }
    const bar = document.createElement('div'); bar.className = 'pp-bar'; bar.innerHTML = '<i></i>';
    root.appendChild(bar);
    const fill = bar.firstChild;
    document.body.appendChild(root);
    this._perkEl = root;
    const t0 = performance.now();
    fill.style.width = '100%';
    this._perkIv = setInterval(() => { fill.style.width = Math.max(0, 100 - ((performance.now() - t0) / (secs * 10))) + '%'; }, 100);
    this._perkTm = setTimeout(() => pick(perks[0].id), secs * 1000);
  }

  runnerMutator(text, title) {
    let el = this._mutChip;
    if (!text) { if (el) el.classList.add('hidden'); return; }
    if (!el) { el = this._mutChip = document.createElement('div'); el.className = 'mut-chip'; this.el.hud.appendChild(el); }
    el.textContent = text; el.title = title || '';
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }

  runnerPerkIcon(icon, name) {
    let el = this._perkIco;
    if (!icon) { if (el) el.classList.add('hidden'); return; }
    if (!el) {
      el = this._perkIco = document.createElement('div');
      el.className = 'perk-ico';
      this.el.hud.appendChild(el);
    }
    el.textContent = icon;
    el.setAttribute('aria-label', name || '');
    el.classList.remove('hidden');
  }

  buffClear() {
    for (const b of this.buffMap.values()) b.el.remove();
    this.buffMap.clear();
    if (this.el.buffs) this.el.buffs.innerHTML = '';
  }

  // ---- turn cue: a big chevron on the turn side in the bottom corner; pulses faster as the corner nears ----
  turnCue(dir, urgency = 0) {
    const el = this.el.turn;
    if (!dir) {
      if (this._tcDir) { this._tcDir = 0; this._tcU = -1; el.classList.add('hidden'); }
      return;
    }
    const d = dir < 0 ? -1 : 1;
    const u = Math.round(clamp01(urgency) * 10) / 10;
    if (d !== this._tcDir) {
      this._tcDir = d;
      el.className = d < 0 ? 'tc-l' : 'tc-r';
      this._tcU = -1;
    }
    if (u !== this._tcU) {
      this._tcU = u;
      el.style.setProperty('--tcp', `${(0.8 - 0.58 * u).toFixed(2)}s`);
    }
  }
  runnerTurn(dir) { this.turnCue(dir || 0, this._tcU > 0 ? this._tcU : 0.3); }
  runnerTurnOk(dir) {
    const el = this.el.turn;
    if (!dir) return;
    snd('turn');
    this.turnCue(dir, 1);
    el.classList.add('ok');
    clearTimeout(this._tcOkT);
    this._tcOkT = setTimeout(() => { el.classList.remove('ok'); this.turnCue(0); }, 450);
  }

  // ---- hunger / size meter: blue -> red, pulses when warn ----
  hunger(frac, warn = false) {
    if (!this._hgOn) {
      this._hgOn = true;
      this._hgQ = -1; this._hgHue = -1; this._hgWarn = false;
      this.el.hunger.classList.remove('hidden');
      this.el.hud.classList.add('has-hunger');
    }
    const f = clamp01(frac);
    const q = Math.round(f * 100);
    if (q !== this._hgQ) {
      this._hgQ = q;
      this.el.hgFill.style.setProperty('--f', String(q / 100));
      const hue = Math.round(205 * clamp01((f - 0.1) / 0.55) / 4) * 4;
      if (hue !== this._hgHue) { this._hgHue = hue; this.el.hgFill.style.setProperty('--hc', `hsl(${hue} 88% 56%)`); }
    }
    const w = !!warn;
    if (w !== this._hgWarn) { this._hgWarn = w; this.el.hunger.classList.toggle('warn', w); }
  }
  hungerHide() {
    if (!this._hgOn) return;
    this._hgOn = false;
    this._hgWarn = false;
    this.el.hunger.classList.add('hidden');
    this.el.hunger.classList.remove('warn');
    this.el.hud.classList.remove('has-hunger');
  }

  // ---- stomp combo: small 'EZ x3!' above the ball ----
  stompCombo(n) {
    const el = this.el.stomp;
    if (!(n > 0)) { el.classList.add('hidden'); el.classList.remove('pop'); return; }
    const now = performance.now();
    if (now - this._stompAt < 60) return;
    this._stompAt = now;
    try { meta.track('stomp', { combo: n }); } catch { /* ignore */ }
    snd('stomp', n - 1);
    el.textContent = n > 1 ? `EZ x${n}!` : 'EZ!';
    el.classList.remove('hidden', 'pop');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(this._stompT);
    this._stompT = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('pop'); }, 950);
  }

  // ---- ÇIĞ SONSUZ HUD ----
  // d = {tons, dist, tierName, frac (progress to the next tier), best}
  cigHud(d) {
    if (!d) return;
    const c = this._cg;
    if (this.el.cigHud.classList.contains('hidden')) {
      this.el.cigHud.classList.remove('hidden');
      this.el.hud.classList.add('cig-endless');
      this.el.level.textContent = 'ÇIĞ SONSUZ';
    }
    // numbers are compared first (no Intl formatting / string building on frames where nothing visible changed)
    const kg = Math.round((d.tons || 0) * 1000);
    if (kg !== c.kg) { c.kg = kg; const ts = fmtTons(kg / 1000); this.el.tons.textContent = ts; this.lastTonsText = ts; }
    const tnRaw = d.tierName || '';
    if (tnRaw !== c.tnRaw) { c.tnRaw = tnRaw; this.el.cgTn.textContent = String(tnRaw).toLocaleUpperCase('tr-TR'); }
    const q = Math.round(clamp01(d.frac) * 100);
    if (q !== c.fill) { c.fill = q; this.el.cgFill.style.setProperty('--f', String(q / 100)); }
    const dm = Math.round(d.dist || 0);
    if (dm !== c.dm) { c.dm = dm; this.el.cgDist.textContent = `${fmtN(dm)} m`; }
    const bv = d.best && typeof d.best === 'object' ? d.best.tons : d.best;
    const bk = bv > 0 ? Math.round(bv * 1000) : 0;
    if (bk !== c.bk) { c.bk = bk; this.el.cgBest.textContent = bk ? `REKOR ${fmtTons(bk / 1000)}` : ''; }
  }

  cigReset() {
    this.el.cigHud.classList.add('hidden');
    this.el.hud.classList.remove('cig-endless');
    this._cg = { kg: -1, tnRaw: null, fill: -1, dm: -1, bk: -1 };
  }

  // ---- ONE announcement scheduler (single source of truth) ----
  // channels: 'c' = centre (banner / tier / big+bad floats), 't' = top toast. One visible message per channel,
  // priority danger 3 > milestone 2 > info 1, >=1.2 s between centre messages, identical text deduped for 3 s,
  // info waiting >2 s (milestones >5 s) is dropped, the previous element is fully cleared before the next shows.
  _say(ch, r) {
    const now = performance.now();
    const D = this._dd || (this._dd = new Map());
    if (r.text && !r.count) {
      const k = ch + r.text, t0 = D.get(k);
      if (t0 !== undefined && now - t0 < 3000) return;
      D.set(k, now);
      if (D.size > 40) for (const [kk, v] of D) if (now - v > 3000) D.delete(kk);
    }
    if (ch === 'c' && this._hold && r.prio < 3 && !r.count) {
      const H = this._heldQ || (this._heldQ = []);
      if (!r.drop && H.length < 3) H.push(r);
      return;
    }
    const st = (this._chs || (this._chs = {}))[ch] || (this._chs[ch] = { cur: null, q: [], t: null, last: -1e9 });
    r.at = now;
    r.gap = ch === 'c' && !r.count ? 1200 : 0;
    if (r.count) { this._annStart(st, r, now); return; }
    const busy = st.cur && now < st.cur.until;
    if (!busy && now - st.last >= r.gap) { this._annStart(st, r, now); return; }
    if (busy && ch === 'c' && r.prio >= 3 && r.prio > st.cur.prio && now - st.last >= 400) { this._annStart(st, r, now); return; }
    if (r.drop) return;
    if (st.q.length >= 4) { const i = st.q.reduce((m, x, j) => (x.prio < st.q[m].prio ? j : m), 0); st.q.splice(i, 1); }
    st.q.push(r);
    this._annSched(st, ch);
  }
  /** runner sets true while a card gate is ahead: low/mid centre messages wait (info is dropped) until released */
  holdCentre(on) {
    this._hold = !!on;
    if (on) return;
    const H = this._heldQ || [];
    this._heldQ = [];
    for (const r of H) this._say('c', r);
  }
  /** true while the centre or top announcement lane is showing something */
  annBusy() {
    const n = performance.now(), c = this._chs || {};
    return !!((c.c && c.c.cur && n < c.c.cur.until) || (c.t && c.t.cur && n < c.t.cur.until));
  }
  _annStart(st, r, now) {
    try { st.cur?.clear?.(); } catch { /* ignore */ }
    let clear = null;
    try { clear = r.show(); } catch { /* ignore */ }
    st.cur = { prio: r.prio, until: now + r.ms, clear };
    st.last = now;
  }
  _annSched(st, ch) {
    clearTimeout(st.t);
    const now = performance.now();
    const gap = ch === 'c' ? 1200 : 0;
    const wait = Math.max(st.cur ? st.cur.until : 0, st.last + gap) - now;
    st.t = setTimeout(() => this._annPump(st, ch), Math.max(30, wait + 20));
  }
  _annPump(st, ch) {
    const now = performance.now();
    st.q = st.q.filter((x) => now - x.at < (x.prio >= 3 ? 8000 : x.prio === 2 ? 5000 : 2000));
    if (!st.q.length) return;
    const gap = ch === 'c' ? 1200 : 0;
    if ((st.cur && now < st.cur.until) || now - st.last < gap) { this._annSched(st, ch); return; }
    let bi = 0;
    st.q.forEach((x, i) => { if (x.prio > st.q[bi].prio) bi = i; });
    const r = st.q.splice(bi, 1)[0];
    this._annStart(st, r, now);
    if (st.q.length) this._annSched(st, ch);
  }
  _annReset() {
    this._hold = false; this._heldQ = [];
    for (const k in (this._chs || {})) {
      const st = this._chs[k];
      clearTimeout(st.t);
      try { st.cur?.clear?.(); } catch { /* ignore */ }
      st.cur = null; st.q = []; st.last = -1e9;
    }
    this._dd = new Map();
    clearTimeout(this._cbT);
    const cb = this.el.cigBanner;
    cb.getAnimations?.().forEach((an) => an.cancel());
    cb.classList.remove('on'); cb.classList.add('hidden');
    this.el.banner.innerHTML = '';
    this.el.toastSoft.innerHTML = '';
  }

  cigTier(name) {
    const nm = String(name || '').toLocaleUpperCase('tr-TR');
    this._say('c', {
      text: nm, prio: 2, ms: 1350,
      show: () => {
        const el = this.el.cigBanner;
        this.el.cbN.textContent = nm;
        el.getAnimations?.().forEach((an) => an.cancel());
        el.classList.remove('hidden', 'on');
        void el.offsetWidth;
        el.classList.add('on');
        clearTimeout(this._cbT);
        this._cbT = setTimeout(() => { el.classList.remove('on'); el.classList.add('hidden'); }, 1300);
        this.flash('gold');
        try { meta.track('cig_tier', { name: String(name || '') }); } catch { /* ignore */ }
        return () => { clearTimeout(this._cbT); el.getAnimations?.().forEach((an) => an.cancel()); el.classList.remove('on'); el.classList.add('hidden'); };
      },
    });
  }

  // ---- small non-blocking toast (top edge, never in the middle) ----
  toastSoft(text, opts) {
    if (!text) return;
    const prio = (opts && opts.prio) || (/REKOR|GÖREV|ÇARPAN|Yeni damga|YENİ/i.test(text) ? 2 : 1);
    const hot = this.el.hud && this._cmN > 3 && this.el.hud.classList.contains('rush');
    if (prio < 2 && hot) return;   // no info toasts while a combo runs
    this._say('t', { text: String(text), prio, ms: 1250, drop: !!(opts && opts.drop), show: () => this._toastNow(text, opts) });
  }
  _toastNow(text, opts) {
    const box = this.el.toastSoft;
    box.querySelectorAll('.ts').forEach((e) => { e.getAnimations?.().forEach((an) => an.cancel()); e.remove(); });
    const d = document.createElement('div');
    d.className = 'ts';
    const ico = opts && opts.icon;
    if (ico) { const i = document.createElement('span'); i.className = 'ti'; i.textContent = ico; d.appendChild(i); }
    const t = document.createElement('span');
    t.textContent = text;
    d.appendChild(t);
    d.addEventListener('animationend', () => d.remove());
    setTimeout(() => d.remove(), 2200);
    box.appendChild(d);
    return () => { d.getAnimations?.().forEach((an) => an.cancel()); d.style.opacity = '0'; d.remove(); };
  }

  // ---- first-run tutor card (top edge). card = {icon, title, text} or null ----
  runnerTutor(card, onTap) {
    const el = this.el.tutor;
    if (!el) return;
    if (!card) { el.classList.add('hidden'); this._tutorTap = null; return; }
    el.querySelector('.tt-icon').textContent = card.icon || '';
    el.querySelector('.tt-title').textContent = card.title || '';
    el.querySelector('.tt-text').textContent = card.text || '';
    this._tutorTap = onTap || null;
    el.classList.remove('hidden');
  }

  // ---------- legacy ÇIĞ levels ----------
  showResult({ title, pct, stars, tons, sub, coins, hasNext, endless, dist, distance, best, isBest, newBest, cause, tip, tierName, onRevive }, sfx) {
    this.clearTimers();
    this.buffClear();
    this.hungerHide();
    this.cigReset();
    this.hideRunnerRevive();
    this.hint(false);
    const isEndless = !!(endless || dist != null || distance != null || tierName);
    this.el.toastSoft.classList.add('res');
    this.el.hud.classList.add('hidden');
    this.el.result.classList.remove('hidden');
    this.el.result.classList.toggle('runner', isEndless); // hides the star row
    this.el.next.classList.remove('revive');
    this.el.next.classList.add('next');
    this.el.retry.classList.remove('hidden');
    this.retryLabel('');
    this.el.resBadge.textContent = 'YENİ REKOR!';
    this.el.menuBtn.classList.remove('hidden');
    this.reviveFn = null;
    this.el.resCoins.classList.toggle('hidden', !coins);
    this.el.resCoins.innerHTML = coins ? `❄️ +${fmtN(coins)}` : '';
    const dt = runnerDeathText(cause);
    const rec = !!(isBest || newBest);
    const mrep = this.missionBlock(null);

    if (isEndless) {
      const dd = dist != null ? dist : distance || 0;
      const bt = best && typeof best === 'object' ? best.tons : best;
      const bd = best && typeof best === 'object' ? best.dist : 0;
      this.el.resTitle.textContent = cause && DEATH[cause] ? dt.title : title || dt.title;
      this.el.resBadge.classList.toggle('hidden', !rec);
      this.el.resLabel.textContent = tierName ? String(tierName).toLocaleUpperCase('tr-TR') : 'çığ boyutu';
      this.el.resSub.textContent = rec ? '' : bt > 0 ? `REKOR ${fmtTons(bt)}${bd > 0 ? ` · ${fmtN(bd)} m` : ''}` : sub || '';
      this.el.next.classList.add('hidden');
      this.shareCardBtn({ mode: 'ÇIĞ', big: fmtTons(tons), unit: tierName ? String(tierName) : 'çığ boyutu', isRec: rec, challenge: 'Beni geçebilir misin? 🏔️' });
      let html = (!rec && (tip || dt.tip)) ? `<div class="rx-dim">${tip || dt.tip}</div>` : '';
      if ((this._bestCombo || 0) >= 3) html += `<div class="rx-line rx-combo">\u{1F525} EN \u0130Y\u0130 KOMBO x${this._bestCombo}</div>`;
      html += mrep.html + this.goalBlock(coins);
      this.el.resExtra.innerHTML = html;
      this.el.resExtra.classList.toggle('hidden', !html);
      this.resultFx(rec);
      this.goalAnimate();
      this.countUp(tons, (v) => { this.el.resPct.textContent = fmtTons(v); this.el.resTons.textContent = `${fmtN(dd * (v / Math.max(tons, 0.0001)))} m`; }, 1200, { tick: true, done: () => this.resultScoreDone(rec) });
      this.flushNotices(mrep.notices);
      return;
    }

    { const cb = document.getElementById('btn-card'); if (cb) cb.style.display = 'none'; const os = document.getElementById('btn-share'); if (os) os.style.display = ''; }
    this.el.resBadge.classList.add('hidden');
    this.el.resTitle.textContent = title;
    this.el.resSub.textContent = sub || '';
    this.el.resLabel.textContent = 'kasaba yıkıldı';
    this.el.next.textContent = 'SONRAKİ DAĞ ▶';
    this.el.next.classList.toggle('hidden', !hasNext);
    const lh = mrep.html + this.goalBlock(coins);
    this.el.resExtra.innerHTML = lh;
    this.el.resExtra.classList.toggle('hidden', !lh);
    this.goalAnimate();
    const spans = this.el.resStars.children;
    for (const s of spans) s.classList.remove('on');
    // Count the numbers up: the payoff should feel like a slot machine.
    this.countUp(1, (_, e) => {
      this.el.resPct.textContent = `%${Math.round(pct * 100 * e)}`;
      this.el.resTons.textContent = fmtTons(tons * e);
    }, 1100);
    for (let i = 0; i < stars; i++) {
      this.timers.push(setTimeout(() => { spans[i].classList.add('on'); sfx?.star(i); }, 500 + i * 380));
    }
    this.flushNotices(mrep.notices);
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    cancelAnimationFrame(this.raf);
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.el.toast.classList.remove('on'), 1600);
  }

  showPause(on) { this.el.pause.classList.toggle('hidden', !on); }

  setToggle(name, on) { this.el[name].classList.toggle('off', !on); }

  debug(text) {
    this.el.debug.classList.remove('hidden');
    this.el.debug.textContent = text;
  }
}

UI.prototype.runnerDeathText = runnerDeathText;
