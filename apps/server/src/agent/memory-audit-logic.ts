export const SEARCH_MEMORY_COLLECTIONS_TOOL = 'search_memory_collections';
export const LOAD_MEMORY_COLLECTION_TOOL = 'load_memory_collection';

export const MEMORY_AUDIT_TOOL_NAMES = [
  SEARCH_MEMORY_COLLECTIONS_TOOL,
  LOAD_MEMORY_COLLECTION_TOOL,
] as const;

export type MemoryAuditToolName = (typeof MEMORY_AUDIT_TOOL_NAMES)[number];

export function isMemoryAuditTool(toolName: string): toolName is MemoryAuditToolName {
  return (MEMORY_AUDIT_TOOL_NAMES as readonly string[]).includes(toolName);
}

function codePointLength(value: string): number {
  return [...value].length;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isEmptyPlainObject(value: unknown): boolean {
  const rec = asRecord(value);
  return rec !== null && Object.keys(rec).length === 0;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Tool results carry the payload on `details` and again as JSON text. Prefer details. */
function payloadOf(value: unknown): unknown {
  if (typeof value === 'string') {
    const parsed = tryParseJson(value);
    return parsed === undefined ? undefined : parsed;
  }
  const rec = asRecord(value);
  if (!rec) return value;
  if ('details' in rec && rec.details != null && !isEmptyPlainObject(rec.details)) {
    return rec.details;
  }
  if (Array.isArray(rec.content)) {
    const text = rec.content
      .map((block) => {
        const row = asRecord(block);
        return row && typeof row.text === 'string' ? row.text : '';
      })
      .join('');
    const parsed = tryParseJson(text);
    return parsed === undefined ? undefined : parsed;
  }
  return value;
}

function collectionItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const rec = asRecord(data);
  if (rec && Array.isArray(rec.collections)) return rec.collections;
  return [];
}

function readScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function projectSearchArgs(value: unknown): {
  tool: typeof SEARCH_MEMORY_COLLECTIONS_TOOL;
  queryChars: number;
} {
  const rec = asRecord(payloadOf(value));
  const query = rec && typeof rec.query === 'string' ? rec.query : '';
  return { tool: SEARCH_MEMORY_COLLECTIONS_TOOL, queryChars: codePointLength(query) };
}

function projectSearchResult(value: unknown): {
  tool: typeof SEARCH_MEMORY_COLLECTIONS_TOOL;
  count: number;
  collections: { id: string; score: number | null; descriptionChars: number }[];
} {
  const collections = [];
  for (const item of collectionItems(payloadOf(value))) {
    const rec = asRecord(item);
    if (!rec || typeof rec.id !== 'string' || rec.id.length === 0) continue;
    const description = typeof rec.description === 'string' ? rec.description : '';
    collections.push({
      id: rec.id,
      score: readScore(rec.score),
      descriptionChars: codePointLength(description),
    });
  }
  return { tool: SEARCH_MEMORY_COLLECTIONS_TOOL, count: collections.length, collections };
}

function projectLoadArgs(value: unknown): {
  tool: typeof LOAD_MEMORY_COLLECTION_TOOL;
  queryChars: number;
  collectionIds: string[];
} {
  const rec = asRecord(payloadOf(value));
  const query = rec && typeof rec.query === 'string' ? rec.query : '';
  const collectionIds = [];
  if (rec && Array.isArray(rec.collectionIds)) {
    for (const id of rec.collectionIds) {
      if (typeof id === 'string' && id.length > 0) collectionIds.push(id);
    }
  }
  return {
    tool: LOAD_MEMORY_COLLECTION_TOOL,
    queryChars: codePointLength(query),
    collectionIds,
  };
}

function projectLoadResult(value: unknown): {
  tool: typeof LOAD_MEMORY_COLLECTION_TOOL;
  count: number;
  collections: {
    id: string;
    truncated: boolean;
    entries: { id: string; bodyChars: number }[];
  }[];
} {
  const collections = [];
  for (const item of collectionItems(payloadOf(value))) {
    const rec = asRecord(item);
    if (!rec || typeof rec.id !== 'string' || rec.id.length === 0) continue;
    const entries = [];
    if (Array.isArray(rec.entries)) {
      for (const entry of rec.entries) {
        const row = asRecord(entry);
        if (!row || typeof row.id !== 'string' || row.id.length === 0) continue;
        const body = typeof row.body === 'string' ? row.body : '';
        entries.push({ id: row.id, bodyChars: codePointLength(body) });
      }
    }
    collections.push({
      id: rec.id,
      truncated: rec.truncated === true,
      entries,
    });
  }
  return { tool: LOAD_MEMORY_COLLECTION_TOOL, count: collections.length, collections };
}

/**
 * Replace memory-tool args and results with ids, scores, and lengths.
 * Other tools pass through. Call summarizeValue on the return value.
 */
export function auditMemoryToolPayload(
  toolName: string,
  value: unknown,
  kind: 'args' | 'result',
  isError = false,
): unknown {
  if (!isMemoryAuditTool(toolName)) return value;
  if (kind === 'result' && isError) return { tool: toolName, error: true };
  if (toolName === SEARCH_MEMORY_COLLECTIONS_TOOL) {
    return kind === 'args' ? projectSearchArgs(value) : projectSearchResult(value);
  }
  return kind === 'args' ? projectLoadArgs(value) : projectLoadResult(value);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEMORY_AUDIT_TOOLS = new Set([
  'search_memory_collections',
  'load_memory_collection',
  'list_memory_collections',
  'read_memory_entries',
  'read_card_feedback',
  'apply_memory_revision',
]);

const ID_KEYS = new Set([
  'id',
  'ids',
  'collectionId',
  'collectionIds',
  'intoId',
  'sourceIds',
  'entryId',
  'feedbackIds',
  'loadedIds',
  'batchFeedbackIds',
]);

const COUNT_ARRAY_KEYS = new Set([
  'collections',
  'entries',
  'feedback',
  'ids',
  'collectionIds',
  'sourceIds',
  'loadedIds',
  'feedbackIds',
]);

const COUNT_NUMBER_KEYS = new Set(['entryCount', 'feedbackCount', 'count']);

export interface MemoryToolAudit {
  tool: string;
  ids: string[];
  verdicts: string[];
  counts: number[];
  scores: Array<number | null>;
  reasonChars: number[];
  bodyChars: number[];
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function walk(value: unknown, key: string | null, audit: MemoryToolAudit, seen: Set<object>): void {
  if (Array.isArray(value)) {
    if (key && COUNT_ARRAY_KEYS.has(key)) audit.counts.push(value.length);
    for (const item of value) {
      if (typeof item === 'string') {
        if (key && ID_KEYS.has(key) && UUID_RE.test(item)) audit.ids.push(item);
        continue;
      }
      walk(item, null, audit, seen);
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [childKey, child] of Object.entries(value)) {
      walk(child, childKey, audit, seen);
    }
    return;
  }
  if (key === 'score' && (typeof value === 'number' || value === null)) {
    audit.scores.push(value);
    return;
  }
  if (typeof value === 'number' && key && COUNT_NUMBER_KEYS.has(key) && Number.isFinite(value)) {
    audit.counts.push(value);
    return;
  }
  if (typeof value !== 'string' || !key) return;
  if (ID_KEYS.has(key) && UUID_RE.test(value)) audit.ids.push(value);
  if (key === 'verdict' && (value === 'accepted' || value === 'rejected')) audit.verdicts.push(value);
  if (key === 'reason') audit.reasonChars.push([...value].length);
  if (key === 'body' || key === 'bodyPreview') audit.bodyChars.push([...value].length);
}

/** Audit projection: ids, verdicts, counts, scores, and lengths. Not reason text or bodies. */
export function projectMemoryToolAudit(tool: string, value: unknown): MemoryToolAudit {
  const audit: MemoryToolAudit = {
    tool,
    ids: [],
    verdicts: [],
    counts: [],
    scores: [],
    reasonChars: [],
    bodyChars: [],
  };
  walk(value, null, audit, new Set());
  audit.ids = unique(audit.ids);
  return audit;
}

export function auditMemoryToolValue(toolName: string, value: unknown): unknown {
  if (!MEMORY_AUDIT_TOOLS.has(toolName)) return value;
  return projectMemoryToolAudit(toolName, value);
}
