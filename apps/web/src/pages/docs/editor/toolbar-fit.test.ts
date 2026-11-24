import { expect, it } from 'vitest';
import { toolbarFitCount, toolbarOverflowRange } from './toolbar-fit';

const gap = 2;
const more = 30;

it('keeps every item when the row fits', () => {
  const items = [{ width: 30 }, { width: 30 }, { width: 30 }];
  expect(toolbarFitCount(items, 30 * 3 + gap * 2, more, gap)).toBe(3);
  expect(toolbarFitCount(items, 0, more, gap)).toBe(3);
  expect(toolbarFitCount([], 100, more, gap)).toBe(0);
});

it('reserves the more button and collapses from the end', () => {
  const items = [{ width: 30 }, { width: 30 }, { width: 40 }];
  expect(toolbarFitCount(items, 30 + gap + more, more, gap)).toBe(1);
  expect(toolbarFitCount(items, 30 + gap + more - 1, more, gap)).toBe(0);
  expect(toolbarFitCount(items, 30 + gap + 30 + gap + more, more, gap)).toBe(2);
  expect(toolbarFitCount(items, 30 + gap + 30 + gap + 40, more, gap)).toBe(3);
});

it('includes separator margins and drops a trailing separator without 更多', () => {
  const items = [
    { width: 30 },
    { width: 1, margin: 12, separator: true },
  ];
  expect(toolbarFitCount(items, 40, more, gap)).toBe(1);
  expect(toolbarOverflowRange(items, 1)).toEqual({ start: 1, end: 1 });
});

it('does not leave a separator on the cut', () => {
  const items = [
    { width: 30 },
    { width: 1, margin: 12, separator: true },
    { width: 30 },
    { width: 1, margin: 12, separator: true },
    { width: 30 },
  ];
  const fit = toolbarFitCount(items, 30 + gap + more, more, gap);
  expect(fit).toBe(1);
  expect(items[fit - 1]?.separator).toBeFalsy();
  expect(toolbarOverflowRange(items, fit)).toEqual({ start: 2, end: 5 });
});

it('strips separators that would open or close the menu alone', () => {
  const items = [
    { separator: true },
    {},
    { separator: true },
    {},
    { separator: true },
  ];
  expect(toolbarOverflowRange(items, 0)).toEqual({ start: 1, end: 4 });
  expect(toolbarOverflowRange(items, items.length)).toEqual({ start: 5, end: 5 });
});
