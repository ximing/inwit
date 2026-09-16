import { pmJsonToText, type PmJson } from '@inwit/doc-schema';
import { EMPTY_PM_DOC, type PmDocJson } from '@inwit/dto';

export function asPmJson(value: unknown): PmDocJson {
  if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'doc') {
    return value as PmDocJson;
  }
  return EMPTY_PM_DOC;
}

export function clonePmJson(value: unknown): PmDocJson {
  return JSON.parse(JSON.stringify(asPmJson(value))) as PmDocJson;
}

export function asSchemaJson(value: unknown): PmJson {
  return asPmJson(value) as unknown as PmJson;
}

export function isBlankPmDoc(value: unknown): boolean {
  try {
    return pmJsonToText(asSchemaJson(value)).replaceAll('\u200b', '').trim().length === 0;
  } catch {
    return true;
  }
}

/** Plain text / chat answer / AI 摘要 → 按空行切段的 PM JSON。 */
export function textToPmDoc(text: string): PmDocJson {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.replaceAll('\u200b', '').trim().length === 0) {
    return clonePmJson(EMPTY_PM_DOC);
  }
  const blocks = normalized.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    const content: PmJson[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (i > 0) content.push({ type: 'hardBreak' });
      const line = lines[i] ?? '';
      if (line.length > 0) content.push({ type: 'text', text: line });
    }
    return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
  });
  return { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] };
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
