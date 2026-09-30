import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, MapTreeNode, Topic } from '@inwit/dto';
import { ApiError } from '@/api/client';
import { getJob } from '@/api/jobs';
import { getMapNodeDetail, getTopicMap, getTopicMapSummary } from '@/api/maps';
import { listTopics } from '@/api/topics';
import { mergeListedRows, TopicsService, type TopicListItem } from './topics.service';

vi.mock('@/api/maps', async (original) => ({
  ...await original<typeof import('@/api/maps')>(),
  getTopicMap: vi.fn(),
  getTopicMapSummary: vi.fn(),
  getMapNodeDetail: vi.fn(),
}));
vi.mock('@/api/topics', async (original) => ({
  ...(await original<typeof import('@/api/topics')>()),
  listTopics: vi.fn(),
  deleteTopic: vi.fn(async () => undefined),
}));
vi.mock('@/api/jobs', async (original) => ({
  ...(await original<typeof import('@/api/jobs')>()),
  getJob: vi.fn(),
}));
vi.mock('@/api/documents', async (original) => ({
  ...(await original<typeof import('@/api/documents')>()),
  listDocuments: vi.fn(async () => ({ items: [], total: 0 })),
}));
vi.mock('@/api/review', async (original) => ({
  ...(await original<typeof import('@/api/review')>()),
  getReviewTopicStats: vi.fn(async () => []),
}));
const node: MapTreeNode = {
  id: 'node-1', topicId: 'topic-1', parentId: null, title: '节点', status: 'learning',
  note: null, position: 0, createdAt: '', cardCount: 0, proposedCount: 0, docCount: 1, mastery: 0, children: [],
};
const summary = { totalNodes: 1, uncoveredNodes: 0, cardCount: 0, masteryPct: 0 };
beforeEach(() => vi.clearAllMocks());

describe('topic map refresh after document changes', () => {
  it('refreshes node document counts as well as the summary', async () => {
    const service = new TopicsService();
    service.topicId = 'topic-1';
    service.applyMap([node]);
    vi.mocked(getTopicMapSummary).mockResolvedValue(summary);
    vi.mocked(getTopicMap).mockResolvedValue({ nodes: [{ ...node, docCount: 0 }] });
    await service.refreshSummary(true);
    expect(service.tree[0]?.docCount).toBe(0);
  });

  it('does not apply old topic responses after navigation', async () => {
    const service = new TopicsService();
    service.topicId = 'topic-1';
    let finish!: (value: typeof summary) => void;
    vi.mocked(getTopicMapSummary).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.mocked(getTopicMap).mockResolvedValue({ nodes: [node] });
    const pending = service.refreshSummary(true);
    service.topicId = 'topic-2';
    finish(summary);
    await pending;
    expect(service.tree).toEqual([]);
    expect(service.summary).toBeNull();
  });

  it('applies the tree when the open node is missing', async () => {
    const service = new TopicsService();
    service.topicId = 'topic-1';
    service.selectedNodeId = 'missing';
    service.nodeDetail = { node, cards: [], documents: [] };
    vi.mocked(getTopicMapSummary).mockResolvedValue(summary);
    vi.mocked(getTopicMap).mockResolvedValue({ nodes: [{ ...node, docCount: 4 }] });
    vi.mocked(getMapNodeDetail).mockRejectedValue(new ApiError(404, 'MAP_NODE_NOT_FOUND', '没有这个节点'));

    const applied = await service.refreshSummary(true);

    expect(applied).toBe(true);
    expect(service.tree[0]?.docCount).toBe(4);
    expect(service.selectedNodeId).toBeNull();
    expect(service.nodeDetail).toBeNull();
  });
});

function topicItem(id: string, title: string, updatedAt: string): TopicListItem {
  return {
    topic: {
      id,
      userId: 'user',
      title,
      goal: null,
      status: 'active',
      createdAt: updatedAt,
      updatedAt,
    },
    cardCount: 0,
    documentCount: 0,
    totalNodes: 0,
    uncoveredNodes: 0,
    masteryPct: 0,
  };
}

describe('topic list snapshot', () => {
  it('keeps a topic created while listTopics is in flight', async () => {
    let release!: (topics: Topic[]) => void;
    vi.mocked(listTopics).mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    const service = new TopicsService();
    const pending = service.load();
    service.items = [topicItem('created', '新建', '2026-09-30T00:00:01.000Z')];
    release([]);
    await pending;
    expect(service.items.map((item) => item.topic.id)).toEqual(['created']);
  });

  it('does not put back a topic removed while listTopics is in flight', async () => {
    const stale = topicItem('gone', '旧', '2026-09-30T00:00:01.000Z');
    let release!: (topics: Topic[]) => void;
    vi.mocked(listTopics).mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    const service = new TopicsService();
    service.items = [stale];
    const pending = service.load();
    service.items = [];
    release([stale.topic]);
    await pending;
    expect(service.items).toEqual([]);
  });

  it('keeps a newer local title over the list snapshot', async () => {
    const newer = topicItem('t1', '新标题', '2026-09-30T00:00:02.000Z');
    const older: Topic = { ...newer.topic, title: '旧标题', updatedAt: '2026-09-30T00:00:01.000Z' };
    vi.mocked(listTopics).mockResolvedValue([older]);
    const service = new TopicsService();
    service.items = [newer];

    await service.load();

    expect(service.items[0]?.topic.title).toBe('新标题');
  });

  it('keeps a newer sidebar topic when merging the topics page', async () => {
    const newer = topicItem('t1', '新标题', '2026-09-30T00:00:02.000Z');
    const older: Topic = { ...newer.topic, title: '旧标题', updatedAt: '2026-09-30T00:00:01.000Z' };
    vi.mocked(listTopics).mockResolvedValue([older]);
    const service = new TopicsService();
    service.items = [newer];

    await (service as unknown as {
      _mergeTopicsPage(ids: readonly string[]): Promise<void>;
    })._mergeTopicsPage([]);

    expect(service.items[0]?.topic.title).toBe('新标题');
  });

  it('still drops deleted ids when merging the topics page', async () => {
    const row = topicItem('t1', '主题', '2026-09-30T00:00:02.000Z');
    vi.mocked(listTopics).mockResolvedValue([row.topic]);
    const service = new TopicsService();
    service.items = [row];

    await (service as unknown as {
      _mergeTopicsPage(ids: readonly string[]): Promise<void>;
    })._mergeTopicsPage(['t1']);

    expect(service.items).toEqual([]);
  });
});

describe('topic job tick', () => {
  it('does not apply a job after the open topic has moved on', async () => {
    const running = {
      id: 'job-1',
      userId: 'user',
      type: 'topic',
      status: 'running',
      payload: {},
      runAt: '2026-09-30T00:00:00.000Z',
      finishedAt: null,
      attempts: 1,
      lastError: null,
      createdAt: '2026-09-30T00:00:00.000Z',
      updatedAt: '2026-09-30T00:00:00.000Z',
      summary: '',
      description: '',
    } satisfies Job;
    let release!: (job: Job) => void;
    vi.mocked(getJob).mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    const service = new TopicsService();
    service.activeJob = running;
    service.topicLoadGen = 1;
    const pending = service.tickJob();
    service.topicLoadGen = 2;
    service.activeJob = null;
    release({ ...running, status: 'failed', lastError: '旧任务失败' });
    await pending;
    expect(service.activeJob).toBeNull();
    expect(service.detailError).toBeNull();
  });
});

describe('mergeListedRows', () => {
  it('keeps server order and appends the local tail', () => {
    const merged = mergeListedRows(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'b' }, { id: 'a' }],
      [],
      (row) => row.id,
    );
    expect(merged.map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });

  it('drops deleted ids after the merge so the tail cannot restore them', () => {
    const merged = mergeListedRows(
      [{ id: 'a' }, { id: 'gone' }],
      [{ id: 'gone' }, { id: 'a' }],
      ['gone'],
      (row) => row.id,
    );
    expect(merged.map((row) => row.id)).toEqual(['a']);
  });

  it('reads topic ids from the nested topic', () => {
    const local = [
      { topic: { id: 't1' }, n: 1 },
      { topic: { id: 't2' }, n: 2 },
    ];
    const server = [{ topic: { id: 't2' }, n: 9 }];
    expect(mergeListedRows(local, server, ['t1'], (row) => row.topic.id)).toEqual([
      { topic: { id: 't2' }, n: 9 },
    ]);
  });
});
