// TypeScript for the console: its types taken out by Sucrase, not checked, every line kept where it was (so an error's
// line is the line typed). Bundled into dist/typescript.js by build.mjs; loaded by console.js the first time a
// TypeScript entry is run. `import` and `export` are left for transform.js, which says what it does with them.
import { transform } from 'sucrase';

export function stripTypes(code) {
  try {
    return { code: transform(code, { transforms: ['typescript'], disableESTransforms: true, keepUnusedImports: true }).code };
  } catch (e) {
    const m = String(e.message || e).match(/^(.*?)\s*\((\d+):(\d+)\)\s*$/);
    return m ? { error: m[1], line: +m[2], col: +m[3] + 1 } : { error: String(e.message || e) };
  }
}
