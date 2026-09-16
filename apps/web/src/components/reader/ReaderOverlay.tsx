/**
 * 阅读弹层。组件只 `useService(ReaderService)`，不 `bindServices`。
 * 必须由宿主页面 bindServices 提供同一实例，才能与页面内 openDoc/openCard 共享状态。
 */
import {
  agentDocumentMetaLabel,
  docDisplayTitle,
  type CardLinkType,
  type CardLinkWithCard,
  type CardLinksResponse,
  type DocumentDetail,
} from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { Loader2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { DocView } from '@/components/doc/DocView';
import { Tag } from '@/components/tag';
import { scrollFlashCardAnchor } from '@/lib/anchor-scroll';
import { docAnchors, type AnchorSpec } from '@/lib/anchors';
import { formatRelativeTime } from '@/lib/format';
import { ROUTES, docAnchorPath, docPath } from '@/routes';
import {
  ClozeText,
  MiniCard,
  MasteryDots,
  cardMasteryLevel,
  cardNextReviewLabel,
} from './mini-card';
import { ReaderService } from './reader.service';

const LINK_ORDER: CardLinkType[] = [
  'confusable',
  'prerequisite',
  'related',
  'same_concept',
];

const LINK_META: Record<CardLinkType, { label: string; mark: string; rel: string }> = {
  confusable: { label: '易混淆', mark: '⚡', rel: 'conf' },
  prerequisite: { label: '前置', mark: '↳', rel: 'pre' },
  related: { label: '相关', mark: '∿', rel: 'rel' },
  same_concept: { label: '同概念', mark: '＝', rel: 'same' },
};

function groupedLinks(
  links: CardLinksResponse,
): { type: CardLinkType; items: CardLinkWithCard[] }[] {
  const seen = new Set<string>();
  const byType: Record<CardLinkType, CardLinkWithCard[]> = {
    confusable: [],
    prerequisite: [],
    related: [],
    same_concept: [],
  };
  for (const item of [...links.outgoing, ...links.incoming]) {
    const key = `${item.type}:${item.card.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byType[item.type].push(item);
  }
  return LINK_ORDER.filter((type) => (byType[type]?.length ?? 0) > 0).map((type) => ({
    type,
    items: byType[type] ?? [],
  }));
}

function docKindTag(
  doc: DocumentDetail,
): { tone: 'ai' | 'busy'; label: string } | null {
  if (doc.status === 'pending') return { tone: 'busy', label: '消化中' };
  const agent = agentDocumentMetaLabel(doc.source, doc.title);
  if (agent) return { tone: 'ai', label: agent };
  if (doc.source === 'chat') return { tone: 'ai', label: 'AI 回答' };
  return null;
}

export const ReaderOverlay = observer(function ReaderOverlay() {
  const service = useService(ReaderService);
  const scrollRef = useRef<HTMLDivElement>(null);
  const open = service.isOpen;
  const doc = service.doc;
  const cardMode = service.activeCardId !== null;
  const badge = doc ? docKindTag(doc) : null;
  const fullPageTo =
    doc && service.activeCardId
      ? docAnchorPath(doc.id, service.activeCardId)
      : doc
        ? docPath(doc.id)
        : null;

  const anchors = useMemo(
    () => (doc ? docAnchors(doc.cards, []) : []),
    [doc],
  );

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      service.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, service]);

  useLayoutEffect(() => {
    if (!service.pendingScrollTop) return;
    scrollRef.current?.scrollTo({ top: 0 });
    service.clearPendingScrollTop();
  }, [service, service.pendingScrollTop, doc]);

  // 消费 focusCardId 走共享滚动闪烁，避免传给 DocView 后同一张卡无法再次闪（flashedRef）。
  useEffect(() => {
    const cardId = service.focusCardId;
    if (!cardId) return;
    scrollFlashCardAnchor(scrollRef.current, cardId);
    service.clearFocus();
  }, [service, service.focusCardId, doc]);

  if (!open) return null;

  return createPortal(
    <div className="reader-overlay-root">
      <div
        className="reader-overlay-mask"
        aria-hidden
        onClick={() => service.close()}
      />
      <div
        className="reader-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="阅读"
      >
        <header className="reader-overlay-head">
          <span className="reader-overlay-kicker">阅读</span>
          {doc ? (
            <>
              <h2 className="reader-overlay-title">{docDisplayTitle(doc)}</h2>
              {badge ? <Tag tone={badge.tone}>{badge.label}</Tag> : null}
              <span className="reader-overlay-meta">
                {doc.cards.length} 张卡
                <span className="sep">·</span>
                {formatRelativeTime(doc.updatedAt)}
                {doc.topicTitle ? (
                  <>
                    <span className="sep">·</span>
                    挂在：{doc.topicTitle}
                  </>
                ) : null}
              </span>
            </>
          ) : (
            <h2 className="reader-overlay-title">{service.error ? '无法打开' : '正在打开…'}</h2>
          )}
          <span className="reader-overlay-spacer" />
          {fullPageTo ? (
            <Link className="btn btn-ghost" to={fullPageTo}>
              打开完整页面 ↗
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost reader-overlay-close"
            aria-label="关闭"
            onClick={() => service.close()}
          >
            <X width={16} height={16} strokeWidth={1.8} />
          </button>
        </header>

        <div className="reader-overlay-main">
          <div className="reader-overlay-scroll" ref={scrollRef}>
            {service.loading && !doc ? (
              <p className="empty">
                <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                正在打开…
              </p>
            ) : null}
            {service.error && !doc ? <p className="empty">{service.error}</p> : null}
            {doc ? <ReaderDocBody doc={doc} anchors={anchors} /> : null}
          </div>
          {doc ? (
            <aside className="reader-overlay-rail" aria-label={cardMode ? '卡片详情' : '本文卡片'}>
              {cardMode ? <ReaderCardDetail /> : <ReaderCardList doc={doc} />}
            </aside>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
});

const ReaderDocBody = observer(function ReaderDocBody({
  doc,
  anchors,
}: {
  doc: DocumentDetail;
  anchors: AnchorSpec[];
}) {
  const service = useService(ReaderService);
  const chatAnswer = doc.source === 'chat' ? (doc.answer?.trim() ?? '') : '';
  const description = chatAnswer ? '' : (doc.description?.trim() ?? '');
  const contentMd = doc.contentMd.trim();
  // chat 文档的锚点在 answer 里；contentMd 常常只剩一行标题，避免盖住回答。
  const showContentMd = contentMd.length > 0 && (!chatAnswer || contentMd.length > 80);
  const onAnchorClick = (ids: string[]) => {
    const id = ids[0];
    if (id) void service.openCard(id, doc.id);
  };

  if (!chatAnswer && !description && !showContentMd) {
    return <p className="empty">这篇还没有正文。</p>;
  }

  return (
    <>
      {chatAnswer ? (
        <DocView
          source={chatAnswer}
          anchors={anchors}
          activeCardId={service.activeCardId}
          className="reader-overlay-prose"
          onAnchorClick={onAnchorClick}
        />
      ) : null}
      {description ? (
        <aside className="reader-overlay-summary">
          <p className="reader-overlay-summary-k">AI 摘要</p>
          <DocView source={description} />
        </aside>
      ) : null}
      {showContentMd ? (
        <DocView
          source={contentMd}
          anchors={anchors}
          activeCardId={service.activeCardId}
          className="reader-overlay-prose"
          onAnchorClick={onAnchorClick}
        />
      ) : null}
    </>
  );
});

const ReaderCardList = observer(function ReaderCardList({ doc }: { doc: DocumentDetail }) {
  const service = useService(ReaderService);
  const pending = doc.status === 'pending';
  return (
    <>
      <div className="reader-overlay-rail-head">本文卡片 · {doc.cards.length}</div>
      {doc.cards.length === 0 ? (
        <p className="hint">
          {pending ? '处理完成后卡片会出现在这里。' : '这篇还没有卡片。'}
        </p>
      ) : (
        <div className="mini-grid">
          {doc.cards.map((card) => (
            <MiniCard
              key={card.id}
              card={card}
              open={false}
              active={false}
              onClick={() => void service.openCard(card.id, doc.id)}
            />
          ))}
        </div>
      )}
    </>
  );
});

const ReaderCardDetail = observer(function ReaderCardDetail() {
  const service = useService(ReaderService);
  const card = service.activeCard;
  const groups = service.links ? groupedLinks(service.links) : [];
  const question = card ? (card.questions[0]?.question ?? card.concept) : '';
  const answer = card ? (card.questions[0]?.answer ?? card.example) : '';

  return (
    <>
      <div className="reader-overlay-rail-head">
        <button
          type="button"
          className="reader-overlay-back"
          onClick={() => service.backToList()}
        >
          ← 卡片列表
        </button>
      </div>
      {service.error ? <p className="hint">{service.error}</p> : null}
      {card ? (
        <div className="reader-overlay-qa">
          <p className="reader-overlay-k">问</p>
          <p className="reader-overlay-q">
            <ClozeText text={question} />
          </p>
          {answer ? (
            <>
              <p className="reader-overlay-k">答</p>
              <p className="reader-overlay-a">{answer}</p>
            </>
          ) : null}
          <div className="reader-overlay-card-meta">
            <MasteryDots level={cardMasteryLevel(card)} />
            <span>{cardNextReviewLabel(card)}</span>
            {card.tags.map((tag) => (
              <span key={tag} className="reader-overlay-tag">
                {tag}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="hint">找不到这张卡。</p>
      )}

      <p className="reader-overlay-sub">脉络 · 来自知识关联</p>
      {service.links === null ? (
        <p className="hint">脉络加载中…</p>
      ) : groups.length === 0 ? (
        <p className="hint">还没有关联卡片。</p>
      ) : (
        groups.map((group) => (
          <div key={group.type} className="reader-overlay-link-group">
            {group.items.map((item) => {
              const meta = LINK_META[item.type];
              const cross = item.card.documentId !== service.doc?.id;
              const reason = item.reason?.trim() ?? '';
              const agentMark = item.origin === 'agent';
              return (
                <button
                  key={item.id}
                  type="button"
                  className="reader-overlay-link"
                  onClick={() => void service.openLinkedCard(item.card.id)}
                >
                  <span className="reader-overlay-link-top">
                    <span className={`reader-overlay-rel is-${meta.rel}`}>
                      {meta.mark} {meta.label}
                    </span>
                    {cross ? <span className="reader-overlay-ext">跨文档</span> : null}
                  </span>
                  <b>{item.card.concept}</b>
                  {reason || agentMark ? (
                    <span className="reader-overlay-link-reason">
                      {reason}
                      {agentMark ? `${reason ? ' — ' : ''}AI 标注` : ''}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))
      )}

      <div className="reader-overlay-foot">
        <Link className="btn btn-primary" to={ROUTES.review}>
          去复习
        </Link>
      </div>
    </>
  );
});
