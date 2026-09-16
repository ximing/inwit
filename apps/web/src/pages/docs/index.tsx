import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { SearchService } from '@/components/search';
import { ANCHOR_HIT_SELECTOR } from '@/lib/anchors';
import { scrollFlashAnnotationAnchor, scrollFlashCardAnchor } from '@/lib/anchor-scroll';
import { ROUTES, docsPath } from '@/routes';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
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
  const newTopicId = params.get('topicId');
  const listed = docId ? service.documents.find((item) => item.id === docId) : undefined;
  const fileMime = service.doc?.id === docId ? service.doc.fileMime : (listed?.fileMime ?? null);
  const isPdf = fileMime === 'application/pdf';
  // PDF 编辑正文会打乱分页节点；预览是唯一有意义的视图。
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
    editor.onSaved = (saved) => service.noteEditorSaved(saved.id, saved.title, saved.contentJson);
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
    if (cardId) scrollFlashCardAnchor(root, cardId);
    else if (noteId) scrollFlashAnnotationAnchor(root, noteId);
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

export const DocsPage = bindServices(DocsPageContent, [
  DocsService,
  DocsImportService,
  DocsAnnotationsService,
  EditorService,
  SearchService,
  AssetUrlsService,
]);
