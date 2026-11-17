// KARTOPU ARENA chase tuning: pure functions (no THREE / DOM) shared by agar.js and scripts/check-arena.mjs.
export const SPD = 1.265; // +15% then +10% movement speed for every cell (players and bots alike)
export const EAT_K = 1.1; // eat when 10% heavier; closer than that the two balls bump
export const KR = 0.3; // radius = KR * sqrt(mass)
export const MATCH_T = 240; // solo match length (s)
// big balls keep their top speed: above m=150 the slow-down exponent drops from -0.12 to -0.04 (m=1000: 9.4 -> 10.9 m/s)
export const speedFor = (m) => 17 * SPD * (m <= 150 ? Math.pow(m, -0.12) : Math.pow(150, -0.12) * Math.pow(m / 150, -0.04));
/** HIZLAN: a big ball charges longer, harder and more often (m=30: 0.4 s x2.4 / 2.4 s; m>=1500: 0.9 s x3.1 / 1.7 s) */
export const boostFor = (m) => { const k = Math.min(1, m / 1500); return { t: 0.4 + 0.5 * k, mul: 2.4 + 0.7 * k, cd: 2.4 - 0.7 * k }; };
/** suction: a ball that can eat (m > prey * EAT_K) drags prey that is close to its edge toward its centre; the reach and the pull grow with its size.
 *  gap = distance between the two edges. Returns the pull speed (m/s) on the prey, 0 = none. Equal masses, shielded or hidden prey are never pulled. */
export function pullOf(pm, prm, pr, gap, protectedPrey) {
  if (protectedPrey || pm < 60) return 0;
  const k = Math.min(1, Math.max(0, (pm / (prm * EAT_K) - 1) * 2)); // 0 at exactly EAT_K, full at 1.5x heavier
  if (k <= 0) return 0;
  const big = Math.min(1, pm / 1000), reach = pr * (0.3 + 0.5 * big);
  if (gap >= reach) return 0;
  return (4 + 14 * big) * k * (1 - Math.max(0, gap) / reach);
}
export const suckReach = (pm, pr) => pr * (0.3 + 0.5 * Math.min(1, pm / 1000)); // how far outside its edge the pull starts
/** a bot's stamina: fleeing tires it (speed x0.8 after ~6 s), resting recovers it */
export const tireMul = (tire) => 1 - 0.2 * Math.min(1, tire / 6);
/** BUZ ÇEMBERİ in a solo match: starts with RING_AT s left, warns 8 s, shrinks over 12 s to RING_K * R and then holds until the bell */
export const RING_AT = 100, RING_K = 0.3, RING_WARN = 8, RING_SHRINK = 12;
export const ringArea = (R) => Math.PI * Math.pow(R * RING_K, 2) / (Math.PI * R * R); // 0.09 of the arena (was 0.176)
/** PELET YAĞMURU beacon in a match: first one after RAIN_FIRST s, then every RAIN_GAP[0..1] s; it lands RAIN_NEAR[0..1] m from the player so a crowd gathers */
export const RAIN_FIRST = 28, RAIN_GAP = [45, 60], RAIN_NEAR = [160, 320];
