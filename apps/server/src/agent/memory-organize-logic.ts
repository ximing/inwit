import { createHash } from 'node:crypto';
import { addLocalDays, startOfLocalDay } from '../utils/date.js';

export const ORGANIZE_BATCH_MAX = 12;
export const ORGANIZE_COUNT_THRESHOLD = 12;
export const ORGANIZE_DEBOUNCE_MS = 10 * 60 * 1000;
export const ORGANIZE_SLOT_HOURS = [0, 6, 12, 18] as const;
export const ORGANIZE_DAILY_CAP = 8;

export type MemoryOrganizeTrigger = 'count' | 'slot';

export type MemoryOrganizePending = {
  runAt: Date;
  trigger: MemoryOrganizeTrigger;
};

export type MemoryOrganizePlan =
  | { action: 'skip' }
  | { action: 'enqueue'; runAt: Date; trigger: MemoryOrganizeTrigger }
  | { action: 'postpone'; runAt: Date; trigger: MemoryOrganizeTrigger };

function nextOrganizeSlot(now: Date): Date {
  const start = startOfLocalDay(now);
  for (const hour of ORGANIZE_SLOT_HOURS) {
    const slot = new Date(start.getTime());
    slot.setHours(hour, 0, 0, 0);
    if (slot.getTime() > now.getTime()) return slot;
  }
  return addLocalDays(start, 1);
}

function nextLocalMidnight(now: Date): Date {
  return addLocalDays(startOfLocalDay(now), 1);
}

function schedule(
  pending: MemoryOrganizePending | null,
  runAt: Date,
  trigger: MemoryOrganizeTrigger,
  bound: 'pull-earlier' | 'push-later',
): MemoryOrganizePlan {
  if (pending === null) return { action: 'enqueue', runAt, trigger };
  const pendingAt = pending.runAt.getTime();
  const target = runAt.getTime();
  const move = bound === 'pull-earlier' ? pendingAt > target : pendingAt < target;
  return move ? { action: 'postpone', runAt, trigger } : { action: 'skip' };
}

export function planMemoryOrganize(input: {
  unconsumed: number;
  revisionsToday: number;
  now: Date;
  running: boolean;
  pending: MemoryOrganizePending | null;
}): MemoryOrganizePlan {
  if (input.unconsumed <= 0) return { action: 'skip' };
  if (input.running) return { action: 'skip' };

  if (input.revisionsToday >= ORGANIZE_DAILY_CAP) {
    return schedule(input.pending, nextLocalMidnight(input.now), 'slot', 'push-later');
  }

  if (input.unconsumed >= ORGANIZE_COUNT_THRESHOLD) {
    const runAt = new Date(input.now.getTime() + ORGANIZE_DEBOUNCE_MS);
    return schedule(input.pending, runAt, 'count', 'pull-earlier');
  }

  if (input.pending !== null) return { action: 'skip' };
  return { action: 'enqueue', runAt: nextOrganizeSlot(input.now), trigger: 'slot' };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MEMORY_ACTIVE_COLLECTION_CAP = 24;
export const MEMORY_ACTIVE_ENTRY_CAP = 40;
export const MEMORY_ENTRY_PAGE_SIZE = 20;
export const MEMORY_BODY_PREVIEW_MAX = 80;
export const MEMORY_TITLE_MAX = 40;
export const MEMORY_DESCRIPTION_MAX = 280;
export const MEMORY_ENTRY_BODY_MAX = 500;
export const MEMORY_SUMMARY_MAX = 300;

export function memoryOrganizeBatchKey(ids: readonly string[]): string {
  return createHash('sha256').update([...ids].sort().join(',')).digest('hex');
}

export function memoryBodyPreview(body: string): string {
  const chars = [...body];
  if (chars.length <= MEMORY_BODY_PREVIEW_MAX) return body;
  return chars.slice(0, MEMORY_BODY_PREVIEW_MAX).join('');
}

/** Undefined when the processor has not locked a batch yet. Empty means locked and none. */
export function lockedMemoryOrganizeBatch(payload: object): string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, 'batchFeedbackIds')) return undefined;
  const raw = (payload as { batchFeedbackIds?: unknown }).batchFeedbackIds;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && UUID_RE.test(item)) ids.push(item);
    if (ids.length >= ORGANIZE_BATCH_MAX) break;
  }
  return ids;
}

export function memoryOrganizeTrigger(payload: { trigger?: unknown }): MemoryOrganizeTrigger | undefined {
  return payload.trigger === 'count' || payload.trigger === 'slot' ? payload.trigger : undefined;
}

/** The disabled flag blocks new inserts only. Postpone of an existing row still applies. */
export function dispatchMemoryOrganizePlan(
  enabled: boolean,
  plan: MemoryOrganizePlan,
): MemoryOrganizePlan['action'] {
  if (!enabled && plan.action === 'enqueue') return 'skip';
  return plan.action;
}

export type NormalizedCollectionOp =
  | { op: 'create'; clientId?: string; title: string; description: string }
  | { op: 'update'; id: string; title?: string; description?: string }
  | { op: 'retire'; id: string }
  | { op: 'merge'; intoId: string; sourceIds: string[] };

export type NormalizedEntryTarget =
  | { kind: 'collection'; id: string }
  | { kind: 'create'; index: number };

export type NormalizedEntryOp =
  | { op: 'add'; target: NormalizedEntryTarget; body: string }
  | { op: 'update'; id: string; body: string; collectionId?: string }
  | { op: 'retire'; id: string };

export type NormalizedMemoryRevision = {
  summary: string;
  collections: NormalizedCollectionOp[];
  entries: NormalizedEntryOp[];
};

export type NormalizeMemoryRevisionResult =
  | { ok: true; value: NormalizedMemoryRevision }
  | { ok: false; message: string };

export interface RawCollectionOp {
  op?: unknown;
  id?: unknown;
  title?: unknown;
  description?: unknown;
  intoId?: unknown;
  sourceIds?: unknown;
}

export interface RawEntryOp {
  op?: unknown;
  id?: unknown;
  collectionId?: unknown;
  body?: unknown;
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function codePoints(value: string): number {
  return [...value].length;
}

function cleanText(value: string): string {
  return value.replaceAll('\0', '').trim();
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function readText(
  value: unknown,
  label: string,
  max: number,
  required: boolean,
): { ok: true; value?: string } | { ok: false; message: string } {
  if (value === undefined) {
    return required ? fail(label + '不能为空') : { ok: true };
  }
  if (typeof value !== 'string') return fail(label + '不合法');
  const cleaned = cleanText(value);
  if (cleaned.length === 0) return fail(label + '不能为空');
  if (codePoints(cleaned) > max) return fail(`${label}超过 ${String(max)} 字`);
  return { ok: true, value: cleaned };
}

function readUuid(value: unknown, label: string): { ok: true; value: string } | { ok: false; message: string } {
  if (!isUuid(value)) return fail(label);
  return { ok: true, value };
}

export function normalizeMemoryRevision(input: {
  summary: unknown;
  collections: unknown;
  entries: unknown;
}): NormalizeMemoryRevisionResult {
  const summary = readText(input.summary, '摘要', MEMORY_SUMMARY_MAX, true);
  if (!summary.ok || summary.value === undefined) return summary.ok ? fail('摘要不能为空') : summary;
  if (!Array.isArray(input.collections) || !Array.isArray(input.entries)) {
    return fail('collections 和 entries 必须是数组');
  }
  if (input.collections.length > MEMORY_ACTIVE_COLLECTION_CAP) return fail('一次最多改 24 个集合');
  if (input.entries.length > MEMORY_ACTIVE_ENTRY_CAP) return fail('一次最多改 40 条条目');

  const collections: NormalizedCollectionOp[] = [];
  const retiredIds = new Set<string>();
  const updateIds = new Set<string>();
  const intoIds = new Set<string>();
  const createIds = new Map<string, number>();

  const claimRetired = (id: string): NormalizeMemoryRevisionResult | null => {
    if (retiredIds.has(id) || updateIds.has(id) || createIds.has(id) || intoIds.has(id)) {
      return fail('同一个集合不能在一次修订里又停用又保留');
    }
    retiredIds.add(id);
    return null;
  };

  for (const raw of input.collections as RawCollectionOp[]) {
    if (!raw || typeof raw !== 'object') return fail('集合操作不合法');
    if (raw.op === 'create') {
      if (raw.id !== undefined && !isUuid(raw.id)) return fail('create 的 id 不合法');
      const title = readText(raw.title, '标题', MEMORY_TITLE_MAX, true);
      if (!title.ok || title.value === undefined) return title.ok ? fail('标题不能为空') : title;
      const description = readText(raw.description, '描述', MEMORY_DESCRIPTION_MAX, true);
      if (!description.ok || description.value === undefined) {
        return description.ok ? fail('描述不能为空') : description;
      }
      const clientId = isUuid(raw.id) ? raw.id : undefined;
      if (clientId) {
        if (retiredIds.has(clientId) || updateIds.has(clientId) || intoIds.has(clientId) || createIds.has(clientId)) {
          return fail('create 的 id 与其他操作冲突');
        }
        createIds.set(clientId, collections.length);
      }
      collections.push({
        op: 'create',
        title: title.value,
        description: description.value,
        ...(clientId ? { clientId } : {}),
      });
      continue;
    }
    if (raw.op === 'update') {
      const id = readUuid(raw.id, 'update 必须传已有 id');
      if (!id.ok) return id;
      if (retiredIds.has(id.value) || createIds.has(id.value) || updateIds.has(id.value)) {
        return fail('同一个集合不能改两次');
      }
      updateIds.add(id.value);
      const title = readText(raw.title, '标题', MEMORY_TITLE_MAX, false);
      if (!title.ok) return title;
      const description = readText(raw.description, '描述', MEMORY_DESCRIPTION_MAX, false);
      if (!description.ok) return description;
      if (title.value === undefined && description.value === undefined) return fail('update 至少要改标题或描述');
      collections.push({
        op: 'update',
        id: id.value,
        ...(title.value !== undefined ? { title: title.value } : {}),
        ...(description.value !== undefined ? { description: description.value } : {}),
      });
      continue;
    }
    if (raw.op === 'retire') {
      const id = readUuid(raw.id, 'retire 必须传已有 id');
      if (!id.ok) return id;
      const conflict = claimRetired(id.value);
      if (conflict) return conflict;
      collections.push({ op: 'retire', id: id.value });
      continue;
    }
    if (raw.op === 'merge') {
      const into = readUuid(raw.intoId, 'merge 必须传 intoId');
      if (!into.ok) return into;
      if (retiredIds.has(into.value) || createIds.has(into.value)) {
        return fail('merge 的 intoId 不能同时被停用或新建');
      }
      if (!Array.isArray(raw.sourceIds) || raw.sourceIds.length < 1 || raw.sourceIds.length > 8) {
        return fail('merge 的 sourceIds 需要 1 到 8 个集合');
      }
      const sourceIds: string[] = [];
      const seen = new Set<string>();
      for (const source of raw.sourceIds) {
        if (!isUuid(source)) return fail('merge 的 sourceIds 不合法');
        if (source === into.value) return fail('merge 不能把 intoId 当成源集合');
        if (seen.has(source)) return fail('merge 的 sourceIds 有重复');
        seen.add(source);
        const conflict = claimRetired(source);
        if (conflict) return conflict;
        sourceIds.push(source);
      }
      intoIds.add(into.value);
      collections.push({ op: 'merge', intoId: into.value, sourceIds });
      continue;
    }
    return fail('集合操作不合法');
  }

  const creates = collections.filter((op) => op.op === 'create');
  const entries: NormalizedEntryOp[] = [];
  const entryIds = new Set<string>();
  for (const raw of input.entries as RawEntryOp[]) {
    if (!raw || typeof raw !== 'object') return fail('条目操作不合法');
    if (raw.op === 'add') {
      const body = readText(raw.body, '条目正文', MEMORY_ENTRY_BODY_MAX, true);
      if (!body.ok || body.value === undefined) return body.ok ? fail('条目正文不能为空') : body;
      if (raw.id !== undefined) return fail('add 不传 id');
      if (raw.collectionId === undefined) {
        if (creates.length !== 1) {
          return fail(creates.length === 0 ? 'add 必须传 collectionId' : '有多个新建集合时，add 必须传 collectionId');
        }
        entries.push({ op: 'add', target: { kind: 'create', index: collections.indexOf(creates[0]!) }, body: body.value });
        continue;
      }
      if (!isUuid(raw.collectionId)) return fail('add 的 collectionId 不合法');
      const createIndex = createIds.get(raw.collectionId);
      if (createIndex !== undefined) {
        entries.push({ op: 'add', target: { kind: 'create', index: createIndex }, body: body.value });
        continue;
      }
      entries.push({ op: 'add', target: { kind: 'collection', id: raw.collectionId }, body: body.value });
      continue;
    }
    if (raw.op === 'update') {
      const id = readUuid(raw.id, 'update 条目必须传 id');
      if (!id.ok) return id;
      if (entryIds.has(id.value)) return fail('同一个条目不能改两次');
      entryIds.add(id.value);
      const body = readText(raw.body, '条目正文', MEMORY_ENTRY_BODY_MAX, true);
      if (!body.ok || body.value === undefined) return body.ok ? fail('条目正文不能为空') : body;
      if (raw.collectionId !== undefined && !isUuid(raw.collectionId)) return fail('update 条目的 collectionId 不合法');
      entries.push({
        op: 'update',
        id: id.value,
        body: body.value,
        ...(isUuid(raw.collectionId) ? { collectionId: raw.collectionId } : {}),
      });
      continue;
    }
    if (raw.op === 'retire') {
      const id = readUuid(raw.id, 'retire 条目必须传 id');
      if (!id.ok) return id;
      if (entryIds.has(id.value)) return fail('同一个条目不能改两次');
      entryIds.add(id.value);
      entries.push({ op: 'retire', id: id.value });
      continue;
    }
    return fail('条目操作不合法');
  }

  return { ok: true, value: { summary: summary.value, collections, entries } };
}
