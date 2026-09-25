import type { PmDocJson } from '@inwit/dto';
import { Editor } from '@tiptap/core';
import { AssetMap } from './asset-map';
import { emitEvent, installBridge } from './bridge';
import {
  errorPayloadFromUnknown,
  type AnnotationAnchorInput,
  type CardAnchorInput,
  type DocEngineCommand,
  type FormatState,
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
const DOC_CHANGED_DEBOUNCE_MS = 300;
const FORMAT_STATE_DEBOUNCE_MS = 50;
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

function textAlignOf(editor: Editor): FormatState['textAlign'] {
  if (editor.isActive({ textAlign: 'center' })) return 'center';
  if (editor.isActive({ textAlign: 'right' })) return 'right';
  return 'left';
}

function historyAvailable(editor: Editor, name: 'undo' | 'redo'): boolean {
  try {
    const probe = editor.can() as Partial<Record<'undo' | 'redo', () => boolean>>;
    const command = probe[name];
    if (typeof command !== 'function') return false;
    return command() === true;
  } catch {
    return false;
  }
}

function applyFormat(editor: Editor, payload: Extract<DocEngineCommand, { type: 'format' }>['payload']): void {
  const href = typeof payload.href === 'string' ? payload.href.trim() : '';
  const src = typeof payload.src === 'string' ? payload.src : '';
  const chain = editor.chain().focus();
  switch (payload.name) {
    case 'bold':
      chain.toggleBold().run();
      return;
    case 'italic':
      chain.toggleItalic().run();
      return;
    case 'strike':
      chain.toggleStrike().run();
      return;
    case 'heading1':
    case 'heading2': {
      const level = payload.name === 'heading1' ? 1 : 2;
      if (editor.isActive('heading', { level })) chain.setParagraph().run();
      else chain.toggleHeading({ level }).run();
      return;
    }
    case 'bulletList':
      chain.toggleBulletList().run();
      return;
    case 'orderedList':
      chain.toggleOrderedList().run();
      return;
    case 'taskList':
      chain.toggleTaskList().run();
      return;
    case 'blockquote':
      chain.toggleBlockquote().run();
      return;
    case 'codeBlock':
      chain.toggleCodeBlock().run();
      return;
    case 'alignLeft':
      chain.unsetTextAlign().run();
      return;
    case 'alignCenter':
      chain.setTextAlign('center').run();
      return;
    case 'alignRight':
      chain.setTextAlign('right').run();
      return;
    case 'link':
      if (href.length > 0) chain.extendMarkRange('link').setLink({ href }).run();
      else if (editor.isActive('link')) chain.extendMarkRange('link').unsetLink().run();
      else chain.run();
      return;
    case 'unsetLink':
      chain.extendMarkRange('link').unsetLink().run();
      return;
    case 'image':
      if (src.length > 0) chain.setImage({ src }).run();
      else chain.run();
      return;
    case 'horizontalRule':
      chain.setHorizontalRule().run();
      return;
    case 'table':
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      return;
    case 'undo':
      chain.undo().run();
      return;
    case 'redo':
      chain.redo().run();
      return;
    default: {
      const _never: never = payload.name;
      return _never;
    }
  }
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
  let editable = false;
  let applyingContent = false;
  let alive = true;
  let selectionTimer: number | undefined;
  let flashTimer: number | undefined;
  let docChangedTimer: number | undefined;
  let docChangedLeading = false;
  let formatStateTimer: number | undefined;

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

  const readFormatState = (): FormatState => ({
    editable,
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    heading1: editor.isActive('heading', { level: 1 }),
    heading2: editor.isActive('heading', { level: 2 }),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    blockquote: editor.isActive('blockquote'),
    codeBlock: editor.isActive('codeBlock'),
    link: editor.isActive('link'),
    table: editor.isActive('table'),
    textAlign: textAlignOf(editor),
    canUndo: historyAvailable(editor, 'undo'),
    canRedo: historyAvailable(editor, 'redo'),
  });

  const emitFormatStateNow = (): void => {
    if (formatStateTimer !== undefined) {
      window.clearTimeout(formatStateTimer);
      formatStateTimer = undefined;
    }
    if (!alive) return;
    emitEvent({ type: 'formatState', payload: readFormatState() });
  };

  const scheduleFormatState = (): void => {
    if (!alive) return;
    if (formatStateTimer !== undefined) window.clearTimeout(formatStateTimer);
    formatStateTimer = window.setTimeout(() => {
      formatStateTimer = undefined;
      if (!alive) return;
      emitEvent({ type: 'formatState', payload: readFormatState() });
    }, FORMAT_STATE_DEBOUNCE_MS);
  };

  const scheduleDocChanged = (): void => {
    if (!alive || !editable) return;
    // Leading edge so a poll cannot replace the body before the debounce fires.
    if (!docChangedLeading) {
      docChangedLeading = true;
      emitEvent({ type: 'docChanged' });
    }
    if (docChangedTimer !== undefined) window.clearTimeout(docChangedTimer);
    docChangedTimer = window.setTimeout(() => {
      docChangedTimer = undefined;
      docChangedLeading = false;
      if (!alive || !editable) return;
      emitEvent({ type: 'docChanged' });
    }, DOC_CHANGED_DEBOUNCE_MS);
  };

  const applyContent = (doc: unknown): void => {
    applyingContent = true;
    try {
      const serialized = JSON.stringify(doc);
      if (contentKey !== serialized) {
        contentKey = serialized;
        editor.commands.setContent(doc as Parameters<Editor['commands']['setContent']>[0], {
          emitUpdate: false,
        });
      }
      syncEntities();
    } finally {
      applyingContent = false;
    }
  };

  const setEditing = (next: boolean): void => {
    if (!next && docChangedTimer !== undefined) {
      window.clearTimeout(docChangedTimer);
      docChangedTimer = undefined;
      docChangedLeading = false;
      emitEvent({ type: 'docChanged' });
    }
    editable = next;
    opts.element.classList.toggle('is-editable', next);
    if (selectionTimer !== undefined) {
      window.clearTimeout(selectionTimer);
      selectionTimer = undefined;
    }
    toolbar.hidden = true;
    if (next) {
      editor.setEditable(true);
      editor.commands.focus('end');
    } else {
      editor.commands.blur();
      editor.setEditable(false);
    }
    emitFormatStateNow();
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
        if (editable) emitFormatStateNow();
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
      case 'setEditable':
        setEditing(cmd.payload.editable);
        return;
      case 'getDoc': {
        const doc = editor.getJSON() as PmDocJson;
        emitEvent({ type: 'docJson', payload: { requestId: cmd.payload.requestId, doc } });
        return;
      }
      case 'format':
        applyFormat(editor, cmd.payload);
        scheduleFormatState();
        return;
      default: {
        const _never: never = cmd;
        return _never;
      }
    }
  };

  editor.on('transaction', ({ transaction, appendedTransactions }) => {
    if (!editable || applyingContent) return;
    if (transaction.getMeta('preventUpdate')) return;
    const docChanged = transaction.docChanged || appendedTransactions.some((item) => item.docChanged);
    if (docChanged) scheduleDocChanged();
    scheduleFormatState();
  });

  const { dispatch } = installBridge((cmd) => {
    try {
      handleCommand(cmd);
    } catch (err) {
      emitEvent({ type: 'error', payload: errorPayloadFromUnknown(err) });
    }
  });

  const onSelectionChange = (): void => {
    if (editable) {
      toolbar.hidden = true;
      if (selectionTimer !== undefined) {
        window.clearTimeout(selectionTimer);
        selectionTimer = undefined;
      }
      scheduleFormatState();
      return;
    }
    if (selectionTimer !== undefined) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      if (editable) {
        toolbar.hidden = true;
        return;
      }
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
    if (editable) return;
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
      alive = false;
      document.removeEventListener('selectionchange', onSelectionChange);
      opts.element.removeEventListener('click', onLinkClick);
      document.removeEventListener('contextmenu', onContextMenu);
      if (selectionTimer !== undefined) window.clearTimeout(selectionTimer);
      if (flashTimer !== undefined) window.clearTimeout(flashTimer);
      if (docChangedTimer !== undefined) window.clearTimeout(docChangedTimer);
      if (formatStateTimer !== undefined) window.clearTimeout(formatStateTimer);
      toolbar.remove();
      editor.destroy();
    },
  };
}
