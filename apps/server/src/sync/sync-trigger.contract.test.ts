import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(here, '../../drizzle');

const TRIGGER_TABLES = [
  'documents',
  'cards',
  'card_questions',
  'review_states',
  'annotations',
  'card_links',
  'topics',
  'map_nodes',
  'jobs',
  'memories',
] as const;

/** T10：概念与关系领域的行触发器（0044_concept_sync）。 */
const CONCEPT_TRIGGER_TABLES = [
  'concepts',
  'concept_relations',
  'concept_evidence',
  'concept_notes',
  'document_knowledge_refs',
  'card_knowledge_links',
  'concept_batches',
  'concept_practice_proposals',
  'concept_practice_bindings',
] as const;

function syncMigrationSql(): string {
  const files = readdirSync(drizzleDir)
    .filter((name) => name.endsWith('.sql') && name.includes('sync'))
    .sort();
  if (files.length === 0) throw new Error(`no sync migration sql in ${drizzleDir}`);
  return files.map((name) => readFileSync(path.join(drizzleDir, name), 'utf8')).join('\n');
}

describe('sync trigger migration', () => {
  const sql = syncMigrationSql();

  it('creates sync_changes and sync_emit without swallowing errors', () => {
    expect(sql).toContain('sync_changes');
    expect(sql).toContain('sync_emit');
    expect(sql).toContain('WHERE EXISTS (SELECT 1 FROM users');
    expect(sql).not.toContain('EXCEPTION WHEN OTHERS');
  });

  it('names a row trigger for every user-visible table', () => {
    for (const table of TRIGGER_TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TRIGGER sync_${table}\\b`));
      expect(sql).toMatch(new RegExp(`ON ${table}\\b`));
    }
    expect(sql).toMatch(/CREATE TRIGGER sync_jobs_insert\b/);
  });

  it('names a row trigger for every concept-domain table and extends the scope enum', () => {
    for (const table of CONCEPT_TRIGGER_TABLES) {
      expect(sql).toMatch(new RegExp(`ON ${table}\\b`));
    }
    expect(sql).toContain(`'concept'`);
    expect(sql).toMatch(/'resurface', 'concept'\)/);
  });

  it('skips a job heartbeat in the UPDATE WHEN clause', () => {
    expect(sql).toContain('OLD.status IS DISTINCT FROM NEW.status');
    expect(sql).toContain('OLD.payload IS DISTINCT FROM NEW.payload');
    expect(sql).toContain('OLD.run_at IS DISTINCT FROM NEW.run_at');
    expect(sql).toContain('OLD.last_error IS DISTINCT FROM NEW.last_error');
    expect(sql).toContain('OLD.finished_at IS DISTINCT FROM NEW.finished_at');
  });
});
