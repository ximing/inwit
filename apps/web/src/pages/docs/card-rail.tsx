import type { Annotation, DocumentCard } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import {
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Pencil,
  Play,
  SquarePlus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { MiniCard } from '@/components/reader/mini-card';
import { PresignedThumb, usePresignedImage } from '@/components/presigned-thumb';
import { ROUTES } from '@/routes';
import {
  CARD_RAIL_WIDTH_DEFAULT,
  CARD_RAIL_WIDTH_MAX,
  CARD_RAIL_WIDTH_MIN,
  cardRailWidthFromDrag,
  cardRailWidthFromKey,
} from '@/services/ui-prefs-logic';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { DocsService } from './docs.service';

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
  const lost = service.isAnnotationAnchorLost(item);

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
      className={`note-item${on ? ' is-on' : ''}${editing ? ' is-editing' : ''}${lost ? ' is-lost' : ''}`}
    >
      <button
        type="button"
        className="note-item-main"
        title={lost ? '原文已删除' : undefined}
        onClick={() => service.focusAnnotation(item.id)}
      >
        {item.kind === 'pdf' && item.imageKey ? <AnnotationThumb annotationId={item.id} /> : null}
        <p className="note-quote">{item.quote}</p>
        {!editing && item.note.trim() ? <p className="note-body">{item.note}</p> : null}
        {item.hasConvertedCard ? <p className="anchor-lost note-converted">已转成卡片</p> : null}
        {lost ? <p className="anchor-lost">原文已删除</p> : null}
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
          {!item.hasConvertedCard ? (
            <button
              type="button"
              className="note-op"
              aria-label="转为卡片"
              title={
                !item.imageKey && !item.note.trim() ? '先写点笔记再转卡片' : '转为卡片'
              }
              disabled={
                service.convertingAnnotationId === item.id ||
                (!item.imageKey && !item.note.trim())
              }
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
  const open = service.expandedCardIds.includes(card.id);
  const active = service.activeCardId === card.id;
  const lost = service.isCardAnchorLost(card);
  const suspended = card.review?.suspendedAt != null;
  return (
    <div className="mini-wrap">
      <MiniCard
        card={card}
        open={open}
        active={active}
        lost={lost}
        onClick={() => service.toggleCard(card.id)}
        thumb={card.hasImage ? <DocCardThumb cardId={card.id} /> : null}
      />
      {open ? (
        <div className="note-item-ops mini-ops">
          <button
            type="button"
            className="note-op"
            aria-label="编辑卡片"
            title="编辑"
            onClick={() => service.openCardEdit(card.id)}
          >
            <Pencil width={13} height={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={`note-op${suspended ? ' is-on' : ''}`}
            aria-label={suspended ? '恢复复习' : '已熟悉，不复习'}
            title={suspended ? '恢复复习' : '已熟悉，不复习'}
            onClick={() => void service.toggleCardSuspended(card)}
          >
            {suspended ? (
              <Play width={13} height={13} strokeWidth={1.8} />
            ) : (
              <Pause width={13} height={13} strokeWidth={1.8} />
            )}
          </button>
          <button
            type="button"
            className="note-op"
            aria-label="删除卡片"
            title="移入回收站"
            onClick={() => void service.archiveDocCard(card.id)}
          >
            <Trash2 width={13} height={13} strokeWidth={1.8} />
          </button>
        </div>
      ) : null}
    </div>
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
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const stopResize = () => {
    dragRef.current = null;
    document.documentElement.classList.remove('is-resizing-card-rail');
  };

  useEffect(() => {
    return () => stopResize();
  }, []);

  const applyWidth = (width: number) => {
    prefs.setCardRailWidth(width, service.paneWidth);
  };

  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = prefs.cardRailWidth;
    dragRef.current = { startX, startWidth };
    document.documentElement.classList.add('is-resizing-card-rail');

    const onMove = (move: globalThis.PointerEvent) => {
      if (!dragRef.current) return;
      applyWidth(cardRailWidthFromDrag(startWidth, startX, move.clientX));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      stopResize();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = cardRailWidthFromKey(prefs.cardRailWidth, event.key);
    if (next == null) return;
    event.preventDefault();
    applyWidth(next);
  };

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
          style={{ width: prefs.cardRailWidth }}
        >
          <div
            className="card-rail-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整卡片栏宽度"
            aria-valuemin={CARD_RAIL_WIDTH_MIN}
            aria-valuemax={CARD_RAIL_WIDTH_MAX}
            aria-valuenow={prefs.cardRailWidth}
            tabIndex={0}
            onPointerDown={onResizePointerDown}
            onDoubleClick={() => applyWidth(CARD_RAIL_WIDTH_DEFAULT)}
            onKeyDown={onResizeKeyDown}
          />
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
