// biomes.js — the world OUTSIDE the track for the endless "SONSUZ PARKUR" mode.
//
// The ball runs DOWNHILL on a ski-run carved along a mountain ridge (Temple-Run style). Everything around the track is
// ours: sky dome, sun/moon, stars, fog + light colours, MOUNTAIN FLANKS (terrain that falls away from both track edges,
// a snow bank where the track has a curb, a sheer cliff where it has none), the valley floor far below, scenery chunks,
// clouds, ambient particles, biome blending and beat pulses. 14 biomes of 600 m cycle forever (BIOME_LENGTH): snow, forest, greenhill, kapadokya, town, desert, icecave, candy, sakura,
// istanbul, neon, moon, pirate, volcano. setBiomeOverride(id) locks the world to one of them (campaign levels).
//
// Contracts (see RUNNER.md):
//   biomeAt(s) -> { biome, index, t, next }     trackPalette(s) -> { tileA, tileB, edge, rail, glow, under }
//   musicStyleAt(s) -> id   biomeMods(s) -> { gravity, grip, fog, wind }   setBiomeOverride(idOrNull)
//   new Environment(scene, track, opts?) ; update(dt, camera, ball, beat) ; dispose()
//   junctionOkAt(s) -> bool (false in the ice cave: no Temple Run corner there)
//   env.fogPress (0..1) and env.ballVs (m/s) are written by the runner every frame; update() writes scene.fog (colour from the biome look, near / far =
//   biome x blizzard modifier x fogPress, far >= max(70, 2 * ballVs)). Per-biome roadside extras: stump / logs, seal / stalag, fence / bench / lampost,
//   skullrock, fire, jellycube, robot.
//
// Look per biome = sky + fog + key (sun) / fill (hemisphere) lights + colour grade (b.grade: saturation, contrast, vignette, shadow / highlight tint, ball rim
// colour; applied by the display-space finish in shaders.js cigFinish). The look blends across portals like the fog does; the sky dome, valley floor and glow decor
// use patchTail, the lit materials get the same finish from the runner's patchScene.
//
// Track API used: frame(s, out) [+ optional halfWidth(s) and edgeAt(s): 0 = cliff / gap, > 0 = curb with a snow bank].
// Only called for s in [max(0, ball.s - 55), ball.s + 315], so it is safe with ensure(ball.s + 320) / trim(ball.s - 60).
//
// Terrain model: height(x,z) = edgeY(s*) + drop(distance to the path edge), s* = nearest path parameter, lowered to the
// LOWEST pass where the path overlaps itself in plan (helix, loop, corkscrew), so nothing is ever above any track surface.
// The flank ribbons, the valley floor plane and every scenery item sample the SAME function, so things sit on the ground.
//
// Budgets (measured with the real track.js, 4 km runs, 6 seeds): 10-22 draw calls (limit 25), <= 63k triangles (limit 80k),
// ~0.4 ms CPU per steady update (chunk builds ~2 ms every 50 m), no per-frame allocations (a chunk build allocates a few
// small temporaries), scenery deterministic per s.
//
// Corridor rule: nothing solid within 12 m (plan) of the centre line rises above the track surface: scenery, trees, clouds
// and terrain stay >= 3 m below it (clouds / floating rocks may also hover >= 34 m above). It holds for paths that overlap
// themselves in plan (helix, loop, corkscrew) and for banked turns: terrain hangs from the LOWEST pass of the path, and when
// a lower pass becomes known (always 150-300 m ahead, inside the fog) the affected terrain is rebuilt (2 chunks per frame)
// and decor left hovering is lowered; scenery that would intrude on a stretch of path discovered later is switched off.
//
// Track palette extras: greenhill sets checker: true + checkerA / checkerB (brown / orange) for the track's bank sides.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { nearFade } from './nearfade.js';
import { buildPropLibrary } from '../props.js';
import { makeRng } from '../rng.js';
import { SU, patchTail, setLookActive } from '../shaders.js';

// ---------------------------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------------------------
export const BIOME_LENGTH = 600;
const CH = 50;            // scenery chunk length (m of path)
const AHEAD = 300;        // scenery is generated while chunk end <= ball.s + AHEAD
const BEHIND = 70;        // chunks whose end is more than this behind the ball are recycled
const SP = 5;             // path sample spacing (m): corridor tests, terrain, flank cross-sections (CH / SP = 10)
const NS = 2048;          // path sample ring size (10 km)
const BLEND = 1.5;        // seconds to blend sky/fog/lights between biomes
const CLEAR = 12;         // corridor half width
const CLEAR_PAD = 1.5;    // safety pad on top of CLEAR (path sampling error)
const BELOW = 3.0;        // solids within the corridor must have their top this far below the track surface ...
const ABOVE = 34;         // ... or their bottom this far above it (30, plus a pad for slopes between samples)
const CLOUD_BELOW = 9;    // clouds are kept at least this far below the surface when over the track
const NSLOT = 12;         // flank mesh slots (one per live scenery chunk)
const NSEC = CH / SP + 1; // cross-sections per chunk (both ends included)
const NP = 11;            // vertices per flank cross-section (profile points)
const CEIL_SEC = 16;       // quads across the arch per section
const CEIL_ICI = 10;      // icicles per chunk
const CEIL_B = [10.5, 10.6, 10.3, 9.8, 8.8, 7.4, 4.5, 0.0]; // ice cave arch: lateral distance beyond the track edge ...
const CEIL_H = [0, 1.5, 5.0, 8.0, 10.0, 12.2, 13.6, 14.4, 14.8]; // ... and height above the higher track edge, per profile point (8 = crown)
const WCOLS = 28;         // checkerboard bank wall: cells along a 50 m chunk (1.79 m each)
const WROWS = 10;         // ... and rows down the slope (1.8 m of surface each)
const WARC = 1.8;         // arc length of one wall row (m)
const WMAXCH = 10;        // wall / ceiling capacity in chunks
const MS = 6;             // floats of per-instance meta: x, z, footprint, bottom, top, offset above the terrain
const OVL_R = 48;         // a path stretch passing within this plan distance of another (non-adjacent) one overlaps it
const OVL_J = 80;         // ... searched this many samples either way (400 m)
const MAXT = 80;          // max distinct decor types (lazily created, one InstancedMesh each; only the ones with live instances draw)
const GN = 36;            // ground grid cells per side
const CELL = 20;          // ground cell size (m)  -> +-360 m
const GRID_P = 10;        // neon grid line spacing (m)
const GRID_LIFT = 0.7;
const NCLOUD = 44;
const NPART = 520;
const NSTAR = 380;
const DISC_F = 0.3;       // sun disc radius as a fraction of the sprite half size

// ---------------------------------------------------------------------------------------------
// tiny utils
// ---------------------------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

/** Integer lattice hash -> [0,1). */
function ihash(x, y, z = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in [0,1). */
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = ihash(xi, yi), b = ihash(xi + 1, yi), c = ihash(xi, yi + 1), d = ihash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Campaign levels are locked to one biome: setBiomeOverride(id) makes every s map to that biome (no portals).
let OVR = -1, OVR_VER = 0;
const biomeIdx = (s) => (OVR >= 0 ? OVR : s > 0 ? Math.floor(s / BIOME_LENGTH) : 0);

// ---------------------------------------------------------------------------------------------
// biome definitions (plain data; hex colours)
//   light/disc azimuths are relative to the (smoothed) path heading: 0 = ahead, PI = behind, + = to the right.
// ---------------------------------------------------------------------------------------------
export const BIOMES = [
  {
    id: 'snow', name: 'Karlı Zirve', music: 'snow', depth: 56, flank: { U: 120, e: 1.6, top: 0xffffff, mid: 0xa9c6e8, rock: 0x7f8898, rockAmt: 0.9 },
    sky: { top: 0x1f6fe0, mid: 0x6bb6f2, horizon: 0xf2e6d4 },
    fog: { color: 0xcfe2f4, near: 70, far: 330 },
    hemi: { sky: 0xc8e0ff, ground: 0x86a2d6, intensity: 1.51 },
    sun: { color: 0xffe2b0, intensity: 2.26, az: 2.3, el: 0.88 },
    disc: { color: 0xfff6dc, size: 0.055, az: 0.32, el: 0.62, kind: 'sun' },
    ground: [0xe6f0fb, 0xaec9ea, 0xf8fbff],
    track: { tileA: 0xf4f9ff, tileB: 0x84c0ec, edge: 0x4f9ccc, rail: 0x7cc0e8, glow: 0x8fe1ff, under: 0x5d8fb5 },
    clouds: 0xffffff, stars: 0, grid: 0,
    pulse: { sky: 0.035, glow: 0, grid: 0, spark: 0.25, lava: 0 }, glowBase: 1,
    particles: {
      n: 280, size: 0.3, alpha: 0.6, add: false, twinkle: false,
      groups: [{ f: 1, pal: [0xffffff, 0xeaf4ff], v: [0.8, -3.0, 0.4], j: [1.4, 0.9, 1.4] }],
    },
  },
  {
    id: 'forest', name: 'Çam Ormanı', music: 'forest', depth: 54, flank: { U: 100, e: 1.7, top: 0x7cc95a, mid: 0x3f8a3a, rock: 0x8a7658, rockAmt: 0.6 },
    sky: { top: 0x4a9be0, mid: 0xa2d3ee, horizon: 0xf3efd0 },
    fog: { color: 0xe6efd0, near: 65, far: 320 },
    hemi: { sky: 0xdfeeff, ground: 0x8fae78, intensity: 1.51 },
    sun: { color: 0xffe0a8, intensity: 2.15, az: 2.4, el: 0.73 },
    disc: { color: 0xfff0c0, size: 0.06, az: 0.28, el: 0.5, kind: 'sun' },
    ground: [0x4d9a3a, 0x5fae45, 0x3e7f33],
    track: { tileA: 0xf0e6c8, tileB: 0x9cc673, edge: 0x5a8f3f, rail: 0x7a5a38, glow: 0xbfff8a, under: 0x3d5a2c },
    clouds: 0xfffbea, stars: 0, grid: 0,
    pulse: { sky: 0.035, glow: 0, grid: 0, spark: 0.2, lava: 0 }, glowBase: 1,
    particles: {
      n: 150, size: 0.75, alpha: 0.95, add: false, twinkle: false,
      groups: [{ f: 1, pal: [0x9bd14a, 0xe8a23a, 0xc4552b, 0x6fb34a], v: [1.4, -1.3, 0.5], j: [1.6, 0.7, 1.6] }],
    },
  },
  {
    id: 'greenhill', name: 'Yeşil Tepe', music: 'town', depth: 54,
    flank: { U: 62, e: 1.6, top: 0x4fd12e, mid: 0xb5702e, rock: 0x8a5428, rockAmt: 0.35, kind: 'checker', checkerA: 0x8a5428, checkerB: 0xe0983f },
    sky: { top: 0x0f9df5, mid: 0x55cfff, horizon: 0xcdf3ff },
    fog: { color: 0xcdf3ff, near: 75, far: 330 },
    hemi: { sky: 0xe2f2ff, ground: 0xbfe39a, intensity: 1.73 },
    sun: { color: 0xfff2c8, intensity: 2.28, az: 2.3, el: 0.88 },
    disc: { color: 0xfffbd0, size: 0.055, az: 0.3, el: 0.62, kind: 'sun' },
    ground: [0x3fcf2a, 0x58dd34, 0x2eb824],
    // checker: true -> the track draws its bank sides as a checkerboard of checkerA / checkerB (brown / orange)
    track: { tileA: 0x6ad63c, tileB: 0x55c22f, edge: 0xf4ffd2, rail: 0x8a5428, glow: 0xfff27a, under: 0x7a4a24, checker: true, checkerA: 0x8a5428, checkerB: 0xe0983f },
    clouds: 0xffffff, stars: 0, grid: 0,
    pulse: { sky: 0.04, glow: 0, grid: 0, spark: 0.35, lava: 0 }, glowBase: 1,
    particles: {
      n: 170, size: 0.6, alpha: 0.9, add: false, twinkle: true,
      groups: [{ f: 1, pal: [0xffffff, 0xfff27a, 0xffc0e0, 0xbff0ff], v: [0.8, 0.5, 0.4], j: [1.0, 0.7, 1.0] }],
    },
  },
  {
    id: 'kapadokya', name: 'Kapadokya', music: 'desert', depth: 56,
    flank: { U: 72, e: 1.7, top: 0xe8b27a, mid: 0xd99468, rock: 0xb77a58, rockAmt: 0.5 },
    sky: { top: 0x5b86d8, mid: 0xff9fa8, horizon: 0xffd9a8 },
    fog: { color: 0xffcfa4, near: 70, far: 330 },
    hemi: { sky: 0xdcdcf0, ground: 0xd9a07a, intensity: 1.58 },
    sun: { color: 0xffc890, intensity: 2, az: 2.3, el: 0.5 },
    disc: { color: 0xffe4a8, size: 0.1, az: 0.25, el: 0.28, kind: 'sun' },
    ground: [0xe9b98a, 0xd9a070, 0xf2cfa0],
    track: { tileA: 0xc4704a, tileB: 0xa85a3a, edge: 0xffe9c8, rail: 0x7a4030, glow: 0xffb84a, under: 0x5a3020 },
    clouds: 0xffd6c0, stars: 0, grid: 0, cloudAmt: 0.9,
    pulse: { sky: 0.04, glow: 0, grid: 0, spark: 0.3, lava: 0 }, glowBase: 1,
    particles: {
      n: 140, size: 0.4, alpha: 0.6, add: false, twinkle: true,
      groups: [{ f: 1, pal: [0xfff0d0, 0xffd8a0], v: [0.6, 0.3, 0.3], j: [0.8, 0.5, 0.8] }],
    },
  },
  {
    id: 'town', name: 'Kasaba', music: 'town', depth: 48, flank: { U: 46, e: 1.9, top: 0x92d366, mid: 0x6bb04c, rock: 0xa89878, rockAmt: 0.4 },
    sky: { top: 0x4d9fee, mid: 0x98d2f6, horizon: 0xe2f2ff },
    fog: { color: 0xe0f0fb, near: 70, far: 330 },
    hemi: { sky: 0xe8f2ff, ground: 0xb8c4a0, intensity: 1.71 },
    sun: { color: 0xffeccf, intensity: 2.14, az: 2.3, el: 0.88 },
    disc: { color: 0xfff6e0, size: 0.05, az: 0.3, el: 0.7, kind: 'sun' },
    ground: [0x7fc45a, 0x8fd065, 0x6bb04c],
    track: { tileA: 0x4a4e57, tileB: 0x3d414a, edge: 0x2a2d34, rail: 0xffd23f, glow: 0xffe27a, under: 0x23262c },
    clouds: 0xffffff, stars: 0, grid: 0,
    pulse: { sky: 0.035, glow: 0, grid: 0, spark: 0.2, lava: 0 }, glowBase: 1,
    particles: {
      n: 120, size: 0.35, alpha: 0.55, add: false, twinkle: true,
      groups: [{ f: 1, pal: [0xffffff, 0xfff1b0], v: [0.3, 0.4, 0.3], j: [0.7, 0.5, 0.7] }],
    },
  },
  {
    id: 'desert', name: 'Çöl Kanyonu', music: 'desert', depth: 58, flank: { U: 80, e: 2.2, top: 0xf3d594, mid: 0xd9a05a, rock: 0xb4552d, rockAmt: 0.5, kind: 'strata' },
    sky: { top: 0xe0742c, mid: 0xf5a653, horizon: 0xffd9a0 },
    fog: { color: 0xf7c98f, near: 60, far: 320 },
    hemi: { sky: 0xe8dcf0, ground: 0xd09a5c, intensity: 1.48 },
    sun: { color: 0xffcf8a, intensity: 2.1, az: 2.3, el: 0.62 },
    disc: { color: 0xffe3a0, size: 0.1, az: 0.25, el: 0.36, kind: 'sun' },
    ground: [0xf0c985, 0xdcab63, 0xf7dba6],
    track: { tileA: 0xcf9560, tileB: 0xb27846, edge: 0x7a4a26, rail: 0xffe9c0, glow: 0xffa940, under: 0x6b4423 },
    clouds: 0xffe6c8, stars: 0, grid: 0,
    pulse: { sky: 0.035, glow: 0, grid: 0, spark: 0.2, lava: 0 }, glowBase: 1,
    particles: {
      n: 320, size: 0.4, alpha: 0.7, add: false, twinkle: false,
      groups: [{ f: 1, pal: [0xf0c47a, 0xe0a85a, 0xffe2a8], v: [6.0, -0.3, 1.0], j: [2.2, 0.9, 2.2] }],
    },
  },
  {
    id: 'icecave', name: 'Buz Mağarası', music: 'volcano', depth: 50, junctionOk: false,
    flank: { U: 55, e: 1.6, top: 0xbfeaff, mid: 0x4a9ad8, rock: 0x2a5ea0, rockAmt: 0.6, kind: 'ice' },
    sky: { top: 0x061a3a, mid: 0x0d3a70, horizon: 0x1b5a9a },
    fog: { color: 0x0a2a55, near: 20, far: 190 },
    hemi: { sky: 0x8ac8ff, ground: 0x1a3a7a, intensity: 1.15 },
    sun: { color: 0xbfe6ff, intensity: 1.3, az: 2.6, el: 0.9 },
    disc: { color: 0xbfe6ff, size: 0.04, az: 0.3, el: 0.6, kind: 'sun' },
    ground: [0x1a4a8a, 0x2a6ab0, 0x123a70],
    track: { tileA: 0xcfeeff, tileB: 0x7cc4f0, edge: 0x1d6fd0, rail: 0x4aa8ff, glow: 0x7fe8ff, under: 0x1a3a6a },
    clouds: 0x2a5a90, stars: 0, grid: 0, cloudAmt: 0.35,
    pulse: { sky: 0.03, glow: 0.35, grid: 0, spark: 0.5, lava: 0 }, glowBase: 0.9,
    particles: {
      n: 220, size: 0.35, alpha: 0.9, add: true, twinkle: true,
      groups: [{ f: 1, pal: [0x9ae8ff, 0xffffff, 0xb8c8ff], v: [0.2, -0.5, 0.2], j: [0.6, 0.4, 0.6] }],
    },
  },
  {
    id: 'candy', name: 'Şeker Diyarı', music: 'candy', depth: 52, flank: { U: 100, e: 1.7, top: 0xfff0f8, mid: 0xff8fc4, rock: 0x8fe8c4, rockAmt: 0.8 },
    sky: { top: 0xb39cf5, mid: 0xf5b8e6, horizon: 0xfff0f7 },
    fog: { color: 0xfde6f2, near: 65, far: 330 },
    hemi: { sky: 0xf6e8ff, ground: 0xf3b6d8, intensity: 1.66 },
    sun: { color: 0xfff2e8, intensity: 1.8, az: 2.4, el: 0.83 },
    disc: { color: 0xfff4fa, size: 0.07, az: 0.3, el: 0.55, kind: 'sun' },
    ground: [0xffadd6, 0xa8ecd0, 0xffcfe8],
    track: { tileA: 0xff70b8, tileB: 0x5fe3b8, edge: 0xffffff, rail: 0xff3f9f, glow: 0xfff27a, under: 0xb85a96 },
    clouds: 0xffe3f3, stars: 0, grid: 0,
    pulse: { sky: 0.05, glow: 0, grid: 0, spark: 0.9, lava: 0 }, glowBase: 1,
    particles: {
      n: 260, size: 0.7, alpha: 0.9, add: true, twinkle: true,
      groups: [{ f: 1, pal: [0xff8fd0, 0x8fffe0, 0xfff08a, 0xb59cff, 0xffffff], v: [0.3, 0.9, 0.2], j: [1.0, 0.8, 1.0] }],
    },
  },
  {
    id: 'sakura', name: 'Sakura Vadisi', music: 'snow', depth: 52,
    flank: { U: 70, e: 1.7, top: 0xf5b8d0, mid: 0xc87a98, rock: 0x9a6a7a, rockAmt: 0.4 },
    sky: { top: 0xe6a6d8, mid: 0xffc6e0, horizon: 0xfff0f4 },
    fog: { color: 0xffe4ee, near: 65, far: 330 },
    hemi: { sky: 0xf4eaff, ground: 0xe8b0c8, intensity: 1.59 },
    sun: { color: 0xffeedd, intensity: 1.99, az: 2.4, el: 0.83 },
    disc: { color: 0xfffaf0, size: 0.06, az: 0.3, el: 0.6, kind: 'sun' },
    ground: [0xa8dc7a, 0xf2c0d6, 0x90cc68],
    track: { tileA: 0x9a5a48, tileB: 0x7a4638, edge: 0xffe0ea, rail: 0xc03a4a, glow: 0xffb0c8, under: 0x4a2a28 },
    clouds: 0xffeef6, stars: 0, grid: 0, cloudAmt: 1,
    pulse: { sky: 0.04, glow: 0, grid: 0, spark: 0.6, lava: 0 }, glowBase: 1,
    particles: {
      n: 340, size: 0.6, alpha: 0.95, add: false, twinkle: false,
      groups: [{ f: 1, pal: [0xffc0d8, 0xffa8c8, 0xffe0ec, 0xffd0e0], v: [1.3, -1.1, 0.6], j: [1.4, 0.6, 1.4] }],
    },
  },
  {
    id: 'istanbul', name: 'İstanbul Boğazı', music: 'desert', depth: 58,
    flank: { U: 64, e: 1.7, top: 0xe0c8a0, mid: 0x9c8a6a, rock: 0x6a6a72, rockAmt: 0.5 },
    sky: { top: 0x3a3a8a, mid: 0xe0608a, horizon: 0xffa860 },
    fog: { color: 0xf09a78, near: 70, far: 330 },
    hemi: { sky: 0xd0b4dc, ground: 0x6a7aa8, intensity: 1.66 },
    sun: { color: 0xff9a5a, intensity: 1.8, az: 2.4, el: 0.45 },
    disc: { color: 0xffc070, size: 0.12, az: 0.2, el: 0.18, kind: 'sun' },
    ground: [0x2a78b0, 0x3a90c8, 0x1e6498],
    track: { tileA: 0xd8d2c8, tileB: 0xb8b0a4, edge: 0xe03a3a, rail: 0xf5f0e8, glow: 0xffd070, under: 0x6a5a58 },
    clouds: 0xffb8a0, stars: 0, grid: 0, cloudAmt: 0.9,
    pulse: { sky: 0.04, glow: 0, grid: 0, spark: 0.3, lava: 0 }, glowBase: 1,
    particles: {
      n: 120, size: 0.4, alpha: 0.7, add: true, twinkle: true,
      groups: [{ f: 1, pal: [0xffd890, 0xffb070], v: [0.8, 0.3, 0.3], j: [1.0, 0.5, 1.0] }],
    },
  },
  {
    id: 'neon', name: 'Neon Gece', music: 'neon', depth: 56, flank: { U: 90, e: 1.7, top: 0x00e5ff, mid: 0x1c0b4a, rock: 0x3d1a80, rockAmt: 0.8, kind: 'neon' },
    sky: { top: 0x04010e, mid: 0x1b0846, horizon: 0x6a1a9c },
    fog: { color: 0x6a1a9c, near: 50, far: 300 },
    hemi: { sky: 0x6a4cff, ground: 0x20104a, intensity: 1.0 },
    sun: { color: 0xb88cff, intensity: 1.2, az: 2.8, el: 0.9 },
    disc: { color: 0xffffff, size: 0.2, az: 0.0, el: 0.15, kind: 'retro' },
    ground: [0x120733, 0x1c0b4a, 0x0b0420],
    track: { tileA: 0x15131f, tileB: 0x1f1b2f, edge: 0x00e5ff, rail: 0xff2bd6, glow: 0x00f0ff, under: 0x07050f },
    clouds: 0x5a2a9a, stars: 1, grid: 1,
    pulse: { sky: 0.14, glow: 0.55, grid: 0.7, spark: 0.5, lava: 0 }, glowBase: 0.8,
    particles: {
      n: 300, size: 0.42, alpha: 0.95, add: true, twinkle: true,
      groups: [{ f: 1, pal: [0x00f0ff, 0xff2bd6, 0xffffff, 0x8a5cff], v: [0, 0.7, 0], j: [0.8, 0.6, 0.8] }],
    },
  },
  {
    id: 'moon', name: 'Ay Yüzeyi', music: 'neon', depth: 56,
    flank: { U: 80, e: 1.6, top: 0xb8b8c0, mid: 0x8a8a94, rock: 0x5a5a64, rockAmt: 0.8 },
    sky: { top: 0x000003, mid: 0x01010a, horizon: 0x06061a },
    fog: { color: 0x05050c, near: 100, far: 320 },
    hemi: { sky: 0x9aa4c8, ground: 0x34343c, intensity: 0.9 },
    sun: { color: 0xffffff, intensity: 2.3, az: 2.2, el: 0.5 },
    disc: { color: 0xffffff, size: 0.12, az: 0.45, el: 0.42, kind: 'earth' },
    ground: [0x8e8e98, 0x70707a, 0xa6a6b0],
    track: { tileA: 0xdedee6, tileB: 0xb0b0bc, edge: 0xff7a1a, rail: 0x4a4a58, glow: 0x9ad8ff, under: 0x2a2a34 },
    clouds: 0x1a1a22, stars: 1, grid: 0, cloudAmt: 0,
    pulse: { sky: 0.02, glow: 0.2, grid: 0, spark: 0.3, lava: 0 }, glowBase: 1,
    particles: {
      n: 110, size: 0.35, alpha: 0.5, add: false, twinkle: false,
      groups: [{ f: 1, pal: [0xb0b0b8, 0x909098], v: [0.3, 0.25, 0.2], j: [0.5, 0.4, 0.5] }],
    },
  },
  {
    id: 'pirate', name: 'Korsan Koyu', music: 'forest', depth: 54,
    flank: { U: 70, e: 1.7, top: 0xf2dca0, mid: 0xc8a870, rock: 0x7a6a50, rockAmt: 0.5 },
    sky: { top: 0x1aa0e8, mid: 0x70d8f4, horizon: 0xe8fbff },
    fog: { color: 0xcdf2f8, near: 80, far: 330 },
    hemi: { sky: 0xe2f8ff, ground: 0x8ae0e0, intensity: 1.66 },
    sun: { color: 0xfff4d0, intensity: 2.1, az: 2.3, el: 0.93 },
    disc: { color: 0xfff0b0, size: 0.06, az: 0.3, el: 0.7, kind: 'sun' },
    ground: [0x18c4c0, 0x20d8d0, 0x10a8b8],
    track: { tileA: 0xa8723a, tileB: 0x8a5a2c, edge: 0xf0e0b0, rail: 0x4a2c18, glow: 0xffd24a, under: 0x3a2210 },
    clouds: 0xffffff, stars: 0, grid: 0, cloudAmt: 1,
    pulse: { sky: 0.04, glow: 0, grid: 0, spark: 0.4, lava: 0 }, glowBase: 1,
    particles: {
      n: 150, size: 0.5, alpha: 0.7, add: true, twinkle: true,
      groups: [{ f: 1, pal: [0xffffff, 0xcff8ff], v: [0.8, 0.5, 0.4], j: [1.0, 0.7, 1.0] }],
    },
  },
  {
    id: 'volcano', name: 'Volkan', music: 'volcano', depth: 58, flank: { U: 110, e: 1.7, top: 0x3a2a26, mid: 0x1d1615, rock: 0x4a3a33, rockAmt: 0.7, kind: 'lava' },
    sky: { top: 0x2c0a09, mid: 0xc23a14, horizon: 0xe05a1c },
    fog: { color: 0xb8401a, near: 70, far: 330 },
    hemi: { sky: 0xff9a6a, ground: 0x3a1410, intensity: 1.15 },
    sun: { color: 0xff8a4a, intensity: 1.6, az: 2.6, el: 0.8 },
    disc: { color: 0xff7a3a, size: 0.13, az: 0.2, el: 0.24, kind: 'sun' },
    ground: [0x241a18, 0x34261f, 0x161010],
    track: { tileA: 0x4b403b, tileB: 0x3a2f2b, edge: 0xff6a1a, rail: 0xff8c1f, glow: 0xff7a1a, under: 0x140c0a },
    clouds: 0x3a2622, stars: 0.12, grid: 0,
    pulse: { sky: 0.07, glow: 0.35, grid: 0, spark: 0.35, lava: 0.16 }, glowBase: 1,
    particles: {
      n: 380, size: 0.55, alpha: 0.95, add: false, twinkle: false,
      groups: [
        { f: 0.62, pal: [0x6a6460, 0x4a4440, 0x8a847f], v: [0.7, -1.2, 0.4], j: [1.2, 0.7, 1.2] },
        { f: 0.38, pal: [0xff7a1a, 0xffb040, 0xff4a10], v: [0.5, 2.0, 0.3], j: [1.0, 0.9, 1.0] },
      ],
    },
  },
  {
    id: 'aurora', name: 'Kuzey Işıkları', music: 'aurora', depth: 54, aurora: 1,
    flank: { U: 110, e: 1.6, top: 0xcfe0ff, mid: 0x6a86c0, rock: 0x3a4a78, rockAmt: 0.8 },
    sky: { top: 0x040a22, mid: 0x0a2450, horizon: 0x1a5a78 },
    fog: { color: 0x0c2248, near: 45, far: 260 },
    hemi: { sky: 0x8fb4ff, ground: 0x203a6a, intensity: 1.05 },
    sun: { color: 0xa8c8ff, intensity: 1.0, az: 2.6, el: 0.7 },
    disc: { color: 0xdfeaff, size: 0.05, az: 0.3, el: 0.5, kind: 'sun' },
    ground: [0x9ab4e0, 0x7f9ad0, 0xb4c8ec],
    track: { tileA: 0xe4f0ff, tileB: 0x6a8fd8, edge: 0x3fd0a0, rail: 0x5fffc0, glow: 0x5fffc0, under: 0x1a2a5a },
    clouds: 0x1a3a6a, stars: 1, grid: 0, cloudAmt: 0.3,
    pulse: { sky: 0.05, glow: 0.4, grid: 0, spark: 0.4, lava: 0 }, glowBase: 1,
    particles: {
      n: 260, size: 0.3, alpha: 0.8, add: true, twinkle: true,
      groups: [{ f: 1, pal: [0xffffff, 0xbfe8ff, 0x9affd8], v: [0.5, -2.0, 0.3], j: [1.2, 0.8, 1.2] }],
    },
  },
  {
    id: 'bamboo', name: 'Bambu Ormanı', music: 'bamboo', depth: 48,
    flank: { U: 90, e: 1.7, top: 0x7fcf6a, mid: 0x3f8a48, rock: 0x6a7a5a, rockAmt: 0.5 },
    sky: { top: 0x7fc4a8, mid: 0xb8e4c8, horizon: 0xe8f6dc },
    fog: { color: 0xcfe8d4, near: 25, far: 210 },
    hemi: { sky: 0xeaffe0, ground: 0x6a9a70, intensity: 1.3 },
    sun: { color: 0xfff0c8, intensity: 1.5, az: 2.6, el: 0.7 },
    disc: { color: 0xfff6d8, size: 0.06, az: 0.3, el: 0.5, kind: 'sun' },
    ground: [0x6fb868, 0x5aa85a, 0x84c878],
    track: { tileA: 0xf2f0dc, tileB: 0x9cc87a, edge: 0x4a8a3a, rail: 0x8cd05a, glow: 0xb6ff8a, under: 0x3a6a3a },
    clouds: 0xf4fff0, stars: 0, grid: 0, cloudAmt: 0.8,
    pulse: { sky: 0.03, glow: 0, grid: 0, spark: 0.25, lava: 0 }, glowBase: 1,
    particles: {
      n: 160, size: 0.45, alpha: 0.7, add: false, twinkle: false,
      groups: [{ f: 1, pal: [0xb6e06a, 0x8fd05a, 0xe8f8b0], v: [0.5, -0.8, 0.4], j: [1.2, 0.8, 1.2] }],
    },
  },
  {
    id: 'glacier', name: 'Buz Krallığı', music: 'glacier', depth: 56,
    flank: { U: 100, e: 1.6, top: 0xe8f8ff, mid: 0x6ab4f0, rock: 0x3a7ac8, rockAmt: 0.7 },
    sky: { top: 0x0a3a8a, mid: 0x4aa8f0, horizon: 0xd0f4ff },
    fog: { color: 0xbfe8ff, near: 55, far: 300 },
    hemi: { sky: 0xc4e4ff, ground: 0x5a90d0, intensity: 1.64 },
    sun: { color: 0xfff0dc, intensity: 1.84, az: 2.3, el: 0.83 },
    disc: { color: 0xf4fbff, size: 0.05, az: 0.3, el: 0.62, kind: 'sun' },
    ground: [0xa8dcff, 0x8ec8f5, 0xc4e8ff],
    track: { tileA: 0xe8f8ff, tileB: 0x5aa8f0, edge: 0x2a78d8, rail: 0x4ab8ff, glow: 0x9ae8ff, under: 0x2a5a9a },
    clouds: 0xeaf8ff, stars: 0, grid: 0, cloudAmt: 0.6,
    pulse: { sky: 0.04, glow: 0.3, grid: 0, spark: 0.5, lava: 0 }, glowBase: 1,
    particles: {
      n: 240, size: 0.3, alpha: 0.85, add: true, twinkle: true,
      groups: [{ f: 1, pal: [0xffffff, 0xcfeeff, 0x9ad8ff], v: [0.3, -1.2, 0.3], j: [1.0, 0.8, 1.0] }],
    },
  },
  {
    id: 'carnival', name: 'Lunapark', music: 'carnival', depth: 52,
    flank: { U: 90, e: 1.7, top: 0xc8a0ff, mid: 0x7a52c8, rock: 0x4a3a8a, rockAmt: 0.5 },
    sky: { top: 0x2a1060, mid: 0x7a3aa8, horizon: 0xff8ac0 },
    fog: { color: 0x6a3a98, near: 40, far: 270 },
    hemi: { sky: 0xffc8f0, ground: 0x4a2a80, intensity: 1.2 },
    sun: { color: 0xffd0f0, intensity: 1.3, az: 2.7, el: 0.6 },
    disc: { color: 0xffe0f4, size: 0.08, az: 0.3, el: 0.3, kind: 'sun' },
    ground: [0x6a3ab0, 0x7a4ac0, 0x5a2aa0],
    track: { tileA: 0xfff0fa, tileB: 0xff9ad0, edge: 0xffd23a, rail: 0x7fe8ff, glow: 0xffe03a, under: 0x3a1a6a },
    clouds: 0xe8a0d8, stars: 0.6, grid: 0, cloudAmt: 0.6,
    pulse: { sky: 0.12, glow: 0.6, grid: 0, spark: 0.5, lava: 0 }, glowBase: 0.9,
    particles: {
      n: 300, size: 0.4, alpha: 0.95, add: true, twinkle: true,
      groups: [{ f: 1, pal: [0xff4a8a, 0xffe03a, 0x4ad0ff, 0x7aff9a, 0xffffff], v: [0.4, -0.6, 0.4], j: [1.4, 0.9, 1.4] }],
    },
  },
];

const TAGS = {
  snow: 'Karlı zirvede ilk adım!', forest: 'Çam ormanında koşu!', greenhill: 'Yeşil tepelerde hız yap!',
  kapadokya: 'Peri bacaları arasında!', town: 'Kasabanın çatıları üstünde!', desert: 'Kanyonun sıcağı sarıyor!',
  icecave: 'Buz mağarası: yol kaygan!', candy: 'Şeker yağmuru başladı!', sakura: 'Kiraz çiçekleri yağıyor!',
  istanbul: 'Boğaz\'da rüzgâr esiyor!', neon: 'Neon gecesi başlıyor!', moon: 'Ay\'da yerçekimi az!',
  pirate: 'Korsan koyunda define peşinde!', volcano: 'Lavlar yükseliyor!',
  aurora: 'Gökyüzünde kuzey ışıkları dans ediyor!', bamboo: 'Bambu ormanında sis var!', glacier: 'Buz krallığının kapıları açıldı!', carnival: 'Lunapark ışıl ışıl!',
};
const MODS = { moon: { gravity: 0.55 }, icecave: { grip: 0.6 }, istanbul: { wind: 0.3 } };
for (const b of BIOMES) {
  b.tagline = TAGS[b.id];
  b.mods = Object.assign({ gravity: 1, grip: 1, fog: 0, wind: 0 }, MODS[b.id]);
  if (b.id === 'snow') b.modsHard = Object.assign({}, b.mods, { fog: 0.3 }); // blizzard on the second lap and later
  if (b.cloudAmt === undefined) b.cloudAmt = 1;
}

// Colour grade per biome (the display-space finish in shaders.js cigFinish, blended across portals like the rest of the look):
//   sat = saturation, con = S-curve contrast (0..0.5), vig = vignette strength, rim = how far the ball's silhouette tints toward rimC,
//   sh / hi = multipliers for the shadows / highlights (cool shadows + warm highlights by default; complementary pairs for the sunsets).
// rimC is picked against the biome's background: a deeper blue on the pale biomes, a bright glow on the dark ones.
const GRADE0 = { sat: 1.12, con: 0.22, vig: 0.26, rim: 0.4, sh: [0.94, 0.97, 1.04], hi: [1.04, 1.01, 0.96], rimC: 0x6f9ad8 };
const GRADES = {
  snow: { sat: 1.1, con: 0.2, sh: [0.92, 0.96, 1.06], hi: [1.05, 1.02, 0.95], rim: 0.46 },
  forest: { sat: 1.16, vig: 0.28, sh: [0.92, 0.97, 1.0], hi: [1.06, 1.02, 0.94], rimC: 0x3f7f8f },
  greenhill: { sat: 1.2, con: 0.2, vig: 0.22, rimC: 0x2f78c8 },
  kapadokya: { sat: 1.14, con: 0.24, vig: 0.3, sh: [0.95, 0.93, 1.06], hi: [1.07, 1.0, 0.92], rimC: 0x9a5a9a },
  town: { rimC: 0x4f82c8 },
  desert: { sat: 1.15, con: 0.24, vig: 0.3, sh: [0.95, 0.92, 1.05], hi: [1.08, 1.01, 0.9], rimC: 0x4f7fb8 },
  icecave: { sat: 1.1, con: 0.2, vig: 0.34, sh: [0.9, 0.97, 1.08], hi: [0.98, 1.03, 1.06], rimC: 0x7fe8ff, rim: 0.5 },
  candy: { con: 0.16, vig: 0.2, sh: [0.97, 0.94, 1.04], hi: [1.03, 1.0, 0.97], rimC: 0xd0509f },
  sakura: { sat: 1.1, con: 0.18, vig: 0.24, rimC: 0xb85a88 },
  istanbul: { sat: 1.18, con: 0.26, vig: 0.32, sh: [0.9, 0.93, 1.08], hi: [1.08, 1.0, 0.9], rimC: 0x6a4a9a },
  neon: { sat: 1.25, con: 0.3, vig: 0.34, sh: [0.9, 0.92, 1.12], hi: [1.04, 0.98, 1.08], rimC: 0x38e6ff, rim: 0.6 },
  moon: { sat: 1.0, con: 0.28, vig: 0.36, sh: [0.92, 0.95, 1.1], hi: [1.0, 1.0, 1.04], rimC: 0x9ad8ff, rim: 0.5 },
  pirate: { sat: 1.16, con: 0.2, vig: 0.24, rimC: 0x2a78c0 },
  volcano: { sat: 1.2, con: 0.28, vig: 0.36, sh: [1.02, 0.94, 0.9], hi: [1.06, 1.0, 0.9], rimC: 0xff8a3a, rim: 0.5 },
  aurora: { sat: 1.18, con: 0.26, vig: 0.34, sh: [0.9, 0.98, 1.1], hi: [0.98, 1.04, 1.04], rimC: 0x5fffc0, rim: 0.5 },
  bamboo: { con: 0.18, rimC: 0x3a8a6a },
  glacier: { sat: 1.14, con: 0.2, rimC: 0x2a78d8 },
  carnival: { sat: 1.2, con: 0.24, vig: 0.3, sh: [0.96, 0.92, 1.08], hi: [1.06, 0.99, 0.96], rimC: 0xffe03a, rim: 0.5 },
};
for (const b of BIOMES) b.grade = Object.assign({}, GRADE0, GRADES[b.id]);

/**
 * Lock the world to ONE biome (campaign levels): biomeAt / trackPalette / musicStyleAt / biomeMods / Environment all use it
 * for every s, no portals. setBiomeOverride(null) restores the normal cycle. Accepts an id or a BIOMES index. Returns the
 * active id or null. Call it before creating the Environment (a live one rebuilds itself on its next update).
 */
export function setBiomeOverride(idOrNull) {
  let idx = -1;
  if (idOrNull !== null && idOrNull !== undefined) {
    idx = typeof idOrNull === 'number' ? idOrNull : BIOMES.findIndex((b) => b.id === idOrNull);
    if (!(idx >= 0 && idx < BIOMES.length)) { if (typeof console !== 'undefined') console.warn('setBiomeOverride: unknown biome', idOrNull); idx = -1; }
  }
  if (idx !== OVR) { OVR = idx; OVR_VER++; }
  return OVR >= 0 ? BIOMES[OVR].id : null;
}
export function getBiomeOverride() { return OVR >= 0 ? BIOMES[OVR].id : null; }

export function biomeAt(s, out) {
  const index = biomeIdx(s);
  const n = BIOMES.length;
  const r = out || {};
  r.biome = BIOMES[index % n];
  r.index = index;
  r.t = OVR >= 0 ? clamp(((s > 0 ? s : 0) % BIOME_LENGTH) / BIOME_LENGTH, 0, 1) : clamp((s - index * BIOME_LENGTH) / BIOME_LENGTH, 0, 1);
  r.next = OVR >= 0 ? r.biome : BIOMES[(index + 1) % n];
  return r;
}
/** Gameplay modifiers { gravity, grip, fog, wind } at s (steps at the portal, no blending). Same object every call. */
export function biomeMods(s) {
  const index = biomeIdx(s), n = BIOMES.length, b = BIOMES[index % n];
  return b.modsHard && index >= n ? b.modsHard : b.mods;
}
export function trackPalette(s) { return BIOMES[biomeIdx(s) % BIOMES.length].track; }
/** May the track put a Temple Run junction (sharp corner) here? false in the ice cave (its arch is built from straight cross-sections). */
export function junctionOkAt(s) { return BIOMES[biomeIdx(s) % BIOMES.length].junctionOk !== false; }
export function musicStyleAt(s) { return BIOMES[biomeIdx(s) % BIOMES.length].music; }

// ---------------------------------------------------------------------------------------------
// tint palettes (THREE.Color, linear) used as per-instance colours
// ---------------------------------------------------------------------------------------------
const P = {
  white: [0xffffff],
  snowHill: [0xeaf2fb, 0xdde9f6, 0xd0e0f2],
  snowPeak: [0xffffff, 0xeef4fb],
  pineTint: [0xffffff, 0xf0fff4, 0xe6f4ff],
  ice: [0xbfe4fa, 0xa8d4f2, 0xcdeeff],
  water: [0x3f9ee6, 0x56b4ee, 0x3a8fd8],
  grassHill: [0x74c257, 0x66b050, 0x86cf62, 0x5fa84b],
  ghHill: [0x4fe03a, 0x3fd02e, 0x5eea45, 0x34c428],
  ghTree: [0xffffff, 0xd8ff9a, 0xc4ff7a, 0xe6ffb0],
  ghSun: [0xffffff, 0xfff4c0, 0xfffbe0],
  ghEarth: [0xffffff, 0xfff0e0, 0xf3dcc4],
  ghWater: [0x2fb4ff, 0x4cc4ff],
  ochre: [0xffffff, 0xffe6cc, 0xffd8b0, 0xf6cfa8],
  ochreHill: [0xe8b88a, 0xd9a070, 0xf0c898],
  balloon: [0xffffff, 0xffe0e0, 0xe0f0ff, 0xe8ffe0, 0xfff0c0],
  iceGlow: [0x7fe8ff, 0x9ad0ff, 0xb8a8ff, 0xa0f0ff],
  iceHill: [0xbfe4ff, 0x9ad0f5, 0xd0ecff],
  iceRock: [0xa8d4f2, 0x8ec0e8, 0xc4e4ff],
  sakTree: [0xffffff, 0xffe6f0, 0xffd0e4, 0xfff2f8],
  sakHill: [0xf5b8d0, 0xb8e08a, 0xf2c8dc, 0xa8d878],
  cypress: [0x4a7a46, 0x3a6a3a, 0x5a8a50],
  moonRock: [0xb0b0b8, 0x909098, 0xc8c8d0, 0xa0a0aa],
  moonHill: [0x9a9aa4, 0x84848e, 0xb0b0ba],
  sandIsle: [0xf2dca0, 0xe8cc88, 0xf6e6b4],
  treeTint: [0xffffff, 0xe6ffd6, 0xd2f0b8, 0xffe9a8, 0xffd0a0, 0xd8ffc8],
  rockGrey: [0xa8aab2, 0x8e9098, 0xb6b2a8],
  hutWall: [0xfff1d6, 0xffd2d2, 0xd2f0d8, 0xd2e6ff, 0xfff2a8, 0xffc9a0, 0xe3d2ff],
  bld: [0xffffff, 0xfff0e6, 0xeaf6ff, 0xf3ffe9, 0xffeaf2],
  sandHill: [0xf0c27a, 0xe5b060, 0xf5d28f, 0xdca458],
  sandRock: [0xd9b78a, 0xc89b6a, 0xe0c39b],
  mesaTint: [0xffffff, 0xffe9d8, 0xf6d9c4],
  candyHill: [0xff9ccb, 0xffb5dc, 0xa6f0cf, 0xc9b6ff, 0xfff0a0],
  candyAny: [0xffffff, 0xffe3f0, 0xe6fff4, 0xece3ff, 0xfffbd6],
  syrup: [0xff7fb8, 0x8fdcff, 0xffc0e0],
  neon: [0x00e5ff, 0xff2bd6, 0x8a5cff, 0x2bffb0, 0xffb02b],
  neonCyan: [0x00e5ff, 0x20f0ff],
  neonPink: [0xff2bd6, 0xff4ae0],
  neonHot: [0x00e5ff, 0xff2bd6],
  neonMtn: [0x2a1260, 0x3d1a80, 0x22104e],
  volcRock: [0x3b302d, 0x2a2220, 0x4a3a33],
  volcHill: [0x2b2321, 0x1f1a19, 0x352a26],
  lava: [0xff6a1a, 0xff8a22, 0xff5410],
  nightPine: [0x9ad8e8, 0x7fb8d8, 0xa8f0e0],
  nightHill: [0x8fb0e0, 0x7aa0d8, 0xa8c4ec],
  nightPeak: [0xb8d0f8, 0x9ab8f0, 0xcfe0ff],
  auroraGlow: [0x5fffc0, 0x7fe8ff, 0xb08cff, 0x5fffa0],
  bamHill: [0x4faa5a, 0x5fbf62, 0x449a50, 0x78c868],
  bamTint: [0xffffff, 0xe8ffc8, 0xd0f4a0, 0xf0ffd8],
  bamWater: [0x3fb8a0, 0x56c8b0, 0x38a890],
  glacHill: [0xa8dcff, 0x8ec8f5, 0xc4e8ff],
  glacSpire: [0x9ad8ff, 0xbfe8ff, 0x7fc0f0, 0xd8f4ff],
  glacWater: [0x2a8ae0, 0x4aa8f0, 0x2478d0],
  carnHill: [0xb07af0, 0x7aa0f0, 0xf07ac8, 0x7af0b8],
  carnAny: [0xffffff, 0xffe0e8, 0xe0f0ff, 0xfff0b8],
  ember: [0xff7a24, 0xff9a30],
};
for (const k in P) P[k] = P[k].map((h) => new THREE.Color(h));
for (const c of P.lava) c.multiplyScalar(1.5);

// ---------------------------------------------------------------------------------------------
// geometry kit: merged, non-indexed, vertex-coloured, flat-shaded decor
// ---------------------------------------------------------------------------------------------
const _tc = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _e4 = new THREE.Euler();
const _p3 = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const _rgb = [0, 0, 0];

function toRGB(c, out) {
  if (typeof c === 'number') { _tc.setHex(c); out[0] = _tc.r; out[1] = _tc.g; out[2] = _tc.b; }
  else if (c.isColor) { out[0] = c.r; out[1] = c.g; out[2] = c.b; }
  else { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }
}

/** Radial vertex jitter that keeps seams closed (hash of position). */
function jit(g, amt, seed = 0, keepY = false) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = ihash(Math.round(x * 997) + seed * 131, Math.round(y * 991), Math.round(z * 983));
    const k = 1 + amt * (h * 2 - 1);
    p.setXYZ(i, x * k, keepY ? y : y * k, z * k);
  }
  return g;
}

class Mesher {
  constructor() { this.parts = []; }
  /** col: hex | Color | [r,g,b] linear | fn(nx,ny,nz,cx,cy,cz) per triangle | (o.v) fn(x,y,z,nx,ny,nz) per vertex. */
  add(geo, col, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    _e4.set(o.rx || 0, o.ry || 0, o.rz || 0, o.eo || 'XYZ');
    _q4.setFromEuler(_e4);
    _p3.set(o.x || 0, o.y || 0, o.z || 0);
    const k = o.s == null ? 1 : o.s;
    _s3.set((o.sx == null ? 1 : o.sx) * k, (o.sy == null ? 1 : o.sy) * k, (o.sz == null ? 1 : o.sz) * k);
    _m4.compose(_p3, _q4, _s3);
    g.applyMatrix4(_m4);

    let pa = g.attributes.position.array;
    if (o.minY != null) { // drop triangles that are entirely below minY (buried parts)
      const keep = [];
      for (let i = 0; i < pa.length; i += 9) {
        if (pa[i + 1] >= o.minY || pa[i + 4] >= o.minY || pa[i + 7] >= o.minY) for (let j = 0; j < 9; j++) keep.push(pa[i + j]);
      }
      pa = new Float32Array(keep);
      g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
    }
    const n = pa.length / 3;
    const arr = new Float32Array(n * 3);
    const isFn = typeof col === 'function';
    if (!isFn) toRGB(col, _rgb);
    for (let i = 0; i < n; i += 3) {
      const ax = pa[i * 3], ay = pa[i * 3 + 1], az = pa[i * 3 + 2];
      const bx = pa[i * 3 + 3], by = pa[i * 3 + 4], bz = pa[i * 3 + 5];
      const cx = pa[i * 3 + 6], cy = pa[i * 3 + 7], cz = pa[i * 3 + 8];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      if (!isFn) {
        for (let v = 0; v < 3; v++) { arr[(i + v) * 3] = _rgb[0]; arr[(i + v) * 3 + 1] = _rgb[1]; arr[(i + v) * 3 + 2] = _rgb[2]; }
      } else if (o.v) {
        for (let v = 0; v < 3; v++) {
          const j = (i + v) * 3;
          toRGB(col(pa[j], pa[j + 1], pa[j + 2], nx, ny, nz), _rgb);
          arr[j] = _rgb[0]; arr[j + 1] = _rgb[1]; arr[j + 2] = _rgb[2];
        }
      } else {
        toRGB(col(nx, ny, nz, (ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3), _rgb);
        for (let v = 0; v < 3; v++) { arr[(i + v) * 3] = _rgb[0]; arr[(i + v) * 3 + 1] = _rgb[1]; arr[(i + v) * 3 + 2] = _rgb[2]; }
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
    return this;
  }
  build() {
    const geo = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    geo.computeVertexNormals();
    return geo;
  }
}

function measure(geo) {
  const p = geo.attributes.position;
  let hr2 = 0, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r2 = x * x + z * z;
    if (r2 > hr2) hr2 = r2;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { hr: Math.sqrt(hr2), y0, y1 };
}

const ICO = (r, d) => new THREE.IcosahedronGeometry(r, d);
const CYL = (rt, rb, h, seg, hs = 1, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, hs, open);
const BOX = (w, h, d, ws = 1, hs = 1, ds = 1) => new THREE.BoxGeometry(w, h, d, ws, hs, ds);

const gray = (k) => [k, k, k];

// ---------------------------------------------------------------------------------------------
// procedural decor (unit-ish models, origin at the ground, front = +Z)
// ---------------------------------------------------------------------------------------------
const BUILD = {};

BUILD.hill = () => {
  const m = new Mesher();
  m.add(jit(ICO(1, 1), 0.1, 3), (nx, ny, nz, cx, cy, cz) => {
    const h = ihash(Math.round(cx * 60), Math.round(cy * 60), Math.round(cz * 60));
    return gray(0.84 + 0.16 * clamp(ny * 0.8 + 0.3, 0, 1) + (h - 0.5) * 0.09);
  }, { minY: -0.02 });
  return m.build();
};

BUILD.rock = () => {
  const m = new Mesher();
  m.add(jit(ICO(1, 1), 0.3, 5), (nx, ny, nz, cx, cy, cz) => {
    const h = ihash(Math.round(cx * 50), Math.round(cy * 50), Math.round(cz * 50));
    return gray(0.52 + 0.3 * clamp(ny, 0, 1) + (h - 0.5) * 0.14);
  }, { y: 0.35, sy: 0.75, minY: -0.1 });
  return m.build();
};

BUILD.pond = () => {
  const m = new Mesher();
  m.add(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), gray(0.74));
  m.add(new THREE.CircleGeometry(0.85, 12).rotateX(-Math.PI / 2), gray(1), { y: 0.12 });
  return m.build();
};

BUILD.roundtree = () => {
  const m = new Mesher();
  m.add(CYL(0.35, 0.5, 2.4, 6), 0x7a4b2a, { y: 1.2 });
  const leaf = (nx, ny, nz, cx, cy, cz) => {
    const h = ihash(Math.round(cx * 40), Math.round(cy * 40), Math.round(cz * 40));
    const k = 0.78 + 0.22 * clamp(ny * 0.7 + 0.4, 0, 1) + (h - 0.5) * 0.1;
    return [0.2 * k, 0.62 * k, 0.22 * k];
  };
  m.add(jit(ICO(1, 1), 0.12, 2), leaf, { y: 4.0, sx: 2.1, sy: 1.9, sz: 2.1 });
  m.add(jit(ICO(1, 0), 0.1, 3), leaf, { x: 0.7, y: 5.6, z: 0.2, sx: 1.3, sy: 1.2, sz: 1.3 });
  return m.build();
};

BUILD.peak = () => {
  const g = CYL(0.05, 1, 1, 7, 4, true);
  g.translate(0, 0.5, 0);
  jit(g, 0.2, 7);
  const m = new Mesher();
  m.add(g, (nx, ny, nz, cx, cy, cz) => {
    const h = ihash(Math.round(cx * 30), Math.round(cy * 30), Math.round(cz * 30));
    if (cy + (h - 0.5) * 0.14 > 0.56) return [0.97, 0.98, 1.0];
    const k = 0.72 + 0.4 * h;
    return [0.42 * k, 0.5 * k, 0.66 * k];
  });
  return m.build();
};

BUILD.mesa = () => {
  const m = new Mesher();
  const strata = [0xb4552d, 0xcf7339, 0xe39b54, 0xc4693a, 0xe8b070];
  const tiers = [[1.0, 0.9, 0.46, 0], [0.78, 0.72, 0.3, 0.46], [0.58, 0.54, 0.24, 0.76]];
  tiers.forEach(([rb, rt, h, y0], i) => {
    const g = CYL(rt, rb, h, 8, 2);
    g.translate(0, y0 + h / 2, 0);
    jit(g, 0.07, 9 + i, true);
    m.add(g, (nx, ny, nz, cx, cy) => {
      if (ny > 0.8) return 0xf0c07a;
      const hh = ihash(Math.round(cx * 7), Math.round(cy * 40), i);
      return strata[Math.floor(cy * 12 + hh * 0.7) % 5];
    });
  });
  return m.build();
};

BUILD.cactus = () => {
  const m = new Mesher();
  const g1 = 0x4a9a4c, g2 = 0x5fb35a;
  m.add(CYL(0.45, 0.5, 4.2, 6), g1, { y: 2.1 });
  m.add(ICO(0.46, 0), g2, { y: 4.2 });
  m.add(CYL(0.28, 0.28, 1.2, 5), g1, { x: 0.8, y: 2.4, rz: Math.PI / 2 });
  m.add(CYL(0.26, 0.3, 1.5, 5), g2, { x: 1.4, y: 3.1 });
  m.add(ICO(0.28, 0), g2, { x: 1.4, y: 3.85 });
  m.add(CYL(0.26, 0.26, 1.0, 5), g1, { x: -0.7, y: 1.7, rz: Math.PI / 2 });
  m.add(CYL(0.24, 0.28, 1.1, 5), g2, { x: -1.2, y: 2.25 });
  m.add(ICO(0.26, 0), g2, { x: -1.2, y: 2.8 });
  return m.build();
};

BUILD.camel = () => {
  const m = new Mesher();
  const b = 0xc99c62, d = 0xa97c46;
  m.add(BOX(1.0, 1.1, 2.5), b, { y: 1.95 });
  m.add(ICO(0.5, 0), d, { y: 2.7, z: -0.1, sx: 0.9, sy: 1.1 });
  m.add(BOX(0.4, 1.4, 0.4), b, { y: 2.85, z: 1.25, rx: -0.45 });
  m.add(BOX(0.36, 0.4, 0.75), d, { y: 3.55, z: 1.7 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.add(BOX(0.22, 1.4, 0.22), d, { x: sx * 0.34, y: 0.7, z: sz * 0.9 });
  m.add(BOX(0.12, 0.7, 0.12), d, { y: 1.9, z: -1.35, rx: 0.4 });
  return m.build();
};

BUILD.palm = () => {
  const m = new Mesher();
  const trunk = 0x8a5a33;
  m.add(CYL(0.28, 0.34, 1.9, 6), trunk, { y: 0.95 });
  m.add(CYL(0.24, 0.28, 1.9, 6), trunk, { x: 0.3, y: 2.75, rz: -0.16 });
  m.add(CYL(0.2, 0.24, 1.9, 6), trunk, { x: 0.78, y: 4.5, rz: -0.28 });
  const fr = BOX(1.9, 0.08, 0.55);
  fr.translate(0.95, 0, 0);
  for (let i = 0; i < 7; i++) {
    m.add(fr, i % 2 ? 0x3f9a46 : 0x56b04f, { x: 1.1, y: 5.45, ry: (i * Math.PI * 2) / 7, rz: -0.5, eo: 'YZX' });
  }
  m.add(ICO(0.3, 0), 0x6b4423, { x: 1.1, y: 5.35 });
  return m.build();
};

BUILD.cane = () => {
  const m = new Mesher();
  const stripe = (i) => (i % 2 ? 0xffffff : 0xff3b5c);
  m.add(CYL(0.32, 0.32, 6, 6, 1), (nx, ny, nz, cx, cy) => stripe(Math.floor(cy / 0.55)), { y: 3 });
  const hook = new THREE.TorusGeometry(1, 0.32, 5, 8, Math.PI);
  m.add(hook, (nx, ny, nz, cx, cy) => stripe(Math.floor(Math.atan2(cy - 6, cx + 1) / 0.42)), { x: -1, y: 6 });
  return m.build();
};

BUILD.lollipop = () => {
  const m = new Mesher();
  m.add(CYL(0.16, 0.16, 4.3, 5), 0xffffff, { y: 2.15 });
  const swirl = (nx, ny, nz, cx, cy) => (Math.floor((Math.atan2(cy - 5.5, cx) + Math.PI) / (Math.PI / 6)) % 2 ? 0xffffff : 0xff5fae);
  m.add(CYL(1.6, 1.6, 0.45, 12, 1), swirl, { y: 5.5, rx: Math.PI / 2 });
  return m.build();
};

BUILD.donut = () => {
  const m = new Mesher();
  m.add(new THREE.TorusGeometry(1, 0.42, 6, 10).rotateX(Math.PI / 2), (nx, ny) => (ny > 0.2 ? 0xff7fc0 : 0xe3a863), { y: 0.42 });
  return m.build();
};

BUILD.icecream = () => {
  const m = new Mesher();
  m.add(CYL(1.1, 0.06, 3.4, 8, 1), (nx, ny, nz, cx, cy, cz) => (ihash(Math.round(cx * 5), Math.round(cy * 5), Math.round(cz * 5)) > 0.5 ? 0xe0a860 : 0xcf9650), { y: 1.7 });
  m.add(CYL(1.25, 1.12, 0.4, 8), 0xfff0d6, { y: 3.55 });
  m.add(jit(ICO(1, 1), 0.07, 4), 0xff9fc8, { y: 4.45, sx: 1.25, sy: 1.1, sz: 1.25 });
  m.add(jit(ICO(1, 1), 0.07, 5), 0xa6f0cf, { y: 5.85, sx: 1.0, sy: 0.9, sz: 1.0 });
  m.add(ICO(0.35, 0), 0xe8203a, { y: 6.85 });
  return m.build();
};

BUILD.pillar = () => {
  const g = CYL(0.55, 0.6, 1, 6, 6);
  g.translate(0, 0.5, 0);
  const m = new Mesher();
  m.add(g, (x, y, z, nx, ny) => {
    if (ny > 0.9) return gray(1.5);
    const band = Math.floor(y * 6) % 2 ? 0.72 : 1;
    return gray((0.05 + 0.95 * Math.pow(clamp(y, 0, 1), 1.7)) * band);
  }, { v: true });
  return m.build();
};

BUILD.pyramid = () => {
  const g = new THREE.ConeGeometry(1, 1.3, 4, 1, true);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.65, 0);
  const m = new Mesher();
  m.add(g, (x, y, z, nx, ny, nz) => {
    const face = nx + nz > 0 ? 1 : 0.7;
    return gray((0.06 + 0.94 * Math.pow(clamp(y / 1.3, 0, 1), 1.4)) * face * 1.15);
  }, { v: true });
  return m.build();
};

BUILD.tower = () => {
  const g = BOX(1, 1, 1, 1, 14, 1);
  g.translate(0, 0.5, 0);
  const m = new Mesher();
  m.add(g, (nx, ny, nz, cx, cy, cz) => {
    if (ny > 0.9) return gray(0.3);
    if (ny < -0.9) return gray(0.02);
    const band = Math.floor(cy * 14);
    const h = ihash(band, Math.round(cx * 4 + cz * 3), Math.round(nx * 2 + nz));
    return h > 0.4 ? gray(0.9 + 0.3 * h) : gray(0.04);
  });
  return m.build();
};

BUILD.ring = () => {
  const m = new Mesher();
  m.add(new THREE.TorusGeometry(1, 0.05, 4, 18), gray(1.3), { y: 1 });
  return m.build();
};

BUILD.volcano = () => {
  const m = new Mesher();
  const g = CYL(0.27, 1, 1, 9, 4, true);
  g.translate(0, 0.5, 0);
  jit(g, 0.13, 4, true);
  m.add(g, (nx, ny, nz, cx, cy, cz) => {
    const h = ihash(Math.round(cx * 20), Math.round(cy * 20), Math.round(cz * 20));
    if (cy > 0.62 && h > 0.55) return [2.6, 0.9 + h * 0.4, 0.12]; // glowing lava streaks (over-bright => unlit look)
    const k = 0.7 + 0.5 * h;
    return [0.2 * k, 0.15 * k, 0.13 * k];
  });
  m.add(new THREE.CircleGeometry(0.27, 9).rotateX(-Math.PI / 2), [3.0, 1.3, 0.2], { y: 0.93 });
  const smoke = [0x544c4a, 0x6a615e, 0x7b716d];
  m.add(jit(ICO(1, 0), 0.15, 1), smoke[0], { y: 1.22, sx: 0.3, sy: 0.22, sz: 0.3 });
  m.add(jit(ICO(1, 0), 0.15, 2), smoke[1], { x: 0.08, y: 1.55, z: 0.05, sx: 0.36, sy: 0.26, sz: 0.36 });
  m.add(jit(ICO(1, 0), 0.15, 3), smoke[2], { x: -0.05, y: 1.95, sx: 0.42, sy: 0.3, sz: 0.42 });
  return m.build();
};

BUILD.spire = () => {
  const m = new Mesher();
  const col = (nx, ny, nz, cx, cy, cz) => gray((ny > 0.6 ? 0.34 : 0.17) + 0.06 * ihash(Math.round(cx * 9), Math.round(cy * 9), Math.round(cz * 9)));
  m.add(CYL(0.55, 0.95, 1.0, 6, 1), col, { y: 0.5 });
  m.add(CYL(0.4, 0.7, 0.72, 6, 1), col, { x: 1.35, y: 0.36, z: 0.6 });
  m.add(CYL(0.3, 0.55, 0.5, 6, 1), col, { x: -1.1, y: 0.25, z: -0.8 });
  return m.build();
};

BUILD.road = () => {
  // unit road piece: x = width, z = length. Sidewalk, asphalt and a centre dash baked in.
  const m = new Mesher();
  m.add(BOX(1, 0.5, 1), 0xc6ccd4, { y: 0.25 });
  m.add(BOX(0.76, 0.12, 1.0), 0x454b57, { y: 0.56 });
  m.add(BOX(0.035, 0.1, 0.5), 0xf4e9a8, { y: 0.62 });
  return m.build();
};

BUILD.hut = () => {
  // toy house: pastel walls (tinted per instance) + terracotta hip roof. 16 triangles, very cheap.
  const m = new Mesher();
  m.add(BOX(1, 0.6, 1), [0.95, 0.93, 0.88], { y: 0.3 });
  m.add(new THREE.ConeGeometry(0.78, 0.46, 4, 1, true).rotateY(Math.PI / 4), [0.82, 0.34, 0.24], { y: 0.83 });
  return m.build();
};

BUILD.sunflower = () => {
  const m = new Mesher();
  m.add(CYL(0.09, 0.13, 2.7, 5), 0x3fa83a, { y: 1.35 });
  m.add(BOX(0.7, 0.05, 0.28), 0x35a334, { x: 0.38, y: 0.9, rz: 0.5 });
  m.add(BOX(0.7, 0.05, 0.28), 0x2f9a2f, { x: -0.38, y: 1.4, rz: -0.5 });
  const tilt = Math.PI / 2 - 0.25; // the head faces +Z and a little up
  m.add(CYL(0.85, 0.85, 0.14, 8), (nx, ny, nz, cx, cy) => (Math.floor((Math.atan2(cy - 2.85, cx) + Math.PI) / (Math.PI / 4)) % 2 ? 0xffd51f : 0xffb81a), { y: 2.85, z: 0.1, rx: tilt });
  m.add(CYL(0.45, 0.45, 0.2, 8), 0x6a3c1a, { y: 2.88, z: 0.2, rx: tilt });
  return m.build();
};

BUILD.islet = () => {
  // earth column with a grass cap; tapers to a point below so it also works as a floating island
  const m = new Mesher();
  const strata = [0x8a5428, 0xb8702f, 0xd9923e, 0x9a6030, 0xc47f36];
  const paint = (nx, ny, nz, cx, cy, cz) => {
    if (ny < -0.8) return 0x7a4a22;
    const hh = ihash(Math.round(cx * 5), Math.round(cy * 30), Math.round(cz * 5));
    return strata[(Math.floor(cy * 5 + hh * 0.8) % 5 + 5) % 5];
  };
  const body = CYL(1.0, 0.74, 1.4, 8, 3);
  body.translate(0, 0.7, 0);
  jit(body, 0.06, 21, true);
  m.add(body, paint);
  const cone = CYL(0.74, 0.08, 1.0, 8, 1);
  cone.translate(0, -0.5, 0);
  jit(cone, 0.1, 22, true);
  m.add(cone, paint);
  m.add(CYL(1.07, 1.0, 0.16, 8), (nx, ny) => (ny > 0.7 ? 0x56e033 : 0x3aa820), { y: 1.48 });
  return m.build();
};

BUILD.waterfall = () => {
  // unit strip standing on the ground (y 0..1), faces +Z, with uv for the scrolling water texture
  const g = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  g.translate(0, 0.5, 0);
  return g;
};

BUILD.chimney = () => { // fairy chimney: tuff cone, dark cap stone, cave windows
  const m = new Mesher();
  const body = CYL(0.34, 1.0, 4.2, 9, 4);
  body.translate(0, 2.1, 0);
  jit(body, 0.08, 31, true);
  m.add(body, (nx, ny, nz, cx, cy, cz) => {
    const h = ihash(Math.round(cx * 9), Math.round(cy * 5), Math.round(cz * 9));
    const k = 0.8 + 0.2 * clamp(cy / 4.2, 0, 1) + (h - 0.5) * 0.1;
    return [0.87 * k, 0.58 * k, 0.35 * k];
  });
  m.add(jit(ICO(0.72, 1), 0.1, 32), (nx, ny) => gray(0.1 + 0.07 * clamp(ny + 0.5, 0, 1.5)), { y: 4.45, sy: 0.6 });
  for (const [y, x] of [[0.9, 0.25], [1.8, -0.2], [2.7, 0.08]]) m.add(BOX(0.18, 0.3, 0.1), 0x3a2a24, { x, y, z: (1 - (0.66 * y) / 4.2) * 0.96 });
  m.add(BOX(0.34, 0.5, 0.1), 0x2a1c18, { y: 0.3, z: 0.97 });
  return m.build();
};

BUILD.balloon = () => { // hot-air balloon: striped envelope, basket, ropes
  const m = new Mesher();
  const g = new THREE.SphereGeometry(1.6, 12, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -0.4) { const f = 1 - 0.7 * smooth(-0.4, -1.6, y); p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); }
  }
  g.scale(1, 1.2, 1);
  g.translate(0, 3.5, 0);
  const cols = [0xe8362f, 0xffc21a, 0x2f7de1, 0x2fb96a, 0xff8a2a, 0xf4f4f4];
  m.add(g, (nx, ny, nz, cx, cy, cz) => cols[Math.floor((Math.atan2(cz, cx) + Math.PI) / (Math.PI / 6)) % 6]);
  m.add(BOX(0.7, 0.5, 0.7), 0x8a5a2c, { y: 0.45 });
  m.add(BOX(0.8, 0.1, 0.8), 0x6a4020, { y: 0.74 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.add(BOX(0.04, 0.9, 0.04), 0x3a2a20, { x: sx * 0.3, y: 1.2, z: sz * 0.3 });
  return m.build();
};

BUILD.crystal = () => { // glowing ice crystal cluster (unlit)
  const m = new Mesher();
  const sp = [[0, 0, 1.0, 0.32, 0], [0.5, 0.2, 0.65, 0.22, 0.35], [-0.45, 0.1, 0.75, 0.24, -0.3], [0.1, -0.5, 0.55, 0.2, 0.2]];
  for (const [x, z, h, r, tilt] of sp) {
    const g = CYL(0.04, r, 2.2 * h, 6, 1);
    g.translate(0, 1.1 * h, 0);
    m.add(g, (px, py) => gray(0.35 + 0.9 * clamp(py / (2.2 * h), 0, 1)), { v: true, x, z, rz: tilt });
  }
  return m.build();
};

BUILD.bamboo = () => { // cluster of segmented bamboo stalks with leaf tufts (tint per instance)
  const m = new Mesher();
  for (const [x, z, h, r] of [[0, 0, 6, 0.17], [0.55, 0.25, 5.2, 0.15], [-0.5, 0.3, 5.6, 0.16], [0.15, -0.55, 4.6, 0.14]]) {
    m.add(CYL(r * 0.8, r, h, 6, 1), (nx, ny, nz, cx, cy) => (Math.floor(cy / 0.7) % 2 ? 0x4f9e34 : 0x62b845), { x, z, y: h / 2 });
    for (let y = 0.7; y < h; y += 0.7) m.add(CYL(r * 1.2, r * 1.2, 0.07, 6, 1), 0x2f6a22, { x, z, y });
    m.add(jit(ICO(1, 0), 0.2, 3), 0x7ed04a, { x, z, y: h, sx: 0.7, sy: 0.22, sz: 0.7 });
    m.add(jit(ICO(1, 0), 0.2, 5), 0x9ae060, { x: x + 0.15, z, y: h - 0.7, sx: 0.55, sy: 0.18, sz: 0.55 });
  }
  return m.build();
};

BUILD.icespire = () => { // ice-castle tower: hex keep + cone roof + two turrets, a lit window (tint = blue ice)
  const m = new Mesher();
  const col = (nx, ny, nz, cx, cy, cz) => gray(0.8 + 0.2 * clamp(ny * 0.6 + 0.4, 0, 1) + (ihash(Math.round(cx * 9), Math.round(cy * 9), Math.round(cz * 9)) - 0.5) * 0.12);
  m.add(CYL(0.7, 0.9, 3.2, 6, 1), col, { y: 1.6 });
  m.add(CYL(0.01, 0.85, 2.4, 6, 1), col, { y: 4.4 });
  for (const [x, z, k] of [[1.25, 0.3, 1], [-1.1, -0.4, 0.8]]) {
    m.add(CYL(0.35 * k, 0.45 * k, 2.2 * k, 6, 1), col, { x, z, y: 1.1 * k });
    m.add(CYL(0.01, 0.42 * k, 1.4 * k, 6, 1), col, { x, z, y: 2.9 * k });
  }
  m.add(BOX(0.2, 0.55, 0.1), [2.2, 2.7, 3.2], { y: 2.2, z: 0.82 });
  return m.build();
};

BUILD.ferris = () => { // carnival ferris wheel (ring, spokes, gondolas, lamps); the wheel faces +z
  const m = new Mesher(), R = 2.5, cy = 3.2, gc = [0xff3a5a, 0xffd23a, 0x3aa8ff, 0x5aff9a];
  m.add(new THREE.TorusGeometry(R, 0.08, 4, 20), 0xf4f4ff, { y: cy });
  m.add(new THREE.TorusGeometry(R * 0.55, 0.06, 4, 14), 0xffd23a, { y: cy });
  for (let i = 0; i < 4; i++) m.add(BOX(0.06, R * 2, 0.06), 0xdfe4f0, { y: cy, rz: (i * Math.PI) / 4 });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, x = Math.cos(a) * R, y = cy + Math.sin(a) * R;
    m.add(BOX(0.5, 0.4, 0.5), gc[i % 4], { x, y: y - 0.3 });
    m.add(ICO(0.1, 0), [3.0, 2.4, 0.7], { x, y: y + 0.12 });
  }
  m.add(CYL(0.18, 0.18, 0.3, 6, 1), 0xffd23a, { y: cy, rx: Math.PI / 2 });
  for (const sx of [-1, 1]) m.add(BOX(0.14, 3.6, 0.14), 0x6a4a9a, { x: sx * 0.95, y: 1.6, rz: -sx * 0.3 });
  m.add(BOX(2.6, 0.2, 1.0), 0x4a3a7a, { y: 0.1 });
  return m.build();
};

BUILD.tent = () => { // striped circus tent with a flag
  const m = new Mesher();
  const stripe = (nx, ny, nz, cx, cy, cz) => (Math.floor((Math.atan2(cz, cx) + Math.PI) / (Math.PI / 6)) % 2 ? 0xff3a5a : 0xffffff);
  m.add(CYL(1, 1, 1.2, 12, 1), stripe, { y: 0.6 });
  m.add(CYL(0.02, 1.12, 1.3, 12, 1), stripe, { y: 1.85 });
  m.add(CYL(0.02, 0.02, 0.7, 4, 1), 0x6a4a2a, { y: 2.85 });
  m.add(BOX(0.35, 0.22, 0.02), 0xffd23a, { x: 0.18, y: 3.05 });
  m.add(BOX(0.45, 0.85, 0.05), 0x2a1a3a, { y: 0.43, z: 1.0 });
  m.add(ICO(0.09, 0), [3.0, 2.4, 0.7], { y: 0.95, z: 1.02, x: -0.3 }); m.add(ICO(0.09, 0), [3.0, 2.4, 0.7], { y: 0.95, z: 1.02, x: 0.3 });
  return m.build();
};

BUILD.sakuratree = () => {
  const m = new Mesher();
  m.add(CYL(0.25, 0.42, 2.8, 6), 0x5a3a2a, { y: 1.4 });
  m.add(BOX(0.18, 1.3, 0.18), 0x5a3a2a, { x: 0.5, y: 3.0, rz: -0.6 });
  m.add(BOX(0.18, 1.2, 0.18), 0x5a3a2a, { x: -0.45, y: 2.9, rz: 0.6 });
  const petal = (nx, ny, nz, cx, cy, cz) => {
    const h = ihash(Math.round(cx * 40), Math.round(cy * 40), Math.round(cz * 40));
    const k = 0.82 + 0.18 * clamp(ny * 0.7 + 0.4, 0, 1) + (h - 0.5) * 0.08;
    return [1.0 * k, 0.55 * k, 0.72 * k];
  };
  m.add(jit(ICO(1, 1), 0.12, 41), petal, { y: 4.0, sx: 2.5, sy: 1.4, sz: 2.5 });
  m.add(jit(ICO(1, 0), 0.1, 42), petal, { x: 1.5, y: 3.3, z: 0.5, s: 1.3, sy: 0.8 });
  m.add(jit(ICO(1, 0), 0.1, 43), petal, { x: -1.4, y: 3.4, z: -0.6, s: 1.4, sy: 0.8 });
  m.add(jit(ICO(1, 0), 0.1, 44), petal, { x: 0.1, y: 4.9, z: 0.2, s: 1.3, sy: 0.8 });
  return m.build();
};

BUILD.rbridge = () => { // little red arched footbridge, span along Z
  const m = new Mesher();
  const N = 8;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N, z = -4 + 8 * t, y = 0.25 + 1.7 * Math.sin(Math.PI * t);
    const dy = 1.7 * Math.PI * Math.cos(Math.PI * t) / N;
    const ang = Math.atan2(dy, 1.0);
    m.add(BOX(1.7, 0.22, 1.12), 0xc8322e, { y, z, rx: -ang });
    for (const sx of [-1, 1]) m.add(BOX(0.1, 0.5, 1.1), 0xa82824, { x: sx * 0.8, y: y + 0.38, z, rx: -ang });
  }
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) m.add(BOX(0.2, 0.8, 0.2), 0x7a2a22, { x: sx * 0.85, y: 0.4, z: sz * 4 });
  return m.build();
};

BUILD.pavilion = () => { // tiered pavilion (no symbols)
  const m = new Mesher();
  m.add(BOX(5, 0.5, 5), 0xd8d0c0, { y: 0.25 });
  m.add(BOX(3.6, 1.6, 3.6), 0xf0e4cc, { y: 1.3 });
  m.add(new THREE.ConeGeometry(3.4, 1.0, 4, 1, true).rotateY(Math.PI / 4), 0x8a2a2a, { y: 2.6 });
  m.add(BOX(2.8, 1.3, 2.8), 0xf0e4cc, { y: 3.4 });
  m.add(new THREE.ConeGeometry(2.6, 0.9, 4, 1, true).rotateY(Math.PI / 4), 0x8a2a2a, { y: 4.5 });
  m.add(BOX(1.9, 1.1, 1.9), 0xf0e4cc, { y: 5.15 });
  m.add(new THREE.ConeGeometry(1.9, 0.9, 4, 1, true).rotateY(Math.PI / 4), 0x8a2a2a, { y: 6.1 });
  m.add(CYL(0.05, 0.1, 0.8, 5), 0xe8b84a, { y: 6.9 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.add(BOX(0.22, 1.6, 0.22), 0xb02a28, { x: sx * 1.7, y: 1.3, z: sz * 1.7 });
  return m.build();
};

BUILD.ferry = () => { // Bosphorus ferry, bow along +Z
  const m = new Mesher();
  m.add(BOX(1.6, 0.7, 5), 0x24344e, { y: 0.35 });
  m.add(BOX(1.64, 0.14, 5.04), 0xc8302a, { y: 0.74 });
  m.add(BOX(1.3, 0.7, 3.6), 0xf4f4f4, { y: 1.15 });
  m.add(BOX(1.34, 0.2, 3.2), 0x6a8aa8, { y: 1.2 });
  m.add(BOX(1.0, 0.5, 2.2), 0xf4f4f4, { y: 1.75, z: -0.2 });
  m.add(CYL(0.2, 0.22, 0.7, 6), 0xc8302a, { y: 2.3, z: -0.5 });
  m.add(CYL(0.21, 0.21, 0.12, 6), 0x1a1a1a, { y: 2.68, z: -0.5 });
  m.add(new THREE.ConeGeometry(0.8, 1.0, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2), 0x24344e, { y: 0.35, z: 3.0, sy: 0.7 });
  return m.build();
};

BUILD.gull = () => {
  const m = new Mesher();
  m.add(ICO(0.16, 0), 0xf2f2f2, { sz: 1.9, sy: 0.8 });
  for (const sg of [-1, 1]) m.add(BOX(0.95, 0.03, 0.26), (nx, ny) => gray(ny > 0 ? 0.95 : 0.8), { x: sg * 0.5, y: 0.05, rz: sg * -0.28 });
  m.add(BOX(0.1, 0.1, 0.14), 0xe8a020, { z: 0.34, y: 0 });
  return m.build();
};

BUILD.galata = () => { // Galata Tower
  const m = new Mesher();
  m.add(CYL(1.0, 1.15, 5, 12, 2), (nx, ny, nz, cx, cy) => (Math.floor(cy * 2.4) % 2 ? 0xcdb48a : 0xc4aa80), { y: 2.5 });
  m.add(CYL(1.35, 1.35, 0.25, 12), 0xb09a74, { y: 5.0 });
  m.add(CYL(0.95, 0.95, 1.2, 12), 0xcdb48a, { y: 5.7 });
  m.add(new THREE.ConeGeometry(1.15, 1.5, 12), 0x5a6a72, { y: 7.05 });
  m.add(CYL(0.04, 0.06, 0.7, 5), 0x8a8a8a, { y: 8.1 });
  for (const a of [0, 1.6, 3.1, 4.7]) m.add(BOX(0.16, 0.45, 0.1), 0x2a2420, { x: Math.sin(a) * 0.98, z: Math.cos(a) * 0.98, y: 5.7, ry: a });
  for (const y of [1.6, 3.0, 4.2]) m.add(BOX(0.16, 0.4, 0.1), 0x2a2420, { y, z: 1.05 - y * 0.03 });
  return m.build();
};

BUILD.kiz = () => { // Maiden's Tower on its islet
  const m = new Mesher();
  m.add(CYL(1.5, 1.8, 0.5, 10), 0x8a8478, { y: 0.1 });
  m.add(CYL(0.62, 0.72, 2.2, 10), 0xeae6dc, { y: 1.6 });
  m.add(CYL(0.85, 0.85, 0.18, 10), 0xd8d0c0, { y: 2.75 });
  m.add(CYL(0.55, 0.58, 0.8, 10), 0xeae6dc, { y: 3.25 });
  m.add(ICO(0.6, 1), 0xf4f0e8, { y: 3.65, sy: 0.8, minY: 3.6 });
  m.add(new THREE.ConeGeometry(0.28, 0.5, 8), 0xb83a30, { y: 4.4 });
  m.add(CYL(0.28, 0.28, 0.3, 8), 0xf2e8b0, { y: 4.05 });
  return m.build();
};

BUILD.stall = () => { // street cart with a striped umbrella
  const m = new Mesher();
  m.add(BOX(1.1, 0.55, 0.7), 0xc23a2a, { y: 0.75 });
  m.add(BOX(1.14, 0.1, 0.74), 0xe8d8b0, { y: 1.07 });
  for (const sx of [-1, 1]) m.add(CYL(0.28, 0.28, 0.1, 8), 0x2a2a2a, { x: sx * 0.58, y: 0.3, rz: Math.PI / 2 });
  m.add(CYL(0.03, 0.03, 1.6, 4), 0x6a5a48, { y: 1.8, x: 0.3 });
  m.add(new THREE.ConeGeometry(0.95, 0.45, 8), (nx, ny, nz, cx, cy, cz) => (Math.floor((Math.atan2(cz, cx - 0.3) + Math.PI) / (Math.PI / 4)) % 2 ? 0xf4f4f4 : 0xe03a3a), { y: 2.6, x: 0.3 });
  return m.build();
};

BUILD.susp = () => { // suspension bridge across the strait (half length 95 m), deck along Z
  const m = new Mesher();
  const L = 95, red = 0xb23a30, steel = 0x8a8f98;
  m.add(BOX(14, 1.6, 2 * L), 0x5a5f68, { y: 20 });
  for (const z of [-48, 48]) {
    for (const x of [-5.5, 5.5]) m.add(BOX(2.2, 42, 2.6), red, { x, y: 21, z });
    m.add(BOX(13, 1.8, 2.2), red, { y: 33, z });
    m.add(BOX(13, 1.8, 2.2), red, { y: 40, z });
  }
  const cab = (z0, y0, z1, y1, x) => {
    const dz = z1 - z0, dy = y1 - y0, len = Math.hypot(dz, dy);
    m.add(BOX(0.45, 0.45, len + 0.2), steel, { x, y: (y0 + y1) / 2, z: (z0 + z1) / 2, rx: -Math.atan2(dy, dz) });
  };
  const mainY = (z) => 24 + 18 * (z / 48) * (z / 48);
  for (const x of [-5.5, 5.5]) {
    for (let i = 0; i < 8; i++) { const z0 = -48 + i * 12, z1 = z0 + 12; cab(z0, mainY(z0), z1, mainY(z1), x); }
    for (const sg of [-1, 1]) for (let i = 0; i < 3; i++) {
      const za = sg * (48 + i * 15.7), zb = sg * (48 + (i + 1) * 15.7);
      const ya = 42 - (21 * i) / 3, yb = 42 - (21 * (i + 1)) / 3;
      cab(za, ya, zb, yb, x);
    }
    for (let z = -40; z <= 40; z += 10) { const h = mainY(z) - 20.8; if (h > 0.6) m.add(BOX(0.14, h, 0.14), steel, { x, y: 20.8 + h / 2, z }); }
  }
  return m.build();
};

BUILD.crater = () => {
  const m = new Mesher();
  m.add(new THREE.CircleGeometry(0.92, 14).rotateX(-Math.PI / 2), gray(0.5), { y: 0.05 });
  m.add(new THREE.TorusGeometry(1.0, 0.16, 4, 14).rotateX(Math.PI / 2), gray(1.1), { y: 0.1 });
  return m.build();
};

BUILD.dome = () => { // habitat dome
  const m = new Mesher();
  m.add(ICO(1, 1), (nx, ny) => gray(0.7 + 0.28 * clamp(ny, 0, 1)), { minY: -0.02 });
  m.add(CYL(1.12, 1.12, 0.18, 14), gray(0.5), { y: 0.09 });
  m.add(BOX(0.5, 0.75, 0.3), 0x2a3a58, { z: 0.92, y: 0.38 });
  for (const sx of [-1, 1]) m.add(BOX(0.3, 0.22, 0.08), 0x2a4a78, { x: sx * 0.52, y: 0.62, z: 0.78, ry: sx * 0.6 });
  m.add(CYL(0.03, 0.03, 0.7, 4), gray(0.8), { y: 1.2 });
  return m.build();
};

BUILD.flag = () => { // plain orange survey flag
  const m = new Mesher();
  m.add(CYL(0.05, 0.05, 3.2, 5), gray(0.8), { y: 1.6 });
  m.add(BOX(1.1, 0.7, 0.04), 0xff7a1a, { x: 0.57, y: 2.8 });
  m.add(BOX(0.34, 0.34, 0.05), 0xffffff, { x: 0.35, y: 2.8 });
  m.add(CYL(0.4, 0.5, 0.15, 8), gray(0.5), { y: 0.07 });
  return m.build();
};

BUILD.rover = () => {
  const m = new Mesher();
  m.add(BOX(1.4, 0.4, 2.2), 0xe8e8ee, { y: 0.9 });
  m.add(BOX(1.9, 0.05, 1.1), 0x203a78, { y: 1.35, z: -0.2, rx: -0.15 });
  m.add(CYL(0.04, 0.04, 0.8, 4), gray(0.7), { y: 1.5, z: 0.8 });
  m.add(ICO(0.14, 0), gray(0.9), { y: 1.95, z: 0.8 });
  for (const sx of [-1, 1]) for (const z of [-0.9, 0, 0.9]) m.add(CYL(0.32, 0.32, 0.25, 8), gray(0.12), { x: sx * 0.85, y: 0.34, z, rz: Math.PI / 2 });
  return m.build();
};

BUILD.ship = () => { // pirate ship, bow +Z
  const m = new Mesher();
  const wood = 0x6a4020, wood2 = 0x4a2c16, sail = 0xf2e8c8;
  m.add(BOX(2.4, 1.1, 6), wood, { y: 0.55 });
  m.add(BOX(2.44, 0.12, 6.04), wood2, { y: 1.1 });
  m.add(BOX(2.4, 0.9, 1.8), wood, { y: 1.55, z: -2.1 });
  m.add(new THREE.ConeGeometry(1.2, 2.2, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2), wood, { y: 0.55, z: 4.0, sy: 0.9 });
  m.add(CYL(0.1, 0.13, 6.2, 6), wood2, { y: 4.0, z: 0.8 });
  m.add(CYL(0.09, 0.12, 4.6, 6), wood2, { y: 3.4, z: -1.7 });
  m.add(BOX(3.2, 0.1, 0.1), wood2, { y: 6.2, z: 0.8 });
  m.add(BOX(2.8, 0.1, 0.1), wood2, { y: 5.2, z: 0.8 });
  m.add(BOX(2.9, 2.6, 0.06), sail, { y: 3.9, z: 0.95 });
  m.add(BOX(2.4, 1.9, 0.06), sail, { y: 3.9, z: -1.55 });
  m.add(BOX(0.9, 0.55, 0.04), 0x1a1a1a, { x: 0.5, y: 6.4, z: -1.7 });
  m.add(CYL(0.04, 0.04, 1.6, 4), wood2, { y: 4.2, z: 4.2, rx: 0.5 });
  return m.build();
};

BUILD.chest = () => {
  const m = new Mesher();
  m.add(BOX(1.2, 0.6, 0.8), 0x7a4a24, { y: 0.3 });
  m.add(CYL(0.4, 0.4, 1.2, 8), 0x8a5a2c, { y: 0.6, rz: Math.PI / 2 });
  for (const sx of [-1, 1]) m.add(BOX(0.12, 0.64, 0.84), 0xffc21a, { x: sx * 0.38, y: 0.32 });
  m.add(BOX(0.16, 0.22, 0.06), 0xffd84a, { y: 0.55, z: 0.42 });
  m.add(ICO(0.2, 0), 0xffd21f, { x: 0.8, y: 0.12, z: 0.3 });
  m.add(ICO(0.16, 0), 0xffc21a, { x: 0.95, y: 0.1, z: 0.05 });
  return m.build();
};

BUILD.lighthouse = () => {
  const m = new Mesher();
  m.add(jit(ICO(1, 1), 0.15, 51), (nx, ny) => gray(0.4 + 0.25 * clamp(ny, 0, 1)), { y: 0.1, sx: 1.9, sy: 0.7, sz: 1.9, minY: -0.1 });
  m.add(CYL(0.7, 1.1, 6, 10, 3), (nx, ny, nz, cx, cy) => (Math.floor(cy * 1.2) % 2 ? 0xf4f0e8 : 0xd8302a), { y: 3.0 });
  m.add(CYL(1.05, 1.05, 0.2, 10), 0x3a3a42, { y: 6.1 });
  m.add(CYL(0.55, 0.55, 0.8, 10), [2.4, 2.1, 1.3], { y: 6.6 });
  m.add(new THREE.ConeGeometry(0.75, 0.7, 10), 0xd8302a, { y: 7.35 });
  return m.build();
};

BUILD.cloud = () => {
  const m = new Mesher();
  const paint = (nx, ny) => (ny > 0.15 ? gray(1) : [0.86, 0.9, 0.98]);
  m.add(jit(ICO(1, 1), 0.08, 1), paint, { sy: 0.62 });
  m.add(jit(ICO(1, 0), 0.08, 2), paint, { x: 0.95, y: -0.08, z: 0.1, s: 0.66, sy: 0.7 });
  m.add(jit(ICO(1, 0), 0.08, 3), paint, { x: -0.9, y: -0.1, z: -0.12, s: 0.62, sy: 0.7 });
  m.add(jit(ICO(1, 0), 0.08, 4), paint, { x: 0.15, y: 0.18, z: 0.7, s: 0.55, sy: 0.7 });
  return m.build();
};

// ---- per-biome roadside extras (Yeti Rush): forest stumps + log piles, ice-cave seals + stalagmites, town fences / benches / lamp posts,
// desert skull rocks, volcano camp fires, candy jelly cubes, neon robots. Unit-ish models, origin on the ground, front = +Z.
BUILD.stump = () => {
  const m = new Mesher();
  m.add(CYL(0.55, 0.75, 0.9, 7), (nx, ny) => (ny > 0.8 ? 0xd9b77a : 0x7a5532), { y: 0.45 });
  m.add(CYL(0.62, 0.9, 0.2, 7), 0x5a3d22, { y: 0.1 });
  m.add(CYL(0.28, 0.28, 0.04, 6), 0xb08850, { y: 0.92 });
  m.add(CYL(0.4, 0.4, 0.03, 6), 0xc49a60, { y: 0.915 });
  return m.build();
};

BUILD.logs = () => {
  const m = new Mesher(), cut = 0xd9b77a;
  const log = (x, y, z, ry, c) => m.add(CYL(0.32, 0.32, 2.2, 7), (nx) => (Math.abs(nx) > 0.85 ? cut : c), { x, y, z, rz: Math.PI / 2, ry });
  log(0, 0.32, -0.36, 0.06, 0x7a5532); log(0.05, 0.32, 0.36, -0.05, 0x8f6a40); log(0, 0.92, 0, 0.02, 0x6f4a2a);
  return m.build();
};

BUILD.seal = () => {
  const m = new Mesher(), b = 0x6f7f9e, belly = 0xb4c0d6, dark = 0x14161c;
  m.add(jit(ICO(1, 1), 0.05, 61), (nx, ny) => (ny < -0.15 ? belly : b), { y: 0.42, sx: 0.55, sy: 0.42, sz: 1.05 });
  m.add(ICO(0.28, 1), b, { y: 0.68, z: 0.95 });
  for (const sx of [-1, 1]) {
    m.add(ICO(0.05, 0), dark, { x: sx * 0.11, y: 0.76, z: 1.2 });
    m.add(BOX(0.4, 0.07, 0.5), 0x5a6a88, { x: sx * 0.3, y: 0.1, z: -1.05 });
  }
  m.add(ICO(0.07, 0), dark, { y: 0.67, z: 1.22 });
  return m.build();
};

BUILD.stalag = () => { // ice spikes growing from the ground (lit)
  const m = new Mesher();
  for (const [x, z, h, r] of [[0, 0, 2.6, 0.5], [0.6, 0.3, 1.6, 0.32], [-0.5, 0.4, 1.9, 0.38], [0.2, -0.55, 1.1, 0.26]]) {
    m.add(new THREE.ConeGeometry(r, h, 6).translate(0, h / 2, 0), (nx, ny, nz, cx, cy) => [0.62 + 0.38 * clamp(cy / h, 0, 1), 0.82 + 0.18 * clamp(cy / h, 0, 1), 1.0], { x, z });
  }
  return m.build();
};

BUILD.fence = () => { // 5 m picket fence section along X
  const m = new Mesher();
  for (let i = -2; i <= 2; i++) m.add(BOX(0.16, 1.0, 0.16), 0xf4f4f4, { x: i * 1.2, y: 0.5 });
  m.add(BOX(5.2, 0.12, 0.06), 0xe2e2e2, { y: 0.34 });
  m.add(BOX(5.2, 0.12, 0.06), 0xe2e2e2, { y: 0.78 });
  return m.build();
};

BUILD.bench = () => {
  const m = new Mesher();
  m.add(BOX(1.8, 0.1, 0.55), 0xb07a42, { y: 0.5 });
  m.add(BOX(1.8, 0.45, 0.08), 0x8f5f32, { y: 0.85, z: -0.24, rx: 0.12 });
  for (const sx of [-1, 1]) m.add(BOX(0.1, 0.5, 0.5), 0x4a5060, { x: sx * 0.78, y: 0.25 });
  return m.build();
};

BUILD.lampost = () => {
  const m = new Mesher();
  m.add(CYL(0.08, 0.12, 3.6, 5), 0x3a3f4c, { y: 1.8 });
  m.add(BOX(0.8, 0.07, 0.07), 0x3a3f4c, { x: 0.38, y: 3.6 });
  m.add(ICO(0.24, 0), [2.6, 2.2, 1.3], { x: 0.78, y: 3.5 });
  return m.build();
};

BUILD.skullrock = () => { // sun-bleached cattle skull on a rock
  const m = new Mesher();
  m.add(jit(ICO(1, 1), 0.2, 71), (nx, ny) => gray(0.5 + 0.3 * clamp(ny, 0, 1)), { y: 0.2, sx: 0.85, sy: 0.45, sz: 0.85 });
  m.add(ICO(0.34, 1), 0xefe6cf, { y: 0.8, z: 0.06, sy: 0.92 });
  m.add(BOX(0.2, 0.34, 0.2), 0xe6dcc4, { y: 0.6, z: 0.32 });
  for (const sx of [-1, 1]) {
    m.add(BOX(0.16, 0.18, 0.06), 0x2a1f1a, { x: sx * 0.14, y: 0.86, z: 0.31 });
    m.add(CYL(0.04, 0.09, 0.55, 5), 0xe8dcc0, { x: sx * 0.42, y: 1.0, z: 0.02, rz: -sx * 0.95 });
  }
  return m.build();
};

BUILD.fire = () => { // camp fire in a stone ring (unlit type: colours are over-bright)
  const m = new Mesher();
  for (let i = 0; i < 7; i++) { const a = (i * Math.PI * 2) / 7; m.add(ICO(0.2, 0), [0.62, 0.52, 0.46], { x: Math.cos(a) * 0.6, y: 0.16, z: Math.sin(a) * 0.6 }); }
  m.add(new THREE.ConeGeometry(0.42, 1.4, 6).translate(0, 0.7, 0), (nx, ny, nz, cx, cy) => [2.6, 0.7 + 1.1 * clamp(cy / 1.4, 0, 1), 0.12], { y: 0.1 });
  m.add(new THREE.ConeGeometry(0.26, 1.0, 5).translate(0, 0.5, 0), [3.0, 2.0, 0.5], { x: 0.18, y: 0.1, z: 0.1 });
  m.add(new THREE.ConeGeometry(0.2, 0.8, 5).translate(0, 0.4, 0), [2.8, 1.3, 0.2], { x: -0.22, y: 0.1, z: -0.1 });
  return m.build();
};

BUILD.jellycube = () => { // wobbly jelly block with a white plate (tinted per instance)
  const m = new Mesher();
  m.add(BOX(1, 0.86, 1), (nx, ny) => (ny > 0.8 ? gray(1.25) : gray(0.9)), { y: 0.5 });
  m.add(BOX(1.08, 0.12, 1.08), 0xffffff, { y: 0.06 });
  m.add(ICO(0.12, 0), 0xffffff, { x: -0.22, y: 0.98, z: 0.2 });
  return m.build();
};

BUILD.robot = () => { // little patrol robot (unlit, tinted per instance)
  const m = new Mesher();
  m.add(BOX(0.8, 0.9, 0.55), gray(1.5), { y: 1.0 });
  m.add(BOX(0.6, 0.45, 0.5), gray(1.9), { y: 1.7 });
  m.add(BOX(0.5, 0.1, 0.06), [3.0, 3.0, 3.0], { y: 1.72, z: 0.27 });
  m.add(CYL(0.04, 0.04, 0.4, 4), gray(1.2), { y: 2.1 });
  m.add(ICO(0.1, 0), [3.0, 1.0, 1.0], { y: 2.34 });
  for (const sx of [-1, 1]) {
    m.add(BOX(0.2, 0.7, 0.2), gray(1.1), { x: sx * 0.52, y: 1.0 });
    m.add(BOX(0.25, 0.55, 0.3), gray(0.8), { x: sx * 0.2, y: 0.27 });
  }
  return m.build();
};

// ---------------------------------------------------------------------------------------------
// prop-library recolours (the lib is built for a snowy mountain: white snow caps on everything)
// ---------------------------------------------------------------------------------------------
function recolor(src, fn) {
  const g = src.clone();
  const pos = g.attributes.position, col = g.attributes.color;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    if (col.getX(i) < 0.93 || col.getY(i) < 0.93 || col.getZ(i) < 0.93) continue; // not snow-white
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nl = Math.hypot(nx, ny, nz) || 1;
    const c = fn(ny / nl, (ay + by + cy) / 3);
    if (!c) continue;
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, c.r, c.g, c.b);
  }
  return g;
}
const mkRoofRc = (base, roof) => {
  const cb = new THREE.Color(base), cr = new THREE.Color(roof);
  return (ny, cy) => (ny > 0.5 ? (cy < 1.3 ? cb : cr) : null);
};
const mkTopRc = (c) => { const cc = new THREE.Color(c); return (ny) => (ny > 0.5 ? cc : null); };
const mkAllRc = (c) => { const cc = new THREE.Color(c); return () => cc; };

// ---------------------------------------------------------------------------------------------
// decor type registry
//   make(): own geometry   lib: name in the prop library (shared geometry, optionally recoloured by rc)
// ---------------------------------------------------------------------------------------------
const TDEF = {
  hill: { make: BUILD.hill, cap: 130 },
  rock: { make: BUILD.rock, cap: 120 },
  pond: { make: BUILD.pond, cap: 70 },
  lava: { make: BUILD.pond, cap: 70, glow: true },
  roundtree: { make: BUILD.roundtree, cap: 240, sink: 0.4 },
  peak: { make: BUILD.peak, cap: 24 },
  mesa: { make: BUILD.mesa, cap: 40 },
  cactus: { make: BUILD.cactus, cap: 140, sink: 0.2 },
  camel: { make: BUILD.camel, cap: 40 },
  palm: { make: BUILD.palm, cap: 90, sink: 0.2 },
  sunflower: { make: BUILD.sunflower, cap: 220, sink: 0.1 },
  islet: { make: BUILD.islet, cap: 40 },
  waterfall: { make: BUILD.waterfall, cap: 16, water: true },
  chimney: { make: BUILD.chimney, cap: 170, sink: 0.3 },
  balloon: { make: BUILD.balloon, cap: 70 },
  crystal: { make: BUILD.crystal, cap: 170, glow: true, sink: 0.1 },
  sakuratree: { make: BUILD.sakuratree, cap: 220, sink: 0.4 },
  rbridge: { make: BUILD.rbridge, cap: 20 },
  pavilion: { make: BUILD.pavilion, cap: 24 },
  ferry: { make: BUILD.ferry, cap: 40 },
  gull: { make: BUILD.gull, cap: 90 },
  galata: { make: BUILD.galata, cap: 14, sink: 0.5 },
  kiz: { make: BUILD.kiz, cap: 14 },
  stall: { make: BUILD.stall, cap: 60 },
  susp: { make: BUILD.susp, cap: 6 },
  crater: { make: BUILD.crater, cap: 130 },
  dome: { make: BUILD.dome, cap: 24 },
  flag: { make: BUILD.flag, cap: 40 },
  rover: { make: BUILD.rover, cap: 24 },
  ship: { make: BUILD.ship, cap: 20 },
  chest: { make: BUILD.chest, cap: 40 },
  lighthouse: { make: BUILD.lighthouse, cap: 8, sink: 0.3 },
  cane: { make: BUILD.cane, cap: 150, sink: 0.4 },
  lollipop: { make: BUILD.lollipop, cap: 120, sink: 0.4 },
  donut: { make: BUILD.donut, cap: 60 },
  icecream: { make: BUILD.icecream, cap: 16, sink: 0.2 },
  pillar: { make: BUILD.pillar, cap: 110, glow: true },
  pyramid: { make: BUILD.pyramid, cap: 24, glow: true },
  tower: { make: BUILD.tower, cap: 90, glow: true },
  ring: { make: BUILD.ring, cap: 24, glow: true },
  volcano: { make: BUILD.volcano, cap: 14 },
  spire: { make: BUILD.spire, cap: 50 },
  road: { make: BUILD.road, cap: 320 },
  hut: { make: BUILD.hut, cap: 200 },
  stump: { make: BUILD.stump, cap: 120 },
  logs: { make: BUILD.logs, cap: 60 },
  seal: { make: BUILD.seal, cap: 40 },
  stalag: { make: BUILD.stalag, cap: 90, sink: 0.1 },
  fence: { make: BUILD.fence, cap: 100 },
  bench: { make: BUILD.bench, cap: 40 },
  lampost: { make: BUILD.lampost, cap: 80 },
  skullrock: { make: BUILD.skullrock, cap: 50 },
  fire: { make: BUILD.fire, cap: 40, glow: true },
  jellycube: { make: BUILD.jellycube, cap: 100 },
  robot: { make: BUILD.robot, cap: 50, glow: true },
  bamboo: { make: BUILD.bamboo, cap: 260, sink: 0.3 },
  icespire: { make: BUILD.icespire, cap: 70, sink: 0.3 },
  ferris: { make: BUILD.ferris, cap: 12 },
  tent: { make: BUILD.tent, cap: 40 },
  // library props, snowy originals
  pine: { lib: 'pine', cap: 220, sink: 0.4 },
  pine_big: { lib: 'pine_big', cap: 90, sink: 0.4 },
  cabin: { lib: 'cabin', cap: 30 },
  snowman: { lib: 'snowman', cap: 20 },
  boulder: { lib: 'boulder', cap: 60 },
  // library props, de-snowed
  pineG: { lib: 'pine', rc: mkAllRc(0x5fd486), cap: 260, sink: 0.4 },
  pineBigG: { lib: 'pine_big', rc: mkAllRc(0x4fc977), cap: 100, sink: 0.4 },
  house: { lib: 'house', rc: mkRoofRc(0xbdc7a8, 0xd9694a), cap: 50 },
  house_tall: { lib: 'house_tall', rc: mkRoofRc(0xbdc7a8, 0x3b9aae), cap: 40 },
  shop: { lib: 'shop', rc: mkRoofRc(0xbdc7a8, 0x7a4e3a), cap: 40 },
  apartment: { lib: 'apartment', rc: mkRoofRc(0xbdc7a8, 0x9aa1ab), cap: 30 },
  clocktower: { lib: 'clocktower', rc: mkRoofRc(0xbdc7a8, 0x2f9e9e), cap: 8 },
  car: { lib: 'car', rc: mkTopRc(0xe8362f), cap: 30 },
  car_blue: { lib: 'car_blue', rc: mkTopRc(0x2f7de1), cap: 30 },
};

// Types each biome uses: created one per frame in the biome before, so no frame ever builds a dozen geometries at once.
const BIOME_TYPES = {
  snow: ['pine', 'pine_big', 'cabin', 'snowman', 'boulder', 'pond', 'hill', 'peak'],
  forest: ['pineG', 'pineBigG', 'roundtree', 'rock', 'pond', 'hill', 'stump', 'logs'],
  town: ['road', 'hut', 'house', 'house_tall', 'shop', 'apartment', 'car', 'car_blue', 'roundtree', 'pineG', 'clocktower', 'fence', 'bench', 'lampost'],
  greenhill: ['hill', 'roundtree', 'palm', 'sunflower', 'islet', 'waterfall', 'pond'],
  desert: ['hill', 'mesa', 'cactus', 'camel', 'rock', 'palm', 'pond', 'skullrock'],
  kapadokya: ['hill', 'chimney', 'rock', 'balloon'],
  icecave: ['hill', 'crystal', 'rock', 'pond', 'seal', 'stalag'],
  sakura: ['hill', 'sakuratree', 'pavilion', 'rbridge', 'pond', 'rock'],
  istanbul: ['hut', 'stall', 'roundtree', 'galata', 'ferry', 'kiz', 'susp', 'gull', 'rock'],
  moon: ['crater', 'hill', 'rock', 'dome', 'flag', 'rover'],
  pirate: ['hill', 'palm', 'ship', 'lighthouse', 'chest', 'rock'],
  candy: ['hill', 'cane', 'lollipop', 'donut', 'icecream', 'pond', 'jellycube'],
  neon: ['pillar', 'tower', 'pyramid', 'ring', 'peak', 'robot'],
  volcano: ['volcano', 'hill', 'lava', 'rock', 'spire', 'fire'],
  aurora: ['peak', 'hill', 'pine', 'pine_big', 'boulder', 'pond', 'crystal'],
  bamboo: ['hill', 'bamboo', 'roundtree', 'rock', 'pond', 'pavilion', 'rbridge'],
  glacier: ['peak', 'hill', 'icespire', 'crystal', 'stalag', 'pond', 'seal'],
  carnival: ['hill', 'ferris', 'tent', 'balloon', 'lollipop', 'ring', 'tower'],
};

// ---------------------------------------------------------------------------------------------
// canvas textures (guarded: absent in non-DOM environments)
// ---------------------------------------------------------------------------------------------
function canvasTex(w, h, draw) {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch (e) { return null; }
}
const sunTexture = () => canvasTex(256, 256, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(DISC_F * 0.94, 'rgba(255,255,255,1)');
  gr.addColorStop(DISC_F, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
});
const retroSunTexture = () => canvasTex(256, 256, (g, w, h) => {
  const cx = w / 2, cy = h / 2, R = (w / 2) * DISC_F;
  const halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, w / 2);
  halo.addColorStop(0, 'rgba(255,70,200,0.5)');
  halo.addColorStop(1, 'rgba(255,70,200,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  const lg = g.createLinearGradient(0, cy - R, 0, cy + R);
  lg.addColorStop(0, '#fff06a');
  lg.addColorStop(0.5, '#ff8a3d');
  lg.addColorStop(1, '#ff2f9a');
  g.fillStyle = lg;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) g.fillRect(cx - R, cy + R * 0.02 + i * R * 0.15, R * 2, 1.5 + i * 1.3);
  g.restore();
});
const earthTexture = () => canvasTex(256, 256, (g, w, h) => {
  const cx = w / 2, cy = h / 2, R = (w / 2) * DISC_F;
  const halo = g.createRadialGradient(cx, cy, R * 0.95, cx, cy, w / 2);
  halo.addColorStop(0, 'rgba(120,180,255,0.35)');
  halo.addColorStop(1, 'rgba(120,180,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#2a6ad8';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#3aa85a';
  for (const [x, y, r] of [[-0.3, -0.2, 0.45], [0.35, 0.15, 0.4], [-0.1, 0.5, 0.25], [0.2, -0.55, 0.2]]) { g.beginPath(); g.arc(cx + x * R, cy + y * R, r * R, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (const [x, y, r] of [[-0.45, 0.1, 0.22], [0.1, -0.1, 0.3], [0.5, 0.45, 0.18], [-0.1, -0.6, 0.18]]) { g.beginPath(); g.arc(cx + x * R, cy + y * R, r * R, 0, Math.PI * 2); g.fill(); }
  const sh = g.createLinearGradient(cx - R, 0, cx + R, 0);
  sh.addColorStop(0, 'rgba(0,0,20,0)');
  sh.addColorStop(0.55, 'rgba(0,0,20,0.15)');
  sh.addColorStop(1, 'rgba(0,0,20,0.75)');
  g.fillStyle = sh;
  g.fillRect(0, 0, w, h);
  g.restore();
});
const dotTexture = () => canvasTex(32, 32, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
});
const waterfallTexture = () => {
  const t = canvasTex(32, 128, (g, w, h) => {
    g.fillStyle = 'rgba(170,225,255,0.5)';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(ihash(i, 91) * (w - 3)), y = Math.floor(ihash(i, 92) * h), len = 24 + Math.floor(ihash(i, 93) * 56);
      g.fillStyle = ihash(i, 94) > 0.5 ? 'rgba(255,255,255,0.95)' : 'rgba(225,246,255,0.8)';
      g.fillRect(x, y, 2 + Math.floor(ihash(i, 95) * 3), len);
      if (y + len > h) g.fillRect(x, y - h, 3, len); // wrap so the scroll is seamless
    }
  });
  if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 2.5); }
  return t;
};
const gridTexture = () => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(0, 0, w, 12);
  g.fillRect(0, 0, 12, h);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, 4);
  g.fillRect(0, 0, 4, h);
});

// ---------------------------------------------------------------------------------------------
// scenery generators (one per biome); E = Environment, R = chunk rng
//   E._put(name, s, u, sx, sy, sz, yaw, tint, opts)   E._sc(name, count, uMin, uMax, scaleMin, scaleMax, opts)
// ---------------------------------------------------------------------------------------------
const FLANK_TAU = [0.04, 0.08, 0.14, 0.22, 0.33, 0.47, 0.65, 0.85, 1.0]; // flank profile points as fractions of the flank width
const O_ROAD = { lift: 0.25, block: false };
const O_ROADX = { lift: 0.55, block: false };
const O_HILL_SNOW = { rel: false, my: 0.24, pal: P.snowHill, ov: 0.6, lift: -0.4 };
const O_PEAK_SNOW = { my: 1.8, pal: P.snowPeak, ov: 0.9, block: false };
const O_PINE = { pal: P.pineTint, clump: 0.3 };
const O_PINE_V = { pal: P.pineTint, clump: 0.3, rel: true };

// Lateral ranges: absolute (metres from the centre line) = on the mountain flank; { rel: true } = counted from the toe of
// the flank (valley floor). U = lateral extent of the flank of this chunk's biome.
const GEN = {
  snow(E, R) {
    const U = E._cU + 3.5;
    E._sc('peak', 0.5, 145, 215, 45, 85, O_PEAK_SNOW);
    E._sc('hill', 2.4, 130, 195, 24, 46, O_HILL_SNOW);
    if (R.next() < 0.35) E._sc('pond', 1, 18, 70, 14, 32, { rel: true, floor: true, mz: 0.75, pal: P.ice, lift: 0.5, ov: 0.9 });
    // the run cuts through pines on the slope ...
    E._sc('pine', 11, 17, U - 4, 1.0, 1.7, O_PINE);
    E._sc('pine_big', 3, 20, U - 4, 1.0, 1.5, O_PINE);
    E._sc('boulder', 2.5, 16, U, 0.9, 1.9, { pal: P.pineTint });
    E._sc('snowman', 0.7, 17, 55, 2.2, 3.0, { yaw: 'face' });
    // ... and the valley below is forest with a few chalets
    E._sc('pine', 12, 6, 75, 1.2, 2.0, O_PINE_V);
    E._sc('pine_big', 4, 6, 75, 1.2, 1.9, O_PINE_V);
    E._sc('cabin', 1.1, 8, 85, 1.3, 1.7, { rel: true, yaw: 'face', pal: P.bld });
    E._sc('boulder', 1.5, 6, 80, 1.2, 2.4, { rel: true, pal: P.pineTint });
  },

  forest(E, R) {
    const s0 = E._ch.s0, U = E._cU + 3.5;
    const side = biomeIdx(s0) & 1 ? 1 : -1;
    E._sc('hill', 2.8, 120, 190, 26, 50, { my: 0.27, pal: P.grassHill, ov: 0.6, lift: -0.4 });
    // a river winding along the valley floor
    for (let j = 0; j < 2; j++) {
      const s = s0 + 12 + j * 25;
      const u = side * (U + 34 + 20 * Math.sin(s / 140 + 1.1) + 7 * Math.sin(s / 47));
      const k = side * ((20 / 140) * Math.cos(s / 140 + 1.1) + (7 / 47) * Math.cos(s / 47));
      E._put('pond', s, u, 8.5, 1, 18, 'path', P.water[(R.next() * 3) | 0], { yo: -Math.atan(k), lift: 0.5, ov: 0.9, floor: true });
    }
    if (R.next() < 0.3) E._sc('pond', 1, 15, 80, 14, 30, { rel: true, floor: true, pal: P.water, mz: 0.8, lift: 0.5, ov: 0.9 });
    // slope forest
    E._sc('pineBigG', 4, 18, U - 4, 1.0, 1.6, { pal: P.pineTint, clump: 0.3 });
    E._sc('pineG', 12, 17, U - 4, 1.1, 1.8, { pal: P.pineTint, clump: 0.3 });
    E._sc('roundtree', 7, 17, U - 4, 1.0, 1.7, { pal: P.treeTint, clump: 0.3 });
    E._sc('rock', 2, 16, U, 0.9, 2.2, { pal: P.rockGrey });
    E._sc('stump', 4, 16, U - 4, 1.5, 2.4, {});                 // stumps + log piles along the slope
    E._sc('logs', 1.6, 16, U - 4, 1.5, 2.1, {});
    // valley forest
    E._sc('pineBigG', 4, 6, 85, 1.2, 1.9, { pal: P.pineTint, clump: 0.3, rel: true });
    E._sc('pineG', 9, 6, 85, 1.4, 2.2, { pal: P.pineTint, clump: 0.3, rel: true });
    E._sc('roundtree', 8, 6, 85, 1.3, 2.1, { pal: P.treeTint, clump: 0.3, rel: true });
  },

  town(E, R) {
    const s0 = E._ch.s0, U = E._cU + 3.5; // U: toe of the (short, steep, grassy) slope; the village lies on the valley floor
    for (let side = -1; side <= 1; side += 2) {
      // a road hugging the foot of the mountain, two parallel streets, a cross street per chunk
      for (let k = 0; k < 3; k++) {
        const u = side * (U + 5 + k * 44);
        for (let j = 0; j < 4; j++) E._put('road', s0 + 6.25 + j * 12.5, u, 9.6, 1, 14.5, 'path', null, O_ROAD);
      }
      E._put('road', s0, side * (U + 5 + 60), 9.6, 1, 124, 'right', null, O_ROADX);
      // traffic
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 4; j++) {
          if (R.next() > 0.09) continue;
          const sgn = R.next() < 0.5 ? -1 : 1;
          E._put(R.next() < 0.5 ? 'car' : 'car_blue', s0 + 6.25 + j * 12.5, side * (U + 5 + k * 44) + sgn * 2.3, 1.55, 1.55, 1.55, sgn > 0 ? 'path' : 'pathR', null, O_CAR);
        }
      }
      // blocks
      for (let kb = 0; kb < 3; kb++) {
        const uc = side * (U + 5 + 22 + 44 * kb);
        const near = kb < 2;
        for (let row = -1; row <= 1; row += 2) {
          for (let j = 0; j < 2; j++) {
            const s = s0 + 15 + j * 20 + (R.next() - 0.5) * 4;
            const u = uc + row * 9.5;
            const face = row < 0 ? 'left' : 'right';
            const r = R.next();
            if (near ? r < 0.3 : r < 0.07) {
              const q = R.next();
              const name = q < 0.34 ? 'house' : q < 0.58 ? 'house_tall' : q < 0.82 ? 'shop' : 'apartment';
              const sc = 1.3 + R.next() * 0.35;
              E._put(name, s, u, sc, sc, sc, face, P.bld[(R.next() * P.bld.length) | 0], O_BLD);
            } else if (near ? r < 0.88 : r < 0.8) {
              const sc = 8.5 + R.next() * 3.5;
              E._put('hut', s, u, sc, sc * (0.9 + R.next() * 0.3), sc, face, P.hutWall[(R.next() * P.hutWall.length) | 0], O_BLD);
            }
          }
        }
        const sc = 1.0 + R.next() * 0.7;
        E._put(R.next() < 0.7 ? 'roundtree' : 'pineG', s0 + 6 + R.next() * 38, uc + (R.next() - 0.5) * 6, sc, sc, sc, undefined, P.treeTint[(R.next() * P.treeTint.length) | 0]);
      }
    }
    // grassy mountain slope above the village: fences, benches, street lamps
    E._sc('fence', 3.5, 16, U - 6, 1.6, 2.2, {});
    E._sc('bench', 1.6, 16, U - 6, 1.8, 2.4, {});
    E._sc('lampost', 3, 16, U - 6, 1.6, 2.2, {});
    E._sc('pineG', 6, 17, U - 6, 1.1, 1.7, { pal: P.pineTint, clump: 0.3 });
    E._sc('roundtree', 4, 17, U - 6, 1.1, 1.7, { pal: P.treeTint, clump: 0.3 });
    if (R.next() < 0.2) E._sc('clocktower', 1, 15, 80, 1.3, 1.6, { rel: true, yaw: 'face' });
    E._sc('roundtree', 1.5, 100, 140, 1.4, 2.2, { rel: true, pal: P.treeTint });
  },

  greenhill(E, R) {
    const s0 = E._ch.s0, U = E._cU + 3.5;
    // a lake with an earth tower beside it and a waterfall pouring in
    if (R.next() < 0.4) {
      const side = R.next() < 0.5 ? -1 : 1;
      const s = s0 + 8 + R.next() * 34, u = side * (U + 22 + R.next() * 34), rr = 13 + R.next() * 8;
      if (E._put('pond', s, u, rr, 1, rr * 0.85, undefined, P.ghWater[(R.next() * 2) | 0], { lift: 0.5, ov: 1, floor: true, fm: 8 })) {
        const a = R.next() * 6.283, d = rr + 7;
        const ts = s + Math.cos(a) * d, tu = u + Math.sin(a) * d, tk = 6 + R.next() * 2, th = 14 + R.next() * 7;
        if (E._put('islet', ts, tu, tk, th, tk, undefined, P.ghEarth[0], { ov: 0.9, floor: true, fm: 4 })) {
          const f = E._f; // frame at the tower's s (left there by _put)
          const ds = s - ts, du = u - tu, dl = Math.hypot(ds, du) || 1;
          const yaw = Math.atan2(f.tan.x * ds + f.right.x * du, f.tan.z * ds + f.right.z * du); // face the lake
          E._put('waterfall', ts + (ds / dl) * tk * 0.96, tu + (du / dl) * tk * 0.96, 3.2 + R.next() * 1.5, th * 1.5, 1, yaw, null, { block: false, lift: 0.5 });
        }
      }
    }
    // rounded bushy hills far away
    E._sc('hill', 3, 85, 170, 16, 30, { rel: true, my: 0.5, pal: P.ghHill, ov: 0.6, lift: -0.4 });
    // slope: tall palms, sunflowers facing the runner, round bushes
    E._sc('palm', 3.5, 17, U - 4, 1.8, 2.8, { pal: P.ghTree });
    E._sc('sunflower', 11, 15, U - 3, 1.5, 2.4, { pal: P.ghSun, yaw: 'pathR' });
    E._sc('roundtree', 4, 17, U - 4, 0.9, 1.5, { pal: P.ghTree, clump: 0.3 });
    // valley
    E._sc('palm', 4, 6, 90, 2.2, 3.4, { rel: true, pal: P.ghTree });
    E._sc('sunflower', 9, 6, 90, 1.7, 2.7, { rel: true, pal: P.ghSun, yaw: 'pathR' });
    E._sc('roundtree', 6, 6, 90, 1.3, 2.1, { rel: true, pal: P.ghTree, clump: 0.3 });
    // floating islands with grass tops
    E._sc('islet', 1.1, 15, 100, 5, 9, { rel: true, floor: true, fm: 4, pal: P.ghEarth, liftR: [14, 32], ov: 0.9 });
  },

  kapadokya(E, R) {
    const U = E._cU + 3.5;
    E._sc('hill', 3, 25, 110, 22, 42, { rel: true, my: 0.3, pal: P.ochreHill, ov: 0.6, lift: -0.4 });
    E._sc('chimney', 6, 17, U - 4, 2.4, 4.5, { pal: P.ochre, clump: 0.25 });
    E._sc('chimney', 7, 6, 95, 5, 10, { rel: true, pal: P.ochre, clump: 0.25, ov: 0.8 });
    E._sc('rock', 4, 15, U, 1.0, 2.6, { pal: P.sandRock });
    E._sc('rock', 3, 6, 100, 1.4, 3.4, { rel: true, pal: P.sandRock });
    E._sc('balloon', 6, 18, 170, 3.5, 6, { pal: P.balloon, liftR: [10, 85], block: false });
  },

  icecave(E, R) {
    const U = E._cU + 3.5;
    E._sc('hill', 2, 40, 110, 22, 40, { rel: true, my: 0.3, pal: P.iceHill, ov: 0.6, lift: -0.4 });
    if (R.next() < 0.4) E._sc('pond', 1, 15, 80, 12, 26, { rel: true, floor: true, pal: P.ice, mz: 0.8, lift: 0.5, ov: 0.9 });
    E._sc('crystal', 9, 15, U - 2, 1.4, 3.2, { pal: P.iceGlow });
    E._sc('stalag', 6, 15, U - 2, 1.6, 3.0, { pal: P.iceRock });
    E._sc('seal', 2.2, 16, U - 4, 2.2, 3.2, {});
    E._sc('crystal', 8, 6, 90, 2.2, 5, { rel: true, pal: P.iceGlow, ov: 0.8 });
    E._sc('rock', 5, 15, U, 1.0, 2.6, { pal: P.iceRock });
    E._sc('rock', 4, 6, 100, 1.4, 3.6, { rel: true, pal: P.iceRock });
  },

  sakura(E, R) {
    const U = E._cU + 3.5;
    if (R.next() < 0.5) { // a pond with a little red bridge
      const side = R.next() < 0.5 ? -1 : 1;
      const s = E._ch.s0 + 10 + R.next() * 30, u = side * (U + 18 + R.next() * 40), rr = 10 + R.next() * 5;
      if (E._put('pond', s, u, rr, 1, rr * 0.8, undefined, P.water[0], { lift: 0.5, ov: 1, floor: true, fm: 6 })) {
        const k = rr * 0.22;
        E._put('rbridge', s, u, k, k, k, 'path', null, { lift: 0.5, block: false });
      }
    }
    E._sc('hill', 2.5, 30, 120, 22, 42, { rel: true, my: 0.3, pal: P.sakHill, ov: 0.6, lift: -0.4 });
    E._sc('sakuratree', 9, 17, U - 4, 1.1, 1.9, { pal: P.sakTree, clump: 0.25 });
    E._sc('sakuratree', 14, 6, 95, 1.5, 2.7, { rel: true, pal: P.sakTree, clump: 0.25 });
    E._sc('pavilion', 0.5, 15, 90, 1.8, 2.6, { rel: true, floor: true, yaw: 'face' });
    E._sc('rock', 2, 15, U, 1.0, 2.2, { pal: P.rockGrey });
  },

  istanbul(E, R) {
    const s0 = E._ch.s0, U = E._cU + 3.5;
    // hillside above the strait: houses, carts, cypresses, Galata Tower
    E._sc('hut', 9, 17, U - 4, 7.5, 10.5, { pal: P.hutWall, yaw: 'face', ov: 0.8 });
    E._sc('stall', 3, 17, U - 4, 2.4, 3.4, { yaw: 'face' });
    E._sc('roundtree', 4, 17, U - 4, 0.9, 1.5, { pal: P.cypress });
    if (R.next() < 0.3) E._sc('galata', 1, 17, U - 6, 4.5, 6, { yaw: 'face' });
    // the strait: ferries, Maiden's Tower, the suspension bridge, gulls
    E._sc('ferry', 1.6, 6, 110, 2.8, 4, { rel: true, floor: true, yaw: 'path', ov: 0.9 });
    E._sc('ferry', 1.2, 6, 110, 2.8, 4, { rel: true, floor: true, yaw: 'pathR', ov: 0.9 });
    if (R.next() < 0.25) E._sc('kiz', 1, 25, 100, 3, 4, { rel: true, floor: true });
    if (R.next() < 0.3) {
      const side = R.next() < 0.5 ? -1 : 1, k = 0.9 + R.next() * 0.25;
      E._put('susp', s0 + 25, side * (U + 100 + R.next() * 20), k, k, k, 'right', null, { floor: true, fm: 20, block: false });
    }
    E._sc('gull', 7, 15, 160, 3, 5, { liftR: [10, 55], block: false });
    E._sc('rock', 2, 6, 100, 1.5, 3.5, { rel: true, floor: true, pal: P.rockGrey });
  },

  moon(E, R) {
    const U = E._cU + 3.5;
    E._sc('crater', 9, 6, 110, 6, 16, { rel: true, floor: true, pal: P.moonRock, lift: 0.15, ov: 0.9 });
    E._sc('hill', 2, 30, 130, 24, 46, { rel: true, my: 0.28, pal: P.moonHill, ov: 0.6, lift: -0.4 });
    E._sc('rock', 7, 15, U, 1.0, 3.2, { pal: P.moonRock });
    E._sc('rock', 8, 6, 110, 1.2, 4.2, { rel: true, pal: P.moonRock });
    if (R.next() < 0.6) E._sc('dome', 1, 15, 90, 3.5, 6, { rel: true, floor: true, pal: P.white, ov: 0.9 });
    E._sc('flag', 1.2, 15, U, 1.5, 2.5, {});
    E._sc('rover', 0.9, 8, 100, 2, 3, { rel: true, floor: true });
  },

  pirate(E, R) {
    const s0 = E._ch.s0, U = E._cU + 3.5;
    // palm islands in the turquoise sea
    if (R.next() < 0.9) {
      const side = R.next() < 0.5 ? -1 : 1;
      const s = s0 + 8 + R.next() * 34, u = side * (U + 22 + R.next() * 60), rr = 9 + R.next() * 9;
      if (E._put('hill', s, u, rr, rr * 0.22, rr, undefined, P.sandIsle[(R.next() * 3) | 0], { lift: -0.3, ov: 0.9, floor: true, fm: 6 })) {
        for (let p = 0; p < 3; p++) {
          const a = R.next() * 6.28, d = rr * (0.1 + R.next() * 0.5), sc = 1.8 + R.next() * 0.9;
          E._put('palm', s + Math.cos(a) * d, u + Math.sin(a) * d, sc, sc, sc);
        }
      }
    }
    E._sc('ship', 1.1, 10, 100, 2.5, 3.4, { rel: true, floor: true, ov: 0.9 });
    if (R.next() < 0.3) E._sc('lighthouse', 1, 25, 90, 4, 5.5, { rel: true, floor: true });
    E._sc('palm', 4, 17, U - 4, 1.3, 2.2, { pal: P.ghTree });
    E._sc('chest', 2, 17, U - 4, 2, 3, { yaw: 'face' });
    E._sc('rock', 5, 15, U, 1.0, 2.6, { pal: P.sandRock });
  },

  desert(E, R) {
    const s0 = E._ch.s0, U = E._cU + 3.5;
    // valley: dunes, mesas, cacti; slope: rocks and a few cacti
    E._sc('hill', 5, 8, 100, 14, 28, { rel: true, my: 0.15, mz: 1.7, pal: P.sandHill, ov: 0.5, lift: -0.4 });
    E._sc('hill', 1.2, 40, 120, 40, 70, { rel: true, my: 0.2, mz: 1.5, pal: P.sandHill, ov: 0.5, lift: -0.4 });
    const canyon = vnoise(E._ch.id * 0.33 + 4.1, 2.7);
    if (canyon > 0.5) { // canyon walls rise from the valley floor on both sides
      for (let side = -1; side <= 1; side += 2) {
        for (let j = 0; j < 2; j++) {
          const sc = 19 + R.next() * 9;
          E._put('mesa', s0 + 10 + j * 26 + R.next() * 6, side * (U + 14 + R.next() * 26), sc, 40 + R.next() * 32, sc, undefined, P.mesaTint[(R.next() * 3) | 0], { ov: 0.8 });
        }
      }
    } else {
      E._sc('mesa', 0.55, 20, 100, 18, 36, { rel: true, my: 2.4, pal: P.mesaTint, ov: 0.8 });
    }
    E._sc('cactus', 4, 17, U - 6, 1.3, 2.1, { pal: P.treeTint });
    E._sc('skullrock', 2.2, 16, U - 4, 2.0, 3.2, {});
    E._sc('rock', 6, 15, U - 4, 1.0, 2.8, { pal: P.sandRock });
    E._sc('cactus', 8, 6, 100, 1.6, 2.7, { rel: true, pal: P.treeTint });
    E._sc('rock', 4, 6, 100, 1.2, 3.4, { rel: true, pal: P.sandRock });
    if (E._ch.id % 4 === 1) { // caravan on the valley floor
      const side = R.next() < 0.5 ? -1 : 1;
      const u = side * (U + 15 + R.next() * 30);
      for (let c = 0; c < 5; c++) E._put('camel', s0 + 5 + c * 8.5, u + (R.next() - 0.5) * 2, 1.9, 1.9, 1.9, 'path', null, O_CAR);
    }
    if (R.next() < 0.22) { // oasis
      const side = R.next() < 0.5 ? -1 : 1;
      const s = s0 + 10 + R.next() * 30, u = side * (U + 20 + R.next() * 60), rr = 12 + R.next() * 8;
      if (E._put('pond', s, u, rr, 1, rr, undefined, P.water[0], { lift: 0.5, ov: 1, floor: true })) {
        for (let p = 0; p < 5; p++) {
          const a = R.next() * 6.28, d = rr * (1.05 + R.next() * 0.4), sc = 1.7 + R.next() * 0.8;
          E._put('palm', s + Math.cos(a) * d, u + Math.sin(a) * d, sc, sc, sc);
        }
      }
    }
  },

  candy(E, R) {
    const U = E._cU + 3.5;
    E._sc('hill', 3, 20, 90, 22, 44, { rel: true, my: 0.32, pal: P.candyHill, ov: 0.6, lift: -0.4 });
    E._sc('hill', 5, 17, U, 3.5, 8.5, { my: 0.9, pal: P.candyHill, lift: -0.4 }); // gumdrops on the slope
    E._sc('cane', 8, 17, U - 4, 1.6, 2.8, { pal: P.candyAny, tilt: 0.16 });
    E._sc('lollipop', 5, 17, U - 4, 1.0, 2.0, { pal: P.candyHill });
    E._sc('jellycube', 6, 16, U - 4, 1.8, 3.2, { pal: P.candyHill });
    E._sc('cane', 7, 6, 90, 1.8, 3.2, { rel: true, pal: P.candyAny, tilt: 0.16 });
    E._sc('lollipop', 7, 6, 90, 1.1, 2.3, { rel: true, pal: P.candyHill });
    E._sc('lollipop', 0.5, 20, 90, 6, 9, { rel: true, pal: P.candyHill, ov: 0.8 });
    E._sc('donut', 4, 8, 90, 3, 7, { rel: true, pal: P.candyAny, tilt: 0.45 });
    E._sc('icecream', 0.4, 15, 90, 2.2, 4.0, { rel: true, yaw: 'face' });
    if (R.next() < 0.35) E._sc('pond', 1, 15, 80, 14, 30, { rel: true, floor: true, pal: P.syrup, mz: 0.8, lift: 0.5, ov: 0.9 });
  },

  neon(E, R) {
    const s0 = E._ch.s0;
    // glowing posts lining the run, standing on the slope
    for (let j = 0; j < 4; j++) {
      for (let side = -1; side <= 1; side += 2) {
        if (R.next() < 0.5) continue;
        const h = 10 + R.next() * 22;
        E._put('pillar', s0 + j * 12.5 + R.next() * 6, side * (18 + R.next() * 8), 2.2, h, 2.2, 0, (side < 0 ? P.neonCyan : P.neonPink)[(R.next() * 2) | 0], { ov: 0.9 });
      }
    }
    E._sc('ring', 1.4, 26, 70, 7, 13, { yaw: 'path', pal: P.neonHot, ov: 0.9 }); // gates beside the run
    E._sc('robot', 2.4, 17, 60, 3.0, 4.6, { yaw: 'face', pal: P.neon, ov: 0.9 });    // patrol robots on the slope
    E._sc('pillar', 3, 6, 90, 2.4, 3.6, { rel: true, my: 9, pal: P.neon, ov: 0.9 });
    E._sc('tower', 6, 5, 90, 4, 9, { rel: true, my: 5, pal: P.neon, ov: 0.9 });
    E._sc('pyramid', 1.8, 15, 100, 18, 48, { rel: true, pal: P.neonHot, ov: 0.9 });
    E._sc('peak', 0.8, 50, 130, 50, 90, { rel: true, my: 1.2, pal: P.neonMtn, ov: 0.9, block: false });
  },

  aurora(E, R) {
    const U = E._cU + 3.5;
    E._sc('peak', 0.5, 145, 215, 45, 85, { my: 1.8, pal: P.nightPeak, ov: 0.9, block: false });
    E._sc('hill', 2.4, 130, 195, 24, 46, { rel: false, my: 0.24, pal: P.nightHill, ov: 0.6, lift: -0.4 });
    if (R.next() < 0.4) E._sc('pond', 1, 18, 70, 14, 32, { rel: true, floor: true, mz: 0.75, pal: P.ice, lift: 0.5, ov: 0.9 });
    E._sc('pine', 11, 17, U - 4, 1.0, 1.7, { pal: P.nightPine, clump: 0.3 });
    E._sc('pine_big', 3, 20, U - 4, 1.0, 1.5, { pal: P.nightPine, clump: 0.3 });
    E._sc('crystal', 4, 15, U - 2, 1.2, 2.6, { pal: P.auroraGlow });
    E._sc('boulder', 2.5, 16, U, 0.9, 1.9, { pal: P.nightHill });
    E._sc('pine', 12, 6, 75, 1.2, 2.0, { pal: P.nightPine, clump: 0.3, rel: true });
    E._sc('crystal', 5, 6, 90, 1.8, 4, { rel: true, pal: P.auroraGlow, ov: 0.8 });
    E._sc('boulder', 1.5, 6, 80, 1.2, 2.4, { rel: true, pal: P.nightHill });
  },

  bamboo(E, R) {
    const s0 = E._ch.s0, U = E._cU + 3.5;
    const side = biomeIdx(s0) & 1 ? 1 : -1;
    E._sc('hill', 2.8, 100, 170, 26, 50, { my: 0.27, pal: P.bamHill, ov: 0.6, lift: -0.4 });
    for (let j = 0; j < 2; j++) {
      const s = s0 + 12 + j * 25;
      const u = side * (U + 30 + 16 * Math.sin(s / 120 + 0.7) + 6 * Math.sin(s / 43));
      const k = side * ((16 / 120) * Math.cos(s / 120 + 0.7) + (6 / 43) * Math.cos(s / 43));
      E._put('pond', s, u, 7.5, 1, 16, 'path', P.bamWater[(R.next() * 3) | 0], { yo: -Math.atan(k), lift: 0.5, ov: 0.9, floor: true });
    }
    E._sc('bamboo', 16, 15, U - 3, 1.3, 2.4, { pal: P.bamTint, clump: 0.25 });
    E._sc('bamboo', 20, 6, 80, 1.6, 2.8, { rel: true, pal: P.bamTint, clump: 0.25 });
    E._sc('rock', 3, 15, U, 1.0, 2.4, { pal: P.rockGrey });
    if (R.next() < 0.35) E._sc('pavilion', 1, 15, 70, 2.4, 3.2, { rel: true, yaw: 'face', pal: P.bld });
    E._sc('roundtree', 2, 6, 80, 1.2, 1.9, { rel: true, pal: P.treeTint });
  },

  glacier(E, R) {
    const U = E._cU + 3.5;
    E._sc('peak', 0.6, 145, 215, 45, 85, { my: 1.8, pal: P.glacHill, ov: 0.9, block: false });
    E._sc('hill', 2.2, 20, 100, 22, 44, { rel: true, my: 0.3, pal: P.glacHill, ov: 0.6, lift: -0.4 });
    if (R.next() < 0.5) E._sc('pond', 1, 15, 80, 12, 26, { rel: true, floor: true, pal: P.glacWater, mz: 0.8, lift: 0.5, ov: 0.9 });
    E._sc('icespire', 5, 15, U - 4, 1.8, 3.4, { pal: P.glacSpire });
    E._sc('crystal', 7, 15, U - 2, 1.4, 3.0, { pal: P.iceGlow });
    E._sc('stalag', 4, 15, U - 2, 1.6, 3.0, { pal: P.iceRock });
    E._sc('icespire', 4, 6, 90, 2.6, 5.2, { rel: true, pal: P.glacSpire, ov: 0.9 });
    E._sc('crystal', 6, 6, 90, 2.2, 5, { rel: true, pal: P.iceGlow, ov: 0.8 });
    E._sc('seal', 1.2, 16, U - 4, 2.2, 3.2, {});
  },

  carnival(E, R) {
    const U = E._cU + 3.5;
    E._sc('hill', 4, 17, U, 3.5, 8.5, { my: 0.9, pal: P.carnHill, lift: -0.4 });
    E._sc('ferris', 0.9, 20, 95, 3.4, 5.2, { rel: true, yaw: 'face', pal: P.carnAny, ov: 0.9 });
    E._sc('tent', 2.2, 17, U - 3, 2.2, 3.4, { yaw: 'face', pal: P.carnAny });
    E._sc('tent', 2.5, 6, 80, 2.6, 4.4, { rel: true, yaw: 'face', pal: P.carnAny });
    E._sc('balloon', 4, 6, 18, 3.5, 6, { pal: P.balloon, liftR: [10, 85], block: false });
    E._sc('lollipop', 5, 17, U - 4, 1.0, 2.0, { pal: P.carnHill });
    E._sc('tower', 5, 17, U - 4, 1.4, 2.4, { pal: P.neon, ov: 0.9 });
    E._sc('ring', 1.2, 26, 70, 7, 13, { yaw: 'path', pal: P.neonHot, ov: 0.9 });
    E._sc('lollipop', 6, 6, 90, 1.1, 2.3, { rel: true, pal: P.carnHill });
  },

  volcano(E, R) {
    const s0 = E._ch.s0, U = E._cU + 3.5;
    const side = biomeIdx(s0) & 1 ? 1 : -1;
    E._sc('hill', 2.5, 20, 100, 22, 44, { rel: true, my: 0.3, pal: P.volcHill, ov: 0.6, lift: -0.4 });
    E._sc('volcano', 0.6, 25, 110, 42, 72, { rel: true, my: 1.5, pal: P.volcRock, ov: 0.9, block: false });
    // a lava river down the valley
    for (let j = 0; j < 2; j++) {
      const s = s0 + 12 + j * 25;
      const u = side * (U + 32 + 18 * Math.sin(s / 130 + 2.4) + 6 * Math.sin(s / 41));
      const k = side * ((18 / 130) * Math.cos(s / 130 + 2.4) + (6 / 41) * Math.cos(s / 41));
      E._put('lava', s, u, 7.5, 1, 18, 'path', P.lava[(R.next() * 3) | 0], { yo: -Math.atan(k), lift: 0.5, ov: 0.9, floor: true });
    }
    if (R.next() < 0.5) E._sc('lava', 1, 15, 80, 12, 26, { rel: true, floor: true, pal: P.lava, mz: 0.8, lift: 0.5, ov: 0.9 });
    E._sc('rock', 6, 15, U - 4, 1.0, 3.0, { pal: P.volcRock });
    E._sc('fire', 3, 16, U - 4, 1.8, 3.0, {});
    E._sc('spire', 3, 20, U - 4, 2.0, 4.5, { my: 2.2, pal: P.volcRock });
    E._sc('rock', 6, 6, 100, 1.2, 4.2, { rel: true, pal: P.volcRock });
    E._sc('spire', 3, 8, 100, 2.4, 6, { rel: true, my: 2.2, pal: P.volcRock });
  },
};
const O_CAR = { block: true, ov: 0.9 };
const O_BLD = { ov: 0.8 };
const riverU = (s) => 46 * Math.sin(s / 165 + 1.1) + 18 * Math.sin(s / 61);
const riverSlope = (s) => (46 / 165) * Math.cos(s / 165 + 1.1) + (18 / 61) * Math.cos(s / 61);
const lavaU = (s) => 52 * Math.sin(s / 150 + 2.4) + 16 * Math.sin(s / 53 + 1);
const lavaSlope = (s) => (52 / 150) * Math.cos(s / 150 + 2.4) + (16 / 53) * Math.cos(s / 53 + 1);

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------
const NC = 12;  // colour channels:  skyTop skyMid skyHor fog hemiSky hemiGnd sunCol discCol cloud gradeShadow gradeHigh ballRim
const NN = 22;  // numeric channels: fogNear fogFar hemiI sunI lightAz lightEl discAz discEl discSize stars pSky pGlow pGrid pSpark glowBase pLava cloudAmt aurora gradeSat gradeCon gradeVig ballRimMix

export class Environment {
  /**
   * @param {THREE.Scene} scene
   * @param {object} track  needs frame(s, out)
   * @param {object} [opts] { lib: prop library from buildPropLibrary() to share geometry (else built lazily) }
   */
  constructor(scene, track, opts = {}) {
    this.scene = scene;
    this.track = track;
    this.lib = opts.lib || null;
    this._ownLib = !opts.lib;
    this._disposed = false;
    this.time = 0;
    this._inited = false;

    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);

    // scratch
    const mkFrame = () => ({ pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() });
    this._f = mkFrame();   // _put / samples / clouds
    this._bf = mkFrame();  // ball frame
    this._tf = mkFrame();  // boundary frames
    this._sf = mkFrame();  // path sample cache (never share with _f: _clear() runs while _put() still reads _f)
    this._cp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._fx = 0; this._fz = -1;
    this._head = 0;
    this._frontier = AHEAD;

    // fog / background: reuse what the scene has (the runner's own objects), remember to restore.
    this._saved = {
      fogRef: scene.fog, bgRef: scene.background,
      fogColor: scene.fog && scene.fog.color ? scene.fog.color.clone() : null,
      near: scene.fog && scene.fog.near, far: scene.fog && scene.fog.far,
      bgColor: scene.background && scene.background.isColor ? scene.background.clone() : null,
    };
    if (scene.fog && scene.fog.isFog) this.fog = scene.fog;
    else { this.fog = new THREE.Fog(0xdcefff, 70, 330); scene.fog = this.fog; }
    if (scene.background && scene.background.isColor) this.bg = scene.background;
    else { this.bg = new THREE.Color(0xdcefff); scene.background = this.bg; }

    // materials
    this.matLit = nearFade(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.matGlow = nearFade(new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.matIce = nearFade(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x0a2c55 }));
    this.matWall = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this._wfTex = waterfallTexture();
    this.matWater = new THREE.MeshBasicMaterial({ map: this._wfTex, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide, color: 0xdff6ff });

    // look state (blend)
    this._ld = BIOMES.map((b) => makeLook(b));
    this.cCur = Array.from({ length: NC }, () => new THREE.Color());
    this.cFrom = Array.from({ length: NC }, () => new THREE.Color());
    this.cTo = Array.from({ length: NC }, () => new THREE.Color());
    this.nCur = new Float32Array(NN);
    this.nFrom = new Float32Array(NN);
    this.nTo = new Float32Array(NN);
    this._blendT = 1;
    this._lookDirty = true;
    this.bIdx = -1;
    this.biome = BIOMES[0];
    this._gc = BIOMES.map((b) => b.ground.map((h) => new THREE.Color(h)));
    this._pulseP = 0; this._pulseD = 0;

    this._buildLights();
    this._buildSky();
    this._buildCelestial();
    this._buildGround();
    this._buildFlank();
    this._buildParticles();
    this._buildClouds();
    // sky, valley floor and glowing decor get the same colour grade + vignette as the lit materials (the runner patches those itself)
    patchTail(this.skyMat); patchTail(this.groundMat); patchTail(this.matGlow);
    setLookActive(true);

    // path samples (8 m) used by corridor tests + ground height
    this._sx = new Float32Array(NS); this._sy = new Float32Array(NS); this._sz = new Float32Array(NS);
    this._srx = new Float32Array(NS); this._srz = new Float32Array(NS);
    this._shw = new Float32Array(NS).fill(3.5); this._se = new Float32Array(NS);
    this._sed = new Float32Array(NS); this._sov = new Float32Array(NS).fill(Infinity);
    this._shole = new Uint8Array(NS);
    this._ovDirty = false; this._revalNeeded = false;
    this._fm = 0; this._fmT = 0; this._fmWas = false; this._ovrVer = OVR_VER;
    this._stag = new Int32Array(NS).fill(-1);
    this._iBase = Infinity; this._iHi = 0; this._sNow = 0;
    this._nI = 0; this._nT = 0; this._nD = 0;
    this._fy = 0; this._ff = 0; this._fdu = 0; this._fs = 0; this._fpy = 0; this._cU = 100;
    this.fogPress = 0;    // 0..1 extra fog (blizzard / zones), written by the runner every frame; the runner never writes scene.fog
    this.ballVs = 0;      // ball speed (m/s), written by the runner every frame: the fog never closes in nearer than 2 s of running
    this._bDepth = BIOMES.map((b) => b.depth);
    this._bU = BIOMES.map((b) => b.flank.U);
    this._bE = BIOMES.map((b) => b.flank.e);

    // scenery
    this._T = Object.create(null);
    this._types = [];
    this._chunks = [];
    this._pool = [];
    this._ch = null; this._prev = null; this._r = null;

    // boundary frames (portal planes) cache
    this._bnd = [0, 1, 2].map(() => ({ k: -1, x: 0, z: 0, tx: 0, tz: -1 }));
    this._bext = { k: -1, x: 0, z: 0, tx: 0, tz: -1 };
    this._vtmp = [0, 0, 0];
    this._vtmp2 = [0, 0, 0];
    this._warm = [];
    this._libGeo('pine'); // build the prop library up-front: one hitch at run start instead of during the first frame
    this._glowT = this._type('pillar'); // owns the glow (MeshBasicMaterial + instance colour) program
    this._shaderWarm = 3;
  }

  // ------------------------------------------------------------------------------------------
  // builders
  // ------------------------------------------------------------------------------------------
  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
    this.sunL = new THREE.DirectionalLight(0xffffff, 1.8);
    this.sunL.position.set(0.3, 1, 0.6);
    this.group.add(this.hemi, this.sunL);
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1, 20, 12);
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    const n = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    // per-vertex gradient weights (horizon / mid / top)
    this._skyW = new Float32Array(n * 3);
    const p = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      const e = p.getY(i);
      let wh = 1, wm = 0, wt = 0;
      if (e > 0) {
        if (e < 0.3) { const t = smooth(0, 0.3, e); wh = 1 - t; wm = t; }
        else { const t = smooth(0.3, 1, e); wh = 0; wm = 1 - t; wt = t; }
      }
      this._skyW[i * 3] = wh; this._skyW[i * 3 + 1] = wm; this._skyW[i * 3 + 2] = wt;
    }
    this.skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);
    this._domeR = 700;
  }

  _buildCelestial() {
    // sun / moon sprite
    this._sunTexA = sunTexture();
    this._sunTexB = retroSunTexture();
    this._sunTexC = earthTexture();
    this.discMat = new THREE.MeshBasicMaterial({
      map: this._sunTexA, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    });
    this.discGeo = new THREE.PlaneGeometry(1, 1);
    this.disc = new THREE.Mesh(this.discGeo, this.discMat);
    this.disc.renderOrder = -90;
    this.disc.frustumCulled = false;
    this.group.add(this.disc);
    this._discKind = 'sun';

    // stars
    const sp = new Float32Array(NSTAR * 3), sc = new Float32Array(NSTAR * 3);
    const tints = [[1, 1, 1], [0.7, 0.95, 1], [1, 0.75, 0.95]];
    for (let i = 0; i < NSTAR; i++) {
      const y = 0.04 + 0.96 * ihash(i, 11);
      const a = ihash(i, 12) * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      sp[i * 3] = r * Math.cos(a); sp[i * 3 + 1] = y; sp[i * 3 + 2] = r * Math.sin(a);
      const t = tints[(ihash(i, 13) * 3) | 0], b = 0.55 + 0.45 * ihash(i, 14);
      sc[i * 3] = t[0] * b; sc[i * 3 + 1] = t[1] * b; sc[i * 3 + 2] = t[2] * b;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -95;
    this.stars.visible = false;
    this.group.add(this.stars);

    // northern lights: three additive curtains high in the sky (bright at the bottom edge, fading to black above); only visible in biomes with aurora
    const AN = 28, apos = [], acol = [], aidx = [];
    [[0.3, 0.55, 0.2, [0.2, 1.0, 0.65]], [2.3, 0.7, 0.28, [0.3, 0.8, 1.0]], [4.4, 0.5, 0.24, [0.7, 0.4, 1.0]]].forEach(([a0, span, hh, c], k) => {
      const b0 = apos.length / 3;
      for (let i = 0; i <= AN; i++) {
        const t = i / AN, a = a0 + t * span * 2.2, y0 = 0.3 + 0.09 * Math.sin(t * 5 + k * 2), y1 = y0 + hh * (0.6 + 0.5 * Math.sin(t * 7 + k)), f = Math.sin(t * Math.PI), r0 = Math.sqrt(1 - y0 * y0), r1 = Math.sqrt(1 - y1 * y1);
        apos.push(Math.cos(a) * r0, y0, Math.sin(a) * r0, Math.cos(a + 0.05) * r1, y1, Math.sin(a + 0.05) * r1);
        acol.push(c[0] * f, c[1] * f, c[2] * f, 0, 0, 0);
        if (i < AN) { const j = b0 + i * 2; aidx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
      }
    });
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(apos), 3));
    ag.setAttribute('color', new THREE.BufferAttribute(new Float32Array(acol), 3));
    ag.setIndex(aidx);
    this.auroraMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.aurora = new THREE.Mesh(ag, this.auroraMat);
    this.aurora.frustumCulled = false;
    this.aurora.renderOrder = -93;
    this.aurora.visible = false;
    this.group.add(this.aurora);
  }

  _buildGround() {
    const W = GN + 1;
    const nv = W * W;
    const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        pos[k * 3] = (i - GN / 2) * CELL;
        pos[k * 3 + 2] = (j - GN / 2) * CELL;
        uv[k * 2] = (i * CELL) / GRID_P;
        uv[k * 2 + 1] = (j * CELL) / GRID_P;
      }
    }
    const idx = new Uint16Array(GN * GN * 6);
    let q = 0;
    for (let j = 0; j < GN; j++) {
      for (let i = 0; i < GN; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    this._gpos = pos; this._gcol = col;
    const geo = new THREE.BufferGeometry();
    this._gposAttr = new THREE.BufferAttribute(pos, 3);
    this._gposAttr.setUsage(THREE.DynamicDrawUsage);
    this._gcolAttr = new THREE.BufferAttribute(col, 3);
    this._gcolAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._gposAttr);
    geo.setAttribute('color', this._gcolAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.groundMat = new THREE.MeshBasicMaterial({
      vertexColors: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
    });
    this.ground = new THREE.Mesh(geo, this.groundMat);
    this.ground.frustumCulled = false;
    this.ground.renderOrder = -50;
    this.group.add(this.ground);

    // neon grid overlay (additive, shares positions/indices with the ground)
    this._gridTex = gridTexture();
    this._gridOK = !!this._gridTex;
    const gcol = new Float32Array(nv * 3);
    this._gridcol = gcol;
    const ggeo = new THREE.BufferGeometry();
    ggeo.setAttribute('position', this._gposAttr);
    this._gridColAttr = new THREE.BufferAttribute(gcol, 3);
    this._gridColAttr.setUsage(THREE.DynamicDrawUsage);
    ggeo.setAttribute('color', this._gridColAttr);
    ggeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    ggeo.setIndex(geo.index);
    if (this._gridTex) {
      this._gridTex.wrapS = this._gridTex.wrapT = THREE.RepeatWrapping;
      this._gridTex.anisotropy = 4;
    }
    this.gridMat = new THREE.MeshBasicMaterial({
      map: this._gridTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.grid = new THREE.Mesh(ggeo, this.gridMat);
    this.grid.frustumCulled = false;
    this.grid.renderOrder = -40;
    this.grid.visible = false;
    this.group.add(this.grid);
    this._cyan = new THREE.Color(0x00e5ff);
    this._magenta = new THREE.Color(0xff2bd6);
  }

  _buildParticles() {
    const pos = new Float32Array(NPART * 3), col = new Float32Array(NPART * 4);
    this._ppos = pos; this._pcol = col;
    this._pvel = new Float32Array(NPART * 3);
    this._pbase = new Float32Array(NPART);
    this._pph = new Float32Array(NPART);
    const g = new THREE.BufferGeometry();
    this._pposAttr = new THREE.BufferAttribute(pos, 3);
    this._pposAttr.setUsage(THREE.DynamicDrawUsage);
    this._pcolAttr = new THREE.BufferAttribute(col, 4);
    this._pcolAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this._pposAttr);
    g.setAttribute('color', this._pcolAttr);
    this._dotTex = dotTexture();
    this.partMat = new THREE.PointsMaterial({
      size: 0.5, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, fog: false, map: this._dotTex,
    });
    this.particles = new THREE.Points(g, this.partMat);
    this.particles.frustumCulled = false;
    this.group.add(this.particles);
    this._pn = 0;
    this._pcfg = BIOMES[0].particles;
    this._pSize = 0.5;
    this._pInit = false;
  }

  _buildClouds() {
    this._cloudGeo = BUILD.cloud();
    const m = measure(this._cloudGeo);
    this._cloudHr = m.hr;
    this._cloudH = Math.max(Math.abs(m.y0), Math.abs(m.y1));
    this.clouds = new THREE.InstancedMesh(this._cloudGeo, this.cloudMat, NCLOUD);
    this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clouds.frustumCulled = false;
    this.clouds.matrixAutoUpdate = false;
    this.clouds.count = 0;
    this.clouds.visible = false;
    this.group.add(this.clouds);
    this._cl = {
      x: new Float32Array(NCLOUD), y: new Float32Array(NCLOUD), z: new Float32Array(NCLOUD),
      r: new Float32Array(NCLOUD), vx: new Float32Array(NCLOUD), vz: new Float32Array(NCLOUD),
      ph: new Float32Array(NCLOUD), yaw: new Float32Array(NCLOUD), sq: new Float32Array(NCLOUD), dead: new Uint8Array(NCLOUD), hi: new Int32Array(NCLOUD),
    };
    this._cloudsInit = false;
  }

  _buildFlank() {
    const nv = NSLOT * 2 * NSEC * NP;
    this._fpos = new Float32Array(nv * 3);
    this._fcol = new Float32Array(nv * 3);
    const nrm = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) nrm[i * 3 + 1] = 1;
    const idx = new Uint16Array(NSLOT * 2 * (NSEC - 1) * (NP - 1) * 6);
    let q = 0;
    for (let slot = 0; slot < NSLOT; slot++) {
      for (let side = 0; side < 2; side++) {
        for (let k = 0; k < NSEC - 1; k++) {
          for (let p = 0; p < NP - 1; p++) {
            const A = ((slot * 2 + side) * NSEC + k) * NP + p, B = A + 1, D = A + NP, C = D + 1;
            if (side) { idx[q++] = A; idx[q++] = B; idx[q++] = C; idx[q++] = A; idx[q++] = C; idx[q++] = D; }
            else { idx[q++] = A; idx[q++] = C; idx[q++] = B; idx[q++] = A; idx[q++] = D; idx[q++] = C; }
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    this._fposAttr = new THREE.BufferAttribute(this._fpos, 3);
    this._fposAttr.setUsage(THREE.DynamicDrawUsage);
    this._fcolAttr = new THREE.BufferAttribute(this._fcol, 3);
    this._fcolAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._fposAttr);
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', this._fcolAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.matFlank = this.matLit.clone();
    this.flank = new THREE.Mesh(geo, this.matFlank);
    this.flank.frustumCulled = false;
    this.flank.name = 'flanks';
    this.group.add(this.flank);
    this._fl = BIOMES.map((b) => ({
      top: new THREE.Color(b.flank.top), mid: new THREE.Color(b.flank.mid), rock: new THREE.Color(b.flank.rock),
      cA: new THREE.Color(b.flank.checkerA || 0), cB: new THREE.Color(b.flank.checkerB || 0),
    }));
    this._gLip = [new THREE.Color(0x52d92f), new THREE.Color(0x3fc424)];
    this._buildWall();
    this._buildCeil();
    this._strata = [0xe8a560, 0xcf7339, 0xb4552d, 0xe39b54, 0xc4693a, 0xf0c07a].map((h) => new THREE.Color(h));
  }

  /** Checkerboard bank wall (Green Hill): fine vertex-coloured quads hugging the track edge; only live for 'checker' chunks. */
  _buildWall() {
    const cap = WMAXCH * WCOLS * WROWS * 2 * 6;
    this._wpos = new Float32Array(cap * 3);
    this._wcol = new Float32Array(cap * 3);
    this._wnor = new Float32Array(cap * 3);
    this._wcap = cap;
    this._wn = 0;
    const geo = new THREE.BufferGeometry();
    this._wposAttr = new THREE.BufferAttribute(this._wpos, 3);
    this._wcolAttr = new THREE.BufferAttribute(this._wcol, 3);
    this._wnorAttr = new THREE.BufferAttribute(this._wnor, 3);
    for (const a of [this._wposAttr, this._wcolAttr, this._wnorAttr]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._wposAttr);
    geo.setAttribute('normal', this._wnorAttr);
    geo.setAttribute('color', this._wcolAttr);
    geo.setDrawRange(0, 0);
    this.wall = new THREE.Mesh(geo, this.matWall);
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    this.wall.name = 'bankwall';
    this.group.add(this.wall);
    this._xs = { px: 0, py: 0, pz: 0, rx: 1, rz: 0, hw: 3.5, ed: 0, lo: Infinity, c: 0, D: 50, U: 100, E: 1.7 };
    this._wv = new Float32Array((WCOLS + 1) * (WROWS + 1) * 3);
    this._wrx = new Float32Array(WCOLS + 1);
    this._wrz = new Float32Array(WCOLS + 1);
    this._wo = new Int32Array(6);
  }

  /**
   * Ice cave ceiling: a translucent-looking arch of blue ice over the corridor (crown >= 13 m above the track, walls >= 8 m
   * from the edge, base on the terrain) plus hanging icicles. Left open wherever another pass of the path (loop, helix) comes
   * near. Non-indexed, appended per chunk like the bank wall.
   */
  _buildCeil() {
    this._cper = (NSEC - 1) * CEIL_SEC * 6 + CEIL_ICI * 18;
    const cap = WMAXCH * this._cper;
    this._cpos = new Float32Array(cap * 3);
    this._ccol = new Float32Array(cap * 3);
    this._cnor = new Float32Array(cap * 3);
    this._ccap = cap;
    this._cn = 0;
    const geo = new THREE.BufferGeometry();
    this._cposAttr = new THREE.BufferAttribute(this._cpos, 3);
    this._ccolAttr = new THREE.BufferAttribute(this._ccol, 3);
    this._cnorAttr = new THREE.BufferAttribute(this._cnor, 3);
    for (const a of [this._cposAttr, this._ccolAttr, this._cnorAttr]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._cposAttr);
    geo.setAttribute('normal', this._cnorAttr);
    geo.setAttribute('color', this._ccolAttr);
    geo.setDrawRange(0, 0);
    this.ceil = new THREE.Mesh(geo, this.matIce);
    this.ceil.frustumCulled = false;
    this.ceil.visible = false;
    this.ceil.name = 'icecave';
    this.group.add(this.ceil);
    this._cv = new Float32Array(NSEC * (2 * 8 + 1) * 3);
    this._cc = new Float32Array(NSEC * 3);
    this._chole = new Uint8Array(NSEC);
  }

  _genCeil(ch, off) {
    const bi = biomeIdx(ch.s0), n = BIOMES.length;
    if (BIOMES[bi % n].flank.kind !== 'ice') { if (off === undefined) ch.ceilV = 0; return; }
    const per = this._cper;
    if (off === undefined && this._cn + per > this._ccap) { ch.ceilV = 0; return; }
    const V = this._cv, C = this._cc, H = this._chole;
    const pos = this._cpos, col = this._ccol, nor = this._cnor;
    const i0 = Math.round(ch.s0 / SP);
    const NQ = 2 * 8 + 1;
    for (let k = 0; k < NSEC; k++) {
      const i = i0 + k, sk = this._sample(i);
      let hole = sk < 0 ? 1 : 0;
      for (let d = -2; d <= 2 && !hole; d++) {
        const j = i + d;
        if (j < 0) continue;
        const kj = ((j % NS) + NS) % NS;
        if (this._stag[kj] === j && (this._shole[kj] || this._sov[kj] < this._sy[kj] - 5)) hole = 1; // another pass below: not a cave there
      }
      H[k] = hole;
      if (sk < 0) { for (let q = 0; q < NQ * 3; q++) V[k * NQ * 3 + q] = 0; continue; }
      const px = this._sx[sk], py = this._sy[sk], pz = this._sz[sk], rx = this._srx[sk], rz = this._srz[sk], hw = this._shw[sk];
      const hb = py + Math.abs(this._sed[sk]);
      C[k * 3] = px; C[k * 3 + 1] = py + 7; C[k * 3 + 2] = pz;
      for (let q = 0; q < NQ; q++) {
        const sg = q < 8 ? -1 : q === 8 ? 0 : 1;
        const p = q <= 8 ? q : 16 - q;
        const u = p === 8 ? 0 : hw + CEIL_B[p];
        const x = px + rx * sg * u, z = pz + rz * sg * u;
        let y;
        if (p === 8) y = hb + CEIL_H[8];
        else if (p === 0) y = Math.min(this._field(x, z, i), py - 3) - 0.4; // the arch stands on the terrain
        else y = hb + CEIL_H[p];
        const v = (k * NQ + q) * 3;
        V[v] = x; V[v + 1] = y; V[v + 2] = z;
      }
    }
    let w = (off === undefined ? this._cn : off) * 3;
    const tri = (x0, y0, z0, x1, y1, z1, x2, y2, z2, r, g, b) => {
      let nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0);
      let ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
      let nz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const P3 = [x0, y0, z0, x1, y1, z1, x2, y2, z2];
      for (let t = 0; t < 3; t++, w += 3) {
        pos[w] = P3[t * 3]; pos[w + 1] = P3[t * 3 + 1]; pos[w + 2] = P3[t * 3 + 2];
        col[w] = r; col[w + 1] = g; col[w + 2] = b;
        nor[w] = nx; nor[w + 1] = ny; nor[w + 2] = nz;
      }
    };
    const zero = () => { for (let t = 0; t < 3; t++, w += 3) { pos[w] = pos[w + 1] = pos[w + 2] = 0; col[w] = col[w + 1] = col[w + 2] = 0; nor[w] = 0; nor[w + 1] = 1; nor[w + 2] = 0; } };
    for (let k = 0; k < NSEC - 1; k++) {
      for (let q = 0; q < CEIL_SEC; q++) {
        if (H[k] || H[k + 1]) { zero(); zero(); continue; }
        const a = (k * NQ + q) * 3, b = ((k + 1) * NQ + q) * 3, c = (k * NQ + q + 1) * 3, d = ((k + 1) * NQ + q + 1) * 3;
        const hh = ihash(ch.id * 10 + k, q, 7);
        const t = Math.min(q, 16 - q) / 8;
        const m = 0.78 + 0.32 * hh;
        const r = (0.22 + 0.5 * t) * m, g = (0.5 + 0.42 * t) * m, bl = (0.95 + 0.1 * t) * m;
        // face the inside of the cave
        const mx = (V[a] + V[d]) * 0.5, my = (V[a + 1] + V[d + 1]) * 0.5, mz = (V[a + 2] + V[d + 2]) * 0.5;
        const nx = (V[c + 1] - V[a + 1]) * (V[b + 2] - V[a + 2]) - (V[c + 2] - V[a + 2]) * (V[b + 1] - V[a + 1]);
        const ny = (V[c + 2] - V[a + 2]) * (V[b] - V[a]) - (V[c] - V[a]) * (V[b + 2] - V[a + 2]);
        const nz = (V[c] - V[a]) * (V[b + 1] - V[a + 1]) - (V[c + 1] - V[a + 1]) * (V[b] - V[a]);
        const hx = C[k * 3] - mx, hy = C[k * 3 + 1] - my, hz = C[k * 3 + 2] - mz;
        if (nx * hx + ny * hy + nz * hz >= 0) {
          tri(V[a], V[a + 1], V[a + 2], V[c], V[c + 1], V[c + 2], V[b], V[b + 1], V[b + 2], r, g, bl);
          tri(V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2], V[d], V[d + 1], V[d + 2], r, g, bl);
        } else {
          tri(V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2], r, g, bl);
          tri(V[b], V[b + 1], V[b + 2], V[d], V[d + 1], V[d + 2], V[c], V[c + 1], V[c + 2], r, g, bl);
        }
      }
    }
    // icicles: small pyramids hanging from the upper arch (both windings, so they read from any side)
    for (let ic = 0; ic < CEIL_ICI; ic++) {
      const k = Math.min(NSEC - 2, Math.floor(ihash(ch.id, ic, 11) * (NSEC - 1)));
      const q = 6 + Math.floor(ihash(ch.id, ic, 12) * 5); // 6..10: the crown region
      if (H[k] || H[k + 1]) { for (let t = 0; t < 6; t++) zero(); continue; }
      const a = (k * NQ + q) * 3, b = ((k + 1) * NQ + q) * 3, c = (k * NQ + q + 1) * 3;
      const Ax = V[a], Ay = V[a + 1], Az = V[a + 2];
      const Bx = Ax + (V[b] - Ax) * 0.18, By = Ay + (V[b + 1] - Ay) * 0.18, Bz = Az + (V[b + 2] - Az) * 0.18;
      const Cx = Ax + (V[c] - Ax) * 0.3, Cy = Ay + (V[c + 1] - Ay) * 0.3, Cz = Az + (V[c + 2] - Az) * 0.3;
      const len = Math.min(2 + 2.5 * ihash(ch.id, ic, 13), CEIL_H[q <= 8 ? q : 16 - q] - 9.4); // tips stay above the 9 m line
      const Tx = (Ax + Bx + Cx) / 3, Ty = (Ay + By + Cy) / 3 - len, Tz = (Az + Bz + Cz) / 3;
      const r = 0.8, g = 0.95, bl = 1.25;
      tri(Ax, Ay, Az, Bx, By, Bz, Tx, Ty, Tz, r, g, bl);
      tri(Bx, By, Bz, Cx, Cy, Cz, Tx, Ty, Tz, r, g, bl);
      tri(Cx, Cy, Cz, Ax, Ay, Az, Tx, Ty, Tz, r, g, bl);
      tri(Bx, By, Bz, Ax, Ay, Az, Tx, Ty, Tz, r, g, bl);
      tri(Cx, Cy, Cz, Bx, By, Bz, Tx, Ty, Tz, r, g, bl);
      tri(Ax, Ay, Az, Cx, Cy, Cz, Tx, Ty, Tz, r, g, bl);
    }
    if (off === undefined) { ch.ceilOff = this._cn; ch.ceilV = per; this._cn += per; }
    this._ceilFlush();
  }

  _ceilFlush() {
    this.ceil.geometry.setDrawRange(0, this._cn);
    this.ceil.visible = this._cn > 0;
    for (const a of [this._cposAttr, this._ccolAttr, this._cnorAttr]) {
      if (a.clearUpdateRanges) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(3, this._cn * 3)); }
      a.needsUpdate = true;
    }
  }

  /** Interpolated cross-section data at path length s (needs samples floor(s/SP) and +1). */
  _xsec(s) {
    const i = Math.floor(s / SP), t = s / SP - i;
    const k0 = this._sample(i), k1 = t > 1e-6 ? this._sample(i + 1) : k0;
    if (k0 < 0 || k1 < 0) return false;
    const x = this._xs;
    x.px = lerp(this._sx[k0], this._sx[k1], t); x.py = lerp(this._sy[k0], this._sy[k1], t); x.pz = lerp(this._sz[k0], this._sz[k1], t);
    let rx = lerp(this._srx[k0], this._srx[k1], t), rz = lerp(this._srz[k0], this._srz[k1], t);
    const rl = Math.hypot(rx, rz) || 1;
    x.rx = rx / rl; x.rz = rz / rl;
    x.hw = lerp(this._shw[k0], this._shw[k1], t);
    x.ed = Math.max(Math.abs(this._sed[k0]), Math.abs(this._sed[k1]));
    x.ed += 0.5 * (x.ed > 2.5 ? 1 : x.ed / 2.5);
    x.lo = Math.min(this._sov[k0], this._sov[k1]);
    x.c = t > 1e-6 ? lerp(this._cliffAt(i), this._cliffAt(i + 1), t) : this._cliffAt(i);
    x.D = this._depthAt(s); x.U = this._flankU(s); x.E = this._flankE(s);
    return true;
  }

  _wallH(x, du, sg) { // terrain height at lateral distance du from the edge, along the straight cross-section
    const X = x;
    const wx = X.px + X.rx * sg * (X.hw + du), wz = X.pz + X.rz * sg * (X.hw + du);
    const dr = this._drop(du < 0 ? 0 : du, X.D, X.U, X.E, X.c);
    let y = X.py - X.ed + dr;
    if (du > 0.5) y += this._rug(wx, wz, du, X.U);
    if (X.lo < X.py) {
      const yl = X.lo - 0.5 + dr;
      if (yl < y) y = yl;
    }
    return y;
  }

  _genWall(ch, off) { // off: rewrite this chunk's wall in place (it was built before an overlapping pass became known)
    const bi = biomeIdx(ch.s0), n = BIOMES.length;
    if (BIOMES[bi % n].flank.kind !== 'checker') { ch.wallV = 0; return; }
    const per = WCOLS * WROWS * 2 * 6;
    if (off === undefined && this._wn + per > this._wcap) { ch.wallV = 0; return; }
    const L = this._fl[bi % n], lip = this._gLip;
    const pos = this._wpos, col = this._wcol, nor = this._wnor, V = this._wv;
    const cL = CH / WCOLS, sub = 12, ds = WARC / sub;
    let w = (off === undefined ? this._wn : off) * 3;
    const gc0 = ch.id * WCOLS;
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      // march each column edge down the slope in equal arc-length steps
      for (let e = 0; e <= WCOLS; e++) {
        if (!this._xsec(ch.s0 + e * cL)) { ch.wallV = 0; return; }
        const X = this._xs;
        this._wrx[e] = X.rx; this._wrz[e] = X.rz;
        let du = 0, y = this._wallH(X, 0, sg), mm = (this._wallH(X, 0.05, sg) - y) / 0.05;
        for (let r = 0; r <= WROWS; r++) {
          const v = (e * (WROWS + 1) + r) * 3;
          V[v] = X.px + X.rx * sg * (X.hw + du); V[v + 1] = y + 0.04; V[v + 2] = X.pz + X.rz * sg * (X.hw + du);
          if (r === WROWS) break;
          for (let q = 0; q < sub; q++) {
            const dd = ds / Math.sqrt(1 + mm * mm), yn = this._wallH(X, du + dd, sg);
            mm = (yn - y) / dd; // slope for the next step (lagged secant)
            du += dd; y = yn;
          }
        }
      }
      for (let c = 0; c < WCOLS; c++) {
        const hx = sg * this._wrx[c], hz = sg * this._wrz[c];
        for (let r = 0; r < WROWS; r++) {
          const a = (c * (WROWS + 1) + r) * 3, b = ((c + 1) * (WROWS + 1) + r) * 3, cc = (c * (WROWS + 1) + r + 1) * 3, d = ((c + 1) * (WROWS + 1) + r + 1) * 3;
          const par = (gc0 + c + r) & 1;
          const clr = r === 0 ? lip[par] : par ? L.cB : L.cA;
          // normal of (v00, v01, v10); flip the winding if it points into the mountain
          const ux = V[cc] - V[a], uy = V[cc + 1] - V[a + 1], uz = V[cc + 2] - V[a + 2];
          const vx = V[b] - V[a], vy = V[b + 1] - V[a + 1], vz = V[b + 2] - V[a + 2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          const flip = nx * hx + ny * 0.7 + nz * hz < 0;
          if (flip) { nx = -nx; ny = -ny; nz = -nz; }
          // two triangles: (a, cc, b) and (b, cc, d); swapped when flipped
          const o = this._wo;
          if (flip) { o[0] = a; o[1] = b; o[2] = cc; o[3] = b; o[4] = d; o[5] = cc; } else { o[0] = a; o[1] = cc; o[2] = b; o[3] = b; o[4] = cc; o[5] = d; }
          for (let k = 0; k < 6; k++, w += 3) {
            const vi = o[k];
            pos[w] = V[vi]; pos[w + 1] = V[vi + 1]; pos[w + 2] = V[vi + 2];
            col[w] = clr.r; col[w + 1] = clr.g; col[w + 2] = clr.b;
            nor[w] = nx; nor[w + 1] = ny; nor[w + 2] = nz;
          }
        }
      }
    }
    if (off === undefined) { ch.wallOff = this._wn; ch.wallV = per; this._wn += per; }
    this._wallFlush();
  }

  _wallFlush() {
    this.wall.geometry.setDrawRange(0, this._wn);
    this.wall.visible = this._wn > 0;
    for (const a of [this._wposAttr, this._wcolAttr, this._wnorAttr]) {
      if (a.clearUpdateRanges) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(3, this._wn * 3)); }
      a.needsUpdate = true;
    }
  }

  /** Colour of the flank at world (x,z); drop = terrain offset below the track surface, du = distance from the edge. */
  _flankColor(bi, x, z, drop, D, du, c, out) {
    const n = BIOMES.length, B = BIOMES[bi % n], FL = B.flank, L = this._fl[bi % n];
    const frac = clamp(-drop / D, 0, 1);
    const n1 = vnoise(x * 0.045 + 3.3, z * 0.045), n2 = vnoise(x * 0.13, z * 0.13 + 9.1);
    const a = smooth(0, 0.45, frac);
    let r = L.top.r + (L.mid.r - L.top.r) * a, g = L.top.g + (L.mid.g - L.top.g) * a, b = L.top.b + (L.mid.b - L.top.b) * a;
    if (FL.kind === 'strata') {
      const sc = this._strata[(Math.floor(-drop / 2.6 + n1 * 2.4) % 6 + 6) % 6];
      const w = smooth(0.03, 0.12, frac);
      r += (sc.r - r) * w; g += (sc.g - g) * w; b += (sc.b - b) * w;
    }
    const rt = smooth(0.52, 0.8, n1) * smooth(0.08, 0.35, frac) * FL.rockAmt;
    r += (L.rock.r - r) * rt; g += (L.rock.g - g) * rt; b += (L.rock.b - b) * rt;
    const sh = 0.88 + 0.12 * n2;
    r *= sh; g *= sh; b *= sh;
    if (FL.kind === 'neon') {
      const rim = 1 - smooth(0, 3, du);
      r += 0.0 * rim; g += 2.0 * rim; b += 2.4 * rim;
    } else if (FL.kind === 'lava') {
      const ridge = Math.abs(n2 - 0.5);
      if (ridge < 0.05 && frac > 0.1 && frac < 0.97) { const q = 1 - ridge / 0.05; r += (2.6 - r) * q; g += (0.9 - g) * q; b += (0.1 - b) * q; }
    }
    const w = smooth(0.7, 1, frac); // melt into the valley floor
    if (w > 0) {
      const A = this._vtmp;
      this._groundCol(bi, x, z, A);
      r += (A[0] - r) * w; g += (A[1] - g) * w; b += (A[2] - b) * w;
    }
    const dk = 1 - 0.35 * c * smooth(0.04, 0.35, frac); // cliff faces are darker
    out[0] = r * dk; out[1] = g * dk; out[2] = b * dk;
  }

  /** Terrain ribbons along both track edges for one chunk: 6 cross-sections x 11 profile points x 2 sides. */
  _genFlank(ch) {
    const slot = ch.id % NSLOT;
    const bi = biomeIdx(ch.s0);
    const i0 = Math.round(ch.s0 / SP);
    const pos = this._fpos, col = this._fcol, C = this._vtmp2;
    for (let k = 0; k < NSEC; k++) {
      const i = i0 + k, sk = this._sample(i);
      if (sk < 0) continue;
      const sS = i * SP;
      const px = this._sx[sk], py = this._sy[sk], pz = this._sz[sk], rx = this._srx[sk], rz = this._srz[sk], hw = this._shw[sk], ed = this._sed[sk];
      const D = this._depthAt(sS), U = this._flankU(sS);
      const cl = this._cliffAt(i);
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        const edgeY = py - Math.abs(ed) - 0.5 * (Math.abs(ed) > 2.5 ? 1 : Math.abs(ed) / 2.5);
        for (let p = 0; p < NP; p++) {
          const du = p === 0 ? -0.3 : p === 1 ? 1.4 : U * FLANK_TAU[p - 2];
          const u = hw + du;
          const x = px + rx * sg * u, z = pz + rz * sg * u;
          const y = p === 0 ? edgeY - 0.55 : this._field(x, z, i);
          const v = (((slot * 2 + side) * NSEC + k) * NP + p) * 3;
          pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
          this._flankColor(bi, x, z, p === 0 ? -0.5 : y - edgeY, D, du < 0 ? 0 : du, cl, C);
          col[v] = C[0]; col[v + 1] = C[1]; col[v + 2] = C[2];
        }
      }
    }
    this._fposAttr.needsUpdate = true;
    this._fcolAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------------------------------------
  // decor types
  // ------------------------------------------------------------------------------------------
  _libGeo(name) {
    if (!this.lib) { this.lib = buildPropLibrary(); this._ownLib = true; }
    return this.lib[name].geometry;
  }

  _type(name) {
    let T = this._T[name];
    if (T !== undefined) return T;
    const def = TDEF[name];
    if (!def || this._types.length >= MAXT) { this._T[name] = null; return null; }
    let geo, owned = true;
    if (def.lib && !def.rc) { geo = this._libGeo(def.lib); owned = false; }
    else if (def.rc) geo = recolor(this._libGeo(def.lib), def.rc);
    else geo = def.make();
    const me = measure(geo);
    const cap = def.cap || 160;
    const mesh = new THREE.InstancedMesh(geo, def.water ? this.matWater : def.glow ? this.matGlow : this.matLit, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.name = 'decor:' + name;
    this.group.add(mesh);
    T = {
      id: this._types.length, name, mesh, geo, owned, cap, count: 0, dirty: false, glow: !!def.glow, meta: new Float32Array(cap * MS),
      hr: me.hr, y0: me.y0, y1: me.y1, sink: def.sink || 0, tris: geo.attributes.position.count / 3,
    };
    this._types.push(T);
    this._T[name] = T;
    return T;
  }

  // ------------------------------------------------------------------------------------------
  // path sample cache (10 m): basis of the corridor tests, the terrain function and the flank cross-sections
  // ------------------------------------------------------------------------------------------
  /** Horizontal unit vector to the right of the path at frame f, from the tangent (the track's own right flips during rolls). */
  _hright(f) {
    const th = Math.hypot(f.tan.x, f.tan.z);
    if (th > 0.25) { this._hrx = -f.tan.z / th; this._hrz = f.tan.x / th; }
    else { const rl = Math.hypot(f.right.x, f.right.z) || 1e-4; this._hrx = f.right.x / rl; this._hrz = f.right.z / rl; }
  }

  /** Ring slot of path sample i, computing it if needed; -1 if it is too far behind for the track to answer. */
  _sample(i) {
    const k = ((i % NS) + NS) % NS;
    if (this._stag[k] !== i) {
      if (i * SP < this._sNow - 62) return -1;
      const s = i * SP, tr = this.track, f = this._sf;
      tr.frame(s, f);
      this._sx[k] = f.pos.x; this._sy[k] = f.pos.y; this._sz[k] = f.pos.z;
      const rl3 = Math.hypot(f.right.x, f.right.y, f.right.z) || 1;
      this._hright(f); // lateral axis from the tangent (stable through corkscrew rolls)
      this._srx[k] = this._hrx; this._srz[k] = this._hrz;
      // half width + cliff flag; taps are clamped to what the track is guaranteed to have generated
      const smax = this._sNow + 315;
      let hw = 3.5;
      if (tr.halfWidth) { const h = tr.halfWidth(s < smax ? s : smax); if (h > 0.5) hw = h; } // a gap reports 0 -> nominal width
      let cl = 0;
      if (tr.edgeAt) for (let q = -1; q <= 1; q++) { const t = s + q * 5; if (tr.edgeAt(t < 0 ? 0 : t > smax ? smax : t) <= 0) cl += 1 / 3; }
      this._shw[k] = hw * Math.abs(f.right.x * this._hrx + f.right.z * this._hrz) / rl3; // half width measured horizontally (banked / rolled track is narrower in plan)
      this._sed[k] = hw * (f.right.y / rl3); // height of the right-hand edge above the centre line (bank)
      this._se[k] = cl;
      this._sov[k] = Infinity;
      this._shole[k] = 0;
      this._stag[k] = i;
      if (i < this._iBase) this._iBase = i;
      this._overlap(i, k);
      this._scan(f.pos.x, f.pos.y, f.pos.z);
    }
    return k;
  }

  /**
   * Self-overlap in plan (helix, loop, corkscrew): another pass of the path lies within OVL_R but is far along the path.
   * _sov[k] = height of the lowest such pass; terrain near sample k is hung from that lower surface instead. A sample that
   * gets lowered after its chunk was built marks the chunk dirty (it is rebuilt in _fixDirty, always far ahead in the fog).
   */
  _overlap(i, k) {
    const yi = this._sy[k] - Math.abs(this._sed[k]), xi = this._sx[k], zi = this._sz[k]; // height of the pass's lower edge
    for (let j = i - OVL_J; j <= i + OVL_J; j++) {
      if (j === i || j < 0) continue;
      const kj = ((j % NS) + NS) % NS;
      if (this._stag[kj] !== j) continue;
      const dx = this._sx[kj] - xi, dz = this._sz[kj] - zi, pd = Math.sqrt(dx * dx + dz * dz);
      if (pd >= OVL_R) continue;
      const ds = Math.abs(j - i) * SP;
      if (ds <= 1.35 * pd + 8) continue;
      if (pd < 22) { // another pass comes close: no ice ceiling over the lower one
        if (this._sy[kj] > this._sy[k] - 6) this._shole[k] = 1;
        if (this._sy[k] > this._sy[kj] - 6 && !this._shole[kj]) { this._shole[kj] = 1; this._ovDirty = true; }
      }
      const yj = this._sy[kj] - Math.abs(this._sed[kj]);
      if (yj < this._sov[k]) this._sov[k] = yj;
      if (yi < this._sov[kj] - 0.25) { this._sov[kj] = yi; this._ovDirty = true; }
    }
  }

  /**
   * A new stretch of path just became known (it is always at the far frontier, inside the fog). The path may curve back
   * towards scenery that was placed before it was known, so every live solid is re-checked against the new sample and
   * switched off if it now intrudes into the corridor. Keeps the corridor rule true however the track bends.
   */
  _scan(px, py, pz) {
    for (let t = 0; t < this._types.length; t++) {
      const T = this._types[t], meta = T.meta;
      for (let i = 0, n = T.count; i < n; i++) {
        const j = i * MS, r = meta[j + 2];
        if (r < 0) continue;
        const dx = meta[j] - px, dz = meta[j + 1] - pz, lim = r + CLEAR + CLEAR_PAD;
        if (dx * dx + dz * dz < lim * lim && !(meta[j + 4] <= py - BELOW) && !(meta[j + 3] >= py + ABOVE)) this._kill(T, i);
      }
    }
    const cl = this._cl;
    if (cl) {
      const hr = this._cloudHr;
      for (let i = 0; i < NCLOUD; i++) {
        if (cl.dead[i]) continue;
        const half = this._cloudH * cl.r[i] * cl.sq[i] + 1.3, rr = cl.r[i] * hr + CLEAR + CLEAR_PAD;
        const dx = cl.x[i] - px, dz = cl.z[i] - pz;
        if (dx * dx + dz * dz < rr * rr && !(cl.y[i] + half <= py - BELOW) && !(cl.y[i] - half >= py + ABOVE)) cl.dead[i] = 1;
      }
    }
  }

  _kill(T, i) {
    const m = T.mesh.instanceMatrix.array, b = i * 16;
    for (let k = 0; k < 16; k++) m[b + k] = 0;
    m[b + 15] = 1; // collapsed to a point
    T.meta[i * MS + 2] = -1;
    T.mesh.instanceMatrix.needsUpdate = true;
  }

  _ensureSamples(sLo, sHi) {
    const i0 = Math.max(0, Math.floor(sLo / SP)), i1 = Math.floor(sHi / SP);
    if (this._iBase > i0) this._iBase = i0;
    for (let i = i0; i <= i1; i++) this._sample(i);
    this._iHi = i1;
  }

  /** Piecewise-constant-per-biome value blended across each portal (+-60 m). */
  _bblend(s, arr) {
    const n = arr.length;
    if (OVR >= 0) return arr[OVR % n];
    const kb = Math.round(s / BIOME_LENGTH), bs = kb * BIOME_LENGTH;
    if (kb >= 1 && s > bs - 60 && s < bs + 60) return lerp(arr[(kb - 1) % n], arr[kb % n], smooth(bs - 60, bs + 60, s));
    return arr[biomeIdx(s) % n];
  }
  _depthAt(s) { return this._bblend(s, this._bDepth); }
  _flankU(s) { return this._bblend(s, this._bU); }
  _flankE(s) { return this._bblend(s, this._bE); }

  /** Smoothed cliff flag (0 bank .. 1 cliff) at sample i. */
  _cliffAt(i) {
    const k = ((i % NS) + NS) % NS, se = this._se;
    const a = se[k];
    const k0 = (k + NS - 1) % NS, k1 = (k + 1) % NS;
    const a0 = this._stag[k0] === i - 1 ? se[k0] : a;
    const a1 = this._stag[k1] === i + 1 ? se[k1] : a;
    return 0.25 * a0 + 0.5 * a + 0.25 * a1;
  }

  /** Rugged noise added to the slope. */
  _rug(x, z, du, U) { return (vnoise(x * 0.11 + 1.7, z * 0.11 + 8.3) - 0.5) * 4.5 * smooth(0, 18, du) * (1 - smooth(U * 0.55, U, du)); }

  /** Height offset (negative, relative to the track surface) at lateral distance du from the track edge. */
  _drop(du, D, U, e, c) {
    const t = du >= U ? 1 : du / U;
    const bank = -D * (1 - Math.pow(1 - t, e)) - 0.35 * (1 - t);
    if (c <= 0.001) return bank;
    const CL = Math.min(26, D * 0.5);
    let cliff;
    if (du < 1.4) { const q = du / 1.4; cliff = -0.5 - (CL - 0.5) * q * q * (3 - 2 * q); }
    else cliff = -CL - (D - CL) * (1 - Math.pow(1 - t, 1.4));
    return bank + (cliff - bank) * c;
  }

  /** Nearest point on the (sampled, extrapolated past the frontier) path; fills _nI/_nT/_nD. hint = sample index guess. */
  _nearest(x, z, hint) {
    const iHi = this._iHi, iLo = Math.max(this._iBase, iHi - 1800);
    let i = hint < iLo ? iLo : hint > iHi ? iHi : hint | 0;
    const sx = this._sx, sz = this._sz;
    let k = ((i % NS) + NS) % NS;
    let dx = x - sx[k], dz = z - sz[k], d0 = dx * dx + dz * dz;
    for (let guard = 0; guard < 400; guard++) {
      if (i < iHi) {
        const k1 = (k + 1) % NS, ex = x - sx[k1], ez = z - sz[k1], d1 = ex * ex + ez * ez;
        if (d1 < d0) { i++; k = k1; d0 = d1; continue; }
      }
      if (i > iLo) {
        const k1 = (k + NS - 1) % NS, ex = x - sx[k1], ez = z - sz[k1], d1 = ex * ex + ez * ez;
        if (d1 < d0) { i--; k = k1; d0 = d1; continue; }
      }
      break;
    }
    let bi = i, bt = 0, bd2 = Infinity;
    for (let a = i - 1; a <= i; a++) {
      if (a < iLo || a + 1 > iHi) continue;
      const ka = ((a % NS) + NS) % NS, kb = (ka + 1) % NS;
      const ax = sx[ka], az = sz[ka], vx = sx[kb] - ax, vz = sz[kb] - az;
      const L2 = vx * vx + vz * vz || 1;
      let t = ((x - ax) * vx + (z - az) * vz) / L2;
      if (t < 0) t = 0; else if (t > 1 && a + 1 < iHi) t = 1; // the last segment extrapolates beyond the frontier
      const px = x - (ax + vx * t), pz = z - (az + vz * t), d2 = px * px + pz * pz;
      if (d2 < bd2) { bd2 = d2; bi = a; bt = t; }
    }
    if (bd2 === Infinity) { bi = Math.min(Math.max(i, iLo), iHi - 1); bt = 0; bd2 = d0; }
    this._nI = bi; this._nT = bt; this._nD = Math.sqrt(bd2);
  }

  /** Public: terrain height under world (x,z) near path position s (null when unknown). */
  groundAt(x, z, s) {
    try { const y = this._field(x, z, Math.max(0, Math.floor(s / SP))); return Number.isFinite(y) ? y : null; } catch (e) { return null; }
  }

  /**
   * Terrain height at world (x,z): the ridge the track runs along. Sets _fy (terrain), _ff (valley floor), _fdu (distance
   * from the track edge), _fs (path parameter of the nearest path point), _fpy (track surface height there).
   */
  _field(x, z, hint) {
    this._nearest(x, z, hint);
    const a = this._nI, t = this._nT;
    const ka = ((a % NS) + NS) % NS, kb = (ka + 1) % NS;
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const py = this._sy[ka] + (this._sy[kb] - this._sy[ka]) * t;
    const sS = (a + t) * SP;
    const D = this._depthAt(sS), U = this._flankU(sS);
    const hw = this._shw[ka] + (this._shw[kb] - this._shw[ka]) * tc;
    const du = this._nD - hw;
    const lo = Math.min(this._sov[ka], this._sov[kb]);
    this._ff = Math.min(py, lo) - D; this._fpy = py; this._fs = sS; this._fdu = du;
    if (du >= U) { this._fy = this._ff; return this._fy; }
    // banked turns: the two edges are at different heights
    let ed = Math.max(Math.abs(this._sed[ka]), Math.abs(this._sed[kb])); // banked / rolled track: hang from the LOWER edge
    ed += 0.5 * (ed > 2.5 ? 1 : ed / 2.5);
    const c = this._cliffAt(a) * (1 - tc) + this._cliffAt(a + 1) * tc;
    const dr = this._drop(du < 0 ? 0 : du, D, U, this._flankE(sS), c);
    let y = py - ed + dr;
    if (du > 0.5) y += this._rug(x, z, du, U);
    if (lo < py) { // another pass of the path lies below (helix, loop): hang the terrain from it, 0.5 m under its centre line
      const yl = lo - 0.5 + dr;
      if (yl < y) y = yl;
    }
    this._fy = y;
    return y;
  }

  /**
   * Is a solid with horizontal footprint radius r at (x,z), vertical span [bottom,top], allowed near the path?
   * Corridor rule: within 12 m laterally of the centre line it must be >= 25 m below or >= 30 m above the path.
   */
  _clear(x, z, r, bottom, top, s) {
    // every sample we know: from far behind (cached ones only) up to the frontier. The path can bend around a landmark.
    const i0 = Math.max(0, Math.floor((s - 450) / SP));
    const i1 = this._iHi;
    const lim = r + CLEAR + CLEAR_PAD;
    const lim2 = lim * lim;
    for (let i = i0; i <= i1; i++) {
      const k = this._sample(i);
      if (k < 0) continue;
      const dx = x - this._sx[k], dz = z - this._sz[k];
      if (dx * dx + dz * dz < lim2) {
        const py = this._sy[k];
        if (!(top <= py - BELOW) && !(bottom >= py + ABOVE)) return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // scenery placement
  // ------------------------------------------------------------------------------------------
  _overlaps(x, z, r) {
    let ch = this._ch;
    for (let pass = 0; pass < 2; pass++) {
      if (ch) {
        const c = ch.circ;
        for (let j = 0, n = ch.nc * 3; j < n; j += 3) {
          const dx = x - c[j], dz = z - c[j + 1], rr = r + c[j + 2];
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
      ch = this._prev;
    }
    return false;
  }

  /**
   * Place one instance of decor `name` at path coords (s, u). Scale per axis. yaw: undefined = random,
   * 'path' | 'pathR' | 'left' | 'right' | 'face' | absolute radians. o: { lift, tilt, block, yo, ov }.
   */
  _put(name, s, u, sx, sy, sz, yaw, tint, o) {
    const T = this._type(name);
    if (!T || T.count >= T.cap) return false;
    const f = this._f;
    this.track.frame(s, f);
    this._hright(f);
    const rx = this._hrx, rz = this._hrz;
    const x = f.pos.x + rx * u, z = f.pos.z + rz * u;
    const lift = (o && o.lift) || 0;
    const hr = T.hr * Math.max(sx, sz);
    const hint = Math.floor(s / SP);
    let y = this._field(x, z, hint);
    const yPlain = y;
    const du = this._fdu, onFloor = du >= this._flankU(this._fs);
    if (du < 0.6) return false;                                   // never on or under the track
    if (o && o.floor && du < this._flankU(this._fs) + (o.fm || 0)) return false;
    if (!onFloor && hr <= 14) {                                   // on a slope: stand on the lowest corner of the footprint
      const rr = hr * 0.55;
      y = Math.min(y, this._field(x + rr, z, hint), this._field(x - rr, z, hint), this._field(x, z + rr, hint), this._field(x, z - rr, hint));
    }
    y += lift - T.sink * sy;
    if (!this._clear(x, z, hr, y + T.y0 * sy, y + T.y1 * sy, s)) return false;
    const block = !(o && o.block === false);
    const ov = hr * ((o && o.ov) || 0.85);
    if (block && this._overlaps(x, z, ov)) return false;

    let a;
    if (yaw === undefined) a = this._r.next() * 6.2831853;
    else if (typeof yaw === 'number') a = yaw;
    else if (yaw === 'path') a = Math.atan2(f.tan.x, f.tan.z);
    else if (yaw === 'pathR') a = Math.atan2(-f.tan.x, -f.tan.z);
    else if (yaw === 'right') a = Math.atan2(rx, rz);
    else if (yaw === 'left') a = Math.atan2(-rx, -rz);
    else { const sg = u < 0 ? -1 : 1; a = Math.atan2(-rx * sg, -rz * sg); } // 'face'
    if (o && o.yo) a += o.yo;

    const c = Math.cos(a), sn = Math.sin(a);
    const tilt = (o && o.tilt) || 0;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const mesh = T.mesh;
    const b = T.count * 16;
    const m = mesh.instanceMatrix.array;
    m[b] = c * sx; m[b + 1] = 0; m[b + 2] = -sn * sx; m[b + 3] = 0;
    m[b + 4] = sn * st * sy; m[b + 5] = ct * sy; m[b + 6] = c * st * sy; m[b + 7] = 0;
    m[b + 8] = sn * ct * sz; m[b + 9] = -st * sz; m[b + 10] = c * ct * sz; m[b + 11] = 0;
    m[b + 12] = x; m[b + 13] = y; m[b + 14] = z; m[b + 15] = 1;
    const ca = mesh.instanceColor.array, cb = T.count * 3;
    if (tint) { ca[cb] = tint.r; ca[cb + 1] = tint.g; ca[cb + 2] = tint.b; }
    else { ca[cb] = 1; ca[cb + 1] = 1; ca[cb + 2] = 1; }
    const mj = T.count * MS;
    T.meta[mj] = x; T.meta[mj + 1] = z; T.meta[mj + 2] = hr; T.meta[mj + 3] = y + T.y0 * sy; T.meta[mj + 4] = y + T.y1 * sy; T.meta[mj + 5] = y - yPlain;
    T.count++;
    T.dirty = true;
    const ch = this._ch;
    ch.cnt[T.id]++;
    if (block && ch.nc < 480) {
      const j = ch.nc * 3;
      ch.circ[j] = x; ch.circ[j + 1] = z; ch.circ[j + 2] = ov;
      ch.nc++;
    }
    return true;
  }

  /** Scatter `n` (fractional ok) instances in this chunk. o: { mx,my,mz, pal, yaw, lift, tilt, pow, clump, block, side, ov, yo }. */
  _sc(name, n, u0, u1, k0, k1, o) {
    const R = this._r, ch = this._ch;
    let cnt = Math.floor(n);
    if (R.next() < n - cnt) cnt++;
    const mx = (o && o.mx) || 1, my = (o && o.my) || 1, mz = (o && o.mz) || 1;
    const base = o && o.rel ? this._cU + 3.5 : 0; // rel: lateral offsets count from the toe of the flank, i.e. the valley floor
    for (let k = 0; k < cnt; k++) {
      const s = ch.s0 + R.next() * CH;
      const rr = R.next();
      const u = base + u0 + (u1 - u0) * (o && o.pow ? Math.pow(rr, o.pow) : rr);
      const side = (o && o.side) || (R.next() < 0.5 ? -1 : 1);
      const sc = k0 + (k1 - k0) * R.next();
      const pi = R.next();
      const yw = o && o.yaw !== undefined ? o.yaw : undefined;
      const ya = R.next() * 6.2831853;
      if (o && o.clump && vnoise(s * 0.028 + 3.1, u * side * 0.028 + 5.7) < o.clump) continue;
      const tint = o && o.pal ? o.pal[(pi * o.pal.length) | 0] : null;
      let oo = o;
      if (o && o.liftR) oo = Object.assign({}, o, { lift: o.liftR[0] + (o.liftR[1] - o.liftR[0]) * R.next() });
      this._put(name, s, side * u, sc * mx, sc * my, sc * mz, yw === undefined ? ya : yw, tint, oo);
    }
  }

  _genChunk(id) {
    const ch = this._pool.pop() || { id: 0, s0: 0, s1: 0, cnt: new Int32Array(MAXT), circ: new Float32Array(480 * 3), nc: 0, wallV: 0, wallOff: 0, ceilV: 0, ceilOff: 0, dirty: false };
    ch.id = id; ch.s0 = id * CH; ch.s1 = ch.s0 + CH; ch.cnt.fill(0); ch.nc = 0; ch.dirty = false;
    this._prev = this._chunks.length ? this._chunks[this._chunks.length - 1] : null;
    this._ch = ch;
    this._r = makeRng((Math.imul(id + 1, 0x9e3779b1) ^ 0x85ebca6b) >>> 0);
    const b = BIOMES[biomeIdx(ch.s0) % BIOMES.length];
    this._cU = this._flankU(ch.s0 + CH * 0.5);
    this._genFlank(ch);
    this._genWall(ch);
    this._genCeil(ch);
    GEN[b.id](this, this._r);
    this._chunks.push(ch);
    for (let i = 0; i < this._types.length; i++) {
      const T = this._types[i];
      if (!T.dirty) continue;
      T.dirty = false;
      T.mesh.count = T.count;
      T.mesh.visible = T.count > 0;
      T.mesh.instanceMatrix.needsUpdate = true;
      T.mesh.instanceColor.needsUpdate = true;
    }
    this._ch = null; this._prev = null;
  }

  _recycleOldest() {
    const ch = this._chunks.shift();
    for (let t = 0; t < this._types.length; t++) {
      const n = ch.cnt[t];
      if (!n) continue;
      const T = this._types[t];
      const rest = T.count - n;
      const ma = T.mesh.instanceMatrix.array, ca = T.mesh.instanceColor.array;
      if (rest > 0) { ma.copyWithin(0, n * 16, T.count * 16); ca.copyWithin(0, n * 3, T.count * 3); T.meta.copyWithin(0, n * MS, T.count * MS); }
      T.count = rest;
      T.mesh.count = rest;
      T.mesh.visible = rest > 0;
      T.mesh.instanceMatrix.needsUpdate = true;
      T.mesh.instanceColor.needsUpdate = true;
    }
    if (ch.wallV) {
      const n = ch.wallV * 3, end = this._wn * 3;
      this._wpos.copyWithin(0, n, end); this._wcol.copyWithin(0, n, end); this._wnor.copyWithin(0, n, end);
      for (const c of this._chunks) if (c.wallV) c.wallOff -= ch.wallV;
      this._wn -= ch.wallV;
      ch.wallV = 0;
      this._wallFlush();
    }
    if (ch.ceilV) {
      const n = ch.ceilV * 3, end = this._cn * 3;
      this._cpos.copyWithin(0, n, end); this._ccol.copyWithin(0, n, end); this._cnor.copyWithin(0, n, end);
      for (const c of this._chunks) if (c.ceilV) c.ceilOff -= ch.ceilV;
      this._cn -= ch.ceilV;
      ch.ceilV = 0;
      this._ceilFlush();
    }
    this._pool.push(ch);
  }

  _clearChunks() {
    while (this._chunks.length) this._recycleOldest();
    this._fpos.fill(0);
    this._fposAttr.needsUpdate = true;
  }

  /**
   * A pass of the path below an earlier one became known (helix, loop): terrain built before that may hang too high.
   * Rebuild live chunks (2 per frame, in the fog), then lower any decor left hovering over the new ground.
   */
  _fixDirty() {
    if (this._ovDirty) { this._ovDirty = false; for (const ch of this._chunks) ch.dirty = true; this._revalNeeded = true; }
    let left = 2;
    for (const ch of this._chunks) {
      if (!ch.dirty) continue;
      if (left-- <= 0) return; // the rest next frame
      ch.dirty = false;
      this._genFlank(ch);
      if (ch.wallV) this._genWall(ch, ch.wallOff);
      if (ch.ceilV) this._genCeil(ch, ch.ceilOff);
    }
    if (!this._revalNeeded) return;
    this._revalNeeded = false;
    const hint = Math.floor(this._sNow / SP);
    for (let t = 0; t < this._types.length; t++) {
      const T = this._types[t], meta = T.meta, m = T.mesh.instanceMatrix.array;
      let changed = false;
      for (let i = 0, n = T.count; i < n; i++) {
        const j = i * MS;
        if (meta[j + 2] < 0 || meta[j + 5] > 4) continue; // dead, or floating (balloons, islands, gulls keep their height)
        const yNew = this._field(meta[j], meta[j + 1], hint) + meta[j + 5];
        const dy = yNew - m[i * 16 + 13];
        if (dy < -1) { m[i * 16 + 13] += dy; meta[j + 3] += dy; meta[j + 4] += dy; changed = true; }
      }
      if (changed) T.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _updateChunks(s) {
    const lo = Math.max(0, Math.floor((s - BEHIND) / CH));
    const hi = Math.floor((s + AHEAD) / CH) - 1; // chunk end (hi+1)*CH <= s + AHEAD
    const ck = this._chunks;
    if (ck.length && (s < ck[0].s0 - 150 || ck[ck.length - 1].id < lo - 1)) this._clearChunks(); // jumped
    while (ck.length && ck[0].id < lo) this._recycleOldest();
    // never ask the track about a path stretch it may already have trimmed (runner keeps ~60 m behind the ball)
    const first = Math.max(lo, Math.ceil((s - 55) / CH));
    let next = ck.length ? ck[ck.length - 1].id + 1 : first;
    let made = 0;
    const max = this._inited ? 2 : 64;
    while (next <= hi && made < max) {
      this._genChunk(next);
      next++; made++;
    }
  }

  // ------------------------------------------------------------------------------------------
  // look blending
  // ------------------------------------------------------------------------------------------
  _enterBiome(bi, snap) {
    this.bIdx = bi;
    const n = BIOMES.length;
    this.biome = BIOMES[bi % n];
    const L = this._ld[bi % n];
    for (let i = 0; i < NC; i++) { this.cFrom[i].copy(this.cCur[i]); this.cTo[i].copy(L.c[i]); }
    for (let i = 0; i < NN; i++) { this.nFrom[i] = this.nCur[i]; this.nTo[i] = L.n[i]; }
    if (snap) {
      for (let i = 0; i < NC; i++) this.cCur[i].copy(this.cTo[i]);
      for (let i = 0; i < NN; i++) this.nCur[i] = this.nTo[i];
      this._blendT = 1;
    } else this._blendT = 0;
    this._lookDirty = true;
    this._warm = (BIOME_TYPES[BIOMES[(bi + 1) % n].id] || []).filter((nm) => this._T[nm] === undefined);
    // sun sprite flavour
    const kind = this.biome.disc.kind;
    if (kind !== this._discKind) {
      this._discKind = kind;
      const t = kind === 'retro' ? this._sunTexB : kind === 'earth' ? this._sunTexC : this._sunTexA;
      if (t) this.discMat.map = t;
    }
    const mods = (this.biome.modsHard && bi >= n) ? this.biome.modsHard : this.biome.mods;
    this._fmT = mods.fog;
    if (snap) this._fm = this._fmT;
    this._setParticles(this.biome, snap || !this._pInit);
  }

  _mixLook() {
    const k = smooth(0, 1, this._blendT);
    for (let i = 0; i < NC; i++) this.cCur[i].copy(this.cFrom[i]).lerp(this.cTo[i], k);
    for (let i = 0; i < NN; i++) this.nCur[i] = this.nFrom[i] + (this.nTo[i] - this.nFrom[i]) * k;
    this._lookDirty = true;
  }

  /** YETİ RADYOSU: a cosmetic sky/fog remix (colour + 0..1 strength), eased in update(). */
  setRadio(hex, k) {
    if (!this._rdC) { this._rdC = new THREE.Color(); this._rdT = new THREE.Color(); this._rdK = 0; this._rdKT = 0; this._rdS = new THREE.Color(); this._rdC.set(hex); }
    this._rdT.set(hex); this._rdKT = k;
  }

  _applyLook() {
    const c = this.cCur;
    const rk = this._rdK || 0, rc = this._rdC, sc = this._rdS;
    if (rk > 0.002) {
      this.fog.color.copy(sc.copy(c[3]).lerp(rc, rk));
      this.bg.copy(sc.copy(c[2]).lerp(rc, rk));
    } else {
      this.fog.color.copy(c[3]);
      this.bg.copy(c[2]);
    }
    this.hemi.color.copy(c[4]);
    this.hemi.groundColor.copy(c[5]);
    this.sunL.color.copy(c[6]);
    this.discMat.color.copy(c[7]);
    this.cloudMat.color.copy(c[8]);
    this.cloudMat.emissive.copy(c[8]).multiplyScalar(0.36);
    // colour grade + ball rim of this biome (shared shader uniforms, see shaders.js)
    const nn = this.nCur;
    SU.uSh.value.copy(c[9]); SU.uHi.value.copy(c[10]); SU.uRim.value.copy(c[11]);
    SU.uGrade.value.set(nn[18], nn[19], nn[20], nn[21]);
    // sky gradient
    const col = this.sky.geometry.attributes.color, a = col.array, w = this._skyW;
    let t = c[0], m = c[1], h = c[2];
    if (rk > 0.002) {
      if (!this._rdA) this._rdA = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
      t = this._rdA[0].copy(t).lerp(rc, rk); m = this._rdA[1].copy(m).lerp(rc, rk); h = this._rdA[2].copy(h).lerp(rc, rk);
    }
    for (let i = 0, n = col.count; i < n; i++) {
      const j = i * 3;
      a[j] = w[j] * h.r + w[j + 1] * m.r + w[j + 2] * t.r;
      a[j + 1] = w[j] * h.g + w[j + 1] * m.g + w[j + 2] * t.g;
      a[j + 2] = w[j] * h.b + w[j + 1] * m.b + w[j + 2] * t.b;
    }
    col.needsUpdate = true;
    this._lookDirty = false;
  }

  _setParticles(biome, resetPos) {
    const cfg = biome.particles;
    this._pcfg = cfg;
    const n = Math.min(NPART, cfg.n);
    this._pn = n;
    this._pSize = cfg.size;
    this.partMat.size = cfg.size;
    this.partMat.blending = cfg.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    const col = this._pcol, vel = this._pvel;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      let acc = 0, g = cfg.groups[cfg.groups.length - 1];
      for (let q = 0; q < cfg.groups.length; q++) { acc += cfg.groups[q].f; if (u <= acc + 1e-6) { g = cfg.groups[q]; break; } }
      const hex = g.pal[(ihash(i, 31) * g.pal.length) | 0];
      _tc.setHex(hex);
      col[i * 4] = _tc.r; col[i * 4 + 1] = _tc.g; col[i * 4 + 2] = _tc.b;
      vel[i * 3] = g.v[0] + g.j[0] * (ihash(i, 32) * 2 - 1);
      vel[i * 3 + 1] = g.v[1] + g.j[1] * (ihash(i, 33) * 2 - 1);
      vel[i * 3 + 2] = g.v[2] + g.j[2] * (ihash(i, 34) * 2 - 1);
      this._pbase[i] = cfg.alpha * (0.6 + 0.4 * ihash(i, 35));
      this._pph[i] = ihash(i, 36) * 6.283;
    }
    if (resetPos) {
      const p = this._ppos, cp = this._cp;
      for (let i = 0; i < NPART; i++) {
        p[i * 3] = cp.x + (ihash(i, 41) * 2 - 1) * 50;
        p[i * 3 + 1] = cp.y - 6 + (ihash(i, 42) * 2 - 1) * 28;
        p[i * 3 + 2] = cp.z + (ihash(i, 43) * 2 - 1) * 50;
      }
      this._pInit = true;
    }
    this.particles.geometry.setDrawRange(0, n);
    this._pcolAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------------------------------------
  // clouds
  // ------------------------------------------------------------------------------------------
  _spawnCloud(i, init) {
    const cl = this._cl;
    const s = this._sNow;
    const sd = (((Math.floor(s / 4) * 7919) ^ (i * 104729)) | 0);
    const rnd = (k) => ihash(sd, k, 77); // deterministic per s
    const along = init ? -50 + rnd(1) * (AHEAD - 20) : 140 + rnd(1) * (AHEAD - 170);
    const sSp = clamp(s + along, 0, this._frontier - 1);
    const high = rnd(2) < 0.3; // 30%: high above the run; 70%: banks of cloud drifting over the slopes and the valley
    const r = high ? 11 + rnd(3) * 9 : 8 + rnd(3) * 9;
    const f = this._f;
    this.track.frame(sSp, f);
    this._hright(f);
    const rx = this._hrx, rz = this._hrz;
    const sq = 0.55 + rnd(4) * 0.2;       // vertical squash of the puff
    const half = this._cloudH * r * sq + 1.3; // half height (+ the vertical bob)
    const py = f.pos.y, hint = Math.floor(sSp / SP);
    let u, y;
    if (high) {
      u = (rnd(5) * 2 - 1) * 150;
      y = py + 31 + half + 3 + rnd(6) * 36;
    } else {
      u = (rnd(5) < 0.5 ? -1 : 1) * (30 + r + rnd(7) * 140);
      // hover above the highest ground under the puff, up to a little above the track surface
      const x0 = f.pos.x + rx * u, z0 = f.pos.z + rz * u;
      let top = this._field(x0, z0, hint);
      top = Math.max(top, this._field(x0 + r, z0, hint), this._field(x0 - r, z0, hint), this._field(x0, z0 + r, hint), this._field(x0, z0 - r, hint));
      const yMin = top + half + 3, yMax = Math.max(yMin + 1, py + 16);
      y = lerp(yMin, yMax, Math.pow(rnd(6), 1.4));
    }
    let x = f.pos.x + rx * u, z = f.pos.z + rz * u;
    if (!this._clear(x, z, r * this._cloudHr, y - half, y + half, sSp)) {
      u = (u < 0 ? -1 : 1) * 260; // fall back to a spot far to the side
      x = f.pos.x + rx * u; z = f.pos.z + rz * u;
    }
    cl.x[i] = x; cl.y[i] = y; cl.z[i] = z; cl.r[i] = r; cl.sq[i] = sq;
    cl.vx[i] = (rnd(8) * 2 - 1) * 0.9; cl.vz[i] = (rnd(9) * 2 - 1) * 0.9;
    cl.hi[i] = hint;
    cl.ph[i] = rnd(10) * 6.283; cl.yaw[i] = rnd(11) * 6.283;
    cl.dead[i] = 0;
  }

  _updateClouds(dt) {
    const cl = this._cl, N = NCLOUD, m = this.clouds.instanceMatrix.array;
    const bf = this._bf, fx = this._fx, fz = this._fz;
    if (!this._cloudsInit) {
      for (let i = 0; i < N; i++) this._spawnCloud(i, true);
      this._cloudsInit = true;
      this.clouds.count = N;
      this.clouds.visible = true;
    }
    const t = this.time;
    const camt = this.nCur[16];
    this.clouds.visible = camt > 0.03;
    for (let i = 0; i < N; i++) {
      cl.x[i] += cl.vx[i] * dt;
      cl.z[i] += cl.vz[i] * dt;
      const dx = cl.x[i] - bf.pos.x, dz = cl.z[i] - bf.pos.z;
      const along = dx * fx + dz * fz;
      const lat = -dx * fz + dz * fx;
      let respawn = cl.dead[i] || along < -90 || along > AHEAD + 40 || lat > 360 || lat < -360;
      if (!respawn) { // wind must never carry a puff into the corridor
        this._nearest(cl.x[i], cl.z[i], cl.hi[i]);
        cl.hi[i] = this._nI;
        const half = this._cloudH * cl.r[i] * cl.sq[i] + 1.3, lim = cl.r[i] * this._cloudHr + CLEAR + CLEAR_PAD;
        // every sample of the last 600 m of path (other passes of a helix or loop lie far along the path but close in plan)
        for (let a = Math.max(this._iBase, this._iHi - 120); a <= this._iHi && !respawn; a++) {
          const k = ((a % NS) + NS) % NS;
          if (this._stag[k] !== a) continue;
          const dx = cl.x[i] - this._sx[k], dz = cl.z[i] - this._sz[k];
          if (dx * dx + dz * dz < lim * lim && !(cl.y[i] + half <= this._sy[k] - BELOW) && !(cl.y[i] - half >= this._sy[k] + ABOVE)) respawn = true;
        }
      }
      if (respawn) this._spawnCloud(i, false);
      const r = cl.r[i];
      const a = cl.yaw[i], c = Math.cos(a), sn = Math.sin(a);
      const b = i * 16;
      const ra = r * camt;
      const sy = ra * cl.sq[i];
      m[b] = c * ra; m[b + 1] = 0; m[b + 2] = -sn * ra; m[b + 3] = 0;
      m[b + 4] = 0; m[b + 5] = sy; m[b + 6] = 0; m[b + 7] = 0;
      m[b + 8] = sn * ra; m[b + 9] = 0; m[b + 10] = c * ra; m[b + 11] = 0;
      m[b + 12] = cl.x[i]; m[b + 13] = cl.y[i] + Math.sin(t * 0.25 + cl.ph[i]) * 1.2; m[b + 14] = cl.z[i]; m[b + 15] = 1;
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------------------------------
  // ground
  // ------------------------------------------------------------------------------------------
  /**
   * Portal plane at the start of biome k: a world point + horizontal tangent. Exact values are cached; a boundary that is
   * still beyond the generated path is extrapolated along the tangent at the frontier (only ever seen through fog).
   */
  _boundary(k, s) {
    const sB = k * BIOME_LENGTH;
    const arr = this._bnd;
    for (let i = 0; i < 3; i++) if (arr[i].k === k) return arr[i];
    if (sB < s - 50) return null; // behind what the track can still answer
    const exact = sB <= this._frontier;
    let b = this._bext;
    if (exact) {
      b = arr[0];
      for (let i = 1; i < 3; i++) if (arr[i].k < b.k) b = arr[i];
    }
    const sc = exact ? sB : this._frontier;
    const f = this._tf;
    this.track.frame(sc, f);
    let tx = f.tan.x, tz = f.tan.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    b.x = f.pos.x + tx * (sB - sc);
    b.z = f.pos.z + tz * (sB - sc);
    b.tx = tx; b.tz = tz;
    b.k = exact ? k : -1;
    return b;
  }

  _groundCol(bi, wx, wz, out) {
    const g = this._gc[bi % BIOMES.length];
    const n1 = vnoise(wx * 0.011 + bi * 17.3, wz * 0.011);
    const n2 = vnoise(wx * 0.027 - 4.1, wz * 0.027 + bi * 3.7);
    const t1 = smooth(0.38, 0.62, n1), t2 = smooth(0.5, 0.82, n2) * 0.7;
    const c0 = g[0], c1 = g[1], c2 = g[2];
    const sh = 0.94 + 0.06 * n2;
    out[0] = (c0.r + (c1.r - c0.r) * t1 + (c2.r - lerp(c0.r, c1.r, t1)) * t2) * sh;
    out[1] = (c0.g + (c1.g - c0.g) * t1 + (c2.g - lerp(c0.g, c1.g, t1)) * t2) * sh;
    out[2] = (c0.b + (c1.b - c0.b) * t1 + (c2.b - lerp(c0.b, c1.b, t1)) * t2) * sh;
  }

  _updateGround(cp, s, bi) {
    const W = GN + 1, half = GN / 2;
    const sx = Math.round(cp.x / CELL) * CELL, sz = Math.round(cp.z / CELL) * CELL;
    this.ground.position.set(sx, 0, sz);
    this.grid.position.set(sx, GRID_LIFT, sz);
    const n = BIOMES.length;
    const ov = OVR >= 0;
    const b0 = !ov && bi >= 1 ? this._boundary(bi, s) : null;
    const b1 = ov ? null : this._boundary(bi + 1, s);
    const gMay = this._gridOK && (BIOMES[bi % n].grid || (!ov && (BIOMES[(bi + 1) % n].grid || (bi >= 1 && BIOMES[(bi - 1) % n].grid))));
    let anyG = false;
    const gcur = BIOMES[bi % n].grid, gprev = !ov && bi >= 1 ? BIOMES[(bi - 1) % n].grid : 0, gnext = ov ? 0 : BIOMES[(bi + 1) % n].grid;
    const pos = this._gpos, col = this._gcol, gcol = this._gridcol;
    const A = this._vtmp, B = this._vtmp2;
    const cy = this._cyan, mg = this._magenta;
    const inv = 1 / 330;
    const sy = this._sy;
    let hintRow = Math.floor(s / SP);
    for (let j = 0; j < W; j++) {
      const wz = sz + (j - half) * CELL;
      let hint = hintRow;
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const wx = sx + (i - half) * CELL;
        // the valley floor lies a fixed depth below the (descending) track, measured at the nearest path point
        this._nearest(wx, wz, hint);
        hint = this._nI;
        if (i === 0) hintRow = hint;
        const ka = ((this._nI % NS) + NS) % NS, kb = (ka + 1) % NS;
        pos[k * 3 + 1] = Math.min(sy[ka] + (sy[kb] - sy[ka]) * this._nT, this._sov[ka], this._sov[kb]) - this._depthAt((this._nI + this._nT) * SP);
        // portal planes: ground colour switches exactly across the portal ring
        let w0 = 1, w1 = 0;
        if (b0) w0 = smooth(-60, 60, (wx - b0.x) * b0.tx + (wz - b0.z) * b0.tz);
        if (b1) w1 = smooth(-60, 60, (wx - b1.x) * b1.tx + (wz - b1.z) * b1.tz);
        const wPrev = (1 - w0) * (1 - w1), wNext = w1, wCur = 1 - wPrev - wNext;
        let r = 0, g = 0, b = 0;
        if (wCur > 0.002) { this._groundCol(bi, wx, wz, A); r += A[0] * wCur; g += A[1] * wCur; b += A[2] * wCur; }
        if (wPrev > 0.002) { this._groundCol(bi - 1, wx, wz, B); r += B[0] * wPrev; g += B[1] * wPrev; b += B[2] * wPrev; }
        if (wNext > 0.002) { this._groundCol(bi + 1, wx, wz, B); r += B[0] * wNext; g += B[1] * wNext; b += B[2] * wNext; }
        col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
        if (gMay) {
          const nw = wCur * gcur + wPrev * gprev + wNext * gnext;
          if (nw > 0.002) {
            anyG = true;
            const d = Math.hypot(wx - cp.x, wz - cp.z) * inv;
            const q = smooth(0.1, 0.85, d);
            const fade = nw * (1 - smooth(0.4, 1.0, d));
            gcol[k * 3] = (cy.r + (mg.r - cy.r) * q) * fade;
            gcol[k * 3 + 1] = (cy.g + (mg.g - cy.g) * q) * fade;
            gcol[k * 3 + 2] = (cy.b + (mg.b - cy.b) * q) * fade;
          } else { gcol[k * 3] = gcol[k * 3 + 1] = gcol[k * 3 + 2] = 0; }
        }
      }
    }
    this._gposAttr.needsUpdate = true;
    this._gcolAttr.needsUpdate = true;
    this.grid.visible = anyG;
    if (anyG) this._gridColAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------------------------------------
  // particles / celestial
  // ------------------------------------------------------------------------------------------
  _updateParticles(dt, cp) {
    const n = this._pn;
    if (!n) return;
    const pos = this._ppos, vel = this._pvel, col = this._pcol, base = this._pbase, ph = this._pph;
    const hx = 50, hy = 28, hz = 50;
    const cx = cp.x + this._fx * 20, cz = cp.z + this._fz * 20, cy = cp.y - 6;
    const t = this.time, tw = this._pcfg.twinkle;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      let dx = pos[k] + vel[k] * dt - cx, dy = pos[k + 1] + vel[k + 1] * dt - cy, dz = pos[k + 2] + vel[k + 2] * dt - cz;
      dx -= Math.floor((dx + hx) / (2 * hx)) * 2 * hx;
      dy -= Math.floor((dy + hy) / (2 * hy)) * 2 * hy;
      dz -= Math.floor((dz + hz) / (2 * hz)) * 2 * hz;
      const x = cx + dx, y = cy + dy, z = cz + dz;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      let a = base[i] * (1 - smooth(0.55, 1, Math.abs(dx) / hx)) * (1 - smooth(0.55, 1, Math.abs(dy) / hy)) * (1 - smooth(0.55, 1, Math.abs(dz) / hz));
      const ex = x - cp.x, ey = y - cp.y, ez = z - cp.z;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < 400) a *= d2 * 0.0025; // fade out within 20 m of the camera
      if (tw) a *= 0.62 + 0.38 * Math.sin(t * 3.1 + ph[i]);
      col[i * 4 + 3] = a;
    }
    this._pposAttr.needsUpdate = true;
    this._pcolAttr.needsUpdate = true;
  }

  _updateCelestial(cp) {
    const R = this._domeR * 0.96;
    const nn = this.nCur;
    const dir = this._dir;
    // sun / moon sprite
    const ps = this._head + nn[6], el = nn[7], ce = Math.cos(el);
    dir.set(Math.sin(ps) * ce, Math.sin(el), -Math.cos(ps) * ce);
    this.disc.position.copy(cp).addScaledVector(dir, R);
    this.disc.scale.setScalar((2 * R * nn[8]) / DISC_F);
    this.disc.lookAt(cp);
    // directional light follows the path heading
    const pl = this._head + nn[4], el2 = nn[5], c2 = Math.cos(el2);
    this.sunL.position.set(Math.sin(pl) * c2 * 100, Math.sin(el2) * 100, -Math.cos(pl) * c2 * 100);
    // stars
    const a = nn[9];
    this.starMat.opacity = a;
    this.stars.visible = a > 0.01;
    if (this.stars.visible) {
      this.stars.position.copy(cp);
      this.stars.scale.setScalar(this._domeR * 0.97);
    }
    const au = nn[17], at = Date.now() * 0.001;
    this.auroraMat.opacity = au * (0.8 + 0.2 * Math.sin(at * 0.9));
    this.aurora.visible = au > 0.02;
    if (this.aurora.visible) {
      this.aurora.position.copy(cp);
      this.aurora.scale.set(this._domeR * 0.97, this._domeR * 0.97 * (1 + 0.15 * Math.sin(at * 0.5)), this._domeR * 0.97);
      this.aurora.rotation.y = 0.12 * Math.sin(at * 0.08);
    }
  }

  _pulse(beat) {
    let p = 0, d = 0;
    if (beat && typeof beat.phase === 'number') {
      const ph = clamp(beat.phase, 0, 1);
      p = Math.exp(-ph * 5.5);
      const bi = Math.floor(beat.beat || 0);
      d = p * ((bi & 3) === 0 ? 1 : 0.5);
    }
    this._pulseP = p; this._pulseD = d;
  }

  // ------------------------------------------------------------------------------------------
  // public
  // ------------------------------------------------------------------------------------------
  update(dt, camera, ball, beat) {
    if (this._rdC && (Math.abs(this._rdKT - this._rdK) > 0.001 || this._rdC.getHex() !== this._rdT.getHex())) {
      const e = Math.min(1, dt * 0.6);
      this._rdC.lerp(this._rdT, e); this._rdK += (this._rdKT - this._rdK) * e; this._lookDirty = true;
    }
    if (this._disposed) return;
    dt = dt > 0.1 ? 0.1 : dt < 0 || dt !== dt ? 0 : dt;
    this.time += dt;
    let s = ball && ball.s > 0 ? ball.s : 0;
    this._sNow = s;
    camera.getWorldPosition(this._cp);
    if (this._ovrVer !== OVR_VER) { this._ovrVer = OVR_VER; if (this._inited) this.reset(); } // campaign biome lock changed
    const cp = this._cp;
    this._frontier = Math.floor((s + AHEAD) / CH) * CH; // last generated chunk ends here (<= s + AHEAD)
    if (this._frontier < s + 60) this._frontier = s + 60;

    // path under the ball, heading
    this._ensureSamples(s - 52, s + 305); // the path we know about: everything the camera could ever see
    this.track.frame(s, this._bf);
    const bf = this._bf;
    let fx = bf.tan.x, fz = bf.tan.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    this._fx = fx; this._fz = fz;
    const hd = Math.atan2(fx, -fz);
    if (!this._inited) this._head = hd;
    else this._head += wrapPi(hd - this._head) * (1 - Math.exp(-dt / 2.5));

    // dome size follows the camera far plane
    const far = camera.far > 0 ? camera.far : 1000;
    this._domeR = clamp(far * 0.88, 150, 900);

    // biome / look blend
    const bi = biomeIdx(s);
    // the look (sky / fog / lights) starts blending 60 m BEFORE the portal and finishes 60 m after it: a ~120 m distance-based fade, never a time snap
    const bl = OVR >= 0 ? bi : biomeIdx(s + 60);
    if (bl !== this.bIdx) this._enterBiome(bl, !this._inited);
    if (this._blendT < 1) {
      const ds = this._lastS === undefined ? 0 : Math.max(0, s - this._lastS);
      this._blendT = Math.min(1, this._blendT + Math.min(ds, 20) / 120);
      this._mixLook();
    }
    this._lastS = s;
    if (this._lookDirty) this._applyLook();

    // fog = the biome's look (blended across portals) x the blizzard modifier (eased) x the runner's pressure; written every frame
    // (so a portal never snaps it back) and never closer than ~2 s of running: far >= max(70, 2 * ballVs)
    this._fm += (this._fmT - this._fm) * Math.min(1, dt * 1.5);
    this._fmWas = this._fm > 0.001;
    const fp = this.fogPress > 0 ? (this.fogPress < 1 ? this.fogPress : 1) : 0, fmk = 1 - 0.6 * this._fm, fmf = 1 - 0.45 * this._fm;
    this.fog.near = this.nCur[0] * 1.6 * fmk * (1 - 0.85 * fp);
    this.fog.far = Math.max(70, 2 * (this.ballVs > 0 ? this.ballVs : 0), this.nCur[1] * 1.3 * fmf * (1 - 0.8 * fp));
    if (this.fog.near > this.fog.far - 20) this.fog.near = this.fog.far - 20;
    // follow the camera
    this.sky.position.copy(cp);
    this.sky.scale.setScalar(this._domeR);

    this._updateChunks(s);
    this._fixDirty();
    if (this._inited && this._warm.length) this._type(this._warm.shift());
    this._inited = true;
    this._updateGround(cp, s, bi);
    this._updateClouds(dt);
    this._updateParticles(dt, cp);
    this._updateCelestial(cp);

    // beat pulses (cheap scalar uniforms only)
    this._pulse(beat);
    const p = this._pulseP, d = this._pulseD, nn = this.nCur;
    this.skyMat.color.setScalar(1 + nn[10] * d);
    this.hemi.intensity = nn[2] * (1 + 0.03 * p);
    this.sunL.intensity = nn[3] * (1 + 0.05 * d);
    this.matGlow.color.setScalar(nn[14] + nn[11] * d);
    this.gridMat.color.setScalar(0.55 + nn[12] * d);
    this.partMat.size = this._pSize * (1 + nn[13] * p * 0.7);
    this.matLit.emissive.setRGB(nn[15] * d, nn[15] * d * 0.25, 0);
    this.matFlank.emissive.copy(this.matLit.emissive);
    if (this._wfTex) this._wfTex.offset.y = (this._wfTex.offset.y + dt * 0.8) % 1; // waterfalls pour

    // For the first frames show every optional program (neon grid, stars, glow decor) as invisible-but-drawn, so the
    // renderer compiles + uploads them now rather than as a hitch when the neon biome first appears.
    if (this._shaderWarm > 0) {
      this._shaderWarm--;
      const G = this._glowT;
      if (this._shaderWarm > 0) {
        if (this._gridOK) this.grid.visible = true;
        this.stars.visible = true; this.aurora.visible = true;
        G.mesh.visible = true; G.mesh.count = Math.max(1, G.count);
      } else {
        G.mesh.count = G.count; G.mesh.visible = G.count > 0;
      }
    }
  }

  /** Throw everything away and rebuild around the next update() (e.g. after a restart/continue jump). */
  reset() {
    this._clearChunks();
    this._cloudsInit = false;
    this._inited = false;
    this.bIdx = -1;
    this._stag.fill(-1);
    this._ovDirty = false;
    this._iBase = Infinity;
    for (const b of this._bnd) b.k = -1;
    this._pInit = false;
  }

  /** Debug / test helper: what the renderer will draw for this module. */
  stats() {
    let drawCalls = 0, triangles = 0, instances = 0;
    this.group.traverseVisible((o) => {
      if (o.isInstancedMesh) {
        if (o.count > 0) { drawCalls++; instances += o.count; triangles += o.count * (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
      } else if (o.isMesh) {
        drawCalls++;
        const g = o.geometry;
        triangles += (g.index ? g.index.count : Math.min(g.attributes.position.count, g.drawRange.count)) / 3;
      } else if (o.isPoints) drawCalls++;
    });
    return { drawCalls, triangles, instances };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    setLookActive(false);
    this.scene.remove(this.group);
    const geos = new Set();
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) geos.add(o.geometry);
    });
    for (const T of this._types) {
      if (T.owned) T.geo.dispose();
      geos.delete(T.geo);
    }
    for (const g of geos) g.dispose();
    for (const m of [this.matLit, this.matFlank, this.matGlow, this.cloudMat, this.skyMat, this.discMat, this.starMat, this.groundMat, this.gridMat, this.partMat, this.matWall, this.matWater, this.matIce]) m.dispose();
    for (const t of [this._sunTexA, this._sunTexB, this._sunTexC, this._dotTex, this._gridTex, this._wfTex]) if (t) t.dispose();
    if (this._ownLib && this.lib) for (const k in this.lib) this.lib[k].geometry.dispose();
    this.hemi.dispose && this.hemi.dispose();
    this.sunL.dispose && this.sunL.dispose();
    this.lib = null;
    this._chunks.length = 0;
    // give the scene back what we found
    const sv = this._saved;
    if (sv.fogColor && sv.fogRef) { sv.fogRef.color.copy(sv.fogColor); sv.fogRef.near = sv.near; sv.fogRef.far = sv.far; this.scene.fog = sv.fogRef; }
    else if (this.scene.fog === this.fog) this.scene.fog = sv.fogRef || null;
    if (sv.bgColor && sv.bgRef) { sv.bgRef.copy(sv.bgColor); this.scene.background = sv.bgRef; }
    else if (this.scene.background === this.bg) this.scene.background = sv.bgRef || null;
  }
}

// ---------------------------------------------------------------------------------------------
function makeLook(b) {
  const g = b.grade;
  const c = [b.sky.top, b.sky.mid, b.sky.horizon, b.fog.color, b.hemi.sky, b.hemi.ground, b.sun.color, b.disc.color, b.clouds].map((h) => new THREE.Color(h));
  c.push(new THREE.Color().setRGB(g.sh[0], g.sh[1], g.sh[2]), new THREE.Color().setRGB(g.hi[0], g.hi[1], g.hi[2]), new THREE.Color(g.rimC)); // (tints are raw multipliers, not sRGB colours)
  const n = new Float32Array(NN);
  n[0] = b.fog.near; n[1] = b.fog.far;
  n[2] = b.hemi.intensity; n[3] = b.sun.intensity;
  n[4] = b.sun.az; n[5] = b.sun.el;
  n[6] = b.disc.az; n[7] = b.disc.el; n[8] = b.disc.size;
  n[9] = b.stars;
  n[10] = b.pulse.sky; n[11] = b.pulse.glow; n[12] = b.pulse.grid; n[13] = b.pulse.spark;
  n[14] = b.glowBase; n[15] = b.pulse.lava;
  n[16] = b.cloudAmt === undefined ? 1 : b.cloudAmt;
  n[17] = b.aurora || 0;
  n[18] = g.sat; n[19] = g.con; n[20] = g.vig; n[21] = g.rim;
  return { c, n };
}
