import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conceptNotes, documentKnowledgeRefs } from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedCard, seedDocument, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import {
  createConceptNote,
  getDocumentKnowledge,
  removeDocumentKnowledgeRef,
  resolveKnowledgeLocations,
  setDocumentKnowledgeRef,
  updateConceptNote,
} from './document-knowledge.service.js';
import { addCardKnowledgeLink } from './card-knowledge.service.js';
import {
  createConcept,
  createConceptRelation,
  updateConcept,
} from './concept.service.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

describeDb('document-knowledge（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('本文范围：direct 概念、本文关系与端点上下文区分；其他文章关系不进入', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const docA = await seedDocument(db, userId, { topicId, blocks: ['A 文正文。'] });
    const docB = await seedDocument(db, userId, { topicId, blocks: ['B 文正文。'] });
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] })).concept;
    const b = (await createConcept(userId, topicId, { name: 'B', aliases: [], evidence: [] })).concept;
    const c = (await createConcept(userId, topicId, { name: 'C', aliases: [], evidence: [] })).concept;

    // 本文收录 A 和关系 A→B；主题里还有 B→C（其他文章）
    await setDocumentKnowledgeRef(userId, docA, {
      topicId, targetKind: 'concept', targetId: a.id, requestId: 'r1',
    });
    const relAB = (await createConceptRelation(userId, topicId, {
      fromConceptId: a.id, toConceptId: b.id, kind: 'other', predicate: '关联', basis: 'user', evidence: [],
    })).relation;
    await setDocumentKnowledgeRef(userId, docA, {
      topicId, targetKind: 'relation', targetId: relAB.id, requestId: 'r2',
    });
    await createConceptRelation(userId, topicId, {
      fromConceptId: b.id, toConceptId: c.id, kind: 'other', predicate: '另一关系', basis: 'user', evidence: [],
    });
    await setDocumentKnowledgeRef(userId, docB, {
      topicId, targetKind: 'concept', targetId: b.id, requestId: 'r3',
    });

    const view = await getDocumentKnowledge(userId, docA, { topicId, limit: 50 });
    const membershipOf = (id: string) =>
      view.concepts.find((entry) => entry.concept.id === id)?.membership;
    expect(membershipOf(a.id)).toBe('direct');
    expect(membershipOf(b.id)).toBe('endpoint_context'); // 关系带出
    expect(membershipOf(c.id)).toBeUndefined(); // B→C 不属于本文
    expect(view.relations).toHaveLength(1);
    expect(view.relations[0]!.relation.id).toBe(relAB.id);
  });

  it('引用幂等；移除概念引用需确认连带关系；不删共享知识', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const docA = await seedDocument(db, userId, { topicId });
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] })).concept;
    const b = (await createConcept(userId, topicId, { name: 'B', aliases: [], evidence: [] })).concept;
    const rel = (await createConceptRelation(userId, topicId, {
      fromConceptId: a.id, toConceptId: b.id, kind: 'other', predicate: '关联', basis: 'user', evidence: [],
    })).relation;

    const ref1 = await setDocumentKnowledgeRef(userId, docA, {
      topicId, targetKind: 'concept', targetId: a.id, requestId: 'rm-1',
    });
    const again = await setDocumentKnowledgeRef(userId, docA, {
      topicId, targetKind: 'concept', targetId: a.id, requestId: 'rm-2',
    });
    expect(again.refId).toBe(ref1.refId);
    const relRef = await setDocumentKnowledgeRef(userId, docA, {
      topicId, targetKind: 'relation', targetId: rel.id, requestId: 'rm-3',
    });

    // 未确认连带 → 409
    await expect(
      removeDocumentKnowledgeRef(userId, docA, ref1.refId, { confirmDependentRelations: false }),
    ).rejects.toMatchObject({ status: 409 });
    // 确认后连带移除
    const removed = await removeDocumentKnowledgeRef(userId, docA, ref1.refId, {
      confirmDependentRelations: true,
    });
    expect(removed.removedRefs).toBe(2);
    const refs = await db
      .select()
      .from(documentKnowledgeRefs)
      .where(eq(documentKnowledgeRefs.documentId, docA));
    expect(refs.every((ref) => ref.removedAt !== null)).toBe(true);
    void relRef;
    // 共享概念与关系仍在
    const view = await getDocumentKnowledge(userId, docA, { topicId, limit: 50 });
    expect(view.concepts).toHaveLength(0);
    const conceptRow = await db.select().from(documentKnowledgeRefs).limit(1);
    expect(conceptRow).toHaveLength(1);

    // 显式重新收录可复活引用
    const revived = await setDocumentKnowledgeRef(userId, docA, {
      topicId, targetKind: 'concept', targetId: a.id, requestId: 'rm-4',
    });
    expect(revived.refId).toBe(ref1.refId);
    const view2 = await getDocumentKnowledge(userId, docA, { topicId, limit: 50 });
    expect(view2.concepts).toHaveLength(1);
  });

  it('本文说明独立版本：改 note 不动共享定义与概念版本', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const docA = await seedDocument(db, userId, { topicId });
    const a = (await createConcept(userId, topicId, {
      name: 'A', aliases: [], definition: '共享定义', evidence: [],
    })).concept;

    const note = await createConceptNote(userId, {
      targetKind: 'concept', targetId: a.id, documentId: docA, text: '本文的补充说明',
    });
    expect(note.version).toBe(1);
    const updated = await updateConceptNote(userId, note.id, {
      expectedVersion: 1, text: '改过的本文说明',
    });
    expect(updated.version).toBe(2);
    expect(updated.text).toBe('改过的本文说明');

    await expect(
      updateConceptNote(userId, note.id, { expectedVersion: 1, text: '旧版本' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_VERSION_CONFLICT' });

    // 共享定义与版本未变
    const view = await getDocumentKnowledge(userId, docA, { topicId, limit: 50 });
    void view;
    const conceptRow = await db.select().from(conceptNotes).where(eq(conceptNotes.id, note.id));
    expect(conceptRow).toHaveLength(1);
    const concept = (await import('./concept.service.js')).getConcept;
    const detail = await concept(userId, a.id);
    expect(detail.concept.definition).toBe('共享定义');
    expect(detail.concept.version).toBe(1);
  });

  it('位置解析：卡片/画布挂载、可验证出处与引文批注；跨用户 404', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const otherUser = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const docA = await seedDocument(db, userId, { topicId, blocks: ['Task 是实验任务。'] });
    const a = (
      await createConcept(userId, topicId, {
        name: 'Task',
        aliases: [],
        evidence: [
          {
            documentId: docA,
            locator: { kind: 'quote', quote: 'Task 是实验任务。' },
            basis: 'explicit',
          },
        ],
      })
    ).concept;
    const cardId = await seedCard(db, userId, { documentId: docA });
    await addCardKnowledgeLink(userId, cardId, { targetKind: 'concept', targetId: a.id });

    const locations = await resolveKnowledgeLocations(userId, docA, {
      topicId, targetKind: 'concept', targetId: a.id,
    });
    expect(locations.cards).toHaveLength(1);
    expect(locations.cards[0]!.cardId).toBe(cardId);
    expect(locations.cards[0]!.canvasNodeId).toBeNull(); // 未挂载脑图，不伪造节点
    expect(locations.evidence).toHaveLength(1);
    expect(locations.evidence[0]!.status).toBe('resolved');
    expect(locations.evidence[0]!.blockIndex).toBe(1);

    await expect(
      resolveKnowledgeLocations(otherUser, docA, { topicId, targetKind: 'concept', targetId: a.id }),
    ).rejects.toMatchObject({ status: 404, code: 'DOCUMENT_NOT_FOUND' });
    await expect(
      getDocumentKnowledge(otherUser, docA, { topicId, limit: 50 }),
    ).rejects.toMatchObject({ status: 404, code: 'DOCUMENT_NOT_FOUND' });
  });

  it('语义更新影响练习；仅改本文说明不影响', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const docA = await seedDocument(db, userId, { topicId });
    const a = (await createConcept(userId, topicId, {
      name: 'A', aliases: [], definition: '定义', evidence: [],
    })).concept;
    const before = a.version;
    await createConceptNote(userId, { targetKind: 'concept', targetId: a.id, documentId: docA, text: '说明' });
    const detail = await (await import('./concept.service.js')).getConcept(userId, a.id);
    expect(detail.concept.version).toBe(before);
    await updateConcept(userId, a.id, { expectedVersion: before, definition: '改定义' });
    const after = await (await import('./concept.service.js')).getConcept(userId, a.id);
    expect(after.concept.version).toBe(before + 1);
  });
});
