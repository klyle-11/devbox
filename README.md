# Devbox

A console for small programs, like a browser's developer console: type a few lines, press Enter, see what they give.
A session for each language keeps what every entry defines (`const a = 1` now, `a + 1` next), every value is drawn
as a tree that opens a page at a time (objects, arrays, maps, sets, classes and their prototypes, getters run when
pressed, a table for rows of records), and the session's variables are listed beside it.

It is for trying out methods and their inputs and outputs, not for running files: the codebases read beside it import
from each other, so a file of one does not run alone. Copy a function in (`export` is dropped; an `import` is left out
and said), call it, look at what comes back.

Made for the reader in `klyle-11/cs-learning` (its **Console**, in the nav's **Code** section), which installs it from
this repository at a release and serves it; it works on any page that gives it an element and serves `dist/`.

## Languages

| Language | How | Offline |
|---|---|---|
| JavaScript | a worker per session, on the device (`runner.js`) | yes |
| TypeScript | types taken out by Sucrase (`typescript.js`, 200 KB, loaded when first used), not checked; then as JavaScript | yes |

Planned (see `TODO.md`): test cases for a method (`call => expected`), calls to web APIs from the console, C and C++
compiled on the device, Python. Nothing is ever run on another computer: Java, which has no compiler that runs in a
browser at a size a phone holds, is left out.

## Using it

```js
import { mountConsole } from '/vendor/devbox/0.1.0/console.js';
const box = mountConsole(element, { store, highlight, timeLimit: 5000 });
```

and `devbox.css` in the page. The host serves `runner.js` with the policy `default-src 'none'; script-src 'unsafe-eval'`
(see `API.md`, "Serving it"). `API.md` is the reference; `AGENTS.md` the rules for changing it.

## Building and testing

- `npm install`, then `npm run build`: `src/` → `dist/` (the modules as they are, Sucrase bundled into
  `dist/typescript.js`, and `dist/manifest.json`). `dist/` is committed, so a host installing from git builds nothing;
  CI checks it matches `src/`.
- `npm test`: `test/transform.test.mjs` (Node) and `test/browser.mjs` (the console on `test/page.html`, served by
  `test/serve.mjs` under the hub's policies, in headless Chromium: Chrome or Edge on the machine, or
  `DEVBOX_TEST_BROWSER=<path>`).
- `node test/serve.mjs` serves the test page on http://localhost:4398 to try by hand.

## Releasing

Bump `version` in `package.json`, `npm run build`, commit, and tag the commit `v<version>`. A host moves to it by its
own choice (the hub: `npm run devbox:update` in `hub/`, which stays within the range it names).
