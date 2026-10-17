import { REVIEW_PROTOCOL_CURRENT } from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cards,
  conceptEvidence,
  conceptNotes,
  conceptPracticeBindings,
  concepts,
  documentKnowledgeRefs,
  documents,
  reviewLogs,
  reviewStates,
  syncChanges,
} from '../db/schema.js';
import { archiveDocument, destroyDocument } from '../documents/document.service.js';
import { getReviewToday, submitReviewFeedback } from '../review/review.service.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedCard, seedDocument, seedReviewState, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { archiveTopic, deleteTopic } from '../topics/topic.service.js';
import { createConceptBatch } from './concept-batch.service.js';
import { resolveConceptEvidence } from './concept-evidence.js';
import { createConceptPractice, refreshConceptPractice } from './concept-practice.service.js';
import { createConcept } from './concept.service.js';
import { createConceptNote, setDocumentKnowledgeRef } from './document-knowledge.service.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

const DEFINITION = '共享定义在来源文档删除后必须原样保留';

async function makeDue(iso: IsolatedDb, cardId: string): Promise<void> {
  await iso.db
    .update(reviewStates)
    .set({ dueAt: new Date(Date.now() - 1000) })
    .where(eq(reviewStates.cardId, cardId));
}

describeDb('概念生命周期（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('软删来源文档后概念与摘录还在，出处解析为不可用且不跳到别的句子', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const quote = '软删摘录：Trial 仍是一次尝试。';
    const sourceId = await seedDocument(db, userId, {
      topicId,
      title: '来源文档',
      blocks: [quote, '另一句不应被当成出处。'],
    });
    const otherId = await seedDocument(db, userId, {
      topicId,
      title: '另一篇文档',
      blocks: [quote],
    });
    const created = await createConcept(userId, topicId, {
      name: 'Trial',
      aliases: [],
      definition: DEFINITION,
      evidence: [{ documentId: sourceId, locator: { kind: 'block', blockIndex: 1, quote }, basis: 'explicit' }],
    });

    await archiveDocument(userId, sourceId);

    const [concept] = await db.select().from(concepts).where(eq(concepts.id, created.concept.id));
    expect(concept).toBeDefined();
    expect(concept!.definition).toBe(DEFINITION);

    const [evidence] = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.conceptId, created.concept.id));
    expect(evidence).toBeDefined();
    expect(evidence!.quote).toBe(quote);
    expect(evidence!.documentId).toBe(sourceId);

    const resolved = await resolveConceptEvidence(userId, evidence!.id);
    expect(resolved.status).toBe('unavailable');
    if (resolved.status !== 'unavailable') return;
    expect(resolved.quote).toBe(quote);
    expect(resolved.documentId).toBe(sourceId);
    expect(resolved.documentId).not.toBe(otherId);
    expect(resolved).not.toHaveProperty('blockIndex');
  });

  it('硬删来源文档后概念与摘录还在，证据 documentId 为空，不跳到另一篇文档', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const quote = '硬删摘录：概念定义不跟着文档走。';
    const sourceId = await seedDocument(db, userId, {
      topicId,
      title: '将被硬删的文档',
      blocks: [quote],
    });
    const otherId = await seedDocument(db, userId, {
      topicId,
      title: '保留的文档',
      blocks: [quote],
    });
    const created = await createConcept(userId, topicId, {
      name: 'Retention',
      aliases: [],
      definition: DEFINITION,
      evidence: [{ documentId: sourceId, locator: { kind: 'quote', quote }, basis: 'explicit' }],
    });
    await setDocumentKnowledgeRef(userId, sourceId, {
      topicId,
      targetKind: 'concept',
      targetId: created.concept.id,
      requestId: 'life-ref-source',
    });
    await setDocumentKnowledgeRef(userId, otherId, {
      topicId,
      targetKind: 'concept',
      targetId: created.concept.id,
      requestId: 'life-ref-other',
    });
    await createConceptNote(userId, {
      targetKind: 'concept',
      targetId: created.concept.id,
      documentId: sourceId,
      text: '只属于被删文档的说明',
    });
    const keptNote = await createConceptNote(userId, {
      targetKind: 'concept',
      targetId: created.concept.id,
      documentId: otherId,
      text: '另一篇文档上的说明应留下',
    });

    await destroyDocument(userId, sourceId);

    const [concept] = await db.select().from(concepts).where(eq(concepts.id, created.concept.id));
    expect(concept).toBeDefined();
    expect(concept!.definition).toBe(DEFINITION);

    const [evidence] = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.conceptId, created.concept.id));
    expect(evidence).toBeDefined();
    expect(evidence!.quote).toBe(quote);
    expect(evidence!.documentId).toBeNull();

    const resolved = await resolveConceptEvidence(userId, evidence!.id);
    expect(resolved.status).toBe('unavailable');
    if (resolved.status !== 'unavailable') return;
    expect(resolved.quote).toBe(quote);
    expect(resolved.documentId).toBeNull();
    expect(resolved).not.toHaveProperty('blockIndex');

    const refs = await db
      .select()
      .from(documentKnowledgeRefs)
      .where(eq(documentKnowledgeRefs.conceptId, created.concept.id));
    expect(refs.map((row) => row.documentId)).toEqual([otherId]);

    const notes = await db.select().from(conceptNotes).where(eq(conceptNotes.conceptId, created.concept.id));
    expect(notes.map((row) => row.id)).toEqual([keptNote.id]);
    expect(notes[0]!.documentId).toBe(otherId);

    const [source] = await db.select().from(documents).where(eq(documents.id, sourceId));
    expect(source).toBeUndefined();
  });

  it('归档主题后受管理卡离开协议 2 队列，普通卡仍在，且不能再创建概念', async () => {
    expect(REVIEW_PROTOCOL_CURRENT).toBe(2);
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId, blocks: ['可用于生成批次的正文。'] });
    const created = await createConcept(userId, topicId, { name: 'Queue', aliases: [], evidence: [] });
    const practice = await createConceptPractice(userId, {
      targetKind: 'concept',
      targetId: created.concept.id,
      expectedVersion: created.concept.version,
      exerciseKind: 'recall',
      question: '什么是 Queue？',
      answer: '队列',
      requestId: 'life-arch-practice',
    });
    await makeDue(iso, practice.cardId);
    const plainCardId = await seedCard(db, userId, { topicId, concept: '普通卡' });
    await seedReviewState(db, userId, plainCardId, { dueAt: new Date(Date.now() - 1000) });

    const [cardBefore] = await db.select().from(cards).where(eq(cards.id, practice.cardId));
    const revisionBefore = cardBefore!.reviewRevision;
    expect(revisionBefore).not.toBeNull();

    const before = await getReviewToday(userId, new Date(), REVIEW_PROTOCOL_CURRENT);
    expect(before.items.map((item) => item.card.id)).toEqual(expect.arrayContaining([practice.cardId, plainCardId]));

    await archiveTopic(userId, topicId);

    const [binding] = await db
      .select()
      .from(conceptPracticeBindings)
      .where(eq(conceptPracticeBindings.id, practice.binding.id));
    expect(binding!.resumeRequired).toBe(true);
    expect(binding!.endedAt).toBeNull();

    const [state] = await db.select().from(reviewStates).where(eq(reviewStates.cardId, practice.cardId));
    expect(state!.suspendedAt).toBeNull();

    const [cardAfter] = await db.select().from(cards).where(eq(cards.id, practice.cardId));
    expect(cardAfter!.reviewRevision).toBe(revisionBefore! + 1);

    const after = await getReviewToday(userId, new Date(), REVIEW_PROTOCOL_CURRENT);
    const afterIds = after.items.map((item) => item.card.id);
    expect(afterIds).not.toContain(practice.cardId);
    expect(afterIds).toContain(plainCardId);

    await expect(
      createConcept(userId, topicId, { name: '不应写入', aliases: [], evidence: [] }),
    ).rejects.toMatchObject({ status: 409, code: 'TOPIC_ARCHIVED' });
    await expect(
      createConceptBatch(userId, documentId, {
        topicId,
        scope: 'document',
        requestId: 'life-arch-batch',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'TOPIC_ARCHIVED' });

    const again = await getReviewToday(userId, new Date(), REVIEW_PROTOCOL_CURRENT);
    const againIds = again.items.map((item) => item.card.id);
    expect(againIds).not.toContain(practice.cardId);
    expect(againIds).toContain(plainCardId);
  });

  it('归档前签发的复习令牌在归档后被拒绝，普通卡不带令牌的反馈仍成功', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const created = await createConcept(userId, topicId, { name: 'Token', aliases: [], evidence: [] });
    const practice = await createConceptPractice(userId, {
      targetKind: 'concept',
      targetId: created.concept.id,
      expectedVersion: created.concept.version,
      exerciseKind: 'recall',
      question: '什么是 Token？',
      answer: '令牌',
      requestId: 'life-token-practice',
    });
    await makeDue(iso, practice.cardId);
    const plainCardId = await seedCard(db, userId, { topicId, concept: '普通反馈卡' });

    const queue = await getReviewToday(userId, new Date(), REVIEW_PROTOCOL_CURRENT);
    const item = queue.items.find((entry) => entry.card.id === practice.cardId);
    expect(item?.reviewToken).toBeTruthy();

    await archiveTopic(userId, topicId);

    const logsBefore = await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, practice.cardId));
    const archivedToken = item?.reviewToken;
    if (!archivedToken) throw new Error('missing review token');
    await expect(
      submitReviewFeedback(userId, practice.cardId, 'remembered', new Date(), {
        reviewToken: archivedToken,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'REVIEW_CONTENT_CHANGED' });
    const logsAfter = await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, practice.cardId));
    expect(logsAfter).toHaveLength(logsBefore.length);

    const plain = await submitReviewFeedback(userId, plainCardId, 'remembered');
    expect(plain.log.cardId).toBe(plainCardId);
    expect(plain.log.reviewRevision ?? null).toBeNull();
    expect(plain.log.bindingId ?? null).toBeNull();
  });

  it('refresh 后旧令牌被拒绝，新队列令牌可提交且同一 requestId 不重复记分', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const created = await createConcept(userId, topicId, { name: 'Refresh', aliases: [], evidence: [] });
    const practice = await createConceptPractice(userId, {
      targetKind: 'concept',
      targetId: created.concept.id,
      expectedVersion: created.concept.version,
      exerciseKind: 'recall',
      question: '刷新前的题面',
      answer: '旧答案',
      requestId: 'life-refresh-practice',
    });
    await makeDue(iso, practice.cardId);

    const queue = await getReviewToday(userId, new Date(), REVIEW_PROTOCOL_CURRENT);
    const oldToken = queue.items.find((entry) => entry.card.id === practice.cardId)?.reviewToken;
    if (!oldToken) throw new Error('missing review token');

    const [cardBefore] = await db.select().from(cards).where(eq(cards.id, practice.cardId));
    await refreshConceptPractice(userId, practice.binding.id, {
      questionId: practice.binding.questionId,
      expectedTargetVersion: created.concept.version,
      expectedReviewRevision: cardBefore!.reviewRevision!,
      question: '刷新后的题面',
      answer: '新答案',
    });

    await expect(
      submitReviewFeedback(userId, practice.cardId, 'remembered', new Date(), { reviewToken: oldToken }),
    ).rejects.toMatchObject({ status: 409, code: 'REVIEW_CONTENT_CHANGED' });

    // refresh 把到期重置到明天；拨回过去，协议 2 队列才会再次下发新令牌。
    await makeDue(iso, practice.cardId);
    const next = await getReviewToday(userId, new Date(), REVIEW_PROTOCOL_CURRENT);
    const newToken = next.items.find((entry) => entry.card.id === practice.cardId)?.reviewToken;
    if (!newToken) throw new Error('missing review token');
    expect(newToken).not.toBe(oldToken);

    const requestId = 'life-refresh-feedback';
    const first = await submitReviewFeedback(userId, practice.cardId, 'remembered', new Date(), {
      reviewToken: newToken,
      requestId,
    });
    const replay = await submitReviewFeedback(userId, practice.cardId, 'remembered', new Date(), {
      reviewToken: newToken,
      requestId,
    });
    expect(replay.log.id).toBe(first.log.id);
    const logs = await db
      .select()
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.cardId, practice.cardId)));
    expect(logs).toHaveLength(1);
  });

  it('删除主题清理概念、绑定和本文引用，保留练习卡、复习日志、文档与其他主题', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId, { title: '将被删除的主题' });
    const otherTopicId = await seedTopic(db, userId, { title: '保留的主题' });
    const created = await createConcept(userId, topicId, { name: 'Gone', aliases: [], evidence: [] });
    const other = await createConcept(userId, otherTopicId, { name: 'Stays', aliases: [], evidence: [] });
    const documentId = await seedDocument(db, userId, { topicId, blocks: ['本文仍然要留下。'] });
    await setDocumentKnowledgeRef(userId, documentId, {
      topicId,
      targetKind: 'concept',
      targetId: created.concept.id,
      requestId: 'life-delete-ref',
    });
    const practice = await createConceptPractice(userId, {
      targetKind: 'concept',
      targetId: created.concept.id,
      expectedVersion: created.concept.version,
      exerciseKind: 'recall',
      question: '什么是 Gone？',
      answer: '会随主题清理的概念',
      requestId: 'life-delete-practice',
    });
    await makeDue(iso, practice.cardId);
    const queue = await getReviewToday(userId, new Date(), REVIEW_PROTOCOL_CURRENT);
    const token = queue.items.find((entry) => entry.card.id === practice.cardId)?.reviewToken;
    if (!token) throw new Error('missing review token');
    const feedback = await submitReviewFeedback(userId, practice.cardId, 'remembered', new Date(), {
      reviewToken: token,
      requestId: 'life-delete-feedback',
    });

    await deleteTopic(userId, topicId);

    const goneConcepts = await db.select().from(concepts).where(eq(concepts.id, created.concept.id));
    expect(goneConcepts).toHaveLength(0);
    const [keptConcept] = await db.select().from(concepts).where(eq(concepts.id, other.concept.id));
    expect(keptConcept).toBeDefined();
    expect(keptConcept!.topicId).toBe(otherTopicId);

    const bindings = await db
      .select()
      .from(conceptPracticeBindings)
      .where(eq(conceptPracticeBindings.userId, userId));
    expect(bindings).toHaveLength(0);

    const refs = await db
      .select()
      .from(documentKnowledgeRefs)
      .where(eq(documentKnowledgeRefs.documentId, documentId));
    expect(refs).toHaveLength(0);

    const [card] = await db.select().from(cards).where(eq(cards.id, practice.cardId));
    expect(card).toBeDefined();
    expect(card!.topicId).toBeNull();
    expect(card!.deletedAt).toBeNull();

    const logs = await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, practice.cardId));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.id).toBe(feedback.log.id);
    expect(logs[0]!.bindingId).toBe(practice.binding.id);

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(document).toBeDefined();
    expect(document!.deletedAt).toBeNull();
    expect(document!.topicId).toBeNull();
  });

  it('sync_changes 的 concept 行不携带定义或摘录，其他用户也看不到', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const otherUserId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const definition = '同步事件不得出现的定义正文';
    const quote = '同步事件不得出现的摘录正文';
    const documentId = await seedDocument(db, userId, { topicId, blocks: [quote] });
    const created = await createConcept(userId, topicId, {
      name: 'SyncLeak',
      aliases: [],
      definition,
      evidence: [{ documentId, locator: { kind: 'quote', quote }, basis: 'user' }],
    });
    expect(created.concept.definition).toBe(definition);

    const rows = await db
      .select()
      .from(syncChanges)
      .where(and(eq(syncChanges.userId, userId), eq(syncChanges.scope, 'concept')));
    expect(rows.length).toBeGreaterThan(0);
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(definition);
    expect(blob).not.toContain(quote);

    const foreign = await db
      .select()
      .from(syncChanges)
      .where(and(eq(syncChanges.userId, otherUserId), eq(syncChanges.scope, 'concept')));
    expect(foreign).toHaveLength(0);
  });
});
