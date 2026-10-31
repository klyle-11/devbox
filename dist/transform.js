// What an entry typed into the console becomes before it runs (in the runner: runner.js), and whether it is finished.
//
// A console keeps what was defined: `const a = 1` in one entry, `a + 1` in the next. Code run by eval forgets its own
// `let`, `const` and `class` when it ends, so each top-level declaration is turned into an assignment to the session's
// scope (an object the runner holds, `__devbox`), and the entry is run inside `with (__devbox) { … }`, where those names
// are then found. Functions declared at the top are left as they are (they are hoisted in the block) and copied into the
// scope as the block starts. Nothing moves to another line, so an error's line is the line typed; only the first line's
// columns shift, by the length of what is put in front (`col`), and the runner takes that off again.
//
// Also:
//   - `export` in front of a declaration is dropped, `export default x` runs `x`, and `export { … }` is left out, so a
//     function copied from a module runs as it is;
//   - an `import` cannot be followed (the console has no files): it is left out and reported (`imports`), and a name it
//     would have brought in is then simply not defined;
//   - an entry with `await` at its top gets a second form, run as the body of an async function (`asyncJs`), used when
//     the first is refused for it; its last expression is what it returns;
//   - an entry that is one `{ … }` gets a form that reads it as an object (`objectJs`), as a browser's console does.
//
// Not kept: `const` stays assignable in later entries, and a name is readable (undefined) before its declaration runs.
// The rules are a scan of tokens, not a parser: a declaration is found where a statement can start at the top level.

const KEYWORDS_BEFORE_EXPR = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await', 'extends']);
const STATEMENT_WORDS = new Set(['if', 'for', 'while', 'do', 'switch', 'try', 'throw', 'return', 'break', 'continue', 'function', 'class', 'const', 'let', 'var',
  'import', 'export', 'else', 'catch', 'finally', 'debugger', 'with', 'case', 'default']);
const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const OPEN = { '(': ')', '[': ']', '{': '}' };

// The code as tokens: { t, v, s, e, d, nl }. t: 'n' name or word, 'p' punctuation, 's' string, 'q' template (a whole
// one, or its pieces around `${ }`), 'r' regex, 'u' number, 'c' comment. d is how deep in brackets the token is (an
// opening bracket counts at the depth outside it, a closing one too); nl, a line break between it and the one before.
// `open` is what was left open at the end, and `cut` says a string, template or comment was not finished.
export function tokens(code) {
  const out = [], stack = [];
  let i = 0, nl = false, cut = false, prev = null;
  const push = (t, v, s, e, d = stack.length) => { const tok = { t, v, s, e, d, nl }; out.push(tok); if (t !== 'c') prev = tok; nl = false; return tok; };
  const regexAllowed = () => !prev || (prev.t === 'p' && !')]}'.includes(prev.v)) || (prev.t === 'n' && KEYWORDS_BEFORE_EXPR.has(prev.v));
  // From inside a template (after ` or after the } of a ${ }) to its end or its next ${.
  const template = (s) => {
    while (i < code.length) {
      const c = code[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; push('q', code.slice(s, i), s, i); return; }
      if (c === '$' && code[i + 1] === '{') { i += 2; push('q', code.slice(s, i), s, i); stack.push('${'); return; }
      i++;
    }
    cut = true;
    push('q', code.slice(s), s, code.length);
  };
  while (i < code.length) {
    const c = code[i];
    if (c === '\n') { nl = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { i++; continue; }
    const s = i;
    if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; push('c', code.slice(s, i), s, i); continue; }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) { cut = true; i = code.length; } else i = end + 2;
      const text = code.slice(s, i);
      push('c', text, s, i);
      if (text.includes('\n')) nl = true;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < code.length && code[i] !== c && code[i] !== '\n') i += code[i] === '\\' ? 2 : 1;
      if (code[i] !== c) cut = true; else i++;
      push('s', code.slice(s, i), s, i);
      continue;
    }
    if (c === '`') { i++; template(s); continue; }
    if (c === '}' && stack[stack.length - 1] === '${') { stack.pop(); i++; template(s); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] || ''))) {
      i++;
      while (i < code.length && /[0-9a-zA-Z_.]/.test(code[i])) { if ((code[i] === 'e' || code[i] === 'E') && (code[i + 1] === '+' || code[i + 1] === '-')) i++; i++; }
      push('u', code.slice(s, i), s, i);
      continue;
    }
    if (/[A-Za-z_$#\u0080-￿\\]/.test(c)) {
      i++;
      while (i < code.length && /[\w$\u0080-￿\\]/.test(code[i])) i++;
      push('n', code.slice(s, i), s, i);
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, cls = false, ok = false;
      while (j < code.length && code[j] !== '\n') {
        const ch = code[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) { ok = true; break; }
        j++;
      }
      if (ok) {
        i = j + 1;
        while (i < code.length && /[a-z]/i.test(code[i])) i++;
        push('r', code.slice(s, i), s, i);
        continue;
      }
    }
    if (OPEN[c]) { push('p', c, s, i + 1); stack.push(c); i++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (stack.length && OPEN[stack[stack.length - 1]] === c) stack.pop();
      push('p', c, s, i + 1);
      i++;
      continue;
    }
    const p = PUNCT.find((x) => code.startsWith(x, i)) || c;
    i += p.length;
    push('p', p, s, i);
  }
  return { list: out, open: stack.length, cut };
}

// Whether the console should wait for more (Enter adds a line): a bracket, string, template or comment left open.
export function incomplete(code) {
  const { open, cut } = tokens(code);
  return open > 0 || cut;
}

const endsExpr = (t) => t && (t.t === 'n' || t.t === 'u' || t.t === 's' || t.t === 'r' || (t.t === 'q' && t.v.endsWith('`')) ||
  (t.t === 'p' && (t.v === ')' || t.v === ']' || t.v === '}' || t.v === '++' || t.v === '--')));
const startsStmt = (t) => t && (t.t === 'n' || t.t === 'u' || t.t === 's' || (t.t === 'p' && (t.v === '{' || t.v === '++' || t.v === '--' || t.v === '!' || t.v === '~' || t.v === ';')));

// Where top-level statements start: indexes into `list` (comments left out of it).
function statementStarts(list) {
  const starts = [];
  for (let k = 0; k < list.length; k++) {
    const t = list[k], p = list[k - 1];
    if (t.d !== 0) continue;
    if (!p) { starts.push(k); continue; }
    if (p.d === 0 && p.t === 'p' && (p.v === ';' || p.v === '}')) { starts.push(k); continue; }
    if (t.nl && endsExpr(p) && startsStmt(t) && !(t.t === 'n' && KEYWORDS_BEFORE_EXPR.has(t.v) && t.v !== 'await' && t.v !== 'new' && t.v !== 'typeof' && t.v !== 'void' && t.v !== 'delete')) starts.push(k);
  }
  return starts;
}

// The index of the bracket that closes the one at `k`.
function closer(list, k) {
  const d = list[k].d;
  for (let j = k + 1; j < list.length; j++) if (list[j].d === d && list[j].t === 'p' && (list[j].v === ')' || list[j].v === ']' || list[j].v === '}')) return j;
  return list.length - 1;
}

// Where the expression that starts at `k` ends (the index of its last token), at the depth `d`: before a `,` (when
// `comma`) or `;` at that depth, a closing bracket out of it, or a line break the language ends a statement at.
function exprEnd(list, k, d, comma) {
  let last = k - 1, open = 0;   // brackets opened within the expression (their closers are at `d` too)
  for (let j = k; j < list.length; j++) {
    const t = list[j];
    if (t.d === d && t.t === 'p' && (t.v === '(' || t.v === '[' || t.v === '{')) open++;
    else if (t.d === d && t.t === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) { if (!open) break; open--; }
    if (t.d < d) break;
    if (t.d === d && t.t === 'p' && (t.v === ';' || (comma && t.v === ','))) break;
    if (j > k && t.d === d && t.nl && endsExpr(list[j - 1]) && startsStmt(t) && !(t.t === 'n' && (t.v === 'in' || t.v === 'of' || t.v === 'instanceof'))) break;
    last = j;
  }
  return last;
}

// The names a binding brings in (a name, or a { } or [ ] pattern), and the index after it.
function binding(list, k, names) {
  const t = list[k];
  if (!t) return k;
  if (t.t === 'n') { names.push(t.v); return k + 1; }
  if (t.t !== 'p' || (t.v !== '{' && t.v !== '[')) return k + 1;
  const end = closer(list, k), d = t.d + 1, obj = t.v === '{';
  let j = k + 1;
  while (j < end) {
    if (list[j].t === 'p' && list[j].v === ',') { j++; continue; }
    if (list[j].t === 'p' && list[j].v === '...') { j = binding(list, j + 1, names); continue; }
    if (obj) {
      const key = list[j];
      if (key.t === 'p' && key.v === '[') j = closer(list, j) + 1; else j++;
      if (list[j]?.t === 'p' && list[j].v === ':') j = binding(list, j + 1, names);
      else if (key.t === 'n') names.push(key.v);
    } else j = binding(list, j, names);
    if (list[j]?.t === 'p' && list[j].v === '=') j = exprEnd(list, j + 1, d, true) + 1;
    while (j < end && !(list[j].d === d && list[j].t === 'p' && list[j].v === ',')) j++;
  }
  return end + 1;
}

const SCOPE = '__devbox';

// The entry made ready to run: { js, asyncJs, objectJs, col, asyncCol, objectCol, names: [{ name, kind }], last, imports }.
// `n` names the entry in errors' stacks (devbox-entry-<n>.js). `last` is 'decl' when the entry ends with a declaration
// (whose value a console shows as undefined), 'expr' when with an expression, else 'stmt'.
export function prepare(code, n = 1) {
  const all = tokens(code).list, list = all.filter((t) => t.t !== 'c');
  const starts = statementStarts(list), edits = [], names = [], imports = [], fnames = [];
  const blank = (s, e) => edits.push({ s, e, v: code.slice(s, e).replace(/[^\n]/g, ' ') });
  const insert = (at, v) => edits.push({ s: at, e: at, v });
  const kinds = new Map();   // the index of each statement's start -> what it is
  const name = (v, kind) => { if (!names.some((x) => x.name === v)) names.push({ name: v, kind }); };

  const declaration = (k) => {
    const t = list[k];
    if (!t) return false;
    const next = list[k + 1];
    if ((t.v === 'const' || t.v === 'var' || (t.v === 'let' && next && (next.t === 'n' || (next.t === 'p' && (next.v === '[' || next.v === '{'))))) && t.t === 'n') {
      const kind = t.v;
      edits.push({ s: t.s, e: t.e, v: ';' + ' '.repeat(t.v.length - 1) });
      let j = k + 1;
      for (;;) {
        const b = list[j];
        if (!b) break;
        const got = [];
        const after = binding(list, j, got);
        for (const x of got) name(x, kind);
        const pattern = b.t === 'p' && b.v === '{';
        let end = after - 1;
        if (list[after]?.t === 'p' && list[after].v === '=') end = exprEnd(list, after + 1, 0, true);
        else if (b.t === 'n' && kind !== 'var') insert(b.e, ' = void 0');
        if (pattern) { insert(b.s, '('); insert(list[end].e, ')'); }
        const sep = list[end + 1];
        if (sep && sep.d === 0 && sep.t === 'p' && sep.v === ',') { j = end + 2; continue; }
        break;
      }
      return 'decl';
    }
    if (t.t === 'n' && t.v === 'class' && next?.t === 'n' && next.v !== 'extends') {
      let j = k + 2;
      while (j < list.length && !(list[j].t === 'p' && list[j].v === '{' && list[j].d === 0)) j++;
      if (j >= list.length) return false;
      const end = closer(list, j);
      insert(t.s, next.v + ' = ');
      insert(list[end].e, ';');
      name(next.v, 'class');
      return 'decl';
    }
    const fn = t.t === 'n' && t.v === 'async' && next?.v === 'function' && !next.nl ? k + 1 : t.t === 'n' && t.v === 'function' ? k : -1;
    if (fn >= 0) {
      let j = fn + 1;
      if (list[j]?.t === 'p' && list[j].v === '*') j++;
      if (list[j]?.t === 'n') { name(list[j].v, 'function'); fnames.push(list[j].v); return 'decl'; }
    }
    return false;
  };

  for (const k of starts) {
    const t = list[k];
    let kind = 'stmt';
    if (t.t === 'n' && t.v === 'import' && !(list[k + 1]?.t === 'p' && (list[k + 1].v === '(' || list[k + 1].v === '.'))) {
      // Up to the module's name (the first string at the top after it), and a ; after that.
      let j = k + 1;
      while (j < list.length && !(list[j].t === 's' && list[j].d === 0)) j++;
      const src = list[j];
      let end = src ? src.e : list[list.length - 1].e;
      if (src && list[j + 1]?.t === 'p' && list[j + 1].v === ';') end = list[j + 1].e;
      imports.push({ from: src ? src.v.slice(1, -1) : '', text: code.slice(t.s, end) });
      blank(t.s, end);
      kind = 'decl';
    } else if (t.t === 'n' && t.v === 'export') {
      const next = list[k + 1];
      if (next?.t === 'n' && next.v === 'default') {
        blank(t.s, next.e);
        kind = declaration(k + 2) || 'expr';
      } else if (next?.t === 'p' && (next.v === '{' || next.v === '*')) {
        let j = next.v === '{' ? closer(list, k + 1) : k + 1;
        if (list[j + 1]?.t === 'n' && list[j + 1].v === 'from') j += 2;
        if (list[j + 1]?.t === 'p' && list[j + 1].v === ';') j++;
        blank(t.s, list[Math.min(j, list.length - 1)].e);
        kind = 'decl';
      } else {
        blank(t.s, t.e);
        kind = declaration(k + 1) || 'stmt';
      }
    } else if (t.t === 'p' && t.v === ';') kind = 'empty';
    else {
      const label = t.t === 'n' && list[k + 1]?.t === 'p' && list[k + 1].v === ':' && list[k + 1].d === 0;
      kind = declaration(k) || ((t.t === 'n' && STATEMENT_WORDS.has(t.v)) || (t.t === 'p' && t.v === '{') || label ? 'stmt' : 'expr');
    }
    kinds.set(k, kind);
  }

  // The last statement that is not empty.
  let lastStart = -1;
  for (let x = starts.length - 1; x >= 0; x--) if (kinds.get(starts[x]) !== 'empty') { lastStart = starts[x]; break; }
  const last = lastStart < 0 ? 'stmt' : kinds.get(lastStart);

  const body = apply(code, edits);
  const head = `with (${SCOPE}) { ` + fnames.map((f) => `${SCOPE}.${f} = ${f}; `).join('');
  const tail = `\n}\n//# sourceURL=devbox-entry-${n}.js`;
  const out = { js: head + body + tail, col: head.length, names, last, imports, asyncJs: null, asyncCol: 0, objectJs: null, objectCol: 0 };

  if (list.some((t) => t.t === 'n' && t.v === 'await')) {
    const aEdits = last === 'expr' ? [...edits, { s: list[lastStart].s, e: list[lastStart].s, v: 'return ' }] : edits;
    const aHead = `(async () => { with (${SCOPE}) { ` + fnames.map((f) => `${SCOPE}.${f} = ${f}; `).join('');
    out.asyncJs = aHead + apply(code, aEdits) + `\n} })()\n//# sourceURL=devbox-entry-${n}.js`;
    out.asyncCol = aHead.length;
  }
  if (list.length && list[0].t === 'p' && list[0].v === '{' && closer(list, 0) === list.length - 1 && !/;\s*$/.test(code)) {
    const oHead = `with (${SCOPE}) { (`;
    out.objectJs = oHead + code + `\n)}\n//# sourceURL=devbox-entry-${n}.js`;
    out.objectCol = oHead.length;
  }
  return out;
}

// The edits made to the text, from the end back so each one's place is still right. Two at one place go in the order
// they were made.
function apply(code, edits) {
  const order = edits.map((x, i) => [x, i]).sort(([a, i], [b, j]) => b.s - a.s || j - i);
  let out = code;
  for (const [x] of order) out = out.slice(0, x.s) + x.v + out.slice(x.e);
  return out;
}
