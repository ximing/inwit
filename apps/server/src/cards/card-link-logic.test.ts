import { describe, expect, it } from 'vitest';
import { checkNewCardLink } from './card-link-logic.js';

const existing = [
  { fromCardId: 'a', toCardId: 'b', type: 'related' as const },
  { fromCardId: 'a', toCardId: 'b', type: 'confusable' as const },
];

describe('checkNewCardLink', () => {
  it('rejects a self loop', () => {
    expect(checkNewCardLink('a', 'a', 'related', [])).toEqual({
      ok: false,
      code: 'CARD_LINK_SELF',
    });
  });

  it('rejects a duplicate (from, to, type)', () => {
    expect(checkNewCardLink('a', 'b', 'related', existing)).toEqual({
      ok: false,
      code: 'CARD_LINK_EXISTS',
    });
  });

  it('allows a different type on the same pair and the reverse direction', () => {
    expect(checkNewCardLink('a', 'b', 'prerequisite', existing)).toEqual({ ok: true });
    expect(checkNewCardLink('b', 'a', 'related', existing)).toEqual({ ok: true });
    expect(checkNewCardLink('a', 'c', 'related', existing)).toEqual({ ok: true });
  });
});
