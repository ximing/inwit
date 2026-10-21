import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Concept, ConceptRelation } from '@inwit/dto';
import { placeConceptCard, type CardPlacement, type CardRect, type CardStage } from './concept-card-logic.js';

export interface ConceptCardNeighbor {
  id: string;
  name: string;
  predicate: string;
  /** out = 当前概念指出（谓词 → 邻居）；in = 邻居指入（邻居 → 谓词）。 */
  dir: 'out' | 'in';
}

interface CardShellProps {
  anchor: CardRect;
  stage: CardStage;
  label: string;
  onDismiss(): void;
  children: ReactNode;
}

/** 跟随图视口的轻信息卡：位置跟随锚点，字号恒定；测出尺寸前隐藏，避免闪烁。 */
function CardShell({ anchor, stage, label, onDismiss, children }: CardShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) =>
        prev && Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const placement: CardPlacement | null = size ? placeConceptCard(anchor, stage, size) : null;
  const horizontal = placement?.side === 'right' || placement?.side === 'left';

  return (
    <div
      ref={ref}
      className="concept-card"
      data-side={placement?.side ?? 'right'}
      role="dialog"
      aria-label={label}
      style={{
        left: placement ? placement.left : 0,
        top: placement ? placement.top : 0,
        visibility: placement ? 'visible' : 'hidden',
        ['--caret-pos' as never]: `${placement?.caret ?? 0}px`,
      }}
      onWheel={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" className="concept-card-close" onClick={onDismiss} aria-label="收起">
        <X width={13} height={13} strokeWidth={1.8} />
      </button>
      <span className={`concept-card-caret${horizontal ? ' is-v' : ' is-h'}`} aria-hidden />
      {children}
    </div>
  );
}

export function ConceptNodeCard({
  concept,
  neighbors,
  anchor,
  stage,
  onSelectConcept,
  onOpenDetail,
  onDismiss,
}: {
  concept: Concept;
  neighbors: ConceptCardNeighbor[];
  anchor: CardRect;
  stage: CardStage;
  onSelectConcept(id: string): void;
  onOpenDetail(): void;
  onDismiss(): void;
}) {
  return (
    <CardShell anchor={anchor} stage={stage} label={`概念 ${concept.name}`} onDismiss={onDismiss}>
      <div className="concept-card-head">
        <h3>{concept.name}</h3>
        {concept.sense ? <span className="concept-card-sense">{concept.sense}</span> : null}
      </div>
      {concept.aliases.length > 0 ? <p className="concept-card-aliases">别名：{concept.aliases.join('、')}</p> : null}
      {concept.definition ? <p className="concept-card-def">{concept.definition}</p> : null}
      {concept.example ? <p className="concept-card-example">例：{concept.example}</p> : null}
      {neighbors.length > 0 ? (
        <div className="concept-card-rels">
          {neighbors.map((neighbor) => (
            <button
              key={`${neighbor.dir}-${neighbor.id}-${neighbor.predicate}`}
              type="button"
              title={neighbor.dir === 'out' ? `${concept.name} ${neighbor.predicate} ${neighbor.name}` : `${neighbor.name} ${neighbor.predicate} ${concept.name}`}
              onClick={() => onSelectConcept(neighbor.id)}
            >
              {neighbor.dir === 'out' ? (
                <>
                  {neighbor.predicate} <span className="concept-card-arrow">→</span> {neighbor.name}
                </>
              ) : (
                <>
                  {neighbor.name} <span className="concept-card-arrow">→</span> {neighbor.predicate}
                </>
              )}
            </button>
          ))}
        </div>
      ) : null}
      <div className="concept-card-foot">
        <button type="button" className="concept-card-detail-btn" onClick={onOpenDetail}>
          详情<span className="concept-card-arrow">→</span>
        </button>
      </div>
    </CardShell>
  );
}

export function ConceptRelationCard({
  relation,
  fromName,
  toName,
  anchor,
  stage,
  onOpenDetail,
  onDismiss,
}: {
  relation: ConceptRelation;
  fromName: string;
  toName: string;
  anchor: CardRect;
  stage: CardStage;
  onOpenDetail(): void;
  onDismiss(): void;
}) {
  return (
    <CardShell anchor={anchor} stage={stage} label={`关系 ${relation.predicate}`} onDismiss={onDismiss}>
      <div className="concept-card-head">
        <h3 className="concept-card-rel-title">
          {fromName} <span className="concept-card-arrow">→</span> {relation.predicate}{' '}
          <span className="concept-card-arrow">→</span> {toName}
        </h3>
      </div>
      {relation.basis === 'inferred' ? <p className="concept-card-sense">推断（经确认收录）</p> : null}
      {relation.context ? <p className="concept-card-sense">语境：{relation.context}</p> : null}
      {relation.explanation ? <p className="concept-card-def">{relation.explanation}</p> : null}
      {relation.example ? <p className="concept-card-example">例：{relation.example}</p> : null}
      <div className="concept-card-foot">
        <button type="button" className="concept-card-detail-btn" onClick={onOpenDetail}>
          详情<span className="concept-card-arrow">→</span>
        </button>
      </div>
    </CardShell>
  );
}
