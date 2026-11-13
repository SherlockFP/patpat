// KARTOPU ARENA - serverless room discovery (presence). Everybody who opens the online menu joins one well-known Trystero
// room; hosts of PUBLIC rooms broadcast a tiny description every 2 s, browsers collect them and drop stale ones.
// Loaded lazily (dynamic import) - never touched by single player. The actual game still runs over PeerJS (net.js).
import { vPresence } from './validate.js';
export const LOBBY_ROOM = 'patpat-arena-lobby-v1';
const APP_ID = 'patpat-arena-presence';
const STALE_MS = 6000, BEAT_MS = 2000, MAX_ROOMS = 40, MAX_PER_PEER = 2; // caps: a flooding peer cannot grow the list without bound

export class Presence {
  /** onChange(): called whenever the room list / online count changes */
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.rooms = new Map(); // code -> { code, name, host, n, max, map, v, ts, peer }
    this.online = 1;
    this.ok = false;
    this.failed = false;
    this.hostFn = null;
    this.room = null;
    this.act = null;
    this.timer = 0;
    this.dead = false;
  }

  async start() {
    if (this.room || this.dead) return this.ok;
    try {
      const m = await import('trystero');
      if (this.dead) return false;
      const joinRoom = m.joinRoom || (m.default && m.default.joinRoom);
      this.room = joinRoom({ appId: APP_ID }, LOBBY_ROOM);
      this.act = this.room.makeAction('rooms');
      this.act.onMessage = (d, meta) => this._onMsg(d, meta && meta.peerId);
      this.room.onPeerJoin = (id) => { this._count(); this._beat(id); };
      this.room.onPeerLeave = (id) => {
        for (const [k, r] of this.rooms) if (r.peer === id) this.rooms.delete(k);
        this._count();
      };
      this.ok = true;
      this.timer = setInterval(() => { this._beat(); this._sweep(); }, BEAT_MS);
      return true;
    } catch (e) {
      this.failed = true;
      this.ok = false;
      this.onChange();
      return false;
    }
  }

  _count() {
    let n = 1;
    try { n = Object.keys(this.room.getPeers()).length + 1; } catch { /* ignore */ }
    this.online = n;
    this.onChange();
  }

  _onMsg(d, peer) {
    const r = vPresence(d);
    if (!r) return;
    const old = this.rooms.get(r.code);
    if (old && old.peer !== peer) return; // first announcer owns a code: nobody else can overwrite or delete it
    if (r.gone) { if (old) { this.rooms.delete(r.code); this.onChange(); } return; }
    if (!old) {
      if (this.rooms.size >= MAX_ROOMS) return;
      let own = 0; for (const x of this.rooms.values()) if (x.peer === peer) own++;
      if (own >= MAX_PER_PEER) return;
    }
    this.rooms.set(r.code, { code: r.code, name: r.name, host: r.host, n: r.n, max: r.max, map: 0, v: r.v, ts: Date.now(), peer });
    this.onChange();
  }

  _sweep() {
    const now = Date.now();
    let ch = false;
    for (const [k, r] of this.rooms) if (now - r.ts > STALE_MS) { this.rooms.delete(k); ch = true; }
    if (ch) this.onChange();
  }

  _beat(target) {
    if (!this.act || !this.hostFn) return;
    const info = this.hostFn();
    if (!info) return;
    try { this.act.send(info, target ? { target } : undefined); } catch { /* ignore */ }
  }

  /** become a public host: fn() returns the room description (or null to stay quiet) */
  announce(fn) { this.hostFn = fn; this._beat(); }

  /** open rooms, fullest-non-full first */
  list(version) {
    const now = Date.now();
    const a = [];
    for (const r of this.rooms.values()) if (now - r.ts <= STALE_MS && (version == null || r.v === version)) a.push(r);
    a.sort((x, y) => (x.n >= x.max) - (y.n >= y.max) || y.n - x.n || y.ts - x.ts);
    return a;
  }

  stop() {
    if (this.dead) return;
    this.dead = true;
    clearInterval(this.timer);
    if (this.hostFn && this.act) { const i = this.hostFn(); if (i) { try { this.act.send({ code: i.code, gone: 1 }); } catch { /* ignore */ } } }
    this.hostFn = null;
    const r = this.room;
    setTimeout(() => { try { r && r.leave(); } catch { /* ignore */ } }, 200);
  }
}
