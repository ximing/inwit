export const DOCUMENT_EMBEDDING_CONTENT_CHARS = 500;

export function clipChars(value: string, max: number): string {
  const chars = [...value];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, Math.max(0, max)).join('');
}

/** Vector / rerank text: title + description + first 500 chars of content. */
export function documentEmbeddingText(doc: {
  title?: string | null;
  description?: string | null;
  contentMd?: string | null;
}): string {
  const title = (doc.title ?? '').trim();
  const description = (doc.description ?? '').trim();
  const head = clipChars(doc.contentMd ?? '', DOCUMENT_EMBEDDING_CONTENT_CHARS).trim();
  return [title, description, head].filter((part) => part.length > 0).join('\n');
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function ilikeContainsPattern(query: string): string {
  return `%${escapeIlikePattern(query.trim())}%`;
}

export function orderByIds<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: T[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) ordered.push(row);
  }
  return ordered;
}

export function intersectOrdered(ids: string[], allowed: ReadonlySet<string>): string[] {
  return ids.filter((id) => allowed.has(id));
}

export function escapeMeiliValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function qdrantScopeFilter(
  userId: string,
  topicId?: string,
): { must: Array<{ key: string; match: { value: string } }> } {
  const must: Array<{ key: string; match: { value: string } }> = [
    { key: 'user_id', match: { value: userId } },
  ];
  if (topicId) must.push({ key: 'topic_id', match: { value: topicId } });
  return { must };
}

export function meiliScopeFilter(userId: string, topicId?: string): string {
  const user = `user_id = '${escapeMeiliValue(userId)}'`;
  if (!topicId) return user;
  return `${user} AND topic_id = '${escapeMeiliValue(topicId)}'`;
}

/** Run hybrid search; on throw (or forced) fall back to PG ILIKE. Never rethrows the hybrid error. */
export async function withSearchFallback<T>(
  hybrid: () => Promise<T>,
  fallback: () => Promise<T>,
  options: { forceFallback?: boolean; onFallback?: (err: unknown) => void } = {},
): Promise<T> {
  if (options.forceFallback) return fallback();
  try {
    return await hybrid();
  } catch (err) {
    options.onFallback?.(err);
    return fallback();
  }
}
