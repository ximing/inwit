import type { Document, DocumentListItem, ReviewStats, SyncChange } from '@inwit/dto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocument, getDocument, listDocuments } from '@/api/documents';
import { getAnnotationResurface } from '@/api/annotations';
import { listJobs } from '@/api/jobs';
import { getLatestWeeklyReport } from '@/api/reports';
import { getReviewStats, getReviewToday } from '@/api/review';
import { listTopicSuggestions, listTopics } from '@/api/topics';
import { TodayService } from './today.service';

vi.mock('@/api/documents', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  createChat: vi.fn(),
}));
vi.mock('@/api/jobs', () => ({ listJobs: vi.fn() }));
vi.mock('@/api/review', () => ({ getReviewToday: vi.fn(), getReviewStats: vi.fn() }));
vi.mock('@/api/reports', () => ({ getLatestWeeklyReport: vi.fn() }));
vi.mock('@/api/topics', () => ({
  listTopics: vi.fn(),
  listTopicSuggestions: vi.fn(),
  acceptTopicSuggestion: vi.fn(),
  dismissTopicSuggestion: vi.fn(),
  createTopic: vi.fn(),
}));
vi.mock('@/api/annotations', () => ({
  getAnnotationResurface: vi.fn(),
  acceptAnnotationResurface: vi.fn(),
  dismissAnnotationResurface: vi.fn(),
}));

const DOC = '11111111-1111-4111-8111-111111111111';
const T1 = '2026-09-30T00:00:01.000Z';
const T2 = '2026-09-30T00:00:02.000Z';

function change(partial: Partial<SyncChange> & Pick<SyncChange, 'id'>): SyncChange {
  return {
    scope: 'document',
    resourceId: DOC,
    op: 'upsert',
    at: T1,
    ...partial,
  };
}

function row(id: string, extra: Partial<DocumentListItem> = {}): DocumentListItem {
  return { id, updatedAt: T1, status: 'digested', ...extra } as DocumentListItem;
}

describe('TodayService sync', () => {
  let service: TodayService;

  afterEach(() => {
    service?.destroy();
    vi.clearAllMocks();
  });

  async function capture(updatedAt = T2): Promise<void> {
    vi.mocked(createDocument).mockResolvedValue({ id: DOC, updatedAt, title: 'n', status: 'pending' } as Document);
    vi.mocked(listJobs).mockResolvedValue({ items: [], total: 0, limit: 5, offset: 0 });
    service.draft = 'hello note';
    await service.send('paste');
  }

  it('stamps only the saved document row, so an earlier fan-out still refreshes', async () => {
    service = new TodayService();
    await capture();
    vi.mocked(getDocument).mockResolvedValue({ id: DOC, cards: [] } as never);
    await service.handleSync({
      type: 'changes',
      changes: [change({ id: '1', at: T1 }), change({ id: '2', at: T2 })],
    });
    expect(getDocument).toHaveBeenCalledWith(DOC);
  });

  it('lets one stamp consume one upsert and does not consume a delete', async () => {
    service = new TodayService();
    await capture();
    vi.mocked(getDocument).mockResolvedValue({ id: DOC, cards: [] } as never);
    await service.handleSync({
      type: 'changes',
      changes: [change({ id: '2', at: T2 }), change({ id: '3', at: T2 })],
    });
    expect(getDocument).toHaveBeenCalledTimes(1);

    vi.mocked(getDocument).mockClear();
    vi.mocked(listDocuments).mockResolvedValue({
      items: [row('other')],
      total: 1,
      limit: 4,
      offset: 0,
    });
    await service.handleSync({
      type: 'changes',
      changes: [change({ id: '4', at: T2, op: 'delete' })],
    });
    expect(getDocument).not.toHaveBeenCalled();
    expect(service.documents.map((doc) => doc.id)).toEqual(['other']);
    expect(service.documentTotal).toBe(1);
  });

  it('does not treat a newer local updatedAt as an echo', async () => {
    service = new TodayService();
    service.documents = [row(DOC, { updatedAt: T2 })];
    vi.mocked(getDocument).mockResolvedValue({ id: DOC, cards: [] } as never);
    await service.handleSync({ type: 'changes', changes: [change({ id: '1', at: T1 })] });
    expect(getDocument).toHaveBeenCalledWith(DOC);
  });

  it('merges the head page of 4 and keeps held rows the page did not return', async () => {
    service = new TodayService();
    service.documents = [row('a'), row('b'), row('c')];
    vi.mocked(listDocuments).mockResolvedValue({
      items: [row('a', { updatedAt: T2, title: 'new' }), row('d', { updatedAt: T2 })],
      total: 10,
      limit: 4,
      offset: 0,
    });
    await service.handleSync({
      type: 'changes',
      changes: [change({ id: '8', resourceId: '99999999-9999-4999-8999-999999999999' })],
    });
    expect(listDocuments).toHaveBeenCalledWith({ limit: 4, offset: 0 });
    expect(service.documents.map((doc) => doc.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(service.documents[0]).toMatchObject({ title: 'new' });
    expect(service.documentTotal).toBe(10);
  });

  it('applies a delete after the head merge so a stale page cannot restore it', async () => {
    service = new TodayService();
    service.documents = [row('a'), row('b')];
    service.documentTotal = 2;
    vi.mocked(listDocuments).mockResolvedValue({
      items: [row('a', { updatedAt: T2 }), row('b', { updatedAt: T2 }), row('c', { updatedAt: T2 })],
      total: 2,
      limit: 4,
      offset: 0,
    });
    await service.handleSync({
      type: 'changes',
      changes: [change({ id: '5', resourceId: 'b', op: 'delete', at: T2 })],
    });
    expect(service.documents.map((doc) => doc.id)).toEqual(['a', 'c']);
    expect(service.documentTotal).toBe(2);
  });

  it('refreshes the strips this page already loads, and loads jobs once', async () => {
    service = new TodayService();
    vi.mocked(getReviewToday).mockResolvedValue({ items: [], reviewedToday: 1, total: 4, truncated: 0 });
    vi.mocked(getReviewStats).mockResolvedValue({
      streak: { current: 2, longest: 2 },
      totalCards: 3,
      overdueCount: 4,
    } as ReviewStats);
    vi.mocked(getLatestWeeklyReport).mockResolvedValue({ report: { id: 'w' } } as never);
    vi.mocked(listTopicSuggestions).mockResolvedValue([{ key: 's' }] as never);
    vi.mocked(getAnnotationResurface).mockResolvedValue({ resurface: { key: 'r' } } as never);
    vi.mocked(listJobs).mockResolvedValue({
      items: [{ id: 'j1' }, { id: 'j2' }],
      total: 2,
      limit: 5,
      offset: 0,
    } as never);
    await service.handleSync({
      type: 'changes',
      changes: [
        { id: '1', scope: 'review', resourceId: null, op: 'upsert', at: T1 },
        { id: '2', scope: 'report', resourceId: null, op: 'upsert', at: T1 },
        { id: '3', scope: 'suggest', resourceId: null, op: 'upsert', at: T1 },
        { id: '4', scope: 'resurface', resourceId: null, op: 'upsert', at: T1 },
        { id: '5', scope: 'job', resourceId: '55555555-5555-4555-8555-555555555555', op: 'upsert', at: T1 },
        { id: '6', scope: 'job', resourceId: '66666666-6666-4666-8666-666666666666', op: 'upsert', at: T1 },
      ],
    });
    expect(service.dueCount).toBe(3);
    expect(service.streak).toBe(2);
    expect(service.weeklyReport).toMatchObject({ id: 'w' });
    expect(service.suggestion).toMatchObject({ key: 's' });
    expect(service.resurface).toMatchObject({ key: 'r' });
    expect(listJobs).toHaveBeenCalledTimes(1);
    expect(service.jobs).toHaveLength(2);
  });

  it('reset calls the existing load', async () => {
    service = new TodayService();
    service.documents = [row('old')];
    vi.mocked(listTopics).mockResolvedValue([]);
    vi.mocked(listDocuments).mockResolvedValue({ items: [row('a')], total: 1, limit: 4, offset: 0 });
    vi.mocked(listTopicSuggestions).mockResolvedValue([]);
    vi.mocked(getAnnotationResurface).mockResolvedValue({ resurface: null });
    vi.mocked(getLatestWeeklyReport).mockResolvedValue({ report: null });
    vi.mocked(getReviewToday).mockResolvedValue({ items: [], reviewedToday: 0, total: 0, truncated: 0 });
    vi.mocked(getReviewStats).mockResolvedValue({
      streak: { current: 0, longest: 0 },
      totalCards: 0,
      overdueCount: 0,
    } as ReviewStats);
    vi.mocked(listJobs).mockResolvedValue({ items: [], total: 0, limit: 5, offset: 0 });
    await service.handleSync({ type: 'reset' });
    expect(service.documents.map((doc) => doc.id)).toEqual(['a']);
    expect(listTopics).toHaveBeenCalled();
  });

  it('does not start the pending poll while sync is active, and restarts it when active drops', async () => {
    service = new TodayService();
    service.documents = [row('p', { status: 'pending' })];
    service.startPolling();
    expect(service.pollTimer).not.toBeNull();
    await service.handleSync({ type: 'active', active: true });
    expect(service.pollTimer).toBeNull();

    Object.assign(service, { sync: { active: true } });
    service.startPolling();
    expect(service.pollTimer).toBeNull();

    Object.assign(service, { sync: { active: false } });
    await service.handleSync({ type: 'active', active: false });
    expect(service.pollTimer).not.toBeNull();
  });

  it('drops a head refetch that started before send and keeps the new row visible', async () => {
    service = new TodayService();
    service.documents = [row('a'), row('b'), row('c'), row('d')];
    service.documentTotal = 4;
    let release!: (page: { items: DocumentListItem[]; total: number; limit: number; offset: number }) => void;
    vi.mocked(listDocuments).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = service.handleSync({
      type: 'changes',
      changes: [change({ id: '8', resourceId: '99999999-9999-4999-8999-999999999999' })],
    });
    vi.mocked(createDocument).mockResolvedValue({
      id: DOC,
      updatedAt: T2,
      title: 'n',
      status: 'digested',
    } as Document);
    vi.mocked(listJobs).mockResolvedValue({ items: [], total: 0, limit: 5, offset: 0 });
    service.draft = 'hello note';
    await service.send('paste');
    release({ items: [row('a'), row('b'), row('c'), row('d')], total: 4, limit: 4, offset: 0 });
    await pending;
    expect(service.recentDocuments.map((doc) => doc.id)).toEqual([DOC, 'a', 'b', 'c']);
    expect(service.documentTotal).toBe(5);
  });

  it('keeps a leading local-only row in front when the head page omits it', async () => {
    service = new TodayService();
    service.documents = [row(DOC), row('a'), row('b'), row('c'), row('d')];
    service.documentTotal = 5;
    vi.mocked(listDocuments).mockResolvedValue({
      items: [row('a'), row('b'), row('c'), row('d')],
      total: 4,
      limit: 4,
      offset: 0,
    });
    await service.handleSync({
      type: 'changes',
      changes: [change({ id: '8', resourceId: '99999999-9999-4999-8999-999999999999' })],
    });
    expect(service.documents.map((doc) => doc.id)).toEqual([DOC, 'a', 'b', 'c', 'd']);
    expect(service.documentTotal).toBe(5);
  });

  it('does not apply an older review strip or jobs list over a newer one', async () => {
    service = new TodayService();
    let releaseToday!: (today: { items: []; reviewedToday: number; total: number; truncated: number }) => void;
    vi.mocked(getReviewToday).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseToday = resolve;
      }),
    );
    vi.mocked(getReviewStats).mockResolvedValueOnce({
      streak: { current: 1, longest: 1 },
      totalCards: 1,
      overdueCount: 0,
    } as ReviewStats);
    const olderReview = service.loadReview();
    vi.mocked(getReviewToday).mockResolvedValueOnce({ items: [], reviewedToday: 0, total: 4, truncated: 0 });
    vi.mocked(getReviewStats).mockResolvedValueOnce({
      streak: { current: 6, longest: 6 },
      totalCards: 8,
      overdueCount: 0,
    } as ReviewStats);
    await service.loadReview();
    releaseToday({ items: [], reviewedToday: 0, total: 1, truncated: 0 });
    await olderReview;
    expect(service.dueCount).toBe(4);
    expect(service.streak).toBe(6);

    let releaseJobs!: (page: { items: { id: string }[]; total: number; limit: number; offset: number }) => void;
    vi.mocked(listJobs).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseJobs = resolve;
      }),
    );
    const olderJobs = service.loadJobs();
    vi.mocked(listJobs).mockResolvedValueOnce({ items: [{ id: 'new' }], total: 1, limit: 5, offset: 0 } as never);
    await service.loadJobs();
    releaseJobs({ items: [{ id: 'old' }], total: 1, limit: 5, offset: 0 });
    await olderJobs;
    expect(service.jobs.map((job) => job.id)).toEqual(['new']);
  });

  it('does not raise the page banner when a background head merge fails', async () => {
    service = new TodayService();
    service.documents = [row('a')];
    service.documentTotal = 3;
    vi.mocked(listDocuments).mockRejectedValueOnce(new Error('down'));
    await service.handleSync({
      type: 'changes',
      changes: [change({ id: '8', resourceId: '99999999-9999-4999-8999-999999999999' })],
    });
    expect(service.error).toBeNull();
    expect(service.documents.map((doc) => doc.id)).toEqual(['a']);
    expect(service.documentTotal).toBe(3);
  });
});
