export function loadPdfPane() {
  return import('./pdf-pane');
}

export function prefetchPdfPane(): void {
  void loadPdfPane();
  // 引擎（worker + wasm）与文档无关，提前点火，点开时直接进入读文档阶段
  void import('./pdf-pane/pdf-engine').then((mod) => mod.warmPdfEngine());
}
