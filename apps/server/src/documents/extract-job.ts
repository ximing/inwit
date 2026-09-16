import { documentIdFromJobPayload } from '@inwit/dto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, type DocumentRow, type JobRow } from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { enqueueJob } from '../jobs/queue.js';
import { initialOcrProgress, toOcrJobPayload } from '../ocr/ocr-logic.js';
import { tryIndexDocument } from '../retrieval/pipeline.js';
import { getObjectToFile } from '../storage/client.js';
import { logger } from '../utils/logger.js';
import { isBlankDocumentContent } from './document-logic.js';
import { extractImported } from './extract.js';
import { followUpAfterExtract } from './extract-logic.js';
import {
  detectImportFormat,
  formatFromSourceKey,
  titleFromFilename,
  type ImportFormat,
} from './import-logic.js';

async function loadDocument(userId: string, documentId: string): Promise<DocumentRow | null> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function markDocumentFailed(userId: string, documentId: string): Promise<void> {
  await getDb()
    .update(documents)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
}

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

  const document = await loadDocument(job.userId, documentId);
  if (!document) {
    logger.warn('extract.document_missing', { jobId: job.id, documentId });
    return;
  }
  if (!document.fileKey) throw new Error('extract job missing fileKey');

  const format = formatForDocument(document);
  const dir = await mkdtemp(path.join(tmpdir(), 'inwit-extract-'));
  const dest = path.join(dir, `source.${format}`);

  try {
    await getObjectToFile(document.fileKey, dest);
    await heartbeatJob(job.id);
    const buffer = await readFile(dest);
    const { contentMd, pageCount } = await extractImported(buffer, format);
    const followUp = followUpAfterExtract(contentMd, format);
    const title =
      document.title && document.title.trim().length > 0
        ? document.title
        : titleFromFilename(`source.${format}`);

    await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(documents)
        .set({
          contentMd,
          pageCount,
          title,
          status: followUp === 'none' ? 'digested' : 'pending',
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, documentId), eq(documents.userId, job.userId)))
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

    if (!isBlankDocumentContent(contentMd)) {
      await tryIndexDocument({
        id: document.id,
        userId: document.userId,
        title,
        description: document.description,
        contentMd,
      });
    }
  } catch (err) {
    await markDocumentFailed(job.userId, documentId);
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
