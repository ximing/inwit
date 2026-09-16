import { IMAGE_EXCERPT_QUOTE, type Annotation, type DocumentCard } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import {
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  SquarePlus,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PresignedThumb, usePresignedImage } from '@/components/presigned-thumb';
import { parseCloze } from '@/lib/cloze';
import { formatNextReview, masteryLevel } from '@/lib/format';
import { ROUTES } from '@/routes';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { DocsService } from './docs.service';

function ClozeText({ text }: { text: string }) {
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

const AnnotationThumb = observer(function AnnotationThumb({
  annotationId,
}: {
  annotationId: string;
}) {
  const service = useService(DocsService);
  const url = service.annotationImageUrl(annotationId);
  usePresignedImage(annotationId, url, (id) => void service.loadAnnotationImage(id));
  return (
    <PresignedThumb
      url={url}
      className="note-thumb"
      onError={() => service.retryAnnotationImage(annotationId)}
    />
  );
});

const AnnotationItem = observer(function AnnotationItem({ item }: { item: Annotation }) {
  const service = useService(DocsService);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.note);
  const [saving, setSaving] = useState(false);
  const on = service.activeAnnotationId === item.id;

  useEffect(() => {
    if (!editing) setDraft(item.note);
  }, [item.note, editing]);

  const save = async () => {
    setSaving(true);
    const ok = await service.saveAnnotationNote(item.id, draft);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <div
      data-annotation-id={item.id}
      className={`note-item${on ? ' is-on' : ''}${editing ? ' is-editing' : ''}`}
    >
      <button
        type="button"
        className="note-item-main"
        onClick={() => service.focusAnnotation(item.id)}
      >
        {item.kind === 'pdf' && item.imageKey ? <AnnotationThumb annotationId={item.id} /> : null}
        <p className="note-quote">{item.quote}</p>
        {!editing && item.note.trim() ? <p className="note-body">{item.note}</p> : null}
      </button>
      {editing ? (
        <div className="note-edit">
          <textarea
            rows={3}
            value={draft}
            placeholder="我的想法…"
            onChange={(event) => setDraft(event.target.value)}
            maxLength={20_000}
          />
          <div className="note-edit-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div className="note-item-ops">
          {item.imageKey ? (
            <button
              type="button"
              className="note-op"
              aria-label="转为卡片"
              title="转为卡片"
              disabled={service.convertingAnnotationId === item.id}
              onClick={(event) => {
                event.stopPropagation();
                void service.cardFromExcerpt(item.id);
              }}
            >
              <SquarePlus width={13} height={13} strokeWidth={1.8} />
            </button>
          ) : null}
          <button
            type="button"
            className="note-op"
            aria-label="编辑想法"
            title="编辑"
            onClick={(event) => {
              event.stopPropagation();
              setDraft(item.note);
              setEditing(true);
            }}
          >
            <Pencil width={13} height={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="note-op"
            aria-label="删除批注"
            title="删除"
            onClick={(event) => {
              event.stopPropagation();
              void service.removeAnnotation(item.id);
            }}
          >
            <Trash2 width={13} height={13} strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  );
});

const DocCardThumb = observer(function DocCardThumb({ cardId }: { cardId: string }) {
  const service = useService(DocsService);
  const url = service.cardImageUrl(cardId);
  usePresignedImage(cardId, url, (id) => void service.loadCardImage(id));
  return (
    <PresignedThumb
      url={url}
      className="card-excerpt card-excerpt-rail"
      onError={() => service.retryCardImage(cardId)}
    />
  );
});

const DocCardButton = observer(function DocCardButton({ card }: { card: DocumentCard }) {
  const service = useService(DocsService);
  const question = card.questions[0]?.question ?? card.concept;
  const answer = card.questions[0]?.answer ?? card.example;
  const open = service.expandedCardIds.includes(card.id);
  const on = service.activeCardId === card.id;
  const level = card.review ? masteryLevel(card.review.intervalDays) : 0;
  return (
    <button
      type="button"
      data-card-id={card.id}
      className={`mini-card${open ? ' is-open' : ''}${on ? ' is-on' : ''}`}
      onClick={() => service.toggleCard(card.id)}
    >
      {card.hasImage ? <DocCardThumb cardId={card.id} /> : null}
      {question.trim() !== IMAGE_EXCERPT_QUOTE ? (
        <div className="mini-q">
          <ClozeText text={question} />
        </div>
      ) : null}
      {open && answer ? <div className="mini-a">{answer}</div> : null}
      <div className="mini-foot">
        <span className="mastery" aria-hidden>
          {[0, 1, 2, 3].map((slot) => (
            <i key={slot} className={slot < level ? 'on' : undefined} />
          ))}
        </span>
        <span>{card.review ? formatNextReview(card.review.dueAt) : '还没进复习队列'}</span>
        {card.source === 'manual' ? <span className="hand-tag">手写</span> : null}
      </div>
    </button>
  );
});

export const CardRail = observer(function CardRail() {
  const service = useService(DocsService);
  const prefs = useService(UiPrefsService);
  const cards = service.doc?.cards ?? [];
  const notes = service.annotations;
  const docked = !service.cardRailNarrow && !prefs.cardRailCollapsed;
  const showOverlay = !docked && service.cardRailOverlayOpen;
  const visible = docked || showOverlay;
  const pending = service.doc?.status === 'pending';
  const badge = cards.length + notes.length;

  return (
    <>
      {showOverlay ? (
        <div
          className="card-rail-scrim"
          aria-hidden
          onClick={() => service.closeCardRailOverlay()}
        />
      ) : null}
      {visible ? (
        <aside
          className={`card-rail${showOverlay ? ' is-overlay' : ''}`}
          aria-label="批注与卡片"
        >
          <div className="card-rail-head">
            <span className="card-rail-title">本文</span>
            <Link className="go" to={ROUTES.review}>
              去复习 →
            </Link>
            {docked ? (
              <button
                type="button"
                className="btn btn-ghost card-rail-icon"
                aria-label="收起卡片栏"
                title="收起"
                onClick={() => {
                  prefs.setCardRailCollapsed(true);
                  service.closeCardRailOverlay();
                }}
              >
                <PanelRightClose width={14} height={14} strokeWidth={1.8} />
              </button>
            ) : (
              <>
                {!service.cardRailNarrow ? (
                  <button
                    type="button"
                    className="btn btn-ghost card-rail-icon"
                    aria-label="固定卡片栏"
                    title="固定"
                    onClick={() => {
                      prefs.setCardRailCollapsed(false);
                      service.closeCardRailOverlay();
                    }}
                  >
                    <PanelRightOpen width={14} height={14} strokeWidth={1.8} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost card-rail-icon"
                  aria-label="关闭卡片栏"
                  onClick={() => service.closeCardRailOverlay()}
                >
                  <X width={14} height={14} strokeWidth={1.8} />
                </button>
              </>
            )}
          </div>

          <section className="card-rail-sec" aria-label="批注">
            <h3 className="card-rail-sec-title">批注 · {notes.length}</h3>
            {notes.length === 0 ? (
              <p className="hint">划过的句子会出现在这里。</p>
            ) : (
              <div className="note-list">
                {notes.map((item) => (
                  <AnnotationItem key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>

          <section className="card-rail-sec" aria-label="本文卡片">
            <h3 className="card-rail-sec-title">本文卡片 · {cards.length}</h3>
            {cards.length === 0 ? (
              <p className="hint">
                {pending ? '处理完成后卡片会出现在这里。' : '这篇还没有卡片。'}
              </p>
            ) : (
              <div className="mini-grid">
                {cards.map((card) => (
                  <DocCardButton key={card.id} card={card} />
                ))}
              </div>
            )}
          </section>
        </aside>
      ) : null}
      {!docked ? (
        <button
          type="button"
          className="card-rail-handle"
          aria-label={`打开卡片栏，${cards.length} 张卡，${notes.length} 条批注`}
          onClick={() => service.openCardRailOverlay()}
        >
          <PanelRight width={16} height={16} strokeWidth={1.8} />
          {badge > 0 ? <span className="card-rail-badge">{badge}</span> : null}
        </button>
      ) : null}
    </>
  );
});
