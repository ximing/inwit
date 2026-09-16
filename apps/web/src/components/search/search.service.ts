import type { SearchResult } from '@inwit/dto';
import { Service } from '@rabjs/react';
import { errorMessage } from '@/api/client';
import { searchQuery } from '@/api/search';

const DEBOUNCE_MS = 300;

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return err instanceof Error && err.name === 'AbortError';
}

export class SearchService extends Service {
  query = '';
  results: SearchResult | null = null;
  error: string | null = null;
  /** Homepage Spotlight palette. Docs keeps the inline box always visible. */
  surfaceOpen = false;
  activeIndex = 0;
  /** When set, hybrid search is scoped to this topic. */
  topicId: string | null = null;
  inputEl: HTMLInputElement | null = null;
  debounceTimer: ReturnType<typeof setTimeout> | null = null;
  abort: AbortController | null = null;
  seq = 0;

  get hasQuery(): boolean {
    return this.query.trim().length > 0;
  }

  get searching(): boolean {
    return this.$model.runSearch.loading || this.debounceTimer !== null;
  }

  get isEmpty(): boolean {
    if (!this.hasQuery || this.searching || this.error || !this.results) return false;
    return this.results.documents.length === 0 && this.results.cards.length === 0;
  }

  bindInput(el: HTMLInputElement | null): void {
    if (this.inputEl === el) return;
    this.inputEl = el;
  }

  focusInput(): void {
    this.inputEl?.focus();
  }

  openSurface(): void {
    this.surfaceOpen = true;
  }

  closeSurface(): void {
    this.surfaceOpen = false;
    this.clear();
  }

  setTopicId(id: string | null): void {
    if (this.topicId === id) return;
    this.topicId = id;
    if (!id) {
      this.clear();
      return;
    }
    if (this.hasQuery) this.schedule();
  }

  setActiveIndex(index: number): void {
    this.activeIndex = Math.max(0, index);
  }

  moveActive(delta: number, count: number): void {
    if (count <= 0) {
      this.activeIndex = 0;
      return;
    }
    this.activeIndex = (this.activeIndex + delta + count) % count;
  }

  setQuery(value: string): void {
    this.query = value;
    this.activeIndex = 0;
    this.schedule();
  }

  clear(): void {
    this.query = '';
    this.activeIndex = 0;
    this.schedule();
  }

  retry(): void {
    const q = this.query.trim();
    if (!q) return;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    void this.runSearch(q);
  }

  schedule(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const q = this.query.trim();
    if (!q) {
      this.seq += 1;
      this.abort?.abort();
      this.abort = null;
      this.results = null;
      this.error = null;
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runSearch(q);
    }, DEBOUNCE_MS);
  }

  async runSearch(q: string): Promise<void> {
    const trimmed = q.trim();
    if (!trimmed) return;
    this.seq += 1;
    const seq = this.seq;
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    this.error = null;
    try {
      const data = await searchQuery(trimmed, { signal: ac.signal, topicId: this.topicId });
      if (seq !== this.seq) return;
      this.results = data;
      this.activeIndex = 0;
    } catch (err) {
      if (seq !== this.seq || ac.signal.aborted || isAbortError(err)) return;
      this.error = errorMessage(err, '搜索失败');
    }
  }

  override destroy(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.abort?.abort();
    this.abort = null;
    super.destroy();
  }
}
