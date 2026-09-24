import { rejectCardInputSchema } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  codePointsAtMost,
  decideCardAcceptance,
  normalizeRejectReason,
  planSearchBackfill,
  shouldIndexCard,
} from './card-acceptance-logic.js';

describe('shouldIndexCard', () => {
  it('indexes only accepted cards that are not soft-deleted', () => {
    expect(shouldIndexCard({ acceptance: 'accepted', deletedAt: null })).toBe(true);
    expect(shouldIndexCard({ acceptance: 'proposed', deletedAt: null })).toBe(false);
    expect(shouldIndexCard({ acceptance: 'rejected', deletedAt: null })).toBe(false);
    expect(shouldIndexCard({ acceptance: 'accepted', deletedAt: new Date() })).toBe(false);
    expect(shouldIndexCard({ acceptance: 'accepted', deletedAt: '2026-09-24T00:00:00.000Z' })).toBe(
      false,
    );
    expect(shouldIndexCard({ acceptance: 'proposed', deletedAt: new Date() })).toBe(false);
  });
});

describe('codePointsAtMost', () => {
  const within500 = codePointsAtMost(500);

  it('counts Unicode code points and ignores NUL, not UTF-16 units', () => {
    expect(within500('a'.repeat(500))).toBe(true);
    expect(within500('a'.repeat(501))).toBe(false);
    expect(within500('🙂'.repeat(500))).toBe(true);
    expect(within500('🙂'.repeat(501))).toBe(false);
    expect(within500(`${'a'.repeat(500)}\0\0`)).toBe(true);
    expect(within500(`${'\0'.repeat(20)}${'a'.repeat(501)}`)).toBe(false);
    expect(within500('a\0'.repeat(500))).toBe(true);
  });

  it('is what rejectCardInputSchema uses', () => {
    expect(rejectCardInputSchema.safeParse({}).success).toBe(true);
    expect(rejectCardInputSchema.safeParse({ reason: '' }).success).toBe(true);
    expect(rejectCardInputSchema.safeParse({ reason: '  可以不填  ' }).success).toBe(true);
    expect(rejectCardInputSchema.safeParse({ reason: '🙂'.repeat(500) }).success).toBe(true);
    expect(rejectCardInputSchema.safeParse({ reason: '🙂'.repeat(501) }).success).toBe(false);
    expect(rejectCardInputSchema.safeParse({ reason: `${'字'.repeat(500)}\0` }).success).toBe(true);
    expect(rejectCardInputSchema.safeParse({ reason: '字'.repeat(501) }).success).toBe(false);
  });
});

describe('decideCardAcceptance', () => {
  it('accepts a proposed card and rejects it without a review row', () => {
    expect(decideCardAcceptance({ acceptance: 'proposed', action: 'accept', hasReviewLogs: false })).toEqual({
      kind: 'accept',
    });
    expect(decideCardAcceptance({ acceptance: 'proposed', action: 'reject', hasReviewLogs: false })).toEqual({
      kind: 'reject',
      from: 'proposed',
    });
    expect(decideCardAcceptance({ acceptance: 'proposed', action: 'reject', hasReviewLogs: true })).toEqual({
      kind: 'reject',
      from: 'proposed',
    });
  });

  it('no-ops a second accept and blocks reject after review logs', () => {
    expect(decideCardAcceptance({ acceptance: 'accepted', action: 'accept', hasReviewLogs: false })).toEqual({
      kind: 'noop',
    });
    expect(decideCardAcceptance({ acceptance: 'accepted', action: 'accept', hasReviewLogs: true })).toEqual({
      kind: 'noop',
    });
    expect(decideCardAcceptance({ acceptance: 'accepted', action: 'reject', hasReviewLogs: false })).toEqual({
      kind: 'reject',
      from: 'accepted',
    });
    expect(decideCardAcceptance({ acceptance: 'accepted', action: 'reject', hasReviewLogs: true })).toEqual({
      kind: 'already_reviewed',
    });
  });

  it('refuses to accept a rejected card and ignores a second reject', () => {
    expect(decideCardAcceptance({ acceptance: 'rejected', action: 'accept', hasReviewLogs: false })).toEqual({
      kind: 'not_acceptable',
    });
    expect(decideCardAcceptance({ acceptance: 'rejected', action: 'reject', hasReviewLogs: true })).toEqual({
      kind: 'noop',
    });
  });
});

describe('normalizeRejectReason', () => {
  it('stores empty and NUL-only reasons as null', () => {
    expect(normalizeRejectReason(undefined)).toBeNull();
    expect(normalizeRejectReason('')).toBeNull();
    expect(normalizeRejectReason('   ')).toBeNull();
    expect(normalizeRejectReason('\0\0')).toBeNull();
    expect(normalizeRejectReason(' 太碎了 \0')).toBe('太碎了');
  });
});

describe('planSearchBackfill', () => {
  const accepted = { id: 'a', acceptance: 'accepted' as const, deletedAt: null };
  const proposed = { id: 'p', acceptance: 'proposed' as const, deletedAt: null };
  const rejected = { id: 'r', acceptance: 'rejected' as const, deletedAt: null };
  const deleted = { id: 'd', acceptance: 'accepted' as const, deletedAt: new Date() };

  it('indexes missing accepted cards and deletes ids that should not be in the index', () => {
    expect(
      planSearchBackfill({
        indexedIds: ['a', 'p', 'gone'],
        cards: [accepted, proposed, rejected, deleted, { ...accepted, id: 'fresh' }],
      }),
    ).toEqual({
      deleteIds: ['p', 'gone'],
      indexIds: ['fresh'],
    });
  });

  it('does not delete anything when the index listing is empty', () => {
    expect(planSearchBackfill({ indexedIds: [], cards: [accepted, proposed] })).toEqual({
      deleteIds: [],
      indexIds: ['a'],
    });
  });
});
