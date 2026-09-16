import { describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_EMBEDDING_CONTENT_CHARS,
  clipChars,
  documentEmbeddingText,
  escapeIlikePattern,
  escapeMeiliValue,
  ilikeContainsPattern,
  intersectOrdered,
  meiliScopeFilter,
  orderByIds,
  qdrantScopeFilter,
  withSearchFallback,
} from './search-logic.js';

describe('documentEmbeddingText', () => {
  it('joins title, description, and content head', () => {
    expect(
      documentEmbeddingText({
        title: '偏差与方差',
        description: '欠拟合与过拟合的权衡',
        contentMd: '高偏差通常来自模型太简单。',
      }),
    ).toBe('偏差与方差\n欠拟合与过拟合的权衡\n高偏差通常来自模型太简单。');
  });

  it('drops empty fields and clips content to 500 unicode chars', () => {
    const content = '字'.repeat(DOCUMENT_EMBEDDING_CONTENT_CHARS + 40);
    const text = documentEmbeddingText({ title: null, description: '  ', contentMd: content });
    expect(text).toBe('字'.repeat(DOCUMENT_EMBEDDING_CONTENT_CHARS));
    expect([...text].length).toBe(DOCUMENT_EMBEDDING_CONTENT_CHARS);
  });

  it('returns empty string when there is nothing to index', () => {
    expect(documentEmbeddingText({ title: null, description: null, contentMd: '  \n' })).toBe('');
  });
});

describe('clipChars', () => {
  it('keeps short strings and clips long ones by unicode scalar', () => {
    expect(clipChars('梯度', 4)).toBe('梯度');
    expect(clipChars('光合作用', 2)).toBe('光合');
  });
});

describe('ilike pattern', () => {
  it('escapes LIKE wildcards and wraps with %', () => {
    expect(escapeIlikePattern('100%_off\\x')).toBe('100\\%\\_off\\\\x');
    expect(ilikeContainsPattern('  光合%  ')).toBe('%光合\\%%');
  });
});

describe('scope filters', () => {
  it('escapes meili quotes and backslashes', () => {
    expect(escapeMeiliValue("a'b\\c")).toBe("a\\'b\\\\c");
  });

  it('builds user-only filters', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    expect(qdrantScopeFilter(userId)).toEqual({
      must: [{ key: 'user_id', match: { value: userId } }],
    });
    expect(meiliScopeFilter(userId)).toBe(`user_id = '${userId}'`);
  });

  it('adds topic_id when scoping a topic', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const topicId = '22222222-2222-4222-8222-222222222222';
    expect(qdrantScopeFilter(userId, topicId)).toEqual({
      must: [
        { key: 'user_id', match: { value: userId } },
        { key: 'topic_id', match: { value: topicId } },
      ],
    });
    expect(meiliScopeFilter(userId, topicId)).toBe(
      `user_id = '${userId}' AND topic_id = '${topicId}'`,
    );
  });
});

describe('intersectOrdered', () => {
  it('keeps rank order and drops ids outside the allowed set', () => {
    expect(intersectOrdered(['c', 'a', 'x', 'b'], new Set(['a', 'b', 'c']))).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});

describe('orderByIds', () => {
  it('preserves rank order and drops missing rows', () => {
    const rows = [
      { id: 'b', n: 2 },
      { id: 'a', n: 1 },
      { id: 'c', n: 3 },
    ];
    expect(orderByIds(['a', 'missing', 'c'], rows)).toEqual([
      { id: 'a', n: 1 },
      { id: 'c', n: 3 },
    ]);
  });
});

describe('withSearchFallback', () => {
  it('returns hybrid hits when retrieval works', async () => {
    const hybrid = vi.fn().mockResolvedValue(['h1']);
    const fallback = vi.fn().mockResolvedValue(['f1']);
    await expect(withSearchFallback(hybrid, fallback)).resolves.toEqual(['h1']);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back when embedding/qdrant/meili throws', async () => {
    const err = new Error('qdrant down');
    const onFallback = vi.fn();
    const hybrid = vi.fn().mockRejectedValue(err);
    const fallback = vi.fn().mockResolvedValue(['f1']);
    await expect(withSearchFallback(hybrid, fallback, { onFallback })).resolves.toEqual(['f1']);
    expect(onFallback).toHaveBeenCalledWith(err);
  });

  it('skips hybrid when fallback is forced on', async () => {
    const hybrid = vi.fn().mockResolvedValue(['h1']);
    const fallback = vi.fn().mockResolvedValue(['f1']);
    await expect(withSearchFallback(hybrid, fallback, { forceFallback: true })).resolves.toEqual([
      'f1',
    ]);
    expect(hybrid).not.toHaveBeenCalled();
  });
});
