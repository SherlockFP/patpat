// PATPAT real-browser smoke test. Zero dependencies: Node 24 global fetch + WebSocket speak the Chrome DevTools Protocol.
// Run: npm run test:e2e   (env: CHROME_PATH, KEEP_TMP=1, VERBOSE=1, ONLY=<ids>, e.g. ONLY=3,13 )
// Rules: one headless-shell browser, one tab, one Vite dev server (own port, never 5173), GPU only (d3d11, never swiftshader), muted,
// 390x844 @ dpr 1, nothing online (every non-localhost request is blocked), only our own PIDs are killed, never the owner's Chrome.
// Machine lock: os.tmpdir()/patpat-smoke.lock holds the PID of the running smoke test; a second run waits up to 8 min, a lock whose PID is dead is taken over.
// Timeouts: every scenario has a hard timeout (30 s default, 90 s Rush playtest; a few say otherwise below). On expiry it FAILs and the run moves on;
// the stuck scenario can no longer touch the browser (its next CDP call is rejected). Whole run is capped at ~6 min (later scenarios are skipped with WARN).
// Frames for humans/critics are shot without the ?debug overlay: s1-s4, s13, s14, s15 load without ?debug. Scenarios that need the cig.* hooks (s5-s9, s11) load with
// ?debug but an injected style (#debug{display:none}) keeps the overlay out of every frame; only s16 shows it. Draw calls / triangles come from a WebGL draw hook
// injected into every document (all passes of a frame summed), so they work without ?debug.
//
// Scenario ids (ONLY=<ids>, comma separated; every id runs alone, nothing depends on another scenario):
//   1  first-run EN (FTUE autostart into YETI RUSH)          2  first-run TR (s2_play_tr.png: Turkish HUD on purpose)
//   3  returning player: settled main menu, s3_menu_early.png (150 ms after first appearance), every bottom-nav button by label
//   4  Rush 60 s playtest (save with 3 previous runs, normal game): rush_00..11.png, rush_section.png, rush_ch2.png (1.1 s after CHAPTER 2 shows), rush_result.png, retry
//   5  cig mountains 1/33/37 (8 s each, ?auto)               6  cig endless + daily            7  arena solo
//   8  english leak scan                                      9  fullscreen                    11  soak (heap after GC)
//   12 frame pacing (Rush, rAF deltas)                        13 first-run frames first_00..03.png at 0.5/2/5/10 s (fresh save)
//   14 cig mountain 1 start/mid/town/end (cig_1_*.png)             15 cig mountain 12 start/mid/end (cig_12_*.png)
//   16 debug overlay stats (?debug shown, reads calls/tris text)   17 mountain result cards, 2 stars and the tallest 3-star one (res_miss3.png, res_full3.png, fit checks)   18 Rush HUD states: cannon bar, chapter flag, toast hides the strip (rush_cannon.png, rush_toast.png)   19 model gallery (gal_*.png, needs ?debug hooks)   20 chapter sky backdrops (sky_orman/ray/duello.png, ?debug hooks)   21 rush camera sweep (flat frames)   22 new chapters ekspres/ay/lazer/kopru/fuze/hareket/heyelan/turbo: rush_ch_<id>.png (name strip + one-word label) and mech_<id>.png (the mechanic in view, needs ?debug hooks)   24 menu text: after every bottom-nav panel and after a Rush death -> MENU no toast / hint / float / banner / HUD text is left on screen   25 AI UI icons: icons_rush_buff.png, icons_perk.png, icons_cig.png (images decoded, not emoji)   10 is the final blank-frame check (always printed)
import { spawn, execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, setPriority, constants as osc } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { AsyncLocalStorage } from 'node:async_hooks';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BUDGET_MS = 380_000;                     // whole run (browser time) must stay under ~6 min; later scenarios are skipped past this
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
  let n = 0, s = 0, s2 = 0; const set = new Set(), bins = new Map(); let mid = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    const i = y * st + x * bpp, l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; n++; s += l; s2 += l * l; set.add((px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | px[i + 2] >> 4);
    if (y > h * 0.15 && y < h * 0.85) { mid++; const q = (px[i] >> 5) << 6 | (px[i + 1] >> 5) << 3 | px[i + 2] >> 5; bins.set(q, (bins.get(q) || 0) + 1); }   // dom: the biggest coarse-colour share of the middle band
  }
  return { std: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), uniq: set.size, dom: Math.max(0, ...bins.values()) / (mid || 1) };
}
// opts.noBlank: intro frames that may legitimately be near-empty (boot veil, first paint) are kept but not blank-checked
// Rush top HUD: no two of these boxes may touch (score, x-multiplier, flakes + metres, mission / rage pill, chapter name, soft toast, buff icon, pause)
const HUD_CLASH = `(()=>{const S=['#btn-pause','.hud-tons','.cmb.on','.hud-coins','.hud-goal:not(.hidden)','.chap-pill.on','#toast-soft .ts','.buffs .buff:first-child','.perk-ico'],R=[];for(const q of S)for(const e of document.querySelectorAll(q)){const b=e.getBoundingClientRect(),cs=getComputedStyle(e);if(b.width<2||b.height<2||cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.3)continue;R.push([q,b.left,b.top,b.right,b.bottom])}
const bad=[];for(let i=0;i<R.length;i++)for(let j=i+1;j<R.length;j++){const a=R[i],b=R[j];if(a[0]===b[0])continue;if(Math.min(a[3],b[3])-Math.max(a[1],b[1])>1&&Math.min(a[4],b[4])-Math.max(a[2],b[2])>1)bad.push(a[0]+' x '+b[0]+' @'+Math.round(a[2])+'/'+Math.round(b[2]))}return bad})()`;
// Readability contract (every Rush / chapter / mech frame): the ball's screen circle (window.__ppv, written by runner.js each frame) must stay >= 75% visible.
// DOM paint rects (backgrounds, images, text lines of every visible element, scaled by effective opacity) + the 3D estimate (ppv.occ(): CPU rays that mirror nearfade.js, mist puffs) are merged per sample point (25 points over the circle).
// Horizon (camera pitch) must sit in the upper 15-55% of the screen; no more than one centre toast / banner; none of them over the top HUD.
const BALL_READ = `(()=>{const P=window.__ppv;if(!P||!P.on||!document.getElementById('result').classList.contains('hidden'))return null;const W=innerWidth,H=innerHeight,m=P.occ(),cx=(P.x+1)/2*W,cy=(1-P.y)/2*H,rad=P.ry*H/2,N=25,px=[],py=[];
for(let i=0;i<N;i++){px.push((P.sx[i]+1)/2*W);py.push((1-P.sy[i])/2*H)}
const R=[],eo=new Map(),op=(e)=>{if(!e||e===document.documentElement)return 1;let v=eo.get(e);if(v!==undefined)return v;const c=getComputedStyle(e);v=(c.display==='none'||c.visibility==='hidden'&&false)?0:+c.opacity*op(e.parentElement);eo.set(e,v);return v};
const add=(r,o,n)=>{if(r.width>1&&r.height>1&&r.width*r.height<0.6*W*H)R.push([r.left,r.top,r.right,r.bottom,o,n])};
for(const e of document.body.querySelectorAll('*')){if(/^(CANVAS|SCRIPT|STYLE)$/.test(e.tagName))continue;const c=getComputedStyle(e);if(c.display==='none'||c.visibility==='hidden')continue;const o=op(e);if(o<0.2)continue;const n=(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.split(' ')[0]:'')||e.tagName;
const bg=c.backgroundColor.match(/[\d.]+/g)||[],a=bg.length>3?+bg[3]:(/^rgb/.test(c.backgroundColor)?1:0);
if(a>0.25||c.backgroundImage!=='none'||/^(IMG|SVG|VIDEO)$/i.test(e.tagName))add(e.getBoundingClientRect(),o*(a>0.25?Math.min(1,a):1),n);
for(const t of e.childNodes)if(t.nodeType===3&&t.textContent.trim()){const g=document.createRange();g.selectNodeContents(t);for(const r of g.getClientRects())add(r,o,n+'(text)')}}
let sum=0,dsum=0,wn='',ww=0;for(let i=0;i<N;i++){let d=0,nm='';for(const r of R)if(px[i]>=r[0]&&px[i]<=r[2]&&py[i]>=r[1]&&py[i]<=r[3]&&r[4]>d){d=r[4];nm=r[5]}
const k=1-(1-Math.min(1,d))*(1-m[i]);dsum+=d;sum+=k;if(d>ww){ww=d;wn=nm}}
const hf=(1-P.hy)/2,vf=(1-P.vy)/2;
const sel='#banner .b,#toast-soft .ts,#toast:not(.hidden),#subtitle,#tutor:not(.hidden),.rcp,.chap-pill.on,.rx-sum,#danger.on';const cen=[...document.querySelectorAll(sel)].filter(e=>{const b=e.getBoundingClientRect(),c=getComputedStyle(e);return b.width>8&&b.height>8&&c.visibility!=='hidden'&&+c.opacity>0.3&&b.top>0.1*H&&b.top<0.6*H}).map(e=>(e.id||e.className||e.tagName).toString().slice(0,18));
const top=document.querySelector('.hud-tons')?.getBoundingClientRect(),slab=[...document.querySelectorAll('.rcp,#banner .b')].map(e=>e.getBoundingClientRect()).filter(b=>b.width>8&&top&&b.top<top.bottom+2&&b.bottom>top.top);
return{pct:Math.round(sum/N*100),dom:Math.round(dsum/N*100),mesh:Math.round(m.reduce((a,b)=>a+b,0)/N*100),by:ww>0?wn:P.what,st:P.st,cx:Math.round(cx),cy:Math.round(cy),rad:Math.round(rad),off:cx<0||cx>W||cy<0||cy>H,hf:+hf.toFixed(2),vf:+vf.toFixed(2),cen,slab:slab.length}})()`;
const READ_LOG = [];
const badOf = (r) => [r.pct > 25 && `ball ${r.pct}% covered (dom ${r.dom}%, 3D ${r.mesh}%, by ${r.by}; ball at ${r.cx},${r.cy} r${r.rad})`, (r.hf < 0.15 || r.hf > 0.55) && `horizon at ${Math.round(r.hf * 100)}%`, r.off && `ball off screen at ${r.cx},${r.cy}`, r.cen.length > 1 && `${r.cen.length} centre toasts/banners: ${r.cen.join(', ')}`, r.slab && 'banner/summary slab over the top HUD'].filter(Boolean).map((x) => `[${r.st}] ${x}`).join('; ');
// live sampling while a scenario plays (no screenshot per sample): L = {n, bad, max, list}; up to 4 offending moments are shot as <tag>_bad_N.png
async function liveRead(L, tag, ctx) {
  let r = null; try { await ev('window.__raf&&(window.__raf.skip=true)'); r = await ev(BALL_READ); await ev('window.__raf&&(window.__raf.skip=false,window.__raf.ign=3)'); } catch (e) { return; }   // (the probe itself costs a few ms: its frames stay out of the pacing numbers)
  if (!r) return; L.n++; L.max = Math.max(L.max, r.pct); const b = badOf(r); if (!b) return; L.bad++;
  if (L.list.length < 4) { L.list.push(b); await ev(`(()=>{const d=document.createElement('div');d.id='ppdbg';d.style.cssText='position:fixed;z-index:99;pointer-events:none;border:2px solid red;border-radius:50%;left:${r.cx - r.rad}px;top:${r.cy - r.rad}px;width:${r.rad * 2}px;height:${r.rad * 2}px';document.body.appendChild(d)})()`); await shot(tag + '_bad_' + L.list.length, ctx, { noBlank: true, noRead: true }); await ev(`document.getElementById('ppdbg')?.remove()`); }
}
async function ballRead(name, ctx) {
  let r = null; try { r = await ev(BALL_READ); } catch (e) { return; }
  if (!r) return; READ_LOG.push({ name, ...r });
  if (r.pct > 25) ctx.fail(`ball ${r.pct}% covered in ${name}.png (dom ${r.dom}%, 3D ${r.mesh}%, by ${r.by}; ball at ${r.cx},${r.cy} r${r.rad})`);
  if (r.off) ctx.fail(`ball off screen (${r.cx},${r.cy}) in ${name}.png`);
  if (r.hf < 0.15 || r.hf > 0.55) ctx.fail(`[${r.st}] horizon at ${Math.round(r.hf * 100)}% of the screen height in ${name}.png (must be 15-55%)`);
  if (r.cen.length > 1) ctx.fail(`${r.cen.length} centre toasts / banners at once in ${name}.png: ${r.cen.join(', ')}`);
  if (r.slab) ctx.fail(`banner / summary slab covers the top HUD in ${name}.png`);
}
const HUD_FRAME = /^(rush_(?!result)|mech_)/;
const frames = [];                                // every frame this run wrote: _manifest.json lists them next to the result lines, so frames and logs travel together
async function shot(name, ctx, opts = {}) {
  let clash = []; if (ctx && HUD_FRAME.test(name)) { try { clash = await ev(HUD_CLASH); } catch { /* page busy */ } }
  if (clash.length) ctx.fail(`top HUD boxes touch in ${name}.png: ${clash.join(', ')}`);
  if (ctx && HUD_FRAME.test(name) && !opts.noRead && !/^rush_power/.test(name)) await ballRead(name, ctx);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); frames.push(name + '.png');
  const buf = Buffer.from(r.data, 'base64'); writeFileSync(join(SHOTS, name + '.png'), buf);
  const s = pngStats(buf); s.bytes = buf.length; s.name = name;
  if (!opts.noBlank) { shotStats.push(s); if (ctx) (ctx.shots ||= []).push(s); }
  return s;
}
const FLAT_RE = /^(rush_(?!result)|mech_|first_0[1-3]|cig_)/;   // gameplay frames: one flat colour over the middle band (camera inside terrain, e.g. a full green frame) = blank
const blank = (s) => s.std < 6 || s.uniq < 24 || (FLAT_RE.test(s.name || '') && s.dom > 0.72);

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
const flush=()=>{if(G.calls){G.n++;G.sc+=G.calls;G.st+=G.tris;if(G.calls>G.mc)G.mc=G.calls;if(G.tris>G.mt)G.mt=G.tris}G.calls=0;G.tris=0};G.flush=flush;const tick=()=>{flush();requestAnimationFrame(tick)};requestAnimationFrame(tick);
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
  if (left < 6000) { out.push(['WARN', 'skipped: 6 min run budget used']); }
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
    const bl = ctx.shots.filter(blank); if (bl.length) ctx.fail('blank frame: ' + bl.map((s) => `${s.name}(std ${s.std.toFixed(1)},uniq ${s.uniq},dom ${(s.dom || 0).toFixed(2)})`).join(','));
    else if (ctx.shots.length) ctx.pass(`non-blank x${ctx.shots.length} (min std ${Math.min(...ctx.shots.map((s) => s.std)).toFixed(1)}, min colours ${Math.min(...ctx.shots.map((s) => s.uniq))})`);
    const gl = glLine(GLACC); if (gl) out.push(['INFO', gl]);
    if (GLACC && GLACC.mc >= 400) ctx.fail(`draw calls in one frame reached ${GLACC.mc} (limit 400)`);
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
  await shot(lang === 'tr' ? 's2_play_tr' : 's1_play', ctx);   // (s2 is the deliberate Turkish run: its HUD is Turkish on purpose)
  if (d1 > d0) ctx.pass(`playing Rush, distance ${d0} -> ${d1} m, load ${ms} ms`); else ctx.fail(`distance not increasing (${d0} -> ${d1})`);
  if (!lang) {   // the English HUD (quest chip, hints, goal strip) must not carry a Turkish letter
    const hud = await ev(`document.getElementById('hud').innerText`), tr = hud.match(/[ğüşıöçİĞÜŞÖÇ]/g);
    if (tr) ctx.fail(`EN HUD text has Turkish letters ${[...new Set(tr)].join('')}: "${hud.replace(/\s+/g, ' ').slice(0, 120)}"`); else ctx.pass(`EN HUD text has no Turkish letters: "${hud.replace(/\s+/g, ' ').slice(0, 60)}"`);
  }
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

// Rush HUD states that a random bot rarely shows at once: the cannon perk bar (blue, snowflake, x count), the chapter flag pulsing inside the last 100 m, then a toast taking the strip (goal pill + chapter bar hide)
async function hudStates(ctx) {
  await load('?endless&notut', seed3());
  await waitFor(`${rushPlay}&&(${hudDist})>=0`, 30000, 'rush playing');
  await sleep(3600); await ev(`document.getElementById('toast-soft').innerHTML=''`);   // (the first postcard toast arrives ~3 s into a run: let it pass, it would own the strip)
  await ev(`(()=>{document.getElementById('hud').classList.remove('no-chap');const g=document.getElementById('hud-goal');g.classList.remove('hidden','cp','rec','rage','new','fury');g.classList.add('cannon');document.getElementById('hud-goal-lbl').textContent='SNOW CANNON ×5';document.getElementById('hud-goal-fill').style.width='60%';let b=document.querySelector('.chap-bar');if(!b){b=document.createElement('div');b.className='chap-bar';b.innerHTML='<i></i><b>CH 1</b>';document.getElementById('hud').appendChild(b)}b.hidden=false;b.classList.add('near');b.firstChild.style.width='92%'})()`);
  await sleep(500); await shot('rush_cannon', ctx);
  const a = await ev(`(()=>{const g=getComputedStyle(document.getElementById('hud-goal'));const b=document.querySelector('.chap-bar');return{pill:g.visibility,cannon:document.querySelector('#hud-goal').classList.contains('cannon'),bar:b?getComputedStyle(b).visibility:'none',flag:b?getComputedStyle(b,'::after').animationName:'none',reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,cls:b?b.className:''}})()`);
  if (a.cannon && a.pill === 'visible' && a.bar === 'visible' && (a.flag !== 'none' || a.reduced)) ctx.pass(`cannon pill + near flag (pulses unless reduced motion, which this headless shell emulates): ${JSON.stringify(a)}`); else ctx.fail(`cannon pill / flag state wrong: ${JSON.stringify(a)}`);
  await ev(`(()=>{const t=document.getElementById('toast-soft');t.innerHTML='<div class="ts"><span class="ti">📮</span><span>POSTCARD: Pine Forest 2/18</span></div>'})()`);
  await sleep(300); await shot('rush_toast', ctx);
  const b = await ev(`(()=>({pill:getComputedStyle(document.getElementById('hud-goal')).visibility,bar:(()=>{const b=document.querySelector('.chap-bar');return b?getComputedStyle(b).visibility:'none'})()}))()`);
  if (b.pill === 'hidden' && (b.bar === 'hidden' || b.bar === 'none')) ctx.pass(`toast up: goal pill and chapter bar hidden (${JSON.stringify(b)})`); else ctx.fail(`toast up but strip still shows: ${JSON.stringify(b)}`);
}

// scenario 19: model gallery. Spawns the Blender critters / props straight ahead of an invulnerable ball (needs ?debug hooks) and shoots them at phone size (gal_critters_a/b, gal_props_a/b.png).
async function gallery(ctx) {
  await load('?endless&notut&debug', seed3());
  await waitFor(`${rushPlay}&&(${hudDist})>=0`, 30000, 'rush playing');
  const put = (spec) => ev(`(()=>{const r=cig.runner,o=r.obstacles,b=r.b;r.invulnT=999;r.yetiHoldT=99;${spec}})()`);
  const crit = (rows) => put(`const C=o.critters;${JSON.stringify(rows)}.forEach((row,i)=>row.forEach((sp,l)=>C.spawnGroup({species:sp,s:b.s+9+i*6.5,lane:l,n:1,spacing:2,vc:0.2,hopTo:-1,second:-1,seed:i*7+l})))`);
  const prop = (rows) => put(`${JSON.stringify(rows)}.forEach((row,i)=>row.forEach((ty,l)=>o._static({batch:[]},ty,b.s+10+i*7,[-2.4,0,2.4][l],ty==='crate'?{n:2}:{})))`);
  const go = async (name) => { await sleep(120); await ev('window.__raf&&(window.__raf.skip=true)'); await shot(name, ctx); await ev('window.__raf&&(window.__raf.skip=false)'); await put('r.b.s=Math.max(r.b.s,0)'); };
  await crit([['penguin', 'bunny', 'squirrel'], ['miniyeti', 'snowmini', 'scorpion'], ['jelly', 'robot', 'arcticfox']]); await go('gal_critters_a');
  await put('o.critters.reset?.()'); await crit([['panda', 'polarcub', 'clownbot'], ['lavabug', 'penguin', 'bunny']]); await go('gal_critters_b');
  await prop([['snowman', 'sign', 'crate'], ['sled', 'logpile', 'pine'], ['rock', 'stone', 'snowman']]); await go('gal_props_a');
  await put('o._static({batch:[]},"cabin",b.s+10,-2.4);o._mk({batch:[]},{kind:"overhead",s:b.s+20,lo:0,hi:2,hb:1.2,u:0,ext:2.4,glow:0xffd23a});o._static({batch:[]},"snowcat",b.s+36,2.4,{L:12,ext:7.5})'); await go('gal_props_c');   // Blender cabin, barrier row, loco + cars
  await put('o._static({batch:[]},"snowcat",b.s+22,-2.4,{L:12,ext:7.5,ice:true});o._static({batch:[]},"snowcat",b.s+22,2.4,{L:12,ext:16,ride:true,rl:0,H:2.3})'); await go('gal_props_d');   // ice train + ride car
  ctx.pass('gallery frames shot');
}

// scenario 20: chapter sky backdrops. Real chapter plan (b.s jumps into ORMAN / RAY / DUELLO), shoots sky_<id>.png after the dissolve; asserts the backdrop id + a ready texture.
async function skies(ctx) {
  await load('?endless&notut&debug', seed3());
  await waitFor(`${rushPlay}&&(${hudDist})>=0`, 30000, 'rush playing');
  await ev('(()=>{const r=cig.runner;r.invulnT=999;r.yetiHoldT=99})()');
  for (const [id, sky] of [['orman', 'dawn'], ['ray', 'canyon'], ['duello', 'night']]) {
    await ev(`(()=>{const r=cig.runner,seg=r.chapters.segs.find((g)=>g.id==='${id}')||(()=>{let g;for(let i=0;i<9&&!(g=r.chapters.segs.find((x)=>x.id==='${id}'));i++)r.chapters.at(r.chapters.segs[r.chapters.segs.length-1].s1+1);return g})();r.b.s=seg.s0+60})()`);
    await waitFor(`cig.runner.chap&&cig.runner.chap.id==='${id}'`, 4000, 'chapter ' + id).catch(() => {});
    await ev('(()=>{const r=cig.runner;if(r._lookP)r._lookP.bi=-1})()');      // (the chapter sky waits for the next track biome; here the biome change is faked)
    await waitFor(`cig.runner.chap&&cig.runner.chap.id==='${id}'&&cig.runner.env._bdCur==='${sky}'&&cig.runner.env._bdK>0.95`,6000,'sky '+id).catch(()=>{});
    const st = await ev(`(()=>{const r=cig.runner,e=r.env;return {cur:e._bdCur,k:e._bdK,vis:e.bd.visible,chap:r.chap&&r.chap.id,s:r.b.s,segs:r.chapters.segs.map((g)=>g.id+':'+g.s0).join(',')}})()`);
    await shot('sky_' + id, ctx);
    if (st.cur === sky && st.vis && st.k > 0.9) ctx.pass(`chapter ${id}: sky backdrop ${sky} shown (${JSON.stringify(st)})`); else ctx.fail(`chapter ${id}: expected backdrop ${sky}, got ${JSON.stringify(st)}`);
  }
  // yeti.glb (Blender, public/models): skinned + run / roar clips found by runner.js makeYeti (the capsule only stands in when the file is missing)
  const ym = await ev('!!(cig.runner.yeti.mixer&&cig.runner.yeti.runA&&cig.runner.yeti.roarA)');
  if (ym) ctx.pass('yeti.glb: skinned model with run + roar clips found'); else ctx.fail('yeti.glb clips missing: capsule fallback in use');
}

let rushStats = null, rushGl = null;   // rushStats: rAF data of the last Rush run, reused by s12 when s4 ran first
const LIVE = { n: 0, bad: 0, max: 0, list: [] };
const liveRun = () => { LIVE.n = LIVE.bad = LIVE.max = 0; LIVE.list.length = 0; };
async function rushPlaytest(ctx) {
  await load('?endless&notut', seed3());
  const tNav = Date.now();
  await waitFor(`${rushPlay}&&(${hudDist})>=0`, 30000, 'rush playing');
  const tFirst = Date.now() - tNav;
  await ev(RAF_INSTALL);
  ctx.pass(`time page-load -> first playable frame (HUD+state=play): ${tFirst} ms`);
  const KS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  let secShot = false;
  const sections = new Set();   // set-piece name strips seen (.sec-strip)
  const chaps = new Set(); let ch2At = 0, ch2Shot = false;   // chapter name pills seen; rush_ch2.png is shot 1.1 s after 'CHAPTER 2' appears (the new biome palette has blended in)
  let played = 0, frame = 0, deaths = 0, tick = 0, lastT = Date.now(), resultShot = false, powerShot = false, retryMs = [], paceDone = false, clipDone = false;
  const rows = [];
  const cap = Date.now() + 100000;   // wall cap: every death costs ~5 s of result+retry that is not "played"
  const afterResult = async (td) => {   // result screen is up: shoot once, retry, back to playing
    await sleep(600);
    if (!resultShot) { resultShot = true; await ev(`document.querySelector('.rx-ms')?.style.setProperty('--f','45%')`); await shot('rush_result', ctx);   // (--f 45%: the mission fill is on screen, so the frame shows it next to the text)
      const t = await ev(`document.getElementById('result').innerText.replace(/\\s+/g,' ').slice(0,100)`); ctx.pass(`result screen: "${t}"`); }
    // GÜÇ entry on the result: the button (only while something is affordable) or the 'Next: ...' bar of the card; opens the panel over it, closes again
    const pwSel = !powerShot && await ev(`(()=>{const b=document.getElementById('btn-power');return document.querySelector('.rx-up')?'.rx-up':b&&b.style.display!=='none'?'#btn-power':''})()`);   // the Next bar (button) first: it opens GÜÇ at that upgrade's row
    if (pwSel) {
      powerShot = true;
      await tapSel(pwSel, null, 3000).catch(() => {}); await sleep(700); await shot('rush_power', ctx);
      const open = await ev(`!!document.querySelector('.fm-x')`);
      if (open) { await tapSel('.fm-x', null, 3000).catch(() => {}); await sleep(300); ctx.pass('result GÜÇ button opens the GÜÇ panel and it closes again'); } else ctx.fail('result GÜÇ button did not open a panel');
    } else if (!powerShot) ctx.warn('result: no GÜÇ button and no Next bar');
    await tapSel('#btn-retry', null, 5000).catch(async () => { await tapSel('#result button', /AGAIN|RETRY|TEKRAR/i, 3000); });
    await waitFor(`${rushPlay}`, 15000, 'play after retry');
    retryMs.push(Date.now() - td); lastT = Date.now();
  };
  while ((frame < 12 || played < 60000) && Date.now() < cap) {
    const st = await ev(RUSH_ST);
    const dt = Date.now() - lastT; lastT = Date.now();
    if (st.play) played += dt;
    if (st.rv) { await tapSel('#btn-revive-end', null, 3000).catch(() => {}); continue; }
    if (st.res) { deaths++; ch2At = 0; await afterResult(Date.now()); continue; }
    if (st.play) { if (tick++ % 2 === 0) await key(KS[(Math.random() * KS.length) | 0]); }
    if (st.play && tick % 2 === 1) await liveRead(LIVE, 'rush', ctx);
    if (st.play && tick % 3 === 0) {
      const o = await ev(`(()=>{const q=(c)=>{const e=document.querySelector(c);return e?e.textContent.trim():''};return{sec:q('.sec-strip.on'),ch:q('.chap-pill.on')}})()`);
      if (o.sec) sections.add(o.sec);
      if (o.sec && !secShot) { secShot = true; await ev('window.__raf.skip=true'); await shot('rush_section', ctx); await ev('window.__raf.skip=false;window.__raf.ign=3'); }
      if (o.ch) { chaps.add(o.ch); if (/CHAPTER 2/.test(o.ch) && !ch2At && !ch2Shot) ch2At = Date.now(); }
    }
    if (ch2At && !ch2Shot && Date.now() - ch2At > 1100 && st.play) { ch2Shot = true; await ev('window.__raf.skip=true'); await shot('rush_ch2', ctx); await ev('window.__raf.skip=false;window.__raf.ign=3'); }
    if (frame < 12 && played >= frame * 5000) {
      const r = await ev(`({d:${hudDist},sc:(document.getElementById('hud-tons')||{}).textContent})`);
      await ev('window.__raf.skip=true'); await shot('rush_' + String(frame).padStart(2, '0'), ctx); await ev('window.__raf.skip=false;window.__raf.ign=3');
      const clip = await ev(`(()=>{const e=document.querySelector('#hud.rush .hud-goal:not(.hidden) .goal-lbl');return e&&e.scrollWidth>e.clientWidth+1?e.textContent.trim():''})()`);   // mission pill text cut off (390 px wide)
      if (clip && !clipDone) { clipDone = true; ctx.fail('mission pill text is truncated: ' + clip); }
      rows.push(`#${String(frame).padStart(2, '0')} t=${frame * 5}s dist=${r.d}m score=${r.sc}`);
      if (frame === 2 && !paceDone) { paceDone = true; await ev(`window.__raf.mark=window.__raf.d.length`); }
      if (frame === 4) rushStats = await ev(RAF_READ);
      if (frame === 5) await memSample();
      frame++;
    }
    await sleep(120);
  }
  await glTake(); rushGl = glLine(GLACC);
  if (frame < 12 || played < 60000) ctx.fail(`only ${frame}/12 frames, played ${(played / 1000).toFixed(0)} s in ${(100000 / 1000)} s wall cap`);
  console.log('  ' + rows.join('\n  '));
  if (LIVE.bad) ctx.fail(`readability: ${LIVE.bad}/${LIVE.n} live samples broke the contract (worst ball cover ${LIVE.max}%): ${LIVE.list.join(' | ')}`); else ctx.pass(`readability: ${LIVE.n} live samples, worst ball cover ${LIVE.max}%, none broke the contract`);
  if (sections.size) ctx.pass(`set-piece strips seen: ${[...sections].join(' | ')}`); else ctx.warn('no set-piece strip seen in 60 s (set pieces are random)');
  if (ch2Shot) ctx.pass(`chapters seen: ${[...chaps].join(' | ')}; rush_ch2.png shot after the chapter change`); else ctx.warn(`CHAPTER 2 never reached in one life (chapters seen: ${[...chaps].join(' | ') || 'none'}); no rush_ch2.png`);
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
  // mid-demolition frame: the town chip ("TOWN 40%+") before the result (QA critic: the payoff must be visible in a frame)
  const town = await waitFor(`(()=>{const m=/TOWN (\d+)%/.exec((document.getElementById('hud-level')||{}).textContent||'');return (!!m&&+m[1]>=40)||(${RESULT_UP})})()`, Math.max(1000, t + 42000 - Date.now()), 'town 40%').then(() => true, () => false);
  if (town && !(await ev(RESULT_UP))) await shot(`cig_${n}_town`, ctx);
  const end = await waitFor(RESULT_UP, Math.max(1000, t + 42000 - Date.now()), 'result').then(() => true, () => false);
  if (end) { await sleep(900); await shot(`cig_${n}_end`, ctx); await sleep(1700); await fitCheck(ctx, `mountain ${n} result (real run, 2.6 s in)`); const tx = await ev(`document.getElementById('result').innerText.replace(/\\s+/g,' ').slice(0,80)`); ctx.pass(`mountain ${n}: finale/result reached at ${((Date.now() - t) / 1000).toFixed(0)} s: "${tx}"`); }
  else ctx.warn(`mountain ${n}: no result within 42 s of start (?auto bot still running), no end frame`);
}

// result overlay of a real run: banner below the top edge, every button inside the screen, nothing to scroll
async function fitCheck(ctx, what) {
  const m = await ev(`(()=>{const o=document.querySelector('.fm-resov');if(!o)return null;const bt=[...o.querySelectorAll('.fm-rbtns .fm-btn')].map(b=>Math.round(b.getBoundingClientRect().bottom)),bn=o.querySelector('.fm-banner').getBoundingClientRect();return{bt,top:Math.round(bn.top),sh:o.scrollHeight,ch:o.clientHeight,h:innerHeight}})()`);
  if (!m) { ctx.warn(`${what}: no result overlay to measure`); return; }
  if (m.bt.length && Math.max(...m.bt) <= m.h && m.top >= 8 && m.sh <= m.ch + 1) ctx.pass(`${what} fits one screen: button bottoms ${m.bt.join('/')} of ${m.h}, title top ${m.top}, card ${m.sh}/${m.ch}`);
  else ctx.fail(`${what} does not fit: ${JSON.stringify(m)}`);
}

// the tallest mountain result card (star 3 missed, 4 chips, NEXT REWARD): RETRY and MOUNTAINS must sit inside one 390x844 screen, the title below the top edge, the card must not scroll
async function resultLayouts(ctx) {
  await load('?debug', seedOf());
  await waitFor(`!!(window.cig&&cig.menus&&cig.plan)`, 25000, 'debug hooks');
  await ev(`(()=>{const P=cig.plan(12);cig.menus.showLevelComplete({level:{id:P.n,name:P.name,boss:P.boss,act:1,length:P.length,goals:P.stars.map(s=>({text:s.text}))},stars:2,goalsMet:[true,true,false],rewards:{coins:60,crystals:0},hasNext:true,labels:{banner:'KASABA %100 YIKILDI',next:'SONRAKİ DAĞ ▶',map:'DAĞLAR',retry:'↻ TEKRAR'},chips:['🏘️ 100%','⚪ 12.4 m','⚖️ 3.2 kt','⏱ 0:41']},{})})()`);
  await sleep(2300); await shot('res_miss3', ctx);
  const m = await ev(`(()=>{const o=document.querySelector('.fm-resov'),bt=[...o.querySelectorAll('.fm-rbtns .fm-btn')].map(b=>Math.round(b.getBoundingClientRect().bottom)),bn=o.querySelector('.fm-banner').getBoundingClientRect();return{bt,top:Math.round(bn.top),sh:o.scrollHeight,ch:o.clientHeight,h:innerHeight}})()`);
  if (m.bt.length >= 2 && Math.max(...m.bt) <= m.h && m.top >= 8 && m.sh <= m.ch + 1) ctx.pass(`mountain result with star 3 missed fits one screen: button bottoms ${m.bt.join('/')} of ${m.h}, title top ${m.top}, card ${m.sh}/${m.ch}`);
  else ctx.fail(`mountain result with star 3 missed does not fit: ${JSON.stringify(m)}`);
  // the other tall case: a perfect 3-star clear with the act chest, the perfect-act line and the Rush unlock on top of 6 chips
  await ev(`(()=>{const P=cig.plan(12);cig.menus.showLevelComplete({level:{id:P.n,name:P.name,boss:P.boss,act:1,length:P.length,goals:P.stars.map(s=>({text:s.text}))},stars:3,goalsMet:[true,true,true],rewards:{coins:60,crystals:2,chest:{coins:200},perfect:true,justUnlockedEndless:true},hasNext:true,labels:{banner:'KASABA %100 YIKILDI',next:'SONRAKİ DAĞ ▶',map:'DAĞLAR',retry:'↻ TEKRAR'},chips:['🏘️ 100%','⚪ 12.4 m','⚖️ 3.2 kt','⏱ 0:41','❄️ 60']},{})})()`);
  await sleep(2300); await shot('res_full3', ctx);
  await fitCheck(ctx, 'mountain result, 3 stars + chest + perfect + Rush unlock');
}

async function endlessDaily(ctx) {
  const base = seedOf();
  await load('?debug&auto&cig=endless', base);
  await waitFor(`window.cig&&cig.G.mode==='cig'&&cig.G.state==='play'`, 25000, 'endless playing');
  await sleep(1500); await shot('s6_endless_early', ctx);   // ~1.5 s in: the EAT TO GROW hint and the dense opening cluster
  const a = await ev('cig.summary()'); await sleep(2500); const b = await ev('cig.summary()');
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
  await load('?endless&notut', seed3());   // in-run Rush HUD: the mission pill (#hud-goal-lbl), score row, chips
  await waitFor(`${rushPlay}&&(${hudDist})>=0`, 30000, 'rush playing'); await sleep(2500); await scan('Rush HUD (mission pill)');
  const names = Object.keys(found);
  if (!names.length) ctx.pass('no Turkish-only letters in menu, mountain list, settings, wardrobe, arena lobby, in-run Rush HUD');
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

// Rush camera sweep (needs ?debug hooks): sims whole runs with random lane changes and renders after every step; any frame where one colour fills the middle of the screen
// (camera inside terrain / a tunnel) is a FAIL. Same flat-colour test as the shot() check below, but on every 20th sim frame, so a 1-in-a-run frame cannot slip through.
const SWEEP = `window.__sweep=(sec)=>{const cv=document.getElementById('c'),r=cig.runner,t=document.createElement('canvas');t.width=39;t.height=84;const x=t.getContext('2d',{willReadFrequently:true});const bad=[];let n=0,fMax=0;
for(let i=0;i<sec*60;i++){if(r.pickT>0)r.pickPerk("kalin");if(i%23===0)r.laneChange(Math.random()<.5?-1:1);if(i%90===5)r.dive?.();cig.simEndless(1/60);if(r.state==='over')break;
if(i%10)continue;x.drawImage(cv,0,0,39,84);const d=x.getImageData(0,18,39,56).data,h=new Map();let m=0;for(let k=0;k<d.length;k+=4){const q=(d[k]>>4)<<8|(d[k+1]>>4)<<4|(d[k+2]>>4),c=(h.get(q)||0)+1;h.set(q,c);if(c>m)m=c}
n++;const f=m/(d.length/4);if(f>fMax)fMax=f;if(f>0.7){const img=bad.length<2?cv.toDataURL('image/jpeg',0.6):0,cul=[];if(!bad.length){const fr=()=>{x.drawImage(cv,0,0,39,84);const d=x.getImageData(0,18,39,56).data,h=new Map();let m=0;for(let k=0;k<d.length;k+=4){const q=(d[k]>>4)<<8|(d[k+1]>>4)<<4|(d[k+2]>>4),c=(h.get(q)||0)+1;h.set(q,c);if(c>m)m=c}return m/(d.length/4)};const walk=(o,pa)=>{for(const ch of o.children){const v=ch.visible;ch.visible=false;cig.simEndless(0);const f2=fr();ch.visible=v;if(f2<f-0.25){cul.push(pa+'/'+(ch.name||ch.type)+(ch.geometry?':'+ch.geometry.type:''));if(pa.split('/').length<4)walk(ch,pa+'/'+(ch.name||ch.type))}}};walk(r.ctx.scene,'')}bad.push({cul,cam:cig.camera.position.toArray().map(v=>+v.toFixed(1)),bp:r.ctx.ball.group.position.toArray().map(v=>+v.toFixed(1)),gr:r.grounded,img,i,f:+f.toFixed(2),st:r.state,s:Math.round(r.b.s),kind:r.track.pieceAt(r.b.s)?.kind,cause:r.cause,seed:r.seed})}}
return{n,bad:bad.slice(0,6),end:r.state,s:Math.round(r.b.s),fMax:+fMax.toFixed(2)}}`;
async function camSweep(ctx) {
  await load('?debug&endless&notut', seed3());
  await waitFor(`${dbgRush}`, 25000, 'rush playing');
  await ev(SWEEP);
  let frames = 0; const bad = [];
  for (let run = 0; run < +(process.env.SWEEP_RUNS || 3); run++) {
    const r = await ev(`window.__sweep(70)`);
    frames += r.n; for (const b of r.bad) { if (b.img) writeFileSync(join(SHOTS, `sweep_bad_${bad.length}.jpg`), Buffer.from(b.img.split(',')[1], 'base64')); delete b.img; bad.push(b); } if (process.env.VERBOSE) console.log('  sweep run', run, JSON.stringify(r));
    await ev(`cig.endless()`); await waitFor(`${dbgRush}`, 15000, 'rush playing again');
  }
  if (bad.length) ctx.fail(`flat-colour Rush frames (one colour > 70% of the middle): ${JSON.stringify(bad.slice(0, 4))}`);
  else ctx.pass(`Rush camera sweep: ${frames} rendered frames, none flat`);
}

// scenario 22: the new chapters. A hand-made one-chapter plan (the tour's own def of each id) is started, simmed to ~400 m, then the chapter is entered again so the name strip and the one-word label show.
// mech_<id>.png is shot when the mechanic is in view (train / laser / missile / mover / bridge / boulder; ay + turbo: the state is asserted).
const CH_NEW = [['ekspres', 'oncoming', /TRAIN/], ['ay', null, /MOON/], ['lazer', 'laser', /LASER/], ['kopru', 'icebridge', /COLLAPS/], ['fuze', 'missile', /MISSILE/], ['hareket', 'moving', /SLIDE/], ['heyelan', 'boulder', /ROCK/], ['turbo', null, /SPEED/]];
async function newChapters(ctx) {
  await load('?endless&notut&debug', seed3());
  await waitFor(dbgRush, 25000, 'rush playing');
  await ev(`(()=>{const r=cig.runner,D=window.__defs={};for(const [id] of ${JSON.stringify(CH_NEW)}){let g;for(let i=0;i<40&&!(g=r.chapters.segs.find((x)=>x.id===id));i++)r.chapters.at(r.chapters.segs[r.chapters.segs.length-1].s1+1);D[id]=g}})()`);
  for (const [id, kind, re] of CH_NEW) {
    await ev(`(()=>{const r=cig.runner,g=window.__defs['${id}'];
      const seg=Object.assign({},g,{n:7,s0:560,s1:1e9,i:0}),pl=Object.assign({},r.chapters.segs[0],{s0:0,s1:560});r.start(5,null,{chapterPlan:{segs:[pl,seg],at:(s)=>s>=560?seg:pl}});r.invulnT=1e9;r.yetiHoldT=99;r.track.features.junction=false;r.track.setHardness(3)})()`);      // (the chapter starts at 560 m (past the 500 m arch) like in a real run: plain slope before it; hardness 3: the 3.5 km difficulty from the first metres; no corners, the sim does not steer)
    await waitFor(dbgRush, 8000, 'rush restarted ' + id);
    await ev(`(()=>{const r=cig.runner;for(let i=0;i<60*90&&r.b.s<557&&r.state!=='over';i++){if(r.pickT>0){r.pickPerk('kalin');document.querySelectorAll('.perk-pick').forEach((e)=>e.remove())}r.invulnT=1e9;cig.simEndless(1/60)}})()`);
    await ev(`(()=>{const u=cig.runner.ctx.ui;for(const c of Object.values(u._chs||{})){c.q.length=0;c.cur=null;c.last=-1e9}if(u._heldQ)u._heldQ.length=0})()`);   // (a real chapter starts 350+ m into a run: the announcement lane is empty when it begins. The sim jumps there in milliseconds, so the run-start messages and the 500 m banner are still queued: empty the lane by hand just before the chapter or its name strip waits ~2.5 s behind them)
    await ev(`(()=>{const r=cig.runner;for(let i=0;i<60*90&&r.b.s<562&&r.state!=='over';i++){if(r.pickT>0){r.pickPerk('kalin');document.querySelectorAll('.perk-pick').forEach((e)=>e.remove())}r.invulnT=1e9;cig.simEndless(1/60)}})()`);
    await waitFor(`${re.toString()}.test(document.querySelector('.chap-pill.on')?.textContent||'')`, 4000, 'name pill ' + id).catch(() => {});      // (the name pill is a real-time message, queued behind the last one: wall time, not sim time)
    await sleep(100);   // (the name pill fades in)
    // the frame is named rush_ch_<id> only when the chapter's signature hazard is on screen (6-48 m ahead) while the name strip is up; otherwise it is saved as _unreached and the run FAILs
    const inView = `(()=>{const r=cig.runner,K=${JSON.stringify(kind)};if(K==='boulder')return r.obstacles.dyn.some((b)=>b.sLand-r.b.s>6&&b.sLand-r.b.s<30);if(!K)return true;if(K==='icebridge'&&r.track.pieces.some((p)=>p.kind==='iceBridge'&&p.s1>r.b.s&&p.s0<r.b.s+55))return true;for(const ob of r.obstacles.obs){const s=ob.cs!==undefined?ob.cs:ob.s;if(ob.kind===K&&ob.alive!==false&&s-r.b.s>6&&s-r.b.s<55)return true}return false})()`;
    let seen = false; for (let i = 0; i < 40 && !(seen = await ev(inView)) && await ev(`!!document.querySelector('.chap-pill.on')`); i++) await sleep(50);
    await ev('window.__raf&&(window.__raf.skip=true)'); await shot('rush_ch_' + id + (seen ? '' : '_unreached'), ctx); await ev('window.__raf&&(window.__raf.skip=false)');
    if (seen) ctx.pass(`chapter ${id}: ${kind || 'chapter state'} in view in rush_ch_${id}.png`); else ctx.fail(`chapter ${id}: ${kind} not on screen while the name strip was up (frame saved as rush_ch_${id}_unreached.png)`);
    const w = await ev(`(document.querySelector('.chap-pill')?.textContent||'').replace(/\s+/g,' ')`);
    if (process.env.VERBOSE) console.log('  s22 ' + id + ' pieces ' + await ev(`cig.runner.track.pieces.filter(p=>p.s1>510&&p.s0<670).map(p=>p.kind+':'+Math.round(p.s0)+'-'+Math.round(p.s1)).join(' ')`) + ' | obs ' + await ev(`cig.runner.obstacles.obs.filter(o=>(o.cs??o.s)>550&&(o.cs??o.s)<670).map(o=>o.kind+'@'+Math.round(o.cs??o.s)).join(' ')`));
    if (kind && kind !== 'boulder' && kind !== 'icebridge') {   // the chapter's signature hazard must land within 40 m of the chapter start (560 m), the banner and the hazard arrive together
      const f = await ev(`(()=>{let m=1e9;for(const ob of cig.runner.obstacles.obs){const x=ob.s;if(ob.kind===${JSON.stringify(kind)}&&x>=548&&x<m)m=x}return m<1e9?Math.round(m-560):-1})()`);
      if (f >= 6 && f <= 100) ctx.pass(`chapter ${id}: first ${kind} ${f} m after the chapter start`); else ctx.fail(`chapter ${id}: first ${kind} ${f < 0 ? 'not spawned' : f + ' m'} after the chapter start (want 6-100 m: in view under the name strip)`);
    }
    const hunt = await ev(`(()=>{const r=cig.runner,o=r.obstacles,K=${JSON.stringify(kind)};r.invulnT=1e9;r.yetiHoldT=99;let ds=null;
      for(let i=0;i<60*70&&r.state!=='over';i++){if(r.pickT>0){const c=document.getElementById('perk-cards').firstElementChild;if(c)c.click();else r.pickPerk('kalin');document.getElementById('perks').classList.add('hidden')}r.invulnT=1e9;cig.simEndless(1/60);if(r.b.s<530)continue;
        if(K==='boulder'){if(o.dyn.length){ds=1;break}}else if(K){for(const ob of o.obs){const s=ob.cs!==undefined?ob.cs:ob.s;if(ob.kind===K&&ob.alive!==false&&s-r.b.s>14&&s-r.b.s<46){ds=Math.round(s-r.b.s);break}}if(ds!==null)break}else if(i>60*14)break}
      const h={};for(const ob of o.obs)h[ob.kind]=(h[ob.kind]||0)+1;return{ds,cause:r.cause,s:Math.round(r.b.s),chap:r.chap&&r.chap.id,lowG:r.lowG,spd:r.chapSpd,t:+r.time.toFixed(1),st:r.state,h:JSON.stringify(h)}})()`);
    await ev("document.getElementById('perks').style.display='none'"); await ev('window.__raf&&(window.__raf.skip=true)'); await shot('mech_' + id, ctx); await ev('window.__raf&&(window.__raf.skip=false)');
    if (id === 'lazer') {      // death past 300 m: the chapter summary strip over the dying frame must sit slim under the HUD, clear of the ball and the vanishing point (rush_recap.png, asserted like every Rush frame)
      await ev(`(()=>{const r=cig.runner;r.invulnT=0;r.die('wall')})()`); await sleep(120); await ev(`(()=>{const r=cig.runner;r._skipRecap=false;r.rcp=[{s:r.b.s*0.4,k:'combo',n:5}];r.showRecap(()=>{})})()`); await sleep(350); await ev('window.__raf&&(window.__raf.skip=true)'); await shot('rush_recap', ctx); await ev('window.__raf&&(window.__raf.skip=false)');
      if (!(await ev(`!!document.querySelector('.rcp')`))) ctx.warn('rush_recap.png: no chapter summary strip on screen (death did not reach the recap)');
    }
    if (id === 'ekspres' && hunt.ds !== null) {      // close-up: the train judged in motion, 3-9 m in front of the ball (train_close.png)
      const near = await ev(`(()=>{const r=cig.runner,o=r.obstacles;r.invulnT=1e9;r.yetiHoldT=99;for(let i=0;i<60*8&&r.state!=='over';i++){r.invulnT=1e9;cig.simEndless(1/60);for(const ob of o.obs){const s=ob.cs!==undefined?ob.cs:ob.s;if(ob.kind==='oncoming'&&ob.alive!==false&&s-r.b.s>3&&s-r.b.s<9)return Math.round(s-r.b.s)}}return null})()`);
      await ev('window.__raf&&(window.__raf.skip=true)'); await shot('train_close', ctx); await ev('window.__raf&&(window.__raf.skip=false)');
      if (near !== null) ctx.pass(`train close-up shot (train ${near} m ahead): train_close.png`); else ctx.fail('train close-up: no train came within 9 m');
    }
    const okMech = hunt.chap === id && (kind ? hunt.ds !== null : id === 'ay' ? hunt.lowG === true : hunt.spd > 1);
    if (okMech) ctx.pass(`chapter ${id}: mechanic in view ${JSON.stringify(hunt)}`); else ctx.fail(`chapter ${id}: mechanic never seen ${JSON.stringify(hunt)}`);
    if (re.test(w)) ctx.pass(`chapter ${id}: one-word label on the chapter pill ("${w.slice(0, 60)}")`); else ctx.fail(`chapter ${id}: label ${re} missing in "${w.slice(0, 80)}"`);
  }
}

// scenario 24: no stray text on the menu. Visible text outside the menu card / panels (toast, hint, float, banner, HUD, level-up overlay) is scanned after every bottom-nav panel and after a Rush death -> MENU.
const STRAY = `(()=>{const out=[];const vis=(e)=>{const b=e.getBoundingClientRect();if(b.width<2||b.height<2)return false;const cs=getComputedStyle(e);return cs.visibility!=='hidden'&&cs.display!=='none'&&+cs.opacity>0.05};
  for(const sel of ['#toast-soft','#hint','#floats','#banner','#subtitle','#tutor','#stomp','#cig-banner','#buff-fly','#hud','#result']){for(const e of document.querySelectorAll(sel)){if(!vis(e))continue;const own=[...e.querySelectorAll('*')].filter((c)=>c.children.length===0&&(c.textContent||'').trim()&&vis(c)&&c.getBoundingClientRect().bottom>0).map((c)=>c.textContent.trim());if(own.length||sel.startsWith('.fm'))out.push(sel+':'+own.join('|').slice(0,60))}}
  return out})()`;
async function menuClean(ctx) {
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await load('?debug', seedOf(save({ wheel: { seen: 1, day } })), { waitBoot: false });
  for (let i = 0; !(await ev(MENU_UP)); i++) { if (i > 800) throw new Error('timeout menu first appears'); await sleep(25); }
  const settle = async () => { for (let i = 0; i < 4; i++) { if (await ev(`!!${FIND('.fm-play')}`)) return; await key('Escape'); await sleep(350); } };
  await waitFor(MENU_SETTLED, 12000, 'menu settled').catch(() => {}); await settle(); await sleep(3500);      // (the first-steps toast removes itself after ~2.7 s)
  const say = (m) => { if (process.env.VERBOSE) console.log('  s24 ' + m + ' @' + (now() / 1000).toFixed(1)); };
  const claim = async () => { for (let i = 0; i < 4 && (await ev(`!!document.querySelector('.fm-lvup .fm-btn')`)); i++) { await tapSel('.fm-lvup .fm-btn', null, 2000).catch(() => {}); await sleep(400); } };      // (the level-up reward is a modal on the menu: it must close with its CLAIM button)
  const bad = [], scan = async (what) => { say(what); await sleep(250); const s = await ev(STRAY); if (s.length) bad.push(what + ' -> ' + s.join(' ; ')); };
  await scan('menu'); await claim();
  const labels = await ev(`[...document.querySelectorAll('.fm-secrow .fm-sb')].map(b=>b.getAttribute('aria-label')||b.textContent.trim())`);
  for (const lb of labels) {
    try {
      await tapSel('.fm-secrow .fm-sb', new RegExp(reEsc(lb)), 3000); await sleep(350); await key('Escape');
      await waitFor(`!!${FIND('.fm-secrow .fm-sb')} && !document.querySelector('.fm-ov')`, 6000, 'closes'); await scan('after panel "' + lb + '"');
    } catch (e) { await key('Escape'); await sleep(300); }
  }
  for (let round = 0; round < 2; round++) {      // Rush -> forced death -> result -> MENU: the result must stay tappable (no level-up overlay on top) and nothing may be left on the menu
    await claim(); say('round ' + round + ' start'); await ev('cig.endless()'); await waitFor(dbgRush, 20000, 'rush playing'); await sleep(2500); say('playing');
    await ev("cig.runner.die('wall')"); await waitFor(RESULT_UP, 8000, 'result'); await sleep(2200); say('result');
    const cover = await ev(`(()=>{const b=document.querySelector('#btn-menu');if(!b)return 'no #btn-menu';const r=b.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return h&&(h===b||b.contains(h))?'':'covered by '+(h&&h.className)})()`);
    if (cover) bad.push('round ' + round + ': result MENU button ' + cover);
    await tapSel('#btn-menu', null, 4000).catch(() => {}); await waitFor(MENU_UP, 8000, 'menu back').catch(() => {}); await sleep(3500);
    await claim(); await scan('after run ' + round);
    for (let i = 0; i < 3 && (await ev(`!!document.querySelector('.fm-ov,.fm-boxov')`)); i++) { await key('Escape'); await sleep(350); }
  }
  if (bad.length) ctx.fail('stray text on the menu: ' + bad.join(' | ').slice(0, 400)); else ctx.pass(`no stray toast / hint / float / banner / HUD text on the menu after ${labels.length} panels and 2 Rush deaths`);
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
// scenario 25: AI UI icons (public/ui/*.webp). Menu logo + mode / currency icons are already in s3_menu.png; here: Rush HUD with buffs + coin chip (icons_rush_buff.png), the perk pick cards (icons_perk.png),
// the cig HUD with a power chip (icons_cig.png). Asserts that the images are really decoded (naturalWidth > 0), i.e. emoji is not what is on screen.
async function uiIcons(ctx) {
  await load('?endless&notut&debug', seed3());
  await waitFor(`${rushPlay}&&(${hudDist})>=0`, 30000, 'rush playing');
  await ev(`(()=>{const r=cig.runner,u=r.ctx.ui;r.invulnT=999;r.yetiHoldT=99;u.buffAdd('magnet','🧲','MIKNATIS',20);u.buffAdd('shield','🛡️','KALKAN',25);u.runnerPerkIcon('🧊','Donma');})()`);
  await sleep(1500); await shot('icons_rush_buff', ctx);
  await ev(`cig.runner.ctx.ui.runnerPerkPick([{id:'miknatis',icon:'🧲',name:'Mıknatıs',desc:'Kar taneleri sana akar'},{id:'kabuk',icon:'🛡️',name:'Kabuk',desc:'Bir çarpışmayı affeder'},{id:'donma',icon:'🧊',name:'Donma',desc:'Erime durur'}],()=>{},30)`);
  await sleep(700); await shot('icons_perk', ctx);
  const r = await ev(`(()=>{const q=[...document.querySelectorAll('.buff .uim,.perk-card .uim,.perk-ico .uim,.hud-coins .uim')],n=q.length;const ok=q.filter(i=>i.complete&&i.naturalWidth>0).length;return{n,ok}})()`);
  if (r.n >= 6 && r.ok === r.n) ctx.pass(`rush icons decoded: ${r.ok}/${r.n} images (buffs, perk cards, coin chip)`); else ctx.fail(`rush icons: ${JSON.stringify(r)}`);
  await load('?debug&auto&cig=1', seedOf(save()));
  await waitFor(`window.cig&&cig.G.mode==='cig'&&cig.G.state==='play'`, 25000, 'mountain playing');
  await ev(`cig.plus&&cig.plus._buffOn&&cig.plus._buffOn('magnet')`);
  await sleep(1200); await shot('icons_cig', ctx);
  const c = await ev(`[...document.querySelectorAll('.uim')].filter(i=>i.complete&&i.naturalWidth>0&&i.getBoundingClientRect().width>0).length`);
  if (c >= 1) ctx.pass(`cig HUD icon decoded (${c} image(s) on screen)`); else ctx.fail('cig HUD: no decoded icon image on screen');
}

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

  const args = [`--remote-debugging-port=${cport}`, `--user-data-dir=${PROFILE}`, '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy', '--disable-software-rasterizer', '--num-raster-threads=2', '--mute-audio',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-features=Translate,MediaRouter', '--renderer-process-limit=1',
    '--js-flags=--max-old-space-size=512', '--no-first-run', '--no-default-browser-check', '--disable-component-update', '--disable-default-apps', '--hide-scrollbars', '--window-size=390,844', 'about:blank'];
  const ch = spawn(CHROME, args, { stdio: 'ignore' });
  procs.push({ name: 'chrome', pid: ch.pid });
  // keep the desktop responsive: test processes yield CPU to the user (children inherit the class)
  for (const p of [process.pid, vite.pid, ch.pid]) { try { setPriority(p, osc.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted */ } }
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
  await scenario(4, 'rush 1-minute playtest', 115000, rushPlaytest);
  await scenario(24, 'menu: no stray text after panels / a run', 90000, menuClean);
  await scenario(22, 'new Rush chapters + mechanics (rush_ch_*, mech_*)', 120000, newChapters);
  await scenario(19, 'model gallery (Blender critters + props)', 30000, gallery);
  await scenario(20, 'chapter sky backdrops', 45000, skies);
  await scenario(18, 'rush HUD states (cannon bar, flag, toast)', 30000, hudStates);
  await scenario(12, 'frame pacing (Rush)', 30000, s12);
  await scenario(13, 'first-run frames 0.5/2/5/10 s', 30000, firstFrames);
  await scenario(14, 'cig mountain 1 frames', 60000, (c) => cigFrames(c, 1));
  await scenario(15, 'cig mountain 12 frames', 60000, (c) => cigFrames(c, 12));
  await scenario(17, 'mountain result card (star 3 missed)', 30000, resultLayouts);
  await scenario(5, 'cig mountains 1/33/37', 30000, async (c) => { for (const n of [1, 33, 37]) await mountain(c, n, 3); });
  await scenario(6, 'cig endless + daily', 30000, endlessDaily);
  await scenario(7, 'arena solo', 30000, arena);
  await scenario(8, 'english leak scan', 45000, leaks);
  await scenario(9, 'fullscreen', 30000, fullscreen);
  await scenario(11, 'soak', 40000, soak);
  await scenario(16, 'debug overlay stats', 30000, debugStats);
  await scenario(21, 'rush camera sweep (flat frames)', 90000, camSweep);
  await scenario(25, 'AI UI icons (buffs, perk cards, cig HUD)', 45000, uiIcons);
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
  if (READ_LOG.length) { const g = {}; for (const r of READ_LOG) { const k = r.name.replace(/_?d+$/, ''); if (!g[k] || r.pct > g[k].pct) g[k] = r; } console.log(`ball cover (worst per frame group, ${READ_LOG.length} frames): ` + Object.entries(g).map(([k, r]) => `${k} ${r.pct}% (${r.name}, dom ${r.dom} 3D ${r.mesh}${r.by ? ' ' + r.by : ''}, horizon ${Math.round(r.hf * 100)}%)`).join('; ')); }
  console.log(`renderer: ${renderer}`);
  console.log(`peak browser memory (sum of process working sets): ${peakMem} MB; peak JS heap ${peakHeap.toFixed(0)} MB`);
  console.log(`wall time: ${((Date.now() - T0) / 1000).toFixed(0)} s`);
  if (externals.size) console.log(`blocked external hosts (never contacted): ${[...externals].join(', ')}`);
  console.log(`screenshots: ${SHOTS}`);
  try { writeFileSync(join(SHOTS, '_manifest.json'), JSON.stringify({ at: new Date().toISOString(), frames, results: lines.filter((l) => !l.startsWith('PASS')) }, null, 1)); } catch { /* shots dir gone */ }
  killAll(); dropLock();
  process.exit(code || (fails ? 1 : 0));
}

run();
