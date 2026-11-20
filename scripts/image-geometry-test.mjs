// Pure geometry harness: no application, native or hardware modules permitted.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['scripts/image-geometry-test.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', metafile: true, logLevel: 'error' });
for (const input of Object.keys(result.metafile.inputs)) {
  if (!['scripts/image-geometry-test.ts', 'src/imageGeometry.ts', 'src/mat.ts'].includes(input)) {
    throw new Error(`Unexpected geometry dependency: ${input}`);
  }
}
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) {
  console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<image-geometry-bundle>'));
  process.exitCode = 1;
}
