#!/usr/bin/env node
/**
 * Copy packages/doc-engine/dist/doc-engine.html → apps/mobile/assets/doc-engine.html
 * so Metro can `require` the bundled WebView engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '..');
const src = path.resolve(mobileRoot, '../../packages/doc-engine/dist/doc-engine.html');
const destDir = path.resolve(mobileRoot, 'assets');
const dest = path.join(destDir, 'doc-engine.html');

if (!fs.existsSync(src)) {
  console.error(
    '未找到文档引擎产物 packages/doc-engine/dist/doc-engine.html。请先运行：pnpm -F @inwit/doc-engine build',
  );
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`synced ${path.relative(mobileRoot, dest)}`);
