// KARTOPU ARENA - pure validators for everything that arrives from the network (no imports, no DOM, runs under node).
// Rule: a peer is never trusted. Every number must be finite and in range, every array is length-capped, every string is
// stripped / length-capped, and nothing from here is ever meant for innerHTML (the UI uses textContent only).
// vSnap / vStart / vClientMsg sanitise IN PLACE (the object is a fresh deserialised message) and return true/false.
export const LIM = { R: 1100, CAP: 260, NOWN: 52, FOOD: 24000, SPARE: 800, NVIR: 90, NPUP: 40, NFORT: 3, MAXM: 60000, NPUPT: 5, MAXH: 8 };
const FT = LIM.FOOD + LIM.SPARE;
const W = LIM.R + 60; // world coordinate bound

// quick chat: the only text a player can send (client sends the index, the host looks the phrase up)
export const QUICK_CHAT = ['Selam!', 'GG', 'Kaç!', 'Takım?', 'İyi oyun!', 'Şans!', 'Vay be!', 'Yardım!'];

const isI = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isN = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi; // NaN / Infinity / non-numbers fail
const isA = (a, max) => Array.isArray(a) && a.length <= max;
const nums = (a, len, lo, hi) => { if (!Array.isArray(a) || a.length !== len) return false; for (let i = 0; i < len; i++) if (!isN(a[i], lo, hi)) return false; return true; };

// ---- strings
const STRIP = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff<>&"`\\\\]', 'g'); // control, bidi / zero-width, markup
// strong words match anywhere in the letters-only form (catches f_u_c_k); the rest only as a whole token (avoids "Dilara Pelin" -> rape, "Mina" -> amina)
const STRONG = ['orospu', 'siktir', 'yarrak', 'sikerim', 'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'pussy', 'faggot'];
const EXACT = new Set(['amk', 'aq', 'mk', 'pic', 'piç', 'sik', 'sikik', 'göt', 'got', 'oç', 'oc', 'bok', 'dick', 'cock', 'sex', 'sg', 'amcik', 'amcık', 'amina', 'amına', 'anani', 'ananı', 'yarak', 'nazi', 'hitler', 'rape', 'porn', 'cunt']);
const norm = (s) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/[^a-zçğıöşü0-9]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's');
function isBad(t) {
  const j = norm(t);
  for (const w of STRONG) if (j.includes(w)) return true;
  for (const tok of t.split(/[\s_.-]+/)) if (EXACT.has(norm(tok))) return true;
  return false;
}
/** display text: control / markup / bidi characters removed, whitespace collapsed, capped by code points, profanity masked */
export function cleanText(s, max, fb) {
  let t = typeof s === 'string' ? s.slice(0, max * 4) : '';
  try { t = t.normalize('NFC'); } catch { /* ignore */ }
  t = t.replace(STRIP, ' ').replace(/\s+/g, ' ').trim();
  t = Array.from(t).slice(0, max).join('');
  if (!t) return fb === undefined ? '' : fb;
  return isBad(t) ? '*'.repeat(Math.min(t.length, 6)) : t;
}
export const cleanName = (s, fb) => cleanText(s, 12, fb === undefined ? 'Yeti' : fb);
const ID = /^[A-Za-z0-9_-]{1,24}$/;
const cleanId = (s) => (typeof s === 'string' && ID.test(s) ? s : 'classic');
export const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;

// ---- host side: first message of a connection
export function vHello(d, version) {
  if (!d || typeof d !== 'object' || d.t !== 'hello') return null;
  return { v: isI(d.v, 0, 1000) ? d.v : -1, nick: cleanName(d.nick), sk: cleanId(d.sk), tr: cleanId(d.tr), ok: d.v === version };
}

// ---- host side: input of a client. Returns a fresh normalised message or null.
export function vHostMsg(d) {
  if (!d || typeof d !== 'object') return null;
  switch (d.t) {
    case 'i': {
      let x = d.x, z = d.z, m = d.m;
      if (!isN(x, -50, 50) || !isN(z, -50, 50) || !isN(m, -50, 50)) return null;
      const l = Math.hypot(x, z); // direction is a unit vector, strength 0..1: a client can never steer faster than a normal one
      if (l > 1) { x /= l; z /= l; }
      return { t: 'i', x, z, m: m < 0 ? 0 : m > 1 ? 1 : m };
    }
    case 'b': case 's': case 'e': case 'respawn': return { t: d.t };
    case 'chat': return isI(d.q, 0, QUICK_CHAT.length - 1) ? { t: 'chat', x: QUICK_CHAT[d.q] } : null;
    default: return null;
  }
}

// ---- client side: messages of the host
function vSnap(m) {
  const L = LIM;
  if (!isI(m.hn, 0, L.NOWN) || !isI(m.pn, 0, L.NOWN)) return false;
  if (!(m.bs === 0 || (Array.isArray(m.bs) && m.bs.length === 3 && isI(m.bs[0], 0, L.NOWN - 1) && isN(m.bs[1], -1e7, 1e7) && isN(m.bs[2], -1e7, 1e7)))) return false;
  if (!(m.du === 0 || (Array.isArray(m.du) && m.du.length === 7 && isI(m.du[0], 0, L.NOWN - 1) && isI(m.du[1], 0, L.NOWN - 1) && isN(m.du[2], -W, W) && isN(m.du[3], -W, W) && isN(m.du[4], -3 * W, 3 * W) && isN(m.du[5], -1e3, 1e3) && isN(m.du[6], -1e3, 1e3)))) return false;
  if (!nums(m.wo, 2, -1e4, 1e4) || !isI(m.wo[0], 0, 4)) return false;
  if (!nums(m.pr, 3, -W, W) || !isI(m.pr[0], 0, 4)) return false;
  if (!nums(m.st, 3, -W, W) || !isI(m.st[0], 0, 1)) return false;
  if (!nums(m.zn, 6, -3 * W, 3 * W) || !isI(m.zn[0], 0, 4)) return false;
  if (!Array.isArray(m.fk) || m.fk.length !== L.NFORT * 2) return false;
  for (let i = 0; i < L.NFORT; i++) if (!isI(m.fk[i * 2], -1, L.NOWN - 1) || !isN(m.fk[i * 2 + 1], -1e4, 1e4)) return false;
  if (!isA(m.hd, L.NOWN)) return false;
  for (let i = 0; i < m.hd.length; i++) if (!isI(m.hd[i], 0, L.NOWN - 1)) return false;
  const c = m.c;
  if (!isA(c, L.CAP * 5) || c.length % 5) return false;
  for (let k = 0; k < c.length; k += 5) if (!isI(c[k], 0, L.CAP - 1) || !isI(c[k + 1], 0, L.NOWN - 1) || !isN(c[k + 2], -W, W) || !isN(c[k + 3], -W, W) || !isN(c[k + 4], 0, L.MAXM)) return false;
  const fd = m.fd;
  if (!isA(fd, FT * 5) || fd.length % 5) return false;
  for (let k = 0; k < fd.length; k += 5) if (!isI(fd[k], 0, FT - 1) || !isN(fd[k + 1], -W * 10, W * 10) || !isN(fd[k + 2], -W * 10, W * 10) || !isN(fd[k + 3], 0, 1e3) || !isI(fd[k + 4], 0, 0xffffff)) return false;
  if (!nums(m.v, L.NVIR * 2, -1e6, 1e6)) return false;
  if (!Array.isArray(m.p) || m.p.length !== L.NPUP * 3) return false;
  for (let i = 0; i < L.NPUP; i++) if (!isN(m.p[i * 3], -1e6, 1e6) || !isN(m.p[i * 3 + 1], -1e6, 1e6) || !isI(m.p[i * 3 + 2], 0, L.NPUPT - 1)) return false;
  if (!isA(m.pd, 8192)) return false;
  for (let i = 0; i < m.pd.length; i++) if (!isI(m.pd[i], 0, 1e6)) return false;
  return nums(m.me, 7, -1e9, 1e9);
}

export function vStart(m) {
  const L = LIM;
  if (!isI(m.me, 0, L.NOWN - 1) || !isN(m.seed, -2147483648, 2147483647)) return false;
  if (!Array.isArray(m.owners) || m.owners.length !== L.NOWN) return false;
  for (let i = 0; i < L.NOWN; i++) {
    const d = m.owners[i];
    if (!Array.isArray(d) || d.length < 5 || !isI(d[1], 0, 0xffffff)) return false;
    d[0] = cleanName(d[0], 'Yeti'); d[2] = d[2] ? 1 : 0; d[3] = cleanId(d[3]); d[4] = cleanId(d[4]);
  }
  if (!Array.isArray(m.food) || m.food.length !== L.FOOD * 2) return false;
  for (let i = 0; i < m.food.length; i++) if (!isN(m.food[i], -W * 10, W * 10)) return false;
  if (!isA(m.fc, L.FOOD)) return false;
  for (let i = 0; i < m.fc.length; i++) if (!isI(m.fc[i], 0, 0xffffff)) return false;
  if (!isA(m.pd, 8192)) return false;
  for (let i = 0; i < m.pd.length; i++) if (!isI(m.pd[i], 0, 1e6)) return false;
  return true;
}

/** st: { started } - the start message is accepted once, the lobby list only before it */
export function vClientMsg(d, st) {
  if (!d || typeof d !== 'object' || typeof d.t !== 'string') return false;
  switch (d.t) {
    case 'lobby':
      if (!isA(d.list, LIM.MAXH)) return false;
      d.list = d.list.map((n) => cleanName(n)); return true;
    case 'full': case 'ver': case 'closed': return true;
    case 'start': return !st.started && vStart(d);
    case 's': return !!st.started && vSnap(d);
    case 'k': d.x = cleanText(d.x, 80, ''); return !!d.x;
    case 'av': return isN(d.a, -1e3, 1e3) && isN(d.o, -2 * W, 2 * W);
    case 'chat':
      if (!isI(d.c, 0, 0xffffff)) return false;
      d.n = cleanName(d.n, ''); d.x = cleanText(d.x, 80, ''); return !!d.x;
    case 'sfx':
      if (typeof d.k !== 'string' || !/^[a-z]{1,12}$/.test(d.k)) return false;
      d.v = isN(d.v, 0, 2) ? d.v : 1; return true;
    case 'own':
      if (!isI(d.i, 0, LIM.NOWN - 1) || !isI(d.c, 0, 0xffffff)) return false;
      d.n = cleanName(d.n); d.h = d.h ? 1 : 0; d.sk = cleanId(d.sk); d.tr = cleanId(d.tr); return true;
    case 'dead': d.k = cleanName(d.k, ''); return true;
    default: return false;
  }
}

// ---- Trystero presence beacon of a public room. Returns a clean record or null.
export function vPresence(d) {
  if (!d || typeof d !== 'object' || typeof d.code !== 'string' || !CODE_RE.test(d.code)) return null;
  if (d.gone) return { code: d.code, gone: true };
  const host = cleanName(d.host);
  return { code: d.code, gone: false, name: host + ' odası', host, n: isI(d.n, 1, LIM.MAXH) ? d.n : 1, max: LIM.MAXH, v: isI(d.v, 0, 1000) ? d.v : -1 };
}
