import type { StorageFileKind, StorageFileRef, StorageFileView } from '@inwit/dto';
import { docAnnotationPath, docAnchorPath, docsPath } from '@/routes';

export const FILE_KIND_LABEL: Record<StorageFileKind, string> = {
  source: '原文',
  media: '正文媒体',
  excerpt: '摘录',
  avatar: '头像',
};

export const FILE_REF_LABEL: Record<StorageFileRef['type'], string> = {
  document: '文档',
  card: '卡片',
  annotation: '批注',
  canvas: '画布',
  avatar: '头像',
};

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function filePrimaryLabel(file: StorageFileView): string {
  if (file.kind === 'avatar' && !file.unused) return '当前头像';
  const doc =
    file.refs.find((ref) => ref.type === 'document' && !ref.archived) ??
    file.refs.find((ref) => ref.type === 'document');
  if (doc) return doc.title;
  const live = file.refs.find((ref) => !ref.archived) ?? file.refs[0];
  if (live) return live.title;
  const ext = file.ext ? ` · ${file.ext.toUpperCase()}` : '';
  return `未使用的${FILE_KIND_LABEL[file.kind]}${ext}`;
}

/** Every remaining reference sits in 回收站. Unused files are not archived. */
export function fileIsArchived(file: StorageFileView): boolean {
  return file.refs.length > 0 && file.refs.every((ref) => ref.archived);
}

export function fileRefHref(ref: StorageFileRef): string | null {
  if (ref.archived || ref.type === 'avatar') return null;
  if (ref.type === 'document') return docsPath(ref.id);
  if (!ref.documentId) return null;
  if (ref.type === 'card') return docAnchorPath(ref.documentId, ref.id);
  if (ref.type === 'annotation') return docAnnotationPath(ref.documentId, ref.id);
  return docsPath(ref.documentId);
}
