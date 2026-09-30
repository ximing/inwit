import { ANNOTATION_RESURFACE_KEY_PREFIX, TOPIC_SUGGESTION_KEY_PREFIX } from '@inwit/dto';
import type { SyncOp, SyncPollResponse, SyncScope } from '@inwit/dto';

export const SYNC_PAGE_LIMIT = 200;

/** sync_changes rows older than this are eligible for prune. */
export const SYNC_RETENTION_DAYS = 7;
export const SYNC_RETENTION_MS = SYNC_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const WEEKLY_REPORT_KIND = 'weekly_report';

const RESURFACE_KEY_RE = new RegExp(`^${ANNOTATION_RESURFACE_KEY_PREFIX}\\d{4}-\\d{2}-\\d{2}$`);

/**
 * One sync_changes row as the poller compares it.
 * id stays bigint; the DTO renders it as a decimal string.
 */
export interface SyncChange {
  id: bigint;
  scope: SyncScope;
  resourceId: string | null;
  op: SyncOp;
  at: Date;
}

/** One sync_emit call. The log id is assigned by the insert, not here. */
export interface SyncEmit {
  userId: string;
  scope: SyncScope;
  resourceId: string | null;
  op: SyncOp;
  at: Date;
}

export type RowAction = 'insert' | 'update' | 'delete';

export interface DocumentSyncImage {
  id: string;
  userId: string;
  topicId: string | null;
  mapNodeId: string | null;
  kind: string;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CardSyncImage {
  userId: string;
  documentId: string | null;
  topicId: string | null;
  updatedAt: Date;
}

export interface JobSyncImage {
  id: string;
  userId: string;
  status: string;
  payload: unknown;
  runAt: Date;
  lastError: string | null;
  finishedAt: Date | null;
  updatedAt: Date;
}

export interface MemorySyncImage {
  userId: string;
  key: string;
  updatedAt: Date;
}

/** Card row already gone. Distinct from a card whose document_id is null. */
export type CardDocumentLookup = { documentId: string | null } | null;

export type SyncRowChange =
  | { table: 'documents'; action: 'insert'; row: DocumentSyncImage }
  | { table: 'documents'; action: 'update'; old: DocumentSyncImage; row: DocumentSyncImage }
  | { table: 'documents'; action: 'delete'; old: DocumentSyncImage }
  | { table: 'cards'; action: 'insert' | 'update'; row: CardSyncImage }
  | { table: 'cards'; action: 'delete'; old: CardSyncImage }
  | {
      table: 'card_questions';
      action: RowAction;
      /** null when the card row is already gone */
      card: { userId: string; documentId: string | null } | null;
      /** clock_timestamp() the trigger uses; this table has no updated_at */
      statementAt: Date;
    }
  | {
      table: 'review_states';
      action: RowAction;
      row: { userId: string; updatedAt: Date };
      /** null when the card is gone or has no document */
      card: CardDocumentLookup;
    }
  | {
      table: 'annotations';
      action: RowAction;
      row: { userId: string; documentId: string; updatedAt: Date };
    }
  | {
      table: 'card_links';
      action: 'insert';
      userId: string;
      createdAt: Date;
      from: CardDocumentLookup;
      to: CardDocumentLookup;
    }
  | {
      table: 'card_links';
      action: 'delete';
      userId: string;
      /** clock_timestamp(); the deleted row has no updated_at */
      statementAt: Date;
      from: CardDocumentLookup;
      to: CardDocumentLookup;
    }
  | { table: 'topics'; action: 'insert' | 'update'; row: { id: string; userId: string; updatedAt: Date } }
  | { table: 'topics'; action: 'delete'; old: { id: string; userId: string; updatedAt: Date } }
  | {
      table: 'map_nodes';
      action: RowAction;
      topicId: string;
      /** null when the topic row is already gone */
      topicUserId: string | null;
      /** clock_timestamp(); map_nodes has no updated_at */
      statementAt: Date;
    }
  | { table: 'jobs'; action: 'insert'; row: JobSyncImage }
  | { table: 'jobs'; action: 'update'; old: JobSyncImage; row: JobSyncImage }
  | { table: 'jobs'; action: 'delete' }
  | { table: 'memories'; action: 'insert' | 'update'; row: MemorySyncImage }
  | { table: 'memories'; action: 'delete'; old: MemorySyncImage };

export function syncRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - SYNC_RETENTION_MS);
}

export function decideSyncPoll(input: {
  since: bigint | null;
  oldestId: bigint | null;
  newestId: bigint | null;
  rows: SyncChange[];
}): { cursor: bigint; reset: boolean; more: boolean; changes: SyncChange[] } {
  if (input.since === null) {
    return {
      cursor: input.newestId ?? 0n,
      reset: false,
      more: false,
      changes: [],
    };
  }
  // since = 0 is "read from the start", even when this user's oldest id is already > 0.
  if (input.since > 0n && input.oldestId !== null && input.since < input.oldestId) {
    return {
      cursor: input.newestId ?? input.since,
      reset: true,
      more: false,
      changes: [],
    };
  }
  const more = input.rows.length > SYNC_PAGE_LIMIT;
  const changes = more ? input.rows.slice(0, SYNC_PAGE_LIMIT) : input.rows;
  const last = changes.at(-1);
  return {
    cursor: last ? last.id : input.since,
    reset: false,
    more,
    changes,
  };
}

/**
 * Identity ids are bigint. A JS number past 2^53 is already rounded and would move the cursor.
 */
export function syncIdFromDriver(value: number | string | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('sync id is not a safe integer');
    }
    return BigInt(value);
  }
  if (!/^\d+$/.test(value)) throw new Error('sync id is not a decimal string');
  return BigInt(value);
}

export function syncChangeFromDriver(row: {
  id: number | string | bigint;
  scope: SyncScope;
  resourceId: string | null;
  op: SyncOp;
  at: Date;
}): SyncChange {
  return {
    id: syncIdFromDriver(row.id),
    scope: row.scope,
    resourceId: row.resourceId,
    op: row.op,
    at: row.at,
  };
}

export function toSyncPollResponse(result: {
  cursor: bigint;
  reset: boolean;
  more: boolean;
  changes: SyncChange[];
}): SyncPollResponse {
  return {
    cursor: result.cursor.toString(),
    reset: result.reset,
    more: result.more,
    changes: result.changes.map((change) => ({
      id: change.id.toString(),
      scope: change.scope,
      resourceId: change.resourceId,
      op: change.op,
      at: change.at.toISOString(),
    })),
  };
}

export function eventsForRow(change: SyncRowChange): SyncEmit[] {
  switch (change.table) {
    case 'documents':
      return documentEvents(change);
    case 'cards':
      return cardEvents(change.action === 'delete' ? change.old : change.row);
    case 'card_questions':
      return cardQuestionEvents(change.card, change.statementAt);
    case 'review_states':
      return reviewStateEvents(change.row, change.card);
    case 'annotations':
      return [
        emit(change.row.userId, 'document', change.row.documentId, 'upsert', change.row.updatedAt),
      ];
    case 'card_links':
      return cardLinkEvents(
        change.userId,
        change.action === 'insert' ? change.createdAt : change.statementAt,
        change.from,
        change.to,
      );
    case 'topics':
      return topicEvents(change.action === 'delete' ? change.old : change.row, change.action === 'delete' ? 'delete' : 'upsert');
    case 'map_nodes':
      return mapNodeEvents(change.topicId, change.topicUserId, change.statementAt);
    case 'jobs':
      return jobEvents(change);
    case 'memories':
      return memoryEvents(change.action === 'delete' ? change.old : change.row);
    default:
      return assertNever(change);
  }
}

function documentEvents(
  change: Extract<SyncRowChange, { table: 'documents' }>,
): SyncEmit[] {
  if (change.action === 'delete') {
    const row = change.old;
    return [
      emit(row.userId, 'document', row.id, 'delete', row.updatedAt),
      ...topicFanout(row.userId, row.topicId, row.updatedAt),
    ];
  }
  const row = change.row;
  const old = change.action === 'update' ? change.old : null;
  const events: SyncEmit[] = [
    emit(row.userId, 'document', row.id, documentOp(change.action, old, row), row.updatedAt),
  ];
  if (row.kind === WEEKLY_REPORT_KIND && (old === null || old.kind !== WEEKLY_REPORT_KIND)) {
    events.push(emit(row.userId, 'report', null, 'upsert', row.updatedAt));
  }
  if (old === null) {
    events.push(...topicFanout(row.userId, row.topicId, row.updatedAt));
  } else if (old.topicId !== row.topicId) {
    events.push(...topicFanout(row.userId, old.topicId, row.updatedAt));
    events.push(...topicFanout(row.userId, row.topicId, row.updatedAt));
  } else if (membershipChanged(old, row)) {
    events.push(...topicFanout(row.userId, row.topicId, row.updatedAt));
  }
  return events;
}

/** Soft-delete, restore, or a map-node move keeps the same topic id, but that topic's counts change. */
function membershipChanged(old: DocumentSyncImage, row: DocumentSyncImage): boolean {
  const deletedAtChanged = (old.deletedAt == null) !== (row.deletedAt == null);
  return deletedAtChanged || old.mapNodeId !== row.mapNodeId;
}

function documentOp(
  action: 'insert' | 'update',
  old: DocumentSyncImage | null,
  row: DocumentSyncImage,
): SyncOp {
  const wasVisible = action === 'insert' || old?.deletedAt == null;
  if (row.deletedAt != null && wasVisible) return 'delete';
  return 'upsert';
}

function topicFanout(userId: string, topicId: string | null, at: Date): SyncEmit[] {
  if (topicId === null) return [];
  return [
    emit(userId, 'topic', topicId, 'upsert', at),
    emit(userId, 'map', topicId, 'upsert', at),
  ];
}

function cardEvents(row: CardSyncImage): SyncEmit[] {
  const events: SyncEmit[] = [];
  if (row.documentId !== null) {
    events.push(emit(row.userId, 'document', row.documentId, 'upsert', row.updatedAt));
  }
  events.push(emit(row.userId, 'review', null, 'upsert', row.updatedAt));
  if (row.topicId !== null) {
    events.push(emit(row.userId, 'topic', row.topicId, 'upsert', row.updatedAt));
    events.push(emit(row.userId, 'map', row.topicId, 'upsert', row.updatedAt));
  }
  return events;
}

function cardQuestionEvents(
  card: { userId: string; documentId: string | null } | null,
  statementAt: Date,
): SyncEmit[] {
  if (!card || card.documentId === null) return [];
  return [emit(card.userId, 'document', card.documentId, 'upsert', statementAt)];
}

function reviewStateEvents(
  row: { userId: string; updatedAt: Date },
  card: CardDocumentLookup,
): SyncEmit[] {
  const events: SyncEmit[] = [emit(row.userId, 'review', null, 'upsert', row.updatedAt)];
  if (card?.documentId) {
    events.push(emit(row.userId, 'document', card.documentId, 'upsert', row.updatedAt));
  }
  return events;
}

function cardLinkEvents(
  userId: string,
  at: Date,
  from: CardDocumentLookup,
  to: CardDocumentLookup,
): SyncEmit[] {
  const ids: string[] = [];
  for (const lookup of [from, to]) {
    if (!lookup || lookup.documentId === null) continue;
    if (!ids.includes(lookup.documentId)) ids.push(lookup.documentId);
  }
  return ids.map((documentId) => emit(userId, 'document', documentId, 'upsert', at));
}

function topicEvents(
  row: { id: string; userId: string; updatedAt: Date },
  op: SyncOp,
): SyncEmit[] {
  return [
    emit(row.userId, 'topic', row.id, op, row.updatedAt),
    emit(row.userId, 'map', row.id, op, row.updatedAt),
  ];
}

function mapNodeEvents(topicId: string, topicUserId: string | null, statementAt: Date): SyncEmit[] {
  if (topicUserId === null) return [];
  return [emit(topicUserId, 'map', topicId, 'upsert', statementAt)];
}

function jobEvents(change: Extract<SyncRowChange, { table: 'jobs' }>): SyncEmit[] {
  if (change.action === 'delete') return [];
  if (change.action === 'update' && !jobVisibleChanged(change.old, change.row)) return [];
  const row = change.row;
  return [emit(row.userId, 'job', row.id, 'upsert', row.updatedAt)];
}

function jobVisibleChanged(old: JobSyncImage, row: JobSyncImage): boolean {
  return (
    old.status !== row.status ||
    JSON.stringify(old.payload) !== JSON.stringify(row.payload) ||
    old.runAt.getTime() !== row.runAt.getTime() ||
    old.lastError !== row.lastError ||
    (old.finishedAt?.getTime() ?? null) !== (row.finishedAt?.getTime() ?? null)
  );
}

function memoryEvents(row: MemorySyncImage): SyncEmit[] {
  if (row.key.startsWith(TOPIC_SUGGESTION_KEY_PREFIX)) {
    return [emit(row.userId, 'suggest', null, 'upsert', row.updatedAt)];
  }
  if (RESURFACE_KEY_RE.test(row.key)) {
    return [emit(row.userId, 'resurface', null, 'upsert', row.updatedAt)];
  }
  return [];
}

function emit(
  userId: string,
  scope: SyncScope,
  resourceId: string | null,
  op: SyncOp,
  at: Date,
): SyncEmit {
  return { userId, scope, resourceId, op, at };
}

function assertNever(value: never): never {
  throw new Error(`unexpected sync row change: ${JSON.stringify(value)}`);
}
