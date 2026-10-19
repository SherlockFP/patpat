import * as THREE from 'three';

// Visual modes ("GÖRÜNÜM"): material-level shader tweaks + an optional cheap post pass.
export const VISUAL_MODES = [
  { id: 'normal', name: 'NORMAL' },
  { id: 'toon', name: 'ÇİZGİ FİLM' },
  { id: 'pixel', name: 'PİKSEL' },
  { id: 'postcard', name: 'KARTPOSTAL' },
];

// ---- knobs ----
const AO_STRENGTH = 0.6;     // contact shadow of the ball on the surfaces around it (0 = off)
const DITHER = 1 / 255;      // noise added to the final colour: hides banding in the sky gradients

// Uniforms shared by every patched material, so switching modes never recompiles shaders.
export const SU = {
  uTime: { value: 0 },
  uToon: { value: 0 },
  uSnap: { value: new THREE.Vector2(0, 0) },
  uSparkle: { value: 1 },
  // Display-space finish (grade + vignette + dither, see cigFinish). NORMAL mode never runs the PostFX pass, so the finish lives at the end of
  // the material shaders: no render target, no extra pass, and fog / alpha keep blending in display space exactly as before.
  // Active only while a YETİ RUSH world drives it (setLookActive) and only in the normal / toon modes (pixel / postcard render linear into the post pass).
  uTail: { value: 0 },
  uGrade: { value: new THREE.Vector4(1.12, 0.22, 0.26, 0.4) },   // saturation, S-curve contrast, vignette strength, ball rim mix
  uSh: { value: new THREE.Color().setRGB(0.94, 0.97, 1.04) },     // shadow tint (multiplier)
  uHi: { value: new THREE.Color().setRGB(1.04, 1.01, 0.96) },     // highlight tint (multiplier)
  uRim: { value: new THREE.Color(0xa9c4ee) },                    // rim colour on the ball's silhouette
  uView: { value: new THREE.Vector2(1, 1) },                     // drawing-buffer size in px (vignette)
  uBall: { value: new THREE.Vector4(0, 0, 0, 0) },               // view-space centre + radius of the snowball (w = 0: none); written by main.js each frame
  uAO: { value: AO_STRENGTH },
  uFx: { value: 1 },                                             // 1 = world-space speed effects (fx.js streaks) allowed
  uLite: { value: 0 },                                           // 1 = last rung of the quality ladder (see makeGovernor)
};

let lookOn = 0;   // a YETİ RUSH environment is driving the grade uniforms
let modeTail = 1; // the visual mode renders straight to the canvas (normal / toon)
function syncTail() { SU.uTail.value = lookOn * modeTail; }
export function setLookActive(on) { lookOn = on ? 1 : 0; syncTail(); }

const VERT_PARS = /* glsl */`
varying vec3 vCigW;
uniform vec2 uSnap;
`;

const VERT_MAIN = /* glsl */`
#include <project_vertex>
{
  vec4 cigW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    cigW = batchingMatrix * cigW;
  #endif
  #ifdef USE_INSTANCING
    cigW = instanceMatrix * cigW;
  #endif
  vCigW = ( modelMatrix * cigW ).xyz;
  // PSX-style vertex wobble: snap clip-space positions to the low-res pixel grid.
  if ( uSnap.x > 0.0 ) {
    gl_Position.xy = floor( gl_Position.xy / gl_Position.w * uSnap + 0.5 ) / uSnap * gl_Position.w;
  }
}
`;

// Shared by lit materials (patchMaterial) and unlit ones (patchTail).
const TAIL_PARS = /* glsl */`
uniform float uToon;
uniform float uTail;
uniform vec4 uGrade;
uniform vec3 uSh;
uniform vec3 uHi;
uniform vec2 uView;
// Final colour (display space, after fog): saturation, soft S-curve contrast, cool-shadow / warm-highlight split, vignette, dither.
vec3 cigFinish( vec3 c ) {
  if ( uTail < 0.5 ) return c;
  float gk = 1.0 - uToon; // the cartoon look keeps its own colours: only the vignette applies
  c = clamp( c, 0.0, 1.0 );
  float l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
  c = clamp( mix( vec3( l ), c, mix( 1.0, uGrade.x, gk ) ), 0.0, 1.0 );
  c = mix( c, c * c * ( 3.0 - 2.0 * c ), uGrade.y * gk );
  c *= mix( vec3( 1.0 ), mix( uSh, uHi, smoothstep( 0.15, 0.85, l ) ), gk );
  vec2 q = gl_FragCoord.xy / uView - 0.5;
  c *= 1.0 - uGrade.z * smoothstep( 0.45, 1.1, length( q * vec2( 1.0, 0.85 ) ) * 1.414 );
  float n = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  return c + ( n - 0.5 ) * ${DITHER.toFixed(6)};
}
`;
const TAIL_CALL = 'gl_FragColor.rgb = cigFinish( gl_FragColor.rgb );';

const FRAG_PARS = /* glsl */`
varying vec3 vCigW;
uniform float uTime;
uniform float uSparkle;
uniform vec4 uBall;
uniform float uAO;
uniform vec3 uRim;
float cigHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
`;

const FRAG_MAIN = /* glsl */`
{
  vec3 cigAlb = max( diffuseColor.rgb, vec3( 0.02 ) );
  float cigAlbL = dot( cigAlb, vec3( 0.299, 0.587, 0.114 ) );
  float cigL = dot( outgoingLight, vec3( 0.299, 0.587, 0.114 ) );
  float cigShade = cigL / cigAlbL; // ≈ received light
  vec3 cigView = normalize( vViewPosition );

  // The snowball (view space): squared distance from this fragment to its centre (uBall.w = 0 means no ball: nothing is ever "near").
  vec3 cigD = uBall.xyz + vViewPosition;
  float cigD2 = max( dot( cigD, cigD ), 0.0001 );
  float cigR2 = uBall.w * uBall.w;

  #ifdef CIG_SNOW
    // Only bright, near-white texels are "snow" (dirt, roads and stripes stay as they are).
    float cigWhite = smoothstep( 0.6, 0.82, min( cigAlb.r, min( cigAlb.g, cigAlb.b ) ) );
    // Snow is never grey in shade: it goes cool blue.
    float cigSh = 1.0 - smoothstep( 0.5, 1.05, cigShade );
    outgoingLight = mix( outgoingLight, outgoingLight * vec3( 0.72, 0.84, 1.06 ) * 1.1, cigSh * cigWhite );
    // Wind ripples across the powder.
    float cigRip = sin( vCigW.x * 0.85 + sin( vCigW.z * 0.23 ) * 3.0 + vCigW.z * 0.31 );
    outgoingLight *= 1.0 - cigWhite * 0.045 * ( cigRip * 0.5 + 0.5 );
    // Glitter: tiny world-anchored points that twinkle as the camera moves; the snow the ball just churned up glitters more.
    float cigDist = length( vViewPosition );
    if ( uSparkle > 0.0 && cigDist < 70.0 ) {
      float cigFresh = cigD2 < cigR2 * 64.0 ? 1.0 - smoothstep( 1.4 * uBall.w, 8.0 * uBall.w, sqrt( cigD2 ) ) : 0.0;
      float cellK = 2.6;
      vec3 cell = floor( vCigW * cellK );
      float h = cigHash( cell );
      vec3 f = fract( vCigW * cellK ) - 0.5;
      float pr = 0.09 + cigDist * 0.0035;
      float dotMask = 1.0 - smoothstep( pr * 0.5, pr, length( f ) );
      float tw = fract( h * 37.1 + dot( cigView, vec3( 2.7, 4.1, 1.9 ) ) * 1.3 + uTime * 0.25 );
      float twinkle = smoothstep( 0.7, 1.0, tw );
      float spark = step( 0.82 - 0.14 * cigFresh, h ) * dotMask * twinkle * ( 1.0 - cigDist / 70.0 );
      outgoingLight += vec3( 1.0, 0.98, 0.92 ) * spark * cigWhite * ( 1.4 + 1.2 * cigFresh ) * uSparkle;
    }
  #endif

  if ( cigD2 < cigR2 * 30.0 ) {
    // Does this fragment's normal look away from the ball's centre (< 0: the ball's own skin) or at it (> 0: a surface near the ball)?
    float cigFacing = dot( normal, cigD ) * inversesqrt( cigD2 );
    if ( cigFacing < -0.6 ) {
      // The ball's own skin: a tinted rim at grazing angles lifts it off the background (dark blue on pale biomes, bright on dark ones).
      if ( cigD2 < cigR2 * 1.5 ) {
        float cigRim = pow( 1.0 - clamp( dot( normal, cigView ), 0.0, 1.0 ), 3.0 );
        outgoingLight = mix( outgoingLight, uRim, cigRim * uGrade.w * uTail );
      }
    } else if ( cigFacing > 0.0 ) {
      // Soft contact shadow on whatever surface is near the ball (sphere ambient occlusion): follows the track, ramps, walls and props.
      float cigOcc = clamp( cigFacing * cigR2 / cigD2, 0.0, 1.0 ) * uAO * ( 1.0 - 0.5 * uToon );
      outgoingLight *= vec3( 1.0 - 0.55 * cigOcc, 1.0 - 0.45 * cigOcc, 1.0 - 0.28 * cigOcc );
    }
  }

  if ( uToon > 0.5 ) {
    // Cel shading: 3 flat light bands, hue of the lighting kept.
    float band = cigShade < 0.55 ? 0.55 : ( cigShade < 0.95 ? 0.84 : 1.12 );
    outgoingLight = outgoingLight * ( band / max( cigShade, 0.05 ) );
    // Comic colours: push saturation.
    float tl = dot( outgoingLight, vec3( 0.299, 0.587, 0.114 ) );
    outgoingLight = max( mix( vec3( tl ), outgoingLight, 1.35 ), 0.0 );
    // Ink edges where faces turn away from the camera.
    float ndv = abs( dot( normal, cigView ) );
    outgoingLight *= mix( 0.12, 1.0, smoothstep( 0.16, 0.34, ndv ) );
  }
  else if ( uTail < 0.5 ) {
    // Legacy grade (ÇIĞ, pixel, postcard): gentle saturation, cool shadows / warm highlights.
    float gl = dot( outgoingLight, vec3( 0.299, 0.587, 0.114 ) );
    outgoingLight = max( mix( vec3( gl ), outgoingLight, 1.14 ), 0.0 );
    outgoingLight *= mix( vec3( 0.93, 0.97, 1.05 ), vec3( 1.05, 1.01, 0.95 ), smoothstep( 0.15, 0.85, gl ) );
  }
}
#include <opaque_fragment>
`;

export const GLSL = { TAIL_PARS, TAIL_CALL, FRAG_PARS, FRAG_MAIN }; // (read by scripts/check-shaders.mjs)

const patched = new WeakSet();

// Inject the shared look into a Lambert (or Phong) material. `snow: true` adds glitter + blue shadows.
export function patchMaterial(mat, { snow = false } = {}) {
  if (!mat || patched.has(mat)) return mat;
  patched.add(mat);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    for (const k of ['uTime', 'uToon', 'uSnap', 'uSparkle', 'uTail', 'uGrade', 'uSh', 'uHi', 'uRim', 'uView', 'uBall', 'uAO']) shader.uniforms[k] = SU[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', VERT_MAIN);
    let fs = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${snow ? '#define CIG_SNOW\n' : ''}${TAIL_PARS}${FRAG_PARS}`);
    fs = fs.replace('#include <opaque_fragment>', FRAG_MAIN);
    shader.fragmentShader = fs.replace('#include <fog_fragment>', `#include <fog_fragment>\n${TAIL_CALL}`);
  };
  const key = snow ? 'cig-snow' : 'cig-std';
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|${key}`;
  mat.needsUpdate = true;
  return mat;
}

const tailed = new WeakSet();

// Only the display-space finish (grade + vignette) for an unlit MeshBasic material: sky dome, valley floor, glowing decor.
export function patchTail(mat) {
  if (!mat || tailed.has(mat) || patched.has(mat)) return mat;
  tailed.add(mat);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    for (const k of ['uToon', 'uTail', 'uGrade', 'uSh', 'uHi', 'uView']) shader.uniforms[k] = SU[k];
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TAIL_PARS}`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>\n${TAIL_CALL}`);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|cig-tail`;
  mat.needsUpdate = true;
  return mat;
}

// ---------- adaptive quality ----------
// Frame-time governor (pure, no DOM): walks a ladder  [dprMax, dprMax - step, ..., dprMin, dprMin + "lite" effects].
// Down one rung when the mean frame time of a window is above downMs, up one rung after upWindows calm windows in a row
// (and not within cooldownS of the last move). Stalls (tab switch, shader compiles) are ignored; a rung that does not hold makes the next climb wait longer.
export function makeGovernor(o = {}) {
  const dprMax = o.dprMax || 1, dprMin = Math.min(o.dprMin ?? 1, dprMax), step = o.step || 0.25;
  const downMs = o.downMs ?? 21, upMs = o.upMs ?? 17.5, winMs = (o.windowS ?? 2) * 1000, upN0 = o.upWindows ?? 3, hold = o.cooldownS ?? 6, stall = o.stallMs ?? 100;
  const nDpr = Math.ceil((dprMax - dprMin) / step - 1e-6), top = nDpr + 1;
  const g = { level: 0, dpr: dprMax, lite: false, tick };
  let acc = 0, n = 0, calm = 0, need = upN0, cool = 0, sinceUp = 1e9, sinceMove = 1e9;
  function tick(ms) {
    if (!(ms > 0) || ms > stall) return false;
    acc += ms; n++; cool -= ms / 1000;
    if (acc < winMs) return false;
    const mean = acc / n;
    acc = 0; n = 0; sinceUp += winMs / 1000; sinceMove += winMs / 1000;
    let moved = false;
    if (mean > downMs) {
      calm = 0;
      if (g.level < top) {
        g.level++; moved = true; cool = hold;
        if (sinceUp < 15) need = Math.min(upN0 * 8, need * 2); // we had just climbed and it did not hold: wait longer before the next try
        sinceMove = 0;
      }
    } else if (mean < upMs) {
      if (++calm >= need && cool <= 0 && g.level > 0) { g.level--; moved = true; calm = 0; cool = hold; sinceUp = sinceMove = 0; }
    } else calm = 0;
    if (sinceMove > 90) need = upN0; // stable on this rung for a minute and a half: forget the penalty
    if (moved) { g.dpr = Math.max(dprMin, dprMax - step * Math.min(g.level, nDpr)); g.lite = g.level > nDpr; }
    return moved;
  }
  return g;
}

// ---------- post pass ----------
const POST_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const POST_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uTime;
uniform int uMode; // 2 = pixel, 3 = postcard

float bayer4( vec2 p ) {
  vec2 q = mod( floor( p ), 4.0 );
  int i = int( q.x ) + int( q.y ) * 4;
  int m[16] = int[16]( 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 );
  return ( float( m[i] ) + 0.5 ) / 16.0;
}
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

void main() {
  vec3 c = texture2D( tScene, vUv ).rgb;
  c = pow( max( c, 0.0 ), vec3( 1.0 / 2.2 ) ); // linear → display

  if ( uMode == 2 ) {
    // Retro: limited palette with ordered dithering on the low-res grid.
    float levels = 9.0;
    float d = bayer4( vUv * uRes ) - 0.5;
    c = floor( c * ( levels - 1.0 ) + 0.5 + d * 0.55 ) / ( levels - 1.0 );
    c = mix( c, c * vec3( 1.02, 1.0, 1.06 ), 0.5);
  } else if ( uMode == 3 ) {
    // Postcard: warm, slightly faded print with vignette and paper grain.
    float l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
    c = mix( vec3( l ), c, 1.35 );
    c = ( c - 0.5 ) * 1.12 + 0.5;
    c = c * vec3( 1.07, 1.0, 0.86 ) + vec3( 0.02, 0.012, 0.0 );
    c = mix( c, vec3( 1.0, 0.95, 0.85 ), 0.03 );
    vec2 v = vUv - 0.5;
    c *= 1.0 - 0.42 * pow( length( v * vec2( 1.0, 0.8 ) ) * 1.35, 2.6 );
    c += ( hash12( vUv * uRes + fract( uTime ) * 91.0 ) - 0.5 ) * 0.045;
  }
  gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
}
`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.mode = 'normal';
    this.lite = false;
    this.rt = null;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: SU.uTime,
        uMode: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
    this.size = new THREE.Vector2();
  }

  setMode(id) {
    this.mode = VISUAL_MODES.some((m) => m.id === id) ? id : 'normal';
    SU.uToon.value = this.mode === 'toon' ? 1 : 0;
    modeTail = this.mode === 'normal' || this.mode === 'toon' ? 1 : 0;
    this.applyFlags();
    this.mat.uniforms.uMode.value = this.mode === 'pixel' ? 2 : this.mode === 'postcard' ? 3 : 0;
    this.resize();
  }

  // Last rung of the quality ladder (see makeGovernor): drop the optional extras, keep the picture.
  setLite(on) {
    this.lite = !!on;
    this.applyFlags();
  }

  applyFlags() {
    const off = this.mode === 'pixel' || this.lite; // glitter and world-space streaks look wrong in the low-res pixel look
    SU.uSparkle.value = off ? 0 : 1;
    SU.uFx.value = off ? 0 : 1;
    SU.uAO.value = this.lite ? 0 : AO_STRENGTH;
    SU.uLite.value = this.lite ? 1 : 0;
    syncTail();
  }

  usesTarget() {
    return this.mode === 'pixel' || this.mode === 'postcard';
  }

  resize() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    SU.uView.value.copy(this.size);
    if (!this.usesTarget()) {
      SU.uSnap.value.set(0, 0);
      if (this.rt) { this.rt.dispose(); this.rt = null; }
      return;
    }
    let w = this.size.x, h = this.size.y;
    if (this.mode === 'pixel') {
      // ~200 px tall regardless of device resolution.
      const k = 200 / h;
      w = Math.max(64, Math.round(w * k));
      h = 200;
      SU.uSnap.value.set(w / 2, h / 2);
    } else {
      SU.uSnap.value.set(0, 0);
    }
    const filter = this.mode === 'pixel' ? THREE.NearestFilter : THREE.LinearFilter;
    if (!this.rt || this.rt.width !== w || this.rt.height !== h || this.rt.texture.magFilter !== filter) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { minFilter: filter, magFilter: filter, depthBuffer: true });
    }
    this.mat.uniforms.uRes.value.set(w, h);
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.usesTarget()) {
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    this.mat.uniforms.tScene.value = this.rt.texture;
    r.render(this.quadScene, this.quadCam);
  }
}
