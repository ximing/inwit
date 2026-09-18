import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapTreeNode } from '@inwit/dto';
import { getTopicMap, getTopicMapSummary } from '@/api/maps';
import { TopicsService } from './topics.service';

vi.mock('@/api/maps', async (original) => ({
  ...await original<typeof import('@/api/maps')>(),
  getTopicMap: vi.fn(),
  getTopicMapSummary: vi.fn(),
}));
const node: MapTreeNode = {
  id: 'node-1', topicId: 'topic-1', parentId: null, title: '节点', status: 'learning',
  note: null, position: 0, createdAt: '', cardCount: 0, docCount: 1, mastery: 0, children: [],
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
});
