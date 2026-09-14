import { agentDocumentMetaLabel, type DocumentListItem } from '@inwit/dto';
import { Link } from 'react-router';
import { formatRelativeTime, summarizeAnswer } from '@/lib/format';
import { docPath } from '@/routes';

export function DocRow({
  doc,
  hanging,
}: {
  doc: DocumentListItem;
  hanging?: string | null;
}) {
  const agentLabel = agentDocumentMetaLabel(doc.source, doc.title);
  return (
    <Link to={docPath(doc.id)} className="doc-row">
      <h2>
        {doc.title}
        {doc.status === 'pending' ? (
          <span className="doc-digesting" aria-busy>
            消化中…
          </span>
        ) : null}
        {doc.status === 'failed' ? <span className="doc-failed">失败</span> : null}
      </h2>
      {doc.source === 'chat' && doc.answer ? (
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
