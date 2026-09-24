export const MEMORY_LOAD_ALL_MAX_ENTRIES = 12;
export const MEMORY_LOAD_ALL_MAX_CHARS = 2400;
export const MEMORY_LOAD_SEARCH_MAX_HITS = 8;
export const MEMORY_LOAD_SEARCH_MAX_CHARS = 4000;
export const MEMORY_LOAD_MAX_COLLECTIONS = 3;

const COLLECTION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Drop non-uuids and case-insensitive duplicates. Does not cap the list. */
export function keepUuidIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !COLLECTION_ID_RE.test(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function codePointLength(value: string): number {
  return [...value].length;
}

/** Small collections are returned whole, so the caller must not embed a query. */
export function memoryLoadFitsInline(active: readonly { body: string }[]): boolean {
  const bodyChars = active.reduce((sum, entry) => sum + codePointLength(entry.body), 0);
  return active.length <= MEMORY_LOAD_ALL_MAX_ENTRIES && bodyChars <= MEMORY_LOAD_ALL_MAX_CHARS;
}

export function selectMemoryLoad<T extends { body: string }>(input: {
  active: readonly T[];
  hits: readonly T[];
}): { entries: T[]; truncated: boolean } {
  if (memoryLoadFitsInline(input.active)) {
    return { entries: [...input.active], truncated: false };
  }

  const entries: T[] = [];
  let chars = 0;
  for (const hit of input.hits) {
    if (entries.length >= MEMORY_LOAD_SEARCH_MAX_HITS) break;
    const next = codePointLength(hit.body);
    if (chars + next > MEMORY_LOAD_SEARCH_MAX_CHARS) break;
    entries.push(hit);
    chars += next;
  }
  return { entries, truncated: true };
}
