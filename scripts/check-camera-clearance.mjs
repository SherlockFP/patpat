// Regression check (node, no browser): nothing the track builds may hang into the chase camera's view of the ball.
// Bug it guards: the chevron sign boards of a Temple Run junction hung over the outer lane at 2.8-4.8 m, right where the
// chase camera rides (runner.js updateCamera: camera on the path ~8-12 m behind the ball, 4-8 m up, over the ball's side),
// so before some corners a big yellow "wall" covered the ball and the camera flew through it.
// For several seeds x lane counts, at every junction from 45 m before the corner to the end of the arc, rays from a grid
// of camera stations (distance behind, height, ball lane) to the ball and to the look-ahead point must not hit track meshes.
// Usage: node scripts/check-camera-clearance.mjs [seeds=6] [km=6]
import * as THREE from 'three';
const { Track, setLanes, LANE_W } = await import(process.env.TRACK_MODULE || '../src/runner/track.js');   // TRACK_MODULE: check another build (e.g. the pre-fix file)

const SEEDS = +(process.argv[2] || 6), KM = +(process.argv[3] || 6);
const rc = new THREE.Raycaster(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
const f = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
const W = (tr, s, u, h, out) => { tr.toWorld(s, u, 0, out); tr.frame(s, f); return out.addScaledVector(f.up, h); };

let fails = 0, juncs = 0, rays = 0;
for (const lanes of [3, 5]) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    setLanes(lanes);
    const tr = new Track(null, { seed: seed * 7919 });
    tr.setLanes?.(lanes);
    tr.ensure(KM * 1000 + 300);
    const meshes = []; tr.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    tr.group.updateMatrixWorld(true);
    for (const J of tr._juncs) {
      juncs++;
      const n = tr.pieceAt(J.s)?.n || 3, L = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * LANE_W);   // the junction piece's own lanes
      for (let s = J.s - 45; s <= J.sEnd + 4; s += 0.5) {
        for (const lu of L) for (const r of [0.45, 1.05]) for (const back of [8, 11]) for (const up of [4, 5.5, 7.5]) {
          const camS = s - back - r * 2.9, camU = lu * 0.45;
          W(tr, camS, camU, up + r * 1.5, A);                        // camera
          W(tr, s, lu, r, B);                                         // ball centre
          W(tr, s + 13, lu * 0.5, 3.2, C);                            // look-ahead point
          for (const [to, cut] of [[B, r + 0.05], [C, 0.05]]) {
            D.subVectors(to, A); const len = D.length(); D.normalize();
            rc.set(A, D); rc.near = 0; rc.far = Math.max(0.01, len - cut); rays++;
            const h = rc.intersectObjects(meshes, false);
            if (h.length) {
              const ps = tr.pieceAt(s);
              if (ps && ps.kind !== 'junction') continue;           // only the junction's own dressing is checked here
              if (fails < 12) console.log(`FAIL seed ${seed * 7919} lanes ${lanes} corner ${J.s.toFixed(0)} dir ${J.dir} ball s ${s.toFixed(1)} u ${lu} r ${r} cam back ${back} up ${up} -> ${to === B ? 'ball' : 'look'} blocked by ${h[0].object.name} at ${h[0].distance.toFixed(2)} m`);
              fails++;
            }
          }
        }
      }
    }
    tr.dispose();
  }
}
setLanes(3);
console.log(`${juncs} junctions, ${rays} rays: ${fails ? fails + ' blocked' : 'clear'}`);
if (!juncs) { console.log('no junctions generated: check is not testing anything'); process.exit(1); }
process.exit(fails ? 1 : 0);
