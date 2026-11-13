import { shareUrl } from '../sharecard.js';
// Arena invite links: <page url>#arena=CODE or ?arena=CODE. Parsed once at module load, then stripped from the URL.
let pending = null;
try {
  const m = /[#&?]arena=([A-Za-z0-9]{3,8})/i.exec(location.hash) || /[?&]arena=([A-Za-z0-9]{3,8})/i.exec(location.search);
  if (m) {
    pending = m[1].toUpperCase();
    const sp = new URLSearchParams(location.search); sp.delete('arena');
    const q = sp.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
  }
} catch (e) { /* ignore */ }

export const hasArenaInvite = () => !!pending;
export function takeArenaInvite() { const c = pending; pending = null; return c; }

/** shareable link: the public site address (shareUrl() maps the native app's https://localhost to the real site) */
export function arenaInviteUrl(code) {
  const base = shareUrl();
  return base + (base.includes('?') ? '&' : '?') + 'arena=' + encodeURIComponent(code);
}
