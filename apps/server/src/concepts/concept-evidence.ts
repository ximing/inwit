import type {
  ConceptBasis,
  ConceptBatchCoverage,
  ConceptEvidenceInput,
  ConceptEvidenceLocator,
  EvidenceResolution,
} from '@inwit/dto';
import { CONCEPT_SOURCE_MAX_CHARS } from '@inwit/dto';
import { blocksFromPmJSON, type DocBlock } from '@inwit/doc-schema';
import { and, eq } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { conceptEvidence, documents, type DocumentRow } from '../db/schema.js';
import { asPmJson } from '../documents/content-json.js';
import { AppError } from '../errors.js';
import { evidenceDedupeHash } from './concept-identity.js';
import {
  documentHashFromBlocks,
  resolveQuoteLocation,
  totalCharsOfBlocks,
  validateEvidenceInBlocks,
} from './concept-evidence-logic.js';

type Db = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

export interface ConceptSourceSnapshot {
  documentId: string;
  title: string;
  hash: string;
  blocks: DocBlock[];
  totalChars: number;
  coverage: ConceptBatchCoverage;
}

function coverageOf(blocks: readonly DocBlock[], totalChars: number): ConceptBatchCoverage {
  return {
    totalChars,
    blocks: blocks.map((block) => ({
      index: block.index,
      pageIndex: block.pageIndex,
      chars: [...block.text].length,
      covered: block.text.trim() !== '',
    })),
  };
}

/** 文档正文块（含空文本的 pageBreak 占位块），与编辑器/卡片锚点同一编号。 */
export function blocksOfDocument(document: DocumentRow): DocBlock[] {
  try {
    return blocksFromPmJSON(asPmJson(document.contentJson));
  } catch {
    return [];
  }
}

export function documentHashOf(document: DocumentRow): string {
  return documentHashFromBlocks(blocksOfDocument(document));
}

/**
 * 生成当前文档的正文快照。空文、未提取文本的 PDF、超长文档分别给出
 * 可识别错误；scope=selection 时截取指定块范围（闭区间，1-based）。
 */
export async function snapshotConceptSource(
  userId: string,
  documentId: string,
  scope: 'document' | 'selection' = 'document',
  selection?: { fromBlockIndex: number; toBlockIndex: number },
): Promise<ConceptSourceSnapshot> {
  const [document] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!document || document.deletedAt) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');

  let blocks = blocksOfDocument(document);
  if (scope === 'selection') {
    if (!selection || selection.fromBlockIndex > selection.toBlockIndex) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    blocks = blocks.filter(
      (block) => block.index >= selection.fromBlockIndex && block.index <= selection.toBlockIndex,
    );
  }
  const totalChars = totalCharsOfBlocks(blocks.filter((block) => block.text.trim() !== ''));
  if (totalChars === 0) {
    // 有原件但没有可处理文本：提示先完成提取，与真正的空文区分。
    if (document.fileKey && document.fileMime !== null) {
      throw AppError.of(422, 'CONCEPT_SOURCE_NOT_EXTRACTED');
    }
    throw AppError.of(422, 'CONCEPT_SOURCE_EMPTY');
  }
  if (totalChars > CONCEPT_SOURCE_MAX_CHARS) {
    throw AppError.of(422, 'CONCEPT_SOURCE_TOO_LONG', { totalChars, max: CONCEPT_SOURCE_MAX_CHARS });
  }
  return {
    documentId: document.id,
    title: document.title ?? '',
    hash: documentHashFromBlocks(blocks),
    blocks,
    totalChars,
    coverage: coverageOf(blocks, totalChars),
  };
}

export interface EvidenceWriteItem {
  documentId: string;
  locator: ConceptEvidenceLocator;
  basis: ConceptBasis;
}

/**
 * 为一个概念/关系写入证据：引文必须能在当前正文快照中唯一定位；
 * 重复证据（同目标同哈希）跳过。返回实际追加条数。
 * 调用方负责事务与权限；文档不属于该用户时抛 404。
 */
export async function insertEvidenceForTarget(
  db: Db,
  input: {
    userId: string;
    target: { conceptId: string } | { relationId: string };
    items: readonly EvidenceWriteItem[];
    /** 事务内可选的文档快照缓存，避免同文档重复计算。 */
    snapshots?: Map<string, ConceptSourceSnapshot>;
  },
): Promise<number> {
  let appended = 0;
  const snapshots = input.snapshots ?? new Map<string, ConceptSourceSnapshot>();
  for (const item of input.items) {
    let snapshot = snapshots.get(item.documentId);
    if (!snapshot) {
      snapshot = await snapshotConceptSource(input.userId, item.documentId);
      snapshots.set(item.documentId, snapshot);
    }
    const validation = validateEvidenceInBlocks(snapshot.blocks, item.locator);
    if (!validation.ok) {
      throw AppError.of(422, 'EVIDENCE_QUOTE_INVALID', { reason: validation.reason });
    }
    const targetKind = 'conceptId' in input.target ? 'concept' : 'relation';
    const targetId = 'conceptId' in input.target ? input.target.conceptId : input.target.relationId;
    const hash = evidenceDedupeHash({
      targetKind,
      targetId,
      documentId: item.documentId,
      documentHash: snapshot.hash,
      locator: item.locator,
    });
    const existing = await db
      .select({ id: conceptEvidence.id })
      .from(conceptEvidence)
      .where(
        and(
          eq(
            targetKind === 'concept' ? conceptEvidence.conceptId : conceptEvidence.relationId,
            targetId,
          ),
          eq(conceptEvidence.evidenceHash, hash),
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(conceptEvidence).values({
      userId: input.userId,
      conceptId: targetKind === 'concept' ? targetId : null,
      relationId: targetKind === 'relation' ? targetId : null,
      documentId: item.documentId,
      documentTitleSnapshot: snapshot.title,
      documentHash: snapshot.hash,
      quote: item.locator.quote,
      locator: item.locator,
      basis: item.basis,
      evidenceHash: hash,
    });
    appended += 1;
  }
  return appended;
}

export function evidenceInputToWriteItem(input: ConceptEvidenceInput): EvidenceWriteItem {
  return { documentId: input.documentId, locator: input.locator, basis: input.basis };
}

/**
 * 出处跳转解析：文档硬删除/软删除 → unavailable（保留摘录，不冒充定位）；
 * 当前正文中能唯一定位 → resolved（携带 hashChanged）；否则 stale。
 */
export async function resolveConceptEvidence(
  userId: string,
  evidenceId: string,
): Promise<EvidenceResolution> {
  const [row] = await getDb()
    .select()
    .from(conceptEvidence)
    .where(and(eq(conceptEvidence.id, evidenceId), eq(conceptEvidence.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CONCEPT_EVIDENCE_NOT_FOUND');

  const base = {
    evidenceId: row.id,
    documentId: row.documentId,
    quote: row.quote,
    documentTitleSnapshot: row.documentTitleSnapshot,
  };
  if (!row.documentId) {
    return { status: 'unavailable', ...base };
  }
  const [document] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, row.documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!document || document.deletedAt) {
    if (row.availability !== 'unavailable') {
      await getDb()
        .update(conceptEvidence)
        .set({ availability: 'unavailable', updatedAt: new Date() })
        .where(eq(conceptEvidence.id, row.id));
    }
    return { status: 'unavailable', ...base };
  }

  const blocks = blocksOfDocument(document);
  const resolution = resolveQuoteLocation(blocks, row.locator);
  if (resolution.status === 'stale') {
    return { status: 'stale', ...base };
  }
  const hashChanged = documentHashFromBlocks(blocks) !== row.documentHash;
  return {
    status: 'resolved',
    evidenceId: row.id,
    documentId: document.id,
    blockIndex: resolution.blockIndex,
    pageIndex: resolution.pageIndex,
    hashChanged,
    quote: row.quote,
  };
}
