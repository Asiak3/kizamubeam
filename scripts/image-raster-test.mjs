// Pure raster contract: importing model/application runtime is a regression.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['scripts/image-raster-test.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', metafile: true, logLevel: 'error' });
for (const input of Object.keys(result.metafile.inputs)) {
  if (!['scripts/image-raster-test.ts', 'src/imageRaster.ts', 'src/imageEdits.ts', 'src/imageContour.ts', 'src/mat.ts',
    'src/imageGeometry.ts', 'src/mat.ts'].includes(input)) {
    throw new Error(`Unexpected image raster dependency: ${input}`);
  }
}
try { await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`); }
catch (error) {
  console.error(String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<image-raster-bundle>'));
  process.exitCode = 1;
}
