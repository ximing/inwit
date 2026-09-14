import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { CardWithQuestions } from '@inwit/dto';
import { QUESTION_TYPE_LABEL } from '@/lib/card-copy';
import { formatRelativeTime } from '@/lib/format';
import { AnchoredMarkdown, Markdown } from '@/lib/Markdown';
import { ROUTES, cardPath, editorPath } from '@/routes';
import { DocService } from './doc.service';

const DocPageContent = observer(function DocPageContent() {
  const service = useService(DocService);
  const { id } = useParams();
  const [params] = useSearchParams();
  const urlAnchor = params.get('anchor');

  useEffect(() => {
    if (id) void service.load(id, urlAnchor);
    return () => service.stopPolling();
  }, [id, urlAnchor, service]);

  useEffect(() => {
    if (!service.drawerOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.card-drawer')) return;
      if (target.closest('mark.anchor, .anchor-block')) return;
      service.closeDrawer();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') service.closeDrawer();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [service, service.drawerOpen]);

  const doc = service.doc;
  const anchors = useMemo(
    () =>
      (doc?.cards ?? [])
        .filter((card) => Boolean(card.anchorText))
        .map((card) => ({ cardId: card.id, text: card.anchorText as string })),
    [doc],
  );

  return (
    <section className={`page-doc${service.drawerOpen ? ' is-drawer-open' : ''}`}>
      <header className="doc-chrome">
        <div className="doc-chrome-lead">
          <Link to={ROUTES.home} className="btn-ghost">
            返回
          </Link>
          {doc ? <h1>{doc.title}</h1> : null}
        </div>
        {doc ? (
          <Link to={editorPath(doc.id)} className="btn-secondary">
            编辑
          </Link>
        ) : null}
      </header>

      {service.$model.load.loading && !doc ? <p className="empty">打开这张纸…</p> : null}

      {service.error ? (
        <p className="empty">
          {service.error} <Link to={ROUTES.home}>回文档列表</Link>
        </p>
      ) : null}

      {doc ? (
        <>
          <p className="meta doc-meta">
            {doc.topicTitle ? `${doc.topicTitle} · ` : ''}
            {formatRelativeTime(doc.updatedAt)} · {doc.cards.length} 张卡
            {doc.status === 'pending' ? ' · 消化中…' : ''}
            {doc.status === 'failed' ? ' · 失败' : ''}
          </p>
          <article className="paper paper-read">
            {doc.linkHint ? <aside className="doc-link-hint">{doc.linkHint}</aside> : null}
            {doc.source === 'chat' && doc.answer ? (
              <aside className="doc-answer">
                <p className="doc-answer-kicker">AI 回答</p>
                <Markdown source={doc.answer} />
              </aside>
            ) : null}
            {doc.contentMd.trim().length > 0 ? (
              <AnchoredMarkdown
                source={doc.contentMd}
                anchors={anchors}
                activeCardId={service.activeCardId}
                focusCardId={urlAnchor}
                onAnchorClick={(ids) => service.openAnchors(ids)}
              />
            ) : (
              <p className="empty">这张纸还是空的，写点什么吧</p>
            )}
          </article>
        </>
      ) : null}

      <CardDrawer
        open={service.drawerOpen}
        cards={service.openCards}
        active={service.activeCard}
        onSelect={(cardId) => service.selectCard(cardId)}
        onClose={() => service.closeDrawer()}
      />
    </section>
  );
});

function CardDrawer({
  open,
  cards,
  active,
  onSelect,
  onClose,
}: {
  open: boolean;
  cards: CardWithQuestions[];
  active: CardWithQuestions | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside
      className={`card-drawer${open ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-label="卡片"
      inert={!open || undefined}
    >
      <div className="card-drawer-head">
        <p className="doc-answer-kicker">这张卡</p>
        <button type="button" className="btn-ghost" onClick={onClose}>
          收起
        </button>
      </div>
      {cards.length > 1 ? (
        <ul className="card-drawer-switch">
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                className={card.id === active?.id ? 'is-on' : undefined}
                onClick={() => onSelect(card.id)}
              >
                {card.concept}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {active ? <DrawerCard card={active} /> : <p className="empty">点高亮的句子，卡片会滑出来。</p>}
    </aside>
  );
}

function DrawerCard({ card }: { card: CardWithQuestions }) {
  return (
    <article className="atom-card drawer-card">
      <h3>{card.concept}</h3>
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
        <ul className="drawer-questions">
          {card.questions.map((question) => (
            <li key={question.id}>
              <span className="k">{QUESTION_TYPE_LABEL[question.type]}</span>
              <p>{question.question}</p>
              <p className="hint">{question.answer}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <Link to={cardPath(card.id)} className="btn-secondary drawer-detail">
        查看详情
      </Link>
    </article>
  );
}

export const DocPage = bindServices(DocPageContent, [DocService]);
