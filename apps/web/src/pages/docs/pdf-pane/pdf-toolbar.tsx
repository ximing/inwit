import { useCapture } from '@embedpdf/plugin-capture/react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { useViewportCapability } from '@embedpdf/plugin-viewport/react';
import { ZoomMode, useZoom } from '@embedpdf/plugin-zoom/react';
import { useRotate } from '@embedpdf/plugin-rotate/react';
import { observer, useService } from '@rabjs/react';
import { Crop, Minus, PanelLeft, Plus, RotateCw, Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Tip } from '@/components/tip';
import { PdfPaneService } from '../pdf-pane.service';
import {
  PDF_ZOOM_PRESETS,
  formatZoomPercent,
  matchingZoomPresetId,
  parsePageInput,
  type PdfZoomPreset,
} from './chrome-logic.js';

export const PdfToolbar = observer(function PdfToolbar({ documentId }: { documentId: string }) {
  const pdf = useService(PdfPaneService);
  const scroll = useScroll(documentId);
  const zoom = useZoom(documentId);
  const capture = useCapture(documentId);
  const rotate = useRotate(documentId);
  const capturing = capture.state.isMarqueeCaptureActive;
  const page = scroll.state.currentPage;
  const total = scroll.state.totalPages;
  const level = zoom.state.currentZoomLevel;
  const viewportCap = useViewportCapability();
  const pageValue = pdf.pageDraft ?? (total > 0 ? String(page) : '');
  const activePreset = matchingZoomPresetId(zoom.state.zoomLevel);
  const didInitZoom = useRef(false);

  // Zoom plugin gates the viewport on document load and only ungates after a
  // successful requestZoom. FitWidth often runs while metrics are still 0, so
  // the gate never lifts and the page stays blank. Release it once we mount.
  useEffect(() => {
    const vp = viewportCap.provides;
    const api = zoom.provides;
    if (!vp || !api) return;
    if (vp.hasGate('zoom', documentId)) {
      vp.releaseGate('zoom', documentId);
    }
    if (didInitZoom.current) return;
    didInitZoom.current = true;
    api.requestZoom(ZoomMode.FitWidth);
  }, [viewportCap.provides, zoom.provides, documentId]);

  useEffect(() => {
    if (!pdf.zoomMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.pdf-zoom')) return;
      pdf.closeZoomMenu();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [pdf, pdf.zoomMenuOpen]);

  const applyPreset = (preset: PdfZoomPreset) => {
    if (preset.level === 'fit-width') zoom.provides?.requestZoom(ZoomMode.FitWidth);
    else if (preset.level === 'fit-page') zoom.provides?.requestZoom(ZoomMode.FitPage);
    else zoom.provides?.requestZoom(preset.level);
    pdf.closeZoomMenu();
  };

  const commitPage = (event?: { preventDefault(): void }) => {
    event?.preventDefault();
    if (pdf.pageDraft == null) return;
    const next = parsePageInput(pdf.pageDraft, total);
    pdf.endPageEdit();
    if (next) {
      scroll.provides?.scrollToPage({ pageNumber: next, behavior: 'smooth' });
    }
  };

  return (
    <div className="pdf-toolbar" role="toolbar" aria-label="阅读工具">
      <Tip content={pdf.thumbsOpen ? '收起缩略图' : '展开缩略图'}>
        <button
          type="button"
          className={`pdf-tool${pdf.thumbsOpen ? ' is-on' : ''}`}
          aria-pressed={pdf.thumbsOpen}
          aria-label={pdf.thumbsOpen ? '收起缩略图' : '展开缩略图'}
          onClick={() => pdf.toggleThumbs()}
        >
          <PanelLeft width={15} height={15} strokeWidth={2} />
        </button>
      </Tip>
      <form className="pdf-page-form" onSubmit={commitPage}>
        <input
          className="pdf-page-input"
          aria-label="页码"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={total <= 0}
          value={pageValue}
          onFocus={() => pdf.beginPageEdit(page || 1)}
          onChange={(event) => pdf.setPageDraft(event.target.value)}
          onBlur={() => commitPage()}
        />
        <span className="pdf-page-total">{total > 0 ? `/ ${total}` : '/ —'}</span>
      </form>
      <span className="pdf-tool-sep" />
      <Tip content="缩小">
        <button
          type="button"
          className="pdf-tool"
          aria-label="缩小"
          disabled={!zoom.provides}
          onClick={() => zoom.provides?.zoomOut()}
        >
          <Minus width={15} height={15} strokeWidth={2} />
        </button>
      </Tip>
      <div className="pdf-zoom">
        <Tip content="缩放">
          <button
            type="button"
            className={`pdf-tool is-label${pdf.zoomMenuOpen ? ' is-on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={pdf.zoomMenuOpen}
            aria-label="缩放"
            disabled={!zoom.provides}
            onClick={() => pdf.toggleZoomMenu()}
          >
            {formatZoomPercent(level || 1)}
          </button>
        </Tip>
        {pdf.zoomMenuOpen ? (
          <div className="pdf-zoom-menu" role="menu">
            {PDF_ZOOM_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="menuitem"
                className={activePreset === preset.id ? 'is-on' : undefined}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Tip content="放大">
        <button
          type="button"
          className="pdf-tool"
          aria-label="放大"
          disabled={!zoom.provides}
          onClick={() => zoom.provides?.zoomIn()}
        >
          <Plus width={15} height={15} strokeWidth={2} />
        </button>
      </Tip>
      <span className="pdf-tool-sep" />
      <Tip content="顺时针旋转">
        <button
          type="button"
          className="pdf-tool"
          aria-label="顺时针旋转"
          disabled={!rotate.provides}
          onClick={() => rotate.provides?.rotateForward()}
        >
          <RotateCw width={15} height={15} strokeWidth={2} />
        </button>
      </Tip>
      <Tip content="在文档中查找">
        <button
          type="button"
          className={`pdf-tool${pdf.searchOpen ? ' is-on' : ''}`}
          aria-pressed={pdf.searchOpen}
          aria-label="在文档中查找"
          onClick={() => pdf.toggleSearch()}
        >
          <Search width={15} height={15} strokeWidth={2} />
        </button>
      </Tip>
      <Tip content={capturing ? '取消框选' : '框选摘录'}>
        <button
          type="button"
          className={`pdf-tool${capturing ? ' is-on' : ''}`}
          aria-pressed={capturing}
          aria-label={capturing ? '取消框选' : '框选摘录'}
          disabled={!capture.provides}
          onClick={() => capture.provides?.toggleMarqueeCapture()}
        >
          <Crop width={15} height={15} strokeWidth={2} />
          {capturing ? '取消框选' : '框选摘录'}
        </button>
      </Tip>
      {pdf.ocrPending ? <span className="pdf-toolbar-hint">识别中，可先用框选摘录</span> : null}
    </div>
  );
});
