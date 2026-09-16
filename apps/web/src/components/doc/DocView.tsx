import type { Annotation, DocumentCard } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { cardIdsFromAnchor, docEntities } from '@/lib/anchors';
import {
  createDocEditorHost,
  ensureEntityMarksOnEditor,
  type DocEditorHost,
} from '@/lib/entity-marks';
import { asPmJson, isBlankPmDoc } from '@/lib/pm-doc';
import { AnchorHighlight } from '@/pages/docs/anchor-highlight';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { createDocExtensions } from './extensions';

const ANCHOR_FLASH_SELECTOR = '[data-card-ids], [data-card-id], .anchor, .anchor-note';

function isInternalAppPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function isHttpUrl(href: string): boolean {
  return /^(https?:)?\/\//i.test(href);
}

function navigateInternalLink(event: MouseEvent, navigate: (to: string) => void): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const a = target.closest('a');
  if (!a) return false;
  const href = a.getAttribute('href');
  if (!href) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  if (isInternalAppPath(href)) {
    if (a.target === '_blank') return false;
    event.preventDefault();
    navigate(href);
    return true;
  }

  if (isHttpUrl(href)) {
    event.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  }
  return false;
}

export const DocView = observer(function DocView({
  source,
  cards = [],
  annotations = [],
  activeCardId = null,
  activeAnnotationId = null,
  focusCardId = null,
  onAnchorClick,
  onAnnotationClick,
  bindHost,
  className,
}: {
  source: unknown;
  cards?: DocumentCard[];
  annotations?: Annotation[];
  activeCardId?: string | null;
  activeAnnotationId?: string | null;
  focusCardId?: string | null;
  onAnchorClick?: (ids: string[]) => void;
  onAnnotationClick?: (ids: string[]) => void;
  bindHost?: (host: DocEditorHost | null) => void;
  className?: string;
}) {
  const assetUrls = useService(AssetUrlsService);
  const navigate = useNavigate();
  const onAnchorClickRef = useRef(onAnchorClick);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const entities = useMemo(() => docEntities(cards, annotations), [cards, annotations]);
  const entitiesRef = useRef(entities);
  const cardsRef = useRef(cards);
  const annotationsRef = useRef(annotations);
  const activeCardIdRef = useRef(activeCardId);
  const activeAnnotationIdRef = useRef(activeAnnotationId);
  const flashedRef = useRef<string | null>(null);
  const sourceRef = useRef<string | null>(null);
  onAnchorClickRef.current = onAnchorClick;
  onAnnotationClickRef.current = onAnnotationClick;
  entitiesRef.current = entities;
  cardsRef.current = cards;
  annotationsRef.current = annotations;
  activeCardIdRef.current = activeCardId;
  activeAnnotationIdRef.current = activeAnnotationId;

  const json = useMemo(() => asPmJson(source), [source]);

  const anchorHighlight = useMemo(
    () =>
      AnchorHighlight.configure({
        getEntities: () => entitiesRef.current,
        getActiveCardId: () => activeCardIdRef.current,
        getActiveAnnotationId: () => activeAnnotationIdRef.current,
        onAnchorClick: (ids) => onAnchorClickRef.current?.(ids),
        onAnnotationClick: (ids) => onAnnotationClickRef.current?.(ids),
      }),
    [],
  );

  const extensions = useMemo(
    () =>
      createDocExtensions({
        editable: false,
        assetUrls,
        anchorHighlight,
      }),
    [anchorHighlight, assetUrls],
  );

  const editor = useEditor({
    editable: false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions,
    content: json,
    editorProps: {
      attributes: {
        spellcheck: 'false',
      },
    },
  });

  const bindHostRef = useRef(bindHost);
  bindHostRef.current = bindHost;
  useLayoutEffect(() => {
    if (!editor) return;
    const host = createDocEditorHost(editor);
    bindHostRef.current?.(host);
    return () => bindHostRef.current?.(null);
  }, [editor]);

  useLayoutEffect(() => {
    if (!editor) return;
    const serialized = JSON.stringify(json);
    if (sourceRef.current !== serialized) {
      sourceRef.current = serialized;
      editor.commands.setContent(json, { emitUpdate: false });
    }
    ensureEntityMarksOnEditor(editor, cardsRef.current, annotationsRef.current);
    editor.commands.updateDecorations('anchorHighlight');
  }, [editor, json, entities, activeCardId, activeAnnotationId, cards, annotations]);

  useLayoutEffect(() => {
    if (!editor || !focusCardId || flashedRef.current === focusCardId) return;
    const root = editor.view.dom;
    const hit = [...root.querySelectorAll(ANCHOR_FLASH_SELECTOR)].find((el) =>
      cardIdsFromAnchor(el).includes(focusCardId),
    );
    if (!(hit instanceof HTMLElement)) return;
    flashedRef.current = focusCardId;
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hit.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    hit.classList.add('is-flash');
    const flashTimer = window.setTimeout(() => hit.classList.remove('is-flash'), 1100);
    return () => window.clearTimeout(flashTimer);
  }, [editor, focusCardId, json, entities]);

  if (isBlankPmDoc(json)) return null;

  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    navigateInternalLink(event.nativeEvent, navigate);
  };

  const rootClass = className ? `doc-view ${className}` : 'doc-view';

  return (
    <div className={rootClass} onClick={onClick}>
      {editor ? <EditorContent editor={editor} /> : null}
    </div>
  );
});
