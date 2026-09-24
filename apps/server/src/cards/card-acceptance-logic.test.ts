import { rejectCardInputSchema } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { codePointsAtMost, shouldIndexCard } from './card-acceptance-logic.js';

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
