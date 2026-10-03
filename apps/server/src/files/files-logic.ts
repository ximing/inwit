import {
  docDisplayTitle,
  STORAGE_FILE_KINDS,
  STORAGE_FILE_PREFIX_CAP,
  type StorageFile,
  type StorageFileKind,
  type StorageFilePreview,
  type StorageFileRef,
  type StorageFilesQuery,
  type StorageFilesSummary,
} from '@inwit/dto';
import { isAssetSrc } from '../assets/asset-logic.js';
import { AppError } from '../errors.js';

export { STORAGE_FILE_PREFIX_CAP };

const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_TITLE_MAX = 80;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov']);

export type StorageObjectMeta = {
  key: string;
  sizeBytes: number;
  modifiedAt: string | null;
};

export type FileDocumentRow = {
  id: string;
  title: string | null;
  description: string | null;
  fileKey: string | null;
  deletedAt: Date | string | null;
  contentJson: unknown;
};

export type FileCardRow = {
  id: string;
  concept: string;
  imageKey: string | null;
  documentId: string | null;
  deletedAt: Date | string | null;
};

export type FileAnnotationRow = {
  id: string;
  quote: string;
  note: string;
  imageKey: string | null;
  documentId: string;
  deletedAt: Date | string | null;
};

export type FileCanvasRow = {
  id: string;
  imageKey: string | null;
  documentId: string;
};

export type FileRefRows = {
  documents: readonly FileDocumentRow[];
  cards: readonly FileCardRow[];
  annotations: readonly FileAnnotationRow[];
  canvas: readonly FileCanvasRow[];
  avatarKey: string | null;
};

export function storagePrefixesFor(userId: string): [string, string, string] {
  if (!USER_ID_RE.test(userId)) throw AppError.of(400, 'VALIDATION_ERROR');
  return [`docs/${userId}/`, `users/${userId}/doc-assets/`, `avatars/${userId}/`];
}

export function isOwnedStorageKey(userId: string, key: string): boolean {
  if (!USER_ID_RE.test(userId)) return false;
  if (key.length === 0 || key.endsWith('/') || key.includes('..') || key.includes('\\')) return false;
  const [docsPrefix, mediaPrefix, avatarPrefix] = storagePrefixesFor(userId);
  return key.startsWith(docsPrefix) || key.startsWith(mediaPrefix) || key.startsWith(avatarPrefix);
}

export function kindOfOwnedKey(userId: string, key: string): StorageFileKind | null {
  if (!isOwnedStorageKey(userId, key)) return null;
  const [, mediaPrefix, avatarPrefix] = storagePrefixesFor(userId);
  if (key.startsWith(avatarPrefix)) return 'avatar';
  if (key.startsWith(mediaPrefix)) return 'media';
  if (key.includes('/excerpts/')) return 'excerpt';
  return 'source';
}

export function extOfKey(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function previewOfExt(ext: string): StorageFilePreview | null {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

export function emptyStorageFilesSummary(): StorageFilesSummary {
  const byKind = {
    source: { count: 0, bytes: 0 },
    media: { count: 0, bytes: 0 },
    excerpt: { count: 0, bytes: 0 },
    avatar: { count: 0, bytes: 0 },
  };
  return { totalCount: 0, totalBytes: 0, byKind };
}

function clipTitle(text: string, fallback: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const source = flat.length > 0 ? flat : fallback;
  const chars = [...source];
  if (chars.length <= REF_TITLE_MAX) return chars.join('');
  return `${chars.slice(0, REF_TITLE_MAX).join('')}…`;
}

function isArchived(value: Date | string | null | undefined): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('asset:') ? trimmed.slice('asset:'.length) : trimmed;
}

export function assetKeysInContent(userId: string, content: unknown): string[] {
  const keys = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as {
      type?: unknown;
      attrs?: { src?: unknown; poster?: unknown };
      content?: unknown;
    };
    if (record.type === 'image' || record.type === 'video') {
      for (const value of [record.attrs?.src, record.attrs?.poster]) {
        if (typeof value !== 'string' || !isAssetSrc(value)) continue;
        const key = value.slice('asset:'.length);
        if (isOwnedStorageKey(userId, key)) keys.add(key);
      }
    }
    if (record.content !== undefined) visit(record.content);
  };
  visit(content);
  return [...keys];
}

function addRef(map: Map<string, StorageFileRef[]>, key: string, ref: StorageFileRef): void {
  const list = map.get(key);
  if (!list) {
    map.set(key, [ref]);
    return;
  }
  if (list.some((item) => item.type === ref.type && item.id === ref.id)) return;
  list.push(ref);
}

export function collectFileRefs(userId: string, rows: FileRefRows): Map<string, StorageFileRef[]> {
  const map = new Map<string, StorageFileRef[]>();
  const archivedDocs = new Set(
    rows.documents.filter((doc) => isArchived(doc.deletedAt)).map((doc) => doc.id),
  );

  for (const doc of rows.documents) {
    const ref: StorageFileRef = {
      type: 'document',
      id: doc.id,
      title: clipTitle(docDisplayTitle(doc), '未命名文档'),
      documentId: doc.id,
      archived: isArchived(doc.deletedAt),
    };
    if (doc.fileKey) {
      const key = normalizeKey(doc.fileKey);
      if (isOwnedStorageKey(userId, key)) addRef(map, key, ref);
    }
    for (const key of assetKeysInContent(userId, doc.contentJson)) {
      addRef(map, key, ref);
    }
  }

  for (const card of rows.cards) {
    if (!card.imageKey) continue;
    const key = normalizeKey(card.imageKey);
    if (!isOwnedStorageKey(userId, key)) continue;
    addRef(map, key, {
      type: 'card',
      id: card.id,
      title: clipTitle(card.concept, '卡片'),
      documentId: card.documentId,
      archived: isArchived(card.deletedAt),
    });
  }

  for (const note of rows.annotations) {
    if (!note.imageKey) continue;
    const key = normalizeKey(note.imageKey);
    if (!isOwnedStorageKey(userId, key)) continue;
    const titleSource = note.note.trim().length > 0 ? note.note : note.quote;
    addRef(map, key, {
      type: 'annotation',
      id: note.id,
      title: clipTitle(titleSource, '批注'),
      documentId: note.documentId,
      archived: isArchived(note.deletedAt),
    });
  }

  for (const node of rows.canvas) {
    if (!node.imageKey) continue;
    const key = normalizeKey(node.imageKey);
    if (!isOwnedStorageKey(userId, key)) continue;
    addRef(map, key, {
      type: 'canvas',
      id: node.id,
      title: '画布图片',
      documentId: node.documentId,
      archived: archivedDocs.has(node.documentId),
    });
  }

  if (rows.avatarKey && USER_ID_RE.test(userId)) {
    const key = normalizeKey(rows.avatarKey);
    if (isOwnedStorageKey(userId, key)) {
      addRef(map, key, {
        type: 'avatar',
        id: userId,
        title: '当前头像',
        documentId: null,
        archived: false,
      });
    }
  }

  return map;
}

export function assembleStorageFiles(
  userId: string,
  objects: readonly StorageObjectMeta[],
  refsByKey: ReadonlyMap<string, readonly StorageFileRef[]>,
): StorageFile[] {
  const seen = new Set<string>();
  const files: StorageFile[] = [];
  for (const object of objects) {
    if (seen.has(object.key)) continue;
    const kind = kindOfOwnedKey(userId, object.key);
    if (!kind) continue;
    seen.add(object.key);
    const refs = [...(refsByKey.get(object.key) ?? [])];
    const ext = extOfKey(object.key);
    const sizeBytes = Number.isFinite(object.sizeBytes) ? Math.max(0, Math.floor(object.sizeBytes)) : 0;
    files.push({
      key: object.key,
      kind,
      sizeBytes,
      modifiedAt: object.modifiedAt,
      ext,
      preview: previewOfExt(ext),
      unused: refs.length === 0,
      refs,
    });
  }
  return files;
}

export function summarizeStorageFiles(files: readonly StorageFile[]): StorageFilesSummary {
  const summary = emptyStorageFilesSummary();
  for (const file of files) {
    if (!STORAGE_FILE_KINDS.includes(file.kind)) continue;
    summary.totalCount += 1;
    summary.totalBytes += file.sizeBytes;
    const bucket = summary.byKind[file.kind];
    bucket.count += 1;
    bucket.bytes += file.sizeBytes;
  }
  return summary;
}

function modifiedTime(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function compareFiles(sort: StorageFilesQuery['sort'], a: StorageFile, b: StorageFile): number {
  if (sort === 'size') {
    if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes;
  } else {
    const delta = modifiedTime(b.modifiedAt) - modifiedTime(a.modifiedAt);
    if (delta !== 0) return delta;
  }
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

export function selectStorageFiles(
  files: readonly StorageFile[],
  query: StorageFilesQuery,
): { items: StorageFile[]; total: number } {
  const filtered = files.filter((file) => {
    if (query.kind !== 'all' && file.kind !== query.kind) return false;
    if (query.unused === '1' && !file.unused) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => compareFiles(query.sort, a, b));
  return {
    total: sorted.length,
    items: sorted.slice(query.offset, query.offset + query.limit),
  };
}
