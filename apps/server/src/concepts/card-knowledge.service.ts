import type { AddCardKnowledgeLinkInput, CardKnowledgeLink } from '@inwit/dto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import {
  cardKnowledgeLinks,
  cards,
  conceptPracticeBindings,
  concepts,
  conceptRelations,
  type CardKnowledgeLinkRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';

type Db = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

export function toPublicCardKnowledgeLink(row: CardKnowledgeLinkRow): CardKnowledgeLink {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    cardId: row.cardId,
    conceptId: row.conceptId,
    relationId: row.relationId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 卡片导航关联：多对多、不承担计分。不改写卡片原有文章/主题/脑图归属；
 * 目标必须同用户，主题取目标自身所属主题。
 */
export async function listCardKnowledgeLinks(
  userId: string,
  cardId: string,
): Promise<CardKnowledgeLink[]> {
  await requireOwnedCard(userId, cardId);
  const rows = await getDb()
    .select()
    .from(cardKnowledgeLinks)
    .where(and(eq(cardKnowledgeLinks.userId, userId), eq(cardKnowledgeLinks.cardId, cardId)))
    .orderBy(asc(cardKnowledgeLinks.createdAt), asc(cardKnowledgeLinks.id));
  return rows.map(toPublicCardKnowledgeLink);
}

async function requireOwnedCard(userId: string, cardId: string) {
  const [card] = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .limit(1);
  if (!card) throw AppError.of(404, 'CARD_NOT_FOUND');
  return card;
}

export async function addCardKnowledgeLink(
  userId: string,
  cardId: string,
  input: AddCardKnowledgeLinkInput,
): Promise<{ link: CardKnowledgeLink; created: boolean }> {
  await requireOwnedCard(userId, cardId);
  let topicId: string;
  let conceptId: string | null = null;
  let relationId: string | null = null;
  if (input.targetKind === 'concept') {
    const [concept] = await getDb()
      .select()
      .from(concepts)
      .where(and(eq(concepts.id, input.targetId), eq(concepts.userId, userId)))
      .limit(1);
    if (!concept) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    topicId = concept.topicId;
    conceptId = concept.id;
  } else {
    const [relation] = await getDb()
      .select()
      .from(conceptRelations)
      .where(and(eq(conceptRelations.id, input.targetId), eq(conceptRelations.userId, userId)))
      .limit(1);
    if (!relation) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    topicId = relation.topicId;
    relationId = relation.id;
  }

  const [existing] = await getDb()
    .select()
    .from(cardKnowledgeLinks)
    .where(
      and(
        eq(cardKnowledgeLinks.cardId, cardId),
        conceptId
          ? eq(cardKnowledgeLinks.conceptId, conceptId)
          : eq(cardKnowledgeLinks.relationId, relationId!),
      ),
    )
    .limit(1);
  if (existing) return { link: toPublicCardKnowledgeLink(existing), created: false };

  const [row] = await getDb()
    .insert(cardKnowledgeLinks)
    .values({ userId, topicId, cardId, conceptId, relationId })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return { link: toPublicCardKnowledgeLink(row), created: true };
}

/** 解除导航关联；主要练习绑定存在时要求先解绑（409）。 */
export async function removeCardKnowledgeLink(
  userId: string,
  cardId: string,
  linkId: string,
): Promise<void> {
  await requireOwnedCard(userId, cardId);
  const [link] = await getDb()
    .select()
    .from(cardKnowledgeLinks)
    .where(
      and(
        eq(cardKnowledgeLinks.id, linkId),
        eq(cardKnowledgeLinks.userId, userId),
        eq(cardKnowledgeLinks.cardId, cardId),
      ),
    )
    .limit(1);
  if (!link) throw AppError.of(404, 'CONCEPT_LINK_NOT_FOUND');
  if (link.conceptId || link.relationId) {
    const [binding] = await getDb()
      .select({ id: conceptPracticeBindings.id })
      .from(conceptPracticeBindings)
      .where(
        and(
          eq(conceptPracticeBindings.cardId, cardId),
          isNull(conceptPracticeBindings.endedAt),
          link.conceptId
            ? eq(conceptPracticeBindings.conceptId, link.conceptId)
            : eq(conceptPracticeBindings.relationId, link.relationId!),
        ),
      )
      .limit(1);
    if (binding) throw AppError.of(409, 'CONCEPT_LINK_BOUND');
  }
  await getDb().delete(cardKnowledgeLinks).where(eq(cardKnowledgeLinks.id, link.id));
}
