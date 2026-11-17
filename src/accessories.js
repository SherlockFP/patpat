// HATS / ACCESSORIES: small merged vertex-colour meshes (one draw call each). Built in BALL-RADIUS units for a ball of radius 1 at the origin (top of the ball = y 1;
// the camera looks from +z, so face parts face +z). The same shapes dress the Yeti: buildYetiAcc() scales one shape onto the head bone of the GLB.
//   buildHat(id)     -> { group, material, dispose, update?(dt, t) } or null     (hat ids: cosmetics.js HATS, fx.m = shape name)
//   buildYetiAcc(id) -> same, placed for the Yeti's head bone (metres)
import * as THREE from 'three';
import { itemOf } from './cosmetics.js';

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _col = new THREE.Color();
// one primitive: geometry g, colour (hex or fn(x,y,z)->hex), position p, euler rotation r, scale s
function part(g, col, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const geo = g.index ? g.toNonIndexed() : g.clone();
  _m4.compose(new THREE.Vector3(...p), _q.setFromEuler(_e.set(r[0], r[1], r[2])), new THREE.Vector3(...s));
  geo.applyMatrix4(_m4);
  const pos = geo.attributes.position, c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { _col.set(typeof col === 'function' ? col(pos.getX(i), pos.getY(i), pos.getZ(i)) : col); c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); geo.deleteAttribute('uv');
  g.dispose();
  return geo;
}
function merge(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
  for (const g of list) { P.set(g.attributes.position.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.computeVertexNormals();
  return g;
}
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const sph = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const tor = (R, t, a = 8, b = 20) => new THREE.TorusGeometry(R, t, a, b);
const HP = Math.PI / 2;

// every shape returns { parts: [geometry], emissive?, upd?(group, dt, t) }
const SHAPES = {
  crown: () => {
    const gold = 0xffc83a, dk = 0xd89a1a, L = [part(cyl(0.6, 0.62, 0.26, 10), gold, [0, 1.0, 0]), part(tor(0.61, 0.045, 5, 18), dk, [0, 0.9, 0], [HP, 0, 0]), part(tor(0.6, 0.04, 5, 18), dk, [0, 1.12, 0], [HP, 0, 0])];
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.2832, x = Math.cos(a) * 0.5, z = Math.sin(a) * 0.5; L.push(part(cyl(0.01, 0.15, 0.36, 4), gold, [x, 1.3, z]), part(sph(0.075, 0), i % 2 ? 0xff3a5a : 0x3ad0ff, [x, 1.5, z])); }
    return { parts: L, emissive: 0x3a2400 };
  },
  beanie: () => [
    part(sph(0.64, 2), (x, y) => (Math.sin(y * 16) > 0.1 ? 0xff4a5a : 0xffffff), [0, 0.7, 0], [0, 0, 0], [1, 0.82, 1]),
    part(tor(0.62, 0.1, 6, 22), 0x2a3a5a, [0, 0.76, 0], [HP, 0, 0]), part(sph(0.17, 2), 0xffffff, [0, 1.3, 0])],
  pirate: () => ({ parts: [
    part(cyl(0.5, 0.56, 0.3, 12), 0x1a1a22, [0, 1.02, 0]), part(cyl(0.95, 0.95, 0.07, 18), 0x1a1a22, [0, 0.92, 0], [0, 0, 0], [1, 1, 0.8]),
    part(tor(0.53, 0.04, 5, 16), 0xd8402a, [0, 0.99, 0], [HP, 0, 0]),
    part(sph(0.1, 1), 0xf4f0e0, [0, 1.06, 0.55]), part(box(0.34, 0.05, 0.03), 0xf4f0e0, [0, 1.0, 0.56], [0, 0, 0.6]), part(box(0.34, 0.05, 0.03), 0xf4f0e0, [0, 1.0, 0.56], [0, 0, -0.6])] }),
  horns: () => {
    const L = [part(tor(0.55, 0.06, 5, 18), 0x5a1a1a, [0, 0.82, 0], [HP, 0, 0])];
    for (const s of [-1, 1]) { L.push(part(cyl(0.02, 0.16, 0.42, 6), 0xf2e6c8, [s * 0.44, 1.12, 0], [0, 0, -s * 0.45]), part(cyl(0.01, 0.05, 0.3, 6), 0xf2e6c8, [s * 0.72, 1.42, 0], [0, 0, -s * 0.95])); }
    return L;
  },
  halo: () => ({ parts: [part(tor(0.55, 0.06, 6, 28), 0xfff0a0, [0, 0, 0], [HP, 0, 0])], emissive: 0xc89a10, y: 1.5, upd: (g, dt, t) => { g.position.y = 1.5 + Math.sin(t * 2.4) * 0.06; g.rotation.y += dt * 0.8; } }),
  shades: () => ({ parts: [
    part(box(0.42, 0.26, 0.09), 0x14141c, [-0.27, 0.42, 0.84], [0, 0.32, 0]), part(box(0.42, 0.26, 0.09), 0x14141c, [0.27, 0.42, 0.84], [0, -0.32, 0]), part(box(0.2, 0.05, 0.06), 0x14141c, [0, 0.46, 0.9]),
    part(box(0.12, 0.05, 0.02), 0x9fd8ff, [-0.34, 0.5, 0.9], [0, 0.32, 0]), part(box(0.12, 0.05, 0.02), 0x9fd8ff, [0.2, 0.5, 0.9], [0, -0.32, 0]),
    part(box(0.05, 0.05, 0.5), 0x14141c, [-0.52, 0.42, 0.6], [0, 0.9, 0]), part(box(0.05, 0.05, 0.5), 0x14141c, [0.52, 0.42, 0.6], [0, -0.9, 0])] }),
  scarf: () => ({ parts: [
    part(tor(0.95, 0.15, 7, 28), (x, y, z) => (Math.sin(Math.atan2(z, x) * 7) > 0 ? 0xe83a4a : 0xffffff), [0, 0.3, 0], [HP, 0, 0]),
    part(box(0.2, 0.62, 0.05), 0xe83a4a, [0.6, -0.12, 0.74], [0.3, 0, 0], [1, 1, 1]), part(box(0.2, 0.55, 0.05), 0xffffff, [0.82, -0.05, 0.58], [0.2, 0.5, 0])],
    upd: (g, dt, t) => { const tail = g.children[0]; if (tail) tail.rotation.z = Math.sin(t * 5) * 0.04; } }),
  tophat: () => ({ parts: [part(cyl(0.45, 0.47, 0.62, 14), 0x1c1c26, [0, 1.2, 0]), part(cyl(0.78, 0.78, 0.07, 18), 0x1c1c26, [0, 0.9, 0]), part(cyl(0.475, 0.475, 0.12, 14), 0xc83a4a, [0, 1.0, 0]), part(box(0.14, 0.12, 0.03), 0xffd23a, [0, 1.0, 0.48])] }),
};
const norm = (r) => (Array.isArray(r) ? { parts: r } : r);

function make(shape, scale = 1, pos = [0, 0, 0]) {
  const sh = SHAPES[shape]; if (!sh) return null;
  const r = norm(sh()), geo = merge(r.parts);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: r.emissive || 0x000000, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material); mesh.frustumCulled = false; mesh.renderOrder = 2;
  const group = new THREE.Group(); group.add(mesh); group.position.set(pos[0], pos[1], pos[2]); group.scale.setScalar(scale);
  if (r.y) group.position.y = r.y * scale;
  return { group, material, dispose: () => { geo.dispose(); material.dispose(); }, update: r.upd ? (dt, t) => r.upd(group, dt, t) : null };
}

export function buildHat(id) { const it = itemOf('hat', id); return it && it.fx && it.fx.m ? make(it.fx.m) : null; }
// the Yeti's head: bone 'head' sits at the neck / skull base; a unit-ball hat is scaled to a head of radius ~1.25 centred 0.75 above it
export function buildYetiAcc(id) {
  const it = itemOf('yacc', id); if (!it || !it.fx || !it.fx.m) return null;
  const f = it.fx; return make(f.m, f.s || 1.3, f.p || [0, 0.4, 0.05]);
}
