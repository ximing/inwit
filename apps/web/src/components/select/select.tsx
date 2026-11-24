import { ChevronDown } from 'lucide-react';
import { forwardRef, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shown when nothing is selected. */
  placeholder?: string;
  ariaLabel: string;
  id?: string;
  className?: string;
  'aria-describedby'?: string;
  /** The compose bar sits on the bottom edge, so the menu opens upward. */
  placement?: 'top' | 'bottom';
  align?: 'start' | 'end';
};

const DIALOG_FOCUSABLE =
  'a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)';

function tabbables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)).filter((element) => {
    if (element.closest('.select-menu')) return false;
    if (element.tabIndex < 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/** Move focus as if Tab closed a native menu. Inside a dialog, wrap like the focus trap. */
function focusAfterMenuTab(trigger: HTMLButtonElement, shift: boolean): void {
  const dialog = trigger.closest<HTMLElement>('[role="dialog"], dialog');
  const elements = tabbables(dialog ?? document.body);
  const index = elements.indexOf(trigger);
  if (index < 0) {
    trigger.focus({ preventScroll: true });
    return;
  }
  const nextIndex = shift ? index - 1 : index + 1;
  if (!dialog) {
    (elements[nextIndex] ?? trigger).focus({ preventScroll: true });
    return;
  }
  const wrapped =
    nextIndex < 0
      ? elements[elements.length - 1]
      : nextIndex >= elements.length
        ? elements[0]
        : elements[nextIndex];
  (wrapped ?? trigger).focus({ preventScroll: true });
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    options,
    onChange,
    disabled = false,
    placeholder = '',
    ariaLabel,
    id,
    className,
    'aria-describedby': describedBy,
    placement = 'bottom',
    align = 'start',
  },
  ref,
) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const label = (selectedIndex >= 0 ? options[selectedIndex]?.label : placeholder) ?? '';
  const canOpen = !disabled && options.some((option) => !option.disabled);

  function enabledIndex(from: number, step: 1 | -1): number {
    if (options.length === 0) return 0;
    let index = from;
    for (let i = 0; i < options.length; i += 1) {
      index = (index + step + options.length) % options.length;
      if (!options[index]?.disabled) return index;
    }
    return from;
  }

  function close(): void {
    setOpen(false);
  }

  function openAt(index: number): void {
    if (!canOpen) return;
    const clamped = Math.min(Math.max(index, 0), options.length - 1);
    setActiveIndex(options[clamped]?.disabled ? enabledIndex(clamped, 1) : clamped);
    setOpen(true);
  }

  function choose(next: string): void {
    if (options.find((option) => option.value === next)?.disabled) return;
    if (next !== value) onChange(next);
    close();
    buttonRef.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const gap = 6;
      const available =
        placement === 'top' ? rect.top - gap - 8 : window.innerHeight - rect.bottom - gap - 8;
      setMenuStyle({
        position: 'fixed',
        zIndex: 1300,
        minWidth: rect.width,
        maxHeight: Math.max(96, Math.min(240, available)),
        ...(placement === 'top'
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
        ...(align === 'end' ? { right: window.innerWidth - rect.right } : { left: rect.left }),
      });
    };
    place();
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, placement, align, options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Capture on window so a dialog Escape / Tab handler does not take the open menu.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const trigger = buttonRef.current;
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      focusAfterMenuTab(trigger, event.shiftKey);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [open, activeIndex]);

  function setButton(node: HTMLButtonElement | null): void {
    buttonRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }

  const rootClass = className ? `select-field ${className}` : 'select-field';

  return (
    <div className={rootClass} ref={rootRef}>
      <button
        ref={setButton}
        id={id}
        type="button"
        className="select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => {
          if (!canOpen) return;
          if (open) close();
          else openAt(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : enabledIndex(-1, 1));
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const start = event.key === 'ArrowUp' ? options.length - 1 : 0;
          openAt(
            selectedIndex >= 0 && !options[selectedIndex]?.disabled
              ? selectedIndex
              : enabledIndex(start === 0 ? -1 : 0, start === 0 ? 1 : -1),
          );
        }}
      >
        <span className="select-label">{label}</span>
        <ChevronDown width={12} height={12} strokeWidth={2.2} aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              className="select-menu"
              role="listbox"
              aria-label={ariaLabel}
              style={menuStyle ?? undefined}
            >
              {options.map((option, index) => (
                <button
                  key={option.value}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  disabled={option.disabled}
                  aria-selected={option.value === value}
                  className={[
                    option.value === value ? 'is-on' : '',
                    index === activeIndex ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onClick={() => choose(option.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setActiveIndex((current) => enabledIndex(current, 1));
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setActiveIndex((current) => enabledIndex(current, -1));
                    } else if (event.key === 'Home') {
                      event.preventDefault();
                      setActiveIndex(enabledIndex(-1, 1));
                    } else if (event.key === 'End') {
                      event.preventDefault();
                      setActiveIndex(enabledIndex(0, -1));
                    }
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
