import { agentDocumentMetaLabel, docDisplayTitle, type DocumentListItem } from '@inwit/dto';
import { Link } from 'react-router';
import { formatRelativeTime, summarizeAnswer } from '@/lib/format';
import { docPath } from '@/routes';

export function docSummaryLine(doc: {
  title?: string | null;
  description?: string | null;
}): string | null {
  if (!(doc.title?.trim())) return null;
  const text = doc.description?.trim() ?? '';
  return text.length > 0 ? text : null;
}

export function DocRowSummary({
  doc,
}: {
  doc: { title?: string | null; description?: string | null };
}) {
  const text = docSummaryLine(doc);
  if (!text) return null;
  return <div className="row-desc">{text}</div>;
}

export function DocRow({
  doc,
  hanging,
}: {
  doc: DocumentListItem;
  hanging?: string | null;
}) {
  const agentLabel = agentDocumentMetaLabel(doc.source, doc.title);
  const summary = docSummaryLine(doc);
  return (
    <Link to={docPath(doc.id)} className="doc-row">
      <h2>
        {docDisplayTitle(doc)}
        {doc.status === 'pending' ? (
          <span className="doc-digesting" aria-busy>
            消化中…
          </span>
        ) : null}
        {doc.status === 'failed' ? <span className="doc-failed">失败</span> : null}
      </h2>
      {summary ? (
        <p className="doc-excerpt">{summary}</p>
      ) : doc.source === 'chat' && doc.answer ? (
        <p className="doc-excerpt">{summarizeAnswer(doc.answer)}</p>
      ) : null}
      <p className="meta">
        {doc.cardCount} 张卡 · {formatRelativeTime(doc.updatedAt)}
        {doc.topicTitle ? ` · ${doc.topicTitle}` : ''}
        {agentLabel ? ` · ${agentLabel}` : ''}
      </p>
      {hanging ? <p className="doc-hang">挂在：{hanging}</p> : null}
    </Link>
  );
}
