import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './app-version';

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');

describe('APP_VERSION', () => {
  it('matches apps/web/package.json version', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });
});
