import {
  AGENT_DOC_LABEL_REPORT,
  agentDocumentMetaLabel,
  docDisplayTitle,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Tag } from '@/components/tag';
import { formatRelativeTime } from '@/lib/format';
import { DocsService } from './docs.service';
import { PdfPaneService } from './pdf-pane.service';
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

  const isReport = agentDocumentMetaLabel(doc.source, doc.title) === AGENT_DOC_LABEL_REPORT;
  const stage = docs.stageFor(doc);

  return (
    <div className="pdf-pane">
      <div className="pdf-pane-head">
        <h1 className="pane-title">
          {docDisplayTitle(doc)}
          {isReport ? <Tag tone="ai">AI 复盘</Tag> : null}
        </h1>
        <div className="pane-meta">
          <span>{formatRelativeTime(doc.updatedAt)}</span>
          <span className="sep">·</span>
          <span>{doc.cards.length} 张卡</span>
          {stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label ? (
            <>
              <span className="sep">·</span>
              <span>{stage.label}</span>
            </>
          ) : null}
          {doc.status === 'failed' ? (
            <>
              <span className="sep">·</span>
              <span>失败</span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={docs.retryingId === doc.id}
                onClick={() => void docs.retryFailed(doc.id)}
              >
                {docs.retryingId === doc.id ? '重试中…' : '重试'}
              </button>
            </>
          ) : null}
        </div>
      </div>
      {pdf.fileError ? (
        <p className="empty">{pdf.fileError}</p>
      ) : pdf.$model.loadFile.loading && !pdf.fileUrl ? (
        <p className="empty">
          <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
          正在打开…
        </p>
      ) : pdf.fileUrl ? (
        <PdfViewer documentId={doc.id} fileUrl={pdf.fileUrl} />
      ) : (
        <p className="empty">正在打开…</p>
      )}
    </div>
  );
});

export const PdfPane = bindServices(PdfPaneView, [PdfPaneService]);
export default PdfPane;
