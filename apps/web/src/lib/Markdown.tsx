import { useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { useNavigate } from 'react-router';
import { cardIdsFromAnchor, wrapAnchors, type AnchorSpec } from './anchors';

function isInternalAppPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function navigateInternalLink(
  event: MouseEvent,
  navigate: (to: string) => void,
): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const a = target.closest('a');
  if (!a) return false;
  const href = a.getAttribute('href');
  if (!href || !isInternalAppPath(href)) return false;
  if (a.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  event.preventDefault();
  navigate(href);
  return true;
}

const marked = new Marked();
marked.use({
  gfm: true,
  breaks: true,
  async: false,
});

const PURIFY = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['style'],
};

function sanitize(html: string): string {
  return String(DOMPurify.sanitize(html, PURIFY));
}

export function renderMarkdown(source: string): string {
  return sanitize(marked.parse(source, { async: false }));
}

export function renderMarkdownInline(source: string): string {
  return sanitize(marked.parseInline(source, { async: false }));
}

/** Timeline answers longer than this get a collapsed preview +「展开全文」. */
export const ANSWER_FOLD_CHARS = 300;

export function shouldFoldAnswer(text: string): boolean {
  return Array.from(text).length > ANSWER_FOLD_CHARS;
}

export function Markdown({
  source,
  inline = false,
  className,
}: {
  source: string;
  inline?: boolean;
  className?: string;
}) {
  const html = useMemo(
    () => (inline ? renderMarkdownInline(source) : renderMarkdown(source)),
    [inline, source],
  );
  const navigate = useNavigate();
  if (!source) return null;
  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    navigateInternalLink(event.nativeEvent, navigate);
  };
  if (inline) {
    return (
      <span className={className} dangerouslySetInnerHTML={{ __html: html }} onClick={onClick} />
    );
  }
  return (
    <div
      className={className ?? 'md-body'}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={onClick}
    />
  );
}

export function AnchoredMarkdown({
  source,
  anchors,
  activeCardId,
  focusCardId,
  onAnchorClick,
  className,
}: {
  source: string;
  anchors: AnchorSpec[];
  activeCardId?: string | null;
  focusCardId?: string | null;
  onAnchorClick: (cardIds: string[]) => void;
  className?: string;
}) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const rootRef = useRef<HTMLDivElement>(null);
  const onClickRef = useRef(onAnchorClick);
  onClickRef.current = onAnchorClick;
  const flashedRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = html;
    wrapAnchors(root, anchors);
    const onClick = (event: MouseEvent) => {
      if (navigateInternalLink(event, navigateRef.current)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const hit = target.closest('mark.anchor, .anchor-block');
      if (!hit || !root.contains(hit)) return;
      event.preventDefault();
      const ids = cardIdsFromAnchor(hit);
      if (ids.length > 0) onClickRef.current(ids);
    };
    root.addEventListener('click', onClick);

    let flashTimer: number | undefined;
    if (focusCardId && flashedRef.current !== focusCardId) {
      const hit = [...root.querySelectorAll('mark.anchor, .anchor-block')].find((el) =>
        cardIdsFromAnchor(el).includes(focusCardId),
      );
      if (hit instanceof HTMLElement) {
        flashedRef.current = focusCardId;
        const reduce =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        hit.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        hit.classList.add('is-flash');
        flashTimer = window.setTimeout(() => hit.classList.remove('is-flash'), 1100);
      }
    }

    return () => {
      root.removeEventListener('click', onClick);
      if (flashTimer !== undefined) window.clearTimeout(flashTimer);
    };
  }, [html, anchors, focusCardId]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll('mark.anchor, .anchor-block')) {
      const ids = cardIdsFromAnchor(el);
      el.classList.toggle('is-on', Boolean(activeCardId && ids.includes(activeCardId)));
    }
  }, [html, anchors, activeCardId]);

  if (!source) return null;
  return <div ref={rootRef} className={className ?? 'md-body'} />;
}
