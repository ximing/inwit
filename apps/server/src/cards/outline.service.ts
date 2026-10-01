import type { Card, SetCardOutlineInput } from '@inwit/dto';
import { planOutlineDetach } from '@inwit/dto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { placeCanvasMember } from '../canvas/canvas.service.js';
import { getDb, type Database } from '../db/index.js';
import { cards } from '../db/schema.js';
import { AppError } from '../errors.js';
import { toPublicCardBase } from './card.mapper.js';

type OutlineDb = Pick<Database, 'select' | 'update'>;

/**
 * 一张卡离开可见树时，子卡升到它的父卡下。
 * 拒绝掉的卡不参与排版，但若正挂在被移走的卡下面，也一起改挂，避免以后重新出现时还指着它。
 */
export async function applyOutlineDetach(db: OutlineDb, userId: string, cardId: string): Promise<void> {
  const [card] = await db
    .select({
      id: cards.id,
      documentId: cards.documentId,
    })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .limit(1);
  if (!card) return;

  const now = new Date();
  if (!card.documentId) {
    await db
      .update(cards)
      .set({ outlineParentId: null, updatedAt: now })
      .where(and(eq(cards.userId, userId), eq(cards.outlineParentId, cardId)));
    return;
  }

  const rows = await db
    .select({
      id: cards.id,
      parentId: cards.outlineParentId,
      position: cards.outlinePosition,
      acceptance: cards.acceptance,
    })
    .from(cards)
    .where(
      and(eq(cards.userId, userId), eq(cards.documentId, card.documentId), isNull(cards.deletedAt)),
    )
    .orderBy(asc(cards.id));

  const visible = rows
    .filter((row) => row.acceptance !== 'rejected' || row.id === cardId)
    .map((row) => ({ id: row.id, parentId: row.parentId, position: row.position }));
  const plan = planOutlineDetach(visible, cardId);
  for (const move of plan.moves) {
    await db
      .update(cards)
      .set({
        outlineParentId: move.parentId,
        outlinePosition: move.position,
        updatedAt: now,
      })
      .where(and(eq(cards.id, move.id), eq(cards.userId, userId)));
  }
  await db
    .update(cards)
    .set({ outlineParentId: plan.nextParent, updatedAt: now })
    .where(
      and(eq(cards.userId, userId), eq(cards.outlineParentId, cardId), isNull(cards.deletedAt)),
    );
}

export async function placeCardOutline(
  userId: string,
  cardId: string,
  input: SetCardOutlineInput,
): Promise<Card> {
  const [card] = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
    .limit(1);
  if (!card) throw AppError.of(404, 'CARD_NOT_FOUND');
  if (card.acceptance === 'rejected') throw AppError.of(409, 'CARD_NOT_ACCEPTABLE');
  if (!card.documentId) throw AppError.of(400, 'CARD_OUTLINE_INVALID');

  try {
    await placeCanvasMember(userId, card.documentId, cardId, input.parentId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'CANVAS_NODE_INVALID') {
      throw AppError.of(400, 'CARD_OUTLINE_INVALID');
    }
    throw err;
  }

  const [updated] = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .limit(1);
  if (!updated) throw AppError.of(404, 'CARD_NOT_FOUND');
  return toPublicCardBase(updated);
}
