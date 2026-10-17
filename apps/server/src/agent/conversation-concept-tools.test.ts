import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { conceptBatches, concepts, jobs } from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedDocument, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { proposeArticleConceptsTool } from './conversation-concept-tools.js';
import type { ConversationSession } from './conversation-tools.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

function makeSession(input: {
  userId: string;
  mentions?: string[];
  runKey?: string;
}): ConversationSession {
  return {
    userId: input.userId,
    dirtyDocumentIds: new Set(),
    mindNodeKeys: new Set(),
    mindDocumentIds: new Set(input.mentions ?? []),
    mentionDocumentIds: new Set(input.mentions ?? []),
    runKey: input.runKey ?? `conv-${Math.random().toString(36).slice(2)}`,
    allowCards: false,
    actions: [],
    writtenCardIds: [],
  };
}

async function callTool(session: ConversationSession, params: Record<string, unknown>) {
  const tool = proposeArticleConceptsTool(session);
  const result = await tool.execute('test-call', params as never, undefined as never, undefined as never);
  const text = result.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
  return JSON.parse(text) as Record<string, unknown>;
}

describeDb('propose_article_concepts 对话工具（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
  });

  it('有当前文章上下文：排队生成并返回可恢复引用，不产生正式知识', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const documentId = await seedDocument(iso.db, userId, { topicId, blocks: ['Task 是单位。'] });
    const session = makeSession({ userId, mentions: [documentId] });

    const result = await callTool(session, {});
    expect(result['ok']).toBe(true);
    expect(result['batchId']).toBeTruthy();
    expect(result['jobId']).toBeTruthy();

    // 动作卡携带批次引用
    expect(session.actions).toHaveLength(1);
    expect(session.actions[0]).toMatchObject({
      type: 'concept_batch',
      documentId,
      topicId,
      batchId: result['batchId'],
      status: 'queued',
    });

    // 批次 queued、任务 pending；正式知识为空
    const [batch] = await iso.db
      .select()
      .from(conceptBatches)
      .where(eq(conceptBatches.id, result['batchId'] as string));
    expect(batch!.status).toBe('queued');
    expect(batch!.contentSnapshot).not.toBeNull();
    const [job] = await iso.db.select().from(jobs).where(eq(jobs.id, result['jobId'] as string));
    expect(job!.type).toBe('concept_extract');
    expect((await iso.db.select().from(concepts).where(eq(concepts.userId, userId)))).toHaveLength(0);

    // 同回合重复调用幂等
    const again = await callTool(session, {});
    expect(again['batchId']).toBe(result['batchId']);
  });

  it('缺文章上下文：返回可行动的选择要求', async () => {
    const userId = await seedUser(iso.db);
    const session = makeSession({ userId, mentions: [] });
    const result = await callTool(session, {});
    expect(result['ok']).toBe(false);
    expect(result['code']).toBe('need_document');
    expect(session.actions).toHaveLength(0);
  });

  it('多篇 @ 文章：要求用户明确一篇', async () => {
    const userId = await seedUser(iso.db);
    const a = await seedDocument(iso.db, userId);
    const b = await seedDocument(iso.db, userId);
    const session = makeSession({ userId, mentions: [a, b] });
    const result = await callTool(session, {});
    expect(result['code']).toBe('need_document');
  });

  it('文章没有主题：返回已有主题列表请用户选择，不创建主题', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId, { title: '已有主题' });
    const documentId = await seedDocument(iso.db, userId, { blocks: ['正文。'] });
    const session = makeSession({ userId, mentions: [documentId] });
    const result = await callTool(session, {});
    expect(result['ok']).toBe(false);
    expect(result['code']).toBe('need_topic');
    expect((result['topics'] as { id: string }[]).map((topic) => topic.id)).toContain(topicId);
    expect(
      (await iso.db.select().from(conceptBatches).where(eq(conceptBatches.userId, userId))),
    ).toHaveLength(0);
  });

  it('显式指定他人文章：重新鉴权，not_found', async () => {
    const userId = await seedUser(iso.db);
    const otherUser = await seedUser(iso.db);
    const foreignDoc = await seedDocument(iso.db, otherUser);
    const session = makeSession({ userId, mentions: [] });
    const result = await callTool(session, { documentId: foreignDoc });
    expect(result['ok']).toBe(false);
    expect(result['code']).toBe('not_found');
  });

  it('归档主题拒绝生成', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId, { status: 'archived' });
    const documentId = await seedDocument(iso.db, userId, { topicId });
    const session = makeSession({ userId, mentions: [documentId] });
    const result = await callTool(session, { topicId });
    expect(result['code']).toBe('topic_archived');
  });

  it('开关关闭时不入队', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const documentId = await seedDocument(iso.db, userId, { topicId });
    const session = makeSession({ userId, mentions: [documentId] });
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = false;
    try {
      const result = await callTool(session, {});
      expect(result['code']).toBe('disabled');
    } finally {
      (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
    }
    expect(
      (
        await iso.db
          .select()
          .from(jobs)
          .where(and(eq(jobs.userId, userId), eq(jobs.type, 'concept_extract')))
      ),
    ).toHaveLength(0);
  });

  it('选择 scope=selection 的批次创建在工具之外由文章入口承担', async () => {
    // 对话工具固定 scope=document；selection 走 POST /api/documents/:id/concept-batches。
    // 这里验证对话工具不产生 selection 批次（契约边界）。
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const documentId = await seedDocument(iso.db, userId, { topicId, blocks: ['正文。'] });
    const session = makeSession({ userId, mentions: [documentId] });
    const result = await callTool(session, {});
    const [batch] = await iso.db
      .select()
      .from(conceptBatches)
      .where(eq(conceptBatches.id, result['batchId'] as string));
    expect(batch!.scope).toBe('document');
  });
});
