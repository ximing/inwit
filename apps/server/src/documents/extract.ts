import { type ImportFormat } from '@inwit/dto';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { AppError } from '../errors.js';
import { normalizeExtractedText, PDF_PAGE_BREAK } from './import-logic.js';

export async function extractImported(
  buffer: Buffer,
  format: ImportFormat,
): Promise<{ markdown: string; pageCount: number | null }> {
  try {
    if (format === 'pdf') {
      const { raw, pageCount } = await extractPdf(buffer);
      return { markdown: normalizeExtractedText(raw, format), pageCount };
    }
    const raw = await extractRaw(buffer, format);
    return { markdown: normalizeExtractedText(raw, format), pageCount: null };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.of(422, 'IMPORT_PARSE_FAILED');
  }
}

/** Empty content is valid (scanned PDFs). Callers decide digest vs ocr. */
export async function extractImportedMarkdown(
  buffer: Buffer,
  format: ImportFormat,
): Promise<string> {
  const { markdown } = await extractImported(buffer, format);
  return markdown;
}

async function extractRaw(buffer: Buffer, format: Exclude<ImportFormat, 'pdf'>): Promise<string> {
  switch (format) {
    case 'txt':
    case 'md':
      return decodeUtf8(buffer);
    case 'docx':
      return extractDocx(buffer);
    case 'epub':
      return extractEpub(buffer);
  }
}

function decodeUtf8(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

async function extractPdf(buffer: Buffer): Promise<{ raw: string; pageCount: number }> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text ?? '')];
  return { raw: pages.join(PDF_PAGE_BREAK), pageCount: pages.length };
}

type MammothMarkdown = typeof mammoth & {
  convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

async function extractDocx(buffer: Buffer): Promise<string> {
  const { value } = await (mammoth as MammothMarkdown).convertToMarkdown({ buffer });
  return value;
}

async function extractEpub(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const container = await readZipText(zip, 'META-INF/container.xml');
  if (!container) throw AppError.of(422, 'IMPORT_PARSE_FAILED');
  const opfPath = containerFullPath(container);
  if (!opfPath) throw AppError.of(422, 'IMPORT_PARSE_FAILED');
  const opf = await readZipText(zip, opfPath);
  if (!opf) throw AppError.of(422, 'IMPORT_PARSE_FAILED');

  const manifest = parseManifest(opf);
  const spineIds = parseSpine(opf);
  const opfDir = dirName(opfPath);
  const chapters: string[] = [];

  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item || !isDocumentHref(item.mediaType, item.href)) continue;
    const path = resolveZipPath(opfDir, decodeHref(item.href));
    const html = await readZipText(zip, path);
    if (!html) continue;
    const text = htmlToMarkdown(html);
    if (text.trim()) chapters.push(text);
  }

  return chapters.join('\n\n');
}

function containerFullPath(xml: string): string | null {
  const match = xml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  return match?.[1] ? normalizeZipPath(match[1]) : null;
}

function parseManifest(opf: string): Map<string, { href: string; mediaType: string }> {
  const items = new Map<string, { href: string; mediaType: string }>();
  const re = /<(?:[\w.-]+:)?item\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(opf))) {
    const attrs = parseAttrs(match[1] ?? '');
    const id = attrs.id;
    const href = attrs.href;
    if (!id || !href) continue;
    items.set(id, { href, mediaType: attrs['media-type'] ?? '' });
  }
  return items;
}

function parseSpine(opf: string): string[] {
  const ids: string[] = [];
  const re = /<(?:[\w.-]+:)?itemref\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(opf))) {
    const attrs = parseAttrs(match[1] ?? '');
    if ((attrs.linear ?? 'yes').toLowerCase() === 'no') continue;
    if (attrs.idref) ids.push(attrs.idref);
  }
  return ids;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    attrs[name] = match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function isDocumentHref(mediaType: string, href: string): boolean {
  const mt = mediaType.toLowerCase();
  if (mt.includes('xhtml') || mt === 'text/html' || mt === 'application/xml' || mt === 'text/xml') {
    return true;
  }
  if (mt && mt !== 'application/octet-stream') return false;
  return /\.(xhtml|html|htm|xml)$/i.test(href);
}

function htmlToMarkdown(html: string): string {
  let s = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  const body = s.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body?.[1] !== undefined) s = body[1];
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_, n: string) => `${'#'.repeat(Number(n))} `);
  s = s.replace(/<li\b[^>]*>/gi, '- ');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  return decodeBasicEntities(s);
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePointSafe(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => fromCodePointSafe(Number(n)));
}

function fromCodePointSafe(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return '';
  if (n >= 0xd800 && n <= 0xdfff) return '';
  return String.fromCodePoint(n);
}

function decodeHref(href: string): string {
  const cut = href.split('#')[0]?.split('?')[0] ?? href;
  try {
    return decodeURIComponent(cut);
  } catch {
    return cut;
  }
}

function dirName(path: string): string {
  const normalized = normalizeZipPath(path);
  const i = normalized.lastIndexOf('/');
  return i === -1 ? '' : normalized.slice(0, i);
}

function resolveZipPath(baseDir: string, href: string): string {
  const parts = [...baseDir.split('/'), ...normalizeZipPath(href).split('/')];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const file = findZipFile(zip, path);
  if (!file) return null;
  const text = await file.async('string');
  return text.replace(/^\uFEFF/, '');
}

function findZipFile(zip: JSZip, path: string) {
  const normalized = normalizeZipPath(path);
  const exact = zip.file(normalized);
  if (exact) return exact;
  const lower = normalized.toLowerCase();
  return (
    zip.file(/.*/).find((entry) => !entry.dir && normalizeZipPath(entry.name).toLowerCase() === lower) ??
    null
  );
}
