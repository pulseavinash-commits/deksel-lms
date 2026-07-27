import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // During local dev, `netlify dev` runs on 8888 and proxies both this
      // dev server and the functions. If running vite directly, forward /api.
      '/api': 'http://localhost:8888',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
