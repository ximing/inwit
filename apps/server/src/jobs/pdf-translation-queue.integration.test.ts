import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { isolatedDbContext } from '../testkit/context.js';
import { createIsolatedDb, closeIsolatedDb, dropIsolatedDb } from '../testkit/isolated-db.js';
import { setDb } from '../db/index.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { seedUser } from '../testkit/fixtures.js';
import { documents, pdfSegments, pdfTranslationJobs, jobs } from '../db/schema.js';
import { saveTranslationSettings } from '../llm/translation-settings.service.js';
import { requestSegmentTranslation } from '../documents/translation/translation.service.js';
const execution = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('./processors.js', () => ({ processJob: execution.handler }));
import { processDueJobs, claimDueJobs, drainJobs } from './queue.js';
import { recoverPdfTranslationCarriers } from './pdf-translation-lifecycle.js';
const ctx = isolatedDbContext();
describe.skipIf(!ctx.available)('expired PDF worker cannot settle a new carrier attempt', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await createIsolatedDb('translation_queue');
    setDb(iso.db);
  });
  afterAll(async () => {
    setDb(null);
    await closeIsolatedDb(iso);
    await dropIsolatedDb(iso.schemaName);
  });
  it('ignores both stale normal return and stale exception after recovery/new claim', async () => {
    const userId = await seedUser(iso.db);
    await saveTranslationSettings(userId, {
      provider: 'openai',
      model: 'test',
      apiKey: 'local-only',
    });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [doc] = await iso.db
        .insert(documents)
        .values({
          userId,
          source: 'import',
          fileKey: 'local.pdf',
          fileMime: 'application/pdf',
          fileRevision: 'r',
        })
        .returning();
      const segmentId = randomUUID();
      await iso.db
        .insert(pdfSegments)
        .values({
          id: segmentId,
          userId,
          documentId: doc!.id,
          fileRevision: 'r',
          parserVersion: 'test',
          pageIndex: 0,
          ordinal: 0,
          sourceText: 'English paragraph',
          textHash: 'hash',
          rects: [],
          qualityState: 'reliable',
        });
      const r = await requestSegmentTranslation(userId, doc!.id, {
        segmentId,
        fileRevision: 'r',
        idempotencyKey: randomUUID(),
      });
      ids.push(r.job!.id);
    }
    const waiting: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    execution.handler.mockImplementation(
      () => new Promise<void>((resolve, reject) => waiting.push({ resolve, reject })),
    );
    expect(await processDueJobs()).toBe(2);
    expect(waiting).toHaveLength(2);
    const business = await iso.db
      .select()
      .from(pdfTranslationJobs)
      .where(inArray(pdfTranslationJobs.id, ids));
    const carrierIds = business.map((b) => b.jobId);
    const old = new Date(0);
    await iso.db
      .update(pdfTranslationJobs)
      .set({ state: 'preparing', executionToken: randomUUID(), leaseUntil: old })
      .where(inArray(pdfTranslationJobs.id, ids));
    await iso.db.update(jobs).set({ updatedAt: old }).where(inArray(jobs.id, carrierIds));
    await recoverPdfTranslationCarriers(new Date(), new Date());
    const claimed = await claimDueJobs();
    expect(claimed).toHaveLength(2);
    expect(claimed.every((j) => j.attempts === 2)).toBe(true);
    waiting[0]!.resolve();
    waiting[1]!.reject(new Error('late worker exception must not end new task'));
    await drainJobs();
    const carriers = await iso.db.select().from(jobs).where(inArray(jobs.id, carrierIds));
    expect(carriers.every((j) => j.status === 'running' && j.attempts === 2)).toBe(true);
    const tasks = await iso.db
      .select()
      .from(pdfTranslationJobs)
      .where(inArray(pdfTranslationJobs.id, ids));
    expect(tasks.every((t) => t.state === 'queued')).toBe(true);
  });
});
