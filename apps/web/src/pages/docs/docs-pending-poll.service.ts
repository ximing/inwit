import { Service } from '@rabjs/react';
import type { DocumentDetail, DocumentListItem, Job } from '@inwit/dto';
import { ApiError } from '@/api/client';
import { getDocument } from '@/api/documents';
import { getJobQueue } from '@/api/jobs';
import {
  FlipFollowUpScheduler,
  hasPendingDoc,
  justFlippedFromPending,
  mergeDocMeta,
  mergeStatusDetail,
  pendingPollTargets,
  startPolling as startPollTimer,
  stopPolling as stopPollTimer,
} from '@/lib/doc-list';

/** 轮询要问文档页的事。调用时传入，这里不解析 DocsService。 */
export type PendingPollHooks = {
  documents: () => DocumentListItem[];
  setDocuments: (items: DocumentListItem[]) => void;
  doc: () => DocumentDetail | null;
  setDoc: (doc: DocumentDetail) => void;
  uploadByDoc: () => Record<string, { percent: number; filename: string }>;
  syncActive: () => boolean;
  refreshOne: (id: string) => Promise<void>;
  forgetDocument: (id: string) => void;
};

/**
 * 待消化文档的状态轮询、任务队列和翻转补拉。
 * 不拉全文合并，也不改编辑器草稿。
 */
export class DocsPendingPollService extends Service {
  activeJobs: Job[] = [];
  pollTimer: ReturnType<typeof setInterval> | null = null;
  private flipFollowUps = new FlipFollowUpScheduler();

  /**
   * sync 激活期间不再停轮询：有 pending 文档或上传时进入轻量轮询（tickPending
   * 只合状态字段，且文档 GET 在正文未变时是 304），让「消化完成」在文档打开时也能 live 翻转。
   */
  syncPolling(hooks: PendingPollHooks): void {
    const listPending = hasPendingDoc(hooks.documents());
    const docPending = hooks.doc()?.status === 'pending';
    const uploading = Object.keys(hooks.uploadByDoc()).length > 0;
    if (listPending || docPending || uploading) this.startPolling(hooks);
    else this.stopPolling();
  }

  startPolling(hooks: PendingPollHooks): void {
    startPollTimer(this, () => void this.tickPending(hooks));
  }

  stopPolling(): void {
    stopPollTimer(this);
  }

  async tickPending(hooks: PendingPollHooks): Promise<void> {
    const lite = hooks.syncActive();
    const ids = pendingPollTargets(hooks.documents(), hooks.doc());
    const before = this.statusSnapshot(ids, hooks);
    const tasks: Promise<void>[] = [this.refreshJobs()];
    if (ids.length > 0) {
      tasks.push(
        ...ids.map((id) => (lite ? this.refreshOneMeta(id, hooks) : hooks.refreshOne(id))),
      );
    }
    await Promise.all(tasks);
    // digest 的状态翻转先于 meta（标题/描述/主题）落库时，翻转这次 fetch 拿到的
    // 还是旧文案；翻转后没有 pending 轮询即停，行数据就滞留了。给刚翻转的文档
    // 安排延迟补拉，让 meta 落定后行数据跟上。
    const after = this.statusSnapshot(ids, hooks);
    for (const id of justFlippedFromPending(before, after)) this.scheduleFlipFollowUp(id, hooks);
    this.syncPolling(hooks);
  }

  /**
   * sync 激活期间的轻量刷新：只合状态类字段（status/failReason/updatedAt/卡数），
   * 正文、preview 与编辑器状态一律不动，避免轮询 clobber 正在编辑的内容。
   * getDocument 带 If-None-Match；正文没变时服务端回 304，不再重下整篇。
   */
  async refreshOneMeta(id: string, hooks: PendingPollHooks): Promise<void> {
    try {
      const detail = await getDocument(id);
      hooks.setDocuments(
        hooks.documents().map((item) => (item.id === id ? mergeStatusDetail(item, detail) : item)),
      );
      const doc = hooks.doc();
      if (doc?.id === id) hooks.setDoc(mergeDocMeta(doc, detail));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        hooks.forgetDocument(id);
        return;
      }
      // Transient poll errors should not wipe the list.
    }
  }

  async refreshJobs(): Promise<void> {
    try {
      const queue = await getJobQueue();
      this.activeJobs = [...queue.running, ...queue.pending];
    } catch {
      // keep the last good copy while polling
    }
  }

  cancelFlipFollowUp(id: string): void {
    this.flipFollowUps.cancel(id);
  }

  clearFlipFollowUps(): void {
    this.flipFollowUps.clear();
  }

  override destroy(): void {
    this.stopPolling();
    this.flipFollowUps.clear();
    super.destroy();
  }

  private statusSnapshot(
    ids: readonly string[],
    hooks: PendingPollHooks,
  ): { id: string; status: string }[] {
    const doc = hooks.doc();
    const documents = hooks.documents();
    return ids.map((id) => {
      const known = doc?.id === id ? doc : documents.find((item) => item.id === id);
      return { id, status: known?.status ?? 'pending' };
    });
  }

  private scheduleFlipFollowUp(id: string, hooks: PendingPollHooks): void {
    this.flipFollowUps.schedule(id, (docId) => {
      const doc = hooks.doc();
      const known = doc?.id === docId ? doc : hooks.documents().find((item) => item.id === docId);
      // 文档已删（forgetDocument 会 cancel，这里是兜底）或又变回 pending
      // （正常轮询已接管）时不补拉。
      if (!known || known.status === 'pending') return;
      void (hooks.syncActive() ? this.refreshOneMeta(docId, hooks) : hooks.refreshOne(docId));
    });
  }
}
