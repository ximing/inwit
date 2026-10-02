import type { PmDocJson, UpdateDocumentInput } from '@inwit/dto';
import { clonePmJson, isBlankPmDoc, jsonEqual, textToPmDoc } from '@/lib/pm-doc';

export const SAVE_DEBOUNCE_MS = 2000;

/** Empty or whitespace clears the stored title. Zod caps title at 500 UTF-16 units. */
export function normalizedTitle(draft: string): string | null {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 500);
}

export function titlesDiffer(draft: string, lastSaved: string): boolean {
  return normalizedTitle(draft) !== normalizedTitle(lastSaved);
}

/** Body the reader shows: stored JSON, else chat answer paragraphs, else the stored doc. */
export function displayedPmJson(doc: { contentJson: unknown; answer?: string | null }): PmDocJson {
  if (!isBlankPmDoc(doc.contentJson)) return clonePmJson(doc.contentJson);
  const answer = doc.answer?.trim() ?? '';
  if (answer.length > 0) return textToPmDoc(answer);
  return clonePmJson(doc.contentJson);
}

/**
 * Document handed to the engine. A draft wins so leaving 脑图 restores unsaved
 * text and the anchor that lives in it. Blank docs stay unmounted until editing.
 */
export function enginePmJson(
  draft: PmDocJson | null,
  doc: { contentJson: unknown; answer?: string | null },
  editing: boolean,
): PmDocJson | null {
  const shown = draft ? clonePmJson(draft) : displayedPmJson(doc);
  if (!isBlankPmDoc(shown)) return shown;
  if (editing) return shown;
  return null;
}

/** Patch with only the fields that actually changed. Null title clears it. */
export function buildDocumentPatch(input: {
  draftTitle: string;
  lastSavedTitle: string;
  draftJson: PmDocJson;
  lastSavedJson: PmDocJson;
}): UpdateDocumentInput | null {
  const patch: UpdateDocumentInput = {};
  if (titlesDiffer(input.draftTitle, input.lastSavedTitle)) {
    patch.title = normalizedTitle(input.draftTitle);
  }
  if (!jsonEqual(input.draftJson, input.lastSavedJson)) {
    patch.contentJson = input.draftJson;
  }
  if (patch.title === undefined && patch.contentJson === undefined) return null;
  return patch;
}
