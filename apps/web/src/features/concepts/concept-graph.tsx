import { observer } from '@rabjs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Concept, ConceptRelation } from '@inwit/dto';
import { hitConceptNode } from './concept-connect.js';
import { layoutConceptGraph, CONCEPT_NODE_SIZE, type ConceptGraphLayout } from './concept-graph-layout.js';

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
    id?: string;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
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
  const linkingRef = useRef(false);
  const stopConnect = useRef<(() => void) | null>(null);
  const layoutNodes = layout.nodes;

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

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>, kind: 'pan' | 'node', id?: string) => {
    const svg = event.currentTarget;
    svg.setPointerCapture(event.pointerId);
    const world = toWorld(event, svg);
    dragRef.current = {
      kind,
      ...(id ? { id } : {}),
      startX: event.clientX,
      startY: event.clientY,
      baseX: kind === 'pan' ? props.viewport.x : world.x - (posById.get(id ?? '')?.x ?? 0),
      baseY: kind === 'pan' ? props.viewport.y : world.y - (posById.get(id ?? '')?.y ?? 0),
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    setDragging(true);
    const svg = event.currentTarget;
    if (drag.kind === 'pan') {
      props.onViewportChange({
        ...props.viewport,
        x: Math.max(-80, drag.baseX - dx / props.viewport.zoom),
        y: Math.max(-80, drag.baseY - dy / props.viewport.zoom),
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

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>, id?: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (drag?.moved) return;
    if (id) props.onSelectConcept(id);
  };

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY / 100 * 0.4);
    const zoom = Math.min(1.75, Math.max(0.35, props.viewport.zoom * factor));
    props.onViewportChange({ ...props.viewport, zoom });
  };

  const selectedRelation = props.selectedRelationId;

  return (
    <svg
      ref={svgRef}
      className={`concept-graph${dragging ? ' is-dragging' : ''}${connect ? ' is-connecting' : ''}`}
      viewBox={`${props.viewport.x} ${props.viewport.y} ${layout.width / props.viewport.zoom} ${layout.height / props.viewport.zoom}`}
      role="application"
      aria-label="概念关系图"
      onPointerDown={(event) => onPointerDown(event, 'pan')}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerUp(event)}
      onWheel={onWheel}
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
              className="concept-edge-line"
              markerEnd="url(#concept-arrow)"
              onPointerDown={(event) => {
                event.stopPropagation();
                props.onSelectRelation(relation.id);
              }}
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
              event.stopPropagation();
              onPointerDown(event as unknown as React.PointerEvent<SVGSVGElement>, 'node', concept.id);
            }}
            onPointerUp={(event) => {
              // 拖线松手要冒泡到 window，才能落到目标概念上。
              if (linkingRef.current) return;
              event.stopPropagation();
              onPointerUp(event as unknown as React.PointerEvent<SVGSVGElement>, concept.id);
            }}
          >
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
      {props.onFitAll ? (
        <text
          x={layout.width - 70}
          y={22}
          className="concept-graph-fit"
          onPointerDown={(event) => {
            event.stopPropagation();
            props.onFitAll?.();
          }}
        >
          适应全部
        </text>
      ) : null}
    </svg>
  );
});
