// cigplan.js — ÇIĞ DAĞLAR: the 30 finite mountains as pure data.
//
// No DOM, no three.js: only config.js and rng.js, so it can be imported from node. The same n (and the same options)
// always gives the same plan, so a retry is fair and the layout can be inspected: dagPlan(7) -> everything the world
// will place (barrier gates, crate lines, ramps, strips, the boss arena...) and the three star goals.
//
//   dagPlan(n, { daily, seed, dailyNo, assist }) -> Plan   (cached; treat it as read-only)
//   planAt(P, d) / planSlope(P, d)  the radius the plan EXPECTS at distance d (log-linear from r0 to rEnd at the last gate)
//   evalStars(P, stats) -> [bool, bool, bool]      planBrief(n) -> menu card data      validatePlan(P) -> [problems]
//
// Everything that is a number worth tuning is either at the top of this file or in CFG.lvl (config.js).
import { CFG, tierOf, hwFor } from './config.js';
import { makeRng } from './rng.js';

export const DAG_COUNT = 30;

// the first mountain that uses each mechanic (also drives the one-time intro card)
export const MECH_AT = {
  crate: 2, chase: 3, strip: 4, boss: 5, iceWall: 5, chain: 6, crateWall: 6, rival: 7, cannon: 8, gold: 9,
  strong: 11, bridge: 12, ice: 16, wind: 18, fog: 22, rush: 26,
};

export const NAMES = [
  'İlk Çığ', 'Kasa Yolu', 'Kovalamaca', 'Hız Şeridi', "Yeti'nin Kapısı", 'Zincir Kırıcı', 'Rakip Top', 'Top Atarı', 'Altın Avı', 'Robot Şatosu',
  'Demir Kasalar', 'Buz Köprüsü', 'Kasaba Baskını', 'Çığ Fırtınası', 'Buz Golemi', 'Kaygan Yamaç', 'Kristal Vadi', 'Rüzgârlı Zirve', 'Dev Kapılar', 'Yeti Kralı',
  'Beyaz Orman', 'Sisli Geçit', 'Şehir Eteği', 'Çığ Yolu', 'Robot Ordusu', 'İkiz Çığ', 'Kayalık Duvar', 'Gökdelen Vadisi', 'Dağ Devi', 'Kış Kralı',
];

const BOSS_K = 0.94;   // PATRON size vs the final-gate pace requirement
export const BOSS_IDS = { 5: 'yeti', 10: 'robot', 15: 'golem', 20: 'yeti', 25: 'robot', 30: 'golem' };

// one-time intro cards (shown BEFORE the mountain starts, never during play)
export const INTRO = {
  1: { icon: '⛔', text: 'Küçükleri ye, büyü. Kapıyı kırmak için üstündeki ⛔ boyuta ulaşmalısın.', mech: 'gate' },
  2: { icon: '📦', text: 'Kasalara çarp: içinden kar fışkırır. Hepsi senin!', mech: 'crate' },
  3: { icon: '🌨️', text: 'Çığ arkandan geliyor. Kapıya çarpıp durursan seni yakalar.', mech: 'chase' },
  4: { icon: '⚡', text: 'Hız şeridinden geç: hızlanırsın ve kapıya daha sert çarparsın.', mech: 'strip' },
  5: { icon: '👹', text: 'PATRON yolu kapatıyor: ondan büyük gel ve onu yut. Küçüksen çarpıp parçalanırsın!', mech: 'boss' },
  6: { icon: '🔗', text: 'Arka arkaya kır, zincir kur: çarpan büyür, kar erimez.', mech: 'chain' },
  7: { icon: '⚪', text: 'Rakip kartopu: ondan büyüksen yut, küçüksen kaç.', mech: 'rival' },
  8: { icon: '🎯', text: 'Top atarı: beyaz topları yut, kırmızılardan kaç.', mech: 'cannon' },
  9: { icon: '🌟', text: 'Altın kasa riskli yerlerde saklanır. Üçüncü yıldız için hepsini kır.', mech: 'gold' },
  11: { icon: '🔩', text: 'Demir kasa: yeterince büyük değilsen geri seker.', mech: 'strong' },
  12: { icon: '🧊', text: 'Buz köprüsü kestirmedir ama çok büyüksen çöker. Boyuna güven.', mech: 'bridge' },
  16: { icon: '⛸️', text: 'Buzlu yol: top kayar, erken dön.', mech: 'ice' },
  18: { icon: '💨', text: 'Rüzgâr seni yana iter.', mech: 'wind' },
  22: { icon: '🌫️', text: 'Sis var: kapı etiketlerine bak.', mech: 'fog' },
  26: { icon: '🌨️', text: 'Çığ bu sefer daha hızlı.', mech: 'rush' },
};

// third-star kind for the hand-made mountains
const STAR3 = { 1: 'nobounce', 2: 'crates', 3: 'nobounce', 4: 'secret', 5: 'nohit', 6: 'chain', 7: 'rival', 8: 'nohit', 9: 'gold', 10: 'time', 11: 'crates', 12: 'chain' };

// metres of track a part needs (everything the part places stays inside [start, start + len])
const RES = { crateLine: 44, crateWall: 64, iceWall: 48, ramp: 95, mush: 90, army: 60, town: 90, golden: 50, patch: 100, rival: 70, cannon: 90, bridge: 130, fork: 124, pickup: 14, strip: 14, puddle: 12, salt: 16, gate: 84, arena: 170, statues: 66, secret: 92, domino: 40, throne: 58 };
const GAP = 25;
// ramp launches: the upward speed is scaled by this, so a jump lasts about a third less (2 / 3 of the old airtime) and lands sooner
export const RAMP_AIR_K = 0.67;

// hand-made stage lists for the first ten mountains (CL crate line, CW crate wall, IW ice wall, RMP ramp, MSH mushrooms,
// ARM army, TWN town, GLD golden snowball, RIV rival, CAN cannon, ARENA boss arena; * = holds the golden crates)
const KIND_OF = { CL: 'crateLine', CW: 'crateWall', IW: 'iceWall', RMP: 'ramp', MSH: 'mush', ARM: 'army', TWN: 'town', GLD: 'golden', RIV: 'rival', CAN: 'cannon', ARENA: 'arena', PAT: 'patch' };
const HAND = {
  1: [['TWN'], ['RMP', 'GLD']],
  2: [['CL', 'MSH'], ['CL', 'TWN']],
  3: [['CL', 'ARM'], ['GLD', 'CL']],
  4: [['CL', 'RMP'], ['ARM', 'CL']],
  5: [['CL', 'IW', 'ARM'], ['ARENA']],
  6: [['CW', 'MSH'], ['IW', 'TWN', 'CL']],
  7: [['CL', 'RIV'], ['CW', 'ARM', 'GLD'], ['IW', 'CL', 'RMP']],
  8: [['CL', 'CAN'], ['CW', 'MSH', 'CAN'], ['ARM', 'CL', 'IW']],
  9: [['CL', 'GLD', 'CAN'], ['CW*', 'ARM', 'RMP'], ['IW', 'CL*', 'TWN']],
  10: [['CL', 'CAN'], ['CW', 'ARM', 'MSH'], ['ARENA']],
};

// weighted pool for the generated mountains (11+): [kind, weight, firstN, maxPerStage, maxPerLevel]
const POOL = [
  ['ramp', 2, 2, 9, 9], ['mush', 2, 2, 9, 9], ['town', 1, 1, 1, 1], ['golden', 2, 3, 1, 9], ['patch', 1, 3, 9, 9], ['army', 3, 3, 1, 9],
  ['iceWall', 2, 5, 9, 9], ['rival', 2, 7, 1, 1], ['cannon', 3, 8, 99, 99], ['bridge', 2, 12, 1, 1],
];

const round10 = (v) => Math.round(v / 10) * 10;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// radius of a plain crate on a mountain whose plan radius is pr (capped: crates stay crates, the ball sweeps them anyway)
export const crateRadius = (pr) => clamp(0.55 * pr, 0.3, 3.4);
export function fmtD(d) {
  if (d >= 10) return String(Math.round(d));
  return (Math.round(d * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '');
}

// ------------------------------------------------------------------------------------------------ plan helpers
// the radius the plan expects at distance d: log-linear from r0 (start) to rEnd (final gate)
export function planAt(P, d) {
  const t = clamp(d / P.dF, 0, 1);
  return P.r0 * Math.pow(P.rEnd / P.r0, t);
}
// d ln(r) / d d
export function planSlope(P, d) {
  return d < P.dF ? Math.log(P.rEnd / P.r0) / P.dF : 0;
}
// track half width at d, from the precomputed transitions (the world uses the same list)
export function planHw(P, d) {
  let hw = P.hw0;
  const T = P.widths;
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    if (d <= t.d0) break;
    if (d >= t.d1) hw = t.to;
    else { const u = (d - t.d0) / (t.d1 - t.d0); hw = t.from + (t.to - t.from) * u * u * (3 - 2 * u); break; }
  }
  return hw;
}

// ------------------------------------------------------------------------------------------------ the generator
const cache = new Map();

export function dagPlan(n, opts = {}) {
  n = clamp(Math.round(Number.isFinite(n) ? n : 1), 1, DAG_COUNT);
  const daily = !!opts.daily;
  const assist = opts.assist ? 1 : 0;
  const key = `${n}|${daily ? opts.seed >>> 0 : ''}|${assist}`;
  let P = cache.get(key);
  if (!P) {
    P = build(n, daily, assist, opts);
    if (cache.size > 80) cache.clear();
    cache.set(key, P);
  }
  return P;
}

function build(n, daily, assist, opts) {
  const L = CFG.lvl;
  const seed = daily ? (opts.seed >>> 0) || 1 : (Math.imul(n, 2654435761) ^ 0x9e3779b9) >>> 0;
  const rng = makeRng(seed);
  const boss = !daily && n % 5 === 0;
  const bossArena = boss && L.bossArena;
  const bossId = boss ? BOSS_IDS[n] || 'yeti' : null;
  const S = 2 + Math.floor(n / 7);
  const ters = !daily && !boss && n >= 7 && n % 7 === 0;   // TERS ÇIĞ: the avalanche runs ahead, you chase it
  const tNom = Math.min(90, Math.round(45 + 1.5 * (n - 1)) + (boss ? 8 : 0));
  const par = Math.round(L.parK * tNom);
  const speedK = L.speedK0 + L.speedKStep * (n - 1);
  const rEnd = 1.8 * Math.pow(1.105, n - 1);
  const r0 = n <= 4 ? CFG.startR : Math.max(CFG.startR, rEnd / 3.2);
  const rCap = L.capK * rEnd;
  const length = round10(L.lenK * tNom * speedK * (18 + 6 * Math.sqrt(Math.sqrt(r0 * rEnd))));
  const dF = length - L.finalPad;
  const gateK = (n === 1 ? 0.72 : n < 6 ? 0.78 + 0.0028 * (n - 2) : Math.min(1.1, 0.9 + 0.004 * (n - 6))) - (assist ? 0.04 : 0);
  const star2K = 1 + 0.005 * (n - 1);
  const hw0 = hwFor(r0);

  const P = {
    n, id: 'dag' + n, label: daily ? 'GÜNÜN DAĞI' : 'DAĞ ' + n, name: daily ? 'Günün Dağı' : NAMES[n - 1], seed, daily,
    ters, boss, bossId, bossHits: boss ? 6 + Math.floor(n / 5) : 0,
    speedK, tNom, par, r0, rEnd, rCap, tierStart: tierOf(r0), tierCap: tierOf(rEnd), hw0, length, dF, S,
    gateK, star2K, r2: star2K * rEnd, meltMul: n <= 2 ? 0.7 : n <= 5 ? 0.85 : 1, assist,
    gates: [], finale: null, items: [], widths: [], chase: null, twist: null, mech: [], intro: null,
    crates: { total: 0, gold: 0, target3: 0 }, stars: [],
  };
  if (daily && opts.dailyNo) P.label = 'GÜNÜN DAĞI #' + opts.dailyNo;

  // ---- barrier gates (the last one is the final: wall / big gate / locked boss gate)
  for (let i = 0; i < S; i++) {
    const last = i === S - 1;
    const d = last ? dF : Math.round(L.firstGate + (dF - L.firstGate) * Math.pow((i + 1) / S, L.gateExp));
    const need = gateK * planAt(P, d);
    let kind = 'gate', skin = 'ice';
    if (last) {
      kind = bossArena ? 'boss' : 'final';
      skin = boss ? 'big' : (n % 2 ? 'wall' : 'big');
    }
    // (boss gate without an arena: a plain big gate, a bit easier than the plan)
    const minR = ters ? 0.3 * need : boss && !bossArena && last ? 0.86 * rEnd : need;
    P.gates.push({ i, d, minR, kind, skin });
  }
  const fg = P.gates[S - 1];
  P.finale = { kind: bossArena ? 'boss' : (n % 2 ? 'wall' : 'gate'), d: dF, minR: fg.minR };
  // PATRON: a fixed size (radius) from the plan. Ball >= it at contact: swallow it; smaller: crash. It is also the finish barrier's
  // requirement (the boss IS the barrier), so the HUD chip shows it. Fair: a bit under a normal final gate at that distance.
  P.bossNeedR = boss ? Math.round(BOSS_K * fg.minR * 20) / 20 : 0;
  if (bossArena) fg.minR = P.finale.minR = P.bossNeedR;
  P.bossR = P.bossNeedR || 1.7 * rEnd + 1;   // the boss model is exactly the size you need

  // ---- pace: chase, twist, mechanics, intro
  if (ters) P.chase = { ters: true, t0: 3, gap0: 55, k: 0.82, clamp: 1 };
  else if (n >= 3) {
    let k = Math.min(0.78, 0.42 + 0.012 * (n - 3)), gap0 = Math.max(70, 120 - 1.5 * (n - 3));
    if (n >= 26) { k += 0.08; gap0 -= 15; }
    if (assist) gap0 += 20;
    P.chase = { t0: 6, gap0, k, clamp: 1.35 };
  }
  P.twist = n >= 26 ? 'rush' : ({ 16: 'ice', 18: 'wind', 22: 'fog' })[n] || null;
  for (const m in MECH_AT) if (MECH_AT[m] <= n) P.mech.push(m);
  if (!daily) P.intro = INTRO[n] || null;

  // ---- track width: every stage the slope widens to what the plan's ball needs, finished 30 m before the gate
  {
    let from = hw0, tier = tierOf(r0);
    for (let i = 0; i < S; i++) {
      const gd = P.gates[i].d;
      const planR = planAt(P, gd);
      const to = hwFor(planR);
      const d0 = i === 0 ? 80 : P.gates[i - 1].d + 24;
      const blend = Math.min(Math.max(60, 6 * planR), gd - 30 - d0);
      if (to > from * 1.02 && blend > 20) {
        const t = tierOf(planR);
        P.widths.push({ d0, d1: d0 + blend, from, to, tier: t, scale: Math.max([1, 1.3, 1.75, 2.3, 3][Math.min(t, 4)], planR / 3.3) });
        from = to; tier = t;
      }
    }
    P.tierEnd = tier;
  }

  // ---- stage content
  const power = makePowerBag(n, rng);
  const regions = [];
  for (let i = 0; i < S; i++) {
    const a = i === 0 ? 120 : P.gates[i - 1].d + 40;
    const b = P.gates[i].d - L.gatePre - 30;
    regions.push([a, b]);
  }
  const items = [];
  const hand = !daily ? HAND[n] : null;
  let rivalPlaced = false, townPlaced = false, bridgePlaced = false;
  let lastKind = '';
  let crateCycle = (n + 1) % 3;
  for (let i = 0; i < S; i++) {
    const [a, b] = regions[i];
    const arenaStage = bossArena && i === S - 1;
    let parts = [];
    if (arenaStage) {
      parts.push({ kind: 'arena', len: 100, start: dF - 170, boss: bossId });
    } else if (hand && hand[i]) {
      for (const tok of hand[i]) {
        const gold = tok.endsWith('*');
        const kind = KIND_OF[gold ? tok.slice(0, -1) : tok];
        if (kind === 'arena') continue;
        parts.push({ kind, len: RES[kind], gold: gold ? 1 : 0 });
        if (kind === 'rival') rivalPlaced = true;
        if (kind === 'town') townPlaced = true;
      }
    } else {
      const k = n < 7 ? 2 : n < 20 ? 3 : 4;
      if (n >= 2) {
        let kind = 'crateLine';
        if (n >= 6) { kind = ['crateLine', 'crateWall', 'iceWall'][crateCycle % 3]; crateCycle++; }
        parts.push({ kind, len: RES[kind], gold: 0 });
        lastKind = kind;
      }
      const used = {};
      while (parts.length < k) {
        const ok = POOL.filter((e) => e[2] <= n && e[0] !== lastKind && (used[e[0]] || 0) < e[3]
          && !(e[0] === 'rival' && rivalPlaced) && !(e[0] === 'town' && townPlaced) && !(e[0] === 'bridge' && (bridgePlaced || i % 2 === 1))
          && !(e[0] === 'cannon' && (used.cannon || 0) >= (n >= 16 ? 2 : 1)));
        if (!ok.length) break;
        let tot = 0;
        for (const e of ok) tot += e[1];
        let roll = rng.next() * tot, pick = ok[ok.length - 1];
        for (const e of ok) { roll -= e[1]; if (roll <= 0) { pick = e; break; } }
        const kind = pick[0];
        used[kind] = (used[kind] || 0) + 1;
        lastKind = kind;
        if (kind === 'rival') rivalPlaced = true;
        if (kind === 'town') townPlaced = true;
        if (kind === 'bridge') bridgePlaced = true;
        parts.push({ kind, len: RES[kind], gold: 0 });
      }
    }
    // DOMİNO ÇAM: one pine row per mountain from DAĞ 2
    if (!arenaStage && n >= 2 && i === Math.min(2, S - 1)) parts.unshift({ kind: 'domino', len: RES.domino });
    if (!arenaStage && !daily && n >= 3 && i === Math.min(1, S - 1)) parts.unshift({ kind: 'statues', len: RES.statues });
    // KARDAN ADAM TAHTI: a toppled-snowman tower in a side area (from DAĞ 3, never boss / TERS mountains)
    if (!arenaStage && !daily && !boss && !ters && n >= 3 && i === Math.min(2, S - 1)) parts.unshift({ kind: 'throne', len: RES.throne });
    // GİZLİ KAR TÜNELİ: a cracked ice wall at the slope edge (about one per mountain, from DAĞ 4)
    if (!arenaStage && n >= 4 && i === Math.min(1, S - 1)) parts.unshift({ kind: 'secret', len: RES.secret });
    if (!arenaStage) {
      // a power-up after the first part, an extra strip in the middle of later stages
      if (n >= 2 && parts.length) parts.splice(Math.min(1, parts.length), 0, { kind: 'pickup', len: RES.pickup, power: power() });
      if (n >= 9 && parts.length > 2) parts.splice(Math.ceil(parts.length / 2), 0, { kind: 'strip', len: RES.strip, extra: 1 });
      // pack them one after the other inside [a, b]; what does not fit is dropped (power-up / strip first, then from the end)
      const total = () => parts.reduce((s, p) => s + p.len, 0) + GAP * (parts.length - 1);
      while (parts.length > 1 && total() > b - a) {
        let idx = -1;
        for (let q = parts.length - 1; q >= 0; q--) if (parts[q].kind === 'pickup' || parts[q].kind === 'strip') { idx = q; break; }
        if (idx < 0) for (let q = parts.length - 1; q >= 0; q--) if (parts[q].kind !== 'fork') { idx = q; break; }
        if (idx < 0) idx = parts.length - 1;
        parts.splice(idx, 1);
      }
      const slack = Math.max(0, b - a - parts.reduce((s, p) => s + p.len, 0));
      const gap = slack / (parts.length + 1);
      let cur = a + gap;
      for (const p of parts) { p.start = Math.round(cur); cur += p.len + gap; }
    }
    for (const p of parts) { p.stage = i; items.push(p); }
  }

  // YOL AYRIMI (DAG 3+, once per mountain): one route fork at 40-60% of the course, in the first free slot
  if (n >= 3 && !daily && !boss) {
    const fl = RES.fork, mid = dF * 0.5;
    const SOFT1 = ['pickup', 'strip', 'crateLine'], SOFT2 = [...SOFT1, 'crateWall', 'iceWall', 'army', 'statues', 'domino', 'secret', 'throne', 'mush', 'cannon'];
    const free = (s0, pad, gm, soft) => s0 > 130 && s0 + fl < dF - 60
      && !items.some((p) => (soft ? !soft.includes(p.kind) : true) && s0 < p.start + p.len + pad && p.start < s0 + fl + pad)
      && !P.gates.some((g) => s0 < g.d + 30 && g.d - gm < s0 + fl);
    let at = -1;
    const tiers = [[14, L.gatePre + 40, 0.1], [8, L.gatePre + 20, 0.3], [4, 24, 0.3], [2, 12, 0.45]];
    for (const [pad, gm, span] of tiers) {
      for (let o = 0; o <= span * dF && at < 0; o += 5) {
        const c1 = Math.round(mid - fl / 2 - o), c2 = Math.round(mid - fl / 2 + o);
        if (free(c1, pad, gm, false)) at = c1; else if (free(c2, pad, gm, false)) at = c2;
      }
      if (at >= 0) break;
    }
    let soft = null;
    for (const sf of [SOFT1, SOFT2]) {
      for (let o = 0; o <= 0.45 * dF && at < 0; o += 5) {
        const c1 = Math.round(mid - fl / 2 - o), c2 = Math.round(mid - fl / 2 + o);
        if (free(c1, 2, 12, sf)) at = c1; else if (free(c2, 2, 12, sf)) at = c2;
      }
      if (at >= 0) { soft = sf; break; }
    }
    if (at >= 0 && soft) {
      for (let q = items.length - 1; q >= 0; q--) {
        const p = items[q];
        if (soft.includes(p.kind) && at < p.start + p.len + 2 && p.start < at + fl + 2) items.splice(q, 1);
      }
    }
    if (at >= 0) {
      let st = 0;
      for (const g of P.gates) if (g.d < at) st = g.i + 1;
      items.push({ kind: 'fork', len: fl, start: at, stage: Math.min(st, S - 1) });
    }
  }

  // golden crates: spread over the crate parts (hand-made lists already mark theirs)
  const gc = n < 9 ? 0 : n < 17 ? 2 : n < 25 ? 3 : 4;
  P.crates.gold = 0;
  const crateParts = items.filter((p) => p.kind === 'crateLine' || p.kind === 'crateWall');
  if (gc && !items.some((p) => p.gold)) {
    for (let g = 0; g < gc && crateParts.length; g++) crateParts[Math.floor(((g + 0.5) * crateParts.length) / gc) % crateParts.length].gold += 1;
  }

  // part parameters that only the plan may decide (counts, positions, strengths) so that crates.total is exact
  for (const p of items) {
    const mid = p.start + 20;
    const pr = planAt(P, mid);
    const hw = planHw(P, mid);
    if (p.kind === 'crateLine') {
      p.n = n >= 10 || n <= 5 ? 9 : 7;
      p.phase = rng.range(0, 6.28);
      P.crates.total += p.n;
      P.crates.gold += Math.min(p.gold, p.n);
    } else if (p.kind === 'crateWall') {
      const free = 3.2 * pr + 2;
      const pitch = Math.max(2.4, 2.3 * crateRadius(pr));
      p.rows = 3;
      p.cols = clamp(Math.floor((2 * hw - free - 2) / pitch), 2, 5);
      p.side = rng.sign();
      p.iron = n >= 11 ? 3 : 0;
      P.crates.total += p.rows * p.cols;
      P.crates.gold += Math.min(p.gold, p.rows * p.cols);
    } else if (p.kind === 'fork') {
      p.side = rng.sign();
      P.crates.total += 6;
      P.crates.gold += 4;
    } else if (p.kind === 'iceWall') {
      p.cover = rng.range(0.6, 0.75);
      p.side = rng.sign();
      p.minR = 0.62 * pr;
    } else if (p.kind === 'statues') {
      p.count = n < 6 ? 3 : n < 15 ? 4 : 5;
      p.side = rng.sign();
      P.hasStatues = p.count;
    } else if (p.kind === 'throne') {
      p.side = rng.sign();
      P.hasThrone = 1;
    } else if (p.kind === 'secret') {
      p.side = rng.sign();
      P.hasSecret = 1;
    } else if (p.kind === 'mush') {
      p.count = rng.chance(0.5) ? 3 : 2;
    } else if (p.kind === 'cannon') {
      p.side = rng.sign();
    } else if (p.kind === 'bridge') {
      p.side = -1;
      p.maxR = 1.05 * planAt(P, p.start + 60);
    } else if (p.kind === 'pickup') {
      p.xf = rng.range(-0.75, 0.75);
    } else if (p.kind === 'strip') {
      p.xf = rng.range(-0.6, 0.6);
    } else if (p.kind === 'army') {
      p.at = p.start + 12;
    }
    p.at = p.at ?? p.start + 10;
  }
  P.crates.target3 = n === 2 ? 8 : Math.ceil(0.7 * P.crates.total);

  // gates (with their feeding trails, hit strips) and the finish line
  for (const g of P.gates) {
    const last = g.i === S - 1;
    items.push({
      kind: 'gate', start: g.d - L.gatePre, len: RES.gate, at: g.d, gd: g.d, minR: g.minR, skin: g.skin, i: g.i,
      final: last, locked: last && bossArena, stage: g.i,
    });
    if (n >= 4) items.push({ kind: 'strip', start: g.d - 52, len: 4, at: g.d - 52, xf: rng.range(-0.6, 0.6), pre: 1, stage: g.i });
  }
  // ---- extras (not daily): speed strips (boosters), warm puddles and salt strips (light shrink pads), dropped into free slots
  if (!daily) {
    const freeSlot = (len) => {
      const lo = 130, hi = dF - 40 - len;
      for (let k = 0; k < 60 && hi > lo; k++) {
        const s0 = Math.round(rng.range(lo, hi));
        if (!items.some((p) => s0 < p.start + p.len + 10 && p.start < s0 + len + 10)) return s0;
      }
      return -1;
    };
    const extras = [
      ['strip', n >= 3 ? 3 + Math.min(3, Math.floor(n / 6)) : 0],
      ['puddle', n >= 3 && !boss ? (n < 6 ? 1 : n < 12 ? 2 : 3) : 0],
      ['salt', n >= 5 && !boss ? (n < 12 ? 1 : 2) : 0],
    ];
    for (const [kind, count] of extras) {
      for (let c = 0; c < count; c++) {
        const len = RES[kind], start = freeSlot(len);
        if (start < 0) break;
        const stage = Math.min(S - 1, P.gates.filter((g) => g.d < start).length);
        items.push({ kind, start, len, at: start + 10, xf: rng.range(-0.55, 0.55), stage });
      }
    }
  }
  items.push({ kind: 'finish', start: dF + 14, len: 4, at: length, stage: S - 1 });
  items.sort((x, y) => x.start - y.start || (x.kind === 'gate' ? 1 : 0) - (y.kind === 'gate' ? 1 : 0));
  P.items = items;

  // ---- stars
  P.stars = makeStars(P, n, daily, boss, items);
  Object.freeze(P);
  return P;
}

// bag of power-up kinds (no repeats in a row)
function makePowerBag(n, rng) {
  const kinds = ['magnet', 'giant', 'shield'];
  if (n >= 8) kinds.push('freeze');
  if (n >= 15) kinds.push('rainbow');
  let bag = [];
  let last = '';
  return () => {
    if (!bag.length) {
      bag = kinds.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = (rng.next() * (i + 1)) | 0; [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag[bag.length - 1] === last && bag.length > 1) { const t = bag[0]; bag[0] = bag[bag.length - 1]; bag[bag.length - 1] = t; }
    }
    last = bag.pop();
    return last;
  };
}

function makeStars(P, n, daily, boss, items) {
  const st = [{ star: 1, kind: 'finish', text: 'Dağı bitir' }];
  st.push({ star: 2, kind: 'size', r: P.r2, text: `Bitişte ${fmtD(2 * P.r2)} m boyuta ulaş` });
  let kind;
  const hasRival = items.some((p) => p.kind === 'rival');
  if (!daily && n <= 12) kind = STAR3[n];
  else if (boss) kind = n % 10 === 5 ? 'nohit' : 'time';
  else {
    const pool = ['nobounce', 'time', 'chain', 'nohit'];
    if (P.crates.gold > 0) pool.push('gold');
    if (P.crates.total >= 4) pool.push('crates');
    if (hasRival) pool.push('rival');
    if (P.hasStatues) pool.push('statues');
    if (P.hasSecret) pool.push('secret');
    if (P.hasThrone) pool.push('throne');
    kind = pool[(5 * n + Math.floor(n / 3)) % pool.length];
  }
  // (kinds that need a part this mountain does not have fall back to something that always works)
  if (kind === 'gold' && P.crates.gold < 1) kind = 'nobounce';
  if (kind === 'crates' && P.crates.total < 4) kind = 'nobounce';
  if (kind === 'rival' && !hasRival) kind = 'nohit';
  if (kind === 'statues' && !P.hasStatues) kind = 'nobounce';
  if (kind === 'throne' && !P.hasThrone) kind = 'nohit';
  if (kind === 'secret' && !P.hasSecret) kind = 'nobounce';
  const s3 = { star: 3, kind };
  switch (kind) {
    case 'nobounce': s3.text = 'Kapıdan hiç geri sekme'; break;
    case 'nohit': s3.text = 'Hiç kar kaybetme'; break;
    case 'time': s3.t = P.par; s3.text = `${P.par} saniyede bitir`; break;
    case 'chain': s3.mul = n < 9 ? 3 : n < 20 ? 4 : 5; s3.text = `KIRMA ZİNCİRİ x${s3.mul} yap`; break;
    case 'crates': s3.count = Math.min(P.crates.total, P.crates.target3); s3.text = `${s3.count} kasa kır`; break;
    case 'gold': s3.count = P.crates.gold; s3.text = `Tüm altın kasaları kır (${s3.count})`; break;
    case 'rival': s3.text = 'Rakip kartopunu yut'; break;
    case 'throne': s3.text = 'KARDAN ADAM TAHTINI yık'; break;
    case 'secret': s3.text = 'GİZLİ YOLU bul'; break;
    case 'statues': s3.count = P.hasStatues; s3.text = `HEYKEL SERİSİ: ${s3.count} heykelin hepsini yık`; break;
    default: s3.text = 'Dağı bitir';
  }
  st.push(s3);
  return st;
}

// stats = { finished, finalR, bounces, hits, crates, gold, maxMul, time, rivalEaten }
export function evalStars(P, st) {
  const fin = !!(st && st.finished);
  const b1 = fin;
  const b2 = fin && st.finalR >= P.r2 - 1e-6;
  const s3 = P.stars[2];
  let b3 = false;
  if (fin) {
    switch (s3.kind) {
      case 'nobounce': b3 = (st.bounces | 0) === 0; break;
      case 'nohit': b3 = (st.hits | 0) === 0; break;
      case 'time': b3 = st.time <= s3.t; break;
      case 'chain': b3 = (st.maxMul | 0) >= s3.mul; break;
      case 'crates': b3 = (st.crates | 0) >= s3.count; break;
      case 'gold': b3 = (st.gold | 0) >= s3.count; break;
      case 'rival': b3 = (st.rivalEaten | 0) > 0; break;
      case 'statues': b3 = (st.statues | 0) >= s3.count; break;
      case 'throne': b3 = (st.throne | 0) >= 1; break;
      case 'secret': b3 = (st.secret | 0) >= 1; break;
      default: b3 = true;
    }
  }
  return [b1, b2, b3];
}

export function planBrief(n, opts) {
  const P = dagPlan(n, opts);
  return {
    n: P.n, id: P.id, label: P.label, name: P.name, boss: P.boss, bossId: P.bossId, S: P.S, length: P.length,
    tierFrom: CFG.tierNames[P.tierStart], tierTo: CFG.tierNames[P.tierCap],
    goals: P.stars.map((s) => s.text), intro: P.intro,
  };
}

// consistency checks (dev / debug): returns a list of problems, empty when the plan is sound
export function validatePlan(P) {
  const bad = [];
  let prev = 0, prevMin = 0;
  for (const g of P.gates) {
    if (g.d <= prev) bad.push('gates not increasing');
    if (g.minR < prevMin - 1e-9) bad.push('minR decreasing');
    prev = g.d; prevMin = g.minR;
  }
  if (P.gates[P.S - 1].d !== P.length - CFG.lvl.finalPad) bad.push('final gate is not at length-36');
  let end = 0;
  for (const it of P.items) {
    if (it.start < end - 0.5 && it.kind !== 'strip' && it.kind !== 'finish') {
      // gates may start inside the previous reserved span only when that span is the boss arena's 100 m
      bad.push(`overlap at ${it.kind}@${it.start} (prev end ${Math.round(end)})`);
    }
    if (it.kind !== 'strip') end = Math.max(end, it.start + (it.kind === 'finish' ? 0 : it.len));
    if (it.start < 100 || it.start > P.length) bad.push(`${it.kind} out of range @${it.start}`);
  }
  for (let i = 1; i < P.items.length; i++) if (P.items[i].start < P.items[i - 1].start) bad.push('items not sorted');
  return bad;
}
