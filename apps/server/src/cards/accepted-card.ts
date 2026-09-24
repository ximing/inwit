import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { cards } from '../db/schema.js';

/** User knowledge: accepted and not in 回收站. Do not use on getDocument or digest writes. */
export function acceptedCard(table: typeof cards = cards): SQL {
  return and(eq(table.acceptance, 'accepted'), isNull(table.deletedAt)) as SQL;
}