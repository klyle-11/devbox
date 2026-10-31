# Devbox — API

The contract between Devbox and a page that uses it (the hub's reader: `klyle-11/cs-learning`, `hub/app.js`,
`showConsole`). Everything here is in `dist/`, served as it is.

## Serving it

`dist/manifest.json` names the package, its version and its files:

```json
{ "name": "devbox", "version": "0.1.0", "files": ["console.js", "devbox.css", "inspect.js", "runner.js", "transform.js", "typescript.js"], "runners": ["runner.js"] }
```

The host serves the files under a path that names the version (the hub: `/vendor/devbox/<version>/<file>`, its manifest
at `/vendor/devbox/manifest.json`), so a page never pairs one version's console with another's runner, and a
service worker can keep each version's files apart.

| File | Loaded by | Policy it must be sent with |
|---|---|---|
| `console.js`, `inspect.js`, `transform.js` | the page, as modules | the page's own (`script-src 'self'`) |
| `typescript.js` | `console.js`, as a module, the first time a TypeScript entry runs | the page's own |
| `devbox.css` | the page (`<link rel="stylesheet">`) | the page's own (`style-src 'self'`) |
| `runner.js` (each of `runners`) | `console.js`, as a classic worker (`new Worker`) | **`default-src 'none'; script-src 'unsafe-eval'`**: eval for the entries, nothing fetched, imported or connected to |

The page needs `worker-src 'self'` (or `script-src 'self'`, which it falls back to). Nothing in Devbox loads from
anywhere else or connects to anything.

## Mounting the console

```js
import { mountConsole, LANGUAGES } from '<base>/console.js';
const box = mountConsole(element, options);
```

`element` is emptied and filled; the console takes its whole size (give it a height). Options, all optional:

| Option | Default | What |
|---|---|---|
| `base` | the folder `console.js` was loaded from | where `runner.js` and `typescript.js` are |
| `store` | `localStorage`, if it can be had | `{ get(key), set(key, text) }`, either may return a promise. Keeps each language's history under `devbox:history:<lang>` (a JSON array of the last 200 entries) |
| `highlight` | none | `(code, lang) => Element \| null`: an entry, coloured, for the log (`lang` is `js` or `ts`) |
| `timeLimit` | `5000` | ms an entry (or a getter, or opening a value) may run before its runner is ended |
| `lang` | `'js'` | the language it opens on |
| `languages` | `['js', 'ts']` | the ones offered |

It returns:

| | |
|---|---|
| `run(code)` | runs `code` in the current language's session, as if typed; a promise, settled when shown |
| `insert(code)` | puts `code` in the entry box (to be edited and run) |
| `setLanguage(lang)`, `language` | the current language |
| `clear()`, `reset()` | clear what is shown; start the session again, everything defined in it let go |
| `destroy()` | ends every runner and empties the element |
| `element` | the console's root (`.devbox`) |

### What it does with an entry

- **Enter** runs it when it is finished; with a bracket, string, template or comment left open it adds a line (as does
  **Shift+Enter**); **Ctrl/Cmd+Enter** runs it however it is. **↑**/**↓** on the first/last line go through the history,
  **Tab** puts in two spaces, **Ctrl+L** clears. On a touch screen a row of code keys is under the box.
- Each language has a **session** of its own, a worker (`runner.js`). What an entry declares at its top (`const`, `let`,
  `var`, a class, a function, a destructuring) is kept for the next (`transform.js` turns those declarations into
  assignments to the session's scope; `const` is not enforced across entries). A name assigned without being declared
  is a global of the session, and listed as one.
- `export` in front of a declaration is dropped and `export default x` runs `x`; an `import` is left out and said (the
  console has no files), so what it would bring in is not defined.
- `await` at the top works; the last expression is the value. An entry that is one `{ … }` is an object.
- An entry that runs past `timeLimit` is stopped: its worker is ended, another started, and the entries that had
  succeeded (at most the last 200) are run again quietly, so the session is as it was. Values shown from the old worker
  say "No longer held" when opened.
- TypeScript has its types taken out (Sucrase), not checked, every line kept on its line.

## Values

A runner never sends a value, only its **description**, made where the value is:

```js
{ t, p, c, h, n, s, at, state, recv }
```

| Field | |
|---|---|
| `t` | `undefined`, `null`, `boolean`, `number`, `bigint`, `string`, `symbol`, `function`, `array`, `map`, `set`, `object`, `date`, `regexp`, `error`, `promise`, `empty` (a hole in an array) |
| `p` | a one-line preview, as text: `(3) [1, 2, {…}]`, `Point {x: 1, y: 2}`, `Map(2) {'a' => 1, …}`, `ƒ add(a, b)`, `class Point`, `Promise {<fulfilled>: 3}` |
| `s`, `n` | a string's text (at most 10,000 characters kept) and, when cut, its whole length |
| `c` | a class or type name (`Array`, `Point`, `Map`, `class`, `Function`, an error's name) |
| `h` | a handle (a number): the value has parts, asked for with `expand`. Absent: it has none |
| `n` | for an array, map or set, how many items |
| `at` | for an error: where it was thrown in what was typed, `[{ entry, line, col, fn }]` (line 1's columns as typed) |
| `state` | for a promise: `pending`, `fulfilled` or `rejected`, as known when it was described |
| `recv` | on a `[[Prototype]]`'s description: the handle of the object it was reached from, which its getters run on |

A runner for another language (C++, Python: planned) describes its values the same way, so one viewer draws them all.

### The runner's requests

The console posts `{ id, op, … }` to the worker; the worker answers `{ type: 'reply', id, … }`, and posts
`{ type: 'log', entry, level, args, line, depth, table, late }` for each console call as it happens (`args` are
descriptions), `{ type: 'clear' }` for `console.clear()`, and `{ type: 'ready' }` once it is listening.

| `op` | Asks | Answer |
|---|---|---|
| `run` | `{ entry, js, asyncJs, objectJs, col, asyncCol, objectCol, names, last, silent }` (from `transform.js`'s `prepare`) | `{ ok, value \| error, syntax, ms, vars, form }` |
| `expand` | `{ h, from, count, recv }` | `{ entries: [{ k, v, kd, map, get, set, recv, dim, inner }], total, from, more }`, or `{ gone: true }` |
| `get` | `{ h, key, recv }`: run a getter | `{ ok, value \| error }` |
| `table` | `{ h }` | `{ columns: [{ k, value }], rows: [{ k, cells }], more, total }` (at most 100 rows, 20 columns) |
| `vars` | | `{ vars: [{ name, kind, v }] }`: `kind` is `const`, `let`, `var`, `class`, `function` or `global` |

An entry `{ k, v }` is a property (`dim`: not enumerable; `inner`: one of the engine's, like `[[Prototype]]`); `{ k, kd,
v, map: true }` a map's key and value; `{ k, get: true, recv }` a getter, not run until asked.

## Limits

Handles held: 10,000 (the least recently used let go). Console lines per entry: 1,000. A string: 10,000 characters.
Variables listed: 500. Entries shown: 300. History: 200 per language. Entries run again after a restart: 200. A page
of parts: 100. A table: 100 rows, 20 columns.

## Theming

`devbox.css` reads these, with defaults of its own; the host sets them on `.devbox` (or an ancestor):

`--db-bg`, `--db-fg`, `--db-panel` (the bar and the variables), `--db-line`, `--db-muted`, `--db-accent`,
`--db-error`, `--db-warn`, `--db-info`, `--db-string`, `--db-number`, `--db-keyword` (`null`, `undefined`, booleans),
`--db-key` (property names), `--db-fn`, `--db-mono` (the typeface), `--db-size` (its size).

It lays out side by side (the variables on the right) when the console is 720 px wide or more, else stacked (what was
run, the variables, the entry box), by a container query, so it follows the space it is given and not the window's.
