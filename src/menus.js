// menus.js — PATPAT lobby (mobile-game style main menu) + panels (campaign map, daily reward, achievements, missions, upgrades,
// letter hunt, settings, mystery boxes, level complete/failed, toasts, easter eggs). Self-contained DOM + injected CSS (<style id="freemon-menus-style">).
//
// Lobby flow: OYNA starts YETİ RUSH directly (callbacks.onEndless), no mode screen and no modal on boot. The daily reward is a
// badge on a button (claim inside). Mid-run meta events (achievements, missions, letters) are never toasted here: they are
// queued in meta.js and shown on the result screen only.
//
//   const menus = createMenus({ save, meta, root: document.getElementById('app'), callbacks });
//   menus.showMain(info); menus.hideMain(); menus.toastAchievement(a); menus.showDailyIfAvailable();
//   menus.openBoxes(n, onDone); menus.refresh(); menus.isOpen();
//   menus.back();  // Esc / Android Back: closes the top overlay (planet screen, panel, card), true if it closed one
//
// Importing this module never touches `document`; everything happens inside createMenus().
import { SKINS, TRAILS, setGoldBall } from './skins.js';
import { ACHIEVEMENTS, EGGS, DAILY_REWARDS, UPGRADES, SLED_PACK } from './meta.js';
import { ACTS, LEVELS, levelById, BONUS } from './campaign.js';
import { dagPlan, DAG_COUNT, planBrief } from './cigplan.js';
import { nextGoal, vitrinInfo } from './shop.js';
import { hideBoot, runnerDeathText } from './ui.js';

const STYLE_ID = 'freemon-menus-style';
const VERSION = '0.3.0';
const LEVELS_PER_ACT = 10;
const ACT_SUF = ['i', 'yi', 'ü', 'ü', 'i', 'yı', 'yi', 'i', 'u', 'u']; // Turkish accusative: Act 1'i, 2'yi, 3'ü ...
const WORD = 'PATPAT';
const KONAMI = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'];

// ================================================================================================================ CSS

const CSS = `
/* profile top-left (always visible) + ready-rewards chip top-right */
.fm-top .fm-av { flex: 0 1 auto; max-width: 40%; min-width: 118px; }
.fm-av .fm-avt.fm-prof { display: flex !important; min-width: 0; }
.fm-prof .fm-nm { font-size: 15px; max-width: 120px; }
.fm-prof .fm-xp { width: 88px; }
.fm-rwc { flex: none; height: 36px; padding: 0 10px; border-radius: 18px; border: 3px solid var(--ink); background: linear-gradient(180deg, #fff3a8, #ffc23a); color: var(--ink); font: inherit; font-size: 15px; box-shadow: 0 3px 0 var(--ink2); cursor: pointer; animation: fmChip 1s ease-in-out infinite alternate; }
.fm-rwc.off { display: none; }

.fm-main, .fm-ov, .fm-modal, .fm-toasts, .fm-fx, .fm-boxov, .fm-plov, .fm-resov {
  --ink: #17345c; --ink2: #0d1f3c; --orange: #ff7a2f; --orange-dark: #d2541a; --blue: #2f7dff; --blue-dark: #1d55b8; --gold: #ffcf3a;
  --purple: #7a3cf0; --green: #35c46a; --red: #ff4d4d;
  --fm-font: "Lilita One", "Baloo 2", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --ol: 0 2px 0 var(--ink), 2px 2px 0 var(--ink), -2px 2px 0 var(--ink), 2px -2px 0 var(--ink), -2px -2px 0 var(--ink), 0 5px 6px rgba(10, 30, 60, 0.35);
  --ol-sm: 0 1.5px 0 var(--ink), 1.5px 1.5px 0 var(--ink), -1.5px 1.5px 0 var(--ink), 1.5px -1.5px 0 var(--ink), -1.5px -1.5px 0 var(--ink);
  font-family: var(--fm-font); font-weight: 900; font-synthesis: none; letter-spacing: 0.02em; color: #fff; text-shadow: var(--ol-sm);
  user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
}
.fm-main *, .fm-ov *, .fm-modal *, .fm-toasts *, .fm-fx *, .fm-boxov *, .fm-plov *, .fm-resov * { box-sizing: border-box; }
.fm-lastc { display: block; margin: 0 auto 6px; padding: 5px 14px; border-radius: 12px; border: 2px solid rgba(255, 255, 255, 0.5); background: rgba(13, 31, 60, 0.55); color: #fff; font-size: 12.5px; letter-spacing: 0.03em; text-shadow: none; cursor: pointer; }
.fm-lastc:empty { display: none; }
/* button reset at ZERO class specificity (:where) so every class rule (.fm-tchip { color }, .fm-lastc { margin }, ...) wins over it */
:where(.fm-main, .fm-ov, .fm-modal, .fm-boxov, .fm-plov, .fm-resov, .fm-wheel) button {
  font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; color: inherit; text-shadow: inherit; -webkit-appearance: none; appearance: none;
}
.fm-main button:focus, .fm-ov button:focus, .fm-modal button:focus, .fm-boxov button:focus, .fm-plov button:focus, .fm-resov button:focus { outline: none; }
.fm-main button:focus-visible, .fm-ov button:focus-visible, .fm-modal button:focus-visible, .fm-boxov button:focus-visible, .fm-plov button:focus-visible, .fm-resov button:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
.fm-ol { text-shadow: var(--ol); }
@keyframes fmPopIn { 0% { opacity: 0; transform: scale(0.2); } 60% { opacity: 1; transform: scale(1.14); } 100% { opacity: 1; transform: scale(1); } }
@keyframes fmDrop { 0% { opacity: 0; transform: translateY(-30px); } 60% { opacity: 1; transform: translateY(5px); } 100% { opacity: 1; transform: none; } }
@keyframes fmUp { 0% { opacity: 0; transform: translateY(46px); } 60% { opacity: 1; transform: translateY(-6px); } 100% { opacity: 1; transform: none; } }

/* =============================================================== MAIN SCREEN (lobby) */
.fm-main {
  position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column; pointer-events: none;
  padding-top: calc(var(--sat, env(safe-area-inset-top, 0px)) + 8px);
  background:
    radial-gradient(ellipse 85% 42% at 50% 56%, rgba(40, 20, 100, 0) 0%, rgba(40, 20, 100, 0) 55%, rgba(26, 14, 78, 0.38) 100%),
    linear-gradient(180deg, rgba(34, 24, 104, 0.84) 0%, rgba(40, 52, 140, 0.52) 17%, rgba(46, 78, 170, 0.16) 36%, rgba(36, 60, 140, 0.06) 56%, rgba(28, 22, 92, 0.58) 82%, rgba(22, 14, 74, 0.86) 100%);
}
.fm-main.fm-hide { display: none; }
.fm-main.fm-under { visibility: hidden; }
.fm-main > * { pointer-events: auto; }
.fm-main > .fm-mid { pointer-events: none; }

/* ---- top bar ---- */
.fm-top { flex: none; display: flex; align-items: center; gap: 8px; width: 100%; max-width: 480px; margin: 0 auto; padding: 0 12px; }
.fm-av { display: flex; align-items: center; gap: 8px; flex: 1 1 0; min-width: 0; padding: 0; border: 0; background: none; cursor: pointer; text-align: left; }
.fm-avc {
  position: relative; flex: none; width: 50px; height: 50px; border-radius: 50%; border: 3px solid var(--ink); display: grid; place-items: center; font-size: 26px; line-height: 1;
  background: radial-gradient(circle at 35% 28%, #fff 0 25%, #d7ebff 60%, #9cc5f0 100%); box-shadow: 0 4px 0 var(--ink2), 0 6px 8px rgba(10, 30, 60, 0.35); text-shadow: none;
}
.fm-lv {
  position: absolute; right: -6px; bottom: -6px; min-width: 26px; height: 26px; padding: 0 5px; display: grid; place-items: center; border-radius: 13px; border: 2.5px solid var(--ink);
  background: linear-gradient(180deg, #ffe27a, #ffae00); color: var(--ink); font-size: 15px; line-height: 1; text-shadow: none; box-shadow: 0 2px 0 var(--ink2);
}
.fm-avt { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.fm-nm { font-size: 17px; line-height: 1; text-shadow: var(--ol); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fm-xp { position: relative; width: 78px; max-width: 100%; height: 11px; border-radius: 6px; border: 2.5px solid var(--ink); background: rgba(10, 25, 55, 0.6); overflow: hidden; }
.fm-xp i { position: absolute; left: 0; top: 0; bottom: 0; width: var(--p, 0%); background: linear-gradient(180deg, #8dff9a, #2fc13f); box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.45); }
.fm-cur {
  position: relative; flex: none; display: flex; align-items: center; gap: 5px; height: 38px; padding: 0 4px 0 9px; border-radius: 19px; border: 3px solid var(--ink);
  background: linear-gradient(180deg, rgba(34, 66, 120, 0.82), rgba(10, 25, 55, 0.82)); box-shadow: 0 3px 0 var(--ink2), inset 0 2px 0 rgba(255, 255, 255, 0.14);
}
.fm-cur .ico { font-size: 17px; line-height: 1; text-shadow: none; }
.fm-cur .num { min-width: 36px; text-align: right; font-size: 17px; line-height: 1; text-shadow: var(--ol-sm); }
.fm-cur.bump { animation: fmBump 0.4s cubic-bezier(.2, 1.8, .4, 1); }
.fm-plus {
  position: relative; flex: none; width: 27px; height: 27px; padding: 0; display: grid; place-items: center; border-radius: 50%; border: 2.5px solid var(--ink); cursor: pointer;
  background: linear-gradient(180deg, #8dff9a, #2fc13f); color: #fff; font-size: 20px; line-height: 1; box-shadow: 0 2px 0 var(--ink2), inset 0 2px 0 rgba(255, 255, 255, 0.5);
}
.fm-plus::after { content: ""; position: absolute; inset: -9px; }
.fm-plus:active { transform: translateY(2px); box-shadow: 0 0 0 var(--ink2); }
@keyframes fmBump { 0% { transform: scale(1); } 35% { transform: scale(1.18); } 100% { transform: scale(1); } }

/* ---- logo + ribbon ---- */
.fm-logorow { flex: none; position: relative; display: flex; justify-content: center; margin-top: 10px; }
.fm-logorow::before { content: ""; position: absolute; left: 50%; top: 50%; width: 112%; height: 150%; transform: translate(-50%, -50%); pointer-events: none; background: radial-gradient(ellipse 50% 50% at 50% 50%, rgba(255, 255, 255, 0.34), rgba(160, 190, 255, 0.14) 55%, rgba(160, 190, 255, 0) 75%); }
.fm-logo {
  position: relative; display: flex; justify-content: center; align-items: baseline; gap: 1px; padding: 4px 14px 8px; cursor: pointer; min-height: 56px;
  font-size: clamp(44px, 14.6vw, 66px); line-height: 1; transform: rotate(-2deg); touch-action: none;
}
.fm-ch {
  position: relative; display: inline-block; color: var(--ink);
  text-shadow: 0 .09em 0 var(--ink), .055em .055em 0 var(--ink), -.055em .055em 0 var(--ink), .055em -.055em 0 var(--ink), -.055em -.055em 0 var(--ink),
    0 -.055em 0 var(--ink), .075em 0 0 var(--ink), -.075em 0 0 var(--ink), 0 .16em .12em rgba(10, 30, 60, 0.35);
  animation: fmBob 2.4s ease-in-out infinite; animation-delay: calc(var(--i) * -0.19s);
}
.fm-ch::after {
  content: attr(data-t); position: absolute; left: 0; top: 0; width: 100%; height: 100%; text-shadow: none;
  background: linear-gradient(180deg, var(--c1) 0%, var(--c2) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent;
}
.fm-ball {
  position: relative; display: inline-block; width: 0.74em; height: 0.74em; margin: 0 0.04em; border-radius: 50%; border: 0.07em solid var(--ink);
  background: radial-gradient(circle at 34% 28%, #fff 0 30%, #e6f2ff 55%, #b9d6f5 100%);
  box-shadow: 0 0.07em 0 var(--ink), inset -0.05em -0.06em 0 rgba(120, 170, 225, 0.55), 0 0.16em 0.12em rgba(10, 30, 60, 0.3);
  animation: fmBob 2.4s ease-in-out infinite; animation-delay: calc(var(--i) * -0.19s);
}
.fm-ball .e { position: absolute; top: 0.2em; width: 0.1em; height: 0.15em; border-radius: 50%; background: var(--ink); animation: fmBlink 4.2s infinite; }
.fm-ball .e.l { left: 0.17em; } .fm-ball .e.r { right: 0.17em; }
.fm-ball .n { position: absolute; left: 50%; top: 0.35em; width: 0.17em; height: 0.09em; margin-left: -0.04em; border-radius: 0 60% 60% 0; background: #ff8a2a; }
.fm-logo.spin { animation: fmSpin 1.15s cubic-bezier(.3, 1.3, .5, 1); }
.fm-logo.squish { animation: fmSquish 0.18s ease-out; }
@keyframes fmBob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-0.07em) rotate(1.6deg); } }
@keyframes fmBlink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.08); } }
@keyframes fmSpin { 0% { transform: rotate(-2deg) scale(1); } 40% { transform: rotate(358deg) scale(1.3); } 100% { transform: rotate(718deg) scale(1); } }
@keyframes fmSquish { 0% { transform: rotate(-2deg) scale(1); } 50% { transform: rotate(-2deg) scale(0.94, 1.04); } 100% { transform: rotate(-2deg) scale(1); } }

/* the letter-hunt ribbon moved into the missions panel */
.fm-ribrow, .fm-rib { display: none; }
.fm-chip {
  width: 23px; height: 27px; flex: none; display: grid; place-items: center; font-size: 15px; line-height: 1; border-radius: 7px; text-shadow: none;
  border: 2px solid var(--ink); background: rgba(10, 25, 55, 0.5); color: rgba(255, 255, 255, 0.45);
}
.fm-chip.got { background: linear-gradient(180deg, #fff3a8, var(--gold)); color: var(--ink); box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.7); }
.fm-chip.next { color: #fff; animation: fmChip 1s ease-in-out infinite alternate; }
@keyframes fmChip { from { box-shadow: 0 0 0 0 rgba(255, 207, 58, 0.9); } to { box-shadow: 0 0 0 4px rgba(255, 207, 58, 0); } }
.fm-tag { flex: none; text-align: center; margin-top: -2px; font-size: 12px; letter-spacing: 0.26em; color: #e4ecff; text-shadow: var(--ol-sm); }
.fm-avt { display: none; }
.fm-av { flex: 0 0 auto; }
.fm-top { gap: 6px; }
.fm-top .fm-av { margin-right: auto; }
.fm-cur { height: 36px; padding: 0 3px 0 8px; }
.fm-cur .num { min-width: 30px; font-size: 16px; }

/* ---- daily reward: a badge on a button (never a popup) ---- */
.fm-dl {
  position: relative; flex: none; width: 44px; height: 44px; padding: 0; cursor: pointer; display: grid; place-items: center; border-radius: 50%; border: 3px solid var(--ink);
  background: radial-gradient(ellipse 60% 38% at 36% 22%, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0)), linear-gradient(180deg, #ffb347, #ff7a2f);
  box-shadow: 0 4px 0 #a8400f, 0 6px 8px rgba(10, 30, 60, 0.35); font-size: 22px; line-height: 1; text-shadow: none; transition: transform 0.06s, box-shadow 0.06s;
}
.fm-dl:active { transform: translateY(3px); box-shadow: 0 1px 0 #a8400f; }
.fm-dl .fm-bdg { top: -7px; right: -5px; }
.fm-dl .fm-dls { position: absolute; left: 50%; bottom: -9px; transform: translateX(-50%); min-width: 26px; padding: 1px 6px 2px; border-radius: 9px; border: 2px solid var(--ink); background: var(--ink); font-size: 11px; line-height: 1.1; white-space: nowrap; }
.fm-dl .fm-dls:empty { display: none; }
.fm-dl.ready { animation: fmDlWob 1.4s ease-in-out infinite; }
@keyframes fmDlWob { 0%, 70%, 100% { transform: rotate(0); } 76% { transform: rotate(-10deg); } 84% { transform: rotate(9deg); } 92% { transform: rotate(-5deg); } }

/* ---- middle: the 3D snowball shows through the hero zone; tapping it bounces it ---- */
.fm-mid { flex: 1 1 0; min-height: 0; position: relative; }
.fm-hero { position: absolute; left: 12%; right: 12%; top: 0; bottom: 0; touch-action: none; pointer-events: auto; }
.fm-best {
  position: absolute; left: 50%; top: 18px; transform: translateX(-50%) rotate(-1.5deg); max-width: 100%; padding: 5px 12px 6px; text-align: center; pointer-events: none; border-radius: 16px; border: 3px solid var(--ink);
  background: linear-gradient(180deg, #ffffff, #dfeaff); color: var(--ink); text-shadow: none; box-shadow: 0 4px 0 var(--ink2), 0 8px 12px rgba(10, 20, 60, 0.35); animation: fmBubble 3.2s ease-in-out infinite alternate;
}
.fm-best::after { content: ""; position: absolute; left: 50%; bottom: -11px; width: 16px; height: 16px; margin-left: -8px; transform: rotate(45deg); background: #dfeaff; border: 0 solid var(--ink); border-right-width: 3px; border-bottom-width: 3px; border-radius: 0 0 5px 0; }
.fm-best .bk { display: block; font-size: 11px; line-height: 1; letter-spacing: 0.12em; color: #5a7196; }
.fm-best .bv { display: block; margin-top: 2px; font-size: 24px; line-height: 1.05; color: var(--orange-dark); white-space: nowrap; }
.fm-best .bs { display: block; margin-top: 2px; font-size: 12px; line-height: 1.1; white-space: nowrap; }
@keyframes fmBubble { from { transform: translateX(-50%) translateY(0) rotate(-1.5deg); } to { transform: translateX(-50%) translateY(-4px) rotate(1deg); } }
.fm-achoo {
  position: absolute; left: 50%; top: 40%; transform: translateX(-50%) scale(0.3) rotate(-6deg); opacity: 0; pointer-events: none; white-space: nowrap; font-size: 34px; text-shadow: var(--ol);
}
.fm-achoo.on { animation: fmAchoo 1.5s ease-out forwards; }
@keyframes fmAchoo { 0% { opacity: 0; transform: translateX(-50%) scale(0.3) rotate(-6deg); } 30% { opacity: 0; } 40% { opacity: 1; transform: translateX(-50%) scale(1.25) rotate(4deg); } 80% { opacity: 1; transform: translateX(-50%) scale(1) rotate(0); } 100% { opacity: 0; transform: translateX(-50%) translateY(-24px) scale(1); } }
.fm-burst { position: absolute; left: 50%; top: 50%; font-size: 20px; pointer-events: none; animation: fmBurst 1.1s ease-out forwards; }
@keyframes fmBurst { 0% { opacity: 1; transform: translate(-50%, -50%) scale(0.4); } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1.2) rotate(240deg); } }
/* tap juice: powder puffs + a ring + a canvas hop when the 3D lobby ball has no bounce of its own */
.fm-puff { position: absolute; width: var(--s, 12px); height: var(--s, 12px); margin: calc(var(--s, 12px) / -2) 0 0 calc(var(--s, 12px) / -2); border-radius: 50%; pointer-events: none; background: radial-gradient(circle at 35% 30%, #fff, #dcecff 70%); opacity: 0; animation: fmPuff 0.55s ease-out forwards; }
@keyframes fmPuff { 0% { opacity: 0.95; transform: translate(0, 0) scale(0.5); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1.5); } }
.fm-ring { position: absolute; width: 80px; height: 80px; margin: -40px 0 0 -40px; border-radius: 50%; border: 4px solid rgba(255, 255, 255, 0.85); pointer-events: none; opacity: 0; animation: fmRing 0.5s ease-out forwards; }
@keyframes fmRing { 0% { opacity: 0.9; transform: scale(0.3); } 100% { opacity: 0; transform: scale(2.1); } }
.fm-pof { position: absolute; font-size: 22px; pointer-events: none; opacity: 0; color: #fff; animation: fmPofT 0.7s ease-out forwards; text-shadow: var(--ol); }
@keyframes fmPofT { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.4); } 25% { opacity: 1; transform: translate(-50%, -14px) scale(1.15); } 100% { opacity: 0; transform: translate(-50%, -34px) scale(1); } }
#c.fm-hop { animation: fmCanvasHop 0.34s cubic-bezier(.3, 1.5, .5, 1); transform-origin: 50% 52%; }
@keyframes fmCanvasHop { 0% { transform: scale(1, 1); } 20% { transform: scale(1.03, 0.95) translateY(0.6%); } 55% { transform: scale(0.99, 1.025) translateY(-1.3%); } 100% { transform: scale(1, 1); } }
.fm-ball.hop { animation: fmBallHop 0.4s cubic-bezier(.3, 1.6, .5, 1); }
@keyframes fmBallHop { 0% { transform: scale(1, 1); } 25% { transform: scale(1.25, 0.72) translateY(0.08em); } 60% { transform: scale(0.88, 1.18) translateY(-0.22em); } 100% { transform: scale(1, 1); } }
/* golden ball secret (10 quick taps): gold glow over the lobby ball + a gold logo mascot for the session */
.fm-aura { position: fixed; left: 50%; top: 50.5%; width: min(30vw, 140px); height: min(30vw, 140px); transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none; z-index: 41; opacity: 0;
  background: radial-gradient(circle, rgba(255, 196, 40, 0.5) 0%, rgba(255, 196, 40, 0.42) 60%, rgba(255, 196, 40, 0) 100%); }
.fm-gold:not(.fm-real) .fm-aura { opacity: 1; animation: fmAura 1.8s ease-in-out infinite alternate; }
@keyframes fmAura { from { transform: translate(-50%, -50%) scale(0.96); filter: brightness(1); } to { transform: translate(-50%, -50%) scale(1.06); filter: brightness(1.12); } }
.fm-gold .fm-ball { background: radial-gradient(circle at 34% 28%, #fffbe0 0 28%, #ffd84a 60%, #d89a00 100%); box-shadow: 0 0.07em 0 var(--ink), 0 0 0.35em rgba(255, 200, 40, 0.9), inset -0.05em -0.06em 0 rgba(180, 110, 0, 0.5); }

/* ---- info card: 3 missions + multiplier + streak, next unlock goal ---- */
.fm-info {
  flex: none; width: min(calc(100% - 24px), 380px); margin: 0 auto 10px; padding: 7px 9px 8px; display: flex; flex-direction: column; gap: 5px; cursor: pointer; text-align: left;
  border-radius: 20px; border: 3px solid var(--ink); background: linear-gradient(180deg, rgba(36, 70, 128, 0.9), rgba(14, 30, 64, 0.92)); box-shadow: 0 4px 0 var(--ink2), 0 8px 14px rgba(10, 30, 60, 0.3);
}
.fm-info:active { transform: translateY(2px); }
.fm-info { margin-bottom: 16px; position: relative; z-index: 0; flex-shrink: 0; overflow: visible; }
.fm-globe { position: absolute; left: 10px; bottom: 14px; z-index: 3; width: 58px; height: 58px; padding: 0; display: grid; place-items: center; cursor: pointer; border-radius: 50%; border: 3px solid var(--ink); background: radial-gradient(ellipse 55% 40% at 36% 24%, rgba(255,255,255,0.85), rgba(255,255,255,0) 70%), linear-gradient(180deg, #bfe6ff, #5aa6f0); box-shadow: 0 4px 0 var(--ink2), 0 8px 10px rgba(10,30,60,0.35); font-size: 30px; line-height: 1; text-shadow: none; pointer-events: auto; }
.fm-globe .gl { display: block; }
.fm-globe.used { filter: grayscale(0.7) brightness(0.85); }
.fm-globe .glt { position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%); padding: 1px 6px 2px; border-radius: 8px; background: var(--ink); color: #fff; font-size: 9.5px; letter-spacing: 0.04em; white-space: nowrap; }
.fm-globe .fm-bdg { top: -7px; right: -5px; }
.fm-globe.shk .gl { animation: fmGlobeShake 0.7s ease-in-out; }
.fm-globe.ready { animation: fmDlWob 1.6s ease-in-out infinite; }
@keyframes fmGlobeShake { 0%,100% { transform: rotate(0) scale(1); } 12% { transform: rotate(-24deg) translateX(-3px) scale(1.15); } 30% { transform: rotate(22deg) translateX(3px) scale(1.15); } 48% { transform: rotate(-18deg) scale(1.12); } 66% { transform: rotate(14deg) scale(1.1); } 84% { transform: rotate(-6deg) scale(1.05); } }
.fm-bot { position: relative; z-index: 1; padding-top: 4px; }
.fm-secrow { padding-top: 6px; }
.fm-passb { position: absolute; right: 12px; top: calc(var(--sat, env(safe-area-inset-top, 0px)) + 62px); z-index: 3; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; border: 3px solid var(--ink); background: linear-gradient(180deg, #7fe0ff, #2f8fe0); box-shadow: 0 4px 0 var(--ink2); font-size: 22px; line-height: 1; cursor: pointer; padding: 0; text-shadow: none; }
.fm-passb:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink2); }
.fm-passb .fm-bdg { top: -6px; right: -6px; }
.fm-toast.tap { pointer-events: auto; cursor: pointer; }
.fm-ihead { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; letter-spacing: 0.12em; color: #cfe2ff; text-shadow: var(--ol-sm); }
.fm-chips { display: flex; gap: 5px; }
.fm-ichip { display: flex; align-items: center; gap: 3px; height: 21px; padding: 0 8px; border-radius: 11px; border: 2.5px solid var(--ink); background: rgba(255, 255, 255, 0.14); font-size: 12.5px; line-height: 1; letter-spacing: 0; color: #fff; text-shadow: none; white-space: nowrap; }
.fm-ichip.mult { background: linear-gradient(180deg, #ffe27a, var(--gold)); color: var(--ink); }
.fm-mrows { display: flex; flex-direction: column; gap: 4px; }
.fm-mr { display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 8px; border-radius: 10px; background: rgba(255, 255, 255, 0.09); font-size: 12.5px; text-shadow: none; }
.fm-mr .mi { flex: none; font-size: 14px; line-height: 1; }
.fm-mr .mt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; letter-spacing: 0.01em; }
.fm-mr .mb { flex: none; width: 52px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.2); overflow: hidden; }
.fm-mr .mb i { display: block; height: 100%; background: linear-gradient(90deg, #8dff9a, #2fc13f); }
.fm-mr .mn { flex: none; min-width: 34px; text-align: right; font-size: 11px; color: #cfe2ff; }
.fm-mr.done { background: rgba(255, 207, 58, 0.22); }
.fm-mr.claim { background: rgba(255, 207, 58, 0.34); animation: fmGlowPulse 1.4s ease-in-out infinite; }
.fm-mr.got { opacity: 0.6; }
.fm-ichip.hot { background: linear-gradient(180deg, #ff9a52, var(--orange)); animation: fmGlowPulse 1.4s ease-in-out infinite; cursor: pointer; }
@keyframes fmGlowPulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.25); } }
@keyframes fmIdleBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.fm-main .fm-play { animation: fmIdleBob 2.6s ease-in-out infinite; }
.fm-main .fm-arena .ico { display: inline-block; animation: fmIdleBob 3.1s ease-in-out infinite; }
.fm-dt-row .fm-aico { font-size: 22px; }
.fm-dt-t { font-size: 12px; color: #5a7196; text-align: center; margin: 4px 0 8px; letter-spacing: 0.06em; }
.fm-rec { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 10px 12px; border-radius: 16px; border: 3px solid var(--ink); background: linear-gradient(180deg, #fff, #e6f0ff); color: var(--ink); text-shadow: none; box-shadow: 0 4px 0 var(--ink); margin-bottom: 8px; }
.fm-rec h4 { grid-column: 1 / -1; margin: 0; font-size: 15px; }
.fm-rec div { font-size: 12px; color: #5a7196; } .fm-rec b { display: block; font-size: 18px; color: var(--orange-dark); }
@media (prefers-reduced-motion: reduce) { .fm-main .fm-play, .fm-main .fm-arena .ico, .fm-mr.claim, .fm-ichip.hot { animation: none; } }
.fm-mr.done .mn { color: var(--gold); }
.fm-mr.done .mb i { background: linear-gradient(90deg, #fff3a8, var(--gold)); }
.fm-hgoal { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border-radius: 10px; border: 2px dashed rgba(255, 255, 255, 0.28); width: 100%; background: none; cursor: pointer; font-size: 12.5px; color: #fff; text-align: left; }
.fm-hgoal .gi { flex: none; font-size: 15px; line-height: 1; }
.fm-hgoal .gn { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0.01em; text-shadow: none; }
.fm-hgoal .gb { flex: none; width: 54px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.2); overflow: hidden; }
.fm-hgoal .gb i { display: block; height: 100%; background: linear-gradient(90deg, #ffe066, #ff9a3a); }
.fm-hgoal .gc { flex: none; font-size: 11.5px; color: var(--gold); text-shadow: none; white-space: nowrap; }
.fm-sgoal { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; margin: 0 auto 8px; width: min(calc(100% - 24px), 380px); box-sizing: border-box; border-radius: 14px; border: 2.5px solid var(--ink); background: #fff; color: var(--ink); font-size: 13px; font-weight: 800; cursor: pointer; text-align: left; text-shadow: none; flex: none; }
.fm-sgoal .sg-t { flex: none; font-size: 10.5px; letter-spacing: 0.06em; opacity: 0.85; }
.fm-sgoal .sg-n { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fm-sgoal .sg-b { flex: none; width: 56px; height: 9px; border-radius: 5px; background: rgba(0, 0, 0, 0.15); overflow: hidden; }
.fm-sgoal .sg-b i { display: block; height: 100%; background: linear-gradient(90deg, #ffb300, #ff7a1a); }
.fm-sgoal .sg-c { flex: none; font-size: 11.5px; white-space: nowrap; }
.fm-sgoal.claim { background: #ffd84a; animation: fmPulseG 1.4s ease-in-out infinite; }
@keyframes fmPulseG { 50% { transform: scale(1.03); } }
.fm-tchip.red { background: #e5293a; color: #fff; border-color: #7a0f1a; }
.fm-hgoal.ready { border-color: #8dff9a; }
.fm-hgoal.ready .gc { color: #8dff9a; }
.fm-hgoal.ready .gb i { background: linear-gradient(90deg, #8dff9a, #2fc13f); }

/* ---- bottom: OYNA (straight into YETİ RUSH) + 5 small buttons ---- */
.fm-bot { flex: none; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 0 14px calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 14px); }
.fm-playw { width: min(100%, 380px); animation: fmBreath 1.8s ease-in-out infinite; }
@keyframes fmBreath { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
.fm-play {
  position: relative; overflow: hidden; width: 100%; min-height: 84px; padding: 4px 0 8px; cursor: pointer; border: 4px solid var(--ink); border-radius: 28px; font-size: 50px; line-height: 0.95; letter-spacing: 0.05em; color: #fff;
  background: linear-gradient(180deg, #f0ff6a 0%, #a6ec35 42%, #55c61f 100%); box-shadow: 0 8px 0 #2f7a14, 0 12px 16px rgba(10, 30, 60, 0.4), inset 0 4px 0 rgba(255, 255, 255, 0.6), inset 0 -5px 0 rgba(0, 0, 0, 0.1);
  text-shadow: 0 3px 0 var(--ink), 3px 3px 0 var(--ink), -3px 3px 0 var(--ink), 3px -3px 0 var(--ink), -3px -3px 0 var(--ink), 0 -3px 0 var(--ink), 3px 0 0 var(--ink), -3px 0 0 var(--ink), 0 8px 8px rgba(10, 30, 60, 0.35);
  transition: transform 0.06s, box-shadow 0.06s;
}
.fm-play small { display: block; margin-top: 4px; font-size: 14px; letter-spacing: 0.2em; color: #1f4a0d; text-shadow: none; opacity: 0.9; }
.fm-play::after { content: ""; position: absolute; top: -20%; bottom: -20%; left: -60%; width: 34%; background: linear-gradient(100deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0)); transform: skewX(-20deg); animation: fmShine 3.8s ease-in-out infinite; pointer-events: none; }
@keyframes fmShine { 0%, 55% { left: -60%; } 80%, 100% { left: 130%; } }
.fm-play:active { transform: translateY(6px); box-shadow: 0 2px 0 #2f7a14, 0 4px 8px rgba(10, 30, 60, 0.3), inset 0 4px 0 rgba(255, 255, 255, 0.6); }
.fm-secrow { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 2px; width: min(100%, 400px); align-items: start; }
.fm-sb { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; width: 100%; min-width: 0; margin: 0; gap: 3px; padding: 0; border: 0; background: none; cursor: pointer; --c1: #ffb347; --c2: #ff7a2f; --sh: #a8400f; }
.fm-sb .ic {
  position: relative; width: 46px; height: 46px; flex: none; display: grid; place-items: center; border-radius: 50%; border: 3px solid var(--ink); font-size: 22px; line-height: 1; text-shadow: none;
  background: radial-gradient(ellipse 60% 38% at 36% 22%, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0)), linear-gradient(180deg, var(--c1), var(--c2));
  box-shadow: 0 4px 0 var(--sh), 0 8px 10px rgba(10, 30, 60, 0.35), inset 0 -4px 0 rgba(0, 0, 0, 0.14); transition: transform 0.06s, box-shadow 0.06s;
}
.fm-sb:active .ic { transform: translateY(3px); box-shadow: 0 1px 0 var(--sh), 0 3px 5px rgba(10, 30, 60, 0.3), inset 0 -4px 0 rgba(0, 0, 0, 0.14); }
.fm-sb .lb { font-size: 11px; height: 12px; line-height: 1.05; color: #fff; text-shadow: 0 1.5px 0 var(--ink), 1px 1px 0 var(--ink), -1px 1px 0 var(--ink), 1px -1px 0 var(--ink), -1px -1px 0 var(--ink); white-space: nowrap; text-align: center; letter-spacing: 0.01em; }
.fm-sb.c-cig { --c1: #c79bff; --c2: #7a3cf0; --sh: #4b1fa8; }
.fm-sb.c-map { --c1: #7dc4ff; --c2: #2f7dff; --sh: #1b4fae; }
.fm-sb.c-shop { --c1: #ff8fb8; --c2: #ff4f8b; --sh: #a3204f; }
.fm-sb.c-mis { --c1: #6cdc8a; --c2: #2fc13f; --sh: #1b7a2a; }
.fm-sb.c-pass { --c1: #7fe0ff; --c2: #2f8fe0; --sh: #1b5a9a; }
.fm-sb.c-set { --c1: #9fb2d0; --c2: #5f78a3; --sh: #34486e; }
.fm-bdg {
  position: absolute; top: -6px; right: -4px; min-width: 24px; height: 24px; padding: 0 6px; display: grid; place-items: center; border-radius: 12px; border: 2.5px solid var(--ink);
  background: linear-gradient(180deg, #ff7a7a, var(--red)); color: #fff; font-size: 13px; line-height: 1; pointer-events: none; box-shadow: 0 2px 0 var(--ink2); text-shadow: none;
}
.fm-bdg.dot { min-width: 20px; height: 20px; padding: 0; border-radius: 50%; font-size: 12px; }
.fm-bdg.gold { background: linear-gradient(180deg, #ffe27a, var(--gold)); color: var(--ink); }
.fm-bdg.pulse { animation: fmPulse 0.9s ease-in-out infinite alternate; }
.fm-bdg.off { display: none; }
@keyframes fmPulse { from { transform: scale(1); } to { transform: scale(1.22); } }
.fm-xchip {
  position: absolute; right: -4px; bottom: 14px; min-width: 30px; height: 22px; padding: 0 6px; display: grid; place-items: center; border-radius: 11px; border: 2.5px solid var(--ink);
  background: linear-gradient(180deg, #ffe27a, var(--gold)); color: var(--ink); font-size: 13px; line-height: 1; text-shadow: none; box-shadow: 0 2px 0 var(--ink2); transform: rotate(6deg); pointer-events: none;
}

.fm-main.fm-starting > * { pointer-events: none; }
.fm-main.fm-starting .fm-play { filter: brightness(0.92); transform: translateY(5px); box-shadow: 0 3px 0 #2f7a14; }
.fm-main.enter .fm-top { animation: fmDrop 0.5s cubic-bezier(.2, 1.3, .4, 1) backwards; }
.fm-main.enter .fm-logorow { animation: fmDrop 0.5s cubic-bezier(.2, 1.3, .4, 1) 0.08s backwards; }
.fm-main.enter .fm-best { animation: fmPopIn 0.55s cubic-bezier(.2, 1.4, .4, 1) 0.3s backwards, fmBubble 3.2s ease-in-out 0.9s infinite alternate; }
.fm-main.enter .fm-info { animation: fmUp 0.5s cubic-bezier(.2, 1.3, .4, 1) 0.1s backwards; }
.fm-main.enter .fm-playw { animation: fmUp 0.55s cubic-bezier(.2, 1.3, .4, 1) 0.18s backwards, fmBreath 1.8s ease-in-out 0.8s infinite; }
.fm-main.enter .fm-sb { animation: fmPopIn 0.5s cubic-bezier(.2, 1.4, .4, 1) backwards; }
.fm-main.enter .fm-sb:nth-child(2) { animation-delay: 0.05s; } .fm-main.enter .fm-sb:nth-child(3) { animation-delay: 0.1s; }
.fm-main.enter .fm-sb:nth-child(4) { animation-delay: 0.15s; } .fm-main.enter .fm-sb:nth-child(5) { animation-delay: 0.2s; }

@media (max-height: 760px) {
  .fm-logo { font-size: clamp(38px, 12.4vw, 54px); min-height: 46px; }
  .fm-logorow { margin-top: 2px; }
  .fm-tag { display: none; }
  .fm-play { min-height: 70px; font-size: 42px; }
  .fm-sb .ic { width: 42px; height: 42px; font-size: 19px; }
  .fm-best { top: 14px; }
  .fm-bot { gap: 9px; padding-bottom: calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 10px); }
  .fm-info { margin-bottom: 8px; gap: 4px; }
  .fm-mr { height: 23px; }
  .fm-best .bv { font-size: 21px; }
}
@media (max-height: 680px) {
  .fm-info { margin-bottom: 14px; padding: 5px 8px 6px; }
  .fm-hgoal { display: none; }
  .fm-mrows .fm-mr:nth-child(n+3) { display: none; }
  .fm-ihead { display: none; }
  .fm-sb .lb { font-size: 10px; }
  .fm-sb .ic { width: 38px; height: 38px; font-size: 17px; }
  .fm-bot { gap: 7px; }
  .fm-secrow { padding-top: 2px; }
  .fm-best .bs { display: none; }
}
@media (max-height: 590px) {
  .fm-info { display: none; }
}
@media (max-width: 350px) {
  .fm-cur .num { font-size: 14px; min-width: 24px; }
  .fm-play { font-size: 40px; }
  .fm-sb .ic { width: 36px; height: 36px; }
  .fm-sb .lb { font-size: 9.5px; letter-spacing: 0; }
  .fm-sb .lb { font-size: 11px; }
}

/* =============================================================== PANELS */
.fm-ov {
  position: absolute; inset: 0; z-index: 60; display: flex; flex-direction: column;
  padding-top: calc(var(--sat, env(safe-area-inset-top, 0px)) + 10px);
  background: linear-gradient(180deg, rgba(118, 183, 250, 0.98) 0%, rgba(188, 224, 255, 0.99) 55%, rgba(233, 245, 255, 0.99) 100%);
  animation: fmIn 0.22s ease-out;
}
@keyframes fmIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.fm-head { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; width: 100%; max-width: 520px; margin: 0 auto; padding: 0 16px; }
.fm-titles { flex: 1 1 140px; min-width: 0; }
.fm-title { font-size: clamp(26px, 8.8vw, 36px); line-height: 1; transform: rotate(-2deg); transform-origin: left center; white-space: nowrap; overflow: visible; text-shadow: var(--ol); }
.fm-title.long { font-size: clamp(22px, 7vw, 30px); }
.fm-sub { margin-top: 7px; min-height: 14px; font-size: 13px; letter-spacing: 0.1em; color: var(--ink); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55); }
.fm-x {
  order: 2; flex: none; width: 46px; height: 46px; padding: 0; border-radius: 15px; border: 3px solid var(--ink); cursor: pointer; font-size: 19px; line-height: 1; color: #fff; text-shadow: var(--ol-sm);
  background: linear-gradient(180deg, #ff8a8a, #e63b3b); box-shadow: 0 4px 0 #8f1c1c, inset 0 3px 0 rgba(255, 255, 255, 0.45); transition: transform 0.06s, box-shadow 0.06s;
}
.fm-x:active { transform: translateY(3px); box-shadow: 0 1px 0 #8f1c1c; }
.fm-pills { order: 3; flex: 1 0 100%; display: flex; gap: 8px; }
.fm-pill {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px 6px 9px; border-radius: 17px; min-height: 36px; border: 3px solid var(--ink);
  background: linear-gradient(180deg, rgba(34, 66, 120, 0.9), rgba(10, 25, 55, 0.9)); box-shadow: 0 3px 0 var(--ink2), inset 0 2px 0 rgba(255, 255, 255, 0.16);
  font-size: 18px; line-height: 1; color: var(--gold); white-space: nowrap; text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
}
.fm-pill .ico { font-size: 16px; text-shadow: none; }
.fm-pill.cr { color: #9be7ff; }
.fm-pill.bump { animation: fmBump 0.4s cubic-bezier(.2, 1.8, .4, 1); }
.fm-tabs { flex: none; display: flex; gap: 8px; width: 100%; max-width: 520px; margin: 12px auto 4px; padding: 0 16px; }
.fm-tab {
  flex: 1; min-height: 46px; padding: 8px 2px 7px; cursor: pointer; border-radius: 16px; border: 3px solid var(--ink); background: linear-gradient(180deg, #ffffff, #d7e8fb);
  color: var(--ink); font-size: 15px; letter-spacing: 0.05em; text-shadow: none; box-shadow: 0 4px 0 var(--ink); transition: transform 0.06s, box-shadow 0.06s;
}
.fm-tab.on { background: linear-gradient(180deg, #ffb06a, var(--orange)); color: #fff; text-shadow: var(--ol-sm); transform: translateY(2px); box-shadow: 0 2px 0 var(--ink); }
.fm-body { flex: 1; min-height: 0; margin-top: 8px; overflow-y: auto; overflow-x: hidden; touch-action: pan-y; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 6px 0 calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 28px); }
.fm-body.fm-mapbody { overflow: hidden; display: flex; flex-direction: column; padding: 0 0 calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 8px); margin-top: 4px; touch-action: pan-y; }
.fm-list { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 520px; margin: 0 auto; padding: 4px 16px 0; }

/* buttons */
.fm-btn {
  --b1: #ffb06a; --b2: var(--orange); --bs: var(--orange-dark);
  flex: none; min-height: 46px; padding: 9px 14px 8px; cursor: pointer; border: 3px solid var(--ink); border-radius: 16px; font-size: 16px; letter-spacing: 0.04em; color: #fff; white-space: nowrap;
  background: linear-gradient(180deg, var(--b1), var(--b2)); box-shadow: 0 5px 0 var(--bs), 0 7px 8px rgba(10, 30, 60, 0.28), inset 0 3px 0 rgba(255, 255, 255, 0.45), inset 0 -3px 0 rgba(0, 0, 0, 0.1);
  text-shadow: var(--ol-sm); transition: transform 0.06s, box-shadow 0.06s;
}
.fm-btn:active { transform: translateY(4px); box-shadow: 0 1px 0 var(--bs), 0 2px 4px rgba(10, 30, 60, 0.25), inset 0 3px 0 rgba(255, 255, 255, 0.45); }
.fm-btn.big { width: 100%; font-size: 24px; min-height: 58px; padding: 12px 14px 11px; border-radius: 20px; }
.fm-btn.blue { --b1: #7dc4ff; --b2: var(--blue); --bs: var(--blue-dark); }
.fm-btn.green { --b1: #a6ec6a; --b2: #35c46a; --bs: #1e8a49; }
.fm-btn.poor, .fm-btn.lock { --b1: #cfd8e6; --b2: #98a7bb; --bs: #6d7c92; }
.fm-btn.on { --b1: #fff0a0; --b2: var(--gold); --bs: #c99700; color: var(--ink); text-shadow: none; cursor: default; }
.fm-btn.sm { min-height: 46px; min-width: 56px; padding: 6px 10px; font-size: 15px; }
.fm-btn.glow { animation: fmBtnGlow 0.9s ease-in-out infinite alternate; }
@keyframes fmBtnGlow { from { filter: brightness(1); } to { filter: brightness(1.12) drop-shadow(0 0 8px rgba(255, 224, 80, 0.9)); } }
.fm-shake { animation: fmShake 0.32s; }
@keyframes fmShake { 0%, 100% { transform: none; } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
.fm-popc { animation: fmPop 0.6s cubic-bezier(.2, 1.8, .4, 1); }
@keyframes fmPop { 0% { transform: scale(0.85) rotate(-3deg); } 40% { transform: scale(1.1) rotate(2deg); } 100% { transform: none; } }

/* generic row card */
.fm-row {
  position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 20px; border: 3px solid var(--ink);
  background: linear-gradient(180deg, #ffffff, #e2f0ff); box-shadow: 0 5px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.9); color: var(--ink); text-shadow: none;
}
.fm-row.done { background: linear-gradient(180deg, #fff9dc, #ffe9a2); box-shadow: 0 5px 0 var(--ink), 0 0 0 3px var(--gold), 0 0 16px 3px rgba(255, 207, 58, 0.5); }
.fm-row.claimed { opacity: 0.72; }
.fm-row.secret { background: linear-gradient(180deg, #eef1f7, #d5dbe8); }
.fm-aico { flex: none; width: 46px; height: 46px; display: grid; place-items: center; font-size: 25px; line-height: 1; border-radius: 15px; background: rgba(23, 52, 92, 0.1); border: 2.5px solid var(--ink); }
.fm-amid { flex: 1; min-width: 0; }
.fm-an { font-size: 16px; line-height: 1.15; }
.fm-ad { margin-top: 2px; font-size: 12.5px; color: #5a7196; line-height: 1.25; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-weight: 800; letter-spacing: 0; }
.fm-abar { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.fm-bar { position: relative; flex: 1; height: 12px; border-radius: 7px; background: rgba(23, 52, 92, 0.18); border: 2px solid var(--ink); overflow: hidden; }
.fm-bar i { position: absolute; left: 0; top: 0; bottom: 0; width: var(--p, 0%); background: linear-gradient(180deg, #8dff9a, var(--green)); box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.45); }
.fm-row.done .fm-bar i { background: linear-gradient(180deg, #fff3a8, var(--gold)); }
.fm-bn { flex: none; font-size: 12px; color: #5a7196; }
.fm-ar { margin-top: 5px; font-size: 13px; color: var(--orange-dark); }
.fm-ok { flex: none; font-size: 24px; color: var(--green); text-shadow: none; }

/* ---- daily ---- */
.fm-streak { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 20px; border: 3px solid var(--ink); background: linear-gradient(180deg, #fff, #ffe9c9); box-shadow: 0 5px 0 var(--ink); color: var(--ink); text-shadow: none; }
.fm-streak .fl { font-size: 34px; line-height: 1; }
.fm-streak .st { font-size: 21px; line-height: 1.1; }
.fm-streak .sd { margin-top: 2px; font-size: 12.5px; color: #5a7196; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-weight: 800; letter-spacing: 0; }
.fm-dgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 10px; }
.fm-dcard {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; min-height: 124px; border-radius: 20px; text-shadow: none;
  border: 3px solid var(--ink); background: linear-gradient(180deg, #ffffff, #e2f0ff); box-shadow: 0 5px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.9); color: var(--ink); text-align: center;
}
.fm-dcard.big { grid-column: 1 / -1; flex-direction: row; justify-content: center; gap: 14px; min-height: 96px; background: linear-gradient(180deg, #fff0ff, #e7d6ff); }
.fm-dcard .dl { font-size: 13px; letter-spacing: 0.08em; color: #5a7196; }
.fm-dcard .di { font-size: 34px; line-height: 1.1; min-height: 38px; display: grid; place-items: center; }
.fm-dcard .dv { font-size: 20px; line-height: 1; }
.fm-dcard .dx { font-size: 13px; color: #1b7fa8; }
.fm-dcard .dn { font-size: 13px; line-height: 1.1; max-width: 100%; padding: 0 2px; }
.fm-dcard .dst { margin-top: auto; font-size: 14px; min-height: 18px; }
.fm-dcard.claimed { background: linear-gradient(180deg, #e6ffee, #c3f1d2); }
.fm-dcard.claimed .dst { color: var(--green); font-size: 22px; }
.fm-dcard.locked { filter: grayscale(0.55); opacity: 0.8; }
.fm-dcard.today { background: linear-gradient(180deg, #fff9dc, #ffe9a2); animation: fmToday 0.9s ease-in-out infinite alternate; }
.fm-dcard.today .dst { color: #fff; background: linear-gradient(180deg, #ffb06a, var(--orange)); border: 2.5px solid var(--ink); border-radius: 12px; padding: 3px 14px; font-size: 15px; text-shadow: var(--ol-sm); box-shadow: 0 2px 0 var(--orange-dark); }
@keyframes fmToday { from { box-shadow: 0 5px 0 var(--ink), 0 0 0 3px var(--gold), 0 0 8px 2px rgba(255, 207, 58, 0.4); } to { box-shadow: 0 5px 0 var(--ink), 0 0 0 3px var(--gold), 0 0 22px 7px rgba(255, 207, 58, 0.9); } }
.fm-prev { flex: none; width: 46px; height: 46px; border-radius: 50%; border: 3px solid var(--ink); box-shadow: 0 3px 0 var(--ink); }
.fm-prev.trail { width: 62px; height: 24px; border-radius: 14px 8px 8px 14px; }
.fm-cd { text-align: center; color: var(--ink); font-size: 15px; letter-spacing: 0.06em; line-height: 1.5; text-shadow: none; }
.fm-cd b { display: block; font-size: 32px; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }

/* ---- settings / stats ---- */
.fm-sw { position: relative; flex: none; width: 60px; height: 36px; padding: 0; cursor: pointer; border-radius: 18px; border: 3px solid var(--ink); background: #aab6c8; box-shadow: inset 0 3px 0 rgba(0, 0, 0, 0.15); transition: background 0.15s; }
.fm-sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(180deg, #fff, #dfe8f4); border: 2.5px solid var(--ink); transition: transform 0.15s; }
.fm-sw.on { background: linear-gradient(180deg, #7be89d, var(--green)); }
.fm-sw.on::after { transform: translateX(24px); }
.fm-tgl { font-size: 18px; flex: 1; }
.fm-sec { margin: 6px 4px 0; font-size: 14px; letter-spacing: 0.12em; color: var(--ink); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55); }
.fm-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.fm-stat { padding: 9px 10px; border-radius: 16px; border: 3px solid var(--ink); background: rgba(255, 255, 255, 0.88); box-shadow: 0 4px 0 var(--ink); color: var(--ink); text-shadow: none; }
.fm-stat b { display: block; font-size: 21px; line-height: 1.1; }
.fm-stat span { font-size: 11.5px; color: #5a7196; letter-spacing: 0.03em; }
.fm-credits { padding: 12px 14px; border-radius: 18px; border: 3px solid var(--ink); background: rgba(255, 255, 255, 0.72); color: var(--ink); font-size: 12.5px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-weight: 800; letter-spacing: 0; line-height: 1.5; text-shadow: none; }
.fm-credits em { display: block; margin-top: 6px; font-style: normal; font-weight: 900; opacity: 0.6; }

/* ---- missions ---- */
.fm-mult {
  flex: none; min-width: 46px; height: 46px; padding: 0 6px; display: grid; place-items: center; border-radius: 50%; transform: rotate(8deg); border: 3px solid var(--ink);
  background: radial-gradient(circle at 35% 30%, #fff3a8, var(--gold) 60%, #f0a500); box-shadow: 0 3px 0 var(--ink); color: var(--ink); font-size: 18px; line-height: 1; text-shadow: none;
}
.fm-multbig { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 22px; border: 3px solid var(--ink); background: linear-gradient(180deg, #fff9dc, #ffe39a); box-shadow: 0 5px 0 var(--ink); color: var(--ink); text-shadow: none; }
.fm-multbig .fm-mult { min-width: 84px; height: 84px; font-size: 40px; border-width: 4px; box-shadow: 0 4px 0 var(--ink), 0 0 0 5px rgba(255, 207, 58, 0.45); }
.fm-multbig .mt { font-size: 19px; line-height: 1.15; }
.fm-multbig .ms { margin-top: 4px; font-size: 12.5px; color: #6b5a1e; line-height: 1.35; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-weight: 800; letter-spacing: 0; }
.fm-mrow .fm-an { font-size: 15px; }
.fm-skip { flex: none; min-height: 46px; min-width: 54px; padding: 4px 8px; cursor: pointer; border-radius: 14px; border: 3px solid var(--ink); background: linear-gradient(180deg, #fff, #d7e8fb); color: var(--ink); font-size: 11px; line-height: 1.15; text-shadow: none; box-shadow: 0 4px 0 var(--ink); }
.fm-skip b { display: block; font-size: 19px; }
.fm-skip:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
.fm-note { text-align: center; color: var(--ink); font-size: 13px; line-height: 1.4; padding: 0 6px; text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55); }

/* ---- upgrades ---- */
.fm-pips { display: flex; gap: 4px; margin-top: 6px; }
.fm-pips i { width: 20px; height: 10px; border-radius: 5px; border: 2px solid var(--ink); background: rgba(23, 52, 92, 0.15); }
.fm-pips i.on { background: linear-gradient(180deg, #fff3a8, var(--gold)); }
.fm-up .fm-btn { min-width: 86px; }

/* ---- hunt ---- */
.fm-word { display: flex; justify-content: center; gap: 6px; padding: 6px 0; }
.fm-word .fm-chip { flex: 1 1 0; width: auto; min-width: 0; max-width: 42px; height: 54px; font-size: 27px; border-radius: 13px; background: rgba(23, 52, 92, 0.18); color: rgba(23, 52, 92, 0.5); text-shadow: none; }
.fm-word .fm-chip.got { color: var(--ink); background: linear-gradient(180deg, #fff3a8, var(--gold)); }
.fm-word .fm-chip.next { color: var(--ink); }

/* =============================================================== CAMPAIGN MAP */
.fm-actnav { flex: none; display: flex; align-items: center; gap: 10px; width: 100%; max-width: 520px; margin: 0 auto; padding: 4px 16px 6px; }
.fm-arrow {
  flex: none; width: 46px; height: 46px; padding: 0; cursor: pointer; border-radius: 15px; border: 3px solid var(--ink); font-size: 20px; line-height: 1; color: #fff; text-shadow: var(--ol-sm);
  background: linear-gradient(180deg, #7dc4ff, var(--blue)); box-shadow: 0 4px 0 var(--blue-dark), inset 0 3px 0 rgba(255, 255, 255, 0.45); transition: transform 0.06s, box-shadow 0.06s;
}
.fm-arrow:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--blue-dark); }
.fm-arrow.off { opacity: 0.35; }
.fm-dots { flex: 1; display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; }
.fm-dots i { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--ink); background: rgba(255, 255, 255, 0.7); transition: transform 0.2s, background 0.2s; }
.fm-dots i.on { background: var(--gold); transform: scale(1.4); }
.fm-dots i.lk { background: rgba(23, 52, 92, 0.35); }
.fm-viewport { position: relative; flex: 1; min-height: 0; overflow: hidden; touch-action: pan-y; }
.fm-track { display: flex; height: 100%; width: 1000%; transition: transform 0.32s cubic-bezier(.2, .9, .3, 1); will-change: transform; }
.fm-track.drag { transition: none; }
.fm-page { flex: 0 0 10%; min-width: 0; height: 100%; padding: 0 12px; overflow-y: auto; overflow-x: hidden; touch-action: pan-y; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.fm-pagein {
  position: relative; width: 100%; max-width: 480px; margin: 0 auto; min-height: 100%; padding-bottom: 20px; border-radius: 24px; border: 3px solid var(--ink); overflow: hidden;
  background: linear-gradient(180deg, var(--ca) 0%, var(--cb) 55%, var(--cc) 100%); box-shadow: 0 5px 0 var(--ink);
}
.fm-acthero { position: relative; padding: 14px 16px 10px; display: flex; align-items: center; gap: 12px; }
.fm-acthero .big { flex: none; font-size: 46px; line-height: 1; text-shadow: none; filter: drop-shadow(0 3px 0 rgba(10, 30, 60, 0.4)); }
.fm-acthero .t1 { font-size: 14px; letter-spacing: 0.14em; opacity: 0.95; text-shadow: var(--ol-sm); }
.fm-acthero .t2 { font-size: 28px; line-height: 1.05; text-shadow: var(--ol); }
.fm-acthero .st { margin-left: auto; flex: none; padding: 5px 10px; border-radius: 14px; border: 2.5px solid var(--ink); background: rgba(10, 25, 55, 0.62); font-size: 15px; white-space: nowrap; }
.fm-lockedbar { margin: 0 14px; padding: 6px 10px; border-radius: 12px; border: 2.5px solid var(--ink); background: rgba(10, 25, 55, 0.62); font-size: 13px; text-align: center; }
.fm-path { position: relative; width: calc(100% - 20px); max-width: 360px; height: 480px; margin: 10px auto 0; }
.fm-path svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.fm-path svg path { fill: none; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.fm-path .base { stroke: rgba(10, 25, 55, 0.35); stroke-width: 7px; stroke-dasharray: 1 14; }
.fm-path .prog { stroke: var(--gold); stroke-width: 7px; stroke-dasharray: 1 14; }
.fm-node {
  --nc1: #ffffff; --nc2: #cfe2f7; --nsh: #7d96b8; position: absolute; transform: translate(-50%, -50%); width: 56px; height: 56px; padding: 0; cursor: pointer; border-radius: 50%; border: 3px solid var(--ink);
  display: grid; place-items: center; font-size: 22px; line-height: 1; color: #fff; text-shadow: var(--ol-sm);
  background: radial-gradient(ellipse 60% 36% at 36% 22%, rgba(255, 255, 255, 0.65), rgba(255, 255, 255, 0)), linear-gradient(180deg, var(--nc1), var(--nc2));
  box-shadow: 0 5px 0 var(--nsh), 0 8px 8px rgba(10, 30, 60, 0.3), inset 0 -4px 0 rgba(0, 0, 0, 0.12); transition: box-shadow 0.06s;
}
.fm-node:active { box-shadow: 0 1px 0 var(--nsh), 0 3px 4px rgba(10, 30, 60, 0.3); }
.fm-node.done { --nc1: #ffe27a; --nc2: #ffae00; --nsh: #b36f00; color: var(--ink); text-shadow: none; }
.fm-node.cur { --nc1: #a6ec6a; --nc2: #35c46a; --nsh: #1e8a49; animation: fmNode 1s ease-in-out infinite alternate; }
.fm-node.lk { --nc1: #b8c3d4; --nc2: #8392aa; --nsh: #55647e; filter: saturate(0.6); }
.fm-node.lk .n { opacity: 0.85; font-size: 19px; }
.fm-node.far { opacity: 0.55; filter: saturate(0.3); }
.fm-node.far .n { font-size: 17px; }
.fm-node .nm { position: absolute; left: 50%; top: calc(100% + 2px); transform: translateX(-50%); max-width: 92px; padding: 1px 6px; border-radius: 8px; background: rgba(10, 25, 55, 0.62); color: #fff; font-size: 10px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: none; pointer-events: none; }
.fm-node .yav { position: absolute; left: 50%; top: -22px; transform: translateX(-50%); width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; border: 2px solid var(--ink); background: #fff; font-size: 14px; line-height: 1; text-shadow: none; pointer-events: none; }
.fm-node.bonus { width: 50px; height: 50px; --nc1: #e9b8ff; --nc2: #a24cff; --nsh: #5a1fa8; animation: fmBonusGlow 1.4s ease-in-out infinite alternate; }
.fm-node.bonus.lk { --nc1: #9a8fb0; --nc2: #6c6285; --nsh: #3f3656; animation: none; }
.fm-node.bonus.done { --nc1: #ffe27a; --nc2: #ffae00; --nsh: #b36f00; animation: none; }
.fm-node.bonus .bn { position: absolute; left: 50%; top: -17px; transform: translateX(-50%); font-size: 10px; letter-spacing: 0.06em; white-space: nowrap; color: #fff; text-shadow: var(--ol-sm); }
@keyframes fmBonusGlow { from { box-shadow: 0 5px 0 var(--nsh), 0 0 6px 1px rgba(200, 120, 255, 0.5); } to { box-shadow: 0 5px 0 var(--nsh), 0 0 18px 6px rgba(220, 150, 255, 0.95); } }
.fm-path .bbr { stroke: #d89bff; stroke-width: 4px; stroke-dasharray: 2 9; opacity: 0.9; }
.fm-bonushd { flex: none; margin: 0 auto 4px; padding: 4px 12px; border-radius: 12px; border: 2.5px solid var(--ink); background: linear-gradient(180deg, #b36bff, #7a35d6); color: #fff; font-size: 12.5px; text-shadow: var(--ol-sm); text-align: center; white-space: nowrap; }
.fm-stormhd { flex: none; margin: 0 auto 4px; padding: 4px 14px; border-radius: 14px; border: 2.5px solid #ff9d1a; background: rgba(14, 22, 48, 0.88); color: #fff; font-weight: 900; text-shadow: 0 1px 0 rgba(0,0,0,0.5); font-size: 14px; text-align: center; white-space: nowrap; max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; }
.fm-node.storm .sx { position: absolute; right: -14px; top: -10px; padding: 0 4px; border-radius: 8px; border: 2px solid var(--ink); background: linear-gradient(180deg, #ffe27a, #ff9d1a); color: var(--ink); font-size: 10px; line-height: 14px; text-shadow: none; pointer-events: none; z-index: 3; animation: fmDlWob 1.6s ease-in-out infinite; }
.fm-todaywrap { flex: none; width: min(calc(100% - 24px), 380px); margin: -4px auto 12px; position: relative; }
.fm-todaywrap::before, .fm-todaywrap::after { content: ""; position: absolute; top: 0; bottom: 8px; width: 18px; z-index: 2; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
.fm-todaywrap::before { left: 0; background: linear-gradient(90deg, rgba(28, 22, 92, 0.85), rgba(28, 22, 92, 0)); }
.fm-todaywrap::after { right: 0; background: linear-gradient(270deg, rgba(28, 22, 92, 0.85), rgba(28, 22, 92, 0)); }
.fm-todaywrap.more-l::before, .fm-todaywrap.more-r::after { opacity: 1; }
.fm-tdots { display: flex; justify-content: center; gap: 4px; height: 6px; margin-top: 3px; }
.fm-tdots i { width: 5px; height: 5px; border-radius: 50%; background: rgba(255, 255, 255, 0.35); }
.fm-tdots i.on { background: #ffe27a; width: 12px; border-radius: 3px; }
.fm-today { width: 100%; margin: 0; display: flex; gap: 5px; align-items: center; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; touch-action: pan-x; padding: 1px 2px; }
.fm-today > * { scroll-snap-align: start; }
.fm-sum { display: none; align-items: center; justify-content: center; gap: 6px; font-size: 13px; letter-spacing: 0.06em; color: #fff; text-shadow: var(--ol-sm); }
.fm-info.cmp { padding: 6px 12px; gap: 0; margin-bottom: 14px; }
.fm-info.cmp .fm-mrows, .fm-info.cmp .fm-hgoal, .fm-info.cmp .fm-ihead { display: none; }
.fm-info.cmp .fm-sum { display: flex; }
.fm-info.cmp.hot { animation: fmGlowPulse 1.4s ease-in-out infinite; }
.fm-bot, .fm-secrow { z-index: 3; }
.fm-sb, .fm-play, .fm-arena { touch-action: manipulation; }
.fm-main[data-att="reward"] .fm-globe .fm-bdg, .fm-main[data-att="first"] .fm-globe .fm-bdg { display: none; }
.fm-main[data-att="reward"] .fm-globe.ready, .fm-main[data-att="first"] .fm-globe.ready { animation: none; }
.fm-main:not([data-att="reward"]) .fm-dl .fm-bdg, .fm-main:not([data-att="reward"]) .fm-rwc { display: none; }
.fm-diarybtn { position: absolute; right: 52px; top: 8px; z-index: 5; display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 12px 0 9px; border-radius: 15px; border: 2.5px solid var(--ink); background: linear-gradient(180deg, #fff3d6, #ffd98a); color: var(--ink); box-shadow: 0 3px 0 var(--ink2); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; width: auto; }
.fm-diarybtn:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink2); }
.fm-book.lk .art.sil { font-size: 56px; filter: blur(5px) grayscale(1) brightness(0.35); opacity: 0.6; }
.fm-book.lk .pt { opacity: 0.9; }
.fm-book .hint { margin-top: 8px; padding: 5px 10px; border-radius: 10px; background: rgba(10, 25, 55, 0.08); font-size: 12.5px; font-weight: 700; }
.fm-node.far .n { filter: grayscale(1); opacity: 0.75; }
.fm-node .nm.gr { background: rgba(70, 76, 90, 0.7); color: #d3d8e2; }
.fm-season { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none !important; }
.fm-season i { position: absolute; top: -8%; font-style: normal; font-size: 16px; opacity: 0.75; animation: fmSeasonFall linear infinite; }
@keyframes fmSeasonFall { 0% { transform: translate3d(0, 0, 0) rotate(0deg); } 100% { transform: translate3d(28px, 112vh, 0) rotate(300deg); } }
.fm-main[data-season="spring"] { box-shadow: inset 0 0 90px rgba(255, 170, 205, 0.22); }
.fm-main[data-season="summer"] { box-shadow: inset 0 0 90px rgba(255, 224, 120, 0.2); filter: saturate(1.08) brightness(1.04); }
.fm-main[data-season="autumn"] { box-shadow: inset 0 0 90px rgba(255, 140, 40, 0.24); }
.fm-main[data-season="winter"] { box-shadow: inset 0 0 90px rgba(190, 225, 255, 0.16); }
@media (prefers-reduced-motion: reduce) { .fm-season i { animation: none; top: 20%; } }
.fm-book { margin: 4px auto 10px; max-width: 340px; padding: 18px 18px 14px; border-radius: 14px; border: 3px solid var(--ink); background: #fff8e4; color: var(--ink); text-align: center; box-shadow: 0 4px 0 var(--ink2); text-shadow: none; }
.fm-book .art { font-size: 44px; line-height: 1.2; margin-bottom: 6px; }
.fm-book .pt { font-size: 16px; font-weight: 800; margin-bottom: 8px; }
.fm-book .tx { font-size: 14px; line-height: 1.45; font-weight: 600; }
.fm-book .pg { margin-top: 10px; font-size: 12px; opacity: 0.7; }
.fm-book.lk .art { opacity: 0.5; }
.fm-dnav { display: flex; justify-content: center; align-items: center; gap: 14px; margin-bottom: 8px; }
.fm-today::-webkit-scrollbar { display: none; }
.fm-today .tl { flex: none; font-size: 10px; letter-spacing: 0.06em; color: #cfe2ff; text-shadow: var(--ol-sm); }
.fm-tchip { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 11px; border-radius: 15px; border: 2.5px solid var(--ink); background: #fff; color: var(--ink); font-size: 12.5px; font-weight: 800; line-height: 1; letter-spacing: 0; white-space: nowrap; cursor: pointer; text-shadow: none; transform: none; filter: none; -webkit-font-smoothing: antialiased; }
.fm-tchip.hot { background: #ffd84a; color: var(--ink); }
.fm-todaywrap.fm-lock { filter: none !important; opacity: 1 !important; }
.fm-todaywrap.fm-lock .fm-tchip { background: #1b2a52; color: #fff; border-color: #0d1630; opacity: 0.92; }
.fm-lock[data-lock]::after { content: attr(data-lock); position: absolute; left: auto; right: 3px; top: 3px; bottom: auto; width: auto; transform: none; background: #0d1630; color: #fff; font-size: 9px; font-weight: 900; line-height: 1; padding: 2px 5px; border: 1.5px solid #fff; border-radius: 8px; white-space: nowrap; z-index: 5; pointer-events: none; opacity: 1; }
.fm-todaywrap.fm-lock[data-lock]::after { top: -7px; right: 6px; }
.fm-todaywrap.fm-lock::before { display: none; }
.fm-tchip.fm-sz { position: relative; touch-action: manipulation; }
.fm-sring { width: 22px; height: 22px; flex: none; display: block; pointer-events: none; }
.fm-sring .bg { fill: none; stroke: rgba(40, 30, 90, 0.2); stroke-width: 3.5; }
.fm-sring .fg { fill: none; stroke: #ff7a1a; stroke-width: 3.5; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
.fm-sring text { font-size: 10px; text-anchor: middle; dominant-baseline: central; }
.fm-tchip.fm-sz > * { pointer-events: none; }
.fm-seatrack { display: flex; gap: 8px; overflow-x: auto; padding: 8px 4px 14px; -webkit-overflow-scrolling: touch; }
.fm-seacard { flex: none; width: 92px; padding: 8px 4px; border-radius: 14px; border: 2.5px solid var(--ink); background: #fff; color: var(--ink); text-align: center; font-size: 11px; font-weight: 800; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.fm-seacard.ready { background: #ffd84a; }
.fm-seacard.claimed { background: #cfe9d4; opacity: 0.8; }
.fm-seacard.lk { background: #dbe4f3; }
.fm-seacard .si { font-size: 26px; line-height: 1.1; }
.fm-seacard .sn { font-size: 10.5px; opacity: 0.8; }
.fm-seacard .sb { min-height: 26px; padding: 0 8px; border-radius: 12px; border: 2px solid var(--ink); background: #3ecf6a; color: #fff; font-size: 11px; font-weight: 900; cursor: pointer; }
.fm-seabar { height: 12px; margin: 6px 4px; border-radius: 8px; border: 2.5px solid var(--ink); background: rgba(255,255,255,.6); overflow: hidden; }
.fm-seabar i { display: block; height: 100%; background: #ff7a3a; }
@media (max-height: 700px) { .fm-todaywrap { margin: -8px auto 8px; } .fm-tchip { height: 28px; } }
@media (max-height: 600px) { .fm-todaywrap { display: none; } }
.fm-bonushd.full { background: linear-gradient(180deg, #ffe27a, #ffae00); color: var(--ink); text-shadow: none; }
.fm-node.boss { width: 82px; height: 82px; font-size: 38px; --nc1: #ff8a7a; --nc2: #e0392b; --nsh: #8a1a12; }
.fm-node.boss.done { --nc1: #ffe27a; --nc2: #ff9a00; --nsh: #b36f00; }
.fm-node.boss.lk { --nc1: #a99aa0; --nc2: #7c6a74; --nsh: #4a3a44; }
.fm-node .bn { position: absolute; right: -4px; top: -4px; min-width: 26px; height: 26px; padding: 0 5px; display: grid; place-items: center; border-radius: 13px; border: 2.5px solid var(--ink); background: #fff; color: var(--ink); font-size: 14px; text-shadow: none; }
.fm-node .stars { position: absolute; left: 50%; top: calc(100% + 3px); transform: translateX(-50%); display: flex; gap: 1px; font-size: 14px; line-height: 1; white-space: nowrap; pointer-events: none; text-shadow: var(--ol-sm); }
.fm-node .stars b { color: rgba(10, 25, 55, 0.5); font-weight: 900; text-shadow: none; }
.fm-node .stars b.on { color: var(--gold); text-shadow: var(--ol-sm); }
@keyframes fmNode { from { transform: translate(-50%, -50%) scale(1); } to { transform: translate(-50%, -50%) scale(1.12); } }

/* level card (bottom sheet inside the map) */
.fm-lcard {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; max-width: 520px; margin: 0 auto; padding: 16px 16px calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 16px);
  border-radius: 28px 28px 0 0; border: 3px solid var(--ink); border-bottom: 0; background: linear-gradient(180deg, #ffffff, #dcecff); color: var(--ink); text-shadow: none;
  box-shadow: 0 -8px 24px rgba(10, 30, 60, 0.35); animation: fmSheetIn 0.28s cubic-bezier(.2, 1.1, .4, 1);
}
@keyframes fmSheetIn { from { transform: translateY(100%); } to { transform: none; } }
.fm-lback { position: absolute; inset: 0; z-index: 4; background: rgba(10, 25, 55, 0.4); animation: fmFade 0.2s; }
@keyframes fmFade { from { opacity: 0; } to { opacity: 1; } }
.fm-lhead { display: flex; align-items: center; gap: 10px; }
.fm-lhead .lbig { flex: none; width: 54px; height: 54px; display: grid; place-items: center; border-radius: 16px; border: 3px solid var(--ink); font-size: 28px; background: linear-gradient(180deg, var(--ca), var(--cb)); }
.fm-lhead .l1 { font-size: 13px; letter-spacing: 0.1em; color: #5a7196; }
.fm-lhead .l2 { font-size: 23px; line-height: 1.1; }
.fm-lhead .fm-x { margin-left: auto; order: 0; }
.fm-lgoals { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.fm-lgoal { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 14px; border: 2.5px solid var(--ink); background: rgba(23, 52, 92, 0.07); font-size: 15px; line-height: 1.2; }
.fm-lgoal .gs { flex: none; font-size: 24px; line-height: 1; color: rgba(23, 52, 92, 0.3); }
.fm-lgoal.got { background: linear-gradient(180deg, #fff9dc, #ffe9a2); }
.fm-lgoal.got .gs { color: #f0a500; }
.fm-lintro { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; padding: 8px 10px; border-radius: 14px; background: rgba(47, 125, 255, 0.12); border: 2.5px dashed var(--blue); font-size: 13.5px; line-height: 1.25; }
.fm-lintro .ii { flex: none; font-size: 24px; }
.fm-lbest { font-size: 13.5px; color: #5a7196; margin-bottom: 10px; text-align: center; letter-spacing: 0.04em; }
.fm-llock { text-align: center; font-size: 15px; margin-bottom: 10px; color: var(--orange-dark); }

/* =============================================================== MODE SELECT (planets) */
.fm-plov {
  --u: min(100vw, 56vh); position: absolute; inset: 0; z-index: 55; display: flex; flex-direction: column; overflow: hidden;
  padding-top: calc(var(--sat, env(safe-area-inset-top, 0px)) + 8px);
  background: radial-gradient(ellipse 80% 50% at 50% 46%, rgba(86, 48, 170, 0.5), rgba(86, 48, 170, 0) 70%), linear-gradient(180deg, rgba(6, 11, 40, 0.94) 0%, rgba(20, 12, 60, 0.92) 58%, rgba(8, 20, 58, 0.95) 100%);
  animation: fmFade 0.25s;
}
.fm-plov.go { opacity: 0; transition: opacity 0.14s linear 0.3s; }
.fm-plov.go button { pointer-events: none; }

/* night sky: tiled dot layers + two twinkling layers + a few sparkles */
.fm-stars { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0 1px, transparent 1.6px) 0 0 / 97px 89px, radial-gradient(circle, rgba(255, 255, 255, 0.7) 0 1px, transparent 1.6px) 31px 47px / 61px 73px,
    radial-gradient(circle, rgba(190, 215, 255, 0.85) 0 1.3px, transparent 2px) 17px 23px / 131px 113px; }
.fm-stars.tw { background: radial-gradient(circle, #fff 0 1.4px, transparent 2.2px) 11px 7px / 83px 101px, radial-gradient(circle, #ffe9a8 0 1.4px, transparent 2.2px) 53px 61px / 119px 97px; animation: fmTwinkle 2.8s ease-in-out infinite alternate; }
.fm-stars.tw.b { background: radial-gradient(circle, #fff 0 1.5px, transparent 2.3px) 40px 29px / 107px 79px, radial-gradient(circle, #cfe2ff 0 1.3px, transparent 2px) 7px 71px / 71px 127px; animation-duration: 3.9s; animation-delay: -1.4s; }
@keyframes fmTwinkle { from { opacity: 0.1; } to { opacity: 1; } }
.fm-spark {
  position: absolute; left: var(--x); top: var(--y); width: var(--s); height: var(--s); background: #fff; pointer-events: none; opacity: 0.3;
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%); animation: fmSpark 2.6s ease-in-out infinite; animation-delay: var(--dl);
}
@keyframes fmSpark { 0%, 100% { opacity: 0.25; transform: scale(0.7) rotate(0deg); } 50% { opacity: 1; transform: scale(1.15) rotate(25deg); } }

/* header: back + title */
.fm-plhead { position: relative; z-index: 3; flex: none; display: grid; grid-template-columns: 46px 1fr 46px; align-items: center; gap: 8px; width: 100%; max-width: 520px; margin: 0 auto; padding: 0 16px; }
.fm-plback {
  width: 46px; height: 46px; padding: 0; border-radius: 15px; border: 3px solid var(--ink); cursor: pointer; font-size: 24px; line-height: 1; color: #fff; text-shadow: var(--ol-sm);
  background: linear-gradient(180deg, #7dc4ff, var(--blue)); box-shadow: 0 4px 0 var(--blue-dark), inset 0 3px 0 rgba(255, 255, 255, 0.45); transition: transform 0.06s, box-shadow 0.06s;
}
.fm-plback:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--blue-dark); }
.fm-pltitles { min-width: 0; text-align: center; }
.fm-pltitle { font-size: clamp(28px, 9vw, 38px); line-height: 1; white-space: nowrap; transform: rotate(-2deg); text-shadow: var(--ol); }
.fm-plsub { margin-top: 6px; font-size: 12px; letter-spacing: 0.14em; color: #b9c8ee; text-shadow: none; }

/* stage: dashed orbits + the three planets (positioned by their centre) */
.fm-plstage { position: relative; flex: 1 1 0; min-height: 0; width: min(100%, 520px); margin: 0 auto; }
.fm-orbit { position: absolute; left: 10%; top: 26%; width: 80%; height: 50%; border: 2.5px dashed rgba(190, 210, 255, 0.3); border-radius: 50%; pointer-events: none; }
.fm-orbit.o2 { left: -2%; top: 13%; width: 104%; height: 76%; border-width: 2px; border-color: rgba(190, 210, 255, 0.14); }
.fm-pl {
  --d: calc(var(--u) * 0.32); --gl: 255, 255, 255; --tc: #fff; position: absolute; left: var(--x); top: var(--y); z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 9px;
  padding: 0; border: 0; border-radius: 28px; background: none; cursor: pointer; transform: translate(-50%, calc(var(--d) / -2));
}
.fm-pl.endless { --d: calc(var(--u) * 0.5); --x: 50%; --y: 26%; --gl: 160, 100, 255; --tc: #ead6ff; --bd: 5.2s; --sp: 30s; }
.fm-pl.camp { --x: 26%; --y: 71%; --gl: 255, 150, 70; --tc: #ffe0b8; --bd: 4.4s; --ph: -1.7s; --sp: 24s; }
.fm-pl.cig { --x: 74%; --y: 71%; --gl: 130, 240, 190; --tc: #d2ffe0; --bd: 4.9s; --ph: -3.2s; --sp: 28s; }
.fm-pl .pwrap { position: relative; width: var(--d); height: var(--d); transform-origin: 50% 70%; transition: transform 0.09s ease-out; animation: fmPopIn 0.55s cubic-bezier(.2, 1.4, .4, 1) backwards; animation-delay: var(--dl, 0.05s); }
.fm-pl .pwrap::before { content: ""; position: absolute; inset: -16%; border-radius: 50%; background: radial-gradient(circle, rgba(var(--gl), 0.42) 0 42%, rgba(var(--gl), 0) 70%); pointer-events: none; }
.fm-pl:active .pwrap { transform: scale(0.93, 0.88) translateY(4px); }
.fm-pl .pbody { position: absolute; inset: 0; isolation: isolate; animation: fmPlBob var(--bd, 4.8s) ease-in-out infinite; animation-delay: var(--ph, 0s); }
@keyframes fmPlBob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-9px) rotate(1.5deg); } }

/* sphere: gradient body + scrolling surface (continents, storms, snow) + terminator shade + highlight */
.fm-pl .orb {
  --p1: #fff; --p2: #aaa; --p3: #555; position: absolute; inset: 0; z-index: 1; overflow: hidden; isolation: isolate; border-radius: 50%; border: 4px solid var(--ink);
  background: linear-gradient(150deg, var(--p1) 0%, var(--p2) 48%, var(--p3) 100%); box-shadow: 0 6px 0 var(--ink2), 0 11px 14px rgba(0, 0, 0, 0.4);
}
.fm-pl.endless .orb { --p1: #e2c4ff; --p2: #8e4ff5; --p3: #4a1fa8; }
.fm-pl.camp .orb { --p1: #ffd79a; --p2: #ff8f3a; --p3: #b84a12; }
.fm-pl.cig .orb { --p1: #f2fff7; --p2: #86eaa6; --p3: #1f9d60; }
.fm-pl .surf { position: absolute; left: 0; top: 0; width: 200%; height: 100%; background-repeat: repeat-x; background-size: 50% 100%; animation: fmPlSpin var(--sp, 26s) linear infinite; }
@keyframes fmPlSpin { to { transform: translateX(-50%); } }
.fm-pl.endless .surf { background-image:
  radial-gradient(ellipse 15% 7% at 28% 34%, rgba(255, 255, 255, 0.55) 0 55%, transparent 62%), radial-gradient(ellipse 22% 5% at 68% 63%, rgba(255, 255, 255, 0.32) 0 60%, transparent 66%),
  radial-gradient(ellipse 12% 6% at 60% 21%, rgba(60, 20, 140, 0.5) 0 60%, transparent 66%), radial-gradient(ellipse 9% 9% at 22% 78%, rgba(60, 20, 140, 0.35) 0 60%, transparent 68%),
  linear-gradient(180deg, transparent 0 14%, rgba(255, 255, 255, 0.16) 14% 22%, transparent 22% 40%, rgba(60, 20, 140, 0.28) 40% 50%, transparent 50% 66%, rgba(255, 255, 255, 0.14) 66% 74%, transparent 74% 88%, rgba(60, 20, 140, 0.24) 88% 94%, transparent 94%); }
.fm-pl.camp .surf { background-image:
  radial-gradient(ellipse 22% 17% at 30% 36%, #c4561a 0 90%, transparent 94%), radial-gradient(ellipse 18% 13% at 30% 35%, #ffd98a 0 90%, transparent 94%),
  radial-gradient(ellipse 20% 15% at 72% 66%, #c4561a 0 90%, transparent 94%), radial-gradient(ellipse 16% 11% at 72% 65%, #ffd98a 0 90%, transparent 94%),
  radial-gradient(ellipse 6% 6% at 62% 24%, rgba(130, 40, 0, 0.35) 0 85%, transparent 95%), radial-gradient(ellipse 5% 5% at 12% 70%, rgba(130, 40, 0, 0.3) 0 85%, transparent 95%),
  linear-gradient(0deg, transparent 32%, rgba(255, 255, 255, 0.2) 32% 33.5%, transparent 33.5% 65%, rgba(255, 255, 255, 0.2) 65% 66.5%, transparent 66.5%),
  linear-gradient(90deg, rgba(255, 255, 255, 0.2) 0 1.4%, transparent 1.4% 49%, rgba(255, 255, 255, 0.2) 49% 50.4%, transparent 50.4%); }
.fm-pl.cig .surf { background-image:
  radial-gradient(ellipse 20% 13% at 28% 50%, #fff 0 88%, transparent 93%), radial-gradient(ellipse 16% 10% at 74% 60%, #fff 0 88%, transparent 93%),
  radial-gradient(ellipse 14% 9% at 52% 76%, #168a52 0 88%, transparent 93%), radial-gradient(ellipse 11% 8% at 14% 74%, #168a52 0 88%, transparent 93%), radial-gradient(ellipse 10% 7% at 84% 82%, #168a52 0 88%, transparent 93%); }
.fm-pl .cap {
  position: absolute; left: 0; right: 0; top: 0; height: 40%;
  background: radial-gradient(ellipse 17% 60% at 20% 40%, #fff 0 92%, transparent 96%), radial-gradient(ellipse 15% 70% at 47% 30%, #fff 0 92%, transparent 96%), radial-gradient(ellipse 18% 62% at 76% 38%, #fff 0 92%, transparent 96%), linear-gradient(180deg, #fff 0 38%, transparent 38.5%);
}
.fm-pl .shd {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle at 30% 26%, rgba(10, 8, 50, 0) 0 42%, rgba(10, 8, 50, 0.5) 100%), radial-gradient(circle at 80% 84%, rgba(5, 5, 40, 0.42), rgba(5, 5, 40, 0) 55%);
  box-shadow: inset calc(var(--d) * -0.07) calc(var(--d) * -0.08) 0 rgba(0, 0, 30, 0.26), inset calc(var(--d) * 0.03) calc(var(--d) * 0.035) 0 rgba(255, 255, 255, 0.3);
}
.fm-pl .hl { position: absolute; left: 17%; top: 11%; width: 27%; height: 15%; border-radius: 50%; background: radial-gradient(ellipse at 45% 45%, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0) 72%); transform: rotate(-30deg); pointer-events: none; }
.fm-pl .gl { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-52%); text-align: center; font-size: calc(var(--d) * 0.4); font-weight: inherit; line-height: 1; text-shadow: none; filter: drop-shadow(0 3px 0 rgba(10, 20, 60, 0.45)); pointer-events: none; }
.fm-pl.endless .gl { font-size: calc(var(--d) * 0.52); color: #fff; text-shadow: var(--ol); filter: none; }
.fm-pl .fp { position: absolute; left: 13%; bottom: 14%; font-size: calc(var(--d) * 0.19); font-weight: inherit; line-height: 1; transform: rotate(-24deg); text-shadow: none; filter: drop-shadow(0 2px 0 rgba(10, 20, 60, 0.45)); pointer-events: none; }

/* tilted Saturn-like ring: whole ellipse behind the sphere + its lower half drawn in front */
.fm-pl .ring {
  position: absolute; left: -26%; right: -26%; top: 31%; height: 38%; border-radius: 50%; border: calc(var(--d) * 0.045) solid #ffd36a; box-shadow: 0 0 0 3px var(--ink), inset 0 0 0 3px var(--ink);
  transform: rotate(-20deg); pointer-events: none;
}
.fm-pl .ring.bk { z-index: 0; }
.fm-pl .ring.fr { z-index: 2; clip-path: polygon(-10% 50%, 110% 50%, 110% 130%, -10% 130%); }

/* label pill under each planet */
.fm-pl .plab {
  position: relative; z-index: 3; max-width: calc(var(--u) * 0.44); padding: 6px 12px 7px; text-align: center; border-radius: 16px; border: 3px solid var(--ink);
  background: linear-gradient(180deg, rgba(34, 66, 120, 0.94), rgba(10, 25, 55, 0.94)); box-shadow: 0 4px 0 var(--ink2), inset 0 2px 0 rgba(255, 255, 255, 0.14);
  animation: fmUp 0.5s cubic-bezier(.2, 1.3, .4, 1) backwards; animation-delay: calc(var(--dl, 0.05s) + 0.15s); transition: transform 0.06s, box-shadow 0.06s;
}
.fm-pl .plab b { display: block; font-size: 17px; font-weight: inherit; line-height: 1.05; color: var(--tc); white-space: nowrap; text-shadow: var(--ol-sm); }
.fm-pl .plab i { display: block; margin-top: 3px; font-size: 12px; font-style: normal; line-height: 1.1; color: #cfe2ff; text-shadow: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fm-pl.endless .plab { max-width: calc(var(--u) * 0.64); }
.fm-pl.endless .plab b { font-size: 23px; }
.fm-pl:active .plab { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink2), inset 0 2px 0 rgba(255, 255, 255, 0.14); }
.fm-pl.pick .plab, .fm-moon.pick::before { border-color: var(--gold); }

/* GÜNÜN DAĞI: a small moon chip under the planets */
.fm-moon {
  position: relative; z-index: 2; isolation: isolate; flex: none; align-self: center; display: flex; align-items: center; gap: 10px; min-height: 54px; margin: 4px 0 calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 18px); padding: 5px 20px 5px 5px;
  border: 0; border-radius: 30px; background: none; cursor: pointer; text-align: left; animation: fmUp 0.5s cubic-bezier(.2, 1.3, .4, 1) 0.4s backwards; transition: transform 0.06s;
}
.fm-moon::before {
  content: ""; position: absolute; inset: 0; z-index: -1; border-radius: 30px; border: 3px solid var(--ink); background: linear-gradient(180deg, #7dc4ff, var(--blue));
  box-shadow: 0 5px 0 var(--blue-dark), 0 8px 10px rgba(10, 30, 60, 0.3), inset 0 3px 0 rgba(255, 255, 255, 0.4); transition: box-shadow 0.06s;
}
.fm-moon:active { transform: translateY(4px); }
.fm-moon:active::before { box-shadow: 0 1px 0 var(--blue-dark), inset 0 3px 0 rgba(255, 255, 255, 0.4); }
.fm-moon .mn {
  flex: none; width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; border: 3px solid var(--ink); font-size: 19px; line-height: 1; text-shadow: none;
  background: radial-gradient(ellipse 14% 14% at 72% 30%, rgba(80, 100, 150, 0.35) 0 85%, transparent 95%), radial-gradient(ellipse 10% 10% at 26% 72%, rgba(80, 100, 150, 0.3) 0 85%, transparent 95%), radial-gradient(circle at 30% 26%, #fff 0 16%, #e6edf8 42%, #aab9d4 100%);
  box-shadow: inset -5px -6px 0 rgba(70, 90, 140, 0.35); animation: fmPlBob 3.4s ease-in-out infinite;
}
.fm-moon .mt { min-width: 0; }
.fm-moon .mt b { display: block; font-size: 17px; font-weight: inherit; line-height: 1; white-space: nowrap; text-shadow: var(--ol-sm); }
.fm-moon .mt i { display: block; margin-top: 3px; font-size: 12px; font-style: normal; line-height: 1; color: #e4f1ff; text-shadow: none; white-space: nowrap; }

/* tap: the chosen planet flies to the middle and grows over the screen while everything else fades */
.fm-plov.go .fm-pl:not(.pick), .fm-plov.go .fm-moon:not(.pick), .fm-plov.go .fm-plhead, .fm-plov.go .fm-orbit { opacity: 0; transition: opacity 0.22s ease-out; }
.fm-plov.go .fm-pl.pick, .fm-plov.go .fm-moon.pick { z-index: 5; }
.fm-plov.go .fm-pl.pick .pwrap, .fm-plov.go .fm-moon.pick .mn { transform-origin: 50% 50%; transform: translate(var(--tx), var(--ty)) scale(var(--k)); transition: transform 0.42s cubic-bezier(.5, 0, .9, .4); }
.fm-plov.go .fm-moon.pick .mn { animation: none; }
.fm-plov.go .fm-pl.pick .plab, .fm-plov.go .fm-moon.pick .mt, .fm-plov.go .fm-moon.pick::before { opacity: 0; transition: opacity 0.12s; }

@media (max-height: 600px) {
  .fm-plsub { display: none; }
  .fm-moon { margin-bottom: calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 10px); }
}
@media (max-width: 350px) {
  .fm-pl .plab { padding: 5px 9px 6px; }
  .fm-pl .plab b { font-size: 15px; }
  .fm-pl.endless .plab b { font-size: 20px; }
}

/* =============================================================== LEVEL RESULT / FAILED / INTRO */
.fm-resov {
  position: absolute; inset: 0; z-index: 85; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: calc(var(--sat, env(safe-area-inset-top, 0px)) + 16px) 16px calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 16px);
  background: radial-gradient(ellipse at 50% 38%, rgba(30, 70, 140, 0.8), rgba(8, 18, 40, 0.94)); animation: fmFade 0.25s; overflow-y: auto; touch-action: pan-y;
}
.fm-resov { background: radial-gradient(ellipse at 50% 38%, rgba(20, 50, 105, 0.9), rgba(5, 12, 28, 0.97)); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.fm-goal { width: min(320px, 100%); display: flex; flex-direction: column; gap: 5px; padding: 8px 12px 9px; border-radius: 12px; border: 2px solid rgba(255, 207, 58, 0.6); background: rgba(23, 52, 92, 0.6); color: #fff; font-weight: 800; }
.fm-goal .gh { font-size: 11px; letter-spacing: 0.14em; color: var(--gold); }
.fm-goal .gt { font-size: 15px; text-shadow: 0 2px 0 var(--ink); } .fm-goal .gt b { color: var(--gold); }
.fm-goal .gb { height: 9px; border-radius: 5px; background: rgba(255, 255, 255, 0.2); overflow: hidden; }
.fm-goal .gb i { display: block; height: 100%; background: linear-gradient(90deg, #ffe066, #ff9a3a); transition: width 1.1s cubic-bezier(.2, .8, .2, 1); }
.fm-goal .gs { display: flex; justify-content: space-between; font-size: 11.5px; color: #cfe6ff; } .fm-goal .gs em { font-style: normal; color: #7dff9a; }
.fm-stamps { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 4px 2px 12px; }
.fm-stamp { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 3px; padding: 10px 6px; border-radius: 14px; border: 3px dashed rgba(23, 52, 92, 0.45); background: rgba(255, 255, 255, 0.35); color: var(--ink); opacity: 0.65; }
.fm-stamp .si { font-size: 34px; line-height: 1; filter: grayscale(1); } .fm-stamp .sn { font-size: 14px; line-height: 1.15; } .fm-stamp .sd { font-size: 11px; font-weight: 700; opacity: 0.8; line-height: 1.2; }
.fm-stamp.got { opacity: 1; border-style: solid; border-color: var(--orange-dark); background: linear-gradient(180deg, #fff3a8, #ffcf3a); transform: rotate(-1.5deg); }
.fm-stamp.got .si { filter: none; }
.fm-post { position: absolute; right: 14px; top: -44px; width: 46px; height: 38px; border: 0; padding: 0; cursor: pointer; font-size: 26px; line-height: 38px; text-align: center; border-radius: 10px; background: linear-gradient(180deg, #fffdf2, #f1e2b0); box-shadow: 0 3px 0 #a98a3c, 0 5px 8px rgba(10, 30, 60, 0.35); animation: fmPostB 2.2s ease-in-out infinite; }
.fm-post.off { display: none; }
.fm-post .fm-bdg { top: -6px; right: -6px; }
@keyframes fmPostB { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-4px) rotate(3deg); } }
.fm-card { position: relative; margin: 8px 6px 12px; padding: 16px 14px 14px; border-radius: 6px; text-align: center; background: repeating-linear-gradient(180deg, #fff9e3 0 26px, #f0e4bd 26px 27px); border: 3px solid #c9a95a; box-shadow: 0 6px 0 #9b7d34, 0 10px 16px rgba(10, 30, 60, 0.3); transform: rotate(-1.2deg); color: var(--ink); }
.fm-card .st { position: absolute; right: 8px; top: 8px; transform: rotate(8deg); border: 2px dashed #c0392b; padding: 2px 6px; border-radius: 4px; color: #c0392b; font-size: 11px; font-weight: 900; }
.fm-card .yt { font-size: 52px; line-height: 1; } .fm-card .tx { font-size: 17px; font-weight: 800; line-height: 1.3; margin: 8px 0 10px; }
.fm-card .cp { display: inline-block; padding: 6px 14px; border: 3px dashed var(--orange-dark); border-radius: 10px; background: #fff3a8; font-weight: 900; font-size: 18px; }
.fm-shelf { margin: 6px 2px 12px; } .fm-shelf .hd { font-size: 13px; font-weight: 900; margin: 0 4px 4px; color: var(--ink); }
.fm-board { display: flex; flex-wrap: wrap; gap: 6px 10px; justify-content: flex-start; align-items: flex-end; min-height: 62px; padding: 10px 10px 0; border-radius: 8px 8px 0 0; background: linear-gradient(180deg, rgba(23, 52, 92, 0.12), rgba(23, 52, 92, 0.04)); box-shadow: inset 0 6px 8px rgba(0, 0, 0, 0.12); }
.fm-plank { height: 12px; margin-bottom: 4px; border-radius: 0 0 6px 6px; background: linear-gradient(180deg, #c58a4a, #8a5524); box-shadow: 0 4px 0 #5a3512, 0 6px 8px rgba(0, 0, 0, 0.3); }
.fm-troph { position: relative; width: 38px; height: 46px; display: flex; align-items: center; justify-content: center; font-size: 22px; border-radius: 10px 10px 14px 14px; background: linear-gradient(135deg, #fff3a8 0%, #ffcf3a 45%, #d99a10 100%); box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.7), inset 0 -5px 0 rgba(120, 70, 0, 0.35), 0 4px 0 #8a5a10, 0 6px 6px rgba(0, 0, 0, 0.3); }
.fm-troph.ach { background: linear-gradient(135deg, #e8f4ff 0%, #9bd1ff 45%, #3f8fe0 100%); box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.8), inset 0 -5px 0 rgba(10, 50, 120, 0.4), 0 4px 0 #1b5a9a, 0 6px 6px rgba(0, 0, 0, 0.3); }
.fm-troph::after { content: ''; position: absolute; left: 6px; top: 5px; width: 6px; height: 16px; border-radius: 4px; background: rgba(255, 255, 255, 0.55); transform: rotate(12deg); }
.fm-empty { font-size: 12px; font-weight: 700; opacity: 0.6; padding: 14px 4px; }
.fm-resov.fail { background: radial-gradient(ellipse at 50% 38%, rgba(120, 30, 40, 0.82), rgba(24, 8, 16, 0.95)); }
.fm-banner {
  position: relative; padding: 10px 28px 12px; border: 3px solid var(--ink); border-radius: 14px; font-size: clamp(26px, 8.5vw, 36px); line-height: 1; text-align: center; transform: rotate(-2deg);
  background: linear-gradient(180deg, #ffb06a, var(--orange)); box-shadow: 0 6px 0 var(--orange-dark), inset 0 3px 0 rgba(255, 255, 255, 0.45); text-shadow: var(--ol); animation: fmPopIn 0.5s cubic-bezier(.2, 1.4, .4, 1);
}
.fm-banner.boss { background: linear-gradient(180deg, #ff8a7a, #e0392b); box-shadow: 0 6px 0 #8a1a12, inset 0 3px 0 rgba(255, 255, 255, 0.45); }
.fm-banner.red { background: linear-gradient(180deg, #ff8a8a, #e63b3b); box-shadow: 0 6px 0 #8f1c1c, inset 0 3px 0 rgba(255, 255, 255, 0.45); }
.fm-rname { font-size: 18px; letter-spacing: 0.06em; color: #cfe2ff; }
.fm-bigstars { display: flex; gap: 6px; align-items: flex-end; margin: 4px 0; }
.fm-bigstar { font-size: 84px; line-height: 1; color: rgba(255, 255, 255, 0.22); text-shadow: 0 5px 0 rgba(0, 0, 0, 0.3); transform: scale(0.55); transition: none; }
.fm-bigstar:nth-child(2) { font-size: 104px; margin-bottom: 8px; }
.fm-bigstar.on { color: var(--gold); text-shadow: 0 5px 0 #b36f00, 3px 3px 0 var(--ink), -3px 3px 0 var(--ink), 3px -3px 0 var(--ink), -3px -3px 0 var(--ink), 0 0 24px rgba(255, 207, 58, 0.9); animation: fmStarPop 0.6s cubic-bezier(.2, 1.8, .4, 1) forwards; }
@keyframes fmStarPop { 0% { transform: scale(0.2) rotate(-40deg); } 60% { transform: scale(1.35) rotate(8deg); } 100% { transform: scale(1) rotate(0); } }
.fm-rgoals { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 340px; }
.fm-rgoal { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 14px; border: 2.5px solid var(--ink); background: rgba(10, 25, 55, 0.62); font-size: 15px; line-height: 1.2; opacity: 0; animation: fmUp 0.4s ease-out forwards; }
.fm-rgoal .gs { flex: none; font-size: 20px; line-height: 1; color: rgba(255, 255, 255, 0.35); }
.fm-rgoal.got .gs { color: var(--gold); }
.fm-rgoal.miss { opacity: 0.7; }
.fm-rgoal .ck { margin-left: auto; flex: none; font-size: 18px; }
.fm-rchips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 340px; }
.fm-rchip { padding: 6px 12px; border-radius: 14px; border: 3px solid var(--ink); background: linear-gradient(180deg, #fff, #dcecff); color: var(--ink); font-size: 18px; text-shadow: none; opacity: 0; animation: fmPopIn 0.45s cubic-bezier(.2, 1.4, .4, 1) forwards; }
.fm-rchip.gold { background: linear-gradient(180deg, #fff3a8, var(--gold)); }
.fm-rspecial { width: 100%; max-width: 340px; padding: 10px 12px; text-align: center; border-radius: 16px; border: 3px solid var(--ink); background: linear-gradient(180deg, #c79bff, #7a3cf0); font-size: 17px; line-height: 1.2; box-shadow: 0 5px 0 #4b1fa8; animation: fmPopIn 0.5s cubic-bezier(.2, 1.4, .4, 1) both; }
.fm-rbtns { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 340px; margin-top: 4px; }
.fm-rbtns .row { display: flex; gap: 10px; }
.fm-rbtns .row .fm-btn { flex: 1; }
.fm-ftip { max-width: 320px; text-align: center; font-size: 15px; line-height: 1.35; color: #ffd9d9; }
.fm-ficon { font-size: 84px; line-height: 1; text-shadow: none; filter: drop-shadow(0 6px 0 rgba(0, 0, 0, 0.35)); animation: fmPopIn 0.5s cubic-bezier(.2, 1.4, .4, 1); }

/* =============================================================== MODAL / BOX OVERLAY / TOAST / FX */
.fm-modal { position: absolute; inset: 0; z-index: 75; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(10, 25, 50, 0.62); animation: fmIn 0.2s ease-out; }
.fm-mcard {
  display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; max-width: 340px; padding: 22px 18px 18px; text-align: center; color: var(--ink); text-shadow: none;
  border: 3px solid var(--ink); border-radius: 26px; background: linear-gradient(180deg, #fff, #dcecff); box-shadow: 0 6px 0 var(--ink), 0 14px 30px rgba(10, 30, 60, 0.4); animation: fmPop 0.55s cubic-bezier(.2, 1.8, .4, 1);
}
.fm-mcard .big { font-size: 64px; line-height: 1; }
.fm-mcard .mt { font-size: 26px; line-height: 1.1; color: var(--orange-dark); }
.fm-mcard .mm { font-size: 15px; line-height: 1.4; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-weight: 800; letter-spacing: 0; }

.fm-boxov { position: absolute; inset: 0; z-index: 80; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 20px;
  background: radial-gradient(ellipse at 50% 40%, rgba(60, 40, 120, 0.85), rgba(10, 18, 40, 0.94)); animation: fmIn 0.2s ease-out; }
.fm-boxt { font-size: 26px; letter-spacing: 0.06em; text-shadow: var(--ol); }
.fm-boxs { min-height: 18px; font-size: 14px; color: #cbd8f5; }
.fm-gift { font-size: 128px; line-height: 1; padding: 6px 14px; border: 0; background: transparent; cursor: pointer; filter: drop-shadow(0 8px 0 rgba(0, 0, 0, 0.35)); animation: fmWiggle 1.1s ease-in-out infinite; text-shadow: none; }
.fm-gift.open { animation: fmBoxShake 0.65s ease-in-out forwards; }
@keyframes fmWiggle { 0%, 100% { transform: rotate(-4deg) scale(1); } 50% { transform: rotate(4deg) scale(1.06); } }
@keyframes fmBoxShake { 0% { transform: rotate(0) scale(1); } 15% { transform: rotate(-12deg) scale(1.1); } 30% { transform: rotate(12deg) scale(1.15); } 45% { transform: rotate(-14deg) scale(1.2); } 60% { transform: rotate(14deg) scale(1.25); } 100% { transform: scale(1.6); opacity: 0; } }
.fm-rcard { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; max-width: 300px; padding: 20px 16px; border-radius: 24px; border: 3px solid var(--ink); color: var(--ink); text-shadow: none;
  background: linear-gradient(180deg, #fff, #dcecff); box-shadow: 0 6px 0 var(--ink); animation: fmPop 0.6s cubic-bezier(.2, 1.8, .4, 1); text-align: center; }
.fm-rcard.rare { background: linear-gradient(180deg, #fff6c7, #ffd966); box-shadow: 0 6px 0 var(--ink), 0 0 30px 8px rgba(255, 207, 58, 0.8); }
.fm-rcard .ri { font-size: 64px; line-height: 1; }
.fm-rcard .rt { font-size: 26px; line-height: 1.1; }
.fm-rcard .rs { font-size: 14px; color: #5a7196; }
.fm-sumlist { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 340px; }
.fm-sumlist span { padding: 6px 10px; border-radius: 14px; border: 3px solid var(--ink); background: #fff; color: var(--ink); font-size: 16px; text-shadow: none; }
.fm-sumlist span.rare { background: var(--gold); }
.fm-boxbtns { display: flex; gap: 10px; width: 100%; max-width: 300px; }
.fm-boxbtns .fm-btn { flex: 1; }

.fm-toasts { position: absolute; left: 0; right: 0; top: 0; z-index: 95; display: flex; flex-direction: column; align-items: center; pointer-events: none; padding-top: calc(var(--sat, env(safe-area-inset-top, 0px)) + 8px); }
.fm-toast {
  display: flex; align-items: center; gap: 10px; max-width: min(92vw, 380px); padding: 8px 16px 8px 10px; border-radius: 18px; border: 3px solid var(--ink);
  background: linear-gradient(180deg, #2c5799, var(--ink)); box-shadow: 0 5px 0 rgba(10, 25, 50, 0.8), 0 10px 24px rgba(10, 30, 60, 0.35);
  transform: translateY(-150%); opacity: 0; transition: transform 0.35s cubic-bezier(.2, 1.5, .4, 1), opacity 0.25s; pointer-events: none;
}
.fm-toast.on { transform: none; opacity: 1; }
.fm-toast.gold { background: linear-gradient(180deg, #ffb347, #e8830f); }
.fm-toast.egg { background: linear-gradient(180deg, #b07bff, #7a3cf0); }
.fm-toast .ti { flex: none; font-size: 30px; line-height: 1; text-shadow: none; }
.fm-toast .tt { font-size: 16px; letter-spacing: 0.02em; color: var(--gold); text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35); line-height: 1.15; }
.fm-toast.gold .tt { color: #fff; }
.fm-toast .ts { margin-top: 2px; font-size: 13px; color: #dbe9ff; line-height: 1.25; text-shadow: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-weight: 800; letter-spacing: 0; }

.fm-fx { position: absolute; inset: 0; z-index: 98; pointer-events: none; overflow: hidden; }
.fm-fly { position: absolute; font-size: 22px; line-height: 1; opacity: 0; transform: translate(-50%, -50%); animation: fmFly 0.85s cubic-bezier(.5, 0, .75, .35) both; text-shadow: none; }
@keyframes fmFly { 0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.25); } 100% { opacity: 0.9; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.5); } }
.fm-cf { position: absolute; top: -16px; left: var(--x); width: 9px; height: 14px; border-radius: 2px; background: var(--c); animation: fmCf var(--d) linear forwards; }
@keyframes fmCf { to { transform: translate(var(--dx), 112vh) rotate(var(--r)); } }

/* ÇIĞ DAĞLAR: mountain grid, quick start, endless / daily rows */
.fm-cgq { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.fm-cgq b { font-size: 24px; line-height: 1.05; }
.fm-cgq small { font-size: 14px; opacity: 0.92; letter-spacing: 0.04em; font-weight: 800; }
.fm-cgrid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px 6px; justify-items: center; padding: 6px 0 26px; }
.fm-cgn {
  --nc1: #ffffff; --nc2: #cfe2f7; --nsh: #7d96b8; position: relative; width: 56px; height: 56px; margin-bottom: 14px; padding: 0; cursor: pointer; border-radius: 50%; border: 3px solid var(--ink);
  display: grid; place-items: center; font-size: 21px; line-height: 1; color: #fff; text-shadow: var(--ol-sm);
  background: radial-gradient(ellipse 60% 36% at 36% 22%, rgba(255, 255, 255, 0.65), rgba(255, 255, 255, 0)), linear-gradient(180deg, var(--nc1), var(--nc2));
  box-shadow: 0 5px 0 var(--nsh), 0 8px 8px rgba(10, 30, 60, 0.3), inset 0 -4px 0 rgba(0, 0, 0, 0.12); transition: box-shadow 0.06s;
}
.fm-cgn:active { box-shadow: 0 1px 0 var(--nsh), 0 3px 4px rgba(10, 30, 60, 0.3); }
.fm-cgn.done { --nc1: #ffe27a; --nc2: #ffae00; --nsh: #b36f00; color: var(--ink); text-shadow: none; }
.fm-cgn.cur { --nc1: #a6ec6a; --nc2: #35c46a; --nsh: #1e8a49; animation: fmCgn 1s ease-in-out infinite alternate; }
.fm-cgn.lk { --nc1: #b8c3d4; --nc2: #8392aa; --nsh: #55647e; filter: saturate(0.6); }
.fm-cgn.boss { width: 62px; height: 62px; font-size: 30px; --nc1: #ff8a7a; --nc2: #e0392b; --nsh: #8a1a12; }
.fm-cgn.boss.done { --nc1: #ffe27a; --nc2: #ff9a00; --nsh: #b36f00; }
.fm-cgn.boss.lk { --nc1: #a99aa0; --nc2: #7c6a74; --nsh: #4a3a44; }
.fm-cgn .bn { position: absolute; right: -5px; top: -5px; min-width: 24px; height: 24px; padding: 0 4px; display: grid; place-items: center; border-radius: 12px; border: 2.5px solid var(--ink); background: #fff; color: var(--ink); font-size: 13px; text-shadow: none; }
.fm-cgn .stars { position: absolute; left: 50%; top: calc(100% + 3px); transform: translateX(-50%); display: flex; gap: 1px; font-size: 13px; line-height: 1; white-space: nowrap; pointer-events: none; text-shadow: var(--ol-sm); }
.fm-cgn .stars b { color: rgba(10, 25, 55, 0.5); font-weight: 900; text-shadow: none; }
.fm-cgn .stars b.on { color: var(--gold); text-shadow: var(--ol-sm); }
@keyframes fmCgn { from { transform: scale(1); } to { transform: scale(1.1); } }
.fm-cgrow { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border-radius: 18px; border: 3px solid var(--ink); background: linear-gradient(180deg, #ffffff, #dcecff); color: var(--ink); text-shadow: none; text-align: left; box-shadow: 0 5px 0 rgba(10, 30, 60, 0.35); cursor: pointer; }
.fm-cgrow:active { transform: translateY(3px); box-shadow: 0 2px 0 rgba(10, 30, 60, 0.35); }
.fm-cgrow .ic { flex: none; font-size: 30px; line-height: 1; }
.fm-cgrow .tx { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.fm-cgrow .tx b { font-size: 18px; line-height: 1.1; }
.fm-cgrow .tx small { font-size: 13px; color: #5a7196; font-weight: 800; }
.fm-cgrow.lock { opacity: 0.62; filter: saturate(0.5); }
/* legibility: small text gets solid colours, no outline stacks */
.fm-tag, .fm-ihead, .fm-sum, .fm-today .tl, .fm-cur .num, .fm-toast .tt, .fm-globe .glt, .fm-node .nm, .fm-node .bn, .fm-bonushd, .fm-acthero .t1, .fm-stamp, .fm-chip, .fm-xchip { text-shadow: none !important; -webkit-text-stroke: 0 !important; }
.fm-today .tl { background: rgba(14, 24, 60, 0.7); padding: 3px 7px; border-radius: 9px; font-size: 11px; }
.fm-ihead, .fm-sum { background: rgba(14, 24, 60, 0.55); padding: 3px 8px; border-radius: 9px; }
.fm-node .stars b.on, .fm-cgn .stars b.on { text-shadow: 0 1px 1px rgba(0, 0, 0, 0.6); }
.fm-card .tx { font-size: 16px; color: #2a1d08; text-shadow: none !important; -webkit-text-stroke: 0; font-weight: 800; }
.fm-card .cp, .fm-card .st { text-shadow: none; }
.fm-shelf .hd { font-size: 14px; font-weight: 900; color: #14284a; text-shadow: none !important; -webkit-text-stroke: 0; }
.fm-shcap { min-height: 15px; font-size: 12px; font-weight: 800; color: #14284a; text-shadow: none; text-align: center; }
.fm-troph.lock { background: linear-gradient(180deg, #aeb6c4, #8a93a3); box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.35), 0 4px 0 #5d6574; cursor: pointer; color: transparent; text-shadow: none; filter: grayscale(1) brightness(0.55); opacity: 0.85; }
.fm-troph.lock .lk { position: absolute; right: -4px; bottom: -4px; font-size: 11px; line-height: 1; color: #fff; }
.fm-post { right: auto; top: auto; left: 76px; bottom: 20px; z-index: 3; }
.fm-cfly { position: absolute; z-index: 120; font-size: 22px; pointer-events: none; text-shadow: none; animation: fmCoinFly 1s cubic-bezier(.5, 0, .8, .4) forwards; opacity: 0; }
@keyframes fmCoinFly { 0% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { opacity: 0; transform: translate(35vw, -70vh) scale(0.5); } }
@media (prefers-reduced-motion: reduce) {
  .fm-main *, .fm-ov *, .fm-modal *, .fm-boxov *, .fm-plov *, .fm-resov *, .fm-toast { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
/* home focus: ARENA secondary, GÜNLÜK progress card */
.fm-main .fm-arena { width: min(100%, 300px); padding: 4px 12px; gap: 8px; margin: 0 auto; background: transparent !important; box-shadow: none !important; border: 2px solid rgba(255, 255, 255, 0.55); border-radius: 16px; color: #fff; }
.fm-main .fm-arena .ico { font-size: 18px; }
.fm-main .fm-arena b { font-size: 14px; color: #fff; text-shadow: var(--ol-sm); letter-spacing: 0.06em; }
.fm-main .fm-arena small { display: none; }
.fm-main .fm-arena:active { transform: translateY(2px); }
.fm-sum { gap: 8px; border-radius: 12px; cursor: pointer; }
.fm-sum .sl { font-size: 12px; letter-spacing: 0.08em; color: #cfe2ff; }
.fm-sum .sp { display: flex; gap: 4px; }
.fm-sum .sp i { width: 18px; height: 9px; border-radius: 5px; background: rgba(255, 255, 255, 0.22); }
.fm-sum .sp i.on { background: linear-gradient(90deg, #ffe066, #ff9a3a); }
.fm-sum .sr { font-size: 15px; line-height: 1; }
.fm-sum .sr.rdy { color: var(--gold); font-size: 11px; background: #ff7a2f; padding: 3px 7px; border-radius: 9px; }
.fm-today { flex-wrap: wrap; overflow: visible; justify-content: center; row-gap: 5px; touch-action: auto; }
.fm-tdots { display: none; }
.fm-todaywrap::before, .fm-todaywrap::after { display: none; }
.fm-bigstar.on { animation-duration: 0.45s; }
.fm-rgoals { gap: 4px; }
.fm-rgoal { padding: 6px 10px; font-size: 14px; border-radius: 11px; }
.fm-rbtns .row { display: flex; gap: 12px; }
.fm-rbtns .row .fm-btn { flex: 1 1 0; min-width: 0; width: auto; }
.fm-rgoal .gs { font-size: 16px; }
.fm-rgoal.miss .gs { color: rgba(255, 255, 255, 0.3); }
@keyframes fmClaim { 0%, 100% { transform: scale(1) translateY(0); box-shadow: 0 0 6px 1px rgba(255, 154, 58, 0.6); } 12% { transform: scale(1.12) translateY(-3px); box-shadow: 0 0 16px 5px rgba(255, 207, 58, 0.95); } 24% { transform: scale(1) translateY(0); } 40% { box-shadow: 0 0 14px 4px rgba(255, 207, 58, 0.8); } 70% { box-shadow: 0 0 6px 1px rgba(255, 154, 58, 0.6); } }
.fm-sum .sr.rdy { animation: fmClaim 2s ease-in-out infinite; border: 2px solid #fff3b0; }

/* ---- compact centre: GÜNLÜK summary + SIRADAKİ HEDEF in ONE card; BUGÜN chips live in side rails ---- */
.fm-info.cmp { padding: 5px 8px 6px; gap: 4px; margin-bottom: 10px; }
.fm-info .fm-sgoal { width: 100%; height: 28px; margin: 0; padding: 0 9px; gap: 7px; border-width: 2px; border-radius: 10px; font-size: 12px; box-shadow: none; }
.fm-info .fm-sgoal .sg-t { font-size: 9.5px; }
.fm-info .fm-sgoal .sg-b { width: 48px; height: 8px; }
.fm-info .fm-sgoal.claim { animation: none; }
.fm-info .fm-sum { min-height: 24px; }
.fm-todaywrap { display: none !important; }
.fm-rails { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
.fm-rail { position: absolute; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 9px; pointer-events: none; }
.fm-rail.l { left: max(8px, calc(50% - 262px)); }
.fm-rail.r { right: max(8px, calc(50% - 262px)); }
.fm-rail > * { pointer-events: auto; }
.fm-rails .fm-globe, .fm-rails .fm-post { position: relative; left: auto; right: auto; top: auto; bottom: auto; }
.fm-rails .fm-globe { width: 50px; height: 50px; font-size: 25px; margin-bottom: 6px; }
.fm-rails .fm-post { width: 46px; height: 38px; margin: 2px 0 4px; }
.fm-rc { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; width: 62px; padding: 0; border: 0; background: none; cursor: pointer; touch-action: manipulation; }
.fm-rc .ri { position: relative; width: 46px; height: 46px; display: grid; place-items: center; border-radius: 50%; border: 3px solid var(--ink); font-size: 22px; line-height: 1; text-shadow: none;
  background: radial-gradient(ellipse 60% 38% at 36% 22%, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0)), linear-gradient(180deg, #ffffff, #cfe0ff); box-shadow: 0 4px 0 var(--ink2), 0 6px 8px rgba(10, 30, 60, 0.35); transition: transform 0.06s; }
.fm-rc:active .ri { transform: translateY(3px); }
.fm-rc .rl { max-width: 62px; padding: 1px 5px 2px; border-radius: 8px; background: rgba(14, 24, 60, 0.78); color: #fff; font-size: 10px; line-height: 1.15; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: none; }
.fm-rc.hot .ri { background: radial-gradient(ellipse 60% 38% at 36% 22%, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0)), linear-gradient(180deg, #fff3a8, #ffc23a); animation: fmDlWob 1.6s ease-in-out infinite; }
.fm-rc.hot .rl { background: #ff7a2f; }
.fm-rc.red .ri { background: linear-gradient(180deg, #ff7a7a, #e5293a); }
.fm-rc.red .rl { background: #e5293a; }
.fm-rc .fm-sring { width: 40px; height: 40px; }
.fm-rc .fm-sring circle { fill: none; stroke-width: 3.2; }
.fm-rc .fm-sring .bg { stroke: rgba(23, 52, 92, 0.18); }
.fm-rc .fm-sring .fg { stroke: #ff7a2f; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 12px 12px; }
.fm-rc .fm-sring text { font-size: 11px; text-anchor: middle; dominant-baseline: central; }
.fm-rails.fm-lock { filter: none !important; opacity: 1 !important; pointer-events: none; }
.fm-rails.fm-lock .fm-rc { filter: grayscale(1) brightness(0.8); opacity: 0.6; }
.fm-rails.fm-lock[data-lock]::after, .fm-rails.fm-new::after { display: none; }
@media (max-width: 360px) { .fm-rc { width: 54px; } .fm-rc .ri { width: 42px; height: 42px; font-size: 20px; } .fm-rc .rl { max-width: 54px; } }
@media (prefers-reduced-motion: reduce) { .fm-rc.hot .ri { animation: none; } }

/* ---- ŞANS ÇARKI ---- */
.fm-wheel {
  --ink: #17345c; --ink2: #0d1f3c; --gold: #ffcf3a;
  position: absolute; inset: 0; z-index: 90; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 20px 16px;
  font-family: "Lilita One", "Baloo 2", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-weight: 900; color: #fff; letter-spacing: 0.02em;
  text-shadow: 0 2px 0 var(--ink), 1.5px 1.5px 0 var(--ink), -1.5px 1.5px 0 var(--ink), 1.5px -1.5px 0 var(--ink), -1.5px -1.5px 0 var(--ink);
  background: radial-gradient(ellipse 70% 50% at 50% 45%, rgba(90, 60, 200, 0.75), rgba(16, 10, 50, 0.94)); user-select: none; -webkit-user-select: none; animation: fmIn 0.25s ease-out;
}
.fm-wheel * { box-sizing: border-box; }
.fm-wheel .wt { font-size: clamp(30px, 9vw, 42px); line-height: 1; text-align: center; transform: rotate(-2deg); }
.fm-wheel .ws { margin-top: -6px; font-size: 14px; color: #ffe27a; text-align: center; }
.fm-wheel .wbox { position: relative; width: min(84vw, 52vh, 360px); aspect-ratio: 1; }
.fm-wheel .wbox::before { content: ""; position: absolute; inset: -14px; border-radius: 50%; background: radial-gradient(circle, rgba(255, 220, 120, 0.45), rgba(255, 220, 120, 0) 70%); animation: fmWGlow 1.6s ease-in-out infinite alternate; }
@keyframes fmWGlow { from { opacity: 0.55; } to { opacity: 1; } }
.fm-wheel svg.wh { position: relative; display: block; width: 100%; height: 100%; filter: drop-shadow(0 8px 0 var(--ink2)) drop-shadow(0 14px 18px rgba(0, 0, 0, 0.45)); }
.fm-wheel .wrot { will-change: transform; }
.fm-wheel svg text { font-family: inherit; font-weight: 900; paint-order: stroke; stroke: rgba(23, 52, 92, 0.85); stroke-width: 3px; fill: #fff; text-anchor: middle; dominant-baseline: central; }
.fm-wheel svg text.dk { fill: #17345c; stroke: #fff; }
.fm-wheel .wptr { position: absolute; left: 50%; top: -16px; width: 38px; height: 46px; margin-left: -19px; z-index: 2; transform-origin: 50% 22%; filter: drop-shadow(0 3px 0 var(--ink2)); }
.fm-wheel .wptr.tk { animation: fmWTick 0.12s ease-out; }
@keyframes fmWTick { 0% { transform: rotate(0); } 40% { transform: rotate(-16deg); } 100% { transform: rotate(0); } }
.fm-wheel button.wgo {
  min-width: 200px; min-height: 64px; padding: 8px 26px; border: 4px solid var(--ink); border-radius: 24px; cursor: pointer; font-size: 30px; letter-spacing: 0.06em; color: #fff;
  background: linear-gradient(180deg, #ffe066 0%, #ffae00 50%, #ff7a1a 100%); box-shadow: 0 7px 0 #a8400f, 0 12px 16px rgba(0, 0, 0, 0.4), inset 0 4px 0 rgba(255, 255, 255, 0.6);
  text-shadow: 0 3px 0 var(--ink), 2px 2px 0 var(--ink), -2px 2px 0 var(--ink), 2px -2px 0 var(--ink), -2px -2px 0 var(--ink); animation: fmBreath 1.2s ease-in-out infinite;
}
.fm-wheel button.wgo:active { transform: translateY(5px); box-shadow: 0 2px 0 #a8400f; }
.fm-wheel button.wgo[disabled] { animation: none; filter: grayscale(0.4) brightness(0.85); cursor: default; }
.fm-wheel button.wx { position: absolute; right: 14px; top: calc(var(--sat, env(safe-area-inset-top, 0px)) + 12px); width: 44px; height: 44px; border-radius: 50%; border: 3px solid var(--ink); background: #fff; color: var(--ink); font-size: 20px; text-shadow: none; cursor: pointer; }
.fm-wheel .wres { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 18px 16px; max-width: 340px; border-radius: 24px; border: 4px solid var(--ink); text-align: center;
  background: linear-gradient(180deg, #ffffff, #e2ecff); color: var(--ink); text-shadow: none; box-shadow: 0 6px 0 var(--ink2), 0 14px 20px rgba(0, 0, 0, 0.4); animation: fmPopIn 0.5s cubic-bezier(.2, 1.4, .4, 1); }
/* */
.fm-wheel .wres { position: relative; }
.fm-wheel .wres .ri { font-size: 46px; line-height: 1; }
.fm-wheel .wres .rt { font-size: 26px; line-height: 1.05; color: #ff5a1f; }
.fm-wheel .wres .rd { font-size: 17px; line-height: 1.25; }
.fm-wheel .wres .rd b { color: #ff5a1f; }
.fm-wheel .wres button.wok { min-width: 160px; min-height: 52px; border: 3px solid var(--ink); border-radius: 18px; cursor: pointer; font-size: 22px; color: #fff; letter-spacing: 0.06em;
  background: linear-gradient(180deg, #a6ec6a, #35c46a); box-shadow: 0 5px 0 #1e8a49; text-shadow: 0 2px 0 var(--ink), 1px 1px 0 var(--ink), -1px 1px 0 var(--ink); }
.fm-wheel .wres button.wok:active { transform: translateY(4px); box-shadow: 0 1px 0 #1e8a49; }
.fm-wheel.done .wbox { transform: scale(0.82); transition: transform 0.4s; }
@media (max-height: 640px) { .fm-wheel { gap: 8px; } .fm-wheel .wt { font-size: 28px; } }
@media (prefers-reduced-motion: reduce) { .fm-wheel button.wgo, .fm-wheel .wbox::before { animation: none; } }
`;

// ================================================================================================================ helpers

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmt = (n) => String(Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function fmtDist(m) {
  m = Math.max(0, Math.round(m || 0));
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${m} m`;
}
function fmtTons(t) {
  const kg = Math.round((t || 0) * 1000);
  if (kg < 1000) return `${kg} kg`;
  const t1 = Math.round(t * 10) / 10;
  return t1 < 10 ? `${t1.toFixed(1).replace('.', ',')} ton` : `${fmt(Math.round(t))} ton`;
}
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}
function clear(e) {
  while (e.firstChild) e.removeChild(e.firstChild);
}
function button(cls, text, fn, label) {
  const b = el('button', cls, text);
  b.setAttribute('type', 'button');
  if (label) b.setAttribute('aria-label', label);
  if (fn) b.addEventListener('click', (e) => { if (e && e.stopPropagation) e.stopPropagation(); fn(e); });
  return b;
}
function setCss(e, k, v) {
  e.style.setProperty(k, v);
}
const nameOf = (list, id) => (list.find((x) => x.id === id) || { name: id }).name;

// reward spec / given-reward -> ['❄️ 100', '💎 1', ...]

const DIARY = [
  { a: '⛰️⛄', t: 'Dağın Eteği', x: 'Yeti ilk kez minik bir kar topunun dağdan yuvarlandığını gördü. "Bu da kim?" diye homurdandı. Kar topu cevap yerine neşeyle zıpladı. Yarış başlamıştı bile!', u: 'a1' },
  { a: '🌲❄️', t: 'Çam Ormanı', x: 'Kar topu büyüdükçe ağaçların arasından kıkırdayarak geçti. Yeti peşinden koştu ama kocaman ayakları çamlara takıldı. "Bir dakika bekle!" diye seslendi.', u: 'a2' },
  { a: '🧊🐧', t: 'Buz Gölü', x: 'Penguenler gölde kayanları izledi. Kar topu kaydı, Yeti de kaydı. İkisi aynı anda poposunun üstüne düştü. Birlikte güldüler, ilk kez!', u: 'a3' },
  { a: '🔥🏕️', t: 'Kamp Ateşi', x: 'Gece Yeti küçük bir ateş yaktı. Kar topu uzaktan baktı, erimekten korktu. Yeti ona sıcak kakao yerine bir kar bardağı uzattı. Dostluk böyle başladı.', u: 'a5' },
  { a: '🌨️🎿', t: 'Fırtına Gecesi', x: 'Dev bir fırtına dağı sardı. Kar topu rüzgarda savrulurken Yeti onu iki eliyle yakaladı. "Seni kaybetmem," dedi. Sabaha kadar sarılıp beklediler.', u: 'a7' },
  { a: '🏔️👑', t: 'Zirvenin Sırrı', x: 'Zirveye varınca Yeti anladı: her şey yarış değildi. Kar topu en büyük kış armağanıydı. Birlikte gün doğumunu izlediler, ikisi de çok mutluydu.', u: 'a10' },
  { a: '🗻😤', t: 'Dev Çığ', x: 'Dağın tepesinden kocaman bir çığ koptu! Kar topu telaşla yuvarlandı. Yeti: "Hızlı ol, benim sırtıma atla!" Çığ onları bir an bile yakalayamadı.', u: 'c8' },
  { a: '🪨💨', t: 'Kaya Tarlası', x: 'Kayaların arasında zıplayan kar topu tek başına kaldı. Yeti yolu temizlemek için koca bir kayayı itti. "Hep birlikte," dedi gülümseyerek.', u: 'c16' },
  { a: '🌌✨', t: 'Yıldızlı Yamaç', x: 'Gökyüzü yıldızlarla doldu. Kar topu bir dilek tuttu: "Hiç küçülmeyeyim." Yeti de gizlice dilekte bulundu: "Hep yanımda olsun."', u: 'c24' },
  { a: '🎉⛄', t: 'Kış Şenliği', x: 'Son dağ da aşıldı! Tüm dağ halkı şenlik yaptı. Yeti ve kar topu el ele, yani el ve top, dans etti. Artık rakip değil, en iyi arkadaştılar. SON', u: 'c30' },
];
function diaryOpen(i) {
  try {
    const u = DIARY[i].u, n = +u.slice(1);
    if (u[0] === 'a') return !!meta.campaign().actDone(n);
    return (save.cigCleared() | 0) >= n;
  } catch { return false; }
}
function rewardChips(r) {
  const out = [];
  if (!r) return out;
  if (r.coins) out.push(`❄️ ${fmt(r.coins)}`);
  if (r.crystals) out.push(`💎 ${r.crystals}`);
  if (r.boxes) out.push(`🎁 ${r.boxes}`);
  if (r.sleds) out.push(`🛷 ${r.sleds}`);
  if (r.skin) out.push(`👕 ${nameOf(SKINS, r.skin)}`);
  if (r.trail) out.push(`✨ ${nameOf(TRAILS, r.trail)}`);
  return out;
}
const rewardLine = (r) => rewardChips(r).join('  ');

function previewEl(kind, id) {
  const list = kind === 'skin' ? SKINS : TRAILS;
  const it = list.find((x) => x.id === id);
  const pv = (it && it.preview) || { a: '#fff', b: '#cfe2f7' };
  const d = el('div', `fm-prev ${kind === 'trail' ? 'trail' : 'ball'}`);
  d.style.background = kind === 'trail' ? `linear-gradient(270deg, ${pv.a}, ${pv.b})` : `radial-gradient(circle at 34% 30%, ${pv.a}, ${pv.b} 92%)`;
  return d;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  if (!document.getElementById('freemon-font')) {
    try {
      const lk = document.createElement('link');
      lk.id = 'freemon-font';
      lk.setAttribute('rel', 'stylesheet');
      lk.setAttribute('href', 'https://fonts.googleapis.com/css2?family=Lilita+One&display=swap');
      (document.head || document.body).appendChild(lk);
    } catch { /* offline / blocked: falls back to system-ui 900 */ }
  }
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  (document.head || document.body).appendChild(st);
}

// ================================================================================================================ factory

export function createMenus({ save, meta, root, callbacks = {} } = {}) {
  injectStyle();
  const host = root || document.getElementById('app') || document.body;
  const LM_KEY = 'patpat.lastMode';
  const lastSet = (o) => { try { localStorage.setItem(LM_KEY, JSON.stringify(o)); } catch { /* ignore */ } };
  const lastGet = () => { try { return JSON.parse(localStorage.getItem(LM_KEY) || 'null'); } catch { return null; } };
  const LM_WRAP = { onEndless: () => ({ k: 'rush' }), onCigEndless: () => ({ k: 'cigE' }), onAgar: () => ({ k: 'arena' }), onCigLevel: (a) => ({ k: 'cigL', n: a[0] }), onPlayLevel: (a) => ({ k: 'camp', n: a[0] }) };
  const cb = new Proxy(callbacks || {}, { get(t, k) { const f = t[k]; if (typeof f === 'function' && LM_WRAP[k]) return (...a) => { try { lastSet(LM_WRAP[k](a)); } catch { /* ignore */ } return f.apply(t, a); }; return f; } });
  const sfx = (k) => { try { if (cb.sfx) cb.sfx(k); } catch { /* audio is optional */ } };
  const toggles = () => {
    try { return { sound: true, music: true, haptics: true, visualName: 'NORMAL', ...(cb.getToggles ? cb.getToggles() : {}) }; } catch { return { sound: true, music: true, haptics: true, visualName: 'NORMAL' }; }
  };
  const hasRAF = typeof requestAnimationFrame === 'function';

  let refs = null;          // main screen elements
  let mainOpen = false;
  let info = { level: 1, levelStars: 0, theme: '', endlessBest: 0, endlessBestDist: 0, dailyNum: 1, dailyBest: 0, coins: 0 };
  let activePanel = null;
  let modalEl = null;
  let boxEl = null;
  let mainTimer = 0;
  let tick = 0;
  const offs = [];

  // ---- persistent layers ----
  const toastLayer = el('div', 'fm-toasts');
  toastLayer.setAttribute('aria-live', 'polite');
  const fxLayer = el('div', 'fm-fx');
  host.appendChild(toastLayer);
  host.appendChild(fxLayer);

  const coins = () => (save && Number.isFinite(save.coins) ? save.coins : info.coins || 0);
  // shop prices always come from save.shopPrice (one-time ŞANS ÇARKI coupon aware); charging goes through save.shopCharge
  const shopPrice = (base) => { try { return save.shopPrice ? save.shopPrice(base) : base; } catch { return base; } };
  const couponPct = () => { try { const c = save.coupon && save.coupon(); return c ? c.pct : 0; } catch { return 0; } };

  // ============================================================================================ fx helpers

  // Menu / result celebrations get the full shower; during a run (the runner calls this for a new record) it is only a light, quick
  // sprinkle so the track stays readable.
  function confetti(n = 60) {
    const colors = ['#ff5d73', '#ffb02e', '#ffe14a', '#5fe08a', '#3fc1ff', '#b07bff', '#ffffff'];
    const inRun = !mainOpen && !activePanel && !modalEl && !boxEl && !resultEl;
    if (inRun) n = Math.min(n, 16);
    if (fxLayer.childElementCount > 140) return;
    for (let i = 0; i < n; i++) {
      const c = el('i', 'fm-cf');
      setCss(c, '--x', `${Math.random() * 100}%`);
      setCss(c, '--dx', `${Math.round((Math.random() - 0.5) * 160)}px`);
      setCss(c, '--r', `${Math.round(360 + Math.random() * 900)}deg`);
      setCss(c, '--d', `${(inRun ? 1.0 + Math.random() * 0.7 : 1.8 + Math.random() * 1.6).toFixed(2)}s`);
      setCss(c, '--c', colors[i % colors.length]);
      c.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
      fxLayer.appendChild(c);
      setTimeout(() => c.remove(), inRun ? 2400 : 3800);
    }
  }

  function burst(parent, emoji, n = 14, dist = 90) {
    for (let i = 0; i < n; i++) {
      const f = el('span', 'fm-burst', emoji);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const d = dist * (0.55 + Math.random() * 0.6);
      setCss(f, '--dx', `${Math.round(Math.cos(a) * d)}px`);
      setCss(f, '--dy', `${Math.round(Math.sin(a) * d * 0.85 - 10)}px`);
      parent.appendChild(f);
      setTimeout(() => f.remove(), 1200);
    }
  }

  const center = (e) => {
    const r = e && e.getBoundingClientRect ? e.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const o = fxLayer.getBoundingClientRect ? fxLayer.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2 };
  };

  // emoji particles flying from one element to another (coins into the counter), then done()
  function fly(from, to, emoji, n, done) {
    if (!from || !to) { if (done) done(); return; }
    const a = center(from), b = center(to);
    for (let i = 0; i < n; i++) {
      const f = el('span', 'fm-fly', emoji);
      f.style.left = `${Math.round(a.x + (Math.random() - 0.5) * 30)}px`;
      f.style.top = `${Math.round(a.y + (Math.random() - 0.5) * 20)}px`;
      setCss(f, '--dx', `${Math.round(b.x - a.x)}px`);
      setCss(f, '--dy', `${Math.round(b.y - a.y)}px`);
      f.style.animationDelay = `${i * 55}ms`;
      fxLayer.appendChild(f);
      setTimeout(() => f.remove(), 900 + i * 55 + 80);
    }
    setTimeout(() => { if (done) done(); }, 780 + n * 55);
  }

  // numeric pill (❄️ / 💎) with count-up
  function makePill(icon, cls, onPlus, base) {
    const box = el('div', `${base || 'fm-pill'} ${cls || ''}`.trim());
    const ico = el('span', 'ico', icon);
    const num = el('span', 'num', '0');
    add(box, ico, num);
    if (onPlus) box.appendChild(button('fm-plus', '+', onPlus, 'Ekle'));
    let shown = 0;
    let raf = 0;
    return {
      el: box,
      num,
      set(target, animate) {
        const from = shown;
        shown = target;
        if (hasRAF && raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        if (!animate || from === target || !hasRAF) { num.textContent = fmt(target); return; }
        box.classList.remove('bump');
        void box.offsetWidth;
        box.classList.add('bump');
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / 450);
          num.textContent = fmt(Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3))));
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
    };
  }

  // ============================================================================================ toasts

  const toastQ = [];
  let toastBusy = false;
  const toastSeen = new Map();
  const toastOnce = new Set(); // each stamp toast at most once per session

  function pumpToast() {
    if (toastBusy || !toastQ.length) return;
    toastBusy = true;
    const t = toastQ.shift();
    const box = el('div', `fm-toast ${t.kind || ''}`.trim());
    const body = el('div', 'tb');
    add(body, el('div', 'tt', t.title), t.sub ? el('div', 'ts', t.sub) : null);
    add(box, el('div', 'ti', t.icon || '🏆'), body);
    toastLayer.appendChild(box);
    void box.offsetWidth;
    if (t.onTap) { box.classList.add('tap'); box.addEventListener('click', () => { try { t.onTap(); } catch { /* ignore */ } box.remove(); toastBusy = false; pumpToast(); }); }
    box.classList.add('on');
    setTimeout(() => {
      box.classList.remove('on');
      setTimeout(() => { if (!box.isConnected) return; box.remove(); toastBusy = false; pumpToast(); }, 380);
    }, t.ms || 2700);
  }
  function toast(t) {
    if (!t || !t.title) return;
    if (/^Yeni damga/.test(t.title)) { const tk = `${t.title}|${t.sub || ''}`; if (toastOnce.has(tk)) return; toastOnce.add(tk); }
    if (toastQ.length >= 4) toastQ.splice(1, 1);
    toastQ.push(t);
    pumpToast();
  }

  function toastAchievement(a, extra) {
    if (!a) return;
    const nowT = Date.now();
    if (toastSeen.has(a.id) && nowT - toastSeen.get(a.id) < 4000) return;
    toastSeen.set(a.id, nowT);
    const reward = extra && extra.reward ? extra.reward : a.reward;
    const line = rewardLine(reward);
    toast({
      icon: a.icon || '🏆',
      title: `🏆 ${a.name}`,
      sub: extra && extra.auto ? `${line ? `${line} · ` : ''}SIR BULUNDU!` : (line ? `${line} · ÖDÜL BAŞARIMLAR'DA` : ''),
      kind: a.secret ? 'egg' : '',
    });
    if (mainOpen) updateMain();
  }

  // ============================================================================================ panels

  function closePanel(silent) {
    const p = activePanel;
    if (!p) return;
    activePanel = null;
    for (const t of p.timers) { clearInterval(t); clearTimeout(t); }
    p.el.remove();
    if (p.onClose) p.onClose();
    if (!silent && mainOpen) updateMain();
  }

  function openPanel({ id, title, sub = '', pills = ['coins'], tabs = null, onTab = null, raw = false }) {
    sfx('open'); closePanel(true);
    const ov = el('div', `fm-ov fm-p-${id}`);
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', title);

    const p = { id, el: ov, timers: [], pills: {}, onClose: null, list: null, body: null, setSub: null, refreshPills: null, tab: 0 };

    const head = el('div', 'fm-head');
    const titles = el('div', 'fm-titles');
    const subEl = el('div', 'fm-sub', sub);
    add(titles, el('div', title.length > 11 ? 'fm-title long' : 'fm-title', title), subEl);
    p.setSub = (s) => { subEl.textContent = s; };
    const pillBox = el('div', 'fm-pills');
    if (pills.includes('coins')) { p.pills.coins = makePill('❄️'); add(pillBox, p.pills.coins.el); }
    if (pills.includes('crystals')) { p.pills.crystals = makePill('💎', 'cr'); add(pillBox, p.pills.crystals.el); }
    p.refreshPills = (animate) => {
      if (p.pills.coins) p.pills.coins.set(coins(), animate);
      if (p.pills.crystals) p.pills.crystals.set(meta.crystals, animate);
    };
    p.refreshPills(false);
    const x = button('fm-x', '✕', () => { sfx('close'); closePanel(); }, 'Kapat');
    add(head, titles, x);
    if (pillBox.firstChild) head.appendChild(pillBox);
    add(ov, head);

    if (tabs) {
      const tb = el('div', 'fm-tabs');
      const els = tabs.map((name, i) => {
        const t = button(`fm-tab${i === 0 ? ' on' : ''}`, name, () => {
          if (p.tab === i) return;
          p.tab = i;
          els.forEach((e2, j) => e2.classList.toggle('on', j === i));
          sfx('click');
          if (p.body) p.body.scrollTop = 0;
          if (onTab) onTab(i);
        });
        return t;
      });
      add(tb, ...els);
      add(ov, tb);
    }

    const body = el('div', 'fm-body');
    const list = el('div', 'fm-list');
    if (!raw) body.appendChild(list);
    // The game blocks document-level touchmove (iOS rubber band); keep drags inside the scroller from ever reaching it.
    body.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    add(ov, body);
    p.body = body;
    p.list = list;
    host.appendChild(ov);
    activePanel = p;
    return p;
  }

  // ---------------------------------------------------------------------------------------------- daily reward

  function openDaily() {
    sfx('click');
    const p = openPanel({ id: 'daily', title: 'GÜNLÜK ÖDÜL', pills: ['coins', 'crystals'] });
    let claiming = false;
    let todayEl = null;
    let claimBtn = null;

    function card(day, d) {
      const r = meta.dailyReward(day);
      const claimedUntil = d.available ? d.day - 1 : d.day;
      const state = day <= claimedUntil ? 'claimed' : d.available && day === d.day ? 'today' : 'locked';
      const c = el('div', `fm-dcard ${state}${day === 7 ? ' big' : ''}`);
      const info1 = el('div', day === 7 ? 'fm-dinfo' : '');
      const label = el('div', 'dl', day === 7 ? 'GÜN 7 · BÜYÜK ÖDÜL' : `GÜN ${day}`);
      let icon;
      let val;
      if (r.skin || r.trail) {
        icon = el('div', 'di');
        icon.appendChild(previewEl(r.skin ? 'skin' : 'trail', r.skin || r.trail));
        val = el('div', 'dn', r.skin ? nameOf(SKINS, r.skin) : nameOf(TRAILS, r.trail));
      } else {
        icon = el('div', 'di', day >= 6 ? '❄️❄️' : '❄️');
        val = el('div', 'dv', `+${fmt(r.coins)}`);
      }
      const extra = r.crystals ? el('div', 'dx', `+💎 ${r.crystals}`) : null;
      const st = el('div', 'dst', state === 'claimed' ? '✓' : state === 'today' ? 'AL!' : '🔒');
      if (day === 7) {
        add(info1, label, val, extra);
        add(c, icon, info1, st);
      } else {
        add(c, label, icon, val, extra, st);
      }
      if (state === 'today') todayEl = c;
      return c;
    }

    function render() {
      const d = meta.daily();
      clear(p.list);
      todayEl = null;
      claimBtn = null;
      p.setSub(d.streak > 0 ? `🔥 SERİ ${d.streak} GÜN` : 'HER GÜN GEL, KAZAN');

      let hol = null;
      try { hol = meta.holiday(); } catch { hol = null; }
      if (hol && !hol.claimed) {
        const hb = button('fm-btn big green', `${hol.emoji} ${hol.name}: AL ${rewardLine({ coins: hol.coins })}`, () => {
          const rr = meta.claimHoliday();
          if (!rr) { render(); return; }
          sfx('reward');
          if (cb.onReward) { try { cb.onReward('holiday', rr); } catch { /* ignore */ } }
          confetti(40);
          fly(hb, p.pills.coins && p.pills.coins.el, '❄️', 8, () => p.refreshPills(true));
          setTimeout(() => { if (activePanel === p) render(); if (mainOpen) updateMain(); }, 900);
        });
        p.list.appendChild(hb);
        p.list.appendChild(el('div', 'fm-note', hol.msg));
      }
      const sb = el('div', 'fm-streak');
      const flame = el('div', 'fl', d.streak > 0 ? '🔥' : '🌱');
      const txt = el('div', '');
      add(txt, el('div', 'st', d.streak > 0 ? `${d.streak} günlük seri!` : 'Serini başlat!'));
      const sd = d.grace
        ? 'Bir günü kaçırdın ama seri bozulmadı. Bu hoşgörü günü!'
        : 'Bir gün atlarsan seri bozulmaz. İki gün atlarsan sıfırlanır.';
      add(txt, el('div', 'sd', sd));
      add(sb, flame, txt);
      p.list.appendChild(sb);

      const grid = el('div', 'fm-dgrid');
      for (let day = 1; day <= 7; day++) grid.appendChild(card(day, d));
      p.list.appendChild(grid);

      if (d.available) {
        claimBtn = button('fm-btn big glow', 'ÖDÜLÜ AL!', claim);
        p.list.appendChild(claimBtn);
      } else {
        const cd = el('div', 'fm-cd');
        const label = el('span', '', 'SONRAKİ ÖDÜL');
        const clock = el('b', '', fmtClock(d.nextInMs));
        add(cd, label, clock);
        p.list.appendChild(cd);
        const iv = setInterval(() => {
          const nd = meta.daily();
          if (nd.available) { clearInterval(iv); if (activePanel === p && !claiming) render(); return; }
          clock.textContent = fmtClock(nd.nextInMs);
        }, 1000);
        p.timers.push(iv);
      }
    }

    function claim() {
      if (claiming) return;
      const r = meta.claimDaily();
      if (!r) { render(); return; }
      claiming = true;
      sfx('reward');
      if (cb.onReward) { try { cb.onReward('daily', r); } catch { /* ignore */ } }
      const src = todayEl || claimBtn;
      if (r.coins) fly(src, p.pills.coins && p.pills.coins.el, '❄️', 9, () => p.refreshPills(true));
      if (r.crystals) fly(src, p.pills.crystals && p.pills.crystals.el, '💎', Math.min(6, 2 + r.crystals), () => p.refreshPills(true));
      if (r.skin || r.trail) {
        toast({ icon: '👕', title: 'YENİ EŞYA!', sub: r.skin ? nameOf(SKINS, r.skin) : nameOf(TRAILS, r.trail), kind: 'gold' });
      }
      confetti(r.skin || r.trail ? 70 : 36);
      if (todayEl) todayEl.classList.add('fm-popc');
      const t = setTimeout(() => {
        claiming = false;
        if (activePanel === p) { render(); p.refreshPills(true); }
        if (mainOpen) updateMain();
      }, 1150);
      p.timers.push(t);
    }

    render();
    return p;
  }

  // ---------------------------------------------------------------------------------------------- achievements

  function seasonRewardTxt(t) {
    if (t.coins) return ['❄️', '+' + t.coins];
    if (t.crystals) return ['💎', '+' + t.crystals];
    if (t.boxes) return ['🎁', 'Kutu x' + t.boxes];
    if (t.trail) return ['✨', nameOf(TRAILS, t.trail)];
    return ['👕', nameOf(SKINS, t.skin)];
  }
  function openSeason() {
    sfx('click');
    const p = openPanel({ id: 'season', title: 'SEZON AVI', pills: ['coins', 'crystals'] });
    const draw = () => {
      const s = meta.season();
      p.setSub(`🧣 ${s.tokens} · Ödül ${s.claimed}/${s.total} · ${s.daysLeft} gün kaldı`);
      clear(p.list);
      const nx = s.tiers.find((t) => t.state === 'locked');
      const prev = nx ? (s.tiers[nx.n - 2] ? s.tiers[nx.n - 2].need : 0) : 0;
      const frac = nx ? Math.min(1, (s.tokens - prev) / Math.max(1, nx.need - prev)) : 1;
      const bar = el('div', 'fm-seabar'); const f = el('i'); f.style.width = Math.round(frac * 100) + '%'; bar.appendChild(f);
      p.list.appendChild(el('div', 'fm-sec', nx ? `SONRAKİ ÖDÜL: ${s.tokens}/${nx.need} 🧣` : 'TÜM ÖDÜLLER TAMAM!'));
      p.list.appendChild(bar);
      p.list.appendChild(el('div', 'fm-sec', 'Rush koşusunda eşarp topla, ödülleri aç. Sezon bitince yeni sezon başlar.'));
      const tr = el('div', 'fm-seatrack');
      for (const t of s.tiers) {
        const [ic, tx] = seasonRewardTxt(t);
        const c = el('div', `fm-seacard ${t.state === 'ready' ? 'ready' : t.state === 'claimed' ? 'claimed' : 'lk'}`);
        add(c, el('div', 'sn', '#' + t.n), el('div', 'si', ic), el('div', 'sn', tx), el('div', 'sn', t.state === 'claimed' ? '✓' : `🧣 ${t.need}`));
        if (t.state === 'ready') c.appendChild(button('sb', 'AL!', () => {
          const g = meta.seasonClaim(t.n);
          if (g) { sfx('confirm'); confetti(30); toast({ icon: ic, title: 'SEZON ÖDÜLÜ', sub: tx, kind: 'gold', ms: 1800 }); p.refreshPills(true); draw(); updateMain(); }
        }));
        tr.appendChild(c);
      }
      p.list.appendChild(tr);
    };
    draw();
  }
  function openPassport() {
    sfx('click');
    const p = openPanel({ id: 'pass', title: 'KIŞ PASAPORTU', pills: ['coins'] });
    const list = meta.stamps();
    p.setSub(`${list.filter((x) => x.got).length}/${list.length} DAMGA`);
    const grid = el('div', 'fm-stamps');
    for (const x of list) grid.appendChild(add(el('div', `fm-stamp${x.got ? ' got' : ''}`), el('div', 'si', x.got ? x.icon : '❔'), el('div', 'sn', x.name), el('div', 'sd', x.desc)));
    const ach = ACHIEVEMENTS.map((d) => ({ d, pr: meta.progress(d.id) }));
    const shelf = (title, items, cls, locked) => {
      const s = el('div', 'fm-shelf');
      const bd = el('div', 'fm-board');
      const cap = el('div', 'fm-shcap', '');
      for (const it of items) { const t = el('div', `fm-troph ${cls}`, it.icon); t.title = it.name; t.addEventListener('click', () => { cap.textContent = it.name; }); bd.appendChild(t); }
      const lk = (locked || []).slice(0, Math.max(3, Math.min(5, 6 - items.length)));
      for (const it of lk) { const t = el('div', `fm-troph lock ${cls}`, it.icon); t.title = `${it.name} (kilitli)`; t.appendChild(el('span', 'lk', '🔒')); t.addEventListener('click', () => { cap.textContent = `🔒 ${it.name}`; }); bd.appendChild(t); }
      if (!items.length && !lk.length) bd.appendChild(el('div', 'fm-empty', 'Henüz yok...'));
      add(s, el('div', 'hd', title), bd, el('div', 'fm-plank'), cap);
      return s;
    };
    p.list.appendChild(el('div', 'fm-note', 'ROZET RAFI'));
    const modeOf = (x) => (/^ARENA/.test(x.desc) ? 'ARENA' : /^(ÇIĞ|Gece|Günün)/.test(x.desc) ? 'ÇIĞ' : /^MACERA/.test(x.desc) ? 'MACERA' : 'YETİ RUSH');
    const groups = {};
    const lockedG = {};
    for (const x of list) { const g = x.got ? groups : lockedG; (g[modeOf(x)] = g[modeOf(x)] || []).push(x); }
    for (const k of ['YETİ RUSH', 'ÇIĞ', 'MACERA', 'ARENA']) p.list.appendChild(shelf(`${k} · ${(groups[k] || []).length} damga`, groups[k] || [], 'st', lockedG[k] || []));
    const doneA = ach.filter((x) => x.pr.done).map((x) => x.d);
    p.list.appendChild(shelf(`BAŞARIMLAR · ${doneA.length}/${ach.length}`, doneA.slice(0, 40), 'ach', ach.filter((x) => !x.pr.done && !x.d.secret).map((x) => x.d)));
    const next = ach.filter((x) => !x.pr.done && !x.d.secret && x.pr.goal > 1).sort((a, b) => b.pr.value / b.pr.goal - a.pr.value / a.pr.goal).slice(0, 3);
    if (next.length) {
      p.list.appendChild(el('div', 'fm-note', 'AÇILMAYA EN YAKIN 3'));
      for (const x of next) {
        const rr = el('div', 'fm-row');
        const bar = el('div', 'fm-abar'); const b = el('div', 'fm-bar'); const fill = el('i');
        setCss(fill, '--p', `${Math.round((x.pr.value / x.pr.goal) * 100)}%`);
        b.appendChild(fill);
        add(bar, b, el('div', 'fm-bn', `${fmt(x.pr.value)}/${fmt(x.pr.goal)}`));
        add(rr, el('div', 'fm-aico', x.d.icon), add(el('div', 'fm-amid'), el('div', 'fm-an', x.d.name), el('div', 'fm-ad', x.d.desc), bar));
        p.list.appendChild(rr);
      }
    }
    return p;
  }

  function coinFly(from) {
    try {
      const r0 = from.getBoundingClientRect(); const h = host.getBoundingClientRect();
      for (let i = 0; i < 8; i++) {
        const c = el('div', 'fm-cfly', '❄️');
        c.style.left = `${r0.left - h.left + r0.width / 2 + (i - 4) * 8}px`; c.style.top = `${r0.top - h.top + r0.height / 2}px`; c.style.animationDelay = `${i * 60}ms`;
        host.appendChild(c); setTimeout(() => c.remove(), 1300 + i * 60);
      }
    } catch { /* ignore */ }
  }

  function openPostcard() {
    sfx('click');
    const p = openPanel({ id: 'post', title: 'YETİ POSTASI', pills: ['coins'] });
    let c = null;
    try { c = meta.postcard(); } catch { /* ignore */ }
    if (!c) return p;
    p.setSub(c.available ? 'BUGÜNKÜ KART' : 'BUGÜNÜN KARTI');
    const card = add(el('div', 'fm-card'), el('div', 'st', 'YETİ POSTASI'), el('div', 'yt', '🦣'), el('div', 'tx', c.msg), el('div', 'cp', `🎟️ KUPON: +${c.coins} ❄️`));
    p.list.appendChild(card);
    if (c.available) {
      const bt = button('fm-btn glow', 'KUPONU AL', () => {
        let g = null;
        try { g = meta.openPostcard(); } catch { /* ignore */ }
        if (g) { sfx('confirm'); confetti(40); coinFly(bt); toast({ icon: '✉️', title: `+${g.coins} ❄️`, sub: 'Yeti Postası kuponu', kind: 'gold', ms: 2200 }); }
        bt.remove(); updateMain();
      });
      p.list.appendChild(bt);
    } else p.list.appendChild(el('div', 'fm-note', 'Kupon alındı. Yarın yeni kart gelecek!'));
    return p;
  }

  function openAchievements() {
    sfx('click');
    const p = openPanel({ id: 'ach', title: 'BAŞARIMLAR', tabs: ['TÜMÜ', 'AÇIK', 'GİZLİ'], onTab: () => render(), pills: ['coins', 'crystals'] });
    const secretHint = (def) => def.hint || 'Gizli bir şey var...';

    function row(def) {
      const pr = meta.progress(def.id);
      const hidden = def.secret && !pr.done;
      const r = el('div', `fm-row${pr.done ? ' done' : ''}${pr.claimed ? ' claimed' : ''}${hidden ? ' secret' : ''}`);
      const ico = el('div', 'fm-aico', hidden ? '❓' : def.icon);
      const mid = el('div', 'fm-amid');
      add(mid, el('div', 'fm-an', hidden ? '???' : def.name), el('div', 'fm-ad', hidden ? `İpucu: ${secretHint(def)}` : def.desc));
      if (!hidden && def.goal > 1) {
        const bar = el('div', 'fm-abar');
        const b = el('div', 'fm-bar');
        const fill = el('i');
        setCss(fill, '--p', `${Math.round((pr.value / pr.goal) * 100)}%`);
        b.appendChild(fill);
        add(bar, b, el('div', 'fm-bn', `${fmt(pr.value)}/${fmt(pr.goal)}`));
        mid.appendChild(bar);
      }
      mid.appendChild(el('div', 'fm-ar', hidden ? '🎁 ???' : rewardLine(def.reward)));
      add(r, ico, mid);
      if (pr.done && !pr.claimed) {
        const claimBtn = button('fm-btn sm glow', 'AL', () => claimOne(def, r, claimBtn));
        r.appendChild(claimBtn);
      } else if (pr.claimed) {
        r.appendChild(el('div', 'fm-ok', '✓'));
      }
      return r;
    }

    function claimOne(def, rowEl, btn) {
      const given = meta.claimAchievement(def.id);
      if (!given) { render(); return; }
      sfx('reward');
      if (cb.onReward) { try { cb.onReward('achievement', given); } catch { /* ignore */ } }
      if (given.coins) fly(btn, p.pills.coins.el, '❄️', 6, () => p.refreshPills(true));
      if (given.crystals) fly(btn, p.pills.crystals.el, '💎', 3, () => p.refreshPills(true));
      if (given.skin || given.trail) toast({ icon: '🎁', title: 'YENİ EŞYA!', sub: given.skin ? nameOf(SKINS, given.skin) : nameOf(TRAILS, given.trail), kind: 'gold' });
      rowEl.classList.add('fm-popc');
      const keep = p.body.scrollTop;
      const t = setTimeout(() => { if (activePanel === p) { render(); p.body.scrollTop = keep; } }, 700);
      p.timers.push(t);
    }

    function render() {
      clear(p.list);
      let unclaimed = meta.unclaimedCount();
    try { unclaimed += meta.season().ready | 0; } catch { /* ignore */ }
    try { unclaimed += Math.max(0, meta.stamps().filter((x) => x.got).length - (parseInt(localStorage.getItem('patpat.stampsSeen') || '0', 10) || 0)); } catch { /* ignore */ }
      p.setSub(`${meta.doneCount()}/${ACHIEVEMENTS.length} AÇIK${unclaimed ? ` · ${unclaimed} ÖDÜL BEKLİYOR` : ''}`);
      let items = ACHIEVEMENTS.slice();
      const state = (d) => meta.progress(d.id);
      if (p.tab === 1) items = items.filter((d) => state(d).done);
      else if (p.tab === 2) items = items.filter((d) => d.secret);
      const rank = (d) => {
        const s = state(d);
        if (s.done && !s.claimed) return 0;
        if (d.secret && !s.done) return 3;
        if (s.claimed) return 2;
        return 1;
      };
      items.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (ra === 1) return state(b).value / state(b).goal - state(a).value / state(a).goal;
        return 0;
      });
      if (p.tab === 0 && unclaimed > 1) {
        p.list.appendChild(button('fm-btn big green', `HEPSİNİ AL (${unclaimed})`, () => {
          sfx('reward');
          let coinsSum = 0;
          let crystalsSum = 0;
          for (const d of ACHIEVEMENTS) {
            const s = meta.progress(d.id);
            if (s.done && !s.claimed) {
              const g = meta.claimAchievement(d.id);
              if (g) { coinsSum += g.coins || 0; crystalsSum += g.crystals || 0; if (cb.onReward) { try { cb.onReward('achievement', g); } catch { /* ignore */ } } }
            }
          }
          confetti(40);
          if (coinsSum) fly(p.body, p.pills.coins.el, '❄️', 10, () => p.refreshPills(true));
          if (crystalsSum) fly(p.body, p.pills.crystals.el, '💎', 4, () => p.refreshPills(true));
          const t = setTimeout(() => { if (activePanel === p) render(); }, 700);
          p.timers.push(t);
        }));
      }
      if (!items.length) p.list.appendChild(el('div', 'fm-note', p.tab === 1 ? 'Henüz açık başarım yok. Oyna, kazan!' : 'Burada bir şey yok.'));
      for (const d of items) p.list.appendChild(row(d));
      if (p.tab === 2) p.list.appendChild(el('div', 'fm-note', `🐇 ${meta.stats().eggs}/${EGGS.length} sır bulundu. Menüde, oyunda, her yerde bir şeyler saklı...`));
    }

    render();
    return p;
  }

  // ---------------------------------------------------------------------------------------------- settings

  function openSettings() {
    sfx('click');
    const p = openPanel({ id: 'settings', title: 'AYARLAR', sub: `PATPAT v${VERSION}`, pills: [] });

    function toggleRow(icon, label, key, fn) {
      const r = el('div', 'fm-row');
      const sw = button(`fm-sw${toggles()[key] ? ' on' : ''}`, '', () => {
        const next = !toggles()[key];
        try { if (fn) fn(next); } catch { /* ignore */ }
        sfx('toggle');
        sw.classList.toggle('on', !!toggles()[key]);
      }, label);
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(!!toggles()[key]));
      add(r, el('div', 'fm-aico', icon), el('div', 'fm-tgl', label), sw);
      return r;
    }

    add(p.list, toggleRow('🔊', 'SES', 'sound', cb.onSound), toggleRow('🎵', 'MÜZİK', 'music', cb.onMusic), toggleRow('📳', 'TİTREŞİM', 'haptics', cb.onHaptics));

    const vr = el('div', 'fm-row');
    const vlabel = el('div', 'fm-tgl', 'GÖRÜNÜM');
    const vbtn = button('fm-btn blue', `Görünüm: ${toggles().visualName}`, () => {
      let name;
      try { name = cb.onVisualCycle ? cb.onVisualCycle() : null; } catch { name = null; }
      sfx('toggle');
      vbtn.textContent = `Görünüm: ${name || toggles().visualName}`;
    });
    add(vr, el('div', 'fm-aico', '🖼️'), vlabel, vbtn);
    p.list.appendChild(vr);

    p.list.appendChild(el('div', 'fm-sec', 'İSTATİSTİKLER'));
    const s = meta.stats();
    const tiles = [
      ['SEVİYE', s.level], ['TOPLAM KOŞU', fmt(s.runs)], ['EN UZUN KOŞU', fmtDist(s.bestDistance)], ['TOPLAM MESAFE', fmtDist(s.totalDistance)],
      ['YUTULAN', fmt(s.swallowed)], ['SONSUZ REKORU', fmtTons(save && save.cigEndlessBest ? save.cigEndlessBest().tons : 0)], ['KIRILAN ENGEL', fmt(s.smashed)], ['KIL PAYI', fmt(s.closeCalls)],
      ['TOPLANAN TON', fmtTons(s.totalTons)], ['YILDIZ', `⭐ ${s.stars}`], ['BAŞARIM', `${s.achievements}/${s.achievementsTotal}`], ['SIRLAR', `${s.eggs}/${s.eggsTotal}`],
      ['ÇARPAN', `x${s.multiplier}`], ['GÖREV SETİ', fmt(s.missionSets)], ['MACERA', `⭐ ${s.campaignStars}/300`], ['BÖLÜM', `${s.campaignCleared}/100`],
      ['ÇIĞ DAĞ', `${save && save.cigCleared ? save.cigCleared() : 0}/${DAG_COUNT}`], ['ÇIĞ ⭐', `⭐ ${save && save.cigLvTotalStars ? save.cigLvTotalStars() : 0}/${DAG_COUNT * 3}`],
    ];
    const grid = el('div', 'fm-stats');
    for (const [k, v] of tiles) add(grid, add(el('div', 'fm-stat'), el('b', '', String(v)), el('span', '', k)));
    p.list.appendChild(grid);

    const cr = el('div', 'fm-credits');
    cr.appendChild(el('div', '', '3D modeller: Kenney (kenney.nl) — CC0 · Ses efektleri: Kenney, rubberduck (OpenGameArt) — CC0 · Müzik ve kod: PATPAT ekibi'));
    cr.appendChild(el('em', '', `PATPAT v${VERSION}`));
    p.list.appendChild(cr);
    return p;
  }

  // ---------------------------------------------------------------------------------------------- missions

  // ---------------------------------------------------------------------------------------------- daily tasks + records

  const fmtLeft = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return `${Math.floor(m / 60)} sa ${m % 60} dk`; };
  function openDailyTasks() {
    const p = openPanel({ id: 'dtasks', title: 'GÜNLÜK GÖREVLER', pills: ['coins', 'crystals'] });
    function render() {
      clear(p.list);
      const dt = meta.dailyTasks();
      p.setSub(dt.allClaimed ? 'HEPSİ TAMAM!' : 'HER GÜN 3 YENİ GÖREV');
      for (const t of dt.tasks) {
        const r = el('div', `fm-row fm-dt-row${t.done && !t.claimed ? ' done' : ''}`);
        const mid = el('div', 'fm-amid');
        add(mid, el('div', 'fm-an', t.text));
        const b = el('div', 'fm-bar'); const fill = el('i');
        setCss(fill, '--p', `${Math.round((t.value / t.goal) * 100)}%`);
        b.appendChild(fill);
        add(mid, add(el('div', 'fm-abar'), b, el('div', 'fm-bn', t.goal > 1 ? `${fmt(t.value)}/${fmt(t.goal)}` : (t.done ? '1/1' : '0/1'))));
        add(mid, el('div', 'fm-ad', 'Ödül: ' + rewardLine(t.reward)));
        add(r, el('div', 'fm-aico', t.icon), mid);
        if (t.claimed) r.appendChild(el('div', 'fm-ok', '✓'));
        else if (t.done) {
          r.appendChild(button('fm-btn sm glow', 'AL', () => {
            const g = meta.claimDailyTask(t.i);
            if (!g) { sfx('error'); return; }
            sfx('reward'); p.refreshPills(true);
            if (cb.onReward) { try { cb.onReward('daily', g); } catch { /* ignore */ } }
            render(); if (mainOpen) updateMain();
          }));
        }
        p.list.appendChild(r);
      }
      p.list.appendChild(el('div', 'fm-dt-t', `Yenilenmesine ${fmtLeft(dt.nextInMs)} (gece yarısı)`));
      const d = meta.daily();
      const sr = el('div', 'fm-row');
      add(sr, el('div', 'fm-aico', d.streak > 0 ? '🔥' : '🌱'), add(el('div', 'fm-amid'), el('div', 'fm-an', d.streak > 0 ? `${d.streak} günlük seri` : 'Günlük seri'), el('div', 'fm-ad', d.available ? 'Bugünün ödülü hazır!' : 'Bugünün ödülünü aldın')),
        button(`fm-btn sm${d.available ? ' glow' : ''}`, d.available ? 'AL' : 'AÇ', () => openDaily()));
      p.list.appendChild(sr);
      const rc = meta.records();
      p.list.appendChild(el('div', 'fm-sec', 'REKORLAR'));
      const card = (title, rows) => { const c = el('div', 'fm-rec'); c.appendChild(el('h4', '', title)); for (const [k, v] of rows) add(c, add(el('div', '', k), el('b', '', v))); p.list.appendChild(c); };
      card('❄️ YETİ RUSH', [['EN UZUN MESAFE', rc.yeti.dist > 0 ? fmtDist(rc.yeti.dist) : '-'], ['EN YÜKSEK SKOR', rc.yeti.score > 0 ? fmt(rc.yeti.score) : '-']]);
      card('⛰️ ÇIĞ DAĞLAR', [['TAMAMLANAN DAĞ', `${save && save.cigCleared ? save.cigCleared() : 0}/${DAG_COUNT}`], ['TOPLAM YILDIZ', `⭐ ${save && save.cigLvTotalStars ? save.cigLvTotalStars() : 0}/${DAG_COUNT * 3}`]]);
      card('∞ ÇIĞ SONSUZ', [['EN ÇOK KAR', rc.cig.tons > 0 ? fmtTons(rc.cig.tons) : '-'], ['EN YÜKSEK BOYUT', rc.cig.tier >= 1 ? ['', 'Kartopu', 'Çığ', 'Mega Çığ', 'Felaket', 'Kıyamet'][Math.min(5, rc.cig.tier)] : '-']]);
      card('⚔️ KARTOPU ARENA', [['EN BÜYÜK KÜTLE', rc.arena.mass > 0 ? fmt(rc.arena.mass) : '-'], ['TOPLAM KÜTLE', rc.arena.xp > 0 ? fmt(rc.arena.xp) : '-']]);
      p.list.appendChild(el('div', 'fm-note', "Kar tanelerini Dolap'ta yeni toplara ve izlere harca."));
      const dr = el('div', 'fm-row');
      add(dr, el('div', 'fm-aico', '📜'), add(el('div', 'fm-amid'), el('div', 'fm-an', 'Çarpan görevleri'), el('div', 'fm-ad', 'Skor çarpanını büyüten görev seti')), button('fm-btn sm', 'AÇ', () => openMissions()));
      p.list.appendChild(dr);
    }
    sfx('open');
    render();
    return p;
  }

  function openMissions() {
    sfx('click');
    const p = openPanel({ id: 'missions', title: 'GÖREVLER', pills: ['coins', 'crystals'] });

    function render() {
      clear(p.list);
      const mult = meta.multiplier();
      const max = meta.maxMultiplier();
      p.setSub(`SET #${meta.missionSetsDone() + 1}`);

      const mb = el('div', 'fm-multbig');
      const badge = el('div', 'fm-mult', `x${mult}`);
      const txt = el('div', '');
      add(txt, el('div', 'mt', 'KALICI SKOR ÇARPANI'));
      add(txt, el('div', 'ms', mult >= max ? 'Maksimum çarpana ulaştın!' : `3 görevi bitir, çarpan x${mult + 1} olsun. En fazla x${max}. Skorun her zaman bu çarpanla çarpılır.`));
      add(mb, badge, txt);
      p.list.appendChild(mb);

      const ms = meta.missions();
      ms.forEach((m, i) => {
        const r = el('div', `fm-row fm-mrow${m.done ? ' done' : ''}`);
        const mid = el('div', 'fm-amid');
        add(mid, el('div', 'fm-an', m.text));
        const bar = el('div', 'fm-abar');
        const b = el('div', 'fm-bar');
        const fill = el('i');
        setCss(fill, '--p', `${Math.round((m.value / m.goal) * 100)}%`);
        b.appendChild(fill);
        add(bar, b, el('div', 'fm-bn', `${fmt(m.value)}/${fmt(m.goal)}`));
        mid.appendChild(bar);
        add(r, el('div', 'fm-aico', m.icon), mid);
        if (m.done) r.appendChild(el('div', 'fm-ok', '✓'));
        else {
          const cost = meta.skipCost();
          const sk = button('fm-skip', '', () => {
            if (!meta.skipMission(i)) { sk.classList.add('fm-shake'); sfx('error'); setTimeout(() => sk.classList.remove('fm-shake'), 340); return; }
            sfx('confirm');
            p.refreshPills(true);
            render();
          }, 'Görevi değiştir');
          add(sk, el('b', '', '↻'), document.createTextNode(cost ? '💎 1' : 'BEDAVA'));
          r.appendChild(sk);
        }
        p.list.appendChild(r);
      });

      const rw = meta.missionSetReward();
      p.list.appendChild(el('div', 'fm-note', `SET ÖDÜLÜ: ${rewardLine(rw)}`));
      p.list.appendChild(el('div', 'fm-note', 'Her gün 1 görevi ücretsiz değiştirebilirsin, sonrası 💎 1.'));

      // shortcuts (the lobby only has room for five buttons)
      const unclaimed = meta.unclaimedCount();
      const link = (icon, name, desc, label, glow, fn) => {
        const rr = el('div', 'fm-row');
        add(rr, el('div', 'fm-aico', icon), add(el('div', 'fm-amid'), el('div', 'fm-an', name), el('div', 'fm-ad', desc)), button(`fm-btn sm${glow ? ' glow' : ''}`, label, fn));
        p.list.appendChild(rr);
      };
      link('🏆', 'Başarımlar', `${meta.doneCount()}/${ACHIEVEMENTS.length} açık${unclaimed ? ` · ${unclaimed} ödül seni bekliyor` : ''}`, unclaimed ? 'AL' : 'AÇ', unclaimed > 0, () => openAchievements());
      { const ss = meta.stamps(); link('🛂', 'Kış Pasaportu', `${ss.filter((x) => x.got).length}/${ss.length} damga`, 'AÇ', false, () => openPassport()); }
      const hh = meta.letterHunt();
      link('🔤', 'Günün kelimesi', hh.complete ? 'Bugün tamam!' : `${hh.count}/${WORD.length} harf · koşarken harfleri topla`, 'AÇ', false, () => openHunt());
      link('⚡', 'Güçlendirmeler', 'Kar tanesiyle güçlen: dolaptan al', 'DOLAP', false, () => { if (cb.onShop) cb.onShop(); });
      if (cb.onDaily) link('🏔️', `Günün Dağı #${info.dailyNum}`, save.cigDailyOpen() ? (info.dailyBest > 0 ? `Rekorun: ${fmtTons(info.dailyBest)}` : 'Bugünün özel dağı') : "DAĞ 3'ü bitirince açılır", save.cigDailyOpen() ? 'OYNA' : '🔒', false, () => { if (!save.cigDailyOpen()) { toast({ icon: '🔒', title: "Günün Dağı için DAĞ 3'ü bitir", ms: 1800 }); return; } closePanel(true); try { meta.setMode('daily'); } catch { /* ignore */ } cb.onDaily(); });
    }

    render();
    return p;
  }

  // ---------------------------------------------------------------------------------------------- upgrades

  function openUpgrades() {
    sfx('click');
    const p = openPanel({ id: 'up', title: 'GELİŞTİR', sub: 'GÜÇLENDİRME SÜRELERİ', pills: ['coins', 'crystals'] });

    function render() {
      clear(p.list);
      for (const u of UPGRADES) {
        const lv = meta.upgradeLevel(u.id);
        const cost = meta.upgradeCost(u.id);
        const r = el('div', 'fm-row fm-up');
        const mid = el('div', 'fm-amid');
        const cur = meta.duration(u.id);
        const nextDur = lv < 5 ? u.durations[lv + 1] : null;
        add(mid, el('div', 'fm-an', u.name), el('div', 'fm-ad', nextDur ? `${cur} sn → ${nextDur} sn` : `${cur} sn (en yüksek)`));
        const pips = el('div', 'fm-pips');
        for (let i = 0; i < 5; i++) pips.appendChild(el('i', i < lv ? 'on' : ''));
        mid.appendChild(pips);
        add(r, el('div', 'fm-aico', u.icon), mid);
        if (cost === null) r.appendChild(button('fm-btn sm on', 'MAKS ✓'));
        else {
          const pc = shopPrice(cost);
          const afford = coins() >= pc;
          const b = button(`fm-btn${afford ? '' : ' poor'}`, pc < cost ? `❄️ ${fmt(pc)} (%${couponPct()})` : `❄️ ${fmt(cost)}`, () => {
            if (!afford || !meta.buyUpgrade(u.id)) {
              b.classList.add('fm-shake'); sfx('error'); setTimeout(() => b.classList.remove('fm-shake'), 340);
              return;
            }
            sfx('confirm');
            if (cb.onReward) { try { cb.onReward('upgrade', { upgrade: u.id }); } catch { /* ignore */ } }
            p.refreshPills(true);
            render();
            confetti(14);
          });
          r.appendChild(b);
        }
        p.list.appendChild(r);
      }

      // sled
      const sr = el('div', 'fm-row fm-up');
      const smid = el('div', 'fm-amid');
      add(smid, el('div', 'fm-an', 'KIZAK'), el('div', 'fm-ad', 'Bir çarpışmayı affeder. Koşuda çift dokunarak kullan.'), el('div', 'fm-ar', `Stok: 🛷 ${meta.sleds()}`));
      add(sr, el('div', 'fm-aico', '🛷'), smid);
      const spc = shopPrice(SLED_PACK.price);
      const afford = coins() >= spc;
      const sb = button(`fm-btn blue${afford ? '' : ' poor'}`, `${SLED_PACK.count}'LÜ ❄️ ${fmt(spc)}`, () => {
        if (!afford || !meta.buySled(1)) {
          sb.classList.add('fm-shake'); sfx('error'); setTimeout(() => sb.classList.remove('fm-shake'), 340);
          return;
        }
        sfx('confirm');
        p.refreshPills(true);
        render();
      });
      sr.appendChild(sb);
      p.list.appendChild(sr);

      p.list.appendChild(el('div', 'fm-note', `💎 Kristal: Yeti seni yakalayınca devam etmek için kullanılır (her seferinde iki katı). Şu an: ${meta.crystals}`));
    }

    render();
    return p;
  }

  // ---------------------------------------------------------------------------------------------- letter hunt

  function openHunt() {
    sfx('click');
    const p = openPanel({ id: 'hunt', title: 'GÜNÜN KELİMESİ', pills: ['coins'] });
    const h = meta.letterHunt();
    p.setSub(h.complete ? 'BUGÜN TAMAM!' : `${h.count}/${WORD.length} HARF`);
    const word = el('div', 'fm-word');
    h.found.forEach((got, i) => word.appendChild(el('div', `fm-chip${got ? ' got' : i === h.nextLetter ? ' next' : ''}`, got || i === h.nextLetter ? WORD[i] : '?')));
    p.list.appendChild(word);
    p.list.appendChild(el('div', 'fm-note', h.complete
      ? 'Bugünkü kelimeyi tamamladın! Yarın yeni bir av seni bekliyor.'
      : `Koşu sırasında ${WORD.split('').join('-')} harfleri sırayla belirir. Bir günde hepsini topla! Sıradaki harf: ${h.letter}`));
    const r = el('div', 'fm-row');
    add(r, el('div', 'fm-aico', '🔤'), add(el('div', 'fm-amid'), el('div', 'fm-an', h.complete ? 'KAZANDIN' : 'ÖDÜL'), el('div', 'fm-ar', rewardLine(h.reward))));
    p.list.appendChild(r);
    const sb = el('div', 'fm-streak');
    add(sb, el('div', 'fl', h.streak > 0 ? '🔥' : '🌱'),
      add(el('div', ''), el('div', 'st', h.streak > 0 ? `${h.streak} günlük seri` : 'Seri yok'), el('div', 'sd', `Her gün tamamla, ödül büyüsün. Seri günü: ${h.streakDay}/7`)));
    p.list.appendChild(sb);
    return p;
  }

  // ---------------------------------------------------------------------------------------------- modal (holiday)

  function closeModal() {
    if (modalEl) { modalEl.remove(); modalEl = null; }
  }
  // ---------------------------------------------------------------------------------------------- mystery boxes

  function closeBoxes() {
    if (boxEl) { boxEl.remove(); boxEl = null; }
  }

  function rewardCard(r) {
    const rare = !!r.rare;
    const c = el('div', `fm-rcard${rare ? ' rare' : ''}`);
    let icon = '❄️';
    let title = r.coins ? `+${fmt(r.coins)} ❄️` : '';
    let subt = rare ? 'NADİR!' : 'Kar tanesi';
    if (r.skin) { icon = '👕'; title = nameOf(SKINS, r.skin); subt = 'YENİ TOP!'; }
    else if (r.trail) { icon = '✨'; title = nameOf(TRAILS, r.trail); subt = 'YENİ İZ!'; }
    else if (r.crystals) { icon = '💎'; title = `+${r.crystals} KRİSTAL`; subt = 'Devam etmek için'; }
    else if (r.sleds) { icon = '🛷'; title = `+${r.sleds} KIZAK`; subt = 'Bir çarpışmayı affeder'; }
    else if (r.converted) { subt = 'Zaten sahiptin: kar tanesine döndü'; }
    if (r.skin || r.trail) {
      const ri = el('div', 'ri');
      ri.appendChild(previewEl(r.skin ? 'skin' : 'trail', r.skin || r.trail));
      c.appendChild(ri);
    } else c.appendChild(el('div', 'ri', icon));
    add(c, el('div', 'rt', title), el('div', 'rs', subt));
    return c;
  }

  function openBoxes(n, onDone) {
    closeBoxes();
    const have = Math.max(0, Math.floor(meta.boxes));
    const total = Math.min(have, Math.max(1, Math.floor(n || have)));
    if (total <= 0) { if (onDone) onDone(); return null; }
    sfx('click');
    const ov = el('div', 'fm-boxov');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Sürpriz Kutu');
    host.appendChild(ov);
    boxEl = ov;
    let idx = 0;
    let busy = false;
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      closeBoxes();
      if (mainOpen) updateMain();
      if (onDone) { try { onDone(); } catch { /* ignore */ } }
    }

    function stage() {
      clear(ov);
      busy = false;
      add(ov, el('div', 'fm-boxt fm-ol', 'SÜRPRİZ KUTU'), el('div', 'fm-boxs', total > 1 ? `${idx + 1} / ${total}` : ''));
      const gift = button('fm-gift', '🎁', () => openOne(gift), 'Kutuyu aç');
      ov.appendChild(gift);
      ov.appendChild(el('div', 'fm-boxs', 'DOKUN VE AÇ!'));
      if (total - idx > 1) {
        ov.appendChild(button('fm-btn blue', `HEPSİNİ AÇ (${total - idx})`, openAll));
      }
    }

    function giveCb(r) {
      if (cb.onReward) { try { cb.onReward('box', r); } catch { /* ignore */ } }
    }

    function openOne(gift) {
      if (busy) return;
      busy = true;
      gift.classList.add('open');
      sfx('click');
      setTimeout(() => {
        if (finished) return;
        const r = meta.openBox();
        if (!r) { finish(); return; }
        giveCb(r);
        sfx('confirm');
        clear(ov);
        add(ov, el('div', 'fm-boxt fm-ol', r.rare ? 'NADİR ÖDÜL!' : 'ÖDÜLÜN'), rewardCard(r));
        confetti(r.rare ? 90 : 36);
        idx++;
        const last = idx >= total;
        ov.appendChild(button('fm-btn big green', last ? 'TAMAM' : 'SIRADAKİ', () => { sfx('confirm'); if (last) finish(); else stage(); }));
        busy = false;
      }, 650);
    }

    function openAll() {
      if (busy) return;
      busy = true;
      sfx('confirm');
      const got = [];
      while (idx < total) {
        const r = meta.openBox();
        if (!r) break;
        giveCb(r);
        got.push(r);
        idx++;
      }
      clear(ov);
      add(ov, el('div', 'fm-boxt fm-ol', 'ÖDÜLLERİN'));
      const lst = el('div', 'fm-sumlist');
      for (const r of got) lst.appendChild(el('span', r.rare ? 'rare' : '', rewardLine(r) || '❄️'));
      ov.appendChild(lst);
      confetti(70);
      ov.appendChild(button('fm-btn big green', 'TAMAM', () => { sfx('confirm'); finish(); }));
      busy = false;
    }

    stage();
    return { close: finish };
  }

  // ============================================================================================ campaign helpers

  const EMPTY_CAMP = { unlocked: 1, current: 1, stars: {}, totalStars: 0, maxStars: 300, cleared: 0, done: false, actDone: () => false, actStars: () => 0 };
  const campInfo = () => { try { return meta.campaign(); } catch { return EMPTY_CAMP; } };
  const levelOf = (l) => (l && typeof l === 'object' ? l : levelById(l));
  const actTr = (n) => `Act ${n}'${ACT_SUF[Math.max(0, Math.min(9, n - 1))]}`;

  let worldEl = null;   // the MOD SEÇ planet screen
  let worldTimer = 0;   // pending "zoom finished, start the mode" timeout; non-zero also means a pick is in flight (taps are ignored)
  let resultEl = null;
  let cardRef = null;

  const MODE_STYLE = {
    camp: { icon: '🗺️', title: 'MACERA', cls: 'camp' },
    endless: { icon: '∞', title: 'YETİ RUSH', cls: 'endless' },
    cig: { icon: '⛰️', title: 'ÇIĞ', cls: 'cig' },
    daily: { icon: '🏔️', title: 'GÜNÜN DAĞI', cls: 'daily' },
  };
  const WORLDS = ['endless', 'camp', 'cig']; // the three planets; GÜNÜN DAĞI is the small moon under them
  const SPARKS = [[8, 14, 12, 0], [88, 9, 16, 1.1], [20, 40, 9, 0.6], [92, 46, 11, 1.7], [6, 66, 14, 2.1], [84, 80, 10, 0.3], [48, 5, 9, 1.4]]; // sky sparkles: x%, y%, px, delay s

  // the mode played last (saved in meta): its planet gets the focus when the planet screen opens
  function selectedMode() {
    let m = 'camp';
    try { m = meta.mode ? meta.mode() : 'camp'; } catch { m = 'camp'; }
    return MODE_STYLE[m] ? m : 'camp';
  }

  function modeSubText(m) {
    if (m === 'camp') {
      const c = campInfo();
      return `Bölüm ${c.current} · ⭐ ${c.totalStars}`;
    }
    if (m === 'endless') return info.endlessBest > 0 ? `REKOR ${fmt(info.endlessBest)} · ${fmtDist(info.endlessBestDist)}` : 'Yeti seni kovalıyor!';
    if (m === 'cig') {
      const c = info.cig || {};
      const st = Math.max(0, Math.min(3, c.stars | 0));
      return `Dağ ${c.next || 1} · ${'⭐'.repeat(st)}${'☆'.repeat(3 - st)}`;
    }
    return info.dailyBest > 0 ? `${fmtTons(info.dailyBest)} rekor` : 'Bugünün dağı';
  }

  // ---- start a campaign level (shows the tutorial card first if the level introduces something new) ----
  function startLevel(id) {
    const lv = levelOf(id);
    if (!lv) return;
    const go = () => {
      closePanel(true);
      if (cb.onPlayLevel) cb.onPlayLevel(lv.id);
      else if (cb.onLevels) cb.onLevels();
    };
    if (!showLevelIntro(lv, go)) go();
  }

  // remember the mode, then enter it
  function playMode(m) {
    try { meta.setMode(m); } catch { /* ignore */ }
    // the runner chunk may still be loading: no double taps, a pressed look until the lobby hides
    if (refs && (m === 'endless' || m === 'cig')) {
      refs.root.classList.add('fm-starting');
      setTimeout(() => { if (refs) refs.root.classList.remove('fm-starting'); }, 2500);
    }
    if (m === 'camp') startLevel(campInfo().current);
    else if (m === 'endless') { if (cb.onEndless) cb.onEndless(); }
    else if (m === 'cig') openCigLevels();
    else if (cb.onDaily) {
      if (save && save.cigDailyOpen && !save.cigDailyOpen()) toast({ icon: '🔒', title: "Günün Dağı için DAĞ 3'ü bitir", ms: 1800 });
      else cb.onDaily();
    }
  }

  // ---------------------------------------------------------------------------------------------- mode select (planets)

  const reducedMotion = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };

  function closeWorlds() {
    if (worldTimer) { clearTimeout(worldTimer); worldTimer = 0; }
    if (worldEl) { worldEl.remove(); worldEl = null; }
    if (refs) refs.root.classList.remove('fm-under');
  }
  function leaveWorlds() {
    sfx('back');
    closeWorlds();
    if (refs) { try { refs.play.focus({ preventScroll: true }); } catch { /* ignore */ } }
  }

  // one pure-CSS planet: glow, sphere (scrolling surface + shade + highlight + emblem), optional ring, label pill
  function planetEl(id, delay, onPick) {
    const ms = MODE_STYLE[id];
    const sub = modeSubText(id);
    const b = button(`fm-pl ${ms.cls}`, '', () => onPick(id, b), `${ms.title} modunu oyna. ${sub}`);
    setCss(b, '--dl', `${delay}s`);
    const orb = el('span', 'orb');
    add(orb, el('i', 'surf'), id === 'cig' ? el('i', 'cap') : null, el('i', 'shd'), el('i', 'hl'), el('b', 'gl', ms.icon), id === 'endless' ? el('b', 'fp', '👣') : null);
    const body = el('span', 'pbody');
    add(body, id === 'endless' ? el('i', 'ring bk') : null, orb, id === 'endless' ? el('i', 'ring fr') : null);
    add(b, add(el('span', 'pwrap'), body), add(el('span', 'plab'), el('b', '', ms.title), el('i', '', sub)));
    return b;
  }

  function openWorlds() {
    closeWorlds();
    const ov = el('div', 'fm-plov');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Mod seç');
    add(ov, el('div', 'fm-stars'), el('div', 'fm-stars tw'), el('div', 'fm-stars tw b'));
    for (const [x, y, s, d] of SPARKS) {
      const sp = el('i', 'fm-spark');
      setCss(sp, '--x', `${x}%`);
      setCss(sp, '--y', `${y}%`);
      setCss(sp, '--s', `${s}px`);
      setCss(sp, '--dl', `${d}s`);
      ov.appendChild(sp);
    }
    add(ov, add(el('div', 'fm-plhead'), button('fm-plback', '←', () => leaveWorlds(), 'Geri'),
      add(el('div', 'fm-pltitles'), el('div', 'fm-pltitle', 'MOD SEÇ'), el('div', 'fm-plsub', 'BİR DÜNYA SEÇ')), el('span')));

    // tap: squish (CSS :active), then the pick flies to the middle and grows over the screen while the rest fades, then the mode starts
    const t0 = Date.now();
    const pick = (id, b) => {
      if (worldTimer || Date.now() - t0 < 380) return; // a pick is already on its way, or a double-tap on OYNA landed on the moon: ignore
      sfx('confirm');
      b.classList.add('pick');
      let wait = 90;
      if (!reducedMotion()) {
        const t = b.querySelector('.pwrap, .mn').getBoundingClientRect();
        const o = ov.getBoundingClientRect();
        setCss(b, '--tx', `${Math.round(o.left + o.width / 2 - (t.left + t.width / 2))}px`);
        setCss(b, '--ty', `${Math.round(o.top + o.height / 2 - (t.top + t.height / 2))}px`);
        setCss(b, '--k', ((Math.hypot(o.width, o.height) / Math.max(1, t.width)) * 1.1).toFixed(2));
        ov.classList.add('go');
        wait = 430;
      }
      worldTimer = setTimeout(() => { worldTimer = 0; closeWorlds(); playMode(id); }, wait);
    };

    const stage = el('div', 'fm-plstage');
    add(stage, el('div', 'fm-orbit'), el('div', 'fm-orbit o2'));
    WORLDS.forEach((id, i) => stage.appendChild(planetEl(id, 0.04 + i * 0.08, pick)));
    ov.appendChild(stage);

    const dm = MODE_STYLE.daily;
    const dsub = modeSubText('daily');
    const moon = button('fm-moon', '', () => pick('daily', moon), `${dm.title} #${info.dailyNum}. ${dsub}`);
    add(moon, el('span', 'mn', dm.icon), add(el('span', 'mt'), el('b', '', `${dm.title} #${info.dailyNum}`), el('i', '', dsub)));
    ov.appendChild(moon);

    host.appendChild(ov);
    worldEl = ov;
    if (refs) refs.root.classList.add('fm-under'); // the lobby UI stays hidden behind the sky
    const last = selectedMode();
    try { (last === 'daily' ? moon : stage.querySelector(`.fm-pl.${MODE_STYLE[last].cls}`)).focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  // Esc / Android Back: close the topmost overlay. Returns false when there is nothing to close (boxes and results are not cancellable).
  function back() {
    if (boxEl || resultEl) return false;
    if (modalEl) { closeModal(); return true; }
    if (cardRef) { closeCard(); return true; }
    if (activePanel) { sfx('close'); closePanel(); return true; }
    if (worldEl) { leaveWorlds(); return true; }
    return false;
  }

  // ---------------------------------------------------------------------------------------------- campaign map

  const PTS = [[20, 90], [52, 84], [82, 72], [60, 60], [28, 54], [16, 41], [40, 31], [66, 28], [84, 17], [46, 8]];
  function curvePath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const a = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const b = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C ${a[0].toFixed(2)} ${a[1].toFixed(2)}, ${b[0].toFixed(2)} ${b[1].toFixed(2)}, ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  function closeCard() {
    if (cardRef) { cardRef.back.remove(); cardRef.card.remove(); cardRef = null; }
  }

  function openLevelCard(p, lv) {
    closeCard();
    sfx('open');
    const camp = campInfo();
    const A = ACTS[lv.act - 1];
    const locked = lv.bonus ? lv.bonusN > camp.bonusOpen : lv.id > camp.unlocked;
    const best = meta.levelBest ? meta.levelBest(lv.id) : null;
    const back = el('div', 'fm-lback');
    back.addEventListener('click', () => { sfx('close'); closeCard(); });
    const card = el('div', 'fm-lcard');
    setCss(card, '--ca', A.colors.a);
    setCss(card, '--cb', A.colors.b);
    const lbig = el('div', 'lbig', lv.boss ? '👹' : A.icon);
    setCss(lbig, '--ca', A.colors.a);
    setCss(lbig, '--cb', A.colors.b);
    const head = el('div', 'fm-lhead');
    add(head, lbig, add(el('div', ''), el('div', 'l1', lv.bonus ? `✨ GİZLİ ROTA ${lv.bonusN} · ${A.name.toLocaleUpperCase('tr-TR')}` : `BÖLÜM ${lv.id}${lv.boss ? ' · BOSS' : ''} · ${A.name.toLocaleUpperCase('tr-TR')}`), el('div', 'l2', lv.name)),
      button('fm-x', '✕', () => { sfx('close'); closeCard(); }, 'Kapat'));
    card.appendChild(head);
    const goals = el('div', 'fm-lgoals');
    lv.goals.forEach((g, i) => {
      const got = !!(best && (best.goals ? best.goals[i] : best.stars > i));
      goals.appendChild(add(el('div', `fm-lgoal${got ? ' got' : ''}`), el('span', 'gs', '★'), el('span', '', g.text)));
    });
    card.appendChild(goals);
    if (lv.intro) card.appendChild(add(el('div', 'fm-lintro'), el('span', 'ii', lv.intro.icon), el('span', '', lv.intro.text)));
    if (best) card.appendChild(el('div', 'fm-lbest', `REKOR ${'⭐'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)} · %${best.flakesPct} kar tanesi${best.time ? ` · ${Math.floor(best.time / 60)}:${String(best.time % 60).padStart(2, '0')}` : ''}`));
    if (locked) {
      card.appendChild(el('div', 'fm-llock', lv.bonus ? `🔒 ${lv.bonusN * camp.bonusStep} ⭐ topla (${camp.unlockStars == null ? camp.totalStars : camp.unlockStars}/${lv.bonusN * camp.bonusStep})` : `🔒 Önce ${camp.unlocked}. bölümü bitir`));
      const b = button('fm-btn big lock', 'KİLİTLİ', () => { b.classList.add('fm-shake'); sfx('error'); setTimeout(() => b.classList.remove('fm-shake'), 340); });
      card.appendChild(b);
    } else {
      card.appendChild(button('fm-btn big green', 'OYNA ▶', () => { sfx('confirm'); closeCard(); startLevel(lv.id); }));
    }
    p.el.appendChild(back);
    p.el.appendChild(card);
    cardRef = { back, card };
  }

  function buildPage(act, camp, p) {
    const A = ACTS[act - 1];
    const page = el('div', 'fm-page');
    page.setAttribute('data-act', String(act));
    const inner = el('div', 'fm-pagein');
    setCss(inner, '--ca', A.colors.a);
    setCss(inner, '--cb', A.colors.b);
    setCss(inner, '--cc', A.colors.c);
    add(inner, add(el('div', 'fm-acthero'), el('div', 'big', A.icon),
      add(el('div', ''), el('div', 't1', `ACT ${act}`), el('div', 't2', A.name)),
      el('div', 'st', `⭐ ${camp.actStars(act)}/30`)));
    const firstId = (act - 1) * LEVELS_PER_ACT + 1;
    if (firstId > camp.unlocked) inner.appendChild(el('div', 'fm-lockedbar', `🔒 Önce ${actTr(act - 1)} bitir`));

    const path = el('div', 'fm-path');
    if (typeof document.createElementNS === 'function') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      const base = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      base.setAttribute('class', 'base');
      base.setAttribute('d', curvePath(PTS));
      svg.appendChild(base);
      let cleared = 0;
      for (let i = 0; i < LEVELS_PER_ACT; i++) { if ((camp.stars[firstId + i] || 0) > 0) cleared = i + 1; else break; }
      const upto = Math.min(LEVELS_PER_ACT, cleared + 1);
      const pd = curvePath(PTS.slice(0, upto));
      if (pd) {
        const prog = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        prog.setAttribute('class', 'prog');
        prog.setAttribute('d', pd);
        svg.appendChild(prog);
      }
      path.appendChild(svg);
    }
    const sm = stormOf();
    for (let i = 0; i < LEVELS_PER_ACT; i++) {
      const lv = LEVELS[firstId - 1 + i];
      const st = camp.stars[lv.id] || 0;
      const locked = lv.id > camp.unlocked;
      const state = locked ? 'lk' : st ? 'done' : 'cur';
      const n = el('button', `fm-node ${state}${lv.boss ? ' boss' : ''}`);
      n.setAttribute('type', 'button');
      n.setAttribute('aria-label', `Bölüm ${lv.id}: ${lv.name}${st ? `, ${st} yıldız` : locked ? ', kilitli' : ''}`);
      n.style.left = `${PTS[i][0]}%`;
      n.style.top = `${PTS[i][1]}%`;
      const ahead = lv.id - camp.unlocked;
      const near = locked && ahead >= 1 && ahead <= 3;
      if (near) n.classList.add('near'); else if (locked) n.classList.add('far');
      add(n, el('span', 'n', near ? (lv.boss ? '👹' : ((ACTS[lv.act - 1] || {}).icon || '🔒')) : locked ? (lv.boss ? '👹' : '🔒') : lv.boss ? '👹' : String(lv.id)));
      if (near) n.appendChild(el('span', 'nm', lv.name)); else if (locked) n.appendChild(el('span', 'nm gr', lv.name));
      if (lv.id === camp.unlocked && state === 'cur') n.appendChild(el('span', 'yav', '🧊'));
      if (lv.boss && !locked) n.appendChild(el('span', 'bn', String(lv.id)));
      if (!locked && sm.ids.includes(lv.id) && !sm.got[lv.id]) { n.classList.add('storm'); n.appendChild(el('span', 'sx', '⭐x2')); }
      if (!locked) {
        const stars = el('span', 'stars');
        for (let k = 1; k <= 3; k++) stars.appendChild(el('b', k <= st ? 'on' : '', '★'));
        n.appendChild(stars);
      }
      n.addEventListener('click', (e) => { e.stopPropagation(); if (p.dragged) return; openLevelCard(p, lv); });
      path.appendChild(n);
    }
    // GİZLİ ROTA branch(es) hanging off this act's base level
    for (const bl of BONUS) {
      if (bl.act !== act) continue;
      const bi = bl.idx - 1, bx = PTS[bi][0], by = PTS[bi][1];
      const nx = bx > 50 ? bx - 27 : bx + 27, ny = Math.min(94, by + 9);
      const open = bl.bonusN <= camp.bonusOpen;
      const st = camp.stars[bl.id] || 0;
      const svg = path.querySelector && path.querySelector('svg');
      if (svg && typeof document.createElementNS === 'function') {
        const br = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        br.setAttribute('class', 'bbr');
        br.setAttribute('d', `M ${bx} ${by} L ${nx} ${ny}`);
        svg.appendChild(br);
      }
      const n = el('button', `fm-node bonus ${open ? (st ? 'done' : 'cur') : 'lk'}`);
      n.setAttribute('type', 'button');
      n.setAttribute('aria-label', `${bl.name}${st ? `, ${st} yıldız` : open ? '' : `, kilitli: ${bl.bonusN * camp.bonusStep} yıldız gerek`}`);
      n.style.left = `${nx}%`; n.style.top = `${ny}%`;
      add(n, el('span', 'n', open ? '✨' : '🔒'), el('span', 'bn', 'GİZLİ ROTA'));
      if (open) { const stars = el('span', 'stars'); for (let k = 1; k <= 3; k++) stars.appendChild(el('b', k <= st ? 'on' : '', '★')); n.appendChild(stars); }
      n.addEventListener('click', (e) => { e.stopPropagation(); if (p.dragged) return; openLevelCard(p, bl); });
      path.appendChild(n);
    }
    inner.appendChild(path);
    page.appendChild(inner);
    return page;
  }

  function stormOf() { try { return meta.storm(); } catch { return { ids: [], got: {}, msLeft: 0 }; } }
  function fmtLeft3(ms) { const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440); return d > 0 ? `${d}g ${Math.floor((m % 1440) / 60)}s` : `${Math.floor(m / 60)}s ${String(m % 60).padStart(2, '0')}dk`; }
  function fmtLeftHM(ms) { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}s ${String(m % 60).padStart(2, '0')}dk`; }

  function openDiary() {
    sfx('click');
    const p = openPanel({ id: 'diary', title: 'YETİ GÜNLÜĞÜ' });
    let cur = 0;
    for (let i = 0; i < DIARY.length; i++) if (diaryOpen(i)) cur = i;
    const book = el('div', 'fm-book');
    const prev = button('fm-arrow', '‹', () => { sfx('click'); show(cur - 1); }, 'Önceki sayfa');
    const next = button('fm-arrow', '›', () => { sfx('click'); show(cur + 1); }, 'Sonraki sayfa');
    const pgl = el('span', '', '');
    const nav = el('div', 'fm-dnav'); add(nav, prev, pgl, next);
    function show(n) {
      cur = Math.max(0, Math.min(DIARY.length - 1, n));
      const d = DIARY[cur], ok = diaryOpen(cur);
      book.className = 'fm-book' + (ok ? '' : ' lk');
      clear(book);
      const hint = d.u[0] === 'a' ? `🔒 MACERA ${d.u.slice(1)}. Dağı'nı bitirince açılır.` : `🔒 ÇIĞ DAĞ ${d.u.slice(1)}'i geçince açılır.`;
      add(book, el('div', ok ? 'art' : 'art sil', d.a), el('div', 'pt', d.t), ok ? el('div', 'tx', d.x) : el('div', 'hint', hint), el('div', 'pg', `Sayfa ${cur + 1}/${DIARY.length}`));
      pgl.textContent = `${cur + 1}/${DIARY.length}`;
      prev.classList.toggle('off', cur <= 0); next.classList.toggle('off', cur >= DIARY.length - 1);
    }
    let got = 0; for (let i = 0; i < DIARY.length; i++) if (diaryOpen(i)) got++;
    p.setSub(`${got}/${DIARY.length} SAYFA`);
    add(p.list, book, nav);
    show(cur);
  }

  function openMap(focusId) {
    sfx('click');
    const camp0 = campInfo();
    const startLv = levelOf(focusId) || levelById(camp0.current) || LEVELS[0];
    const p = openPanel({ id: 'map', title: 'MACERA', pills: ['coins', 'crystals'], raw: true });
    p.dragged = false;
    p.act = startLv.act - 1;
    const body = p.body;
    body.className = 'fm-body fm-mapbody';

    const nav = el('div', 'fm-actnav');
    const prev = button('fm-arrow', '‹', () => { sfx('click'); goAct(p.act - 1); }, 'Önceki act');
    const next = button('fm-arrow', '›', () => { sfx('click'); goAct(p.act + 1); }, 'Sonraki act');
    const dots = el('div', 'fm-dots');
    const dotEls = ACTS.map((a, i) => {
      const d = el('i');
      d.setAttribute('aria-hidden', 'true');
      dots.appendChild(d);
      return d;
    });
    add(nav, prev, dots, next);
    const vp = el('div', 'fm-viewport');
    const track = el('div', 'fm-track');
    vp.appendChild(track);
    const bhd = el('div', 'fm-bonushd');
    const shd = el('div', 'fm-stormhd');
    const dbtn = button('fm-diarybtn', '', () => openDiary(), 'Yeti Günlüğü');
    add(dbtn, el('span', '', '📖'), el('span', '', 'GÜNLÜK'));
    add(body, shd, bhd, nav, vp);
    try { const hd = p.el.querySelector('.fm-head'); hd.style.position = 'relative'; hd.appendChild(dbtn); } catch { body.insertBefore(dbtn, body.firstChild); }

    function updStorm() {
      const sm = stormOf();
      const left = sm.ids.filter((i) => !sm.got[i]).length;
      shd.style.display = sm.ids.length ? '' : 'none';
      shd.textContent = left ? `⭐ BUGÜN: YILDIZ FIRTINASI · ${left} bölüm ×2 · ⏳ ${fmtLeftHM(sm.msLeft)}` : `⭐ YILDIZ FIRTINASI tamam! · ⏳ ${fmtLeftHM(sm.msLeft)}`;
    }
    const stormT = setInterval(() => { if (!shd.isConnected) { clearInterval(stormT); return; } updStorm(); }, 30000);
    function render() {
      const camp = campInfo();
      clear(track);
      for (let a = 1; a <= ACTS.length; a++) track.appendChild(buildPage(a, camp, p));
      applyAct(false);
      dotEls.forEach((d, i) => { d.className = `${i === p.act ? 'on' : ''}${i * LEVELS_PER_ACT + 1 > camp.unlocked ? ' lk' : ''}`.trim(); });
      p.setSub(`⭐ ${camp.totalStars}/${camp.maxStars}`);
      const step = camp.bonusStep || 15, cnt = camp.bonusCount || BONUS.length, open = camp.bonusOpen || 0;
      bhd.classList.toggle('full', open >= cnt);
      const us = camp.unlockStars == null ? camp.totalStars : camp.unlockStars;
      updStorm();
      bhd.textContent = open >= cnt ? `✨ Tüm Gizli Rotalar açık (${cnt}/${cnt})` : `${us}/${(open + 1) * step} ★ → Gizli Rota ${open + 1}`;
    }
    function applyAct(animate) {
      track.classList.toggle('drag', !animate);
      track.style.setProperty('transform', `translateX(-${p.act * 10}%)`);
      prev.classList.toggle('off', p.act <= 0);
      next.classList.toggle('off', p.act >= ACTS.length - 1);
      const camp = campInfo();
      dotEls.forEach((d, i) => { d.className = `${i === p.act ? 'on' : ''}${i * LEVELS_PER_ACT + 1 > camp.unlocked ? ' lk' : ''}`.trim(); });
      if (animate) { void track.offsetWidth; track.classList.remove('drag'); }
    }
    function goAct(n) {
      n = Math.max(0, Math.min(ACTS.length - 1, n));
      if (n === p.act) { applyAct(true); return; }
      p.act = n;
      closeCard();
      applyAct(true);
    }
    p.goAct = goAct;

    // swipe between acts (JS; vertical panning inside a page stays native)
    let sx = 0, sy = 0, st = 0, down = false, drag = false, vw = 1;
    vp.addEventListener('pointerdown', (e) => {
      down = true; drag = false; p.dragged = false; sx = e.clientX; sy = e.clientY; st = Date.now();
      vw = (vp.getBoundingClientRect && vp.getBoundingClientRect().width) || vp.clientWidth || 360;
    });
    vp.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!drag) {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          drag = true;
          p.dragged = true;
          track.classList.add('drag');
          try { vp.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        } else return;
      }
      let off = dx;
      if ((p.act === 0 && dx > 0) || (p.act === ACTS.length - 1 && dx < 0)) off = dx * 0.3;
      track.style.setProperty('transform', `translateX(${-p.act * vw + off}px)`);
    });
    const end = (e) => {
      if (!down) return;
      down = false;
      if (!drag) return;
      const dx = e.clientX - sx;
      const v = Math.abs(dx) / Math.max(1, Date.now() - st);
      let n = p.act;
      if (dx < -vw * 0.18 || (dx < -30 && v > 0.45)) n = p.act + 1;
      else if (dx > vw * 0.18 || (dx > 30 && v > 0.45)) n = p.act - 1;
      drag = false;
      sfx('click');
      goAct(n);
      setTimeout(() => { p.dragged = false; }, 60);
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', (e) => { end(e); });
    vp.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

    render();
    p.onClose = () => closeCard();
    // scroll the focused page so the current node is in view
    try {
      const pg = track.children[p.act];
      if (pg && pg.scrollTo) {
        const idx = Math.max(0, Math.min(9, startLv.idx - 1));
        const y = (PTS[idx][1] / 100) * 480;
        setTimeout(() => { try { pg.scrollTop = Math.max(0, y - 220); } catch { /* ignore */ } }, 30);
      }
    } catch { /* ignore */ }
    return p;
  }

  // ---------------------------------------------------------------------------------------------- level intro / complete / failed

  function closeResult() {
    if (resultEl) { resultEl.remove(); resultEl = null; }
  }

  // Tutorial card for a level that introduces something. Returns true if shown (onDone fires on ANLADIM).
  // Marks the intro seen so it only shows once; pass force=true to show it again. Returns false (and does NOT call onDone)
  // when there is nothing to show, so callers can just `if (!menus.showLevelIntro(lv, go)) go();`.
  function showLevelIntro(level, onDone, force) {
    const lv = levelOf(level);
    if (!lv || !lv.intro) return false;
    let seen = false;
    try { seen = meta.introSeen(lv.id); } catch { seen = false; }
    if (seen && !force) return false;
    closeModal();
    const m = el('div', 'fm-modal');
    const card = el('div', 'fm-mcard');
    const ok = button('fm-btn big green', 'ANLADIM!', () => {
      sfx('confirm');
      try { meta.markIntroSeen(lv.id); } catch { /* ignore */ }
      closeModal();
      if (onDone) { try { onDone(); } catch { /* ignore */ } }
    });
    add(card, el('div', 'big', lv.intro.icon), el('div', 'mt', lv.boss ? 'BOSS!' : 'YENİ!'), el('div', 'mm', lv.intro.text), ok);
    m.appendChild(card);
    host.appendChild(m);
    modalEl = m;
    sfx('click');
    return true;
  }

  const TIPS = [
    'Kar yığınları seni büyütür. Büyük top daha çok dayanır.',
    'Yeti yaklaşırsa çarpmamaya bak, hızını koru.',
    'Havadayken aşağı kaydırırsan yere çakılırsın.',
    'Mıknatıs kar tanelerini sana çeker.',
    'Kızak bir çarpışmayı affeder. Çift dokun!',
    'Ritmi dinle: PERFECT bonus verir.',
  ];

  // data: { level (object or id), stars, goalsMet:[bool,bool,bool], rewards (meta.completeLevel result), hasNext }
  // handlers: { onNext, onRetry, onMap }. Rewards are assumed already granted by meta.completeLevel().
  // SONRAKİ ÖDÜL: next shop goal (+ level XP) as a compact progress block
  function goalBlockEl(gained) {
    gained = Math.max(0, Number(gained) || 0);
    let g = null, li = null;
    try { g = nextGoal(save); } catch { g = null; }
    try { li = meta.levelInfo(); } catch { li = null; }
    if (!g && !li) return null;
    const box = el('div', 'fm-goal');
    box.appendChild(el('div', 'gh', 'SONRAKİ ÖDÜL'));
    const bar = (from, to) => { const b = el('div', 'gb'); const i = el('i'); i.style.width = Math.round(Math.max(0, Math.min(1, from)) * 100) + '%'; b.appendChild(i); setTimeout(() => { i.style.width = Math.round(Math.max(0, Math.min(1, to)) * 100) + '%'; }, 900); return b; };
    if (g) {
      const left = Math.max(0, g.price - g.have);
      box.appendChild(el('div', 'gt', left > 0 ? `${g.icon} ${String(g.name).replace(/s*Svd+$/, '')}: ${fmt(left)} ❄️ kaldı` : `${g.icon} ${g.name}: HAZIR!`));
      box.appendChild(bar(g.price > 0 ? Math.max(0, g.have - gained) / g.price : 0, g.frac));
      box.appendChild(add(el('div', 'gs'), el('span', '', `${fmt(g.have)} / ${fmt(g.price)} ❄️`), gained ? el('em', '', `+${fmt(gained)}`) : el('span')));
    }
    if (li) {
      box.appendChild(add(el('div', 'gs'), el('span', '', `SEVİYE ${li.level + 1}`), el('span', '', `${fmt(Math.max(0, li.need - li.cur))} XP`)));
      box.appendChild(bar(li.frac, li.frac));
    }
    return box;
  }

  function showLevelComplete(data, handlers) {
    const d = data || {};
    const h = handlers || {};
    const lv = levelOf(d.level);
    closeResult();
    closeModal();
    const met = Array.isArray(d.goalsMet) ? d.goalsMet : [true, false, false];
    const stars = Math.max(0, Math.min(3, d.stars !== undefined ? d.stars : met.filter(Boolean).length));
    const rw = d.rewards || {};
    const boss = !!(lv && lv.boss);
    const ov = el('div', 'fm-resov');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Bölüm tamam');
    const LB = d.labels || {};
    add(ov, el('div', `fm-banner${boss ? ' boss' : ''}`, boss ? (LB.bossBanner || 'YETİ YENİLDİ!') : (LB.banner || 'BÖLÜM TAMAM!')));
    if (lv) add(ov, el('div', 'fm-rname', `${lv.id}. ${lv.name}`));

    const bs = el('div', 'fm-bigstars');
    const starEls = [0, 1, 2].map(() => el('span', 'fm-bigstar', '★'));
    for (const s of starEls) bs.appendChild(s);
    ov.appendChild(bs);
    for (let i = 0; i < stars; i++) {
      setTimeout(() => {
        if (resultEl !== ov) return;
        starEls[i].classList.add('on');
        sfx('confirm');
        try { if (navigator.vibrate) navigator.vibrate(i === stars - 1 ? [18, 30, 28] : 14); } catch { /* ignore */ }
        if (i === stars - 1) confetti(stars >= 3 ? 90 : 40);
      }, 350 + i * 350);
    }
    if (stars === 0) confetti(20);

    if (lv) {
      const gl = el('div', 'fm-rgoals');
      lv.goals.forEach((g, i) => {
        const row = el('div', `fm-rgoal ${met[i] ? 'got' : 'miss'}`);
        row.style.animationDelay = `${300 + i * 150}ms`;
        add(row, el('span', 'gs', '★'), el('span', '', g.text), el('span', 'ck', met[i] ? '✓' : '✗'));
        gl.appendChild(row);
      });
      ov.appendChild(gl);
    }

    const chips = (Array.isArray(d.chips) ? d.chips.slice() : []).concat(rewardChips(rw));
    if (chips.length) {
      const rc = el('div', 'fm-rchips');
      { const n = chips.length, cols = n <= 3 ? n : (n === 6 ? 3 : 2); rc.style.cssText = `display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:6px;justify-items:stretch;width:min(calc(100% - 24px),380px);margin-left:auto;margin-right:auto`; }
      chips.forEach((c, i) => {
        const ch = el('div', `fm-rchip${/^(👕|✨)/.test(c) ? ' gold' : ''}`, c);
        ch.style.animationDelay = `${900 + i * 160}ms`;
        rc.appendChild(ch);
      });
      ov.appendChild(rc);
    }
    if (rw.chest) {
      const line = rewardLine(rw.chest);
      ov.appendChild(el('div', 'fm-rspecial', `${lv ? ACTS[lv.act - 1].icon : '🎁'} ACT TAMAM! SANDIK${line ? `: ${line}` : ''}`));
    }
    if (rw.perfect) ov.appendChild(el('div', 'fm-rspecial', '💎 KUSURSUZ ACT! +💎 2 · 🎁 1'));
    if (rw.justUnlockedEndless) ov.appendChild(el('div', 'fm-rspecial', '∞ YETİ RUSH AÇILDI!'));
    if (d.special) ov.appendChild(el('div', 'fm-rspecial', d.special));

    { const gb = goalBlockEl(rw.coins || d.coins); if (gb) ov.appendChild(gb); }
    const done = (fn) => () => { sfx('confirm'); closeResult(); if (fn) { try { fn(); } catch { /* ignore */ } } };
    if (lv && stars < 3) {
      const mi = lv.goals.findIndex((g, i) => !met[i]);
      if (mi >= 0 && lv.goals[mi].text) ov.appendChild(el('div', 'fm-rspecial', `⭐ ${mi + 1}. yıldız: ${lv.goals[mi].text}`));
    }
    const btns = el('div', 'fm-rbtns');
    if (d.hasNext) btns.appendChild(button('fm-btn big green', LB.next || 'SONRAKİ BÖLÜM ▶', done(h.onNext)));
    btns.appendChild(add(el('div', 'row'), button('fm-btn blue', LB.retry || '↻ TEKRAR', done(h.onRetry)), button('fm-btn', LB.map ? '⛰️ ' + LB.map : '🗺️ HARİTA', done(h.onMap))));
    ov.appendChild(btns);
    ov.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    host.appendChild(ov);
    resultEl = ov;
    if (stars === 0) sfx('back');
    return { close: closeResult };
  }

  // data: { level, cause: 'yeti'|'fall'|'explode'|... }, handlers: { onRetry, onMap }
  function showLevelFailed(data, handlers) {
    const d = data || {};
    const h = handlers || {};
    const lv = levelOf(d.level);
    closeResult();
    closeModal();
    const LB = d.labels || {};
    const dt = d.title ? { icon: d.icon || '💥', title: d.title, tip: d.tip || '' } : runnerDeathText(d.cause === 'crash' ? 'smash' : d.cause, d.killKind);
    const t = [dt.icon, dt.title];
    const ov = el('div', 'fm-resov fail');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Bölüm başarısız');
    add(ov, el('div', 'fm-ficon', t[0]), el('div', 'fm-banner red', t[1]));
    if (lv) add(ov, el('div', 'fm-rname', `${lv.id}. ${lv.name}`));
    const dist = d.stats && Number.isFinite(d.stats.distance) ? d.stats.distance : d.distance;
    if (lv && Number.isFinite(dist) && lv.length > 0) {
      const pct = Math.max(0, Math.min(99, Math.floor((dist / lv.length) * 100)));
      const bar = el('div', 'fm-abar');
      bar.style.width = '260px';
      const bb = el('div', 'fm-bar');
      const fill = el('i');
      setCss(fill, '--p', `${pct}%`);
      bb.appendChild(fill);
      bar.appendChild(bb);
      add(ov, bar, el('div', 'fm-ftip', `%${pct} tamamlandı · bitişe ${fmt(Math.max(0, lv.length - dist))} m kaldı!`));
      if (pct < 30 || d.title) add(ov, el('div', 'fm-ftip', (dt.tip || TIPS[Math.floor(Math.random() * TIPS.length)])));
    } else add(ov, el('div', 'fm-ftip', (dt.tip || TIPS[Math.floor(Math.random() * TIPS.length)])));
    { const gb = goalBlockEl(0); if (gb) ov.appendChild(gb); }
    const done = (fn) => () => { sfx('confirm'); closeResult(); if (fn) { try { fn(); } catch { /* ignore */ } } };
    const btns = el('div', 'fm-rbtns');
    btns.appendChild(button('fm-btn big green', LB.retry || '↻ TEKRAR DENE', done(h.onRetry)));
    btns.appendChild(button('fm-btn blue', LB.map ? '⛰️ ' + LB.map : '🗺️ HARİTA', done(h.onMap)));
    ov.appendChild(btns);
    host.appendChild(ov);
    resultEl = ov;
    sfx('back');
    return { close: closeResult };
  }

  // ============================================================================================ main screen (lobby)

  // ---------------------------------------------------------------------------------------------- ÇIĞ DAĞLAR (30 mountains)

  const fmtM = (d) => (d >= 10 ? String(Math.round(d)) : (Math.round(d * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, ''));
  const fmtSec = (t) => { const s = Math.max(0, Math.round(t || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // one-time intro card of a mountain that brings something new (BAŞLA! starts it). Returns false when there is nothing to show.
  function showCigIntro(plan, onDone) {
    if (!plan || !plan.intro) return false;
    let seen = false;
    try { seen = save.cigIntroSeen(plan.n); } catch { seen = false; }
    if (seen) return false;
    closeModal();
    const m = el('div', 'fm-modal');
    const card = el('div', 'fm-mcard');
    const ok = button('fm-btn big green', 'BAŞLA!', () => {
      sfx('confirm');
      try { save.markCigIntro(plan.n); } catch { /* ignore */ }
      closeModal();
      if (onDone) { try { onDone(); } catch { /* ignore */ } }
    });
    add(card, el('div', 'big', plan.intro.icon), el('div', 'mt', plan.boss ? 'PATRON!' : 'YENİ!'), el('div', 'mm', plan.intro.text), ok);
    m.appendChild(card);
    host.appendChild(m);
    modalEl = m;
    sfx('click');
    return true;
  }

  // (intro card first when the mountain is new to you) -> the game
  function cigStart(n) {
    const go = () => {
      closePanel(true);
      if (cb.onCigLevel) cb.onCigLevel(n, {});
      else if (cb.onLevels) cb.onLevels();
    };
    if (showCigIntro(dagPlan(n), go)) return;
    go();
  }

  function openCigCard(p, n) {
    closeCard();
    sfx('open');
    const plan = dagPlan(n), brief = planBrief(n);
    const stars = save.cigLvStars(n), best = save.cigLvBest(n);
    const back = el('div', 'fm-lback');
    back.addEventListener('click', () => { sfx('close'); closeCard(); });
    const card = el('div', 'fm-lcard');
    const ca = plan.boss ? '#ff8a7a' : '#8fd3ff', cbb = plan.boss ? '#e0392b' : '#4a8cff';
    setCss(card, '--ca', ca); setCss(card, '--cb', cbb);
    const lbig = el('div', 'lbig', plan.boss ? '👹' : '⛰️');
    setCss(lbig, '--ca', ca); setCss(lbig, '--cb', cbb);
    const head = el('div', 'fm-lhead');
    add(head, lbig, add(el('div', ''), el('div', 'l1', 'DAĞ ' + n + (plan.boss ? ' · PATRON' : '') + ' · ' + brief.S + ' ETAP'), el('div', 'l2', plan.name)),
      button('fm-x', '✕', () => { sfx('close'); closeCard(); }, 'Kapat'));
    card.appendChild(head);
    card.appendChild(el('div', 'fm-lbest', brief.tierFrom + ' → ' + brief.tierTo));
    const goals = el('div', 'fm-lgoals');
    plan.stars.forEach((g, i) => goals.appendChild(add(el('div', 'fm-lgoal' + (i < stars ? ' got' : '')), el('span', 'gs', '★'), el('span', '', g.text))));
    card.appendChild(goals);
    if (plan.intro) card.appendChild(add(el('div', 'fm-lintro'), el('span', 'ii', plan.intro.icon), el('span', '', plan.intro.text)));
    if (best && stars > 0) card.appendChild(el('div', 'fm-lbest', 'REKOR ' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars) + ' · ' + fmtM(best.size) + ' m · ' + fmtTons(best.tons) + (best.time ? ' · ' + fmtSec(best.time) : '')));
    card.appendChild(button('fm-btn big green', 'OYNA ▶', () => { sfx('confirm'); closeCard(); cigStart(n); }));
    p.el.appendChild(back);
    p.el.appendChild(card);
    cardRef = { back, card };
  }

  function shake(b) { b.classList.add('fm-shake'); sfx('error'); setTimeout(() => b.classList.remove('fm-shake'), 340); }

  // the ÇIĞ panel: next mountain button, the 30-mountain grid, endless (opens with DAĞ 10) and the daily mountain (opens with DAĞ 3)
  function openCigLevels(focus) {
    sfx('click');
    const cleared = save.cigCleared(), next = save.cigNext();
    const p = openPanel({ id: 'cig', title: 'ÇIĞ', sub: '⭐ ' + save.cigLvTotalStars() + '/' + DAG_COUNT * 3, pills: ['coins', 'crystals'] });
    const list = p.list;
    const np = dagPlan(next);
    const q = button('fm-btn big green fm-cgq', '', () => { sfx('confirm'); cigStart(next); });
    add(q, el('b', '', cleared >= DAG_COUNT ? 'SON DAĞ ▶' : 'SONRAKİ DAĞ ▶'), el('small', '', 'DAĞ ' + next + ' · ' + np.name));
    list.appendChild(q);

    const grid = el('div', 'fm-cgrid');
    let focusEl = null;
    for (let n = 1; n <= DAG_COUNT; n++) {
      const st = save.cigLvStars(n);
      const locked = n > save.cigUnlocked();
      const boss = n % 5 === 0;
      const state = locked ? 'lk' : n === cleared + 1 ? 'cur' : 'done';
      const b = el('button', 'fm-cgn ' + state + (boss ? ' boss' : ''));
      b.setAttribute('type', 'button');
      b.setAttribute('aria-label', 'Dağ ' + n + ': ' + dagPlan(n).name + (st ? ', ' + st + ' yıldız' : locked ? ', kilitli' : ''));
      add(b, el('span', 'n', locked ? '🔒' : boss ? '👹' : String(n)));
      if (boss && !locked) b.appendChild(el('span', 'bn', String(n)));
      if (!locked) {
        const stars = el('span', 'stars');
        for (let k = 1; k <= 3; k++) stars.appendChild(el('b', k <= st ? 'on' : '', '★'));
        b.appendChild(stars);
      }
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (locked) { shake(b); toast({ icon: '🔒', title: 'Önce DAĞ ' + (cleared + 1) + "'i bitir", ms: 1500 }); return; }
        sfx('click');
        openCigCard(p, n);
      });
      if (n === focus || (!focus && n === next)) focusEl = b;
      grid.appendChild(b);
    }
    list.appendChild(grid);

    const endOpen = save.cigEndlessOpen();
    const eb = save.cigEndlessBest ? save.cigEndlessBest() : { tons: 0 };
    const er = button('fm-cgrow' + (endOpen ? '' : ' lock'), '', () => {
      if (!endOpen) { shake(er); toast({ icon: '🔒', title: "ÇIĞ SONSUZ için DAĞ 10'u bitir", ms: 1600 }); return; }
      sfx('confirm'); closePanel(true);
      try { meta.setMode('cig'); } catch { /* ignore */ }
      if (cb.onCigEndless) cb.onCigEndless();
    });
    add(er, el('span', 'ic', '∞'), add(el('span', 'tx'), el('b', '', 'ÇIĞ SONSUZ'), el('small', '', endOpen ? (eb.tons > 0 ? 'REKOR ' + fmtTons(eb.tons) : 'Bitmeyen iniş') : "DAĞ 10'u bitir")));
    list.appendChild(er);

    const dayOpen = save.cigDailyOpen();
    const dr = button('fm-cgrow' + (dayOpen ? '' : ' lock'), '', () => {
      if (!dayOpen) { shake(dr); toast({ icon: '🔒', title: "Günün Dağı için DAĞ 3'ü bitir", ms: 1600 }); return; }
      sfx('confirm'); closePanel(true);
      try { meta.setMode('daily'); } catch { /* ignore */ }
      if (cb.onDaily) cb.onDaily();
    });
    add(dr, el('span', 'ic', '🏔️'), add(el('span', 'tx'), el('b', '', 'GÜNÜN DAĞI #' + info.dailyNum), el('small', '', dayOpen ? (info.dailyBest > 0 ? 'Rekorun: ' + fmtTons(info.dailyBest) : 'Bugünün özel dağı') : "DAĞ 3'ü bitir")));
    list.appendChild(dr);

    if (focusEl) { try { setTimeout(() => focusEl.scrollIntoView({ block: 'center' }), 30); } catch { /* ignore */ } }
    return p;
  }

  function secBtn(cls, emoji, label, fn) {
    const b = button(`fm-sb ${cls}`, '', () => { sfx('click'); fn(); }, label);
    const ic = el('span', 'ic', emoji);
    const bdg = el('span', 'fm-bdg off', '');
    ic.appendChild(bdg);
    add(b, ic, el('span', 'lb', label));
    return { b, bdg, ic };
  }

  const bestOf = () => {
    let bd = info.endlessBestDist | 0;
    try { bd = Math.max(bd, (save && save.runnerBestDist ? save.runnerBestDist() : 0) | 0); } catch { /* ignore */ }
    return bd;
  };

  function startCig() {
    try { meta.setMode('cig'); } catch { /* ignore */ }
    openCigLevels();
  }

  function buildMain() {
    const root0 = el('div', 'fm-main fm-hide');
    const r = {};
    r.root = root0;

    // ---- top bar: avatar (level) · daily reward badge · currencies ----
    const top = el('div', 'fm-top');
    r.av = button('fm-av', '', () => {
      sfx('click');
      const li = meta.levelInfo();
      toast({ icon: '⭐', title: `SEVİYE ${li.level}`, sub: `${fmt(li.cur)} / ${fmt(li.need)} XP`, ms: 2000 });
    }, 'Seviye');
    const avc = el('div', 'fm-avc', '⛄');
    r.lvNum = el('span', 'fm-lv', '1');
    avc.appendChild(r.lvNum);
    r.avName = el('span', 'fm-nm', 'Oyuncu');
    r.avXp = el('span', 'fm-xp');
    r.avXpFill = el('i');
    r.avXp.appendChild(r.avXpFill);
    add(r.av, avc, add(el('span', 'fm-avt fm-prof'), r.avName, r.avXp));
    r.dl = button('fm-dl', '', () => openDaily(), 'Günlük ödül');
    r.dlBdg = el('span', 'fm-bdg dot off', '!');
    r.dlStreak = el('span', 'fm-dls', '');
    add(r.dl, el('span', 'ic', '🎁'), r.dlBdg, r.dlStreak);
    r.coinsPill = makePill('❄️', '', () => { sfx('click'); if (cb.onShop) cb.onShop(); }, 'fm-cur');
    r.crPill = makePill('💎', 'cr', () => { sfx('click'); if (meta.boxes > 0) openBoxes(meta.boxes); else openMissions(); }, 'fm-cur');
    r.boxBdg = el('span', 'fm-bdg dot gold off', '🎁');
    r.crPill.el.appendChild(r.boxBdg);
    for (const [bx, tx] of [[r.dl, 'Günlük ödül'], [r.coinsPill.el, '❄️ Al'], [r.crPill.el, '💎 Al']]) { bx.style.position = 'relative'; bx.title = tx; bx.appendChild(el('span', 'fm-cl', tx)); }
    r.rwChip = button('fm-rwc off', '', () => { sfx('open'); openDailyTasks(); }, 'Hazır ödüller');
    add(top, r.av, r.dl, r.coinsPill.el, r.crPill.el, r.rwChip);
    {
      const mo = new Date().getMonth();
      const season = mo >= 2 && mo <= 4 ? 'spring' : mo >= 5 && mo <= 7 ? 'summer' : mo >= 8 && mo <= 10 ? 'autumn' : 'winter';
      root0.setAttribute('data-season', season);
      const em = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '' }[season];
      if (em) {
        const sl = el('div', 'fm-season');
        for (let k = 0; k < 7; k++) { const q = el('i', '', em); q.style.left = `${6 + k * 14}%`; q.style.animationDuration = `${9 + (k * 37 % 7)}s`; q.style.animationDelay = `-${(k * 53 % 9)}s`; q.style.fontSize = `${13 + (k % 3) * 4}px`; sl.appendChild(q); }
        root0.appendChild(sl);
      }
    }
    root0.appendChild(top);

    // ---- logo (7 taps = rainbow secret); the snowball mascot rides along ----
    const logo = el('div', 'fm-logo');
    logo.setAttribute('role', 'img');
    logo.setAttribute('aria-label', 'PATPAT');
    const COL = [['#ff7a8a', '#ff2d55'], ['#ffc457', '#ff8a00'], ['#ffec6a', '#ffc400'], ['#7cf0a2', '#22b86c'], ['#6fd0ff', '#2f7dff'], ['#c79bff', '#7a3cf0']];
    WORD.split('').forEach((ch, i) => {
      const c = el('span', 'fm-ch', ch);
      c.setAttribute('data-t', ch);
      setCss(c, '--i', String(i));
      setCss(c, '--c1', COL[i][0]);
      setCss(c, '--c2', COL[i][1]);
      logo.appendChild(c);
    });
    const ball = el('span', 'fm-ball');
    setCss(ball, '--i', String(WORD.length));
    add(ball, el('i', 'e l'), el('i', 'e r'), el('i', 'n'));
    logo.appendChild(ball);
    r.logo = logo;
    r.logoBall = ball;
    root0.appendChild(add(el('div', 'fm-logorow'), logo));
    root0.appendChild(el('div', 'fm-tag', 'KARTOPU · YETİ · ÇIĞ'));

    // ---- middle: the 3D snowball shows through; tap it ----
    const mid = el('div', 'fm-mid');
    const hero = el('div', 'fm-hero');
    r.hero = hero;
    r.achoo = el('div', 'fm-achoo', 'HAPŞUU!');
    r.bestV = el('span', 'bv', '');
    r.bestS = el('span', 'bs', 'Yeti seni bekliyor!');
    r.best = add(el('div', 'fm-best'), el('span', 'bk', 'YETİ RUSH REKORU'), r.bestV, r.bestS);
    r.aura = el('div', 'fm-aura');
    add(hero, r.best, r.achoo);
    r.globe = button('fm-globe', '', () => shakeGlobe(), 'Günlük Kar Küresi');
    r.globeIc = el('span', 'gl', '🔮');
    r.globeBdg = el('span', 'fm-bdg dot gold off', '!');
    r.globeLb = el('span', 'glt', 'KAR KÜRESİ');
    add(r.globe, r.globeIc, r.globeBdg, r.globeLb);
    // side rails (Brawl Stars style): Kar Küresi + Yeti Postası + BUGÜN shortcuts, at mid-height beside the ball
    r.mid = mid;
    r.railL = el('div', 'fm-rail l');
    r.railR = el('div', 'fm-rail r');
    r.rails = add(el('div', 'fm-rails'), r.railL, r.railR);
    add(mid, hero, r.rails);
    root0.appendChild(mid);
    root0.appendChild(r.aura);

    // ---- info card: missions + multiplier + streak, next unlock goal ----
    const infoCard = el('div', 'fm-info');
    infoCard.setAttribute('role', 'button');
    infoCard.setAttribute('aria-label', 'Görevler');
    infoCard.tabIndex = 0;
    r.multChip = el('span', 'fm-ichip mult', '✖️ ×1 ÇARPAN');
    r.streakChip = el('span', 'fm-ichip', '🔥 0');
    add(infoCard, add(el('div', 'fm-ihead'), r.ihTitle = el('span', '', '📅 GÜNLÜK GÖREVLER'), add(el('div', 'fm-chips'), r.streakChip, r.multChip)));
    r.mrows = el('div', 'fm-mrows');
    infoCard.appendChild(r.mrows);
    r.goalBtn = button('fm-hgoal', '', () => { sfx('click'); if (cb.onShop) cb.onShop(); }, 'Sıradaki hedef');
    infoCard.appendChild(r.goalBtn);
    infoCard.addEventListener('click', () => { if (infoCard.classList.contains('cmp')) { r.expanded = true; updateMain(); return; } openDailyTasks(); });
    infoCard.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDailyTasks(); } });
    r.streakChip.addEventListener('click', (e) => { e.stopPropagation(); sfx('click'); openDaily(); });
    r.info = infoCard;
    root0.appendChild(infoCard);
    r.sum = el('div', 'fm-sum', '');
    r.sum.addEventListener('click', (e) => { e.stopPropagation(); sfx('open'); openDailyTasks(); });
    infoCard.insertBefore(r.sum, infoCard.firstChild);
    // SIRADAKİ HEDEF: a slim line inside the GÜNLÜK card (one compact block instead of two)
    r.sgoal = button('fm-sgoal', '', () => { sfx('click'); if (r._sgFn) r._sgFn(); }, 'Sıradaki hedef');
    r.sgoal.addEventListener('click', (e) => e.stopPropagation());
    r.sgoal.style.display = 'none';
    infoCard.insertBefore(r.sgoal, r.sum.nextSibling);
    r.twrap = r.rails; // the FTUE gate locks the BUGÜN shortcuts (now the rails) for the first runs

    // ---- bottom: OYNA (straight into YETİ RUSH) + ÇIĞ SONSUZ · MACERA · Dolap · Görevler · Ayarlar ----
    const bot = el('div', 'fm-bot');
    r.lastChip = button('fm-lastc', '', () => { const l = lastGet(); sfx('confirm'); if (!l) return; if (l.k === 'cigL' && cb.onCigLevel) cb.onCigLevel(l.n, {}); else if (l.k === 'cigE' && cb.onCigEndless) cb.onCigEndless(); else if (l.k === 'arena' && cb.onAgar) cb.onAgar(); else if (l.k === 'camp' && cb.onPlayLevel) cb.onPlayLevel(l.n); else playMode('endless'); }, 'Son oynanan');
    r.lastChip.style.display = 'none';
    bot.appendChild(r.lastChip);
    r.play = button('fm-play', 'OYNA', () => { sfx('confirm'); playMode('endless'); }, 'Oyna: Yeti Rush');
    r.play.appendChild(el('small', '', 'YETİ RUSH'));
    add(bot, add(el('div', 'fm-playw'), r.play));
    r.arena = button('fm-arena', '', () => { sfx('confirm'); if (cb.onAgar) cb.onAgar(); }, 'Kartopu Arena');
    add(r.arena, el('span', 'ico', '⚔️'), add(el('span', 'tx'), el('b', '', 'KARTOPU ARENA'), el('small', '', 'Dev harita · botlar · arkadaşlarınla oda kur')));
    bot.appendChild(r.arena);
    const sCig = secBtn('c-cig', '⛰️', 'ÇIĞ', () => startCig());
    const sMap = secBtn('c-map', '🗺️', 'MACERA', () => { try { meta.setMode('camp'); } catch { /* ignore */ } openMap(); });
    const sShop = secBtn('c-shop', '👕', 'Dolap', () => { if (cb.onShop) cb.onShop(); });
    const sMis = secBtn('c-mis', '📜', 'Görevler', () => openMissions());
    const sPass = secBtn('c-pass', '🛂', 'PASAPORT', () => { try { localStorage.setItem('patpat.stampsSeen', String(meta.stamps().filter((x) => x.got).length)); } catch { /* ignore */ } openPassport(); updateMain(); });
    r.passBdg = sPass.bdg; r.sPass = sPass.b;
    r.post = button('fm-post', '✉️', () => { sfx('click'); openPostcard(); }, 'Yeti Postası');
    r.postBdg = el('span', 'fm-bdg dot off', '!'); r.post.appendChild(r.postBdg);
    r.railL.appendChild(r.globe); r.railL.appendChild(r.post);
    const sSet = secBtn('c-set', '⚙️', 'Ayarlar', () => openSettings());
    r.xchip = el('span', 'fm-xchip', ''); r.xchip.style.display = 'none';
    sMis.ic.appendChild(r.xchip);
    r.bMis = sMis.bdg; r.bShop = sShop.bdg;
    bot.appendChild(add(el('div', 'fm-secrow'), sCig.b, sMap.b, sShop.b, sMis.b, sPass.b, sSet.b));
    root0.appendChild(bot);

    host.appendChild(root0);
    { let rt = 0; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (mainOpen && refs) { try { updateMain(); } catch { /* ignore */ } } }, 250); }); }
    wireEggs(r);
    refs = r;
    return r;
  }

  function shakeGlobe() {
    const r = refs;
    if (!r || r.globe.classList.contains('shk')) return;
    let ready = false;
    try { ready = meta.globeReady(); } catch { /* ignore */ }
    if (!ready) { sfx('error'); toast({ icon: '🔮', title: 'KAR KÜRESİ', sub: 'Yarın yeniden salla!', ms: 1800 }); return; }
    sfx('click');
    r.globe.classList.add('shk');
    setTimeout(() => {
      r.globe.classList.remove('shk');
      let out = null;
      try { out = meta.globeShake(); } catch { out = null; }
      if (!out) { updateMain(); return; }
      sfx('confirm');
      burst(r.globe, out.crystals ? '💎' : out.boxes ? '🧩' : '❄️', 12, 70);
      const bits = [];
      if (out.coins) bits.push('+' + out.coins + ' ❄️');
      if (out.crystals) bits.push('+' + out.crystals + ' 💎');
      if (out.boxes) bits.push('🧩 Kostüm parçası (+1 kutu)');
      toast({ icon: '🔮', title: 'KAR KÜRESİ!', sub: bits.join(' · '), kind: 'gold', ms: 2600 });
      updateMain();
    }, 700);
  }

  function updateMain() {
    const r = refs;
    if (!r) return;
    const li = meta.levelInfo();
    r.lvNum.textContent = String(li.level);
    let nick = '';
    try { nick = localStorage.getItem('patpat.agar.nick') || ''; } catch { /* ignore */ }
    r.avName.textContent = nick || 'Oyuncu';
    r.avXpFill.style.width = `${Math.round(Math.max(0, Math.min(1, li.cur / Math.max(1, li.need))) * 100)}%`;
    r.coinsPill.set(coins(), false);
    r.crPill.set(meta.crystals, false);

    const mult = meta.multiplier();
    r.multChip.textContent = `✖️ ×${mult} ÇARPAN`;

    const bd = bestOf();
    const cigB = (() => { try { return save.cigEndlessBest ? save.cigEndlessBest() : null; } catch { return null; } })();
    const ccB = (() => { try { return save.cigCleared() | 0; } catch { return 0; } })();
    r.bestV.textContent = bd > 0 ? `${fmt(bd)} m` : 'İLK KOŞU?';
    let cig = { tons: 0, dist: 0 };
    try { cig = save && save.cigEndlessBest ? save.cigEndlessBest() : cig; } catch { /* ignore */ }
    let cc = 0, cs = 0;
    try { cc = save.cigCleared(); cs = save.cigLvTotalStars(); } catch { /* ignore */ }
    r.bestS.textContent = cc > 0 ? `ÇIĞ: DAĞ ${cc} · ⭐ ${cs}` : (cig.tons > 0 ? `ÇIĞ: ${fmtTons(cig.tons)}` : (bd > 0 ? 'Yeti seni bekliyor!' : 'Yeti seni kovalıyor!'));

    // missions (3 compact rows)
    clear(r.mrows);
    let dtl = { tasks: [], claimable: 0 };
    try { dtl = meta.dailyTasks(); } catch { /* ignore */ }
    r.ihTitle.textContent = '📅 GÜNLÜK GÖREVLER';
    r.xchip.textContent = dtl.claimable ? String(dtl.claimable) : '';
    r.xchip.style.display = dtl.claimable ? '' : 'none';
    r.rwChip.textContent = dtl.claimable ? `🎁 ${dtl.claimable}` : '';
    r.rwChip.classList.toggle('off', !dtl.claimable);
    for (const m of dtl.tasks) {
      const row = el('div', `fm-mr${m.claimed ? ' got done' : m.done ? ' done claim' : ''}`);
      const bar = el('span', 'mb');
      const fill = el('i');
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, m.value / Math.max(1, m.goal))) * 100)}%`;
      bar.appendChild(fill);
      add(row, el('span', 'mi', m.icon), el('span', 'mt', m.text.replace(/^[^:]+: /, '')), bar, el('span', 'mn', m.claimed ? '✓' : m.done ? 'AL!' : (m.goal > 1 ? `${fmt(m.value)}/${fmt(m.goal)}` : '0/1')));
      r.mrows.appendChild(row);
    }

    // daily reward = badge on the 🎁 button + the streak
    let db = { available: false, streak: 0 };
    try { db = meta.dailyBadge(); } catch { /* ignore */ }
    r.dlBdg.className = `fm-bdg dot${db.available ? ' pulse' : ' off'}`;
    r.dl.classList.toggle('ready', !!db.available);
    r.dlStreak.textContent = db.streak > 0 ? `🔥${db.streak}` : '';
    r.streakChip.textContent = db.reward ? `🔥 ${db.streak} gün · AL` : `🔥 ${db.streak} gün`;
    r.streakChip.classList.toggle('hot', !!db.reward);

    // single attention marker: claimable reward > Kar Küresi > İLK KOŞU
    let gr0 = false; try { gr0 = meta.globeReady(); } catch { /* ignore */ }
    const att = (db.available || dtl.claimable) ? 'reward' : gr0 ? 'globe' : bd <= 0 ? 'first' : '';
    r.root.setAttribute('data-att', att);
    if (bd <= 0 && att !== 'first') r.bestV.textContent = (ccB > 0 || (cigB && cigB.tons > 0)) ? 'RUSH\'I DENE!' : 'İLK KOŞU?';
    // compact daily card: 1-line summary when done or on short screens (tap to expand)
    {
      const nT = dtl.tasks.length, nDone = dtl.tasks.filter((m) => m.claimed).length;
      const allDone = nT > 0 && dtl.tasks.every((m) => m.claimed || m.done);
      let shortScr = false; try { shortScr = window.innerHeight < 760; } catch { /* ignore */ }
      const cmp = !r.expanded;
      r.info.classList.toggle('cmp', cmp);
      const rdy = !!(dtl.claimable || db.available);
      r.info.classList.toggle('hot', cmp && rdy);
      clear(r.sum);
      const pips = el('span', 'sp');
      for (let k = 0; k < Math.max(nT, 1); k++) pips.appendChild(el('i', k < nDone ? 'on' : ''));
      add(r.sum, el('span', 'sl', `GÜNLÜK ${nDone}/${nT}`), pips, rdy ? el('span', 'sr rdy', 'AL') : el('span', 'sr', '🎁'));
    }
    // BUGÜN: live events as round shortcuts in the side rails (right rail first, then left under the globe / post)
    try {
      const chips = [];
      try {
        const se = meta.season();
        const nxt = se.tiers.find((t) => t.state === "locked");
        const prev = [...se.tiers].reverse().find((t) => t.need <= se.tokens);
        const lo = prev ? prev.need : 0;
        const frac = nxt ? Math.max(0, Math.min(1, (se.tokens - lo) / Math.max(1, nxt.need - lo))) : 1;
        const gf = Math.max(0, Math.min(1, se.claimed / Math.max(1, se.total)));
        if (se.daysLeft <= 3 && se.msLeft > 0) chips.push({ ic: "⏳", lb: `Sezon ${se.msLeft < 86400000 ? Math.max(1, Math.ceil(se.msLeft / 3600000)) + "s" : se.daysLeft + "g"}`, red: true, rank: -1, fn: () => openSeason(), aria: "Sezon bitiyor" });
        chips.push({ sez: true, hot: se.ready > 0, frac, gf, lb: `Sezon ${se.claimed}/${se.total}`, rank: -2, fn: () => openSeason(), aria: "Sezon Avı" });
      } catch { /* ignore */ }
      try {
        if (save.wheelSeen && save.wheelSeen() && save.wheelDay() !== dayKey()) chips.push({ ic: "🎡", lb: "Şans Çarkı", hot: true, rank: 0, fn: () => openWheel(false), aria: "Şans Çarkı" });
      } catch { /* ignore */ }
      try { let dr = null; try { dr = JSON.parse(localStorage.getItem("patpat.dailyRush") || "null"); } catch { /* ignore */ }
        const bst = dr && dr.dist > 0 && dr.key === dayKey() ? dr.dist : 0;
        chips.push({ ic: "🏃", lb: bst ? `${Math.round(bst)} m` : "Günün Rush'ı", hot: !bst, rank: 2, fn: () => { if (cb.onDailyRush) cb.onDailyRush(); }, aria: "Günün Rush'ı" });
      } catch { /* ignore */ }
      const sm = stormOf();
      const sl = sm.ids.filter((i) => !sm.got[i]).length;
      if (sl) chips.push({ ic: "⭐", lb: "Fırtına x2", hot: true, rank: 0, fn: () => { try { meta.setMode("camp"); } catch { /* ignore */ } openMap(sm.ids.find((i) => !sm.got[i])); } });
      let wl = 0; try { const w = new Date(); wl = Math.max(0, new Date(w.getFullYear(), w.getMonth(), w.getDate() - ((w.getDay() + 6) % 7) + 7) - w); } catch { /* ignore */ }
      const wd = Math.floor(wl / 86400000);
      chips.push({ ic: "🛒", lb: wd < 1 ? "Pazar yarın" : `Pazar ${wd}g`, hot: wd < 1, rank: 3, fn: () => { try { localStorage.setItem("patpat.shopTab", "pazar"); } catch { /* ignore */ } if (cb.onShop) cb.onShop(); }, aria: "Yeti Pazarı" });
      if (cb.onDaily && save.cigDailyOpen && save.cigDailyOpen()) chips.push({ ic: "🏔", lb: "Günün Dağı", hot: !(info.dailyBest > 0), rank: 3, fn: () => { try { meta.setMode("daily"); } catch { /* ignore */ } cb.onDaily(); } });
      try { const vt = vitrinInfo(save); if (vt && !vt.owned) chips.push({ ic: "👕", lb: "Vitrin", rank: 3, fn: () => { try { localStorage.setItem("patpat.shopTab", "skin"); } catch { /* ignore */ } if (cb.onShop) cb.onShop(); } }); } catch { /* ignore */ }
      const ordered = chips.map((c, i) => ({ c, i })).sort((x, y) => (x.c.rank - (x.c.hot ? 0.5 : 0)) - (y.c.rank - (y.c.hot ? 0.5 : 0)) || x.i - y.i).map((o) => o.c);
      // how many fit beside the ball: ~72 px per shortcut; the left rail also carries the Kar Küresi (+ Yeti Postası)
      let H = 0; try { H = r.mid.clientHeight; } catch { /* ignore */ }
      if (!(H > 0)) H = 300;
      const postOn = !r.post.classList.contains("off");
      const capR = Math.max(1, Math.min(4, Math.floor((H + 9) / 72)));
      const capL = Math.max(0, Math.min(3, Math.floor((H + 9 - 74 - (postOn ? 54 : 0)) / 72)));
      for (const n of [...r.railR.children]) n.remove();
      for (const n of [...r.railL.querySelectorAll(".fm-rc")]) n.remove();
      const mk = (c) => {
        const b = button(`fm-rc${c.red ? " red" : c.hot ? " hot" : ""}`, "", () => { sfx("click"); c.fn(); }, c.aria || c.lb);
        const ri = el("span", "ri");
        if (c.sez) {
          const NS = "http://www.w3.org/2000/svg", C = 2 * Math.PI * 9;
          const svg = document.createElementNS(NS, "svg");
          svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "fm-sring");
          const mkS = (t, a) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); svg.appendChild(n); return n; };
          mkS("circle", { class: "bg", cx: 12, cy: 12, r: 9 });
          mkS("circle", { class: "fg", cx: 12, cy: 12, r: 9, "stroke-dasharray": `${(C * c.frac).toFixed(1)} ${C.toFixed(1)}` });
          const tx = mkS("text", { x: 12, y: 12.5 }); tx.textContent = "🧣";
          tx.setAttribute("style", `filter:grayscale(${100 - Math.round(c.gf * 100)}%) opacity(${(0.55 + 0.45 * c.gf).toFixed(2)})`);
          ri.appendChild(svg);
        } else ri.textContent = c.ic;
        add(b, ri, el("span", "rl", c.lb));
        return b;
      };
      ordered.slice(0, capR).forEach((c) => r.railR.appendChild(mk(c)));
      ordered.slice(capR, capR + capL).forEach((c) => r.railL.appendChild(mk(c)));
    } catch { /* ignore */ }

    // SIRADAKI HEDEF: single next goal (claimable first, else cheapest unowned item)
    try {
      let goal = null;
      let se2 = null; try { se2 = meta.season(); } catch { /* ignore */ }
      if (db.reward) goal = { claim: true, name: 'AL: Günlük ödül', fn: () => openDaily() };
      else if (dtl.claimable) goal = { claim: true, name: 'AL: Görev ödülü', fn: () => openDailyTasks() };
      else if (se2 && se2.ready > 0) goal = { claim: true, name: 'AL: Sezon ödülü', fn: () => openSeason() };
      else if ((meta.unclaimedCount() | 0) > 0) goal = { claim: true, name: 'AL: Başarım ödülü', fn: () => openMissions() };
      else if (gr0) goal = { claim: true, name: 'AL: Kar Küresi', fn: () => shakeGlobe() };
      else {
        let bestIt = null;
        for (const [list, kind] of [[SKINS, 'skin'], [TRAILS, 'trail']]) {
          for (const it of list) {
            if (!(it.price > 0) || it.unlock || save.isOwned(kind, it.id)) continue;
            if (!bestIt || it.price < bestIt.it.price) bestIt = { it, kind };
          }
        }
        if (bestIt) {
          const have = save.coins | 0, pr = save.shopPrice ? save.shopPrice(bestIt.it.price) : bestIt.it.price; // (coupon aware)
          goal = { name: bestIt.it.name, have, price: pr, frac: Math.min(1, have / pr), ready: have >= pr, fn: () => { try { localStorage.setItem('patpat.shopTab', bestIt.kind); } catch { /* ignore */ } if (cb.onShop) cb.onShop(); } };
        }
      }
      if (goal) {
        r._sgFn = goal.fn;
        r.sgoal.style.display = '';
        r.sgoal.classList.toggle('claim', !!(goal.claim || goal.ready));
        clear(r.sgoal);
        if (goal.claim) add(r.sgoal, el('span', 'sg-t', 'SIRADAKİ HEDEF'), el('span', 'sg-n', goal.name), el('span', 'sg-c', '▶'));
        else {
          const bar = el('span', 'sg-b'), fill = el('i');
          fill.style.width = Math.round(goal.frac * 100) + '%';
          bar.appendChild(fill);
          add(r.sgoal, el('span', 'sg-t', 'HEDEF'), el('span', 'sg-n', goal.name), bar, el('span', 'sg-c', goal.ready ? 'AL! ▶' : fmt(goal.have) + '/' + fmt(goal.price) + ' ❄️'));
        }
      } else r.sgoal.style.display = 'none';
    } catch { r.sgoal.style.display = 'none'; }
    // İLK ADIMLAR celebration card (one combined toast on the next menu visit)
    try {
      const fsx = meta.firstSteps();
      if (fsx.pending.length && !wheelPending()) { meta.firstStepsSeen(); toast({ icon: '🎁', title: 'İLK ADIMLAR ÖDÜLÜ!', sub: fsx.pending.join(' | '), kind: 'gold', ms: 3600 }); }
    } catch { /* ignore */ }

    // next unlock goal
    let g = null;
    try { g = nextGoal(save); } catch { g = null; }
    const showG = false; // replaced by the SIRADAKİ HEDEF chip
    r.goalBtn.style.display = showG ? '' : 'none';
    if (showG) {
      r.goalBtn.classList.toggle('ready', g.ready);
      clear(r.goalBtn);
      const bar = el('span', 'gb');
      const fill = el('i');
      fill.style.width = `${Math.round(g.frac * 100)}%`;
      bar.appendChild(fill);
      add(r.goalBtn, el('span', 'gi', g.icon), el('span', 'gn', g.id === 'pink' ? 'Pembe İz kilidi' : g.name.replace(/ izi$/i, '') + ' İz kilidi'), bar, el('span', 'gc', g.ready ? 'HAZIR!' : `${fmt(g.have)}/${fmt(g.price)} ❄️`));
      r.bShop.className = `fm-bdg dot gold${g.ready ? ' pulse' : ' off'}`;
      r.bShop.textContent = '!';
    }
    if (g) { r.bShop.className = 'fm-bdg dot gold' + (g.ready ? ' pulse' : ' off'); r.bShop.textContent = '!'; } else r.bShop.className = 'fm-bdg off';

    try {
      const got = meta.stamps().filter((x) => x.got).length;
      let seen = 0;
      try { seen = parseInt(localStorage.getItem('patpat.stampsSeen') || '0', 10) || 0; } catch { /* ignore */ }
      const nw = Math.max(0, got - seen);
      r.passBdg.textContent = nw ? String(nw) : '';
      r.passBdg.className = `fm-bdg dot${nw ? ' pulse' : ' off'}`;
    } catch { /* ignore */ }
    try {
      const pc = meta.postcard();
      r.post.classList.toggle('off', !pc.available);
      r.postBdg.className = `fm-bdg dot${pc.available ? ' pulse' : ' off'}`;
    } catch { /* ignore */ }
    try {
      const gr = meta.globeReady();
      r.globeBdg.className = 'fm-bdg dot gold' + (gr ? ' pulse' : ' off');
      r.globe.classList.toggle('ready', gr);
      r.globe.classList.toggle('used', !gr);
      r.globeLb.textContent = gr ? 'KAR KÜRESİ' : 'YARIN';
    } catch { /* ignore */ }
    const nb = meta.boxes | 0;
    r.boxBdg.textContent = nb > 1 ? String(nb) : '🎁';
    r.boxBdg.className = `fm-bdg dot gold${nb > 0 ? ' pulse' : ' off'}`;

    const unclaimed = meta.unclaimedCount();
    r.bMis.textContent = String(unclaimed);
    r.bMis.className = `fm-bdg${unclaimed <= 0 ? ' off' : ''}`;
    // only ONE attention badge on the whole screen, by priority
    let shown = false;
    for (const b of [att === 'reward' ? r.dlBdg : null, r.bMis, r.boxBdg, r.globeBdg, r.bShop, r.passBdg, r.postBdg]) {
      if (!b) continue;
      if (b.classList.contains('off')) continue;
      if (!shown) { shown = true; continue; }
      b.classList.add('off');
    }
    try { applyFtue(r); } catch { /* ignore */ }
    try {
      const l = lastGet();
      const nm = !l ? '' : l.k === 'rush' ? 'YETİ RUSH' : l.k === 'cigE' ? 'ÇIĞ SONSUZ' : l.k === 'cigL' ? 'ÇIĞ Sv ' + l.n : l.k === 'arena' ? 'KARTOPU ARENA' : 'MACERA ' + l.n;
      r.lastChip.textContent = nm ? '↻ Tekrar oyna: ' + nm : '';
      r.lastChip.style.display = nm ? '' : 'none';
    } catch { /* ignore */ }
  }

  // ============================================================================================ first-time user experience
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  function ftueRuns() { try { return save.runsTotal ? save.runsTotal() : 99; } catch { return 99; } }
  function applyFtue(r) {
    const gate = lsGet('patpat.ftueGate') === 'on';
    if (!gate) return;
    const runs = ftueRuns();
    if (runs >= 4) lsSet('patpat.ftueGate', 'off');
    const on = runs < 4;
    const need0 = { today: 2, globe: 3, post: 3, pass: 3 };
    const sh = (node, ok, key) => {
      if (!node) return;
      node.style.display = '';
      const lock = on && !ok;
      node.classList.toggle('fm-lock', lock);
      if (lock) { const need = Math.max(1, (need0[key] || 3) - runs); node.setAttribute('data-lock', '🔒 ' + need + ' koşu'); try { if (getComputedStyle(node).position === 'static') node.style.position = 'relative'; } catch { /* ignore */ } } else node.removeAttribute('data-lock');
      node.classList.remove('fm-new');
      if (ok && on && lsGet('patpat.new.' + key) !== '1') {
        node.classList.add('fm-new');
        if (!node._newWired) { node._newWired = true; node.addEventListener('click', () => { lsSet('patpat.new.' + key, '1'); node.classList.remove('fm-new'); }, true); }
      }
    };
    if (!r.ftHint) {
      r.ftHint = el('div', 'fm-fthint');
      r.ftHint.style.cssText = 'flex:none;position:relative;margin:0 0 4px;text-align:center;font-size:12px;font-weight:800;color:#fff;opacity:.8;text-shadow:0 1px 3px rgba(0,0,0,.55);pointer-events:none;z-index:3';
      { const botEl = r.root.querySelector('.fm-bot'); if (botEl && botEl.parentNode) botEl.parentNode.insertBefore(r.ftHint, botEl); else r.root.appendChild(r.ftHint); }
    }
    const left = Math.max(0, 2 - runs);
    r.ftHint.textContent = left > 0 ? `Daha fazlası ${left} koşu sonra açılıyor ✨` : (runs < 3 ? 'Daha fazlası 1 koşu sonra açılıyor ✨' : '');
    let tight = false; try { tight = window.innerHeight < 700; } catch { /* ignore */ }
    r.ftHint.style.display = 'none'; void tight;
    sh(r.twrap, runs >= 2, 'today');
    sh(r.globe, runs >= 3, 'globe');
    sh(r.post, runs >= 3, 'post');
    sh(r.sPass, runs >= 3, 'pass');
    if (runs >= 1 && lsGet('patpat.ftue') !== '1' && !r._ftueBusy && !wheelPending()) ftueFirstRun(r); // the ŞANS ÇARKI goes first
  }
  function ftueFirstRun(r) {
    r._ftueBusy = true;
    const ov = el('div', 'fm-ftue');
    const card = el('div', 'fm-ftcard');
    ov.appendChild(card);
    const finish = () => { lsSet('patpat.ftue', '1'); ov.remove(); r._ftueBusy = false; };
    const coach = () => {
      const steps = [
        ['🏂', 'OYNA', 'Büyük düğme: Yeti Rush koşusu. Kaydır, zıpla, kar topla!'],
        ['⚔️', 'KARTOPU ARENA', 'Botlara karşı dev haritada büyü, arkadaşlarınla oda kur.'],
        ['⛰️', 'ÇIĞ / MACERA', 'Çığ dağları ve macera haritası: yıldız topla, yeni şeyler aç.'],
      ];
      let i = 0;
      const draw = () => {
        clear(card);
        const [ic, t, d] = steps[i];
        add(card, el('div', 'ftc-step', `${i + 1}/${steps.length}`), el('div', 'ftc-ic', ic), el('div', 'ftc-t', t), el('div', 'ftc-d', d));
        const row = el('div', 'ftc-row');
        row.appendChild(button('ftc-skip', 'GEÇ', () => { sfx('click'); finish(); }));
        row.appendChild(button('ftc-go', i < steps.length - 1 ? 'İLERİ ▶' : 'BAŞLA!', () => { sfx('click'); if (++i >= steps.length) finish(); else draw(); }));
        card.appendChild(row);
      };
      draw();
    };
    if (lsGet('patpat.ftueCeleb') === '1') coach();
    else {
      lsSet('patpat.ftueCeleb', '1');
      let bonus = 60;
      try { save.addCoins(bonus); } catch { bonus = 0; }
      let tease = null;
      try { tease = SKINS.filter((x) => x.price > 0 && !(x.unlock && (x.unlock.stars || x.unlock.secret)) && !save.isOwned('skin', x.id)).sort((a, b) => a.price - b.price)[0]; } catch { /* ignore */ }
      let have = 0; try { have = save.coins; } catch { /* ignore */ }
      add(card, el('div', 'ftc-ic', '🎉'), el('div', 'ftc-t', 'İLK KOŞUN!'), el('div', 'ftc-d', `İlk kar taneleri cebinde. Hoş geldin bonusu: +${bonus} ❄️`));
      if (tease) {
        const bar = el('span', 'gb'); const f = el('i'); f.style.width = `${Math.min(100, Math.round(have / tease.price * 100))}%`; bar.appendChild(f);
        add(card, add(el('div', 'ftc-skin'), el('b', '', `👕 ${tease.name}`), bar, el('small', '', have >= tease.price ? 'Dolapta seni bekliyor!' : `${fmt(have)}/${fmt(tease.price)} ❄️ · bir sonraki koşuda!`)));
      }
      card.appendChild(add(el('div', 'ftc-row'), button('ftc-go', 'SÜPER!', () => { sfx('confirm'); coach(); })));
      try { confetti(70); sfx('confirm'); } catch { /* ignore */ }
    }
    r.root.appendChild(ov);
  }

  // ============================================================================================ ŞANS ÇARKI (lucky wheel)
  // First menu visit: a full-screen wheel whose FIRST spin is rigged to land on İNDİRİM %50 -> a one-time shop coupon
  // (save.grantCoupon; save.shopPrice / save.shopCharge apply and consume it). Afterwards a free daily spin with normal
  // rewards lives in the side rail (it can never land on the discount). It shows before the FTUE card / İLK ADIMLAR toast,
  // never over a run started from the URL (?play / ?cig / ?endless) or in ?debug / ?auto automation unless ?wheel forces it.
  const WQ = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } })();
  const WHEEL_FORCE = WQ.has('wheel');
  const WHEEL_BLOCK = !WHEEL_FORCE && ['debug', 'auto', 'play', 'cig', 'endless'].some((k) => WQ.has(k));
  const WSEG = [
    { t: 'İNDİRİM', t2: '%50', c: 'url(#fmwD)', disc: true, w: 0 },
    { t: '❄ 100', coins: 100, c: '#3fc1ff', w: 25 },
    { t: '💎 2', cr: 2, c: '#b07bff', w: 6 },
    { t: '❄ 250', coins: 250, c: '#35c46a', w: 12 },
    { t: '🎁', t2: 'SANDIK', box: 1, c: '#ffae00', w: 8 },
    { t: '❄ 50', coins: 50, c: '#2f7dff', w: 30 },
    { t: '💎 1', cr: 1, c: '#ff6fb5', w: 15 },
    { t: '❄ 500', coins: 500, c: '#ffe14a', dk: true, w: 4 },
  ];
  let wheelEl = null, wheelT = 0, wheelForced = WHEEL_FORCE;
  function wheelPending() {
    if (WHEEL_BLOCK) return false;
    if (wheelForced) return true;
    try { return !!save.wheelSeen && !save.wheelSeen(); } catch { return false; }
  }
  function scheduleWheel(delay = 650) {
    clearTimeout(wheelT);
    if (wheelEl || !wheelPending()) return;
    wheelT = setTimeout(() => {
      if (!mainOpen || wheelEl || !wheelPending()) return;
      // wait until nothing else is on screen (FTUE splash, a panel, the shop, a result) -- then the wheel is the only popup
      if (activePanel || modalEl || boxEl || resultEl || worldEl || document.querySelector('.ftue-splash, .fm-ftue, .cs-root')) { scheduleWheel(1500); return; }
      openWheel(true);
    }, delay);
  }
  function openWheel(first) {
    if (wheelEl) return;
    if (!first) { try { if (save.wheelDay() === dayKey()) { toast({ icon: '🎡', title: 'ŞANS ÇARKI', sub: 'Yarın yeniden çevir!', ms: 1800 }); return; } } catch { return; } }
    sfx('open');
    const NS = 'http://www.w3.org/2000/svg';
    const ov = el('div', 'fm-wheel');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Şans Çarkı');
    const box = el('div', 'wbox');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-112 -112 224 224');
    svg.setAttribute('class', 'wh');
    const mk = (p, t, a) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); p.appendChild(n); return n; };
    const defs = mk(svg, 'defs', {});
    const lg = mk(defs, 'linearGradient', { id: 'fmwD', x1: 0, y1: 0, x2: 0, y2: 1 });
    mk(lg, 'stop', { offset: '0', 'stop-color': '#ff3d6e' });
    mk(lg, 'stop', { offset: '1', 'stop-color': '#ff8a1f' });
    mk(svg, 'circle', { r: 108, fill: '#17345c' });
    const rot = mk(svg, 'g', { class: 'wrot' });
    const R = 100, P = (deg, r) => { const a = (deg * Math.PI) / 180; return `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`; };
    WSEG.forEach((s, i) => {
      const a0 = i * 45 - 22.5, a1 = i * 45 + 22.5;
      mk(rot, 'path', { d: `M0 0 L${P(a0, R)} A${R} ${R} 0 0 1 ${P(a1, R)} Z`, fill: s.c, stroke: s.disc ? '#ffe14a' : '#17345c', 'stroke-width': s.disc ? 4 : 2.5 });
      const g = mk(rot, 'g', { transform: `rotate(${i * 45})` });
      const t1 = mk(g, 'text', { x: 0, y: s.t2 ? -72 : -64, 'font-size': s.disc ? 14 : s.t === '🎁' ? 24 : 16 });
      t1.textContent = s.t;
      if (s.dk) t1.setAttribute('class', 'dk');
      if (s.t2) { const t2 = mk(g, 'text', { x: 0, y: s.disc ? -52 : -50, 'font-size': s.disc ? 22 : 12 }); t2.textContent = s.t2; }
    });
    for (let i = 0; i < 8; i++) mk(svg, 'circle', { cx: P(i * 45 + 22.5, 104).split(' ')[0], cy: P(i * 45 + 22.5, 104).split(' ')[1], r: 3.2, fill: '#fff3b0' });
    mk(svg, 'circle', { r: 19, fill: '#fff', stroke: '#17345c', 'stroke-width': 4 });
    const hubT = mk(svg, 'text', { x: 0, y: 1, 'font-size': 18, class: 'dk' }); hubT.textContent = '★';
    const ptr = document.createElementNS(NS, 'svg');
    ptr.setAttribute('viewBox', '0 0 38 46');
    ptr.setAttribute('class', 'wptr');
    mk(ptr, 'path', { d: 'M4 6 Q19 -2 34 6 L19 44 Z', fill: '#ff3d3d', stroke: '#17345c', 'stroke-width': 3.5, 'stroke-linejoin': 'round' });
    mk(ptr, 'circle', { cx: 19, cy: 10, r: 4, fill: '#fff' });
    add(box, svg, ptr);
    const go = button('wgo', 'ÇEVİR!', () => spin(), 'Çarkı çevir');
    add(ov, el('div', 'wt', 'ŞANS ÇARKI'), el('div', 'ws', first ? 'Hoş geldin hediyesi: bir kez çevir!' : 'Günlük bedava çevirme'), box, go);
    if (!first) ov.appendChild(button('wx', '✕', () => { if (!spun) close(); }, 'Kapat'));
    (host || document.body).appendChild(ov);
    wheelEl = ov;

    let spun = false, cur = 0;
    function close() {
      ov.remove();
      if (wheelEl === ov) wheelEl = null;
      if (mainOpen) { try { updateMain(); } catch { /* ignore */ } } // queued FTUE card / İLK ADIMLAR toast follow now
    }
    function pick() {
      const pool = WSEG.map((s, i) => ({ s, i })).filter((o) => o.s.w > 0);
      let r = Math.random() * pool.reduce((n, o) => n + o.s.w, 0);
      for (const o of pool) { r -= o.s.w; if (r <= 0) return o.i; }
      return pool[0].i;
    }
    function spin() {
      if (spun) return;
      spun = true;
      go.disabled = true;
      const idx = first ? 0 : pick();
      const seg = WSEG[idx];
      // pay out up front (closing the app mid-spin must not lose / repeat the prize); the reveal follows the animation
      try {
        if (first) { wheelForced = false; save.grantCoupon(50); save.markWheelSeen(); save.setWheelDay(dayKey()); } // daily spins start tomorrow
        else {
          save.setWheelDay(dayKey());
          if (seg.coins) save.addCoins(seg.coins);
          if (seg.cr) meta.addCrystals(seg.cr);
          if (seg.box) meta.addBoxes(seg.box);
        }
      } catch { /* ignore */ }
      // the chosen segment's centre (+ a small random offset inside it) ends under the top pointer: wheel angle -R ≡ target
      const target = idx * 45 + (Math.random() * 2 - 1) * 12;
      const fin = cur + 360 * 6 + ((((-target - cur) % 360) + 360) % 360);
      const OV = 6, D = 4200, S = 450; // overshoot (deg) stays inside the segment; main ease-out, then settle back
      const t0 = performance.now();
      let lastSeg = Math.floor((cur + 22.5) / 45), lastTick = 0;
      const ease = (k) => 1 - Math.pow(1 - k, 4); // quartic ease-out: fast start, long glide
      const step = (now) => {
        if (!ov.isConnected) return;
        const t = now - t0;
        let a;
        if (t < D) a = cur + (fin + OV - cur) * ease(t / D);
        else if (t < D + S) { const k = (t - D) / S; a = fin + OV - OV * (0.5 - 0.5 * Math.cos(Math.PI * k)); }
        else a = fin;
        rot.setAttribute('transform', `rotate(${a.toFixed(2)})`);
        const sg = Math.floor((a + 22.5) / 45);
        if (sg !== lastSeg) {
          lastSeg = sg;
          if (now - lastTick > 45) { lastTick = now; sfx('click'); ptr.classList.remove('tk'); void ptr.getBoundingClientRect(); ptr.classList.add('tk'); setTimeout(() => ptr.classList.remove('tk'), 110); }
        }
        if (t < D + S) { if (hasRAF) requestAnimationFrame(step); else setTimeout(() => step(performance.now()), 16); return; }
        cur = fin % 360;
        reveal(seg);
      };
      if (hasRAF) requestAnimationFrame(step); else setTimeout(() => step(performance.now()), 16);
    }
    function reveal(seg) {
      ov.classList.add('done');
      go.remove();
      const x = ov.querySelector('.wx'); if (x) x.remove();
      const card = el('div', 'wres');
      if (seg.disc) {
        const d = el('div', 'rd');
        add(d, document.createTextNode('Marketteki ilk alımında '), el('b', '', '%50 İNDİRİM!'));
        add(card, el('div', 'ri', '🎟'), el('div', 'rt', 'TEBRİKLER!'), d, el('div', 'rd', '🎟 Kuponun Dolap\'ta seni bekliyor.'));
      } else {
        const what = seg.coins ? `+${fmt(seg.coins)} ❄️` : seg.cr ? `+${seg.cr} 💎` : '🎁 Kostüm sandığı (+1 kutu)';
        add(card, el('div', 'ri', seg.coins ? '❄️' : seg.cr ? '💎' : '🎁'), el('div', 'rt', 'TEBRİKLER!'), el('div', 'rd', what), el('div', 'rd', 'Yarın yine çevir!'));
      }
      card.appendChild(button('wok', 'TAMAM', () => { sfx('click'); close(); }));
      ov.appendChild(card);
      sfx('confirm');
      confetti(90);
      burst(card, seg.disc ? '🎉' : seg.coins ? '❄️' : seg.cr ? '💎' : '🎁', 16, 120);
    }
  }

  // ============================================================================================ easter eggs (UI side)

  let logoTaps = 0;
  let logoTapT = 0;
  let swiped = false;
  let heroHeld = false;
  const kbuf = [];
  let typed = '';

  function eggToast(icon, title, sub) {
    toast({ icon, title, sub, kind: 'egg', ms: 2600 });
  }

  function logoSpin() {
    if (!refs) return;
    refs.logo.classList.remove('spin', 'squish');
    void refs.logo.offsetWidth;
    refs.logo.classList.add('spin');
    setTimeout(() => refs && refs.logo.classList.remove('spin'), 1250);
    confetti(70);
    sfx('confirm');
  }

  function tapLogo() {
    if (!refs) return;
    const t = Date.now();
    if (t - logoTapT > 1500) logoTaps = 0;
    logoTapT = t;
    logoTaps++;
    if (logoTaps >= 7) {
      logoTaps = 0;
      logoSpin();
      meta.egg('logo'); // first time: secret achievement + rainbow trail (toast comes from the unlock callback)
      return;
    }
    refs.logo.classList.remove('squish', 'spin');
    void refs.logo.offsetWidth;
    refs.logo.classList.add('squish');
    sfx('click');
  }

  function konamiPush(tok) {
    kbuf.push(tok);
    if (kbuf.length > KONAMI.length) kbuf.shift();
    if (kbuf.length < KONAMI.length) return;
    for (let i = 0; i < KONAMI.length; i++) {
      const want = KONAMI[i];
      const got = kbuf[i];
      if (got === want) continue;
      if (got === 'tap' && (want === 'a' || want === 'b')) continue; // swipe version: two taps = B A
      return;
    }
    kbuf.length = 0;
    meta.egg('konami');
    eggToast('🎮', 'HİLE YOK!', 'Konami kodunu buldun... ama hile yok :)');
    confetti(50);
    sfx('confirm');
  }

  // Long-press the hero ball (the 3D snowball behind the overlay) for 3 s: it "sneezes" into snow.
  function sneeze() {
    if (!refs) return;
    refs.achoo.classList.remove('on');
    void refs.achoo.offsetWidth;
    refs.achoo.classList.add('on');
    setTimeout(() => { if (refs) { burst(refs.hero, '❄️', 18, 130); sfx('confirm'); } }, 650);
    setTimeout(() => { if (refs) refs.achoo.classList.remove('on'); }, 1700);
    try { if (cb.onSneeze) cb.onSneeze(); } catch { /* ignore */ }
    meta.egg('sneeze');
  }

  // ---- the hero snowball: every tap = squash & hop + powder puff + a soft 'pof'. 10 quick taps = golden ball (this session). ----
  let tapN = 0;
  let tapT = 0;
  let goldOn = false;
  try { goldOn = !!(typeof window !== 'undefined' && window.__patpatGold); } catch { goldOn = false; }

  function puff(x, y) {
    if (!refs || refs.hero.querySelectorAll('.fm-puff').length > 16) return;
    const ring = el('i', 'fm-ring');
    ring.style.left = `${Math.round(x)}px`;
    ring.style.top = `${Math.round(y)}px`;
    refs.hero.appendChild(ring);
    setTimeout(() => ring.remove(), 560);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const p = el('i', 'fm-puff');
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      const d = 34 + Math.random() * 30;
      setCss(p, '--dx', `${Math.round(Math.cos(a) * d)}px`);
      setCss(p, '--dy', `${Math.round(Math.sin(a) * d * 0.8 - 8)}px`);
      setCss(p, '--s', `${Math.round(9 + Math.random() * 9)}px`);
      p.style.left = `${Math.round(x)}px`;
      p.style.top = `${Math.round(y)}px`;
      refs.hero.appendChild(p);
      setTimeout(() => p.remove(), 620);
    }
  }

  function canvasHop() {
    const c = typeof document !== 'undefined' ? document.getElementById('c') : null;
    if (!c) return;
    c.classList.remove('fm-hop');
    void c.offsetWidth;
    c.classList.add('fm-hop');
    setTimeout(() => c.classList.remove('fm-hop'), 380);
  }

  function goldBall() {
    goldOn = true;
    let real = setGoldBall(true); // the real 3D classic ball turns gold; otherwise the DOM aura fakes it
    // the host tints whatever skin is on screen itself: then the DOM glow is not needed at all
    try { if (cb.onBallGold) { cb.onBallGold(); real = true; } } catch { /* ignore */ }
    if (refs) { refs.root.classList.add('fm-gold'); if (real) refs.root.classList.add('fm-real'); }
    meta.egg('goldball');
    confetti(46);
    sfx('confirm');
    toast({ icon: '🥇', title: 'ALTIN TOP!', sub: 'Kartopun bu oturumluk altına döndü', kind: 'gold', ms: 2200 });
  }

  function ballTap(e) {
    if (!refs) return;
    const t = performance.now();
    tapN = t - tapT < 1000 ? tapN + 1 : 1;
    tapT = t;
    sfx('pof');
    let handled = false;
    try { if (cb.onBallTap) { cb.onBallTap(tapN); handled = true; } } catch { /* ignore */ }
    if (!handled) canvasHop();
    const hr = refs.hero.getBoundingClientRect();
    const x = e && Number.isFinite(e.clientX) ? e.clientX - hr.left : hr.width / 2;
    const y = e && Number.isFinite(e.clientY) ? e.clientY - hr.top : hr.height / 2;
    puff(x, y);
    refs.logoBall.classList.remove('hop');
    void refs.logoBall.offsetWidth;
    refs.logoBall.classList.add('hop');
    if (tapN >= 10) { tapN = 0; if (!goldOn) goldBall(); else { confetti(18); sfx('confirm'); } }
  }

  function wireEggs(r) {
    if (goldOn) r.root.classList.add('fm-gold');
    r.logo.addEventListener('click', (e) => { e.stopPropagation(); if (swiped) { swiped = false; return; } tapLogo(); });

    // hero zone: swipes + taps feed the Konami buffer, a 3 s hold sneezes
    let sx = 0, sy = 0, down = false, lp = 0;
    const stopLp = () => { if (lp) { clearTimeout(lp); lp = 0; } };
    const up = (e) => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelSwipe);
      stopLp();
      if (!down) return;
      down = false;
      if (heroHeld) { heroHeld = false; return; }
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.max(ax, ay) < 36) { konamiPush('tap'); return; }
      swiped = true;
      konamiPush(ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    };
    const cancelSwipe = () => {
      down = false;
      stopLp();
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelSwipe);
    };
    r.hero.addEventListener('pointerdown', (e) => {
      ballTap(e);
      down = true; swiped = false; heroHeld = false; sx = e.clientX; sy = e.clientY;
      stopLp();
      lp = setTimeout(() => { lp = 0; heroHeld = true; sneeze(); }, 3000);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancelSwipe);
    });
    r.hero.addEventListener('pointermove', (e) => {
      if (down && lp && Math.hypot(e.clientX - sx, e.clientY - sy) > 30) stopLp();
    });
    r.hero.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const onKey = (e) => {
    if (!e || e.repeat) return;
    if (e.key === 'Escape') { back(); return; }
    if (activePanel && activePanel.id === 'map' && activePanel.goAct && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      activePanel.goAct(activePanel.act + (e.key === 'ArrowRight' ? 1 : -1));
      return;
    }
    if (!mainOpen || activePanel || modalEl || boxEl || worldEl || resultEl) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = String(e.key || '');
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[k]) konamiPush(map[k]);
    else if (k.length === 1) {
      const lc = k.toLowerCase();
      if (lc === 'b' || lc === 'a') konamiPush(lc);
      typed = (typed + lc).slice(-WORD.length);
      if (typed === WORD.toLowerCase()) {
        typed = '';
        confetti(110);
        sfx('confirm');
        eggToast('⌨️', 'SİHİRLİ KELİME!', 'PATPAT! Konfeti yağsın.');
        meta.egg('typed');
      }
    }
  };
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', onKey);

  // ============================================================================================ main timers

  function startMainTimers() {
    stopMainTimers();
    mainTimer = setInterval(() => {
      tick++;
      if (refs && tick % 4 === 0 && !activePanel) updateMain();
    }, 5000);
    if (mainTimer && typeof mainTimer.unref === 'function') mainTimer.unref();
  }
  function stopMainTimers() {
    if (mainTimer) { clearInterval(mainTimer); mainTimer = 0; }
  }

  // ============================================================================================ events from meta

  // Nothing is toasted during a run: meta.js queues mission / achievement / letter notices and the result screen shows them.
  // Only while the lobby is on screen (secrets found in the menu, items bought in the shop) a small toast is fine.
  offs.push(meta.onUnlock((a, extra) => { if (mainOpen && !activePanel) toastAchievement(a, extra); else if (mainOpen) updateMain(); }));
  offs.push(meta.on('stamp', (d) => { if (mainOpen) { toast({ icon: d.icon, title: `Yeni damga: ${d.name}!`, sub: 'Pasaportu görmek için dokun', kind: 'gold', ms: 3200, onTap: () => openPassport() }); updateMain(); } }));
  offs.push(meta.on('levelup', () => { if (mainOpen) updateMain(); }));
  offs.push(meta.on('mission', () => { if (mainOpen) updateMain(); }));
  offs.push(meta.on('missionset', (s) => {
    if (cb.onReward) { try { cb.onReward('missions', s.reward); } catch { /* ignore */ } }
    if (mainOpen) updateMain();
  }));
  offs.push(meta.on('letter', () => { if (mainOpen) updateMain(); }));
  offs.push(meta.on('hunt', (res) => {
    if (cb.onReward) { try { cb.onReward('hunt', res.reward); } catch { /* ignore */ } }
  }));

  // ============================================================================================ public API

  function showMain(i) {
    info = { ...info, ...(i || {}) };
    try { if (meta.refresh) meta.refresh(); } catch { /* ignore */ }
    if (!refs) buildMain();
    hideBoot();
    closePanel(true);
    closeModal();
    closeWorlds();
    closeResult();
    refs.root.classList.remove('fm-hide', 'fm-starting');
    mainOpen = true;
    // anything the last run queued (and the result screen did not drain) is dropped silently, except a finished mission set
    let notes = [];
    try { notes = meta.takeNotices(); } catch { notes = []; }
    const set = notes.find((n) => n.kind === 'missionset');
    updateMain();
    if (set) toast({ icon: '✖️', title: `ÇARPAN x${set.multiplier}!`, sub: 'Görev seti tamam', kind: 'gold', ms: 2200 });
    refs.root.classList.remove('enter');
    void refs.root.offsetWidth;
    refs.root.classList.add('enter');
    setTimeout(() => { if (refs) refs.root.classList.remove('enter'); }, 1000);
    startMainTimers();
    scheduleWheel();
  }

  function hideMain() {
    mainOpen = false;
    clearTimeout(wheelT);
    stopMainTimers();
    closePanel(true);
    closeResult();
    closeModal();
    closeWorlds();
    if (refs) refs.root.classList.add('fm-hide');
  }

  // The daily reward never opens by itself any more: it is a badge on the 🎁 button. Kept so old callers do not break.
  function showDailyIfAvailable() { return false; }

  function refresh() {
    if (refs && mainOpen) updateMain();
    if (activePanel && activePanel.refreshPills) activePanel.refreshPills(false);
  }

  function isOpen() {
    return !!(mainOpen || activePanel || modalEl || boxEl || worldEl || resultEl);
  }

  function destroy() {
    hideMain();
    closeBoxes();
    closeResult();
    for (const o of offs) { try { o(); } catch { /* ignore */ } }
    offs.length = 0;
    if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('keydown', onKey);
    toastLayer.remove();
    fxLayer.remove();
    if (refs) { refs.root.remove(); refs = null; }
  }

  return {
    showMain, hideMain, toastAchievement, showDailyIfAvailable, refresh, isOpen, back, setHold() { /* toasts are menu-only now; kept for old callers */ },
    // campaign
    showLevelComplete, showLevelFailed, showLevelIntro, openMap, openCigLevels, showCigIntro,
    // extras
    toast, confetti,
    // Mystery boxes never pop up by themselves any more: a bare openBoxes(n) call (the old post-run auto-open) is ignored, boxes stay
    // banked and open from the lobby (💎 pill). Pass { user: true } as the 3rd argument for an explicit open.
    openBoxes: (n, onDone, opts) => { if (opts && opts.user) return openBoxes(n, onDone); if (onDone) { try { onDone(); } catch { /* ignore */ } } return null; },
    openDaily, openAchievements, openPassport, openPostcard, openMissions, openUpgrades, openHunt, openSettings, closePanel, destroy,
  };
}
