/**
 * Blank check goes through the headless ProseMirror schema.
 * List and capture code must import pm-doc.ts instead, or the home page
 * downloads the editor stack.
 */
import { pmJsonHasMedia, pmJsonToText } from '@inwit/doc-schema';
import { asSchemaJson } from './pm-doc';

export function isBlankPmDoc(value: unknown): boolean {
  if (pmJsonHasMedia(value)) return false;
  try {
    return pmJsonToText(asSchemaJson(value)).replaceAll('\u200b', '').trim().length === 0;
  } catch {
    return true;
  }
}
