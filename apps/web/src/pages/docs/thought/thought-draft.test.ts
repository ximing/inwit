import { beforeEach, describe, expect, it } from 'vitest';
import {
  discardThoughtDraft,
  putThoughtDraft,
  resetThoughtDrafts,
  thoughtDraftFor,
  thoughtDraftRevision,
} from './thought-draft';

describe('thought drafts', () => {
  beforeEach(() => {
    resetThoughtDrafts();
  });

  it('keeps each composer slot on its own document', () => {
    putThoughtDraft('rail', 'doc-a', { note: '栏里', image: null });
    putThoughtDraft('float', 'doc-a', { note: '浮层', image: null });
    putThoughtDraft('rail', 'doc-b', { note: '另一篇', image: null });
    expect(thoughtDraftFor('rail', 'doc-a').note).toBe('栏里');
    expect(thoughtDraftFor('float', 'doc-a').note).toBe('浮层');
    expect(thoughtDraftFor('rail', 'doc-b').note).toBe('另一篇');
    expect(thoughtDraftFor('rail', 'doc-c').note).toBe('');
  });

  it('bumps the revision when a draft is discarded', () => {
    const before = putThoughtDraft('float', 'doc-a', { note: '先记着', image: null });
    const after = discardThoughtDraft('float', 'doc-a');
    expect(after).toBeGreaterThan(before);
    expect(thoughtDraftRevision('float', 'doc-a')).toBe(after);
    expect(thoughtDraftFor('float', 'doc-a').note).toBe('');
  });
});
