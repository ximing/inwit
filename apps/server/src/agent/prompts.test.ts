import { describe, expect, it } from 'vitest';
import {
  ANALYZE_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  DIGEST_SYSTEM_PROMPT,
  EVOLVE_SYSTEM_PROMPT,
  MEMORY_COLLECTION_STEP,
  MEMORY_COLLECTION_USER_SENTENCE,
  TOPIC_FILL_SYSTEM_PROMPT,
  TOPIC_ORGANIZE_SYSTEM_PROMPT,
  TOPIC_SUGGEST_SYSTEM_PROMPT,
  WEEKLY_SYSTEM_PROMPT,
  WRITE_MEMORY_TABLE_NOTE,
  analyzeUserPrompt,
  chatUserPrompt,
  digestUserPrompt,
  evolveUserPrompt,
  topicFillUserPrompt,
  topicOrganizeUserPrompt,
  topicSuggestUserPrompt,
  weeklyUserPrompt,
} from './prompts.js';

function stepHeads(prompt: string): number[] {
  return [...prompt.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
}

function firstStep(prompt: string): string {
  const start = prompt.indexOf('1. ');
  const next = prompt.indexOf('\n2. ');
  return prompt.slice(start, next);
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const STEPS: Record<string, { prompt: string; last: number }> = {
  digest: { prompt: DIGEST_SYSTEM_PROMPT, last: 10 },
  chat: { prompt: CHAT_SYSTEM_PROMPT, last: 7 },
  evolve: { prompt: EVOLVE_SYSTEM_PROMPT, last: 4 },
  analyze: { prompt: ANALYZE_SYSTEM_PROMPT, last: 6 },
};

describe('memory collection prompts', () => {
  it('puts the memory paragraph in step 1 and renumbers the old list once', () => {
    expect(MEMORY_COLLECTION_STEP.startsWith('1. 调用 search_memory_collections。')).toBe(true);
    expect(MEMORY_COLLECTION_STEP).toContain('一次最多 3 个 id，不要为了保险把每个集合都加载进来');
    expect(MEMORY_COLLECTION_STEP).toContain('不要把记忆原文抄进卡片或回答');
    expect(MEMORY_COLLECTION_STEP).toContain(
      'search_user_memories 和 search_cards 只检索已有知识卡片，不能用来读取记忆集合。',
    );
    expect(MEMORY_COLLECTION_USER_SENTENCE).toBe(
      '第 1 步是 search_memory_collections，再按描述决定是否 load_memory_collection，然后才是原来的第一步。',
    );

    for (const [name, { prompt, last }] of Object.entries(STEPS)) {
      expect(firstStep(prompt), name).toBe(MEMORY_COLLECTION_STEP);
      expect(stepHeads(prompt), name).toEqual(Array.from({ length: last }, (_, index) => index + 1));
      expect(countOf(prompt, MEMORY_COLLECTION_STEP), name).toBe(1);
    }

    expect(DIGEST_SYSTEM_PROMPT).toContain('2. 先用 read_document 读取原文');
    expect(DIGEST_SYSTEM_PROMPT).toContain('4. 用 search_user_memories 检索用户已有概念');
    expect(DIGEST_SYSTEM_PROMPT).toContain('7. 对 write_cards 返回的每一张新卡，再用 search_user_memories');
    expect(DIGEST_SYSTEM_PROMPT).toContain('第 8 步刚软归属成功');
    expect(DIGEST_SYSTEM_PROMPT).not.toContain('第 7 步刚软归属成功');
    expect(DIGEST_SYSTEM_PROMPT).not.toContain(WRITE_MEMORY_TABLE_NOTE);
    expect(CHAT_SYSTEM_PROMPT).toContain('2. 先用 search_cards 检索用户已有卡片');
    expect(CHAT_SYSTEM_PROMPT).not.toContain(WRITE_MEMORY_TABLE_NOTE);
    expect(EVOLVE_SYSTEM_PROMPT).toContain('2. 先调用 read_card');
    expect(EVOLVE_SYSTEM_PROMPT).toContain('4. 最后调用 write_memory');
    expect(ANALYZE_SYSTEM_PROMPT).toContain('2. 先调用 read_struggling_cards');
    expect(ANALYZE_SYSTEM_PROMPT).toContain('6. 没有成对混淆也可以结束');
    expect(countOf(EVOLVE_SYSTEM_PROMPT, WRITE_MEMORY_TABLE_NOTE)).toBe(1);
    expect(countOf(ANALYZE_SYSTEM_PROMPT, WRITE_MEMORY_TABLE_NOTE)).toBe(1);
    expect(WRITE_MEMORY_TABLE_NOTE).toContain('只写 memories 表的 mastery 或 confusable 快照');
    expect(WRITE_MEMORY_TABLE_NOTE).toContain('evolve 的 key 仍是 card:<id>');
    expect(WRITE_MEMORY_TABLE_NOTE).toContain('analyze 的 key 仍是 confusable:<a>+<b>');
    expect(WRITE_MEMORY_TABLE_NOTE).toContain('不能代替 search_memory_collections');
  });

  it('reminds the four user prompts once and leaves weekly and topic prompts alone', () => {
    const digest = digestUserPrompt({
      documentId: 'doc-1',
      topicId: 'topic-1',
      topics: [{ id: 'topic-1', title: '线性代数', goal: null }],
    });
    expect(digest).toContain('doc-1');
    expect(digest).toContain('place_on_map');
    expect(countOf(digest, MEMORY_COLLECTION_USER_SENTENCE)).toBe(1);

    const chat = chatUserPrompt({ documentId: 'doc-2', question: '梯度为什么消失？' });
    expect(chat).toContain('梯度为什么消失？');
    expect(countOf(chat, MEMORY_COLLECTION_USER_SENTENCE)).toBe(1);

    const fuzzy = evolveUserPrompt({ cardId: 'card-1', reason: 'fuzzy' });
    const split = evolveUserPrompt({ cardId: 'card-1', reason: 'repeated_forgot' });
    expect(fuzzy).toContain('write_questions 只追加');
    expect(split).toContain('split_card');
    expect(countOf(fuzzy, MEMORY_COLLECTION_USER_SENTENCE)).toBe(1);
    expect(countOf(split, MEMORY_COLLECTION_USER_SENTENCE)).toBe(1);

    const analyze = analyzeUserPrompt();
    expect(analyze).toContain('read_struggling_cards');
    expect(countOf(analyze, MEMORY_COLLECTION_USER_SENTENCE)).toBe(1);

    const untouched = [
      WEEKLY_SYSTEM_PROMPT,
      weeklyUserPrompt({ weekStart: '2026-09-21', weekEnd: '2026-09-27' }),
      TOPIC_ORGANIZE_SYSTEM_PROMPT,
      topicOrganizeUserPrompt({ topicId: 'topic-1' }),
      TOPIC_FILL_SYSTEM_PROMPT,
      topicFillUserPrompt({ topicId: 'topic-1', nodeId: 'node-1', documentId: 'doc-1' }),
      TOPIC_SUGGEST_SYSTEM_PROMPT,
      topicSuggestUserPrompt(),
    ];
    for (const prompt of untouched) {
      expect(prompt).not.toContain('search_memory_collections');
      expect(prompt).not.toContain(MEMORY_COLLECTION_USER_SENTENCE);
    }
    expect(WEEKLY_SYSTEM_PROMPT).toContain('1. 先调用 read_week_stats');
    expect(TOPIC_ORGANIZE_SYSTEM_PROMPT).toContain('1. 先调用 read_topic_context');
  });
});
