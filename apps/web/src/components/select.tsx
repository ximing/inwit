import { ChevronDown } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState } from 'react';

export type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shown when nothing is selected. */
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  'aria-describedby'?: string;
  /** The compose bar sits on the bottom edge, so the menu opens upward. */
  placement?: 'top' | 'bottom';
  align?: 'start' | 'end';
};

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    options,
    onChange,
    disabled = false,
    placeholder = '',
    ariaLabel,
    className,
    'aria-describedby': describedBy,
    placement = 'bottom',
    align = 'start',
  },
  ref,
) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const label = (selectedIndex >= 0 ? options[selectedIndex]?.label : placeholder) ?? '';
  const canOpen = !disabled && options.length > 0;

  function close(): void {
    setOpen(false);
  }

  function openAt(index: number): void {
    if (!canOpen) return;
    setActiveIndex(Math.min(Math.max(index, 0), options.length - 1));
    setOpen(true);
  }

  function choose(next: string): void {
    if (next !== value) onChange(next);
    close();
    buttonRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
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
          else openAt(selectedIndex >= 0 ? selectedIndex : 0);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const start = event.key === 'ArrowUp' ? options.length - 1 : 0;
          openAt(selectedIndex >= 0 ? selectedIndex : start);
        }}
      >
        <span className="select-label">{label}</span>
        <ChevronDown width={12} height={12} strokeWidth={2.2} aria-hidden />
      </button>
      {open ? (
        <div
          id={listId}
          className={`select-menu is-${placement} is-${align}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={[
                option.value === value ? 'is-on' : '',
                index === activeIndex ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex((current) => Math.min(options.length - 1, current + 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex((current) => Math.max(0, current - 1));
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  setActiveIndex(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  setActiveIndex(options.length - 1);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});
