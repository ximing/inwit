/**
 * 文档画布。平移、缩放的世界坐标里，卡片、批注、文本和图片在同一片林子里（自动布局，不记住坐标）。
 * 以后的形状放在同一个 world 里，不要另起一套视口。
 */
import { planOutlineMove, type CanvasMember, type DocumentCard, type OutlineMove } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { ImagePlus, Type } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { CanvasFreeNode, CanvasNoteNode } from './canvas-nodes';
import { DocsService } from './docs.service';
import { layoutMindForest, type MindBox } from './mindmap-layout';

const NODE_W = 232;
const NODE_H = 96;

type Drag = {
  id: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
  over: string | null;
};

function dropHint(
  members: readonly CanvasMember[],
  memberId: string,
  parentId: string | null,
): { text: string | null; accept: boolean } {
  const plan: OutlineMove = planOutlineMove(
    members.map((member) => ({
      id: member.id,
      parentId: member.parentId,
      position: member.position,
    })),
    memberId,
    parentId,
  );
  if (plan.ok && plan.unchanged) return { text: null, accept: false };
  if (plan.ok) return { text: parentId === null ? '独立成树' : '成为子节点', accept: true };
  if (plan.reason === 'depth') return { text: '层级太深了', accept: false };
  return { text: '不能放到这里', accept: false };
}

function SizedNode({
  id,
  className,
  style,
  onSize,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onClickCapture,
  children,
}: {
  id: string;
  className: string;
  style: { left: number; top: number; width: number; transform?: string };
  onSize: (id: string, w: number, h: number) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) onSize(id, el.offsetWidth, el.offsetHeight);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, onSize]);
  return (
    <div
      ref={ref}
      className={className}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
      onDragStart={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

function edgePath(from: MindBox, to: MindBox): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export const CardCanvas = observer(function CardCanvas({
  renderCard,
}: {
  renderCard: (card: DocumentCard) => ReactNode;
}) {
  const service = useService(DocsService);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  const cardKeyRef = useRef('');
  const suppressClick = useRef(false);
  const dragGesture = useRef<{
    id: string;
    pointerId: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const panGesture = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [view, setView] = useState({ panX: 28, panY: 28, zoom: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);

  const onSize = useCallback((id: string, w: number, h: number) => {
    setSizes((prev) => {
      const current = prev[id];
      if (current && Math.abs(current.w - w) < 2 && Math.abs(current.h - h) < 2) return prev;
      return { ...prev, [id]: { w, h } };
    });
  }, []);

  const forest = service.canvasForest;
  const cardById = useMemo(
    () => new Map((service.doc?.cards ?? []).map((card) => [card.id, card])),
    [service.doc],
  );
  const noteById = useMemo(
    () => new Map(service.annotations.map((item) => [item.id, item])),
    [service.annotations],
  );
  const nodeById = useMemo(
    () => new Map(service.canvasNodes.map((node) => [node.id, node])),
    [service.canvasNodes],
  );
  const layout = useMemo(
    () =>
      layoutMindForest(
        forest.map((member) => ({
          id: member.id,
          parentId: member.parentId,
          position: member.position,
          width: sizes[member.id]?.w ?? NODE_W,
          height: sizes[member.id]?.h ?? NODE_H,
        })),
      ),
    [forest, sizes],
  );
  const boxById = useMemo(() => new Map(layout.boxes.map((box) => [box.id, box])), [layout.boxes]);

  const worldPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.panX) / view.zoom,
      y: (clientY - rect.top - view.panY) / view.zoom,
    };
  };

  const hitCard = (x: number, y: number, exceptId: string): string | null => {
    let found: string | null = null;
    for (const box of layout.boxes) {
      if (box.id === exceptId) continue;
      if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) found = box.id;
    }
    return found;
  };

  const zoomFor = useCallback(
    (mode: 'readable' | 'all') => {
      const el = viewportRef.current;
      if (!el || layout.width <= 0 || layout.height <= 0) return null;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      if (vw < 40 || vh < 40) return null;
      const fitWidth = Math.min(1, (vw - 36) / layout.width);
      const fitHeight = Math.min(1, (vh - 36) / layout.height);
      // 打开时优先保住卡片能读；「适配」才把整片林子缩进视口，最低 0.25。
      if (mode === 'all') return Math.max(0.25, Math.min(fitWidth, fitHeight));
      return Math.max(0.25, Math.min(fitWidth, Math.max(fitHeight, 0.72)));
    },
    [layout.width, layout.height],
  );

  const placeView = useCallback(
    (zoom: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      setView({
        zoom,
        panX: (vw - layout.width * zoom) / 2,
        panY: Math.max(36, (vh - layout.height * zoom) / 2),
      });
    },
    [layout.width, layout.height],
  );

  const fit = useCallback(() => {
    const zoom = zoomFor('readable');
    if (zoom == null) return;
    placeView(zoom);
  }, [placeView, zoomFor]);

  const cardKey = forest.map((member) => member.id).join('|');
  useLayoutEffect(() => {
    if (cardKeyRef.current !== cardKey) {
      cardKeyRef.current = cardKey;
      userMoved.current = false;
    }
    if (!userMoved.current) fit();
  }, [cardKey, fit]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!userMoved.current) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      userMoved.current = true;
      const rect = el.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        setView((prev) => {
          const zoom = Math.min(1.75, Math.max(0.35, prev.zoom * (event.deltaY < 0 ? 1.08 : 0.92)));
          const worldX = (anchorX - prev.panX) / prev.zoom;
          const worldY = (anchorY - prev.panY) / prev.zoom;
          return { zoom, panX: anchorX - worldX * zoom, panY: anchorY - worldY * zoom };
        });
        return;
      }
      setView((prev) => ({
        ...prev,
        panX: prev.panX - event.deltaX,
        panY: prev.panY - event.deltaY,
      }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const id = service.scrollCardId;
    if (!id) return;
    const box = boxById.get(id);
    const el = viewportRef.current;
    if (!box || !el) return;
    userMoved.current = true;
    setView((prev) => ({
      ...prev,
      panX: el.clientWidth / 2 - (box.x + box.width / 2) * prev.zoom,
      panY: el.clientHeight / 2 - (box.y + box.height / 2) * prev.zoom,
    }));
    service.clearScrollCard();
  }, [service, service.scrollCardId, boxById]);

  useEffect(() => {
    const id = service.scrollAnnotationId;
    if (!id) return;
    const box = boxById.get(id);
    const el = viewportRef.current;
    if (!box || !el) return;
    userMoved.current = true;
    setView((prev) => ({
      ...prev,
      panX: el.clientWidth / 2 - (box.x + box.width / 2) * prev.zoom,
      panY: el.clientHeight / 2 - (box.y + box.height / 2) * prev.zoom,
    }));
    service.clearScrollAnnotation();
  }, [service, service.scrollAnnotationId, boxById]);

  const hint = drag ? dropHint(forest, drag.id, drag.over) : null;

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.doc-canvas-card, .doc-canvas-tools')) return;
    panGesture.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      panX: view.panX,
      panY: view.panY,
    };
    userMoved.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panGesture.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setView((prev) => ({
      ...prev,
      panX: pan.panX + (event.clientX - pan.originX),
      panY: pan.panY + (event.clientY - pan.originY),
    }));
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panGesture.current?.pointerId !== event.pointerId) return;
    panGesture.current = null;
  };

  const onNodePointerDown = (cardId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.note-op, .canvas-node-op, .mini-decision, .card-links, a, input, textarea')) {
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
    dragGesture.current = {
      id: cardId,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail for a synthetic pointer; moves on this node still count.
    }
  };

  const onNodePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dxPx = event.clientX - gesture.originX;
    const dyPx = event.clientY - gesture.originY;
    if (!gesture.moved && Math.hypot(dxPx, dyPx) < 6) return;
    gesture.moved = true;
    const rect = viewportRef.current?.getBoundingClientRect();
    const world = worldPoint(event.clientX, event.clientY);
    setDrag({
      id: gesture.id,
      dx: dxPx / view.zoom,
      dy: dyPx / view.zoom,
      x: rect ? event.clientX - rect.left : 0,
      y: rect ? event.clientY - rect.top : 0,
      over: hitCard(world.x, world.y, gesture.id),
    });
  };

  const onNodePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    dragGesture.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Already released.
    }
    if (!gesture.moved) {
      setDrag(null);
      return;
    }
    suppressClick.current = true;
    const world = worldPoint(event.clientX, event.clientY);
    const parentId = hitCard(world.x, world.y, gesture.id);
    const plan = dropHint(forest, gesture.id, parentId);
    setDrag(null);
    if (plan.accept) void service.placeOnCanvas(gesture.id, parentId);
  };

  const zoomBy = (factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    userMoved.current = true;
    const anchorX = el.clientWidth / 2;
    const anchorY = el.clientHeight / 2;
    setView((prev) => {
      const zoom = Math.min(1.75, Math.max(0.35, prev.zoom * factor));
      const worldX = (anchorX - prev.panX) / prev.zoom;
      const worldY = (anchorY - prev.panY) / prev.zoom;
      return { zoom, panX: anchorX - worldX * zoom, panY: anchorY - worldY * zoom };
    });
  };

  return (
    <div
      ref={viewportRef}
      className="doc-canvas"
      role="application"
      aria-label="脑图"
      style={{
        backgroundSize: `${22 * view.zoom}px ${22 * view.zoom}px`,
        backgroundPosition: `${view.panX}px ${view.panY}px`,
      }}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div
        className="doc-canvas-world"
        style={{
          width: Math.max(layout.width, 1),
          height: Math.max(layout.height, 1),
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
        }}
      >
        <svg
          className="doc-canvas-edges"
          width={Math.max(layout.width, 1)}
          height={Math.max(layout.height, 1)}
          aria-hidden
        >
          {layout.edges.map((edge) => {
            const from = boxById.get(edge.from);
            const to = boxById.get(edge.to);
            if (!from || !to) return null;
            return <path key={`${edge.from}-${edge.to}`} d={edgePath(from, to)} />;
          })}
        </svg>
        {forest.map((member) => {
          const box = boxById.get(member.id);
          if (!box) return null;
          const dragging = drag?.id === member.id;
          const accept = drag?.over === member.id && hint?.accept === true && hint.text === '成为子节点';
          const card = member.kind === 'card' ? cardById.get(member.id) : undefined;
          const note = member.kind === 'annotation' ? noteById.get(member.id) : undefined;
          const stored = nodeById.get(member.id);
          return (
            <SizedNode
              key={member.id}
              id={member.id}
              className={`doc-canvas-card${dragging ? ' is-dragging' : ''}${accept ? ' is-drop' : ''}`}
              style={{
                left: box.x,
                top: box.y,
                width: box.width,
                transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
              }}
              onSize={onSize}
              onPointerDown={(event) => onNodePointerDown(member.id, event)}
              onPointerMove={onNodePointerMove}
              onPointerUp={onNodePointerUp}
              onClickCapture={(event) => {
                if (!suppressClick.current) return;
                suppressClick.current = false;
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {card ? renderCard(card) : null}
              {note ? <CanvasNoteNode item={note} /> : null}
              {member.kind === 'text' || member.kind === 'image' ? (
                <CanvasFreeNode
                  id={member.id}
                  kind={member.kind}
                  text={stored?.text ?? ''}
                  imageKey={stored?.imageKey ?? null}
                />
              ) : null}
            </SizedNode>
          );
        })}
      </div>
      {hint?.text ? (
        <div className="doc-canvas-hint" style={{ left: drag?.x ?? 0, top: drag?.y ?? 0 }} role="status">
          {hint.text}
        </div>
      ) : (
        <p className="doc-canvas-tip">拖到节点上成为子节点，拖到空白处独立成树</p>
      )}
      <div className="doc-canvas-tools">
        <button type="button" aria-label="文本节点" onClick={() => void service.addCanvasText()}>
          <Type width={13} height={13} strokeWidth={1.8} />
          文本
        </button>
        <button
          type="button"
          aria-label="图片节点"
          disabled={service.canvasUploading}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus width={13} height={13} strokeWidth={1.8} />
          图片
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void service.addCanvasImage(file);
          }}
        />
        <button type="button" aria-label="缩小" onClick={() => zoomBy(1 / 1.12)}>
          －
        </button>
        <button type="button" aria-label="放大" onClick={() => zoomBy(1.12)}>
          ＋
        </button>
        <button
          type="button"
          aria-label="适配"
          onClick={() => {
            const zoom = zoomFor('all');
            if (zoom == null) return;
            userMoved.current = true;
            placeView(zoom);
          }}
        >
          适配
        </button>
      </div>
    </div>
  );
});
