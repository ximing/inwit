import type {
  Annotation,
  AnnotationImageResponse,
  CreateAnnotationInput,
  UpdateAnnotationInput,
} from '@inwit/dto';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { annotations, type AnnotationRow } from '../db/schema.js';
import { isExcerptKeyFor } from '../documents/excerpt-logic.js';
import { getOwnedDocument } from '../documents/document.service.js';
import { AppError } from '../errors.js';
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
    geometry: row.geometry ?? null,
    imageKey: row.imageKey ?? null,
    positionMs: row.positionMs ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getOwnedAnnotation(userId: string, id: string): Promise<AnnotationRow> {
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
    .where(and(eq(annotations.userId, userId), eq(annotations.documentId, documentId)))
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
      geometry: input.geometry ?? null,
      imageKey: input.imageKey ?? null,
      positionMs: input.positionMs ?? null,
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
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
  return toPublicAnnotation(row);
}

export async function deleteAnnotation(userId: string, id: string): Promise<void> {
  await getOwnedAnnotation(userId, id);
  await getDb()
    .delete(annotations)
    .where(and(eq(annotations.id, id), eq(annotations.userId, userId)));
}
