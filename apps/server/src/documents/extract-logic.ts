import { type ImportFormat } from '@inwit/dto';
import { isBlankDocumentContent } from './document-logic.js';
import { isPdfMime } from './import-logic.js';
import { isOcrImageMime } from './screenshot-logic.js';

export type ExtractFollowUp = 'digest' | 'ocr' | 'none';
export type RetryJobKind = 'extract' | 'ocr' | 'digest';

/**
 * Use the book title only while the stored title is still the filename stem
 * captured when the upload finished. A rename after that wins.
 */
export function resolveExtractedTitle(input: {
  current: string;
  filenameStem: string | null;
  suggested: string | null;
  fallback: string;
}): string {
  const current = input.current.replace(/\s+/g, ' ').trim();
  const suggested = input.suggested?.replace(/\s+/g, ' ').trim() ?? '';
  const stem = input.filenameStem?.replace(/\s+/g, ' ').trim() ?? '';
  if (suggested.length > 0 && (current.length === 0 || (stem.length > 0 && current === stem))) {
    return suggested;
  }
  if (current.length > 0) return current;
  const fallback = input.fallback.trim();
  return fallback.length > 0 ? fallback : '未命名文档';
}

export function followUpAfterExtract(contentJson: unknown, format: ImportFormat): ExtractFollowUp {
  if (!isBlankDocumentContent(contentJson)) return 'digest';
  if (format === 'pdf') return 'ocr';
  return 'none';
}

/**
 * Choose which pipeline job to re-enqueue.
 * `pageCount !== null` means extract already ran (including scanned PDFs with 0 text pages).
 */
export function retryJobKindForDocument(doc: {
  status: 'pending' | 'digested' | 'failed';
  contentJson: unknown;
  fileKey: string | null;
  fileMime: string | null;
  pageCount: number | null;
}): RetryJobKind | null {
  if (doc.status === 'digested') return null;
  const blank = isBlankDocumentContent(doc.contentJson);
  const hasFile = typeof doc.fileKey === 'string' && doc.fileKey.length > 0;
  if (hasFile && blank) {
    if (isOcrImageMime(doc.fileMime)) return 'ocr';
    if (isPdfMime(doc.fileMime) && doc.pageCount !== null) return 'ocr';
    return 'extract';
  }
  if (!blank) return 'digest';
  return null;
}
