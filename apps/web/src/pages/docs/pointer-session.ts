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
