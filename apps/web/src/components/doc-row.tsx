import {
  agentDocumentMetaLabel,
  BLANK_DOCUMENT_LABEL,
  docCardFace,
  docCardLabel,
  type DocumentListItem,
} from '@inwit/dto';
import { Link } from 'react-router';
import { formatRelativeTime } from '@/lib/format';
import { docPath } from '@/routes';

export function DocRowSummary({
  doc,
}: {
  doc: {
    title?: string | null;
    description?: string | null;
    answer?: string | null;
    contentJson?: unknown;
  };
}) {
  const face = docCardFace(doc, 120);
  if (face.preview) {
    return <div className={`row-desc${face.title ? '' : ' is-lead'}`}>{face.preview}</div>;
  }
  if (!face.title) return <div className="row-desc is-blank">{BLANK_DOCUMENT_LABEL}</div>;
  return null;
}

export function DocRow({
  doc,
  hanging,
  onOpen,
}: {
  doc: DocumentListItem;
  hanging?: string | null;
  onOpen?: (docId: string) => void;
}) {
  const agentLabel = agentDocumentMetaLabel(doc.source, doc.title, doc.kind);
  const face = docCardFace(doc, 160);
  const hasChip = doc.status === 'pending' || doc.status === 'failed' || doc.proposedCount > 0;
  const status = (
    <>
      {doc.status === 'pending' ? (
        <span className="doc-digesting" aria-busy>
          消化中…
        </span>
      ) : null}
      {doc.status === 'failed' ? <span className="doc-failed">失败</span> : null}
      {doc.proposedCount > 0 ? (
        <span className="doc-proposed">待确认 {doc.proposedCount}</span>
      ) : null}
    </>
  );
  const body = (
    <>
      {face.title ? (
        <h2>
          {face.title}
          {status}
        </h2>
      ) : hasChip ? (
        <h2 className="doc-row-chips">{status}</h2>
      ) : null}
      {face.preview ? (
        <p className={face.title ? 'doc-excerpt' : 'doc-snippet'}>{face.preview}</p>
      ) : !face.title ? (
        <p className="doc-snippet is-blank">{BLANK_DOCUMENT_LABEL}</p>
      ) : null}
      <p className="meta">
        {doc.cardCount} 张卡 · {formatRelativeTime(doc.updatedAt)}
        {doc.topicTitle ? ` · ${doc.topicTitle}` : ''}
        {agentLabel ? ` · ${agentLabel}` : ''}
      </p>
      {hanging ? <p className="doc-hang">挂在：{hanging}</p> : null}
    </>
  );
  const className = `doc-row${face.title ? '' : ' is-untitled'}`;
  const label = docCardLabel(face);
  if (onOpen) {
    return (
      <button type="button" className={className} aria-label={label} onClick={() => onOpen(doc.id)}>
        {body}
      </button>
    );
  }
  return (
    <Link to={docPath(doc.id)} className={className} aria-label={label}>
      {body}
    </Link>
  );
}
