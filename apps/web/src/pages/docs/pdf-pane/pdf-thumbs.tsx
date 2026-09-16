import { useScroll } from '@embedpdf/plugin-scroll/react';
import { ThumbImg, ThumbnailsPane, type ThumbMeta } from '@embedpdf/plugin-thumbnail/react';
import { observer } from '@rabjs/react';
import { PDF_THUMBS_WIDTH_PX } from './chrome-logic.js';

export const PdfThumbs = observer(function PdfThumbs({ documentId }: { documentId: string }) {
  const scroll = useScroll(documentId);
  const current = scroll.state.currentPage;

  return (
    <aside className="pdf-thumbs" aria-label="页面缩略图" style={{ width: PDF_THUMBS_WIDTH_PX }}>
      <ThumbnailsPane documentId={documentId} className="pdf-thumbs-pane">
        {(meta: ThumbMeta) => {
          const pageNumber = meta.pageIndex + 1;
          const on = pageNumber === current;
          return (
            <button
              key={meta.pageIndex}
              type="button"
              className={on ? 'pdf-thumb is-current' : 'pdf-thumb'}
              aria-current={on ? 'page' : undefined}
              aria-label={`第 ${pageNumber} 页`}
              style={{
                position: 'absolute',
                top: meta.top,
                height: meta.wrapperHeight,
                width: '100%',
              }}
              onClick={() =>
                scroll.provides?.scrollToPage({ pageNumber, behavior: 'smooth' })
              }
            >
              <span className="pdf-thumb-frame" style={{ width: meta.width, height: meta.height }}>
                <ThumbImg documentId={documentId} meta={meta} className="pdf-thumb-img" />
              </span>
              <span className="pdf-thumb-label">{pageNumber}</span>
            </button>
          );
        }}
      </ThumbnailsPane>
    </aside>
  );
});
