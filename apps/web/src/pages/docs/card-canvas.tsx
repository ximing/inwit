/**
 * 文档脑图。平移、缩放的世界坐标里自动布局，节点不记住坐标。
 * 单击选中，卡片和批注同时把左侧正文滚到锚点；空格或双击进入编辑。
 * Tab 加子节点，Enter 加兄弟节点，⌘] / ⌘[ 缩进提升。
 * 双击空白新建文本节点。选中卡片时脉络以浮层锚在节点旁，
 * 本文内的关联画成虚线边；选中后无关节点弱化，小地图帮助定位。
 * 拖到上下沿插入，拖到节点上成为子节点，拖到空白处独立成树。
 */
import {
  outlineChildSlots,
  planOutlinePlace,
  type CardLinkType,
  type DocumentCard,
} from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import {
  CornerDownRight,
  ImagePlus,
  Pencil,
  Plus,
  Redo2,
  Search,
  Trash2,
  Type,
  Undo2,
  Waypoints,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Tip } from '@/components/tip';
import { createCardLink } from '@/api/cards';
import { errorMessage } from '@/api/client';
import { DialogService } from '@/services/dialog.service';
import { CanvasFreeNode, CanvasNoteNode } from './canvas-nodes';
import { useCardLinks } from './card-link-list';
import {
  CanvasLinkEditor,
  CanvasLinksPanel,
  LINKS_PANEL_H,
  LINKS_PANEL_W,
} from './canvas-links-panel';
import { CanvasMinimap } from './canvas-minimap';
import {
  CanvasHelp,
  CanvasMenu,
  CanvasMultiBar,
  CanvasSearch,
  type CanvasMenuItem,
} from './canvas-overlays';
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
  placeGroupFromDrop,
  planGroupPlace,
  siblingInsert,
} from './mindmap-edit';
import { loadFolds, saveFolds } from './mindmap-fold';
import {
  edgeAutoPan,
  linksPanelAnchor,
  mindCardTodo,
  mindMarqueeHits,
  mindRelated,
  mindSearchIds,
  mindTodoCounts,
  mindTopmostSelected,
  type MindCardTodo,
} from './mindmap-focus';
import { decideMindGesture, type MindIntent } from './mindmap-gesture';
import { hitCardBox, hitMindDrop, type MindDrop } from './mindmap-hit';
import { layoutMindForest, type MindBox } from './mindmap-layout';
import { parseQuoteDrag, quoteDropPlace, QUOTE_DRAG_MIME, type QuoteDragPayload } from './mindmap-quote';

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

type PlaceVerdict =
  | { ok: true; unchanged: boolean }
  | { ok: false; reason: 'missing' | 'self' | 'cycle' | 'depth' }
  | null;

function hintFor(
  drop: MindDrop,
  plan: PlaceVerdict,
  count = 1,
): { text: string | null; accept: boolean } {
  if (!plan || !plan.ok) {
    return {
      text: plan && !plan.ok && plan.reason === 'depth' ? '层级太深了' : '不能放到这里',
      accept: false,
    };
  }
  if (plan.unchanged) return { text: null, accept: false };
  const prefix = count > 1 ? `${count} 个节点：` : '';
  if (drop.kind === 'root') return { text: `${prefix}独立成树`, accept: true };
  if (drop.kind === 'child') return { text: `${prefix}成为子节点`, accept: true };
  if (drop.kind === 'before') return { text: `${prefix}排在前面`, accept: true };
  return { text: `${prefix}排在后面`, accept: true };
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
      data-node-id={id}
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

/** 脉络虚线边：中心对中心，方向任意，画在节点底下。 */
function ghostPath(from: MindBox, to: MindBox): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height / 2;
  const x2 = to.x + to.width / 2;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(32, Math.min(140, Math.abs(x2 - x1) / 2)) * (x2 >= x1 ? 1 : -1);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
/** 这些控件自己处理点击，不拿来拖节点、也不抢选中。卡片本身是按钮，不在这里。 */
const NODE_CONTROLS = '.note-op, .canvas-node-op, .canvas-fold, .canvas-node-bar, .canvas-link-dot, .mini-decision, .card-links, a, input, textarea';
const KEY_CONTROLS = '.doc-canvas-tools, .canvas-fold, .canvas-node-op, .canvas-node-bar, .note-op, textarea, input';

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
  /** 多选集合；恰好一个时退化为单选，脉络浮层、节点工具条、编辑态只看单选。 */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedId = selectedIds.size === 1 ? ([...selectedIds][0] ?? null) : null;
  const setSelectedId = (id: string | null) =>
    setSelectedIds(id ? new Set([id]) : new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 脉络浮层被手动关掉的卡片；再选回这张卡时不自动重开，工具条可以开。 */
  const [linksOff, setLinksOff] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  /** 只看待办：没有待办的节点淡出。 */
  const [todoOnly, setTodoOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /** 默写模式：自动折叠全部子树、遮住节点内容，单击偷看一张。 */
  const [recall, setRecall] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [revealAll, setRevealAll] = useState(false);
  const recallFolds = useRef<Set<string> | null>(null);
  /** Shift+拖空白的框选矩形（舞台坐标）。 */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** 正文选区拖引文进来时的落点预览（drop 是世界坐标判定，x/y 是舞台坐标）。 */
  const [quoteDrag, setQuoteDrag] = useState<{ x: number; y: number; drop: MindDrop } | null>(null);
  /** 手绘关系边：起点卡 + 指针世界坐标；松开落在卡片上时转成 linkEditor。 */
  const [linkDraft, setLinkDraft] = useState<{
    fromId: string;
    x: number;
    y: number;
    hoverId: string | null;
  } | null>(null);
  /** 关系类型选择浮层（舞台坐标）。 */
  const [linkEditor, setLinkEditor] = useState<{
    fromId: string;
    toId: string;
    x: number;
    y: number;
  } | null>(null);
  const [linkSaving, setLinkSaving] = useState(false);
  /** 新建关联后递增，让脉络浮层和画外虚线重新拉取。 */
  const [linksTick, setLinksTick] = useState(0);
  const marqueeGesture = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
  } | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const viewRef = useRef(view);
  viewRef.current = view;
  const animRef = useRef<number | null>(null);
  const reduceMotion = useRef(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const stopViewAnim = useCallback(() => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  }, []);

  /** 视口变化统一走这里：带缓动，减少动画偏好下瞬移。 */
  const animateView = useCallback(
    (next: { panX: number; panY: number; zoom: number }, ms = 180) => {
      stopViewAnim();
      const from = viewRef.current;
      if (from.panX === next.panX && from.panY === next.panY && from.zoom === next.zoom) return;
      if (reduceMotion.current || ms <= 0) {
        setView(next);
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        const ease = 1 - Math.pow(1 - k, 3);
        setView({
          zoom: from.zoom + (next.zoom - from.zoom) * ease,
          panX: from.panX + (next.panX - from.panX) * ease,
          panY: from.panY + (next.panY - from.panY) * ease,
        });
        animRef.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      animRef.current = requestAnimationFrame(step);
    },
    [stopViewAnim],
  );

  useEffect(() => stopViewAnim, [stopViewAnim]);

  const docId = service.doc?.id ?? null;
  const [foldDoc, setFoldDoc] = useState(docId);
  const [folded, setFolded] = useState<Set<string>>(() => new Set(docId ? loadFolds(docId) : []));
  if (foldDoc !== docId) {
    setFoldDoc(docId);
    setFolded(new Set(docId ? loadFolds(docId) : []));
    setSelectedId(null);
    setEditingId(null);
    setLinksOff(null);
    setTodoOnly(false);
    setSearchOpen(false);
    setMenu(null);
    setRecall(false);
    setPeekId(null);
    setRevealAll(false);
    recallFolds.current = null;
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
  /** 画布上可作关系边落点的卡片 id。 */
  const cardIdSet = useMemo(() => new Set(cardById.keys()), [cardById]);

  /** 进入默写：记住折叠现场并收起全部子树；退出时还原。 */
  const toggleRecall = () => {
    if (recall) {
      setRecall(false);
      setPeekId(null);
      setRevealAll(false);
      if (recallFolds.current) setFolded(recallFolds.current);
      recallFolds.current = null;
      return;
    }
    recallFolds.current = new Set(folded);
    setFolded(new Set([...folded, ...childCount.keys()]));
    setRecall(true);
    setPeekId(null);
    setRevealAll(false);
    setEditingId(null);
    setMenu(null);
  };
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

  /** 选中节点的祖先链加子树；其余节点与连线弱化。 */
  const related = useMemo(
    () => (selectedId ? mindRelated(forest, selectedId) : null),
    [forest, selectedId],
  );
  /** 选中卡片且没被手动关掉时，脉络浮层开着。默写模式下不看脉络。 */
  const linksCardId =
    !recall && selectedId && cardById.has(selectedId) && linksOff !== selectedId
      ? selectedId
      : null;
  const { links: selectedLinks } = useCardLinks(linksCardId, linksTick);
  /** 本文内、且在画布上的关联卡片，画虚线边。 */
  const ghostTargets = useMemo(() => {
    if (!linksCardId || !selectedLinks) return [];
    const seen = new Set<string>();
    const targets: string[] = [];
    for (const item of [...selectedLinks.outgoing, ...selectedLinks.incoming]) {
      const id = item.card.id;
      if (id === linksCardId || seen.has(id) || !boxById.has(id)) continue;
      if (item.card.documentId == null || item.card.documentId !== docId) continue;
      seen.add(id);
      targets.push(id);
    }
    return targets;
  }, [linksCardId, selectedLinks, boxById, docId]);

  /** 卡片待办（待确认/到期复习）与子树待办计数。 */
  const cardTodos = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, MindCardTodo>();
    for (const [id, card] of cardById) {
      const todo = mindCardTodo(card, now);
      if (todo) map.set(id, todo);
    }
    return map;
  }, [cardById]);
  const todoCounts = useMemo(() => mindTodoCounts(forest, cardTodos), [forest, cardTodos]);

  /** 画布内搜索的语料：卡片题面、批注引文与想法、文本节点。 */
  const haystacks = useMemo(
    () =>
      visible.map((member): readonly [string, string] => {
        if (member.kind === 'card') {
          const card = cardById.get(member.id);
          return [
            member.id,
            card ? `${card.concept} ${card.questions.map((q) => q.question).join(' ')}` : '',
          ];
        }
        if (member.kind === 'annotation') {
          const note = noteById.get(member.id);
          return [member.id, note ? `${note.quote} ${note.note}` : ''];
        }
        return [member.id, nodeById.get(member.id)?.text ?? ''];
      }),
    [visible, cardById, noteById, nodeById],
  );
  const searchMatches = useMemo(
    () => mindSearchIds(haystacks, searchQuery),
    [haystacks, searchQuery],
  );

  useEffect(() => {
    // 默写模式的整体折叠是临时的，退出时还原，不持久化。
    if (!docId || recall) return;
    saveFolds(docId, [...folded]);
  }, [docId, folded, recall]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set(
        [...prev].filter((id) => !hidden.has(id) && forest.some((member) => member.id === id)),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [hidden, forest]);

  useEffect(() => {
    if (selectedId) return;
    setEditingId(null);
  }, [selectedId]);

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
      animateView({
        zoom,
        panX: (vw - layout.width * zoom) / 2,
        panY: Math.max(36, (vh - layout.height * zoom) / 2),
      });
    },
    [animateView, layout.width, layout.height],
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
      setStageSize({ width: el.clientWidth, height: el.clientHeight });
      if (!userMoved.current) fit();
    });
    observer.observe(el);
    setStageSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      stopViewAnim();
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
  }, [stopViewAnim]);

  const centerOn = useCallback(
    (id: string) => {
      const box = boxById.get(id);
      const el = viewportRef.current;
      if (!box || !el) return;
      userMoved.current = true;
      animateView({
        zoom: viewRef.current.zoom,
        panX: el.clientWidth / 2 - (box.x + box.width / 2) * viewRef.current.zoom,
        panY: el.clientHeight / 2 - (box.y + box.height / 2) * viewRef.current.zoom,
      });
    },
    [boxById, animateView],
  );

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
    setSelectedId(id);
    centerOn(id);
    service.clearScrollCard();
  }, [service, service.scrollCardId, forest, folded, centerOn]);

  useEffect(() => {
    const id = service.scrollAnnotationId;
    if (!id) return;
    if (!forest.some((member) => member.id === id)) {
      service.clearScrollAnnotation();
      return;
    }
    if (revealFolded(id)) return;
    setSelectedId(id);
    centerOn(id);
    service.clearScrollAnnotation();
  }, [service, service.scrollAnnotationId, forest, folded, centerOn]);

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
    if (recall) return;
    if (parentId) reveal(parentId);
    const id = await service.addCanvasTextAt(parentId, index);
    if (!id) return;
    selectedRef.current = id;
    setSelectedId(id);
    setEditingId(id);
  };

  /** 拖的是多选成员时整组一起动；只下发顶层被选节点（祖先在组里的随祖先走）。 */
  const dragGroup =
    drag && selectedIds.has(drag.id) && selectedIds.size > 1
      ? mindTopmostSelected(forest, selectedIds)
      : null;
  const dragPlace = drag
    ? dragGroup
      ? placeGroupFromDrop(forest, dragGroup, drag.drop)
      : placeFromDrop(forest, drag.id, drag.drop)
    : null;
  const dragVerdict: PlaceVerdict =
    drag && dragPlace
      ? dragGroup
        ? planGroupPlace(forest, dragGroup, dragPlace)
        : planOutlinePlace(forest, drag.id, dragPlace.parentId, dragPlace.index)
      : null;
  const hint = drag ? hintFor(drag.drop, dragVerdict, dragGroup?.length ?? 1) : null;
  const insertAt =
    drag && hint?.accept && (drag.drop.kind === 'before' || drag.drop.kind === 'after')
      ? boxById.get(drag.drop.siblingId)
      : null;
  const quoteInsertAt =
    quoteDrag && (quoteDrag.drop.kind === 'before' || quoteDrag.drop.kind === 'after')
      ? boxById.get(quoteDrag.drop.siblingId)
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
      setPeekId(null);
      return;
    }
    // 默写模式下不进入编辑，单击只是选中（和偷看）。
    if (recall && intent.type === 'edit') return;
    const previous = selectedRef.current;
    selectedRef.current = id;
    setSelectedId(id);
    if (intent.type === 'select') {
      // 选中别的节点时，先前偷看的那张重新盖上（点击偷看在 applyMind 之后单独设置）。
      if (recall && previous !== id) setPeekId(null);
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

  const stagePoint = (event: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: 0, y: 0 };
  };

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (menu) {
      setMenu(null);
      if (!target.closest('.canvas-menu')) return;
    }
    if (target.closest('.doc-canvas-card, .doc-canvas-tools, .canvas-links-panel, .canvas-link-editor, .canvas-node-bar, .doc-canvas-minimap, .canvas-menu, .canvas-search, .canvas-help, .canvas-multi-bar')) return;
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    stopViewAnim();
    if (event.button === 0 && event.shiftKey) {
      // Shift+拖空白：框选。起点用舞台坐标，松手时换成世界坐标算命中。
      const point = stagePoint(event);
      marqueeGesture.current = { pointerId: event.pointerId, originX: point.x, originY: point.y };
      setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
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
    const box = marqueeGesture.current;
    if (box && box.pointerId === event.pointerId) {
      const point = stagePoint(event);
      setMarquee({
        x: Math.min(box.originX, point.x),
        y: Math.min(box.originY, point.y),
        w: Math.abs(point.x - box.originX),
        h: Math.abs(point.y - box.originY),
      });
      return;
    }
    const pan = panGesture.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setView((prev) => ({
      ...prev,
      panX: pan.panX + (event.clientX - pan.originX),
      panY: pan.panY + (event.clientY - pan.originY),
    }));
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = marqueeGesture.current;
    if (box && box.pointerId === event.pointerId) {
      marqueeGesture.current = null;
      const rect = marquee;
      setMarquee(null);
      if (rect && rect.w > 4 && rect.h > 4) {
        const a = {
          x: (rect.x - viewRef.current.panX) / viewRef.current.zoom,
          y: (rect.y - viewRef.current.panY) / viewRef.current.zoom,
        };
        const b = {
          x: (rect.x + rect.w - viewRef.current.panX) / viewRef.current.zoom,
          y: (rect.y + rect.h - viewRef.current.panY) / viewRef.current.zoom,
        };
        const hits = mindMarqueeHits(layout.boxes, a, b);
        setSelectedIds((prev) => new Set([...prev, ...hits]));
      }
      return;
    }
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
    // 默写模式下不拖节点，点击仍走 onClickCapture 的选中/偷看。
    if (recall) return;
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
    const group =
      selectedIds.has(gesture.id) && selectedIds.size > 1
        ? new Set(mindTopmostSelected(forest, selectedIds))
        : gesture.id;
    setDrag({
      id: gesture.id,
      dx: dxPx / view.zoom,
      dy: dyPx / view.zoom,
      x: rect ? event.clientX - rect.left : 0,
      y: rect ? event.clientY - rect.top : 0,
      drop: hitMindDrop(layout.boxes, world.x, world.y, group),
    });
    if (rect) {
      const pan = edgeAutoPan(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        { width: rect.width, height: rect.height },
      );
      if (pan) {
        userMoved.current = true;
        setView((prev) => ({ ...prev, panX: prev.panX + pan.dx, panY: prev.panY + pan.dy }));
      }
    }
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
    const groupIds =
      selectedIds.has(gesture.id) && selectedIds.size > 1
        ? mindTopmostSelected(forest, selectedIds)
        : null;
    const drop = hitMindDrop(
      layout.boxes,
      world.x,
      world.y,
      groupIds ? new Set(groupIds) : gesture.id,
    );
    setDrag(null);
    if (groupIds) {
      // 整组拖动：落点换成「整组拿掉后」的下标，任一节点放不下就整组不动。
      const place = placeGroupFromDrop(forest, groupIds, drop);
      if (!place) return;
      const verdict = planGroupPlace(forest, groupIds, place);
      if (!verdict.ok) {
        service.showToast(verdict.reason === 'depth' ? '层级太深了' : '不能放到这里');
        return;
      }
      if (verdict.unchanged) return;
      if (drop.kind === 'child') reveal(drop.parentId);
      groupIds.forEach((id, index) => {
        void service.placeOnCanvas(id, place.parentId, place.index + index);
      });
      return;
    }
    const place = placeFromDrop(forest, gesture.id, drop);
    const plan = place ? planOutlinePlace(forest, gesture.id, place.parentId, place.index) : null;
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
    const prev = viewRef.current;
    const zoom = Math.min(1.75, Math.max(0.35, prev.zoom * factor));
    const worldX = (anchorX - prev.panX) / prev.zoom;
    const worldY = (anchorY - prev.panY) / prev.zoom;
    animateView({ zoom, panX: anchorX - worldX * zoom, panY: anchorY - worldY * zoom }, 140);
  };

  const ensureVisible = (id: string) => {
    const box = boxById.get(id);
    const el = viewportRef.current;
    if (!box || !el) return;
    const prev = viewRef.current;
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
    if (panX === prev.panX && panY === prev.panY) return;
    userMoved.current = true;
    animateView({ zoom: prev.zoom, panX, panY }, 140);
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
    if (meta && (event.key === '0' || event.key === '=' || event.key === '+' || event.key === '-')) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === '0') {
        const zoom = zoomFor('all');
        if (zoom == null) return;
        userMoved.current = true;
        placeView(zoom);
      } else {
        zoomBy(event.key === '-' ? 1 / 1.2 : 1.2);
      }
      return;
    }
    if (meta && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(true);
      return;
    }
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIds(new Set(visible.map((member) => member.id)));
      return;
    }
    if (event.key === 'Escape' && linkDraft) {
      event.preventDefault();
      event.stopPropagation();
      setLinkDraft(null);
      return;
    }
    if (event.key === 'Escape' && linkEditor) {
      event.preventDefault();
      event.stopPropagation();
      setLinkEditor(null);
      return;
    }
    if (event.key === 'Escape' && menu) {
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      return;
    }
    if (helpOpen) {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        event.stopPropagation();
        setHelpOpen(false);
      }
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      event.stopPropagation();
      setHelpOpen(true);
      return;
    }
    if (!meta && (event.key === 'm' || event.key === 'M')) {
      event.preventDefault();
      event.stopPropagation();
      toggleRecall();
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
    if (recall) {
      // 默写模式只保留方向键导航和折叠展开。
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
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      onAddSibling(selectedId);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      applyMind(selectedId, decideMindGesture({ action: 'enter', kind: member.kind }));
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        const place = outdentPlace(forest, selectedId);
        if (place) void service.placeOnCanvas(selectedId, place.parentId, place.index);
      } else {
        onAddChild(selectedId);
      }
      return;
    }
    if (meta && (event.key === ']' || event.key === '[')) {
      event.preventDefault();
      event.stopPropagation();
      const place =
        event.key === ']' ? indentPlace(forest, selectedId) : outdentPlace(forest, selectedId);
      if (place) {
        if (place.parentId) reveal(place.parentId);
        void service.placeOnCanvas(selectedId, place.parentId, place.index);
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      if (selectedIds.size > 1) {
        batchArchive();
        return;
      }
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

  /** 多选里的卡片节点；批注没有复习操作。 */
  const selectedCards = [...selectedIds]
    .map((id) => cardById.get(id))
    .filter((card): card is DocumentCard => Boolean(card));

  const batchArchive = () => {
    for (const id of selectedIds) {
      const member = forest.find((item) => item.id === id);
      if (!member) continue;
      if (member.kind === 'card') void service.archiveDocCard(id);
      else if (member.kind === 'text' || member.kind === 'image') void service.removeCanvasNode(id);
    }
  };

  const batchConfirm = () => {
    for (const card of selectedCards) {
      if (card.acceptance === 'proposed') void service.acceptDocCard(card.id);
    }
  };

  const batchSuspend = (suspend: boolean) => {
    for (const card of selectedCards) {
      if (!card.review) continue;
      if ((card.review.suspendedAt != null) !== suspend) void service.toggleCardSuspended(card);
    }
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
    viewportRef.current?.focus({ preventScroll: true });
  };

  const goMatch = (step: number) => {
    if (searchMatches.length === 0) return;
    const next = (searchIndex + step + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    const id = searchMatches[next];
    if (!id) return;
    revealFolded(id);
    setSelectedIds(new Set([id]));
    centerOn(id);
  };

  const onStageContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.doc-canvas-tools, .canvas-links-panel, .canvas-link-editor, .doc-canvas-minimap, .canvas-menu, .canvas-search, .canvas-help, .canvas-multi-bar')) return;
    event.preventDefault();
    const nodeEl = target.closest('.doc-canvas-card');
    const id = nodeEl?.getAttribute('data-node-id') ?? null;
    const point = stagePoint(event);
    if (id && !selectedIds.has(id)) setSelectedIds(new Set([id]));
    setMenu({ x: point.x, y: point.y, id });
  };

  const menuItems = ((): CanvasMenuItem[] => {
    if (!menu) return [];
    if (!menu.id) {
      return [
        ...(recall
          ? []
          : [
              {
                key: 'text',
                label: '新建文本节点',
                onSelect: () => void addText(null, outlineChildSlots(forest, null).length),
              },
            ]),
        {
          key: 'todo',
          label: todoOnly ? '显示全部节点' : '只看待办',
          onSelect: () => setTodoOnly((value) => !value),
        },
        {
          key: 'fit',
          label: '全部适配',
          onSelect: () => {
            const zoom = zoomFor('all');
            if (zoom == null) return;
            userMoved.current = true;
            placeView(zoom);
          },
        },
        { key: 'help', label: '快捷键', onSelect: () => setHelpOpen(true) },
      ];
    }
    const id = menu.id;
    const member = forest.find((item) => item.id === id);
    if (!member) return [];
    const items: CanvasMenuItem[] = [];
    // 默写模式下只留查看类操作，不动结构、不进编辑。
    if (recall) {
      if (member.kind === 'card' || member.kind === 'annotation') {
        items.push({
          key: 'locate',
          label: '在正文定位',
          onSelect: () => service.selectCanvasNode(id),
        });
      }
      const maskedCopy =
        member.kind === 'card'
          ? (cardById.get(id)?.concept ?? '')
          : member.kind === 'annotation'
            ? `${noteById.get(id)?.quote ?? ''}\n${noteById.get(id)?.note ?? ''}`.trim()
            : (nodeById.get(id)?.text ?? '');
      if (maskedCopy) {
        items.push({
          key: 'copy',
          label: '复制文本',
          onSelect: () => void navigator.clipboard?.writeText(maskedCopy),
        });
      }
      return items;
    }
    if (member.kind !== 'image') {
      items.push({
        key: 'edit',
        label: '编辑',
        onSelect: () => {
          if (member.kind === 'card') service.openCardEdit(id);
          else setEditingId(id);
        },
      });
    }
    if (member.kind === 'card') {
      items.push({
        key: 'links',
        label: '脉络',
        onSelect: () => {
          setSelectedIds(new Set([id]));
          setLinksOff(null);
        },
      });
    }
    if (member.kind === 'card' || member.kind === 'annotation') {
      items.push({
        key: 'locate',
        label: '在正文定位',
        onSelect: () => service.selectCanvasNode(id),
      });
    }
    const copyText =
      member.kind === 'card'
        ? (cardById.get(id)?.concept ?? '')
        : member.kind === 'annotation'
          ? `${noteById.get(id)?.quote ?? ''}\n${noteById.get(id)?.note ?? ''}`.trim()
          : (nodeById.get(id)?.text ?? '');
    if (copyText) {
      items.push({
        key: 'copy',
        label: '复制文本',
        onSelect: () => void navigator.clipboard?.writeText(copyText),
      });
    }
    items.push({ key: 'child', label: '加子节点', onSelect: () => onAddChild(id) });
    items.push({ key: 'sibling', label: '加兄弟节点', onSelect: () => onAddSibling(id) });
    if (member.kind !== 'annotation') {
      items.push({
        key: 'delete',
        label: member.kind === 'card' ? '归档' : '删除',
        danger: true,
        onSelect: () => {
          if (member.kind === 'card') void service.archiveDocCard(id);
          else void service.removeCanvasNode(id);
        },
      });
    }
    return items;
  })();

  /** 双击空白：新文本节点独立成树，进编辑态；cardKey 变化触发自动适配。 */
  const onStageDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.doc-canvas-card, .doc-canvas-tools, .canvas-links-panel, .doc-canvas-minimap')) return;
    event.preventDefault();
    void addText(null, outlineChildSlots(forest, null).length);
  };

  /** 正文选区拖引文进来：和拖节点同一套落点判定与提示。 */
  const onStageDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(QUOTE_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const rect = viewportRef.current?.getBoundingClientRect();
    const world = worldPoint(event.clientX, event.clientY);
    setQuoteDrag({
      x: rect ? event.clientX - rect.left : 0,
      y: rect ? event.clientY - rect.top : 0,
      drop: hitMindDrop(layout.boxes, world.x, world.y, ''),
    });
  };

  const onStageDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setQuoteDrag(null);
  };

  const onStageDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const raw = event.dataTransfer.getData(QUOTE_DRAG_MIME);
    setQuoteDrag(null);
    if (!raw) return;
    event.preventDefault();
    const payload = parseQuoteDrag(raw);
    if (!payload || !docId || payload.documentId !== docId) return;
    const world = worldPoint(event.clientX, event.clientY);
    const drop = hitMindDrop(layout.boxes, world.x, world.y, '');
    void dropQuoteOnCanvas(payload, drop);
  };

  /** 引文落成批注节点：先以根身份进画布，再按落点挂到目标位置。 */
  const dropQuoteOnCanvas = async (payload: QuoteDragPayload, drop: MindDrop) => {
    const place = quoteDropPlace(forest, drop);
    const id = await service.addCanvasQuoteAnnotation(
      payload.documentId,
      payload.quote,
      payload.extra,
    );
    if (!id) return;
    setSelectedId(id);
    // 落点不合法（或拖到空白）时保持独立成树。
    if (!place) return;
    if (place.parentId) reveal(place.parentId);
    void service.placeOnCanvas(id, place.parentId, place.index);
  };

  /** 连线把手按下：开始手绘关系边（卡片节点才有把手）。 */
  const onLinkDotDown = (fromId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const world = worldPoint(event.clientX, event.clientY);
    setLinkDraft({ fromId, x: world.x, y: world.y, hoverId: null });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail for a synthetic pointer.
    }
  };

  const onLinkDotMove = (fromId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (linkDraft?.fromId !== fromId) return;
    const world = worldPoint(event.clientX, event.clientY);
    setLinkDraft({
      fromId,
      x: world.x,
      y: world.y,
      hoverId: hitCardBox(layout.boxes, world.x, world.y, fromId, cardIdSet),
    });
  };

  /** 松开：落在另一张卡片上弹出类型选择，落在空白或非卡片节点上取消。 */
  const onLinkDotUp = (fromId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (linkDraft?.fromId !== fromId) return;
    event.stopPropagation();
    const world = worldPoint(event.clientX, event.clientY);
    const target = hitCardBox(layout.boxes, world.x, world.y, fromId, cardIdSet);
    setLinkDraft(null);
    if (!target) return;
    const point = stagePoint(event);
    setLinkEditor({ fromId, toId: target, x: point.x, y: point.y });
  };

  const saveLink = async (type: CardLinkType, reason: string) => {
    const editor = linkEditor;
    if (!editor || linkSaving) return;
    setLinkSaving(true);
    try {
      await createCardLink(editor.fromId, {
        toCardId: editor.toId,
        type,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setLinkEditor(null);
      setLinksTick((tick) => tick + 1);
      // 选中起点卡：脉络浮层立即可见这条新边。
      setSelectedIds(new Set([editor.fromId]));
      setLinksOff(null);
    } catch (err) {
      service.showToast(errorMessage(err, '没连上'));
    } finally {
      setLinkSaving(false);
    }
  };

  const showMinimap =
    stageSize.width > 0 &&
    visible.length > 1 &&
    (layout.width * view.zoom > stageSize.width + 80 ||
      layout.height * view.zoom > stageSize.height + 80);

  return (
    <div className="doc-canvas">
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
        onDoubleClick={onStageDoubleClick}
        onContextMenu={onStageContextMenu}
        onDragOver={onStageDragOver}
        onDragLeave={onStageDragLeave}
        onDrop={onStageDrop}
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
            const hot = related !== null && related.has(edge.from) && related.has(edge.to);
            const cls = hot ? 'is-hot' : related ? 'is-dimmed' : undefined;
            return <path key={`${edge.from}-${edge.to}`} className={cls} d={edgePath(from, to)} />;
          })}
          {linksCardId
            ? ghostTargets.map((id) => {
                const from = boxById.get(linksCardId);
                const to = boxById.get(id);
                if (!from || !to) return null;
                return <path key={`ghost-${id}`} className="is-ghost" d={ghostPath(from, to)} />;
              })
            : null}
          {linkDraft
            ? (() => {
                const from = boxById.get(linkDraft.fromId);
                if (!from) return null;
                const to: MindBox = {
                  id: '__link-tip',
                  x: linkDraft.x - 1,
                  y: linkDraft.y - 1,
                  width: 2,
                  height: 2,
                };
                return <path className="is-ghost is-linking" d={ghostPath(from, to)} />;
              })()
            : null}
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
        {quoteInsertAt && quoteDrag ? (
          <div
            className="doc-canvas-insert"
            style={{
              left: quoteInsertAt.x,
              top:
                quoteDrag.drop.kind === 'before'
                  ? quoteInsertAt.y - 5
                  : quoteInsertAt.y + quoteInsertAt.height + 3,
              width: quoteInsertAt.width,
            }}
          />
        ) : null}
        {visible.map((member) => {
          const box = boxById.get(member.id);
          if (!box) return null;
          const dragging = drag?.id === member.id;
          const ghosting = dragGroup !== null && !dragging && selectedIds.has(member.id);
          const accept = drag?.drop.kind === 'child' && drag.drop.parentId === member.id && hint?.accept === true;
          const quoteAccept =
            quoteDrag?.drop.kind === 'child' && quoteDrag.drop.parentId === member.id;
          const linkAccept = linkDraft?.hoverId === member.id;
          const card = member.kind === 'card' ? cardById.get(member.id) : undefined;
          const note = member.kind === 'annotation' ? noteById.get(member.id) : undefined;
          const stored = nodeById.get(member.id);
          const count = childCount.get(member.id) ?? 0;
          const selected = selectedIds.has(member.id);
          const dimmed = related !== null && !related.has(member.id) && !dragging;
          const faded = todoOnly && !todoCounts.has(member.id);
          const suspended = card?.review?.suspendedAt != null;
          const todo = card ? cardTodos.get(member.id) : undefined;
          const subtreeTodo = todoCounts.get(member.id) ?? 0;
          const masked = recall && !revealAll && peekId !== member.id;
          return (
            <SizedNode
              key={member.id}
              id={member.id}
              className={`doc-canvas-card${dragging ? ' is-dragging' : ''}${ghosting ? ' is-ghosting' : ''}${accept || quoteAccept || linkAccept ? ' is-drop' : ''}${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}${faded ? ' is-faded' : ''}${suspended ? ' is-suspended' : ''}${masked ? ' is-masked' : ''}`}
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
                if (event.shiftKey) {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(member.id)) next.delete(member.id);
                    else next.add(member.id);
                    return next;
                  });
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                applyMind(
                  member.id,
                  decideMindGesture({
                    action: 'click',
                    kind: member.kind,
                    repeat: selectedRef.current === member.id,
                  }),
                );
                // 默写模式：点遮住的节点偷看它，再点重新盖上。
                if (recall && !revealAll) {
                  setPeekId((current) => (current === member.id ? null : member.id));
                }
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
                  aria-label={
                    folded.has(member.id)
                      ? `展开，下面有 ${count} 个${subtreeTodo > 0 ? `，${subtreeTodo} 个待办` : ''}`
                      : '折叠'
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFold(member.id);
                    viewportRef.current?.focus();
                  }}
                >
                  {folded.has(member.id)
                    ? subtreeTodo > 0
                      ? `${count}·${subtreeTodo}`
                      : count
                    : '–'}
                </button>
              ) : null}
              {todo ? (
                <Tip content={todo === 'confirm' ? '待确认' : '待复习'}>
                  <span className={`canvas-todo is-${todo}`} aria-hidden />
                </Tip>
              ) : null}
              {member.kind === 'card' && !recall ? (
                <button
                  type="button"
                  className="canvas-link-dot"
                  aria-label="拖到另一张卡，建立关联"
                  onPointerDown={(event) => onLinkDotDown(member.id, event)}
                  onPointerMove={(event) => onLinkDotMove(member.id, event)}
                  onPointerUp={(event) => onLinkDotUp(member.id, event)}
                  onPointerCancel={() => setLinkDraft(null)}
                />
              ) : null}
              {selectedId === member.id && !dragging && !recall ? (
                <div
                  className="canvas-node-bar"
                  role="toolbar"
                  aria-label="节点操作"
                  style={{ transform: `scale(${1 / view.zoom})` }}
                >
                  {member.kind !== 'image' ? (
                    <Tip content="编辑（空格）">
                    <button
                      type="button"
                      aria-label="编辑"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (member.kind === 'card') service.openCardEdit(member.id);
                        else setEditingId(member.id);
                      }}
                    >
                      <Pencil width={12} height={12} strokeWidth={1.8} />
                    </button>
                    </Tip>
                  ) : null}
                  {member.kind === 'card' ? (
                    <Tip content="脉络">
                    <button
                      type="button"
                      className={linksCardId === member.id ? 'is-on' : undefined}
                      aria-label="脉络"
                      aria-pressed={linksCardId === member.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setLinksOff((current) => (current === member.id ? null : member.id));
                      }}
                    >
                      <Waypoints width={12} height={12} strokeWidth={1.8} />
                    </button>
                    </Tip>
                  ) : null}
                  <Tip content="加子节点（Tab）">
                  <button
                    type="button"
                    aria-label="加子节点"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddChild(member.id);
                    }}
                  >
                    <Plus width={12} height={12} strokeWidth={1.8} />
                  </button>
                  </Tip>
                  <Tip content="加兄弟节点（Enter）">
                  <button
                    type="button"
                    aria-label="加兄弟节点"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddSibling(member.id);
                    }}
                  >
                    <CornerDownRight width={12} height={12} strokeWidth={1.8} />
                  </button>
                  </Tip>
                  {member.kind !== 'annotation' ? (
                    <Tip content="删除">
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (member.kind === 'card') void service.archiveDocCard(member.id);
                        else void service.removeCanvasNode(member.id);
                      }}
                    >
                      <Trash2 width={12} height={12} strokeWidth={1.8} />
                    </button>
                    </Tip>
                  ) : null}
                </div>
              ) : null}
            </SizedNode>
          );
        })}
      </div>
      {marquee ? (
        <div
          className="doc-canvas-marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          aria-hidden
        />
      ) : null}
      {searchOpen ? (
        <CanvasSearch
          query={searchQuery}
          matchCount={searchMatches.length}
          matchIndex={Math.min(searchIndex, Math.max(0, searchMatches.length - 1))}
          onQuery={(query) => {
            setSearchQuery(query);
            setSearchIndex(0);
          }}
          onNext={() => goMatch(1)}
          onPrev={() => goMatch(-1)}
          onClose={closeSearch}
        />
      ) : null}
      {linksCardId && stageSize.width > 0
        ? (() => {
            const box = boxById.get(linksCardId);
            if (!box) return null;
            return (
              <CanvasLinksPanel
                cardId={linksCardId}
                documentId={docId}
                anchor={linksPanelAnchor(box, view, stageSize, {
                  width: LINKS_PANEL_W,
                  height: LINKS_PANEL_H,
                })}
                refreshKey={linksTick}
                onClose={() => setLinksOff(linksCardId)}
              />
            );
          })()
        : null}
      {linkEditor && stageSize.width > 0 ? (
        <CanvasLinkEditor
          x={linkEditor.x}
          y={linkEditor.y}
          stage={stageSize}
          saving={linkSaving}
          onSave={(type, reason) => void saveLink(type, reason)}
          onClose={() => setLinkEditor(null)}
        />
      ) : null}
      {showMinimap ? (
        <CanvasMinimap
          layout={layout}
          view={view}
          stage={stageSize}
          selectedId={selectedId}
          onJump={(pan) => {
            userMoved.current = true;
            animateView({ ...pan, zoom: viewRef.current.zoom }, 140);
          }}
        />
      ) : null}
      {hint?.text ? (
        <div className="doc-canvas-hint" style={{ left: drag?.x ?? 0, top: drag?.y ?? 0 }} role="status">
          {hint.text}
        </div>
      ) : null}
      {quoteDrag ? (
        <div
          className="doc-canvas-hint"
          style={{ left: quoteDrag.x, top: quoteDrag.y }}
          role="status"
        >
          {quoteDrag.drop.kind === 'child'
            ? '落为子节点'
            : quoteDrag.drop.kind === 'before'
              ? '排在前面'
              : quoteDrag.drop.kind === 'after'
                ? '排在后面'
                : '独立成树'}
        </div>
      ) : null}
      {selectedIds.size > 1 && !recall ? (
        <CanvasMultiBar
          count={selectedIds.size}
          confirming={selectedCards.some((card) => card.acceptance === 'proposed')}
          suspending={selectedCards.some((card) => card.review)}
          onConfirm={batchConfirm}
          onSuspend={() => batchSuspend(true)}
          onResume={() => batchSuspend(false)}
          onArchive={batchArchive}
          onClear={() => setSelectedIds(new Set())}
        />
      ) : null}
      {menu ? <CanvasMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}
      {helpOpen ? <CanvasHelp onClose={() => setHelpOpen(false)} /> : null}
      <div className="doc-canvas-tools">
        <div className="doc-canvas-tools-group">
          <Tip content="撤销">
          <button
            type="button"
            aria-label="撤销"
            disabled={service.canvasUndo === 0}
            onClick={() => void service.undoCanvas()}
          >
            <Undo2 width={13} height={13} strokeWidth={1.8} />
          </button>
          </Tip>
          <Tip content="重做">
          <button
            type="button"
            aria-label="重做"
            disabled={service.canvasRedo === 0}
            onClick={() => void service.redoCanvas()}
          >
            <Redo2 width={13} height={13} strokeWidth={1.8} />
          </button>
          </Tip>
        </div>
        <div className="doc-canvas-tools-group">
          <Tip content="画布内搜索（⌘F）">
          <button
            type="button"
            aria-label="画布内搜索"
            onClick={() => setSearchOpen(true)}
          >
            <Search width={13} height={13} strokeWidth={1.8} />
          </button>
          </Tip>
          <Tip content="只看待办">
          <button
            type="button"
            className={`is-wide${todoOnly ? ' is-on' : ''}`}
            aria-label="只看待办"
            aria-pressed={todoOnly}
            onClick={() => setTodoOnly((value) => !value)}
          >
            待办
          </button>
          </Tip>
          <Tip content="默写：遮住内容，只看结构（M）">
          <button
            type="button"
            className={`is-wide${recall ? ' is-on' : ''}`}
            aria-label="默写"
            aria-pressed={recall}
            onClick={toggleRecall}
          >
            默写
          </button>
          </Tip>
          {recall ? (
            <Tip content={revealAll ? '全部盖上' : '全部翻开，核对内容'}>
            <button
              type="button"
              className="is-wide"
              aria-label={revealAll ? '全部盖上' : '全部翻开'}
              onClick={() => {
                setRevealAll((value) => !value);
                setPeekId(null);
              }}
            >
              {revealAll ? '盖上' : '翻开'}
            </button>
            </Tip>
          ) : null}
          <Tip content="快捷键（?）">
          <button type="button" aria-label="快捷键" onClick={() => setHelpOpen(true)}>
            ?
          </button>
          </Tip>
        </div>
        <div className="doc-canvas-tools-group">
          <button
            type="button"
            aria-label="文本节点"
            className="is-wide"
            disabled={recall}
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
            className="is-wide"
            disabled={service.canvasUploading || recall}
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
        </div>
        <div className="doc-canvas-tools-group">
          <button type="button" aria-label="缩小" onClick={() => zoomBy(1 / 1.12)}>
            －
          </button>
          <Tip content="回到 100%">
          <button
            type="button"
            className="is-zoom"
            aria-label="回到 100%"
            onClick={() => zoomBy(1 / viewRef.current.zoom)}
          >
            {Math.round(view.zoom * 100)}%
          </button>
          </Tip>
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
    </div>
  );
});
