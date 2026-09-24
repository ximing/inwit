import { describe, expect, it } from 'vitest';
import { markdownToContentJson } from '../documents/content-json.js';
import { fillStubMarkdown, isPristineFillStub } from './fill-stub-logic.js';

const base = {
  status: 'pending',
  source: 'editor',
  deletedAt: null as Date | string | null,
  cardCount: 0,
  annotationCount: 0,
};

describe('isPristineFillStub', () => {
  const title = '正则化';
  const contentJson = markdownToContentJson(fillStubMarkdown(title));

  it('matches the stub recomputed from the current node title', () => {
    expect(isPristineFillStub({ ...base, contentJson, nodeTitle: title })).toBe(true);
  });

  it('is not pristine after a rename, edit, cards, or a status change', () => {
    expect(isPristineFillStub({ ...base, contentJson, nodeTitle: '改名后' })).toBe(false);
    expect(isPristineFillStub({ ...base, contentJson: { type: 'doc', content: [] }, nodeTitle: title })).toBe(
      false,
    );
    expect(isPristineFillStub({ ...base, contentJson, nodeTitle: title, cardCount: 1 })).toBe(false);
    expect(isPristineFillStub({ ...base, contentJson, nodeTitle: title, annotationCount: 1 })).toBe(false);
    expect(isPristineFillStub({ ...base, contentJson, nodeTitle: title, status: 'digested' })).toBe(false);
    expect(isPristineFillStub({ ...base, contentJson, nodeTitle: title, source: 'import' })).toBe(false);
    expect(
      isPristineFillStub({ ...base, contentJson, nodeTitle: title, deletedAt: '2026-09-24T00:00:00.000Z' }),
    ).toBe(false);
  });
});