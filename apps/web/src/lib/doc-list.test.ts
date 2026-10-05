import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentCard, DocumentDetail, DocumentListItem } from '@inwit/dto';
import {
  FLIP_FOLLOW_UP_DELAYS_MS,
  FlipFollowUpScheduler,
  justFlippedFromPending,
  mergeDocMeta,
  mergeStatusDetail,
  pendingPollTargets,
} from './doc-list';

const DOC_A = '11111111-1111-4111-8111-111111111111';
const DOC_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

function card(id: string, acceptance: 'accepted' | 'proposed' | 'rejected'): DocumentCard {
  return {
    id,
    acceptance,
    anchorText: null,
    anchorBlockIndex: 1,
    hasImage: false,
    concept: '概念',
    questions: [],
  } as unknown as DocumentCard;
}

function listItem(overrides: Partial<DocumentListItem> = {}): DocumentListItem {
  return {
    id: DOC_A,
    userId: USER,
    topicId: null,
    mapNodeId: null,
    title: '本地标题',
    description: '本地描述',
    source: 'paste',
    status: 'pending',
    failReason: null,
    answer: null,
    linkHint: null,
    fileMime: null,
    pageCount: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cardCount: 0,
    proposedCount: 0,
    topicTitle: null,
    preview: '本地预览',
    ...overrides,
  };
}

function detail(overrides: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: DOC_A,
    userId: USER,
    topicId: null,
    mapNodeId: null,
    title: '远端标题',
    description: '远端描述',
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    source: 'paste',
    status: 'digested',
    failReason: null,
    answer: null,
    linkHint: '远端提示',
    fileMime: null,
    pageCount: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    cards: [card('c1', 'accepted'), card('c2', 'proposed'), card('c3', 'rejected')],
    topicTitle: null,
    ...overrides,
  };
}

describe('pendingPollTargets', () => {
  it('collects pending list rows plus a pending open doc missing from the list', () => {
    const documents = [
      { id: DOC_A, status: 'pending' },
      { id: DOC_B, status: 'digested' },
    ];
    expect(pendingPollTargets(documents, null)).toEqual([DOC_A]);
    expect(pendingPollTargets(documents, { id: DOC_B, status: 'pending' })).toEqual([DOC_A, DOC_B]);
  });

  it('skips the open doc when it is not pending or already listed', () => {
    const documents = [{ id: DOC_A, status: 'pending' }];
    expect(pendingPollTargets(documents, { id: DOC_A, status: 'pending' })).toEqual([DOC_A]);
    expect(pendingPollTargets(documents, { id: DOC_B, status: 'digested' })).toEqual([DOC_A]);
    expect(pendingPollTargets([], null)).toEqual([]);
  });
});

describe('mergeStatusDetail', () => {
  it('updates meta fields on the digested flip and keeps content fields intact', () => {
    const item = listItem();
    const merged = mergeStatusDetail(item, detail({ failReason: null }));

    expect(merged.status).toBe('digested');
    expect(merged.updatedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(merged.cardCount).toBe(1);
    expect(merged.proposedCount).toBe(1);
    // 正文相关字段一律保留本地值。
    expect(merged.title).toBe('本地标题');
    expect(merged.description).toBe('本地描述');
    expect(merged.preview).toBe('本地预览');
    expect(merged.linkHint).toBeNull();
  });

  it('propagates failReason on failure', () => {
    const merged = mergeStatusDetail(
      listItem(),
      detail({ status: 'failed', failReason: 'LLM 超时', cards: [] }),
    );
    expect(merged.status).toBe('failed');
    expect(merged.failReason).toBe('LLM 超时');
    expect(merged.cardCount).toBe(0);
  });

  it('returns the same object when the detail snapshot is older than the row', () => {
    const item = listItem({ updatedAt: '2026-01-01T00:02:00.000Z' });
    expect(mergeStatusDetail(item, detail())).toBe(item);
    expect(mergeStatusDetail(item, detail({ updatedAt: 'not-a-date' }))).toBe(item);
  });
});

describe('mergeDocMeta', () => {
  it('flips status on the open doc while keeping contentJson/title/cards by reference', () => {
    const doc = detail({
      status: 'pending',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: '编辑中的标题',
    });
    const contentJson = doc.contentJson;
    const cards = doc.cards;
    const merged = mergeDocMeta(doc, detail({ status: 'digested' }));

    expect(merged.status).toBe('digested');
    expect(merged.updatedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(merged.contentJson).toBe(contentJson);
    expect(merged.cards).toBe(cards);
    expect(merged.title).toBe('编辑中的标题');
  });

  it('returns the same object for a stale snapshot', () => {
    const doc = detail({ updatedAt: '2026-01-01T00:02:00.000Z' });
    expect(mergeDocMeta(doc, detail())).toBe(doc);
  });
});

describe('justFlippedFromPending', () => {
  it('returns docs that left pending; still-pending rows stay out', () => {
    const before = [
      { id: DOC_A, status: 'pending' },
      { id: DOC_B, status: 'pending' },
    ];
    const after = [
      { id: DOC_A, status: 'digested' },
      { id: DOC_B, status: 'pending' },
    ];
    expect(justFlippedFromPending(before, after)).toEqual([DOC_A]);
  });

  it('counts a flip into failed; ignores rows missing after (deleted)', () => {
    const before = [
      { id: DOC_A, status: 'pending' },
      { id: DOC_B, status: 'pending' },
    ];
    expect(justFlippedFromPending(before, [{ id: DOC_A, status: 'failed' }])).toEqual([DOC_A]);
  });

  it('ignores rows that were not pending before', () => {
    expect(
      justFlippedFromPending(
        [{ id: DOC_A, status: 'digested' }],
        [{ id: DOC_A, status: 'digested' }],
      ),
    ).toEqual([]);
    expect(justFlippedFromPending([], [{ id: DOC_A, status: 'digested' }])).toEqual([]);
  });
});

describe('FlipFollowUpScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once per delay and frees the id after the last fire', () => {
    const scheduler = new FlipFollowUpScheduler();
    const fired: string[] = [];
    scheduler.schedule(DOC_A, (id) => fired.push(id), [4000, 10000]);

    vi.advanceTimersByTime(3999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([DOC_A]);
    expect(scheduler.has(DOC_A)).toBe(true);

    vi.advanceTimersByTime(6000);
    expect(fired).toEqual([DOC_A, DOC_A]);
    expect(scheduler.has(DOC_A)).toBe(false);

    // 全部触发后同一文档可以再次安排（例如重试后再次翻转）。
    scheduler.schedule(DOC_A, (id) => fired.push(id), [1000]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([DOC_A, DOC_A, DOC_A]);
  });

  it('does not stack a second schedule for the same doc', () => {
    const scheduler = new FlipFollowUpScheduler();
    const fired: string[] = [];
    scheduler.schedule(DOC_A, (id) => fired.push(id), [1000]);
    scheduler.schedule(DOC_A, (id) => fired.push(id), [1000]);
    vi.advanceTimersByTime(2000);
    expect(fired).toEqual([DOC_A]);
  });

  it('cancel and clear stop pending follow-ups', () => {
    const scheduler = new FlipFollowUpScheduler();
    const fired: string[] = [];
    scheduler.schedule(DOC_A, (id) => fired.push(id), [1000]);
    scheduler.schedule(DOC_B, (id) => fired.push(id), [1000]);
    scheduler.cancel(DOC_A);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([DOC_B]);

    scheduler.schedule(DOC_A, (id) => fired.push(id), [1000]);
    scheduler.clear();
    vi.advanceTimersByTime(2000);
    expect(fired).toEqual([DOC_B]);
  });

  it('uses the default delays when none are given', () => {
    const scheduler = new FlipFollowUpScheduler();
    const fired: string[] = [];
    scheduler.schedule(DOC_A, (id) => fired.push(id));
    vi.advanceTimersByTime(Math.max(...FLIP_FOLLOW_UP_DELAYS_MS));
    expect(fired).toHaveLength(FLIP_FOLLOW_UP_DELAYS_MS.length);
  });
});
