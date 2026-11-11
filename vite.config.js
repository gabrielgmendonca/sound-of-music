import { defineConfig } from 'vite';

// Relative base so the built `dist/` folder works from any static host or sub-path.
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
