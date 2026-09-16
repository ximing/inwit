import { isBlankDocumentContent } from './document-logic.js';
import { isPdfMime, type ImportFormat } from './import-logic.js';

export type ExtractFollowUp = 'digest' | 'ocr' | 'none';
export type RetryJobKind = 'extract' | 'ocr' | 'digest';

export function followUpAfterExtract(contentMd: string, format: ImportFormat): ExtractFollowUp {
  if (!isBlankDocumentContent(contentMd)) return 'digest';
  if (format === 'pdf') return 'ocr';
  return 'none';
}

/**
 * Choose which pipeline job to re-enqueue.
 * `pageCount !== null` means extract already ran (including scanned PDFs with 0 text pages).
 */
export function retryJobKindForDocument(doc: {
  status: 'pending' | 'digested' | 'failed';
  contentMd: string;
  fileKey: string | null;
  fileMime: string | null;
  pageCount: number | null;
}): RetryJobKind | null {
  if (doc.status === 'digested') return null;
  const blank = isBlankDocumentContent(doc.contentMd);
  const hasFile = typeof doc.fileKey === 'string' && doc.fileKey.length > 0;
  if (hasFile && blank) {
    if (isPdfMime(doc.fileMime) && doc.pageCount !== null) return 'ocr';
    return 'extract';
  }
  if (!blank) return 'digest';
  return null;
}
