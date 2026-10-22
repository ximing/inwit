import type { ConceptDraft } from '@inwit/dto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conceptBatches, documents } from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { contentJsonFromBlocks, seedDocument, seedReadyConceptBatch, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import {
  createConceptBatch,
  discardConceptBatch,
  getConceptBatch,
  updateConceptDraft,
} from './concept-batch.service.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

const simpleDraft: ConceptDraft = {
  schemaVersion: 1,
  concepts: [
    {
      tempId: 'c1',
      name: 'Task',
      aliases: [],
      sense: null,
      definition: '实验中的任务',
      example: null,
      basis: 'explicit',
      evidence: [],
      matchCandidates: [],
    },
  ],
  relations: [],
};

describeDb('concept-batch.service（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('生成入口（M2 接通）：创建批次并入队', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId, blocks: ['Task 是单位。'] });
    const created = await createConceptBatch(userId, documentId, {
      topicId,
      scope: 'document',
      requestId: 'gen-1',
    });
    expect(created.batchId).toBeTruthy();
    expect(created.jobId).toBeTruthy();
    const [batch] = await db.select().from(conceptBatches).where(eq(conceptBatches.id, created.batchId));
    expect(batch!.status).toBe('queued');
    expect(batch!.contentSnapshot!.hash).toBeTruthy();
    expect(batch!.jobId).toBe(created.jobId);
  });

  it('ready 批次读取；小改动仍可用，大改或软删除来源才过期', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId, blocks: ['原文一段。'] });
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft: simpleDraft });

    const fresh = await getConceptBatch(userId, batchId);
    expect(fresh.status).toBe('ready');
    expect(fresh.stale).toBe(false);
    expect(fresh.draftRevision).toBe(1);

    await db
      .update(documents)
      .set({ contentJson: contentJsonFromBlocks(['原文被修改了。']) })
      .where(eq(documents.id, documentId));
    const edited = await getConceptBatch(userId, batchId);
    expect(edited.stale).toBe(false);
    expect(edited.status).toBe('ready');

    const rewritten = `另一篇文章。${'完全不同的内容。'.repeat(80)}`;
    await db
      .update(documents)
      .set({ contentJson: contentJsonFromBlocks([rewritten]) })
      .where(eq(documents.id, documentId));
    const stale = await getConceptBatch(userId, batchId);
    expect(stale.stale).toBe(true);
    expect(stale.status).toBe('ready');

    // 标题变化不影响
    const otherDoc = await seedDocument(db, userId, { topicId, title: '原标题', blocks: ['正文。'] });
    const otherBatch = await seedReadyConceptBatch(db, {
      userId,
      topicId,
      documentId: otherDoc,
      draft: simpleDraft,
    });
    await db.update(documents).set({ title: '新标题' }).where(eq(documents.id, otherDoc));
    expect((await getConceptBatch(userId, otherBatch)).stale).toBe(false);

    // 软删除来源
    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, otherDoc));
    expect((await getConceptBatch(userId, otherBatch)).stale).toBe(true);
  });

  it('草稿编辑：版本冲突 409；非 ready 拒绝；过期拒绝', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft: simpleDraft });

    const edited = await updateConceptDraft(userId, batchId, {
      expectedDraftRevision: 1,
      draft: {
        ...simpleDraft,
        concepts: [{ ...simpleDraft.concepts[0]!, name: 'Task（编辑过）' }],
      },
    });
    expect(edited.draftRevision).toBe(2);
    expect(edited.draft?.concepts[0]?.name).toBe('Task（编辑过）');

    await expect(
      updateConceptDraft(userId, batchId, { expectedDraftRevision: 1, draft: simpleDraft }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_BATCH_CONFLICT' });

    const queuedBatch = await seedReadyConceptBatch(db, {
      userId,
      topicId,
      documentId,
      draft: simpleDraft,
      status: 'queued',
    });
    await expect(
      updateConceptDraft(userId, queuedBatch, { expectedDraftRevision: 1, draft: simpleDraft }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_BATCH_NOT_READY' });
  });

  it('discard：ready → discarded；重复丢弃拒绝；discarded 后不能编辑', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft: simpleDraft });

    const discarded = await discardConceptBatch(userId, batchId);
    expect(discarded.status).toBe('discarded');
    // 不删除正式内容（draft 仍保留供查看）
    expect(discarded.draft).not.toBeNull();

    await expect(discardConceptBatch(userId, batchId)).rejects.toMatchObject({
      status: 409,
      code: 'CONCEPT_BATCH_NOT_READY',
    });
    await expect(
      updateConceptDraft(userId, batchId, { expectedDraftRevision: 1, draft: simpleDraft }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_BATCH_NOT_READY' });
  });

  it('跨用户读取批次返回 404', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const otherUser = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft: simpleDraft });
    await expect(getConceptBatch(otherUser, batchId)).rejects.toMatchObject({
      status: 404,
      code: 'CONCEPT_BATCH_NOT_FOUND',
    });
  });
});
