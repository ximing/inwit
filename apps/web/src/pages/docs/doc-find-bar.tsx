import { observer, useService } from '@rabjs/react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { CaseSensitive, ChevronDown, ChevronUp, Replace, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Tip } from '@/components/tip';
import { imeBlocksEnterFromEvent, runAfterImeEnter } from '@/lib/ime-enter';
import {
  clearDocFind,
  mountedEditor,
  publishDocFind,
  readDocFind,
  replaceAllHits,
  replaceCurrentHit,
  scrollFindHitIntoView,
  stepDocFind,
} from './doc-find-plugin';
import { DocFindService } from './doc-find.service';
import { findResultLabel, findSeedFromSelection } from './find-replace-logic';

const ICON = 15;

function looseFocus(event: KeyboardEvent): boolean {
  return event.target === document.body || event.target === document.documentElement;
}

function blockedByDialog(event: KeyboardEvent): boolean {
  const target = event.target;
  if (target instanceof Element && target.closest('[role="dialog"], dialog')) return true;
  return Boolean(document.querySelector('[role="dialog"], dialog'));
}

function inDocumentSurface(event: KeyboardEvent): boolean {
  if (blockedByDialog(event)) return false;
  const target = event.target;
  if (target instanceof Element && target.closest('.ws-pane')) return true;
  return looseFocus(event) && Boolean(document.querySelector('.ws-pane .ProseMirror'));
}

function seedOf(editor: Editor): string | null {
  const { from, to } = editor.state.selection;
  return findSeedFromSelection(editor.state.doc, from, to);
}

export const DocFindController = observer(function DocFindController({
  editor,
  editable,
}: {
  editor: Editor;
  editable: boolean;
}) {
  const find = useService(DocFindService);
  const open = find.open;
  const query = find.query;
  const caseSensitive = find.caseSensitive;
  const live = mountedEditor(editor);

  useLayoutEffect(() => {
    find.attach(live);
    return () => find.detach(live);
  }, [live, find]);

  useLayoutEffect(() => {
    if (live.isDestroyed) return;
    if (!open) {
      clearDocFind(live);
      return;
    }
    const next = publishDocFind(live, query, caseSensitive);
    const hit = next?.hits[0];
    if (!hit || query.length === 0) return;
    const frame = window.requestAnimationFrame(() => scrollFindHitIntoView(live, hit));
    return () => window.cancelAnimationFrame(frame);
  }, [live, open, query, caseSensitive]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process' || live.isDestroyed) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;

      if (event.key === 'Escape' && !mod && !event.altKey) {
        if (!find.open) return;
        const target = event.target;
        if (target instanceof Element && target.closest('[role="dialog"], dialog')) return;
        if (!(target instanceof Element) || !target.closest('.ws-pane')) return;
        event.preventDefault();
        event.stopPropagation();
        find.close();
        return;
      }

      if (event.repeat || event.altKey) return;
      if (!inDocumentSurface(event)) return;

      if (mod && !event.shiftKey && key === 'f') {
        event.preventDefault();
        event.stopPropagation();
        const target = event.target;
        const inBar = target instanceof Element && Boolean(target.closest('.doc-find'));
        find.showFind(inBar ? null : seedOf(live));
        return;
      }

      if (editable && event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'h') {
        event.preventDefault();
        event.stopPropagation();
        find.showReplace(seedOf(live));
        return;
      }

      if (mod && key === 'g' && find.open) {
        event.preventDefault();
        event.stopPropagation();
        stepDocFind(live, event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [live, editable, find]);

  return null;
});

function FindIconButton({
  label,
  pressed,
  disabled,
  onAction,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <Tip content={label}>
      <button
        type="button"
        className={`doc-find-icon${pressed ? ' is-on' : ''}`}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onAction}
      >
        {children}
      </button>
    </Tip>
  );
}

const DocFindPanel = observer(function DocFindPanel({
  editor,
  editable,
}: {
  editor: Editor | null;
  editable: boolean;
}) {
  const find = useService(DocFindService);
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const live = editor ? mountedEditor(editor) : null;
  const snapshot = useEditorState({
    editor: live,
    selector: ({ editor: instance }) => (instance ? readDocFind(instance.state) : null),
  });
  const hits = snapshot?.hits.length ?? 0;
  const label = live ? findResultLabel(snapshot?.index ?? 0, hits, find.query) : '';
  const canStep = hits > 0;
  const showReplace = editable && find.replaceOpen;

  useEffect(() => {
    const el = find.focusTarget === 'replace' && showReplace ? replaceRef.current : findRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, [find.focusGen, find.focusTarget, showReplace]);

  const onFindKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return;
    if (event.key !== 'Enter') return;
    if (imeBlocksEnterFromEvent(event.nativeEvent)) return;
    event.preventDefault();
    if (!live) return;
    const backward = event.shiftKey;
    runAfterImeEnter(event.nativeEvent, () => {
      if (!canStep) return;
      stepDocFind(live, backward ? -1 : 1);
    });
  };

  const onReplaceKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (imeBlocksEnterFromEvent(event.nativeEvent)) return;
    event.preventDefault();
    if (!live || !canStep) return;
    runAfterImeEnter(event.nativeEvent, () => {
      replaceCurrentHit(live, find.replacement);
    });
  };

  return (
    <div className="doc-find" role="search">
      <div className="doc-find-panel">
        <div className="doc-find-row">
          <input
            ref={findRef}
            type="search"
            className="doc-find-input"
            placeholder="查找"
            aria-label="查找"
            spellCheck={false}
            autoComplete="off"
            value={find.query}
            onChange={(event) => find.setQuery(event.target.value)}
            onKeyDown={onFindKey}
          />
          <span className="doc-find-count" aria-live="polite">
            {label}
          </span>
          <FindIconButton label="上一个" disabled={!canStep} onAction={() => live && stepDocFind(live, -1)}>
            <ChevronUp width={ICON} height={ICON} strokeWidth={2} />
          </FindIconButton>
          <FindIconButton label="下一个" disabled={!canStep} onAction={() => live && stepDocFind(live, 1)}>
            <ChevronDown width={ICON} height={ICON} strokeWidth={2} />
          </FindIconButton>
          <FindIconButton label="区分大小写" pressed={find.caseSensitive} onAction={() => find.toggleCase()}>
            <CaseSensitive width={ICON} height={ICON} strokeWidth={2} />
          </FindIconButton>
          {editable ? (
            <FindIconButton
              label={find.replaceOpen ? '收起替换' : '替换'}
              pressed={find.replaceOpen}
              onAction={() => find.toggleReplace()}
            >
              <Replace width={ICON} height={ICON} strokeWidth={2} />
            </FindIconButton>
          ) : null}
          <FindIconButton label="关闭查找" onAction={() => find.close()}>
            <X width={ICON} height={ICON} strokeWidth={2} />
          </FindIconButton>
        </div>
        {showReplace ? (
          <div className="doc-find-row">
            <input
              ref={replaceRef}
              type="text"
              className="doc-find-input"
              placeholder="替换为"
              aria-label="替换为"
              spellCheck={false}
              autoComplete="off"
              value={find.replacement}
              onChange={(event) => find.setReplacement(event.target.value)}
              onKeyDown={onReplaceKey}
            />
            <button
              type="button"
              className="doc-find-text"
              disabled={!canStep}
              onClick={() => live && replaceCurrentHit(live, find.replacement)}
            >
              替换
            </button>
            <button
              type="button"
              className="doc-find-text"
              disabled={!canStep}
              onClick={() => live && replaceAllHits(live, find.replacement)}
            >
              全部替换
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});

export const DocFindBar = observer(function DocFindBar({
  editable,
  editor: editorProp = null,
}: {
  editable: boolean;
  editor?: Editor | null;
}) {
  const find = useService(DocFindService);
  if (!find.open) return null;
  const source = editorProp ?? find.editor;
  return <DocFindPanel editor={source ? mountedEditor(source) : null} editable={editable} />;
});
