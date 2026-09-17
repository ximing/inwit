import { EMPTY_PM_DOC, type PmDocJson } from '@inwit/dto';

type PmNode = { type: string; text?: string; content?: PmNode[] };

function cloneEmpty(): PmDocJson {
  return JSON.parse(JSON.stringify(EMPTY_PM_DOC)) as PmDocJson;
}

/**
 * Plain text → PM JSON (paragraphs split on blank lines).
 * Adapted from apps/web/src/lib/pm-doc.ts `textToPmDoc` without `@inwit/doc-schema`.
 */
export function textToPmDoc(text: string): PmDocJson {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.replaceAll('\u200b', '').trim().length === 0) {
    return cloneEmpty();
  }
  const blocks = normalized.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    const content: PmNode[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (i > 0) content.push({ type: 'hardBreak' });
      const line = lines[i] ?? '';
      if (line.length > 0) content.push({ type: 'text', text: line });
    }
    return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
  });
  return { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] };
}

function collectText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as PmNode;
  if (typeof n.text === 'string') return n.text;
  if (!Array.isArray(n.content)) return '';
  return n.content.map(collectText).join('');
}

export function isBlankPmDoc(value: unknown): boolean {
  try {
    return collectText(value).replaceAll('\u200b', '').trim().length === 0;
  } catch {
    return true;
  }
}

export function asPmJson(value: unknown): PmDocJson {
  if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'doc') {
    return value as PmDocJson;
  }
  return cloneEmpty();
}
