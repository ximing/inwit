import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { conceptPracticeJobPayloadSchema, EXERCISE_TO_QUESTION_TYPE } from '@inwit/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  conceptEvidence,
  conceptPracticeProposals,
  conceptRelations,
  concepts,
} from '../db/schema.js';
import { isJobRunning } from '../jobs/heartbeat.js';
import { logger } from '../utils/logger.js';
import { runAgentJob, AgentTerminalError } from './run-agent-job.js';
import type { JobRow } from '../db/schema.js';

/**
 * concept_practice 处理器：为一个已确认的概念/关系生成练习题候选。
 * 只写 concept_practice_proposals（question/answer），不建卡、不建绑定、不入队复习。
 */

const submitExerciseSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(4000),
});

const EXERCISE_GUIDE: Record<string, string> = {
  recall: '概念回忆（cloze 填空）：题面回忆定义/关键表述，答案是定义要点',
  compare: '关系辨析（compare 对比）：题面要求区分两个概念或判断关系方向，答案给出区别要点',
  scenario: '场景判断（judge 判断）：题面给一个具体场景，答案是对该场景是否成立/属于该关系的判断与理由',
};

async function loadTargetMaterial(
  userId: string,
  proposal: { conceptId: string | null; relationId: string | null },
): Promise<{ title: string; body: string } | null> {
  if (proposal.conceptId) {
    const [concept] = await getDb()
      .select()
      .from(concepts)
      .where(and(eq(concepts.id, proposal.conceptId), eq(concepts.userId, userId)))
      .limit(1);
    if (!concept || concept.archivedAt) return null;
    const evidence = await getDb()
      .select({ quote: conceptEvidence.quote })
      .from(conceptEvidence)
      .where(eq(conceptEvidence.conceptId, concept.id))
      .limit(5);
    const body = [
      `概念：${concept.name}${concept.sense ? `（${concept.sense}）` : ''}`,
      concept.definition ? `定义：${concept.definition}` : '',
      concept.example ? `例子：${concept.example}` : '',
      evidence.length > 0 ? `原文出处：\n${evidence.map((row) => `「${row.quote}」`).join('；')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { title: concept.name, body };
  }
  if (proposal.relationId) {
    const [relation] = await getDb()
      .select()
      .from(conceptRelations)
      .where(and(eq(conceptRelations.id, proposal.relationId), eq(conceptRelations.userId, userId)))
      .limit(1);
    if (!relation || relation.archivedAt) return null;
    const endpoints = await getDb()
      .select({ id: concepts.id, name: concepts.name })
      .from(concepts)
      .where(inArray(concepts.id, [relation.fromConceptId, relation.toConceptId]));
    const nameOf = (id: string) => endpoints.find((row) => row.id === id)?.name ?? '';
    const evidence = await getDb()
      .select({ quote: conceptEvidence.quote })
      .from(conceptEvidence)
      .where(eq(conceptEvidence.relationId, relation.id))
      .limit(5);
    const statement = `${nameOf(relation.fromConceptId)} → ${relation.predicate} → ${nameOf(relation.toConceptId)}`;
    const body = [
      `关系：${statement}`,
      relation.context ? `语境：${relation.context}` : '',
      relation.explanation ? `解释：${relation.explanation}` : '',
      relation.example ? `例子：${relation.example}` : '',
      evidence.length > 0 ? `原文出处：\n${evidence.map((row) => `「${row.quote}」`).join('；')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { title: statement, body };
  }
  return null;
}

export async function processConceptPractice(job: JobRow): Promise<void> {
  const parsed = conceptPracticeJobPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new AgentTerminalError('concept_practice job payload invalid', 'bad_payload');
  const { proposalId } = parsed.data;

  const [proposal] = await getDb()
    .select()
    .from(conceptPracticeProposals)
    .where(and(eq(conceptPracticeProposals.id, proposalId), eq(conceptPracticeProposals.userId, job.userId)))
    .limit(1);
  if (!proposal) throw new AgentTerminalError('concept practice proposal missing', 'proposal_missing');
  // 幂等：终态建议不被迟到/重复执行改写
  if (proposal.status !== 'queued' && proposal.status !== 'running') {
    logger.info('concept_practice.skip', { jobId: job.id, proposalId, status: proposal.status });
    return;
  }
  await getDb()
    .update(conceptPracticeProposals)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(conceptPracticeProposals.id, proposalId), inArray(conceptPracticeProposals.status, ['queued', 'running'])));

  const material = await loadTargetMaterial(job.userId, proposal);
  if (!material) {
    await getDb()
      .update(conceptPracticeProposals)
      .set({ status: 'failed', errorCode: 'target_unavailable', updatedAt: new Date() })
      .where(and(eq(conceptPracticeProposals.id, proposalId), inArray(conceptPracticeProposals.status, ['queued', 'running'])));
    throw new AgentTerminalError('practice target unavailable', 'target_unavailable');
  }

  let submitted: { question: string; answer: string } | null = null;
  let verifyFailures = 0;
  const submitTool: AgentTool = {
    name: 'submit_exercise',
    label: '提交练习题',
    description: '提交一题练习候选。question 是题面，answer 是答案；内容必须基于给出的知识材料，不要编造出处。',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 2000 }),
      answer: Type.String({ minLength: 1, maxLength: 4000 }),
    }),
    execute: async (_id, params) => {
      const parsedParams = submitExerciseSchema.safeParse(params);
      if (!parsedParams.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, reason: '结构不合法' }) }],
          details: { ok: false },
          isError: true,
        };
      }
      submitted = parsedParams.data;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
        details: { ok: true },
      };
    },
  };

  try {
    await runAgentJob({
      job,
      agentType: 'concept_practice',
      systemPrompt: `你是 Inwit 的练习出题助手。根据给出的知识材料出一道练习题，用 submit_exercise 提交。题面不要直接泄露答案；答案准确、简洁、基于材料。`,
      userPrompt: `练习类型：${EXERCISE_GUIDE[proposal.exerciseKind] ?? proposal.exerciseKind}\n\n知识材料：\n${material.body}`,
      tools: [submitTool],
      maxTurns: 6,
      context: { topicId: proposal.topicId },
      nudgePrompt: '还没有提交练习题。请调用 submit_exercise 提交题面和答案。',
      verify: async () => {
        if (!submitted) {
          // 一次补跑机会；仍无提交则终态失败（不反复重试）。
          verifyFailures += 1;
          if (verifyFailures >= 2) {
            throw new AgentTerminalError('没有提交题目', 'no_submission');
          }
          throw new Error('没有提交题目');
        }
        const [updated] = await getDb()
          .update(conceptPracticeProposals)
          .set({
            status: 'ready',
            question: submitted.question,
            answer: submitted.answer,
            errorCode: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(conceptPracticeProposals.id, proposalId),
              inArray(conceptPracticeProposals.status, ['queued', 'running']),
            ),
          )
          .returning({ id: conceptPracticeProposals.id });
        if (!updated) return 'skipped=1';
        return `proposal=${proposalId}`;
      },
    });
  } catch (err) {
    if (err instanceof AgentTerminalError && (await isJobRunning(job.id))) {
      await getDb()
        .update(conceptPracticeProposals)
        .set({
          status: 'failed',
          errorCode: err.resultSummary ?? 'practice_failed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conceptPracticeProposals.id, proposalId),
            inArray(conceptPracticeProposals.status, ['queued', 'running']),
          ),
        );
    }
    throw err;
  }
}
