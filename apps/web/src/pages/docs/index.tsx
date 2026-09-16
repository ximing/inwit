import {
  AGENT_DOC_LABEL_REPORT,
  agentDocumentMetaLabel,
  docDisplayTitle,
  IMAGE_EXCERPT_QUOTE,
  type Annotation,
  type DocumentCard,
  type DocumentListItem,
  type Topic,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import {
  ChevronDown,
  FilePlus,
  Loader2,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  PenLine,
  SquarePlus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Chip } from '@/components/chip';
import { DocRowSummary } from '@/components/doc-row';
import { SearchBox, SearchResults, SearchService } from '@/components/search';
import { Tag } from '@/components/tag';
import {
  ANCHOR_HIT_SELECTOR,
  annotationIdsFromAnchor,
  cardIdsFromAnchor,
  docAnchors,
} from '@/lib/anchors';
import { parseCloze } from '@/lib/cloze';
import { formatNextReview, formatRelativeTime, isSubmitHotkey, masteryLevel } from '@/lib/format';
import { AnchoredMarkdown, Markdown } from '@/lib/Markdown';
import { ROUTES, docsPath } from '@/routes';
import { UiPrefsService, type DocMode } from '@/services/ui-prefs.service';
import { DocsService } from './docs.service';
import { EditorService } from './editor.service';
import { PaperEditor } from './paper-editor';
import { SelectionActions, SelectionPopoverHost } from './selection-toolbar';

const PdfPane = lazy(() => import('./pdf-pane'));

const DocsPageContent = observer(function DocsPageContent() {
  const service = useService(DocsService);
  const editor = useService(EditorService);
  const search = useService(SearchService);
  const prefs = useService(UiPrefsService);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const docId = params.get('doc');
  const editParam = params.get('edit') === '1';
  const urlAnchor = params.get('anchor');
  const newTopicId = params.get('topicId');
  const listed = docId ? service.documents.find((item) => item.id === docId) : undefined;
  const fileMime = service.doc?.id === docId ? service.doc.fileMime : (listed?.fileMime ?? null);
  const isPdf = fileMime === 'application/pdf';
  // PDF 编辑 contentMd 会打乱页分隔锚点；预览是唯一有意义的视图。
  const editing = isPdf ? false : prefs.editing;
  const editingRef = useRef(editing);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editParam) return;
    const stripEdit = () => {
      setParams(
        (prev) => {
          if (prev.get('edit') !== '1') return prev;
          const next = new URLSearchParams(prev);
          next.delete('edit');
          return next;
        },
        { replace: true },
      );
    };
    if (isPdf) {
      stripEdit();
      return;
    }
    prefs.setDocMode('edit');
    if (!docId) service.beginComposeNew();
    stripEdit();
  }, [editParam, docId, isPdf, setParams, prefs, service]);

  useEffect(() => {
    editor.onCreated = (created) => service.ingestCreated(created);
    editor.onSaved = (saved) => service.noteEditorSaved(saved.id, saved.title, saved.contentMd);
    return () => {
      editor.onCreated = null;
      editor.onSaved = null;
    };
  }, [editor, service]);

  useEffect(() => {
    void service.boot();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (service.selectionPop) {
        service.closeSelectionPop();
        return;
      }
      if (service.newTopicOpen) {
        service.closeNewTopic();
        return;
      }
      if (service.cardRailOverlayOpen) {
        service.closeCardRailOverlay();
        return;
      }
      if (search.hasQuery) {
        search.clear();
        return;
      }
      if (service.topicMenuOpen) service.closeTopicMenu();
      if (service.paneTopicMenuOpen) service.closePaneTopicMenu();
      if (service.activeCardId || service.activeAnnotationId) service.closeHighlight();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.sel-pop, .float-toolbar')) return;
      if (service.topicMenuOpen && !target.closest('.ws-capture .topic-pick-wrap')) {
        service.closeTopicMenu();
      }
      if (service.paneTopicMenuOpen && !target.closest('.ws-pane .topic-pick-wrap')) {
        service.closePaneTopicMenu();
      }
      if (
        service.cardRailOverlayOpen &&
        !target.closest(`.card-rail, .card-rail-handle, ${ANCHOR_HIT_SELECTOR}`)
      ) {
        service.closeCardRailOverlay();
      }
      if (service.activeCardId || service.activeAnnotationId) {
        if (target.closest('.mini-card, .note-item, .search-hit')) return;
        if (target.closest(ANCHOR_HIT_SELECTOR)) return;
        service.closeHighlight();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      service.stopPolling();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [service, search]);

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      service.setPaneWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    service.setPaneWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [service]);

  useEffect(() => {
    const leavingEdit = editingRef.current && !editing;
    editingRef.current = editing;
    let cancelled = false;

    const sync = async () => {
      if (leavingEdit) {
        await editor.save();
        if (cancelled) return;
        if (editor.id) {
          service.noteEditorSaved(
            editor.id,
            editor.draftTitle.trim() || editor.lastSavedTitle.trim() || null,
            editor.draftMd,
          );
        }
        editor.idle();
      }
      if (cancelled) return;
      if (!docId && service.composingNew) {
        if (!editing) {
          service.endComposeNew();
          editor.idle();
          return;
        }
        await editor.open('new', newTopicId);
        return;
      }
      if (!docId) {
        service.closeDoc();
        if (editor.phase !== 'idle') {
          await editor.save();
          if (cancelled) return;
          editor.idle();
        }
        return;
      }
      if (service.doc?.id !== docId || leavingEdit) {
        await service.loadDoc(docId, urlAnchor);
      } else {
        service.applyUrlAnchor(urlAnchor);
      }
      if (cancelled) return;
      if (editing) {
        await editor.open(docId, service.doc?.topicId ?? newTopicId);
      }
    };
    void sync();
    return () => {
      cancelled = true;
    };
  }, [docId, editing, urlAnchor, newTopicId, service, editor, service.composingNew]);

  useEffect(() => {
    if (!docId && editor.justCreated && editor.id) {
      navigate(docsPath(editor.id), { replace: true });
    }
  }, [docId, editor.justCreated, editor.id, navigate]);

  useEffect(() => {
    if (!service.scrollCardId) return;
    const id = service.scrollCardId;
    const el = document.querySelector(`.card-rail .mini-card[data-card-id="${id}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    service.clearScrollCard();
  }, [service, service.scrollCardId]);

  useEffect(() => {
    if (!service.scrollAnnotationId) return;
    const id = service.scrollAnnotationId;
    const el = document.querySelector(`.card-rail .note-item[data-annotation-id="${id}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    service.clearScrollAnnotation();
  }, [service, service.scrollAnnotationId]);

  useEffect(() => {
    const cardId = service.bodyFocusCardId;
    const noteId = service.bodyFocusAnnotationId;
    if (!cardId && !noteId) return;
    const root = document.querySelector('.pane-scroll');
    const nodes = root ? [...root.querySelectorAll(ANCHOR_HIT_SELECTOR)] : [];
    const hit = cardId
      ? nodes.find((el) => cardIdsFromAnchor(el).includes(cardId))
      : nodes.find((el) => noteId !== null && annotationIdsFromAnchor(el).includes(noteId));
    if (hit instanceof HTMLElement) {
      const reduce =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      hit.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      hit.classList.add('is-flash');
      window.setTimeout(() => hit.classList.remove('is-flash'), 1100);
    }
    service.clearBodyFocus();
  }, [service, service.bodyFocusCardId, service.bodyFocusAnnotationId]);

  const composingNew = !docId && service.composingNew;
  const showEmpty = !docId && !composingNew;
  const showEdit = composingNew || (Boolean(docId) && editing);
  const showRead = Boolean(docId) && !editing;

  return (
    <div className="ws">
      <WorkbenchList selectedId={docId} />
      <div className="ws-pane" ref={paneRef}>
        {showEmpty ? <PaneEmpty /> : null}
        {showRead ? <PaneRead /> : null}
        {showEdit ? <PaneEdit docId={docId} /> : null}
      </div>
      {service.toast ? (
        <p className="toast" role="status">
          {service.toast}
        </p>
      ) : null}
      <SelectionPopoverHost />
      {service.newTopicOpen ? <NewTopicDialog /> : null}
    </div>
  );
});

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

function transferHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

const WorkbenchList = observer(function WorkbenchList({ selectedId }: { selectedId: string | null }) {
  const service = useService(DocsService);
  const search = useService(SearchService);
  const prefs = useService(UiPrefsService);
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    const root = scrollRef.current;
    const target = moreRef.current;
    if (!root || !target || !service.hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void service.loadMore();
      },
      { root, rootMargin: '120px' },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [service, service.hasMore, service.documents.length, search.hasQuery]);

  const sending = service.$model.send.loading;
  const creating = service.$model.createBlank.loading;
  const importing = service.importing;
  const busy = creating || importing;
  const uploadPercent =
    service.uploadingDocumentId !== null
      ? (service.uploadByDoc[service.uploadingDocumentId]?.percent ?? null)
      : null;
  const askClass = ['btn', 'btn-ghost', service.draftLooksLikeQuestion ? 'is-accent' : '']
    .filter(Boolean)
    .join(' ');

  const submit = async (mode: 'auto' | 'chat') => {
    const id = await service.send(mode);
    if (id) navigate(docsPath(id));
  };

  const createBlank = async () => {
    if (busy) return;
    const id = await service.createBlank();
    if (id) {
      prefs.setDocMode('edit');
      navigate(docsPath(id));
    }
  };

  const importOne = async (file: File) => {
    if (busy) return;
    const id = await service.importFile(file);
    if (id) navigate(docsPath(id));
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event)) return;
    event.preventDefault();
    setDropActive(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event)) return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropActive(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropActive(false);
    const file = event.dataTransfer.files.item(0);
    if (file) void importOne(file);
  };

  const swallowFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event)) return;
    event.preventDefault();
  };

  const scrollClass = [
    'ws-scroll',
    dropActive ? 'is-drop' : '',
    importing ? 'is-busy' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="ws-list" onDragOver={swallowFileDrop} onDrop={swallowFileDrop}>
      {service.importError ? (
        <div className="ws-alert" role="alert">
          <p>{service.importError}</p>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="关闭"
            onClick={() => service.dismissImportError()}
          >
            <X width={14} height={14} strokeWidth={1.8} />
          </button>
        </div>
      ) : null}
      <div className="ws-capture">
        <div className="capture">
          <textarea
            rows={2}
            autoComplete="off"
            placeholder="扔一句话进来，或以问号结尾问 AI…"
            value={service.draft}
            onChange={(event) => service.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (isSubmitHotkey(event)) {
                event.preventDefault();
                void submit('auto');
              }
            }}
          />
          <div className="capture-bar">
            <TopicPicker
              topics={service.topics}
              topicId={service.captureTopicId}
              open={service.topicMenuOpen}
              onToggle={() => service.toggleTopicMenu()}
              onSelect={(id) => service.selectCaptureTopic(id)}
              onNew={() => service.openNewTopic('capture')}
            />
            <div className="capture-actions">
              <button
                type="button"
                className={askClass}
                disabled={!service.canSend}
                onClick={() => void submit('chat')}
              >
                {sending ? '提问中…' : '问 AI'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!service.canSend}
                onClick={() => void submit('auto')}
              >
                {sending ? '投入中…' : '扔进去'}
              </button>
            </div>
          </div>
        </div>
        {service.error ? (
          <p className="banner-error" role="alert">
            {service.error}
          </p>
        ) : null}
      </div>

      <div className="ws-search">
        <SearchBox />
      </div>

      <div className="ws-filters">
        <Chip isOn={service.filterTopicId === null} onClick={() => void service.setFilter(null)}>
          全部
        </Chip>
        {service.topics.map((topic) => (
          <Chip
            key={topic.id}
            isOn={service.filterTopicId === topic.id}
            title={topic.goal ?? topic.title}
            onClick={() => void service.setFilter(topic.id)}
          >
            {topic.title}
          </Chip>
        ))}
        <Chip dashed onClick={() => service.openNewTopic('filter')}>
          ＋ 主题
        </Chip>
      </div>

      <div className="ws-tools">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void createBlank()}
        >
          <FilePlus strokeWidth={1.8} />
          {creating ? '正在新建…' : '新建文档'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          aria-busy={importing}
          onClick={() => fileRef.current?.click()}
        >
          {importing ? <Loader2 className="icon-spin" strokeWidth={1.8} /> : <Upload strokeWidth={1.8} />}
          {importing ? '导入中…' : '导入'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.epub,.txt,.md"
          hidden
          aria-label="选择要导入的文件"
          onChange={(event) => {
            const file = event.target.files?.item(0);
            event.target.value = '';
            if (file) void importOne(file);
          }}
        />
      </div>

      <div
        className={scrollClass}
        ref={scrollRef}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {search.hasQuery ? (
          <SearchResults />
        ) : (
          <>
            {importing ? (
              <p className="ws-importing">
                <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                正在上传 {service.importingName}
                {uploadPercent !== null ? ` ${uploadPercent}%` : ''}
                {service.uploadingDocumentId ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={service.cancelingId === service.uploadingDocumentId}
                    onClick={() => {
                      const id = service.uploadingDocumentId;
                      if (id) void service.cancelImport(id);
                    }}
                  >
                    取消
                  </button>
                ) : null}
              </p>
            ) : null}
            {service.documents.length === 0 && !service.$model.boot.loading && !service.$model.loadDocuments.loading && !importing ? (
              <p className="hint">这张纸还是空的。扔一句话进来。</p>
            ) : null}
            {service.documents.map((doc) => (
              <DocStreamRow key={doc.id} doc={doc} selected={doc.id === selectedId} />
            ))}
            {service.hasMore ? (
              <div ref={moreRef} className="ws-more">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={service.$model.loadMore.loading}
                  onClick={() => void service.loadMore()}
                >
                  {service.$model.loadMore.loading ? '载入中…' : '更早的文档'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
});

const DocStreamRow = observer(function DocStreamRow({
  doc,
  selected,
}: {
  doc: DocumentListItem;
  selected: boolean;
}) {
  const service = useService(DocsService);
  const stage = service.stageFor(doc);
  const kind = rowKindTag(doc, stage);
  return (
    <div className={`row ws-doc-row${selected ? ' is-on' : ''}`}>
      <Link to={docsPath(doc.id)} className="ws-doc-row-link">
        <div className="row-title">
          <span className="t">{docDisplayTitle(doc)}</span>
          {kind ? (
            <Tag tone={kind.tone}>
              {kind.pulse ? <span className="pulse" /> : null}
              {kind.pulse ? '\u00a0' : null}
              {kind.label}
            </Tag>
          ) : null}
          {doc.status === 'failed' ? <span className="doc-failed">失败</span> : null}
        </div>
        <DocRowSummary doc={doc} />
        <div className="row-meta">
          {doc.source === 'import' ? <Tag className="tag-import">导入</Tag> : null}
          {doc.topicTitle ? <Tag tone="topic">{doc.topicTitle}</Tag> : null}
          {doc.cardCount > 0 ? <span>{doc.cardCount} 卡</span> : null}
          {doc.cardCount > 0 ? <span>·</span> : null}
          <span>{formatRelativeTime(doc.updatedAt)}</span>
        </div>
      </Link>
      {stage.canCancel || stage.canRetry ? (
        <div className="ws-doc-row-ops">
          {stage.canCancel ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={service.cancelingId === doc.id}
              onClick={() => void service.cancelImport(doc.id)}
            >
              {service.cancelingId === doc.id ? '取消中…' : '取消'}
            </button>
          ) : null}
          {stage.canRetry ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={service.retryingId === doc.id}
              onClick={() => void service.retryFailed(doc.id)}
            >
              {service.retryingId === doc.id ? '重试中…' : '重试'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function rowKindTag(
  doc: DocumentListItem,
  stage: { kind: string; label: string; pulse: boolean },
): { tone: 'ai' | 'busy'; label: string; pulse?: boolean } | null {
  if (stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label) {
    return { tone: 'busy', label: stage.label, pulse: stage.pulse };
  }
  const agent = agentDocumentMetaLabel(doc.source, doc.title);
  if (agent) return { tone: 'ai', label: agent };
  if (doc.source === 'chat') return { tone: 'ai', label: 'AI 回答' };
  return null;
}

function PaneEmpty() {
  return (
    <div className="pane-empty">
      <PenLine className="pane-empty-ico" strokeWidth={1.4} aria-hidden />
      <p className="pane-empty-title">从左边选一篇，或者直接扔一句话</p>
      <p className="pane-empty-sub">阅读、编辑、卡片都在这一个窗格里完成</p>
    </div>
  );
}

const ModeSwitch = observer(function ModeSwitch() {
  const prefs = useService(UiPrefsService);
  const options: ReadonlyArray<{ id: DocMode; label: string }> = [
    { id: 'edit', label: '编辑' },
    { id: 'preview', label: '预览' },
  ];
  return (
    <div className="mode-seg" role="radiogroup" aria-label="编辑或预览">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={prefs.docMode === option.id}
          className={`mode-seg-btn${prefs.docMode === option.id ? ' is-on' : ''}`}
          onClick={() => prefs.setDocMode(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
});

const PaneChrome = observer(function PaneChrome({
  editing,
  docId,
  hideModeSwitch = false,
}: {
  editing: boolean;
  docId: string | null;
  hideModeSwitch?: boolean;
}) {
  const service = useService(DocsService);
  const editor = useService(EditorService);
  const navigate = useNavigate();
  const topicId = editing
    ? (editor.topicId ?? service.doc?.topicId ?? null)
    : (service.doc?.topicId ?? null);

  const close = () => {
    service.endComposeNew();
    navigate(ROUTES.docs);
  };

  return (
    <div className="pane-chrome">
      <button type="button" className="btn btn-ghost" onClick={close}>
        <X width={14} height={14} strokeWidth={1.8} />
        关闭
      </button>
      <TopicPicker
        topics={service.topics}
        topicId={topicId}
        open={service.paneTopicMenuOpen}
        compact
        onToggle={() => service.togglePaneTopicMenu()}
        onSelect={(id) => {
          if (editing) editor.setTopicId(id);
          const documentId = editor.id ?? service.doc?.id ?? docId;
          if (documentId) void service.setDocTopic(id, documentId);
        }}
        onNew={() => service.openNewTopic('pane')}
      />
      {editing && editor.saveLabel ? (
        <span className={`save-state is-${editor.saveState}`}>
          {editor.saveState === 'saved' ? <span className="ok">●</span> : null}
          {editor.saveLabel}
        </span>
      ) : null}
      <span className="spacer" />
      {hideModeSwitch ? null : <ModeSwitch />}
    </div>
  );
});

const CardRail = observer(function CardRail() {
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

const AnnotationThumb = observer(function AnnotationThumb({
  annotationId,
}: {
  annotationId: string;
}) {
  const service = useService(DocsService);
  const url = service.annotationImageUrls[annotationId];

  useEffect(() => {
    if (url) return;
    void service.loadAnnotationImage(annotationId);
  }, [annotationId, url, service]);

  if (!url) return null;
  return <img className="note-thumb" src={url} alt="" />;
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

  useEffect(() => {
    if (url) return;
    void service.loadCardImage(cardId);
  }, [cardId, url, service]);

  if (!url) return null;
  return (
    <img
      className="card-excerpt card-excerpt-rail"
      src={url}
      alt=""
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

const DocPaneMeta = observer(function DocPaneMeta({
  docId,
  updatedAt,
  cardCount,
  status,
  source,
}: {
  docId: string;
  updatedAt: string;
  cardCount: number;
  status: DocumentListItem['status'];
  source: DocumentListItem['source'];
}) {
  const service = useService(DocsService);
  const stage = service.stageFor({
    id: docId,
    status,
    source,
  });
  return (
    <div className="pane-meta">
      <span>{formatRelativeTime(updatedAt)}</span>
      <span className="sep">·</span>
      <span>{cardCount} 张卡</span>
      {stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label ? (
        <>
          <span className="sep">·</span>
          <span>{stage.label}</span>
        </>
      ) : null}
      {status === 'failed' ? (
        <>
          <span className="sep">·</span>
          <span>失败</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={service.retryingId === docId}
            onClick={() => void service.retryFailed(docId)}
          >
            {service.retryingId === docId ? '重试中…' : '重试'}
          </button>
        </>
      ) : null}
      {stage.canCancel ? (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={service.cancelingId === docId}
          onClick={() => void service.cancelImport(docId)}
        >
          {service.cancelingId === docId ? '取消中…' : '取消上传'}
        </button>
      ) : null}
    </div>
  );
});

const PaneRead = observer(function PaneRead() {
  const service = useService(DocsService);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const urlAnchor = params.get('anchor');
  const doc = service.doc;
  const anchors = useMemo(
    () => docAnchors(doc?.cards ?? [], service.annotations),
    [doc, service.annotations],
  );

  if (service.$model.loadDoc.loading && !doc) {
    return (
      <div className="pane-inner">
        <p className="empty">打开这张纸…</p>
      </div>
    );
  }

  if (service.docError && !doc) {
    return (
      <div className="pane-inner">
        <p className="empty">
          {service.docError}{' '}
          <button type="button" className="btn btn-ghost" onClick={() => navigate(ROUTES.docs)}>
            回文档列表
          </button>
        </p>
      </div>
    );
  }

  if (!doc) return null;

  const isPdf = doc.fileMime === 'application/pdf';
  const isReport = agentDocumentMetaLabel(doc.source, doc.title) === AGENT_DOC_LABEL_REPORT;
  const stage = service.stageFor(doc);
  const emptyHint =
    stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label
      ? stage.label
      : '这张纸还是空的，写点什么吧';

  return (
    <div className="pane-doc">
      <PaneChrome editing={false} docId={doc.id} hideModeSwitch={isPdf} />
      <div className="pane-main">
        <div className={`pane-scroll${isPdf ? ' is-pdf' : ''}`}>
          {isPdf ? (
            <Suspense
              fallback={
                <p className="empty">
                  <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                  正在打开…
                </p>
              }
            >
              <PdfPane />
            </Suspense>
          ) : (
            <div className="pane-inner">
              <h1 className="pane-title">
                {docDisplayTitle(doc)}
                {isReport ? <Tag tone="ai">AI 复盘</Tag> : null}
              </h1>
              <DocPaneMeta
                docId={doc.id}
                updatedAt={doc.updatedAt}
                cardCount={doc.cards.length}
                status={doc.status}
                source={doc.source}
              />

              <article className="paper">
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
                    activeAnnotationId={service.activeAnnotationId}
                    focusCardId={urlAnchor}
                    onAnchorClick={(ids) => service.openAnchors(ids)}
                    onAnnotationClick={(ids) => {
                      const id = ids[0];
                      if (id) service.openAnnotation(id);
                    }}
                    className="md-body prose"
                  />
                ) : (
                  <p className="empty">{emptyHint}</p>
                )}
              </article>
            </div>
          )}
        </div>
        <CardRail />
      </div>
      {isPdf ? null : <ReadSelectionToolbar />}
    </div>
  );
});

const PaneEdit = observer(function PaneEdit({ docId }: { docId: string | null }) {
  const service = useService(DocsService);
  const editor = useService(EditorService);
  const navigate = useNavigate();
  const anchors = useMemo(
    () => docAnchors(service.doc?.cards ?? [], service.annotations),
    [service.doc, service.annotations],
  );

  if (editor.phase === 'missing') {
    return (
      <div className="pane-inner">
        <p className="empty">
          {editor.error ?? '找不到这份文档。'}{' '}
          <button type="button" className="btn btn-ghost" onClick={() => navigate(ROUTES.docs)}>
            回文档列表
          </button>
        </p>
      </div>
    );
  }

  const metaDoc =
    service.doc && editor.id && service.doc.id === editor.id ? service.doc : null;

  return (
    <div className="pane-doc is-editing">
      <PaneChrome editing docId={docId} />
      <div className="pane-main">
        <div className="pane-scroll">
          <div className="pane-inner">
            {editor.phase === 'loading' ? (
              <p className="empty">打开这张纸…</p>
            ) : (
              <>
                <input
                  className="title-input"
                  value={editor.draftTitle}
                  placeholder="无标题"
                  aria-label="标题"
                  onChange={(event) => editor.noteTitleChange(event.target.value)}
                />
                {metaDoc ? (
                  <DocPaneMeta
                    docId={metaDoc.id}
                    updatedAt={metaDoc.updatedAt}
                    cardCount={metaDoc.cards.length}
                    status={metaDoc.status}
                    source={metaDoc.source}
                  />
                ) : null}
                {editor.phase === 'new' || editor.phase === 'ready' ? (
                  <PaperEditor
                    seedKey={editor.seedKey}
                    seedMarkdown={editor.seedMarkdown}
                    documentId={editor.id ?? service.doc?.id ?? null}
                    anchors={anchors}
                    activeCardId={service.activeCardId}
                    activeAnnotationId={service.activeAnnotationId}
                    onChange={(markdown) => editor.noteChange(markdown)}
                    onSave={() => void editor.save()}
                    onAnchorClick={(ids) => service.openAnchors(ids)}
                    onAnnotationClick={(ids) => {
                      const id = ids[0];
                      if (id) service.openAnnotation(id);
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
        {service.doc || editor.id ? <CardRail /> : null}
      </div>
    </div>
  );
});

const ReadSelectionToolbar = observer(function ReadSelectionToolbar() {
  const service = useService(DocsService);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    bottom: number;
    text: string;
  } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const holdRef = useRef(false);

  useEffect(() => {
    const hide = () => {
      if (holdRef.current) return;
      if (service.selectionPop) return;
      if (service.selectionDigesting && posRef.current) return;
      setPos(null);
    };
    const update = () => {
      if (holdRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        hide();
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        hide();
        return;
      }
      const node = sel.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      if (!el?.closest('.pane-doc:not(.is-editing) .paper')) {
        hide();
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hide();
        return;
      }
      setPos({
        left: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom,
        text,
      });
    };
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', hide, true);
    };
  }, [service]);

  useEffect(() => {
    if (service.selectionPop) {
      setPos(null);
      return;
    }
    if (service.selectionDigesting) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) setPos(null);
  }, [service.selectionPop, service.selectionDigesting]);

  if (!pos) return null;

  return createPortal(
    <div
      className="float-toolbar"
      role="toolbar"
      aria-label="划线工具"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: 'translate(-50%, calc(-100% - 12px))',
      }}
      onMouseEnter={() => {
        holdRef.current = true;
      }}
      onMouseLeave={() => {
        holdRef.current = false;
      }}
    >
      <SelectionActions
        text={pos.text}
        documentId={service.doc?.id ?? null}
        getRect={() => ({ left: pos.left, top: pos.top, bottom: pos.bottom })}
      />
    </div>,
    document.body,
  );
});

function TopicPicker({
  topics,
  topicId,
  open,
  compact = false,
  onToggle,
  onSelect,
  onNew,
}: {
  topics: Topic[];
  topicId: string | null;
  open: boolean;
  compact?: boolean;
  onToggle: () => void;
  onSelect: (id: string | null) => void;
  onNew: () => void;
}) {
  const current = topics.find((topic) => topic.id === topicId);
  const label = current?.title ?? '不指定主题';
  return (
    <div className="topic-pick-wrap">
      <button
        type="button"
        className="topic-pick"
        style={compact ? { padding: '0 8px', height: 24, fontSize: 12.5 } : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={topicId ? 'dot' : 'dot is-off'} />
        {label}
        <ChevronDown width={10} height={10} strokeWidth={2.4} />
      </button>
      {open ? (
        <div className="topic-menu" role="listbox" aria-label="选择主题">
          <button
            type="button"
            role="option"
            aria-selected={topicId === null}
            className={topicId === null ? 'is-on' : undefined}
            onClick={() => onSelect(null)}
          >
            不指定主题
          </button>
          {topics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              role="option"
              aria-selected={topicId === topic.id}
              className={topicId === topic.id ? 'is-on' : undefined}
              title={topic.goal ?? topic.title}
              onClick={() => onSelect(topic.id)}
            >
              {topic.title}
            </button>
          ))}
          <div className="topic-menu-sep" />
          <button type="button" className="topic-menu-new" onClick={onNew}>
            新建主题
          </button>
        </div>
      ) : null}
    </div>
  );
}

const NewTopicDialog = observer(function NewTopicDialog() {
  const service = useService(DocsService);
  return (
    <div
      className="dialog-backdrop"
      onClick={() => service.closeNewTopic()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') service.closeNewTopic();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-labelledby="ws-new-topic-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="ws-new-topic-title">新建主题</h2>
        <p className="lede">一句话标题，可选学习目标。目标会锚定这个专题里的消化方式。</p>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void service.createNewTopic();
          }}
        >
          <label>
            标题
            <input
              autoFocus
              name="title"
              value={service.newTitle}
              onChange={(event) => service.setNewTitle(event.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label>
            目标（可选）
            <textarea
              name="goal"
              rows={3}
              value={service.newGoal}
              onChange={(event) => service.setNewGoal(event.target.value)}
              maxLength={4000}
              placeholder="例如：把 PPO 从直觉讲到能自己推 KL 项"
            />
          </label>
          {service.newTopicError ? (
            <p className="banner-error" role="alert">
              {service.newTopicError}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={() => service.closeNewTopic()}>
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={service.$model.createNewTopic.loading}
            >
              {service.$model.createNewTopic.loading ? '创建中…' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export const DocsPage = bindServices(DocsPageContent, [DocsService, EditorService, SearchService]);
