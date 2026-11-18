// Local preserved reader only. This schema was built by isolated migrations, not Drizzle's public journal.
// Production uses the ordinary Drizzle migration chain; never use this script there.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const pg = require('pg');
import { readFile, writeFile } from 'node:fs/promises';
const c = new pg.Client({
  host: '127.0.0.1',
  port: 55439,
  database: 'inwit_pdf_local',
  user: 'inwit_local',
  password: 'local-only',
});
const tables = [
  'users',
  'user_translation_settings',
  'llm_configs',
  'llm_credential_versions',
  'pdf_translations',
];
await c.connect();
try {
  await c.query('BEGIN');
  await c.query('SET LOCAL search_path=inwit_pdf_reading,public');
  const schema = (await c.query('select current_schema() name')).rows[0].name;
  if (schema !== 'inwit_pdf_reading') throw Error('Unexpected schema');
  await c.query('LOCK TABLE pdf_translation_jobs IN ACCESS EXCLUSIVE MODE');
  const active = Number(
    (
      await c.query(
        "select count(*) n from pdf_translation_jobs where state in ('queued','preparing','dispatched')",
      )
    ).rows[0].n,
  );
  if (active) throw Error('Active translation jobs: migration postponed');
  const exists = Number(
    (
      await c.query(
        "select count(*) n from information_schema.columns where table_schema='inwit_pdf_reading' and table_name='pdf_translation_jobs' and column_name='stream_id'",
      )
    ).rows[0].n,
  );
  if (exists) {
    const columns = Number(
      (
        await c.query(
          "select count(*) n from information_schema.columns where table_schema='inwit_pdf_reading' and table_name='pdf_translation_jobs' and column_name in ('stream_id','draft_text','draft_seq','draft_updated_at')",
        )
      ).rows[0].n,
    );
    const triggers = Number(
      (
        await c.query(
          "select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='inwit_pdf_reading' and c.relname='pdf_translation_jobs' and t.tgname='pdf_translation_stream_notify'",
        )
      ).rows[0].n,
    );
    if (columns !== 4 || triggers !== 1)
      throw Error('Incomplete streaming migration; manual inspection required');
    await c.query('COMMIT');
    console.log(JSON.stringify({ schema, migration: '0047_handy_cerebro', alreadyApplied: true }));
  } else {
    const snapshot = async () => {
      const entries = [];
      for (const t of tables) {
        const result = await c.query(
          `select count(*)::int count,md5(coalesce(string_agg(row_to_json(t)::text,',' order by row_to_json(t)::text),'')) signature from ${t} t`,
        );
        entries.push([t, result.rows[0]]);
      }
      return Object.fromEntries(entries);
    };
    const before = await snapshot();
    const migration = await readFile(
      new URL('../../apps/server/drizzle/0047_handy_cerebro.sql', import.meta.url),
      'utf8',
    );
    for (const statement of migration.split('--> statement-breakpoint'))
      if (statement.trim()) await c.query(statement);
    const after = await snapshot();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Preserved data changed');
    const receipt = {
      schema,
      migration: '0047_handy_cerebro',
      activeJobs: active,
      counts: Object.fromEntries(tables.map((t) => [t, after[t].count])),
      preservedDataIdentical: true,
      appliedAt: new Date().toISOString(),
    };
    await c.query('COMMIT');
    await writeFile('/tmp/inwit-streaming-local-migration.json', JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  }
} catch (e) {
  await c.query('ROLLBACK');
  throw e;
} finally {
  await c.end();
}
