// Pure-logic checks for the hyper-casual lobby: progressive unlocks + the session 1-3 economy model + i18n of the new strings.
// Run: node scripts/check-meta.mjs   (hooked into `npm run check` by package.json, which another lane owns)
import { UNLOCKS, UNLOCK_END, isUnlocked, WELCOME, welcomeGift, DAILY_REWARDS } from '../src/meta.js';
import { SKINS } from '../src/skins.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL ' + name + (extra ? ' ' + extra : '')); } else console.log('ok   ' + name + (extra ? ' ' + extra : '')); };

// ---- unlocks
ok('nothing but OYNA at 0 runs', Object.keys(UNLOCKS).every((k) => !isUnlocked(k, 0)));
ok('every system unlocked once the gate ends', Object.keys(UNLOCKS).every((k) => isUnlocked(k, UNLOCK_END)));
ok('gate ends after the last unlock', UNLOCK_END > Math.max(...Object.values(UNLOCKS)));
ok('shop is the first unlock (the first purchase comes in session 1)', UNLOCKS.shop === 1 && UNLOCKS.daily === 1);
ok('unlocks never un-unlock', Object.keys(UNLOCKS).every((k) => { let was = false; for (let r = 0; r <= 8; r++) { const u = isUnlocked(k, r); if (was && !u) return false; was = u; } return true; }));
ok('unknown id is open', isUnlocked('nope', 0));

// ---- economy model (sessions: 1 = first 5 runs, 2 = day 2, 3 = day 3; ~5 runs each)
const price = (it) => it.price;
const buyable = SKINS.filter((x) => x.price > 0 && !(x.unlock && (x.unlock.stars || x.unlock.secret) || x.unlock && x.unlock.challenge)).sort((a, b) => price(a) - price(b));
const cheapest = buyable[0].price;
const RUN = 20, REC = 50, P_REC = 0.4; // flakes of a ~300 m run; one-off record payout (runner.js RCFG.recCoins); chance a later run is a record
const run1 = RUN + REC;                // the very first run always passes the (empty) record
const later = RUN + REC * P_REC;       // runs 2..5
const gift = welcomeGift(cheapest, run1);
const couponPrice = Math.ceil(cheapest * (1 - WELCOME.couponPct / 100));
let wallet = run1 + gift + WELCOME.ftue;
ok('welcome gift covers the coupon price even from an empty wallet', welcomeGift(cheapest, 0) >= couponPrice, `gift ${welcomeGift(cheapest, 0)} >= ${couponPrice}`);
ok('session 1 first purchase (coupon price) affordable after run 1', wallet >= couponPrice, `wallet ${wallet} vs ${couponPrice}`);
wallet -= couponPrice;
const s1 = wallet + 4 * later;
const second = buyable.find((x) => x.price > cheapest);
ok('session 1 second purchase affordable by run 5 (no daily claimed)', s1 >= second.price, `${Math.round(s1)} vs ${second.price} ${second.id}`);
const s3 = s1 - second.price + 5 * later + DAILY_REWARDS[1].coins + 5 * later + DAILY_REWARDS[2].coins + DAILY_REWARDS[0].coins; // day 1 daily claimed late
const rare = buyable.find((x) => x.rarity === 'rare');
ok('by session 3 a rare ball is affordable', s3 >= rare.price, `${Math.round(s3)} vs ${rare.price} ${rare.id}`);
console.log(`model: run1 ${run1}, later runs ${later}/run, welcome +${WELCOME.ftue} +${gift}, coupon ball ${cheapest} -> ${couponPrice}, wallet after buy 1: ${Math.round(wallet)}, end S1 ${Math.round(s1)}, S3 ${Math.round(s3)}`);

// ---- English entries for the new strings (i18n.js reads navigator.language / localStorage at import)
globalThis.localStorage = { getItem: (k) => (k === 'patpat_lang' ? 'en' : null), setItem() {} };
const { t } = await import('../src/i18n.js');
for (const s of ['Al', '❄️ Al', 'SONRA', 'DOLABA GİT!', 'YENİ AÇILDI!', 'SONRAKİ ▶', 'BUGÜN REKOR! 1.234 m', 'Bugün 640 m · rekora 594 m', '+100 ❄️ hediye!', 'YENİ!', 'İLK KOŞUN!']) {
  ok('en: ' + s, t(s) !== s, '-> ' + t(s));
}
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('check-meta: all ok');
