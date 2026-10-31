// Builds dist/ from src/: the modules as they are, TypeScript's type stripper (Sucrase) bundled into one file, and the
// manifest the hub serves the package by (name, version, files). dist/ is committed, so a host installing Devbox from
// git needs nothing built: run this after any change to src/, and commit both (CI checks they match).
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const here = new URL('.', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', here), 'utf8'));
const dist = new URL('dist/', here);
// What is bundled into typescript.js, and under what licences (each package's own LICENSE is in node_modules/).
const BANNER = '/* Sucrase (MIT, Copyright (c) 2012-2018 various contributors, github.com/alangpierce/sucrase), with lines-and-columns, ' +
  '@jridgewell/gen-mapping, trace-mapping, resolve-uri and sourcemap-codec (MIT) and ts-interface-checker (Apache-2.0), as bundled by build.mjs. */';
await rm(dist, { recursive: true, force: true });
await mkdir(dist);
const plain = ['console.js', 'inspect.js', 'transform.js', 'runner.js', 'devbox.css'];
for (const f of plain) await copyFile(new URL('src/' + f, here), new URL(f, dist));
await build({ entryPoints: [new URL('src/typescript.mjs', here).pathname], bundle: true, format: 'esm', minify: true, legalComments: 'eof', target: 'es2020', banner: { js: BANNER }, outfile: new URL('typescript.js', dist).pathname, logLevel: 'warning' });
const files = (await readdir(dist)).filter((f) => /\.(js|css)$/.test(f)).sort();
await writeFile(new URL('manifest.json', dist), JSON.stringify({ name: pkg.name, version: pkg.version, files, runners: ['runner.js'] }, null, 2) + '\n');
console.log(`dist/: ${files.join(', ')} (version ${pkg.version})`);
