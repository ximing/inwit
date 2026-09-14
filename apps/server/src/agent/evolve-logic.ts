import { CARD_QUESTION_TYPES, type CardQuestionType, type EvolveReason } from '@inwit/dto';

export const SPLIT_LINK_REASON = '由原卡拆小';
export const SPLIT_LINK_TYPE = 'related' as const;
export const SPLIT_MAX_CHILDREN = 2;

export function addedQuestionIsNewAngle(
  existingTypes: readonly string[],
  addedTypes: readonly string[],
): boolean {
  if (addedTypes.length === 0) return false;
  const set = new Set(existingTypes);
  if (set.size >= CARD_QUESTION_TYPES.length) return true;
  return addedTypes.some((type) => !set.has(type));
}

export function isCardQuestionType(value: string): value is CardQuestionType {
  return (CARD_QUESTION_TYPES as readonly string[]).includes(value);
}

export function evolveResultSummary(input: {
  reason: EvolveReason;
  questionDelta: number;
  childCount: number;
  memoryWritten: boolean;
}): string {
  if (input.reason === 'fuzzy') {
    return `reason=fuzzy questions=+${String(input.questionDelta)} memory=${input.memoryWritten ? '1' : '0'}`;
  }
  return `reason=repeated_forgot children=${String(input.childCount)} questions=+${String(input.questionDelta)} memory=${input.memoryWritten ? '1' : '0'}`;
}
