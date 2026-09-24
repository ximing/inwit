import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
    out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(srcRoot, file).split(path.sep).join('/');
}

const sources = walk(srcRoot);

describe('platform boundaries', () => {
  it('keeps api sources off Tauri, runtime detection, and Authorization', () => {
    for (const file of sources) {
      const name = rel(file);
      if (!name.startsWith('api/')) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, name).not.toContain('@tauri-apps');
      expect(text, name).not.toContain('isTauriRuntime');
      expect(text, name).not.toContain('platform/native');
      expect(text, name).not.toContain("headers.set('Authorization'");
      expect(text, name).not.toContain('Authorization: Bearer');
    }
  });

  it('keeps the transport Authorization guard', () => {
    const text = readFileSync(path.join(srcRoot, 'api/transport.ts'), 'utf8');
    expect(text).toContain("headers.has('Authorization')");
    expect(text).toContain('API transport must not set Authorization');
    expect(text).not.toContain("headers.set('Authorization'");
  });

  it('keeps runtime detection free of I/O', () => {
    const text = readFileSync(path.join(srcRoot, 'platform/runtime.ts'), 'utf8');
    expect(text).not.toContain('@tauri-apps');
    expect(text).not.toContain('fetch(');
  });

  it('imports @tauri-apps only from the native adapter', () => {
    for (const file of sources) {
      const name = rel(file);
      if (name === 'platform/native.ts') continue;
      expect(readFileSync(file, 'utf8'), name).not.toContain('@tauri-apps');
    }
  });

  it('keeps the native adapter off plugins and the web API', () => {
    const text = readFileSync(path.join(srcRoot, 'platform/native.ts'), 'utf8');
    expect(text).toContain("import('@tauri-apps/api/core')");
    expect(text).toContain("import('@tauri-apps/api/event')");
    expect(text).toContain("import('@tauri-apps/api/window')");
    expect(text).not.toContain('plugin-http');
    expect(text).not.toContain('plugin-store');
    expect(text).not.toContain("from '@/api");
    expect(text).not.toContain("from '../api");
    // Package specifier `@tauri-apps/api/` is the adapter import, not an app route.
    expect(text.replaceAll('@tauri-apps/api/', '')).not.toContain('/api/');
  });

  it('does not let the screenshot service pick a fetch implementation', () => {
    const text = readFileSync(path.join(srcRoot, 'services/screenshot.service.ts'), 'utf8');
    expect(text).not.toContain('tauriFetch');
    expect(text).not.toContain('@tauri-apps');
  });
});
