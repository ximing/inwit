export function loadReportsPane() {
  return import('./reports-pane');
}

export function prefetchReportsPane(): void {
  void loadReportsPane();
}
