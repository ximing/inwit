/**
 * Body preview and auto-title. Kept out of document.ts so list titles
 * (docDisplayTitle) do not pull mathml-to-latex or the headless editor schema.
 */
import { mathPlainText } from '@inwit/doc-schema/math-html';
import {
  BLANK_DOCUMENT_LABEL,
  DOCUMENT_TITLE_MAX,
  UNNAMED_DOCUMENT_TITLE,
  docOwnedTitle,
  type Document,
  type DocumentListItem,
} from './document.js';

const CARD_PREVIEW_DEFAULT = 160;
const PM_WALK_NODE_MAX = 400;

const PM_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'taskItem',
  'tableCell',
]);

const SKIP_TEXT_NODES = new Set(['image', 'video', 'pageBreak']);

function firstNonEmptyLine(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return (normalized.split('\n').find((line) => line.trim().length > 0) ?? '').trim();
}

function clipUnicode(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function contentJsonOf(doc: unknown): unknown {
  if (isRecord(doc) && 'contentJson' in doc) return doc.contentJson;
  return doc;
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function plainFromMarkup(text: string): string {
  return collapseWs(text.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`[\]]/g, ' '));
}

/** Mirrors doc-schema inlineTextOf without loading the ProseMirror schema. */
function inlineText(node: unknown, state: { nodes: number }): string {
  if (state.nodes >= PM_WALK_NODE_MAX || !isRecord(node)) return '';
  state.nodes += 1;
  const type = typeof node.type === 'string' ? node.type : '';
  if (type === 'pageBreak') return '';
  if (type === 'inlineMath' || type === 'blockMath') {
    const attrs = isRecord(node.attrs) ? node.attrs : null;
    const latex = attrs && typeof attrs.latex === 'string' ? attrs.latex : '';
    return mathPlainText(type, latex) ?? '';
  }
  if (typeof node.text === 'string') return node.text;
  const children = Array.isArray(node.content) ? node.content : [];
  let out = '';
  for (const child of children) {
    if (state.nodes >= PM_WALK_NODE_MAX) break;
    if (!isRecord(child)) continue;
    const childType = typeof child.type === 'string' ? child.type : '';
    if (childType === 'hardBreak') {
      out += '\n';
      continue;
    }
    if (SKIP_TEXT_NODES.has(childType)) continue;
    out += inlineText(child, state);
  }
  return out;
}

/** First non-empty top-level block (ATX heading marks stripped), then at most 40 Unicode characters. */
export function titleFromDoc(doc: { contentJson: unknown } | unknown): string {
  const raw = contentJsonOf(doc);
  let blockText = '';
  if (isRecord(raw) && raw.type === 'doc' && Array.isArray(raw.content)) {
    for (const node of raw.content) {
      const text = inlineText(node, { nodes: 0 });
      if (text.replaceAll('\u200b', '').trim().length === 0) continue;
      blockText = text.trim();
      break;
    }
  }
  const firstLine = firstNonEmptyLine(blockText);
  const trimmed = firstLine.replace(/^#{1,6}(?:\s+|$)/, '').trim();
  if (trimmed.length === 0) return UNNAMED_DOCUMENT_TITLE;
  return clipUnicode(trimmed, DOCUMENT_TITLE_MAX);
}

type PmWalkState = { nodes: number };

function collectPmInline(node: unknown, out: string[], state: PmWalkState): void {
  if (state.nodes >= PM_WALK_NODE_MAX || !isRecord(node)) return;
  state.nodes += 1;
  const type = typeof node.type === 'string' ? node.type : '';
  if (type === 'pageBreak') return;
  if (type === 'hardBreak') {
    out.push(' ');
    return;
  }
  if (type === 'inlineMath' || type === 'blockMath') {
    const attrs = isRecord(node.attrs) ? node.attrs : null;
    const latex = attrs && typeof attrs.latex === 'string' ? attrs.latex : '';
    const plain = mathPlainText(type, latex);
    if (plain) out.push(plain);
    return;
  }
  if (typeof node.text === 'string') {
    const text = node.text.replaceAll('\u200b', '');
    if (text) out.push(text);
    return;
  }
  const children = Array.isArray(node.content) ? node.content : [];
  for (const child of children) {
    if (state.nodes >= PM_WALK_NODE_MAX) return;
    if (isRecord(child) && typeof child.type === 'string' && PM_BLOCK_TYPES.has(child.type)) {
      const nested: string[] = [];
      collectPmInline(child, nested, state);
      const joined = collapseWs(nested.join(''));
      if (joined) {
        if (out.length > 0) out.push(' ');
        out.push(joined);
      }
    } else {
      collectPmInline(child, out, state);
    }
  }
}

/** Lightweight body text from PM JSON (no ProseMirror). Stops once `max` characters are collected. */
export function textFromPmJson(value: unknown, max = CARD_PREVIEW_DEFAULT): string {
  const blocks: string[] = [];
  const state: PmWalkState = { nodes: 0 };
  let used = 0;

  const takeBlock = (node: unknown): boolean => {
    const inner: string[] = [];
    collectPmInline(node, inner, state);
    const joined = collapseWs(inner.join(''));
    if (joined) {
      blocks.push(joined);
      used += joined.length + 1;
    }
    return used >= max;
  };

  const walk = (node: unknown): boolean => {
    if (state.nodes >= PM_WALK_NODE_MAX || !isRecord(node)) return used >= max;
    const type = typeof node.type === 'string' ? node.type : '';
    if (type === 'pageBreak') {
      state.nodes += 1;
      return false;
    }
    if (type === 'blockMath' || type === 'inlineMath') return takeBlock(node);
    if (PM_BLOCK_TYPES.has(type)) return takeBlock(node);
    state.nodes += 1;
    const children = Array.isArray(node.content) ? node.content : [];
    for (const child of children) {
      if (walk(child)) return true;
    }
    return used >= max;
  };

  walk(value);
  return clipUnicode(collapseWs(blocks.join(' ')), max);
}

/** Excerpt stored on list rows. Null when the body has no text. */
export const LIST_PREVIEW_MAX = 160;

export function listBodyPreview(contentJson: unknown): string | null {
  const text = textFromPmJson(contentJson, LIST_PREVIEW_MAX);
  return text.length > 0 ? text : null;
}

/** Drop the ProseMirror body when a full document is placed on a list. */
export function toDocumentListItem(
  doc: Document,
  extra: { cardCount: number; proposedCount?: number; topicTitle: string | null },
): DocumentListItem {
  const { contentJson, ...rest } = doc;
  return {
    ...rest,
    cardCount: extra.cardCount,
    proposedCount: extra.proposedCount ?? 0,
    topicTitle: extra.topicTitle,
    preview: listBodyPreview(contentJson),
  };
}

function stripTitlePrefix(preview: string, title: string): string {
  if (!preview.startsWith(title)) return preview;
  return collapseWs(preview.slice(title.length).replace(/^[\s，。、：:；;！!？?\-—–]+/u, ''));
}

export type DocCardFace = {
  title: string | null;
  preview: string | null;
};

/** List/card face: keep a real title; untitled docs show a body preview instead of 「未命名文档」. */
export function docCardFace(
  doc: {
    title?: string | null;
    description?: string | null;
    answer?: string | null;
    contentJson?: unknown;
    /** List rows carry this instead of `contentJson`. */
    preview?: string | null;
  },
  previewMax = CARD_PREVIEW_DEFAULT,
): DocCardFace {
  const title = docOwnedTitle(doc.title);
  const fromContent =
    doc.contentJson !== undefined
      ? textFromPmJson(doc.contentJson, previewMax)
      : collapseWs(doc.preview ?? '');
  const fromDesc = collapseWs(doc.description ?? '');
  const fromAnswer = doc.answer ? plainFromMarkup(doc.answer) : '';

  if (title) {
    const raw = fromDesc || fromContent || fromAnswer;
    const preview = raw ? clipUnicode(stripTitlePrefix(raw, title), previewMax) : '';
    return { title, preview: preview.length > 0 ? preview : null };
  }

  const raw = fromContent || fromDesc || fromAnswer;
  const preview = raw ? clipUnicode(raw, previewMax) : '';
  return { title: null, preview: preview.length > 0 ? preview : null };
}

export function docCardLabel(face: DocCardFace): string {
  return face.title ?? face.preview ?? BLANK_DOCUMENT_LABEL;
}
