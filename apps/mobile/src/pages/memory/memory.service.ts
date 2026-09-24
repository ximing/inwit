import { Service } from '@rabjs/react';
import type { MemoryCollection, MemoryRevision } from '@inwit/dto';
import { errorMessage } from '@/api/client';
import { listMemoryCollections, listMemoryRevisions } from '@/api/memory';

const REVISION_PAGE = 20;

export function revisionCountLabel(diff: MemoryRevision['diff']): string {
  const collections = { create: 0, update: 0, retire: 0, merge: 0 };
  const entries = { add: 0, update: 0, retire: 0 };
  for (const item of diff.collections) collections[item.op] += 1;
  for (const item of diff.entries) entries[item.op] += 1;
  const parts: string[] = [];
  if (collections.create) parts.push(`新增集合 ${String(collections.create)}`);
  if (collections.update) parts.push(`更新集合 ${String(collections.update)}`);
  if (collections.merge) parts.push(`合并集合 ${String(collections.merge)}`);
  if (collections.retire) parts.push(`停用集合 ${String(collections.retire)}`);
  if (entries.add) parts.push(`新增条目 ${String(entries.add)}`);
  if (entries.update) parts.push(`更新条目 ${String(entries.update)}`);
  if (entries.retire) parts.push(`停用条目 ${String(entries.retire)}`);
  parts.push(`反馈 ${String(diff.feedbackCount)} 条`);
  return parts.join(' · ');
}

export class MemoryService extends Service {
  collections: MemoryCollection[] = [];
  revisions: MemoryRevision[] = [];
  revisionTotal = 0;
  ready = false;
  error: string | null = null;

  get activeCollections(): MemoryCollection[] {
    return this.collections.filter((collection) => collection.status === 'active');
  }

  get retiredCollections(): MemoryCollection[] {
    return this.collections.filter((collection) => collection.status === 'retired');
  }

  async load(): Promise<void> {
    try {
      const [bundle, page] = await Promise.all([
        listMemoryCollections(),
        listMemoryRevisions({ limit: REVISION_PAGE, offset: 0 }),
      ]);
      this.collections = bundle.collections;
      this.revisions = page.items;
      this.revisionTotal = page.total;
      this.error = null;
    } catch (err) {
      this.error = errorMessage(err, '记忆加载失败，请重试');
    } finally {
      this.ready = true;
    }
  }

  async loadMoreRevisions(): Promise<void> {
    if (this.revisions.length >= this.revisionTotal) return;
    this.error = null;
    try {
      const page = await listMemoryRevisions({
        limit: REVISION_PAGE,
        offset: this.revisions.length,
      });
      const seen = new Set(this.revisions.map((row) => row.id));
      this.revisions = [...this.revisions, ...page.items.filter((row) => !seen.has(row.id))];
      this.revisionTotal = page.total;
    } catch (err) {
      this.error = errorMessage(err, '整理历史加载失败，请重试');
    }
  }
}
