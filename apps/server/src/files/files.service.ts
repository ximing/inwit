import type { StorageFileView, StorageFilesQuery, StorageFilesResponse } from '@inwit/dto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { annotations, canvasNodes, cards, documents, users } from '../db/schema.js';
import { isStorageConfigured, listPrefix, presignGet } from '../storage/client.js';
import {
  assembleStorageFiles,
  collectFileRefs,
  emptyStorageFilesSummary,
  selectStorageFiles,
  STORAGE_FILE_PREFIX_CAP,
  storagePrefixesFor,
  summarizeStorageFiles,
  type StorageObjectMeta,
} from './files-logic.js';

function toIso(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

async function listOwnedObjects(
  userId: string,
): Promise<{ objects: StorageObjectMeta[]; truncated: boolean }> {
  const listed = await Promise.all(
    storagePrefixesFor(userId).map((prefix) => listPrefix(prefix, STORAGE_FILE_PREFIX_CAP)),
  );
  const objects: StorageObjectMeta[] = [];
  let truncated = false;
  for (const page of listed) {
    if (page.truncated) truncated = true;
    for (const item of page.items) {
      objects.push({
        key: item.key,
        sizeBytes: item.sizeBytes,
        modifiedAt: toIso(item.modifiedAt),
      });
    }
  }
  return { objects, truncated };
}

async function loadRefRows(userId: string) {
  const db = getDb();
  const [documentRows, cardRows, annotationRows, canvasRows, userRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        description: documents.description,
        fileKey: documents.fileKey,
        deletedAt: documents.deletedAt,
        contentJson: documents.contentJson,
      })
      .from(documents)
      .where(eq(documents.userId, userId)),
    db
      .select({
        id: cards.id,
        concept: cards.concept,
        imageKey: cards.imageKey,
        documentId: cards.documentId,
        deletedAt: cards.deletedAt,
      })
      .from(cards)
      .where(and(eq(cards.userId, userId), isNotNull(cards.imageKey))),
    db
      .select({
        id: annotations.id,
        quote: annotations.quote,
        note: annotations.note,
        imageKey: annotations.imageKey,
        documentId: annotations.documentId,
        deletedAt: annotations.deletedAt,
      })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), isNotNull(annotations.imageKey))),
    db
      .select({
        id: canvasNodes.id,
        imageKey: canvasNodes.imageKey,
        documentId: canvasNodes.documentId,
      })
      .from(canvasNodes)
      .where(
        and(eq(canvasNodes.userId, userId), eq(canvasNodes.kind, 'image'), isNotNull(canvasNodes.imageKey)),
      ),
    db.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, userId)).limit(1),
  ]);
  return collectFileRefs(userId, {
    documents: documentRows,
    cards: cardRows,
    annotations: annotationRows,
    canvas: canvasRows,
    avatarKey: userRows[0]?.avatarKey ?? null,
  });
}

async function withPreviewUrls(items: readonly StorageFileView[]): Promise<StorageFileView[]> {
  return Promise.all(
    items.map(async (item) => {
      if (!item.preview) return item;
      try {
        return { ...item, previewUrl: await presignGet(item.key) };
      } catch {
        return { ...item, previewUrl: null };
      }
    }),
  );
}

export async function listStorageFiles(
  userId: string,
  query: StorageFilesQuery,
): Promise<StorageFilesResponse> {
  if (!isStorageConfigured()) {
    return {
      configured: false,
      truncated: false,
      summary: emptyStorageFilesSummary(),
      items: [],
      total: 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  const [listed, refs] = await Promise.all([listOwnedObjects(userId), loadRefRows(userId)]);
  const files = assembleStorageFiles(userId, listed.objects, refs);
  const page = selectStorageFiles(files, query);
  const items = await withPreviewUrls(page.items.map((item) => ({ ...item, previewUrl: null })));
  return {
    configured: true,
    truncated: listed.truncated,
    summary: summarizeStorageFiles(files),
    items,
    total: page.total,
    limit: query.limit,
    offset: query.offset,
  };
}
