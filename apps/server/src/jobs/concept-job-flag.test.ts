import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import {
  conceptBatches,
  conceptPracticeProposals,
  concepts,
  documents,
  jobs,
} from '../db/schema.js';
import { createConceptBatch } from '../concepts/concept-batch.service.js';
import { processDueJobs } from './queue.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedDocument, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

type ConceptFlags = {
  CONCEPTS_ENABLED: boolean;
  CONCEPTS_READ_ENABLED: boolean | undefined;
  CONCEPTS_WRITE_ENABLED: boolean | undefined;
  WORKER_CLAIM_LIMIT: number;
};

function flags(): ConceptFlags {
  return config as ConceptFlags;
}

function setConceptFlags(
  enabled: boolean,
  read: boolean | undefined,
  write: boolean | undefined,
): void {
  const current = flags();
  current.CONCEPTS_ENABLED = enabled;
  current.CONCEPTS_READ_ENABLED = read;
  current.CONCEPTS_WRITE_ENABLED = write;
}

/**
 * 隔离 schema 与其他文件共享。只把目标任务的 runAt 拨到纪元，并用同样早的 now 认领，
 * 这样 processDueJobs 不会捞到别的用例留下的 pending 任务（那些任务一跑就会打到外部服务）。
 */
async function claimAncientJob(): Promise<number> {
  const previous = flags().WORKER_CLAIM_LIMIT;
  flags().WORKER_CLAIM_LIMIT = 1;
  try {
    return await processDueJobs(new Date(1000));
  } finally {
    flags().WORKER_CLAIM_LIMIT = previous;
  }
}

async function waitFor<T>(label: string, read: () => Promise<T | undefined>, done: (value: T) => boolean) {
  const deadline = Date.now() + 5_000;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (last !== undefined && done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

describeDb('concept job flag（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
    setConceptFlags(true, undefined, undefined);
  });
  afterAll(async () => {
    setConceptFlags(true, undefined, undefined);
    await teardownIsolatedDb(iso);
  });
  afterEach(() => {
    setConceptFlags(true, undefined, undefined);
  });

  it('写开关关闭时 concept_extract 失败且不写概念，未来的非概念任务保持 pending', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId, blocks: ['Task 是单位。'] });
    setConceptFlags(true, undefined, undefined);
    const created = await createConceptBatch(userId, documentId, {
      topicId,
      scope: 'document',
      requestId: 'flag-job-extract',
    });
    await db.update(jobs).set({ runAt: new Date(0) }).where(eq(jobs.id, created.jobId));
    const [digest] = await db
      .insert(jobs)
      .values({
        userId,
        type: 'digest',
        status: 'pending',
        payload: { documentId },
        runAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning({ id: jobs.id });
    if (!digest) throw new Error('digest job insert failed');

    setConceptFlags(true, undefined, false);
    expect(await claimAncientJob()).toBe(1);

    const job = await waitFor(
      'extract job',
      async () => (await db.select().from(jobs).where(eq(jobs.id, created.jobId)).limit(1))[0],
      (row) => row.status === 'failed',
    );
    expect(job.lastError).toContain('concepts_disabled');
    expect(job.finishedAt).toBeTruthy();

    const batch = await waitFor(
      'extract batch',
      async () =>
        (await db.select().from(conceptBatches).where(eq(conceptBatches.id, created.batchId)).limit(1))[0],
      (row) => row.status === 'failed' && row.errorCode === 'concepts_disabled',
    );
    expect(batch.status).toBe('failed');
    expect(batch.errorCode).toBe('concepts_disabled');
    expect(await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.userId, userId))).toEqual(
      [],
    );

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    expect(document?.status).toBe('digested');

    const [left] = await db.select().from(jobs).where(eq(jobs.id, digest.id)).limit(1);
    expect(left?.status).toBe('pending');
    expect(left?.lastError).toBeNull();
  });

  it('写开关关闭时 concept_practice 失败且不写题目', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const [concept] = await db
      .insert(concepts)
      .values({
        userId,
        topicId,
        name: 'Task',
        normalizedName: 'task',
        origin: 'manual',
      })
      .returning({ id: concepts.id });
    if (!concept) throw new Error('concept insert failed');
    const [job] = await db
      .insert(jobs)
      .values({
        userId,
        type: 'concept_practice',
        status: 'pending',
        payload: {},
        runAt: new Date(0),
      })
      .returning({ id: jobs.id });
    if (!job) throw new Error('practice job insert failed');
    const [proposal] = await db
      .insert(conceptPracticeProposals)
      .values({
        userId,
        topicId,
        conceptId: concept.id,
        targetVersion: 1,
        exerciseKind: 'recall',
        jobId: job.id,
        status: 'queued',
      })
      .returning({ id: conceptPracticeProposals.id });
    if (!proposal) throw new Error('proposal insert failed');

    setConceptFlags(true, undefined, false);
    expect(await claimAncientJob()).toBe(1);

    const settled = await waitFor(
      'practice job',
      async () => (await db.select().from(jobs).where(eq(jobs.id, job.id)).limit(1))[0],
      (row) => row.status === 'failed',
    );
    expect(settled.lastError).toContain('concepts_disabled');
    expect(settled.finishedAt).toBeTruthy();

    const stored = await waitFor(
      'practice proposal',
      async () =>
        (
          await db
            .select()
            .from(conceptPracticeProposals)
            .where(eq(conceptPracticeProposals.id, proposal.id))
            .limit(1)
        )[0],
      (row) => row.status === 'failed' && row.errorCode === 'concepts_disabled',
    );
    expect(stored.question).toBeNull();
    expect(
      await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.userId, userId)),
    ).toHaveLength(1);
  });
});
