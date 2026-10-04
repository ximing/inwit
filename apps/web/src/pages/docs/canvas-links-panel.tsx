import type { CardLinkType } from '@inwit/dto';
import { X } from 'lucide-react';
import { useState } from 'react';
import { CardLinks } from './card-link-list';
import { LINK_META, LINK_ORDER } from './card-links-logic';
import type { LinksPanelAnchor, Size } from './mindmap-focus';

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
  refreshKey = 0,
  onClose,
}: {
  cardId: string;
  documentId: string | null;
  anchor: LinksPanelAnchor;
  refreshKey?: number;
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
        <CardLinks cardId={cardId} documentId={documentId} refreshKey={refreshKey} />
      </div>
    </>
  );
}

/** 手绘关系边的类型选择浮层：落在目标卡片上松开时弹出，舞台坐标。 */
export function CanvasLinkEditor({
  x,
  y,
  stage,
  saving,
  onSave,
  onClose,
}: {
  x: number;
  y: number;
  stage: Size;
  saving: boolean;
  onSave: (type: CardLinkType, reason: string) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<CardLinkType>('related');
  const [reason, setReason] = useState('');
  const width = 236;
  const left = Math.min(Math.max(8, x), Math.max(8, stage.width - width - 8));
  const top = Math.min(Math.max(8, y), Math.max(8, stage.height - 210));
  return (
    <div
      className="canvas-link-editor"
      role="dialog"
      aria-label="新建关联"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p className="canvas-link-editor-title">这两张卡是什么关系？</p>
      <div className="canvas-link-editor-types">
        {LINK_ORDER.map((item) => (
          <button
            key={item}
            type="button"
            className={type === item ? 'is-on' : undefined}
            aria-pressed={type === item}
            onClick={() => setType(item)}
          >
            <span className={`card-link-rel is-${LINK_META[item].rel}`}>{LINK_META[item].mark}</span>
            {LINK_META[item].label}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        maxLength={500}
        placeholder="一句话理由（可不填）"
        aria-label="关联理由"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="canvas-link-editor-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => onSave(type, reason)}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
