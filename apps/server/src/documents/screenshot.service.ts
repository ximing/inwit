import { randomUUID } from 'node:crypto';
import type { Document, ScreenshotInitInput, ScreenshotInitResponse } from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents } from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueJob } from '../jobs/queue.js';
import { isStorageConfigured, presignPut } from '../storage/client.js';
import { EMPTY_PM_DOC } from './content-json.js';
import { assertWritableTopic, getOwnedDocument, toPublicDocument } from './document.service.js';
import {
  defaultScreenshotTitle,
  isScreenshotSourceKey,
  screenshotSourceKey,
  validateScreenshotUpload,
} from './screenshot-logic.js';

export async function initScreenshot(
  userId: string,
  input: ScreenshotInitInput,
): Promise<ScreenshotInitResponse> {
  if (!isStorageConfigured()) throw AppError.of(503, 'STORAGE_NOT_CONFIGURED');
  await assertWritableTopic(userId, input.topicId);
  const { mime, ext } = validateScreenshotUpload(input.contentType, input.sizeBytes);
  const documentId = randomUUID();
  const key = screenshotSourceKey(userId, documentId, ext);
  const title = input.title?.trim() || defaultScreenshotTitle();

  const [row] = await getDb()
    .insert(documents)
    .values({
      id: documentId,
      userId,
      topicId: input.topicId ?? null,
      title,
      source: 'screenshot',
      status: 'pending',
      contentJson: EMPTY_PM_DOC,
      fileKey: key,
      fileMime: mime,
      fileSize: input.sizeBytes,
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');

  const uploadUrl = await presignPut(key, mime);
  return { document: toPublicDocument(row), uploadUrl, key };
}

export async function completeScreenshot(userId: string, documentId: string): Promise<Document> {
  const doc = await getOwnedDocument(userId, documentId);
  if (doc.source !== 'screenshot' || !doc.fileKey) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  if (!isScreenshotSourceKey(doc.fileKey, userId, documentId)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  const updated = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(documents)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .returning();
    if (!row) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
    await enqueueJob(tx, {
      userId,
      type: 'ocr',
      payload: { documentId },
    });
    return row;
  });
  return toPublicDocument(updated);
}
