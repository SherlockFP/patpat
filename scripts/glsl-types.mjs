// A small GLSL ES 3.00 type checker for the subset of the language the project's own shader snippets use
// (float/int/bool, vec2-4, mat4*vec4, swizzles, constructors, the usual builtins, if/else, return, discard, user functions).
// There is no shader compiler in node; this exists to catch what a typo or a wrong mental model would break at the first real compile:
// undeclared names, vec2 * vec3, `float x = 1;` (ES 3.00 has no implicit int -> float), wrong argument counts or types for builtins.
// Not a compiler: anything outside the subset throws "unsupported" so it can never pass silently.
//
//   checkGlsl(source, env) -> string[] of problems
//   env: { 'name': 'type', ... } for names the source does not declare itself (builtin variables, main-scope locals of three's chunks, ...)

const GEN = ['float', 'vec2', 'vec3', 'vec4'];
const VEC = { vec2: 2, vec3: 3, vec4: 4 };
const TYPES = new Set(['void', 'bool', 'int', 'float', 'vec2', 'vec3', 'vec4', 'mat4']);
const isGen = (t) => GEN.includes(t);
const NUM = /^(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?/;

function tokenize(src) {
  const out = [];
  src = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ').replace(/^\s*#.*$/gm, ' ');
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = /^[A-Za-z_]\w*/.exec(rest))) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    if ((m = NUM.exec(rest)) && (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || '')))) {
      let v = m[0], f = /[.eE]/.test(v);
      if (/^[fF]/.test(src[i + v.length] || '')) { v += src[i + v.length]; f = true; }
      out.push({ t: f ? 'float' : 'int', v }); i += v.length; continue;
    }
    if ((m = /^(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||\+\+|--)/.exec(rest))) { out.push({ t: 'op', v: m[0] }); i += 2; continue; }
    out.push({ t: 'op', v: c }); i++;
  }
  return out;
}

export function checkGlsl(source, env = {}) {
  const toks = tokenize(source);
  const errs = [];
  const fns = Object.create(null);       // user functions: name -> [{ ret, params }]
  const scopes = [Object.assign(Object.create(null), env)];
  let p = 0;
  const err = (msg) => { errs.push(msg + `  (near token ${p}: ${toks.slice(Math.max(0, p - 4), p + 3).map((x) => x.v).join(' ')})`); };
  const peek = (k = 0) => toks[p + k] || { t: 'eof', v: '' };
  const eat = (v) => { if (peek().v === v) { p++; return true; } return false; };
  const need = (v) => { if (!eat(v)) { err(`expected '${v}'`); throw new Error('parse'); } };
  const look = (n) => { for (let i = scopes.length - 1; i >= 0; i--) if (n in scopes[i]) return scopes[i][n]; return undefined; };
  const declare = (n, t) => { scopes[scopes.length - 1][n] = t; };
  const unsupported = (w) => { err('unsupported: ' + w); throw new Error('parse'); };

  const sw = (field, base) => {
    const n = VEC[base];
    if (!n || !/^([xyzw]+|[rgba]+|[stpq]+)$/.test(field) || field.length > 4) { err(`bad swizzle .${field} on ${base}`); return 'float'; }
    const idx = 'xyzwrgbastpq';
    for (const ch of field) if (idx.indexOf(ch) % 4 >= n) err(`swizzle .${field} out of range for ${base}`);
    return field.length === 1 ? 'float' : 'vec' + field.length;
  };

  function arith(op, a, b) {
    if (a === b && (a === 'float' || a === 'int' || VEC[a])) return a;
    if (a === 'float' && VEC[b]) return b;
    if (b === 'float' && VEC[a]) return a;
    if (op === '*' && a === 'mat4' && b === 'vec4') return 'vec4';
    err(`operator ${op} on ${a} and ${b}`);
    return 'float';
  }

  function builtin(name, a) {
    const n = a.length, g = a[0];
    const same = (k) => { for (let i = 0; i < k; i++) if (a[i] !== g) return false; return true; };
    const bad = () => { err(`${name}(${a.join(', ')}) matches no overload`); return isGen(g) ? g : 'float'; };
    switch (name) {
      case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'exp': case 'log': case 'exp2': case 'log2': case 'sqrt': case 'abs':
      case 'sign': case 'floor': case 'ceil': case 'fract': case 'radians': case 'degrees': case 'inversesqrt': case 'normalize':
        return n === 1 && isGen(g) ? g : bad();
      case 'atan': return (n === 1 || (n === 2 && same(2))) && isGen(g) ? g : bad();
      case 'pow': return n === 2 && isGen(g) && same(2) ? g : bad();
      case 'min': case 'max': case 'mod': return n === 2 && isGen(g) && (a[1] === g || a[1] === 'float') ? g : bad();
      case 'clamp': return n === 3 && isGen(g) && ((a[1] === g && a[2] === g) || (a[1] === 'float' && a[2] === 'float')) ? g : bad();
      case 'mix': return n === 3 && isGen(g) && a[1] === g && (a[2] === g || a[2] === 'float') ? g : bad();
      case 'step': return n === 2 && isGen(a[1]) && (a[0] === a[1] || a[0] === 'float') ? a[1] : bad();
      case 'smoothstep': return n === 3 && isGen(a[2]) && (a[0] === a[2] && a[1] === a[2] || a[0] === 'float' && a[1] === 'float') ? a[2] : bad();
      case 'length': return n === 1 && isGen(g) ? 'float' : bad();
      case 'distance': case 'dot': return n === 2 && isGen(g) && same(2) ? 'float' : bad();
      case 'cross': return n === 2 && g === 'vec3' && a[1] === 'vec3' ? 'vec3' : bad();
      default: return undefined;
    }
  }

  function construct(t, a) {
    if (t === 'float') { if (a.length === 1 && (a[0] === 'float' || a[0] === 'int')) return t; err('float(' + a.join(', ') + ')'); return t; }
    const n = VEC[t];
    if (!n) { err('cannot construct ' + t); return t; }
    if (a.length === 1 && a[0] === 'float') return t;
    let c = 0;
    for (const x of a) { if (x === 'float' || x === 'int' || x === 'bool') c += 1; else if (VEC[x]) c += VEC[x]; else err(`${t}() argument of type ${x}`); }
    if (c !== n) err(`${t}(${a.join(', ')}) has ${c} components, needs ${n}`);
    return t;
  }

  function primary() {
    const t = peek();
    if (t.t === 'float') { p++; return 'float'; }
    if (t.t === 'int') { p++; return 'int'; }
    if (t.v === '(') { p++; const ty = expr(); need(')'); return ty; }
    if (t.t === 'id') {
      p++;
      if (t.v === 'true' || t.v === 'false') return 'bool';
      if (peek().v === '(') {
        p++;
        const args = [];
        if (!eat(')')) { do { args.push(expr()); } while (eat(',')); need(')'); }
        if (TYPES.has(t.v)) return construct(t.v, args);
        const ov = fns[t.v];
        if (ov) {
          const hit = ov.find((f) => f.params.length === args.length && f.params.every((x, i) => x === args[i]));
          if (!hit) err(`${t.v}(${args.join(', ')}) matches no declaration`);
          return (hit || ov[0]).ret;
        }
        const r = builtin(t.v, args);
        if (r === undefined) { err('unknown function ' + t.v); return 'float'; }
        return r;
      }
      const ty = look(t.v);
      if (ty === undefined) { err('undeclared ' + t.v); return 'float'; }
      return ty;
    }
    unsupported('token ' + t.v);
  }

  function postfix() {
    let ty = primary();
    for (;;) {
      if (peek().v === '.' && peek(1).t === 'id') { p++; ty = sw(toks[p++].v, ty); } else break;
    }
    return ty;
  }
  function unary() {
    if (peek().v === '-' || peek().v === '+') { p++; const t = unary(); if (!(t === 'float' || t === 'int' || VEC[t])) err('unary - on ' + t); return t; }
    if (peek().v === '!') { p++; const t = unary(); if (t !== 'bool') err('! on ' + t); return 'bool'; }
    return postfix();
  }
  function bin(next, ops, kind) {
    let a = next();
    while (ops.includes(peek().v)) {
      const op = toks[p++].v, b = next();
      if (kind === 'arith') a = arith(op, a, b);
      else if (kind === 'rel') { if (!((a === 'float' && b === 'float') || (a === 'int' && b === 'int'))) err(`${a} ${op} ${b}`); a = 'bool'; }
      else if (kind === 'eq') { if (a !== b) err(`${a} ${op} ${b}`); a = 'bool'; }
      else { if (a !== 'bool' || b !== 'bool') err(`${a} ${op} ${b}`); a = 'bool'; }
    }
    return a;
  }
  const mul = () => bin(unary, ['*', '/'], 'arith');
  const add = () => bin(mul, ['+', '-'], 'arith');
  const rel = () => bin(add, ['<', '>', '<=', '>='], 'rel');
  const eq = () => bin(rel, ['==', '!='], 'eq');
  const land = () => bin(eq, ['&&'], 'logic');
  const lor = () => bin(land, ['||'], 'logic');
  function expr() {
    const c = lor();
    if (eat('?')) {
      if (c !== 'bool') err('?: condition is ' + c);
      const a = expr(); need(':'); const b = expr();
      if (a !== b) err(`?: branches ${a} / ${b}`);
      return a;
    }
    return c;
  }

  function lvalue() {
    const t = peek();
    if (t.t !== 'id') unsupported('lvalue');
    p++;
    let ty = look(t.v);
    if (ty === undefined) { err('undeclared ' + t.v); ty = 'float'; }
    while (peek().v === '.' && peek(1).t === 'id') { p++; ty = sw(toks[p++].v, ty); }
    return ty;
  }

  function statement() {
    const t = peek();
    if (t.v === '{') { p++; scopes.push(Object.create(null)); while (peek().v !== '}' && peek().t !== 'eof') statement(); need('}'); scopes.pop(); return; }
    if (t.v === ';') { p++; return; }
    if (t.v === 'if') {
      p++; need('('); const c = expr(); need(')');
      if (c !== 'bool') err('if condition is ' + c);
      statement();
      if (eat('else')) statement();
      return;
    }
    if (t.v === 'return') { p++; if (!eat(';')) { const ty = expr(); need(';'); if (cur && ty !== cur) err(`return ${ty} from a ${cur} function`); } return; }
    if (t.v === 'discard') { p++; need(';'); return; }
    if (t.v === 'for' || t.v === 'while' || t.v === 'do' || t.v === 'switch') unsupported(t.v);
    if (TYPES.has(t.v) && peek(1).t === 'id' && peek(2).v !== '(') {          // local declaration(s)
      p++;
      do {
        const name = toks[p++].v;
        if (peek().v === '[') unsupported('array');
        let init = null;
        if (eat('=')) init = expr();
        if (init && init !== t.v) err(`${t.v} ${name} = ${init}`);
        declare(name, t.v);
      } while (eat(','));
      need(';');
      return;
    }
    // assignment or call
    const save = p;
    if (t.t === 'id' && !TYPES.has(t.v) && peek(1).v !== '(') {
      const lt = lvalue();
      const op = peek().v;
      if (['=', '+=', '-=', '*=', '/='].includes(op)) {
        p++;
        const rt = expr();
        const res = op === '=' ? rt : arith(op[0], lt, rt);
        if (res !== lt) err(`assigning ${res} to ${lt}`);
        need(';');
        return;
      }
      p = save;
    }
    expr(); need(';');
  }

  let cur = null;
  function topLevel() {
    const t = peek();
    if (t.v === 'precision') { while (peek().v !== ';') p++; p++; return; }
    let q = 0;
    while (['uniform', 'varying', 'attribute', 'const', 'highp', 'mediump', 'lowp', 'in', 'out'].includes(peek(q).v)) q++;
    const ty = peek(q), nm = peek(q + 1);
    if (!(ty.t === 'id' && TYPES.has(ty.v) && nm.t === 'id')) unsupported('top-level ' + t.v);
    p += q + 2;
    if (peek().v === '(') {                                                    // function
      p++;
      const params = [], names = [];
      if (!eat(')')) { do { const pt = toks[p++].v; const pn = toks[p++].v; params.push(pt); names.push(pn); } while (eat(',')); need(')'); }
      (fns[nm.v] = fns[nm.v] || []).push({ ret: ty.v, params });
      if (eat(';')) return;
      scopes.push(Object.create(null));
      names.forEach((n, i) => declare(n, params[i]));
      cur = ty.v;
      need('{');
      while (peek().v !== '}' && peek().t !== 'eof') statement();
      need('}');
      cur = null;
      scopes.pop();
      return;
    }
    if (peek().v === '[') unsupported('array');
    if (eat('=')) expr();
    declare(nm.v, ty.v);
    need(';');
  }

  try { while (peek().t !== 'eof') topLevel(); } catch (e) { if (e.message !== 'parse') throw e; }
  return errs;
}
