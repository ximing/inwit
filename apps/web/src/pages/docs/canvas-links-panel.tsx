import { X } from 'lucide-react';
import { CardLinks } from './card-link-list';
import type { LinksPanelAnchor } from './mindmap-focus';

/** 定位用的估算尺寸；CSS 里宽一致、高度是上限。 */
export const LINKS_PANEL_W = 264;
export const LINKS_PANEL_H = 240;

/**
 * 脉络浮层：锚定在选中卡片旁的画布覆盖层，屏幕坐标，不参与脑图布局。
 * 与节点之间画一条虚线连接，视觉上从卡片长出来。
 */
export function CanvasLinksPanel({
  cardId,
  documentId,
  anchor,
  onClose,
}: {
  cardId: string;
  documentId: string | null;
  anchor: LinksPanelAnchor;
  onClose: () => void;
}) {
  const horizontal = anchor.side === 'right' || anchor.side === 'left';
  const dist = Math.max(
    18,
    Math.abs(horizontal ? anchor.toX - anchor.fromX : anchor.toY - anchor.fromY) / 2,
  );
  const sign = anchor.side === 'right' || anchor.side === 'bottom' ? 1 : -1;
  const wire = horizontal
    ? `M ${anchor.fromX} ${anchor.fromY} C ${anchor.fromX + dist * sign} ${anchor.fromY}, ${anchor.toX - dist * sign} ${anchor.toY}, ${anchor.toX} ${anchor.toY}`
    : `M ${anchor.fromX} ${anchor.fromY} C ${anchor.fromX} ${anchor.fromY + dist * sign}, ${anchor.toX} ${anchor.toY - dist * sign}, ${anchor.toX} ${anchor.toY}`;
  return (
    <>
      <svg className="canvas-links-wire" aria-hidden>
        <path d={wire} />
      </svg>
      <div
        className="canvas-links-panel"
        role="dialog"
        aria-label="脉络"
        style={{ left: anchor.left, top: anchor.top }}
      >
        <div className="canvas-links-head">
          <span className="canvas-links-title">脉络</span>
          <button type="button" aria-label="关闭脉络" onClick={onClose}>
            <X width={13} height={13} strokeWidth={1.8} />
          </button>
        </div>
        <CardLinks cardId={cardId} documentId={documentId} />
      </div>
    </>
  );
}
