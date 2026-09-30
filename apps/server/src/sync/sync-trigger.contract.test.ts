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

function latestSyncMigration(): string {
  const files = readdirSync(drizzleDir)
    .filter((name) => name.endsWith('.sql') && name.includes('sync'))
    .sort();
  const latest = files.at(-1);
  if (!latest) throw new Error(`no sync migration sql in ${drizzleDir}`);
  return readFileSync(path.join(drizzleDir, latest), 'utf8');
}

describe('sync trigger migration', () => {
  const sql = latestSyncMigration();

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

  it('skips a job heartbeat in the UPDATE WHEN clause', () => {
    expect(sql).toContain('OLD.status IS DISTINCT FROM NEW.status');
    expect(sql).toContain('OLD.payload IS DISTINCT FROM NEW.payload');
    expect(sql).toContain('OLD.run_at IS DISTINCT FROM NEW.run_at');
    expect(sql).toContain('OLD.last_error IS DISTINCT FROM NEW.last_error');
    expect(sql).toContain('OLD.finished_at IS DISTINCT FROM NEW.finished_at');
  });
});
