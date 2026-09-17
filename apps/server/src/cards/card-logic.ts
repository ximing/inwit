import type { CardQuestion, CardQuestionInput } from '@inwit/dto';

export type CardQuestionDiff = {
  toCreate: CardQuestionInput[];
  toUpdate: Array<{ id: string; input: CardQuestionInput }>;
  toDelete: string[];
  /** Ids the client sent that don't belong to this card — service rejects with 400. */
  unknownIds: string[];
};

/**
 * Full-replace diff for a card's question list:
 * - desired without id → create
 * - desired id matching an existing row → update (only when content changed)
 * - existing row absent from desired → delete
 * - desired id not among existing → unknownIds (caller throws VALIDATION_ERROR)
 */
export function diffCardQuestions(
  existing: CardQuestion[],
  desired: CardQuestionInput[],
): CardQuestionDiff {
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const desiredIds = new Set<string>();
  const toCreate: CardQuestionInput[] = [];
  const toUpdate: Array<{ id: string; input: CardQuestionInput }> = [];
  const unknownIds: string[] = [];

  for (const input of desired) {
    if (!input.id) {
      toCreate.push(input);
      continue;
    }
    desiredIds.add(input.id);
    const current = existingById.get(input.id);
    if (!current) {
      unknownIds.push(input.id);
      continue;
    }
    if (
      current.type !== input.type ||
      current.question !== input.question ||
      current.answer !== input.answer
    ) {
      toUpdate.push({ id: input.id, input });
    }
  }

  const toDelete = existing.filter((row) => !desiredIds.has(row.id)).map((row) => row.id);
  return { toCreate, toUpdate, toDelete, unknownIds };
}

const MAX_TAGS = 20;
const MAX_TAG_CHARS = 50;

/** Trim, drop empties, clip overlong, dedupe (first occurrence wins), cap the count. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = [...raw.trim()].slice(0, MAX_TAG_CHARS).join('');
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
