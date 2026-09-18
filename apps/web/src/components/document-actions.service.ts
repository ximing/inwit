import { Service } from '@rabjs/react';
import type { Document, DocumentListItem, Topic } from '@inwit/dto';
import { deleteDocument, getDocument, retryDocument, updateDocument } from '@/api/documents';
import { errorMessage } from '@/api/client';
import { listTopics } from '@/api/topics';
import { docsPath } from '@/routes';

export type DocumentChange = { id: string; document: Document | null; topicTitle: string | null };
type Dialog = 'rename' | 'move' | 'delete' | 'retry';

export class DocumentActionsService extends Service {
  doc: DocumentListItem | null = null;
  menu: { x: number; y: number } | null = null;
  dialog: Dialog | null = null;
  title = '';
  topicId = '';
  topics: Topic[] = [];
  topicsLoading = false;
  topicsLoaded = false;
  busy = false;
  error: string | null = null;
  notice: string | null = null;
  onChange: (change: DocumentChange) => void = () => {};
  onOpen: () => void = () => {};
  beforeChange: () => Promise<void> = async () => {};

  open(doc: DocumentListItem, x: number, y: number, onChange: (change: DocumentChange) => void, onOpen: () => void, beforeChange?: () => Promise<void>): void {
    if (this.busy || this.dialog) return;
    this.doc = doc;
    this.menu = { x, y };
    this.error = null;
    this.notice = null;
    this.onChange = onChange;
    this.onOpen = onOpen;
    this.beforeChange = beforeChange ?? (async () => {});
  }

  close(): void {
    if (this.busy) return;
    this.menu = null;
    this.dialog = null;
    this.error = null;
  }

  showDialog(dialog: Dialog): void {
    if (!this.doc) return;
    this.menu = null;
    this.dialog = dialog;
    this.title = this.doc.title ?? '';
    this.topicId = this.doc.topicId ?? '';
    this.error = null;
    if (dialog === 'move') void this.loadTopics();
  }

  async loadTopics(): Promise<void> {
    this.topicsLoading = true;
    this.topicsLoaded = false;
    this.error = null;
    try {
      this.topics = await listTopics('active');
      this.topicsLoaded = true;
    } catch (err) {
      this.error = errorMessage(err, '加载主题失败');
    } finally {
      this.topicsLoading = false;
    }
  }

  async copyLink(): Promise<void> {
    if (!this.doc || this.busy) return;
    this.busy = true;
    try {
      await navigator.clipboard.writeText(new URL(docsPath(this.doc.id), window.location.href).href);
      this.notice = '链接已复制';
      this.menu = null;
    } catch (err) {
      this.error = errorMessage(err, '复制失败，请重试');
    } finally {
      this.busy = false;
    }
  }

  async submit(): Promise<void> {
    const doc = this.doc;
    const dialog = this.dialog;
    if (!doc || !dialog || this.busy) return;
    if (dialog === 'rename' && !this.title.trim()) {
      this.error = '请输入文档名称';
      return;
    }
    if (dialog === 'move' && (!this.topicsLoaded || this.topicsLoading)) return;
    this.busy = true;
    this.error = null;
    try {
      await this.beforeChange();
      let updated: Document | null = null;
      let topicTitle = doc.topicTitle;
      if (dialog === 'delete') await deleteDocument(doc.id);
      else if (dialog === 'retry') {
        await retryDocument(doc.id);
        updated = await getDocument(doc.id);
      } else {
        updated = await updateDocument(doc.id, dialog === 'rename'
          ? { title: this.title.trim() }
          : { topicId: this.topicId || null });
        if (dialog === 'move') topicTitle = this.topics.find((topic) => topic.id === updated?.topicId)?.title ?? null;
      }
      this.onChange({ id: doc.id, document: updated, topicTitle });
      this.dialog = null;
      this.notice = dialog === 'delete' ? '已移入回收站' : dialog === 'retry' ? '已重新开始处理' : '已保存';
    } catch (err) {
      this.error = errorMessage(err, '操作失败，请重试');
    } finally {
      this.busy = false;
    }
  }
}
