import { Book, type Packaging } from '@likecoin/epub-ts/node';
import { type ImportFormat } from '@inwit/dto';
import { thematicBreaksToPageBreaks, type PmJson } from '@inwit/doc-schema';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { AppError } from '../errors.js';
import { documentPlainText, mergeChapterHtml } from './content-json.js';
import { normalizeExtractedText, PDF_PAGE_BREAK } from './import-logic.js';
import { decodeTextBuffer } from './text-encoding.js';

export const EPUB_MAX_SPINE_ITEMS = 2000;
export const EPUB_MAX_HTML_CHARS = 32 * 1024 * 1024;

export type EpubExtractLimits = {
  maxSpineItems: number;
  maxHtmlChars: number;
};

export const DEFAULT_EPUB_LIMITS: EpubExtractLimits = {
  maxSpineItems: EPUB_MAX_SPINE_ITEMS,
  maxHtmlChars: EPUB_MAX_HTML_CHARS,
};

export type ExtractedImport = {
  markdown: string;
  pageCount: number | null;
  contentJson?: PmJson;
  suggestedTitle?: string;
  textEncoding?: string;
};

export async function extractImported(
  buffer: Buffer,
  format: ImportFormat,
  epubLimits: EpubExtractLimits = DEFAULT_EPUB_LIMITS,
): Promise<ExtractedImport> {
  try {
    if (format === 'pdf') {
      const { raw, pageCount } = await extractPdf(buffer);
      return { markdown: normalizeExtractedText(raw, format), pageCount };
    }
    if (format === 'epub') return await extractEpub(buffer, epubLimits);
    if (format === 'txt' || format === 'md') {
      const decoded = decodeTextBuffer(buffer);
      return {
        markdown: normalizeExtractedText(decoded.text, format),
        pageCount: null,
        textEncoding: decoded.encoding,
      };
    }
    return {
      markdown: normalizeExtractedText(await extractDocx(buffer), format),
      pageCount: null,
    };
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

async function extractEpub(buffer: Buffer, limits: EpubExtractLimits): Promise<ExtractedImport> {
  const book = new Book(bufferToArrayBuffer(buffer), { replacements: 'none' });
  // A bad zip rejects several internal promises. A bad nav rejects
  // `loadNavigation(...).then` with no catch and never settles `opened`.
  // Wait only for the package, and tear the book down after those callbacks.
  silenceBook(book);
  try {
    await Promise.all([book.loaded.manifest, book.loaded.spine, book.loaded.metadata]);
    if (book.spine.length > limits.maxSpineItems) throw AppError.of(422, 'IMPORT_PARSE_FAILED');

    const chapters: string[] = [];
    let chars = 0;
    const seen = new Set<number>();
    let section = book.spine.first();
    const request = book.archive ? book.archive.request.bind(book.archive) : undefined;
    while (section && seen.size <= limits.maxSpineItems) {
      const index = section.index ?? seen.size;
      if (seen.has(index)) break;
      seen.add(index);
      if (section.linear !== false) {
        const html = await section.render(request);
        chars += html.length;
        if (chars > limits.maxHtmlChars) throw AppError.of(422, 'IMPORT_PARSE_FAILED');
        if (html.trim().length > 0) chapters.push(html);
      }
      section.unload();
      section = section.next?.();
    }

    // Chapter joins are thematic breaks; stored documents use pageBreak.
    const contentJson = thematicBreaksToPageBreaks(mergeChapterHtml(chapters));
    if (documentPlainText(contentJson).trim().length === 0) {
      throw AppError.of(422, 'IMPORT_PARSE_FAILED');
    }
    const suggestedTitle = cleanTitle(book.packaging.metadata.title);
    const extracted: ExtractedImport = { markdown: '', pageCount: null, contentJson };
    if (suggestedTitle) extracted.suggestedTitle = suggestedTitle;
    return extracted;
  } finally {
    await closeBook(book);
  }
}

function silenceBook(book: Book): void {
  void book.ready.catch(() => {});
  void book.opened.catch(() => {});
  for (const promise of Object.values(book.loaded)) {
    void Promise.resolve(promise).catch(() => {});
  }
  // Attach before open() reaches unpack(), which calls this with no catch.
  const loadNavigation = book.loadNavigation.bind(book);
  book.loadNavigation = (packaging: Packaging) =>
    Promise.resolve(loadNavigation(packaging)).catch(() => book.navigation);
}

/** Let nav and display-options callbacks read the book, then destroy it. */
async function closeBook(book: Book): Promise<void> {
  const loaded = book.loaded;
  if (loaded) await Promise.allSettled([loaded.displayOptions, loaded.navigation]);
  try {
    book.destroy();
  } catch {
    // Opening the book already failed; keep that error.
  }
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

function cleanTitle(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : undefined;
}
