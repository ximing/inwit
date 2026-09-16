import { SCREENSHOT_MAX_BYTES } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  defaultScreenshotTitle,
  isOcrImageMime,
  isScreenshotSourceKey,
  scaleToPixelBudget,
  screenshotSourceKey,
  validateScreenshotUpload,
} from './screenshot-logic.js';

const USER = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';

describe('validateScreenshotUpload', () => {
  it('accepts png/jpeg/webp within the size cap', () => {
    expect(validateScreenshotUpload('image/png', 1024)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(validateScreenshotUpload('image/jpeg; charset=binary', 2048)).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
    expect(validateScreenshotUpload('image/webp', SCREENSHOT_MAX_BYTES)).toEqual({
      mime: 'image/webp',
      ext: 'webp',
    });
  });

  it('rejects empty, oversized, or unknown types', () => {
    expect(() => validateScreenshotUpload('image/png', 0)).toThrow();
    expect(() => validateScreenshotUpload('image/png', SCREENSHOT_MAX_BYTES + 1)).toThrow();
    expect(() => validateScreenshotUpload('image/gif', 1024)).toThrow();
  });
});

describe('screenshot keys', () => {
  it('builds and accepts source.{ext} under the document prefix', () => {
    const key = screenshotSourceKey(USER, DOC, 'png');
    expect(key).toBe(`docs/${USER}/${DOC}/source.png`);
    expect(isScreenshotSourceKey(key, USER, DOC)).toBe(true);
    expect(isScreenshotSourceKey(`docs/${USER}/${DOC}/source.pdf`, USER, DOC)).toBe(false);
    expect(isScreenshotSourceKey(`docs/${USER}/other/source.png`, USER, DOC)).toBe(false);
  });
});

describe('isOcrImageMime', () => {
  it('matches screenshot image types', () => {
    expect(isOcrImageMime('image/png')).toBe(true);
    expect(isOcrImageMime('image/jpeg; charset=binary')).toBe(true);
    expect(isOcrImageMime('application/pdf')).toBe(false);
    expect(isOcrImageMime(null)).toBe(false);
  });
});

describe('scaleToPixelBudget', () => {
  it('leaves small images unchanged and shrinks huge ones', () => {
    expect(scaleToPixelBudget(800, 600, 8_388_608)).toEqual({ width: 800, height: 600 });
    const scaled = scaleToPixelBudget(8000, 6000, 8_388_608);
    expect(scaled.width * scaled.height).toBeLessThanOrEqual(8_388_608);
    expect(scaled.width).toBeGreaterThan(1);
    expect(scaled.height).toBeGreaterThan(1);
  });
});

describe('defaultScreenshotTitle', () => {
  it('uses a local timestamp', () => {
    const title = defaultScreenshotTitle(new Date('2026-09-16T14:05:00'));
    expect(title.startsWith('截图 ')).toBe(true);
    expect(title.length).toBeGreaterThan(8);
  });
});
