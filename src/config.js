// All ÇIĞ (snowball) tuning lives here so balancing never means hunting through systems.
// ÇIĞ SONSUZ is an endless slope: the ball eats its way through five size tiers, the slope widens with every tier,
// the ball melts continuously (hunger) and gets faster the heavier it is.
export const CFG = {
  // ---- slope / world ----
  grade: 0.3,          // vertical drop per meter downhill
  trackW: 28,          // playable width at tier 1 (m) — see tierWidth for the rest
  viewAhead: 260,      // render window ahead of the ball (m); main.js scales it with fog / ball size
  viewBehind: 40,

  // ---- the ball ----
  startR: 0.55,        // starting snowball radius (m)
  minR: 0.4,           // melting below this = ERİDİN!
  eatRatio: 0.9,       // prop.radius <= r * eatRatio → edible
  growK: 0.85,         // volume gained per swallowed prop (fraction of its bounding volume)
  contactK: 0.7,       // props are smaller than their bounding sphere; scale contact distance
  snowDensity: 0.45,   // t/m³ — turns radius into the big tonnage number
  comboWindow: 0.9,    // s between swallows to keep a combo alive

  // ---- size tiers (ball radius → zone) ----
  tierEdges: [1.5, 3, 6, 10, 16, 26, 40],                         // r at which tier 2, 3, 4, 5 begin
  tierNames: ['KARTOPU', 'ÇIĞ', 'MEGA ÇIĞ', 'FELAKET', 'KIYAMET', 'ŞEHİR YUTUCU', 'DAĞ DEVİ', 'GEZEGEN'],
  tierWidth: [28, 40, 56, 80, 110, 150, 200, 260],                   // slope width (m) per tier
  tierSpan: [1.5, 3, 6, 10, 16, 26, 40, 70],                      // upper r used for the "progress to next tier" bar
  widthBlend: 60,      // the slope widens smoothly over this many meters
  widthLead: 95,       // the widening starts this far ahead of the ball (m): beyond what is already on screen

  // ---- speed: heavier = faster ----
  baseSpeed: 18,       // m/s
  sizeSpeed: 6,        // + sizeSpeed * sqrt(r)
  maxSpeed: 45,
  startSpeed: 17,      // run start speed (food within half a second)
  accel: 18,           // m/s²
  decel: 30,
  recoverBoost: 2.2,   // acceleration multiplier right after a hit
  minSpeedFrac: 0.7,   // never slower than this fraction of the target speed (except at a size gate)
  hopMax: 9,           // ramps / mushrooms are short hops: the launch speed is capped (no flying)

  // ---- steering: first-order follower, direct finger control ----
  steerLam: 16,        // follow rate (1/s), divided by (1 + r * steerMassK)
  steerMassK: 0.07,
  steerFilter: 28,     // velocity filter rate (1/s)
  swipeVis: 1.6,       // a full-screen swipe moves the target this many visible widths ...
  swipeTrack: 0.7,     // ... or this fraction of the track width, whichever is larger

  // ---- suction (visible pull-in) ----
  suctionK: 1.6,       // suction radius = r * suctionK + suctionC (x2 with the magnet)
  suctionC: 1,
  pullMin: 0.15,       // flight time of a pulled prop (s)
  pullMax: 0.35,
  maxPulls: 90,        // props in flight at the same time
  pullsPerStep: 8,

  // ---- hunger (continuous melt, volume fraction per second) ----
  melt: [0.027, 0.032, 0.038, 0.045, 0.052, 0.056, 0.06, 0.064],
  meltGrace: [4, 16],  // seconds: no melt before the first, full melt after the second
  heatMelt: 0.2,       // SICAK NOKTA (DAG 6+): extra melt while inside a warm zone
  patchMelt: 0.09,     // extra melt while rolling on bare ground
  dieK: 0.42,          // ERİDİN! when r < max(minR, dieK * peak radius)
  hungerWarn: 0.3,

  // ---- hits ----
  bumpLoss: [0.06, 0.24],  // volume lost bumping into something too big (a hair over the limit → huge obstacle)
  bumpSpeed: 0.5,          // speed factor after a bump
  bumpCd: 0.5,
  chunkGain: 1.0,          // snow scattered by a bump is worth this much when picked up again
  chunkRecover: 0.55,      // fraction of the lost volume that comes back as chunks
  gravity: 24,

  // ---- events (every ~400 m): town jackpot, size gate, golden snowball ----
  firstEvent: 330,
  eventGap: [340, 460],
  gateLoss: 0.14,          // volume lost smashing into a gate that is too big
  gateGap: [230, 280],     // size gates (barriers) come regularly: every ~250 m
  firstGate: 260,
  gateGrow: 0.12,          // volume gained breaking a barrier
  powerT: 3,               // GÜÇLENDİN! seconds (speed + suction + smash anything)
  powerSpeed: 1.22,
  powerSuction: 1.5,
  smashGrow: 0.3,          // fraction of a prop's volume you gain smashing it
  // ---- enemies (HP bars) ----
  enemyGap: [140, 210],    // distance between enemy groups
  firstEnemy: 170,
  bossGap: 800,
  rivalGap: [850, 1250],   // a rival snowball of similar size races you (eat it if you are bigger)
  firstRival: 650,
  firstBoss: 620,
  hpPerR: 24,              // enemy HP = radius * this (times a per-type factor)
  ramDmg: 14,              // ram damage = ball radius * this * speed factor
  goldenTons: 0.35,        // golden snowball: + this fraction of the current snow tons ...
  goldenMinTons: 30,       // ... at least this many tons
  goldenGrow: 0.06,        // ... and this fraction of volume

  // ---- avalanche wave (only when you stall) ----
  waveSlow: 0.55,          // speed below this fraction of the target counts as stalling
  waveT: 3,                // ... for this many seconds → the wave comes
  waveGap: 70,             // it spawns this far behind the ball

  // ---- content: relative food volume per meter (across the whole slope width) and how big the pieces are ----
  // anchors (ball radius, food volume per metre of slope relative to the ball's volume); log-log interpolation, and a
  // decay beyond the last anchor so growth keeps slowing down instead of running away.
  foodAnchors: [[0.5, 0.03], [1.5, 0.0135], [3, 0.0079], [6, 0.0051], [10, 0.0038], [20, 0.0025]],
  foodScale: 1,        // balance knob: multiplies every food budget
  foodTail: -1.2,      // exponent of the decay past the last anchor
  obstacleRate: [1.5, 1.7, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4],            // big obstacles per 100 m after the first 130 m
  viewAheadMax: 1500,

  // ---- pacing: the radius the slope is tuned for at distance d (metres → radius). Growth is throttled when you are
  // far ahead of it and boosted when you lag, so skill shows without breaking the tier timeline (and nobody
  // snowballs to 100 m wide in five minutes). Not applied to snow you scattered and pick up again.
  expectD: [[0, 0.55], [350, 1.5], [1000, 3], [2200, 6], [4000, 10], [7000, 15], [12000, 22], [20000, 32], [40000, 48]],
  bandUp: 2.4,         // gain * (expected / r)^bandUp when r > expected
  bandDown: 0.35,      // gain * (expected / r)^bandDown when r < expected
  bandMin: 0.1,
  bandMax: 1.35,

  // ---- legacy keys (kept so old tooling that reads CFG keeps working) ----
  smashRatio: 1.6,         // props up to this x the ball radius are smashed through; bigger ones deflect you
  milestones: [1.4, 2.6, 4.2, 6.5, 9.5],
  milestoneNames: ['BÜYÜYOR!', 'ÇIĞ!', 'MEGA ÇIĞ!', 'FELAKET!', 'KIYAMET!'],
  expectedR: [0.6, 2.4, 4.4, 7, 9.5],

  // ---- ÇIĞ DAĞLAR (30 finite levels, see cigplan.js): every number is a tuning knob ----
  lvl: {
    gateTol: 0.97,         // a gate breaks at effective size >= minR * gateTol
    amberFrom: 0.85,       // gate/chip turn amber from this fraction of minR ("almost: eat a bit more")
    crackStep: 0.04, crackMax: 3,          // every bounce cracks the gate: its need drops 4 % (3 times)
    bounceLoss: [0.10, 0.28],              // volume fraction lost on a bounce (small miss .. big miss)
    bounceBack: [12, 24],                  // metres the ball is thrown back
    bounceDur: 0.5,
    supplyTo: 0.92, supplyMax: 2,          // the first 2 bounces drop snow chunks up to 0.92 * need
    capK: 1.35,
    feed: 2.6, feedMin: 0.45, feedMax: 1.6, // food potential vs. the plan's growth
    speedK0: 0.92, speedKStep: 0.012,
    surgeT: 1.2, surgeMul: 0.12,           // tier-up speed wave
    stripT: 2.0, stripMul: 1.3, stripRam: 0.12,
    chainWin: 1.6, chainStep: 3, chainMax: 5, chainMelt: 0.5,
    crateYield: 0.045,                     // snow of one crate = this * plan radius^3
    goldMul: 3, ironMul: 1.5,
    smashGrow: 0.5,
    parK: 0.9, lenK: 0.95, finalPad: 36, firstGate: 150, gateExp: 0.92, gatePre: 70,
    bossVolley: [2.4, 3.2], bossHpK: 3.3,
    arenaMelt: 0.6,
    bossArena: true,                       // false: the boss level ends with a plain big gate (0.86 * rEnd)
    chaseNear: 45,                         // chase gap (m) that turns the screen edge red
  },
};

export const TIER_COUNT = CFG.tierWidth.length;

// Food budget (relative volume per metre) for a ball of radius r.
export function foodRelAt(r) {
  const A = CFG.foodAnchors;
  if (r <= A[0][0]) return A[0][1] * CFG.foodScale;
  for (let i = 1; i < A.length; i++) {
    if (r <= A[i][0]) {
      const t = Math.log(r / A[i - 1][0]) / Math.log(A[i][0] / A[i - 1][0]);
      return Math.exp(Math.log(A[i - 1][1]) + t * (Math.log(A[i][1]) - Math.log(A[i - 1][1]))) * CFG.foodScale;
    }
  }
  const last = A[A.length - 1];
  return last[1] * Math.pow(r / last[0], CFG.foodTail) * CFG.foodScale;
}

// Radius the slope expects at distance d (piecewise linear in log radius).
export function expectedRAt(d) {
  const A = CFG.expectD;
  if (d <= 0) return A[0][1];
  for (let i = 1; i < A.length; i++) {
    if (d <= A[i][0]) {
      const t = (d - A[i - 1][0]) / (A[i][0] - A[i - 1][0]);
      return Math.exp(Math.log(A[i - 1][1]) + t * (Math.log(A[i][1]) - Math.log(A[i - 1][1])));
    }
  }
  const a = A[A.length - 1];
  return a[1] * Math.pow(d / a[0], 0.5);
}

// Growth multiplier for a (non-chunk) bite, given the expected radius `exp` there (endless: expectedRAt, levels: the plan).
export function bandRel(exp, r) {
  const k = exp / Math.max(0.2, r);
  return Math.min(CFG.bandMax, Math.max(CFG.bandMin, Math.pow(k, k < 1 ? CFG.bandUp : CFG.bandDown)));
}
export function bandAt(r, d) {
  return bandRel(expectedRAt(d), r);
}

// 0-based tier of a ball radius.
export function tierOf(r) {
  const e = CFG.tierEdges;
  let t = 0;
  while (t < e.length && r >= e[t]) t++;
  return t;
}

// Half width of the slope for a ball of radius r (at least the tier's width, at least ~1/5 of the track for the ball).
export function hwFor(r) {
  return Math.max(CFG.tierWidth[Math.min(tierOf(r), CFG.tierWidth.length - 1)] / 2, 5.2 * r);
}

// Tons per prop (the number-goes-up candy). Unlisted props fall back to a volume estimate (see fallbackMass).
export const MASS = {
  pebble: 0.02, bush_small: 0.01, penguin: 0.03, rabbit: 0.004, gift: 0.005, traffic_cone: 0.004,
  person: 0.08, skier: 0.09, snowman: 0.3, sled: 0.02, bench: 0.06, fence: 0.05, pine_small: 0.15,
  car: 1.4, car_blue: 1.5, snowmobile: 0.4, deer: 0.25, kiosk: 3, pine: 1.2, yeti: 0.6, boulder: 18,
  cabin: 45, bus: 12, lift_pylon: 9, truck: 15, pine_big: 6,
  hotel: 4200, gondola_station: 900, water_tower: 700, rock_big: 1600,
  house: 160, house_tall: 260, shop: 120, apartment: 2400, clocktower: 1300, barn: 140,
  chunk: 0.05,
  k_sedan: 1.3, k_sports: 1.2, k_suv: 2, k_taxi: 1.3, k_police: 1.5, k_van: 2.2, k_ambulance: 3, k_pickup: 1.9, k_tractor: 3.5,
  k_truck: 9, k_delivery: 7, k_garbage_truck: 12, k_firetruck: 14, k_snowman: 0.3, k_snowman_hat: 0.35, k_tent: 0.1, k_canoe: 0.05,
  k_tent_small: 0.06, k_sled: 0.02, k_bench: 0.06, k_campfire: 0.02, k_gingerbread: 0.02, k_planter: 0.2, k_fence: 0.05,
  k_present_a: 0.005, k_present_b: 0.005, k_present_c: 0.005, k_candy_cane: 0.004, k_candy_cane_green: 0.004, k_lantern: 0.01, k_cone: 0.004,
  k_rock_small: 0.3, k_rock_a: 4, k_rock_b: 8, k_rock_c: 3, k_rock_d: 12, k_rock_snow: 6, k_pine_small: 0.15, k_pine_a: 1.2, k_pine_b: 1.2, k_pine_c: 1.2,
  k_tree_small: 0.8, k_tree_large: 3, k_pine_a_big: 6, k_pine_b_big: 6, k_pine_c_big: 6,
};
// Fallback when a prop type is not in MASS: roughly "a fifth of its bounding sphere is solid".
export function fallbackMass(radius) {
  return (4 / 3) * Math.PI * radius ** 3 * 0.2 * 0.45;
}

// Turkish callouts for swallowing notable things.
export const LABEL = {
  w_snowman_mini: 'MİNİ KARDAN ADAM', w_sled_wood: 'KIZAK', w_gift_big: 'HEDİYE KUTUSU', w_noel_tree: 'NOEL AĞACI', w_ice_statue: 'BUZ HEYKELİ',
  w_hut_winter: 'KULÜBE', w_tram: 'TRAMVAY', w_snowman_giant: 'DEV KARDAN ADAM', w_snowman_gold: 'ALTIN KARDAN ADAM',
  w_snow_pile: 'KARTOPU YIĞINI', w_glove: 'ELDİVEN', w_cocoa: 'SICAK ÇİKOLATA', w_penguin_baby: 'PENGUEN YAVRUSU', w_ice_crystal: 'BUZ KRİSTALİ',
  w_candy_cane: 'ŞEKER KAMIŞI', w_ski_set: 'KAYAK SETİ', w_heater: 'ISINMA SOBASI', w_santa_sleigh: 'NOEL BABA KIZAĞI',
  w_ice_castle: 'DEV BUZ KALESİ', w_lift_station: 'TELESİYEJ İSTASYONU', w_hotel_wing: 'KAYAK OTELİ KANADI',
  person: 'İNSAN', skier: 'KAYAKÇI', snowman: 'KARDAN ADAM', penguin: 'PENGUEN', deer: 'GEYİK',
  car: 'ARABA', car_blue: 'ARABA', snowmobile: 'KAR MOTORU', kiosk: 'KULÜBE', yeti: 'YETİ',
  boulder: 'KAYA', cabin: 'DAĞ EVİ', bus: 'OTOBÜS', lift_pylon: 'TELEFERİK DİREĞİ',
  truck: 'KAR KÜREME', pine_big: 'DEV ÇAM', pine: 'ÇAM', hotel: 'OTEL', gondola_station: 'TELEFERİK',
  water_tower: 'SU KULESİ', rock_big: 'KAYALIK', house: 'EV', house_tall: 'EV', shop: 'DÜKKÂN', apartment: 'APARTMAN',
  clocktower: 'SAAT KULESİ', barn: 'AMBAR',
  k_sedan: 'ARABA', k_sports: 'SPOR ARABA', k_suv: 'CİP', k_taxi: 'TAKSİ', k_police: 'POLİS ARABASI', k_van: 'MİNİBÜS',
  k_ambulance: 'AMBULANS', k_pickup: 'KAMYONET', k_tractor: 'TRAKTÖR', k_truck: 'KAMYON', k_delivery: 'KARGO KAMYONU',
  k_garbage_truck: 'ÇÖP KAMYONU', k_firetruck: 'İTFAİYE', k_snowman: 'KARDAN ADAM', k_snowman_hat: 'KARDAN ADAM',
  cp_snowman: 'KARDAN ADAM ORDUSU', k_tent: 'ÇADIR', k_canoe: 'KANO', k_sled: 'KIZAK', k_gingerbread: 'ZENCEFİLLİ ADAM',
  k_pine_a_big: 'DEV ÇAM', k_pine_b_big: 'DEV ÇAM', k_pine_c_big: 'DEV ÇAM',
  k_house_a: 'EV', k_house_b: 'EV', k_house_c: 'EV', k_house_d: 'EV', k_house_e: 'EV', k_house_f: 'EV', k_house_g: 'EV',
  skyscraper: 'GÖKDELEN', stadium: 'STADYUM', castle: 'KALE', ship: 'GEMİ', airplane: 'UÇAK', wind_turbine: 'RÜZGAR TÜRBİNİ', radio_tower: 'RADYO KULESİ', ferris_wheel: 'DEV DOLAP', rocket_pad: 'ROKET',
  k_house_h: 'EV', k_house_i: 'EV', k_house_j: 'EV', k_house_k: 'EV', k_house_l: 'EV',
};
export const TIER_MASS = [0.02, 0.1, 1.5, 20, 1000, 20000, 400000, 8000000];
