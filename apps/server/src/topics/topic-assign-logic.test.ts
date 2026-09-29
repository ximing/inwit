import { describe, expect, it } from 'vitest';
import {
  TOPIC_ASSIGN_ABSTAIN_ID,
  accumulateTopicHits,
  assignmentQueryUsable,
  buildAssignmentQuery,
  buildTopicDossier,
  chooseTopicAssignment,
  shortlistTopics,
  type TopicHit,
  type TopicRelevance,
} from './topic-assign-logic.js';

const rust = 'topic-rust';
const ml = 'topic-ml';

function rel(topicId: string, relevance: number | null): TopicRelevance {
  return { topicId, relevance };
}

function hits(rows: [string, number, number][]): TopicHit[] {
  return rows.map(([topicId, hitCount, hitScore]) => ({ topicId, hitCount, hitScore }));
}

describe('buildAssignmentQuery', () => {
  it('joins title, description, and concepts, and ignores blanks', () => {
    const query = buildAssignmentQuery({
      title: '  所有权  ',
      description: '',
      concepts: [' 移动语义 ', ''],
    });
    expect(query).toBe('所有权\n移动语义');
    expect(assignmentQueryUsable(query)).toBe(true);
    expect(assignmentQueryUsable('ab')).toBe(false);
  });
});

describe('buildTopicDossier', () => {
  it('keeps title, goal, nodes, and concepts', () => {
    expect(
      buildTopicDossier({
        title: 'Rust',
        goal: '搞懂所有权',
        nodeTitles: ['借用', '借用', '生命周期'],
        concepts: ['移动'],
      }),
    ).toBe('Rust\n搞懂所有权\n借用、生命周期\n移动');
  });
});

describe('accumulateTopicHits', () => {
  it('caps hits from one source document and drops unscoped rows', () => {
    const totals = accumulateTopicHits([
      { topicId: rust, sourceId: 'doc-a', score: 0.9 },
      { topicId: rust, sourceId: 'doc-a', score: 0.8 },
      { topicId: rust, sourceId: 'doc-a', score: 0.7 },
      { topicId: rust, sourceId: 'doc-a', score: 0.6 },
      { topicId: null, sourceId: 'doc-b', score: 0.99 },
      { topicId: ml, sourceId: 'doc-c', score: null },
    ]);
    expect(totals.map((row) => ({ topicId: row.topicId, hitCount: row.hitCount }))).toEqual([
      { topicId: rust, hitCount: 3 },
      { topicId: ml, hitCount: 1 },
    ]);
    expect(totals[0]?.hitScore).toBeCloseTo(2.4);
    expect(totals[1]?.hitScore).toBeCloseTo(0.01);
  });
});

describe('shortlistTopics', () => {
  it('prefers a title mentioned in the query, then retrieval score', () => {
    const topics = [
      { id: 'a', title: '烹饪' },
      { id: 'b', title: '线性代数' },
      { id: 'c', title: '历史' },
    ];
    const picked = shortlistTopics(topics, new Map([['c', 5], ['a', 1]]), '线性代数的特征值', 2);
    expect(picked.map((topic) => topic.id)).toEqual(['b', 'c']);
  });
});

describe('chooseTopicAssignment', () => {
  it('assigns the topic that clearly beats abstain and the runner-up', () => {
    expect(
      chooseTopicAssignment({
        relevance: [rel(rust, 0.91), rel(ml, 0.4), rel(TOPIC_ASSIGN_ABSTAIN_ID, 0.2)],
        hits: [],
      }),
    ).toMatchObject({ topicId: rust, reason: 'rerank', relevance: 0.91, abstain: 0.2, runnerUp: 0.4 });
  });

  it('assigns the only topic when it beats abstain', () => {
    expect(
      chooseTopicAssignment({
        relevance: [rel(rust, 0.88), rel(TOPIC_ASSIGN_ABSTAIN_ID, 0.3)],
        hits: hits([[rust, 4, 2]]),
      }),
    ).toMatchObject({ topicId: rust, reason: 'rerank' });
  });

  it('does not assign a weak winner even when it leads abstain', () => {
    expect(
      chooseTopicAssignment({
        relevance: [rel(rust, 0.42), rel(TOPIC_ASSIGN_ABSTAIN_ID, 0.1)],
        hits: [],
      }),
    ).toBeNull();
  });

  it('leaves the document unassigned when the only topic does not beat abstain', () => {
    expect(
      chooseTopicAssignment({
        relevance: [rel(rust, 0.46), rel(TOPIC_ASSIGN_ABSTAIN_ID, 0.4)],
        hits: hits([[rust, 8, 4]]),
      }),
    ).toBeNull();
  });

  it('does not assign a single topic when rerank omitted the abstain score', () => {
    expect(
      chooseTopicAssignment({
        relevance: [rel(rust, 0.99)],
        hits: hits([[rust, 6, 3]]),
      }),
    ).toBeNull();
  });

  it('leaves a close rerank as unassigned without a decisive retrieval vote', () => {
    expect(
      chooseTopicAssignment({
        relevance: [rel(rust, 0.8), rel(ml, 0.74), rel(TOPIC_ASSIGN_ABSTAIN_ID, 0.1)],
        hits: hits([
          [rust, 2, 1],
          [ml, 2, 0.9],
        ]),
      }),
    ).toBeNull();
  });

  it('breaks a close rerank when one topic owns the retrieved material', () => {
    expect(
      chooseTopicAssignment({
        relevance: [rel(rust, 0.8), rel(ml, 0.74), rel(TOPIC_ASSIGN_ABSTAIN_ID, 0.1)],
        hits: hits([
          [rust, 1, 0.4],
          [ml, 6, 3],
        ]),
      }),
    ).toMatchObject({ topicId: ml, reason: 'rerank_hits', hitCount: 6 });
  });

  it('falls back to retrieval when rerank returned nothing and two topics disagree', () => {
    expect(
      chooseTopicAssignment({
        relevance: [],
        hits: hits([
          [rust, 6, 3],
          [ml, 2, 0.4],
        ]),
      }),
    ).toMatchObject({ topicId: rust, reason: 'hits', hitCount: 6 });
  });

  it('does not let the only indexed topic win on hit count alone', () => {
    expect(
      chooseTopicAssignment({
        relevance: [],
        hits: hits([[rust, 10, 5]]),
      }),
    ).toBeNull();
  });
});
