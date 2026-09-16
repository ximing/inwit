import { parseMarkdownToPmJSON } from '@inwit/markdown';
import { observer, useService } from '@rabjs/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { cardIdsFromAnchor, type AnchorSpec } from '@/lib/anchors';
import { AnchorHighlight } from '@/pages/docs/anchor-highlight';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { createDocExtensions } from './extensions';

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const ANCHOR_FLASH_SELECTOR = 'mark.anchor, .anchor-block, .anchor';

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

function contentFromSource(source: string) {
  const json = parseMarkdownToPmJSON(source);
  if (!json.content || json.content.length === 0) return EMPTY_DOC;
  return json;
}

export const DocView = observer(function DocView({
  source,
  anchors = [],
  activeCardId = null,
  activeAnnotationId = null,
  focusCardId = null,
  onAnchorClick,
  onAnnotationClick,
  className,
}: {
  source: string;
  anchors?: AnchorSpec[];
  activeCardId?: string | null;
  activeAnnotationId?: string | null;
  focusCardId?: string | null;
  onAnchorClick?: (ids: string[]) => void;
  onAnnotationClick?: (ids: string[]) => void;
  className?: string;
}) {
  const assetUrls = useService(AssetUrlsService);
  const navigate = useNavigate();
  const onAnchorClickRef = useRef(onAnchorClick);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const anchorsRef = useRef(anchors);
  const activeCardIdRef = useRef(activeCardId);
  const activeAnnotationIdRef = useRef(activeAnnotationId);
  const flashedRef = useRef<string | null>(null);
  const sourceRef = useRef<string | null>(null);
  onAnchorClickRef.current = onAnchorClick;
  onAnnotationClickRef.current = onAnnotationClick;
  anchorsRef.current = anchors;
  activeCardIdRef.current = activeCardId;
  activeAnnotationIdRef.current = activeAnnotationId;

  const anchorHighlight = useMemo(
    () =>
      AnchorHighlight.configure({
        getAnchors: () => anchorsRef.current,
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
    content: contentFromSource(source),
    editorProps: {
      attributes: {
        spellcheck: 'false',
      },
    },
  });

  useLayoutEffect(() => {
    if (!editor) return;
    if (sourceRef.current !== source) {
      sourceRef.current = source;
      editor.commands.setContent(contentFromSource(source), { emitUpdate: false });
    }
    editor.commands.updateDecorations('anchorHighlight');
  }, [editor, source, anchors, activeCardId, activeAnnotationId]);

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
  }, [editor, focusCardId, source, anchors]);

  if (!source) return null;

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
