import {
  ANNOTATION_RESURFACE_KEY_PREFIX,
  TOPIC_SUGGESTION_KEY_PREFIX,
  syncPollResponseSchema,
} from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  SYNC_PAGE_LIMIT,
  SYNC_RETENTION_MS,
  decideSyncPoll,
  eventsForRow,
  syncChangeFromDriver,
  syncIdFromDriver,
  syncRetentionCutoff,
  toSyncPollResponse,
  type CardSyncImage,
  type DocumentSyncImage,
  type JobSyncImage,
  type SyncChange,
  type SyncEmit,
} from './sync-logic.js';

const USER = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const DOC_B = '33333333-3333-4333-8333-333333333333';
const TOPIC_A = '44444444-4444-4444-8444-444444444444';
const TOPIC_B = '55555555-5555-4555-8555-555555555555';
const NODE = '77777777-7777-4777-8777-777777777777';
const JOB = '66666666-6666-4666-8666-666666666666';
const AT = new Date('2026-09-30T08:00:00.000Z');
const AT_OLD = new Date('2026-09-29T08:00:00.000Z');
const STATEMENT_AT = new Date('2026-09-30T08:00:01.000Z');

function change(id: bigint, scope: SyncChange['scope'] = 'document'): SyncChange {
  return { id, scope, resourceId: null, op: 'upsert', at: AT };
}

function doc(overrides: Partial<DocumentSyncImage> = {}): DocumentSyncImage {
  return {
    id: DOC,
    userId: USER,
    topicId: null,
    mapNodeId: null,
    kind: 'document',
    updatedAt: AT,
    deletedAt: null,
    ...overrides,
  };
}

function card(overrides: Partial<CardSyncImage> = {}): CardSyncImage {
  return {
    userId: USER,
    documentId: DOC,
    topicId: null,
    updatedAt: AT,
    ...overrides,
  };
}

function job(overrides: Partial<JobSyncImage> = {}): JobSyncImage {
  return {
    id: JOB,
    userId: USER,
    status: 'running',
    payload: { documentId: DOC, donePages: 1 },
    runAt: AT_OLD,
    lastError: null,
    finishedAt: null,
    updatedAt: AT,
    ...overrides,
  };
}

function emit(
  scope: SyncEmit['scope'],
  resourceId: string | null,
  op: SyncEmit['op'],
  at: Date = AT,
  userId: string = USER,
): SyncEmit {
  return { userId, scope, resourceId, op, at };
}

describe('decideSyncPoll', () => {
  it('handshake returns the newest cursor and no changes', () => {
    const result = decideSyncPoll({
      since: null,
      oldestId: 4n,
      newestId: 9n,
      rows: [change(10n)],
    });
    expect(result).toEqual({ cursor: 9n, reset: false, more: false, changes: [] });
  });

  it('handshake with no rows yields cursor 0', () => {
    expect(
      decideSyncPoll({ since: null, oldestId: null, newestId: null, rows: [] }),
    ).toEqual({ cursor: 0n, reset: false, more: false, changes: [] });
  });

  it('returns an empty delta without moving the cursor', () => {
    expect(
      decideSyncPoll({ since: 9n, oldestId: 1n, newestId: 9n, rows: [] }),
    ).toEqual({ cursor: 9n, reset: false, more: false, changes: [] });
  });

  it('sets more and drops the 201st row', () => {
    const rows = Array.from({ length: SYNC_PAGE_LIMIT + 1 }, (_, index) => change(BigInt(index + 1)));
    const result = decideSyncPoll({ since: 0n, oldestId: 1n, newestId: 201n, rows });
    expect(result.more).toBe(true);
    expect(result.reset).toBe(false);
    expect(result.changes).toHaveLength(SYNC_PAGE_LIMIT);
    expect(result.cursor).toBe(BigInt(SYNC_PAGE_LIMIT));
    expect(result.changes.at(-1)?.id).toBe(200n);
    expect(result.changes.some((row) => row.id === 201n)).toBe(false);
  });

  it('resets when since > 0 has fallen behind this user oldest id', () => {
    const result = decideSyncPoll({
      since: 5n,
      oldestId: 10n,
      newestId: 40n,
      rows: [change(11n)],
    });
    expect(result).toEqual({ cursor: 40n, reset: true, more: false, changes: [] });
  });

  it('uses since as the reset cursor when this user has no newest id', () => {
    expect(
      decideSyncPoll({ since: 5n, oldestId: 10n, newestId: null, rows: [] }).cursor,
    ).toBe(5n);
  });

  it('does not reset a gap that is still at or after this user oldest id', () => {
    const rows = [change(16n), change(18n)];
    const result = decideSyncPoll({ since: 12n, oldestId: 10n, newestId: 50n, rows });
    expect(result).toEqual({ cursor: 18n, reset: false, more: false, changes: rows });
  });

  it('does not reset since 0 when oldestId is already greater than 0', () => {
    const rows = [change(8n), change(9n)];
    const result = decideSyncPoll({ since: 0n, oldestId: 8n, newestId: 9n, rows });
    expect(result).toEqual({ cursor: 9n, reset: false, more: false, changes: rows });
  });

  it('does not coalesce scopes', () => {
    const rows = [change(2n, 'document'), change(3n, 'document'), change(4n, 'review')];
    const result = decideSyncPoll({ since: 1n, oldestId: 1n, newestId: 4n, rows });
    expect(result.changes).toEqual(rows);
  });
});

describe('syncRetentionCutoff', () => {
  it('is exactly 7 days before now', () => {
    const now = new Date('2026-09-30T12:00:00.000Z');
    expect(syncRetentionCutoff(now).toISOString()).toBe('2026-09-23T12:00:00.000Z');
    expect(now.getTime() - syncRetentionCutoff(now).getTime()).toBe(SYNC_RETENTION_MS);
    expect(SYNC_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('sync poll dto', () => {
  it('renders driver ids as decimal strings and at as ISO', () => {
    const big = '9007199254740993';
    const row = syncChangeFromDriver({
      id: big,
      scope: 'job',
      resourceId: DOC,
      op: 'delete',
      at: AT,
    });
    expect(row.id).toBe(BigInt(big));
    const response = toSyncPollResponse(
      decideSyncPoll({ since: 0n, oldestId: null, newestId: null, rows: [row] }),
    );
    expect(syncPollResponseSchema.parse(response)).toEqual({
      cursor: big,
      reset: false,
      more: false,
      changes: [
        {
          id: big,
          scope: 'job',
          resourceId: DOC,
          op: 'delete',
          at: '2026-09-30T08:00:00.000Z',
        },
      ],
    });
  });

  it('rejects a number id past the safe integer range', () => {
    expect(() => syncIdFromDriver(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
    expect(syncIdFromDriver(Number.MAX_SAFE_INTEGER)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(syncIdFromDriver(12)).toBe(12n);
    expect(syncIdFromDriver('0')).toBe(0n);
  });

  it('renders a handshake cursor of 0', () => {
    expect(
      toSyncPollResponse(decideSyncPoll({ since: null, oldestId: null, newestId: null, rows: [] })),
    ).toEqual({ cursor: '0', reset: false, more: false, changes: [] });
  });
});

describe('eventsForRow', () => {
  describe('documents', () => {
    it('insert emits a document upsert', () => {
      expect(eventsForRow({ table: 'documents', action: 'insert', row: doc() })).toEqual([
        emit('document', DOC, 'upsert'),
      ]);
    });

    it('insert with a topic also emits topic and map upserts', () => {
      expect(
        eventsForRow({ table: 'documents', action: 'insert', row: doc({ topicId: TOPIC_A }) }),
      ).toEqual([
        emit('document', DOC, 'upsert'),
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
      ]);
    });

    it('insert of a weekly report also emits report', () => {
      expect(
        eventsForRow({
          table: 'documents',
          action: 'insert',
          row: doc({ kind: 'weekly_report', topicId: TOPIC_A }),
        }),
      ).toEqual([
        emit('document', DOC, 'upsert'),
        emit('report', null, 'upsert'),
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
      ]);
    });

    it('update emits a document upsert and ignores an unchanged topic', () => {
      const row = doc({ topicId: TOPIC_A });
      expect(
        eventsForRow({ table: 'documents', action: 'update', old: row, row }),
      ).toEqual([emit('document', DOC, 'upsert')]);
    });

    it('soft-delete transition emits document delete', () => {
      expect(
        eventsForRow({
          table: 'documents',
          action: 'update',
          old: doc(),
          row: doc({ deletedAt: AT }),
        }),
      ).toEqual([emit('document', DOC, 'delete')]);
    });

    it('fans out the current topic when visibility or map placement changes', () => {
      const topicMap = [emit('topic', TOPIC_A, 'upsert'), emit('map', TOPIC_A, 'upsert')];
      const cases: { name: string; old: DocumentSyncImage; row: DocumentSyncImage; events: SyncEmit[] }[] = [
        {
          name: 'soft-delete',
          old: doc({ topicId: TOPIC_A, mapNodeId: NODE }),
          row: doc({ topicId: TOPIC_A, mapNodeId: NODE, deletedAt: AT }),
          events: [emit('document', DOC, 'delete'), ...topicMap],
        },
        {
          name: 'restore',
          old: doc({ topicId: TOPIC_A, deletedAt: AT_OLD }),
          row: doc({ topicId: TOPIC_A, deletedAt: null }),
          events: [emit('document', DOC, 'upsert'), ...topicMap],
        },
        {
          name: 'map node attach',
          old: doc({ topicId: TOPIC_A }),
          row: doc({ topicId: TOPIC_A, mapNodeId: NODE }),
          events: [emit('document', DOC, 'upsert'), ...topicMap],
        },
        {
          name: 'map node clear',
          old: doc({ topicId: TOPIC_A, mapNodeId: NODE }),
          row: doc({ topicId: TOPIC_A, mapNodeId: null }),
          events: [emit('document', DOC, 'upsert'), ...topicMap],
        },
        {
          name: 'soft-delete without a topic',
          old: doc({ mapNodeId: NODE }),
          row: doc({ mapNodeId: NODE, deletedAt: AT }),
          events: [emit('document', DOC, 'delete')],
        },
        {
          name: 'map node change without a topic',
          old: doc(),
          row: doc({ mapNodeId: NODE }),
          events: [emit('document', DOC, 'upsert')],
        },
        {
          name: 'staying deleted does not fan out',
          old: doc({ topicId: TOPIC_A, deletedAt: AT_OLD }),
          row: doc({ topicId: TOPIC_A, deletedAt: AT }),
          events: [emit('document', DOC, 'upsert')],
        },
      ];
      for (const testCase of cases) {
        expect(
          eventsForRow({ table: 'documents', action: 'update', old: testCase.old, row: testCase.row }),
          testCase.name,
        ).toEqual(testCase.events);
      }
    });

    it('clearing deleted_at emits document upsert', () => {
      expect(
        eventsForRow({
          table: 'documents',
          action: 'update',
          old: doc({ deletedAt: AT_OLD }),
          row: doc({ deletedAt: null }),
        }),
      ).toEqual([emit('document', DOC, 'upsert')]);
    });

    it('an update that stays deleted is still an upsert', () => {
      expect(
        eventsForRow({
          table: 'documents',
          action: 'update',
          old: doc({ deletedAt: AT_OLD }),
          row: doc({ deletedAt: AT }),
        }),
      ).toEqual([emit('document', DOC, 'upsert')]);
    });

    it('emits report only when kind becomes weekly_report', () => {
      expect(
        eventsForRow({
          table: 'documents',
          action: 'update',
          old: doc(),
          row: doc({ kind: 'weekly_report' }),
        }),
      ).toEqual([emit('document', DOC, 'upsert'), emit('report', null, 'upsert')]);
      const report = doc({ kind: 'weekly_report' });
      expect(eventsForRow({ table: 'documents', action: 'update', old: report, row: report })).toEqual([
        emit('document', DOC, 'upsert'),
      ]);
    });

    it('topic change emits topic and map for the old and new ids, skipping null', () => {
      expect(
        eventsForRow({
          table: 'documents',
          action: 'update',
          old: doc({ topicId: TOPIC_A, updatedAt: AT_OLD }),
          row: doc({ topicId: TOPIC_B, updatedAt: AT }),
        }),
      ).toEqual([
        emit('document', DOC, 'upsert'),
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
        emit('topic', TOPIC_B, 'upsert'),
        emit('map', TOPIC_B, 'upsert'),
      ]);
      expect(
        eventsForRow({
          table: 'documents',
          action: 'update',
          old: doc({ topicId: TOPIC_A }),
          row: doc({ topicId: null }),
        }),
      ).toEqual([
        emit('document', DOC, 'upsert'),
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
      ]);
    });

    it('delete emits document delete and topic/map upserts for the old topic', () => {
      expect(
        eventsForRow({
          table: 'documents',
          action: 'delete',
          old: doc({ topicId: TOPIC_A, kind: 'weekly_report' }),
        }),
      ).toEqual([
        emit('document', DOC, 'delete'),
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
      ]);
    });
  });

  describe('cards', () => {
    it('insert with a document and topic emits document, review, topic, and map upserts', () => {
      expect(
        eventsForRow({
          table: 'cards',
          action: 'insert',
          row: card({ topicId: TOPIC_A }),
        }),
      ).toEqual([
        emit('document', DOC, 'upsert'),
        emit('review', null, 'upsert'),
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
      ]);
    });

    it('insert without a document or topic emits only review', () => {
      expect(
        eventsForRow({
          table: 'cards',
          action: 'insert',
          row: card({ documentId: null, topicId: null }),
        }),
      ).toEqual([emit('review', null, 'upsert')]);
    });

    it('update uses the new row and still upserts', () => {
      expect(
        eventsForRow({ table: 'cards', action: 'update', row: card({ documentId: DOC_B }) }),
      ).toEqual([emit('document', DOC_B, 'upsert'), emit('review', null, 'upsert')]);
    });

    it('delete upserts the document and review instead of deleting the document', () => {
      expect(
        eventsForRow({
          table: 'cards',
          action: 'delete',
          old: card({ topicId: TOPIC_A }),
        }),
      ).toEqual([
        emit('document', DOC, 'upsert'),
        emit('review', null, 'upsert'),
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
      ]);
    });
  });

  describe('card_questions', () => {
    it('emits a document upsert from the card lookup and not review', () => {
      expect(
        eventsForRow({
          table: 'card_questions',
          action: 'insert',
          card: { userId: USER, documentId: DOC },
          statementAt: STATEMENT_AT,
        }),
      ).toEqual([emit('document', DOC, 'upsert', STATEMENT_AT)]);
    });

    it('emits nothing when the card has no document', () => {
      expect(
        eventsForRow({
          table: 'card_questions',
          action: 'update',
          card: { userId: USER, documentId: null },
          statementAt: STATEMENT_AT,
        }),
      ).toEqual([]);
    });

    it('emits nothing when the card lookup is null', () => {
      expect(
        eventsForRow({
          table: 'card_questions',
          action: 'delete',
          card: null,
          statementAt: STATEMENT_AT,
        }),
      ).toEqual([]);
    });
  });

  describe('review_states', () => {
    it('emits review and the card document', () => {
      expect(
        eventsForRow({
          table: 'review_states',
          action: 'insert',
          row: { userId: USER, updatedAt: AT },
          card: { documentId: DOC },
        }),
      ).toEqual([emit('review', null, 'upsert'), emit('document', DOC, 'upsert')]);
    });

    it('emits only review when the card has no document or the lookup is null', () => {
      const row = { userId: USER, updatedAt: AT };
      expect(
        eventsForRow({ table: 'review_states', action: 'update', row, card: { documentId: null } }),
      ).toEqual([emit('review', null, 'upsert')]);
      expect(
        eventsForRow({ table: 'review_states', action: 'delete', row, card: null }),
      ).toEqual([emit('review', null, 'upsert')]);
    });
  });

  describe('annotations', () => {
    it('emits a document upsert for insert, update, and delete', () => {
      for (const action of ['insert', 'update', 'delete'] as const) {
        expect(
          eventsForRow({
            table: 'annotations',
            action,
            row: { userId: USER, documentId: DOC, updatedAt: AT },
          }),
        ).toEqual([emit('document', DOC, 'upsert')]);
      }
    });
  });

  describe('card_links', () => {
    it('emits both documents, dedupes the same document, and uses created_at on insert', () => {
      expect(
        eventsForRow({
          table: 'card_links',
          action: 'insert',
          userId: USER,
          createdAt: AT,
          from: { documentId: DOC },
          to: { documentId: DOC_B },
        }),
      ).toEqual([emit('document', DOC, 'upsert'), emit('document', DOC_B, 'upsert')]);
      expect(
        eventsForRow({
          table: 'card_links',
          action: 'insert',
          userId: USER,
          createdAt: AT,
          from: { documentId: DOC },
          to: { documentId: DOC },
        }),
      ).toEqual([emit('document', DOC, 'upsert')]);
    });

    it('emits nothing when both documents are null or both lookups are null', () => {
      expect(
        eventsForRow({
          table: 'card_links',
          action: 'insert',
          userId: USER,
          createdAt: AT,
          from: { documentId: null },
          to: { documentId: null },
        }),
      ).toEqual([]);
      expect(
        eventsForRow({
          table: 'card_links',
          action: 'delete',
          userId: USER,
          statementAt: STATEMENT_AT,
          from: null,
          to: null,
        }),
      ).toEqual([]);
    });

    it('skips a null lookup or null document and uses statement time on delete', () => {
      expect(
        eventsForRow({
          table: 'card_links',
          action: 'delete',
          userId: USER,
          statementAt: STATEMENT_AT,
          from: null,
          to: { documentId: DOC_B },
        }),
      ).toEqual([emit('document', DOC_B, 'upsert', STATEMENT_AT)]);
      expect(
        eventsForRow({
          table: 'card_links',
          action: 'delete',
          userId: USER,
          statementAt: STATEMENT_AT,
          from: { documentId: DOC },
          to: { documentId: null },
        }),
      ).toEqual([emit('document', DOC, 'upsert', STATEMENT_AT)]);
    });
  });

  describe('topics', () => {
    const row = { id: TOPIC_A, userId: USER, updatedAt: AT };

    it('insert and update emit topic and map upserts', () => {
      expect(eventsForRow({ table: 'topics', action: 'insert', row })).toEqual([
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
      ]);
      expect(eventsForRow({ table: 'topics', action: 'update', row })).toEqual([
        emit('topic', TOPIC_A, 'upsert'),
        emit('map', TOPIC_A, 'upsert'),
      ]);
    });

    it('delete emits topic and map deletes', () => {
      expect(eventsForRow({ table: 'topics', action: 'delete', old: row })).toEqual([
        emit('topic', TOPIC_A, 'delete'),
        emit('map', TOPIC_A, 'delete'),
      ]);
    });
  });

  describe('map_nodes', () => {
    it('emits a map upsert using the topic user and statement time', () => {
      expect(
        eventsForRow({
          table: 'map_nodes',
          action: 'insert',
          topicId: TOPIC_A,
          topicUserId: USER,
          statementAt: STATEMENT_AT,
        }),
      ).toEqual([emit('map', TOPIC_A, 'upsert', STATEMENT_AT)]);
    });

    it('emits nothing when the topic row is already gone, including on delete', () => {
      expect(
        eventsForRow({
          table: 'map_nodes',
          action: 'delete',
          topicId: TOPIC_A,
          topicUserId: null,
          statementAt: STATEMENT_AT,
        }),
      ).toEqual([]);
    });

    it('delete still upserts the map when the topic remains', () => {
      expect(
        eventsForRow({
          table: 'map_nodes',
          action: 'update',
          topicId: TOPIC_A,
          topicUserId: USER,
          statementAt: STATEMENT_AT,
        }),
      ).toEqual([emit('map', TOPIC_A, 'upsert', STATEMENT_AT)]);
      expect(
        eventsForRow({
          table: 'map_nodes',
          action: 'delete',
          topicId: TOPIC_A,
          topicUserId: USER,
          statementAt: STATEMENT_AT,
        }),
      ).toEqual([emit('map', TOPIC_A, 'upsert', STATEMENT_AT)]);
    });
  });

  describe('jobs', () => {
    it('insert emits a job upsert', () => {
      expect(eventsForRow({ table: 'jobs', action: 'insert', row: job() })).toEqual([
        emit('job', JOB, 'upsert'),
      ]);
    });

    it('emits when status, payload, runAt, lastError, or finishedAt changes', () => {
      const before = job({ updatedAt: AT_OLD });
      const cases = [
        job({ status: 'done' }),
        job({ payload: { documentId: DOC, donePages: 2 } }),
        job({ runAt: AT }),
        job({ lastError: 'boom' }),
        job({ finishedAt: AT }),
      ];
      for (const row of cases) {
        expect(eventsForRow({ table: 'jobs', action: 'update', old: before, row })).toEqual([
          emit('job', JOB, 'upsert'),
        ]);
      }
    });

    it('ignores a heartbeat that only changes updatedAt', () => {
      const before = job({ updatedAt: AT_OLD });
      expect(
        eventsForRow({ table: 'jobs', action: 'update', old: before, row: job({ updatedAt: AT }) }),
      ).toEqual([]);
    });

    it('ignores delete', () => {
      expect(eventsForRow({ table: 'jobs', action: 'delete' })).toEqual([]);
    });
  });

  describe('memories', () => {
    it('emits suggest for the topic suggestion prefix', () => {
      expect(
        eventsForRow({
          table: 'memories',
          action: 'insert',
          row: { userId: USER, key: `${TOPIC_SUGGESTION_KEY_PREFIX}rl-notes`, updatedAt: AT },
        }),
      ).toEqual([emit('suggest', null, 'upsert')]);
      expect(TOPIC_SUGGESTION_KEY_PREFIX).toBe('topic_suggestion_');
    });

    it('emits resurface for annotation_resurface_YYYY-MM-DD', () => {
      expect(
        eventsForRow({
          table: 'memories',
          action: 'update',
          row: {
            userId: USER,
            key: `${ANNOTATION_RESURFACE_KEY_PREFIX}2026-09-30`,
            updatedAt: AT,
          },
        }),
      ).toEqual([emit('resurface', null, 'upsert')]);
    });

    it('ignores other keys, including memory organize and a malformed resurface key', () => {
      const keys = [
        'weekly_report:2026-09-28',
        'memory_organize',
        'profile',
        `${ANNOTATION_RESURFACE_KEY_PREFIX}2026-9-30`,
        `${ANNOTATION_RESURFACE_KEY_PREFIX}2026-09-30-extra`,
        'Topic_suggestion_nope',
      ];
      for (const key of keys) {
        expect(
          eventsForRow({
            table: 'memories',
            action: 'insert',
            row: { userId: USER, key, updatedAt: AT },
          }),
        ).toEqual([]);
      }
    });

    it('delete of a suggestion key is still an upsert', () => {
      expect(
        eventsForRow({
          table: 'memories',
          action: 'delete',
          old: { userId: USER, key: TOPIC_SUGGESTION_KEY_PREFIX, updatedAt: AT },
        }),
      ).toEqual([emit('suggest', null, 'upsert')]);
    });
  });
});
