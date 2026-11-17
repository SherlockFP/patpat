// Asserts for the KARTOPU ARENA network validators (src/agar/validate.js): hostile / malformed messages must be rejected or neutralised.
import assert from 'node:assert/strict';
import { LIM, QUICK_CHAT, cleanName, cleanText, vHello, vHostMsg, vClientMsg, vPresence } from '../src/agar/validate.js';

// names
assert.equal(cleanName('<img src=x onerror=1>'), 'img src=x on');
assert.equal(cleanName('a‮b\u0000c'), 'a b c');
assert.equal(cleanName('x'.repeat(500)).length, 12);
assert.equal(cleanName(null), 'Yeti');
assert.equal(cleanName({}), 'Yeti');
assert.match(cleanName('orospu'), /^\*+$/);
assert.equal(cleanName('f_u_c_k'), '******'); // separators are ignored by the filter
assert.equal(cleanName('Basik'), 'Basik'); // short bad words match whole tokens only
assert.equal(cleanText('hi\n\tthere', 80), 'hi there');

// hello
assert.equal(vHello(null, 5), null);
assert.equal(vHello({ t: 'x' }, 5), null);
assert.equal(vHello({ t: 'hello', v: 5, nick: 'Ali', sk: 'a b', tr: 7 }, 5).sk, 'classic');
assert.equal(vHello({ t: 'hello', v: 4, nick: 'Ali' }, 5).ok, false);

// host input: direction is clamped to a unit vector, junk is dropped
assert.equal(vHostMsg({ t: 'i', x: NaN, z: 0, m: 1 }), null);
assert.equal(vHostMsg({ t: 'i', x: Infinity, z: 0, m: 1 }), null);
assert.equal(vHostMsg({ t: 'i', x: '1', z: 0, m: 1 }), null);
const mv = vHostMsg({ t: 'i', x: 40, z: 30, m: 9 });
assert.ok(Math.hypot(mv.x, mv.z) <= 1.000001 && mv.m === 1); // speed hack attempt neutralised
assert.equal(vHostMsg({ t: 'chat', x: '<script>' }), null); // free text is gone
assert.equal(vHostMsg({ t: 'chat', q: 99 }), null);
assert.equal(vHostMsg({ t: 'chat', q: 1 }).x, QUICK_CHAT[1]);
assert.equal(vHostMsg({ t: 'evil' }), null);

// snapshot
const snap = () => ({
  t: 's', hn: 2, pn: 40, pd: [], st: [0, 0, 0], pr: [0, 0, 0], wo: [0, 0], du: 0, bs: 0, zn: [0, 0, 0, 1100, 500, 0], fk: [-1, 0, -1, 0, -1, 0], hd: [],
  c: [0, 1, 10, 10, 24], fd: [5, 100, 100, 1, 0xff0000], v: new Array(LIM.NVIR * 2).fill(0), p: Array.from({ length: LIM.NPUP * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0)), me: [0, 0, 0, 0, 0, 0, 0],
});
const st = { started: true };
assert.ok(vClientMsg(snap(), st));
assert.ok(!vClientMsg(snap(), { started: false })); // snapshot before start
const bad = (f) => { const m = snap(); f(m); return vClientMsg(m, st); };
assert.ok(!bad((m) => { m.c[2] = NaN; }));
assert.ok(!bad((m) => { m.c[4] = 1e9; }));
assert.ok(!bad((m) => { m.c[0] = LIM.CAP; })); // cell index out of range
assert.ok(!bad((m) => { m.c.push(1); })); // not a multiple of 5
assert.ok(!bad((m) => { m.c = new Array(LIM.CAP * 5 + 5).fill(0); })); // array too long
assert.ok(!bad((m) => { m.fd[0] = -1; }));
assert.ok(!bad((m) => { m.fd[4] = 'red'; }));
assert.ok(!bad((m) => { m.v.length = 3; }));
assert.ok(!bad((m) => { m.p[2] = 9; })); // pickup type out of range
assert.ok(!bad((m) => { m.pd = new Array(9000).fill(1); }));
assert.ok(!bad((m) => { m.me = [1, 2]; }));
assert.ok(!bad((m) => { delete m.zn; }));
assert.ok(!bad((m) => { m.fk[0] = 99; }));

// start
const start = () => ({ t: 'start', me: 1, seed: 123, owners: Array.from({ length: LIM.NOWN }, () => ['<b>x</b>', 0xffffff, 1, 'classic', 'classic']), food: new Array(LIM.FOOD * 2).fill(0), fc: [], pd: [] });
const sm = start();
assert.ok(vClientMsg(sm, { started: false }));
assert.ok(!/[<>]/.test(sm.owners[0][0]));
assert.ok(!vClientMsg(start(), { started: true })); // second start ignored
assert.ok(!vClientMsg(Object.assign(start(), { me: 99 }), { started: false }));
assert.ok(!vClientMsg(Object.assign(start(), { food: [1, 2, 3] }), { started: false }));
assert.ok(!vClientMsg(Object.assign(start(), { seed: NaN }), { started: false }));

// misc host messages
assert.ok(!vClientMsg({ t: 'sfx', k: '../../x' }, st));
assert.ok(vClientMsg({ t: 'sfx', k: 'pop', v: 99 }, st));
const ch = { t: 'chat', n: '<i>bob</i>', c: 0xff, x: 'hi\u0000<b>' };
assert.ok(vClientMsg(ch, st)); assert.ok(!/[<>\u0000]/.test(ch.n + ch.x));
assert.ok(!vClientMsg({ t: 'chat', n: 'a', c: 'red', x: 'a' }, st));
assert.ok(!vClientMsg({ t: 'own', i: 52, n: 'a', c: 1 }, st));
assert.ok(!vClientMsg({ t: 'av', a: NaN, o: 0 }, st));
assert.ok(!vClientMsg({ t: 'nope' }, st));
assert.ok(!vClientMsg('str', st));
const lobby = { t: 'lobby', list: ['a', '<x>', 3, null] };
assert.ok(vClientMsg(lobby, st)); assert.equal(lobby.list.length, 4);
assert.ok(!vClientMsg({ t: 'lobby', list: new Array(50).fill('a') }, st));

// presence
assert.equal(vPresence({ code: 'abc' }), null);
assert.equal(vPresence({ code: '0OIL1' }), null);
assert.equal(vPresence({ code: 'ABCDE', host: 'x'.repeat(100), n: 1e9, max: 1e9, v: 5 }).n, 1);
assert.equal(vPresence({ code: 'ABCDE', host: 'x'.repeat(100), n: 3, v: 5 }).host.length, 12);
assert.equal(vPresence({ code: 'ABCDE', gone: 1 }).gone, true);

// ?net=local: parsed from the query string only
import { isNetLocal, pickRival } from '../src/agar/proto.js';
assert.equal(isNetLocal('?net=local'), true);
assert.equal(isNetLocal('?a=1&net=local'), true);
assert.equal(isNetLocal('?net=public'), false);
assert.equal(isNetLocal(''), false);
assert.equal(isNetLocal(null), false);

// rival: nearest bot that is >= 1.15x the player; else the heaviest bot; never the player, the dead, humans, boss, hidden or tiny ones
const ow = (m, x = {}) => Object.assign({ alive: true, away: false, boss: false, human: null, hideT: 0, mass: m }, x);
const field = [ow(0), ow(30), ow(90), ow(40), ow(500, { boss: true }), ow(60, { alive: false }), ow(70, { human: 'p' }), ow(80, { hideT: 1 }), ow(10)];
assert.equal(pickRival(field, 0, 24), 1); // 30 is the nearest bot at least 1.15x of 24
field[1].mass = 25; // 25 < 27.6 -> not heavy enough, 40 stays
assert.equal(pickRival(field, 0, 24), 3);
assert.equal(pickRival(field, 0, 500), 2); // nobody heavier: the heaviest eligible bot
assert.equal(pickRival([ow(0), ow(5)], 0, 24), -1); // nobody eligible
assert.equal(pickRival(field, 3, 24), 2); // the player's own slot (3) is never picked: 90 is next

// ---- chase model (src/agar/chase.js: the pure rules agar.js uses): once you are big it must be possible to eat people
import { speedFor, boostFor, pullOf, suckReach, tireMul, KR, MATCH_T, RING_AT, RING_K, RING_WARN, RING_SHRINK, ringArea, RAIN_FIRST, RAIN_GAP, RAIN_NEAR } from '../src/agar/chase.js';
const OLD = { sp: (m) => 17 * 1.265 * Math.pow(m, -0.12), bf: () => ({ t: 0.4, mul: 2.4, cd: 2.4 }), pb: 0.5, bcd: 1, react: 0, tire: 0, pull: 0 };
const NEW = { sp: speedFor, bf: boostFor, pb: 0.18, bcd: 1.5, react: 1, tire: 1, pull: 1 };
/** 1-D chase: hunter (mass pm) charges whenever HIZLAN is ready; the prey (mass qm) flees at its speed, reacts late, tires and counter-boosts. Returns 'caught within 3 charges'. */
function chase(cfg, seed, pm, qm, preyCounters = cfg.pb) {
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pr = KR * Math.sqrt(pm), rr = KR * Math.sqrt(qm), dt = 0.05;
  let gap = 15 + rnd() * 27; const react = cfg.react ? 0.35 + rnd() * 0.35 : 0; // bots notice the threat at 14 + 2.5 r + 1.5 R ~ 42 m
  let pB = 1, pT = 0, pCd = 0, charges = 0, bT = 0, bM = 2.4, bCd = 0, tire = 0, tick = 0;
  for (let t = 0; t < 25; t += dt) {
    if (pCd > 0) pCd -= dt; if (bCd > 0) bCd -= dt;
    let vp = cfg.sp(pm);
    if (pT > 0) { pT -= dt; vp *= pB; } else if (pCd <= 0 && gap < 32) { const b = cfg.bf(pm); pT = b.t; pB = b.mul; pCd = b.cd; if (++charges > 3) return false; }
    let vb = 0;
    if (t > react) {
      vb = cfg.sp(qm) * (cfg.tire ? tireMul(tire) : 1); tire += dt; tick += dt;
      if (tick >= 0.23) { tick = 0; if (gap < rr * 1.5 + 4 && bCd <= 0 && rnd() < preyCounters) { const q = cfg.bf(qm); bT = q.t; bM = q.mul; bCd = q.cd * cfg.bcd; } }
      if (bT > 0) { bT -= dt; vb *= bM; }
    }
    gap += (vb - vp) * dt;
    if (cfg.pull) gap -= pullOf(pm, qm, pr, gap, false) * dt;
    if (gap <= -rr * 1.25) return true; // eat distance: centre inside r_hunter - 0.25 r_prey
  }
  return false;
}
const rate = (cfg, pm, qm, pc) => { let ok = 0; for (let i = 0; i < 400; i++) if (chase(cfg, i * 7919 + 13, pm, qm, pc)) ok++; return ok / 400; };
assert.ok(speedFor(1000) > 10.5 && speedFor(1000) > OLD.sp(1000) * 1.1, 'big balls keep top speed: ' + speedFor(1000));
assert.equal(speedFor(100), OLD.sp(100)); // small balls unchanged
assert.ok(Math.abs(speedFor(150) - OLD.sp(150)) < 1e-9 && speedFor(151) < speedFor(150)); // continuous at 150
const before = rate(OLD, 1000, 360), after = rate(NEW, 1000, 360); // 360 = 0.6 R of a 1000 ball
console.log('check-arena: m=1000 vs 0.6R fleeing bot, caught within 3 charges: before ' + Math.round(before * 100) + '%, after ' + Math.round(after * 100) + '%');
assert.ok(after >= 0.6 && before < 0.2, 'big ball must catch a fleeing bot: ' + before + ' -> ' + after);
assert.ok(rate(NEW, 100, 36) < rate(NEW, 1000, 360), 'catching is easier the bigger you are');
assert.ok(boostFor(1000).t > boostFor(30).t && boostFor(1000).mul > boostFor(30).mul && boostFor(1000).cd < boostFor(30).cd);
// the player can still lose to a bigger hunter: a 1000 ball fleeing (human-like counter-boosts) from a 1600 hunter is caught
const lose = rate(NEW, 1600, 1000, 0.5); assert.ok(lose > 0.1, 'a bigger hunter can still catch you: ' + lose);
// suction: equal masses (and anything within EAT_K) never pulled, shielded / hidden prey never pulled, bigger => longer reach, never at zero gap for small
for (const m of [60, 150, 400, 1000, 5000]) { assert.equal(pullOf(m, m, KR * Math.sqrt(m), 0, false), 0); assert.equal(pullOf(m * 1.1, m, KR * Math.sqrt(m), 0, false), 0); assert.ok(pullOf(m * 2, m, KR * Math.sqrt(m * 2), 0, false) > 0 || m * 2 < 60); assert.equal(pullOf(m * 3, m, KR * Math.sqrt(m * 3), 0, true), 0); }
assert.equal(pullOf(50, 10, 2, 0, false), 0); // tiny balls do not vacuum
assert.ok(suckReach(1000, 9.5) > suckReach(100, 3) && suckReach(1000, 9.5) > 5);
assert.equal(pullOf(1000, 300, 9.5, suckReach(1000, 9.5) + 0.1, false), 0); // outside the reach: nothing
// ring: tighter (0.09 of the arena, was 0.176), earlier (100 s before the bell, was 60) and it holds long enough to force fights
assert.ok(ringArea(1100) <= 0.1 && RING_K === 0.3 && RING_AT >= 90 && RING_AT <= MATCH_T / 2);
assert.ok(MATCH_T - RING_AT >= 120 && RING_AT - RING_WARN - RING_SHRINK >= 60, 'ring holds >= 60 s at full squeeze');
// snow-rain beacon: first one early, then a steady beat, and it lands close to the player
assert.ok(RAIN_FIRST <= 30 && RAIN_GAP[1] <= 60 && RAIN_GAP[0] >= 40 && RAIN_NEAR[1] <= 350 && RAIN_NEAR[0] >= 100);

// English: patterns that used to be shadowed by the generic 'x: y' trash-talk pattern must translate
globalThis.localStorage = { getItem: () => 'en', setItem() {} };
const { t } = await import('../src/i18n.js');
assert.equal(t('Büyü, yut, hayatta kal! Rekor kütle: 1.2k · Seviye 3'), 'Grow, swallow, survive! Best mass: 1.2k · Level 3');
assert.equal(t('Kod: ABCDE'), 'Code: ABCDE');
assert.equal(t('ODADASIN: ABCDE'), "YOU'RE IN THE ROOM: ABCDE");
assert.equal(t('RAKİP: Mert'), 'RIVAL: Mert');
assert.equal(t('SON 1 DAKİKA! Çember daralıyor'), 'LAST MINUTE! The ring is closing in');
assert.equal(t('Mert: selam'), 'Mert: hi'); // trash talk still works (last pattern)
assert.equal(t('YUTTUN: Mert'), 'SWALLOWED: Mert'); assert.equal(t('Kara Delik 2/3'), 'Black Hole 2/3');
for (const k of ['BUZ ÇEMBERİ! Dövüş zamanı', 'TAHTA OTURDUN ♛', 'Herkes seni avlıyor', 'Tahtı kaybettin ♛', 'TOPARLANMA: yem +%35, hız +%5', 'KÜRSÜ ÖDÜLÜ', '✔ Kara Delik açıldı', 'Kürsü Kralı']) assert.notEqual(t(k), k, k);
for (const k of ['▶ OYNA', '🌐 ÇEVRİMİÇİ', 'ANLADIM', 'ODA SAHİBİ AYRILDI', '🤖 BOTLARLA DEVAM', 'Botlarla devam ediyorsun', '5 haneli kodu gir.', 'RAKİBİNİ YUTTUN! +bonus', 'Oda kapandı. Botlarla devam edebilirsin.',
  'Çevrimiçi odalarda başka oyuncularla karşılaşırsın. İsimler filtrelenir, sohbet yalnızca hazır cümlelerle yapılır.']) assert.notEqual(t(k), k, k);
// HUD rank line: every title and tier name must translate on its own (the joined 'title · tier' string has no entry)
for (const k of ['Çömez', 'Kar Tanesi', 'Kartopu', 'Dev Kartopu', 'Çığ', 'Buzul', 'Kış Kralı', 'Efsane Yeti', 'Kartopu Tanrısı', 'KARTOPU', 'ÇIĞ', 'MEGA ÇIĞ', 'FELAKET', 'KIYAMET', 'ŞEHİR YUTUCU', 'DAĞ DEVİ', 'GEZEGEN',
  'Sürükle: yön · küçüğü ye, büyükten kaç', '❄ Buz dikeni büyükleri böler', 'KORUMA']) assert.notEqual(t(k), k, k);
assert.equal(t('Çömez'), 'Rookie');
assert.equal(t('Sv 3'), 'Lv 3');
assert.equal(t('ELENDİN'), 'ELIMINATED'); assert.equal(t('durum'), 'status'); assert.equal(t('Süre dolmadan elendin.'), 'You were eliminated before time ran out.');
assert.equal(t("4 dakikada ilk 3'e gir!"), 'Reach the top 3 in 4 minutes!');
console.log('check-arena: ok');
