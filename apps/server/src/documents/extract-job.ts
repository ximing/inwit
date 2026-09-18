import { documentIdFromJobPayload, type ImportFormat } from '@inwit/dto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { finishExecution, startExecution } from '../agent/executions.js';
import { getDb } from '../db/index.js';
import { documents, type DocumentRow, type JobRow } from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { enqueueJob } from '../jobs/queue.js';
import { initialOcrProgress, toOcrJobPayload } from '../ocr/ocr-logic.js';
import { tryIndexDocument } from '../retrieval/pipeline.js';
import { getObjectToFile } from '../storage/client.js';
import { logger } from '../utils/logger.js';
import { markdownToContentJson } from './content-json.js';
import { findOwnedDocument } from './document.service.js';
import { isBlankDocumentContent } from './document-logic.js';
import { extractImported } from './extract.js';
import { followUpAfterExtract } from './extract-logic.js';
import { detectImportFormat, formatFromSourceKey, titleFromFilename } from './import-logic.js';

function formatForDocument(doc: DocumentRow): ImportFormat {
  if (doc.fileKey) {
    const fromKey = formatFromSourceKey(doc.fileKey);
    if (fromKey) return fromKey;
  }
  if (doc.fileMime) {
    try {
      return detectImportFormat('', doc.fileMime);
    } catch {
      /* fall through */
    }
  }
  throw new Error('extract job cannot detect import format');
}

export async function processExtract(job: JobRow): Promise<void> {
  const documentId = documentIdFromJobPayload(job.payload);
  if (!documentId) throw new Error('extract job missing documentId');

  const document = await findOwnedDocument(job.userId, documentId);
  if (!document) {
    logger.warn('extract.document_missing', { jobId: job.id, documentId });
    return;
  }
  if (!document.fileKey) throw new Error('extract job missing fileKey');

  const format = formatForDocument(document);
  const dir = await mkdtemp(path.join(tmpdir(), 'inwit-extract-'));
  const dest = path.join(dir, `source.${format}`);
  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'extract',
  });

  try {
    await getObjectToFile(document.fileKey, dest);
    await heartbeatJob(job.id);
    const buffer = await readFile(dest);
    const { markdown, pageCount } = await extractImported(buffer, format);
    const contentJson = markdownToContentJson(markdown);
    const followUp = followUpAfterExtract(contentJson, format);
    const title =
      document.title && document.title.trim().length > 0
        ? document.title
        : titleFromFilename(`source.${format}`);

    await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(documents)
        .set({
          contentJson,
          pageCount,
          title,
          status: followUp === 'none' ? 'digested' : 'pending',
          failReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, documentId), eq(documents.userId, job.userId), isNull(documents.deletedAt)))
        .returning();
      if (!updated) throw new Error('extract job document disappeared');
      if (followUp === 'digest') {
        await enqueueJob(tx, {
          userId: job.userId,
          type: 'digest',
          payload: { documentId },
        });
      } else if (followUp === 'ocr') {
        await enqueueJob(tx, {
          userId: job.userId,
          type: 'ocr',
          payload: toOcrJobPayload(initialOcrProgress(documentId, pageCount ?? 0)),
        });
      }
    });

    if (!isBlankDocumentContent(contentJson)) {
      await tryIndexDocument({
        id: document.id,
        userId: document.userId,
        topicId: document.topicId,
        title,
        description: document.description,
        contentJson,
      });
    }
    await finishExecution({
      executionId,
      status: 'done',
      resultSummary: `format=${format} pages=${String(pageCount ?? 0)} follow_up=${followUp}`,
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
