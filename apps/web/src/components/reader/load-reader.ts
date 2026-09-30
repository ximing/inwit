export function loadReaderOverlay() {
  return import('./ReaderOverlay');
}

export function prefetchReaderOverlay(): void {
  void loadReaderOverlay();
}
