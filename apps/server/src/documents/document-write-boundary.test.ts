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

/** Product files that still insert or update the documents table directly. */
const ALLOWED_DOCUMENT_WRITERS = [
  'agent/analyze-tools.ts',
  'agent/doc-meta.ts',
  'agent/tools.ts',
  'agent/topic-tools.ts',
  'agent/weekly-tools.ts',
  'documents/document-status.ts',
  'documents/document-write.ts',
  'documents/document.service.ts',
  'documents/extract-job.ts',
  'documents/import.service.ts',
  'documents/screenshot.service.ts',
  'maps/apply.ts',
  'maps/map.jobs.ts',
  'maps/map.service.ts',
  'ocr/ocr-job.ts',
  'topics/suggest.ts',
  'topics/topic-assign.ts',
];

function isExcluded(name: string): boolean {
  return name === 'retrieval/self-test.ts' || name.startsWith('testkit/');
}

function writesDocuments(text: string): boolean {
  return text.includes('.insert(documents)') || text.includes('.update(documents)');
}

describe('document write boundary', () => {
  it('only listed product files insert or update documents', () => {
    const writers: string[] = [];
    for (const file of walk(srcRoot)) {
      const name = rel(file);
      if (isExcluded(name)) continue;
      if (writesDocuments(readFileSync(file, 'utf8'))) writers.push(name);
    }
    expect(writers.sort()).toEqual([...ALLOWED_DOCUMENT_WRITERS].sort());
  });

  it('does not let conversation tools write the documents table', () => {
    expect(ALLOWED_DOCUMENT_WRITERS).not.toContain('agent/conversation-tools.ts');
    const text = readFileSync(path.join(srcRoot, 'agent/conversation-tools.ts'), 'utf8');
    expect(text).not.toContain('.insert(documents)');
    expect(text).not.toContain('.update(documents)');
  });
});
