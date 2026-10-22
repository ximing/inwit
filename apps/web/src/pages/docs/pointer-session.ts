/**
 * 脑图拖动不能只靠节点上的 pointerup。
 * 捕获会在父级 transform（边缘自动平移）或元素被挪走时丢掉；
 * 松开在窗口外、系统吃掉 mouseup、图片原生拖拽触发 pointercancel 时，节点也收不到抬起。
 * 鼠标 pointerId 不变，漏掉的抬起会让之后的 pointermove 继续拖。
 */

export type PointerSessionEvent = {
  pointerId: number;
  pointerType: string;
  buttons: number;
  clientX: number;
  clientY: number;
  type: string;
  nativeEvent?: Event;
};

export type PointerSession = {
  move(event: PointerSessionEvent): void;
  up(event: PointerSessionEvent): void;
  cancel(event: PointerSessionEvent): void;
  blur(): void;
};

/**
 * 触摸的 buttons 在部分浏览器里始终是 0，不能用来判断手指是否还按着。
 * 有的浏览器在按住时也把 move 的 buttons 报成 0；必须先见过按下，再把 0 当成漏掉的 pointerup。
 */
export function pointerDragReleased(
  pointerType: string,
  buttons: number,
  sawButton: boolean,
): boolean {
  if (!sawButton || pointerType === 'touch') return false;
  return buttons === 0;
}

/**
 * pointerup 的坐标就是松开的位置。
 * pointercancel，以及按钮已经松开的 pointermove，坐标经常是 0 或松开之后又滑过的位置，
 * 落点用按住期间最后一次移动。
 */
export function pointerReleasePoint(
  event: { type: string; clientX: number; clientY: number },
  last: { x: number; y: number },
): { x: number; y: number } {
  if (event.type === 'pointerup') return { x: event.clientX, y: event.clientY };
  return { x: last.x, y: last.y };
}

/** React 合成事件和 window 上的原生事件要当成同一次，避免抬起被处理两遍。 */
export function pointerEventIdentity(event: { nativeEvent?: Event } | Event): Event {
  if ('nativeEvent' in event && event.nativeEvent instanceof Event) return event.nativeEvent;
  return event as Event;
}

/**
 * 在捕获阶段听 window（或测试里的 EventTarget）。
 * 返回停止函数；pointerup / pointercancel / blur 会自己停。
 */
export function bindPointerSession(
  target: EventTarget,
  pointerId: number,
  session: { readonly current: PointerSession },
): () => void {
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    target.removeEventListener('pointermove', onMove, true);
    target.removeEventListener('pointerup', onUp, true);
    target.removeEventListener('pointercancel', onCancel, true);
    target.removeEventListener('blur', onBlur);
  };
  const onMove = (event: Event) => {
    if (stopped) return;
    const point = event as PointerSessionEvent & Event;
    if (point.pointerId !== pointerId) return;
    session.current.move(point);
  };
  const onUp = (event: Event) => {
    if (stopped) return;
    const point = event as PointerSessionEvent & Event;
    if (point.pointerId !== pointerId) return;
    stop();
    session.current.up(point);
  };
  const onCancel = (event: Event) => {
    if (stopped) return;
    const point = event as PointerSessionEvent & Event;
    if (point.pointerId !== pointerId) return;
    stop();
    session.current.cancel(point);
  };
  const onBlur = () => {
    if (stopped) return;
    stop();
    session.current.blur();
  };
  target.addEventListener('pointermove', onMove, true);
  target.addEventListener('pointerup', onUp, true);
  target.addEventListener('pointercancel', onCancel, true);
  target.addEventListener('blur', onBlur);
  return stop;
}

export type MindPointerPhase = 'move' | 'up' | 'cancel' | 'blur';

/** 同一次事件只交给一种手势。view 同时覆盖平移和框选。 */
export type MindPointerGesture = 'node' | 'view' | 'link';

export type MindPointerRoute =
  | { action: 'ignore'; sawButton: boolean }
  | { action: 'move'; gesture: MindPointerGesture; sawButton: boolean }
  | { action: 'release'; gesture: MindPointerGesture | null; sawButton: boolean }
  | { action: 'cancel-link'; sawButton: boolean }
  | { action: 'finish-node'; pointerId: number; sawButton: boolean }
  | { action: 'finish-view'; pointerId: number; sawButton: boolean };

export type MindPointerInput = {
  phase: MindPointerPhase;
  pointerId: number;
  buttons: number;
  pointerType: string;
  sawButton: boolean;
  /** 没有这种手势时为 null。 */
  nodePointerId: number | null;
  panPointerId: number | null;
  marqueePointerId: number | null;
  linkPointerId: number | null;
};

function heldGesture(input: MindPointerInput): MindPointerGesture | null {
  const { pointerId } = input;
  if (input.nodePointerId === pointerId) return 'node';
  if (input.panPointerId === pointerId || input.marqueePointerId === pointerId) return 'view';
  if (input.linkPointerId === pointerId) return 'link';
  return null;
}

/**
 * 这次指针事件该交给哪种手势。不改落点，也不结束手势。
 * move 在按钮按下时先把 sawButton 记为真；buttons 为 0 且 pointerDragReleased 时只松开，不再移动。
 * blur 不看传入的 pointerId，按拖节点、平移、框选、关系边的顺序只结束一种。
 */
export function routeMindPointer(input: MindPointerInput): MindPointerRoute {
  const sawButton = input.buttons !== 0 ? true : input.sawButton;
  if (input.phase === 'move') {
    if (pointerDragReleased(input.pointerType, input.buttons, input.sawButton)) {
      return { action: 'release', gesture: heldGesture(input), sawButton };
    }
    const gesture = heldGesture(input);
    if (!gesture) return { action: 'ignore', sawButton };
    return { action: 'move', gesture, sawButton };
  }
  if (input.phase === 'up') {
    return { action: 'release', gesture: heldGesture(input), sawButton };
  }
  if (input.phase === 'cancel') {
    if (input.linkPointerId === input.pointerId) {
      return { action: 'cancel-link', sawButton };
    }
    return { action: 'release', gesture: heldGesture(input), sawButton };
  }
  if (input.nodePointerId !== null) {
    return { action: 'finish-node', pointerId: input.nodePointerId, sawButton };
  }
  if (input.panPointerId !== null) {
    return { action: 'finish-view', pointerId: input.panPointerId, sawButton };
  }
  if (input.marqueePointerId !== null) {
    return { action: 'finish-view', pointerId: input.marqueePointerId, sawButton };
  }
  if (input.linkPointerId !== null) {
    return { action: 'cancel-link', sawButton };
  }
  return { action: 'ignore', sawButton };
}
