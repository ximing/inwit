import type { EvolveReason, ReviewFeedback } from '@inwit/dto';

export function evolveReasonFor(
  feedback: ReviewFeedback,
  lapses: number,
): EvolveReason | null {
  if (feedback === 'fuzzy') return 'fuzzy';
  if (feedback === 'forgot' && lapses >= 2) return 'repeated_forgot';
  return null;
}
