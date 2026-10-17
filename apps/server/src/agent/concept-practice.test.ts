import type { Context } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../llm/pi.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../llm/pi.js')>();
  return {
    ...original,
    resolveModelFor: async () => fakeResolvedModel(currentScript),
  };
});

import { config } from '../config.js';
import {
  cards,
  conceptPracticeBindings,
  conceptPracticeProposals,
  jobs,
  reviewStates,
} from '../db/schema.js';
import { fakeResolvedModel, lastToolResult, type FakeModelScript } from '../testkit/fake-model.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { createConcept, updateConcept } from '../concepts/concept.service.js';
import {
  createConceptPracticeProposal,
  getConceptPracticeProposal,
} from '../concepts/concept-proposal.service.js';
import { createConceptPractice } from '../concepts/concept-practice.service.js';
import { cancelJob } from '../jobs/jobs.service.js';
import { processConceptPractice } from './concept-practice.js';

let currentScript: FakeModelScript = () => ({ text: '完成' });

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

/** 提交一次题目后收尾。 */
function proposeScript(question: string, answer: string): FakeModelScript {
  return (context: Context) => {
    const last = lastToolResult(context);
    if (last?.name === 'submit_exercise') return { text: '已出题' };
    return { toolCalls: [{ name: 'submit_exercise', arguments: { question, answer } }] };
  };
}

describeDb('concept_practice 出题建议（真实 PG + 确定性模型）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('建议只产生 proposal，确认前不写卡/绑定/排期', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const concept = await createConcept(userId, topicId, {
      name: 'Task',
      aliases: [],
      definition: '实验中的任务',
      evidence: [],
    });

    const { proposalId, jobId } = await createConceptPracticeProposal(userId, {
      targetKind: 'concept',
      targetId: concept.concept.id,
      exerciseKind: 'recall',
      requestId: 'prop-1',
    });

    currentScript = proposeScript('什么是 Task？', '实验中的任务');
    const [job] = await iso.db.select().from(jobs).where(eq(jobs.id, jobId));
    await iso.db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, jobId));
    await processConceptPractice(job!);

    const proposal = await getConceptPracticeProposal(userId, proposalId);
    expect(proposal.status).toBe('ready');
    expect(proposal.question).toBe('什么是 Task？');
    expect(proposal.answer).toBe('实验中的任务');
    expect(proposal.targetVersion).toBe(1);
    expect(proposal.currentTargetVersion).toBe(1);

    // 确认前没有卡/绑定/排期
    expect((await iso.db.select().from(cards).where(eq(cards.userId, userId)))).toHaveLength(0);
    expect(
      (await iso.db.select().from(conceptPracticeBindings).where(eq(conceptPracticeBindings.userId, userId))),
    ).toHaveLength(0);
    expect(
      (await iso.db.select().from(reviewStates).where(eq(reviewStates.userId, userId))),
    ).toHaveLength(0);

    // 用户确认题面答案后才入队
    const practice = await createConceptPractice(userId, {
      targetKind: 'concept',
      targetId: concept.concept.id,
      expectedVersion: 1,
      exerciseKind: 'recall',
      question: proposal.question!,
      answer: proposal.answer!,
      requestId: 'prop-confirm-1',
    });
    expect(practice.created).toBe(true);
    expect(
      (await iso.db.select().from(reviewStates).where(eq(reviewStates.userId, userId))),
    ).toHaveLength(1);
  });

  it('建议生成后目标版本变化：currentTargetVersion 漂移可见，旧版本确认被拒', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const concept = await createConcept(userId, topicId, {
      name: 'Trial',
      aliases: [],
      definition: '单次执行',
      evidence: [],
    });
    const { proposalId, jobId } = await createConceptPracticeProposal(userId, {
      targetKind: 'concept',
      targetId: concept.concept.id,
      exerciseKind: 'recall',
      requestId: 'prop-stale-1',
    });
    currentScript = proposeScript('什么是 Trial？', '单次执行');
    const [job] = await iso.db.select().from(jobs).where(eq(jobs.id, jobId));
    await iso.db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, jobId));
    await processConceptPractice(job!);

    // 目标语义更新
    await updateConcept(userId, concept.concept.id, { expectedVersion: 1, definition: '一次试次' });
    const proposal = await getConceptPracticeProposal(userId, proposalId);
    expect(proposal.targetVersion).toBe(1);
    expect(proposal.currentTargetVersion).toBe(2);

    // 未经复核按旧版本入队被拒
    await expect(
      createConceptPractice(userId, {
        targetKind: 'concept',
        targetId: concept.concept.id,
        expectedVersion: 1,
        exerciseKind: 'recall',
        question: proposal.question!,
        answer: proposal.answer!,
        requestId: 'prop-stale-confirm',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_VERSION_CONFLICT' });
  });

  it('取消：建议同步 cancelled，迟到执行不改写', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const concept = await createConcept(userId, topicId, { name: 'Step', aliases: [], evidence: [] });
    const { proposalId, jobId } = await createConceptPracticeProposal(userId, {
      targetKind: 'concept',
      targetId: concept.concept.id,
      exerciseKind: 'recall',
      requestId: 'prop-cancel-1',
    });
    await cancelJob(userId, jobId);
    let [row] = await iso.db
      .select()
      .from(conceptPracticeProposals)
      .where(eq(conceptPracticeProposals.id, proposalId));
    expect(row!.status).toBe('cancelled');

    currentScript = proposeScript('什么是 Step？', '步骤');
    const [job] = await iso.db.select().from(jobs).where(eq(jobs.id, jobId));
    await processConceptPractice(job!);
    [row] = await iso.db
      .select()
      .from(conceptPracticeProposals)
      .where(eq(conceptPracticeProposals.id, proposalId));
    expect(row!.status).toBe('cancelled');
    expect(row!.question).toBeNull();
  });

  it('模型未提交题目：终态失败，批次不入复习', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const concept = await createConcept(userId, topicId, { name: 'Loop', aliases: [], evidence: [] });
    const { proposalId, jobId } = await createConceptPracticeProposal(userId, {
      targetKind: 'concept',
      targetId: concept.concept.id,
      exerciseKind: 'scenario',
      requestId: 'prop-fail-1',
    });
    currentScript = () => ({ text: '我不出题' });
    const [job] = await iso.db.select().from(jobs).where(eq(jobs.id, jobId));
    await iso.db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, jobId));
    await expect(processConceptPractice(job!)).rejects.toThrow();
    const proposal = await getConceptPracticeProposal(userId, proposalId);
    // 补跑后仍无提交 → 终态失败
    expect(proposal.status).toBe('failed');
    expect(proposal.errorCode).toBe('no_submission');
    expect(
      (await iso.db.select().from(cards).where(eq(cards.userId, userId))),
    ).toHaveLength(0);
  });

  it('开关关闭时不创建建议', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const concept = await createConcept(userId, topicId, { name: 'Gate', aliases: [], evidence: [] });
    (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = false;
    try {
      await expect(
        createConceptPracticeProposal(userId, {
          targetKind: 'concept',
          targetId: concept.concept.id,
          exerciseKind: 'recall',
          requestId: 'prop-gate-1',
        }),
      ).rejects.toMatchObject({ status: 404, code: 'CONCEPTS_DISABLED' });
    } finally {
      (config as { CONCEPTS_ENABLED: boolean }).CONCEPTS_ENABLED = true;
    }
  });

  it('同 requestId 幂等；归档目标拒绝', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const concept = await createConcept(userId, topicId, { name: 'Idem', aliases: [], evidence: [] });
    const input = {
      targetKind: 'concept' as const,
      targetId: concept.concept.id,
      exerciseKind: 'recall' as const,
      requestId: 'prop-idem-1',
    };
    const first = await createConceptPracticeProposal(userId, input);
    const second = await createConceptPracticeProposal(userId, input);
    expect(second).toEqual(first);
    await expect(
      createConceptPracticeProposal(userId, { ...input, exerciseKind: 'compare' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCEPT_REQUEST_CONFLICT' });
  });
});
