import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cardKnowledgeLinks,
  cards,
  conceptBatches,
  conceptEvidence,
  conceptNotes,
  conceptRelations,
  concepts,
  documentKnowledgeRefs,
  documents,
  reviewLogs,
  topics,
} from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { contentJsonFromBlocks, seedCard, seedDocument, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { relationIdentityHash } from './concept-identity.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

async function seedConcept(
  db: IsolatedDb['db'],
  input: { userId: string; topicId: string; name: string },
): Promise<string> {
  const [row] = await db
    .insert(concepts)
    .values({
      userId: input.userId,
      topicId: input.topicId,
      name: input.name,
      normalizedName: input.name.toLowerCase(),
      origin: 'manual',
    })
    .returning({ id: concepts.id });
  return row!.id;
}

describeDb('concept schema 约束（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('复合外键拒绝跨用户/跨主题端点', async () => {
    const db = iso.db;
    const userA = await seedUser(db);
    const userB = await seedUser(db);
    const topicA = await seedTopic(db, userA);
    const topicB = await seedTopic(db, userB);
    const a1 = await seedConcept(db, { userId: userA, topicId: topicA, name: 'A1' });
    const b1 = await seedConcept(db, { userId: userB, topicId: topicB, name: 'B1' });

    const base = {
      kind: 'other' as const,
      predicate: '关联',
      normalizedPredicate: '关联',
      origin: 'manual' as const,
      basis: 'user' as const,
      identityHash: 'x'.repeat(64),
    };
    // 跨用户端点
    await expect(
      db.insert(conceptRelations).values({
        ...base,
        userId: userA,
        topicId: topicA,
        fromConceptId: a1,
        toConceptId: b1,
      }),
    ).rejects.toThrow();
    // 同用户跨主题端点
    const topicA2 = await seedTopic(db, userA, { title: '另一主题' });
    const a2 = await seedConcept(db, { userId: userA, topicId: topicA2, name: 'A2' });
    await expect(
      db.insert(conceptRelations).values({
        ...base,
        userId: userA,
        topicId: topicA,
        fromConceptId: a1,
        toConceptId: a2,
      }),
    ).rejects.toThrow();
  });

  it('自环被 CHECK 拒绝；活动 identityHash 唯一，归档后可重建', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const a = await seedConcept(db, { userId, topicId, name: 'A' });
    const b = await seedConcept(db, { userId, topicId, name: 'B' });

    await expect(
      db.insert(conceptRelations).values({
        userId,
        topicId,
        fromConceptId: a,
        toConceptId: a,
        kind: 'other',
        predicate: '自己',
        normalizedPredicate: '自己',
        origin: 'manual',
        basis: 'user',
        identityHash: 'y'.repeat(64),
      }),
    ).rejects.toThrow();

    const hash = relationIdentityHash({
      userId,
      topicId,
      fromConceptId: a,
      toConceptId: b,
      kind: 'composition',
      predicate: '包含',
      context: null,
    });
    const [first] = await db
      .insert(conceptRelations)
      .values({
        userId,
        topicId,
        fromConceptId: a,
        toConceptId: b,
        kind: 'composition',
        predicate: '包含',
        normalizedPredicate: '包含',
        origin: 'manual',
        basis: 'explicit',
        identityHash: hash,
      })
      .returning();
    // 活动重复拒绝
    await expect(
      db.insert(conceptRelations).values({
        userId,
        topicId,
        fromConceptId: a,
        toConceptId: b,
        kind: 'composition',
        predicate: '包含',
        normalizedPredicate: '包含',
        origin: 'manual',
        basis: 'explicit',
        identityHash: hash,
      }),
    ).rejects.toThrow();
    // 归档后允许同名新关系（有效关系唯一只约束活动行）
    await db
      .update(conceptRelations)
      .set({ archivedAt: new Date() })
      .where(eq(conceptRelations.id, first!.id));
    await db.insert(conceptRelations).values({
      userId,
      topicId,
      fromConceptId: a,
      toConceptId: b,
      kind: 'composition',
      predicate: '包含',
      normalizedPredicate: '包含',
      origin: 'manual',
      basis: 'explicit',
      identityHash: hash,
    });
  });

  it('证据/说明/本文引用/卡片导航的目标恰一非空', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const conceptId = await seedConcept(db, { userId, topicId, name: 'C' });
    const documentId = await seedDocument(db, userId);
    const cardId = await seedCard(db, userId, { documentId });

    const evidenceBase = {
      userId,
      documentId,
      documentHash: 'h'.repeat(64),
      quote: '引文',
      locator: { kind: 'quote' as const, quote: '引文' },
      basis: 'explicit' as const,
      evidenceHash: 'e'.repeat(64),
    };
    // 两者都空 → 拒绝
    await expect(
      db.insert(conceptEvidence).values({ ...evidenceBase, conceptId: null, relationId: null }),
    ).rejects.toThrow();
    await expect(
      db.insert(conceptNotes).values({
        userId,
        topicId,
        conceptId: null,
        relationId: null,
        text: '说明',
        basis: 'user',
        createdBy: 'manual',
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(documentKnowledgeRefs).values({
        userId,
        topicId,
        documentId,
        conceptId: null,
        relationId: null,
        origin: 'manual',
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(cardKnowledgeLinks).values({
        userId,
        topicId,
        cardId,
        conceptId: null,
        relationId: null,
      }),
    ).rejects.toThrow();

    // 本文引用：同文章同目标有效引用唯一；移除后可重新引用
    await db.insert(documentKnowledgeRefs).values({
      userId,
      topicId,
      documentId,
      conceptId,
      relationId: null,
      origin: 'manual',
    });
    await expect(
      db.insert(documentKnowledgeRefs).values({
        userId,
        topicId,
        documentId,
        conceptId,
        relationId: null,
        origin: 'manual',
      }),
    ).rejects.toThrow();

    // 卡片导航：同卡同目标唯一
    await db.insert(cardKnowledgeLinks).values({ userId, topicId, cardId, conceptId });
    await expect(
      db.insert(cardKnowledgeLinks).values({ userId, topicId, cardId, conceptId }),
    ).rejects.toThrow();
  });

  it('文档硬删除后证据 documentId 置空、批次 documentId 置空，摘录保留', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const conceptId = await seedConcept(db, { userId, topicId, name: 'D' });
    const documentId = await seedDocument(db, userId, { topicId });

    const [evidence] = await db
      .insert(conceptEvidence)
      .values({
        userId,
        conceptId,
        documentId,
        documentTitleSnapshot: '测试文档',
        documentHash: 'f'.repeat(64),
        quote: '保留的摘录',
        locator: { kind: 'quote', quote: '保留的摘录' },
        basis: 'explicit',
        evidenceHash: 'g'.repeat(64),
      })
      .returning();
    const [batch] = await db
      .insert(conceptBatches)
      .values({
        userId,
        topicId,
        documentId,
        documentHash: 'f'.repeat(64),
        status: 'ready',
      })
      .returning();

    await db.delete(documents).where(eq(documents.id, documentId));

    const [evidenceAfter] = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.id, evidence!.id));
    expect(evidenceAfter!.documentId).toBeNull();
    expect(evidenceAfter!.quote).toBe('保留的摘录');
    expect(evidenceAfter!.documentTitleSnapshot).toBe('测试文档');

    const [batchAfter] = await db
      .select()
      .from(conceptBatches)
      .where(eq(conceptBatches.id, batch!.id));
    expect(batchAfter!.documentId).toBeNull();
  });

  it('迁移后旧卡片与旧复习日志保持兼容（新列全为 null）', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const documentId = await seedDocument(db, userId);
    const cardId = await seedCard(db, userId, { documentId });

    const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
    expect(card!.reviewRevision).toBeNull();

    const [log] = await db
      .insert(reviewLogs)
      .values({ userId, cardId, feedback: 'remembered' })
      .returning();
    expect(log!.bindingId).toBeNull();
    expect(log!.epochId).toBeNull();
    expect(log!.targetVersion).toBeNull();
    expect(log!.questionId).toBeNull();
    expect(log!.reviewRevision).toBeNull();

    // 主题新增图版本默认 1
    const topicId = await seedTopic(db, userId);
    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic!.conceptGraphRevision).toBe(1);
  });

  it('旧卡片行形状不变（contentJson/题目照常）', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const documentId = await seedDocument(db, userId, {
      blocks: ['第一段', null, '第二页内容'],
    });
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(document!.contentJson).toEqual(contentJsonFromBlocks(['第一段', null, '第二页内容']));
  });
});
