// nearfade.js — hides geometry that is too close to the camera (dither fade 4.5 m -> gone at 2.5 m), per fragment on the GPU.
// Works for every InstancedMesh material (decor, obstacles, pickups, critters) with zero per-frame JS cost / allocations.
import { Vector4 } from 'three';
/** The ball for the shader: (ndc x, ndc y, view depth, 0). Depth 0 = off. runner.js sets it once per frame, so a prop between the camera and the ball dissolves and never hides it. */
export const nfBall = { value: new Vector4() };
export function nearFade(mat, near = 2.5, far = 4.5) {
  if (!mat || mat.__nearFade) return mat;
  mat.__nearFade = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vNearD; varying vec3 vNearP; varying vec2 vNearN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvNearD = length(mvPosition.xyz); vNearP = mvPosition.xyz; { vec4 nfC = projectionMatrix * mvPosition; vNearN = nfC.xy / nfC.w; }');
    shader.uniforms.uNfBall = nfBall;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vNearD; varying vec3 vNearP; varying vec2 vNearN; uniform vec4 uNfBall;')
      .replace('void main() {', `void main() {
  float nfH = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float nfK = 1.0;
  if (vNearD < ${far.toFixed(2)}) nfK = clamp((vNearD - ${near.toFixed(2)}) / ${(far - near).toFixed(2)}, 0.0, 1.0);
  if (uNfBall.z > 0.0 && -vNearP.z < uNfBall.z - 0.4) {
    nfK = min(nfK, clamp((length((vNearN - uNfBall.xy) * vec2(0.46, 1.0)) - 0.07) / 0.1, 0.0, 1.0));   // in front of the ball, on its line of sight: dissolves
    if (vNearN.y < -0.4 && -vNearP.z < 14.0) nfK = min(nfK, 0.5);     // the bottom 30% of the screen: a foreground mesh there is half see-through
  }
  if (nfK <= nfH) discard;`);
  };
  const pk = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.customProgramCacheKey = () => (pk ? pk() : '') + '|nearfade';
  mat.needsUpdate = true;
  return mat;
}
