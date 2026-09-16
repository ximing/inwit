import { AppError } from '../errors.js';

export const IMPORT_FORMATS = ['pdf', 'docx', 'epub', 'txt', 'md'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** Default technical ceiling (2 GiB). Prefer `config.IMPORT_MAX_FILE_BYTES` at the service layer. */
export const DEFAULT_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const IMPORT_MAX_FILE_BYTES = DEFAULT_IMPORT_MAX_FILE_BYTES;
export const PDF_PAGE_BREAK = '\f';
export const PDF_PAGE_SEPARATOR = '\n\n---\n\n';

const FORMAT_BY_EXT: Record<string, ImportFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  epub: 'epub',
  txt: 'txt',
  md: 'md',
};

const FORMAT_BY_MIME: Record<string, ImportFormat> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/epub+zip': 'epub',
  'application/epub': 'epub',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
};

export const MIME_BY_FORMAT: Record<ImportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  txt: 'text/plain',
  md: 'text/markdown',
};

function basename(filename: string): string {
  const trimmed = filename.trim();
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? trimmed;
}

function fileExtension(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

function normalizeMime(mimetype: string): string {
  const raw = mimetype.split(';')[0] ?? mimetype;
  return raw.trim().toLowerCase();
}

export function detectImportFormat(filename: string, mimetype: string): ImportFormat {
  const ext = fileExtension(filename);
  if (ext) {
    const fromExt = FORMAT_BY_EXT[ext];
    if (fromExt) return fromExt;
    throw AppError.of(415, 'IMPORT_UNSUPPORTED_TYPE');
  }
  const fromMime = FORMAT_BY_MIME[normalizeMime(mimetype)];
  if (fromMime) return fromMime;
  throw AppError.of(415, 'IMPORT_UNSUPPORTED_TYPE');
}

export function titleFromFilename(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const collapsed = stem.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : '未命名文档';
}

export function normalizeExtractedText(text: string, format: ImportFormat): string {
  let unified = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (format === 'pdf') {
    unified = unified
      .split(PDF_PAGE_BREAK)
      .map((page) => page.trim())
      .filter((page) => page.length > 0)
      .join(PDF_PAGE_SEPARATOR);
  }
  return unified.replace(/\n{3,}/g, '\n\n').trim();
}

export function validateImportFile(
  filename: string,
  mime: string,
  size: number,
  maxBytes = DEFAULT_IMPORT_MAX_FILE_BYTES,
): { format: ImportFormat; mime: string; ext: ImportFormat } {
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const format = detectImportFormat(filename, mime);
  return { format, mime: MIME_BY_FORMAT[format], ext: format };
}

export function importSourceKey(userId: string, documentId: string, ext: ImportFormat): string {
  return `docs/${userId}/${documentId}/source.${ext}`;
}

export function documentObjectPrefix(userId: string, documentId: string): string {
  return `docs/${userId}/${documentId}/`;
}

export function isImportSourceKey(key: string, userId: string, documentId: string): boolean {
  const prefix = `docs/${userId}/${documentId}/source.`;
  if (!key.startsWith(prefix) || key.includes('..')) return false;
  const ext = key.slice(prefix.length);
  return (IMPORT_FORMATS as readonly string[]).includes(ext);
}

export function formatFromSourceKey(key: string): ImportFormat | null {
  const match = /\.([a-z0-9]+)$/i.exec(key);
  if (!match) return null;
  const ext = match[1]?.toLowerCase() ?? '';
  return FORMAT_BY_EXT[ext] ?? null;
}

export function isPdfMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const normalized = normalizeMime(mime);
  return normalized === 'application/pdf' || normalized === 'application/x-pdf';
}
