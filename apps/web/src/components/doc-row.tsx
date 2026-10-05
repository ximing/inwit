import {
  agentDocumentMetaLabel,
  BLANK_DOCUMENT_LABEL,
  docCardFace,
  docCardLabel,
  type DocumentListItem,
} from '@inwit/dto';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AiSpark } from '@/components/ai-flow';
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
  onPointerEnter,
  onFocus,
}: {
  doc: DocumentListItem;
  hanging?: string | null;
  onOpen?: (docId: string) => void;
  onPointerEnter?: () => void;
  onFocus?: () => void;
}) {
  const agentLabel = agentDocumentMetaLabel(doc.source, doc.title, doc.kind);
  const face = docCardFace(doc, 160);
  const hasChip = doc.status === 'pending' || doc.status === 'failed' || doc.proposedCount > 0;
  // 消化完成回落：pending → 非 pending 且非 failed 时卡数淡入一次（T28 目标 5）
  const prevStatusRef = useRef(doc.status);
  const [justDigested, setJustDigested] = useState(false);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev === 'pending' && doc.status !== 'pending' && doc.status !== 'failed') {
      setJustDigested(true);
    }
    prevStatusRef.current = doc.status;
  }, [doc.status]);
  const status = (
    <>
      {doc.status === 'pending' ? (
        <span className="doc-digesting" aria-busy>
          <AiSpark />
          <span className="shimmer-text">消化中</span>
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
        <span className={justDigested ? 'card-count' : undefined}>{doc.cardCount} 张卡</span>
        {' · '}
        {formatRelativeTime(doc.updatedAt)}
        {doc.topicTitle ? ` · ${doc.topicTitle}` : ''}
        {agentLabel ? ` · ${agentLabel}` : ''}
      </p>
      {hanging ? <p className="doc-hang">挂在：{hanging}</p> : null}
    </>
  );
  const className = `doc-row${face.title ? '' : ' is-untitled'}${doc.status === 'pending' ? ' is-digesting' : ''}`;
  const label = docCardLabel(face);
  if (onOpen) {
    return (
      <button
        type="button"
        className={className}
        aria-label={label}
        onClick={() => onOpen(doc.id)}
        onPointerEnter={onPointerEnter}
        onFocus={onFocus}
      >
        {body}
      </button>
    );
  }
  return (
    <Link
      to={docPath(doc.id)}
      className={className}
      aria-label={label}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
    >
      {body}
    </Link>
  );
}
