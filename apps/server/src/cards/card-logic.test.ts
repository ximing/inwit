import type { CardQuestion, CardQuestionInput } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { diffCardQuestions, normalizeTags } from './card-logic.js';

function existing(id: string, question = '问', answer = '答'): CardQuestion {
  return {
    id,
    cardId: 'card-1',
    type: 'cloze',
    question,
    answer,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const input = (partial: Partial<CardQuestionInput>): CardQuestionInput => ({
  type: 'cloze',
  question: '问',
  answer: '答',
  ...partial,
});

describe('diffCardQuestions', () => {
  it('creates entries without id', () => {
    const diff = diffCardQuestions([], [input({ question: '新问' })]);
    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(0);
    expect(diff.unknownIds).toHaveLength(0);
  });

  it('updates only when content changed', () => {
    const rows = [existing('a'), existing('b')];
    const diff = diffCardQuestions(rows, [
      input({ id: 'a', question: '问' }),
      input({ id: 'b', question: '改过的问' }),
    ]);
    expect(diff.toUpdate.map((entry) => entry.id)).toEqual(['b']);
    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(0);
  });

  it('deletes existing rows missing from desired', () => {
    const rows = [existing('a'), existing('b'), existing('c')];
    const diff = diffCardQuestions(rows, [input({ id: 'a' })]);
    expect(diff.toDelete).toEqual(['b', 'c']);
  });

  it('flags ids that do not belong to the card', () => {
    const diff = diffCardQuestions([existing('a')], [input({ id: 'ghost' })]);
    expect(diff.unknownIds).toEqual(['ghost']);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('handles a mixed add/update/delete in one pass', () => {
    const rows = [existing('keep'), existing('drop')];
    const diff = diffCardQuestions(rows, [
      input({ id: 'keep', answer: '改过的答' }),
      input({ question: '全新' }),
    ]);
    expect(diff.toUpdate.map((entry) => entry.id)).toEqual(['keep']);
    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toDelete).toEqual(['drop']);
  });
});

describe('normalizeTags', () => {
  it('trims, drops empties, dedupes', () => {
    expect(normalizeTags(['  认知 ', '', '  ', '认知', '记忆'])).toEqual(['认知', '记忆']);
  });

  it('caps the count at 20', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(normalizeTags(tags)).toHaveLength(20);
  });

  it('clips overlong tags to 50 chars', () => {
    expect(normalizeTags(['一'.repeat(60)])[0]).toBe('一'.repeat(50));
  });
});
