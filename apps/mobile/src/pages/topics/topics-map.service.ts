import AsyncStorage from '@react-native-async-storage/async-storage';
import { Service } from '@rabjs/react';
import type { Job, MapNodeDetail, MapSummary, MapTreeNode, Topic } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { fillMapNode, getMapNodeDetail, organizeTopicMap } from '@/api/maps';

function collapsedKey(topicId: string): string {
  return `inwit.map.collapsed.${topicId}`;
}

async function readCollapsed(topicId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(collapsedKey(topicId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function findNode(nodes: readonly MapTreeNode[], id: string): MapTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}

export function firstUncoveredNode(
  nodes: readonly MapTreeNode[],
  skipProposed = false,
): MapTreeNode | null {
  for (const node of nodes) {
    if (node.status === 'uncovered' && !(skipProposed && node.proposedCount > 0)) return node;
    const child = firstUncoveredNode(node.children, skipProposed);
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

export type MapFillHooks = MapJobHooks & {
  openNode: (nodeId: string) => void;
};

type NodeHooks = {
  setDetailError: (message: string | null) => void;
};

/**
 * 主题知识地图的树、摘要、折叠和节点抽屉。
 * 不读主题列表，也不订阅同步。
 */
export class TopicsMapService extends Service {
  tree: MapTreeNode[] = [];
  summary: MapSummary | null = null;
  collapsedIds: string[] = [];
  selectedNodeId: string | null = null;
  nodeDetail: MapNodeDetail | null = null;
  titleByNodeId: Record<string, string> = {};
  mapGen = 0;
  nodeGen = 0;

  get fillTarget(): MapTreeNode | null {
    if (this.selectedNodeId) {
      const selected = findNode(this.tree, this.selectedNodeId);
      if (selected?.status === 'uncovered' && selected.proposedCount <= 0) return selected;
    }
    // A node that only has proposed cards stays uncovered, but it is not a gap to fill.
    return firstUncoveredNode(this.tree, true);
  }

  /** Uncovered nodes exist, and every one of them is waiting on proposed cards. */
  get fillWaiting(): boolean {
    return this.fillTarget === null && firstUncoveredNode(this.tree) !== null;
  }

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
    void AsyncStorage.setItem(collapsedKey(topicId), JSON.stringify(this.collapsedIds)).catch(
      () => {
        // ignore quota / private mode
      },
    );
  }

  /** 打开主题时装回它自己的折叠。读失败或内容不是字符串数组时当作空数组。 */
  async restoreCollapsed(topicId: string): Promise<void> {
    this.collapsedIds = await readCollapsed(topicId);
  }

  closeDrawer(): void {
    this.nodeGen += 1;
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

  async openNode(nodeId: string, hooks: NodeHooks): Promise<void> {
    const gen = ++this.nodeGen;
    this.selectedNodeId = nodeId;
    try {
      const detail = await getMapNodeDetail(nodeId);
      if (gen !== this.nodeGen) return;
      this.nodeDetail = detail;
    } catch (err) {
      if (gen !== this.nodeGen) return;
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

  async fill(nodeId: string | undefined, hooks: MapFillHooks): Promise<void> {
    if (!hooks.topic || hooks.topic.status === 'archived' || hooks.jobRunning) return;
    let target = nodeId;
    if (target) {
      const node = findNode(this.tree, target);
      if (node && node.proposedCount > 0) {
        hooks.showToast('有待确认的卡');
        return;
      }
    } else {
      target = this.fillTarget?.id;
    }
    if (!target) {
      if (this.fillWaiting) hooks.showToast('有待确认的卡');
      else hooks.setDetailError('没有可补充的未覆盖节点');
      return;
    }
    hooks.setDetailError(null);
    try {
      const job = await fillMapNode(target);
      hooks.watchJob(job);
      hooks.openNode(target);
    } catch (err) {
      if (await hooks.resumeFromConflict(err)) return;
      if (err instanceof ApiError && err.code === 'NODE_HAS_PROPOSED_CARDS') {
        hooks.showToast('有待确认的卡');
        return;
      }
      hooks.setDetailError(errorMessage(err, '补节点失败'));
    }
  }
}
