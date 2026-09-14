import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import type { CardDetail } from '@inwit/dto';
import { QUESTION_TYPE_LABEL, type RelatedGroup, type RelatedLink } from '@/lib/card-copy';
import { formatDueAt, formatIntervalDays } from '@/lib/format';
import { ROUTES, cardPath, docAnchorPath, docPath } from '@/routes';
import { CardPageService } from './card.service';

const CardPageContent = observer(function CardPageContent() {
  const service = useService(CardPageService);
  const { id } = useParams();

  useEffect(() => {
    if (id) void service.load(id);
  }, [id, service]);

  const card = service.card;

  return (
    <section className="page-card">
      <header className="doc-chrome">
        <div className="doc-chrome-lead">
          <Link to={card?.documentId ? docPath(card.documentId) : ROUTES.home} className="btn-ghost">
            返回
          </Link>
        </div>
      </header>

      {service.$model.load.loading && !card ? <p className="empty">打开这张卡…</p> : null}

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error} <Link to={ROUTES.home}>回文档列表</Link>
        </p>
      ) : null}

      {card ? (
        <>
          <CardBody card={card} />
          {card.documentId && card.documentTitle ? (
            <Link to={docAnchorPath(card.documentId, card.id)} className="source-bar">
              <p className="source-kicker">出处</p>
              <p className="source-title">来自《{card.documentTitle}》</p>
              {card.anchorText ? <blockquote className="source-quote">{card.anchorText}</blockquote> : null}
            </Link>
          ) : null}
          <RelatedSection
            groups={service.groups}
            deletingId={service.deletingId}
            onDelete={(linkId) => void service.removeLink(linkId)}
          />
          {card.review ? (
            <p className="card-review-meta">
              下次复习 {formatDueAt(card.review.dueAt)} · {formatIntervalDays(card.review.intervalDays)}
            </p>
          ) : (
            <p className="card-review-meta">还没进复习队列</p>
          )}
        </>
      ) : null}
    </section>
  );
});

function CardBody({ card }: { card: CardDetail }) {
  return (
    <article className="atom-card card-detail-body">
      <h2>{card.concept}</h2>
      {card.example ? (
        <p>
          <span className="k">例子</span>
          {card.example}
        </p>
      ) : null}
      {card.confusionPoint ? (
        <p>
          <span className="k">易混</span>
          {card.confusionPoint}
        </p>
      ) : null}
      {card.tags.length > 0 ? (
        <ul className="tag-row">
          {card.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}
      {card.questions.length > 0 ? (
        <ul className="q-list">
          {card.questions.map((question) => (
            <li key={question.id}>
              <details className="q-fold">
                <summary>
                  <span className="k">{QUESTION_TYPE_LABEL[question.type]}</span>
                  {question.question}
                </summary>
                <p className="q-answer">{question.answer}</p>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function RelatedSection({
  groups,
  deletingId,
  onDelete,
}: {
  groups: RelatedGroup[];
  deletingId: string | null;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="related-block">
      <h2>相关卡片</h2>
      {groups.length === 0 ? <p className="lede">还没有关联。消化的时候会顺手连上。</p> : null}
      {groups.map((group) => (
        <div key={group.type} className="related-group">
          <h3>{group.label}</h3>
          <ul className="related-row">
            {group.items.map((item) => (
              <li key={item.id}>
                <RelatedCard
                  item={item}
                  busy={deletingId === item.id}
                  onDelete={() => onDelete(item.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function RelatedCard({
  item,
  busy,
  onDelete,
}: {
  item: RelatedLink;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <article className="related-card">
      <Link to={cardPath(item.card.id)} className="related-card-link">
        <h4>{item.card.concept}</h4>
        {item.card.tags.length > 0 ? (
          <ul className="tag-row">
            {item.card.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        ) : null}
      </Link>
      {item.origin === 'agent' && item.reason ? <p className="related-reason">{item.reason}</p> : null}
      <button type="button" className="btn-danger related-del" disabled={busy} onClick={onDelete}>
        {busy ? '删除中…' : '删除'}
      </button>
    </article>
  );
}

export const CardPage = bindServices(CardPageContent, [CardPageService]);
