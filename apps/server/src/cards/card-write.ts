import type { Database } from '../db/index.js';
import { cards, type CardRow, type NewCard } from '../db/schema.js';

/** 卡片插入的唯一产品入口。db 用调用方已有的连接或事务，这里不另开事务、不建索引。 */
export async function insertCardRow(db: Pick<Database, 'insert'>, values: NewCard): Promise<CardRow> {
  const [row] = await db.insert(cards).values(values).returning();
  return row!;
}

/** 卡片更新的唯一产品入口。db 用调用方已有的连接或事务，这里不另开事务、不建索引。 */
export function updateCards(db: Pick<Database, 'update'>) {
  return db.update(cards);
}
