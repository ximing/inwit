import { Service } from '@rabjs/react';
import type { CardWithQuestions, DocumentDetail } from '@inwit/dto';
import { getDocument } from '@/api/documents';
import { errorMessage } from '@/api/client';

const POLL_MS = 3000;

export class DocService extends Service {
  doc: DocumentDetail | null = null;
  error: string | null = null;
  openCardIds: string[] = [];
  activeCardId: string | null = null;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  appliedUrlAnchor: string | null = null;

  get activeCard(): CardWithQuestions | null {
    if (!this.doc || !this.activeCardId) return null;
    return this.doc.cards.find((card) => card.id === this.activeCardId) ?? null;
  }

  get openCards(): CardWithQuestions[] {
    if (!this.doc) return [];
    return this.openCardIds
      .map((id) => this.doc?.cards.find((card) => card.id === id))
      .filter((card): card is CardWithQuestions => card !== undefined);
  }

  get drawerOpen(): boolean {
    return this.activeCard !== null;
  }

  async load(id: string, urlAnchor?: string | null): Promise<void> {
    this.error = null;
    if (this.doc?.id !== id) {
      this.doc = null;
      this.closeDrawer();
      this.stopPolling();
      this.appliedUrlAnchor = null;
    }
    try {
      this.doc = await getDocument(id);
      this.pruneOpenCards();
      this.syncPolling();
      this.applyUrlAnchor(urlAnchor ?? null);
    } catch (err) {
      this.error = errorMessage(err, '打不开这份文档');
      this.doc = null;
      this.stopPolling();
    }
  }

  applyUrlAnchor(cardId: string | null): void {
    if (!cardId || !this.doc) return;
    const key = `${this.doc.id}:${cardId}`;
    if (this.appliedUrlAnchor === key) return;
    if (!this.doc.cards.some((card) => card.id === cardId)) return;
    this.appliedUrlAnchor = key;
    this.openAnchors([cardId]);
  }

  async refresh(): Promise<void> {
    if (!this.doc) return;
    try {
      this.doc = await getDocument(this.doc.id);
      this.pruneOpenCards();
      this.syncPolling();
    } catch {
      // keep the last good copy while polling
    }
  }

  openAnchors(ids: string[]): void {
    const unique = [...new Set(ids.filter(Boolean))];
    this.openCardIds = unique;
    this.activeCardId = unique[0] ?? null;
  }

  selectCard(id: string): void {
    this.activeCardId = id;
    if (!this.openCardIds.includes(id)) this.openCardIds = [...this.openCardIds, id];
  }

  closeDrawer(): void {
    this.openCardIds = [];
    this.activeCardId = null;
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private pruneOpenCards(): void {
    if (!this.doc) {
      this.closeDrawer();
      return;
    }
    const have = new Set(this.doc.cards.map((card) => card.id));
    this.openCardIds = this.openCardIds.filter((id) => have.has(id));
    if (this.activeCardId && !have.has(this.activeCardId)) {
      this.activeCardId = this.openCardIds[0] ?? null;
    }
  }

  private syncPolling(): void {
    const pending = this.doc?.status === 'pending';
    if (!pending) {
      this.stopPolling();
      return;
    }
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, POLL_MS);
  }
}
