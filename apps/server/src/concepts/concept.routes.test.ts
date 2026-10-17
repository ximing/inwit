import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { registerErrorHandler } from '../plugins/error-handler.js';
import '../types.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedDocument, seedReadyConceptBatch, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { registerConceptRoutes } from './concept.routes.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

async function buildTestApp(userId: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { id: userId };
  });
  registerErrorHandler(app);
  registerConceptRoutes(app);
  await app.ready();
  return app;
}

describeDb('concept.routes（真实 PG + HTTP）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
    // 发布开关默认关闭（生产）；测试显式打开，不依赖 .env.test。
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  afterEach(() => {
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
    (config as { CONCEPTS_READ_ENABLED: boolean | undefined }).CONCEPTS_READ_ENABLED = undefined;
    (config as { CONCEPTS_WRITE_ENABLED: boolean | undefined }).CONCEPTS_WRITE_ENABLED = undefined;
  });

  it('开关关闭时所有入口 404 CONCEPTS_DISABLED', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const app = await buildTestApp(userId);
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = false;
    const response = await app.inject({ method: 'GET', url: `/api/topics/${topicId}/concepts` });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CONCEPTS_DISABLED');
    await app.close();
  });

  it('读开写关时概念列表 200，创建概念 404 CONCEPTS_DISABLED', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const app = await buildTestApp(userId);
    const flags = config as {
      CONCEPTS_ENABLED: boolean;
      CONCEPTS_READ_ENABLED: boolean | undefined;
      CONCEPTS_WRITE_ENABLED: boolean | undefined;
    };
    flags.CONCEPTS_ENABLED = false;
    flags.CONCEPTS_READ_ENABLED = true;
    flags.CONCEPTS_WRITE_ENABLED = false;

    const list = await app.inject({ method: 'GET', url: `/api/topics/${topicId}/concepts` });
    expect(list.statusCode).toBe(200);

    const created = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concepts`,
      payload: { name: 'Task' },
    });
    expect(created.statusCode).toBe(404);
    expect(created.json().error.code).toBe('CONCEPTS_DISABLED');
    await app.close();
  });

  it('创建概念并读取；同名建议随创建返回', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const app = await buildTestApp(userId);

    const created = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concepts`,
      payload: { name: 'Task', aliases: ['任务'], definition: '实验中的任务' },
    });
    expect(created.statusCode).toBe(201);
    const concept = created.json().concept;
    expect(concept.version).toBe(1);

    const again = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concepts`,
      payload: { name: 'task' },
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().matches).toHaveLength(1);

    const detail = await app.inject({ method: 'GET', url: `/api/concepts/${concept.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().concept.name).toBe('Task');

    const matches = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concept-matches`,
      payload: { name: '任务定义', aliases: ['任务'] },
    });
    expect(matches.json().matches[0]?.matchedBy).toBe('alias');
    await app.close();
  });

  it('校验失败 400；越权 404；归档主题写入 409', async () => {
    const userId = await seedUser(iso.db);
    const otherUser = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const archivedTopic = await seedTopic(iso.db, userId, { status: 'archived' });
    const app = await buildTestApp(userId);

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concepts`,
      payload: { name: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/concepts/${crypto.randomUUID()}`,
    });
    expect(foreign.statusCode).toBe(404);

    const otherApp = await buildTestApp(otherUser);
    const created = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concepts`,
      payload: { name: 'Task' },
    });
    const conceptId = created.json().concept.id;
    const stolen = await otherApp.inject({ method: 'GET', url: `/api/concepts/${conceptId}` });
    expect(stolen.statusCode).toBe(404);

    const archived = await app.inject({
      method: 'POST',
      url: `/api/topics/${archivedTopic}/concepts`,
      payload: { name: 'X' },
    });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('TOPIC_ARCHIVED');
    await app.close();
    await otherApp.close();
  });

  it('列表 limit 超过 100 被拒绝；graph/view 版本不符 409', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const app = await buildTestApp(userId);

    const tooBig = await app.inject({
      method: 'GET',
      url: `/api/topics/${topicId}/concepts?limit=101`,
    });
    expect(tooBig.statusCode).toBe(400);

    const a = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concepts`,
      payload: { name: 'A' },
    });
    const aId = a.json().concept.id;
    const graph = await app.inject({ method: 'GET', url: `/api/topics/${topicId}/concept-graph` });
    const revision = graph.json().graphRevision;

    const okView = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concept-graph/view`,
      payload: { nodeIds: [aId], expectedGraphRevision: revision },
    });
    expect(okView.statusCode).toBe(200);

    const staleView = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concept-graph/view`,
      payload: { nodeIds: [aId], expectedGraphRevision: revision + 1 },
    });
    expect(staleView.statusCode).toBe(409);
    expect(staleView.json().error.code).toBe('GRAPH_VIEW_CHANGED');

    const badCursor = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concept-graph/view`,
      payload: { nodeIds: [aId], expectedGraphRevision: revision, edgeCursor: 'not-a-cursor' },
    });
    expect(badCursor.statusCode).toBe(409);
    await app.close();
  });

  it('生成入口创建批次并入队（M2 接通）', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const documentId = await seedDocument(iso.db, userId, { topicId });
    const app = await buildTestApp(userId);
    const response = await app.inject({
      method: 'POST',
      url: `/api/documents/${documentId}/concept-batches`,
      payload: { topicId, scope: 'document', requestId: 'r-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().batchId).toBeTruthy();
    expect(response.json().jobId).toBeTruthy();
    // 同 requestId 重放返回原结果
    const replay = await app.inject({
      method: 'POST',
      url: `/api/documents/${documentId}/concept-batches`,
      payload: { topicId, scope: 'document', requestId: 'r-1' },
    });
    expect(replay.json().batchId).toBe(response.json().batchId);

    const batchView = await app.inject({
      method: 'GET',
      url: `/api/concept-batches/${response.json().batchId}`,
    });
    expect(batchView.json().status).toBe('queued');
    expect(batchView.json().coverage.totalChars).toBeGreaterThan(0);
    await app.close();
  });

  it('bundle 与批次 commit 走 HTTP 全链路', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const documentId = await seedDocument(iso.db, userId, {
      topicId,
      blocks: ['Task 是可以进行多次 Trial 的任务。'],
    });
    const app = await buildTestApp(userId);

    const bundle = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concept-bundles`,
      payload: {
        concept: { kind: 'create', name: 'Task' },
        relations: [
          {
            direction: 'outgoing',
            other: { kind: 'create', name: 'Trial' },
            kind: 'execution',
            predicate: '可以进行多次',
          },
        ],
        documentId,
        requestId: 'http-bundle-1',
      },
    });
    expect(bundle.statusCode).toBe(201);
    expect(bundle.json().createdConcepts).toHaveLength(2);
    expect(bundle.json().relations).toHaveLength(1);

    const draft = {
      schemaVersion: 1 as const,
      concepts: [
        {
          tempId: 'c1',
          name: 'Step',
          aliases: [],
          sense: null,
          definition: null,
          example: null,
          basis: 'explicit' as const,
          evidence: [],
          matchCandidates: [],
        },
      ],
      relations: [],
    };
    const batchId = await seedReadyConceptBatch(iso.db, { userId, topicId, documentId, draft });
    const commit = await app.inject({
      method: 'POST',
      url: `/api/concept-batches/${batchId}/commit`,
      payload: {
        expectedDraftRevision: 1,
        conceptDecisions: [{ tempId: 'c1', decision: 'create' }],
        relationDecisions: [],
        requestId: 'http-commit-1',
      },
    });
    expect(commit.statusCode).toBe(200);
    expect(commit.json().counts.createdConcepts).toBe(1);

    const batch = await app.inject({ method: 'GET', url: `/api/concept-batches/${batchId}` });
    expect(batch.json().status).toBe('committed');
    expect(batch.json().commitResult.counts.createdConcepts).toBe(1);

    const discard = await app.inject({
      method: 'POST',
      url: `/api/concept-batches/${batchId}/discard`,
    });
    // committed 批次不能丢弃
    expect(discard.statusCode).toBe(409);
    await app.close();
  });
});

// ---- M3/T6 路由 ----

describeDb('concept routes: 练习/建议/导航（真实 PG + HTTP）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
  });

  it('练习创建/绑定/refresh/resume/解绑与导航链接的 HTTP 接线', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const documentId = await seedDocument(iso.db, userId, { topicId });
    const app = await buildTestApp(userId);

    const concept = await app.inject({
      method: 'POST',
      url: `/api/topics/${topicId}/concepts`,
      payload: { name: 'Task', definition: '实验中的任务' },
    });
    const conceptId = concept.json().concept.id as string;

    // 新建练习（手写题，不依赖 AI）
    const created = await app.inject({
      method: 'POST',
      url: '/api/concept-practices',
      payload: {
        targetKind: 'concept',
        targetId: conceptId,
        expectedVersion: 1,
        exerciseKind: 'recall',
        question: '什么是 Task？',
        answer: '实验中的任务',
        requestId: 'http-cp-1',
      },
    });
    expect(created.statusCode).toBe(201);
    const binding = created.json().binding;

    // 重复创建返回已有
    const dup = await app.inject({
      method: 'POST',
      url: '/api/concept-practices',
      payload: {
        targetKind: 'concept',
        targetId: conceptId,
        expectedVersion: 1,
        exerciseKind: 'recall',
        question: '别的题',
        answer: '别的',
        requestId: 'http-cp-2',
      },
    });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().created).toBe(false);

    // 导航链接：主要目标的链接存在，单独删除 409
    const links = await app.inject({ method: 'GET', url: `/api/cards/${created.json().cardId}/knowledge-links` });
    expect(links.json().items).toHaveLength(1);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/cards/${created.json().cardId}/knowledge-links/${links.json().items[0].id}`,
    });
    expect(del.statusCode).toBe(409);

    // resume（无阻断时幂等语义）
    const resume = await app.inject({
      method: 'POST',
      url: `/api/concept-practices/${binding.id}/resume`,
      payload: { expectedReviewRevision: 1 },
    });
    expect(resume.statusCode).toBe(200);

    // refresh
    const refresh = await app.inject({
      method: 'POST',
      url: `/api/concept-practices/${binding.id}/refresh`,
      payload: {
        questionId: binding.questionId,
        expectedTargetVersion: 1,
        expectedReviewRevision: 1,
        question: '什么是 Task（更新）？',
        answer: '更新答案',
      },
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().needsRefresh).toBe(false);

    // 解绑
    const unbind = await app.inject({
      method: 'DELETE',
      url: `/api/concept-practices/${binding.id}`,
    });
    expect(unbind.statusCode).toBe(200);
    expect(unbind.json().endedAt).not.toBeNull();

    // 解绑后主导航链接可删
    const delAfter = await app.inject({
      method: 'DELETE',
      url: `/api/cards/${created.json().cardId}/knowledge-links/${links.json().items[0].id}`,
    });
    expect(delAfter.statusCode).toBe(204);

    // 出题建议：202 + 详情可读
    const proposal = await app.inject({
      method: 'POST',
      url: '/api/concept-practice-proposals',
      payload: { targetKind: 'concept', targetId: conceptId, exerciseKind: 'recall', requestId: 'http-pp-1' },
    });
    expect(proposal.statusCode).toBe(202);
    const proposalView = await app.inject({
      method: 'GET',
      url: `/api/concept-practice-proposals/${proposal.json().proposalId}`,
    });
    expect(proposalView.json().status).toBe('queued');
    expect(proposalView.json().currentTargetVersion).toBe(1);

    await app.close();
  });

  it('越权访问练习绑定返回 404', async () => {
    const userId = await seedUser(iso.db);
    const otherUser = await seedUser(iso.db);
    const app = await buildTestApp(otherUser);
    const missing = await app.inject({
      method: 'DELETE',
      url: `/api/concept-practices/${crypto.randomUUID()}`,
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
