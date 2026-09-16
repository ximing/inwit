import { observer, useService } from '@rabjs/react';
import { Loader2, Search, X } from 'lucide-react';
import { useCallback, useLayoutEffect } from 'react';
import { useLocation } from 'react-router';
import {
  SEARCH_FOCUS_EVENT,
  consumeSearchFocus,
  locationWantsSearchFocus,
  searchHotkeyHint,
} from './search-hotkey';
import { SearchService } from './search.service';

export const SearchBox = observer(function SearchBox({
  placeholder = '搜索文档和卡片…',
  onFocusRequest,
  onDismiss,
}: {
  placeholder?: string;
  onFocusRequest?: () => void;
  onDismiss?: () => void;
}) {
  const search = useService(SearchService);
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
      onFocusRequest?.();
      search.focusInput();
      requestAnimationFrame(() => search.focusInput());
    };
    window.addEventListener(SEARCH_FOCUS_EVENT, run);
    if (consumeSearchFocus() || wantsFocus) run();
    return () => window.removeEventListener(SEARCH_FOCUS_EVENT, run);
  }, [onFocusRequest, search, wantsFocus]);

  const dismissOrClear = () => {
    if (onDismiss) onDismiss();
    else search.clear();
  };

  return (
    <div className={`search-box${searching ? ' is-loading' : ''}`} role="search">
      <span className="search-box-ico" aria-hidden>
        {searching ? (
          <Loader2 className="icon-spin" width={16} height={16} strokeWidth={1.8} />
        ) : (
          <Search width={16} height={16} strokeWidth={1.8} />
        )}
      </span>
      <input
        ref={bindRef}
        type="search"
        name="q"
        value={search.query}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-label="搜索"
        aria-keyshortcuts="Meta+K Control+K"
        autoFocus={wantsFocus}
        onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          dismissOrClear();
        }}
      />
      {search.query ? (
        <button
          type="button"
          className="search-box-clear"
          aria-label="清空"
          onClick={() => dismissOrClear()}
        >
          <X width={14} height={14} strokeWidth={1.8} />
        </button>
      ) : (
        <span className="search-box-hint" aria-hidden>
          <span className="kbd">{hint}</span>
        </span>
      )}
    </div>
  );
});
