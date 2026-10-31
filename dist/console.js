// Devbox's console: small programs typed and run as in a browser's console, a session for each language, what each
// entry defines kept for the next, every value drawn by the viewer (inspect.js), and the session's variables beside it.
//
//   import { mountConsole } from '<devbox>/console.js';
//   const box = mountConsole(element, { store, highlight, timeLimit });
//
// The host gives it an element to fill (it takes the element's whole size) and, if it likes, where to keep each
// language's history (`store`: { get(key), set(key, text) }, either may return a promise; else localStorage, if it can
// be had) and a way to colour code (`highlight(code, lang)`, an element or null). Colours come from the host's style
// sheet through the --db-* variables (devbox.css). See API.md.
//
// JavaScript and TypeScript run on this device, in a worker of the session's own (runner.js); TypeScript has its types
// taken out first (typescript.js, loaded the first time it is used), not checked. An entry that runs past `timeLimit`
// has its worker ended: another is started, and the entries that succeeded are run again, quietly, so the session is as
// it was (at most REPLAY of them; the oldest are let go first, and it says so).

import { prepare, incomplete } from './transform.js';
import { render, renderTable, errorLine } from './inspect.js';

const BASE = new URL('.', import.meta.url).href;
const HISTORY = 200, REPLAY = 200, MAX_ENTRIES = 300;
export const LANGUAGES = { js: 'JavaScript', ts: 'TypeScript' };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---- a session: one runner, and what is needed to make it again ----
class Session {
  constructor(lang, { base, timeLimit, onLog, onClear }) {
    Object.assign(this, { lang, base, timeLimit, onLog, onClear });
    this.done = [];        // the prepared entries that succeeded, to run again after a restart
    this.dropped = 0;      // how many were let go from `done`
    this.n = 0;            // entries so far (each is named by its number in errors' stacks)
    this.generation = 0;   // which runner: a description from an earlier one is gone
    this.tail = Promise.resolve();
    this.waiting = new Map();
    this.nextId = 1;
  }
  start() {
    this.generation++;
    const w = new Worker(this.base + 'runner.js');
    this.worker = w;
    this.ready = new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('The runner did not start.')), 10000);
      w.addEventListener('message', (e) => { if (e.data?.type === 'ready') { clearTimeout(t); ok(); } });
      w.addEventListener('error', (e) => { clearTimeout(t); fail(new Error(e.message || 'The runner could not be loaded.')); });
    });
    w.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'reply') { const p = this.waiting.get(m.id); if (p) { this.waiting.delete(m.id); p.ok(m); } }
      else if (m.type === 'log' && w === this.worker) this.onLog?.(m, this.ctx());
      else if (m.type === 'clear' && w === this.worker) this.onClear?.();
    });
    return this.ready;
  }
  stop() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.waiting.values()) p.fail(Object.assign(new Error('stopped'), { stopped: true }));
    this.waiting.clear();
  }
  // One request to the runner, answered within the time limit, or the runner is ended and made again.
  ask(msg) {
    const go = async () => {
      if (!this.worker) await this.restart();
      await this.ready;
      const id = this.nextId++, w = this.worker;
      return new Promise((ok, fail) => {
        const timer = setTimeout(async () => {
          this.waiting.delete(id);
          const why = Object.assign(new Error(`Stopped after ${this.timeLimit / 1000} s`), { timedOut: true });
          try { why.replayed = await this.restart(); } catch (e) { why.restartFailed = String(e.message || e); }
          fail(why);
        }, this.timeLimit);
        this.waiting.set(id, { ok: (m) => { clearTimeout(timer); ok(m); }, fail: (e) => { clearTimeout(timer); fail(e); } });
        w.postMessage({ ...msg, id });
      });
    };
    const p = this.tail.then(go, go);
    this.tail = p.catch(() => {});
    return p;
  }
  // A new runner, and the entries that succeeded run again in it, quietly. Says how many, and how many were left out.
  async restart() {
    this.stop();
    await this.start();
    let ran = 0, failed = 0;
    for (const entry of this.done) {
      const id = this.nextId++, w = this.worker;
      const r = await new Promise((ok) => {
        const timer = setTimeout(() => ok(null), this.timeLimit);
        this.waiting.set(id, { ok: (m) => { clearTimeout(timer); ok(m); }, fail: () => { clearTimeout(timer); ok(null); } });
        w.postMessage({ op: 'run', ...entry, silent: true, id });
      });
      if (!r) { this.stop(); await this.start(); failed = this.done.length - ran; break; }
      ran++;
    }
    return { ran, failed, dropped: this.dropped };
  }
  async reset() { this.done = []; this.dropped = 0; this.stop(); await this.start(); }
  ctx() {
    const gen = this.generation;
    const live = (f) => (...a) => (gen === this.generation ? f(...a) : Promise.resolve({ gone: true }));
    return {
      expand: live((h, from, count, recv) => this.ask({ op: 'expand', h, from, count, recv })),
      get: live((h, key, recv) => this.ask({ op: 'get', h, key, recv })),
      table: live((h) => this.ask({ op: 'table', h })),
    };
  }
  async run(code) {
    let js = code;
    if (this.lang === 'ts') {
      const ts = await import(this.base + 'typescript.js');
      const out = ts.stripTypes(code);
      if (out.error) return { ok: false, error: { t: 'error', c: 'SyntaxError', p: 'SyntaxError: ' + out.error, at: out.line ? [{ entry: this.n + 1, line: out.line, col: out.col || 1 }] : [] }, syntax: true, ms: 0 };
      js = out.code;
    }
    const n = ++this.n, ready = prepare(js, n);
    const entry = { entry: n, js: ready.js, asyncJs: ready.asyncJs, objectJs: ready.objectJs, col: ready.col, asyncCol: ready.asyncCol, objectCol: ready.objectCol, names: ready.names, last: ready.last };
    const r = await this.ask({ op: 'run', ...entry });
    if (r.ok) {
      this.done.push(entry);
      if (this.done.length > REPLAY) { this.done.shift(); this.dropped++; }
    }
    return { ...r, imports: ready.imports, n, ctx: this.ctx() };
  }
  vars() { return this.ask({ op: 'vars' }); }
}

// ---- the console ----
export function mountConsole(root, { base = BASE, store = null, highlight = null, timeLimit = 5000, lang = 'js', languages = Object.keys(LANGUAGES) } = {}) {
  const keep = store || localStore();
  const box = el('div', 'devbox'), bar = el('div', 'db-bar'), main = el('div', 'db-main'), log = el('div', 'db-log'), input = el('div', 'db-input');
  const varsBox = el('details', 'db-vars'), varsHead = el('summary', 'db-varshead', 'Variables'), varsList = el('div', 'db-varlist');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  varsBox.open = true;
  varsBox.append(varsHead, varsList);

  // The bar: the language, Reset, Clear, and what the session is doing.
  const pick = el('select', 'db-lang');
  pick.title = 'Language';
  pick.setAttribute('aria-label', 'Language');
  for (const l of languages) { const o = el('option', '', LANGUAGES[l] || l); o.value = l; pick.append(o); }
  const resetB = el('button', 'db-btn', 'Reset'), clearB = el('button', 'db-btn', 'Clear'), status = el('span', 'db-status');
  resetB.title = 'Start this language’s session again: everything defined in it is let go';
  clearB.title = 'Clear what is shown (Ctrl+L); the session keeps what it has';
  bar.append(pick, resetB, clearB, status);

  // The entry box: Enter runs it when it is finished (Shift+Enter, or an open bracket, adds a line), ↑ and ↓ go through
  // what was run before, Tab puts in two spaces.
  const prompt = el('span', 'db-prompt', '›'), area = el('textarea', 'db-area'), runB = el('button', 'db-btn db-run', '▶');
  area.rows = 1;
  area.spellcheck = false;
  area.autocapitalize = 'off';
  area.setAttribute('autocorrect', 'off');
  area.setAttribute('autocomplete', 'off');
  area.setAttribute('aria-label', 'Code to run');
  area.placeholder = 'Type code and press Enter';
  runB.title = 'Run (Enter, or Ctrl/Cmd+Enter while it is unfinished)';
  runB.setAttribute('aria-label', 'Run');
  const row1 = el('div', 'db-inrow');
  row1.append(prompt, area, runB);
  input.append(row1);
  const keys = keyRow(area, () => grow());
  if (keys) input.append(keys);

  main.append(log, varsBox, input);
  box.append(bar, main);
  root.replaceChildren(box);

  const sessions = new Map(), histories = new Map();
  let current = lang in LANGUAGES ? lang : languages[0], back = -1, draft = '', running = 0;
  pick.value = current;
  const sessionOf = (l) => {
    if (!sessions.has(l)) {
      const s = new Session(l, { base, timeLimit, onLog: (m, ctx) => addLog(m, ctx, s), onClear: () => clear() });
      sessions.set(l, s);
      s.start().catch((e) => say(`The ${LANGUAGES[l]} runner could not start: ${e.message}`, 'error'));
    }
    return sessions.get(l);
  };
  const history = async (l) => {
    if (!histories.has(l)) {
      let list = [];
      try { list = JSON.parse((await keep.get('devbox:history:' + l)) || '[]'); } catch {}
      histories.set(l, Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(-HISTORY) : []);
    }
    return histories.get(l);
  };
  const remember = async (l, code) => {
    const list = await history(l);
    if (list[list.length - 1] !== code) list.push(code);
    while (list.length > HISTORY) list.shift();
    try { await keep.set('devbox:history:' + l, JSON.stringify(list)); } catch {}
  };

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  const trim = () => { while (log.children.length > MAX_ENTRIES) log.firstElementChild.remove(); };
  const blocks = new Map();   // session + entry number -> where its lines go
  const say = (text, cls = 'note') => { const was = atBottom(); log.append(el('div', 'db-entry db-' + cls, text)); trim(); if (was) toBottom(); };

  function clear() { log.replaceChildren(); blocks.clear(); }

  function addLog(m, ctx, s) {
    const was = atBottom();
    const line = el('div', 'db-line db-' + (m.level || 'log') + (m.late ? ' db-late' : ''));
    if (m.depth) line.style.setProperty('--db-depth', m.depth);
    if (m.table) line.append(renderTable(m.table, ctx));   // console.table: the table alone, as a browser's console shows it
    else m.args.forEach((a, i) => { if (i) line.append(' '); line.append(render(a, ctx)); });   // strings as printed, unquoted
    if (m.line) line.append(el('span', 'db-at', `line ${m.line}`));
    const block = !m.late && blocks.get(s.lang + ':' + m.entry);
    if (block) block.out.append(line); else { log.append(line); trim(); }
    if (was) toBottom();
  }

  function echo(code, l, n) {
    const entry = el('div', 'db-entry'), head = el('div', 'db-echo'), pre = el('pre', 'db-code');
    const coloured = highlight?.(code, l);
    if (coloured) pre.append(coloured); else pre.textContent = code;
    const num = el('span', 'db-n', `#${n}`);
    head.append(el('span', 'db-prompt', '›'), pre, num);
    head.title = 'Put this back in the entry box';
    head.onclick = () => { area.value = code; grow(); area.focus(); };
    const out = el('div', 'db-out');
    entry.append(head, out);
    log.append(entry);
    trim();
    return { entry, out, pre, num };
  }

  async function run(code = area.value) {
    if (!code.trim()) return;
    const l = current, s = sessionOf(l);
    await remember(l, code);
    back = -1;
    draft = '';
    area.value = '';
    grow();
    const block = echo(code, l, s.n + 1);
    blocks.set(l + ':' + (s.n + 1), block);
    toBottom();
    running++;
    status.textContent = 'running…';
    let r;
    try { r = await s.run(code); }
    catch (e) {
      if (e.timedOut) {
        const rp = e.replayed;
        block.out.append(el('div', 'db-error', `Stopped: it ran for more than ${timeLimit / 1000} s. ` + (e.restartFailed ? `The session could not be started again (${e.restartFailed}).` :
          `The session was started again${rp?.ran ? `, and the ${rp.ran} entr${rp.ran === 1 ? 'y' : 'ies'} that had worked run again` : ''}${rp?.failed ? `; ${rp.failed} could not be (they now run too long), so they are not defined` : ''}${rp?.dropped ? `; the ${rp.dropped} oldest were not kept to run again` : ''}.`)));
      } else if (!e.stopped) block.out.append(el('div', 'db-error', String(e.message || e)));
      running--;
      status.textContent = running ? 'running…' : '';
      refreshVars(s);
      return;
    }
    running--;
    status.textContent = running ? 'running…' : '';
    const ctx = r.ctx;
    for (const imp of r.imports || []) block.out.append(el('div', 'db-line db-info', `Skipped ${imp.text.replace(/\s+/g, ' ')}: the console has no files, so what it would bring in is not defined. Paste what is needed, or a stand-in for it.`));
    if (r.ok) {
      const res = el('div', 'db-result');
      res.append(el('span', 'db-arrowin', '←'), render(r.value, ctx, { quote: true }));
      block.out.append(res);
    } else {
      block.out.append(errorLine(r.error, ctx, { where: (at) => (at.entry === r.n ? ` at line ${at.line}` : ` in #${at.entry}, line ${at.line}`) + (at.fn ? ` (${at.fn})` : '') }));
      const at = r.error?.at?.find((x) => x.entry === r.n);
      if (at) markLine(block.pre, at.line);
    }
    if (r.ms != null) block.num.textContent = `#${r.n} · ${r.ms < 1 ? '<1' : Math.round(r.ms)} ms`;
    if (r.vars) drawVars(r.vars, ctx); else refreshVars(s);
    toBottom();
  }

  function markLine(pre, n) {
    const lines = pre.textContent.split('\n');
    if (n < 1 || n > lines.length || lines.length < 2) return;
    pre.dataset.errLine = n;
    pre.style.setProperty('--db-err-line', n - 1);
    pre.classList.add('db-errat');
  }

  const KIND = { const: 'const', let: 'let', var: 'var', function: 'ƒ', class: 'class', global: 'global' };
  function drawVars(list, ctx) {
    varsList.replaceChildren();
    varsHead.textContent = `Variables${list.length ? ' · ' + list.length : ''}`;
    if (!list.length) { varsList.append(el('p', 'db-dim', 'Nothing defined yet. What an entry declares (const a = 1, a function, a class) is listed here, and kept for the next entry.')); return; }
    for (const v of list) {
      const r = el('div', 'db-var');
      const k = el('span', 'db-kind db-kind-' + v.kind, KIND[v.kind] || v.kind), name = el('button', 'db-name', v.name);
      name.title = 'Put this name in the entry box';
      name.onclick = () => { const at = area.selectionStart ?? area.value.length; area.setRangeText(v.name, at, area.selectionEnd ?? at, 'end'); area.focus(); grow(); };
      r.append(k, name, el('span', 'db-colon', ' = '), render(v.v, ctx, { quote: true }));
      varsList.append(r);
    }
  }
  async function refreshVars(s) {
    try { const r = await s.vars(); if (s.lang === current) drawVars(r.vars || [], s.ctx()); } catch {}
  }

  // ---- the entry box's keys ----
  const grow = () => { area.style.height = 'auto'; area.style.height = Math.min(area.scrollHeight, Math.max(120, root.clientHeight * 0.4)) + 'px'; };
  area.addEventListener('input', grow);
  area.addEventListener('keydown', async (e) => {
    const v = area.value, at = area.selectionStart, end = area.selectionEnd;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      if (e.ctrlKey || e.metaKey || !incomplete(v)) { e.preventDefault(); run(); }
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); area.setRangeText('  ', at, end, 'end'); grow(); return; }
    if ((e.key === 'l' || e.key === 'L') && e.ctrlKey && !e.metaKey) { e.preventDefault(); clear(); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && at === end) {
      const up = e.key === 'ArrowUp';
      if (up ? v.lastIndexOf('\n', at - 1) >= 0 : v.indexOf('\n', at) >= 0) return;   // within a longer entry, the caret moves
      e.preventDefault();
      step(up ? 1 : -1);
    }
  });
  async function step(dir) {
    const list = await history(current);
    if (back === -1) draft = area.value;
    back = Math.max(-1, Math.min(list.length - 1, back + dir));
    area.value = back === -1 ? draft : list[list.length - 1 - back];
    grow();
    const at = dir > 0 ? area.value.indexOf('\n') : area.value.length;
    area.setSelectionRange(at < 0 ? area.value.length : at, at < 0 ? area.value.length : at);
  }
  if (keys) keys.addEventListener('devbox-history', (e) => step(e.detail));
  runB.onclick = () => run();
  pick.onchange = () => {
    current = pick.value;
    back = -1;
    say(`${LANGUAGES[current]} — a session of its own: what was defined in another language is not here.`);
    const s = sessionOf(current);
    refreshVars(s);
    area.focus();
  };
  resetB.onclick = async () => {
    const s = sessionOf(current);
    await s.reset().catch(() => {});
    say(`${LANGUAGES[current]} session started again: nothing is defined.`);
    drawVars([], s.ctx());
  };
  clearB.onclick = () => { clear(); area.focus(); };
  drawVars([], null);
  sessionOf(current);
  if (!matchMedia('(pointer: coarse)').matches) area.focus({ preventScroll: true });

  return {
    run: (code) => run(code),
    insert(code) { area.value = code; grow(); area.focus(); },
    setLanguage(l) { if (languages.includes(l)) { pick.value = l; pick.onchange(); } },
    get language() { return current; },
    clear,
    reset: () => resetB.onclick(),
    destroy() { for (const s of sessions.values()) s.stop(); sessions.clear(); root.replaceChildren(); },
    element: box,
  };
}

// The keys a phone's keyboard keeps a layer away, in a row under the entry box (touch screens only). A key keeps the
// focus in the box (its pointerdown is refused), so the keyboard stays up.
function keyRow(area, changed) {
  if (!matchMedia('(pointer: coarse)').matches) return null;
  const row = el('div', 'db-keys');
  const KEYS = [['⇥', '  ', 'Tab (two spaces)'], ['←', -1, 'Caret left'], ['→', 1, 'Caret right'], ['↑', 'up', 'The entry before'], ['↓', 'down', 'The entry after'],
    '(', ')', '{', '}', '[', ']', ';', '=', '=>', "'", '"', '`', '.', ',', ':', '+', '-', '*', '/', '!', '&', '|', '<', '>', '?'];
  for (const k of KEYS) {
    const [label, put, title] = Array.isArray(k) ? k : [k, k, k];
    const b = el('button', 'db-key', label);
    b.type = 'button';
    b.title = title;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.onclick = () => {
      if (put === 'up' || put === 'down') { row.dispatchEvent(new CustomEvent('devbox-history', { detail: put === 'up' ? 1 : -1 })); return; }
      if (typeof put === 'number') { const at = Math.max(0, Math.min(area.value.length, area.selectionStart + put)); area.setSelectionRange(at, at); return; }
      area.setRangeText(put, area.selectionStart, area.selectionEnd, 'end');
      changed();
    };
    row.append(b);
  }
  return row;
}

// The history kept in localStorage, when the host gives no store of its own; nothing kept when it cannot be had.
function localStore() {
  return {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
}
