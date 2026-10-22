import type {
  ConceptBatch,
  ConceptDraft,
  CreateConceptBatchInput,
  CreateConceptBatchResult,
} from '@inwit/dto';
import { conceptDraftSchema, createConceptBatchInputSchema } from '@inwit/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { conceptBatches, documents, type ConceptBatchRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueJob } from '../jobs/enqueue.js';
import { requestHashOf } from './concept-identity.js';
import { conceptOperationRequests } from '../db/schema.js';

import { requireActiveTopic, lockActiveTopic } from './concept.service.js';
import { blocksOfDocument, snapshotConceptSource } from './concept-evidence.js';
import { documentHashFromBlocks, sourceBlocksAreStale } from './concept-evidence-logic.js';

/**
 * 候选批次生命周期。生成入口由 concept_extract processor（M2/T5）执行；
 * 测试也可以通过 testkit 夹具直接构造 ready 批次。
 */

export async function getOwnedBatch(userId: string, batchId: string): Promise<ConceptBatchRow> {
  const [row] = await getDb()
    .select()
    .from(conceptBatches)
    .where(and(eq(conceptBatches.id, batchId), eq(conceptBatches.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CONCEPT_BATCH_NOT_FOUND');
  return row;
}

/**
 * ready 批次的派生过期标记：来源文档不可用（硬删/软删/越权），或正文相对生成时改动较大。
 * 小改动仍可收录。过期不修改批次状态，只拒绝提交并要求重新生成。
 */
export async function isBatchStale(row: ConceptBatchRow): Promise<boolean> {
  if (row.status !== 'ready') return false;
  if (!row.documentId) return true;
  const [document] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, row.documentId), eq(documents.userId, row.userId)))
    .limit(1);
  if (!document || document.deletedAt) return true;
  return sourceBlocksAreStale({
    scope: row.scope,
    documentHash: row.documentHash,
    selection: row.selectionSnapshot ?? null,
    snapshot: row.contentSnapshot ?? null,
    blocks: blocksOfDocument(document),
  });
}

export function toPublicBatch(row: ConceptBatchRow, stale: boolean): ConceptBatch {
  return {
    id: row.id,
    topicId: row.topicId,
    documentId: row.documentId,
    status: row.status,
    scope: row.scope,
    draftRevision: row.draftRevision,
    draft: row.draft ?? null,
    coverage: row.coverage ?? null,
    stale,
    errorCode: row.errorCode,
    resultNote: row.resultNote,
    commitResult: row.commitResult ?? null,
    committedAt: row.committedAt?.toISOString() ?? null,
    retryOfBatchId: row.retryOfBatchId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getConceptBatch(userId: string, batchId: string): Promise<ConceptBatch> {
  const row = await getOwnedBatch(userId, batchId);
  return toPublicBatch(row, await isBatchStale(row));
}

/**
 * 创建候选批次并入队 concept_extract 任务（同事务）。锁定当前已保存正文版本；
 * 与客户端自报 hash 不一致时拒绝（先保存再生成）。同 requestId 同请求返回原结果。
 */
export async function createConceptBatch(
  userId: string,
  documentId: string,
  rawInput: CreateConceptBatchInput,
): Promise<CreateConceptBatchResult> {
  const input = createConceptBatchInputSchema.parse(rawInput);
  const requestHash = requestHashOf({
    documentId,
    topicId: input.topicId,
    scope: input.scope,
    selection: input.selection ?? null,
    expectedDocumentHash: input.expectedDocumentHash ?? null,
    retryOfBatchId: input.retryOfBatchId ?? null,
  });

  return getDb().transaction(async (tx) => {
    await lockActiveTopic(tx, userId, input.topicId);

    const [existingRequest] = await tx
      .select()
      .from(conceptOperationRequests)
      .where(
        and(
          eq(conceptOperationRequests.userId, userId),
          eq(conceptOperationRequests.operation, 'concept_batch_create'),
          eq(conceptOperationRequests.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (existingRequest) {
      if (existingRequest.requestHash !== requestHash) {
        throw AppError.of(409, 'CONCEPT_REQUEST_CONFLICT');
      }
      return existingRequest.responseJson as CreateConceptBatchResult;
    }

    const [document] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .limit(1);
    if (!document || document.deletedAt) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');

    let retryOfBatchId: string | null = null;
    if (input.retryOfBatchId) {
      const [retryOf] = await tx
        .select()
        .from(conceptBatches)
        .where(and(eq(conceptBatches.id, input.retryOfBatchId), eq(conceptBatches.userId, userId)))
        .limit(1);
      if (!retryOf) throw AppError.of(404, 'CONCEPT_BATCH_NOT_FOUND');
      if (retryOf.status !== 'failed' && retryOf.status !== 'cancelled') {
        throw AppError.of(409, 'CONCEPT_BATCH_RETRY_INVALID');
      }
      retryOfBatchId = retryOf.id;
    }

    // 快照锁定已保存正文；空文/未提取/超限在此给出可识别错误。
    const snapshot = await snapshotConceptSource(
      userId,
      documentId,
      input.scope,
      input.scope === 'selection' ? input.selection : undefined,
    );
    if (input.expectedDocumentHash && input.expectedDocumentHash !== snapshot.hash) {
      throw AppError.of(409, 'CONCEPT_BATCH_STALE', { documentHash: snapshot.hash });
    }

    const [batch] = await tx
      .insert(conceptBatches)
      .values({
        userId,
        topicId: input.topicId,
        documentId,
        documentHash: snapshot.hash,
        scope: input.scope,
        selectionSnapshot: input.selection ?? null,
        contentSnapshot: {
          hash: snapshot.hash,
          totalChars: snapshot.totalChars,
          blocks: snapshot.blocks.map((block) => ({
            index: block.index,
            pageIndex: block.pageIndex,
            text: block.text,
          })),
        },
        coverage: snapshot.coverage,
        status: 'queued',
        retryOfBatchId,
      })
      .returning();
    if (!batch) throw AppError.of(500, 'INTERNAL_ERROR');

    const job = await enqueueJob(tx, {
      userId,
      type: 'concept_extract',
      payload: { batchId: batch.id, documentId, topicId: input.topicId },
    });
    await tx
      .update(conceptBatches)
      .set({ jobId: job.id })
      .where(eq(conceptBatches.id, batch.id));

    const result: CreateConceptBatchResult = { batchId: batch.id, jobId: job.id };
    await tx.insert(conceptOperationRequests).values({
      userId,
      operation: 'concept_batch_create',
      requestId: input.requestId,
      requestHash,
      responseJson: result,
    });
    return result;
  });
}

/** processor 开始执行：queued → running（允许 running 重入，崩溃恢复重跑）。 */
export async function markConceptBatchRunning(batchId: string): Promise<boolean> {
  const rows = await getDb()
    .update(conceptBatches)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(conceptBatches.id, batchId), inArray(conceptBatches.status, ['queued', 'running'])))
    .returning({ id: conceptBatches.id });
  return rows.length > 0;
}

/**
 * 写入 ready 结果。只在批次仍处于 queued/running 且草稿版本未变时生效——
 * 已取消/已提交/人工编辑过的批次不会被迟到结果覆盖。返回 false 表示跳过。
 */
export async function markConceptBatchReady(
  batchId: string,
  input: { draft: ConceptDraft; resultNote: string },
): Promise<boolean> {
  const rows = await getDb()
    .update(conceptBatches)
    .set({
      status: 'ready',
      draft: input.draft,
      resultNote: input.resultNote,
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(and(eq(conceptBatches.id, batchId), inArray(conceptBatches.status, ['queued', 'running'])))
    .returning({ id: conceptBatches.id });
  return rows.length > 0;
}

/** 终态失败回写（条件更新：已取消/已完成的不改写）。 */
export async function markConceptBatchFailed(batchId: string, errorCode: string): Promise<void> {
  await getDb()
    .update(conceptBatches)
    .set({ status: 'failed', errorCode, updatedAt: new Date() })
    .where(and(eq(conceptBatches.id, batchId), inArray(conceptBatches.status, ['queued', 'running'])));
}

/** 按 jobId 回写失败（队列终态失败/耗尽时的兜底同步）。 */
export async function failConceptBatchByJobId(jobId: string, errorCode: string): Promise<void> {
  await getDb()
    .update(conceptBatches)
    .set({ status: 'failed', errorCode, updatedAt: new Date() })
    .where(and(eq(conceptBatches.jobId, jobId), inArray(conceptBatches.status, ['queued', 'running'])));
}

/** 任务取消时同步批次状态（条件更新，不覆盖 ready/committed）。 */
export async function cancelConceptBatchByJobId(jobId: string): Promise<void> {
  await getDb()
    .update(conceptBatches)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(conceptBatches.jobId, jobId), inArray(conceptBatches.status, ['queued', 'running'])));
}

export async function updateConceptDraft(
  userId: string,
  batchId: string,
  input: { expectedDraftRevision: number; draft: unknown },
): Promise<ConceptBatch> {
  const row = await getOwnedBatch(userId, batchId);
  if (row.status !== 'ready') throw AppError.of(409, 'CONCEPT_BATCH_NOT_READY');
  if (row.draftRevision !== input.expectedDraftRevision) {
    throw AppError.of(409, 'CONCEPT_BATCH_CONFLICT');
  }
  await requireActiveTopic(userId, row.topicId);
  if (await isBatchStale(row)) throw AppError.of(409, 'CONCEPT_BATCH_STALE');
  const draft = conceptDraftSchema.parse(input.draft);
  const [updated] = await getDb()
    .update(conceptBatches)
    .set({ draft, draftRevision: row.draftRevision + 1, updatedAt: new Date() })
    .where(
      and(
        eq(conceptBatches.id, batchId),
        eq(conceptBatches.userId, userId),
        eq(conceptBatches.status, 'ready'),
        eq(conceptBatches.draftRevision, input.expectedDraftRevision),
      ),
    )
    .returning();
  if (!updated) throw AppError.of(409, 'CONCEPT_BATCH_CONFLICT');
  return toPublicBatch(updated, false);
}

/** ready → discarded；不删除正式内容，其他状态拒绝。 */
export async function discardConceptBatch(userId: string, batchId: string): Promise<ConceptBatch> {
  const row = await getOwnedBatch(userId, batchId);
  if (row.status !== 'ready') throw AppError.of(409, 'CONCEPT_BATCH_NOT_READY');
  await requireActiveTopic(userId, row.topicId);
  const [updated] = await getDb()
    .update(conceptBatches)
    .set({ status: 'discarded', updatedAt: new Date() })
    .where(
      and(
        eq(conceptBatches.id, batchId),
        eq(conceptBatches.userId, userId),
        eq(conceptBatches.status, 'ready'),
      ),
    )
    .returning();
  if (!updated) throw AppError.of(409, 'CONCEPT_BATCH_NOT_READY');
  return toPublicBatch(updated, false);
}

export { blocksOfDocument, documentHashFromBlocks };
