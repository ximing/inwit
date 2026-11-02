import type { PmDocJson } from '@inwit/dto';
import { describe, expect, it, vi } from 'vitest';
import { cachedBodyDiffers } from './editor-draft-logic.js';

function paragraph(text: string): PmDocJson {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

describe('cachedBodyDiffers', () => {
  it('compares once, then skips while later drafts still replace a dirty body', () => {
    const host = {};
    const saved = paragraph('原文');
    const equal = vi.fn((left: PmDocJson, right: PmDocJson) => left === right || JSON.stringify(left) === JSON.stringify(right));
    expect(cachedBodyDiffers(host, saved, saved, equal)).toBe(false);
    expect(cachedBodyDiffers(host, paragraph('改过'), saved, equal)).toBe(true);
    expect(cachedBodyDiffers(host, paragraph('又改'), saved, equal)).toBe(true);
    expect(equal).toHaveBeenCalledTimes(2);
  });

  it('force-compares an undo back onto the saved body', () => {
    const host = {};
    const saved = paragraph('原文');
    const equal = vi.fn((left: PmDocJson, right: PmDocJson) => JSON.stringify(left) === JSON.stringify(right));
    cachedBodyDiffers(host, paragraph('改过'), saved, equal);
    expect(cachedBodyDiffers(host, paragraph('原文'), saved, equal)).toBe(true);
    expect(cachedBodyDiffers(host, paragraph('原文'), saved, equal, true)).toBe(false);
    expect(cachedBodyDiffers(host, paragraph('再改'), saved, equal)).toBe(true);
    expect(equal).toHaveBeenCalledTimes(3);
  });

  it('compares again when the saved body is replaced', () => {
    const host = {};
    const saved = paragraph('原文');
    const nextSaved = paragraph('已保存');
    const equal = vi.fn((left: PmDocJson, right: PmDocJson) => JSON.stringify(left) === JSON.stringify(right));
    cachedBodyDiffers(host, paragraph('改过'), saved, equal);
    expect(cachedBodyDiffers(host, nextSaved, nextSaved, equal)).toBe(false);
    expect(equal).toHaveBeenCalledTimes(2);
  });
});
