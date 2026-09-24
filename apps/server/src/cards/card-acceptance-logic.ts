import type { CardAcceptance } from '@inwit/dto';

export { codePointsAtMost } from '@inwit/dto';

export function shouldIndexCard(card: {
  acceptance: CardAcceptance;
  deletedAt: Date | string | null;
}): boolean {
  return card.acceptance === 'accepted' && card.deletedAt == null;
}
