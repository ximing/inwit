export const SEARCH_FOCUS_EVENT = 'inwit:focus-search';

let pendingFocus = false;

export type SearchFocusState = { focusSearch?: boolean };

export function requestSearchFocus(): void {
  pendingFocus = true;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SEARCH_FOCUS_EVENT));
}

export function consumeSearchFocus(): boolean {
  const pending = pendingFocus;
  pendingFocus = false;
  return pending;
}

export function locationWantsSearchFocus(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  return Boolean((state as SearchFocusState).focusSearch);
}

export function isSearchHotkey(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat) return false;
  if (event.altKey || event.shiftKey) return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  return event.key === 'k' || event.key === 'K';
}

export function searchHotkeyHint(): string {
  if (typeof navigator === 'undefined') return '⌘K';
  return /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K';
}
