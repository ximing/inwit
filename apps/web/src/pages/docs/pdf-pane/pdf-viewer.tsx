import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF, useDocumentState } from '@embedpdf/core/react';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { ignore, type Rect } from '@embedpdf/models';
import {
  AnnotationLayer,
  AnnotationPluginPackage,
  LockModeType,
  useAnnotation,
} from '@embedpdf/plugin-annotation/react';
import {
  CapturePluginPackage,
  useCapture,
  useCaptureCapability,
  type CaptureAreaEvent,
} from '@embedpdf/plugin-capture/react';
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/react';
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react';
import {
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from '@embedpdf/plugin-interaction-manager/react';
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { Rotate, RotatePluginPackage } from '@embedpdf/plugin-rotate/react';
import { Scroller, ScrollPluginPackage, useScroll, useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { SearchLayer, SearchPluginPackage, useSearch } from '@embedpdf/plugin-search/react';
import {
  SelectionLayer,
  SelectionPluginPackage,
  useSelectionCapability,
  type SelectionSelectionMenuProps,
} from '@embedpdf/plugin-selection/react';
import { ThumbnailPluginPackage } from '@embedpdf/plugin-thumbnail/react';
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import {
  ZoomGestureWrapper,
  ZoomMode,
  ZoomPluginPackage,
  useZoom,
} from '@embedpdf/plugin-zoom/react';
import { observer, useService } from '@rabjs/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { ThemeService } from '@/services/theme.service';
import { DocsService } from '../docs.service';
import { PdfPaneService } from '../pdf-pane.service';
import { SelectionActions } from '../selection-toolbar';
import { geometryFromRects, importAnnotationsFromOwn, PDF_EXCERPT_STROKE } from './annotation-adapter';
import { isEditableKeyTarget, pdfViewerKeyAction } from './chrome-logic.js';
import { PdfSearchBar } from './pdf-search-bar.js';
import { PdfThumbs } from './pdf-thumbs.js';
import { PdfToolbar } from './pdf-toolbar.js';
import { isMarqueeLargeEnough, rectsFromFormattedSelection } from './selection-logic.js';
import { toAbsoluteUrl } from './wasm-url-logic';

type PdfViewerProps = {
  documentId: string;
  fileUrl: string;
};

function buildPlugins(documentId: string, fileUrl: string) {
  return [
    createPluginRegistration(DocumentManagerPluginPackage, {
      initialDocuments: [{ url: fileUrl, documentId, autoActivate: true }],
    }),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 20 }),
    createPluginRegistration(ScrollPluginPackage, { defaultPageGap: 24 }),
    createPluginRegistration(RenderPluginPackage),
    createPluginRegistration(RotatePluginPackage),
    createPluginRegistration(ZoomPluginPackage, {
      defaultZoomLevel: ZoomMode.FitWidth,
    }),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(SelectionPluginPackage),
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(AnnotationPluginPackage, {
      annotationAuthor: 'inwit',
      autoCommit: false,
      selectAfterCreate: false,
      deactivateToolAfterCreate: true,
      locked: { type: LockModeType.All },
    }),
    createPluginRegistration(CapturePluginPackage, {
      scale: 2,
      imageType: 'image/png',
      withAnnotations: false,
    }),
    createPluginRegistration(SearchPluginPackage, { showAllResults: true }),
    createPluginRegistration(ThumbnailPluginPackage, {
      width: 120,
      gap: 10,
      labelHeight: 18,
      paddingY: 8,
      autoScroll: true,
    }),
  ];
}

type MarqueePreview = { pageIndex: number; rect: Rect };

/**
 * Same preview as plugin MarqueeCapture, plus a ref of the last rect so a
 * pointercancel (CDP mouseReleased often synthesizes this instead of pointerup)
 * can still commit the excerpt.
 */
function PdfMarqueeCapture({
  documentId,
  pageIndex,
  lastRef,
}: {
  documentId: string;
  pageIndex: number;
  lastRef: MutableRefObject<MarqueePreview | null>;
}) {
  const { provides: captureApi } = useCaptureCapability();
  const documentState = useDocumentState(documentId);
  const [rect, setRect] = useState<Rect | null>(null);
  const scale = documentState?.scale ?? 1;

  useEffect(() => {
    if (!captureApi) return;
    return captureApi.registerMarqueeOnPage({
      documentId,
      pageIndex,
      scale,
      callback: {
        onPreview: (next) => {
          lastRef.current = next ? { pageIndex, rect: next } : null;
          setRect(next);
        },
      },
    });
  }, [captureApi, documentId, pageIndex, scale, lastRef]);

  if (!rect) return null;
  return (
    <div
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        left: rect.origin.x * scale,
        top: rect.origin.y * scale,
        width: rect.size.width * scale,
        height: rect.size.height * scale,
        border: '1px solid rgba(196,92,38,0.9)',
        background: 'rgba(196,92,38,0.12)',
        boxSizing: 'border-box',
      }}
    />
  );
}

const PdfSelectionMenu = observer(function PdfSelectionMenu({
  rect,
  menuWrapperProps,
  placement,
}: SelectionSelectionMenuProps) {
  const pdf = useService(PdfPaneService);
  const docs = useService(DocsService);
  const boxRef = useRef<HTMLDivElement>(null);
  const ocrPending = pdf.ocrPending;
  const top = placement.suggestTop ? -48 : rect.size.height + 8;

  if (ocrPending) {
    return (
      <div {...menuWrapperProps}>
        <p className="pdf-sel-hint" style={{ position: 'absolute', top, pointerEvents: 'auto' }}>
          识别中，可先用框选摘录
        </p>
      </div>
    );
  }

  if (!pdf.selectionText && !pdf.selectionGeometry) return null;

  return (
    <div {...menuWrapperProps}>
      <div
        ref={boxRef}
        className="float-toolbar"
        role="toolbar"
        aria-label="划线工具"
        style={{
          position: 'absolute',
          top,
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'auto',
        }}
      >
        <SelectionActions
          text={pdf.selectionText}
          documentId={docs.doc?.id ?? null}
          pdf={pdf.pdfSelection ?? undefined}
          getRect={() => {
            const box = boxRef.current?.getBoundingClientRect();
            if (!box) {
              return { left: 0, top: 0, bottom: 0 };
            }
            return {
              left: box.left + box.width / 2,
              top: box.top,
              bottom: box.bottom,
            };
          }}
        />
      </div>
    </div>
  );
});

const PdfDocumentBody = observer(function PdfDocumentBody({ documentId }: { documentId: string }) {
  const pdf = useService(PdfPaneService);
  const docs = useService(DocsService);
  const theme = useService(ThemeService);
  const isDark = theme.resolved === 'dark';
  const annotation = useAnnotation(documentId);
  const selectionCap = useSelectionCapability();
  const capture = useCapture(documentId);
  const search = useSearch(documentId);
  const scroll = useScroll(documentId);
  const scrollCap = useScrollCapability();
  const zoom = useZoom(documentId);
  const marqueeLastRef = useRef<MarqueePreview | null>(null);
  const jumpSearchRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevThumbsOpen = useRef(pdf.thumbsOpen);
  const pdfAnnKey = docs.annotations
    .filter((item) => item.kind === 'pdf')
    .map((item) => item.id)
    .join('|');
  const jump = pdf.jump;
  const activeCardId = docs.activeCardId;
  const activeAnnotationId = docs.activeAnnotationId;

  useEffect(() => {
    const api = annotation.provides;
    if (!api) return;
    const wantedItems = pdf.ownPdfAnnotations;
    const current = api.getAnnotations();
    const wanted = new Set(wantedItems.map((item) => item.id));
    const have = new Set(current.map((item) => item.object.id));
    for (const tracked of current) {
      if (!wanted.has(tracked.object.id)) {
        api.purgeAnnotation(tracked.object.pageIndex, tracked.object.id);
      }
    }
    const fresh = wantedItems.filter((item) => !have.has(item.id));
    if (fresh.length > 0) {
      api.importAnnotations(importAnnotationsFromOwn(fresh));
    }
  }, [annotation.provides, pdf, pdfAnnKey]);

  useEffect(() => {
    const scope = selectionCap.provides?.forDocument(documentId);
    if (!scope) return;

    const applyFormatted = () => {
      if (pdf.ocrPending) {
        scope.clear();
        pdf.clearSelection();
        return;
      }
      const first = scope.getFormattedSelection()[0];
      if (!first) {
        pdf.clearSelection();
        return;
      }
      const rects = rectsFromFormattedSelection(first);
      pdf.noteSelection({
        text: pdf.selectionText,
        pageIndex: first.pageIndex,
        rects,
      });
      scope.getSelectedText().wait((lines) => {
        pdf.noteSelection({
          text: lines.join('\n'),
          pageIndex: first.pageIndex,
          rects,
        });
      }, ignore);
    };

    const offEnd = scope.onEndSelection(() => {
      applyFormatted();
    });
    const offChange = scope.onSelectionChange((sel) => {
      if (!sel) pdf.clearSelection();
    });

    // CDP Input.dispatchMouseEvent mouseReleased often yields pointercancel, not
    // pointerup. plugin-selection's text handler only ends on pointerup, so the
    // menu placement stays hidden. Commit the in-progress range ourselves.
    const onPointerCancel = () => {
      const state = scope.getState();
      if (state.selecting && state.selection) {
        scope.setSelection(state.selection).wait(applyFormatted, ignore);
      }
      const preview = marqueeLastRef.current;
      const cap = capture.provides;
      if (preview && cap?.isMarqueeCaptureActive() && isMarqueeLargeEnough(preview.rect, 1)) {
        marqueeLastRef.current = null;
        cap.captureArea(preview.pageIndex, preview.rect);
      }
    };
    window.addEventListener('pointercancel', onPointerCancel, true);

    return () => {
      offEnd?.();
      offChange?.();
      window.removeEventListener('pointercancel', onPointerCancel, true);
    };
  }, [selectionCap.provides, capture.provides, documentId, pdf]);

  useEffect(() => {
    const api = capture.provides;
    if (!api) return;
    return api.onCaptureArea((event: CaptureAreaEvent) => {
      const docId = docs.doc?.id;
      if (!docId) return;
      void (async () => {
        const key = await pdf.uploadExcerpt(docId, event.blob);
        if (!key) return;
        const geometry = geometryFromRects([event.rect], PDF_EXCERPT_STROKE);
        await pdf.createExcerptAnnotation({
          documentId: docId,
          pageIndex: event.pageIndex,
          geometry,
          imageKey: key,
        });
      })();
    });
  }, [capture.provides, docs, pdf]);

  useEffect(() => {
    if (!activeAnnotationId) return;
    const item = docs.annotations.find((note) => note.id === activeAnnotationId);
    if (item) pdf.requestJumpFromAnnotation(item);
  }, [activeAnnotationId, docs.annotations, pdf]);

  useEffect(() => {
    if (!activeCardId) return;
    const card = docs.doc?.cards.find((item) => item.id === activeCardId);
    if (card) pdf.requestJumpFromCard(card);
  }, [activeCardId, docs.doc, pdf]);

  useEffect(() => {
    if (!jump) return;
    const request = pdf.consumeJump();
    if (!request) return;
    const go = () => {
      // pageCoordinates 把目标区域（而非页首）滚进视口；alignY 是视口高度百分比
      scroll.provides?.scrollToPage({
        pageNumber: request.pageIndex + 1,
        behavior: 'smooth',
        alignY: 30,
        ...(request.rect
          ? { pageCoordinates: { x: request.rect.origin.x, y: request.rect.origin.y } }
          : {}),
      });
      if (!request.quote || !search.provides) {
        // 跳到无引文的批注（如框选摘录）时，清掉上一次跳转留下的搜索高亮
        if (jumpSearchRef.current) {
          jumpSearchRef.current = false;
          search.provides?.stopSearch();
        }
        return;
      }
      jumpSearchRef.current = true;
      search.provides.startSearch();
      search.provides.searchAllPages(request.quote).wait((result) => {
        const onPage = result.results.findIndex((hit) => hit.pageIndex === request.pageIndex);
        const index = onPage >= 0 ? onPage : 0;
        if (result.results.length === 0) return;
        search.provides?.goToResult(index);
        // 搜索命中的 rect 比页级滚动更准（卡片/纯引文跳转没有 geometry）
        const hit = result.results[index];
        const hitRect = hit?.rects[0];
        if (hit && hitRect) {
          scroll.provides?.scrollToPage({
            pageNumber: hit.pageIndex + 1,
            behavior: 'smooth',
            alignY: 30,
            pageCoordinates: { x: hitRect.origin.x, y: hitRect.origin.y },
          });
        }
      }, ignore);
    };
    if (scroll.provides && scroll.state.totalPages > 0) {
      go();
      return;
    }
    const off = scrollCap.provides?.onLayoutReady((event) => {
      if (event.documentId !== documentId) return;
      go();
      off?.();
    });
    return () => off?.();
  }, [jump, pdf, scroll.provides, scroll.state.totalPages, search.provides, scrollCap.provides, documentId]);

  // 取消选中（点击空白/关闭高亮）或离开页面时，清掉跳转留下的搜索高亮
  useEffect(() => {
    if (activeAnnotationId || activeCardId) return;
    pdf.clearJumpKey();
    if (!jumpSearchRef.current) return;
    jumpSearchRef.current = false;
    search.provides?.stopSearch();
  }, [activeAnnotationId, activeCardId, search.provides, pdf]);

  useEffect(() => {
    return () => {
      if (jumpSearchRef.current) search.provides?.stopSearch();
    };
  }, [search.provides]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target;
      if (!(target instanceof Node) || !root.contains(target)) return;
      const action = pdfViewerKeyAction(event, {
        typing: isEditableKeyTarget(target),
        searchOpen: pdf.searchOpen,
        zoomMenuOpen: pdf.zoomMenuOpen,
      });
      if (!action) return;
      if (action === 'open-search' || action === 'close-search') {
        event.preventDefault();
        event.stopPropagation();
      } else if (action === 'prev-page' || action === 'next-page') {
        event.preventDefault();
      }
      if (action === 'open-search') pdf.openSearch();
      else if (action === 'close-search') {
        search.provides?.stopSearch();
        pdf.closeSearch();
      } else if (action === 'close-zoom') pdf.closeZoomMenu();
      else if (action === 'prev-page') scroll.provides?.scrollToPreviousPage();
      else if (action === 'next-page') scroll.provides?.scrollToNextPage();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pdf, search.provides, scroll.provides]);

  useEffect(() => {
    if (prevThumbsOpen.current === pdf.thumbsOpen) return;
    prevThumbsOpen.current = pdf.thumbsOpen;
    const api = zoom.provides;
    if (!api) return;
    const mode = zoom.state.zoomLevel;
    if (mode !== ZoomMode.FitWidth && mode !== ZoomMode.FitPage) return;
    const timer = window.setTimeout(() => api.requestZoom(mode), 40);
    return () => window.clearTimeout(timer);
  }, [pdf.thumbsOpen, zoom.provides, zoom.state.zoomLevel]);

  return (
    <div className="pdf-doc-body" ref={rootRef} tabIndex={-1}>
      <PdfToolbar documentId={documentId} />
      <PdfSearchBar documentId={documentId} />
      <div className="pdf-stage">
        {pdf.thumbsOpen ? <PdfThumbs documentId={documentId} /> : null}
        <Viewport
          documentId={documentId}
          className="pdf-viewport"
          tabIndex={0}
          aria-label="文档页面"
        >
          <ZoomGestureWrapper documentId={documentId} style={{ height: '100%' }}>
            <Scroller
              documentId={documentId}
              renderPage={({ pageIndex, width, height }) => (
                <Rotate documentId={documentId} pageIndex={pageIndex}>
                  <PagePointerProvider documentId={documentId} pageIndex={pageIndex}>
                    <div className="pdf-page" style={{ width, height, position: 'relative' }}>
                      <RenderLayer documentId={documentId} pageIndex={pageIndex} />
                      <SearchLayer
                        documentId={documentId}
                        pageIndex={pageIndex}
                        highlightColor="#f5e3a4"
                        activeHighlightColor="#d9a824"
                      />
                      <SelectionLayer
                        documentId={documentId}
                        pageIndex={pageIndex}
                        {...(isDark ? { background: 'rgba(122,162,212,0.4)' } : {})}
                        selectionMenu={(props) => <PdfSelectionMenu {...props} />}
                      />
                      <AnnotationLayer documentId={documentId} pageIndex={pageIndex} />
                      <PdfMarqueeCapture
                        documentId={documentId}
                        pageIndex={pageIndex}
                        lastRef={marqueeLastRef}
                      />
                    </div>
                  </PagePointerProvider>
                </Rotate>
              )}
            />
          </ZoomGestureWrapper>
        </Viewport>
      </div>
    </div>
  );
});

export const PdfViewer = observer(function PdfViewer({ documentId, fileUrl }: PdfViewerProps) {
  // Vite `?url` yields a root-relative path in dev; blob workers cannot fetch that.
  const pdfiumWasmUrl = toAbsoluteUrl(wasmUrl);
  const { engine, isLoading, error } = usePdfiumEngine({
    wasmUrl: pdfiumWasmUrl,
    worker: true,
    fontFallback: null,
  });
  const plugins = useMemo(() => buildPlugins(documentId, fileUrl), [documentId, fileUrl]);

  if (error) {
    return <p className="empty">PDF 引擎没能加载</p>;
  }
  if (isLoading || !engine) {
    return (
      <p className="empty">
        <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
        正在打开…
      </p>
    );
  }

  return (
    <div className="pdf-viewer">
      <EmbedPDF engine={engine} plugins={plugins}>
        {({ activeDocumentId }) =>
          activeDocumentId ? (
            <DocumentContent documentId={activeDocumentId}>
              {({ isLoaded, isLoading: docLoading, isError }) => {
                if (isError) return <p className="empty">这份 PDF 打不开</p>;
                if (docLoading || !isLoaded) {
                  return (
                    <p className="empty">
                      <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                      正在打开…
                    </p>
                  );
                }
                return <PdfDocumentBody documentId={activeDocumentId} />;
              }}
            </DocumentContent>
          ) : (
            <p className="empty">正在打开…</p>
          )
        }
      </EmbedPDF>
    </div>
  );
});
