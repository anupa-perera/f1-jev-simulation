import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const apiPort = Number(process.env.F1_JEV_PORT || 4317);

const apiServer: Plugin = {
  name: 'f1-api-server',
  apply: 'serve',
  async configureServer() {
    const alreadyRunning = await new Promise<boolean>(resolve => {
      const socket = connect({ port: apiPort, host: '127.0.0.1' })
        .on('connect', () => { socket.destroy(); resolve(true); })
        .on('error', () => resolve(false));
    });
    if (alreadyRunning) return;

    const api = spawn(
      process.execPath,
      ['--env-file-if-exists=.env', '--use-system-ca', 'src/cli.js', 'dashboard'],
      { cwd: projectRoot, stdio: 'inherit', env: { ...process.env, F1_JEV_PORT: String(apiPort) } },
    );
    process.once('exit', () => api.kill());
    api.once('exit', code => {
      if (code) console.error(`[f1-api-server] exited with code ${code}; /api requests will fail until you restart.`);
    });
  },
};

// One artifact serves both UI modes: the live dashboard fetches /api/runs, and
// `export-dashboard` injects the same JSON into this HTML for offline reading.
// Single-file output is what makes the saved report portable outside the repo.
export default defineConfig({
  root: 'ui',
  plugins: [react(), tailwindcss(), viteSingleFile(), apiServer],
  resolve: { alias: { '@': fileURLToPath(new URL('./ui/src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 100_000_000 },
  server: { host: '127.0.0.1', proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } } },
});
