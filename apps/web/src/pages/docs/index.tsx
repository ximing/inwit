import { bindServices, observer, useService } from '@rabjs/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { SearchService } from '@/components/search';
import { ANCHOR_HIT_SELECTOR } from '@/lib/anchors';
import { scrollFlashAnnotationAnchor, scrollFlashCardAnchor } from '@/lib/anchor-scroll';
import { ROUTES, docsPath } from '@/routes';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { CardEditDialog } from './card-edit-dialog';
import { DocsAnnotationsService } from './docs-annotations.service';
import { DocsImportService } from './docs-import.service';
import { DocsService } from './docs.service';
import { EditorService } from './editor.service';
import { NewTopicDialog } from './new-topic-dialog';
import { PaneEdit } from './pane-edit';
import { PaneEmpty, PaneRead } from './pane-read';
import { SelectionPopoverHost } from './selection-toolbar';
import { WorkbenchList } from './workbench-list';

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
  const urlAnnotation = params.get('annotation');
  const newTopicId = params.get('topicId');
  const listed = docId ? service.documents.find((item) => item.id === docId) : undefined;
  const fileMime = service.doc?.id === docId ? service.doc.fileMime : (listed?.fileMime ?? null);
  const isPdf = fileMime === 'application/pdf';
  // PDF 编辑正文会打乱分页节点；预览是唯一有意义的视图。
  const editing = isPdf ? false : prefs.editing;
  const editingRef = useRef(editing);
  const paneRef = useRef<HTMLDivElement>(null);
  const [settledDocId, setSettledDocId] = useState<string | null>(null);
  if (!docId && settledDocId !== null) setSettledDocId(null);

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
    editor.onSaved = (saved) =>
      service.noteEditorSaved(saved.id, saved.title, saved.contentJson, saved.updatedAt);
    return () => {
      editor.onCreated = null;
      editor.onSaved = null;
    };
  }, [editor, service]);

  useEffect(() => {
    void service.boot();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
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
      let handled = false;
      if (service.topicMenuOpen) {
        service.closeTopicMenu();
        handled = true;
      }
      if (service.paneTopicMenuOpen) {
        service.closePaneTopicMenu();
        handled = true;
      }
      if (service.activeCardId || service.activeAnnotationId) {
        service.closeHighlight();
        handled = true;
      }
      if (handled) return;
      if (prefs.zenMode) prefs.setZenMode(false);
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
  }, [service, search, prefs]);

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
      try {
        if (leavingEdit) {
          await editor.save();
          if (cancelled) return;
          if (editor.id) {
            service.noteEditorSaved(
              editor.id,
              editor.draftTitle.trim() || editor.lastSavedTitle.trim() || null,
              editor.draftJson,
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
          await service.loadDoc(docId, urlAnchor, urlAnnotation);
        } else {
          service.applyUrlAnchor(urlAnchor);
          service.applyUrlAnnotation(urlAnnotation);
        }
        if (cancelled) return;
        if (editing) {
          await editor.open(docId, service.doc?.topicId ?? newTopicId);
        }
      } finally {
        // 详情和编辑器都回来后再收起等待态，避免慢请求先画出空白编辑器。
        if (!cancelled && docId) setSettledDocId(docId);
      }
    };
    void sync();
    return () => {
      cancelled = true;
    };
  }, [docId, editing, urlAnchor, urlAnnotation, newTopicId, service, editor, service.composingNew]);

  useEffect(() => {
    if (!docId && editor.justCreated && editor.id) {
      navigate(docsPath(editor.id), { replace: true });
    }
  }, [docId, editor.justCreated, editor.id, navigate]);

  useEffect(() => {
    if (!service.scrollCardId) return;
    // 脑图画布自己把这张卡移到视口中央，这里清掉会让它来不及平移。
    if (document.querySelector('.doc-canvas')) return;
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
    if (cardId) scrollFlashCardAnchor(root, cardId);
    else if (noteId) scrollFlashAnnotationAnchor(root, noteId);
    service.clearBodyFocus();
  }, [service, service.bodyFocusCardId, service.bodyFocusAnnotationId]);

  const composingNew = !docId && service.composingNew;
  const openingDoc = Boolean(docId) && settledDocId !== docId;
  const showEmpty = !docId && !composingNew;
  const showEdit = !openingDoc && (composingNew || (Boolean(docId) && editing));
  const showRead = !openingDoc && Boolean(docId) && !editing;

  return (
    <div
      className="ws"
      style={{ '--doc-list-w': `${prefs.docListWidth}px` } as CSSProperties}
    >
      <WorkbenchList selectedId={docId} />
      <div className="ws-pane" ref={paneRef}>
        {openingDoc ? (
          <div className="pane-inner">
            <p className="empty" role="status">
              <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
              打开这张纸…
            </p>
          </div>
        ) : null}
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
      {service.editingCard ? <CardEditDialog card={service.editingCard} /> : null}
    </div>
  );
});

export const DocsPage = bindServices(DocsPageContent, [
  DocsService,
  DocsImportService,
  DocsAnnotationsService,
  EditorService,
  SearchService,
  AssetUrlsService,
]);
