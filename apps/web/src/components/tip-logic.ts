export type TipSide = 'top' | 'bottom' | 'left' | 'right';

export type TipRect = { top: number; left: number; width: number; height: number };

export type TipSize = { width: number; height: number };

const OPPOSITE: Record<TipSide, TipSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

const FALLBACK: TipSide[] = ['top', 'bottom', 'right', 'left'];

function sideOrder(preferred: TipSide): TipSide[] {
  const order: TipSide[] = [];
  for (const side of [preferred, OPPOSITE[preferred], ...FALLBACK]) {
    if (!order.includes(side)) order.push(side);
  }
  return order;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function unclamped(side: TipSide, anchor: TipRect, tip: TipSize, gap: number): { top: number; left: number } {
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  switch (side) {
    case 'top':
      return { top: anchor.top - gap - tip.height, left: cx - tip.width / 2 };
    case 'bottom':
      return { top: anchor.top + anchor.height + gap, left: cx - tip.width / 2 };
    case 'left':
      return { top: cy - tip.height / 2, left: anchor.left - gap - tip.width };
    case 'right':
      return { top: cy - tip.height / 2, left: anchor.left + anchor.width + gap };
  }
}

/** 主轴放得下才算这个方向可用。交叉轴只平移，不因此换边。 */
function mainAxisFits(
  side: TipSide,
  raw: { top: number; left: number },
  tip: TipSize,
  viewport: TipSize,
  pad: number,
): boolean {
  if (side === 'top' || side === 'bottom') {
    return raw.top >= pad && raw.top + tip.height <= viewport.height - pad;
  }
  return raw.left >= pad && raw.left + tip.width <= viewport.width - pad;
}

export function placeTip(
  anchor: TipRect,
  tip: TipSize,
  preferred: TipSide,
  viewport: TipSize,
  gap = 6,
  pad = 8,
): { top: number; left: number; side: TipSide } {
  for (const side of sideOrder(preferred)) {
    const raw = unclamped(side, anchor, tip, gap);
    if (!mainAxisFits(side, raw, tip, viewport, pad)) continue;
    const top =
      side === 'left' || side === 'right'
        ? clamp(raw.top, pad, viewport.height - tip.height - pad)
        : raw.top;
    const left =
      side === 'top' || side === 'bottom'
        ? clamp(raw.left, pad, viewport.width - tip.width - pad)
        : raw.left;
    return { top: Math.round(top), left: Math.round(left), side };
  }

  const raw = unclamped(preferred, anchor, tip, gap);
  return {
    side: preferred,
    top: Math.round(clamp(raw.top, pad, viewport.height - tip.height - pad)),
    left: Math.round(clamp(raw.left, pad, viewport.width - tip.width - pad)),
  };
}
