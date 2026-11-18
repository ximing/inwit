import { useDocumentState } from '@embedpdf/core/react';
import { useCapture } from '@embedpdf/plugin-capture/react';
import { observer, useService } from '@rabjs/react';
import { Fragment, useEffect, useRef } from 'react';
import { PdfPaneService } from '../pdf-pane.service.js';
import { PdfTranslationService } from './pdf-translation.service.js';
import { quadBounds } from './translation-geometry-logic.js';

export const PdfTranslationLayer = observer(function PdfTranslationLayer({
  documentId,
  pageIndex,
}: {
  documentId: string;
  pageIndex: number;
}) {
  const s = useService(PdfTranslationService),
    pdf = useService(PdfPaneService);
  const state = useDocumentState(documentId);
  const capture = useCapture(documentId);
  const ref = useRef<HTMLDivElement>(null);
  const page = s.pages[pageIndex];
  const size = state?.document?.pages[pageIndex]?.size;
  const scale = state?.scale ?? 1;
  useEffect(() => {
    if (s.documentId) s.watchPage(pageIndex);
    return () => s.unwatchPage(pageIndex);
  }, [s, s.documentId, pageIndex, !!page]);
  useEffect(() => {
    const layer = ref.current,
      root = layer?.parentElement;
    if (!root || !layer || !s.enabled || capture.state.isMarqueeCaptureActive) return;
    let start: { x: number; y: number; selection: boolean } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dragging = false;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const selection = () => !!pdf.selectionText || !!window.getSelection()?.toString();
    const hit = (x: number, y: number) => {
      const lines = Array.from(layer.querySelectorAll<HTMLElement>('[data-pdf-segment]'));
      // The visible action is outside the text line. Keep it reachable, including
      // the small gap to its anchor, without widening text hit areas across columns.
      const action = Array.from(
        layer.querySelectorAll<HTMLElement>('[data-pdf-translation-action].is-hover'),
      ).find((el) => {
        const b = el.getBoundingClientRect();
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom + 4;
      });
      if (action)
        return lines.find((el) => el.dataset.pdfSegment === action.dataset.pdfTranslationAction);
      return lines.find((el) => {
        const b = el.getBoundingClientRect();
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
      });
    };
    const hover = (id?: string) => {
      for (const node of layer.querySelectorAll<HTMLElement>(
        '[data-pdf-segment], [data-pdf-translation-action]',
      ))
        node.classList.toggle(
          'is-hover',
          !!id && (node.dataset.pdfSegment ?? node.dataset.pdfTranslationAction) === id,
        );
    };
    const down = (e: PointerEvent) => {
      cancel();
      dragging = false;
      start = { x: e.clientX, y: e.clientY, selection: selection() };
      if (selection() || (e.target as Element).closest('.float-toolbar')) hover();
    };
    const move = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
        start = null;
        dragging = true;
        cancel();
      }
      if (dragging || selection() || (e.target as Element).closest('.float-toolbar')) {
        hover();
        return;
      }
      const el = hit(e.clientX, e.clientY);
      hover(el?.dataset.pdfSegment);
    };
    const endDrag = () => {
      dragging = false;
    };
    const selectionChanged = () => {
      cancel();
      if (selection()) hover();
    };
    const toolbarFocus = (e: FocusEvent) => {
      if ((e.target as Element).closest?.('.float-toolbar')) {
        cancel();
        hover();
      }
    };
    const leave = () => {
      hover();
    };
    const click = (e: MouseEvent) => {
      cancel();
      if (
        e.detail !== 1 ||
        !start ||
        start.selection ||
        Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5 ||
        selection()
      )
        return;
      const target = e.target as Element;
      if (
        e.defaultPrevented ||
        (target.closest('a,button,[role="button"],.float-toolbar,[data-annotation-id]') &&
          !target.closest('[data-pdf-translation-action]'))
      )
        return;
      const el = hit(e.clientX, e.clientY);
      const segment = page?.segments.find((p) => p.id === el?.dataset.pdfSegment);
      if (!segment) return;
      // Pointer movement after release is hover, not a drag of the completed click.
      start = null;
      timer = setTimeout(() => {
        if (!selection() && s.enabled) {
          s.openSegment(segment);
        }
      }, 400);
    };
    root.addEventListener('pointerdown', down, true);
    root.addEventListener('pointermove', move, true);
    root.addEventListener('click', click);
    root.addEventListener('dblclick', cancel);
    root.addEventListener('pointerleave', leave);
    document.addEventListener('selectionchange', selectionChanged);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
    document.addEventListener('focusin', toolbarFocus);
    return () => {
      cancel();
      root.removeEventListener('pointerdown', down, true);
      root.removeEventListener('pointermove', move, true);
      root.removeEventListener('click', click);
      root.removeEventListener('dblclick', cancel);
      root.removeEventListener('pointerleave', leave);
      document.removeEventListener('selectionchange', selectionChanged);
      document.removeEventListener('pointerup', endDrag);
      document.removeEventListener('pointercancel', endDrag);
      document.removeEventListener('focusin', toolbarFocus);
    };
  }, [s, pdf, page, s.enabled, capture.state.isMarqueeCaptureActive]);
  useEffect(() => {
    if (pdf.selectionText) {
      for (const node of ref.current?.querySelectorAll('.is-hover') ?? [])
        node.classList.remove('is-hover');
    }
  }, [pdf.selectionText]);
  if (!s.enabled || capture.state.isMarqueeCaptureActive) return null;
  if (!page || page.state === 'indexing' || !page.geometry || !size)
    return (
      <div className="pdf-translation-page-hint">
        {s.pageErrors[pageIndex] ??
          (page?.state === 'failed'
            ? (page.diagnostics[0] ?? '此页段落索引失败，可在文本层可用时选择文字翻译')
            : '正在建立段落索引…')}
        {s.pageErrors[pageIndex] && (
          <button type="button" onClick={() => s.retryPage(pageIndex)}>
            重试索引
          </button>
        )}
      </div>
    );
  if (page.state !== 'ready' || !page.segments.some((x) => x.qualityState === 'reliable'))
    return (
      <div className="pdf-translation-page-hint">
        {page.state === 'no_text'
          ? '此页没有可用文本层，暂不支持段落翻译'
          : '此页部分排版暂不支持段落识别，可选中文字翻译'}
      </div>
    );
  return (
    <div
      ref={ref}
      className={`pdf-translation-layer${pdf.selectionText ? ' is-selecting' : ''}`}
      aria-label="可查看中文的段落"
    >
      {page.segments
        .filter((p) => p.qualityState === 'reliable')
        .map((segment) => (
          <div key={segment.id}>
            {segment.rects.map((q, i) => {
              const bounds = quadBounds(q, page.geometry!, size, scale);
              return i === 0 ? (
                <Fragment key={i}>
                  <button
                    type="button"
                    data-pdf-segment={segment.id}
                    data-translation-focus={segment.id}
                    className={`pdf-translation-hit${s.target?.key === segment.id ? ' is-active' : ''}${segment.hasTranslation ? ' is-saved' : ''}`}
                    style={bounds}
                    aria-label={`查看第 ${pageIndex + 1} 页段落中文：${segment.sourceText.slice(0, 50)}`}
                    aria-expanded={s.target?.key === segment.id}
                    onClick={(e) => {
                      if (e.detail === 0) {
                        e.stopPropagation();
                        s.openSegment(segment);
                      }
                    }}
                    title="查看中文"
                  />
                  <button
                    type="button"
                    className="pdf-translation-action"
                    data-pdf-translation-action={segment.id}
                    style={{ left: bounds.left, top: bounds.top - 22 }}
                    tabIndex={-1}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    查看中文
                  </button>
                </Fragment>
              ) : (
                <span
                  key={i}
                  data-pdf-segment={segment.id}
                  className={`pdf-translation-hit${s.target?.key === segment.id ? ' is-active' : ''}`}
                  style={bounds}
                />
              );
            })}
          </div>
        ))}
    </div>
  );
});

/** Explicit selections keep a real anchor even with paragraph assistance switched off. */
export const PdfSelectionTranslationAnchor = observer(function PdfSelectionTranslationAnchor({
  documentId,
  pageIndex,
}: {
  documentId: string;
  pageIndex: number;
}) {
  const s = useService(PdfTranslationService);
  const state = useDocumentState(documentId);
  const target = s.target;
  const page = s.pages[pageIndex];
  const size = state?.document?.pages[pageIndex]?.size;
  if (!target || target.segmentId || target.pageIndex !== pageIndex || !page?.geometry || !size)
    return null;
  return (
    <div className="pdf-translation-layer" aria-hidden="true">
      {target.rects.map((q, i) => (
        <span
          key={i}
          data-pdf-segment={target.key}
          className="pdf-translation-hit is-active"
          style={quadBounds(q, page.geometry!, size, state?.scale ?? 1)}
        />
      ))}
    </div>
  );
});
