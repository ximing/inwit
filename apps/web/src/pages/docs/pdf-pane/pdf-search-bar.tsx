import { ignore } from '@embedpdf/models';
import { useSearch } from '@embedpdf/plugin-search/react';
import { observer, useService } from '@rabjs/react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { PdfPaneService } from '../pdf-pane.service';
import { searchResultLabel } from './chrome-logic.js';

const SEARCH_DEBOUNCE_MS = 220;

export const PdfSearchBar = observer(function PdfSearchBar({ documentId }: { documentId: string }) {
  const pdf = useService(PdfPaneService);
  const search = useSearch(documentId);
  const inputRef = useRef<HTMLInputElement>(null);
  const total = search.state.total;
  const label = searchResultLabel(search.state.activeResultIndex, total);
  const hasHits = total > 0;
  const disabledNav = !hasHits || !search.provides;

  useEffect(() => {
    if (!pdf.searchOpen) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [pdf.searchOpen, pdf.searchFocusGen]);

  useEffect(() => {
    if (pdf.searchOpen) return;
    search.provides?.stopSearch();
  }, [pdf.searchOpen, search.provides]);

  useEffect(() => {
    if (!pdf.searchOpen) return;
    const query = pdf.searchQuery.trim();
    const api = search.provides;
    if (!api) return;
    const timer = window.setTimeout(() => {
      if (!query) {
        api.stopSearch();
        return;
      }
      api.startSearch();
      api.searchAllPages(query).wait((result) => {
        if (result.results.length > 0) api.goToResult(0);
      }, ignore);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [pdf.searchOpen, pdf.searchQuery, search.provides]);

  const close = () => {
    search.provides?.stopSearch();
    pdf.closeSearch();
  };

  return (
    <div className={pdf.searchOpen ? 'pdf-search is-open' : 'pdf-search'} aria-hidden={!pdf.searchOpen}>
      <div className="pdf-search-inner" inert={!pdf.searchOpen}>
        <div className="pdf-search-row">
          <input
            ref={inputRef}
            type="search"
            className="pdf-search-input"
            placeholder="在文档中查找"
            aria-label="在文档中查找"
            value={pdf.searchQuery}
            onChange={(event) => pdf.setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (!search.provides) return;
              if (event.shiftKey) search.provides.previousResult();
              else if (hasHits) search.provides.nextResult();
            }}
          />
          <span className="pdf-search-count" aria-live="polite">
            {pdf.searchQuery.trim() ? label : ''}
          </span>
          <button
            type="button"
            className="btn btn-ghost pdf-icon-btn"
            aria-label="上一个"
            title="上一个"
            disabled={disabledNav}
            onClick={() => search.provides?.previousResult()}
          >
            <ChevronUp width={14} height={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="btn btn-ghost pdf-icon-btn"
            aria-label="下一个"
            title="下一个"
            disabled={disabledNav}
            onClick={() => search.provides?.nextResult()}
          >
            <ChevronDown width={14} height={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="btn btn-ghost pdf-icon-btn"
            aria-label="关闭查找"
            title="关闭查找"
            onClick={close}
          >
            <X width={14} height={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
});
