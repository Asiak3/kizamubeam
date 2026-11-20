// Order regression: per-image crop/perspective application order (cropFirst vs perspectiveFirst).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['scripts/image-order-test.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', metafile: true, logLevel: 'error',
  plugins: [{ name: 'order-i18n-stub', setup(b) {
    b.onResolve({ filter: /\/i18n$/ }, args => ({ path: args.path, namespace: 'order-i18n-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'order-i18n-stub' }, () => ({ contents: 'export const t = (s) => s;' }));
  } }] });
for (const input of Object.keys(result.metafile.inputs)) {
  if (!['scripts/image-order-test.ts', 'src/imageEdits.ts', 'src/imageGeometry.ts', 'src/imageRaster.ts',
    'src/mat.ts', 'src/imageContour.ts', 'src/editor/imageHandles.ts', 'order-i18n-stub:../i18n'].includes(input)) {
    throw new Error(`Unexpected image order dependency: ${input}`);
  }
}
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) {
  console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<image-order-bundle>'));
  process.exitCode = 1;
}
