import { describe, expect, it } from 'vitest';
import { imageLengthPx, MIN_IMAGE_WIDTH_PX, nextImageSize } from '../src/schema/image-resize.js';

describe('imageLengthPx', () => {
  it('reads positive pixel lengths', () => {
    expect(imageLengthPx(320)).toBe(320);
    expect(imageLengthPx(240.4)).toBe(240);
    expect(imageLengthPx('180')).toBe(180);
    expect(imageLengthPx(' 96px ')).toBe(96);
  });

  it('rejects empty, zero, and non-pixel values', () => {
    expect(imageLengthPx(null)).toBeNull();
    expect(imageLengthPx(undefined)).toBeNull();
    expect(imageLengthPx(0)).toBeNull();
    expect(imageLengthPx(-20)).toBeNull();
    expect(imageLengthPx(Number.NaN)).toBeNull();
    expect(imageLengthPx('50%')).toBeNull();
    expect(imageLengthPx('auto')).toBeNull();
    expect(imageLengthPx('')).toBeNull();
  });
});

describe('nextImageSize', () => {
  const base = {
    startWidth: 200,
    startHeight: 100,
    minWidth: MIN_IMAGE_WIDTH_PX,
    maxWidth: 600,
  };

  it('grows and shrinks from the bottom-right corner', () => {
    expect(nextImageSize({ ...base, deltaX: 40, deltaY: 4, corner: 'se' })).toEqual({
      width: 240,
      height: 120,
    });
    expect(nextImageSize({ ...base, deltaX: -50, deltaY: -4, corner: 'se' })).toEqual({
      width: 150,
      height: 75,
    });
  });

  it('inverts the pointer delta for the opposite corners', () => {
    expect(nextImageSize({ ...base, deltaX: -30, deltaY: 0, corner: 'nw' })).toEqual({
      width: 230,
      height: 115,
    });
    expect(nextImageSize({ ...base, deltaX: 20, deltaY: 0, corner: 'sw' })).toEqual({
      width: 180,
      height: 90,
    });
    expect(nextImageSize({ ...base, deltaX: -16, deltaY: 0, corner: 'ne' })).toEqual({
      width: 184,
      height: 92,
    });
  });

  it('uses the vertical axis when that movement is larger', () => {
    expect(nextImageSize({ ...base, deltaX: 10, deltaY: 50, corner: 'se' })).toEqual({
      width: 300,
      height: 150,
    });
    expect(nextImageSize({ ...base, deltaX: 4, deltaY: -20, corner: 'ne' })).toEqual({
      width: 240,
      height: 120,
    });
  });

  it('keeps the start ratio when the width is clamped', () => {
    expect(nextImageSize({ ...base, deltaX: 2000, deltaY: 0, corner: 'se', maxWidth: 300 })).toEqual({
      width: 300,
      height: 150,
    });
    expect(nextImageSize({ ...base, deltaX: -500, deltaY: 0, corner: 'se', minWidth: 48 })).toEqual({
      width: 48,
      height: 24,
    });
    expect(nextImageSize({ ...base, deltaX: 10, deltaY: 0, corner: 'se', maxWidth: 40, minWidth: 48 })).toEqual({
      width: 40,
      height: 20,
    });
  });

  it('returns a positive box when the start size is empty', () => {
    expect(nextImageSize({ ...base, startWidth: 0, startHeight: 0, deltaX: 10, deltaY: 10, corner: 'se' })).toEqual({
      width: 1,
      height: 1,
    });
  });
});
