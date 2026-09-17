import {
  isChatQuestion,
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
  return {
    ...doc,
    cardCount: extra.cardCount,
    topicTitle: extra.topicTitle,
  };
}

export function mergeDetail(item: DocumentListItem, detail: DocumentDetail): DocumentListItem {
  return {
    ...item,
    title: detail.title,
    description: detail.description,
    contentJson: detail.contentJson,
    status: detail.status,
    answer: detail.answer,
    linkHint: detail.linkHint,
    topicId: detail.topicId,
    fileMime: detail.fileMime,
    pageCount: detail.pageCount,
    updatedAt: detail.updatedAt,
    cardCount: detail.cards.length,
    topicTitle: detail.topicTitle ?? item.topicTitle,
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
