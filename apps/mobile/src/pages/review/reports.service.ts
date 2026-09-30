import { Service } from '@rabjs/react';
import type { DocumentDetail, DocumentListItem } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { getDocument } from '@/api/documents';
import { listWeeklyReports } from '@/api/reports';
import { consumeEchoes } from '@/lib/sync-echo';
import { coalesceChanges, planReloads, type EchoStamp, type ReloadIntent, type SyncView } from '@/lib/sync-plan';
import { SyncService, type SyncEvent } from '@/services/sync.service';

const REPORT_PAGE = 20;

export class ReportsService extends Service {
  reports: DocumentListItem[] = [];
  total = 0;
  ready = false;
  error: string | null = null;
  report: DocumentDetail | null = null;
  detailError: string | null = null;
  detailLoading = false;
  private selectedId: string | null = null;
  private requestVersion = 0;
  private listGen = 0;
  private sync: SyncService | null = null;
  private unsubscribeSync: (() => void) | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  private echoes: EchoStamp[] = [];

  constructor() {
    super();
    try {
      this.sync = this.resolve(SyncService);
      this.unsubscribeSync = this.sync.subscribe((event) => this.onSyncEvent(event));
    } catch {
      this.sync = null;
    }
  }

  async load(): Promise<void> {
    this.error = null;
    const gen = ++this.listGen;
    try {
      const page = await listWeeklyReports(0);
      if (gen !== this.listGen) return;
      this.reports = page.items;
      this.total = page.total;
    } catch (err) {
      if (gen !== this.listGen) return;
      this.error = errorMessage(err, '周报加载失败，请重试');
    } finally {
      this.ready = true;
    }
  }

  async loadMore(): Promise<void> {
    this.error = null;
    const gen = ++this.listGen;
    const offset = this.reports.length;
    try {
      const page = await listWeeklyReports(offset);
      if (gen !== this.listGen) return;
      this.reports = [...this.reports, ...page.items];
      this.total = page.total;
    } catch (err) {
      if (gen !== this.listGen) return;
      this.error = errorMessage(err, '历史周报加载失败，请重试');
    }
  }

  async open(id: string | null): Promise<void> {
    const version = ++this.requestVersion;
    this.selectedId = id;
    this.report = null;
    this.detailError = null;
    this.detailLoading = id !== null;
    if (!id) return;
    try {
      const report = await getDocument(id);
      if (version !== this.requestVersion) return;
      if (report.kind !== 'weekly_report') throw new Error('这篇内容不是学习周报');
      this.report = report;
    } catch (err) {
      if (version === this.requestVersion) this.detailError = errorMessage(err, '周报加载失败，请重试');
    } finally {
      if (version === this.requestVersion) this.detailLoading = false;
    }
  }

  async retryDetail(): Promise<void> {
    await this.open(this.selectedId);
  }

  override destroy(): void {
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this.sync = null;
    super.destroy();
  }

  private onSyncEvent(event: SyncEvent): void {
    this.syncChain = this.syncChain.then(() => this.handleSync(event)).catch(() => undefined);
  }

  private async handleSync(event: SyncEvent): Promise<void> {
    if (event.type === 'active') return;
    if (event.type === 'reset') {
      await this.load();
      if (this.selectedId) await this.refreshOpen(this.selectedId);
      return;
    }
    const changes = coalesceChanges(consumeEchoes(event.changes, this.echoes));
    await this.applySyncIntents(planReloads(changes, this.syncView()));
  }

  private syncView(): SyncView {
    return {
      documents: this.reports.map((item) => ({ id: item.id, updatedAt: item.updatedAt })),
      openDocumentId: this.selectedId,
      listIncludesHead: false,
      editor: null,
      topics: [],
      openTopicId: null,
      mapTopicId: null,
      readerDocumentId: null,
      readerActiveCardId: null,
      reviewInSession: false,
      jobs: [],
      activeJobId: null,
    };
  }

  private async applySyncIntents(intents: ReloadIntent[]): Promise<void> {
    if (intents.some((intent) => intent.kind === 'report')) await this.reloadMerging();
    for (const intent of intents) {
      if (intent.kind !== 'document') continue;
      if (intent.op === 'delete') this.forgetReport(intent.id);
      else await this.refreshReport(intent.id);
    }
  }

  private async reloadMerging(): Promise<void> {
    const gen = ++this.listGen;
    const want = Math.max(this.reports.length, REPORT_PAGE);
    try {
      const items: DocumentListItem[] = [];
      let total = 0;
      let offset = 0;
      while (items.length < want) {
        const page = await listWeeklyReports(offset);
        total = page.total;
        items.push(...page.items);
        if (page.items.length === 0 || items.length >= total) break;
        offset += page.items.length;
      }
      if (gen !== this.listGen) return;
      const prev = new Map(this.reports.map((item) => [item.id, item]));
      const seen = new Set(items.map((item) => item.id));
      const merged = items.map((item) => {
        const local = prev.get(item.id);
        if (!local) return item;
        const localMs = Date.parse(local.updatedAt);
        const nextMs = Date.parse(item.updatedAt);
        if (!Number.isNaN(localMs) && !Number.isNaN(nextMs) && localMs > nextMs) return local;
        return item;
      });
      const tail = this.reports.filter((item) => !seen.has(item.id));
      this.reports = [...merged, ...tail];
      this.total = Math.max(total, this.reports.length);
    } catch {
      // Keep the rows already on screen.
    }
  }

  private async refreshReport(id: string): Promise<void> {
    if (id === this.selectedId) {
      await this.refreshOpen(id);
      return;
    }
    if (!this.reports.some((item) => item.id === id)) return;
    try {
      const detail = await getDocument(id);
      if (detail.kind !== 'weekly_report') return;
      this.reports = this.reports.map((item) =>
        item.id === id
          ? {
              ...item,
              title: detail.title,
              updatedAt: detail.updatedAt,
              status: detail.status,
              topicId: detail.topicId,
              topicTitle: detail.topicTitle,
            }
          : item,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) this.forgetReport(id);
    }
  }

  private async refreshOpen(id: string): Promise<void> {
    const version = ++this.requestVersion;
    try {
      const report = await getDocument(id);
      if (version !== this.requestVersion || this.selectedId !== id) return;
      if (report.kind !== 'weekly_report') return;
      this.report = report;
      this.detailError = null;
      this.reports = this.reports.map((item) =>
        item.id === id
          ? {
              ...item,
              title: report.title,
              updatedAt: report.updatedAt,
              status: report.status,
              topicId: report.topicId,
              topicTitle: report.topicTitle,
            }
          : item,
      );
    } catch (err) {
      if (version !== this.requestVersion || this.selectedId !== id) return;
      if (err instanceof ApiError && err.status === 404) {
        this.forgetReport(id);
        return;
      }
    }
  }

  private forgetReport(id: string): void {
    const had = this.reports.some((item) => item.id === id);
    this.reports = this.reports.filter((item) => item.id !== id);
    if (had) this.total = Math.max(0, this.total - 1);
    if (this.selectedId !== id) return;
    this.report = null;
    this.detailLoading = false;
    this.detailError = '周报加载失败，请重试';
  }
}
