import type { MemoryCollection, MemoryEntry, MemoryRevision, Paginated, PaginationQuery } from '@inwit/dto';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { memoryCollections, memoryEntries, memoryRevisions } from '../db/schema.js';

function iso(value: Date): string {
  return value.toISOString();
}

export async function listMemoryCollections(userId: string): Promise<{
  collections: MemoryCollection[];
  entries: MemoryEntry[];
}> {
  const db = getDb();
  const collectionRows = await db
    .select()
    .from(memoryCollections)
    .where(eq(memoryCollections.userId, userId))
    .orderBy(desc(memoryCollections.updatedAt), asc(memoryCollections.id));
  const entryRows = await db
    .select()
    .from(memoryEntries)
    .where(eq(memoryEntries.userId, userId))
    .orderBy(asc(memoryEntries.createdAt), asc(memoryEntries.id));
  // Active rows only. Retired bodies are still returned for the web list.
  const counts = new Map<string, number>();
  for (const entry of entryRows) {
    if (entry.status !== 'active') continue;
    counts.set(entry.collectionId, (counts.get(entry.collectionId) ?? 0) + 1);
  }
  return {
    collections: collectionRows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      entryCount: counts.get(row.id) ?? 0,
      updatedAt: iso(row.updatedAt),
    })),
    entries: entryRows.map((row) => ({
      id: row.id,
      collectionId: row.collectionId,
      body: row.body,
      status: row.status,
      updatedAt: iso(row.updatedAt),
    })),
  };
}

export async function listMemoryRevisions(
  userId: string,
  query: PaginationQuery,
): Promise<Paginated<MemoryRevision>> {
  const where = and(eq(memoryRevisions.userId, userId));
  const [totalRow] = await getDb().select({ n: count() }).from(memoryRevisions).where(where);
  const rows = await getDb()
    .select()
    .from(memoryRevisions)
    .where(where)
    .orderBy(desc(memoryRevisions.createdAt), desc(memoryRevisions.id))
    .limit(query.limit)
    .offset(query.offset);
  return {
    items: rows.map((row) => ({
      id: row.id,
      summary: row.summary,
      diff: row.diff,
      jobId: row.jobId,
      createdAt: iso(row.createdAt),
    })),
    total: Number(totalRow?.n ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}
