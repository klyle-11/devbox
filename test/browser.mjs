// Devbox in a browser: the console on its test page (test/page.html), served under the hub's policies by a stand-in
// (test/serve.mjs), driven in headless Chromium. `npm run test:browser`. The browser: DEVBOX_TEST_BROWSER=<path>, else
// Chrome, Edge, or Playwright's own if one is installed.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const server = await serve(0), base = `http://127.0.0.1:${server.address().port}/`;
async function launch() {
  const tries = [];
  if (process.env.DEVBOX_TEST_BROWSER) tries.push({ executablePath: process.env.DEVBOX_TEST_BROWSER });
  tries.push({ channel: 'chrome' }, { channel: 'msedge' }, { executablePath: '/opt/pw-browsers/chromium' }, {});
  for (const t of tries) { try { return await chromium.launch({ headless: true, ...t }); } catch { /* the next */ } }
  throw new Error('no browser found: install Chrome, or name one with DEVBOX_TEST_BROWSER=<path>');
}
const browser = await launch();
let passed = 0, failed = 0;
const problems = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; problems.push(name); console.log('  FAIL', name, '\n       ', String(e?.message || e).split('\n').slice(0, 6).join('\n        ')); }
}
const expect = (got, want, what = '') => { if (typeof want === 'function' ? !want(got) : got !== want) throw new Error(`${what}: got ${JSON.stringify(got)}${typeof want === 'function' ? '' : `, expected ${JSON.stringify(want)}`}`); };

async function open(opts = {}, query = '') {
  const ctx = await browser.newContext(opts), page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + query);
  await page.waitForFunction(() => window.box);
  page.errors = errors;
  return page;
}
// Run an entry and give back what its block shows under the code (results, lines, errors), as text.
const run = async (page, code) => {
  await page.evaluate((c) => window.box.run(c), code);
  return page.evaluate(() => [...document.querySelectorAll('.db-entry')].filter((e) => e.querySelector('.db-out')).pop().querySelector('.db-out').innerText);
};
const lastOut = (page) => page.locator('.db-entry:has(.db-out)').last().locator('.db-out');
const result = async (page) => (await lastOut(page).locator('.db-result').innerText()).replace('▸', '');
const vars = (page) => page.evaluate(() => [...document.querySelectorAll('.db-var')].map((v) => v.querySelector('.db-kind').textContent + ' ' + v.querySelector('.db-name').textContent));

const page = await open();
console.log('Devbox in Chromium', browser.version());

await check('a value, and the time it took', async () => {
  await run(page, '1 + 1');
  expect(await result(page), '←2', 'result');
  expect(await page.locator('.db-entry:has(.db-out)').last().locator('.db-n').innerText(), (t) => /^#1 · (\d+|<1) ms$/.test(t), 'time');
});
await check('declarations are kept from one entry to the next (const, let, var, class, function, destructuring)', async () => {
  expect((await run(page, 'const a = 5'), await result(page)), '←undefined', 'a declaration shows undefined');
  await run(page, 'a * 2');
  expect(await result(page), '←10', 'a * 2');
  await run(page, 'let b = 1, c = 2; var d = 3\nclass P { constructor() { this.w = 2; this.h = 3 } get area() { return this.w * this.h } }\nfunction fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) }\nconst { x, y: [, second] } = { x: 7, y: [8, 9] }');
  await run(page, '[a, b, c, d, new P().w, fib(20), x, second]');
  expect(await result(page), '←(8) [5, 1, 2, 3, 2, 6765, 7, 9]');
});
await check('a name declared again takes its new value', async () => {
  await run(page, 'const a = 6');
  await run(page, 'a');
  expect(await result(page), '←6');
});
await check('strings quoted as a result, printed as they are by console.log', async () => {
  await run(page, '"hi\\nthere"');
  expect(await result(page), "←'hi\\nthere'");
  const out = await run(page, 'console.log("plain", 3, "two")');
  expect(out.split('\n')[0], (t) => t.startsWith('plain 3 two'), 'log line');
});
await check('an object opens, and its parts open in turn', async () => {
  await run(page, '({ x: 1, nested: { y: [1, 2, 3] }, s: "t" })');
  expect(await result(page), "←{x: 1, nested: {…}, s: 't'}");
  const out = lastOut(page);
  await out.locator('.db-turn').first().click();
  await out.locator('.db-row', { hasText: 'nested' }).first().waitFor();
  await out.locator('.db-row', { hasText: 'nested' }).first().locator('.db-turn').first().click();
  await out.locator('.db-row', { hasText: /^y: / }).first().waitFor();
  expect(await out.locator('.db-row', { hasText: /^y: / }).first().innerText(), (t) => t.includes('(3) [1, 2, 3]'), 'y');
  expect(await out.locator('.db-row', { hasText: '[[Prototype]]' }).count(), (n) => n >= 1, 'prototype row');
});
await check('a long array opens a page at a time', async () => {
  await run(page, 'Array.from({ length: 250 }, (_, i) => i * 2)');
  const out = lastOut(page);
  await out.locator('.db-turn').first().click();
  await out.locator('.db-more', { hasText: 'more' }).waitFor();
  expect(await out.locator('.db-kids > .db-row:not(.db-more):not(.db-dimrow)').count(), 100, 'first page');
  await out.locator('.db-more', { hasText: 'more' }).click();
  await out.locator('.db-row', { hasText: /^199: 398/ }).waitFor();
  await out.locator('.db-more', { hasText: '50 more' }).click();
  await out.locator('.db-row', { hasText: /^249: 498/ }).waitFor();
  await out.locator('.db-row', { hasText: /^length: 250/ }).waitFor();
});
await check('Map and Set: their entries', async () => {
  await run(page, 'new Map([["k", 1], [{ o: 1 }, [2]]])');
  expect(await result(page), (t) => t.includes("Map(2) {'k' => 1, {…} => Array(1)}"), 'preview');
  const out = lastOut(page);
  await out.locator('.db-turn').first().click();
  await out.locator('.db-row', { hasText: "0: 'k' => 1" }).waitFor();
  await run(page, 'new Set([1, "two", 3])');
  expect(await result(page), "←Set(3) {1, 'two', 3}");
});
await check('a getter is run only when pressed, with the object it was reached from', async () => {
  await run(page, 'new P()');
  const out = lastOut(page);
  expect(await result(page), '←P {w: 2, h: 3}');
  await out.locator('.db-turn').first().click();
  const proto = out.locator('.db-row', { hasText: '[[Prototype]]' }).first();
  await proto.locator('.db-turn').first().click();
  const area = out.locator('.db-row', { hasText: /^area: / });
  await area.waitFor();
  expect(await area.innerText(), 'area: (…)', 'before');
  await area.locator('.db-getter').click();
  await out.locator('.db-row', { hasText: /^area: 6$/ }).waitFor();
});
await check('console.log with objects that open, console.table as a table', async () => {
  await run(page, 'console.log("rows", [{ a: 1, b: 2 }, { a: 3 }]); console.table([{ a: 1, b: "x" }, { a: 3, c: true }])');
  const out = lastOut(page);
  expect(await out.locator('.db-line').first().locator('.db-tree').count(), 1, 'an object in a log line opens');
  const heads = await out.locator('.db-table thead th').allInnerTexts();
  expect(heads.join(','), '(index),a,b,c', 'table columns');
  expect(await out.locator('.db-table tbody tr').count(), 2, 'rows');
});
await check('"as a table" on an array of records', async () => {
  await run(page, '[{ id: 1, name: "Ada" }, { id: 2, name: "Lin" }]');
  const out = lastOut(page);
  await out.locator('.db-turn').first().click();
  await out.locator('.db-astable').click();
  await out.locator('.db-table').waitFor();
  expect((await out.locator('.db-table tbody tr').nth(1).innerText()).replace(/\s+/g, ' ').trim(), "1 2 'Lin'");
});
await check('errors: the type, the message, the line, marked in the code', async () => {
  const out = await run(page, 'const o = null\no.x');
  expect(out, (t) => t.includes('Uncaught') && t.includes('TypeError') && t.includes('at line 2'), 'error');
  expect(await page.locator('.db-entry:has(.db-out)').last().locator('.db-code.db-errat').count(), 1, 'line marked');
  const thrown = await run(page, 'throw "boom"');
  expect(thrown, (t) => t.includes("Uncaught 'boom'"), 'a thrown string');
  const inFn = await run(page, 'function bad() { return undefined.y }\nbad()');
  expect(inFn, (t) => t.includes('at line 1') && t.includes('(bad)'), 'in a function');
  const later = await run(page, 'bad()');
  expect(later, (t) => /in #\d+, line 1/.test(t), 'in a function from an earlier entry');
});
await check('a syntax error', async () => {
  const out = await run(page, 'let = ;');
  expect(out, (t) => t.includes('SyntaxError'));
});
await check('await at the top, and a promise shown with its state', async () => {
  await run(page, 'await new Promise((r) => setTimeout(() => r(7), 20))');
  expect(await result(page), '←7');
  await run(page, 'const later = await Promise.resolve(41)\nlater + 1');
  expect(await result(page), '←42', 'a declaration made with await');
  await run(page, 'later');
  expect(await result(page), '←41', 'kept');
  await run(page, 'Promise.resolve(3)');
  expect(await result(page), '←Promise {<fulfilled>: 3}');
});
await check('{ … } alone is an object', async () => {
  await run(page, '{ a: 1, b: [2] }');
  expect(await result(page), '←{a: 1, b: Array(1)}');
});
await check('a function copied from a module: export dropped, import left out and said', async () => {
  const out = await run(page, 'import { helper } from "./helpers.js";\nexport function sq(v) { return v * v }\nexport const half = (v) => v / 2;');
  expect(out, (t) => t.includes('Skipped import { helper } from "./helpers.js";') && t.includes('not defined'), 'import said');
  await run(page, 'sq(4) + half(4)');
  expect(await result(page), '←18');
  const missing = await run(page, 'helper(1)');
  expect(missing, (t) => t.includes('ReferenceError') && t.includes('helper is not defined'), 'what it would bring is not there');
});
await check('the variables beside: names, kinds, values', async () => {
  const list = await vars(page);
  for (const want of ['const a', 'let b', 'var d', 'class P', 'ƒ fib', 'ƒ sq', 'const half', 'const later']) expect(list.includes(want), true, want + ' in ' + JSON.stringify(list));
  await run(page, 'g = 9');
  expect((await vars(page)).includes('global g'), true, 'a global made without declaring');
  const a = page.locator('.db-var', { has: page.locator('.db-name', { hasText: /^a$/ }) });
  expect(await a.innerText(), (t) => t.includes('= 6'), 'value');
});
await check('nothing of the reader’s storage, the network, or the runner itself is in reach', async () => {
  await run(page, '[typeof indexedDB, typeof caches, typeof fetch, typeof importScripts, typeof XMLHttpRequest, typeof WebSocket, typeof navigator.storage, typeof postMessage, typeof Worker]');
  expect(await result(page), "←(9) ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined']");
  await run(page, '[typeof post, typeof describe, typeof held, typeof run, typeof scope]');
  expect(await result(page), "←(5) ['undefined', 'undefined', 'undefined', 'undefined', 'undefined']");
  const out = await run(page, 'eval("1+1")');
  expect(await result(page).catch(() => out), (t) => t.includes('2'), 'eval itself is the runner’s to use, and the entry’s');
});
await check('an entry that never ends is stopped, and the session is as it was', async () => {
  const out = await run(page, 'while (true) {}');
  expect(out, (t) => t.includes('Stopped') && t.includes('started again') && /the \d+ entries that had worked run again/.test(t), 'said');
  await run(page, '[a, sq(3), later, new P().w]');
  expect(await result(page), '←(4) [6, 9, 41, 2]');
  expect(page.errors.filter((e) => !/Content Security Policy|devbox-entry/.test(e)), (l) => l.length === 0, 'page errors: ' + page.errors.join(' | '));
});
await check('an error thrown later, in a timer', async () => {
  await run(page, 'setTimeout(() => { throw new Error("later on") }, 10); "set"');
  await page.locator('.db-late', { hasText: 'later on' }).waitFor({ timeout: 3000 });
});
await check('a long string: the first 500 characters, and the rest on asking', async () => {
  await run(page, '"x".repeat(20000)');
  const out = lastOut(page);
  expect(await out.locator('.db-more').innerText(), (t) => t.includes('show all 20,000'), 'more');
  await out.locator('.db-more').click();
  expect((await out.locator('.db-string').innerText()).length, (n) => n > 10000, 'more shown');
});
await check('the entry box: Enter waits for an unfinished entry, ↑ brings back the last', async () => {
  const area = page.locator('.db-area');
  await area.click();
  await area.fill('');
  await page.keyboard.type('function z() {');
  await page.keyboard.press('Enter');
  expect(await area.inputValue(), 'function z() {\n', 'a line added');
  await page.keyboard.type('return 5 }');
  await page.keyboard.press('Enter');
  await page.locator('.db-var .db-name', { hasText: /^z$/ }).waitFor();
  expect(await area.inputValue(), '', 'run and emptied');
  await page.keyboard.press('ArrowUp');
  expect(await area.inputValue(), 'function z() {\nreturn 5 }', 'the last entry back');
});
await check('TypeScript: types taken out, lines kept, a session of its own', async () => {
  await page.evaluate(() => window.box.setLanguage('ts'));
  await run(page, 'interface Pt { x: number; y: number }\nconst p: Pt = { x: 1, y: 2 }\nenum Dir { Up, Down }\nfunction add<T extends number>(m: T, n: T): number { return m + n }');
  await run(page, '[add(p.x, p.y), Dir.Down, typeof a]');
  expect(await result(page), "←(3) [3, 1, 'undefined']", 'TypeScript, and nothing of the JavaScript session');
  const err = await run(page, 'type T = string\nconst bad: T = "x"\n(bad as any).nope.deeper');
  expect(err, (t) => t.includes('TypeError') && t.includes('line 3'), 'an error on the line typed: ' + err);
  const syn = await run(page, 'const q: = 3');
  expect(syn, (t) => t.includes('SyntaxError') && t.includes('line 1'), 'a TypeScript syntax error: ' + syn);
  await page.evaluate(() => window.box.setLanguage('js'));
  await run(page, 'a');
  expect(await result(page), '←6', 'the JavaScript session still there');
});
await check('Reset lets go of what was defined', async () => {
  await page.locator('.db-btn', { hasText: 'Reset' }).click();
  await page.locator('.db-entry', { hasText: 'started again' }).last().waitFor();
  await run(page, 'typeof a');
  expect(await result(page), "←'undefined'");
});
await check('a description from before a restart says it is gone', async () => {
  await run(page, '({ keep: { me: 1 } })');
  const out = page.locator('.db-entry:has(.db-out)').nth((await page.locator('.db-entry:has(.db-out)').count()) - 1).locator('.db-out');
  await run(page, 'while (true) {}');
  await out.locator('.db-turn').first().click();
  await out.locator('.db-row', { hasText: 'No longer held' }).waitFor();
});
await page.context().close();

await check('on a phone: fits, keys for code, buttons a finger can hit, nothing focused', async () => {
  const p = await open({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  expect(await p.evaluate(() => document.activeElement?.className || ''), (c) => !c.includes('db-area'), 'the keyboard does not come up at once');
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
  expect(await p.locator('.db-keys .db-key').count(), (n) => n > 20, 'the row of keys');
  const h = await p.locator('.db-btn', { hasText: 'Reset' }).evaluate((b) => b.getBoundingClientRect().height);
  expect(h >= 44, true, 'button height ' + h);
  expect(await p.locator('.db-area').evaluate((a) => parseFloat(getComputedStyle(a).fontSize)), (n) => n >= 16, 'the box is not zoomed into');
  await p.locator('.db-area').tap();
  for (const k of ['(', ')']) await p.locator('.db-key', { hasText: new RegExp('^\\' + k + '$') }).tap();
  expect(await p.locator('.db-area').inputValue(), '()', 'keys type');
  expect(await p.evaluate(() => document.activeElement?.className), (c) => c.includes('db-area'), 'focus kept in the box');
  const order = await p.evaluate(() => ['.db-log', '.db-vars', '.db-input'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  expect(order[0] < order[1] && order[1] < order[2], true, 'stacked: ' + order);
  await p.context().close();
});
await check('on a computer: the variables beside what was run', async () => {
  const p = await open({ viewport: { width: 1200, height: 800 } });
  const [log, vb] = await p.evaluate(() => ['.db-log', '.db-vars'].map((s) => document.querySelector(s).getBoundingClientRect().left));
  expect(vb > log + 400, true, 'beside');
  await p.context().close();
});

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed${failed ? ': ' + problems.join('; ') : ''}`);
process.exit(failed ? 1 : 0);
