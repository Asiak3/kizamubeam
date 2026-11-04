import { defineConfig } from 'vite';

// Window of the KizamuBeam Virtual Machine; own port next to KizamuBeam (1420), see src-tauri/tauri.conf.json
export default defineConfig({
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  build: { target: 'es2021', outDir: 'dist', emptyOutDir: true },
});
