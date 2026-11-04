import { defineConfig } from 'vite';

// Fenster der KizamuBeam Virtual Machine; eigener Port neben KizamuBeam (1420), siehe src-tauri/tauri.conf.json
export default defineConfig({
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  build: { target: 'es2021', outDir: 'dist', emptyOutDir: true },
});
