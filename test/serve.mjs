// A stand-in for the hub, serving dist/ and the test page under the policies the hub sends them with (the page: its
// own scripts only, talking to this server alone; the runner: eval and nothing else). `node test/serve.mjs` serves it on
// http://localhost:4398 to try by hand; test/browser.mjs starts it on a port of its own.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
export const PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'";
export const RUNNER_POLICY = "default-src 'none'; script-src 'unsafe-eval'";

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = path === '/' ? 'test/page.html' : normalize(path.slice(1));
    if (file.startsWith('..') || !(file.startsWith('dist/') || file.startsWith('test/'))) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(join(root, file));
      const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
      if (file === 'dist/runner.js') headers['Content-Security-Policy'] = RUNNER_POLICY;
      else if (file.endsWith('.html')) headers['Content-Security-Policy'] = PAGE_POLICY;
      res.writeHead(200, headers).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = await serve(Number(process.env.PORT) || 4398);
  console.log(`Devbox test page: http://localhost:${s.address().port}/`);
}
