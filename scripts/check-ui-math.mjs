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
globalThis.document = { getElementById: () => mkEl(), createElement: (t) => mkEl(t), createTextNode: (t) => ({ _text: t }), querySelector: () => mkEl(), body: mkEl('body') };
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
assert.equal(milestoneText(3), '1.500 m');
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

// ---- English entries for every new visible string ----
const { t } = await import('../src/i18n.js');
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
assert.equal(ui.el.resBadge.textContent, '★ ÇİFT REKOR! ★');
assert.equal(ui.el.resSub.textContent, 'ÖNCEKİ REKOR 500 m · +140 m');
assert.ok(ui.el.resExtra.innerHTML.includes('class="rx-pg"') && ui.el.resExtra.innerHTML.includes('SEVİYE'), 'progress rows are in the result');
assert.equal(ui.el.retry.kids[0]._text, 'Rekoru geç: 640 m');
ui._best = 1000; ui._bestD = 900;
ui.showRunnerResult({ cause: 'wall', distance: 120, score: 300, coins: 0, best: 1000, bestDist: 900, isBest: false, isBestDist: false, rank: 0, toRecord: 780, crystals: 0 });
assert.equal(ui.el.resBadge.textContent, '', 'no record: no badge text');
assert.equal(ui.el.resSub.textContent, 'REKOR 900 m');
assert.equal(ui.el.retry.kids[0]._text, 'Rekora 780 m kaldı!');
ui.showResult({ endless: true, tons: 3, dist: 100, distance: 100, best: { tons: 5, dist: 200 }, isBest: false, cause: 'wave', tierName: 'Çığ', coins: 4, hasNext: false }, null);
assert.equal(ui.el.retry.kids.length, 0, 'legacy results reset the TEKRAR sub line');
assert.equal(ui.el.resBadge.textContent, 'YENİ REKOR!');
ui.hideResult();

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
