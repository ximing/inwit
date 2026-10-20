/**
 * Blank check goes through the headless ProseMirror schema.
 * List and capture code must import pm-doc.ts instead, or the home page
 * downloads the editor stack.
 */
import { pmJsonHasMedia, pmJsonToText } from '@inwit/doc-schema';
import { asSchemaJson } from './pm-doc';

/** A table is content even when every cell is still empty. */
function pmJsonHasTable(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as { type?: unknown; content?: unknown };
  if (node.type === 'table') return true;
  if (!Array.isArray(node.content)) return false;
  return node.content.some((child) => pmJsonHasTable(child));
}

export function isBlankPmDoc(value: unknown): boolean {
  if (pmJsonHasMedia(value) || pmJsonHasTable(value)) return false;
  try {
    return pmJsonToText(asSchemaJson(value)).replaceAll('\u200b', '').trim().length === 0;
  } catch {
    return true;
  }
}
