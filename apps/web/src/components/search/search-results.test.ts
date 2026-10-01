import type { SearchResult } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { flattenSearchHits } from './search-results';

const DOC = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const NOTE = '33333333-3333-4333-8333-333333333333';
const TOPIC = '44444444-4444-4444-8444-444444444444';

const results = {
  documents: [{ id: DOC, title: '笔记', topicTitle: '代数' }],
  cards: [{ id: CARD, documentId: DOC, concept: '极限', documentTitle: '笔记' }],
  annotations: [{ id: NOTE, documentId: DOC, documentTitle: '笔记', quote: '一句', note: '批注' }],
} as SearchResult;

describe('flattenSearchHits', () => {
  it('leaves the docs-page entrance off when no topic is in scope', () => {
    const hits = flattenSearchHits(results);
    expect(hits.map((hit) => hit.href)).toEqual([
      `/docs?doc=${DOC}`,
      `/docs?doc=${DOC}&anchor=${CARD}`,
      `/docs?doc=${DOC}&annotation=${NOTE}`,
    ]);
  });

  it('opens topic-scoped hits on the topic page', () => {
    const hits = flattenSearchHits(results, TOPIC);
    expect(hits.map((hit) => hit.href)).toEqual([
      `/topics?topic=${TOPIC}&doc=${DOC}`,
      `/topics?topic=${TOPIC}&doc=${DOC}&anchor=${CARD}`,
      `/topics?topic=${TOPIC}&doc=${DOC}&annotation=${NOTE}`,
    ]);
  });
});
