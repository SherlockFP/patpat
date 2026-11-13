// uiicons.js: glossy low-poly UI icons (public/ui/*.webp, AI-generated, see store/src + CREDITS). Emoji stays the fallback when an image fails to load.
const MAP = {
  '❄️': 'cur_snowflake', '❄': 'cur_snowflake', '🎁': 'ui_gift', '🧲': 'pw_magnet', '🍄': 'pw_giant', '🚀': 'pw_rocket', '🛡️': 'pw_shield',
  '🧊': 'pw_freeze', '🌈': 'pw_rainbow', '🌟': 'pw_golden', logo: 'logo', rush: 'mode_rush', cig: 'mode_cig', macera: 'mode_macera', arena: 'mode_arena',
};
/** <img> for a mapped emoji / mode key, else null. fb = text shown when the image fails (default: the emoji, nothing for word keys). */
export function uiImg(k, cls = 'uim', fb) {
  const n = MAP[k];
  if (!n || typeof document === 'undefined') return null;
  const i = document.createElement('img');
  i.className = cls; i.alt = ''; i.draggable = false; i.decoding = 'async';
  i.onerror = () => { i.onerror = null; i.replaceWith(document.createTextNode(fb ?? (/^[a-z]+$/.test(k) ? '' : k))); };
  i.src = './ui/' + n + '.webp';
  return i;
}
/** host.textContent = emoji, or the image when one is mapped. */
export function setIcon(host, k) {
  host.textContent = '';
  const i = uiImg(k);
  if (i) host.appendChild(i); else host.textContent = k;
  return host;
}
