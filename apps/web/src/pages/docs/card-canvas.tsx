/**
 * 文档脑图。平移、缩放的世界坐标里自动布局，节点不记住坐标。
 * 单击选中，卡片和批注同时把左侧正文滚到锚点；双击或 Enter 才编辑。
 * 拖到上下沿插入，拖到节点上成为子节点，拖到空白处独立成树。
 */
import {
  outlineChildSlots,
  planOutlinePlace,
  type DocumentCard,
  type OutlinePlacement,
} from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { ImagePlus, Plus, Redo2, Type, Undo2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { DialogService } from '@/services/dialog.service';
import { CanvasFreeNode, CanvasNoteNode } from './canvas-nodes';
import { CardLinks } from './card-link-list';
import { DocsService } from './docs.service';
import {
  childPlace,
  foldedAway,
  foldsHiding,
  indentPlace,
  navigateMind,
  nudgePlace,
  outdentPlace,
  placeFromDrop,
  siblingInsert,
} from './mindmap-edit';
import { loadFolds, saveFolds } from './mindmap-fold';
import { decideMindGesture, type MindIntent } from './mindmap-gesture';
import { hitMindDrop, type MindDrop } from './mindmap-hit';
import { layoutMindForest, type MindBox } from './mindmap-layout';

const NODE_W = 232;
const NODE_H = 96;

type Drag = {
  id: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
  drop: MindDrop;
};

function hintFor(
  drop: MindDrop,
  plan: OutlinePlacement | null,
): { text: string | null; accept: boolean } {
  if (!plan || !plan.ok) {
    return {
      text: plan && !plan.ok && plan.reason === 'depth' ? '层级太深了' : '不能放到这里',
      accept: false,
    };
  }
  if (plan.unchanged) return { text: null, accept: false };
  if (drop.kind === 'root') return { text: '独立成树', accept: true };
  if (drop.kind === 'child') return { text: '成为子节点', accept: true };
  if (drop.kind === 'before') return { text: '排在前面', accept: true };
  return { text: '排在后面', accept: true };
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
  onDoubleClick,
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
  onDoubleClick: (event: MouseEvent<HTMLDivElement>) => void;
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
      onDoubleClick={onDoubleClick}
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
/** 这些控件自己处理点击，不拿来拖节点、也不抢选中。卡片本身是按钮，不在这里。 */
const NODE_CONTROLS = '.note-op, .canvas-node-op, .canvas-add, .canvas-fold, .mini-decision, .card-links, a, input, textarea';
const KEY_CONTROLS = '.doc-canvas-tools, .canvas-add, .canvas-fold, .canvas-node-op, .note-op, textarea, input';

export const CardCanvas = observer(function CardCanvas({
  renderCard,
}: {
  renderCard: (card: DocumentCard, selected: boolean) => ReactNode;
}) {
  const service = useService(DocsService);
  const dialog = useService(DialogService);
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const docId = service.doc?.id ?? null;
  const [foldDoc, setFoldDoc] = useState(docId);
  const [folded, setFolded] = useState<Set<string>>(() => new Set(docId ? loadFolds(docId) : []));
  if (foldDoc !== docId) {
    setFoldDoc(docId);
    setFolded(new Set(docId ? loadFolds(docId) : []));
    setSelectedId(null);
    setEditingId(null);
  }

  const onSize = useCallback((id: string, w: number, h: number) => {
    setSizes((prev) => {
      const current = prev[id];
      if (current && Math.abs(current.w - w) < 2 && Math.abs(current.h - h) < 2) return prev;
      return { ...prev, [id]: { w, h } };
    });
  }, []);

  const forest = service.canvasForest;
  const hidden = useMemo(() => foldedAway(forest, folded), [forest, folded]);
  const visible = useMemo(
    () => forest.filter((member) => !hidden.has(member.id)),
    [forest, hidden],
  );
  const childCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const member of forest) {
      if (!member.parentId) continue;
      map.set(member.parentId, (map.get(member.parentId) ?? 0) + 1);
    }
    return map;
  }, [forest]);
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
        visible.map((member) => ({
          id: member.id,
          parentId: hidden.has(member.parentId ?? '') ? null : member.parentId,
          position: member.position,
          width: sizes[member.id]?.w ?? NODE_W,
          height: sizes[member.id]?.h ?? NODE_H,
        })),
      ),
    [visible, hidden, sizes],
  );
  const boxById = useMemo(() => new Map(layout.boxes.map((box) => [box.id, box])), [layout.boxes]);

  useEffect(() => {
    if (!docId) return;
    saveFolds(docId, [...folded]);
  }, [docId, folded]);

  useEffect(() => {
    if (!selectedId) return;
    if (hidden.has(selectedId) || !forest.some((member) => member.id === selectedId)) {
      setSelectedId(null);
      setEditingId(null);
    }
  }, [selectedId, hidden, forest]);

  const worldPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.panX) / view.zoom,
      y: (clientY - rect.top - view.panY) / view.zoom,
    };
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

  const cardKey = visible.map((member) => member.id).join('|');
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

  const revealFolded = (id: string): boolean => {
    const hiding = foldsHiding(forest, id, folded);
    if (hiding.length === 0) return false;
    setFolded((prev) => {
      const next = new Set(prev);
      for (const fold of hiding) next.delete(fold);
      return next;
    });
    return true;
  };

  useEffect(() => {
    const id = service.scrollCardId;
    if (!id) return;
    if (!forest.some((member) => member.id === id)) {
      service.clearScrollCard();
      return;
    }
    if (revealFolded(id)) return;
    const box = boxById.get(id);
    const el = viewportRef.current;
    if (!box || !el) return;
    userMoved.current = true;
    setSelectedId(id);
    setView((prev) => ({
      ...prev,
      panX: el.clientWidth / 2 - (box.x + box.width / 2) * prev.zoom,
      panY: el.clientHeight / 2 - (box.y + box.height / 2) * prev.zoom,
    }));
    service.clearScrollCard();
  }, [service, service.scrollCardId, boxById, forest, folded]);

  useEffect(() => {
    const id = service.scrollAnnotationId;
    if (!id) return;
    if (!forest.some((member) => member.id === id)) {
      service.clearScrollAnnotation();
      return;
    }
    if (revealFolded(id)) return;
    const box = boxById.get(id);
    const el = viewportRef.current;
    if (!box || !el) return;
    userMoved.current = true;
    setSelectedId(id);
    setView((prev) => ({
      ...prev,
      panX: el.clientWidth / 2 - (box.x + box.width / 2) * prev.zoom,
      panY: el.clientHeight / 2 - (box.y + box.height / 2) * prev.zoom,
    }));
    service.clearScrollAnnotation();
  }, [service, service.scrollAnnotationId, boxById, forest, folded]);

  const reveal = (id: string) => {
    setFolded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleFold = (id: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addText = async (parentId: string | null, index: number) => {
    if (parentId) reveal(parentId);
    const id = await service.addCanvasTextAt(parentId, index);
    if (!id) return;
    selectedRef.current = id;
    setSelectedId(id);
    setEditingId(id);
  };

  const dropTarget = drag ? placeFromDrop(forest, drag.id, drag.drop) : null;
  const dropPlan = drag && dropTarget
    ? planOutlinePlace(forest, drag.id, dropTarget.parentId, dropTarget.index)
    : null;
  const hint = drag ? hintFor(drag.drop, dropPlan) : null;
  const insertAt =
    drag && hint?.accept && (drag.drop.kind === 'before' || drag.drop.kind === 'after')
      ? boxById.get(drag.drop.siblingId)
      : null;

  const applyMind = (id: string, intent: MindIntent) => {
    if (intent.type === 'ignore') return;
    if (intent.type === 'cancel-draft') {
      setEditingId(null);
      return;
    }
    if (intent.type === 'clear') {
      setSelectedId(null);
      setEditingId(null);
      return;
    }
    selectedRef.current = id;
    setSelectedId(id);
    if (intent.type === 'select') {
      setEditingId(null);
      if (intent.reveal) service.selectCanvasNode(id);
      viewportRef.current?.focus({ preventScroll: true });
      return;
    }
    if (intent.editor === 'inline-text' || intent.editor === 'inline-note') {
      setEditingId(id);
      return;
    }
    if (intent.editor === 'card-dialog') {
      setEditingId(null);
      service.openCardEdit(id);
    }
  };

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.doc-canvas-card, .doc-canvas-tools, .doc-canvas-links')) return;
    applyMind('', decideMindGesture({ action: 'empty' }));
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
    if (target instanceof Element && target.closest(NODE_CONTROLS)) {
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
      drop: hitMindDrop(layout.boxes, world.x, world.y, gesture.id),
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
    if (decideMindGesture({ action: 'drag' }).type === 'ignore') suppressClick.current = true;
    const world = worldPoint(event.clientX, event.clientY);
    const drop = hitMindDrop(layout.boxes, world.x, world.y, gesture.id);
    const place = placeFromDrop(forest, gesture.id, drop);
    const plan = place ? planOutlinePlace(forest, gesture.id, place.parentId, place.index) : null;
    setDrag(null);
    if (!place || !plan?.ok || plan.unchanged) return;
    if (drop.kind === 'child') reveal(drop.parentId);
    void service.placeOnCanvas(gesture.id, place.parentId, place.index);
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

  const ensureVisible = (id: string) => {
    const box = boxById.get(id);
    const el = viewportRef.current;
    if (!box || !el) return;
    setView((prev) => {
      const left = box.x * prev.zoom + prev.panX;
      const top = box.y * prev.zoom + prev.panY;
      const right = left + box.width * prev.zoom;
      const bottom = top + box.height * prev.zoom;
      let panX = prev.panX;
      let panY = prev.panY;
      if (left < 24) panX += 24 - left;
      else if (right > el.clientWidth - 24) panX -= right - (el.clientWidth - 24);
      if (top < 24) panY += 24 - top;
      else if (bottom > el.clientHeight - 24) panY -= bottom - (el.clientHeight - 24);
      if (panX === prev.panX && panY === prev.panY) return prev;
      userMoved.current = true;
      return { ...prev, panX, panY };
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || dialog.current) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('textarea, input, [contenteditable="true"]')) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopPropagation();
      void (event.shiftKey ? service.redoCanvas() : service.undoCanvas());
      return;
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      event.stopPropagation();
      void service.redoCanvas();
      return;
    }
    if (target.closest(KEY_CONTROLS)) return;
    if (!selectedId) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      applyMind(selectedId, decideMindGesture({ action: 'escape', editing: editingId !== null }));
      return;
    }
    const member = forest.find((item) => item.id === selectedId);
    if (!member) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      applyMind(selectedId, decideMindGesture({ action: 'enter', kind: member.kind }));
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      const place = event.shiftKey ? outdentPlace(forest, selectedId) : indentPlace(forest, selectedId);
      if (place) {
        if (place.parentId) reveal(place.parentId);
        void service.placeOnCanvas(selectedId, place.parentId, place.index);
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      if (member.kind === 'text' || member.kind === 'image') void service.removeCanvasNode(selectedId);
      else if (member.kind === 'card') void service.archiveDocCard(selectedId);
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      event.stopPropagation();
      const place = nudgePlace(forest, selectedId, event.key === 'ArrowUp' ? -1 : 1);
      if (place) void service.placeOnCanvas(selectedId, place.parentId, place.index);
      return;
    }
    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      event.preventDefault();
      event.stopPropagation();
      const action = navigateMind(forest, selectedId, event.key, folded);
      if (action.type === 'fold' || action.type === 'unfold') toggleFold(selectedId);
      else if (action.type === 'select') {
        const next = forest.find((item) => item.id === action.id);
        if (next) applyMind(action.id, decideMindGesture({ action: 'arrow', kind: next.kind }));
        ensureVisible(action.id);
      }
    }
  };

  const onAddChild = (id: string) => {
    reveal(id);
    const place = childPlace(forest, id);
    void addText(place.parentId, place.index);
  };

  const onAddSibling = (id: string) => {
    const place = siblingInsert(forest, id);
    if (place) void addText(place.parentId, place.index);
  };

  return (
    <div className="doc-canvas">
      <aside className="doc-canvas-links" aria-label="脉络">
        {selectedId && cardById.has(selectedId) ? (
          <CardLinks cardId={selectedId} documentId={docId} />
        ) : (
          <p className="hint">选中一张卡片，脉络显示在这里。</p>
        )}
      </aside>
      <div
        ref={viewportRef}
        className="doc-canvas-stage"
        role="application"
        tabIndex={0}
        aria-label="脑图"
        style={{
          backgroundSize: `${22 * view.zoom}px ${22 * view.zoom}px`,
          backgroundPosition: `${view.panX}px ${view.panY}px`,
        }}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onKeyDown={onKeyDown}
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
        {insertAt && drag ? (
          <div
            className="doc-canvas-insert"
            style={{
              left: insertAt.x,
              top: drag.drop.kind === 'before' ? insertAt.y - 5 : insertAt.y + insertAt.height + 3,
              width: insertAt.width,
            }}
          />
        ) : null}
        {visible.map((member) => {
          const box = boxById.get(member.id);
          if (!box) return null;
          const dragging = drag?.id === member.id;
          const accept = drag?.drop.kind === 'child' && drag.drop.parentId === member.id && hint?.accept === true;
          const card = member.kind === 'card' ? cardById.get(member.id) : undefined;
          const note = member.kind === 'annotation' ? noteById.get(member.id) : undefined;
          const stored = nodeById.get(member.id);
          const count = childCount.get(member.id) ?? 0;
          const selected = selectedId === member.id;
          return (
            <SizedNode
              key={member.id}
              id={member.id}
              className={`doc-canvas-card${dragging ? ' is-dragging' : ''}${accept ? ' is-drop' : ''}${selected ? ' is-selected' : ''}`}
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
                if (suppressClick.current) {
                  suppressClick.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                const target = event.target;
                if (target instanceof Element && target.closest(NODE_CONTROLS)) return;
                applyMind(
                  member.id,
                  decideMindGesture({
                    action: 'click',
                    kind: member.kind,
                    repeat: selectedRef.current === member.id,
                  }),
                );
                event.preventDefault();
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                const target = event.target;
                if (target instanceof Element && target.closest(NODE_CONTROLS)) return;
                applyMind(member.id, decideMindGesture({ action: 'double-click', kind: member.kind }));
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {card ? renderCard(card, selected) : null}
              {note ? (
                <CanvasNoteNode
                  item={note}
                  editing={editingId === member.id}
                  onCloseEdit={() => setEditingId((current) => (current === member.id ? null : current))}
                />
              ) : null}
              {member.kind === 'text' || member.kind === 'image' ? (
                <CanvasFreeNode
                  id={member.id}
                  kind={member.kind}
                  text={stored?.text ?? ''}
                  imageKey={stored?.imageKey ?? null}
                  editing={editingId === member.id}
                  onCloseEdit={() => setEditingId((current) => (current === member.id ? null : current))}
                />
              ) : null}
              {count > 0 ? (
                <button
                  type="button"
                  className={`canvas-fold${folded.has(member.id) ? ' is-folded' : ''}`}
                  aria-expanded={!folded.has(member.id)}
                  aria-label={folded.has(member.id) ? `展开，下面有 ${count} 个` : '折叠'}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFold(member.id);
                    viewportRef.current?.focus();
                  }}
                >
                  {folded.has(member.id) ? count : '–'}
                </button>
              ) : null}
              <button
                type="button"
                className="canvas-add is-child"
                aria-label="加子节点"
                title="加子节点"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddChild(member.id);
                }}
              >
                <Plus width={12} height={12} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="canvas-add is-sibling"
                aria-label="加兄弟节点"
                title="加兄弟节点"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddSibling(member.id);
                }}
              >
                <Plus width={12} height={12} strokeWidth={1.8} />
              </button>
            </SizedNode>
          );
        })}
      </div>
      {hint?.text ? (
        <div className="doc-canvas-hint" style={{ left: drag?.x ?? 0, top: drag?.y ?? 0 }} role="status">
          {hint.text}
        </div>
      ) : null}
      <div className="doc-canvas-tools">
        <button
          type="button"
          aria-label="撤销"
          disabled={service.canvasUndo === 0}
          onClick={() => void service.undoCanvas()}
        >
          <Undo2 width={13} height={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="重做"
          disabled={service.canvasRedo === 0}
          onClick={() => void service.redoCanvas()}
        >
          <Redo2 width={13} height={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="文本节点"
          onClick={() => {
            const parent = selectedRef.current;
            if (parent && forest.some((member) => member.id === parent)) {
              onAddChild(parent);
              return;
            }
            void addText(null, outlineChildSlots(forest, null).length);
          }}
        >
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
            if (!file) return;
            const parent = selectedRef.current;
            if (parent) reveal(parent);
            void service.addCanvasImage(file, parent);
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
    </div>
  );
});
