import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./engine', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [root] },
    watch: {
      // Renders and generated audio live in out/; never hot-reload on them.
      ignored: ['**/out/**', '**/.venv/**'],
    },
  },
  optimizeDeps: {
    entries: ['index.html', 'render.html'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        render: fileURLToPath(new URL('./render.html', import.meta.url)),
      },
    },
  },
});
