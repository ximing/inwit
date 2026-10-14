import { observer, useService } from '@rabjs/react';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DialogService } from '@/services/dialog.service';

const FOCUSABLE = 'input:not(:disabled), button:not(:disabled)';

type ScrollAnchor = { el: HTMLElement; top: number; left: number };

/** Scrollable ancestors of the element that opened the dialog. */
function scrollAnchors(start: Element | null): ScrollAnchor[] {
  const anchors: ScrollAnchor[] = [];
  for (let node = start instanceof HTMLElement ? start : null; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrolls = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflowX}`);
    if (!scrolls) continue;
    anchors.push({ el: node, top: node.scrollTop, left: node.scrollLeft });
  }
  return anchors;
}

function restoreCaret(previous: HTMLElement, saved: Range | null): void {
  if (!saved || !saved.startContainer.isConnected || !previous.contains(saved.startContainer)) return;
  const selection = document.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  try {
    selection.addRange(saved);
  } catch {
    // The editor replaced that text node while the dialog was open.
  }
}

function restoreScroll(anchors: ScrollAnchor[]): void {
  for (const anchor of anchors) {
    if (!anchor.el.isConnected) continue;
    anchor.el.scrollTop = anchor.top;
    anchor.el.scrollLeft = anchor.left;
  }
}

export const AppDialog = observer(function AppDialog() {
  const dialog = useService(DialogService);
  const current = dialog.current;
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!current) return;
    const previous = document.activeElement;
    const selection = document.getSelection();
    const savedRange =
      previous instanceof HTMLElement &&
      selection &&
      selection.rangeCount > 0 &&
      selection.anchorNode &&
      previous.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    // Captured before the dialog takes focus. Closing focuses this element again.
    const anchors = scrollAnchors(previous instanceof Element ? previous : null);
    const panel = panelRef.current;
    const focusTarget =
      current.kind === 'prompt'
        ? panel?.querySelector<HTMLElement>('input')
        : panel?.querySelector<HTMLElement>('button[type="submit"]');
    (focusTarget ?? panel)?.focus();
    if (focusTarget instanceof HTMLInputElement) focusTarget.select();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.cancel();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const elements = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = elements[0];
      const last = elements[elements.length - 1];
      const outside = !panel.contains(document.activeElement);
      if (
        !first ||
        outside ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? (last ?? panel) : (first ?? panel)).focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (!(previous instanceof HTMLElement) || !previous.isConnected) return;
      // A tall contenteditable scrolls its pane to the top when focused, and the caret jumps to the start.
      previous.focus({ preventScroll: true });
      restoreCaret(previous, savedRange);
      restoreScroll(anchors);
      requestAnimationFrame(() => restoreScroll(anchors));
    };
  }, [current, dialog]);

  if (!current) return null;

  const labelledBy = 'app-dialog-title';
  const describedBy = current.message ? 'app-dialog-body' : undefined;

  return createPortal(
    <div
      className="dialog-backdrop app-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.cancel();
      }}
    >
      <div
        ref={panelRef}
        className="dialog"
        role={current.kind === 'prompt' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={labelledBy}>{current.title}</h2>
        {current.message ? (
          <p id="app-dialog-body" className="app-dialog-body">
            {current.message}
          </p>
        ) : null}
        <form
          className={current.kind === 'prompt' ? 'stack-form' : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            dialog.submit();
          }}
        >
          {current.kind === 'prompt' ? (
            <input
              value={dialog.inputValue}
              placeholder={current.placeholder || undefined}
              autoComplete="off"
              aria-label={current.title}
              onChange={(event) => dialog.setInputValue(event.target.value)}
            />
          ) : null}
          <div className="dialog-actions">
            {current.kind === 'prompt' && current.extra ? (
              <button type="button" className="btn btn-ghost app-dialog-extra" onClick={() => dialog.chooseExtra()}>
                {current.extra}
              </button>
            ) : null}
            {current.kind !== 'alert' ? (
              <button type="button" className="btn btn-ghost" onClick={() => dialog.cancel()}>
                {current.cancel}
              </button>
            ) : null}
            <button
              type="submit"
              className={current.danger ? 'btn btn-danger app-dialog-danger' : 'btn btn-primary'}
            >
              {current.ok}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
});
