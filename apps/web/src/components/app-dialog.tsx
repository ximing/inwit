import { observer, useService } from '@rabjs/react';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DialogService } from '@/services/dialog.service';

const FOCUSABLE = 'input:not(:disabled), button:not(:disabled)';

export const AppDialog = observer(function AppDialog() {
  const dialog = useService(DialogService);
  const current = dialog.current;
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!current) return;
    const previous = document.activeElement;
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
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
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
