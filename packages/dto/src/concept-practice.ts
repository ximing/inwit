import { z } from 'zod';

/**
 * 练习绑定契约（M1 只落结构；创建/刷新/恢复等写入口在 M3/T6 开放）。
 * 复习继续按 cardId 排期；绑定记录知识目标、固定首题与归属版本。
 */
export const CONCEPT_EXERCISE_KINDS = ['recall', 'compare', 'scenario'] as const;
export const conceptExerciseKindSchema = z.enum(CONCEPT_EXERCISE_KINDS);
export type ConceptExerciseKind = z.infer<typeof conceptExerciseKindSchema>;

/** 首版题型映射：recall→cloze、compare→compare、scenario→judge。 */
export const EXERCISE_TO_QUESTION_TYPE = {
  recall: 'cloze',
  compare: 'compare',
  scenario: 'judge',
} as const;

export const CONCEPT_PRACTICE_PROPOSAL_STATUSES = [
  'queued',
  'running',
  'ready',
  'failed',
  'cancelled',
] as const;
export const conceptPracticeProposalStatusSchema = z.enum(CONCEPT_PRACTICE_PROPOSAL_STATUSES);
export type ConceptPracticeProposalStatus = z.infer<typeof conceptPracticeProposalStatusSchema>;

/** 知识目标：conceptId 与 relationId 恰一非空。 */
export const knowledgeTargetSchema = z
  .object({
    conceptId: z.string().uuid().nullable().default(null),
    relationId: z.string().uuid().nullable().default(null),
  })
  .refine(
    (value) => (value.conceptId !== null) !== (value.relationId !== null),
    'conceptId 与 relationId 必须恰一非空',
  );
export type KnowledgeTarget = z.infer<typeof knowledgeTargetSchema>;

export const conceptPracticeBindingSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid(),
  conceptId: z.string().uuid().nullable(),
  relationId: z.string().uuid().nullable(),
  cardId: z.string().uuid(),
  /** 固定为当前实际首题（按 createdAt,id 稳定排序的第一题）。 */
  questionId: z.string().uuid(),
  exerciseKind: conceptExerciseKindSchema,
  targetVersion: z.number().int().positive(),
  needsRefresh: z.boolean(),
  resumeRequired: z.boolean(),
  epochId: z.string().uuid(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConceptPracticeBinding = z.infer<typeof conceptPracticeBindingSchema>;

export const conceptPracticeProposalSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid(),
  conceptId: z.string().uuid().nullable(),
  relationId: z.string().uuid().nullable(),
  targetVersion: z.number().int().positive(),
  exerciseKind: conceptExerciseKindSchema,
  jobId: z.string().uuid().nullable(),
  status: conceptPracticeProposalStatusSchema,
  question: z.string().nullable(),
  answer: z.string().nullable(),
  errorCode: z.string().nullable(),
  /** 目标当前版本；与 targetVersion 不同说明生成后目标已更新，需复核。 */
  currentTargetVersion: z.number().int().positive().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConceptPracticeProposal = z.infer<typeof conceptPracticeProposalSchema>;

/** 练习目标引用：concept 或 relation 之一。 */
export const practiceTargetInputSchema = z.discriminatedUnion('targetKind', [
  z.object({ targetKind: z.literal('concept'), targetId: z.string().uuid() }),
  z.object({ targetKind: z.literal('relation'), targetId: z.string().uuid() }),
]);
export type PracticeTargetInput = z.infer<typeof practiceTargetInputSchema>;

/** 手写题目新建练习。确认后才调用；同目标同题型幂等。 */
export const createConceptPracticeInputSchema = practiceTargetInputSchema.and(
  z.object({
    /** 目标当前版本（客户端读到的），不符 409。 */
    expectedVersion: z.number().int().positive(),
    exerciseKind: conceptExerciseKindSchema,
    question: z.string().trim().min(1).max(2000),
    answer: z.string().trim().min(1).max(4000),
    requestId: z.string().trim().min(1).max(80),
  }),
);
export type CreateConceptPracticeInput = z.infer<typeof createConceptPracticeInputSchema>;

/** 绑定已有脑图卡为练习；questionId 必须是当前实际首题。 */
export const bindExistingConceptPracticeInputSchema = practiceTargetInputSchema.and(
  z.object({
    cardId: z.string().uuid(),
    /** 客户端确认的首题 id；必须等于服务端按 (createdAt,id) 排的第一题。 */
    questionId: z.string().uuid(),
    /** 卡片当前 reviewRevision（从未受管理为 null）。 */
    expectedReviewRevision: z.number().int().positive().nullable(),
    expectedVersion: z.number().int().positive(),
    exerciseKind: conceptExerciseKindSchema,
    requestId: z.string().trim().min(1).max(80),
  }),
);
export type BindExistingConceptPracticeInput = z.infer<typeof bindExistingConceptPracticeInputSchema>;

/** refresh：用户确认后的新题面与答案；只更新绑定首题。 */
export const refreshConceptPracticeInputSchema = z.object({
  questionId: z.string().uuid(),
  /** 用户复核过的目标当前版本（更新后的版本）。 */
  expectedTargetVersion: z.number().int().positive(),
  expectedReviewRevision: z.number().int().positive(),
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(4000),
});
export type RefreshConceptPracticeInput = z.infer<typeof refreshConceptPracticeInputSchema>;

/** 绑定 resume：只解除归档后的显式恢复门槛。 */
export const resumeConceptPracticeInputSchema = z.object({
  expectedReviewRevision: z.number().int().positive(),
});
export type ResumeConceptPracticeInput = z.infer<typeof resumeConceptPracticeInputSchema>;

export const conceptPracticeResultSchema = z.object({
  binding: conceptPracticeBindingSchema,
  cardId: z.string().uuid(),
  /** false 表示命中已有活动绑定，本次未新建。 */
  created: z.boolean(),
});
export type ConceptPracticeResult = z.infer<typeof conceptPracticeResultSchema>;

export const createConceptPracticeProposalInputSchema = practiceTargetInputSchema.and(
  z.object({
    exerciseKind: conceptExerciseKindSchema,
    requestId: z.string().trim().min(1).max(80),
  }),
);
export type CreateConceptPracticeProposalInput = z.infer<
  typeof createConceptPracticeProposalInputSchema
>;

export const createConceptPracticeProposalResultSchema = z.object({
  proposalId: z.string().uuid(),
  jobId: z.string().uuid(),
});
export type CreateConceptPracticeProposalResult = z.infer<
  typeof createConceptPracticeProposalResultSchema
>;

/** 卡片导航关联建立输入。 */
export const addCardKnowledgeLinkInputSchema = practiceTargetInputSchema;
export type AddCardKnowledgeLinkInput = z.infer<typeof addCardKnowledgeLinkInputSchema>;

/** 知识表现摘要：只统计当前绑定/epoch/版本的反馈。 */
export const conceptPracticeSummarySchema = z.object({
  binding: conceptPracticeBindingSchema.nullable(),
  /** 当前 epoch 内的反馈次数与最近反馈；无则为 null/0，不追认旧反馈。 */
  feedbackCount: z.number().int().nonnegative(),
  lastFeedback: z.enum(['forgot', 'fuzzy', 'remembered']).nullable(),
  dueAt: z.string().nullable(),
});
export type ConceptPracticeSummary = z.infer<typeof conceptPracticeSummarySchema>;
