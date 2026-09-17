import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { finishExecution, startExecution } from '../agent/executions.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { documents, jobs, ocrPages, type DocumentRow, type JobRow } from '../db/schema.js';
import { markdownToContentJson } from '../documents/content-json.js';
import { findOwnedDocument } from '../documents/document.service.js';
import { isBlankDocumentContent } from '../documents/document-logic.js';
import { isOcrImageMime } from '../documents/screenshot-logic.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { enqueueJob } from '../jobs/queue.js';
import { logLlmUsage } from '../llm/usage.js';
import { tryIndexDocument } from '../retrieval/pipeline.js';
import { getObjectToFile } from '../storage/client.js';
import { logger } from '../utils/logger.js';
import { completeOcrPage } from './ocr-api.js';
import {
  applyPageFailure,
  applyPageSuccess,
  chunkPages,
  mergeOcrResume,
  OCR_PAGE_CONCURRENCY,
  ocrIncompleteError,
  pagesToMarkdown,
  parseOcrProgress,
  pendingPages,
  pngToDataUrl,
  toOcrJobPayload,
  withTotalPages,
  type CompletedOcrPage,
  type OcrProgress,
} from './ocr-logic.js';
import { rasterImageFileToPng } from './ocr-image.js';
import { resolveOcrFor } from './ocr.service.js';
import { openPdf } from './rasterize.js';

async function loadCompletedPages(documentId: string): Promise<CompletedOcrPage[]> {
  return getDb()
    .select({
      pageIndex: ocrPages.pageIndex,
      pageText: ocrPages.pageText,
    })
    .from(ocrPages)
    .where(eq(ocrPages.documentId, documentId))
    .orderBy(desc(ocrPages.createdAt));
}

type PageOutcome =
  | { pageIndex: number; ok: true; text: string; promptTokens: number; completionTokens: number; totalTokens: number }
  | { pageIndex: number; ok: false };

async function persistOcrCheckpoint(jobId: string, progress: OcrProgress): Promise<void> {
  await getDb()
    .update(jobs)
    .set({
      payload: toOcrJobPayload(progress),
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
}

async function persistOcrOutcome(
  jobId: string,
  documentId: string,
  progress: OcrProgress,
  outcome: PageOutcome,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (outcome.ok) {
      await tx
        .insert(ocrPages)
        .values({
          jobId,
          documentId,
          pageIndex: outcome.pageIndex,
          pageText: outcome.text,
        })
        .onConflictDoUpdate({
          target: [ocrPages.jobId, ocrPages.pageIndex],
          set: { pageText: outcome.text },
        });
    }
    await tx
      .update(jobs)
      .set({
        payload: toOcrJobPayload(progress),
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
  });
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const current = next;
      next += 1;
      const item = items[current];
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function processOcr(job: JobRow): Promise<void> {
  const parsed = parseOcrProgress(job.payload);
  if (!parsed) throw new Error('ocr job missing documentId');
  const documentId = parsed.documentId;

  const document = await findOwnedDocument(job.userId, documentId);
  if (!document) {
    logger.warn('ocr.document_missing', { jobId: job.id, documentId });
    return;
  }
  if (!document.fileKey) throw new Error('ocr job missing fileKey');

  const dir = await mkdtemp(path.join(tmpdir(), 'inwit-ocr-'));
  const image = isOcrImageMime(document.fileMime);
  const dest = path.join(dir, image ? 'source.bin' : 'source.pdf');
  const completed = await loadCompletedPages(documentId);
  let progress = mergeOcrResume(job.payload, completed) ?? parsed;
  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'ocr',
  });

  try {
    await getObjectToFile(document.fileKey, dest);
    await heartbeatJob(job.id);

    if (image) {
      progress = withTotalPages(progress, 1);
      await persistOcrCheckpoint(job.id, progress);
      const resolved = await resolveOcrFor(job.userId);
      const remaining = pendingPages(progress);
      if (remaining.includes(0)) {
        let outcome: PageOutcome;
        try {
          const png = await rasterImageFileToPng(dest);
          const result = await completeOcrPage({
            apiKey: resolved.apiKey,
            model: resolved.model,
            baseUrl: resolved.baseUrl,
            imageDataUrl: pngToDataUrl(png),
          });
          outcome = {
            pageIndex: 0,
            ok: true,
            text: result.text,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            totalTokens: result.totalTokens,
          };
        } catch (err) {
          logger.warn('ocr.page_failed', {
            jobId: job.id,
            documentId,
            pageIndex: 0,
            err: err instanceof Error ? err.message : String(err),
          });
          outcome = { pageIndex: 0, ok: false };
        }
        progress = outcome.ok
          ? applyPageSuccess(progress, outcome.pageIndex, outcome.text)
          : applyPageFailure(progress, outcome.pageIndex);
        await persistOcrOutcome(job.id, documentId, progress, outcome);
        if (outcome.ok) {
          await logLlmUsage({
            userId: job.userId,
            executionId,
            provider: 'dashscope',
            model: resolved.model,
            capability: 'ocr',
            promptTokens: outcome.promptTokens,
            completionTokens: outcome.completionTokens,
            totalTokens: outcome.totalTokens,
          });
        }
      }
    } else {
    const pdf = await openPdf(dest);
    try {
      progress = withTotalPages(progress, pdf.pageCount);
      await persistOcrCheckpoint(job.id, progress);

      const resolved = await resolveOcrFor(job.userId);
      const remaining = pendingPages(progress);
      const batches = chunkPages(remaining, config.OCR_PAGE_BATCH_SIZE);

      for (const batch of batches) {
        await heartbeatJob(job.id);
        let persistChain = Promise.resolve();
        const persistOutcome = (outcome: PageOutcome): Promise<void> => {
          persistChain = persistChain.then(async () => {
            progress = outcome.ok
              ? applyPageSuccess(progress, outcome.pageIndex, outcome.text)
              : applyPageFailure(progress, outcome.pageIndex);
            await persistOcrOutcome(job.id, documentId, progress, outcome);
            if (outcome.ok) {
              await logLlmUsage({
                userId: job.userId,
                executionId,
                provider: 'dashscope',
                model: resolved.model,
                capability: 'ocr',
                promptTokens: outcome.promptTokens,
                completionTokens: outcome.completionTokens,
                totalTokens: outcome.totalTokens,
              });
            }
          });
          return persistChain;
        };

        await mapPool(batch, OCR_PAGE_CONCURRENCY, async (pageIndex) => {
          let outcome: PageOutcome;
          try {
            const png = await pdf.renderPng(pageIndex);
            const result = await completeOcrPage({
              apiKey: resolved.apiKey,
              model: resolved.model,
              baseUrl: resolved.baseUrl,
              imageDataUrl: pngToDataUrl(png),
            });
            outcome = {
              pageIndex,
              ok: true,
              text: result.text,
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
              totalTokens: result.totalTokens,
            };
          } catch (err) {
            logger.warn('ocr.page_failed', {
              jobId: job.id,
              documentId,
              pageIndex,
              err: err instanceof Error ? err.message : String(err),
            });
            outcome = { pageIndex, ok: false };
          }
          await persistOutcome(outcome);
        });
        await persistChain;
      }
    } finally {
      await pdf.destroy();
    }
    }

    if (progress.failedPages.length > 0) {
      throw new Error(ocrIncompleteError(progress.failedPages));
    }

    const contentJson = markdownToContentJson(pagesToMarkdown(progress.pageTexts));
    const blank = isBlankDocumentContent(contentJson);

    await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(documents)
        .set({
          contentJson,
          pageCount: progress.totalPages,
          status: blank ? 'digested' : 'pending',
          failReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, documentId), eq(documents.userId, job.userId)))
        .returning();
      if (!updated) throw new Error('ocr job document disappeared');
      if (!blank) {
        await enqueueJob(tx, {
          userId: job.userId,
          type: 'digest',
          payload: { documentId },
        });
      }
    });

    if (!blank) {
      await tryIndexDocument({
        id: document.id,
        userId: document.userId,
        topicId: document.topicId,
        title: document.title,
        description: document.description,
        contentJson,
      });
    }
    await finishExecution({
      executionId,
      status: 'done',
      resultSummary: `pages=${String(progress.totalPages)} blank=${blank ? 1 : 0}`,
    });
  } catch (err) {
    // The queue decides retry vs. final failure and marks the document only
    // once the job is done failing — transient errors leave it pending.
    await finishExecution({
      executionId,
      status: 'failed',
      error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
    });
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
