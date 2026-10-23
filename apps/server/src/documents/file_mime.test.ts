import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIME_BY_FORMAT } from '@inwit/dto';
import { documents } from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedDocument, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';

const DOCX_MIME = MIME_BY_FORMAT.docx;
const SHORT_MIME = 'application/pdf';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

describeDb('documents.file_mime', () => {
  let iso: IsolatedDb;

  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });

  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('inserts the 71-character docx MIME and still reads a short MIME', async () => {
    expect(DOCX_MIME).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(DOCX_MIME.length).toBe(71);

    const length = await iso.db.execute(sql`
      SELECT character_maximum_length AS length
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'documents'
        AND column_name = 'file_mime'
    `);
    const columnLength = Number((length.rows[0] as { length: number | string } | undefined)?.length);
    expect(columnLength).toBeGreaterThanOrEqual(255);

    const userId = await seedUser(iso.db);
    const docxId = await seedDocument(iso.db, userId, { title: 'docx', fileMime: DOCX_MIME });
    const shortId = await seedDocument(iso.db, userId, { title: 'pdf', fileMime: SHORT_MIME });

    const [docx] = await iso.db
      .select({ fileMime: documents.fileMime })
      .from(documents)
      .where(eq(documents.id, docxId));
    const [short] = await iso.db
      .select({ fileMime: documents.fileMime })
      .from(documents)
      .where(eq(documents.id, shortId));

    expect(docx?.fileMime).toBe(DOCX_MIME);
    expect(short?.fileMime).toBe(SHORT_MIME);
  });
});
