import type { TopicGraphResponse } from '@inwit/dto';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { cardLinks, cards, documents, reviewStates } from '../db/schema.js';
import { getDb } from '../db/index.js';
import { getOwnedTopic } from './topic.service.js';

/**
 * 主题脑图：主题下未被删除、未拒绝的卡片，加上两端都在这个集合里的知识关联。
 * 跨主题的关联只存在于脉络里，不进主题画布。
 */
export async function getTopicGraph(userId: string, topicId: string): Promise<TopicGraphResponse> {
  await getOwnedTopic(userId, topicId);

  const cardRows = await getDb()
    .select({ card: cards, documentTitle: documents.title, state: reviewStates })
    .from(cards)
    .leftJoin(documents, eq(cards.documentId, documents.id))
    .leftJoin(
      reviewStates,
      and(eq(reviewStates.cardId, cards.id), eq(reviewStates.userId, userId)),
    )
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.topicId, topicId),
        isNull(cards.deletedAt),
        ne(cards.acceptance, 'rejected'),
      ),
    )
    .orderBy(cards.createdAt, cards.id);

  const ids = cardRows.map((row) => row.card.id);
  const linkRows =
    ids.length === 0
      ? []
      : await getDb()
          .select()
          .from(cardLinks)
          .where(
            and(
              eq(cardLinks.userId, userId),
              inArray(cardLinks.fromCardId, ids),
              inArray(cardLinks.toCardId, ids),
            ),
          );

  return {
    cards: cardRows.map((row) => ({
      id: row.card.id,
      documentId: row.card.documentId,
      documentTitle: row.documentTitle,
      concept: row.card.concept,
      hasImage: Boolean(row.card.imageKey),
      acceptance: row.card.acceptance,
      review: row.state
        ? {
            dueAt: row.state.dueAt.toISOString(),
            intervalDays: row.state.intervalDays,
            suspendedAt: row.state.suspendedAt ? row.state.suspendedAt.toISOString() : null,
          }
        : null,
    })),
    links: linkRows.map((row) => ({
      fromCardId: row.fromCardId,
      toCardId: row.toCardId,
      type: row.type,
      origin: row.origin,
      reason: row.reason,
    })),
  };
}
