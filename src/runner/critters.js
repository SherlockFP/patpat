// critters.js — CRITTERS of the Yeti Rush track: cute low-poly creatures that waddle down the lanes slower than the ball, so you run up to them.
// Jump on one = STOMP (the runner bounces the ball, combo, poof); touch it from the front / side = stumble (not lethal).
//
// Per-biome sets (procedural: spheres / boxes / cones with baked vertex colours, flat shaded): Karli Zirve penguin + kar tavsani, Cam Ormani sincap +
// mini-yeti, Kasaba kardan adamcik, Col akrep, Seker Diyari jole ayicik, Neon Gece mini robot, Volkan ates boceği / lav topu (unlit); the other
// biomes map onto one of them. One InstancedMesh per species (capacity CAP, only drawn while it has live instances), plus one for the poof puffs.
//
// Behaviour: critters stand (idle bob) until the ball is ~2.5 s away, then waddle forward at 3-4.6 m/s (bob + waddle roll). Some HOP one lane with a
// 0.6 s crouch telegraph (never into the route lane: the spawner keeps it free). Parades of 3-5 in one lane are spaced so a stomp bounce lands on the next.
// Collision (called from obstacles.collide for the main ball): { type:'critter', id, stomp, x } with stomp = the ball is moving down (vh < 0) and its
// bottom is above 45% of the critter's height. obstacles.killCritter(id) -> squash + poof (0.25 s). If the runner does not answer a stomp within 0.2 s
// the critter pops by itself. No per-frame allocation: fixed record pools, preallocated frames.

import * as THREE from 'three';
import { makeRng } from '../rng.js';
import { LANES } from './track.js';
import { nearFade } from './nearfade.js';
import { GLB } from '../glb.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

const CAP = 26;          // live instances per species
const NREC = 72;         // critter records
const NPUFF = 72;        // poof puffs
const _c = new THREE.Color();

// ---------------------------------------------------------------------------
// Geometry kit
// ---------------------------------------------------------------------------
const SPH = new THREE.SphereGeometry(0.5, 9, 6), BOXG = new THREE.BoxGeometry(1, 1, 1), CONE = new THREE.ConeGeometry(0.5, 1, 7), CYLG = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const KIT = { s: SPH, b: BOXG, c: CONE, y: CYLG };

/** parts: [kit key, hex, x, y, z, sx, sy, sz, rx, ry, rz]; front = +z. shade: bake a light top / dark underside (unlit species) or a mild one (lit). */
function build(parts, unlit) {
  const pos = [], col = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const [k, hex, x, y, z, sx, sy, sz, rx, ry, rz] of parts) {
    const g = KIT[k].index ? KIT[k].toNonIndexed() : KIT[k].clone();
    q.setFromEuler(e.set(rx || 0, ry || 0, rz || 0));
    m.compose(p.set(x, y, z), q, sc.set(sx, sy, sz));
    g.applyMatrix4(m);
    const a = g.attributes.position.array;
    _c.setHex(hex);
    for (let i = 0; i < a.length; i += 9) {
      const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2], vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
      const ny = (uz * vx - ux * vz), nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1;
      const k2 = unlit ? 0.72 + 0.28 * (ny / nl * 0.5 + 0.5) : 0.8 + 0.2 * (ny / nl * 0.5 + 0.5);
      for (let j = 0; j < 3; j++) { pos.push(a[i + j * 3], a[i + j * 3 + 1], a[i + j * 3 + 2]); col.push(_c.r * k2, _c.g * k2, _c.b * k2); }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  out.computeVertexNormals();
  return out;
}

// eyes (white + pupil) at (x, y, z) facing +z
const eyes = (x, y, z, r = 0.07, wh = 0xffffff) => [['s', wh, -x, y, z, r * 2, r * 2, r * 1.6], ['s', wh, x, y, z, r * 2, r * 2, r * 1.6],
  ['s', 0x14161c, -x, y - r * 0.1, z + r * 0.75, r, r * 1.2, r * 0.7], ['s', 0x14161c, x, y - r * 0.1, z + r * 0.75, r, r * 1.2, r * 0.7]];

// species: { name, rad (collision radius), ht (collision height), parts, unlit, tints (per-instance colours), score }
const SPECIES = {
  penguin: { name: 'Penguen', rad: 0.36, ht: 0.9, parts: [
    ['s', 0x23314f, 0, 0.42, 0, 0.62, 0.78, 0.52], ['s', 0xeef3f8, 0, 0.4, 0.12, 0.44, 0.62, 0.34], ['s', 0x23314f, 0, 0.84, 0.02, 0.36, 0.34, 0.34], ['s', 0xeef3f8, 0, 0.82, 0.1, 0.22, 0.18, 0.12],
    ['c', 0xff9f1c, 0, 0.79, 0.2, 0.12, 0.16, 0.12, PI / 2, 0, 0], ...eyes(0.075, 0.88, 0.13, 0.06),
    ['b', 0xff9f1c, -0.12, 0.03, 0.06, 0.14, 0.06, 0.22], ['b', 0xff9f1c, 0.12, 0.03, 0.06, 0.14, 0.06, 0.22],
    ['s', 0x1b2640, -0.33, 0.46, 0, 0.12, 0.42, 0.24, 0, 0, 0.3], ['s', 0x1b2640, 0.33, 0.46, 0, 0.12, 0.42, 0.24, 0, 0, -0.3]] },
  bunny: { name: 'Kar Tavsani', rad: 0.36, ht: 0.8, parts: [
    ['s', 0xc3d2e4, 0, 0.32, 0, 0.52, 0.5, 0.56], ['s', 0xe4edf7, 0, 0.3, 0.14, 0.34, 0.36, 0.26], ['s', 0xd2deec, 0, 0.64, 0.06, 0.38, 0.34, 0.36],
    ['s', 0xc3d2e4, -0.1, 0.96, 0.02, 0.1, 0.42, 0.08, 0, 0, 0.12], ['s', 0xc3d2e4, 0.1, 0.96, 0.02, 0.1, 0.42, 0.08, 0, 0, -0.12],
    ['s', 0xf3a6bd, -0.1, 0.94, 0.05, 0.05, 0.3, 0.03, 0, 0, 0.12], ['s', 0xf3a6bd, 0.1, 0.94, 0.05, 0.05, 0.3, 0.03, 0, 0, -0.12],
    ['s', 0xffffff, 0, 0.28, -0.3, 0.2, 0.2, 0.2], ['s', 0xf3a6bd, 0, 0.6, 0.23, 0.07, 0.06, 0.05], ...eyes(0.085, 0.69, 0.18, 0.05),
    ['s', 0xc3d2e4, -0.14, 0.05, 0.12, 0.16, 0.1, 0.26], ['s', 0xc3d2e4, 0.14, 0.05, 0.12, 0.16, 0.1, 0.26]] },
  squirrel: { name: 'Sincap', rad: 0.38, ht: 0.8, parts: [
    ['s', 0x9a5b2e, 0, 0.32, 0, 0.5, 0.55, 0.5], ['s', 0xe8cfa6, 0, 0.3, 0.14, 0.32, 0.4, 0.26], ['s', 0xa8683a, 0, 0.68, 0.04, 0.4, 0.36, 0.36],
    ['c', 0x8a4f26, -0.13, 0.9, 0, 0.1, 0.14, 0.08], ['c', 0x8a4f26, 0.13, 0.9, 0, 0.1, 0.14, 0.08], ['s', 0xe8cfa6, 0, 0.62, 0.17, 0.16, 0.12, 0.1], ['s', 0x2a1a12, 0, 0.66, 0.22, 0.06, 0.05, 0.04],
    ...eyes(0.085, 0.72, 0.15, 0.05), ['s', 0xc47a3a, 0, 0.45, -0.3, 0.32, 0.4, 0.3], ['s', 0xd48a48, 0, 0.7, -0.36, 0.34, 0.4, 0.3], ['s', 0xe8a560, 0, 0.88, -0.28, 0.26, 0.26, 0.24],
    ['s', 0x5a3418, -0.12, 0.04, 0.08, 0.15, 0.08, 0.22], ['s', 0x5a3418, 0.12, 0.04, 0.08, 0.15, 0.08, 0.22]] },
  miniyeti: { name: 'Mini Yeti', rad: 0.42, ht: 0.95, parts: [
    ['s', 0x9bbfe6, 0, 0.42, 0, 0.74, 0.7, 0.62], ['s', 0xd8e9f9, 0, 0.36, 0.17, 0.46, 0.42, 0.3], ['s', 0xaecbed, 0, 0.8, 0.05, 0.5, 0.42, 0.42], ['s', 0x2c3a55, 0, 0.78, 0.22, 0.34, 0.24, 0.1],
    ...eyes(0.09, 0.84, 0.25, 0.05, 0xfff3a0), ['c', 0xffffff, -0.15, 1.02, 0.02, 0.1, 0.16, 0.1], ['c', 0xffffff, 0.15, 1.02, 0.02, 0.1, 0.16, 0.1],
    ['s', 0x9bbfe6, -0.4, 0.42, 0.06, 0.22, 0.4, 0.24], ['s', 0x9bbfe6, 0.4, 0.42, 0.06, 0.22, 0.4, 0.24], ['b', 0x2c3a55, -0.16, 0.05, 0.1, 0.2, 0.1, 0.28], ['b', 0x2c3a55, 0.16, 0.05, 0.1, 0.2, 0.1, 0.28],
    ['b', 0xffffff, -0.06, 0.7, 0.28, 0.05, 0.07, 0.04], ['b', 0xffffff, 0.06, 0.7, 0.28, 0.05, 0.07, 0.04]] },
  snowmini: { name: 'Kardan Adamcik', rad: 0.36, ht: 0.92, parts: [
    ['s', 0xd2e1f3, 0, 0.23, 0, 0.5, 0.46, 0.5], ['s', 0xd8e6f6, 0, 0.53, 0, 0.38, 0.36, 0.38], ['s', 0xdfeaf8, 0, 0.78, 0, 0.3, 0.28, 0.3],
    ['y', 0xd9482f, 0, 0.66, 0, 0.34, 0.07, 0.34], ['b', 0xd9482f, 0.12, 0.58, 0.14, 0.08, 0.2, 0.05], ['y', 0x23252e, 0, 0.93, 0, 0.36, 0.03, 0.36], ['y', 0x23252e, 0, 1.01, 0, 0.2, 0.16, 0.2],
    ['c', 0xff8a1f, 0, 0.78, 0.17, 0.07, 0.16, 0.07, PI / 2, 0, 0], ['s', 0x23252e, -0.06, 0.83, 0.13, 0.05, 0.05, 0.04], ['s', 0x23252e, 0.06, 0.83, 0.13, 0.05, 0.05, 0.04],
    ['s', 0x23252e, 0, 0.56, 0.18, 0.05, 0.05, 0.04], ['s', 0x23252e, 0, 0.46, 0.2, 0.05, 0.05, 0.04],
    ['b', 0x6b4a2b, -0.27, 0.56, 0, 0.3, 0.04, 0.04, 0, 0, 0.5], ['b', 0x6b4a2b, 0.27, 0.56, 0, 0.3, 0.04, 0.04, 0, 0, -0.5]] },
  scorpion: { name: 'Akrep', rad: 0.48, ht: 0.62, parts: [
    ['s', 0xb5481f, 0, 0.22, 0, 0.62, 0.3, 0.8], ['s', 0xc9582a, 0, 0.3, 0.3, 0.4, 0.22, 0.28], ...eyes(0.07, 0.4, 0.42, 0.04),
    ['b', 0xc9582a, -0.26, 0.2, 0.42, 0.06, 0.06, 0.34, 0, 0.5, 0], ['b', 0xc9582a, 0.26, 0.2, 0.42, 0.06, 0.06, 0.34, 0, -0.5, 0],
    ['s', 0xe0702f, -0.36, 0.2, 0.62, 0.2, 0.14, 0.3], ['s', 0xe0702f, 0.36, 0.2, 0.62, 0.2, 0.14, 0.3],
    ['s', 0xb5481f, 0, 0.32, -0.42, 0.2, 0.2, 0.2], ['s', 0xb5481f, 0, 0.5, -0.5, 0.18, 0.2, 0.18], ['s', 0xb5481f, 0, 0.7, -0.42, 0.17, 0.2, 0.17], ['c', 0x6b1a0e, 0, 0.84, -0.3, 0.1, 0.2, 0.1, 0.9, 0, 0],
    ['b', 0x4a1a0e, -0.34, 0.07, 0.15, 0.24, 0.05, 0.05, 0, 0.3, 0], ['b', 0x4a1a0e, 0.34, 0.07, 0.15, 0.24, 0.05, 0.05, 0, -0.3, 0], ['b', 0x4a1a0e, -0.34, 0.07, -0.1, 0.24, 0.05, 0.05], ['b', 0x4a1a0e, 0.34, 0.07, -0.1, 0.24, 0.05, 0.05]] },
  jelly: { name: 'Jole Ayicik', rad: 0.38, ht: 0.85, tints: [0xff4a5c, 0x45e07a, 0xffa826, 0xffe44a, 0xb36bff], parts: [
    ['s', 0xffffff, 0, 0.33, 0, 0.56, 0.6, 0.5], ['s', 0xffffff, 0, 0.72, 0.03, 0.4, 0.38, 0.36], ['s', 0xffffff, -0.16, 0.92, 0, 0.16, 0.16, 0.12], ['s', 0xffffff, 0.16, 0.92, 0, 0.16, 0.16, 0.12],
    ['s', 0xfff0f0, 0, 0.66, 0.16, 0.18, 0.13, 0.1], ['s', 0x2a1620, 0, 0.7, 0.2, 0.06, 0.05, 0.04], ...eyes(0.085, 0.78, 0.15, 0.05), ['s', 0xffffff, -0.12, 0.88, 0.14, 0.07, 0.07, 0.03],
    ['s', 0xffffff, -0.34, 0.33, 0.05, 0.18, 0.3, 0.2], ['s', 0xffffff, 0.34, 0.33, 0.05, 0.18, 0.3, 0.2], ['s', 0xffffff, -0.14, 0.06, 0.06, 0.2, 0.14, 0.24], ['s', 0xffffff, 0.14, 0.06, 0.06, 0.2, 0.14, 0.24]] },
  robot: { name: 'Mini Robot', rad: 0.38, ht: 0.85, parts: [
    ['b', 0x4fd0ee, 0, 0.4, 0, 0.5, 0.42, 0.4], ['b', 0x2a3a58, 0, 0.4, 0.2, 0.3, 0.2, 0.02], ['b', 0x8fe9ff, 0, 0.76, 0, 0.42, 0.3, 0.34], ['b', 0xff2bd6, 0, 0.78, 0.18, 0.32, 0.09, 0.04],
    ['y', 0x2a3a58, 0, 0.98, 0, 0.04, 0.2, 0.04], ['s', 0xff4a4a, 0, 1.1, 0, 0.12, 0.12, 0.12], ['b', 0x2a3a58, -0.32, 0.42, 0.04, 0.1, 0.3, 0.1], ['b', 0x2a3a58, 0.32, 0.42, 0.04, 0.1, 0.3, 0.1],
    ['b', 0x1d2233, -0.15, 0.09, 0, 0.16, 0.18, 0.3], ['b', 0x1d2233, 0.15, 0.09, 0, 0.16, 0.18, 0.3], ['s', 0xffd23a, -0.1, 0.48, 0.2, 0.06, 0.06, 0.04], ['s', 0x5bff9a, 0.1, 0.48, 0.2, 0.06, 0.06, 0.04]] },
  arcticfox: { name: 'Kutup Tilkisi', rad: 0.36, ht: 0.8, parts: [
    ['s', 0xf2f8ff, 0, 0.32, 0, 0.46, 0.46, 0.62], ['s', 0xffffff, 0, 0.55, 0.28, 0.36, 0.34, 0.34], ['c', 0xf2f8ff, -0.12, 0.8, 0.26, 0.1, 0.18, 0.08], ['c', 0xf2f8ff, 0.12, 0.8, 0.26, 0.1, 0.18, 0.08],
    ['s', 0x23314f, 0, 0.5, 0.48, 0.1, 0.08, 0.08], ...eyes(0.07, 0.6, 0.42, 0.045, 0xbfffe8), ['s', 0xffffff, 0, 0.42, -0.4, 0.34, 0.34, 0.5], ['s', 0x5fffc0, 0, 0.42, -0.62, 0.2, 0.2, 0.18],
    ['s', 0xcfdcea, -0.14, 0.05, 0.14, 0.12, 0.1, 0.22], ['s', 0xcfdcea, 0.14, 0.05, 0.14, 0.12, 0.1, 0.22]] },
  panda: { name: 'Panda', rad: 0.42, ht: 0.9, parts: [
    ['s', 0xf6f6f2, 0, 0.4, 0, 0.7, 0.66, 0.6], ['s', 0x23262c, 0, 0.42, 0.04, 0.74, 0.22, 0.52], ['s', 0xf6f6f2, 0, 0.82, 0.06, 0.5, 0.42, 0.42], ['s', 0x23262c, -0.2, 1.04, 0.04, 0.16, 0.16, 0.1], ['s', 0x23262c, 0.2, 1.04, 0.04, 0.16, 0.16, 0.1],
    ['s', 0x23262c, -0.12, 0.86, 0.24, 0.14, 0.12, 0.06], ['s', 0x23262c, 0.12, 0.86, 0.24, 0.14, 0.12, 0.06], ['s', 0xffffff, -0.12, 0.87, 0.28, 0.05, 0.05, 0.03], ['s', 0xffffff, 0.12, 0.87, 0.28, 0.05, 0.05, 0.03],
    ['s', 0x23262c, 0, 0.76, 0.28, 0.1, 0.07, 0.06], ['s', 0x23262c, -0.18, 0.08, 0.1, 0.2, 0.16, 0.26], ['s', 0x23262c, 0.18, 0.08, 0.1, 0.2, 0.16, 0.26], ['s', 0x23262c, -0.4, 0.46, 0.06, 0.18, 0.36, 0.22], ['s', 0x23262c, 0.4, 0.46, 0.06, 0.18, 0.36, 0.22]] },
  polarcub: { name: 'Buz Yavrusu', rad: 0.4, ht: 0.85, tints: [0xbfe6ff, 0xe8f6ff, 0xa8d8f8], parts: [
    ['s', 0xffffff, 0, 0.36, 0, 0.62, 0.56, 0.7], ['s', 0xffffff, 0, 0.62, 0.36, 0.42, 0.4, 0.38], ['s', 0x6fb8ee, -0.14, 0.86, 0.34, 0.12, 0.12, 0.08], ['s', 0x6fb8ee, 0.14, 0.86, 0.34, 0.12, 0.12, 0.08],
    ['s', 0x1d3a6a, 0, 0.58, 0.58, 0.14, 0.1, 0.08], ...eyes(0.08, 0.7, 0.54, 0.05), ['b', 0x3a8ae8, 0, 0.5, -0.04, 0.66, 0.1, 0.5], ['s', 0xcfeaff, -0.16, 0.05, 0.2, 0.18, 0.1, 0.28], ['s', 0xcfeaff, 0.16, 0.05, 0.2, 0.18, 0.1, 0.28]] },
  clownbot: { name: 'Palyaço', rad: 0.36, ht: 0.95, tints: [0xff4a5c, 0x45a0ff, 0xffd23a, 0x5bff9a], parts: [
    ['s', 0xffffff, 0, 0.3, 0, 0.5, 0.56, 0.44], ['s', 0xffd23a, 0, 0.3, 0.2, 0.2, 0.2, 0.08], ['s', 0xffe6d0, 0, 0.74, 0, 0.36, 0.34, 0.34], ['s', 0xff3a3a, 0, 0.7, 0.17, 0.12, 0.12, 0.1], ...eyes(0.075, 0.8, 0.14, 0.05),
    ['c', 0xffffff, 0, 1.02, 0, 0.3, 0.34, 0.3], ['s', 0xff3a8a, 0, 1.22, 0, 0.14, 0.14, 0.14], ['s', 0xff8a1f, -0.24, 0.8, 0, 0.18, 0.22, 0.18], ['s', 0xff8a1f, 0.24, 0.8, 0, 0.18, 0.22, 0.18],
    ['b', 0xff3a3a, -0.13, 0.05, 0.08, 0.2, 0.08, 0.34], ['b', 0xff3a3a, 0.13, 0.05, 0.08, 0.2, 0.08, 0.34]] },
  lavabug: { name: 'Lav Boceği', rad: 0.4, ht: 0.7, unlit: true, parts: [
    ['s', 0xff7a1a, 0, 0.3, 0, 0.64, 0.52, 0.64], ['s', 0xffa23a, 0, 0.4, 0.3, 0.3, 0.26, 0.26], ['s', 0x3a1a10, -0.14, 0.52, -0.05, 0.16, 0.08, 0.16], ['s', 0x3a1a10, 0.16, 0.5, 0.08, 0.14, 0.08, 0.14], ['s', 0x3a1a10, 0.02, 0.54, -0.2, 0.14, 0.08, 0.14],
    ...eyes(0.08, 0.46, 0.4, 0.05, 0xfff3a0), ['b', 0xffe14a, -0.1, 0.62, 0.34, 0.03, 0.26, 0.03, 0.6, 0, 0.3], ['b', 0xffe14a, 0.1, 0.62, 0.34, 0.03, 0.26, 0.03, 0.6, 0, -0.3],
    ['b', 0x4a1a0e, -0.3, 0.06, 0.12, 0.22, 0.05, 0.05], ['b', 0x4a1a0e, 0.3, 0.06, 0.12, 0.22, 0.05, 0.05], ['b', 0x4a1a0e, -0.3, 0.06, -0.1, 0.22, 0.05, 0.05], ['b', 0x4a1a0e, 0.3, 0.06, -0.1, 0.22, 0.05, 0.05]] },
};
const ORDER = Object.keys(SPECIES);
// biome id -> species candidates (every biome maps onto one of the nine)
const BIOME_SET = {
  snow: ['penguin', 'bunny'], forest: ['squirrel', 'miniyeti'], greenhill: ['squirrel', 'bunny'], kapadokya: ['scorpion'], town: ['snowmini', 'bunny'], desert: ['scorpion'],
  icecave: ['penguin', 'miniyeti'], candy: ['jelly'], sakura: ['bunny', 'squirrel'], istanbul: ['squirrel', 'snowmini'], neon: ['robot'], moon: ['robot'], pirate: ['scorpion', 'squirrel'], volcano: ['lavabug'], aurora: ['arcticfox', 'bunny'], bamboo: ['panda', 'squirrel'], glacier: ['polarcub', 'penguin'], carnival: ['clownbot', 'jelly'],
};

// ---------------------------------------------------------------------------
export class Critters {
  /** @param {THREE.Group} group  @param {object} track  @param {{seed?:number, ev?:Function}} opts  ev(events, type) = the obstacles event pool */
  constructor(group, track, opts = {}) {
    this.group = group;
    this.track = track;
    this.ev = opts.ev || null;
    this.rng = makeRng(((opts.seed ?? 1) ^ 0x51ed270b) >>> 0);
    this.time = 0;
    this.lit = nearFade(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.glow = nearFade(new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.puffMat = new THREE.MeshBasicMaterial({ vertexColors: false });
    this.sp = {};              // species id -> { def, mesh, free[], hi, geo }
    this._geos = [];
    this.recs = [];            // fixed record pool
    for (let i = 0; i < NREC; i++) this.recs.push({ on: false, id: 0, sp: '', idx: -1, s0: 0, s: 0, u: 0, h: 0, lane: 1, hopTo: -1, vc: 3.5, hopU: 0, state: 0, t0: 0, tAct: 0, ph: 0, k: 1,
      rad: 0.4, ht: 0.8, dyingT: -1, stompAt: -1, hitCd: 0, seed: 0, f: new Float64Array(12), hopped: false, grp: 0, cu: 0, stale: false });
    this.live = [];            // indices of live records (array of records, reused)
    this._id = 1;
    this.stats = { spawned: 0, stomped: 0, dropped: 0 };
    // poof puffs
    this.puffs = [];
    for (let i = 0; i < NPUFF; i++) this.puffs.push({ on: false, idx: -1, s0: 0, u: 0, s: 0, h: 0, vs: 0, vu: 0, vh: 0, life: 0, t: 0, size: 0, f: new Float64Array(12) });
    const pg = new THREE.IcosahedronGeometry(0.5, 0);
    this._geos.push(pg);
    this.puffMesh = new THREE.InstancedMesh(pg, this.puffMat, NPUFF);
    this.puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NPUFF * 3).fill(1), 3);
    this.puffMesh.frustumCulled = false; this.puffMesh.count = 0; this.puffMesh.visible = false; this.puffMesh.name = 'critter-poof';
    this._zero(this.puffMesh.instanceMatrix.array, NPUFF);
    this.group.add(this.puffMesh);
    this._puffHi = 0;
  }

  _zero(a, n) { for (let i = 0; i < n; i++) { for (let k = 0; k < 16; k++) a[i * 16 + k] = 0; a[i * 16 + 15] = 1; } }

  _species(id) {
    let S = this.sp[id];
    if (S) return S;
    const def = SPECIES[id], geo = GLB['critter_' + id] || build(def.parts, !!def.unlit);   // our Blender model (baked colours), else the procedural one
    if (!GLB['critter_' + id]) this._geos.push(geo);
    const mesh = new THREE.InstancedMesh(geo, def.unlit ? this.glow : this.lit, CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
    mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.name = 'critter-' + id;
    this._zero(mesh.instanceMatrix.array, CAP);
    this.group.add(mesh);
    S = this.sp[id] = { def, mesh, free: [], hi: 0, live: 0, dirty: false, cdirty: false };
    return S;
  }

  /** species id for a biome (random among its set, deterministic per seed) */
  speciesFor(biomeId) {
    const set = BIOME_SET[biomeId] || BIOME_SET.snow;
    return set[this.rng.int(0, set.length - 1)];
  }

  _alloc(S) {
    let i;
    if (S.free.length) i = S.free.pop();
    else if (S.hi < CAP) i = S.hi++;
    else return -1;
    S.mesh.count = S.hi; S.live++; S.mesh.visible = true;
    return i;
  }
  _release(S, i) {
    const a = S.mesh.instanceMatrix.array, o = i * 16;
    for (let k = 0; k < 16; k++) a[o + k] = 0;
    a[o + 15] = 1;
    S.free.push(i); S.live--; S.dirty = true;
    if (S.live <= 0) S.mesh.visible = false;
  }

  /**
   * Spawn a group: spec = { species, s, lane (0..2), n, spacing (m between neighbours along the lane), vc (m/s), hopTo (-1 | lane), second (-1 | lane: a second
   * lane gets a short line too), seed, skin }. Returns the number placed.
   */
  spawnGroup(spec) {
    const S = this._species(spec.species), rng = makeRng((spec.seed ?? 1) >>> 0);
    let placed = 0;
    const lines = [[spec.lane, spec.n, 0, spec.hopTo]];
    if (spec.second >= 0) lines.push([spec.second, Math.max(1, Math.min(2, spec.n - 1)), spec.spacing * 0.5, -1]);
    const tints = S.def.tints;
    for (const [lane, n, off, hopTo] of lines) {
      for (let i = 0; i < n; i++) {
        const r = this.recs.find((x) => !x.on);
        if (!r) { this.stats.dropped++; return placed; }
        const idx = this._alloc(S);
        if (idx < 0) { this.stats.dropped++; return placed; }
        r.on = true; r.id = this._id++; r.sp = spec.species; r.idx = idx; r.s0 = spec.s + off + i * spec.spacing; r.s = r.s0; r.lane = lane; r.u = LANES[lane]; r.h = 0;
        r.hopTo = hopTo; r.hopU = 0; r.vc = spec.vc * rng.range(0.92, 1.08); r.state = 0; r.t0 = 0; r.tAct = 0; r.ph = rng.range(0, TAU); r.k = rng.range(0.94, 1.1);
        r.rad = S.def.rad * r.k; r.ht = S.def.ht * r.k; r.dyingT = -1; r.stompAt = -1; r.hitCd = 0; r.hopped = false; r.grp = 0;
        const c = tints ? tints[(r.id * 7) % tints.length] : 0xffffff;
        _c.setHex(c);
        const ca = S.mesh.instanceColor.array; ca[idx * 3] = _c.r; ca[idx * 3 + 1] = _c.g; ca[idx * 3 + 2] = _c.b; S.cdirty = true;
        this.track._fr(r.s0);
        const f = this.track._f, o = r.f;
        for (let k = 0; k < 12; k++) o[k] = f[k];
        r.stale = r.s0 > this.track.genEnd - 3;     // placed past the generated path (extrapolated frame): refreshed once it exists
        r.cu = r.u;
        this._pose(r, S, 0, 0);
        this.live.push(r);
        placed++; this.stats.spawned++;
      }
    }
    return placed;
  }

  // ---- instance matrix: M = Ry(yaw) Rz(roll), scaled; positioned at (u, h) of the frame (same basis as obstacles._set) ----
  _put(S, idx, f, u, h, yaw, roll, sx, sy, sz) {
    const a = S.mesh.instanceMatrix.array, o = idx * 16;
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
    const c0x = cy * cr, c0y = sr, c0z = -sy_ * cr, c1x = -cy * sr, c1y = cr, c1z = sy_ * sr, c2x = sy_, c2z = cy;
    const w0x = c0x * f[3] + c0y * f[5] - c0z * f[8], w0y = c0x * f[11] + c0y * f[6] - c0z * f[9], w0z = c0x * f[4] + c0y * f[7] - c0z * f[10];
    const w1x = c1x * f[3] + c1y * f[5] - c1z * f[8], w1y = c1x * f[11] + c1y * f[6] - c1z * f[9], w1z = c1x * f[4] + c1y * f[7] - c1z * f[10];
    const w2x = c2x * f[3] - c2z * f[8], w2y = c2x * f[11] - c2z * f[9], w2z = c2x * f[4] - c2z * f[10];
    a[o] = w0x * sx; a[o + 1] = w0y * sx; a[o + 2] = w0z * sx; a[o + 3] = 0;
    a[o + 4] = w1x * sy; a[o + 5] = w1y * sy; a[o + 6] = w1z * sy; a[o + 7] = 0;
    a[o + 8] = w2x * sz; a[o + 9] = w2y * sz; a[o + 10] = w2z * sz; a[o + 11] = 0;
    a[o + 12] = f[0] + f[3] * u + f[5] * h; a[o + 13] = f[1] + f[11] * u + f[6] * h; a[o + 14] = f[2] + f[4] * u + f[7] * h; a[o + 15] = 1;
    S.dirty = true;
  }

  /** pose of a live critter at its current s (frame refreshed): mode 0 = idle bob, walking bob / waddle comes from r.state */
  _pose(r, S, t, dt) {
    const k = r.k;
    let yaw = 0, roll = 0, h = 0, sx = k, sy = k, sz = k, u = r.u;
    const ph = r.ph;
    if (r.dyingT >= 0) {
      const q = clamp((t - r.dyingT) / 0.25, 0, 1);
      sy = k * (1 - 0.82 * q) * (1 - smooth((q - 0.7) / 0.3)); sx = sz = k * (1 + 0.55 * q) * (1 - smooth((q - 0.7) / 0.3));
    } else if (r.state === 1) {                        // waddle
      const w = (t - r.tAct) * 7.5 + ph;
      roll = 0.2 * Math.sin(w); h = 0.06 * Math.abs(Math.sin(w)); yaw = 0.08 * Math.sin(w * 0.5);
    } else if (r.state === 2) {                        // crouch (hop telegraph): squat and wobble
      const q = clamp((t - r.t0) / 0.6, 0, 1), wob = Math.sin((t - r.t0) * 38) * 0.05 * q;
      sy = k * (1 - 0.32 * q); sx = sz = k * (1 + 0.14 * q); roll = wob; h = 0;
    } else if (r.state === 3) {                        // hop to the next lane
      const q = clamp((t - r.t0) / 0.38, 0, 1);
      h = 0.62 * Math.sin(q * PI); sy = k * (1 + 0.16 * Math.sin(q * PI)); sx = sz = k * (1 - 0.06 * Math.sin(q * PI));
      u = LANES[r.lane] + (LANES[r.hopTo] - LANES[r.lane]) * smooth(q); yaw = (LANES[r.hopTo] - LANES[r.lane]) * 0.08 * Math.sin(q * PI);
    } else if (r.state === 5) {                        // dizzy after a side hit
      const q = (t - r.t0) * 22; roll = 0.25 * Math.sin(q); yaw = 0.3 * Math.sin(q * 0.7);
    } else h = 0.03 * (1 + Math.sin(t * 3.4 + ph));   // idle bob
    r.h = h; r.cu = u;
    this._put(S, r.idx, r.f, u, h, yaw, roll, sx, sy, sz);
  }

  /** per frame: walk / hop state machine, poses, poofs. Cheap: only critters within [ball.s - 25, ball.s + 190] are touched. */
  update(dt, ball, time) {
    this.time = time;
    const live = this.live, bs = ball.s, vs = ball.vs || 12, tr = this.track;
    for (let i = live.length - 1; i >= 0; i--) {
      const r = live[i];
      if (!r.on) { live[i] = live[live.length - 1]; live.pop(); continue; }
      if (r.s0 - bs > 190 || r.s - bs < -25) { if (r.s - bs < -25 && r.s0 - bs < 0) this._drop(r, i); continue; }
      const S = this.sp[r.sp];
      if (r.dyingT >= 0) {
        if (time - r.dyingT >= 0.25) { this._drop(r, i); continue; }
        this._pose(r, S, time, dt);
        continue;
      }
      if (r.stompAt >= 0 && time >= r.stompAt) { this.kill(r.id); continue; }
      if (r.stale && tr.genEnd > r.s0 + 25) { tr._fr(r.s0); const f = tr._f; for (let k = 0; k < 12; k++) r.f[k] = f[k]; r.stale = false; if (r.state === 0) this._pose(r, S, time, dt); }
      // activation: the critter wakes up when the ball is ~2.5 s away and starts to waddle
      if (r.state === 0 && r.s0 - bs < vs * 2.5 + 14) { r.state = 1; r.tAct = time; }
      if (r.state === 1 || r.state === 2 || r.state === 3 || r.state === 5) {
        r.s += r.vc * dt * (r.state === 5 ? 0.3 : r.state === 2 ? 0.5 : 1);
        // hop telegraph: ~1.9 s before the ball arrives the critter crouches for 0.6 s, then hops one lane
        if (r.state === 1 && r.hopTo >= 0 && !r.hopped && (r.s - bs) / Math.max(2, vs - r.vc) < 1.9 && (r.s - bs) > 0) { r.state = 2; r.t0 = time; }
        else if (r.state === 2 && time - r.t0 >= 0.6) { r.state = 3; r.t0 = time; }
        else if (r.state === 3 && time - r.t0 >= 0.38) { r.state = 1; r.lane = r.hopTo; r.u = LANES[r.lane]; r.hopped = true; r.hopTo = -1; }
        else if (r.state === 5 && time - r.t0 >= 0.8) { r.state = 1; }
        tr._fr(r.s);
        const f = tr._f, o = r.f;
        for (let k = 0; k < 12; k++) o[k] = f[k];
      }
      this._pose(r, S, time, dt);
    }
    // poofs
    if (this._puffHi > 0) {
      const a = this.puffMesh.instanceMatrix.array;
      let any = 0;
      for (let i = 0; i < NPUFF; i++) {
        const p = this.puffs[i];
        if (!p.on) continue;
        p.t += dt;
        if (p.t >= p.life) { p.on = false; const o = i * 16; for (let k = 0; k < 16; k++) a[o + k] = 0; a[o + 15] = 1; continue; }
        any++;
        p.vh -= 6 * dt;
        p.s += p.vs * dt; p.u += p.vu * dt; p.h += p.vh * dt;
        const k = p.size * (1 - smooth(p.t / p.life)) * (0.6 + 0.4 * Math.min(1, p.t * 14));
        this._putRaw(a, i, p.f, p.u, p.h, p.s - p.s0, k);
      }
      this.puffMesh.instanceMatrix.needsUpdate = true;
      if (!any) { this._puffHi = 0; this.puffMesh.visible = false; }
    }
    for (const id in this.sp) {
      const S = this.sp[id];
      if (S.dirty) { S.mesh.instanceMatrix.needsUpdate = true; S.dirty = false; }
      if (S.cdirty) { S.mesh.instanceColor.needsUpdate = true; S.cdirty = false; }
    }
  }

  /** uniform-scale puff at frame f offset by ds along the path */
  _putRaw(a, i, f, u, h, ds, k) {
    const o = i * 16;
    a[o] = f[3] * k; a[o + 1] = f[11] * k; a[o + 2] = f[4] * k; a[o + 3] = 0;
    a[o + 4] = f[5] * k; a[o + 5] = f[6] * k; a[o + 6] = f[7] * k; a[o + 7] = 0;
    a[o + 8] = -f[8] * k; a[o + 9] = -f[9] * k; a[o + 10] = -f[10] * k; a[o + 11] = 0;
    a[o + 12] = f[0] + f[3] * u + f[5] * h + f[8] * ds; a[o + 13] = f[1] + f[11] * u + f[6] * h + f[9] * ds; a[o + 14] = f[2] + f[4] * u + f[7] * h + f[10] * ds; a[o + 15] = 1;
  }

  _drop(r, i) {
    const S = this.sp[r.sp];
    if (r.idx >= 0) this._release(S, r.idx);
    r.idx = -1; r.on = false;
    if (i !== undefined && this.live[i] === r) { this.live[i] = this.live[this.live.length - 1]; this.live.pop(); }
  }

  /**
   * Collision of the main ball (cb: centre-based copy: s, u, h = CENTRE height, r, vh ...). Emits { type:'critter', id, stomp, x }.
   * stomp = moving down (vh < 0) and the ball's bottom above 45% of the critter's height. Sphere-vs-cylinder test.
   */
  collide(cb, events, t) {
    if (!this.ev) return;
    const live = this.live;
    for (let i = 0; i < live.length; i++) {
      const r = live[i];
      if (!r.on || r.dyingT >= 0) continue;
      const ds = cb.s - r.s;
      if (ds > 3 || ds < -3) continue;
      if (t < r.hitCd) continue;
      const cu = r.cu, du = cb.u - cu;
      const top = r.ht + (r.state === 3 ? r.h : 0), base = r.state === 3 ? r.h : 0;
      const hd = Math.sqrt(ds * ds + du * du), dd = hd > r.rad ? hd - r.rad : 0;
      const cy = clamp(cb.h, base, top), dv = cb.h - cy;
      if (dd * dd + dv * dv >= cb.r * cb.r) continue;
      const bottom = cb.h - cb.r, stomp = cb.vh < 0 && bottom > base + 0.45 * (top - base);
      r.hitCd = t + (stomp ? 5 : 1.1);
      const e = this.ev(events, 'critter');
      e.id = r.id; e.stomp = stomp; e.kind = r.sp; e.s = r.s; e.u = cu; e.x = cu; e.h = top; e.ds = ds; e.du = du; e.value = this.stats.stomped;
      e.color = 0xffffff; e.ball = 'main';
      if (stomp) r.stompAt = t + 0.2;          // the runner answers with killCritter(id); this is the fallback
      else { r.state = 5; r.t0 = t; }
    }
  }

  /** pop a critter: squash + scale-out (0.25 s) + poof particles. Returns true if it existed. */
  kill(id) {
    const r = this.live.find((x) => x.on && x.id === id && x.dyingT < 0);
    if (!r) return false;
    r.dyingT = this.time; r.stompAt = -1; this.stats.stomped++;
    this._poof(r);
    return true;
  }

  _poof(r) {
    const S = this.sp[r.sp], rng = this.rng;
    const tint = S.def.tints ? S.def.tints[(r.id * 7) % S.def.tints.length] : r.sp === 'lavabug' ? 0xffa23a : r.sp === 'robot' ? 0x8fe9ff : r.sp === 'scorpion' ? 0xe8b080 : 0xf4f8ff;
    _c.setHex(tint);
    this.puffMesh.visible = true; this._puffHi = NPUFF;
    let made = 0;
    const ca = this.puffMesh.instanceColor.array;
    for (let i = 0; i < NPUFF && made < 8; i++) {
      const p = this.puffs[i];
      if (p.on) continue;
      const a = (made / 8) * TAU + rng.next() * 0.6, sp = rng.range(1.6, 3.4);
      p.on = true; p.t = 0; p.life = rng.range(0.34, 0.5); p.s0 = r.s; p.s = r.s; p.u = r.cu; p.h = 0.3 + rng.next() * 0.3;
      p.vs = Math.cos(a) * sp + 1.5; p.vu = Math.sin(a) * sp; p.vh = rng.range(1.2, 2.8); p.size = rng.range(0.28, 0.5) * r.k;
      const f = r.f; for (let k = 0; k < 12; k++) p.f[k] = f[k];
      p.s0 = r.s; p.s = r.s;
      const c = made & 1 ? 1 : 0.82;
      ca[i * 3] = _c.r * c + (1 - c); ca[i * 3 + 1] = _c.g * c + (1 - c); ca[i * 3 + 2] = _c.b * c + (1 - c);
      made++;
    }
    this.puffMesh.instanceColor.needsUpdate = true;
    this.puffMesh.count = NPUFF;
  }

  /** drop everything behind the ball */
  trim(sBehind) {
    const live = this.live;
    for (let i = live.length - 1; i >= 0; i--) { const r = live[i]; if (r.on && r.s < sBehind - 12) this._drop(r, i); }
  }

  /** nearest live critter ahead (debug / runner hints): returns the record or null */
  nextAhead(s) { let best = null; for (const r of this.live) if (r.on && r.dyingT < 0 && r.s > s && (!best || r.s < best.s)) best = r; return best; }

  reset() {
    for (let i = this.live.length - 1; i >= 0; i--) { const r = this.live[i]; if (r.on) this._drop(r); }
    this.live.length = 0;
    for (const p of this.puffs) p.on = false;
    this._zero(this.puffMesh.instanceMatrix.array, NPUFF);
    this.puffMesh.instanceMatrix.needsUpdate = true; this.puffMesh.visible = false; this._puffHi = 0;
    for (const id in this.sp) { const S = this.sp[id]; S.mesh.visible = false; }
  }

  dispose() {
    for (const id in this.sp) { this.group.remove(this.sp[id].mesh); this.sp[id].mesh.dispose(); }
    this.group.remove(this.puffMesh); this.puffMesh.dispose();
    for (const g of this._geos) g.dispose();
    this.lit.dispose(); this.glow.dispose(); this.puffMat.dispose();
    this.sp = {}; this.live.length = 0;
  }
}

export const CRITTER_SPECIES = ORDER;
