import { Service } from '@rabjs/react';
import { errorMessage } from '@/api/client';
import { enqueueSelectionCards } from '@/api/documents';
import { getJob } from '@/api/jobs';
import { clipChars } from '@/lib/clip';
import type { TextSelectionAnchor } from '../../../../../packages/doc-engine/src/protocol';

const SELECTION_POLL_MS = 2000;
const SELECTION_POLL_FOR_MS = 9000;

/** 补拉要问阅读器的事。这里不解析 ReaderService。 */
export type SelectionPollHooks = {
  syncActive: () => boolean;
  appActive: () => boolean;
  refresh: () => Promise<boolean>;
  showToast: (message: string) => void;
  /** 当前打开的就是这份文档时返回卡片数，否则 null。 */
  cardCount: (documentId: string) => number | null;
};

/**
 * 正文选区制卡的排队标志和补拉计时器。
 * 不读文档，也不解析 ReaderService。
 */
export class ReaderSelectionService extends Service {
  selectionDigesting = false;
  selectionPollUntil = 0;
  selectionPollDocId: string | null = null;
  selectionCardCountAtStart = 0;
  selectionJobId: string | null = null;
  selectionTickTimer: ReturnType<typeof setTimeout> | null = null;
  selectionTickInflight = false;
  selectionWatchdog: ReturnType<typeof setTimeout> | null = null;

  async queueDigest(
    anchor: TextSelectionAnchor,
    documentId: string,
    cardCount: number,
    hooks: SelectionPollHooks,
  ): Promise<void> {
    const clipped = clipChars(anchor.text.trim(), 100_000);
    if (!clipped || !Number.isFinite(anchor.blockIndex) || anchor.blockIndex < 1) {
      hooks.showToast('选区没法排队');
      return;
    }
    this.selectionDigesting = true;
    this.selectionPollDocId = documentId;
    this.selectionCardCountAtStart = cardCount;
    this.selectionPollUntil = Date.now() + SELECTION_POLL_FOR_MS;
    try {
      const job = await enqueueSelectionCards(documentId, { text: clipped, blockIndex: anchor.blockIndex });
      this.selectionJobId = job.id;
      hooks.showToast('已排队，消化完成后出现');
      this.startSelectionPoll(documentId, hooks);
    } catch (err) {
      this.finishSelectionPoll();
      hooks.showToast(errorMessage(err, '没排上队'));
    }
  }

  startSelectionPoll(documentId: string, hooks: SelectionPollHooks): void {
    this.stopSelectionTick();
    const deadline = this.selectionPollUntil;
    this.selectionWatchdog = setTimeout(() => {
      this.selectionWatchdog = null;
      if (this.selectionPollUntil === deadline) this.finishSelectionPoll();
    }, SELECTION_POLL_FOR_MS + 400);
    this.armSelectionLoop(documentId, hooks);
  }

  armSelectionLoop(documentId: string, hooks: SelectionPollHooks): void {
    if (hooks.syncActive() || !hooks.appActive()) return;
    if (this.selectionTickTimer !== null || this.selectionTickInflight) return;
    if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
    const startCount = this.selectionCardCountAtStart;
    const tick = async () => {
      this.selectionTickTimer = null;
      this.selectionTickInflight = true;
      try {
        if (!hooks.appActive() || !this.selectionDigesting || this.selectionPollDocId !== documentId) return;
        await hooks.refresh();
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
      if (!hooks.appActive() || hooks.syncActive() || this.selectionTickTimer !== null) return;
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

  /** 只清 2 秒计时器，不清 selectionDigesting，也不清看门狗。 */
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

  async settleSelectionJob(id: string): Promise<void> {
    if (this.selectionJobId !== id || !this.selectionDigesting) return;
    try {
      const job = await getJob(id);
      if (this.selectionJobId !== id) return;
      if (job.status === 'done' || job.status === 'failed') this.finishSelectionPoll();
    } catch {
      // Watchdog still clears the flag.
    }
  }

  override destroy(): void {
    this.finishSelectionPoll();
    super.destroy();
  }
}
