// Static check (node, no GPU, no browser) of the GLSL this project injects into three.js materials.
// There is no shader compiler in node, so this assembles the real programs exactly as three would (ShaderLib source + our onBeforeCompile
// patch + resolved #includes) and checks what a typo would break: unresolved includes, unbalanced braces, duplicate uniforms / functions,
// names used but never declared, and that the display-space finish is attached exactly once, after the fog.
// It cannot type-check; the first real compile happens in the browser.
// Usage: node scripts/check-shaders.mjs
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(v) {} }) }) };
globalThis.window = { innerHeight: 800 };
const { patchMaterial, patchTail, GLSL } = await import('../src/shaders.js');
const { checkGlsl } = await import('./glsl-types.mjs');
const { Fx } = await import('../src/fx.js');
const { nearFade } = await import('../src/runner/nearfade.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };

const expand = (src) => {
  let guard = 0;
  while (/^[ \t]*#include <(\w+)>/m.test(src) && guard++ < 40) src = src.replace(/^[ \t]*#include <(\w+)>/gm, (_, n) => { const c = THREE.ShaderChunk[n]; if (c === undefined) throw new Error('unknown chunk ' + n); return c; });
  return src;
};
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

const TYPES = new Set('void bool int uint float vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 sampler2D sampler3D samplerCube sampler2DArray sampler2DShadow samplerCubeShadow sampler2DArrayShadow isampler2D usampler2D struct in out inout const uniform varying attribute highp mediump lowp precision flat smooth centroid layout'.split(' '));
const KEYWORDS = new Set('if else for while do break continue return discard true false'.split(' '));
const BUILTINS = new Set('radians degrees sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize reflect refract faceforward matrixCompMult transpose inverse determinant dFdx dFdy fwidth texture texture2D textureCube textureLod texelFetch textureSize lessThan greaterThan equal notEqual any all not isnan isinf round roundEven trunc modf floatBitsToInt intBitsToFloat outerProduct'.split(' '));
// provided by three's program prefix / by the GL itself, not by the shader text
const PREFIX = new Set('cameraPosition viewMatrix projectionMatrix modelMatrix modelViewMatrix normalMatrix isOrthographic position normal uv uv1 uv2 uv3 color pc_fragColor gl_FragCoord gl_FragColor gl_Position gl_PointSize gl_FrontFacing gl_FragDepth gl_PointCoord instanceMatrix instanceColor batchingMatrix morphTargetInfluences'.split(' '));

function analyse(name, rawSrc, { mine }) {
  const src = strip(expand(rawSrc));
  ok(!/#include/.test(src), `${name}: unresolved #include`);
  const code = src.replace(/^\s*#.*$/gm, ' ');
  let depth = 0, par = 0, bad = false;
  for (const ch of code) { if (ch === '{') depth++; else if (ch === '}') depth--; else if (ch === '(') par++; else if (ch === ')') par--; if (depth < 0 || par < 0) bad = true; }
  ok(!bad && depth === 0 && par === 0, `${name}: unbalanced braces/parens (${depth}/${par})`);
  ok((code.match(/\bvoid\s+main\s*\(/g) || []).length === 1, `${name}: exactly one main()`);
  // duplicate declarations of our names
  const decl = {};
  for (const m of code.matchAll(/\b(?:uniform|varying|attribute)\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/g)) decl[m[1]] = (decl[m[1]] || 0) + 1;
  for (const m of code.matchAll(/^\s*(?:vec[234]|float)\s+(cig\w+)\s*\(/gm)) decl[m[1]] = (decl[m[1]] || 0) + 1;
  for (const [k, n] of Object.entries(decl)) if (n > 1 && /^(u[A-Z]|v[A-Z]|cig|a[A-Z])/.test(k)) ok(false, `${name}: '${k}' declared ${n} times`);
  // used but never declared
  const toks = [...code.matchAll(/(\.\s*)?\b([A-Za-z_]\w*)\b(?!\s*\.\s*[A-Za-z_])?/g)];
  const declared = new Set();
  const defs = new Set([...src.matchAll(/^\s*#\s*define\s+(\w+)/gm)].map((m) => m[1]));
  const codeToks = [];
  for (const m of code.matchAll(/(\.\s*)?\b([A-Za-z_]\w*)\b/g)) codeToks.push({ id: m[2], field: !!m[1], i: m.index });
  for (let t = 1; t < codeToks.length; t++) {
    const prev = codeToks[t - 1];
    if (!codeToks[t].field && (TYPES.has(prev.id) || /^[A-Z]\w*$/.test(prev.id) && /\bstruct\s+$/.test(code.slice(Math.max(0, prev.i - 8), prev.i + prev.id.length + 1)))) declared.add(codeToks[t].id);
  }
  // extra declarators in one statement:  float a = 1.0, b = 2.0;   /   vec3 a, b;
  for (const m of code.matchAll(/\b(?:float|int|vec[234]|mat[234]|bool)\s+([^;(){}]*);/g)) for (const part of m[1].split(',')) { const id = part.trim().match(/^(\w+)/); if (id) declared.add(id[1]); }
  const unknown = new Set();
  for (const { id, field } of codeToks) {
    if (field || declared.has(id) || defs.has(id) || TYPES.has(id) || KEYWORDS.has(id) || BUILTINS.has(id) || PREFIX.has(id) || /^\d/.test(id)) continue;
    if (/^[A-Z][A-Z0-9_]+$/.test(id)) continue;       // macros / constants set by the program prefix (PI, RECIPROCAL_PI, ...)
    if (/^[xyzwrgbastpq]{1,4}$/.test(id)) continue;   // swizzle seen without its dot after a ')' or ']'
    unknown.add(id);
  }
  return { code, unknown, decl };
}

function mustBeKnown(name, res, allowed = []) {
  const extra = [...res.unknown].filter((k) => !allowed.includes(k));
  ok(extra.length === 0, `${name}: names used but never declared: ${extra.join(', ')}`);
}

// ---- baseline: the stock shaders, to learn what the prefix provides ----
const lamb = THREE.ShaderLib.lambert, basic = THREE.ShaderLib.basic;
const base = analyse('stock lambert fs', lamb.fragmentShader, { mine: false });
const baseBasic = analyse('stock basic fs', basic.fragmentShader, { mine: false });
const basePhong = analyse('stock phong fs', THREE.ShaderLib.phong.fragmentShader, { mine: false });
const stockUnknown = new Set([...base.unknown, ...baseBasic.unknown, ...basePhong.unknown]);

function compile(mat, type) {
  const lib = THREE.ShaderLib[type];
  const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  mat.onBeforeCompile(shader, null);
  return shader;
}
const finishAfterFog = (name, fs) => {
  const e = strip(expand(fs));
  const i = e.indexOf('gl_FragColor.rgb = cigFinish( gl_FragColor.rgb );'), f = e.indexOf('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );');
  ok(i > 0 && e.indexOf('gl_FragColor.rgb = cigFinish( gl_FragColor.rgb );', i + 1) === -1, `${name}: finish attached exactly once`);
  ok(f > 0 && i > f, `${name}: finish comes after the fog mix`);
};

for (const snow of [false, true]) {
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { snow });
  const sh = compile(mat, 'lambert');
  const r = analyse(`patched lambert (snow=${snow}) fs`, sh.fragmentShader, { mine: true });
  mustBeKnown(`patched lambert (snow=${snow})`, r, [...stockUnknown]);
  finishAfterFog(`patched lambert (snow=${snow})`, sh.fragmentShader);
  const v = analyse(`patched lambert (snow=${snow}) vs`, sh.vertexShader, { mine: true });
  ok(/vCigW/.test(v.code) && (v.decl.uSnap || 0) === 1, 'patched lambert vs: vCigW / uSnap declared once');
  for (const u of ['uTail', 'uGrade', 'uSh', 'uHi', 'uView', 'uBall', 'uAO', 'uRim', 'uToon', 'uTime', 'uSparkle']) ok(u in sh.uniforms, `patched lambert: uniform ${u} bound`);
}
{ // Phong costumes take the same patch
  const sh = compile(patchMaterial(new THREE.MeshPhongMaterial({ flatShading: true, shininess: 12 })), 'phong');
  mustBeKnown('patched phong', analyse('patched phong fs', sh.fragmentShader, { mine: true }), [...stockUnknown]);
  finishAfterFog('patched phong', sh.fragmentShader);
}
{ // chained with nearFade (the runner's decor / obstacles), in both orders
  for (const order of ['fade-first', 'patch-first']) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    if (order === 'fade-first') { nearFade(m); patchMaterial(m); } else { patchMaterial(m); nearFade(m); }
    const sh = compile(m, 'lambert');
    const r = analyse(`lambert + nearFade (${order}) fs`, sh.fragmentShader, { mine: true });
    mustBeKnown(`lambert + nearFade (${order})`, r, [...stockUnknown, 'vNearD']);
    finishAfterFog(`lambert + nearFade (${order})`, sh.fragmentShader);
  }
}
{ // unlit materials of the environment: sky, valley floor, glow decor
  const mat = patchTail(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  const sh = compile(mat, 'basic');
  const r = analyse('tail basic fs', sh.fragmentShader, { mine: true });
  mustBeKnown('tail basic', r, [...stockUnknown]);
  finishAfterFog('tail basic', sh.fragmentShader);
  const again = patchTail(mat);
  ok(again === mat, 'patchTail is idempotent');
  const n = compile(patchTail(nearFade(new THREE.MeshBasicMaterial({ vertexColors: true }))), 'basic');
  mustBeKnown('tail basic + nearFade', analyse('tail basic + nearFade fs', n.fragmentShader, { mine: true }), [...stockUnknown, 'vNearD']);
}
{ // the streak shader pair
  const fx = new Fx(new THREE.Scene(), { groundY: () => 0, rampAt: () => 0 }, new THREE.PerspectiveCamera());
  const m = fx.streaks.material;
  const v = analyse('streak vs', m.vertexShader, { mine: true });
  const f = analyse('streak fs', m.fragmentShader, { mine: true });
  mustBeKnown('streak vs', v, ['aCorner', 'aRnd']);
  mustBeKnown('streak fs', f, []);
  for (const u of ['uDir', 'uLen', 'uBox', 'uHalfW', 'uAspect', 'uK', 'uBall', 'uBallR']) ok(v.decl[u] === 1, `streak vs declares ${u}`);
  ok(f.decl.uTint === 1, 'streak fs declares uTint');
  const vv = new Set([...m.vertexShader.matchAll(/\bvarying\s+\w+\s+(\w+)/g)].map((x) => x[1])), fv = new Set([...m.fragmentShader.matchAll(/\bvarying\s+\w+\s+(\w+)/g)].map((x) => x[1]));
  ok([...fv].every((k) => vv.has(k)), 'every varying the fragment reads is written by the vertex shader');
  ok(Object.keys(m.uniforms).every((k) => v.decl[k] === 1 || f.decl[k] === 1), 'every JS uniform of the streak material is declared in a shader');
}

ok(checkGlsl('void main() { vec3 a = vec2( 1.0 ) * 2; }').length >= 2, 'the type checker must reject vec3 = vec2 and an int literal as float');
{ // types: scripts/glsl-types.mjs on our own snippets (what three supplies around them is declared by hand)
  const lit = { diffuseColor: 'vec4', outgoingLight: 'vec3', vViewPosition: 'vec3', normal: 'vec3', gl_FragCoord: 'vec4', gl_FragColor: 'vec4' };
  const lambert = GLSL.TAIL_PARS + GLSL.FRAG_PARS + 'void main() {' + GLSL.FRAG_MAIN + GLSL.TAIL_CALL + '}';
  for (const e of checkGlsl(lambert, lit)) ok(false, 'lit material snippets: ' + e);
  for (const e of checkGlsl(GLSL.TAIL_PARS + 'void main() {' + GLSL.TAIL_CALL + '}', lit)) ok(false, 'unlit tail snippet: ' + e);
  const fx = new Fx(new THREE.Scene(), { groundY: () => 0, rampAt: () => 0 }, new THREE.PerspectiveCamera());
  const m = fx.streaks.material;
  for (const e of checkGlsl(m.vertexShader, { position: 'vec3', cameraPosition: 'vec3', viewMatrix: 'mat4', projectionMatrix: 'mat4', gl_Position: 'vec4' })) ok(false, 'streak vertex shader: ' + e);
  for (const e of checkGlsl(m.fragmentShader, { gl_FragColor: 'vec4' })) ok(false, 'streak fragment shader: ' + e);
}

console.log(fails ? `${fails} check(s) failed` : 'shaders: all checks passed');
process.exit(fails ? 1 : 0);
