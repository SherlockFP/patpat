import * as THREE from 'three';
import './style.css';
import { CFG } from './config.js';
import { buildPropLibrary } from './props.js';
import { World, clamp } from './world.js';
import { Ball } from './ball.js';
import { Fx } from './fx.js';
import { Input } from './input.js';
import { UI, fmtTons } from './ui.js';
import { audio } from './audio.js';
import { platform, notify } from './platform.js';
import { save } from './save.js';
import { dailySeed, dailyNumber } from './rng.js';
import { PostFX, VISUAL_MODES, SU, patchMaterial } from './shaders.js';
import { makeSkin, disposeSkin, trailStyle } from './skins.js';
import { Scenery, themeForLevel } from './scenery.js';
import { loadModels } from './assets.js';
import { meta } from './meta.js';
import { createMenus } from './menus.js';
import { levelById, evalGoals, countStars } from './campaign.js';
import { openShop } from './shop.js';
import { CigPlus, CigGame } from './cigplus.js';
import { dagPlan, DAG_COUNT, evalStars, validatePlan, fmtD } from './cigplan.js';
// YETİ RUSH (the runner) is loaded on demand (keeps the first load small and ÇIĞ SONSUZ independent of it).
let Runner = null;
let music = { duck() {}, setMuted() {}, suspend() {}, resume() {} };
async function loadEndless() {
  if (Runner) return;
  const [r, mu] = await Promise.all([import('./runner/runner.js'), import('./runner/music.js')]);
  Runner = r.Runner;
  music = mu.music;
  music.setMuted(!musicOn);
}

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
let AUTO = params.has('auto');
const MAX_LEVEL = 99;

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const dprMax = Math.min(window.devicePixelRatio || 1, 2);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: dprMax < 2, powerPreference: 'high-performance' });
let dpr = dprMax;
renderer.setPixelRatio(dpr);

const HORIZON = 0xdcefff;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 90, 340);
scene.background = new THREE.Color(HORIZON);

const sky = makeSky();
sky.visible = false;
scene.add(sky);
const hemi = new THREE.HemisphereLight(0xffffff, 0xaec3e3, 1.55);
hemi.visible = false;
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
sun.position.set(0.25, 1, 0.6);
sun.visible = false;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1800);
const post = new PostFX(renderer);
let visualMode = 'normal';
try { visualMode = localStorage.getItem('cig.visual') || 'normal'; } catch { /* ignore */ }
post.setMode(visualMode);
const camLook = new THREE.Vector3();
let baseFov = 60;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Portrait phones need a wide horizontal view; derive vertical FOV from a target horizontal FOV.
  const hfov = 46 * Math.PI / 180;
  const vfov = 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI;
  baseFov = clamp(vfov, 52, 76);
  camera.fov = baseFov + (camera.userData.fovBoost || 0);
  camera.updateProjectionMatrix();
  post?.resize();
}
window.addEventListener('resize', resize);
resize();

canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); pause(true); });

// ---------- systems ----------
const lib = buildPropLibrary();
const propMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
const ball = new Ball(scene, lib, propMat);
const ui = new UI();
const input = new Input(canvas);
let world = null;
let fx = null;
let runner = null;
let scenery = null;
let plus = null;
let game = null;
let rainbowTrail = false;
let agar = null;      // AGAR mode (another module, loaded on demand)
// Particles in endless mode fall into the void instead of bouncing on the ÇIĞ terrain.
const groundless = { groundY: () => -1e9, rampAt: () => 0 };

const G = {
  mode: 'cig',          // 'cig' (ÇIĞ SONSUZ / lobby) | 'runner' (YETİ RUSH, MACERA)
  state: 'menu',        // menu | play | end | result | runner
  paused: false,
  level: save.level, daily: false, dailyNo: 0, dailySeed: 0,
  runNo: 0,
  // gameplay state lives here too (CigGame fills it in reset())
  targetX: 0, combo: 0, comboT: 0, swallowed: 0, townTons: 0, destroyed: 0, bonusTons: 0,
  bumpCd: 0, recoverT: 0, momentumT: 0, shake: 0, endT: 0, slowT: 0, timeScale: 1, hitStop: 0, hitStopCd: 0,
  onRamp: false, lastRamp: 0, tier: 0, avl: 0, peakR: CFG.startR, fovKick: 0,
  hinted: false, result: null,
  lv: null, peakD: 0,    // ÇIĞ DAĞLAR: the plan being played (null = endless / lobby)
};
const _v = new THREE.Vector3();

// ---------- wardrobe ----------
let skin = null;
function applySkin(id) {
  const next = makeSkin(id);
  // Lava ships its own shader patch; everything else gets the shared look (classic = sparkly snow).
  if (id !== 'lav') patchMaterial(next.material, { snow: id === 'classic' || id === 'pamuk' });
  ball.snow.geometry = next.geometry;
  ball.snow.material = next.material;
  if (window.__patpatGold) tintGold();
  if (skin) disposeSkin(skin);
  skin = next;
}
function tintGold() {
  try { ball.snow.material.color?.setHex(0xffd44a); } catch { /* ignore */ }
}
function applyTrail(id) {
  fx?.setTrailStyle(trailStyle(id));
}
let closeShop = null;
window.__cigSfx = audio;

// ---------- meta (missions, achievements, daily rewards) + PATPAT main menu ----------
meta.init(save);
let musicOn = true;
try { musicOn = localStorage.getItem('cig.music.muted') !== '1'; } catch { /* ignore */ }
function openWardrobe() {
  audio.init();
  menus.hideMain();
  closeShop = openShop({
    save,
    onSelect: (kind, id) => {
      if (kind === 'skin') { applySkin(id); meta.track('skin_select', { id }); }
      else { applyTrail(id); meta.track('trail_select', { id }); }
    },
    onClose: () => { closeShop = null; toMenu(); },
  });
}
function cycleVisual() {
  const i = VISUAL_MODES.findIndex((v) => v.id === visualMode);
  visualMode = VISUAL_MODES[(i + 1) % VISUAL_MODES.length].id;
  post.setMode(visualMode);
  try { localStorage.setItem('cig.visual', visualMode); } catch { /* ignore */ }
  setVisualLabel();
  meta.track('visual_mode', { id: visualMode });
  return VISUAL_MODES.find((v) => v.id === visualMode).name;
}
const menus = createMenus({
  save,
  meta,
  root: document.getElementById('app'),
  callbacks: {
    // OYNA = YETİ RUSH straight away; ÇIĞ SONSUZ and MACERA are small buttons.
    onEndless: () => startEndless(),
    onDailyRush: () => { window.patpatDailyRush?.(); startEndless(); },  // GÜNÜN RUSH'I (seeded by date)
    onCigEndless: () => startCigEndless(),    // (the menu only offers it once DAĞ 10 is cleared)
    onCigLevel: (n, o) => startCigLevel(n, o),
    onAgar: () => startAgar(),
    onPlayLevel: (id) => startLevel(id),
    onBallTap: () => lobbyBounce(),
    onBallGold: () => { window.__patpatGold = true; tintGold(); },
    onSneeze: () => { fx?.burst(ball.x, ball.y + ball.r, ball.d, 30, 0xffffff, 6, 0.15, 6); audio.pop(0.2, 4); },
    onLevels: () => playCigLevel(save.cigNext()),
    onDaily: () => startCigLevel({ daily: true }),
    onShop: () => openWardrobe(),
    onVisualCycle: () => cycleVisual(),
    onSound: (on) => { audio.init(); audio.setMuted(!on); ui.setToggle('sound', on); },
    onMusic: (on) => { musicOn = on; music.setMuted(!on); try { localStorage.setItem('cig.music.muted', on ? '0' : '1'); } catch { /* ignore */ } },
    onHaptics: (on) => { platform.setHapticsEnabled(on); ui.setToggle('haptic', on); if (on) platform.haptic('medium'); },
    getToggles: () => ({ sound: !audio.isMuted(), music: musicOn, haptics: platform.hapticsEnabled(), visualName: (VISUAL_MODES.find((v) => v.id === visualMode) || VISUAL_MODES[0]).name }),
    sfx: (kind) => { audio.init(); audio.ui(kind); },
    onReward: () => menus.refresh(),
  },
});
meta.track('session', {});

platform.init();
platform.onPause(() => {
  if (G.state === 'play' || (G.state === 'runner' && runner?.state === 'play')) pause(true);
  audio.suspend();
  music.suspend?.();
});
platform.onResume(() => { audio.resume(); music.resume?.(); });
platform.onBack(() => {
  if (closeShop) { closeShop(); return; }
  if (menus.back()) return; // lobby panels / cards close first
  if (G.mode === 'agar') { if (agar && agar.onBack) agar.onBack(); else toMenu(); return; }
  if (G.state === 'runner') {
    // playing: pause / resume; on the result screen (or before the run has started) Back leaves to the menu
    const rs = runner?.state;
    if (rs === 'play') pause(!G.paused);
    else if (rs === 'over' || rs === 'finished' || rs === 'idle' || !rs) toMenu();
  } else if (G.state === 'play') pause(!G.paused);
  else if (G.state === 'result' || G.state === 'end') toMenu();
  else if (G.state === 'menu' && platform.isNative) import('@capacitor/app').then(({ App }) => App.exitApp()).catch(() => {});
});

input.onRelease(() => audio.init());

// ---------- flow ----------
function randomSeed() {
  return (((Math.random() * 0x7fffffff) | 0) ^ (Date.now() & 0xffffff)) >>> 0 || 1;
}

// Dispose + rebuild everything that belongs to the ÇIĞ slope (world, scenery, extras, the rules).
function buildWorld(seed, themeIdx, daily, plan = null) {
  plus?.dispose();
  if (world) world.dispose();
  world = new World(scene, lib, { seed, level: plan });
  scenery?.dispose();
  scenery = new Scenery(scene, { world, lib, theme: themeForLevel(themeIdx, daily), onEgg: (id) => meta.egg(id) });
  plus = new CigPlus(scene, world, { seed, lib, ui, hud: typeof ui.buffAdd !== 'function', level: plan });
  if (!fx) { fx = new Fx(scene, world); applyTrail(save.selected('trail')); }
  fx.world = world;
  fx.reset();
  if (rainbowTrail) { rainbowTrail = false; applyTrail(save.selected('trail')); } // the run ended mid-rainbow: back to the chosen trail
  game = new CigGame({ world, ball, plus, G, host: cigHost, level: plan });
  game.auto = AUTO;
  game.bestTons = plan ? (save.cigLvBest(plan.n)?.tons || 0) : (save.cigEndlessBest?.().tons || 0);
}

// What the rules (cigplus.js) ask of the page: sounds, particles, HUD, camera kicks.
const cigHost = {
  sfx(name, a, b) {
    switch (name) {
      case 'pop': audio.pop(a, b); break;
      case 'bump': audio.bump(a); break;
      case 'crash': audio.crash(a); break;
      case 'whoosh': audio.whoosh(); break;
      case 'land': audio.land(a); break;
      case 'milestone': audio.milestone(a); break;
      case 'rumble': audio.crash(0.22); break;
      default: break;
    }
  },
  plusSfx(name) {
    switch (name) {
      case 'power': audio.milestone(1); break;
      case 'freeze': audio.ui('toggle'); audio.whoosh(); break;
      case 'shield': audio.bump(0.4); break;
      case 'whoosh': audio.whoosh(); break;
      case 'flip': audio.milestone(3); break;
      case 'boing': audio.pop(0.2, 14); break;
      case 'rumble': audio.crash(0.3); break;
      default: break;
    }
  },
  haptic(kind) { platform.haptic(kind); },
  burst(x, y, d, n, color, speed, size, up) { fx.burst(x, y, d, n, color, speed, size, up); },
  puff(x, y, z, vx, vy, vz, size, life, color, alpha) { fx.puff(x, y, z, vx, vy, vz, size, life, color, alpha); },
  text(str, at, cls) { popText(str, at, cls); },
  toast(str) { if (ui.toastSoft) ui.toastSoft(str); },
  shake(v) { G.shake += v; },
  hitStop(s) { if (G.hitStopCd <= 0) { G.hitStop = Math.max(G.hitStop, s); G.hitStopCd = 0.15; } },
  flash(kind) { ui.flash?.(kind); },
  kick(zoom, fov) { camZoom = Math.max(camZoom, zoom); G.fovKick = Math.max(G.fovKick, fov); },
  track(ev, data) { meta.track(ev, data); },
  tier(name, i) {
    G.tier = i;
    if (ui.cigTier) ui.cigTier(name);
    else ui.banner?.(name, i);
  },
  hud(info) {
    if (ui.cigHud) ui.cigHud(info);
    else { ui.setTons(info.tons); ui.setProgress(info.frac); }
    if (G.lv && info.lv) {
      // (ui.cigHud labels the run "ÇIĞ SONSUZ" and hides the progress bar: put the mountain's own label and bar back)
      ui.el.hud.classList.add('cig-lvl');
      ui.setProgress(info.lv.prog);
      showSizeReadout(info);
      updateLevelHud(info.lv);
    }
  },
  hunger(frac, warn) { ui.hunger?.(frac, warn); },
  // how many "⛔ X m" size tags to hang on too-big obstacles before you reach them (many on the first runs, fewer later)
  labelBudget() {
    if (G.lv) return G.lv.n <= 2 ? 6 : G.lv.n <= 6 ? 3 : 1;
    return Math.max(2, 7 - Math.min(5, save.cigEndlessRuns?.() || 0));
  },
  combo(n) { if (G.lv) { if (n > 0) ui.pulse(); return; } ui.setCombo(n); if (n > 0) ui.pulse(); },
  onPower(kind) { if (kind === 'rainbow') { rainbowTrail = true; fx.setTrailStyle({ rainbow: true, glow: true }); } },
  onPowerEnd(kind) { if (kind === 'rainbow') { rainbowTrail = false; applyTrail(save.selected('trail')); } },
  ended(cause) {
    audio.setRoll(0, 0);
    ui.hint(false);
    ui.speedLines?.(0);
    if (cause === 'melt') { audio.lose(); platform.haptic('warning'); }
    else if (cause === 'win') { audio.win(); platform.haptic('success'); }
    else { audio.crash(0.5); platform.haptic('heavy'); }
    meta.track('cig_progress', { tons: game.totalTons(), dist: ball.d });
  },
};

function setCigVisible(on) {
  if (world) world.group.visible = on;
  if (plus) plus.group.visible = on;
  if (scenery) scenery.group.visible = on;
  if (fx) { fx.trail.visible = on; fx.shadow.visible = on; }
  if (waveVis) waveVis.mesh.visible = on && waveVis.on;
}

// Campaign level (1..100): an endless-mode run locked to one biome with a finish line.
function startLevel(id) {
  const lv = levelById(id);
  if (!lv) return;
  startEndless(lv);
}

function levelDone(lv, stats) {
  const goalsMet = evalGoals(lv, { ...stats, finished: true });
  const stars = Math.max(1, countStars(goalsMet));
  meta.track('endless_end', { distance: stats.distance, score: stats.score, coins: stats.coins, crashes: stats.crashes, cause: 'finish', maxTier: stats.maxTier, campaign: true });
  save.addCoins(stats.coins);
  const rewards = meta.completeLevel(lv.id, stars, { ...stats, goalsMet });
  setTimeout(() => {
    ui.runnerHud(false, '');
    menus.showLevelComplete({ level: lv, stars, goalsMet, rewards, hasNext: !!(rewards && rewards.next) }, {
      onNext: () => { const n = levelById(rewards.next); if (n && !menus.showLevelIntro(n, () => startLevel(n.id))) startLevel(n.id); },
      onRetry: () => startEndless(lv, { retry: true }),
      onMap: () => { toMenu(); menus.openMap(lv.id); },
    });
  }, 1600);
}

function levelFailed(lv, cause, stats) {
  ui.runnerHud(false, '');
  menus.showLevelFailed({ level: lv, cause, killKind: stats?.killKind, stats, distance: stats?.distance }, {
    onRetry: () => startEndless(lv, { retry: true }),
    onMap: () => { toMenu(); menus.openMap(lv.id); },
  });
}

// ---------- YETİ RUSH (endless runner) / MACERA levels ----------
async function startEndless(level = null, opts = {}) {
  audio.init();
  audio.ui();
  try {
    await loadEndless();
  } catch (e) {
    console.error(e);
    ui.toast('Sonsuz mod yüklenemedi');
    return;
  }
  if (G.mode === 'cig' && G.state === 'play') meta.track('cig_progress', { tons: game?.totalTons() || 0, dist: ball.d });
  leaveAgar();
  hideEnemyBars();
  G.mode = 'runner';
  G.state = 'runner';
  G.paused = false;
  G.result = null;
  ui.showPause(false);
  ui.cigReset?.();
  G.lv = null;
  hideLevelHud();
  menus.hideMain();
  setCigVisible(false);
  if (!fx) { fx = new Fx(scene, groundless); applyTrail(save.selected('trail')); }
  fx.world = groundless;
  scene.fog.near = 60;
  scene.fog.far = 330;
  if (!runner) runner = new Runner({ scene, camera, lib, ball, fx, ui, audio, platform, save, input, meta, menus });
  runner.ctx.noTut = params.has('notut') || !!debugNoTut;
  input.consumeLane();
  input.consumeDive?.();
  input.consumeDoubleTap?.();
  runner.onFinish = level ? (stats) => levelDone(level, stats) : null;
  runner.onFail = level ? (cause, stats) => levelFailed(level, cause, stats) : null;
  runner.start(undefined, level, { retry: !!opts.retry });
}
let debugNoTut = false;

function leaveEndless() {
  if (G.mode !== 'runner') return;
  ui.runnerHud(false, '');
  try { runner?.closeOut?.(); } catch (e) { console.warn(e); }
  runner?.dispose();
  G.mode = 'cig';
  scene.fog.color.set(HORIZON);
  scene.background = new THREE.Color(HORIZON);
  camera.up.set(0, 1, 0);
  camera.userData.fovBoost = 0;
  ball.group.visible = true;
  ball.reset(CFG.startR);
  setCigVisible(true);
}

// ---------- AGAR mode (module in ./agar/agar.js; it owns its own scene + camera) ----------
// After a redeploy, lazily loaded chunks of a cached page may 404: reload once instead of failing silently.
window.addEventListener('vite:preloadError', (e) => {
  if (sessionStorage.getItem('patpat.reloaded')) return;
  e.preventDefault?.(); sessionStorage.setItem('patpat.reloaded', '1'); location.reload();
});
async function startAgar() {
  audio.init();
  audio.ui();
  let mod;
  try {
    mod = await import('./agar/agar.js');
  } catch (e) {
    console.error(e);
    ui.toast('Agar modu yüklenemedi');
    return;
  }
  if (agar) return;
  if (G.mode === 'cig' && G.state === 'play') meta.track('cig_progress', { tons: game?.totalTons() || 0, dist: ball.d });
  leaveEndless();
  ui.hint(false);
  ui.speedLines?.(0);
  ui.cigReset?.();
  G.lv = null;
  hideLevelHud();
  ui.showPause(false);
  hideEnemyBars();
  menus.hideMain();
  audio.setRoll(0, 0);
  setCigVisible(false);
  agar = new mod.AgarMode({
    renderer, post, ui, audio, save, platform, lib,
    onExit: () => { if (agar) { agar.dispose(); agar = null; } toMenu(); },
    track: (ev, d) => meta.track(ev, d),
  });
  G.mode = 'agar';
  G.state = 'agar';
  G.paused = false;
  agar.start();
}

// Leaving AGAR (any way): dispose it and restore the normal ÇIĞ scene / mode.
function leaveAgar() {
  if (G.mode !== 'agar') return;
  if (agar) { try { agar.dispose(); } catch (e) { console.warn(e); } agar = null; }
  G.mode = 'cig';
  G.paused = false;
  ui.showPause(false);
  ball.group.visible = true;
  setCigVisible(true);
  resize();
}

// ---------- menu / lobby ----------
function toMenu() {
  leaveAgar();
  leaveEndless();
  ui.hint(false); // the runner's swipe hint must not linger on the menu
  ui.speedLines?.(0);
  ui.cigReset?.();
  G.lv = null;
  hideLevelHud();
  G.state = 'menu';
  G.paused = false;
  G.level = Math.min(save.level, MAX_LEVEL);
  G.hitStop = 0; G.timeScale = 1; G.shake = 0; G.fovKick = 0;
  camZoom = 0;
  buildWorld(4242, save.cigNext(), false);
  clearWaveVis();
  ball.reset(CFG.startR);
  ball.y = world.groundY(0, 0) + ball.r * 0.92;
  ball.speed = 0;
  ball.sync();
  const ds = dailySeed();
  const best = save.dailyFor(ds);
  ui.showMenu({ level: G.level, stars: save.starsFor(G.level), dailyNum: dailyNumber(), dailyBest: best ? best.tons : 0, theme: scenery.theme.name });
  ui.el.menu.classList.add('hidden'); // the PATPAT menu (menus.js) replaces the old screen
  const cb = save.cigEndlessBest?.() || { tons: 0, dist: 0 };
  menus.showMain({
    level: G.level,
    levelStars: save.starsFor(G.level),
    theme: scenery.theme.name,
    endlessBest: save.runnerBest(),
    endlessBestDist: save.runnerBestDist(),
    cigBest: cb,
    dailyNum: dailyNumber(),
    dailyBest: best ? best.tons : 0,
    coins: save.coins,
    cig: { next: save.cigNext(), stars: save.cigLvStars(save.cigNext()), cleared: save.cigCleared(), total: save.cigLvTotalStars(), endlessOpen: save.cigEndlessOpen(), dailyOpen: save.cigDailyOpen() },
  });
  // (the daily reward is a badge in the menu now, never a pop-up)
  audio.setRoll(0, 0);
  ball.sync();
  updateCamera(0, true);
}

// Tap the snowball in the menu: squash & stretch hop + a puff of powder.
let lobbyPuffT = 0;
function lobbyBounce() {
  if (G.state !== 'menu') return;
  ball.bounce(6.5 + Math.random() * 1.5);
  fx?.burst(ball.x, ball.y - ball.r * 0.6, ball.d, 8, 0xffffff, 2.5, 0.12 + ball.r * 0.05, 3);
  lobbyPuffT = 0.12;
}

// ---------- ÇIĞ SONSUZ ----------
function startCigEndless(opts = {}) {
  G.lv = null;
  hideLevelHud();
  const daily = !!opts.daily;
  const fromMenu = G.state === 'menu' && G.mode === 'cig'; // lobby -> slope: the camera swoops out; retries cut cleanly
  leaveAgar();
  leaveEndless();
  ui.cigReset?.();
  menus.hideMain();
  audio.init();
  if (!opts.retry) audio.ui();
  meta.track('run_start', { mode: 'cigEndless', daily });
  G.mode = 'cig';
  G.daily = daily;
  G.dailyNo = dailyNumber();
  G.dailySeed = dailySeed();
  G.runNo++;
  const seed = opts.seed ?? (daily ? G.dailySeed * 7919 + 13 : randomSeed());
  buildWorld(seed, (save.cigEndlessRuns?.() || 0) + G.runNo, daily);
  clearWaveVis();
  game.reset();
  G.paused = false;
  G.state = 'play';
  G.fovKick = 0; camZoom = 0;
  input.consumeDx();
  lastPlusPlan = -1;
  ui.showPause(false);
  ui.startRun(daily ? `GÜNÜN DAĞI #${G.dailyNo}` : 'ÇIĞ SONSUZ');
  const showHint = !G.hinted && (save.cigTut?.() ?? 0) < 3;
  ui.hint(showHint, 'sürükle · küçükleri ye, büyüklerden kaç');
  if (showHint) save.bumpCigTut?.();
  scene.fog.near = 70; scene.fog.far = 300;
  ball.sync();
  updateCamera(0, !fromMenu);
  plus.planTo(world.genD - 30);
}
let lastPlusPlan = -1;

// ---------- ÇIĞ DAĞLAR: 30 finite mountains ----------
// HUD: progress bar (gate marks + flag) from the existing top bar, plus #cig-lv: next barrier chip, size/speed chip, chain chip.
let lvHud = null;
function ensureLevelHud(plan) {
  const hud = ui.el.hud;
  if (!lvHud) {
    const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    const root = mk('div'); root.id = 'cig-lv';
    const row = mk('div', 'cgl-row');
    const gc = mk('div', 'cgl gc'), gs = mk('small'), gt = mk('b');
    gc.appendChild(gs); gc.appendChild(gt);
    const sz = mk('div', 'cgl sz');
    const ch = mk('div', 'cgl ch');
    row.appendChild(gc); row.appendChild(sz);
    root.appendChild(row); root.appendChild(ch);
    hud.appendChild(root);
    lvHud = { root, gc, gs, gt, sz, ch, s: '', t: '', z: '', c: '', r: -1, marks: [], gi: -1 };
  }
  lvHud.root.style.display = '';
  lvHud.s = lvHud.t = lvHud.z = lvHud.c = ''; lvHud.r = -1; lvHud.gi = -1; lvHud.marks.length = 0;
  lvHud.ch.style.display = 'none';
  hud.classList.add('cig-lvl');
  // ONE compact top bar: [ETAP chip | progress bar (+ star pips) | size chip | pause]
  const topBar = hud.querySelector('.hud-top'), pauseBtn = hud.querySelector('#btn-pause'), prog = hud.querySelector('.hud-progress');
  if (topBar && pauseBtn && ui.el.tons && ui.el.tons.parentNode !== topBar) topBar.insertBefore(ui.el.tons, pauseBtn);
  if (prog) {
    let sp = prog.querySelector('.cig-stars');
    if (!sp) { sp = document.createElement('div'); sp.className = 'cig-stars'; sp.innerHTML = '<i>★</i><i>★</i><i>★</i>'; prog.appendChild(sp); }
    lvHud.stars = Array.from(sp.children); lvHud.sc = '';
    sp.title = plan.stars.map((g) => g.text).join(' · ');
  }
  const town = hud.querySelector('.hud-progress .town');
  if (town) town.textContent = '🏁';
  const bar = hud.querySelector('.hud-progress .bar');
  if (bar) {
    for (const e of Array.from(bar.querySelectorAll('.pt'))) e.remove();
    for (const g of plan.gates) {
      if (g.i === plan.S - 1) continue;
      const m = document.createElement('i');
      m.className = 'pt gate';
      m.textContent = '⛔';
      m.style.left = (g.d / plan.length * 100).toFixed(1) + '%';
      bar.appendChild(m);
      lvHud.marks.push(m);
    }
  }
}
// level mode: the ball DIAMETER is the headline number, the (exploding) tons shrink to a compact secondary line
function tonsCompact(t) {
  const f = (v, u) => (v < 10 ? v.toFixed(1) : String(Math.round(v))).replace('.', ',') + u;
  if (t < 1000) return f(t, ' t');
  if (t < 1e6) return f(t / 1e3, 'k t');
  return f(t / 1e6, 'M t');
}
let lastHave = 0;
function showSizeReadout(info) {
  const el = ui.el.tons;
  if (!el) return;
  lastHave = info.lv.have;
  const main = '⚪ ' + fmtD(info.lv.have) + ' m', sub = tonsCompact(info.tons || 0);
  const c = el.firstChild;
  if (c && c.nodeType === 3 && c.nodeValue === main && el.childElementCount === 1 && el.lastChild.textContent === sub) return;
  el.textContent = main;
  const sm = document.createElement('small');
  sm.style.cssText = 'display:block;font-size:.45em;opacity:.7;line-height:1.1;font-weight:600';
  sm.textContent = sub;
  el.appendChild(sm);
}
function updateLevelHud(V) {
  const h = lvHud;
  if (!h) return;
  const m5 = Math.round(V.left / 5) * 5;
  const s = V.finalBroken ? 'BİTİŞ' : V.final ? 'FİNAL' : 'ETAP ' + (V.gateI + 1) + '/' + V.S;
  const t0 = V.finalBroken ? '🏁' : V.locked ? '👹 ' + fmtD(V.need) + ' m' : V.need > 0 ? '⛔ ' + fmtD(V.need) + ' m' : m5 + ' m';
  const t = s + ' · ' + t0;
  const r = V.finalBroken ? 2 : V.ready;
  if (h.s !== '-') { h.s = '-'; h.gs.textContent = ''; h.gs.style.display = 'none'; }
  if (t !== h.t) { h.t = t; h.gt.textContent = t; }
  const lv = ui.el.level;
  if (lv.textContent !== t) lv.textContent = t;   // the level label IS the ETAP chip now
  if (r !== h.r) { h.r = r; h.gc.className = 'cgl gc r' + r; lv.classList.remove('lr0', 'lr1', 'lr2'); lv.classList.add('lr' + r); }
  if (h.stars) updateStars(V);
  if (V.gateI !== h.gi) { h.gi = V.gateI; for (let i = 0; i < h.marks.length; i++) h.marks[i].classList.toggle('passed', i < V.gateI); }
  h.sz.style.display = 'none';   // the size/speed pill lives in the ETAP strip now
  const c = V.ters > 0 ? '🏔 ÇIĞ: ' + Math.round(V.ters) + ' m ↑' : V.chainMul >= 2 ? 'ZİNCİR x' + V.chainMul : '';
  if (c !== h.c) { h.c = c; h.ch.textContent = c; h.ch.style.display = c ? '' : 'none'; }
  // the avalanche is close: red edge pulse
  const cl = ui.el.hud.classList;
  if (V.gap < CFG.lvl.chaseNear) cl.add('chase-near'); else if (V.gap > CFG.lvl.chaseNear + 10) cl.remove('chase-near');
}
// star pips: 0 = not yet, 1 = earned, 2 = impossible now (grey)
function updateStars(V) {
  const P = G.lv, st = game && game.stats;
  if (!P || !st || !P.stars) return;
  const fin = !!V.finalBroken, g3 = P.stars[2];
  const a = [fin ? 1 : 0, lastHave >= 2 * P.r2 - 1e-6 ? 1 : 0, 0];
  const neg = (bad) => (bad ? 2 : fin ? 1 : 0);
  switch (g3.kind) {
    case 'nobounce': a[2] = neg((st.bounces | 0) > 0); break;
    case 'nohit': a[2] = neg((st.hits | 0) > 0); break;
    case 'time': a[2] = neg(G.t > g3.t); break;
    case 'chain': a[2] = (st.maxMul | 0) >= g3.mul ? 1 : 0; break;
    case 'crates': a[2] = (st.crates | 0) >= g3.count ? 1 : 0; break;
    case 'gold': a[2] = (st.gold | 0) >= g3.count ? 1 : 0; break;
    case 'rival': a[2] = (st.rivalEaten | 0) > 0 ? 1 : 0; break;
    case 'statues': a[2] = (st.statues | 0) >= g3.count ? 1 : 0; break;
    case 'throne': a[2] = (st.throne | 0) >= 1 ? 1 : 0; break;
    case 'secret': a[2] = (st.secret | 0) >= 1 ? 1 : 0; break;
    default: a[2] = fin ? 1 : 0;
  }
  const k = a.join('');
  if (k === lvHud.sc) return;
  lvHud.sc = k;
  for (let i = 0; i < 3; i++) lvHud.stars[i].className = a[i] === 1 ? 'on' : a[i] === 2 ? 'dead' : '';
}
function hideLevelHud() {
  if (lvHud) lvHud.root.style.display = 'none';
  try { if (ui.el.tons) { ui.el.tons.textContent = ''; ui.lastTonsText = ''; if (ui._cg) ui._cg.kg = -1; } } catch { /* optional */ }
  const hud = ui.el?.hud;
  if (hud) {
    hud.classList.remove('cig-lvl', 'chase-near');
    const tb = hud.querySelector('.hud-top');
    if (tb && ui.el.tons && ui.el.tons.parentNode === tb) tb.parentNode.insertBefore(ui.el.tons, tb.nextSibling);
    hud.querySelector('.cig-stars')?.remove();
    if (lvHud) lvHud.stars = null;
    ui.el.level?.classList.remove('lr0', 'lr1', 'lr2');
    const town = hud.querySelector('.hud-progress .town');
    if (town && town.textContent === '🏁') town.textContent = '🏘️';
    const bar = hud.querySelector('.hud-progress .bar');
    if (bar) for (const e of Array.from(bar.querySelectorAll('.pt.gate'))) e.remove();
  }
}

// the menu cards read a "level"-shaped object (name, boss, length, goals)
function planAsLevel(plan) {
  return { id: plan.n, name: plan.name, boss: plan.boss, act: 1, length: plan.length, goals: plan.stars.map((s) => ({ text: s.text })) };
}

// intro card (first time a mechanic appears), then the mountain
function playCigLevel(n, opts = {}) {
  const plan = dagPlan(n);
  if (!opts.retry && plan.intro && !save.cigIntroSeen(n) && menus.showCigIntro) {
    if (menus.showCigIntro(plan, () => { save.markCigIntro(n); startCigLevel(n, opts); })) return;
  }
  startCigLevel(n, opts);
}

// arg: 1..30 or { daily: true }. opts: { retry, force (debug: ignore the locks) }
// ÇIĞ EŞLİĞİ: consecutive mountain wins (no fail between) = +5% start size per level, max +25%
const streakGet = () => { try { return Math.max(0, Math.min(5, parseInt(localStorage.getItem('cigStreak') || '0', 10) || 0)); } catch { return 0; } };
const streakSet = (v) => { try { localStorage.setItem('cigStreak', String(Math.max(0, v | 0))); } catch { /* optional */ } };

function startCigLevel(arg, opts = {}) {
  const daily = !!(arg && typeof arg === 'object' && arg.daily);
  const force = !!opts.force || DEBUG;
  if (daily && !force && !save.cigDailyOpen()) { ui.toast?.("Günün Dağı için DAĞ 3'ü bitir"); return; }
  let n = daily ? Math.max(3, save.cigCleared()) : Math.max(1, Math.min(DAG_COUNT, Math.round(Number(arg)) || 1));
  if (!daily && !force && n > save.cigUnlocked()) n = save.cigUnlocked();
  const fromMenu = G.state === 'menu' && G.mode === 'cig'; // lobby -> slope: the camera swoops out; retries cut cleanly
  leaveAgar();
  leaveEndless();
  ui.cigReset?.();
  menus.hideMain();
  audio.init();
  if (!opts.retry) audio.ui();
  G.dailySeed = dailySeed();
  G.dailyNo = dailyNumber();
  const assist = !daily && save.cigLvFails(n) >= 3 ? 1 : 0;   // three losses in a row on the same mountain: a quiet helping hand
  const basePlan = dagPlan(n, daily ? { daily: true, seed: G.dailySeed * 7919 + 13, dailyNo: G.dailyNo } : { assist });
  meta.track('run_start', { mode: 'cigLevel', level: n, daily });
  const streak = daily ? 0 : streakGet();
  // dagPlan caches a frozen plan: apply the streak start bonus to a shallow copy
  const plan = streak > 0 ? { ...basePlan, r0: basePlan.r0 * (1 + 0.05 * streak) } : basePlan;
  G.mode = 'cig';
  G.daily = daily;
  G.lv = plan;
  G.runNo++;
  buildWorld(plan.seed, plan.n, daily, plan);
  clearWaveVis();
  game.reset();
  G.paused = false;
  G.state = 'play';
  G.fovKick = 0; camZoom = 0; G.peakD = 0;
  input.consumeDx();
  lastPlusPlan = -1;
  ui.showPause(false);
  ui.startRun(plan.label);
  if (streak > 0) { try { game._msg(2, '🔥 SERİ x' + streak + ' · +' + 5 * streak + '% BAŞLANGIÇ'); } catch { /* optional */ } }
  ensureLevelHud(plan);
  const showHint = plan.n <= 2 && (plan.n === 1 || (!G.hinted && (save.cigTut?.() ?? 0) < 3));
  ui.hint(showHint, 'sürükle · küçükleri ye, kapıyı kır');
  if (showHint && plan.n !== 1) save.bumpCigTut?.();
  if (showHint) setTimeout(() => { if (G.state === 'play') ui.hint(false); }, 6000);
  scene.fog.near = 70; scene.fog.far = 300;
  ball.sync();
  updateCamera(0, !fromMenu);
  plus.planTo(Math.min(world.genD, world.planEnd || Infinity) - 30);
}

const clock = (t) => { const s = Math.max(0, Math.round(t)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

function finishCigLevel() {
  if (G.state !== 'end') return;
  const plan = G.lv;
  const win = G.cause === 'win';
  const r = game.result();
  const st = game.stats;
  const n = plan.n, daily = G.daily;
  const peakD = Math.max(G.peakD || 0, ball.d);
  const sim = !!window.__cigCalib;   // (debug balance runs must not touch the save file or open menus)
  G.result = r;
  ui.hint(false);
  hideLevelHud();
  if (!sim) { ui.buffClear?.(); ui.hungerHide?.(); ui.cigReset?.(); ui.speedLines?.(0); ui.el.hud.classList.add('hidden'); }   // (the menu card replaces the HUD)
  G.state = 'result';
  if (win) {
    const goalsMet = evalStars(plan, { finished: true, finalR: G.finalR, bounces: st.bounces, hits: st.hits, crates: st.crates, gold: st.gold, maxMul: st.maxMul, time: st.time, rivalEaten: st.rivalEaten, statues: st.statues, secret: st.secret });
    const stars = Math.max(1, goalsMet.filter(Boolean).length);
    G.lastEval = { win, stars, goalsMet };
    if (sim) return;
    const rec = daily ? null : save.recordCigLevel(n, { stars, tons: r.tons, size: 2 * G.finalR, time: st.time });
    if (!daily) { save.cigLvFailReset(n); streakSet(streakGet() + 1); }
    const firstClear = !!(rec && rec.firstClear);
    const prev = rec ? rec.prevStars : 0;
    let coins = daily ? 20 + 4 * n : firstClear ? 25 + 4 * n + (plan.boss ? 100 : 0) : 5 + 2 * stars;
    const bonus = [15, 22, 30];
    for (let k = prev + 1; k <= stars; k++) coins += bonus[k - 1];
    let crystals = 0;
    if (plan.boss && !daily) { if (firstClear) crystals += 2; if (stars === 3 && prev < 3) crystals += 1; }
    save.addCoins(coins);
    let lootChip = null;
    if (G.lootGot && !daily) {   // BOSS GANİMETİ: boss-themed unlock the first time, else ❄️ + 💎
      const LOOT = { yeti: ['trail', 'simsek'], robot: ['skin', 'robot'], golem: ['trail', 'fire'] }[G.lootGot];
      if (LOOT && !save.isOwned(LOOT[0], LOOT[1])) { save.own(LOOT[0], LOOT[1]); lootChip = '✨ Ganimet: yeni ' + (LOOT[0] === 'skin' ? 'top' : 'iz') + '!'; }
      else { crystals += 1; coins += 40; lootChip = '✨ Ganimet: +40 ❄️ +1 💎'; }
    }
    save.addCoins(0);
    if (crystals) save.addCrystals(crystals);
    save.recordRun(r.tons); notifSync(true);
    if (daily) save.recordDaily(G.dailySeed, { tons: r.tons, pct: 1, stars });
    meta.track('cig_end', { level: n, stars, tons: r.tons, pct: 0.9, reached: true, daily, theme: scenery.theme.id, endless: false });
    meta.track('cig_progress', { tons: r.tons, dist: peakD });
    const hasNext = !daily && n < DAG_COUNT;
    menus.showLevelComplete({
      level: planAsLevel(plan), stars, goalsMet, rewards: { coins, crystals }, hasNext,
      labels: { banner: 'DAĞ TAMAM!', bossBanner: 'PATRON YENİLDİ!', next: 'SONRAKİ DAĞ ▶', map: 'DAĞLAR', retry: '↻ TEKRAR' },
      chips: ['⚪ ' + fmtD(2 * G.finalR) + ' m', '⚖️ ' + fmtTons(r.tons), '⏱ ' + clock(st.time)].concat(lootChip ? [lootChip] : []),
      special: !daily && firstClear && n === 10 ? '∞ ÇIĞ SONSUZ AÇILDI!' : !daily && firstClear && n === DAG_COUNT ? '🏆 TÜM DAĞLAR TAMAM!' : null,
    }, {
      onNext: () => playCigLevel(n + 1),
      onRetry: () => startCigLevel(daily ? { daily: true } : n, { retry: true }),
      onMap: () => { toMenu(); menus.openCigLevels?.(n); },
    });
  } else {
    G.lastEval = { win, stars: 0, goalsMet: [false, false, false] };
    if (sim) return;
    if (!daily) { save.cigLvFail(n); streakSet(0); }
    save.recordRun(r.tons); notifSync(true);
    meta.track('cig_end', { level: n, stars: 0, tons: r.tons, pct: Math.min(0.99, peakD / plan.length), reached: false, daily, theme: scenery.theme.id, endless: false });
    meta.track('cig_progress', { tons: r.tons, dist: peakD });
    const wave = G.cause === 'wave', bossF = G.cause === 'boss' && G.bossFail;
    const lb = G.lastBounce && G.lastBounce.i >= (G.gateIdx || 0) ? G.lastBounce : null;   // (only while that barrier is still the one that stopped you)
    const tip = bossF ? 'PATRON ' + fmtD(G.bossFail.need * 2) + ' m idi, sen ' + fmtD(G.bossFail.have * 2) + ' m. Yolda daha çok ye, daha büyük gel!' : lb ? 'KAPI ' + (lb.i + 1) + ': ' + fmtD(lb.need * 2) + ' m gerekiyordu, sen ' + fmtD(lb.have * 2) + ' m idin.'
      : wave ? 'Durma: çığ arkandan geliyor.' : 'Küçükleri ye, durursan kar erir.';
    menus.showLevelFailed({
      level: planAsLevel(plan), cause: G.cause, title: bossF ? 'PATRONA ÇARPTIN — daha büyük gel!' : wave ? 'ÇIĞ SENİ YAKALADI!' : 'ERİDİN!', icon: bossF ? '💥' : wave ? '🌨️' : '💧', tip,
      distance: peakD, stats: { distance: peakD }, labels: { retry: '↻ TEKRAR DENE', map: 'DAĞLAR' },
    }, {
      onRetry: () => startCigLevel(daily ? { daily: true } : n, { retry: true }),
      onMap: () => { toMenu(); menus.openCigLevels?.(n); },
    });
  }
}

// Rewards go quietly into the counters; one clean result screen.
function finishCig() {
  if (G.state !== 'end') return;
  if (G.lv) { finishCigLevel(); return; }
  G.state = 'result';
  const r = game.result();
  G.result = r;
  ui.hint(false);
  const coins = Math.round(Math.sqrt(Math.max(0, r.tons)) * 1.5 + r.dist / 40);
  save.addCoins(coins);
  save.recordRun(r.tons); notifSync(true);
  if (G.daily) save.recordDaily(G.dailySeed, { tons: r.tons, pct: 0, stars: 0 });
  const rec = { tons: r.tons, dist: r.dist, tier: r.tier, tierName: r.tierName };
  let isBest = false;
  if (save.recordCigEndless) isBest = !!save.recordCigEndless(rec);
  else meta.track('cig_endless_end', { ...rec, endless: true });
  const best = save.cigEndlessBest?.() || { tons: r.tons, dist: r.dist };
  meta.track('cig_progress', { tons: r.tons, dist: r.dist });
  const wave = r.cause === 'wave';
  ui.showResult({
    endless: true,
    title: wave ? 'ÇIĞ SENİ YAKALADI!' : 'ERİDİN!',
    tip: wave ? 'Hızını koru ve yemeye devam et: durursan çığ yakalar.' : 'Beyaz olanları ye, turuncu ve kırmızılardan kaç. Yemezsen erirsin.',
    tons: r.tons, dist: r.dist, distance: r.dist, best, isBest, newBest: isBest, cause: wave ? 'wave' : r.cause,
    tierName: r.tierName, coins, hasNext: false,
  }, audio);
  G.state = 'result';
  if (isBest) { audio.win(); platform.haptic('success'); }
}

// ---------- pause / buttons ----------
function pause(on) {
  if (G.state !== 'play' && !(G.state === 'runner' && runner?.state === 'play')) return;
  G.paused = on;
  ui.showPause(on);
  if (on) {
    syncPauseToggles();
    const st = document.getElementById('pause-stats');
    if (st) {
      st.textContent = G.mode === 'runner' && runner
        ? `${Math.round(runner.b.s).toLocaleString('tr-TR')} m · ${Math.round(runner.score).toLocaleString('tr-TR')} puan`
        : G.lv ? `${Math.round(ball.d).toLocaleString('tr-TR')} / ${G.lv.length.toLocaleString('tr-TR')} m · ${fmtD(2 * ball.r)} m`
          : `${Math.round(ball.d).toLocaleString('tr-TR')} m · ${fmtTons(game ? game.totalTons() : 0)}`;
    }
  }
  if (on) audio.setRoll(0, 0);
  if (G.mode === 'runner') music.duck(on);
  if (input.clear) input.clear(); else input.consumeDx(); // swipes made on the pause screen must not fire (lane / jump / drag) on resume
}

// Buttons may be missing/renamed by the HTML: never throw from the boot path.
function bind(id, fn) {
  if (document.getElementById(id)) ui.on(id, fn);
}
function restartSame() {
  audio.ui();
  G.paused = false;
  ui.showPause(false);
  if (G.mode === 'runner') { music.duck(false); startEndless(runner?.level || null, { retry: true }); }
  else if (G.lv) startCigLevel(G.daily ? { daily: true } : G.lv.n, { retry: true });
  else startCigEndless({ daily: G.daily, retry: true });
}

bind('btn-play', () => startEndless());            // OYNA / BAŞLA = YETİ RUSH
bind('btn-daily', () => startCigLevel({ daily: true }));
bind('btn-pause', () => { audio.ui(); pause(true); });
bind('btn-resume', () => { audio.ui(); pause(false); });
bind('btn-restart', restartSame);
function syncPauseToggles() {
  for (const [id, on] of [['btn-p-sound', !audio.isMuted()], ['btn-p-music', musicOn], ['btn-p-haptic', platform.hapticsEnabled()]]) {
    document.getElementById(id)?.classList.toggle('off', !on);
  }
}
bind('btn-p-sound', () => { audio.setMuted(!audio.isMuted()); ui.setToggle('sound', !audio.isMuted()); syncPauseToggles(); audio.ui('toggle'); });
bind('btn-p-music', () => { musicOn = !musicOn; music.setMuted(!musicOn); try { localStorage.setItem('cig.music.muted', musicOn ? '0' : '1'); } catch { /* ignore */ } syncPauseToggles(); });
bind('btn-p-haptic', () => { platform.setHapticsEnabled(!platform.hapticsEnabled()); syncPauseToggles(); platform.haptic('medium'); });
bind('btn-quit', () => { audio.ui(); toMenu(); });
bind('btn-menu', () => { audio.ui(); toMenu(); });
bind('btn-endless', () => startEndless());
bind('btn-shop', () => openWardrobe());
bind('btn-retry', () => {
  audio.ui();
  if (G.mode === 'runner') startEndless(runner?.level || null, { retry: true });
  else if (G.lv) startCigLevel(G.daily ? { daily: true } : G.lv.n, { retry: true });
  else startCigEndless({ daily: G.daily, retry: true });
});
bind('btn-next', () => {
  audio.ui();
  if (G.mode === 'runner') {
    // A second (and third...) revive is allowed: the runner charges the escalating crystal price (1, 2, 4, 8) itself
    // and stays in 'over' when it can't be paid; only then does this button read as "ANA MENÜ".
    if (runner && runner.state === 'over') {
      runner.revive?.();
      if (runner.state !== 'over') { ui.hideResult(); return; }   // revived: the run goes on, no menu bounce
    }
    toMenu();
    return;
  }
  toMenu();
});
bind('btn-revive', () => { if (runner?.state === 'over') runner.revive?.(); });
bind('btn-revive-end', () => { if (runner?.declineRevive) runner.declineRevive(); else toMenu(); });
bind('btn-share', async () => {
  audio.ui();
  let text;
  if (G.mode === 'runner' && runner?.daily && ui.lastShareText) {
    text = ui.lastShareText;
  } else if (G.mode === 'runner' && runner) {
    text = `❄️ PATPAT · Yeti Kaçışı
📏 ${Math.round(runner.b.s).toLocaleString('tr-TR')} m
🏆 Skor ${Math.round(runner.score).toLocaleString('tr-TR')}
❄️ ${runner.coins}
Beni geçebilir misin?`;
  } else {
    if (!G.result) return;
    text = shareText(G.result);
  }
  const res = await platform.share({ text });
  meta.track('share', {});
  if (res === 'copied') ui.toast('Panoya kopyalandı!');
});
bind('btn-sound', () => {
  audio.init();
  audio.setMuted(!audio.isMuted());
  music.setMuted(audio.isMuted());
  ui.setToggle('sound', !audio.isMuted());
  audio.ui();
});
bind('btn-haptic', () => {
  platform.setHapticsEnabled(!platform.hapticsEnabled());
  ui.setToggle('haptic', platform.hapticsEnabled());
  platform.haptic('medium');
});
function setVisualLabel() {
  const mode = VISUAL_MODES.find((v) => v.id === visualMode) || VISUAL_MODES[0];
  const el = document.getElementById('btn-visual');
  if (el) el.textContent = `🎨 ${mode.name}`;
}
bind('btn-visual', () => {
  audio.ui();
  cycleVisual();
});
setVisualLabel();
try { ui.setToggle('sound', !audio.isMuted()); ui.setToggle('haptic', platform.hapticsEnabled()); } catch { /* optional buttons */ }

function shareText(r) {
  return `❄️ PATPAT · ÇIĞ SONSUZ\n🌋 ${r.tierName}\n⚖️ ${fmtTons(r.tons)}\n📏 ${Math.round(r.dist).toLocaleString('tr-TR')} m\nBeni geçebilir misin?`;
}

// ---------- ÇIĞ SONSUZ: per-frame ----------
function popText(text, at, cls) {
  _v.set(at.x, (at.y ?? 0) + (at.h ?? at.r ?? 1) * 0.8, -at.d).project(camera);
  if (_v.z > 1) return;
  ui.float(text, (_v.x * 0.5 + 0.5) * window.innerWidth, (-_v.y * 0.5 + 0.5) * window.innerHeight, cls);
}

function cigAhead() {
  return clamp(scene.fog.far + 20, CFG.viewAhead, CFG.viewAheadMax);
}

// One ÇIĞ frame. `dt` is real time; the rules get the time-scaled (slow-mo / hit-stop) step.
function cigFrame(dt) {
  if (!G.paused) {
    let gdt = dt * G.timeScale;
    if (G.timeScale < 1) G.timeScale = Math.min(1, G.timeScale + dt * 0.5);
    G.hitStopCd -= dt;
    if (G.hitStop > 0) { G.hitStop -= dt; gdt *= 0.05; }
    if (G.fovKick > 0) G.fovKick = Math.max(0, G.fovKick - dt * 12);
    camZoom = Math.max(0, camZoom - dt * 0.12);
    if (G.state === 'play') cigPlay(gdt);
    else if (G.state === 'end') {
      game.updateEnd(gdt);
      if (G.endT > (G.cause === 'win' ? 2.0 : 1.25)) finishCig();
    } else if (G.state === 'result') game.updateEnd(gdt * 0.5);
    plus.update(gdt, ball, G);
    plus.planTo(Math.min(world.genD, world.planEnd || Infinity) - 30);
    ball.tick(dt);
    if (G.state === 'menu') lobbyUpdate(dt);
    ball.sync();
    world.update(gdt, ball.d, cigAhead(), Math.max(CFG.viewBehind, camBack + 15), ball);
    fx.update(gdt, ball);
    updateWaveVis(gdt);
    updateCamera(dt);
    scenery.update(gdt, camera, ball);
  }
  updateEnemyBars();
}

function cigPlay(gdt) {
  const b = ball;
  const dx = input.consumeDx();
  if ((dx !== 0 || input.keyAxis() !== 0) && !G.hinted) { G.hinted = true; ui.hint(false); }
  const hw = world.halfWidth(b.d);
  // gain follows what the camera shows (a full-screen swipe = ~1.6 visible widths), not the ball size
  const swipeM = Math.max(CFG.swipeVis * camVisW, CFG.swipeTrack * 2 * hw);
  const sens = swipeM / Math.max(320, window.innerWidth);
  const flipK = Math.cos(plus.rollNow || 0) < 0 ? -1 : 1; // the TAKLA barrel roll must not mirror the steering
  const steerM = (dx * sens + input.keyAxis() * (14 + 3 * b.r + hw * 0.3) * gdt) * flipK;
  game.update(gdt, steerM);
  if (b.d > G.peakD) G.peakD = b.d;
  G.progT2 = (G.progT2 || 0) + gdt;
  if (G.progT2 > 10) { G.progT2 = 0; meta.track('cig_progress', { tons: game.totalTons(), dist: b.d }); }
  audio.setRoll(b.airborne ? 0 : clamp(b.speed / 40, 0, 1), clamp(b.r / 10, 0, 1));
  // speed cues: wider FOV and speed lines as the ball gets heavy and fast
  const slk = G.lv ? clamp((b.speed / (CFG.baseSpeed * G.lv.speedK) - 1.1) / 0.9, 0, 1) * 0.7 : clamp((b.speed - 20) / 25, 0, 1) * 0.6;   // (levels: relative to the mountain's own speed)
  ui.speedLines?.(slk + (plus.T.rocket > 0 || game.powerT > 0 || G.stripT > 0 ? 0.4 : game.feverT > 0 ? 0.3 : 0));
}

// ---------- the avalanche wave (white wall rolling in from behind when you stall) ----------
let waveVis = null;
function ensureWaveVis() {
  if (waveVis) return waveVis;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xf4f8ff, flatShading: true, emissive: 0x7e92b3, emissiveIntensity: 0.55 });
  const N = 26;
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  waveVis = { mesh, N, on: false, t: 0, m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), puffT: 0 };
  return waveVis;
}
function clearWaveVis() {
  if (waveVis) { waveVis.on = false; waveVis.mesh.visible = false; }
}
function updateWaveVis(dt) {
  const W = game?.wave;
  if (!W || !W.on || !world) { if (waveVis && waveVis.on) clearWaveVis(); return; }
  const v = ensureWaveVis();
  v.on = true;
  v.mesh.visible = true;
  v.t += dt;
  const hw = world.halfWidth(W.d);
  const ters = !!(game.L && game.L.chase && game.L.chase.ters);
  if (ters && (game.G.tersDone || W.d < ball.d + 4)) { clearWaveVis(); return; }
  const sc = (4.5 + ball.r * 0.55) * (ters ? 1.9 : 1);
  for (let i = 0; i < v.N; i++) {
    const u = i / (v.N - 1);
    const x = (u - 0.5) * (2 * hw + 16) + Math.sin(v.t * 1.7 + i * 1.9) * 1.4;
    let d = W.d - (i % 3) * sc * 0.45 + Math.sin(v.t * 2.3 + i * 1.3) * sc * 0.25;
    const s = sc * (0.85 + 0.35 * Math.sin(i * 2.1 + v.t * 1.3 + 1));
    if (ters) d = Math.max(d, ball.d + ball.r + s * 0.9 + 4);   // Ters: the wall is always AHEAD of the ball
    v.p.set(x, world.groundY(x, d) + s * 0.55, -d);
    v.s.set(s, s * 0.85, s);
    v.q.setFromAxisAngle(_upY, v.t * 0.6 + i);
    v.m.compose(v.p, v.q, v.s);
    v.mesh.setMatrixAt(i, v.m);
  }
  v.mesh.instanceMatrix.needsUpdate = true;
  // rolling powder in front of the wall
  v.puffT -= dt;
  if (v.puffT <= 0 && fx) {
    v.puffT = 0.05;
    const x = (Math.random() - 0.5) * (2 * hw);
    fx.puff(x, world.groundY(x, W.d) + sc * 0.5, -(W.d + sc * 0.6), 0, 2, -3, sc * 0.9, 0.9, 0xf4f8ff, 0.5);
  }
}
const _upY = new THREE.Vector3(0, 1, 0);

// Lobby: tiny hop physics for the bounce lives in ball.js; here only the powder when it lands.
function lobbyUpdate(dt) {
  if (lobbyPuffT > 0) lobbyPuffT -= dt;
}
ball.onHopLand = (v) => {
  if (G.state !== 'menu' || !fx) return;
  fx.burst(ball.x, ball.y - ball.r * 0.85, ball.d, 10, 0xffffff, 3 + v * 0.3, 0.12 + ball.r * 0.05, 2.5);
};

// ---------- camera ----------
const camPos = new THREE.Vector3();
let camBack = 10;
let camVisW = 8;   // metres of ground the screen shows across the ball's depth (steering gain follows it)
let camR = 0;
let camZoom = 0;   // extra zoom-out after a tier-up (decays)
function updateCamera(dt, snap = false) {
  const b = ball;
  const r = b.r;
  // pull back as the ball grows so it keeps ~20-25% of the screen height instead of half
  // (smoothed radius, and the pull-back keeps growing past r = 9 so big balls stay ~20-25% of the screen height)
  camR = snap || camR === 0 ? r : camR + (r - camR) * (1 - Math.exp(-dt * 2.5));
  const z = (1 + camZoom) * (1 + 0.4 * clamp((camR - 1) / 8, 0, 1) + 0.045 * clamp(camR - 9, 0, 14));
  // steep enough that <= ~20-25% of the portrait screen is sky and the path stays visible over a big ball
  const near = G.lv && G.lv.n <= 5 ? 0.88 : 1;   // Dağ 1-5: the ball gets more screen presence
  let back = (6.8 + r * 2.5) * z * near;
  let up = (8.5 + r * 4.2) * z * near;
  let ox = b.x * 0.7;
  if (plus && plus.bossFx && !plus.bossFx.dead) { back *= 1.1; up *= 1.28; }   // boss fight: higher camera keeps the ball and the traps readable
  const menu = G.state === 'menu';
  if (menu) {
    // Lobby: the ball is the hero — close, centred, slowly orbited, spinning on the snow.
    const t = performance.now() * 0.00025;
    back = 2.6 + r * 2.2; up = 0.55 + r * 0.9; ox = b.x + Math.sin(t) * 1.4;
    ball.spin.rotateY(dt * 0.7);
  }
  const ending = G.state === 'end' || G.state === 'result';
  if (ending) {
    const et = Math.min(G.endT, 6);
    const a = et * 0.25;
    back = (7 + r * 2.5) * Math.cos(a);
    ox = b.x + (7 + r * 2.5) * Math.sin(a);
    up = 7 + r * 3.2 + et * 0.6;
  }
  camBack = Math.abs(back);
  world.camBack = camBack; world.camXlo = Math.min(camera.position.x, b.x); world.camXhi = Math.max(camera.position.x, b.x);
  camPos.set(ox, b.y + up, -(b.d - back));
  camPos.y = Math.max(camPos.y, world.groundY(camPos.x, -camPos.z) + 3 + r);
  const k = snap ? 1 : 1 - Math.exp(-dt * 6);
  camera.position.lerp(camPos, k);
  // look down the slope: the look-at point follows the slope's drop, so the pitch stays steep over the ball
  const ahead = 8 + r * 2.6;
  _v.set(b.x * 0.85, b.y - (world.baseY(b.d) - world.baseY(b.d + ahead)), -(b.d + ahead));
  if (menu) _v.set(b.x, b.y + r * 0.35, -(b.d - 0.2));
  if (ending) _v.set(b.x, b.y, -b.d);
  camLook.lerp(_v, snap ? 1 : 1 - Math.exp(-dt * 8));
  plus ? plus.lookAt(camera, camLook) : camera.lookAt(camLook);
  // real (angular) screen shake: it does not build up and looks the same at any camera distance
  if (G.shake > 0) {
    const a = 0.028 * Math.min(G.shake, 1.4);
    camera.rotateX((Math.random() - 0.5) * a);
    camera.rotateY((Math.random() - 0.5) * a);
    camera.rotateZ((Math.random() - 0.5) * a * 0.6);
    G.shake = Math.max(0, G.shake - dt * 3.5);
  }
  sky.position.copy(camera.position);
  const fs = (scenery?.theme?.fogScale ?? 1) * (G.lv && G.lv.twist === 'fog' ? 0.6 : 1);
  scene.fog.near = (70 + r * 6) * fs;
  scene.fog.far = Math.min(1500, 300 + r * 9) * fs;
  const wantNear = Math.max(0.5, r * 0.12);
  if (Math.abs(camera.near - wantNear) > 0.05 * wantNear) { camera.near = wantNear; camera.updateProjectionMatrix(); }
  // what the camera shows around the ball (for steering gain); uses the base FOV so power-up FOV kicks don't change it
  camVisW = 2 * camera.position.distanceTo(ball.group.position) * Math.tan(baseFov * Math.PI / 360) * camera.aspect;
}

// ---------- enemy HP bars (DOM, pooled) + boss bar ----------
const BAR_N = 8;
let barRoot = null, bossEl = null;
const barPool = [];
function ensureBars() {
  if (barRoot) return;
  barRoot = document.createElement('div');
  barRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:14;overflow:hidden;display:none;';
  for (let i = 0; i < BAR_N; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;height:7px;border-radius:4px;background:rgba(10,16,32,.7);border:1px solid rgba(255,255,255,.55);overflow:hidden;display:none;will-change:transform;';
    const fill = document.createElement('i');
    fill.style.cssText = 'display:block;height:100%;width:100%;background:linear-gradient(#ff7a6b,#e02f3d);transform-origin:left center;';
    el.appendChild(fill);
    barRoot.appendChild(el);
    barPool.push({ el, fill, on: false });
  }
  bossEl = document.createElement('div');
  bossEl.style.cssText = 'position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 52px);transform:translateX(-50%);width:min(66vw,400px);display:none;text-align:center;font:800 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7);letter-spacing:.06em;';
  const nm = document.createElement('div');
  nm.style.cssText = 'line-height:16px;height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  const track = document.createElement('div');
  track.style.cssText = 'position:relative;margin-top:4px;height:20px;border-radius:10px;background:rgba(10,16,32,.72);border:2px solid #fff;overflow:hidden;';
  const bf = document.createElement('i');
  bf.style.cssText = 'display:block;height:100%;width:100%;background:linear-gradient(#ff8a5b,#d4202f);transform-origin:left center;';
  const num = document.createElement('span');
  num.style.cssText = 'position:absolute;left:0;right:0;top:0;line-height:16px;font-size:12px;';
  track.appendChild(bf); track.appendChild(num);
  const gg = document.createElement('div');   // BUZ KIRACAK speed gauge (only while the boss holds an ice shield)
  gg.style.cssText = 'position:relative;display:none;margin-top:4px;height:16px;border-radius:8px;background:rgba(10,16,32,.72);border:2px solid #9fe0ff;overflow:hidden;';
  const gf = document.createElement('i');
  gf.style.cssText = 'display:block;height:100%;width:100%;background:linear-gradient(#bff0ff,#4aa8ff);transform-origin:left center;';
  const gm = document.createElement('b');
  gm.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:#fff;left:85%;';
  const gt = document.createElement('span');
  gt.style.cssText = 'position:absolute;left:0;right:0;top:0;line-height:12px;font-size:10px;letter-spacing:.12em;';
  gg.appendChild(gf); gg.appendChild(gm); gg.appendChild(gt);
  bossEl.appendChild(nm); bossEl.appendChild(track); bossEl.appendChild(gg);
  bossEl._gg = gg; bossEl._gf = gf; bossEl._gt = gt;
  if (!document.getElementById('cig-boss-css')) {
    const st = document.createElement('style'); st.id = 'cig-boss-css';
    // boss fight = ONE top block: hide the level strip / ETAP chip / size readout / goal, and park every message just below the block
    st.textContent = '#hud.bossfight #cig-lv,#hud.bossfight .hud-goal,#hud.bossfight #hud-chal{display:none!important}'
      + '#hud.bossfight.bossfight.bossfight.bossfight ~ #toast-soft:not(.res){top:calc(var(--sat,0px) + 108px)}'
      + '#hud.bossfight ~ #toast-soft .ts:nth-child(n+2){display:none}';
    document.head.appendChild(st);
  }
  bossEl._nm = nm; bossEl._bf = bf; bossEl._num = num;
  barRoot.appendChild(bossEl);
  document.body.appendChild(barRoot);
}
function hideEnemyBars() {
  if (!barRoot) return;
  barRoot.style.display = 'none';
  for (const b of barPool) { b.on = false; b.el.style.display = 'none'; }
  bossEl.style.display = 'none';
  ui.el.hud?.classList.remove('bossfight');
  for (const e of trapEls) e.style.display = 'none';
}
// dark rim around the white ball: strengthens with the storm / fog around it so it never melts into the white-blue
let rimMesh = null;
function updateBallRim() {
  if (G.mode !== 'cig') { if (rimMesh) rimMesh.visible = false; return; }
  if (!rimMesh) {
    rimMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x1d3c68, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    rimMesh.renderOrder = 2; rimMesh.frustumCulled = false;
    ball.group.add(rimMesh);
  }
  const o = Math.min(0.75, 0.12 + (fx.mistNear || 0) * 0.6 + (G.lv && G.lv.twist === 'fog' ? 0.25 : 0));
  rimMesh.material.opacity += (o - rimMesh.material.opacity) * 0.15;
  rimMesh.visible = ball.group.visible;
  rimMesh.scale.setScalar(ball.snow.scale.x * 1.07);
}
function updateEnemyBars() {
  updateBallRim();
  if (G.mode !== 'cig' || G.state !== 'play' || !world || !world.enemies.length) { if (barRoot && barRoot.style.display !== 'none') hideEnemyBars(); return; }
  ensureBars();
  barRoot.style.display = 'block';
  camera.updateMatrixWorld();
  const W = window.innerWidth, H = window.innerHeight;
  const en = world.enemies;
  let n = 0, boss = null;
  for (let i = 0; i < en.length; i++) {
    const p = en[i];
    if (!p.alive) continue;
    const dd = p.d - ball.d;
    if (dd < -6 || dd > (p.enemy.ai === 'arena' ? 220 : 130)) continue;
    if (p.enemy.rival) continue;
    if (p.enemy.boss) { if (!boss || dd < boss.d - ball.d) boss = p; continue; }
    if (n >= BAR_N) continue;
    _v.set(p.x, p.y + p.h * 1.08 + 0.2, -p.d).project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || _v.y < -1.1 || _v.y > 1.2) continue;
    const B = barPool[n];
    const w = clamp(34 + p.r * 5, 44, 90);
    B.el.style.width = w + 'px';
    B.el.style.transform = 'translate(' + ((_v.x * 0.5 + 0.5) * W - w / 2).toFixed(1) + 'px,' + ((-_v.y * 0.5 + 0.5) * H - 8).toFixed(1) + 'px)';
    B.fill.style.transform = 'scaleX(' + clamp(p.enemy.hp / p.enemy.max, 0, 1).toFixed(3) + ')';
    if (!B.on) { B.on = true; B.el.style.display = 'block'; }
    n++;
  }
  for (let i = n; i < BAR_N; i++) if (barPool[i].on) { barPool[i].on = false; barPool[i].el.style.display = 'none'; }
  if (boss) {
    bossEl.style.display = 'block';
    ui.el.hud.classList.add('bossfight');
    const pat = boss.enemy.ai === 'arena' && G.lv && G.lv.bossNeedR ? G.lv.bossNeedR * 2 : 0;   // PATRON: a size duel, not HP
    const nmT = pat ? 'PATRON: ' + fmtD(pat) + ' m — sen: ' + fmtD(ball.r * 2) + ' m' : boss.enemy.name + (G.lv && lastHave ? '  ·  ⚪ ' + fmtD(lastHave) + ' m' : '');
    if (bossEl._nmT !== nmT) { bossEl._nmT = nmT; bossEl._nm.textContent = nmT; }
    const gz = game && game.shieldGauge ? game.shieldGauge() : null;
    if (gz) {
      const ok = gz.f >= gz.need;
      bossEl._gg.style.display = 'block';
      bossEl._gf.style.transform = 'scaleX(' + clamp(gz.f, 0, 1).toFixed(3) + ')';
      bossEl._gf.style.background = ok ? 'linear-gradient(#fff,#7fe0ff)' : 'linear-gradient(#bff0ff,#4aa8ff)';
      bossEl._gg.style.borderColor = ok ? '#fff' : '#9fe0ff';
      bossEl._gg.style.opacity = ok ? '1' : (0.7 + 0.3 * Math.sin(performance.now() * 0.012)).toFixed(2);
      bossEl._gt.textContent = ok ? '🧊 ŞİMDİ ÇARP!' : 'HIZLAN!';
    } else if (bossEl._gg.style.display !== 'none') bossEl._gg.style.display = 'none';
    if (pat) {
      const ok = ball.r * 2 >= pat * 0.995;
      const t = ok ? '✓ YUTABİLİRSİN!' : 'BÜYÜ! ' + fmtD(Math.max(0, pat - ball.r * 2)) + ' m eksik';
      if (bossEl._num.textContent !== t) bossEl._num.textContent = t;
      bossEl._bf.style.transform = 'scaleX(' + clamp(ball.r * 2 / pat, 0, 1).toFixed(3) + ')';
      bossEl._bf.style.background = ok ? 'linear-gradient(#bfffd0,#2fd36b)' : '';
    } else {
      bossEl._num.textContent = Math.max(0, Math.ceil(boss.enemy.hp)) + ' / ' + Math.ceil(boss.enemy.max);
      bossEl._bf.style.transform = 'scaleX(' + clamp(boss.enemy.hp / boss.enemy.max, 0, 1).toFixed(3) + ')';
    }
    ui.el.hint.classList.add('hidden');   // boss HP bar up: no generic hint line
  } else { bossEl.style.display = 'none'; ui.el.hud.classList.remove('bossfight'); }
  // 👑 icon above the standing throne tower, so it is noticed from afar
  {
    let tw = null;
    const th = world.thrones;
    if (th) for (let i = 0; i < th.length; i++) { const t = th[i]; if (!t.hit && !t.done && t.crownPos && t.crownPos.d - ball.d > -4 && t.crownPos.d - ball.d < 260) { tw = t; break; } }
    let el = crownEl;
    if (!el && tw) { el = crownEl = document.createElement('div'); el.style.cssText = 'position:absolute;left:0;top:0;font-size:34px;line-height:1;pointer-events:none;filter:drop-shadow(0 0 8px #ffd860);'; el.textContent = '👑'; barRoot.appendChild(el); }
    if (el) {
      if (!tw) el.style.display = 'none';
      else {
        const c = tw.crownPos;
        _v.set(c.x, c.y + c.r * 1.6 + 1.5, -c.d).project(camera);
        if (_v.z > 1 || Math.abs(_v.x) > 1.1 || _v.y < -1.1 || _v.y > 1.2) el.style.display = 'none';
        else {
          el.style.display = 'block';
          el.style.transform = 'translate(' + ((_v.x * 0.5 + 0.5) * W - 17).toFixed(1) + 'px,' + ((-_v.y * 0.5 + 0.5) * H - 17 + 4 * Math.sin(performance.now() * 0.004)).toFixed(1) + 'px) scale(' + (1 + 0.12 * Math.sin(performance.now() * 0.007)).toFixed(2) + ')';
        }
      }
    }
  }
  // trap icons (pooled DOM): 🧊 / 🪞 / ❄ floating above each ready trap
  const TR = boss && plus && plus.bossFx && !plus.bossFx.dead ? plus.bossFx.traps : null;
  for (let i = 0; i < 3; i++) {
    let el = trapEls[i];
    const T = TR && TR[i];
    if (!T || T.cd > 0) { if (el && el.style.display !== 'none') el.style.display = 'none'; continue; }
    if (!el) { el = trapEls[i] = document.createElement('div'); el.style.cssText = 'position:absolute;left:0;top:0;font-size:34px;line-height:1;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));'; barRoot.appendChild(el); }
    _v.set(T.x, world.groundY(T.x, T.d) + 6, -T.d).project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || _v.y < -1.1 || _v.y > 1.2) { el.style.display = 'none'; continue; }
    el.textContent = T.k === 'ice' ? '🧊' : T.k === 'mirror' ? '🪞' : '❄';
    el.style.display = 'block';
    el.style.transform = 'translate(' + ((_v.x * 0.5 + 0.5) * W - 17).toFixed(1) + 'px,' + ((-_v.y * 0.5 + 0.5) * H - 17).toFixed(1) + 'px) scale(' + (1 + 0.15 * Math.sin(performance.now() * 0.008)).toFixed(2) + ')';
  }
}
const trapEls = [];
let crownEl = null;

// ---------- loop ----------
let last = performance.now();
let frameErrors = 0;
let frameAvg = 16, perfT = 0, fpsT = 0, frames = 0, fps = 0, upVotes = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frameAvg += (dt * 1000 - frameAvg) * 0.05;

  // A bug in one system must never freeze the picture (the pause / menu buttons still need a live page): log and carry on.
  try {
    if (G.mode === 'runner') {
      if (runner && !G.paused) runner.update(dt);
    } else if (G.mode === 'agar') {
      if (agar && !G.paused) agar.update(dt);
    } else cigFrame(dt);
  } catch (e) {
    if (frameErrors++ < 5) console.error('[frame]', e);
  }

  // AGAR owns its scene + camera: skip the normal ÇIĞ / runner render
  if (G.mode === 'agar' && agar) {
    SU.uTime.value = now / 1000;
    try { post.render(agar.scene, agar.camera); } catch (e) { if (frameErrors++ < 5) console.error('[agar render]', e); }
    adaptResolution(dt);
    return;
  }

  // widen the FOV with speed (endless modes)
  let wantFov = baseFov + (camera.userData.fovBoost || 0);
  if (G.mode === 'cig' && G.state === 'play') {
    const sk = G.lv ? G.lv.speedK : 1;
    wantFov += (12 + (G.lv ? 6 * clamp((sk - 0.92) / 0.35, 0, 1) : 0)) * clamp((ball.speed - 18 * sk) / (27 * sk), 0, 1) + G.fovKick;
  }
  if (Math.abs(camera.fov - wantFov) > 0.05) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
  SU.uTime.value = now / 1000;
  skin?.update?.(dt, now / 1000, ball.snow);
  post.render(scene, camera);
  adaptResolution(dt);

  if (DEBUG) {
    frames++;
    fpsT += dt;
    if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
    const info = renderer.info.render;
    if (G.mode === 'runner' && runner) ui.debug(`fps ${fps}  dpr ${dpr.toFixed(2)}
calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k
s ${runner.b.s.toFixed(0)} u ${runner.b.u.toFixed(2)} h ${runner.b.h.toFixed(2)}
v ${runner.b.vs.toFixed(1)} gap ${runner.gap.toFixed(0)} r ${runner.b.r.toFixed(2)} ${runner.state}`);
    else ui.debug(`fps ${fps}  dpr ${dpr.toFixed(2)}\ncalls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k\nr ${ball.r.toFixed(2)}  v ${ball.speed.toFixed(1)}  d ${ball.d.toFixed(0)}\ntier ${G.tier + 1}  stuck ${ball.stuckCount()}  pulls ${world?.pulls.length ?? 0}`);
  }
}

// Drop resolution when the phone struggles, creep back up when it's comfortable.
function adaptResolution(dt) {
  perfT += dt;
  if (perfT < 2) return;
  perfT = 0;
  let next = dpr;
  if (frameAvg > 24 && dpr > 1) next = Math.max(1, dpr - 0.25);
  else if (frameAvg < 18.5 && dpr < dprMax && ++upVotes >= 3) { next = Math.min(dprMax, dpr + 0.25); upVotes = 0; }
  if (next !== dpr) {
    dpr = next;
    renderer.setPixelRatio(dpr);
    resize();
  }
}

function makeSky() {
  const geo = new THREE.SphereGeometry(1000, 20, 12);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x5fa8ff), mid = new THREE.Color(0xa9d4ff), hor = new THREE.Color(HORIZON), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 1000;
    if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
    else c.copy(hor).lerp(mid, Math.max(0, y / 0.25));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

// Debug hooks: advance the simulation with a fixed step regardless of rAF throttling (muted headless tests use these).
if (DEBUG) {
  window.cig = {
    G, ball, CFG,
    set auto(v) { AUTO = !!v; if (game) game.auto = AUTO; },
    get auto() { return AUTO; },
    get world() { return world; },
    get game() { return game; },
    get bot() { return game?.bot; },
    // ÇIĞ SONSUZ: mirrors the real frame (rules, suction, world, fx, camera, scenery) with a fixed step.
    sim(seconds, step = 1 / 60) {
      const n = Math.round(seconds / step);
      for (let i = 0; i < n && G.mode === 'cig'; i++) {
        cigFrame(step);
        if (G.state === 'result' && i > 0) break;
      }
      // end -> result is intentional (end animation, then finishCig); settle it so a finished run always reports 'result'
      for (let k = 0; k < 400 && G.state === 'end' && G.mode === 'cig'; k++) cigFrame(step);
      post.render(scene, camera);
      return cigSummary();
    },
    start: (a = false) => startCigEndless(typeof a === 'number' ? { seed: a } : { daily: !!a }),
    // ---- ÇIĞ DAĞLAR
    cigLevel: (n, opts = {}) => { startCigLevel(opts.daily ? { daily: true } : n, { ...opts, force: true }); return cigSummary(); },
    plan: (n) => { const P = dagPlan(n); return { ...JSON.parse(JSON.stringify(P)), problems: validatePlan(P) }; },
    warp(d) {
      if (!game || !G.lv) return null;
      const dd = d - ball.d;
      ball.d = d;
      ball.y = world.groundY(ball.x, d) + ball.r * 0.92;
      world.stream(d, 400, 40, true);
      plus.planTo(Math.min(world.genD, world.planEnd || Infinity) - 30);
      game.progD = d; game.progT = 0;
      if (game.wave.on) game.wave.d += dd;
      ball.sync(); updateCamera(0, true);
      return cigSummary();
    },
    setR(r) { ball.setRadius(r); G.peakR = r; ball.sync(); return +ball.r.toFixed(3); },
    gate() {
      const g = game?._next;
      return g ? { i: g.i, d: g.d, kind: g.kind, minR: +g.minR.toFixed(3), need: +(2 * g.minR).toFixed(2), ready: game._readyOf(g), cracks: g.cracks, bounces: g.bounces, supplyLeft: g.supplyLeft, broken: g.broken, locked: g.locked } : null;
    },
    win() { if (G.lv && G.state === 'play') { G.finalBroken = true; G.finalR = ball.r; ball.d = Math.max(ball.d, G.lv.length); game._win(); } return cigSummary(); },
    fail(cause = 'melt') { if (G.state === 'play') game.end(cause); return cigSummary(); },
    unlock(n) { save.cigSetCleared(n); menus.refresh?.(); return { cleared: save.cigCleared(), next: save.cigNext(), endless: save.cigEndlessOpen(), daily: save.cigDailyOpen() }; },
    // balance run: the greedy bot plays mountain n a few times; returns one row per run (nothing is saved)
    calib(n, o = {}) {
      const rows = [];
      const keepAuto = AUTO;
      window.__cigCalib = true;
      try {
        for (let i = 0; i < (o.runs || 3); i++) {
          startCigLevel(n, { force: true, retry: true });
          AUTO = true; game.auto = true;
          game.bot.mode = o.mode || 'greedy'; game.bot.noise = o.noise ?? 0.5; game.bot.latency = o.latency ?? 0.3;
          for (let k = 0; k < Math.round((o.maxT || 200) * 60) && G.state !== 'result'; k++) cigFrame(1 / 60);
          const ev = G.lastEval || { win: false, stars: 0 };
          rows.push({ win: !!ev.win, cause: G.cause, t: +game.stats.time.toFixed(1), d: Math.round(ball.d), bounces: game.stats.bounces, hits: game.stats.hits, crates: game.stats.crates, maxMul: game.stats.maxMul, stars: ev.stars, finalR: +G.finalR.toFixed(2), gates: G.gateLog.map((x) => ({ i: x.i, r: +x.r.toFixed(2), need: +x.need.toFixed(2), ok: x.ok })) });
        }
      } finally { window.__cigCalib = false; AUTO = keepAuto; if (game) game.auto = AUTO; }
      return rows;
    },
    cigEndlessDebug: () => startCigEndless(),
    cigEndless: (opts = {}) => startCigEndless(opts),
    endless: () => startEndless(),
    level: (id) => startEndless(levelById(id)),
    skipTutorial() { debugNoTut = true; if (runner) runner.ctx.noTut = true; },
    simEndless(seconds, step = 1 / 60) {
      const n = Math.round(seconds / step);
      for (let i = 0; i < n && runner; i++) runner.update(step);
      post.render(scene, camera);
      const b = runner.b;
      return { state: runner.state, s: +b.s.toFixed(1), u: +b.u.toFixed(2), h: +b.h.toFixed(2), v: +b.vs.toFixed(1), r: +b.r.toFixed(2), gap: +runner.gap.toFixed(1), score: Math.round(runner.score), coins: runner.coins, cause: runner.cause };
    },
    agar: () => startAgar(),
    get agarMode() { return agar; },
    get runner() { return runner; },
    get plus() { return plus; },
    get ui() { return ui; },
    get menus() { return menus; },
    get camera() { return camera; },
    get result() { return G.result; },
  };
  const cigSummary = () => ({
    state: G.state, r: +ball.r.toFixed(2), d: +ball.d.toFixed(1), v: +ball.speed.toFixed(1), tier: G.tier + 1,
    tons: game ? Math.round(game.totalTons()) : 0, eats: game?.stats.eats ?? 0, bumps: game?.stats.bumps ?? 0, cause: G.cause || '',
    pulls: world?.pulls.length ?? 0, stuck: ball.stuckCount(), statics: world?.statics.length ?? 0, hunger: game ? +game.hungerFrac().toFixed(2) : 0,
    wave: !!game?.wave.on, hw: world ? +world.halfWidth(ball.d + 100).toFixed(1) : 0,
    lv: G.lv ? G.lv.n : 0, stage: G.gateIdx || 0, gate: game?._next ? +(2 * game._next.minR).toFixed(2) : 0, hits: game?.stats.hits ?? 0, chain: G.chain || 0, finalBroken: !!G.finalBroken,
    gap: game?.wave.on ? +(ball.d - game.wave.d).toFixed(1) : 0, bounces2: game?.stats.bounces ?? 0,
  });
  window.cig.summary = cigSummary;
}

// ---- retention: local notifications (native only; no-ops on web) ----
async function notifSync(afterRun) {
  if (!platform.isNative) return;
  try {
    await notify.cancelAll();
    if (afterRun && save.runsTotal() >= 2) await notify.requestOnce();
    const t = Date.now();
    const list = [];
    let n = 0;
    try { n = meta.daily().streak | 0; } catch { /* ignore */ }
    list.push({ id: 9101, at: new Date(t + 20 * 3600e3), body: n > 0 ? '🔥 ' + n + ' günlük serin bitmek üzere! Bir koşu yeter.' : '🔥 Serin bitmek üzere! Bir koşu yeter.' });
    const d = new Date(t); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
    list.push({ id: 9102, at: d, body: '🏃 Günün Rush’ı hazır — bugünkü parkuru herkes aynı oynuyor!' });
    try {
      const s = meta.season();
      if (s && s.msLeft > 0 && s.msLeft <= 3 * 86400000) list.push({ id: 9103, at: new Date(t + Math.max(60000, s.msLeft - 12 * 3600e3)), body: '⏳ Sezon bitiyor! Ödüllerini topla.' });
    } catch { /* ignore */ }
    await notify.schedule(list.filter((x) => x.at.getTime() > t + 30000));
  } catch { /* ignore */ }
}
if (platform.isNative) {
  notify.cancelAll();
  document.addEventListener('visibilitychange', () => { if (document.hidden) notifSync(false); else notify.cancelAll(); });
  import('@capacitor/app').then(({ App }) => {
    App.addListener('pause', () => notifSync(false));
    App.addListener('resume', () => notify.cancelAll());
  }).catch(() => {});
}

// Boot: pull in the imported models (≈1 MB) first; the game still runs on procedural props if they fail.
async function boot() {
  try { Object.assign(lib, await loadModels()); } catch (e) { console.warn(e); }
  applySkin(save.selected('skin'));
  // FTUE: existing saves count as done; a brand-new player gets a 2 s splash, then YETİ RUSH right away.
  let ftueNew = false;
  try {
    if (localStorage.getItem('patpat.ftue') === null) {
      if (save.runsTotal() > 0) localStorage.setItem('patpat.ftue', '1');
      else { localStorage.setItem('patpat.ftueGate', 'on'); ftueNew = !params.has('play') && !params.has('cig') && !params.has('endless') && !DEBUG; }
    }
  } catch { /* ignore */ }
  toMenu();
  updateCamera(0, true);
  if (ftueNew) {
    const sp = document.createElement('div');
    sp.className = 'ftue-splash';
    sp.innerHTML = '<div class="fs-logo">PATPAT</div><div class="fs-sub">YETİ</div><div class="fs-tap">DOKUN VE OYNA</div>';
    document.body.appendChild(sp);
    let gone = false;
    const startedAt = G.runNo;
    // only auto-start if nothing else was started meanwhile (e.g. a mode launched while the splash was up)
    const go = () => { if (gone) return; gone = true; sp.classList.add('out'); setTimeout(() => sp.remove(), 350); if (G.runNo === startedAt && G.mode !== 'runner' && G.mode !== 'agar') startEndless(); };
    sp.addEventListener('pointerdown', go);
    setTimeout(go, 2000);
  }
  try { (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => { loadEndless().catch(() => {}); }); } catch { /* optional */ }
  if (params.has('play') || params.has('cig')) {
    const cp = params.get('cig');
    if (cp === 'endless') startCigEndless({ daily: params.has('daily') });
    else if (params.has('daily')) startCigLevel({ daily: true });
    else { const n = parseInt(cp, 10); startCigLevel(Number.isFinite(n) ? n : save.cigNext()); }
  }
  else if (params.has('endless')) startEndless();
  requestAnimationFrame(frame);
}
boot();
