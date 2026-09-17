import { IMAGE_EXCERPT_QUOTE, type DocumentCard } from '@inwit/dto';
import { Fragment, type ReactNode } from 'react';
import { parseCloze } from '@/lib/cloze';
import { formatNextReview, masteryLevel } from '@/lib/format';

export function ClozeText({ text }: { text: string }) {
  return (
    <>
      {parseCloze(text).map((part, index) =>
        part.type === 'cloze' ? (
          <span key={index} className="cloze">
            {part.value}
          </span>
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        ),
      )}
    </>
  );
}

export function MasteryDots({ level }: { level: number }) {
  return (
    <span className="mastery" aria-hidden>
      {[0, 1, 2, 3].map((slot) => (
        <i key={slot} className={slot < level ? 'on' : undefined} />
      ))}
    </span>
  );
}

export function cardMasteryLevel(card: DocumentCard): number {
  return card.review ? masteryLevel(card.review.intervalDays) : 0;
}

export function cardNextReviewLabel(card: DocumentCard): string {
  if (!card.review) return '还没进复习队列';
  if (card.review.suspendedAt != null) return '已熟悉，不复习';
  return formatNextReview(card.review.dueAt);
}

export function MiniCard({
  card,
  open,
  active,
  lost,
  onClick,
  thumb,
}: {
  card: DocumentCard;
  open: boolean;
  active: boolean;
  lost?: boolean;
  onClick: () => void;
  thumb?: ReactNode;
}) {
  const question = card.questions[0]?.question ?? card.concept;
  const answer = card.questions[0]?.answer ?? card.example;
  return (
    <button
      type="button"
      data-card-id={card.id}
      className={`mini-card${open ? ' is-open' : ''}${active ? ' is-on' : ''}${lost ? ' is-lost' : ''}`}
      title={lost ? '原文已删除' : undefined}
      onClick={onClick}
    >
      {thumb}
      {question.trim() !== IMAGE_EXCERPT_QUOTE ? (
        <div className="mini-q">
          <ClozeText text={question} />
        </div>
      ) : null}
      {open && answer ? <div className="mini-a">{answer}</div> : null}
      <div className="mini-foot">
        <MasteryDots level={cardMasteryLevel(card)} />
        <span>{cardNextReviewLabel(card)}</span>
        {card.source === 'manual' ? <span className="hand-tag">手写</span> : null}
        {card.review?.suspendedAt != null ? <span className="hand-tag">已熟悉</span> : null}
        {lost ? <span className="anchor-lost">原文已删除</span> : null}
      </div>
    </button>
  );
}
