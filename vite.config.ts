import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One artifact serves both UI modes: the live dashboard fetches /api/runs, and
// `export-dashboard` injects the same JSON into this HTML for offline reading.
// Single-file output is what makes the saved report portable outside the repo.
export default defineConfig({
  root: 'ui',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { '@': fileURLToPath(new URL('./ui/src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 100_000_000 },
  server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } } },
});
