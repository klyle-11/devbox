// Devbox's runner for JavaScript (and TypeScript, its types already taken out by the page): one worker per session, so
// what an entry defines is there for the next. The page (console.js) prepares each entry (transform.js), sends it here,
// and ends this worker when an entry runs past its time; it then starts another and runs the entries that succeeded
// again, quietly, so the session is as it was.
//
// What crosses back is never the values themselves but descriptions of them (API.md, "Values"): a type, a one-line
// preview made here as text, and for anything with parts a handle, by which the page asks for those parts when they are
// opened (`expand`), a page at a time. The handles are held here, at most MAX_HANDLES, the least recently used let go.
//
// The hub sends this file with `default-src 'none'; script-src 'unsafe-eval'` (eval runs the entries, and nothing can be
// fetched, imported or connected to). What that policy does not cover, the reader's storage (IndexedDB, the Cache API)
// and this worker's ways out, is taken from the prototypes before anything runs; once deleted there, code here cannot
// find them again.
//
// All of it is inside one function, so none of its own names can be reached (or clobbered) from what is typed: an
// entry sees the worker's globals, the session's scope, and nothing of this file.
(() => {
'use strict';
const post = self.postMessage.bind(self), listen = self.addEventListener.bind(self);
const realConsole = self.console;
for (const proto of [self, Object.getPrototypeOf(self), typeof WorkerGlobalScope !== 'undefined' ? WorkerGlobalScope.prototype : null].filter(Boolean)) {
  for (const name of ['indexedDB', 'caches', 'fetch', 'importScripts', 'Worker', 'SharedWorker', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource',
    'BroadcastChannel', 'cookieStore', 'postMessage', 'onmessage', 'onmessageerror', 'name', 'location']) {
    try { delete proto[name]; } catch {}
  }
}
for (const [owner, name] of [['WorkerNavigator', 'storage'], ['WorkerNavigator', 'serviceWorker'], ['WorkerNavigator', 'locks'], ['WorkerNavigator', 'storageBuckets']]) {
  try { delete self[owner].prototype[name]; } catch {}
}
try { delete Object.getPrototypeOf(navigator).storage; } catch {}

const MAX_HANDLES = 10000, MAX_STRING = 10000, MAX_LOGS = 1000, MAX_VARS = 500, PAGE = 100;

// The session's scope: what top-level declarations define (transform.js turns them into assignments to it).
const scope = Object.create(null);
Object.defineProperty(self, '__devbox', { value: scope, writable: false, enumerable: false, configurable: false });
const kinds = new Map();   // name -> 'const' | 'let' | 'var' | 'class' | 'function'
const baseline = new Set(Object.getOwnPropertyNames(self));   // the worker's own globals: not the user's

// ---- handles ----
const held = new Map(), ids = new WeakMap();
let nextId = 1;
function handle(v) {
  let id = ids.get(v);
  if (id && held.has(id)) { held.delete(id); held.set(id, v); return id; }
  id = nextId++;
  ids.set(v, id);
  held.set(id, v);
  if (held.size > MAX_HANDLES) held.delete(held.keys().next().value);
  return id;
}

// Promises' states, known from when they were first seen (a promise cannot be asked).
const states = new WeakMap();
function watch(p) {
  if (states.has(p)) return;
  const s = { state: 'pending' };
  states.set(p, s);
  try { Promise.prototype.then.call(p, (v) => { s.state = 'fulfilled'; s.value = v; }, (e) => { s.state = 'rejected'; s.value = e; }); } catch {}
}

// ---- describing values ----
const toStr = Object.prototype.toString;
const tag = (v) => { try { return toStr.call(v).slice(8, -1); } catch { return 'Object'; } };
function className(v) {
  try {
    const proto = Object.getPrototypeOf(v);
    if (proto === null) return 'Object';   // made with Object.create(null): shown as an object
    const c = proto && Object.prototype.hasOwnProperty.call(proto, 'constructor') ? proto.constructor : null;
    if (typeof c === 'function' && c.name) return c.name;
  } catch {}
  return tag(v);
}
const isTyped = (v) => ArrayBuffer.isView(v) && !(v instanceof DataView);
function fnText(f) {
  let src = '';
  try { src = Function.prototype.toString.call(f); } catch {}
  if (/^class[\s{]/.test(src)) return `class ${f.name || '(anonymous)'}`;
  const params = (src.match(/^[^(]*\(([^)]*)\)/) || src.match(/^(?:async\s+)?([\w$]+)\s*=>/) || [])[1];
  const lead = /^async/.test(src) ? 'async ƒ ' : /^function\s*\*|^async\s+function\s*\*/.test(src) ? 'ƒ* ' : 'ƒ ';
  return `${lead}${f.name || ''}(${(params ?? '').replace(/\s+/g, ' ').trim()})`;
}
function quote(s) { return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"; }
function cut(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

// A short preview of a value inside another's preview.
function small(v) {
  if (typeof v === 'string') return quote(cut(v, 40));
  if (typeof v === 'bigint') return v + 'n';
  if (typeof v === 'symbol') return v.toString();
  if (v === null || typeof v !== 'object' && typeof v !== 'function') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'function') return /^class/.test(fnText(v)) ? fnText(v) : 'ƒ';
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (isTyped(v)) return `${className(v)}(${v.length})`;
  if (v instanceof Map) return `Map(${v.size})`;
  if (v instanceof Set) return `Set(${v.size})`;
  if (v instanceof Date) return dateText(v);
  if (v instanceof RegExp) return String(v);
  if (v instanceof Error) return v.name || 'Error';
  const c = className(v);
  return c === 'Object' ? '{…}' : c;
}
const dateText = (d) => { try { return isNaN(d) ? 'Invalid Date' : d.toISOString(); } catch { return 'Date'; } };
function ownKeys(v) { try { return Reflect.ownKeys(v); } catch { return []; } }
function propPreview(v, max) {
  const out = [];
  let more = false;
  for (const k of ownKeys(v)) {
    let d;
    try { d = Object.getOwnPropertyDescriptor(v, k); } catch { continue; }
    if (!d || !d.enumerable) continue;
    if (out.length >= max) { more = true; break; }
    const key = typeof k === 'symbol' ? `[${k.toString()}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k);
    out.push(`${key}: ${'value' in d ? small(d.value) : '(…)'}`);
  }
  return out.join(', ') + (more ? ', …' : '');
}

// The description of a value (API.md, "Values").
function describe(v) {
  try { return describeIn(v); } catch (e) { return { t: 'object', p: '[could not be shown: ' + String(e && e.message || e) + ']' }; }
}
function describeIn(v) {
  switch (typeof v) {
    case 'undefined': return { t: 'undefined', p: 'undefined' };
    case 'boolean': return { t: 'boolean', p: String(v) };
    case 'number': return { t: 'number', p: Object.is(v, -0) ? '-0' : String(v) };
    case 'bigint': return { t: 'bigint', p: v + 'n' };
    case 'symbol': return { t: 'symbol', p: v.toString() };
    case 'string': return v.length > MAX_STRING ? { t: 'string', s: v.slice(0, MAX_STRING), n: v.length } : { t: 'string', s: v };
    case 'function': return { t: 'function', p: fnText(v), c: /^class /.test(fnText(v)) ? 'class' : 'Function', h: handle(v) };
  }
  if (v === null) return { t: 'null', p: 'null' };
  if (Array.isArray(v)) {
    const items = [];
    for (let i = 0; i < Math.min(v.length, 10); i++) items.push(i in v ? small(v[i]) : 'empty');
    return { t: 'array', c: className(v), n: v.length, p: `(${v.length}) [${items.join(', ')}${v.length > 10 ? ', …' : ''}]`, h: handle(v) };
  }
  if (isTyped(v)) {
    const items = Array.from(v.subarray(0, 10), small);
    return { t: 'array', c: className(v), n: v.length, p: `${className(v)}(${v.length}) [${items.join(', ')}${v.length > 10 ? ', …' : ''}]`, h: handle(v) };
  }
  if (v instanceof Map) {
    const items = [];
    for (const [k, x] of v) { if (items.length >= 5) { items.push('…'); break; } items.push(`${small(k)} => ${small(x)}`); }
    return { t: 'map', c: className(v), n: v.size, p: `Map(${v.size}) {${items.join(', ')}}`, h: handle(v) };
  }
  if (v instanceof Set) {
    const items = [];
    for (const x of v) { if (items.length >= 10) { items.push('…'); break; } items.push(small(x)); }
    return { t: 'set', c: className(v), n: v.size, p: `Set(${v.size}) {${items.join(', ')}}`, h: handle(v) };
  }
  if (v instanceof Date) return { t: 'date', p: dateText(v), h: handle(v) };
  if (v instanceof RegExp) return { t: 'regexp', p: String(v), h: handle(v) };
  if (v instanceof Error) return { t: 'error', c: v.name || 'Error', p: `${v.name || 'Error'}: ${v.message}`, at: where(v), h: handle(v) };
  if (v instanceof Promise) {
    watch(v);
    const s = states.get(v);
    return { t: 'promise', c: 'Promise', p: s.state === 'pending' ? 'Promise {<pending>}' : `Promise {<${s.state}>: ${small(s.value)}}`, state: s.state, h: handle(v) };
  }
  const c = className(v), inner = propPreview(v, 5);
  return { t: 'object', c, p: (c === 'Object' ? '' : c + ' ') + `{${inner}}`, h: handle(v) };
}

// Where an error was thrown in what was typed: [{ entry, line, col, fn }], from its stack (each entry is named
// devbox-entry-<n>.js by transform.js). Line 1's columns are given back as typed (`cols`: what was put in front).
const cols = new Map();
function where(e) {
  let stack = '';
  try { stack = String(e.stack || ''); } catch {}
  const out = [];
  for (const line of stack.split('\n')) {
    const m = line.match(/devbox-entry-(\d+)\.js:(\d+):(\d+)/);
    if (!m) continue;
    const entry = +m[1], ln = +m[2];
    let col = +m[3];
    if (ln === 1) col = Math.max(1, col - (cols.get(entry) || 0));
    const fn = (line.match(/^\s*at (?:async )?([^\s(]+) \(/) || line.match(/^([^@\s]+)@/) || [])[1];
    out.push({ entry, line: ln, col, fn: fn && fn !== 'eval' && !/^devbox-entry/.test(fn) ? fn : '' });
    if (out.length >= 10) break;
  }
  return out;
}

// ---- a value's parts ----
function entriesOf(v, from, count, recv) {
  const out = [];
  let total = 0;
  const own = (o, keys) => {
    for (const k of keys) {
      let d;
      try { d = Object.getOwnPropertyDescriptor(o, k); } catch { continue; }
      if (!d) continue;
      const key = typeof k === 'symbol' ? `[${k.toString()}]` : k;
      if ('value' in d) out.push({ k: key, v: describe(d.value), dim: !d.enumerable || undefined });
      else out.push({ k: key, get: d.get ? true : undefined, set: d.set && !d.get ? true : undefined, recv: handle(recv), dim: !d.enumerable || undefined });
    }
  };
  const proto = () => {
    let p = null;
    try { p = Object.getPrototypeOf(v); } catch {}
    if (p !== null) out.push({ k: '[[Prototype]]', v: { ...describe(p), recv: handle(recv) }, dim: true, inner: true });
  };
  if (Array.isArray(v) || isTyped(v)) {
    total = v.length;
    for (let i = from; i < Math.min(v.length, from + count); i++) out.push(i in v ? { k: String(i), v: describe(v[i]) } : { k: String(i), v: { t: 'empty', p: 'empty' } });
    if (from + count >= v.length) {
      own(v, ownKeys(v).filter((k) => typeof k === 'symbol' || !/^\d+$/.test(k)).filter((k) => !isTyped(v) || k !== 'length'));
      if (isTyped(v)) out.push({ k: 'length', v: describe(v.length), dim: true });
      proto();
    }
    return { entries: out, total, from, more: from + count < v.length };
  }
  if (v instanceof Map || v instanceof Set) {
    total = v.size;
    let i = 0;
    for (const item of v) {
      if (i >= from + count) break;
      if (i >= from) {
        if (v instanceof Map) out.push({ k: String(i), kd: describe(item[0]), v: describe(item[1]), map: true });
        else out.push({ k: String(i), v: describe(item) });
      }
      i++;
    }
    if (from + count >= v.size) { out.push({ k: 'size', v: describe(v.size), dim: true }); own(v, ownKeys(v)); proto(); }
    return { entries: out, total, from, more: from + count < v.size };
  }
  if (v instanceof Promise && from === 0) {
    const s = states.get(v) || { state: 'pending' };
    out.push({ k: '[[PromiseState]]', v: { t: 'string', s: s.state }, inner: true });
    if (s.state !== 'pending') out.push({ k: '[[PromiseResult]]', v: describe(s.value), inner: true });
  }
  if (typeof v === 'function' && from === 0) {
    let src = '';
    try { src = Function.prototype.toString.call(v); } catch {}
    if (src) out.push({ k: '[[Source]]', v: describe(src.length > 4000 ? src.slice(0, 4000) + '\n…' : src), inner: true });
  }
  const keys = ownKeys(v);
  total = keys.length;
  own(v, keys.slice(from, from + count));
  const more = from + count < keys.length;
  if (!more) proto();
  return { entries: out, total, from, more };
}

// A table of an array (or object) of records: a row for each item, a column for each key the items have (at most 20).
function tableOf(v) {
  const rows = [], columns = [], seen = new Set();
  const items = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : v instanceof Map ? [...v].map(([k, x]) => [small(k), x]) : Object.entries(v);
  let values = false;
  for (const [k, x] of items.slice(0, 100)) {
    const cells = {};
    if (x !== null && typeof x === 'object') {
      for (const c of Object.keys(x)) {
        if (!seen.has(c) && columns.length < 20) { seen.add(c); columns.push(c); }
        if (seen.has(c)) cells[c] = describe(x[c]);
      }
    } else { values = true; cells['\u0000'] = describe(x); }
    rows.push({ k, cells });
  }
  if (values) columns.push('\u0000');
  return { columns: columns.map((c) => (c === '\u0000' ? { k: 'Value', value: true } : { k: c })), rows: rows.map((r) => ({ k: r.k, cells: columns.map((c) => r.cells[c] || null) })), more: items.length > 100, total: items.length };
}

// ---- the console the entries see ----
let current = 0, logs = 0, quiet = false;
const counts = new Map(), timers = new Map();
let depth = 0;
function emit(level, args, extra) {
  if (quiet) return;
  if (++logs > MAX_LOGS) { if (logs === MAX_LOGS + 1) post({ type: 'log', entry: current, level: 'warn', args: [{ t: 'string', s: `More than ${MAX_LOGS} lines: the rest of this entry's are not shown.` }], depth: 0 }); return; }
  let at = [];
  try { at = where(new Error()); } catch {}
  post({ type: 'log', entry: current, level, args: args.map(describe), line: at[0]?.line, depth, ...extra });
}
// printf-like: %s %d %i %f %o %O %c in a first argument that is a string.
function format(args) {
  if (typeof args[0] !== 'string' || !args[0].includes('%')) return args;
  const rest = args.slice(1);
  let used = 0;
  const text = args[0].replace(/%([sdifoOc%])/g, (m, f) => {
    if (f === '%') return '%';
    if (used >= rest.length) return m;
    const x = rest[used++];
    if (f === 's') return typeof x === 'string' ? x : small(x);
    if (f === 'd' || f === 'i') return String(parseInt(x, 10));
    if (f === 'f') return String(parseFloat(x));
    if (f === 'c') return '';
    return small(x);
  });
  return [text, ...rest.slice(used)];
}
const fakeConsole = {
  log: (...a) => emit('log', format(a)), info: (...a) => emit('info', format(a)), debug: (...a) => emit('debug', format(a)),
  warn: (...a) => emit('warn', format(a)), error: (...a) => emit('error', format(a)), trace: (...a) => emit('log', format(a)),
  dir: (x) => emit('log', [x]), dirxml: (x) => emit('log', [x]),
  table: (x) => { if (x !== null && typeof x === 'object') { let t = null; try { t = tableOf(x); } catch {} emit('log', [x], t ? { table: t } : undefined); } else emit('log', [x]); },
  assert: (ok, ...a) => { if (!ok) emit('error', ['Assertion failed' + (a.length ? ':' : ''), ...format(a)]); },
  count: (l = 'default') => { const n = (counts.get(l) || 0) + 1; counts.set(l, n); emit('log', [`${l}: ${n}`]); },
  countReset: (l = 'default') => counts.delete(l),
  time: (l = 'default') => timers.set(l, performance.now()),
  timeLog: (l = 'default', ...a) => emit('log', [`${l}: ${(performance.now() - (timers.get(l) ?? performance.now())).toFixed(3)} ms`, ...a]),
  timeEnd: (l = 'default') => { emit('log', [`${l}: ${(performance.now() - (timers.get(l) ?? performance.now())).toFixed(3)} ms`]); timers.delete(l); },
  group: (...a) => { if (a.length) emit('log', format(a), { group: true }); depth++; }, groupCollapsed: (...a) => { if (a.length) emit('log', format(a), { group: true }); depth++; },
  groupEnd: () => { depth = Math.max(0, depth - 1); },
  clear: () => post({ type: 'clear' }),
};
Object.defineProperty(self, 'console', { value: fakeConsole, writable: true, configurable: true, enumerable: false });
void realConsole;

// What was thrown and not caught by an entry's own code later (in a timer, a promise nobody waited for).
listen('error', (e) => { e.preventDefault(); emit('error', ['Uncaught', e.error ?? e.message], { late: true }); });
listen('unhandledrejection', (e) => { e.preventDefault(); emit('error', ['Uncaught (in promise)', e.reason], { late: true }); });

// ---- the session's variables ----
function vars() {
  const out = [];
  for (const name of Object.keys(scope)) {
    if (out.length >= MAX_VARS) break;
    out.push({ name, kind: kinds.get(name) || 'let', v: describe(scope[name]) });
  }
  // Globals the entries made without declaring them (x = 1), or with var inside a block.
  for (const name of Object.getOwnPropertyNames(self)) {
    if (out.length >= MAX_VARS) break;
    if (baseline.has(name) || name in scope) continue;
    let v;
    try { v = self[name]; } catch { continue; }
    out.push({ name, kind: 'global', v: describe(v) });
  }
  return out;
}

const evaluate = (0, eval);
async function run({ entry, js, asyncJs, objectJs, col, asyncCol, objectCol, names, last, silent }) {
  current = entry;
  logs = 0;
  depth = 0;
  quiet = !!silent;
  for (const { name, kind } of names) {
    if (!(name in scope)) scope[name] = undefined;
    kinds.set(name, kind);
  }
  const started = performance.now();
  let value, form = 'plain';
  const tryEval = (code, c) => { cols.set(entry, c); if (cols.size > 5000) cols.delete(cols.keys().next().value); return evaluate(code); };
  try {
    try {
      if (objectJs) { try { value = tryEval(objectJs, objectCol); form = 'object'; } catch (e) { if (!(e instanceof SyntaxError)) throw e; value = tryEval(js, col); form = 'plain'; } }
      else value = tryEval(js, col);
    } catch (e) {
      if (!(e instanceof SyntaxError) || !asyncJs || !/await/.test(String(e.message))) throw e;
      value = await tryEval(asyncJs, asyncCol);
      form = 'async';
    }
    // A function declared at the top was also made a global by eval: the scope's copy is the one kept.
    for (const { name, kind } of names) if (kind === 'function' && Object.prototype.hasOwnProperty.call(self, name) && !baseline.has(name)) { try { delete self[name]; } catch {} }
    if (form !== 'async' && last === 'decl') value = undefined;
    if (value instanceof Promise) { watch(value); try { await value; } catch {} }
    quiet = false;
    return { ok: true, value: describe(value), ms: performance.now() - started, vars: vars(), form };
  } catch (e) {
    quiet = false;
    const d = describe(e);
    if (!(e instanceof Error)) d.thrown = true;
    return { ok: false, error: d, syntax: e instanceof SyntaxError || undefined, ms: performance.now() - started, vars: vars() };
  }
}

listen('message', async (e) => {
  const m = e.data || {};
  let out;
  try {
    if (m.op === 'run') out = await run(m);
    else if (m.op === 'expand') { const v = held.get(m.h); out = v === undefined && !held.has(m.h) ? { gone: true } : entriesOf(v, m.from || 0, Math.min(m.count || PAGE, 500), m.recv ? held.get(m.recv) ?? v : v); }
    else if (m.op === 'get') {
      const holder = held.get(m.h), recv = m.recv ? held.get(m.recv) : holder;
      try { out = { ok: true, value: describe(Reflect.get(holder, m.key, recv)) }; } catch (err) { out = { ok: false, error: describe(err) }; }
    } else if (m.op === 'table') { const v = held.get(m.h); out = v && typeof v === 'object' ? tableOf(v) : { gone: true }; }
    else if (m.op === 'vars') out = { vars: vars() };
    else out = { error: { t: 'string', s: 'unknown request' } };
  } catch (err) { out = { ok: false, error: describe(err) }; }
  post({ type: 'reply', id: m.id, ...out });
});
post({ type: 'ready' });
})();
