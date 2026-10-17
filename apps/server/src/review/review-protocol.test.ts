import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { registerErrorHandler } from '../plugins/error-handler.js';
import '../types.js';
import { reviewStates } from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedCard, seedCardQuestion, seedReviewState, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { createConcept } from '../concepts/concept.service.js';
import { createConceptPractice } from '../concepts/concept-practice.service.js';
import { registerReviewRoutes } from './review.routes.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

async function buildTestApp(userId: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { id: userId };
  });
  registerErrorHandler(app);
  registerReviewRoutes(app);
  await app.ready();
  return app;
}

describeDb('复习协议 HTTP（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('旧协议不领取受管理卡；无令牌反馈 409；协议 2 全链路正常', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const concept = await createConcept(userId, topicId, { name: 'Task', aliases: [], evidence: [] });
    const practice = await createConceptPractice(userId, {
      targetKind: 'concept',
      targetId: concept.concept.id,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验任务',
      requestId: 'http-review-1',
    });
    // 普通卡（旧协议）
    const plainCard = await seedCard(iso.db, userId, {});
    await seedCardQuestion(iso.db, plainCard, {});
    await seedReviewState(iso.db, userId, plainCard, {});
    const past = new Date(Date.now() - 1000);
    await iso.db.update(reviewStates).set({ dueAt: past }).where(eq(reviewStates.userId, userId));

    const app = await buildTestApp(userId);

    // 旧客户端（无协议参数）：只见普通卡
    const oldQueue = await app.inject({ method: 'GET', url: '/api/review/today' });
    const oldIds = oldQueue.json().items.map((item: { card: { id: string } }) => item.card.id);
    expect(oldIds).toContain(plainCard);
    expect(oldIds).not.toContain(practice.cardId);

    // 协议 2：两卡都在，受管理卡带令牌
    const newQueue = await app.inject({
      method: 'GET',
      url: '/api/review/today?reviewProtocol=2',
    });
    const items = newQueue.json().items as Array<{
      card: { id: string };
      reviewToken?: string;
      servedQuestionId?: string;
    }>;
    const managed = items.find((item) => item.card.id === practice.cardId);
    expect(managed?.reviewToken).toBeTruthy();
    expect(managed?.servedQuestionId).toBe(practice.binding.questionId);
    const plain = items.find((item) => item.card.id === plainCard);
    expect(plain?.reviewToken).toBeUndefined();

    // 受管理卡无令牌（旧客户端缓存）→ 409 升级提示
    const cached = await app.inject({
      method: 'POST',
      url: `/api/review/${practice.cardId}/feedback`,
      payload: { feedback: 'remembered' },
    });
    expect(cached.statusCode).toBe(409);
    expect(cached.json().error.code).toBe('REVIEW_CLIENT_UPGRADE_REQUIRED');

    // 受管理卡带令牌 → 200
    const ok = await app.inject({
      method: 'POST',
      url: `/api/review/${practice.cardId}/feedback`,
      payload: { feedback: 'remembered', reviewToken: managed!.reviewToken, requestId: 'http-fb-1' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().log.reviewRevision).toBe(1);

    // 重放同一 requestId → 同一结果
    const replay = await app.inject({
      method: 'POST',
      url: `/api/review/${practice.cardId}/feedback`,
      payload: { feedback: 'remembered', reviewToken: managed!.reviewToken, requestId: 'http-fb-1' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().log.id).toBe(ok.json().log.id);

    // 普通卡旧协议反馈 → 200（无令牌）
    const plainOk = await app.inject({
      method: 'POST',
      url: `/api/review/${plainCard}/feedback`,
      payload: { feedback: 'fuzzy' },
    });
    expect(plainOk.statusCode).toBe(200);
    expect(plainOk.json().log.bindingId ?? null).toBeNull();

    await app.close();
  });

  it('反馈参数校验：非法 feedback 400', async () => {
    const userId = await seedUser(iso.db);
    const app = await buildTestApp(userId);
    const bad = await app.inject({
      method: 'POST',
      url: `/api/review/${crypto.randomUUID()}/feedback`,
      payload: { feedback: 'great' },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
