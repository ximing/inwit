import { describe, expect, it, vi } from 'vitest';
import {
  bindPointerSession,
  pointerDragReleased,
  pointerEventIdentity,
  pointerReleasePoint,
  type PointerSession,
} from './pointer-session';

class FakePointerEvent extends Event {
  pointerId: number;
  pointerType: string;
  buttons: number;
  clientX: number;
  clientY: number;

  constructor(
    type: string,
    init: { pointerId: number; pointerType?: string; buttons?: number; clientX?: number; clientY?: number },
  ) {
    super(type);
    this.pointerId = init.pointerId;
    this.pointerType = init.pointerType ?? 'mouse';
    this.buttons = init.buttons ?? 0;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }
}

describe('pointerDragReleased', () => {
  it('treats a mouse or pen move with no button as a missed pointerup', () => {
    expect(pointerDragReleased('mouse', 0, true)).toBe(true);
    expect(pointerDragReleased('pen', 0, true)).toBe(true);
    expect(pointerDragReleased('', 0, true)).toBe(true);
  });

  it('keeps the drag while the button is down, before any press is seen, and for touch', () => {
    expect(pointerDragReleased('mouse', 1, true)).toBe(false);
    expect(pointerDragReleased('mouse', 0, false)).toBe(false);
    expect(pointerDragReleased('touch', 0, true)).toBe(false);
    expect(pointerDragReleased('touch', 1, true)).toBe(false);
  });
});

describe('pointerReleasePoint', () => {
  it('uses the pointerup coordinates and ignores later moves', () => {
    const last = { x: 10, y: 20 };
    expect(pointerReleasePoint({ type: 'pointerup', clientX: 12, clientY: 22 }, last)).toEqual({
      x: 12,
      y: 22,
    });
    expect(pointerReleasePoint({ type: 'pointermove', clientX: 400, clientY: 500 }, last)).toEqual(last);
    expect(pointerReleasePoint({ type: 'pointercancel', clientX: 0, clientY: 0 }, last)).toEqual(last);
  });
});

describe('pointerEventIdentity', () => {
  it('unwraps a React event so it matches the native event seen on window', () => {
    const native = new Event('pointerup');
    expect(pointerEventIdentity({ nativeEvent: native })).toBe(native);
    expect(pointerEventIdentity(native)).toBe(native);
  });
});

describe('bindPointerSession', () => {
  it('ends on pointerup once, ignores other pointers, and stops listening', () => {
    const target = new EventTarget();
    const session: { current: PointerSession } = {
      current: { move: vi.fn(), up: vi.fn(), cancel: vi.fn(), blur: vi.fn() },
    };
    bindPointerSession(target, 1, session);

    target.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 2, buttons: 1, clientX: 1 }));
    target.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 1, buttons: 1, clientX: 8, clientY: 9 }));
    target.dispatchEvent(new FakePointerEvent('pointerup', { pointerId: 1, clientX: 8, clientY: 9 }));
    target.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 1, buttons: 0, clientX: 30 }));

    expect(session.current.move).toHaveBeenCalledTimes(1);
    expect(session.current.up).toHaveBeenCalledTimes(1);
    expect(session.current.move).toHaveBeenCalledWith(expect.objectContaining({ clientX: 8, buttons: 1 }));
  });

  it('forwards pointercancel and blur, then ignores further moves', () => {
    const target = new EventTarget();
    const session: { current: PointerSession } = {
      current: { move: vi.fn(), up: vi.fn(), cancel: vi.fn(), blur: vi.fn() },
    };
    bindPointerSession(target, 1, session);

    target.dispatchEvent(new FakePointerEvent('pointercancel', { pointerId: 1, clientX: 0, clientY: 0 }));
    target.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 1, buttons: 1 }));
    expect(session.current.cancel).toHaveBeenCalledTimes(1);
    expect(session.current.move).not.toHaveBeenCalled();

    const next: { current: PointerSession } = {
      current: { move: vi.fn(), up: vi.fn(), cancel: vi.fn(), blur: vi.fn() },
    };
    bindPointerSession(target, 1, next);
    target.dispatchEvent(new Event('blur'));
    target.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 1, buttons: 1 }));
    expect(next.current.blur).toHaveBeenCalledTimes(1);
    expect(next.current.move).not.toHaveBeenCalled();
  });
});
