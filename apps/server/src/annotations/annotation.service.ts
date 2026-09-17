import type {
  Annotation,
  AnnotationImageResponse,
  ArchivedAnnotationsResponse,
  ArchiveListQuery,
  CreateAnnotationInput,
  UpdateAnnotationInput,
} from '@inwit/dto';
import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { annotations, documents, type AnnotationRow } from '../db/schema.js';
import { isExcerptKeyFor } from '../documents/excerpt-logic.js';
import { getOwnedDocument } from '../documents/document.service.js';
import { AppError } from '../errors.js';
import { tryDeleteAnnotationFromIndex, tryIndexAnnotation } from '../retrieval/pipeline.js';
import { presignGet } from '../storage/client.js';

export function toPublicAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    userId: row.userId,
    documentId: row.documentId,
    quote: row.quote,
    note: row.note,
    kind: row.kind,
    pageIndex: row.pageIndex ?? null,
    anchorBlockIndex: row.anchorBlockIndex ?? null,
    geometry: row.geometry ?? null,
    imageKey: row.imageKey ?? null,
    positionMs: row.positionMs ?? null,
    hasConvertedCard: row.convertedCardId != null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

async function getOwnedAnnotation(userId: string, id: string): Promise<AnnotationRow> {
  const [row] = await getDb()
    .select()
    .from(annotations)
    .where(and(eq(annotations.id, id), eq(annotations.userId, userId), isNull(annotations.deletedAt)))
    .limit(1);
  if (!row) throw AppError.of(404, 'ANNOTATION_NOT_FOUND');
  return row;
}

/** Ownership check that also sees archived annotations (回收站 restore/destroy paths). */
async function getOwnedAnnotationAny(userId: string, id: string): Promise<AnnotationRow> {
  const [row] = await getDb()
    .select()
    .from(annotations)
    .where(and(eq(annotations.id, id), eq(annotations.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'ANNOTATION_NOT_FOUND');
  return row;
}

export async function listDocumentAnnotations(
  userId: string,
  documentId: string,
): Promise<Annotation[]> {
  await getOwnedDocument(userId, documentId);
  const rows = await getDb()
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.userId, userId),
        eq(annotations.documentId, documentId),
        isNull(annotations.deletedAt),
      ),
    )
    .orderBy(asc(annotations.createdAt), asc(annotations.id));
  return rows.map(toPublicAnnotation);
}

export async function createAnnotation(
  userId: string,
  input: CreateAnnotationInput,
): Promise<Annotation> {
  await getOwnedDocument(userId, input.documentId);
  if (input.imageKey && !isExcerptKeyFor(input.imageKey, userId, input.documentId)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const [row] = await getDb()
    .insert(annotations)
    .values({
      userId,
      documentId: input.documentId,
      quote: input.quote,
      note: input.note ?? '',
      kind: input.kind ?? 'text',
      pageIndex: input.pageIndex ?? null,
      anchorBlockIndex: input.anchorBlockIndex ?? null,
      geometry: input.geometry ?? null,
      imageKey: input.imageKey ?? null,
      positionMs: input.positionMs ?? null,
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  await tryIndexAnnotation(row);
  return toPublicAnnotation(row);
}

export async function getAnnotationImage(
  userId: string,
  id: string,
): Promise<AnnotationImageResponse> {
  const row = await getOwnedAnnotation(userId, id);
  if (!row.imageKey) throw AppError.of(404, 'ANNOTATION_IMAGE_NOT_FOUND');
  if (!isExcerptKeyFor(row.imageKey, userId, row.documentId)) {
    throw AppError.of(404, 'ANNOTATION_IMAGE_NOT_FOUND');
  }
  const url = await presignGet(row.imageKey);
  return { url };
}

export async function updateAnnotation(
  userId: string,
  id: string,
  input: UpdateAnnotationInput,
): Promise<Annotation> {
  await getOwnedAnnotation(userId, id);
  const [row] = await getDb()
    .update(annotations)
    .set({
      note: input.note,
      updatedAt: new Date(),
    })
    .where(and(eq(annotations.id, id), eq(annotations.userId, userId)))
    .returning();
  if (!row) throw AppError.of(404, 'ANNOTATION_NOT_FOUND');
  await tryIndexAnnotation(row);
  return toPublicAnnotation(row);
}

/** Soft delete (idempotent): hidden everywhere, restorable from 回收站. */
export async function archiveAnnotation(userId: string, id: string): Promise<void> {
  const row = await getOwnedAnnotationAny(userId, id);
  if (row.deletedAt) return;
  const now = new Date();
  await getDb()
    .update(annotations)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(annotations.id, id), eq(annotations.userId, userId)));
  await tryDeleteAnnotationFromIndex(id);
}

export async function restoreAnnotation(userId: string, id: string): Promise<Annotation> {
  const row = await getOwnedAnnotationAny(userId, id);
  if (!row.deletedAt) return toPublicAnnotation(row);
  const now = new Date();
  const [restored] = await getDb()
    .update(annotations)
    .set({ deletedAt: null, updatedAt: now })
    .where(and(eq(annotations.id, id), eq(annotations.userId, userId)))
    .returning();
  if (!restored) throw AppError.of(404, 'ANNOTATION_NOT_FOUND');
  await tryIndexAnnotation(restored);
  return toPublicAnnotation(restored);
}

/** Permanent delete from 回收站. */
export async function destroyAnnotation(userId: string, id: string): Promise<void> {
  await getOwnedAnnotationAny(userId, id);
  await getDb()
    .delete(annotations)
    .where(and(eq(annotations.id, id), eq(annotations.userId, userId)));
  await tryDeleteAnnotationFromIndex(id);
}

export async function listArchivedAnnotations(
  userId: string,
  query: ArchiveListQuery,
): Promise<ArchivedAnnotationsResponse> {
  const offset = (query.page - 1) * query.limit;
  const where = and(eq(annotations.userId, userId), isNotNull(annotations.deletedAt));
  const [rows, [totalRow]] = await Promise.all([
    getDb()
      .select({ annotation: annotations, documentTitle: documents.title })
      .from(annotations)
      .leftJoin(documents, eq(documents.id, annotations.documentId))
      .where(where)
      .orderBy(desc(annotations.deletedAt), desc(annotations.id))
      .limit(query.limit)
      .offset(offset),
    getDb().select({ value: count() }).from(annotations).where(where),
  ]);
  return {
    items: rows.map((row) => ({
      ...toPublicAnnotation(row.annotation),
      documentTitle: row.documentTitle ?? null,
    })),
    total: totalRow?.value ?? 0,
  };
}
