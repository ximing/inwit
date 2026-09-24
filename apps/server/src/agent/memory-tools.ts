import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { memoryCollections, memoryEntries } from '../db/schema.js';
import { hybridSearchRanked } from '../retrieval/pipeline.js';
import {
  memoryCollectionsStoreName,
  memoryEntriesStoreName,
} from '../retrieval/memory-index-logic.js';
import { logger } from '../utils/logger.js';
import {
  LOAD_MEMORY_COLLECTION_TOOL,
  SEARCH_MEMORY_COLLECTIONS_TOOL,
} from './memory-audit-logic.js';
import {
  MEMORY_LOAD_MAX_COLLECTIONS,
  MEMORY_LOAD_SEARCH_MAX_HITS,
  keepUuidIds,
  memoryLoadFitsInline,
  selectMemoryLoad,
  takeMemoryCollectionIds,
} from './memory-load-logic.js';

const COLLECTION_SEARCH_LIMIT = 5;

type EntryBody = { id: string; body: string };

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

function emptyToolResult() {
  return toolResult('[]', []);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function countActiveCollections(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(memoryCollections)
    .where(and(eq(memoryCollections.userId, userId), eq(memoryCollections.status, 'active')));
  const n = Number(row?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function loadOwnedActiveCollections(userId: string, ids: readonly string[]) {
  const wanted = keepUuidIds(ids);
  if (wanted.length === 0) return [];
  return getDb()
    .select({
      id: memoryCollections.id,
      title: memoryCollections.title,
      description: memoryCollections.description,
    })
    .from(memoryCollections)
    .where(
      and(
        eq(memoryCollections.userId, userId),
        eq(memoryCollections.status, 'active'),
        inArray(memoryCollections.id, wanted),
      ),
    );
}

async function loadActiveEntries(
  userId: string,
  collectionIds: readonly string[],
): Promise<Map<string, EntryBody[]>> {
  const grouped = new Map<string, EntryBody[]>();
  for (const id of collectionIds) grouped.set(id, []);
  if (collectionIds.length === 0) return grouped;
  const rows = await getDb()
    .select({
      id: memoryEntries.id,
      collectionId: memoryEntries.collectionId,
      body: memoryEntries.body,
    })
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.userId, userId),
        eq(memoryEntries.status, 'active'),
        inArray(memoryEntries.collectionId, [...collectionIds]),
      ),
    )
    .orderBy(asc(memoryEntries.createdAt), asc(memoryEntries.id));
  for (const row of rows) {
    grouped.get(row.collectionId)?.push({ id: row.id, body: row.body });
  }
  return grouped;
}

async function loadActiveEntriesByIds(
  userId: string,
  collectionId: string,
  ids: readonly string[],
): Promise<Map<string, EntryBody>> {
  const wanted = keepUuidIds(ids);
  if (wanted.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: memoryEntries.id, body: memoryEntries.body })
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.userId, userId),
        eq(memoryEntries.collectionId, collectionId),
        eq(memoryEntries.status, 'active'),
        inArray(memoryEntries.id, wanted),
      ),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

async function searchMemoryCollections(userId: string, query: string) {
  const activeCount = await countActiveCollections(userId);
  // No active collections: do not embed, and do not inject every description.
  if (activeCount <= 0) {
    logger.info('memory.search_empty', { userId, collectionHits: 0 });
    return [];
  }
  const ranked = await hybridSearchRanked({
    storeName: memoryCollectionsStoreName(),
    userId,
    query,
    limit: COLLECTION_SEARCH_LIMIT,
    filterIds: async (ids) => {
      const rows = await loadOwnedActiveCollections(userId, ids);
      const allowed = new Set(rows.map((row) => row.id.toLowerCase()));
      return ids.filter((id) => allowed.has(id.toLowerCase()));
    },
  });
  const rows = await loadOwnedActiveCollections(
    userId,
    ranked.map((hit) => hit.id),
  );
  const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
  const seen = new Set<string>();
  const collections = [];
  for (const hit of ranked) {
    const key = hit.id.toLowerCase();
    if (seen.has(key)) continue;
    const row = byId.get(key);
    if (!row) continue;
    seen.add(key);
    collections.push({
      id: row.id,
      title: row.title,
      description: row.description,
      score: hit.score,
    });
  }
  if (collections.length === 0) {
    logger.info('memory.search_empty', { userId, collectionHits: 0 });
  }
  return { collections };
}

async function searchEntriesInCollection(
  userId: string,
  collectionId: string,
  query: string,
  active: readonly EntryBody[],
): Promise<EntryBody[]> {
  const activeIds = new Set(active.map((entry) => entry.id.toLowerCase()));
  const ranked = await hybridSearchRanked({
    storeName: memoryEntriesStoreName(),
    userId,
    query,
    limit: MEMORY_LOAD_SEARCH_MAX_HITS,
    payloadEquals: [{ key: 'collection_id', value: collectionId }],
    filterIds: async (ids) => ids.filter((id) => activeIds.has(id.toLowerCase())),
  });
  const fresh = await loadActiveEntriesByIds(
    userId,
    collectionId,
    ranked.map((hit) => hit.id),
  );
  const byId = new Map([...fresh.values()].map((row) => [row.id.toLowerCase(), row]));
  const hits: EntryBody[] = [];
  const seen = new Set<string>();
  for (const hit of ranked) {
    const key = hit.id.toLowerCase();
    if (seen.has(key)) continue;
    const row = byId.get(key);
    if (!row) continue;
    seen.add(key);
    hits.push(row);
  }
  return hits;
}

async function loadMemoryCollections(
  userId: string,
  query: string,
  collectionIds: readonly string[],
) {
  const ids = takeMemoryCollectionIds(collectionIds);
  const owned = await loadOwnedActiveCollections(userId, ids);
  const ownedById = new Map(owned.map((row) => [row.id.toLowerCase(), row]));
  const ordered = ids.flatMap((id) => {
    const row = ownedById.get(id.toLowerCase());
    return row ? [row] : [];
  });
  const entriesByCollection = await loadActiveEntries(
    userId,
    ordered.map((row) => row.id),
  );
  const collections = [];
  for (const row of ordered) {
    const active = entriesByCollection.get(row.id) ?? [];
    const selected = memoryLoadFitsInline(active)
      ? selectMemoryLoad({ active, hits: [] })
      : selectMemoryLoad({
          active,
          hits: await searchEntriesInCollection(userId, row.id, query, active),
        });
    collections.push({
      id: row.id,
      title: row.title,
      entries: selected.entries.map((entry) => ({ id: entry.id, body: entry.body })),
      truncated: selected.truncated,
    });
  }
  logger.info('memory.load', {
    userId,
    loadedIds: collections.map((collection) => collection.id),
    truncated: collections.some((collection) => collection.truncated),
  });
  return { collections };
}

export const searchMemoryCollectionsSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500 }),
});
export type SearchMemoryCollectionsArgs = Static<typeof searchMemoryCollectionsSchema>;

export function searchMemoryCollectionsTool(session: {
  userId: string;
}): AgentTool<typeof searchMemoryCollectionsSchema> {
  return {
    name: SEARCH_MEMORY_COLLECTIONS_TOOL,
    label: '检索记忆集合',
    description:
      '在做任务前调用。按标题和描述混合检索该用户的记忆集合，返回最多 5 条 { id, title, description, score }。不返回条目。检索失败时返回空数组，应继续任务。',
    parameters: searchMemoryCollectionsSchema,
    execute: async (_id, params) => {
      try {
        const payload = await searchMemoryCollections(session.userId, params.query);
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        logger.warn('memory.search_failed', {
          userId: session.userId,
          error: errorMessage(err),
        });
        return emptyToolResult();
      }
    },
  };
}

export const loadMemoryCollectionSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500 }),
  collectionIds: Type.Array(Type.String({ minLength: 1, maxLength: 36 }), {
    minItems: 1,
    maxItems: MEMORY_LOAD_MAX_COLLECTIONS,
  }),
});
export type LoadMemoryCollectionArgs = Static<typeof loadMemoryCollectionSchema>;

export function loadMemoryCollectionTool(session: {
  userId: string;
}): AgentTool<typeof loadMemoryCollectionSchema> {
  return {
    name: LOAD_MEMORY_COLLECTION_TOOL,
    label: '加载记忆集合',
    description:
      '加载你判断为相关的记忆集合。一次最多 3 个。query 与刚才的检索相同。集合小则返回全部条目，集合大则只返回与 query 相关的条目。不要加载无关集合。',
    parameters: loadMemoryCollectionSchema,
    execute: async (_id, params) => {
      try {
        const payload = await loadMemoryCollections(
          session.userId,
          params.query,
          params.collectionIds,
        );
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        logger.warn('memory.load_failed', {
          userId: session.userId,
          error: errorMessage(err),
        });
        return emptyToolResult();
      }
    },
  };
}

export function memoryLoadTools(session: { userId: string }): AgentTool[] {
  return [searchMemoryCollectionsTool(session), loadMemoryCollectionTool(session)];
}
