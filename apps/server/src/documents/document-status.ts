import { and, eq, isNull, ne } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents } from '../db/schema.js';
import { clampFailReason } from './document-status-logic.js';

export { pipelineDocumentId } from './document-status-logic.js';

/**
 * Marks the document failed with an inspectable reason. No-op when the
 * document is already digested, so a late failure from a stale job can't
 * flip a successfully processed document back.
 */
export async function markDocumentFailed(
  userId: string,
  documentId: string,
  reason: string,
  extra?: { answer?: string | null },
): Promise<void> {
  await getDb()
    .update(documents)
    .set({
      status: 'failed',
      failReason: clampFailReason(reason),
      updatedAt: new Date(),
      ...(extra && 'answer' in extra ? { answer: extra.answer ?? null } : {}),
    })
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.userId, userId),
        ne(documents.status, 'digested'),
        isNull(documents.deletedAt),
      ),
    );
}

/** Puts a failed document back into the pipeline (used when its job is retried). */
export async function resetDocumentPipeline(userId: string, documentId: string): Promise<void> {
  await getDb()
    .update(documents)
    .set({ status: 'pending', failReason: null, updatedAt: new Date() })
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.userId, userId),
        eq(documents.status, 'failed'),
        isNull(documents.deletedAt),
      ),
    );
}
