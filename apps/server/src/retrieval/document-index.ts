import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents } from '../db/schema.js';
import { tryIndexDocument } from './pipeline.js';

/** Reload the row then index. Failures are swallowed by tryIndexDocument. */
export async function tryIndexOwnedDocument(userId: string, documentId: string): Promise<void> {
  const [row] = await getDb()
    .select({
      id: documents.id,
      userId: documents.userId,
      topicId: documents.topicId,
      title: documents.title,
      description: documents.description,
      contentJson: documents.contentJson,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!row) return;
  await tryIndexDocument(row);
}
