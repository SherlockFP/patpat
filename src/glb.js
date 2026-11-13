// glb.js — PATPAT's own Blender models (public/models/*.glb: baked COLOR_0, no textures, +Y up, front +Z, origin = base centre, metres).
// loadGlbs() never throws; a missing file leaves GLB.<name> unset and every caller keeps its procedural fallback.
//   GLB.critter_bunny / GLB.prop_pine ... = BufferGeometry (position, normal, color)     GLB.yeti = { scene, clips } -> cloneYeti() gives a private skinned copy
import * as THREE from 'three';

export const GLB = {};
const STATIC = ['critter_arcticfox', 'critter_bunny', 'critter_clownbot', 'critter_jelly', 'critter_lavabug', 'critter_miniyeti', 'critter_panda', 'critter_penguin',
  'critter_polarcub', 'critter_robot', 'critter_scorpion', 'critter_snowmini', 'critter_squirrel', 'prop_crate', 'prop_logpile', 'prop_pine', 'prop_rock_big',
  'prop_rock_small', 'prop_sign', 'prop_sled', 'prop_snowman', 'prop_coin', 'prop_barrier', 'prop_cabin', 'train_loco', 'train_loco_ice', 'train_car_cyan',
  'train_car_yellow', 'train_car_orange', 'train_car_ice', 'train_ride', 'train_ride_ice'];
let _clone = null;

export async function loadGlbs(base = './models/') {
  try {
    const [{ GLTFLoader }, su] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/utils/SkeletonUtils.js')]);
    _clone = su.clone;
    const loader = new GLTFLoader();
    await Promise.all(['yeti'].concat(STATIC).map(async (name) => {
      try {
        const r = await fetch(`${base}${name}.glb`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = await r.arrayBuffer();
        const gltf = await new Promise((ok, no) => loader.parse(buf, '', ok, no));
        if (name === 'yeti') {
          if (!gltf.animations.length) throw new Error('no clips');
          GLB.yeti = { scene: gltf.scene, clips: gltf.animations };
          return;
        }
        let g = null;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => { if (!g && o.isMesh) { g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); } });
        if (!g || !g.attributes.color) throw new Error('no coloured mesh');
        g.computeBoundingBox();
        GLB[name] = g;
      } catch (e) { console.warn(`[glb] ${name}:`, e && e.message ? e.message : e); }
    }));
  } catch (e) { console.warn('[glb] unavailable, procedural models stay:', e && e.message ? e.message : e); }
}

/** a private skinned copy of the yeti (Object3D) + its clips, or null */
export function cloneYeti() {
  return GLB.yeti && _clone ? { model: _clone(GLB.yeti.scene), clips: GLB.yeti.clips } : null;
}
