// nearfade.js — intentionally a no-op now. It used to dither-dissolve everything near the camera / on the ball's line of sight,
// which made props, terrain and the Yeti look see-through ("screen door"). Near objects now draw solid; the camera rig, the Yeti's
// side-slide and prop placement keep the ball readable instead. The API stays so call sites and the materials' cache keys are unchanged.
import { Vector4 } from 'three';
export const nfBall = { value: new Vector4() };
export function nearFade(mat) { return mat; }
