import { build } from 'esbuild';
const result = await build({ entryPoints: ['scripts/image-display-async-test.ts'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'error', define: { 'import.meta.url': JSON.stringify(import.meta.url) }, plugins: [{ name: 'native-denied', setup(b) { b.onLoad({ filter: /\/src\/native\.ts$/ }, () => ({ contents: 'export const hasNative=()=>false; export const native=()=>{throw Error("Native forbidden")};', loader: 'js' })); } }] });
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) { console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<bundle>')); process.exitCode = 1; }
