import {
  isChatQuestion,
  listBodyPreview,
  toDocumentListItem,
  type Document,
  type DocumentDetail,
  type DocumentListItem,
} from '@inwit/dto';
import { createChat, createDocument, getDocument } from '@/api/documents';
import { asPmJson, textToPmDoc } from '@/lib/pm-doc';

/**
 * 文档列表页（today / docs / topics）共享的列表项、捕获、toast、轮询工具。
 * Host 接口由页面 Service 实现（字段名对齐即可），赋值仍发生在 Service
 * 实例上，响应式不受影响。
 */

export const POLL_MS = 3000;
export const TOAST_MS = 3200;

export function asListItem(
  doc: Document,
  extra: { cardCount: number; topicTitle: string | null },
): DocumentListItem {
  return toDocumentListItem(doc, extra);
}

export function mergeDetail(item: DocumentListItem, detail: DocumentDetail): DocumentListItem {
  return {
    ...item,
    title: detail.title,
    description: detail.description,
    status: detail.status,
    answer: detail.answer,
    linkHint: detail.linkHint,
    topicId: detail.topicId,
    fileMime: detail.fileMime,
    pageCount: detail.pageCount,
    updatedAt: detail.updatedAt,
    cardCount: detail.cards.filter((card) => card.acceptance === 'accepted').length,
    proposedCount: detail.cards.filter((card) => card.acceptance === 'proposed').length,
    topicTitle: detail.topicTitle ?? item.topicTitle,
    preview: listBodyPreview(detail.contentJson),
  };
}

// ---- 捕获（发问题 / 贴文本） ----

export type CaptureMode = 'auto' | 'chat' | 'paste';

export function captureIsChat(content: string, mode: CaptureMode): boolean {
  return mode === 'chat' || (mode === 'auto' && isChatQuestion(content));
}

export async function sendCapture(input: {
  /** Plain text (editor.getText()); drives chat detection and the chat payload. */
  text: string;
  /** Rich content from the capture editor; falls back to textToPmDoc(text). */
  pmJson?: unknown;
  topicId: string | null;
  mode: CaptureMode;
}): Promise<{ created: Document; useChat: boolean }> {
  const useChat = captureIsChat(input.text, input.mode);
  const created = useChat
    ? await createChat({
        question: input.text,
        ...(input.topicId ? { topicId: input.topicId } : {}),
      })
    : await createDocument({
        contentJson: input.pmJson !== undefined ? asPmJson(input.pmJson) : textToPmDoc(input.text),
        ...(input.topicId ? { topicId: input.topicId } : {}),
      });
  return { created, useChat };
}

// ---- toast ----

export interface ToastHost {
  toast: string | null;
  toastTimer: ReturnType<typeof setTimeout> | null;
}

export function showToast(host: ToastHost, message: string): void {
  host.toast = message;
  if (host.toastTimer !== null) clearTimeout(host.toastTimer);
  host.toastTimer = setTimeout(() => {
    host.toast = null;
    host.toastTimer = null;
  }, TOAST_MS);
}

export function stopToast(host: ToastHost): void {
  if (host.toastTimer !== null) {
    clearTimeout(host.toastTimer);
    host.toastTimer = null;
  }
}

// ---- 轮询 ----

export interface PollHost {
  pollTimer: ReturnType<typeof setInterval> | null;
}

export function startPolling(host: PollHost, tick: () => void): void {
  if (host.pollTimer !== null) return;
  host.pollTimer = setInterval(tick, POLL_MS);
}

export function stopPolling(host: PollHost): void {
  if (host.pollTimer === null) return;
  clearInterval(host.pollTimer);
  host.pollTimer = null;
}

export function hasPendingDoc(items: readonly { status: string }[]): boolean {
  return items.some((item) => item.status === 'pending');
}

/**
 * 拉详情并合并进列表项；瞬时失败返回 null（调用方保留原列表，
 * 轮询场景下不该因为一次抖动清空界面）。
 */
export async function fetchMergedItem<T extends DocumentListItem>(item: T): Promise<T | null> {
  try {
    const detail = await getDocument(item.id);
    return { ...mergeDetail(item, detail) } as T;
  } catch {
    return null;
  }
}

// ---- sync 激活期间的轻量轮询 ----

/**
 * 轮询目标：列表里的 pending 文档 + 当前打开但不在列表里的 pending 文档。
 */
export function pendingPollTargets(
  documents: readonly { id: string; status: string }[],
  openDoc: { id: string; status: string } | null,
): string[] {
  const ids = documents.filter((item) => item.status === 'pending').map((item) => item.id);
  if (openDoc && openDoc.status === 'pending' && !ids.includes(openDoc.id)) ids.push(openDoc.id);
  return ids;
}

/** detail 比本地已知戳还旧时拒绝合并（本地保存的 PUT 没回到这次 GET 里）。 */
function staleDetail(current: { updatedAt: string }, detail: { updatedAt: string }): boolean {
  const next = Date.parse(detail.updatedAt);
  if (Number.isNaN(next)) return true;
  const cur = Date.parse(current.updatedAt);
  return !Number.isNaN(cur) && next < cur;
}

/**
 * sync 激活期间的轻量合并：只刷状态类字段（status/failReason/updatedAt/卡数），
 * 正文相关字段（title/description/preview/topicId 等）保持原样——编辑器可能正在写它们。
 * 无变化或快照过旧时返回原对象，便于响应式跳过。
 */
export function mergeStatusDetail<T extends DocumentListItem>(item: T, detail: DocumentDetail): T {
  if (staleDetail(item, detail)) return item;
  return {
    ...item,
    status: detail.status,
    failReason: detail.failReason,
    updatedAt: detail.updatedAt,
    cardCount: detail.cards.filter((card) => card.acceptance === 'accepted').length,
    proposedCount: detail.cards.filter((card) => card.acceptance === 'proposed').length,
  };
}

/** 当前打开的文档同样只合元字段：contentJson/title/cards 等一律保留。 */
export function mergeDocMeta(doc: DocumentDetail, detail: DocumentDetail): DocumentDetail {
  if (staleDetail(doc, detail)) return doc;
  return {
    ...doc,
    status: detail.status,
    failReason: detail.failReason,
    updatedAt: detail.updatedAt,
  };
}

// ---- 翻转补拉 ----

/**
 * digest 的状态翻转与 meta（标题/描述/主题归属）落库是两步：翻转那次 fetch
 * 可能先于 meta 写入，而翻转后没有 pending 文档轮询即停，行数据就滞留在
 * 原始 capture 文案。因此对刚翻转的文档延迟补拉几次；两次间隔覆盖 meta
 * 稍慢落库的情况。
 */
export const FLIP_FOLLOW_UP_DELAYS_MS = [4000, 10000] as const;

/** 找出本次轮询中从 pending 翻成其他状态的文档 id。after 里已消失的（被删）不算。 */
export function justFlippedFromPending(
  before: readonly { id: string; status: string }[],
  after: readonly { id: string; status: string }[],
): string[] {
  const afterById = new Map(after.map((item) => [item.id, item.status]));
  return before
    .filter((item) => item.status === 'pending')
    .filter((item) => {
      const next = afterById.get(item.id);
      return next !== undefined && next !== 'pending';
    })
    .map((item) => item.id);
}

/**
 * 翻转补拉定时器：同一文档不叠加；fire 触发时由调用方再查一次文档是否还在、
 * 是否又变回 pending（那时正常轮询会接管，不再补拉）。
 */
export class FlipFollowUpScheduler {
  private timers = new Map<string, Array<ReturnType<typeof setTimeout>>>();

  has(id: string): boolean {
    return this.timers.has(id);
  }

  schedule(
    id: string,
    fire: (id: string) => void,
    delays: readonly number[] = FLIP_FOLLOW_UP_DELAYS_MS,
  ): void {
    if (this.timers.has(id)) return;
    const handles: Array<ReturnType<typeof setTimeout>> = [];
    for (const ms of delays) {
      const handle = setTimeout(() => {
        const current = this.timers.get(id);
        if (!current) return;
        const rest = current.filter((item) => item !== handle);
        if (rest.length === 0) this.timers.delete(id);
        else this.timers.set(id, rest);
        fire(id);
      }, ms);
      handles.push(handle);
    }
    this.timers.set(id, handles);
  }

  cancel(id: string): void {
    const handles = this.timers.get(id);
    if (!handles) return;
    for (const handle of handles) clearTimeout(handle);
    this.timers.delete(id);
  }

  clear(): void {
    for (const handles of this.timers.values()) {
      for (const handle of handles) clearTimeout(handle);
    }
    this.timers.clear();
  }
}
