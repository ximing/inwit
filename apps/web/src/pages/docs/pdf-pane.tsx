import {
  AGENT_DOC_LABEL_REPORT,
  agentDocumentMetaLabel,
  docDisplayTitle,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Tag } from '@/components/tag';
import { DocsService } from './docs.service';
import { PdfPaneService } from './pdf-pane.service';
import { PdfLoading } from './pdf-pane/pdf-loading';
import { PdfViewer } from './pdf-pane/pdf-viewer';

const PdfPaneView = observer(function PdfPaneView() {
  const docs = useService(DocsService);
  const pdf = useService(PdfPaneService);
  const doc = docs.doc;

  useEffect(() => {
    if (!doc) return;
    pdf.resetJumpTracking();
    pdf.resetChrome();
    void pdf.loadFile(doc.id);
    return () => {
      pdf.resetJumpTracking();
      pdf.resetChrome();
    };
  }, [doc?.id, pdf]);

  if (!doc) return null;

  const isReport = agentDocumentMetaLabel(doc.source, doc.title, doc.kind) === AGENT_DOC_LABEL_REPORT;
  const stage = docs.stageFor(doc);
  const stageLabel =
    stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label ? stage.label : null;
  const showMeta = stageLabel || doc.status === 'failed' || stage.canRetry;

  return (
    <div className="pdf-pane">
      <div className="pdf-pane-head">
        <h1 className="pane-title">
          {docDisplayTitle(doc)}
          {isReport ? <Tag tone="ai">AI 复盘</Tag> : null}
        </h1>
        {showMeta ? (
          <div className="pane-meta">
            {stageLabel ? <span>{stageLabel}</span> : null}
            {doc.status === 'failed' ? (
              <>
                {stageLabel ? <span className="sep">·</span> : null}
                <span>失败</span>
              </>
            ) : null}
            {stage.canRetry ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={docs.retryingId === doc.id}
                onClick={() => void docs.retryFailed(doc.id)}
              >
                {docs.retryingId === doc.id ? '重试中…' : '重试'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {pdf.fileError ? (
        <p className="empty">{pdf.fileError}</p>
      ) : pdf.fileUrl ? (
        <PdfViewer documentId={doc.id} fileUrl={pdf.fileUrl} />
      ) : (
        <PdfLoading
          stage={pdf.fileLoaded != null ? 'download' : 'open'}
          loaded={pdf.fileLoaded}
          total={pdf.fileTotal}
        />
      )}
    </div>
  );
});

export const PdfPane = bindServices(PdfPaneView, [PdfPaneService]);
export default PdfPane;
