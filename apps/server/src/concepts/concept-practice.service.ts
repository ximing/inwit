import type { ConceptExerciseKind, ConceptPracticeBinding, ConceptPracticeSummary } from '@inwit/dto';
import { EXERCISE_TO_QUESTION_TYPE } from '@inwit/dto';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import {
  cardKnowledgeLinks,
  cardQuestions,
  cards,
  conceptEvidence,
  conceptPracticeBindings,
  conceptRelations,
  concepts,
  documents,
  reviewLogs,
  reviewStates,
  topics,
  type CardQuestionRow,
  type CardRow,
  type ConceptPracticeBindingRow,
  type ReviewStateRow,
} from '../db/schema.js';
import { planCardIndex } from '../cards/card-acceptance-logic.js';
import { insertCardRow, updateCards } from '../cards/card-write.js';
import { AppError } from '../errors.js';
import { isUniqueViolation } from '../db/pg.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { MS_PER_DAY } from '../review/sm2.js';
import { lockActiveTopic } from './concept-access.js';
import { nextReviewRevision } from './concept-review-revision-logic.js';

type Db = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export function toPublicBinding(row: ConceptPracticeBindingRow): ConceptPracticeBinding {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    conceptId: row.conceptId,
    relationId: row.relationId,
    cardId: row.cardId,
    questionId: row.questionId,
    exerciseKind: row.exerciseKind,
    targetVersion: row.targetVersion,
    needsRefresh: row.needsRefresh,
    resumeRequired: row.resumeRequired,
    epochId: row.epochId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 卡片当前实际首题（按 createdAt,id 稳定排序）。 */
export async function firstQuestionOf(
  db: Db,
  cardId: string,
): Promise<CardQuestionRow | undefined> {
  const [row] = await db
    .select()
    .from(cardQuestions)
    .where(eq(cardQuestions.cardId, cardId))
    .orderBy(asc(cardQuestions.createdAt), asc(cardQuestions.id))
    .limit(1);
  return row;
}

export async function activeBindingOf(
  db: Db,
  cardId: string,
): Promise<ConceptPracticeBindingRow | undefined> {
  const [row] = await db
    .select()
    .from(conceptPracticeBindings)
    .where(and(eq(conceptPracticeBindings.cardId, cardId), isNull(conceptPracticeBindings.endedAt)))
    .limit(1);
  return row;
}

export type ReviewBlockReason =
  | 'card_deleted'
  | 'not_accepted'
  | 'suspended'
  | 'needs_refresh'
  | 'resume_required'
  | 'target_archived'
  | 'topic_archived'
  | 'question_mismatch';

export interface ReviewEligibility {
  eligible: boolean;
  /** 用户手动暂停独立列出；知识阻断见 knowledgeBlocks。 */
  reasons: ReviewBlockReason[];
  /** 知识生命周期阻断（needsRefresh/归档/resumeRequired/题目失配）。 */
  knowledgeBlocks: ReviewBlockReason[];
  binding: ConceptPracticeBindingRow | null;
  reviewRevision: number | null;
  reviewState: ReviewStateRow | null;
}

/**
 * 统一复习资格计算：队列、反馈、旧恢复、绑定恢复、refresh 共用。
 * 手动暂停与知识阻断分开报告，调用方按自身语义判断（refresh 不被阻断）。
 */
export async function getReviewEligibility(
  db: Db,
  userId: string,
  cardId: string,
): Promise<ReviewEligibility> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .limit(1);
  if (!card) throw AppError.of(404, 'CARD_NOT_FOUND');

  const reasons: ReviewBlockReason[] = [];
  const knowledgeBlocks: ReviewBlockReason[] = [];
  if (card.deletedAt) reasons.push('card_deleted');
  if (card.acceptance !== 'accepted') reasons.push('not_accepted');

  const [state] = await db
    .select()
    .from(reviewStates)
    .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, cardId)))
    .limit(1);
  if (state?.suspendedAt) reasons.push('suspended');

  const binding = (await activeBindingOf(db, cardId)) ?? null;
  if (binding) {
    if (binding.needsRefresh) knowledgeBlocks.push('needs_refresh');
    if (binding.resumeRequired) knowledgeBlocks.push('resume_required');

    // 目标与主题归档是动态阻断（不写入 suspendedAt）。
    if (binding.conceptId) {
      const [target] = await db
        .select({ archivedAt: concepts.archivedAt, topicId: concepts.topicId })
        .from(concepts)
        .where(eq(concepts.id, binding.conceptId))
        .limit(1);
      if (target?.archivedAt) knowledgeBlocks.push('target_archived');
      if (target) {
        const [topic] = await db
          .select({ status: topics.status })
          .from(topics)
          .where(eq(topics.id, target.topicId))
          .limit(1);
        if (topic?.status === 'archived') knowledgeBlocks.push('topic_archived');
      }
    } else if (binding.relationId) {
      const [target] = await db
        .select()
        .from(conceptRelations)
        .where(eq(conceptRelations.id, binding.relationId))
        .limit(1);
      if (target?.archivedAt) knowledgeBlocks.push('target_archived');
      if (target) {
        const endpointRows = await db
          .select({ archivedAt: concepts.archivedAt })
          .from(concepts)
          .where(
            sql`${concepts.id} IN (${target.fromConceptId}, ${target.toConceptId})`,
          );
        if (endpointRows.some((row) => row.archivedAt)) knowledgeBlocks.push('target_archived');
        const [topic] = await db
          .select({ status: topics.status })
          .from(topics)
          .where(eq(topics.id, target.topicId))
          .limit(1);
        if (topic?.status === 'archived') knowledgeBlocks.push('topic_archived');
      }
    }

    // 活动绑定要求绑定题仍是兼容首题。
    const first = await firstQuestionOf(db, cardId);
    if (
      !first ||
      first.id !== binding.questionId ||
      first.type !== EXERCISE_TO_QUESTION_TYPE[binding.exerciseKind]
    ) {
      knowledgeBlocks.push('question_mismatch');
    }
  }

  const blocking = [...reasons.filter((r) => r === 'card_deleted' || r === 'not_accepted'), ...knowledgeBlocks];
  return {
    eligible: blocking.length === 0,
    reasons: [...reasons, ...knowledgeBlocks],
    knowledgeBlocks,
    binding,
    reviewRevision: card.reviewRevision,
    reviewState: state ?? null,
  };
}

async function lockCard(db: Db, userId: string, cardId: string): Promise<CardRow> {
  const [row] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .for('update')
    .limit(1);
  if (!row) throw AppError.of(404, 'CARD_NOT_FOUND');
  return row;
}

async function lockBinding(
  db: Db,
  userId: string,
  bindingId: string,
): Promise<ConceptPracticeBindingRow> {
  const [row] = await db
    .select()
    .from(conceptPracticeBindings)
    .where(and(eq(conceptPracticeBindings.id, bindingId), eq(conceptPracticeBindings.userId, userId)))
    .for('update')
    .limit(1);
  if (!row) throw AppError.of(404, 'CONCEPT_PRACTICE_NOT_FOUND');
  return row;
}

/** 目标摘要：归属校验 + 当前版本 + 可读文本。归档/缺失统一拒绝。 */
async function requireActiveTarget(
  db: Db,
  input: { userId: string; topicId?: string; conceptId?: string; relationId?: string },
): Promise<{
  topicId: string;
  version: number;
  readable: string;
  primaryDocumentId: string | null;
}> {
  // 主出处：目标最早一条仍挂在文档上的证据
  const evidenceTarget = input.conceptId
    ? eq(conceptEvidence.conceptId, input.conceptId)
    : eq(conceptEvidence.relationId, input.relationId!);
  const primaryDocumentId = await db
    .select({ documentId: conceptEvidence.documentId })
    .from(conceptEvidence)
    .innerJoin(
      documents,
      and(eq(documents.id, conceptEvidence.documentId), isNull(documents.deletedAt)),
    )
    .where(and(evidenceTarget, sql`${conceptEvidence.documentId} IS NOT NULL`))
    .orderBy(asc(conceptEvidence.createdAt))
    .limit(1)
    .then((rows) => rows[0]?.documentId ?? null);

  if (input.conceptId) {
    const [row] = await db
      .select()
      .from(concepts)
      .where(and(eq(concepts.id, input.conceptId), eq(concepts.userId, input.userId)))
      .limit(1);
    if (!row) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    if (input.topicId && row.topicId !== input.topicId) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    if (row.archivedAt) throw AppError.of(409, 'CONCEPT_ARCHIVED');
    return {
      topicId: row.topicId,
      version: row.version,
      readable: row.definition ? `${row.name}：${row.definition}` : row.name,
      primaryDocumentId,
    };
  }
  if (input.relationId) {
    const [row] = await db
      .select()
      .from(conceptRelations)
      .where(and(eq(conceptRelations.id, input.relationId), eq(conceptRelations.userId, input.userId)))
      .limit(1);
    if (!row) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    if (input.topicId && row.topicId !== input.topicId) {
      throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    }
    if (row.archivedAt) throw AppError.of(409, 'CONCEPT_RELATION_ARCHIVED');
    const endpointRows = await db
      .select({ id: concepts.id, name: concepts.name, archivedAt: concepts.archivedAt })
      .from(concepts)
      .where(sql`${concepts.id} IN (${row.fromConceptId}, ${row.toConceptId})`);
    if (endpointRows.length !== 2 || endpointRows.some((endpoint) => endpoint.archivedAt)) {
      throw AppError.of(422, 'CONCEPT_ENDPOINT_INVALID');
    }
    const nameOf = (id: string) => endpointRows.find((endpoint) => endpoint.id === id)?.name ?? '';
    return {
      topicId: row.topicId,
      version: row.version,
      readable: `${nameOf(row.fromConceptId)} → ${row.predicate} → ${nameOf(row.toConceptId)}`,
      primaryDocumentId,
    };
  }
  throw AppError.of(400, 'VALIDATION_ERROR');
}

/** 主要目标保证对应导航链接存在。 */
async function ensureKnowledgeLink(
  db: Db,
  input: {
    userId: string;
    topicId: string;
    cardId: string;
    conceptId?: string | null;
    relationId?: string | null;
  },
): Promise<void> {
  const [existing] = await db
    .select({ id: cardKnowledgeLinks.id })
    .from(cardKnowledgeLinks)
    .where(
      and(
        eq(cardKnowledgeLinks.cardId, input.cardId),
        input.conceptId
          ? eq(cardKnowledgeLinks.conceptId, input.conceptId)
          : eq(cardKnowledgeLinks.relationId, input.relationId!),
      ),
    )
    .limit(1);
  if (existing) return;
  await db.insert(cardKnowledgeLinks).values({
    userId: input.userId,
    topicId: input.topicId,
    cardId: input.cardId,
    conceptId: input.conceptId ?? null,
    relationId: input.relationId ?? null,
  });
}

/** 目标已有同题型的活动绑定 → 返回已有（幂等，不重复建卡）。 */
async function findActiveBindingForTarget(
  db: Db,
  target: { conceptId: string } | { relationId: string },
  exerciseKind: ConceptExerciseKind,
): Promise<ConceptPracticeBindingRow | undefined> {
  const [row] = await db
    .select()
    .from(conceptPracticeBindings)
    .where(
      and(
        'conceptId' in target
          ? eq(conceptPracticeBindings.conceptId, target.conceptId)
          : eq(conceptPracticeBindings.relationId, target.relationId),
        eq(conceptPracticeBindings.exerciseKind, exerciseKind),
        isNull(conceptPracticeBindings.endedAt),
      ),
    )
    .limit(1);
  return row;
}

/** 新建练习：cards + questions + review_states + binding + 主导航链接同一事务。 */
export async function createConceptPracticeInTx(
  tx: Db,
  input: {
    userId: string;
    target: { conceptId: string } | { relationId: string };
    expectedVersion?: number;
    exerciseKind: ConceptExerciseKind;
    question: string;
    answer: string;
    now?: Date;
  },
): Promise<{ binding: ConceptPracticeBindingRow; cardId: string; created: boolean }> {
  const userId = input.userId;
  const target = await requireActiveTarget(tx, { userId, ...input.target });
  // 调用方读到的目标版本（防旧提议直接入队）；幂等回放已有绑定时也应校验
  if (input.expectedVersion !== undefined && target.version !== input.expectedVersion) {
    throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
  }
  await lockActiveTopic(tx, userId, target.topicId);

  const existing = await findActiveBindingForTarget(tx, input.target, input.exerciseKind);
  if (existing) return { binding: existing, cardId: existing.cardId, created: false };

  const now = input.now ?? new Date();
  const questionType = EXERCISE_TO_QUESTION_TYPE[input.exerciseKind];
  const card = await insertCardRow(tx, {
    userId,
    topicId: target.topicId,
    documentId: target.primaryDocumentId,
    concept: target.readable,
    example: input.answer,
    confusionPoint: '',
    source: 'manual',
    acceptance: 'accepted',
    reviewRevision: nextReviewRevision(null, { reason: 'create' }),
  });
  if (!card) throw AppError.of(500, 'INTERNAL_ERROR');

  const [question] = await tx
    .insert(cardQuestions)
    .values({ cardId: card.id, type: questionType, question: input.question, answer: input.answer })
    .returning();
  if (!question) throw AppError.of(500, 'INTERNAL_ERROR');

  const indexPlan = planCardIndex({ reason: 'practice' });
  if (indexPlan.index) throw new Error('concept practice cards are not indexed');
  await insertInitialReviewState(userId, card.id, now, tx);

  const [binding] = await tx
    .insert(conceptPracticeBindings)
    .values({
      userId,
      topicId: target.topicId,
      conceptId: 'conceptId' in input.target ? input.target.conceptId : null,
      relationId: 'relationId' in input.target ? input.target.relationId : null,
      cardId: card.id,
      questionId: question.id,
      exerciseKind: input.exerciseKind,
      targetVersion: target.version,
    })
    .returning();
  if (!binding) throw AppError.of(500, 'INTERNAL_ERROR');

  await ensureKnowledgeLink(tx, {
    userId,
    topicId: target.topicId,
    cardId: card.id,
    conceptId: binding.conceptId,
    relationId: binding.relationId,
  });
  return { binding, cardId: card.id, created: true };
}

/** 绑定已有脑图卡为练习：只绑定当前实际首题，不改排期/暂停/历史/归属。 */
export async function bindExistingConceptPracticeInTx(
  tx: Db,
  input: {
    userId: string;
    cardId: string;
    questionId: string;
    expectedReviewRevision: number | null;
    target: { conceptId: string } | { relationId: string };
    expectedVersion: number;
    exerciseKind: ConceptExerciseKind;
  },
): Promise<{ binding: ConceptPracticeBindingRow; cardId: string; created: true }> {
  const userId = input.userId;
  const target = await requireActiveTarget(tx, { userId, ...input.target });
  if (target.version !== input.expectedVersion) {
    throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
  }
  await lockActiveTopic(tx, userId, target.topicId);
  const card = await lockCard(tx, userId, input.cardId);
  if (card.deletedAt) throw AppError.of(404, 'CARD_NOT_FOUND');
  if (card.acceptance !== 'accepted') throw AppError.of(409, 'CARD_NOT_ACCEPTED');
  if (card.reviewRevision !== input.expectedReviewRevision) {
    throw AppError.of(409, 'REVIEW_REVISION_CONFLICT');
  }

  const first = await firstQuestionOf(tx, card.id);
  if (!first) throw AppError.of(409, 'CONCEPT_PRACTICE_NO_QUESTION');
  if (first.id !== input.questionId) {
    throw AppError.of(409, 'CONCEPT_PRACTICE_QUESTION_MISMATCH');
  }
  if (first.type !== EXERCISE_TO_QUESTION_TYPE[input.exerciseKind]) {
    throw AppError.of(409, 'CONCEPT_PRACTICE_TYPE_MISMATCH');
  }

  if (await activeBindingOf(tx, card.id)) {
    throw AppError.of(409, 'CONCEPT_PRACTICE_CONFLICT');
  }
  if (await findActiveBindingForTarget(tx, input.target, input.exerciseKind)) {
    throw AppError.of(409, 'CONCEPT_PRACTICE_CONFLICT');
  }

  const [binding] = await tx
    .insert(conceptPracticeBindings)
    .values({
      userId,
      topicId: target.topicId,
      conceptId: 'conceptId' in input.target ? input.target.conceptId : null,
      relationId: 'relationId' in input.target ? input.target.relationId : null,
      cardId: card.id,
      questionId: first.id,
      exerciseKind: input.exerciseKind,
      targetVersion: target.version,
    })
    .returning();
  if (!binding) throw AppError.of(500, 'INTERNAL_ERROR');

  await ensureKnowledgeLink(tx, {
    userId,
    topicId: target.topicId,
    cardId: card.id,
    conceptId: binding.conceptId,
    relationId: binding.relationId,
  });
  // 首次绑定进入新协议管理
  await updateCards(tx)
    .set({
      reviewRevision: nextReviewRevision(card.reviewRevision, { reason: 'bind' }),
      updatedAt: new Date(),
    })
    .where(eq(cards.id, card.id));
  return { binding, cardId: card.id, created: true };
}

/**
 * refresh：更新绑定首题、清 needsRefresh、轮换 epoch 与 reviewRevision、
 * 重置该卡学习参数；保留历史日志、其他题目、手动暂停与 resumeRequired。
 */
export async function refreshConceptPracticeInTx(
  tx: Db,
  input: {
    userId: string;
    bindingId: string;
    questionId: string;
    expectedTargetVersion: number;
    expectedReviewRevision: number;
    question: string;
    answer: string;
    now?: Date;
    startingEase?: number;
  },
): Promise<ConceptPracticeBindingRow> {
  const userId = input.userId;
  const binding = await lockBinding(tx, userId, input.bindingId);
  if (binding.endedAt) throw AppError.of(409, 'CONCEPT_PRACTICE_NOT_FOUND');
  const card = await lockCard(tx, userId, binding.cardId);
  if (card.deletedAt) throw AppError.of(404, 'CARD_NOT_FOUND');
  if (card.reviewRevision !== input.expectedReviewRevision) {
    throw AppError.of(409, 'REVIEW_REVISION_CONFLICT');
  }
  const target = await requireActiveTarget(tx, {
    userId,
    ...(binding.conceptId ? { conceptId: binding.conceptId } : { relationId: binding.relationId! }),
  });
  if (target.version !== input.expectedTargetVersion) {
    throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
  }
  await lockActiveTopic(tx, userId, target.topicId);

  const first = await firstQuestionOf(tx, card.id);
  if (!first || first.id !== binding.questionId || first.id !== input.questionId) {
    throw AppError.of(409, 'CONCEPT_PRACTICE_QUESTION_MISMATCH');
  }
  if (first.type !== EXERCISE_TO_QUESTION_TYPE[binding.exerciseKind]) {
    throw AppError.of(409, 'CONCEPT_PRACTICE_TYPE_MISMATCH');
  }

  const now = input.now ?? new Date();
  await tx
    .update(cardQuestions)
    .set({ question: input.question, answer: input.answer })
    .where(eq(cardQuestions.id, first.id));

  const [updated] = await tx
    .update(conceptPracticeBindings)
    .set({
      targetVersion: target.version,
      needsRefresh: false,
      epochId: sql`gen_random_uuid()`,
      startedAt: now,
      updatedAt: now,
    })
    .where(eq(conceptPracticeBindings.id, binding.id))
    .returning();
  if (!updated) throw AppError.of(500, 'INTERNAL_ERROR');

  // 重置学习参数；未入队（无 review_state）的卡不因此入队。
  const [state] = await tx
    .select()
    .from(reviewStates)
    .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, card.id)))
    .for('update')
    .limit(1);
  if (state) {
    await tx
      .update(reviewStates)
      .set({
        ease: input.startingEase ?? 2.5,
        intervalDays: 0,
        reps: 0,
        lapses: 0,
        dueAt: new Date(now.getTime() + MS_PER_DAY),
        updatedAt: now,
      })
      .where(eq(reviewStates.id, state.id));
  }

  await updateCards(tx)
    .set({
      reviewRevision: nextReviewRevision(card.reviewRevision, { reason: 'refresh' }),
      updatedAt: now,
    })
    .where(eq(cards.id, card.id));
  return updated;
}

/** 绑定 resume：仅清归档后的显式恢复门槛；不重置排期、不清手动暂停。 */
export async function resumeConceptPracticeInTx(
  tx: Db,
  input: { userId: string; bindingId: string; expectedReviewRevision: number },
): Promise<ConceptPracticeBindingRow> {
  const userId = input.userId;
  const binding = await lockBinding(tx, userId, input.bindingId);
  if (binding.endedAt) throw AppError.of(409, 'CONCEPT_PRACTICE_NOT_FOUND');
  const card = await lockCard(tx, userId, binding.cardId);
  if (card.reviewRevision !== input.expectedReviewRevision) {
    throw AppError.of(409, 'REVIEW_REVISION_CONFLICT');
  }
  const eligibility = await getReviewEligibility(tx, userId, binding.cardId);
  // 归档/内容失效不能通过 resume 绕过；resumeRequired 之外的阻断拒绝
  const blocking = eligibility.knowledgeBlocks.filter((reason) => reason !== 'resume_required');
  if (blocking.length > 0) {
    throw AppError.of(409, 'REVIEW_NOT_ELIGIBLE', { reasons: blocking });
  }
  const [updated] = await tx
    .update(conceptPracticeBindings)
    .set({ resumeRequired: false, updatedAt: new Date() })
    .where(eq(conceptPracticeBindings.id, binding.id))
    .returning();
  if (!updated) throw AppError.of(500, 'INTERNAL_ERROR');
  return updated;
}

/** 解除主绑定：终止知识阻断与计分；保留卡片、排期、历史、导航关联与用户暂停。 */
export async function unbindConceptPracticeInTx(
  tx: Db,
  input: { userId: string; bindingId: string },
): Promise<ConceptPracticeBindingRow> {
  const binding = await lockBinding(tx, input.userId, input.bindingId);
  if (binding.endedAt) throw AppError.of(409, 'CONCEPT_PRACTICE_NOT_FOUND');
  const card = await lockCard(tx, input.userId, binding.cardId);
  const now = new Date();
  const [updated] = await tx
    .update(conceptPracticeBindings)
    .set({ endedAt: now, updatedAt: now })
    .where(eq(conceptPracticeBindings.id, binding.id))
    .returning();
  if (!updated) throw AppError.of(500, 'INTERNAL_ERROR');
  // 解绑后仍保留受管理身份（reviewRevision 不退回 null）
  await updateCards(tx)
    .set({
      reviewRevision: nextReviewRevision(card.reviewRevision, { reason: 'unbind' }),
      updatedAt: now,
    })
    .where(eq(cards.id, card.id));
  return updated;
}

/** 知识表现摘要：只统计当前活动 binding + epoch + targetVersion 的反馈。 */
export async function getConceptPracticeSummary(
  db: Db,
  input: { userId: string; conceptId?: string; relationId?: string },
): Promise<ConceptPracticeSummary> {
  const [binding] = await db
    .select()
    .from(conceptPracticeBindings)
    .where(
      and(
        eq(conceptPracticeBindings.userId, input.userId),
        input.conceptId
          ? eq(conceptPracticeBindings.conceptId, input.conceptId)
          : eq(conceptPracticeBindings.relationId, input.relationId!),
        isNull(conceptPracticeBindings.endedAt),
      ),
    )
    .limit(1);
  if (!binding) return { binding: null, feedbackCount: 0, lastFeedback: null, dueAt: null };
  const logs = await db
    .select({ feedback: reviewLogs.feedback, reviewedAt: reviewLogs.reviewedAt })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, input.userId),
        eq(reviewLogs.bindingId, binding.id),
        eq(reviewLogs.epochId, binding.epochId),
        eq(reviewLogs.targetVersion, binding.targetVersion),
      ),
    )
    .orderBy(asc(reviewLogs.reviewedAt));
  const [state] = await db
    .select({ dueAt: reviewStates.dueAt })
    .from(reviewStates)
    .where(
      and(eq(reviewStates.userId, input.userId), eq(reviewStates.cardId, binding.cardId)),
    )
    .limit(1);
  return {
    binding: toPublicBinding(binding),
    feedbackCount: logs.length,
    lastFeedback: logs[logs.length - 1]?.feedback ?? null,
    dueAt: state?.dueAt.toISOString() ?? null,
  };
}

/**
 * 内容版本保护：受管理卡（reviewRevision 非 null）的题目/呈现内容变化时调用。
 * - changed=true（题面/概念文本/题目列表任何变化）→ 递增 reviewRevision；
 * - 绑定首题身份/题面/答案/类型变化或首题不再匹配 → 活动绑定标 needsRefresh。
 * 所有题目/卡片编辑入口（旧接口与 Agent）都必须调用；受控 refresh 不走这里。
 */
export async function guardManagedCardEdit(
  db: Db,
  cardId: string,
  input: {
    changed: boolean;
    /** 修改前的首题快照（有绑定/题目变化时调用方提供）。 */
    beforeFirst?: { id: string; type: string; question: string; answer: string };
  },
): Promise<void> {
  const [card] = await db
    .select({ id: cards.id, reviewRevision: cards.reviewRevision })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card || card.reviewRevision === null) return;

  const binding = await activeBindingOf(db, cardId);
  const after = await firstQuestionOf(db, cardId);
  const firstChanged =
    input.beforeFirst !== undefined &&
    (!after ||
      input.beforeFirst.id !== after.id ||
      input.beforeFirst.type !== after.type ||
      input.beforeFirst.question !== after.question ||
      input.beforeFirst.answer !== after.answer);

  if (input.changed || firstChanged) {
    await updateCards(db)
      .set({
        reviewRevision: nextReviewRevision(card.reviewRevision, {
          reason: 'content-edit',
          changed: input.changed,
          firstChanged,
        }),
        updatedAt: new Date(),
      })
      .where(eq(cards.id, cardId));
  }
  if (!binding) return;
  if (
    firstChanged ||
    !after ||
    after.id !== binding.questionId ||
    after.type !== EXERCISE_TO_QUESTION_TYPE[binding.exerciseKind]
  ) {
    await db
      .update(conceptPracticeBindings)
      .set({ needsRefresh: true, updatedAt: new Date() })
      .where(eq(conceptPracticeBindings.id, binding.id));
  }
}

// ---------- 路由层包装：事务 + requestId 幂等 ----------

import {
  bindExistingConceptPracticeInputSchema,
  createConceptPracticeInputSchema,
  refreshConceptPracticeInputSchema,
  resumeConceptPracticeInputSchema,
  type ConceptPracticeResult,
} from '@inwit/dto';
import { conceptOperationRequests } from '../db/schema.js';
import { requestHashOf } from './concept-identity.js';
import { getReviewSettings } from '../review/review-settings.js';
import type { z } from 'zod';

function toPracticeResult(
  binding: ConceptPracticeBindingRow,
  created: boolean,
): ConceptPracticeResult {
  return { binding: toPublicBinding(binding), cardId: binding.cardId, created };
}

/** 在事务内先查幂等记录：同 key 同请求返回原结果，同 key 不同请求 409。 */
async function replayOperation<T>(
  tx: Db,
  input: { userId: string; operation: string; requestId: string; payloadForHash: unknown },
): Promise<{ replay: T } | { replay: null }> {
  const requestHash = requestHashOf(input.payloadForHash);
  const [existing] = await tx
    .select()
    .from(conceptOperationRequests)
    .where(
      and(
        eq(conceptOperationRequests.userId, input.userId),
        eq(conceptOperationRequests.operation, input.operation),
        eq(conceptOperationRequests.requestId, input.requestId),
      ),
    )
    .limit(1);
  if (!existing) return { replay: null };
  if (existing.requestHash !== requestHash) {
    throw AppError.of(409, 'CONCEPT_REQUEST_CONFLICT');
  }
  return { replay: existing.responseJson as T };
}

async function recordOperation<T>(
  tx: Db,
  input: { userId: string; operation: string; requestId: string; payloadForHash: unknown },
  result: T,
): Promise<T> {
  await tx.insert(conceptOperationRequests).values({
    userId: input.userId,
    operation: input.operation,
    requestId: input.requestId,
    requestHash: requestHashOf(input.payloadForHash),
    responseJson: result as unknown as Record<string, unknown>,
  });
  return result;
}

export async function createConceptPractice(
  userId: string,
  rawInput: z.input<typeof createConceptPracticeInputSchema>,
): Promise<ConceptPracticeResult> {
  const input = createConceptPracticeInputSchema.parse(rawInput);
  const target =
    input.targetKind === 'concept'
      ? ({ conceptId: input.targetId } as const)
      : ({ relationId: input.targetId } as const);
  const operation = { userId, operation: 'concept_practice_create', requestId: input.requestId };
  const payloadForHash = { ...input, requestId: undefined };
  return getDb().transaction(async (tx) => {
    const replay = await replayOperation<ConceptPracticeResult>(tx, {
      ...operation,
      payloadForHash,
    });
    if (replay.replay !== null) return replay.replay;
    const { binding, created } = await createConceptPracticeInTx(tx, {
      userId,
      target,
      expectedVersion: input.expectedVersion,
      exerciseKind: input.exerciseKind,
      question: input.question,
      answer: input.answer,
    });
    return recordOperation(tx, { ...operation, payloadForHash }, toPracticeResult(binding, created));
  }).catch(async (err: unknown) => {
    // 并发创建同一目标同一题型：唯一索引兜底，败方返回已有绑定（幂等语义）。
    if (isUniqueViolation(err)) {
      const existing = await findActiveBindingForTarget(getDb(), target, input.exerciseKind);
      if (existing) return toPracticeResult(existing, false);
    }
    throw err;
  });
}

export async function bindExistingConceptPractice(
  userId: string,
  rawInput: z.input<typeof bindExistingConceptPracticeInputSchema>,
): Promise<ConceptPracticeResult> {
  const input = bindExistingConceptPracticeInputSchema.parse(rawInput);
  const target =
    input.targetKind === 'concept'
      ? ({ conceptId: input.targetId } as const)
      : ({ relationId: input.targetId } as const);
  const operation = { userId, operation: 'concept_practice_bind', requestId: input.requestId };
  const payloadForHash = { ...input, requestId: undefined };
  return getDb().transaction(async (tx) => {
    const replay = await replayOperation<ConceptPracticeResult>(tx, {
      ...operation,
      payloadForHash,
    });
    if (replay.replay !== null) return replay.replay;
    const { binding } = await bindExistingConceptPracticeInTx(tx, {
      userId,
      cardId: input.cardId,
      questionId: input.questionId,
      expectedReviewRevision: input.expectedReviewRevision,
      target,
      expectedVersion: input.expectedVersion,
      exerciseKind: input.exerciseKind,
    });
    return recordOperation(tx, { ...operation, payloadForHash }, toPracticeResult(binding, true));
  });
}

export async function refreshConceptPractice(
  userId: string,
  bindingId: string,
  rawInput: z.input<typeof refreshConceptPracticeInputSchema>,
): Promise<ConceptPracticeBinding> {
  const input = refreshConceptPracticeInputSchema.parse(rawInput);
  const settings = await getReviewSettings(userId);
  return getDb().transaction(async (tx) => {
    const binding = await refreshConceptPracticeInTx(tx, {
      userId,
      bindingId,
      questionId: input.questionId,
      expectedTargetVersion: input.expectedTargetVersion,
      expectedReviewRevision: input.expectedReviewRevision,
      question: input.question,
      answer: input.answer,
      startingEase: settings.startingEase,
    });
    return toPublicBinding(binding);
  });
}

export async function resumeConceptPractice(
  userId: string,
  bindingId: string,
  rawInput: z.input<typeof resumeConceptPracticeInputSchema>,
): Promise<ConceptPracticeBinding> {
  const input = resumeConceptPracticeInputSchema.parse(rawInput);
  return getDb().transaction(async (tx) => {
    const binding = await resumeConceptPracticeInTx(tx, {
      userId,
      bindingId,
      expectedReviewRevision: input.expectedReviewRevision,
    });
    return toPublicBinding(binding);
  });
}

export async function unbindConceptPractice(
  userId: string,
  bindingId: string,
): Promise<ConceptPracticeBinding> {
  return getDb().transaction(async (tx) => {
    const binding = await unbindConceptPracticeInTx(tx, { userId, bindingId });
    return toPublicBinding(binding);
  });
}
