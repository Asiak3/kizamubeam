import { defineConfig } from 'vite';

// Feste Portnummer für Tauri (siehe src-tauri/tauri.conf.json)
export default defineConfig({
  clearScreen: false,
  // Module workers may lazily load the geometry engine after their worker-local bootstrap.
  worker: { format: 'es' },
  server: { port: 1420, strictPort: true },
  // Ersatzschriften (~22 kB) einbetten, damit Text-in-Pfad auch ohne Netz und als Einzeldatei funktioniert
  build: { target: 'es2021', outDir: 'dist', assetsInlineLimit: 32768 },
});
