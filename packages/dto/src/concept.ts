import { z } from 'zod';
import { codePointsAtMost } from './card.js';
import { conceptPracticeSummarySchema } from './concept-practice.js';

/** 长度上限按 Unicode code points 计数（codePointsAtMost），与卡片约定一致。 */
export const CONCEPT_NAME_MAX = 200;
export const CONCEPT_ALIASES_MAX = 10;
export const CONCEPT_ALIAS_MAX = 200;
export const CONCEPT_SENSE_MAX = 500;
export const CONCEPT_CONTEXT_MAX = 500;
export const CONCEPT_DEFINITION_MAX = 4000;
export const CONCEPT_EXPLANATION_MAX = 4000;
export const CONCEPT_EXAMPLE_MAX = 4000;
export const CONCEPT_PREDICATE_MAX = 100;
export const CONCEPT_QUOTE_MAX = 2000;
export const CONCEPT_NOTE_MAX = 4000;

/** 概念列表分页：默认 50，最大 100。 */
export const CONCEPT_LIST_LIMIT_DEFAULT = 50;
export const CONCEPT_LIST_LIMIT_MAX = 100;
/** 概念图当前可见节点上限（也是节点单页上限）。 */
export const CONCEPT_GRAPH_NODE_LIMIT = 50;
/** 边按可见集合独立分页的单页上限。 */
export const CONCEPT_GRAPH_EDGE_PAGE = 100;

export const CONCEPT_ORIGINS = ['manual', 'agent'] as const;
export const conceptOriginSchema = z.enum(CONCEPT_ORIGINS);
export type ConceptOrigin = z.infer<typeof conceptOriginSchema>;

export const CONCEPT_RELATION_KINDS = [
  'composition',
  'execution',
  'evaluation',
  'dependency',
  'contrast',
  'other',
] as const;
export const conceptRelationKindSchema = z.enum(CONCEPT_RELATION_KINDS);
export type ConceptRelationKind = z.infer<typeof conceptRelationKindSchema>;

/** 依据：原文支持 explicit / 推断待确认 inferred / 用户补充 user。 */
export const CONCEPT_BASIS = ['explicit', 'inferred', 'user'] as const;
export const conceptBasisSchema = z.enum(CONCEPT_BASIS);
export type ConceptBasis = z.infer<typeof conceptBasisSchema>;

export const CONCEPT_EVIDENCE_AVAILABILITY = ['active', 'stale', 'unavailable'] as const;
export const conceptEvidenceAvailabilitySchema = z.enum(CONCEPT_EVIDENCE_AVAILABILITY);
export type ConceptEvidenceAvailability = z.infer<typeof conceptEvidenceAvailabilitySchema>;

const conceptNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_NAME_MAX), `名称最多 ${CONCEPT_NAME_MAX} 个字符`);
const conceptAliasSchema = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_ALIAS_MAX), `别名最多 ${CONCEPT_ALIAS_MAX} 个字符`);
const conceptAliasesSchema = z
  .array(conceptAliasSchema)
  .max(CONCEPT_ALIASES_MAX)
  .default(() => []);
const conceptSenseSchema = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_SENSE_MAX))
  .nullable()
  .optional();
const conceptDefinitionSchema = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_DEFINITION_MAX))
  .nullable()
  .optional();
const conceptExampleSchema = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_EXAMPLE_MAX))
  .nullable()
  .optional();
const conceptContextSchema = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_CONTEXT_MAX))
  .nullable()
  .optional();
const conceptPredicateSchema = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_PREDICATE_MAX), `谓词最多 ${CONCEPT_PREDICATE_MAX} 个字符`);
export const conceptQuoteSchema = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_QUOTE_MAX), `引文最多 ${CONCEPT_QUOTE_MAX} 个字符`);

/**
 * 证据定位判别联合：block（正文块号，可用前后文消歧）、pdf（页码）、quote（仅引文）。
 * 三种 kind 的字段不能混用。
 */
export const conceptEvidenceLocatorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('block'),
      blockIndex: z.number().int().positive(),
      quote: conceptQuoteSchema,
      prefix: z.string().refine(codePointsAtMost(200)).optional(),
      suffix: z.string().refine(codePointsAtMost(200)).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pdf'),
      pageNumber: z.number().int().positive(),
      quote: conceptQuoteSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('quote'),
      quote: conceptQuoteSchema,
    })
    .strict(),
]);
export type ConceptEvidenceLocator = z.infer<typeof conceptEvidenceLocatorSchema>;

/** 新建证据的输入；documentHash 由服务端按当前正文快照写入，不接受客户端自报。 */
export const conceptEvidenceInputSchema = z.object({
  documentId: z.string().uuid(),
  locator: conceptEvidenceLocatorSchema,
  basis: conceptBasisSchema.default('user'),
});
export type ConceptEvidenceInput = z.infer<typeof conceptEvidenceInputSchema>;

export const conceptEvidenceSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  conceptId: z.string().uuid().nullable(),
  relationId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  documentTitleSnapshot: z.string(),
  documentHash: z.string(),
  quote: z.string(),
  locator: conceptEvidenceLocatorSchema,
  basis: conceptBasisSchema,
  availability: conceptEvidenceAvailabilitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConceptEvidence = z.infer<typeof conceptEvidenceSchema>;

export const conceptSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid(),
  name: z.string(),
  aliases: z.array(z.string()),
  sense: z.string().nullable(),
  definition: z.string().nullable(),
  example: z.string().nullable(),
  origin: conceptOriginSchema,
  version: z.number().int().positive(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Concept = z.infer<typeof conceptSchema>;

export const conceptRelationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid(),
  fromConceptId: z.string().uuid(),
  toConceptId: z.string().uuid(),
  kind: conceptRelationKindSchema,
  predicate: z.string(),
  context: z.string().nullable(),
  explanation: z.string().nullable(),
  example: z.string().nullable(),
  origin: conceptOriginSchema,
  basis: conceptBasisSchema,
  version: z.number().int().positive(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConceptRelation = z.infer<typeof conceptRelationSchema>;

export const conceptNoteSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid(),
  conceptId: z.string().uuid().nullable(),
  relationId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  text: z.string(),
  version: z.number().int().positive(),
  basis: conceptBasisSchema,
  createdBy: conceptOriginSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConceptNote = z.infer<typeof conceptNoteSchema>;

export const documentKnowledgeRefSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid(),
  documentId: z.string().uuid(),
  conceptId: z.string().uuid().nullable(),
  relationId: z.string().uuid().nullable(),
  origin: conceptOriginSchema,
  removedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DocumentKnowledgeRef = z.infer<typeof documentKnowledgeRefSchema>;

export const cardKnowledgeLinkSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid(),
  cardId: z.string().uuid(),
  conceptId: z.string().uuid().nullable(),
  relationId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type CardKnowledgeLink = z.infer<typeof cardKnowledgeLinkSchema>;

/** 同名/别名匹配建议：只提示，不静默合并。 */
export const CONCEPT_MATCH_KINDS = ['name', 'alias'] as const;
export const conceptMatchKindSchema = z.enum(CONCEPT_MATCH_KINDS);
export type ConceptMatchKind = z.infer<typeof conceptMatchKindSchema>;

export const conceptMatchSchema = z.object({
  conceptId: z.string().uuid(),
  name: z.string(),
  sense: z.string().nullable(),
  matchedBy: conceptMatchKindSchema,
});
export type ConceptMatch = z.infer<typeof conceptMatchSchema>;

export const createConceptInputSchema = z.object({
  name: conceptNameSchema,
  aliases: conceptAliasesSchema,
  sense: conceptSenseSchema,
  definition: conceptDefinitionSchema,
  example: conceptExampleSchema,
  evidence: z.array(conceptEvidenceInputSchema).max(10).default(() => []),
});
export type CreateConceptInput = z.infer<typeof createConceptInputSchema>;

export const updateConceptInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  name: conceptNameSchema.optional(),
  aliases: z.array(conceptAliasSchema).max(CONCEPT_ALIASES_MAX).optional(),
  sense: conceptSenseSchema,
  definition: conceptDefinitionSchema,
  example: conceptExampleSchema,
});
export type UpdateConceptInput = z.infer<typeof updateConceptInputSchema>;

export const createConceptRelationInputSchema = z.object({
  fromConceptId: z.string().uuid(),
  toConceptId: z.string().uuid(),
  kind: conceptRelationKindSchema,
  predicate: conceptPredicateSchema,
  context: conceptContextSchema,
  explanation: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_EXPLANATION_MAX))
    .nullable()
    .optional(),
  example: conceptExampleSchema,
  basis: conceptBasisSchema.default('user'),
  evidence: z.array(conceptEvidenceInputSchema).max(10).default(() => []),
});
export type CreateConceptRelationInput = z.infer<typeof createConceptRelationInputSchema>;

export const updateConceptRelationInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  kind: conceptRelationKindSchema.optional(),
  predicate: conceptPredicateSchema.optional(),
  context: conceptContextSchema,
  explanation: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_EXPLANATION_MAX))
    .nullable()
    .optional(),
  example: conceptExampleSchema,
});
export type UpdateConceptRelationInput = z.infer<typeof updateConceptRelationInputSchema>;

const emptyToUndef = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const listConceptsQuerySchema = z.object({
  q: z.preprocess(emptyToUndef, z.string().trim().min(1).max(200).optional()),
  cursor: z.preprocess(emptyToUndef, z.string().max(500).optional()),
  limit: z.coerce.number().int().min(1).max(CONCEPT_LIST_LIMIT_MAX).default(CONCEPT_LIST_LIMIT_DEFAULT),
  includeArchived: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' || v === undefined ? undefined : v),
    z.boolean().optional(),
  ),
});
export type ListConceptsQuery = z.infer<typeof listConceptsQuerySchema>;

export const conceptListPageSchema = z.object({
  items: z.array(conceptSchema),
  nextCursor: z.string().nullable(),
});
export type ConceptListPage = z.infer<typeof conceptListPageSchema>;

export const conceptGraphQuerySchema = z.object({
  focusId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  documentId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  cursor: z.preprocess(emptyToUndef, z.string().max(500).optional()),
  limit: z.coerce.number().int().min(1).max(CONCEPT_GRAPH_NODE_LIMIT).default(CONCEPT_GRAPH_NODE_LIMIT),
});
export type ConceptGraphQuery = z.infer<typeof conceptGraphQuerySchema>;

export const conceptGraphNodeSchema = z.object({
  concept: conceptSchema,
  /** 主题内相邻有效关系数量，供“展开邻居”提示；不代表边已加载。 */
  neighborCount: z.number().int().nonnegative(),
  /** 本文范围下：direct = 本文明确收录；endpoint_context = 关系带出的端点。 */
  membership: z.enum(['direct', 'endpoint_context']).default('direct'),
});
export type ConceptGraphNode = z.infer<typeof conceptGraphNodeSchema>;

export const conceptGraphPageSchema = z.object({
  nodes: z.array(conceptGraphNodeSchema),
  nextCursor: z.string().nullable(),
  graphRevision: z.number().int().nonnegative(),
});
export type ConceptGraphPage = z.infer<typeof conceptGraphPageSchema>;

/**
 * 显式可见节点集合的边分页请求。nodeIds 是当前画布完整可见集合（最多 50），
 * 后端返回集合内全部符合范围的关系；edgeCursor 绑定范围与版本。
 */
export const conceptGraphViewInputSchema = z.object({
  documentId: z.string().uuid().optional(),
  nodeIds: z.array(z.string().uuid()).min(1).max(CONCEPT_GRAPH_NODE_LIMIT),
  expectedGraphRevision: z.number().int().nonnegative(),
  edgeCursor: z.string().max(500).optional(),
});
export type ConceptGraphViewInput = z.infer<typeof conceptGraphViewInputSchema>;

export const conceptGraphViewResultSchema = z.object({
  edges: z.array(conceptRelationSchema),
  nextEdgeCursor: z.string().nullable(),
  graphRevision: z.number().int().nonnegative(),
});
export type ConceptGraphViewResult = z.infer<typeof conceptGraphViewResultSchema>;

export const createConceptResultSchema = z.object({
  concept: conceptSchema,
  /** 同主题同名/别名建议；只提示，不合并。 */
  matches: z.array(conceptMatchSchema),
});
export type CreateConceptResult = z.infer<typeof createConceptResultSchema>;

export const createConceptRelationResultSchema = z.object({
  relation: conceptRelationSchema,
  /** false 表示命中相同身份的有效关系，本次仅补充证据。 */
  created: z.boolean(),
  evidenceAppended: z.number().int().nonnegative(),
});
export type CreateConceptRelationResult = z.infer<typeof createConceptRelationResultSchema>;

export const conceptArchiveResultSchema = z.object({
  concept: conceptSchema,
  /** 归档概念时连带归档的有效关系数量。 */
  archivedRelations: z.number().int().nonnegative(),
  /** 被标记需显式恢复的练习绑定数量（M1 恒为 0，绑定写入口在 M3/T6 开放）。 */
  affectedPractices: z.number().int().nonnegative(),
});
export type ConceptArchiveResult = z.infer<typeof conceptArchiveResultSchema>;

export const relationArchiveResultSchema = z.object({
  relation: conceptRelationSchema,
  affectedPractices: z.number().int().nonnegative(),
});
export type RelationArchiveResult = z.infer<typeof relationArchiveResultSchema>;

/** 概念详情：概念本体 + 分页相邻关系 + 证据。练习摘要在 M3/T6 补充。 */
export const conceptDetailSchema = z.object({
  concept: conceptSchema,
  relations: z.array(conceptRelationSchema),
  relationsNextCursor: z.string().nullable(),
  evidence: z.array(conceptEvidenceSchema),
  /** 练习摘要（M3/T6）；无绑定时 binding 为 null。 */
  practice: conceptPracticeSummarySchema.optional(),
});
export type ConceptDetail = z.infer<typeof conceptDetailSchema>;

export const conceptRelationDetailSchema = z.object({
  relation: conceptRelationSchema,
  fromConcept: conceptSchema,
  toConcept: conceptSchema,
  evidence: z.array(conceptEvidenceSchema),
  practice: conceptPracticeSummarySchema.optional(),
});
export type ConceptRelationDetail = z.infer<typeof conceptRelationDetailSchema>;

/** saveConceptBundle 的主概念：新建或复用已有（复用只补充，不覆盖主定义）。 */
export const bundleConceptSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    name: conceptNameSchema,
    aliases: conceptAliasesSchema,
    sense: conceptSenseSchema,
    definition: conceptDefinitionSchema,
    example: conceptExampleSchema,
    evidence: z.array(conceptEvidenceInputSchema).max(10).default(() => []),
  }),
  z.object({
    kind: z.literal('reuse'),
    conceptId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    /** 复用时补充的本文说明；写入 concept_notes，不改共享定义。 */
    note: z
      .string()
      .trim()
      .min(1)
      .refine(codePointsAtMost(CONCEPT_NOTE_MAX))
      .optional(),
    evidence: z.array(conceptEvidenceInputSchema).max(10).default(() => []),
  }),
]);
export type BundleConcept = z.infer<typeof bundleConceptSchema>;

export const bundleRelationEndpointSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    name: conceptNameSchema,
    aliases: conceptAliasesSchema,
    sense: conceptSenseSchema,
    definition: conceptDefinitionSchema,
    example: conceptExampleSchema,
  }),
  z.object({ kind: z.literal('existing'), conceptId: z.string().uuid() }),
]);
export type BundleRelationEndpoint = z.infer<typeof bundleRelationEndpointSchema>;

export const bundleRelationInputSchema = z.object({
  /** outgoing：主概念是源；incoming：主概念是目标。 */
  direction: z.enum(['outgoing', 'incoming']),
  other: bundleRelationEndpointSchema,
  kind: conceptRelationKindSchema,
  predicate: conceptPredicateSchema,
  context: conceptContextSchema,
  explanation: z
    .string()
    .trim()
    .min(1)
    .refine(codePointsAtMost(CONCEPT_EXPLANATION_MAX))
    .nullable()
    .optional(),
  example: conceptExampleSchema,
  basis: conceptBasisSchema.default('user'),
  evidence: z.array(conceptEvidenceInputSchema).max(10).default(() => []),
});
export type BundleRelationInput = z.infer<typeof bundleRelationInputSchema>;

export const saveConceptBundleInputSchema = z.object({
  concept: bundleConceptSchema,
  relations: z.array(bundleRelationInputSchema).max(20).default(() => []),
  /** 提供时为所有接受的目标写入本文引用；主题入口无 documentId 则不写。 */
  documentId: z.string().uuid().optional(),
  requestId: z.string().trim().min(1).max(80),
});
export type SaveConceptBundleInput = z.infer<typeof saveConceptBundleInputSchema>;

export const saveConceptBundleResultSchema = z.object({
  concept: conceptSchema,
  /** 复用已有概念时为 true。 */
  conceptReused: z.boolean(),
  createdConcepts: z.array(conceptSchema),
  relations: z.array(
    z.object({
      relation: conceptRelationSchema,
      created: z.boolean(),
    }),
  ),
});
export type SaveConceptBundleResult = z.infer<typeof saveConceptBundleResultSchema>;

export const conceptMatchesQuerySchema = z.object({
  name: conceptNameSchema,
  aliases: z.array(conceptAliasSchema).max(CONCEPT_ALIASES_MAX).default(() => []),
});
export type ConceptMatchesQuery = z.infer<typeof conceptMatchesQuerySchema>;

/** archive / restore 的版本校验输入。 */
export const conceptVersionInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type ConceptVersionInput = z.infer<typeof conceptVersionInputSchema>;

export const evidenceResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resolved'),
    evidenceId: z.string().uuid(),
    documentId: z.string().uuid(),
    blockIndex: z.number().int().positive().nullable(),
    pageIndex: z.number().int().positive().nullable(),
    /** 正文自证据保存以来是否变化（定位仍唯一时可为 true）。 */
    hashChanged: z.boolean(),
    quote: z.string(),
  }),
  z.object({
    status: z.literal('stale'),
    evidenceId: z.string().uuid(),
    documentId: z.string().uuid().nullable(),
    quote: z.string(),
    documentTitleSnapshot: z.string(),
  }),
  z.object({
    status: z.literal('unavailable'),
    evidenceId: z.string().uuid(),
    documentId: z.string().uuid().nullable(),
    quote: z.string(),
    documentTitleSnapshot: z.string(),
  }),
]);
export type EvidenceResolution = z.infer<typeof evidenceResolutionSchema>;

// ---- T7a：本文知识范围、说明与位置解析 ----

/** 本文成员身份：direct = 本文明确收录；endpoint_context = 关系带出的端点。 */
export const KNOWLEDGE_MEMBERSHIPS = ['direct', 'endpoint_context'] as const;
export type KnowledgeMembership = (typeof KNOWLEDGE_MEMBERSHIPS)[number];

export const documentKnowledgeConceptSchema = z.object({
  concept: conceptSchema,
  membership: conceptMatchKindSchema.optional(),
  notes: z.array(conceptNoteSchema),
  evidence: z.array(conceptEvidenceSchema),
});
export const documentKnowledgeEntryConceptSchema = z.object({
  concept: conceptSchema,
  membership: z.enum(KNOWLEDGE_MEMBERSHIPS),
  notes: z.array(conceptNoteSchema),
  evidence: z.array(conceptEvidenceSchema),
});
export type DocumentKnowledgeConcept = z.infer<typeof documentKnowledgeEntryConceptSchema>;

export const documentKnowledgeRelationSchema = z.object({
  relation: conceptRelationSchema,
  fromConcept: conceptSchema,
  toConcept: conceptSchema,
  notes: z.array(conceptNoteSchema),
  evidence: z.array(conceptEvidenceSchema),
});
export type DocumentKnowledgeRelation = z.infer<typeof documentKnowledgeRelationSchema>;

export const documentKnowledgeSchema = z.object({
  concepts: z.array(documentKnowledgeEntryConceptSchema),
  relations: z.array(documentKnowledgeRelationSchema),
  nextCursor: z.string().nullable(),
});
export type DocumentKnowledge = z.infer<typeof documentKnowledgeSchema>;

export const documentKnowledgeQuerySchema = z.object({
  topicId: z.string().uuid(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export type DocumentKnowledgeQuery = z.infer<typeof documentKnowledgeQuerySchema>;

export const setDocumentKnowledgeRefInputSchema = z.object({
  topicId: z.string().uuid(),
  targetKind: z.enum(['concept', 'relation']),
  targetId: z.string().uuid(),
  requestId: z.string().trim().min(1).max(80),
});
export type SetDocumentKnowledgeRefInput = z.infer<typeof setDocumentKnowledgeRefInputSchema>;

export const removeDocumentKnowledgeRefInputSchema = z.object({
  /** 移除概念引用会连带移除本文涉及它的关系引用，必须显式确认。 */
  confirmDependentRelations: z.boolean().default(false),
});
export type RemoveDocumentKnowledgeRefInput = z.infer<typeof removeDocumentKnowledgeRefInputSchema>;

export const createConceptNoteInputSchema = z.object({
  targetKind: z.enum(['concept', 'relation']),
  targetId: z.string().uuid(),
  documentId: z.string().uuid().nullable().default(null),
  text: z.string().trim().min(1).refine(codePointsAtMost(CONCEPT_NOTE_MAX)),
});
export type CreateConceptNoteInput = z.infer<typeof createConceptNoteInputSchema>;

export const updateConceptNoteInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  text: z.string().trim().min(1).refine(codePointsAtMost(CONCEPT_NOTE_MAX)),
});
export type UpdateConceptNoteInput = z.infer<typeof updateConceptNoteInputSchema>;

export const knowledgeLocationCardSchema = z.object({
  cardId: z.string().uuid(),
  /** 卡片在本文脑图上的画布节点 id；未挂载为 null（不伪造节点）。 */
  canvasNodeId: z.string().uuid().nullable(),
  concept: z.string(),
  isPrimaryPractice: z.boolean(),
});
export type KnowledgeLocationCard = z.infer<typeof knowledgeLocationCardSchema>;

export const knowledgeLocationEvidenceSchema = z.object({
  evidenceId: z.string().uuid(),
  quote: z.string(),
  status: z.enum(['resolved', 'stale', 'unavailable']),
  blockIndex: z.number().int().positive().nullable(),
  pageIndex: z.number().int().positive().nullable(),
});
export type KnowledgeLocationEvidence = z.infer<typeof knowledgeLocationEvidenceSchema>;

export const knowledgeLocationsSchema = z.object({
  cards: z.array(knowledgeLocationCardSchema),
  annotations: z.array(z.object({ annotationId: z.string().uuid(), quote: z.string() })),
  evidence: z.array(knowledgeLocationEvidenceSchema),
});
export type KnowledgeLocations = z.infer<typeof knowledgeLocationsSchema>;

export const knowledgeLocationsQuerySchema = z.object({
  topicId: z.string().uuid(),
  targetKind: z.enum(['concept', 'relation']),
  targetId: z.string().uuid(),
});
export type KnowledgeLocationsQuery = z.infer<typeof knowledgeLocationsQuerySchema>;
