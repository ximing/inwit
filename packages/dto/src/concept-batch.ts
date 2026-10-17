import { z } from 'zod';
import { codePointsAtMost } from './card.js';
import {
  CONCEPT_ALIAS_MAX,
  CONCEPT_ALIASES_MAX,
  CONCEPT_CONTEXT_MAX,
  CONCEPT_DEFINITION_MAX,
  CONCEPT_EXAMPLE_MAX,
  CONCEPT_EXPLANATION_MAX,
  CONCEPT_NAME_MAX,
  CONCEPT_PREDICATE_MAX,
  CONCEPT_QUOTE_MAX,
  conceptBasisSchema,
  conceptEvidenceLocatorSchema,
  conceptMatchSchema,
  conceptRelationKindSchema,
} from './concept.js';

/** 单批硬上限：30 个概念、60 条关系。 */
export const CONCEPT_BATCH_MAX_CONCEPTS = 30;
export const CONCEPT_BATCH_MAX_RELATIONS = 60;
/** 单任务正文上限（Unicode code points）；超限要求缩小范围，禁止静默截断。 */
export const CONCEPT_SOURCE_MAX_CHARS = 60_000;
/** 单个模型分片的目标长度。 */
export const CONCEPT_CHUNK_TARGET_CHARS = 8_000;

export const CONCEPT_BATCH_SCOPES = ['document', 'selection'] as const;
export const conceptBatchScopeSchema = z.enum(CONCEPT_BATCH_SCOPES);
export type ConceptBatchScope = z.infer<typeof conceptBatchScopeSchema>;

export const CONCEPT_BATCH_STATUSES = [
  'queued',
  'running',
  'ready',
  'failed',
  'cancelled',
  'committed',
  'discarded',
] as const;
export const conceptBatchStatusSchema = z.enum(CONCEPT_BATCH_STATUSES);
export type ConceptBatchStatus = z.infer<typeof conceptBatchStatusSchema>;

const draftTempIdSchema = z.string().trim().min(1).max(40);

/** 候选引用：本批候选 tempId 或主题内已有概念（带版本，提交时核对）。 */
export const conceptDraftRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('candidate'), tempId: draftTempIdSchema }),
  z.object({
    kind: z.literal('existing'),
    conceptId: z.string().uuid(),
    version: z.number().int().positive(),
  }),
]);
export type ConceptDraftRef = z.infer<typeof conceptDraftRefSchema>;

export const conceptDraftEvidenceSchema = z.object({
  /** 省略时默认批次来源文档。 */
  documentId: z.string().uuid().optional(),
  locator: conceptEvidenceLocatorSchema,
  basis: conceptBasisSchema.default('explicit'),
});
export type ConceptDraftEvidence = z.infer<typeof conceptDraftEvidenceSchema>;

export const conceptDraftConceptSchema = z.object({
  tempId: draftTempIdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_NAME_MAX)),
  aliases: z
    .array(z.string().trim().min(1).refine(codePointsAtMost(CONCEPT_ALIAS_MAX)))
    .max(CONCEPT_ALIASES_MAX)
    .default(() => []),
  sense: z.string().trim().min(1).refine(codePointsAtMost(500)).nullable().default(null),
  definition: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_DEFINITION_MAX))
    .nullable()
    .default(null),
  example: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_EXAMPLE_MAX))
    .nullable()
    .default(null),
  basis: conceptBasisSchema.default('explicit'),
  evidence: z.array(conceptDraftEvidenceSchema).max(10).default(() => []),
  /** 同主题同名/别名建议（最多 5 条）；只提示，不自动合并。 */
  matchCandidates: z.array(conceptMatchSchema).max(5).default(() => []),
});
export type ConceptDraftConcept = z.infer<typeof conceptDraftConceptSchema>;

export const conceptDraftRelationSchema = z.object({
  tempId: draftTempIdSchema,
  fromRef: conceptDraftRefSchema,
  toRef: conceptDraftRefSchema,
  kind: conceptRelationKindSchema,
  predicate: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_PREDICATE_MAX)),
  context: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_CONTEXT_MAX))
    .nullable()
    .default(null),
  explanation: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_EXPLANATION_MAX))
    .nullable()
    .default(null),
  example: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_EXAMPLE_MAX))
    .nullable()
    .default(null),
  basis: conceptBasisSchema.default('explicit'),
  evidence: z.array(conceptDraftEvidenceSchema).max(10).default(() => []),
});
export type ConceptDraftRelation = z.infer<typeof conceptDraftRelationSchema>;

function refsSame(a: ConceptDraftRef, b: ConceptDraftRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'candidate'
    ? a.tempId === (b as { tempId: string }).tempId
    : (a as { conceptId: string }).conceptId === (b as { conceptId: string }).conceptId;
}

/** 版本化候选结构，首版 schemaVersion=1。 */
export const conceptDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    concepts: z.array(conceptDraftConceptSchema).max(CONCEPT_BATCH_MAX_CONCEPTS),
    relations: z.array(conceptDraftRelationSchema).max(CONCEPT_BATCH_MAX_RELATIONS),
  })
  .superRefine((draft, ctx) => {
    const conceptIds = new Set<string>();
    for (const concept of draft.concepts) {
      if (conceptIds.has(concept.tempId)) {
        ctx.addIssue({ code: 'custom', path: ['concepts'], message: `重复的概念 tempId：${concept.tempId}` });
      }
      conceptIds.add(concept.tempId);
    }
    const relationIds = new Set<string>();
    for (const relation of draft.relations) {
      if (relationIds.has(relation.tempId)) {
        ctx.addIssue({ code: 'custom', path: ['relations'], message: `重复的关系 tempId：${relation.tempId}` });
      }
      relationIds.add(relation.tempId);
      for (const [field, ref] of [
        ['fromRef', relation.fromRef],
        ['toRef', relation.toRef],
      ] as const) {
        if (ref.kind === 'candidate' && !conceptIds.has(ref.tempId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['relations'],
            message: `关系 ${relation.tempId} 的 ${field} 指向不存在的候选 ${ref.tempId}`,
          });
        }
      }
      if (refsSame(relation.fromRef, relation.toRef)) {
        ctx.addIssue({
          code: 'custom',
          path: ['relations'],
          message: `关系 ${relation.tempId} 不允许自环`,
        });
      }
    }
  });
export type ConceptDraft = z.infer<typeof conceptDraftSchema>;

/** 提交命令中的概念决定。reuse 必须带目标与版本；推断项必须 acknowledged=true。 */
export const conceptDecisionSchema = z
  .object({
    tempId: draftTempIdSchema,
    decision: z.enum(['create', 'reuse', 'skip']),
    reuseConceptId: z.string().uuid().optional(),
    reuseExpectedVersion: z.number().int().positive().optional(),
    acknowledged: z.boolean().optional(),
    /** create 时对候选内容的最终编辑。 */
    overrides: z
      .object({
        name: z.string().trim().min(1).refine(codePointsAtMost(CONCEPT_NAME_MAX)).optional(),
        aliases: z
          .array(z.string().trim().min(1).refine(codePointsAtMost(CONCEPT_ALIAS_MAX)))
          .max(CONCEPT_ALIASES_MAX)
          .optional(),
        sense: z.string().trim().min(1).refine(codePointsAtMost(500)).nullable().optional(),
        definition: z
          .string()
          .trim()
          .min(1)
          .refine(codePointsAtMost(CONCEPT_DEFINITION_MAX))
          .nullable()
          .optional(),
        example: z
          .string()
          .trim()
          .min(1)
          .refine(codePointsAtMost(CONCEPT_EXAMPLE_MAX))
          .nullable()
          .optional(),
      })
      .optional(),
    /** reuse 时补充的本文说明；写 concept_notes，不覆盖主定义。 */
    note: z.string().trim().min(1).refine(codePointsAtMost(4000)).optional(),
  })
  .superRefine((decision, ctx) => {
    if (decision.decision === 'reuse') {
      if (!decision.reuseConceptId) {
        ctx.addIssue({ code: 'custom', path: ['reuseConceptId'], message: 'reuse 需要 reuseConceptId' });
      }
      if (decision.reuseExpectedVersion === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['reuseExpectedVersion'],
          message: 'reuse 需要 reuseExpectedVersion',
        });
      }
    }
  });
export type ConceptDecision = z.infer<typeof conceptDecisionSchema>;

/** 提交命令中的关系决定；可显式把端点重绑定到已有概念，避免悬空关系。 */
export const relationDecisionSchema = z.object({
  tempId: draftTempIdSchema,
  decision: z.enum(['create', 'skip']),
  acknowledged: z.boolean().optional(),
  fromRef: conceptDraftRefSchema.optional(),
  toRef: conceptDraftRefSchema.optional(),
  overrides: z
    .object({
      kind: conceptRelationKindSchema.optional(),
      predicate: z.string().trim().min(1).refine(codePointsAtMost(CONCEPT_PREDICATE_MAX)).optional(),
      context: z
        .string()
        .trim()
        .min(1)
        .refine(codePointsAtMost(CONCEPT_CONTEXT_MAX))
        .nullable()
        .optional(),
      explanation: z
        .string()
        .trim()
        .min(1)
        .refine(codePointsAtMost(CONCEPT_EXPLANATION_MAX))
        .nullable()
        .optional(),
      example: z
        .string()
        .trim()
        .min(1)
        .refine(codePointsAtMost(CONCEPT_EXAMPLE_MAX))
        .nullable()
        .optional(),
    })
    .optional(),
});
export type RelationDecision = z.infer<typeof relationDecisionSchema>;

export const commitConceptBatchInputSchema = z
  .object({
    expectedDraftRevision: z.number().int().positive(),
    conceptDecisions: z.array(conceptDecisionSchema).max(CONCEPT_BATCH_MAX_CONCEPTS),
    relationDecisions: z.array(relationDecisionSchema).max(CONCEPT_BATCH_MAX_RELATIONS),
    requestId: z.string().trim().min(1).max(80),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const decision of input.conceptDecisions) {
      if (seen.has(decision.tempId)) {
        ctx.addIssue({ code: 'custom', path: ['conceptDecisions'], message: `重复的决定：${decision.tempId}` });
      }
      seen.add(decision.tempId);
    }
    const relationSeen = new Set<string>();
    for (const decision of input.relationDecisions) {
      if (relationSeen.has(decision.tempId)) {
        ctx.addIssue({ code: 'custom', path: ['relationDecisions'], message: `重复的决定：${decision.tempId}` });
      }
      relationSeen.add(decision.tempId);
    }
  });
export type CommitConceptBatchInput = z.infer<typeof commitConceptBatchInputSchema>;

export const conceptCommitActionSchema = z.enum(['created', 'reused', 'supplemented', 'skipped']);
export type ConceptCommitAction = z.infer<typeof conceptCommitActionSchema>;

export const conceptCommitResultSchema = z.object({
  /** tempId → 正式概念 ID（skipped 的候选不出现）。 */
  conceptIdMap: z.record(z.string(), z.string().uuid()),
  /** tempId → 正式关系 ID（skipped 的关系不出现）。 */
  relationIdMap: z.record(z.string(), z.string().uuid()),
  actions: z.object({
    concepts: z.record(z.string(), conceptCommitActionSchema),
    relations: z.record(z.string(), conceptCommitActionSchema),
  }),
  counts: z.object({
    createdConcepts: z.number().int().nonnegative(),
    reusedConcepts: z.number().int().nonnegative(),
    createdRelations: z.number().int().nonnegative(),
    supplementedRelations: z.number().int().nonnegative(),
    appendedEvidence: z.number().int().nonnegative(),
  }),
  committedAt: z.string(),
});
export type ConceptCommitResult = z.infer<typeof conceptCommitResultSchema>;

export const conceptBatchCoverageSchema = z.object({
  totalChars: z.number().int().nonnegative(),
  blocks: z.array(
    z.object({
      index: z.number().int().positive(),
      pageIndex: z.number().int().positive().nullable(),
      chars: z.number().int().nonnegative(),
      covered: z.boolean(),
    }),
  ),
});
export type ConceptBatchCoverage = z.infer<typeof conceptBatchCoverageSchema>;

/** 生成时锁定的正文快照：块编号（1-based）与页码沿用编辑器/卡片锚点约定。 */
export const conceptContentSnapshotSchema = z.object({
  hash: z.string().min(1),
  totalChars: z.number().int().nonnegative(),
  blocks: z.array(
    z.object({
      index: z.number().int().positive(),
      pageIndex: z.number().int().positive(),
      text: z.string(),
    }),
  ),
});
export type ConceptContentSnapshot = z.infer<typeof conceptContentSnapshotSchema>;

export const conceptBatchSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  status: conceptBatchStatusSchema,
  scope: conceptBatchScopeSchema,
  draftRevision: z.number().int().positive(),
  draft: conceptDraftSchema.nullable(),
  coverage: conceptBatchCoverageSchema.nullable(),
  /** ready 且当前正文 hash 与生成时不一致（或来源不可用）时为 true；派生标记，不改状态。 */
  stale: z.boolean(),
  errorCode: z.string().nullable(),
  /** 结果说明：零结果原因或计数摘要（如「未识别到领域术语」）。 */
  resultNote: z.string().nullable(),
  commitResult: conceptCommitResultSchema.nullable(),
  committedAt: z.string().nullable(),
  retryOfBatchId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConceptBatch = z.infer<typeof conceptBatchSchema>;

export const conceptBatchSelectionSchema = z.object({
  fromBlockIndex: z.number().int().positive(),
  toBlockIndex: z.number().int().positive(),
});
export type ConceptBatchSelection = z.infer<typeof conceptBatchSelectionSchema>;

export const createConceptBatchInputSchema = z.object({
  topicId: z.string().uuid(),
  scope: conceptBatchScopeSchema.default('document'),
  selection: conceptBatchSelectionSchema.optional(),
  /** 客户端保存正文后算出的 hash；与服务端不一致时拒绝（先保存再生成）。 */
  expectedDocumentHash: z.string().min(1).max(64).optional(),
  /** failed/cancelled 批次的重试：创建新批次并记录来源。 */
  retryOfBatchId: z.string().uuid().optional(),
  requestId: z.string().trim().min(1).max(80),
});
export type CreateConceptBatchInput = z.infer<typeof createConceptBatchInputSchema>;

export const updateConceptDraftInputSchema = z.object({
  expectedDraftRevision: z.number().int().positive(),
  draft: conceptDraftSchema,
});
export type UpdateConceptDraftInput = z.infer<typeof updateConceptDraftInputSchema>;

export const createConceptBatchResultSchema = z.object({
  batchId: z.string().uuid(),
  jobId: z.string().uuid(),
});
export type CreateConceptBatchResult = z.infer<typeof createConceptBatchResultSchema>;
