export function collectionEmbeddingText(title: string, description: string): string {
  return `${title.trim()}\n${description.trim()}`;
}

export function entryEmbeddingText(collectionTitle: string, body: string): string {
  return `${collectionTitle.trim()}\n${body.trim()}`;
}

export function memoryCollectionsStoreName(): string {
  return process.env.NODE_ENV === 'production'
    ? 'inwit_memory_collections_prod'
    : 'inwit_memory_collections_dev';
}

export function memoryEntriesStoreName(): string {
  return process.env.NODE_ENV === 'production'
    ? 'inwit_memory_entries_prod'
    : 'inwit_memory_entries_dev';
}

export const MEMORY_INDEX_REPAIR_LIMIT = 20;
export const MEMORY_INDEX_STALE_MS = 15 * 60 * 1000;

export function isMemoryIndexStale(
  updatedAt: Date,
  now: Date,
  staleMs = MEMORY_INDEX_STALE_MS,
): boolean {
  return updatedAt.getTime() < now.getTime() - staleMs;
}

type DirtyStamp = { updatedAt: Date };

/** Oldest dirty collections and entries, at most `limit` together. */
export function selectDirtyIndexBatch<C extends DirtyStamp, E extends DirtyStamp>(
  collections: readonly C[],
  entries: readonly E[],
  limit = MEMORY_INDEX_REPAIR_LIMIT,
): Array<{ kind: 'collection'; row: C } | { kind: 'entry'; row: E }> {
  const mixed: Array<
    { kind: 'collection'; row: C; at: number } | { kind: 'entry'; row: E; at: number }
  > = [
    ...collections.map((row) => ({ kind: 'collection' as const, row, at: row.updatedAt.getTime() })),
    ...entries.map((row) => ({ kind: 'entry' as const, row, at: row.updatedAt.getTime() })),
  ];
  mixed.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'collection' ? -1 : 1));
  return mixed.slice(0, Math.max(0, limit)).map((item) =>
    item.kind === 'collection'
      ? { kind: 'collection' as const, row: item.row }
      : { kind: 'entry' as const, row: item.row },
  );
}
