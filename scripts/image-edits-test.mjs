// Pure edits + real model persistence; isolate unrelated application services.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['scripts/image-edits-test.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', metafile: true, logLevel: 'error',
  plugins: [{ name: 'model-services', setup(build) {
    build.onResolve({ filter: /^\.\/(i18n|params|view3d\/looks)$/ }, args => {
      if (args.importer === `${root}src/model.ts`) return { path: args.path, namespace: 'model-services' };
    });
    build.onLoad({ filter: /.*/, namespace: 'model-services' }, () => ({ contents:
      'export const t = s => s; export const conditionHolds = () => true; export const cleanLook = () => undefined;' }));
  } }] });
for (const input of Object.keys(result.metafile.inputs)) {
  if (!['scripts/image-edits-test.ts', 'src/imageEdits.ts', 'src/imageGeometry.ts', 'src/mat.ts', 'src/model.ts', 'src/previewZoom.ts',
    'src/radiusDrag.ts',
    'model-services:./i18n', 'model-services:./params', 'model-services:./view3d/looks'].includes(input)) {
    throw new Error(`Unexpected image edits dependency: ${input}`);
  }
}
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) {
  console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<image-edits-bundle>'));
  process.exitCode = 1;
}
