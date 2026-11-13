// Mobile web: go fullscreen on the first touch (browsers refuse it without a user gesture).
// Native builds are made immersive in MainActivity.java; iPhone Safari has no Fullscreen API (req is undefined: nothing to do).
const el = document.documentElement;
const req = el.requestFullscreen || el.webkitRequestFullscreen;
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

if (req && !native && coarse) {
  let pending = false;   // pointerup and touchend both fire for one tap: ask once
  const go = () => {
    if (pending || document.fullscreenElement || document.webkitFullscreenElement) return;
    pending = true;
    try {
      Promise.resolve(req.call(el, { navigationUI: 'hide' }))
        .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait'))
        .catch(() => { /* denied or unsupported: stay windowed */ })
        .then(() => { pending = false; });
    } catch { pending = false; /* ignore */ }
  };
  // Re-armed on every tap so the game returns to fullscreen after the user leaves it.
  addEventListener('pointerup', go, { passive: true });
  addEventListener('touchend', go, { passive: true });
}
