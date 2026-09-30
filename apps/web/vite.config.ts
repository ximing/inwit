import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  const pkgPath = path.resolve(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || pkg.version.trim().length === 0) {
    throw new Error(`Missing version in ${pkgPath}`);
  }
  return pkg.version.trim();
}

const appVersion = readPackageVersion();

const EDITOR_DOC = new Set([
  '@tiptap/extension-bubble-menu',
  '@tiptap/extension-code-block-lowlight',
  '@tiptap/extension-floating-menu',
  '@tiptap/extension-image',
  '@tiptap/extension-subscript',
  '@tiptap/extension-superscript',
  '@tiptap/extension-table',
  '@tiptap/extension-text-align',
  'prosemirror-tables',
]);

function vendorPackage(id: string): string | null {
  const parts = id.split('node_modules/');
  if (parts.length < 2) return null;
  const rest = parts[parts.length - 1] ?? '';
  if (rest.startsWith('@')) {
    const [scope, name] = rest.split('/');
    if (!scope || !name) return null;
    return `${scope}/${name}`;
  }
  const name = rest.split('/')[0];
  return name || null;
}

/** Stable vendor chunks. Business source stays out so a page deploy does not bust them. */
function manualChunks(id: string): string | undefined {
  const pkg = vendorPackage(id);
  if (!pkg) return undefined;
  if (
    pkg === 'react' ||
    pkg === 'react-dom' ||
    pkg === 'scheduler' ||
    pkg === 'use-sync-external-store'
  ) {
    return 'react';
  }
  if (pkg === 'react-router' || pkg.startsWith('@react-router/')) return 'router';
  if (pkg === 'zod') return 'zod';
  if (pkg === 'katex' || pkg === '@tiptap/extension-mathematics') return 'katex';
  if (pkg === 'lowlight' || pkg === 'highlight.js') return 'highlight';
  // @tiptap/pm/tables re-exports prosemirror-tables. Splitting those two
  // packages puts each chunk on the other's static import list.
  // Floating menu stays with the bubble menu: both use Floating UI, and
  // parking that library in only one side closes the same loop.
  if (pkg === '@tiptap/pm' && /\/tables(\/|$)/.test(id)) return 'editor-doc';
  if (pkg === '@tiptap/react' && /\/menus(\/|$)/.test(id)) return 'editor-doc';
  if (EDITOR_DOC.has(pkg)) return 'editor-doc';
  if (pkg.startsWith('@tiptap/') || pkg.startsWith('prosemirror-')) return 'editor-core';
  return undefined;
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['@embedpdf/pdfium'],
  },
  worker: {
    format: 'es',
  },
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
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
