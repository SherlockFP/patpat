// ppview.js — readability probe: where the ball is on screen and what 3D stuff sits in front of it. Written once per frame (no allocations),
// read by scripts/smoke-e2e.mjs through window.__ppv. ppOcc() is a CPU estimate that mirrors nearfade.js, only called by the smoke test.
import { Raycaster, Vector3 } from 'three';
export const ppView = { on: false, x: 0, y: 0, d: 1, ry: 0.1, r: 0.5, th: 0.6, st: '', hy: 0, vy: 0, asp: 0.46, w: new Float32Array(25), sx: new Float32Array(25), sy: new Float32Array(25), what: '' };
const rc = new Raycaster(), v = new Vector3(), nd = { x: 0, y: 0 }, list = [];
export function ppOcc(scene, cam, ball) {
  const P = ppView; list.length = 0;
  scene.traverseVisible((o) => { if ((o.isMesh || (o.isPoints && o.geometry.attributes.size && o.geometry.attributes.alpha)) && o.material && !o.material.polygonOffset) { for (let p = o; p; p = p.parent) if (p === ball) return; list.push(o); } });
  cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  v.copy(ball.position).applyMatrix4(cam.matrixWorldInverse); P.d = -v.z; v.applyMatrix4(cam.projectionMatrix); P.x = v.x; P.y = v.y; P.asp = cam.aspect; P.th = Math.tan(cam.fov * 0.00872665); P.ry = P.r / (P.d * P.th); P.hy = Math.tan(Math.asin(cam.matrixWorld.elements[9])) / Math.tan(cam.fov * 0.00872665);   // (live values: the camera shakes after the per-frame update)
  let k = 0; const R = P.ry, ax = P.asp > 0 ? P.asp : 1, dB = cam.position.distanceTo(ball.position); P.what = '';
  let worst = 0;
  for (let ring = 0; ring < 3; ring++) for (let a = 0, n = ring ? (ring === 1 ? 8 : 16) : 1; a < n && k < 25; a++, k++) {
    const rr = ring === 0 ? 0 : ring === 1 ? 0.5 : 0.95, an = a / n * 6.2832;
    nd.x = P.x + Math.cos(an) * rr * R * ax; nd.y = P.y + Math.sin(an) * rr * R; P.sx[k] = nd.x; P.sy[k] = nd.y;
    rc.setFromCamera(nd, cam); rc.far = dB + 2; let keep = 1, nm = '';
    for (const o of list) {
      const m = o.material, f = m.__nf;
      if (o.isPoints) {   // mist puffs: a soft round sprite each (size * uScale / depth px), alpha attribute
        const pa = o.geometry.attributes.position, sz = o.geometry.attributes.size, al = o.geometry.attributes.alpha, sc = m.uniforms.uScale.value;
        for (let i = 0; i < pa.count; i++) {
          if (al.array[i] < 0.05) continue; v.set(pa.array[i * 3], pa.array[i * 3 + 1], pa.array[i * 3 + 2]).applyMatrix4(cam.matrixWorldInverse);
          const dp = -v.z; if (dp < 0.5 || dp > P.d - 0.4) continue; const pr = Math.min(sz.array[i] * sc / dp, 256) * 0.5 / (innerHeight * 0.5); v.applyMatrix4(cam.projectionMatrix);
          if (Math.hypot((v.x - nd.x) * ax, v.y - nd.y) < pr * 0.65) { keep *= 1 - al.array[i] * 0.5; nm = 'mist'; }
        }
        continue;
      }
      const hs = rc.intersectObject(o, false); if (!hs.length) continue;
      const h = hs[0]; v.copy(h.point).applyMatrix4(cam.matrixWorldInverse); const dp = -v.z; if (dp > P.d - 0.4) continue;
      let w = m.transparent ? m.opacity : 1;
      if (f) {
        let q = 1; if (h.distance < f.far) q = Math.min(1, Math.max(0, (h.distance - f.near) / (f.far - f.near)));
        q = Math.min(q, Math.min(1, Math.max(0, (Math.hypot((nd.x - P.x) * ax, nd.y - P.y) - Math.max(f.R, P.ry * 1.05)) / f.W)));
        if (nd.y < -0.4 && dp < 14) q = Math.min(q, f.A); w *= q;
      }
      if (w > 0.02) { keep *= 1 - w; nm = (o.parent?.name || o.name || m.type) + ''; }
    }
    P.w[k] = 1 - keep; if (P.w[k] > worst) { worst = P.w[k]; P.what = nm; }
  }
  return P.w;
}
