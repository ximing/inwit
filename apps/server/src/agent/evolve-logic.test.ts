import { evolveAnalyzeJobPayloadFrom, evolveJobPayloadFrom } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { addedQuestionIsNewAngle, evolveResultSummary } from './evolve-logic.js';

const CARD = '11111111-1111-4111-8111-111111111111';

describe('evolveJobPayloadFrom', () => {
  it('accepts fuzzy and maps historical forgot → repeated_forgot', () => {
    expect(evolveJobPayloadFrom({ cardId: CARD, reason: 'fuzzy' })).toEqual({
      cardId: CARD,
      reason: 'fuzzy',
    });
    expect(evolveJobPayloadFrom({ cardId: CARD, reason: 'forgot' })).toEqual({
      cardId: CARD,
      reason: 'repeated_forgot',
    });
    expect(evolveJobPayloadFrom({ cardId: CARD, reason: 'repeated_forgot' })?.reason).toBe(
      'repeated_forgot',
    );
    expect(evolveJobPayloadFrom({ reason: 'fuzzy' })).toBeUndefined();
    expect(evolveJobPayloadFrom({ cardId: CARD, action: 'analyze_patterns' })).toBeUndefined();
    expect(
      evolveAnalyzeJobPayloadFrom({ action: 'analyze_patterns', date: '2026-09-14' })?.action,
    ).toBe('analyze_patterns');
  });
});

describe('addedQuestionIsNewAngle', () => {
  it('requires a newly added type unless all three types already exist', () => {
    expect(addedQuestionIsNewAngle(['cloze'], ['cloze'])).toBe(false);
    expect(addedQuestionIsNewAngle(['cloze'], ['judge'])).toBe(true);
    expect(addedQuestionIsNewAngle(['cloze', 'compare'], ['judge'])).toBe(true);
    expect(addedQuestionIsNewAngle(['cloze', 'compare', 'judge'], ['cloze'])).toBe(true);
    expect(addedQuestionIsNewAngle(['cloze'], [])).toBe(false);
  });
});

describe('evolveResultSummary', () => {
  it('formats both reasons', () => {
    expect(
      evolveResultSummary({ reason: 'fuzzy', questionDelta: 1, childCount: 0, memoryWritten: true }),
    ).toBe('reason=fuzzy questions=+1 memory=1');
    expect(
      evolveResultSummary({
        reason: 'repeated_forgot',
        questionDelta: 2,
        childCount: 2,
        memoryWritten: true,
      }),
    ).toBe('reason=repeated_forgot children=2 questions=+2 memory=1');
  });
});
