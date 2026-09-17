import { docDisplayTitle, IMAGE_EXCERPT_QUOTE, type SearchResult } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { FileText, Layers, MessageSquareQuote, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { docAnchorPath, docAnnotationPath, docsPath } from '@/routes';
import { SearchService } from './search.service';

export type SearchHitItem = {
  kind: 'document' | 'card' | 'annotation';
  id: string;
  href: string | null;
  title: string;
  meta: string | null;
};

function firstLine(text: string): string {
  return (text.split('\n').find((line) => line.trim().length > 0) ?? '').trim();
}

function annotationHitTitle(quote: string, note: string): string {
  const fromNote = firstLine(note);
  if (fromNote) return fromNote;
  if (quote === IMAGE_EXCERPT_QUOTE) return '图片摘录';
  return firstLine(quote) || quote;
}

export function flattenSearchHits(results: SearchResult): SearchHitItem[] {
  const docs: SearchHitItem[] = results.documents.map((doc) => ({
    kind: 'document',
    id: doc.id,
    href: docsPath(doc.id),
    title: docDisplayTitle(doc),
    meta: doc.topicTitle,
  }));
  const cards: SearchHitItem[] = results.cards.map((card) => ({
    kind: 'card',
    id: card.id,
    href: card.documentId ? docAnchorPath(card.documentId, card.id) : null,
    title: card.concept,
    meta: card.documentTitle,
  }));
  const annotations: SearchHitItem[] = (results.annotations ?? []).map((annotation) => ({
    kind: 'annotation',
    id: annotation.id,
    href: docAnnotationPath(annotation.documentId, annotation.id),
    title: annotationHitTitle(annotation.quote, annotation.note),
    meta: annotation.documentTitle,
  }));
  return [...docs, ...cards, ...annotations];
}

function hitKey(hit: SearchHitItem): string {
  return `${hit.kind}-${hit.id}`;
}

export function SearchHitRow({
  hit,
  index,
  active,
  onHover,
}: {
  hit: SearchHitItem;
  index: number;
  active?: boolean;
  onHover?: (index: number) => void;
}) {
  const Icon: LucideIcon =
    hit.kind === 'document' ? FileText : hit.kind === 'card' ? Layers : MessageSquareQuote;
  const className = `search-hit${active ? ' is-active' : ''}${hit.href ? '' : ' is-static'}`;
  const hitId = `search-hit-${String(index)}`;
  const body = (
    <>
      <span className="search-hit-ico" aria-hidden>
        <Icon width={15} height={15} strokeWidth={1.8} />
      </span>
      <span className="search-hit-label">{hit.title}</span>
      {hit.meta ? <span className="search-hit-meta">{hit.meta}</span> : null}
    </>
  );

  useEffect(() => {
    if (!active) return;
    document.getElementById(hitId)?.scrollIntoView({ block: 'nearest' });
  }, [active, hitId]);

  if (!hit.href) {
    return (
      <div
        className={className}
        id={hitId}
        role="option"
        aria-selected={active ?? false}
        data-hit={index}
        onMouseEnter={() => onHover?.(index)}
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      className={className}
      id={hitId}
      role="option"
      aria-selected={active ?? false}
      data-hit={index}
      to={hit.href}
      onMouseEnter={() => onHover?.(index)}
    >
      {body}
    </Link>
  );
}

export const SearchResults = observer(function SearchResults({
  variant = 'compact',
  navigable = false,
}: {
  variant?: 'compact' | 'palette';
  navigable?: boolean;
}) {
  const search = useService(SearchService);
  const results = search.results;
  const error = search.error;
  const className = `search-results search-results-${variant}`;

  if (error) {
    return (
      <div className={className} role="alert">
        <p className="search-status">{error}</p>
        <button type="button" className="btn btn-ghost" onClick={() => search.retry()}>
          {search.$model.runSearch.loading ? '重试中…' : '重试'}
        </button>
      </div>
    );
  }

  if (search.isEmpty) {
    return (
      <div className={className}>
        <p className="search-status">没有搜到，换个说法试试</p>
      </div>
    );
  }

  if (!results) {
    if (search.searching) {
      return (
        <div className={className}>
          <p className="search-status">正在搜索…</p>
        </div>
      );
    }
    return null;
  }

  const hits = flattenSearchHits(results);
  if (hits.length === 0) return null;

  const docs = hits.filter((hit) => hit.kind === 'document');
  const cards = hits.filter((hit) => hit.kind === 'card');
  const annotations = hits.filter((hit) => hit.kind === 'annotation');
  const activeIndex = navigable ? search.activeIndex : -1;
  const onHover = navigable ? (index: number) => search.setActiveIndex(index) : undefined;

  return (
    <div className={className} role="listbox" aria-label="搜索结果">
      {docs.length > 0 ? (
        <section className="search-group">
          <h3 className="search-group-title">文档</h3>
          {docs.map((hit, index) => (
            <SearchHitRow
              key={hitKey(hit)}
              hit={hit}
              index={index}
              active={activeIndex === index}
              onHover={onHover}
            />
          ))}
        </section>
      ) : null}
      {cards.length > 0 ? (
        <section className="search-group">
          <h3 className="search-group-title">卡片</h3>
          {cards.map((hit, index) => {
            const absolute = docs.length + index;
            return (
              <SearchHitRow
                key={hitKey(hit)}
                hit={hit}
                index={absolute}
                active={activeIndex === absolute}
                onHover={onHover}
              />
            );
          })}
        </section>
      ) : null}
      {annotations.length > 0 ? (
        <section className="search-group">
          <h3 className="search-group-title">批注</h3>
          {annotations.map((hit, index) => {
            const absolute = docs.length + cards.length + index;
            return (
              <SearchHitRow
                key={hitKey(hit)}
                hit={hit}
                index={absolute}
                active={activeIndex === absolute}
                onHover={onHover}
              />
            );
          })}
        </section>
      ) : null}
    </div>
  );
});
