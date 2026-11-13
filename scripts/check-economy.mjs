// Economy + meta-loop checks (PLAN_V3 8): GÜÇ price curve (>=1 purchase in session 1, >=3 by session 3, >=6 by session 5), level-gated
// unlocks and their migration, level rewards, KARAKTER shards, run-end bonuses, rewarded gate, English strings of the new UI.
// Run: node scripts/check-economy.mjs   (wired into `npm run check` through check:economy)
import { meta, GUC, UPGRADES, UNLOCK_LV, UNLOCK_LV_MAX, WELCOME, DAILY_REWARDS, levelReward } from '../src/meta.js';
import { platform } from '../src/platform.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL ' + name + (extra ? ' ' + extra : '')); } else console.log('ok   ' + name + (extra ? ' ' + extra : '')); };

// ---- fake wallet + storage (meta.js touches neither document nor real localStorage)
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
const mkSave = () => {
  const owned = new Set(['skin:classic', 'trail:classic']);
  const s = {
    level: 1, coins: 0, totalStars: () => 0, starsFor: () => 0,
    addCoins(n) { s.coins += n; }, spend(n) { if (s.coins < n) return false; s.coins -= n; return true; },
    isOwned: (k, id) => owned.has(k + ':' + id), own(k, id) { owned.add(k + ':' + id); }, selected: () => null, select() {},
  };
  return s;
};

// ---- GÜÇ catalog shape
const ALL = [...UPGRADES.map((u) => ({ id: u.id, costs: u.costs })), ...GUC.map((u) => ({ id: u.id, costs: u.costs }))];
ok('every GÜÇ branch has 5 priced tiers', ALL.every((u) => u.costs.length === 5 && u.costs.every((c, i) => c > 0 && (i === 0 || c > u.costs[i - 1]))));
ok('GÜÇ values are monotonic and capped', GUC.every((u) => u.values.length === 6 && u.values.every((v, i) => i === 0 || v > u.values[i - 1])) && GUC.find((u) => u.id === 'topSize').values[5] <= 0.75 && GUC.find((u) => u.id === 'chest').values[5] <= 0.25);

// ---- 5-session economy, real meta code: 5 runs per session, ~20 flakes per 300 m run, 50 for passing the record (runner RCFG.recCoins)
meta._setRandom(() => 0.5); // deterministic: no chest drop below 50% chance
const RUN = { coins: 20, distance: 300, score: 3000, maxTier: 1 };
const REC = 50, SHARE = 0.5; // only half of the wallet goes to GÜÇ (the rest to balls)
const sv = mkSave();
meta.init(sv);
const bought = [];
let runs = 0;
const lvAt = {}; // first run count at which each level-gated system was open
const checkUnlocks = () => { for (const k of Object.keys(UNLOCK_LV)) if (lvAt[k] === undefined && meta.unlocked(k)) lvAt[k] = runs; };
const buyLoop = () => {
  for (;;) {
    let pick = null;
    for (const u of ALL) { const c = meta.upgradeCost(u.id); if (c !== null && c <= sv.coins * SHARE && (!pick || c < pick.c)) pick = { id: u.id, c }; }
    if (!pick || !meta.buyUpgrade(pick.id)) return;
    bought.push(pick.id);
  }
};
const perSession = [];
for (let s = 1; s <= 5; s++) {
  if (s >= 2 && meta.unlocked('daily')) sv.addCoins(DAILY_REWARDS[s - 1].coins); // the daily reward opens at level 4
  for (let r = 0; r < 5; r++) {
    meta.track('run_start', {});
    runs++;
    sv.addCoins(RUN.coins + (runs === 1 || runs % 5 === 2 || runs % 5 === 4 ? REC : 0)); // run 1 always passes the empty record, later 2 of 5 runs do (P_REC)
    meta.track('endless_end', { ...RUN });
    if (runs === 1) sv.addCoins(WELCOME.ftue); // menus.js ftueFirstRun
    while (meta.claimLevelUp()) { /* level-up screens are tapped */ }
    checkUnlocks();
  }
  buyLoop();
  perSession.push(bought.length);
}
console.log(`model: purchases after session 1..5 = ${perSession.join(', ')}; level ${meta.level}; first open at run ${JSON.stringify(lvAt)}`);
ok('session 1: at least 1 GÜÇ purchase', perSession[0] >= 1, String(perSession[0]));
ok('by session 3: at least 3 purchases', perSession[2] >= 3, String(perSession[2]));
ok('by session 5: at least 6 purchases', perSession[4] >= 6, String(perSession[4]));
ok('purchases do not all come from one branch', new Set(bought).size >= 4, bought.join(','));
ok('economy is not trivial: at most 6 purchases in session 1 and 14 by session 5', perSession[0] <= 6 && perSession[4] <= 14, perSession.join(','));

// ---- level-gated unlocks (new save): Bölümler 2, ÇIĞ 3, Günlük 4, Arena 5, Sezon 6; reachable at a sane pace
ok('unlock levels are 2/3/4/5/6', UNLOCK_LV.map === 2 && UNLOCK_LV.cig === 3 && UNLOCK_LV.daily === 4 && UNLOCK_LV.arena === 5 && UNLOCK_LV.season === 6 && UNLOCK_LV_MAX === 6);
ok('Bölümler open by run 2, ÇIĞ by 4, Günlük by 7, Arena by 10, Sezon by 15', lvAt.map <= 2 && lvAt.cig <= 4 && lvAt.daily <= 7 && lvAt.arena <= 10 && lvAt.season <= 15, JSON.stringify(lvAt));
ok('the first mission set is jump / turn / stomp (never a card mission: cards start in run 3)', (() => { store.clear(); meta.init(mkSave()); const r = meta.missions(); return r.length === 3 && r.map((x) => x.id).sort().join() === 'jump,stomp,turn'; })());
ok('a new save starts with the five systems closed', (() => { store.clear(); meta.init(mkSave()); return Object.keys(UNLOCK_LV).every((k) => !meta.unlocked(k)); })());
ok('any other id is always open', meta.unlocked('shop') === true);

// ---- migration: a save from the run-count era keeps what it had (levels only go up under the new curve)
store.clear();
store.set('freemon.meta.v1', JSON.stringify({ v: 1, xp: 120, st: { runs: 3 }, u: { magnet: 2 } }));
meta.init(mkSave());
ok('old save with 3 runs keeps Bölümler + ÇIĞ', meta.unlocked('map') && meta.unlocked('cig'));
ok('old save with 3 runs does not get Arena (not yet owned in the old table)', !meta.unlocked('arena'));
ok('old save levels never drop and are paid up (no retro reward pile)', meta.level >= 2 && meta.pendingLevelUps().length === 0);
ok('old upgrade levels survive', meta.upgradeLevel('magnet') === 2);
store.clear();
store.set('freemon.meta.v1', JSON.stringify({ v: 1, xp: 9000, st: { runs: 80 } }));
meta.init(mkSave());
ok('veteran has everything open', Object.keys(UNLOCK_LV).every((k) => meta.unlocked(k)));
store.set('freemon.meta.v1', '{not json');
meta.init(mkSave());
ok('corrupt blob falls back to a fresh state', meta.level === 1 && meta.upgradeLevel('topSize') === 0);

// ---- level rewards
store.clear();
const sv2 = mkSave();
meta.init(sv2);
for (let L = 2; L <= 40; L++) { const r = levelReward(L); if (!(r.coins > 0 || r.shard || r.unlock)) ok('level ' + L + ' reward is not empty', false); }
ok('levels 2..6 each introduce their unlock', [2, 3, 4, 5, 6].every((L) => levelReward(L).unlock === Object.keys(UNLOCK_LV).find((k) => UNLOCK_LV[k] === L)));
meta.track('endless_end', { distance: 2000, score: 20000, coins: 100, maxTier: 3 });
const pend = meta.pendingLevelUps().length;
const c0 = sv2.coins;
let paid = 0; while (meta.claimLevelUp()) paid++;
ok('a big run queues level-ups and each is claimable once', pend >= 2 && paid === pend && meta.pendingLevelUps().length === 0, `${pend}/${paid}`);
ok('level-up reward pays', sv2.coins > c0 || meta.charLevel('kofte') >= 1);

// ---- characters: shards -> level 1..5
const ids = ['kofte', 'simit', 'nazar'];
ok('charLevel is 0 for a plain ball and 1 for a fresh KARAKTER', meta.charLevel('classic') === 0 && ids.every((id) => meta.charLevel(id) === 1));
meta.addShards('kofte', 3); ok('3 shards -> level 2', meta.charLevel('kofte') === 2);
meta.addShards('kofte', 5); ok('8 shards -> level 3', meta.charLevel('kofte') === 3);
meta.addShards('kofte', 100); ok('level caps at 5', meta.charLevel('kofte') === 5 && meta.shardInfo('kofte').max);
ok('addShards ignores a plain ball and bad counts', meta.addShards('classic', 5) === 0 && meta.addShards('simit', -2) === 0 && meta.charLevel('simit') === 1);

// ---- GÜÇ effects: values, XP and flake bonus, chest chance
store.clear();
const sv3 = mkSave();
meta.init(sv3);
ok('base values: topSize 0, flakes x1, xp x1, magnet 8 s', meta.upgradeValue('topSize') === 0 && meta.upgradeValue('flakes') === 1 && meta.upgradeValue('xp') === 1 && meta.upgradeValue('magnet') === 8);
sv3.coins = 100000;
for (const id of ['flakes', 'xp', 'topSize', 'topMelt', 'topMagnet', 'chest', 'magnet']) while (meta.upgradeCost(id) !== null) meta.buyUpgrade(id);
ok('maxed values', meta.upgradeValue('flakes') === 1.5 && meta.upgradeValue('topSize') === 0.75 && meta.upgradeValue('topMelt') === 0.3 && meta.upgradeValue('topMagnet') === 1.75 && meta.upgradeValue('magnet') === 20 && meta.upgradeLevel('chest') === 5);
const xp0 = meta.xp, c1 = sv3.coins;
meta._setRandom(() => 0.01);
meta.track('run_start', {});
meta.track('endless_end', { distance: 1000, score: 5000, coins: 100, maxTier: 2 });
const b = meta.runBonus();
ok('flake multiplier x1.5 pays +50 on a 100 flake run', b.coins === 50 && sv3.coins - c1 === 50, JSON.stringify(b));
ok('chest chance can drop a chest', b.chest === 1 && meta.boxes >= 1);
ok('XP multiplier applies to the run', meta.xp - xp0 === Math.round((10 + 1000 / 10 + 100 * 0.5 + 16) * 1.5), String(meta.xp - xp0));
ok('unknown upgrade id is harmless', meta.upgradeValue('nope') === 0 && meta.upgradeCost('nope') === null && meta.buyUpgrade('nope') === false);

// ---- rewarded gate: closed until an SDK is wired
ok('rewardedAvailable() is false without an SDK', platform.rewardedAvailable() === false);
ok('rewarded() resolves false (never rejects)', (await platform.rewarded('revive')) === false);

// ---- chapters (integrator wiring): meta.chapterSeen + chapter_seen event, chapterXp rides the run XP
{
  const sv2 = mkSave(); meta.init(sv2);
  ok('chapterSeen false before the event', meta.chapterSeen('rampa') === false);
  meta.track('chapter_seen', { id: 'rampa' });
  ok('chapterSeen true after chapter_seen', meta.chapterSeen('rampa') === true && meta.chapterSeen('yeti') === false);
  const x0 = meta.xp;
  meta.track('endless_end', { distance: 300, score: 3000, coins: 20, maxTier: 1, crashes: 0, cause: 'melt' });
  const xA = meta.xp - x0, x1 = meta.xp;
  meta.track('endless_end', { distance: 300, score: 3000, coins: 20, maxTier: 1, crashes: 0, cause: 'melt', chapterXp: 40 });
  ok('chapterXp is paid into the run XP', meta.xp - x1 > xA, `${meta.xp - x1} vs ${xA}`);
}

// ---- English strings (real t())
globalThis.localStorage = { getItem: (k) => (k === 'patpat_lang' ? 'en' : null), setItem() {} };
const { t } = await import('../src/i18n.js');
const pairs = [
  ['GÜÇ', 'POWER'], ['TOP', 'BALL'], ['GÜÇLER', 'POWERS'], ['KAZANÇLAR', 'GAINS'], ['Başlangıç Boyu', 'Start Size'], ['Erime Direnci', 'Melt Resistance'],
  ['Mıknatıs Menzili', 'Magnet Range'], ['Kar Çarpanı', 'Snowflake Multiplier'], ['XP Çarpanı', 'XP Multiplier'], ['Sandık Şansı', 'Chest Chance'],
  ['SEVİYE ATLADIN!', 'LEVEL UP!'], ['SEVİYE 7', 'LEVEL 7'], ['MACERA AÇILDI!', 'ADVENTURE UNLOCKED!'], ['SEZON AÇILDI!', 'SEASON UNLOCKED!'],
  ['HEDEF', 'GOAL'], ['Görev seti → ×3', 'Mission set → ×3'], ['MACERA Act 3', 'ADVENTURE Act 3'], ['Kasaba 7', 'Town 7'], ['GÜNÜN KOŞULARI', "TODAY'S RUNS"],
  ['Çam Topu', 'Pine Ball'], ['Balon Topu', 'Balloon Ball'], ['Kiremit', 'Roof Tile'], ['Kaktüs', 'Cactus'], ['Penguen takipçisiyle başla (x1)', 'Start with a penguin follower (x1)'],
  ['🐧 Penguen takipçisiyle başla (x1)', '🐧 Start with a penguin follower (x1)'],
  ['10 sn → 12 sn', '10 s → 12 s'], ['3,5 sn → 4,5 sn', '3.5 s → 4.5 s'], ['20 sn (en yüksek)', '20 s (max)'], ['+5% → +10%', null], ['×1.1 → ×1.2', null], ['+25% (en yüksek)', '+25% (max)'],
  ['+0.15 kademe', '+0.15 tier'], ['-6%', null], ['★ Sv 2/5 · 🧩 3/8', '★ Lv 2/5 · 🧩 3/8'], ['★ Sv 5/5 · MAKS', '★ Lv 5/5 · MAX'], ['🧩 +1 parça', '🧩 +1 shard'], ['🧩 +2 parça', '🧩 +2 shards'],
  ['❄️ 200  👕 Kaktüs', '❄️ 200  👕 Cactus'], ['Ödül: ❄️ 150  👕 Çam Topu', 'Reward: ❄️ 150  👕 Pine Ball'], ['SET ÖDÜLÜ: 💎 2  ✨ Neon Mavi', null],
  ['Ödül: ❄️ 200 · seri 3/7', 'Reward: ❄️ 200 · streak 3/7'], ['REKORA 12 m', 'TO RECORD'], ['REKOR 1.200', 'RECORD 1.200'],
  ['DAĞ 37 · Şimşek Geçidi', 'MOUNTAIN 37 · Lightning Pass'], ['👕 SIRADAKİ HEDEF: Gün Batımı', '👕 NEXT GOAL: Sunset'], ['Yeni damga: Aç Top!', 'New stamp: Hungry Ball!'], ['Bölüm 1 · ⭐ 0/300', 'Stage 1 · ⭐ 0/300'],
  ['👕 Ahtapot: 65 ❄️ kaldı', '👕 Octopus: 65 ❄️ left'], ['💎 Kristal: devam etmek için (her seferinde 2 katı). Şu an: 1', '💎 Crystals: to continue (cost doubles each time). You have: 1'], ['KIZAK · 🛷 0', 'SLED · 🛷 0'], ["YETİ'DEN KAÇ!", 'RUN FROM THE YETI!'], ['🏘️ Yuvarlan, yut, büyü!', '🏘️ Roll, eat, grow!'], ['Kasabayı ezmek için 2.6 m ol', 'Grow to 2.6 m to crush the town'],
  ['+664 ESKİ REKORDAN', '+664 vs old record'], ['sende', 'you have'], ['EZME SERİSİ', 'SMASH STREAK'], ['ÇARPAN x3', 'MULTIPLIER x3'],
  ['BEDAVA SANDIK', 'FREE CHEST'], ['↔ ↑ ↓ KAYDIR', '↔ ↑ ↓ SWIPE'], ['KAR KANONU ×5', 'SNOW CANNON ×5'], ['❄ ACT TAMAM! SANDIK: ❄️ 200', '❄ ACT COMPLETE! CHEST: ❄️ 200'], ['EK ÇEVİRME', 'EXTRA SPIN'], ['Günün Dağı', "Today's Mountain"],
];
const bad = pairs.filter(([tr, en]) => { const r = t(tr); return en === null ? false : (en.length < 12 && ['TO RECORD', 'BEST'].includes(en)) ? !r.includes(en) : r !== en; }).map(([tr, en]) => tr + ' => ' + t(tr) + ' (want ' + en + ')');
ok('new UI strings have English entries and are not swallowed by catch-alls', bad.length === 0, JSON.stringify(bad));

if (fails) { console.log(`\n${fails} check(s) failed`); process.exit(1); }
console.log('\nall economy checks passed');
