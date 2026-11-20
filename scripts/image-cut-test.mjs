// Pure image cut model/persistence; isolate unrelated application services.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['scripts/image-cut-test.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', metafile: true, logLevel: 'error',
  plugins: [{ name: 'model-services', setup(build) {
    build.onResolve({ filter: /^\.\/(i18n|params|view3d\/looks)$/ }, args => {
      if (args.importer === `${root}src/model.ts`) return { path: args.path, namespace: 'model-services' };
    });
    build.onLoad({ filter: /.*/, namespace: 'model-services' }, () => ({ contents:
      'export const t = s => s; export const conditionHolds = () => true; export const cleanLook = () => undefined;' }));
  } }] });
const allowed = new Set(['scripts/image-cut-test.ts', 'src/imageCut.ts', 'src/model.ts', 'src/mat.ts',
  'src/imageContour.ts', 'src/imageEdits.ts', 'src/imageGeometry.ts', 'src/contourTopology.ts',
  'src/pathtools.ts', 'src/curves.ts',
  'model-services:./i18n', 'model-services:./params', 'model-services:./view3d/looks']);
for (const input of Object.keys(result.metafile.inputs)) {
  if (!allowed.has(input)) throw new Error(`Unexpected image cut dependency: ${input}`);
}
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) {
  console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<image-cut-bundle>'));
  process.exitCode = 1;
}
