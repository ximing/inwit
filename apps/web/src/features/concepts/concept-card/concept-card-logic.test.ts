import { describe, expect, it } from 'vitest';
import { placeConceptCard } from './concept-card-logic';

const stage = { width: 800, height: 600 };
const card = { width: 300, height: 180 };

describe('placeConceptCard', () => {
  it('prefers the right side when it fits', () => {
    const placement = placeConceptCard({ x: 100, y: 200, width: 120, height: 40 }, stage, card);
    expect(placement.side).toBe('right');
    expect(placement.left).toBe(100 + 120 + 12);
    // 垂直方向以锚点中心对齐：220 + 0 - 90 = 130
    expect(placement.top).toBe(130);
    expect(placement.caret).toBe(220 - 130);
  });

  it('flips left when the right side overflows', () => {
    const placement = placeConceptCard({ x: 560, y: 200, width: 120, height: 40 }, stage, card);
    expect(placement.side).toBe('left');
    expect(placement.left).toBe(560 - 12 - 300);
  });

  it('drops below when neither side fits on a narrow stage', () => {
    const narrow = { width: 340, height: 600 };
    const placement = placeConceptCard({ x: 100, y: 100, width: 140, height: 40 }, narrow, card);
    expect(placement.side).toBe('bottom');
    expect(placement.top).toBe(100 + 40 + 12);
    // 水平以锚点中心 170 对齐：170 - 150 = 20
    expect(placement.left).toBe(20);
    expect(placement.caret).toBe(170 - 20);
  });

  it('goes above when below overflows too', () => {
    const narrow = { width: 340, height: 600 };
    const placement = placeConceptCard({ x: 100, y: 500, width: 140, height: 40 }, narrow, card);
    expect(placement.side).toBe('top');
    expect(placement.top).toBe(500 - 12 - 180);
  });

  it('clamps into the stage and keeps the caret on the anchor', () => {
    const placement = placeConceptCard({ x: 100, y: 560, width: 120, height: 40 }, stage, card);
    expect(placement.side).toBe('right');
    // 锚点中心 580，卡片高 180 → top 最多 600-180-8=412
    expect(placement.top).toBe(412);
    // 580-412=168 超出卡片边缘余量，收到 180-14=166
    expect(placement.caret).toBe(166);
  });

  it('clamps the caret inside the card edge', () => {
    const placement = placeConceptCard({ x: 100, y: -60, width: 120, height: 40 }, stage, card);
    expect(placement.top).toBe(8);
    expect(placement.caret).toBeGreaterThanOrEqual(14);
    expect(placement.caret).toBeLessThanOrEqual(card.height - 14);
  });
});
