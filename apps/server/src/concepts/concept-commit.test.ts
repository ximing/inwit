import type { ConceptDraft } from '@inwit/dto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conceptBatches,
  conceptEvidence,
  conceptNotes,
  conceptRelations,
  concepts,
  documentKnowledgeRefs,
  documents,
} from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import {
  contentJsonFromBlocks,
  seedDocument,
  seedReadyConceptBatch,
  seedTopic,
  seedUser,
} from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { commitConceptBatch } from './concept-commit.js';
import { createConcept } from './concept.service.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

function draftConcept(
  tempId: string,
  name: string,
  extra: Partial<ConceptDraft['concepts'][number]> = {},
): ConceptDraft['concepts'][number] {
  return {
    tempId,
    name,
    aliases: [],
    sense: null,
    definition: null,
    example: null,
    basis: 'explicit',
    evidence: [],
    matchCandidates: [],
    ...extra,
  };
}

function draftRelation(
  tempId: string,
  from: ConceptDraft['relations'][number]['fromRef'],
  to: ConceptDraft['relations'][number]['toRef'],
  extra: Partial<ConceptDraft['relations'][number]> = {},
): ConceptDraft['relations'][number] {
  return {
    tempId,
    fromRef: from,
    toRef: to,
    kind: 'other',
    predicate: '关联',
    context: null,
    explanation: null,
    example: null,
    basis: 'explicit',
    evidence: [],
    ...extra,
  };
}

async function countRows(db: IsolatedDb['db'], topicId: string) {
  return {
    concepts: (await db.select().from(concepts).where(eq(concepts.topicId, topicId))).length,
    relations: (await db.select().from(conceptRelations).where(eq(conceptRelations.topicId, topicId)))
      .length,
    refs: (
      await db.select().from(documentKnowledgeRefs).where(eq(documentKnowledgeRefs.topicId, topicId))
    ).length,
  };
}

describeDb('concept-commit（真实 PG，含并发）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('提交创建概念与关系，同事务写入本文引用', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, {
      topicId,
      blocks: ['Task 是可以进行多次 Trial 的实验任务。'],
    });
    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [
        draftConcept('c1', 'Task', {
          evidence: [
            { locator: { kind: 'quote', quote: 'Task 是可以进行多次 Trial 的实验任务。' }, basis: 'explicit' },
          ],
        }),
        draftConcept('c2', 'Trial'),
      ],
      relations: [
        draftRelation('r1', { kind: 'candidate', tempId: 'c1' }, { kind: 'candidate', tempId: 'c2' }, {
          kind: 'execution',
          predicate: '可以进行多次',
          evidence: [
            { locator: { kind: 'quote', quote: 'Task 是可以进行多次 Trial 的实验任务。' }, basis: 'explicit' },
          ],
        }),
      ],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });

    const result = await commitConceptBatch(userId, batchId, {
      expectedDraftRevision: 1,
      conceptDecisions: [
        { tempId: 'c1', decision: 'create' },
        { tempId: 'c2', decision: 'create' },
      ],
      relationDecisions: [{ tempId: 'r1', decision: 'create' }],
      requestId: 'commit-happy-1',
    });

    expect(result.counts).toEqual({
      createdConcepts: 2,
      reusedConcepts: 0,
      createdRelations: 1,
      supplementedRelations: 0,
      appendedEvidence: 2,
    });
    const relationId = result.relationIdMap['r1']!;
    const [relationRow] = await db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.id, relationId));
    expect(relationRow!.fromConceptId).toBe(result.conceptIdMap['c1']);
    expect(relationRow!.origin).toBe('agent');

    // 本文引用：2 概念 + 1 关系
    const refs = await db
      .select()
      .from(documentKnowledgeRefs)
      .where(eq(documentKnowledgeRefs.documentId, documentId));
    expect(refs).toHaveLength(3);

    const [batch] = await db.select().from(conceptBatches).where(eq(conceptBatches.id, batchId));
    expect(batch!.status).toBe('committed');
    expect(batch!.commitResult).toEqual(result);
    expect(batch!.committedAt).not.toBeNull();
  });

  it('重复 requestId 同命令返回原结果；不同命令 409；非 ready 拒绝', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });
    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [draftConcept('c1', 'Task')],
      relations: [],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    const input = {
      expectedDraftRevision: 1,
      conceptDecisions: [{ tempId: 'c1', decision: 'create' as const }],
      relationDecisions: [],
      requestId: 'commit-idem-1',
    };
    const first = await commitConceptBatch(userId, batchId, input);
    const second = await commitConceptBatch(userId, batchId, input);
    expect(second).toEqual(first);
    expect((await db.select().from(concepts).where(eq(concepts.topicId, topicId)))).toHaveLength(1);

    // 同 requestId 不同命令 → 409（requestHash 不同）
    await expect(
      commitConceptBatch(userId, batchId, { ...input, conceptDecisions: [] }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_BATCH_ALREADY_COMMITTED' });

    // 另一个 queued 批次不能提交
    const queuedBatch = await seedReadyConceptBatch(db, {
      userId,
      topicId,
      documentId,
      draft,
      status: 'queued',
    });
    await expect(
      commitConceptBatch(userId, queuedBatch, { ...input, requestId: 'commit-idem-2' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_BATCH_NOT_READY' });
  });

  it('正文小改仍可收录；引文还在就写入，引文被改掉则跳过摘录', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId, blocks: ['Task 是单位。', '后文保持。'] });
    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [
        draftConcept('c1', 'Task', {
          evidence: [{ locator: { kind: 'quote', quote: 'Task 是单位。' }, basis: 'explicit' }],
        }),
      ],
      relations: [],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    await db
      .update(documents)
      .set({ contentJson: contentJsonFromBlocks(['Task 是单位。', '后文改了一点。']) })
      .where(eq(documents.id, documentId));
    const kept = await commitConceptBatch(userId, batchId, {
      expectedDraftRevision: 1,
      conceptDecisions: [{ tempId: 'c1', decision: 'create' }],
      relationDecisions: [],
      requestId: 'commit-small-edit',
    });
    expect(kept.counts.createdConcepts).toBe(1);
    expect(kept.counts.appendedEvidence).toBe(1);

    const droppedDoc = await seedDocument(db, userId, { topicId, blocks: ['Task 是单位。', '后文保持。'] });
    const droppedBatch = await seedReadyConceptBatch(db, { userId, topicId, documentId: droppedDoc, draft });
    await db
      .update(documents)
      .set({ contentJson: contentJsonFromBlocks(['任务的定义改写了。', '后文保持。']) })
      .where(eq(documents.id, droppedDoc));
    const dropped = await commitConceptBatch(userId, droppedBatch, {
      expectedDraftRevision: 1,
      conceptDecisions: [{ tempId: 'c1', decision: 'create' }],
      relationDecisions: [],
      requestId: 'commit-quote-gone',
    });
    expect(dropped.counts.createdConcepts).toBe(1);
    expect(dropped.counts.appendedEvidence).toBe(0);
  });

  it('正文大改拒绝旧提交，不产生任何写入', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const original = `原文主题。${'这是原来的句子。'.repeat(80)}`;
    const documentId = await seedDocument(db, userId, { topicId, blocks: [original] });
    const batchId = await seedReadyConceptBatch(db, {
      userId,
      topicId,
      documentId,
      draft: { schemaVersion: 1, concepts: [draftConcept('c1', 'Task')], relations: [] },
    });
    await db
      .update(documents)
      .set({ contentJson: contentJsonFromBlocks([`另一篇文章。${'完全不同的内容。'.repeat(80)}`]) })
      .where(eq(documents.id, documentId));
    await expect(
      commitConceptBatch(userId, batchId, {
        expectedDraftRevision: 1,
        conceptDecisions: [{ tempId: 'c1', decision: 'create' }],
        relationDecisions: [],
        requestId: 'commit-stale-1',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_BATCH_STALE' });
    expect(await countRows(db, topicId)).toEqual({ concepts: 0, relations: 0, refs: 0 });
  });

  it('草稿版本冲突 409', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });
    const batchId = await seedReadyConceptBatch(db, {
      userId,
      topicId,
      documentId,
      draft: { schemaVersion: 1, concepts: [draftConcept('c1', 'Task')], relations: [] },
    });
    await expect(
      commitConceptBatch(userId, batchId, {
        expectedDraftRevision: 99,
        conceptDecisions: [],
        relationDecisions: [],
        requestId: 'commit-rev-1',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_BATCH_CONFLICT' });
  });

  it('推断项未显式确认返回 422', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });
    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [draftConcept('c1', 'Task'), draftConcept('c2', 'Reliability')],
      relations: [
        draftRelation(
          'r1',
          { kind: 'candidate', tempId: 'c1' },
          { kind: 'candidate', tempId: 'c2' },
          { basis: 'inferred', predicate: '用于估计' },
        ),
      ],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    await expect(
      commitConceptBatch(userId, batchId, {
        expectedDraftRevision: 1,
        conceptDecisions: [
          { tempId: 'c1', decision: 'create' },
          { tempId: 'c2', decision: 'create' },
        ],
        relationDecisions: [{ tempId: 'r1', decision: 'create' }],
        requestId: 'commit-inf-1',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'CONCEPT_INFERRED_UNCONFIRMED' });
    expect(await countRows(db, topicId)).toEqual({ concepts: 0, relations: 0, refs: 0 });

    // 显式确认后成功，且保留 inferred 标记
    const result = await commitConceptBatch(userId, batchId, {
      expectedDraftRevision: 1,
      conceptDecisions: [
        { tempId: 'c1', decision: 'create' },
        { tempId: 'c2', decision: 'create' },
      ],
      relationDecisions: [{ tempId: 'r1', decision: 'create', acknowledged: true }],
      requestId: 'commit-inf-2',
    });
    const [relation] = await db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.id, result.relationIdMap['r1']!));
    expect(relation!.basis).toBe('inferred');
  });

  it('取消候选端点后保留依赖关系 → 422 悬空；重绑定已有概念可提交', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });
    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [draftConcept('c1', 'Task'), draftConcept('c2', 'Trial')],
      relations: [
        draftRelation('r1', { kind: 'candidate', tempId: 'c1' }, { kind: 'candidate', tempId: 'c2' }),
      ],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    await expect(
      commitConceptBatch(userId, batchId, {
        expectedDraftRevision: 1,
        conceptDecisions: [
          { tempId: 'c1', decision: 'create' },
          { tempId: 'c2', decision: 'skip' },
        ],
        relationDecisions: [{ tempId: 'r1', decision: 'create' }],
        requestId: 'commit-dangle-1',
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'CONCEPT_DANGLING_RELATION',
      details: { relationTempId: 'r1', conceptTempId: 'c2' },
    });
    expect(await countRows(db, topicId)).toEqual({ concepts: 0, relations: 0, refs: 0 });

    // 重绑定到已有概念后提交成功
    const existing = await createConcept(userId, topicId, {
      name: '既有 Trial',
      aliases: [],
      evidence: [],
    });
    const rebound = await commitConceptBatch(userId, batchId, {
      expectedDraftRevision: 1,
      conceptDecisions: [
        { tempId: 'c1', decision: 'create' },
        { tempId: 'c2', decision: 'skip' },
      ],
      relationDecisions: [
        {
          tempId: 'r1',
          decision: 'create',
          toRef: { kind: 'existing', conceptId: existing.concept.id, version: 1 },
        },
      ],
      requestId: 'commit-dangle-2',
    });
    const [relation] = await db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.id, rebound.relationIdMap['r1']!));
    expect(relation!.toConceptId).toBe(existing.concept.id);
  });

  it('reuse 不覆盖主定义，只追加说明与证据；版本不符 409', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, {
      topicId,
      blocks: ['Task 是实验任务。'],
    });
    const existing = await createConcept(userId, topicId, {
      name: 'Task',
      aliases: [],
      definition: '用户手写的定义',
      evidence: [],
    });

    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [
        draftConcept('c1', 'Task', {
          definition: '模型生成的定义',
          matchCandidates: [
            { conceptId: existing.concept.id, name: 'Task', sense: null, matchedBy: 'name' },
          ],
          evidence: [
            { locator: { kind: 'quote', quote: 'Task 是实验任务。' }, basis: 'explicit' },
          ],
        }),
      ],
      relations: [],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });

    // 版本不符
    await expect(
      commitConceptBatch(userId, batchId, {
        expectedDraftRevision: 1,
        conceptDecisions: [
          {
            tempId: 'c1',
            decision: 'reuse',
            reuseConceptId: existing.concept.id,
            reuseExpectedVersion: 99,
          },
        ],
        relationDecisions: [],
        requestId: 'commit-reuse-0',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_VERSION_CONFLICT' });

    const result = await commitConceptBatch(userId, batchId, {
      expectedDraftRevision: 1,
      conceptDecisions: [
        {
          tempId: 'c1',
          decision: 'reuse',
          reuseConceptId: existing.concept.id,
          reuseExpectedVersion: 1,
          note: '本文语境下的补充说明',
        },
      ],
      relationDecisions: [],
      requestId: 'commit-reuse-1',
    });
    expect(result.counts.reusedConcepts).toBe(1);
    expect(result.counts.createdConcepts).toBe(0);

    const [conceptRow] = await db
      .select()
      .from(concepts)
      .where(eq(concepts.id, existing.concept.id));
    // 主定义不被覆盖，版本不递增
    expect(conceptRow!.definition).toBe('用户手写的定义');
    expect(conceptRow!.version).toBe(1);

    const notes = await db
      .select()
      .from(conceptNotes)
      .where(eq(conceptNotes.conceptId, existing.concept.id));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('本文语境下的补充说明');
    expect(notes[0]!.documentId).toBe(documentId);

    const evidence = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.conceptId, existing.concept.id));
    expect(evidence).toHaveLength(1);
  });

  it('已有关系重复提交时补证据不重复建边', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId, blocks: ['A 关联 B。'] });
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const b = (await createConcept(userId, topicId, { name: 'B', aliases: [], evidence: [] }))
      .concept;

    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [],
      relations: [
        draftRelation(
          'r1',
          { kind: 'existing', conceptId: a.id, version: 1 },
          { kind: 'existing', conceptId: b.id, version: 1 },
          {
            predicate: '关联',
            evidence: [{ locator: { kind: 'quote', quote: 'A 关联 B。' }, basis: 'explicit' }],
          },
        ),
      ],
    };

    // 两个批次都提交同一条关系
    const batch1 = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    const batch2 = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    const r1 = await commitConceptBatch(userId, batch1, {
      expectedDraftRevision: 1,
      conceptDecisions: [],
      relationDecisions: [{ tempId: 'r1', decision: 'create' }],
      requestId: 'commit-dup-rel-1',
    });
    expect(r1.counts.createdRelations).toBe(1);
    const r2 = await commitConceptBatch(userId, batch2, {
      expectedDraftRevision: 1,
      conceptDecisions: [],
      relationDecisions: [{ tempId: 'r1', decision: 'create' }],
      requestId: 'commit-dup-rel-2',
    });
    expect(r2.counts.createdRelations).toBe(0);
    expect(r2.counts.supplementedRelations).toBe(1);
    expect(r2.relationIdMap['r1']).toBe(r1.relationIdMap['r1']);

    const relations = await db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.topicId, topicId));
    expect(relations).toHaveLength(1);
    // 第二份证据已追加；同引文同定位再次提交不重复
    const evidence = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.relationId, relations[0]!.id));
    expect(evidence).toHaveLength(1);
  });

  it('失败注入：伪造引文导致整体回滚，批次保持 ready', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId, blocks: ['真实内容。'] });
    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [
        draftConcept('c1', 'Task'),
        draftConcept('c2', 'Trial', {
          evidence: [{ locator: { kind: 'quote', quote: '根本不存在的引文' }, basis: 'explicit' }],
        }),
      ],
      relations: [
        draftRelation('r1', { kind: 'candidate', tempId: 'c1' }, { kind: 'candidate', tempId: 'c2' }),
      ],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    await expect(
      commitConceptBatch(userId, batchId, {
        expectedDraftRevision: 1,
        conceptDecisions: [
          { tempId: 'c1', decision: 'create' },
          { tempId: 'c2', decision: 'create' },
        ],
        relationDecisions: [{ tempId: 'r1', decision: 'create' }],
        requestId: 'commit-rollback-1',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'EVIDENCE_QUOTE_INVALID' });

    expect(await countRows(db, topicId)).toEqual({ concepts: 0, relations: 0, refs: 0 });
    const [batch] = await db.select().from(conceptBatches).where(eq(conceptBatches.id, batchId));
    expect(batch!.status).toBe('ready');
  });

  it('两个并发事务确认同一批次：只保存一次且响应相同', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, {
      topicId,
      blocks: ['Task 包含 Trial。'],
    });
    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [draftConcept('c1', 'Task'), draftConcept('c2', 'Trial')],
      relations: [
        draftRelation('r1', { kind: 'candidate', tempId: 'c1' }, { kind: 'candidate', tempId: 'c2' }),
      ],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    const input = {
      expectedDraftRevision: 1,
      conceptDecisions: [
        { tempId: 'c1', decision: 'create' as const },
        { tempId: 'c2', decision: 'create' as const },
      ],
      relationDecisions: [{ tempId: 'r1', decision: 'create' as const }],
      requestId: 'commit-concurrent-1',
    };
    const [first, second] = await Promise.all([
      commitConceptBatch(userId, batchId, input),
      commitConceptBatch(userId, batchId, input),
    ]);
    expect(second).toEqual(first);
    expect(await countRows(db, topicId)).toEqual({ concepts: 2, relations: 1, refs: 3 });
  });

  it('existing 端点版本过期拒绝；跨用户 existing 404', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const otherUser = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const otherTopic = await seedTopic(db, otherUser);
    const documentId = await seedDocument(db, userId, { topicId });
    const mine = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const foreign = (
      await createConcept(otherUser, otherTopic, { name: 'B', aliases: [], evidence: [] })
    ).concept;

    const makeDraft = (conceptId: string, version: number): ConceptDraft => ({
      schemaVersion: 1,
      concepts: [draftConcept('c1', 'Task')],
      relations: [
        draftRelation(
          'r1',
          { kind: 'candidate', tempId: 'c1' },
          { kind: 'existing', conceptId, version },
        ),
      ],
    });

    const staleVersionBatch = await seedReadyConceptBatch(db, {
      userId,
      topicId,
      documentId,
      draft: makeDraft(mine.id, 99),
    });
    await expect(
      commitConceptBatch(userId, staleVersionBatch, {
        expectedDraftRevision: 1,
        conceptDecisions: [{ tempId: 'c1', decision: 'create' }],
        relationDecisions: [{ tempId: 'r1', decision: 'create' }],
        requestId: 'commit-existing-1',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_VERSION_CONFLICT' });

    const foreignBatch = await seedReadyConceptBatch(db, {
      userId,
      topicId,
      documentId,
      draft: makeDraft(foreign.id, 1),
    });
    await expect(
      commitConceptBatch(userId, foreignBatch, {
        expectedDraftRevision: 1,
        conceptDecisions: [{ tempId: 'c1', decision: 'create' }],
        relationDecisions: [{ tempId: 'r1', decision: 'create' }],
        requestId: 'commit-existing-2',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'CONCEPT_NOT_FOUND' });
  });

  it('同名候选 create 不与既有同名概念合并（同名异义并列）', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });
    const existing = await createConcept(userId, topicId, {
      name: 'Trial',
      aliases: [],
      sense: '法律语境',
      evidence: [],
    });
    const draft: ConceptDraft = {
      schemaVersion: 1,
      concepts: [
        draftConcept('c1', 'Trial', {
          sense: '实验语境',
          matchCandidates: [
            { conceptId: existing.concept.id, name: 'Trial', sense: '法律语境', matchedBy: 'name' },
          ],
        }),
      ],
      relations: [],
    };
    const batchId = await seedReadyConceptBatch(db, { userId, topicId, documentId, draft });
    const result = await commitConceptBatch(userId, batchId, {
      expectedDraftRevision: 1,
      conceptDecisions: [{ tempId: 'c1', decision: 'create' }],
      relationDecisions: [],
      requestId: 'commit-samename-1',
    });
    expect(result.conceptIdMap['c1']).not.toBe(existing.concept.id);
    const all = await db.select().from(concepts).where(eq(concepts.topicId, topicId));
    expect(all).toHaveLength(2);
  });
});
