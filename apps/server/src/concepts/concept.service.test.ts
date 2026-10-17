import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conceptRelations,
  concepts,
  documentKnowledgeRefs,
  topics,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedDocument, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import {
  archiveConcept,
  archiveConceptRelation,
  createConcept,
  createConceptRelation,
  findConceptMatches,
  getConceptGraph,
  listConcepts,
  postConceptGraphView,
  restoreConcept,
  restoreConceptRelation,
  saveConceptBundle,
  updateConcept,
} from './concept.service.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

async function graphRevision(db: IsolatedDb['db'], topicId: string): Promise<number> {
  const [row] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  return row!.conceptGraphRevision;
}

describeDb('concept.service（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('同名异义并列保存；匹配只建议不合并', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);

    const first = await createConcept(userId, topicId, {
      name: 'Trial',
      aliases: [],
      sense: '实验设计中的单次试次',
      evidence: [],
    });
    expect(first.matches).toEqual([]);

    const second = await createConcept(userId, topicId, {
      name: ' trial ',
      aliases: [],
      sense: '法律语境的审判',
      evidence: [],
    });
    expect(second.concept.id).not.toBe(first.concept.id);
    // DTO 层 trim 首尾空白；存储展示名不做人小写等规范化改写
    expect(second.concept.name).toBe('trial');
    expect(second.matches).toHaveLength(1);
    expect(second.matches[0]!.conceptId).toBe(first.concept.id);
    expect(second.matches[0]!.matchedBy).toBe('name');

    const matches = await findConceptMatches(userId, topicId, { name: 'TRIAL', aliases: [] });
    expect(matches).toHaveLength(2);
  });

  it('别名相交仅产生建议', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    await createConcept(userId, topicId, {
      name: 'Task',
      aliases: ['任务'],
      evidence: [],
    });
    const result = await createConcept(userId, topicId, {
      name: '任务定义',
      aliases: ['任务'],
      evidence: [],
    });
    expect(result.matches[0]?.matchedBy).toBe('alias');
  });

  it('相同身份关系去重补证据；不同语境并列', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const a = (await createConcept(userId, topicId, { name: 'Task', aliases: [], evidence: [] }))
      .concept;
    const b = (await createConcept(userId, topicId, { name: 'Trial', aliases: [], evidence: [] }))
      .concept;

    const first = await createConceptRelation(userId, topicId, {
      fromConceptId: a.id,
      toConceptId: b.id,
      kind: 'execution',
      predicate: '可以进行多次',
      basis: 'user',
      evidence: [],
    });
    expect(first.created).toBe(true);

    // 规范化后相同身份：去重返回已有
    const dup = await createConceptRelation(userId, topicId, {
      fromConceptId: a.id,
      toConceptId: b.id,
      kind: 'execution',
      predicate: ' 可以进行多次 ',
      basis: 'explicit',
      evidence: [],
    });
    expect(dup.created).toBe(false);
    expect(dup.relation.id).toBe(first.relation.id);

    // 语境不同 → 并列保留
    const other = await createConceptRelation(userId, topicId, {
      fromConceptId: a.id,
      toConceptId: b.id,
      kind: 'execution',
      predicate: '可以进行多次',
      context: '另一框架',
      basis: 'explicit',
      evidence: [],
    });
    expect(other.created).toBe(true);
    expect(other.relation.id).not.toBe(first.relation.id);
  });

  it('跨主题端点与自环被拒绝', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const otherTopic = await seedTopic(db, userId, { title: '其他主题' });
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const b = (await createConcept(userId, otherTopic, { name: 'B', aliases: [], evidence: [] }))
      .concept;

    await expect(
      createConceptRelation(userId, topicId, {
        fromConceptId: a.id,
        toConceptId: b.id,
        kind: 'other',
        predicate: '跨主题',
        basis: 'user',
        evidence: [],
      }),
    ).rejects.toMatchObject({ status: 422, code: 'CONCEPT_ENDPOINT_INVALID' });

    await expect(
      createConceptRelation(userId, topicId, {
        fromConceptId: a.id,
        toConceptId: a.id,
        kind: 'other',
        predicate: '自环',
        basis: 'user',
        evidence: [],
      }),
    ).rejects.toMatchObject({ status: 422, code: 'CONCEPT_SELF_RELATION' });
  });

  it('版本冲突 409；语义变化递增概念与相邻关系版本', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const b = (await createConcept(userId, topicId, { name: 'B', aliases: [], evidence: [] }))
      .concept;
    const relation = (
      await createConceptRelation(userId, topicId, {
        fromConceptId: a.id,
        toConceptId: b.id,
        kind: 'other',
        predicate: '关联',
        basis: 'user',
        evidence: [],
      })
    ).relation;

    await expect(
      updateConcept(userId, a.id, { expectedVersion: 99, definition: '新定义' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_VERSION_CONFLICT' });

    const updated = await updateConcept(userId, a.id, {
      expectedVersion: 1,
      definition: '新定义',
    });
    expect(updated.version).toBe(2);

    const [relationRow] = await db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.id, relation.id));
    expect(relationRow!.version).toBe(2);
  });

  it('归档概念连带归档关系；恢复不自动恢复关系；恢复关系校验端点', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const b = (await createConcept(userId, topicId, { name: 'B', aliases: [], evidence: [] }))
      .concept;
    const relation = (
      await createConceptRelation(userId, topicId, {
        fromConceptId: a.id,
        toConceptId: b.id,
        kind: 'other',
        predicate: '关联',
        basis: 'user',
        evidence: [],
      })
    ).relation;

    const result = await archiveConcept(userId, a.id, 1);
    expect(result.archivedRelations).toBe(1);
    expect(result.affectedPractices).toBe(0);
    expect(result.concept.archivedAt).not.toBeNull();

    const [relationRow] = await db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.id, relation.id));
    expect(relationRow!.archivedAt).not.toBeNull();

    // 归档态写入拒绝
    await expect(
      updateConcept(userId, a.id, { expectedVersion: 1, definition: 'x' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_ARCHIVED' });

    // 端点归档时恢复关系 → 422
    await expect(restoreConceptRelation(userId, relation.id, 1)).rejects.toMatchObject({
      status: 422,
      code: 'CONCEPT_ENDPOINT_INVALID',
    });

    const restored = await restoreConcept(userId, a.id, 1);
    expect(restored.archivedAt).toBeNull();
    // 概念恢复不自动恢复关系
    const [relationAfter] = await db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.id, relation.id));
    expect(relationAfter!.archivedAt).not.toBeNull();

    const relationRestored = await restoreConceptRelation(userId, relation.id, 1);
    expect(relationRestored.archivedAt).toBeNull();
  });

  it('归档主题拒绝写入', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId, { status: 'archived' });
    await expect(
      createConcept(userId, topicId, { name: 'X', aliases: [], evidence: [] }),
    ).rejects.toMatchObject({ status: 409, code: 'TOPIC_ARCHIVED' });
  });

  it('bundle 原子性：任一步失败全部回滚', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, {
      topicId,
      blocks: ['Task 是实验的基本单位。'],
    });

    await expect(
      saveConceptBundle(userId, topicId, {
        concept: {
          kind: 'create',
          name: 'Task',
          aliases: [],
          // 伪造引文 → 证据核验失败 → 整体回滚
          evidence: [
            {
              documentId,
              locator: { kind: 'quote', quote: '这句话不存在' },
              basis: 'explicit',
            },
          ],
        },
        relations: [
          {
            direction: 'outgoing',
            other: { kind: 'create', name: 'Trial', aliases: [] },
            kind: 'composition',
            predicate: '包含',
            evidence: [],
          },
        ],
        documentId,
        requestId: 'bundle-rollback-1',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'EVIDENCE_QUOTE_INVALID' });

    const remainingConcepts = await db
      .select()
      .from(concepts)
      .where(eq(concepts.topicId, topicId));
    expect(remainingConcepts).toHaveLength(0);
    const remainingRelations = await db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.topicId, topicId));
    expect(remainingRelations).toHaveLength(0);
    const remainingRefs = await db
      .select()
      .from(documentKnowledgeRefs)
      .where(eq(documentKnowledgeRefs.topicId, topicId));
    expect(remainingRefs).toHaveLength(0);
  });

  it('bundle 幂等：同 requestId 同请求返回原结果；不同请求 409', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const documentId = await seedDocument(db, userId, { topicId });

    const input = {
      concept: { kind: 'create' as const, name: 'Task', aliases: [], evidence: [] },
      relations: [
        {
          direction: 'outgoing' as const,
          other: { kind: 'create' as const, name: 'Trial', aliases: [] },
          kind: 'composition' as const,
          predicate: '包含',
          evidence: [],
        },
      ],
      documentId,
      requestId: 'bundle-idem-1',
    };
    const first = await saveConceptBundle(userId, topicId, input);
    const second = await saveConceptBundle(userId, topicId, input);
    expect(second).toEqual(first);

    const allConcepts = await db.select().from(concepts).where(eq(concepts.topicId, topicId));
    expect(allConcepts).toHaveLength(2);

    await expect(
      saveConceptBundle(userId, topicId, {
        ...input,
        concept: { kind: 'create', name: '改过的名字', aliases: [], evidence: [] },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_REQUEST_CONFLICT' });

    // 本文引用已写入（概念 2 + 关系 1）
    const refs = await db
      .select()
      .from(documentKnowledgeRefs)
      .where(eq(documentKnowledgeRefs.documentId, documentId));
    expect(refs).toHaveLength(3);
  });

  it('列表分页：默认 50、最多 100，游标稳定', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    for (let i = 0; i < 55; i += 1) {
      await createConcept(userId, topicId, { name: `概念${String(i).padStart(3, '0')}`, aliases: [], evidence: [] });
    }
    const page1 = await listConcepts(userId, topicId, { limit: 50 });
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listConcepts(userId, topicId, { limit: 50, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(5);
    expect(page2.nextCursor).toBeNull();
    const ids = new Set([...page1.items, ...page2.items].map((item) => item.id));
    expect(ids.size).toBe(55);

    const filtered = await listConcepts(userId, topicId, { q: '概念0', limit: 10 });
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((item) => item.name.includes('概念0'))).toBe(true);
  });

  it('跨页节点的边完整返回；环的边不依赖分页归属', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);

    // 先造 3 个目标概念，再填充 50 个干扰概念使 A/B/C 跨页
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const b = (await createConcept(userId, topicId, { name: 'B', aliases: [], evidence: [] }))
      .concept;
    const c = (await createConcept(userId, topicId, { name: 'C', aliases: [], evidence: [] }))
      .concept;
    for (let i = 0; i < 50; i += 1) {
      await createConcept(userId, topicId, { name: `填充${i}`, aliases: [], evidence: [] });
    }
    // 环 A→B→C→A
    await createConceptRelation(userId, topicId, {
      fromConceptId: a.id, toConceptId: b.id, kind: 'execution', predicate: '调用', basis: 'user', evidence: [],
    });
    await createConceptRelation(userId, topicId, {
      fromConceptId: b.id, toConceptId: c.id, kind: 'execution', predicate: '返回', basis: 'user', evidence: [],
    });
    await createConceptRelation(userId, topicId, {
      fromConceptId: c.id, toConceptId: a.id, kind: 'evaluation', predicate: '指导', basis: 'user', evidence: [],
    });

    // 节点分页：每页 50，A/B/C 在第一页（创建最早）；取到第二页验证存在
    const page1 = await getConceptGraph(userId, topicId, { limit: 50 });
    expect(page1.nodes).toHaveLength(50);
    const page2 = await getConceptGraph(userId, topicId, { limit: 50, cursor: page1.nextCursor! });
    expect(page2.nodes).toHaveLength(3);
    expect(page1.graphRevision).toBe(page2.graphRevision);
    const allNodeIds = [...page1.nodes, ...page2.nodes].map((node) => node.concept.id);
    expect(allNodeIds).toContain(a.id);
    expect(allNodeIds).toContain(c.id);

    // 可见集合 = A（第一页）+ C（第二页）：跨页边 C→A 必须返回
    const view = await postConceptGraphView(userId, topicId, {
      nodeIds: [a.id, c.id],
      expectedGraphRevision: page1.graphRevision,
    });
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]!.fromConceptId).toBe(c.id);
    expect(view.edges[0]!.toConceptId).toBe(a.id);

    // 三环完整
    const cycleView = await postConceptGraphView(userId, topicId, {
      nodeIds: [a.id, b.id, c.id],
      expectedGraphRevision: page1.graphRevision,
    });
    expect(cycleView.edges).toHaveLength(3);
  });

  it('边分页超过 100 条时分页完整；游标绑定版本与可见集合', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const b = (await createConcept(userId, topicId, { name: 'B', aliases: [], evidence: [] }))
      .concept;
    for (let i = 0; i < 105; i += 1) {
      await createConceptRelation(userId, topicId, {
        fromConceptId: a.id,
        toConceptId: b.id,
        kind: 'other',
        predicate: `谓词${i}`,
        basis: 'user',
        evidence: [],
      });
    }
    const revision = await graphRevision(db, topicId);
    const page1 = await postConceptGraphView(userId, topicId, {
      nodeIds: [a.id, b.id],
      expectedGraphRevision: revision,
    });
    expect(page1.edges).toHaveLength(100);
    expect(page1.nextEdgeCursor).not.toBeNull();
    const page2 = await postConceptGraphView(userId, topicId, {
      nodeIds: [a.id, b.id],
      expectedGraphRevision: revision,
      edgeCursor: page1.nextEdgeCursor!,
    });
    expect(page2.edges).toHaveLength(5);
    expect(page2.nextEdgeCursor).toBeNull();
    const ids = new Set([...page1.edges, ...page2.edges].map((edge) => edge.id));
    expect(ids.size).toBe(105);

    // graphRevision 变化后旧游标拒绝
    await createConcept(userId, topicId, { name: '干扰', aliases: [], evidence: [] });
    await expect(
      postConceptGraphView(userId, topicId, {
        nodeIds: [a.id, b.id],
        expectedGraphRevision: revision,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'GRAPH_VIEW_CHANGED' });

    // 可见集合变化后旧游标拒绝
    const newRevision = await graphRevision(db, topicId);
    await expect(
      postConceptGraphView(userId, topicId, {
        nodeIds: [a.id],
        expectedGraphRevision: newRevision,
        edgeCursor: page1.nextEdgeCursor!,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'GRAPH_VIEW_CHANGED' });
  });

  it('graph/view 拒绝其他用户或其他主题的节点', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const otherUser = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const otherTopic = await seedTopic(db, otherUser);
    const mine = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const foreign = (
      await createConcept(otherUser, otherTopic, { name: 'B', aliases: [], evidence: [] })
    ).concept;
    const revision = await graphRevision(db, topicId);
    await expect(
      postConceptGraphView(userId, topicId, {
        nodeIds: [mine.id, foreign.id],
        expectedGraphRevision: revision,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'CONCEPT_NOT_FOUND' });
  });

  it('documentId 范围只返回本文收录的关系', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const docA = await seedDocument(db, userId, { topicId });
    const a = (await createConcept(userId, topicId, { name: 'A', aliases: [], evidence: [] }))
      .concept;
    const b = (await createConcept(userId, topicId, { name: 'B', aliases: [], evidence: [] }))
      .concept;
    // 本文收录的关系（bundle 带 documentId 会写引用）
    await saveConceptBundle(userId, topicId, {
      concept: { kind: 'reuse', conceptId: a.id, expectedVersion: 1 },
      relations: [
        {
          direction: 'outgoing',
          other: { kind: 'existing', conceptId: b.id },
          kind: 'other',
          predicate: '本文关系',
          evidence: [],
        },
      ],
      documentId: docA,
      requestId: 'doc-scope-1',
    });
    // 另一条关系只在主题里（无本文引用）
    await createConceptRelation(userId, topicId, {
      fromConceptId: a.id,
      toConceptId: b.id,
      kind: 'other',
      predicate: '其他文章关系',
      basis: 'user',
      evidence: [],
    });

    const revision = await graphRevision(db, topicId);
    const topicView = await postConceptGraphView(userId, topicId, {
      nodeIds: [a.id, b.id],
      expectedGraphRevision: revision,
    });
    expect(topicView.edges).toHaveLength(2);

    const docView = await postConceptGraphView(userId, topicId, {
      documentId: docA,
      nodeIds: [a.id, b.id],
      expectedGraphRevision: revision,
    });
    expect(docView.edges).toHaveLength(1);
    expect(docView.edges[0]!.predicate).toBe('本文关系');

    // 本文节点：A 是明确收录（direct），B 是关系带出的端点上下文
    const graph = await getConceptGraph(userId, topicId, { documentId: docA, limit: 50 });
    const names = graph.nodes.map((node) => node.concept.name).sort();
    expect(names).toEqual(['A', 'B']);
    const membershipOf = (name: string) =>
      graph.nodes.find((node) => node.concept.name === name)?.membership;
    expect(membershipOf('A')).toBe('direct');
    expect(membershipOf('B')).toBe('endpoint_context');
  });
});
