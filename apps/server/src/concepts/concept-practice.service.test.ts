import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cardKnowledgeLinks,
  cardQuestions,
  cards,
  conceptPracticeBindings,
  conceptRelations,
  concepts,
  reviewLogs,
  reviewStates,
  topics,
} from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import {
  seedCard,
  seedCardQuestion,
  seedDocument,
  seedReviewState,
  seedTopic,
  seedUser,
} from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import {
  addCardKnowledgeLink,
  listCardKnowledgeLinks,
  removeCardKnowledgeLink,
} from './card-knowledge.service.js';
import {
  bindExistingConceptPractice,
  createConceptPractice,
  getConceptPracticeSummary,
  getReviewEligibility,
  refreshConceptPractice,
  resumeConceptPractice,
  unbindConceptPractice,
} from './concept-practice.service.js';
import {
  archiveConcept,
  createConcept,
  createConceptRelation,
  restoreConcept,
  updateConcept,
} from './concept.service.js';
import { getDb } from '../db/index.js';
import {
  getReviewToday,
  resumeCard,
  submitReviewFeedback,
} from '../review/review.service.js';
import { updateCard } from '../cards/card.service.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

interface Fixture {
  userId: string;
  topicId: string;
  documentId: string;
  conceptId: string;
  conceptBId: string;
  relationId: string;
}

async function seedKnowledge(iso: IsolatedDb): Promise<Fixture> {
  const userId = await seedUser(iso.db);
  const topicId = await seedTopic(iso.db, userId);
  const documentId = await seedDocument(iso.db, userId, { topicId });
  const a = await createConcept(userId, topicId, { name: 'Task', aliases: [], evidence: [] });
  const b = await createConcept(userId, topicId, { name: 'Trial', aliases: [], evidence: [] });
  const relation = await createConceptRelation(userId, topicId, {
    fromConceptId: a.concept.id,
    toConceptId: b.concept.id,
    kind: 'composition',
    predicate: '包含',
    basis: 'user',
    evidence: [],
  });
  return {
    userId,
    topicId,
    documentId,
    conceptId: a.concept.id,
    conceptBId: b.concept.id,
    relationId: relation.relation.id,
  };
}

describeDb('concept-practice 绑定与复习接入（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('新建练习：卡/题/复习状态/绑定/导航链接同一事务；同目标同题型幂等', async () => {
    const f = await seedKnowledge(iso);
    const result = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验中的任务',
      requestId: 'cp-1',
    });
    expect(result.created).toBe(true);

    const [card] = await iso.db.select().from(cards).where(eq(cards.id, result.cardId));
    expect(card!.reviewRevision).toBe(1);
    expect(card!.topicId).toBe(f.topicId);
    const questions = await iso.db
      .select()
      .from(cardQuestions)
      .where(eq(cardQuestions.cardId, result.cardId));
    expect(questions).toHaveLength(1);
    expect(questions[0]!.type).toBe('cloze');
    expect(result.binding.questionId).toBe(questions[0]!.id);
    const states = await iso.db
      .select()
      .from(reviewStates)
      .where(eq(reviewStates.cardId, result.cardId));
    expect(states).toHaveLength(1);
    const links = await iso.db
      .select()
      .from(cardKnowledgeLinks)
      .where(eq(cardKnowledgeLinks.cardId, result.cardId));
    expect(links).toHaveLength(1);
    expect(links[0]!.conceptId).toBe(f.conceptId);

    // 同目标同题型幂等（新 requestId 也不重复建卡）
    const again = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '另一道题？',
      answer: '另一答案',
      requestId: 'cp-2',
    });
    expect(again.created).toBe(false);
    expect(again.cardId).toBe(result.cardId);

    // 同 requestId 重放返回原结果
    const replay = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验中的任务',
      requestId: 'cp-1',
    });
    expect(replay.cardId).toBe(result.cardId);

    // 同 requestId 不同请求 → 409
    await expect(
      createConceptPractice(f.userId, {
        targetKind: 'concept',
        targetId: f.conceptId,
        expectedVersion: 1,
        exerciseKind: 'compare',
        question: '不同请求',
        answer: 'x',
        requestId: 'cp-1',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_REQUEST_CONFLICT' });

    // 目标版本不符 → 409，无半成品
    await expect(
      createConceptPractice(f.userId, {
        targetKind: 'concept',
        targetId: f.conceptId,
        expectedVersion: 99,
        exerciseKind: 'compare',
        question: 'q',
        answer: 'a',
        requestId: 'cp-3',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_VERSION_CONFLICT' });
    expect(
      (await iso.db.select().from(cards).where(eq(cards.userId, f.userId))).length,
    ).toBe(1);
  });

  it('并发创建同一目标同一题型只建一张卡', async () => {
    const f = await seedKnowledge(iso);
    const [r1, r2] = await Promise.all([
      createConceptPractice(f.userId, {
        targetKind: 'relation',
        targetId: f.relationId,
        expectedVersion: 1,
        exerciseKind: 'compare',
        question: 'Task 和 Trial 的关系？',
        answer: '包含',
        requestId: `cc-${Math.random().toString(36).slice(2)}`,
      }),
      createConceptPractice(f.userId, {
        targetKind: 'relation',
        targetId: f.relationId,
        expectedVersion: 1,
        exerciseKind: 'compare',
        question: 'Task 和 Trial 的关系？',
        answer: '包含',
        requestId: `cc-${Math.random().toString(36).slice(2)}`,
      }),
    ]);
    expect(r1.cardId).toBe(r2.cardId);
    expect(
      (await iso.db.select().from(cards).where(eq(cards.userId, f.userId))).length,
    ).toBe(1);
  });

  it('绑定已有卡：只绑定实际首题；保留排期/暂停/历史/归属；未入队不入队', async () => {
    const f = await seedKnowledge(iso);
    const cardId = await seedCard(iso.db, f.userId, { documentId: f.documentId });
    const q1 = await seedCardQuestion(iso.db, cardId, {
      type: 'cloze',
      question: '第一题',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const q2 = await seedCardQuestion(iso.db, cardId, {
      type: 'compare',
      question: '第二题',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    const dueAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    await seedReviewState(iso.db, f.userId, cardId, {
      dueAt,
      reps: 3,
      ease: 2.7,
      intervalDays: 9,
      suspendedAt: new Date('2026-06-01T00:00:00Z'),
    });

    // 不允许选第二题却展示第一题
    await expect(
      bindExistingConceptPractice(f.userId, {
        cardId,
        questionId: q2,
        expectedReviewRevision: null,
        targetKind: 'concept',
        targetId: f.conceptId,
        expectedVersion: 1,
        exerciseKind: 'compare',
        requestId: 'bind-1',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_PRACTICE_QUESTION_MISMATCH' });

    // 题型不兼容（首题是 cloze，不能绑 compare）
    await expect(
      bindExistingConceptPractice(f.userId, {
        cardId,
        questionId: q1,
        expectedReviewRevision: null,
        targetKind: 'concept',
        targetId: f.conceptId,
        expectedVersion: 1,
        exerciseKind: 'compare',
        requestId: 'bind-2',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_PRACTICE_TYPE_MISMATCH' });

    const result = await bindExistingConceptPractice(f.userId, {
      cardId,
      questionId: q1,
      expectedReviewRevision: null,
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      requestId: 'bind-3',
    });
    expect(result.binding.questionId).toBe(q1);

    const [card] = await iso.db.select().from(cards).where(eq(cards.id, cardId));
    expect(card!.reviewRevision).toBe(1);
    const [state] = await iso.db
      .select()
      .from(reviewStates)
      .where(eq(reviewStates.cardId, cardId));
    // 原排期/暂停完全保留
    expect(state!.reps).toBe(3);
    expect(state!.ease).toBeCloseTo(2.7);
    expect(state!.intervalDays).toBe(9);
    expect(state!.dueAt.toISOString()).toBe(dueAt.toISOString());
    expect(state!.suspendedAt).not.toBeNull();
    // 其他题目保留
    const questions = await iso.db
      .select()
      .from(cardQuestions)
      .where(eq(cardQuestions.cardId, cardId));
    expect(questions).toHaveLength(2);

    // 同卡再绑 → 409（用兼容题型以到达绑定冲突检查）
    await expect(
      bindExistingConceptPractice(f.userId, {
        cardId,
        questionId: q1,
        expectedReviewRevision: 1,
        targetKind: 'relation',
        targetId: f.relationId,
        expectedVersion: 1,
        exerciseKind: 'recall',
        requestId: 'bind-4',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_PRACTICE_CONFLICT' });
  });

  it('无题卡可导航关联但不能绑定练习；主导航链接不能单独删除', async () => {
    const f = await seedKnowledge(iso);
    const cardId = await seedCard(iso.db, f.userId, {});

    const link = await addCardKnowledgeLink(f.userId, cardId, {
      targetKind: 'concept',
      targetId: f.conceptId,
    });
    expect(link.created).toBe(true);

    await expect(
      bindExistingConceptPractice(f.userId, {
        cardId,
        questionId: '00000000-0000-4000-8000-000000000000',
        expectedReviewRevision: null,
        targetKind: 'concept',
        targetId: f.conceptId,
        expectedVersion: 1,
        exerciseKind: 'recall',
        requestId: 'bind-noq',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_PRACTICE_NO_QUESTION' });

    // 建立绑定后主导航链接拒绝单独删除
    await seedCardQuestion(iso.db, cardId, { type: 'cloze' });
    await bindExistingConceptPractice(f.userId, {
      cardId,
      questionId: (
        await iso.db
          .select()
          .from(cardQuestions)
          .where(eq(cardQuestions.cardId, cardId))
      )[0]!.id,
      expectedReviewRevision: null,
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      requestId: 'bind-noq-2',
    });
    await expect(
      removeCardKnowledgeLink(f.userId, cardId, link.link.id),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_LINK_BOUND' });

    // 其他链接可删
    const other = await addCardKnowledgeLink(f.userId, cardId, {
      targetKind: 'relation',
      targetId: f.relationId,
    });
    await removeCardKnowledgeLink(f.userId, cardId, other.link.id);
    const links = await listCardKnowledgeLinks(f.userId, cardId);
    expect(links).toHaveLength(1);
  });

  it('协议分流：旧客户端不领取受管理卡；协议2 下发首题与令牌；缓存无令牌反馈被拒', async () => {
    const f = await seedKnowledge(iso);
    const practice = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验任务',
      requestId: 'proto-1',
    });
    // 到期
    await iso.db
      .update(reviewStates)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(reviewStates.cardId, practice.cardId));

    const oldClient = await getReviewToday(f.userId, new Date());
    expect(oldClient.items.map((item) => item.card.id)).not.toContain(practice.cardId);

    const newClient = await getReviewToday(f.userId, new Date(), 2);
    const item = newClient.items.find((entry) => entry.card.id === practice.cardId);
    expect(item).toBeDefined();
    expect(item!.servedQuestionId).toBe(practice.binding.questionId);
    expect(item!.reviewToken).toBeTruthy();

    // 缓存的无令牌反馈 → 409
    await expect(
      submitReviewFeedback(f.userId, practice.cardId, 'remembered'),
    ).rejects.toMatchObject({ status: 409, code: 'REVIEW_CLIENT_UPGRADE_REQUIRED' });

    // 携带令牌正常反馈；日志带归属
    const result = await submitReviewFeedback(f.userId, practice.cardId, 'remembered', new Date(), {
      reviewToken: item!.reviewToken!,
      requestId: 'fb-1',
    });
    expect(result.log.bindingId).toBe(practice.binding.id);
    expect(result.log.epochId).toBe(practice.binding.epochId);
    expect(result.log.targetVersion).toBe(1);
    expect(result.log.reviewRevision).toBe(1);
    expect(result.log.questionId).toBe(practice.binding.questionId);

    // 重复 requestId 只计一次
    const again = await submitReviewFeedback(f.userId, practice.cardId, 'remembered', new Date(), {
      reviewToken: item!.reviewToken!,
      requestId: 'fb-1',
    });
    expect(again.log.id).toBe(result.log.id);
    const logs = await iso.db
      .select()
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, f.userId), eq(reviewLogs.cardId, practice.cardId)));
    expect(logs).toHaveLength(1);

    // 同 key 不同请求 → 409
    await expect(
      submitReviewFeedback(f.userId, practice.cardId, 'forgot', new Date(), {
        reviewToken: item!.reviewToken!,
        requestId: 'fb-1',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_REQUEST_CONFLICT' });
  });

  it('旧客户端缓存的受管理卡反馈（无令牌）被拒；普通卡旧协议兼容', async () => {
    const f = await seedKnowledge(iso);
    const plainCard = await seedCard(iso.db, f.userId, {});
    const plain = await submitReviewFeedback(f.userId, plainCard, 'forgot');
    expect(plain.log.bindingId ?? null).toBeNull();
    expect(plain.log.reviewRevision ?? null).toBeNull();
  });

  it('知识失效/归档：旧恢复不能绕过；归档恢复后保留参数，显式 resume 才可复习', async () => {
    const f = await seedKnowledge(iso);
    const practice = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验任务',
      requestId: 'arch-1',
    });
    const ease = 2.5;

    // 归档概念 → resumeRequired + 动态阻断；旧恢复拒绝
    await archiveConcept(f.userId, f.conceptId, 1);
    let eligibility = await getReviewEligibility(getDb(), f.userId, practice.cardId);
    expect(eligibility.knowledgeBlocks).toContain('target_archived');
    expect(eligibility.knowledgeBlocks).toContain('resume_required');
    await expect(resumeCard(f.userId, practice.cardId)).rejects.toMatchObject({
      status: 409,
      code: 'REVIEW_NOT_ELIGIBLE',
    });
    // 归档中练习队列不可见
    await iso.db
      .update(reviewStates)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(reviewStates.cardId, practice.cardId));
    const queueArchived = await getReviewToday(f.userId, new Date(), 2);
    expect(queueArchived.items.map((item) => item.card.id)).not.toContain(practice.cardId);

    // 恢复概念不自动恢复练习
    await restoreConcept(f.userId, f.conceptId, 1);
    eligibility = await getReviewEligibility(getDb(), f.userId, practice.cardId);
    expect(eligibility.knowledgeBlocks).toEqual(['resume_required']);

    // 显式 resume：只清恢复门槛，排期参数保留
    const [cardRow] = await iso.db.select().from(cards).where(eq(cards.id, practice.cardId));
    const resumed = await resumeConceptPractice(f.userId, practice.binding.id, {
      expectedReviewRevision: cardRow!.reviewRevision!,
    });
    expect(resumed.resumeRequired).toBe(false);
    const [state] = await iso.db
      .select()
      .from(reviewStates)
      .where(eq(reviewStates.cardId, practice.cardId));
    expect(state!.ease).toBeCloseTo(ease);

    // 过期卡 resume 后正常入队（协议 2）
    const queue = await getReviewToday(f.userId, new Date(), 2);
    expect(queue.items.map((item) => item.card.id)).toContain(practice.cardId);
  });

  it('手动暂停 → 知识更新 → refresh 后仍手动暂停；refresh 只改绑定首题', async () => {
    const f = await seedKnowledge(iso);
    const practice = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验任务',
      requestId: 'refresh-1',
    });
    // 手动暂停
    const { suspendCard } = await import('../review/review.service.js');
    await suspendCard(f.userId, practice.cardId);

    // 知识语义更新 → needsRefresh + 版本轮换
    await updateConcept(f.userId, f.conceptId, {
      expectedVersion: 1,
      definition: '更新后的定义',
    });
    let [binding] = await iso.db
      .select()
      .from(conceptPracticeBindings)
      .where(eq(conceptPracticeBindings.id, practice.binding.id));
    expect(binding!.needsRefresh).toBe(true);
    let [cardRow] = await iso.db.select().from(cards).where(eq(cards.id, practice.cardId));
    expect(cardRow!.reviewRevision).toBe(2);

    // 知识阻断时队列不可见（协议 2 也一样）
    await iso.db
      .update(reviewStates)
      .set({ dueAt: new Date(Date.now() - 1000), suspendedAt: null })
      .where(eq(reviewStates.cardId, practice.cardId));
    // 注意：这里为了演示先清除手动暂停验证阻断，再恢复手动暂停
    const queueBlocked = await getReviewToday(f.userId, new Date(), 2);
    expect(queueBlocked.items.map((item) => item.card.id)).not.toContain(practice.cardId);
    await iso.db
      .update(reviewStates)
      .set({ suspendedAt: new Date() })
      .where(eq(reviewStates.cardId, practice.cardId));

    // refresh 更新首题、轮换 epoch/版本、重置学习参数，保留手动暂停
    const refreshed = await refreshConceptPractice(f.userId, practice.binding.id, {
      questionId: practice.binding.questionId,
      expectedTargetVersion: 2,
      expectedReviewRevision: 2,
      question: '什么是 Task（新定义）？',
      answer: '更新后的定义',
    });
    expect(refreshed.needsRefresh).toBe(false);
    expect(refreshed.epochId).not.toBe(practice.binding.epochId);
    expect(refreshed.targetVersion).toBe(2);

    const [state] = await iso.db
      .select()
      .from(reviewStates)
      .where(eq(reviewStates.cardId, practice.cardId));
    expect(state!.reps).toBe(0);
    expect(state!.suspendedAt).not.toBeNull(); // 手动暂停保留

    [cardRow] = await iso.db.select().from(cards).where(eq(cards.id, practice.cardId));
    expect(cardRow!.reviewRevision).toBe(3);
  });

  it('refresh 完成后旧令牌被拒绝，日志与排期不变；新令牌可用', async () => {
    const f = await seedKnowledge(iso);
    const practice = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '旧题面？',
      answer: '旧答案',
      requestId: 'stale-token-1',
    });
    await iso.db
      .update(reviewStates)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(reviewStates.cardId, practice.cardId));

    // 标签 A：读旧题
    const queueA = await getReviewToday(f.userId, new Date(), 2);
    const itemA = queueA.items.find((item) => item.card.id === practice.cardId)!;
    const oldToken = itemA.reviewToken!;

    // 标签 B：更新并 refresh
    await updateConcept(f.userId, f.conceptId, {
      expectedVersion: 1,
      definition: '新定义',
    });
    const [cardRow] = await iso.db.select().from(cards).where(eq(cards.id, practice.cardId));
    await refreshConceptPractice(f.userId, practice.binding.id, {
      questionId: practice.binding.questionId,
      expectedTargetVersion: 2,
      expectedReviewRevision: cardRow!.reviewRevision!,
      question: '新题面？',
      answer: '新答案',
    });

    // 标签 A 的迟到反馈被拒，排期与日志不变
    const logsBefore = await iso.db
      .select()
      .from(reviewLogs)
      .where(eq(reviewLogs.cardId, practice.cardId));
    const [stateBefore] = await iso.db
      .select()
      .from(reviewStates)
      .where(eq(reviewStates.cardId, practice.cardId));
    await expect(
      submitReviewFeedback(f.userId, practice.cardId, 'remembered', new Date(), {
        reviewToken: oldToken,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'REVIEW_CONTENT_CHANGED' });
    const logsAfter = await iso.db
      .select()
      .from(reviewLogs)
      .where(eq(reviewLogs.cardId, practice.cardId));
    expect(logsAfter).toHaveLength(logsBefore.length);
    const [stateAfter] = await iso.db
      .select()
      .from(reviewStates)
      .where(eq(reviewStates.cardId, practice.cardId));
    expect(stateAfter!.updatedAt).toEqual(stateBefore!.updatedAt);

    // 新令牌可用（refresh 重置排期到明天，这里把到期时间拨到过去模拟到期）
    await iso.db
      .update(reviewStates)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(reviewStates.cardId, practice.cardId));
    const queueB = await getReviewToday(f.userId, new Date(), 2);
    const itemB = queueB.items.find((item) => item.card.id === practice.cardId)!;
    const ok = await submitReviewFeedback(f.userId, practice.cardId, 'fuzzy', new Date(), {
      reviewToken: itemB.reviewToken!,
    });
    expect(ok.log.bindingId).toBe(practice.binding.id);
  });

  it('旧接口/Agent 改首题触发版本保护；改第二题只递增版本不标 needsRefresh', async () => {
    const f = await seedKnowledge(iso);
    const cardId = await seedCard(iso.db, f.userId, {});
    const q1 = await seedCardQuestion(iso.db, cardId, {
      type: 'cloze',
      question: '首题',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const q2 = await seedCardQuestion(iso.db, cardId, {
      type: 'cloze',
      question: '第二题',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    const bound = await bindExistingConceptPractice(f.userId, {
      cardId,
      questionId: q1,
      expectedReviewRevision: null,
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      requestId: 'guard-1',
    });

    // 改第二题：版本递增，不标 needsRefresh
    await updateCard(f.userId, cardId, {
      questions: [
        { id: q1, type: 'cloze', question: '首题', answer: '答案。' },
        { id: q2, type: 'cloze', question: '第二题（改）', answer: '答案。' },
      ],
    });
    let [binding] = await iso.db
      .select()
      .from(conceptPracticeBindings)
      .where(eq(conceptPracticeBindings.id, bound.binding.id));
    let [cardRow] = await iso.db.select().from(cards).where(eq(cards.id, cardId));
    expect(binding!.needsRefresh).toBe(false);
    expect(cardRow!.reviewRevision).toBe(2);

    // 改首题题面：needsRefresh
    await updateCard(f.userId, cardId, {
      questions: [
        { id: q1, type: 'cloze', question: '首题（改）', answer: '答案。' },
        { id: q2, type: 'cloze', question: '第二题（改）', answer: '答案。' },
      ],
    });
    [binding] = await iso.db
      .select()
      .from(conceptPracticeBindings)
      .where(eq(conceptPracticeBindings.id, bound.binding.id));
    [cardRow] = await iso.db.select().from(cards).where(eq(cards.id, cardId));
    expect(binding!.needsRefresh).toBe(true);
    expect(cardRow!.reviewRevision).toBe(3);

    // 删除首题：needsRefresh 保持（已是 true），版本再递增
    await updateCard(f.userId, cardId, {
      questions: [{ id: q2, type: 'cloze', question: '第二题（改）', answer: '答案。' }],
    });
    [binding] = await iso.db
      .select()
      .from(conceptPracticeBindings)
      .where(eq(conceptPracticeBindings.id, bound.binding.id));
    expect(binding!.needsRefresh).toBe(true);

    // 未受管理卡不受版本保护影响
    const plainCard = await seedCard(iso.db, f.userId, {});
    const plainQ = await seedCardQuestion(iso.db, plainCard, {});
    await updateCard(f.userId, plainCard, { questions: [{ id: plainQ, type: 'cloze', question: '改', answer: 'x' }] });
    const [plain] = await iso.db.select().from(cards).where(eq(cards.id, plainCard));
    expect(plain!.reviewRevision).toBeNull();
  });

  it('解绑 A 再绑 B：B 不继承 A 的反馈，卡片历史保留', async () => {
    const f = await seedKnowledge(iso);
    const practiceA = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验任务',
      requestId: 'rebind-1',
    });
    const queue = await getReviewToday(f.userId, new Date(), 2);
    await iso.db
      .update(reviewStates)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(reviewStates.cardId, practiceA.cardId));
    const queue2 = await getReviewToday(f.userId, new Date(), 2);
    const item = (queue2.items.length > 0 ? queue2 : queue).items.find(
      (entry) => entry.card.id === practiceA.cardId,
    )!;
    await submitReviewFeedback(f.userId, practiceA.cardId, 'remembered', new Date(), {
      reviewToken: item.reviewToken!,
    });

    // 解绑 A
    await unbindConceptPractice(f.userId, practiceA.binding.id);
    const summaryA = await getConceptPracticeSummary(getDb(), {
      userId: f.userId,
      conceptId: f.conceptId,
    });
    expect(summaryA.binding).toBeNull(); // 活动绑定已终止

    // 绑 B（另一概念）同一卡
    const [cardRow] = await iso.db.select().from(cards).where(eq(cards.id, practiceA.cardId));
    const firstQuestion = (
      await iso.db.select().from(cardQuestions).where(eq(cardQuestions.cardId, practiceA.cardId))
    )[0]!;
    const boundB = await bindExistingConceptPractice(f.userId, {
      cardId: practiceA.cardId,
      questionId: firstQuestion.id,
      expectedReviewRevision: cardRow!.reviewRevision,
      targetKind: 'concept',
      targetId: f.conceptBId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      requestId: 'rebind-2',
    });
    expect(boundB.binding.targetVersion).toBe(1);

    // B 显示「未练习」：不继承 A 的反馈
    const summaryB = await getConceptPracticeSummary(getDb(), {
      userId: f.userId,
      conceptId: f.conceptBId,
    });
    expect(summaryB.feedbackCount).toBe(0);
    expect(summaryB.lastFeedback).toBeNull();

    // 卡片历史保留（A 的日志仍在，归属旧绑定）
    const logs = await iso.db
      .select()
      .from(reviewLogs)
      .where(eq(reviewLogs.cardId, practiceA.cardId));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.bindingId).toBe(practiceA.binding.id);
  });

  it('概念定义练习与关系练习的反馈互不干扰', async () => {
    const f = await seedKnowledge(iso);
    const conceptPractice = await createConceptPractice(f.userId, {
      targetKind: 'concept',
      targetId: f.conceptId,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验任务',
      requestId: 'sep-1',
    });
    const relationPractice = await createConceptPractice(f.userId, {
      targetKind: 'relation',
      targetId: f.relationId,
      expectedVersion: 1,
      exerciseKind: 'compare',
      question: 'Task 与 Trial 什么关系？',
      answer: '包含',
      requestId: 'sep-2',
    });
    expect(relationPractice.cardId).not.toBe(conceptPractice.cardId);
    const [q] = await iso.db
      .select()
      .from(cardQuestions)
      .where(eq(cardQuestions.cardId, relationPractice.cardId));
    expect(q!.type).toBe('compare');

    // 概念答对，关系不受影响
    await iso.db
      .update(reviewStates)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(reviewStates.userId, f.userId));
    const queue = await getReviewToday(f.userId, new Date(), 2);
    const item = queue.items.find((entry) => entry.card.id === conceptPractice.cardId)!;
    await submitReviewFeedback(f.userId, conceptPractice.cardId, 'remembered', new Date(), {
      reviewToken: item.reviewToken!,
    });

    const conceptSummary = await getConceptPracticeSummary(getDb(), {
      userId: f.userId,
      conceptId: f.conceptId,
    });
    const relationSummary = await getConceptPracticeSummary(getDb(), {
      userId: f.userId,
      relationId: f.relationId,
    });
    expect(conceptSummary.feedbackCount).toBe(1);
    expect(conceptSummary.lastFeedback).toBe('remembered');
    expect(relationSummary.feedbackCount).toBe(0);
  });
});
