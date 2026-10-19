// Regression check (node, no browser) for the adaptive-quality governor (src/shaders.js makeGovernor).
// Feeds it synthetic frame times and checks the ladder: pixel ratio steps down one 0.25 at a time to the floor, then the "lite" rung;
// climbs back only after calm windows; ignores stalls; and does not pump up and down on a device that sits right on the edge.
// Usage: node scripts/check-governor.mjs
import { makeGovernor } from '../src/shaders.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };

// run `seconds` of frames at `msAt(g)` ms per frame; returns the list of [t, level, dpr, lite] moves
function run(g, seconds, msAt, t0 = 0) {
  const moves = [];
  for (let t = t0; t < t0 + seconds * 1000;) {
    const ms = msAt(g, t);
    t += ms;
    if (g.tick(ms)) moves.push([+(t / 1000).toFixed(1), g.level, g.dpr, g.lite]);
  }
  return moves;
}

// 1. a device that holds 60 fps never moves
{
  const g = makeGovernor({ dprMax: 2 });
  ok(run(g, 120, () => 16.7).length === 0 && g.level === 0 && g.dpr === 2 && !g.lite, 'steady 60 fps must not move');
}

// 2. a slow device walks down 2 -> 1.75 -> 1.5 -> 1.25 -> 1 -> lite, one rung per 2 s window, and stops at the bottom
{
  const g = makeGovernor({ dprMax: 2 });
  const mv = run(g, 40, () => 30);
  ok(mv.length === 5, `slow device: expected 5 moves, got ${mv.length}`);
  ok(mv.map((m) => m[2]).join() === '1.75,1.5,1.25,1,1', 'slow device: dpr ladder ' + mv.map((m) => m[2]).join());
  ok(g.dpr === 1 && g.lite, 'slow device ends at dpr 1 + lite');
  ok(mv[4][0] <= 11, 'slow device reaches the bottom within ~10 s, got ' + mv[4][0]);
}

// 3. ... and climbs back all the way once it is fast again, never above dprMax, never skipping a rung
{
  const g = makeGovernor({ dprMax: 2 });
  run(g, 40, () => 30);
  const mv = run(g, 200, () => 12, 40000);
  ok(g.level === 0 && g.dpr === 2 && !g.lite, 'recovery: back to full quality, got level ' + g.level);
  ok(mv.every((m, i) => i === 0 || mv[i - 1][1] - m[1] === 1), 'recovery: one rung at a time');
  ok(mv.every((m, i) => i === 0 || m[0] - mv[i - 1][0] >= 5.9), 'recovery: moves are at least the cooldown (6 s) apart');
}

// 4. stalls (tab switch, shader compile) say nothing about steady load
{
  const g = makeGovernor({ dprMax: 2 });
  let n = 0;
  ok(run(g, 60, () => (++n % 20 === 0 ? 400 : 15)).length === 0, 'stalls must be ignored');
}

// 5. the neutral zone (between the two thresholds) neither lowers nor raises
{
  const g = makeGovernor({ dprMax: 2, downMs: 21, upMs: 17.5 });
  ok(run(g, 60, () => 20).length === 0, 'just under the down threshold: no move');
  run(g, 20, () => 30); // push it down a couple of rungs
  const lvl = g.level;
  ok(run(g, 60, () => 19, 20000).length === 0 && g.level === lvl, 'between the thresholds: no climb');
}

// 6. a device on the edge (too slow at the top two rungs, fine below) must settle instead of pumping every few seconds
{
  const g = makeGovernor({ dprMax: 2 });
  const cost = (gg) => (gg.level <= 1 ? 24 : 15);
  const mv = run(g, 300, cost);
  ok(g.level === 2, 'edge device settles on the first good rung, got level ' + g.level);
  const late = mv.filter((m) => m[0] > 150);
  ok(late.length <= 6, `edge device: at most 6 moves in the last 150 s, got ${late.length}`);
  ok(mv.length <= 24, `edge device: at most 24 moves in 300 s, got ${mv.length}`);
}

// 7. a 1x desktop has no dpr rung: the only step is "lite"
{
  const g = makeGovernor({ dprMax: 1 });
  run(g, 20, () => 30);
  ok(g.level === 1 && g.dpr === 1 && g.lite, '1x display: straight to lite');
  run(g, 60, () => 10, 20000);
  ok(g.level === 0 && !g.lite, '1x display: recovers');
}

// 8. odd pixel ratios stay clamped to [1, dprMax]
for (const dprMax of [1.25, 1.5, 1.75, 2.625 > 2 ? 2 : 2.625]) {
  const g = makeGovernor({ dprMax });
  const mv = run(g, 60, () => 30);
  ok(mv.every((m) => m[2] >= 1 && m[2] <= dprMax), `dprMax ${dprMax}: pixel ratio inside [1, dprMax]`);
  ok(g.dpr === 1 && g.lite, `dprMax ${dprMax}: bottoms out at dpr 1 + lite`);
}

console.log(fails ? `${fails} check(s) failed` : 'governor: all checks passed');
process.exit(fails ? 1 : 0);
