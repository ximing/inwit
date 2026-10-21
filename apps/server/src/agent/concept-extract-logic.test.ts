import { CONCEPT_CHUNK_TARGET_CHARS } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  ExtractTooLargeError,
  acceptedShardSubmissions,
  conceptExtractTimeoutMs,
  finalizeConceptDraft,
  firstUnreadShard,
  formatShardText,
  mergeShardSubmissions,
  shardBlocks,
  shardCapIssue,
  shardSubmissionSchema,
  type ExtractBlock,
  type ShardSubmission,
} from './concept-extract-logic.js';

function blocks(...texts: (string | null)[]): ExtractBlock[] {
  let page = 1;
  return texts.map((text, i) => {
    if (text === null) {
      page += 1;
      return { index: i + 1, pageIndex: page - 1, text: '' };
    }
    return { index: i + 1, pageIndex: page, text };
  });
}

function submission(shardIndex: number, over: Partial<ShardSubmission> = {}): ShardSubmission {
  return shardSubmissionSchema.parse({
    shardIndex,
    concepts: [],
    relations: [],
    ...over,
  });
}

describe('shardBlocks', () => {
  it('按目标字符数整包分片，空块跳过', () => {
    const shards = shardBlocks(blocks('a'.repeat(5000), 'b'.repeat(4000), 'c'.repeat(100)));
    expect(shards).toHaveLength(2);
    // 5000+4000 超过 8000 目标：第二块进入下一个分片
    expect(shards[0]!.pieces.map((piece) => piece.blockIndex)).toEqual([1]);
    expect(shards[1]!.pieces.map((piece) => piece.blockIndex)).toEqual([2, 3]);
  });

  it('超长块按 code point 边界拆分并记录偏移，可回溯原块', () => {
    const longText = '汉'.repeat(CONCEPT_CHUNK_TARGET_CHARS * 2 + 100);
    const shards = shardBlocks(blocks(longText));
    expect(shards.length).toBeGreaterThanOrEqual(3);
    const all = shards.flatMap((shard) => shard.pieces);
    expect(all.every((piece) => piece.partial)).toBe(true);
    // 偏移拼接等于原文
    const reassembled = all.map((piece) => piece.text).join('');
    expect(reassembled).toBe(longText);
    expect(all[0]!.offsetStart).toBe(0);
    expect(all[1]!.offsetStart).toBe(CONCEPT_CHUNK_TARGET_CHARS);
    // 每个分片不超过目标
    expect(shards.every((shard) => shard.chars <= CONCEPT_CHUNK_TARGET_CHARS)).toBe(true);
  });

  it('formatShardText 标注块号、页码与片段偏移', () => {
    const shards = shardBlocks(blocks('第一段', null, '第二页'));
    const text = formatShardText(shards[0]!);
    expect(text).toContain('[块 1 | 第 1 页]');
    expect(text).toContain('[块 3 | 第 2 页]');
  });
});

describe('shardSubmissionSchema', () => {
  it('重复 tempId 与同 tempId 自环被拒绝；端点三选一', () => {
    expect(
      shardSubmissionSchema.safeParse({
        shardIndex: 0,
        concepts: [
          { tempId: 'a', name: 'A', basis: 'explicit' },
          { tempId: 'a', name: 'B', basis: 'explicit' },
        ],
        relations: [],
      }).success,
    ).toBe(false);

    expect(
      shardSubmissionSchema.safeParse({
        shardIndex: 0,
        concepts: [{ tempId: 'a', name: 'A', basis: 'explicit' }],
        relations: [
          {
            tempId: 'r1',
            from: { tempId: 'a' },
            to: { tempId: 'a' },
            kind: 'other',
            predicate: '自环',
            basis: 'explicit',
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      shardSubmissionSchema.safeParse({
        shardIndex: 0,
        concepts: [],
        relations: [
          {
            tempId: 'r1',
            from: { tempId: 'a', name: 'A' },
            to: { name: 'B' },
            kind: 'other',
            predicate: 'x',
            basis: 'explicit',
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('mergeShardSubmissions', () => {
  it('同名候选跨分片合并，tempId 加前缀且关系端点重映射', () => {
    const s0 = submission(0, {
      concepts: [{ tempId: 'a', name: 'Task', basis: 'explicit', aliases: ['任务'], evidence: [], definition: '定义', example: null, sense: null }],
      relations: [],
    });
    const s1 = submission(1, {
      concepts: [{ tempId: 'a', name: ' task ', basis: 'explicit', aliases: ['作业'], evidence: [], definition: null, example: null, sense: null }],
      relations: [
        {
          tempId: 'r1',
          from: { tempId: 'a' },
          to: { name: 'Task' },
          kind: 'other',
          predicate: '关联',
          basis: 'explicit',
          context: null,
          explanation: null,
          example: null,
          evidence: [],
        },
      ],
    });
    const merged = mergeShardSubmissions([s0, s1]);
    expect(merged.concepts).toHaveLength(1);
    expect(merged.concepts[0]!.aliases).toContain('作业');
    expect(merged.relations[0]!.from).toEqual({ tempId: 's0:a' });
    // 合并后同名自环（s1:a → 合并到 s0:a，to 按名称也指向它）在 finalize 丢弃
  });
});

describe('finalizeConceptDraft', () => {
  const snapshot = blocks('Task 是实验的基本单位。', 'Trial 是 Task 的一次执行。');

  it('伪造引文被丢弃且 explicit 降级为 inferred', () => {
    const s0 = submission(0, {
      concepts: [
        {
          tempId: 'a',
          name: 'Task',
          basis: 'explicit',
          aliases: [],
          sense: null,
          definition: '实验的基本单位',
          example: null,
          evidence: [{ quote: '这句不在原文里', blockIndex: 1 }],
        },
      ],
      relations: [],
    });
    const result = finalizeConceptDraft({
      submissions: [s0],
      snapshotBlocks: snapshot,
      matchCandidates: [[]],
      existingConceptIds: new Set(),
    });
    expect(result.droppedEvidence).toBe(1);
    expect(result.draft.concepts[0]!.basis).toBe('inferred');
    expect(result.draft.concepts[0]!.evidence).toHaveLength(0);
  });

  it('真实引文保留 block 定位；悬空端点与未授权 conceptId 的关系被丢弃', () => {
    const foreignId = crypto.randomUUID();
    const s0 = submission(0, {
      concepts: [
        { tempId: 'a', name: 'Task', basis: 'explicit', aliases: [], sense: null, definition: null, example: null, evidence: [{ quote: 'Task 是实验的基本单位。', blockIndex: 1 }] },
        { tempId: 'b', name: 'Trial', basis: 'explicit', aliases: [], sense: null, definition: null, example: null, evidence: [] },
      ],
      relations: [
        {
          tempId: 'r1',
          from: { tempId: 'a' },
          to: { tempId: 'b' },
          kind: 'composition',
          predicate: '包含',
          basis: 'explicit',
          context: null,
          explanation: null,
          example: null,
          evidence: [{ quote: 'Trial 是 Task 的一次执行。', blockIndex: 2 }],
        },
        { // 悬空端点
          tempId: 'r2',
          from: { tempId: 'a' },
          to: { name: '不存在的概念' },
          kind: 'other',
          predicate: '关联',
          basis: 'explicit',
          context: null,
          explanation: null,
          example: null,
          evidence: [],
        },
        { // 未授权/不存在的已有概念
          tempId: 'r3',
          from: { tempId: 'a' },
          to: { conceptId: foreignId },
          kind: 'other',
          predicate: '关联',
          basis: 'explicit',
          context: null,
          explanation: null,
          example: null,
          evidence: [],
        },
      ],
    });
    const result = finalizeConceptDraft({
      submissions: [s0],
      snapshotBlocks: snapshot,
      matchCandidates: [[], []],
      existingConceptIds: new Set(),
    });
    expect(result.draft.relations).toHaveLength(1);
    expect(result.droppedRelations).toBe(2);
    const relation = result.draft.relations[0]!;
    expect(relation.evidence[0]!.locator).toMatchObject({ kind: 'block', blockIndex: 2 });
  });

  it('页码证据生成 pdf 定位；硬上限超出抛 ExtractTooLargeError', () => {
    const paged = blocks('第一页内容。', null, '第二页提到 Trial。');
    const s0 = submission(0, {
      concepts: [
        { tempId: 'a', name: 'Trial', basis: 'explicit', aliases: [], sense: null, definition: null, example: null, evidence: [{ quote: '第二页提到 Trial。', pageIndex: 2 }] },
      ],
      relations: [],
    });
    const result = finalizeConceptDraft({
      submissions: [s0],
      snapshotBlocks: paged,
      matchCandidates: [[]],
      existingConceptIds: new Set(),
    });
    expect(result.draft.concepts[0]!.evidence[0]!.locator).toMatchObject({
      kind: 'pdf',
      pageNumber: 2,
    });

    // 单分片上限 30；跨分片合并后超过硬上限 30 才在 finalize 抛出
    const makeMany = (shardIndex: number, count: number, offset: number) =>
      submission(shardIndex, {
        concepts: Array.from({ length: count }, (_, i) => ({
          tempId: `c${String(offset + i)}`,
          name: `概念${String(offset + i)}`,
          basis: 'explicit' as const,
          aliases: [],
          sense: null,
          definition: null,
          example: null,
          evidence: [],
        })),
        relations: [],
      });
    const many = [makeMany(0, 16, 0), makeMany(1, 16, 16)];
    expect(() =>
      finalizeConceptDraft({
        submissions: many,
        snapshotBlocks: snapshot,
        matchCandidates: Array.from({ length: 32 }, () => []),
        existingConceptIds: new Set(),
      }),
    ).toThrow(ExtractTooLargeError);
  });
});

describe('shard progress', () => {
  it('rejects a shard that tries to submit the whole article at once', () => {
    expect(shardCapIssue({ concepts: [1, 2, 3, 4, 5], relations: [] })).toContain('4 个概念');
    expect(shardCapIssue({ concepts: [1], relations: [1, 2, 3, 4, 5, 6, 7] })).toContain('6 条关系');
    expect(shardCapIssue({ concepts: [1], relations: [1] })).toBeNull();
  });

  it('resumes at the first shard that has no accepted submission', () => {
    expect(firstUnreadShard(5, [0, 2])).toBe(1);
    expect(firstUnreadShard(3, [0, 1, 2])).toBe(3);
  });

  it('drops progress entries that are not valid submissions', () => {
    const kept = acceptedShardSubmissions([
      { shardIndex: 0, concepts: [], relations: [], note: '没有术语' },
      { shardIndex: 1, concepts: [{ tempId: '' }] },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.shardIndex).toBe(0);
  });

  it('gives a long article more than ten minutes and still caps the run', () => {
    expect(conceptExtractTimeoutMs(1)).toBe(10 * 60_000);
    expect(conceptExtractTimeoutMs(5)).toBe(20 * 60_000);
    expect(conceptExtractTimeoutMs(12)).toBe(30 * 60_000);
  });
});
