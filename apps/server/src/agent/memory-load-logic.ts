export const MEMORY_LOAD_ALL_MAX_ENTRIES = 12;
export const MEMORY_LOAD_ALL_MAX_CHARS = 2400;
export const MEMORY_LOAD_SEARCH_MAX_HITS = 8;
export const MEMORY_LOAD_SEARCH_MAX_CHARS = 4000;

function codePointLength(value: string): number {
  return [...value].length;
}

export function selectMemoryLoad<T extends { body: string }>(input: {
  active: readonly T[];
  hits: readonly T[];
}): { entries: T[]; truncated: boolean } {
  const bodyChars = input.active.reduce((sum, entry) => sum + codePointLength(entry.body), 0);
  if (
    input.active.length <= MEMORY_LOAD_ALL_MAX_ENTRIES &&
    bodyChars <= MEMORY_LOAD_ALL_MAX_CHARS
  ) {
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
