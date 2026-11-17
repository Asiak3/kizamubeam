import { defineConfig } from 'vite';

// Feste Portnummer für Tauri (siehe src-tauri/tauri.conf.json)
export default defineConfig({
  clearScreen: false,
  // Module workers may lazily load the geometry engine after their worker-local bootstrap.
  worker: { format: 'es' },
  server: { port: 1420, strictPort: true },
  // The QuickJS engine of JavaScript plugins finds its .wasm file next to its own module (import.meta.url).
  // Pre-bundling moves the module into .vite/deps without the file, so the dev server answered with index.html
  // and every JavaScript plugin failed with plugin-crash; build and preview were not affected.
  optimizeDeps: { exclude: ['@jitl/quickjs-wasmfile-release-sync'] },
  // Ersatzschriften (~22 kB) einbetten, damit Text-in-Pfad auch ohne Netz und als Einzeldatei funktioniert
  build: { target: 'es2021', outDir: 'dist', assetsInlineLimit: 32768 },
});
