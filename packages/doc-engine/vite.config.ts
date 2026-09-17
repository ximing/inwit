import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function renameDocEngineHtml(): Plugin {
  return {
    name: 'rename-doc-engine-html',
    apply: 'build',
    closeBundle() {
      const from = path.resolve(rootDir, 'dist/index.html');
      const to = path.resolve(rootDir, 'dist/doc-engine.html');
      if (existsSync(from)) renameSync(from, to);
    },
  };
}

export default defineConfig({
  plugins: [viteSingleFile(), renameDocEngineHtml()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    host: true,
    port: 5199,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(rootDir, 'index.html'),
    },
  },
});
