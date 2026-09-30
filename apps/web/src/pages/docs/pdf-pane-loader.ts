export function loadPdfPane() {
  return import('./pdf-pane');
}

export function prefetchPdfPane(): void {
  void loadPdfPane();
}
