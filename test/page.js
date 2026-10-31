// The console on a page of its own, for test/browser.mjs (and for trying by hand: node test/serve.mjs).
import { mountConsole } from '/dist/console.js';
const kept = new Map();
window.box = mountConsole(document.getElementById('c'), {
  timeLimit: Number(new URLSearchParams(location.search).get('limit')) || 2000,
  store: { get: (k) => kept.get(k) ?? null, set: (k, v) => { kept.set(k, v); } },
});
