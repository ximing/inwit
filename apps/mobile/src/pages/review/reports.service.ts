import { Service } from '@rabjs/react';
import type { DocumentDetail, DocumentListItem } from '@inwit/dto';
import { errorMessage } from '@/api/client';
import { getDocument } from '@/api/documents';
import { listWeeklyReports } from '@/api/reports';

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
}
