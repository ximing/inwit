import { describe, expect, it } from 'vitest';
import { nextReviewRevision } from './concept-review-revision-logic.js';

describe('nextReviewRevision', () => {
  it('rotate keeps null and increments 0 and a positive revision', () => {
    expect(nextReviewRevision(null, { reason: 'rotate' })).toBeNull();
    expect(nextReviewRevision(0, { reason: 'rotate' })).toBe(1);
    expect(nextReviewRevision(4, { reason: 'rotate' })).toBe(5);
  });

  it('bind turns null into 1 via (revision ?? 0) + 1', () => {
    expect(nextReviewRevision(null, { reason: 'bind' })).toBe(1);
    expect(nextReviewRevision(0, { reason: 'bind' })).toBe(1);
    expect(nextReviewRevision(4, { reason: 'bind' })).toBe(5);
  });

  it('refresh adds 1 the same way as reviewRevision! + 1', () => {
    // 冲突检查之后才用这个值。null 的结果跟非空断言表达式一致，不是跳过 null 的轮换。
    expect(nextReviewRevision(null, { reason: 'refresh' })).toBe((null as number | null)! + 1);
    expect(nextReviewRevision(0, { reason: 'refresh' })).toBe(0! + 1);
    expect(nextReviewRevision(4, { reason: 'refresh' })).toBe(4! + 1);
    expect(nextReviewRevision(null, { reason: 'refresh' })).not.toBe(
      nextReviewRevision(null, { reason: 'rotate' }),
    );
  });

  it('unbind increments from 0 when revision is null and does not return null', () => {
    expect(nextReviewRevision(null, { reason: 'unbind' })).toBe(1);
    expect(nextReviewRevision(0, { reason: 'unbind' })).toBe(1);
    expect(nextReviewRevision(4, { reason: 'unbind' })).toBe(5);
    expect(nextReviewRevision(null, { reason: 'unbind' })).not.toBeNull();
  });

  it('content-edit leaves null alone and increments only when content or the first question changed', () => {
    expect(
      nextReviewRevision(null, { reason: 'content-edit', changed: true, firstChanged: true }),
    ).toBeNull();
    expect(
      nextReviewRevision(null, { reason: 'content-edit', changed: false, firstChanged: false }),
    ).toBeNull();
    expect(
      nextReviewRevision(0, { reason: 'content-edit', changed: false, firstChanged: false }),
    ).toBe(0);
    expect(
      nextReviewRevision(0, { reason: 'content-edit', changed: true, firstChanged: false }),
    ).toBe(1);
    expect(
      nextReviewRevision(0, { reason: 'content-edit', changed: false, firstChanged: true }),
    ).toBe(1);
    expect(
      nextReviewRevision(4, { reason: 'content-edit', changed: false, firstChanged: false }),
    ).toBe(4);
    expect(
      nextReviewRevision(4, { reason: 'content-edit', changed: true, firstChanged: false }),
    ).toBe(5);
    expect(
      nextReviewRevision(4, { reason: 'content-edit', changed: false, firstChanged: true }),
    ).toBe(5);
    expect(
      nextReviewRevision(4, { reason: 'content-edit', changed: true, firstChanged: true }),
    ).toBe(5);
  });

  it('create ignores the current revision and returns 1', () => {
    expect(nextReviewRevision(null, { reason: 'create' })).toBe(1);
    expect(nextReviewRevision(0, { reason: 'create' })).toBe(1);
    expect(nextReviewRevision(4, { reason: 'create' })).toBe(1);
  });

  it('resume returns the current revision, including null and 0', () => {
    expect(nextReviewRevision(null, { reason: 'resume' })).toBeNull();
    expect(nextReviewRevision(0, { reason: 'resume' })).toBe(0);
    expect(nextReviewRevision(4, { reason: 'resume' })).toBe(4);
  });
});
