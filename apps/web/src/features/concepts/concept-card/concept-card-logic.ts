/** 概念图信息卡的屏幕定位：纯逻辑，便于单测。 */

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardStage {
  width: number;
  height: number;
}

export type CardSide = 'right' | 'left' | 'bottom' | 'top';

export interface CardPlacement {
  left: number;
  top: number;
  /** 卡片在锚点的哪一侧；小尾巴朝向锚点。 */
  side: CardSide;
  /** 锚点中心落在卡片边缘上的偏移（px），用于定位小尾巴。 */
  caret: number;
}

const MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * 把卡片摆在锚点旁。优先右侧，放不下降级左侧；两侧都放不下（窄屏）降级下方，再不行上方。
 * 另一轴以锚点中心对齐并收进舞台内；caret 指向锚点中心。
 */
export function placeConceptCard(
  anchor: CardRect,
  stage: CardStage,
  card: { width: number; height: number },
  gap = 12,
): CardPlacement {
  const anchorCX = anchor.x + anchor.width / 2;
  const anchorCY = anchor.y + anchor.height / 2;
  const maxLeft = stage.width - card.width - MARGIN;
  const maxTop = stage.height - card.height - MARGIN;

  const rightLeft = anchor.x + anchor.width + gap;
  const leftLeft = anchor.x - gap - card.width;
  const fitsRight = rightLeft <= maxLeft;
  const fitsLeft = leftLeft >= MARGIN;

  let side: CardSide;
  if (fitsRight) side = 'right';
  else if (fitsLeft) side = 'left';
  else {
    const bottomTop = anchor.y + anchor.height + gap;
    side = bottomTop <= maxTop ? 'bottom' : 'top';
  }

  let left: number;
  let top: number;
  let caret: number;
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? rightLeft : leftLeft;
    top = clamp(anchorCY - card.height / 2, MARGIN, maxTop);
    caret = clamp(anchorCY - top, 14, card.height - 14);
  } else {
    left = clamp(anchorCX - card.width / 2, MARGIN, maxLeft);
    top = side === 'bottom' ? anchor.y + anchor.height + gap : anchor.y - gap - card.height;
    caret = clamp(anchorCX - left, 14, card.width - 14);
  }
  return { left, top, side, caret };
}
