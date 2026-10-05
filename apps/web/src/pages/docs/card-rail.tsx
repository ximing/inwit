import type { Annotation, DocumentCard } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import {
  ChevronDown,
  Lightbulb,
  List,
  PanelRight,
  PanelRightClose,
  Pause,
  Pencil,
  PictureInPicture2,
  Play,
  Repeat,
  SquarePlus,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { cardsForRail, MiniCard } from '@/components/reader/mini-card';
import { Tip } from '@/components/tip';
import { PresignedThumb, usePresignedImage } from '@/components/presigned-thumb';
import { ROUTES, topicHostId } from '@/routes';
import { DialogService } from '@/services/dialog.service';
import { LayoutService } from '@/shell/layout.service';
import {
  CANVAS_PANE_WIDTH_DEFAULT,
  CARD_RAIL_WIDTH_DEFAULT,
  cardRailLimits,
  cardRailWidthFromDrag,
  cardRailWidthFromKey,
  clampCardRailWidth,
} from '@/services/ui-prefs-logic';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { CardCanvas } from './card-canvas';
import { cardRailCanDock, cardRailMode } from './card-rail-mode';
import { CardLinks } from './card-link-list';
import { DocsService } from './docs.service';
import { mindCardActions } from './mindmap-gesture';
import { ThoughtComposer } from './thought-composer';

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
  const thought = item.kind === 'note';

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
      <Tip content={lost ? '原文已删除' : undefined}>
      <button
        type="button"
        className="note-item-main"
        onClick={() => service.focusAnnotation(item.id)}
      >
        {thought ? (
          <p className="note-kind">
            <Lightbulb width={12} height={12} strokeWidth={1.8} aria-hidden />
            想法
          </p>
        ) : null}
        {(item.kind === 'pdf' || thought) && item.imageKey ? (
          <AnnotationThumb annotationId={item.id} />
        ) : null}
        {thought ? null : <p className="note-quote">{item.quote}</p>}
        {!editing && item.note.trim() ? <p className="note-body">{item.note}</p> : null}
        {item.hasConvertedCard ? <p className="anchor-lost note-converted">已转成卡片</p> : null}
        {lost ? <p className="anchor-lost">原文已删除</p> : null}
      </button>
      </Tip>
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
            <Tip
              content={!item.imageKey && !item.note.trim() ? '先写点笔记再转卡片' : '转为卡片'}
            >
            <button
              type="button"
              className="note-op"
              aria-label="转为卡片"
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
            </Tip>
          ) : null}
          <Tip content="编辑">
          <button
            type="button"
            className="note-op"
            aria-label="编辑想法"
            onClick={(event) => {
              event.stopPropagation();
              setDraft(item.note);
              setEditing(true);
            }}
          >
            <Pencil width={13} height={13} strokeWidth={1.8} />
          </button>
          </Tip>
          <Tip content="删除">
          <button
            type="button"
            className="note-op"
            aria-label="删除批注"
            onClick={(event) => {
              event.stopPropagation();
              void service.removeAnnotation(item.id);
            }}
          >
            <Trash2 width={13} height={13} strokeWidth={1.8} />
          </button>
          </Tip>
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

const DocCardButton = observer(function DocCardButton({
  card,
  digested,
  canvasSelected = false,
  embedLinks = true,
}: {
  card: DocumentCard;
  digested: boolean;
  /** 脑图选中。不代替列表的展开。 */
  canvasSelected?: boolean;
  /** 脑图把脉络画在节点外，避免它参与节点尺寸。 */
  embedLinks?: boolean;
}) {
  const service = useService(DocsService);
  const dialog = useService(DialogService);
  const open = service.expandedCardIds.includes(card.id);
  const actions = mindCardActions({ expanded: open, canvasSelected });
  const active = service.activeCardId === card.id;
  const lost = service.isCardAnchorLost(card);
  const suspended = card.review?.suspendedAt != null;
  const proposed = card.acceptance === 'proposed';
  const canDecide = proposed && digested;
  const busy = service.cardDecisionBusy || dialog.current !== null;
  const showDecision = actions.confirm && actions.problem && canDecide;
  const showLinks = actions.links && embedLinks;
  const reject = async () => {
    const reason = await dialog.prompt('可以不填', '', {
      title: '这张卡有什么问题',
      ok: '提交',
      cancel: '返回',
    });
    if (reason === null) return;
    await service.rejectDocCard(card.id, reason);
  };
  return (
    <div className={`mini-wrap${canvasSelected && !open ? ' is-canvas-ops' : ''}`}>
      <div className="mini-card-stack">
        <MiniCard
          card={card}
          open={open}
          active={active}
          lost={lost}
          digesting={!digested}
          onClick={() => service.toggleCard(card.id)}
          thumb={card.hasImage ? <DocCardThumb cardId={card.id} /> : null}
        />
        {actions.archive ? (
          <div className="note-item-ops mini-ops">
            <Tip content="编辑">
            <button
              type="button"
              className="note-op"
              aria-label="编辑卡片"
              onClick={() => service.openCardEdit(card.id)}
            >
              <Pencil width={13} height={13} strokeWidth={1.8} />
            </button>
            </Tip>
            {actions.suspend && !proposed ? (
              <Tip content={suspended ? '恢复复习' : '已熟悉，不复习'}>
              <button
                type="button"
                className={`note-op${suspended ? ' is-on' : ''}`}
                aria-label={suspended ? '恢复复习' : '已熟悉，不复习'}
                disabled={service.acceptingProposed}
                onClick={() => void service.toggleCardSuspended(card)}
              >
                {suspended ? (
                  <Play width={13} height={13} strokeWidth={1.8} />
                ) : (
                  <Pause width={13} height={13} strokeWidth={1.8} />
                )}
              </button>
              </Tip>
            ) : null}
            <Tip content="移入回收站">
            <button
              type="button"
              className="note-op"
              aria-label="删除卡片"
              disabled={service.acceptingProposed}
              onClick={() => void service.archiveDocCard(card.id)}
            >
              <Trash2 width={13} height={13} strokeWidth={1.8} />
            </button>
            </Tip>
          </div>
        ) : null}
      </div>
      {showDecision || showLinks ? (
        <div className="mini-extra">
          {showDecision ? (
            <div className="mini-decision">
              <button
                type="button"
                className="is-primary"
                disabled={busy}
                onClick={() => void service.acceptDocCard(card.id)}
              >
                确认
              </button>
              <button type="button" className="is-quiet" disabled={busy} onClick={() => void reject()}>
                有问题
              </button>
            </div>
          ) : null}
          {showLinks ? <CardLinks cardId={card.id} documentId={service.doc?.id ?? null} /> : null}
        </div>
      ) : null}
    </div>
  );
});

export const CardRail = observer(function CardRail() {
  const service = useService(DocsService);
  const dialog = useService(DialogService);
  const prefs = useService(UiPrefsService);
  const layout = useService(LayoutService);
  const dueCount = layout.dueCount;
  const cards = cardsForRail(service.doc?.cards ?? []);
  const digested = service.doc?.status === 'digested';
  const canAcceptAll = digested && cards.some((card) => card.acceptance === 'proposed');
  const notes = service.annotations;
  const acceptAll = async () => {
    const ok = await dialog.confirm('这篇里待确认的卡片会进入复习。', {
      title: '全部确认',
      ok: '全部确认',
      cancel: '返回',
    });
    if (!ok) return;
    await service.acceptAllProposed();
  };
  const location = useLocation();
  const [params] = useSearchParams();
  const hosted = topicHostId(location.pathname, params) !== null;
  const wide = prefs.cardLayout === 'map' || prefs.zenMode;
  const limits = cardRailLimits(wide, service.paneWidth);
  const shownWidth = clampCardRailWidth(
    wide ? prefs.canvasPaneWidth : prefs.cardRailWidth,
    service.paneWidth,
    wide,
  );
  const mode = cardRailMode({
    hosted,
    zen: prefs.zenMode,
    narrow: service.cardRailNarrow,
    collapsed: prefs.cardRailCollapsed,
    float: prefs.cardRailFloat,
    peek: service.cardRailOverlayOpen,
  });
  const docked = mode === 'dock';
  const showOverlay = mode === 'overlay';
  const stack = mode === 'stack';
  const visible = mode !== 'hidden';
  const canDock = cardRailCanDock({ hosted, narrow: service.cardRailNarrow });
  const dismissRail = () => {
    prefs.setCardRailCollapsed(true);
    service.closeCardRailOverlay();
  };
  const openRail = () => {
    prefs.setCardRailCollapsed(false);
    service.closeCardRailOverlay();
  };
  const dockRail = () => {
    prefs.setCardRailFloat(false);
    prefs.setCardRailCollapsed(false);
    service.closeCardRailOverlay();
  };
  const floatRail = () => {
    prefs.setCardRailFloat(true);
    prefs.setCardRailCollapsed(false);
    service.closeCardRailOverlay();
  };
  const pending = service.doc?.status === 'pending';
  const proposedCount = cards.filter((card) => card.acceptance === 'proposed').length;
  const [notesFolded, setNotesFolded] = useState(false);
  const [railScrolled, setRailScrolled] = useState(false);
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
    if (wide) prefs.setCanvasPaneWidth(width, service.paneWidth);
    else prefs.setCardRailWidth(width, service.paneWidth);
  };

  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = shownWidth;
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
    const next = cardRailWidthFromKey(shownWidth, event.key, 16, limits);
    if (next == null) return;
    event.preventDefault();
    applyWidth(next);
  };

  return (
    <>
      {showOverlay && !prefs.zenMode ? (
        <div className="card-rail-scrim" aria-hidden onClick={dismissRail} />
      ) : null}
      {visible ? (
        <aside
          className={`card-rail${showOverlay ? ' is-overlay' : ''}${stack ? ' is-zen-stack' : ''}${prefs.cardLayout === 'map' ? ' is-map' : ''}${railScrolled ? ' is-scrolled' : ''}`}
          aria-label="批注与卡片"
          style={stack ? undefined : { width: shownWidth }}
          onScroll={(event) => {
            const scrolled = event.currentTarget.scrollTop > 0;
            if (scrolled !== railScrolled) setRailScrolled(scrolled);
          }}
        >
          {stack ? null : (
          <div
            className="card-rail-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整卡片栏宽度"
            aria-valuemin={limits.min}
            aria-valuemax={limits.max}
            aria-valuenow={shownWidth}
            tabIndex={0}
            onPointerDown={onResizePointerDown}
            onDoubleClick={() =>
              applyWidth(wide ? CANVAS_PANE_WIDTH_DEFAULT : CARD_RAIL_WIDTH_DEFAULT)
            }
            onKeyDown={onResizeKeyDown}
          />
          )}
          <div className="card-rail-head">
            <div className="card-rail-view" role="radiogroup" aria-label="卡片布局">
              <button
                type="button"
                role="radio"
                aria-checked={prefs.cardLayout === 'list'}
                className={prefs.cardLayout === 'list' ? 'is-on' : undefined}
                onClick={() => prefs.setCardLayout('list')}
              >
                <List width={12} height={12} strokeWidth={1.8} />
                <span className="card-rail-view-label">列表</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={prefs.cardLayout === 'map'}
                className={prefs.cardLayout === 'map' ? 'is-on' : undefined}
                onClick={() => prefs.setCardLayout('map')}
              >
                <Waypoints width={12} height={12} strokeWidth={1.8} />
                <span className="card-rail-view-label">脑图</span>
              </button>
            </div>
            <span className="card-rail-count">
              <span className="card-rail-count-full">
                {canAcceptAll ? (
                  <>
                    <b>{cards.length}</b> 卡 · <b>{proposedCount}</b> 待确认
                  </>
                ) : (
                  <>
                    <b>{cards.length}</b> 卡 · <b>{notes.length}</b> 批注
                  </>
                )}
              </span>
              <span className="card-rail-count-short">
                <b>{cards.length}</b> 卡
              </span>
            </span>
            <span className="card-rail-spring" />
            {canAcceptAll ? (
              <Tip content={service.cardDecisionBusy ? '还有卡片正在确认' : undefined}>
              <button
                type="button"
                className="card-rail-accept-all"
                disabled={service.cardDecisionBusy || dialog.current !== null}
                onClick={() => void acceptAll()}
              >
                {service.acceptingProposed ? '确认中…' : '全部确认'}
              </button>
              </Tip>
            ) : (
              <Tip content="去复习">
              <Link
                className={`card-rail-go${dueCount > 0 ? ' has-due' : ''}`}
                to={ROUTES.review}
                aria-label={dueCount > 0 ? `去复习，${dueCount} 张待复习` : '去复习'}
              >
                <Repeat width={12} height={12} strokeWidth={1.8} />
                {dueCount > 0 ? <span className="card-rail-go-label">复习</span> : null}
                {dueCount > 0 ? <span className="card-rail-go-num">{dueCount}</span> : null}
              </Link>
              </Tip>
            )}
            {stack ? null : (
              <div className="card-rail-mode" role="radiogroup" aria-label="卡片栏摆放">
                <Tip content={canDock ? '并排' : '窗口较窄，放不下并排'}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={docked}
                  aria-label="并排"
                  className={docked ? 'is-on' : undefined}
                  disabled={!canDock}
                  onClick={dockRail}
                >
                  <PanelRight width={13} height={13} strokeWidth={1.8} />
                </button>
                </Tip>
                <Tip content="浮层">
                <button
                  type="button"
                  role="radio"
                  aria-checked={showOverlay}
                  aria-label="浮层"
                  className={showOverlay ? 'is-on' : undefined}
                  onClick={floatRail}
                >
                  <PictureInPicture2 width={13} height={13} strokeWidth={1.8} />
                </button>
                </Tip>
              </div>
            )}
            {docked ? (
              <Tip content="收起">
              <button
                type="button"
                className="btn btn-ghost card-rail-icon"
                aria-label="收起卡片栏"
                onClick={dismissRail}
              >
                <PanelRightClose width={14} height={14} strokeWidth={1.8} />
              </button>
              </Tip>
            ) : showOverlay ? (
              <Tip content="关闭">
              <button
                type="button"
                className="btn btn-ghost card-rail-icon"
                aria-label="关闭卡片栏"
                onClick={dismissRail}
              >
                <X width={14} height={14} strokeWidth={1.8} />
              </button>
              </Tip>
            ) : null}
          </div>

          <section className="card-rail-sec is-notes" aria-label="批注">
            {service.doc ? (
              <div className="card-rail-thought">
                <ThoughtComposer documentId={service.doc.id} />
              </div>
            ) : null}
            <button
              type="button"
              className="card-rail-notes-toggle"
              aria-expanded={!notesFolded}
              onClick={() => setNotesFolded((folded) => !folded)}
            >
              <ChevronDown className="chev" width={10} height={10} strokeWidth={2.4} />
              批注 · {notes.length}
            </button>
            {notesFolded ? null : notes.length === 0 ? (
              <p className="hint">划过的句子会出现在这里。</p>
            ) : (
              <div className="note-list">
                {notes.map((item) => (
                  <AnnotationItem key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>

          <section
            className="card-rail-sec is-cards"
            aria-label={prefs.cardLayout === 'map' ? '脑图' : '本文卡片'}
          >
            {prefs.cardLayout === 'map' ? (
              <CardCanvas
                renderCard={(card, selected) => (
                  <DocCardButton
                    card={card}
                    digested={digested}
                    canvasSelected={selected}
                    embedLinks={false}
                  />
                )}
              />
            ) : cards.length === 0 ? (
              <p className="hint">
                {pending ? '处理完成后卡片会出现在这里。' : '这篇还没有卡片。'}
              </p>
            ) : (
              <div className="mini-grid">
                {cards.map((card) => (
                  <DocCardButton key={card.id} card={card} digested={digested} />
                ))}
              </div>
            )}
          </section>
        </aside>
      ) : null}
      {mode === 'hidden' ? (
        <button
          type="button"
          className="card-rail-handle"
          aria-label={`打开卡片栏，${cards.length} 张卡，${notes.length} 条批注`}
          onClick={openRail}
        >
          <PanelRight width={16} height={16} strokeWidth={1.8} />
          {badge > 0 ? <span className="card-rail-badge">{badge}</span> : null}
        </button>
      ) : null}
    </>
  );
});
