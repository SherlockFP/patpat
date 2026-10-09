// PARKUR leaderboard - works on static hosting (GitHub Pages), no backend.
//
// 1) Local: every board (one per daily seed 'd20261009', plus 'endless') is cached in localStorage.
// 2) Online "gossip": while the PARKUR menu / a run is open we join one well-known Trystero room (the same
//    serverless P2P stack the arena lobby uses). Every peer sends its cached top entries to anyone who joins and
//    re-broadcasts now and then; receivers validate + merge (best entry per player id) and cache them. So boards
//    fill themselves as players meet - also with scores of players who are offline now (relayed by others).
//    Limits: only players who were online at overlapping times ever exchange data, and entries are not verified
//    (a modified client can lie). Plausibility checks below drop obvious junk.
//
// TODO(backend): for an authoritative global board, replace gossip() with a tiny serverless KV
// (e.g. a free Cloudflare Worker + KV or Deno Deploy KV: POST {id,name,v,seed} -> keep best per id, GET top 50)
// and keep this cache as the offline fallback. No external service / credentials are used today.

const KEY = 'patpat.parkur.lb.v1';
const ID_KEY = 'patpat.parkur.uid';
const NICK_KEY = 'patpat.agar.nick'; // shared with KARTOPU ARENA
const APP_ID = 'patpat-parkur-board';
const ROOM = 'patpat-parkur-lb-v1';
const KEEP = 40;          // entries kept per board
const SEND = 25;          // entries sent per board per message
const BEAT_MS = 25000;

const clean = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, n);
export const lowerIsBetter = (key) => key[0] === 'd';

export function myId() {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id || !/^[a-z0-9]{6,16}$/.test(id)) { id = Math.random().toString(36).slice(2, 12).padEnd(8, '0'); localStorage.setItem(ID_KEY, id); }
    return id;
  } catch { return 'local0000'; }
}
export function myName() {
  try { const n = clean(localStorage.getItem(NICK_KEY), 12); if (n) return n; } catch { /* ignore */ }
  return 'Yeti' + myId().slice(0, 3).toUpperCase();
}
export function setMyName(n) {
  n = clean(n, 12);
  try { if (n) localStorage.setItem(NICK_KEY, n); } catch { /* ignore */ }
  return n || myName();
}

/** plausibility: daily time in ms (a ~650 m course cannot be run under ~35 s), endless distance in m */
function valid(key, e) {
  if (!e || typeof e !== 'object') return false;
  if (typeof e.id !== 'string' || !/^[a-z0-9]{6,16}$/.test(e.id)) return false;
  if (!Number.isFinite(e.v)) return false;
  if (lowerIsBetter(key)) return e.v >= 35000 && e.v <= 3600000;
  return e.v > 0 && e.v <= 200000;
}

export class Board {
  constructor() {
    this.data = {};
    this.onChange = null;
    this.online = 0;           // peers in the room (0 = not connected)
    this.status = 'off';       // off | connecting | on | failed
    this.room = null; this.act = null; this.timer = 0; this.dead = false; this.keys = new Set(['endless']);
    try { const raw = JSON.parse(localStorage.getItem(KEY) || '{}'); if (raw && typeof raw === 'object') this.data = raw; } catch { this.data = {}; }
    // drop dailies older than ~10 days and sanitise
    const today = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    for (const k of Object.keys(this.data)) {
      if (!Array.isArray(this.data[k]) || (k !== 'endless' && !/^d\d{8}$/.test(k))) { delete this.data[k]; continue; }
      if (k[0] === 'd' && today - Number(k.slice(1)) > 10 && today - Number(k.slice(1)) < 9000) { delete this.data[k]; continue; }
      this.data[k] = this.data[k].filter((e) => valid(k, e));
    }
  }

  _persist() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }
  _sort(key) {
    const a = this.data[key] || [];
    a.sort(lowerIsBetter(key) ? (x, y) => x.v - y.v || x.ts - y.ts : (x, y) => y.v - x.v || x.ts - y.ts);
    if (a.length > KEEP) { const me = myId(); const mine = a.find((e) => e.id === me); a.length = KEEP; if (mine && !a.includes(mine)) a[KEEP - 1] = mine; }
    this.data[key] = a;
  }

  /** merge entries (best per player id); returns true when something changed */
  merge(key, list) {
    if (!/^(endless|d\d{8})$/.test(key) || !Array.isArray(list)) return false;
    const a = this.data[key] || (this.data[key] = []);
    const low = lowerIsBetter(key);
    let ch = false;
    for (const raw of list.slice(0, 60)) {
      const e = { id: raw && raw.id, name: clean(raw && raw.name, 12) || 'Yeti', v: Math.round(Number(raw && raw.v)), ts: Number(raw && raw.ts) || Date.now() };
      if (!valid(key, e)) continue;
      const i = a.findIndex((x) => x.id === e.id);
      if (i < 0) { a.push(e); ch = true; }
      else if (low ? e.v < a[i].v : e.v > a[i].v) { a[i] = e; ch = true; }
      else if (e.v === a[i].v && e.name !== a[i].name && e.ts > a[i].ts) { a[i].name = e.name; ch = true; }
    }
    if (ch) { this._sort(key); this._persist(); }
    return ch;
  }

  /** record my own result; returns { best, rank, improved } */
  submit(key, v) {
    const id = myId();
    const prev = (this.data[key] || []).find((e) => e.id === id);
    const improved = this.merge(key, [{ id, name: myName(), v, ts: Date.now() }]);
    this.keys.add(key);
    if (improved) this._send(key);
    const best = (this.data[key] || []).find((e) => e.id === id);
    return { best: best ? best.v : v, rank: this.rank(key), improved: improved && (!prev || prev.v !== (best && best.v)) };
  }

  top(key, n = 10) { return (this.data[key] || []).slice(0, n); }
  rank(key) { const i = (this.data[key] || []).findIndex((e) => e.id === myId()); return i < 0 ? 0 : i + 1; }
  mine(key) { return (this.data[key] || []).find((e) => e.id === myId()) || null; }
  watch(key) { this.keys.add(key); }

  // ------------------------------------------------------------- online gossip (Trystero)
  async connect() {
    if (this.room || this.dead || this.status === 'connecting') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.status = 'failed'; return; }
    this.status = 'connecting';
    try {
      const m = await import('trystero');
      if (this.dead) return;
      const joinRoom = m.joinRoom || (m.default && m.default.joinRoom);
      this.room = joinRoom({ appId: APP_ID }, ROOM);
      this.act = this.room.makeAction('lb');
      this.act.onMessage = (d) => this._recv(d);
      this.room.onPeerJoin = (peer) => { this._count(); for (const k of this.keys) this._send(k, peer); };
      this.room.onPeerLeave = () => this._count();
      this.status = 'on';
      this.timer = setInterval(() => { for (const k of this.keys) this._send(k); }, BEAT_MS);
      this._fire();
    } catch (e) {
      this.status = 'failed';
      this._fire();
    }
  }
  _count() { try { this.online = Object.keys(this.room.getPeers()).length; } catch { this.online = 0; } this._fire(); }
  _fire() { try { this.onChange && this.onChange(); } catch { /* ignore */ } }
  _send(key, peer) {
    if (!this.act || !this.data[key] || !this.data[key].length) return;
    if (!peer && !this.online) return;
    const e = this.data[key].slice(0, SEND).map((x) => ({ id: x.id, name: x.name, v: x.v, ts: x.ts }));
    try { this.act.send({ k: key, e }, peer ? { target: peer } : undefined); } catch { /* ignore */ }
  }
  _recv(d) {
    if (!d || typeof d !== 'object' || typeof d.k !== 'string') return;
    // only today's / yesterday's daily boards and the endless board are accepted from peers
    if (d.k !== 'endless') {
      const now = new Date(), y = new Date(now.getTime() - 86400000);
      const ok = [now, y].map((t) => 'd' + (t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate()));
      if (!ok.includes(d.k)) return;
    }
    if (this.merge(d.k, d.e)) this._fire();
  }

  stop() {
    this.dead = true;
    clearInterval(this.timer);
    const r = this.room;
    this.room = null; this.act = null; this.status = 'off'; this.online = 0;
    setTimeout(() => { try { r && r.leave(); } catch { /* ignore */ } }, 100);
  }
}
