import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cardLinks, cardQuestions, cards } from '../db/schema.js';
import { deleteCardFromIndex } from '../retrieval/pipeline.js';
import { logger } from '../utils/logger.js';
import { buildAssociationHint } from './anchors.js';

/** Removes all cards a document previously produced (DB rows + search index). */
export async function cleanupDocumentCards(userId: string, documentId: string): Promise<void> {
  const rows = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.documentId, documentId)));
  for (const row of rows) {
    try {
      await deleteCardFromIndex(row.id);
    } catch (err) {
      logger.warn('harvest.cleanup_index_failed', { cardId: row.id, err: String(err) });
    }
  }
  if (rows.length > 0) {
    await getDb()
      .delete(cards)
      .where(
        inArray(
          cards.id,
          rows.map((row) => row.id),
        ),
      );
  }
}

/** Digest retries drop only unfinished proposals. Accepted and rejected rows stay. */
export async function deleteProposedDocumentCards(userId: string, documentId: string): Promise<void> {
  const rows = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.documentId, documentId),
        eq(cards.acceptance, 'proposed'),
        isNull(cards.deletedAt),
      ),
    );
  for (const row of rows) {
    try {
      await deleteCardFromIndex(row.id);
    } catch (err) {
      logger.warn('harvest.cleanup_index_failed', { cardId: row.id, err: String(err) });
    }
  }
  if (rows.length > 0) {
    await getDb()
      .delete(cards)
      .where(
        inArray(
          cards.id,
          rows.map((row) => row.id),
        ),
      );
  }
}

export async function loadDocumentCards(userId: string, documentId: string) {
  const cardRows = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.documentId, documentId), isNull(cards.deletedAt)))
    .orderBy(asc(cards.createdAt), asc(cards.id));
  const questionRows =
    cardRows.length === 0
      ? []
      : await getDb()
          .select()
          .from(cardQuestions)
          .where(
            inArray(
              cardQuestions.cardId,
              cardRows.map((row) => row.id),
            ),
          );
  const questionsByCard = new Map<string, number>();
  for (const row of questionRows) {
    questionsByCard.set(row.cardId, (questionsByCard.get(row.cardId) ?? 0) + 1);
  }
  return cardRows.map((row) => ({
    id: row.id,
    concept: row.concept,
    questionCount: questionsByCard.get(row.id) ?? 0,
  }));
}

export async function associationHintForCards(
  userId: string,
  cardIds: string[],
): Promise<string | null> {
  if (cardIds.length === 0) return null;
  const rows = await getDb()
    .select({ concept: cards.concept })
    .from(cardLinks)
    .innerJoin(cards, eq(cards.id, cardLinks.toCardId))
    .where(
      and(
        eq(cardLinks.userId, userId),
        eq(cardLinks.type, 'same_concept'),
        eq(cardLinks.origin, 'agent'),
        inArray(cardLinks.fromCardId, cardIds),
      ),
    );
  return buildAssociationHint(rows.map((row) => row.concept));
}

export async function countOutgoingLinks(userId: string, cardIds: string[]): Promise<number> {
  if (cardIds.length === 0) return 0;
  const [row] = await getDb()
    .select({ n: count() })
    .from(cardLinks)
    .where(and(eq(cardLinks.userId, userId), inArray(cardLinks.fromCardId, cardIds)));
  return Number(row?.n ?? 0);
}
