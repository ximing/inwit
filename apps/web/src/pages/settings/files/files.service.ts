import { Service } from '@rabjs/react';
import {
  STORAGE_FILE_PAGE_LIMIT,
  type StorageFileKind,
  type StorageFileSort,
  type StorageFilesSummary,
  type StorageFileView,
} from '@inwit/dto';
import { listStorageFiles } from '@/api/files';
import { errorMessage } from '@/api/client';

const EMPTY_SUMMARY: StorageFilesSummary = {
  totalCount: 0,
  totalBytes: 0,
  byKind: {
    source: { count: 0, bytes: 0 },
    media: { count: 0, bytes: 0 },
    excerpt: { count: 0, bytes: 0 },
    avatar: { count: 0, bytes: 0 },
  },
};

export class FilesService extends Service {
  configured = true;
  truncated = false;
  summary: StorageFilesSummary = EMPTY_SUMMARY;
  items: StorageFileView[] = [];
  total = 0;
  limit = STORAGE_FILE_PAGE_LIMIT;
  offset = 0;
  kind: 'all' | StorageFileKind = 'all';
  unusedOnly = false;
  sort: StorageFileSort = 'modified';
  error: string | null = null;
  selectedKey: string | null = null;
  ready = false;
  loading = false;
  private requestSeq = 0;
  private loadedKey = '';

  private queryKey(): string {
    return `${this.kind}|${this.unusedOnly ? '1' : '0'}|${this.sort}|${this.offset}|${this.limit}`;
  }

  get page(): number {
    return Math.floor(this.offset / this.limit) + 1;
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / this.limit));
  }

  get hasPrev(): boolean {
    return this.offset > 0;
  }

  get hasNext(): boolean {
    return this.offset + this.limit < this.total;
  }

  setKind(kind: 'all' | StorageFileKind): void {
    if (this.kind === kind) return;
    this.kind = kind;
    this.offset = 0;
    this.selectedKey = null;
    void this.load();
  }

  setUnusedOnly(unusedOnly: boolean): void {
    if (this.unusedOnly === unusedOnly) return;
    this.unusedOnly = unusedOnly;
    this.offset = 0;
    this.selectedKey = null;
    void this.load();
  }

  setSort(sort: StorageFileSort): void {
    if (this.sort === sort) return;
    this.sort = sort;
    this.offset = 0;
    this.selectedKey = null;
    void this.load();
  }

  loadPage(page: number): void {
    const next = Math.max(0, (page - 1) * this.limit);
    if (next === this.offset) return;
    this.offset = next;
    this.selectedKey = null;
    void this.load();
  }

  toggleSelected(key: string): void {
    this.selectedKey = this.selectedKey === key ? null : key;
  }

  ensureLoaded(): void {
    if (this.loadedKey === this.queryKey() && this.error === null) return;
    void this.load();
  }

  refresh(): void {
    this.loadedKey = '';
    void this.load();
  }

  async load(): Promise<void> {
    const seq = ++this.requestSeq;
    const key = this.queryKey();
    this.loading = true;
    this.error = null;
    try {
      const response = await listStorageFiles({
        kind: this.kind,
        unused: this.unusedOnly ? '1' : '0',
        sort: this.sort,
        limit: this.limit,
        offset: this.offset,
      });
      if (seq !== this.requestSeq) return;
      this.configured = response.configured;
      this.truncated = response.truncated;
      this.summary = response.summary;
      this.items = response.items;
      this.total = response.total;
      this.limit = response.limit;
      this.offset = response.offset;
      this.ready = true;
      this.loadedKey = key;
      if (this.selectedKey && !this.items.some((item) => item.key === this.selectedKey)) {
        this.selectedKey = null;
      }
    } catch (err) {
      if (seq !== this.requestSeq) return;
      this.error = errorMessage(err, '文件列表加载失败');
    } finally {
      if (seq === this.requestSeq) this.loading = false;
    }
  }
}
