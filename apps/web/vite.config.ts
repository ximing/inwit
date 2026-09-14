import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5190,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3020',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5190,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3020',
        changeOrigin: true,
      },
    },
  },
});
