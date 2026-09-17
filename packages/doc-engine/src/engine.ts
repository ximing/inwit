import { Editor } from '@tiptap/core';
import { AssetMap } from './asset-map';
import { emitEvent, installBridge } from './bridge';
import {
  errorPayloadFromUnknown,
  type AnnotationAnchorInput,
  type CardAnchorInput,
  type DocEngineCommand,
  type SelectionAction,
  type TextSelectionAnchor,
  type ThemeName,
  type ViewportRect,
} from './protocol';
import { applyTheme } from './theme';
import { AnchorHighlight } from './vendor/anchor-highlight';
import { cardIdsFromAnchor, docEntities, type EntityMeta } from './vendor/anchors';
import {
  ensureEntityMarksOnEditor,
  selectionAnchorFromEditor,
} from './vendor/entity-marks';
import { createDocExtensions } from './vendor/extensions';

const ANCHOR_FLASH_SELECTOR = '[data-card-ids], [data-card-id], .anchor, .anchor-note';
const SELECTION_DEBOUNCE_MS = 150;
const FLASH_MS = 1100;

const ACTIONS: Array<{ action: SelectionAction; label: string }> = [
  { action: 'annotate', label: '批注' },
  { action: 'card', label: '写卡' },
  { action: 'digest', label: 'AI 消化' },
];

export type DocEngine = {
  dispatch: (raw: unknown) => void;
  destroy: () => void;
};

function selectionRect(): ViewportRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  try {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  } catch {
    return null;
  }
}

function createSelectionToolbar(onAction: (action: SelectionAction) => void): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'sel-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '划选动作');
  bar.hidden = true;
  for (const item of ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sel-toolbar-btn';
    btn.textContent = item.label;
    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onAction(item.action);
    });
    bar.append(btn);
  }
  document.body.append(bar);
  return bar;
}

function placeToolbar(bar: HTMLDivElement, rect: ViewportRect): void {
  bar.hidden = false;
  const gap = 8;
  const measured = bar.getBoundingClientRect();
  let top = rect.y - measured.height - gap;
  if (top < 8) top = rect.y + rect.height + gap;
  let left = rect.x + rect.width / 2 - measured.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - measured.width - 8));
  bar.style.top = `${top}px`;
  bar.style.left = `${left}px`;
}

function refreshDecorations(editor: Editor): void {
  const commands = editor.commands as unknown as { updateDecorations?: (name: string) => boolean };
  commands.updateDecorations?.('anchorHighlight');
}

export function createDocEngine(opts: { element: HTMLElement }): DocEngine {
  applyTheme('light');

  const entitiesRef: { current: EntityMeta[] } = { current: [] };
  const activeCardIdRef: { current: string | null } = { current: null };
  const activeAnnotationIdRef: { current: string | null } = { current: null };
  let cards: CardAnchorInput[] = [];
  let annotations: AnnotationAnchorInput[] = [];
  let contentKey: string | null = null;
  let theme: ThemeName = 'light';
  let lastAnchor: TextSelectionAnchor | null = null;
  let selectionTimer: number | undefined;
  let flashTimer: number | undefined;

  const assetMap = new AssetMap((srcs) => {
    emitEvent({ type: 'assetNeeded', payload: { srcs } });
  });

  const anchorHighlight = AnchorHighlight.configure({
    getEntities: () => entitiesRef.current,
    getActiveCardId: () => activeCardIdRef.current,
    getActiveAnnotationId: () => activeAnnotationIdRef.current,
    onAnchorClick: (cardIds) => {
      emitEvent({ type: 'anchorClick', payload: { cardIds } });
    },
    onAnnotationClick: (annotationIds) => {
      emitEvent({ type: 'annotationClick', payload: { annotationIds } });
    },
  });

  const editor = new Editor({
    element: opts.element,
    editable: false,
    extensions: createDocExtensions({
      editable: false,
      assetUrls: assetMap,
      anchorHighlight,
    }),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        spellcheck: 'false',
      },
    },
  });

  const toolbar = createSelectionToolbar((action) => {
    const anchor = lastAnchor ?? selectionAnchorFromEditor(editor);
    if (!anchor) return;
    emitEvent({ type: 'selectionAction', payload: { action, anchor } });
    window.getSelection()?.removeAllRanges();
    lastAnchor = null;
    toolbar.hidden = true;
    emitEvent({ type: 'selectionChange', payload: { anchor: null, rect: null } });
  });

  const syncEntities = (): void => {
    entitiesRef.current = docEntities(
      cards,
      annotations.map((note) => ({
        id: note.id,
        kind: note.kind,
        note: note.quote,
      })),
    );
    ensureEntityMarksOnEditor(editor, cards, annotations);
    refreshDecorations(editor);
  };

  const applyContent = (doc: unknown): void => {
    const serialized = JSON.stringify(doc);
    if (contentKey !== serialized) {
      contentKey = serialized;
      editor.commands.setContent(doc as Parameters<Editor['commands']['setContent']>[0], {
        emitUpdate: false,
      });
    }
    syncEntities();
  };

  const focusCard = (cardId: string): void => {
    const root = editor.view.dom;
    const hit = [...root.querySelectorAll(ANCHOR_FLASH_SELECTOR)].find((el) =>
      cardIdsFromAnchor(el).includes(cardId),
    );
    if (!(hit instanceof HTMLElement)) return;
    if (flashTimer !== undefined) window.clearTimeout(flashTimer);
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hit.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    hit.classList.add('is-flash');
    flashTimer = window.setTimeout(() => hit.classList.remove('is-flash'), FLASH_MS);
  };

  const handleCommand = (cmd: DocEngineCommand): void => {
    switch (cmd.type) {
      case 'init':
        theme = cmd.payload.theme;
        applyTheme(theme, cmd.payload.platform);
        return;
      case 'setContent':
        applyContent(cmd.payload.doc);
        return;
      case 'setEntities':
        cards = cmd.payload.cards;
        annotations = cmd.payload.annotations;
        syncEntities();
        return;
      case 'setActiveEntity':
        if (cmd.payload.kind === 'card') activeCardIdRef.current = cmd.payload.id;
        else activeAnnotationIdRef.current = cmd.payload.id;
        refreshDecorations(editor);
        return;
      case 'focusCard':
        focusCard(cmd.payload.cardId);
        return;
      case 'injectAssetUrls':
        assetMap.inject(cmd.payload.urls);
        return;
      case 'setTheme':
        theme = cmd.payload.theme;
        applyTheme(theme);
        return;
    }
  };

  const { dispatch } = installBridge((cmd) => {
    try {
      handleCommand(cmd);
    } catch (err) {
      emitEvent({ type: 'error', payload: errorPayloadFromUnknown(err) });
    }
  });

  const onSelectionChange = (): void => {
    if (selectionTimer !== undefined) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      const sel = window.getSelection();
      const inside =
        Boolean(sel) &&
        Boolean(sel?.anchorNode) &&
        editor.view.dom.contains(sel!.anchorNode as Node);
      if (!inside || !sel || sel.isCollapsed) {
        if (lastAnchor !== null) {
          lastAnchor = null;
          toolbar.hidden = true;
          emitEvent({ type: 'selectionChange', payload: { anchor: null, rect: null } });
        } else {
          toolbar.hidden = true;
        }
        return;
      }
      const anchor = selectionAnchorFromEditor(editor);
      const rect = selectionRect();
      lastAnchor = anchor;
      if (anchor && rect) placeToolbar(toolbar, rect);
      else toolbar.hidden = true;
      emitEvent({ type: 'selectionChange', payload: { anchor, rect } });
    }, SELECTION_DEBOUNCE_MS);
  };

  const onLinkClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const a = target.closest('a');
    if (!a || !opts.element.contains(a)) return;
    if (a.classList.contains('sel-toolbar-btn')) return;
    const href = a.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    emitEvent({ type: 'linkClick', payload: { href } });
  };

  const onContextMenu = (event: Event): void => {
    if (opts.element.contains(event.target as Node)) event.preventDefault();
  };

  document.addEventListener('selectionchange', onSelectionChange);
  opts.element.addEventListener('click', onLinkClick);
  document.addEventListener('contextmenu', onContextMenu);

  emitEvent({ type: 'ready' });

  return {
    dispatch,
    destroy: () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      opts.element.removeEventListener('click', onLinkClick);
      document.removeEventListener('contextmenu', onContextMenu);
      if (selectionTimer !== undefined) window.clearTimeout(selectionTimer);
      if (flashTimer !== undefined) window.clearTimeout(flashTimer);
      toolbar.remove();
      editor.destroy();
    },
  };
}
