import { Service } from '@rabjs/react';
import type { DocumentDetail, DocumentListItem } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { getDocument } from '@/api/documents';
import { listWeeklyReports } from '@/api/reports';
import { SyncService, type SyncEvent } from '@/services/sync.service';

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
  private unsubSync: (() => void) | null = null;

  constructor() {
    super();
    try {
      this.unsubSync = this.resolve(SyncService).subscribe((event) => {
        void this.handleSync(event);
      });
    } catch {
      this.unsubSync = null;
    }
  }

  override destroy(): void {
    this.unsubSync?.();
    this.unsubSync = null;
    super.destroy();
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const page = await listWeeklyReports(0);
      this.reports = page.items;
      this.total = page.total;
    } catch (err) {
      this.error = errorMessage(err, '周报加载失败，请重试');
    } finally {
      this.ready = true;
    }
  }

  async loadMore(): Promise<void> {
    this.error = null;
    try {
      const page = await listWeeklyReports(this.reports.length);
      this.reports = [...this.reports, ...page.items];
      this.total = page.total;
    } catch (err) {
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

  async handleSync(event: SyncEvent): Promise<void> {
    if (event.type === 'reset') {
      await this.load();
      if (this.selectedId) await this.refetchOpen();
      return;
    }
    if (event.type !== 'changes' || !this.selectedId) return;
    const id = this.selectedId;
    const matches = event.changes.some(
      (change) => change.scope === 'document' && change.resourceId === id,
    );
    if (matches) await this.refetchOpen();
  }

  /** 后台重拉不先清正文。404 说明这篇已在别处进了回收站。 */
  private async refetchOpen(): Promise<void> {
    const id = this.selectedId;
    if (!id) return;
    const version = ++this.requestVersion;
    try {
      const report = await getDocument(id);
      if (version !== this.requestVersion || this.selectedId !== id) return;
      if (report.kind !== 'weekly_report') throw new Error('这篇内容不是学习周报');
      this.report = report;
      this.detailError = null;
    } catch (err) {
      if (version !== this.requestVersion || this.selectedId !== id) return;
      if (err instanceof ApiError && err.status === 404) {
        this.report = null;
        if (this.reports.some((item) => item.id === id)) {
          this.reports = this.reports.filter((item) => item.id !== id);
          this.total = Math.max(0, this.total - 1);
        }
        this.detailError = errorMessage(err, '周报加载失败，请重试');
      }
    } finally {
      if (version === this.requestVersion) this.detailLoading = false;
    }
  }
}
