# Devbox — to do

Asked (31 October 2026, in `klyle-11/cs-learning`): a console of its own in the reader's Code section, "to run small
programs, similar to a browser dev console, but in multiple languages if possible, testing methods and their inputs
and outputs", then "devbox powering the display of output, data in variables etc, api connections". Not to run the
files of a codebase (they import from each other; they are for reading and annotating). Decided then: Devbox is its
own package, here; web APIs called directly from the device only, through the hub later if ever; **no code run on
another computer** (so no Java by JShell on the hub's computer); the reader's old "▶ Try it" buttons on code are not
brought back.

## Step 1: the console, the viewer, the variables; JavaScript and TypeScript (31 October 2026)

- [x] `transform.js`: an entry's top-level declarations kept across entries (assignments to the session's scope, run
  in `with`), lines kept where typed; `export` dropped, `import` left out and reported; top-level `await`; `{ … }` as an
  object; `incomplete()` for Enter. 13 checks (`test/transform.test.mjs`).
- [x] `runner.js`: a worker per session; values described, never sent (handles, a page of parts at a time, getters
  run on asking with the object they were reached from, tables); console calls with their lines (`%s %d %o`, `table`,
  `group`, `count`, `time`, `assert`, `clear`); errors with where they were thrown in what was typed; errors thrown
  later (timers, promises nobody waited for); the session's variables, and globals made without declaring. Storage
  and every way out taken from its reach; its own names out of reach of what is typed.
- [x] `inspect.js`: the viewer (trees, pages, getters, tables, long strings, errors), all as text.
- [x] `console.js`: the console (a session per language, history kept by the host's store, the time limit with the
  session restarted and its entries run again, the variables beside it, a row of code keys on a touch screen).
- [x] `typescript.js`: Sucrase, types taken out, lines kept.
- [x] `devbox.css`: themed by `--db-*`; side by side from 720 px, stacked below; 44 px targets and a 16 px box on touch.
- [x] Checked: `npm test`, 13 Node checks and 26 in headless Chromium 153 on Linux (values, keeping declarations,
  objects, pages of an array, maps and sets, getters, console.log and console.table, "as a table", errors and their
  lines, syntax errors, await and promises, `{ … }`, export and import, the variables, nothing in reach, an endless
  entry stopped and the session as it was, a later error, long strings, the entry box's keys, TypeScript, Reset, a
  description from before a restart, a phone's width with touch, a computer's).
- [ ] Not checked: Safari (WebKit) and a real iPhone: `with` and Annex B functions in eval, the stack format for an
  error's line (`//# sourceURL` is honoured by WebKit, not tried here), the keys row above iOS's keyboard. Firefox.

## Step 2: test cases for a method

- [ ] A block of cases, one a line, `call => expected` (both in the entry's language), run against the session: a
  table of what each gave, what was expected, pass or fail; compared as data (arrays, objects, `Map`, `Set`, `Date`,
  `NaN`). The hub's earlier sandbox had a parser for this (`parseTests`, on `codex/main-handoff`), to take from.
- [ ] Cases kept with the method, so they can be run again after an edit.

## Step 3: calls to web APIs, from the device

- [ ] The runner in a page of its own origin (an opaque one: the hub's `sandbox` without `allow-same-origin`, as for
  pages that run their own scripts), allowed `connect-src https:`; a worker inside it for the time limit. Not by
  giving this worker the network: same-origin with the hub, `https:` would include the hub itself.
- [ ] A short request form (method, URL, headers, body) beside the console; the response (status, headers, timing,
  body) in the viewer, and in a variable `res`. Keys typed for a site stay on the device (the host's store).
- [ ] Only APIs that allow a browser's requests (CORS) can be reached this way: said when a request is refused for it.
- [ ] Later, if wanted: through the hub (named connections in `hub.json`), for APIs without CORS and a dev server on the
  computer. Not now.

## Step 4: C and C++

- [ ] Clang in WebAssembly (`@yowasp/clang`, as the hub's earlier sandbox had it: about 105 MB, an opt-in download
  read back before it is counted as kept). An entry compiled with the session's earlier definitions (includes, types,
  functions, globals) inside a generated `main`; statements from earlier entries not run again (said).
- [ ] Values printed as descriptions (`devbox.hpp`: numbers, strings, `vector`, `map`, `set`, `pair`, `optional`; a
  struct's fields by `__builtin_dump_struct`), so the viewer draws them as it does JavaScript's.
- [ ] Memory while compiling on an iPhone (about 0.5 GB in Node): to be tried, and the limit said if iOS closes the page.

## Step 5: Python, and "Send to console"

- [ ] Python by Pyodide (about 10 MB), an opt-in download as for the compiler; a real REPL, values described the same way.
- [ ] Java: only if a compiler that runs in the browser at a size a phone can hold turns up (TeaVM's browser build of
  javac, to be measured). Never by running it on another computer.
- [ ] In the hub: a selection in a code file → "Send to console", into the session of the file's language.
