import type { ReviewQueueItem } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { applyRemoveCurrent, type SessionState } from './review-session-logic';

function item(id: string): ReviewQueueItem {
  return { card: { id } } as ReviewQueueItem;
}

describe('applyRemoveCurrent', () => {
  it('drops the current card without a grade or an extra review', () => {
    const state: SessionState = {
      items: [item('a'), item('b')],
      reviewedToday: 2,
      total: 5,
      flipped: true,
      lastFeedback: 'forgot',
    };
    expect(applyRemoveCurrent(state)).toEqual({
      items: [item('b')],
      reviewedToday: 2,
      total: 4,
      flipped: false,
      lastFeedback: null,
    });
  });

  it('leaves an empty queue unchanged', () => {
    const state: SessionState = {
      items: [],
      reviewedToday: 1,
      total: 1,
      flipped: false,
      lastFeedback: null,
    };
    expect(applyRemoveCurrent(state)).toEqual(state);
  });
});
