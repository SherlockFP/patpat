// Platform layer: works in a plain browser (mobile/desktop) and inside Capacitor 8 native.
// Capacitor plugins other than @capacitor/core are lazy-imported, so web dev/build never
// needs them at runtime. Nothing here throws; every native call is guarded.

import { Capacitor, SystemBars } from '@capacitor/core';

const noop = () => {};
const HAPTICS_KEY = 'cig.haptics';
const MIN_HAPTIC_GAP_MS = 35;

// Web vibration patterns (ms). Keys double as the list of valid haptic kinds.
const WEB_PATTERNS = {
  light: 8,
  medium: 15,
  heavy: 30,
  success: [10, 40, 10],
  warning: [30, 60, 30],
  select: 5,
};

let isNative = false;
try {
  isNative = !!Capacitor.isNativePlatform();
} catch (_) {
  isNative = false;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------- local error log (no network)
// window.onerror / unhandledrejection go into a small ring buffer in localStorage; Settings > "Hata bildir" copies it to the clipboard.
const ERR_KEY = 'patpat.errlog';
const ERR_MAX = 20;
function readErrLog() {
  try {
    const a = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
    return Array.isArray(a) ? a.filter((e) => e && typeof e.m === 'string').slice(-ERR_MAX) : [];
  } catch (_) {
    return [];
  }
}
function logError(msg, where) {
  try {
    const a = readErrLog();
    const m = String(msg == null ? '' : msg).slice(0, 300);
    const w = String(where || '').slice(0, 160);
    const last = a[a.length - 1];
    if (last && last.m === m && last.w === w) last.n = (last.n || 1) + 1;
    else a.push({ t: new Date().toISOString(), m, w, n: 1 });
    localStorage.setItem(ERR_KEY, JSON.stringify(a.slice(-ERR_MAX)));
  } catch (_) {
    /* storage full / blocked: the log is best effort */
  }
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', (e) => {
    const f = e && e.filename ? String(e.filename).split('/').pop() + ':' + (e.lineno || 0) + ':' + (e.colno || 0) : '';
    logError((e && e.message) || (e && e.error && e.error.message) || 'error', f);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    logError('unhandledrejection: ' + ((r && (r.stack || r.message)) || r), '');
  });
}

// ---------------------------------------------------------------- haptics setting
let hapticsOn = true;
try {
  hapticsOn = localStorage.getItem(HAPTICS_KEY) !== '0';
} catch (_) {
  /* storage blocked: keep default (on) */
}

let lastHapticAt = -Infinity;
let hapticsMod = null; // resolved @capacitor/haptics module (set once selectionStart is done)
let hapticsLoad = null;

function loadHaptics() {
  if (!hapticsLoad) {
    hapticsLoad = import('@capacitor/haptics')
      .then(async (m) => {
        // selectionChanged() is a silent no-op on both iOS and Android until selectionStart()
        // has been called once. We start it once and never end it.
        try {
          await m.Haptics.selectionStart();
        } catch (_) {
          /* ignore */
        }
        hapticsMod = m;
        return m;
      })
      .catch(() => null);
  }
  return hapticsLoad;
}

function fireNativeHaptic(m, kind) {
  const { Haptics, ImpactStyle, NotificationType } = m;
  let p;
  switch (kind) {
    case 'light':
      p = Haptics.impact({ style: ImpactStyle.Light });
      break;
    case 'medium':
      p = Haptics.impact({ style: ImpactStyle.Medium });
      break;
    case 'heavy':
      p = Haptics.impact({ style: ImpactStyle.Heavy });
      break;
    case 'success':
      p = Haptics.notification({ type: NotificationType.Success });
      break;
    case 'warning':
      p = Haptics.notification({ type: NotificationType.Warning });
      break;
    case 'select':
      p = Haptics.selectionChanged();
      break;
    default:
      return;
  }
  if (p && typeof p.catch === 'function') p.catch(noop);
}

function fireWebHaptic(kind) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // Chrome ignores (and logs an intervention for) vibrate() before the first user gesture.
  const ua = navigator.userActivation;
  if (ua && !ua.hasBeenActive) return;
  navigator.vibrate(WEB_PATTERNS[kind]);
}

// ---------------------------------------------------------------- lifecycle
const pauseCbs = new Set();
const resumeCbs = new Set();
let paused = false;
let nativeLifecycle = false; // true once App 'appStateChange' is wired; then web visibility is ignored

function setPaused(next) {
  if (next === paused) return;
  paused = next;
  const set = next ? pauseCbs : resumeCbs;
  for (const cb of Array.from(set)) {
    try {
      cb();
    } catch (_) {
      /* a bad callback must not break the others */
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (nativeLifecycle) return;
    setPaused(document.visibilityState === 'hidden');
  });
}

// ---------------------------------------------------------------- back button
const backStack = []; // most recently registered handler wins

// ---------------------------------------------------------------- share helpers
function copyViaTextarea(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (_) {
    return false;
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through to legacy path */
  }
  return copyViaTextarea(text);
}

// ---------------------------------------------------------------- public API
let initPromise = null;

export const platform = {
  isNative,

  /** Call once at boot. Never throws; safe to call more than once. */
  init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!isNative) return;

      // Hide status bar + navigation/gesture bar (Capacitor 8 SystemBars lives in @capacitor/core).
      // The capacitor.config.json `plugins.SystemBars.hidden: true` already does this at launch;
      // calling hide() again also covers re-showing after a focus change.
      try {
        await SystemBars.hide();
      } catch (_) {
        /* ignore */
      }

      // App lifecycle + hardware back button.
      try {
        const { App } = await import('@capacitor/app');
        await App.addListener('appStateChange', (state) => setPaused(!state.isActive));
        nativeLifecycle = true;
        // Registering a 'backButton' listener disables Capacitor's default back behaviour
        // (history.back / exit). With no onBack handler registered, Back therefore does nothing.
        await App.addListener('backButton', () => {
          const cb = backStack[backStack.length - 1];
          if (!cb) return;
          try {
            cb();
          } catch (_) {
            /* ignore */
          }
        });
      } catch (_) {
        /* App plugin unavailable: web visibilitychange fallback stays active */
      }

      // Warm up haptics so the first buzz has no import latency.
      loadHaptics();
    })().catch(noop);
    return initPromise;
  },

  /**
   * kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'select'
   * Fire-and-forget; globally throttled to one call per ~35 ms.
   */
  haptic(kind = 'light') {
    if (!hapticsOn) return;
    if (!(kind in WEB_PATTERNS)) return;
    const t = now();
    if (t - lastHapticAt < MIN_HAPTIC_GAP_MS) return;
    lastHapticAt = t;
    try {
      if (isNative) {
        if (hapticsMod) fireNativeHaptic(hapticsMod, kind);
        else loadHaptics().then((m) => m && fireNativeHaptic(m, kind)).catch(noop);
      } else {
        fireWebHaptic(kind);
      }
    } catch (_) {
      /* never throw from haptics */
    }
  },

  setHapticsEnabled(on) {
    hapticsOn = !!on;
    try {
      localStorage.setItem(HAPTICS_KEY, hapticsOn ? '1' : '0');
    } catch (_) {
      /* storage blocked: setting lasts for this session only */
    }
  },

  hapticsEnabled() {
    return hapticsOn;
  },

  /** App/tab went to background. Returns an unsubscribe function. */
  onPause(cb) {
    if (typeof cb !== 'function') return noop;
    pauseCbs.add(cb);
    return () => pauseCbs.delete(cb);
  },

  /** App/tab came back to foreground. Returns an unsubscribe function. */
  onResume(cb) {
    if (typeof cb !== 'function') return noop;
    resumeCbs.add(cb);
    return () => resumeCbs.delete(cb);
  },

  /**
   * Android hardware/gesture Back. The most recently registered handler runs (stack order);
   * with none registered, Back does nothing. No-op on web. Returns an unsubscribe function.
   */
  onBack(cb) {
    if (typeof cb !== 'function') return noop;
    backStack.push(cb);
    return () => {
      const i = backStack.lastIndexOf(cb);
      if (i >= 0) backStack.splice(i, 1);
    };
  },

  /** Copies text to the clipboard. Resolves to true on success. */
  copyText(text) {
    return copyText(String(text == null ? '' : text));
  },

  /** The local error log as plain text (newest last), with a short header; empty log still returns the header. */
  errorLogText(version) {
    const a = readErrLog();
    const head = 'PATPAT ' + (version || '') + ' | native=' + isNative + ' | ' + new Date().toISOString() + ' | errors=' + a.length;
    return [head].concat(a.map((e) => e.t + (e.n > 1 ? ' x' + e.n : '') + ' ' + e.m + (e.w ? ' @ ' + e.w : ''))).join('\n');
  },
  errorLogCount() {
    return readErrLog().length;
  },
  clearErrorLog() {
    try { localStorage.removeItem(ERR_KEY); } catch (_) { /* ignore */ }
  },

  /**
   * Asks the OS for an in-app store review (Play In-App Review / SKStoreReview). Never throws, resolves to true when asked.
   * shortcut: no review plugin is installed (no new dependencies allowed for 1.0), so this is a no-op everywhere; to ship it,
   * add @capacitor-community/in-app-review and call InAppReview.requestReview() inside the isNative branch below.
   */
  async requestReview() {
    if (!isNative) return false;
    return false;
  },

  /** Returns 'shared' | 'copied' | 'failed'. Call from a user gesture (tap). */
  // Rewarded-ad gate (PLAN_V3 8.6). Every reward-ad button (revive, 2x snowflakes, free chest, extra wheel spin) must be created only
  // when rewardedAvailable() is true and must grant its reward only when rewarded(placement) resolves true.
  // shortcut: no ad SDK, wire AdMob here (load/show the rewarded ad, resolve true on the reward callback); until then nothing is shown.
  rewardedAvailable() { return false; },
  /** placement: 'revive' | 'x2flakes' | 'chest' | 'wheel'. Resolves true only after the reward was earned. Never rejects. */
  rewarded(placement) { void placement; return Promise.resolve(false); },

  async share({ text, url } = {}) {
    const clipboardText = [text, url].filter(Boolean).join('\n');
    if (!clipboardText) return 'failed';

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        const data = {};
        if (text) data.text = text;
        if (url) data.url = url;
        if (typeof navigator.canShare !== 'function' || navigator.canShare(data)) {
          try {
            await navigator.share(data);
            return 'shared';
          } catch (err) {
            // User dismissed the share sheet: don't silently copy behind their back.
            if (err && err.name === 'AbortError') return 'failed';
            /* other errors (NotAllowed, no gesture, ...) fall back to clipboard */
          }
        }
      }
    } catch (_) {
      /* fall through */
    }

    try {
      return (await copyText(clipboardText)) ? 'copied' : 'failed';
    } catch (_) {
      return 'failed';
    }
  },
};

// ---------------------------------------------------------------- local notifications (native only)
const NOTIF_ASKED_KEY = 'cig.notifAsked';
let notifLoad = null;
function loadNotif() {
  if (!isNative) return Promise.resolve(null);
  if (!notifLoad) notifLoad = import('@capacitor/local-notifications').then((m) => m.LocalNotifications).catch(() => null);
  return notifLoad;
}
export const notify = {
  /** list: [{ id, title?, body, at: Date }]. Replaces pending notifications with the same ids. */
  async schedule(list) {
    try {
      const LN = await loadNotif();
      if (!LN || !Array.isArray(list) || !list.length) return false;
      const perm = await LN.checkPermissions();
      if (perm.display !== 'granted') return false;
      await LN.schedule({
        notifications: list.slice(0, 3).map((n) => ({
          id: n.id, title: n.title || 'PATPAT', body: n.body, schedule: { at: n.at, allowWhileIdle: true },
        })),
      });
      return true;
    } catch (_) { return false; }
  },
  async cancelAll() {
    try {
      const LN = await loadNotif();
      if (!LN) return;
      const p = await LN.getPending();
      if (p && p.notifications && p.notifications.length) await LN.cancel({ notifications: p.notifications.map((n) => ({ id: n.id })) });
    } catch (_) { /* ignore */ }
  },
  /** Asks for permission once ever (remembered in localStorage). Call after the 2nd completed run. */
  async requestOnce() {
    try {
      if (!isNative) return false;
      if (localStorage.getItem(NOTIF_ASKED_KEY)) return false;
      localStorage.setItem(NOTIF_ASKED_KEY, '1');
      const LN = await loadNotif();
      if (!LN) return false;
      const r = await LN.requestPermissions();
      return r.display === 'granted';
    } catch (_) { return false; }
  },
};

export default platform;
