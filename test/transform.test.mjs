// transform.js on its own: what an entry becomes (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, incomplete, tokens } from '../src/transform.js';

const body = (r) => r.js.slice(r.col).replace(/\n}\n\/\/# sourceURL=devbox-entry-\d+\.js$/, '');
const lines = (s) => s.split('\n').length;

test('declarations become assignments to the scope, on the same lines', () => {
  const code = 'const a = 1\nlet b, c = { x: [1, 2] }\nvar d = 3';
  const r = prepare(code);
  assert.equal(body(r), ';     a = 1\n;   b = void 0, c = { x: [1, 2] }\n;   d = 3');
  assert.deepEqual(r.names, [{ name: 'a', kind: 'const' }, { name: 'b', kind: 'let' }, { name: 'c', kind: 'let' }, { name: 'd', kind: 'var' }]);
  assert.equal(r.last, 'decl');
  assert.equal(lines(body(r)), lines(code));
});
test('destructuring: the names in a pattern, an object pattern in brackets', () => {
  const r = prepare('const { a, b: { c }, d = f(1, 2), ...rest } = o, [e, , g = 1] = arr');
  assert.deepEqual(r.names.map((n) => n.name), ['a', 'c', 'd', 'rest', 'e', 'g']);
  assert.match(body(r), /^;\s+\(\{ a, b: \{ c \}, d = f\(1, 2\), \.\.\.rest \} = o\), \[e, , g = 1\] = arr$/);
});
test('a value that ends in a bracket is taken whole', () => {
  assert.equal(body(prepare('const o = { x: 7, y: [8, 9] }')), ';     o = { x: 7, y: [8, 9] }');
  assert.equal(body(prepare('const f = (a) => { return a }\nf(1)')), ';     f = (a) => { return a }\nf(1)');
});
test('a class is assigned and closed off; a function is copied into the scope as the block starts', () => {
  const r = prepare('class P extends Base { m() {} }\n[1].map(x => x)\nfunction f() {}\nasync function g() {}');
  assert.match(r.js, /^with \(__devbox\) \{ __devbox\.f = f; __devbox\.g = g; P = class P extends Base \{ m\(\) \{\} \};\n\[1\]/);
  assert.deepEqual(r.names.map((n) => n.kind), ['class', 'function', 'function']);
});
test('export dropped, import left out and reported', () => {
  const r = prepare('import { a } from "./a.js";\nimport b from \'b\'\nexport const c = 1\nexport function d() {}\nexport { c as e }\nexport default c + 1');
  assert.deepEqual(r.imports.map((i) => i.from), ['./a.js', 'b']);
  assert.equal(lines(body(r)), 6);
  assert.doesNotMatch(body(r), /import|export/);
  assert.equal(r.last, 'expr');
});
test('dynamic import and import.meta are left alone', () => {
  const r = prepare('import("x")');
  assert.equal(r.imports.length, 0);
  assert.equal(body(r), 'import("x")');
});
test('await at the top: an async form returning the last expression', () => {
  const r = prepare('const x = await f()\nx + 1');
  assert.ok(r.asyncJs.includes('return x + 1'));
  assert.equal(prepare('[1].map(async (v) => await v)').asyncJs.includes('return [1]'), true);
  assert.equal(prepare('1 + 1').asyncJs, null);
});
test('{ … } alone has an object form', () => {
  assert.ok(prepare('{ a: 1 }').objectJs);
  assert.equal(prepare('{ a: 1 }; b').objectJs, null);
  assert.equal(prepare('{ let a = 1 }\n{ }').objectJs, null);
});
test('the last statement: an expression, a declaration, or another statement', () => {
  assert.equal(prepare('let a = 1; a').last, 'expr');
  assert.equal(prepare('a = 1; let b = 2;').last, 'decl');
  assert.equal(prepare('if (a) b()').last, 'stmt');
  assert.equal(prepare('label: for (;;) break label').last, 'stmt');
});
test('declarations inside blocks and functions are left as they are', () => {
  const code = 'if (x) { const a = 1 }\nfunction f() { let b = 2; return b }\nfor (let i = 0; i < 3; i++) {}';
  assert.deepEqual(prepare(code).names, [{ name: 'f', kind: 'function' }]);
  assert.match(body(prepare(code)), /\{ const a = 1 \}/);
});
test('strings, templates, regexes and comments do not confuse the scan', () => {
  const r = prepare('const s = "const no = 1" // let x = 2\nconst t = `a ${ { b: 1 }.b } c`; const re = /[/]let/g');
  assert.deepEqual(r.names.map((n) => n.name), ['s', 't', 're']);
  assert.equal(tokens('a / b / c').list.filter((t) => t.t === 'r').length, 0);
  assert.equal(tokens('x = /a\\/b/i').list.filter((t) => t.t === 'r').length, 1);
});
test('a line break ends a declaration where the language would', () => {
  const r = prepare('const a = 1\nconst b = a\n  + 1\nb');
  assert.equal(body(r), ';     a = 1\n;     b = a\n  + 1\nb');
});
test('unfinished entries', () => {
  for (const c of ['function f() {', 'f(1,', '"abc', '`a ${', '/* c', '[1, [2]']) assert.equal(incomplete(c), true, c);
  for (const c of ['f(1)', 'const a = 1', 'a)', '`x`', '// c']) assert.equal(incomplete(c), false, c);
});
