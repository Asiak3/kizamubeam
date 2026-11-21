import { build } from 'esbuild';
const result = await build({ entryPoints: ['scripts/image-visible-geometry-test.ts'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'error', metafile: true, define: { 'import.meta.url': JSON.stringify(import.meta.url) }, loader: { '.woff': 'empty', '.woff2': 'empty' }, plugins: [{ name: 'offline', setup(b) {
  b.onLoad({ filter: /[\\/]src[\\/]native\.ts$/ }, () => ({ contents: 'export const hasNative=()=>false; export const native=()=>{throw Error("Native forbidden")};', loader: 'js' }));
  b.onResolve({ filter: /(?:^|\/)files$/ }, () => ({ path: 'files', namespace: 'offline' }));
  b.onLoad({ filter: /.*/, namespace: 'offline' }, () => ({ contents: 'const deny=()=>{throw Error("File operation forbidden")}; export const objsPreviewSvg=deny,saveDataUrl=deny;', loader: 'js' }));
} }] });
for (const input of Object.keys(result.metafile.inputs)) if (/src\/(main|laser|machine|cameraui|camera|agent)\.ts$/.test(input)) throw new Error(`Forbidden dependency: ${input}`);
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) { console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<bundle>')); process.exitCode = 1; }
