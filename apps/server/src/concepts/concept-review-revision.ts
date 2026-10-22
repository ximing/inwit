import { and, inArray, sql } from 'drizzle-orm';
import { updateCards } from '../cards/card-write.js';
import type { Database } from '../db/index.js';
import { cards } from '../db/schema.js';

/**
 * 批量轮换调用方已经选出的卡片。
 * SQL 仍是 `reviewRevision + 1`，where 是 id 列表加上 `reviewRevision IS NOT NULL`，null 保持 null。
 * 空列表直接返回。事务和行锁留在调用方。
 */
export async function bumpManagedCardRevisions(
  db: Pick<Database, 'update'>,
  cardIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(cardIds)];
  if (unique.length === 0) return;
  await updateCards(db)
    .set({ reviewRevision: sql`${cards.reviewRevision} + 1`, updatedAt: new Date() })
    .where(and(inArray(cards.id, unique), sql`${cards.reviewRevision} IS NOT NULL`));
}
