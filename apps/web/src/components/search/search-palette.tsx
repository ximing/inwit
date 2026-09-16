import { observer, useService } from '@rabjs/react';
import { Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { flattenSearchHits, SearchResults } from './search-results';
import {
  SEARCH_FOCUS_EVENT,
  consumeSearchFocus,
  locationWantsSearchFocus,
  searchHotkeyHint,
} from './search-hotkey';
import { SearchService } from './search.service';

export const SearchPalette = observer(function SearchPalette() {
  const search = useService(SearchService);
  const navigate = useNavigate();
  const location = useLocation();
  const hint = searchHotkeyHint();
  const searching = search.searching;
  const wantsFocus = locationWantsSearchFocus(location.state);

  const bindRef = useCallback(
    (el: HTMLInputElement | null) => {
      search.bindInput(el);
    },
    [search],
  );

  useLayoutEffect(() => {
    const run = () => {
      consumeSearchFocus();
      search.openSurface();
      requestAnimationFrame(() => search.focusInput());
    };
    window.addEventListener(SEARCH_FOCUS_EVENT, run);
    if (consumeSearchFocus() || wantsFocus) run();
    return () => window.removeEventListener(SEARCH_FOCUS_EVENT, run);
  }, [search, wantsFocus]);

  useLayoutEffect(() => {
    if (!search.surfaceOpen) return;
    search.focusInput();
  }, [search, search.surfaceOpen]);

  useEffect(() => {
    if (!search.surfaceOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [search.surfaceOpen]);

  if (!search.surfaceOpen) return null;

  const openHits = search.results ? flattenSearchHits(search.results) : [];
  const activeId = openHits.length > 0 ? `search-hit-${String(search.activeIndex)}` : undefined;

  return createPortal(
    <div
      className="search-palette-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) search.closeSurface();
      }}
    >
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="搜索"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`search-palette-field${searching ? ' is-loading' : ''}`}>
          <span className="search-palette-ico" aria-hidden>
            {searching ? (
              <Loader2 className="icon-spin" width={18} height={18} strokeWidth={1.8} />
            ) : (
              <Search width={18} height={18} strokeWidth={1.8} />
            )}
          </span>
          <input
            ref={bindRef}
            type="search"
            name="q"
            value={search.query}
            placeholder="搜索文档和卡片…"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            role="combobox"
            aria-label="搜索"
            aria-expanded
            aria-controls="search-palette-list"
            aria-activedescendant={activeId}
            aria-keyshortcuts="Meta+K Control+K"
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                search.closeSurface();
                return;
              }
              const count = openHits.length;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                search.moveActive(1, count);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                search.moveActive(-1, count);
                return;
              }
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const hit = openHits[search.activeIndex];
              if (!hit?.href) return;
              const href = hit.href;
              void navigate(href);
              search.closeSurface();
            }}
          />
          <span className="search-palette-esc" aria-hidden>
            <span className="kbd">Esc</span>
          </span>
        </div>
        <div className="search-palette-body" id="search-palette-list">
          {search.hasQuery ? (
            <SearchResults variant="palette" navigable />
          ) : (
            <div className="search-palette-idle">
              <p className="search-palette-idle-title">搜索文档和卡片</p>
              <p className="search-palette-idle-hint">
                <span className="kbd">{hint}</span>
                随时打开
              </p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
});
