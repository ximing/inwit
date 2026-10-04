/**
 * 主题脑图（只读）：主题下全部卡片按知识关联 BFS 成树排布，
 * 树外的关联画成类型化虚线。单击选中看脉络，双击跳到文档锚点。
 */
import type { TopicGraphCard } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Tip } from '@/components/tip';
import { LINK_META } from '@/pages/docs/card-links-logic';
import { CanvasLinksPanel, LINKS_PANEL_H, LINKS_PANEL_W } from '@/pages/docs/canvas-links-panel';
import { CanvasMinimap } from '@/pages/docs/canvas-minimap';
import { CanvasSearch } from '@/pages/docs/canvas-overlays';
import {
  linksPanelAnchor,
  mindCardTodo,
  mindSearchIds,
} from '@/pages/docs/mindmap-focus';
import { layoutMindForest, type MindBox } from '@/pages/docs/mindmap-layout';
import { topicGraphForest } from './topic-graph-logic';
import { TopicsService } from './topics.service';

const NODE_W = 232;
const NODE_H = 84;

function edgePath(from: MindBox, to: MindBox): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function relationPath(from: MindBox, to: MindBox): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height / 2;
  const x2 = to.x + to.width / 2;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(32, Math.min(140, Math.abs(x2 - x1) / 2)) * (x2 >= x1 ? 1 : -1);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export const TopicCanvas = observer(function TopicCanvas() {
  const service = useService(TopicsService);
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  const graphKeyRef = useRef('');
  const [view, setView] = useState({ panX: 28, panY: 28, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const panGesture = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const graph = service.graph;
  const cardById = useMemo(
    () => new Map((graph?.cards ?? []).map((card) => [card.id, card])),
    [graph],
  );
  const { members, relations, treeTypes } = useMemo(
    () =>
      topicGraphForest(
        (graph?.cards ?? []).map((card) => card.id),
        graph?.links ?? [],
      ),
    [graph],
  );
  const layout = useMemo(
    () =>
      layoutMindForest(
        members.map((member) => ({
          id: member.id,
          parentId: member.parentId,
          position: member.position,
          width: NODE_W,
          height: NODE_H,
        })),
      ),
    [members],
  );
  const boxById = useMemo(() => new Map(layout.boxes.map((box) => [box.id, box])), [layout.boxes]);

  const todos = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, 'confirm' | 'review'>();
    for (const card of graph?.cards ?? []) {
      const todo = mindCardTodo(card, now);
      if (todo) map.set(card.id, todo);
    }
    return map;
  }, [graph]);

  const haystacks = useMemo(
    () =>
      (graph?.cards ?? []).map(
        (card): readonly [string, string] => [
          card.id,
          `${card.concept} ${card.documentTitle ?? ''}`,
        ],
      ),
    [graph],
  );
  const searchMatches = useMemo(
    () => mindSearchIds(haystacks, searchQuery),
    [haystacks, searchQuery],
  );

  const animateView = useCallback((next: { panX: number; panY: number; zoom: number }, ms = 160) => {
    const from = viewRef.current;
    if (from.panX === next.panX && from.panY === next.panY && from.zoom === next.zoom) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
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
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el || layout.width <= 0 || layout.height <= 0) return;
    const zoom = Math.max(
      0.25,
      Math.min(1, Math.min((el.clientWidth - 36) / layout.width, (el.clientHeight - 36) / layout.height)),
    );
    animateView({
      zoom,
      panX: (el.clientWidth - layout.width * zoom) / 2,
      panY: Math.max(36, (el.clientHeight - layout.height * zoom) / 2),
    });
  }, [animateView, layout.width, layout.height]);

  const graphKey = members.map((member) => member.id).join('|');
  useLayoutEffect(() => {
    if (graphKeyRef.current !== graphKey) {
      graphKeyRef.current = graphKey;
      userMoved.current = false;
    }
    if (!userMoved.current) fit();
  }, [graphKey, fit]);

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
      setView((prev) => ({ ...prev, panX: prev.panX - event.deltaX, panY: prev.panY - event.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (selectedId && !cardById.has(selectedId)) setSelectedId(null);
  }, [selectedId, cardById]);

  const centerOn = (id: string) => {
    const box = boxById.get(id);
    const el = viewportRef.current;
    if (!box || !el) return;
    userMoved.current = true;
    animateView({
      zoom: viewRef.current.zoom,
      panX: el.clientWidth / 2 - (box.x + box.width / 2) * viewRef.current.zoom,
      panY: el.clientHeight / 2 - (box.y + box.height / 2) * viewRef.current.zoom,
    });
  };

  const goMatch = (step: number) => {
    if (searchMatches.length === 0) return;
    const next = (searchIndex + step + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    const id = searchMatches[next];
    if (!id) return;
    setSelectedId(id);
    centerOn(id);
  };

  const openCard = (card: TopicGraphCard) => {
    navigate(service.cardHref(card.id, card.documentId));
  };

  const showMinimap =
    stageSize.width > 0 &&
    members.length > 1 &&
    (layout.width * view.zoom > stageSize.width + 80 ||
      layout.height * view.zoom > stageSize.height + 80);

  if (!graph) {
    return (
      <div className="topic-canvas-empty">
        <p className="empty compact">正在铺开主题脑图…</p>
      </div>
    );
  }
  if (graph.cards.length === 0) {
    return (
      <div className="topic-canvas-empty">
        <p className="empty compact">这个主题还没有卡片，先扔点资料进来消化。</p>
      </div>
    );
  }

  return (
    <div className="doc-canvas topic-canvas">
      <div
        ref={viewportRef}
        className="doc-canvas-stage"
        role="application"
        tabIndex={0}
        aria-label="主题脑图"
        style={{
          backgroundSize: `${22 * view.zoom}px ${22 * view.zoom}px`,
          backgroundPosition: `${view.panX}px ${view.panY}px`,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest('.topic-canvas-node, .canvas-links-panel, .doc-canvas-minimap, .canvas-search, .topic-canvas-tools')) return;
          setSelectedId(null);
          panGesture.current = {
            pointerId: event.pointerId,
            originX: event.clientX,
            originY: event.clientY,
            panX: view.panX,
            panY: view.panY,
          };
          userMoved.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pan = panGesture.current;
          if (!pan || pan.pointerId !== event.pointerId) return;
          setView((prev) => ({
            ...prev,
            panX: pan.panX + (event.clientX - pan.originX),
            panY: pan.panY + (event.clientY - pan.originY),
          }));
        }}
        onPointerUp={(event) => {
          if (panGesture.current?.pointerId === event.pointerId) panGesture.current = null;
        }}
        onPointerCancel={(event) => {
          if (panGesture.current?.pointerId === event.pointerId) panGesture.current = null;
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest('textarea, input, [contenteditable="true"]')) return;
          const meta = event.metaKey || event.ctrlKey;
          if (meta && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            setSearchOpen(true);
            return;
          }
          if (meta && event.key === '0') {
            event.preventDefault();
            userMoved.current = true;
            fit();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            if (searchOpen) {
              setSearchOpen(false);
              setSearchQuery('');
            } else {
              setSelectedId(null);
            }
          }
        }}
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
              const type = treeTypes.get(edge.to);
              const cls = type ? `is-tree is-rel-${LINK_META[type].rel}` : undefined;
              return <path key={`${edge.from}-${edge.to}`} className={cls} d={edgePath(from, to)} />;
            })}
            {relations.map((relation) => {
              const from = boxById.get(relation.from);
              const to = boxById.get(relation.to);
              if (!from || !to) return null;
              const meta = LINK_META[relation.type];
              return (
                <path
                  key={`rel-${relation.from}-${relation.to}-${relation.type}`}
                  className={`is-ghost is-rel-${meta.rel}`}
                  d={relationPath(from, to)}
                />
              );
            })}
          </svg>
          {members.map((member) => {
            const box = boxById.get(member.id);
            const card = cardById.get(member.id);
            if (!box || !card) return null;
            const todo = todos.get(member.id);
            const selected = selectedId === member.id;
            return (
              <div
                key={member.id}
                className={`doc-canvas-card topic-canvas-card${selected ? ' is-selected' : ''}`}
                style={{ left: box.x, top: box.y, width: box.width }}
              >
                <button
                  type="button"
                  className="topic-canvas-node"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(member.id);
                    viewportRef.current?.focus({ preventScroll: true });
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    openCard(card);
                  }}
                >
                  <span className="topic-canvas-kicker">{card.documentTitle ?? '未入文档'}</span>
                  <span className="topic-canvas-concept">{card.concept}</span>
                </button>
                {todo ? (
                  <Tip content={todo === 'confirm' ? '待确认' : '待复习'}>
                    <span className={`canvas-todo is-${todo}`} aria-hidden />
                  </Tip>
                ) : null}
              </div>
            );
          })}
        </div>
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
            onClose={() => {
              setSearchOpen(false);
              setSearchQuery('');
              setSearchIndex(0);
              viewportRef.current?.focus({ preventScroll: true });
            }}
          />
        ) : null}
        {selectedId && stageSize.width > 0
          ? (() => {
              const box = boxById.get(selectedId);
              const card = cardById.get(selectedId);
              if (!box || !card) return null;
              return (
                <CanvasLinksPanel
                  cardId={selectedId}
                  documentId={card.documentId}
                  anchor={linksPanelAnchor(box, view, stageSize, {
                    width: LINKS_PANEL_W,
                    height: LINKS_PANEL_H,
                  })}
                  onClose={() => setSelectedId(null)}
                />
              );
            })()
          : null}
        {showMinimap ? (
          <CanvasMinimap
            layout={layout}
            view={view}
            stage={stageSize}
            selectedId={selectedId}
            onJump={(pan) => {
              userMoved.current = true;
              animateView({ ...pan, zoom: viewRef.current.zoom });
            }}
          />
        ) : null}
        <div className="topic-canvas-legend" aria-hidden>
          {(['confusable', 'prerequisite', 'related', 'same_concept'] as const).map((type) => (
            <span key={type}>
              <i className={`is-rel-${LINK_META[type].rel}`} />
              {LINK_META[type].label}
            </span>
          ))}
        </div>
        <div className="doc-canvas-tools topic-canvas-tools">
          <div className="doc-canvas-tools-group">
            <button
              type="button"
              aria-label="缩小"
              onClick={() => {
                const el = viewportRef.current;
                if (!el) return;
                userMoved.current = true;
                const prev = viewRef.current;
                const zoom = Math.max(0.35, prev.zoom / 1.12);
                const ax = el.clientWidth / 2;
                const ay = el.clientHeight / 2;
                animateView({
                  zoom,
                  panX: ax - ((ax - prev.panX) / prev.zoom) * zoom,
                  panY: ay - ((ay - prev.panY) / prev.zoom) * zoom,
                });
              }}
            >
              －
            </button>
            <span className="topic-canvas-zoom">{Math.round(view.zoom * 100)}%</span>
            <button
              type="button"
              aria-label="放大"
              onClick={() => {
                const el = viewportRef.current;
                if (!el) return;
                userMoved.current = true;
                const prev = viewRef.current;
                const zoom = Math.min(1.75, prev.zoom * 1.12);
                const ax = el.clientWidth / 2;
                const ay = el.clientHeight / 2;
                animateView({
                  zoom,
                  panX: ax - ((ax - prev.panX) / prev.zoom) * zoom,
                  panY: ay - ((ay - prev.panY) / prev.zoom) * zoom,
                });
              }}
            >
              ＋
            </button>
            <button
              type="button"
              aria-label="适配"
              onClick={() => {
                userMoved.current = true;
                fit();
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
