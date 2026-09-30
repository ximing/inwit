import type { SyncChange } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  classifyRemoteDetail,
  coalesceChanges,
  nextPollDelayMs,
  planDroppedDocumentReplay,
  planReloads,
  reviewReloadMode,
  stripEchoes,
  type EchoStamp,
  type ReloadIntent,
  type SyncView,
} from './sync-plan';

const DOC = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOPIC = '33333333-3333-4333-8333-333333333333';
const TOPIC_B = '44444444-4444-4444-8444-444444444444';
const JOB = '55555555-5555-4555-8555-555555555555';

const T1 = '2026-09-30T00:00:01.000Z';
const T2 = '2026-09-30T00:00:02.000Z';
const T2_OFFSET = '2026-09-30T08:00:02.000+08:00';

function change(partial: Partial<SyncChange> & Pick<SyncChange, 'id'>): SyncChange {
  return {
    scope: 'document',
    resourceId: DOC,
    op: 'upsert',
    at: T1,
    ...partial,
  };
}

function view(overrides: Partial<Omit<SyncView, 'editor'>> & { editor?: SyncView['editor'] | null } = {}): SyncView {
  const { editor: editorOverride, ...rest } = overrides;
  const editor =
    editorOverride === undefined
      ? {
          id: DOC,
          updatedAt: T2,
          bodyDirty: false,
          titleDirty: false,
          saveInflight: false,
        }
      : editorOverride;
  return {
    documents: [{ id: DOC, updatedAt: T2 }],
    openDocumentId: DOC,
    listIncludesHead: true,
    topics: [],
    openTopicId: null,
    mapTopicId: null,
    readerDocumentId: null,
    readerActiveCardId: null,
    reviewInSession: false,
    jobs: [],
    activeJobId: null,
    ...rest,
    editor,
  };
}

/** Echoes come off before rows with the same resource collapse. */
function plan(changes: SyncChange[], echoes: EchoStamp[], current: SyncView): ReloadIntent[] {
  return planReloads(coalesceChanges(stripEchoes(changes, echoes)), current);
}

describe('stripEchoes', () => {
  it('removes one matching upsert and leaves a second row and any delete', () => {
    const echo: EchoStamp = { scope: 'document', resourceId: DOC, atMs: Date.parse(T2) };
    const first = change({ id: '1', at: T2 });
    const second = change({ id: '2', at: T2_OFFSET });
    const deleted = change({ id: '3', at: T2, op: 'delete' });
    expect(Date.parse(T2)).toBe(Date.parse(T2_OFFSET));
    expect(stripEchoes([first, second, deleted], [echo])).toEqual([second, deleted]);
  });

  it('does not remove a row whose millisecond differs', () => {
    const echo: EchoStamp = { scope: 'document', resourceId: DOC, atMs: Date.parse(T2) };
    const older = change({ id: '1', at: T1 });
    expect(stripEchoes([older], [echo])).toEqual([older]);
  });
});

describe('coalesceChanges', () => {
  it('keeps the greatest id, so a later delete wins and a later upsert wins', () => {
    const stripped = stripEchoes(
      [
        change({ id: '1', op: 'upsert', at: T1 }),
        change({ id: '2', op: 'delete', at: T2 }),
      ],
      [],
    );
    expect(coalesceChanges(stripped)).toEqual([change({ id: '2', op: 'delete', at: T2 })]);
    expect(
      coalesceChanges([
        change({ id: '1', op: 'delete', at: T1 }),
        change({ id: '2', op: 'upsert', at: T2 }),
      ]),
    ).toEqual([change({ id: '2', op: 'upsert', at: T2 })]);
  });

  it('compares ids numerically and keeps null resource ids in their own group', () => {
    expect(
      coalesceChanges([
        change({ id: '10', op: 'upsert', at: T2 }),
        change({ id: '9', op: 'delete', at: T1 }),
      ]),
    ).toEqual([change({ id: '10', op: 'upsert', at: T2 })]);
    expect(
      coalesceChanges([
        change({ id: '1', scope: 'review', resourceId: null, at: T1 }),
        change({ id: '4', scope: 'review', resourceId: null, at: T2 }),
        change({ id: '3', scope: 'document', resourceId: null, at: T1 }),
      ]),
    ).toEqual([
      change({ id: '3', scope: 'document', resourceId: null, at: T1 }),
      change({ id: '4', scope: 'review', resourceId: null, at: T2 }),
    ]);
  });
});

describe('planReloads', () => {
  it('still refetches a document when an older card fan-out survives a newer self-save echo', () => {
    const current = view();
    const changes = [
      change({ id: '1', op: 'upsert', at: T1 }),
      change({ id: '2', op: 'upsert', at: T2 }),
    ];
    const echoes: EchoStamp[] = [{ scope: 'document', resourceId: DOC, atMs: Date.parse(T2) }];
    expect(current.documents[0]?.updatedAt).toBe(T2);
    expect(plan(changes, echoes, current)).toEqual([
      { kind: 'document', id: DOC, op: 'upsert', body: 'apply' },
    ]);
  });

  it('refetches a lone card fan-out even when the local document stamp is newer', () => {
    expect(plan([change({ id: '1', at: T1 })], [], view())).toEqual([
      { kind: 'document', id: DOC, op: 'upsert', body: 'apply' },
    ]);
  });

  it('keeps a dirty body, applies a clean one, and defers while a save is in flight', () => {
    const row = change({ id: '1' });
    expect(plan([row], [], view({ editor: { ...openEditor(), bodyDirty: true } }))).toEqual([
      { kind: 'document', id: DOC, op: 'upsert', body: 'keep' },
    ]);
    expect(plan([row], [], view({ editor: { ...openEditor(), titleDirty: true } }))).toEqual([
      { kind: 'document', id: DOC, op: 'upsert', body: 'apply' },
    ]);
    expect(
      plan([row], [], view({ editor: { ...openEditor(), bodyDirty: true, saveInflight: true } })),
    ).toEqual([{ kind: 'document', id: DOC, op: 'upsert', body: 'defer' }]);
  });

  it('ignores dirty and inflight flags on a different editors document', () => {
    const current = view({
      editor: {
        id: OTHER,
        updatedAt: T2,
        bodyDirty: true,
        titleDirty: true,
        saveInflight: true,
      },
    });
    expect(plan([change({ id: '1' })], [], current)).toEqual([
      { kind: 'document', id: DOC, op: 'upsert', body: 'apply' },
    ]);
  });

  it('emits a document delete even when the local stamp is newer', () => {
    expect(plan([change({ id: '5', op: 'delete', at: T1 })], [], view())).toEqual([
      { kind: 'document', id: DOC, op: 'delete', body: 'apply' },
    ]);
  });

  it('reloads an unknown document only when the list still includes its head', () => {
    const unknown = change({ id: '8', resourceId: OTHER, at: T1 });
    const documents = Array.from({ length: 21 }, (_, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
      updatedAt: T2,
    }));
    const hidden = view({
      documents,
      openDocumentId: null,
      editor: null,
      listIncludesHead: false,
    });
    expect(plan([unknown], [], hidden)).toEqual([]);
    expect(plan([unknown], [], { ...hidden, listIncludesHead: true })).toEqual([
      { kind: 'documents-page' },
    ]);
  });

  it('emits one documents-page for several unknown ids and still plans a known document', () => {
    const current = view({ listIncludesHead: true });
    expect(
      plan(
        [
          change({ id: '1', resourceId: DOC }),
          change({ id: '2', resourceId: OTHER }),
          change({ id: '3', resourceId: TOPIC }),
        ],
        [],
        current,
      ),
    ).toEqual([
      { kind: 'document', id: DOC, op: 'upsert', body: 'apply' },
      { kind: 'documents-page' },
    ]);
  });

  it('plans an open reader document that is not in the list', () => {
    const current = view({
      documents: [],
      openDocumentId: null,
      editor: null,
      readerDocumentId: DOC,
    });
    expect(plan([change({ id: '1' })], [], current)).toEqual([
      { kind: 'document', id: DOC, op: 'upsert', body: 'apply' },
    ]);
  });

  it('emits topic or map for a known id and topics-page otherwise', () => {
    const current = view({
      topics: [{ id: TOPIC }],
      openTopicId: TOPIC,
      mapTopicId: TOPIC,
    });
    expect(
      plan(
        [
          change({ id: '1', scope: 'topic', resourceId: TOPIC, op: 'delete' }),
          change({ id: '2', scope: 'map', resourceId: TOPIC }),
        ],
        [],
        current,
      ),
    ).toEqual([
      { kind: 'topic', id: TOPIC, op: 'delete' },
      { kind: 'map', topicId: TOPIC },
    ]);
    expect(
      plan([change({ id: '3', scope: 'topic', resourceId: TOPIC_B })], [], current),
    ).toEqual([{ kind: 'topics-page' }]);
    expect(plan([change({ id: '4', scope: 'map', resourceId: TOPIC_B })], [], current)).toEqual([
      { kind: 'topics-page' },
    ]);
  });

  it('always emits review, and does not turn a session into a full load', () => {
    const row = change({ id: '1', scope: 'review', resourceId: null });
    expect(plan([row], [], view({ reviewInSession: true }))).toEqual([{ kind: 'review' }]);
    expect(plan([row], [], view({ reviewInSession: false }))).toEqual([{ kind: 'review' }]);
    expect(reviewReloadMode(true)).toBe('stats');
    expect(reviewReloadMode(false)).toBe('queue');
  });

  it('emits a job intent without a jobs-page policy', () => {
    expect(
      plan([change({ id: '1', scope: 'job', resourceId: JOB })], [], view({ jobs: [], activeJobId: null })),
    ).toEqual([{ kind: 'job', id: JOB }]);
  });

  it('emits report, suggest, and resurface for the today page to filter later', () => {
    expect(
      plan(
        [
          change({ id: '1', scope: 'report', resourceId: null }),
          change({ id: '2', scope: 'suggest', resourceId: null }),
          change({ id: '3', scope: 'resurface', resourceId: null }),
        ],
        [],
        view(),
      ),
    ).toEqual([{ kind: 'report' }, { kind: 'suggest' }, { kind: 'resurface' }]);
  });

  it('dedups identical intents from one poll', () => {
    const current = view({ reviewInSession: true });
    expect(
      planReloads(
        [
          change({ id: '1', scope: 'review', resourceId: null }),
          change({ id: '2', scope: 'review', resourceId: null }),
        ],
        current,
      ),
    ).toEqual([{ kind: 'review' }]);
  });
});

describe('classifyRemoteDetail', () => {
  const base = {
    capturedGen: 1,
    currentGen: 1,
    dirty: false,
    inflight: false,
    detailUpdatedAtMs: 2_000,
    floorUpdatedAtMs: 1_000 as number | null,
  };

  it('drops a mismatched generation or a detail strictly older than the floor', () => {
    expect(classifyRemoteDetail({ ...base, capturedGen: 0 })).toBe('drop');
    expect(classifyRemoteDetail({ ...base, detailUpdatedAtMs: 999, dirty: true })).toBe('drop');
    expect(classifyRemoteDetail({ ...base, floorUpdatedAtMs: null, detailUpdatedAtMs: 0 })).toBe(
      'merge-seed-body',
    );
  });

  it('seeds when the stamp equals the floor and keeps the body when dirty or in flight', () => {
    expect(classifyRemoteDetail({ ...base, detailUpdatedAtMs: 1_000 })).toBe('merge-seed-body');
    expect(classifyRemoteDetail({ ...base, detailUpdatedAtMs: 1_000, dirty: true })).toBe(
      'merge-keep-body',
    );
    expect(classifyRemoteDetail({ ...base, detailUpdatedAtMs: 1_500, inflight: true })).toBe(
      'merge-keep-body',
    );
  });
});

describe('planDroppedDocumentReplay', () => {
  it('waits while a write or another replay is in flight, otherwise starts once', () => {
    expect(
      planDroppedDocumentReplay({ dropped: false, writeInflight: true, recoveryInflight: true }),
    ).toBe('none');
    expect(
      planDroppedDocumentReplay({ dropped: true, writeInflight: true, recoveryInflight: false }),
    ).toBe('wait');
    expect(
      planDroppedDocumentReplay({ dropped: true, writeInflight: false, recoveryInflight: true }),
    ).toBe('wait');
    expect(
      planDroppedDocumentReplay({ dropped: false, writeInflight: false, recoveryInflight: false }),
    ).toBe('none');
    expect(
      planDroppedDocumentReplay({ dropped: true, writeInflight: false, recoveryInflight: false }),
    ).toBe('start');
  });

  it('starts one post-accept refetch and does not plan a second from the echo page', () => {
    const cardAt = T2;
    let currentGen = 0;
    let writeInflight = false;
    let recoveryInflight = false;
    const echoes: EchoStamp[] = [];

    expect(
      planDroppedDocumentReplay({ dropped: false, writeInflight, recoveryInflight }),
    ).toBe('none');

    writeInflight = true;
    currentGen = 1;
    echoes.push({ scope: 'document', resourceId: DOC, atMs: Date.parse(cardAt) });

    expect(
      classifyRemoteDetail({
        capturedGen: 0,
        currentGen,
        dirty: false,
        inflight: false,
        detailUpdatedAtMs: Date.parse(T1),
        floorUpdatedAtMs: null,
      }),
    ).toBe('drop');
    expect(
      planDroppedDocumentReplay({ dropped: true, writeInflight, recoveryInflight }),
    ).toBe('wait');

    writeInflight = false;
    expect(
      planDroppedDocumentReplay({ dropped: true, writeInflight, recoveryInflight }),
    ).toBe('start');
    recoveryInflight = true;

    const echoPage = [change({ id: '10', at: cardAt })];
    expect(plan(echoPage, echoes, view())).toEqual([]);

    writeInflight = true;
    currentGen = 2;
    expect(
      classifyRemoteDetail({
        capturedGen: 1,
        currentGen,
        dirty: false,
        inflight: false,
        detailUpdatedAtMs: Date.parse(cardAt),
        floorUpdatedAtMs: null,
      }),
    ).toBe('drop');
    recoveryInflight = false;
    expect(
      planDroppedDocumentReplay({ dropped: true, writeInflight, recoveryInflight }),
    ).toBe('wait');
    writeInflight = false;
    expect(
      planDroppedDocumentReplay({ dropped: true, writeInflight, recoveryInflight }),
    ).toBe('start');
  });
});

describe('nextPollDelayMs', () => {
  it('backs off 2000, 4000, 8000, then stays at 30000', () => {
    expect([0, 1, 2, 3, 4].map((failures) => nextPollDelayMs(failures))).toEqual([
      2_000, 4_000, 8_000, 30_000, 30_000,
    ]);
  });
});

function openEditor(): NonNullable<SyncView['editor']> {
  return {
    id: DOC,
    updatedAt: T2,
    bodyDirty: false,
    titleDirty: false,
    saveInflight: false,
  };
}
