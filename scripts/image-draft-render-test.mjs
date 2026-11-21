import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root, entryPoints: ['scripts/image-draft-render-test.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'error',
  define: { 'import.meta.url': JSON.stringify(import.meta.url) },
  loader: { '.woff': 'empty', '.woff2': 'empty' },
  plugins: [{ name: 'native-test-boundary', setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]native\.ts$/ }, () => ({ contents: `
      export const hasNative = () => globalThis.pipelineNative;
      export const native = async (name, ...args) => {
        globalThis.pipelineNativeCalls.push(name);
        if (name === 'image_register') return;
        throw new Error('Unexpected native processing: ' + name);
      };
    `, loader: 'js' }));
  } }],
});
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) {
  console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<bundle>'));
  process.exitCode = 1;
}
