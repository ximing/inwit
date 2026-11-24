import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { placeTip, type TipSide } from './tip-logic';

/** 比系统 title 短得多。刚看过一条时，下一条立刻出现。 */
const SHOW_DELAY_MS = 150;
const WARM_MS = 450;

let warmUntil = 0;
let activeId: string | null = null;
const hideListeners = new Set<(id: string) => void>();

function activate(id: string) {
  const previous = activeId;
  activeId = id;
  if (previous && previous !== id) {
    for (const listener of hideListeners) listener(previous);
  }
}

function deactivate(id: string) {
  if (activeId === id) activeId = null;
}

type DomHandlers = {
  ref?: Ref<HTMLElement>;
  disabled?: boolean;
  'aria-describedby'?: string;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  if (ref) (ref as { current: T | null }).current = value;
}

function joinDescribedBy(existing: string | undefined, id: string, open: boolean): string | undefined {
  const parts = (existing ?? '').split(/\s+/).filter((part) => part.length > 0 && part !== id);
  if (open) parts.push(id);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function Tip({
  content,
  side = 'top',
  children,
}: {
  /** 空字符串不提示。 */
  content?: string | null;
  /** 首选方向。贴边时改到放得下的一侧。 */
  side?: TipSide;
  children: ReactElement;
}) {
  const text = typeof content === 'string' ? content.trim() : '';
  const tipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const openRef = useRef(false);
  const childRef = useRef<Ref<HTMLElement> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    if (openRef.current) warmUntil = Date.now() + WARM_MS;
    openRef.current = false;
    setOpen(false);
    deactivate(tipId);
  }, [clearTimer, tipId]);

  const textRef = useRef(text);
  textRef.current = text;

  const show = useCallback(
    (delay: number) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (!textRef.current) return;
        activate(tipId);
        openRef.current = true;
        setOpen(true);
      }, delay);
    },
    [clearTimer, tipId],
  );

  useEffect(() => {
    const onHide = (id: string) => {
      if (id !== tipId) return;
      clearTimer();
      openRef.current = false;
      setOpen(false);
    };
    hideListeners.add(onHide);
    return () => {
      hideListeners.delete(onHide);
      clearTimer();
      deactivate(tipId);
    };
  }, [clearTimer, tipId]);

  useEffect(() => {
    if (text) return;
    hide();
  }, [hide, text]);

  const [anchor, setAnchorState] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!text || !anchor) return;
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (openRef.current) return;
      show(Date.now() < warmUntil ? 0 : SHOW_DELAY_MS);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
      show(0);
    };
    anchor.addEventListener('pointerenter', onEnter);
    anchor.addEventListener('pointerleave', hide);
    anchor.addEventListener('pointerdown', hide);
    anchor.addEventListener('focus', onFocus);
    anchor.addEventListener('blur', hide);
    return () => {
      anchor.removeEventListener('pointerenter', onEnter);
      anchor.removeEventListener('pointerleave', hide);
      anchor.removeEventListener('pointerdown', hide);
      anchor.removeEventListener('focus', onFocus);
      anchor.removeEventListener('blur', hide);
    };
  }, [anchor, hide, show, text]);

  useLayoutEffect(() => {
    if (!open || !text) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const bubble = bubbleRef.current;
      if (!anchor || !bubble) return;
      const rect = anchor.getBoundingClientRect();
      const view = { width: window.innerWidth, height: window.innerHeight };
      const offscreen =
        rect.width === 0 ||
        rect.height === 0 ||
        rect.bottom <= 0 ||
        rect.top >= view.height ||
        rect.right <= 0 ||
        rect.left >= view.width;
      if (offscreen) {
        hide();
        return;
      }
      const next = placeTip(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        side,
        view,
      );
      setPos((current) =>
        current && current.top === next.top && current.left === next.left
          ? current
          : { top: next.top, left: next.left },
      );
    };
    place();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [hide, open, side, text]);

  const setAnchor = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node;
    assignRef(childRef.current, node);
    setAnchorState((current) => (current === node ? current : node));
  }, []);

  if (!text || !isValidElement(children)) return children;

  const child = children as ReactElement<DomHandlers>;
  childRef.current = child.props.ref;
  const describedBy = joinDescribedBy(child.props['aria-describedby'], tipId, open);
  const bubble =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={bubbleRef}
            id={tipId}
            role="tooltip"
            className="tip-bubble"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {text}
          </div>,
          document.body,
        )
      : null;

  // 禁用控件收不到指针事件，包一层才能在悬停时说明为什么不能点。
  // 监听挂在元素自身的 pointerenter 上：移入内部图标不会被当成离开。
  if (child.props.disabled) {
    return (
      <span className="tip-host" ref={setAnchor}>
        {cloneElement(child, { 'aria-describedby': describedBy })}
        {bubble}
      </span>
    );
  }

  return (
    <>
      {cloneElement(child, {
        ref: setAnchor,
        'aria-describedby': describedBy,
      })}
      {bubble}
    </>
  );
}
