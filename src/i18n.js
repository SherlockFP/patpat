// Tiny runtime i18n: Turkish source strings -> English via dictionaries + a DOM translator.
import * as menus from './i18n/en_menus.js';
import * as ui from './i18n/en_ui.js';
import * as runner from './i18n/en_runner.js';
import * as agar from './i18n/en_agar.js';

const KEY = 'patpat_lang';
const sysLang = () => (String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase().startsWith('tr') ? 'tr' : 'en');
let lang = sysLang();
try {
  const s = localStorage.getItem(KEY);
  if (s === 'tr' || s === 'en') lang = s;
} catch { /* ignore */ }
try { document.documentElement.lang = lang; } catch { /* ignore */ }

export function getLang() { return lang; }
export function setLang(l) {
  try { localStorage.setItem(KEY, l === 'en' ? 'en' : 'tr'); } catch { /* ignore */ }
  location.reload();
}

const WORDS = new Map();
const PATTERNS = [];
for (const m of [menus, ui, runner, agar]) {
  if (m.words) for (const k in m.words) WORDS.set(k.trim(), m.words[k]);
  if (m.patterns) for (const p of m.patterns) PATTERNS.push(p);
}

const HAS_LETTER = /\p{L}/u;
const EDGE = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u;
const MEMO = new Map();

function core(s) {
  const w = WORDS.get(s);
  if (w !== undefined) return w;
  for (let i = 0; i < PATTERNS.length; i++) {
    const p = PATTERNS[i];
    if (p[0].test(s)) return typeof p[1] === 'function' ? s.replace(p[0], p[1]) : s.replace(p[0], (...m) => p[1].replace(/\$(\d)/g, (_, i) => {
      const g = m[+i];     // a captured name (mountain, ball, quest) is translated on its own: "DAĞ 37 · Şimşek Geçidi" -> "MOUNTAIN 37 · Lightning Pass"
      if (typeof g !== 'string') return '';
      if (g.length >= s.length || !HAS_LETTER.test(g)) return g;
      const w = core(g);
      return w === null ? g : w;
    }));
  }
  return null;
}

function translate(s) {
  const lead = s.match(/^\s*/)[0];
  const trail = s.length > lead.length ? s.match(/\s*$/)[0] : '';
  const c = s.slice(lead.length, s.length - trail.length);
  let r = core(c);
  if (r === null) {
    const m = c.match(EDGE);
    if (m && (m[1] || m[3]) && m[2]) {
      const r2 = core(m[2]);
      if (r2 !== null) r = m[1] + r2 + m[3];
    }
  }
  return r === null ? s : lead + r + trail;
}

export function t(s) {
  if (lang !== 'en' || typeof s !== 'string' || !s || !HAS_LETTER.test(s)) return s;
  let r = MEMO.get(s);
  if (r === undefined) {
    r = translate(s);
    if (MEMO.size > 2000) MEMO.clear();
    MEMO.set(s, r);
  }
  return r;
}

const SKIP = { SCRIPT: 1, STYLE: 1, CANVAS: 1 };
const ATTRS = ['placeholder', 'title', 'aria-label'];

function doText(n) {
  const d = n.data;
  if (d === n._i18n) return;
  const r = t(d);
  if (r !== d) { n._i18n = r; n.data = r; }
}
function doEl(e) {
  for (let i = 0; i < 3; i++) {
    const a = ATTRS[i];
    const v = e.getAttribute(a);
    if (v) { const r = t(v); if (r !== v) e.setAttribute(a, r); }
  }
}
function walk(root) {
  if (root.nodeType === 3) { if (!SKIP[root.parentNode && root.parentNode.nodeName]) doText(root); return; }
  if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
  doEl(root);
  const tw = document.createTreeWalker(root, 1 | 4);
  let n;
  while ((n = tw.nextNode())) {
    if (n.nodeType === 3) { if (!SKIP[n.parentNode.nodeName]) doText(n); }
    else if (!SKIP[n.nodeName]) doEl(n);
  }
}

let installed = false;
export function installI18n() {
  if (installed) return;
  installed = true;
  if (lang !== 'en') return;
  const start = () => {
    try { document.title = t(document.title); } catch { /* ignore */ }
    walk(document.documentElement);
    new MutationObserver((recs) => {
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        if (r.type === 'characterData') { if (!SKIP[r.target.parentNode && r.target.parentNode.nodeName]) doText(r.target); }
        else if (r.type === 'attributes') { if (r.target.nodeType === 1) doEl(r.target); }
        else for (let j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      }
    }).observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}
