# Devbox — rules for changing it

Read `API.md` first: it is the contract with the hub (`klyle-11/cs-learning`, which loads `dist/` from
`/vendor/devbox/<version>/`). A change to it is made here and written up in both repositories' docs.

- **It runs what is typed, on the device, and nothing else.** No code is sent anywhere to run. The runner
  (`runner.js`) is served with `default-src 'none'; script-src 'unsafe-eval'` and takes the reader's storage
  (IndexedDB, the Cache API) and every way out (fetch, XHR, sockets, workers, importScripts, postMessage) from the
  prototypes before anything runs. Anything that loosens that (step 3, calls to web APIs) changes the hub's
  `REVIEW.md` too, and is done in a page of its own origin, not by giving this worker the network.
- **Nothing grows without a budget.** Handles (`MAX_HANDLES`), console lines per entry (`MAX_LOGS`), a string's kept
  length (`MAX_STRING`), variables listed (`MAX_VARS`), entries shown (`MAX_ENTRIES`), history (`HISTORY`), entries
  replayed after a restart (`REPLAY`), a page of parts (100), table rows (100) and columns (20). Raise one only with
  a reason, and say it in `API.md`.
- **Values cross as descriptions, never as values or markup.** A runner for another language describes its values
  the same way (`API.md`, "Values"); the viewer puts everything in with `textContent`.
- **Lines stay where they were typed.** Whatever an entry is turned into (`transform.js`, TypeScript's types taken
  out) keeps every line on its line, so an error's line is the line typed.
- **The phone is first-class.** The console is used on an iPhone, offline: touch targets of 44 px, the entry box at
  16 px (iOS zooms below it), nothing focused on opening on a touch screen, a row of code keys above the keyboard.
- `dist/` is built (`npm run build`) and committed with the change to `src/`; `npm test` passes before a commit.
- Docs on every commit: `README.md`, `API.md`, `TODO.md` here, and the hub's `TODO.md` ("Devbox") when the way the hub
  uses it changes.
