// Node check (no browser): the pure UI math (500 m milestones, XP / season bars, record kinds) and a smoke run of the HUD / result
// code against a stub DOM, so a typo in the new UI paths fails here instead of on a phone.
// Usage: node scripts/check-ui-math.mjs
import assert from 'node:assert/strict';

// ---- minimal browser stubs (set BEFORE the game modules are imported) ----
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
store.set('patpat_lang', 'en');   // i18n picks its language at import time: lets us check the English entries of every new string
const mkEl = (tag = 'div') => {
  const cls = new Set();
  const el = {
    tag, kids: [], dataset: {}, offsetWidth: 0, id: '', title: '', onclick: null, disabled: false,
    style: new Proxy({ _p: {}, setProperty(k, v) { this._p[k] = v; } }, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => { t[k] = v; return true; } }),
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; } },
    _text: '', _html: '',
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v); this.kids.length = 0; },
    // innerHTML is not parsed; code that digs into markup it just wrote (firstChild / lastChild.firstChild) gets two placeholder children
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this.kids.length = 0; if (v) { const k2 = mkEl('i'); k2.kids.push(mkEl('b')); this.kids.push(mkEl('span'), k2); } },
    get lastChild() { return this.kids[this.kids.length - 1] || null; },
    get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); },
    get firstChild() { return this.kids[0] || null; }, get lastElementChild() { return this.kids[this.kids.length - 1] || mkEl(); }, get children() { return this.kids; },
    appendChild(c) { this.kids.push(c); return c; }, append(...c) { this.kids.push(...c.map((x) => (typeof x === 'string' ? { _text: x } : x))); }, after() {}, remove() {},
    insertBefore(n, ref) { const i = this.kids.indexOf(ref); this.kids.splice(i < 0 ? this.kids.length : i, 0, n); return n; },
    removeChild(c) { const i = this.kids.indexOf(c); if (i >= 0) this.kids.splice(i, 1); return c; },
    contains() { return false; }, closest() { return null; }, focus() {}, blur() {}, scrollTo() {}, insertAdjacentElement() {}, clientHeight: 300, scrollTop: 0,
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }, animate() { return {}; }, getAnimations() { return []; },
  };
  return el;
};
globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false, getElementById: () => mkEl(), createElement: (t) => mkEl(t), createTextNode: (t) => ({ _text: t }), querySelector: () => mkEl(), body: mkEl('body') };
globalThis.window = globalThis; globalThis.innerWidth = 360; globalThis.innerHeight = 640;
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};

const UI = await import('../src/ui.js');
const { milestoneIdx, milestoneText, milestoneTag, xpBar, seasonBar, recKind, recTitle, MILESTONE_STEP } = UI;

// ---- milestones ----
assert.equal(MILESTONE_STEP, 500);
assert.equal(milestoneIdx(0, 0), 0);
assert.equal(milestoneIdx(499.9, 0), 0);
assert.equal(milestoneIdx(500, 0), 1);
assert.equal(milestoneIdx(999, 1), 0, 'no repeat of an index already shown');
assert.equal(milestoneIdx(1000, 1), 2);
assert.equal(milestoneIdx(1520, 1), 3, 'a jump past several milestones reports the highest');
assert.equal(milestoneIdx(-40, 0), 0);
assert.equal(milestoneIdx(NaN, 0), 0);
assert.equal(milestoneText(1), '500 m');
assert.equal(milestoneText(2), '1 km');
assert.equal(milestoneText(3), '1,500 m', 'English: a thousands comma (Turkish keeps the dot)');
assert.equal(milestoneText(4), '2 km');
assert.equal(milestoneTag(1), 'GÜZEL!');
assert.equal(milestoneTag(99), 'EFSANE!');
assert.equal(milestoneTag(0), 'GÜZEL!');

// ---- XP bar ----
assert.deepEqual(xpBar({ level: 3, frac: 0.3 }, { level: 3, frac: 0.55 }), { from: 0.3, to: 0.55, up: false });
assert.deepEqual(xpBar({ level: 3, frac: 0.9 }, { level: 4, frac: 0.2 }), { from: 0, to: 0.2, up: true }, 'level-up restarts the bar');
assert.deepEqual(xpBar({ level: 3, frac: 0.5 }, { level: 3, frac: 0.4 }), { from: 0.5, to: 0.5, up: false }, 'never goes backwards');
assert.deepEqual(xpBar({ level: 1, frac: 7 }, { level: 1, frac: -2 }), { from: 1, to: 1, up: false }, 'clamped to 0..1');

// ---- season bar ----
const NEEDS = [8, 20, 40];
let b = seasonBar(5, 7, NEEDS);
assert.ok(Math.abs(b.from - 5 / 8) < 1e-9 && Math.abs(b.to - 7 / 8) < 1e-9 && !b.up && b.left === 1 && b.hi === 8 && !b.done);
b = seasonBar(5, 9, NEEDS);
assert.ok(b.up && b.from === 0 && Math.abs(b.to - 1 / 12) < 1e-9 && b.left === 11 && b.hi === 20, 'crossing a tier restarts the bar');
b = seasonBar(0, 0, NEEDS);
assert.ok(b.from === 0 && b.to === 0 && b.left === 8);
b = seasonBar(30, 45, NEEDS);
assert.ok(b.done && b.from === 1 && b.to === 1, 'all tiers reached');
b = seasonBar(50, 9, NEEDS);
assert.ok(b.from <= b.to, 'pre > now (season rolled over) stays sane');

// ---- records ----
assert.deepEqual(recKind(true, 500, 400), { dist: true, score: true });
assert.deepEqual(recKind(false, 500, 0), { dist: false, score: false }, 'a first-ever score is not a record');
assert.deepEqual(recKind(false, 300, 400), { dist: false, score: false });
assert.equal(recTitle({ dist: true, score: true }), '★ ÇİFT REKOR! ★');
assert.equal(recTitle({ dist: true, score: false }), 'YENİ REKOR!');
assert.equal(recTitle({ dist: false, score: true }), 'YENİ SKOR REKORU!');
assert.equal(recTitle({ dist: false, score: false }), '');
// Rush result read-out: one signed gap + one goal; fields may be missing; every string has an English entry
{
  const { runnerResultLines: L } = UI, { t: tt } = await import('../src/i18n.js');
  assert.deepEqual(L({ score: 1500, deltaBest: 320, isRecord: true, nextGoal: { k: 'next', val: 2500 }, nextGoalText: 'SIRADAKİ: 2.500 PUAN' }, 1180), { rec: true, delta: '+320', goal: 'SIRADAKİ: 2.500 PUAN' });
  assert.deepEqual(L({ score: 1000 }, 1380), { rec: false, delta: 'EN İYİYE 381 PUAN', goal: 'EN İYİ 1,380' }, 'below best without runner fields');
  assert.equal(L({ score: 1000 }, 0).delta, '', 'first run: no gap');
  assert.equal(L({ score: 900, isRecord: true }, 0).delta, '+900', 'record with a missing deltaBest');
  assert.match(tt('EN İYİYE 381 PUAN'), /BEAT YOUR BEST/);
  assert.equal(tt('EN İYİ 1,380'), 'BEST 1,380');
  assert.equal(tt('SKOR'), 'SCORE');
  assert.equal(tt('⛔ 1.6 m gerekli'), '⛔ 1.6 m needed');
  assert.equal(tt('RİSK +3'), 'RISK +3');
}

// ---- English entries for every new visible string ----
const { t } = await import('../src/i18n.js');
assert.equal(t('REKOR 4.000 PUAN'), 'RECORD 4.000 PTS'); assert.equal(t('KASABA AVI · 12/40'), 'TOWN HUNT · 12/40');
assert.equal(t('BİTİR'), 'FINISH'); assert.equal(t('KOŞUYU BİTİR'), 'END RUN');
for (const [tr, en] of [
  ['YENİ SKOR REKORU!', 'NEW SCORE RECORD!'], ['★ ÇİFT REKOR! ★', '★ DOUBLE RECORD! ★'], ['YENİ REKOR!', 'NEW RECORD!'],
  ['GÜZEL!', 'NICE!'], ['HARİKA!', 'GREAT!'], ['SÜPER!', 'SUPER!'], ['MUHTEŞEM!', 'AMAZING!'], ['EFSANE!', 'LEGENDARY!'],
  ['SEVİYE 8', 'LEVEL 8'], ['SEVİYE 8 ▲', 'LEVEL 8 ▲'], ['SEZON', 'SEASON'],
  ['ÖNCEKİ REKOR 500 m · +140 m', 'PREVIOUS RECORD 500 m · +140 m'], ['ÖNCEKİ SKOR REKORU 1.000', 'PREVIOUS SCORE RECORD 1.000'],
  ['Rekoru geç: 640 m', 'Beat it: 640 m'], ['Rekora 780 m kaldı!', '780 m to the record!'], ['↻ TEKRAR', '↻ RETRY'],
  ['Gizlilik Politikası', 'Privacy Policy'], ['BUGÜN', 'TODAY'], ['GÜNLÜK 1/3', 'DAILY 1/3'],
]) assert.equal(t(tr), en, `English entry for "${tr}"`);

// ---- share link: hosted builds use their own address, the Capacitor app / dev servers fall back to the public site ----
const { shareUrl, PUBLIC_URL } = await import('../src/sharecard.js');
const at = (o) => { globalThis.location = o; return shareUrl(); };
assert.equal(at({ protocol: 'https:', hostname: 'localhost', origin: 'https://localhost', pathname: '/' }), PUBLIC_URL, 'Capacitor Android');
assert.equal(at({ protocol: 'capacitor:', hostname: 'localhost', origin: 'capacitor://localhost', pathname: '/' }), PUBLIC_URL, 'Capacitor iOS');
assert.equal(at({ protocol: 'http:', hostname: '192.168.1.20', origin: 'http://192.168.1.20:5173', pathname: '/' }), PUBLIC_URL, 'LAN dev server');
assert.equal(at({ protocol: 'https:', hostname: 'patpat.onrender.com', origin: 'https://patpat.onrender.com', pathname: '/index.html' }), 'https://patpat.onrender.com/');
assert.equal(at({ protocol: 'https:', hostname: 'sherlockfp.github.io', origin: 'https://sherlockfp.github.io', pathname: '/patpat/' }), 'https://sherlockfp.github.io/patpat/');
delete globalThis.location;
assert.equal(shareUrl(), PUBLIC_URL, 'no location at all');

// ---- menus.js must stay importable without a DOM (it only touches `document` inside createMenus) ----
const menusMod = await import('../src/menus.js');
assert.equal(typeof menusMod.createMenus, 'function');

// ---- smoke: HUD + result against the stub DOM ----
const { meta } = await import('../src/meta.js');
const { save } = await import('../src/save.js');
try { meta.init(save); } catch (e) { console.log('meta.init skipped:', e.message); }
const ui = new UI.UI();
const said = [];
ui._say = (ch, r) => said.push(r.text);   // record announcements instead of scheduling them
ui.runnerHud(true, 'Karlı Zirve');
ui.runnerStats(0, 0, 1, 0, 0, 'Karlı Zirve');
for (let d = 0; d <= 2600; d += 7) ui.runnerStats(d * 3, Math.floor(d / 40), d > 1200 ? 3 : 1, 0.5, d, 'Karlı Zirve');
assert.deepEqual(said.filter((t) => /^ms\d+$/.test(t)), ['ms1', 'ms2', 'ms3', 'ms4', 'ms5'], 'one milestone per 500 m up to 2600 m');
ui.runnerHud(true, 'Karlı Zirve');
said.length = 0;
ui.runnerStats(10, 0, 1, 0, 700, '1-3 · Kampanya');
ui.runnerStats(10, 0, 1, 0, 1200, '1-3 · Kampanya');
assert.equal(said.filter((t) => /^ms\d+$/.test(t)).length, 0, 'campaign levels get no 500 m pills');
ui.runnerHud(true, 'Karlı Zirve');
ui.runnerStats(4000, 12, 2, 0.2, 640, 'Karlı Zirve');
ui._best = 1000; ui._bestD = 500;   // records at the start of this run
ui.showRunnerResult({ cause: 'yeti', distance: 640, score: 4000, coins: 12, best: 4000, bestDist: 640, isBest: true, isBestDist: true, rank: 1, toRecord: 0, crystals: 0 });
assert.equal(ui.el.resBadge.textContent, 'YENİ SKOR REKORU!', 'the badge is a SCORE record (the hero number); a distance record alone shows none');
assert.equal(ui.el.resPct.textContent.includes(' m'), false, 'the hero number is the SCORE, not metres');
ui._best = 4000; ui._bestD = 100;   // a distance record with a score far below the stored best: no record badge
ui.showRunnerResult({ cause: 'yeti', distance: 640, score: 244, coins: 1, best: 4000, bestDist: 640, isBest: false, isBestDist: true, rank: 1, toRecord: 0, crystals: 0 });
assert.equal(ui.el.resBadge.textContent, '', 'no record badge on 244 points against a best of 4,000');
ui._best = 1000; ui._bestD = 500;
ui.showRunnerResult({ cause: 'yeti', distance: 640, score: 4000, coins: 12, best: 4000, bestDist: 640, isBest: true, isBestDist: true, rank: 1, toRecord: 0, crystals: 0 });
assert.equal(ui.el.resLabel.textContent, 'SCORE', 'English: no literal SKOR');
assert.equal(ui.el.resTons.textContent, '+3,000 vs old record', 'record: signed gap to the old best (deltaBest missing -> computed)');
assert.ok(ui.el.resExtra.innerHTML.includes('class="rx-pg"') && ui.el.resExtra.innerHTML.includes('SEVİYE') && ui.el.resExtra.innerHTML.includes('rx-qlist hidden'), 'progress rows are in the result, collapsed behind one tap');
assert.ok(ui.el.resExtra.innerHTML.startsWith('<div class="rx-row">'), 'one compact chip row first');
assert.equal(ui.el.retry.kids.length, 0, 'TEKRAR carries no sub line');
ui._best = 1000; ui._bestD = 900;
ui.showRunnerResult({ cause: 'wall', distance: 120, score: 300, coins: 0, best: 1000, bestDist: 900, isBest: false, isBestDist: false, rank: 0, toRecord: 780, crystals: 0 });
assert.equal(ui.el.resBadge.textContent, '', 'no record: no badge text');
assert.equal(ui.el.resTons.textContent, 'BEAT YOUR BEST: 701 PTS', 'below the best: points still missing');
assert.equal(ui.el.resSub.textContent, 'BEST 1,000');
ui.showResult({ endless: true, tons: 3, dist: 100, distance: 100, best: { tons: 5, dist: 200 }, isBest: false, cause: 'wave', tierName: 'Çığ', coins: 4, hasNext: false }, null);
assert.equal(ui.el.retry.kids.length, 0, 'legacy results reset the TEKRAR sub line');
assert.equal(ui.el.resBadge.textContent, 'YENİ REKOR!');
ui.hideResult();

// ---- hyper-casual HUD: number format follows the language, ONE message lane, ONE multiplier chip, random perk timeout, clean-layer goal ----
assert.equal(UI.fmtN(1234567), '1,234,567');
assert.equal(UI.fmtTons(1.5), '1.5 ton', 'English: decimal point');
{
  const u = new UI.UI();
  u.el.hud.classList.remove('hidden');
  u.banner('A', 2); u.toastSoft('B info'); u.toastSoft('GÖREV tamam');
  assert.deepEqual(Object.keys(u._chs || {}), ['c'], 'with the HUD up banners and toasts share ONE lane');
  assert.equal(u._chs.c.cur.prio, 2, 'the first message is the one on screen; the others queue behind it');
  u._annReset();
  u.el.hud.classList.add('hidden');
  u.toastSoft('C');
  assert.ok(u._chs.t && u._chs.t.cur, 'HUD hidden (result screen): the top toast lane works as before');
  u._annReset();

  // Rush: the chip shows the multiplier only, and only when there is one
  u.el.hud.classList.remove('hidden');
  u.runnerHud(true, 'Test');
  u._cmb || u._mkCmb();
  u._mu = 3; u._cmN = 12; u._cmRender();
  assert.equal(u._cmKe.textContent, 'x3', 'Rush chip: the multiplier');
  assert.equal(u._cmKs.textContent + u._cmKu.textContent, '', 'Rush chip: no KOMBO label / SKOR suffix');
  assert.ok(u._cmb.classList.contains('on'));
  assert.ok(u._cmb.classList.contains('t2'), 'Rush chip: x3 tint');
  u._mu = 5; u._cmRender();
  assert.ok(u._cmb.classList.contains('t4') && !u._cmb.classList.contains('t2'), 'Rush chip: tint follows the whole step');
  u._mu = 3;
  u._mu = 0; u._cmRender();
  assert.ok(u._cmb.classList.contains('on') && u._cmb.classList.contains('dim') && u._cmKe.textContent === 'x1', 'Rush chip: always drawn, dim x1 without a multiplier');
  assert.equal(u._cmKs.textContent, '▼', 'Rush chip: a red down arrow on a drop');
  u._mu = 2; u._cmRender();
  assert.equal(u._cmKs.textContent, '▲', 'Rush chip: a green up arrow on a rise');
  assert.ok(u._cmb.classList.contains('decay'), 'Rush chip: pulses when the multiplier drops');
  clearTimeout(u._mLbT);

  // 'clean' goal: always shown (unlike 'cp'), label with / without the metres, other modes unchanged
  u.runnerGoal('clean', 120, 0.3);
  assert.equal(u.el.goalLbl.textContent, 'TEMİZ KAT: 120 m');
  assert.ok(!u.el.goal.classList.contains('hidden') && u.el.goal.classList.contains('cp'));
  u.runnerGoal('clean', 0, 0.3);
  assert.equal(u.el.goalLbl.textContent, 'TEMİZ KAT');
  u.runnerGoal('cp', 90, 0.5);
  assert.ok(u.el.goal.classList.contains('hidden'), "'cp' still hides below 80 % of the layer");
  u.runnerGoal('rec', 40, 0.5);
  assert.equal(u.el.goalLbl.textContent, 'REKORA 40 m');
  u.runnerGoal('rec', 40, 0.5, 'REKOR 4.000 PUAN');
  assert.equal(u.el.goalLbl.textContent, 'REKOR 4.000 PUAN', 'runnerGoal text overrides the label');
  u.runnerGoal(null);

  // perk timeout: a RANDOM card (not always the first)
  const realTimeout = globalThis.setTimeout, realInterval = globalThis.setInterval, realRandom = Math.random, realCreate = document.createElement;
  const picked = [];
  let timeoutFn = null, timeoutMs = 0;
  globalThis.setTimeout = (f, ms) => { if (ms >= 3000) { timeoutFn = f; timeoutMs = ms; } return 0; };
  globalThis.setInterval = () => 0;
  document.createElement = (tag) => { const e = mkEl(tag); e.querySelector = () => mkEl(); e.kids.push(mkEl(), mkEl()); return e; };
  document.body = document.body || mkEl('body');
  try {
    const perks = [{ id: 'a', icon: '1', name: 'A', desc: '' }, { id: 'b', icon: '2', name: 'B', desc: '' }, { id: 'c', icon: '3', name: 'C', desc: '' }];
    for (const r of [0, 0.5, 0.99]) {
      Math.random = () => r;
      u.runnerPerkPick(perks, (id) => picked.push(id), 6);
      timeoutFn();
    }
  } finally { globalThis.setTimeout = realTimeout; globalThis.setInterval = realInterval; Math.random = realRandom; document.createElement = realCreate; }
  assert.deepEqual(picked, ['a', 'b', 'c'], 'perk timeout picks a random card');
  assert.equal(timeoutMs, 3500, 'the pick never holds the run longer than 3.5 s (the runner asks for 6)');
  u.runnerHud(false, '');
}

// ---- smoke: the lobby builds and refreshes (BUGÜN streak / season bar, daily summary, settings privacy link) ----
globalThis.window.addEventListener = () => {};
globalThis.document.head = mkEl('head');
globalThis.document.documentElement = mkEl('html');
const host = mkEl('div');
const lobby = menusMod.createMenus({ save, meta, root: host, callbacks: {} });
const find = (n, cls, out = []) => { if (n && n.className && n.className.split(' ').includes(cls)) out.push(n); for (const k of (n && n.kids) || []) find(k, cls, out); return out; };
lobby.showMain({ endlessBestDist: 1200 });
let [tstat] = find(host, 'tstat'), [tbarFill] = [find(host, 'tbar')[0]?.kids[0]];
assert.ok(tstat && tbarFill, 'BUGÜN button has the streak chip and the season bar');
assert.equal(tstat.textContent, '', 'no streak yet: no chip text');
assert.ok(Number(tbarFill.style._p['--f']) >= 0 && Number(tbarFill.style._p['--f']) <= 1, 'season bar fill is a 0..1 fraction');
assert.ok(find(host, 'fm-sum').length === 1 && find(find(host, 'fm-sum')[0], 'ss').length === 0, 'no flame in the daily summary without a streak');
assert.ok(meta.claimDaily(), 'claim the daily reward to start a streak');
lobby.showMain({});
assert.equal(find(host, 'tstat')[0].textContent, '🔥 1', 'streak shows on the BUGÜN button');
assert.equal(find(find(host, 'fm-sum')[0], 'ss')[0].textContent, '🔥1', 'streak shows in the daily summary row');
lobby.openSettings();
const priv = find(host, 'fm-priv')[0];
assert.ok(priv, 'settings has a privacy link');
console.log('check-ui-math: OK');
process.exit(0);
