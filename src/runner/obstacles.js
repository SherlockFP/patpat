// obstacles.js — lane-based downhill hazards, pickups and pads for the endless mode.
//
// Events emitted by collide(): hit, knock, ice, melt, push {du}, pad {kind boost|jump|spring, onBeat, power}, portal {biome},
// pickup {kind flake|snow|gate|crystal|box|letter|magnet|x2|superjump|rocket|helmet}, grind {active, done, s0, s1, u, h},
// zip {s0,s1,u,h}, loop {minSpeed,s0,s1,R}, valley {depth, ok=first frame}, slowmo {s0,s1,scale}, crack {s,u}.
// More events: warn {kind:'oncoming'|'boulder'|'missile', lane, t}, wind {du}, fog {density}, near {toughness, side}, over {toughness},
// finish. Every event carries e.ball = ball.id ('main' by default): collide() may be called several times per frame (main + clone):
// each ball id has its own once-per-obstacle hit / near / over memory; clone hits never auto-resolve; clones only collide with
// hazards and collect flakes + snow (not power-ups, pads or triggers).
// APIs: setZone(kind, {from, until}), setHardness(k), setPowerupWeights(map), throwBoulder(lane, s), platformAt(s, u), reset(), resolve(id, smashed).
// Critters (src/runner/critters.js, owned by this class): collide() also emits { type:'critter', id, stomp, x, kind } (stomp = ball moving down with its bottom above
// 45% of the critter's height); the runner answers with killCritter(id) (squash + poof). Pickup kind 'gem' = the rare 💎. clearRange(s0, s1) removes critters too.
// Constructor opts: { seed, jumpPadV } (jumpPadV = runner RCFG.jumpPadV, used to size spring / jump-pad coin arcs).
// Row spawning (_rows): random weighted patterns + authored multi-row PHRASES + a 600 m layer rhythm (tensionK: calm / steady / intense, breather on
// the boundary). track.features.tension / .phrases = false switch them off; campaign levels run without the rhythm and take phrases only with features.phrases = true.
//
// Everything lives in track-local coordinates (s, u, h). ball.h is the height of the ball BOTTOM above the
// surface plane, exactly like the runner (resting on flat snow: h = 0); internally centre = h + r. Lanes are u = LANES (from track.js).
// Moving/beat obstacles are pure functions of beat.beat. One InstancedMesh per primitive with fixed
// capacities (18 draw calls in total). No per-frame allocations (events come from a reusable pool).

import * as THREE from 'three';
import { makeRng } from '../rng.js';
import { LANES, LANE_W, setLanes, laneOf, hwFor } from './track.js';
import { Critters } from './critters.js';
import { gustAt } from './goals.js';
import { nearFade } from './nearfade.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _c = new THREE.Color();
const FR = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
const DEFAULT_PAL = { tileA: 0xe8f1fb, tileB: 0xc9d9ee, edge: 0x7fb4e8, rail: 0x4a6a92, glow: 0xffd24a, under: 0x3a4f70 };
export { LANES, LANE_W };

export const COL = {
  wood: 0xb07a42, wood2: 0x8f5f32, ice: 0x3fb4f5, melt: 0xff7a1a, flake: 0xffffff, snow: 0xffffff, pile: 0x6cc8ff,
  rock: 0x8a93a0, pine: 0x2f7d4a, dark: 0x2a2f3d, red: 0xd9482f, orange: 0xe8742a, cabin: 0xa5693a,
};

// ---------------------------------------------------------------------------
// Event pool (reused plain objects)
// ---------------------------------------------------------------------------
const EVN = 192, EVP = [];
for (let i = 0; i < EVN; i++) EVP.push({ type: '', ds: 0, du: 0, dh: 0, strength: 0, kind: '', value: 0, s: 0, u: 0, h: 0, onBeat: false, power: 0, color: 0, size: 0, ok: false, rate: 0, biome: 0, toughness: 0, headOn: false, id: 0, letter: '', active: false, s0: 0, s1: 0, minSpeed: 0, scale: 0, depth: 0, R: 0, done: false, lane: 0, t: 0, density: 0, ok: false, side: 0, ball: 'main', stomp: false, x: 0, halfW: 0, ride: false, ht: 0, nonLethal: false, gc: 0, gapHalf: 0, boulder: false });
let evi = 0;
let CUR_ID = 'main';       // id of the ball currently being collided (events carry it as e.ball)
export function ev(events, type) {
  const e = EVP[evi]; evi = (evi + 1) % EVN;
  e.type = type; e.ds = 0; e.du = 0; e.dh = 0; e.strength = 0; e.kind = ''; e.value = 0; e.s = 0; e.u = 0; e.h = 0;
  e.onBeat = false; e.power = 0; e.color = 0; e.size = 0; e.ok = false; e.rate = 0; e.biome = 0; e.toughness = 0; e.headOn = false; e.id = 0; e.letter = '';
  e.active = false; e.s0 = 0; e.s1 = 0; e.minSpeed = 0; e.scale = 0; e.depth = 0; e.R = 0; e.done = false; e.lane = 0; e.t = 0; e.density = 0; e.ok = false; e.side = 0; e.ball = CUR_ID;
  e.stomp = false; e.x = 0; e.halfW = 0; e.ride = false; e.ht = 0; e.nonLethal = false; e.gc = 0; e.gapHalf = 0; e.boulder = false;
  events.push(e);
  return e;
}

// ---------------------------------------------------------------------------
// Geometry. Vertex colours = part colour (or white for instance-tinted pools) * mild face shade.
// ---------------------------------------------------------------------------
function merge(parts, shaded) {
  const pos = [], col = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const [geo, hex, x, y, z, rx, ry, rz, sx, sy, sz] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    q.setFromEuler(e.set(rx || 0, ry || 0, rz || 0));
    m.compose(p.set(x || 0, y || 0, z || 0), q, sc.set(sx || 1, sy || 1, sz || 1));
    g.applyMatrix4(m);
    const a = g.attributes.position.array;
    if (hex == null) _c.setRGB(1, 1, 1); else _c.setHex(hex);
    for (let i = 0; i < a.length; i += 3) { pos.push(a[i], a[i + 1], a[i + 2]); col.push(_c.r, _c.g, _c.b); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  out.computeVertexNormals();
  if (shaded) {
    const n = out.attributes.normal, c = out.attributes.color;
    for (let i = 0; i < n.count; i++) {
      const k = 0.74 + 0.26 * (n.getY(i) * 0.5 + 0.5);
      c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
    }
  }
  return out;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'], J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};
const FONT_TR = { 'Ç': ['C', null, '00100'], 'Ğ': ['G', '01110', null], 'İ': ['I', '00100', null], 'Ö': ['O', '01010', null], 'Ş': ['S', null, '00100'], 'Ü': ['U', '01010', null] };

/** Blocky 3D letter (voxels, gold face + darker back layer), ~1.5 m wide, centred. */
function letterGeometry(ch) {
  let rows = FONT[ch], above = null, below = null;
  if (!rows && FONT_TR[ch]) { const t = FONT_TR[ch]; rows = FONT[t[0]]; above = t[1]; below = t[2]; }
  if (!rows) rows = ['11111', '10001', '10001', '10001', '10001', '10001', '11111'];
  const all = [];
  if (above) all.push([above, -1]);
  rows.forEach((r, i) => all.push([r, i]));
  if (below) all.push([below, 7]);
  const cell = 0.3, parts = [], box = B(cell, cell, 0.5);
  for (const [r, ri] of all) for (let c = 0; c < 5; c++) {
    if (r[c] !== '1') continue;
    const x = (c - 2) * cell, y = (3 - ri) * cell;
    parts.push([box, 0xffd23a, x, y, 0.12, 0, 0, 0, 1, 1, 1]);
    parts.push([box, 0xd9822b, x, y, -0.18, 0, 0, 0, 1.12, 1.12, 0.5]);
  }
  return merge(parts, false);
}


// Faceted low-poly rock: flat base at y = 0, widest radius ~0.5, top at y = 1 (scale it to the real size). Shading is baked in grey
// (lighter on the upward facets), the hue comes from the instance colour. userData.fr = footprint radius of the unit shape (hit radius = fr * width).
function rockGeometry(seed, detail, squash, jitterAmt, cut) {
  const g = new THREE.IcosahedronGeometry(0.5, detail);
  const p = g.attributes.position, hv = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.3) * 43758.5453; return v - Math.floor(v); };
  const cutY = -0.5 * squash * cut;
  let ymax = -1e9;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + jitterAmt * (hv(Math.round(x * 997), Math.round(y * 991), Math.round(z * 983)) * 2 - 1);
    x *= k; z *= k; y = y * k * squash;
    if (y < cutY) y = cutY;
    y -= cutY;
    p.setXYZ(i, x, y, z);
    if (y > ymax) ymax = y;
  }
  let fr = 0, nfr = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / ymax;
    p.setY(i, y);
    if (y > 0.12 && y < 0.8) { fr += Math.hypot(p.getX(i), p.getZ(i)); nfr++; }
  }
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i), bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1), cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nl = Math.hypot(nx, ny, nz) || 1, up = ny / nl;
    const sh = 0.55 + 0.45 * clamp(up * 0.85 + 0.25, 0, 1) + (hv(Math.round(ax * 300), Math.round(by * 300), Math.round(cz * 300)) - 0.5) * 0.14;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = sh; col[(i + k) * 3 + 1] = sh; col[(i + k) * 3 + 2] = sh; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.userData.fr = nfr ? (fr / nfr) * 0.96 : 0.5;
  return g;
}

/** Octahedron gem (unlit: the facet shading is baked): light top facets, mid sides, dark bottom. */
function gemGeometry() {
  const g = new THREE.OctahedronGeometry(0.4, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 1.35);
  for (let i = 0; i < p.count; i += 3) {
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, up = cy > 0;
    const sh = up ? 1 : 0.55, ph = ((i / 3) & 1) ? 0.9 : 1;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = (up ? 0.55 : 0.2) * sh * ph + 0.28; col[(i + k) * 3 + 1] = (up ? 0.92 : 0.62) * sh * ph; col[(i + k) * 3 + 2] = (up ? 1.0 : 0.85) * sh * ph; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function makeGeometries() {
  const G = {};
  const cylBark = new THREE.CylinderGeometry(0.5, 0.5, 1, 12).toNonIndexed();
  {   // radial bark stripes so rolling logs are visible
    const n = G.cylCount = cylBark.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const seg = Math.floor(i / 6); const k = i < 72 ? (seg & 1 ? 0.8 : 1) : 0.68; c[3 * i] = c[3 * i + 1] = c[3 * i + 2] = k; }
    cylBark.setAttribute('color', new THREE.BufferAttribute(c, 3));
    cylBark.computeVertexNormals();
  }
  G.cyl = cylBark;
  G.box = merge([[B(1, 1, 1), null]], true);
  G.ball = merge([[new THREE.IcosahedronGeometry(0.5, 1), null]], true);
  G.torus = merge([[new THREE.TorusGeometry(1, 0.1, 8, 32), null]], false);
  G.hex = merge([[new THREE.CylinderGeometry(0.5, 0.5, 0.1, 6), null]], false);
  // snowflake pickup: an upright coin (spins about its up axis, face towards the camera) = amber rim, warm gold face, thick white
  // six-arm star on both faces. Baked colours (the instance colour is white): the old thin pale-blue flat cross vanished on the blue lane.
  const arm = B(0.82, 0.14, 0.12), faceZ = [0.1, -0.1];
  G.flake = merge([
    [new THREE.TorusGeometry(0.4, 0.07, 6, 14), 0xf08a14],
    [new THREE.CylinderGeometry(0.4, 0.4, 0.16, 14), 0xffd24a, 0, 0, 0, PI / 2, 0, 0],
  ].concat(...faceZ.map((z) => [0, 1, 2].map((i) => [arm, 0xffffff, 0, 0, z, 0, 0, i * PI / 3]).concat([[new THREE.CylinderGeometry(0.15, 0.15, 0.08, 6), 0xffffff, 0, 0, z, PI / 2, 0, 0]]))), false);
  // pine: trunk + 3 cones + snow tip
  G.pine = merge([
    [new THREE.CylinderGeometry(0.16, 0.22, 1.0, 6), 0x6b4a2b, 0, 0.5, 0],
    [new THREE.ConeGeometry(1.25, 1.5, 7), 0x2f7d4a, 0, 1.6, 0], [new THREE.ConeGeometry(0.98, 1.35, 7), 0x2a7242, 0, 2.55, 0],
    [new THREE.ConeGeometry(0.7, 1.2, 7), 0x256a3b, 0, 3.45, 0], [new THREE.ConeGeometry(0.34, 0.55, 7), 0xffffff, 0, 4.25, 0],
  ], true);
  // plow blade: long bar with hazard stripes along its length
  {
    const g = new THREE.BoxGeometry(1, 1, 1, 8, 1, 1).toNonIndexed();
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, seg = Math.floor((cx + 0.5) * 8);
      const yel = seg & 1;
      for (let k = 0; k < 3; k++) { const o = 3 * (i + k); c[o] = yel ? 1 : 0.12; c[o + 1] = yel ? 0.78 : 0.12; c[o + 2] = yel ? 0.1 : 0.14; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    G.plow = g;
  }
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = PI / 2 + (i * PI) / 5, r = i & 1 ? 0.22 : 0.5; (i ? star.lineTo : star.moveTo).call(star, Math.cos(a) * r, Math.sin(a) * r); }
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.18, bevelEnabled: false });
  sg.translate(0, 0, -0.09);
  G.star = merge([[sg, 0xffd23a]], false);
  const ch = new THREE.Shape();
  [[0, 0.3], [0.5, -0.1], [0.5, -0.3], [0, 0.1], [-0.5, -0.3], [-0.5, -0.1]].forEach((p, i) => (i ? ch.lineTo(p[0], p[1]) : ch.moveTo(p[0], p[1])));
  const cg = new THREE.ExtrudeGeometry(ch, { depth: 0.05, bevelEnabled: false });
  cg.rotateX(-PI / 2);
  G.chev = merge([[cg, null]], false);
  // power-up icons (unlit, baked colours)
  G.magnet = merge([[new THREE.TorusGeometry(0.28, 0.1, 8, 14, PI), 0xd83030, 0, 0.1, 0], [B(0.2, 0.2, 0.2), 0xdddddd, -0.28, -0.0, 0], [B(0.2, 0.2, 0.2), 0xdddddd, 0.28, 0, 0]], false);
  G.helmet = merge([[new THREE.SphereGeometry(0.4, 10, 6, 0, TAU, 0, PI / 2), 0xd83030, 0, 0, 0], [new THREE.CylinderGeometry(0.4, 0.4, 0.05, 10), 0xffffff, 0, 0, 0],
    [B(0.12, 0.42, 0.82), 0xffffff, 0, 0.12, 0], [B(0.5, 0.14, 0.3), 0x2a2f3d, 0, 0.16, 0.34]], false);
  G.rocket = merge([[new THREE.CylinderGeometry(0.14, 0.14, 0.6, 8), 0xffffff, 0, 0, 0], [new THREE.ConeGeometry(0.14, 0.3, 8), 0xd83030, 0, 0.45, 0],
    [B(0.04, 0.24, 0.24), 0xd83030, 0.16, -0.28, 0], [B(0.04, 0.24, 0.24), 0xd83030, -0.16, -0.28, 0], [B(0.24, 0.24, 0.04), 0xd83030, 0, -0.28, 0.16],
    [new THREE.ConeGeometry(0.1, 0.34, 8), 0xffc23a, 0, -0.5, 0, PI, 0, 0]], false);
  G.spring = merge([0, 1, 2].map((i) => [new THREE.TorusGeometry(0.26, 0.07, 6, 12), 0x3ad86a, 0, -0.22 + i * 0.22, 0, PI / 2, 0, 0]).concat([[new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12), 0xffffff, 0, -0.34, 0]]), false);
  G.crystal = merge([[new THREE.OctahedronGeometry(0.38, 0), 0x6df0ff, 0, 0, 0, 0, 0, 0, 0.85, 1.35, 0.85]], false);
  G.gift = merge([[B(0.6, 0.6, 0.6), 0xc23ad8], [B(0.64, 0.14, 0.64), 0xffd23a], [B(0.14, 0.64, 0.64), 0xffd23a], [B(0.64, 0.64, 0.14), 0xffd23a],
    [B(0.2, 0.2, 0.2), 0xffd23a, 0, 0.4, 0]], false);
  G.letter = letterGeometry('A');
  G.scarf = merge([0, 1, 2, 3, 4].map((i) => [B(0.2, 0.34, 0.5), i % 2 ? 0xffffff : 0xd9302f, -0.4 + i * 0.2, 0.1, 0]).concat([[B(0.14, 0.5, 0.08), 0xd9302f, 0.3, -0.25, 0.2], [B(0.14, 0.5, 0.08), 0xffffff, 0.46, -0.3, 0.2], [B(0.16, 0.06, 0.1), 0x2a7ad8, 0.3, -0.5, 0.2], [B(0.16, 0.06, 0.1), 0x2a7ad8, 0.46, -0.55, 0.2]]), false);
  G.beamBox = merge([[B(1, 1, 1), null]], false);
  G.timewarp = merge([[new THREE.ConeGeometry(0.3, 0.38, 8), 0x6ad8ff, 0, 0.19, 0, PI, 0, 0], [new THREE.ConeGeometry(0.3, 0.38, 8), 0xffd23a, 0, -0.19, 0],
    [B(0.8, 0.09, 0.8), 0xb07a42, 0, 0.45, 0], [B(0.8, 0.09, 0.8), 0xb07a42, 0, -0.45, 0], [B(0.07, 0.9, 0.07), 0xdddddd, 0.36, 0, 0.36], [B(0.07, 0.9, 0.07), 0xdddddd, -0.36, 0, -0.36]], false);
  G.ghost = merge([[new THREE.SphereGeometry(0.36, 10, 8), 0xeaf4ff, 0, 0.12, 0], [new THREE.CylinderGeometry(0.36, 0.36, 0.42, 10), 0xeaf4ff, 0, -0.08, 0],
    [new THREE.ConeGeometry(0.12, 0.2, 6), 0xeaf4ff, -0.24, -0.38, 0, PI, 0, 0], [new THREE.ConeGeometry(0.12, 0.2, 6), 0xeaf4ff, 0, -0.38, 0, PI, 0, 0], [new THREE.ConeGeometry(0.12, 0.2, 6), 0xeaf4ff, 0.24, -0.38, 0, PI, 0, 0],
    [B(0.1, 0.16, 0.06), 0x1a1f2e, -0.13, 0.16, 0.34], [B(0.1, 0.16, 0.06), 0x1a1f2e, 0.13, 0.16, 0.34]], false);
  G.risk = merge([[B(0.62, 0.62, 0.62), 0xf3f3f3, 0, 0, 0, 0.5, 0.6, 0.0], [B(0.1, 0.1, 0.05), 0xd9302f, 0, 0.18, 0.33, 0.5, 0.6, 0], [B(0.1, 0.1, 0.05), 0xd9302f, -0.15, 0.04, 0.33, 0.5, 0.6, 0],
    [B(0.1, 0.1, 0.05), 0xd9302f, 0.15, 0.04, 0.33, 0.5, 0.6, 0], [B(0.05, 0.1, 0.1), 0x1a1f2e, 0.33, 0.1, 0.1, 0.5, 0.6, 0], [B(0.05, 0.1, 0.1), 0x1a1f2e, 0.33, -0.1, -0.1, 0.5, 0.6, 0]], false);
  G.clone = merge([[new THREE.IcosahedronGeometry(0.3, 1), 0xffffff, -0.22, 0.08, 0], [new THREE.IcosahedronGeometry(0.3, 1), 0x8fd0ff, 0.22, -0.08, 0]], false);
  G.disc = merge([[new THREE.CylinderGeometry(0.5, 0.5, 0.05, 22), null]], false);
  {   // ramp wedge: low edge at local +z (behind), high edge at -z (ahead), unit box
    const A = [-0.5, -0.5, 0.5], Bp = [0.5, -0.5, 0.5], C = [0.5, -0.5, -0.5], D = [-0.5, -0.5, -0.5], E = [-0.5, 0.5, -0.5], F = [0.5, 0.5, -0.5];
    const tris = [[A, Bp, C], [A, C, D], [A, Bp, F], [A, F, E], [D, C, F], [D, F, E], [A, D, E], [Bp, F, C]];
    const cen = [0, -0.1667, -0.1667], pos = [], col = [];
    for (let [a, b, c] of tris) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (a[0] + b[0] + c[0]) / 3 - cen[0], my = (a[1] + b[1] + c[1]) / 3 - cen[1], mz = (a[2] + b[2] + c[2]) / 3 - cen[2];
      if (nx * mx + ny * my + nz * mz < 0) { const q = b; b = c; c = q; }
      const l = Math.hypot(nx, ny, nz) || 1, k = 0.74 + 0.26 * ((Math.abs(ny / l) * Math.sign(ny * (nx * mx + ny * my + nz * mz)) ) * 0.5 + 0.5);
      for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(k, k, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    G.wedge = g;
  }
  G.rockS = rockGeometry(1, 0, 0.7, 0.2, 0.5);        // small rock: low, wide
  G.rockS2 = rockGeometry(7, 0, 0.62, 0.24, 0.5);
  G.rockB = rockGeometry(3, 1, 1.5, 0.16, 0.38);      // big boulder: tall faceted rock
  G.rockB2 = rockGeometry(11, 1, 1.3, 0.2, 0.4);
  G.cone = merge([[new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0), null]], true);
  G.dome = merge([[new THREE.SphereGeometry(0.5, 12, 6, 0, TAU, 0, PI / 2), null]], true);
  G.cactus = merge([
    [new THREE.CylinderGeometry(0.3, 0.34, 2.5, 8), 0x3f9a4a, 0, 1.25, 0], [new THREE.SphereGeometry(0.31, 8, 6), 0x4fae56, 0, 2.5, 0],
    [new THREE.CylinderGeometry(0.16, 0.16, 0.42, 6), 0x3f9a4a, 0.4, 1.15, 0, 0, 0, PI / 2], [new THREE.CylinderGeometry(0.16, 0.16, 0.75, 6), 0x4fae56, 0.58, 1.5, 0], [new THREE.SphereGeometry(0.17, 6, 5), 0x5fbd62, 0.58, 1.88, 0],
    [new THREE.CylinderGeometry(0.15, 0.15, 0.4, 6), 0x3f9a4a, -0.38, 1.6, 0, 0, 0, PI / 2], [new THREE.CylinderGeometry(0.15, 0.15, 0.6, 6), 0x4fae56, -0.55, 1.88, 0], [new THREE.SphereGeometry(0.16, 6, 5), 0x5fbd62, -0.55, 2.18, 0],
  ], true);
  G.gem = gemGeometry();
  return G;
}

// pool: key -> [geometry key, material key, capacity]
const POOLS = {
  box: ['box', 'lit', 1500], cyl: ['cyl', 'lit', 320], ball: ['ball', 'lit', 520], pine: ['pine', 'lit', 70], plow: ['plow', 'lit', 24],
  rockS: ['rockS', 'lit', 70], rockS2: ['rockS2', 'lit', 70], rockB: ['rockB', 'lit', 40], rockB2: ['rockB2', 'lit', 40], cone: ['cone', 'lit', 140], dome: ['dome', 'lit', 60], cactus: ['cactus', 'lit', 50],
  gem: ['gem', 'glow', 24], shadow: ['disc', 'shadow', 260],
  ice: ['box', 'ice', 90], wedge: ['wedge', 'lit', 40], lamp: ['ball', 'glow', 120], disc: ['disc', 'glow', 140], puff: ['ball', 'ice', 60],
  ring: ['torus', 'pulse', 90], chev: ['chev', 'pulse', 300], hex: ['hex', 'pulse', 320],
  flake: ['flake', 'glow', 560], star: ['star', 'glow', 16], magnet: ['magnet', 'glow', 12], helmet: ['helmet', 'glow', 12],
  rocket: ['rocket', 'glow', 12], spring: ['spring', 'glow', 12], crystal: ['crystal', 'glow', 12], gift: ['gift', 'glow', 12], letter: ['letter', 'glow', 6], scarf: ['scarf', 'glow', 14],
  timewarp: ['timewarp', 'glow', 12], ghost: ['ghost', 'glow', 12], risk: ['risk', 'glow', 12], clone: ['clone', 'glow', 12],
  beam: ['beamBox', 'glow', 220],
};
// pickup kind -> pool
const PICK_POOL = { flake: 'flake', snow: 'ball', x2: 'star', gem: 'gem', crystal: 'crystal', box: 'gift', letter: 'letter', scarf: 'scarf', magnet: 'magnet', helmet: 'helmet', rocket: 'rocket', superjump: 'spring', timewarp: 'timewarp', ghost: 'ghost', risk: 'risk', clone: 'clone', cannon: 'rocket', bait: 'gem', bread: 'gem' };

export function pulseOf(phase) {
  const p = phase > 0.5 ? phase - 1 : phase, a = 1 - Math.abs(p) / 0.3;
  return a > 0 ? a * a : 0;
}

export const KIND = {};
// obstacle kinds a clone / ghost ball also collides with (the rest are triggers for the main ball only)
const CLONE_OK = { static: 1, moving: 1, plow: 1, swing: 1, overhead: 1, slidewall: 1, oncoming: 1, laser: 1, missile: 1, ice: 1, melt: 1, conveyor: 1, wind: 1 };   // obstacle kinds (filled in part 2)

export class Obstacles {
  constructor(scene, track, opts = {}) {
    this.scene = scene;
    this.track = track;
    this.seed = (opts.seed ?? 1) >>> 0;
    this.group = new THREE.Group();
    this.group.name = 'obstacles';
    if (scene && scene.add) scene.add(this.group);
    this.G = makeGeometries();
    this.mats = {
      lit: nearFade(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })),
      ice: nearFade(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.82, depthWrite: false })),
      pulse: nearFade(new THREE.MeshBasicMaterial({ vertexColors: true })),
      glow: nearFade(new THREE.MeshBasicMaterial({ vertexColors: true })),
      shadow: new THREE.MeshBasicMaterial({ color: 0x1d3a66, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
    this.pool = {};
    for (const k in POOLS) this._mkPool(k, POOLS[k]);
    this.obs = [];          // obstacles sorted by s (centre)
    this.picks = [];        // pickups sorted by s
    this.pending = [];      // hit obstacles awaiting resolve()
    this.byId = new Map();
    this._id = 1;
    this.maxExt = 4.6;      // largest half-length of any live obstacle (grows with trains)
    this.beatF = 0; this.phase = 0; this.bpm = 100; this.time = 0; this.pulse = 0;
    this.lastS = 0;
    this.nextLetter = null;
    this.jumpPadV = opts.jumpPadV ?? 11;     // runner RCFG.jumpPadV: spring / jump pad coin arcs are sized with it
    this.ballVs = 10; this.gateChain = 0;
    this.platforms = [];       // rideable obstacles (train roofs + ramps): platformAt(s, u)
    this.dyn = [];             // moving objects not tied to a piece: boulders
    this.dynById = new Map();
    this.warnQ = [];           // warn events queued by update(), flushed by the next collide()
    this.rowsLog = [];         // {s, ext, free} of every row (used to keep boulders from trapping the player)
    this._hk = null;           // explicit hardness override (else track.hardness)
    this.nextBoulder = 1e9;
    this.powerW = { cannon: 1, magnet: 1, x2: 1, superjump: 1, rocket: 1, helmet: 1, timewarp: 1, ghost: 1, risk: 1, clone: 1 };
    this._cid = 'main';
    this.rng = makeRng((this.seed ^ 0xa5a5a5a5) >>> 0);
    this.next = { power: 260, gem: 520, box: 340, letter: 300, scarf: 140, chain: 420, yeti: 330, plow: 1000, tunnel: 900, slide: 380 };   // distance accumulators for rare pickups
    this.tutorial = !!opts.tutorial;
    this.endless = opts.endless ?? !track.level;
    this.scarves = opts.scarves ?? false;       // season hunt: scarf tokens (endless runs only)
    this.boxes = !!opts.boxes;                  // surprise boxes / letters on the track (off: the endless run credits rewards silently)
    this.snowK = opts.snowK ?? 1;               // multiplier of the snow supply (tiers / s of snow on offer, see _trails)
    this._snowOwed = 0;                         // snow piles still owed to the player (supply accumulator)
    this._clock = 0;                            // ROW CLOCK: s of the next row, carried across pieces
    this._nextCrit = 160;                       // s of the next critter group
    this._teach = 0;                            // next scripted teaching row
    this._breath = null;                        // { a, b } the breather of the tension cycle
    this._gateS = -1;                           // start of the last chapter that got its gate (goals.js chapters)
    this.tierBias = 0;
    this.critters = new Critters(this.group, track, { seed: this.seed, ev });
    this._tmpHit = { ds: 0, du: 0 };
    this._cb = { s: 0, u: 0, h: 0, r: 0, size: 1, vs: 0, vu: 0, vh: 0 };   // centre-based copy of the ball used by all hit tests
    this.deb = [];
    for (let i = 0; i < 80; i++) this.deb.push({ on: false, idx: -1, f: null, s0: 0, s: 0, u: 0, h: 0, vs: 0, vu: 0, vh: 0, a: 0, va: 0, life: 0, size: 0 });
    this.stats = { spawned: 0, byKind: {}, droppedParts: 0 };
  }

  // ---------- instance pools ----------
  _mkPool(key, [gk, mk, cap]) {
    const m = new THREE.InstancedMesh(this.G[gk], this.mats[mk], cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.frustumCulled = false; m.count = 0; m.name = 'obs-' + key;
    const a = m.instanceMatrix.array;
    for (let i = 0; i < cap; i++) { a[i * 16] = a[i * 16 + 5] = a[i * 16 + 10] = 0; a[i * 16 + 15] = 1; }
    this.group.add(m);
    this.pool[key] = { m, free: [], hi: 0, cap, dirty: true, cdirty: true };
  }
  _alloc(key) {
    const p = this.pool[key];
    let i;
    if (p.free.length) i = p.free.pop();
    else if (p.hi < p.cap) i = p.hi++;
    else { this.stats.droppedParts++; return -1; }
    p.m.count = p.hi;
    return i;
  }
  _release(key, i) {
    if (i < 0) return;
    const p = this.pool[key], a = p.m.instanceMatrix.array, o = i * 16;
    for (let k = 0; k < 16; k++) a[o + k] = 0;
    a[o + 15] = 1;
    p.dirty = true; p.free.push(i);
  }
  _col(key, i, hex, k = 1) {
    if (i < 0) return;
    const p = this.pool[key], a = p.m.instanceColor.array;
    _c.setHex(hex);
    a[i * 3] = _c.r * k; a[i * 3 + 1] = _c.g * k; a[i * 3 + 2] = _c.b * k;
    p.cdirty = true;
  }
  /**
   * Compose a part matrix in frame f (layout: 0-2 pos, 3 rx, 4 rz, 5-7 up, 8-10 tan, 11 ry):
   * local offset (u,h), M = Ry(yaw) Rz(roll) Ry(spin), scale, extra pre-scale offset (ox,oy,oz) in the rotated frame.
   * Local axes: x = right, y = up, z = -tan (backwards).
   */
  _set(key, i, f, u, h, yaw, roll, sx, sy, sz, ox = 0, oy = 0, oz = 0, spin = 0) {
    if (i < 0) return;
    const p = this.pool[key], a = p.m.instanceMatrix.array, o = i * 16;
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll), cs = Math.cos(spin), ss = Math.sin(spin);
    const b0x = cr * cs, b0y = sr * cs, b0z = -ss, b1x = -sr, b1y = cr, b2x = cr * ss, b2y = sr * ss, b2z = cs;
    const c0x = cy * b0x + sy_ * b0z, c0y = b0y, c0z = -sy_ * b0x + cy * b0z;
    const c1x = cy * b1x, c1y = b1y, c1z = -sy_ * b1x;
    const c2x = cy * b2x + sy_ * b2z, c2y = b2y, c2z = -sy_ * b2x + cy * b2z;
    const w0x = c0x * f[3] + c0y * f[5] - c0z * f[8], w0y = c0x * f[11] + c0y * f[6] - c0z * f[9], w0z = c0x * f[4] + c0y * f[7] - c0z * f[10];
    const w1x = c1x * f[3] + c1y * f[5] - c1z * f[8], w1y = c1x * f[11] + c1y * f[6] - c1z * f[9], w1z = c1x * f[4] + c1y * f[7] - c1z * f[10];
    const w2x = c2x * f[3] + c2y * f[5] - c2z * f[8], w2y = c2x * f[11] + c2y * f[6] - c2z * f[9], w2z = c2x * f[4] + c2y * f[7] - c2z * f[10];
    a[o] = w0x * sx; a[o + 1] = w0y * sx; a[o + 2] = w0z * sx; a[o + 3] = 0;
    a[o + 4] = w1x * sy; a[o + 5] = w1y * sy; a[o + 6] = w1z * sy; a[o + 7] = 0;
    a[o + 8] = w2x * sz; a[o + 9] = w2y * sz; a[o + 10] = w2z * sz; a[o + 11] = 0;
    a[o + 12] = f[0] + f[3] * u + f[5] * h + w0x * ox + w1x * oy + w2x * oz;
    a[o + 13] = f[1] + f[11] * u + f[6] * h + w0y * ox + w1y * oy + w2y * oz;
    a[o + 14] = f[2] + f[4] * u + f[7] * h + w0z * ox + w1z * oy + w2z * oz;
    a[o + 15] = 1;
    p.dirty = true;
  }
  _frameInto(s, f) {
    this.track.frame(s, FR);
    f[0] = FR.pos.x; f[1] = FR.pos.y; f[2] = FR.pos.z; f[3] = FR.right.x; f[4] = FR.right.z;
    f[5] = FR.up.x; f[6] = FR.up.y; f[7] = FR.up.z; f[8] = FR.tan.x; f[9] = FR.tan.y; f[10] = FR.tan.z; f[11] = FR.right.y;
    return f;
  }
  _frameOf(s) { return this._frameInto(s, new Float64Array(12)); }
  _pal(s) { return Object.assign({}, DEFAULT_PAL, this.track.palette(s) || {}); }

  /** Allocate a static/animated part of an obstacle. Returns the part record. */
  _part(ob, key, hex, u, h, yaw, roll, sx, sy, sz, ox = 0, oy = 0, oz = 0, f = null, k = 1) {
    const idx = this._alloc(key);
    const part = { key, idx, f: f || ob.f, u, h, yaw, roll, sx, sy, sz, ox, oy, oz };
    if (idx >= 0) { this._col(key, idx, hex, k); this._set(key, idx, part.f, u, h, yaw, roll, sx, sy, sz, ox, oy, oz); }
    ob.parts.push(part);
    return part;
  }
  _repart(p, u, h, yaw, roll, sx, sy, sz, ox = 0, oy = 0, oz = 0, spin = 0, f = null) {
    if (p.idx >= 0) this._set(p.key, p.idx, f || p.f, u, h, yaw, roll, sx, sy, sz, ox, oy, oz, spin);
  }

  // ---------- registration ----------
  _addOb(ob) {
    ob.id = this._id++;
    ob.f = this._frameOf(ob.s);
    ob.parts = []; ob.cdUntil = 0; ob.alive = true; ob.hitDone = false; ob.pending = false;
    ob.passDone = false; ob.minLat = Infinity; ob.over = false; ob.nearSide = 1;
    ob.needsRefresh = ob.s > this.track.genEnd - 1;      // placed past the generated path (extrapolated frame): refresh once it exists
    if (ob.ext === undefined) ob.ext = 2;
    if (ob.ext > this.maxExt) this.maxExt = ob.ext;
    KIND[ob.kind].build.call(this, ob);
    if (KIND[ob.kind].anim) KIND[ob.kind].anim.call(this, ob, this.beatF, this.pulse);
    this.byId.set(ob.id, ob);
    this.stats.spawned++;
    this.stats.byKind[ob.kind] = (this.stats.byKind[ob.kind] || 0) + 1;
    return ob;
  }
  _freeOb(ob) {
    for (const p of ob.parts) if (p.idx >= 0) { this._release(p.key, p.idx); p.idx = -1; }
    this.byId.delete(ob.id);
    if (ob.ride) { const i = this.platforms.indexOf(ob); if (i >= 0) this.platforms.splice(i, 1); }
  }
  _lb(arr, s) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].s < s) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // ---------- per-ball memory (clone / ghost balls) ----------
  _mem(ob, id) {
    const M = ob.mem || (ob.mem = {});
    return M[id] || (M[id] = { hitDone: false, passDone: false, minLat: Infinity, over: false, nearSide: 1, cdUntil: 0 });
  }
  _swapMem(ob, m) {
    let x;
    x = ob.hitDone; ob.hitDone = m.hitDone; m.hitDone = x;
    x = ob.passDone; ob.passDone = m.passDone; m.passDone = x;
    x = ob.minLat; ob.minLat = m.minLat; m.minLat = x;
    x = ob.over; ob.over = m.over; m.over = x;
    x = ob.nearSide; ob.nearSide = m.nearSide; m.nearSide = x;
    x = ob.cdUntil; ob.cdUntil = m.cdUntil; m.cdUntil = x;
  }
  /** weights of the rotating power-up pickups: setPowerupWeights({ magnet: 2, clone: 0 }) */
  setPowerupWeights(map) { Object.assign(this.powerW, map || {}); }
  /** stage a rule-change zone (delegates to the track, which owns piece selection). Pieces already generated are unaffected. */
  setZone(kind, opts = {}) { return this.track.setZone ? this.track.setZone(kind, opts) : null; }

  // ---------- hits ----------
  /** Emit the one-and-only 'hit' event of an obstacle (toughness 1..5). ds,du = separation the ball needs (track-local metres). */
  _hit(ob, ball, events, ds, du) {
    if (ob.hitDone) return;
    ob.hitDone = true;
    const e = ev(events, 'hit');
    e.toughness = ob.tough; e.s = ob.cs !== undefined ? ob.cs : ob.s; e.u = ob.cu !== undefined ? ob.cu : ob.u; e.h = ob.hc || 0.8;
    e.color = ob.color; e.ds = ds; e.du = du; e.id = ob.id;
    e.headOn = ds < 0 && Math.abs(ds) >= 0.7 * Math.abs(du);
    e.ball = this._cid;
    e.nonLethal = ob.kind === 'slidewall';              // sliding walls are a stumble (size loss), never instant death
    e.kind = KALIAS[ob.type] || ob.type || ob.kind;      // rock | cabin | pine | stone | fence | fallenLog | longLog | snowcat | oncoming | slidewall | overhead | laser ...
    e.halfW = ob.shape === 'cyl' ? ob.rad || 0 : ob.hu || 0; e.ride = !!ob.ride; e.ht = ob.ride ? ob.H || 0 : 0;
    if (this._cid !== 'main') return;                  // a clone's hit never auto-resolves (the obstacle stays for the main ball)
    ob.pending = true; ob.hitSize = ball.size || 1; ob.autoAt = this.time + 0.06;
    this.pending.push(ob);
  }

  /** KAR KANONU: break the nearest static blocker ahead of s in the lane around u (within range m). Returns { s, u, color, tough } or null. */
  snipe(s, u, range) {
    const obs = this.obs;
    for (let i = this._lb(obs, s + 2); i < obs.length; i++) {
      const ob = obs[i];
      if (ob.s > s + range) break;
      if (!ob.alive || ob.kind !== 'static') continue;
      const ou = ob.cu !== undefined ? ob.cu : ob.u, hu = (ob.shape === 'cyl' ? ob.rad : ob.hu) || 0.8;
      if (Math.abs(ou - u) > hu + 0.9) continue;
      const r = { s: ob.s, u: ou, color: ob.color, tough: ob.tough };
      ob.pending = true; this._resolve(ob, true);
      return r;
    }
    return null;
  }

  /** Runner tells us the outcome of a 'hit': smashed -> the obstacle breaks into debris, else it stays. */
  resolve(id, smashed) {
    const ob = this.byId.get(id);
    if (!ob || !ob.pending) return;
    this._resolve(ob, !!smashed);
  }
  _resolve(ob, smashed) {
    ob.pending = false;
    const i = this.pending.indexOf(ob);
    if (i >= 0) this.pending.splice(i, 1);
    if (!smashed) return;
    ob.alive = false;
    const u = ob.cu !== undefined ? ob.cu : ob.u, s = ob.cs !== undefined ? ob.cs : ob.s;
    this._debris(ob, s, u, ob.hc || 0.8, ob.color, ob.tough >= 4 ? 9 : 6, 0.3 + 0.06 * ob.tough, 6);
    for (const p of ob.parts) if (p.idx >= 0) { this._release(p.key, p.idx); p.idx = -1; }
  }

  // ---------- per-frame ----------
  update(dt, beat, ball) {
    { const bp = this.track.pieceAt(ball.s); if (bp && bp.n) useLanes(bp.n); }
    this.time += dt;
    this.beatF = beat.beat; this.phase = beat.phase; this.bpm = beat.bpm || this.bpm;
    const pulse = pulseOf(beat.phase);
    this.pulse = pulse;
    this.mats.pulse.color.setScalar(0.68 + 0.6 * pulse);
    this.mats.glow.color.setScalar(0.9 + 0.3 * pulse);       // pickups glow on the beat (flakes, gems, power-ups share this unlit material)
    for (let i = this.pending.length - 1; i >= 0; i--) { const ob = this.pending[i]; if (this.time >= ob.autoAt) this._resolve(ob, ob.hitSize >= ob.tough + 2); }   // same rule as the runner: size >= toughness + 2 smashes
    const sMin = ball.s - 30, sMax = ball.s + 175, obs = this.obs, M = this.maxExt;
    for (let i = this._lb(obs, sMin - M); i < obs.length; i++) {
      const ob = obs[i];
      if (ob.s - M > sMax) break;
      if (ob.needsRefresh && this.track.genEnd > ob.s + 25) { this._frameInto(ob.s, ob.f); ob.needsRefresh = false; }
      if (ob.alive && ob.s + ob.ext >= sMin && ob.s - ob.ext <= sMax) { const K = KIND[ob.kind]; if (K.anim) K.anim.call(this, ob, beat.beat, pulse); }
    }
    const pk = this.picks, t = this.time;
    for (let i = this._lb(pk, ball.s - 10); i < pk.length; i++) {
      const k = pk[i];
      if (k.s > ball.s + 140) break;
      if (!k.alive) continue;
      if (k.kind === 'snow') { const q = 1 + 0.1 * pulse; this._set('ball', k.idx, k.f, k.u, 0.55 + 0.08 * Math.sin(t * 2.4 + k.ph), t * 0.8 + k.ph, 0, 1.05 * q, 1.0 * q, 1.05 * q); continue; }
      const bob = k.h + 0.1 * Math.sin(t * 2.4 + k.ph);
      if (k.kind === 'flake') this._set('flake', k.idx, k.f, k.u, bob, t * 2.2 + k.ph, 0, 0.95, 0.95, 0.95);
      else this._set(k.pool, k.idx, k.f, k.u, bob + 0.1, t * 2.4 + k.ph, k.kind === 'rocket' ? 0.5 : 0, k.sc, k.sc, k.sc);
    }
    this._updateDyn(dt, ball);
    this._updateDebris(dt);
    this.critters.update(dt, ball, this.time);
    for (const key in this.pool) {
      const p = this.pool[key];
      p.m.visible = p.hi - p.free.length > 0;          // pools with no live instance cost no draw call
      if (p.dirty) { p.m.instanceMatrix.needsUpdate = true; p.dirty = false; }
      if (p.cdirty) { p.m.instanceColor.needsUpdate = true; p.cdirty = false; }
    }
    this.lastS = ball.s; this.ballVs = ball.vs || this.ballVs;
  }

  _updateDebris(dt) {
    const D = this.deb;
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      if (!d.on) continue;
      d.life -= dt;
      if (d.life <= 0) { d.on = false; this._release('box', d.idx); d.idx = -1; continue; }
      d.vh -= 28 * dt;
      d.s += d.vs * dt; d.u += d.vu * dt; d.h += d.vh * dt;
      if (d.h < d.size * 0.5) { d.h = d.size * 0.5; d.vh = Math.abs(d.vh) * 0.35; d.vu *= 0.7; d.vs *= 0.7; }
      d.a += d.va * dt;
      const k = d.size * Math.min(1, d.life * 2.5);
      this._set('box', d.idx, d.f, d.u, d.h, d.a, d.a * 0.7, k, k, k, 0, 0, -(d.s - d.s0));
    }
  }

  _debris(ob, s, u, h, color, n, size, vsBase) {
    const D = this.deb;
    let made = 0;
    for (let i = 0; i < D.length && made < n; i++) {
      const d = D[i];
      if (d.on) continue;
      const idx = this._alloc('box');
      if (idx < 0) return;
      d.on = true; d.idx = idx; d.f = ob.f; d.s0 = ob.s; d.s = s; d.u = u; d.h = h;
      const r1 = Math.random() - 0.5, r2 = Math.random() - 0.5, r3 = Math.random();
      d.vs = vsBase * 0.5 + r1 * 4; d.vu = r2 * 8; d.vh = 3 + r3 * 5; d.a = r3 * 6; d.va = (r1 + r2) * 14;
      d.life = 0.9 + r3 * 0.5; d.size = size * (0.35 + 0.35 * r3);
      this._col('box', idx, color, 0.85 + 0.3 * r3);
      made++;
    }
  }

  // ---------- collisions ----------
  collide(ball, events) {
    const id = ball.id || 'main', main = id === 'main', cb = this._cb;
    CUR_ID = id; this._cid = id;
    if (main) this._flushWarn(events);
    cb.duck = !!ball.duck;
    cb.id = id;
    cb.s = ball.s; cb.u = ball.u; cb.r = ball.r; cb.h = ball.h + ball.r; cb.size = ball.size || 1; cb.vs = ball.vs; cb.vu = ball.vu; cb.vh = ball.vh;
    const R = ball.r + 6.5, M = this.maxExt, obs = this.obs, t = this.time;
    for (let i = this._lb(obs, ball.s - R - M); i < obs.length; i++) {
      const ob = obs[i];
      if (ob.s - M > ball.s + R) break;
      if (!ob.alive || Math.abs(ball.s - ob.s) > ob.ext + R) continue;
      if (main) KIND[ob.kind].hit.call(this, ob, cb, events, t);
      else if (CLONE_OK[ob.kind]) {
        const m = this._mem(ob, id);
        this._swapMem(ob, m);
        KIND[ob.kind].hit.call(this, ob, cb, events, t);
        this._swapMem(ob, m);
      }
    }
    this._collideDyn(cb, events);
    if (main) this.critters.collide(cb, events, t);
    const mag = ball.magnet || 0, pk = this.picks, rr = ball.r + 1.3 + mag;
    for (let i = this._lb(pk, ball.s - rr); i < pk.length; i++) {
      const k = pk[i];
      if (k.s > ball.s + rr) break;
      if (!k.alive) continue;
      if (!main && k.kind !== 'flake' && k.kind !== 'snow') continue;     // clones only collect flakes and snow
      const ds = cb.s - k.s, du = cb.u - k.u, dh = cb.h - k.h;
      const rad = cb.r + k.rad + (k.kind === 'flake' ? mag : k.kind === 'snow' ? mag * 0.4 : 0);
      if (ds * ds + du * du + dh * dh > rad * rad) continue;
      k.alive = false;
      this._freePick(k);
      const e = ev(events, 'pickup');
      e.kind = k.kind; e.value = k.value; e.s = k.s; e.u = k.u; e.h = k.h;
      if (k.kind === 'letter') e.letter = k.letter || this.nextLetter || '';
    }
    CUR_ID = 'main'; this._cid = 'main';
  }

  // ---------- geometry helpers for kinds ----------
  /** Sphere vs AABB in (s,u,h). Returns this._tmpHit with the (ds,du) separation, or null. */
  _aabb(ball, s0, s1, u0, u1, h0, h1) {
    const cs = clamp(ball.s, s0, s1), cu = clamp(ball.u, u0, u1), ch = clamp(ball.h, h0, h1);
    const dx = ball.s - cs, dy = ball.u - cu, dz = ball.h - ch;
    const d2 = dx * dx + dy * dy + dz * dz, r = ball.r;
    if (d2 >= r * r) return null;
    const H = this._tmpHit;
    if (d2 < 1e-9) {
      const ps0 = ball.s - s0, ps1 = s1 - ball.s, pu0 = ball.u - u0, pu1 = u1 - ball.u, m = Math.min(ps0, ps1, pu0, pu1);
      H.ds = 0; H.du = 0;
      if (m === ps0) H.ds = -(ps0 + r); else if (m === ps1) H.ds = ps1 + r; else if (m === pu0) H.du = -(pu0 + r); else H.du = pu1 + r;
      return H;
    }
    const d = Math.sqrt(d2), pen = r - d;
    H.ds = (dx / d) * pen; H.du = (dy / d) * pen;
    if (dz * dz > dx * dx + dy * dy) { H.ds = 0; H.du = 0; }     // landing on top: no sideways separation
    return H;
  }

  /** Vertical cylinder (s,u circle, height ht). */
  _cyl(ball, cs, cu, rad, ht) {
    if (ball.h - ball.r > ht) return null;
    const dx = ball.s - cs, dy = ball.u - cu, rr = rad + ball.r, d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2) || 1e-6, pen = rr - d, H = this._tmpHit;
    H.ds = (dx / d) * pen; H.du = (dy / d) * pen;
    return H;
  }

  /** Oriented bar (axis angle th in the (u,s) plane); true if the ball overlaps. */
  _obb(ball, cu, cs, th, hl, hwid, h0, h1) {
    const dv = ball.h < h0 ? h0 - ball.h : ball.h > h1 ? ball.h - h1 : 0;
    if (dv >= ball.r) return false;
    const rr = Math.sqrt(ball.r * ball.r - dv * dv);
    const c = Math.cos(th), s = Math.sin(th), ru = ball.u - cu, rs = ball.s - cs;
    const along = ru * c + rs * s, perp = -ru * s + rs * c;
    const dx = along - clamp(along, -hl, hl), dz = perp - clamp(perp, -hwid, hwid);
    return dx * dx + dz * dz < rr * rr;
  }

  _knock(events, ob, du, dh, strength, t, cd = 0.5) {
    if (t < ob.cdUntil) return;
    ob.cdUntil = t + cd;
    const e = ev(events, 'knock');
    e.du = du; e.dh = dh; e.strength = strength;
  }

  // ---------- pickups ----------
  _pickup(kind, s, u, h, opts = {}) {
    const pool = PICK_POOL[kind], idx = this._alloc(pool);
    if (idx < 0) return null;
    const f = this._frameOf(s);
    const sc = opts.sc || (kind === 'flake' ? 0.78 : kind === 'letter' ? 1.0 : kind === 'scarf' ? 1.1 : kind === 'gem' ? 1.25 : kind === 'crystal' ? 1.3 : 1.35);
    const k = { kind, pool, s, u, h, f, idx, alive: true, ph: (s * 1.7) % TAU, sc, value: opts.value ?? 1, sh: -1,
      rad: opts.rad ?? (kind === 'snow' ? 0.65 : kind === 'letter' || kind === 'scarf' ? 1.0 : kind === 'flake' ? 0.5 : kind === 'gem' ? 0.75 : 0.62), letter: opts.letter || '' };
    if (kind === 'snow') {
      this._col('ball', idx, COL.pile); this._set('ball', idx, f, u, 0.55, k.ph, 0, 1.05, 1.0, 1.05);
      k.sh = this._alloc('shadow');                                                            // contact shadow: the pile reads on white snow
      if (k.sh >= 0) { this._col('shadow', k.sh, 0xffffff); this._set('shadow', k.sh, f, u, 0.025, 0, 0, 1.4, 1, 1.4); }
    } else if (kind === 'flake') this._col('flake', idx, COL.flake);
    else this._col(pool, idx, kind === 'bait' ? 0xff9a4a : kind === 'bread' ? 0xd9a05b : 0xffffff);      // (BALIK YEMİ: an orange gem; SICAK ÇÖREK: a warm tan one)
    this.picks.push(k);
    return k;
  }
  _freePick(k) { this._release(k.pool, k.idx); if (k.sh >= 0) { this._release('shadow', k.sh); k.sh = -1; } }
  _sortPicks() { this.picks.sort((a, b) => a.s - b.s); }

  /** Replace the letter the runner wants next (null: none). Rebuilds the shared 3D letter geometry. */
  setNextLetter(ch) {
    const c = ch ? String(ch).toLocaleUpperCase('tr') : null;
    if (c === this.nextLetter) return;
    this.nextLetter = c;
    const p = this.pool.letter;
    if (c) { p.m.geometry.dispose(); p.m.geometry = letterGeometry(c); p.m.geometry.computeBoundingSphere(); }
    else if (!this.yetiLetter) for (const k of this.picks) if (k.kind === 'letter' && k.alive) { k.alive = false; this._freePick(k); }
  }

  /** Y-E-T-I hunt: the letter the runner wants next (null: none). Spawns rarely, one at a time. */
  setYetiLetter(ch) {
    this.yetiLetter = ch || null;
    if (!ch) return;
    const p = this.pool.letter;
    p.m.geometry.dispose(); p.m.geometry = letterGeometry(ch); p.m.geometry.computeBoundingSphere();
  }

  trim(sBehind) {
    const obs = this.obs;
    let k = 0;
    while (k < obs.length && obs[k].s + obs[k].ext < sBehind) {
      const ob = obs[k++];
      if (ob.pending) { const i = this.pending.indexOf(ob); if (i >= 0) this.pending.splice(i, 1); }
      this._freeOb(ob);
    }
    if (k) obs.splice(0, k);
    const pk = this.picks;
    k = 0;
    while (k < pk.length && pk[k].s < sBehind) { const p = pk[k++]; if (p.alive) this._freePick(p); }
    if (k) pk.splice(0, k);
    const rl = this.rowsLog;
    k = 0;
    while (k < rl.length && rl[k].s + rl[k].ext < sBehind - 40) k++;
    if (k) rl.splice(0, k);
    for (let i = this.dyn.length - 1; i >= 0; i--) if (this.dyn[i].s < sBehind - 20) this._freeDyn(this.dyn[i]);
    this.critters.trim(sBehind);
  }

  dispose() {
    this.critters.dispose();
    for (const key in this.pool) { this.group.remove(this.pool[key].m); this.pool[key].m.dispose(); }
    for (const k in this.G) if (this.G[k] && this.G[k].dispose) this.G[k].dispose();
    for (const k in this.mats) this.mats[k].dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.obs.length = 0; this.picks.length = 0; this.pending.length = 0; this.byId.clear();
  }
}

// ---------------------------------------------------------------------------
// Obstacle kinds
//   static  — blockers with a 'hit' (toughness 1..5): snowman, sign, crate, sled, logpile, pine, rock, cabin,
//             fallenLog / fence (low, jumpable), snowcat / longLogs (long "train" blockers)
//   moving  — lane-hopping skier / snowmobile, rolling log (beat-locked)
//   plow, swing — beat-locked, 'knock' events
//   ice, melt   — floor patches ('ice' / 'melt' events)
//   pad, portal
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------------
// Blocker types. The hit box is set by the build (ob.shape 'cyl' | 'box', ob.rad / ob.hs / ob.hu / ob.ht) and always matches what is drawn.
// tough 1..5 (runner: tier + 1 >= tough + 2 smashes it); lethal = head-on hits end the run (rock, cabin): they get a red warning disc.
// Biome skins (FAMILY): every type can be re-skinned per biome family in SK[family][type] without touching the generator.
//   small rock 'stone' = low + wide (jumpable, tough 2); big 'rock' = tall faceted boulder with a red / white hazard flag (lane blocker, lethal).
// ---------------------------------------------------------------------------------------------------------------------------
const TRAIN_FRONT = 1, TRAIN_COLS = [0x1fb8c9, 0xffc02e, 0xff7a3a], TRAIN_ICE = [0x8fd3ff, 0xb9e6ff, 0x7bbcf0];
const SEG = 4.2;   // train segment length (each segment has its own frame so trains follow curves)
const FAMILY = { aurora: 'aurora', bamboo: 'bamboo', glacier: 'glacier', carnival: 'carnival', snow: 'snow', forest: 'forest', greenhill: 'forest', sakura: 'forest', kapadokya: 'desert', desert: 'desert', pirate: 'desert', town: 'town', istanbul: 'town', icecave: 'ice', candy: 'candy', neon: 'neon', moon: 'moon', volcano: 'volcano' };
const ROCK_TINT = { snow: 0x5d6572, forest: 0x626d58, desert: 0x8b4b2e, ice: 0x5f8dbd, aurora: 0x4a6a9a, bamboo: 0x6a7a5a, glacier: 0x4a86c8, carnival: 0xb03070, candy: 0xc23c86, moon: 0x70707b, volcano: 0x3b2c28, town: 0x6a6f78, neon: 0x4d3f85 };
const STONE_TINT = { snow: 0x6a7280, forest: 0x6f7a63, desert: 0x7d4a2f, ice: 0x7aa6d4, aurora: 0x6a8ac0, bamboo: 0x8a9a7a, glacier: 0x6aa6e4, carnival: 0xff7ab0, candy: 0xff8ccf, moon: 0x85858f, volcano: 0x4a3a34, town: 0x7a7f88, neon: 0x5b4d9a };
const KALIAS = { longLogs: 'longLog' };   // event kind names the runner knows (rock, cabin, pine, fence, fallenLog, snowcat ... pass through)

function bigRock(ob) {       // tall faceted boulder (lethal head-on) + hazard flag
  const sc = ob.sc || 1, W = 2.0 * sc, H = 2.25 * sc, key = ob.id & 1 ? 'rockB2' : 'rockB', g = this.G[key];
  ob.shape = 'cyl'; ob.rad = g.userData.fr * W; ob.ht = H;
  this._part(ob, key, ROCK_TINT[ob.skin] || ROCK_TINT.snow, ob.u, 0, ob.u * 3.1 + ob.id, 0, W, H, W);
  this._part(ob, 'box', COL.dark, ob.u, H + 0.55, 0, 0, 0.07, 1.1, 0.07);
  this._part(ob, 'box', COL.red, ob.u + 0.27, H + 0.95, 0, 0, 0.52, 0.34, 0.04);
  this._part(ob, 'box', 0xffffff, ob.u + 0.27, H + 0.95, 0, 0, 0.52, 0.11, 0.05);
}
function smallRock(ob) {     // low, wide, dark facets: jump it (or dodge)
  const sc = ob.sc || 1, W = 1.4 * sc, H = 0.64 * sc, key = ob.id & 1 ? 'rockS2' : 'rockS', g = this.G[key];
  ob.shape = 'cyl'; ob.rad = g.userData.fr * W; ob.ht = H;
  this._part(ob, key, STONE_TINT[ob.skin] || STONE_TINT.snow, ob.u, 0, ob.u * 2.3 + ob.id, 0, W, H, W);
}
function crateBuild(ob, hexA, hexB) {
  const n = ob.n || 1; ob.ht = 1.1 * n;
  for (let k = 0; k < n; k++) this._part(ob, 'box', k & 1 ? hexB : hexA, ob.u, 0.55 + 1.1 * k, 0.1 * (k ? -1 : 1), 0, 1.1, 1.1, 1.1);
}
function fenceBuild(ob, post, rail) {
  const w = ob.uMax - ob.uMin, uc = (ob.uMax + ob.uMin) / 2, n = Math.ceil(w / 1.1) + 1;
  ob.hu = w / 2; ob.u = uc;
  for (let k = 0; k < n; k++) this._part(ob, 'box', post, ob.uMin + (w * k) / (n - 1), 0.47, 0, 0, 0.13, 0.95, 0.13);
  this._part(ob, 'box', rail, uc, 0.35, 0, 0, w, 0.1, 0.06); this._part(ob, 'box', rail, uc, 0.72, 0, 0, w, 0.1, 0.06);
}
function logBuild(ob, hexA, hexB) {
  const len = ob.uMax - ob.uMin, uc = (ob.uMax + ob.uMin) / 2;
  ob.hu = len / 2; ob.u = uc;
  this._part(ob, 'cyl', hexA, uc, 0.42, 0, PI / 2, 0.84, len, 0.84);
  this._part(ob, 'cyl', hexB, uc + len * 0.2, 0.2, 0, PI / 2, 0.45, len * 0.45, 0.45, 0, 0, 0.55);
}

const DEFS = {
  snowman: { shape: 'cyl', tough: 1, color: 0xffffff, rad: 0.55, ht: 2.4, ext: 1.5, build(ob) {
    const u = ob.u, W = 0xdbe7f4;
    this._part(ob, 'ball', W, u, 0.6, 0, 0, 1.2, 1.2, 1.2); this._part(ob, 'ball', W, u, 1.5, 0, 0, 0.86, 0.86, 0.86);
    this._part(ob, 'ball', W, u, 2.1, 0, 0, 0.62, 0.62, 0.62);
    this._part(ob, 'cyl', COL.red, u, 1.86, 0, 0, 0.8, 0.17, 0.8);                                                  // scarf (colour against the white snow)
    for (let k = 0; k < 3; k++) this._part(ob, 'box', COL.dark, u, 1.36 + 0.17 * k, 0, 0, 0.1, 0.1, 0.1, 0, 0, 0.42); // coal buttons
    this._part(ob, 'cyl', COL.dark, u, 2.42, 0, 0, 0.75, 0.06, 0.75); this._part(ob, 'cyl', COL.dark, u, 2.62, 0, 0, 0.42, 0.4, 0.42);
    this._part(ob, 'box', COL.orange, u, 2.1, 0, 0, 0.07, 0.07, 0.3, 0, 0, 0.32);
  } },
  sign: { shape: 'cyl', tough: 1, color: COL.red, rad: 0.45, ht: 1.8, ext: 1.2, build(ob) {
    this._part(ob, 'box', COL.wood2, ob.u, 0.85, 0, 0, 0.12, 1.7, 0.12);
    this._part(ob, 'box', COL.red, ob.u, 1.5, 0, 0, 1.0, 0.5, 0.08, 0, 0, 0.1); this._part(ob, 'box', COL.snow, ob.u, 1.5, 0, 0, 0.8, 0.1, 0.09, 0, 0, 0.1);
  } },
  crate: { shape: 'box', tough: 2, color: COL.wood, hs: 0.6, hu: 0.6, ht: 1.1, ext: 1.5, build(ob) { crateBuild.call(this, ob, COL.wood, COL.wood2); } },
  sled: { shape: 'box', tough: 2, color: COL.red, hs: 1.0, hu: 0.55, ht: 1.2, ext: 1.8, build(ob) { sledParts.call(this, ob, 0); } },
  logpile: { shape: 'box', tough: 3, color: COL.wood2, hs: 0.95, hu: 1.0, ht: 1.5, ext: 1.8, build(ob) {
    const u = ob.u, P = PI / 2;
    this._part(ob, 'cyl', COL.wood2, u, 0.42, 0, P, 0.84, 2.0, 0.84, 0, 0, -0.45); this._part(ob, 'cyl', COL.wood, u, 0.42, 0, P, 0.84, 2.0, 0.84, 0, 0, 0.45);
    this._part(ob, 'cyl', COL.wood, u, 1.1, 0, P, 0.84, 1.9, 0.84);
  } },
  pine: { shape: 'cyl', tough: 4, color: COL.pine, rad: 0.8, ht: 4.7, ext: 1.6, build(ob) {
    const sc = ob.sc || 1; ob.rad = 0.8 * sc; ob.ht = 4.7 * sc;
    this._part(ob, 'pine', 0xffffff, ob.u, 0, ob.u * 3.1, 0, sc, sc, sc);
  } },
  rock: { shape: 'cyl', tough: 5, color: COL.rock, rad: 1.0, ht: 2.2, ext: 1.8, lethal: true, build: bigRock },
  stone: { shape: 'cyl', tough: 2, color: 0x6a7280, rad: 0.7, ht: 0.64, ext: 1.2, build: smallRock },
  cabin: { shape: 'box', tough: 5, color: COL.cabin, hs: 1.5, hu: 1.05, ht: 2.6, ext: 2.2, lethal: true, build(ob) {
    const u = ob.u, R = 0.55;
    this._part(ob, 'box', COL.cabin, u, 0.9, 0, 0, 2.0, 1.8, 2.8);
    this._part(ob, 'box', COL.wood2, u - 0.58, 2.1, 0, -R, 1.35, 0.18, 3.1); this._part(ob, 'box', COL.wood2, u + 0.58, 2.1, 0, R, 1.35, 0.18, 3.1);
    this._part(ob, 'box', COL.snow, u - 0.62, 2.2, 0, -R, 1.3, 0.12, 3.15); this._part(ob, 'box', COL.snow, u + 0.62, 2.2, 0, R, 1.3, 0.12, 3.15);
    this._part(ob, 'box', COL.dark, u, 0.6, 0, 0, 0.6, 1.0, 0.06, 0, 0, 1.42); this._part(ob, 'box', COL.rock, u + 0.6, 2.6, 0, 0, 0.35, 0.9, 0.35, 0, 0, -0.6);
    this._part(ob, 'box', COL.red, u, 0.1, 0, 0, 2.1, 0.2, 0.1, 0, 0, 1.42);                                        // hazard band at the base
  } },
  fallenLog: { shape: 'box', tough: 2, color: COL.wood2, ht: 0.85, hs: 0.45, ext: 1.2, low: true, build(ob) { logBuild.call(this, ob, COL.wood2, COL.wood); } },
  fence: { shape: 'box', tough: 1, color: COL.wood, ht: 0.85, hs: 0.2, ext: 1.0, low: true, build(ob) { fenceBuild.call(this, ob, COL.wood2, COL.wood); } },
  snowcat: { shape: 'box', tough: 5, color: COL.orange, ht: 2.6, hu: 1.05, ext: 12, train: true, lethal: true, build(ob) {
    const L = ob.L, ns = Math.max(2, Math.round(L / SEG)), sl = L / ns, ride = !!ob.ride;
    ob.hs = L / 2; ob.hu = 1.05;
    if (ride) {   // flatbed tram car: flat roof you can ride after the ramp (see platformAt)
      ob.H = ob.H || 2.3; ob.rl = ob.rl ?? 9; ob.ht = ob.H; ob.cs = ob.s; ob.cu = ob.u;
      const fr = this._frameOf(ob.s - L / 2 - ob.rl / 2);
      if (ob.rl > 0) this._part(ob, 'wedge', ob.ice ? 0xcfeeff : COL.wood2, ob.u, ob.H / 2, 0, 0, 2.0, ob.H, ob.rl, 0, 0, 0, fr);
      this.platforms.push(ob);
    }
    const P = PI / 2, u = ob.u, ice = !!ob.ice, FZ = TRAIN_FRONT;
    for (let k = 0; k < ns; k++) {
      const f = this._frameOf(ob.s - L / 2 + (k + 0.5) * sl);
      const body = ice ? TRAIN_ICE[k % 3] : k === 0 && !ride ? 0xe5392f : TRAIN_COLS[(k - 1 + 3) % 3];
      const trim = ice ? 0x2f6fb0 : 0x2a2f3d;
      if (ride) {
        const H = ob.H;
        this._part(ob, 'box', body, u, H / 2, 0, 0, 2.0, H, sl + 0.04, 0, 0, 0, f);
        this._part(ob, 'box', 0xfff3d0, u, H * 0.42, 0, 0, 2.06, 0.18, sl + 0.04, 0, 0, 0, f);      // light stripe
        this._part(ob, 'box', 0xbfe3ff, u, H * 0.72, 0, 0, 2.06, 0.4, sl * 0.8, 0, 0, 0, f);          // window band
        this._part(ob, 'box', ob.glow || 0xffd23a, u, H + 0.03, 0, 0, 1.9, 0.06, sl, 0, 0, 0, f);     // roof glow
        this._part(ob, 'box', trim, u, 0.22, 0, 0, 2.1, 0.3, sl + 0.04, 0, 0, 0, f);                  // chassis
      } else {
        const len = sl - 0.5;                                   // visible coupler gap: clean joins on curves
        this._part(ob, 'box', trim, u, 0.42, 0, 0, 1.7, 0.4, len + 0.2, 0, 0, 0, f);                   // chassis
        this._part(ob, 'box', body, u, 1.15, 0, 0, 2.0, 1.3, len, 0, 0, 0, f);                          // body
        this._part(ob, 'box', 0xfff3d0, u, 0.78, 0, 0, 2.04, 0.14, len, 0, 0, 0, f);                   // cream stripe
        if (k === 0) {                                          // front loco: cab, face, lights
          this._part(ob, 'box', trim, u, 2.0, 0, 0, 1.9, 0.18, len * 0.9, 0, 0, -FZ * 0.15, f);        // cab roof
          this._part(ob, 'box', 0xffffff, u, 2.14, 0, 0, 1.7, 0.1, len * 0.8, 0, 0, -FZ * 0.15, f);    // snow cap
          this._part(ob, 'box', 0xd8f1ff, u, 1.78, 0, 0, 1.8, 0.62, len * 0.72, 0, 0, -FZ * 0.15, f);  // cab windows
          this._part(ob, 'box', 0xe5392f, u, 1.78, 0, 0, 1.86, 0.1, len * 0.72, 0, 0, -FZ * 0.15, f);  // cab mid bar
          this._part(ob, 'cyl', 0xffb21a, u + 0.55, 2.55, 0, 0, 0.34, 0.5, 0.34, 0, 0, FZ * 0.7, f);    // chimney
          this._part(ob, 'cyl', 0x2a2f3d, u + 0.55, 2.84, 0, 0, 0.48, 0.1, 0.48, 0, 0, FZ * 0.7, f);
          const zf = FZ * (len / 2 + 0.03);
          for (const sg of [-1, 1]) {
            this._part(ob, 'box', 0xffffff, u + sg * 0.5, 1.5, 0, 0, 0.46, 0.46, 0.08, 0, 0, zf, f);   // eyes
            this._part(ob, 'box', 0x1a1d27, u + sg * 0.5, 1.46, 0, 0, 0.22, 0.26, 0.1, 0, 0, zf, f);
            this._part(ob, 'box', 0xfff27a, u + sg * 0.74, 0.8, 0, 0, 0.3, 0.3, 0.1, 0, 0, zf, f);      // headlights
            this._part(ob, 'box', 0xffb21a, u + sg * 0.74, 1.15, 0, 0, 0.1, 0.1, 0.1, 0, 0, zf, f);
          }
          this._part(ob, 'box', 0x1a1d27, u, 0.98, 0, 0, 0.6, 0.12, 0.1, 0, 0, zf, f);                   // smile
          this._part(ob, 'box', 0xffb21a, u, 0.45, 0, 0, 2.1, 0.26, 0.22, 0, 0, FZ * (len / 2 + 0.1), f);// bumper
        } else {                                                // passenger car: windows + peaked roof
          for (const sg of [-1, 1]) for (const q of [-0.28, 0.28]) this._part(ob, 'box', 0xd8f1ff, u + sg * 1.01, 1.45, 0, 0, 0.06, 0.5, len * 0.32, 0, 0, q * len, f);
          this._part(ob, 'box', trim, u, 1.9, 0, 0, 2.2, 0.2, len + 0.1, 0, 0, 0, f);
          this._part(ob, 'box', 0xffffff, u, 2.05, 0, 0, 1.9, 0.12, len * 0.92, 0, 0, 0, f);            // snow on the roof
          this._part(ob, 'box', 0xff5a8a, u, 2.2, 0, 0, 0.5, 0.2, 0.5, 0, 0, 0, f);                     // roof lantern
        }
        // coupler to the next car
        if (k < ns - 1) this._part(ob, 'box', 0x2a2f3d, u, 0.55, 0, 0, 0.3, 0.2, 0.9, 0, 0, -FZ * sl / 2, f);
      }
      for (const sg of [-1, 1]) for (const q of [-0.3, 0.3]) {                                          // wheels
        this._part(ob, 'cyl', 0x232733, u + sg * 1.0, 0.4, 0, P, 0.8, 0.3, 0.8, 0, 0, q * sl, f);
        this._part(ob, 'cyl', 0xffc22e, u + sg * 1.0 + sg * 0.03, 0.4, 0, P, 0.38, 0.34, 0.38, 0, 0, q * sl, f);
      }
    }
  } },
  longLogs: { shape: 'box', tough: 3, color: COL.wood2, ht: 1.9, hu: 1.05, ext: 12, train: true, build(ob) {
    const L = ob.L, ns = Math.max(2, Math.round(L / SEG)), sl = L / ns, P = PI / 2, u = ob.u, FZ = TRAIN_FRONT;
    ob.hs = L / 2; ob.hu = 1.05;
    for (let k = 0; k < ns; k++) {
      const f = this._frameOf(ob.s - L / 2 + (k + 0.5) * sl), len = sl - 0.4;
      this._part(ob, 'box', 0x2a2f3d, u, 0.2, 0, 0, 1.9, 0.28, sl + 0.04, 0, 0, 0, f);                  // flat bed
      this._part(ob, 'cyl', COL.wood, u - 0.5, 0.62, P, P, 1.0, len, 1.0, 0, 0, 0, f); this._part(ob, 'cyl', COL.wood2, u + 0.5, 0.62, P, P, 1.0, len, 1.0, 0, 0, 0, f);
      this._part(ob, 'cyl', 0xb8803c, u, 1.5, P, P, 0.95, len, 0.95, 0, 0, 0, f);
      for (const q of [-0.3, 0.3]) this._part(ob, 'box', 0xe5392f, u, 1.0, 0, 0, 2.15, 1.7, 0.12, 0, 0, q * sl, f);   // red straps
      for (const sg of [-1, 1]) for (const q of [-0.3, 0.3]) {
        this._part(ob, 'cyl', 0x232733, u + sg * 1.02, 0.36, 0, P, 0.72, 0.28, 0.72, 0, 0, q * sl, f);
        this._part(ob, 'cyl', 0xffc22e, u + sg * 1.05, 0.36, 0, P, 0.34, 0.3, 0.34, 0, 0, q * sl, f);
      }
      if (k === 0) { const zf = FZ * (len / 2 + 0.02); for (const [dx, y, c] of [[-0.5, 0.62, 0xf0d6a0], [0.5, 0.62, 0xe9c78a], [0, 1.5, 0xf0d6a0]]) this._part(ob, 'cyl', c, u + dx, y, 0, P, 0.7, 0.05, 0.7, 0, 0, zf, f); }
    }
  } },
};

// ---- biome skins: only what differs from the snow set. Same hit box rules (set ob.shape / rad / hs / hu / ht in the build).
const SK = {
  forest: {
    crate(ob) {     // tree stump (a tall log stump when the crate would be stacked)
      const u = ob.u, ht = (ob.n || 1) > 1 ? 1.8 : 1.0; ob.shape = 'cyl'; ob.rad = 0.6; ob.ht = ht;
      this._part(ob, 'cyl', 0x7a5532, u, ht / 2, 0, 0, 1.2, ht, 1.2); this._part(ob, 'cyl', 0x5a3d22, u, 0.12, 0, 0, 1.36, 0.24, 1.36);   // trunk + root flare
      this._part(ob, 'cyl', 0xd9b77a, u, ht + 0.02, 0, 0, 1.14, 0.06, 1.14); this._part(ob, 'cyl', 0xb08850, u, ht + 0.05, 0, 0, 0.6, 0.05, 0.6);   // cut top + rings
    },
    snowman(ob) {   // hollow tree trunk
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.62; ob.ht = 2.1;
      this._part(ob, 'cyl', 0x7a5532, u, 1.05, 0, 0, 1.24, 2.1, 1.24); this._part(ob, 'cyl', 0x4a2f1a, u, 2.12, 0, 0, 1.0, 0.1, 1.0);
      this._part(ob, 'ball', 0x4f9a45, u, 2.2, 0, 0, 0.95, 0.5, 0.95); this._part(ob, 'cyl', 0xc9a56e, u, 0.95, 0, 0, 1.3, 0.16, 1.3);
    },
  },
  town: {
    sled(ob) {      // parked car (its rear faces you)
      const u = ob.u, body = [0xe8362f, 0x2f7de1, 0xf0c02a, 0x35c46a][ob.id & 3]; ob.shape = 'box'; ob.hs = 1.1; ob.hu = 0.75; ob.ht = 1.2;
      this._part(ob, 'box', body, u, 0.5, 0, 0, 1.5, 0.62, 2.2); this._part(ob, 'box', body, u, 0.98, 0, 0, 1.28, 0.4, 1.2, 0, 0, 0.1);
      this._part(ob, 'box', 0x9fd8ff, u, 0.98, 0, 0, 1.32, 0.26, 1.04, 0, 0, 0.1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._part(ob, 'cyl', 0x1a1d26, u + sx * 0.7, 0.28, 0, PI / 2, 0.56, 0.2, 0.56, 0, 0, sz * 0.7);
      for (const sx of [-1, 1]) this._part(ob, 'box', 0xff3a2a, u + sx * 0.5, 0.66, 0, 0, 0.3, 0.14, 0.06, 0, 0, 1.12);                    // tail lights
    },
    logpile(ob) {   // stacked barrels
      const u = ob.u; ob.shape = 'box'; ob.hs = 0.45; ob.hu = 0.9; ob.ht = 1.8;
      for (const [x, h, c] of [[-0.5, 0.45, 0xc2402f], [0.5, 0.45, 0x2f6fc2], [0, 1.35, 0xd9a21f]]) {
        this._part(ob, 'cyl', c, u + x, h, 0, 0, 0.8, 0.9, 0.8);
        this._part(ob, 'cyl', 0x2a2d36, u + x, h + 0.25, 0, 0, 0.84, 0.08, 0.84); this._part(ob, 'cyl', 0x2a2d36, u + x, h - 0.25, 0, 0, 0.84, 0.08, 0.84);   // hoops
      }
    },
    cabin(ob) {     // bus (lethal head-on)
      const u = ob.u; ob.shape = 'box'; ob.hs = 1.5; ob.hu = 1.05; ob.ht = 2.5;
      this._part(ob, 'box', 0xf3b81f, u, 1.25, 0, 0, 2.1, 2.5, 2.9); this._part(ob, 'box', 0x9fd8ff, u, 1.7, 0, 0, 2.14, 0.7, 2.7);
      this._part(ob, 'box', 0x2a2d36, u, 0.3, 0, 0, 2.14, 0.4, 2.94); this._part(ob, 'box', 0x9fd8ff, u, 1.6, 0, 0, 1.6, 0.8, 0.06, 0, 0, 1.46);
      for (const sx of [-1, 1]) this._part(ob, 'box', 0xff3a2a, u + sx * 0.8, 0.6, 0, 0, 0.3, 0.16, 0.06, 0, 0, 1.46);
      this._part(ob, 'box', COL.red, u, 0.1, 0, 0, 2.2, 0.2, 0.1, 0, 0, 1.47);
    },
    snowman(ob) {   // phone booth
      const u = ob.u; ob.shape = 'box'; ob.hs = 0.55; ob.hu = 0.55; ob.ht = 2.3;
      this._part(ob, 'box', 0xd8352d, u, 1.15, 0, 0, 1.1, 2.3, 1.1); this._part(ob, 'box', 0xbfe3ff, u, 1.35, 0, 0, 0.8, 1.2, 0.06, 0, 0, 0.56);
      this._part(ob, 'box', COL.dark, u, 2.32, 0, 0, 1.16, 0.1, 1.16);
    },
    crate(ob) {     // dumpster
      const u = ob.u; ob.shape = 'box'; ob.hs = 0.65; ob.hu = 0.85; ob.ht = 1.3;
      this._part(ob, 'box', 0x2f8a4e, u, 0.62, 0, 0, 1.7, 1.24, 1.3); this._part(ob, 'box', 0x1f5f36, u, 1.28, 0, 0, 1.76, 0.1, 1.36);
    },
    rock(ob) {      // concrete barrier block, red / white top
      const u = ob.u; ob.shape = 'box'; ob.hs = 0.85; ob.hu = 1.2; ob.ht = 1.5;
      this._part(ob, 'box', 0x9ea3ab, u, 0.6, 0, 0, 2.4, 1.2, 1.7); this._part(ob, 'box', COL.red, u, 1.35, 0, 0, 2.4, 0.3, 1.7);
      for (let k = -1; k <= 1; k++) this._part(ob, 'box', 0xffffff, u + k * 0.8, 1.36, 0, 0, 0.4, 0.31, 1.72);
    },
    stone(ob) {     // traffic cone
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.4; ob.ht = 0.8;
      this._part(ob, 'cone', 0xff7a1a, u, 0, 0, 0, 0.8, 0.8, 0.8); this._part(ob, 'cyl', 0xffffff, u, 0.38, 0, 0, 0.5, 0.12, 0.5);
    },
    fallenLog(ob) { // bench
      const len = ob.uMax - ob.uMin, uc = (ob.uMax + ob.uMin) / 2; ob.hu = len / 2; ob.u = uc; ob.hs = 0.4; ob.ht = 0.85;
      this._part(ob, 'box', 0xb07a42, uc, 0.5, 0, 0, len, 0.12, 0.45); this._part(ob, 'box', 0x8f5f32, uc, 0.8, 0, 0, len, 0.1, 0.1, 0, 0, 0.18);
      this._part(ob, 'box', 0x5a6070, ob.uMin + 0.3, 0.25, 0, 0, 0.12, 0.5, 0.4); this._part(ob, 'box', 0x5a6070, ob.uMax - 0.3, 0.25, 0, 0, 0.12, 0.5, 0.4);
    },
    fence(ob) { fenceBuild.call(this, ob, 0xf4f4f4, 0xe2e2e2); },
  },
  desert: {
    sled(ob) {      // wooden cart with sacks
      const u = ob.u; ob.shape = 'box'; ob.hs = 1.0; ob.hu = 0.7; ob.ht = 1.3;
      this._part(ob, 'box', 0x9a6b3a, u, 0.5, 0, 0, 1.2, 0.5, 1.9); this._part(ob, 'box', 0x7a5230, u, 0.8, 0, 0, 1.3, 0.12, 2.0);
      this._part(ob, 'ball', 0xe6d6ae, u - 0.28, 1.0, 0, 0, 0.62, 0.6, 0.62, 0, 0, 0.3); this._part(ob, 'ball', 0xd8c69a, u + 0.3, 0.98, 0, 0, 0.6, 0.55, 0.6, 0, 0, -0.3);
      for (const sx of [-1, 1]) this._part(ob, 'cyl', 0x4a2f1a, u + sx * 0.66, 0.36, 0, PI / 2, 0.72, 0.14, 0.72);
    },
    cabin(ob) {     // adobe house
      const u = ob.u; ob.shape = 'box'; ob.hs = 1.5; ob.hu = 1.05; ob.ht = 2.4;
      this._part(ob, 'box', 0xd9a766, u, 1.0, 0, 0, 2.0, 2.0, 2.8); this._part(ob, 'box', 0xc48c4f, u, 2.2, 0, 0, 2.15, 0.4, 2.95);
      this._part(ob, 'box', 0x4a2f1a, u, 0.6, 0, 0, 0.6, 1.0, 0.06, 0, 0, 1.42); this._part(ob, 'box', 0x6b4a2a, u + 0.62, 1.5, 0, 0, 0.35, 0.35, 0.06, 0, 0, 1.42);
      this._part(ob, 'box', COL.red, u, 0.1, 0, 0, 2.1, 0.2, 0.1, 0, 0, 1.42);
    },
    snowman(ob) {   // cactus
      ob.shape = 'cyl'; ob.rad = 0.5; ob.ht = 2.65;
      this._part(ob, 'cactus', 0xffffff, ob.u, 0, ob.u * 2.7, 0, 1, 1, 1);
    },
    crate(ob) { crateBuild.call(this, ob, 0x8a5a3c, 0xa56d46); },
    stone(ob) {     // skull rock
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.46; ob.ht = 0.86;
      this._part(ob, 'ball', 0xeee2c8, u, 0.43, 0, 0, 0.92, 0.86, 0.92);
      this._part(ob, 'box', 0x2a1f1a, u - 0.2, 0.5, 0, 0, 0.2, 0.2, 0.1, 0, 0, 0.42); this._part(ob, 'box', 0x2a1f1a, u + 0.2, 0.5, 0, 0, 0.2, 0.2, 0.1, 0, 0, 0.42);
      this._part(ob, 'box', 0x2a1f1a, u, 0.24, 0, 0, 0.12, 0.16, 0.1, 0, 0, 0.44);
    },
    fallenLog(ob) { logBuild.call(this, ob, 0xd8c9a2, 0xe8dcc0); },
    fence(ob) { fenceBuild.call(this, ob, 0x8a5a33, 0xc9a36a); },
  },
  candy: {
    cabin(ob) {     // gingerbread house
      const u = ob.u, R = 0.55; ob.shape = 'box'; ob.hs = 1.5; ob.hu = 1.05; ob.ht = 2.6;
      this._part(ob, 'box', 0xb5733f, u, 0.9, 0, 0, 2.0, 1.8, 2.8);
      this._part(ob, 'box', 0xff7fb8, u - 0.58, 2.1, 0, -R, 1.35, 0.18, 3.1); this._part(ob, 'box', 0xff7fb8, u + 0.58, 2.1, 0, R, 1.35, 0.18, 3.1);
      this._part(ob, 'box', 0xffffff, u - 0.62, 2.2, 0, -R, 1.3, 0.12, 3.15); this._part(ob, 'box', 0xffffff, u + 0.62, 2.2, 0, R, 1.3, 0.12, 3.15);
      this._part(ob, 'box', 0x5a3318, u, 0.6, 0, 0, 0.6, 1.0, 0.06, 0, 0, 1.42);
      for (const [x, h, c] of [[-0.65, 1.3, 0x6aa8ff], [0.65, 1.3, 0xffe44a], [-0.65, 0.5, 0x45d98a], [0.65, 0.5, 0xff4fa3]]) this._part(ob, 'ball', c, u + x, h, 0, 0, 0.34, 0.34, 0.2, 0, 0, 1.4);
      this._part(ob, 'box', COL.red, u, 0.1, 0, 0, 2.1, 0.2, 0.1, 0, 0, 1.42);
    },
    snowman(ob) {   // lollipop
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.6; ob.ht = 2.2;
      this._part(ob, 'cyl', 0xff9ccb, u, 0.17, 0, 0, 1.2, 0.34, 1.2); this._part(ob, 'cyl', 0xffffff, u, 0.9, 0, 0, 0.24, 1.5, 0.24);
      this._part(ob, 'cyl', 0xff5fae, u, 1.62, PI / 2, PI / 2, 1.2, 0.22, 1.2); this._part(ob, 'cyl', 0xffffff, u, 1.62, PI / 2, PI / 2, 0.8, 0.25, 0.8);
      this._part(ob, 'cyl', 0xff5fae, u, 1.62, PI / 2, PI / 2, 0.4, 0.28, 0.4);
    },
    crate(ob) {     // jelly cube
      const n = ob.n || 1; ob.shape = 'box'; ob.hs = 0.6; ob.hu = 0.6; ob.ht = 1.1 * n;
      const cols = [0xff4fa3, 0x45d98a, 0xffb52e, 0x6aa8ff], c = cols[ob.id % cols.length];
      for (let k = 0; k < n; k++) this._part(ob, 'ice', c, ob.u, 0.55 + 1.1 * k, 0.1 * (k ? -1 : 1), 0, 1.1, 1.1, 1.1);
      this._part(ob, 'box', 0xffffff, ob.u, 0.05, 0, 0, 1.12, 0.1, 1.12);
    },
    stone(ob) {     // gumdrop
      const sc = ob.sc || 1, W = 1.25 * sc, H = 0.66 * sc; ob.shape = 'cyl'; ob.rad = 0.5 * W; ob.ht = H;
      this._part(ob, 'dome', STONE_TINT.candy, ob.u, 0, 0, 0, W, H * 2, W); this._part(ob, 'ball', 0xffffff, ob.u, H * 0.9, 0, 0, 0.22, 0.12, 0.22);
    },
    fallenLog(ob) { // candy cane lying across the lane
      logBuild.call(this, ob, 0xff4a6b, 0xffffff);
      for (let x = ob.uMin + 0.7; x < ob.uMax - 0.3; x += 1.2) this._part(ob, 'cyl', 0xffffff, x, 0.42, 0, PI / 2, 0.88, 0.32, 0.88);
    },
    fence(ob) { fenceBuild.call(this, ob, 0xff6fb5, 0xffffff); },
  },
  neon: {
    snowman(ob) {   // laser post
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.4; ob.ht = 2.4;
      this._part(ob, 'cyl', 0x1b1830, u, 1.2, 0, 0, 0.8, 2.4, 0.8);
      for (const h of [0.5, 1.1, 1.7]) this._part(ob, 'disc', 0x00e5ff, u, h, 0, 0, 0.86, 1.6, 0.86);
      this._part(ob, 'lamp', 0xff2bd6, u, 2.45, 0, 0, 0.6, 0.6, 0.6);
    },
    crate(ob) {     // data cube
      const u = ob.u, n = ob.n || 1; ob.shape = 'box'; ob.hs = 0.6; ob.hu = 0.6; ob.ht = 1.1 * n;
      for (let k = 0; k < n; k++) {
        this._part(ob, 'box', 0x1b1830, u, 0.55 + 1.1 * k, 0, 0, 1.1, 1.1, 1.1); this._part(ob, 'beam', 0x00e5ff, u, 1.12 + 1.1 * k, 0, 0, 1.12, 0.06, 1.12);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._part(ob, 'beam', 0xff2bd6, u + sx * 0.55, 0.55 + 1.1 * k, 0, 0, 0.06, 1.1, 0.06, 0, 0, sz * 0.55);
      }
    },
    rock(ob) {      // dark monolith with glowing strips
      const u = ob.u; ob.shape = 'box'; ob.hs = 0.85; ob.hu = 1.1; ob.ht = 2.3;
      this._part(ob, 'box', 0x241a4a, u, 1.15, 0, 0, 2.2, 2.3, 1.7);
      this._part(ob, 'beam', 0xff2bd6, u - 0.55, 1.15, 0, 0, 0.1, 2.0, 0.06, 0, 0, 0.86); this._part(ob, 'beam', 0xff2bd6, u + 0.55, 1.15, 0, 0, 0.1, 2.0, 0.06, 0, 0, 0.86);
      this._part(ob, 'box', COL.dark, u, 2.85, 0, 0, 0.07, 1.1, 0.07); this._part(ob, 'box', COL.red, u + 0.27, 3.2, 0, 0, 0.52, 0.34, 0.04);
      this._part(ob, 'box', 0xffffff, u + 0.27, 3.2, 0, 0, 0.52, 0.11, 0.05);
    },
    cabin(ob) {
      const u = ob.u; ob.shape = 'box'; ob.hs = 1.5; ob.hu = 1.05; ob.ht = 2.6;
      this._part(ob, 'box', 0x1b1830, u, 1.3, 0, 0, 2.1, 2.6, 2.9);
      this._part(ob, 'beam', 0x00e5ff, u, 1.5, 0, 0, 1.5, 0.7, 0.06, 0, 0, 1.46); this._part(ob, 'beam', 0xff2bd6, u, 2.6, 0, 0, 2.12, 0.08, 2.92);
      this._part(ob, 'box', COL.red, u, 0.1, 0, 0, 2.12, 0.2, 0.1, 0, 0, 1.46);
    },
    fallenLog(ob) { // low laser bar
      const len = ob.uMax - ob.uMin, uc = (ob.uMax + ob.uMin) / 2; ob.hu = len / 2; ob.u = uc; ob.hs = 0.3; ob.ht = 0.85;
      this._part(ob, 'box', 0x1b1830, ob.uMin + 0.15, 0.42, 0, 0, 0.3, 0.85, 0.3); this._part(ob, 'box', 0x1b1830, ob.uMax - 0.15, 0.42, 0, 0, 0.3, 0.85, 0.3);
      this._part(ob, 'beam', 0x00e5ff, uc, 0.55, 0, 0, len, 0.16, 0.16); this._part(ob, 'beam', 0xff2bd6, uc, 0.3, 0, 0, len, 0.08, 0.08);
    },
    fence(ob) { fenceBuild.call(this, ob, 0x1b1830, 0x00e5ff); },
  },
  volcano: {
    sled(ob) {      // minecart full of glowing ore
      const u = ob.u; ob.shape = 'box'; ob.hs = 1.0; ob.hu = 0.65; ob.ht = 1.3;
      this._part(ob, 'box', 0x2a2230, u, 0.55, 0, 0, 1.3, 0.8, 1.9); this._part(ob, 'box', 0x4a3a44, u, 0.98, 0, 0, 1.4, 0.1, 2.0);
      for (const [x, z] of [[-0.3, -0.3], [0.3, 0.2], [0, 0.55]]) this._part(ob, 'lamp', 0xff8a2a, u + x, 1.12, 0, 0, 0.5, 0.4, 0.5, 0, 0, z);
      for (const sx of [-1, 1]) this._part(ob, 'cyl', 0x1a1620, u + sx * 0.7, 0.26, 0, PI / 2, 0.5, 0.14, 0.5);
    },
    logpile(ob) {   // obsidian rubble with a glowing crack
      const u = ob.u; ob.shape = 'box'; ob.hs = 0.9; ob.hu = 1.0; ob.ht = 1.4;
      this._part(ob, 'rockS2', 0x3b2f33, u - 0.5, 0, 1.1, 0, 1.4, 0.9, 1.3, 0, 0, -0.3); this._part(ob, 'rockS', 0x4a3a40, u + 0.5, 0, 2.4, 0, 1.3, 1.0, 1.2, 0, 0, 0.25);
      this._part(ob, 'rockS2', 0x33282c, u, 0, 0.3, 0, 1.2, 1.4, 1.1); this._part(ob, 'lamp', 0xff7a1a, u, 0.55, 0, 0, 0.35, 0.12, 0.6, 0, 0, 0.55);
    },
    cabin(ob) {     // obsidian hut with a lava door
      const u = ob.u; ob.shape = 'box'; ob.hs = 1.5; ob.hu = 1.05; ob.ht = 2.5;
      this._part(ob, 'box', 0x2b1f3a, u, 1.1, 0, 0, 2.1, 2.2, 2.9); this._part(ob, 'box', 0x3a2a4a, u, 2.35, 0, 0, 2.2, 0.3, 3.0);
      this._part(ob, 'beam', 0xff7a1a, u, 0.8, 0, 0, 0.7, 1.2, 0.06, 0, 0, 1.46);
      for (const sx of [-1, 1]) this._part(ob, 'beam', 0xff7a1a, u + sx * 0.7, 1.9, 0, 0, 0.5, 0.06, 0.06, 0, 0, 1.46);
      this._part(ob, 'box', COL.red, u, 0.1, 0, 0, 2.1, 0.2, 0.1, 0, 0, 1.46);
    },
    snowman(ob) {   // lava pillar
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.5; ob.ht = 2.1;
      this._part(ob, 'cyl', 0x3a2a26, u, 1.0, 0, 0, 1.0, 2.0, 1.0);
      for (const h of [0.6, 1.2, 1.7]) this._part(ob, 'disc', 0xff7a1a, u, h, 0, 0, 1.04, 1.4, 1.04);
      this._part(ob, 'lamp', 0xffa23a, u, 2.2, 0, 0, 0.7, 0.9, 0.7);
    },
    crate(ob) {     // obsidian block with glowing cracks
      const n = ob.n || 1; ob.shape = 'box'; ob.hs = 0.6; ob.hu = 0.6; ob.ht = 1.1 * n;
      for (let k = 0; k < n; k++) { this._part(ob, 'box', 0x2b1f3a, ob.u, 0.55 + 1.1 * k, 0.1 * (k ? -1 : 1), 0, 1.1, 1.1, 1.1); this._part(ob, 'beam', 0xff7a1a, ob.u, 0.9 + 1.1 * k, 0, 0, 0.9, 0.07, 0.07, 0, 0, 0.56); }
    },
    stone(ob) {     // ember rock
      smallRock.call(this, ob); this._part(ob, 'lamp', 0xff8a2a, ob.u + 0.12, ob.ht * 0.85, 0, 0, 0.26, 0.2, 0.26);
    },
    fallenLog(ob) { logBuild.call(this, ob, 0x2a211f, 0x3a2f2b); for (let x = ob.uMin + 0.6; x < ob.uMax - 0.4; x += 1.6) this._part(ob, 'lamp', 0xff7a1a, x, 0.78, 0, 0, 0.2, 0.12, 0.3); },
    fence(ob) { fenceBuild.call(this, ob, 0x2a211f, 0x4a3a33); },
  },
  ice: {
    sled(ob) {      // seal sunbathing on the ice (looks at you)
      const u = ob.u; ob.shape = 'box'; ob.hs = 1.0; ob.hu = 0.6; ob.ht = 1.0;
      this._part(ob, 'ball', 0x6f7f9e, u, 0.42, 0, 0, 1.1, 0.84, 2.1); this._part(ob, 'ball', 0xb4c0d6, u, 0.34, 0, 0, 0.8, 0.5, 1.6, 0, 0, 0.05);
      this._part(ob, 'ball', 0x6f7f9e, u, 0.7, 0, 0, 0.56, 0.5, 0.56, 0, 0, 0.9);
      for (const sx of [-1, 1]) this._part(ob, 'ball', 0x14161c, u + sx * 0.14, 0.78, 0, 0, 0.1, 0.1, 0.1, 0, 0, 1.15);
      this._part(ob, 'ball', 0x14161c, u, 0.66, 0, 0, 0.16, 0.12, 0.12, 0, 0, 1.19);
      for (const sx of [-1, 1]) this._part(ob, 'box', 0x5a6a88, u + sx * 0.3, 0.12, 0, 0, 0.4, 0.1, 0.5, 0, 0, -1.05);       // tail flippers
    },
    pine(ob) {      // ice stalagmite
      const sc = ob.sc || 1; ob.shape = 'cyl'; ob.rad = 0.8 * sc; ob.ht = 4.7 * sc;
      this._part(ob, 'cone', 0x8fd4ff, ob.u, 0, ob.u * 2.1, 0, 1.6 * sc, 4.7 * sc, 1.6 * sc);
      this._part(ob, 'cone', 0xdff6ff, ob.u + 0.42 * sc, 0, 0.7, 0, 0.62 * sc, 2.6 * sc, 0.62 * sc); this._part(ob, 'cone', 0xb8e6ff, ob.u - 0.4 * sc, 0, 1.9, 0, 0.55 * sc, 2.0 * sc, 0.55 * sc);
    },
    snowman(ob) {   // ice crystal pillar
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.5; ob.ht = 2.3;
      this._part(ob, 'cyl', 0x4a90c8, u, 0.2, 0, 0, 1.0, 0.4, 1.0); this._part(ob, 'cyl', 0x7fd0ff, u, 1.0, 0, 0, 0.9, 1.6, 0.9); this._part(ob, 'cone', 0xd8f4ff, u, 1.8, 0, 0, 0.9, 0.5, 0.9);
    },
    crate(ob) {     // translucent ice block
      const n = ob.n || 1; ob.shape = 'box'; ob.hs = 0.6; ob.hu = 0.6; ob.ht = 1.1 * n;
      for (let k = 0; k < n; k++) this._part(ob, 'ice', 0x4aa8ec, ob.u, 0.55 + 1.1 * k, 0.1 * (k ? -1 : 1), 0, 1.1, 1.1, 1.1);
      this._part(ob, 'box', 0xe8f8ff, ob.u, 0.05, 0, 0, 1.14, 0.1, 1.14);
    },
    cabin(ob) {     // igloo
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 1.35; ob.ht = 1.7;
      this._part(ob, 'dome', 0xd8ecff, u, 0, 0, 0, 2.7, 3.4, 2.7); this._part(ob, 'box', COL.dark, u, 0.5, 0, 0, 0.9, 0.9, 0.2, 0, 0, 1.28);
    },
    fallenLog(ob) { logBuild.call(this, ob, 0x5fb4f0, 0x9fe0ff); },
    fence(ob) { fenceBuild.call(this, ob, 0x6fc4f4, 0xcdefff); },
  },
  moon: {
    snowman(ob) {   // fuel tank
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.5; ob.ht = 1.9;
      this._part(ob, 'cyl', 0xcfd2d8, u, 0.8, 0, 0, 1.0, 1.6, 1.0); this._part(ob, 'cyl', 0xff7a1a, u, 0.9, 0, 0, 1.04, 0.3, 1.04); this._part(ob, 'dome', 0xe6e8ee, u, 1.6, 0, 0, 1.0, 0.6, 1.0);
    },
    crate(ob) { crateBuild.call(this, ob, 0xd5d8de, 0xb8bcc6); this._part(ob, 'box', 0xff7a1a, ob.u, 0.55, 0, 0, 1.12, 0.2, 1.12); },
    cabin(ob) {     // habitat dome
      const u = ob.u; ob.shape = 'cyl'; ob.rad = 1.3; ob.ht = 1.6;
      this._part(ob, 'dome', 0xe8eaf0, u, 0, 0, 0, 2.6, 3.2, 2.6); this._part(ob, 'box', 0x2a3a58, u, 0.5, 0, 0, 0.8, 0.9, 0.2, 0, 0, 1.2);
    },
    fallenLog(ob) { const len = ob.uMax - ob.uMin, uc = (ob.uMax + ob.uMin) / 2; ob.hu = len / 2; ob.u = uc; ob.hs = 0.6; ob.ht = 0.85; this._part(ob, 'rockS', 0x80808a, uc, 0, 0, 0, len, 0.85, 1.2); },
    fence(ob) { fenceBuild.call(this, ob, 0xd5d8de, 0xff7a1a); },
  },
};

function sledParts(ob, du) {
  const u = (ob.cu !== undefined ? ob.cu : ob.u) + du, c = ob.color || COL.red;
  const mk = (key, hex, ou, h, sx, sy, sz, oz = 0, f = null) => { const p = this._part(ob, key, hex, u + ou, h, 0, 0, sx, sy, sz, 0, 0, oz, f); p.du = ou; return p; };
  mk('box', c, 0, 0.55, 0.95, 0.55, 1.9); mk('box', COL.dark, 0, 0.95, 0.5, 0.2, 0.8, 0.15); mk('box', 0x9fd8ff, 0, 1.05, 0.7, 0.45, 0.06, -0.55);
  mk('box', COL.dark, -0.42, 0.08, 0.14, 0.08, 1.95); mk('box', COL.dark, 0.42, 0.08, 0.14, 0.08, 1.95); mk('box', COL.dark, 0, 1.0, 0.85, 0.08, 0.08, -0.45);
}

KIND.static = {
  build(ob) {
    const d = (ob.def = DEFS[ob.type]);
    ob.tough = d.tough; ob.color = d.color; ob.ht = d.ht; ob.rad = d.rad; ob.hs = d.hs; ob.hu = d.hu; ob.shape = d.shape; ob.lethal = !!d.lethal;
    ob.hc = d.ht * 0.5; ob.cs = ob.s; ob.cu = ob.u;
    const sk = ob.skin && SK[ob.skin] && SK[ob.skin][ob.type];
    (sk || d.build).call(this, ob);
    ob.cu = ob.u; ob.hc = ob.ht * 0.5;
    this._ground(ob, d);
    if (this._smashTier !== undefined) this._tintSmash(ob, this._smashTier + 1 >= ob.tough + 2);
  },
  hit(ob, ball, events) {
    const cyl = ob.shape === 'cyl';
    this._pass(ob, ball, events, ob.s, ob.u, cyl ? ob.rad : ob.hs, cyl ? ob.rad : ob.hu, ob.ht);
    const H = cyl ? this._cyl(ball, ob.s, ob.u, ob.rad, ob.ht)
      : this._aabb(ball, ob.s - ob.hs, ob.s + ob.hs, ob.u - ob.hu, ob.u + ob.hu, 0, ob.ht);
    if (H && (H.ds !== 0 || H.du !== 0)) this._hit(ob, ball, events, H.ds, H.du);
  },
};


// moving blockers: lane-hopping skier / snowmobile, rolling log
KIND.moving = {
  build(ob) {
    ob.fm = new Float64Array(12);
    ob.cs = ob.s; ob.cu = ob.u;
    if (ob.type === 'skier') {
      ob.tough = 1; ob.color = ob.suit; ob.ht = 1.8; ob.rad = 0.45; ob.hc = 0.9;
      const mk = (key, hex, ou, h, sx, sy, sz, oz = 0) => { const p = this._part(ob, key, hex, ob.u + ou, h, 0, 0, sx, sy, sz, 0, 0, oz, ob.fm); p.du = ou; };
      mk('box', ob.suit, 0, 0.9, 0.4, 0.9, 0.3); mk('ball', 0xf2c9a0, 0, 1.55, 0.5, 0.5, 0.5); mk('box', COL.dark, -0.16, 0.05, 0.1, 0.05, 1.5); mk('box', COL.dark, 0.16, 0.05, 0.1, 0.05, 1.5);
      mk('box', COL.red, 0, 1.78, 0.45, 0.12, 0.45);
    } else if (ob.type === 'sled') {
      ob.tough = 2; ob.color = COL.red; ob.ht = 1.2; ob.hs = 1.0; ob.hu = 0.55; ob.hc = 0.6;
      sledParts.call(this, ob, 0);
      for (const p of ob.parts) p.f = ob.fm;
    } else {   // rolling log
      ob.tough = 3; ob.color = COL.wood2; ob.ht = 0.9; ob.hs = 0.45; ob.hu = 1.0; ob.hc = 0.45;
      const p = this._part(ob, 'cyl', COL.wood, ob.u, 0.45, 0, PI / 2, 0.9, 2.0, 0.9, 0, 0, 0, ob.fm); p.du = 0;
    }
  },
  anim(ob, b, pulse) {
    let cs = ob.s, cu = ob.u, k = 1, spin = 0;
    if (ob.type === 'rolling') {
      const x = b / ob.per + ob.ph, fr = x - Math.floor(x);
      cs = ob.s0 + fr * ob.L; cu = ob.u; k = smooth(fr / 0.05) * smooth((1 - fr) / 0.05);
      spin = (cs - ob.s0) / 0.45;
    } else {
      const x = b / ob.per + ob.ph, n = Math.floor(x), f = x - n;
      const a = LANES[(n & 1) ? ob.laneA : ob.laneB], c = LANES[(n & 1) ? ob.laneB : ob.laneA];
      cu = a + (c - a) * smooth(f / 0.35);
      ob.lean = (c - a) * (f < 0.35 ? Math.sin(f / 0.35 * PI) * 0.1 : 0);
    }
    ob.cs = cs; ob.cu = cu;
    if (ob.type === 'rolling' && k < 0.02) { ob.cs = -1e9; }
    this._frameInto(cs, ob.fm);
    for (const p of ob.parts) {
      if (p.idx < 0) continue;
      if (ob.type === 'rolling') this._repart(p, cu, p.h, 0, PI / 2, 0.9 * k, 2.0 * k, 0.9 * k, 0, 0, 0, spin, ob.fm);
      else this._repart(p, cu + p.du, p.h, 0, ob.lean || 0, p.sx, p.sy, p.sz, 0, 0, p.oz, 0, ob.fm);
    }
  },
  hit(ob, ball, events) {
    if (ob.cs < -1e8) return;
    this._pass(ob, ball, events, ob.cs, ob.cu, ob.type === 'skier' ? ob.rad : ob.hs, ob.type === 'skier' ? ob.rad : ob.hu, ob.ht);
    const H = ob.type === 'skier' ? this._cyl(ball, ob.cs, ob.cu, ob.rad, ob.ht)
      : this._aabb(ball, ob.cs - ob.hs, ob.cs + ob.hs, ob.cu - ob.hu, ob.cu + ob.hu, 0, ob.ht);
    if (H && (H.ds !== 0 || H.du !== 0)) this._hit(ob, ball, events, H.ds, H.du);
  },
};

// rotating snow-plow blade, pivot on the track edge (far lane always free). 'knock'
KIND.plow = {
  build(ob) {
    ob.hc = 0.6; ob.tough = 3; ob.color = 0xffc21a;
    ob.bar = this._part(ob, 'plow', 0xffffff, ob.u0, 0.62, 0, 0, ob.L + 0.8, 1.0, 0.3);
    this._part(ob, 'cyl', COL.dark, ob.u0, 0.7, 0, 0, 0.8, 1.4, 0.8);
  },
  anim(ob, b) {
    const th = TAU * b / ob.per + ob.phi, off = (ob.L - 0.8) / 2;
    this._repart(ob.bar, ob.u0, 0.62, th, 0, ob.L + 0.8, 1.0, 0.3, off, 0, 0);
    ob.th = th;
  },
  hit(ob, ball, events, t) {
    const th = ob.th, off = (ob.L - 0.8) / 2;
    if (!this._obb(ball, ob.u0 + Math.cos(th) * off, ob.s + Math.sin(th) * off, th, (ob.L + 0.8) / 2, 0.3, 0, 1.1)) return;
    const om = (TAU / ob.per) * (this.bpm / 60), vu = -om * (ball.s - ob.s);
    let du = clamp(vu * 0.85, -10, 10);
    if (Math.abs(du) < 3.5) du = (vu < 0 || (vu === 0 && ob.sigma > 0) ? -1 : 1) * 3.5;
    this._knock(events, ob, du, 1.2, 0.6 + 0.4 * Math.min(1, Math.abs(vu) / 10), t);
  },
};

// swinging log on ropes between two pines (hangs from a beam; pendulum across the track). 'knock'
KIND.swing = {
  build(ob) {
    ob.hc = 1.0; ob.tough = 3; ob.color = COL.wood;
    const hw = ob.hw + 0.3, H = ob.H;
    this._part(ob, 'pine', 0xffffff, -hw, 0, 0.5, 0, 1.1, 1.1, 1.1); this._part(ob, 'pine', 0xffffff, hw, 0, 2.1, 0, 1.1, 1.1, 1.1);
    this._part(ob, 'box', COL.wood2, 0, H + 0.1, 0, 0, hw * 2, 0.24, 0.24);
    ob.ropeA = this._part(ob, 'box', 0xd9c9a0, 0, H, 0, 0, 0.07, ob.Ls, 0.07, 0, -ob.Ls / 2, 0.8);
    ob.ropeB = this._part(ob, 'box', 0xd9c9a0, 0, H, 0, 0, 0.07, ob.Ls, 0.07, 0, -ob.Ls / 2, -0.8);
    ob.log = this._part(ob, 'cyl', COL.wood, 0, 0.6, PI / 2, PI / 2, 0.8, 2.2, 0.8);
  },
  anim(ob, b) {
    const w = TAU * b / ob.per, th = ob.amp * Math.sin(w);
    ob.hu = ob.Ls * Math.sin(th); ob.hh = ob.H - ob.Ls * Math.cos(th); ob.th = th;
    this._repart(ob.ropeA, 0, ob.H, 0, th, 0.07, ob.Ls, 0.07, 0, -ob.Ls / 2, 0.8);
    this._repart(ob.ropeB, 0, ob.H, 0, th, 0.07, ob.Ls, 0.07, 0, -ob.Ls / 2, -0.8);
    this._repart(ob.log, ob.hu, ob.hh, PI / 2, PI / 2, 0.8, 2.2, 0.8);
  },
  hit(ob, ball, events, t) {
    const ds = ball.s - ob.s, dx = ds - clamp(ds, -1.1, 1.1), du = ball.u - ob.hu, dh = ball.h - ob.hh, rr = ball.r + 0.42;
    if (dx * dx + du * du + dh * dh >= rr * rr) return;
    const thd = ob.amp * (TAU / ob.per) * Math.cos(TAU * this.beatF / ob.per) * (this.bpm / 60), vu = ob.Ls * Math.cos(ob.th) * thd;
    let push = clamp(vu, -14, 14);
    if (Math.abs(push) < 5) push = (vu !== 0 ? Math.sign(vu) : Math.sign(du) || 1) * 5;
    this._knock(events, ob, push, 1.6, 1, t, 0.6);
  },
};

// ice patch (no collision): emits {type:'ice'} while the ball slides on it
KIND.ice = {
  build(ob) {
    ob.hc = 0.05; ob.tough = 0; ob.color = COL.ice;
    for (const g of ob.groups) {
      const f = ob.f, w = g.uMax - g.uMin, uc = (g.uMax + g.uMin) / 2;
      this._part(ob, 'ice', COL.ice, uc, 0.03, 0, 0, w, 0.05, ob.len, 0, 0, 0, f);
    }
  },
  hit(ob, ball, events) {
    if (ball.h - ball.r > 0.45 || Math.abs(ball.s - ob.s) > ob.len / 2) return;
    for (const g of ob.groups) if (ball.u > g.uMin - 0.2 && ball.u < g.uMax + 0.2) { ev(events, 'ice'); return; }
  },
};

// hot patch (desert / lava biomes): emits {type:'melt', rate} while inside
KIND.melt = {
  build(ob) {
    ob.hc = 0.05; ob.tough = 0; ob.color = COL.melt;
    const rows = Math.max(2, Math.round(ob.len / 0.78));
    for (let r = 0; r < rows; r++) {
      const s = ob.s - ob.len / 2 + (r + 0.5) * (ob.len / rows), f = this._frameOf(s);
      for (const g of ob.groups) {
        const cols = Math.max(1, Math.round((g.uMax - g.uMin) / 0.9));
        for (let c = 0; c < cols; c++) {
          const u = g.uMin + ((c + 0.5 + (r & 1 ? 0.5 : 0)) * (g.uMax - g.uMin)) / cols;
          if (u > g.uMax) continue;
          this._part(ob, 'hex', COL.melt, u, 0.06, 0, 0, 1.0, 1, 1.0, 0, 0, 0, f, 0.8 + 0.4 * ((r * 7 + c * 3) % 5) / 4);
        }
      }
    }
  },
  hit(ob, ball, events) {
    if (ball.h - ball.r > 0.5 || Math.abs(ball.s - ob.s) > ob.len / 2) return;
    for (const g of ob.groups) if (ball.u > g.uMin && ball.u < g.uMax) { const e = ev(events, 'melt'); e.rate = ob.rate; return; }
  },
};

// boost / jump pads
KIND.pad = {
  build(ob) {
    ob.hc = 0.1; ob.tough = 0; ob.color = 0xffffff;
    if (ob.type === 'boost') {
      this._part(ob, 'box', COL.dark, ob.u, 0.04, 0, 0, 1.8, 0.08, 3.4);
      for (let k = -1; k <= 1; k++) this._part(ob, 'chev', ob.glow, ob.u, 0.1, 0, 0, 1.4, 1, 1.0, 0, 0, k * 1.0);
    } else {
      this._part(ob, 'cyl', COL.dark, ob.u, 0.1, 0, 0, 1.9, 0.2, 1.9);
      ob.top = this._part(ob, 'hex', ob.glow, ob.u, 0.24, 0, 0, 1.8, 1, 1.8);
    }
  },
  anim(ob, b, pulse) { if (ob.top) this._repart(ob.top, ob.u, 0.22 + 0.14 * pulse, 0, 0, 1.8, 1 + 2 * pulse, 1.8); },
  hit(ob, ball, events, t) {
    if (t < ob.cdUntil || ball.h - ball.r > 0.6) return;
    const half = ob.type === 'boost' ? 1.7 : 1.0, wid = ob.type === 'boost' ? 1.0 : 1.0;
    if (Math.abs(ball.s - ob.s) > half || Math.abs(ball.u - ob.u) > wid + ball.r * 0.3) return;
    ob.cdUntil = t + 0.8;
    const e = ev(events, 'pad');
    e.kind = ob.type; e.onBeat = Math.abs(this.phase) < 0.15 || this.phase > 0.85; e.power = 1;
  },
};

// portal: big glowing ring gate at the centre of a portal piece
KIND.portal = {
  build(ob) {
    ob.hc = 3.4; ob.tough = 0; ob.color = ob.glow; ob.fired = false;
    ob.r1 = this._part(ob, 'ring', ob.glow, 0, 3.45, 0, 0, 3.7, 3.7, 0.7);
    ob.r2 = this._part(ob, 'ring', 0xffffff, 0, 3.45, 0, 0, 2.9, 2.9, 0.4);
    this._part(ob, 'box', COL.dark, -3.6, 1.0, 0, 0, 0.6, 2.0, 0.6); this._part(ob, 'box', COL.dark, 3.6, 1.0, 0, 0, 0.6, 2.0, 0.6);
  },
  anim(ob, b, pulse) {
    const k = 1 + 0.05 * pulse;
    this._repart(ob.r1, 0, 3.45, 0, 0, 3.7 * k, 3.7 * k, 0.7);
    this._repart(ob.r2, 0, 3.45, 0, 0, 2.9 / k, 2.9 / k, 0.4);
  },
  hit(ob, ball, events) {
    if (ob.fired || ball.s < ob.s || ball.s - ob.s > 8) return;
    ob.fired = true;
    const e = ev(events, 'portal');
    e.biome = ob.biome;
  },
};

// ---------------------------------------------------------------------------
// Spawning: ONE time-based row clock, difficulty budget, tension cycle, fairness rules; lane patterns, flake routes, snow trails, critters, pads, gems.
//   ROW CLOCK: rows sit on a single clock (this._clock = next row position, in metres) that carries across piece boundaries, so no piece is ever
//   empty. The gap between rows (seconds) comes from the budget d(s) = track.budget(s): ~0.6 rows/s at the start -> ~1.25 by 2 km -> ~1.5 by 4 km,
//   shaped by a tension cycle (~20 s build -> ~4 s breather with snow trails + flakes). The first 300 m are scripted teaching rows
//   (single block, low log, duck bar, one critter).
//   FAIRNESS: every row keeps a free route reachable at 0.25 s per lane change at the design speed (track.vGen); at most 3 hard rows in a row;
//   no two lethal rows in a row in the first km; never a jump / duck row within 0.62 s of the opposite verb.
// ---------------------------------------------------------------------------

// ---- new biome families (aurora / bamboo / glacier / carnival): same hit boxes as the base set, own looks
SK.aurora = {
  snowman(ob) {   // glowing aurora lantern post
    const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.5; ob.ht = 2.3;
    this._part(ob, 'cyl', 0x2a3a5a, u, 0.2, 0, 0, 1.0, 0.4, 1.0); this._part(ob, 'cyl', 0x1c2a44, u, 1.0, 0, 0, 0.22, 1.7, 0.22); this._part(ob, 'lamp', 0x5fffc0, u, 2.0, 0, 0, 0.8, 0.8, 0.8);
  },
  crate(ob) {     // frozen northern-lights crate
    const n = ob.n || 1; ob.shape = 'box'; ob.hs = 0.6; ob.hu = 0.6; ob.ht = 1.1 * n;
    for (let k = 0; k < n; k++) { this._part(ob, 'ice', 0x4a8ae0, ob.u, 0.55 + 1.1 * k, 0.1 * (k ? -1 : 1), 0, 1.1, 1.1, 1.1); this._part(ob, 'lamp', 0x5fffc0, ob.u, 0.55 + 1.1 * k, 0, 0, 0.4, 0.4, 0.4); }
    this._part(ob, 'box', 0xc8e6ff, ob.u, 0.05, 0, 0, 1.14, 0.1, 1.14);
  },
  pine(ob) {      // frosted teal spruce
    const sc = ob.sc || 1; ob.shape = 'cyl'; ob.rad = 0.8 * sc; ob.ht = 4.7 * sc;
    this._part(ob, 'cone', 0x2f9a8a, ob.u, 0, ob.u * 2.1, 0, 1.7 * sc, 4.7 * sc, 1.7 * sc); this._part(ob, 'cone', 0xcff8ee, ob.u, 2.2 * sc, 0, 0, 1.05 * sc, 2.4 * sc, 1.05 * sc);
  },
  fallenLog(ob) { logBuild.call(this, ob, 0x5a7ad0, 0x9fffe0); },
  fence(ob) { fenceBuild.call(this, ob, 0x3fd0a0, 0xcdf4ff); },
};
SK.bamboo = {
  snowman(ob) {   // mossy stone lantern
    const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.5; ob.ht = 2.1;
    this._part(ob, 'cyl', 0x7f8a80, u, 0.3, 0, 0, 0.9, 0.6, 0.9); this._part(ob, 'cyl', 0x8f9a90, u, 0.9, 0, 0, 0.4, 0.7, 0.4); this._part(ob, 'box', 0xb8c4b0, u, 1.45, 0, 0, 0.8, 0.5, 0.8);
    this._part(ob, 'lamp', 0xffd070, u, 1.45, 0, 0, 0.4, 0.3, 0.4); this._part(ob, 'cone', 0x5a7a50, u, 1.7, 0, 0, 1.2, 0.5, 1.2);
  },
  crate(ob) {     // bamboo bundle
    const n = ob.n || 1; ob.shape = 'box'; ob.hs = 0.6; ob.hu = 0.6; ob.ht = 1.1 * n;
    for (let k = 0; k < n; k++) for (const x of [-0.36, -0.12, 0.12, 0.36]) this._part(ob, 'cyl', k % 2 ? 0x9bd45a : 0x6fbf4a, ob.u + x, 0.55 + 1.1 * k, 0, 0, 0.26, 1.1, 0.26);
    this._part(ob, 'box', 0xe8d28a, ob.u, 0.35, 0, 0, 1.15, 0.08, 0.1, 0, 0, 0.3);
  },
  pine(ob) {      // bamboo clump
    const sc = ob.sc || 1; ob.shape = 'cyl'; ob.rad = 0.7 * sc; ob.ht = 4.6 * sc;
    for (const [x, z, h] of [[0, 0, 4.6], [0.4, 0.2, 3.8], [-0.35, 0.25, 4.1], [0.05, -0.4, 3.4]]) { this._part(ob, 'cyl', 0x62b845, ob.u + x * sc, h * sc / 2, 0, 0, 0.3 * sc, h * sc, 0.3 * sc, 0, 0, z * sc); this._part(ob, 'cyl', 0xb6e06a, ob.u + x * sc, h * sc * 0.55, 0, 0, 0.36 * sc, 0.08, 0.36 * sc, 0, 0, z * sc); }
  },
  fallenLog(ob) { logBuild.call(this, ob, 0x7ac84a, 0xd8f09a); },
  fence(ob) { fenceBuild.call(this, ob, 0x8cd05a, 0xd8e8a0); },
};
SK.glacier = {
  snowman(ob) {   // frozen knight statue
    const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.5; ob.ht = 2.4;
    this._part(ob, 'cyl', 0x3a7ac0, u, 0.2, 0, 0, 1.0, 0.4, 1.0); this._part(ob, 'ice', 0x7fd0ff, u, 1.0, 0, 0, 0.8, 1.2, 0.5); this._part(ob, 'ice', 0xa8e6ff, u, 1.85, 0, 0, 0.5, 0.5, 0.5); this._part(ob, 'cone', 0xe8fbff, u, 2.1, 0, 0, 0.5, 0.6, 0.5);
  },
  crate(ob) {     // royal ice block with a crown
    const n = ob.n || 1; ob.shape = 'box'; ob.hs = 0.6; ob.hu = 0.6; ob.ht = 1.1 * n;
    for (let k = 0; k < n; k++) this._part(ob, 'ice', 0x3a8ae8, ob.u, 0.55 + 1.1 * k, 0.1 * (k ? -1 : 1), 0, 1.1, 1.1, 1.1);
    for (const x of [-0.35, 0, 0.35]) this._part(ob, 'cone', 0xe8fbff, ob.u + x, 1.1 * n, 0, 0, 0.25, 0.4, 0.25);
  },
  pine(ob) {      // ice spire
    const sc = ob.sc || 1; ob.shape = 'cyl'; ob.rad = 0.8 * sc; ob.ht = 5.2 * sc;
    this._part(ob, 'cone', 0x4aa0f0, ob.u, 0, ob.u * 2.1, 0, 1.3 * sc, 5.2 * sc, 1.3 * sc); this._part(ob, 'cone', 0xcff4ff, ob.u + 0.5 * sc, 0, 0.5, 0, 0.6 * sc, 2.8 * sc, 0.6 * sc);
  },
  cabin(ob) {     // ice-castle turret
    const u = ob.u; ob.shape = 'cyl'; ob.rad = 1.3; ob.ht = 3.2;
    this._part(ob, 'cyl', 0x9ad8ff, u, 1.1, 0, 0, 2.4, 2.2, 2.4); this._part(ob, 'cone', 0x3a8ae8, u, 2.2, 0, 0, 2.7, 1.8, 2.7); this._part(ob, 'box', 0x1d3a6a, u, 0.6, 0, 0, 0.8, 1.0, 0.2, 0, 0, 1.2);
  },
  fallenLog(ob) { logBuild.call(this, ob, 0x6fc4f4, 0xe8fbff); },
  fence(ob) { fenceBuild.call(this, ob, 0x4a9ae8, 0xe0f6ff); },
};
SK.carnival = {
  snowman(ob) {   // balloon clown pole
    const u = ob.u; ob.shape = 'cyl'; ob.rad = 0.5; ob.ht = 2.4;
    this._part(ob, 'cyl', 0xffffff, u, 0.9, 0, 0, 0.2, 1.8, 0.2); this._part(ob, 'ball', 0xff3a6a, u, 1.9, 0, 0, 1.0, 1.1, 1.0); this._part(ob, 'ball', 0xffe03a, u + 0.2, 2.15, 0, 0, 0.5, 0.55, 0.5); this._part(ob, 'lamp', 0xffffff, u, 0.1, 0, 0, 0.5, 0.2, 0.5);
  },
  crate(ob) {     // striped prize box with a bulb
    const n = ob.n || 1; ob.shape = 'box'; ob.hs = 0.6; ob.hu = 0.6; ob.ht = 1.1 * n;
    for (let k = 0; k < n; k++) { this._part(ob, 'box', 0xff3a5a, ob.u, 0.55 + 1.1 * k, 0.1 * (k ? -1 : 1), 0, 1.1, 1.1, 1.1); this._part(ob, 'box', 0xffffff, ob.u, 0.55 + 1.1 * k, 0.1 * (k ? -1 : 1), 0, 1.12, 0.3, 1.12); }
    this._part(ob, 'lamp', 0xffe03a, ob.u, 1.1 * n + 0.1, 0, 0, 0.3, 0.3, 0.3);
  },
  pine(ob) {      // striped tent pole with lights
    const sc = ob.sc || 1; ob.shape = 'cyl'; ob.rad = 0.6 * sc; ob.ht = 4.4 * sc;
    this._part(ob, 'cyl', 0xffffff, ob.u, 2.0 * sc, 0, 0, 0.5 * sc, 4.0 * sc, 0.5 * sc);
    for (let k = 0; k < 4; k++) this._part(ob, 'cyl', 0xff3a5a, ob.u, (0.4 + k) * sc, 0, 0, 0.54 * sc, 0.5 * sc, 0.54 * sc);
    this._part(ob, 'cone', 0xffd23a, ob.u, 3.9 * sc, 0, 0, 1.2 * sc, 0.9 * sc, 1.2 * sc); this._part(ob, 'lamp', 0x7fe8ff, ob.u, 4.4 * sc, 0, 0, 0.4, 0.4, 0.4);
  },
  cabin(ob) {     // ticket booth
    const u = ob.u; ob.shape = 'box'; ob.hs = 1.2; ob.hu = 1.0; ob.ht = 2.6;
    this._part(ob, 'box', 0xff3a5a, u, 0.9, 0, 0, 2.0, 1.8, 2.4); this._part(ob, 'box', 0xffffff, u, 1.9, 0, 0, 2.2, 0.3, 2.6); this._part(ob, 'cone', 0xffd23a, u, 2.0, 0, 0, 1.8, 0.7, 1.8); this._part(ob, 'lamp', 0xfff0a0, u, 1.0, 0, 0, 0.9, 0.5, 0.1, 0, 0, 1.22);
  },
  fallenLog(ob) { logBuild.call(this, ob, 0xff3a5a, 0xffffff); },
  fence(ob) { fenceBuild.call(this, ob, 0xffd23a, 0xff3a8a); },
};

// [type, weight, min budget, biome families (null = all)]; rock / cabin are the lethal ones, their share is driven by lethalK(d)
const STATIC_W = [['snowman', 2.0, 0, null], ['sign', 1.2, 0, null], ['crate', 1.8, 0, null], ['stone', 0.45, 0, null],
  ['sled', 0.9, 0.1, { snow: 1, forest: 1, ice: 1, town: 1, desert: 1, volcano: 1, aurora: 1, glacier: 1 }], ['logpile', 0.9, 0.2, { snow: 1, forest: 1, volcano: 1, town: 1, bamboo: 1 }], ['pine', 1.1, 0.1, { snow: 1, forest: 1, ice: 1, aurora: 1, bamboo: 1, glacier: 1, carnival: 1 }],
  ['rock', 0.05, 0.3, null], ['cabin', 0.3, 0.3, null]];
const BIOME_IDS = ['snow', 'forest', 'greenhill', 'kapadokya', 'town', 'desert', 'icecave', 'candy', 'sakura', 'istanbul', 'neon', 'moon', 'pirate', 'volcano', 'aurora', 'bamboo', 'glacier', 'carnival'];   // same order as biomes.js
const POWERS = ['magnet', 'x2', 'superjump', 'rocket', 'helmet', 'timewarp', 'ghost', 'risk', 'clone', 'cannon'];
// zone multipliers of the row-pattern weights (default 1); the zone's own patterns also ignore the difficulty gate
const ZONE_OWN = { lasers: ['laser'], missiles: ['missile'], movers: ['mover', 'rolling'], boss: ['oncoming', 'rolling'] };
const ZONE_M = {
  lasers: { laser: 8, rest: 0.5, phrase: 0.4, _: 0.22 },
  missiles: { missile: 8, single: 0.6, low: 0.6, duck: 0.6, phrase: 0.4, _: 0.15 },
  movers: { mover: 6, rolling: 5, single: 0.4, phrase: 0.5, _: 0.2 },
  coinRain: { rest: 2, single: 0.5, _: 0.1 },
  boss: { oncoming: 4, rolling: 1.5, phrase: 0.8, _: 0.5 },
  storm: { rest: 1.2, phrase: 0.6, _: 0.35 },
};
const AIR_VH = 8.5;
let AIR_G = 28;      // set from track.gravity() at the start of every spawn() (moon = low gravity -> longer arcs)
const bit = (l) => 1 << l;
let NL = 3, FULL = 7; const ALLL = [0, 1, 2];     // lane count of the piece being generated / the ball's piece (see useLanes)
function useLanes(n) { n = setLanes(n); NL = n; FULL = (1 << n) - 1; ALLL.length = 0; for (let i = 0; i < n; i++) ALLL.push(i); return n; }

function wpick(rng, items, w) {      // items weighted by w(item) (<=0 excluded)
  let tot = 0;
  for (const it of items) tot += Math.max(0, w(it));
  if (tot <= 0) return null;
  let r = rng.next() * tot;
  for (const it of items) { r -= Math.max(0, w(it)); if (r <= 0) return it; }
  return items[items.length - 1];
}

const CYCLE_T = 24, BUILD_T = 20;      // tension cycle (s): build, then a 4 s breather
const LANE_T = 0.35;                   // reaction time per lane change (s) at the design speed
const PILES_PER_TIER = 6;              // piles that heal one size tier (runner: 4 / 6 / 8 / 11 by tier)
const rowRate = (s) => (0.56 + 0.8 * (1 - Math.exp(-s / 1900))) * (1 + 0.26 * smooth(s / 1500)) * (0.8 + 0.2 * smooth(s / 1100));     // design rows / s (hardness 1); x1.3 compensates the structural calm (breathers, junctions, hazard run-outs): measured ~0.65 @ 0.5 km, ~1.1 @ 2 km, ~1.4 @ 4 km
const tensionMul = (ph) => 1.22 - 0.38 * smooth(ph / BUILD_T);           // row gap multiplier over the build: calm 1.22 -> intense 0.84
const lethalK = (d) => (d < 0.18 ? 0 : 0.3 + 1.0 * smooth((d - 0.18) / 0.62));      // multiplier of the lethal blockers' weights (<= ~30% share)
const HARD_PAT = { double: 1, train: 1, mover: 1, rolling: 1, beat: 1, swing: 1, oncoming: 1, slide: 1, combo: 1, laser: 1, missile: 1, phrase: 1, turret: 1, pensled: 1 };
const LETHAL_KIND = { oncoming: 1, slidewall: 1, missile: 1 };
const SINGLE_VERB = { single: 1, low: 1, duck: 1, rest: 1 };            // round sections (loop, corkscrew, helix, half-pipe, tube): one verb per row
// first 20 s: something every ~2.5 s (was every ~3.5 s from the 5 s mark): a block at 3.5 s, a critter, a hurdle, a pad jump over a flake arc (~11 s), a parade to stomp, a BOOST strip (the first speed-rush, ~16 s), a duck bar
const TEACH = [{ s: 56, pat: 'single' }, { s: 96, pat: 'critter' }, { s: 132, pat: 'low' }, { s: 172, pat: 'pad' }, { s: 220, pat: 'parade' }, { s: 262, pat: 'boost' }, { s: 306, pat: 'duck' }];
const TEACH_END = 320;
// patterns that can never leave a free lane out of reach when the previous row is < 0.5 s behind (see _rows: tightRow)
const TIGHT_OK = ['single', 'low', 'duck', 'slide', 'swing', 'ice', 'conveyor', 'rail', 'rest', 'laser', 'critter', 'icegate'];
// a row that asks for a jump / duck (a jump needs ~0.6 s of air + landing: no jump or duck row may follow within that time)
const vertRow = (r) => r.jump === true || r.pat === 'duck' || (r.pat === 'laser' && r.free === FULL);

// Authored phrases: 2-4 rows 0.5-0.75 s apart, picked like a row pattern (weight w(diff), unlocked by min difficulty).
// ok(c) / build(c) get the row context built in _rows; a step is { t, g } with g = seconds to the next row (raised to the lane-swap time, see _rows) and
// t = 'blk' (single on lane, -1 = the route lane) | 'wall' (all lanes but `free`) | 'hurdle' (wall + low log on `lane`) | 'low' | 'duck' (full width) | 'train' (outer `lane`)
const PH_PAT = { blk: 'single', wall: 'double', hurdle: 'low', low: 'low', duck: 'duck', train: 'train' };      // row pattern a step stands for (coin arcs, stats)
const outerLane = (c) => c.prevRoute > 0 && c.prevRoute < NL - 1 ? (c.rng.chance(0.5) ? 0 : NL - 1) : c.prevRoute;
const PHRASES = [
  // zig-zag singles: each blocks the lane you are in, so every row is a swap
  { name: 'zigzag', min: 0.05, w: (d) => Math.max(0.4, 1.6 - 1.2 * d), ok: (c) => c.free0.length >= 2 && c.fit(3), build: (c) => {
    const st = [];
    for (let i = 0, n = c.diff > 0.45 ? 4 : 3; i < n; i++) st.push({ t: 'blk', lane: -1, g: 0.6 });
    return st;
  } },
  // two-lane walls whose gap flips between the outer lanes: two quick double swaps
  { name: 'switchback', min: 0.3, w: (d) => 1.0 + d, ok: (c) => c.open3 && c.fit(3), build: (c) => {
    const a = outerLane(c), st = [];
    for (let i = 0, n = c.diff > 0.55 ? 4 : 3; i < n; i++) st.push({ t: 'wall', free: i & 1 ? NL - 1 - a : a, g: 0.7 });
    return st;
  } },
  // jump, then duck right after the landing (+ another hurdle when hard)
  { name: 'lowDuck', min: 0.15, w: () => 1.2, ok: (c) => c.open3 && c.T.allows('duck') && !c.vq && c.fit(2), build: (c) => {
    const st = [{ t: 'low', g: 0.7 }, { t: 'duck', g: 0.7 }];
    if (c.diff > 0.55) st.push({ t: 'low', g: 0.6 });
    return st;
  } },
  // two-lane wall, then the free lane gets a hurdle: be in it and jump
  { name: 'wallGap', min: 0.25, w: () => 1.4, ok: (c) => c.open3 && c.fit(2), build: (c) => {
    const l = c.rng.int(0, NL - 1);
    return [{ t: 'wall', free: l, g: 0.6 }, { t: 'hurdle', lane: l, g: 0.6 }];
  } },
  // long train in an outer lane, then singles that keep swapping you between the two lanes beside it
  { name: 'trainSide', min: 0.3, w: () => 1.1, ok: (c) => c.open3 && c.persist.length === 0 && c.fit(3), build: (c) => {
    const st = [{ t: 'train', lane: c.rng.chance(0.5) ? 0 : NL - 1, g: 0.58 }];
    for (let i = 0, n = c.diff > 0.55 ? 3 : 2; i < n; i++) st.push({ t: 'blk', lane: -1, g: 0.58 });
    return st;
  } },
  // staircase: the free lane steps one lane per row (0,1,2 and back to the middle when hard)
  { name: 'stair', min: 0.2, w: () => 1.3, ok: (c) => c.open3 && c.fit(3), build: (c) => {
    const a = outerLane(c), st = [{ t: 'wall', free: a, g: 0.55 }, { t: 'wall', free: NL >> 1, g: 0.55 }, { t: 'wall', free: NL - 1 - a, g: 0.6 }];
    if (c.diff > 0.55) st.push({ t: 'wall', free: NL >> 1, g: 0.6 });
    return st;
  } },
  // hurdle train: 3-4 low logs one jump apart (0.75 s = flight + landing) — a Subway-style hop rhythm, the coin arcs over each log keep the beat
  { name: 'hopscotch', min: 0.1, w: () => 2.4, ok: (c) => c.open3 && !c.vq && c.fit(c.diff > 0.5 ? 4 : 3), build: (c) => {
    const st = [];
    for (let i = 0, n = c.diff > 0.5 ? 4 : 3; i < n; i++) st.push({ t: 'low', g: 0.75 });
    return st;
  } },
  // dodge, hop, dodge: a block in your lane, a log across all lanes, another block in the lane you landed in
  { name: 'dodgeHop', min: 0.2, w: () => 1.8, ok: (c) => c.open3 && !c.vq && c.fit(3), build: () => [{ t: 'blk', lane: -1, g: 0.7 }, { t: 'low', g: 0.8 }, { t: 'blk', lane: -1, g: 0.65 }] },
  // duck, weave, duck: two overhead bars with a lane swap between them
  { name: 'duckWeave', min: 0.25, w: () => 1.6, ok: (c) => c.open3 && c.T.allows('duck') && !c.vq && c.fit(3), build: () => [{ t: 'duck', g: 0.75 }, { t: 'blk', lane: -1, g: 0.65 }, { t: 'duck', g: 0.8 }] },
  // round 2 (hyper-casual variety, ids 10-13: duckTrain, hopSwitch, duckHurdle, zigStep): three overhead bars in a row, a duck beat to settle into (no lane swap at all)
  { name: 'duckTrain', min: 0.2, w: () => 2.4, ok: (c) => c.open3 && c.T.allows('duck') && !c.vq && c.fit(3), build: () => [{ t: 'duck', g: 0.78 }, { t: 'duck', g: 0.78 }, { t: 'duck', g: 0.78 }] },
  // two hurdle-walls whose gap is on opposite outer lanes: jump, swap two lanes in the air, jump again
  { name: 'hopSwitch', min: 0.3, w: () => 2.0, ok: (c) => c.open3 && !c.vq && c.fit(2), build: (c) => { const a = outerLane(c); return [{ t: 'hurdle', lane: a, g: 0.8 }, { t: 'hurdle', lane: NL - 1 - a, g: 0.9 }]; } },
  // duck, then a wall whose only gap holds a log: bar, swap, hop
  { name: 'duckHurdle', min: 0.15, w: () => 2.2, ok: (c) => c.open3 && c.T.allows('duck') && !c.vq && c.fit(2), build: (c) => [{ t: 'duck', g: 0.78 }, { t: 'hurdle', lane: outerLane(c), g: 0.85 }] },
  // easy early rhythm: block, an open wall with the gap in the middle (stay centred), block
  { name: 'zigStep', min: 0.1, w: (d) => Math.max(1.2, 3.2 - 3 * d), ok: (c) => c.open3 && c.fit(3), build: () => [{ t: 'blk', lane: -1, g: 0.62 }, { t: 'wall', free: NL >> 1, g: 0.62 }, { t: 'blk', lane: -1, g: 0.62 }] },
];

Object.assign(Obstacles.prototype, {
  // ----- creation helpers -----
  _mk(plan, ob) { this._addOb(ob); plan.batch.push(ob); if (LETHAL_KIND[ob.kind]) plan.rowLethal = true; return ob; },
  _static(plan, type, s, u, extra = {}) {
    const d = DEFS[type];
    if (d.lethal) plan.rowLethal = true;
    if (type === 'rock' || type === 'stone') plan.rowRock = true;
    return this._mk(plan, Object.assign({ kind: 'static', type, s, u, ext: d.ext, skin: plan.skin }, extra));
  },
  /** weighted blocker type for this row: biome family set, budget gates, lethal share (lethalK) and the "no lethal back to back" rule (plan.lethalOk) */
  _pickStatic(plan, allowedFn) {
    const d = plan.d ?? plan.diff, fam = plan.skin, lk = plan.lethalOk === false ? 0 : lethalK(d) * Math.min(2.2, 1 + 0.3 * (this.tierBias || 0));
    const e = wpick(plan.rng, STATIC_W, (x) => {
      if (d < x[2] || ((x[0] === 'rock' || x[0] === 'stone') && plan.rockOk === false) || (x[0] === 'rock' && plan.piece && plan.piece.s0 < 500) || !allowedFn(x[0]) || (x[3] && !x[3][fam])) return 0;
      return DEFS[x[0]].lethal ? x[1] * lk : x[1];
    });
    return (e || STATIC_W[0])[0];
  },
  _scaled(plan, type, s, lane) {
    const rng = plan.rng, sc = type === 'pine' || type === 'rock' ? rng.range(0.9, 1.15) : type === 'stone' ? rng.range(0.9, 1.2) : 1;
    const extra = { sc };
    if (type === 'crate') extra.n = rng.chance(0.35 + 0.4 * plan.diff) ? 2 : 1;
    return this._static(plan, type, s, LANES[lane], extra);
  },
  /** red warning disc under lethal blockers / soft contact shadow under the others (white-on-white fix: every blocker is anchored on the snow) */
  _ground(ob, d) {
    if (d.low) { this._part(ob, 'shadow', 0xffffff, ob.u, 0.025, 0, 0, ob.hu * 2 + 0.7, 1, 1.4); return; }
    const cyl = ob.shape === 'cyl', rx = cyl ? ob.rad : ob.hu, rz = cyl ? ob.rad : ob.hs;
    if (ob.lethal && this.track.level) this._part(ob, 'disc', 0xff3a2a, ob.u, 0.03, 0, 0, 2 * rx + 0.8, 1, 2 * rz + 0.8);
    else this._part(ob, 'shadow', 0xffffff, ob.u, 0.025, 0, 0, 2.5 * rx, 1, 2.5 * rz);
  },

  /**
   * One row of a phrase step (c = row context of _rows). Returns false (nothing placed) when the step no longer fits the lanes /
   * reach / persistent blockers; otherwise sets c.free / c.ext / c.jump like a row pattern does.
   */
  _phraseRow(plan, c, st) {
    const rng = plan.rng, s = c.s, f0 = c.free0;
    c.free = FULL; c.ext = 1.5; c.jump = false;
    const open = (l) => f0.indexOf(l) >= 0;
    switch (st.t) {
      case 'blk': {
        let l = st.lane < 0 ? c.prevRoute : st.lane;
        if (!open(l) || !(c.rm & ~bit(l))) l = f0.find((q) => c.rm & ~bit(q));
        if (l === undefined) return false;
        const type = this._pickStatic(plan, () => true);
        this._scaled(plan, type, s, l);
        c.free = FULL & ~bit(l); c.ext = DEFS[type].ext;
        return true;
      }
      case 'wall': case 'hurdle': {
        const f = st.t === 'wall' ? st.free : st.lane, lanes = ALLL.filter((l) => l !== f);
        if (!(c.rm & bit(f)) || !lanes.every(open)) return false;
        for (const l of lanes) this._scaled(plan, this._pickStatic(plan, (t) => t !== 'cabin' && t !== 'rock' && t !== 'stone'), s + rng.range(-0.6, 0.6), l);
        if (st.t === 'hurdle') { this._static(plan, rng.chance(0.65) ? 'fallenLog' : 'fence', s, 0, { uMin: LANES[f] - 1.2, uMax: LANES[f] + 1.2 }); c.jump = true; }
        c.free = bit(f); c.ext = 2;
        return true;
      }
      case 'low': {
        if (f0.length < NL) return false;
        this._static(plan, rng.chance(0.65) ? 'fallenLog' : 'fence', s, 0, { uMin: LANES[0] - 1.2, uMax: LANES[NL - 1] + 1.2 });
        c.free = 0; c.jump = true; c.ext = 1.2;
        return true;
      }
      case 'duck':
        this._mk(plan, { kind: 'overhead', s, lo: 0, hi: 2, hb: rng.range(1.0, 1.5), u: 0, ext: 2.4, glow: this._pal(s).glow });
        return true;
      case 'train': {
        const l = st.lane, L = Math.min(rng.int(16, 24), Math.floor(c.room - 6));
        if (L < 12 || !open(l) || !(c.rm & ~bit(l)) || c.persist.length || s + L + 4 > c.lim) return false;
        this._static(plan, plan.lethalOk !== false && rng.chance(0.6) ? 'snowcat' : 'longLogs', s + L / 2, LANES[l], { L, ext: L / 2 + 1.5 });
        c.persist.push({ lane: l, s0: s, s1: s + L });
        c.free = FULL & ~bit(l); c.ext = L + 1;      // route transitions begin after the train
        return true;
      }
    }
    return false;
  },

  // ----- row patterns on the row clock -----
  /**
   * Place rows in [sA, sB]. o: { dens (row density multiplier, curves 0.7 / round sections 0.6), allowed (lane list), only (pattern whitelist: SINGLE_VERB),
   * dense, okAt(s) (false = no row at s: loop top, rolled corkscrew), clear [[a,b]...] (no rows inside: junction windows) }.
   * The clock (this._clock) is the next row position; it carries over to the next piece (no piece restarts the rhythm, no empty pieces).
   */
  _rows(plan, sA, sB, o = {}) {
    const { rng, piece } = plan, T = this.track, hk = this.hk();
    const dens = (o.dens || 1) * (plan.chap && plan.chap.def.dens || 1), allowed = o.allowed || ALLL.slice(), only = o.only || null, okAt = o.okAt || null, clear = o.clear || null, dense = !!o.dense;
    // hardEnd: nothing may outlive sB (the junction approach; the piece before a junction): no trains / critter parades / volleys run on into the corner window
    const hardEnd = !!o.hardEnd || (!!T._juncDue && piece.kind !== 'junction' && T._juncDue(piece.s1));
    const rows = plan.rows, persist = [], carry = this._carry, F = T.features || {};
    const amask = allowed.reduce((m, l) => m | bit(l), 0);
    const cyc = !T.level && F.tension !== false;                                  // tension cycle: endless runs only
    const cycT0 = cyc ? T.timeAt(TEACH_END) : 0;                                  // (design time of the end of the teaching stretch = phase 0 of the cycle)
    const phOn = !only && (!T.level || F.phrases === true) && F.phrases !== false;  // authored phrases: campaign levels opt in with features.phrases
    const c = { rng, diff: 0, T, persist, s: 0, vs: 0, free0: null, rm: 0, room: 0, lim: 0, prevRoute: 0, open3: false, plain: false, vq: false, free: FULL, ext: 1.5, jump: false,
      fit: (n) => c.plain || (n - 1) * (c.vs * 0.65 + 2.5) <= c.room - 2 };   // row context for phrases (fit: a phrase of n rows fits in this piece or flows into a plain next one)
    let prevRoute = allowed.indexOf(NL >> 1) >= 0 ? NL >> 1 : allowed[0], lastRest = false, ph = null;
    let s = Math.max(sA, this._clock || 0);
    if (!T.level && s < TEACH_END && !o.teach) s = TEACH_END;                    // the first 300 m hold only the scripted teaching rows (_teachRows)
    if (carry) {
      // continue the previous piece's rhythm: persistent blockers and route lane carry over; the clock already holds the spacing
      for (const p of carry.persist) if (p.s1 + 60 > sA) persist.push(p);
      if (allowed.indexOf(carry.route) >= 0) prevRoute = carry.route;
      if (carry.ph && phOn && s <= carry.s + T.speedAt(sA) * carry.ph.g * 1.35 + 6) ph = carry.ph;     // a phrase cut by the piece boundary resumes at its own spacing
    }
    const inAllowed = (l) => allowed.indexOf(l) >= 0;
    let guard = 0;
    while (s < sB && guard++ < 600) {
      const vs = T.speedAt(s), vd = T.vGen ? T.vGen(s) : 1.1 * vs, late = s * hk > 4000;
      const diff = T.budget ? T.budget(s) : (piece.diff || 0);               // ONE smooth budget d(s) drives everything
      plan.diff = diff; plan.d = diff; c.diff = diff;
      if (clear) {
        let j = false;
        for (const r of clear) if (s > r[0] - 0.01 && s < r[1]) { s = r[1]; j = true; }
        if (j) { ph = null; continue; }
      }
      if (okAt && !okAt(s)) { s += 2.5; ph = null; continue; }
      let tn = 1;
      if (cyc) {
        const phs = (((T.timeAt(s) - cycT0) % CYCLE_T) + CYCLE_T) % CYCLE_T;     // the first cycle starts where the teaching rows end: calm -> build -> breather
        if (phs >= BUILD_T) {
          // breather: no rows for ~4 s (snow trail + flakes are laid into it by _trails)
          const bEnd = s + (CYCLE_T - phs) * vs, b = this._breath;
          this._breath = b && b.b > s - 1 ? { a: b.a, b: bEnd } : { a: s, b: bEnd };
          if (this.breathLog && !(b && b.b > s - 1)) this.breathLog.push(this._breath);       // (debug / harness: one entry per breather)
          s = bEnd; ph = null; continue;
        }
        tn = tensionMul(phs);
      }
      let tm = 0, tmHard = 0;
      for (const p of persist) {
        if (s < p.s0 - 3 || s > p.s1 + vs * 0.9) continue;
        tm |= bit(p.lane);
        if (!(p.mm && s > p.mm + 6)) tmHard |= bit(p.lane);      // a missile that already hit only keeps its lane off-limits for new rows; it no longer stops a new volley
      }
      const free0 = allowed.filter((l) => !(tm & bit(l)));         // lanes not occupied by persistent blockers
      if (free0.length === 0) { s += vs * 1.2; continue; }
      const room = sB - s;
      const open3 = free0.length === NL;
      const prevFree = rows.length ? rows[rows.length - 1].free : carry ? carry.free : FULL;
      // fairness: lanes reachable from the route lane before this row (0.25 s per lane change at the DESIGN speed);
      // a "tight" row may then only use patterns that cannot hide the last reachable lane (TIGHT_OK)
      const lastR = rows.length ? rows[rows.length - 1] : carry, gapT = lastR ? (s - 1.5 - lastR.s - Math.min(lastR.ext, 3)) / vd : 9;
      const reach = gapT >= 2 * LANE_T ? 2 : gapT >= LANE_T ? 1 : 0;
      let rm = 0, f0m = 0;
      for (const l of free0) { f0m |= bit(l); if (Math.abs(l - prevRoute) <= reach) rm |= bit(l); }
      if (!rm) rm = f0m;
      const tightRow = rm !== f0m, vq = lastR && vertRow(lastR) && (s - lastR.s) / vs < 0.62;
      const hardN = (lastR && lastR.hardN) || 0;
      plan.lethalOk = !o.noLethal && !gustAt(s, 50) && diff >= 0.18 && !(lastR && lastR.lethal && s < 2500) && hardN < 2 && !(lastR && lastR.lethal && (s - lastR.s) / vs < 1.6);   // no two lethal rows in a row in the first km, none after 3 hard rows (never in round sections)
      plan.rowLethal = false; plan.rowRock = false;
      const pats = ['single', 'double', 'low', 'train', 'mover', 'rolling', 'beat', 'swing', 'ice', 'melt', 'conveyor', 'rail', 'oncoming', 'duck', 'slide', 'combo', 'laser', 'missile', 'phrase', 'critter', 'icegate', 'turret', 'pensled', 'rest'];
      const nk0 = T._q && T._q[0], forcedNext = hardEnd || nk0 === 'narrow' || nk0 === 'split' || nk0 === 'hexHoles' || nk0 === 'gapRamp' || nk0 === 'gapJump' || nk0 === 'skiJump' || nk0 === 'chasm' || nk0 === 'iceBridge' || nk0 === 'zipline' || nk0 === 'loop' || nk0 === 'finish';
      const nk1 = T._q && T._q[1], isForced = (k) => k === 'narrow' || k === 'split' || k === 'hexHoles' || k === 'gapRamp' || k === 'gapJump' || k === 'skiJump' || k === 'chasm' || k === 'iceBridge' || k === 'zipline' || k === 'loop' || k === 'finish';
      // persistent blockers (trains, missiles, rolling logs) must end before a lane-forcing piece starts: sB when it is next, the end of this piece when it is the one after
      const lim = forcedNext ? sB : isForced(nk1) ? piece.s1 : Infinity;
      // missiles: the volley (contact ~2 s ahead) must be over before the run-in of a lane-forcing piece (~40 m per piece)
      const limM = forcedNext ? sB : isForced(nk1) ? piece.s1 : isForced(T._q && T._q[2]) ? piece.s1 + 40 : Infinity;
      const adj = free0.length === NL || (free0.length === 2 && Math.abs(free0[0] - free0[1]) === 1);
      // ROCKS (small stone / big boulder): one lane only, never in consecutive rows, >= 2.5 s apart, never near hard / slide / ice / junction / forced pieces
      const RK_BAN = { oncoming: 1, slide: 1, combo: 1, ice: 1, melt: 1, conveyor: 1, rail: 1, missile: 1, laser: 1 };
      const rockNear = !!(lastR && (lastR.rock || RK_BAN[lastR.pat]) && (s - lastR.s) / vs < 2.0);
      plan.rockOk = s >= 800 && !!plan.piece && plan.piece.kind === 'straight' && s - plan.piece.s0 > Math.max(30, vs * 2) && !hardEnd && !forcedNext && !o.firstOnly && !o.noLethal && !plan.zone && free0.length >= 2 && !tightRow && !rockNear && !(lastR && lastR.hard && (s - lastR.s) / vs < 2.0)
        && (s - (this._lastRockS === undefined ? -1e9 : this._lastRockS)) / vs >= 8 && !this._forcedStretch(s - vs * 2, s + vs * 2);
      const zone = plan.zone, cdf = plan.chap ? plan.chap.def : null, zmap = zone ? ZONE_M[zone] : cdf && cdf.pat || null, zown = zone ? ZONE_OWN[zone] : cdf && cdf.own || null;
      const split2 = (tm & bit(NL >> 1)) !== 0;            // a persistent blocker in the middle lane splits the track: only jump / duck / floor patterns then
      const wantCrit = s >= this._nextCrit && !only && F.critters !== false && T.allows('critters') && this.critters && room > 30 && free0.length >= 2 && !tightRow && !zone;
      const onlyNow = !rows.length && o.firstOnly ? o.firstOnly : only;      // (the first row after a junction corner: single verb)
      // sliding walls: never right after a junction corner, never within 1.5 s of another hard row
      const slideOk = !o.firstOnly && !(lastR && lastR.pat === 'none') && !(lastR && (lastR.hard || lastR.lethal) && (s - lastR.s) / vs < 1.5) && (!lastR || (s - lastR.s) / vs >= 1.0);
      const VT = this._vt || (this._vt = { turret: 1300, icegate: 1600, pensled: 2000 });
      const vW = (k) => s < VT[k] - 150 ? 0 : s >= VT[k] ? 30 : 0.9;
      const wfn = (p) => {
        if (onlyNow && !onlyNow[p]) return 0;
        if (HARD_PAT[p] && hardN >= 3) return 0;
        if (split2 && p !== 'low' && p !== 'duck' && p !== 'rest' && p !== 'ice' && p !== 'melt' && p !== 'conveyor' && p !== 'rail' && p !== 'laser' && p !== 'icegate') return 0;
        if (tightRow && TIGHT_OK.indexOf(p) < 0) return 0;
        if (vq && (p === 'low' || p === 'duck' || p === 'laser' || p === 'icegate')) return 0;
        const dz = zown && zown.indexOf(p) >= 0 ? Math.max(diff, 0.35) : diff;
        switch (p) {
          case 'single': return free0.length >= 2 ? 3 : 0;
          case 'double': return open3 && dz >= 0.2 ? 1.2 + 1.6 * dz + (dense ? 0.6 : 0) : 0;
          case 'low': return 2.6;
          case 'train': return dz >= 0.25 && persist.length === 0 && room > 30 && s + 26 <= lim && allowed.length === NL ? 0.8 + 0.8 * dz + (dense ? 0.4 : 0) : 0;
          case 'mover': return dz >= 0.1 && free0.length >= 2 && room > 6 && free0.some((l) => free0.indexOf(l + 1) >= 0) ? 1.1 : 0;
          case 'rolling': return dz >= 0.4 && room > 18 && persist.length === 0 && s + 30 <= lim && free0.length >= 2 ? 0.12 : 0;
          case 'beat': return dz >= 0.25 && room > 6 && open3 ? 0.9 + (dense ? 0.5 : 0) : 0;
          case 'swing': return dz >= 0.3 && room > 6 && free0.length >= 2 ? 0.8 : 0;
          case 'ice': return dz >= 0.05 ? 0.5 : 0;
          case 'melt': return plan.biomeId === 'desert' || plan.biomeId === 'volcano' ? 1.6 : (dz >= 0.3 ? 0.12 : 0);
          case 'conveyor': return F.conveyor !== false && dz >= 0.15 ? 0.6 : 0;
          case 'rail': return T.allows('rail') && dz >= 0.2 && room > 30 ? 0.5 : 0;
          case 'oncoming': return plan.lethalOk && T.allows('oncoming') && dz >= 0.2 && room > 22 && !forcedNext && s + 52 <= lim && persist.length === 0 && free0.length >= 2 ? 1.0 + 0.8 * dz : 0;
          case 'duck': return T.allows('duck') && dz >= 0.04 && room > 8 ? 1.5 + 0.8 * dz : 0;
          case 'slide': return plan.lethalOk && slideOk && T.allows('slideWall') && dz >= 0.3 && s >= 1200 && room > 12 && adj ? 0.45 + 0.4 * dz : 0;
          case 'combo': return plan.lethalOk && slideOk && late && T.allows('oncoming') && T.allows('slideWall') && room > 40 && !forcedNext && s + 66 <= lim && persist.length === 0 && open3 ? 1.6 : 0;
          case 'rest': return lastRest ? 0 : (late ? 0.08 : 0.35);
          case 'laser': return T.allows('lasers') && dz >= 0.08 && room > 8 ? 1.4 + 1.2 * dz : 0;
          // a volley is launched 2 s before contact (reticle + warning), anywhere in a piece as long as its contact is clear of a lane-forcing
          // run-in and no other blocker persists (a missile that already hit does not count); rare in normal play (late), the missiles zone's main course
          case 'missile': return !!T.level && plan.lethalOk && T.allows('missiles') && dz >= (zone === 'missiles' ? 0.18 : 0.55) && room > 4 && tmHard === 0 && s + vs * 2.9 + 12 <= limM ? (zone === 'missiles' ? 1.0 + 1.2 * dz : 0.4 + 0.5 * dz) : 0;
          case 'phrase': return phOn && tm === 0 && hardN <= 1 && room > 8 && dz >= 0.05 ? (2.5 + 9.0 * dz) * (tn < 1 ? 1.7 : tn > 1 ? 0.6 : 1) : 0;
          case 'critter': return wantCrit ? 90 : 0;
          // variety (from ~1.2 km, modest weights)
          // first sightings are guaranteed (turret ~1.3 km, gate ~1.6 km, sled ~2.0 km; the boost applies from the target on, wherever the rules allow, +-150 m),
          // then each returns every 400-700 m
          case 'icegate': return vW('icegate') * (T.allows('duck') && dz >= 0.05 && room > 8 ? 1 : 0);
          case 'turret': return vW('turret') * (dz >= 0.05 && !zone && room > 24 && tmHard === 0 && s + 36 <= lim && free0.length >= 2 && !tightRow ? 1 : 0);
          case 'pensled': return vW('pensled') * (dz >= 0.05 && !zone && room > 8 && tmHard === 0 && free0.length >= 2 && !tightRow ? 1 : 0);
          default: return 0;
        }
      };
      c.s = s; c.vs = vs; c.free0 = free0; c.rm = rm; c.room = room; c.lim = lim; c.prevRoute = prevRoute; c.open3 = open3; c.plain = !hardEnd && (nk0 === 'straight' || nk0 === 'curve'); c.vq = vq;
      const pat = ph ? 'phrase' : wpick(rng, pats, (p) => wfn(p) * (rockNear && RK_BAN[p] ? 0 : 1) * (zmap ? (zmap[p] !== undefined ? zmap[p] : zmap._) : 1));
      let free = FULL, ext = 1.5, jump = false, advanceExtra = 0, made = true, phK = 0, phI = 0, rowPat = pat, rext = -1;     // rext: extent the route / snow trails / gems see (a critter group never blocks the route lane: it keeps only the full `ext` in rowsLog)
      switch (pat) {
        case 'single': {
          // 'single' favours the lane the player is most likely in (the previous route lane) ~50% of the time
          let l = free0.indexOf(prevRoute) >= 0 && rng.chance(0.5) ? prevRoute : free0[rng.int(0, free0.length - 1)];
          if (!(rm & ~bit(l))) l = free0.find((q) => q !== l);        // never hide the only reachable lane
          const type = this._pickStatic(plan, () => true);
          this._scaled(plan, type, s, l);
          free = FULL & ~bit(l);
          ext = DEFS[type].ext;
          break;
        }
        case 'double': {
          const la = rng.int(0, NL - 1); let lb; do { lb = rng.int(0, NL - 1); } while (lb === la);
          const lanes = [la, lb];
          for (const l of lanes) this._scaled(plan, this._pickStatic(plan, (t) => t !== 'cabin' && t !== 'rock' && t !== 'stone'), s + rng.range(-1, 1), l);
          free = FULL & ~(bit(lanes[0]) | bit(lanes[1]));
          ext = 2;
          break;
        }
        case 'low': {
          // jumpable low blockers across contiguous runs of free lanes (all 3 lanes only if a jump clears them)
          const runs = [];
          let cur = null;
          for (let l = 0; l < NL; l++) {
            if (free0.indexOf(l) >= 0) { if (cur && l === cur.hi + 1) cur.hi = l; else { cur = { lo: l, hi: l }; runs.push(cur); } }
            else cur = null;
          }
          const run = runs[rng.int(0, runs.length - 1)];
          let lo = run.lo, hi = run.hi;
          if (rng.chance(0.55)) { lo = rng.int(run.lo, run.hi); hi = rng.int(lo, run.hi); }
          const type = rng.chance(0.65) ? 'fallenLog' : 'fence';
          this._static(plan, type, s, 0, { uMin: LANES[lo] - 1.2, uMax: LANES[hi] + 1.2 });
          free = FULL & ~(((1 << (hi + 1)) - 1) ^ ((1 << lo) - 1));
          jump = free0.length > 0 && (free & amask & ~tm & rm) === 0;       // no free lane in reach: must jump
          if (jump) free = 0;
          ext = 1.2;
          break;
        }
        case 'train': {
          // Subway-style: 8-25 m blocks. Rideable ones (kar treni / ice blocks, roof 1.6 m) come as 1-3 parallel cars with ONE ramp at the back
          const L = Math.min(rng.int(8, 25), Math.floor(room - 12));
          const rideK = plan.lethalOk && diff >= 0.12 && rng.chance(NL > 3 ? 0.85 : 0.6);
          const np = rideK ? (NL >= 5 && rng.chance(0.55) ? 3 : NL >= 4 && rng.chance(0.7) ? 2 : 1) : 1, rl = 9;
          const lo = np === 1 ? (rng.chance(0.5) ? 0 : NL - 1) : (rng.chance(0.5) ? 0 : NL - np);
          const ls = []; for (let k = 0; k < np; k++) ls.push(lo + k);
          let lm = 0; for (const l of ls) lm |= bit(l);
          if (L < 8 || !(prevFree & ~lm & amask) || ls.some((l) => !inAllowed(l))) { made = false; break; }
          if (rideK) {
            if (s + rl + L > sB || s + rl + L > lim) { made = false; break; }
            const ice = rng.chance(0.4), ramp = ls[rng.int(0, np - 1)], H = 1.6;
            for (const l of ls) {
              this._static(plan, 'snowcat', s + rl + L / 2, LANES[l], { L, ride: true, rl: l === ramp ? rl : 0, H, ice, glow: this._pal(s).glow, ext: L / 2 + rl + 1.5 });
              persist.push({ lane: l, s0: s, s1: s + rl + L });
              const sp = this._sp(s);
              for (let x = s + rl + 1.5; x < s + rl + L - 1; x += sp) this._pickup('flake', x, LANES[l], H + 0.9);   // roof coins
              if (this.scarves && l === ramp && rng.chance(0.3) && s > this.next.scarf - 60) { this._pickup('scarf', s + rl + L / 2, LANES[l], H + 1.1); this.next.scarf = Math.max(this.next.scarf, s + 70); }   // roof token
            }
            ext = L + rl + 1;
          } else {
            this._static(plan, plan.lethalOk && rng.chance(0.6) ? 'snowcat' : 'longLogs', s + L / 2, LANES[ls[0]], { L, ext: L / 2 + 1.5 });
            persist.push({ lane: ls[0], s0: s, s1: s + L });
            ext = L + 1;
          }
          free = FULL & ~lm;
          advanceExtra = 0;
          break;
        }
        case 'mover': {
          const pairs = [];
          for (const l of free0) if (free0.indexOf(l + 1) >= 0) pairs.push([l, l + 1]);
          const pr = pairs[rng.int(0, pairs.length - 1)];
          const freeLane = ALLL.filter((l) => l !== pr[0] && l !== pr[1])[0];
          if (!inAllowed(freeLane) || (tm & bit(freeLane))) { made = false; break; }
          const type = rng.chance(0.65) ? 'skier' : 'sled';
          const suits = [0x2f7de6, 0xe6492f, 0x35c46a, 0xe6b82f];
          this._mk(plan, { kind: 'moving', type, s, u: LANES[pr[0]], ext: 1.8, laneA: pr[0], laneB: pr[1], per: Math.max(2.2, (diff > 0.6 ? 3 : 4) / hk), ph: rng.range(0, 1), suit: suits[rng.int(0, 3)] });
          free = bit(freeLane);
          ext = 1.8;
          break;
        }
        case 'rolling': {
          const l = free0[rng.int(0, free0.length - 1)], L = 28;
          if (s + L > piece.s1 - 3 || !(prevFree & ~bit(l) & amask)) { made = false; break; }
          this._mk(plan, { kind: 'moving', type: 'rolling', s: s + L / 2, u: LANES[l], ext: L / 2 + 1.5, s0: s, L, per: Math.max(4, 8 / hk), ph: rng.range(0, 1) });
          persist.push({ lane: l, s0: s, s1: s + L });
          free = FULL & ~bit(l);
          ext = 2;
          break;
        }
        case 'beat': {
          const sigma = rng.chance(0.5) ? -1 : 1;
          const farLane = sigma < 0 ? NL - 1 : 0;
          if (tm & bit(farLane) || !inAllowed(farLane)) { made = false; break; }
          const hw = piece.hw;
          this._mk(plan, { kind: 'plow', s, u: sigma * (hw - 0.25), u0: sigma * (hw - 0.25), sigma, L: 4.4, per: Math.max(2.2, (diff > 0.7 ? 3 : 4) / hk), phi: rng.range(0, TAU), ext: 4.8 });
          free = bit(farLane);
          ext = 4.8;
          break;
        }
        case 'swing': {
          this._mk(plan, { kind: 'swing', s, u: 0, hw: piece.hw, H: 4.2, Ls: 3.6, amp: 62 * PI / 180, per: Math.max(2.2, (diff > 0.6 ? 3 : 4) / hk), ext: 2.2 });
          free = FULL; ext = 2.2;
          break;
        }
        case 'ice': {
          const groups = [];
          const lanes = free0.filter(() => rng.chance(0.7)); if (!lanes.length) lanes.push(free0[0]);
          for (const l of lanes) { if (groups.length && l === groups[groups.length - 1].hi + 1) groups[groups.length - 1].hi = l; else groups.push({ lo: l, hi: l }); }
          const len = rng.range(6, 10);
          this._mk(plan, { kind: 'ice', s, u: 0, len, ext: len / 2 + 0.5, groups: groups.map((g) => ({ uMin: LANES[g.lo] - 1.2, uMax: LANES[g.hi] + 1.2 })) });
          free = FULL; ext = len / 2;
          break;
        }
        case 'melt': {
          const lanes = free0.length >= NL ? [free0[rng.int(0, free0.length - 1)]] : [free0[rng.int(0, free0.length - 1)]];
          if (free0.length === NL && rng.chance(0.4)) { const o2 = rng.chance(0.5) ? 1 : -1, l2 = lanes[0] + o2; if (l2 >= 0 && l2 < NL) lanes.push(l2); }
          lanes.sort();
          const groups = [];
          for (const l of lanes) { if (groups.length && l === groups[groups.length - 1].hi + 1) groups[groups.length - 1].hi = l; else groups.push({ lo: l, hi: l }); }
          const len = rng.range(10, 14);
          this._mk(plan, { kind: 'melt', s, u: 0, len, ext: len / 2 + 0.5, rate: 0.18 + 0.12 * diff, groups: groups.map((g) => ({ uMin: LANES[g.lo] - 1.2, uMax: LANES[g.hi] + 1.2 })) });
          free = FULL & ~lanes.reduce((m, l) => m | bit(l), 0); if (!(free & ~tm)) free = FULL;      // (a floor patch is not a blocker: never the only open lane)
          ext = len / 2;
          break;
        }
        case 'conveyor': {
          const lanes = free0.filter(() => rng.chance(0.6)); if (!lanes.length) lanes.push(free0[rng.int(0, free0.length - 1)]);
          const groups = [];
          for (const l of lanes) { if (groups.length && l === groups[groups.length - 1].hi + 1) groups[groups.length - 1].hi = l; else groups.push({ lo: l, hi: l }); }
          const len = rng.range(8, 12);
          this._mk(plan, { kind: 'conveyor', s, u: 0, len, ext: len / 2 + 0.5, dir: rng.sign(), push: 3.6, glow: this._pal(s).glow, groups: groups.map((g) => ({ uMin: LANES[g.lo] - 1.2, uMax: LANES[g.hi] + 1.2 })) });
          free = FULL; ext = len / 2;
          break;
        }
        case 'rail': {
          const l = free0[rng.int(0, free0.length - 1)], len = rng.range(18, 24);
          if (s + len > sB) { made = false; break; }
          const railH = 0.55, sp = this._sp(s);
          this._mk(plan, { kind: 'rail', s: s + len / 2, u: LANES[l], len, railH, glow: this._pal(s).glow, ext: len / 2 + 1 });
          for (let x = s + 2; x < s + len - 1; x += sp) this._pickup('flake', x, LANES[l], 1.35);      // coins above the rail: grind to collect
          free = FULL; ext = 3;
          break;
        }
        case 'oncoming': {
          const l = free0[rng.int(0, free0.length - 1)], sP = s + 42;
          if (sP > sB + 20 || !(prevFree & ~bit(l) & amask)) { made = false; break; }
          const vt = Math.min(12, rng.range(6, 10) * Math.sqrt(hk)), ride = diff >= 0.3 && rng.chance(0.45);
          this._mk(plan, { kind: 'oncoming', s: sP, sP, u: LANES[l], lane: l, vt, ride, L: 12, ext: 74, glow: this._pal(sP).glow });
          persist.push({ lane: l, s0: s, s1: sP + 8 });
          free = FULL & ~bit(l); ext = 70;
          break;
        }
        case 'duck': {
          const lo = allowed.length === 1 ? allowed[0] : rng.int(0, NL - 1), hi = allowed.length === 1 ? lo : rng.chance(0.4) ? NL - 1 : rng.int(lo, NL - 1), hb = rng.range(1.0, 1.6);
          this._mk(plan, { kind: 'overhead', s, lo, hi, hb, u: (LANES[lo] + LANES[hi]) / 2, ext: 2.4, glow: this._pal(s).glow });
          free = FULL; ext = 1.5;
          break;
        }
        case 'slide': {
          const al = free0.length === NL ? ALLL : free0.slice();
          this._mk(plan, { kind: 'slidewall', s, u: 0, pat: this._slidePattern(rng, al), per: 4, ext: 2.6, glow: this._pal(s).glow });
          free = FULL; ext = Math.max(3, 1.6 * vs);       // >= 1.5 s of clear track after a sliding wall
          break;
        }
        case 'combo': {
          const l = rng.chance(0.5) ? 0 : NL - 1, sP = s + 42, wS = sP + 16;
          if (wS > sB + 20 || !(prevFree & ~bit(l) & amask)) { made = false; break; }
          const al = ALLL.filter((x) => x !== l), vt = Math.min(12, rng.range(7, 11) * Math.sqrt(hk));
          this._mk(plan, { kind: 'oncoming', s: sP, sP, u: LANES[l], lane: l, vt, ride: false, L: 12, ext: 74, glow: this._pal(sP).glow });
          this._mk(plan, { kind: 'slidewall', s: wS, u: 0, pat: this._slidePattern(rng, al), per: 1, ext: 2.6, glow: this._pal(wS).glow });
          persist.push({ lane: l, s0: s, s1: wS + 4 });
          free = FULL & ~bit(l); ext = 70;
          break;
        }
        case 'laser': {
          const dd = zown && zown.indexOf('laser') >= 0 ? Math.max(diff, 0.35) : diff, hwE = piece.hw;
          const sg = rng.chance(0.5) ? -1 : 1, farLane = sg < 0 ? NL - 1 : 0, farOk = inAllowed(farLane) && !(tm & bit(farLane)) && (prevFree & bit(farLane));
          const v = wpick(rng, ['low', 'high', 'curtain', 'rotating', 'blink'], (x) => ({
            low: dd >= 0.08 ? 3 : 0, high: dd >= 0.12 ? 2.5 : 0, curtain: free0.length >= 2 && !split2 && !tightRow && dd >= 0.2 ? 2 : 0,
            rotating: farOk && !split2 && !tightRow && room > 10 && dd >= 0.3 ? 1.5 : 0, blink: open3 && room > 10 && dd >= 0.35 && T.allows('lasers') ? 1.4 : 0 }[x]));
          if (!v) { made = false; break; }
          const base = { kind: 'laser', variant: v, s, u: 0, hw: hwE, ext: 3.2 };
          if (v === 'low') { Object.assign(base, { hb: 0.5 }); jump = true; ext = 1.6; }
          else if (v === 'high') { Object.assign(base, { hb: 1.3 }); ext = 1.6; }
          else if (v === 'curtain') {
            const runs = []; let cur = null;
            for (let l = 0; l < NL; l++) { if (free0.indexOf(l) >= 0) { if (cur && l === cur.hi + 1) cur.hi = l; else { cur = { lo: l, hi: l }; runs.push(cur); } } else cur = null; }
            const run = runs[rng.int(0, runs.length - 1)];
            let lo = run.lo, hi = run.hi; if (hi - lo >= 1 && (free0.length < NL || rng.chance(0.6))) { lo = rng.int(run.lo, run.hi - (free0.length === NL ? 1 : 0)); hi = free0.length === NL && rng.chance(0.5) ? Math.min(NL - 1, lo + 1) : lo; }
            if (hi - lo + 1 >= free0.length) hi = lo;
            Object.assign(base, { lo, hi }); free = FULL & ~(((1 << (hi + 1)) - 1) ^ ((1 << lo) - 1)); ext = 1.5;
          } else if (v === 'rotating') Object.assign(base, { sigma: sg, L: 2 * hwE - 2.7, per: Math.max(2.2, (dd > 0.6 ? 3 : 4) / hk), phi: rng.range(0, TAU), ext: 5 }), free = bit(farLane), ext = 5;
          else Object.assign(base, { pat: this._slidePattern(rng, ALLL), per: Math.max(4, Math.ceil(3.2 * T.bpmAt(s) / 60)), ext: 3 });       // one lane per ~3.2 s (flicker telegraph = last 30%)
          this._mk(plan, base);
          break;
        }
        case 'missile': {
          const nMax = Math.min(free0.length - 1, diff > 0.5 ? 2 : 1);
          if (nMax < 1) { made = false; break; }       // (no prevFree test: a volley has no obstacle on the row itself, the player has 2 s to leave the lane)
          const n = rng.int(1, nMax), lanes = free0.slice().sort(() => rng.next() - 0.5).slice(0, n);
          const vm = Math.min(40, rng.range(26, 34) * Math.sqrt(hk)), m = s + vs * 2.0;
          lanes.forEach((l, i) => {
            const dm = i * vs * rng.range(0.5, 0.9), mm = m + dm, sP = mm + vm * 2.0;
            this._mk(plan, { kind: 'missile', s: mm, sP, u: LANES[l], lane: l, vm, ext: 90, p0: s - 3, p1: mm + vs * 0.6 + 8 });
            persist.push({ lane: l, s0: s - 3, s1: mm + vs * 0.6 + 8, mm });
          });
          free = FULL & ~lanes.reduce((a, l) => a | bit(l), 0); ext = 3;
          break;
        }
        case 'icegate': {
          this._mk(plan, { kind: 'icegate', s, u: 0, lo: 0, hi: NL - 1, per: Math.max(2.2, (diff > 0.6 ? 3 : 4) / hk), ph: rng.range(0, 1), ext: 2.4, glow: this._pal(s).glow });
          VT.icegate = s + rng.range(400, 700);
          free = FULL; ext = 2.4; rowPat = 'duck';
          break;
        }
        case 'turret': {
          const lanes = free0.filter((q) => rm & ~bit(q));
          if (!lanes.length) { made = false; break; }
          const l = lanes[rng.int(0, lanes.length - 1)], sg = l === 0 ? -1 : l === NL - 1 ? 1 : (rng.chance(0.5) ? -1 : 1), sT = s + 30;
          this._mk(plan, { kind: 'turret', s: sT, u: sg * (piece.hw + 1.3), lane: l, ext: 60, glow: this._pal(s).glow });
          persist.push({ lane: l, s0: s - 3, s1: sT });
          VT.turret = s + rng.range(400, 700);
          free = FULL & ~bit(l); ext = 3;
          break;
        }
        case 'pensled': {
          this._mk(plan, { kind: 'pensled', s, u: 0, hw: piece.hw, v: Math.min(4, 3.2 * Math.sqrt(hk)), ph: rng.range(0, 40), ext: 2, glow: this._pal(s).glow });
          VT.pensled = s + rng.range(400, 700);
          free = FULL; ext = 2;
          break;
        }
        case 'critter': {
          const g = this._critterGroup(plan, c, s, free0, rm, prevRoute);
          if (!g) { made = false; this._nextCrit = s + vs * 1.5; break; }
          free = g.free; ext = g.ext; rext = 3;
          this._nextCrit = s + rng.range(7.5, 12.5) * vs;
          for (const l of g.lanes) persist.push({ lane: l, s0: s - 1, s1: s + g.ext - 6 });       // the group walks on in its lane(s): no obstacle row there meanwhile
          break;
        }
        case 'phrase': {
          // authored multi-row phrase: the first row picks it, each following iteration places the next row (it may continue in the next piece)
          if (!ph) {
            const pk = wpick(rng, PHRASES, (e) => diff >= e.min && e.ok(c) ? e.w(diff) : 0);
            if (!pk) { made = false; break; }
            let steps = pk.build(c), hardLeft = 3 - hardN, cut = steps.length;      // at most 3 hard rows in a row: a phrase is cut short
            for (let q = 0; q < steps.length; q++) { const t = steps[q].t; if (t === 'wall' || t === 'hurdle' || t === 'train') { if (--hardLeft < 0) { cut = q; break; } } }
            steps = steps.slice(0, Math.max(2, cut));
            ph = { k: PHRASES.indexOf(pk), steps, i: 0, g: 0.6 };
            const gk = 1 + 0.25 * Math.max(0, 1 - diff / 0.4);      // early phrases are looser (~0.7 s), from diff 0.4 on they run at their own pace
            for (const st of ph.steps) st.g *= gk;
          }
          if (!(made = this._phraseRow(plan, c, ph.steps[ph.i]))) { ph = null; break; }
          free = c.free; ext = c.ext; jump = c.jump; phK = ph.k + 1; phI = ph.i + 1; rowPat = PH_PAT[ph.steps[ph.i].t];
          ph.g = ph.steps[ph.i].g;
          if (++ph.i >= ph.steps.length) ph = null;
          break;
        }
        default: made = false;
      }
      lastRest = !made || pat === 'rest';
      if (this.rowDbg) this.rowDbg.push([s, pat, made, piece.kind, tn]);
      if (made) {
        const mask = amask & ~tm;
        // the route goes to a free lane that is within reach, else (jump rows) to any lane in reach, else any free / open lane
        let cand = ALLL.filter((l) => (free & bit(l)) && (mask & bit(l)) && (rm & bit(l)));
        if (!cand.length) cand = ALLL.filter((l) => (jump ? rm : free) & bit(l) && (mask & bit(l)));
        if (!cand.length) cand = ALLL.filter((l) => mask & bit(l));
        let best = cand[0], bd = 9;
        for (const l of cand) { const d = Math.abs(l - prevRoute) + rng.next() * 0.3; if (d < bd) { bd = d; best = l; } }
        prevRoute = best;
        const lethal = !!plan.rowLethal, hard = !!HARD_PAT[rowPat] || lethal, vert = jump || rowPat === 'duck' || (rowPat === 'laser' && free === FULL);
        const row = { s, ext: rext >= 0 ? rext : ext, free, jump, route: best, pat: rowPat, tm, ph: phK, pi: phI, lethal, hard, rock: !!plan.rowRock, hardN: pat === 'rest' ? 0 : hard ? hardN + 1 : 0, vert };
        rows.push(row);
        this.rowsLog.push({ s, ext: Math.max(ext, 2), free, jump, lethal, hard, pat: rowPat, vert, route: best, rock: !!plan.rowRock, ph: phK });
        if (plan.rowRock) this._lastRockS = s;
        if (ph) {
          // next phrase row: its planned gap, raised to the lane-swap time (0.25 s per lane + the obstacle depth) of the swap it asks for
          const nx = ph.steps[ph.i], dl = nx.free !== undefined ? Math.abs(nx.free - best) : nx.t === 'hurdle' ? Math.abs(nx.lane - best) : 1;
          ph.g = Math.max(ph.g, LANE_T * dl + 2.0 / vd + 0.05);
        }
      }
      // Gap to the next row (seconds -> metres at the nominal speed): 1 / rate(s), shaped by the tension cycle and the piece density
      const gapSec = Math.max(0.65, (1 / (rowRate(s) * Math.pow(hk, 0.3) * dens)) * tn * rng.range(0.88, 1.12) * (late ? 0.92 : 1) * (NL > 3 ? 0.78 : 1));   // wide bursts: a denser dodge-fest
      s += (made && ph ? vs * ph.g + Math.min(ext, 3) : made ? Math.max(vs * gapSec, 0.4 * vd + Math.min(ext, 3) + 1.2) : vs * gapSec) + advanceExtra;
    }
    if (rows.length) { const r = rows[rows.length - 1]; this._carry = { s: r.s, ext: r.ext, route: r.route, free: r.free, jump: r.jump, pat: r.pat, lethal: r.lethal, rock: r.rock, hardN: r.hardN, persist: persist.slice(), ph }; }
    this._clock = Math.max(this._clock || 0, s);
  },

  /** Scripted teaching rows of the first 300 m (single lane block, low log, duck bar, one critter): placed by the piece that contains them. */
  _teachRows(plan, piece) {
    const T = this.track;
    if (T.level || piece.noObs || (T.features && T.features.teach === false)) return;
    while (this._teach < TEACH.length && TEACH[this._teach].s < piece.s1) {
      const t = TEACH[this._teach++];
      if (t.s < piece.s0) continue;
      const rng = plan.rng, s = t.s, tut = !!this.tutorial;
      let ext = 1.5, free = FULL, jump = false, route = 1, pat = t.pat;
      plan.diff = 0; plan.d = 0; plan.lethalOk = false; plan.rockOk = true;
      if (pat === 'single') {
        const lane = tut || rng.chance(0.6) ? NL >> 1 : rng.int(0, NL - 1);
        const type = tut ? 'crate' : this._pickStatic(plan, (x) => x === 'crate' || x === 'snowman' || x === 'stone' || x === 'sign');
        this._scaled(plan, type, s, lane);
        free = FULL & ~bit(lane); ext = DEFS[type].ext; route = lane === (NL >> 1) ? (rng.chance(0.5) ? 0 : NL - 1) : NL >> 1;
      } else if (pat === 'low') {
        this._static(plan, rng.chance(0.65) ? 'fallenLog' : 'fence', s, 0, { uMin: LANES[0] - 1.2, uMax: LANES[NL - 1] + 1.2 });
        free = 0; jump = true; ext = 1.2; route = NL >> 1;
      } else if (pat === 'duck') {
        this._mk(plan, { kind: 'overhead', s, lo: 0, hi: NL - 1, hb: 1.2, u: 0, ext: 2.4, glow: this._pal(s).glow });
        free = FULL; ext = 1.5; route = 1;
      } else if (pat === 'pad') {
        const lane = NL >> 1, fl = this._arcFlakes(plan, s + 1.2, LANES[lane], this.jumpPadV);
        this._pad(plan, 'jump', s, lane);
        free = FULL; ext = fl / 2 + 7; route = lane; pat = 'rest';
        plan.rows.push({ s: s + fl / 2, ext, free, jump: false, route, pat, tm: 0, ph: 0, pi: 0, lethal: false, hard: false, hardN: 0, vert: false });
        this._carry = { s: s + fl / 2, ext, route, free, jump: false, pat, lethal: false, hardN: 0, persist: [], ph: null };
        continue;
      } else if (pat === 'boost') {
        // lane-wide chevron strip in the middle lane + a flake line after it; the speed surge (+7 m/s, FOV punch) fades before the duck bar
        this._mk(plan, { kind: 'strip', s, u: LANES[NL >> 1], len: 14, ext: 8, glow: this._pal(s).glow, power: 1 });
        for (let x = s + 10; x < s + 24; x += 2) this._pickup('flake', x, LANES[NL >> 1], 1.35);
        free = FULL; ext = 12; route = NL >> 1; pat = 'rest';
        plan.rows.push({ s: s + 6, ext, free, jump: false, route, pat, tm: 0, ph: 0, pi: 0, lethal: false, hard: false, hardN: 0, vert: false });
        this._carry = { s: s + 6, ext, route, free, jump: false, pat, lethal: false, hardN: 0, persist: [], ph: null };
        continue;
      } else if (pat === 'parade') {
        const g = this._critterGroup(plan, { rng, diff: 0 }, s, ALLL, FULL, NL >> 1, { parade: true });
        if (!g) continue;
        free = g.free; ext = g.ext; route = ALLL.find((l) => free & bit(l)) ?? (NL >> 1);
        this._nextCrit = Math.max(this._nextCrit, s + 10 * this.track.speedAt(s));
      } else if (pat === 'critter') {
        const g = this._critterGroup(plan, { rng, diff: 0 }, s, ALLL, FULL, NL >> 1, { teach: true });
        if (!g) continue;
        free = g.free; ext = g.ext; route = ALLL.find((l) => free & bit(l) && l !== (NL >> 1)) ?? (NL >> 1);
        this._nextCrit = Math.max(this._nextCrit, s + 12 * this.track.speedAt(s));
      }
      const row = { s, ext: pat === 'critter' ? 3 : ext, free, jump, route, pat, tm: 0, ph: 0, pi: 0, lethal: false, hard: false, hardN: 0, vert: jump || pat === 'duck' };
      plan.rows.push(row);
      this.rowsLog.push({ s, ext: Math.max(ext, 2), free, jump, lethal: false, hard: false, pat, vert: row.vert, route });
      this._carry = { s, ext: pat === 'critter' ? 3 : ext, route, free, jump, pat, lethal: false, hardN: 0, persist: [], ph: null };
    }
  },

  /**
   * CRITTER group (stomp it: the ball bounces, combo). Returns { free (lanes without a critter), ext } or null. A parade of 3-5 in one lane is spaced
   * so a stomp bounce (vh 9, ~0.64 s) lands on the next one; some critters hop lanes (0.6 s crouch telegraph) but never into the route lane.
   */
  _critterGroup(plan, c, s, free0, rm, prevRoute, opt = {}) {
    const cr = this.critters, rng = plan.rng;
    if (!cr) return null;
    const T = this.track, vs = T.speedAt(s), d = plan.diff ?? 0;
    const species = cr.speciesFor(plan.biomeId);
    const vc = rng.range(3.0, 4.6);
    // lanes: the group keeps the route lane free (you may stomp or dodge); only the first (teaching) one sits in the lane you are in
    const others = free0.filter((l) => l !== prevRoute);
    let laneA;
    if (opt.teach) laneA = prevRoute;
    else if (others.length) laneA = others[rng.int(0, others.length - 1)];
    else return null;
    const used = [laneA];
    let n = opt.teach ? 1 : opt.parade ? 4 : s < 400 ? rng.int(1, 2) : d < 0.25 ? rng.int(2, 3) : rng.int(3, 5);
    const spacing = clamp(0.54 * (vs - vc), 4, 22);
    // before a lane-forcing piece / junction corner the whole parade (+ ~3 s of walking) has to fit in the free stretch; before a plain piece it may flow on
    if (!opt.teach && c && c.plain === false && c.room !== undefined) {
      const fit = Math.floor((c.room - 6 - Math.min(14, 3 * vc)) / spacing) + 1;
      if (fit < 1) return null;
      n = Math.min(n, fit);
    }
    const hop = !opt.teach && !opt.parade && (NL > 3 ? rng.chance(0.85) : d >= 0.12 && rng.chance(0.4 + 0.3 * d));
    let hopTo = -1;
    if (hop) { hopTo = (NL > 3 ? [laneA - 2, laneA - 1, laneA + 1, laneA + 2] : [laneA - 1, laneA + 1]).filter((l) => l >= 0 && l < NL && l !== prevRoute && free0.indexOf(l) >= 0)[0] ?? -1; if (hopTo >= 0) used.push(hopTo); }
    const second = !opt.teach && !hop && n >= 3 && d >= 0.3 && rng.chance(0.35) ? free0.find((l) => l !== laneA && l !== prevRoute) : undefined;
    cr.spawnGroup({ species, s, lane: laneA, n, spacing, vc, hopTo, second: second ?? -1, seed: (rng.next() * 1e9) | 0, skin: plan.skin });
    if (second !== undefined) used.push(second);
    const len = (n - 1) * spacing;
    let free = FULL; for (const l of used) free &= ~bit(l);
    return { free, ext: len + 13, lanes: used };
  },

  /** Lane-centre route through the rows (smooth lane changes between rows). */
  _routeFn(plan, baseLane) {
    const rows = plan.rows;
    return (s) => {
      if (!rows.length) return LANES[baseLane];
      if (s <= rows[0].s) return LANES[rows[0].route];
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i], b = rows[i + 1];
        if (s >= b.s) continue;
        let t0 = a.s + a.ext + 1.0, t1 = b.s - b.ext - 1.0;
        if (t1 <= t0 + 0.5) { t0 = (a.s + b.s) / 2 - 0.5; t1 = t0 + 1; }
        return LANES[a.route] + (LANES[b.route] - LANES[a.route]) * smooth((s - t0) / (t1 - t0));
      }
      return LANES[rows[rows.length - 1].route];
    };
  },

  // ----- pickups -----
  _flakeH(s, arcs) {
    for (const a of arcs) {
      if (s < a.s0 || s > a.s0 + a.len) continue;
      const t = (s - a.s0) / a.vs, y = a.base + a.vh * t - 0.5 * AIR_G * t * t;
      if (y > 1.0) return y;
    }
    return 0.9;
  },

  /** flake (coin) lines on the beat along the route; `avoid` = [[a, b]...] ranges taken by snow trails */
  _flakeRuns(plan, route, sA, sB, arcs, avoid) {
    const { rng } = plan, T = this.track;
    const inAv = (x) => { if (avoid) for (const r of avoid) if (x > r[0] - 2 && x < r[1] + 2) return true; return false; };
    let s = sA + rng.range(0, 6);
    while (s < sB - 4) {
      const vs = T.speedAt(s), sp = (vs * 60) / T.bpmAt(s) / 2;
      const wide = NL > 3 && plan.piece.kind !== 'junction', snake = wide && rng.chance(0.6), amp = (NL - 1) * LANE_W * 0.42, ph = rng.range(0, 6.28);
      const n = snake ? rng.int(9, 14) : rng.int(6, 11);
      for (let i = 0; i < n; i++) {
        const si = s + i * sp;
        if (si > sB) break;
        if (inAv(si)) continue;
        const free = !snake || plan.rows.some((r) => Math.abs(si - r.s) < r.ext + 3);
        const u = free ? route(si) : clamp(route(si) + amp * Math.sin(i * 0.75 + ph), LANES[0], LANES[NL - 1]);
        this._pickup('flake', si, u, this._flakeH(si, arcs));
      }
      s += n * sp + rng.range(12, 24);
    }
  },

  /** one snow-pile trail: n piles (4-8) every ~2.4 m along u(s) */
  _snowTrail(plan, s0, n, uFn, sp = 2.4) {
    for (let i = 0; i < n; i++) { const si = s0 + i * sp; this._pickup('snow', si, clamp(uFn(si), -LANES[NL - 1], LANES[NL - 1]), 0.38); }
    return [s0, s0 + (n - 1) * sp];
  },
  _snowGroup(plan, s, lane, n = 3, weave = 0) {
    for (let i = 0; i < n; i++) {
      const si = s + i * 2.3;
      this._pickup('snow', si, LANES[lane] + (weave ? Math.sin(i * 1.4) * weave : 0), 0.38);
    }
  },

  /** Snow supply (hunger): trails of 4-8 piles that lead along the safe route and sometimes through a risky lane (the lane the next row blocks). Returns the ranges used. */
  _trails(plan, route, sA, sB, o = {}) {
    const T = this.track, rng = plan.rng, used = [];
    if (sB - sA < 12) return used;
    const mid = (sA + sB) / 2, vs = T.speedAt(mid), vd = T.vGen ? T.vGen(mid) : 1.1 * vs;
    // tiers / s of snow on offer: ~0.42 early, falling with distance (the ball melts ~0.08 tiers/s early, faster later; the player collects part of it)
    const tiers = (0.42 - 0.2 * smooth(mid / 6000)) * this.snowK * (o.k || 1);
    this._snowOwed += tiers * PILES_PER_TIER * ((sB - sA) / vs);
    const rows = plan.rows.filter((r) => r.s > sA - 20 && r.s < sB + 30), slots = [];
    let cur = sA + 2;
    for (const r of rows) {
      const b = r.s - r.ext - 0.95 * vd - 2;
      if (b - cur >= 11) slots.push({ a: cur, b, next: r });
      cur = Math.max(cur, r.s + r.ext + 3);
    }
    if (sB - 3 - cur >= 11) slots.push({ a: cur, b: sB - 3, next: null });
    // the breather (no rows for ~4 s): a weaving snow line crossing a weaving coin line
    const br = this._breath;
    if (br && br.b > sA && br.a < sB && !o.noBreath) {
      const a = Math.max(br.a, sA) + 2, b = Math.min(br.b, sB) - 2;
      if (b - a >= 12) {
        const ph0 = (br.a * 0.37) % TAU, lam = 38, uA = (x) => 2.0 * Math.sin((TAU * (x - br.a)) / lam + ph0);
        let x = a + 1;
        while (b - x >= 12) {
          const n = Math.min(8, Math.floor((b - x - 2) / 2.4), rng.int(6, 8));
          if (n < 4) break;
          used.push(this._snowTrail(plan, x, n, uA));
          this._snowOwed -= n;
          x += n * 2.4 + rng.range(8, 14);
        }
        const sp = this._sp(a);
        for (let y = a; y < b; y += sp) { if (!used.some((r) => y > r[0] - 2 && y < r[1] + 2)) this._pickup('flake', y, clamp(-uA(y), -2.4, 2.4), 0.95); }
      }
    }
    for (const sl of slots) {
      if (br && sl.b > br.a && sl.a < br.b) continue;     // already handled by the breather lines
      let a = sl.a + rng.range(0, 3);
      while (this._snowOwed >= 3.5 && sl.b - a >= 11) {
        const nMax = Math.floor((sl.b - a - 1) / 2.4) + 1;
        let n = Math.min(8, Math.max(4, Math.round(this._snowOwed)), nMax);
        if (n < 4) break;
        const risky = sl.next && sl.next.free !== FULL && rng.chance(0.28);
        let uFn = route;
        if (risky) {
          const blocked = ALLL.filter((l) => !(sl.next.free & bit(l)));
          const lane = blocked.length ? blocked[rng.int(0, blocked.length - 1)] : 1, u = LANES[lane];
          uFn = () => u;
          n = Math.min(8, n + 2, nMax);          // the risky trail pays 2 extra piles
        }
        used.push(this._snowTrail(plan, a, n, uFn));
        this._snowOwed -= risky ? n - 2 : n;
        a += n * 2.4 + rng.range(5, 12);
      }
    }
    return used;
  },

  /** rare gem (~1 per 600 m): in a risky spot (the lane the next row blocks), else off the route; `apex` (gap pieces) overrides */
  _gems(plan, route, sA, sB, apex) {
    const rng = plan.rng, p = plan.piece;
    if (p.s0 < 150 || p.s1 <= this.next.gem) return;
    if (apex) { this._pickup('gem', apex.s, apex.u, apex.h, { value: 1 }); this.next.gem = apex.s + rng.range(560, 680); return; }
    const T = this.track, vd = T.vGen ? T.vGen(sA) : 1.1 * T.speedAt(sA);
    const rows = plan.rows.filter((r) => r.free !== FULL && r.free !== 0 && r.s > sA + 10 && r.s < sB - 4 && r.s - r.ext - sA > 14);
    let s, lane;
    if (rows.length) {
      const r = rows[rng.int(0, rows.length - 1)], blocked = ALLL.filter((l) => !(r.free & bit(l)));
      lane = blocked[rng.int(0, blocked.length - 1)];
      s = r.s - r.ext - 0.75 * vd - 4;
    } else {
      s = (sA + sB) / 2 + 6;
      const rl = laneOf(route(s)), o = ALLL.filter((l) => l !== rl);
      lane = o[rng.int(0, 1)];
    }
    if (s < sA + 2 || s > sB - 2) return;
    this._pickup('gem', s, LANES[lane], 1.2, { value: 1 });
    this.next.gem = s + rng.range(560, 680);
  },

  _powerUp(plan, kind, s, lane, h = 1.3) { return this._pickup(kind, s, LANES[lane], h); },

  _pad(plan, type, s, lane) {
    const glow = this._pal(s).glow;
    this._mk(plan, { kind: 'pad', type, s, u: LANES[lane], ext: 2, glow });
  },

  /** Gap pieces: flake arc over the gap (rewards the jump), snow after the landing. */
  _gapArc(plan, p) {
    const T = this.track, rng = plan.rng, lane = rng.int(0, NL - 1), u = LANES[lane];
    const vs = T.speedAt(p.gapS0), sp = (vs * 60) / T.bpmAt(p.gapS0) / 2;
    if (p.kind === 'gapRamp') {
      const base = p.rampH + 0.55;
      for (let i = 0, s = p.gapS0 + 0.5; s < p.gapS1 + 2.5; i++, s += sp) {
        const t = (s - p.gapS0) / vs, y = base + p.launchVh * t - 0.5 * AIR_G * t * t;
        this._pickup('flake', s, u, Math.max(0.9, y));
      }
    } else {
      const s0 = p.gapS0 - 1.0, fl = vs * ((2 * AIR_VH) / AIR_G);
      for (let s = s0; s < s0 + fl; s += sp) {
        const t = (s - s0) / vs, y = 0.55 + AIR_VH * t - 0.5 * AIR_G * t * t;
        this._pickup('flake', s, u, Math.max(0.9, y));
      }
    }
    const apex = p.kind === 'gapRamp'
      ? { s: p.gapS0 + vs * (p.launchVh / AIR_G), u, h: p.rampH + 0.55 + (p.launchVh * p.launchVh) / (2 * AIR_G) }
      : { s: p.gapS0 - 1.0 + vs * (AIR_VH / AIR_G), u, h: 0.55 + (AIR_VH * AIR_VH) / (2 * AIR_G) };
    return { lane, apex };
  },


  // ----- main entry -----
  spawn(piece, difficulty, biomeIndex, biomeId) {
    const nPrev = NL; useLanes(piece.n || 3);
    try { return this._spawn(piece, difficulty, biomeIndex, biomeId); } finally { useLanes(nPrev); }
  },
  _spawn(piece, difficulty, biomeIndex, biomeId) {
    const T = this.track, rng = makeRng((Math.imul(piece.id + 1, 2654435761) ^ this.seed ^ (T.seed | 0)) >>> 0);
    AIR_G = T.gravity ? T.gravity(piece.s0 + 10) : 28;
    const bid = biomeId || BIOME_IDS[((biomeIndex ?? piece.biome ?? 0) % BIOME_IDS.length + BIOME_IDS.length) % BIOME_IDS.length];
    const plan = { rng, piece, diff: clamp(difficulty ?? piece.diff ?? 0, 0, 1), d: 0, biome: biomeIndex ?? piece.biome, biomeId: bid, skin: FAMILY[bid] || 'snow',
      rows: [], batch: [], zone: T.zoneAt ? T.zoneAt(piece.s0 + piece.len / 2) : null, lethalOk: true, rowLethal: false, rowRock: false, rockOk: false,
      chap: !T.level && T.chapterAt ? T.chapterAt(piece.s0 + piece.len / 2) : null };      // Rush chapter (goals.js): its rule fields steer rows, fog / wind, pads, ice, coin rain
    if (plan.chap && plan.chap.def.bonus) plan.zone = 'coinRain';      // ALTIN DAMAR: the coin-rain relief zone, with no rows at all
    const cd = plan.chap ? plan.chap.def : null;
    const n0 = this.picks.length;
    const kind = piece.kind, s0 = piece.s0, s1 = piece.s1, F = T.features || {};
    if (kind === 'finish') {
      this._mk(plan, { kind: 'finish', s: s0, u: 0, ext: 4 });
    } else if (piece.narrow) {
      this._funnel(plan, piece);
    } else if (piece.bonus) {
      this._spawnBonus(plan, piece);
    } else if (piece.noObs) {
      // campaign run-out after the finish line: empty
    } else if (kind === 'portal') {
      const pal = this._pal(s0 + 15);
      this._mk(plan, { kind: 'portal', s: s0 + 15, u: 0, ext: 3, glow: pal.glow, biome: piece.biome });
      if (plan.chap && plan.chap.s0 > this._gateS && s0 - plan.chap.s0 < 100) this._gateS = plan.chap.s0;      // a biome portal right at a chapter start is its gate
    } else {
      let route = null, arcs = [], apex = null, trailed = false;
      const early = s0 < 40;
      const vsP = T.speedAt(s0 + piece.len * 0.5), vdP = T.vGen ? T.vGen(s0 + piece.len * 0.5) : 1.1 * vsP;
      const nk = T._q && T._q[0], forced = nk === 'narrow' || nk === 'split' || nk === 'hexHoles' || nk === 'gapRamp' || nk === 'gapJump' || nk === 'skiJump' || nk === 'chasm';
      this._teachRows(plan, piece);
      switch (kind) {
        case 'straight': case 'curve': case 'slalom': {
          const dense = kind === 'slalom';
          // rows on every plain piece (curves at 70% density); before pieces that force a lane the rows stop early so the player has time to take it
          const rowEnd = s1 - (forced ? Math.max(10, 0.6 * vdP + 3) : T.finishS === s1 ? 14 : 2);   // calm approach to the finish line
          const prev = T.pieces[T.pieces.length - 2], after = prev && (prev.kind === 'split' || prev.kind === 'hexHoles' || prev.kind === 'narrow');
          // a calm run-out after turns, loops, round sections and jumps (landing / re-orienting is never punished by a row)
          const calm = prev && (prev.kind === 'junction' || prev.kind === 'loop' || prev.kind === 'corkscrew' || prev.kind === 'helix' || prev.kind === 'halfpipe' || prev.kind === 'tube'
            || prev.kind === 'gapRamp' || prev.kind === 'gapJump' || prev.kind === 'skiJump' || prev.kind === 'chasm' || prev.kind === 'zipline' || prev.kind === 'iceBridge');
          let rowStart = s0 + (calm ? Math.max(14, 1.1 * vdP) : after ? Math.max(6, 0.4 * vdP + 3) : 3), padFlight = 0;
          // spring pad / jump pad (+ coin arc): rows resume after the landing
          if (!early && !dense && kind === 'straight' && s0 >= TEACH_END && rng.chance(cd && cd.pads ? cd.pads : 0.14 + 0.1 * plan.diff)) {
            const vs = T.speedAt(s0 + 10), spring = F.spring !== false && rng.chance(0.65);
            const fl = vs * ((2 * this.jumpPadV * (spring ? 1.55 : 1)) / AIR_G);
            if (s0 + 7 + fl + 12 < rowEnd) {
              const lane = rng.int(0, NL - 1);
              if (spring) padFlight = this._spring(plan, s0 + 7, lane);
              else { this._pad(plan, 'jump', s0 + 7, lane); padFlight = this._arcFlakes(plan, s0 + 8.2, LANES[lane], this.jumpPadV); }
              rowStart = s0 + 7 + padFlight + 7;
              this._clock = Math.max(this._clock, rowStart);
            }
          }
          const gates = kind === 'slalom' && !early && F.gates !== false && rng.chance(cd && cd.gates ? cd.gates : 0.55 * Math.max(0, 1 - (T.budget ? T.budget(s0) : plan.diff) / 0.4));
          if (plan.zone === 'coinRain') { if (!early && !(cd && cd.bonus) && rng.chance(0.3)) this._rows(plan, rowStart, rowEnd, { dense: false }); }
          else if (gates) { this._gates(plan, s0 + 9, s1 - 6); this._clock = Math.max(this._clock, s1 - 6); }
          else if (!early) this._rows(plan, rowStart, rowEnd, { dense, dens: kind === 'curve' ? 0.7 : 1 });
          route = plan.gates ? this._gateRoute(plan, 1) : this._routeFn(plan, 1);
          arcs = this._rowArcs(plan);
          let av = [];
          if (kind === 'straight' && !early && F.boost !== false && !padFlight && s0 >= TEACH_END && rng.chance(0.22)) this._placeStrip(plan, route, s0 + 6, s1 - 6);
          if (plan.zone === 'coinRain') this._coinRain(plan, route, s0 + 3, s1 - 2);
          else {
            const tA = padFlight ? s0 + 7 + padFlight + 5 : s0 + 3;
            if (!early && !plan.gates) { av = this._trails(plan, route, tA, s1 - 3); trailed = true; }
            this._flakeRuns(plan, route, tA + 1, s1 - 3, arcs, av);
          }
          break;
        }
        case 'narrow': {
          this._carry = { s: s0, ext: 0, route: NL >> 1, free: bit(NL >> 1), lethal: false, hardN: 0, persist: [], ph: null };
          route = () => 0;
          // a narrow bridge is one lane wide: single-verb rows only (low log / duck bar / low-high beam), 80% density
          if (!early) this._rows(plan, s0 + piece.taper + 3, s1 - piece.taper - 1, { allowed: [1], only: SINGLE_VERB, dens: 0.8 });
          this._flakeRuns(plan, route, s0 + piece.taper + 2, s1 - piece.taper, this._rowArcs(plan));
          break;
        }
        case 'split': {
          let lane = rng.chance(0.5) ? 0 : NL - 1;
          if (!early && rng.chance(0.55 + 0.3 * plan.diff)) lane = this._splitRows(plan, piece);   // blocks ONE side lane only
          this._carry = { s: s0, ext: 0, route: lane, free: bit(lane), lethal: false, hardN: 0, persist: [], ph: null };
          route = () => LANES[lane];
          this._flakeRuns(plan, route, s0 + 3, s1 - 3, []);
          break;
        }
        case 'hexHoles': {
          const ls = piece.laneSegs[piece.laneSegs.length - 1];
          this._carry = { s: s0, ext: 0, route: ls.route, free: ls.free.reduce((m, l) => m | bit(l), 0), lethal: false, hardN: 0, persist: [], ph: null };
          route = (s) => piece.pathU(s);
          this._flakeRuns(plan, route, s0 + 4, s1 - 3, []);
          break;
        }
        case 'gapRamp': case 'skiJump': case 'chasm': case 'gapJump': {
          const a = this._gapArc(plan, piece);
          apex = a.apex;
          route = () => LANES[a.lane];
          this._snowGroup(plan, piece.gapS1 + 3, a.lane, 4, 0.6);
          this._clock = Math.max(this._clock, piece.gapS1 + 0.9 * vsP + 3);
          break;
        }
        case 'junction':
          route = this._spawn_junction(plan, piece) || (() => 0);
          trailed = true;
          break;
        default: {   // set pieces (helix, waves, iceBridge, halfpipe, tube, zipline, loop, corkscrew) + stairs
          const fn = this['_spawn_' + kind], r = fn ? fn.call(this, plan, piece) || {} : {};
          route = r.route || (() => 0);
          if (r.arcs) arcs = r.arcs;
          if (r.trailed) trailed = true;
        }
      }
      if (piece.slowmo) this._mk(plan, { kind: 'slowmo', s: piece.slowmo.s0, u: 0, ext: 6, slow: piece.slowmo });
      // snow piles: after dangerous pieces / the teaching stretch (the trail supply of plain pieces is laid by _trails above)
      const hazard = kind === 'narrow' || kind === 'hexHoles' || kind === 'split' || kind === 'stairs' || kind === 'slalom' || kind === 'helix' || kind === 'iceBridge' || kind === 'halfpipe' || kind === 'tube' || kind === 'corkscrew' || kind === 'loop' || kind === 'zipline';
      if (hazard && !trailed && kind !== 'slalom') this._snowGroup(plan, s1 - 18, kind === 'narrow' ? NL >> 1 : rng.int(0, NL - 1), 4, kind === 'narrow' ? 0 : 1.2);
      // rare pickups
      const mid = (s0 + s1) / 2, normal = kind === 'straight' || kind === 'curve' || kind === 'slalom' || kind === 'stairs' || kind === 'waves';
      const freeS = (want) => { let s = want; for (const r of plan.rows) if (Math.abs(s - r.s) < r.ext + 3.5) s = r.s + r.ext + 4; return Math.min(s, s1 - 3); };
      const offRoute = (s) => { const rl = laneOf(route(s)); const o = ALLL.filter((l) => l !== rl); return o[rng.int(0, 1)]; };
      if (s0 >= 150 && normal && s1 > this.next.power) {
        const k = wpick(rng, POWERS, (x) => this.powerW[x] ?? 1) || 'magnet', s = freeS(mid);
        this._powerUp(plan, k, s, rng.chance(0.5) ? offRoute(s) : laneOf(route(s)));
        this.next.power = s + rng.range(560, 720);
      }
      if (s0 >= 450 && normal && !plan.zone && s1 - s0 > 36 && s1 > (this.next.sball ?? 0) && T.allows('critters')) {
        const sc = freeS(mid + 6), l = rng.int(0, NL - 1), sg = rng.chance(0.5) ? 1 : -1;
        this._mk(plan, { kind: 'snowball', s: sc, u: LANES[l], lane: l, uT: sg * (hwFor(NL) + 0.9), sT: sc + 9, ext: 60 });
        this.next.sball = sc + rng.range(NL > 3 ? 150 : 260, NL > 3 ? 280 : 420);
      }
      if (!T.level && s0 >= 1000 && normal && !plan.zone && s1 > (this.next.bait ?? 1000)) {      // BALIK YEMİ: rare, after 1 km
        const s = freeS(mid + 5);
        this._pickup('bait', s, LANES[rng.chance(0.5) ? offRoute(s) : laneOf(route(s))], 1.2, { sc: 1.5, rad: 0.8 });
        this.next.bait = s + rng.range(900, 1400);
      }
      if (!T.level && s0 >= 800 && normal && !plan.zone && s1 > (this.next.bread ?? 800)) {      // YETİ EKMEĞİ: rare warm bread, after 800 m
        const s = freeS(mid - 5);
        this._pickup('bread', s, LANES[rng.chance(0.5) ? offRoute(s) : laneOf(route(s))], 1.2, { sc: 1.5, rad: 0.8 });
        this.next.bread = s + rng.range(1000, 1500);
      }
      if (kind !== 'junction' && (normal || apex)) this._gems(plan, route, s0 + 4, s1 - 3, apex);
      // mini mechanics: speed-pad chain, Y-E-T-I letters, snowplow head-on
      if (s0 >= 250 && normal && s1 > this.next.chain && (this.track.features || {}).boost !== false) {
        const n = rng.int(3, 4), sp = 9, span = n * sp + 12;
        for (let a = s0 + 6; a + span < s1 - 4; a += 3) {
          if (plan.rows.some((r) => a - 6 < r.s + r.ext && a + span + 4 > r.s - r.ext)) continue;
          const l = rng.int(0, NL - 1);
          for (let i = 0; i < n; i++) this._mk(plan, { kind: 'strip', s: a + i * sp, u: LANES[l], len: 4, ext: 3, glow: this._pal(a).glow, power: 1, chain: true });
          for (let x = a + n * sp + 1; x < a + n * sp + 11; x += 1.6) this._pickup('flake', x, LANES[l], 1.35);
          this.next.chain = a + span + rng.range(380, 620);
          break;
        }
      }
      if (this.yetiLetter && s0 >= 300 && normal && s1 > this.next.yeti) {
        const s = freeS(mid + 2);
        this._pickup('letter', s, LANES[offRoute(s)], 1.9, { letter: this.yetiLetter, rad: 1.0 });
        this.next.yeti = s + rng.range(260, 420);
      }
      if (s0 >= 1000 && normal && plan.lethalOk && s1 > this.next.plow && s1 - s0 > 40) {
        const s = freeS(mid), l = rng.int(0, NL - 1);
        this._mk(plan, { kind: 'oncoming', s, sP: s, u: LANES[l], lane: l, vt: 9, ride: false, L: 12, ext: 74, plow: true, glow: this._pal(s).glow });
        this.next.plow = s + rng.range(1100, 1700);
      }
      if (this.scarves && s0 >= 120 && normal && s1 > this.next.scarf) {      // season token: off-route, mostly above a jump arc (h 2.3) or at the end of the piece (slalom)
        const s = kind === 'slalom' ? Math.min(s1 - 6, freeS(s1 - 14)) : freeS(mid + 6);
        this._pickup('scarf', s, LANES[offRoute(s)], rng.chance(0.55) ? 2.3 : 1.3);
        this.next.scarf = s + Math.min(260, 105 + s * 0.016) * rng.range(0.8, 1.25);      // ~8-9 per km early, ~4 per km by 8 km
      }
      if (this.boxes && s0 >= 100 && normal && s1 > this.next.box) {       // (surprise boxes / letters: only when a mode asks for them; the endless run credits rewards silently)
        const s = freeS(mid - 5);
        this._pickup('box', s, LANES[rng.int(0, NL - 1)], 1.1);
        this.next.box = s + rng.range(360, 440);
      }
      if (this.boxes && this.nextLetter && s0 >= 100 && normal && s1 > this.next.letter) {
        const s = freeS(mid + 4);
        this._pickup('letter', s, LANES[offRoute(s)], 1.9, { letter: this.nextLetter, rad: 1.0 });
        this.next.letter = s + rng.range(450, 550);
      }
    }
    // wind gusts / blizzard zones on plain pieces (not on cliff edges or narrow bridges)
    if (!piece.noObs && kind !== 'finish' && (kind === 'straight' || kind === 'curve' || kind === 'slalom' || kind === 'waves')) {
      const hk = this.hk(), len = piece.len;
      const storm = plan.zone === 'storm';
      const cw = cd && cd.wind, cf = cd && cd.fog;      // TERS RÜZGÂR / SİS VADİSİ: the chapter's own gust / fog, on most plain pieces
      if (T.allows('wind') && piece.curb && (storm || cw || plan.diff >= 0.25) && len >= 36 && rng.chance(storm ? 0.85 : cw ? cw : 0.1 + 0.2 * plan.diff)) {
        const l = Math.min(len - 6, rng.range(28, 44));
        this._mk(plan, { kind: 'wind', s: s0 + len / 2, u: 0, len: l, ext: l / 2 + 1, dir: rng.sign(), strength: Math.min(5, rng.range(2.4, 3.8) * (0.8 + 0.25 * hk) * (cw ? 1.2 : 1)), ph: rng.range(0, 6.28) });
      }
      if (T.allows('fog') && !(cd && cd.bonus) && (storm || cf || plan.diff >= 0.3) && len >= 40 && rng.chance(storm ? 0.7 : cf ? cf : 0.07 + 0.15 * plan.diff)) {
        const l = Math.min(len - 4, rng.range(40, 70));
        this._mk(plan, { kind: 'fog', s: s0 + len / 2, u: 0, len: l, ext: l / 2 + 8, maxD: rng.range(0.55, 0.9) });
      }
    }
    // BUZ KAYDIRAĞI strips and TÜNEL sections on plain pieces (never in zones, junction windows or next to hazards)
    if (!piece.noObs && !plan.zone && (kind === 'straight' || kind === 'curve') && piece.len >= 56) {
      let tun = false;
      if (s0 >= 700 && s0 >= this.next.tunnel && !(cd && cd.slide) && T.allows('fog') && piece.len >= 64 && !plan.rows.some((r) => r.rock) && !(this._lastRockS > s0 - 40)) {
        const l = Math.min(piece.len - 10, rng.range(60, 84)), sc = s0 + piece.len / 2;
        this._mk(plan, { kind: 'tunnel', s: sc, u: 0, len: l, ext: l / 2 + 10, n: NL, maxD: rng.range(0.55, 0.7), rowL: plan.rows.filter((r) => r.s > sc - l / 2 + 4 && r.s < sc + l / 2 - 2).map((r) => ({ s: r.s, free: r.free })) });
        this.next.tunnel = s0 + piece.len + rng.range(750, 1100); tun = true;
      }
      if (!tun && s0 >= 320 && s0 >= (cd && cd.slide ? 0 : this.next.slide) && T.allows('ice')) {
        const len = rng.range(26, 34);
        for (let a = s0 + 8; a + len < s1 - 6; a += 3) {
          if (plan.rows.some((r) => a - 8 < r.s + r.ext && a + len + 18 > r.s - r.ext)) continue;
          const l = rng.int(0, NL - 1), sc = a + len / 2;
          this._mk(plan, { kind: 'slide', s: sc, u: LANES[l], len, ext: len / 2 + 1 });
          for (let x = a + 3; x < a + len - 1; x += 2.4) this._pickup('flake', x, LANES[l], 0.9);
          this.next.slide = cd && cd.slide ? s0 + piece.len + 20 : s0 + piece.len + rng.range(380, 650);
          break;
        }
      }
    }
    // SİS VADİSİ edge lights: a line of glowing flakes along both kerbs (they show where the track ends in the fog)
    if (cd && cd.lights && !piece.noObs && (kind === 'straight' || kind === 'curve' || kind === 'slalom')) {
      const sp = 7, hw = (piece.hw || hwFor(NL)) - 0.7;
      for (let s = s0 + 4; s < s1 - 3; s += sp) for (const sg of [-1, 1]) if (!this._rowConflict(plan, s, sg * hw)) this._pickup('flake', s, sg * hw, 0.7, { sc: 0.6, rad: 0.35 });
    }
    // chapter gate: a portal arch where a chapter starts (the first plain piece that reaches it; biome: -1 = no biome change)
    if (plan.chap && !piece.noObs && !piece.narrow && !piece.bonus && (kind === 'straight' || kind === 'curve' || kind === 'slalom') && s1 - s0 > 24) {
      const seg = plan.chap, g = seg.s0 > 100 && seg.s0 > this._gateS && seg.s0 < s1 - 8 ? Math.max(seg.s0, s0 + 8) : -1;
      if (g > 0 && !plan.rows.some((r) => Math.abs(r.s - g) < r.ext + 3)) { this._gateS = seg.s0; this._mk(plan, { kind: 'portal', s: g, u: 0, ext: 3, glow: this._pal(g).glow, biome: -1 }); }
    }
    // register: obstacles and pickups sorted by s (pieces are generated in order)
    plan.batch.sort((a, b) => a.s - b.s);
    for (const ob of plan.batch) this.obs.push(ob);
    const tail = this.picks.splice(n0).sort((a, b) => a.s - b.s);
    for (const k of tail) this.picks.push(k);
  },

  /**
   * Temple Run junction piece content: rows on the approach until 1.2 s before the corner, then NOTHING until 1.0 s after the corner (turn window +
   * corner + exit), rows again on the exit tail. Coins: a flake line that bends into the turn (towards the inner lane) and runs through the corner;
   * a short snow trail right after it. Returns the route function (flake / pickup placement).
   */
  _spawn_junction(plan, p) {
    const T = this.track, J = p.junction, rng = plan.rng, vN = T.speedAt(J.s), vd = T.vGen ? T.vGen(J.s) : 1.1 * vN, early = p.s0 < 40;
    const aEnd = J.s - (1.5 * vd + 6), sFree = J.sEnd + 1.7 * vd + 6, inner = J.dir > 0 ? NL - 1 : 0;
    if (!early && aEnd - p.s0 > 12) this._rows(plan, p.s0 + 5, aEnd, { hardEnd: true });
    const last = plan.rows.length ? plan.rows[plan.rows.length - 1].route : (this._carry ? this._carry.route : NL >> 1);
    const u0 = LANES[last];
    // flake line: stays on the route, drifts to the inner lane over the 2.2 s before the window opens and goes round the corner
    const lastRow = plan.rows.length ? plan.rows[plan.rows.length - 1] : null;
    const sB0 = J.s0 - 2.2 * vN, sA = Math.max(p.s0 + 5, J.s0 - 4.5 * vN, lastRow ? lastRow.s + lastRow.ext + 3 : -1e9);
    const route = (s) => (s <= sB0 ? u0 : s >= J.s ? LANES[inner] : u0 + (LANES[inner] - u0) * smooth((s - sB0) / (J.s - sB0)));
    const sp = this._sp(J.s);
    for (let s = sA; s < J.sEnd + 7; s += sp) this._pickup('flake', s, route(s), 0.95);
    const av = !early && aEnd - p.s0 > 20 ? this._trails(plan, (s) => LANES[last], p.s0 + 3, Math.min(aEnd, J.s0 - 8)) : [];
    this._snowTrail(plan, J.sEnd + 4, 5, () => LANES[inner]);
    // exit tail: rows resume 1.0 s after the corner; the first one is single-verb (the ball may be in any lane after the turn)
    this._carry = { s: J.sEnd, ext: 0, route: NL >> 1, free: FULL, jump: false, pat: 'none', lethal: false, hardN: 0, persist: [], ph: null };
    this._clock = Math.max(this._clock, sFree);
    // (a calm run-in before a lane-forcing piece follows, like on every plain piece)
    const nk = T._q && T._q[0], forced = nk === 'narrow' || nk === 'split' || nk === 'hexHoles' || nk === 'gapRamp' || nk === 'gapJump' || nk === 'skiJump' || nk === 'chasm';
    const tailEnd = p.s1 - (forced ? Math.max(10, 0.6 * vd + 3) : 4);
    if (tailEnd - sFree > 10) {
      const keep = plan.rows; plan.rows = [];
      this._rows(plan, sFree, tailEnd, { dens: 0.7, firstOnly: SINGLE_VERB });
      keep.push(...plan.rows); plan.rows = keep;
    }
    return route;
  },


  /**
   * Rocket power-up: a lane-weaving line of flakes at h ~ 6 along [s0, s1] (the runner calls this when the
   * rocket starts). They are ordinary pickups: collected only while the ball is up there.
   */
  spawnSkyCoins(s0, s1) {
    const T = this.track, vs = T.speedAt(s0), sp = (vs * 60) / T.bpmAt(s0) / 2;
    const n = Math.min(70, Math.floor((s1 - s0) / sp));
    for (let i = 0; i < n; i++) {
      const s = s0 + i * sp, u = LANES[NL - 1] * Math.sin(i * sp * 0.2);
      this._pickup('flake', s, u, 6.7 + 0.25 * Math.sin(i * 0.9));   // rocket flies the ball bottom at h = 6
    }
    this._sortPicks();
    return n;
  },
});

// ---------------------------------------------------------------------------
// Phase 2 obstacle kinds: boost strip, spring pad, slalom gate, conveyor, grind rail, ice bridge tiles,
// waves (valley events), zipline, loop, slowmo marker
// ---------------------------------------------------------------------------
const hash2 = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const SEGL = 4.2;

// boost chevron strip (hiz oklari): lane-wide strip of glowing chevrons; emits one boost pad event on entry
KIND.strip = {
  build(ob) {
    ob.hc = 0.1; ob.tough = 0; ob.color = ob.glow;
    const ns = Math.max(1, Math.round(ob.len / SEGL)), sl = ob.len / ns, s0 = ob.s - ob.len / 2;
    for (let k = 0; k < ns; k++) this._part(ob, 'box', COL.dark, ob.u, 0.03, 0, 0, 1.9, 0.06, sl + 0.05, 0, 0, 0, this._frameOf(s0 + (k + 0.5) * sl));
    const nc = Math.max(2, Math.round(ob.len / 1.8));
    for (let k = 0; k < nc; k++) this._part(ob, 'chev', ob.glow, ob.u, 0.08, 0, 0, 1.4, 1, 1.0, 0, 0, 0, this._frameOf(s0 + (k + 0.5) * (ob.len / nc)));
    ob.was = false;
  },
  hit(ob, ball, events, t) {
    const inside = Math.abs(ball.s - ob.s) <= ob.len / 2 && Math.abs(ball.u - ob.u) <= 1.15 + ball.r * 0.3 && ball.h - ball.r < 0.6;
    if (inside && !ob.was && t >= ob.cdUntil) {
      ob.cdUntil = t + 0.6;
      const e = ev(events, 'pad');
      e.kind = 'boost'; e.onBeat = Math.abs(this.phase) < 0.15 || this.phase > 0.85; e.power = ob.power || 1; e.value = ob.chain ? 1 : 0;
    }
    ob.was = inside;
  },
};

// spring pad (zip zip): big arc, with a coin arc placed by the spawner. pad event kind 'spring' (power > 1)
KIND.spring = {
  build(ob) {
    ob.hc = 0.2; ob.tough = 0; ob.color = ob.glow;
    this._part(ob, 'cyl', COL.dark, ob.u, 0.1, 0, 0, 2.1, 0.2, 2.1);
    ob.coil = [0, 1, 2].map((i) => this._part(ob, 'hex', ob.glow, ob.u, 0.25 + 0.2 * i, 0, 0, 1.25 - 0.1 * i, 1.6, 1.25 - 0.1 * i));
    ob.top = this._part(ob, 'hex', ob.glow, ob.u, 0.9, 0, 0, 1.9, 1, 1.9);
  },
  anim(ob, b, pulse) {
    const k = 1 - 0.55 * pulse;      // coil compresses on the beat
    ob.coil.forEach((p, i) => this._repart(p, ob.u, 0.12 + (0.3 + 0.2 * i) * k, 0, 0, 1.25 - 0.1 * i, 1.6, 1.25 - 0.1 * i));
    this._repart(ob.top, ob.u, 0.22 + 0.7 * k, 0, 0, 1.9, 1, 1.9);
  },
  hit(ob, ball, events, t) {
    if (t < ob.cdUntil || ball.h - ball.r > 0.6) return;
    if (Math.abs(ball.s - ob.s) > 1.05 || Math.abs(ball.u - ob.u) > 1.05 + ball.r * 0.3) return;
    ob.cdUntil = t + 0.8;
    const e = ev(events, 'pad');
    e.kind = 'spring'; e.onBeat = Math.abs(this.phase) < 0.15 || this.phase > 0.85; e.power = ob.power || 1.55;
  },
};

// slalom gate pair: poles + flags. Passing between them emits pickup kind 'gate' (value = chain length)
KIND.gate = {
  build(ob) {
    ob.hc = 1.1; ob.tough = 0; ob.color = ob.flagA; ob.done = false;
    for (const sg of [-1, 1]) {
      this._part(ob, 'box', 0xdfe6ef, ob.u + sg * 1.15, 1.1, 0, 0, 0.12, 2.2, 0.12);
      this._part(ob, 'box', sg < 0 ? ob.flagA : ob.flagB, ob.u + sg * 1.15 - sg * 0.38, 2.0, 0, 0, 0.7, 0.42, 0.05);
    }
  },
  hit(ob, ball, events) {
    if (ob.done || ball.s < ob.s) return;
    ob.done = true;
    const ok = Math.abs(ball.u - ob.u) <= 1.1;
    if (ok) this.gateChain++; else this.gateChain = 0;
    if (ok || ob.grp) {
      const e = ev(events, 'pickup');
      e.kind = 'gate'; e.value = ok ? this.gateChain : 0; e.s = ob.s; e.u = ob.u; e.h = 1.1;
      e.grp = ob.grp || 0; e.idx = ob.idx || 0; e.n = ob.n || 0; e.miss = !ok;
    }
  },
};

// air ring (HAVA HALKASI): glowing ring on the flight path of a big launch ramp; flying through emits pickup kind 'ring' (value = ring number in the group)
KIND.ring = {
  build(ob) {
    ob.hc = 1.2; ob.tough = 0; ob.color = 0xffd24a; ob.done = false;
    ob.r1 = this._part(ob, 'ring', 0xffd24a, ob.u, ob.h, 0, 0, 2.5, 2.5, 0.6);
    ob.r2 = this._part(ob, 'ring', 0xffffff, ob.u, ob.h, 0, 0, 1.9, 1.9, 0.3);
  },
  anim(ob, b, pulse) {
    if (ob.done) return;
    const k = 1 + 0.08 * Math.sin(this.time * 6 + ob.id);
    this._repart(ob.r1, ob.u, ob.h, 0, 0, 2.5 * k, 2.5 * k, 0.6);
    this._repart(ob.r2, ob.u, ob.h, 0, 0, 1.9 * k, 1.9 * k, 0.3);
  },
  hit(ob, ball, events) {
    if (ob.done || ball.s < ob.s) return;
    ob.done = true;
    const ok = Math.abs(ball.u - ob.u) < 1.55 && Math.abs(ball.h - ob.h) < 2.6;
    const e = ev(events, 'pickup');
    e.kind = 'ring'; e.value = ok ? ob.idx : 0; e.miss = !ok; e.grp = ob.grp; e.n = ob.n; e.s = ob.s; e.u = ob.u; e.h = ob.h;
    if (ok) for (const p of ob.parts) this._repart(p, ob.u, ob.h, 0, 0, 3.6, 3.6, 0.1);
  },
};

// snowball fight: a roadside snowman throws an arcing snowball at a lane. A red shadow on the lane warns ~1.1 s ahead; jump or change lane. Not lethal ('snowball' event).
KIND.snowball = {
  build(ob) {
    ob.hc = 0.5; ob.tough = 0; ob.color = 0xffffff; ob.state = 0; ob.warned = false; ob.done = false; ob.mf = new Float64Array(12); ob.TF = 1.1;
    const fT = this._frameOf(ob.sT), sg = Math.sign(ob.uT);
    ob.fT = fT; ob.fC = fT;
    ob.body = this._part(ob, 'ball', 0xf4f7fb, ob.uT, 0.6, 0, 0, 1.2, 1.1, 1.2, 0, 0, 0, fT);
    ob.head = this._part(ob, 'ball', 0xf4f7fb, ob.uT, 1.45, 0, 0, 0.8, 0.8, 0.8, 0, 0, 0, fT);
    ob.hat = this._part(ob, 'box', 0xd8453a, ob.uT, 1.95, 0, 0, 0.6, 0.35, 0.6, 0, 0, 0, fT);
    ob.nose = this._part(ob, 'box', 0xff9a3a, ob.uT - sg * 0.1, 1.45, 0, 0, 0.12, 0.12, 0.35, 0, 0, 0.45, fT);
    ob.sb = this._part(ob, 'ball', 0xffffff, ob.uT, 1.2, 0, 0, 0.0001, 0.0001, 0.0001);
    ob.sh = this._part(ob, 'shadow', 0xff2a2a, ob.u, 0.04, 0, 0, 0.0001, 1, 0.0001);
  },
  anim(ob, b, pulse) {
    if (ob.state === 0) {
      if (this.lastS >= ob.s - this.ballVs * ob.TF) {
        ob.state = 1; ob.tStart = this.time; ob.cS = this.lastS + this.ballVs * ob.TF; ob.fC = this._frameOf(ob.cS);
      } else return;
    }
    const x = (this.time - ob.tStart) / ob.TF;
    if (this.lastS > ob.sT + 30) {
      for (const p of ob.parts) if (p.idx >= 0) { this._release(p.key, p.idx); p.idx = -1; }
      ob.alive = false; return;
    }
    const kx = x < 0.25 ? 1 + 0.25 * Math.sin(x * 12.5) : 1;
    this._repart(ob.head, ob.uT, 1.45 * kx, 0, 0, 0.8 * kx, 0.8 * kx, 0.8 * kx, 0, 0, 0, 0, ob.fT);
    if (x >= 1.15) { this._repart(ob.sb, ob.u, 1, 0, 0, 0.0001, 0.0001, 0.0001); this._repart(ob.sh, ob.u, 0.04, 0, 0, 0.0001, 1, 0.0001); return; }
    const xx = Math.min(1, x), sBall = ob.sT + (ob.cS - ob.sT) * xx, u = ob.uT + (ob.u - ob.uT) * xx, h = 1.3 - 0.4 * xx + 9 * xx * (1 - xx);
    this._frameInto(sBall, ob.mf);
    this._repart(ob.sb, u, h, 0, 0, 0.8, 0.8, 0.8, 0, 0, 0, 0, ob.mf);
    const k = 1.2 + 0.2 * Math.sin(this.time * 18) + 0.6 * xx;
    this._repart(ob.sh, ob.u, 0.05, 0, 0, k, 1, k, 0, 0, 0, 0, ob.fC);
  },
  hit(ob, ball, events) {
    if (ob.state !== 1 || ob.done) return;
    if (!ob.warned && this._cid === 'main') { ob.warned = true; const e = ev(events, 'warn'); e.kind = 'snowball'; e.lane = ob.lane; e.t = ob.TF; e.value = 0; }
    if (this.time - ob.tStart < ob.TF) return;
    ob.done = true;
    if (Math.abs(ball.s - ob.cS) < 3 && Math.abs(ball.u - ob.u) < 1.05 && ball.h - ball.r < 1.3) {
      const e = ev(events, 'snowball'); e.s = ob.cS; e.u = ob.u; e.h = 1;
    }
  },
};

// funnel arrows on a narrowing piece: red slanted bars on the lanes that close
KIND.funnel = {
  build(ob) {
    ob.hc = 0.05; ob.tough = 0; ob.color = 0xff4a3a;
    const keep = hwFor(3) - 1.4 + 0.01;
    for (let l = 0; l < ob.nl; l++) {
      const u = (l - (ob.nl - 1) / 2) * LANE_W;
      if (Math.abs(u) <= keep) continue;
      for (let r = 0; r < 4; r++) this._part(ob, 'box', 0xff4a3a, u, 0.04, -Math.sign(u) * 0.7, 0, 1.7, 0.05, 0.3, 0, 0, r * 3.2);
    }
  },
  hit() {},
};

// conveyor patch: pushes the ball sideways. emits { type:'push', du } (du = drift speed in m/s, per frame while on it)
KIND.conveyor = {
  build(ob) {
    ob.hc = 0.05; ob.tough = 0; ob.color = COL.dark;
    const rows = Math.max(2, Math.round(ob.len / 1.6)), s0 = ob.s - ob.len / 2;
    ob.chev = [];
    for (let r = 0; r < rows; r++) {
      const f = this._frameOf(s0 + (r + 0.5) * (ob.len / rows));
      for (const g of ob.groups) {
        this._part(ob, 'box', 0x39445a, (g.uMin + g.uMax) / 2, 0.025, 0, 0, g.uMax - g.uMin, 0.05, ob.len / rows + 0.04, 0, 0, 0, f);
        const nc = Math.max(1, Math.round((g.uMax - g.uMin) / 1.3));
        for (let c = 0; c < nc; c++) {
          const p = this._part(ob, 'chev', ob.glow, 0, 0.07, ob.dir > 0 ? -PI / 2 : PI / 2, 0, 1.0, 1, 1.0, 0, 0, 0, f);
          p.g = g; p.c = c; p.nc = nc; ob.chev.push(p);
        }
      }
    }
  },
  anim(ob) {
    const t = this.time * 1.8;
    for (const p of ob.chev) {
      const w = (p.g.uMax - p.g.uMin) / p.nc, x = (((p.c + (t * ob.dir) / 1.3) % p.nc) + p.nc) % p.nc;
      this._repart(p, p.g.uMin + (x + 0.5) * w, 0.07, ob.dir > 0 ? -PI / 2 : PI / 2, 0, 1.0, 1, 1.0, 0, 0, 0, 0, p.f);
    }
  },
  hit(ob, ball, events) {
    if (ball.h - ball.r > 0.45 || Math.abs(ball.s - ob.s) > ob.len / 2) return;
    for (const g of ob.groups) if (ball.u > g.uMin && ball.u < g.uMax) { const e = ev(events, 'push'); e.du = ob.dir * ob.push; return; }
  },
};

// grind rail (Buz Rayi): low rail along one lane (ghost: it never blocks). Landing on it (bottom within ~0.3 m of the rail)
// attaches: { type:'grind', active:true, s0,s1,u,h }, and { type:'grind', active:false, done } when it ends / you leave
KIND.rail = {
  build(ob) {
    ob.hc = ob.railH; ob.tough = 0; ob.color = 0xc9d2e0; ob.grind = false;
    const ns = Math.max(2, Math.round(ob.len / SEGL)), sl = ob.len / ns, s0 = ob.s - ob.len / 2;
    for (let k = 0; k < ns; k++) {
      const f = this._frameOf(s0 + (k + 0.5) * sl);
      this._part(ob, 'box', 0xc9d2e0, ob.u, ob.railH - 0.09, 0, 0, 0.3, 0.18, sl + 0.04, 0, 0, 0, f);
      this._part(ob, 'box', ob.glow, ob.u, ob.railH + 0.01, 0, 0, 0.12, 0.04, sl + 0.04, 0, 0, 0, f);
      this._part(ob, 'box', COL.dark, ob.u, ob.railH * 0.5, 0, 0, 0.12, ob.railH, 0.12, 0, 0, -sl * 0.5, f);
    }
    this._part(ob, 'box', COL.dark, ob.u, ob.railH * 0.5, 0, 0, 0.12, ob.railH, 0.12, 0, 0, 0, this._frameOf(ob.s + ob.len / 2));
    ob.r = { s0, s1: ob.s + ob.len / 2, u: ob.u, h: ob.railH };
  },
  hit(ob, ball, events) {
    const r = ob.r, bottom = ball.h - ball.r;
    if (!ob.grind) {
      if (ball.s >= r.s0 && ball.s <= r.s1 - 2 && Math.abs(ball.u - r.u) <= 0.8 && bottom >= r.h - 0.3 && bottom <= r.h + 0.4 && ball.vh <= 1.5) {
        ob.grind = true;
        const e = ev(events, 'grind');
        e.active = true; e.s0 = r.s0; e.s1 = r.s1; e.u = r.u; e.h = r.h; e.id = ob.id;
      }
    } else {
      const end = ball.s > r.s1, off = bottom > r.h + 0.9 || Math.abs(ball.u - r.u) > 1.0;
      if (end || off) {
        ob.grind = false; ob.cdUntil = this.time + 0.5;
        const e = ev(events, 'grind');
        e.active = false; e.done = end; e.s0 = r.s0; e.s1 = r.s1; e.u = r.u; e.h = r.h; e.id = ob.id;
      }
    }
  },
};

// ice bridge: collapsing tiles. State is shared with the track piece (p.ice.state: 0 ok / 1 cracking / 2 fallen)
KIND.icebridge = {
  build(ob) {
    const p = ob.piece, ice = p.ice;
    ob.hc = 0; ob.tough = 0; ob.color = COL.ice; ob.tile = []; ob.lastBeat = -1; ob.crackQ = [];
    ice.tDelay = new Float32Array(ice.n * 3).fill(0.5);
    for (let r = 0; r < ice.n; r++) {
      const f = this._frameOf(ice.s0b + (r + 0.5) * ice.rowLen);
      for (let c = 0; c < 3; c++) {
        const part = this._part(ob, 'box', (r + c) & 1 ? 0xbfe9ff : 0xa6d9f2, LANES[c], -0.2, 0, 0, 2.3, 0.4, ice.rowLen - 0.1, 0, 0, 0, f);
        part.f0 = f; ob.tile.push(part);
      }
    }
  },
  anim(ob, b) {
    const p = ob.piece, ice = p.ice, t = this.time;
    // beat-ahead cracks: each beat a tile ~1.1 s ahead of the ball may start cracking (one per row, rows >= 3 apart)
    const bi = Math.floor(b);
    if (bi !== ob.lastBeat) {
      ob.lastBeat = bi;
      if (this.lastS > ice.s0b - 8 && this.lastS < ice.s1b - 6 && hash2(bi * 1.37 + ob.id * 3.1) < 0.4 + 0.4 * p.diff) {
        const row = Math.floor((this.lastS + this.ballVs * 1.1 - ice.s0b) / ice.rowLen), col = Math.floor(hash2(bi * 2.71 + ob.id) * 3);
        if (row >= 0 && row < ice.n && row - ice.lastRow >= 3 && ice.state[row * 3 + col] === 0) {
          ice.lastRow = row; ice.state[row * 3 + col] = 1; ice.t0[row * 3 + col] = t; ice.tDelay[row * 3 + col] = 0.5;
          ob.crackQ.push(ice.s0b + (row + 0.5) * ice.rowLen, LANES[col]);
        }
      }
    }
    for (let i = 0; i < ob.tile.length; i++) {
      const st = ice.state[i], part = ob.tile[i];
      if (part.idx < 0 || st === 0) continue;
      const r = (i / 3) | 0, c = i % 3, el = t - ice.t0[i];
      if (st === 1) {
        if (el >= ice.tDelay[i]) { ice.state[i] = 2; ice.t0[i] = t; continue; }
        const j = 0.05 * Math.sin(el * 55);
        this._repart(part, LANES[c] + j, -0.2 + 0.03 * Math.sin(el * 70), 0, 0.04 * Math.sin(el * 40), 2.3, 0.4, ice.rowLen - 0.1, 0, 0, 0, 0, part.f0);
        if (!part.hot) { part.hot = true; this._col('box', part.idx, 0xffffff, 1); }
      } else {
        if (el > 1.5) { this._release('box', part.idx); part.idx = -1; continue; }
        const dh = -0.2 - 14 * el * el;
        this._repart(part, LANES[c], dh, 0, 0.6 * el * (c - 1), 2.3, 0.4, ice.rowLen - 0.1, 0, 0, 0, 0, part.f0);
      }
    }
  },
  hit(ob, ball, events, t) {
    const ice = ob.piece.ice;
    while (ob.crackQ.length) { const e = ev(events, 'crack'); e.s = ob.crackQ.shift(); e.u = ob.crackQ.shift(); }
    if (ball.s < ice.s0b || ball.s >= ice.s1b || ball.h - ball.r > 0.45) return;
    const row = ((ball.s - ice.s0b) / ice.rowLen) | 0, col = ball.u < -1.2 ? 0 : ball.u > 1.2 ? 2 : 1, i = row * 3 + col;
    if (ice.state[i] === 0) {
      ice.state[i] = 1; ice.t0[i] = t;
      ice.tDelay[i] = 0.55;
      const e = ev(events, 'crack');
      e.s = ice.s0b + (row + 0.5) * ice.rowLen; e.u = LANES[col];
    }
  },
};

// waves (Tiny Wings hills): { type:'valley', depth (0..1), ok: first frame } while the ball is in a trough
KIND.waves = {
  build(ob) { ob.hc = 0; ob.tough = 0; ob.color = 0; ob.inV = false; },
  hit(ob, ball, events) {
    const v = this.track.valleyAt(ball.s);
    if (v > 0 && ball.h - ball.r < 0.6) {
      const e = ev(events, 'valley');
      e.depth = v; e.ok = !ob.inV; e.s = ball.s;
      ob.inV = true;
    } else ob.inV = false;
  },
};

// zipline: { type:'zip', s0, s1, u, h } once when the ball reaches the start gate (runner lane-locks and hangs the ball)
KIND.zip = {
  build(ob) { ob.hc = ob.zip.h; ob.tough = 0; ob.color = 0; ob.fired = false; },
  hit(ob, ball, events) {
    if (ob.fired || ball.s < ob.zip.s0) return;
    ob.fired = true;
    const e = ev(events, 'zip');
    e.s0 = ob.zip.s0; e.s1 = ob.zip.s1; e.u = ob.zip.u; e.h = ob.zip.h; e.id = ob.id;
  },
};

// loop: { type:'loop', minSpeed, s0, s1, R } a few metres before the circle starts
KIND.loop = {
  build(ob) { ob.hc = 0; ob.tough = 0; ob.color = 0; ob.fired = false; },
  hit(ob, ball, events) {
    const L = ob.loop;
    if (ob.fired || ball.s < L.s0 - 6) return;
    ob.fired = true;
    const e = ev(events, 'loop');
    e.minSpeed = L.minSpeed; e.s0 = L.s0; e.s1 = L.s1; e.R = L.R; e.value = L.plannedSpeed; e.id = ob.id;
  },
};

// slowmo marker for skiJump: { type:'slowmo', s0, s1, scale } when the ball reaches the lip
KIND.slowmo = {
  build(ob) { ob.hc = 0; ob.tough = 0; ob.color = 0; ob.fired = false; },
  hit(ob, ball, events) {
    const m = ob.slow;
    if (ob.fired || ball.s < m.s0 - 1) return;
    ob.fired = true;
    const e = ev(events, 'slowmo');
    e.s0 = m.s0; e.s1 = m.s1; e.scale = m.scale; e.id = ob.id;
  },
};

// ---------------------------------------------------------------------------
// Phase 2 spawning helpers + per-set-piece content (_spawn_<kind>)
// ---------------------------------------------------------------------------
Object.assign(Obstacles.prototype, {
  _sp(s) { const T = this.track; return (T.speedAt(s) * 60) / T.bpmAt(s) / 2; },       // 8th-note spacing in metres

  /** coin arc along a ballistic jump from (s, u) with launch speed vh (ball bottom height y(t)); returns the flight distance */
  _arcFlakes(plan, s, u, vh, h0 = 0) {
    const T = this.track, vs = T.speedAt(s), sp = this._sp(s), tf = (vh + Math.sqrt(vh * vh + 2 * AIR_G * Math.max(0, h0))) / AIR_G;
    for (let t = sp / vs * 0.8; t < tf - 0.12; t += sp / vs) {
      const y = h0 + vh * t - 0.5 * AIR_G * t * t;
      if (y > -0.2) this._pickup('flake', s + vs * t, u, 0.75 + Math.max(0, y));
    }
    return vs * tf;
  },

  _rowArcs(plan) {
    const T = this.track, arcs = [];
    for (const r of plan.rows) if (r.jump || r.pat === 'low') {
      const vs = T.speedAt(r.s), fl = vs * ((2 * AIR_VH) / AIR_G);
      arcs.push({ s0: r.s - fl / 2, len: fl, vs, base: 0.55, vh: AIR_VH });
    }
    return arcs;
  },

  /** spring pad (zip zip): big arc + coin arc. Returns the flight distance (rows resume after it). */
  _spring(plan, s, lane, power = 1.55) {
    const u = LANES[lane], vh = this.jumpPadV * power;
    this._mk(plan, { kind: 'spring', s, u, ext: 2, glow: this._pal(s).glow, power });
    return this._arcFlakes(plan, s + 1.2, u, vh);
  },

  _funnel(plan, piece) {
    this._mk(plan, { kind: 'funnel', s: piece.s0 + 3, u: 0, nl: piece.n, ext: 14 });
  },

  /** bonus pieces: 'air' = big launch ramp + a line of air rings (HAVA HALKALARI), 'slalom' = alternating gates (SLALOM KAPILARI) */
  _spawnBonus(plan, piece) {
    const T = this.track, rng = plan.rng, s0 = piece.s0, s1 = piece.s1, pal = this._pal(s0), vs = T.speedAt(s0 + 20);
    if (piece.bonus === 'air') {
      const vh = AIR_G * 1.25, power = vh / this.jumpPadV, sS = s0 + 9;
      for (let l = 0; l < NL; l++) this._mk(plan, { kind: 'spring', s: sS, u: LANES[l], ext: 2, glow: pal.glow, power });
      const tf = (2 * vh) / AIR_G, rings = [];
      let lane = rng.int(0, NL - 1);
      for (let t = 0.7; t < tf - 0.4; t += 0.38) {
        if (rings.length) {
          const st = NL >= 5 && rng.chance(0.3) ? 2 : 1, d = rng.chance(0.5) ? 1 : -1;
          let nl = clamp(lane + d * st, 0, NL - 1);
          if (nl === lane) nl = clamp(lane - d * st, 0, NL - 1);
          lane = nl;
        }
        rings.push({ t, lane });
      }
      rings.forEach((r, i) => {
        const y = vh * r.t - 0.5 * AIR_G * r.t * r.t, s = sS + 1.2 + vs * r.t;
        this._mk(plan, { kind: 'ring', s, u: LANES[r.lane], h: 0.75 + y, idx: i + 1, n: rings.length, grp: piece.id, ext: 4 });
        if (i + 1 < rings.length) { const n2 = rings[i + 1], tm = (r.t + n2.t) / 2, ym = vh * tm - 0.5 * AIR_G * tm * tm; this._pickup('flake', sS + 1.2 + vs * tm, (LANES[r.lane] + LANES[n2.lane]) / 2, 0.75 + ym); }
      });
      this._snowGroup(plan, Math.min(s1 - 6, sS + 1.2 + vs * tf + 4), NL >> 1, 4, 0.8);
    } else {
      const n = 5, sp = vs * 0.85, list = [];
      let lane = rng.int(0, NL - 1), dir = lane > (NL - 1) / 2 ? -1 : 1;
      for (let i = 0; i < n; i++) {
        const s = s0 + 12 + i * sp;
        this._mk(plan, { kind: 'gate', s, u: LANES[lane], ext: 2, flagA: 0xffc83a, flagB: 0xff6a3a, grp: piece.id, idx: i + 1, n });
        list.push({ s, u: LANES[lane] });
        let nl = lane + dir * (NL >= 4 && rng.chance(0.4) ? 2 : 1);
        if (nl < 0 || nl > NL - 1) { dir = -dir; nl = lane + dir; }
        lane = clamp(nl, 0, NL - 1);
      }
      list.forEach((g, i) => { this._pickup('flake', g.s, g.u, 1.1); const nx = list[i + 1]; if (nx) this._pickup('flake', (g.s + nx.s) / 2, (g.u + nx.u) / 2, 1.0); });
    }
  },

  _gates(plan, sA, sB) {
    const T = this.track, rng = plan.rng, list = [];
    let s = sA, lane = rng.int(0, NL - 1);
    while (s < sB) {
      this._mk(plan, { kind: 'gate', s, u: LANES[lane], ext: 2, flagA: 0xe8473a, flagB: 0x3a7de8 });
      list.push({ s, u: LANES[lane] });
      const opts = ALLL.filter((l) => l !== lane && (Math.abs(l - lane) === 1 || plan.diff > 0.3));
      lane = opts[rng.int(0, opts.length - 1)];
      s += T.speedAt(s) * (1.15 - 0.2 * plan.diff);
    }
    plan.gates = list;
    return list.length;
  },
  _gateRoute(plan, baseLane) {
    const g = plan.gates || [];
    return (s) => {
      if (!g.length) return LANES[baseLane];
      if (s <= g[0].s) return g[0].u;
      for (let i = 0; i < g.length - 1; i++) {
        const a = g[i], b = g[i + 1];
        if (s < b.s) return a.u + (b.u - a.u) * smooth((s - a.s - 1.5) / Math.max(1, b.s - a.s - 3));
      }
      return g[g.length - 1].u;
    };
  },

  /** boost chevron strip in the route lane, somewhere without rows */
  _placeStrip(plan, route, sA, sB, len = 12) {
    const rng = plan.rng;
    for (let s = sA; s + len < sB; s += 3) {
      if (plan.rows.some((r) => s - 6 < r.s + r.ext && s + len + 4 > r.s - r.ext)) continue;
      const sc = s + len / 2, lane = laneOf(route(sc));
      this._mk(plan, { kind: 'strip', s: sc, u: LANES[lane], len, ext: len / 2 + 1, glow: this._pal(sc).glow, power: 1 });
      return true;
    }
    return false;
  },

  /** split piece: only one side lane is ever blocked (the centre lane is missing, so you cannot swap sides). Returns the free lane. */
  _splitRows(plan, p) {
    const T = this.track, rng = plan.rng, bl = rng.chance(0.5) ? 0 : NL - 1, ol = NL - 1 - bl;
    let s = p.holeS0 + 2;
    while (s < p.holeS1 - 3) {
      const type = this._pickStatic(plan, (n) => n !== 'cabin' && n !== 'rock' && n !== 'stone');
      this._scaled(plan, type, s, bl);
      plan.rows.push({ s, ext: DEFS[type].ext, free: bit(ol), jump: false, route: ol, pat: 'single' });
      s += T.speedAt(s) * rng.range(1.2, 1.9) + 3;
    }
    return ol;
  },

  /** coinRain relief zone: two weaving coin lines (offset half a wave) filling most of the piece */
  _coinRain(plan, route, sA, sB) {
    const T = this.track, rng = plan.rng, sp = this._sp(sA);
    const ph = rng.range(0, TAU), lam = rng.range(24, 36), uA = (s) => clamp(route(s) + 1.6 * Math.sin(TAU * (s - sA) / lam + ph), -2.4, 2.4);
    for (let s = sA; s < sB; s += sp) {
      this._pickup('flake', s, uA(s), 0.95);
      const s2 = s + sp * 0.5;
      if (s2 < sB) this._pickup('flake', s2, clamp(-uA(s2), -2.4, 2.4), 0.95);
    }
  },

  /** is a row (or its depth) blocking the lane at (s, u)? (coins must not lead into a blocked lane) */
  _rowConflict(plan, s, u) {
    const lane = laneOf(u);
    for (const r of plan.rows) if (Math.abs(s - r.s) < r.ext + 2 && !(r.free & (1 << lane))) return true;
    return false;
  },

  // ----- helix: rows along the whole spiral (60% density, one verb per row, never lethal) + route coins + snow trails -----
  _spawn_helix(plan, p) {
    this._rows(plan, p.s0 + 10, p.s1 - 6, { dens: 0.6, only: SINGLE_VERB, noLethal: true });
    const route = this._routeFn(plan, 1), arcs = this._rowArcs(plan);
    const av = this._trails(plan, route, p.s0 + 6, p.s1 - 4);
    this._flakeRuns(plan, route, p.s0 + 8, p.s1 - 4, arcs, av);
    return { route, arcs, trailed: true };
  },

  // ----- waves: rows + coin arcs over each crest, valley events -----
  _spawn_waves(plan, p) {
    const w = p.wave, rng = plan.rng;
    this._mk(plan, { kind: 'waves', s: (p.s0 + p.s1) / 2, u: 0, ext: p.len / 2 + 2, piece: p });
    this._rows(plan, p.s0 + 10, p.s1 - 8, {});
    const route = this._routeFn(plan, 1), sp = this._sp(p.s0 + 20);
    const av = this._trails(plan, route, p.s0 + 6, p.s1 - 4);
    for (let j = 0; j < w.k; j++) {                            // crest = pitch decreasing fastest (cos = -1)
      const sc = p.s0 + (p.len * (j + 0.5)) / w.k;
      if (plan.rows.some((r) => Math.abs(sc - r.s) < r.ext + 5) || av.some((r) => sc > r[0] - 6 && sc < r[1] + 6)) continue;
      for (let i = -3; i <= 3; i++) this._pickup('flake', sc + i * sp, route(sc + i * sp), 0.9 + 1.2 * (1 - (i / 3) * (i / 3)));
    }
    return { route, arcs: this._rowArcs(plan), trailed: true };
  },

  // ----- iceBridge: collapsing tiles + a coin line down the middle lane -----
  _spawn_iceBridge(plan, p) {
    const ice = p.ice;
    this._mk(plan, { kind: 'icebridge', s: (ice.s0b + ice.s1b) / 2, u: 0, ext: (ice.s1b - ice.s0b) / 2 + 4, piece: p });
    const route = () => LANES[NL >> 1];
    this._flakeRuns(plan, route, p.s0 + 4, p.s1 - 3, []);
    return { route };
  },

  // ----- halfpipe / tube: single-verb rows on the floor lanes (60%), coins along the walls (swipe past the outer lane) -----
  _spawn_halfpipe(plan, p) {
    this._rows(plan, p.s0 + 12, p.s1 - 10, { dens: 0.6, only: SINGLE_VERB, noLethal: true });
    const route = this._routeFn(plan, 1), T = this.track, sp = this._sp(p.s0 + 20), arcs = this._rowArcs(plan);
    const av = this._trails(plan, route, p.s0 + 8, p.s1 - 6);
    this._flakeRuns(plan, route, p.s0 + 10, p.s1 - 8, arcs, av);
    // wall coins: ride the wall at |u| ~ floor + 2.4 k (k = pipe scale at s)
    for (const sg of [-1, 1]) {
      let n = 0;
      for (let s = p.s0 + 16 + (sg > 0 ? 6 : 0); s < p.s1 - 14 && n < 9; s += sp, n++) {
        const u = sg * (p.pipe.floor + 2.6 * p.pipeK(s)), h = Math.max(0, T.surfaceAt(s, u));
        this._pickup('flake', s, u, h + 0.9);
      }
    }
    return { route, arcs, trailed: true };
  },
  _spawn_tube(plan, p) {
    this._rows(plan, p.s0 + 10, p.s1 - 8, { dens: 0.6, only: SINGLE_VERB, noLethal: true });
    const route = this._routeFn(plan, 1), arcs = this._rowArcs(plan);
    const av = this._trails(plan, route, p.s0 + 6, p.s1 - 6);
    this._flakeRuns(plan, route, p.s0 + 8, p.s1 - 6, arcs, av);
    return { route, arcs, trailed: true };
  },

  // ----- zipline: start-gate trigger + a coin line along the rope (hang height) -----
  _spawn_zipline(plan, p) {
    const z = p.zip, sp = this._sp(p.gapS0);
    this._mk(plan, { kind: 'zip', s: (z.s0 + z.s1) / 2, u: 0, ext: (z.s1 - z.s0) / 2 + 4, zip: z });
    for (let s = p.gapS0 + 1; s < p.gapS1; s += sp) this._pickup('flake', s, z.u, z.h - 1.3);
    return { route: () => 0 };
  },

  // ----- loop: speed strips in all 3 lanes before the circle, single-verb rows on the entry / exit and on the low arcs (never over the top), coins along the route -----
  _spawn_loop(plan, p) {
    const L = p.loop, pal = this._pal(L.s0), len = L.s1 - L.s0;
    this._mk(plan, { kind: 'loop', s: (L.s0 + L.s1) / 2, u: 0, ext: (L.s1 - L.s0) / 2 + 12, loop: L });
    if ((this.track.features || {}).boost !== false) for (let l = 0; l < NL; l++) this._mk(plan, { kind: 'strip', s: L.s0 - 8, u: LANES[l], len: 14, ext: 8, glow: pal.glow, power: 1 });
    // rows: before the strips, on the first / last third of the circle (not at the top: a hit there would stall the ball), after the circle
    const okAt = (s) => { if (s < L.s0 - 22 || s > L.s1 + 3) return true; const th = (s - L.s0) / len; return (th > 0.07 && th < 0.3) || (th > 0.7 && th < 0.93); };
    this._rows(plan, p.s0 + 8, p.s1 - 4, { dens: 0.6, only: SINGLE_VERB, okAt, noLethal: true });
    const route = this._routeFn(plan, 1), sp = this._sp(L.s0);
    for (let s = L.s0 + 3; s < L.s1 - 3; s += sp) { const u = route(s); if (!this._rowConflict(plan, s, u)) this._pickup('flake', s, u, 0.9); }
    this._trails(plan, route, p.s0 + 6, L.s0 - 24);
    return { route, trailed: true };
  },

  // ----- corkscrew: coin pinwheel whose lane rotates with the road + single-verb rows where the road is not rolled past ~55 deg -----
  _spawn_corkscrew(plan, p) {
    const c = p.corkscrew, sp = this._sp(c.s0), T = this.track;
    this._rows(plan, p.s0 + 5, p.s1 - 4, { dens: 0.6, only: SINGLE_VERB, okAt: (s) => Math.cos(T.rollAt(s)) > 0.55, noLethal: true });
    let k = 0;
    for (let s = c.s0 - 4; s < c.s1 + 4; s += sp, k++) { const u = LANES[(k + Math.floor(k / 6)) % 3]; if (!this._rowConflict(plan, s, u)) this._pickup('flake', s, u, 1.0); }
    const route = this._routeFn(plan, 1);
    this._trails(plan, route, p.s1 - 2, p.s1 + 0, { noBreath: true });
    return { route, trailed: false };
  },
});

// ---------------------------------------------------------------------------
// Difficulty mechanics: oncoming trains, overhead (duck) barriers, beat-sliding walls, wind gusts, fog zones,
// yeti boulders, campaign finish; hardness; near / over skill events; rideable platforms (platformAt)
// ---------------------------------------------------------------------------
const bit6 = (l) => 1 << l;
const ONC = { L: 12, SEG: 4, H: 2.3, RL: 9 };

Object.assign(Obstacles.prototype, {
  /** effective hardness: explicit setHardness(k), else track.hardness. Read at spawn time, so mid-run changes only touch new pieces. */
  hk() { return this._hk != null ? this._hk : (this.track.hardness || 1); },
  setHardness(k) { this._hk = clamp(+k || 1, 0.4, 3); },

  /** 'near' (passed within r + 0.7 m laterally without a hit) and 'over' (passed above while airborne) skill events, once per obstacle */
  _pass(ob, ball, events, cs, cu, hs, hu, ht) {
    if (ob.passDone) return;
    const ds = ball.s - cs, r = ball.r;
    if (ds > -hs - r && ds < hs + r) {
      const lat = Math.abs(ball.u - cu) - hu - r;
      if (lat < ob.minLat) { ob.minLat = lat; ob.nearSide = ball.u >= cu ? 1 : -1; }
      if (lat < 0 && ball.h - r > ht) ob.over = true;
    } else if (ds >= hs + r) {
      ob.passDone = true;
      if (!ob.hitDone && ob.tough > 0) {
        if (ob.over) { const e = ev(events, 'over'); e.toughness = ob.tough; e.s = cs; e.u = cu; }
        else if (ob.minLat < 0.4 && ob.tough >= 2) { const e = ev(events, 'near'); e.toughness = ob.tough; e.side = ob.nearSide; e.s = cs; e.u = cu; }
      }
    }
  },

  /**
   * Rideable roofs: height of a platform (train roof / its ramp) at (s, u), or -Infinity.
   * The runner should use max(track.surfaceAt(s, u), obstacles.platformAt(s, u)) as the ground height.
   */
  platformAt(s, u) {
    let best = -Infinity;
    const P = this.platforms;
    for (let i = 0; i < P.length; i++) {
      const ob = P[i];
      if (!ob.alive) continue;
      const cs = ob.cs !== undefined ? ob.cs : ob.s, cu = ob.cu !== undefined ? ob.cu : ob.u;
      if (u < cu - 1.2 || u > cu + 1.2) continue;
      if (!(ob.rl > 0) && s < cs - ob.L / 2) continue;
      const front = cs - ob.L / 2;
      let h = -Infinity;
      if (s >= front - ob.rl && s < front) h = (ob.H * (s - (front - ob.rl))) / ob.rl;
      else if (s >= front && s <= front + ob.L) h = ob.H;
      if (h > best) best = h;
    }
    return best;
  },

  /** forget everything (campaign level restart). Call together with track.setLevel(). */
  reset() {
    for (const ob of this.obs) this._freeOb(ob);
    this.obs.length = 0;
    for (const p of this.picks) if (p.alive) this._freePick(p);
    this.picks.length = 0;
    for (const b of this.dyn.slice()) this._freeDyn(b);
    for (const d of this.deb) if (d.on) { d.on = false; this._release('box', d.idx); d.idx = -1; }
    this.pending.length = 0; this.platforms.length = 0; this.rowsLog.length = 0; this._lastRockS = undefined; this._vt = null; this.warnQ.length = 0; this.byId.clear();
    this.maxExt = 4.6; this.gateChain = 0; this.nextBoulder = 1e9; this._bArmed = false; this._gateS = -1;
    this.next = { power: 260, gem: 520, box: 340, letter: 300, chain: 420, yeti: 330, plow: 1000, tunnel: 900, slide: 380 };
    this._carry = null; this._clock = 0; this._nextCrit = this.track.level ? 130 : 160; this._teach = 0; this._breath = null; this._snowOwed = 0; this.tierBias = 0;
    if (this.critters) this.critters.reset();
    this.rng = makeRng((this.seed ^ (this.track.seed | 0) ^ 0xa5a5a5a5) >>> 0);
  },

  // ----- critters + runner-facing helpers -----
  /** pop a critter after a stomp (squash + poof). Returns true if it was alive. */
  killCritter(id) { return this.critters.kill(id); },

  /** the run's tier (0..4): bigger balls meet more lethal blockers (weight x min(2.2, 1 + 0.3 * bias), see lethalK) */
  setTierBias(t) { this.tierBias = clamp(+t || 0, 0, 6); },

  /** tint the blockers the ball can smash at size `tier` (tier + 1 >= toughness + 2) 30% towards white; reverted when the tier drops */
  markSmashable(tier) {
    this._smashTier = tier;
    for (const ob of this.obs) if (ob.alive && ob.tough > 0 && ob.kind === 'static') this._tintSmash(ob, tier + 1 >= ob.tough + 2);
  },
  _tintSmash(ob, on) {
    if (!!ob.smashTint === on) return;
    ob.smashTint = on;
    for (const p of ob.parts) if (p.idx >= 0 && (p.key === 'box' || p.key === 'cyl' || p.key === 'ball' || p.key.indexOf('rock') === 0)) this._tint(p, on ? 0.3 : 0);
  },
  _tint(p, k) {
    const a = this.pool[p.key].m.instanceColor.array, i = p.idx * 3;
    if (p.c0 === undefined) { p.c0 = a[i]; p.c1 = a[i + 1]; p.c2 = a[i + 2]; }
    a[i] = p.c0 + (1 - p.c0) * k; a[i + 1] = p.c1 + (1 - p.c1) * k; a[i + 2] = p.c2 + (1 - p.c2) * k;
    this.pool[p.key].cdirty = true;
  },

  /** silently remove / resolve everything with s in [s0, s1] (tutorial, revive): no events, no debris */
  clearRange(s0, s1) {
    for (const ob of this.obs) {
      if (!ob.alive || ob.s < s0 || ob.s > s1) continue;
      ob.alive = false;
      if (ob.pending) { ob.pending = false; const i = this.pending.indexOf(ob); if (i >= 0) this.pending.splice(i, 1); }
      for (const p of ob.parts) if (p.idx >= 0) { this._release(p.key, p.idx); p.idx = -1; }
    }
    for (const r of this.critters.live) if (r.on && r.s >= s0 && r.s <= s1) this.critters.kill(r.id);
  },

  /** the nearest upcoming threat of a kind in (s0, s1]: { s, lane } for 'boulder' (landing disc) | 'slidewall' | 'oncoming', else null */
  nextThreat(kind, s0, s1) {
    let best = null;
    if (kind === 'boulder') { for (const b of this.dyn) if (b.phase === 0 && b.sLand > s0 && b.sLand <= s1 && (!best || b.sLand < best.s)) best = { s: b.sLand, lane: b.lane }; return best; }
    for (const ob of this.obs) {
      if (!ob.alive || ob.kind !== kind) continue;
      const s = ob.cs !== undefined ? ob.cs : ob.s;
      if (s > s0 && s <= s1 && (!best || s < best.s)) best = { s, lane: ob.lane !== undefined ? ob.lane : 1 };
    }
    return best;
  },

  /** tint the blockers that killed the ball red (death read-out) */
  tintKiller(id) {
    const ob = this.byId.get(id);
    if (!ob) return;
    for (const p of ob.parts) if (p.idx >= 0 && this.pool[p.key] && p.key !== 'shadow') { this._tint(p, 0); const a = this.pool[p.key].m.instanceColor.array, i = p.idx * 3; a[i] = Math.min(1, a[i] * 0.4 + 0.75); a[i + 1] *= 0.3; a[i + 2] *= 0.3; this.pool[p.key].cdirty = true; }
  },

  // ----- boulders (yeti throws) -----
  _forcedStretch(sA, sB) {
    for (const p of this.track.pieces) {
      if (p.s1 < sA || p.s0 > sB) continue;
      const k = p.kind;
      if (k === 'narrow' || k === 'split' || k === 'hexHoles' || k === 'iceBridge' || k === 'zipline' || k === 'gapRamp' || k === 'gapJump' || k === 'skiJump' || k === 'chasm' || k === 'loop' || k === 'finish') return true;
    }
    // a Temple Run corner: no boulder may land / roll through the turn window (J.s0 .. the end of the arc) +- 10 m
    const J = this.track._juncs;
    if (J) for (let i = 0; i < J.length; i++) if (J[i].sEnd + 10 > sA && J[i].s0 - 10 < sB) return true;
    return false;
  },
  /** lanes a rolling boulder must not use: the only free lane of any row in the window */
  _trapMask(sA, sB) {
    let mask = 0;
    for (const r of this.rowsLog) {
      if (r.s + r.ext < sA || r.s - r.ext > sB) continue;
      const f = r.free;
      if (f === 0) mask |= FULL; else if ((f & (f - 1)) === 0) mask |= f;
    }
    return mask;
  },

  /**
   * Yeti boulder: arcs in from behind (1.5 s flight), lands in `lane` (0..2) at track distance `s`, then rolls downhill (toughness 5).
   * A red shadow grows on the target 0.9 s before impact and a { type:'warn', kind:'boulder', lane, t } event is queued.
   * Unless `force`, the lane is moved away from lanes that would trap the player. Returns the lane used, or -1.
   */
  throwBoulder(lane, s, force = false, opt = null) {
    let l = clamp(lane | 0, 0, NL - 1);
    if (!force) {
      if (this.dyn.length) return -1;      // max one thrown boulder (flying or rolling) at a time
      for (const r of this.rowsLog) if (Math.abs(r.s - s) < 15 + r.ext) return -1;      // never lands on / next to an obstacle row (>= 15 m clear)
      if (this._forcedStretch(s - 6, s + 100)) return -1;
      const bad = this._trapMask(s - 8, s + 100);
      if (bad & bit6(l)) {
        const alt = ALLL.filter((x) => !(bad & bit6(x))).sort((a, b) => Math.abs(a - l) - Math.abs(b - l))[0];
        if (alt === undefined) return -1;
        l = alt;
      }
    }
    const idx = this._alloc('ball');
    if (idx < 0) return -1;
    const dIdx = this._alloc('disc');
    const sStart = opt && opt.sStart !== undefined ? opt.sStart : this.lastS - 24;
    const b = { id: this._id++, lane: l, u: LANES[l], sLand: s, t0: this.time, T: Math.max(1.8, (opt && opt.T) || 1.8), soft: !!(opt && opt.soft), sStart, phase: 0, s: sStart, h: 6, idx, dIdx, f: new Float64Array(12), fL: this._frameOf(s),
      warned: false, hits: {}, vr: Math.max(13, this.ballVs * 0.75), rot: 0, tRoll: 0 };
    this._col('ball', idx, COL.rock, 1);
    this._col('disc', dIdx, 0xff2a1a, 1);
    this.dyn.push(b); this.dynById.set(b.id, b);
    return l;
  },
  _freeDyn(b) {
    this._release('ball', b.idx); if (b.dIdx >= 0) this._release('disc', b.dIdx);
    b.idx = -1; b.dIdx = -1;
    const i = this.dyn.indexOf(b); if (i >= 0) this.dyn.splice(i, 1);
    this.dynById.delete(b.id);
  },
  _flushWarn(events) {
    const q = this.warnQ;
    while (q.length) { const e = ev(events, 'warn'); e.kind = q.shift(); e.lane = q.shift(); e.t = q.shift(); }
  },
  _updateDyn(dt, ball) {
    const T = this.track, hk = this.hk();
    // automatic throws: from ~1200 m (boss levels: from the start) at a rate that grows with hardness
    const boss = (T.level && T.level.boss) || (T.zoneAt && T.zoneAt(ball.s) === 'boss'), start = boss ? (T.level && T.level.boss ? 150 : 0) : 2600 / Math.sqrt(hk);
    if (T.level && T.allows('boulder') && ball.s >= start && !(T.finishS < Infinity && ball.s > T.finishS - 90)) {
      if (!this._bArmed) { this._bArmed = true; this.nextBoulder = this.time + 5 + this.rng.next() * 6; }
      else if (this.time >= this.nextBoulder) {
        const rng = this.rng, vs = ball.vs || this.ballVs, sLand = ball.s + vs * 1.8 + 9;
        let busy = false;      // never stack a rage boulder on a hard / lethal row
        for (let i = this.rowsLog.length - 1; i >= 0 && this.rowsLog[i].s > sLand - 40; i--) { const rl = this.rowsLog[i]; if ((rl.hard || rl.lethal) && Math.abs(rl.s - sLand) < 40) { busy = true; break; } }
        if (busy) { this.nextBoulder = this.time + 1.0; } else {
        const pl = laneOf(ball.u);
        const got = this.throwBoulder(rng.chance(0.5) ? pl : rng.int(0, NL - 1), sLand);
        const diff = T._diff ? T._diff(ball.s) : 0.5;
        this.nextBoulder = this.time + (got < 0 ? 1.2 : (boss ? rng.range(10, 18) : rng.range(170, 260) / (0.8 + 0.4 * diff)) / hk);
        }
      }
    }
    for (let i = this.dyn.length - 1; i >= 0; i--) {
      const b = this.dyn[i], t = this.time - b.t0;
      if (b.phase === 0) {
        const x = t / b.T;
        if (x >= 1) { b.phase = 1; b.tRoll = this.time; b.s = b.sLand; b.h = 0.95; if (b.dIdx >= 0) { this._release('disc', b.dIdx); b.dIdx = -1; } }
        else {
          b.s = b.sStart + (b.sLand - b.sStart) * x; b.h = 0.95 + 32 * x * (1 - x);
          if (t >= b.T - 1.3) {       // red landing disc + warn event >= 1.0 s (1.3 s) before impact
            if (!b.warned) { b.warned = true; this.warnQ.push('boulder', b.lane, b.T - t); }
            const k = (t - (b.T - 1.3)) / 1.3;
            this._set('disc', b.dIdx, b.fL, b.u, 0.06, 0, 0, 0.8 + 2.6 * k, 1, 0.8 + 2.6 * k);
          }
        }
      } else {
        b.vr += 3 * dt; b.s += b.vr * dt; b.h = 0.95;
        if (this.time - b.tRoll > 7 || b.s > this.lastS + 220) { this._freeDyn(b); continue; }
      }
      b.rot += dt * 7;
      this._frameInto(b.s, b.f);
      this._set('ball', b.idx, b.f, b.u, b.h, b.rot, 0, 1.9, 1.9, 1.9);
    }
  },
  _collideDyn(cb, events) {
    for (let i = 0; i < this.dyn.length; i++) {
      const b = this.dyn[i];
      if (b.idx < 0 || b.hits[this._cid]) continue;
      if (this._cid === 'main' && b.phase === 1 && !b.nearDone) {      // a boulder passed without a hit: KIL PAYI (the Yeti duel counts these)
        const ds0 = cb.s - b.s, lat = Math.abs(cb.u - b.u) - 0.92 - cb.r;
        if (ds0 > -2.5 && ds0 < 2.5 && lat < (b.minLat === undefined ? 9 : b.minLat)) b.minLat = lat;
        if (ds0 >= 2.5) { b.nearDone = true; if (b.minLat < 0.5 && cb.h - cb.r < 1.8) { const e = ev(events, 'near'); e.toughness = 3; e.side = cb.u >= b.u ? 1 : -1; e.s = b.s; e.u = b.u; e.boulder = true; } }
      }
      const ds = cb.s - b.s, du = cb.u - b.u, dh = cb.h - b.h, rad = cb.r + 0.92, d2 = ds * ds + du * du + dh * dh;
      if (d2 >= rad * rad) continue;
      b.hits[this._cid] = true;
      const d = Math.sqrt(d2) || 1e-6, pen = rad - d, e = ev(events, 'hit');
      e.toughness = 5; e.s = b.s; e.u = b.u; e.h = b.h; e.color = COL.rock; e.id = b.id;
      e.ball = this._cid; e.soft = !!b.soft;
      e.ds = (ds / d) * pen; e.du = (du / d) * pen; e.headOn = e.ds < 0 && Math.abs(e.ds) >= 0.7 * Math.abs(e.du);
    }
  },

  _slidePattern(rng, allowed) {
    const n = rng.int(4, 8), pat = [];
    let l = allowed[rng.int(0, allowed.length - 1)];
    for (let i = 0; i < n; i++) {
      pat.push(l);
      if (rng.chance(0.65)) {
        const opts = allowed.filter((x) => Math.abs(x - l) === 1);
        if (opts.length) l = opts[rng.int(0, opts.length - 1)];
      }
    }
    // cyclic: the wrap from the last step to the first must also be at most one lane
    const f = pat[0], l2 = pat[pat.length - 1];
    if (Math.abs(l2 - f) > 1) { const mid = allowed.filter((x) => Math.abs(x - f) <= 1 && Math.abs(x - l2) <= 1); if (mid.length) pat.push(mid[0]); else pat[pat.length - 1] = f; }
    return pat;
  },
});

// oncoming train: parked far ahead with glowing headlights, starts rolling uphill towards the player when the ball is
// ~3.6 s from contact. warn { kind:'oncoming', lane, t } ~1.5 s before contact. ride: ramp + flat roof (platformAt)
KIND.oncoming = {
  build(ob) {
    const L = ob.L, ns = Math.round(L / ONC.SEG), sl = L / ns, ride = !!ob.ride;
    ob.tough = 5; ob.color = COL.orange; ob.hc = 1.2; ob.cs = ob.sP; ob.cu = ob.u; ob.state = 0; ob.warned = false;
    ob.hs = L / 2; ob.hu = 1.05; ob.ht = ride ? ONC.H : 2.6; ob.ns = ns; ob.sl = sl;
    ob.segF = []; for (let k = 0; k <= ns; k++) ob.segF.push(new Float64Array(12));
    if (ride) { ob.H = ONC.H; ob.rl = ONC.RL; this.platforms.push(ob); this._part(ob, 'wedge', COL.wood2, ob.u, ONC.H / 2, 0, 0, 2.0, ONC.H, ONC.RL, 0, 0, 0, ob.segF[ns]); }
    for (let k = 0; k < ns; k++) {
      const f = ob.segF[k];
      this._part(ob, 'box', ride ? 0x3a7de8 : COL.orange, ob.u, 1.15, 0, 0, 2.0, ride ? 2.3 : 1.5, sl + 0.04, 0, 0, 0, f);
      this._part(ob, 'box', COL.dark, ob.u - 0.95, 0.4, 0, 0, 0.6, 0.8, sl + 0.04, 0, 0, 0, f); this._part(ob, 'box', COL.dark, ob.u + 0.95, 0.4, 0, 0, 0.6, 0.8, sl + 0.04, 0, 0, 0, f);
      if (ride) this._part(ob, 'box', 0xbfe3ff, ob.u, 1.6, 0, 0, 2.06, 0.5, sl * 0.8, 0, 0, 0, f);
      else if (k === 0) { this._part(ob, 'box', 0xbfe3ff, ob.u, 2.2, 0, 0, 1.7, 1.0, sl, 0, 0, 0, f); this._part(ob, 'box', 0xffd23a, ob.u, 2.85, 0, 0, 0.9, 0.18, 0.4, 0, 0, 0, f); }
      else this._part(ob, 'box', COL.rock, ob.u, 2.05, 0, 0, 1.6, 0.6, sl * 0.9, 0, 0, 0, f);
    }
    // headlights (unlit, visible from far away) + translucent light cone ahead of the front (front = lower s = local +z)
    const f0 = ob.segF[0];
    for (const sg of [-1, 1]) this._part(ob, 'lamp', 0xfff2b0, ob.u + sg * 0.7, 0.95, 0, 0, 0.55, 0.55, 0.55, 0, 0, sl / 2 + 0.1, f0);
    this._part(ob, 'ice', 0xfff0a0, ob.u, 0.8, 0, 0, 1.9, 0.9, 7, 0, 0, sl / 2 + 3.7, f0);
  },
  anim(ob) {
    if (ob.state === 0 && this.lastS >= ob.sP - (this.ballVs + ob.vt) * 3.6) { ob.state = 1; ob.tStart = this.time; }
    ob.cs = ob.state ? ob.sP - ob.vt * (this.time - ob.tStart) : ob.sP;
    const front = ob.cs - ob.L / 2;
    for (let k = 0; k < ob.ns; k++) this._frameInto(front + (k + 0.5) * ob.sl, ob.segF[k]);
    this._frameInto(front - ONC.RL / 2, ob.segF[ob.ns]);
    for (const p of ob.parts) if (p.idx >= 0) this._set(p.key, p.idx, p.f, p.u, p.h, p.yaw, p.roll, p.sx, p.sy, p.sz, p.ox, p.oy, p.oz);
  },
  hit(ob, ball, events) {
    const front = ob.cs - ob.L / 2;
    this._pass(ob, ball, events, ob.cs, ob.u, ob.L / 2, 1.05, ob.ht);
    if (ob.state === 1 && !ob.warned && this._cid === 'main') {
      const gap = front - ball.s;
      if (gap <= 0) ob.warned = true;
      else {
        const tc = gap / (ball.vs + ob.vt);
        if (tc <= (ob.plow ? 2 : 1.5)) { ob.warned = true; const e = ev(events, 'warn'); e.kind = 'oncoming'; e.lane = ob.lane; e.t = tc; e.value = ob.plow ? 1 : 0; }
      }
    }
    if (ob.plow && !ob.dodged && this._cid === 'main' && ball.s > ob.cs + ob.L / 2 + 1) { ob.dodged = true; const e = ev(events, 'pickup'); e.kind = 'plowdodge'; }
    const H = this._aabb(ball, front, ob.cs + ob.L / 2, ob.u - 1.05, ob.u + 1.05, 0, ob.ht);
    if (H && (H.ds !== 0 || H.du !== 0)) this._hit(ob, ball, events, H.ds, H.du);
  },
};

// overhead barrier (duck): beam bottom at hb across lanes lo..hi. Passed only with ball.duck, else 'hit' (toughness 5)
KIND.overhead = {
  build(ob) {
    ob.tough = 5; ob.color = 0xffc21a; ob.hc = ob.hb + 0.2;
    const u0 = LANES[ob.lo] - 1.25, u1 = LANES[ob.hi] + 1.25, uc = (u0 + u1) / 2;
    ob.uMin = u0; ob.uMax = u1;
    this._part(ob, 'box', COL.dark, u0 + 0.12, (ob.hb + 0.4) / 2, 0, 0, 0.24, ob.hb + 0.4, 0.3);
    this._part(ob, 'box', COL.dark, u1 - 0.12, (ob.hb + 0.4) / 2, 0, 0, 0.24, ob.hb + 0.4, 0.3);
    this._part(ob, 'plow', 0xffffff, uc, ob.hb + 0.2, 0, 0, u1 - u0, 0.4, 0.5);
    // hanging flags make the height readable
    for (let u = u0 + 0.7; u < u1 - 0.5; u += 1.4) this._part(ob, 'box', ob.glow, u, ob.hb - 0.1, 0, 0, 0.5, 0.2, 0.08);
  },
  hit(ob, ball, events) {
    if (ob.hitDone || Math.abs(ball.s - ob.s) > 0.55 + ball.r * 0.4) return;
    if (ball.u < ob.uMin - ball.r * 0.3 || ball.u > ob.uMax + ball.r * 0.3) return;
    if (ball.duck || ball.h - ball.r > ob.hb + 0.45) return;     // ducking (or somehow above the beam) passes
    this._hit(ob, ball, events, -0.6, 0);
  },
};

// beat-sliding wall: a 3 m gap that moves one lane per step (pattern), eased in the first 40% of the step. Pure function of the beat
KIND.slidewall = {
  build(ob) {
    ob.tough = 5; ob.color = 0xffc21a; ob.hc = 0.95; ob.gc = LANES[ob.pat[0]];
    ob.pL = this._part(ob, 'plow', 0xffffff, -3, 0.95, 0, 0, 2, 1.9, 0.9);
    ob.pR = this._part(ob, 'plow', 0xffffff, 3, 0.95, 0, 0, 2, 1.9, 0.9);
  },
  anim(ob, b) {
    // Telegraphed single shift: the gap sits still (visible from far away) until the ball is 3.2 s away, slides ONE lane over
    // 1.44 s (>= 1.2 s per lane), then freezes for the last 1.4 s (0.5 s reaction + lane change) so the open lane never moves under the player.
    const a = LANES[ob.pat[0]], c = LANES[ob.pat[ob.pat.length > 1 ? 1 : 0]];
    const tc = (ob.s - this.lastS) / Math.max(6, this.ballVs || 10);
    const p = tc >= 3.2 ? 0 : tc <= 1.4 ? 1 : smooth(Math.min(1, (3.2 - tc) / 1.44));
    ob.gc = a + (c - a) * p;
    const gl = ob.gc - 1.5, gr = ob.gc + 1.5, LIM = 4.7;
    const wl = Math.max(0, gl + LIM), wr = Math.max(0, LIM - gr);
    this._repart(ob.pL, -LIM + wl / 2, 0.95, 0, 0, wl || 0.001, 1.9, 0.9);
    this._repart(ob.pR, LIM - wr / 2, 0.95, 0, 0, wr || 0.001, 1.9, 0.9);
  },
  hit(ob, ball, events) {
    if (ob.hitDone) return;
    const gl = ob.gc - 1.5, gr = ob.gc + 1.5, LIM = 4.7;
    for (const [u0, u1] of [[-LIM, gl], [gr, LIM]]) {
      if (u1 - u0 <= 0.02) continue;
      const H = this._aabb(ball, ob.s - 0.45, ob.s + 0.45, u0, u1, 0, 1.9);
      if (H && (H.ds !== 0 || H.du !== 0)) { this._hit(ob, ball, events, H.ds, H.du); return; }
    }
  },
};

// wind gust zone: { type:'wind', du } (m/s sideways drift, gusting) while inside, with blowing snow streaks
KIND.wind = {
  build(ob) {
    ob.tough = 0; ob.color = 0; ob.hc = 1;
    const rng = this.rng, n = 22;
    ob.streaks = [];
    for (let i = 0; i < n; i++) {
      const f = this._frameOf(ob.s - ob.len / 2 + rng.next() * ob.len);
      const p = this._part(ob, 'box', 0xeaf6ff, 0, 0.4 + rng.next() * 2.8, 0, 0, 1.8 + rng.next() * 1.2, 0.035, 0.035, 0, 0, 0, f);
      p.ph = rng.next() * 14; ob.streaks.push(p);
    }
  },
  anim(ob) {
    const t = this.time * 9;
    for (const p of ob.streaks) {
      const x = (((t + p.ph) % 14) + 14) % 14 - 7;
      this._repart(p, ob.dir > 0 ? x : -x, p.h, 0, 0, p.sx, p.sy, p.sz);
    }
  },
  hit(ob, ball, events) {
    if (Math.abs(ball.s - ob.s) > ob.len / 2) return;
    const gust = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.time * 1.9 + ob.ph)), e = ev(events, 'wind');
    e.du = ob.dir * ob.strength * gust;
  },
};

// fog / blizzard zone: { type:'fog', density 0..1 } while inside (ramps in and out over 12 m); drifting puffs beside / above the track
KIND.fog = {
  build(ob) {
    ob.tough = 0; ob.color = 0; ob.hc = 3;
    const rng = this.rng, n = 14;
    for (let i = 0; i < n; i++) {
      const f = this._frameOf(ob.s - ob.len / 2 + (i + rng.next()) * (ob.len / n)), sg = rng.chance(0.5) ? -1 : 1, sz = 4 + rng.next() * 3.5;
      this._part(ob, 'puff', 0xf2f7ff, sg * (5.5 + rng.next() * 3), 2.2 + rng.next() * 3.5, 0, 0, sz * 1.5, sz * 0.8, sz, 0, 0, 0, f);
    }
  },
  hit(ob, ball, events) {
    const a = ob.s - ob.len / 2, b = ob.s + ob.len / 2;
    if (ball.s < a || ball.s > b) return;
    const d = Math.min(1, (ball.s - a) / 12, (b - ball.s) / 12), e = ev(events, 'fog');
    e.density = ob.maxD * smooth(d);
  },
};


// ---------------------------------------------------------------------------
// BUZ KAYDIRAĞI: an icy strip in one lane: +20 % speed and slow lane changes while on it, with a flake row along it (risk / reward).
// Emits a 'slide' event every frame the ball is on it; kept clear of rows before and after by the spawner.
KIND.slide = {
  build(ob) {
    ob.hc = 0.05; ob.tough = 0; ob.color = 0xbfeaff;
    const ns = Math.max(1, Math.round(ob.len / SEGL)), sl = ob.len / ns, s0 = ob.s - ob.len / 2;
    for (let k = 0; k < ns; k++) {
      const f = this._frameOf(s0 + (k + 0.5) * sl);
      this._part(ob, 'ice', 0x8fdcff, ob.u, 0.04, 0, 0, 2.3, 0.06, sl + 0.05, 0, 0, 0, f);
      for (const sg of [-1, 1]) this._part(ob, 'box', 0xe8fbff, ob.u + sg * 1.18, 0.08, 0, 0, 0.08, 0.08, sl + 0.05, 0, 0, 0, f);
    }
    for (let k = 0; k < 3; k++) this._part(ob, 'chev', 0x9ef0ff, ob.u, 0.1, 0, 0, 1.3, 1, 1.0, 0, 0, 0, this._frameOf(s0 + 2 + k * 2.2));
  },
  hit(ob, ball, events) {
    if (ball.h - ball.r > 0.5 || Math.abs(ball.s - ob.s) > ob.len / 2 || Math.abs(ball.u - ob.u) > 1.3) return;
    ev(events, 'slide');
  },
};

// TÜNEL: a dark stretch (fog event darkens the view) with lit arches; every blocker row is telegraphed by hanging lamps over its blocked lanes
// plus a glow disc on the ground 7 m ahead of it. Events: 'fog' (density) while inside, 'tunnel' on entry / exit / every ~40 m (the echoing whoosh).
KIND.tunnel = {
  build(ob) {
    ob.tough = 0; ob.color = 0; ob.hc = 2; ob.was = false;
    const a = ob.s - ob.len / 2, hw = hwFor(ob.n || 3) + 0.4, n = Math.max(2, Math.round(ob.len / 9));
    ob.a = a; ob.b = a + ob.len; ob.echo = a + 36;
    for (let i = 0; i <= n; i++) {
      const f = this._frameOf(a + (i * ob.len) / n), edge = i === 0 || i === n;
      for (const sg of [-1, 1]) this._part(ob, 'box', 0x2a3048, sg * hw, 2.1, 0, 0, 0.5, 4.2, 0.5, 0, 0, 0, f);
      this._part(ob, 'box', 0x2a3048, 0, 4.35, 0, 0, 2 * hw + 0.6, 0.4, 0.5, 0, 0, 0, f);
      for (const sg of [-1, 0, 1]) this._part(ob, 'lamp', edge ? 0xffb02a : 0x7fe8ff, sg * hw * 0.62, 4.0, 0, 0, 0.5, 0.35, 0.5, 0, 0, 0, f);
    }
    for (const r of ob.rowL || []) {
      const f = this._frameOf(r.s), f2 = this._frameOf(r.s - 7);
      for (let l = 0; l < (ob.n || 3); l++) if (!(r.free & (1 << l))) {
        this._part(ob, 'lamp', 0xff5a2a, LANES[l], 3.3, 0, 0, 0.6, 0.45, 0.6, 0, 0, 0, f);
        this._part(ob, 'disc', 0xff7a3a, LANES[l], 0.06, 0, 0, 2.0, 1, 2.0, 0, 0, 0, f2);
      }
    }
  },
  hit(ob, ball, events) {
    const inside = ball.s >= ob.a && ball.s <= ob.b;
    if (inside) {
      const d = Math.min(1, (ball.s - ob.a) / 8, (ob.b - ball.s) / 8), e = ev(events, 'fog');
      e.density = ob.maxD * smooth(d);
      if (!ob.was) { ob.was = true; const t = ev(events, 'tunnel'); t.enter = true; }
      else if (ball.s > ob.echo) { ob.echo = ball.s + 40; const t = ev(events, 'tunnel'); t.enter = false; }
    } else if (ob.was && ball.s > ob.b) { ob.was = false; const t = ev(events, 'tunnel'); t.enter = false; }
  },
};

// campaign finish line: { type:'finish' } once when the ball crosses it
KIND.finish = {
  build(ob) { ob.tough = 0; ob.color = 0; ob.hc = 0; ob.fired = false; },
  hit(ob, ball, events) {
    if (ob.fired || ball.s < ob.s) return;
    ob.fired = true;
    const e = ev(events, 'finish');
    e.s = ob.s;
  },
};

// ---------------------------------------------------------------------------
// Ice lasers (Jetpack Joyride zappers) and snow missiles
// ---------------------------------------------------------------------------
const LASER_COL = 0x6ff2ff, LASER_HALO = 0x2a8fb0;

// ice laser: emitters on posts at the track edges, beam across the lanes
//   low      beam h 0.2-0.8  (jump over it)            high     beam h 1.0-1.6 (duck: ball.duck)
//   curtain  full-height beam across lanes lo..hi (dodge sideways)
//   rotating beam hinged at an edge post, sweeping on the beat (far lane always clear)
//   blink    three lane beams, one lane 'off' at a time; the off lane moves one lane per step on the beat; flicker telegraphs
KIND.laser = {
  build(ob) {
    ob.tough = 5; ob.color = LASER_COL; ob.hc = ob.hb || 0.9;
    const hw = ob.hw, v = ob.variant;
    const post = (u, H) => {
      this._part(ob, 'box', COL.dark, u, H / 2, 0, 0, 0.45, H, 0.45);
      this._part(ob, 'box', 0x39445a, u, 0.15, 0, 0, 0.7, 0.3, 0.7);
    };
    ob.beams = [];
    const beam = (u, h, sx, sy, sz, hex) => { const p = this._part(ob, 'beam', hex, u, h, 0, 0, sx, sy, sz); p.hex = hex; return p; };
    if (v === 'low' || v === 'high') {
      const hb = ob.hb, H = hb + 0.7;
      post(-hw - 0.3, H); post(hw + 0.3, H);
      for (const sg of [-1, 1]) this._part(ob, 'lamp', LASER_COL, sg * (hw + 0.05), hb, 0, 0, 0.45, 0.45, 0.45);
      ob.core = beam(0, hb, 2 * hw, 0.14, 0.14, LASER_COL);
      ob.halo = beam(0, hb, 2 * hw, 0.62, 0.3, LASER_HALO);
      ob.bl = v === 'low' ? 0.2 : 1.0; ob.bh = v === 'low' ? 0.8 : 1.6;
    } else if (v === 'curtain') {
      const u0 = LANES[ob.lo] - 1.25, u1 = LANES[ob.hi] + 1.25, uc = (u0 + u1) / 2, w = u1 - u0;
      ob.uMin = u0; ob.uMax = u1; ob.cu = uc;
      post(u0 - 0.12, 2.6); post(u1 + 0.12, 2.6);
      ob.halo = beam(uc, 1.15, w, 2.3, 0.12, LASER_HALO);
      ob.core = beam(uc, 0.25, w, 0.12, 0.14, LASER_COL); ob.core2 = beam(uc, 2.05, w, 0.12, 0.14, LASER_COL);
    } else if (v === 'rotating') {
      const sg = ob.sigma, u0 = sg * (hw + 0.05);
      ob.u0 = u0; ob.cu = u0;
      post(u0 + sg * 0.25, 1.3);
      this._part(ob, 'lamp', LASER_COL, u0, 0.5, 0, 0, 0.55, 0.55, 0.55);
      ob.core = beam(u0, 0.5, ob.L, 0.14, 0.14, LASER_COL);
      ob.halo = beam(u0, 0.5, ob.L, 0.62, 0.3, LASER_HALO);
    } else {   // blink
      post(-hw - 0.3, 2.5); post(hw + 0.3, 2.5);
      ob.lane = [];
      for (let l = 0; l < NL; l++) {
        const u = LANES[l];
        ob.lane.push({ halo: beam(u, 1.05, 2.3, 2.1, 0.12, LASER_HALO), core: beam(u, 0.2, 2.3, 0.12, 0.14, LASER_COL), core2: beam(u, 1.95, 2.3, 0.12, 0.14, LASER_COL), on: true });
      }
    }
  },

  anim(ob, b, pulse) {
    const v = ob.variant, shimmer = 0.82 + 0.18 * Math.sin(this.time * 38 + ob.id);
    if (v === 'low' || v === 'high' || v === 'curtain') {
      this._col('beam', ob.core.idx, LASER_COL, shimmer);
      this._col('beam', ob.halo.idx, LASER_HALO, 0.55 + 0.35 * pulse);
      if (ob.core2) this._col('beam', ob.core2.idx, LASER_COL, shimmer);
    } else if (v === 'rotating') {
      const th = TAU * b / ob.per + ob.phi, off = ob.L / 2;
      ob.th = th;
      this._repart(ob.core, ob.u0, 0.5, th, 0, ob.L, 0.14, 0.14, off, 0, 0);
      this._repart(ob.halo, ob.u0, 0.5, th, 0, ob.L, 0.62, 0.3, off, 0, 0);
      this._col('beam', ob.core.idx, LASER_COL, shimmer);
    } else {
      // blink: the off lane follows pat (one lane per step, eased flag for the flicker). x = step index, f = position in the step
      const n = ob.pat.length, x = b / ob.per, k = Math.floor(x), f = x - k;
      const cur = ob.pat[((k % n) + n) % n], nxt = ob.pat[(((k + 1) % n) + n) % n];
      ob.offLane = cur; ob.nextOff = nxt;
      for (let l = 0; l < NL; l++) {
        const L = ob.lane[l];
        // lane l is ON when it is not the current off lane; the lane that is about to switch on (cur != nxt) flickers in the last 30% of the step
        const flicker = l === cur && nxt !== cur && f > 0.7;
        const on = l !== cur;
        const vis = on || (flicker && Math.sin(f * 90) > 0);
        L.on = on;
        const u = LANES[l];
        if (vis) {
          const dim = on ? 1 : 0.55;
          this._repart(L.halo, u, 1.05, 0, 0, 2.3, 2.1, 0.12); this._repart(L.core, u, 0.2, 0, 0, 2.3, 0.12, 0.14); this._repart(L.core2, u, 1.95, 0, 0, 2.3, 0.12, 0.14);
          this._col('beam', L.halo.idx, LASER_HALO, dim * (0.55 + 0.35 * pulse)); this._col('beam', L.core.idx, LASER_COL, dim * shimmer); this._col('beam', L.core2.idx, LASER_COL, dim * shimmer);
        } else {
          this._repart(L.halo, u, 1.05, 0, 0, 0.001, 0.001, 0.001); this._repart(L.core, u, 0.2, 0, 0, 0.001, 0.001, 0.001); this._repart(L.core2, u, 1.95, 0, 0, 0.001, 0.001, 0.001);
        }
      }
    }
  },

  hit(ob, ball, events, t) {
    const v = ob.variant, r = ball.r;
    if (v === 'low' || v === 'high') {
      const ds = ball.s - ob.s;
      const bottom = ball.h - r, top = bottom + (ball.duck ? 0.9 * r : 2 * r);
      if (!ob.hitDone && Math.abs(ds) < 0.1 + 0.8 * r && top > ob.bl && bottom < ob.bh) { this._hit(ob, ball, events, ds < 0 ? -0.6 : 0.6, 0); return; }
      // skill events: closest vertical clearance while crossing the beam
      if (ob.passDone) return;
      if (Math.abs(ds) < 0.1 + 0.8 * r + 0.3) {
        const clr = v === 'low' ? bottom - ob.bh : ob.bl - top;
        if (clr >= 0 && clr < ob.minLat) { ob.minLat = clr; ob.nearSide = v === 'low' ? 1 : -1; if (v === 'low') ob.over = true; }
      } else if (ds > 0.5) {
        ob.passDone = true;
        if (!ob.hitDone && ob.minLat < 0.35) { const e = ev(events, 'near'); e.toughness = 5; e.side = ob.nearSide; e.s = ob.s; e.u = ball.u; }
        else if (!ob.hitDone && ob.over) { const e = ev(events, 'over'); e.toughness = 5; e.s = ob.s; e.u = ball.u; }
      }
      return;
    }
    if (v === 'curtain') {
      this._pass(ob, ball, events, ob.s, ob.cu, 0.25, (ob.uMax - ob.uMin) / 2, 2.3);
      const H = this._aabb(ball, ob.s - 0.1, ob.s + 0.1, ob.uMin, ob.uMax, 0, 2.3);
      if (H && (H.ds !== 0 || H.du !== 0)) this._hit(ob, ball, events, H.ds, H.du);
      return;
    }
    if (v === 'rotating') {
      const th = ob.th, off = ob.L / 2;
      if (this._obb(ball, ob.u0 + Math.cos(th) * off, ob.s + Math.sin(th) * off, th, off, 0.12, 0.2, 0.8)) { if (!ob.hitDone) this._hit(ob, ball, events, -0.5, ob.sigma > 0 ? -0.5 : 0.5); }
      return;
    }
    // blink: ON lanes are full-height curtains
    if (ob.hitDone || !ob.lane) return;
    for (let l = 0; l < NL; l++) {
      if (!ob.lane[l].on) continue;
      const H = this._aabb(ball, ob.s - 0.1, ob.s + 0.1, LANES[l] - 1.2, LANES[l] + 1.2, 0, 2.1);
      if (H && (H.ds !== 0 || H.du !== 0)) { this._hit(ob, ball, events, H.ds, H.du); return; }
    }
  },
};

// snow missile: flies uphill (towards -s) down one lane from far ahead. A red reticle pulses on the lane at the predicted contact
// point and { type:'warn', kind:'missile', lane, t } fires ~1.2 s before contact. Toughness 5
KIND.missile = {
  build(ob) {
    ob.tough = 5; ob.color = COL.red; ob.hc = 0.8; ob.state = 0; ob.warned = false; ob.cs = ob.sP; ob.cu = ob.u; ob.mf = new Float64Array(12);
    const f = ob.mf, P = PI / 2;
    ob.body = this._part(ob, 'cyl', 0xf4f7fb, ob.u, 0.8, P, P, 0.62, 2.0, 0.62, 0, 0, 0, f);
    ob.nose = this._part(ob, 'ball', COL.red, ob.u, 0.8, 0, 0, 0.62, 0.62, 0.95, 0, 0, 1.1, f);        // nose points towards -s (local +z)
    ob.finA = this._part(ob, 'box', COL.red, ob.u, 0.8, 0, 0, 0.06, 0.9, 0.5, 0, 0, -0.85, f);
    ob.finB = this._part(ob, 'box', COL.red, ob.u, 0.8, 0, 0, 0.9, 0.06, 0.5, 0, 0, -0.85, f);
    ob.flame = this._part(ob, 'lamp', 0xffa23a, ob.u, 0.8, 0, 0, 0.5, 0.5, 1.1, 0, 0, -1.35, f);
    ob.ret = this._part(ob, 'ring', 0xff2a2a, ob.u, 0.9, 0, 0, 0.001, 0.001, 0.001, 0, 0, 0, ob.mf);
    ob.retF = new Float64Array(12);
  },
  anim(ob, b, pulse) {
    const T = this.track, closing = this.ballVs + ob.vm;
    if (ob.state === 0 && this.lastS >= ob.sP - closing * 2.0) { ob.state = 1; ob.tStart = this.time; }
    if (ob.state === 0) {      // parked far ahead, invisible
      for (const p of ob.parts) if (p.idx >= 0) this._set(p.key, p.idx, p.f, p.u, p.h, p.yaw, p.roll, 0.0001, 0.0001, 0.0001, 0, 0, 0);
      return;
    }
    ob.cs = ob.sP - ob.vm * (this.time - ob.tStart);
    if (ob.cs < this.lastS - 25) {     // gone past the player
      for (const p of ob.parts) if (p.idx >= 0) { this._release(p.key, p.idx); p.idx = -1; }
      ob.alive = false;
      return;
    }
    this._frameInto(ob.cs, ob.mf);
    const wob = 0.04 * Math.sin(this.time * 31), fl = 0.8 + 0.5 * Math.sin(this.time * 47);
    this._repart(ob.body, ob.u, 0.8, PI / 2, PI / 2, 0.62, 2.0, 0.62, 0, 0, 0, 0, ob.mf);
    this._repart(ob.nose, ob.u, 0.8, 0, 0, 0.62, 0.62, 0.95, 0, 0, 1.1, 0, ob.mf);
    this._repart(ob.finA, ob.u, 0.8, 0, wob, 0.06, 0.9, 0.5, 0, 0, -0.85, 0, ob.mf);
    this._repart(ob.finB, ob.u, 0.8, 0, wob, 0.9, 0.06, 0.5, 0, 0, -0.85, 0, ob.mf);
    this._repart(ob.flame, ob.u, 0.8, 0, 0, 0.5 * fl, 0.5 * fl, 1.2 * fl, 0, 0, -1.35 - 0.3 * fl, 0, ob.mf);
    // reticle on the lane at the predicted contact point
    const tc = (ob.cs - this.lastS) / closing;
    if (tc > 0) {
      const sC = this.lastS + this.ballVs * tc, k = 1.0 + 0.25 * Math.sin(this.time * 16) + 0.9 * (1 - tc / 2.0);
      this._frameInto(sC, ob.retF);
      this._repart(ob.ret, ob.u, 0.9, 0, 0, 1.1 * k, 1.1 * k, 0.5, 0, 0, 0, 0, ob.retF);
    } else this._repart(ob.ret, ob.u, 0.9, 0, 0, 0.001, 0.001, 0.001, 0, 0, 0, 0, ob.retF);
  },
  hit(ob, ball, events) {
    if (ob.state !== 1) return;
    const closing = ball.vs + ob.vm;
    if (!ob.warned && this._cid === 'main') {
      const tc = (ob.cs - 1.2 - ball.s) / closing;
      if (tc <= 1.2) { ob.warned = true; const e = ev(events, 'warn'); e.kind = 'missile'; e.lane = ob.lane; e.t = Math.max(0, tc); }
    }
    this._pass(ob, ball, events, ob.cs, ob.u, 1.2, 0.45, 1.3);
    const H = this._aabb(ball, ob.cs - 1.3, ob.cs + 1.3, ob.u - 0.5, ob.u + 0.5, 0.25, 1.35);
    if (H && (H.ds !== 0 || H.du !== 0)) this._hit(ob, ball, events, H.ds, H.du);
  },
};

// ---------------------------------------------------------------------------
// Variety obstacles (from ~1.2 km): Kartopu Topçusu (turret), Buz Kapısı (ice gate), Penguen Kızağı (penguin sled).
// Each emits { type:'fx', kind, value } : value 0 = first sight (tip), value 1 = audio cue.
// ---------------------------------------------------------------------------
function fxEv(events, kind, value) { const e = ev(events, 'fx'); e.kind = kind; e.value = value; return e; }

// snowman turret on the roadside: a striped lane (warning) and one slow snowball down it every 2 s while the player approaches (jump or dodge)
KIND.turret = {
  build(ob) {
    ob.tough = 3; ob.color = 0xffffff; ob.hc = 0.5; ob.vm = 11; ob.tNext = 0; ob.fire = false; ob.seen = false; ob.flash = -9;
    ob.cs = ob.s; ob.cu = LANES[ob.lane];
    const u0 = ob.u, uL = LANES[ob.lane], P = PI / 2, gl = ob.glow || 0xff5a3a;
    this._part(ob, 'ball', 0xf4f9ff, u0, 0.7, 0, 0, 1.5, 1.4, 1.5); this._part(ob, 'ball', 0xf4f9ff, u0, 1.7, 0, 0, 1.1, 1.1, 1.1);
    this._part(ob, 'ball', 0xf4f9ff, u0, 2.55, 0, 0, 0.85, 0.85, 0.85);
    this._part(ob, 'box', gl, u0, 2.15, 0, 0, 0.95, 0.18, 0.95);
    this._part(ob, 'ball', 0xff9a2a, u0, 2.55, 0, 0, 0.14, 0.14, 0.5, 0, 0, 0.5);
    this._part(ob, 'cyl', COL.dark, u0, 3.05, 0, 0, 0.6, 0.45, 0.6);
    this._part(ob, 'cyl', COL.dark, u0, 1.7, P, P, 0.45, 1.5, 0.45, 0, 0, 0.9);
    ob.muz = this._part(ob, 'lamp', 0xffd27a, u0, 1.7, 0, 0, 0.001, 0.001, 0.001, 0, 0, 1.75);
    ob.str = [];
    for (let i = 0; i < 6; i++) ob.str.push(this._part(ob, 'box', gl, uL, 0.04, 0, 0, 1.4, 0.06, 5.2, 0, 0, 0, this._frameOf(ob.s - 3 - 6.5 * i)));
    ob.strHex = gl; ob.slots = [];
    for (let i = 0; i < 3; i++) {
      const f = new Float64Array(12);
      ob.slots.push({ on: false, t0: 0, cs: 0, f, part: this._part(ob, 'ball', 0xffffff, uL, 0.5, 0, 0, 0.001, 0.001, 0.001, 0, 0, 0, f) });
    }
  },
  anim(ob, b, pulse) {
    const t = this.time, dist = ob.s - this.lastS, uL = LANES[ob.lane];
    if (ob.tNext === 0 && dist < 62) ob.tNext = t + 0.9;
    if (ob.tNext > 0 && t >= ob.tNext && dist > 16 && dist < 60) {
      const sl = ob.slots.find((q) => !q.on);
      if (sl) { sl.on = true; sl.t0 = t; sl.cs = ob.s; ob.fire = true; ob.flash = t; }
      ob.tNext = t + 2;
    }
    const wind = ob.tNext > 0 ? ob.tNext - t : 9, k = wind > 0 && wind < 0.8 ? 1.2 : 0.45 + 0.2 * Math.sin(t * 6);
    for (const p of ob.str) if (p.idx >= 0) this._col('box', p.idx, ob.strHex, k);
    const mf = Math.max(0, 1 - (t - ob.flash) / 0.15);
    this._repart(ob.muz, ob.u, 1.7, 0, 0, 0.9 * mf + 0.001, 0.9 * mf + 0.001, 0.9 * mf + 0.001, 0, 0, 1.75);
    for (const sl of ob.slots) {
      if (!sl.on) { this._repart(sl.part, uL, 0.5, 0, 0, 0.0001, 0.0001, 0.0001, 0, 0, 0, 0, sl.f); continue; }
      sl.cs = ob.s - ob.vm * (t - sl.t0);
      if (sl.cs < this.lastS - 12) { sl.on = false; continue; }
      this._frameInto(sl.cs, sl.f);
      this._repart(sl.part, uL, 0.5, 0, 0, 0.95, 0.95, 0.95, 0, 0, 0, 0, sl.f);
    }
  },
  hit(ob, ball, events) {
    const d = ob.s - ball.s;
    if (!ob.seen && d > 0 && d < 50) { ob.seen = true; fxEv(events, 'turret', 0); }
    if (ob.fire) { ob.fire = false; if (d > 0 && d < 70) fxEv(events, 'turret', 1); }
    const uL = LANES[ob.lane];
    for (const sl of ob.slots) {
      if (!sl.on) continue;
      const H = this._aabb(ball, sl.cs - 0.5, sl.cs + 0.5, uL - 0.5, uL + 0.5, 0, 1.0);
      if (H && (H.ds !== 0 || H.du !== 0)) { ob.cs = sl.cs; ob.cu = uL; sl.on = false; this._hit(ob, ball, events, H.ds, H.du); return; }
    }
  },
};

// full-width gate with an ice bar that rises and falls on the beat: pass while it is up, or duck
KIND.icegate = {
  build(ob) {
    ob.tough = 3; ob.color = 0xbfeaff; ob.hc = 1.6; ob.bb = 2.9; ob.seen = false; ob.low = false; ob.clang = false;
    const u0 = LANES[0] - 1.25, u1 = LANES[ob.hi] + 1.25, w = u1 - u0, gl = ob.glow || 0x7fe0ff;
    ob.w = w; ob.uc = (u0 + u1) / 2;
    this._part(ob, 'box', 0x3fb8ff, u0 + 0.2, 2.6, 0, 0, 0.6, 5.2, 0.6); this._part(ob, 'box', 0x3fb8ff, u1 - 0.2, 2.6, 0, 0, 0.6, 5.2, 0.6);
    this._part(ob, 'box', 0xff9a2a, u0 + 0.2, 0.2, 0, 0, 1.0, 0.4, 1.0); this._part(ob, 'box', 0xff9a2a, u1 - 0.2, 0.2, 0, 0, 1.0, 0.4, 1.0);
    this._part(ob, 'lamp', gl, u0 + 0.2, 5.4, 0, 0, 0.7, 0.7, 0.7); this._part(ob, 'lamp', gl, u1 - 0.2, 5.4, 0, 0, 0.7, 0.7, 0.7);
    this._part(ob, 'box', COL.dark, ob.uc, 3.55, 0, 0, w, 0.35, 0.4);
    this._part(ob, 'lamp', gl, u0 + 0.2, 3.85, 0, 0, 0.4, 0.4, 0.4); this._part(ob, 'lamp', gl, u1 - 0.2, 3.85, 0, 0, 0.4, 0.4, 0.4);
    ob.ch1 = this._part(ob, 'box', 0xd9eaf5, ob.uc - w * 0.3, 3.2, 0, 0, 0.06, 1, 0.06); ob.ch2 = this._part(ob, 'box', 0xd9eaf5, ob.uc + w * 0.3, 3.2, 0, 0, 0.06, 1, 0.06);
    ob.bar = this._part(ob, 'lamp', 0x7ff3ff, ob.uc, 3.1, 0, 0, w - 0.7, 0.5, 0.6); ob.beatL = this._part(ob, 'lamp', 0xffffff, ob.uc, 4.6, 0, 0, 0.9, 0.9, 0.9);
    ob.l1 = this._part(ob, 'lamp', gl, u0 + 0.5, 3.1, 0, 0, 0.35, 0.35, 0.35); ob.l2 = this._part(ob, 'lamp', gl, u1 - 0.5, 3.1, 0, 0, 0.35, 0.35, 0.35);
    ob.u0 = u0; ob.u1 = u1;
  },
  anim(ob, b) {
    const x = 0.5 + 0.5 * Math.cos(TAU * (b / ob.per + ob.ph)), bb = 1.15 + 1.75 * x, w = ob.w, hc = bb + 0.2;
    ob.bb = bb;
    if (x < 0.25 && !ob.low) { ob.low = true; ob.clang = true; } else if (x > 0.5) ob.low = false;
    this._repart(ob.bar, ob.uc, hc, 0, 0, w - 0.7, 0.5, 0.6);
    { const k = 0.35 + 0.65 * x; this._repart(ob.beatL, ob.uc, 4.6 + 0.5 * x, 0, 0, 0.5 + k, 0.5 + k, 0.5 + k); }
    const top = 3.4, ch = top - (bb + 0.4), mid = (top + bb + 0.4) / 2;
    this._repart(ob.ch1, ob.uc - w * 0.3, mid, 0, 0, 0.06, ch, 0.06); this._repart(ob.ch2, ob.uc + w * 0.3, mid, 0, 0, 0.06, ch, 0.06);
    this._repart(ob.l1, ob.u0 + 0.5, hc, 0, 0, 0.35, 0.35, 0.35); this._repart(ob.l2, ob.u1 - 0.5, hc, 0, 0, 0.35, 0.35, 0.35);
  },
  hit(ob, ball, events) {
    const d = ob.s - ball.s;
    if (!ob.seen && d > 0 && d < 45) { ob.seen = true; fxEv(events, 'icegate', 0); }
    if (ob.clang) { ob.clang = false; if (d > -5 && d < 40) fxEv(events, 'icegate', 1); }
    if (ob.hitDone || Math.abs(ball.s - ob.s) > 0.55 + ball.r * 0.4) return;
    if (ball.u < ob.u0 - ball.r * 0.3 || ball.u > ob.u1 + ball.r * 0.3 || ball.duck) return;
    if (ball.h + ball.r < ob.bb || ball.h - ball.r > ob.bb + 0.4) return;
    this._hit(ob, ball, events, -0.6, 0);
  },
};

// penguins on a sled gliding across the track at a steady speed (edge to edge and back): time your lane change, or jump it
KIND.pensled = {
  build(ob) {
    ob.fm = new Float64Array(12); ob.tough = 2; ob.color = 0xbfeaff; ob.ht = 1.3; ob.hs = 1.0; ob.hu = 0.6; ob.hc = 0.6; ob.seen = false; ob.honk = false;
    ob.cs = ob.s; ob.cu = ob.u; ob.W = ob.hw + 2.2;
    const gl = ob.glow || 0x7fe0ff;
    const mk = (key, hex, ou, h, sx, sy, sz, oz = 0) => { const p = this._part(ob, key, hex, ob.u + ou, h, 0, 0, sx, sy, sz, 0, 0, oz, ob.fm); p.du = ou; return p; };
    mk('box', 0x4a9ad8, 0, 0.4, 1.1, 0.3, 2.2); mk('box', gl, 0, 0.6, 1.15, 0.1, 2.25); mk('box', 0xe8f4ff, -0.5, 0.1, 0.12, 0.08, 2.4); mk('box', 0xe8f4ff, 0.5, 0.1, 0.12, 0.08, 2.4);
    for (const oz of [-0.5, 0.5]) {
      mk('ball', 0x1a1d26, 0, 1.0, 0.62, 0.9, 0.55, oz); mk('ball', 0xffffff, 0, 0.95, 0.42, 0.62, 0.3, oz + 0.14);
      mk('ball', 0xff9a2a, 0, 1.25, 0.12, 0.1, 0.22, oz + 0.3);
    }
  },
  anim(ob) {
    const t = this.time, W = ob.W, x = (ob.ph + t * ob.v) % (4 * W), cu = x < 2 * W ? -W + x : 3 * W - x;
    ob.cu = cu; ob.lean = 0.12 * Math.sin(t * 5 + ob.ph);
    this._frameInto(ob.s, ob.fm);
    for (const p of ob.parts) if (p.idx >= 0) this._repart(p, cu + p.du, p.h, 0, ob.lean, p.sx, p.sy, p.sz, 0, 0, p.oz, 0, ob.fm);
  },
  hit(ob, ball, events) {
    const d = ob.s - ball.s;
    if (!ob.seen && d > 0 && d < 45) { ob.seen = true; fxEv(events, 'pensled', 0); }
    if (!ob.honk && d > 0 && d < 32) { ob.honk = true; fxEv(events, 'pensled', 1); }
    this._pass(ob, ball, events, ob.cs, ob.cu, ob.hs, ob.hu, ob.ht);
    if (ob.passDone && ob.over && !ob.rescued) { ob.rescued = true; fxEv(events, 'pensled', 2); }
    const H = this._aabb(ball, ob.cs - ob.hs, ob.cs + ob.hs, ob.cu - ob.hu, ob.cu + ob.hu, 0, ob.ht);
    if (H && (H.ds !== 0 || H.du !== 0)) this._hit(ob, ball, events, H.ds, H.du);
  },
};
