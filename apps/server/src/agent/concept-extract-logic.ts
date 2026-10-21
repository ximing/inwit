import type {
  ConceptBasis,
  ConceptDraft,
  ConceptDraftEvidence,
  ConceptDraftRef,
  ConceptEvidenceLocator,
  ConceptMatch,
} from '@inwit/dto';
import {
  CONCEPT_BATCH_MAX_CONCEPTS,
  CONCEPT_BATCH_MAX_RELATIONS,
  CONCEPT_CHUNK_TARGET_CHARS,
  CONCEPT_PREDICATE_MAX,
  CONCEPT_QUOTE_MAX,
  codePointsAtMost,
  conceptRelationKindSchema,
} from '@inwit/dto';
import { z } from 'zod';
import { normalizeConceptName } from '../concepts/concept-identity.js';
import { validateEvidenceInBlocks } from '../concepts/concept-evidence-logic.js';

/**
 * concept_extract 的纯逻辑：分片、提交校验、跨分片合并、证据核验与草稿定稿。
 * 不依赖数据库；快照与匹配结果由调用方注入。
 */

export interface ExtractBlock {
  index: number;
  pageIndex: number;
  text: string;
}

/** 超长块的片段：offset 为块文本内的 code point 区间，可回溯到原块。 */
export interface ShardPiece {
  blockIndex: number;
  pageIndex: number;
  text: string;
  offsetStart: number;
  offsetEnd: number;
  /** true 表示这是被拆分块的一部分。 */
  partial: boolean;
}

export interface ExtractShard {
  shardIndex: number;
  pieces: ShardPiece[];
  chars: number;
}

function codePoints(text: string): string[] {
  return [...text];
}

/** 按块打包分片；超过目标的块按 code point 边界拆分并记录偏移。 */
export function shardBlocks(
  blocks: readonly ExtractBlock[],
  targetChars = CONCEPT_CHUNK_TARGET_CHARS,
): ExtractShard[] {
  const shards: ExtractShard[] = [];
  let pieces: ShardPiece[] = [];
  let chars = 0;
  const flush = () => {
    if (pieces.length === 0) return;
    shards.push({ shardIndex: shards.length, pieces, chars });
    pieces = [];
    chars = 0;
  };
  const pushPiece = (piece: ShardPiece) => {
    pieces.push(piece);
    chars += piece.text.length === 0 ? 0 : codePoints(piece.text).length;
  };

  for (const block of blocks) {
    if (block.text.trim() === '') continue;
    const blockChars = codePoints(block.text);
    if (blockChars.length > targetChars) {
      // 超长块：先结束当前分片，再单独切成若干片段。
      flush();
      let start = 0;
      while (start < blockChars.length) {
        const part = blockChars.slice(start, start + targetChars).join('');
        pushPiece({
          blockIndex: block.index,
          pageIndex: block.pageIndex,
          text: part,
          offsetStart: start,
          offsetEnd: start + codePoints(part).length,
          partial: true,
        });
        start += codePoints(part).length;
        if (chars >= targetChars) flush();
      }
      continue;
    }
    if (pieces.length > 0 && chars + blockChars.length > targetChars) flush();
    pushPiece({
      blockIndex: block.index,
      pageIndex: block.pageIndex,
      text: block.text,
      offsetStart: 0,
      offsetEnd: blockChars.length,
      partial: false,
    });
  }
  flush();
  return shards;
}

/** 分片在上下文中的展示：块号/页码与编辑器锚点一致，片段标注偏移。 */
export function formatShardText(shard: ExtractShard): string {
  return shard.pieces
    .map((piece) => {
      const part = piece.partial
        ? ` | 片段 ${String(piece.offsetStart + 1)}-${String(piece.offsetEnd)}`
        : '';
      return `[块 ${String(piece.blockIndex)} | 第 ${String(piece.pageIndex)} 页${part}] ${piece.text}`;
    })
    .join('\n');
}

const submissionQuote = z
  .string()
  .trim()
  .min(1)
  .refine(codePointsAtMost(CONCEPT_QUOTE_MAX));

/** 模型提交的证据：引文 + 可选块号/页码。 */
export const extractEvidenceSubmissionSchema = z.object({
  quote: submissionQuote,
  blockIndex: z.number().int().positive().optional(),
  pageIndex: z.number().int().positive().optional(),
});
export type ExtractEvidenceSubmission = z.infer<typeof extractEvidenceSubmissionSchema>;

const submissionBasis = z.enum(['explicit', 'inferred']).default('explicit');

const conceptSubmissionSchema = z.object({
  tempId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).refine(codePointsAtMost(200)),
  aliases: z.array(z.string().trim().min(1).refine(codePointsAtMost(200))).max(10).default(() => []),
  sense: z.string().trim().min(1).refine(codePointsAtMost(500)).nullable().default(null),
  definition: z.string().trim().min(1).refine(codePointsAtMost(4000)).nullable().default(null),
  example: z.string().trim().min(1).refine(codePointsAtMost(4000)).nullable().default(null),
  basis: submissionBasis,
  evidence: z.array(extractEvidenceSubmissionSchema).max(10).default(() => []),
});
export type ConceptSubmission = z.infer<typeof conceptSubmissionSchema>;

/** 关系端点：本批候选 tempId、主题已有概念 conceptId，或按名称引用前面分片的候选。 */
const endpointSubmissionSchema = z
  .object({
    tempId: z.string().trim().min(1).max(40).optional(),
    conceptId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (value) =>
      [value.tempId, value.conceptId, value.name].filter((item) => item !== undefined).length === 1,
    '端点必须且只能给 tempId、conceptId 或 name 之一',
  );
export type EndpointSubmission = z.infer<typeof endpointSubmissionSchema>;

const relationSubmissionSchema = z.object({
  tempId: z.string().trim().min(1).max(40),
  from: endpointSubmissionSchema,
  to: endpointSubmissionSchema,
  kind: conceptRelationKindSchema,
  predicate: z.string().trim().min(1).refine(codePointsAtMost(CONCEPT_PREDICATE_MAX)),
  context: z.string().trim().min(1).refine(codePointsAtMost(500)).nullable().default(null),
  explanation: z.string().trim().min(1).refine(codePointsAtMost(4000)).nullable().default(null),
  example: z.string().trim().min(1).refine(codePointsAtMost(4000)).nullable().default(null),
  basis: submissionBasis,
  evidence: z.array(extractEvidenceSubmissionSchema).max(10).default(() => []),
});
export type RelationSubmission = z.infer<typeof relationSubmissionSchema>;

/** 单个分片的提交。结构校验失败返回 zod 错误（模型有一次修复机会）。 */
export const shardSubmissionSchema = z
  .object({
    shardIndex: z.number().int().nonnegative(),
    concepts: z.array(conceptSubmissionSchema).max(CONCEPT_BATCH_MAX_CONCEPTS),
    relations: z.array(relationSubmissionSchema).max(CONCEPT_BATCH_MAX_RELATIONS),
    /** 这个分片没有可提取内容时的说明。 */
    note: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((submission, ctx) => {
    const conceptIds = new Set<string>();
    for (const concept of submission.concepts) {
      if (conceptIds.has(concept.tempId)) {
        ctx.addIssue({ code: 'custom', path: ['concepts'], message: `重复的概念 tempId：${concept.tempId}` });
      }
      conceptIds.add(concept.tempId);
    }
    const relationIds = new Set<string>();
    for (const relation of submission.relations) {
      if (relationIds.has(relation.tempId)) {
        ctx.addIssue({ code: 'custom', path: ['relations'], message: `重复的关系 tempId：${relation.tempId}` });
      }
      relationIds.add(relation.tempId);
      // 本分片内的候选自环在合并后兜底；这里先拦同 tempId 自环
      if (relation.from.tempId !== undefined && relation.from.tempId === relation.to.tempId) {
        ctx.addIssue({ code: 'custom', path: ['relations'], message: `关系 ${relation.tempId} 不允许自环` });
      }
    }
  });
export type ShardSubmission = z.infer<typeof shardSubmissionSchema>;

/** One shard should stay small enough that a thinking model can submit it inside the run budget. */
export const SHARD_CONCEPT_CAP = 4;
export const SHARD_RELATION_CAP = 6;

export function shardCapIssue(submission: {
  concepts: readonly unknown[];
  relations: readonly unknown[];
}): string | null {
  if (
    submission.concepts.length <= SHARD_CONCEPT_CAP &&
    submission.relations.length <= SHARD_RELATION_CAP
  ) {
    return null;
  }
  return `这一分片最多 ${String(SHARD_CONCEPT_CAP)} 个概念、${String(SHARD_RELATION_CAP)} 条关系。请只保留本段最核心的，每条证据只留一句短引文，然后重新提交。`;
}

export function acceptedShardSubmissions(value: unknown): ShardSubmission[] {
  if (!Array.isArray(value)) return [];
  const out: ShardSubmission[] = [];
  for (const item of value) {
    const parsed = shardSubmissionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Next shard index to read. Returns shardCount when every shard is already accepted. */
export function firstUnreadShard(shardCount: number, accepted: readonly number[]): number {
  const have = new Set(accepted);
  for (let index = 0; index < shardCount; index += 1) {
    if (!have.has(index)) return index;
  }
  return shardCount;
}

/** 4 minutes per shard, at least 10 and at most 30. A retry resumes, so one attempt need not finish every shard. */
export function conceptExtractTimeoutMs(shardCount: number): number {
  const minutes = Math.min(30, Math.max(10, Math.max(0, shardCount) * 4));
  return minutes * 60_000;
}

export function submissionIssuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('；');
}

export class ExtractTooLargeError extends Error {
  constructor(
    readonly concepts: number,
    readonly relations: number,
  ) {
    super(`候选超出硬上限：concepts=${String(concepts)} relations=${String(relations)}`);
    this.name = 'ExtractTooLargeError';
  }
}

interface MergedConcept {
  tempId: string;
  name: string;
  aliases: string[];
  sense: string | null;
  definition: string | null;
  example: string | null;
  basis: ConceptBasis;
  evidence: ExtractEvidenceSubmission[];
}

interface MergedRelation {
  tempId: string;
  from: EndpointSubmission;
  to: EndpointSubmission;
  kind: RelationSubmission['kind'];
  predicate: string;
  context: string | null;
  explanation: string | null;
  example: string | null;
  basis: ConceptBasis;
  evidence: ExtractEvidenceSubmission[];
}

/** 跨分片合并：tempId 加分片前缀；同名候选（规范化名称相同）合并为一条。 */
export function mergeShardSubmissions(submissions: readonly ShardSubmission[]): {
  concepts: MergedConcept[];
  relations: MergedRelation[];
  notes: string[];
} {
  const concepts: MergedConcept[] = [];
  const byNormalizedName = new Map<string, MergedConcept>();
  const tempIdAlias = new Map<string, string>();
  const notes: string[] = [];

  for (const submission of submissions) {
    const prefix = `s${String(submission.shardIndex)}:`;
    if (submission.note) notes.push(submission.note);
    for (const concept of submission.concepts) {
      const namespaced = `${prefix}${concept.tempId}`;
      const normalized = normalizeConceptName(concept.name);
      const existing = byNormalizedName.get(normalized);
      if (existing) {
        // 合并明显相同候选：补别名/证据，空字段互补，basis 从严（ inferred 优先暴露）
        tempIdAlias.set(namespaced, existing.tempId);
        existing.aliases = [...new Set([...existing.aliases, ...concept.aliases])].slice(0, 10);
        existing.sense ??= concept.sense;
        existing.definition ??= concept.definition;
        existing.example ??= concept.example;
        existing.evidence = [...existing.evidence, ...concept.evidence].slice(0, 10);
        if (concept.basis === 'inferred') existing.basis = 'inferred';
        continue;
      }
      const merged: MergedConcept = { ...concept, tempId: namespaced };
      concepts.push(merged);
      byNormalizedName.set(normalized, merged);
      tempIdAlias.set(namespaced, merged.tempId);
    }
  }

  const relations: MergedRelation[] = [];
  for (const submission of submissions) {
    const prefix = `s${String(submission.shardIndex)}:`;
    for (const relation of submission.relations) {
      const remap = (endpoint: EndpointSubmission): EndpointSubmission =>
        endpoint.tempId !== undefined
          ? { tempId: tempIdAlias.get(`${prefix}${endpoint.tempId}`) ?? `${prefix}${endpoint.tempId}` }
          : endpoint;
      relations.push({
        ...relation,
        tempId: `${prefix}${relation.tempId}`,
        from: remap(relation.from),
        to: remap(relation.to),
      });
    }
  }
  return { concepts, relations, notes };
}

function locatorFromSubmission(
  evidence: ExtractEvidenceSubmission,
): ConceptEvidenceLocator | null {
  if (evidence.blockIndex !== undefined) {
    return { kind: 'block', blockIndex: evidence.blockIndex, quote: evidence.quote };
  }
  if (evidence.pageIndex !== undefined) {
    return { kind: 'pdf', pageNumber: evidence.pageIndex, quote: evidence.quote };
  }
  return { kind: 'quote', quote: evidence.quote };
}

export interface FinalizeResult {
  draft: ConceptDraft;
  /** 引文无法核验而被丢弃的证据条数（所在项 basis 降级为 inferred）。 */
  droppedEvidence: number;
  /** 端点无法闭合或自环而被丢弃的关系数。 */
  droppedRelations: number;
}

/**
 * 定稿：解析端点（候选/已有/按名称引用）、核验引文是否真实位于快照、
 * 应用硬上限。返回结构一定通过共享 conceptDraftSchema。
 */
export function finalizeConceptDraft(input: {
  submissions: readonly ShardSubmission[];
  snapshotBlocks: readonly ExtractBlock[];
  /** 每个合并后概念的同主题匹配建议（服务端检索，最多 5 条）。 */
  matchCandidates: readonly ConceptMatch[][];
  /** 允许引用的已有概念（ownership 已在查询时校验）。 */
  existingConceptIds: ReadonlySet<string>;
}): FinalizeResult {
  const merged = mergeShardSubmissions(input.submissions);
  const snapshotBlocks = input.snapshotBlocks.map((block) => ({
    index: block.index,
    pageIndex: block.pageIndex,
    text: block.text,
  }));

  let droppedEvidence = 0;
  const draftConcepts: ConceptDraft['concepts'] = merged.concepts.map((concept, index) => {
    const keptEvidence: ConceptDraftEvidence[] = [];
    for (const evidence of concept.evidence) {
      const locator = locatorFromSubmission(evidence);
      if (!locator) {
        droppedEvidence += 1;
        continue;
      }
      const validation = validateEvidenceInBlocks(snapshotBlocks, locator);
      if (!validation.ok) {
        droppedEvidence += 1;
        continue;
      }
      keptEvidence.push({ locator, basis: 'explicit' });
    }
    // 声称原文支持但证据全部核验失败 → 降级为推断待确认，不伪造证据。
    const basis: ConceptBasis =
      concept.basis === 'explicit' && concept.evidence.length > 0 && keptEvidence.length === 0
        ? 'inferred'
        : concept.basis;
    return {
      tempId: concept.tempId,
      name: concept.name,
      aliases: concept.aliases,
      sense: concept.sense,
      definition: concept.definition,
      example: concept.example,
      basis,
      evidence: keptEvidence,
      matchCandidates: input.matchCandidates[index] ?? [],
    };
  });

  const conceptByTempId = new Map(draftConcepts.map((concept) => [concept.tempId, concept]));
  const conceptByName = new Map<string, string>();
  for (const concept of merged.concepts) {
    conceptByName.set(normalizeConceptName(concept.name), concept.tempId);
  }

  let droppedRelations = 0;
  const draftRelations: ConceptDraft['relations'] = [];
  for (const relation of merged.relations) {
    const resolveRef = (endpoint: EndpointSubmission): ConceptDraftRef | null => {
      if (endpoint.conceptId !== undefined) {
        if (!input.existingConceptIds.has(endpoint.conceptId)) return null;
        return { kind: 'existing', conceptId: endpoint.conceptId, version: 0 };
      }
      const tempId =
        endpoint.tempId !== undefined
          ? endpoint.tempId
          : endpoint.name !== undefined
            ? conceptByName.get(normalizeConceptName(endpoint.name))
            : undefined;
      if (!tempId || !conceptByTempId.has(tempId)) return null;
      return { kind: 'candidate', tempId };
    };
    const fromRef = resolveRef(relation.from);
    const toRef = resolveRef(relation.to);
    // 悬空端点与合并后产生的自环都丢弃（记录计数，不静默放行）。
    if (!fromRef || !toRef) {
      droppedRelations += 1;
      continue;
    }
    const sameCandidate =
      fromRef.kind === 'candidate' && toRef.kind === 'candidate' && fromRef.tempId === toRef.tempId;
    const sameExisting =
      fromRef.kind === 'existing' && toRef.kind === 'existing' && fromRef.conceptId === toRef.conceptId;
    if (sameCandidate || sameExisting) {
      droppedRelations += 1;
      continue;
    }
    const keptEvidence: ConceptDraftEvidence[] = [];
    for (const evidence of relation.evidence) {
      const locator = locatorFromSubmission(evidence);
      if (!locator) {
        droppedEvidence += 1;
        continue;
      }
      if (!validateEvidenceInBlocks(snapshotBlocks, locator).ok) {
        droppedEvidence += 1;
        continue;
      }
      keptEvidence.push({ locator, basis: 'explicit' });
    }
    const basis: ConceptBasis =
      relation.basis === 'explicit' && relation.evidence.length > 0 && keptEvidence.length === 0
        ? 'inferred'
        : relation.basis;
    draftRelations.push({
      tempId: relation.tempId,
      fromRef,
      toRef,
      kind: relation.kind,
      predicate: relation.predicate,
      context: relation.context,
      explanation: relation.explanation,
      example: relation.example,
      basis,
      evidence: keptEvidence,
    });
  }

  if (draftConcepts.length > CONCEPT_BATCH_MAX_CONCEPTS || draftRelations.length > CONCEPT_BATCH_MAX_RELATIONS) {
    throw new ExtractTooLargeError(draftConcepts.length, draftRelations.length);
  }
  return {
    draft: { schemaVersion: 1, concepts: draftConcepts, relations: draftRelations },
    droppedEvidence,
    droppedRelations,
  };
}

/** 已有概念版本号在 finalize 后由服务端填充；此处仅占位（提交时以数据库为准）。 */
export function fillExistingRefVersions(
  draft: ConceptDraft,
  versions: ReadonlyMap<string, number>,
): ConceptDraft {
  const fill = (ref: ConceptDraft['relations'][number]['fromRef']): ConceptDraft['relations'][number]['fromRef'] => {
    if (ref.kind !== 'existing') return ref;
    const version = versions.get(ref.conceptId);
    return version === undefined ? ref : { ...ref, version };
  };
  return {
    ...draft,
    relations: draft.relations.map((relation) => ({
      ...relation,
      fromRef: fill(relation.fromRef),
      toRef: fill(relation.toRef),
    })),
  };
}
