import {
  getHeadlessExtensions,
  pmJsonToText,
  thematicBreaksToPageBreaks,
  type PmJson,
} from '@inwit/doc-schema';
import { EMPTY_PM_DOC } from '@inwit/dto';
import { parseMarkdownToPmJSON, safeMediaSrc } from '@inwit/markdown';
import { generateJSON } from '@tiptap/html';
import { AppError } from '../errors.js';

export { EMPTY_PM_DOC };

export function asPmJson(value: unknown): PmJson {
  if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'doc') {
    return value as PmJson;
  }
  return EMPTY_PM_DOC as PmJson;
}

export function documentPlainText(contentJson: unknown): string {
  try {
    return pmJsonToText(asPmJson(contentJson));
  } catch {
    return '';
  }
}

/** Markdown import/OCR page delimiter; converted to `pageBreak` on write. */
export const MARKDOWN_PAGE_SEPARATOR = '\n\n---\n\n';

function horizontalRulesToThematicBreaks(doc: PmJson): PmJson {
  const content = doc.content;
  if (!content) return { ...doc };
  return {
    ...doc,
    content: content.map((node) => (node.type === 'horizontalRule' ? { type: 'thematicBreak' } : node)),
  };
}

/** Import/agent markdown → PM JSON with numbered `pageBreak` nodes. */
export function markdownToContentJson(md: string): PmJson {
  const parsed = parseMarkdownToPmJSON(md) as PmJson;
  return thematicBreaksToPageBreaks(horizontalRulesToThematicBreaks(parsed));
}

/** Chat question (plain text) → a single PM paragraph. */
export function textToParagraphDoc(text: string): PmJson {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.replaceAll('​', '').trim().length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: normalized }] }],
  };
}

/** Mirrors the old turndown.remove list — keeps non-content elements out of documents. */
const NON_CONTENT_RE =
  /<(script|style|noscript|iframe|button|form|input|select|textarea)\b[\s\S]*?<\/\1>/gi;

function stripNonContentHtml(html: string): string {
  return html.replace(NON_CONTENT_RE, '');
}

/** Drop image/video nodes with illegal srcs; strip illegal posters. Same policy as the markdown path. */
function sanitizePmMedia(doc: PmJson): PmJson {
  const walk = (nodes: PmJson[] | undefined): PmJson[] | undefined => {
    if (!nodes) return nodes;
    const out: PmJson[] = [];
    for (const node of nodes) {
      if (node.type === 'image' || node.type === 'video') {
        const src = typeof node.attrs?.src === 'string' ? safeMediaSrc(node.attrs.src) : null;
        if (src === null) continue;
        const attrs: Record<string, unknown> = { ...node.attrs, src };
        if (typeof attrs.poster === 'string') {
          const poster = safeMediaSrc(attrs.poster);
          if (poster === null) delete attrs.poster;
          else attrs.poster = poster;
        }
        out.push({ ...node, attrs });
        continue;
      }
      const content = walk(node.content);
      // Drop empty paragraphs — the parser leaves them behind when a block
      // video/image is lifted out of its wrapping <p>.
      if (node.type === 'paragraph' && (content === undefined || content.length === 0)) continue;
      out.push(content === undefined ? node : { ...node, content });
    }
    return out;
  };
  const content = walk(doc.content);
  return content === undefined ? doc : { ...doc, content };
}

const ATOM_TYPES = new Set(['image', 'video', 'horizontalRule', 'thematicBreak', 'pageBreak']);

function hasAtom(node: PmJson): boolean {
  if (ATOM_TYPES.has(node.type)) return true;
  return (node.content ?? []).some((child) => hasAtom(child));
}

function isEmptyDoc(doc: PmJson): boolean {
  return !hasAtom(doc) && pmJsonToText(doc).trim() === '';
}

function prependSourceBlockquote(doc: PmJson, sourceUrl: string): PmJson {
  return {
    ...doc,
    content: [
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '原文：' },
              {
                type: 'text',
                text: '原文链接',
                marks: [{ type: 'link', attrs: { href: sourceUrl } }],
              },
            ],
          },
        ],
      },
      ...(doc.content ?? []),
    ],
  };
}

/**
 * Open-API HTML ingest: straight HTML→PM conversion via the headless editor
 * schema (no markdown round-trip — videos survive as `video` nodes).
 */
export function htmlToContentJson(html: string, sourceUrl?: string): PmJson {
  const doc = generateJSON(stripNonContentHtml(html), getHeadlessExtensions()) as PmJson;
  const transformed = thematicBreaksToPageBreaks(
    horizontalRulesToThematicBreaks(sanitizePmMedia(doc)),
  );
  if (isEmptyDoc(transformed)) throw AppError.of(400, 'IMPORT_EMPTY');
  return sourceUrl !== undefined ? prependSourceBlockquote(transformed, sourceUrl) : transformed;
}
