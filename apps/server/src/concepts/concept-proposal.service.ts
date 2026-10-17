import type {
  ConceptPracticeProposal,
  CreateConceptPracticeProposalInput,
  CreateConceptPracticeProposalResult,
} from '@inwit/dto';
import { createConceptPracticeProposalInputSchema } from '@inwit/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  conceptPracticeProposals,
  conceptRelations,
  concepts,
  type ConceptPracticeProposalRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueJob } from '../jobs/enqueue.js';

import { requireActiveTopic } from './concept.service.js';
import { requestHashOf } from './concept-identity.js';
import { conceptOperationRequests } from '../db/schema.js';
import type { z } from 'zod';

/**
 * 智能出题建议：只产生 proposal（question/answer 候选），不写 cards/绑定/排期。
 * 用户确认题面和答案后走 createConceptPractice 才入队复习。
 */

async function currentTargetVersion(
  userId: string,
  target: { conceptId?: string; relationId?: string },
): Promise<{ topicId: string; version: number }> {
  if (target.conceptId) {
    const [row] = await getDb()
      .select()
      .from(concepts)
      .where(and(eq(concepts.id, target.conceptId), eq(concepts.userId, userId)))
      .limit(1);
    if (!row) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    if (row.archivedAt) throw AppError.of(409, 'CONCEPT_ARCHIVED');
    return { topicId: row.topicId, version: row.version };
  }
  const [row] = await getDb()
    .select()
    .from(conceptRelations)
    .where(and(eq(conceptRelations.id, target.relationId!), eq(conceptRelations.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
  if (row.archivedAt) throw AppError.of(409, 'CONCEPT_RELATION_ARCHIVED');
  return { topicId: row.topicId, version: row.version };
}

export function toPublicProposal(
  row: ConceptPracticeProposalRow,
  currentTargetVersion: number | null,
): ConceptPracticeProposal {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    conceptId: row.conceptId,
    relationId: row.relationId,
    targetVersion: row.targetVersion,
    exerciseKind: row.exerciseKind,
    jobId: row.jobId,
    status: row.status,
    question: row.question,
    answer: row.answer,
    errorCode: row.errorCode,
    currentTargetVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createConceptPracticeProposal(
  userId: string,
  rawInput: z.input<typeof createConceptPracticeProposalInputSchema>,
): Promise<CreateConceptPracticeProposalResult> {
  const input = createConceptPracticeProposalInputSchema.parse(rawInput);
  const target =
    input.targetKind === 'concept'
      ? { conceptId: input.targetId }
      : { relationId: input.targetId };
  const requestHash = requestHashOf({ ...input, requestId: undefined });

  return getDb().transaction(async (tx) => {
    const [existingRequest] = await tx
      .select()
      .from(conceptOperationRequests)
      .where(
        and(
          eq(conceptOperationRequests.userId, userId),
          eq(conceptOperationRequests.operation, 'concept_proposal_create'),
          eq(conceptOperationRequests.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (existingRequest) {
      if (existingRequest.requestHash !== requestHash) {
        throw AppError.of(409, 'CONCEPT_REQUEST_CONFLICT');
      }
      return existingRequest.responseJson as CreateConceptPracticeProposalResult;
    }

    const targetInfo = await currentTargetVersion(userId, target);
    // 归档主题不出题
    await requireActiveTopic(userId, targetInfo.topicId);
    const [proposal] = await tx
      .insert(conceptPracticeProposals)
      .values({
        userId,
        topicId: targetInfo.topicId,
        conceptId: target.conceptId ?? null,
        relationId: target.relationId ?? null,
        targetVersion: targetInfo.version,
        exerciseKind: input.exerciseKind,
        status: 'queued',
      })
      .returning();
    if (!proposal) throw AppError.of(500, 'INTERNAL_ERROR');
    const job = await enqueueJob(tx, {
      userId,
      type: 'concept_practice',
      payload: { proposalId: proposal.id },
    });
    await tx
      .update(conceptPracticeProposals)
      .set({ jobId: job.id })
      .where(eq(conceptPracticeProposals.id, proposal.id));
    const result: CreateConceptPracticeProposalResult = {
      proposalId: proposal.id,
      jobId: job.id,
    };
    await tx.insert(conceptOperationRequests).values({
      userId,
      operation: 'concept_proposal_create',
      requestId: input.requestId,
      requestHash,
      responseJson: result,
    });
    return result;
  });
}

export async function getConceptPracticeProposal(
  userId: string,
  proposalId: string,
): Promise<ConceptPracticeProposal> {
  const [row] = await getDb()
    .select()
    .from(conceptPracticeProposals)
    .where(and(eq(conceptPracticeProposals.id, proposalId), eq(conceptPracticeProposals.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CONCEPT_PROPOSAL_NOT_FOUND');
  const current = row.conceptId
    ? await getDb()
        .select({ version: concepts.version, archivedAt: concepts.archivedAt })
        .from(concepts)
        .where(eq(concepts.id, row.conceptId))
        .limit(1)
    : await getDb()
        .select({ version: conceptRelations.version, archivedAt: conceptRelations.archivedAt })
        .from(conceptRelations)
        .where(eq(conceptRelations.id, row.relationId!))
        .limit(1);
  const [target] = current;
  return toPublicProposal(row, target && !target.archivedAt ? target.version : null);
}

/** 按 jobId 回写建议失败（队列终态失败/耗尽兜底；条件更新不覆盖终态）。 */
export async function failConceptProposalByJobId(jobId: string, errorCode: string): Promise<void> {
  await getDb()
    .update(conceptPracticeProposals)
    .set({ status: 'failed', errorCode, updatedAt: new Date() })
    .where(
      and(
        eq(conceptPracticeProposals.jobId, jobId),
        inArray(conceptPracticeProposals.status, ['queued', 'running']),
      ),
    );
}

/** 任务取消时同步建议状态。 */
export async function cancelConceptProposalByJobId(jobId: string): Promise<void> {
  await getDb()
    .update(conceptPracticeProposals)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(conceptPracticeProposals.jobId, jobId),
        inArray(conceptPracticeProposals.status, ['queued', 'running']),
      ),
    );
}
