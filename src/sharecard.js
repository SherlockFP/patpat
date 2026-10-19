// PATPAT share card: 1080x1350 PNG on a 2D canvas + navigator.share(files) with download/clipboard fallback.
// Optional: main.js may call setShareContext({ renderer, scene, camera }) so the card gets a live game snapshot;
// without it we try the page canvas and, if it is blank, fall back to a gradient in the skin colour.
import { save } from './save.js';
import { t } from './i18n.js';
import { SKINS } from './skins.js';

let ctx3d = null;
export function setShareContext(c) { ctx3d = c; }

// The link printed on the card and shared with it. A hosted build uses its own address; the Capacitor app (https://localhost)
// and dev / LAN servers would share a dead link, so they fall back to the public site. Change the domain here when the game moves.
export const PUBLIC_URL = 'https://sherlockfp.github.io/patpat/';
export function shareUrl() {
  try {
    const { protocol, hostname, origin, pathname } = location;
    const hosted = /^https?:$/.test(protocol) && !!hostname && hostname !== 'localhost' && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(hostname) && !hostname.endsWith('.local');
    return hosted ? origin + pathname.replace(/index\.html$/, '') : PUBLIC_URL;
  } catch { return PUBLIC_URL; }
}

const W = 1080, H = 1350;
const INK = '#14213d';

function skinInfo() {
  let id = 'classic';
  try { id = save.selected('skin') || 'classic'; } catch { /* ignore */ }
  const s = SKINS.find((x) => x.id === id) || SKINS[0];
  const pv = (s && s.preview) || {};
  return { name: (s && s.name) || 'Klasik Kar', a: pv.a || '#ffffff', b: pv.b || '#cfe2f7' };
}

// returns a canvas/image source or null; must run synchronously in the click tick
function snapshot() {
  try {
    let cv = null;
    if (ctx3d && ctx3d.renderer) {
      const { renderer, scene, camera } = ctx3d;
      if (scene && camera) renderer.render(scene, camera);
      cv = renderer.domElement;
    } else cv = document.querySelector('canvas');
    if (!cv || !cv.width || !cv.height) return null;
    const t = document.createElement('canvas');
    t.width = cv.width; t.height = cv.height;
    const c = t.getContext('2d');
    c.drawImage(cv, 0, 0);
    // blank check (preserveDrawingBuffer=false outside the render tick gives transparent/black)
    const d = c.getImageData(0, 0, t.width, t.height, { willReadFrequently: true }).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 997) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    return lit > 8 ? t : null;
  } catch { return null; }
}

function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function outlined(c, text, x, y, size, fill, lw = 14, font = '"Arial Black", Impact, system-ui, sans-serif') {
  text = t(text);
  c.font = `900 ${size}px ${font}`;
  c.lineJoin = 'round'; c.lineWidth = lw; c.strokeStyle = INK;
  c.strokeText(text, x, y); c.fillStyle = fill; c.fillText(text, x, y);
}

function fit(c, text, x, y, maxW, size, fill, lw) {
  text = t(text);
  let s = size;
  c.font = `900 ${s}px "Arial Black", Impact, system-ui, sans-serif`;
  while (s > 24 && c.measureText(text).width > maxW) { s -= 4; c.font = `900 ${s}px "Arial Black", Impact, system-ui, sans-serif`; }
  outlined(c, text, x, y, s, fill, lw);
}

export function drawCard({ mode, big, unit, isRec, challenge }) {
  const sk = skinInfo();
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.textAlign = 'center'; c.textBaseline = 'middle';

  // background: game snapshot (cover) or stylised gradient with the skin colour
  const snap = snapshot();
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#6ec6ff'); g.addColorStop(0.55, '#bfe6ff'); g.addColorStop(1, '#f4fbff');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  if (snap) {
    const k = Math.max(W / snap.width, H / snap.height);
    const sw = W / k, sh = H / k;
    c.drawImage(snap, (snap.width - sw) / 2, (snap.height - sh) / 2, sw, sh, 0, 0, W, H);
    c.fillStyle = 'rgba(10,30,70,0.28)'; c.fillRect(0, 0, W, H);
  } else {
    c.fillStyle = 'rgba(255,255,255,0.65)';
    for (let i = 0; i < 26; i++) { c.beginPath(); c.arc((i * 337) % W, (i * 211) % H, 6 + (i % 4) * 4, 0, 7); c.fill(); }
    const bg = c.createRadialGradient(W / 2, 760, 20, W / 2, 760, 330);
    bg.addColorStop(0, sk.a); bg.addColorStop(1, sk.b);
    c.fillStyle = bg; c.strokeStyle = INK; c.lineWidth = 18;
    c.beginPath(); c.arc(W / 2, 760, 300, 0, 7); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath(); c.ellipse(W / 2 - 100, 660, 90, 55, -0.6, 0, 7); c.fill();
  }

  // logo
  c.save(); c.translate(W / 2, 190); c.rotate(-0.04);
  outlined(c, 'PATPAT', 0, 0, 230, '#ffd23f', 34);
  c.restore();

  // result panel
  c.fillStyle = 'rgba(255,255,255,0.94)'; c.strokeStyle = INK; c.lineWidth = 14;
  rr(c, 90, 380, W - 180, 520, 56); c.fill(); c.stroke();
  outlined(c, mode, W / 2, 450, 62, '#2f9bff', 12);
  fit(c, String(big), W / 2, 620, W - 260, 190, '#ff5a3c', 22);
  outlined(c, unit, W / 2, 760, 56, '#14213d', 0);
  c.fillStyle = INK; c.font = '900 56px "Arial Black", Impact, system-ui, sans-serif'; c.fillText(t(unit), W / 2, 760);
  if (isRec) {
    c.save(); c.translate(W / 2, 850); c.rotate(-0.05);
    c.fillStyle = '#ffd23f'; c.strokeStyle = INK; c.lineWidth = 12;
    rr(c, -270, -48, 540, 96, 30); c.fill(); c.stroke();
    outlined(c, '★ YENİ REKOR! ★', 0, 4, 54, '#d6204a', 8);
    c.restore();
  }

  // skin chip
  c.fillStyle = sk.a; c.strokeStyle = INK; c.lineWidth = 10;
  c.beginPath(); c.arc(300, 990, 34, 0, 7); c.fill(); c.stroke();
  c.textAlign = 'left';
  outlined(c, sk.name, 350, 990, 46, '#ffffff', 10);
  c.textAlign = 'center';

  // challenge + url
  fit(c, challenge, W / 2, 1110, W - 120, 72, '#ffffff', 16);
  const url = shareUrl();
  c.fillStyle = INK; rr(c, 90, 1190, W - 180, 96, 40); c.fill();
  c.fillStyle = '#ffd23f'; c.font = '900 40px system-ui, sans-serif';
  let u = url.replace(/^https?:\/\//, '');
  while (c.measureText(u).width > W - 260 && u.length > 8) u = u.slice(0, -2);
  c.fillText(u === url.replace(/^https?:\/\//, '') ? u : u + '…', W / 2, 1240);
  return cv;
}

async function toast(msg) {
  try { const ui = window.__cigUi; if (ui && ui.toast) return ui.toast(msg); } catch { /* ignore */ }
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;left:50%;top:14%;transform:translateX(-50%);background:#14213d;color:#fff;font:900 16px system-ui;padding:10px 18px;border-radius:14px;z-index:99999;pointer-events:none';
  document.body.appendChild(d); setTimeout(() => d.remove(), 2200);
}

/** opts: { mode, big, unit, isRec, challenge, text } — call from a click handler */
export async function shareCard(opts) {
  const url = shareUrl();
  const text = opts.text || `PATPAT ${t(opts.mode)}: ${opts.big} ${t(opts.unit)}${opts.isRec ? ' — ' + t('YENİ REKOR!') : ''} ${t(opts.challenge)}`;
  let cv;
  try { cv = drawCard(opts); } catch { cv = null; }
  if (!cv) { toast(t('Kart oluşturulamadı')); return 'failed'; }
  const blob = await new Promise((r) => { try { cv.toBlob(r, 'image/png'); } catch { r(null); } });
  if (!blob) { toast(t('Kart oluşturulamadı')); return 'failed'; }
  const file = new File([blob], 'patpat.png', { type: 'image/png' });
  try {
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text, url });
      return 'shared';
    }
  } catch (e) { if (e && e.name === 'AbortError') return 'failed'; }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'patpat.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch { /* ignore */ }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); } catch { /* ignore */ }
  toast(t('Görsel indirildi, link kopyalandı!'));
  return 'copied';
}
