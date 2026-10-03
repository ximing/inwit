import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  minimapCenter,
  minimapFrame,
  minimapViewport,
  type Size,
  type ViewTransform,
} from './mindmap-focus';
import type { MindLayout } from './mindmap-layout';

const MAP_W = 168;
const MAP_H = 112;

/**
 * 小地图：节点缩略成点，视口画成框。点按或拖动把对应区域移到视口中央。
 */
export function CanvasMinimap({
  layout,
  view,
  stage,
  selectedId,
  onJump,
}: {
  layout: MindLayout;
  view: ViewTransform;
  stage: Size;
  selectedId: string | null;
  onJump: (pan: { panX: number; panY: number }) => void;
}) {
  const dragging = useRef(false);
  const frame = minimapFrame({ width: layout.width, height: layout.height }, { width: MAP_W, height: MAP_H });
  const vp = minimapViewport(view, stage, frame);

  const jumpTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onJump(
      minimapCenter(event.clientX - rect.left, event.clientY - rect.top, frame, view, stage),
    );
  };

  return (
    <div
      className="doc-canvas-minimap"
      role="presentation"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        jumpTo(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) jumpTo(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <svg width={MAP_W} height={MAP_H} aria-hidden>
        {layout.boxes.map((box) => (
          <rect
            key={box.id}
            className={box.id === selectedId ? 'is-on' : undefined}
            x={box.x * frame.scale + frame.offsetX}
            y={box.y * frame.scale + frame.offsetY}
            width={Math.max(3, box.width * frame.scale)}
            height={Math.max(2, box.height * frame.scale)}
            rx={1.5}
          />
        ))}
        <rect className="doc-canvas-minimap-vp" x={vp.x} y={vp.y} width={vp.width} height={vp.height} rx={3} />
      </svg>
    </div>
  );
}
