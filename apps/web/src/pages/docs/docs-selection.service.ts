import { Service } from '@rabjs/react';
import type { AnnotationGeometry } from '@inwit/dto';
import { errorMessage } from '@/api/client';
import { enqueueSelectionCards } from '@/api/documents';

const SELECTION_POLL_MS = 2000;
const SELECTION_POLL_FOR_MS = 9000;

export interface SelectionPopState {
  kind: 'annotate' | 'card' | 'ask';
  text: string;
  left: number;
  top: number;
  documentId: string;
  blockIndex?: number;
  from?: number;
  to?: number;
  pdf?: {
    pageIndex: number;
    geometry: AnnotationGeometry;
    imageKey?: string;
  };
}

/** 补拉循环要问文档页的事。这里不解析 DocsService。 */
export type SelectionPollHooks = {
  syncActive: () => boolean;
  refreshOne: (documentId: string) => Promise<void>;
  showToast: (message: string) => void;
  /** 当前打开的就是这份文档时返回卡片数，否则 null。 */
  cardCount: (documentId: string) => number | null;
};

/**
 * 正文选区制卡的浮层、排队标志和补拉计时器。
 * 不读文档列表，也不改卡片或同步回声。
 */
export class DocsSelectionService extends Service {
  selectionDigesting = false;
  selectionPollUntil = 0;
  selectionPollDocId: string | null = null;
  selectionCardCountAtStart = 0;
  selectionJobId: string | null = null;
  selectionPop: SelectionPopState | null = null;
  selectionTickTimer: ReturnType<typeof setTimeout> | null = null;
  selectionWatchdog: ReturnType<typeof setTimeout> | null = null;

  private selectionByDocument = new Map<string, SelectionPopState>();
  private selectionTickInflight = false;

  /** 切走之前把当前浮层留给这篇文章。 */
  parkSelection(documentId: string): void {
    if (this.selectionPop?.documentId === documentId) {
      this.selectionByDocument.set(documentId, this.selectionPop);
    }
  }

  /** 打开文章时装回它自己的浮层。没有就清空。 */
  restoreSelection(documentId: string): void {
    this.selectionPop = this.selectionByDocument.get(documentId) ?? null;
  }

  openSelectionPop(input: SelectionPopState): void {
    if (this.selectionPop && this.selectionPop.documentId !== input.documentId) {
      this.selectionByDocument.set(this.selectionPop.documentId, this.selectionPop);
    }
    this.selectionPop = input;
    this.selectionByDocument.set(input.documentId, input);
  }

  closeSelectionPop(): void {
    const documentId = this.selectionPop?.documentId;
    if (documentId) this.selectionByDocument.delete(documentId);
    this.selectionPop = null;
  }

  async queueSelectionCards(
    documentId: string,
    text: string,
    blockIndex: number,
    hooks: SelectionPollHooks,
  ): Promise<boolean> {
    const clipped = text.trim();
    if (!clipped || !Number.isFinite(blockIndex) || blockIndex < 1) return false;
    this.selectionDigesting = true;
    this.selectionPollDocId = documentId;
    this.selectionCardCountAtStart = hooks.cardCount(documentId) ?? 0;
    this.selectionPollUntil = Date.now() + SELECTION_POLL_FOR_MS;
    try {
      const job = await enqueueSelectionCards(documentId, { text: clipped, blockIndex });
      this.selectionJobId = job.id;
      this.startSelectionPoll(documentId, hooks);
      return true;
    } catch (err) {
      this.finishSelectionPoll();
      hooks.showToast(errorMessage(err, '没排上队'));
      return false;
    }
  }

  startSelectionPoll(documentId: string, hooks: SelectionPollHooks): void {
    this.stopSelectionTick();
    const deadline = this.selectionPollUntil;
    this.selectionWatchdog = setTimeout(() => {
      this.selectionWatchdog = null;
      if (this.selectionPollUntil === deadline) this.finishSelectionPoll();
    }, SELECTION_POLL_FOR_MS + 400);
    // Job events and document reloads finish the flag. The 2s loop is only the fallback.
    this.armSelectionLoop(documentId, hooks);
  }

  armSelectionLoop(documentId: string, hooks: SelectionPollHooks): void {
    if (hooks.syncActive()) return;
    if (this.selectionTickTimer !== null || this.selectionTickInflight) return;
    if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
    const startCount = this.selectionCardCountAtStart;
    const tick = async () => {
      this.selectionTickTimer = null;
      this.selectionTickInflight = true;
      try {
        if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
        await hooks.refreshOne(documentId);
        if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
        if (hooks.syncActive()) return;
        const count = hooks.cardCount(documentId);
        const grown = count !== null && count > startCount;
        const timedOut = Date.now() >= this.selectionPollUntil;
        if (grown || timedOut) this.finishSelectionPoll();
      } finally {
        this.selectionTickInflight = false;
      }
      if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
      if (hooks.syncActive() || this.selectionTickTimer !== null) return;
      this.selectionTickTimer = setTimeout(() => {
        void tick();
      }, SELECTION_POLL_MS);
    };
    this.selectionTickTimer = setTimeout(() => {
      void tick();
    }, SELECTION_POLL_MS);
  }

  stopSelectionTick(): void {
    if (this.selectionTickTimer !== null) {
      clearTimeout(this.selectionTickTimer);
      this.selectionTickTimer = null;
    }
    if (this.selectionWatchdog !== null) {
      clearTimeout(this.selectionWatchdog);
      this.selectionWatchdog = null;
    }
  }

  /** Drop the 2s getDocument loop without clearing selectionDigesting or the watchdog. */
  disarmSelectionLoop(): void {
    if (this.selectionTickTimer === null) return;
    clearTimeout(this.selectionTickTimer);
    this.selectionTickTimer = null;
  }

  finishSelectionPoll(): void {
    this.stopSelectionTick();
    this.selectionDigesting = false;
    this.selectionPollUntil = 0;
    this.selectionPollDocId = null;
    this.selectionJobId = null;
  }

  override destroy(): void {
    this.finishSelectionPoll();
    super.destroy();
  }
}
