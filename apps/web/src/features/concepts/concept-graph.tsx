import { observer } from '@rabjs/react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Concept, ConceptRelation } from '@inwit/dto';
import { wheelZoomFactor } from '@/pages/docs/canvas-zoom.js';
import { shortcutBlockedTarget } from '../study-workspace/study-mode-hotkey.js';
import { hitConceptNode } from './concept-connect.js';
import { layoutConceptGraph, CONCEPT_NODE_SIZE, type ConceptGraphLayout } from './concept-graph-layout.js';
import {
  conceptMinimapCenter,
  conceptMinimapFrame,
  conceptMinimapViewport,
  fitViewport,
  frameNeighborhood,
  keyboardPan,
  keyboardZoomFactor,
  panByWheel,
  viewBoxSize,
  viewMeet,
  viewportCoversBoxes,
  zoomAt,
  zoomAtCenter,
  type GraphWorld,
} from './concept-graph-nav.js';

export interface ConceptGraphProps {
  concepts: Concept[];
  relations: ConceptRelation[];
  edgesComplete: boolean;
  positions: Map<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number };
  selectedId: string | null;
  selectedRelationId: string | null;
  highlightConceptIds: Set<string>;
  highlightRelationIds: Set<string>;
  /** 关系带出的端点上下文节点（弱化显示）。 */
  contextIds?: Set<string>;
  onViewportChange(viewport: { x: number; y: number; zoom: number }): void;
  onPositionsChange(positions: Map<string, { x: number; y: number }>): void;
  onSelectConcept(id: string): void;
  onSelectRelation(id: string): void;
  onExpandNeighbors(id: string): void;
  /** 从一个概念的连接点拖到另一个概念。 */
  onConnect?(fromId: string, toId: string): void;
  onFitAll?(): void;
  /** 展开栈非空时可以回到上一层。 */
  canBack?: boolean;
  onBack?(): void;
  /** 从根到当前层。多于一层时显示路径，点击前面的层级跳回。 */
  crumbs?: { label: string }[];
  onJumpFocus?(index: number): void;
  /** 单击空白或按 Esc 时关闭详情。 */
  onDismiss?(): void;
  /** 进入下一层后按这一层重新取景，并把这个概念放在中央。 */
  centerRequest?: { id: string; nonce: number } | null;
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const w = CONCEPT_NODE_SIZE.width;
  const h = CONCEPT_NODE_SIZE.height;
  const x1 = from.x + w / 2;
  const y1 = from.y + h / 2;
  const x2 = to.x + w / 2;
  const y2 = to.y + h / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.max(1, Math.hypot(dx, dy));
  // 出/入点收缩到节点边缘
  const trim1 = Math.min(dist / 2, Math.max(w, h) / 2 + 4);
  const trim2 = Math.min(dist / 2, Math.max(w, h) / 2 + 10);
  const sx = x1 + (dx / dist) * trim1;
  const sy = y1 + (dy / dist) * trim1;
  const ex = x2 - (dx / dist) * trim2;
  const ey = y2 - (dy / dist) * trim2;
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2 - Math.min(40, dist * 0.12);
  return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
}

function connectLine(
  fromId: string,
  x: number,
  y: number,
  targetId: string | null,
  positions: Map<string, { x: number; y: number }>,
): string {
  const from = positions.get(fromId);
  const sx = (from?.x ?? 0) + CONCEPT_NODE_SIZE.width;
  const sy = (from?.y ?? 0) + CONCEPT_NODE_SIZE.height / 2;
  const target = targetId ? positions.get(targetId) : undefined;
  const ex = target ? target.x : x;
  const ey = target ? target.y + CONCEPT_NODE_SIZE.height / 2 : y;
  return `M ${sx} ${sy} L ${ex} ${ey}`;
}

function edgeLabelPoint(from: { x: number; y: number }, to: { x: number; y: number }) {
  const w = CONCEPT_NODE_SIZE.width;
  const h = CONCEPT_NODE_SIZE.height;
  return {
    x: (from.x + w / 2 + to.x + w / 2) / 2,
    y: (from.y + h / 2 + to.y + h / 2) / 2 - 14,
  };
}

/** 概念关系图（SVG，一般有向图，支持环）。 */
export const ConceptGraph = observer(function ConceptGraph(props: ConceptGraphProps) {
  const layout: ConceptGraphLayout = useMemo(
    () => layoutConceptGraph(props.concepts, props.relations, props.positions),
    [props.concepts, props.relations, props.positions],
  );
  const posById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, { x: node.x, y: node.y }])),
    [layout],
  );
  const conceptById = useMemo(
    () => new Map(props.concepts.map((concept) => [concept.id, concept])),
    [props.concepts],
  );

  const dragRef = useRef<{
    kind: 'pan' | 'node';
    /** 空白拖动松手后关闭详情；空格和中键只平移。 */
    pan: 'blank' | 'space' | 'middle' | null;
    id?: string;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    scale: number;
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [connect, setConnect] = useState<{
    fromId: string;
    x: number;
    y: number;
    targetId: string | null;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const spaceRef = useRef(false);
  const linkingRef = useRef(false);
  const stopConnect = useRef<(() => void) | null>(null);
  const layoutNodes = layout.nodes;
  const viewportRef = useRef(props.viewport);
  viewportRef.current = props.viewport;
  const worldRef = useRef<GraphWorld>({ width: layout.width, height: layout.height });
  worldRef.current = { width: layout.width, height: layout.height };
  const onViewportRef = useRef(props.onViewportChange);
  onViewportRef.current = props.onViewportChange;
  const centeredNonce = useRef<number | null>(null);
  const [stage, setStage] = useState({ width: 1, height: 1 });
  const [helpOpen, setHelpOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [holdMap, setHoldMap] = useState(false);
  const centerNonce = props.centerRequest?.nonce ?? null;
  const centerId = props.centerRequest?.id ?? null;

  useEffect(() => {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const measure = () => {
      setStage({ width: Math.max(svg.clientWidth, 1), height: Math.max(svg.clientHeight, 1) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const stageNow = {
        width: rect.width || svg.clientWidth || 1,
        height: rect.height || svg.clientHeight || 1,
      };
      const viewport = viewportRef.current;
      const world = worldRef.current;
      if (event.ctrlKey || event.metaKey) {
        onViewportRef.current(
          zoomAt(
            viewport,
            world,
            stageNow,
            event.clientX - rect.left,
            event.clientY - rect.top,
            wheelZoomFactor(event.deltaY, event.deltaMode),
          ),
        );
        return;
      }
      onViewportRef.current(panByWheel(viewport, world, stageNow, event.deltaX, event.deltaY, event.deltaMode));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.code !== 'Space') return;
      if (!spaceRef.current) return;
      spaceRef.current = false;
      setSpaceDown(false);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      observer.disconnect();
      wrap.removeEventListener('wheel', onWheel);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (centerNonce == null || !centerId || centeredNonce.current === centerNonce) return;
    const node = layout.nodes.find((item) => item.id === centerId);
    const svg = svgRef.current;
    if (!node || !svg || svg.clientWidth <= 0 || svg.clientHeight <= 0) return;
    centeredNonce.current = centerNonce;
    const boxes = layout.nodes.map((item) => ({
      x: item.x,
      y: item.y,
      width: CONCEPT_NODE_SIZE.width,
      height: CONCEPT_NODE_SIZE.height,
    }));
    onViewportRef.current(
      frameNeighborhood(
        { width: layout.width, height: layout.height },
        { width: svg.clientWidth, height: svg.clientHeight },
        { x: node.x, y: node.y, width: CONCEPT_NODE_SIZE.width, height: CONCEPT_NODE_SIZE.height },
        boxes,
      ),
    );
  }, [centerNonce, centerId, layout, stage.width, stage.height]);

  const graphCovered = viewportCoversBoxes(
    props.viewport,
    { width: layout.width, height: layout.height },
    layout.nodes.map((node) => ({
      x: node.x,
      y: node.y,
      width: CONCEPT_NODE_SIZE.width,
      height: CONCEPT_NODE_SIZE.height,
    })),
  );
  useEffect(() => {
    if (!graphCovered) setHoldMap(false);
  }, [graphCovered]);

  useEffect(() => {
    return () => stopConnect.current?.();
  }, []);

  const toWorld = (event: { clientX: number; clientY: number }, svg: SVGSVGElement) => {
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const world = point.matrixTransform(ctm.inverse());
      return { x: world.x, y: world.y };
    }
    const rect = svg.getBoundingClientRect();
    const box = svg.viewBox.baseVal;
    const width = rect.width || 1;
    const height = rect.height || 1;
    return {
      x: box.x + ((event.clientX - rect.left) / width) * box.width,
      y: box.y + ((event.clientY - rect.top) / height) * box.height,
    };
  };

  const nodeUnderPointer = (event: { clientX: number; clientY: number }, svg: SVGSVGElement, fromId: string) => {
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const id = hit?.closest('.concept-node')?.getAttribute('data-concept-id');
    if (id) return id === fromId ? null : id;
    return hitConceptNode(toWorld(event, svg), layoutNodes, CONCEPT_NODE_SIZE, fromId);
  };

  const beginConnect = (fromId: string, event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg || !props.onConnect) return;
    stopConnect.current?.();
    linkingRef.current = true;
    const place = (point: { clientX: number; clientY: number }) => {
      const world = toWorld(point, svg);
      const targetId = nodeUnderPointer(point, svg, fromId);
      setConnect({ fromId, x: world.x, y: world.y, targetId });
    };
    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (stopConnect.current === detach) stopConnect.current = null;
      setConnect(null);
      linkingRef.current = false;
    };
    const onMove = (move: PointerEvent) => place(move);
    const onUp = (up: PointerEvent) => {
      const targetId = up.type === 'pointerup' ? nodeUnderPointer(up, svg, fromId) : null;
      detach();
      if (targetId) props.onConnect?.(fromId, targetId);
    };
    stopConnect.current = detach;
    place(event);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const screenScale = (svg: SVGSVGElement) => {
    const box = viewBoxSize(worldRef.current, viewportRef.current.zoom);
    return viewMeet({ width: svg.clientWidth || 1, height: svg.clientHeight || 1 }, box).scale;
  };

  const focusGraph = () => svgRef.current?.focus({ preventScroll: true });

  const beginDrag = (
    event: { clientX: number; clientY: number; pointerId: number; button: number },
    kind: 'pan' | 'node',
    pan: 'blank' | 'space' | 'middle' | null,
    id?: string,
  ) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    focusGraph();
    const world = toWorld(event, svg);
    dragRef.current = {
      kind,
      pan,
      ...(id ? { id } : {}),
      startX: event.clientX,
      startY: event.clientY,
      baseX: kind === 'pan' ? props.viewport.x : world.x - (posById.get(id ?? '')?.x ?? 0),
      baseY: kind === 'pan' ? props.viewport.y : world.y - (posById.get(id ?? '')?.y ?? 0),
      scale: screenScale(svg),
      moved: false,
    };
  };

  const onBackgroundPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button === 2) return;
    if (event.button === 1) {
      event.preventDefault();
      beginDrag(event, 'pan', 'middle');
      return;
    }
    if (event.button !== 0) return;
    beginDrag(event, 'pan', spaceRef.current ? 'space' : 'blank');
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    setDragging(true);
    const svg = svgRef.current;
    if (!svg) return;
    if (drag.kind === 'pan') {
      const scale = drag.scale > 0 ? drag.scale : 1;
      props.onViewportChange({
        ...props.viewport,
        x: drag.baseX - dx / scale,
        y: drag.baseY - dy / scale,
      });
      return;
    }
    if (drag.id) {
      const world = toWorld(event, svg);
      const next = new Map(posById);
      next.set(drag.id, { x: world.x - drag.baseX, y: world.y - drag.baseY });
      props.onPositionsChange(next);
    }
  };

  const onPointerUp = (_event?: unknown, id?: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag || drag.moved) return;
    if (drag.kind === 'node') {
      const selected = id ?? drag.id;
      if (selected) props.onSelectConcept(selected);
      return;
    }
    if (drag.pan === 'blank') props.onDismiss?.();
  };

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.nativeEvent.isComposing || shortcutBlockedTarget(event.target)) return;
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      if (!spaceRef.current) {
        spaceRef.current = true;
        setSpaceDown(true);
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const svg = svgRef.current;
    const stageNow = {
      width: svg?.clientWidth || stage.width,
      height: svg?.clientHeight || stage.height,
    };
    const world = { width: layout.width, height: layout.height };
    const pan = keyboardPan(event.key, event.shiftKey);
    if (pan) {
      event.preventDefault();
      const scale = svg ? screenScale(svg) : 1;
      props.onViewportChange({
        ...props.viewport,
        x: props.viewport.x + pan.x / scale,
        y: props.viewport.y + pan.y / scale,
      });
      return;
    }
    const factor = keyboardZoomFactor(event.key);
    if (factor) {
      event.preventDefault();
      props.onViewportChange(zoomAtCenter(props.viewport, world, stageNow, factor));
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      props.onViewportChange(fitViewport());
      return;
    }
    if (event.key === 'Enter' && props.selectedId) {
      event.preventDefault();
      props.onExpandNeighbors(props.selectedId);
      return;
    }
    if (event.key === 'Backspace' && props.canBack) {
      event.preventDefault();
      props.onBack?.();
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      setHelpOpen((open) => !open);
    }
  };

  const selectedRelation = props.selectedRelationId;
  const world = { width: layout.width, height: layout.height };
  const mapSize = { width: 168, height: 112 };
  const frame = conceptMinimapFrame(world, mapSize);
  const miniVp = conceptMinimapViewport(props.viewport, world, frame);

  const jumpMinimap = (mapX: number, mapY: number) => {
    props.onViewportChange(conceptMinimapCenter(mapX, mapY, frame, props.viewport, world, stage));
  };

  const zoomBy = (key: string) => {
    const factor = keyboardZoomFactor(key);
    if (!factor) return;
    const svg = svgRef.current;
    props.onViewportChange(
      zoomAtCenter(
        props.viewport,
        world,
        { width: svg?.clientWidth || stage.width, height: svg?.clientHeight || stage.height },
        factor,
      ),
    );
    focusGraph();
  };

  const crumbs = props.crumbs ?? [];
  const showCrumbs = crumbs.length > 1;
  const backLabel = showCrumbs ? crumbs[crumbs.length - 2]?.label : '';
  const showMap = !graphCovered || holdMap;

  return (
    <div ref={wrapRef} className={`concept-graph-wrap${focused ? ' is-focused' : ''}${spaceDown ? ' is-space' : ''}`}>
    <svg
      ref={svgRef}
      className={`concept-graph${dragging ? ' is-dragging' : ''}${connect ? ' is-connecting' : ''}`}
      viewBox={`${props.viewport.x} ${props.viewport.y} ${layout.width / props.viewport.zoom} ${layout.height / props.viewport.zoom}`}
      role="application"
      aria-label="概念关系图"
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerUp(event)}
      onKeyDown={onKeyDown}
      onAuxClick={(event) => event.preventDefault()}
    >
      <defs>
        <marker id="concept-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="concept-edge-arrow" />
        </marker>
      </defs>
      {props.relations.map((relation) => {
        const from = posById.get(relation.fromConceptId);
        const to = posById.get(relation.toConceptId);
        if (!from || !to) return null;
        const label = edgeLabelPoint(from, to);
        const highlighted = props.highlightRelationIds.has(relation.id);
        return (
          <g
            key={relation.id}
            className={`concept-edge${selectedRelation === relation.id ? ' is-selected' : ''}${highlighted ? ' is-highlight' : ''}${relation.basis === 'inferred' ? ' is-inferred' : ''}`}
          >
            <path
              d={edgePath(from, to)}
              className="concept-edge-hit"
              onPointerDown={(event) => {
                event.stopPropagation();
                props.onSelectRelation(relation.id);
              }}
            />
            <path
              d={edgePath(from, to)}
              className="concept-edge-line"
              markerEnd="url(#concept-arrow)"
            />
            <text
              className="concept-edge-label"
              x={label.x}
              y={label.y}
              textAnchor="middle"
              onPointerDown={(event) => {
                event.stopPropagation();
                props.onSelectRelation(relation.id);
              }}
            >
              {relation.predicate}
            </text>
          </g>
        );
      })}
      {props.concepts.map((concept) => {
        const pos = posById.get(concept.id);
        if (!pos) return null;
        const selected = props.selectedId === concept.id;
        const highlighted = props.highlightConceptIds.has(concept.id);
        const isContext = props.contextIds?.has(concept.id) === true;
        const connectTarget = connect?.targetId === concept.id;
        return (
          <g
            key={concept.id}
            className={`concept-node${selected ? ' is-selected' : ''}${highlighted ? ' is-highlight' : ''}${isContext ? ' is-context' : ''}${connectTarget ? ' is-connect-target' : ''}`}
            data-concept-id={concept.id}
            transform={`translate(${pos.x}, ${pos.y})`}
            onPointerDown={(event) => {
              if (event.button === 1 || (event.button === 0 && spaceRef.current)) {
                event.stopPropagation();
                event.preventDefault();
                beginDrag(event, 'pan', event.button === 1 ? 'middle' : 'space');
                return;
              }
              if (event.button !== 0) return;
              event.stopPropagation();
              beginDrag(event, 'node', null, concept.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              props.onExpandNeighbors(concept.id);
            }}
            onPointerUp={(event) => {
              // 拖线松手要冒泡到 window，才能落到目标概念上。
              if (linkingRef.current) return;
              event.stopPropagation();
              onPointerUp(event, concept.id);
            }}
          >
            <title>{concept.sense ? `${concept.name}（${concept.sense}）` : concept.name}</title>
            <rect width={CONCEPT_NODE_SIZE.width} height={CONCEPT_NODE_SIZE.height} rx="10" />
            <text x="10" y="24" className="concept-node-name">
              {concept.name.length > 12 ? `${concept.name.slice(0, 12)}…` : concept.name}
            </text>
            {concept.sense ? (
              <text x="10" y="42" className="concept-node-sense">
                {concept.sense.length > 14 ? `${concept.sense.slice(0, 14)}…` : concept.sense}
              </text>
            ) : null}
            <text
              x={concept.sense ? CONCEPT_NODE_SIZE.width - 12 : 12}
              y={concept.sense ? 16 : CONCEPT_NODE_SIZE.height - 8}
              textAnchor={concept.sense ? 'end' : 'start'}
              className="concept-node-expand"
              onPointerDown={(event) => {
                event.stopPropagation();
                props.onExpandNeighbors(concept.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
              }}
            >
              展开
            </text>
            {props.onConnect ? (
              <g
                className="concept-node-port"
                role="button"
                aria-label={`从${concept.name}拖出关系`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  beginConnect(concept.id, event);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                }}
              >
                <title>拖到另一个概念，建立关系</title>
                <circle className="concept-node-port-hit" cx={CONCEPT_NODE_SIZE.width} cy={CONCEPT_NODE_SIZE.height / 2} r={12} />
                <circle className="concept-node-port-dot" cx={CONCEPT_NODE_SIZE.width} cy={CONCEPT_NODE_SIZE.height / 2} r={3.5} />
              </g>
            ) : null}
          </g>
        );
      })}
      {connect ? (
        <path
          className="concept-connect-line"
          d={connectLine(connect.fromId, connect.x, connect.y, connect.targetId, posById)}
          markerEnd="url(#concept-arrow)"
        />
      ) : null}
      {!props.edgesComplete ? (
        <text x={props.viewport.x + 16} y={props.viewport.y + 24} className="concept-graph-loading">
          关系加载中…
        </text>
      ) : null}
    </svg>
    <div className="concept-graph-chrome">
      {showCrumbs ? (
        <nav className="concept-graph-crumbs" aria-label="展开路径">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <span key={`${index}-${crumb.label}`} className="concept-graph-crumb">
                {index > 0 ? <span className="concept-graph-crumb-sep">/</span> : null}
                {last ? (
                  <span title={crumb.label}>{crumb.label}</span>
                ) : (
                  <button
                    type="button"
                    title={crumb.label}
                    onClick={() => {
                      props.onJumpFocus?.(index);
                      focusGraph();
                    }}
                  >
                    {crumb.label}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
      ) : null}
      <div className="concept-graph-tools">
        {props.canBack ? (
          <button
            type="button"
            title={backLabel ? `返回${backLabel}` : '返回'}
            onClick={() => {
              props.onBack?.();
              focusGraph();
            }}
          >
            {backLabel ? `返回${backLabel}` : '返回'}
          </button>
        ) : null}
        <button type="button" aria-label="缩小" onClick={() => zoomBy('-')}>−</button>
        <button
          type="button"
          onClick={() => {
            props.onViewportChange(fitViewport());
            focusGraph();
          }}
        >
          适应
        </button>
        <button type="button" aria-label="放大" onClick={() => zoomBy('+')}>+</button>
        <button
          type="button"
          aria-label="快捷键"
          aria-expanded={helpOpen}
          onClick={() => {
            setHelpOpen((open) => !open);
            focusGraph();
          }}
        >
          ?
        </button>
      </div>
      {helpOpen ? (
        <div className="concept-graph-help" role="note">
          <p>方向键平移，按住 Shift 更快</p>
          <p>+ / − 缩放，0 适应全部</p>
          <p>触控板双指滑动平移，捏合缩放</p>
          <p>空格拖动或中键平移</p>
          <p>双击节点展开，Enter 展开选中</p>
          <p>Backspace 返回上一层，Esc 关闭详情</p>
        </div>
      ) : null}
    </div>
    {showMap ? (
      <ConceptMinimap
        nodes={layout.nodes}
        selectedId={props.selectedId}
        frame={frame}
        viewportRect={miniVp}
        onJump={jumpMinimap}
        onCollapse={graphCovered ? () => setHoldMap(false) : undefined}
      />
    ) : (
      <button type="button" className="concept-minimap-toggle" onClick={() => setHoldMap(true)}>
        地图
      </button>
    )}
    </div>
  );
});

const MAP_W = 168;
const MAP_H = 112;

function ConceptMinimap({
  nodes,
  selectedId,
  frame,
  viewportRect,
  onJump,
  onCollapse,
}: {
  nodes: ConceptGraphLayout['nodes'];
  selectedId: string | null;
  frame: { scale: number; offsetX: number; offsetY: number };
  viewportRect: { x: number; y: number; width: number; height: number };
  onJump(mapX: number, mapY: number): void;
  onCollapse?(): void;
}) {
  const dragging = useRef(false);
  const jump = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onJump(event.clientX - rect.left, event.clientY - rect.top);
  };
  return (
    <div
      className="concept-minimap"
      role="presentation"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        jump(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) jump(event);
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
        {nodes.map((node) => (
          <rect
            key={node.id}
            className={node.id === selectedId ? 'is-on' : undefined}
            x={node.x * frame.scale + frame.offsetX}
            y={node.y * frame.scale + frame.offsetY}
            width={Math.max(3, CONCEPT_NODE_SIZE.width * frame.scale)}
            height={Math.max(2, CONCEPT_NODE_SIZE.height * frame.scale)}
            rx={1.5}
          />
        ))}
        <rect
          className="concept-minimap-vp"
          x={viewportRect.x}
          y={viewportRect.y}
          width={Math.max(4, viewportRect.width)}
          height={Math.max(4, viewportRect.height)}
          rx={3}
        />
      </svg>
      {onCollapse ? (
        <button
          type="button"
          className="concept-minimap-hide"
          aria-label="收起地图"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onCollapse}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
