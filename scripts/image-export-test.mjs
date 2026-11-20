import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Export tests exercise the real files.ts pipeline; only unrelated/native and
// DOM-heavy leaf modules are stubbed so the bundle runs headless in Node.
const stubs = [
  [/\/src\/native\.ts$/, 'export const hasNative=()=>false;export const native=async()=>{throw Error("native")};'],
  [/\/src\/vecexport\.ts$/, `
    export function buildPdf(pages, opts) {
      globalThis.__pdfPages = pages; globalThis.__pdfOpts = opts;
      return new Uint8Array([37, 80, 68, 70]);
    }
    export function buildDxf() { return { text: '', skippedImages: 0 }; }
  `],
];
const result = await build({
  absWorkingDir: root, entryPoints: ['scripts/image-export-test.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'error',
  loader: { '.woff': 'empty', '.woff2': 'empty' },
  plugins: [{ name: 'image-export-stubs', setup(b) {
    for (const [filter, contents] of stubs) b.onLoad({ filter }, () => ({ contents, loader: 'js' }));
  } }],
});
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) {
  console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<image-export-bundle>'));
  process.exitCode = 1;
}
