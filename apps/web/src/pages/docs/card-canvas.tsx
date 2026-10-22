/**
 * 文档脑图。平移、缩放的世界坐标里自动布局，节点不记住坐标。
 * 单击选中，卡片和批注同时把左侧正文滚到锚点；空格或双击进入编辑。
 * 放不下的文字在节点右上角有展开图标，浮层阅读，不改变节点高度。
 * Tab 加子节点，Enter 加兄弟节点，Delete / Backspace 删除选中节点，⌘] / ⌘[ 缩进提升。
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
  MessageSquarePlus,
  Pencil,
  Plus,
  History,
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
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Tip } from '@/components/tip';
import { createCardLink } from '@/api/cards';
import { errorMessage } from '@/api/client';
import { DialogService } from '@/services/dialog.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { AssistantService } from '@/shell/assistant.service';
import { CanvasFreeNode, CanvasNoteNode } from './canvas-nodes';
import { CanvasReadout, ReadoutToggle, type MindReadout } from './canvas-readout';
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
  CanvasRevisionList,
  CanvasSearch,
  type CanvasMenuItem,
} from './canvas-overlays';
import { wheelZoomFactor } from './canvas-zoom';
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
  mindCameraFollow,
  mindSessionFor,
  mindViewAfterNodesRemoved,
  rememberMindSession,
} from './mindmap-view';
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
import { decideMindGesture, mindDeleteAction, mindNodeChatLabel, type MindIntent } from './mindmap-gesture';
import { cardHidesBody, readoutPanelSize } from './mindmap-readout';
import { edgePath, ghostPath, ghostTargetIds, hintFor, type PlaceVerdict } from './mindmap-edges.js';
import { hitCardBox, hitMindDrop, mindDragCommit, type MindDrop } from './mindmap-hit';
import {
  bindPointerSession,
  pointerEventIdentity,
  pointerReleasePoint,
  routeMindPointer,
  type PointerSession,
  type PointerSessionEvent,
} from './pointer-session.js';
import { layoutMindForest, type MindBox } from './mindmap-layout';
import { quoteDropPlace, type QuoteDragPayload } from './mindmap-quote';
import {
  pointerInsideRect,
  quoteDragLabel,
  quoteDropCaption,
  registerQuoteDropTarget,
  type QuoteDragPreview,
} from './quote-drag';

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

function SizedNode({
  id,
  className,
  style,
  onSize,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
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
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
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
      onPointerCancel={onPointerCancel}
      onClickCapture={onClickCapture}
      onDoubleClick={onDoubleClick}
      onDragStart={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
/** 这些控件自己处理点击，不拿来拖节点、也不抢选中。卡片本身是按钮，不在这里。 */
const NODE_CONTROLS = '.note-op, .canvas-node-op, .canvas-fold, .canvas-node-bar, .canvas-link-dot, .canvas-readout-toggle, .mini-decision, .card-links, a, input, textarea';
const KEY_CONTROLS = '.doc-canvas-tools, .canvas-history, .canvas-fold, .canvas-node-op, .canvas-node-bar, .canvas-readout, .canvas-readout-toggle, .note-op, textarea, input';

export const CardCanvas = observer(function CardCanvas({
  renderCard,
}: {
  renderCard: (card: DocumentCard, selected: boolean) => ReactNode;
}) {
  const service = useService(DocsService);
  const dialog = useService(DialogService);
  const assistant = useService(AssistantService);
  const prefs = useService(UiPrefsService);
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
    lastX: number;
    lastY: number;
    moved: boolean;
    captureEl: Element | null;
  } | null>(null);
  const panGesture = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    panX: number;
    panY: number;
    captureEl: Element | null;
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
  /** 全文浮层。只在内容放不下时打开，不参与布局。 */
  const [readoutId, setReadoutId] = useState<string | null>(null);
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
  /** 跟指针走的引文幽灵（视口坐标）。 */
  const [quoteGhost, setQuoteGhost] = useState<{ x: number; y: number; quote: string; caption: string } | null>(
    null,
  );
  /** 新批注进布局之后再把它移到视口里。 */
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
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
    captureEl: Element | null;
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
    if (foldDoc) {
      rememberMindSession(foldDoc, { view, searchQuery, searchOpen, searchIndex, todoOnly });
    }
    const next = mindSessionFor(docId);
    stopViewAnim();
    setFoldDoc(docId);
    setFolded(new Set(docId ? loadFolds(docId) : []));
    setView(next.view);
    setSearchQuery(next.searchQuery);
    setSearchOpen(next.searchOpen);
    setSearchIndex(next.searchIndex);
    setTodoOnly(next.todoOnly);
    setSelectedId(null);
    setEditingId(null);
    setReadoutId(null);
    setLinksOff(null);
    setMenu(null);
    setHelpOpen(false);
    setRecall(false);
    setPeekId(null);
    setRevealAll(false);
    setDrag(null);
    setMarquee(null);
    setQuoteDrag(null);
    setQuoteGhost(null);
    setFocusNodeId(null);
    setLinkDraft(null);
    setLinkEditor(null);
    setLinkSaving(false);
    panGesture.current = null;
    marqueeGesture.current = null;
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
  useEffect(() => {
    if (!readoutId) return;
    const shown = visible.some((member) => member.id === readoutId);
    if (recall || editingId === readoutId || readoutId !== selectedId || !shown) setReadoutId(null);
  }, [readoutId, selectedId, recall, editingId, visible]);
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
    setReadoutId(null);
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

  const addNodeToChat = (id: string) => {
    if (!docId) return;
    const member = forest.find((item) => item.id === id);
    if (!member) return;
    const card = cardById.get(id);
    const note = noteById.get(id);
    const stored = nodeById.get(id);
    prefs.setAssistantCollapsed(false);
    assistant.attachNode({
      documentId: docId,
      nodeId: id,
      kind: member.kind,
      label: mindNodeChatLabel({
        kind: member.kind,
        concept: card?.concept,
        quote: note?.quote,
        note: note?.note,
        text: stored?.text ?? undefined,
      }),
    });
  };
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
  const layoutRef = useRef(layout.boxes);
  layoutRef.current = layout.boxes;

  /** 选中节点的祖先链加子树；其余节点与连线弱化。 */
  const related = useMemo(
    () => (selectedId ? mindRelated(forest, selectedId) : null),
    [forest, selectedId],
  );
  /** 选中卡片且没被手动关掉时，脉络浮层开着。默写模式和全文浮层打开时不看脉络。 */
  const linksCardId =
    !recall &&
    readoutId !== selectedId &&
    selectedId &&
    cardById.has(selectedId) &&
    linksOff !== selectedId
      ? selectedId
      : null;
  const { links: selectedLinks } = useCardLinks(linksCardId, linksTick);
  /** 本文内、且在画布上的关联卡片，画虚线边。 */
  const ghostTargets = useMemo(
    () => ghostTargetIds(selectedLinks, linksCardId, docId, boxById),
    [linksCardId, selectedLinks, boxById, docId],
  );

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
  const placedRef = useRef(layout.boxes);
  useLayoutEffect(() => {
    const previousKey = cardKeyRef.current;
    const previousBoxes = placedRef.current;
    const follow = mindCameraFollow(previousKey, cardKey, userMoved.current);
    if (previousKey !== cardKey) cardKeyRef.current = cardKey;
    if (follow === 'refit') {
      // 第一次铺开或新节点：适配整棵树。删除、折叠不会进这个分支。
      if (previousKey !== cardKey) userMoved.current = false;
      fit();
    } else if (follow === 'hold') {
      const stage = viewportRef.current;
      const next = mindViewAfterNodesRemoved({
        previous: previousBoxes,
        next: layout.boxes,
        view: viewRef.current,
        stage: {
          width: stage?.clientWidth ?? 0,
          height: stage?.clientHeight ?? 0,
        },
      });
      if (next) {
        stopViewAnim();
        setView(next);
      }
    }
    placedRef.current = layout.boxes;
  }, [cardKey, fit, layout.boxes, stopViewAnim]);

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
      // 覆盖层（脉络浮层、菜单、小地图等）有自己的滚动：放行原生滚动，不平移/缩放画布。
      if (
        event.target instanceof Element &&
        event.target.closest(
          '.doc-canvas-tools, .canvas-history, .canvas-links-panel, .canvas-readout, .canvas-link-editor, .canvas-node-bar, .doc-canvas-minimap, .canvas-menu, .canvas-search, .canvas-help, .canvas-multi-bar',
        )
      ) {
        return;
      }
      event.preventDefault();
      stopViewAnim();
      userMoved.current = true;
      const rect = el.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        setView((prev) => {
          const zoom = Math.min(
            1.75,
            Math.max(0.35, prev.zoom * wheelZoomFactor(event.deltaY, event.deltaMode)),
          );
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

  useEffect(() => {
    if (!focusNodeId) return;
    if (!forest.some((member) => member.id === focusNodeId)) return;
    if (!boxById.has(focusNodeId)) return;
    centerOn(focusNodeId);
    setFocusNodeId(null);
  }, [focusNodeId, forest, boxById, centerOn]);

  /** 手绘关系边的指针。状态里的 linkDraft 只存落点预览。 */
  const linkGesture = useRef<{
    pointerId: number;
    fromId: string;
    lastX: number;
    lastY: number;
    captureEl: Element | null;
  } | null>(null);
  const consumedPointer = useRef(new WeakSet<Event>());
  /** 这次手势里是否见过按钮按下。没见过就不要用 buttons===0 结束，避免误伤按住时也报 0 的浏览器。 */
  const sawPointerButton = useRef(false);
  const stopSession = useRef<(() => void) | null>(null);
  const pointerRouter = useRef<PointerSession>({
    move() {},
    up() {},
    cancel() {},
    blur() {},
  });
  useEffect(() => {
    return () => {
      stopSession.current?.();
      stopSession.current = null;
      dragGesture.current = null;
      panGesture.current = null;
      marqueeGesture.current = null;
      linkGesture.current = null;
    };
  }, []);

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
      // pointerdown 先于 blur：先主动 blur 让编辑中的节点提交草稿，否则 textarea
      // 在 blur 前被卸载，commit 不执行，内容静默丢失。
      if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
      setSelectedId(null);
      setEditingId(null);
      setReadoutId(null);
      setPeekId(null);
      return;
    }
    // 默写模式下不进入编辑，单击只是选中（和偷看）。
    if (recall && intent.type === 'edit') return;
    const previous = selectedRef.current;
    selectedRef.current = id;
    setSelectedId(id);
    if (readoutId !== id) setReadoutId(null);
    if (intent.type === 'select') {
      // 同上：点别的节点也是 pointerdown 先行，先让在编辑的节点提交。
      if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
      // 选中别的节点时，先前偷看的那张重新盖上（点击偷看在 applyMind 之后单独设置）。
      if (recall && previous !== id) setPeekId(null);
      setEditingId(null);
      if (intent.reveal) service.selectCanvasNode(id);
      viewportRef.current?.focus({ preventScroll: true });
      return;
    }
    if (intent.editor === 'inline-text' || intent.editor === 'inline-note') {
      setReadoutId(null);
      setEditingId(id);
      return;
    }
    if (intent.editor === 'card-dialog') {
      setReadoutId(null);
      setEditingId(null);
      service.openCardEdit(id);
    }
  };

  const toggleReadout = (id: string) => {
    if (readoutId === id) {
      setReadoutId(null);
      viewportRef.current?.focus({ preventScroll: true });
      return;
    }
    const member = forest.find((item) => item.id === id);
    if (!member) return;
    applyMind(
      id,
      decideMindGesture({
        action: 'click',
        kind: member.kind,
        repeat: selectedRef.current === id,
      }),
    );
    setReadoutId(id);
  };

  const editFromReadout = (id: string) => {
    const member = forest.find((item) => item.id === id);
    if (!member || member.kind === 'image') return;
    setReadoutId(null);
    setSelectedIds(new Set([id]));
    selectedRef.current = id;
    if (member.kind === 'card') service.openCardEdit(id);
    else setEditingId(id);
  };

  const stagePoint = (event: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: 0, y: 0 };
  };

  const stopListening = () => {
    const stop = stopSession.current;
    stopSession.current = null;
    stop?.();
  };

  const releaseCapture = (el: Element | null, pointerId: number) => {
    if (!el) return;
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // Already released, or the pointer is no longer active.
    }
  };

  const takePointer = (event: PointerSessionEvent) => {
    const native = pointerEventIdentity(event);
    if (consumedPointer.current.has(native)) return false;
    consumedPointer.current.add(native);
    return true;
  };

  /** 把按下期间最后的位置落成一次拖动。短滑仍是点击。 */
  const finishNodeDrag = (clientX: number, clientY: number, pointerId: number) => {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== pointerId) return;
    dragGesture.current = null;
    stopListening();
    releaseCapture(gesture.captureEl, pointerId);
    const travel = Math.hypot(clientX - gesture.originX, clientY - gesture.originY);
    const world = worldPoint(clientX, clientY);
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
    // 没拖成一次落位时保留点击：选中、点回正文都还在。
    if (mindDragCommit(travel, drop) !== 'commit') return;
    if (decideMindGesture({ action: 'drag' }).type === 'ignore') suppressClick.current = true;
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

  const finishView = (pointerId: number) => {
    const box = marqueeGesture.current;
    const pan = panGesture.current;
    if (box?.pointerId !== pointerId && pan?.pointerId !== pointerId) return;
    const captureEl = box?.pointerId === pointerId ? box.captureEl : (pan?.captureEl ?? null);
    if (box?.pointerId === pointerId) marqueeGesture.current = null;
    if (pan?.pointerId === pointerId) panGesture.current = null;
    stopListening();
    releaseCapture(captureEl, pointerId);
    if (box?.pointerId !== pointerId) return;
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
  };

  const cancelLink = () => {
    const link = linkGesture.current;
    linkGesture.current = null;
    if (link) releaseCapture(link.captureEl, link.pointerId);
    stopListening();
    setLinkDraft(null);
  };

  const finishLink = (clientX: number, clientY: number, pointerId: number) => {
    const link = linkGesture.current;
    if (!link || link.pointerId !== pointerId) return;
    linkGesture.current = null;
    stopListening();
    releaseCapture(link.captureEl, pointerId);
    const world = worldPoint(clientX, clientY);
    const target = hitCardBox(layout.boxes, world.x, world.y, link.fromId, cardIdSet);
    setLinkDraft(null);
    if (!target) return;
    const point = stagePoint({ clientX, clientY });
    setLinkEditor({ fromId: link.fromId, toId: target, x: point.x, y: point.y });
  };

  const releaseHeldPointer = (pointerId: number, event: PointerSessionEvent | null) => {
    const drag = dragGesture.current;
    if (drag?.pointerId === pointerId) {
      const point = event
        ? pointerReleasePoint(event, { x: drag.lastX, y: drag.lastY })
        : { x: drag.lastX, y: drag.lastY };
      finishNodeDrag(point.x, point.y, pointerId);
    } else if (
      panGesture.current?.pointerId === pointerId ||
      marqueeGesture.current?.pointerId === pointerId
    ) {
      finishView(pointerId);
    } else if (linkGesture.current?.pointerId === pointerId) {
      const link = linkGesture.current;
      const point = event
        ? pointerReleasePoint(event, { x: link.lastX, y: link.lastY })
        : { x: link.lastX, y: link.lastY };
      finishLink(point.x, point.y, pointerId);
    }
    stopListening();
  };

  /**
   * 先结束上一次没收到抬起的手势，再听这次指针。
   * 必须在写入新手势之前调用，否则会把刚按下的这次立刻落掉。
   */
  const armPointer = (pointerId: number) => {
    if (stopSession.current) pointerRouter.current.blur();
    sawPointerButton.current = false;
    stopSession.current = bindPointerSession(window, pointerId, pointerRouter);
  };

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (menu) {
      setMenu(null);
      if (!target.closest('.canvas-menu')) return;
    }
    if (target.closest('.doc-canvas-card, .doc-canvas-tools, .canvas-history, .canvas-links-panel, .canvas-readout, .canvas-link-editor, .canvas-node-bar, .doc-canvas-minimap, .canvas-menu, .canvas-search, .canvas-help, .canvas-multi-bar')) return;
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    stopViewAnim();
    if (event.button === 0 && event.shiftKey) {
      // Shift+拖空白：框选。起点用舞台坐标，松手时换成世界坐标算命中。
      const point = stagePoint(event);
      armPointer(event.pointerId);
      marqueeGesture.current = {
        pointerId: event.pointerId,
        originX: point.x,
        originY: point.y,
        captureEl: event.currentTarget,
      };
      setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    applyMind('', decideMindGesture({ action: 'empty' }));
    armPointer(event.pointerId);
    panGesture.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      panX: view.panX,
      panY: view.panY,
      captureEl: event.currentTarget,
    };
    userMoved.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onViewportPointerMove = (event: PointerSessionEvent) => {
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
    armPointer(event.pointerId);
    dragGesture.current = {
      id: cardId,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      captureEl: event.currentTarget,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail for a synthetic pointer; the window listener still ends the drag.
    }
  };

  const onNodePointerMove = (event: PointerSessionEvent) => {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    const dxPx = event.clientX - gesture.originX;
    const dyPx = event.clientY - gesture.originY;
    const travel = Math.hypot(dxPx, dyPx);
    const rect = viewportRef.current?.getBoundingClientRect();
    const world = worldPoint(event.clientX, event.clientY);
    const group =
      selectedIds.has(gesture.id) && selectedIds.size > 1
        ? new Set(mindTopmostSelected(forest, selectedIds))
        : gesture.id;
    const drop = hitMindDrop(layout.boxes, world.x, world.y, group);
    // 近处滑一下仍算点击。拖到空白要更远，才预览「独立成树」。
    if (mindDragCommit(travel, drop) !== 'commit') {
      if (gesture.moved) {
        gesture.moved = false;
        setDrag(null);
      }
      return;
    }
    gesture.moved = true;
    setDrag({
      id: gesture.id,
      dx: dxPx / view.zoom,
      dy: dyPx / view.zoom,
      x: rect ? event.clientX - rect.left : 0,
      y: rect ? event.clientY - rect.top : 0,
      drop,
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
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || dialog.current) return;
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
    if (event.key === 'Escape' && readoutId && editingId === null) {
      event.preventDefault();
      event.stopPropagation();
      setReadoutId(null);
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
      // 编辑草稿时 Backspace 只改文字。焦点若已经离开输入框，也不把整节点删掉。
      if (editingId) return;
      if (selectedIds.size > 1) {
        batchArchive();
        return;
      }
      deleteMember(selectedId);
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

  const deleteMember = (id: string) => {
    const target = forest.find((item) => item.id === id);
    if (!target) return;
    const action = mindDeleteAction(target.kind);
    if (action === 'archive-card') void service.archiveDocCard(id);
    else if (action === 'remove-annotation') void service.removeAnnotation(id);
    else void service.removeCanvasNode(id);
  };

  const batchArchive = () => {
    for (const id of selectedIds) deleteMember(id);
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
    if (target.closest('.doc-canvas-tools, .canvas-history, .canvas-links-panel, .canvas-readout, .canvas-link-editor, .doc-canvas-minimap, .canvas-menu, .canvas-search, .canvas-help, .canvas-multi-bar')) return;
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
      items.push({ key: 'chat', label: '加入对话', onSelect: () => addNodeToChat(id) });
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
    items.push({ key: 'chat', label: '加入对话', onSelect: () => addNodeToChat(id) });
    items.push({ key: 'child', label: '加子节点', onSelect: () => onAddChild(id) });
    items.push({ key: 'sibling', label: '加兄弟节点', onSelect: () => onAddSibling(id) });
    items.push({
      key: 'delete',
      label: member.kind === 'card' ? '归档' : '删除',
      danger: true,
      onSelect: () => deleteMember(id),
    });
    return items;
  })();

  /** 双击空白：新文本节点独立成树，进编辑态；cardKey 变化触发自动适配。 */
  const onStageDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.doc-canvas-card, .doc-canvas-tools, .canvas-history, .canvas-links-panel, .canvas-readout, .doc-canvas-minimap')) return;
    event.preventDefault();
    void addText(null, outlineChildSlots(forest, null).length);
  };

  /** 引文落成批注节点：先以根身份进画布，再按落点挂到目标位置，最后把节点移进视口。 */
  const dropQuoteOnCanvas = async (payload: QuoteDragPayload, drop: MindDrop) => {
    const place = quoteDropPlace(forest, drop);
    const id = await service.addCanvasQuoteAnnotation(
      payload.documentId,
      payload.quote,
      payload.extra,
    );
    if (!id) return;
    setSelectedId(id);
    try {
      // 落点不合法（或拖到空白）时保持独立成树。落位失败也把批注留在画布上。
      if (place) {
        if (place.parentId) {
          reveal(place.parentId);
          revealFolded(place.parentId);
        }
        await service.placeOnCanvas(id, place.parentId, place.index);
      }
    } catch {
      // placeOnCanvas 已经回滚落位，并在打开历史时提示。
    } finally {
      setFocusNodeId(id);
    }
  };

  const quoteDragApi = useRef({
    contains: (_x: number, _y: number): boolean => false,
    hit: (_x: number, _y: number): MindDrop => ({ kind: 'root' }),
    preview: (_preview: QuoteDragPreview | null, _drop: MindDrop | null) => {},
    drop: (_payload: QuoteDragPayload, _drop: MindDrop) => {},
  });
  quoteDragApi.current = {
    contains(x, y) {
      return pointerInsideRect(viewportRef.current?.getBoundingClientRect() ?? null, x, y);
    },
    hit(x, y) {
      const rect = viewportRef.current?.getBoundingClientRect();
      const viewNow = viewRef.current;
      if (!rect) return { kind: 'root' };
      return hitMindDrop(
        layoutRef.current,
        (x - rect.left - viewNow.panX) / viewNow.zoom,
        (y - rect.top - viewNow.panY) / viewNow.zoom,
        '',
      );
    },
    preview(preview, drop) {
      if (!preview) {
        setQuoteGhost(null);
        setQuoteDrag(null);
        return;
      }
      setQuoteGhost({
        x: preview.x,
        y: preview.y,
        quote: preview.payload.quote,
        caption: quoteDropCaption(drop),
      });
      if (!drop) {
        setQuoteDrag(null);
        return;
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      setQuoteDrag({
        x: rect ? preview.x - rect.left : 0,
        y: rect ? preview.y - rect.top : 0,
        drop,
      });
      if (!rect) return;
      const pan = edgeAutoPan(
        { x: preview.x - rect.left, y: preview.y - rect.top },
        { width: rect.width, height: rect.height },
      );
      if (!pan) return;
      userMoved.current = true;
      setView((prev) => ({ ...prev, panX: prev.panX + pan.dx, panY: prev.panY + pan.dy }));
    },
    drop(payload, drop) {
      if (!docId || payload.documentId !== docId) return;
      void dropQuoteOnCanvas(payload, drop);
    },
  };

  useEffect(() => {
    return registerQuoteDropTarget({
      contains: (x, y) => quoteDragApi.current.contains(x, y),
      hit: (x, y) => quoteDragApi.current.hit(x, y),
      preview: (preview, drop) => quoteDragApi.current.preview(preview, drop),
      drop: (payload, drop) => quoteDragApi.current.drop(payload, drop),
    });
  }, []);

  /** 连线把手按下：开始手绘关系边（卡片节点才有把手）。 */
  const onLinkDotDown = (fromId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    armPointer(event.pointerId);
    linkGesture.current = {
      pointerId: event.pointerId,
      fromId,
      lastX: event.clientX,
      lastY: event.clientY,
      captureEl: event.currentTarget,
    };
    const world = worldPoint(event.clientX, event.clientY);
    setLinkDraft({ fromId, x: world.x, y: world.y, hoverId: null });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail for a synthetic pointer; the window listener still ends the stroke.
    }
  };

  const onLinkDotMove = (fromId: string, event: PointerSessionEvent) => {
    const link = linkGesture.current;
    if (!link || link.pointerId !== event.pointerId || link.fromId !== fromId) return;
    link.lastX = event.clientX;
    link.lastY = event.clientY;
    const world = worldPoint(event.clientX, event.clientY);
    setLinkDraft({
      fromId,
      x: world.x,
      y: world.y,
      hoverId: hitCardBox(layout.boxes, world.x, world.y, fromId, cardIdSet),
    });
  };

  const routePointer = (
    phase: 'move' | 'up' | 'cancel' | 'blur',
    point: { pointerId: number; buttons: number; pointerType: string },
  ) =>
    routeMindPointer({
      phase,
      pointerId: point.pointerId,
      buttons: point.buttons,
      pointerType: point.pointerType,
      sawButton: sawPointerButton.current,
      nodePointerId: dragGesture.current?.pointerId ?? null,
      panPointerId: panGesture.current?.pointerId ?? null,
      marqueePointerId: marqueeGesture.current?.pointerId ?? null,
      linkPointerId: linkGesture.current?.pointerId ?? null,
    });

  pointerRouter.current = {
    move(event) {
      if (!takePointer(event)) return;
      const route = routePointer('move', event);
      sawPointerButton.current = route.sawButton;
      if (route.action === 'release') {
        releaseHeldPointer(event.pointerId, event);
        return;
      }
      if (route.action !== 'move') return;
      if (route.gesture === 'node') onNodePointerMove(event);
      else if (route.gesture === 'view') onViewportPointerMove(event);
      else if (linkGesture.current) onLinkDotMove(linkGesture.current.fromId, event);
    },
    up(event) {
      if (!takePointer(event)) return;
      const route = routePointer('up', event);
      if (route.action === 'release') releaseHeldPointer(event.pointerId, event);
    },
    cancel(event) {
      if (!takePointer(event)) return;
      const route = routePointer('cancel', event);
      // 关系边被取消时不落线。节点拖动和画布平移把取消当成在最后位置松开。
      if (route.action === 'cancel-link') {
        cancelLink();
        return;
      }
      if (route.action === 'release') releaseHeldPointer(event.pointerId, event);
    },
    blur() {
      const route = routePointer('blur', { pointerId: -1, buttons: 0, pointerType: '' });
      if (route.action === 'finish-node') {
        const drag = dragGesture.current;
        if (drag) finishNodeDrag(drag.lastX, drag.lastY, route.pointerId);
      } else if (route.action === 'finish-view') {
        finishView(route.pointerId);
      } else if (route.action === 'cancel-link') {
        cancelLink();
      }
      stopListening();
    },
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
        onPointerMove={(event) => pointerRouter.current.move(event)}
        onPointerUp={(event) => pointerRouter.current.up(event)}
        onPointerCancel={(event) => pointerRouter.current.cancel(event)}
        onKeyDown={onKeyDown}
        onDoubleClick={onStageDoubleClick}
        onContextMenu={onStageContextMenu}
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
              onPointerMove={(event) => pointerRouter.current.move(event)}
              onPointerUp={(event) => pointerRouter.current.up(event)}
              onPointerCancel={(event) => pointerRouter.current.cancel(event)}
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
              {!recall && editingId !== member.id && member.kind !== 'image' ? (
                <ReadoutToggle
                  hiddenBody={
                    card ? cardHidesBody(card, service.expandedCardIds.includes(card.id)) : false
                  }
                  watch={
                    card
                      ? `${card.concept}\n${card.example}\n${card.confusionPoint}\n${card.questions.map((item) => `${item.question}\n${item.answer}`).join('\n')}`
                      : note
                        ? `${note.quote}\n${note.note}`
                        : (stored?.text ?? '')
                  }
                  open={readoutId === member.id}
                  zoom={view.zoom}
                  onToggle={() => toggleReadout(member.id)}
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
                  onPointerMove={(event) => pointerRouter.current.move(event)}
                  onPointerUp={(event) => pointerRouter.current.up(event)}
                  onPointerCancel={(event) => pointerRouter.current.cancel(event)}
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
                  <Tip content="加入对话">
                  <button
                    type="button"
                    aria-label="加入对话"
                    onClick={(event) => {
                      event.stopPropagation();
                      addNodeToChat(member.id);
                    }}
                  >
                    <MessageSquarePlus width={12} height={12} strokeWidth={1.8} />
                  </button>
                  </Tip>
                  <Tip content={member.kind === 'card' ? '移入回收站' : '删除'}>
                  <button
                    type="button"
                    aria-label="删除"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteMember(member.id);
                    }}
                  >
                    <Trash2 width={12} height={12} strokeWidth={1.8} />
                  </button>
                  </Tip>
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
      {readoutId && !recall && stageSize.width > 0
        ? (() => {
            const box = boxById.get(readoutId);
            const member = visible.find((item) => item.id === readoutId);
            if (!box || !member || member.kind === 'image') return null;
            const readoutCard = member.kind === 'card' ? cardById.get(member.id) : undefined;
            const readoutNote = member.kind === 'annotation' ? noteById.get(member.id) : undefined;
            const readoutText = nodeById.get(member.id)?.text ?? '';
            let content: MindReadout | null = null;
            if (readoutCard) {
              content = {
                kind: 'card',
                concept: readoutCard.concept,
                example: readoutCard.example,
                confusionPoint: readoutCard.confusionPoint,
                questions: readoutCard.questions,
              };
            } else if (readoutNote && (readoutNote.quote.trim() || readoutNote.note.trim())) {
              content = { kind: 'annotation', quote: readoutNote.quote, note: readoutNote.note };
            } else if (member.kind === 'text' && readoutText.trim()) {
              content = { kind: 'text', text: readoutText };
            }
            if (!content) return null;
            const panel = readoutPanelSize(stageSize);
            return (
              <CanvasReadout
                content={content}
                anchor={linksPanelAnchor(box, view, stageSize, panel)}
                width={panel.width}
                maxHeight={panel.height}
                onClose={() => setReadoutId(null)}
                onEdit={() => editFromReadout(readoutId)}
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
      {quoteGhost
        ? createPortal(
            <div
              className="quote-drag-ghost"
              style={{ left: quoteGhost.x, top: quoteGhost.y }}
              role="status"
            >
              <span className="quote-drag-ghost-kicker">{quoteGhost.caption}</span>
              <span className="quote-drag-ghost-quote">{quoteDragLabel(quoteGhost.quote)}</span>
            </div>,
            document.body,
          )
        : null}
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
      {service.canvasRevisionsOpen ? (
        <CanvasRevisionList
          revisions={service.canvasRevisions}
          loading={service.canvasRevisionsLoading}
          restoringId={service.canvasRevisionRestoring}
          onRestore={(id) => void service.restoreCanvasRevision(id)}
          onClose={() => service.closeCanvasRevisions()}
        />
      ) : null}
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
          <Tip content="编辑历史">
          <button
            type="button"
            data-canvas-history-toggle=""
            aria-label="编辑历史"
            aria-pressed={service.canvasRevisionsOpen}
            className={service.canvasRevisionsOpen ? 'is-on' : undefined}
            onClick={() => service.toggleCanvasRevisions()}
          >
            <History width={13} height={13} strokeWidth={1.8} />
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
          <button type="button" className="is-help" aria-label="快捷键" onClick={() => setHelpOpen(true)}>
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
            <span className="btn-label">文本</span>
          </button>
          <button
            type="button"
            aria-label="图片节点"
            className="is-wide"
            disabled={service.canvasUploading || recall}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus width={13} height={13} strokeWidth={1.8} />
            <span className="btn-label">图片</span>
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
            className="is-fit"
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
