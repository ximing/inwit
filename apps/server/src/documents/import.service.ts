import { randomUUID } from 'node:crypto';
import type {
  Document,
  ImportAbortInput,
  ImportCompleteInput,
  ImportInitInput,
  ImportInitResponse,
  ImportPartsInput,
  ImportPartsResponse,
} from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { documents } from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueJob } from '../jobs/queue.js';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  isStorageConfigured,
  presignUploadPart,
} from '../storage/client.js';
import { logger } from '../utils/logger.js';
import { assertWritableTopic, deleteDocument, getOwnedDocument, toPublicDocument } from './document.service.js';
import { importSourceKey, isImportSourceKey, titleFromFilename, validateImportFile } from './import-logic.js';
import { MULTIPART_PART_URL_TTL_SEC, validateCompleteParts, validatePartNumbers } from './multipart-logic.js';

async function getOwnedImport(userId: string, id: string) {
  const doc = await getOwnedDocument(userId, id);
  if (doc.source !== 'import' || !doc.fileKey) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  if (!isImportSourceKey(doc.fileKey, userId, id)) throw AppError.of(400, 'VALIDATION_ERROR');
  return doc;
}

export async function initImport(userId: string, input: ImportInitInput): Promise<ImportInitResponse> {
  if (!isStorageConfigured()) throw AppError.of(503, 'STORAGE_NOT_CONFIGURED');
  await assertWritableTopic(userId, input.topicId);
  const { format, mime } = validateImportFile(
    input.filename,
    input.mime,
    input.size,
    config.IMPORT_MAX_FILE_BYTES,
  );
  const documentId = randomUUID();
  const key = importSourceKey(userId, documentId, format);

  const [row] = await getDb()
    .insert(documents)
    .values({
      id: documentId,
      userId,
      topicId: input.topicId ?? null,
      title: titleFromFilename(input.filename),
      contentMd: '',
      source: 'import',
      status: 'pending',
      fileKey: key,
      fileMime: mime,
      fileSize: input.size,
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');

  try {
    const uploadId = await createMultipartUpload(key, mime);
    return { documentId, uploadId, key };
  } catch (err) {
    await getDb()
      .delete(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
    throw err;
  }
}

export async function presignImportParts(
  userId: string,
  documentId: string,
  input: ImportPartsInput,
): Promise<ImportPartsResponse> {
  const doc = await getOwnedImport(userId, documentId);
  const partNumbers = validatePartNumbers(input.partNumbers);
  const parts = await Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await presignUploadPart(doc.fileKey!, input.uploadId, partNumber, MULTIPART_PART_URL_TTL_SEC),
    })),
  );
  return { parts };
}

export async function completeImport(
  userId: string,
  documentId: string,
  input: ImportCompleteInput,
): Promise<Document> {
  const doc = await getOwnedImport(userId, documentId);
  const parts = validateCompleteParts(input.parts);
  try {
    await completeMultipartUpload(doc.fileKey!, input.uploadId, parts);
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn('import.complete_multipart_failed', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  const updated = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(documents)
      .set({
        fileSize: doc.fileSize,
        fileMime: doc.fileMime,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .returning();
    if (!row) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
    await enqueueJob(tx, {
      userId,
      type: 'extract',
      payload: { documentId },
    });
    return row;
  });
  return toPublicDocument(updated);
}

export async function abortImport(
  userId: string,
  documentId: string,
  input: ImportAbortInput,
): Promise<void> {
  const doc = await getOwnedImport(userId, documentId);
  try {
    await abortMultipartUpload(doc.fileKey!, input.uploadId);
  } catch (err) {
    logger.warn('import.abort_multipart_failed', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await deleteDocument(userId, documentId);
}
