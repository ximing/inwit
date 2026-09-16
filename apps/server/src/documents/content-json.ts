import { pmJsonToText, thematicBreaksToPageBreaks, type PmJson } from '@inwit/doc-schema';
import { EMPTY_PM_DOC } from '@inwit/dto';
import { parseMarkdownToPmJSON } from '@inwit/markdown';

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
  if (normalized.replaceAll('\u200b', '').trim().length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: normalized }] }],
  };
}
