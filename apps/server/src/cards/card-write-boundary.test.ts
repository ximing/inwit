import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'testkit') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(srcRoot, file).split(path.sep).join('/');
}

function isExcluded(name: string): boolean {
  return name === 'retrieval/self-test.ts' || name.startsWith('testkit/');
}

describe('card write boundary', () => {
  it('only card-write inserts into cards', () => {
    const writers: string[] = [];
    for (const file of walk(srcRoot)) {
      const name = rel(file);
      if (isExcluded(name)) continue;
      if (readFileSync(file, 'utf8').includes('.insert(cards)')) writers.push(name);
    }
    expect(writers.sort()).toEqual(['cards/card-write.ts']);
  });

  it('only card-write updates cards', () => {
    const writers: string[] = [];
    for (const file of walk(srcRoot)) {
      const name = rel(file);
      if (isExcluded(name)) continue;
      if (readFileSync(file, 'utf8').includes('.update(cards)')) writers.push(name);
    }
    expect(writers.sort()).toEqual(['cards/card-write.ts']);
  });

  it('does not let conversation tools insert cards', () => {
    const text = readFileSync(path.join(srcRoot, 'agent/conversation-tools.ts'), 'utf8');
    expect(text).not.toContain('.insert(cards)');
  });
});
