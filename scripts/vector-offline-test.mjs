// Real-editor harness without application, acquisition or transport imports.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: [process.argv[2] ?? 'scripts/vector-editor-test.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm', metafile: true, logLevel: 'error',
  loader: { '.woff': 'empty', '.woff2': 'empty' },
  plugins: [{ name: 'deny-app-boundaries', setup(b) {
    b.onResolve({ filter: /(?:^|\/)files$/ }, () => ({ path: 'files', namespace: 'offline' }));
    b.onResolve({ filter: /(?:^|\/)native$/ }, () => ({ path: 'native', namespace: 'offline' }));
    b.onLoad({ filter: /.*/, namespace: 'offline' }, ({ path }) => ({ loader: 'js', contents: path === 'native'
      ? `export const hasNative=()=>false; export const native=()=>{throw Error('Native forbidden')};`
      : `const deny=()=>{throw Error('File operation forbidden')};export const objsPreviewSvg=deny,saveDataUrl=deny;` }));
  } }] });
for (const input of Object.keys(result.metafile.inputs)) {
  if (/src\/(main|laser|machine|cameraui|camera|agent)\.ts$/.test(input)) throw new Error(`Forbidden dependency: ${input}`);
}
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) {
  console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<offline-vector-bundle>'));
  process.exitCode = 1;
}
