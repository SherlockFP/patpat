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

// English: patterns that used to be shadowed by the generic 'x: y' trash-talk pattern must translate
globalThis.localStorage = { getItem: () => 'en', setItem() {} };
const { t } = await import('../src/i18n.js');
assert.equal(t('Büyü, yut, hayatta kal! Rekor kütle: 1.2k · Seviye 3'), 'Grow, swallow, survive! Best mass: 1.2k · Level 3');
assert.equal(t('Kod: ABCDE'), 'Code: ABCDE');
assert.equal(t('ODADASIN: ABCDE'), "YOU'RE IN THE ROOM: ABCDE");
assert.equal(t('RAKİP: Mert'), 'RIVAL: Mert');
assert.equal(t('SON 1 DAKİKA! Çember daralıyor'), 'LAST MINUTE! The ring is closing in');
assert.equal(t('Mert: selam'), 'Mert: hi'); // trash talk still works (last pattern)
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
