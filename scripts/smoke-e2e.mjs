// PATPAT real-browser smoke test. Zero dependencies: Node 24 global fetch + WebSocket speak the Chrome DevTools Protocol.
// Run: npm run test:e2e   (env: CHROME_PATH, KEEP_TMP=1, VERBOSE=1, ONLY=<ids>, e.g. ONLY=3,13 )
// Rules: one headless-shell browser, one tab, one Vite dev server (own port, never 5173), GPU only (d3d11, never swiftshader), muted,
// 390x844 @ dpr 1, nothing online (every non-localhost request is blocked), only our own PIDs are killed, never the owner's Chrome.
// Machine lock: os.tmpdir()/patpat-smoke.lock holds the PID of the running smoke test; a second run waits up to 8 min, a lock whose PID is dead is taken over.
// Timeouts: every scenario has a hard timeout (30 s default, 90 s Rush playtest; a few say otherwise below). On expiry it FAILs and the run moves on;
// the stuck scenario can no longer touch the browser (its next CDP call is rejected). Whole run is capped at ~4 min (later scenarios are skipped with WARN).
// Frames for humans/critics are shot without the ?debug overlay: s1-s4, s13, s14, s15 load without ?debug. Scenarios that need the cig.* hooks (s5-s9, s11) load with
// ?debug but an injected style (#debug{display:none}) keeps the overlay out of every frame; only s16 shows it. Draw calls / triangles come from a WebGL draw hook
// injected into every document (all passes of a frame summed), so they work without ?debug.
//
// Scenario ids (ONLY=<ids>, comma separated; every id runs alone, nothing depends on another scenario):
//   1  first-run EN (FTUE autostart into YETI RUSH)          2  first-run TR
//   3  returning player: settled main menu, s3_menu_early.png (150 ms after first appearance), every bottom-nav button by label
//   4  Rush 60 s playtest (save with 3 previous runs, normal game): rush_00..11.png, rush_result.png, retry
//   5  cig mountains 1/33/37 (8 s each, ?auto)               6  cig endless + daily            7  arena solo
//   8  english leak scan                                      9  fullscreen                    11  soak (heap after GC)
//   12 frame pacing (Rush, rAF deltas)                        13 first-run frames first_00..03.png at 0.5/2/5/10 s (fresh save)
//   14 cig mountain 1 start/mid/end (cig_1_*.png)             15 cig mountain 12 start/mid/end (cig_12_*.png)
//   16 debug overlay stats (?debug shown, reads calls/tris text)   10 is the final blank-frame check (always printed)
import { spawn, execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { AsyncLocalStorage } from 'node:async_hooks';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BUDGET_MS = 232_000;                     // whole run (browser time) must stay under 4 min; later scenarios are skipped past this
let T0 = Date.now();                           // reset after the lock is taken, so waiting for another run does not count
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() - T0;
const TMP = mkdtempSync(join(tmpdir(), 'patpat-smoke-'));
const SHOTS = join(TMP, 'shots'); mkdirSync(SHOTS);
const PROFILE = join(TMP, 'profile');
const procs = [];          // [{name, pid}] only what we started
let cdp = null, ORIGIN = '', renderer = '', peakMem = 0, peakHeap = 0, finishing = false;
const lines = [], externals = new Set(), shotStats = [];
let E = { exc: [], cons: [], net: [] };        // per-scenario error buckets
const als = new AsyncLocalStorage();           // per-scenario store {dead}: a timed-out scenario cannot send further CDP commands

// ---------------------------------------------------------------- machine lock (one smoke browser at a time)
const LOCK = join(tmpdir(), 'patpat-smoke.lock');
let haveLock = false;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function takeLock() {
  const until = Date.now() + 8 * 60_000; let said = false;
  for (;;) {
    try { writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); haveLock = true; return; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let pid = 0; try { pid = parseInt(readFileSync(LOCK, 'utf8'), 10) || 0; } catch { continue; }
    // shortcut: stale takeover is read-then-unlink, two waiters racing on the same stale file could both win; acceptable for a dev machine
    if (!pid || !alive(pid)) { try { if ((parseInt(readFileSync(LOCK, 'utf8'), 10) || 0) === pid) rmSync(LOCK, { force: true }); } catch { /* raced */ } continue; }
    if (Date.now() > until) { console.error(`FATAL smoke lock held by PID ${pid} for 8 min (${LOCK}); giving up`); process.exit(3); }
    if (!said) { said = true; console.log(`another smoke run holds the lock (PID ${pid}); waiting up to 8 min`); }
    await sleep(2000);
  }
}
function dropLock() { if (!haveLock) return; haveLock = false; try { if ((parseInt(readFileSync(LOCK, 'utf8'), 10) || 0) === process.pid) rmSync(LOCK, { force: true }); } catch { /* gone */ } }

function killAll() {
  for (const p of procs.splice(0)) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
}
process.on('exit', () => { killAll(); dropLock(); });
process.on('SIGINT', () => { killAll(); dropLock(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error('harness crash:', e); lines.push('FAIL harness: ' + String(e && e.message).slice(0, 160)); finish(2); });
process.on('unhandledRejection', (e) => { if (process.env.VERBOSE) console.error('unhandled rejection:', e); });

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

// ---------------------------------------------------------------- CDP
class CDP {
  constructor(url) { this.url = url; this.id = 0; this.cb = new Map(); this.h = new Map(); }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error'));
      this.ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id) { const c = this.cb.get(d.id); if (c) { this.cb.delete(d.id); d.error ? c.rej(new Error(d.error.message)) : c.res(d.result); } }
        else for (const f of this.h.get(d.method) || []) f(d.params);
      };
    });
  }
  send(method, params = {}) {
    if (als.getStore()?.dead) return Promise.reject(new Error('scenario aborted (timeout)'));
    return new Promise((res, rej) => {
      const id = ++this.id, tm = setTimeout(() => { this.cb.delete(id); rej(new Error('cdp timeout ' + method)); }, 15000);
      this.cb.set(id, { res: (v) => { clearTimeout(tm); res(v); }, rej: (e) => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(ev, f) { (this.h.get(ev) || this.h.set(ev, []).get(ev)).push(f); }
}

async function ev(expr, awaitP = false) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: awaitP });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
  return r.result.value;
}
async function waitFor(expr, ms, what) {
  const t = Date.now();
  for (;;) {
    let v; try { v = await ev(expr); } catch (e) { if (/aborted/.test(e.message)) throw e; v = null; }
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('timeout ' + (what || expr.slice(0, 60)));
    await sleep(100);
  }
}

// ---------------------------------------------------------------- input (real CDP input events)
const tapXY = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
const clickXY = async (x, y) => { const o = { x, y, button: 'left', clickCount: 1 }; await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...o }); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...o }); };
const KEYS = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Escape: 27 };
const key = async (k) => { const o = { key: k, code: k, windowsVirtualKeyCode: KEYS[k] }; await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...o }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...o }); };
// centre of the first visible, un-obscured element matching selector (+ optional text/aria regex)
const FIND = (sel, re) => `(()=>{const R=${re ? re.toString() : 'null'};for(const e of document.querySelectorAll(${JSON.stringify(sel)})){const b=e.getBoundingClientRect();if(b.width<2||b.height<2||b.bottom<0||b.top>innerHeight)continue;const cs=getComputedStyle(e);if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.05)continue;if(R&&!R.test((e.textContent||'')+' '+(e.getAttribute('aria-label')||'')))continue;const x=b.left+b.width/2,y=b.top+b.height/2,h=document.elementFromPoint(x,y);if(h&&(e===h||e.contains(h)||h.contains(e)))return{x,y};}return null;})()`;
async function tapSel(sel, re, ms = 6000) { const p = await waitFor(FIND(sel, re), ms, 'tap ' + sel + ' ' + re); await tapXY(p.x, p.y); }
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// ---------------------------------------------------------------- png -> luminance stddev + unique colours (blank detector)
function pngStats(buf) {
  let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < buf.length) { const len = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8); if (t === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); ct = buf[o + 17]; } else if (t === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0; if (!bpp) return { std: 99, uniq: 99 };   // unknown format: do not claim blank
  const raw = inflateSync(Buffer.concat(idat)), st = w * bpp, px = Buffer.alloc(st * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], r = y * (st + 1) + 1, d = y * st;
    for (let i = 0; i < st; i++) {
      const a = i >= bpp ? px[d + i - bpp] : 0, b = y ? px[d - st + i] : 0, c = i >= bpp && y ? px[d - st + i - bpp] : 0; let v = raw[r + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[d + i] = v & 255;
    }
  }
  let n = 0, s = 0, s2 = 0; const set = new Set();
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { const i = y * st + x * bpp, l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; n++; s += l; s2 += l * l; set.add((px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | px[i + 2] >> 4); }
  return { std: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), uniq: set.size };
}
// opts.noBlank: intro frames that may legitimately be near-empty (boot veil, first paint) are kept but not blank-checked
async function shot(name, ctx, opts = {}) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.data, 'base64'); writeFileSync(join(SHOTS, name + '.png'), buf);
  const s = pngStats(buf); s.bytes = buf.length; s.name = name;
  if (!opts.noBlank) { shotStats.push(s); if (ctx) (ctx.shots ||= []).push(s); }
  return s;
}
const blank = (s) => s.std < 6 || s.uniq < 24;

// ---------------------------------------------------------------- memory / heap
// sum of working sets of our browser's process tree (root pid + descendants), never other headless shells on the machine
const psMem = () => new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome-headless-shell.exe'\" | ForEach-Object { $_.ProcessId.ToString() + ',' + $_.ParentProcessId + ',' + $_.WorkingSetSize }"], { timeout: 12000 }, (e, out) => {
  if (e) return res(0);
  const rows = String(out).trim().split('\n').map((l) => l.trim().split(',').map(Number)), root = procs.find((p) => p.name === 'chrome')?.pid, mine = new Set([root]);
  for (let ch = true; ch;) { ch = false; for (const [p, pp] of rows) if (mine.has(pp) && !mine.has(p)) { mine.add(p); ch = true; } }
  res(Math.round(rows.filter((r) => mine.has(r[0])).reduce((t, r) => t + r[2], 0) / 1048576));
}));
async function memSample() { const m = await psMem(); if (m > peakMem) peakMem = m; try { const j = await heapMB(); if (j > peakHeap) peakHeap = j; } catch { /* ignore */ } return m; }
async function heapMB() { const r = await cdp.send('Performance.getMetrics'); return (r.metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576); }
async function heapGC() { await cdp.send('HeapProfiler.collectGarbage'); await sleep(150); return heapMB(); }

// ---------------------------------------------------------------- injected into every document: GL draw counter + hidden ?debug overlay
// per frame (one rAF tick) all draw calls and triangles of all passes are summed; glTake() harvests + resets, scenarios add the harvests up.
const INIT_SRC = `(()=>{
const G=window.__gl={calls:0,tris:0,n:0,sc:0,st:0,mc:0,mt:0};
const P=window.WebGL2RenderingContext&&WebGL2RenderingContext.prototype;
if(P){
const tri=(m,c)=>m===4?c/3:(m===5||m===6)?Math.max(0,c-2):0;
const w=(name,f)=>{const o=P[name];if(!o)return;P[name]=function(...a){G.calls++;G.tris+=f(a);return o.apply(this,a)}};
w('drawArrays',a=>tri(a[0],a[2]));w('drawElements',a=>tri(a[0],a[1]));
w('drawArraysInstanced',a=>tri(a[0],a[2])*a[3]);w('drawElementsInstanced',a=>tri(a[0],a[1])*a[4]);w('drawRangeElements',a=>tri(a[0],a[4]));
const tick=()=>{if(G.calls){G.n++;G.sc+=G.calls;G.st+=G.tris;if(G.calls>G.mc)G.mc=G.calls;if(G.tris>G.mt)G.mt=G.tris}G.calls=0;G.tris=0;requestAnimationFrame(tick)};requestAnimationFrame(tick);
}
if(!/[?&]showdbg\\b/.test(location.search)){const add=()=>{if(!document.documentElement)return false;const s=document.createElement('style');s.textContent='#debug{display:none!important}';(document.head||document.documentElement).appendChild(s);return true};if(!add())document.addEventListener('DOMContentLoaded',add)}
})()`;
let GLACC = null;                               // current scenario's GL totals
const glReset = () => { GLACC = { n: 0, sc: 0, st: 0, mc: 0, mt: 0 }; };
async function glTake() {
  if (!GLACC) return;
  const g = await cdp.send('Runtime.evaluate', { expression: `(()=>{const g=window.__gl;if(!g)return null;const r={n:g.n,sc:g.sc,st:g.st,mc:g.mc,mt:g.mt};g.n=g.sc=g.st=g.mc=g.mt=0;return r})()`, returnByValue: true }).then((r) => r.result.value, () => null);
  if (!g) return;
  GLACC.n += g.n; GLACC.sc += g.sc; GLACC.st += g.st; GLACC.mc = Math.max(GLACC.mc, g.mc); GLACC.mt = Math.max(GLACC.mt, g.mt);
}
const glLine = (a) => a && a.n ? `gl: ${a.n} frames, draw calls avg ${(a.sc / a.n).toFixed(0)} (max ${a.mc}), triangles avg ${(a.st / a.n / 1000).toFixed(1)}k (max ${(a.mt / 1000).toFixed(1)}k)` : null;

// ---------------------------------------------------------------- page / storage helpers
const GAME_ERR = `(()=>{try{return JSON.parse(localStorage.getItem('patpat.errlog')||'[]')}catch(e){return []}})()`;
function save(over = {}) {   // returning-player save: gate off, tutorials done, 36 mountains cleared
  const intro = {}; for (let i = 1; i <= 40; i++) intro[i] = 1;
  return {
    v: 1, level: 12, runs: 6, coins: 800, totalTons: 500,
    runner: { best: 4000, bestDist: 800, runs: 8, tut: true, turnHints: 3, lipHints: 3, seen: { boulder: true, slidewall: true, train: true } },
    cig: { tut: 3, ch: {}, dailyCh: {}, endless: { tons: 100, dist: 400, runs: 2 }, lv: { stars: {}, best: {}, intro, fails: {}, cleared: 36 } }, ...over,
  };
}
// normal-game save with exactly 3 previous runs (save.js + meta stats): tutorials done, FTUE gate off, nothing cleared
function save3() {
  return { v: 1, level: 1, runs: 3, coins: 150, totalTons: 20, runner: { best: 900, bestDist: 300, runs: 0, tut: true, turnHints: 3, lipHints: 3, seen: { boulder: true, slidewall: true, train: true } }, cig: { tut: 3, ch: {}, dailyCh: {}, endless: { tons: 0, dist: 0, runs: 0 }, lv: { stars: {}, best: {}, intro: {}, fails: {}, cleared: 0 } } };
}
const seedOf = (sv = save(), extra = {}) => ({ 'cig.save.v1': JSON.stringify(sv), 'patpat.ftue': '1', 'patpat.ftueGate': 'off', patpat_lang: 'en', ...extra });
const seed3 = () => seedOf(save3(), { 'freemon.meta.v1': JSON.stringify({ st: { runs: 3, endlessRuns: 3 } }) });
let seedId = null;
// Clears all storage for the origin, seeds {key: string} on the next document only, navigates, waits for the boot veil to go.
// noWait: return right after Page.navigate with the navigation timestamp (for timed frame captures).
async function load(path, seed = {}, { waitBoot = true, noWait = false } = {}) {
  await glTake();
  E = { exc: [], cons: [], net: [] };
  await cdp.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
  if (seedId) { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedId }); seedId = null; }
  if (Object.keys(seed).length) {
    const src = `(()=>{try{const s=${JSON.stringify(seed)};for(const k in s)localStorage.setItem(k,s[k]);}catch(e){}})()`;
    seedId = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src })).identifier;
  }
  const t = Date.now();
  await cdp.send('Page.navigate', { url: ORIGIN + '/' + (path.includes('?') ? path + '&' : '?') + 'net=local' });   // ?net=local: the game's own offline switch, on every URL
  if (noWait) return t;
  await waitFor(`document.readyState==='complete'&&!!document.querySelector('#c')`, 45000, 'page load');
  if (waitBoot) await waitFor(`!document.getElementById('boot')||document.getElementById('boot').classList.contains('out')`, 45000, 'boot veil');
  if (seedId) { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedId }); seedId = null; }
  return Date.now() - t;
}
const hudDist = `(()=>{const e=document.querySelector('#hud-coins .hc-d');return e?parseInt(e.textContent)||0:-1})()`;
const rushPlaying = `(()=>{const h=document.getElementById('hud');return !!h&&!h.classList.contains('hidden')&&h.classList.contains('rush')})()`;
// DOM-only run state (no ?debug hooks): play = Rush HUD up, no result, no revive panel
const RUSH_ST = `(()=>{const h=document.getElementById('hud'),r=document.getElementById('result'),v=document.getElementById('revive-panel');return{play:!!h&&!h.classList.contains('hidden')&&h.classList.contains('rush')&&r.classList.contains('hidden')&&v.classList.contains('hidden'),res:!r.classList.contains('hidden'),rv:!v.classList.contains('hidden')}})()`;
const rushPlay = `(${RUSH_ST}).play`;
const dbgRush = `!!(window.cig&&cig.runner&&cig.runner.state==='play')`;   // needs ?debug
// a mountain run in progress: HUD up, not the Rush HUD, no result screen
const CIG_PLAY = `(()=>{const h=document.getElementById('hud'),r=document.getElementById('result');return !!h&&!h.classList.contains('hidden')&&!h.classList.contains('rush')&&r.classList.contains('hidden')})()`;
const RESULT_UP = `!document.getElementById('result').classList.contains('hidden') || !!document.querySelector('.fm-resov')`;   // (Rush / old result screen, or the menus.js level result overlay: ÇIĞ mountains)
const RAF_INSTALL = `window.__raf={d:[],last:performance.now(),stop:false,skip:false,ign:0};(function f(t){const r=window.__raf;if(r.stop)return;if(!r.skip&&r.ign--<=0)r.d.push(t-r.last);r.last=t;requestAnimationFrame(f)})(performance.now())`;
const RAF_READ = `(()=>{const r=window.__raf,d=r.d.slice(r.mark||0).filter(x=>x<1000);const a=d.reduce((s,x)=>s+x,0)/d.length;return{n:d.length,avg:a,worst:Math.max(...d)}})()`;

// ---------------------------------------------------------------- scenario runner
const results = [];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null;   // e.g. ONLY=4,12 while debugging
const quick = (p, ms = 4000) => Promise.race([p, sleep(ms).then(() => { throw new Error('post-check timeout'); })]);
async function scenario(id, name, budget, fn) {
  if (ONLY && !ONLY.includes(String(id))) return;
  const t = Date.now(); const out = []; const ctx = { pass: (m) => out.push(['PASS', m]), warn: (m) => out.push(['WARN', m]), fail: (m) => out.push(['FAIL', m]), shots: [] };
  const left = BUDGET_MS - now();
  if (left < 6000) { out.push(['WARN', 'skipped: 4 min run budget used']); }
  else {
    const hard = Math.min(budget, left), store = { dead: false }; glReset();
    try {
      await Promise.race([als.run(store, () => fn(ctx)), sleep(hard).then(() => { throw new Error('scenario timeout ' + (hard / 1000).toFixed(0) + ' s (hard limit, scenario aborted)'); })]);
    } catch (e) { ctx.fail('harness/game: ' + e.message); }
    store.dead = true;
    try { await quick(glTake()); } catch { /* page gone */ }
    try { const log = await quick(ev(GAME_ERR)); if (log.length) ctx.fail('patpat.errlog: ' + JSON.stringify(log.slice(-3)).slice(0, 300)); } catch { /* page gone */ }
    if (E.exc.length) ctx.fail('exceptions: ' + E.exc.slice(0, 3).join(' | ').slice(0, 300));
    if (E.cons.length) ctx.fail('console.error: ' + E.cons.slice(0, 3).join(' | ').slice(0, 300));
    if (E.net.length) ctx.fail('requests: ' + E.net.slice(0, 4).join(' | ').slice(0, 300));
    const bl = ctx.shots.filter(blank); if (bl.length) ctx.fail('blank frame: ' + bl.map((s) => `${s.name}(std ${s.std.toFixed(1)},uniq ${s.uniq})`).join(','));
    else if (ctx.shots.length) ctx.pass(`non-blank x${ctx.shots.length} (min std ${Math.min(...ctx.shots.map((s) => s.std)).toFixed(1)}, min colours ${Math.min(...ctx.shots.map((s) => s.uniq))})`);
    const gl = glLine(GLACC); if (gl) out.push(['INFO', gl]);
  }
  const worst = out.some((o) => o[0] === 'FAIL') ? 'FAIL' : out.some((o) => o[0] === 'WARN') ? 'WARN' : 'PASS';
  results.push({ id, worst });
  for (const [l, m] of out) { const s = `${l} s${id} ${name}: ${m}`; if (l !== 'INFO') lines.push(s); console.log(s); }
  console.log(`  (s${id} ${((Date.now() - t) / 1000).toFixed(1)}s, ${worst})`);
}

// ---------------------------------------------------------------- scenarios
async function firstRun(ctx, lang) {
  const seed = lang ? { patpat_lang: lang } : {};
  const ms = await load('', seed);
  const hl = await ev('document.documentElement.lang');
  if (hl === lang || (!lang && hl === 'en')) ctx.pass(`html lang=${hl}`); else ctx.fail(`html lang=${hl}, expected ${lang || 'en'}`);
  // the FTUE splash starts YETI RUSH by itself; the player may also tap it
  await waitFor(rushPlaying, 20000, 'rush HUD (FTUE autostart)');
  const d0 = await waitFor(`(${hudDist})>=0&&(${hudDist})`, 12000, 'first distance>0').catch(() => 0);
  await sleep(3000);
  const d1 = await ev(hudDist);
  await shot('s' + (lang === 'tr' ? 2 : 1) + '_play', ctx);
  if (d1 > d0) ctx.pass(`playing Rush, distance ${d0} -> ${d1} m, load ${ms} ms`); else ctx.fail(`distance not increasing (${d0} -> ${d1})`);
}

// fresh save, frames measured from Page.navigate: shows the real first-run path incl. loading glitches
async function firstFrames(ctx) {
  const t = await load('', {}, { noWait: true });
  const T = [500, 2000, 5000, 10000], got = [];
  for (let i = 0; i < T.length; i++) {
    const w = t + T[i] - Date.now(); if (w > 0) await sleep(w);
    const s = await shot('first_0' + i, ctx, { noBlank: i < 2 });
    got.push(`${T[i] / 1000}s@${((Date.now() - t) / 1000).toFixed(2)}s(std ${s.std.toFixed(0)})`);
  }
  ctx.pass('first-run frames (target@actual): ' + got.join(', '));
  if (blank(shotStats.find((s) => s.name === 'first_03') || { std: 99, uniq: 99 })) ctx.fail('first_03 (10 s) blank');
}

const MENU_UP = `(()=>{const r=document.querySelector('.fm-main');return !!r&&!r.classList.contains('fm-hide')&&getComputedStyle(r).display!=='none'})()`;
// settled = menu root past its enter class, no finite CSS animation/transition running anywhere in the menu (idle bob/breath/shine loops are infinite and ignored), OYNA/PLAY visible + hit-testable
const MENU_SETTLED = `(()=>{const r=document.querySelector('.fm-main');if(!r||r.classList.contains('fm-hide')||r.classList.contains('enter'))return false;const run=r.getAnimations({subtree:true}).filter(a=>{try{return a.playState==='running'&&a.effect.getComputedTiming().iterations!==Infinity}catch(e){return false}});if(run.length)return false;return !!${FIND('.fm-play', /PLAY|OYNA/i)}})()`;
async function returning(ctx) {
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await load('', seedOf(save({ wheel: { seen: 1, day } })), { waitBoot: false });
  // early frame: 150 ms after the menu first appears (intro glitches stay visible)
  for (let i = 0; !(await ev(MENU_UP)); i++) { if (i > 800) throw new Error('timeout menu first appears'); await sleep(25); }
  await sleep(150);
  await shot('s3_menu_early', ctx, { noBlank: true });
  const settle = async () => { for (let i = 0; i < 4; i++) { if (await ev(`!!${FIND('.fm-play')}`)) return; await key('Escape'); await sleep(350); } };
  // the save has the welcome wheel already spun (it would cover OYNA and has no close button); fail with the blocker if anything else covers it
  const tS = Date.now();
  while (!(await ev(MENU_SETTLED))) {
    if (Date.now() - tS > 12000) throw new Error('timeout menu settled (no finite CSS animation/transition running, OYNA visible + hit-testable); blocker=' + JSON.stringify(await ev(`(()=>{const b=document.querySelector('.fm-play');if(!b)return 'no .fm-play';const r=b.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);const run=document.querySelector('.fm-main').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>(a.animationName||a.transitionProperty)+':'+a.playState);return {top:h&&(h.className+'/'+h.parentElement.className),run,root:document.querySelector('.fm-main').className}})()`)));
    await sleep(150);
  }
  await settle();
  const txt = await ev(`document.querySelector('.fm-play')?.textContent||''`);
  if (/PLAY|OYNA/i.test(txt)) ctx.pass(`main menu settled, play button "${txt.trim().replace(/\s+/g, ' ')}"`); else ctx.fail('play button text ' + txt);
  await shot('s3_menu', ctx);
  const labels = await ev(`[...document.querySelectorAll('.fm-secrow .fm-sb')].map(b=>b.getAttribute('aria-label')||b.textContent.trim())`);
  if (!labels.length) { ctx.fail('no bottom-nav buttons (.fm-secrow .fm-sb)'); return; }
  for (let i = 0; i < labels.length; i++) {
    const lb = labels[i], re = new RegExp(reEsc(lb));   // found by label: hidden-until-unlocked buttons keep their DOM slot, so no nth-child
    try {
      await settle();
      if (!(await ev(`!!${FIND('.fm-secrow .fm-sb', re)}`).catch(() => false))) { await waitFor(FIND('.fm-secrow .fm-sb', re), 1500, 'visible').catch(() => { throw new Error('not visible (hidden or locked)'); }); }
      await tapSel('.fm-secrow .fm-sb', re, 3000);
      await waitFor(`(!${FIND('.fm-secrow .fm-sb')}) || !!document.querySelector('.fm-ov,[role=dialog]')`, 6000, 'opens');
      await sleep(400);
      if (i === 0) await shot('s3_nav_' + i, ctx);
      await key('Escape');
      await waitFor(`!!${FIND('.fm-secrow .fm-sb')} && !document.querySelector('.fm-ov')`, 6000, 'closes');
      ctx.pass(`nav "${lb}" opens and closes`);
    } catch (e) { (/not visible/.test(e.message) ? ctx.warn : ctx.fail)(`nav "${lb}": ${e.message}`); await key('Escape'); await sleep(400); }
  }
}

let rushStats = null, rushGl = null;   // rushStats: rAF data of the last Rush run, reused by s12 when s4 ran first
async function rushPlaytest(ctx) {
  await load('?endless&notut', seed3());
  const tNav = Date.now();
  await waitFor(`${rushPlay}&&(${hudDist})>=0`, 30000, 'rush playing');
  const tFirst = Date.now() - tNav;
  await ev(RAF_INSTALL);
  ctx.pass(`time page-load -> first playable frame (HUD+state=play): ${tFirst} ms`);
  const KS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  let played = 0, frame = 0, deaths = 0, tick = 0, lastT = Date.now(), resultShot = false, powerShot = false, retryMs = [], paceDone = false;
  const rows = [];
  const cap = Date.now() + 74000;
  const afterResult = async (td) => {   // result screen is up: shoot once, retry, back to playing
    await sleep(600);
    if (!resultShot) { resultShot = true; await shot('rush_result', ctx); const t = await ev(`document.getElementById('result').innerText.replace(/\\s+/g,' ').slice(0,100)`); ctx.pass(`result screen: "${t}"`); }
    if (!powerShot && await ev(`!!document.getElementById('btn-power')&&document.getElementById('btn-power').style.display!=='none'`)) {   // GÜÇ entry on the result: opens the panel over it, closes again
      powerShot = true;
      await tapSel('#btn-power', null, 3000).catch(() => {}); await sleep(700); await shot('rush_power', ctx);
      const open = await ev(`!!document.querySelector('.fm-x')`);
      if (open) { await tapSel('.fm-x', null, 3000).catch(() => {}); await sleep(300); ctx.pass('result GÜÇ button opens the GÜÇ panel and it closes again'); } else ctx.fail('result GÜÇ button did not open a panel');
    } else if (!powerShot) ctx.warn('result: no GÜÇ button (needs runsTotal >= 2)');
    await tapSel('#btn-retry', null, 5000).catch(async () => { await tapSel('#result button', /AGAIN|RETRY|TEKRAR/i, 3000); });
    await waitFor(`${rushPlay}`, 15000, 'play after retry');
    retryMs.push(Date.now() - td); lastT = Date.now();
  };
  while ((frame < 12 || played < 60000) && Date.now() < cap) {
    const st = await ev(RUSH_ST);
    const dt = Date.now() - lastT; lastT = Date.now();
    if (st.play) played += dt;
    if (st.rv) { await tapSel('#btn-revive-end', null, 3000).catch(() => {}); continue; }
    if (st.res) { deaths++; await afterResult(Date.now()); continue; }
    if (st.play) { if (tick++ % 2 === 0) await key(KS[(Math.random() * KS.length) | 0]); }
    if (frame < 12 && played >= frame * 5000) {
      const r = await ev(`({d:${hudDist},sc:(document.getElementById('hud-tons')||{}).textContent})`);
      await ev('window.__raf.skip=true'); await shot('rush_' + String(frame).padStart(2, '0'), ctx); await ev('window.__raf.skip=false;window.__raf.ign=3');
      rows.push(`#${String(frame).padStart(2, '0')} t=${frame * 5}s dist=${r.d}m score=${r.sc}`);
      if (frame === 2 && !paceDone) { paceDone = true; await ev(`window.__raf.mark=window.__raf.d.length`); }
      if (frame === 4) rushStats = await ev(RAF_READ);
      if (frame === 5) await memSample();
      frame++;
    }
    await sleep(120);
  }
  await glTake(); rushGl = glLine(GLACC);
  if (frame < 12 || played < 60000) ctx.fail(`only ${frame}/12 frames, played ${(played / 1000).toFixed(0)} s in ${(74000 / 1000)} s wall cap`);
  console.log('  ' + rows.join('\n  '));
  ctx.pass(`60 s Rush playtest, ${rows.length} frames, deaths ${deaths}, played ${(played / 1000).toFixed(0)} s, bot=random keys, save with 3 previous runs`);
  await ev(`window.__raf.stop=true`);
  if (!resultShot) {   // bot survived: stop steering and let it crash, to exercise result + retry (no ?debug, so no runner.die())
    const ok = await waitFor(`(${RUSH_ST}).res||(${RUSH_ST}).rv`, 10000, 'idle death').then(() => true, () => false);
    if (ok) { const td = Date.now(); if ((await ev(RUSH_ST)).rv) await tapSel('#btn-revive-end', null, 3000).catch(() => {}); await waitFor(RESULT_UP, 8000, 'result').catch(() => {}); await afterResult(td); }
    else ctx.warn('bot survived 60 s and an idle run did not die in 10 s: result screen/retry not exercised');
  }
  const dists = rows.map((r) => +/dist=(-?\d+)/.exec(r)[1]);
  if (dists.length && Math.max(...dists) > dists[0]) ctx.pass(`HUD distance grows (first ${dists[0]} m, max ${Math.max(...dists)} m)`); else ctx.fail('HUD distance never grew');
  if (retryMs.length) ctx.pass(`death -> playing again after retry: ${retryMs.join(', ')} ms`); else if (resultShot) ctx.warn('no retry timing');
}

async function s12(ctx) {
  if (!rushStats) {   // stand-alone: short own Rush run, random keys, deltas after a 3 s settle
    await load('?endless&notut', seed3());
    await waitFor(`${rushPlay}&&(${hudDist})>=0`, 25000, 'rush playing');
    await ev(RAF_INSTALL); await sleep(3000); await ev(`window.__raf.mark=window.__raf.d.length`);
    const KS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    for (let i = 0; i < 20; i++) { await key(KS[(Math.random() * KS.length) | 0]); await sleep(300); }
    rushStats = await ev(RAF_READ); await glTake(); rushGl = glLine(GLACC);
  }
  const s = rushStats;
  ctx.pass(`Rush rAF deltas: n=${s.n} avg ${s.avg.toFixed(1)} ms (${(1000 / s.avg).toFixed(0)} fps), worst ${s.worst.toFixed(1)} ms${rushGl ? '; Rush ' + rushGl : ''}`);
  if (s.avg > 33) ctx.warn(`avg frame ${s.avg.toFixed(1)} ms > 33 ms`);
  if (s.worst > 250) ctx.warn(`worst frame ${s.worst.toFixed(0)} ms (hitch)`);
}

async function mountain(ctx, n, secs) {
  const sv = save(); sv.cig.lv.cleared = Math.max(sv.cig.lv.cleared, n - 1);
  await load(`?debug&auto&cig=${n}`, seedOf(sv));
  await waitFor(`window.cig&&cig.G.mode==='cig'&&cig.G.state==='play'`, 25000, 'mountain playing');
  const a = await ev('cig.summary()');
  await sleep(secs * 1000);
  const b = await ev('cig.summary()');
  await shot('s5_mountain_' + n, ctx);
  if (b.state === 'play' || b.state === 'result' || b.state === 'end') ctx.pass(`mountain ${n}: state ${a.state}->${b.state}, d ${a.d}->${b.d} m, r ${b.r}, tier ${b.tier}`); else ctx.fail(`mountain ${n} state ${b.state}`);
  if (!(b.d > a.d) && b.state === 'play') ctx.fail(`mountain ${n}: distance not increasing ${a.d} -> ${b.d}`);
}

// purpose frames for humans: no ?debug, bot via ?auto, start (2 s in), mid (8 s in), end (result screen) if it comes within 42 s of the start (full mountains take longer with ?auto)
async function cigFrames(ctx, n) {
  const sv = save(); sv.cig.lv.cleared = Math.max(0, n - 1);
  await load(`?auto&cig=${n}`, seedOf(sv));
  await waitFor(CIG_PLAY, 25000, 'mountain HUD playing');
  const t = Date.now(), at = (ms) => { const w = t + ms - Date.now(); return w > 0 ? sleep(w) : Promise.resolve(); };
  await at(2000); await shot(`cig_${n}_start`, ctx);
  await at(8000);
  if (await ev(RESULT_UP)) ctx.warn(`mountain ${n}: result already up at 8 s, no mid frame`); else await shot(`cig_${n}_mid`, ctx);
  const end = await waitFor(RESULT_UP, Math.max(1000, t + 42000 - Date.now()), 'result').then(() => true, () => false);
  if (end) { await sleep(900); await shot(`cig_${n}_end`, ctx); const tx = await ev(`document.getElementById('result').innerText.replace(/\\s+/g,' ').slice(0,80)`); ctx.pass(`mountain ${n}: finale/result reached at ${((Date.now() - t) / 1000).toFixed(0)} s: "${tx}"`); }
  else ctx.warn(`mountain ${n}: no result within 42 s of start (?auto bot still running), no end frame`);
}

async function endlessDaily(ctx) {
  const base = seedOf();
  await load('?debug&auto&cig=endless', base);
  await waitFor(`window.cig&&cig.G.mode==='cig'&&cig.G.state==='play'`, 25000, 'endless playing');
  const a = await ev('cig.summary()'); await sleep(3000); const b = await ev('cig.summary()');
  await shot('s6_endless', ctx);
  if (b.d > a.d || b.state !== 'play') ctx.pass(`CIG endless: d ${a.d}->${b.d} m, state ${b.state}`); else ctx.fail(`CIG endless distance stuck ${a.d}`);
  await load('?debug&auto&play&daily', base);
  await waitFor(`window.cig&&cig.G.mode==='cig'&&cig.G.state==='play'&&cig.G.daily`, 25000, 'daily playing');
  const c = await ev('cig.summary()'); await sleep(3000); const d = await ev('cig.summary()');
  await shot('s6_daily', ctx);
  if (d.d > c.d || d.state !== 'play') ctx.pass(`CIG daily mountain: d ${c.d}->${d.d} m, state ${d.state}`); else ctx.fail(`daily distance stuck ${c.d}`);
}

async function arena(ctx) {
  await load('?debug', seedOf(save(), { 'patpat.agar.nick': 'Smoke' }));
  await waitFor(`window.cig&&cig.G.state==='menu'`, 15000, 'menu');
  await ev('cig.agar()');   // same as the menu button; does not touch the network (title card only)
  await waitFor(`!!${FIND('.ag-btn.go')}`, 10000, 'arena title card').catch(async (e) => { throw new Error(e.message + ' buttons=' + JSON.stringify(await ev(`(document.querySelector('.ag-screen')||document.body).innerText.slice(0,300)`)) + ' state=' + await ev('cig.G.state+cig.G.mode')); });
  await shot('s7_arena_title', ctx);
  await tapSel('.ag-btn.go');
  await waitFor(`cig.agarMode&&cig.agarMode.state==='play'&&cig.agarMode.match`, 10000, 'solo match');
  const t0 = await ev('cig.agarMode.match.t'); await sleep(2500); const t1 = await ev('cig.agarMode.match.t');
  await shot('s7_arena_play', ctx);
  if (t1 < t0) ctx.pass(`Arena solo started, timer ${t0.toFixed(1)} -> ${t1.toFixed(1)} s`); else ctx.fail(`arena timer not counting down ${t0} -> ${t1}`);
}

const LEAK = `(()=>{const re=/[çğıöşüİÇĞÖŞÜ]/;const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const p=n.parentElement;if(!p||/^(SCRIPT|STYLE)$/.test(p.tagName))continue;const t=n.textContent.trim();if(!t||!re.test(t))continue;const b=p.getBoundingClientRect(),cs=getComputedStyle(p);if(b.width<1||b.height<1||cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.05)continue;const nick=localStorage.getItem('patpat.agar.nick')||'\\u0000';if(t.replace(/PATPAT/g,'').replace(nick,'').trim()===''||!re.test(t.replace(/PATPAT/g,'').replace(nick,'')))continue;out.add(t.slice(0,60))}return[...out]})()`;
async function leaks(ctx) {
  await load('?debug', seedOf());
  await waitFor(`!!document.querySelector('.fm-play')`, 15000, 'menu');
  const found = {};
  const scan = async (name) => { await sleep(500); const l = await ev(LEAK); if (l.length) found[name] = l; };
  await scan('menu');
  await tapSel('.fm-sb.c-cig'); await sleep(600); await scan('mountain list'); await key('Escape'); await sleep(500);
  await tapSel('.fm-sb.c-set'); await sleep(600); await scan('settings'); await key('Escape'); await sleep(500);
  await tapSel('.fm-sb.c-shop'); await sleep(900); await scan('wardrobe/shop'); await key('Escape'); await sleep(700);
  await ev('cig.agar()'); await waitFor(`!!${FIND('.ag-btn.go')}`, 10000, 'arena lobby'); await scan('arena lobby');
  const names = Object.keys(found);
  if (!names.length) ctx.pass('no Turkish-only letters in menu, mountain list, settings, wardrobe, arena lobby');
  for (const k of names) ctx.warn(`English leak in ${k}: ${found[k].slice(0, 8).map((s) => JSON.stringify(s)).join(', ')}${found[k].length > 8 ? ' +' + (found[k].length - 8) + ' more' : ''}`);
}

async function fullscreen(ctx) {
  const FS = `!!(document.fullscreenElement||document.webkitFullscreenElement)`;
  // 0) can this headless shell enter fullscreen at all? bare page, real touch tap
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await waitFor(`document.readyState==='complete'`, 5000);
  await ev(`document.body.style.cssText='margin:0;height:100vh';document.addEventListener('pointerup',()=>{document.documentElement.requestFullscreen().catch(e=>window.__fsErr=String(e))});window.__fsErr=''`);
  await tapXY(100, 100); await sleep(600);
  const bare = await ev(FS), bareErr = await ev('window.__fsErr');
  if (bare) { ctx.pass('bare page: touch tap enters fullscreen (headless shell supports it)'); await ev('document.exitFullscreen()'); await sleep(300); }
  else ctx.warn(`headless shell cannot enter fullscreen on a bare page (${bareErr || 'no error, fullscreenElement null'}); game result below is not meaningful`);
  // 1) phone: touch tap on the game
  const base = seedOf();
  await load('?debug', base);
  await waitFor(`!!document.querySelector('.fm-play')`, 15000, 'menu');
  const coarse = await ev(`matchMedia('(pointer: coarse)').matches`);
  if (!coarse) ctx.warn('emulated phone does not report (pointer: coarse); fullscreen.js would stay disabled');
  await tapXY(195, 330); await sleep(800);
  const fsTouch = await ev(FS);
  if (fsTouch) { ctx.pass('phone: touch tap -> document.fullscreenElement set'); await ev('document.exitFullscreen()'); await sleep(300); }
  else if (!bare) ctx.warn('phone: fullscreenElement null after touch tap, but the headless shell cannot fullscreen at all (harness limit)');
  else ctx.fail(`phone: touch tap did not enter fullscreen (coarse=${coarse})`);
  // 2) desktop: non-touch page, mouse click must NOT go fullscreen
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  try {
    await load('?debug', base);
    await waitFor(`!!document.querySelector('.fm-play')`, 15000, 'menu');
    const coarse2 = await ev(`matchMedia('(pointer: coarse)').matches`);
    await clickXY(195, 330); await sleep(800);
    const fsMouse = await ev(FS);
    if (!fsMouse && !coarse2) ctx.pass('non-touch page: click does not enter fullscreen'); else ctx.fail(`non-touch page: fullscreen=${fsMouse} coarse=${coarse2}`);
  } finally { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }).catch(() => {}); }   // later scenarios need touch back, even after a failure
}

async function soak(ctx) {
  const base = seedOf();
  const check = (label, hs) => {
    const g = hs[4] / hs[1] - 1;
    const line = `${label}: heap after GC MB ${hs.map((h) => h.toFixed(1)).join(' ')}; restart2 -> restart5 ${(g * 100).toFixed(0)}%`;
    if (g > 0.25) ctx.fail(line + ' (> 25% growth)'); else ctx.pass(line);
  };
  await load('?debug&endless&notut', base);
  await waitFor(`(${rushPlaying})&&(${dbgRush})`, 25000, 'rush');
  let hs = [];
  for (let i = 0; i < 5; i++) { await ev('cig.endless()'); await waitFor(`(${rushPlaying})&&(${dbgRush})`, 15000, 'rush restart'); await sleep(500); hs.push(await heapGC()); }
  check('5 Rush restarts', hs);
  await load('?debug&auto&cig=1', base);
  await waitFor(`window.cig&&cig.G.state==='play'`, 25000, 'mountain');
  hs = [];
  for (let i = 0; i < 5; i++) { await ev('cig.cigLevel(1,{retry:true})'); await waitFor(`cig.G.state==='play'`, 15000, 'mountain restart'); await sleep(500); hs.push(await heapGC()); }
  check('5 mountain restarts', hs);
  await memSample();
}

// ?debug with the overlay shown (the only scenario that does): game's own calls/tris line next to the draw hook numbers
async function debugStats(ctx) {
  await load('?debug&endless&notut&showdbg', seed3());
  await waitFor(`${rushPlay}`, 25000, 'rush playing');
  await sleep(3000);
  const dbg = await ev(`(document.getElementById('debug')||{}).textContent||''`);
  const m = /calls (\d+)\s+tris (\d+)k/.exec(dbg), f = /fps (\d+)/.exec(dbg);
  if (m) ctx.pass(`debug overlay (last render pass only): calls ${m[1]}, tris ${m[2]}k${f ? ', game fps ' + f[1] : ''}`); else ctx.fail('no calls/tris in #debug text: ' + JSON.stringify(dbg.slice(0, 120)));
}

// Vite's dev server reloads the page once when a lazily imported dependency (trystero/peerjs/three chunks) is first discovered.
// Touch every lazy path once up front so no scenario is hit by that reload. A second run is instant (cache in node_modules/.vite).
async function warmup() {
  const t = Date.now(); let reloads = 0;
  await load('?debug&endless&notut', seedOf());
  for (const step of ['cig.agar()', "cig.cigLevel(1,{})"]) {
    for (let a = 0; a < 3; a++) {
      let o0 = 0; try { o0 = await ev('performance.timeOrigin'); await ev(step); await sleep(1500); } catch { /* reloading */ }
      let o1 = 0; try { await waitFor('!!window.cig&&document.readyState==="complete"', 40000); o1 = await ev('performance.timeOrigin'); } catch { /* ignore */ }
      if (o0 === o1) break; reloads++;
    }
  }
  console.log(`warm-up: ${((Date.now() - t) / 1000).toFixed(1)} s, ${reloads} dev-server reload(s)`);
}

// ---------------------------------------------------------------- main
async function main() {
  if (!existsSync(CHROME)) { console.error('Chrome headless shell not found: ' + CHROME + ' (set CHROME_PATH)'); process.exit(2); }
  await takeLock(); T0 = Date.now();
  const vport = await freePort(), cport = await freePort();
  if (vport === 5173) throw new Error('refusing port 5173');
  ORIGIN = `http://127.0.0.1:${vport}`;
  // own config: same root/base as vite.config.js, but no HMR socket and no file watcher, so builders editing src/ mid-run cannot reload the page under a scenario
  const cfg = join(TMP, 'vite.e2e.config.mjs');
  writeFileSync(cfg, `export default { root: ${JSON.stringify(ROOT)}, base: './', server: { hmr: false, watch: null }, logLevel: 'warn' };`);
  const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--config', cfg, '--port', String(vport), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push({ name: 'vite', pid: vite.pid });
  let vlog = ''; vite.stdout.on('data', (d) => { vlog += d; }); vite.stderr.on('data', (d) => { vlog += d; });
  console.log(`vite pid ${vite.pid} on ${ORIGIN}; shots in ${SHOTS}`);
  for (let i = 0; ; i++) { try { if ((await fetch(ORIGIN + '/')).ok) break; } catch { /* not yet */ } if (i > 150) throw new Error('vite did not start: ' + vlog.slice(-300)); await sleep(200); }

  const args = [`--remote-debugging-port=${cport}`, `--user-data-dir=${PROFILE}`, '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-features=Translate,MediaRouter', '--renderer-process-limit=1',
    '--js-flags=--max-old-space-size=512', '--no-first-run', '--no-default-browser-check', '--disable-component-update', '--disable-default-apps', '--hide-scrollbars', '--window-size=390,844', 'about:blank'];
  const ch = spawn(CHROME, args, { stdio: 'ignore' });
  procs.push({ name: 'chrome', pid: ch.pid });
  console.log(`browser pid ${ch.pid} (headless shell, d3d11 GPU)`);
  let targets;
  for (let i = 0; ; i++) { try { targets = await (await fetch(`http://127.0.0.1:${cport}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* not yet */ } if (i > 100) throw new Error('browser did not start'); await sleep(200); }
  cdp = new CDP(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await cdp.open();
  for (const d of ['Page', 'Runtime', 'Network', 'Log', 'Performance', 'HeapProfiler']) await cdp.send(d + '.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SRC });   // GL draw counter + hidden debug overlay, every document
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  cdp.on('Fetch.requestPaused', (p) => {   // nothing leaves localhost
    const u = p.request.url;
    if (/^(http:\/\/127\.0\.0\.1|ws:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) cdp.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    else { externals.add(u.replace(/^(\w+:\/\/[^/]+).*/, '$1')); cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  });
  cdp.on('Runtime.exceptionThrown', (p) => E.exc.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).split('\n')[0].slice(0, 160)));
  cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') { const m = p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160); if (!/Failed to load resource/.test(m)) E.cons.push(m); } });
  cdp.on('Log.entryAdded', (p) => { const e = p.entry; if (e.level === 'error' && e.source !== 'network' && e.source !== 'intervention' && !/Failed to load resource/.test(e.text)) E.cons.push(`[${e.source}] ${e.text.slice(0, 140)}`); });
  if (process.env.VERBOSE) { cdp.on('Page.frameNavigated', (p) => { if (!p.frame.parentId) console.log('  [nav] ' + p.frame.url + ' @' + (now() / 1000).toFixed(1)); }); cdp.on('Runtime.consoleAPICalled', (p) => console.log('  [console.' + p.type + '] ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))); }
  const urls = new Map();
  cdp.on('Network.requestWillBeSent', (p) => urls.set(p.requestId, p.request.url));
  cdp.on('Network.responseReceived', (p) => { if (p.response.status >= 400 && p.response.url.startsWith(ORIGIN)) E.net.push(`${p.response.status} ${p.response.url.replace(ORIGIN, '')}`); });
  cdp.on('Network.loadingFailed', (p) => { const u = urls.get(p.requestId) || ''; if (u.startsWith(ORIGIN) && !p.canceled && p.errorText !== 'net::ERR_ABORTED') E.net.push(`${p.errorText} ${u.replace(ORIGIN, '')}`); });

  // GPU gate: the WebGL renderer string must not be a software rasteriser
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  renderer = await ev(`(()=>{const g=document.createElement('canvas').getContext('webgl2')||document.createElement('canvas').getContext('webgl');if(!g)return 'NO-WEBGL';const x=g.getExtension('WEBGL_debug_renderer_info');return x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)})()`);
  console.log('WebGL renderer: ' + renderer);
  if (/swiftshader|llvmpipe|software|NO-WEBGL/i.test(renderer)) {
    const m = `FAIL s0 gpu: WebGL renderer is "${renderer}" (software or missing); refusing to run on the CPU`;
    console.log(m); lines.push(m); return finish(1);
  }
  lines.push(`PASS s0 gpu: WebGL renderer "${renderer}"`);

  await warmup().catch((e) => console.log('warm-up failed: ' + e.message));
  await scenario(1, 'first-run EN', 30000, (c) => firstRun(c, null));
  await scenario(2, 'first-run TR', 30000, (c) => firstRun(c, 'tr'));
  await scenario(3, 'returning player + bottom nav', 30000, returning);
  await scenario(4, 'rush 1-minute playtest', 90000, rushPlaytest);
  await scenario(12, 'frame pacing (Rush)', 30000, s12);
  await scenario(13, 'first-run frames 0.5/2/5/10 s', 30000, firstFrames);
  await scenario(14, 'cig mountain 1 frames', 60000, (c) => cigFrames(c, 1));
  await scenario(15, 'cig mountain 12 frames', 60000, (c) => cigFrames(c, 12));
  await scenario(5, 'cig mountains 1/33/37', 30000, async (c) => { for (const n of [1, 33, 37]) await mountain(c, n, 3); });
  await scenario(6, 'cig endless + daily', 30000, endlessDaily);
  await scenario(7, 'arena solo', 30000, arena);
  await scenario(8, 'english leak scan', 30000, leaks);
  await scenario(9, 'fullscreen', 30000, fullscreen);
  await scenario(11, 'soak', 40000, soak);
  await scenario(16, 'debug overlay stats', 30000, debugStats);
}

async function run() {
  try { await main(); }
  catch (e) { console.error('FATAL', e); lines.push('FAIL harness: ' + String(e && e.message).slice(0, 160)); }
  const blanks = shotStats.filter(blank);
  const l10 = `${blanks.length ? 'FAIL' : 'PASS'} s10 non-blank canvas: ${shotStats.length} screenshots, ${blanks.length} blank${blanks.length ? ' (' + blanks.map((s) => s.name).join(',') + ')' : ''}`;
  if (!finishing) { lines.push(l10); console.log(l10); }
  finish(0);
}

async function finish(code) {
  if (finishing) return; finishing = true;
  try { await Promise.race([memSample(), sleep(8000)]); } catch { /* memory line still printed */ }
  const fails = lines.filter((l) => l.startsWith('FAIL')).length, warns = lines.filter((l) => l.startsWith('WARN')).length, passes = lines.filter((l) => l.startsWith('PASS')).length;
  console.log('\n==== SUMMARY ====');
  console.log(`PASS ${passes}  WARN ${warns}  FAIL ${fails}`);
  console.log(`renderer: ${renderer}`);
  console.log(`peak browser memory (sum of process working sets): ${peakMem} MB; peak JS heap ${peakHeap.toFixed(0)} MB`);
  console.log(`wall time: ${((Date.now() - T0) / 1000).toFixed(0)} s`);
  if (externals.size) console.log(`blocked external hosts (never contacted): ${[...externals].join(', ')}`);
  console.log(`screenshots: ${SHOTS}`);
  killAll(); dropLock();
  process.exit(code || (fails ? 1 : 0));
}

run();
