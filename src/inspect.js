// Devbox's viewer: a value's description (API.md, "Values") drawn as a browser's console draws one. A preview on one
// line; anything with parts opens, a page at a time, its parts asked for only when it is opened; a getter is run only
// when pressed; an array or object of records can be shown as a table. It knows nothing of the language the value came
// from: every runner describes its values the same way.
//
// `ctx` is what asks the runner: { expand(h, from, count, recv), get(h, key, recv), table(h) }, each a promise. A
// description from a runner that has since been restarted answers { gone: true }, and is said to be gone.
//
// Everything is put in as text (textContent), never as markup: what a value says cannot become part of the page.

const PAGE = 100, SHORT = 500;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const quote = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";

// A value, drawn. opts.quote: strings in quotes (a result, or inside a structure), not as a console line prints them.
export function render(d, ctx, opts = {}) {
  if (!d) return el('span', 'db-v db-undefined', 'undefined');
  if (d.t === 'string') return stringEl(d, opts.quote);
  if (!d.h) {
    const s = el('span', 'db-v db-' + d.t, d.p ?? '');
    return s;
  }
  return tree(d, ctx, opts);
}

function stringEl(d, quoted) {
  const s = el('span', 'db-v db-string' + (quoted ? ' db-quoted' : ''));
  const text = d.s ?? '', extra = d.n && d.n > text.length ? d.n - text.length : 0;
  const shown = text.length > SHORT ? text.slice(0, SHORT) : text;
  s.textContent = quoted ? quote(shown) : shown;
  if (text.length > SHORT || extra) {
    const more = el('button', 'db-more', text.length > SHORT ? `… show all ${(d.n || text.length).toLocaleString()} characters` : `… ${extra.toLocaleString()} more characters not kept`);
    if (text.length > SHORT) more.onclick = () => { s.textContent = quoted ? quote(text) : text; if (extra) s.append(el('span', 'db-dim', ` … ${extra.toLocaleString()} more characters not kept`)); };
    else more.disabled = true;
    const box = el('span', 'db-strbox');
    box.append(s, more);
    return box;
  }
  return s;
}

// Something with parts: its preview, and a turn to open it.
function tree(d, ctx, opts) {
  const box = el('span', 'db-tree db-' + d.t), head = el('span', 'db-head'), turn = el('button', 'db-turn', '▸'), kids = el('div', 'db-kids');
  turn.setAttribute('aria-expanded', 'false');
  turn.setAttribute('aria-label', 'Open');
  kids.hidden = true;
  head.append(turn, previewEl(d));
  box.append(head, kids);
  let filled = false;
  const toggle = async () => {
    const open = kids.hidden;
    kids.hidden = !open;
    turn.textContent = open ? '▾' : '▸';
    turn.setAttribute('aria-expanded', String(open));
    turn.setAttribute('aria-label', open ? 'Close' : 'Open');
    if (open && !filled) { filled = true; await fill(kids, d, ctx, 0); }
  };
  turn.onclick = (e) => { e.stopPropagation(); toggle(); };
  head.onclick = (e) => { if (e.target === head || e.target.closest('.db-pre')) { e.stopPropagation(); toggle(); } };
  if (opts.open) toggle();
  return box;
}

function previewEl(d) {
  const p = el('span', 'db-pre');
  if (d.t === 'error') { p.classList.add('db-errtext'); p.textContent = d.p; }
  else if (d.t === 'function') { p.append(el('span', 'db-fn', d.p)); }
  else p.textContent = d.p ?? '';
  return p;
}

// A page of a value's parts, put into `kids`, with a way to the next page.
async function fill(kids, d, ctx, from) {
  const wait = el('div', 'db-row db-dim', '…');
  kids.append(wait);
  let r;
  try { r = await ctx.expand(d.h, from, PAGE, d.recv); } catch (e) { r = { failed: String(e?.message || e) }; }
  wait.remove();
  if (!r || r.gone) { kids.append(el('div', 'db-row db-dim', 'No longer held: the session was started again since this was shown. Run it again to look inside.')); return; }
  if (r.failed) { kids.append(el('div', 'db-row db-errtext', r.failed)); return; }
  if (from === 0 && (d.t === 'array' || d.t === 'map' || (d.t === 'object' && (d.c === 'Object' || !d.c))) && r.total > 0 && ctx.table) kids.append(tableButton(d, ctx));
  for (const x of r.entries) kids.append(row(x, d, ctx));
  if (r.more) {
    const next = from + PAGE, more = el('button', 'db-more db-row', `▸ ${Math.min(PAGE, r.total - next).toLocaleString()} more (${next.toLocaleString()} of ${r.total.toLocaleString()} shown)`);
    more.onclick = async () => { more.remove(); await fill(kids, d, ctx, next); };
    kids.append(more);
  }
}

function row(x, parent, ctx) {
  const r = el('div', 'db-row' + (x.dim ? ' db-dimrow' : ''));
  r.append(el('span', 'db-k' + (x.inner ? ' db-inner' : ''), x.k), el('span', 'db-colon', ': '));
  if (x.map) {
    r.append(render(x.kd, ctx, { quote: true }), el('span', 'db-arrow', ' => '), render(x.v, ctx, { quote: true }));
  } else if (x.get || x.set) {
    if (x.set) { r.append(el('span', 'db-dim', '(setter only)')); return r; }
    const b = el('button', 'db-getter', '(…)');
    b.title = 'Run the getter';
    b.onclick = async (e) => {
      e.stopPropagation();
      b.disabled = true;
      let got;
      try { got = await ctx.get(parent.h, x.k, x.recv); } catch (err) { got = { ok: false, error: { t: 'string', s: String(err?.message || err) } }; }
      if (got?.gone) { b.replaceWith(el('span', 'db-dim', 'no longer held')); return; }
      b.replaceWith(got?.ok ? render(got.value, ctx, { quote: true }) : errorLine(got?.error, ctx));
    };
    r.append(b);
  } else r.append(render(x.v, ctx, { quote: true }));
  return r;
}

function tableButton(d, ctx) {
  const b = el('button', 'db-more db-row db-astable', '⊞ as a table');
  b.onclick = async () => {
    b.disabled = true;
    let t;
    try { t = await ctx.table(d.h); } catch { t = null; }
    if (!t || t.gone) { b.textContent = 'No longer held'; return; }
    b.replaceWith(renderTable(t, ctx));
  };
  return b;
}

// A table (console.table, or "as a table"): { columns: [{ k, value }], rows: [{ k, cells: [description | null] }], more, total }.
export function renderTable(t, ctx) {
  const wrap = el('div', 'db-tablewrap'), table = el('table', 'db-table'), head = el('tr');
  head.append(el('th', '', '(index)'));
  for (const c of t.columns) head.append(el('th', c.value ? 'db-inner' : '', c.k));
  const thead = el('thead'), tbody = el('tbody');
  thead.append(head);
  for (const r of t.rows) {
    const tr = el('tr');
    tr.append(el('th', '', r.k));
    for (const c of r.cells) { const td = el('td'); if (c) td.append(c.h ? el('span', 'db-v db-' + c.t, c.p) : render(c, ctx, { quote: true })); tr.append(td); }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  if (t.more) wrap.append(el('div', 'db-dim', `The first 100 of ${t.total.toLocaleString()} rows.`));
  return wrap;
}

// An error, as a console says one was thrown: "Uncaught TypeError: …", where it was, and its parts.
export function errorLine(d, ctx, { where } = {}) {
  const box = el('div', 'db-error');
  if (!d) { box.textContent = 'Uncaught error'; return box; }
  if (d.t === 'error') {
    box.append(el('span', 'db-errtext', 'Uncaught '));
    box.append(render(d, ctx));
    const at = d.at?.[0];
    if (at) box.append(el('span', 'db-at', where ? where(at) : ` at line ${at.line}`));
  } else {
    box.append(el('span', 'db-errtext', 'Uncaught '), render(d, ctx, { quote: true }));
  }
  return box;
}
