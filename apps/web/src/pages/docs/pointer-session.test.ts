import { describe, expect, it, vi } from 'vitest';
import {
  bindPointerSession,
  pointerDragReleased,
  pointerEventIdentity,
  pointerReleasePoint,
  routeMindPointer,
  type MindPointerInput,
  type PointerSession,
} from './pointer-session.js';

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

function route(overrides: Partial<MindPointerInput> & Pick<MindPointerInput, 'phase'>): MindPointerInput {
  return {
    pointerId: 1,
    buttons: 1,
    pointerType: 'mouse',
    sawButton: false,
    nodePointerId: null,
    panPointerId: null,
    marqueePointerId: null,
    linkPointerId: null,
    ...overrides,
  };
}

describe('routeMindPointer', () => {
  it('moves one gesture, node before view before link, and remembers a pressed button', () => {
    expect(
      routeMindPointer(route({ phase: 'move', nodePointerId: 1, panPointerId: 1, linkPointerId: 1 })),
    ).toEqual({ action: 'move', gesture: 'node', sawButton: true });
    expect(routeMindPointer(route({ phase: 'move', panPointerId: 1, linkPointerId: 1 }))).toEqual({
      action: 'move',
      gesture: 'view',
      sawButton: true,
    });
    expect(routeMindPointer(route({ phase: 'move', marqueePointerId: 1, linkPointerId: 1 }))).toEqual({
      action: 'move',
      gesture: 'view',
      sawButton: true,
    });
    expect(routeMindPointer(route({ phase: 'move', linkPointerId: 1 }))).toEqual({
      action: 'move',
      gesture: 'link',
      sawButton: true,
    });
    expect(routeMindPointer(route({ phase: 'move' }))).toEqual({ action: 'ignore', sawButton: true });
  });

  it('releases a buttonless mouse or pen move and does not keep moving', () => {
    expect(
      routeMindPointer(
        route({ phase: 'move', buttons: 0, sawButton: true, pointerType: 'mouse', nodePointerId: 1, panPointerId: 1 }),
      ),
    ).toEqual({ action: 'release', gesture: 'node', sawButton: true });
    expect(
      routeMindPointer(route({ phase: 'move', buttons: 0, sawButton: true, pointerType: 'pen', panPointerId: 1 })),
    ).toEqual({ action: 'release', gesture: 'view', sawButton: true });
  });

  it('does not release touch, or a mouse that has not seen a press, when buttons stay 0', () => {
    expect(
      routeMindPointer(
        route({ phase: 'move', buttons: 0, sawButton: true, pointerType: 'touch', nodePointerId: 1 }),
      ),
    ).toEqual({ action: 'move', gesture: 'node', sawButton: true });
    expect(
      routeMindPointer(route({ phase: 'move', buttons: 0, sawButton: false, pointerType: 'mouse', linkPointerId: 1 })),
    ).toEqual({ action: 'move', gesture: 'link', sawButton: false });
  });

  it('releases on pointerup with node before view before link', () => {
    expect(
      routeMindPointer(route({ phase: 'up', buttons: 0, nodePointerId: 1, panPointerId: 1, linkPointerId: 1 })),
    ).toEqual({ action: 'release', gesture: 'node', sawButton: false });
    expect(routeMindPointer(route({ phase: 'up', buttons: 0, marqueePointerId: 1, linkPointerId: 1 }))).toEqual({
      action: 'release',
      gesture: 'view',
      sawButton: false,
    });
    expect(routeMindPointer(route({ phase: 'up', buttons: 0, linkPointerId: 1 }))).toEqual({
      action: 'release',
      gesture: 'link',
      sawButton: false,
    });
    expect(routeMindPointer(route({ phase: 'up', buttons: 0 }))).toEqual({
      action: 'release',
      gesture: null,
      sawButton: false,
    });
  });

  it('cancels a link stroke instead of releasing it, even when a node drag shares the pointer', () => {
    expect(
      routeMindPointer(route({ phase: 'cancel', buttons: 0, nodePointerId: 1, linkPointerId: 1 })),
    ).toEqual({ action: 'cancel-link', sawButton: false });
    expect(routeMindPointer(route({ phase: 'cancel', buttons: 0, nodePointerId: 1 }))).toEqual({
      action: 'release',
      gesture: 'node',
      sawButton: false,
    });
    expect(routeMindPointer(route({ phase: 'cancel', buttons: 0, panPointerId: 1 }))).toEqual({
      action: 'release',
      gesture: 'view',
      sawButton: false,
    });
  });

  it('on blur finishes the node drag before pan, marquee, or a link', () => {
    expect(
      routeMindPointer(route({ phase: 'blur', buttons: 0, pointerId: 2, nodePointerId: 7, panPointerId: 2 })),
    ).toEqual({ action: 'finish-node', pointerId: 7, sawButton: false });
    expect(routeMindPointer(route({ phase: 'blur', buttons: 0, panPointerId: 4, marqueePointerId: 5 }))).toEqual({
      action: 'finish-view',
      pointerId: 4,
      sawButton: false,
    });
    expect(routeMindPointer(route({ phase: 'blur', buttons: 0, marqueePointerId: 5, linkPointerId: 6 }))).toEqual({
      action: 'finish-view',
      pointerId: 5,
      sawButton: false,
    });
    expect(routeMindPointer(route({ phase: 'blur', buttons: 0, linkPointerId: 6 }))).toEqual({
      action: 'cancel-link',
      sawButton: false,
    });
    expect(routeMindPointer(route({ phase: 'blur', buttons: 0 }))).toEqual({
      action: 'ignore',
      sawButton: false,
    });
  });
});
