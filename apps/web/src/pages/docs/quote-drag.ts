import type { MindDrop } from './mindmap-hit';
import type { QuoteDragPayload } from './mindmap-quote';
import {
  bindPointerSession,
  pointerDragReleased,
  pointerReleasePoint,
  type PointerSession,
} from './pointer-session';

/** 按下后移动超过这个距离才算出拖，避免点一下就跟着走。 */
export const QUOTE_DRAG_ARM_PX = 6;

export type QuoteDragPhase =
  | {
      phase: 'pending';
      x: number;
      y: number;
      originX: number;
      originY: number;
      payload: QuoteDragPayload;
    }
  | { phase: 'dragging'; x: number; y: number; payload: QuoteDragPayload };

export type QuoteDragPreview = {
  x: number;
  y: number;
  payload: QuoteDragPayload;
};

export function quoteDragDown(payload: QuoteDragPayload, x: number, y: number): QuoteDragPhase {
  return { phase: 'pending', x, y, originX: x, originY: y, payload };
}

/** 没拖开时保持 pending；拖开后进入 dragging，之后只更新坐标。 */
export function quoteDragMove(phase: QuoteDragPhase, x: number, y: number): QuoteDragPhase {
  if (phase.phase === 'dragging') return { ...phase, x, y };
  const dx = x - phase.originX;
  const dy = y - phase.originY;
  if (dx * dx + dy * dy < QUOTE_DRAG_ARM_PX * QUOTE_DRAG_ARM_PX) return { ...phase, x, y };
  return { phase: 'dragging', x, y, payload: phase.payload };
}

/** 只有已经拖开、并且松手时指针还在脑图里，才落成节点。 */
export function quoteDragCommit(phase: QuoteDragPhase, inside: boolean): QuoteDragPayload | null {
  if (!inside || phase.phase !== 'dragging') return null;
  return phase.payload;
}

export function pointerInsideRect(
  rect: { left: number; top: number; right: number; bottom: number } | null,
  x: number,
  y: number,
): boolean {
  if (!rect) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** 幽灵卡片上的一句引文。空白折成一行，过长截断。 */
export function quoteDragLabel(quote: string, max = 42): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return `${chars.slice(0, max).join('')}…`;
}

export function quoteDropCaption(drop: MindDrop | null): string {
  if (!drop) return '拖到脑图';
  if (drop.kind === 'child') return '落为子节点';
  if (drop.kind === 'before') return '排在前面';
  if (drop.kind === 'after') return '排在后面';
  return '独立成树';
}

export type QuoteDragStart = {
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
};

type QuoteDropTarget = {
  contains(x: number, y: number): boolean;
  hit(x: number, y: number): MindDrop;
  /** preview 为 null 表示这次拖动还没开始或已经结束。drop 为 null 表示指针不在脑图上。 */
  preview(preview: QuoteDragPreview | null, drop: MindDrop | null): void;
  drop(payload: QuoteDragPayload, drop: MindDrop): void;
};

let dropTarget: QuoteDropTarget | null = null;
let dragActive = false;

export function isQuoteDragActive(): boolean {
  return dragActive;
}

export function registerQuoteDropTarget(target: QuoteDropTarget): () => void {
  dropTarget = target;
  return () => {
    if (dropTarget === target) dropTarget = null;
  };
}

/**
 * 选区工具栏上的「拖到脑图」。
 * 不用 HTML5 拖放：按下时 preventDefault 才能保住选区，但那样浏览器不会发出 dragstart；
 * 不拦住的话选区一塌，工具栏卸掉，拖放跟着取消，锚点也来不及读。
 * 这里在按下的同步时刻记下引文和锚点，再用窗口上的指针跟踪落到脑图。
 */
export function beginQuoteDrag(event: QuoteDragStart, payload: QuoteDragPayload): void {
  if (dragActive) return;
  if (!payload.documentId || payload.quote.trim().length === 0) return;
  event.preventDefault();
  dragActive = true;
  document.documentElement.classList.add('is-quote-dragging');

  let phase = quoteDragDown(payload, event.clientX, event.clientY);
  let sawButton = false;
  let stop: (() => void) | null = null;
  const session: { current: PointerSession } = {
    current: {
      move(point) {
        if (point.buttons !== 0) sawButton = true;
        else if (pointerDragReleased(point.pointerType, point.buttons, sawButton)) {
          const at = pointerReleasePoint(point, { x: phase.x, y: phase.y });
          finish(at.x, at.y);
          return;
        }
        publish(quoteDragMove(phase, point.clientX, point.clientY));
      },
      up(point) {
        const at = pointerReleasePoint(point, { x: phase.x, y: phase.y });
        finish(at.x, at.y);
      },
      cancel() {
        finish(phase.x, phase.y, false);
      },
      blur() {
        finish(phase.x, phase.y, false);
      },
    },
  };

  const onKey = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== 'Escape') return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    finish(phase.x, phase.y, false);
  };

  function publish(next: QuoteDragPhase) {
    phase = next;
    if (next.phase !== 'dragging') {
      dropTarget?.preview(null, null);
      return;
    }
    const preview = { x: next.x, y: next.y, payload: next.payload };
    const inside = dropTarget?.contains(next.x, next.y) ?? false;
    dropTarget?.preview(preview, inside && dropTarget ? dropTarget.hit(next.x, next.y) : null);
  }

  function finish(x: number, y: number, commit = true) {
    if (!dragActive) return;
    const next = quoteDragMove(phase, x, y);
    const inside = commit && (dropTarget?.contains(x, y) ?? false);
    const payloadToDrop = quoteDragCommit(next, inside);
    const drop = payloadToDrop && dropTarget ? dropTarget.hit(x, y) : null;
    dragActive = false;
    stop?.();
    stop = null;
    window.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('is-quote-dragging');
    dropTarget?.preview(null, null);
    if (payloadToDrop && drop) dropTarget?.drop(payloadToDrop, drop);
    document.dispatchEvent(new Event('selectionchange'));
  }

  stop = bindPointerSession(window, event.pointerId, session);
  window.addEventListener('keydown', onKey, true);
}
