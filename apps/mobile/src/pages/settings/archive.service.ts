import { Service } from '@rabjs/react';
import type { ArchivedAnnotation, ArchivedCard, ArchivedDocument } from '@inwit/dto';
import {
  destroyAnnotation,
  listArchivedAnnotations,
  restoreAnnotation,
} from '@/api/annotations';
import { errorMessage } from '@/api/client';
import { destroyCard, listArchivedCards, restoreCard } from '@/api/cards';
import {
  destroyDocumentPermanently,
  listArchivedDocuments,
  restoreDocument,
} from '@/api/documents';
import { confirmAction } from '@/lib/confirm';
import { ToastService } from '@/services/toast.service';

const PAGE = 20;

export class ArchiveService extends Service {
  documents: ArchivedDocument[] = [];
  documentsTotal = 0;
  documentsPage = 1;
  documentsError: string | null = null;
  cards: ArchivedCard[] = [];
  cardsTotal = 0;
  cardsPage = 1;
  cardsError: string | null = null;
  annotations: ArchivedAnnotation[] = [];
  annotationsTotal = 0;
  annotationsPage = 1;
  annotationsError: string | null = null;
  busyId: string | null = null;

  get toastService(): ToastService {
    return this.resolve(ToastService);
  }

  get documentsHasMore(): boolean {
    return this.documents.length < this.documentsTotal;
  }

  get cardsHasMore(): boolean {
    return this.cards.length < this.cardsTotal;
  }

  get annotationsHasMore(): boolean {
    return this.annotations.length < this.annotationsTotal;
  }

  async load(): Promise<void> {
    await Promise.all([this.reloadDocuments(), this.reloadCards(), this.reloadAnnotations()]);
  }

  async loadMoreDocuments(): Promise<void> {
    if (!this.documentsHasMore || this.$model.loadMoreDocuments.loading) return;
    const page = this.documentsPage + 1;
    try {
      const result = await listArchivedDocuments({ page, limit: PAGE });
      this.documents = mergePage(this.documents, result.items);
      this.documentsTotal = result.total;
      this.documentsPage = page;
      this.documentsError = null;
    } catch (err) {
      this.documentsError = errorMessage(err, '回收站加载失败');
    }
  }

  async loadMoreCards(): Promise<void> {
    if (!this.cardsHasMore || this.$model.loadMoreCards.loading) return;
    const page = this.cardsPage + 1;
    try {
      const result = await listArchivedCards({ page, limit: PAGE });
      this.cards = mergePage(this.cards, result.items);
      this.cardsTotal = result.total;
      this.cardsPage = page;
      this.cardsError = null;
    } catch (err) {
      this.cardsError = errorMessage(err, '回收站加载失败');
    }
  }

  async loadMoreAnnotations(): Promise<void> {
    if (!this.annotationsHasMore || this.$model.loadMoreAnnotations.loading) return;
    const page = this.annotationsPage + 1;
    try {
      const result = await listArchivedAnnotations({ page, limit: PAGE });
      this.annotations = mergePage(this.annotations, result.items);
      this.annotationsTotal = result.total;
      this.annotationsPage = page;
      this.annotationsError = null;
    } catch (err) {
      this.annotationsError = errorMessage(err, '回收站加载失败');
    }
  }

  async restoreArchivedDocument(id: string): Promise<void> {
    await this.run(id, async () => {
      await restoreDocument(id);
      await this.reloadDocuments();
    }, '恢复失败');
  }

  async destroyArchivedDocument(id: string): Promise<void> {
    if (!(await this.confirmDestroy(id))) return;
    await this.run(id, async () => {
      await destroyDocumentPermanently(id);
      await this.reloadDocuments();
    }, '删除失败', '已彻底删除');
  }

  async restoreArchivedCard(id: string): Promise<void> {
    await this.run(id, async () => {
      await restoreCard(id);
      await this.reloadCards();
    }, '恢复失败');
  }

  async destroyArchivedCard(id: string): Promise<void> {
    if (!(await this.confirmDestroy(id))) return;
    await this.run(id, async () => {
      await destroyCard(id);
      await this.reloadCards();
    }, '删除失败', '已彻底删除');
  }

  async restoreArchivedAnnotation(id: string): Promise<void> {
    await this.run(id, async () => {
      await restoreAnnotation(id);
      await this.reloadAnnotations();
    }, '恢复失败');
  }

  async destroyArchivedAnnotation(id: string): Promise<void> {
    if (!(await this.confirmDestroy(id))) return;
    await this.run(id, async () => {
      await destroyAnnotation(id);
      await this.reloadAnnotations();
    }, '删除失败', '已彻底删除');
  }

  private async reloadDocuments(): Promise<void> {
    this.documentsError = null;
    try {
      const result = await listArchivedDocuments({ page: 1, limit: PAGE });
      this.documents = result.items;
      this.documentsTotal = result.total;
      this.documentsPage = 1;
    } catch (err) {
      this.documentsError = errorMessage(err, '回收站加载失败');
    }
  }

  private async reloadCards(): Promise<void> {
    this.cardsError = null;
    try {
      const result = await listArchivedCards({ page: 1, limit: PAGE });
      this.cards = result.items;
      this.cardsTotal = result.total;
      this.cardsPage = 1;
    } catch (err) {
      this.cardsError = errorMessage(err, '回收站加载失败');
    }
  }

  private async reloadAnnotations(): Promise<void> {
    this.annotationsError = null;
    try {
      const result = await listArchivedAnnotations({ page: 1, limit: PAGE });
      this.annotations = result.items;
      this.annotationsTotal = result.total;
      this.annotationsPage = 1;
    } catch (err) {
      this.annotationsError = errorMessage(err, '回收站加载失败');
    }
  }

  private async confirmDestroy(id: string): Promise<boolean> {
    if (this.busyId) return false;
    this.busyId = id;
    const ok = await confirmAction('彻底删除', '彻底删除后不能恢复。', '彻底删除', true);
    if (!ok) this.busyId = null;
    return ok;
  }

  private async run(
    id: string,
    action: () => Promise<void>,
    fail: string,
    success = '已恢复',
  ): Promise<void> {
    this.busyId = id;
    try {
      await action();
      this.toastService.show(success);
    } catch (err) {
      this.toastService.show(errorMessage(err, fail));
    } finally {
      this.busyId = null;
    }
  }
}

function mergePage<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const have = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !have.has(item.id))];
}
