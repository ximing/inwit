import { Service } from '@rabjs/react';
import type { Job, MapNodeDetail, MapSummary, MapTreeNode, Topic } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import {
  fillMapNode,
  getMapNodeDetail,
  getTopicMap,
  getTopicMapSummary,
  organizeTopicMap,
} from '@/api/maps';

function collapsedKey(topicId: string): string {
  return `inwit.map.collapsed.${topicId}`;
}

function readCollapsed(topicId: string): string[] {
  try {
    const raw = localStorage.getItem(collapsedKey(topicId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function findMapNode(nodes: readonly MapTreeNode[], id: string): MapTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findMapNode(node.children, id);
    if (child) return child;
  }
  return null;
}

/** 整理和补节点要问主题页的事。这里不解析 TopicsService。 */
export type MapJobHooks = {
  topic: Topic | null;
  jobRunning: boolean;
  watchJob: (job: Job) => void;
  resumeFromConflict: (err: unknown) => Promise<boolean>;
  setDetailError: (message: string | null) => void;
  showToast: (message: string) => void;
};

export type MapSummaryHooks = {
  topicId: () => string | null;
  topicLoadGen: () => number;
  patchItem: (
    id: string,
    patch: {
      cardCount: number;
      totalNodes: number;
      uncoveredNodes: number;
      masteryPct: number;
    },
  ) => void;
};

/**
 * 主题知识地图的树、摘要、折叠和节点抽屉。
 * 不读主题列表，也不订阅同步。归档、任务和列表计数由调用方传入。
 */
export class TopicsMapService extends Service {
  tree: MapTreeNode[] = [];
  summary: MapSummary | null = null;
  collapsedIds: string[] = [];
  selectedNodeId: string | null = null;
  nodeDetail: MapNodeDetail | null = null;
  titleByNodeId: Record<string, string> = {};

  isCollapsed(id: string): boolean {
    return this.collapsedIds.includes(id);
  }

  toggleCollapsed(id: string, topicId: string | null): void {
    if (this.collapsedIds.includes(id)) {
      this.collapsedIds = this.collapsedIds.filter((item) => item !== id);
    } else {
      this.collapsedIds = [...this.collapsedIds, id];
    }
    this.persistCollapsed(topicId);
  }

  persistCollapsed(topicId: string | null): void {
    if (!topicId) return;
    localStorage.setItem(collapsedKey(topicId), JSON.stringify(this.collapsedIds));
  }

  /** 打开主题时装回它自己的折叠。读失败或内容不是字符串数组时当作空数组。 */
  restoreCollapsed(topicId: string): void {
    this.collapsedIds = readCollapsed(topicId);
  }

  closeDrawer(): void {
    this.selectedNodeId = null;
    this.nodeDetail = null;
  }

  applyMap(nodes: MapTreeNode[]): void {
    this.tree = nodes;
    const titles: Record<string, string> = {};
    const walk = (list: MapTreeNode[]) => {
      for (const node of list) {
        titles[node.id] = node.title;
        walk(node.children);
      }
    };
    walk(nodes);
    this.titleByNodeId = titles;
  }

  async openNode(nodeId: string, hooks: Pick<MapJobHooks, 'setDetailError'>): Promise<void> {
    this.selectedNodeId = nodeId;
    try {
      this.nodeDetail = await getMapNodeDetail(nodeId);
    } catch (err) {
      hooks.setDetailError(errorMessage(err, '打不开这个节点'));
      this.nodeDetail = null;
    }
  }

  async organize(hooks: Omit<MapJobHooks, 'showToast'>): Promise<void> {
    if (!hooks.topic || hooks.topic.status === 'archived' || hooks.jobRunning) return;
    hooks.setDetailError(null);
    try {
      const job = await organizeTopicMap(hooks.topic.id);
      hooks.watchJob(job);
    } catch (err) {
      if (await hooks.resumeFromConflict(err)) return;
      hooks.setDetailError(errorMessage(err, '整理地图失败'));
    }
  }

  async fill(nodeId: string, hooks: MapJobHooks): Promise<void> {
    if (!hooks.topic || hooks.topic.status === 'archived' || hooks.jobRunning) return;
    if (findMapNode(this.tree, nodeId)?.proposedCount) {
      hooks.showToast('有待确认的卡');
      return;
    }
    hooks.setDetailError(null);
    try {
      const job = await fillMapNode(nodeId);
      hooks.watchJob(job);
      void this.openNode(nodeId, hooks);
    } catch (err) {
      if (await hooks.resumeFromConflict(err)) return;
      if (err instanceof ApiError && err.code === 'NODE_HAS_PROPOSED_CARDS') {
        hooks.showToast('有待确认的卡');
        return;
      }
      hooks.setDetailError(errorMessage(err, '补节点失败'));
    }
  }

  async refreshSummary(refreshMap: boolean, hooks: MapSummaryHooks): Promise<boolean> {
    const topicId = hooks.topicId();
    const gen = hooks.topicLoadGen();
    const nodeId = this.selectedNodeId;
    if (!topicId) return false;
    try {
      const [summary, map] = await Promise.all([
        getTopicMapSummary(topicId),
        refreshMap ? getTopicMap(topicId) : Promise.resolve(null),
      ]);
      if (hooks.topicId() !== topicId || hooks.topicLoadGen() !== gen) return false;
      this.summary = summary;
      if (map) this.applyMap(map.nodes);
      hooks.patchItem(topicId, {
        cardCount: summary.cardCount,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
        masteryPct: summary.masteryPct,
      });
    } catch {
      return false;
    }
    if (!refreshMap || !nodeId) return true;
    try {
      const detail = await getMapNodeDetail(nodeId);
      if (hooks.topicId() === topicId && hooks.topicLoadGen() === gen && this.selectedNodeId === nodeId) {
        this.nodeDetail = detail;
      }
    } catch (err) {
      if (hooks.topicId() !== topicId || hooks.topicLoadGen() !== gen || this.selectedNodeId !== nodeId) {
        return true;
      }
      if (err instanceof ApiError && err.status === 404) {
        this.selectedNodeId = null;
        this.nodeDetail = null;
      }
    }
    return true;
  }
}
