import { Service } from '@rabjs/react';
import type { MapSummary, Topic } from '@inwit/dto';
import { listDocuments } from '@/api/documents';
import { errorMessage } from '@/api/client';
import { getTopicMapSummary } from '@/api/maps';
import { archiveTopic, listTopics, restoreTopic } from '@/api/topics';

export type TopicListItem = {
  topic: Topic;
  cardCount: number;
  documentCount: number;
  totalNodes: number;
  uncoveredNodes: number;
};

export function coveragePct(item: TopicListItem): number {
  if (item.totalNodes <= 0) return 0;
  return Math.round(((item.totalNodes - item.uncoveredNodes) / item.totalNodes) * 100);
}

export class TopicsService extends Service {
  items: TopicListItem[] = [];
  error: string | null = null;
  busyId: string | null = null;

  get active(): TopicListItem[] {
    return this.items.filter((item) => item.topic.status === 'active');
  }

  get archived(): TopicListItem[] {
    return this.items.filter((item) => item.topic.status === 'archived');
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const topics = await listTopics();
      this.items = await Promise.all(topics.map((topic) => this._enrich(topic)));
    } catch (err) {
      this.error = errorMessage(err, '加载主题失败');
    }
  }

  async archive(id: string): Promise<void> {
    this.busyId = id;
    this.error = null;
    try {
      const topic = await archiveTopic(id);
      this.items = this.items.map((item) =>
        item.topic.id === id ? { ...item, topic } : item,
      );
    } catch (err) {
      this.error = errorMessage(err, '归档失败');
    } finally {
      this.busyId = null;
    }
  }

  async restore(id: string): Promise<void> {
    this.busyId = id;
    this.error = null;
    try {
      const topic = await restoreTopic(id);
      this.items = this.items.map((item) =>
        item.topic.id === id ? { ...item, topic } : item,
      );
    } catch (err) {
      this.error = errorMessage(err, '恢复失败');
    } finally {
      this.busyId = null;
    }
  }

  async _enrich(topic: Topic): Promise<TopicListItem> {
    const blank = {
      topic,
      cardCount: 0,
      documentCount: 0,
      totalNodes: 0,
      uncoveredNodes: 0,
    };
    try {
      const [page, summary]: [Awaited<ReturnType<typeof listDocuments>>, MapSummary] =
        await Promise.all([
          listDocuments({ topicId: topic.id, limit: 1, offset: 0 }),
          getTopicMapSummary(topic.id),
        ]);
      return {
        topic,
        cardCount: summary.cardCount,
        documentCount: page.total,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
      };
    } catch {
      return blank;
    }
  }
}
